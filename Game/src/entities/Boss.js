import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Zombie } from './Zombie.js';

const CFG = CONFIG.boss;
const ZOMBIES = CONFIG.zombies;
const GRAVITY = CONFIG.debris.gravity;

/**
 * Что вожак делает прямо сейчас.
 *
 * Своё, а не зомби: он не бродит, не гонится и не бьёт. Мёртвый и вздрогнувший
 * названы так же, как у зомби, — по этим строкам общий код узнаёт, жив ли он.
 */
const STATE = {
  WAIT: 'wait',     // героя в круге нет — стоит
  FETCH: 'fetch',   // идёт за предметом
  STAND: 'stand',   // брать нечего совсем — держится поодаль от героя
  THROW: 'throw',   // поднял и швыряет
  HURT: 'hurt',     // вздрогнул от попадания
  DEAD: 'dead',
};

const _to = new THREE.Vector3();
const _step = new THREE.Vector3();
const _hand = new THREE.Vector3();
const _hit = new THREE.Vector3();

/**
 * Сколько предмет летит, пока не опустится до высоты `aimY`.
 *
 * Считается тем же шагом, что и сама физика, — с тяжестью и сопротивлением
 * воздуха. По формуле без сопротивления выходило на десятую долю дольше, и
 * бросок стабильно не долетал: верх дуги ниже, падение раньше.
 *
 * @param {number} up — начальная скорость вверх, м/с
 * @param {number} fromY — откуда, м @param {number} aimY — докуда, м
 */
function flightTime(up, fromY, aimY) {
  const step = 1 / 120;
  const keep = Math.exp(-CONFIG.debris.linearDamping * step);

  let y = fromY;
  let vy = up;
  let time = 0;

  while (time < 10) {
    vy = (vy - GRAVITY * step) * keep;
    y += vy * step;
    time += step;
    if (vy < 0 && y <= aimY) break;
  }
  return time;
}

/**
 * Вожак: огромный зомби, который воюет хламом.
 *
 * Пока герой в круге, всё повторяется по кругу: найти предмет, дойти, поднять,
 * швырнуть. Какой предмет брать, решается по очереди:
 *   1. ближайший из лежащих на пути к герою — между ними двумя;
 *   2. нет такого — ближайший в круге вокруг вожака;
 *   3. нет и там — ближайший на всём уровне.
 * Только брошенное им и убивает героя: остальной летающий хлам ему не опасен.
 *
 * Смотрит он по кругу, без угла обзора: со спины к нему не подойти. Бьёт сильно,
 * но и держит много — пуля снимает одну жизнь из пятидесяти, взрыв пять, тесак три.
 */
export class Boss extends Zombie {
  constructor(model, clips, kind = CFG.kind) {
    super(model, clips, kind);

    this.root.scale.setScalar(this._fitScale());
    this.once(['Throw']);

    this.health = CFG.health;
    this.maxHealth = CFG.health;

    this.throwLength = this.lengthOf('Throw', CFG.throwSpeed);
    this.hurtLength = this.lengthOf('ReactionHit', CFG.hurtSpeed);

    // Кисть берётся костью, а не сокетом: предмет к ней не цепляется, а только
    // едет следом. Прицепленный, он унаследовал бы масштаб скелета — а тот у
    // модели из mixamo сотая, и ящик в руке сжался бы в точку.
    this.hand = null;
    this.root.traverse((node) => {
      if (!this.hand && node.isBone && /RightHand$/.test(node.name)) this.hand = node;
    });

    this.state = STATE.WAIT;
    this.item = null;       // за чем идёт или что держит
    this.carry = null;      // бросок: { item, debris, time, grabbed, released }
    this.lookTime = 0;      // до следующего поиска, пока брать нечего
    this.restTime = 0;      // пауза после броска
    this.flinchTime = 0;    // до следующего вздрагивания
    this.stuck = 0;         // сколько не может подойти к предмету
    this.skipped = new Map(); // предмет → до какого времени его не брать
    this.clock = 0;
    this.walking = false;
    this.stepPhase = 1;     // где он был в прошлом кадре по циклу ходьбы
    this.throws = 0;        // сколько уже швырнул: по этому счёту он и рычит
    this.onDown = null;     // убит: сцене пора открыть выход
    this.onStep = null;     // шагнул: сцене пора качнуть камеру
    this.onSpotted = null;  // впервые заметил героя: сцена открывает его круг на карте
    this.spotted = false;

    this.play('Idle', 0);
  }

