import * as THREE from 'three';
import { CONFIG } from '../config.js';

const CFG = CONFIG.car;

const _dir = new THREE.Vector3();
const _step = new THREE.Vector3();

/**
 * Таран: машина, которой проезжается шоссе перед вожаком.
 *
 * Стоит у обочины в начале уровня, стрелка ведёт к ней. Герой подошёл — сел, и
 * с этого мгновения игра другая: стрельбы нет, есть руль. Обратно не выйти —
 * уровень задуман как один долгий проезд, и выпускать из машины посреди дороги
 * значило бы отдать игроку пеший бой там, где под это ничего не разложено.
 *
 * Ведут её так же, как героя: куда отклонён стик, туда она и едет — и всегда
 * носом вперёд. Отличие от героя одно и всё в нём: нос доворачивается не
 * мгновенно, а со своей скоростью, и пока корпус разворачивается, машина по
 * инерции ещё катится прежним курсом. Отсюда и вес, и заносы на изломах.
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
    this.drive = 0;        // м/с вдоль корпуса; минус — задний ход
    this.yaw = 0;

    this.wrecked = false;
    this.onHealth = null;  // кому показывать полоску жизней
    this.onRam = null;     // кого сбили: сюда уходят тряска и звук
    this.onWreck = null;   // машина догорела: герою пора вылезать
    this.onBoard = null;   // и кому сказать, что в неё сели
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
  get moving() { return Math.abs(this.drive) > 0.1; }

  // Этим её видят обломки на дороге: разлетаются они от всякого, кто движется,
  // и машина для них — такой же ходок, только шире и быстрее.
  get radius() { return CFG.radius; }
  get speed() { return Math.abs(this.drive); }

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

    this.driving = false;
    this.wrecked = false;
    this.health = CFG.health;
    this.drive = 0;
  }

  /** Снять со сцены: уровень сменился. */
  clear() {
    this.root?.removeFromParent();
    this.root = null;
    this.object = null;
    this.driving = false;
    this.wrecked = false;
    this.drive = 0;
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
   */
  update(dt, move, cameraYaw, location) {
    if (!this.root || !this.driving || this.wrecked) return;

    this._drive(dt, move, cameraYaw);
    this._roll(dt, location);
    this._ram(location);
  }

  /**
   * Газ и доворот носа.
   *
   * Стик задаёт направление в осях экрана — те же оси, в которых ходит герой,
   * поэтому и переводятся они так же. Машина разворачивает нос к этому
   * направлению со своей скоростью и едет туда, куда уже смотрит: пока корпус
   * доворачивает, её сносит прежним курсом.
   */
  _drive(dt, move, cameraYaw = 0) {
    const push = Math.min(1, Math.hypot(move?.x ?? 0, move?.y ?? 0));

    if (push > 0.001) {
      // «вперёд» — от камеры от нас, «вправо» — поперёк ему: как у героя.
      const fx = Math.sin(cameraYaw), fz = Math.cos(cameraYaw);
      const wx = fx * move.y - fz * move.x;
      const wz = fz * move.y + fx * move.x;

      const want = Math.atan2(wx, wz);

      // Доворот по кратчайшей дуге и не быстрее, чем машина умеет. На малом
      // ходу она доворачивает хуже: стоящая на месте разворачивается медленно,
      // разогнанная — охотно.
      let turn = want - this.yaw;
      while (turn > Math.PI) turn -= 2 * Math.PI;
      while (turn < -Math.PI) turn += 2 * Math.PI;

      // Стик заведён назад, а машина уже почти встала — значит она во что-то
      // упёрлась и разворачиваться ей негде. Тогда она пятится, не доворачивая:
      // так выезжают из угла и в жизни.
      const backing = Math.abs(turn) > THREE.MathUtils.degToRad(CFG.reverseAngle)
        && Math.abs(this.drive) < CFG.reverseBelow;

      if (backing) {
        const target = -CFG.maxReverse * push;
        this.drive = Math.max(target, this.drive - CFG.accel * dt);
        this.root.rotation.y = this._facing;
        return;
      }

      const agility = CFG.turnStill
        + (1 - CFG.turnStill) * Math.min(1, Math.abs(this.drive) / CFG.turnFullAt);
      const step = CFG.turnSpeed * agility * dt;
      this.yaw += THREE.MathUtils.clamp(turn, -step, step);

      // Газ тем сильнее, чем дальше отклонён стик. Нос ещё не туда — едем
      // медленнее: разворачиваться на полном ходу машина не умеет.
      const facing = Math.max(0, Math.cos(turn));
      const target = CFG.maxSpeed * push * (CFG.crawlWhileTurning
        + (1 - CFG.crawlWhileTurning) * facing);

      this.drive = target > this.drive
        ? Math.min(target, this.drive + CFG.accel * dt)
        : Math.max(target, this.drive - CFG.brake * dt);
    } else {
      // Стик отпущен — катится накатом и встаёт сама, с какой бы стороны ни шла.
      const drag = CFG.drag * dt;
      this.drive = Math.abs(this.drive) <= drag ? 0 : this.drive - Math.sign(this.drive) * drag;
    }

    this.drive = THREE.MathUtils.clamp(this.drive, -CFG.maxReverse, CFG.maxSpeed);
    this.root.rotation.y = this._facing;
  }

  /** Проехать шаг и разойтись с тем, во что нельзя въехать. */
  _roll(dt, location) {
    if (!this.moving) return;

    _dir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    _step.copy(this.root.position).addScaledVector(_dir, this.drive * dt);

    const before = _step.clone();
    location.obstacles.resolve(_step, CFG.radius);
    location.clampPosition(_step);

    // Уткнулись во что-то твёрдое — скорость гасится, а не сохраняется: иначе
    // машина скребёт по забору, держа полный газ, и таран работает вплотную к
    // стене, куда зомби и прижимаются.
    if (before.distanceToSquared(_step) > CFG.bumpGap * CFG.bumpGap) {
      this.drive *= CFG.bumpKeep;
    }

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
        this.drive *= CFG.ramKeep; // тело гасит ход, но не останавливает
      }
    }
  }

  /** Жизни кончились: машина встала намертво. */
  _wreck() {
    this.wrecked = true;
    this.driving = false;
    this.drive = 0;
    this.onWreck?.(this.root?.position.clone() ?? null);
  }
}
