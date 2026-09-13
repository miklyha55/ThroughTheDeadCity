import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { batchSkinned, enableCulling } from '../world/batching.js';
import { addSilhouette } from '../fx/Silhouette.js';
import { arcPoint } from '../core/arc.js';
import { CONFIG as ROOT } from '../config.js';

const CFG = CONFIG.player;
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

    // силуэт проступает, когда персонаж уходит за дом
    this.silhouette = addSilhouette(this.root, {
      color: ROOT.silhouette.playerColor,
      opacity: ROOT.silhouette.opacity,
    });

    // после двойников: отсечение нужно и им
    enableCulling(this.root);

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
    this.ammo = CFG.ammo;

    // Ствол: он закреплён на кости руки и развёрнут относительно корпуса, поэтому
    // целиться поворотом корпуса «в лоб» нельзя — оружие будет смотреть мимо.
    this.gun = this.root.getObjectByName('Shotgun') ?? null;
    this.gunOnBack = this.root.getObjectByName('Shotgun_Back') ?? null;
    this._barrel = new THREE.Vector3();
    this._muzzle = new THREE.Vector3();
    this._hitPoint = new THREE.Vector3();
    this.effects = null; // росчерк и вспышка; ставится снаружи
    this.blood = null;     // зелёные брызги: его попадания по зомби
    this.ownBlood = null;  // красные: попадания по нему самому

    this._holdGun(false); // пока не стреляет, ружьё висит за спиной

    this.target = null;    // зомби на прицеле, держится до его смерти
    this.shotPending = 0;  // сколько осталось до момента выстрела в клипе
    this.shootPlaying = 0; // сколько ещё идёт клип выстрела
    this.reloading = 0;    // пауза между выстрелами: в неё зомби и подходят
    this.jumpTime = 0;     // сколько уже длится прыжок, с; ноль — значит стоит на земле
    this._jumpFrom = new THREE.Vector3();
    this._jumpTo = new THREE.Vector3();

    this.pinned = 0;       // зомби замахнулся: управление отобрано до удара
    this.reacting = 0;     // доигрывается реакция на попадание

    this.play('Idle', 0);

    this._desired = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
  }

  get position() { return this.root.position; }

  get alive() { return this.lives > 0; }

  /**
   * Управление отобрано: зомби замахнулся, либо персонажа ещё шатает от удара.
   * И то и другое — время, когда он не бежит, не стреляет и не может уйти.
   */
  get helpless() { return this.pinned > 0 || this.reacting > 0; }

  /** Летит ли он сейчас через препятствие. */
  get jumping() { return this.jumpTime > 0; }

  /**
   * Зомби начал замах — персонаж замирает, пока его не ударят.
   * Время задаёт сам зомби: столько осталось до попадания в его анимации.
   */
  pin(seconds) {
    if (!this.alive) return;
    this.pinned = Math.max(this.pinned, seconds);
    this.velocity.set(0, 0, 0);
    this._holdFire(); // выстрела не будет, пока не ударят
  }

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
    this.pinned = 0; // замах отработал, дальше держит уже сама реакция

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

  /**
   * Круг света вокруг персонажа.
   *
   * Висит на нём самом, поэтому ездит следом без единой строчки в кадре. Теней
   * не бросает намеренно: источник находится внутри фигуры, и любая тень от него
   * легла бы от её же ног во все стороны. Вторая карта теней вдобавок стоила бы
   * кадра — а нужен здесь только свет.
   */
  _addGlow() {
    const GLOW = ROOT.glow;

    const light = new THREE.PointLight(GLOW.color, GLOW.intensity, GLOW.distance, GLOW.decay);
    light.name = 'playerGlow';
    light.position.set(0, GLOW.height, 0);
    light.castShadow = false;

    this.root.add(light);
    this.glow = light;
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
    if (this.pinned > 0) this.pinned -= dt;
    if (this.reacting > 0) this.reacting -= dt;

    // мёртвый не управляется: доигрывает падение и остаётся лежать
    if (!this.alive) {
      this.velocity.set(0, 0, 0);
      this.mixer.update(dt);
      return;
    }

    // в полёте управление отобрано: траектория уже задана, менять её нечем
    if (this.jumping) {
      this._flyOver(dt, move);
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

    // В замахе и под ударом персонаж не управляется: вырваться нельзя.
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

    // корпус доворачивается к направлению движения по кратчайшей дуге
    if (speed > 0) {
      const target = Math.atan2(this.velocity.x, this.velocity.z);
      this._turnTo(target, CFG.turnSpeed, dt);
    }

    // Стрелять можно только стоя. Проверяем сам ввод, а не скорость: на кадре
    // отпускания стика скорость ещё старая, и выстрел терялся бы до следующего.
    const standing = this._desired.lengthSq() === 0;
    const canShoot = standing && location && !this.helpless;
    const shooting = canShoot ? this._aimAndFire(dt, location) : this._holdFire();

    // ружьё либо в руках, либо за спиной — одновременно видно только одно
    this._holdGun(shooting);

    if (this.reacting > 0) {
      // доигрывает попадание: анимацию не трогаем, иначе оборвётся на первом кадре
    } else if (this.pinned > 0) {
      // в замахе персонаж только стоит
      this.play('Idle', CFG.stopFade);
      this.current.timeScale = 1;
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
    this.target = this._pickTarget(location);

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

    // Патроны кончились — целиться уже незачем: персонаж просто стоит.
    // Стойку ставим сами, иначе он замрёт на последнем кадре выстрела.
    if (this.ammo <= 0) {
      this.play('Idle', CFG.stopFade);
      this.current.timeScale = 1;
      return true;
    }

    // цель есть, перезарядка кончилась и есть чем стрелять
    this.ammo--;
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

    this.yaw = wanted - this._barrelOffset();
    this.root.rotation.y = this.yaw;
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

    const muzzle = this._muzzlePoint();
    const base = Math.atan2(zombie.position.x - muzzle.x, zombie.position.z - muzzle.z);
    const middle = (CFG.pellets - 1) / 2;

    for (let i = 0; i < CFG.pellets; i++) {
      const angle = base + (i - middle) * CFG.spreadAngle * DEG;
      const dirX = Math.sin(angle);
      const dirZ = Math.cos(angle);

      // бочка на пути детонирует — и дальше пуля летит уже по пустому месту
      const barrels = location?.debris.explosivesAlong(muzzle, dirX, dirZ, CFG.fireRange) ?? [];
      for (const barrel of barrels) location.explode(barrel, this);

      const victims = this._pelletHits(location, muzzle, dirX, dirZ);

      // росчерк тянем до последнего задетого, а если никого — на всю дальность
      const last = victims[victims.length - 1];
      if (last) {
        this._hitPoint.copy(last.position).setY(last.position.y + CFG.hitHeight);
      } else {
        this._hitPoint.set(
          muzzle.x + dirX * CFG.fireRange, muzzle.y, muzzle.z + dirZ * CFG.fireRange
        );
      }
      this.effects?.fire(muzzle, this._hitPoint);

      for (const victim of victims) {
        this._hitPoint.copy(victim.position).setY(victim.position.y + CFG.hitHeight);
        this.blood?.splash(this._hitPoint, muzzle); // капли летят дальше по ходу пули
        victim.takeDamage(CFG.shotDamage, from);
      }
    }
  }

  /**
   * Все, кого прошивает одна пуля, по порядку от дула.
   *
   * Толщина пути — ширина тела: пуля не нитка, и мазать на полметра ей незачем.
   * Стену она по-прежнему не берёт: до каждого зомби проверяется, свободна ли
   * линия огня, и закрытые машиной или домом выпадают.
   */
  _pelletHits(location, muzzle, dirX, dirZ) {
    if (!location) return [];

    const from = this.root.position;
    const hits = [];

    for (const other of location.zombies) {
      if (!other.alive) continue; // взрыв мог убрать его прямо этим выстрелом

      const ox = other.position.x - muzzle.x;
      const oz = other.position.z - muzzle.z;

      const along = ox * dirX + oz * dirZ;          // сколько по лучу до него
      if (along <= 0 || along > CFG.fireRange) continue;

      const aside = Math.abs(ox * dirZ - oz * dirX); // и насколько он в стороне
      if (aside > ROOT.zombies.bodyRadius) continue;

      if (location.obstacles.blocksLine(from.x, from.z, other.position.x, other.position.z)) continue;

      hits.push({ zombie: other, along });
    }

    return hits.sort((a, b) => a.along - b.along).map((h) => h.zombie);
  }

  /** Точка дула в мировых координатах: конец ствола оружия в руке. */
  _muzzlePoint() {
    if (!this.gun) return this._muzzle.copy(this.root.position).setY(this.root.position.y + CFG.hitHeight);

    this.gun.updateWorldMatrix(true, false);
    return this._muzzle.set(CFG.muzzleOffset, 0, 0).applyMatrix4(this.gun.matrixWorld);
  }
}
