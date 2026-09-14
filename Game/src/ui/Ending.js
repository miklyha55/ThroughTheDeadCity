import { CONFIG } from '../config.js';

const CFG = CONFIG.ending;

/**
 * Финальный экран: картинка, которой кончается игра.
 *
 * Появляется прозрачностью, а не показом: игрок только что вышел через последний
 * проём, и резкая подмена кадра читалась бы как сбой, а не как конец пути.
 * Уходить ему некуда — за ним всё замерло, и дальше играет только музыка.
 *
 * Картинка кроет экран целиком при любом соотношении сторон, как и заставка
 * между уровнями: пустых полей по краям быть не должно.
 */
export class Ending {
  constructor(container = document.body) {
    this.root = document.createElement('div');
    this.root.className = 'ending';
    this.root.style.backgroundImage = `url(${CFG.image})`;
    container.appendChild(this.root);

    this.shown = false;
  }

  show() {
    if (this.shown) return;

    this.shown = true;
    this.root.classList.add('ending--on');
  }
}
