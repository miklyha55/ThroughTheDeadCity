import * as THREE from 'three';
import { Obstacles } from './Obstacles.js';
import { Debris } from '../entities/Debris.js';
import { batchStatic } from './batching.js';
import { NavGrid } from './NavGrid.js';
import { createBorderFog } from './BorderFog.js';
import { CONFIG } from '../config.js';
import { flatDistance } from '../core/ground.js';

const DEG = Math.PI / 180;

// Ноль — уровень, по которому ходят: на нём стоит всё, от домов до зомби.
// Сам пол лежит на волос ниже — только чтобы не спорить за пиксели с дорожным
// полотном, чей верх приведён ровно к нулю.
const GROUND_Y = -0.02;

/**
 * На сколько утопить предмет, чтобы по нему можно было ходить.
 *
 * Модели нарисованы от нуля вверх, поэтому дорожная плита толщиной в ладонь
 * торчит над землёй, и все, кто на ней стоит, вязнут по щиколотку. Дорогу мы
 * опускаем на толщину её полотна — ровно настолько, чтобы асфальт лёг вровень
 * с землёй.
 *
 * Именно на толщину, а не «на высоту модели»: у воронки над полотном поднимается
 * вал в полметра, и просадка по нему утопила бы весь тайл, оставив в дороге дыру.
 */
function sinkOf(prefab) {
  return prefab?.sink ?? 0;
}

const _facing = new THREE.Vector3();

/**
 * На сколько вещь развёрнута вокруг вертикали, в градусах.
 *
 * Считается по тому, куда смотрит её нос, а НЕ по `rotation.y`. Разница
 * появляется ровно там, где её меньше всего ждёшь: поворот на 180° тот же угол
 * Эйлера записывает как «перевёрнут через верх», то есть (180, 0, 180), и
 * вертикальный угол читается нулём. Диван, развёрнутый к стене, после
 * сохранения оказывался развёрнутым обратно в комнату.
 *
 * Направление же от разложения по осям не зависит: куда смотрит, туда и смотрит.
 */
function yawOf(object) {
  _facing.set(0, 0, 1).applyQuaternion(object.quaternion);
  return Math.round((Math.atan2(_facing.x, _facing.z) / DEG) * 10) / 10;
}

/** Округление до сантиметра: в файле не нужны хвосты из пятнадцати знаков. */
const round = (value) => Math.round(value * 100) / 100;

/**
 * Локация, собранная по JSON-описанию: площадка, глухой забор по периметру
 * с единственным проёмом-выходом, расставленные пропы и точка старта.
 */
/**
 * Попала ли точка в область: центр, размер по X и по Z, плюс толщина тела.
 *
 * Размеры порознь, потому что метки тянут гизмо по осям: вытянутой поперёк
 * прохода вехой его и перекрывают.
 */
function inside(p, at, alongX, alongZ, body = 0) {
  const dx = (p.x - at.x) / (alongX + body);
  const dz = (p.z - at.z) / (alongZ + body);

  return dx * dx + dz * dz <= 1;
}

export class Location {
  constructor(data, prefabs, zombieLibrary, blood = null,
    { batched = true, sfx = null, seeThrough = null } = {}) {
    this.data = data;
    this.prefabs = prefabs;
    this.zombieLibrary = zombieLibrary;
    this.blood = blood; // общая на сцену: зомби брызжут ею, когда их сносит предметом
    this.sfx = sfx;     // и голос у них тоже общий
    this.seeThrough = seeThrough; // сквозь что смотреть, когда оно закрывает героя
    this.onBlast = null; // сцена подхватывает взрыв: вспышка, свет, тряска камеры
    // Коробки, через которые персонаж перепрыгивает: только габариты модели,
    // без её мелких деталей — зеркала и колёса прыжку не помеха.
    this.vaults = [];
    this.zombies = [];
    this.boss = null;        // вожак, если он на этом уровне есть: пока жив, выход заперт
    this.breachable = [];    // заграждение, которое толпа снесёт: живёт поштучно, не сливается
    this.horde = null;       // толпа за ним: когда поднимется и что уже случилось
    this.cleared = false;    // все зомби перебиты — на уровнях, где это условие выхода
    this.exitLocked = false; // заперт ли выход: на вводной — пока не взято ружьё
    this.guide = [];         // вехи на пути к выходу: что заметить по дороге
    this._movers = [];  // кто может задеть разбросанные предметы
    this.statics = []; // неподвижные пропы: их геометрия сливается в общие меши
    this.watched = []; // крупное, что просвечивает: сливается рядами, а не всё разом
    this.merged = []; // слитые куски: их геометрию создали здесь, здесь же и освобождаем
    // Слитое мышью не подвинуть, поэтому в правке расстановки локация живёт
    // несклеенной — и новые вещи в ней тоже ставятся поштучно.
    this.batched = batched;
    this.built = false;
    this.group = new THREE.Group();
    this.group.name = `location:${data.id}`;
    this.obstacles = new Obstacles();
    // Только то, что выше пояса: дом, машина, контейнер. За такими персонаж
    // пропадает из виду, а за бочкой или паллетой — нет.
    this.sight = new Obstacles();
    this.debris = new Debris(this);
    // Поштучно расставленные пропы и их строки из JSON: связь объекта на сцене
    // со строкой файла нужна редактору, чтобы вернуть сдвинутое обратно в JSON.
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
    this.fog = createBorderFog(w, d); // за забором мир тонет во мгле
    this.group.add(this.fog);
    this._buildProps();

    // сетка проходимости снимается с готовых препятствий: локация дальше не меняется
    this.nav.build(this.obstacles, CONFIG.zombies.radius);

    this._buildZombies();
    this._buildHorde();
    this._buildExitMark();
    this._buildGuide();

    // Локация собрана: дальше вещи в ней только правят руками, и каждая такая
    // правка доделывается на месте — просвечивание, проходимость. Пока шла
    // сборка, всё это делалось разом и по-другому.
    this.built = true;

    if (batched) {
      this._batchStatics();
      this._batchWatched();
    } else {
      for (const object of this.watched) this._watchAlone(object);
      this.watched.length = 0;
    }
  }

  /**
   * Отдать одну вещь на просвечивание — как есть, без слияния.
   *
   * Габариты берутся у её префаба, а если их там нет — снимаются с самой модели.
   * @param {THREE.Object3D} object
   */
  _watchAlone(object) {
    const prefab = object.userData.prefab;
    const size = prefab?.size ?? new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
    this.seeThrough?.watch(object, size);
  }

