import * as THREE from 'three';
import { Obstacles } from './Obstacles.js';
import { Debris } from '../entities/Debris.js';
import { batchStatic } from './batching.js';
import { ABOVE_SILHOUETTE } from '../fx/Silhouette.js';
import { NavGrid } from './NavGrid.js';
import { createBorderFog } from './BorderFog.js';
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

/** Округление до сантиметра: в файле не нужны хвосты из пятнадцати знаков. */
const round = (value) => Math.round(value * 100) / 100;

/**
 * Локация, собранная по JSON-описанию: площадка, глухой забор по периметру
 * с единственным проёмом-выходом, расставленные пропы и точка старта.
 */
export class Location {
  constructor(data, prefabs, zombieLibrary, blood = null, { batched = true, sfx = null } = {}) {
    this.data = data;
    this.prefabs = prefabs;
    this.zombieLibrary = zombieLibrary;
    this.blood = blood; // общая на сцену: зомби брызжут ею, когда их сносит предметом
    this.sfx = sfx;     // и голос у них тоже общий
    this.onBlast = null; // сцена подхватывает взрыв: вспышка, свет, тряска камеры
    // Коробки, через которые персонаж перепрыгивает: только габариты модели,
    // без её мелких деталей — зеркала и колёса прыжку не помеха.
    this.vaults = [];
    this.zombies = [];
    this._movers = [];  // кто может задеть разбросанные предметы
    this.statics = []; // неподвижные пропы: их геометрия сливается в общие меши
    // Те из них, за которыми контур фигуры не нужен: деревья, поля, кусты,
    // водонапорная башня. Сливаются отдельно, чтобы рисоваться после контуров.
    this.plainStatics = [];
    this.group = new THREE.Group();
    this.group.name = `location:${data.id}`;
    this.obstacles = new Obstacles();
    // Контуры ВСЕХ моделей, включая проходимые: по ним проверяем, что россыпь
    // не встанет внутрь дома, машины или другой мелочи.
    this.occupied = new Obstacles();
    // Только то, что выше пояса: дом, машина, контейнер. За такими персонаж
    // пропадает из виду, а за бочкой или паллетой — нет.
    this.sight = new Obstacles();
    this.debris = new Debris(this);
    // Поштучно расставленные пропы и их строки из JSON. Нужны редактору: россыпь
    // он не трогает — она задана зоной и семенем, двигать её поштучно нечего.
    this.placed = [];

    const [w, d] = data.size;
    this.width = w;
    this.depth = d;

    // сетка навигации: волну считаем чуть дальше радиуса интереса зомби
    this.nav = new NavGrid(w, d, CONFIG.nav.cell, CONFIG.zombies.loseRadius + CONFIG.nav.margin);
    this._navAge = Infinity; // возраст волны: пересчитываем не каждый кадр

    this.spawn = new THREE.Vector3(data.spawn.position[0], 0, data.spawn.position[1]);
    this.spawnYaw = (data.spawn.rotation ?? 0) * DEG;

    this._buildGround();
    this.group.add(createBorderFog(w, d)); // за забором мир тонет во мгле
    this._buildFence();
    this._buildProps();

    // сетка проходимости снимается с готовых препятствий: локация дальше не меняется
    this.nav.build(this.obstacles, CONFIG.zombies.radius);

    this._buildZombies();
    if (batched) this._batchStatics();
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
      const { carrier, com } = this._place(entry.prop, obj);

      // связь со строкой в JSON: по ней редактор сохраняет сдвинутое обратно
      this.placed.push({ object: carrier, com, entry });
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
          const { carrier, com } = this._place(name, obj, layer === 0);

          // Россыпь тоже двигается мышью, а при сохранении запекается в обычные
          // записи: зона задаёт не места, а правило, по которому они каждый раз
          // разыгрываются заново.
          this.placed.push({ object: carrier, com, entry: { prop: name } });
        }
      }
    }
  }

  /**
   * Расставляет зомби: поштучно из `zombies` и толпами из `hordes`.
   * Пока они только стоят — ходить и нападать будут потом.
   */
  _buildZombies() {
    if (!this.zombieLibrary) return;

    for (const entry of this.data.zombies ?? []) {
      this._addZombie(entry.kind, entry.at[0], entry.at[1], (entry.rotation ?? 0) * DEG, Math.random());
    }

    for (const horde of this.data.hordes ?? []) {
      const rand = mulberry32(horde.seed ?? 1);
      const [x0, z0, x1, z1] = horde.area;
      const kinds = horde.kinds ?? this.zombieLibrary.list();
      const spacing = horde.spacing ?? CONFIG.zombies.spacing;

      // Равномерно — значит по клеткам сетки, а не россыпью: случайные точки
      // сбиваются в кучи и оставляют пустые углы.
      const cells = horde.even === false ? null : this._gridFor(horde.count, x0, z0, x1, z1);

      for (let i = 0; i < horde.count; i++) {
        const cell = cells?.[i];

        // ищем место, где зомби не влезет в дом, машину и в соседа
        let x = 0;
        let z = 0;
        let free = false;

        for (let attempt = 0; attempt < 24 && !free; attempt++) {
          if (cell) {
            // внутри своей клетки, со сдвигом — чтобы строй не выглядел решёткой
            x = cell.x + (rand() - 0.5) * cell.w;
            z = cell.z + (rand() - 0.5) * cell.d;
          } else {
            x = x0 + rand() * (x1 - x0);
            z = z0 + rand() * (z1 - z0);
          }
          // Вокруг точки старта держим пустое место: иначе персонаж появляется
          // в кольце зомби и первый удар получает раньше, чем успевает оглядеться.
          if (Math.hypot(x - this.spawn.x, z - this.spawn.z) < CONFIG.zombies.spawnClear) continue;

          free = !this.occupied.hits(x, z, spacing);
        }
        if (!free) continue;

        const kind = kinds[Math.floor(rand() * kinds.length)];
        this._addZombie(kind, x, z, rand() * Math.PI * 2, rand());
      }
    }
  }

  /** Делит область на клетки по числу зомби — по клетке на каждого. */
  _gridFor(count, x0, z0, x1, z1) {
    const width = Math.abs(x1 - x0);
    const depth = Math.abs(z1 - z0);

    // пропорции клеток близки к квадратным, поэтому покрытие ровное
    const cols = Math.max(1, Math.round(Math.sqrt((count * width) / depth)));
    const rows = Math.max(1, Math.ceil(count / cols));

    const cellW = width / cols;
    const cellD = depth / rows;
    const cells = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (cells.length >= count) break;
        cells.push({
          x: Math.min(x0, x1) + cellW * (c + 0.5),
          z: Math.min(z0, z1) + cellD * (r + 0.5),
          w: cellW * 0.8,
          d: cellD * 0.8,
        });
      }
    }
    return cells;
  }

  /** Один зомби на своём месте, со сдвинутой фазой дыхания. */
  _addZombie(kind, x, z, yaw, phase) {
    const zombie = this.zombieLibrary.create(kind);
    if (!zombie) return;

    zombie.kind = kind; // чтобы редактор знал, кого записывать в файл

    const { idleLength, speedSpread, spacing } = CONFIG.zombies;

    zombie.blood = this.blood;
    zombie.sfx = this.sfx;
    zombie.root.position.set(x, GROUND_Y, z);
    zombie.root.rotation.y = yaw;
    zombie.yaw = yaw;
    zombie.home.set(x, GROUND_Y, z);   // вокруг этого места он и будет бродить
    zombie.waypoint.copy(zombie.home);
    // фаза и темп у каждого свои, иначе толпа дышит как один механизм
    zombie.desync(phase * idleLength, 1 - speedSpread / 2 + phase * speedSpread);

    this.group.add(zombie.root);
    this.zombies.push(zombie);

    // место под зомби считается занятым: соседи и россыпь сюда не встанут
    this.occupied.add(zombie.root, [
      [[-spacing, -spacing], [spacing, -spacing], [spacing, spacing], [-spacing, spacing]],
    ]);
  }

  /**
   * Сливает неподвижные пропы в несколько больших мешей.
   *
   * Столкновения к этому моменту уже посчитаны по отдельным объектам, а сами
   * объекты больше не нужны: они не двигаются, и рисовать их поштучно — значит
   * тратить сотни вызовов там, где хватает десятков.
   */
  _batchStatics() {
    this._batched = this._merge(this.statics, 0);

    // Второй пачкой — то, за чем контур не проступает. Всё дело в порядке: эти
    // меши рисуются уже после контуров, поэтому в буфере глубины их в тот момент
    // нет и подсвечивать фигуру за ними нечему. А сами они ложатся поверх.
    this._batchedPlain = this._merge(this.plainStatics, ABOVE_SILHOUETTE);
  }

  /** Сливает список пропов в общие меши и ставит им слой отрисовки. */
  _merge(objects, renderOrder) {
    if (objects.length === 0) return null;

    const batched = batchStatic(objects);
    for (const object of objects) object.removeFromParent();
    objects.length = 0;

    batched.traverse((mesh) => { mesh.renderOrder = renderOrder; });
    this.group.add(batched);
    return batched;
  }

  /** Зомби: поведение и анимации. Вызывается каждый кадр из игрового цикла. */
  update(dt, player) {
    this._navAge += dt;

    // Волна нужна одна на всю толпу, но считать её каждый кадр незачем: за четверть
    // секунды зомби проходит треть метра, путь устареть не успевает. И пока рядом
    // никого нет, она не нужна вовсе — все стоят.
    if (this._navAge >= CONFIG.nav.interval && this._someoneNear(player)) {
      this._navAge = 0;
      this.nav.update(player.position);
    }

    for (const zombie of this.zombies) zombie.update(dt, player, this, this.zombies);

    this._blockPlayer(player);

    // предметы разлетаются и от зомби: толпа проходит — ящики расходятся
    this._movers.length = 0;
    this._movers.push(player);
    for (const zombie of this.zombies) {
      if (zombie.alive) this._movers.push(zombie);
    }
    this.debris.update(dt, this._movers);

    // ушедшие под землю больше не нужны
    if (this.zombies.some((z) => z.removed)) {
      this.zombies = this.zombies.filter((z) => !z.removed);
    }
  }

  /**
   * Зомби не пускают персонажа сквозь себя.
   *
   * Без этого толпу можно просто пробежать насквозь — она перестаёт быть
   * преградой, и стрелять становится незачем. Теперь сквозь строй не пройти,
   * пока его не проредишь.
   */
  _blockPlayer(player) {
    if (!player.alive) return;

    const gap = CONFIG.zombies.bodyRadius + CONFIG.player.radius;
    const position = player.position;

    for (const zombie of this.zombies) {
      if (!zombie.alive) continue; // через труп можно перешагнуть

      const dx = position.x - zombie.position.x;
      const dz = position.z - zombie.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance >= gap || distance < 1e-4) continue;

      // Расходится зомби, а не персонаж: иначе толпа возит игрока по площадке,
      // и он теряет контроль над собственным положением.
      const push = (gap - distance) / distance;
      zombie.position.x -= dx * push;
      zombie.position.z -= dz * push;
    }
  }

  /** Есть ли поблизости зомби, которого стоит вести к персонажу. */
  _someoneNear(player) {
    const range = CONFIG.zombies.loseRadius;

    for (const zombie of this.zombies) {
      const dx = zombie.position.x - player.position.x;
      const dz = zombie.position.z - player.position.z;
      if (dx * dx + dz * dz <= range * range) return true;
    }
    return false;
  }

  /**
   * Регистрирует поставленный объект: препятствие, занятое место, физическое тело.
   * Чем объект является, решает его префаб, а не имя модели, — поэтому одна и та же
   * вещь ведёт себя одинаково на любой локации.
   */
  _place(name, object, markOccupied = true) {
    const prefab = this.prefabs.get(name);
    if (!prefab) return;

    if (prefab.solid) {
      this.obstacles.add(object, prefab.shapes);
      this.sight.add(object, prefab.sightShapes);
    }
    if (markOccupied) this.occupied.add(object, prefab.shapes);

    let carrier = object; // кого двигать, чтобы поехал сам предмет
    let com = null;       // и на сколько начало предмета смещено от начала модели

    if (prefab.dynamic) {
      const body = this._makeDynamic(prefab, object);
      if (body) ({ carrier, com } = body);
      if (!prefab.silhouette) {
        carrier.traverse((mesh) => { mesh.renderOrder = ABOVE_SILHOUETTE; });
      }
    } else if (prefab.silhouette) {
      this.statics.push(object); // не двигается — значит можно слить с остальными
    } else {
      this.plainStatics.push(object);
    }

    this._markVault(prefab, object);
    return { carrier, com };
  }

  /**
   * Запоминает габариты предмета, если через него можно перепрыгнуть.
   *
   * Берётся именно габаритная коробка модели, а не её геометрия: персонажу важно,
   * какой длины препятствие поперёк его пути и насколько оно высокое, а не то,
   * что у машины торчит зеркало.
   */
  _markVault(prefab, object) {
    if (!prefab.vault || !prefab.size) return;

    // Подвижное не годится: коробка снимается один раз, при размещении, и за
    // предметом не ездит. Пнули бочку — прыгать пришлось бы через пустое место,
    // где она лежала. Такую мелочь и так проще растолкать ногами.
    if (prefab.dynamic) return;

    const CFG = CONFIG.player;
    const scale = object.scale.x;
    if (prefab.size.y * object.scale.y > CFG.vaultMaxHeight) return;

    this.vaults.push({
      x: object.position.x,
      z: object.position.z,
      yaw: object.rotation.y,
      halfW: (prefab.size.x * scale) / 2,
      halfD: (prefab.size.z * scale) / 2,
    });
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
    }, GROUND_Y, CONFIG.explosion.props.includes(prefab.name));

    // По сцене такой предмет носит контейнер, а модель сидит внутри со сдвигом
    // в центр масс. Редактору нужен контейнер: двигая модель, он возил бы её
    // внутри неподвижной физики.
    return { carrier: pivot, com };
  }

  /**
   * Детонация бочки.
   *
   * В радиусе взрыва не выживает никто — ни зомби, ни персонаж: проверять, кто
   * там стоял, поздно. Остальной хлам просто разбрасывает, и разлетевшаяся бочка
   * вполне может снести того, до кого не дотянулся сам взрыв.
   *
   * @param {object} item — тело из физики: сама бочка
   * @param {import('../entities/Player.js').Player} player
   */
  explode(item, player) {
    const CFG = CONFIG.explosion;
    const at = item.object.position.clone();

    this.debris.remove(item);
    this.debris.blast(at, CFG.kickRadius, CFG.kick, CFG.lift);

    for (const zombie of this.zombies) {
      if (!zombie.alive) continue;
      if (zombie.position.distanceTo(at) <= CFG.radius) zombie.crush(at, CFG.gore);
    }

    if (player?.alive && player.position.distanceTo(at) <= CFG.radius) {
      player.takeDamage(player.lives, at);
    }

    this.onBlast?.(at); // вспышка и тряска — дело сцены, а не локации
  }

  /**
   * Куда персонаж перепрыгнет, если сейчас упрётся в машину.
   *
   * Щупаем точку прямо перед ним: попала внутрь габаритной коробки — значит
   * препятствие на пути. Дальше идём вдоль того же направления, пока коробка не
   * кончится, и ставим ноги чуть за её краем. Прыжок отменяется, если препятствие
   * слишком широкое поперёк хода или если приземляться некуда.
   *
   * @param {THREE.Vector3} from — где персонаж стоит
   * @param {number} dirX @param {number} dirZ — куда бежит, единичный вектор
   * @param {number} radius — его радиус
   * @returns {{x: number, z: number} | null} точка приземления
   */
  vaultTarget(from, dirX, dirZ, radius) {
    const CFG = CONFIG.player;
    const probe = radius + CFG.vaultProbe;

    for (const box of this.vaults) {
      if (!this._insideBox(box, from.x + dirX * probe, from.z + dirZ * probe)) continue;

      // шагаем вперёд, пока не выйдем из коробки
      const step = 0.15;
      let travelled = probe;

      while (travelled < CFG.vaultMaxDepth + probe) {
        travelled += step;
        const x = from.x + dirX * travelled;
        const z = from.z + dirZ * travelled;
        if (this._insideBox(box, x, z)) continue;

        // вышли: отступаем ещё немного, чтобы ноги встали за краем
        const landX = from.x + dirX * (travelled + CFG.vaultClearance);
        const landZ = from.z + dirZ * (travelled + CFG.vaultClearance);

        if (this.obstacles.hits(landX, landZ, radius)) return null; // там стена
        return { x: landX, z: landZ };
      }
      return null; // слишком широкое: такое обходят, а не перепрыгивают
    }
    return null;
  }

  /** Лежит ли точка внутри повёрнутой габаритной коробки. */
  _insideBox(box, x, z) {
    const dx = x - box.x;
    const dz = z - box.z;
    const cos = Math.cos(-box.yaw);
    const sin = Math.sin(-box.yaw);

    // Поворот объекта вокруг Y идёт по часовой стрелке в осях сцены, поэтому
    // обратное преобразование записано именно так.
    const lx = dx * cos + dz * sin;
    const lz = -dx * sin + dz * cos;

    return Math.abs(lx) <= box.halfW && Math.abs(lz) <= box.halfD;
  }

  /**
   * Расстановка в том виде, в каком она ляжет в JSON.
   *
   * Читается прямо со сцены, поэтому что подвинул в редакторе — то и сохранится.
   * Россыпь при этом запекается: её предметы становятся обычными записями, а
   * зоны из файла уходят. Иначе правку было бы не сохранить — зона задаёт не
   * места, а правило, по которому они разыгрываются заново при каждой загрузке.
   *
   * Остальные разделы (забор, орды зомби, выход) остаются как были: их правят
   * руками, а не мышью.
   */
  snapshot() {
    const props = this.placed.map(({ object, com, entry }) => {
      // У физического предмета начало координат сидит в центре масс, а в файле
      // хранится точка, из которой его ставят. Сдвиг снимаем обратно — иначе вся
      // мелочь съезжает в центр карты и уходит под землю.
      const x = object.position.x - (com?.x ?? 0);
      const y = object.position.y - (com?.y ?? 0);
      const z = object.position.z - (com?.z ?? 0);

      const saved = { prop: entry.prop, at: [round(x), round(z)] };

      const yaw = Math.round((object.rotation.y / DEG) * 10) / 10;
      if (yaw) saved.rotation = yaw;
      if (Math.abs(y) > 1e-3) saved.y = round(y);
      if (Math.abs(object.scale.x - 1) > 1e-3) saved.scale = round(object.scale.x);
      return saved;
    });

    // Зомби сохраняем там, где они стоят сейчас, — по одной записи на каждого.
    const zombies = this.zombies.map((zombie) => ({
      kind: zombie.kind,
      at: [round(zombie.position.x), round(zombie.position.z)],
      rotation: Math.round((zombie.yaw / DEG) * 10) / 10,
    }));

    // Оба процедурных раздела уходят: и россыпь, и орды теперь лежат поимённо.
    const data = { ...this.data, props, zombies };
    delete data.scatter;
    delete data.hordes;
    return data;
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

    // слитая геометрия принадлежит локации — её больше никто не переиспользует
    for (const batch of [this._batched, this._batchedPlain]) {
      batch?.traverse((o) => o.isMesh && o.geometry.dispose());
    }
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
