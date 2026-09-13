import { CONFIG } from '../config.js';

const CFG = CONFIG.splash;

/**
 * Заставка между уровнями: картинка на весь экран и полоса загрузки по центру.
 *
 * Загрузка локации сама по себе быстрая и рывками: сборка геометрии идёт одним
 * куском и никаких долей не сообщает. Поэтому полоса не притворяется точной —
 * она движется сама, равномерно, а по готовности доводится до конца. Так игрок
 * видит, что игра занята делом, и не смотрит в застывший экран.
 *
 * Заставка держится на экране не меньше `minTime`: без этого на быстрой машине
 * она мелькала бы вспышкой, что хуже, чем секунда ожидания.
 */
export class Splash {
  constructor(container = document.body) {
    this.root = document.createElement('div');
    this.root.className = 'splash';
    this.root.hidden = true;

    this.image = document.createElement('div');
    this.image.className = 'splash__image';

    const bar = document.createElement('div');
    bar.className = 'splash__bar';

    this.fill = document.createElement('div');
    this.fill.className = 'splash__fill';

    this.caption = document.createElement('div');
    this.caption.className = 'splash__caption';

    bar.appendChild(this.fill);
    this.root.append(this.image, this.caption, bar);
    container.appendChild(this.root);

    this.progress = 0;
    this.shownAt = 0;
    this._timer = null;
  }

  /** Показать заставку и вести полосу, пока идёт работа. */
  show() {
    this.caption.textContent = '';
    this.image.style.backgroundImage = ''; // картинка появится, когда узнаем уровень
    this.progress = 0;
    this.shownAt = performance.now();

    this.root.hidden = false;
    this._draw();

    // Полоса ползёт сама и тормозит у конца: дойти до края раньше, чем работа
    // закончилась, ей нельзя — иначе она застынет полной и будет врать.
    clearInterval(this._timer);
    this._timer = setInterval(() => {
      this.progress += (CFG.ceiling - this.progress) * CFG.ease;
      this._draw();
    }, CFG.tick);
  }

  /**
   * Чей уровень грузится. Известно только после чтения его файла, поэтому и
   * название, и картинка ставятся здесь, а не при показе.
   *
   * @param {string} title — название уровня
   * @param {number} number — его номер: под ним лежит и картинка, и музыка
   */
  setLevel(title, number) {
    this.caption.textContent = title ?? '';
    this.image.style.backgroundImage = `url(${CFG.folder}${number}.png)`;
  }

  /** Довести полосу до конца и убрать заставку — не раньше, чем истечёт `minTime`. */
  async hide() {
    clearInterval(this._timer);

    this.progress = 1;
    this._draw();

    const shown = performance.now() - this.shownAt;
    const left = Math.max(CFG.holdFull, CFG.minTime - shown);
    await new Promise((done) => setTimeout(done, left));

    this.root.hidden = true;
  }

  _draw() {
    this.fill.style.width = `${Math.round(this.progress * 100)}%`;
  }
}
