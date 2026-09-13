import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CONFIG } from '../config.js';

const CFG = CONFIG.world;

/** Общее для всех локаций: свет, небо, туман и земля до горизонта. */
export function buildWorld(scene, renderer) {
  const sky = new THREE.Color(CFG.skyColor);
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, CFG.fogNear, CFG.fogFar);

  // Отражённый свет со всех сторон — без него PBR-материалы уходят в чёрный.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = CFG.envIntensity;
  pmrem.dispose();

  const hemi = new THREE.HemisphereLight(CFG.skyColor, CFG.groundColor, CFG.hemiIntensity);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(CFG.sunColor, CFG.sunIntensity);
  const sunOffset = new THREE.Vector3(...CFG.sunOffset);
  sun.position.copy(sunOffset);
  sun.castShadow = true;
  sun.shadow.mapSize.set(CFG.shadowMapSize, CFG.shadowMapSize);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 110;
  sun.shadow.camera.left = -CFG.shadowRadius;
  sun.shadow.camera.right = CFG.shadowRadius;
  sun.shadow.camera.top = CFG.shadowRadius;
  sun.shadow.camera.bottom = -CFG.shadowRadius;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);

  /** Держит карту теней вокруг цели: у directional-света она конечного размера. */
  sun.follow = (position) => {
    sun.target.position.copy(position);
    sun.position.copy(position).add(sunOffset);
    sun.target.updateMatrixWorld();
  };

  // подложка под локацией: то, что видно за забором до самого горизонта
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({ color: CFG.groundColor, roughness: 0.95 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05; // ниже пола локации: два плоских листа не должны совпадать
  ground.receiveShadow = true;
  scene.add(ground);

  // Смену суток крутит DayNight: ему нужны сам свет, полусфера и цвет неба,
  // который делят фон и туман.
  return { sun, hemi, sky, sunOffset };
}
