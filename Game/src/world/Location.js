import * as THREE from 'three';
import { Obstacles } from './Obstacles.js';
import { Debris } from '../entities/Debris.js';
import { CONFIG } from '../config.js';

// Стороны площадки: north — дальняя (−Z), south — ближняя (+Z).
// Для каждой стороны: вдоль какой оси тянется забор, где он стоит и как повёрнута секция.
const SIDES = {
  north: { along: 'x', fixed: 'z', sign: -1, rotationY: 0 },
  south: { along: 'x', fixed: 'z', sign: 1, rotationY: 0 },
  west: { along: 'z', fixed: 'x', sign: -1, rotationY: Math.PI / 2 },
  east: { along: 'z', fixed: 'x', sign: 1, rotationY: Math.PI / 2 },
};

const DEG = Math.PI / 180;
const GROUND_Y = 0.02; // площадка лежит чуть выше подложки мира

/**
 * Локация, собранная по JSON-описанию: площадка, глухой забор по периметру
 * с единственным проёмом-выходом, расставленные пропы и точка старта.
 */
export class Location {
  constructor(data, prefabs) {
    this.data = data;
    this.prefabs = prefabs;
    this.group = new THREE.Group();
    this.group.name = `location:${data.id}`;
    this.obstacles = new Obstacles();
    // Контуры ВСЕХ моделей, включая проходимые: по ним проверяем, что россыпь
    // не встанет внутрь дома, машины или другой мелочи.
    this.occupied = new Obstacles();
    this.debris = new Debris(this);

    const [w, d] = data.size;
    this.width = w;
    this.depth = d;

    this.spawn = new THREE.Vector3(data.spawn.position[0], 0, data.spawn.position[1]);
    this.spawnYaw = (data.spawn.rotation ?? 0) * DEG;

    this._buildGround();
    this._buildFence();
    this._buildProps();
  }

  /** Границы, за которые персонажу нельзя выходить (проём в заборе учитывается отдельно). */
  get bounds() {
    return { minX: -this.width / 2, maxX: this.width / 2, minZ: -this.depth / 2, maxZ: this.depth / 2 };
  }

  _buildGround() {
    const g = this.data.ground ?? {};
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(this.width, this.depth),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(g.color ?? '#6b6357'), roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = GROUND_Y; // чуть выше подложки мира, чтобы не мерцало
    ground.receiveShadow = true;
    this.group.add(ground);
    this._ground = ground;
  }

  _buildFence() {
    const fence = this.data.fence;
    if (!fence) return;

    const segName = fence.prop;
    const segSize = this.prefabs.size(segName);
    if (!segSize) return;

    const segLength = segSize.x;
    const exit = fence.exit;

    for (const side of Object.keys(SIDES)) {
      const cfg = SIDES[side];
      const length = cfg.along === 'x' ? this.width : this.depth;
      const offset = (cfg.fixed === 'z' ? this.depth : this.width) / 2;

      // проём делаем только на одной стороне — выход из локации всегда один
      let gap = null;
      if (exit && exit.side === side) {
        const center = exit.offset ?? 0;
        gap = { from: center - exit.width / 2, to: center + exit.width / 2 };
      }

      const count = Math.ceil(length / segLength);
      const step = length / count;

      for (let i = 0; i < count; i++) {
        const at = -length / 2 + step * (i + 0.5);
        if (gap && at - step / 2 < gap.to && at + step / 2 > gap.from) continue;

        const section = this.prefabs.create(segName);
        if (!section) return;
        section.scale.x = step / segLength; // подгон под шаг, чтобы не было щелей на стыках
        section.rotation.y = cfg.rotationY;
        if (cfg.along === 'x') section.position.set(at, 0, cfg.sign * offset);
        else section.position.set(cfg.sign * offset, 0, at);
        this.group.add(section);
        this._place(segName, section);
      }

      if (gap) this._buildExit(side, cfg, gap, offset);
    }
  }

  _buildExit(side, cfg, gap, offset) {
    const width = gap.to - gap.from;
    const center = (gap.from + gap.to) / 2;

    this.exit = {
      side,
      width,
      position: cfg.along === 'x'
        ? new THREE.Vector3(center, 0, cfg.sign * offset)
        : new THREE.Vector3(cfg.sign * offset, 0, center),
    };

    // подсветка проёма на земле — куда бежать, видно сразу
    const marker = new THREE.Mesh(
      new THREE.PlaneGeometry(width, 2.5),
      new THREE.MeshBasicMaterial({ color: 0xffd27f, transparent: true, opacity: 0.28, depthWrite: false })
    );
    marker.rotation.x = -Math.PI / 2;
    if (cfg.along === 'x') marker.position.set(center, 0.04, cfg.sign * (offset - 1.2));
    else {
      marker.rotation.z = Math.PI / 2;
      marker.position.set(cfg.sign * (offset - 1.2), 0.04, center);
    }
    this.group.add(marker);
  }

