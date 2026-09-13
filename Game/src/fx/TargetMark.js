import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { ABOVE_SILHOUETTE } from './Silhouette.js';

const CFG = CONFIG.aimMark;

/**
 * Отметка цели: кольцо на земле под тем, в кого персонаж целится.
 *
 * Раздувать модель по нормалям, чтобы получить контур, на низкополигональных
 * фигурах нельзя — у соседних граней нормали смотрят в разные стороны, и вместо
 * ровной каймы модель разлетается лоскутами. Кольцо от геометрии не зависит
 * вовсе: читается на любом фоне, не ломается в анимации и стоит одного меша на
 * всю сцену, ведь цель всегда одна.
 *
 * Рисуется оно в два прохода. Открытая часть подчиняется глубине как обычный
 * предмет на земле, а то, что скрыто преградой, проступает вторым, приглушённым
 * кольцом — и только там, где скрыто. Простое «поверх всего» тут не годится:
 * метка лезла бы поверх зомби, стоящих ближе к камере.
 */
export class TargetMark {
  constructor(scene) {
    const geometry = new THREE.RingGeometry(CFG.radius - CFG.width, CFG.radius, 40);
    geometry.rotateX(-Math.PI / 2); // положить на землю

    // Открытая часть кольца — обычный меш со своим местом в глубине: его
    // закрывает всё, что стоит ближе, как и любой предмет на земле.
    this.mesh = this._ring(scene, geometry, {
      opacity: CFG.opacity,
      renderOrder: 0,
    });

    // И призрак за преградой — тем же приёмом, что и контур фигуры: рисуется
    // только там, где кольцо оказалось ДАЛЬШЕ уже нарисованного.
    //
    // Он намеренно непрозрачный: прозрачные объекты рисуются последними, уже
    // после всех фигур, и кольцо проступало прямо по ногам зомби, которого само
    // же и метит. Непрозрачный идёт в общем проходе и встаёт на свой слой —
    // перед фигурами, но после окружения.
    this.ghost = this._ring(scene, geometry, {
      color: CONFIG.silhouette.zombieColor, // в тон контуру того, кого метим
      renderOrder: ABOVE_SILHOUETTE - 1,
      depthFunc: THREE.GreaterDepth,
    });
  }

  _ring(scene, geometry, { opacity, color, renderOrder, depthFunc }) {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      color: color ?? CFG.color,
      transparent: opacity !== undefined,
      opacity: opacity ?? 1,
      depthWrite: false,
      depthFunc: depthFunc ?? THREE.LessEqualDepth,
      side: THREE.DoubleSide,
      fog: false,
    }));

    mesh.name = 'targetMark';
    mesh.visible = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = renderOrder;
    scene.add(mesh);
    return mesh;
  }

  /** @param {{position: THREE.Vector3, alive?: boolean} | null} target — кто на прицеле */
  update(target) {
    // Труп не цель: помечать его незачем, а пока он оседает и уходит под землю,
    // кольцо ещё какое-то время ездило бы за ним.
    const marked = target?.alive === false ? null : target;

    this.mesh.visible = Boolean(marked);
    this.ghost.visible = Boolean(marked);
    if (!marked) return;

    const at = marked.position;
    this.mesh.position.set(at.x, at.y + CFG.height, at.z);
    this.ghost.position.copy(this.mesh.position);
  }
}
