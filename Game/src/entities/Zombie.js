import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Figure } from './Figure.js';

const CFG = CONFIG.zombies;
const BLADES = CONFIG.blades;

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

/**
 * Пороги, по которым подошедший зомби переступает с бега на стойку и обратно.
 *
 * Их два, и это не прихоть. С одним порогом зомби, оказавшийся ровно на нём,
 * каждый кадр менял бы решение: шагнул — отошёл за порог — встал — расстояние
 * снова выросло — побежал. Со стороны это мелкое перебирание ногами на месте.
 *
 * Тронуться сложнее, чем встать: чтобы снова побежать, нужно заметно больше
 * места, чем нужно потерять, чтобы остановиться. Между порогами держится то,
 * что уже выбрано.
 *
 * Отсчитываются они от той самой точки, до которой зомби доходит, — от черты
 * удара, отодвинутой внутрь на `attackMargin`. Поэтому и берутся от неё же, с
 * запасом сверху: голые 0.15 и 0.05 стояли ровно на `attackMargin` и ниже, а до
 * них зомби не добирается никогда — ближе черты удара он уже бьёт, а не гонится.
 * Стойка была недостижима, и подошедший вплотную перебирал ногами на месте —
 * ровно то, против чего эти пороги и заведены.
 */
const CHASE_RUN_ON = CFG.attackMargin + 0.25;  // с этого запаса стоящий снова трогается
const CHASE_RUN_OFF = CFG.attackMargin + 0.08; // и до этого идущий останавливается

const _hit = new THREE.Vector3();
const _blade = new THREE.Vector3();
const _bonePoint = new THREE.Vector3();
// Длинная ось клинка в его собственных осях: от рукояти к острию модель вытянута
// по X — так она и выгружена из Blender.
const _alongAxis = new THREE.Vector3(1, 0, 0);
const _toPlayer = new THREE.Vector3();
const _push = new THREE.Vector3();
const _step = new THREE.Vector3();
const _toPoint = new THREE.Vector3();

/**
 * Зомби: замечает персонажа в радиусе, медленно идёт к нему и бьёт вблизи.
 * Пока персонаж далеко, зомби стоит и дышит — так толпа не съедает кадр.
 */
export class Zombie extends Figure {
  /**
   * @param {THREE.Object3D} model — клон скина со своим скелетом
   * @param {THREE.AnimationClip[]} clips — общие клипы библиотеки
   * @param {string} [kind] — какого он вида: от этого зависит живучесть
   */
  constructor(model, clips, kind = '') {
    super(model, clips, 0.25);
    this.kind = kind;

    this.once(['Headbutt', 'Death', 'ReactionHit']);

    // клип играется быстрее, значит и замах длится меньше реального времени
    this.attackLength = this.lengthOf('Headbutt', CFG.attackSpeed);
    // сколько длится рывок: столько же, сколько играет сам клип
    this.hurtLength = this.lengthOf('ReactionHit', CFG.hurtSpeed);
    this.deathLength = this.lengthOf('Death');

    // Живучесть своя у каждого вида, если задана: одни крепче, другие слабее.
    this.health = CFG.healthByKind?.[kind] ?? CFG.health;
    this.maxHealth = this.health;
    this.deadTime = 0;
    this.hurtTime = 0;
    this.removed = false; // локация уберёт такого из списка
    this.onDeath = null;  // кому сказать, что его убили: счёту пути

    this.yaw = 0;
    this.home = new THREE.Vector3();   // вокруг неё бродит, пока не увидит персонажа
    this.waypoint = new THREE.Vector3();
    this.waitTime = 0;
    this.stuckTime = 0;    // сколько он топчется на месте, никуда не продвигаясь
    this.alerted = false;  // поднят по тревоге выстрелом — пойдёт на цель без обзора
    this.enraged = false;  // поднят всей толпой: знает, где герой, где бы тот ни был
    this.sfx = null;       // голос; ставится снаружи
    this.heardAt = Infinity; // как далеко от персонажа он сейчас — для громкости
    this.stepPhase = 1;    // где был клип бега в прошлом кадре: по нему ловится шаг
    this.growlIn = Math.random() * CFG.growlEveryMax; // через сколько он заурчит
    this.chaseMoving = true;
    this.blindTime = 0;    // сколько уже не видит цель, с: погоня бросается не сразу
    this.state = STATE.PATROL;
    this.current = null;
    this.attackTime = 0;
    this.hitDone = false;

    this.play('Idle', 0);
  }


