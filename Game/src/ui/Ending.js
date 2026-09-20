import { CONFIG } from '../config.js';
import { tally } from '../core/tally.js';
import { Choice } from './Choice.js';

const CFG = CONFIG.ending;

/**
 * Финальный экран: картинка, которой кончается игра.
 *
 * Появляется прозрачностью, а не показом: игрок только что вышел через последний
 * проём, и резкая подмена кадра читалась бы как сбой, а не как конец пути.
 *
 * Поверх картинки — титр, итог похода и кнопки. Итог тут не ради цифр: он
 * превращает конец в результат, который можно улучшить, и даёт повод пройти
 * город ещё раз.
 *
 * Картинка кроет экран целиком при любом соотношении сторон, как и заставка
 * между уровнями: пустых полей по краям быть не должно.
 */
export class Ending {
  constructor(container = document.body) {
    this.root = document.createElement('div');
    this.root.className = 'ending';
    container.appendChild(this.root);

    /**
     * Кадр живёт отдельным слоем.
     *
     * На нём медленный наезд, а надписи поверх должны стоять неподвижно: текст,
     * едущий вместе с картинкой, читать нельзя.
     */
    this.frame = document.createElement('div');
    this.frame.className = 'ending__frame';

    this.caption = document.createElement('p');
    this.caption.className = 'ending__caption';
    this.caption.textContent = CFG.caption;

    this.stats = document.createElement('dl');
    this.stats.className = 'ending__stats';
    this.rows = {};

    for (const [key, label] of [
      ['kills', CFG.killsLabel], ['deaths', CFG.deathsLabel], ['time', CFG.timeLabel],
    ]) {
      const name = document.createElement('dt');
      name.textContent = label;

      const value = document.createElement('dd');
      value.textContent = '—';

      this.stats.append(name, value);
      this.rows[key] = value;
    }

    /**
     * Таблица рекордов площадки: лучшие прохождения и место игрока среди них.
     *
     * Живёт своей строкой между итогом и кнопками и видна, только если площадка
     * ответила: вне её и при ошибке запроса место под неё остаётся пустым.
     */
    this.board = document.createElement('section');
    this.board.className = 'ending__board';
    this.board.hidden = true;

    this.boardTitle = document.createElement('h2');
    this.boardTitle.className = 'ending__board-title';
    this.boardTitle.textContent = CFG.boardTitle;

    this.boardHead = document.createElement('div');
    this.boardHead.className = 'ending__head';

    for (const [part, label] of [
      ['place', ''], ['name', ''], ['time', CFG.boardTimeLabel],
      ['deaths', CFG.boardDeathsLabel],
    ]) {
      const cell = document.createElement('span');
      cell.className = `ending__head-${part}`;
      cell.textContent = label;
      this.boardHead.appendChild(cell);
    }

    this.boardList = document.createElement('ul');
    this.boardList.className = 'ending__board-list';

    this.board.append(this.boardTitle, this.boardHead, this.boardList);

    const buttons = document.createElement('div');
    buttons.className = 'ending__buttons';

    this.again = document.createElement('button');
    this.again.className = 'ending__again';
    this.again.type = 'button';
    this.again.textContent = CFG.againLabel;

    // Кнопка оценки появляется, только если площадка готова её принять: вне
    // площадки и у того, кто уже оценил, её нет вовсе.
    this.rate = document.createElement('button');
    this.rate.className = 'ending__rate';
    this.rate.type = 'button';
    this.rate.textContent = CFG.rateLabel;
    this.rate.hidden = true;

    buttons.append(this.again, this.rate);

    this.card = document.createElement('div');
    this.card.className = 'ending__card';
    this.card.append(this.caption, this.stats, this.board, buttons);

    this.root.append(this.frame, this.card);

    this.onAgain = null; // пройти город заново
    this.onRate = null;  // и оценить игру: спрашивает площадка, а не мы

    // По отпусканию: нажал — кнопка сжалась, отпустил — сработала.
    this.again.addEventListener('click', (event) => {
      event.preventDefault();
      this.onAgain?.();
    });

    this.rate.addEventListener('click', (event) => {
      event.preventDefault();
      this.onRate?.();
    });

    /**
     * Стрелки водят выбор между кнопками, Enter жмёт выбранную.
     *
     * Кнопки перечислены слева направо, как и стоят. «Оценить» может и не
     * появиться — её показывает площадка, — но список этого не замечает:
     * спрятанную кнопку выбор пропускает, и на финале без неё стрелки просто
     * никуда не ведут, а Enter жмёт «Ещё раз».
     */
    this.choice = new Choice([this.again, this.rate], () => this.shown, true);
    this.card.append(this.choice.hint);

    this._paint();
    this.shown = false;
  }

  show() {
    if (this.shown) return;

    this.shown = true;

    // Итог снимается в миг показа: к этой минуте часы уже остановлены.
    this.rows.kills.textContent = String(tally.kills);
    this.rows.deaths.textContent = String(tally.deaths);
    this.rows.time.textContent = tally.clock;

    // Таблица придёт следом, от площадки: до неё блок не показываем вовсе.
    this.board.hidden = true;

    this.choice.reset(); // выбор — на «Ещё раз»
    this.root.classList.add('ending--on');
  }

