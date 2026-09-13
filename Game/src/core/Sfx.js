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
 *
 * Но и одного файла хватает, чтобы не надоесть: у каждого срабатывания слегка
 * гуляет высота тона и громкость. Ухо такие мелкие отличия по отдельности не
 * замечает, а вот точную копию подряд — замечает сразу и начинает раздражаться.
 * Высота меняется через скорость воспроизведения, поэтому браузеру приходится
 * запретить «выравнивание тона»: иначе он старательно вернёт всё как было.
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

          // иначе браузер сохранит высоту тона при смене скорости
          audio.preservesPitch = false;
          audio.mozPreservesPitch = false;
          audio.webkitPreservesPitch = false;

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
   * @param {number} [layers] — сколько дорожек пустить разом
   *
   * Громкость одной дорожки браузер ограничивает единицей, и поднять звук выше
   * этого потолка нечем. Поэтому по-настоящему громкое — взрыв — пускается в
   * несколько дорожек сразу: они складываются по амплитуде, а лёгкий разброс
   * высоты между ними делает звук ещё и плотнее, а не просто громче.
   */
  play(name, volume = CFG.volume, layers = 1) {
    for (let i = 0; i < layers; i++) this._once(name, volume);

    // Отзвук: тот же выстрел, но тише, глуше и с небольшим опозданием — будто
    // отразился от стен. Приходит он не всегда и каждый раз через разное время,
    // поэтому два выстрела подряд звучат по-разному, даже если сэмпл один.
    if (Math.random() > CFG.echoChance) return;

    const delay = CFG.echoDelay + Math.random() * CFG.echoSpread;
    setTimeout(() => this._once(name, volume * CFG.echoVolume, CFG.echoPitch), delay);
  }

  /** Одно срабатывание: свободная дорожка, своя высота тона и громкость. */
  _once(name, volume, pitchShift = 1) {
    const variants = this.voices.get(name);
    if (!variants?.length) return;

    const variant = variants[Math.floor(Math.random() * variants.length)];
    const audio = variant.pool[variant.next];
    variant.next = (variant.next + 1) % variant.pool.length;

    const spread = (range) => 1 + (Math.random() - 0.5) * 2 * range;

    audio.currentTime = 0;
    audio.volume = Math.min(1, volume * spread(CFG.loudnessSpread));
    audio.playbackRate = spread(CFG.pitchSpread) * pitchShift;
    audio.play().catch(() => {}); // до первого касания браузер звук не пустит
  }
}
