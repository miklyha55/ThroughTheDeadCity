import { CONFIG } from '../config.js';
import { NOISE_GLSL } from './noise.js';

const CFG = CONFIG.ending.dust;

const VERTEX = /* glsl */`
  attribute vec2 corner;
  varying vec2 vUv;

  void main() {
    vUv = corner * 0.5 + 0.5;
    gl_Position = vec4(corner, 0.0, 1.0);
  }
`;

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

    // Понизу гуще: песок стелется по земле, а не висит в небе. Кадр снят сверху,
    // поэтому «низ» здесь — нижняя часть экрана, где и стоят люди.
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
 * точки; здесь вся картина это один прямоугольник и десяток строк в шейдере.
 *
 * Рисуется в своём маленьком холсте поверх картинки, а не в общей сцене: сцены в
 * этот момент уже нет, игра кончилась, и держать ради песка весь мир незачем.
 *
 * Пока экран не показан, кадры не считаются вовсе.
 */
export class ScreenDust {
  constructor(container) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'ending__dust';
    container.appendChild(this.canvas);

    this.gl = this.canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false });
    this.running = false;
    this._frame = 0;
    this._started = 0;

    if (!this.gl) return; // без WebGL просто обойдёмся без песка

    this._build();
    this._resize = () => this._fit();
    addEventListener('resize', this._resize);
  }

  start() {
    if (!this.gl || this.running) return;

    this.running = true;
    this._started = performance.now();
    this._fit();
    this._tick();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._frame);
  }

  _build() {
    const gl = this.gl;

    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('[песок]', gl.getShaderInfoLog(shader));
      }
      return shader;
    };

    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    gl.useProgram(program);
    this.program = program;

    // один прямоугольник на весь экран — больше геометрии здесь не нужно
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    const corner = gl.getAttribLocation(program, 'corner');
    gl.enableVertexAttribArray(corner);
    gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);

    this.at = Object.fromEntries(
      ['time', 'aspect', 'color', 'opacity', 'scale', 'wind', 'swirl', 'coverage', 'softness']
        .map((name) => [name, gl.getUniformLocation(program, name)])
    );

    const [r, g, b] = [16, 8, 0].map((shift) => ((CFG.color >> shift) & 255) / 255);
    gl.uniform3f(this.at.color, r, g, b);
    gl.uniform1f(this.at.opacity, CFG.opacity);
    gl.uniform1f(this.at.scale, CFG.scale);
    gl.uniform1f(this.at.swirl, CFG.swirl);
    gl.uniform1f(this.at.coverage, CFG.coverage);
    gl.uniform1f(this.at.softness, CFG.softness);

    const angle = CFG.direction * (Math.PI / 180);
    gl.uniform2f(this.at.wind, Math.cos(angle) * CFG.speed, Math.sin(angle) * CFG.speed);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  /** Холст под размер окна с оглядкой на плотность экрана. */
  _fit() {
    const dpr = Math.min(devicePixelRatio || 1, 2); // на ретине вчетверо больше точек — незачем
    const w = Math.max(1, Math.round(innerWidth * dpr));
    const h = Math.max(1, Math.round(innerHeight * dpr));

    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
    // рисунок не должен растягиваться вместе с окном
    this.gl.uniform2f(this.at.aspect, innerWidth / innerHeight, 1);
  }

  _tick() {
    if (!this.running) return;

    const gl = this.gl;
    gl.uniform1f(this.at.time, (performance.now() - this._started) / 1000);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this._frame = requestAnimationFrame(() => this._tick());
  }
}
