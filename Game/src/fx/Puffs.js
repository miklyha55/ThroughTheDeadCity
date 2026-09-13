import * as THREE from 'three';
import { CONFIG } from '../config.js';

const CFG = CONFIG.puffs;

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();

/**
 * Пыль из-под ног: облачко, которое вскидывается при каждом шаге и оседает.
 *
 * Частицы лежат в общей пачке и рисуются за один вызов, сколько бы их ни летело.
 * Живут они недолго и почти не двигаются вбок — это не взвесь в воздухе, а
 * именно след удара подошвы о сухую землю: вверх, в стороны и вниз.
 */
export class Puffs {
  constructor(scene) {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({
      color: CFG.color,
      roughness: 1,
      metalness: 0,
      transparent: true,
      opacity: CFG.opacity,
      depthWrite: false,
    });

    this.mesh = new THREE.InstancedMesh(geometry, material, CFG.pool);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);

    this.grains = [];
    for (let i = 0; i < CFG.pool; i++) {
      this.grains.push({
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        size: 0,
        life: 0,
        maxLife: 1,
      });
    }

    this._next = 0;
    this._hide();
  }

  _hide() {
    _scale.setScalar(0);
    _matrix.compose(_position.set(0, -1000, 0), _quaternion.identity(), _scale);
    for (let i = 0; i < CFG.pool; i++) this.mesh.setMatrixAt(i, _matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Взбить пыль в точке.
   * @param {THREE.Vector3} at — где ступила нога
   */
  burst(at) {
    const count = CFG.minGrains + Math.floor(Math.random() * (CFG.maxGrains - CFG.minGrains + 1));

    for (let i = 0; i < count; i++) {
      const grain = this.grains[this._next];
      this._next = (this._next + 1) % CFG.pool;

      grain.position.set(
        at.x + (Math.random() - 0.5) * CFG.spread,
        at.y + CFG.height,
        at.z + (Math.random() - 0.5) * CFG.spread
      );

      // в стороны слабо, вверх заметно: подошва бьёт вниз, пыль идёт вверх
      grain.velocity.set(
        (Math.random() - 0.5) * CFG.scatter,
        CFG.lift * (0.5 + Math.random()),
        (Math.random() - 0.5) * CFG.scatter
      );

      grain.size = CFG.minSize + Math.random() * (CFG.maxSize - CFG.minSize);
      grain.life = CFG.life * (0.7 + Math.random() * 0.6);
      grain.maxLife = grain.life;
    }
  }

  update(dt) {
    let alive = false;

    for (let i = 0; i < this.grains.length; i++) {
      const grain = this.grains[i];
      if (grain.life <= 0) continue;

      alive = true;
      grain.life -= dt;

      grain.velocity.y -= CFG.gravity * dt;
      grain.velocity.x *= CFG.drag;
      grain.velocity.z *= CFG.drag;
      grain.position.addScaledVector(grain.velocity, dt);

      if (grain.position.y < CFG.floorY) grain.position.y = CFG.floorY;

      // к концу жизни пылинка растёт и тает — облачко расходится
      const left = Math.max(0, grain.life / grain.maxLife);
      _scale.setScalar(grain.size * (1 + (1 - left) * CFG.growth) * Math.min(1, left * 3));

      _matrix.compose(grain.position, _quaternion.identity(), _scale);
      this.mesh.setMatrixAt(i, _matrix);

      if (grain.life <= 0) {
        _scale.setScalar(0);
        _matrix.compose(_position.set(0, -1000, 0), _quaternion.identity(), _scale);
        this.mesh.setMatrixAt(i, _matrix);
      }
    }

    if (alive) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
