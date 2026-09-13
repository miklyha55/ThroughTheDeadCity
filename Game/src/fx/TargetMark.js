import * as THREE from 'three';
import { CONFIG } from '../config.js';

const CFG = CONFIG.aimMark;

/**
 * Отметка цели: кольцо на земле под тем, в кого персонаж целится.
 *
 * Кольцо, а не обводка самой фигуры: обводка на низкополигональных моделях
 * разлетается лоскутами — у соседних граней нормали смотрят в разные стороны.
 * Кольцо от геометрии не зависит вовсе, читается на любом фоне, не ломается в
 * анимации и стоит одного меша на всю сцену: цель всегда одна.
 *
 * Лежит оно именно на земле и подчиняется глубине как обычный предмет: зомби
 * стоит на кольце, а не кольцо на зомби. Отдельного прохода «сквозь стены» ему
 * не нужно — здание, заслонившее цель, просвечивает само.
 */
export class TargetMark {
  constructor(scene) {
    const geometry = new THREE.RingGeometry(CFG.radius - CFG.width, CFG.radius, 40);
    geometry.rotateX(-Math.PI / 2); // положить на землю

    this.mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      color: CFG.color,
      transparent: true,
      opacity: CFG.opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    }));

    this.mesh.name = 'targetMark';
    this.mesh.visible = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);
  }

  /** @param {{position: THREE.Vector3, alive?: boolean} | null} target — кто на прицеле */
  update(target) {
    // Труп не цель: помечать его незачем, а пока он оседает и уходит под землю,
    // кольцо ещё какое-то время ездило бы за ним.
    const marked = target?.alive === false ? null : target;

    this.mesh.visible = Boolean(marked);
    if (!marked) return;

    const at = marked.position;
    this.mesh.position.set(at.x, at.y + CFG.height, at.z);
  }
}
