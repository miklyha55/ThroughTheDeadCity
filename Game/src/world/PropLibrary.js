import * as THREE from 'three';
import { loadGLTF } from '../core/AssetLoader.js';

/**
 * Библиотека пропов из Env.blend: один GLB со всеми объектами, из которого
 * локации берут копии по имени. Геометрия и материалы общие — клонируются только ноды.
 */
export class PropLibrary {
  constructor(gltf) {
    this.templates = new Map();
    this.sizes = new Map();
    this.shapes = new Map();
    this.bodies = new Map();

    const box = new THREE.Box3();
    const size = new THREE.Vector3();

    for (const child of [...gltf.scene.children]) {
      const name = child.name.replace(/\.\d+$/, ''); // Blender дописывает .001 к дублям
      child.position.set(0, 0, 0);
      child.rotation.set(0, 0, 0);
      child.updateMatrixWorld(true);

      box.setFromObject(child).getSize(size);
      this.templates.set(name, child);
      this.sizes.set(name, size.clone());
      this.shapes.set(name, buildCollisionShapes(child));
      this.bodies.set(name, measureBody(child));
    }
  }

  static async load(url) {
    return new PropLibrary(await loadGLTF(url));
  }

  has(name) { return this.templates.has(name); }

  /** Габариты пропа в метрах — по ним раскладывается забор и проверяются отступы. */
  size(name) { return this.sizes.get(name); }

  /** Контуры столкновений: выпуклые многоугольники в локальных осях пропа. */
  collisionShapes(name) { return this.shapes.get(name) ?? []; }

  /** Масса, центр масс и габариты для физики: { com, boxMin, boxMax, volume }. */
  body(name) { return this.bodies.get(name); }

  /** Имена пропов по префиксу: list('Tree_') → все деревья. */
  list(prefix) {
    return [...this.templates.keys()].filter((n) => n.startsWith(prefix));
  }

  create(name) {
    const template = this.templates.get(name);
    if (!template) {
      console.warn(`[props] нет пропа «${name}»`);
      return null;
    }
    const clone = template.clone(true);
    clone.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    return clone;
  }
}


// Выше этой высоты геометрия в столкновения не идёт: крона дерева не должна мешать
// пройти рядом со стволом, а козырёк заправки — заехать под него.
const COLLISION_HEIGHT = 1.3;
// Контуры мельче этого (м²) отбрасываем: заклёпки и мелкие накладки ловить нечего.
const MIN_SHAPE_AREA = 0.02;
// Если деталей больше — обводим проп одним контуром. Столбов у сетки-рабицы под сотню,
// и каждый по отдельности считать дороже, чем он того стоит.
const MAX_SHAPES = 14;

/**
 * Контуры столкновений по геометрии пропа.
 *
 * Меш разбивается на связные куски (корпус, колёса, столбы, жерди), каждый кусок
 * обводится выпуклой оболочкой по его нижней части. Получается форма, повторяющая
 * реальные очертания: у трактора отдельно корпус и колёса, у забора — столбы и жерди,
 * у дерева — только ствол. Один общий прямоугольник так не умеет.
 */
function buildCollisionShapes(prop) {
  const triangles = [];
  const v = new THREE.Vector3();

  prop.updateMatrixWorld(true);
  prop.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const position = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.getIndex();
    const count = index ? index.count : position.count;

    for (let i = 0; i < count; i += 3) {
      const corners = [];
      for (let c = 0; c < 3; c++) {
        const at = index ? index.getX(i + c) : i + c;
        v.fromBufferAttribute(position, at).applyMatrix4(mesh.matrixWorld);
        corners.push([v.x, v.y, v.z]);
      }
      triangles.push(corners);
    }
  });

  // связные куски: вершины склеиваем по совпадающим позициям
  const owner = new Map();
  const find = (key) => {
    let root = key;
    while (owner.get(root) !== root) root = owner.get(root);
    while (owner.get(key) !== root) {
      const next = owner.get(key);
      owner.set(key, root);
      key = next;
    }
    return root;
  };
  const keyOf = ([x, y, z]) => `${Math.round(x * 1e3)},${Math.round(y * 1e3)},${Math.round(z * 1e3)}`;

  const triangleKeys = triangles.map((corners) => {
    const keys = corners.map(keyOf);
    for (const key of keys) if (!owner.has(key)) owner.set(key, key);
    const root = find(keys[0]);
    for (const key of keys) owner.set(find(key), root);
    return keys;
  });

  const parts = new Map();
  triangles.forEach((corners, i) => {
    const root = find(triangleKeys[i][0]);
    let points = parts.get(root);
    if (!points) parts.set(root, (points = []));
    for (const [x, y, z] of corners) {
      if (y <= COLLISION_HEIGHT) points.push([x, z]); // всё, что выше пояса, в контур не идёт
    }
  });

  let shapes = [];
  for (const points of parts.values()) {
    if (points.length < 3) continue;
    const hull = convexHull(points);
    if (hull.length >= 3 && polygonArea(hull) >= MIN_SHAPE_AREA) shapes.push(hull);
  }

  if (shapes.length > MAX_SHAPES) {
    const merged = convexHull(shapes.flat());
    shapes = merged.length >= 3 ? [merged] : [];
  }
  return shapes;
}

/**
 * Массовые свойства пропа: объём и центр масс считаются по тетраэдрам,
 * построенным на треугольниках оболочки — так центр масс полой бочки выходит
 * там, где он и должен быть, а не в середине габаритного ящика.
 *
 * Для незамкнутых моделей (листва, плоские вещи) знаковый объём вырождается,
 * и мы отступаем к центру габаритов.
 */
function measureBody(prop) {
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const box = new THREE.Box3().makeEmpty();

  let volume = 0;
  const centroid = new THREE.Vector3();

  prop.updateMatrixWorld(true);
  prop.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const position = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.getIndex();
    const count = index ? index.count : position.count;
    const at = (i, target) =>
      target.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld);

    for (let i = 0; i < count; i += 3) {
      at(i, a); at(i + 1, b); at(i + 2, c);
      box.expandByPoint(a).expandByPoint(b).expandByPoint(c);

      // знаковый объём тетраэдра на начале координат
      const v = a.dot(_cross.crossVectors(b, c)) / 6;
      volume += v;
      centroid.x += (a.x + b.x + c.x) * 0.25 * v;
      centroid.y += (a.y + b.y + c.y) * 0.25 * v;
      centroid.z += (a.z + b.z + c.z) * 0.25 * v;
    }
  });

  const size = box.getSize(new THREE.Vector3());
  const com = new THREE.Vector3();

  if (Math.abs(volume) > 1e-6) {
    com.copy(centroid).divideScalar(volume);
    // центр масс обязан лежать внутри габаритов — иначе оболочка вывернута
    if (!box.containsPoint(com)) box.getCenter(com);
  } else {
    box.getCenter(com);
  }

  return {
    com,
    volume: Math.abs(volume) || size.x * size.y * size.z,
    boxMin: box.min.clone().sub(com), // габариты относительно центра масс
    boxMax: box.max.clone().sub(com),
    size,
  };
}

const _cross = new THREE.Vector3();

/** Выпуклая оболочка набора точек, обход против часовой стрелки (алгоритм Эндрю). */
function convexHull(points) {
  if (points.length < 3) return [];
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const lower = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function polygonArea(polygon) {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [ax, az] = polygon[i];
    const [bx, bz] = polygon[(i + 1) % polygon.length];
    sum += ax * bz - bx * az;
  }
  return Math.abs(sum) / 2;
}

