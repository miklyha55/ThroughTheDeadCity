import * as THREE from 'three';
import { CONFIG } from '../config.js';

const CFG = CONFIG.seeThrough;

const _at = new THREE.Vector3();
const _dir = new THREE.Vector3();

/**
 * Крупные вещи, заслонившие героя, становятся прозрачными целиком.
 *
 * Кто именно крупный, нигде не перечислено — решают габариты: всё, что выше
 * человека и шире пары шагов, само попадает в список. Так новое здание из
 * Blender начинает просвечивать без единой строчки настроек.
 *
 * Прозрачность делается растворением, а не альфой: фрагменты выбрасываются по
 * упорядоченному узору, и чем прозрачнее вещь, тем реже они остаются. Настоящая
 * полупрозрачность потребовала бы сортировки, спорила бы с тенями и заставила
 * бы разделять пачки слияния, а так материал остаётся обычным непрозрачным.
 *
 * Кто заслоняет — проверяется лучом от камеры к герою: таких вещей на локации
 * десятки, и луч по ним стоит дешевле, чем кажется.
 */
export class SeeThrough {
  /**
   * @param {THREE.Camera} camera
   * @param {THREE.WebGLRenderer} [renderer] — у него спрашивают плотность
   *   экрана: от неё зависит, сколько точек занимает одно зерно дымки
   */
  constructor(camera, renderer = null) {
    this.camera = camera;
    this.renderer = renderer;

    /**
     * Размер зерна дымки в точках экрана.
     *
     * Общий на все просвечивающие вещи: одно число, и все материалы смотрят на
     * него. Считается от плотности экрана, чтобы зерно выглядело одинаково и на
     * обычном мониторе, и на плотном телефоне. Без этого на плотном экране оно
     * выходило вдвое мельче и дымка казалась другой.
     */
    this.grain = { value: 1 };
    this._fitGrain();
    this.raycaster = new THREE.Raycaster();

    this.items = [];        // за кем следим: { object, fade }
    this.blocking = new Set();
    this._objects = [];     // те же вещи списком: по нему бьёт луч, и пересобирать
                            // его на каждый луч незачем — за кадр их теперь до семи
  }

  /**
   * Пересчитать размер зерна под нынешнюю плотность экрана.
   *
   * Зовётся и при заведении, и каждый кадр: плотность меняется на ходу, когда
   * окно переносят на другой монитор или включают в браузере режим телефона.
   * Сравнение чисел дешевле, чем подписка на все способы это заметить.
   */
  _fitGrain() {
    const density = this.renderer?.getPixelRatio?.() ?? devicePixelRatio ?? 1;
    this.grain.value = Math.max(0.5, density * CFG.grain);
  }

  /**
   * Взять вещь под наблюдение, если она достаточно велика.
   *
   * @param {THREE.Object3D} object — размещённый проп
   * @param {THREE.Vector3} size — его габариты из библиотеки
   */
  /**
   * Достаточно ли вещь крупна, чтобы заслонять героя. Без постановки на учёт:
   * локация сперва разбирает, что куда, и только потом отдаёт сюда готовое.
   */
  isBig(object, size) {
    if (!size) return false;

    // Каждую сторону меряем со своим множителем: стену могли растянуть вдоль,
    // и от этого она не стала выше.
    const tall = size.y * (object.scale.y || 1) >= CFG.minHeight;
    const wide = Math.max(size.x * (object.scale.x || 1),
      size.z * (object.scale.z || 1)) >= CFG.minWidth;

    return tall && wide;
  }

  watch(object, size) {
    if (!this.isBig(object, size)) return false;

    // Габариты берём сразу и навсегда: дом не двигается, а по ним потом решают,
    // попал ли он в кадр. По одной точке в основании так решать нельзя — камера
    // смотрит под углом, и крыша уезжает на экране заметно выше.
    const bounds = new THREE.Box3().setFromObject(object);
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());

    const item = { object, fade: 1, sphere };
    object.traverse((mesh) => {
      if (!mesh.isMesh) return;

      // Материал общий на всю локацию, а гаснуть должна одна вещь — значит ей
      // нужен свой. Геометрия при этом остаётся общей, копируется только оболочка.
      mesh.material = fadeable(mesh.material, this.grain);
      mesh.userData.fadeItem = item;
    });

