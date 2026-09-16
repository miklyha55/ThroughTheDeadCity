import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { listener, audioReady } from './audio.js';

const CFG = CONFIG.sounds;

/**
 * Короткие звуки: выстрелы, удары, хрипы.
 *
 * Собраны на штатных классах three: файлы разбирает `THREE.AudioLoader`, каждый
 * голос — это `THREE.Audio` на общем `THREE.AudioListener`. Разбор идёт один раз
 * на загрузке, дальше любое срабатывание берёт готовый кусок из памяти, без
 * обращения к диску и без раскодирования на ходу.
 *
 * Разница не косметическая. На элементах `<audio>` выходило по нескольку штук на
 * каждый звук — под шесть десятков на игру, — и телефон грузил их лениво, по
 * одному и только после касания: первые выстрелы уходили в тишину, а звук
 * появлялся через десяток убитых зомби. Вдобавок каждый запуск подтормаживал
 * кадр.
 *
 * Один `THREE.Audio` умеет играть только одну вещь за раз: второй `play()` по
 * занятому голосу three отклоняет с предупреждением. Поэтому на каждый звук
 * держится пул из `CONFIG.sounds.pool` голосов — столько выстрелов и может
 * звучать внахлёст, не обрывая друг друга. Свободный берётся первым; если
 * свободных нет, занимается самый давний по кругу.
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
    this.banks = new Map();  // имя → разобранные куски
    this.pools = new Map();  // имя → голоса наготове
    this.next = new Map();   // имя → кого занимать, когда все заняты
    this.echoes = new Set(); // отложенные отзвуки: их тоже надо уметь отменить
  }

  /**
   * Разобрать все файлы в память. Зовётся на загрузке, вместе с моделями.
   *
   * Сбой одного звука не держит остальные: не разобрался — значит его не будет,
   * но игра начнётся и всё прочее зазвучит.
   */
  async load() {
    const loader = new THREE.AudioLoader();
    const width = Math.max(1, CFG.pool);

    await Promise.all([...this.files].map(async ([name, files]) => {
      const bank = await Promise.all(
        files.map((url) => loader.loadAsync(url).catch(() => null))
      );

      this.banks.set(name, bank.filter(Boolean));
      this.pools.set(name, Array.from({ length: width }, () => new THREE.Audio(listener)));
      this.next.set(name, 0);
    }));
  }

  /**
   * Громкость задаётся долей от общей, а не абсолютом: общую крутят в одном
   * месте, и все звуки едут за ней вместе.
   *
   * @param {string} name — какой звук
   * @param {number} [loudness] — доля от общей громкости
   * @param {number} [layers] — сколько дорожек пустить разом
   * @param {number} [pitch] — сдвиг высоты тона: ниже единицы — ниже и глуше
   * @param {{echo?: boolean, spread?: boolean}} [opts] — отзвук от стен и разброс
   *   между дорожками
   *
   * По-настоящему громкое — взрыв — пускается в несколько дорожек сразу: они
   * складываются по амплитуде и звучат выше потолка одной.
   *
   * Разброс высоты и громкости между дорожками подходит не всякому звуку. Для
   * короткого сэмпла он даёт плотность, а для долгого раската дорожки, пущенные
   * с разной скоростью, расходятся на слух — и вместо одного взрыва слышно два
   * подряд. Такому звуку разброс выключают, и тогда дорожки складываются точно.
   *
   * Отзвук — та же история. Выстрелу он читается как отражение от стен, а у
   * взрыва приходит, когда собственный хвост ещё звучит, и снова слышится
   * вторым взрывом.
   */
  play(name, loudness = 1, layers = 1, pitch = 1, opts = {}) {
    // Пока звук не разрешён, запускать нечего: голос всё равно был бы выброшен,
    // а отзвук прилетел бы в тишину уже после того, как всё началось.
    if (!audioReady()) return;

    const { echo = true, spread = true } = opts;

    for (let i = 0; i < layers; i++) this._once(name, loudness, pitch, spread);

    // Отзвук: тот же выстрел, но тише, глуше и с небольшим опозданием — будто
    // отразился от стен. Приходит он не всегда и каждый раз через разное время,
    // поэтому два выстрела подряд звучат по-разному, даже если сэмпл один.
    if (!echo || Math.random() > CFG.echoChance) return;

    const delay = CFG.echoDelay + Math.random() * CFG.echoSpread;
    const timer = setTimeout(() => {
      this.echoes.delete(timer);
      this._once(name, loudness * CFG.echoVolume, CFG.echoPitch * pitch, spread);
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

    for (const pool of this.pools.values()) {
      for (const voice of pool) {
        if (voice.isPlaying) voice.stop();
      }
    }
  }

  /** Одно срабатывание: случайный файл, своя высота тона и громкость. */
  _once(name, loudness, pitchShift = 1, vary = true) {
    const off = (range) => 1 + (Math.random() - 0.5) * 2 * (vary ? range : 0);
    this._voice(name, loudness * off(CFG.loudnessSpread), off(CFG.pitchSpread) * pitchShift);
  }

  /** Завести голос: свободная дорожка из пула, своя громкость, свой темп. */
  _voice(name, loudness, rate) {
    const buffer = this._pick(name);
    if (!buffer || !audioReady()) return null;

    const pool = this.pools.get(name);
    let voice = pool.find((one) => !one.isPlaying);

    if (!voice) {
      // Все заняты: забираем самый давний. Обрыв слышен меньше, чем пропущенный
      // выстрел, а расширять пул на каждый залп дороже, чем один такой обрыв.
      const turn = this.next.get(name);
      voice = pool[turn];
      this.next.set(name, (turn + 1) % pool.length);
      voice.stop();
    }

    voice.setBuffer(buffer);
    voice.setPlaybackRate(rate);
    voice.setVolume(this._level(loudness));
    voice.play();

    return voice;
  }

  /** Случайный кусок из банка: нет банка — нет и звука. */
  _pick(name) {
    const bank = this.banks.get(name);
    if (!bank?.length) return null;

    return bank[Math.floor(Math.random() * bank.length)];
  }

  /** Доля от общей громкости, но не громче единицы. */
  _level(loudness) {
    return Math.min(1, CFG.volume * loudness);
  }
}
