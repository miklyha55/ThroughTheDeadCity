import { CONFIG } from '../config.js';

const CFG = CONFIG.sounds;

/**
 * Короткие звуки: выстрелы, удары, хрипы.
 *
 * Держатся не на элементах `<audio>`, а на Web Audio: каждый файл один раз
 * разбирается в память, и дальше любое срабатывание — это запуск готового куска,
 * без обращения к диску и без раскодирования на ходу.
 *
 * Разница не косметическая. На элементах выходило по нескольку штук на каждый
 * звук — под шесть десятков на игру, — и телефон грузил их лениво, по одному и
 * только после касания: первые выстрелы уходили в тишину, а звук появлялся
 * через десяток убитых зомби. Вдобавок каждый запуск подтормаживал кадр.
 *
 * Если у звука несколько файлов, каждый раз берётся случайный — так десять
 * одинаковых хрипов подряд не звучат одинаково.
 *
 * Но и одного файла хватает, чтобы не надоесть: у каждого срабатывания слегка
 * гуляет высота тона и громкость. Ухо такие мелкие отличия по отдельности не
 * замечает, а вот точную копию подряд — замечает сразу и начинает раздражаться.
 */
export class Sfx {
  /** @param {Record<string, string[]>} sets — имя звука → список файлов */
  constructor(sets) {
    this.files = new Map(Object.entries(sets));
    this.banks = new Map();   // имя → массив разобранных кусков
    this.loops = new Map();   // зацикленные: их надо уметь остановить поимённо
    this.playing = new Set(); // всё, что звучит прямо сейчас
    this.echoes = new Set();  // отложенные отзвуки: их тоже надо уметь отменить

    const Ctx = window.AudioContext ?? window.webkitAudioContext;
    this.ctx = Ctx ? new Ctx() : null;

    if (!this.ctx) return; // без Web Audio просто обойдёмся без звука

    this.master = this.ctx.createGain();
    this.master.gain.value = 1;
    this.master.connect(this.ctx.destination);

    // Браузер не даёт звучать, пока игрок ничего не нажал. Ждём первого
    // касания и будим звук — до тех пор он просто молчит.
    const wake = () => this.ctx.resume().catch(() => {});
    for (const event of ['pointerdown', 'touchstart', 'keydown']) {
      addEventListener(event, wake, { once: true });
    }
  }

  /**
   * Разобрать все файлы в память. Зовётся на загрузке, вместе с моделями.
   *
   * Сбой одного звука не держит остальные: не разобрался — значит его не будет,
   * но игра начнётся и всё прочее зазвучит.
   */
  async load() {
    if (!this.ctx) return;

    await Promise.all([...this.files].map(async ([name, files]) => {
      const bank = await Promise.all(files.map(async (url) => {
        try {
          const res = await fetch(url);
          return await this.ctx.decodeAudioData(await res.arrayBuffer());
        } catch {
          return null;
        }
      }));

      this.banks.set(name, bank.filter(Boolean));
    }));
  }

  /**
   * Зацикленный звук: шаги, ветер — всё, что длится, пока длится действие.
   *
   * @param {string} name — какой звук
   * @param {boolean} playing — должен ли он сейчас звучать
   * @param {number} [loudness] — доля от общей громкости
   * @param {number} [rate] — темп: им задаётся и скорость, и высота тона
   */
  loop(name, playing, loudness = 1, rate = 1) {
    if (!this.ctx) return;

    const going = this.loops.get(name);
    if (!playing) {
      if (going) {
        this._drop(going);
        this.loops.delete(name);
      }
      return;
    }

    if (going) {
      going.source.playbackRate.value = rate;
      going.gain.gain.value = Math.min(1, CFG.volume * loudness);
      return;
    }

    const voice = this._voice(name, loudness, rate, true);
    if (voice) this.loops.set(name, voice);
  }

  /**
   * Громкость задаётся долей от общей, а не абсолютом: общую крутят в одном
   * месте, и все звуки едут за ней вместе.
   *
   * @param {string} name — какой звук
   * @param {number} [loudness] — доля от общей громкости
   * @param {number} [layers] — сколько дорожек пустить разом
   * @param {number} [pitch] — сдвиг высоты тона: ниже единицы — ниже и глуше
   *
   * По-настоящему громкое — взрыв — пускается в несколько дорожек сразу: они
   * складываются по амплитуде, а лёгкий разброс высоты между ними делает звук
   * плотнее, а не просто громче.
   */
  play(name, loudness = 1, layers = 1, pitch = 1) {
    if (!this.ctx) return;

    for (let i = 0; i < layers; i++) this._once(name, loudness, pitch);

    // Отзвук: тот же выстрел, но тише, глуше и с небольшим опозданием — будто
    // отразился от стен. Приходит он не всегда и каждый раз через разное время,
    // поэтому два выстрела подряд звучат по-разному, даже если сэмпл один.
    if (Math.random() > CFG.echoChance) return;

    const delay = CFG.echoDelay + Math.random() * CFG.echoSpread;
    const timer = setTimeout(() => {
      this.echoes.delete(timer);
      this._once(name, loudness * CFG.echoVolume, CFG.echoPitch * pitch);
    }, delay);
    this.echoes.add(timer);
  }

  /**
   * Оборвать всё, что сейчас звучит.
   *
   * Нужно на смене локации: под заставкой мир исчезает целиком, а звук о нём
   * ничего не знает и продолжает топать и хрипеть. Отзвуки выстрелов гасятся
   * вместе с остальным: они ждут своего часа по таймеру и иначе прилетели бы
   * уже в новый уровень.
   */
  silence() {
    for (const timer of this.echoes) clearTimeout(timer);
    this.echoes.clear();

    for (const voice of [...this.playing]) this._drop(voice);
    this.loops.clear();
  }

  /** Одно срабатывание: случайный файл, своя высота тона и громкость. */
  _once(name, loudness, pitchShift = 1) {
    const spread = (range) => 1 + (Math.random() - 0.5) * 2 * range;
    this._voice(name, loudness * spread(CFG.loudnessSpread), spread(CFG.pitchSpread) * pitchShift);
  }

  /** Завести голос: источник, своя громкость, свой темп. */
  _voice(name, loudness, rate, loop = false) {
    const bank = this.banks.get(name);
    if (!bank?.length) return null;

    const source = this.ctx.createBufferSource();
    source.buffer = bank[Math.floor(Math.random() * bank.length)];
    source.loop = loop;
    source.playbackRate.value = rate;

    const gain = this.ctx.createGain();
    gain.gain.value = Math.min(1, CFG.volume * loudness);

    source.connect(gain).connect(this.master);

    const voice = { source, gain };
    this.playing.add(voice);
    source.onended = () => this.playing.delete(voice);

    source.start();
    return voice;
  }

  /** Оборвать голос и отпустить его узлы. */
  _drop(voice) {
    this.playing.delete(voice);
    voice.source.onended = null;
    try {
      voice.source.stop();
    } catch {
      // уже кончился сам — останавливать нечего
    }
    voice.source.disconnect();
    voice.gain.disconnect();
  }
}
