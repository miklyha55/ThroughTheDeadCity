import { CONFIG } from '../config.js';
import { yandex } from './yandex.js';

const CFG = CONFIG.yandex;

/**
 * Прогресс игрока: на каком уровне он остановился.
 *
 * Площадка требует, чтобы после обновления страницы игрок продолжил с того же
 * места и не потерял пройденного. Хранится это у неё же, а не в браузере: в
 * браузере разрешено только простым играм без покупок, да и стирается оно
 * первой же чисткой.
 *
 * Состояние держится одним объектом в памяти, и он же источник правды для игры.
 * Пишется целиком: считать, что площадка сольёт новые ключи со старыми, нельзя —
 * этого она нигде не обещает.
 *
 * Пишем по событиям, а не по таймеру: сменился уровень, игрок начал заново. У
 * площадки предел в сотню записей за пять минут, и подряд идущие правки
 * склеиваются в одну.
 */
class Progress {
  constructor() {
    // `armed`, `magazine` и `perReload` — снаряжение героя: подобранное ружьё и
    // коробка патронов. Без них игрок, вернувшийся на ферму, оказывался там
    // безоружным, хотя ружьё подобрал ещё на вводной.
    this.state = { level: null, passed: [], armed: false, magazine: 0, perReload: 0 };
    this._pending = null;
    this._loaded = false;
  }

  /**
   * Прочитать сохранённое. Один раз при запуске.
   * @returns {Promise<object>} состояние
   */
  async load() {
    const saved = await yandex.load();

    // Сливаем с настройками по умолчанию: отсутствующих ключей в ответе не
    // будет вовсе, а игре нужен полный объект.
    this.state = { ...this.state, ...saved };

    // Список пройденного мог прийти чем угодно — записи в облаке переживают
    // смену версий игры. Чужому виду тут доверять нельзя: по нему потом ходят
    // как по списку.
    if (!Array.isArray(this.state.passed)) this.state.passed = [];
    this.state.armed = Boolean(this.state.armed);
    this.state.magazine = Number(this.state.magazine) || 0;
    this.state.perReload = Number(this.state.perReload) || 0;
    this._loaded = true;
    return this.state;
  }

  /** На каком уровне игрок остановился; пусто, если ещё нигде. */
  get level() { return this.state.level; }

  /** Какие уровни уже пройдены. */
  get passed() { return this.state.passed; }

  /** Пройден ли уровень. */
  isPassed(id) { return this.state.passed.includes(id); }

  /** Есть ли у героя ружьё, сколько вмещает магазин и как быстро набивается. */
  get armed() { return this.state.armed; }
  get magazine() { return this.state.magazine; }
  get perReload() { return this.state.perReload; }

  /**
   * Запомнить снаряжение: подобранное ружьё и расширенный магазин.
   *
   * Пишется только на самом деле новое: подбирают это раз за игру, а каждая
   * лишняя запись идёт в счёт предела, который площадка ведёт на сохранения.
   *
   * @param {{armed: boolean, magazine: number, perReload: number}} kit
   */
  setKit({ armed, magazine, perReload }) {
    const same = this.state.armed === armed
      && this.state.magazine === magazine
      && this.state.perReload === perReload;
    if (same) return;

    this.state = { ...this.state, armed, magazine, perReload };
    this._save();
  }

  /**
   * Отметить уровень пройденным.
   *
   * Второй раз тот же уровень не пишем: игрок может проходить его сколько
   * угодно, а запись в облако у площадки на счету.
   *
   * @param {string} id
   */
  pass(id) {
    if (!id || this.state.passed.includes(id)) return;

    this.state.passed = [...this.state.passed, id];
    this._save();
  }

  /**
   * Запомнить уровень.
   *
   * Тот же уровень второй раз не пишем: игрок может умирать на нём десяток раз
   * подряд, и каждая смерть уходила бы в предел запросов.
   *
   * @param {string} id
   */
  setLevel(id) {
    if (!id || this.state.level === id) return;

    this.state.level = id;
    this._save();
  }

  /**
   * Стереть пройденное: игра начинается заново.
   *
   * Пишется сразу, не откладывая: за этим стоит осознанное действие игрока, и
   * оно не должно потеряться, если он тут же закроет вкладку.
   */
  reset() {
    this.state = { level: null, passed: [], armed: false, magazine: 0, perReload: 0 };
    this._save(true);
  }

  /**
   * Дожать отложенное.
   *
   * Зовётся, когда страница уходит: вкладку закрыли, свернули, телефон повернули.
   * Отложенная запись в этот момент просто не успела бы уйти.
   */
  flush() {
    if (!this._pending) return;

    clearTimeout(this._pending);
    this._pending = null;
    yandex.save(this.state, true);
  }

  _save(now = false) {
    if (!this._loaded) return; // читать ещё не читали — писать нечего

    clearTimeout(this._pending);

    if (now) {
      this._pending = null;
      yandex.save(this.state, true);
      return;
    }

    this._pending = setTimeout(() => {
      this._pending = null;
      yandex.save(this.state);
    }, CFG.saveAfter * 1000);
  }
}

export const progress = new Progress();

/**
 * Подписать сохранение на уход со страницы.
 *
 * Ловим и скрытие вкладки, и уход со страницы: на телефоне событие закрытия не
 * приходит вовсе, а скрытие приходит всегда — и когда сворачивают браузер, и
 * когда переключают приложение.
 */
export function saveOnLeave() {
  addEventListener('visibilitychange', () => {
    if (document.hidden) progress.flush();
  });
  addEventListener('pagehide', () => progress.flush());
}