  get alive() { return this.state !== STATE.DEAD; }

  /** Чем он задевает предметы: телом такого радиуса и с такой скоростью. */
  get radius() { return CFG.bodyRadius; }

  /**
   * Размер тела: сквозь него не проходят ни персонаж, ни соседи, и в него же
   * попадает пуля. Геттерами, а не прямым чтением настроек: вожак втрое крупнее,
   * и всё, что меряет тело, должно спрашивать у самой фигуры.
   */
  get bodyRadius() { return CFG.bodyRadius; }
  get bodyHeight() { return CFG.bodyHeight; }

  /** Во сколько раз фигура крупнее обычной: по этому поднимается полоска жизни. */
  get sizeScale() { return 1; }

  /** Во сколько раз дальше обычного по нему стреляют. */
  get fireReach() { return 1; }

  /** Идёт ли он по следу: в этом состоянии обзор уже круговой. */
  get chasing() { return this.state === STATE.CHASE || this.state === STATE.ATTACK; }

  get speed() {
    if (this.state === STATE.CHASE) return CFG.speed;
    if (this.state === STATE.PATROL) return CFG.patrolSpeed;
    return 0; // стоит — только отодвигает предмет, не пинает
  }

  /**
   * Смерть от прилетевшего предмета: бочка или ящик, разогнанные персонажем,
   * валят наповал независимо от того, сколько у зомби оставалось здоровья.
   *
   * Брызги те же, что и от пули: один и тот же залп зелени.
   *
   * @param {THREE.Vector3} [from] — откуда прилетело: туда же летят капли
   * @param {number} [gore] — во сколько раз гуще кровь: разрыв взрывом не то же
   *   самое, что удар бочкой
   * @param {'blast'|'blade'|'impact'} [cause] — чем убило. Обычному зомби всё
   *   равно, он гибнет от любого; вожак от разного теряет разное
   */
  crush(from = null, gore = 1, cause = 'impact') {
    if (this.state === STATE.DEAD) return false;

    this.blood?.splash(
      _hit.copy(this.root.position).setY(this.root.position.y + CONFIG.player.hitHeight),
      from ?? this.root.position,
      gore
    );

    this.health = 0;
    this._enter(STATE.DEAD);
    return true;
  }

  /**
   * Клинок вошёл в тело — и остаётся торчать в голове.
   *
   * Всегда в голову, а не туда, куда пришёлся удар. Попадание в предплечье или
   * в голень выглядит случайностью, и клинок в них торчит то боком, то плашмя:
   * кости мелкие и вертятся, и угол выходит какой угодно. Голова же одна, она
   * крупная, и воткнутый в неё тесак читается сразу.
   *
   * Держится он на самой кости головы, поэтому дальше едет и падает вместе с
   * ней, как и должен.
   *
   * @param {THREE.Object3D} object — сам клинок
   * @param {THREE.Vector3} at — где он коснулся тела
   * @param {THREE.Vector3} [along] — куда летел: этим направлением он и входит
   * @param {number} [tip] — вылет от середины клинка до острия, м
   * @returns {boolean} принял ли зомби клинок — мёртвый не принимает
   */
  impale(object, at, along = null, tip = 0.25) {
    if (this.state === STATE.DEAD) return false;

    const bone = this._headBone();
    if (!bone) return false;

    bone.getWorldPosition(_bonePoint);

    /**
     * Куда смотрит клинок.
     *
     * По ходу полёта: он пришёл по дуге, чуть сверху, и остаётся под тем же
     * углом — так это и выглядит ударом, а не подвешенной декорацией. Если
     * скорости почему-то нет, берём направление от точки касания к голове.
     */
    if (along && along.lengthSq() > 1e-6) _blade.copy(along).normalize();
    else _blade.copy(_bonePoint).sub(at).normalize();

    if (_blade.lengthSq() < 1e-6) _blade.set(0, 0, 1);

    /**
     * Лезвие внутри головы, рукоять снаружи.
     *
     * Своё положение у предмета — середина, поэтому от головы его отодвигают
     * назад по ходу полёта ровно на вылет до острия. Тогда в голове оказывается
     * кончик, а наружу торчит рукоять. `headBite` пускает остриё чуть за
     * середину головы, чтобы оно не стояло вровень с кожей и не вышло насквозь.
     */
    object.position.copy(_bonePoint).addScaledVector(_blade, -(tip - BLADES.headBite));

    // Разворот: собственная длинная ось клинка — X, её и совмещаем с ходом
    // полёта. Иначе он вошёл бы боком, как его ни утапливай.
    object.quaternion.setFromUnitVectors(_alongAxis, _blade);

    // `attach`, а не `add`: кость едет и вертится вместе с анимацией, и обычное
    // добавление швырнуло бы клинок в её локальные оси — он бы уехал под землю
    // или вбок. `attach` пересчитывает положение так, что на глаз ничего не
    // сдвигается.
    bone.attach(object);

    this.crush(at, BLADES.gore, 'blade');
    return true;
  }

