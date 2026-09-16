import { CONFIG } from '../config.js';

const CFG = CONFIG.skipHint;

/**
 * Строка «речь можно пропустить», пока звучит вступление.
 *
 * Пропуск в игре был с самого начала — клавишей на настольной машине и вторым
 * касанием на телефоне, — но узнать о нём было неоткуда: игрок, которому речь
 * не нужна, просто сидел эти полминуты и ждал. Теперь ему об этом сказано.
 *
 * Появляется она не сразу, а тогда же, когда пропуск и начинает работать:
 * обещать кнопку, которая пока ничего не делает, хуже, чем промолчать. Уходит
 * вместе с речью.
 *
 * Живёт она внутри блока субтитров, первой строкой над плашкой. Отдельно на
 * экране её не поставить: плашка прижата к низу, а высота у неё своя на каждом
 * экране — под длинную реплику резервируется несколько строк, — и сноска,
 * поставленная по своей мерке, налезала прямо на текст.
 *
 * Написана мелко и приглушённо: это сноска, а не то, ради чего игрок смотрит на
 * экран.
 */
export class SkipHint {
  /** @param {HTMLElement} container — блок субтитров: сноска встаёт над ними */
  constructor(container = document.body) {
    this.root = document.createElement('p');
    this.root.className = 'skip';
    this.root.hidden = true;

    // Буквы лежат в своей обёртке: подложка нужна под ними, а не во всю ширину
    // плашки субтитров.
    this.label = document.createElement('span');
    this.label.className = 'skip__label';
    this.root.appendChild(this.label);

    // Первой в блоке: дописанная в конец, она оказалась бы под плашкой.
    container.prepend(this.root);

    this.shown = false;
    this._timer = null;
    this._fade = null;
  }

  /** Есть ли у машины клавиатура — или речь пропускают касанием. */
  get keyboard() {
    return matchMedia('(hover: hover) and (pointer: fine)').matches;
  }

  /**
   * Речь пошла: показать сноску, когда пропуск станет доступен.
   * @param {number} [after] — через сколько секунд
   */
  arm(after = CFG.armAfter) {
    if (this.shown) return;

    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._show(), after * 1000);
  }

  _show() {
    this.label.textContent = this.keyboard ? CFG.keys : CFG.touch;
    this.shown = true;

    clearTimeout(this._fade);
    this.root.hidden = false;

    // Кадр на то, чтобы браузер заметил появление: иначе переходу прозрачности
    // не с чего начинать.
    requestAnimationFrame(() => this.root.classList.add('skip--on'));
  }

  /** Речь кончилась или её пропустили. */
  hide() {
    clearTimeout(this._timer);
    this._timer = null;

    if (!this.shown) {
      this.root.hidden = true;
      return;
    }

    this.shown = false;
    this.root.classList.remove('skip--on');
    this._fade = setTimeout(() => { this.root.hidden = true; }, CFG.fadeFor * 1000);
  }
}
