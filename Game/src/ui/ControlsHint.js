import { CONFIG } from '../config.js';

const CFG = CONFIG.controlsHint;

/**
 * Подсказка по управлению: показывается один раз, когда вступление отговорило.
 *
 * Показывать её раньше нельзя — она легла бы поверх субтитров, и читать
 * пришлось бы оба текста разом. Позже уже поздно: игрок к этому времени успеет
 * потыкать в экран и решить, что игра его не слушается.
 *
 * Управление тут разное на разных машинах, и подсказка это учитывает: там, где
 * есть мышь и клавиатура, показываются клавиши, на сенсорном экране — стик.
 * Определяется это не по ширине окна и не по названию браузера, а по тому, чем
 * в это окно тычут: ноутбук с сенсорным экраном ломает любую догадку по размеру.
 *
 * Уходит она по первому же действию игрока, растворяясь, а не пропадая: резкое
 * исчезновение читается как сбой отрисовки. И уходит сама по времени, если
 * игрок просто смотрит на неё и ничего не делает.
 *
 * Мимо неё можно играть, не закрывая: она не ловит нажатия, а слушает их со
 * стороны. Первое касание стика и есть то действие, после которого подсказка
 * больше не нужна.
 */
export class ControlsHint {
  constructor(container = document.body) {
    this.root = document.createElement('div');
    this.root.className = 'hint';
    this.root.hidden = true;

    this.card = document.createElement('div');
    this.card.className = 'hint__card';

    this.keys = buildKeys();
    this.stick = buildStick();

    this.title = document.createElement('p');
    this.title.className = 'hint__title';

    this.note = document.createElement('p');
    this.note.className = 'hint__note';
    this.note.textContent = CFG.note;

    this.tail = document.createElement('p');
    this.tail.className = 'hint__tail';

    this.card.append(this.keys, this.stick, this.title, this.note, this.tail);
    this.root.appendChild(this.card);
    container.appendChild(this.root);

    this.shown = false;
    this.done = false;
    this._timer = null;
    this._fade = null;
  }

  /** Есть ли у машины мышь с клавиатурой — или это сенсорный экран. */
  get keyboard() {
    return matchMedia('(hover: hover) and (pointer: fine)').matches;
  }

  /**
   * Показать — один раз за сеанс.
   *
   * Второй показ был бы навязчивостью: игрок уже знает, как ходить, а на
   * перезапуске уровня подсказка лезла бы снова и снова.
   */
  show() {
    if (this.done || this.shown) return;

    const byKeys = this.keyboard;
    this.keys.hidden = !byKeys;
    this.stick.hidden = byKeys;
    this.title.textContent = byKeys ? CFG.titleKeys : CFG.titleTouch;
    this.tail.textContent = byKeys ? CFG.tailKeys : CFG.tailTouch;

    this.shown = true;
    this.root.hidden = false;

    // Кадр на то, чтобы браузер заметил появление: без него переход
    // прозрачности не с чего начинать, и карточка возникнет рывком.
    requestAnimationFrame(() => this.root.classList.add('hint--on'));

    /**
     * Слушать нажатия начинаем не сразу.
     *
     * Вступление пропускают тем же касанием, а палец с экрана снимается не
     * мгновенно: подсказка успевала появиться и погаснуть в один и тот же тап,
     * так что игрок видел только вспышку.
     */
    this._timer = setTimeout(() => {
      for (const event of EVENTS) addEventListener(event, this._close, { once: true });

      // И сама уходит, если её просто разглядывают: прочитать тут нечего, а
      // висеть поверх боя она не должна.
      this._timer = setTimeout(this._close, CFG.holdFor * 1000);
    }, CFG.armAfter * 1000);
  }

  _close = () => {
    if (!this.shown || this.done) return;

    this.done = true;
    clearTimeout(this._timer);
    for (const event of EVENTS) removeEventListener(event, this._close);

    // Сперва растворяется, и только потом уходит из разметки: снятая сразу,
    // она моргнула бы.
    this.root.classList.remove('hint--on');
    this._fade = setTimeout(() => { this.root.hidden = true; }, CFG.fadeFor * 1000);
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

/** Клавиши: W сверху, A S D под ней — как они и лежат под рукой. */
function buildKeys() {
  const box = document.createElement('div');
  box.className = 'hint__keys';

  const top = document.createElement('div');
  top.className = 'hint__row';
  top.appendChild(key('W'));

  const bottom = document.createElement('div');
  bottom.className = 'hint__row';
  bottom.append(key('A'), key('S'), key('D'));

  box.append(top, bottom);
  return box;
}

function key(letter) {
  const cap = document.createElement('span');
  cap.className = 'hint__key';
  cap.textContent = letter;
  return cap;
}

/** Стик: круг с ручкой, отведённой в сторону, — как его и держат пальцем. */
function buildStick() {
  const box = document.createElement('div');
  box.className = 'hint__stick';

  const base = document.createElement('span');
  base.className = 'hint__base';

  const knob = document.createElement('span');
  knob.className = 'hint__knob';

  base.appendChild(knob);
  box.appendChild(base);
  return box;
}