  get alive() { return this.state !== STATE.DEAD; }

  /**
   * Масштаб, при котором он ровно в `scale` раз выше обычного зомби.
   *
   * Просто умножить на три нельзя: модель вожака выгружена в сантиметрах, и
   * без поправки он выходил в сотню раз выше задуманного — голова на высоте
   * полукилометра. Поэтому рост меряется по самой модели — по самой высокой
   * кости скелета — и подгоняется к росту зомби. Так он встанет верно при любых
   * единицах в Blender, и переэкспорт в метрах ничего не сломает.
   */
  _fitScale() {
    this.root.scale.setScalar(1);
    this.root.updateMatrixWorld(true);

    let top = 0;
    this.root.traverse((node) => {
      if (!node.isBone) return;
      node.getWorldPosition(_hand);
      top = Math.max(top, _hand.y - this.root.position.y);
    });

    const wanted = ZOMBIES.bodyHeight * CFG.scale;
    return top > 1e-3 ? wanted / top : CFG.scale;
  }

  get radius() { return ZOMBIES.bodyRadius * CFG.scale; }
  get bodyRadius() { return ZOMBIES.bodyRadius * CFG.scale; }
  get bodyHeight() { return ZOMBIES.bodyHeight * CFG.scale; }
  get sizeScale() { return CFG.scale; }

  /**
   * По великану герой бьёт издалека: он виден через полкарты, и подходить к нему
   * на обычную дальность — значит стоять под самыми бросками.
   */
  get fireReach() { return CFG.fireReach; }

  get chasing() { return this.state !== STATE.WAIT && this.state !== STATE.DEAD; }

  get speed() { return this.walking ? CFG.walkSpeed : 0; }

  /** Полоска жизни над ним видна всегда, а не с первой раны: это бой, а не толпа. */
  get alwaysBar() { return true; }

  // ─── урон ───────────────────────────────────────────────────────────────────

  /** Пуля. Вздрагивает не от каждой: дробь идёт веером, и он дёргался бы без конца. */
  takeDamage(amount = 1, from = null) {
    if (!this.alive) return false;

    this.health -= amount;
    if (this.health <= 0) {
      this._die();
      return true;
    }

    // Бросок не прерывается: замах у него долгий, и сбитый каждой дробиной он
    // не кинул бы ни разу.
    if (this.state !== STATE.THROW && this.flinchTime <= 0) {
      this.flinchTime = CFG.flinchEvery;
      this._drop();
      this._set(STATE.HURT);
    }
    return false;
  }

  /**
   * Взрыв, тесак или разогнанный ящик. Наповал, как обычного, не валит — снимает
   * своё число жизней.
   */
  crush(from = null, gore = 1, cause = 'impact') {
    if (!this.alive) return false;

    this.blood?.splash(
      _hit.copy(this.root.position).setY(this.root.position.y + this.bodyHeight * 0.6),
      from ?? this.root.position,
      gore
    );

    const amount = cause === 'blast' ? CFG.blastDamage
      : cause === 'blade' ? CFG.bladeDamage
        : CFG.impactDamage;

    return this.takeDamage(amount, from);
  }

  _die() {
    this._drop();
    this.health = 0;
    this.walking = false;
    this._set(STATE.DEAD);
    this.onDown?.();
  }

  // ─── ход ────────────────────────────────────────────────────────────────────

  update(dt, player, location, crowd) {
    this.clock += dt;
    this.heardAt = this._distanceTo(player);

    if (this.state === STATE.DEAD) {
      // Как и любой зомби: полежит, уйдёт под землю и снимется со сцены.
      this._rot(dt);
      this.mixer.update(dt);
      return;
    }

    this.flinchTime -= dt;
    this.restTime -= dt;

    const sees = player.alive && this.heardAt <= CFG.senseRadius;

    // Один раз за уровень: заметив героя, вожак показывает себя целиком — весь
    // его круг проступает из тумана, и видно, с чем имеешь дело.
    if (sees && !this.spotted) {
      this.spotted = true;
      this._roar(); // заметил героя — рявкнул, и только один раз за бой
      this.onSpotted?.();
    }

    switch (this.state) {
      case STATE.WAIT:
        this._stand();
        if (sees && this.restTime <= 0) this._choose(player, location);
        break;

      case STATE.FETCH:
        if (!sees) this._set(STATE.WAIT);
        else this._fetch(dt, player, location, crowd);
        break;

      case STATE.STAND:
        if (!sees) this._set(STATE.WAIT);
        else this._keepAway(dt, player, location, crowd);
        break;

      case STATE.THROW:
        this._throwStep(dt, player);
        break;

      case STATE.HURT:
        if (this.clock - this.hurtAt >= this.hurtLength) this._set(STATE.WAIT);
        break;
    }

    this.mixer.update(dt);
    this._steps();
  }

