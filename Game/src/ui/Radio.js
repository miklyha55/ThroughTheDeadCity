import { CONFIG } from '../config.js';

const CFG = CONFIG.radio;

/**
 * Рация в углу экрана: показывается, пока идёт сообщение по связи.
 *
 * Нужна, чтобы голос из ниоткуда стал понятен: экран замер, персонаж не идёт —
 * и видно почему. Появляется и уходит прозрачностью: мгновенное включение
 * картинки в углу читается как сбой отрисовки, а плавное — как вызов на связь.
 *
 * Покачивается всё время, пока говорят. Неподвижная картинка в углу выглядит
 * наклейкой на стекле, а качающаяся — вещью, которую держат в руке.
 */
export class Radio {
  constructor(container = document.body) {
    this.element = document.createElement('img');
    this.element.className = 'radio';
    this.element.src = CFG.image;
    this.element.alt = '';       // украшение, а не содержание: читалке тут нечего сказать
    this.element.decoding = 'async';

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
