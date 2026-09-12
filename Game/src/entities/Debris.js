import * as THREE from 'three';
import { CONFIG } from '../config.js';

const CFG = CONFIG.debris;

/**
 * Разлетающаяся мелочь: бочки, ящики, покрышки, конусы.
 * Персонаж пинает их на бегу, дальше они летят, катятся, отскакивают от стен,
 * зданий и друг от друга и постепенно замирают.
 */
export class Debris {
  constructor(location) {
    this.location = location;
    this.items = [];
    this._before = new THREE.Vector3();
    this._normal = new THREE.Vector3();
  }

  add(object, radius) {
    this.items.push({
      object,
      radius,
      velocity: new THREE.Vector3(),
      spin: new THREE.Vector3(),
      restY: object.position.y, // высота, на которой предмет лежал изначально
      asleep: true,
    });
  }

  /**
   * @param {number} dt
   * @param {THREE.Vector3} playerPosition
   * @param {number} playerRadius
   * @param {THREE.Vector3} playerVelocity
   */
  update(dt, playerPosition, playerRadius, playerVelocity) {
    const playerSpeed = Math.hypot(playerVelocity.x, playerVelocity.z);

    for (const item of this.items) {
      this._kick(item, playerPosition, playerRadius, playerSpeed);
      if (!item.asleep) this._step(item, dt);
    }
    this._separate();
  }

  /** Касание персонажа — предмет получает импульс от него прочь. */
  _kick(item, playerPosition, playerRadius, playerSpeed) {
    const position = item.object.position;
    let dx = position.x - playerPosition.x;
    let dz = position.z - playerPosition.z;
    const distance = Math.hypot(dx, dz);
    const touch = item.radius + playerRadius;
    if (distance > touch) return;

    if (distance > 1e-4) {
      dx /= distance;
      dz /= distance;
    } else {
      dx = 1;
      dz = 0;
    }

    // на бегу пинок сильнее, но и стоя на месте предмет сдвинется, а не застрянет в персонаже
    const power = CFG.kick * (CFG.minKickShare + (1 - CFG.minKickShare) * Math.min(1, playerSpeed / CONFIG.player.runSpeed));

    item.velocity.x += dx * power;
    item.velocity.z += dz * power;
    item.velocity.y = Math.max(item.velocity.y, CFG.lift);
    item.spin.set(
      (Math.random() - 0.5) * CFG.spin,
      (Math.random() - 0.5) * CFG.spin,
      (Math.random() - 0.5) * CFG.spin
    );
    item.asleep = false;

    // выносим из персонажа, иначе он будет толкать предмет каждый кадр
    position.x = playerPosition.x + dx * touch;
    position.z = playerPosition.z + dz * touch;
  }

  _step(item, dt) {
    const { object, velocity, spin } = item;
    const position = object.position;

    velocity.y -= CFG.gravity * dt;
    this._before.copy(position);
    position.addScaledVector(velocity, dt);

    // земля
    if (position.y <= item.restY) {
      position.y = item.restY;
      if (velocity.y < -CFG.bounceThreshold) {
        velocity.y = -velocity.y * CFG.bounce;
      } else {
        velocity.y = 0;
      }
      const slowdown = Math.exp(-CFG.friction * dt); // трение качения
      velocity.x *= slowdown;
      velocity.z *= slowdown;
      spin.multiplyScalar(slowdown);
    }

    object.rotation.x += spin.x * dt;
    object.rotation.y += spin.y * dt;
    object.rotation.z += spin.z * dt;

    this._collide(item);

    if (position.y <= item.restY + 1e-3 && velocity.lengthSq() < CFG.sleepSpeed * CFG.sleepSpeed) {
      velocity.set(0, 0, 0);
      spin.set(0, 0, 0);
      item.asleep = true;
    }
  }

  /** Отскок от зданий, техники, забора и границ площадки. */
  _collide(item) {
    const position = item.object.position;
    const { obstacles } = this.location;

    this._before.copy(position);
    obstacles.resolve(position, item.radius);
    this.location.clampPosition(position);

    this._normal.set(position.x - this._before.x, 0, position.z - this._before.z);
    const pushed = this._normal.length();
    if (pushed < 1e-5) return;

    this._normal.divideScalar(pushed);
    const along = item.velocity.dot(this._normal);
    if (along < 0) {
      // зеркалим скорость относительно стены и гасим удар
      item.velocity.addScaledVector(this._normal, -along * (1 + CFG.restitution));
      item.velocity.multiplyScalar(CFG.wallDamping);
    }
  }

  /** Предметы расталкивают друг друга — куча покрышек разлетается целиком. */
  _separate() {
    const items = this.items;
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      for (let j = i + 1; j < items.length; j++) {
        const b = items[j];
        if (a.asleep && b.asleep) continue;

        const pa = a.object.position;
        const pb = b.object.position;
        const dx = pb.x - pa.x;
        const dz = pb.z - pa.z;
        const gap = a.radius + b.radius;
        const distanceSq = dx * dx + dz * dz;
        if (distanceSq > gap * gap || distanceSq < 1e-8) continue;
        if (Math.abs(pb.y - pa.y) > gap) continue; // лежат друг на друге — не мешают

        const distance = Math.sqrt(distanceSq);
        const nx = dx / distance;
        const nz = dz / distance;
        const overlap = (gap - distance) / 2;

        pa.x -= nx * overlap;
        pa.z -= nz * overlap;
        pb.x += nx * overlap;
        pb.z += nz * overlap;

        // передаём часть импульса соседу, чтобы удар шёл по цепочке
        const share = CFG.transfer;
        const av = a.velocity.x * nx + a.velocity.z * nz;
        const bv = b.velocity.x * nx + b.velocity.z * nz;
        const exchange = (av - bv) * share;
        if (exchange > 0) {
          a.velocity.x -= nx * exchange;
          a.velocity.z -= nz * exchange;
          b.velocity.x += nx * exchange;
          b.velocity.z += nz * exchange;
          a.asleep = false;
          b.asleep = false;
        }
      }
    }
  }
}
