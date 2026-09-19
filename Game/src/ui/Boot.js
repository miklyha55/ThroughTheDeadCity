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
  constructor(container = document.body) {
    this.root = document.createElement('div');
    this.root.className = 'boot';
    this.root.hidden = true;

    // Лого студии над репликой и полосой: пока игра собирается, экран говорит,
    // чья она. Картинка крошечная и грузится раньше всего остального.
    this.logo = document.createElement('img');
    this.logo.className = 'boot__logo';
    this.logo.src = CFG.logo;
    this.logo.alt = CFG.logoAlt;
    this.logo.decoding = 'async';

    this.line = document.createElement('div');
    this.line.className = 'boot__line';

    const bar = document.createElement('div');
    bar.className = 'boot__bar';

    this.fill = document.createElement('div');
    this.fill.className = 'boot__fill';

    bar.appendChild(this.fill);
    this.root.append(this.logo, this.line, bar);
    container.appendChild(this.root);

    this.shownAt = 0;
    this._timer = null;
    this._share = 0; // докуда дошла полоса: загрузка идёт ещё до показа экрана
    this._at = Math.floor(Math.random() * CFG.lines.length);
  }

  show() {
    this.root.hidden = false;
    this.shownAt = performance.now();

    // Полоса продолжает с того места, где загрузка на самом деле идёт, а не с
    // нуля. Считается она с самого начала, ещё под кнопкой «Играть», и на
    // горячем кэше к нажатию всё давно готово: обнулившись, полоса стояла пустой
    // весь экран и прыгала на сотню в последний миг.
    this.setProgress(this._share);
    this._say(true); // первая — сразу, ждать ей нечего

    clearInterval(this._timer);
    this._timer = setInterval(() => this._next(), CFG.swapEvery);
  }

  /** @param {number} share — доля от 0 до 1 */
  setProgress(share) {
    this._share = Math.min(1, Math.max(0, share));
    this.fill.style.width = `${Math.round(this._share * 100)}%`;
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
    this.setProgress(1);

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
   * доля всей загрузки, и игрок успевал увидеть пустоту под лого.
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
