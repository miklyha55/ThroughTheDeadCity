import * as THREE from 'three';
import { CONFIG } from '../config.js';

const CFG = CONFIG.explosion;

/**
 * Вспышка взрыва: шар огня, раздувающийся и гаснущий, и дымная оболочка следом.
 *
 * Заготовки лежат в пуле и переиспользуются — на взрыв не создаётся ни одного
 * объекта. Света хватает одного на всех: два взрыва подряд в одну точку — редкость,
 * а лишний источник в сцене стоит дороже, чем выигрыш от него.
 */
export class Explosions {
  constructor(scene) {
    const sphere = new THREE.SphereGeometry(1, 16, 12);

    this.blasts = [];
    for (let i = 0; i < CFG.pool; i++) {
      const core = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({
        color: CFG.flashColor,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }));
      const smoke = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({
        color: CFG.smokeColor,
        transparent: true,
        depthWrite: false,
        fog: false,
      }));

      core.visible = false;
      smoke.visible = false;
      core.frustumCulled = false;
      smoke.frustumCulled = false;
      scene.add(core, smoke);

      this.blasts.push({ core, smoke, life: 0 });
    }

    this.light = new THREE.PointLight(CFG.flashColor, 0, CFG.lightDistance, 1.6);
    this.light.castShadow = false;
    scene.add(this.light);
    this._next = 0;
  }

  /** Зажечь взрыв в точке. */
  burst(at) {
    const blast = this.blasts[this._next];
    this._next = (this._next + 1) % this.blasts.length;

    blast.core.position.copy(at);
    blast.smoke.position.copy(at);
    blast.life = CFG.life;

    this.light.position.copy(at);
    this.light.intensity = CFG.lightIntensity;
  }

  update(dt) {
    let lit = false;

    for (const blast of this.blasts) {
      if (blast.life <= 0) continue;

      blast.life -= dt;
      const share = Math.max(0, blast.life / CFG.life); // 1 в начале, 0 в конце
      const grown = CFG.startRadius + (CFG.endRadius - CFG.startRadius) * (1 - share);

      if (blast.life <= 0) {
        blast.core.visible = false;
        blast.smoke.visible = false;
        continue;
      }
      lit = true;

      // ядро раздувается и гаснет быстрее оболочки — остаётся дымный шар
      blast.core.visible = true;
      blast.core.scale.setScalar(grown * 0.75);
      blast.core.material.opacity = share * share;

      blast.smoke.visible = true;
      blast.smoke.scale.setScalar(grown);
      blast.smoke.material.opacity = share * 0.55;
    }

    if (!lit) this.light.intensity = 0;
    else this.light.intensity = Math.max(0, this.light.intensity - (CFG.lightIntensity / CFG.life) * dt);
  }
}
