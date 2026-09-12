import * as THREE from 'three';
import { CONFIG } from '../config.js';

const CFG = CONFIG.zombies;
const VIEW = CONFIG.vision;

// На сколько лучей делится сектор. Больше — ровнее край, но и лучей больше.
const SEGMENTS = 28;
// Фигура на зомби одна — сектор взгляда.
const SLOTS = 1;
const VERTS_PER_SLOT = SEGMENTS * 3;

const _color = new THREE.Color();

/**
 * Поле зрения зомби, нарисованное на земле.
 *
 * Каждый сектор строится веером лучей, и каждый луч обрезается там, где упирается
 * в преграду. Поэтому пятно обзора само обтекает машины и дома: стоя за грузовиком,
 * видно, что зомби тебя не достаёт взглядом, — и видно ровно ту границу, за
 * которой он тебя заметит.
 *
 * Все сектора лежат в одной пачке вершин и рисуются за один вызов, сколько бы
 * зомби на локации ни было.
 */
export class VisionCones {
  constructor(scene, capacity = 64) {
    this.capacity = capacity;
    this.visible = false;
    this.sinceUpdate = 0;

    const total = capacity * SLOTS * VERTS_PER_SLOT;
    this.positions = new Float32Array(total * 3);
    this.colors = new Float32Array(total * 3);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    geometry.setDrawRange(0, 0);

    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: VIEW.opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  setVisible(visible) {
    this.visible = visible;
    this.mesh.visible = visible;
    this.sinceUpdate = VIEW.interval; // включили — перерисовать сразу
  }

  /**
   * @param {number} dt
   * @param {import('../world/Location.js').Location} location — её `sight` и режет лучи
   * @param {{position: THREE.Vector3}} player — дальние сектора считать незачем
   */
  update(dt, location, player) {
    if (!this.visible) return;

    this.sinceUpdate += dt;
    if (this.sinceUpdate < VIEW.interval) return;
    this.sinceUpdate = 0;

    let vertex = 0;

    for (const zombie of location.zombies) {
      if (!zombie.alive) continue;
      if (vertex / (SLOTS * VERTS_PER_SLOT) >= this.capacity) break;

      const at = zombie.position;
      // за спиной у камеры сектора всё равно не видно — и считать его незачем
      if (Math.hypot(at.x - player.position.x, at.z - player.position.z) > VIEW.drawRange) continue;

      const chasing = zombie.chasing;
      _color.set(chasing ? VIEW.chaseColor : VIEW.senseColor);

      // Взял след — сектор краснеет и достаёт до предела интереса.
      vertex = this._fan(
        vertex, at, location.sight,
        zombie.yaw,
        (CFG.senseAngle * Math.PI) / 360,
        chasing ? CFG.loseRadius : CFG.senseRadius,
        _color
      );
    }

    // хвост буфера просто не рисуется — обнулять его незачем
    this.mesh.geometry.setDrawRange(0, vertex);
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.color.needsUpdate = true;
  }

  /**
   * Один веер: от `yaw - half` до `yaw + half`, каждый луч обрезан преградой.
   * @returns {number} номер вершины, на которой веер кончился
   */
  _fan(vertex, at, sight, yaw, half, radius, color) {
    const reach = [];

    for (let i = 0; i <= SEGMENTS; i++) {
      const angle = yaw - half + (2 * half * i) / SEGMENTS;
      const dx = Math.sin(angle);
      const dz = Math.cos(angle);
      reach.push(sight.castRay(at.x, at.z, dx, dz, radius));
    }

    for (let i = 0; i < SEGMENTS; i++) {
      const a0 = yaw - half + (2 * half * i) / SEGMENTS;
      const a1 = yaw - half + (2 * half * (i + 1)) / SEGMENTS;

      this._vertex(vertex++, at.x, at.z, color);
      this._vertex(vertex++, at.x + Math.sin(a0) * reach[i], at.z + Math.cos(a0) * reach[i], color);
      this._vertex(vertex++, at.x + Math.sin(a1) * reach[i + 1], at.z + Math.cos(a1) * reach[i + 1], color);
    }
    return vertex;
  }

  _vertex(index, x, z, color) {
    const i = index * 3;
    this.positions[i] = x;
    this.positions[i + 1] = VIEW.height;
    this.positions[i + 2] = z;
    this.colors[i] = color.r;
    this.colors[i + 1] = color.g;
    this.colors[i + 2] = color.b;
  }
}
