import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { batchSkinned } from '../world/batching.js';
import { arcPoint } from '../core/arc.js';

const CFG = CONFIG.player;

// пустой ввод: им подменяется стик, когда управление отобрано
const ZERO_MOVE = { x: 0, y: 0 };
const DEG = Math.PI / 180;

/**
 * Где в клипе прыжка персонаж отрывается от земли и где касается её снова.
 *
 * Смотрим на высоту бёдер: пока они на месте — он приседает перед толчком, пик
 * приходится на середину полёта, а возврат к исходной высоте и есть приземление.
 * Всё, что после, — уже пружинистое приседание, к полёту не относящееся.
 *
 * Так дуга и клип сходятся сами, без чисел, подобранных на глаз: поправят
 * анимацию в Blender — подстроится и полёт.
 *
 * @returns {{takeoff: number, landing: number}} секунды от начала клипа
 */
function jumpPhases(clip) {
  const hips = clip.tracks.find((t) => /hips/i.test(t.name) && t.name.endsWith('.position'));
  if (!hips || hips.times.length < 3) {
    return { takeoff: clip.duration * 0.15, landing: clip.duration * 0.7 };
  }

  const base = hips.values[1]; // высота бёдер в первом кадре — стойка
  let peak = base;
  for (let i = 0; i < hips.times.length; i++) peak = Math.max(peak, hips.values[i * 3 + 1]);

  const level = base + (peak - base) * CFG.jumpLiftShare;
  let takeoff = -1;
  let landing = -1;

  for (let i = 0; i < hips.times.length; i++) {
    if (hips.values[i * 3 + 1] <= level) continue;
    if (takeoff < 0) takeoff = hips.times[i];
    landing = hips.times[i];
  }

  if (takeoff < 0 || landing <= takeoff) {
    return { takeoff: clip.duration * 0.15, landing: clip.duration * 0.7 };
  }
  return { takeoff, landing };
}

