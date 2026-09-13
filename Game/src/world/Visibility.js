import * as THREE from 'three';
import { CONFIG } from '../config.js';

const CFG = CONFIG.visibility;
const _point = new THREE.Vector3();

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
  }

  /** @param {{zombies: Array}} location */
  update(location) {
    // Матрицы камеры пересчитывает рендер, и на этот момент они ещё от прошлого
    // кадра. Для проверки края экрана это важно: обновляем их сами.
    this.camera.updateMatrixWorld();
    this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();

    for (const zombie of location.zombies) {
      zombie.root.visible = this.onScreen(zombie.position);
    }
  }

  /** Попадает ли точка в кадр с запасом. */
  onScreen(position) {
    _point.set(position.x, position.y + CFG.height, position.z).project(this.camera);

    const limit = 1 + CFG.margin;
    return Math.abs(_point.x) <= limit && Math.abs(_point.y) <= limit;
  }
}
