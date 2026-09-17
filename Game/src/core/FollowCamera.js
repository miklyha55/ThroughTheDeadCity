import * as THREE from 'three';
import { CONFIG } from '../config.js';

const CFG = CONFIG.camera;
const DEG = Math.PI / 180;

/**
 * Изометрическая камера: жёсткий угол обзора, движется только следом за целью.
 * Ракурс задан парой yaw/pitch из конфига — классические 45° / 30°.
 */
export class FollowCamera {
  constructor(camera, target) {
    this.camera = camera;
    this.target = target;
    this.yaw = CFG.yaw * DEG;
    this.pitch = CFG.pitch * DEG;

    // смещение камеры от цели — постоянное, меняется только точка, за которой следим
    const horizontal = Math.cos(this.pitch) * CFG.distance;
    this._offset = new THREE.Vector3(
      Math.sin(this.yaw) * horizontal,
      Math.sin(this.pitch) * CFG.distance,
      Math.cos(this.yaw) * horizontal
    );

    this.orbit = 0; // доворот вокруг цели: копится, пока персонаж мёртв

    this._focus = new THREE.Vector3().copy(target.position).setY(CFG.lookAtHeight);

    // Всё, что читает кадр, заводится до первого кадра. `shake` может прийти
    // раньше, чем `update` случится впервые — например от бочки, рванувшей на
    // загрузке уровня, — и читать ей тогда было бы нечего.
    this._desiredFocus = new THREE.Vector3();
    this._shake = 0;      // сколько тряски осталось, с
    this._shakeFor = 1;   // за сколько она затухает
    this._shakePower = 0; // и с какой амплитуды начиналась
    this._show = null;    // пролёт к чему-то другому и обратно: { at, time }
    this._from = new THREE.Vector3();
    this._there = new THREE.Vector3();

    // Дальше камеру ведёт только `update`: облёт погибшего и тряска живут там.
    // Здесь их не повторяем — кадра ещё не было, и вычитать из него нечего.
    this.camera.position.copy(this._focus).add(this._offset);
    this.camera.lookAt(this._focus);
  }

  /**
   * Тряхнуть камеру. Сильные толчки не складываются, а перебивают слабые:
   * два взрыва подряд не должны раскачивать кадр вдвое.
   */
  shake(power, seconds) {
    if (power <= this._shakePower && this._shake > 0) return;
    this._shake = seconds;
    this._shakeFor = seconds;
    this._shakePower = power;
  }

  /**
   * Сдвинуть взгляд по земле, не меняя ракурса. Нужно правке локации: там
   * камера не следит за персонажем, а гуляет сама.
   *
   * Сдвиг задаётся в осях экрана — «вправо» значит вправо для зрителя, а не по
   * оси мира: иначе стрелки на изометрии вели бы наискосок.
   */
  pan(right, forward) {
    const angle = this.moveYaw;

    // «Вправо» — векторное произведение «вперёд» на «вверх»; знаки именно такие,
    // иначе стрелки влево и вправо меняются местами.
    this._focus.x += Math.sin(angle) * forward - Math.cos(angle) * right;
    this._focus.z += Math.cos(angle) * forward + Math.sin(angle) * right;

    this.camera.position.copy(this._focus).add(this._offset);
    this.camera.lookAt(this._focus);
  }

  /**
   * Поставить камеру на цель сразу, без плавного подхода.
   *
   * Нужно при смене уровня: персонаж возникает в новом месте, а камера осталась
   * там, где была, и вместо готового кадра игрок видит долгий перелёт через всю
   * карту. Догонять имеет смысл бегущего, а не телепортированного.
   */
  snap() {
    this._focus.copy(this.target.position).setY(this.target.position.y + CFG.lookAtHeight);

    // Возвращаем ракурс, с которого игра и начинается. Облёт погибшего крутит
    // смещение камеры вокруг цели, и без этого уровень начинался бы заново с
    // того угла, на котором оборвалась прошлая попытка.
    this.orbit = 0;
    this._setAngle(this.yaw);

    this.camera.position.copy(this._focus).add(this._offset);
    this.camera.lookAt(this._focus);
  }

  /**
   * Развернуть камеру вокруг того, на что она смотрит. Нужно правке локации:
   * с одного ракурса не видно, что творится за домами и с их дальней стороны.
   *
   * Поворачивается сам угол обзора, поэтому и стрелки, ведущие камеру по земле,
   * продолжают работать «по экрану»: вправо — вправо для зрителя.
   */
  turn(by) {
    this.yaw += by;
    this._setAngle(this.yaw);

    this.camera.position.copy(this._focus).add(this._offset);
    this.camera.lookAt(this._focus);
  }

