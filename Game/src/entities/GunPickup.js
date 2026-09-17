import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { flatDistance } from '../core/ground.js';
import { arcPoint } from '../core/arc.js';


/**
 * Ружьё, лежащее на уровне: подошёл — подобрал, и дальше играешь со стрельбой.
 *
 * Стоит оно у самого выхода вводной локации, прямо на дороге, так что мимо не
 * пройти: пока не поднял, уровень не кончится. В этом и смысл — вся вводная
 * часть проходится без оружия, одними бросками, а ружьём она награждает.
 *
 * Модель не своя: берётся то же gun, что висит у персонажа за спиной. Значит
 * поднятое и то, чем он потом стреляет, — одна и та же вещь, и заводить под
 * пикап отдельный файл не нужно.
 *
 * Летит к герою по дуге, той же самой, по которой он сам перепрыгивает машины:
 * общая на всю игру, лежит в `core/arc.js`.
 *
 * Живёт оно в группе своего уровня: так его видит правка расстановки, и так оно
 * уходит вместе с уровнем, не переживая его.
 */
export class GunPickup {
  /**
   * @param {THREE.Scene} scene
   * @param {object} [config] — как вещь висит, крутится и летит. Своё у каждой
   *   лежащей вещи: патроны мельче ружья и висят ниже
   */
  constructor(scene, config = CONFIG.gunPickup) {
    this.scene = scene;
    this.config = config;
    this.object = null;   // меш на сцене, пока gun лежит
    this.time = 0;        // сколько уже крутится: по нему вращение и покачивание
    this.flight = 0;      // сколько длится полёт к герою; ноль — ещё лежит
    this.from = new THREE.Vector3();
    this.to = new THREE.Vector3();
    this.onTaken = null;  // кому сказать, что gun поднято
    this.location = null; // чей это уровень: у него же снимается метка
    this.editing = false; // в правке расстановки ружьё лежит смирно
  }

  /**
   * Положить gun на уровень, если оно там и должно лежать.
   *
   * Не кладётся дважды: у кого gun уже есть, тому и поднимать нечего — иначе
   * после смерти на этой же локации оно появлялось бы снова и снова.
   *
   * @param {import('../world/Location.js').Location} location
   * @param {import('./Player.js').Player} player — у него и берётся модель
   */
  place(location, player, editing = false) {
    const CFG = this.config;
    this.clear();

    const spot = this._spot(location)?.at;
    if (!spot) return;

    // Подобранное ружьё на полу больше не лежит — иначе после смерти на этой же
    // локации оно появлялось бы снова и снова. Но в правке расстановки оно
    // нужно всегда: иначе место, куда его класть, было бы не подвинуть.
    if (this._taken(player) && !editing) return;

    const gun = this._model(location, player);
    if (!gun) return;

    // Собственное положение копии сбрасывается: ружьё в модели сидит на кости
    // руки и несёт её разворот, а нам нужна вещь, лежащая сама по себе.
    gun.name = this._name;
    // Покачивание начинается с нуля, а не с той фазы, до которой игра докрутила
    // с прошлого раза: иначе после перезапуска уровня ружьё появлялось в
    // случайной точке синусоиды и могло родиться ниже пола.
    this.time = 0;
    gun.position.set(spot[0], CFG.height, spot[1]);
    gun.rotation.set(0, 0, 0);
    gun.scale.setScalar(CFG.scale);

    // У образца вся группа скрыта — он же за спиной у безоружного. Копию,
    // наоборот, видно, и тень она бросает.
    gun.visible = true;
    gun.traverse((node) => {
      node.visible = true;
      if (node.isMesh) node.castShadow = true;
    });

    // Кладём в группу локации, а не прямо в сцену: правка расстановки ищет
    // предметы лучом именно по ней, и лежащее мимо неё мышью не поймать. Заодно
    // ружьё уходит вместе с уровнем, когда тот сменяется.
    location.group.add(gun);
    this.object = gun;

    // Метка на самой локации: по ней правка расстановки узнаёт ружьё среди
    // прочего, а сохранение уровня забирает точку, куда его положили мышью.
    // Без неё сдвинутое ружьё возвращалось на старое место при следующей
    // загрузке — в файл уходила прежняя запись.
    this.location = location;
    this.editing = editing;
    location[this._mark] = gun;
  }

