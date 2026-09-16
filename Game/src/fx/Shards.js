import * as THREE from 'three';
import { CONFIG } from '../config.js';

const CFG = CONFIG.shards;

const _spin = new THREE.Vector3();
const _color = new THREE.Color();
const _sample = new THREE.Color();

/**
 * Осколки: взорванная вещь разлетается кусками своего цвета.
 *
 * Куски не вырезаны из самой модели, а сделаны треугольниками — по одному
 * полигону на осколок. В полёте от бочки видно пятно цвета, кувыркающееся в
 * воздухе полсекунды, и разбирать ради этого геометрию модели было бы работой
 * впустую: на глаз разницы нет, а стоит она разрезания меша в момент взрыва,
 * когда кадру и без того тяжело.
 *
 * Цвет берётся у самой вещи, поэтому бочка рассыпается ржавым, а канистра —
 * своим. Новый взрывчатый предмет получит осколки сам, без единой настройки.
 *
 * Живут они как гильзы: вылетают, кувыркаются, падают на землю, лежат и
 * пропадают. Набор готовится заранее и возвращается в оборот — взрыв случается
 * в самый горячий момент боя, и создавать под него десяток мешей нельзя.
 */
export class Shards {
  constructor(scene) {
    this.scene = scene;
    this.pieces = [];

    // Треугольник, лежащий в плоскости XY вокруг своего центра. Плоский кусок
    // виден с обеих сторон: он кувыркается, и ребром к камере поворачивается
    // постоянно.
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      0, 0.6, 0,
      -0.55, -0.4, 0,
      0.5, -0.45, 0,
    ]), 3));
    geometry.computeVertexNormals();

    this.geometry = geometry;

    for (let i = 0; i < CFG.pool; i++) {
      // Свой материал на каждый осколок: цвет у них разный, а красить общий
      // значило бы перекрасить разом все, что сейчас в воздухе.
      const material = new THREE.MeshStandardMaterial({
        roughness: 0.8,
        metalness: 0.1,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      scene.add(mesh);

      this.pieces.push({
        mesh,
        life: 0,
        velocity: new THREE.Vector3(),
        spin: new THREE.Vector3(),
        floor: 0,
      });
    }
  }

  /**
   * Разнести вещь на куски.
   *
   * @param {THREE.Vector3} at — где рвануло
   * @param {THREE.Object3D} [object] — что именно: у него берётся цвет
   */
  burst(at, object = null) {
    const paint = colorOf(object) ?? _color.set(CFG.fallbackColor);
    const count = CFG.minParts + Math.floor(Math.random() * (CFG.maxParts - CFG.minParts + 1));

    for (let i = 0; i < count; i++) {
      // Разлёт веером по кругу, а не куда попало: куски одной вещи расходятся
      // в разные стороны, и кучи из них не получается.
      const turn = ((i + Math.random() * 0.6) / count) * Math.PI * 2;
      this._throw(at, paint, turn);
    }
  }

  _throw(at, paint, turn) {
    const piece = this._take();
    const { mesh } = piece;

    // Цвет чуть гуляет от куска к куску: одинаково выкрашенные читаются как
    // одна плоская заплатка, а не как обломки.
    const shade = 1 - Math.random() * CFG.shadeSpread;
    mesh.material.color.copy(paint).multiplyScalar(shade);

    const size = CFG.minSize + Math.random() * (CFG.maxSize - CFG.minSize);
    mesh.scale.setScalar(size);

    mesh.position.copy(at);
    mesh.rotation.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
    mesh.visible = true;

    const out = CFG.minSpeed + Math.random() * (CFG.maxSpeed - CFG.minSpeed);
    piece.velocity.set(
      Math.sin(turn) * out,
      CFG.up * (0.6 + Math.random() * 0.8),
      Math.cos(turn) * out
    );

    piece.spin.set(
      (Math.random() - 0.5) * CFG.spin,
      (Math.random() - 0.5) * CFG.spin,
      (Math.random() - 0.5) * CFG.spin
    );

    // Земля под осколком — там же, где рвануло: бочку подрывают в воздухе, и
    // падать кускам до самого низа.
    piece.floor = CFG.floor;
    piece.life = CFG.life * (0.7 + Math.random() * 0.6);
    piece.fullLife = piece.life;
  }

  /** Свободный кусок; если все в воздухе, забираем самый старый. */
  _take() {
    let oldest = this.pieces[0];
    for (const piece of this.pieces) {
      if (piece.life <= 0) return piece;
      if (piece.life < oldest.life) oldest = piece;
    }
    return oldest;
  }

  update(dt) {
    for (const piece of this.pieces) {
      if (piece.life <= 0) continue;

      piece.life -= dt;
      piece.velocity.y -= CFG.gravity * dt;
      piece.mesh.position.addScaledVector(piece.velocity, dt);

      // упал — подпрыгнул, растерял ход и затих
      if (piece.mesh.position.y <= piece.floor) {
        piece.mesh.position.y = piece.floor;
        piece.velocity.y = Math.abs(piece.velocity.y) * CFG.bounce;
        piece.velocity.x *= CFG.friction;
        piece.velocity.z *= CFG.friction;
        piece.spin.multiplyScalar(CFG.friction);
      }

      piece.mesh.rotation.x += piece.spin.x * dt;
      piece.mesh.rotation.y += piece.spin.y * dt;
      piece.mesh.rotation.z += piece.spin.z * dt;

      // Последнюю четверть жизни кусок ужимается и пропадает: исчезнуть в
      // полном размере значит мигнуть, а этого глаз не прощает.
      const left = piece.life / piece.fullLife;
      if (left < CFG.shrinkFrom) {
        piece.mesh.scale.multiplyScalar(Math.max(0.001, 1 - dt / (CFG.shrinkFrom * piece.fullLife)));
      }

      if (piece.life <= 0) piece.mesh.visible = false;
    }
  }

  /** Отпустить своё: геометрия одна на всех, материалы у каждого свои. */
  dispose() {
    for (const piece of this.pieces) {
      piece.mesh.removeFromParent();
      piece.mesh.material.dispose();
    }
    this.pieces.length = 0;
    this.geometry.dispose();
  }
}

/**
 * Какого цвета вещь.
 *
 * Спрашивать материал напрямую можно не всегда: после сведения материалов цвет
 * переезжает в вершины, а сам материал остаётся белым — по нему все обломки
 * вышли бы одинаково белёсыми. Поэтому сперва смотрим вершины и только потом
 * материал.
 */
function colorOf(object) {
  if (!object) return null;

  let found = null;

  object.traverse((mesh) => {
    if (found || !mesh.isMesh || !mesh.material) return;

    const colors = mesh.geometry?.getAttribute('color');
    if (mesh.material.vertexColors && colors && colors.count > 0) {
      // Берём несколько вершин вразнобой и усредняем: у бочки обруч одного
      // цвета, а бок другого, и по одной первой вершине можно попасть в кайму.
      _color.setRGB(0, 0, 0);
      const steps = Math.min(8, colors.count);

      for (let i = 0; i < steps; i++) {
        const at = Math.floor((i / steps) * colors.count);
        _sample.setRGB(colors.getX(at), colors.getY(at), colors.getZ(at));
        _color.add(_sample);
      }

      found = _color.multiplyScalar(1 / steps);
      return;
    }

    if (mesh.material.color) found = _color.copy(mesh.material.color);
  });

  return found;
}
