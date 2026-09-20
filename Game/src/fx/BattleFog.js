import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { NOISE_GLSL } from './noise.js';
import { ScreenShader } from './ScreenShader.js';

const CFG = CONFIG.fog;

const FRAGMENT = /* glsl */`
  precision mediump float;

  uniform float time;
  uniform vec2 aspect;
  uniform sampler2D mask;   // что уже открыто: белое — открыто, чёрное — туман
  uniform vec2 origin;      // мир в левом нижнем углу экрана
  uniform vec2 alongX;      // насколько мир смещается за ширину экрана
  uniform vec2 alongY;      // и за высоту
  uniform vec2 field;       // размеры карты, м
  uniform vec3 color;
  uniform float opacity;
  uniform float scale;
  uniform float speed;
  uniform float ragged;
  uniform vec2 hero;        // где герой прямо сейчас, в мире
  uniform vec2 heroReach;   // x — открыто начисто, y — конец мягкого края, м

  varying vec2 vUv;

${NOISE_GLSL}

  void main() {
    // Куда смотрит эта точка экрана на земле. Камера ортографическая, поэтому
    // связь прямая: шаг по экрану — всегда один и тот же шаг по миру, и хватает
    // трёх чисел вместо честной обратной проекции в каждом пикселе.
    vec2 ground = origin + alongX * vUv.x + alongY * vUv.y;

    // в координаты маски: карта лежит серединой в нуле
    vec2 uv = ground / field + 0.5;
    // За краем карты маска тянет свою кромку (текстура зажата по краям), и
    // открытое у границы продолжается наружу. Обрубать его там нельзя: ровная
    // черта поперёк кадра читается не как темнота, а как край маски. Что
    // делается за забором, и без того решает мгла самой локации.
    float open = texture2D(mask, uv).r;

    /**
     * Круг вокруг героя считается здесь, а не берётся из маски.
     *
     * Маска уезжает в видеопамять несколько раз в секунду — снимать весь холст
     * каждый кадр слишком дорого. Для уже пройденного это незаметно: оно и так
     * открыто. А вот передний край, тот самый, за которым игрок и следит,
     * дёргался ступенями: герой идёт плавно, а граница перед ним стоит и раз в
     * несколько кадров прыгает вперёд.
     *
     * Поэтому край, идущий за героем, рисуется прямо тут, по его нынешнему
     * месту, и движется он ровно так же плавно, как сам герой. Маске остаётся
     * только память о пройденном, и её запоздание не видно ничем: она всегда
     * позади этого круга.
     *
     * Спад — прямой, а не сглаженный: ровно такой же, каким кисть печатает
     * отпечаток в маску. Разойдись они профилем — на стыке проступало бы кольцо.
     */
    float near = distance(ground, hero);
    float live = 1.0 - clamp((near - heroReach.x) / max(0.0001, heroReach.y - heroReach.x), 0.0, 1.0);
    open = max(open, live);

    float alpha = 1.0 - open;

    // Открытое бросаем сразу: это большая часть кадра, и считать для неё нечего.
    if (alpha <= 0.004) discard;

    // Шум нужен только на границе: в глубине тумана должно быть глухо. Раньше он
    // считался по всему экрану — три обращения к шуму на каждую точку там, где
    // ответ всё равно единица. На телефоне это и стоило дороже всего.
    if (alpha < 0.996) {
      vec2 p = ground * scale * 0.1 + vec2(time * speed, time * speed * 0.6);
      float edge = 1.0 - abs(alpha * 2.0 - 1.0); // сильнее всего на границе
      alpha = clamp(alpha + (layered(p) - 0.5) * ragged * edge, 0.0, 1.0);
      if (alpha <= 0.004) discard;
    }

    gl_FragColor = vec4(color, alpha * opacity);
  }
`;

const _corner = new THREE.Vector3();
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();

/**
 * Туман войны: карта закрыта целиком, и персонаж прорезает её собой.
 *
 * Открытое не зарастает — прорезанное запекается в маску и остаётся открытым до
 * конца уровня. Идёт герой по улице — за ним тянется открытая дорожка, а то, куда
 * он не заходил, так и остаётся темнотой, и зомби в ней не видно.
 *
 * Маска живёт в холсте в мировых координатах, а не на экране: она привязана к
 * земле, а не к камере, поэтому и держится на месте, пока камера ездит.
 *
 * Рисуется одним проходом поверх кадра, а не полотном в сцене. Полотно лежало бы
 * на земле, и дома из тумана торчали бы крышами: камера смотрит под углом, и всё
 * высокое уезжает на экране выше своего основания.
 *
 * Радиус резки заведомо больше дальности огня — иначе герой стрелял бы по тому,
 * чего игрок не видит, и это читалось бы как поломка, а не как механика.
 */