  // ─── чем одна лежащая вещь отличается от другой ─────────────────────────────

  /** Имя на сцене и имя метки на локации: по метке её узнаёт правка. */
  get _name() { return 'gun:pickup'; }
  get _mark() { return 'gunMark'; }

  /** Запись в файле уровня: где лежит. */
  _spot(location) { return location.data.gun; }

  /** Уже взято: класть незачем. */
  _taken(player) { return player.armed; }

  /**
   * Своя копия ружья.
   *
   * Копируется целиком узел, а не один меш: ружьё собрано из нескольких частей
   * — ствол, цевьё, приклад, — и лежит в модели персонажа отдельной группой.
   * Геометрия и материалы при этом остаются общими, копируются только узлы.
   */
  _model(location, player) {
    const sample = player.gun ?? player.gunOnBack;
    return sample ? sample.clone(true) : null;
  }

  /** Долетело до героя. */
  _give(player) { player.arm(); }

  /** Убрать со сцены. Геометрия и материал общие с персонажем — их не трогаем. */
  clear() {
    this.object?.removeFromParent();

    if (this.location?.[this._mark] === this.object) this.location[this._mark] = null;

    this.object = null;
    this.location = null;
    this.flight = 0;
  }

  /**
   * @param {number} dt
   * @param {import('./Player.js').Player} player
   */
  update(dt, player) {
    const CFG = this.config;
    if (!this.object) return;

    this.time += dt;

    // В правке расстановки ружьё не живёт своей жизнью: не крутится, не
    // покачивается и не прыгает в руки подошедшему. Крутящуюся вещь не поймать
    // гизмо, а улетевшая к герою просто исчезла бы со сцены вместе с местом,
    // которое и надо было подвинуть.
    if (this.editing) return;

    if (this.flight > 0) {
      // Погиб на подлёте — ружьё остаётся лежать. Долетев до тела, оно
      // вооружало покойника и отпирало выход, хотя уровень уже начинался заново.
      if (!player.alive) {
        this.object.position.copy(this.from);
        this.object.scale.setScalar(CFG.scale);
        this.flight = 0;
        return;
      }

      this._fly(dt, player);
      return;
    }

    // Крутится и покачивается: неподвижная вещь на полу читается как часть
    // обстановки, а эта — то, за чем идут.
    this.object.rotation.y = this.time * CFG.spin;
    this.object.position.y = CFG.height + Math.sin(this.time * CFG.bobSpeed) * CFG.bob;


    if (!player.alive || player.frozen) return;
    // Плюс само тело героя: вещь берётся, когда он её коснулся, а не когда
    // встал на неё серединой. Правило одно на все круги в игре — веха, выход,
    // подбираемое.
    const reach = CFG.takeRadius + CONFIG.player.radius;
    if (flatDistance(player.position, this.object.position) > reach) return;

    // Подошёл: gun отрывается от земли и летит к нему.
    this.flight = Number.EPSILON;
    this.from.copy(this.object.position);
    player.sfx?.play('reloading', CFG.volume);
  }

  /** Полёт к герою. Цель берётся каждый кадр: он может идти дальше. */
  _fly(dt, player) {
    const CFG = this.config;
    this.flight += dt;

    const share = Math.min(1, this.flight / CFG.flyFor);

    this.to.copy(player.position).setY(player.position.y + CFG.catchHeight);

    arcPoint(this.object.position, this.from, this.to, share, CFG.flyArc);
    this.object.rotation.y += CFG.flySpin * dt;

    // Ружьё тает на подлёте: вот оно летит, вот уже за спиной у героя.
    const left = 1 - share;
    this.object.scale.setScalar(CFG.scale * (CFG.endScale + (1 - CFG.endScale) * left));

    if (share < 1) return;

    this.clear();
    this._give(player);
    this.onTaken?.();
  }
}
