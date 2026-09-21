import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { HitFlash } from '../fx/HitFlash.js';

const CFG = CONFIG.car;

const _dir = new THREE.Vector3();
const _want = new THREE.Vector3();
const _side = new THREE.Vector3();
const _step = new THREE.Vector3();
const _wanted = new THREE.Vector3();
const _from = new THREE.Vector3();

/**
 * Таран: машина, которой проезжается шоссе перед вожаком.
 *
 * Стоит у обочины в начале уровня, стрелка ведёт к ней. Герой подошёл — сел, и
 * с этого мгновения игра другая: стрельбы нет, есть руль. Обратно не выйти —
 * уровень задуман как один долгий проезд, и выпускать из машины посреди дороги
 * значило бы отдать игроку пеший бой там, где под это ничего не разложено.
 *
 * Ведут её так же, как героя: стик задаёт только направление, а скорость всегда
 * одна и та же — полная, сколько ни отклоняй. Сбрасывается она лишь тогда,
 * когда палец убрали со стика или отпустили клавиши. Отличие от героя в другом:
 * у героя ноги, у машины колёса.
 *
 * Едет она не туда, куда смотрит нос, а туда, куда несёт. Нос доворачивается к
 * стику со своей скоростью, а вектор движения догоняет нос отдельно — тем
 * медленнее, чем быстрее машина идёт. Пока он не догнал, машину несёт боком:
 * это и есть занос. Резко переложить руль на полном ходу — уйти в скольжение,
 * отпустить газ и доложить — поймать его.
 *
 * Для зомби машина — та же цель, что и герой: у неё есть `position`, `alive` и
 * `takeDamage`, и больше от цели никто ничего не спрашивает. Поэтому их
 * поведение с ней не меняется ни на строчку: подходят, бьют, поднимают тревогу.
 * Разница в том, что на ходу она сшибает их сама — с любого бока, не только
 * носом: на скорости в тонну железа не важно, каким углом ты в неё попал.
 */
export class Car {
  constructor(scene) {
    this.scene = scene;
    this.root = null;      // модель на сцене; появляется вместе с уровнем
    this.object = null;    // она же, для проверок «есть ли машина на уровне»

    this.driving = false;  // за рулём ли игрок
    this.health = CFG.health;
    // Куда её несёт: вектор в мировых осях, а не скорость вдоль корпуса. В
    // заносе он с корпусом не совпадает — в этом весь смысл.
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    // Насколько её притормозили сбитые тела: доля хода, ноль — не притормозили.
    // Копится от каждого удара и сама сходит на нет, пока машина едет.
    this.slowed = 0;

    this.wrecked = false;
    this.onHealth = null;  // кому показывать полоску жизней
    this.onRam = null;     // кого сбили: сюда уходят тряска и звук
    this.onWreck = null;   // машина догорела: герою пора вылезать
    this.onBoard = null;   // и кому сказать, что в неё сели
    this.onCrash = null;   // врезалась во что-то твёрдое: сюда уходит звук удара
    this.touching = false; // касалась ли препятствия в прошлом кадре
  }

  /**
   * Куда повернуть модель, чтобы она шла носом вперёд.
   *
   * Курс `yaw` — это направление хода, а модель в своих осях смотрит в другую
   * сторону: в .blend она вытянута вдоль X, а ход считается вдоль Z. Разница
   * поправкой и снимается, одной на всю машину.
   */
  get _facing() { return this.yaw + THREE.MathUtils.degToRad(CFG.modelYaw); }

  /** Жива ли: по этому зомби решают, гнаться ли за ней. */
  get alive() { return !this.wrecked; }

  /** Где она сейчас. Зомби спрашивают именно это. */
  get position() { return this.root?.position ?? _step.set(0, 0, 0); }

  /** Быстро ли идёт: на этом держится и таран, и доворот. */
  get moving() { return this.velocity.lengthSq() > 0.01; }

  // Полоска жизней над машиной — та же, что над зомби.
  get maxHealth() { return CFG.health; }
  get barWidth() { return CFG.barWidth; }
  get barOffset() { return CFG.barOffset; }

  // Этим её видят обломки на дороге: разлетаются они от всякого, кто движется,
  // и машина для них — такой же ходок, только шире и быстрее.
  get radius() { return CFG.radius; }
  get speed() { return this.velocity.length(); }

