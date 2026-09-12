import * as THREE from 'three';

/**
 * Ввод движения. Единственный источник — экранный джойстик:
 * x — вбок, y — вперёд, длина 0..1.
 */
export class Input {
  /** @param {{value: THREE.Vector2, active: boolean}} joystick */
  constructor(joystick) {
    this.joystick = joystick;
    this.move = new THREE.Vector2();
  }

  update() {
    if (this.joystick?.active) this.move.copy(this.joystick.value);
    else this.move.set(0, 0);
  }
}
