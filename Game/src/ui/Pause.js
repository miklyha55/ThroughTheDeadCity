import { CONFIG } from '../config.js';
import { buildKeys, buildStick, byKeyboard } from './ControlsHint.js';

const CFG = CONFIG.pause;

/**
 * Пауза: мир встал, а на экране — как им управлять.
 *
 * Ставится с клавиатуры, `Escape`, и снимается им же или `Enter`. Той же
 * клавишей — потому что её и жмут, не глядя, чтобы вернуться в игру; `Enter`
 * остаётся вторым способом, для тех, кто ищет «продолжить».
 *
 * С пропуском речи `Escape` не спорит, и это стоит отдельного слова. Речь
 * пропускается тем же `Escape`, а её слушатели заведены раньше нашего: на одно
 * нажатие сперва обрывалась речь, а следом мы видели уже снятый замок и
 * поднимали экран — игрок пропускал вступление и оказывался на паузе. Поэтому
 * клавиша слушается на погружении: до всех прочих, по состоянию игры, какое
 * было ДО пропуска. Речь идёт — `canOpen` отвечает «нет», нажатие уходит дальше
 * и пропускает её, а пауза не встаёт.
 *
 * Показывает ту же подсказку управления, что и начало игры: паузу чаще всего
 * ставят, когда забыли, куда идти и чем ходить, — и это ровно то место, где
 * напомнить. Картинки берутся оттуда же, а не рисуются заново.
 *
 * Сама по себе она только экран: часы, звук и игровой цикл останавливает тот,
 * кто её открыл, — через `onToggle`. Здесь нарочно ничего про них не знают.
 */
export class Pause {
  constructor(container = document.body) {
    this.root = document.createElement('div');
    this.root.className = 'pause';
    this.root.hidden = true;

    this.card = document.createElement('div');
    this.card.className = 'pause__card';

    this.title = document.createElement('p');
    this.title.className = 'pause__title';
    this.title.textContent = CFG.title;

    this.keys = buildKeys();
    this.stick = buildStick();

    this.hint = document.createElement('p');
    this.hint.className = 'pause__hint';

    this.note = document.createElement('p');
    this.note.className = 'pause__note';
    this.note.textContent = CFG.note;

    this.tail = document.createElement('p');
    this.tail.className = 'pause__tail';

    this.card.append(this.title, this.keys, this.stick, this.hint, this.note, this.tail);
    this.root.appendChild(this.card);
    container.appendChild(this.root);

    this.shown = false;
    this.onToggle = null; // кому сказать, что мир встал или пошёл
    this.canOpen = null;  // и кого спросить, можно ли вставать прямо сейчас
    this._fade = null;

    // На телефоне клавиш нет вовсе: там паузу снимают касанием экрана. Ставить
    // её там пока нечем — кнопки для этого на экране нет, и выдумывать её здесь
    // не станем: экран уже снимается тем же касанием, что и любое другое.
    this.root.addEventListener('pointerdown', () => this.hide());

    // Именно на погружении (`capture`), а не по всплытию: см. про пропуск речи
    // выше — решение принимается раньше, чем речь успевает оборваться.
    addEventListener('keydown', this._onKey, true);
  }

  _onKey = (event) => {
    if (event.repeat) return;

    // Открытый экран снимается и тем, чем поставлен, и `Enter`.
    if (this.shown) {
      const closes = event.code === CFG.openKey
        || event.code === CFG.closeKey
        || event.code === `Numpad${CFG.closeKey}`;
      if (closes) this.hide();
      return;
    }

    if (event.code !== CFG.openKey) return;

    // Спрашиваем у игры, к месту ли пауза: под заставкой, экраном смерти, картой
    // и финалом вставать уже не от чего, а `Escape` там занят пропуском речи —
    // ему это нажатие и достанется, мы в него не вмешиваемся.
    if (this.canOpen && !this.canOpen()) return;

    this.show();
  };

  /** Поставить игру на паузу. */
  show() {
    if (this.shown) return;

    clearTimeout(this._fade);

    const keyboard = byKeyboard();
    this.keys.hidden = !keyboard;
    this.stick.hidden = keyboard;
    this.hint.textContent = keyboard ? CFG.hintKeys : CFG.hintTouch;
    this.tail.textContent = keyboard ? CFG.tailKeys : CFG.tailTouch;

    this.shown = true;
    this.root.hidden = false;

    // Кадр на то, чтобы браузер заметил появление: без него переход прозрачности
    // не с чего начинать, и экран возникнет рывком.
    requestAnimationFrame(() => this.root.classList.add('pause--on'));
    this.onToggle?.(true);
  }

  /** И снять её: мир идёт дальше. */
  hide() {
    if (!this.shown) return;

    this.shown = false;
    this.root.classList.remove('pause--on');

    // Сперва растворяется, и только потом уходит из разметки: снятый сразу,
    // экран моргнул бы.
    clearTimeout(this._fade);
    this._fade = setTimeout(() => { this.root.hidden = true; }, CFG.fadeFor * 1000);

    this.onToggle?.(false);
  }
}