export class BattleFog extends ScreenShader {
  constructor(container = document.body) {
    super(container, 'fog', FRAGMENT,
      ['mask', 'origin', 'alongX', 'alongY', 'field', 'color', 'opacity', 'scale', 'speed', 'ragged',
        'hero', 'heroReach'],
      CFG.pixelRatio);

    this.canvas2d = document.createElement('canvas');
    this.paint = this.canvas2d.getContext('2d', { willReadFrequently: false });
    this.field = { width: 0, depth: 0 };
    this.dirty = false;
    this._sinceUpload = 0; // сколько прошло с прошлой заливки в видеопамять
    this._was = new THREE.Vector2(Infinity, Infinity);

    if (!this.ready) return;

    const [r, g, b] = [16, 8, 0].map((shift) => ((CFG.color >> shift) & 255) / 255);
    this.set('color', r, g, b);
    this.set('opacity', CFG.opacity);
    this.set('scale', CFG.scale);
    this.set('speed', CFG.speed);
    this.set('ragged', CFG.ragged);

    // Те же две черты, по которым кисть печатает отпечаток в маску: внутренняя
    // открыта начисто, внешняя — конец мягкого края и предел выстрела.
    const reach = CONFIG.player.fireRange;
    this.set('heroReach', reach * CFG.clearShare, reach * CFG.sightShare);
  }

  /**
   * Новый уровень — новая, ещё не тронутая карта.
   * @param {number} width @param {number} depth — размеры локации, м
   */
  reset(width, depth) {
    this.field = { width, depth };

    this.canvas2d.width = Math.max(16, Math.round(width * CFG.pixelsPerMetre));
    this.canvas2d.height = Math.max(16, Math.round(depth * CFG.pixelsPerMetre));

    this.paint.globalCompositeOperation = 'source-over';
    this.paint.fillStyle = '#000';
    this.paint.fillRect(0, 0, this.canvas2d.width, this.canvas2d.height);

    // Дальше только открываем, и берём МАКСИМУМ, а не сумму.
    //
    // На сложении мягкие края соседних отпечатков складывались друг с другом:
    // стоило пройти пару шагов — и полупрозрачная кайма десятка отпечатков
    // давала в сумме белое. Открытая зона от этого росла на ходу сама собой, а
    // градиент насыщался раньше и выглядел резче, чем на первом кадре.
    //
    // С максимумом отпечаток ничего не добавляет к уже открытому: результат —
    // просто объединение кругов, и мягкость края одна и та же всегда.
    this.paint.globalCompositeOperation = 'lighten';

    this._was.set(Infinity, Infinity);
    this.dirty = true;
    this._sinceUpload = CFG.uploadEvery; // первая маска уровня уезжает сразу
    this.set('field', width, depth);
  }

  /**
   * Открыть всю карту разом: туман больше ничего не прячет.
   *
   * Нужно, когда прятать уже нечего и незачем — толпа поднялась и бежит по всей
   * дороге, и видеть её надо целиком.
   */
  revealAll() {
    if (!this.field.width) return;

    this.paint.fillStyle = '#fff';
    this.paint.fillRect(0, 0, this.canvas2d.width, this.canvas2d.height);
    this.dirty = true;
    this._sinceUpload = CFG.uploadEvery; // залить в видеопамять сразу, а не через кадр
  }

