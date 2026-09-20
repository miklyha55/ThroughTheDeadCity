import { CONFIG } from '../config.js';

const CFG = CONFIG.boot;

/**
 * Экран загрузки самой игры: чёрный фон, реплика и полоса.
 *
 * Идёт до всего остального — модели и звук весят мегабайты, и это время игрок
 * иначе смотрел бы в пустоту. Заставка уровня с картинкой приходит уже после:
 * она про то, куда мы попали, а этот экран про то, что игра ещё собирается.
 *
 * Реплики меняются по ходу: на быстром канале успеет показаться одна, на
 * медленном — несколько, и ожидание не превращается в разглядывание одной
 * строки. Первая выпадает случайно, дальше идут по кругу от неё.
 *
 * Экран держится минимум `minTime`, даже если всё уже в кэше и загружать нечего:
 * мелькнувшую строку никто не прочитает, а стало бы только хуже, чем без неё.
 */
export class Boot {
  /** @param {import('./LoadBar.js').LoadBar} bar — полоса общая с заставкой уровня */
  constructor(bar, container = document.body) {
    this.bar = bar;
    this.root = document.createElement('div');
    this.root.className = 'boot';
    this.root.hidden = true;

    this.line = document.createElement('div');
    this.line.className = 'boot__line';

    this.root.append(this.line);
    container.appendChild(this.root);

    this.shownAt = 0;
    this._timer = null;
    this._share = 0; // докуда дошла полоса: загрузка идёт ещё до показа экрана
    this._at = Math.floor(Math.random() * CFG.lines.length);
  }

  show() {
    this.root.hidden = false;
    this.shownAt = performance.now();

    // Полоса общая с заставкой уровня, своим слоем поверх обоих экранов. Она
    // продолжает с того места, где загрузка и правда идёт, а не с нуля:
    // считается та с самого начала, ещё под кнопкой «Играть», и на горячем кэше
    // к нажатию всё давно готово. Обнулившись, полоса стояла бы пустой весь
    // экран и прыгала на сотню в последний миг.
    this.bar.show(this._share * CFG.share);
    this._say(true); // первая — сразу, ждать ей нечего

    clearInterval(this._timer);
    this._timer = setInterval(() => this._next(), CFG.swapEvery);
  }

  /** @param {number} share — доля от 0 до 1 */
  setProgress(share) {
    this._share = Math.min(1, Math.max(0, share));

    // Своя доля общей полосы: файлы — это ещё не готовая игра, и остаток пути
    // полоса пройдёт уже на заставке уровня. Дойди она здесь до края, на
    // заставке ей было бы некуда идти и она стояла бы полной.
    this.bar.set(this._share * CFG.share);
  }

  /**
   * Довести полосу до конца и уйти.
   *
   * Уходит не сразу: сперва запас `hold` на то, чтобы браузер разложил
   * загруженное по памяти, — а до кучи реплику успевают прочитать. И не раньше
   * `minTime` от появления, иначе на горячем кэше экран просто мигнёт.
   */
  async hide() {
    clearInterval(this._timer);
    this._timer = null;
    clearTimeout(this._fade); // реплика больше не сменится: экран уже уходит

    const shown = performance.now() - this.shownAt;
    const wait = Math.max(CFG.hold, CFG.minTime - shown);
    await new Promise((done) => setTimeout(done, wait));

    this.root.hidden = true;
  }

  _next() {
    this._at = (this._at + 1) % CFG.lines.length;
    this._say();
  }

  /**
   * Реплика меняется через прозрачность: подмена текста в лоб читается как сбой.
   *
   * Смена идёт в два шага — сперва нынешняя гаснет, и только потом на её месте
   * проступает следующая. Но у первой гаснуть нечему: строка пуста, экран
   * только что появился. Уходя в общий путь, она зря выжидала время затухания
   * и показывалась заметно позже самого экрана — на горячем кэше это заметная
   * доля всей загрузки, и игрок успевал увидеть пустой экран.
   *
   * @param {boolean} [now] — показать немедленно, не выжидая затухания
   */
  _say(now = false) {
    clearTimeout(this._fade);

    if (now) {
      this.line.textContent = CFG.lines[this._at];
      this.line.style.opacity = '1';
      return;
    }

    this.line.style.opacity = '0';
    this._fade = setTimeout(() => {
      this.line.textContent = CFG.lines[this._at];
      this.line.style.opacity = '1';
    }, CFG.fade);
  }
}
