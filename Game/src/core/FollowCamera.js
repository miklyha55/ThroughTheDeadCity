import * as THREE from 'three';
import { CONFIG } from '../config.js';

const CFG = CONFIG.camera;
const DEG = Math.PI / 180;

/**
 * Изометрическая камера: жёсткий угол обзора, движется только следом за целью.
 * Ракурс задан парой yaw/pitch из конфига — классические 45° / 30°.
 */
export class FollowCamera {
  constructor(camera, target) {
    this.camera = camera;
    this.target = target;
    this.yaw = CFG.yaw * DEG;
    this.pitch = CFG.pitch * DEG;

    // смещение камеры от цели — постоянное, меняется только точка, за которой следим
    const horizontal = Math.cos(this.pitch) * CFG.distance;
    this._offset = new THREE.Vector3(
      Math.sin(this.yaw) * horizontal,
      Math.sin(this.pitch) * CFG.distance,
      Math.cos(this.yaw) * horizontal
    );

    this._focus = new THREE.Vector3().copy(target.position).setY(CFG.lookAtHeight);
    this.camera.position.copy(this._focus).add(this._offset);
    this.camera.lookAt(this._focus);

    this._desiredFocus = new THREE.Vector3();
  }

  /** Направление «вперёд по камере» для управления персонажем. */
  get moveYaw() { return this.yaw + Math.PI; }

  update(dt) {
    this._desiredFocus.copy(this.target.position).setY(this.target.position.y + CFG.lookAtHeight);

    const k = 1 - Math.exp(-CFG.damping * dt);
    this._focus.lerp(this._desiredFocus, k);

    this.camera.position.copy(this._focus).add(this._offset);
    this.camera.lookAt(this._focus);
  }
}
