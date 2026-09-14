import { CONFIG } from '../config.js';

const CFG = CONFIG.radio;

/**
 * Рация в углу экрана: показывается, пока идёт сообщение по связи.
 *
 * Нужна, чтобы голос из ниоткуда стал понятен: экран замер, персонаж не идёт —
 * и видно почему. Появляется и уходит прозрачностью: мгновенное включение
 * картинки в углу читается как сбой отрисовки, а плавное — как вызов на связь.
 *
 * Сама рация покачивается, а из-за неё расходятся круги сигнала. Неподвижная
 * картинка в углу выглядит наклейкой на стекле; качание делает её вещью в руке,
 * а круги — говорят, что передача идёт прямо сейчас, а не просто висит значок.
 */
export class Radio {
  constructor(container = document.body) {
    this.element = document.createElement('div');
    this.element.className = 'radio';

    // Круги идут первыми: они за рацией, и порядок в разметке — это и есть
    // порядок слоёв. Их трое, чтобы волна шла непрерывно, а не мигала по одной.
    for (let i = 0; i < CFG.waves; i++) {
      const wave = document.createElement('span');
      wave.className = 'radio__wave';
      this.element.appendChild(wave);
    }

    const image = document.createElement('img');
    image.className = 'radio__set';
    image.src = CFG.image;
    image.alt = '';       // украшение, а не содержание: читалке тут нечего сказать
    image.decoding = 'async';
    this.element.appendChild(image);

    container.appendChild(this.element);
    this.shown = false;
  }

  /** @param {boolean} on — говорят ли сейчас по рации */
  toggle(on) {
    if (on === this.shown) return; // класс дёргать каждый кадр незачем: собьётся качание

    this.shown = on;
    this.element.classList.toggle('radio--on', on);
  }
}
