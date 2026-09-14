/**
 * Холст во весь экран, на котором работает один шейдер.
 *
 * Такой слой нужен уже дважды: песок на финальной картинке и мгла по краям
 * кадра. Общее у них всё, кроме самого шейдера, — холст, контекст, треугольник
 * на весь экран, пересчёт размера под окно и цикл кадров, — поэтому оно здесь, а
 * не переписано в каждом заново.
 *
 * Треугольник, а не прямоугольник: одного хватает, чтобы накрыть экран целиком,
 * и он дешевле двух — лишних вершин и шва по диагонали нет.
 *
 * Пока слой не показан, кадры не считаются вовсе.
 */
const VERTEX = /* glsl */`
  attribute vec2 corner;
  varying vec2 vUv;

  void main() {
    vUv = corner * 0.5 + 0.5;
    gl_Position = vec4(corner, 0.0, 1.0);
  }
`;

export class ScreenShader {
  /**
   * @param {HTMLElement} container — куда положить холст
   * @param {string} className
   * @param {string} fragment — тело шейдера; ему доступны vUv, time и aspect
   * @param {string[]} uniforms — какие ещё значения он читает
   */
  constructor(container, className, fragment, uniforms = []) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = className;
    container.appendChild(this.canvas);

    this.gl = this.canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false });
    this.running = false;
    this._frame = 0;
    this._started = 0;
    this._textures = {};

    if (!this.gl) return; // без WebGL просто обойдёмся без этого слоя

    this._build(fragment, uniforms);
    addEventListener('resize', () => this._fit());
  }

  get ready() { return Boolean(this.gl); }

  /**
   * Отдать шейдеру картинку.
   *
   * Холст, а не файл: маску тумана рисуют прямо в неё по ходу игры, и заливать
   * её надо заново каждый раз, как она изменилась.
   *
   * @param {string} name @param {HTMLCanvasElement} canvas @param {number} unit
   */
  image(name, canvas, unit = 0) {
    const gl = this.gl;
    if (!gl || !this.at[name]) return;

    if (!this._textures[name]) {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      // сглаживание и зажим по краям: за пределами карты тянется её кромка,
      // иначе по швам маски пробегала бы светлая полоса
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this._textures[name] = { texture, unit };
    }

    const slot = this._textures[name];
    gl.activeTexture(gl.TEXTURE0 + slot.unit);
    gl.bindTexture(gl.TEXTURE_2D, slot.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);

    gl.useProgram(this.program);
    gl.uniform1i(this.at[name], slot.unit);
  }

  /** Поставить значение шейдеру. */
  set(name, ...values) {
    if (!this.gl || !this.at[name]) return;

    const put = [null, 'uniform1f', 'uniform2f', 'uniform3f', 'uniform4f'][values.length];
    this.gl.useProgram(this.program);
    this.gl[put](this.at[name], ...values);
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

  _build(fragment, uniforms) {
    const gl = this.gl;

    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('[экранный шейдер]', gl.getShaderInfoLog(shader));
      }
      return shader;
    };

    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    gl.useProgram(program);
    this.program = program;

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    const corner = gl.getAttribLocation(program, 'corner');
    gl.enableVertexAttribArray(corner);
    gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);

    this.at = Object.fromEntries(
      ['time', 'aspect', ...uniforms].map((name) => [name, gl.getUniformLocation(program, name)])
    );

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  /** Холст под размер окна с оглядкой на плотность экрана. */
  _fit() {
    if (!this.gl) return;

    const dpr = Math.min(devicePixelRatio || 1, 2); // на ретине вчетверо больше точек — незачем
    const w = Math.max(1, Math.round(innerWidth * dpr));
    const h = Math.max(1, Math.round(innerHeight * dpr));

    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
    // рисунок не должен растягиваться вместе с окном
    this.set('aspect', innerWidth / innerHeight, 1);
  }

  _tick() {
    if (!this.running) return;

    const gl = this.gl;
    this.set('time', (performance.now() - this._started) / 1000);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this._frame = requestAnimationFrame(() => this._tick());
  }
}