  /**
   * Рык: им он и встречает героя, и швыряет, и падает.
   *
   * Запись каждый раз берётся случайная — их две, и одна и та же подряд звучит
   * как заевшая плёнка. Слышно его всегда, как бы далеко он ни стоял: это не
   * бормотание из толпы, а то, из-за чего игрок оборачивается.
   */
  _roar() {
    this.sfx?.play('bossRoar', CFG.voiceVolume, 1, CFG.voicePitch, { echo: false });
  }

  /**
   * Топот: отметки берутся из самого клипа ходьбы, как у героя.
   *
   * Так шаг звучит ровно тогда, когда нога касается земли, при любой скорости
   * клипа. По таймеру он бы разъезжался с картинкой.
   */
  _steps() {
    if (!this.walking || this.current !== this.actions.get('Walk')) {
      this.stepPhase = 1; // встал — следующий шаг с начала цикла
      return;
    }

    const clip = this.current.getClip();
    const phase = (this.current.time % clip.duration) / clip.duration;

    for (const at of CFG.stepPhases) {
      const crossed = this.stepPhase < phase
        ? at > this.stepPhase && at <= phase
        : at > this.stepPhase || at <= phase; // цикл пошёл заново

      if (!crossed) continue;

      this.sfx?.play('bossStep', CFG.stepVolume, 1, 1, { echo: false });
      this.onStep?.(this.heardAt); // и земля под ним вздрагивает
      break;
    }
    this.stepPhase = phase;
  }

  _set(state) {
    if (state === this.state && state !== STATE.HURT) return;

    this.state = state;
    this.walking = false;

    switch (state) {
      case STATE.WAIT:
      case STATE.STAND:
        this.play('Idle', 0.3);
        break;

      case STATE.FETCH:
        this.stuck = 0;
        break;

      case STATE.THROW:
        this.restart('Throw', 0.15, CFG.throwSpeed);
        break;

      case STATE.HURT:
        this.hurtAt = this.clock;
        this.restart('ReactionHit', ZOMBIES.hurtFade, CFG.hurtSpeed);
        break;

      case STATE.DEAD:
        this._roar();
        this.restart('Death', 0.15);
        break;
    }
  }

  /**
   * Выбрать, за чем идти. Порядок — от лучшего к запасному: на пути к герою, в
   * круге вокруг себя, где угодно на уровне.
   */
  _choose(player, location) {
    const items = location.debris.items.filter((item) => this._usable(item));

    const item = this._between(items, player)
      ?? this._nearest(items, CFG.senseRadius)
      ?? this._nearest(items, Infinity);

    this.item = item;
    this._set(item ? STATE.FETCH : STATE.STAND);
    this.lookTime = CFG.lookEvery;
  }

  /** Годится ли вещь в снаряд: лежит, не в руках, не клинок и не в опале. */
  _usable(item) {
    if (item.held || item.flight || item.blade) return false;
    if (!item.asleep && item.velocity.lengthSq() > 1) return false; // ещё летит

    const until = this.skipped.get(item);
    return !(until && until > this.clock);
  }

  /** Ближайший к вожаку предмет из лежащих в полосе между ним и героем. */
  _between(items, player) {
    const from = this.root.position;
    const dx = player.position.x - from.x;
    const dz = player.position.z - from.z;
    const length = Math.hypot(dx, dz);
    if (length < 1e-3) return null;

    const ux = dx / length;
    const uz = dz / length;

    let best = null;
    let bestAway = Infinity;

    for (const item of items) {
      const ox = item.object.position.x - from.x;
      const oz = item.object.position.z - from.z;

      const along = ox * ux + oz * uz;
      if (along < -CFG.behind || along > length) continue;
      if (Math.abs(ox * uz - oz * ux) > CFG.corridor) continue;

      const away = Math.hypot(ox, oz);
      if (away < bestAway) {
        best = item;
        bestAway = away;
      }
    }
    return best;
  }

