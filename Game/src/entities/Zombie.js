import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { addSilhouette } from '../fx/Silhouette.js';

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

// Ближе этого запаса до дистанции удара шагать уже некуда — зомби ждёт стоя.
const CHASE_STEP_MIN = 0.02;

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

    // своя метка трафарета: иначе фигуры гасили бы силуэты друг друга
    this.silhouette = addSilhouette(model, {
      color: CONFIG.silhouette.zombieColor,
      opacity: CONFIG.silhouette.opacity,
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
    // сколько длится рывок: столько же, сколько играет сам клип
    this.hurtLength = (this.actions.get('ReactionHit')?.getClip().duration ?? 1) / CFG.hurtSpeed;
    this.deathLength = this.actions.get('Death')?.getClip().duration ?? 1;

    this.health = CFG.health;
    this.deadTime = 0;
    this.hurtTime = 0;
    this.removed = false; // локация уберёт такого из списка

    this.yaw = 0;
    this.home = new THREE.Vector3();   // вокруг неё бродит, пока не увидит персонажа
    this.waypoint = new THREE.Vector3();
    this.waitTime = 0;
    this.stuckTime = 0;    // сколько он топчется на месте, никуда не продвигаясь
    this.alerted = false;  // поднят по тревоге выстрелом — пойдёт на цель без обзора
    this.chaseMoving = true;
    this.state = STATE.PATROL;
    this.current = null;
    this.attackTime = 0;
    this.hitDone = false;
    this.recovery = 0; // пауза после удара: даёт персонажу шанс убежать

    this.play('Idle', 0);
  }

  get position() { return this.root.position; }

  get alive() { return this.state !== STATE.DEAD; }

  /** Чем он задевает предметы: телом такого радиуса и с такой скоростью. */
  get radius() { return CFG.bodyRadius; }

  /** Идёт ли он по следу: в этом состоянии обзор уже круговой. */
  get chasing() { return this.state === STATE.CHASE || this.state === STATE.ATTACK; }

  get speed() {
    if (this.state === STATE.CHASE) return CFG.speed;
    if (this.state === STATE.PATROL) return CFG.patrolSpeed;
    return 0; // стоит — только отодвигает предмет, не пинает
  }

  /**
   * Попадание. Первое сбивает с шага, последнее валит замертво.
   * @returns {boolean} убит ли этим выстрелом
   */
  takeDamage(amount = 1, from = null) {
    if (this.state === STATE.DEAD) return false;

    this.health -= amount;
    if (this.health <= 0) {
      this._enter(STATE.DEAD);
      return true;
    }

    // Выстрел поднимает тревогу, даже если стреляли в спину: зомби разворачивается
    // к источнику и после рывка пойдёт туда, а не продолжит прогулку.
    if (from) {
      this.alerted = true;
      this.yaw = Math.atan2(from.x - this.root.position.x, from.z - this.root.position.z);
      this.root.rotation.y = this.yaw;
    }

    // restart: попадание дёргает зомби заново, даже если он уже в этом состоянии
    this._enter(STATE.HURT, true);
    return false;
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

  /** Скрыт ли персонаж за чем-то высоким — домом, машиной, контейнером. */
  _hidden(player, location) {
    return location.sight.blocksLine(
      this.root.position.x, this.root.position.z, player.position.x, player.position.z
    );
  }

  /**
   * Держит ли зомби персонажа в секторе взгляда прямо сейчас — то самое пятно,
   * которое рисуется на земле: угол обзора, дальность и всё, что загораживает.
   *
   * `_toPlayer` здесь только читается: в погоне из него строится сам шаг.
   */
  _inSight(player, distance, location) {
    if (distance > CFG.loseRadius) return false;
    if (this._hidden(player, location)) return false;

    const forward =
      (Math.sin(this.yaw) * _toPlayer.x + Math.cos(this.yaw) * _toPlayer.z) / (distance || 1);

    return forward >= Math.cos((CFG.senseAngle * Math.PI) / 360);
  }

  /** Расстояние до персонажа по земле: высота не в счёт. */
  _distanceTo(player) {
    _toPlayer.subVectors(player.position, this.root.position).setY(0);
    return _toPlayer.length();
  }

  // ─── переходы ───────────────────────────────────────────────────────────────

  /**
   * Переход в состояние. Со `restart` можно войти в то же самое заново —
   * это нужно попаданиям: каждая пуля должна заново дёргать зомби, даже если
   * он ещё не отошёл от предыдущей.
   */
  _enter(state, restart = false) {
    if (state === this.state && !restart) return;
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
        this.chaseMoving = true;
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
        // Клип ставим принудительно: play() сам по себе не перезапустит тот же,
        // и вторая пуля подряд не была бы видна.
        this.play('ReactionHit', CFG.hurtFade);
        this.current.reset().play();
        this.current.timeScale = CFG.hurtSpeed;
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

  /** Бродит от точки к точке вокруг своего места, обходя препятствия. */
  _patrol(dt, distance, player, location, crowd) {
    if (this._sees(player, distance, location)) {
      this._enter(STATE.CHASE);
      return;
    }

    const position = this.root.position;

    _toPoint.subVectors(this.waypoint, position).setY(0);
    const left = _toPoint.length();

    if (left < CFG.waypointReached) {
      this._enter(STATE.IDLE); // пришёл — постоит и выберет новую точку
      return;
    }

    _toPoint.divideScalar(left);
    this._turnTo(Math.atan2(_toPoint.x, _toPoint.z), dt);

    _push.copy(_toPoint).multiplyScalar(CFG.patrolSpeed * dt);
    this._separate(_push, crowd, dt);

    // Куда шагаем — там должно быть свободно. Проверять только саму точку мало:
    // по дороге к ней может стоять стена, и зомби упирается в неё носом.
    const nextX = position.x + _push.x;
    const nextZ = position.z + _push.z;

    if (!location.nav.isFree(nextX, nextZ)) {
      this.stuckTime += dt;
      if (this.stuckTime > CFG.stuckFor) this._pickWaypoint(location);
      return;
    }

    position.set(nextX, position.y, nextZ);
    location.obstacles.resolve(position, CFG.radius);
    location.clampPosition(position);

    // Продвинулись ли мы на самом деле: выталкивание могло вернуть назад.
    const moved = Math.hypot(position.x - nextX + _push.x, position.z - nextZ + _push.z);
    if (moved < CFG.patrolSpeed * dt * 0.3) {
      this.stuckTime += dt;
      if (this.stuckTime > CFG.stuckFor) this._pickWaypoint(location);
    } else {
      this.stuckTime = 0;
    }
  }

  /**
   * Видит ли персонажа.
   *
   * Не радиусом, а взглядом: цель должна попасть в конус перед зомби. Со спины
   * к нему можно подойти незамеченным — но только до alertRadius, вплотную он
   * почует в любом случае. За стеной не видит вовсе.
   */
  _sees(player, distance, location) {
    if (!player.alive) return false;

    // подняли выстрелом — идёт на цель, пока та в пределах интереса
    if (this.alerted) return distance <= CFG.loseRadius;

    if (distance > CFG.senseRadius) return false;

    // Заслоняет обзор только то, что выше пояса: через дом и машину зомби
    // персонажа не увидит, а поверх бочки — вполне.
    if (this._hidden(player, location)) return false;

    if (distance <= CFG.alertRadius) return true; // так близко, что слышит

    // угол между взглядом и направлением на цель
    _toPlayer.divideScalar(distance || 1);
    const forward = Math.sin(this.yaw) * _toPlayer.x + Math.cos(this.yaw) * _toPlayer.z;
    return forward >= Math.cos((CFG.senseAngle * Math.PI) / 360);
  }

  /**
   * Новая точка для прогулки: рядом с домом, на свободном месте и с проходимой
   * дорогой туда. Проверять одну только точку мало — до неё ещё надо дойти.
   */
  _pickWaypoint(location) {
    this.stuckTime = 0;
    const from = this.root.position;

    for (let attempt = 0; attempt < 12; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = CFG.patrolRadius * (0.35 + Math.random() * 0.65);

      const x = this.home.x + Math.cos(angle) * radius;
      const z = this.home.z + Math.sin(angle) * radius;

      if (!location.nav.isFree(x, z)) continue;
      if (!location.nav.hasLineOfSight(from.x, from.z, x, z)) continue;

      this.waypoint.set(x, from.y, z);
      return;
    }

    // Свободной дороги вокруг нет — значит зомби зажат. Ищем любое свободное
    // место поблизости, лишь бы выбраться, а «дом» переносим туда же.
    for (let attempt = 0; attempt < 12; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const x = from.x + Math.cos(angle) * CFG.unstuckStep;
      const z = from.z + Math.sin(angle) * CFG.unstuckStep;

      if (!location.nav.isFree(x, z)) continue;

      this.waypoint.set(x, from.y, z);
      this.home.set(x, from.y, z);
      return;
    }
    this.waypoint.copy(from); // совсем некуда — постоит на месте
  }

  /** Медленно идёт к персонажу, обходя препятствия и расталкивая соседей. */
  _chase(dt, distance, player, location, crowd) {
    this.recovery = Math.max(0, this.recovery - dt);

    // Ушёл из сектора взгляда — за дом, за машину или просто вбок, за край
    // обзора — и зомби тут же бросает погоню: гнаться за тем, кого не видит,
    // он не умеет.
    if (!player.alive || !this._inSight(player, distance, location)) {
      this.alerted = false;
      this.home.copy(this.root.position); // потерял цель — бродит уже здесь
      this._pickWaypoint(location);
      this._enter(STATE.PATROL);
      return;
    }
    // Бить можно, только когда персонаж свободен: пока он схвачен чужим замахом
    // или доигрывает реакцию на удар, второй зомби ждёт своей очереди. Иначе он
    // машет вхолостую — урон в это время всё равно не проходит.
    // После собственного удара зомби ещё и переводит дух.
    if (distance <= CFG.attackRadius && this.recovery <= 0 && !player.helpless) {
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

    // Подойдя на дистанцию удара, зомби останавливается: дальше он бьёт, а не
    // толкается. Иначе после замаха он продолжал бы напирать и возить персонажа
    // по площадке, даже когда тот беспомощен.
    const room = Math.max(0, distance - CFG.attackRadius);

    // Дошёл и ждёт — значит стоит и дышит, а не перебирает ногами на месте.
    this._chaseMotion(room > CHASE_STEP_MIN);

    _push.copy(_step).multiplyScalar(Math.min(CFG.speed * dt, room));

    // Разбираться между собой толпа продолжает и в погоне. Без этого передние
    // слипаются в одну фигуру у персонажа, а как только погоня кончится и
    // расталкивание включится снова — их растащит рывком из общей точки.
    this._separate(_push, crowd, dt);
    if (_push.lengthSq() < 1e-10) return; // стоит вплотную и никем не зажат

    position.add(_push);

    // в модели и за забор зомби не лезут — те же правила, что и для персонажа
    location.obstacles.resolve(position, CFG.radius);
    location.clampPosition(position);
  }

  /**
   * Клип погони: бежит или стоит. Зомби, подошедший вплотную и ждущий своей
   * очереди на удар, должен стоять в стойке — бег на месте выдаёт анимацию,
   * оторванную от того, что персонаж видит.
   */
  _chaseMotion(moving) {
    if (moving === this.chaseMoving) return;
    this.chaseMoving = moving;

    if (moving) {
      this.play('Run', 0.2);
      this.current.timeScale = CFG.speed / CFG.runClipSpeed;
    } else {
      this.play('Idle', 0.2);
      this.current.timeScale = this.idleSpeed ?? 1;
    }
  }

  /** Бьёт, пока персонаж рядом. Урон приходится на середину замаха. */
  _attack(dt, distance, player) {
    this.attackTime += dt;

    // Во время замаха зомби стоит на месте: только доворачивается к цели.
    // Персонаж может обходить сбоку, но толкать его зомби не должен.
    this._turnTo(Math.atan2(_toPlayer.x, _toPlayer.z), dt);

    // Замах начался — персонаж схвачен и вырваться не может до самого удара.
    if (!this.hitDone) {
      player.pin(this.attackLength * CFG.hitAt - this.attackTime + CFG.pinGrace);
    }

    if (!this.hitDone && this.attackTime >= this.attackLength * CFG.hitAt) {
      this.hitDone = true;
      // бьём, только если цель всё ещё в досягаемости — иначе удар в воздух
      if (distance <= CFG.attackRadius + CFG.reach) player.takeDamage(CFG.damage, this.root.position);
      this.recovery = CFG.recoverFor; // дальше он переводит дух
    }

    if (this.attackTime < this.attackLength) return;

    // Замах закончился. Повторять сразу нельзя: персонажу нужна доля секунды,
    // чтобы отскочить, иначе его забивают насмерть без единого шанса.
    if (!player.alive) this._enter(STATE.IDLE);
    else this._enter(STATE.CHASE);
  }

  /** Сбит с шага: на миг замирает, потом снова идёт. */
  _hurt(dt, distance, player) {
    this.hurtTime += dt;
    if (this.hurtTime < this.hurtLength) return;

    if (player.alive && (this.alerted || distance <= CFG.loseRadius)) this._enter(STATE.CHASE);
    else this._enter(STATE.PATROL);
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
   *
   * Расхождение задано скоростью и умножается на кадр: при полном перекрытии
   * соседи расходятся плавно, а не отскакивают друг от друга рывком.
   */
  _separate(step, crowd, dt) {
    if (!crowd) return;
    const position = this.root.position;
    const limit = CFG.separationSpeed * dt;

    for (const other of crowd) {
      if (other === this || other.state === STATE.DEAD) continue;

      const dx = position.x - other.position.x;
      const dz = position.z - other.position.z;
      const gap = Math.hypot(dx, dz);
      if (gap >= CFG.separation || gap < 1e-4) continue;

      const force = (CFG.separation - gap) / CFG.separation;
      step.x += (dx / gap) * force * limit;
      step.z += (dz / gap) * force * limit;
    }
  }
}