  _buildGround() {
    const g = this.data.ground ?? {};
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(this.width, this.depth),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(g.color ?? '#6b6357'), roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = g.y ?? GROUND_Y;
    ground.receiveShadow = true;
    ground.name = 'ground';
    this.group.add(ground);
    this.ground = ground; // редактор двигает его тем же гизмо, что и всё прочее
  }

  _buildProps() {
    for (const entry of this.data.props ?? []) this.addProp(entry);
  }

  /**
   * Поставить одну вещь по её записи из файла.
   *
   * Отдельным методом, потому что тем же путём идёт и клонирование в редакторе:
   * копия должна попасть во все те же списки, что и вещь из файла, иначе она
   * будет только выглядеть предметом — без столкновений, физики и сохранения.
   *
   * @param {object} entry — запись вида { prop, at, rotation, y, scale }
   * @returns {THREE.Object3D|null} то, что двигают на сцене
   */
  addProp(entry) {
    const obj = this.prefabs.create(entry.prop);
    const prefab = this.prefabs.get(entry.prop);
    if (!obj || !prefab) return null;

    obj.position.set(entry.at[0], (entry.y ?? 0) - sinkOf(prefab), entry.at[1]);
    obj.rotation.y = (entry.rotation ?? 0) * DEG;
    // Масштаб бывает двух видов: одно число — растянуть во все стороны поровну,
    // три — по каждой оси своё. Второе нужно стенам: секцию тянут вдоль, чтобы
    // закрыть проём, и толстеть и расти при этом она не должна.
    if (Array.isArray(entry.scale)) obj.scale.set(...entry.scale);
    else if (entry.scale) obj.scale.setScalar(entry.scale);

    // У клинка размер один на всю игру и в файле не хранится: игрок узнаёт его
    // по виду, и на разных локациях он обязан выглядеть одинаково.
    if (CONFIG.blades.props.includes(entry.prop)) obj.scale.setScalar(CONFIG.blades.scale);
    this.group.add(obj);

    const { carrier, com } = this._place(entry.prop, obj);

    /**
     * Заграждение, которое снесёт толпа, сливать со статикой нельзя: из общего
     * меша кусок уже не вынуть. Держим его отдельно — это пара десятков вещей
     * на весь уровень, и вызовов отрисовки они почти не добавляют.
     */
    if (entry.breach) {
      this.statics = this.statics.filter((one) => one !== obj);
      this.watched = this.watched.filter((one) => one !== obj);
      this.breachable.push(obj);
    }

    /**
     * Крупное, поставленное уже после сборки, отдаём на просвечивание сразу.
     *
     * Очередь `watched` разбирается один раз, при сборке локации, и всё, что
     * попадало в неё позже, оставалось в ней навсегда: копия стены или дома не
     * просвечивала, когда закрывала героя, и не числилась нигде, кроме этого
     * списка. Такое бывает только в правке расстановки — там и лечим.
     */
    if (this.built && this.watched.length > 0) {
      for (const one of this.watched) this._watchAlone(one);
      this.watched.length = 0;
    }

    // связь со строкой в JSON: по ней редактор сохраняет сдвинутое обратно
    this.placed.push({ object: carrier, com, entry, shaped: obj });
    this._renav();
    return carrier;
  }

  /** Расставляет зомби: каждый записан в локации поимённо, со своим местом. */
  _buildZombies() {
    if (!this.zombieLibrary) return;

    for (const entry of this.data.zombies ?? []) {
      this._addZombie(entry.kind, entry.at[0], entry.at[1], (entry.rotation ?? 0) * DEG, Math.random());
    }
  }

  _addZombie(kind, x, z, yaw, phase) {
    const zombie = this.zombieLibrary.create(kind);
    if (!zombie) return null;

    zombie.kind = kind; // чтобы редактор знал, кого записывать в файл

    const { speedSpread } = CONFIG.zombies;

    zombie.onDeath = () => this.onKill?.(zombie);
    zombie.blood = this.blood;
    zombie.sfx = this.sfx;
    zombie.root.position.set(x, 0, z);
    zombie.root.rotation.y = yaw;
    zombie.yaw = yaw;
    zombie.home.set(x, 0, z);   // вокруг этого места он и будет бродить
    zombie.waypoint.copy(zombie.home);
    // фаза и темп у каждого свои, иначе толпа дышит как один механизм.
    // Фаза — доля клипа: его длину зомби берёт из самой анимации.
    zombie.desync(phase, 1 - speedSpread / 2 + phase * speedSpread);

    this.group.add(zombie.root);
    this.zombies.push(zombie);

    if (kind === CONFIG.boss.kind) {
      this.boss = zombie;
      zombie.onDown = () => this.onBossDown?.(); // сцене пора открыть выход
      zombie.onStep = (away) => this.onBossStep?.(away);
      zombie.onSpotted = () => this.onBossSpotted?.(zombie);
    }
    return zombie;
  }

  /**
   * Сливает неподвижные пропы в несколько больших мешей.
   *
   * Столкновения к этому моменту уже посчитаны по отдельным объектам, а сами
   * объекты больше не нужны: они не двигаются, и рисовать их поштучно — значит
   * тратить сотни вызовов там, где хватает десятков.
   */
  _batchStatics() {
    this._merge(this.statics, 0);
  }

  /**
   * Сливает крупное рядами и отдаёт ряды на просвечивание.
   *
   * Стена комнаты набрана секциями по четыре метра, и каждая секция заслоняет
   * героя сама по себе — то есть рисуется отдельным вызовом. На вводной локации
   * таких секций три десятка, и вместе с тенями они съедали больше половины
   * кадра.
   *
   * Сливаем их по рядам: ряд — это одна стена комнаты. Гаснет она теперь
   * целиком, и это как раз то, что нужно внутри помещения: когда стена
   * закрывает героя, ей и положено растаять целиком, а не по кускам.
   *
   * Всё, что в своём ряду одно — отдельно стоящий дом, — так и остаётся само по
   * себе: сливать его не с чем.
   */
  _batchWatched() {
    const lines = new Map();

    for (const object of this.watched) {
      // Линия — это поворот плюс поперечная координата: секции одной стены стоят
      // на одной прямой и смотрят в одну сторону.
      const yaw = Math.round(object.rotation.y / DEG / 90) * 90;
      const along = ((yaw % 180) + 180) % 180 === 0;
      const across = Math.round((along ? object.position.z : object.position.x) * 2) / 2;

      const key = `${along ? 'z' : 'x'}${across}`;
      if (!lines.has(key)) lines.set(key, { along, row: [] });
      lines.get(key).row.push(object);
    }

    for (const { along, row } of lines.values()) {
      for (const run of this._runs(along, row)) {
        if (run.length < 2) {
          this._watchAlone(run[0]); // одинокому дому сливаться не с чем
          continue;
        }

        const merged = batchStatic(run);
        for (const object of run) object.removeFromParent();
        this.group.add(merged);
        this.merged.push(merged);

        // Габариты слитого ряда считаем по нему самому: своей модели у него нет.
        const size = new THREE.Box3().setFromObject(merged).getSize(new THREE.Vector3());
        this.seeThrough.watch(merged, size);
      }
    }

    this.watched.length = 0;
  }

