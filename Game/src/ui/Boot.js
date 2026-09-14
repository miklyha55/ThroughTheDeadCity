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

    this.line = document.createElement('div');
    this.line.className = 'boot__line';

    const bar = document.createElement('div');
    bar.className = 'boot__bar';

    this.fill = document.createElement('div');
    this.fill.className = 'boot__fill';

    bar.appendChild(this.fill);
    this.root.append(this.line, bar);
    container.appendChild(this.root);

    this.shownAt = 0;
    this._timer = null;
    this._at = Math.floor(Math.random() * CFG.lines.length);
  }

  show() {
    this.root.hidden = false;
    this.shownAt = performance.now();
    this.setProgress(0);
    this._say();

    clearInterval(this._timer);
    this._timer = setInterval(() => this._next(), CFG.swapEvery);
  }

  /** @param {number} share — доля от 0 до 1 */
  setProgress(share) {
    this.fill.style.width = `${Math.round(Math.min(1, Math.max(0, share)) * 100)}%`;
  }

  /** Довести полосу до конца и уйти — не раньше, чем реплику успеют прочитать. */
  async hide() {
    clearInterval(this._timer);
    this._timer = null;
    this.setProgress(1);

    const shown = performance.now() - this.shownAt;
    await new Promise((done) => setTimeout(done, Math.max(0, CFG.minTime - shown)));

    this.root.hidden = true;
  }

  _next() {
    this._at = (this._at + 1) % CFG.lines.length;
    this._say();
  }

  /** Реплика меняется через прозрачность: подмена текста в лоб читается как сбой. */
  _say() {
    this.line.style.opacity = '0';
    setTimeout(() => {
      this.line.textContent = CFG.lines[this._at];
      this.line.style.opacity = '1';
    }, CFG.fade);
  }
}