  /** Ближайший предмет не дальше `within` от вожака. */
  _nearest(items, within) {
    const from = this.root.position;
    let best = null;
    let bestAway = within;

    for (const item of items) {
      const away = Math.hypot(item.object.position.x - from.x, item.object.position.z - from.z);
      if (away <= bestAway) {
        best = item;
        bestAway = away;
      }
    }
    return best;
  }

  /** Идёт к выбранному предмету, дошёл — поднимает. */
  _fetch(dt, player, location, crowd) {
    const item = this.item;

    // Предмет увели из-под носа: пнули, взорвали, подобрал герой.
    if (!location.debris.items.includes(item) || !this._usable(item)) {
      this._choose(player, location);
      return;
    }

    const at = item.object.position;
    const grab = this.radius + item.radius + CFG.reach;
    const away = Math.hypot(at.x - this.root.position.x, at.z - this.root.position.z);

    if (away <= grab) {
      this._grab(item, location.debris);
      return;
    }

    const moved = this._walkTo(dt, at.x, at.z, location, crowd);

    // Упёрся и не продвигается — этот предмет на время вычёркивается.
    this.stuck = moved ? 0 : this.stuck + dt;
    if (this.stuck >= CFG.stuckFor) {
      this.skipped.set(item, this.clock + CFG.forgetFor);
      this._choose(player, location);
    }
  }

  /**
   * Брать нечего вовсе — ни рядом, ни на уровне. Подходит к герою, но не
   * вплотную, и то и дело оглядывается: вдруг что-то появилось.
   */
  _keepAway(dt, player, location, crowd) {
    this.lookTime -= dt;
    if (this.lookTime <= 0) {
      this._choose(player, location);
      if (this.state !== STATE.STAND) return;
    }

    const p = player.position;
    if (this.heardAt > CFG.keepAway) this._walkTo(dt, p.x, p.z, location, crowd);
    else {
      this._stand();
      this._turnTo(Math.atan2(p.x - this.root.position.x, p.z - this.root.position.z), dt);
    }
  }

  /**
   * Шаг к точке.
   * @returns {boolean} продвинулся ли — по этому ловится застревание
   */
  _walkTo(dt, x, z, location, crowd) {
    const position = this.root.position;
    _to.set(x - position.x, 0, z - position.z);
    const length = _to.length();
    if (length < 1e-3) return true;

    _to.divideScalar(length);
    this._turnTo(Math.atan2(_to.x, _to.z), dt);

    if (!this.walking) {
      this.walking = true;
      this.play('Walk', 0.25);
      this.current?.setEffectiveTimeScale(CFG.walkSpeed / CFG.walkClipSpeed);
    }

    const beforeX = position.x;
    const beforeZ = position.z;

    _step.copy(_to).multiplyScalar(CFG.walkSpeed * dt);
    this._separate(_step, crowd, dt);
    position.add(_step);

    location.obstacles.resolve(position, CFG.stepRadius);
    location.clampPosition(position);

    const moved = Math.hypot(position.x - beforeX, position.z - beforeZ);
    return moved >= CFG.walkSpeed * dt * 0.3;
  }

  _stand() {
    if (!this.walking && this.current === this.actions.get('Idle')) return;
    this.walking = false;
    this.play('Idle', 0.3);
  }

