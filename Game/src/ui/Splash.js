import { CONFIG } from '../config.js';
import { levelName } from '../core/i18n.js';
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
    // Метка кэша: появляется только после пересборки ресурсов. По умолчанию её
    // нет намеренно — адрес должен совпадать с тем, по которому картинку грел
    // загрузчик, иначе браузер считает их разными файлами и качает второй раз
    // уже во время показа. Ровно так заставка и выходила пустой.
    this.stamp = 0;
    this.levels = new Map(); // id уровня → чем его встречать; заполняется на старте

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
    // Каждый показ свой: по нему уход и узнаёт, его ли ещё очередь.
    this.turn = (this.turn ?? 0) + 1;

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
    const bust = this.stamp ? `?v=${this.stamp}` : '';
    this.image.style.backgroundImage = `url(${CFG.folder}${number}.png${bust})`;
  }

  /**
   * Перечитать картинки с диска: их копирует кнопка «Обновить» вместе с
   * моделями, а браузер без нового адреса отдаст старые из кэша.
   */
  refresh() {
    this.stamp = Date.now();
  }

  /**
   * Запомнить цепочку уровней: чем встречать каждый.
   *
   * Читается один раз на старте, вместе со всем остальным. Дальше заставка знает
   * ответ сразу и ставит нужную картинку ещё до показа — иначе на экране сперва
   * мелькает предыдущий уровень, пока читается файл следующего.
   *
   * @param {Array<{id: string, number: number, name: string}>} levels
   */
  learn(levels) {
    for (const level of levels) this.levels.set(level.id, level);
  }

  /**
   * Приготовиться встречать уровень: поставить его название и картинку.
   *
   * Зовётся до показа. Если уровень знаком по цепочке — всё ставится тут же, без
   * единого запроса. Незнакомый (открытый через `?location=`) дочитывается из
   * файла, а до тех пор висит запасная картинка: пустое место читается как сбой.
   *
   * @param {string} id — какой уровень сейчас откроется
   */
  async prepare(id) {
    const known = this.levels.get(id);
    if (known) {
      this.setLevel(known.name, known.number);
      return;
    }

    this.setLevel('', CFG.bootLevel);

    try {
      const res = await fetch(asset(`locations/${id}.json`));
      if (!res.ok) return;

      const data = await res.json();
      this.setLevel(levelName(id, data.name), data.number ?? CFG.bootLevel);
    } catch {
      // не прочиталось — заставка просто останется с запасной картинкой
    }
  }

  /**
   * Заставку больше никто не закрывает: отсюда и считать, сколько она провисела.
   *
   * Поднимают её заранее, ещё под экраном загрузки: тот выше по слою, и в щель
   * между их уходом и её приходом иначе виден голый холст. Но пока она под ним,
   * её никто не видит — а время идёт, и к своему выходу она успевала отстоять
   * положенное и уходить сразу же. Картинки уровня при этом не видел никто.
   */
  uncovered() {
    if (this.root.hidden) return;

    this.shownAt = performance.now();
  }


  /** Довести полосу до конца и убрать заставку — не раньше, чем истечёт `minTime`. */
  async hide() {
    const turn = this.turn;

    clearInterval(this._timer);
    this._timer = null;

    this.progress = 1;
    this._draw();

    const shown = performance.now() - this.shownAt;
    const left = Math.max(CFG.holdFull, CFG.minTime - shown);
    await new Promise((done) => setTimeout(done, left));

    // Пока мы выжидали, мог начаться следующий уровень — и заставка на экране
    // уже его, а не наша. Гасить её нельзя: под ней собирается сцена, и игрок
    // увидел бы её недостроенной.
    if (turn !== this.turn) return;

    this.root.hidden = true;
  }

  _draw() {
    this.fill.style.width = `${Math.round(this.progress * 100)}%`;
  }
}
