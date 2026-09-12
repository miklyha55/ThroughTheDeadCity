import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { batchSkinned } from '../world/batching.js';

const CFG = CONFIG.player;

/** Персонаж: модель, миксер анимаций и движение по земле. */
export class Player {
  constructor(gltf) {
    // семнадцать материалов персонажа сводятся к нескольким — по блеску и металлу
    this.root = batchSkinned(gltf.scene);
    this.root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false; // скиннинг ломает bounding box в bind-позе
      }
    });

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

    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.current = null;

    const shoot = this.actions.get('Shoot');
    if (shoot) {
      shoot.setLoop(THREE.LoopOnce, 1);
      shoot.clampWhenFinished = true;
      this.shootLength = shoot.getClip().duration;
    }

    this.lives = CFG.lives;
    this.invulnerable = 0; // пока идёт, удары не засчитываются

    // Ствол: он закреплён на кости руки и развёрнут относительно корпуса, поэтому
    // целиться поворотом корпуса «в лоб» нельзя — оружие будет смотреть мимо.
    this.gun = this.root.getObjectByName('Shotgun') ?? null;
    this.gunOnBack = this.root.getObjectByName('Shotgun_Back') ?? null;
    this._barrel = new THREE.Vector3();

    this._holdGun(false); // пока не стреляет, ружьё висит за спиной

    this.target = null;    // зомби на прицеле, держится до его смерти
    this.shotPending = 0;  // сколько осталось до момента выстрела в клипе
    this.shootPlaying = 0; // сколько ещё идёт клип выстрела

    this.play('Idle', 0);

    this._desired = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
  }

  get position() { return this.root.position; }

  get alive() { return this.lives > 0; }

  /**
   * Удар от зомби.
   *
   * После попадания персонаж ненадолго неуязвим: иначе трое подошедших зомби
   * снимут все жизни в один кадр, и умирать он будет мгновенно и непонятно.
   */
  takeDamage(amount = 1) {
    if (!this.alive || this.invulnerable > 0) return;

    this.lives = Math.max(0, this.lives - amount);
    this.invulnerable = CFG.invulnerableFor;

    if (this.alive) this.play('ReactionHit', 0.1);
    else this._die();
  }

  _die() {
    this.velocity.set(0, 0, 0);
    this.play('Death', 0.15);
    this.current.reset().play();
    this.current.timeScale = 1;
  }

  /** Ставит персонажа в точку старта локации, гася движение. */
  placeAt(position, yaw = 0) {
    this.root.position.copy(position);
    this.yaw = yaw;
    this.root.rotation.y = yaw;
    this.velocity.set(0, 0, 0);
    if (this.alive) this.play('Idle', 0);
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
    if (this.invulnerable > 0) this.invulnerable -= dt;

    // мёртвый не управляется: доигрывает падение и остаётся лежать
    if (!this.alive) {
      this.velocity.set(0, 0, 0);
      this.mixer.update(dt);
      return;
    }

    // «вперёд» — от камеры к персонажу, «вправо» — векторное произведение forward × up
    this._forward.set(Math.sin(cameraYaw), 0, Math.cos(cameraYaw));
    this._right.set(-this._forward.z, 0, this._forward.x);

    // Стик задаёт только направление: длина отклонения на скорость не влияет,
    // иначе на промежуточных положениях ручки персонаж плёлся бы медленнее.
    this._desired
      .set(0, 0, 0)
      .addScaledVector(this._forward, move.y)
      .addScaledVector(this._right, move.x);

    if (this._desired.lengthSq() > 0) this._desired.normalize().multiplyScalar(CFG.runSpeed);

    // ни разгона, ни выбега — скорость появляется и пропадает мгновенно
    this.velocity.copy(this._desired);

    const speed = this.velocity.length();
    this.root.position.addScaledVector(this.velocity, dt);

    // корпус доворачивается к направлению движения по кратчайшей дуге
    if (speed > 0) {
      const target = Math.atan2(this.velocity.x, this.velocity.z);
      this._turnTo(target, CFG.turnSpeed, dt);
    }

    // Стрелять можно только стоя: чтобы выстрелить, надо остановиться.
    const shooting = speed === 0 && location ? this._aimAndFire(dt, location) : this._holdFire();

    // ружьё либо в руках, либо за спиной — одновременно видно только одно
    this._holdGun(shooting);

    // пока играет реакция на удар, бег и стойку не включаем — иначе её не видно
    const reacting = this.current === this.actions.get('ReactionHit')
      && this.invulnerable > CFG.invulnerableFor - CFG.reactionFor;

    if (!reacting && !shooting) {
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
   * Цель захватывается и удерживается, пока она жива, в пределах дальности и на
   * линии огня, — прицел не скачет между зомби каждый кадр. Выстрелы идут один за
   * другим без пауз: как только клип доиграл, персонаж стреляет снова, пока есть
   * по кому. Стойка включается, только когда целей не осталось.
   *
   * @returns {boolean} есть ли цель — то есть занят ли персонаж стрельбой
   */
  _aimAndFire(dt, location) {
    // прежняя цель в приоритете; новую ищем, только если эта больше не годится
    if (!this._targetUsable(this.target, location)) this.target = this._pickTarget(location);

    if (!this.target) {
      this.shotPending = 0;
      this.shootPlaying = 0;
      return false;
    }

    this._aimGunAt(this.target.position, dt);

    // пуля уходит не в первый кадр анимации, а когда персонаж вскинул ружьё
    if (this.shotPending > 0) {
      this.shotPending -= dt;
      if (this.shotPending <= 0) this._fire();
    }

    // клип выстрела идёт — не трогаем его, иначе оборвётся на первом кадре
    if (this.shootPlaying > 0) {
      this.shootPlaying -= dt;
      return true;
    }

    // клип доиграл, а цель ещё есть — стреляем снова, без паузы и без стойки
    this.play('Shoot', 0.08);
    this.current.reset().play();
    this.current.timeScale = CFG.shootSpeed;

    this.shotPending = CFG.shotDelay;
    this.shootPlaying = this.shootLength / CFG.shootSpeed;
    return true;
  }

  /**
   * Доворачивает персонажа так, чтобы на цель смотрел ствол, а не корпус.
   *
   * Оружие висит на кости правой руки и в каждой позе развёрнуто по-своему:
   * в стойке ствол уходит вбок почти на 54°. Поэтому считаем, куда он смотрит
   * сейчас, и поворачиваем корпус ровно на разницу с направлением на цель.
   */
  _aimGunAt(target, dt) {
    const from = this.root.position;
    const wanted = Math.atan2(target.x - from.x, target.z - from.z);

    this._turnTo(wanted - this._barrelOffset(), CFG.aimTurnSpeed, dt);
  }

  /** На сколько ствол развёрнут относительно корпуса прямо сейчас. */
  _barrelOffset() {
    if (!this.gun) return 0;

    this.gun.updateWorldMatrix(true, false);

    // ствол идёт вдоль локальной оси X оружия, дуло в сторону +X
    this._barrel.set(1, 0, 0).transformDirection(this.gun.matrixWorld).setY(0);
    if (this._barrel.lengthSq() < 1e-6) return 0;

    this._barrel.normalize();
    return Math.atan2(this._barrel.x, this._barrel.z) - this.yaw;
  }

  /** Достаёт ружьё в руки или убирает за спину. */
  _holdGun(inHands) {
    if (this.gun) this.gun.visible = inHands;
    if (this.gunOnBack) this.gunOnBack.visible = !inHands;
  }

  /** Сбрасывает прицел, когда персонаж побежал. */
  _holdFire() {
    this.target = null;
    this.shotPending = 0;
    this.shootPlaying = 0;
    return false;
  }

  /** Годится ли цель: жива, в пределах дальности и пуля до неё долетит. */
  _targetUsable(zombie, location) {
    if (!zombie || !zombie.alive) return false;

    const from = this.root.position;
    const dx = zombie.position.x - from.x;
    const dz = zombie.position.z - from.z;
    if (Math.hypot(dx, dz) > CFG.fireRange) return false;

    return !location.obstacles.blocksLine(from.x, from.z, zombie.position.x, zombie.position.z);
  }

  /** Ближайший зомби, до которого долетит пуля. */
  _pickTarget(location) {
    const from = this.root.position;
    let best = null;
    let bestDistance = CFG.fireRange;

    for (const zombie of location.zombies) {
      if (!zombie.alive) continue;

      const dx = zombie.position.x - from.x;
      const dz = zombie.position.z - from.z;
      const distance = Math.hypot(dx, dz);
      if (distance >= bestDistance) continue;

      // сквозь дом или машину не стреляем
      if (location.obstacles.blocksLine(from.x, from.z, zombie.position.x, zombie.position.z)) continue;

      best = zombie;
      bestDistance = distance;
    }
    return best;
  }

  /** Попадание по цели, если она ещё жива и на месте. */
  _fire() {
    const zombie = this.target;
    if (!zombie || !zombie.alive) return;

    const dx = zombie.position.x - this.root.position.x;
    const dz = zombie.position.z - this.root.position.z;
    if (Math.hypot(dx, dz) > CFG.fireRange) return;

    zombie.takeDamage(CFG.shotDamage);
  }
}
