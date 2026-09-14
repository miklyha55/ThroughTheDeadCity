import { CONFIG } from '../config.js';
import { ScreenDust } from '../fx/ScreenDust.js';

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
    container.appendChild(this.root);

    // Песок живёт внутри экрана: показали финал — он пошёл, убрали — замер.
    this.dust = new ScreenDust(this.root);

    this._paint();

    this.shown = false;
  }

  show() {
    if (this.shown) return;

    this.shown = true;
    this.root.classList.add('ending--on');
    this.dust.start();
  }

  /**
   * Перечитать картинку с диска.
   *
   * Файл мог смениться — его копирует та же кнопка «Обновить», что пересобирает
   * модели. Браузер сам об этом не догадается и отдаст старый из кэша, поэтому
   * каждой перечитке свой адрес.
   *
   * До первой перечитки метки нет: адрес должен совпадать с тем, по которому
   * картинку грел загрузчик, иначе она поедет по сети второй раз уже на показе.
   */
  refresh() {
    this.root.style.backgroundImage = `url(${CFG.image}?v=${Date.now()})`;
  }

  /** Первый показ идёт по чистому адресу — тому же, что прогрел загрузчик. */
  _paint() {
    this.root.style.backgroundImage = `url(${CFG.image})`;
  }

  /** Убрать финал: нужно только в панели разработчика, стрелкой обратно. */
  hide() {
    if (!this.shown) return;

    this.shown = false;
    this.root.classList.remove('ending--on');
    this.dust.stop();
  }
}