  /**
   * Прорезать круг вокруг точки. Мягкий край, чтобы дорожка не была штампом.
   *
   * @param {number} x @param {number} z
   * @param {number} [radius] — м, докуда открыть начисто. Без него — дальность
   *   огня героя: так прорезается дорожка за ним. Своя мера нужна разовым
   *   вскрытиям, вроде круга вожака, когда тот заметил героя.
   */
  reveal(x, z, radius = null) {
    if (!this.field.width) return;

    // Кладём без переворота по вертикали: WebGL берёт верхнюю строку холста за
    // начало текстуры, и шейдер читает маску той же формулой, что мы пишем.
    // Стоит перевернуть здесь — и он будет смотреть в зеркальную точку карты.
    const px = (x / this.field.width + 0.5) * this.canvas2d.width;
    const py = (z / this.field.depth + 0.5) * this.canvas2d.height;

    /**
     * Обе черты отмеряются от дальности огня.
     *
     * Внутренняя открыта начисто, внешняя — это конец мягкого края, и она же
     * предел выстрела: дальше, чем герой достаёт, карта не открывается. Мягкий
     * край идёт ЗА чистым кругом, а не внутрь него: растущий внутрь, он съедал
     * бы видимость там, где ещё стреляют, и цель на краю дальности оказывалась
     * бы наполовину в тумане.
     */
    const reach = CONFIG.player.fireRange;
    let clear = reach * CFG.clearShare * CFG.pixelsPerMetre;
    let soft = reach * CFG.sightShare * CFG.pixelsPerMetre;

    // Свой радиус — та же ширина мягкого края, только снаружи заданного круга.
    if (radius) {
      const edge = soft - clear;
      clear = radius * CFG.pixelsPerMetre;
      soft = clear + edge;
    }

    // Кисть непрозрачна по всей длине, а гаснет цветом от белого к чёрному.
    // Будь у края прозрачность, «максимум» считался бы поверх полупрозрачного
    // слоя и всё равно понемногу накапливался бы — а так каждая точка честно
    // берёт большее из двух значений.
    const brush = this.paint.createRadialGradient(px, py, clear, px, py, soft);
    brush.addColorStop(0, 'rgb(255,255,255)');   // им же заливается всё внутри
    brush.addColorStop(1, 'rgb(0,0,0)');

    this.paint.fillStyle = brush;
    this.paint.beginPath();
    this.paint.arc(px, py, soft, 0, Math.PI * 2);
    this.paint.fill();

    this.dirty = true;
  }

  /**
   * @param {THREE.OrthographicCamera} camera
   * @param {{position: THREE.Vector3}} player
   */
  update(camera, player, dt = 1 / 60) {
    if (!this.ready || !this.field.width) return;

    this._carve(player.position);

    // Где герой сейчас: по этому месту шейдер и ведёт передний край, каждый
    // кадр, не дожидаясь очередной заливки маски.
    this.set('hero', player.position.x, player.position.z);

    // Заливка маски в видеопамять — самое дорогое здесь, особенно на телефоне:
    // браузеру приходится снимать весь холст целиком. Делаем это не на каждом
    // шаге кисти, а несколько раз в секунду: на глаз разницы нет, потому что
    // край тумана и без того размыт на несколько метров.
    this._sinceUpload += dt;
    if (this.dirty && this._sinceUpload >= CFG.uploadEvery) {
      this.image('mask', this.canvas2d);
      this.dirty = false;
      this._sinceUpload = 0;
    }
    this._project(camera);
  }

  /**
   * Прорезать весь путь, пройденный с прошлого кадра, а не только его конец.
   *
   * Отпечаток в одной точке за кадр — это скачок: пока герой не отойдёт на шаг,
   * граница стоит, а потом прыгает разом. Поэтому отрезок между прошлой отметкой
   * и нынешней заполняется промежуточными, и край ползёт ровно, с какой бы
   * скоростью герой ни бежал.
   *
   * Печатать каждый кадр по точке тоже нельзя: на медленном ходу отпечатки
   * ложились бы один в один, а заливка текстуры стоит дороже самой кисти.
   */
  _carve(at) {
    // Первый кадр уровня: тянуть не от чего, просто отпечаток на месте.
    // Считать отрезок от бесконечности нельзя — в кисть уйдёт NaN.
    if (!Number.isFinite(this._was.x)) {
      this.reveal(at.x, at.z);
      this._was.set(at.x, at.z);
      return;
    }

    const gap = Math.hypot(at.x - this._was.x, at.z - this._was.y);
    if (gap < CFG.step) return;

    // сколько отпечатков нужно, чтобы между ними не осталось непрорезанного
    const steps = Math.min(CFG.maxSteps, Math.ceil(gap / CFG.step));

    for (let i = 1; i <= steps; i++) {
      const share = i / steps;
      this.reveal(
        this._was.x + (at.x - this._was.x) * share,
        this._was.y + (at.z - this._was.y) * share
      );
    }
    this._was.set(at.x, at.z);
  }

  /**
   * Связь экрана с землёй: где на земле левый нижний угол кадра и насколько мир
   * смещается за его ширину и высоту. Камера ортографическая, поэтому связь
   * прямая, и трёх точек хватает на весь экран.
   */
  _project(camera) {
    const at = (nx, ny) => {
      _ndc.set(nx, ny);
      _ray.setFromCamera(_ndc, camera);
      _ray.ray.intersectPlane(_plane, _corner);
      return { x: _corner.x, z: _corner.z };
    };

    const zero = at(-1, -1);
    const right = at(1, -1);
    const top = at(-1, 1);

    this.set('origin', zero.x, zero.z);
    this.set('alongX', right.x - zero.x, right.z - zero.z);
    this.set('alongY', top.x - zero.x, top.z - zero.z);
  }
}
