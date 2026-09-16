import * as THREE from 'three';
import { CONFIG } from '../config.js';

const CFG = CONFIG.pointer;
const _to = new THREE.Vector3();

/**
 * Стрелка под ногами героя: куда идти дальше.
 *
 * Ведёт по списку целей. Цель — это не только точка на карте, но и подсветка под
 * самой вещью: круг на полу, по которому видно, что её берут. Обе метки живут
 * здесь, а не в самих вещах, и это главное свойство — вещь ничего не знает о
 * том, что она сейчас цель, и не таскает за собой подсветку на все случаи.
 *
 * Взяли цель — указатель переходит к следующей. Кончились — стрелка гаснет
 * вместе с подсветкой, и дальше игрок идёт сам.
 *
 * Годится всё, у чего есть место: и живой предмет со сцены, и просто точка.
 */
export class Pointer {
  /**
   * @param {THREE.Object3D} carrier — за кем ездит стрелка: обычно персонаж
   * @param {THREE.Object3D} scene — где рисовать подсветку: она стоит в мире,
   *   а не на герое, и ездить вместе с ним не должна
   */
  constructor(carrier, scene) {
    this.scene = scene;
    this.mesh = this._buildArrow();
    this.halo = this._buildHalo();

    scene.add(this.halo);
    this.attach(carrier);

    this.targets = [];  // очередь: ведём к первой, взяли — переходим к следующей
    this.time = 0;
  }

  /**
   * Пересесть на другого носителя.
   *
   * Нужно после пересборки моделей: персонаж там создаётся заново, а стрелка
   * осталась бы на выброшенном и пропала бы с экрана.
   *
   * @param {THREE.Object3D} carrier
   */
  attach(carrier) {
    if (!carrier) return;
    carrier.add(this.mesh);
  }

  /** Треугольник носом вперёд, с выемкой сзади: так видно, где у него перёд. */
  _buildArrow() {
    const shape = new THREE.Shape();
    const half = CFG.width / 2;

    shape.moveTo(0, CFG.length / 2);
    shape.lineTo(half, -CFG.length / 2);
    shape.lineTo(0, -CFG.length / 2 + CFG.notch);
    shape.lineTo(-half, -CFG.length / 2);
    shape.closePath();

    const mesh = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshBasicMaterial({
        color: CFG.color,
        transparent: true,
        opacity: CFG.opacity,
        depthWrite: false, // лежит на полу и не спорит с ним за глубину
      })
    );