  /**
   * Показать таблицу рекордов.
   *
   * Зовётся, когда площадка ответила. Пустой ответ — лидерборда нет или в нём
   * никого нет — означает финал без таблицы: итог пути и так стоит на месте,
   * и заглушка под ним только отвлекала бы.
   *
   * @param {object|null} board — ответ `getEntries` площадки
   */
  showBoard(board) {
    this.board.hidden = true;
    this.boardList.textContent = '';

    const entries = board?.entries;
    if (!entries?.length) return; // площадка не ответила или таблица пуста

    const userRank = board.userRank ?? -1;
    for (const entry of entries) {
      this.boardList.appendChild(this._row(entry, entry.rank === userRank));
    }

    this.board.hidden = false;
  }

  /** Одна строка таблицы: место, имя с портретом, время и число смертей. */
  _row(entry, here) {
    const row = document.createElement('li');
    row.className = here ? 'ending__row ending__row--here' : 'ending__row';

    const place = document.createElement('span');
    place.className = 'ending__place';

    /**
     * Место — как прислала площадка, без поправок.
     *
     * Здесь стояло `rank + 1`, и первая строка таблицы выводилась как «2».
     * Нумерация у площадки идёт с единицы: ноль она держит под ответ «этого
     * игрока в таблице нет» — им приходит `userRank` тому, кто не авторизован
     * или ещё не попал в рейтинг. С нуля она считает только `ranges[].start`,
     * и это в документации оговорено отдельно, как исключение.
     *
     * Подсветка своей строки рядом сравнивает `rank` с `userRank` напрямую — и
     * была права всё это время. Расходились они только здесь.
     */
    place.textContent = String(entry.rank);

    const who = document.createElement('span');
    who.className = 'ending__who';

    const src = entry.player?.getAvatarSrc?.('small');
    if (src) {
      const avatar = document.createElement('img');
      avatar.className = 'ending__avatar';
      avatar.alt = '';
      avatar.src = src;
      who.appendChild(avatar);
    } else {
      const initial = document.createElement('span');
      initial.className = 'ending__avatar';
      initial.textContent = (entry.player?.publicName || CFG.boardHidden).trim().charAt(0).toUpperCase();
      who.appendChild(initial);
    }

    const name = document.createElement('span');
    name.className = 'ending__name';
    name.textContent = entry.player?.publicName || CFG.boardHidden;
    who.appendChild(name);

    const time = document.createElement('span');
    time.className = 'ending__time';
    time.textContent = clock(entry.score);

    const deaths = document.createElement('span');
    deaths.className = 'ending__deaths';
    const count = Number.parseInt(entry.extraData, 10);
    deaths.textContent = Number.isFinite(count) ? String(count) : '—';

    row.append(place, who, time, deaths);
    return row;
  }

  /**
   * Показать или убрать кнопку оценки: примет её площадка или нет, решает она.
   *
   * Ответ приходит уже на открытом финале, поэтому следом пересчитываем
   * подсказку про клавиши: с появлением второй кнопки у стрелок впервые
   * появляется куда вести, и молчать об этом нельзя.
   */
  offerRate(can) {
    this.rate.hidden = !can;
    this.choice.refresh();
  }

  /**
   * Перечитать картинку с диска.
   *
   * Файл мог смениться — его копирует та же кнопка «Обновить», что пересобирает
   * модели. Браузер сам об этом не догадается и отдаст старый из кэша, поэтому
   * каждой перечитке свой адрес.
   *
   * До первой перечитки метки нет: адрес должен совпадать с тем, по которому
   * картинку грел загрузчик, иначе она поедет по сети второй раз уже на показе.
   */
  refresh() {
    this.frame.style.backgroundImage = `url(${CFG.image}?v=${Date.now()})`;
  }

  /** Первый показ идёт по чистому адресу — тому же, что прогрел загрузчик. */
  _paint() {
    this.frame.style.backgroundImage = `url(${CFG.image})`;
  }

  /** Убрать финал: по кнопке «заново» или из панели разработчика. */
  hide() {
    if (!this.shown) return;

    this.shown = false;
    this.board.hidden = true; // со старой таблицей повторный показ не начинают

    // Сперва «уходит», потом «не показан»: наезд на картинке держится на обоих
    // классах и не обрывается, пока экран тает. Оборвись он — кадр прыгал бы к
    // исходному масштабу посреди растворения, и уход выглядел бы как дёрганье.
    this.root.classList.add('ending--leaving');
    this.root.classList.remove('ending--on');

    clearTimeout(this._leave);
    this._leave = setTimeout(
      () => this.root.classList.remove('ending--leaving'),
      900, // столько же, сколько длится само растворение финала
    );
  }
}

/** Время в виде «7:42» — минуты и секунды; на входе миллисекунды. */
function clock(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