  /**
   * Кость головы.
   *
   * Ищем по имени: у скелета из Mixamo она называется `Head`, а `HeadTop_End` —
   * это уже макушка, служебный кончик цепочки, и клинок на ней висел бы над
   * волосами. Если такой кости нет вовсе, берём самую высокую — выше головы у
   * фигуры ничего не бывает.
   */
  _headBone() {
    let head = null;
    let highest = null;
    let top = -Infinity;

    this.root.traverse((node) => {
      if (!node.isBone) return;

      const name = node.name || '';
      if (!head && /head$/i.test(name)) head = node;

      node.getWorldPosition(_bonePoint);
      if (_bonePoint.y > top) {
        top = _bonePoint.y;
        highest = node;
      }
    });

    return head ?? highest;
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

  /**
   * Темп покоя: у каждого свой, иначе толпа дышит в такт.
   *
   * Отдельным геттером, а не чтением поля, ради проверки на мусор. Раньше здесь
   * стояло `this.idleSpeed ?? 1`, и оно не спасало: `??` подставляет запасное
   * значение только вместо `null` и `undefined`, а NaN проходит насквозь и
   * останавливает клип.
   */
  get restSpeed() {
    return Number.isFinite(this.idleSpeed) ? this.idleSpeed : 1;
  }

  /**
   * Сдвигает анимацию по фазе и темпу.
   * Без этого толпа дышит синхронно, как один механизм.
   *
   * Фаза задаётся долей клипа, а не секундами: свою длину `AnimationAction`
   * знает сам, через `getClip().duration`, и держать её второй раз в настройках
   * незачем. Вторая копия и подвела — её оттуда убрали, а расчёт остался, и
   * каждый зомби получал NaN во времени и в темпе. Клип покоя с таким темпом не
   * идёт вовсе: вся толпа стояла неподвижно.
   *
   * @param {number} share — доля клипа, 0..1
   * @param {number} speed — темп покоя
   */
  desync(share, speed) {
    if (!this.current) return;

    const phase = Number.isFinite(share) ? share : 0;
    this.idleSpeed = Number.isFinite(speed) ? speed : 1;

    this.current.time = this.current.getClip().duration * phase;
    this.current.setEffectiveTimeScale(this.restSpeed);
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
    this.heardAt = distance; // по нему считается громкость голоса

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

    // Урчит он и сам по себе, не дожидаясь поворота: иначе его слышно только
    // от тех, кто бродит вдали, а не от того, кто идёт по пятам.
    this.growlIn -= dt;
    if (this.growlIn <= 0) this._growl();

    // Шаги считаются после состояний, но ДО `mixer.update`: клип в этот миг
    // стоит там же, где его видит игрок в нынешнем кадре.
    this._steps();
    this.mixer.update(dt);
  }

  /**
   * Поднять в атаку: с этой минуты зомби знает, где герой, и идёт на него.
   *
   * Без радиуса, без угла обзора и сквозь укрытия — так бежит толпа, которой
   * указали цель. Отменить это нельзя: разъярённый не успокаивается, пока жив
   * он сам или герой.
   */
  enrage() {
    if (this.state === STATE.DEAD) return;

    this.enraged = true;
    this.alerted = true;
    this.blindTime = 0;
    if (this.state !== STATE.ATTACK && this.state !== STATE.HURT) this._enter(STATE.CHASE);
  }

  /**
   * Остыть: бросить цель и разойтись.
   *
   * Герой перестаёт быть целью совсем — погоня обрывается, даже если он на
   * виду. Зомби уходит в свою сторону и там поселяется; наткнётся на героя по
   * дороге — погонится заново, но уже по обычным правилам зрения, и уйти от
   * него будет можно.
   *
   * Уходит именно в сторону, а не остаётся на месте: иначе вся толпа так и
   * стоит там, где её застало остывание, одной кучей, а площадка вокруг пустая.
   *
   * @param {import('../world/Location.js').Location} location
   * @param {number} turn — в какую сторону уходить, рад
   * @param {number} away — и как далеко, м
   */
  calm(location, turn = Math.random() * Math.PI * 2, away = CFG.patrolRadius) {
    if (this.state === STATE.DEAD || !this.enraged) return;

    this.enraged = false;
    this.alerted = false;
    this.blindTime = 0;

    const from = this.root.position;
    const x = from.x + Math.cos(turn) * away;
    const z = from.z + Math.sin(turn) * away;

    // В стену идти незачем: туда, куда не пройти, зомби просто упрётся носом.
    if (location.nav.isFree(x, z)) {
      this.home.set(x, from.y, z);
      this.waypoint.copy(this.home);
      this.stuckTime = 0;
    } else {
      this.home.copy(from);
      this._pickWaypoint(location);
    }

    // В прогулку — из любого состояния, даже из замаха. Оборванный замах видно,
    // но иначе зомби доигрывает удар и по его концу возвращается в погоню: цель
    // он бы так и не потерял.
    this._enter(STATE.PATROL, true);
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
    if (this.enraged) return true; // поднятая толпа цель не теряет
    if (distance > CFG.loseRadius) return false;

    /**
     * Укрытие решает раньше всего остального.
     *
     * Зашёл за машину или за дом — и тебя не видно, кем бы зомби ни был поднят
     * и как бы близко ни стоял. Это единственное правило, которое не знает
     * исключений: иначе поднятый выстрелом видел сквозь стены, и спрятаться от
     * толпы было нельзя вовсе.
     */
    if (this._hidden(player, location)) return false;

    /**
     * А дальше — два послабления, иначе зомби терял цель и тут же находил снова.
     *
     * Поднятый выстрелом идёт по следу, пока цель в пределах интереса, а
     * вплотную он чует её и спиной. Без этого достаточно было встать
     * преследователю за спину: каждые `loseAfter` он бросал погоню, переносил
     * свой дом, разворачивался и с окриком начинал её заново.
     */
    if (this.alerted || distance <= CFG.alertRadius) return true;

    const forward =
      (Math.sin(this.yaw) * _toPlayer.x + Math.cos(this.yaw) * _toPlayer.z) / (distance || 1);

    return forward >= Math.cos((CFG.senseAngle * Math.PI) / 360);
  }

  /**
   * Подать голос.
   *
   * Громкость падает с расстоянием, а дальше `voiceRange` зомби не слышно вовсе:
   * иначе вся сотня, разбросанная по локации, звучала бы так же близко, как та,
   * что стоит перед носом.
   *
   * @param {string} sound — какой набор голосов брать
   * @param {number} loudness — громкость вблизи, доля от общей
   * @param {number} chance — с какой вероятностью он вообще подаст голос
   * @param {number} pitch — сдвиг высоты тона: им предсмертный хрип отличается
   *   от окрика, хотя записи у них одни и те же
   * @param {number} range — с какого расстояния его уже не слышно. У шагов он
   *   свой, короче: окрик через двор слышен, а шарканье — нет
   * @param {number} falloff — насколько полого громкость падает с расстоянием.
   *   Единица — прямая линия; меньше — звук держится почти до края круга. Прямая
   *   годится окрику, который и вблизи громкий, а тихое бормотание при ней
   *   пропадает уже на середине пути
   */
  _voice(sound, loudness, chance = CFG.voiceChance, pitch = 1, range = CFG.voiceRange, falloff = 1) {
    if (!this.sfx || Math.random() > chance) return;

    const away = this.heardAt ?? range;
    if (away >= range) return;

    const near = (1 - away / range) ** falloff;
    this.sfx.play(sound, loudness * near, 1, pitch);
  }

  /**
   * Урчание: и на повороте, и просто по ходу дела.
   *
   * Одних поворотов мало. Свернуть зомби успевает раз в несколько секунд, а тот,
   * кто рядом с героем, обычно уже гонится — и не сворачивает вовсе. Урчали
   * поэтому ровно те, кого и не слышно: дальние бродяги.
   */
  _growl() {
    this.growlIn = CFG.growlEveryMin + Math.random() * (CFG.growlEveryMax - CFG.growlEveryMin);
    this._voice('zombieGrowl', CFG.growlVolume, CFG.growlChance, CFG.growlPitch,
      CFG.growlRange, CFG.growlFalloff);
  }

  /**
   * Шаги: слышно только того, кто подошёл.
   *
   * Отметки берутся из самого клипа бега, как у героя и у вожака, — тогда топот
   * совпадает с ногами при любом темпе, а темп у зомби разный: на прогулке он
   * бредёт, в погоне идёт заметно быстрее.
   *
   * Громкость падает с расстоянием и обрывается вовсе за `stepRange`. Это не
   * экономия, а смысл звука: зомби на локации под сотню, и топот всей толпы был
   * бы ровным шорохом, из которого не выделить того единственного, кто заходит
   * со спины. Слышно ровно того, кто уже близко, — и это и есть предупреждение.
   */
  _steps() {
    const moving = this.state === STATE.CHASE || this.state === STATE.PATROL;
    if (!moving || this.current !== this.actions.get('Run')) {
      this.stepPhase = 1; // встал — следующий шаг начнётся с начала цикла
      return;
    }

    // Дальше слышимости даже не считаем фазу: это самый частый случай — почти
    // вся толпа всегда далеко.
    if ((this.heardAt ?? Infinity) >= CFG.stepRange) {
      this.stepPhase = 1;
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

      this._voice('zombieStep', CFG.stepVolume, 1, CFG.stepPitch, CFG.stepRange);
      break;
    }

    this.stepPhase = phase;
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
        this.current.setEffectiveTimeScale(CFG.patrolSpeed / CFG.runClipSpeed);
        break;

      case STATE.IDLE:
        this.waitTime = CFG.waitMin + Math.random() * (CFG.waitMax - CFG.waitMin);
        this.play('Idle', 0.3);
        this.current.setEffectiveTimeScale(this.restSpeed);
        break;

      case STATE.CHASE:
        this.chaseMoving = true;
        this.play('Run', 0.25);
        // темп клипа под шаг: зомби бредёт, а не бежит
        this.current.setEffectiveTimeScale(CFG.speed / CFG.runClipSpeed);
        break;

      case STATE.ATTACK:
        this.attackTime = 0;
        this.hitDone = false;
        this.restart('Headbutt', 0.12, CFG.attackSpeed);
        break;

      case STATE.HURT:
        this.hurtTime = 0;
        // Клип перезапускаем принудительно: вторая пуля подряд иначе не видна.
        this.restart('ReactionHit', CFG.hurtFade, CFG.hurtSpeed);
        break;

      case STATE.DEAD:
        this.deadTime = 0;
        this.onDeath?.();
        this._voice('zombieDead', CFG.deathVolume, 1, CFG.deathPitch); // хрип слышно всегда
        this.restart('Death', 0.15);
        break;
    }
  }

