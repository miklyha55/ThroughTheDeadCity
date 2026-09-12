import { Engine } from './core/Engine.js';
import { Input } from './core/Input.js';
import { FollowCamera } from './core/FollowCamera.js';
import { loadGLTF } from './core/AssetLoader.js';
import { isTouchDevice } from './core/device.js';
import { buildWorld } from './world/World.js';
import { PropLibrary } from './world/PropLibrary.js';
import { LocationManager } from './world/LocationManager.js';
import { Player } from './entities/Player.js';
import { Joystick } from './ui/Joystick.js';
import { CONFIG } from './config.js';

const engine = new Engine(document.getElementById('app'));
const hud = document.getElementById('hud');

const { sun } = buildWorld(engine.scene, engine.renderer);

const [gltf, props] = await Promise.all([
  loadGLTF(CONFIG.player.modelUrl),
  PropLibrary.load(CONFIG.props.libraryUrl),
]);

const player = new Player(gltf);
engine.scene.add(player.root);

const locations = new LocationManager(engine.scene, props, player);
const params = new URLSearchParams(window.location.search);
await locations.load(params.get('location') ?? CONFIG.locations.first);

// на тач-устройстве управляем стиком, на десктопе — клавиатурой
const touch = isTouchDevice();
const joystick = touch ? new Joystick() : null;
const input = new Input(joystick);
const camera = new FollowCamera(engine.camera, player);

engine.add({
  update(dt) {
    input.update();
    player.update(dt, input.move, camera.moveYaw);
    const here = locations.current;
    if (here.reachedExit(player.position)) {
      locations.advance(); // вышел через проём — следующая локация
    } else {
      here.obstacles.resolve(player.position, CONFIG.player.radius); // не пускаем внутрь объектов
      here.clampPosition(player.position); // и за забор тоже
    }
    here.debris.update(dt, player.position, CONFIG.player.radius, player.velocity);
    camera.update(dt);
    sun.follow(player.position); // тени ездят вместе с персонажем, иначе он выйдет за карту теней
  },
});

// ?debug=collision — показать контуры столкновений
let debugView = null;
async function updateDebugView() {
  if (params.get('debug') !== 'collision') return;
  const { showObstacles } = await import('./dev/collisionDebug.js');
  debugView?.removeFromParent();
  debugView = showObstacles(engine.scene, locations.current.obstacles);
}

function showLocationName(location) {
  hud.hidden = false;
  hud.textContent = touch ? location.data.name : `${location.data.name} · WASD — движение`;
}
locations.onChange = (location) => {
  showLocationName(location);
  updateDebugView();
};
showLocationName(locations.current);
updateDebugView();

if (import.meta.env.DEV) {
  window.__game = {
    engine, player, camera, input, joystick, props, locations,
    /** Переключение локаций из консоли: __game.go('gas_station') */
    go: (id) => locations.load(id),
  };
}

engine.start();
