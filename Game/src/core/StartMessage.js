import { CONFIG } from '../config.js';

const CFG = CONFIG.startMessage;

/**
 * Вступительное сообщение: голос, с которого начинается первый уровень.
 *
 * Пока он говорит, персонаж не управляется — иначе игрок убежит с первых слов
 * и не услышит, зачем он вообще здесь. Замок стоит с самого начала уровня, ещё
 * до первого касания: иначе между появлением мира и первым тапом оставалась бы
 * щель, в которую можно уйти.
 *
 * Пускается сообщение тем же первым касанием, что и музыка, — раньше браузер
 * звук всё равно не даст, и играть оно начало бы в тишину.
 *
 * Звучит один раз за сеанс. Смерть на первом уровне — дело обычное, и слушать
 * одну и ту же речь после каждой перезагрузки уровня было бы наказанием.
 *
 * Если звук не завёлся — файла нет, браузер отказал, дорожка зависла, — замок
 * снимается сам. Молчащее сообщение не повод оставить игрока без управления.
 */
export class StartMessage {
  /** @param {import('../ui/Transmission.js').Transmission} [text] — субтитры */
  constructor(text = null) {
    this.text = text;
    this.audio = new Audio(CFG.file);
    this.audio.preload = 'auto';
    this.audio.volume = CFG.volume;

    this.state = 'idle'; // idle → armed (ждём касание) → speaking → done
    this.played = false;
    this.muted = false;  // выключено в панели разработчика: логика не запускается вовсе
    this.start = this.start.bind(this);
    this._timer = null;
  }

  /** Управление отобрано: либо ещё ждём касания, либо голос говорит. */
  get locked() {
    return this.state === 'armed' || this.state === 'speaking';
  }

  /**
   * Поставить сообщение на уровень. На остальных — и на повторном заходе
   * на первый — молчит.
   *
   * @param {number} level — номер уровня из его файла
   */
  arm(level) {
    if (this.muted || this.played || level !== CFG.level) return;

    this.state = 'armed';

    // Слушаем и касание, и мышь, и клавиши: на десктопе экрана касаться нечем.
    for (const event of ['pointerdown', 'touchstart', 'keydown']) {
      addEventListener(event, this.start, { once: true });
    }
  }

  /** Пустить голос: игрок впервые тронул экран. */
  start() {
    if (this.state !== 'armed') return;

    this.state = 'speaking';
    this.played = true;

    this.audio.addEventListener('ended', () => this._release(), { once: true });
    this.audio.addEventListener('error', () => this._release(), { once: true });

    // Предохранитель: дорожка может не доиграть до конца и не сказать об этом —
    // вкладку свернули, звук не отдали. Замок снимется по времени.
    this._timer = setTimeout(() => this._release(), CFG.maxLock * 1000);

    this.text?.start(this.audio); // текст идёт за дорожкой, а не за таймером
    this.audio.play().catch(() => this._release()); // браузер отказал — не держим игрока
  }

  /**
   * Выключить вступление совсем — или вернуть его.
   *
   * Выключенное не просто молчит: замок с управления снимается тут же, даже
   * если голос уже говорит. Разработчику, который десятый раз перезапускает
   * уровень, ждать эти полминуты незачем.
   *
   * @param {boolean} off
   */
  mute(off) {
    this.muted = off;
    if (!off) return;

    this.audio.pause();
    this.audio.currentTime = 0;
    this._release();
  }

  _release() {
    clearTimeout(this._timer);
    this._timer = null;
    this.text?.stop();
    this.state = 'done';
  }
}
