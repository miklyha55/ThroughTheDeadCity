import * as THREE from 'three';
import { CONFIG } from '../config.js';

const CFG = CONFIG.debris;

// рабочие векторы, чтобы не мусорить в куче каждый кадр
const _r = new THREE.Vector3();
const _point = new THREE.Vector3();
const _pointVelocity = new THREE.Vector3();
const _tangent = new THREE.Vector3();
const _impulse = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _spin = new THREE.Quaternion();
const _inverse = new THREE.Quaternion();

/**
 * Разлетающаяся мелочь как твёрдое тело: у каждого предмета свой центр масс
 * и тензор инерции, а опора считается по углам, которые реально касаются земли.
 *
 * Благодаря этому вопрос «упасть или устоять» не решается правилом: если центр
 * масс висит за пределами опоры, сила тяжести сама создаёт момент, и предмет
 * опрокидывается — ровно как настоящий. Устойчивая поза так же естественно
 * остаётся устойчивой.
 */
export class Debris {
  constructor(location) {
    this.location = location;
    this.items = [];
    this._before = new THREE.Vector3();
    this._normal = new THREE.Vector3();
  }

  /**
   * @param {THREE.Object3D} object — контейнер, чьё начало координат совпадает с центром масс
   * @param {{boxMin: THREE.Vector3, boxMax: THREE.Vector3, volume: number}} body
   * @param {number} floorY
   */
  add(object, body, floorY) {
    const size = _tmp.copy(body.boxMax).sub(body.boxMin);
    const mass = Math.max(CFG.minMass, body.volume * CFG.density);

    // однородный параллелепипед: этого хватает, чтобы предмет вёл себя правдоподобно
    const ix = (mass / 12) * (size.y * size.y + size.z * size.z);
    const iy = (mass / 12) * (size.x * size.x + size.z * size.z);
    const iz = (mass / 12) * (size.x * size.x + size.y * size.y);

    this.items.push({
      object,
      mass,
      invMass: 1 / mass,
      invInertia: new THREE.Vector3(1 / ix, 1 / iy, 1 / iz),
      boxMin: body.boxMin.clone(),
      boxMax: body.boxMax.clone(),
      radius: Math.max(size.x, size.z) / 2,
      floorY,
      velocity: new THREE.Vector3(),
      angular: new THREE.Vector3(),
      idle: 0,
      asleep: true,
    });
  }

  /**
   * @param {number} dt
   * @param {Array<{position: THREE.Vector3, radius: number, speed: number}>} movers —
   *   все, кто может задеть предмет: персонаж и зомби
   */
  update(dt, movers) {
    for (const item of this.items) {
      for (const mover of movers) {
        if (!mover) continue;
        this._crush(item, mover);
        this._kick(item, mover.position, mover.radius, mover.speed);
      }
      if (item.asleep) continue;

      this._integrate(item, dt);
      for (let i = 0; i < CFG.iterations; i++) this._resolveGround(item);
      this._liftFromFloor(item);
      this._collideWalls(item);
      this._checkSleep(item, dt);
    }
    this._separate();
  }

  /**
   * Разогнанный предмет насмерть сбивает того, в кого прилетел.
   *
   * Проверяется до пинка: важна та скорость, с которой предмет подлетел, а не
   * та, что он получит от касания. Спящий предмет безопасен по определению, а
   * лёгкую мелочь не засчитываем совсем — жестянка, как её ни разгони, никого
   * не убьёт. Кто именно попался, физика не знает: достаточно, что он умеет
   * `crush`, — персонаж такого метода не имеет и потому цел.
   */
  _crush(item, mover) {
    if (item.asleep || typeof mover.crush !== 'function') return;
    if (item.mass < CFG.lethalMass || item.velocity.length() < CFG.lethalSpeed) return;

    const position = item.object.position;
    const dx = position.x - mover.position.x;
    const dz = position.z - mover.position.z;
    if (Math.hypot(dx, dz) > item.radius + mover.radius) return;

    mover.crush(position);
  }

