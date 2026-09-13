import * as THREE from 'three';
import { CONFIG } from '../config.js';

const CFG = CONFIG.dust;

/**
 * Позёмка: пыль, которую ветер тянет по земле.
 *
 * Это не частицы, а пара горизонтальных полотен над полом, на которых шейдер
 * рисует шум. Полотно прозрачно почти везде и проступает лишь там, где шум
 * поднялся выше порога, — получаются рваные языки пыли, которые ползут, тают и
 * появляются снова.
 *
 * Частицами того же добиться трудно: чтобы позёмка выглядела сплошной, их нужны
 * тысячи, каждую надо двигать на процессоре, и всё равно видно отдельные точки.
 * Здесь же вся картина — два полигона и несколько строк в шейдере, а плотность
 * и рисунок задаются числами.
 *
 * Завихрения делаются искажением координат: прежде чем взять шум, точка сама
 * смещается по другому шуму. Приём называется domain warping и стоит одного
 * лишнего обращения к шуму, а даёт закрученные струи вместо ровных полос.
 */
export class Dust {
  constructor(scene) {
    this.layers = [];

    for (let i = 0; i < CFG.layers; i++) {
      const share = CFG.layers > 1 ? i / (CFG.layers - 1) : 0;

      const material = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
          time: { value: Math.random() * 100 }, // слои не должны совпадать рисунком
          color: { value: new THREE.Color(CFG.color) },
          opacity: { value: CFG.opacity * (1 - share * 0.35) }, // верхний слой тоньше
          scale: { value: CFG.scale * (1 + share * 0.6) },
          wind: { value: new THREE.Vector2() },
          swirl: { value: CFG.swirl },
          coverage: { value: CFG.coverage - share * 0.08 },
          softness: { value: CFG.softness },
          fade: { value: CFG.fade },
          center: { value: new THREE.Vector2() },
        },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
      });

      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(CFG.area, CFG.area), material);
      mesh.rotation.x = -Math.PI / 2;
      // Над дорогой, а не вровень с ней: полотно и его выбоины поднимаются над
      // землёй на десяток сантиметров, и полотнище пыли, задев их, рисовало бы
      // по асфальту ползущую границу — со стороны это читается как дрожь.
      mesh.position.y = CFG.height * (0.5 + share);
      mesh.renderOrder = 2;
      mesh.frustumCulled = false;
      mesh.name = `dust:${i}`;
      scene.add(mesh);

      this.layers.push({ mesh, material, speed: 1 - share * 0.3 });
    }

    this.time = 0;
  }

  /** @param {THREE.Vector3} around — вокруг кого держится пыль */
  update(dt, around) {
    this.time += dt;

    // ветер дует в одну сторону, но порывами: и направление, и сила гуляют
    const angle = CFG.direction * (Math.PI / 180)
      + Math.sin(this.time * CFG.swingSpeed) * CFG.swing;
    const gust = CFG.wind * (1 + Math.sin(this.time * CFG.gustSpeed) * CFG.gust);

    for (const layer of this.layers) {
      const { uniforms } = layer.material;

      uniforms.time.value += dt * layer.speed;
      uniforms.wind.value.set(Math.sin(angle) * gust, Math.cos(angle) * gust);
      uniforms.center.value.set(around.x, around.z);

      // полотно ездит за персонажем, а рисунок остаётся привязанным к миру
      layer.mesh.position.x = around.x;
      layer.mesh.position.z = around.z;
    }
  }
}

const VERTEX = /* glsl */`
  varying vec2 vWorld;

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT = /* glsl */`
  uniform float time;
  uniform vec3 color;
  uniform float opacity;
  uniform float scale;
  uniform vec2 wind;
  uniform float swirl;
  uniform float coverage;
  uniform float softness;
  uniform float fade;
  uniform vec2 center;

  varying vec2 vWorld;

  // Обычный шум на решётке: значение в узлах берётся из хеша, между узлами —
  // сглаженная интерполяция. Текстуры для этого не нужны.
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 cell = floor(p);
    vec2 part = fract(p);
    vec2 smoothed = part * part * (3.0 - 2.0 * part);

    return mix(
      mix(hash(cell), hash(cell + vec2(1.0, 0.0)), smoothed.x),
      mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0, 1.0)), smoothed.x),
      smoothed.y
    );
  }

  // Несколько слоёв шума разной частоты: крупные пятна задают общий рисунок,
  // мелкие рвут их края. Без этого пыль выглядит мягкими кляксами.
  float layered(vec2 p) {
    return noise(p) * 0.55 + noise(p * 2.3) * 0.28 + noise(p * 4.7) * 0.17;
  }

  void main() {
    vec2 p = vWorld * scale - wind * time * scale;

    // Завихрение: перед тем как взять шум, смещаем саму точку по другому шуму.
    // Оттого струи закручиваются, а не ползут параллельными полосами.
    vec2 warp = vec2(
      layered(p * 0.5 + vec2(0.0, time * 0.05)),
      layered(p * 0.5 + vec2(time * 0.04, 0.0))
    ) - 0.5;

    float density = layered(p + warp * swirl);

    // всё, что ниже порога, остаётся пустым — отсюда рваные языки, а не пелена
    float alpha = smoothstep(coverage, coverage + softness, density);

    // к краям полотна пыль сходит на нет, иначе виден его прямоугольник
    float away = length(vWorld - center);
    alpha *= 1.0 - smoothstep(fade * 0.65, fade, away);

    if (alpha <= 0.001) discard;
    gl_FragColor = vec4(color, alpha * opacity);
  }
`;
