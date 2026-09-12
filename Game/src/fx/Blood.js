import * as THREE from 'three';
import { CONFIG } from '../config.js';

const CFG = CONFIG.blood;

const _direction = new THREE.Vector3();
const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();

/**
 * Брызги от попадания: капли вылетают из раны, летят по дуге и тают.
 *
 * Все капли — экземпляры одной геометрии в общей пачке, поэтому вся кровь на
 * сцене рисуется за один вызов, сколько бы её ни летело.
 */
export class Blood {
  constructor(scene) {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({
      color: CFG.color,
      roughness: 0.45,
      metalness: 0,
      emissive: new THREE.Color(CFG.color).multiplyScalar(CFG.glow),
    });

    this.mesh = new THREE.InstancedMesh(geometry, material, CFG.poolSize);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);

    // все капли начинают спрятанными: нулевой размер не видно
    this.drops = [];
    for (let i = 0; i < CFG.poolSize; i++) {
      this.drops.push({
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        spin: new THREE.Euler(),
        size: 0,
        life: 0,
      });
    }
    this._next = 0;
    this._hide();
  }

  _hide() {
    _scale.setScalar(0);
    _matrix.compose(_position.set(0, -1000, 0), _quaternion.identity(), _scale);
    for (let i = 0; i < CFG.poolSize; i++) this.mesh.setMatrixAt(i, _matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Брызги из точки попадания.
   * @param {THREE.Vector3} at — куда попали
   * @param {THREE.Vector3} from — откуда прилетело: капли летят дальше по ходу пули
   */
  splash(at, from) {
    _direction.subVectors(at, from).setY(0);
    if (_direction.lengthSq() < 1e-6) _direction.set(0, 0, 1);
    _direction.normalize();

    const count = CFG.minDrops + Math.floor(Math.random() * (CFG.maxDrops - CFG.minDrops + 1));

    for (let i = 0; i < count; i++) {
      const drop = this.drops[this._next];
      this._next = (this._next + 1) % CFG.poolSize;

      drop.position.copy(at);
      // немного вразнобой вокруг раны, иначе капли выходят одной струёй
      drop.position.x += (Math.random() - 0.5) * CFG.spread;
      drop.position.y += (Math.random() - 0.5) * CFG.spread;
      drop.position.z += (Math.random() - 0.5) * CFG.spread;

      // основная часть летит по ходу пули, остальное — в стороны и вверх
      drop.velocity
        .copy(_direction)
        .multiplyScalar(CFG.speed * (0.5 + Math.random()))
        .add(new THREE.Vector3(
          (Math.random() - 0.5) * CFG.scatter,
          Math.random() * CFG.lift,
          (Math.random() - 0.5) * CFG.scatter
        ));

      drop.spin.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      drop.size = CFG.minSize + Math.random() * (CFG.maxSize - CFG.minSize);
      drop.life = CFG.life * (0.7 + Math.random() * 0.6);
      drop.maxLife = drop.life;
    }
  }

  update(dt) {
    let alive = false;

    for (let i = 0; i < this.drops.length; i++) {
      const drop = this.drops[i];
      if (drop.life <= 0) continue;

      alive = true;
      drop.life -= dt;

      drop.velocity.y -= CFG.gravity * dt;
      drop.position.addScaledVector(drop.velocity, dt);

      // упала на землю — там и остаётся, доживая свой срок
      if (drop.position.y <= CFG.floorY) {
        drop.position.y = CFG.floorY;
        drop.velocity.set(0, 0, 0);
      }

      drop.spin.x += dt * 4;
      drop.spin.z += dt * 3;

      // к концу жизни капля съёживается — так она исчезает без резкого пропадания
      const t = Math.max(0, drop.life / drop.maxLife);
      _scale.setScalar(drop.size * Math.min(1, t * 2));

      _quaternion.setFromEuler(drop.spin);
      _matrix.compose(drop.position, _quaternion, _scale);
      this.mesh.setMatrixAt(i, _matrix);

      if (drop.life <= 0) {
        _scale.setScalar(0);
        _matrix.compose(_position.set(0, -1000, 0), _quaternion.identity(), _scale);
        this.mesh.setMatrixAt(i, _matrix);
      }
    }

    if (alive) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