  /** Пинок прилетает в бок предмета, а не в центр — потому он ещё и закручивается. */
  _kick(item, moverPosition, moverRadius, moverSpeed) {
    const position = item.object.position;
    let dx = position.x - moverPosition.x;
    let dz = position.z - moverPosition.z;
    const distance = Math.hypot(dx, dz);
    const touch = item.radius + moverRadius;
    if (distance > touch) return;

    if (distance > 1e-4) {
      dx /= distance;
      dz /= distance;
    } else {
      dx = 1;
      dz = 0;
    }

    const share = CFG.minKickShare + (1 - CFG.minKickShare) * Math.min(1, moverSpeed / CONFIG.player.runSpeed);
    const power = CFG.kick * share * item.mass;

    // точка приложения — на уровне ноги, сбоку предмета
    _point.set(-dx * item.radius, Math.max(item.boxMin.y, -item.radius) * 0.5, -dz * item.radius);
    _impulse.set(dx * power, CFG.lift * item.mass * share, dz * power);

    this._applyImpulse(item, _impulse, _point);
    item.asleep = false;
    item.idle = 0;

    position.x = moverPosition.x + dx * touch;
    position.z = moverPosition.z + dz * touch;
  }

  /** Импульс в точке r (относительно центра масс) — меняет и скорость, и вращение. */
  _applyImpulse(item, impulse, r) {
    item.velocity.addScaledVector(impulse, item.invMass);
    _tmp.crossVectors(r, impulse);
    item.angular.add(this._applyInvInertia(item, _tmp));
  }

  /** Умножение на обратный тензор инерции: переводим в оси тела и обратно. */
  _applyInvInertia(item, vector) {
    _inverse.copy(item.object.quaternion).invert();
    vector.applyQuaternion(_inverse);
    vector.multiply(item.invInertia);
    return vector.applyQuaternion(item.object.quaternion);
  }

  _integrate(item, dt) {
    item.velocity.y -= CFG.gravity * dt;
    item.velocity.multiplyScalar(Math.exp(-CFG.linearDamping * dt));
    item.angular.multiplyScalar(Math.exp(-CFG.angularDamping * dt));

    item.object.position.addScaledVector(item.velocity, dt);

    // поворот на угловую скорость: q += ½·ω·q·dt
    const q = item.object.quaternion;
    _spin.set(item.angular.x, item.angular.y, item.angular.z, 0).multiply(q);
    q.x += _spin.x * 0.5 * dt;
    q.y += _spin.y * 0.5 * dt;
    q.z += _spin.z * 0.5 * dt;
    q.w += _spin.w * 0.5 * dt;
    q.normalize();
  }

  /**
   * Контакт с землёй по всем восьми углам габаритного ящика.
   * Углы, ушедшие под пол, выталкиваются и гасят скорость — и именно это
   * заставляет предмет опрокинуться, если он опирается не на ту грань.
   */
  _resolveGround(item) {
    const position = item.object.position;
    const quaternion = item.object.quaternion;

    for (let cx = 0; cx < 2; cx++) {
      for (let cy = 0; cy < 2; cy++) {
        for (let cz = 0; cz < 2; cz++) {
          _r.set(
            cx ? item.boxMax.x : item.boxMin.x,
            cy ? item.boxMax.y : item.boxMin.y,
            cz ? item.boxMax.z : item.boxMin.z
          ).applyQuaternion(quaternion);

          const height = position.y + _r.y - item.floorY;
          if (height >= 0) continue;

          // скорость самой точки контакта
          _pointVelocity.copy(item.angular).cross(_r).add(item.velocity);
          const normalSpeed = _pointVelocity.y;

          if (normalSpeed < 0) {
            const bounce = normalSpeed < -CFG.bounceThreshold ? CFG.bounce : 0;
            const denominator = item.invMass + this._normalDenominator(item, _r);
            const j = (-(1 + bounce) * normalSpeed) / denominator;

            _impulse.set(0, j, 0);
            this._applyImpulse(item, _impulse, _r);

            // трение: гасим скольжение по земле, но не больше закона Кулона
            _pointVelocity.copy(item.angular).cross(_r).add(item.velocity);
            _tangent.set(_pointVelocity.x, 0, _pointVelocity.z);
            const slide = _tangent.length();
            if (slide > 1e-4) {
              _tangent.divideScalar(slide);
              const maxFriction = CFG.friction * j;
              const jt = Math.min(slide / denominator, maxFriction);
              _impulse.copy(_tangent).multiplyScalar(-jt);
              this._applyImpulse(item, _impulse, _r);
            }
          }

        }
      }
    }
  }