  /**
   * Поставить машину на уровень. Нет в файле — уровень без неё, и это нормально:
   * машина есть ровно на одном шоссе.
   *
   * @param {import('../world/Location.js').Location} location
   */
  place(location) {
    this.clear();

    const spot = location.data.car;
    if (!spot) return;

    const model = location.prefabs.create(CFG.model);
    if (!model) return;

    model.name = 'car';
    model.position.set(spot.at[0], CFG.height, spot.at[1]);
    this.yaw = THREE.MathUtils.degToRad(spot.rotation ?? 0);
    model.rotation.set(0, this._facing, 0);

    this.root = model;
    this.object = model;
    this.scene.add(model);
    this.hitFlash = new HitFlash(model); // красная вспышка и подскок при ударе зомби

    this.driving = false;
    this.wrecked = false;
    this.wreckIn = 0;
    this.health = CFG.health;
    this.velocity.set(0, 0, 0);
    this.slowed = 0;
  }

  /** Снять со сцены: уровень сменился. */
  clear() {
    this.hitFlash?.stop();
    this.hitFlash = null;
    this.root?.removeFromParent();
    this.root = null;
    this.object = null;
    this.driving = false;
    this.wrecked = false;
    this.wreckIn = 0;
    this.velocity.set(0, 0, 0);
    this.slowed = 0;
    this.health = CFG.health;
  }

  /**
   * Сесть за руль. Дальше уровень едет, а не идёт.
   * @returns {boolean} сел ли
   */
  board() {
    if (!this.root || this.driving || this.wrecked) return false;

    this.driving = true;
    this.onBoard?.();
    this.onHealth?.(this.health, CFG.health);
    return true;
  }

  /** Близко ли герой, чтобы сесть. */
  reachable(from) {
    if (!this.root || this.driving || this.wrecked) return false;
    return this.root.position.distanceTo(from) <= CFG.boardRadius;
  }

  /**
   * Удар зомби. Тот же вызов, что и у героя, — с той же стороны и с тем же
   * смыслом: цель у толпы одна, и бьют они её одинаково.
   *
   * @param {number} amount
   */
  takeDamage(amount = 1) {
    if (this.wrecked) return;

    this.hitFlash?.trigger();
    this.health = Math.max(0, this.health - amount);
    this.onHealth?.(this.health, CFG.health);

    if (this.health <= 0) this._wreck();
  }

  /**
   * Кадр машины: разгон, доворот, движение и то, что попало под колёса.
   *
   * @param {number} dt
   * @param {THREE.Vector2} move — стик: куда отклонён, туда и ехать
   * @param {number} cameraYaw — куда смотрит камера: стик задаётся от экрана,
   *   а ехать надо по миру
   * @param {import('../world/Location.js').Location} location
   * @param {boolean} [fromKeys] — ведут ли с клавиатуры: у клавиш управление своё,
   *   относительно самой машины, см. `_driveKeys`
   */
  update(dt, move, cameraYaw, location, fromKeys = false) {
    this.hitFlash?.update(dt);

    // Разбита, но ещё мигает: стоит на месте и ждёт своего взрыва.
    if (this.wrecked && this.wreckIn > 0) {
      this.wreckIn -= dt;
      if (this.wreckIn <= 0) this._blowUp();
      return;
    }

    if (!this.root || !this.driving || this.wrecked) return;

    // Притормаживание от сбитых сходит само: удар гасит ход на мгновение, а
    // не до конца уровня.
    this.slowed = Math.max(0, this.slowed - CFG.ramRecover * dt);

    const yawBefore = this.yaw;
    this._drive(dt, move, cameraYaw, fromKeys);
    this._pivot(yawBefore, location);
    this._roll(dt, location);
    this._ram(location);
    this._mines(location);
  }