  /** Ставит смещение камеры по заданному повороту вокруг цели. */
  _setAngle(angle) {
    const horizontal = Math.cos(this.pitch) * CFG.distance;

    this._offset.set(
      Math.sin(angle) * horizontal,
      Math.sin(this.pitch) * CFG.distance,
      Math.cos(angle) * horizontal
    );
  }

  /** Направление «вперёд по камере» для управления персонажем. */
  get moveYaw() { return this.yaw + Math.PI; }

  /** Идёт ли сейчас пролёт. */
  get showing() { return this._show !== null; }

  /** Идёт ли пролёт, на время которого игра стоит. */
  get pausing() { return this._show?.pause === true; }

  /**
   * Плавно показать что-то другое и вернуться к герою.
   *
   * Камера уезжает на точку, стоит на ней и едет обратно — всё с мягким
   * разгоном и торможением. Ракурс не меняется, только то, куда смотрим.
   *
   * @param {THREE.Vector3} at — что показать; точка читается каждый кадр
   * @param {number} [height] — на какую высоту над ней смотреть, м
   * @param {object} [options]
   * @param {boolean} [options.pause] — стоит ли на это время игра
   * @param {{toFor: number, holdFor: number, backFor: number}} [options.timing] —
   *   свои длительности, если настройки камеры не подходят
   */
  show(at, height = CFG.lookAtHeight, { pause = true, timing = CFG.show } = {}) {
    this._show = { at, height, time: 0, pause, timing };
    this._from.copy(this._focus);
  }

  update(dt) {
    this._desiredFocus.copy(this.target.position).setY(this.target.position.y + CFG.lookAtHeight);

    if (this._show) {
      this._showStep(dt);
      return;
    }

    // Линейно: камера идёт к цели с постоянной скоростью и останавливается,
    // как только пришла. Затухание оставляло бы за персонажем шлейф — кажется,
    // будто он продолжает бежать после того, как встал.
    this._focus.sub(this._desiredFocus);
    const away = this._focus.length();

    if (away <= CFG.followSpeed * dt) this._focus.set(0, 0, 0);
    else this._focus.multiplyScalar(1 - (CFG.followSpeed * dt) / away);

    this._focus.add(this._desiredFocus);

    this.camera.position.copy(this._focus).add(this._offset);

    // Погиб — камера идёт по кругу, не отводя от него взгляда. Ракурс при этом
    // остаётся тем же: меняется только сторона, с которой мы смотрим.
    if (this.target.alive === false) {
      this.orbit += CFG.orbitSpeed * dt;
      this._setAngle(this.yaw + this.orbit);
      this.camera.position.copy(this._focus).add(this._offset);
    }

    this._shakeStep(dt);
    this.camera.lookAt(this._focus);
  }

  /**
   * Тряска смещает саму камеру, а не точку интереса: кадр дёргается, но
   * продолжает смотреть туда же, и после затухания встаёт ровно как был.
   *
   * Отдельным шагом, потому что трясти надо и во время пролёта. Раньше пролёт
   * шёл своей веткой, мимо тряски, — и толчок от рухнувших ворот, заказанный
   * ровно в миг прорыва, копился впустую и выплёскивался секундой позже, когда
   * камера возвращалась к герою.
   */
  _shakeStep(dt) {
    if (this._shake <= 0) return;

    this._shake = Math.max(0, this._shake - dt);

    const left = this._shake / this._shakeFor;
    const amount = this._shakePower * left * left; // к концу затихает мягко

    this.camera.position.x += (Math.random() - 0.5) * 2 * amount;
    this.camera.position.y += (Math.random() - 0.5) * 2 * amount;
    this.camera.position.z += (Math.random() - 0.5) * 2 * amount;

    if (this._shake === 0) this._shakePower = 0;
  }

  /** Ход пролёта: туда, постоять, обратно. */
  _showStep(dt) {
    const show = this._show;
    const { toFor, holdFor, backFor } = show.timing;
    show.time += dt;

    this._there.copy(show.at).setY(show.at.y + show.height);

    const smooth = (k) => k * k * (3 - 2 * k);
    const t = show.time;

    if (t < toFor) {
      this._focus.lerpVectors(this._from, this._there, smooth(t / toFor));
    } else if (t < toFor + holdFor) {
      this._focus.copy(this._there);
    } else if (t < toFor + holdFor + backFor) {
      // Обратно — к тому месту, где герой сейчас, а не где он был: цель едет.
      this._focus.lerpVectors(this._there, this._desiredFocus, smooth((t - toFor - holdFor) / backFor));
    } else {
      this._focus.copy(this._desiredFocus);
      this._show = null;
    }

    this.camera.position.copy(this._focus).add(this._offset);
    this._shakeStep(dt);
    this.camera.lookAt(this._focus);
  }
}
