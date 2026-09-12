import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { loadGLTF } from '../core/AssetLoader.js';
import { Zombie } from '../entities/Zombie.js';
import { batchSkinned } from './batching.js';

/**
 * Префабы зомби: по одному GLB на вид. Геометрия, материалы и клипы общие,
 * копируется только скелет — поэтому толпа стоит дёшево.
 */
export class ZombieLibrary {
  constructor(kinds) {
    this.kinds = kinds; // Map: имя → { scene, animations }
  }

  /** @param {Record<string, string>} sources — { zombie1: '/assets/models/zombie1.glb', … } */
  static async load(sources) {
    const names = Object.keys(sources);
    const loaded = await Promise.all(names.map((name) => loadGLTF(sources[name])));

    const kinds = new Map();
    names.forEach((name, i) => {
      // материалы сводим один раз на шаблоне: клоны получат их уже слитыми,
      // и каждый зомби будет рисоваться за один вызов вместо восьми
      kinds.set(name, {
        scene: batchSkinned(loaded[i].scene),
        animations: loaded[i].animations,
      });
    });
    return new ZombieLibrary(kinds);
  }

  list() { return [...this.kinds.keys()]; }

  /**
   * Новый зомби указанного вида.
   * Скин клонируется через SkeletonUtils: обычный clone() оставил бы копию
   * привязанной к чужому скелету, и все зомби двигались бы одинаково.
   */
  create(name) {
    const kind = this.kinds.get(name);
    if (!kind) {
      console.warn(`[zombies] нет вида «${name}»`);
      return null;
    }
    return new Zombie(cloneSkinned(kind.scene), kind.animations);
  }
}
