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

    this.orbit = 0; // доворот вокруг цели: копится, пока персонаж мёртв

    this._focus = new THREE.Vector3().copy(target.position).setY(CFG.lookAtHeight);
    this.camera.position.copy(this._focus).add(this._offset);

    // Погиб — камера идёт по кругу, не отводя от него взгляда. Ракурс при этом
    // остаётся тем же: меняется только сторона, с которой мы смотрим.
    if (this.target.alive === false) {
      this.orbit += CFG.orbitSpeed * dt;

      const horizontal = Math.cos(this.pitch) * CFG.distance;
      const angle = this.yaw + this.orbit;

      this._offset.set(
        Math.sin(angle) * horizontal,
        Math.sin(this.pitch) * CFG.distance,
        Math.cos(angle) * horizontal
      );
      this.camera.position.copy(this._focus).add(this._offset);
    }

    // Тряска смещает саму камеру, а не точку интереса: кадр дёргается, но
    // продолжает смотреть туда же, и после затухания встаёт ровно как был.
    if (this._shake > 0) {
      this._shake = Math.max(0, this._shake - dt);

      const left = this._shake / this._shakeFor;
      const amount = this._shakePower * left * left; // к концу затихает мягко

      this.camera.position.x += (Math.random() - 0.5) * 2 * amount;
      this.camera.position.y += (Math.random() - 0.5) * 2 * amount;
      this.camera.position.z += (Math.random() - 0.5) * 2 * amount;

      if (this._shake === 0) this._shakePower = 0;
    }

    this.camera.lookAt(this._focus);

    this._desiredFocus = new THREE.Vector3();
    this._shake = 0;      // сколько тряски осталось, с
    this._shakeFor = 1;   // за сколько она затухает
    this._shakePower = 0; // и с какой амплитуды начиналась
  }

  /**
   * Тряхнуть камеру. Сильные толчки не складываются, а перебивают слабые:
   * два взрыва подряд не должны раскачивать кадр вдвое.
   */
  shake(power, seconds) {
    if (power <= this._shakePower && this._shake > 0) return;
    this._shake = seconds;
    this._shakeFor = seconds;
    this._shakePower = power;
  }

  /**
   * Сдвинуть взгляд по земле, не меняя ракурса. Нужно правке локации: там
   * камера не следит за персонажем, а гуляет сама.
   *
   * Сдвиг задаётся в осях экрана — «вправо» значит вправо для зрителя, а не по
   * оси мира: иначе стрелки на изометрии вели бы наискосок.
   */
  pan(right, forward) {
    const angle = this.moveYaw;

    // «Вправо» — векторное произведение «вперёд» на «вверх»; знаки именно такие,
    // иначе стрелки влево и вправо меняются местами.
    this._focus.x += Math.sin(angle) * forward - Math.cos(angle) * right;
    this._focus.z += Math.cos(angle) * forward + Math.sin(angle) * right;

    this.camera.position.copy(this._focus).add(this._offset);
    this.camera.lookAt(this._focus);
  }

  /** Направление «вперёд по камере» для управления персонажем. */
  get moveYaw() { return this.yaw + Math.PI; }

  update(dt) {
    this._desiredFocus.copy(this.target.position).setY(this.target.position.y + CFG.lookAtHeight);

    // Линейно: камера идёт к цели с постоянной скоростью и останавливается,
    // как только пришла. Затухание оставляло бы за персонажем шлейф — кажется,
    // будто он продолжает бежать после того, как встал.
    this._focus.sub(this._desiredFocus);
    const away = this._focus.length();

    if (away <= CFG.followSpeed * dt) this._focus.set(0, 0, 0);
    else this._focus.multiplyScalar(1 - (CFG.followSpeed * dt) / away);

    this._focus.add(this._desiredFocus);

    this.camera.position.copy(this._focus).add(this._offset);

    // Погиб — камера идёт по кругу, не отводя от него взгляда. Ракурс при этом
    // остаётся тем же: меняется только сторона, с которой мы смотрим.
    if (this.target.alive === false) {
      this.orbit += CFG.orbitSpeed * dt;

      const horizontal = Math.cos(this.pitch) * CFG.distance;
      const angle = this.yaw + this.orbit;

      this._offset.set(
        Math.sin(angle) * horizontal,
        Math.sin(this.pitch) * CFG.distance,
        Math.cos(angle) * horizontal
      );
      this.camera.position.copy(this._focus).add(this._offset);
    }

    // Тряска смещает саму камеру, а не точку интереса: кадр дёргается, но
    // продолжает смотреть туда же, и после затухания встаёт ровно как был.
    if (this._shake > 0) {
      this._shake = Math.max(0, this._shake - dt);

      const left = this._shake / this._shakeFor;
      const amount = this._shakePower * left * left; // к концу затихает мягко

      this.camera.position.x += (Math.random() - 0.5) * 2 * amount;
      this.camera.position.y += (Math.random() - 0.5) * 2 * amount;
      this.camera.position.z += (Math.random() - 0.5) * 2 * amount;

      if (this._shake === 0) this._shakePower = 0;
    }

    this.camera.lookAt(this._focus);
  }
}
