import { Engine } from './core/Engine.js';
import { Input } from './core/Input.js';
import { FollowCamera } from './core/FollowCamera.js';
import { loadGLTF, trackAssets, preload } from './core/AssetLoader.js';
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
import { Boot } from './ui/Boot.js';
import { readChain } from './world/chain.js';
import { asset } from './core/paths.js';
import { Music } from './core/Music.js';
import { StartMessage } from './core/StartMessage.js';
import { Radio } from './ui/Radio.js';
import { Ending } from './ui/Ending.js';
import { Sfx } from './core/Sfx.js';
import { GunEffects } from './fx/GunEffects.js';
import { Blood } from './fx/Blood.js';
import { Dust } from './fx/Dust.js';
import { Puffs } from './fx/Puffs.js';
import { HealthBars } from './fx/HealthBars.js';
import { Explosions } from './fx/Explosions.js';
import { CONFIG } from './config.js';

const engine = new Engine(document.getElementById('app'));
const hud = document.getElementById('hud');

const params = new URLSearchParams(window.location.search);

/**
 * Какой уровень открыть и где его запомнить.
 *
 * В разработке игра возвращается на тот уровень, который выбрали стрелками в
 * панели: правишь локацию, жмёшь перезагрузку — и снова на ней, а не в начале
 * цепочки. В собранной игре этого нет: там уровни идут по порядку, и прыгать в
 * середину незачем.
 *
 * Запоминается именно выбор в панели, а не всякая загрузка. Иначе достаточно
 * было один раз дойти до выхода — и переход на следующий уровень молча
 * переписывал бы выбранный, так что после перезагрузки игра открывалась совсем
 * не там, куда её ставили.
 *
 * Адрес сильнее памяти: `?location=` открывает то, что в нём написано. Поэтому
 * панель его за собой и правит — иначе забытый в строке адреса параметр
 * перебивал бы выбор при каждой перезагрузке.
 *
 * Решается это первым делом: заставке нужно знать, чьё название показать, а она
 * поднимается раньше всего остального.
 */
const LAST_LEVEL = 'dev:location';
const remembered = import.meta.env.DEV ? localStorage.getItem(LAST_LEVEL) : null;
const firstLevel = params.get('location') ?? remembered ?? CONFIG.locations.first;

// Первым делом — экран загрузки самой игры: модели весят мегабайты, и это время
// игрок иначе смотрит в пустоту. Заставка уровня придёт уже после него.
const boot = new Boot();
boot.show();

/**
 * Всё, что игре понадобится: заставки, музыка, звуки, картинки, уровни.
 *
 * Список не выписан руками, а собран из самих настроек: любая строка, похожая
 * на путь к файлу, попадает в него сама. Выписанный список пришлось бы править
 * при каждом новом звуке, и однажды его бы забыли — а забытый файл догружается
 * уже в игре, и видно это как пустая заставка или пропавший выстрел.
 *
 * Модели сюда не входят: их грузит GLTFLoader, и он же считает их байты. Двойной
 * учёт сбил бы полосу.
 */
function assetsFromConfig(skip) {
  const found = new Set();

  const walk = (node) => {
    if (typeof node === 'string') {
      if (/\.(png|jpe?g|webp|gif|mp3|ogg|wav|json)$/i.test(node) && !skip.has(node)) found.add(node);
      return;
    }
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === 'object') Object.values(node).forEach(walk);
  };

  walk(CONFIG);
  return found;
}

/** Файлы, которых в настройках нет поимённо: они собираются по номеру уровня. */
async function assetsOfLevels() {
  const chain = await readChain(firstLevel);
  const files = [];

  for (const level of chain) {
    files.push(asset(`locations/${level.id}.json`));
    files.push(`${CONFIG.splash.folder}${level.number}.png`);
    files.push(`${CONFIG.music.folder}${level.number}.mp3`);
  }
  files.push(`${CONFIG.music.folder}${CONFIG.ending.track}.mp3`);
  return files;
}

async function bootAssets() {
  const models = new Set([
    CONFIG.player.modelUrl,
    CONFIG.props.libraryUrl,
    ...Object.values(CONFIG.zombies.sources),
  ]);

  const fromLevels = await assetsOfLevels();
  return [...new Set([...assetsFromConfig(models), ...fromLevels])];
}

const extras = await bootAssets();
trackAssets(1 + 1 + Object.keys(CONFIG.zombies.sources).length + extras.length,
  (share) => boot.setProgress(share));

const splash = new Splash();
splash.prepare(firstLevel); // заставка уровня готовится, пока идёт чёрный экран

const world = buildWorld(engine.scene, engine.renderer);
const { sun } = world;
const dayNight = new DayNight({ scene: engine.scene, ...world });
const visibility = new Visibility(engine.camera);

