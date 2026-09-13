import * as THREE from 'three';

/**
 * Силуэт, проступающий сквозь преграду.
 *
 * К каждому мешу модели добавляется двойник с тем же скелетом, но с материалом,
 * который рисуется только там, где фрагмент оказался ДАЛЬШЕ уже нарисованного, —
 * то есть за преградой. Считать в коде нечего: сравнение глубины делает
 * видеокарта, и контур сам появляется, когда фигура уходит за дом, фуру или
 * дерево, и сам исчезает, когда она выходит.
 *
 * Исключение одно — пол: для видеокарты земля такая же геометрия, и то, что
 * ушло под неё, тоже «за преградой». Без этого контур тонущего трупа продолжал
 * бы сползать вниз сквозь землю.
 */
const FLOOR = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.02);

// Порядок в непрозрачном проходе: окружение (0) → контуры зомби (3) → контур
// персонажа (4) → сами фигуры (5).
//
// Контуры разведены по слоям намеренно: при одинаковом порядке видеокарта рисует
// их по глубине, и красный контур зомби ложился поверх своего. Свой должен быть
// виден всегда — по нему игрок и находит себя за домом.
//
// Фигуры идут последними, и это же гасит самоперекрытие: к моменту их отрисовки
// контур уже нарисован, а открытые части фигуры ближе окружения и тест глубины
// не проходят — рука поверх торса контуром не светится.
const ZOMBIE_ORDER = 3;
const BODY_ORDER = 5;

export function addSilhouette(root, { color, opacity = 1, order = ZOMBIE_ORDER } = {}) {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthFunc: THREE.GreaterDepth, // только то, что скрыто за геометрией
    depthWrite: false,
    fog: false,
    clippingPlanes: [FLOOR],
  });

  const originals = [];
  root.traverse((o) => {
    if (o.isMesh) originals.push(o);
  });

  for (const mesh of originals) {
    const copy = mesh.isSkinnedMesh
      ? new THREE.SkinnedMesh(mesh.geometry, material)
      : new THREE.Mesh(mesh.geometry, material);

    copy.name = `silhouette:${mesh.name}`;
    copy.renderOrder = order;
    copy.castShadow = false;
    copy.receiveShadow = false;

    // Двойник живёт ровно столько же, сколько оригинал: спрятанное за спину
    // ружьё не должно светиться контуром второго ствола.
    Object.defineProperty(copy, 'visible', {
      get: () => mesh.visible,
      set: () => {},
      configurable: true,
    });

    if (mesh.isSkinnedMesh) {
      // тот же скелет — значит двойник повторяет любую анимацию сам собой
      copy.bind(mesh.skeleton, mesh.bindMatrix);
      copy.bindMode = mesh.bindMode;
    } else {
      copy.position.copy(mesh.position);
      copy.quaternion.copy(mesh.quaternion);
      copy.scale.copy(mesh.scale);
    }

    mesh.parent.add(copy);
    mesh.renderOrder = BODY_ORDER; // сама фигура ложится поверх любых контуров
  }
}
