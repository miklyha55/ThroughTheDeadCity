import * as THREE from 'three';
import { CONFIG } from '../config.js';

const CFG = CONFIG.joystick;

/**
 * Плавающий джойстик: на экране его не видно, пока к нему не притронулись.
 * Палец опускается в любом месте — там и возникает база, ручка тянется следом.
 * Отпустили — джойстик исчезает.
 */
export class Joystick {
  constructor(container = document.body) {
    this.value = new THREE.Vector2();
    this.active = false;
    this._pointerId = null;
    this._maxDist = CFG.size * 0.5 - CFG.knobSize * 0.5 + CFG.overhang;

    this.base = document.createElement('div');
    this.base.className = 'joystick';
    this.base.style.width = this.base.style.height = `${CFG.size}px`;

    this.knob = document.createElement('div');
    this.knob.className = 'joystick__knob';
    this.knob.style.width = this.knob.style.height = `${CFG.knobSize}px`;
    this.base.appendChild(this.knob);
    container.appendChild(this.base);

    // ловим касание всюду: управление начинается с любой точки экрана
    this.zone = document.createElement('div');
    this.zone.className = 'joystick__zone';
    container.appendChild(this.zone);

    this.zone.addEventListener('pointerdown', this._onDown);
    addEventListener('pointermove', this._onMove, { passive: false });
    addEventListener('pointerup', this._onUp);
    addEventListener('pointercancel', this._onUp);
  }

  _onDown = (e) => {
    if (this.active) return;
    this.active = true;
    this._pointerId = e.pointerId;

    this._originX = e.clientX;
    this._originY = e.clientY;
    this.base.style.left = `${e.clientX - CFG.size / 2}px`;
    this.base.style.top = `${e.clientY - CFG.size / 2}px`;
    this.base.classList.add('is-active');

    this._update(e);
    e.preventDefault();
  };

  _onMove = (e) => {
    if (!this.active || e.pointerId !== this._pointerId) return;
    this._update(e);
    e.preventDefault();
  };

  _onUp = (e) => {
    if (!this.active || e.pointerId !== this._pointerId) return;
    this.active = false;
    this._pointerId = null;
    this.value.set(0, 0);
    this.knob.style.transform = 'translate(-50%, -50%)';
    this.base.classList.remove('is-active');
  };

  _update(e) {
    let dx = e.clientX - this._originX;
    let dy = e.clientY - this._originY;

    const dist = Math.hypot(dx, dy);
    if (dist > this._maxDist) {
      const k = this._maxDist / dist;
      dx *= k;
      dy *= k;
    }
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;

    // мёртвая зона, растянутая обратно на весь диапазон 0..1
    let mag = Math.min(dist, this._maxDist) / this._maxDist;
    mag = mag < CFG.deadZone ? 0 : (mag - CFG.deadZone) / (1 - CFG.deadZone);

    if (mag === 0 || dist === 0) {
      this.value.set(0, 0);
      return;
    }
    this.value.set(dx / dist, -dy / dist).multiplyScalar(mag); // экранный Y вниз → вперёд это -dy
  }
}
