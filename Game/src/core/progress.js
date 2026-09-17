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
    this.state = { level: null };
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
    this._loaded = true;
    return this.state;
  }

  /** На каком уровне игрок остановился; пусто, если ещё нигде. */
  get level() { return this.state.level; }

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
    this.state = { level: null };
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
