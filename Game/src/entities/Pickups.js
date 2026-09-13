import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { arcPoint } from '../core/arc.js';

const CFG = CONFIG.pickup;

const _target = new THREE.Vector3();

/**
 * Подбираемые припасы: коробки патронов, лежащие по локации.
 *
 * Пока персонаж далеко, коробка просто лежит и медленно крутится. Стоит подойти
 * вплотную — она срывается с места и летит к нему по дуге, на лету уменьшаясь;
 * патроны засчитываются в тот момент, когда она до него долетела, а не когда он
 * её коснулся. Так подбор виден, а не случается молча.
 */
export class Pickups {
  constructor() {
    this.items = [];
  }

  /**
   * @param {THREE.Object3D} object — уже размещённая на локации модель
   * @param {number} ammo — сколько патронов в ней лежит
   */
  add(object, ammo) {
    this.items.push({
      object,
      ammo,
      flying: 0,             // сколько уже летит, с; ноль — значит лежит
      from: new THREE.Vector3(),
      scale: object.scale.x, // свой у каждой: в полёте от него и пляшем
    });
  }

  update(dt, player) {
    if (!player.alive) return;

    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      const at = item.object.position;

      if (item.flying > 0) {
        item.flying += dt;
        const share = Math.min(1, item.flying / CFG.flyFor);

        // цель движется: коробка догоняет персонажа, а не летит в его старый след
        _target.copy(player.position).setY(player.position.y + CFG.catchHeight);
        arcPoint(at, item.from, _target, share, CFG.arc);

        item.object.rotation.y += CFG.spin * dt;

        // Размер держим свой до самого конца и сжимаем только на последней
        // четверти пути — коробка исчезает в руках, а не уменьшается всю дорогу.
        const fade = Math.max(0, (share - (1 - CFG.shrinkShare)) / CFG.shrinkShare);
        item.object.scale.setScalar(item.scale * Math.max(0.01, 1 - fade));

        if (share < 1) continue;

        player.ammo += item.ammo;
        item.object.removeFromParent();
        this.items.splice(i, 1);
        continue;
      }

      // лежит: медленно поворачивается, чтобы её было видно среди хлама
      item.object.rotation.y += CFG.idleSpin * dt;

      const dx = at.x - player.position.x;
      const dz = at.z - player.position.z;
      if (Math.hypot(dx, dz) > CFG.reach) continue;

      item.flying = 1e-6;
      item.from.copy(at);
    }
  }
}
