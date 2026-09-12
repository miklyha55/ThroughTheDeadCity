import { loadGLTF } from '../core/AssetLoader.js';
import { PropLibrary } from './PropLibrary.js';

/**
 * Префаб — модель плюс её роль в игре: препятствие ли она, можно ли её распинать,
 * бросает ли тень. Локации ставят префабы по имени и не знают ничего про геометрию,
 * поэтому одна и та же вещь одинаково ведёт себя на любой локации.
 *
 * Реестр лежит в public/prefabs.json: там перечислены правила по группам моделей
 * и, при необходимости, поштучные исключения.
 */
export class PrefabLibrary {
  constructor(props, registry) {
    this.props = props;
    this.registry = registry;
    this.prefabs = new Map();

    for (const name of props.list('')) {
      this.prefabs.set(name, this._describe(name));
    }
  }

  static async load(modelsUrl, registryUrl) {
    const [props, registry] = await Promise.all([
      PropLibrary.load(modelsUrl),
      fetch(registryUrl).then((r) => {
        if (!r.ok) throw new Error(`реестр префабов не найден (${r.status})`);
        return r.json();
      }),
    ]);
    return new PrefabLibrary(props, registry);
  }

  /** Правила для модели: сначала поштучная запись, потом группа, потом общее. */
  _describe(name) {
    const { defaults, groups = {}, overrides = {} } = this.registry;
    const group = Object.keys(groups)
      .filter((prefix) => name.startsWith(prefix))
      .sort((a, b) => b.length - a.length)[0]; // самое точное совпадение

    const rules = { ...defaults, ...(group ? groups[group] : null), ...(overrides[name] ?? null) };
    const size = this.props.size(name);

    // «ниже пояса — не преграда» удобнее задавать высотой, чем перечислять мелочь поимённо
    const solid = rules.solid && !(rules.minSolidHeight && size && size.y < rules.minSolidHeight);

    return {
      name,
      size,
      solid,
      dynamic: rules.dynamic === true,
      shadows: rules.shadows !== false,
      shapes: this.props.collisionShapes(name),
      body: this.props.body(name),
    };
  }

  has(name) { return this.prefabs.has(name); }

  get(name) {
    const prefab = this.prefabs.get(name);
    if (!prefab) console.warn(`[prefabs] нет префаба «${name}»`);
    return prefab;
  }

  /** Имена префабов: list() — все, list('Tree_') — по префиксу. */
  list(prefix = '') {
    return [...this.prefabs.keys()].filter((n) => n.startsWith(prefix));
  }

  /** Новый экземпляр: модель со всеми настройками, готовая к постановке в сцену. */
  create(name) {
    const prefab = this.prefabs.get(name);
    if (!prefab) return null;

    const object = this.props.create(name);
    if (!object) return null;

    if (!prefab.shadows) {
      object.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = false;
          o.receiveShadow = false;
        }
      });
    }
    object.userData.prefab = prefab;
    return object;
  }

  size(name) { return this.props.size(name); }
}
