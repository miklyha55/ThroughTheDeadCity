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
    this._moving = false; // уже пошёл: порог возврата у идущего ниже, чем порог старта
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

    // Отпускание ловим всеми способами сразу. Для касаний браузер сам захватывает
    // указатель на элементе, и одного pointerup мало: палец может уйти за край
    // экрана, система может отобрать жест, окно — потерять фокус. Любое из этих
    // событий означает, что стик отпущен, и персонаж обязан встать.
    addEventListener('pointerup', this._onUp);
    addEventListener('pointercancel', this._onUp);
    this.zone.addEventListener('lostpointercapture', this._onUp);
    addEventListener('blur', this._release);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this._release();
    });
  }

  /**
   * Выключить стик целиком — например, на время правки локации: там по сцене
   * щёлкают мышью, и ловить эти щелчки как управление персонажем ни к чему.
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    this.zone.style.pointerEvents = enabled ? '' : 'none';
    if (!enabled) this._release();
  }

  _onDown = (e) => {
    if (this.active || this.enabled === false) return;
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

    // Палец подняли, но событие отпускания потерялось: у события больше нет
    // прижатой кнопки. Считаем это отпусканием, иначе персонаж «поедет» сам.
    if (e.buttons === 0 && e.pointerType !== 'touch') {
      this._release();
      return;
    }
    this._update(e);
    e.preventDefault();
  };

  _onUp = (e) => {
    if (!this.active) return;
    // id не совпал — значит отпустили другой палец, наш ещё на экране
    if (e.pointerId !== undefined && e.pointerId !== this._pointerId) return;
    this._release();
  };

  /** Снимает стик: ввод обнуляется в тот же кадр. */
  _release = () => {
    if (!this.active) return;
    this.active = false;
    this._pointerId = null;
    this._moving = false; // палец снят — следующий раз трогаться заново, с полного порога
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

    const сырая = Math.min(dist, this._maxDist) / this._maxDist;

    // Порогов два, а не один: тронуться сложнее, чем остановиться.
    //
    // С одним порогом палец, замерший ровно на его границе, каждый кадр
    // перекидывал ввод между нулём и движением. Персонаж от этого дёргался,
    // не понимая, бежать ему или стоять: анимация металась между бегом,
    // стойкой и вскинутым ружьём по нескольку раз в секунду.
    //
    // Разведённые пороги такого не допускают: чтобы пойти, палец должен зайти
    // за `deadZone`, а чтобы встать — вернуться за `deadZoneRelease`, который
    // заметно ближе к центру. Между ними ввод держит то, что уже выбрано.
    this._moving = this._moving
      ? сырая >= CFG.deadZoneRelease
      : сырая >= CFG.deadZone;

    // мёртвая зона, растянутая обратно на весь диапазон 0..1
    let mag = this._moving ? (сырая - CFG.deadZone) / (1 - CFG.deadZone) : 0;
    mag = Math.max(0, Math.min(1, mag));

    if (!this._moving || dist === 0) {
      this.value.set(0, 0);
      return;
    }
    this.value.set(dx / dist, -dy / dist).multiplyScalar(mag); // экранный Y вниз → вперёд это -dy
  }
}
