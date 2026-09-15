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
  constructor(camera) {
    this.camera = camera;
    this.raycaster = new THREE.Raycaster();

    this.items = [];        // за кем следим: { object, fade }
    this.blocking = new Set();
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
      mesh.material = fadeable(mesh.material);
      mesh.userData.fadeItem = item;
    });

    this.items.push(item);
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
    this.blocking.delete(item);
  }

  clear() {
    for (const item of this.items) {
      item.object.traverse((mesh) => {
        if (mesh.isMesh && mesh.material?.userData.fade) mesh.material.dispose();
      });
    }
    this.items.length = 0;
    this.blocking.clear();
  }

  update(dt, player) {
    if (this.items.length === 0) return;

    this.blocking.clear();
    if (player.alive !== false) this._findBlockers(player);

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

  /** Кто стоит между камерой и героем. */
  _findBlockers(player) {
    _at.copy(player.position).setY(player.position.y + CFG.height);
    _dir.copy(_at).sub(this.camera.position);

    const reach = _dir.length();
    this.raycaster.set(this.camera.position, _dir.normalize());
    this.raycaster.far = reach;

    for (const hit of this.raycaster.intersectObjects(this.items.map((i) => i.object), true)) {
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
function fadeable(material) {
  const copy = material.clone();
  const fade = { value: 1 };

  copy.userData.fade = fade;
  copy.onBeforeCompile = (shader) => {
    shader.uniforms.uFade = fade;

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uFade;

        // Упорядоченный узор 4x4: по нему и решаем, оставить точку или выбросить.
        float fadePattern(vec2 at) {
          const mat4 rows = mat4(
             0.0,  8.0,  2.0, 10.0,
            12.0,  4.0, 14.0,  6.0,
             3.0, 11.0,  1.0,  9.0,
            15.0,  7.0, 13.0,  5.0
          );
          int x = int(mod(at.x, 4.0));
          int y = int(mod(at.y, 4.0));
          return (rows[x][y] + 0.5) / 16.0;
        }`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if (uFade < 0.999 && fadePattern(gl_FragCoord.xy) > uFade) discard;`);
  };

  // материалу с правленым шейдером нужен свой ключ, иначе three возьмёт чужую программу
  copy.customProgramCacheKey = () => 'seeThrough';
  return copy;
}
