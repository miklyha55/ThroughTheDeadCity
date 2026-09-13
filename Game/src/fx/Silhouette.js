import * as THREE from 'three';

/**
 * Силуэт, проступающий сквозь преграду.
 *
 * К каждому мешу модели добавляется двойник с тем же скелетом, но с материалом,
 * который рисуется только там, где фрагмент оказался ДАЛЬШЕ уже нарисованного, —
 * то есть за преградой.
 *
 * Зажигать и гасить его решает не видеокарта, а код: силуэт нужен, только когда
 * фигуру перекрыл предмет выше её самой. Этим занят SilhouetteWatch, здесь —
 * одна отрисовка.
 */
// Порядок в непрозрачном проходе: окружение (0) → контуры зомби (3) → контур
// персонажа (4) → сами фигуры (5).
//
// Контуры разведены по слоям намеренно: при одинаковом порядке видеокарта рисует
// их по глубине, и красный контур зомби ложился поверх своего. Свой должен быть
// виден всегда — по нему игрок и находит себя за домом.
//
// Фигуры идут последними, поэтому персонаж, стоящий перед домом, закрывает собой
// контур зомби, который светится из-за этого дома.
// Ниже этой высоты контур не рисуется вовсе. Пол для видеокарты — такая же
// геометрия, и то, что ушло под него, считается «за преградой»: труп зомби
// погружается в землю, а его силуэт продолжает сползать вниз сквозь пол.
const FLOOR = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.02);

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

  // Зажжён ли контур. Общий на всю фигуру: перекрыли её — светится целиком.
  let shown = false;

  for (const mesh of originals) {
    const copy = mesh.isSkinnedMesh
      ? new THREE.SkinnedMesh(mesh.geometry, material)
      : new THREE.Mesh(mesh.geometry, material);

    copy.name = `silhouette:${mesh.name}`;
    copy.renderOrder = order;
    copy.castShadow = false;
    copy.receiveShadow = false;

    // Двойник живёт ровно столько же, сколько оригинал, и гаснет вместе с
    // выключателем: спрятанное за спину ружьё вторым стволом не светится.
    Object.defineProperty(copy, 'visible', {
      get: () => mesh.visible && shown,
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

  return {
    setVisible(visible) {
      shown = visible;
    },
  };
}
