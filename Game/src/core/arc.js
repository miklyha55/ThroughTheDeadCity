/**
 * Полёт по дуге: общий для всего, что перелетает из точки в точку.
 *
 * Дуга — обычная парабола, поднятая над прямой между началом и концом. На концах
 * подъём нулевой, в середине равен заданной высоте, поэтому взлёт и приземление
 * всегда сходятся с землёй, какой бы длины ни был перелёт.
 *
 * Сейчас по ней прыгает персонаж через машины; годится для всего, что должно
 * перелететь из точки в точку, — меняются только высота дуги и время полёта.
 */

/**
 * Насколько дуга поднята над прямой в этой точке пути.
 * @param {number} share — доля пути, 0..1
 * @param {number} height — высота дуги в середине, м
 */
function arcLift(share, height) {
  return height * 4 * share * (1 - share);
}

/**
 * Точка на дуге между `from` и `to`.
 *
 * @param {THREE.Vector3} out — куда записать результат
 * @param {THREE.Vector3} from @param {THREE.Vector3} to — концы дуги
 * @param {number} share — доля пути, 0..1
 * @param {number} height — высота дуги в середине, м
 * @returns {THREE.Vector3} тот же `out`
 */
export function arcPoint(out, from, to, share, height) {
  out.lerpVectors(from, to, share);
  out.y += arcLift(share, height);
  return out;
}
