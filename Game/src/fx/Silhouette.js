import * as THREE from 'three';

/**
 * Силуэт, проступающий сквозь стены.
 *
 * К каждому мешу модели добавляется двойник с тем же скелетом, но с материалом,
 * который рисуется только там, где фрагмент оказался ДАЛЬШЕ уже нарисованного.
 * Иначе говоря — только за преградой. Ничего считать в коде не нужно: сравнение
 * глубины делает видеокарта, и силуэт сам появляется, когда персонаж заходит
 * за дом, и сам исчезает, когда выходит.
 *
 * Тонкость: фигура перекрывает сама себя — рука закрывает корпус, ружьё закрывает
 * руку. Такие места тоже «за преградой», и силуэт проступал бы прямо на открытой
 * модели. Поэтому двойники рисуются через трафарет: сначала помечается вся область,
 * занятая самой фигурой, и внутри этой области силуэт не рисуется вовсе.
 */
export function addSilhouette(root, {
  color,
  opacity = 1,
  renderOrder = 10,
  stencilRef = 1,
} = {}) {
  // Первый проход: невидимый двойник помечает в трафарете всё, что занимает фигура.
  const maskMaterial = new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: false,
    stencilWrite: true,
    stencilRef,
    stencilFunc: THREE.AlwaysStencilFunc,
    stencilZPass: THREE.ReplaceStencilOp,
  });

  // Второй проход: силуэт рисуется только за преградой И вне помеченной области,
  // то есть никогда не ложится на саму открытую фигуру.
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthFunc: THREE.GreaterDepth, // только то, что скрыто за геометрией
    depthWrite: false,
    fog: false,
    stencilWrite: true,
    stencilRef,
    stencilFunc: THREE.NotEqualStencilFunc,
    stencilFail: THREE.KeepStencilOp,
    stencilZFail: THREE.KeepStencilOp,
    stencilZPass: THREE.KeepStencilOp,
  });

  const originals = [];
  root.traverse((o) => {
    if (o.isMesh) originals.push(o);
  });

  /** Двойник меша с заданным материалом: тот же скелет, та же геометрия. */
  const twin = (mesh, mat, order, label) => {
    const copy = mesh.isSkinnedMesh
      ? new THREE.SkinnedMesh(mesh.geometry, mat)
      : new THREE.Mesh(mesh.geometry, mat);

    copy.name = `${label}:${mesh.name}`;
    copy.renderOrder = order;
    copy.castShadow = false;
    copy.receiveShadow = false;
    copy.frustumCulled = false;

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
    return copy;
  };

  const masks = originals.map((mesh) => twin(mesh, maskMaterial, renderOrder, 'silhouetteMask'));
  const ghosts = originals.map((mesh) => twin(mesh, material, renderOrder + 1, 'silhouette'));

  return {
    material,
    maskMaterial,
    masks,
    ghosts,
    /** Показать или спрятать силуэт целиком. */
    setVisible(visible) {
      for (const mesh of masks) mesh.visible = visible;
      for (const mesh of ghosts) mesh.visible = visible;
    },
  };
}
