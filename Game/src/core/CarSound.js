import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { listener, audioReady } from './audio.js';

const CFG = CONFIG.car;

/**
 * Мотор машины: одна запись по кругу, пока в машине сидят.
 *
 * Короткие звуки — газ, остановку — игра пускает через общий `Sfx`: они
 * звучат разово. А мотор тянется всё время и должен уметь встать и пойти
 * снова, поэтому у него свой голос с зацикленной дорожкой.
 *
 * Запись маленькая — четыре секунды, — и держится в памяти целиком, как и
 * прочие короткие звуки: круг должен смыкаться без щелчка, а потоковый элемент
 * на стыке запинается.
 */
export class CarSound {
  constructor() {
    this.voice = new THREE.Audio(listener);
    this.voice.setLoop(true);
    this.ready = false;
    this.level = 0; // нынешняя громкость мотора, доля от полной
  }

  /** Разобрать запись. Не вышло — мотора просто не будет, игра пойдёт дальше. */
  async load() {
    try {
      const buffer = await new THREE.AudioLoader().loadAsync(CFG.engineSound);
      this.voice.setBuffer(buffer);
      this.ready = true;
    } catch {
      this.ready = false;
    }
  }

  /**
   * Гудеть или молчать — и насколько громко.
   *
   * Зовётся каждый кадр: мотор стоит, пока игра на паузе, вкладка свёрнута или
   * в машине никого нет, и заводится, как только снова едут.
   *
   * Громкость идёт от хода: стоит машина — мотор урчит на холостых, чем
   * быстрее едет — тем громче. Меняется плавно: рывок громкости в один кадр
   * звучит как щелчок.
   *
   * @param {boolean} on
   * @param {number} [dt]
   * @param {number} [pace] — доля полной скорости машины, от 0 до 1
   */
  set(on, dt = 0, pace = 0) {
    if (!this.ready) return;

    if (!on || !audioReady()) {
      if (this.voice.isPlaying) this.voice.stop();
      this.level = 0;
      return;
    }

    const want = CFG.engineIdle + (CFG.engineFull - CFG.engineIdle) * Math.min(1, pace);
    const step = CFG.engineRise * dt;
    this.level = Math.abs(want - this.level) <= step ? want
      : this.level + Math.sign(want - this.level) * step;

    this.voice.setVolume(CONFIG.sounds.volume * this.level);
    if (!this.voice.isPlaying) this.voice.play();
  }
}
