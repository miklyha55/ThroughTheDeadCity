import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { batchSkinned } from '../world/batching.js';

const CFG = CONFIG.player;

/** Персонаж: модель, миксер анимаций и движение по земле. */
export class Player {
  constructor(gltf) {
    // семнадцать материалов персонажа сводятся к нескольким — по блеску и металлу
    this.root = batchSkinned(gltf.scene);
    this.root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false; // скиннинг ломает bounding box в bind-позе
      }
    });

    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = new Map();
    for (const clip of gltf.animations) {
      if (clip.name.startsWith('Armature|')) continue; // служебный клип из mixamo-экспорта
      this.actions.set(clip.name, this.mixer.clipAction(clip));
    }

    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.current = null;
    this.play('Idle', 0);

    this._desired = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
  }

  get position() { return this.root.position; }

  /** Ставит персонажа в точку старта локации, гася движение. */
  placeAt(position, yaw = 0) {
    this.root.position.copy(position);
    this.yaw = yaw;
    this.root.rotation.y = yaw;
    this.velocity.set(0, 0, 0);
    this.play('Idle', 0);
  }

  /** Плавно переключает анимацию, если она ещё не играет. */
  play(name, fade = 0.2) {
    const next = this.actions.get(name);
    if (!next || next === this.current) return;
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (this.current) this.current.fadeOut(fade);
    this.current = next;
  }

  /**
   * @param {number} dt
   * @param {THREE.Vector2} move — ввод: x вбок, y вперёд, длина 0..1
   * @param {number} cameraYaw — направление камеры, чтобы «вперёд» было от камеры
   */
  update(dt, move, cameraYaw) {
    // «вперёд» — от камеры к персонажу, «вправо» — векторное произведение forward × up
    this._forward.set(Math.sin(cameraYaw), 0, Math.cos(cameraYaw));
    this._right.set(-this._forward.z, 0, this._forward.x);

    // Стик задаёт только направление: длина отклонения на скорость не влияет,
    // иначе на промежуточных положениях ручки персонаж плёлся бы медленнее.
    this._desired
      .set(0, 0, 0)
      .addScaledVector(this._forward, move.y)
      .addScaledVector(this._right, move.x);

    if (this._desired.lengthSq() > 0) this._desired.normalize().multiplyScalar(CFG.runSpeed);

    // ни разгона, ни выбега — скорость появляется и пропадает мгновенно
    this.velocity.copy(this._desired);

    const speed = this.velocity.length();
    this.root.position.addScaledVector(this.velocity, dt);

    // корпус доворачивается к направлению движения по кратчайшей дуге
    if (speed > 0) {
      const target = Math.atan2(this.velocity.x, this.velocity.z);
      let delta = target - this.yaw;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      this.yaw += delta * (1 - Math.exp(-CFG.turnSpeed * dt));
      this.root.rotation.y = this.yaw;
    }

    if (speed > 0) {
      this.play('Run', 0.15);
      // темп клипа под скорость бега, чтобы стопы не скользили
      this.current.timeScale = CFG.runSpeed / CFG.runClipSpeed;
    } else {
      this.play('Idle', 0.25);
      this.current.timeScale = 1;
    }

    this.mixer.update(dt);
  }
}
