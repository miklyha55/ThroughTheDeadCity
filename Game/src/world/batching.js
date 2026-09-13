import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Сведение материалов и слияние мешей — чтобы сцена рисовалась за десятки вызовов,
 * а не за сотни.
 *
 * В моделях проекта нет текстур: цвет лежит в самом материале. Поэтому цвет можно
 * записать в вершины, а материалы, отличавшиеся только им, заменить одним общим.
 * Различия остаются лишь в шероховатости и металличности — по ним меши и делятся
 * на группы. У зомби такая группа всего одна: восемь материалов схлопываются в один.
 */

/**
 * Возвращает мешу отсечение по кадру.
 *
 * У скина оно обычно отключено: сфера геометрии снята с bind-позы, а кости
 * выводят вершины за её пределы, и фигура пропадает на краю экрана. Но
 * отключённое отсечение означает, что каждая фигура рисуется всегда — и в кадре,
 * и за ним. При сотне зомби это сотня напрасных вызовов отрисовки плюс столько же
 * в проходе теней.
 *
 * Поэтому скину задаётся собственная сфера, и не по геометрии, а просто вокруг
 * фигуры: центр на уровне груди, радиус — с запасом в добрый десяток метров.
 * Сфера геометрии тут не помощник — она снята с bind-позы, и её центр может
 * лежать где угодно, хоть в ступнях, хоть в стороне от модели.
 *
 * Запас намеренно огромный: фигура должна начать рисоваться далеко за краем
 * кадра, иначе зомби выскакивают на экран посреди пустого места. На площадке
 * 44 x 44 м тридцать метров означают, что отсекается только совсем дальний край
 * локации, — но и этого хватает, чтобы не гнать в отрисовку всю толпу разом.
 *
 * @param {THREE.Object3D} root
 * @param {number} [radius] — радиус сферы отсечения, м
 * @param {number} [height] — на какой высоте её центр, м
 */
export function enableCulling(root, radius = 30, height = 1) {
  root.traverse((mesh) => {
    if (!mesh.isMesh) return;
    mesh.frustumCulled = true;

    if (!mesh.isSkinnedMesh) return;
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, height, 0), radius);
  });
}

/**
 * Общий кэш материалов на всё приложение: локации, зомби и персонаж делят
 * одни и те же объекты материалов — в этом и смысл сведения.
 */
const materialCache = new Map();

/**
 * Ключ группы: всё, что нельзя запечь в вершины.
 *
 * Скины идут отдельно от обычных мешей: у них есть привязка к костям, и слить
 * их вместе нельзя — у персонажа тело анимировано, а дробовик в руке нет.
 */
function groupKey(material, skinned = false) {
  return [
    skinned ? 'skin' : 'mesh',
    material.roughness.toFixed(2),
    material.metalness.toFixed(2),
    material.emissive ? material.emissive.getHexString() : '000000',
    material.side,
    material.transparent ? 1 : 0,
  ].join('|');
}

/** Общий материал группы: цвет берётся из вершин, остальное — от образца. */
function sharedMaterial(sample, cache, skinned = false) {
  const key = groupKey(sample, skinned);
  let material = cache.get(key);
  if (material) return material;

  material = new THREE.MeshStandardMaterial({
    color: 0xffffff,          // цвет теперь в вершинах
    vertexColors: true,
    roughness: sample.roughness,
    metalness: sample.metalness,
    emissive: sample.emissive ? sample.emissive.clone() : undefined,
    side: sample.side,
    transparent: sample.transparent,
    opacity: sample.opacity,
  });
  material.name = `batch:${key}`;
  cache.set(key, material);
  return material;
}

