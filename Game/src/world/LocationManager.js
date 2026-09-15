import { Location } from './Location.js';
import { asset } from '../core/paths.js';

/**
 * Загружает локации по JSON и переключает их: старая снимается со сцены,
 * новая строится и персонаж ставится в её точку старта.
 */
export class LocationManager {
  constructor(scene, prefabs, player, zombies) {
    this.scene = scene;
    this.prefabs = prefabs;
    this.zombies = zombies;
    this.player = player;
    this.current = null;
    this.loading = false;
    this.onChange = null; // вызывается после смены локации — обновить HUD и прочее
    this.editing = false; // в режиме правки статику не сливаем: её двигают мышью
    this.camera = null;   // ставится снаружи: её надо переносить вместе с игроком
    this.splash = null;   // заставка на время загрузки; ставится снаружи
    this.onFinish = null; // цепочка кончилась: игра пройдена
    this.sfx = null;      // голоса зомби; тоже ставится снаружи
    this.seeThrough = null; // просвечивание заслонивших зданий
  }

  /** Подменяет библиотеку префабов и пересобирает текущую локацию на свежих моделях. */
  async useLibrary(prefabs) {
    this.prefabs = prefabs;
    if (this.current) await this.load(this.current.data.id);
  }

  /** Следующая локация по цепочке, куда ведёт выход текущей. */
  get nextId() { return this.current?.data.next ?? null; }

  /**
   * Переход через выход: срабатывает один раз, пока предыдущая загрузка не закончилась.
   *
   * За последним уровнем следующего нет — там кончается не цепочка, а игра,
   * поэтому пустой `next` это не тупик, а сигнал наружу.
   */
  advance() {
    if (this.loading) return;

    if (!this.nextId) {
      this.onFinish?.();
      return;
    }
    this.load(this.nextId);
  }

  async load(id) {
    this.loading = true;
    this.sfx?.silence(); // старый уровень уходит — его шаги и хрипы уходят с ним

    // Сначала чем встречать, и только потом показ: иначе первым делом виден
    // предыдущий уровень, и лишь через мгновение его сменяет нужный.
    this.splash?.prepare(id);
    this.splash?.show();

    try {
      return await this._load(id);
    } finally {
      // Уровень начинается, когда заставка УЖЕ ушла, а не когда собрана сцена.
      //
      // Порядок тут был обратный, и это ломало игру на каждом переходе. Сборка
      // уровня быстрая — всё нужное давно в памяти, — а заставка висит своё
      // время, около двух секунд. В эту щель мир уже жил: персонаж набивал
      // магазин, зомби шли к нему, а игрок смотрел на картинку и ничего не мог.
      // Случалось и вовсе прийти на уровень уже избитым.
      //
      // Теперь наоборот: пока картинка на экране, мир стоит. Полоса на ней всё
      // равно декоративная — она отмеряет не работу, а время показа, — вот по
      // её концу уровень и начинается.
      await this.splash?.hide();
      this.loading = false;
    }
  }

  async _load(id) {
    const res = await fetch(asset(`locations/${id}.json`));
    if (!res.ok) throw new Error(`локация «${id}» не найдена (${res.status})`);
    const data = await res.json();
    // Для знакомого уровня это уже сделано до показа; здесь — на случай, если он
    // открыт в обход цепочки и о нём узнали только сейчас, из файла.
    this.splash?.setLevel(data.name, data.number ?? 1);

    this.current?.dispose();
    this.seeThrough?.clear(); // прежние здания ушли вместе с локацией

    const location = new Location(
      data, this.prefabs, this.zombies, this.player?.blood,
      { batched: !this.editing, sfx: this.sfx, seeThrough: this.seeThrough }
    );
    this.scene.add(location.group);
    this.current = location;

    this.player.placeAt(location.spawn, location.spawnYaw);
    this.camera?.snap(); // кадр готов сразу: перелёта через всю карту не будет
    this.onChange?.(location);
    return location;
  }
}
