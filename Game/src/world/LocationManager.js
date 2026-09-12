import { Location } from './Location.js';

/**
 * Загружает локации по JSON и переключает их: старая снимается со сцены,
 * новая строится и персонаж ставится в её точку старта.
 */
export class LocationManager {
  constructor(scene, props, player) {
    this.scene = scene;
    this.props = props;
    this.player = player;
    this.current = null;
    this.loading = false;
    this.onChange = null; // вызывается после смены локации — обновить HUD и прочее
  }

  /** Следующая локация по цепочке, куда ведёт выход текущей. */
  get nextId() { return this.current?.data.next ?? null; }

  /** Переход через выход: срабатывает один раз, пока предыдущая загрузка не закончилась. */
  advance() {
    if (this.loading || !this.nextId) return;
    this.load(this.nextId);
  }

  async load(id) {
    this.loading = true;
    try {
      return await this._load(id);
    } finally {
      this.loading = false;
    }
  }

  async _load(id) {
    const res = await fetch(`/locations/${id}.json`);
    if (!res.ok) throw new Error(`локация «${id}» не найдена (${res.status})`);
    const data = await res.json();

    this.current?.dispose();

    const location = new Location(data, this.props);
    this.scene.add(location.group);
    this.current = location;

    this.player.placeAt(location.spawn, location.spawnYaw);
    this.onChange?.(location);
    return location;
  }
}
