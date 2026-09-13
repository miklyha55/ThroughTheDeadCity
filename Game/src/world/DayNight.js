import * as THREE from 'three';
import { CONFIG } from '../config.js';

const CFG = CONFIG.dayNight;
const DEG = Math.PI / 180;

const _sky = new THREE.Color();
const _sun = new THREE.Color();
const _ground = new THREE.Color();

/**
 * Смена суток.
 *
 * Время идёт по кругу от 0 до 1, а четыре ключевых момента — рассвет, полдень,
 * закат и полночь — задают, каким в этот момент должно быть небо, солнце и
 * рассеянный свет. Между ними всё перетекает плавно, поэтому картинка меняется
 * непрерывно, а не скачками.
 *
 * Солнце при этом обходит площадку по кругу и поднимается тем выше, чем ближе
 * полдень: длина и направление теней получаются сами собой. Ниже определённой
 * высоты оно не опускается — иначе тени вытянулись бы за карту теней и пропали.
 *
 * Ночью тот же источник играет луну: другой цвет и малая яркость. Отдельного
 * света для неё нет — лишний источник в сцене стоит дороже, чем даёт.
 */
export class DayNight {
  constructor({ scene, sun, hemi, sky, sunOffset }) {
    this.scene = scene;
    this.sun = sun;
    this.hemi = hemi;
    this.sky = sky;          // общий цвет фона и тумана
    this.offset = sunOffset; // его же двигает sun.follow
    this.time = CFG.startAt;

    this.distance = Math.hypot(sunOffset.x, sunOffset.z) || 18;
    this.update(0);
  }

  update(dt) {
    this.time = (this.time + dt / CFG.dayLength) % 1;

    const { from, to, mix } = this._phases();

    _sky.set(from.sky).lerp(_ground.set(to.sky), mix);
    _sun.set(from.sun).lerp(_ground.set(to.sun), mix);

    const height = from.height + (to.height - from.height) * mix;
    const power = from.power + (to.power - from.power) * mix;
    const ambient = from.ambient + (to.ambient - from.ambient) * mix;

    // небо и туман — один цвет: так даль сходится с горизонтом без шва
    this.sky.copy(_sky);
    this.scene.background = this.sky;
    if (this.scene.fog) this.scene.fog.color.copy(_sky);

    this.sun.color.copy(_sun);
    this.sun.intensity = power;
    this.hemi.color.copy(_sky);
    this.hemi.intensity = ambient;

    // светило обходит площадку по кругу — вместе с ним едут и тени
    const angle = this.time * Math.PI * 2;
    this.offset.set(
      Math.cos(angle) * this.distance,
      Math.max(CFG.minHeight, height),
      Math.sin(angle) * this.distance
    );
    this.sun.position.copy(this.sun.target.position).add(this.offset);
  }

  /** Между какими ключевыми моментами сейчас время и насколько близко ко второму. */
  _phases() {
    const list = CFG.phases;

    for (let i = 0; i < list.length; i++) {
      const from = list[i];
      const to = list[(i + 1) % list.length];

      // последний отрезок заворачивается через полночь, поэтому длина считается по кругу
      const span = (to.at - from.at + 1) % 1 || 1;
      const passed = (this.time - from.at + 1) % 1;

      if (passed < span) return { from, to, mix: passed / span };
    }
    return { from: list[0], to: list[0], mix: 0 };
  }
}
