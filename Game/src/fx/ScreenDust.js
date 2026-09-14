import { CONFIG } from '../config.js';
import { NOISE_GLSL } from './noise.js';
import { ScreenShader } from './ScreenShader.js';

const CFG = CONFIG.ending.dust;

const FRAGMENT = /* glsl */`
  precision mediump float;

  uniform float time;
  uniform vec2 aspect;
  uniform vec3 color;
  uniform float opacity;
  uniform float scale;
  uniform vec2 wind;
  uniform float swirl;
  uniform float coverage;
  uniform float softness;

  varying vec2 vUv;

${NOISE_GLSL}

  void main() {
    // aspect — чтобы песок не растягивался вместе с окном
    vec2 p = vUv * aspect * scale - wind * time;

    // Завихрение: перед тем как взять шум, смещаем саму точку по другому шуму.
    // Оттого струи закручиваются, а не ползут параллельными полосами.
    vec2 warp = vec2(
      layered(p * 0.5 + vec2(0.0, time * 0.025)),
      layered(p * 0.5 + vec2(time * 0.02, 0.0))
    ) - 0.5;

    float density = layered(p + warp * swirl);

    // всё, что ниже порога, остаётся пустым — отсюда рваные языки, а не пелена
    float alpha = smoothstep(coverage, coverage + softness, density);

    // Понизу гуще: песок стелется по земле, а не висит в небе.
    alpha *= mix(1.0, 0.25, smoothstep(0.25, 0.95, vUv.y));

    if (alpha <= 0.001) discard;
    gl_FragColor = vec4(color, alpha * opacity);
  }
`;

/**
 * Песок, летящий поверх финальной картинки.
 *
 * Та же позёмка, что на локации, только не над полом, а по экрану: шум с
 * завихрениями, из которого проступают рваные языки. Частицами того же добиться
 * трудно — чтобы вышло сплошным, их нужны тысячи, и всё равно видны отдельные
 * точки; здесь вся картина это один треугольник и десяток строк в шейдере.
 */
export class ScreenDust extends ScreenShader {
  constructor(container) {
    super(container, 'ending__dust', FRAGMENT,
      ['color', 'opacity', 'scale', 'wind', 'swirl', 'coverage', 'softness']);
    if (!this.ready) return;

    const [r, g, b] = [16, 8, 0].map((shift) => ((CFG.color >> shift) & 255) / 255);
    this.set('color', r, g, b);
    this.set('opacity', CFG.opacity);
    this.set('scale', CFG.scale);
    this.set('swirl', CFG.swirl);
    this.set('coverage', CFG.coverage);
    this.set('softness', CFG.softness);

    const angle = CFG.direction * (Math.PI / 180);
    this.set('wind', Math.cos(angle) * CFG.speed, Math.sin(angle) * CFG.speed);
  }
}
