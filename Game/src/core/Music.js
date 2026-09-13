import { CONFIG } from '../config.js';

const CFG = CONFIG.music;

/**
 * Фоновая музыка: одна дорожка по кругу на всю игру.
 *
 * Заводится один раз при запуске и дальше живёт сама — смена локаций её не
 * трогает, потому что принадлежит она не уровню, а игре целиком.
 *
 * Включается по первому касанию экрана — раньше и нельзя: браузер не даёт начать
 * звук, пока игрок ничего не нажал, и молча отклоняет попытку. Заодно это и
 * честный момент старта: игрок взялся за стик — пошла музыка.
 *
 * Пока вкладка скрыта, музыка замолкает: играть в пустоту незачем, а вернувшись,
 * игрок продолжит с того же места.
 */
export class Music {
  constructor() {
    this.audio = new Audio(CFG.file);
    this.audio.loop = true;
    this.audio.volume = CFG.volume;
    this.audio.preload = 'auto';

    this.started = false;
    this.start = this.start.bind(this);

    // Слушаем и касание, и мышь, и клавиши: на десктопе экрана касаться нечем.
    for (const event of ['pointerdown', 'touchstart', 'keydown']) {
      addEventListener(event, this.start, { once: true });
    }

    document.addEventListener('visibilitychange', () => {
      if (!this.started) return;
      if (document.hidden) this.audio.pause();
      else this.audio.play().catch(() => {});
    });
  }

  /** Пустить музыку. Второй раз ничего не делает: дорожка уже играет. */
  start() {
    if (this.started) return;
    this.started = true;

    this.audio.play().catch(() => {
      // Не пустили и теперь — ждём следующего касания.
      this.started = false;
      addEventListener('pointerdown', this.start, { once: true });
    });
  }
}