  /**
   * Наехал на бочку или канистру — она рвёт под колёсами.
   *
   * Взрыв тот же, что от выстрела: огонь, осколки, зомби вокруг гибнут, соседняя
   * взрывчатка подхватывает цепью. Разница одна — у героя пешком взрыв не
   * отнимает ничего, а машина под ним получает своё: она не бросала бочку, она
   * её переехала.
   *
   * Проверяется раньше, чем обломки разлетаются от машины: иначе бочку отпихнуло
   * бы от капота, и машина никогда бы её не коснулась.
   */
  _mines(location) {
    const items = location.debris?.items;
    if (!items) return;

    for (const item of [...items]) {
      if (!item.explosive || item.held) continue;

      const dx = item.object.position.x - this.root.position.x;
      const dz = item.object.position.z - this.root.position.z;
      if (Math.hypot(dx, dz) > CFG.radius + item.radius + CFG.mineReach) continue;

      location.explode(item, this);
      this.takeDamage(CFG.mineDamage);
      if (this.wrecked) return; // догорела — дальше считать нечего
    }
  }

  /**
   * Поворот вокруг капота, а не вокруг середины кузова.
   *
   * Центр масс у машины впереди, над мотором: доворачивая, она держит нос на
   * месте, а корму выносит наружу. Вращай мы её вокруг середины, нос и зад
   * расходились бы в разные стороны поровну — так вертится стол на колёсиках, а
   * не машина. Поэтому после доворота кузов сдвигается так, чтобы точка у капота
   * осталась там же, где была.
   */
  _pivot(yawBefore, location) {
    const turned = this.yaw - yawBefore;
    if (Math.abs(turned) < 1e-6) return;

    const ahead = CFG.pivotAhead;
    const p = this.root.position;
    p.x += (Math.sin(yawBefore) - Math.sin(this.yaw)) * ahead;
    p.z += (Math.cos(yawBefore) - Math.cos(this.yaw)) * ahead;

    // Вынесенную корму не пускаем в забор: сдвиг тоже проходит расхождение.
    location.obstacles.resolve(p, CFG.radius);
    location.clampPosition(p);
    p.y = CFG.height;
  }

  /**
   * Газ и доворот носа.
   *
   * Стик задаёт направление в осях экрана — те же оси, в которых ходит герой,
   * поэтому и переводятся они так же. Машина разворачивает нос к этому
   * направлению со своей скоростью и едет туда, куда уже смотрит: пока корпус
   * доворачивает, её сносит прежним курсом.
   */
  _drive(dt, move, cameraYaw = 0, fromKeys = false) {
    if (fromKeys) this._driveKeys(dt, move);
    else this._driveStick(dt, move, cameraYaw);

    this.root.rotation.y = this._facing;
  }

  /**
   * Стик: куда отклонён — туда машина и едет, носом вперёд.
   *
   * Стик задаёт направление в осях экрана — те же оси, в которых ходит герой,
   * поэтому и переводится он так же. Машина разворачивает нос к этому
   * направлению со своей скоростью и едет туда, куда уже смотрит.
   */
  _driveStick(dt, move, cameraYaw) {
    const push = Math.min(1, Math.hypot(move?.x ?? 0, move?.y ?? 0));
    if (push <= 0.001) {
      this._coast(dt);
      return;
    }

    // «вперёд» — от камеры от нас, «вправо» — поперёк ему: как у героя.
    const fx = Math.sin(cameraYaw), fz = Math.cos(cameraYaw);
    const wx = fx * move.y - fz * move.x;
    const wz = fz * move.y + fx * move.x;

    const want = Math.atan2(wx, wz);

    // Доворот носа по кратчайшей дуге. Стоящая машина вертится лениво,
    // разогнанная — охотно: руль работает от скорости, а не сам по себе.
    let turn = want - this.yaw;
    while (turn > Math.PI) turn -= 2 * Math.PI;
    while (turn < -Math.PI) turn += 2 * Math.PI;

    const speed = this.velocity.length();

    // Стик заведён назад, а машина уже почти встала — значит упёрлась, и
    // разворачиваться ей негде. Тогда она пятится, не доворачивая: так
    // выезжают из угла и в жизни.
    if (Math.abs(turn) > THREE.MathUtils.degToRad(CFG.reverseAngle) && speed < CFG.reverseBelow) {
      _dir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      this.velocity.copy(_dir).multiplyScalar(-CFG.maxReverse);
      return;
    }

    const agility = CFG.turnStill + (1 - CFG.turnStill) * Math.min(1, speed / CFG.turnFullAt);
    const step = CFG.turnSpeed * agility * dt;
    this.yaw += THREE.MathUtils.clamp(turn, -step, step);

    this._push(dt, CFG.maxSpeed * (1 - this.slowed));
  }

