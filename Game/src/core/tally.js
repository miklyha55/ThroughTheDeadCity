/**
 * Счёт пути: сколько зомби уложено, сколько раз погиб герой и сколько он идёт.
 *
 * Нужен одному финалу — показать игроку, чем кончился его поход. Поэтому живёт
 * в памяти и никуда не сохраняется: это итог одного прохождения, а не рекорд.
 *
 * Время считается от первого шага на первом уровне и до выхода из города, с
 * поправкой на паузы: под заставкой, картой уровней и рекламой герой не идёт, и
 * это время в путь не засчитывается.
 */
class Tally {
  constructor() {
    this.kills = 0;
    this.deaths = 0;
    this._since = 0;   // когда пошёл нынешний отрезок пути, мс; ноль — стоим
    this._walked = 0;  // и сколько уже насчитано, мс
  }

  /** Начать заново: игра пошла с первого уровня. */
  reset() {
    this.kills = 0;
    this.deaths = 0;
    this._since = 0;
    this._walked = 0;
  }

  /** Часы идут: игрок в игре. */
  resume() {
    if (!this._since) this._since = performance.now();
  }

  /** И стоят: заставка, карта уровней, реклама, финал. */
  pause() {
    if (!this._since) return;

    this._walked += performance.now() - this._since;
    this._since = 0;
  }

  /** Сколько всего пройдено, с. */
  get seconds() {
    const running = this._since ? performance.now() - this._since : 0;
    return (this._walked + running) / 1000;
  }

  /** Время в виде «7:42» — минуты и секунды. */
  get clock() {
    const total = Math.max(0, Math.round(this.seconds));
    const minutes = Math.floor(total / 60);
    return `${minutes}:${String(total % 60).padStart(2, '0')}`;
  }
}

export const tally = new Tally();
