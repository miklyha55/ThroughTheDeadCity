import { CONFIG } from '../config.js';

const CFG = CONFIG.yandex;

/**
 * Площадка Яндекс Игр: всё, что игра у неё спрашивает и чем ей отвечает.
 *
 * Вся работа с ней собрана здесь одним слоем, и остальная игра о площадке не
 * знает вовсе. Причина не в красоте: игра должна одинаково работать и на
 * площадке, и на своём сервере, и на dev-сервере, где никакого SDK нет. Поэтому
 * каждый метод отсюда либо делает своё дело, либо тихо ничего не делает — и
 * вызывающему всё равно, что именно случилось.
 *
 * Ничего не ждёт молча: если площадки нет, обещания сразу отвечают пустотой, а
 * не висят.
 */
class Yandex {
  constructor() {
    this.sdk = null;      // сам SDK, когда поднимется
    this.player = null;   // и данные игрока
    this.ready = false;   // отвечает ли площадка вообще
    this._told = false;   // сказали ли ей уже, что игра загрузилась
    this._playing = false; // и идёт ли, по её мнению, геймплей прямо сейчас

    this.onPause = null;  // площадка просит остановить игру
    this.onResume = null; // и продолжить
  }

  /**
   * Поднять SDK.
   *
   * Скрипт лежит на самой площадке, по адресу от её корня. Вне площадки его
   * нет, и это не беда: игра просто пойдёт дальше.
   *
   * @returns {Promise<boolean>} поднялся ли
   */
  async start() {
    try {
      await load(CFG.script, CFG.waitFor * 1000);
      if (!globalThis.YaGames) return false;

      this.sdk = await globalThis.YaGames.init();
      this.ready = Boolean(this.sdk);

      if (this.ready) this._listen();
      return this.ready;
    } catch {
      return false; // площадки нет или она не ответила — играем как есть
    }
  }

  /**
   * Пауза и продолжение по просьбе площадки.
   *
   * Приходят, когда показывают рекламу, открывают окно покупок, переключают
   * вкладку или сворачивают окно. Игру на это время обязательно останавливать.
   */
  _listen() {
    this.sdk.on?.('game_api_pause', () => this.onPause?.());
    this.sdk.on?.('game_api_resume', () => this.onResume?.());
  }

  /** Язык интерфейса площадки. Вне её — язык браузера. */
  language() {
    return this.sdk?.environment?.i18n?.lang ?? navigator.language ?? 'en';
  }

  /**
   * Игра догрузилась и готова к игроку.
   *
   * Зовётся, когда ушёл последний экран загрузки, а не когда догрузились файлы:
   * площадка меряет именно тот миг, с которого игрок может действовать.
   */
  loaded() {
    // Один раз за сеанс: это про запуск игры, а не про каждый уровень. Второй
    // вызов площадка засчитала бы как ещё одну загрузку и испортила себе меры.
    if (this._told) return;
    this._told = true;

    this.sdk?.features?.LoadingAPI?.ready?.();
  }

  /**
   * Геймплей пошёл: уровень начался, меню закрылось, реклама кончилась.
   *
   * Повторы отбрасываются. Поводов остановиться в игре несколько, и они
   * накладываются: игрок умер, поверх поднялась реклама, следом пошла загрузка
   * уровня. Площадке от трёх «встал» подряд толку нет, а меры они ей путают.
   */
  play() {
    if (this._playing) return;
    this._playing = true;

    this.sdk?.features?.GameplayAPI?.start?.();
  }

  /** Геймплей встал: пауза, меню, реклама, уход из вкладки, конец уровня. */
  pause() {
    if (!this._playing) return;
    this._playing = false;

    this.sdk?.features?.GameplayAPI?.stop?.();
  }