  /**
   * Клавиши: как в машине, а не как в меню.
   *
   * W тянет вперёд — туда, куда смотрит капот, а не вверх по экрану. S — назад.
   * A и D — руль влево и вправо относительно самой машины. На стике так нельзя:
   * там палец показывает, куда ехать, а не как крутить руль. На клавишах же
   * «куда ехать по экрану» превращало бы поворот трассы в перебор четырёх
   * кнопок, а не в руление.
   *
   * Руль, как и у настоящей машины, работает только на ходу — на месте колёса
   * корпус не вертят, — а задним ходом ведёт наоборот.
   */
  _driveKeys(dt, move) {
    const throttle = Math.sign(move?.y ?? 0);
    const steer = Math.sign(move?.x ?? 0);

    _dir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const along = this.velocity.dot(_dir);

    if (steer) {
      const grip = Math.min(1, Math.abs(along) / CFG.turnFullAt);
      const backwards = along < -0.1 ? -1 : 1;
      // Направо — это уменьшение курса: курс отсчитывается от +Z против часовой.
      this.yaw -= steer * backwards * CFG.turnSpeed * grip * dt;
    }

    if (throttle > 0) this._push(dt, CFG.maxSpeed * (1 - this.slowed));
    else if (throttle < 0) this._push(dt, -CFG.maxReverse);
    else this._coast(dt);
  }

