import { CONFIG } from '../config.js';

const CFG = CONFIG.skipHint;

/**
 * Кнопка «пропустить речь» — в углу, под кнопкой карты.
 *
 * Была сноской, которая только сообщала о пропуске: на телефоне речь обрывалась
 * касанием экрана где угодно. Пока вступление держало управление, это работало
 * — касание означало ровно одно. Но управление у вступления отобрали, и теперь
 * касание означает «идти»: зона стика занимает весь экран, и первый же шаг
 * обрывал бы речь.
 *
 * Поэтому пропуск переехал в саму сноску, а та стала кнопкой. Остальной экран
 * снова целиком под стик, и одно другому не мешает.
 *
 * Место прежнее — строкой над плашкой субтитров, внутри самого блока. Отдельно
 * на экране её не поставить: плашка прижата к низу, а высота у неё своя на
 * каждом экране, и кнопка, поставленная по своей мерке, налезала бы на текст.
 *
 * Нажатия ловит только она сама: вокруг неё остаётся стик, и остальной экран
 * по-прежнему ведёт героя.
 *
 * Появляется не сразу, а тогда же, когда пропуск и начинает работать: кнопка,
 * которая пока ничего не делает, хуже, чем её отсутствие.
 *
 * Написана мелко и приглушённо: это по-прежнему сноска, а не то, ради чего
 * игрок смотрит на экран.
 */
export class SkipHint {
  /** @param {HTMLElement} container — блок субтитров: кнопка встаёт над ними */
  constructor(container = document.body) {
    this.root = document.createElement('div');
    this.root.className = 'skip';
    this.root.hidden = true;

    // Сама кнопка — отдельным узлом: подложка нужна под буквами, а не во всю
    // ширину угла, да и ловить нажатие должна именно она.
    this.label = document.createElement('button');
    this.label.className = 'skip__label';
    this.label.type = 'button';

    /**
     * Надпись кладётся сразу, а не при показе.
     *
     * Скрытая кнопка держит за собой место — но только если ей есть чем его
     * держать. Пустая, она была ростом с одни отступы, а с появлением текста
     * подрастала и толкала плашку субтитров вниз. Заполненная с самого начала,
     * она занимает свой окончательный размер ещё невидимой, и её выход уже
     * ничего не двигает.
     */
    this.label.textContent = this._words();
    this.root.appendChild(this.label);

    // Первой в блоке: дописанная в конец, она оказалась бы под плашкой.
    container.prepend(this.root);

    this.onPress = null; // кому сказать, что речь просят оборвать
    this.shown = false;
    this._timer = null;
    this._fade = null;

    this.label.addEventListener('click', () => this.onPress?.());
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

  /** Чем подписать: за столом жмут клавишу, на телефоне — саму кнопку. */
  _words() {
    return this.keyboard ? CFG.keys : CFG.touch;
  }

  _show() {
    // Перечитываем: между сборкой и показом могли подключить клавиатуру.
    this.label.textContent = this._words();
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
