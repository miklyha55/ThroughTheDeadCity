import * as THREE from 'three';

/**
 * Сетка проходимости и поле направлений к цели.
 *
 * Искать путь каждому зомби по отдельности незачем: цель у всех одна. Вместо
 * двадцати поисков считается одна волна от персонажа (Дейкстра по сетке), и
 * каждый зомби просто читает из своей клетки, куда шагнуть. Волна пересчитывается,
 * только когда персонаж переходит в другую клетку.
 *
 * Проходимость снимается один раз при сборке локации: она статична.
 */
export class NavGrid {
  /**
   * @param {number} width — размер площадки по X, м
   * @param {number} depth — размер площадки по Z, м
   * @param {number} cell — сторона клетки, м
   */
  /**
   * @param {number} maxRange — насколько далеко от цели считать волну, м.
   *   Дальше она не нужна: зомби за этой чертой всё равно стоят на месте.
   */
  constructor(width, depth, cell, maxRange = Infinity) {
    this.cell = cell;
    this.maxRange = maxRange;
    this.minX = -width / 2;
    this.minZ = -depth / 2;
    this.cols = Math.ceil(width / cell) + 1;
    this.rows = Math.ceil(depth / cell) + 1;

    const size = this.cols * this.rows;
    this.blocked = new Uint8Array(size);
    this.distance = new Float32Array(size).fill(Infinity);

    this._queue = [];
    this._targetCell = -1;
  }

  /**
   * Отмечает непроходимые клетки по контурам препятствий.
   * Радиус тела учитывается сразу, чтобы зомби не тёрся об углы.
   */
  build(obstacles, bodyRadius) {
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const x = this.minX + col * this.cell;
        const z = this.minZ + row * this.cell;
        this.blocked[row * this.cols + col] = obstacles.hits(x, z, bodyRadius) ? 1 : 0;
      }
    }
  }

  _cellOf(x, z) {
    const col = Math.round((x - this.minX) / this.cell);
    const row = Math.round((z - this.minZ) / this.cell);
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return -1;
    return row * this.cols + col;
  }

  /**
   * Пересчитывает волну от цели, если та сменила клетку.
   * @returns {boolean} пересчитывали ли в этот раз
   */
  update(target) {
    const cell = this._cellOf(target.x, target.z);
    if (cell < 0 || cell === this._targetCell) return false;

    this._targetCell = cell;
    this._flood(cell);
    return true;
  }


  /**
   * Волна от цели наружу. Стоимость шага — его длина: по диагонали дороже,
   * поэтому путь получается похожим на прямой, а не лесенкой.
   *
   * Клетка может попасть в очередь не один раз: найдя более короткий подход,
   * её кладут заново. Поэтому очередь растущая, а не фиксированной длины.
   */
  _flood(start) {
    const { cols, rows, distance, blocked } = this;
    distance.fill(Infinity);

    const queue = this._queue;
    queue.length = 0;
    let head = 0;

    // Цель может стоять вплотную к стене, и её клетка окажется закрытой —
    // волну всё равно пускаем отсюда, иначе зомби никуда не пойдут.
    distance[start] = 0;
    queue.push(start);

    const straight = this.cell;
    const diagonal = this.cell * Math.SQRT2;

    while (head < queue.length) {
      const cell = queue[head++];
      const base = distance[cell];
      if (base >= this.maxRange) continue; // дальше волну не ведём — там зомби спят
      const col = cell % cols;
      const row = (cell - col) / cols;

      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;

          const nc = col + dc;
          const nr = row + dr;
          if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;

          const next = nr * cols + nc;
          if (blocked[next]) continue;

          // по диагонали проходим, только если свободны обе соседние клетки:
          // иначе зомби срезал бы угол дома насквозь
          if (dr !== 0 && dc !== 0) {
            if (blocked[row * cols + nc] || blocked[nr * cols + col]) continue;
          }

          const cost = base + (dr !== 0 && dc !== 0 ? diagonal : straight);
          if (cost >= distance[next]) continue;

          distance[next] = cost;
          queue.push(next);
        }
      }
    }
  }

  /** Проходима ли точка. */
  isFree(x, z) {
    const cell = this._cellOf(x, z);
    return cell >= 0 && !this.blocked[cell];
  }

  /**
   * Направление к цели из точки: смотрим, у какого соседа волна пришла раньше.
   * @param {number} x
   * @param {number} z
   * @param {THREE.Vector3} out
   * @returns {boolean} нашлось ли направление
   */
  direction(x, z, out) {
    const cell = this._cellOf(x, z);
    if (cell < 0) return false;

    const { cols, rows, distance } = this;
    const col = cell % cols;
    const row = (cell - col) / cols;

    let best = distance[cell];
    let bestCol = col;
    let bestRow = row;

    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;

        const nc = col + dc;
        const nr = row + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;

        const value = distance[nr * cols + nc];
        if (value >= best) continue;

        best = value;
        bestCol = nc;
        bestRow = nr;
      }
    }
    if (bestCol === col && bestRow === row) return false; // тупик или уже на месте

    // целимся в центр выбранной клетки — так шаг получается ровным
    out.set(
      this.minX + bestCol * this.cell - x,
      0,
      this.minZ + bestRow * this.cell - z
    );
    const length = out.length();
    if (length < 1e-5) return false;

    out.divideScalar(length);
    return true;
  }

  /**
   * Свободен ли прямой путь между точками.
   * Если да, зомби идёт напрямую — по сетке движение выглядит ступенчатым.
   */
  hasLineOfSight(fromX, fromZ, toX, toZ) {
    const steps = Math.ceil(Math.hypot(toX - fromX, toZ - fromZ) / (this.cell * 0.5));

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (!this.isFree(fromX + (toX - fromX) * t, fromZ + (toZ - fromZ) * t)) return false;
    }
    return true;
  }
}
