import * as THREE from 'three';
import { loadGLTF } from '../core/AssetLoader.js';

/**
 * Библиотека пропов из Env.blend: один GLB со всеми объектами, из которого
 * локации берут копии по имени. Геометрия и материалы общие — клонируются только ноды.
 */
export class PropLibrary {
  constructor(gltf) {
    tuneMaterialSides(gltf.scene);

    this.templates = new Map();
    this.sizes = new Map();
    this.shapes = new Map();

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


// Доля непарных рёбер, при которой объём ещё считается герметичным: у сгенерированных
// моделей попадаются мелкие дырки в местах стыков, и из-за них терять culling жалко.
const OPEN_EDGE_TOLERANCE = 0.05;

/**
 * Blender отдаёт все материалы двусторонними (backface culling там выключен по умолчанию).
 * Для замкнутых объёмов это вредно: изнанка граней рисуется зря, а стенки, которыми детали
 * примыкают друг к другу, начинают спорить за глубину — поверхность мерцает при движении камеры.
 * Таким пропам выдаём односторонний вариант материала; плоским вещам вроде листвы, травы
 * и сетки забора двусторонность нужна, их не трогаем.
 *
 * Материалы в GLB общие между пропами, поэтому правим не оригинал, а его копию —
 * иначе односторонним стал бы и куст, делящий материал с машиной.
 */
function tuneMaterialSides(root) {
  const frontVariants = new Map();
  let closed = 0;

  for (const prop of root.children) {
    if (!isClosedVolume(prop)) continue;
    closed++;
    prop.traverse((o) => {
      if (!o.isMesh) return;
      o.material = Array.isArray(o.material)
        ? o.material.map((m) => frontVariant(m, frontVariants))
        : frontVariant(o.material, frontVariants);
    });
  }
  return { closed, total: root.children.length };
}

function frontVariant(material, cache) {
  let variant = cache.get(material);
  if (!variant) {
    variant = material.clone();
    variant.side = THREE.FrontSide;
    cache.set(material, variant);
  }
  return variant;
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

/** Герметичен ли объём: у замкнутой оболочки каждое ребро принадлежит ровно двум граням. */
function isClosedVolume(prop) {
  const edges = new Map();
  const v = new THREE.Vector3();

  prop.updateMatrixWorld(true);
  prop.traverse((mesh) => {
    if (!mesh.isMesh) return;

    const position = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.getIndex();
    const count = index ? index.count : position.count;
    const corner = (i) => {
      const at = index ? index.getX(i) : i;
      v.fromBufferAttribute(position, at).applyMatrix4(mesh.matrixWorld);
      // квантуем до десятых долей миллиметра: швы между примитивами должны сойтись
      return `${Math.round(v.x * 1e4)},${Math.round(v.y * 1e4)},${Math.round(v.z * 1e4)}`;
    };

    for (let i = 0; i < count; i += 3) {
      const c = [corner(i), corner(i + 1), corner(i + 2)];
      for (let e = 0; e < 3; e++) {
        const a = c[e];
        const b = c[(e + 1) % 3];
        const edge = a < b ? `${a}|${b}` : `${b}|${a}`;
        edges.set(edge, (edges.get(edge) ?? 0) + 1);
      }
    }
  });

  if (edges.size === 0) return false;
  let open = 0;
  for (const times of edges.values()) if (times !== 2) open++;
  return open / edges.size <= OPEN_EDGE_TOLERANCE;
}
