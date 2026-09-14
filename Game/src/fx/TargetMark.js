import * as THREE from 'three';
import { CONFIG } from '../config.js';

const CFG = CONFIG.aimMark;

/**
 * Отметка цели: красный свет на том, в кого персонаж целится.
 *
 * Раньше здесь было кольцо на земле, и оно всё время с чем-нибудь спорило: с
 * глубиной — проваливалось в грядки, настилы и дорожные плиты; без глубины —
 * лезло поверх стеблей и стен. У плоской метки на земле этот спор нерешаем:
 * земли под ногами зомби, строго говоря, нет, есть всё, что на ней навалено.
 *
 * Свет ни с чем не спорит вовсе: он не геометрия и не рисуется поверх или под —
 * он просто подсвечивает саму фигуру, красным по общему холодному фону. У героя
 * такой же приём, только тёплый, так что цель читается сразу и одинаково —
 * стоит зомби в кукурузе, на дороге или в тени сарая.
 *
 * Источник один на сцену: цель всегда одна. Он не перескакивает мгновенно, а
 * разгорается и гаснет — при смене цели это читается как перевод прицела, а не
 * как рывок.
 */
export class TargetMark {
  constructor(scene) {
    const light = new THREE.PointLight(CFG.color, 0, CFG.distance, CFG.decay);
    light.name = 'targetMark';
    light.castShadow = false; // тень от источника внутри фигуры легла бы во все стороны
    light.visible = false;    // погашенный свет всё равно считается в шейдере — убираем совсем

    scene.add(light);
    this.light = light;
    this.lit = 0;
  }

  /**
   * @param {{position: THREE.Vector3, alive?: boolean} | null} target — кто на прицеле
   * @param {number} dt — секунд с прошлого кадра
   */
  update(target, dt) {
    // Труп не цель: помечать его незачем, а пока он оседает и уходит под землю,
    // свет ещё какое-то время ездил бы за ним.
    const marked = target?.alive === false ? null : target;

    if (marked) {
      const at = marked.position;
      this.light.position.set(at.x, at.y + CFG.height, at.z);
    }

    const wanted = marked ? 1 : 0;
    if (this.lit !== wanted) {
      const step = CFG.fadeSpeed * dt;
      this.lit = Math.abs(wanted - this.lit) <= step
        ? wanted
        : this.lit + Math.sign(wanted - this.lit) * step;
    }

    this.light.visible = this.lit > 0;
    this.light.intensity = CFG.intensity * this.lit;
  }
}
