import { CONFIG } from '../config.js';
import { GunPickup } from './GunPickup.js';

const CFG = CONFIG.ammoPickup;

/**
 * Коробка патронов на уровне: подобрал — магазин вмещает больше.
 *
 * Лежит и берётся ровно как ружьё — крутится, покачивается, подошёл — летит в
 * руки. Отличается только тем, что это за вещь и что она даёт, поэтому всё
 * остальное унаследовано.
 *
 * Своя у неё одна особенность: указатель ведёт к ней лишь до тех пор, пока
 * игрок её видит. Прошёл мимо и коробка ушла с экрана — значит решил не брать,
 * и стрелка переключается на следующую цель. Это `skipped`; решает его сцена,
 * по кадру, а коробка только помнит.
 */
export class AmmoPickup extends GunPickup {
  constructor(scene) {
    super(scene, CFG);
    this.seen = false;     // побывала ли на экране с начала уровня
    this.skipped = false;  // ушла с экрана невзятой: указатель про неё забыл
  }

  place(location, player, editing = false) {
    this.seen = false;
    this.skipped = false;
    super.place(location, player, editing);
  }

  get _name() { return 'ammo:pickup'; }
  get _mark() { return 'ammoMark'; }

  _spot(location) { return location.data.ammo; }

  /** Уже взята: магазин и так расширен — второй раз она не появляется. */
  _taken(player) { return player.magazine >= CFG.magazine; }

  /** Модель из общей библиотеки уровня — та, что выделена в Blender. */
  _model(location) { return location.prefabs.create(CFG.model); }

  _give(player) { player.extendMagazine(CFG.magazine); }
}
