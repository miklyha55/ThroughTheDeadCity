import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { flatDistance } from '../core/ground.js';

const CFG = CONFIG.visibility;
const _point = new THREE.Vector3();

/**
 * Докуда вообще что-то видно.
 *
 * Дальше этого всё закрыто глухим туманом, и рисовать там нечего. Считается от
 * самого тумана, а не отдельным числом: подкрутишь ему радиус — отсечение
 * уедет следом, и в кадре не появится дыра.
 */
const SEEN_FAR = CONFIG.fog.radius + CONFIG.fog.feather + CFG.fogMargin;

/**
 * Кого рисовать, а кого нет.
 *
 * Фигура проверяется по экрану, а не по расстоянию: её положение переводится в
 * экранные координаты, и если оно ушло за край с запасом — фигура выключается
 * целиком, вместе с её тенью.
 *
 * Почему не полагаемся на встроенное отсечение three: у скина оно считает сферу
 * по bind-позе, центр которой может лежать где угодно — в ступнях, в тазу, а при
 * экспорте без применения трансформаций и вовсе в стороне от модели. Отсюда и
 * прежние рывки: фигура пропадала, когда часть её ещё была в кадре. Проекция
 * точки, вокруг которой фигура и ходит, таких сюрпризов не даёт.
 *
 * Запас `margin` считается в долях экрана, поэтому одинаково работает и в
 * портрете, и в ландшафте: фигура гаснет, только уйдя заметно за край.
 */
export class Visibility {
  constructor(camera) {
    this.camera = camera;
    this.frustum = new THREE.Frustum();
    this.matrix = new THREE.Matrix4();
    this.sphere = new THREE.Sphere();
  }

  /**
   * @param {import('./Location.js').Location} location
   * @param {{position: THREE.Vector3}} player — от него и отмеряется туман
   */
  update(location, player) {
    // Матрицы камеры пересчитывает рендер, и на этот момент они ещё от прошлого
    // кадра. Для проверки края экрана это важно: обновляем их сами.
    this.camera.updateMatrixWorld();
    this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();

    this.matrix.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.matrix);

    const at = player.position;

    for (const zombie of location.zombies) {
      this.sphere.center.set(zombie.position.x, CFG.height, zombie.position.z);
      this.sphere.radius = CFG.figureRadius;
      zombie.root.visible = this._seen(at);
    }

    // Крупное, что просвечивает, живёт отдельными объектами и в общий меш не
    // слито — значит его можно гасить поштучно. Это и есть главный выигрыш: на
    // заправке таких домов семнадцать, и они дают больше половины всех вызовов.
    for (const item of location.seeThrough?.items ?? []) {
      if (!item.sphere) continue;

      this.sphere.copy(item.sphere);
      item.object.visible = this._seen(at);
    }

    for (const item of location.debris.items) {
      if (item.held) continue;

      this.sphere.center.copy(item.object.position);
      this.sphere.radius = item.radius + CFG.figureRadius;
      item.object.visible = this._seen(at);
    }
  }

  /**
   * Видно ли это вообще: надо попасть и в кадр, и в круг тумана.
   *
   * Одного круга мало — он шире кадра, и по нему почти ничего не отсекается.
   * Одного кадра тоже: за его краем, но в тумане, тоже рисовать незачем. Режет
   * только пересечение этих двух границ.
   *
   * Проверяется шар вокруг вещи, а не точка: пока хоть край её в кадре, она
   * остаётся: иначе высокий дом гас бы на глазах, когда его основание уже ушло
   * за границу, а крыша ещё видна. Шар для проверки кадра ещё и раздут на
   * `shadowReach` — тень от того, что стоит сразу за краем, падает внутрь.
   */
  _seen(player) {
    const kept = this.sphere.radius;

    this.sphere.radius = kept + CFG.shadowReach;
    const inFrame = this.frustum.intersectsSphere(this.sphere);
    this.sphere.radius = kept;

    if (!inFrame) return false;

    return flatDistance(this.sphere.center, player) - kept <= SEEN_FAR;
  }

  /** Попадает ли точка в кадр с запасом. Нужна тем, у кого габаритов нет. */
  onScreen(position) {
    _point.set(position.x, position.y + CFG.height, position.z).project(this.camera);

    const limit = 1 + CFG.margin;
    return Math.abs(_point.x) <= limit && Math.abs(_point.y) <= limit;
  }
}
