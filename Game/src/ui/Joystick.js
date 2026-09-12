import * as THREE from 'three';
import { CONFIG } from '../config.js';

const CFG = CONFIG.joystick;

/**
 * Экранный джойстик: круглая база с ручкой, как в playable-рекламе.
 * Отдаёт value — вектор (x вбок, y вперёд), длина 0..1.
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
    this.side = CFG.side === 'left' ? 'left' : 'right';
    this.base.style[this.side] = `${CFG.margin}px`;
    this.base.style.bottom = `${CFG.margin}px`;

    this.knob = document.createElement('div');
    this.knob.className = 'joystick__knob';
    this.knob.style.width = this.knob.style.height = `${CFG.knobSize}px`;
    this.base.appendChild(this.knob);
    container.appendChild(this.base);

    // Зона захвата шире самой базы — в палец попасть проще, чем в пиксель.
    this.zone = document.createElement('div');
    this.zone.className = 'joystick__zone';
    if (CFG.floating) {
      Object.assign(this.zone.style, { bottom: '0', width: '50%', height: '100%' });
      this.zone.style[this.side] = '0';
    } else {
      const pad = CFG.size * 0.3;
      Object.assign(this.zone.style, {
        bottom: `${CFG.margin - pad}px`,
        width: `${CFG.size + pad * 2}px`,
        height: `${CFG.size + pad * 2}px`,
      });
      this.zone.style[this.side] = `${CFG.margin - pad}px`;
    }
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
    if (CFG.floating) {
      // база прыгает под палец — так в плейблах управлять привычнее
      this.base.style[this.side] = 'auto';
      this.base.style.left = `${e.clientX - CFG.size / 2}px`;
      this.base.style.bottom = `${innerHeight - e.clientY - CFG.size / 2}px`;
    }
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
    if (CFG.floating) {
      this.base.style.left = 'auto';
      this.base.style[this.side] = `${CFG.margin}px`;
      this.base.style.bottom = `${CFG.margin}px`;
    }
  };

  _update(e) {
    const r = this.base.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);

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
