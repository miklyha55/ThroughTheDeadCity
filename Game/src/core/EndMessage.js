import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { listener, resumeAudio } from './audio.js';

const CFG = CONFIG.endMessage;

/**
 * Ответная передача: голос по рации после последнего уровня.
 *
 * Игра кончилась, но финальную картинку показывать рано: сперва та, что звала
 * героя через весь город, должна ответить. Поэтому между последним уровнем и
 * финалом встаёт чёрный экран — та же рация в углу, тот же текст по буквам, что
 * и во вступлении. Отговорив, экран растворяется, и под ним уже финал.
 *
 * Свой чёрный слой, а не финальный экран под голосом: картинка под речью тянула
 * бы внимание на себя, а это разговор, и смотреть в это время не на что.
 *
 * Пропускается так же, как вступление: клавишей на столе, вторым касанием на
 * телефоне. И так же не держит игрока, если звук не завёлся: молчащая передача
 * не повод не показать финал.
 */
export class EndMessage {
  /**
   * @param {import('../ui/Transmission.js').Transmission} text — субтитры
   * @param {import('../ui/Radio.js').Radio} radio — рация в углу
   * @param {{show: () => void, hide: () => void}} [mapButton] — кнопка карты
   *   уровней: под передачей её быть не должно, игра уже кончилась
   * @param {import('../ui/SkipHint.js').SkipHint} [hint] — сноска о пропуске
   */
  constructor(text, radio, mapButton = null, hint = null, container = document.body) {
    this.text = text;
    this.radio = radio;
    this.mapButton = mapButton;
    this.hint = hint;
    this.onDone = null; // кому сказать, что можно показывать финал

    this.root = document.createElement('div');
    this.root.className = 'endmsg';
    this.root.hidden = true;
    container.appendChild(this.root);

    this.audio = new Audio(CFG.file);
    this.audio.preload = 'auto';

    // Через общего слушателя, как и вступление: громкость и пауза площадки
    // действуют на речь так же, как на всё остальное.
    this.voice = new THREE.Audio(listener);
    this.voice.setMediaElementSource(this.audio);
    this.voice.setVolume(CFG.volume);

    this.speaking = false;
    this._timer = null;
    this._fade = null;
    this._tap = null;
    this._tapTimer = null;

    addEventListener('keydown', (event) => {
      if (event.code === CFG.skipKey && this.speaking) this.skip();
    });
  }

  /** Пустить передачу. Финал откроется сам, когда она кончится. */
  play() {
    if (this.speaking) return;

    this.speaking = true;
    this.root.hidden = false;
    // Кадр на то, чтобы браузер заметил появление: без него переходу
    // прозрачности не с чего начинать.
    requestAnimationFrame(() => this.root.classList.add('endmsg--on'));

    this.radio?.toggle(true);
    this.mapButton?.hide();
    this.hint?.arm(); // «Esc — пропустить»: та же сноска, что и во вступлении
    resumeAudio();

    this.audio.addEventListener('ended', () => this._finish(), { once: true });
    this.audio.addEventListener('error', () => this._finish(), { once: true });

    // Предохранитель: дорожка может не доиграть и не сказать об этом — вкладку
    // свернули, звук не отдали. Финал всё равно откроется.
    this._timer = setTimeout(() => this._finish(), CFG.maxWait * 1000);

    this.text?.start(this.audio); // текст идёт за дорожкой, а не за таймером

    this.audio.play().catch(() => this._finish());
    this._armTap();
  }

  /** Пропустить: речь обрывается, финал открывается сразу. */
  skip() {
    if (!this.speaking) return;

    this.audio.pause();
    this.audio.currentTime = 0;
    this._finish();
  }

  /**
   * Пропуск вторым касанием — для телефона, где клавиши Escape нет. Мышь сюда
   * не идёт: на столе речь пропускается клавишей, а случайный щелчок обрывал бы
   * её ни за что.
   */
  _armTap() {
    this._tap = (event) => {
      if (event.pointerType === 'mouse') return;
      this.skip();
    };
    this._tapTimer = setTimeout(() => {
      addEventListener('pointerdown', this._tap);
    }, CFG.tapSkipAfter * 1000);
  }

  _finish() {
    if (!this.speaking) return;
    this.speaking = false;

    clearTimeout(this._timer);
    clearTimeout(this._tapTimer);
    if (this._tap) removeEventListener('pointerdown', this._tap);
    this._tap = null;

    this.text?.stop();
    this.radio?.toggle(false);
    this.hint?.hide();

    // Чёрный растворяется, и из-под него проступает финал. Сначала говорим о
    // конце речи, и только потом убираем слой: финальный экран должен уже
    // стоять под ним, иначе между ними мигнёт сама игра.
    this.onDone?.();

    this.root.classList.remove('endmsg--on');
    this._fade = setTimeout(() => { this.root.hidden = true; }, CFG.fadeOut * 1000);
  }
}
