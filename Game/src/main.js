import { Engine } from './core/Engine.js';
import { Input } from './core/Input.js';
import { FollowCamera } from './core/FollowCamera.js';
import { loadGLTF } from './core/AssetLoader.js';
import { buildWorld } from './world/World.js';
import { DayNight } from './world/DayNight.js';
import { Visibility } from './world/Visibility.js';
import { SeeThrough } from './fx/SeeThrough.js';
import { PrefabLibrary } from './world/PrefabLibrary.js';
import { ZombieLibrary } from './world/ZombieLibrary.js';
import { LocationManager } from './world/LocationManager.js';
import { Player } from './entities/Player.js';
import { Joystick } from './ui/Joystick.js';
import { Splash } from './ui/Splash.js';
import { Music } from './core/Music.js';
import { Sfx } from './core/Sfx.js';
import { GunEffects } from './fx/GunEffects.js';
import { Blood } from './fx/Blood.js';
import { Dust } from './fx/Dust.js';
import { Puffs } from './fx/Puffs.js';
import { TargetMark } from './fx/TargetMark.js';
import { HealthBars } from './fx/HealthBars.js';
import { Explosions } from './fx/Explosions.js';
import { CONFIG } from './config.js';

const engine = new Engine(document.getElementById('app'));
const hud = document.getElementById('hud');

const world = buildWorld(engine.scene, engine.renderer);
const { sun } = world;
const dayNight = new DayNight({ scene: engine.scene, ...world });
const visibility = new Visibility(engine.camera);

let [gltf, prefabs, zombies] = await Promise.all([
  loadGLTF(CONFIG.player.modelUrl),
  PrefabLibrary.load(CONFIG.props.libraryUrl, CONFIG.props.prefabsUrl),
  ZombieLibrary.load(CONFIG.zombies.sources),
]);

const gunEffects = new GunEffects(engine.scene);
const blood = new Blood(engine.scene);
const playerBlood = new Blood(engine.scene, CONFIG.blood.playerColor, CONFIG.blood.playerPool);
const healthBars = new HealthBars(engine.scene);
const explosions = new Explosions(engine.scene);
const dust = new Dust(engine.scene);
const puffs = new Puffs(engine.scene);

const sfx = new Sfx(CONFIG.sounds.files);

let player = new Player(gltf);
player.effects = gunEffects;
player.blood = blood;
player.ownBlood = playerBlood;
player.sfx = sfx;
player.puffs = puffs;
engine.scene.add(player.root);

const locations = new LocationManager(engine.scene, prefabs, player, zombies);
locations.splash = new Splash();
locations.sfx = sfx;
locations.seeThrough = new SeeThrough(engine.camera);

const music = new Music();
const params = new URLSearchParams(window.location.search);

/**
 * Какой уровень открыть и где его запомнить.
 *
 * В разработке игра возвращается туда, где её закрыли: правишь локацию, жмёшь
 * перезагрузку — и снова на ней, а не в начале цепочки. В собранной игре этого
 * нет: там уровни идут по порядку, и прыгать в середину незачем.
 *
 * Адрес сильнее памяти: `?location=` открывает то, что в нём написано.
 */
const LAST_LEVEL = 'dev:location';
const remembered = import.meta.env.DEV ? localStorage.getItem(LAST_LEVEL) : null;

await locations.load(params.get('location') ?? remembered ?? CONFIG.locations.first);

let editor = null; // правка расстановки: появляется только на dev-сервере
const joystick = new Joystick();
const input = new Input(joystick);
const camera = new FollowCamera(engine.camera, player);
locations.camera = camera; // при смене уровня камера встаёт на персонажа сразу
const targetMark = new TargetMark(engine.scene);