  /**
   * Режет линию на сплошные куски: сливается только то, что стоит подряд.
   *
   * Одной линии мало. Стены двух разных комнат — или вовсе разных зданий —
   * запросто оказываются на одной прямой, и слитые вместе они гасли бы разом:
   * герой заходит в одну комнату, а растворяется и дальняя стена соседней.
   * Хуже того, сфера отсечения такого куска растягивается на пол-карты, и
   * отсечь его по кадру уже нельзя — ровно тот выигрыш, ради которого слияние
   * и затевалось.
   *
   * Соседними считаются секции, между которыми меньше двух шагов сетки: стена
   * набрана впритык, а между зданиями всегда есть проход.
   *
   * @param {boolean} along — тянется ли линия вдоль оси X
   * @param {THREE.Object3D[]} row
   * @returns {THREE.Object3D[][]}
   */
  _runs(along, row) {
    const reach = CONFIG.locations.mergeGap ?? 8;
    const at = (one) => (along ? one.position.x : one.position.z);

    const sorted = row.slice().sort((a, b) => at(a) - at(b));
    const runs = [[sorted[0]]];

    for (let i = 1; i < sorted.length; i++) {
      const last = runs[runs.length - 1];
      if (at(sorted[i]) - at(last[last.length - 1]) <= reach) last.push(sorted[i]);
      else runs.push([sorted[i]]);
    }
    return runs;
  }