  _buildProps() {
    for (const entry of this.data.props ?? []) {
      const obj = this.prefabs.create(entry.prop);
      if (!obj) continue;
      obj.position.set(entry.at[0], entry.y ?? 0, entry.at[1]);
      obj.rotation.y = (entry.rotation ?? 0) * DEG;
      if (entry.scale) obj.scale.setScalar(entry.scale);
      this.group.add(obj);
      this._place(entry.prop, obj);
    }

    // разбросанная мелочь: трава, кусты, мусор — задаётся не поштучно, а зоной
    for (const patch of this.data.scatter ?? []) {
      const rand = mulberry32(patch.seed ?? 1);
      const [x0, z0, x1, z1] = patch.area;
      const [minScale, maxScale] = patch.scale ?? [1, 1];

      for (let i = 0; i < patch.count; i++) {
        // вид выбираем один раз на точку: куча получается из однотипных предметов
        const name = patch.props[Math.floor(rand() * patch.props.length)];
        const stack = patch.stack && (!patch.stack.only || patch.stack.only.includes(name))
          ? patch.stack
          : null;
        const clearance = (patch.clearance ?? 0) + (stack ? stack.jitter : 0);

        // ищем свободное место: с первого раза точка может попасть в стену или машину
        let x = 0;
        let z = 0;
        let free = false;
        for (let attempt = 0; attempt < 16 && !free; attempt++) {
          x = x0 + rand() * (x1 - x0);
          z = z0 + rand() * (z1 - z0);
          free = !this.occupied.hits(x, z, clearance);
        }
        if (!free) continue; // места не нашлось — лучше пропустить, чем воткнуть в стену

        const layers = stack ? stack.layers[0] + Math.floor(rand() * (stack.layers[1] - stack.layers[0] + 1)) : 1;

        for (let layer = 0; layer < layers; layer++) {
          const obj = this.prefabs.create(name);
          if (!obj) continue;

          const jitter = stack ? (rand() - 0.5) * stack.jitter * 2 : 0;
          const jitterZ = stack ? (rand() - 0.5) * stack.jitter * 2 : 0;
          obj.position.set(x + jitter, layer * (stack?.step ?? 0), z + jitterZ);
          obj.rotation.y = rand() * Math.PI * 2;

          if (stack?.tilt) {
            // лёгкий завал: верхние лежат неровно, как свалено руками
            const tilt = (stack.tilt * DEG * layer) / Math.max(1, layers - 1);
            obj.rotation.x = (rand() - 0.5) * tilt;
            obj.rotation.z = (rand() - 0.5) * tilt;
          }

          obj.scale.setScalar(minScale + rand() * (maxScale - minScale));
          this.group.add(obj);
          this._place(name, obj, layer === 0);
        }
      }
    }
  }

  /**
   * Регистрирует поставленный объект: препятствие, занятое место, физическое тело.
   * Чем объект является, решает его префаб, а не имя модели, — поэтому одна и та же
   * вещь ведёт себя одинаково на любой локации.
   */
  _place(name, object, markOccupied = true) {
    const prefab = this.prefabs.get(name);
    if (!prefab) return;

    if (prefab.solid) this.obstacles.add(object, prefab.shapes);
    if (markOccupied) this.occupied.add(object, prefab.shapes);
    if (prefab.dynamic) this._makeDynamic(prefab, object);
  }

  /**
   * Отдаёт объект физике. Модели приходят из Blender с началом координат в основании,
   * поэтому вещь переносится в контейнер с началом в центре масс: вращаться она должна
   * вокруг него, иначе при наклоне уходит нижним краем под землю.
   */
  _makeDynamic(prefab, object) {
    const body = prefab.body;
    if (!body) return;

    const scale = object.scale;
    const com = body.com.clone().multiply(scale);

    const pivot = new THREE.Group();
    pivot.name = `debris:${prefab.name}`;
    pivot.position.copy(object.position).add(com);
    pivot.quaternion.setFromEuler(object.rotation);

    object.position.copy(com).negate();
    object.rotation.set(0, 0, 0);
    pivot.add(object); // three сам заберёт модель из прежнего родителя
    this.group.add(pivot);

    this.debris.add(pivot, {
      boxMin: body.boxMin.clone().multiply(scale),
      boxMax: body.boxMax.clone().multiply(scale),
      volume: body.volume * scale.x * scale.y * scale.z,
    }, GROUND_Y);
  }

  /** Дошёл ли персонаж до выхода — то есть пересёк линию забора в створе проёма. */
  reachedExit(p) {
    const e = this.exit;
    if (!e) return false;
    const half = e.width / 2;
    switch (e.side) {
      case 'north': return p.z < -this.depth / 2 && Math.abs(p.x - e.position.x) < half;
      case 'south': return p.z > this.depth / 2 && Math.abs(p.x - e.position.x) < half;
      case 'west': return p.x < -this.width / 2 && Math.abs(p.z - e.position.z) < half;
      case 'east': return p.x > this.width / 2 && Math.abs(p.z - e.position.z) < half;
      default: return false;
    }
  }

  /**
   * Не пускает за забор: держит точку внутри площадки, но пропускает через проём.
   * @param {THREE.Vector3} p — правится на месте
   */
  clampPosition(p) {
    const m = 0.6; // отступ от забора, чтобы персонаж не влезал в столбы
    const halfW = this.width / 2 - m;
    const halfD = this.depth / 2 - m;
    const e = this.exit;

    // в створе проёма своя стена не ограничивает — только через него и можно выйти
    const openX = e && Math.abs(p.x - e.position.x) < e.width / 2 - m;
    const openZ = e && Math.abs(p.z - e.position.z) < e.width / 2 - m;

    if (!(e?.side === 'west' && openZ)) p.x = Math.max(p.x, -halfW);
    if (!(e?.side === 'east' && openZ)) p.x = Math.min(p.x, halfW);
    if (!(e?.side === 'north' && openX)) p.z = Math.max(p.z, -halfD);
    if (!(e?.side === 'south' && openX)) p.z = Math.min(p.z, halfD);

    return p;
  }

  dispose() {
    this.group.removeFromParent();
    // геометрия и материалы общие с библиотекой — освобождаем только то, что создано локацией
    this._ground.geometry.dispose();
    this._ground.material.dispose();
  }
}

/** Детерминированный генератор: одна и та же локация собирается одинаково при каждом запуске. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
