/**
 * Жизни машины: ряд делений вверху экрана, по одному на удар.
 *
 * Сделано теми же делениями, что и патроны, и стоит на том же месте: пока герой
 * за рулём, стрелять ему нечем, и ряд гильз там всё равно не нужен — одно
 * сменяет другое, а взгляд ищет их в одном и том же углу.
 *
 * Потраченные не исчезают, а гаснут: так видно и сколько осталось, и сколько
 * машина держала целиком.
 */
export class CarHealth {
  constructor(container = document.body) {
    this.root = document.createElement('div');
    this.root.className = 'carhp';
    this.root.hidden = true;

    this.cells = [];
    this.shown = -1;

    container.appendChild(this.root);
  }

  /**
   * Показать полоску на столько делений, сколько у машины жизней.
   * @param {number} left — сколько осталось
   * @param {number} total — сколько было целиком
   */
  set(left, total) {
    while (this.cells.length < total) {
      const cell = document.createElement('span');
      cell.className = 'carhp__cell';
      this.root.appendChild(cell);
      this.cells.push(cell);
    }
    while (this.cells.length > total) this.cells.pop().remove();

    if (left === this.shown) return;

    this.shown = left;
    this.cells.forEach((cell, i) => cell.classList.toggle('carhp__cell--lost', i >= left));
  }

  /** Полоска нужна, только пока игрок за рулём. */
  show(on) { this.root.hidden = !on; }
}
