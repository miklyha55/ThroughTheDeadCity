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
 *
 * Ровно тот же трафарет решает и вторую задачу: силуэт должен проступать сквозь
 * окружение, но не сквозь другую живую фигуру — зомби, вставший перед персонажем,
 * не должен подсвечивать его насквозь, и наоборот. Поэтому метка в трафарете у
 * всех фигур ОДНА: каждая помечает себя, а силуэт не рисуется ни на одной из них.
 * Порядком отрисовки этого не добиться: тела непрозрачны, силуэты — нет, а
 * прозрачный проход идёт после всего непрозрачного, какой renderOrder ни ставь.
 *
 * Порядок нужен лишь внутри непрозрачного прохода: окружение (0) должно лечь в
 * буфер глубины раньше масок (1), иначе маска пометит и те места, где фигуру
 * на самом деле закрывает дом, и силуэт там не появится.
 */
const MASK_ORDER = 1;
const GHOST_ORDER = 2;

// Общая на всех метка «здесь стоит живая фигура»: своя у каждого означала бы,
// что маска зомби не защищает силуэт персонажа, и он светил бы сквозь зомби.
const STENCIL_REF = 1;

export function addSilhouette(root, { color, opacity = 1 } = {}) {
  // Первый проход: невидимый двойник помечает в трафарете всё, что занимает фигура.
  const maskMaterial = new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: false,
    stencilWrite: true,
    stencilRef: STENCIL_REF,
    stencilFunc: THREE.AlwaysStencilFunc,
    stencilZPass: THREE.ReplaceStencilOp,
  });

  // Второй проход: силуэт рисуется только за преградой И вне помеченной области,
  // то есть никогда не ложится ни на саму фигуру, ни на другую живую фигуру.
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthFunc: THREE.GreaterDepth, // только то, что скрыто за геометрией
    depthWrite: false,
    fog: false,
    stencilWrite: true,
    stencilRef: STENCIL_REF,
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

  const masks = originals.map((mesh) => twin(mesh, maskMaterial, MASK_ORDER, 'silhouetteMask'));
  const ghosts = originals.map((mesh) => twin(mesh, material, GHOST_ORDER, 'silhouette'));

  return {
    material,
    maskMaterial,
    masks,
    ghosts,
    /**
     * Показать или спрятать сам силуэт. Маска остаётся включённой всегда: она
     * ничего не рисует, но продолжает закрывать фигуру от чужих силуэтов —
     * иначе сквозь труп зомби просвечивал бы контур персонажа.
     */
    setVisible(visible) {
      for (const mesh of ghosts) mesh.visible = visible;
    },
  };
}
