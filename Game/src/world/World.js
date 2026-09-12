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

  scene.add(new THREE.HemisphereLight(CFG.skyColor, CFG.groundColor, CFG.hemiIntensity));

  const sun = new THREE.DirectionalLight(CFG.sunColor, CFG.sunIntensity);
  const sunOffset = new THREE.Vector3(...CFG.sunOffset);
  sun.position.copy(sunOffset);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 70;
  sun.shadow.camera.left = -18;
  sun.shadow.camera.right = 18;
  sun.shadow.camera.top = 18;
  sun.shadow.camera.bottom = -18;
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
  ground.receiveShadow = true;
  scene.add(ground);

  return { sun };
}
