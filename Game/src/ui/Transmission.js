import { CONFIG } from '../config.js';

const CFG = CONFIG.startMessage;

/**
 * Текст вступления, набирающийся по букве внизу экрана.
 *
 * Ведётся самим звуком: положение в тексте берётся из того, сколько уже сыграно
 * дорожки, а не из отдельного таймера. Таймер разошёлся бы при любой заминке —
 * браузер не пустил звук с первого раза, вкладку свернули, дорожка подгружалась
 * на ходу, — и к концу речи текст ушёл бы на абзац вперёд или отстал.
 *
 * Реплики идут по одной: девять абзацев разом не влезут, да и читать бегущий
 * хвост удобнее, чем простыню. Время каждой считается по длине — речь идёт
 * примерно ровно, и длинная фраза занимает больше короткой.
 */
export class Transmission {
  constructor(container = document.body) {
    this.root = document.createElement('div');
    this.root.className = 'radiotext';

    this.line = document.createElement('p');
    this.line.className = 'radiotext__line';

    // Реплика лежит в элементе целиком с самого начала, просто ненабранный
    // хвост прозрачен. Иначе каждая новая буква пересчитывала бы всю строку:
    // текст выровнен по центру и переносится по словам, и от каждой буквы
    // написанное дёргалось бы вбок, а на переносе прыгало бы и по высоте.
    this.typed = document.createElement('span');
    this.rest = document.createElement('span');
    this.rest.className = 'radiotext__rest';

    this.line.append(this.typed, this.rest);
    this.root.appendChild(this.line);
    container.appendChild(this.root);

    this.plan = null;
    this.audio = null;
    this._frame = 0;
    this._shown = '';
    this._width = 0;

    addEventListener('resize', () => this._reserve());
  }

  /**
   * Занять место под самую длинную реплику.
   *
   * Реплики разной длины занимают разное число строк, и на каждой смене блок
   * менял бы высоту — а он прижат к низу экрана, и вместе с высотой прыгал бы
   * весь текст. Померив все заранее, держим одну высоту на всю речь.
   *
   * Мерить приходится вживую: сколько строк займёт фраза, зависит от ширины
   * экрана и шрифта, и посчитать это по числу букв нельзя.
   */
  _reserve() {
    if (!CFG.lines?.length || this._width === innerWidth) return;
    this._width = innerWidth;

    const keep = [this.typed.textContent, this.rest.textContent];
    this.line.style.minHeight = '';

    let tallest = 0;
    for (const text of CFG.lines) {
      this.typed.textContent = text;
      this.rest.textContent = '';
      tallest = Math.max(tallest, this.line.getBoundingClientRect().height);
    }

    [this.typed.textContent, this.rest.textContent] = keep;
    this.line.style.minHeight = `${Math.ceil(tallest)}px`;
  }

  /**
   * Пустить текст вместе с дорожкой.
   * @param {HTMLAudioElement} audio — по ней и сверяемся
   */
  start(audio) {
    if (!CFG.lines?.length) return;

    this.audio = audio;
    this.root.classList.add('radiotext--on');
    this._reserve();
    this._tick();
  }

  stop() {
    cancelAnimationFrame(this._frame);
    this._frame = 0;
    this.root.classList.remove('radiotext--on');
    this.typed.textContent = '';
    this.rest.textContent = '';
    this._shown = '';
    this.plan = null;
  }

  /**
   * Расписание: когда начинается и кончается каждая реплика.
   *
   * Строится, когда станет известна длина дорожки, — до этого её неоткуда взять.
   * Вес реплики это её длина плюс небольшая добавка за саму реплику: между ними
   * говорящий делает паузу, и без этой добавки короткие фразы пролетали бы.
   */
  _schedule(duration) {
    const speech = Math.max(0.1, duration - CFG.leadIn - CFG.tailOut);
    const weights = CFG.lines.map((text) => text.length + CFG.linePause);
    const total = weights.reduce((sum, w) => sum + w, 0);

    let at = CFG.leadIn;
    return CFG.lines.map((text, i) => {
      const span = (weights[i] / total) * speech;
      const from = at;
      at += span;
      // хвост реплики — пауза перед следующей: печатаем чуть быстрее, чем длится
      return { text, from, to: from + span * CFG.typeShare };
    });
  }

  _tick() {
    this._frame = requestAnimationFrame(() => this._tick());

    const audio = this.audio;
    if (!audio) return;

    if (!this.plan) {
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) return; // длина ещё не известна
      this.plan = this._schedule(audio.duration);
    }

    // Текст идёт чуть впереди звука: пока глаз добежит до конца строки, ухо
    // как раз её услышит. Ноль в ноль читается как задержка.
    const now = audio.currentTime + CFG.advance;
    const line = this.plan.findLast((l) => now >= l.from) ?? this.plan[0];

    const share = line.to > line.from ? (now - line.from) / (line.to - line.from) : 1;
    const letters = Math.round(Math.min(1, Math.max(0, share)) * line.text.length);
    const text = line.text.slice(0, letters);

    if (text === this._shown) return; // за кадр буква меняется не всегда

    this._shown = text;
    this.typed.textContent = text;
    this.rest.textContent = line.text.slice(letters);
  }
}
