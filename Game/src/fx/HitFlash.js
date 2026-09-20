import { CONFIG } from '../config.js';

const CFG = CONFIG.hitFlash;

/**
 * Для каждого материала — его «раненый» двойник: тот же, но с красным свечением.
 *
 * Материалы в игре общие: все зомби рисуются одной копией, все машины — другой.
 * Покрась мы сам материал — покраснела бы вся толпа разом. Поэтому краснеет не
 * материал, а тот, кого ударили: на время вспышки он надевает двойника, а потом
 * снимает. Двойник один на материал, а не на каждого зомби, — и шейдер под него
 * не пересобирается: свечение не меняет программу, только её параметр.
 */
const hurtCache = new WeakMap();

function hurtOf(material) {
  let hurt = hurtCache.get(material);
  if (!hurt) {
    hurt = material.clone();
    if (hurt.emissive) {
      hurt.emissive.setHex(CFG.color);
      hurt.emissiveIntensity = CFG.intensity;
    }
    hurtCache.set(material, hurt);
  }
  return hurt;
}

/**
 * Отклик на удар: мигает красным и упруго подскакивает.
 *
 * Цифры урона игрок не видит, а полоска жизни мелкая — без отклика удар по
 * вожаку или по машине проходил незаметно. Вспышка говорит «попал», баунс —
 * «и почувствовал».
 *
 * Сам ничего не решает: его дёргают, когда урон пришёл, и обновляют каждый кадр.
 */
export class HitFlash {
  /** @param {THREE.Object3D} root — кого мигать и подбрасывать */
  constructor(root) {
    this.root = root;
    this.left = 0;        // с до конца отклика
    this.lit = false;     // надет ли сейчас раненый материал
    this.baseScale = null; // масштаб до баунса: к нему и возвращаемся
    this.meshes = null;   // меши модели с их родными материалами
  }

  /** Удар пришёл — мигает сразу. Повторный посреди отклика начинает его заново. */
  trigger() {
    if (!this.root) return;

    if (this.left <= 0) this.baseScale = this.root.scale.clone();
    this.left = CFG.duration;
  }

  update(dt) {
    if (this.left <= 0) return;

    this.left = Math.max(0, this.left - dt);
    const passed = CFG.duration - this.left;

    // Мигание: вспышка — пауза — вспышка. Сплошная краснота читалась бы как
    // окраска, а не как удар.
    const on = this.left > 0 && Math.floor(passed / CFG.blink) % 2 === 0;
    this._light(on);

    // Баунс: подскок по масштабу, затухающий к концу отклика.
    const fade = this.left / CFG.duration;
    const pop = 1 + CFG.bounce * Math.sin(passed * CFG.bounceSpeed) * fade;
    if (this.baseScale) this.root.scale.copy(this.baseScale).multiplyScalar(pop);

    if (this.left <= 0 && this.baseScale) {
      this.root.scale.copy(this.baseScale);
      this.baseScale = null;
    }
  }

  /**
   * Надеть двойника вручную — нужно только для прогрева.
   *
   * Отклик тут ни при чём: ни вспышки, ни подскока. Двойника надевают на миг,
   * чтобы рендер успел разобрать его материал заранее, — и тут же снимают.
   */
  wear(on) {
    this._light(on);
  }

  /** Снять отклик сразу: модель уходит со сцены или меняется. */
  stop() {
    this.left = 0;
    this._light(false);
    if (this.baseScale) this.root.scale.copy(this.baseScale);
    this.baseScale = null;
  }

  _light(on) {
    if (on === this.lit) return;
    this.lit = on;

    if (!this.meshes) {
      this.meshes = [];
      this.root.traverse((node) => {
        if (node.isMesh && node.material) this.meshes.push({ node, base: node.material });
      });
    }

    for (const { node, base } of this.meshes) {
      node.material = on
        ? (Array.isArray(base) ? base.map(hurtOf) : hurtOf(base))
        : base;
    }
  }
}
