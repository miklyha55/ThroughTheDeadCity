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
 * Общий кэш материалов на всё приложение: локации, зомби и персонаж делят
 * одни и те же объекты материалов — в этом и смысл сведения.
 */
const materialCache = new Map();

const _inverse = new THREE.Matrix4();
const _local = new THREE.Matrix4();

/**
 * Ключ группы: всё, что нельзя запечь в вершины.
 *
 * Скины идут отдельно от обычных мешей: у них есть привязка к костям, и слить
 * их вместе нельзя — у персонажа тело анимировано, а дробовик в руке нет.
 */
function groupKey(material, skinned = false) {
  return [
    skinned ? 'skin' : 'mesh',
    step(material.roughness),
    step(material.metalness),
    material.emissive ? material.emissive.getHexString() : '000000',
    material.side,
    material.transparent ? 1 : 0,
  ].join('|');
}

/**
 * Округление блеска до четверти.
 *
 * В Blender у каждой вещи своя шероховатость — 0.8, 0.85, 0.95, — и по точному
 * значению локация дробилась на два десятка кусков вместо пяти. На матовых
 * моделях без текстур разница в сотые доли не видна, а вызовов отрисовки стоит
 * дорого, поэтому близкие значения сводим в одну группу.
 */
function step(value) {
  return (Math.round((value ?? 0) * 4) / 4).toFixed(2);
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
  // Цвет уже в вершинах — значит проп сводили раньше, и материал у него белый.
  // Запечь его второй раз означало бы залить всю модель белым.
  if (geometry.getAttribute('color')) return;

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
/**
 * Сводит один проп в единый меш.
 *
 * Модель из Blender приходит десятком кусков — корпус, крышка, обручи, — и
 * каждый кусок это отдельный вызов отрисовки. Неподвижным вещам это неважно,
 * их всё равно сливают с локацией целиком, а вот бочки и ящики живут своей
 * жизнью и слиться с ней не могут: на полсотни таких предметов набегали сотни
 * вызовов на пустом месте.
 *
 * Геометрия сводится в осях самого пропа, поэтому он продолжает нормально
 * катиться и вращаться — меняется только то, сколько кусков в нём осталось.
 *
 * @param {THREE.Object3D} root — образец из библиотеки, правится на месте
 */
export function batchParts(root, cache = materialCache) {
  const groups = new Map();
  const keep = ['position', 'normal', 'color'];
  const meshes = [];

  root.updateMatrixWorld(true);
  _inverse.copy(root.matrixWorld).invert();

  root.traverse((mesh) => {
    if (!mesh.isMesh || mesh.isSkinnedMesh) return;
    meshes.push(mesh);

    const key = groupKey(mesh.material);
    if (!groups.has(key)) groups.set(key, { sample: mesh, geometries: [] });

    const geometry = prepare(mesh, keep);
    geometry.applyMatrix4(_local.multiplyMatrices(_inverse, mesh.matrixWorld));
    groups.get(key).geometries.push(geometry);
  });

  // сливать нечего: один кусок и так один вызов
  if (meshes.length < 2) return root;

  for (const mesh of meshes) mesh.removeFromParent();

  for (const { sample, geometries } of groups.values()) {
    const merged = mergeGeometries(geometries, false);
    geometries.forEach((g) => g.dispose());
    if (!merged) continue;

    const batch = new THREE.Mesh(merged, sharedMaterial(sample.material, cache));
    batch.name = `${root.name}:merged`;
    batch.castShadow = sample.castShadow;
    batch.receiveShadow = sample.receiveShadow;
    root.add(batch);
  }
  return root;
}

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
