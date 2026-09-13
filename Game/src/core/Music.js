import { CONFIG } from '../config.js';

const CFG = CONFIG.music;

/**
 * Фоновая музыка: своя дорожка на каждый уровень, по кругу до его конца.
 *
 * Дорожка выбирается номером уровня — файл `1.mp3` лежит под первым, `2.mp3` под
 * вторым. Пока номер не сменился, музыка не перезапускается: возврат на ту же
 * локацию не обрывает её с начала.
 *
 * Первый запуск ждёт касания экрана — раньше и нельзя: браузер не даёт начать
 * звук, пока игрок ничего не нажал, и молча отклоняет попытку. Заодно это и
 * честный момент старта: игрок взялся за стик — пошла музыка.
 *
 * Пока вкладка скрыта, музыка замолкает: играть в пустоту незачем, а вернувшись,
 * игрок продолжит с того же места.
 */
export class Music {
  constructor() {
    this.audio = new Audio();
    this.audio.loop = true;
    this.audio.volume = CFG.volume;
    this.audio.preload = 'auto';

    this.track = null;    // номер уровня, чья дорожка сейчас заряжена
    this.allowed = false; // разрешил ли уже игрок звук
    this.start = this.start.bind(this);

    // Слушаем и касание, и мышь, и клавиши: на десктопе экрана касаться нечем.
    for (const event of ['pointerdown', 'touchstart', 'keydown']) {
      addEventListener(event, this.start, { once: true });
    }

    document.addEventListener('visibilitychange', () => {
      if (!this.allowed) return;
      if (document.hidden) this.audio.pause();
      else this._resume();
    });
  }

  /**
   * Поставить дорожку уровня. Та же самая играет дальше без перерыва.
   * @param {number} track — номер уровня
   */
  play(track) {
    if (track === this.track) return;

    this.track = track;
    this.audio.src = `${CFG.folder}${track}.mp3`;
    this._resume();
  }

  /** Пустить музыку, когда игрок впервые тронул экран. */
  start() {
    if (this.allowed) return;
    this.allowed = true;
    this._resume();
  }

  _resume() {
    if (!this.allowed || !this.track) return;

    this.audio.play().catch(() => {
      // Браузер не пустил — ждём следующего касания и пробуем снова.
      this.allowed = false;
      addEventListener('pointerdown', this.start, { once: true });
    });
  }
}
