import { CONFIG } from '../config.js';

const CFG = CONFIG.ammo;

/**
 * Патроны вверху экрана: по одной гильзе на заряд.
 *
 * Заряженные горят в полную силу, потраченные не исчезают, а гаснут: так видно
 * не только сколько осталось, но и сколько магазин вмещает — а значит, сколько
 * ещё набивать. Убери их совсем, и полоска дёргалась бы в ширине, и считать
 * пришлось бы на глаз.
 *
 * Меняется она редко — на выстрел и на дозарядку, — поэтому перерисовывается по
 * событию, а не каждый кадр.
 */
export class Ammo {
  /** @param {number} size — сколько патронов в магазине */
  constructor(size, container = document.body) {
    this.root = document.createElement('div');
    this.root.className = 'ammo';

    this.cells = [];
    for (let i = 0; i < size; i++) {
      const cell = document.createElement('img');
      cell.className = 'ammo__round';
      cell.src = CFG.image;
      cell.alt = '';
      cell.decoding = 'async';

      this.root.appendChild(cell);
      this.cells.push(cell);
    }

    container.appendChild(this.root);
    this.shown = -1;
  }

  /** @param {number} loaded — сколько патронов в магазине сейчас */
  set(loaded) {
    if (loaded === this.shown) return;

    this.shown = loaded;
    this.cells.forEach((cell, i) => cell.classList.toggle('ammo__round--spent', i >= loaded));
  }
}
