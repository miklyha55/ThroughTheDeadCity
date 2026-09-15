import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { flatDistance } from '../core/ground.js';
import { arcPoint } from '../core/arc.js';

const CFG = CONFIG.gunPickup;

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
 */
export class GunPickup {
  constructor(scene) {
    this.scene = scene;
    this.object = null;   // меш на сцене, пока gun лежит
    this.time = 0;        // сколько уже крутится: по нему вращение и покачивание
    this.flight = 0;      // сколько длится полёт к герою; ноль — ещё лежит
    this.from = new THREE.Vector3();
    this.to = new THREE.Vector3();
    this.onTaken = null;  // кому сказать, что gun поднято
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
  place(location, player) {
    this.clear();

    const spot = location.data.gun?.at;
    if (!spot || player.armed) return;

    const sample = player.gun ?? player.gunOnBack;
    if (!sample) return;

    /**
     * Своя копия ружья.
     *
     * Копируется целиком node, а не один меш: gun собрано из нескольких частей
     * — ствол, цевьё, приклад, — и лежит в модели персонажа отдельной группой.
     * Геометрия и материалы при этом остаются общими, копируются только узлы.
     *
     * Собственное положение узла сбрасывается: в модели он сидит на кости руки и
     * несёт её разворот, а нам нужна вещь, лежащая сама по себе.
     */
    const gun = sample.clone(true);
    gun.name = 'gun:pickup';
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

    this.scene.add(gun);
    this.object = gun;
    this.time = 0;
    this.flight = 0;
  }

  /** Убрать со сцены. Геометрия и материал общие с персонажем — их не трогаем. */
  clear() {
    this.object?.removeFromParent();
    this.object = null;
    this.flight = 0;
  }

  /**
   * @param {number} dt
   * @param {import('./Player.js').Player} player
   */
  update(dt, player) {
    if (!this.object) return;

    this.time += dt;

    if (this.flight > 0) {
      this._fly(dt, player);
      return;
    }

    // Крутится и покачивается: неподвижная вещь на полу читается как часть
    // обстановки, а эта — то, за чем идут.
    this.object.rotation.y = this.time * CFG.spin;
    this.object.position.y = CFG.height + Math.sin(this.time * CFG.bobSpeed) * CFG.bob;

    if (!player.alive || player.frozen) return;
    if (flatDistance(player.position, this.object.position) > CFG.takeRadius) return;

    // Подошёл: gun отрывается от земли и летит к нему.
    this.flight = Number.EPSILON;
    this.from.copy(this.object.position);
    player.sfx?.play('reloading', CFG.volume);
  }

  /** Полёт к герою. Цель берётся каждый кадр: он может идти дальше. */
  _fly(dt, player) {
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
    player.arm();
    this.onTaken?.();
  }
}
