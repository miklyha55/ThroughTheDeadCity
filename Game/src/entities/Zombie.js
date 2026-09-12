import * as THREE from 'three';
import { CONFIG } from '../config.js';

const CFG = CONFIG.zombies;

/**
 * Состояния зомби. Как и у персонажа — конечный автомат: каждое состояние само
 * двигает зомби, само ставит свою анимацию при входе и само решает, когда уйти.
 */
const STATE = {
  PATROL: 'patrol', // бродит от точки к точке, пока никого не видит
  IDLE: 'idle',     // остановился на месте, осматривается
  CHASE: 'chase',   // заметил персонажа и идёт к нему
  ATTACK: 'attack', // бьёт, пока тот рядом
  HURT: 'hurt',     // получил пулю и на миг сбит с шага
  DEAD: 'dead',     // убит, доигрывает падение и уходит под землю
};

const _toPlayer = new THREE.Vector3();
const _push = new THREE.Vector3();
const _step = new THREE.Vector3();
const _toPoint = new THREE.Vector3();

/**
 * Зомби: замечает персонажа в радиусе, медленно идёт к нему и бьёт вблизи.
 * Пока персонаж далеко, зомби стоит и дышит — так толпа не съедает кадр.
 */
export class Zombie {
  /**
   * @param {THREE.Object3D} model — клон скина со своим скелетом
   * @param {THREE.AnimationClip[]} clips — общие клипы библиотеки
   */
  constructor(model, clips) {
    this.root = model;
    this.root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false; // скиннинг ломает bounding box в bind-позе
      }
    });

    this.mixer = new THREE.AnimationMixer(model);
    this.actions = new Map();
    for (const clip of clips) {
      if (clip.name.startsWith('Armature|')) continue; // служебный клип из mixamo-экспорта
      this.actions.set(clip.name, this.mixer.clipAction(clip));
    }

    for (const once of ['Headbutt', 'Death', 'ReactionHit']) {
      const action = this.actions.get(once);
      if (!action) continue;
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    }
    // клип играется быстрее, значит и замах длится меньше реального времени
    this.attackLength = (this.actions.get('Headbutt')?.getClip().duration ?? 1) / CFG.attackSpeed;
    this.hurtLength = this.actions.get('ReactionHit')?.getClip().duration ?? 1;
    this.deathLength = this.actions.get('Death')?.getClip().duration ?? 1;

    this.health = CFG.health;
    this.deadTime = 0;
    this.hurtTime = 0;
    this.removed = false; // локация уберёт такого из списка

    this.yaw = 0;
    this.home = new THREE.Vector3();   // вокруг неё бродит, пока не увидит персонажа
    this.waypoint = new THREE.Vector3();
    this.waitTime = 0;
    this.state = STATE.PATROL;
    this.current = null;
    this.attackTime = 0;
    this.hitDone = false;

    this.play('Idle', 0);
  }

  get position() { return this.root.position; }

  get alive() { return this.state !== STATE.DEAD; }

  /** Чем он задевает предметы: телом такого радиуса и с такой скоростью. */
  get radius() { return CFG.bodyRadius; }

  get speed() {
    if (this.state === STATE.CHASE) return CFG.speed;
    if (this.state === STATE.PATROL) return CFG.patrolSpeed;
    return 0; // стоит — только отодвигает предмет, не пинает
  }

  /**
   * Попадание. Первое сбивает с шага, последнее валит замертво.
   * @returns {boolean} убит ли этим выстрелом
   */
  takeDamage(amount = 1) {
    if (this.state === STATE.DEAD) return false;

    this.health -= amount;
    if (this.health > 0) {
      this._enter(STATE.HURT);
      return false;
    }
    this._enter(STATE.DEAD);
    return true;
  }

  play(name, fade = 0.25) {
    const next = this.actions.get(name);
    if (!next || next === this.current) return;
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (this.current) this.current.fadeOut(fade);
    this.current = next;
  }

  /**
   * Сдвигает анимацию по фазе и темпу.
   * Без этого толпа дышит синхронно, как один механизм.
   */
  desync(offset, speed) {
    if (!this.current) return;
    this.current.time = offset;
    this.current.timeScale = speed;
    this.idleSpeed = speed;
  }

  /**
   * @param {number} dt
   * @param {import('./Player.js').Player} player
   * @param {import('../world/Location.js').Location} location
   * @param {Zombie[]} crowd — соседи, чтобы не слипаться в одну точку
   */
  update(dt, player, location, crowd) {
    if (this.state === STATE.DEAD) {
      this._rot(dt);
      this.mixer.update(dt);
      return;
    }

    const distance = this._distanceTo(player);

    switch (this.state) {
      case STATE.PATROL:
        this._patrol(dt, distance, player, location, crowd);
        break;
      case STATE.IDLE:
        this._idle(dt, distance, player, location);
        break;
      case STATE.CHASE:
        this._chase(dt, distance, player, location, crowd);
        break;
      case STATE.ATTACK:
        this._attack(dt, distance, player);
        break;
      case STATE.HURT:
        this._hurt(dt, distance, player);
        break;
    }
    this.mixer.update(dt);
  }

  /** Расстояние до персонажа по земле: высота не в счёт. */
  _distanceTo(player) {
    _toPlayer.subVectors(player.position, this.root.position).setY(0);
    return _toPlayer.length();
  }

  // ─── переходы ───────────────────────────────────────────────────────────────

  _enter(state) {
    if (state === this.state) return;
    this.state = state;

    switch (state) {
      case STATE.PATROL:
        this.play('Run', 0.3);
        // бредёт заметно медленнее, чем гонится: темп клипа под шаг
        this.current.timeScale = CFG.patrolSpeed / CFG.runClipSpeed;
        break;

      case STATE.IDLE:
        this.waitTime = CFG.waitMin + Math.random() * (CFG.waitMax - CFG.waitMin);
        this.play('Idle', 0.3);
        this.current.timeScale = this.idleSpeed ?? 1;
        break;

      case STATE.CHASE:
        this.play('Run', 0.25);
        // темп клипа под шаг: зомби бредёт, а не бежит
        this.current.timeScale = CFG.speed / CFG.runClipSpeed;
        break;

      case STATE.ATTACK:
        this.attackTime = 0;
        this.hitDone = false;
        this.play('Headbutt', 0.12);
        this.current.reset().play();
        this.current.timeScale = CFG.attackSpeed;
        break;

      case STATE.HURT:
        this.hurtTime = 0;
        this.play('ReactionHit', 0.1);
        this.current.reset().play();
        // клип длинный, а нужен только рывок — играем его быстрее
        this.current.timeScale = this.hurtLength / CFG.staggerFor;
        break;

      case STATE.DEAD:
        this.deadTime = 0;
        this.play('Death', 0.15);
        this.current.reset().play();
        this.current.timeScale = 1;
        break;
    }
  }

  // ─── состояния ──────────────────────────────────────────────────────────────

  /** Стоит на месте. Постояв — идёт к новой точке. */
  _idle(dt, distance, player, location) {
    if (this._sees(player, distance, location)) {
      this._enter(STATE.CHASE);
      return;
    }

    this.waitTime -= dt;
    if (this.waitTime <= 0) this._pickWaypoint(location), this._enter(STATE.PATROL);
  }

  /** Бродит от точки к точке вокруг своего места. */
  _patrol(dt, distance, player, location, crowd) {
    if (this._sees(player, distance, location)) {
      this._enter(STATE.CHASE);
      return;
    }

    _toPoint.subVectors(this.waypoint, this.root.position).setY(0);
    const left = _toPoint.length();

    if (left < CFG.waypointReached) {
      this._enter(STATE.IDLE); // пришёл — постоит и выберет новую точку
      return;
    }

    _toPoint.divideScalar(left);
    this._turnTo(Math.atan2(_toPoint.x, _toPoint.z), dt);

    _push.copy(_toPoint).multiplyScalar(CFG.patrolSpeed * dt);
    this._separate(_push, crowd);

    const position = this.root.position;
    position.add(_push);
    location.obstacles.resolve(position, CFG.radius);
    location.clampPosition(position);
  }

  /**
   * Видит ли персонажа.
   *
   * Не радиусом, а взглядом: цель должна попасть в конус перед зомби. Со спины
   * к нему можно подойти незамеченным — но только до alertRadius, вплотную он
   * почует в любом случае. За стеной не видит вовсе.
   */
  _sees(player, distance, location) {
    if (!player.alive || distance > CFG.senseRadius) return false;

    if (location.obstacles.blocksLine(
      this.root.position.x, this.root.position.z, player.position.x, player.position.z
    )) return false;

    if (distance <= CFG.alertRadius) return true; // так близко, что слышит

    // угол между взглядом и направлением на цель
    _toPlayer.divideScalar(distance || 1);
    const forward = Math.sin(this.yaw) * _toPlayer.x + Math.cos(this.yaw) * _toPlayer.z;
    return forward >= Math.cos((CFG.senseAngle * Math.PI) / 360);
  }

  /** Новая точка для прогулки — рядом с домом и по проходимому месту. */
  _pickWaypoint(location) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = CFG.patrolRadius * (0.35 + Math.random() * 0.65);

      const x = this.home.x + Math.cos(angle) * radius;
      const z = this.home.z + Math.sin(angle) * radius;

      if (location.nav.isFree(x, z)) {
        this.waypoint.set(x, this.root.position.y, z);
        return;
      }
    }
    this.waypoint.copy(this.home); // не нашли свободного — возвращаемся к себе
  }

  /** Медленно идёт к персонажу, обходя препятствия и расталкивая соседей. */
  _chase(dt, distance, player, location, crowd) {
    if (!player.alive || distance > CFG.loseRadius) {
      this.home.copy(this.root.position); // потерял цель — бродит уже здесь
      this._pickWaypoint(location);
      this._enter(STATE.PATROL);
      return;
    }
    if (distance <= CFG.attackRadius) {
      this._enter(STATE.ATTACK);
      return;
    }

    const position = this.root.position;

    // Путь ищем только если цель не видно напрямую: по открытому месту зомби
    // идёт прямо, иначе его шаги были бы заметно ступенчатыми — по клеткам.
    const straight = location.nav.hasLineOfSight(
      position.x, position.z, player.position.x, player.position.z
    );

    if (straight) _step.copy(_toPlayer).normalize();
    else if (!location.nav.direction(position.x, position.z, _step)) {
      _step.copy(_toPlayer).normalize(); // волна сюда не дошла — идём как можем
    }

    // поворот в ту сторону, куда шагаем
    this._turnTo(Math.atan2(_step.x, _step.z), dt);

    _push.copy(_step).multiplyScalar(CFG.speed * dt);
    this._separate(_push, crowd);
    position.add(_push);

    // в модели и за забор зомби не лезут — те же правила, что и для персонажа
    location.obstacles.resolve(position, CFG.radius);
    location.clampPosition(position);
  }

  /** Бьёт, пока персонаж рядом. Урон приходится на середину замаха. */
  _attack(dt, distance, player) {
    this.attackTime += dt;

    // доворачиваемся к цели: персонаж может обходить сбоку
    this._turnTo(Math.atan2(_toPlayer.x, _toPlayer.z), dt);

    if (!this.hitDone && this.attackTime >= this.attackLength * CFG.hitAt) {
      this.hitDone = true;
      // бьём, только если цель всё ещё в досягаемости — иначе удар в воздух
      if (distance <= CFG.attackRadius + CFG.reach) player.takeDamage(CFG.damage);
    }

    if (this.attackTime < this.attackLength) return;

    // замах закончился: бьём снова, догоняем или теряем интерес
    if (!player.alive) this._enter(STATE.IDLE);
    else if (distance > CFG.attackRadius) this._enter(STATE.CHASE);
    else {
      this.attackTime = 0;
      this.hitDone = false;
      this.current.reset().play();
    }
  }

  /** Сбит с шага: на миг замирает, потом снова идёт. */
  _hurt(dt, distance, player) {
    this.hurtTime += dt;
    if (this.hurtTime < CFG.staggerFor) return;

    this._enter(player.alive && distance <= CFG.loseRadius ? STATE.CHASE : STATE.PATROL);
  }

  /**
   * Труп: полежав, медленно уходит под землю и снимается со сцены.
   * Так тела не копятся на локации, но и не пропадают на глазах.
   */
  _rot(dt) {
    this.deadTime += dt;

    // ждём, пока доиграет падение, и только потом опускаем — иначе тело
    // начинает уходить в землю, ещё не упав
    if (this.deadTime < this.deathLength + CFG.corpseLinger) return;

    this.root.position.y -= CFG.sinkSpeed * dt;

    if (this.root.position.y <= -CFG.sinkDepth) {
      this.root.removeFromParent();
      this.removed = true;
    }
  }

  // ─── общее ──────────────────────────────────────────────────────────────────

  /** Поворот с постоянной скоростью: доворачивается ровно до цели и встаёт. */
  _turnTo(target, dt) {
    let delta = target - this.yaw;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));

    const step = CFG.turnSpeed * dt;
    this.yaw += Math.abs(delta) <= step ? delta : Math.sign(delta) * step;
    this.root.rotation.y = this.yaw;
  }

  /**
   * Отталкивает от соседей. Без этого толпа сходится в одну точку и лезет
   * друг сквозь друга — идут-то все в одно место.
   */
  _separate(step, crowd) {
    if (!crowd) return;
    const position = this.root.position;

    for (const other of crowd) {
      if (other === this || other.state === STATE.DEAD) continue;

      const dx = position.x - other.position.x;
      const dz = position.z - other.position.z;
      const gap = Math.hypot(dx, dz);
      if (gap >= CFG.separation || gap < 1e-4) continue;

      const force = (CFG.separation - gap) / CFG.separation;
      step.x += (dx / gap) * force * CFG.separationForce;
      step.z += (dz / gap) * force * CFG.separationForce;
    }
  }
}
