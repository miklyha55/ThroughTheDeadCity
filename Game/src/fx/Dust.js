import * as THREE from 'three';
import { CONFIG } from '../config.js';

const CFG = CONFIG.dust;
const _size = new THREE.Vector2();

/**
 * Взвесь в воздухе: пыль, висящая по всему кадру.
 *
 * Не слой поверх картинки, а часть самого мира. Разница видна сразу, как только
 * тронешься с места: нарисованная поверх экрана пыль едет вместе с ним и выдаёт
 * себя наклейкой на стекле, а эта остаётся на месте — камера идёт сквозь неё,
 * и пылинки уплывают назад ровно так же, как земля под ногами.
 *
 * Но и кадр она обязана заполнять всегда, куда бы игрок ни ушёл. Поэтому облако
 * не бесконечное, а кочующее: пылинки живут в ящике вокруг того места, куда
 * смотрит камера, и, выходя за грань, переносятся к противоположной. Ящик едет
 * за взглядом, пылинки в нём стоят — со стороны это сплошная взвесь над всем
 * городом, а на деле их несколько сотен.
 *
 * Ящик держится ВЗГЛЯДА камеры, а не её самой. У игры проекция ортографическая,
 * и камера отнесена от сцены на добрых сорок пять метров: облако вокруг неё
 * висело бы далеко за спиной у игрока и в кадр не попадало вовсе.
 *
 * Перенос не виден, потому что у каждой грани пылинка уже погасла. Гаснет она
 * по той оси, к чьей грани подошла, — так ловятся все шесть переходов разом, и
 * верхний, где под пылинкой открытое небо, и нижний, где её и так скрыла бы
 * земля.
 *
 * Рисуется всё одной точечной пачкой за один вызов. Свой шейдер, а не готовый
 * `PointsMaterial`, ровно ради двух вещей, которых тот не умеет: своего размера
 * у каждой пылинки и своей прозрачности. Круглыми они тоже делаются в шейдере,
 * без картинки — файл ради одного размытого пятна был бы лишним запросом.
 */
export class Dust {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    const count = CFG.pool;
    const [boxX, boxY, boxZ] = CFG.box;

    this.position = new Float32Array(count * 3);
    this.size = new Float32Array(count);
    this.phase = new Float32Array(count); // у каждой своя фаза качания
    this.alpha = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      this.position[i * 3] = (Math.random() - 0.5) * boxX;
      this.position[i * 3 + 1] = (Math.random() - 0.5) * boxY;
      this.position[i * 3 + 2] = (Math.random() - 0.5) * boxZ;
      this.size[i] = CFG.minSize + Math.random() * (CFG.maxSize - CFG.minSize);
      this.phase[i] = Math.random() * Math.PI * 2;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.position, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    geometry.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        // Сколько пикселей в метре. У ортографической проекции это одно число на
        // весь кадр: размер вещи от её удаления там не зависит вовсе.
        uScale: { value: 100 },
        uColor: { value: new THREE.Color(CFG.color) },
        uOpacity: { value: CFG.opacity },
      },
      vertexShader: `
        attribute float size;
        attribute float alpha;
        varying float vAlpha;
        uniform float uScale;

        void main() {
          vAlpha = alpha;
          gl_PointSize = size * uScale;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        uniform vec3 uColor;
        uniform float uOpacity;

        void main() {
          // Круг с мягким краем: квадратная точка выдала бы себя сразу.
          float edge = length(gl_PointCoord - vec2(0.5));
          float soft = smoothstep(0.5, 0.12, edge);
          if (soft <= 0.0) discard;

          gl_FragColor = vec4(uColor, soft * vAlpha * uOpacity);

          // Свой шейдер не проходит через ту же обработку, что готовые
          // материалы, и без этих двух строк пыль вышла бы мимо тональной
          // компрессии всей сцены — светлее и холоднее, чем всё вокруг.
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,                 // взвесь ничего не заслоняет
      blending: THREE.AdditiveBlending,  // пылинки ловят свет, а не пачкают кадр
    });

    this.points = new THREE.Points(geometry, this.material);
    // Ящик кочует, и обычное отсечение по своей сфере то и дело выбрасывало бы
    // его целиком.
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    scene.add(this.points);

    this.time = 0;
    this.enabled = true;
  }

  /**
   * @param {number} dt
   * @param {THREE.OrthographicCamera} camera
   * @param {THREE.WebGLRenderer} renderer — из него берётся высота кадра
   * @param {THREE.Vector3} focus — куда смотрит камера: вокруг этого и кочуем
   */
  update(dt, camera, renderer, focus) {
    if (!this.enabled || !focus) return;

    this.time += dt;

    /**
     * Пикселей на метр.
     *
     * Считается каждый кадр: и окно, и рамка проекции меняются на ходу — от
     * поворота телефона до отладочного зума. Высота видимого куска мира — это
     * рамка камеры, делённая на её зум.
     */
    const pixels = renderer.getDrawingBufferSize(_size).y;
    const metres = (camera.top - camera.bottom) / (camera.zoom || 1);
    this.material.uniforms.uScale.value = metres > 0 ? pixels / metres : 0;

    const [boxX, boxY, boxZ] = CFG.box;
    const halfX = boxX * 0.5;
    const halfY = boxY * 0.5;
    const halfZ = boxZ * 0.5;

    // Ящик поднят над точкой взгляда: она на груди героя, а пыль нужна и над
    // головой. Нижняя грань при этом уходит под землю, и что там творится,
    // игроку не видно.
    const cx = focus.x;
    const cy = focus.y + CFG.lift;
    const cz = focus.z;

    const [driftX, driftY, driftZ] = CFG.drift;
    const edge = CFG.fade;

    for (let i = 0; i < CFG.pool; i++) {
      const at = i * 3;

      // Сквозняк несёт всех в одну сторону, качание — у каждой своё: без него
      // взвесь читается как единая плита, ползущая мимо.
      const sway = Math.sin(this.time * CFG.swaySpeed + this.phase[i]) * CFG.sway;
      this.position[at] += (driftX + sway) * dt;
      this.position[at + 1] += driftY * dt;
      this.position[at + 2] += (driftZ - sway) * dt;

      // Вышла за грань — вошла с противоположной.
      let dx = this.position[at] - cx;
      let dy = this.position[at + 1] - cy;
      let dz = this.position[at + 2] - cz;

      if (dx > halfX) dx -= boxX; else if (dx < -halfX) dx += boxX;
      if (dy > halfY) dy -= boxY; else if (dy < -halfY) dy += boxY;
      if (dz > halfZ) dz -= boxZ; else if (dz < -halfZ) dz += boxZ;

      this.position[at] = cx + dx;
      this.position[at + 1] = cy + dy;
      this.position[at + 2] = cz + dz;

      // Гаснет у той грани, к которой подошла: перенос случается именно там, и
      // видеть его нельзя. Берём самую близкую грань из трёх.
      const fx = clamp01((halfX - Math.abs(dx)) / (halfX * edge));
      const fy = clamp01((halfY - Math.abs(dy)) / (halfY * edge));
      const fz = clamp01((halfZ - Math.abs(dz)) / (halfZ * edge));
      this.alpha[i] = Math.min(fx, fy, fz);
    }

    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.alpha.needsUpdate = true;
  }

  dispose() {
    this.points.removeFromParent();
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);