  /**
   * Показать рекламу за награду.
   *
   * Обещание разрешается закрытием ролика, а не наградой: закрытие приходит
   * всегда — и когда посмотрели, и когда отказались, и когда ролика не нашлось.
   * По нему и продолжают игру.
   *
   * @returns {Promise<boolean>} досмотрел ли игрок до награды
   */
  showRewarded() {
    if (!this.sdk?.adv?.showRewardedVideo) return Promise.resolve(false);

    return new Promise((done) => {
      let rewarded = false;
      let opened = false;
      let settled = false;

      /**
       * Отвечаем ровно один раз и сразу.
       *
       * Площадка зовёт колбэки в таком порядке: `onOpen` — ролик на экране,
       * `onRewarded` — просмотр засчитан, `onClose` — закрыт. Но `onClose`
       * приходит и без `onOpen`: ролика не нашлось, сработал предел частоты,
       * что-то отказало. Тогда ждать нечего — игру надо продолжать тут же.
       */
      const finish = (why) => {
        if (settled) return;
        settled = true;

        clearTimeout(opening);
        clearTimeout(timer);
        done(rewarded || why === 'rewarded');
      };

      /**
       * Если ролик не открылся за пару секунд, продолжаем игру.
       *
       * Без этого выходило то, что видно глазами: первый раз уровень
       * перезапускался секунд через пять, а второй сразу. Площадка на первый
       * запрос иногда отвечает медленно и молча, и мы всё это время ждали её
       * ответа, держа игрока перед чёрным экраном.
       */
      const opening = setTimeout(() => { if (!opened) finish('нет ролика'); }, CFG.advOpenWait * 1000);

      // И общая страховка: ролик открылся, но закрытие так и не пришло.
      const timer = setTimeout(() => finish('нет ответа'), CFG.advTimeout * 1000);

      this.pause();
      this.sdk.adv.showRewardedVideo({
        onOpen: () => { opened = true; },
        onRewarded: () => { rewarded = true; },
        onClose: () => finish('закрыт'),
        onError: () => finish('ошибка'),
      });
    }).finally(() => this.play());
  }

  /** Показать полноэкранную рекламу. Частоту площадка сторожит сама. */
  showFullscreen() {
    if (!this.sdk?.adv?.showFullscreenAdv) return Promise.resolve(false);

    return new Promise((done) => {
      const timer = setTimeout(() => done(false), CFG.advTimeout * 1000);
      const finish = (shown) => { clearTimeout(timer); done(Boolean(shown)); };

      this.pause();
      this.sdk.adv.showFullscreenAdv({
        onClose: finish,
        onError: () => finish(false),
      });
    }).finally(() => this.play());
  }

  /**
   * Готова ли площадка принять оценку игры.
   *
   * Спрашивать надо заранее: тот, кто уже оценил, второй раз окно не увидит, и
   * кнопку ему показывать незачем.
   *
   * @returns {Promise<boolean>}
   */
  async canReview() {
    try {
      const { value } = (await this.sdk?.feedback?.canReview?.()) ?? {};
      return Boolean(value);
    } catch {
      return false;
    }
  }

  /**
   * Показать окно оценки. Ставит её сама площадка — мы только просим открыть.
   *
   * @returns {Promise<boolean>} оценил ли игрок
   */
  async requestReview() {
    try {
      const { feedbackSent } = (await this.sdk?.feedback?.requestReview?.()) ?? {};
      return Boolean(feedbackSent);
    } catch {
      return false;
    }
  }

  /**
   * Прочитать сохранённое.
   *
   * Один раз при запуске. Игрок может быть и неавторизован — данные всё равно
   * привязаны к нему площадкой, и читаются так же.
   *
   * @returns {Promise<object>} что было сохранено; пусто, если ничего
   */
  async load() {
    try {
      this.player = this.player ?? await this.sdk?.getPlayer?.();
      return (await this.player?.getData?.()) ?? {};
    } catch {
      return {}; // не вышло — начинаем с чистого листа, а не падаем
    }
  }

  /**
   * Записать прогресс.
   *
   * @param {object} state — всё состояние целиком
   * @param {boolean} [now] — отправить немедленно, не откладывая
   */
  async save(state, now = false) {
    try {
      await this.player?.setData?.(state, now);
    } catch {
      // сеть отвалилась или выбран предел запросов — игру это ронять не должно
    }
  }
}

/**
 * Подключить скрипт и дождаться, пока он встанет.
 *
 * С пределом ожидания: вне площадки такого адреса нет, и без предела запуск
 * игры завис бы на нём насовсем.
 */
function load(src, wait) {
  return new Promise((done, fail) => {
    const tag = document.createElement('script');
    tag.src = src;
    tag.async = true;

    const timer = setTimeout(() => fail(new Error('площадка не ответила')), wait);
    const settle = (ok) => {
      clearTimeout(timer);
      ok ? done() : fail(new Error('скрипт площадки не загрузился'));
    };

    tag.addEventListener('load', () => settle(true), { once: true });
    tag.addEventListener('error', () => settle(false), { once: true });
    document.head.appendChild(tag);
  });
}

/** Площадка одна на всю игру. */
export const yandex = new Yandex();