    mesh.name = 'pointer';
    mesh.rotation.x = -Math.PI / 2; // плашмя на землю
    mesh.renderOrder = 2;
    mesh.visible = false;
    return mesh;
  }

  /** Круг под самой целью: по нему видно, что эту вещь и надо взять. */
  _buildHalo() {
    const mesh = new THREE.Mesh(
      new THREE.CircleGeometry(CFG.haloRadius, 32),
      new THREE.MeshBasicMaterial({
        color: CFG.color,
        transparent: true,
        opacity: CFG.haloOpacity,
        depthWrite: false,
      })
    );

    mesh.name = 'pointer:halo';
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 1;
    mesh.visible = false;
    return mesh;
  }

  /**
   * Задать очередь целей. Ведём к первой из списка.
   *
   * Цель описывается так:
   *
   *   { at, halo, within }
   *
   * `at` — куда вести: предмет со сцены или просто точка.
   * `halo` — подсвечивать ли её кругом на полу. У вещи, которую надо поднять,
   *   круг нужен: по нему и видно, что её берут. У двери — нет: она и так на
   *   виду, а круг под ней читался бы как «встань сюда».
   * `within` — с какого расстояния показывать стрелку, в метрах. Без него она
   *   висит всё время; с ним появляется, только когда герой подошёл. Это для
   *   целей вроде выхода: вести к нему через всю карту незачем, он и так
   *   известен, а вот у самой двери напомнить полезно.
   *
   * Можно передать и просто предмет — тогда это цель с подсветкой и без радиуса,
   * самый частый случай.
   *
   * @param {Array} targets
   */
  follow(targets = []) {
    this.targets = targets.filter(Boolean).map((one) => (
      one.at ? one : { at: one, halo: true }
    ));

    this.lit = false; // горит ли стрелка сейчас: по этому и разводятся пороги
    this._show(false); // покажемся в ближайшем кадре, когда посчитаем расстояние
  }

  /** Куда ведём прямо сейчас. */
  get target() { return this.targets[0] ?? null; }

  /** Есть ли ещё куда вести. */
  get active() { return this.targets.length > 0; }

  _show(on, halo = on) {
    this.mesh.visible = on;
    this.halo.visible = on && halo;
  }

  /**
   * @param {number} dt
   * @param {number} carrierYaw — куда развёрнут сам герой: стрелка живёт внутри
   *   него и унаследовала бы его поворот, а показывать должна в мир
   */
  update(dt, carrierYaw = 0) {
    const target = this.target;
    if (!target) {
      this._show(false);
      return;
    }

    this.time += dt;

    // Стрелка ездит на персонаже, и без него ей не от чего отмерять направление.
    // Между пересборкой персонажа и переносом стрелки на нового такой кадр
    // случается — раньше он падал.
    if (!this.mesh.parent) return;

    const spot = target.at;
    const at = spot.position ?? spot;
    const carrier = this.mesh.parent.position;

    _to.set(at.x - carrier.x, 0, at.z - carrier.z);
    const away = _to.length();

    /**
     * Стрелка горит в кольце: не слишком далеко и не вплотную.
     *
     * Дальняя граница есть не у всех целей — ружьё видно с любого края
     * площадки, а к выходу вести через всю карту незачем. Ближняя одна на всех:
     * подойдя к цели, стрелка гаснет, иначе она мечется вокруг ног на каждом
     * шаге, показывая то влево, то вправо.
     *
     * Обе границы двойные: взятое держится дальше, чем берётся, и отпущенное
     * подбирается ближе, чем отпускается. Иначе на самой черте стрелка мигала
     * бы на каждом шаге.
     */
    const far = target.within
      ? target.within * (this.lit ? (CFG.exitKeep ?? 1.2) : 1)
      : Infinity;
    const near = this.lit ? CFG.hideWithin : CFG.showBeyond;

    const reached = away <= far;
    this.lit = reached && away >= near;

    /**
     * Круг под целью гаснет только по дальней границе, ближняя его не касается.
     *
     * Это разные подсказки. Стрелка говорит, куда идти, и вплотную мешает;
     * круг говорит, что вот эта самая вещь — та, за которой шли, и нужен он как
     * раз вблизи, когда игрок на неё наступает.
     */
    this.mesh.visible = this.lit;
    this.halo.visible = reached && target.halo !== false;

    if (!reached) return;

    // Подсветка стоит под самой вещью и дышит — неподвижный круг на полу
    // читается как часть пола.
    if (target.halo !== false) {
      this.halo.position.set(at.x, CFG.haloHeight, at.z);
      this.halo.material.opacity = CFG.haloOpacity + Math.sin(this.time * CFG.pulseSpeed) * CFG.pulse;
    }

    if (!this.lit || away < 1e-3) return;

    // Стрелка сидит на герое и вертится вместе с ним, поэтому его собственный
    // разворот вычитаем: в мире она должна смотреть на цель, а не мимо.
    const yaw = Math.atan2(_to.x, _to.z) - carrierYaw;

    /**
     * Крутим по своей оси Z — но с поправкой на пол-оборота.
     *
     * Форма нарисована носом вверх по плоскости, а уложена на пол разворотом на
     * четверть оборота. После этого её «верх» смотрит НАЗАД, а не вперёд, и
     * знак вращения меняется на обратный. Без добавки стрелка показывала ровно
     * в противоположную сторону.
     */
    this.mesh.rotation.z = yaw + Math.PI;

    // Отодвинута от ног в ту же сторону, куда показывает: под самим героем её
    // не видно, а впереди она ещё и подсказывает направление своим местом.
    this.mesh.position.set(Math.sin(yaw) * CFG.offset, CFG.height, Math.cos(yaw) * CFG.offset);
    this.mesh.material.opacity = CFG.opacity + Math.sin(this.time * CFG.pulseSpeed) * CFG.pulse;
  }

  /** Отпустить своё: геометрия и материалы у обеих меток собственные. */
  dispose() {
    for (const mesh of [this.mesh, this.halo]) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }
}