let [gltf, prefabs, zombies] = await Promise.all([
  loadGLTF(CONFIG.player.modelUrl),
  PrefabLibrary.load(CONFIG.props.libraryUrl, CONFIG.props.prefabsUrl),
  ZombieLibrary.load(CONFIG.zombies.sources),
  preload(extras), // заставки, звуки и картинки — вместе с моделями, а не после
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
locations.splash = splash;
locations.sfx = sfx;
locations.seeThrough = new SeeThrough(engine.camera);

const music = new Music();
const startMessage = new StartMessage(); // вступление на первом уровне: пока говорит — персонаж стоит

// Галочка из панели разработчика. Читается до первой постановки на уровень:
// выключенное вступление не должно даже начинать замок, а панель появляется позже.
const NO_INTRO = 'dev:noIntro';
if (import.meta.env.DEV) startMessage.muted = localStorage.getItem(NO_INTRO) === '1';
const radio = new Radio(); // и рация в углу: видно, откуда голос и почему нельзя идти
const ending = new Ending(); // экран, которым игра кончается

/**
 * Игра пройдена: последний уровень выпустил персонажа наружу.
 *
 * Мир останавливается целиком — не только управление. Иначе за картинкой
 * продолжали бы бегать зомби, топать шаги и хрипеть голоса, и финал звучал бы
 * как продолжение боя. Остаётся одна музыка, зациклённая, как и на уровнях.
 */
let finished = false;

locations.onFinish = () => {
  if (finished) return;

  finished = true;
  sfx.silence();                    // мир замер — его звуки замолкают вместе с ним
  music.play(CONFIG.ending.track);
  ending.show();
};

/** Вернуться с финала в игру. Нужно только панели разработчика. */
function leaveEnding() {
  if (!finished) return;

  finished = false;
  ending.hide();
}

await boot.hide(); // модели готовы — чёрный экран уступает заставке уровня
await locations.load(firstLevel);

let editor = null; // правка расстановки: появляется только на dev-сервере
const joystick = new Joystick();
const input = new Input(joystick);
const camera = new FollowCamera(engine.camera, player);
locations.camera = camera; // при смене уровня камера встаёт на персонажа сразу

engine.add({
  update(dt) {
    if (editor?.active) {
      editor.update(dt); // мир замер, но камеру ещё водят стрелками
      return;
    }

    // Под заставкой и на финальном экране мир замер: там либо старый уровень уже
    // снят со сцены, либо игра кончилась, а бежать по ним персонаж иначе
    // продолжал бы как ни в чём не бывало.
    if (locations.loading || finished) return;

    input.update();
    player.frozen = startMessage.locked; // пока звучит вступление, он только слушает
    radio.toggle(player.frozen);         // рация висит ровно столько же
    player.update(dt, input.move, camera.moveYaw, locations.current);
    const here = locations.current;
    if (here.reachedExit(player.position)) {
      locations.advance(); // вышел через проём — следующая локация
    } else {
      // в прыжке он летит над препятствием, поэтому выталкивать его оттуда нельзя
      if (!player.jumping) here.obstacles.resolve(player.position, CONFIG.player.radius);
      here.clampPosition(player.position); // и за забор тоже
    }
    if (!player.alive && !diedAt) diedAt = performance.now();
    if (player.alive) diedAt = 0;

    here.update(dt, player); // зомби: заметить, дойти, ударить
    gunEffects.update(dt);
    blood.update(dt);
    playerBlood.update(dt);
    explosions.update(dt);
    dust.update(dt, player.position);
    puffs.update(dt);
    camera.update(dt);
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
    if (near > 0) sfx.play('explosion', CFG.volume * near, CFG.layers);
  };
}
wireBlasts(locations.current);

/**
 * После смерти уровень начинается заново по любому нажатию.
 *
 * Ждём секунду, прежде чем слушать: иначе тот самый выстрел или касание стика,
 * на котором персонаж и погиб, тут же перезапустил бы игру, и падения никто бы
 * не увидел.
 */
let diedAt = 0;
for (const event of ['pointerdown', 'keydown', 'touchstart']) {
  addEventListener(event, () => {
    if (player.alive || locations.loading) return;
    if (performance.now() - diedAt < CONFIG.player.restartAfter * 1000) return;

    player.revive();
    locations.load(locations.current.data.id);
  });
}

locations.onChange = (location) => {
  wireBlasts(location);
  showHud();
  updateDebugView();
  music.play(location.data.number ?? 1); // у каждого уровня своя дорожка
  startMessage.arm(location.data.number ?? 1); // и вступление, если уровень первый
};
showHud();
updateDebugView();
music.play(locations.current.data.number ?? 1); // первый уровень: onChange к нему ещё не привязан
startMessage.arm(locations.current.data.number ?? 1); // замок стоит сразу, до первого касания

if (import.meta.env.DEV) {
  // Tab — правка расстановки мышью; пока она открыта, игра стоит на паузе
  const { createEditor } = await import('./dev/editor.js');
  editor = createEditor({
    engine, locations, joystick, camera,
    onToggle: () => showHud(),
    toggles: [{
      label: 'без вступления',
      value: startMessage.muted,
      onChange: (off) => {
        startMessage.mute(off);
        localStorage.setItem(NO_INTRO, off ? '1' : '0');
      },
    }],
    onFinal: (on) => (on ? locations.onFinish() : leaveEnding()),
    onPick: (id) => {
      // выбор стрелками и есть то, что игра вспомнит после перезагрузки
      localStorage.setItem(LAST_LEVEL, id);

      // и адрес приводим к нему же: иначе оставшийся в строке ?location=
      // перебил бы выбор, и панель выглядела бы сломанной
      const url = new URL(window.location.href);
      url.searchParams.set('location', id);
      history.replaceState(null, '', url);
    },
  });

  const { createRebuildPanel } = await import('./dev/rebuildPanel.js');
  createRebuildPanel({
    onRebuilt: async () => {
      // Отдельный адрес на каждую сборку, иначе браузер отдаст старый файл из кэша.
      const stamp = Date.now();
      const bust = (url) => `${url}?v=${stamp}`;

      // Заставки и финал копируются той же кнопкой — значит и перечитать их надо
      // здесь же, иначе правленую картинку видно только после перезагрузки.
      ending.refresh();
      splash.refresh();

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
    engine, player, camera, input, joystick, prefabs, zombies, locations, music, startMessage, ending, splash,
    /** Переключение локаций из консоли: __game.go('gas_station') */
    go: (id) => locations.load(id),
  };
}

engine.start();
