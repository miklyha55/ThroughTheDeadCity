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
    }
  }

  static async load(url) {
    return new PropLibrary(await loadGLTF(url));
  }

  has(name) { return this.templates.has(name); }

  /** Габариты пропа в метрах — по ним раскладывается забор и проверяются отступы. */
  size(name) { return this.sizes.get(name); }

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