    this.items.push(item);
    this._objects.push(object);
    return true;
  }

  /**
   * Забыть всё: локация сменилась.
   *
   * Копии материалов принадлежат этой локации и больше никому не нужны. За ними
   * стоит собранная шейдерная программа, и если их не выбросить, каждый заход на
   * уровень оставлял бы по копии на каждый меш каждого дома.
   */
  /** Снять с наблюдения одну вещь: её убрали с площадки. */
  forget(object) {
    const item = this.items.find((one) => one.object === object);
    if (!item) return;

    item.object.traverse((mesh) => {
      if (mesh.isMesh && mesh.material?.userData.fade) mesh.material.dispose();
    });
    this.items = this.items.filter((one) => one !== item);
    this._objects = this._objects.filter((one) => one !== object);
    this.blocking.delete(item);
  }

  clear() {
    for (const item of this.items) {
      item.object.traverse((mesh) => {
        if (mesh.isMesh && mesh.material?.userData.fade) mesh.material.dispose();
      });
    }
    this.items.length = 0;
    this._objects.length = 0;
    this.blocking.clear();
  }

  /**
   * @param {number} dt
   * @param {object} player — герой: его заслонившее просвечивает всегда
   * @param {Array} [others] — кого ещё не стоит терять из виду: живые зомби
   *   рядом. Прячущий их дом растворяется так же, как прячущий героя, — иначе
   *   толпа исчезала за углом целиком, и стрелять приходилось в никуда.
   */
  update(dt, player, others = null) {
    if (this.items.length === 0) return;

    this._fitGrain();

    this.blocking.clear();
    if (player.alive !== false) this._findBlockers(player.position);

    if (others) {
      for (const one of this._nearest(others, player)) this._findBlockers(one.position);
    }

    for (const item of this.items) {
      const wanted = this.blocking.has(item) ? CFG.fadeTo : 1;
      if (item.fade === wanted) continue;

      // Гаснет быстро, возвращается медленнее: мигание на краю заметнее задержки.
      const speed = wanted < item.fade ? CFG.fadeOutSpeed : CFG.fadeInSpeed;
      const step = speed * dt;

      item.fade = Math.abs(wanted - item.fade) <= step
        ? wanted
        : item.fade + Math.sign(wanted - item.fade) * step;

      item.object.traverse((mesh) => {
        if (mesh.isMesh) mesh.material.userData.fade.value = item.fade;
      });
    }
  }

  /**
   * Кого из толпы стоит проверять лучом.
   *
   * Всех подряд нельзя: на заправке их под шесть десятков, и луч на каждого
   * съел бы ровно то, ради чего просвечивание и затевалось. Берём ближайших к
   * герою и не дальше круга, в котором до них вообще есть дело, — дальний зомби
   * за домом игрока не занимает.
   */
  _nearest(zombies, player) {
    const near = [];

    for (const one of zombies) {
      if (one.alive === false) continue;

      const dx = one.position.x - player.position.x;
      const dz = one.position.z - player.position.z;
      const away = Math.hypot(dx, dz);
      if (away > CFG.watchRadius) continue;

      near.push({ one, away });
    }

    near.sort((a, b) => a.away - b.away);
    return near.slice(0, CFG.watchLimit).map((item) => item.one);
  }

  /** Кто стоит между камерой и точкой, за которой следим. */
  _findBlockers(spot) {
    _at.copy(spot).setY(spot.y + CFG.height);
    _dir.copy(_at).sub(this.camera.position);

    const reach = _dir.length();
    this.raycaster.set(this.camera.position, _dir.normalize());
    this.raycaster.far = reach;

    for (const hit of this.raycaster.intersectObjects(this._objects, true)) {
      const item = hit.object.userData.fadeItem;
      if (item) this.blocking.add(item);
    }
  }
}

/**
 * Копия материала, умеющая растворяться.
 *
 * Один и тот же материал делят десятки вещей, поэтому гасить его напрямую
 * нельзя — погаснут все разом. Копия дешёвая: геометрия и текстуры остаются
 * общими, дублируется только описание.
 */
function fadeable(material, grain) {
  const copy = material.clone();
  const fade = { value: 1 };

  copy.userData.fade = fade;
  copy.onBeforeCompile = (shader) => {
    shader.uniforms.uFade = fade;
    shader.uniforms.uGrain = grain;

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uFade;
        uniform float uGrain; // сколько точек экрана занимает одно зерно

        /**
         * Порог, с которым сравнивают прозрачность: свой у каждой точки экрана.
         *
         * Раньше здесь была таблица Байера 4x4 — самый обычный упорядоченный
         * узор. Считалась она правильно, а выглядела плохо, и вот почему.
         *
         * При прозрачности около четверти под порог проходят четыре младших
         * числа таблицы, а лежат они в ней ровно по чётным строкам и чётным
         * столбцам. То есть узор вырождается в строгую решётку с шагом в две
         * точки. Пока картинка идёт на экран один к одному, это ровная дымка;
         * но стоит её перемасштабировать — а это и режим телефона в браузере, и
         * дробная плотность экрана, и любое увеличение страницы, — как решётка
         * бьётся с сеткой точек экрана и расплывается крупными светящимися
         * пятнами. Муар.
         *
         * Здесь узор нерегулярный: у него нет одной частоты, с которой можно
         * сбиться. Пересчёт размывает его в шум, а не в пятна.
         *
         * Число постоянно для каждой точки экрана и не меняется от кадра к
         * кадру, так что дымка не мерцает и не ползёт.
         */
        float fadePattern(vec2 at) {
          vec2 cell = floor(at);
          return fract(52.9829189 * fract(dot(cell, vec2(0.06711056, 0.00583715))));
        }`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if (uFade < 0.999 && fadePattern(gl_FragCoord.xy / uGrain) > uFade) discard;`);
  };

  // материалу с правленым шейдером нужен свой ключ, иначе three возьмёт чужую программу
  copy.customProgramCacheKey = () => 'seeThrough';
  return copy;
}
