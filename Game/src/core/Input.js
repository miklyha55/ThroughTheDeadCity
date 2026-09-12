import * as THREE from 'three';

const KEY_MAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
};

/**
 * Источник ввода для движения. Отдаёт вектор move: x — вбок, y — вперёд, длина 0..1.
 * Сейчас читает клавиатуру; экранный джойстик подключится сюда же как второй источник.
 */
export class Input {
  /** @param {{value: THREE.Vector2, active: boolean}} [joystick] — экранный стик, приоритетнее клавиатуры */
  constructor(joystick = null) {
    this.joystick = joystick;
    this.move = new THREE.Vector2();
    this.keys = { up: false, down: false, left: false, right: false };

    addEventListener('keydown', (e) => this._key(e, true));
    addEventListener('keyup', (e) => this._key(e, false));
    addEventListener('blur', () => { for (const k in this.keys) this.keys[k] = false; });
  }

  _key(e, pressed) {
    const name = KEY_MAP[e.code];
    if (!name) return;
    this.keys[name] = pressed;
    e.preventDefault();
  }

  update() {
    if (this.joystick?.active) {
      this.move.copy(this.joystick.value);
      return;
    }
    const x = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
    const y = (this.keys.up ? 1 : 0) - (this.keys.down ? 1 : 0);
    this.move.set(x, y);
    if (this.move.lengthSq() > 1) this.move.normalize();
  }
}
