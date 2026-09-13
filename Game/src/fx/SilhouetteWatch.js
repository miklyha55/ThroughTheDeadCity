import * as THREE from 'three';
import { CONFIG } from '../config.js';

const CFG = CONFIG.silhouette;
const _look = new THREE.Vector3();

/**
 * Кого сейчас загораживает высокий предмет.
 *
 * Правило одно: силуэт проступает, только если фигуру перекрыло чем-то выше её
 * самой. Дом, вышка, фура — да; куст, легковушка, забор — нет, поверх них фигуру
 * и так видно. Считать это на видеокарте нечем: ей всё равно, что там впереди,
 * поэтому решение принимается здесь — лучом от макушки фигуры к камере по
 * контурам `location.cover`, куда попадают только предметы нужной высоты.
 *
 * Другие фигуры в расчёт не входят вовсе, значит зомби, вставший перед
 * персонажем, подсветку не включит. Земля тоже: её в этих контурах нет.
 */
export class SilhouetteWatch {
  constructor(camera) {
    this.camera = camera;
  }

  update(location, player) {
    // камера ортографическая: луч к ней одинаков из любой точки сцены
    this.camera.getWorldDirection(_look);

    const flat = Math.hypot(_look.x, _look.z) || 1;
    const ux = -_look.x / flat;    // к камере по земле
    const uz = -_look.z / flat;
    const slope = -_look.y / flat; // на столько луч поднимается за метр пути

    this._apply(player, location, ux, uz, slope);
    for (const zombie of location.zombies) this._apply(zombie, location, ux, uz, slope);
  }

  _apply(figure, location, ux, uz, slope) {
    if (!figure.silhouette) return;

    const at = figure.position;
    const hidden = location.cover.blocksView(
      at.x, at.y + CFG.height, at.z, ux, uz, slope, CFG.viewDistance
    );

    figure.silhouette.setVisible(hidden);
  }
}
