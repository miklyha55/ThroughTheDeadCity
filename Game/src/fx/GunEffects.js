import * as THREE from 'three';
import { CONFIG } from '../config.js';

const CFG = CONFIG.gunEffects;

/**
 * Красит гильзу по высоте: низ латунный, верх красный.
 *
 * Цилиндр стоит серединой в нуле, поэтому граница юбки — просто уровень по Y.
 */
function paintShell(geometry) {
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);

  const body = new THREE.Color(CFG.shellBody);
  const base = new THREE.Color(CFG.shellBase);
  const edge = -0.5 + CFG.shellBaseShare;

  for (let i = 0; i < position.count; i++) {
    const paint = position.getY(i) <= edge ? base : body;
    colors[i * 3] = paint.r;
    colors[i * 3 + 1] = paint.g;
    colors[i * 3 + 2] = paint.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

const _side = new THREE.Vector3();
const _breech = new THREE.Vector3(); // окно выброса: назад от дула, к рукам
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
  constructor(scene, camera = null) {
    this.scene = scene;
    // Искры и дым — плоские: без разворота к камере они исчезали бы, встав к ней
    // ребром.
    this.camera = camera;
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

    // Гильзы: шестигранные патроны в два цвета — красное тело и латунная юбка,
    // как на самой гильзе. Цвет запечён в вершины, поэтому обе части рисуются
    // одним материалом, а не двумя, — так же, как вся остальная геометрия игры.
    const shellGeometry = new THREE.CylinderGeometry(1, 1, 1, 6);
    paintShell(shellGeometry);

    const shellMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.45,
      metalness: 0.35,
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

    /**
     * Искры из ствола: горсть мелких огоньков, уходящих вперёд по линии огня.
     *
     * Они и делают выстрел выстрелом. Одна вспышка у дула читается как щелчок
     * лампочки: вспыхнуло и погасло на месте. Искры летят, и по ним видно
     * направление удара и его силу.
     */
    const sparkGeometry = new THREE.PlaneGeometry(1, 1);
    this.sparks = [];

    for (let i = 0; i < CFG.sparkPool; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: CFG.sparkColor,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(sparkGeometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);

      this.sparks.push({ mesh, life: 0, full: 1, size: 1, velocity: new THREE.Vector3() });
    }

    // Дымок у дула: поднимается и расплывается, когда всё остальное уже погасло.
    // Он не additive: дым не светится, он загораживает.
    this.smokes = [];

    for (let i = 0; i < CFG.smokePool; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: CFG.smokeColor,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(sparkGeometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);

      this.smokes.push({ mesh, life: 0, drift: new THREE.Vector3() });
    }

    this.sparkGeometry = sparkGeometry;

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

    this._sparkle(from, to);
    this._smoke(from);
  }

  /** Горсть искр вперёд по линии огня, с разбросом. */
  _sparkle(from, to) {
    _side.subVectors(to, from).setY(0);
    if (_side.lengthSq() < 1e-8) return;
    _side.normalize();

    const count = CFG.sparkMin + Math.floor(Math.random() * (CFG.sparkMax - CFG.sparkMin + 1));

    for (let i = 0; i < count; i++) {
      const spark = this._take(this.sparks);
      const size = CFG.sparkMinSize + Math.random() * (CFG.sparkMaxSize - CFG.sparkMinSize);

      spark.size = size;
      spark.mesh.position.copy(from);
      spark.mesh.scale.setScalar(size);
      spark.mesh.visible = true;
      spark.mesh.material.opacity = CFG.sparkOpacity;

      const spread = () => (Math.random() - 0.5) * CFG.sparkSpread;
      const speed = CFG.sparkMinSpeed + Math.random() * (CFG.sparkMaxSpeed - CFG.sparkMinSpeed);

      spark.velocity
        .copy(_side).multiplyScalar(speed)
        .add(_toss.set(spread(), spread() * 0.6 + CFG.sparkRise, spread()));

      spark.full = CFG.sparkLife * (0.6 + Math.random() * 0.8);
      spark.life = spark.full;
    }
  }

  /** Облачко дыма у самого дула. */
  _smoke(from) {
    const smoke = this._take(this.smokes);

    smoke.mesh.position.copy(from);
    smoke.mesh.scale.setScalar(CFG.smokeSize);
    smoke.mesh.visible = true;
    smoke.mesh.material.opacity = CFG.smokeOpacity;

    smoke.drift.set(
      (Math.random() - 0.5) * CFG.smokeDrift,
      CFG.smokeRise,
      (Math.random() - 0.5) * CFG.smokeDrift
    );
    smoke.life = CFG.smokeLife;
  }

  /**
   * Выбросить гильзу.
   *
   * Отдельно от `fire`, потому что росчерк уходит на каждую дробину, а гильза —
   * одна на выстрел: из ружья вылетает патрон, а не каждая дробинка по штуке.
   *
   * Вылетает она из затвора, а не из дула: отступаем назад по линии огня, к
   * рукам, и чуть выше. Считается это здесь, а не у персонажа, — где именно у
   * ружья окно выброса, знать должно оружие.
   *
   * @param {THREE.Vector3} muzzle — дуло @param {THREE.Vector3} to — куда бьёт
   */
  eject(muzzle, to) {
    _side.subVectors(to, muzzle).setY(0);
    if (_side.lengthSq() > 1e-8) _side.normalize();

    _breech.copy(muzzle)
      .addScaledVector(_side, -CFG.shellBack)
      .setY(muzzle.y + CFG.shellRise);

    this._ejectShell(_breech, to);
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

    for (const spark of this.sparks) {
      if (spark.life <= 0) continue;

      spark.life -= dt;
      spark.velocity.y -= CFG.sparkGravity * dt;
      spark.mesh.position.addScaledVector(spark.velocity, dt);

      // Искра гаснет и вытягивается по ходу: так она читается как след, а не
      // как висящая в воздухе точка.
      // Искра гаснет быстрее, чем живёт: к середине от неё остаётся четверть
      // яркости, и горсть выглядит осыпающейся, а не тающей разом.
      const t = Math.max(0, spark.life / spark.full);
      spark.mesh.material.opacity = CFG.sparkOpacity * t * t;

      const size = spark.size * (CFG.sparkShrink + (1 - CFG.sparkShrink) * t);
      spark.mesh.scale.setScalar(size);

      // Плоскость всегда лицом к камере: боком искра исчезала бы на глазах.
      if (this.camera) spark.mesh.quaternion.copy(this.camera.quaternion);

      if (spark.life <= 0) spark.mesh.visible = false;
    }

    for (const smoke of this.smokes) {
      if (smoke.life <= 0) continue;

      smoke.life -= dt;
      smoke.mesh.position.addScaledVector(smoke.drift, dt);

      const t = Math.max(0, smoke.life / CFG.smokeLife);
      smoke.mesh.material.opacity = CFG.smokeOpacity * t;
      smoke.mesh.scale.setScalar(CFG.smokeSize * (1 + (1 - t) * CFG.smokeGrowth));
      if (this.camera) smoke.mesh.quaternion.copy(this.camera.quaternion);

      if (smoke.life <= 0) smoke.mesh.visible = false;
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
