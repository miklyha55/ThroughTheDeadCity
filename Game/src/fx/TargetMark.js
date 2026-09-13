import * as THREE from 'three';
import { CONFIG } from '../config.js';

const CFG = CONFIG.aimMark;

/**
 * Отметка цели: кольцо на земле под тем, в кого персонаж целится.
 *
 * Раздувать модель по нормалям, чтобы получить контур, на низкополигональных
 * фигурах нельзя — у соседних граней нормали смотрят в разные стороны, и вместо
 * ровной каймы модель разлетается лоскутами. Кольцо от геометрии не зависит
 * вовсе: читается на любом фоне, не ломается в анимации и стоит одного меша на
 * всю сцену, ведь цель всегда одна.
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
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  /** @param {{position: THREE.Vector3} | null} target — кто сейчас на прицеле */
  update(target) {
    this.mesh.visible = Boolean(target);
    if (!target) return;

    this.mesh.position.set(target.position.x, target.position.y + CFG.height, target.position.z);
  }
}