engine.add({
  update(dt) {
    if (editor?.active) {
      editor.update(dt); // мир замер, но камеру ещё водят стрелками
      return;
    }

    input.update();
    player.update(dt, input.move, camera.moveYaw, locations.current);
    const here = locations.current;
    if (here.reachedExit(player.position)) {
      locations.advance(); // вышел через проём — следующая локация
    } else {
      // в прыжке он летит над препятствием, поэтому выталкивать его оттуда нельзя
      if (!player.jumping) here.obstacles.resolve(player.position, CONFIG.player.radius);
      here.clampPosition(player.position); // и за забор тоже
    }
    here.update(dt, player); // зомби: заметить, дойти, ударить
    gunEffects.update(dt);
    blood.update(dt);
    playerBlood.update(dt);
    explosions.update(dt);
    dust.update(dt, player.position);
    puffs.update(dt);
    camera.update(dt);
    targetMark.update(player.spotted);
    healthBars.update(engine.camera, here, player); // после камеры: полоски строятся по её осям
    visibility.update(here); // за краем экрана фигуры не рисуются вовсе
    locations.seeThrough.update(dt, player); // заслонившее героя — просвечивает
    dayNight.update(dt); // сутки идут своим ходом: свет, небо и тени
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

function showHud() {
  hud.hidden = false;
  hud.textContent = editor?.active
    ? `${locations.current.data.name} · правка`
    : locations.current.data.name;
}

// ?debug=input — видно, что приходит со стика и куда едет персонаж
if (params.get('debug') === 'input') {
  const readout = document.createElement('div');
  readout.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:40;'
    + 'font:12px/1.5 ui-monospace,Menlo,monospace;color:#8fd6a0;text-shadow:0 1px 2px #000;'
    + 'pointer-events:none;white-space:pre';
  document.body.appendChild(readout);

  engine.add({
    update() {
      const p = player.position;
      readout.textContent =
        `стик: ${joystick.active ? 'зажат' : 'отпущен'}  ввод ${input.move.x.toFixed(2)},${input.move.y.toFixed(2)}\n`
        + `скорость ${player.velocity.length().toFixed(2)} м/с\n`
        + `позиция ${p.x.toFixed(2)}, ${p.z.toFixed(2)}`;
    },
  });
}
/** Что сцена делает со взрывом: вспышка на месте и толчок камере. */
function wireBlasts(location) {
  location.onBlast = (at) => {
    const CFG = CONFIG.explosion;

    explosions.burst(at);
    camera.shake(CFG.shake, CFG.shakeFor);

    // Дальний взрыв слышно тише: иначе бочка на том конце площадки грохочет
    // так же, как та, что рванула под ногами.
    const near = Math.max(0, 1 - at.distanceTo(player.position) / CFG.hearing);
    if (near > 0) sfx.play('explosion', CONFIG.sounds.volume * CFG.volume * near, CFG.layers);
  };
}
wireBlasts(locations.current);

locations.onChange = (location) => {
  wireBlasts(location);
  showHud();
  updateDebugView();
  music.play(location.data.number ?? 1); // у каждого уровня своя дорожка

  if (import.meta.env.DEV) localStorage.setItem(LAST_LEVEL, location.data.id);
};
showHud();
updateDebugView();
music.play(locations.current.data.number ?? 1); // первый уровень: onChange к нему ещё не привязан

if (import.meta.env.DEV) {
  // Tab — правка расстановки мышью; пока она открыта, игра стоит на паузе
  const { createEditor } = await import('./dev/editor.js');
  editor = createEditor({ engine, locations, joystick, camera, onToggle: () => showHud() });

  const { createRebuildPanel } = await import('./dev/rebuildPanel.js');
  createRebuildPanel({
    onRebuilt: async () => {
      // Отдельный адрес на каждую сборку, иначе браузер отдаст старый файл из кэша.
      const stamp = Date.now();
      const bust = (url) => `${url}?v=${stamp}`;

      const zombieSources = Object.fromEntries(
        Object.entries(CONFIG.zombies.sources).map(([kind, url]) => [kind, bust(url)])
      );

      const [freshPrefabs, freshZombies, freshPlayer] = await Promise.all([
        PrefabLibrary.load(bust(CONFIG.props.libraryUrl), bust(CONFIG.props.prefabsUrl)),
        ZombieLibrary.load(zombieSources),
        loadGLTF(bust(CONFIG.player.modelUrl)),
      ]);

      // Персонаж пересоздаётся из свежей модели и встаёт туда, где стоял:
      // подменить модель внутри существующего Player нельзя — к ней привязан миксер.
      const spot = player.position.clone();
      const yaw = player.yaw;

      player.root.removeFromParent();
      player = new Player(freshPlayer);
      player.effects = gunEffects;
      player.blood = blood;
      player.ownBlood = playerBlood;
      player.sfx = sfx;
      player.puffs = puffs;
      player.placeAt(spot, yaw);
      engine.scene.add(player.root);

      // всё, что держало ссылку на прежнего персонажа
      camera.target = player;
      locations.camera = camera;
      locations.player = player;

      prefabs = freshPrefabs;
      zombies = freshZombies;
      locations.zombies = freshZombies;
      await locations.useLibrary(freshPrefabs);

      Object.assign(window.__game, { player, prefabs, zombies });
      return `${freshPrefabs.prefabs.size} пропов, ${freshZombies.list().length} видов зомби, персонаж`;
    },
  });

  window.__game = {
    engine, player, camera, input, joystick, prefabs, zombies, locations,
    /** Переключение локаций из консоли: __game.go('gas_station') */
    go: (id) => locations.load(id),
  };
}

engine.start();