/** Записывает цвет материала в атрибут вершин — по нему их потом и различают. */
function bakeColor(geometry, material) {
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  const { r, g, b } = material.color;

  for (let i = 0; i < count; i++) {
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/**
 * Готовит геометрию меша к слиянию: запекает цвет и приводит набор атрибутов
 * к общему виду. Меши с разным набором атрибутов слить нельзя, а из GLB они
 * приходят по-разному — у одного есть uv, у другого нет.
 */
function prepare(mesh, keep) {
  const geometry = mesh.geometry.clone();
  bakeColor(geometry, mesh.material);

  for (const name of Object.keys(geometry.attributes)) {
    if (!keep.includes(name)) geometry.deleteAttribute(name);
  }
  if (!geometry.index) geometry.setIndex([...Array(geometry.attributes.position.count).keys()]);
  return geometry;
}

/**
 * Сливает меши объекта по группам материалов, сохраняя его положение в сцене.
 * Применяется к скинам: у зомби и персонажа своя иерархия костей, которую трогать
 * нельзя, поэтому геометрия сливается в системе координат самого скина.
 *
 * @param {THREE.Object3D} root — корень модели
 * @param {Map} cache — общий кэш материалов, чтобы модели делили их между собой
 */
export function batchSkinned(root, cache = materialCache) {
  const groups = new Map();
  const skinned = [];

  root.traverse((o) => {
    if (!o.isMesh) return;

    // Ключ включает родителя: меши на разных узлах сливать нельзя. Дробовик в руке
    // и дробовик за спиной висят на разных костях, и слитые в один меш они оказались
    // бы в одной точке — второй просто исчез бы из виду.
    const key = `${o.parent?.uuid ?? 'root'}|${groupKey(o.material, o.isSkinnedMesh)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
    if (o.isSkinnedMesh) skinned.push(o);
  });
  if (groups.size === 0) return root;

  const keep = ['position', 'normal', 'color', 'skinIndex', 'skinWeight'];

  for (const meshes of groups.values()) {
    if (meshes.length < 2) {
      // сливать нечего, но цвет всё равно переносим в вершины ради общего материала
      const only = meshes[0];
      bakeColor(only.geometry, only.material);
      only.material = sharedMaterial(only.material, cache, only.isSkinnedMesh);
      continue;
    }

    const sample = meshes[0];
    // скину нужны веса костей, обычному мешу они только помешают слиться
    const attributes = sample.isSkinnedMesh ? keep : keep.filter((n) => !n.startsWith('skin'));
    const geometries = meshes.map((m) => prepare(m, attributes));
    const merged = mergeGeometries(geometries, false);
    geometries.forEach((g) => g.dispose());
    if (!merged) continue;

    const material = sharedMaterial(sample.material, cache, sample.isSkinnedMesh);
    const batch = sample.isSkinnedMesh
      ? new THREE.SkinnedMesh(merged, material)
      : new THREE.Mesh(merged, material);

    batch.name = `batch:${sample.name}`;
    batch.castShadow = sample.castShadow;
    batch.receiveShadow = sample.receiveShadow;
    batch.frustumCulled = sample.frustumCulled;

    if (sample.isSkinnedMesh) {
      batch.bind(sample.skeleton, sample.bindMatrix);
      batch.bindMode = sample.bindMode;
    }

    sample.parent.add(batch);
    for (const mesh of meshes) mesh.removeFromParent();
  }
  return root;
}

/**
 * Сливает статичную геометрию локации в несколько больших мешей — по одному
 * на группу материалов. Объекты после этого перестают существовать по отдельности,
 * поэтому сюда идёт только то, что никогда не двигается.
 *
 * @param {THREE.Object3D[]} objects — размещённые пропы
 * @param {Map} cache — общий кэш материалов
 * @returns {THREE.Group} группа слитых мешей
 */
export function batchStatic(objects, cache = materialCache) {
  const groups = new Map();
  const keep = ['position', 'normal', 'color'];

  for (const object of objects) {
    object.updateMatrixWorld(true);

    object.traverse((mesh) => {
      if (!mesh.isMesh) return;

      const key = groupKey(mesh.material);
      if (!groups.has(key)) groups.set(key, { sample: mesh, geometries: [] });

      const geometry = prepare(mesh, keep);
      geometry.applyMatrix4(mesh.matrixWorld); // в мировые координаты: общий меш неподвижен
      groups.get(key).geometries.push(geometry);
    });
  }

  const batched = new THREE.Group();
  batched.name = 'batched';

  for (const { sample, geometries } of groups.values()) {
    const merged = mergeGeometries(geometries, false);
    geometries.forEach((g) => g.dispose());
    if (!merged) continue;

    const mesh = new THREE.Mesh(merged, sharedMaterial(sample.material, cache));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    batched.add(mesh);
  }
  return batched;
}
