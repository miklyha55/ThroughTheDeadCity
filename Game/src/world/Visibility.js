import * as THREE from 'three';
import { CONFIG } from '../config.js';

const CFG = CONFIG.visibility;

/**
 * Кого рисовать, а кого нет.
 *
 * Режем только по экрану: чего нет в кадре, того и не видно, и выключить такую
 * вещь можно без последствий для картинки.
 *
 * По расстоянию до персонажа не режем намеренно. Такая проверка тут была и
 * оказалась неверной: туман войны прорезается насовсем, и однажды пройденное
 * место остаётся открытым, даже когда герой ушёл от него на другой конец
 * площадки. Предметы в этом открытом коридоре видно — а отсечение по радиусу их
 * гасило, и они мигали на глазах: отошёл — пропали, вернулся — появились. Круг
 * тумана вдобавок шире кадра, так что и выигрыша та проверка почти не давала.
 *
 * Почему не полагаемся на встроенное отсечение three: у скина оно считает сферу
 * по bind-позе, центр которой может лежать где угодно — в ступнях, в тазу, а при
 * экспорте без применения трансформаций и вовсе в стороне от модели. Отсюда и
 * прежние рывки: фигура пропадала, когда часть её ещё была в кадре.
 */
export class Visibility {
  constructor(camera) {
    this.camera = camera;
    this.frustum = new THREE.Frustum();
    this.matrix = new THREE.Matrix4();
    this.sphere = new THREE.Sphere();
  }

  /** @param {import('./Location.js').Location} location */
  update(location) {
    // Матрицы камеры пересчитывает рендер, и на этот момент они ещё от прошлого
    // кадра. Для проверки края экрана это важно: обновляем их сами.
    this.camera.updateMatrixWorld();
    this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();

    this.matrix.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.matrix);

    for (const zombie of location.zombies) {
      // Крупная фигура и сферу получает крупнее: вожака иначе гасило бы, пока
      // его голова ещё в кадре.
      const size = zombie.sizeScale ?? 1;
      this.sphere.center.set(zombie.position.x, CFG.height * size, zombie.position.z);
      this.sphere.radius = CFG.figureRadius * size;
      zombie.root.visible = this._seen();
    }

    // Крупное, что просвечивает, живёт отдельными объектами и в общий меш не
    // слито — значит его можно гасить поштучно. Это и есть главный выигрыш: на
    // заправке таких домов семнадцать, и они дают больше половины всех вызовов.
    for (const item of location.seeThrough?.items ?? []) {
      if (!item.sphere) continue;

      this.sphere.copy(item.sphere);
      item.object.visible = this._seen();
    }

    for (const item of location.debris.items) {
      if (item.held) continue;

      this.sphere.center.copy(item.object.position);
      this.sphere.radius = item.radius + CFG.figureRadius;
      item.object.visible = this._seen();
    }
  }

  /**
   * Попадает ли вещь в кадр.
   *
   * Проверяется шар вокруг неё, а не точка: пока хоть край её виден, вещь
   * остаётся. Иначе высокий дом гас бы на глазах, когда его основание уже ушло
   * за границу, а крыша ещё в кадре.
   *
   * Шар вдобавок раздут на `shadowReach`: тень от того, что стоит сразу за
   * краем экрана, падает внутрь кадра, и гасить такую вещь нельзя — пропала бы
   * вместе с ней и её тень.
   */
  _seen() {
    const kept = this.sphere.radius;

    this.sphere.radius = kept + CFG.shadowReach;
    const inFrame = this.frustum.intersectsSphere(this.sphere);
    this.sphere.radius = kept;

    return inFrame;
  }
}
