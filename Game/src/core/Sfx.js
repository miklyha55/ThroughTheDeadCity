import { CONFIG } from '../config.js';

const CFG = CONFIG.sounds;

/**
 * Короткие звуки: выстрелы, удары, хрипы.
 *
 * На каждый звук держится небольшой набор готовых дорожек. Играть одну и ту же
 * повторно нельзя: второй выстрел оборвал бы первый на середине, а перезапуск с
 * нуля слышен как щелчок. Поэтому берётся первая свободная, а если все заняты —
 * самая старая: она и так почти доиграла.
 *
 * Если у звука несколько файлов, каждый раз берётся случайный — так десять
 * одинаковых хрипов подряд не звучат одинаково.
 */
export class Sfx {
  /** @param {Record<string, string[]>} sets — имя звука → список файлов */
  constructor(sets) {
    this.voices = new Map();

    for (const [name, files] of Object.entries(sets)) {
      const variants = files.map((file) => {
        const pool = [];
        for (let i = 0; i < CFG.pool; i++) {
          const audio = new Audio(file);
          audio.preload = 'auto';
          audio.volume = CFG.volume;
          pool.push(audio);
        }
        return { pool, next: 0 };
      });

      this.voices.set(name, variants);
    }
  }

  /**
   * @param {string} name — какой звук
   * @param {number} [volume] — своя громкость, если нужна тише общей
   */
  play(name, volume = CFG.volume) {
    const variants = this.voices.get(name);
    if (!variants?.length) return;

    const variant = variants[Math.floor(Math.random() * variants.length)];
    const audio = variant.pool[variant.next];
    variant.next = (variant.next + 1) % variant.pool.length;

    audio.currentTime = 0;
    audio.volume = volume;
    audio.play().catch(() => {}); // до первого касания браузер звук не пустит
  }
}