  /** Сливает список пропов в общие меши и ставит им слой отрисовки. */
  _merge(objects, renderOrder) {
    if (objects.length === 0) return null;

    // Сливаем всё разом, а не по клеткам сетки. Резать пробовали: отсекается
    // лучше, но материалы дробятся вместе с геометрией, и вызовов отрисовки
    // становится больше, чем экономится треугольников. На этой застройке
    // выходило 168 вызовов против 136 при той же картинке.
    const batched = batchStatic(objects);
    for (const object of objects) object.removeFromParent();
    objects.length = 0;

    batched.traverse((mesh) => { mesh.renderOrder = renderOrder; });
    this.group.add(batched);
    this.merged.push(batched);
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
    this._clearBoss();
    this._hordeStep(dt, player);
    this._watchCleared();
    this._pulseExit(dt);

    // предметы разлетаются и от зомби: толпа проходит — ящики расходятся
    this._movers.length = 0;
    this._movers.push(player);
    for (const zombie of this.zombies) {
      if (zombie.alive) this._movers.push(zombie);
    }
    this.debris.update(dt, this._movers);

    /**
     * Ушедшие под землю больше не нужны — и отпустить их надо полностью.
     *
     * Снять тело со сцены мало: у каждого зомби свой скелет, а под скелет
     * отведена текстура в видеопамяти. Раньше такой выбывал из списка живым
     * грузом — уборка локации проходила только по оставшимся, и всё, что игрок
     * успел перебить, оставалось в памяти до конца игры. На заправке это под
     * шесть десятков текстур за один проход.
     */
    if (this.zombies.some((z) => z.removed)) {
      for (const zombie of this.zombies) {
        if (zombie.removed) zombie.dispose();
      }
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

    const position = player.position;

    for (const zombie of this.zombies) {
      if (!zombie.alive) continue; // через труп можно перешагнуть

      if (zombie === this.boss) {
        this._keepFromBoss(player);
        continue;
      }

      // Радиус берётся у самой цели: за рулём это машина, и она шире героя —
      // с её радиусом толпа обтекает кузов, а не влипает в него.
      const gap = zombie.bodyRadius + (player.radius ?? CONFIG.player.radius);
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

  /**
   * Толпа из файла уровня: где черта, которую переходит герой, и кто в толпе.
   *
   * В толпе все, кто стоит в её прямоугольнике на момент сборки уровня. Поимённо
   * их не перечисляем: расставляют их в редакторе, и держать отдельный список,
   * который разойдётся с расстановкой, незачем.
   */
  _buildHorde() {
    const spec = this.data.horde;
    if (!spec) return;

    const [x0, z0, x1, z1] = spec.area;
    const inside = (p) => p.x >= Math.min(x0, x1) && p.x <= Math.max(x0, x1)
      && p.z >= Math.min(z0, z1) && p.z <= Math.max(z0, z1);

    this.horde = {
      trigger: spec.trigger,
      members: this.zombies.filter((zombie) => inside(zombie.position)),
      clock: -1,     // меньше нуля — ещё не началось
      woke: false,
      broke: false,
      calmAt: null,  // кто когда остынет: расписывается в миг прорыва
      calmed: false, // остыли все — толпы больше нет, есть просто зомби
    };
  }

  /**
   * Ход толпы: герой пересёк черту — дальше всё идёт по часам.
   *
   * Сцене сообщается дважды: когда началось (ей лететь камерой) и когда рухнул
   * каждый кусок заграждения (ей рисовать осколки и греметь).
   */
  _hordeStep(dt, player) {
    const horde = this.horde;
    if (!horde || horde.calmed) return;

    if (horde.clock < 0) {
      if (!player.alive) return;

      const [x0, z0, x1, z1] = horde.trigger;
      const p = player.position;
      const crossed = p.x >= Math.min(x0, x1) && p.x <= Math.max(x0, x1)
        && p.z >= Math.min(z0, z1) && p.z <= Math.max(z0, z1);
      if (!crossed) return;

      horde.clock = 0;

      // Камера летит к заграждению: смотреть надо на то, что сейчас рухнет.
      // Толпу за ним герой и так увидит, когда она побежит.
      this.onHorde?.(this._breachCenter());
      return;
    }

    horde.clock += dt;
    const CFG = CONFIG.horde;

    if (!horde.woke && horde.clock >= CFG.wakeAfter) {
      horde.woke = true;
      for (const zombie of horde.members) zombie.enrage();
      this.onHordeWake?.();
    }

    if (!horde.broke && horde.clock >= CFG.breachAfter) {
      horde.broke = true;
      this.breach();

      // Кто когда остынет и куда уйдёт.
      //
      // Время — поровну по отрезку и вразбивку: по порядку остывали бы соседи
      // подряд, и толпа редела бы с одного края. Направления — веером по кругу,
      // каждому своё: так остывшие расходятся во все стороны и занимают
      // площадку, а не тянутся одной колонной.
      const order = horde.members.slice().sort(() => Math.random() - 0.5);
      const last = Math.max(1, order.length - 1);

      horde.calmAt = new Map(order.map((zombie, i) => [zombie, {
        at: horde.clock + CFG.calmFrom + (CFG.calmTo - CFG.calmFrom) * (i / last),
        turn: (i / order.length) * Math.PI * 2 + Math.random() * 0.6,
        away: CFG.scatterNear + Math.random() * (CFG.scatterFar - CFG.scatterNear),
      }]));
    }

    if (!horde.broke) return;

    for (const [zombie, plan] of horde.calmAt) {
      if (horde.clock < plan.at) continue;

      zombie.calm(this, plan.turn, plan.away);
      horde.calmAt.delete(zombie);
    }
    if (horde.calmAt.size === 0) horde.calmed = true;
  }

  /**
   * Снести заграждение: каждый кусок уходит из столкновений, из обзора и со
   * сцены, а проходимость пересчитывается.
   *
   * Сцене кусок отдаётся до того, как его снимут: осколки берут цвет с модели.
   */
  /** Середина заграждения: туда и смотрит камера. */
  _breachCenter() {
    const at = new THREE.Vector3();
    if (this.breachable.length === 0) return at;

    for (const object of this.breachable) at.add(object.position);
    return at.divideScalar(this.breachable.length);
  }

  breach() {
    for (const object of this.breachable) {
      this.onBreak?.(object);

      this.obstacles.forget(object);
      this.sight.forget(object);
      this.vaults = this.vaults.filter((box) => box.owner !== object);
      this.placed = this.placed.filter((one) => one.shaped !== object);
      object.removeFromParent();

      // Хлам рядом разлетается от удара.
      const CFG = CONFIG.horde;
      this.debris.blast(object.position, CFG.blastRadius, CFG.blastPower, CFG.blastLift);
    }
    this.breachable.length = 0;

    // В игре сетка обычно не пересчитывается — уровень не меняется. Здесь он
    // изменился: где стояло заграждение, теперь проход.
    this.nav.build(this.obstacles, CONFIG.zombies.radius);
    this._navAge = Infinity;
  }

  /**
   * Перебиты ли все: на уровне, где это условие выхода, сцене пора открыть его.
   * Сообщается один раз.
   */
  _watchCleared() {
    if (this.cleared || !this.data.clearToExit) return;
    if (this.zombies.some((zombie) => zombie.alive)) return;

    this.cleared = true;
    this.onCleared?.();
  }

  /** Остались ли живые, если на уровне выход — только через всех. */
  get mustClear() {
    return Boolean(this.data.clearToExit) && !this.cleared;
  }

  /**
   * К вожаку герой не подходит ближе `boss.keepOut`.
   *
   * Здесь, в отличие от толпы, упирается сам герой, а не расходится вожак: его
   * не растолкать, и вплотную под ним делать нечего — бросок оттуда не
   * увидеть, а стрелять в упор по великану было бы слишком просто. Круг
   * заметно шире его тела, поэтому ощущается как невидимая стена вокруг него.
   */
  _keepFromBoss(player) {
    const boss = this.boss;
    const position = player.position;
    const gap = CONFIG.boss.keepOut;

    const dx = position.x - boss.position.x;
    const dz = position.z - boss.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance >= gap) return;

    // Точно в центре — направления нет, выставляем куда-нибудь.
    const nx = distance > 1e-4 ? dx / distance : 1;
    const nz = distance > 1e-4 ? dz / distance : 0;

    position.x = boss.position.x + nx * gap;
    position.z = boss.position.z + nz * gap;

    // Выставленный на край может оказаться в стене или за забором: в прыжке
    // его из препятствия не выталкиваем — он над ним летит.
    if (!player.jumping) this.obstacles.resolve(position, CONFIG.player.radius);
    this.clampPosition(position);
  }

  /**
   * Толпа не лезет внутрь вожака.
   *
   * Мягкого расхождения, которым зомби делят место между собой, тут мало:
   * вожак идёт напролом, втрое шире любого, и толпа, напирающая на героя,
   * вдавливала бы в него и себя. Поэтому здесь жёстко — всякого, кто оказался
   * внутри его тела, выставляем на край. Сдвигается зомби, а не вожак: он
   * тяжелее, и сбить его с шага толпой было бы странно.
   */
  _clearBoss() {
    const boss = this.boss;
    if (!boss?.alive) return;

    for (const zombie of this.zombies) {
      if (zombie === boss || !zombie.alive) continue;

      const gap = boss.bodyRadius + zombie.bodyRadius;
      const dx = zombie.position.x - boss.position.x;
      const dz = zombie.position.z - boss.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance >= gap) continue;

      // Точно в центре — направления нет, выталкиваем куда-нибудь.
      const nx = distance > 1e-4 ? dx / distance : 1;
      const nz = distance > 1e-4 ? dz / distance : 0;

      zombie.position.x = boss.position.x + nx * gap;
      zombie.position.z = boss.position.z + nz * gap;
      this.obstacles.resolve(zombie.position, CONFIG.zombies.radius);
      this.clampPosition(zombie.position);
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
   * Регистрирует поставленный объект: препятствие, физическое тело, помеха обзору.
   * Чем объект является, решает его префаб, а не имя модели, — поэтому одна и та же
   * вещь ведёт себя одинаково на любой локации.
   */
  _place(name, object) {
    const prefab = this.prefabs.get(name);
    if (!prefab) return;

    if (prefab.solid) {
      // Высоту берём у самой модели: по ней летящее поверху решает, задело оно
      // преграду или прошло над ней.
      const height = prefab.size ? prefab.size.y * object.scale.y : Infinity;

      this.obstacles.add(object, prefab.shapes, height);
      this.sight.add(object, prefab.sightShapes);
    }

    let carrier = object; // кого двигать, чтобы поехал сам предмет
    let com = null;       // и на сколько начало предмета смещено от начала модели

    if (prefab.dynamic) {
      const body = this._makeDynamic(prefab, object);
      if (body) ({ carrier, com } = body);
    } else if (this.seeThrough?.isBig(object, prefab.size)) {
      // Крупное — стены, дома — просвечивает, когда заслоняет героя, и потому не
      // может уйти в общий меш со всей локацией. Но и поштучно держать его дорого,
      // поэтому оно копится здесь, а сливается рядами ниже.
      this.watched.push(object);
    } else {
      this.statics.push(object);
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
    if (prefab.size.y * object.scale.y > CFG.vaultMaxHeight) return;

    this.vaults.push({
      owner: object,
      x: object.position.x,
      z: object.position.z,
      yaw: object.rotation.y,
      // по своей оси свой множитель: растянутое вдоль не становится шире поперёк
      halfW: (prefab.size.x * object.scale.x) / 2,
      halfD: (prefab.size.z * object.scale.z) / 2,
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
    }, 0, {
      explosive: CONFIG.explosion.props.includes(prefab.name),
      blade: CONFIG.blades.props.includes(prefab.name),
    });

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
   * @param {import('../entities/Player.js').Player} [player] — кого ещё накрыло
   */
  explode(item, player) {
    const CFG = CONFIG.explosion;

    // Взорвать одно и то же дважды нельзя. Просьба об этом приходит по разным
    // путям — залп из трёх дробин, добивание брошенного, соседний взрыв, — и
    // второй заход дал бы второй грохот и вторую горсть осколков на пустом
    // месте, там, где вещи уже нет.
    if (!this.debris.items.includes(item)) return;

    const at = item.object.position.clone();

    // Сцене вещь отдаётся до того, как её убирают: по ней берётся цвет осколков,
    // а снятую со сцены модель спрашивать уже не о чем.
    this.onBlast?.(at, item.object); // вспышка, осколки и тряска — дело сцены

    this.debris.remove(item);
    this.debris.blast(at, CFG.kickRadius, CFG.kick, CFG.lift);

    /**
     * Взрыв не разбирает, кто его устроил: в круге не выживает никто. Бочка —
     * это не вторая пушка, а решение, с какого расстояния по ней стрелять.
     *
     * Круг меряется по земле, а не по прямой в пространстве. Бочку подрывают в
     * полёте, метрах в двух над головами, и прямое расстояние до зомби выходило
     * заметно больше, чем видно на глаз: взрыв гремел прямо над толпой, а
     * крайние оставались целы. Особенно на бегущих — те как раз и оказывались с
     * краю.
     */
    for (const zombie of this.zombies) {
      if (!zombie.alive) continue;
      // По касанию: в круг попадает и тот, кого задело краем, а не только тот,
      // кто стоял в нём целиком.
      if (flatDistance(zombie.position, at) <= CFG.radius + zombie.bodyRadius) {
        zombie.crush(at, CFG.gore, 'blast');
      }
    }

    // Героя взрыв не трогает вовсе. Бочка теперь не ловушка, а оружие: он сам
    // её швыряет и сам подрывает, и гибнуть от собственного броска было бы
    // наказанием за то, что игра же и предлагает делать.

    this._chain(at, player);
  }

  /**
   * Цепь: взрыв поджигает взрывчатку, лежащую рядом.
   *
   * Не разом, а с задержкой: составленные кучей бочки рвутся волной, одна за
   * другой, и это видно. Мгновенная цепь слилась бы в один хлопок.
   *
   * Каждая следующая взрывается через `explode`, то есть сама поджигает своих
   * соседей — так цепочка и тянется через всю кучу. Дважды одно и то же не
   * рванёт: `explode` первым делом смотрит, на месте ли вещь.
   */
  _chain(at, player) {
    const CFG = CONFIG.explosion;

    const соседи = this.debris.items.filter((item) => item.explosive && !item.held
      && flatDistance(item.object.position, at) <= CFG.chainRadius + item.radius);

    соседи.forEach((item, i) => {
      setTimeout(() => this.explode(item, player), (i + 1) * CFG.chainDelay * 1000);
    });
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
   * Пропы, зомби, точка старта, высота пола и круг выхода пишутся поимённо, с
   * координатами: в файле нет ничего, что разыгрывалось бы заново при загрузке,
   * поэтому сохранённое и увиденное всегда совпадают.
   */
  /**
   * Убрать вещь с площадки насовсем. Нужно правке расстановки.
   *
   * Снять со сцены мало: одна и та же модель записана в нескольких местах —
   * контуры столкновений, помеха обзору, физика, коробка для прыжка, список на
   * слияние, наблюдение за просвечиванием. Забудь хоть одно, и на пустом месте
   * останется невидимая стена или предмет, который всё ещё пинается.
   *
   * @param {THREE.Object3D} target — то, что выбрано в редакторе
   * @returns {boolean} нашлось ли, что убирать
   */
  removeObject(target) {
    const entry = this.placed.find((one) => one.object === target);
    if (!entry) return false;

    // У подвижной вещи по сцене ездит контейнер, а контуры сняты с самой модели.
    const shaped = entry.shaped ?? target;

    this.obstacles.forget(shaped);
    this.sight.forget(shaped);
    this.seeThrough?.forget(shaped);

    const body = this.debris.items.find((item) => item.object === target);
    if (body) this.debris.remove(body);

    this.vaults = this.vaults.filter((box) => box.owner !== shaped);
    this.statics = this.statics.filter((one) => one !== shaped);
    this.watched = this.watched.filter((one) => one !== shaped);
    this.placed = this.placed.filter((one) => one !== entry);

    target.removeFromParent();
    this._renav();
    return true;
  }

  /**
   * Пересчитать проходимость после правки расстановки.
   *
   * В игре локация после сборки не меняется, и сетка считается один раз. А в
   * правке предметы ставят и убирают руками — и без пересчёта зомби продолжали
   * обходить снесённую стену и ходили сквозь только что поставленную.
   */
  _renav() {
    if (!this.built || this.batched) return; // сборка считает сетку сама, в игре она не меняется
    this.nav.build(this.obstacles, CONFIG.zombies.radius);
    this._navAge = Infinity;
  }

  /**
   * Сделать копию вещи или зомби. Нужно правке расстановки.
   *
   * Копия встаёт ровно туда же, где стоит исходник, и редактор сразу берётся за
   * неё. Дальше её оттаскивают гизмо — и это правильный порядок: куда именно
   * ставить вторую такую же, знает тот, кто расставляет, а не игра.
   *
   * @param {THREE.Object3D} target — то, что выбрано в редакторе
   * @returns {THREE.Object3D|null} копия, чтобы редактор сразу за неё взялся
   */
  copyObject(target) {
    const zombie = this.zombies.find((one) => one.root === target);
    if (zombie) {
      const copy = this._addZombie(
        zombie.kind,
        zombie.position.x, zombie.position.z,
        zombie.root.rotation.y, Math.random()
      );
      return copy?.root ?? null;
    }

    const entry = this.placed.find((one) => one.object === target);
    if (!entry) return null;

    // Из чего копия: берём то, что видно на сцене сейчас, а не строку из файла —
    // вещь могли только что подвинуть и повернуть, и копия должна это повторить.
    const com = entry.com;
    const prefab = this.prefabs.get(entry.entry.prop);

    /**
     * Поворот и размер снимаются с того же узла, что и точка, — с `target`.
     *
     * У подвижной вещи это не сама модель, а контейнер вокруг неё: поворот при
     * сборке переезжает на него, а модель внутри остаётся стоять прямо. Гизмо в
     * правке цепляется тоже за контейнер. Раньше здесь читалась модель, и копия
     * развёрнутой бочки вставала неразвёрнутой, а растянутая копировалась
     * обычного размера.
     */
    const copy = {
      prop: entry.entry.prop,
      at: [
        round(target.position.x - (com?.x ?? 0)),
        round(target.position.z - (com?.z ?? 0)),
      ],
      rotation: yawOf(target),
      y: round(target.position.y - (com?.y ?? 0) + sinkOf(prefab)),
      scale: [round(target.scale.x), round(target.scale.y), round(target.scale.z)],
    };

    if (!copy.rotation) delete copy.rotation;
    if (Math.abs(copy.y) < 1e-3) delete copy.y;
    if (copy.scale.every((v) => Math.abs(v - 1) < 1e-3)) delete copy.scale;

    return this.addProp(copy);
  }

  /**
   * Убрать зомби. Отдельно от вещей: у него свой скелет, и снять его со сцены
   * мало — текстура костей осталась бы в видеопамяти.
   *
   * @param {THREE.Object3D} root — корень его модели
   * @returns {boolean} нашёлся ли такой
   */
  removeZombie(root) {
    const zombie = this.zombies.find((one) => one.root === root);
    if (!zombie) return false;

    zombie.dispose();
    this.zombies = this.zombies.filter((one) => one !== zombie);
    if (zombie === this.boss) this.boss = null;
    return true;
  }

  snapshot(player = null) {
    const props = this.placed.map(({ object, com, entry }) => {
      // У физического предмета начало координат сидит в центре масс, а в файле
      // хранится точка, из которой его ставят. Сдвиг снимаем обратно — иначе вся
      // мелочь съезжает в центр карты и уходит под землю.
      const x = object.position.x - (com?.x ?? 0);
      const z = object.position.z - (com?.z ?? 0);
      // настилы лежат утопленными — в файл пишем высоту так, будто их не топили
      const y = object.position.y - (com?.y ?? 0) + sinkOf(this.prefabs.get(entry.prop));

      const saved = { prop: entry.prop, at: [round(x), round(z)] };

      // Метка «это снесёт толпа» — не геометрия, а роль вещи на уровне. Гизмо её
      // не касается, но и потерять её нельзя: без неё сохранённое из редактора
      // заграждение превращается в обычный неразрушимый забор.
      if (entry.breach) saved.breach = true;

      const yaw = yawOf(object);
      if (yaw) saved.rotation = yaw;
      if (Math.abs(y) > 1e-3) saved.y = round(y);
      // Оси сохраняем порознь, если их растянули по-разному. Раньше уезжала одна
      // и та же цифра на все три, и стена, растянутая только вдоль, после
      // перезагрузки оказывалась ещё и вдвое толще и выше.
      //
      // У клинка размер общий на всю игру и в файл не уходит вовсе: иначе
      // случайная правка гизмо на одной локации развела бы его с остальными.
      const s = object.scale;
      const uniform = Math.abs(s.x - s.y) < 1e-3 && Math.abs(s.x - s.z) < 1e-3;

      if (CONFIG.blades.props.includes(entry.prop)) {
        // ничего не пишем: размер берётся из настроек
      } else if (uniform) {
        if (Math.abs(s.x - 1) > 1e-3) saved.scale = round(s.x);
      } else {
        saved.scale = [round(s.x), round(s.y), round(s.z)];
      }
      return saved;
    });

    // Зомби сохраняем там, где они стоят сейчас, — по одной записи на каждого.
    // Поворот, как и у персонажа, снимаем с модели: в правке её крутит гизмо.
    const zombies = this.zombies.map((zombie) => ({
      kind: zombie.kind,
      at: [round(zombie.position.x), round(zombie.position.z)],
      rotation: yawOf(zombie.root),
    }));

    // Точка старта — там, где персонаж стоит сейчас: в правке его двигают тем же
    // гизмо, что и всё остальное, и незачем разносить это по разным местам.
    // Поворот берём у самой модели, а не из поля `yaw`: гизмо крутит объект на
    // сцене, и поле о его правках не знает.
    const spawn = player
      ? {
        position: [round(player.position.x), round(player.position.z)],
        rotation: yawOf(player.root),
      }
      : this.data.spawn;

    // Область перехода: центр и радиус читаем прямо с метки.
    const exitAt = this.exitMark
      ? [round(this.exitMark.position.x), round(this.exitMark.position.z),
        round(this.exitMark.scale.x), round(this.exitMark.scale.z)]
      : this.data.exitAt;

    // Вехи правятся так же: в файл уходит то место, куда их подвинули.
    const guide = this.guideMarks.length
      ? this.guide.map((mark, i) => {
        const spot = this.guideMarks[i] ?? mark.mark;
        // Радиус — третьим числом, как у выхода: гизмо растягивает саму метку.
        const saved = {
          at: [round(spot.position.x), round(spot.position.z),
            round(spot.scale.x), round(spot.scale.y)],
        };
        if (!mark.halo) saved.halo = false;
        return saved;
      })
      : this.data.guide;

    // Место под ружьё правится тем же гизмо: в файл уходит точка, где оно лежит.
    const gun = this.gunMark
      ? { ...this.data.gun, at: [round(this.gunMark.position.x), round(this.gunMark.position.z)] }
      : this.data.gun;

    // И коробка патронов — тем же способом.
    const ammo = this.ammoMark
      ? { ...this.data.ammo, at: [round(this.ammoMark.position.x), round(this.ammoMark.position.z)] }
      : this.data.ammo;

    // Пол тоже правится мышью: в файл уходит та высота, на которой он стоит.
    const ground = { ...this.data.ground, y: round(this.ground.position.y) };

    const data = { ...this.data, ground, spawn, props, zombies };
    if (exitAt) data.exitAt = exitAt;
    if (gun) data.gun = gun;
    if (ammo) data.ammo = ammo;
    if (guide?.length) data.guide = guide;

    return data;
  }

  /**
   * Метка выхода — круг, по которому уровень и сменяется.
   *
   * В игре её не видно: место перехода игрок узнаёт по стрелке под ногами, а
   * круг на полу дублировал её и при этом то появлялся, то пропадал — он гаснет
   * вместе с запертым выходом и тонет под настилом. Логика при этом целиком его:
   * и центр, и радиус читаются отсюда.
   *
   * Видимой она становится только в правке расстановки: там её двигают гизмо, а
   * невидимое мышью не поймать.
   *
   * Радиус задаётся размером метки: растянули гизмо — вырос и сам триггер.
   */
  _buildExitMark() {
    const spot = this.data.exitAt;
    if (!spot) return;

    const at = new THREE.Vector3(spot[0], 0, spot[1]);

    // Область перехода тянется по осям порознь: вытянутой поперёк прохода её и
    // перекрывают. Третье число — полуось по X, четвёртое по Z; уровни, где
    // число одно, читаются как круг.
    const alongX = spot[2] ?? 3;
    const alongZ = spot[3] ?? alongX;
    const CFG = CONFIG.exit;

    /**
     * Метка выхода: заливка и кольцо по краю.
     *
     * Одной заливки мало — на светлом асфальте она теряется, а на тёмном полу
     * её принимают за пятно света. Кольцо же читается как проведённая черта:
     * видно, где именно кончается уровень.
     *
     * Обе части лежат в одной группе: снаружи метка остаётся одной вещью —
     * её двигают гизмо, по ней же считают, дошёл ли герой.
     */
    const mark = new THREE.Group();

    // `DoubleSide` обязателен: круг лежит на земле, и стоит камере качнуться —
    // односторонний полигон пропадает целиком, будто метки и не было.
    const flat = (color) => new THREE.MeshBasicMaterial({
      color, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    });

    const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 48), flat(CFG.color));
    disc.rotation.x = -Math.PI / 2;

    const ring = new THREE.Mesh(new THREE.RingGeometry(1 - CFG.ringWidth, 1, 48), flat(CFG.ringColor));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01; // на волос выше заливки, чтобы не спорили за глубину

    mark.add(disc, ring);
    mark.userData.parts = { disc, ring };

    mark.name = 'exit';

    /**
     * Круг видно и в игре.
     *
     * Раньше он был только в правке расстановки: место перехода игрок узнавал
     * по стрелке под ногами. Но стрелка показывает направление, а не черту, и у
     * самого проёма гаснет — и было непонятно, где именно кончается уровень.
     * Теперь под выходом лежит пятно, и промахнуться мимо него нельзя.
     */
    mark.visible = true;
    mark.position.copy(at).setY(0.06);
    mark.scale.set(alongX, 1, alongZ);

    // Поверх настила и дорожной плитки, но ниже гизмо.
    //
    // Число тут важнее, чем кажется. Метка полупрозрачна и не пишет глубину,
    // поэтому три.js рисует её в конце, вместе со всем прозрачным, — то есть
    // ПОСЛЕ гизмо. А тот рисуется без проверки глубины, чтобы его было видно
    // сквозь стены; значит всё, что ляжет поверх, его закрасит. Отрицательный
    // порядок ставит метку впереди всей прозрачной очереди, и гизмо остаётся
    // сверху.
    mark.renderOrder = -1;

    for (const part of mark.children) {
      part.castShadow = false;
      part.receiveShadow = false;
      part.renderOrder = -1;
    }

    this.group.add(mark);
    this.exitMark = mark;
  }

  /**
   * Вехи: точки, через которые указатель ведёт героя по дороге к выходу.
   *
   * Нужны там, где важно не только куда прийти, но и что по пути заметить: на
   * вводной это диван, за которым можно укрыться. Стрелка показывает на веху
   * так же, как на лежащее ружьё, — с кругом на полу, — а стоит подойти, и она
   * переходит к следующей цели.
   *
   * Живут они в файле уровня, а не в коде: добавить ещё одну значит дописать
   * точку в `guide`, и она встанет в очередь сама.
   */
  _buildGuide() {
    this.guideMarks = [];

    this.guide = (this.data.guide ?? []).map((spot, i) => ({
      /**
       * Насколько близко надо подойти, чтобы веха засчиталась.
       *
       * Своё у каждой и хранится в файле третьим числом, как у выхода. Раньше
       * тут было одно число на всю игру, и растянутая гизмо веха срабатывала
       * по-прежнему — с чего бы её ни тянули.
       */
      alongX: spot.at[2] ?? CONFIG.pointer.reachWithin,
      alongZ: spot.at[3] ?? spot.at[2] ?? CONFIG.pointer.reachWithin,
      // Своя точка на сцене, а не ссылка на проп: веха может стоять и там, где
      // ничего не расставлено, — на перекрёстке, у поворота.
      at: new THREE.Vector3(spot.at[0], 0, spot.at[1]),

      /**
       * Круг под вехой: есть не у всякой.
       *
       * У той, что показывает вещь, он нужен — это «вот она». А у поворотной
       * его быть не должно: там на полу ничего нет, и светящийся круг посреди
       * пустого коридора читается как «встань сюда», хотя вставать незачем.
       */
      halo: spot.halo !== false,
      done: false,

      /**
       * Метка на сцене: видна только в правке расстановки.
       *
       * Без неё вехи были невидимыми точками из файла: поставить их можно было
       * только числами, а проверить — лишь запустив уровень и пройдя его. В
       * правке же они выглядят как маленькие круги, которые двигают гизмо.
       */
      mark: this.batched ? null : this._guideMark(spot, i),
    }));
  }

  /** Кружок вехи для правки расстановки. */
  _guideMark(spot, index) {
    const CFG = CONFIG.exit;

    const mark = new THREE.Mesh(
      new THREE.CircleGeometry(1, 32),
      new THREE.MeshBasicMaterial({
        color: CFG.guideColor,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      })
    );

    const alongX = spot.at[2] ?? CONFIG.pointer.reachWithin;
    const alongZ = spot.at[3] ?? alongX;

    mark.name = `guide:${index + 1}`;
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(spot.at[0], 0.07, spot.at[1]);
    // Размер метки — это и есть область срабатывания, по каждой оси свой. Меш
    // лежит плашмя, поэтому его Y — это мировой Z.
    mark.scale.set(alongX, alongZ, 1);
    mark.renderOrder = -1; // ниже гизмо, как и метка выхода
    mark.castShadow = false;
    mark.receiveShadow = false;

    this.group.add(mark);
    this.guideMarks.push(mark);
    return mark;
  }

  /**
   * Отметить пройденными все вехи, до которых герой дошёл.
   *
   * @param {THREE.Vector3} p — где он сейчас
   * @returns {boolean} изменилось ли что-нибудь: по этому пересобирают очередь
   */
  reachGuide(p) {
    let changed = false;

    for (let i = 0; i < this.guide.length; i++) {
      const mark = this.guide[i];
      if (mark.done) continue;

      /**
       * Только по кругу вехи — и ничему больше.
       *
       * Здесь была поблажка: веху засчитывало, если герой оказался ближе к
       * следующей цели, то есть обошёл её стороной. Она и обесценивала весь
       * смысл растяжения — как круг ни тяни, веха могла сработать на подходе.
       *
       * Раз размер задают гизмо, он и решает: растянутая поперёк прохода веха
       * работает как заслон, мимо которого не проскочить.
       */
      // Плюс само тело героя: засчитывается по касанию края, а не когда он
      // влез внутрь целиком.
      const alongX = mark.mark ? mark.mark.scale.x : mark.alongX;
      const alongZ = mark.mark ? mark.mark.scale.y : mark.alongZ;

      if (inside(p, mark.at, alongX, alongZ, CONFIG.player.radius)) {
        mark.done = true;
        changed = true;
      }
    }
    return changed;
  }

  /**
   * Пульс круга под выходом: он дышит, чтобы читаться как живая метка, а не
   * как пятно на земле. Зовётся каждый кадр из общего хода локации.
   */
  _pulseExit(dt) {
    const parts = this.exitMark?.userData.parts;
    if (!parts) return;

    this._exitTime = (this._exitTime ?? 0) + dt;

    const CFG = CONFIG.exit;
    const beat = Math.sin(this._exitTime * CFG.pulseSpeed) * CFG.pulse;
    const share = this.exitLocked ? CFG.lockedShare : 1;

    parts.disc.material.opacity = (CFG.fillOpacity + beat) * share;
    parts.ring.material.opacity = (CFG.ringOpacity + beat) * share;
  }

  /**
   * Дошёл ли персонаж до выхода.
   *
   * Выход — круг: у извилистой улицы «сторона света» смысла не имеет, есть
   * просто место, куда надо дойти. Считаем по самой метке, её и двигают в
   * редакторе, так что радиус триггера всегда совпадает с тем, что видно.
   */
  reachedExit(p) {
    if (!this.exitMark || this.exitLocked) return false;

    // Во что метку растянули гизмо, то и есть область перехода: по каждой оси
    // свой размер. Плюс тело героя — срабатывает по касанию края.
    return inside(p, this.exitMark.position, this.exitMark.scale.x, this.exitMark.scale.z,
      CONFIG.player.radius);
  }

  /**
   * Запереть или отпереть выход.
   *
   * Кто и когда запирает, решает игра: невзятое ружьё на вводной локации выход
   * больше не держит, вожак и зачистка держат всегда.
   *
   * В игре запор ничего не рисует: круга на полу не видно, а куда идти, говорит
   * стрелка — она и молчит, пока выход заперт. Тускнеет метка только в правке
   * расстановки, где её видно.
   *
   * @param {boolean} locked
   */
  lockExit(locked) {
    this.exitLocked = locked;
    // Прозрачность ставит `_pulseExit` каждый кадр: здесь её трогать незачем.
  }

  /**
   * Не пускает за край площадки: держит точку внутри прямоугольника.
   *
   * Проёма в этой рамке нет и не нужно: наружу выводит не дыра в заборе, а
   * круг выхода, и стоит он внутри площадки.
   *
   * @param {THREE.Vector3} p — правится на месте
   */
  clampPosition(p) {
    const m = 0.6; // отступ от забора, чтобы персонаж не влезал в столбы
    const halfW = this.width / 2 - m;
    const halfD = this.depth / 2 - m;

    p.x = Math.min(Math.max(p.x, -halfW), halfW);
    p.z = Math.min(Math.max(p.z, -halfD), halfD);

    return p;
  }

  dispose() {
    this.group.removeFromParent();

    // Зомби живут не дольше своей локации. Снять их со сцены мало: у каждого
    // свой скелет, а под скелет отведена текстура в видеопамяти, и без этого
    // она остаётся там навсегда — с каждым перезапуском уровня всё больше.
    for (const zombie of this.zombies) zombie.dispose();
    this.zombies.length = 0;

    // Слитая геометрия принадлежит локации — её больше никто не переиспользует.
    // Сюда идут и общий меш неподвижного, и ряды крупного: ряды рождаются тем же
    // слиянием, и без этого каждый перезапуск уровня оставлял их в видеопамяти.
    for (const batch of this.merged) batch.traverse((o) => o.isMesh && o.geometry.dispose());
    this.merged.length = 0;

    // Освобождаем только то, что создала сама локация: пол, метку выхода и
    // мглу по краям. Геометрия и материалы пропов общие с библиотекой — их
    // трогать нельзя, иначе следующая локация соберётся из уже выброшенного.
    //
    // Обходом, а не напрямую: метка выхода — не меш, а группа из заливки и
    // кольца, и своих геометрии с материалом у неё нет вовсе.
    for (const own of [this.ground, this.exitMark, this.fog, ...this.guideMarks]) {
      own?.traverse((node) => {
        if (!node.isMesh) return;

        node.geometry.dispose();
        node.material.dispose();
      });
    }
  }
}


