import { CONFIG } from '../config.js';
import { tally } from '../core/tally.js';

const CFG = CONFIG.ending;

/**
 * Финальный экран: картинка, которой кончается игра.
 *
 * Появляется прозрачностью, а не показом: игрок только что вышел через последний
 * проём, и резкая подмена кадра читалась бы как сбой, а не как конец пути.
 *
 * Поверх картинки — титр, итог похода и кнопки. Итог тут не ради цифр: он
 * превращает конец в результат, который можно улучшить, и даёт повод пройти
 * город ещё раз.
 *
 * Картинка кроет экран целиком при любом соотношении сторон, как и заставка
 * между уровнями: пустых полей по краям быть не должно.
 */
export class Ending {
  constructor(container = document.body) {
    this.root = document.createElement('div');
    this.root.className = 'ending';
    container.appendChild(this.root);

    /**
     * Кадр живёт отдельным слоем.
     *
     * На нём медленный наезд, а надписи поверх должны стоять неподвижно: текст,
     * едущий вместе с картинкой, читать нельзя.
     */
    this.frame = document.createElement('div');
    this.frame.className = 'ending__frame';

    this.caption = document.createElement('p');
    this.caption.className = 'ending__caption';
    this.caption.textContent = CFG.caption;

    this.stats = document.createElement('dl');
    this.stats.className = 'ending__stats';
    this.rows = {};

    for (const [key, label] of [
      ['kills', CFG.killsLabel], ['deaths', CFG.deathsLabel], ['time', CFG.timeLabel],
    ]) {
      const name = document.createElement('dt');
      name.textContent = label;

      const value = document.createElement('dd');
      value.textContent = '—';

      this.stats.append(name, value);
      this.rows[key] = value;
    }

    const buttons = document.createElement('div');
    buttons.className = 'ending__buttons';

    this.again = document.createElement('button');
    this.again.className = 'ending__again';
    this.again.type = 'button';
    this.again.textContent = CFG.againLabel;

    // Кнопка оценки появляется, только если площадка готова её принять: вне
    // площадки и у того, кто уже оценил, её нет вовсе.
    this.rate = document.createElement('button');
    this.rate.className = 'ending__rate';
    this.rate.type = 'button';
    this.rate.textContent = CFG.rateLabel;
    this.rate.hidden = true;

    buttons.append(this.again, this.rate);

    this.card = document.createElement('div');
    this.card.className = 'ending__card';
    this.card.append(this.caption, this.stats, buttons);

    this.root.append(this.frame, this.card);

    this.onAgain = null; // пройти город заново
    this.onRate = null;  // и оценить игру: спрашивает площадка, а не мы

    // По отпусканию: нажал — кнопка сжалась, отпустил — сработала.
    this.again.addEventListener('click', (event) => {
      event.preventDefault();
      this.onAgain?.();
    });

    this.rate.addEventListener('click', (event) => {
      event.preventDefault();
      this.rate.hidden = true; // спрашивают один раз
      this.onRate?.();
    });

    this._paint();
    this.shown = false;
  }

  show() {
    if (this.shown) return;

    this.shown = true;

    // Итог снимается в миг показа: к этой минуте часы уже остановлены.
    this.rows.kills.textContent = String(tally.kills);
    this.rows.deaths.textContent = String(tally.deaths);
    this.rows.time.textContent = tally.clock;

    this.root.classList.add('ending--on');
  }

  /** Показать кнопку оценки: площадка сказала, что примет её. */
  offerRate(can) {
    this.rate.hidden = !can;
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
    this.frame.style.backgroundImage = `url(${CFG.image}?v=${Date.now()})`;
  }

  /** Первый показ идёт по чистому адресу — тому же, что прогрел загрузчик. */
  _paint() {
    this.frame.style.backgroundImage = `url(${CFG.image})`;
  }

  /** Убрать финал: нужно только в панели разработчика, стрелкой обратно. */
  hide() {
    if (!this.shown) return;

    this.shown = false;
    this.root.classList.remove('ending--on');
  }
}
