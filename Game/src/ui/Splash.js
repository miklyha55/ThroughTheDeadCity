import { CONFIG } from '../config.js';
import { asset } from '../core/paths.js';

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
    this.stamp = Date.now(); // метка кэша: меняется на каждой пересборке ресурсов
  }

  /**
   * Показать заставку и вести полосу, пока идёт работа.
   *
   * Уже показанную не перезапускаем: загрузка игры и загрузка первого уровня
   * идут подряд, и полоса, отмотанная на ноль посередине, читалась бы как сбой.
   *
   * Картинку прежнего уровня не гасим. Новую поставят, как только прочитают его
   * файл, а до тех пор пусть висит старая — пустое место здесь означает чёрный
   * экран, и он тем заметнее, чем дольше грузится.
   */
  show() {
    if (!this.root.hidden) return; // уже идёт

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
    this.image.style.backgroundImage = `url(${CFG.folder}${number}.png?v=${this.stamp})`;
  }

  /**
   * Перечитать картинки с диска: их копирует кнопка «Обновить» вместе с
   * моделями, а браузер без нового адреса отдаст старые из кэша.
   */
  refresh() {
    this.stamp = Date.now();
  }

  /**
   * Заранее узнать, чем встречать: название и картинку уровня, который сейчас
   * откроется.
   *
   * Делается, пока на экране ещё чёрная загрузка игры, — чтобы заставка вышла
   * уже готовой, а не пустой, с картинкой, догоняющей её через полсекунды.
   *
   * Название берётся оттуда же, откуда его берёт сама игра: держать его вторым
   * списком в настройках значило бы однажды переименовать уровень и забыть.
   *
   * @param {string} id — какой уровень сейчас откроется
   */
  async prepare(id) {
    this.setLevel('', CFG.bootLevel); // запасная картинка: пустое место читается как сбой

    try {
      const res = await fetch(asset(`locations/${id}.json`));
      if (!res.ok) return;

      const data = await res.json();
      this.setLevel(data.name, data.number ?? CFG.bootLevel);
    } catch {
      // не прочиталось — заставка просто останется с запасной картинкой
    }
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
