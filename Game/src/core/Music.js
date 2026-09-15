import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { listener, wakeAudio, audioGreeted } from './audio.js';

const CFG = CONFIG.music;

/**
 * Фоновая музыка: своя дорожка на каждый уровень, по кругу до его конца.
 *
 * Идёт через тот же `THREE.Audio` и того же слушателя, что и всё остальное, но
 * источником взят не разобранный кусок, а потоковый элемент —
 * `setMediaElementSource`. Так предписано и документацией three, и здравым
 * смыслом: дорожка уровня это несколько минут, а разобранная в память минута
 * стоит около пятнадцати мегабайт. Три дорожки съели бы больше, чем вся
 * остальная игра, ради звука, который и так прекрасно течёт с диска.
 *
 * Дорожка выбирается номером уровня — файл `1.mp3` лежит под первым, `2.mp3` под
 * вторым. Пока номер не сменился, музыка не перезапускается: возврат на ту же
 * локацию не обрывает её с начала.
 *
 * Первый запуск ждёт действия игрока — раньше и нельзя: браузер не даёт начать
 * звук, пока ничего не нажато, и молча отклоняет попытку. Обычно это нажатие на
 * воротах, ещё до загрузки; если ворот почему-то не было, годится любое первое
 * касание, мышь или клавиша.
 *
 * Пока вкладка скрыта, музыка замолкает: играть в пустоту незачем, а вернувшись,
 * игрок продолжит с того же места.
 */
export class Music {
  constructor() {
    this.audio = new Audio();
    this.audio.loop = true;
    this.audio.preload = 'auto';

    // Громкость крутится на стороне three, а не элемента: одна ручка на весь
    // граф. Элемент остаётся на единице, иначе они умножались бы друг на друга.
    this.sound = new THREE.Audio(listener);
    this.sound.setMediaElementSource(this.audio);
    this.sound.setVolume(CFG.volume);

    this.track = null; // номер уровня, чья дорожка сейчас заряжена
    // Разрешение мог дать уже экран с кнопкой «Играть» — тогда ждать нечего и
    // музыка пойдёт сразу, как только у уровня появится номер.
    this.allowed = audioGreeted();
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
    // Дорожки нет, только если её и не ставили. Сравниваем именно с пустотой:
    // у вводной локации номер ноль, а он считается ложью — и её музыка молчала,
    // хотя файл лежал на месте.
    if (!this.allowed || this.track === null || this.track === undefined) return;

    // Элемент теперь звучит не сам по себе, а через общий граф: пока контекст
    // спит, играющая дорожка не даёт ни звука. Поэтому будим его здесь же —
    // вызов приходит из обработчика касания, а значит жест ещё в силе.
    wakeAudio();

    this.audio.play().catch(() => {
      // Браузер не пустил — ждём следующего касания и пробуем снова.
      this.allowed = false;
      addEventListener('pointerdown', this.start, { once: true });
    });
  }
}