  // ─── состояния ──────────────────────────────────────────────────────────────

  /** Стоит на месте. Постояв — идёт к новой точке. */
  _idle(dt, distance, player, location) {
    if (this._sees(player, distance, location)) {
      this._enter(STATE.CHASE);
      this._voice('zombieAlert', CFG.voiceVolume);
      return;
    }

    this.waitTime -= dt;
    if (this.waitTime <= 0) this._pickWaypoint(location), this._enter(STATE.PATROL);
  }

  /** Бродит от точки к точке вокруг своего места, обходя препятствия. */
  _patrol(dt, distance, player, location, crowd) {
    if (this._sees(player, distance, location)) {
      this._enter(STATE.CHASE);
      this._voice('zombieAlert', CFG.voiceVolume);
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

    // Но если он уже стоит в непроходимой клетке — а в погоне его туда заносит
    // толпой, — то запрет на шаг запирает его там навсегда: соседние клетки тоже
    // заняты, идти «можно» только наружу, а проверка этого не разрешает. Поэтому
    // зажатый идёт куда идёт, а наружу его вытолкнет разбор столкновений.
    const trapped = !location.nav.isFree(position.x, position.z);

    if (!trapped && !location.nav.isFree(nextX, nextZ)) {
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
    if (this.enraged) return true;

    if (distance > (this.alerted ? CFG.loseRadius : CFG.senseRadius)) return false;

    // Укрытие решает первым и для поднятого выстрелом тоже: раньше он шёл на
    // цель через что угодно, и уйти от поднятой толпы за машину было нельзя.
    // Через дом и машину зомби персонажа не видит, а поверх бочки — вполне.
    if (this._hidden(player, location)) return false;

    if (this.alerted) return true;              // поднят выстрелом и идёт по следу
    if (distance <= CFG.alertRadius) return true; // так близко, что слышит

    // угол между взглядом и направлением на цель
    _toPlayer.divideScalar(distance || 1);
    const forward = Math.sin(this.yaw) * _toPlayer.x + Math.cos(this.yaw) * _toPlayer.z;
    return forward >= Math.cos((CFG.senseAngle * Math.PI) / 360);
  }

  /**
   * Новая точка для прогулки: рядом с домом, на свободном месте и с проходимой
   * дорогой туда. Проверять одну только точку мало — до неё ещё надо дойти.
   *
   * Поворот заодно и слышно: зомби урчит себе под нос, но не на каждом — раз в
   * два-три поворота, случайно. Сплошное бормотание толпы съело бы окрик того,
   * кто и правда заметил героя, а редкое — наоборот, выдаёт, что рядом кто-то
   * бродит, ещё до того, как его видно.
   */
  _pickWaypoint(location) {
    this.stuckTime = 0;
    this._growl(); // свернул — буркнул; заодно отодвигается и очередное урчание
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
    /**
     * Потеря цели даётся не с первого кадра.
     *
     * Видно или не видно — величина рваная: у столба, у края дома, на самой
     * кромке сектора взгляда она переключается туда-сюда по нескольку раз в
     * секунду. А бросок погони здесь не мелочь: зомби разворачивается, переносит
     * своё место и выбирает новую точку. Делать это на каждом мигании значит
     * топтаться на месте и дёргаться.
     *
     * Поэтому потерянную цель зомби ещё несколько мгновений держит: любой кадр,
     * в котором он снова её видит, обнуляет счёт. Заодно это и правдоподобнее —
     * он идёт туда, где видел её в последний раз, а не забывает мгновенно.
     */
    if (player.alive && this._inSight(player, distance, location)) {
      this.blindTime = 0;
    } else {
      this.blindTime += dt;

      if (!player.alive || this.blindTime >= CFG.loseAfter) {
        this.alerted = false;
        this.blindTime = 0;
        this.home.copy(this.root.position); // потерял цель — бродит уже здесь
        this._pickWaypoint(location);
        this._enter(STATE.PATROL);
        return;
      }
    }
    // Дотянулся — бьёт.
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

    // Подойдя на дистанцию удара, зомби останавливается: дальше он бьёт, а не
    // толкается. Иначе он продолжал бы напирать и возить персонажа по площадке.
    //
    // Целится он при этом чуть ближе, чем нужно для удара, — на `attackMargin`
    // внутрь. Иначе он вставал ровно на черте, а любая мелочь потом отжимала его
    // на волос наружу: удар не начинался, а шага, чтобы дойти, уже не хватало.
    const room = distance - (CFG.attackRadius - CFG.attackMargin);

    // Дошёл и ждёт — значит стоит и дышит, а не перебирает ногами на месте.
    // Пороги разведены: идущий держится до меньшего, стоящий трогается с большего.
    this._chaseMotion(room > (this.chaseMoving ? CHASE_RUN_OFF : CHASE_RUN_ON));

    _push.copy(_step).multiplyScalar(Math.min(CFG.speed * dt, room));

    // Толпа разбирается между собой, пока идёт. У самой цели расталкивание
    // выключено: там оно отжимало подошедшего назад ровно настолько, насколько
    // он успевал шагнуть вперёд, и второй зомби навсегда застревал в пятнадцати
    // сантиметрах от дистанции удара — стоял рядом и не бил.
    if (room > CHASE_STEP_MIN) this._separate(_push, crowd, dt);

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
      this.current.setEffectiveTimeScale(CFG.speed / CFG.runClipSpeed);
    } else {
      this.play('Idle', 0.2);
      this.current.setEffectiveTimeScale(this.restSpeed);
    }
  }

  /**
   * Удар.
   *
   * Вся логика умещается в три шага: доворачиваемся к персонажу, на середине
   * замаха проверяем, дотянулись ли, и по концу клипа возвращаемся в погоню.
   * Дотянулись — персонаж получает своё; отбежал за это время — промах.
   */
  _attack(dt, distance, player) {
    this.attackTime += dt;

    // Замахиваясь, зомби стоит на месте и только доворачивается к цели.
    this._turnTo(Math.atan2(_toPlayer.x, _toPlayer.z), dt);

    if (!this.hitDone && this.attackTime >= this.attackLength * CFG.hitAt) {
      this.hitDone = true;
      // бьём, только если цель всё ещё в досягаемости — иначе удар в воздух
      if (distance <= CFG.attackRadius + CFG.reach) player.takeDamage(CFG.damage, this.root.position);
    }

    if (this.attackTime < this.attackLength) return;

    // Замах доигран: цела цель — идём за ней снова, нет — успокаиваемся.
    //
    // Стоящему вплотную незачем ронять себя в погоню: на следующем же кадре он
    // вернулся бы в удар, а между ними успевал вклиниться кадр бега — в замах
    // постоянно подмешивался рывок ногами.
    if (!player.alive) this._enter(STATE.IDLE);
    else if (distance <= CFG.attackRadius) this._enter(STATE.ATTACK, true);
    else this._enter(STATE.CHASE);
  }

  /** Сбит с шага: на миг замирает, потом снова идёт. */
  _hurt(dt, distance, player) {
    this.hurtTime += dt;
    if (this.hurtTime < this.hurtLength) return;

    if (player.alive && (this.enraged || this.alerted || distance <= CFG.loseRadius)) this._enter(STATE.CHASE);
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

    // Глубина и скорость — по росту: крупное тело уходит глубже, но за то же
    // время, что и обычное.
    const size = this.sizeScale;
    this.root.position.y -= CFG.sinkSpeed * size * dt;

    if (this.root.position.y <= -CFG.sinkDepth * size) {
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

      // Дистанция растёт вместе с телами: обычная пара держит `separation`, а
      // рядом с вожаком его тело втрое шире, и расходиться надо раньше.
      const apart = CFG.separation * (this.bodyRadius + other.bodyRadius) / (2 * CFG.bodyRadius);

      const dx = position.x - other.position.x;
      const dz = position.z - other.position.z;
      const gap = Math.hypot(dx, dz);
      if (gap >= apart || gap < 1e-4) continue;

      const force = (apart - gap) / apart;
      step.x += (dx / gap) * force * limit;
      step.z += (dz / gap) * force * limit;
    }
  }
}
