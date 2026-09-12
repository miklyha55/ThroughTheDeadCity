import * as THREE from 'three';

/**
 * Ищет наложения: грани, лежащие в одной плоскости, смотрящие в одну сторону
 * и перекрывающиеся по площади. Такие пары дают z-fighting — поверхность мерцает
 * при движении камеры, потому что глубина у них одинаковая.
 *
 * Треугольники, у которых есть общие вершины, пропускаем: это половинки одного
 * четырёхугольника или соседи по оболочке, а не наложение.
 *
 * Использование из консоли:
 *   const { checkProps } = await import('/src/dev/checkCoplanar.js');
 *   checkProps(__game.props);
 */

const EPS_PLANE = 0.0002; // ближе этого по глубине — считаем одной плоскостью
const EPS_OVERLAP = 0.01; // минимальное перекрытие, чтобы наложение было заметно

function collectFaces(prop) {
  const faces = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const key = (v) => `${Math.round(v.x * 1e4)},${Math.round(v.y * 1e4)},${Math.round(v.z * 1e4)}`;

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
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      n.crossVectors(ab, ac);
      if (n.lengthSq() === 0) continue;
      n.normalize();

      const axis = ['x', 'y', 'z'].reduce((p, k) => (Math.abs(n[k]) > Math.abs(n[p]) ? k : p), 'x');
      if (Math.abs(n[axis]) < 0.99) continue; // косые грани в одну плоскость не складываются

      const [u, w] = ['x', 'y', 'z'].filter((k) => k !== axis);
      faces.push({
        axis,
        dir: Math.sign(n[axis]),
        offset: (a[axis] + b[axis] + c[axis]) / 3,
        material: mesh.material.name,
        corners: new Set([key(a), key(b), key(c)]),
        box: [
          Math.min(a[u], b[u], c[u]), Math.min(a[w], b[w], c[w]),
          Math.max(a[u], b[u], c[u]), Math.max(a[w], b[w], c[w]),
        ],
      });
    }
  });
  return faces;
}

export function checkProp(prop) {
  const faces = collectFaces(prop);
  const hits = new Set();

  for (let i = 0; i < faces.length; i++) {
    for (let j = i + 1; j < faces.length; j++) {
      const A = faces[i];
      const B = faces[j];
      if (A.axis !== B.axis || A.dir !== B.dir) continue;
      if (Math.abs(A.offset - B.offset) > EPS_PLANE) continue;

      let shared = false;
      for (const corner of A.corners) if (B.corners.has(corner)) { shared = true; break; }
      if (shared) continue;

      const overlapU = Math.min(A.box[2], B.box[2]) - Math.max(A.box[0], B.box[0]);
      const overlapW = Math.min(A.box[3], B.box[3]) - Math.max(A.box[1], B.box[1]);
      if (overlapU > EPS_OVERLAP && overlapW > EPS_OVERLAP) hits.add(`${A.material} ↔ ${B.material}`);
    }
  }
  return [...hits];
}

export function checkProps(library) {
  const report = {};
  for (const [name, prop] of library.templates) {
    const hits = checkProp(prop);
    if (hits.length) report[name] = hits;
  }
  const count = Object.keys(report).length;
  console.log(count ? `наложения в ${count} пропах` : 'наложений не найдено');
  return report;
}
