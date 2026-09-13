import * as THREE from 'three';
import { CONFIG } from '../config.js';

const CFG = CONFIG.gunEffects;

const _side = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _toss = new THREE.Vector3();

/**
 * Что видно в момент выстрела: росчерк от дула до цели, вспышка у ствола,
 * короткая подсветка вокруг него и вылетающая вбок гильза.
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

    // гильзы: мелкие латунные цилиндрики, летят вбок и кувыркаются
    const shellGeometry = new THREE.CylinderGeometry(1, 1, 1, 6);
    const shellMaterial = new THREE.MeshStandardMaterial({
      color: CFG.shellColor,
      roughness: 0.35,
      metalness: 0.8,
    });

    this.shells = [];
    for (let i = 0; i < CFG.shellPool; i++) {
      const mesh = new THREE.Mesh(shellGeometry, shellMaterial);
      mesh.scale.set(CFG.shellSize, CFG.shellLength, CFG.shellSize);
      mesh.visible = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      scene.add(mesh);

      this.shells.push({
        mesh,
        life: 0,
        velocity: new THREE.Vector3(),
        spin: new THREE.Vector3(),
      });
    }

    // Подсветка дула. Одна на все выстрелы: между ними пауза в полсекунды, а
    // лишний источник света в сцене стоит куда дороже, чем даёт.
    this.light = new THREE.PointLight(CFG.lightColor, 0, CFG.lightRange, 1.4);
    this.light.castShadow = false;
    scene.add(this.light);
    this.lightLife = 0;

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

    this.light.position.copy(from);
    this.light.intensity = CFG.lightPower;
    this.lightLife = CFG.lightLife;

    this._ejectShell(from, to);
  }

  /**
   * Гильза вылетает вбок от линии огня и чуть вверх — как из настоящего затвора.
   * Сторона берётся поперёк выстрела, поэтому гильзы всегда летят «от ствола»,
   * куда бы персонаж ни целился.
   */
  _ejectShell(from, to) {
    const shell = this._take(this.shells);

    _side.subVectors(to, from).setY(0).normalize().cross(_up); // поперёк выстрела
    if (_side.lengthSq() < 1e-6) _side.set(1, 0, 0);

    shell.mesh.position.copy(from);
    shell.mesh.visible = true;

    const spread = () => (Math.random() - 0.5) * CFG.shellSpread;
    shell.velocity
      .copy(_side).multiplyScalar(CFG.shellSide)
      .addScaledVector(_up, CFG.shellUp)
      .add(_toss.set(spread(), spread() * 0.5, spread()));

    shell.spin.set(
      (Math.random() - 0.5) * CFG.shellSpin,
      (Math.random() - 0.5) * CFG.shellSpin,
      (Math.random() - 0.5) * CFG.shellSpin
    );
    shell.life = CFG.shellLife;
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

    if (this.lightLife > 0) {
      this.lightLife -= dt;
      this.light.intensity = CFG.lightPower * Math.max(0, this.lightLife / CFG.lightLife);
    }

    for (const shell of this.shells) {
      if (shell.life <= 0) continue;

      shell.life -= dt;
      shell.velocity.y -= CFG.shellGravity * dt;
      shell.mesh.position.addScaledVector(shell.velocity, dt);

      // упала — подпрыгнула и затихла
      if (shell.mesh.position.y <= CFG.shellFloor) {
        shell.mesh.position.y = CFG.shellFloor;
        shell.velocity.y = Math.abs(shell.velocity.y) * CFG.shellBounce;
        shell.velocity.x *= 0.6;
        shell.velocity.z *= 0.6;
        shell.spin.multiplyScalar(0.5);
      }

      shell.mesh.rotation.x += shell.spin.x * dt;
      shell.mesh.rotation.y += shell.spin.y * dt;
      shell.mesh.rotation.z += shell.spin.z * dt;

      if (shell.life <= 0) shell.mesh.visible = false;
    }
  }
}
