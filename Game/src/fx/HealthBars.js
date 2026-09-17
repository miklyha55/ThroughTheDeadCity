import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { flatDistance } from '../core/ground.js';

const CFG = CONFIG.healthBar;

// Полоска — два прямоугольника, подложка и заливка, по два треугольника в каждом.
const VERTS_PER_BAR = 12;

const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _center = new THREE.Vector3();
const _color = new THREE.Color();

/**
 * Полоски здоровья над зомби.
 *
 * Висит только над раненым: пока зомби цел, полоски нет вовсе — иначе толпа
 * превращается в частокол шкал. Все полоски лежат в одной пачке вершин и
 * рисуются за один вызов, сколько бы зомби ни было ранено.
 *
 * Развёрнуты они по камере, а не по миру: строятся прямо в мировых координатах
 * на её осях, поэтому всегда смотрят в экран и не требуют ни спрайтов, ни
 * отдельных объектов на каждого зомби.
 */
export class HealthBars {
  constructor(scene, capacity = 64) {
    this.capacity = capacity;

    const total = capacity * VERTS_PER_BAR;
    this.positions = new Float32Array(total * 3);
    this.colors = new Float32Array(total * 3);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    geometry.setDrawRange(0, 0);

    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: CFG.opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'healthBars';
    this.mesh.frustumCulled = false; // вершины и так живут только у видимых зомби
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 4;
    scene.add(this.mesh);
  }

  /**
   * @param {THREE.Camera} camera — по её осям полоски и разворачиваются
   * @param {import('../world/Location.js').Location} location
   * @param {{position: THREE.Vector3}} player — дальних зомби пропускаем
   */
  update(camera, location, player) {
    // оси экрана в мировых координатах: первые два столбца матрицы камеры
    _right.setFromMatrixColumn(camera.matrixWorld, 0);
    _up.setFromMatrixColumn(camera.matrixWorld, 1);

    let vertex = 0;

    for (const zombie of location.zombies) {
      if (vertex / VERTS_PER_BAR >= this.capacity) break;

      // Целым и мёртвым полоска не нужна. Полный запас у каждого свой: живучесть
      // зависит от вида, и общий потолок показывал бы слабого вечно раненым,
      // ещё до первой пули.
      if (!zombie.alive) continue;
      if (zombie.health >= zombie.maxHealth && !zombie.alwaysBar) continue;

      const at = zombie.position;
      if (flatDistance(at, player.position) > CFG.drawRange) continue;

      const share = Math.max(0, Math.min(1, zombie.health / zombie.maxHealth));
      // Над вожаком полоска выше — он втрое крупнее — и длиннее: жизней много.
      const size = zombie.sizeScale ?? 1;
      const width = size > 1 ? CONFIG.boss.barWidth : CFG.width;
      _center.set(at.x, at.y + CFG.offset * size, at.z);

      _color.set(CFG.backColor);
      vertex = this._quad(vertex, _center, -0.5, 0.5, _color, width);

      _color.set(CFG.fillColor);
      vertex = this._quad(vertex, _center, -0.5, -0.5 + share, _color, width);
    }

    this.mesh.geometry.setDrawRange(0, vertex);
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.color.needsUpdate = true;
  }

  /**
   * Прямоугольник от `left` до `right` в долях ширины полоски, где 0 — середина.
   * @returns {number} номер вершины, на которой прямоугольник кончился
   */
  _quad(vertex, center, left, right, color, width = CFG.width) {
    const halfHeight = CFG.height / 2;
    const x0 = left * width;
    const x1 = right * width;

    // углы: левый низ, правый низ, правый верх, левый верх
    const corner = (alongX, alongY) => {
      const i = vertex * 3;
      this.positions[i] = center.x + _right.x * alongX + _up.x * alongY;
      this.positions[i + 1] = center.y + _right.y * alongX + _up.y * alongY;
      this.positions[i + 2] = center.z + _right.z * alongX + _up.z * alongY;
      this.colors[i] = color.r;
      this.colors[i + 1] = color.g;
      this.colors[i + 2] = color.b;
      vertex++;
    };

    corner(x0, -halfHeight);
    corner(x1, -halfHeight);
    corner(x1, halfHeight);

    corner(x0, -halfHeight);
    corner(x1, halfHeight);
    corner(x0, halfHeight);

    return vertex;
  }
}
