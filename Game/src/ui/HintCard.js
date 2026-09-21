/**
 * Карточка-подсказка внизу экрана: общий ход для всех туторов игры.
 *
 * Сами подсказки разные — одна учит водить героя, другая машину, — а ведут
 * себя они одинаково: всплывают снизу, показываются один раз за сеанс, сами
 * уходят и растворяются, а не пропадают (резкое исчезновение читается как сбой
 * отрисовки). Раньше весь этот ход лежал внутри подсказки по управлению, и
 * второй такой же пришлось бы переписать рядом — со своими таймерами, которые
 * однажды разойдутся.
 *
 * Мимо карточки можно играть, не закрывая: нажатия она не ловит, а слушает со
 * стороны.
 *
 * Чем наполнить карточку и когда её закрывать, решает наследник.
 */
export class HintCard {
  /**
   * @param {HTMLElement} container
   * @param {object} timing
   * @param {number} timing.armAfter — с до того, как подсказка начнёт слушать нажатия
   * @param {number} timing.holdFor — с, сколько висит, если игрок ничего не делает
   * @param {number} timing.fadeFor — с на растворение; столько же длится переход в стилях
   * @param {boolean} [timing.closeOnInput] — уходить ли по первому действию игрока.
   *   Подсказке по управлению это к месту: движение и есть знак, что игрок
   *   разобрался. А там, где написано, чего не делать, — нет: игрок за рулём
   *   трогается сразу, и подсказка исчезла бы непрочитанной.
   */
  constructor(container = document.body, { armAfter, holdFor, fadeFor, closeOnInput = true }) {
    this.timing = { armAfter, holdFor, fadeFor };
    this.closeOnInput = closeOnInput;

    this.root = document.createElement('div');
    this.root.className = 'hint';
    this.root.hidden = true;

    this.card = document.createElement('div');
    this.card.className = 'hint__card';

    this.root.appendChild(this.card);
    container.appendChild(this.root);

    this.shown = false;
    this.done = false;
    this._timer = null;
    this._fade = null;
  }

  /**
   * Наполнить карточку перед показом. Наследник переопределяет, если содержимое
   * зависит от того, чем играют: клавишами или пальцем.
   */
  _prepare() {}

  /**
   * Показать — один раз за сеанс.
   *
   * Второй показ был бы навязчивостью: игрок уже знает, что ему сказали, а на
   * перезапуске уровня подсказка лезла бы снова и снова.
   */
  show() {
    if (this.done || this.shown) return;

    this._prepare();

    this.shown = true;
    this.root.hidden = false;

    // Кадр на то, чтобы браузер заметил появление: без него переход
    // прозрачности не с чего начинать, и карточка возникнет рывком.
    requestAnimationFrame(() => this.root.classList.add('hint--on'));

    /**
     * Слушать нажатия начинаем не сразу.
     *
     * Подсказка всплывает по действию игрока — по концу вступления, по посадке
     * за руль, — а палец с экрана снимается не мгновенно: карточка успевала
     * появиться и погаснуть в один и тот же тап, так что игрок видел вспышку.
     */
    this._timer = setTimeout(() => {
      if (this.closeOnInput) {
        for (const event of EVENTS) addEventListener(event, this._close, { once: true });
      }

      // И сама уходит, если её просто разглядывают: висеть поверх боя она не
      // должна.
      this._timer = setTimeout(this._close, this.timing.holdFor * 1000);
    }, this.timing.armAfter * 1000);
  }

  _close = () => {
    if (!this.shown || this.done) return;

    this.done = true;
    clearTimeout(this._timer);
    for (const event of EVENTS) removeEventListener(event, this._close);

    // Сперва растворяется, и только потом уходит из разметки: снятая сразу,
    // она моргнула бы.
    this.root.classList.remove('hint--on');
    this._fade = setTimeout(() => { this.root.hidden = true; }, this.timing.fadeFor * 1000);
  };

  /** Убрать немедленно и навсегда: например, открылась правка расстановки. */
  hide() {
    clearTimeout(this._timer);
    clearTimeout(this._fade);
    for (const event of EVENTS) removeEventListener(event, this._close);

    this.done = true;
    this.root.classList.remove('hint--on');
    this.root.hidden = true;
  }
}

const EVENTS = ['pointerdown', 'touchstart', 'keydown'];
