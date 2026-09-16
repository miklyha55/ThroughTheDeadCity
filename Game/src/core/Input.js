import * as THREE from 'three';

/**
 * Ввод движения: экранный джойстик и клавиши WASD.
 *
 * Наружу оба выглядят одинаково — вектор `move`, где x вбок, y вперёд, длина
 * от нуля до единицы. Персонажу всё равно, чем его ведут, и это правильно:
 * игра одна и та же, а телефон и настольная машина просто держат её по-разному.
 *
 * Клавиши не заменяют джойстик, а идут рядом. На гибридной машине бывает и то,
 * и другое, а угадывать по ширине экрана, «телефон это или нет», — гадание:
 * ноутбук с сенсорным экраном ломает любую такую догадку.
 *
 * Стрелки сюда намеренно не входят: ими в правке расстановки ходит камера, а
 * `←` и `→` ещё и поворачивают её. Две разные вещи на одних клавишах спорили бы
 * между собой.
 */

/** Клавиша → куда она толкает: x вбок, y вперёд. */
const KEYS = {
  KeyW: [0, 1],
  KeyS: [0, -1],
  KeyA: [-1, 0],
  KeyD: [1, 0],
};

export class Input {
  /** @param {{value: THREE.Vector2, active: boolean}} joystick */
  constructor(joystick) {
    this.joystick = joystick;
    this.move = new THREE.Vector2();

    // Пока правят расстановку, клавиши принадлежат редактору: там теми же
    // WASD ездит камера, и персонаж уходил бы вместе с ней.
    this.enabled = true;

    this.held = new Set();
    this._keys = new THREE.Vector2();

    addEventListener('keydown', this._onDown);
    addEventListener('keyup', this._onUp);

    // Ушли из окна — отпускаем всё: клавиша, зажатая перед переключением вкладки,
    // иначе осталась бы нажатой навсегда, и персонаж бежал бы в стену.
    addEventListener('blur', this._release);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this._release();
    });
  }

  _onDown = (event) => {
    if (!KEYS[event.code] || event.repeat) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return; // это уже не ход, а команда
    if (isTyping(event.target)) return; // в поле ввода W — это буква

    this.held.add(event.code);
  };

  _onUp = (event) => {
    this.held.delete(event.code);
  };

  _release = () => {
    this.held.clear();
  };

  update() {
    this._keys.set(0, 0);

    if (this.enabled) {
      for (const code of this.held) {
        const [x, y] = KEYS[code];
        this._keys.x += x;
        this._keys.y += y;
      }
    }

    // По диагонали быстрее не бегают: две клавиши вместе дают полтора по длине,
    // и наискосок персонаж уходил бы заметно резвее, чем прямо.
    if (this._keys.lengthSq() > 1) this._keys.normalize();

    // Держат и то, и другое — берём клавиши: джойстик мог просто остаться
    // прижатым пальцем, а нажатие клавиши всегда намеренное.
    if (this._keys.lengthSq() > 0) this.move.copy(this._keys);
    else if (this.joystick?.active) this.move.copy(this.joystick.value);
    else this.move.set(0, 0);
  }
}

/** Пишет ли игрок прямо сейчас: тогда буквы принадлежат полю, а не игре. */
function isTyping(target) {
  if (!target || !target.tagName) return false;

  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}