  _turnTo(target, dt) {
    let delta = target - this.yaw;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));

    const step = CFG.turnSpeed * dt;
    this.yaw += Math.abs(delta) <= step ? delta : Math.sign(delta) * step;
    this.root.rotation.y = this.yaw;
  }

  // ─── бросок ─────────────────────────────────────────────────────────────────

  /** Нагнулся за предметом: физика его больше не трогает, дальше он едет с рукой. */
  _grab(item, debris) {
    debris.hold(item);
    this.item = null;
    this.carry = {
      item, debris, time: 0, grabbed: false, released: false,
      from: item.object.position.clone(), // где лежал: отсюда тянется к руке
    };
    this._set(STATE.THROW);
  }

  _throwStep(dt, player) {
    const carry = this.carry;
    carry.time += dt;

    const p = player.position;
    this._turnTo(Math.atan2(p.x - this.root.position.x, p.z - this.root.position.z), dt);

    const share = carry.time / this.throwLength;

    // Пока рука идёт вниз, предмет подтягивается к ней с земли; дотянулась —
    // дальше едет вместе с кистью. Без подтягивания он прыгал в руку разом:
    // вожак огромный, и кисть не доходит до земли вплотную к предмету.
    if (share >= CFG.grabAt) carry.grabbed = true;

    if (!carry.released) {
      if (carry.grabbed) this._carryInHand(carry.item);
      else if (share > CFG.reachFrom) {
        const k = (share - CFG.reachFrom) / (CFG.grabAt - CFG.reachFrom);
        this._carryInHand(carry.item, carry.from, k * k * (3 - 2 * k));
      }
    }

    if (!carry.released && share >= CFG.releaseAt) this._release(player);

    if (carry.time < this.throwLength) return;

    this.carry = null;
    this.restTime = CFG.rest;
    this._set(STATE.WAIT);
  }

  /**
   * Поставить предмет в руку — или на долю пути к ней.
   * @param {object} item @param {THREE.Vector3} [from] — откуда тянется
   * @param {number} [share] — какую долю пути прошёл, 1 — уже в руке
   */
  _carryInHand(item, from = null, share = 1) {
    if (!this.hand) return;

    this.hand.getWorldPosition(_hand);
    item.object.parent?.worldToLocal(_hand);

    if (from && share < 1) item.object.position.lerpVectors(from, _hand, share);
    else item.object.position.copy(_hand);
  }

  /**
   * Рука разжалась: предмет уходит в героя высокой дугой.
   *
   * Задаётся не скорость, а высота: верх дуги на `arcHeight` выше руки и цели.
   * Из неё выходит, сколько предмет летит, а из времени полёта — скорость по
   * земле. Так дуга одинаково высокая на любом расстоянии, и увернуться можно
   * всегда: видно, куда падает. Метит с упреждением — туда, куда герой добежит
   * за время полёта, — но не целиком.
   */
  _release(player) {
    const carry = this.carry;
    const { item, debris } = carry;
    carry.released = true;

    this._carryInHand(item);
    const from = item.object.position;

    const aimY = player.position.y + CFG.aimHeight;
    const peak = Math.max(from.y, aimY) + CFG.arcHeight;

    // Вверх до верха дуги и вниз до груди героя: вместе это и есть полёт.
    const up = Math.sqrt(2 * GRAVITY * (peak - from.y));
    const time = flightTime(up, from.y, aimY);

    const aimX = player.position.x + player.velocity.x * time * CFG.lead;
    const aimZ = player.position.z + player.velocity.z * time * CFG.lead;

    const dx = aimX - from.x;
    const dz = aimZ - from.z;
    const length = Math.hypot(dx, dz);

    // Цель прямо под рукой — бросаем отвесно, направление любое.
    const ux = length > 1e-3 ? dx / length : 0;
    const uz = length > 1e-3 ? dz / length : 0;

    // Сопротивление воздуха гасит и скорость вдоль земли: пройденный за полёт
    // путь — это v·(1 − e^(−k·t))/k, отсюда и нужная начальная скорость.
    const damping = CONFIG.debris.linearDamping * time;
    const reach = damping > 1e-3 ? (1 - Math.exp(-damping)) / CONFIG.debris.linearDamping : time;
    const along = Math.max(0.01, length / reach);

    debris.launch(item, ux, uz, along, up / along, CFG.throwSpin, this, CFG.throwGrace);

    // Рык через бросок: первый со звуком, дальше каждый третий.
    if (this.throws++ % CFG.roarEvery === 0) this._roar();

    // Смертельно для героя — и только это, и только пока летит.
    item.lethalTo = player;
    item.lethalFor = time + CFG.lethalAfter;

    this.sfx?.play('throw', CFG.voiceVolume);
  }

  /** Уронить недокинутое: убили или сбили на замахе. */
  _drop() {
    const carry = this.carry;
    this.carry = null;
    if (!carry || carry.released) return;

    carry.debris.launch(carry.item, 0, 0, 0, 0, 0, this, CFG.throwGrace);
  }
}
