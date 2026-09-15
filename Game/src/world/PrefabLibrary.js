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

  /** Отпустить модели: нужно на пересборке, когда библиотеку сменили свежей. */
  dispose() {
    this.props.dispose();
    this.prefabs.clear();
  }

  /** Правила для модели: сначала поштучная запись, потом группа, потом общее. */
  _describe(name) {
    const { defaults, groups = {}, overrides = {} } = this.registry;
    const group = Object.keys(groups)
      .filter((prefix) => name.startsWith(prefix))
      .sort((a, b) => b.length - a.length)[0]; // самое точное совпадение

    const rules = { ...defaults, ...(group ? groups[group] : null), ...(overrides[name] ?? null) };
    const size = this.props.size(name);

    /**
     * Мелкое — значит подвижное: его пинают, хватают и швыряют.
     *
     * Меряется объёмом, а не стороной куба: `dynamicUnder` — сколько вещь
     * занимает места, в кубометрах. Куб обманывал — плита влезала в него по
     * габаритам и уезжала от первого толчка, хотя поднять её нельзя. Объём
     * отвечает на тот же вопрос честнее: сколько в вещи всего.
     *
     * Задаётся правилом, а не списком имён: перечислять поимённо хватило бы
     * ровно до следующей партии мебели из Blender.
     */
    const small = Boolean(rules.dynamicUnder) && Boolean(size)
      && size.x * size.y * size.z <= rules.dynamicUnder;

    const dynamic = rules.dynamic === true || small;

    /**
     * Через что можно перемахнуть.
     *
     * `vaultUnder` — предельная высота: ниже неё вещь перепрыгивается. Диван и
     * обеденный стол ниже, шкаф и холодильник выше, и решает это сама модель.
     * Подвижное сюда не идёт вовсе — его просто расталкивают ногами.
     */
    const vault = rules.vault === true
      || (Boolean(rules.vaultUnder) && Boolean(size) && size.y <= rules.vaultUnder);

    /**
     * За чем герой пропадает из виду.
     *
     * Обычно это решает высота куска: всё, что выше пояса, заслоняет обзор.
     * Но за диван можно залечь, хотя он по пояс и не доходит, — поэтому у
     * мебели обзор перекрывает вся её геометрия целиком, а не только верх.
     */
    const sightShapes = rules.hides === true
      ? this.props.collisionShapes(name)
      : this.props.sightShapes(name);

    // «ниже пояса — не преграда» удобнее задавать высотой, чем перечислять мелочь поимённо.
    // Подвижное преградой не бывает вовсе: его расталкивают, а не обходят.
    const solid = rules.solid && !dynamic
      && !(rules.minSolidHeight && size && size.y < rules.minSolidHeight);

    return {
      name,
      size,
      solid,
      dynamic,
      vault,
      sink: rules.sink ?? 0, // на сколько утопить: у настила это толщина полотна
      /**
       * Бросает ли вещь тень.
       *
       * `shadowsOver` — рост, начиная с которого тень вообще заметна. Всё, что
       * ниже (конус, канистра, поддон, покрышка), её не бросает: на полу от
       * такого остаётся пятно в пару пикселей, а стоит оно целого прохода по
       * сцене — сцена ради теней рисуется вторым проходом. На вводной локации
       * такой мелочи под четыре десятка, и её тени съедали треть кадра.
       */
      shadows: rules.shadows !== false
        && !(rules.shadowsOver && size && size.y < rules.shadowsOver),
      shapes: this.props.collisionShapes(name),
      sightShapes,
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
