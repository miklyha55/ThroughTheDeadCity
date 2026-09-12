import * as THREE from 'three';
import { CONFIG } from '../config.js';

const CFG = CONFIG.borderFog;

/**
 * Мгла за границами площадки.
 *
 * Рамка вокруг локации, лежащая на земле: у самого забора она прозрачна, к
 * внешнему краю глухая. Земля за забором уходит в тот же цвет, что и туман, и
 * мир как будто кончается там, где кончается уровень, — ни пустой равнины до
 * горизонта, ни видимой границы карты.
 *
 * Цвет берётся у тумана сцены, поэтому рамка и воздух над ней всегда сходятся.
 *
 * @param {number} width @param {number} depth — размеры площадки в метрах
 */
export function createBorderFog(width, depth) {
  const halfW = width / 2 - CFG.overlap;
  const halfD = depth / 2 - CFG.overlap;
  const outW = width / 2 + CFG.width;
  const outD = depth / 2 + CFG.width;

  // по углам внутренний и внешний контуры соединяются напрямую — рамка из
  // четырёх четырёхугольников, по одному на сторону
  const inner = [[-halfW, -halfD], [halfW, -halfD], [halfW, halfD], [-halfW, halfD]];
  const outer = [[-outW, -outD], [outW, -outD], [outW, outD], [-outW, outD]];

  const positions = [];
  const colors = [];
  const color = new THREE.Color(CONFIG.world.skyColor);

  const push = (point, alpha) => {
    positions.push(point[0], CFG.height, point[1]);
    colors.push(color.r, color.g, color.b, alpha);
  };

  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;

    push(inner[i], CFG.near);
    push(inner[j], CFG.near);
    push(outer[j], CFG.far);

    push(inner[i], CFG.near);
    push(outer[j], CFG.far);
    push(outer[i], CFG.far);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));

  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false, // она сама и есть туман, затягивать её ещё раз незачем
  }));

  mesh.name = 'borderFog';
  mesh.renderOrder = 0;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}
