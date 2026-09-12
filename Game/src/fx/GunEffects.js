import * as THREE from 'three';
import { CONFIG } from '../config.js';

const CFG = CONFIG.gunEffects;

/**
 * Что видно в момент выстрела: росчерк от дула до цели и вспышка у ствола.
 *
 * Объекты берутся из готового набора и возвращаются обратно — в бою стреляют
 * часто, и создавать геометрию на каждый выстрел значило бы дёргать сборщик
 * мусора в самый неподходящий момент.
 */
export class GunEffects {
  constructor(scene) {
    this.scene = scene;
    this.tracers = [];
    this.flashes = [];

    // росчерк: узкий брусок, который растягивается от дула до цели
    const tracerGeometry = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < CFG.poolSize; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: CFG.tracerColor,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(tracerGeometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.tracers.push({ mesh, life: 0 });
    }

    // вспышка: шарик света у самого дула
    const flashGeometry = new THREE.SphereGeometry(1, 8, 6);
    for (let i = 0; i < CFG.poolSize; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: CFG.flashColor,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(flashGeometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.flashes.push({ mesh, life: 0 });
    }

    this._middle = new THREE.Vector3();
  }

  /** Свободный элемент набора; если все заняты, забираем самый старый. */
  _take(pool) {
    let oldest = pool[0];
    for (const item of pool) {
      if (item.life <= 0) return item;
      if (item.life < oldest.life) oldest = item;
    }
    return oldest;
  }

  /**
   * Выстрел: росчерк от дула до цели и вспышка.
   * @param {THREE.Vector3} from — дуло
   * @param {THREE.Vector3} to — куда попали
   */
  fire(from, to) {
    const length = from.distanceTo(to);
    if (length < 1e-3) return;

    const tracer = this._take(this.tracers);
    const { mesh } = tracer;

    // ставим брусок серединой между дулом и целью и вытягиваем по длине выстрела
    this._middle.addVectors(from, to).multiplyScalar(0.5);
    mesh.position.copy(this._middle);
    mesh.lookAt(to);                       // длинная сторона смотрит вдоль оси Z
    mesh.scale.set(CFG.tracerWidth, CFG.tracerWidth, length);
    mesh.visible = true;
    mesh.material.opacity = CFG.tracerOpacity;
    tracer.life = CFG.tracerLife;

    const flash = this._take(this.flashes);
    flash.mesh.position.copy(from);
    flash.mesh.scale.setScalar(CFG.flashSize);
    flash.mesh.visible = true;
    flash.mesh.material.opacity = CFG.flashOpacity;
    flash.life = CFG.flashLife;
  }

  /** Гасит то, что уже отгорело. */
  update(dt) {
    for (const tracer of this.tracers) {
      if (tracer.life <= 0) continue;

      tracer.life -= dt;
      const t = Math.max(0, tracer.life / CFG.tracerLife);
      tracer.mesh.material.opacity = CFG.tracerOpacity * t;

      // росчерк на глазах истончается, будто след рассеивается
      tracer.mesh.scale.x = CFG.tracerWidth * t;
      tracer.mesh.scale.y = CFG.tracerWidth * t;

      if (tracer.life <= 0) tracer.mesh.visible = false;
    }

    for (const flash of this.flashes) {
      if (flash.life <= 0) continue;

      flash.life -= dt;
      const t = Math.max(0, flash.life / CFG.flashLife);
      flash.mesh.material.opacity = CFG.flashOpacity * t;

      // вспышка раздувается и гаснет
      flash.mesh.scale.setScalar(CFG.flashSize * (1 + (1 - t) * CFG.flashGrowth));

      if (flash.life <= 0) flash.mesh.visible = false;
    }
  }
}