  /**
   * Выталкивание из пола — отдельным шагом и по самому глубокому углу.
   * Поправлять каждый угол внутри решателя нельзя: восемь коррекций за проход
   * складываются, предмет подкидывает вверх и он начинает мелко дрожать без конца.
   */
  _liftFromFloor(item) {
    const position = item.object.position;
    const quaternion = item.object.quaternion;
    let deepest = 0;

    for (let cx = 0; cx < 2; cx++) {
      for (let cy = 0; cy < 2; cy++) {
        for (let cz = 0; cz < 2; cz++) {
          _r.set(
            cx ? item.boxMax.x : item.boxMin.x,
            cy ? item.boxMax.y : item.boxMin.y,
            cz ? item.boxMax.z : item.boxMin.z
          ).applyQuaternion(quaternion);
          deepest = Math.min(deepest, position.y + _r.y - item.floorY);
        }
      }
    }

    // мелкое проникновение оставляем: попытка убрать его до нуля и есть источник дрожания
    const depth = -deepest - CFG.allowedOverlap;
    if (depth > 0) position.y += depth * CFG.correction;
  }

  /** Знаменатель импульса для вертикальной нормали: 1/m + n·(I⁻¹(r×n))×r. */
  _normalDenominator(item, r) {
    _tmp.set(-r.z, 0, r.x); // r × (0,1,0)
    this._applyInvInertia(item, _tmp);
    _point.crossVectors(_tmp, r);
    return Math.max(0, _point.y);
  }

  /** Отскок от зданий, техники, забора и границ площадки. */
  _collideWalls(item) {
    const position = item.object.position;
    this._before.copy(position);
    this.location.obstacles.resolve(position, item.radius);
    this.location.clampPosition(position);

    this._normal.set(position.x - this._before.x, 0, position.z - this._before.z);
    const pushed = this._normal.length();
    if (pushed < 1e-5) return;

    this._normal.divideScalar(pushed);
    const along = item.velocity.dot(this._normal);
    if (along < 0) {
      item.velocity.addScaledVector(this._normal, -along * (1 + CFG.restitution));
      item.velocity.multiplyScalar(CFG.wallDamping);
      item.angular.multiplyScalar(CFG.wallDamping);
    }
  }

  /** Предмет засыпает, только если он спокоен несколько кадров подряд. */
  _checkSleep(item, dt) {
    const energy = item.velocity.lengthSq() + item.angular.lengthSq() * CFG.spinWeight;
    if (energy > CFG.sleepEnergy) {
      item.idle = 0;
      return;
    }
    item.idle += dt;
    if (item.idle < CFG.sleepDelay) return;

    item.velocity.set(0, 0, 0);
    item.angular.set(0, 0, 0);
    item.asleep = true;
  }

  /** Предметы расталкивают друг друга — куча разлетается целиком. */
  _separate() {
    const items = this.items;
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      for (let j = i + 1; j < items.length; j++) {
        const b = items[j];
        if (a.asleep && b.asleep) continue;

        const pa = a.object.position;
        const pb = b.object.position;
        const dx = pb.x - pa.x;
        const dz = pb.z - pa.z;
        const gap = a.radius + b.radius;
        const distanceSq = dx * dx + dz * dz;
        if (distanceSq > gap * gap || distanceSq < 1e-8) continue;
        if (Math.abs(pb.y - pa.y) > gap) continue;

        const distance = Math.sqrt(distanceSq);
        const nx = dx / distance;
        const nz = dz / distance;
        const overlap = (gap - distance) / 2;

        pa.x -= nx * overlap;
        pa.z -= nz * overlap;
        pb.x += nx * overlap;
        pb.z += nz * overlap;

        // Будим соседа, только если в него действительно едут. Иначе два предмета,
        // просто лежащие впритык, бесконечно поднимают друг друга и никогда не засыпают.
        const approach = (a.velocity.x - b.velocity.x) * nx + (a.velocity.z - b.velocity.z) * nz;
        if (approach > CFG.wakeSpeed) {
          a.asleep = false;
          b.asleep = false;
          a.idle = 0;
          b.idle = 0;
        }

        if (approach > 0) {
          const exchange = (approach * CFG.transfer * 2) / (a.invMass + b.invMass) ;
          _impulse.set(-nx * exchange, 0, -nz * exchange);
          a.velocity.addScaledVector(_impulse, a.invMass);
          b.velocity.addScaledVector(_impulse, -b.invMass);
        }
      }
    }
  }
}
