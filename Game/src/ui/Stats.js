import { CONFIG } from '../config.js';

const CFG = CONFIG.stats;

/**
 * Счётчик кадров и вызовов отрисовки.
 *
 * Нужен не разработчику за столом, а на телефоне: там нет ни консоли, ни
 * профилировщика под рукой, а просадку надо видеть прямо во время игры.
 *
 * Кадры считаются за окно в полсекунды, а не по последнему промежутку: мгновенный
 * FPS скачет от каждой случайной задержки, и по нему ничего не понять.
 *
 * Показания снимаются несколько раз в секунду — чаще их всё равно не прочитать,
 * а правка текста в DOM сама по себе стоит кадра.
 */
export class Stats {
  constructor(container = document.body) {
    this.root = document.createElement('div');
    this.root.className = 'stats';
    container.appendChild(this.root);

    this.frames = 0;
    this.since = performance.now();
    this.worst = Infinity;
  }

  /** @param {THREE.WebGLRenderer} renderer — у него и спрашиваем про отрисовку */
  update(renderer) {
    this.frames++;

    const now = performance.now();
    const passed = now - this.since;
    if (passed < CFG.window) return;

    const fps = (this.frames * 1000) / passed;
    this.worst = Math.min(this.worst, fps);

    const draw = renderer.info.render;
    this.root.textContent =
      `${fps.toFixed(0)} к/с   мин ${this.worst.toFixed(0)}   `
      + `вызовов ${draw.calls}   ${(draw.triangles / 1000).toFixed(0)}к тр.`;

    this.frames = 0;
    this.since = now;
  }
}
