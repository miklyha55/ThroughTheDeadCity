/**
 * Препятствия локации. Каждый проп представлен набором выпуклых контуров,
 * снятых с его геометрии: корпус машины отдельно, колёса отдельно, столбы забора
 * отдельно от жердей. Персонаж — круг; при пересечении его выталкивает наружу
 * по кратчайшему пути, поэтому вдоль стены он скользит, а не залипает.
 */
// На сколько метров за кадр выталкивание может сдвинуть тело.
const MAX_PUSH = 0.35;

export class Obstacles {
  constructor() {
    this.items = [];
  }

  /**
   * @param {THREE.Object3D} object — уже размещённый проп
   * @param {Array<Array<[number, number]>>} shapes — контуры в локальных осях пропа
   * @param {number[]} [tops] — высота каждого контура, если она нужна для проверок
   */
  add(object, shapes, tops) {
    if (!shapes?.length) return;

    const yaw = object.rotation.y;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const scaleX = object.scale.x;
    const scaleZ = object.scale.z;

    for (let index = 0; index < shapes.length; index++) {
      const shape = shapes[index];
      const points = [];
      let cx = 0;
      let cz = 0;

      for (const [lx, lz] of shape) {
        const sx = lx * scaleX;
        const sz = lz * scaleZ;
        const x = object.position.x + sx * cos + sz * sin;
        const z = object.position.z - sx * sin + sz * cos;
        points.push(x, z);
        cx += x;
        cz += z;
      }

      const count = points.length / 2;
      cx /= count;
      cz /= count;

      let reach = 0;
      for (let i = 0; i < points.length; i += 2) {
        reach = Math.max(reach, Math.hypot(points[i] - cx, points[i + 1] - cz));
      }

      this.items.push({ points, cx, cz, reach, top: tops?.[index] ?? Infinity });
    }
  }

  /**
   * Свободна ли линия между двумя точками — например, для выстрела.
   * Радиус пули почти нулевой, поэтому в щель между машиной и стеной она пройдёт,
   * а сквозь дом — нет.
   */
  blocksLine(x1, z1, x2, z2, step = 0.25) {
    const length = Math.hypot(x2 - x1, z2 - z1);
    const steps = Math.max(1, Math.ceil(length / step));

    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.hits(x1 + (x2 - x1) * t, z1 + (z2 - z1) * t, 0.05)) return true;
    }
    return false;
  }

  /** Задевает ли круг хоть один контур — нужно, чтобы не ставить пропы внутрь других моделей. */
  hits(x, z, radius) {
    for (const item of this.items) {
      const span = item.reach + radius;
      if (Math.abs(x - item.cx) > span || Math.abs(z - item.cz) > span) continue;

      const { points } = item;
      const count = points.length / 2;
      let deepest = -Infinity;
      let nearest = Infinity;

      for (let i = 0; i < count; i++) {
        const ax = points[i * 2];
        const az = points[i * 2 + 1];
        const j = (i + 1) % count;
        const ex = points[j * 2] - ax;
        const ez = points[j * 2 + 1] - az;
        const lengthSq = ex * ex + ez * ez;
        if (lengthSq === 0) continue;

        const length = Math.sqrt(lengthSq);
        deepest = Math.max(deepest, ((x - ax) * ez - (z - az) * ex) / length);

        const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / lengthSq));
        nearest = Math.min(nearest, Math.hypot(x - (ax + ex * t), z - (az + ez * t)));
      }

      if (deepest < 0 || nearest < radius) return true;
    }
    return false;
  }

  /**
   * Выталкивает точку из всех контуров, в которые она попала.
   * @param {THREE.Vector3} position — правится на месте
   * @param {number} radius — радиус персонажа
   */
  resolve(position, radius) {
    // Суммарное выталкивание за кадр ограничено: рядом со сложной моделью
    // контуров много, и каждый толкает по-своему. Без предела персонажа
    // «возит» между ними — со стороны это выглядит так, будто он сам бежит.
    const startX = position.x;
    const startZ = position.z;

    for (const item of this.items) {
      const span = item.reach + radius;
      if (Math.abs(position.x - item.cx) > span || Math.abs(position.z - item.cz) > span) continue;

      const { points } = item;
      const count = points.length / 2;

      // Насколько точка «снаружи»: у выпуклого контура достаточно самой дальней
      // опорной прямой. Отрицательное значение означает, что точка внутри.
      let deepest = -Infinity;
      let normalX = 0;
      let normalZ = 0;

      // и заодно ближайшая точка границы — она понадобится возле углов
      let bestDistance = Infinity;
      let nearX = 0;
      let nearZ = 0;

      for (let i = 0; i < count; i++) {
        const ax = points[i * 2];
        const az = points[i * 2 + 1];
        const j = (i + 1) % count;
        const bx = points[j * 2];
        const bz = points[j * 2 + 1];

        const ex = bx - ax;
        const ez = bz - az;
        const lengthSq = ex * ex + ez * ez;
        if (lengthSq === 0) continue;

        const length = Math.sqrt(lengthSq);
        const nx = ez / length;   // внешняя нормаль ребра при обходе против часовой
        const nz = -ex / length;
        const outside = (position.x - ax) * nx + (position.z - az) * nz;
        if (outside > deepest) {
          deepest = outside;
          normalX = nx;
          normalZ = nz;
        }

        const t = Math.max(0, Math.min(1, ((position.x - ax) * ex + (position.z - az) * ez) / lengthSq));
        const px = ax + ex * t;
        const pz = az + ez * t;
        const distance = Math.hypot(position.x - px, position.z - pz);
        if (distance < bestDistance) {
          bestDistance = distance;
          nearX = px;
          nearZ = pz;
        }
      }

      if (deepest >= radius) continue; // снаружи и дальше радиуса — не задевает

      if (deepest < 0) {
        // внутри контура: выходим через ближайшую грань
        position.x += normalX * (radius - deepest);
        position.z += normalZ * (radius - deepest);
      } else if (bestDistance < radius) {
        // снаружи, но круг накрывает границу — отталкиваемся от ближайшей точки
        const dx = position.x - nearX;
        const dz = position.z - nearZ;
        const distance = Math.hypot(dx, dz) || 1;
        const push = (radius - distance) / distance;
        position.x += dx * push;
        position.z += dz * push;
      }
    }

    const movedX = position.x - startX;
    const movedZ = position.z - startZ;
    const moved = Math.hypot(movedX, movedZ);

    if (moved > MAX_PUSH) {
      const k = MAX_PUSH / moved;
      position.x = startX + movedX * k;
      position.z = startZ + movedZ * k;
    }
  }
}