  /**
   * Ход раскладывается на две части: вдоль корпуса и поперёк него.
   *
   * Вдоль — это тяга, постоянная, как шаг героя. Поперёк — это занос. Колёса
   * гасят его сами, но не мгновенно, и тем хуже, чем быстрее машина идёт. Пока
   * он не погас, её несёт боком. Общий бюджет хода один: сколько ушло вбок,
   * столько не достанется движению вдоль.
   *
   * Разгон. Полный ход не появляется в тот же кадр, что и нажатие: машина его
   * набирает. Отпустил газ — она встала или сбросила скорость, нажал снова —
   * разгоняется заново, с той скорости, на которой её застало нажатие. Так
   * каждый новый газ чувствуется тягой, а не телепортом на полную скорость.
   *
   * @param {number} pull — ход вдоль корпуса, к которому тянемся; минус — задним ходом
   */
  _push(dt, pull) {
    _dir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));   // вдоль корпуса
    _side.set(_dir.z, 0, -_dir.x);                          // и поперёк него

    const speed = this.velocity.length();
    const lateral = this.velocity.dot(_side);

    // Прибавить за кадр можно не больше, чем даёт разгон; сбросить — сразу.
    const reach = Math.min(Math.abs(pull), speed + CFG.accel * dt);
    pull = Math.sign(pull) * reach;

    const loose = Math.min(1, speed / CFG.maxSpeed);
    const grip = CFG.grip * (1 - loose * (1 - CFG.gripAtSpeed));
    const slip = lateral * Math.max(0, 1 - grip * dt);

    const ahead = Math.sign(pull) * Math.sqrt(Math.max(0, pull * pull - slip * slip));
    this.velocity.copy(_dir).multiplyScalar(ahead).addScaledVector(_side, slip);
  }

  /**
   * Газ отпущен — машина встаёт, но не в тот же кадр: короткий накат, около
   * трети секунды и пары метров. Мгновенная остановка читалась как удар о стену,
   * а у машины должен остаться вес.
   */
  _coast(dt) {
    const brake = CFG.stopBrake * dt;
    const speed = this.velocity.length();
    if (speed <= brake) this.velocity.set(0, 0, 0);
    else this.velocity.multiplyScalar((speed - brake) / speed);
  }

  /**
   * Проехать шаг и разойтись с тем, во что нельзя въехать.
   *
   * Путь за кадр разбивается на короткие подшаги, и препятствия проверяются на
   * каждом. Иначе на полном ходу машина проходит за кадр целый метр и проскакивает
   * забор насквозь: расхождение считается по одной конечной точке, а в ней она уже
   * снаружи — и уезжает в чистое поле.
   */
  _roll(dt, location) {
    if (!this.moving) return;

    const path = this.velocity.length() * dt;
    const steps = Math.max(1, Math.ceil(path / CFG.stepMax));
    const piece = path / steps;
    _dir.copy(this.velocity).normalize(); // едем туда, куда несёт, а не куда смотрим

    _from.copy(this.root.position);
    _step.copy(_from);
    const speed = this.velocity.length();
    let touched = false; // коснулась ли за этот кадр чего-то твёрдого

    for (let i = 0; i < steps; i++) {
      _wanted.copy(_step).addScaledVector(_dir, piece);
      const wx = _wanted.x, wz = _wanted.z;
      location.obstacles.resolve(_wanted, CFG.radius);
      location.clampPosition(_wanted);

      // Препятствие отодвинуло — значит упёрлась: забор, машина, дом.
      if (Math.hypot(_wanted.x - wx, _wanted.z - wz) > CFG.crashTouch) touched = true;

      // Куда бы расхождение ни отодвинуло — принимаем: вдоль стены машина
      // скользит, а не встаёт. Останавливать её на каждом касании забора нельзя,
      // иначе задетый на повороте отбойник отнимает весь ход разом.
      _step.copy(_wanted);
    }

    // А вот если за весь кадр она почти не сдвинулась — значит упёрлась носом, и
    // держать скорость незачем: газ в стену только прижимает к ней плотнее.
    const moved = _from.distanceTo(_step);
    if (moved < path * CFG.bumpGap) this.velocity.multiplyScalar(CFG.bumpKeep);

    // Удар — это миг касания, а не всё время, пока скребёт вдоль стены: иначе
    // звук шёл бы очередью, пока машина трётся о забор.
    if (touched && !this.touching && speed > CFG.crashFrom) this.onCrash?.(speed);
    this.touching = touched;

    this.root.position.copy(_step);
    this.root.position.y = CFG.height;
  }

  /**
   * Что попало под машину.
   *
   * Сбивает с любого бока — по кругу вокруг корпуса, а не одним носом. Порог по
   * скорости: ползущая машина зомби только расталкивает, и это верно на ощупь —
   * задавить кого-то, трогаясь с места, было бы странно.
   */
  _ram(location) {
    if (this.speed < CFG.ramSpeed) return;

    for (const zombie of location.zombies) {
      if (!zombie.alive) continue;
      if (zombie === location.boss) continue; // вожака машиной не берут

      const dx = zombie.position.x - this.root.position.x;
      const dz = zombie.position.z - this.root.position.z;
      if (Math.hypot(dx, dz) > CFG.ramRadius) continue;

      // Кровь летит от машины наружу, а не наоборот: сбитого отбрасывает от
      // капота, и брызги идут туда же.
      if (zombie.crush(this.root.position, CFG.gore, 'impact')) {
        this.onRam?.(zombie.position.clone(), this.speed);
        // Тело гасит ход, но не останавливает. Мгновенный толчок — чтобы удар
        // почувствовался сразу, — и спад, который держится ещё долю секунды:
        // без него постоянная скорость возвращалась в тот же кадр, и сбитых
        // словно не было. Толпа подряд копит спад, но не до полной остановки.
        this.slowed = Math.min(CFG.ramSlowMax, this.slowed + CFG.ramSlow);
        this.velocity.multiplyScalar(1 - CFG.ramSlow);
      }
    }
  }

  /** Жизни кончились: машина встала намертво. */
  /**
   * Жизни кончились: машина встала — и взрывается не сразу.
   *
   * Сначала она отмигивает красным, как мигает всякий, кого ударили, и только
   * потом рвётся. Взорвись она в тот же кадр — кузов пропадал бы раньше, чем
   * вспышка успевала мелькнуть, и последний удар выглядел бы как все прочие.
   *
   * Всё это время герой ещё внутри, а для зомби машина уже мертва — бить её
   * больше незачем.
   */
  _wreck() {
    this.wrecked = true;
    this.velocity.set(0, 0, 0);
    this.hitFlash?.trigger();
    this.wreckIn = CONFIG.hitFlash.duration;
  }

  /** Отмигала — взрыв, и герой выходит. */
  _blowUp() {
    this.wreckIn = 0;
    this.driving = false;
    this.onWreck?.(this.root?.position.clone() ?? null);
  }
}