/** Персонаж: модель, миксер анимаций и движение по земле. */
export class Player {
  constructor(gltf) {
    // семнадцать материалов персонажа сводятся к нескольким — по блеску и металлу
    this.root = batchSkinned(gltf.scene);
    this.root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });

    this._addGlow();

    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = new Map();
    for (const clip of gltf.animations) {
      if (clip.name.startsWith('Armature|')) continue; // служебный клип из mixamo-экспорта
      this.actions.set(clip.name, this.mixer.clipAction(clip));
    }

    const death = this.actions.get('Death');
    if (death) {
      death.setLoop(THREE.LoopOnce, 1);
      death.clampWhenFinished = true;
    }

    const reaction = this.actions.get('ReactionHit');
    this.reactionLength = CFG.reactionFor;
    if (reaction) {
      reaction.setLoop(THREE.LoopOnce, 1);
      reaction.clampWhenFinished = true;
      // клип длинный, а нужен короткий рывок — играем его быстрее
      this.reactionLength = reaction.getClip().duration / CFG.reactionSpeed;
    }

    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.current = null;

    const shoot = this.actions.get('Shoot');
    if (shoot) {
      shoot.setLoop(THREE.LoopOnce, 1);
      shoot.clampWhenFinished = true;
      this.shootLength = shoot.getClip().duration;
    }

    const toss = this.actions.get('Throw');
    this.throwLength = 0;
    if (toss) {
      toss.setLoop(THREE.LoopOnce, 1);
      toss.clampWhenFinished = true;
      // клип играется быстрее, значит и замах длится меньше своей записи
      this.throwLength = toss.getClip().duration / CFG.throwSpeed;
    }

    const jump = this.actions.get('Jump');
    this.jumpLanding = 0.6;   // когда в клипе он касается земли, с
    if (jump) {
      jump.setLoop(THREE.LoopOnce, 1);
      jump.clampWhenFinished = true;

      // Полёт начинается вместе с клипом, поэтому фаза отрыва не нужна: важно
      // только, где в анимации он касается земли — там дуга и кончается. Момент
      // касания берём с небольшим опережением: по клипу нога встаёт чуть раньше,
      // чем бёдра опускаются до исходной высоты.
      const landing = jumpPhases(jump.getClip()).landing * CFG.jumpLandShare;
      this.jumpLanding = landing / CFG.jumpSpeed;
    }

    this.lives = CFG.lives;

    // Ствол: он закреплён на кости руки и развёрнут относительно корпуса, поэтому
    // целиться поворотом корпуса «в лоб» нельзя — оружие будет смотреть мимо.
    this.gun = this.root.getObjectByName('Shotgun') ?? null;
    this.gunOnBack = this.root.getObjectByName('Shotgun_Back') ?? null;
    this._barrel = new THREE.Vector3();
    this._muzzle = new THREE.Vector3();
    this._hitPoint = new THREE.Vector3();
    this.effects = null; // росчерк и вспышка; ставится снаружи
    this.sfx = null;     // короткие звуки: выстрел и прочее
    this.puffs = null;   // пыль из-под ног; ставится снаружи
    this.stepPhase = 1;  // где мы были в прошлом кадре по циклу бега
    this.blood = null;     // зелёные брызги: его попадания по зомби
    this.ownBlood = null;  // красные: попадания по нему самому

    this._holdGun(false); // пока не стреляет, ружьё висит за спиной

    this.target = null;    // зомби, по которому идёт стрельба
    this.spotted = null;   // ближайший в радиусе огня — он же помечается отметкой
    this.shotPending = 0;  // сколько осталось до момента выстрела в клипе
    this.shootPlaying = 0; // сколько ещё идёт клип выстрела
    this.reloading = 0;    // пауза между выстрелами: в неё зомби и подходят
    this.jumpTime = 0;     // сколько уже длится прыжок, с; ноль — значит стоит на земле
    this.frozen = false;   // управление отобрано снаружи: звучит вступление
    this.throwing = null;  // идущий бросок: что в руке, в кого летит, сколько уже длится
    this.throwCooldown = 0; // пауза, чтобы он не хватал предметы очередью
    this._socket = this.root.getObjectByName('Socket_RightHand') ?? null;
    this._hand = new THREE.Vector3(); // точка выпуска: где рука в момент отпускания
    this._jumpFrom = new THREE.Vector3();
    this._jumpTo = new THREE.Vector3();

    this.reacting = 0;     // доигрывается реакция на попадание

    this.play('Idle', 0);

    this._desired = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
  }

  get position() { return this.root.position; }

  get alive() { return this.lives > 0; }

  /**
   * Управление отобрано: персонажа шатает от полученного удара. Только это —
   * замах зомби его больше не держит, иначе из кольца было бы не выбраться.
   */
  get helpless() { return this.reacting > 0; }

  /** Летит ли он сейчас через препятствие. */
  get jumping() { return this.jumpTime > 0; }

  /** Чем он задевает предметы — то же, что и у зомби, чтобы обходить их одним списком. */
  get radius() { return CFG.radius; }

  get speed() { return this.velocity.length(); }

  /**
   * Удар от зомби.
   *
   * @param {number} amount — сколько жизней снимает
   * @param {THREE.Vector3} [from] — откуда пришёл удар: в эту сторону брызги
   *
   * Доведённый до конца замах проходит всегда. Чем бы персонаж ни был занят —
   * стоял, побежал, начал стрелять, ещё не отошёл от прошлого удара, — всё это
   * обрывается, и реакция играется заново с первого кадра. Иначе удар, которого
   * игрок не смог избежать, пропадал впустую и выглядел как промах зомби.
   */
  takeDamage(amount = 1, from = null) {
    if (!this.alive) return;

    this.lives = Math.max(0, this.lives - amount);

    // брызги летят от того, кто ударил, — дальше сквозь персонажа
    this._hitPoint.copy(this.root.position).setY(this.root.position.y + CFG.hitHeight);
    this.ownBlood?.splash(this._hitPoint, from ?? this.root.position);

    if (!this.alive) {
      this._die();
      return;
    }

    // Реакцию персонаж доигрывает целиком: пока его шатает, он не бежит
    // и не стреляет — только потом решает, что делать дальше.
    this.reacting = this.reactionLength;
    this.velocity.set(0, 0, 0);
    this._holdFire();

    // Клип ставим принудительно: play() не перезапустит тот же самый, и второй
    // удар подряд не был бы виден — персонаж досматривал бы первую реакцию.
    this.play('ReactionHit', 0.08);
    this.current.reset().play();
    this.current.timeScale = CFG.reactionSpeed;
  }

  /**
   * Вернуть к жизни: уровень начинается заново, а модель у нас та же самая.
   * Пересоздавать её незачем — достаточно сбросить всё, что накопила прошлая
   * попытка, и снова поставить в стойку.
   */
  revive() {
    this._drop();
    this.throwCooldown = 0;
    this.lives = CFG.lives;
    this.reacting = 0;
    this.velocity.set(0, 0, 0);
    this.spotted = null;
    this.jumpTime = 0;
    this._holdFire();
    this._holdGun(false);
    this.play('Idle', 0);
    this.current.reset().play();
    this.current.timeScale = 1;
  }

  /**
   * Взять предмет в руку и замахнуться — физика предлагает, решает персонаж.
   *
   * Зовётся из физики в момент касания. Хватает он не всё и не всегда: нужен
   * зомби в радиусе огня, свободные руки и целый предмет, который не жалко
   * потерять. Бочка не в счёт — она не снаряд, а мишень: её взрывают выстрелом,
   * и носить её в руках значило бы таскать с собой собственную смерть.
   *
   * @param {object} item — тело из физики
   * @param {import('./Debris.js').Debris} debris
   * @returns {boolean} взял ли — если нет, физика просто отпинёт предмет
   */
  grab(item, debris) {
    if (this.throwing || this.throwCooldown > 0) return false;
    if (!this.alive || this.frozen || this.jumping || this.helpless || this.reacting > 0) return false;
    if (!this._socket || this.throwLength <= 0) return false;
    if (item.explosive) return false;

    // Кидать имеет смысл только в кого-то: это тот же, кого он держит на прицеле.
    const target = this.spotted;
    if (!target?.alive) return false;

    // Берётся за проп он ближе, чем стреляет. Доля от радиуса огня, а не своё
    // число: у самой границы выстрела бросок не долетал бы, и на краю прицела
    // персонаж вместо стрельбы принимался бы возиться с ящиком.
    const reach = CFG.fireRange * CFG.throwRange;
    const away = Math.hypot(
      target.position.x - this.root.position.x,
      target.position.z - this.root.position.z
    );
    if (away > reach) return false;

    debris.hold(item);

    // Предмет переезжает на сокет правой руки — туда же, где висит ружьё, —
    // и дальше его возит анимация, а не физика.
    const home = item.object.parent;
    this._socket.add(item.object);
    item.object.position.fromArray(CFG.throwHold);
    item.object.quaternion.identity();

    this.throwing = { item, debris, home, target, time: 0, released: false };

    this._holdFire();
    this._holdGun(false); // руки заняты предметом — ружьё за спиной
    this.velocity.set(0, 0, 0);

    this.play('Throw', 0.1);
    this.current.reset().play();
    this.current.timeScale = CFG.throwSpeed;
    return true;
  }

  /**
   * Ход броска: доворот к цели, момент отпускания, конец клипа.
   *
   * Момент отпускания взят долей клипа, а не таймером: анимацию можно ускорить
   * или замедлить, и предмет всё равно уйдёт ровно тогда, когда рука его
   * выпускает, — как и топот берётся из цикла бега, а не из секундомера.
   */
  _throwStep(dt) {
    const toss = this.throwing;
    toss.time += dt;

    // корпус доворачивается к цели прямо на замахе: кидают в того, кого выбрали
    if (toss.target?.alive) {
      const to = Math.atan2(
        toss.target.position.x - this.root.position.x,
        toss.target.position.z - this.root.position.z
      );
      this._turnTo(to, CFG.turnSpeed, dt);
    }

    if (!toss.released && toss.time >= this.throwLength * CFG.throwRelease) this._release();
    if (toss.time < this.throwLength) return;

    this.throwing = null;
    this.throwCooldown = CFG.throwCooldown;
  }

  /** Рука разжалась: предмет возвращается в мир и уходит в цель. */
  _release() {
    const toss = this.throwing;
    const { item, debris, home } = toss;
    toss.released = true;

    // Точка вылета — там, где сейчас рука. `attach` возвращает предмет в мир,
    // не сдвинув его с места: он продолжает лететь ровно оттуда, где был.
    item.object.getWorldPosition(this._hand);
    home.attach(item.object);

    // Звук — здесь, вместе с самим вылетом, а не при начале замаха: до этого
    // момента бросок ещё можно оборвать, и раньше остался бы хэканье без броска.
    this.sfx?.play('throw', CONFIG.sounds.volume * CFG.throwVolume);

    // Цель могли убить, пока шёл замах, — тогда предмет уходит просто вперёд.
    let dirX = Math.sin(this.yaw);
    let dirZ = Math.cos(this.yaw);

    if (toss.target?.alive) {
      const dx = toss.target.position.x - this._hand.x;
      const dz = toss.target.position.z - this._hand.z;
      const length = Math.hypot(dx, dz);
      if (length > 1e-4) {
        dirX = dx / length;
        dirZ = dz / length;
      }
    }

    debris.launch(
      item, dirX, dirZ,
      CFG.throwPower, CFG.throwLift, CFG.throwSpin,
      this, CFG.throwGrace
    );
  }

  /**
   * Уронить то, что в руке, где стоим.
   *
   * Нужно на смерти и на перезапуске: иначе предмет остаётся висеть на кости и
   * уезжает вместе с персонажем через всю карту.
   */
  _drop() {
    if (!this.throwing) return;

    const { item, debris, home, released } = this.throwing;
    this.throwing = null;

    if (released) return; // уже улетел, возвращать нечего

    home.attach(item.object);
    debris.launch(item, 0, 0, 0, 0, 0, this, CFG.throwGrace);
  }

  _die() {
    this._drop();
    this.velocity.set(0, 0, 0);

    // Крик идёт вместе с началом падения. Расстоянием он не приглушается, в
    // отличие от голосов зомби: это свой персонаж, он всегда в двух шагах.
    this.sfx?.play('playerDie', CONFIG.sounds.volume * CFG.dieVolume);

    this.play('Death', 0.15);
    this.current.reset().play();
    this.current.timeScale = 1;
  }

  /** Ставит персонажа в точку старта локации, гася движение. */
  placeAt(position, yaw = 0) {
    this._drop(); // унести предмет в руке на другой конец карты нельзя
    this.root.position.copy(position);
    this.yaw = yaw;
    this.root.rotation.y = yaw;
    this.velocity.set(0, 0, 0);
    if (this.alive) this.play('Idle', 0);
  }

  /**
   * Круг света вокруг персонажа.
   *
   * Висит на нём самом, поэтому ездит следом без единой строчки в кадре. Теней
   * не бросает намеренно: источник находится внутри фигуры, и любая тень от него
   * легла бы от её же ног во все стороны. Вторая карта теней вдобавок стоила бы
   * кадра — а нужен здесь только свет.
   */
  _addGlow() {
    const GLOW = CONFIG.glow;

    const light = new THREE.PointLight(GLOW.color, GLOW.intensity, GLOW.distance, GLOW.decay);
    light.name = 'playerGlow';
    light.position.set(0, GLOW.height, 0);
    light.castShadow = false;

    this.root.add(light);
    this.glow = light;
  }

  /**
   * Шаги: звук и пыль ровно тогда, когда нога касается земли.
   *
   * Момент берётся не из таймера, а из самой анимации: мы смотрим, где сейчас
   * клип бега, и ловим переход через отметки, на которые приходятся касания. За
   * цикл их две — левая и правая нога. Поэтому топот совпадает с ногами при
   * любой скорости бега и не расходится с картинкой, как расходился цикл.
   */
  _steps(running) {
    if (!running || this.current !== this.actions.get('Run')) {
      this.stepPhase = 1; // встал — следующий шаг начнётся с начала цикла
      return;
    }

    const clip = this.current.getClip();
    const phase = (this.current.time % clip.duration) / clip.duration;

    for (const at of CFG.stepPhases) {
      // отметку прошли, если она между прошлым кадром и нынешним
      const crossed = this.stepPhase < phase
        ? at > this.stepPhase && at <= phase
        : at > this.stepPhase || at <= phase; // цикл начался заново

      if (!crossed) continue;

      this.sfx?.play('walk', CONFIG.sounds.volume * CFG.stepVolume);
      this.puffs?.burst(this.root.position);
      break;
    }

    this.stepPhase = phase;
  }

  /** Плавно переключает анимацию, если она ещё не играет. */
  play(name, fade = 0.2) {
    const next = this.actions.get(name);
    if (!next || next === this.current) return;
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (this.current) this.current.fadeOut(fade);
    this.current = next;
  }

  /**
   * @param {number} dt
   * @param {THREE.Vector2} move — ввод: x вбок, y вперёд, длина 0..1
   * @param {number} cameraYaw — направление камеры, чтобы «вперёд» было от камеры
   */
  /**
   * @param {number} dt
   * @param {THREE.Vector2} move — ввод: x вбок, y вперёд, длина 0..1
   * @param {number} cameraYaw — направление камеры
   * @param {import('../world/Location.js').Location} [location] — цели и препятствия
   */
  update(dt, move, cameraYaw, location) {
    if (this.reacting > 0) this.reacting -= dt;

    // мёртвый не управляется: доигрывает падение и остаётся лежать
    if (!this.alive) {
      this.velocity.set(0, 0, 0);
      this.spotted = null; // и никого больше не держит на прицеле
      this.sfx?.loop('walk', false);
      this.mixer.update(dt);
      return;
    }

    // Бросок: пока идёт замах, персонаж стоит и ничем другим не занят — ни
    // бежит, ни стреляет. Предмет в это время едет в руке вместе с анимацией.
    if (this.throwing) {
      this._throwStep(dt);
      this.mixer.update(dt);
      return;
    }
    if (this.throwCooldown > 0) this.throwCooldown -= dt;

    // в полёте управление отобрано: траектория уже задана, менять её нечем
    if (this.jumping) {
      this.sfx?.loop('walk', false); // в воздухе ногами не топают
      this._flyOver(dt, move);
      this.mixer.update(dt);
      return;
    }

    // «вперёд» — от камеры к персонажу, «вправо» — векторное произведение forward × up
    this._forward.set(Math.sin(cameraYaw), 0, Math.cos(cameraYaw));
    this._right.set(-this._forward.z, 0, this._forward.x);

    // Управление могут отобрать снаружи — пока звучит вступление. Ввод при этом
    // до персонажа не доходит вовсе: он не идёт и не стреляет, а стоит и слушает.
    const stick = this.frozen ? ZERO_MOVE : move;

    // Стик задаёт только направление: длина отклонения на скорость не влияет,
    // иначе на промежуточных положениях ручки персонаж плёлся бы медленнее.
    this._desired
      .set(0, 0, 0)
      .addScaledVector(this._forward, stick.y)
      .addScaledVector(this._right, stick.x);

    if (this._desired.lengthSq() > 0) this._desired.normalize().multiplyScalar(CFG.runSpeed);

    // Под ударом персонаж не управляется: пока его шатает, он никуда не идёт.
    if (this.helpless) this._desired.set(0, 0, 0);

    // Упёрся в машину на ходу — перепрыгнул. Проверяем до движения: иначе он
    // сначала встанет в неё носом, и прыжок начнётся уже из стенки.
    if (this._desired.lengthSq() > 0 && !this.helpless && location
        && this._tryVault(location)) {
      this.mixer.update(dt);
      return;
    }

    // ни разгона, ни выбега — скорость появляется и пропадает мгновенно
    this.velocity.copy(this._desired);

    const speed = this.velocity.length();
    this.root.position.addScaledVector(this.velocity, dt);

    this._steps(speed > 0);

    // корпус доворачивается к направлению движения по кратчайшей дуге
    if (speed > 0) {
      const target = Math.atan2(this.velocity.x, this.velocity.z);
      this._turnTo(target, CFG.turnSpeed, dt);
    }

    // Кого персонаж держит на прицеле — считаем всегда, даже на бегу: по этому
    // зомби рисуется отметка, и видно, кто уже попал под выстрел, ещё до того,
    // как остановишься.
    this.spotted = location ? this._pickTarget(location) : null;

    // Стрелять можно только стоя. Проверяем сам ввод, а не скорость: на кадре
    // отпускания стика скорость ещё старая, и выстрел терялся бы до следующего.
    const standing = this._desired.lengthSq() === 0;
    const canShoot = standing && location && !this.helpless && !this.frozen;
    const shooting = canShoot ? this._aimAndFire(dt, location) : this._holdFire();

    // ружьё либо в руках, либо за спиной — одновременно видно только одно
    this._holdGun(shooting);

    if (this.reacting > 0) {
      // доигрывает попадание: анимацию не трогаем, иначе оборвётся на первом кадре
    } else if (!shooting) {
      if (speed > 0) {
        this.play('Run', 0.15);
        // темп клипа под скорость бега, чтобы стопы не скользили
        this.current.timeScale = CFG.runSpeed / CFG.runClipSpeed;
      } else {
        // короткий переход: персонаж должен вставать сразу, как отпустили стик
        this.play('Idle', CFG.stopFade);
        this.current.timeScale = 1;
      }
    }

    this.mixer.update(dt);
  }

  /**
   * Поворот корпуса с постоянной скоростью, по кратчайшей дуге.
   * Линейно: доворачивается ровно до цели и останавливается.
   */
  _turnTo(target, speed, dt) {
    let delta = target - this.yaw;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));

    const step = speed * dt;
    this.yaw += Math.abs(delta) <= step ? delta : Math.sign(delta) * step;
    this.root.rotation.y = this.yaw;
  }

  /**
   * Автоприцел и стрельба.
   *
   * Цель ищется заново каждый кадр — всегда ближайший живой зомби на линии огня.
   * Так прицел перехватывает того, кто подошёл ближе, прямо посреди стрельбы, и не
   * ждёт, пока игрок отпустит стик. Выстрелы идут один за другим: как только клип
   * доиграл, персонаж стреляет снова, пока есть по кому. Стойка включается,
   * только когда целей не осталось.
   *
   * @returns {boolean} есть ли цель — то есть занят ли персонаж стрельбой
   */
  _aimAndFire(dt, location) {
    // прицел пересматривается каждый кадр: ближе подошёл — по нему и стреляем
    this.target = this.spotted;

    if (!this.target) {
      this.shotPending = 0;
      this.shootPlaying = 0;
      this.reloading = 0; // целей нет — перезарядка ни к чему, следующая встреча начнётся с выстрела
      return false;
    }

    this._aimGunAt(this.target.position);

    // пуля уходит не в первый кадр анимации, а когда персонаж вскинул ружьё
    if (this.shotPending > 0) {
      this.shotPending -= dt;
      if (this.shotPending <= 0) this._fire(location);
    }

    // клип выстрела идёт — не трогаем его, иначе оборвётся на первом кадре
    if (this.shootPlaying > 0) {
      this.shootPlaying -= dt;
      return true;
    }

    // Пауза между выстрелами: персонаж перезаряжается и стоит открытым.
    // Именно в это окно зомби успевают подойти вплотную и ударить.
    if (this.reloading > 0) {
      this.reloading -= dt;
      this.play('Idle', CFG.stopFade);
      this.current.timeScale = 1;
      return true;
    }

    // цель есть и перезарядка кончилась — стреляем
    this.play('Shoot', 0.08);
    this.current.reset().play();
    this.current.timeScale = CFG.shootSpeed;

    this.shotPending = CFG.shotDelay;
    this.shootPlaying = this.shootLength / CFG.shootSpeed;
    this.reloading = CFG.reloadFor; // пауза отсчитывается после клипа, а не вместе с ним
    return true;
  }

  /**
   * Пробует перепрыгнуть то, во что персонаж упёрся.
   *
   * Решает не сам прыжок, а локация: она знает габариты предметов и отдаёт точку
   * приземления за препятствием — или ничего, если оно слишком высокое, слишком
   * широкое или садиться за ним некуда.
   *
   * @returns {boolean} начался ли прыжок
   */
  _tryVault(location) {
    const dirX = this._desired.x / CFG.runSpeed;
    const dirZ = this._desired.z / CFG.runSpeed;

    const landing = location.vaultTarget(this.root.position, dirX, dirZ, CFG.radius);
    if (!landing) return false;

    this._jumpFrom.copy(this.root.position);
    this._jumpTo.set(landing.x, this.root.position.y, landing.z);

    this.jumpTime = 1e-6; // уже в воздухе: дуга идёт с первого кадра клипа
    this.velocity.set(0, 0, 0);
    this._holdFire();
    this._holdGun(false); // в прыжке ружьё за спиной, руки заняты

    this._turnTo(Math.atan2(dirX, dirZ), CFG.turnSpeed * 8, 1); // сразу лицом по ходу

    // Звук — вместе с отрывом от земли: дальше прыжок уже не отменить, и он
    // всегда совпадёт с началом клипа, как бы тот ни был ускорен.
    this.sfx?.play('jump', CONFIG.sounds.volume * CFG.jumpVolume);

    this.play('Jump', 0.08);
    this.current.reset().play();
    this.current.timeScale = CFG.jumpSpeed;
    return true;
  }

  /**
   * Полёт по дуге, заведённый на сам клип прыжка.
   *
   * Дуга стартует вместе с первым кадром клипа и кончается там, где в анимации
   * он касается земли. Приседание в хвосте полётом уже не считается — на касании
   * состояние заканчивается, и дальше персонаж либо бежит, либо встаёт.
   */
  _flyOver(dt, move) {
    this.jumpTime += dt;

    const share = Math.max(0, Math.min(1, this.jumpTime / this.jumpLanding));
    arcPoint(this.root.position, this._jumpFrom, this._jumpTo, share, CFG.jumpArc);

    if (this.jumpTime < this.jumpLanding) return;

    // коснулся земли: дальше он либо бежит, либо встаёт — смотря держат ли стик
    this.jumpTime = 0;
    this.root.position.copy(this._jumpTo);

    if (move.lengthSq() > 0) {
      this.play('Run', 0.1);
      this.current.timeScale = CFG.runSpeed / CFG.runClipSpeed;
    } else {
      this.play('Idle', CFG.stopFade);
      this.current.timeScale = 1;
    }
  }

  /**
   * Разворачивает персонажа так, чтобы на цель смотрел ствол, а не корпус.
   *
   * Оружие висит на кости правой руки и в каждой позе развёрнуто по-своему:
   * в стойке ствол уходит вбок почти на 54°. Поэтому считаем, куда он смотрит
   * сейчас, и поворачиваем корпус ровно на разницу с направлением на цель.
   *
   * Доворот мгновенный, без плавного схождения. Плавный отставал: выстрел уходил
   * раньше, чем корпус успевал встать, и росчерк шёл к зомби, а дуло в это время
   * смотрело в сторону. Стрелять персонаж может только стоя, так что резкого
   * разворота на бегу тут всё равно не увидеть.
   */
  _aimGunAt(target) {
    const from = this.root.position;
    const wanted = Math.atan2(target.x - from.x, target.z - from.z);

    this._setYaw(wanted - this._barrelOffset());
  }

  /** Ставит поворот корпуса разом и в поле, и в саму модель. */
  _setYaw(yaw) {
    this.yaw = yaw;
    this.root.rotation.y = yaw;
  }

  /** Куда смотрит ствол в мировых осях. */
  _barrelAngle() {
    if (!this.gun) return this.yaw;

    this.gun.updateWorldMatrix(true, false);
    this._barrel.set(1, 0, 0).transformDirection(this.gun.matrixWorld).setY(0);
    if (this._barrel.lengthSq() < 1e-6) return this.yaw;

    this._barrel.normalize();
    return Math.atan2(this._barrel.x, this._barrel.z);
  }

  /** На сколько ствол развёрнут относительно корпуса прямо сейчас. */
  _barrelOffset() {
    // ствол идёт вдоль локальной оси X оружия, дуло в сторону +X
    return this.gun ? this._barrelAngle() - this.yaw : 0;
  }

  /** Достаёт ружьё в руки или убирает за спину. */
  _holdGun(inHands) {
    if (this.gun) this.gun.visible = inHands;
    if (this.gunOnBack) this.gunOnBack.visible = !inHands;
  }

  /** Сбрасывает прицел, когда персонаж побежал. */
  /**
   * Сбрасывает всё, что связано со стрельбой: прицел, недоигранный клип и паузу.
   *
   * Важно гасить и `shootPlaying`: иначе после бега остаётся хвост прошлого
   * выстрела, и персонаж, остановившись, сначала «доигрывает» его вхолостую —
   * со стороны выглядит, будто он просто стоит и не стреляет.
   */
  _holdFire() {
    this.target = null;
    this.shotPending = 0;
    this.shootPlaying = 0;
    this.reloading = 0;
    return false;
  }

  /**
   * Ближайший живой зомби в радиусе огня, до которого долетит пуля.
   * Куда персонаж смотрит — неважно: он сам довернётся к тому, кого выбрал.
   */
  _pickTarget(location) {
    const from = this.root.position;
    let best = null;
    let bestDistance = CFG.fireRange;

    for (const zombie of location.zombies) {
      if (!zombie.alive) continue;

      const distance = Math.hypot(zombie.position.x - from.x, zombie.position.z - from.z);
      if (distance >= bestDistance) continue;

      // сквозь дом или машину не стреляем
      if (location.obstacles.blocksLine(from.x, from.z, zombie.position.x, zombie.position.z)) continue;

      best = zombie;
      bestDistance = distance;
    }
    return best;
  }

  /**
   * Выстрел: веер из нескольких пуль, и каждая прошивает всех, кто на её пути.
   *
   * Средняя уходит точно в выбранную цель — по ней персонаж и целился. Боковые
   * расходятся на `spreadAngle` в стороны. Ни одна не останавливается на первом
   * попавшемся: пуля летит на всю дальность огня и достаётся каждому, кого
   * задела. В плотной толпе один выстрел прошивает нескольких сразу.
   */
  _fire(location) {
    const zombie = this.target;
    if (!zombie || !zombie.alive) return;

    const from = this.root.position;
    if (Math.hypot(zombie.position.x - from.x, zombie.position.z - from.z) > CFG.fireRange) return;

    // Звук — здесь, вместе с самой пулей, а не при запуске анимации. Между ними
    // проходит `shotDelay`, и за это время выстрел могут отменить: персонажа
    // ударили или он снова побежал. Тогда раньше оставался хлопок без выстрела.
    this.sfx?.play('fire', CONFIG.sounds.volume * CFG.fireVolume);

    // Откуда вылетает пуля.
    //
    // Обычно — из дула, и летит вдоль ствола: так росчерк совпадает с оружием.
    // Но вплотную это ломается. Дуло вынесено вперёд почти на метр, и зомби,
    // подошедший ближе этого, оказывается ПОЗАДИ дула: ствол смотрит вперёд,
    // а цель сбоку — выстрел выглядит уходящим в никуда. В упор стреляем от
    // груди прямо в цель: линия короткая и честная.
    const reach = Math.hypot(zombie.position.x - from.x, zombie.position.z - from.z);
    const pointBlank = reach < CFG.muzzleOffset * CFG.pointBlank;

    const muzzle = pointBlank
      ? this._muzzle.copy(from).setY(from.y + CFG.hitHeight)
      : this._muzzlePoint();

    // Целимся из дула прямо в зомби, а не «вдоль ствола».
    //
    // Ствол вынесен вбок, и его направление не совпадает с линией на цель: на
    // восьми метрах расхождение около двух градусов, на двух — уже четырнадцать.
    // Пуля при этом попадала, а росчерк уходил мимо — со стороны выглядело, будто
    // персонаж бьёт в сторону. Линия должна показывать, куда правда летит пуля.
    const base = Math.atan2(zombie.position.x - muzzle.x, zombie.position.z - muzzle.z);

    const middle = (CFG.pellets - 1) / 2;

    // Докуда чертить пулю, никого не встретившую. На всю дальность нельзя: в упор
    // боковые пули веера почти всегда мимо, и десятиметровые росчерки разлетались
    // бы веером в стороны, будто персонаж палит куда попало. Тянем чуть дальше
    // цели — тогда промах виден, но не спорит с тем, куда он на самом деле целил.
    const range = Math.min(
      CFG.fireRange,
      Math.hypot(zombie.position.x - muzzle.x, zombie.position.z - muzzle.z) * CFG.missReach
    );

    for (let i = 0; i < CFG.pellets; i++) {
      const angle = base + (i - middle) * CFG.spreadAngle * DEG;
      const dirX = Math.sin(angle);
      const dirZ = Math.cos(angle);

      // Средняя пуля всегда достаёт того, кого персонаж взял на прицел.
      //
      // Без этого вблизи выходил систематический промах: корпус доворачивается
      // так, чтобы ствол смотрел на цель ИЗ ЦЕНТРА фигуры, а пуля летит из дула,
      // вынесенного вбок почти на полметра. На десяти метрах эта разница —
      // считаные сантиметры, а в упор она больше ширины тела, и зомби, бегущий
      // по пятам, оставался цел при выстреле в упор.
      const victim = i === middle
        ? zombie
        : this._pelletHit(location, muzzle, dirX, dirZ);

      // Докуда пуля вообще долетела: до того, в кого попала, иначе — сколько
      // прочертила. Дальше этого она никого и ничего задеть не может.
      const flight = victim
        ? Math.hypot(victim.position.x - muzzle.x, victim.position.z - muzzle.z)
        : range;

      // Бочка на пути детонирует. Ищем её только в пределах полёта: раньше
      // поиск шёл на всю дальность огня, и боковая пуля веера подрывала бочку
      // далеко в стороне — там, куда персонаж вовсе не целился.
      const barrels = location?.debris.explosivesAlong(muzzle, dirX, dirZ, flight) ?? [];
      for (const barrel of barrels) location.explode(barrel, this);

      // росчерк обрывается на том, в кого попали, — или тянется в пустоту
      if (victim) {
        this._hitPoint.copy(victim.position).setY(victim.position.y + CFG.hitHeight);
      } else {
        this._hitPoint.set(muzzle.x + dirX * range, muzzle.y, muzzle.z + dirZ * range);
      }
      this.effects?.fire(muzzle, this._hitPoint);

      if (!victim) continue;

      this.blood?.splash(this._hitPoint, muzzle); // капли летят дальше по ходу пули
      victim.takeDamage(CFG.shotDamage, from);
    }
  }

  /**
   * Кого задевает одна пуля: ближайший к дулу зомби на её пути.
   *
   * Именно ближайший, а не все подряд: пуля вязнет в первом же теле, и стоящие
   * за ним прикрыты — иначе один выстрел вдоль строя валил бы половину шеренги.
   *
   * Толщина пути — ширина тела: пуля не нитка, и мазать на полметра ей незачем.
   * Стену она не берёт: до зомби проверяется, свободна ли линия огня, и закрытые
   * машиной или домом не считаются.
   */
  _pelletHit(location, muzzle, dirX, dirZ) {
    if (!location) return null;

    const from = this.root.position;
    let best = null;
    let bestAlong = CFG.fireRange;

    for (const other of location.zombies) {
      if (!other.alive) continue; // взрыв мог убрать его прямо этим выстрелом

      const ox = other.position.x - muzzle.x;
      const oz = other.position.z - muzzle.z;

      const along = ox * dirX + oz * dirZ;          // сколько по лучу до него
      if (along <= 0 || along >= bestAlong) continue;

      const aside = Math.abs(ox * dirZ - oz * dirX); // и насколько он в стороне
      if (aside > CONFIG.zombies.bodyRadius) continue;

      if (location.obstacles.blocksLine(from.x, from.z, other.position.x, other.position.z)) continue;

      best = other;
      bestAlong = along; // дальше этого искать незачем: пуля остановится здесь
    }
    return best;
  }

  /** Точка дула в мировых координатах: конец ствола оружия в руке. */
  _muzzlePoint() {
    if (!this.gun) return this._muzzle.copy(this.root.position).setY(this.root.position.y + CFG.hitHeight);

    this.gun.updateWorldMatrix(true, false);
    return this._muzzle.set(CFG.muzzleOffset, 0, 0).applyMatrix4(this.gun.matrixWorld);
  }
}
