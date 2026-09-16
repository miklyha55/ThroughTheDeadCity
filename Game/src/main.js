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
import { GunPickup } from './entities/GunPickup.js';
import { Pointer } from './fx/Pointer.js';
import { Joystick } from './ui/Joystick.js';
import { Splash } from './ui/Splash.js';
import { Boot } from './ui/Boot.js';
import { Gate } from './ui/Gate.js';
import { UpdatePrompt } from './ui/UpdatePrompt.js';
import { readChain } from './world/chain.js';
import { asset } from './core/paths.js';
import { Music } from './core/Music.js';
import { attachListener, unlockAudio, wakeAudio } from './core/audio.js';
import { StartMessage } from './core/StartMessage.js';
import { Transmission } from './ui/Transmission.js';
import { Radio } from './ui/Radio.js';
import { Ammo } from './ui/Ammo.js';
import { Stats } from './ui/Stats.js';
import { Ending } from './ui/Ending.js';
import { BattleFog } from './fx/BattleFog.js';
import { Sfx } from './core/Sfx.js';
import { GunEffects } from './fx/GunEffects.js';
import { Blood } from './fx/Blood.js';
import { Dust } from './fx/Dust.js';
import { Puffs } from './fx/Puffs.js';
import { HealthBars } from './fx/HealthBars.js';
import { Explosions } from './fx/Explosions.js';
import { Shards } from './fx/Shards.js';
import { CONFIG } from './config.js';

const engine = new Engine(document.getElementById('app'));
const hud = document.getElementById('hud');

// Весь звук игры висит на одном слушателе, и слушатель — на камере, как
// предписано three. Подписка на первое касание ставится сразу: разбудить звук
// можно только из жеста, а жест может случиться уже на экране загрузки.
attachListener(engine.camera);
unlockAudio();

/**
 * Подсказка об обновлении — сразу, первым делом.
 *
 * Не в конце: здесь заводится служебный поток, а он должен встать до того, как
 * игра начнёт тянуть свои тридцать мегабайт. Поставленный последним, он узнавал
 * бы о новой сборке только через полминуты после открытия — а к этому времени
 * игрок уже играет.
 *
 * Сама подсказка ничего не проверяет: поток замечает новую сборку и зовёт её, а
 * нажатие ставит версию и перезагружает страницу.
 *
 * Только в собранной игре: на dev-сервере потока нет, да он и не нужен — правки
 * и так приезжают сами.
 */
if (import.meta.env.PROD) new UpdatePrompt();

const params = new URLSearchParams(window.location.search);

/**
 * Игра не собралась: сказать об этом вслух.
 *
 * Раньше сорванная загрузка — нет файла уровня, оборвалась сеть на модели —
 * оставляла игроку чёрный экран навсегда: цикл отрисовки не запускался, а
 * единственным следом была строка в консоли, которую он никогда не откроет.
 * Теперь поверх всего поднимается короткая надпись, и игрок хотя бы знает, что
 * перезагрузка страницы имеет смысл.
 *
 * Собственных стилей у неё нет намеренно: она должна встать даже тогда, когда
 * не собралось вообще ничего.
 */
function reportBreak(error) {
  console.error(error);

  let box = document.getElementById('break');
  if (!box) {
    box = document.createElement('div');
    box.id = 'break';
    box.style.cssText = 'position:fixed;inset:0;z-index:999;display:flex;flex-direction:column;'
      + 'align-items:center;justify-content:center;gap:1em;padding:2em;text-align:center;'
      + 'background:#07090a;color:#c8ccd0;font:16px/1.5 system-ui,sans-serif';
    document.body.appendChild(box);
  }

  box.textContent = 'Игра не загрузилась. Проверьте соединение и обновите страницу.';
}

// Сборка модуля идёт через ожидание загрузки, и любой её срыв обрывает весь
// запуск целиком: дальше по файлу не выполнится ни строки. Ловим это здесь —
// другого места, где сказать об этом игроку, уже не будет.
addEventListener('unhandledrejection', (event) => reportBreak(event.reason));

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

// Первое, что видит игрок, — чёрный экран с кнопкой. Нужен он ради звука:
// браузер выпускает звук только после действия игрока, и чем раньше это
// действие случится, тем больше времени у телефона поднять звуковую сессию.
// Раньше первым касанием был хват за стик, и на выстрел этого запаса не хватало.
//
// Ждать нажатия игра не заставляет: загрузка идёт под воротами, и к моменту
// нажатия половина её обычно уже позади.
const gate = new Gate();
gate.show();
const pressed = gate.press(wakeAudio);

// Экран загрузки с репликами — следом за воротами: модели весят мегабайты, и
// это время игрок иначе смотрит в пустоту. Заставка уровня придёт уже после.
const boot = new Boot();

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

let chain = []; // цепочка уровней: читается один раз и нужна и файлам, и заставке

/** Файлы, которых в настройках нет поимённо: они собираются по номеру уровня. */
async function assetsOfLevels() {
  chain = await readChain(firstLevel);
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
splash.learn(chain);        // теперь она знает каждый уровень в лицо
splash.prepare(firstLevel); // и готовится встречать первый, пока идёт чёрный экран

const world = buildWorld(engine.scene, engine.renderer);
const { sun } = world;
const dayNight = new DayNight({ scene: engine.scene, ...world });
const visibility = new Visibility(engine.camera);

const sfx = new Sfx(CONFIG.sounds.files);

const loading = Promise.all([
  loadGLTF(CONFIG.player.modelUrl),
  PrefabLibrary.load(CONFIG.props.libraryUrl, CONFIG.props.prefabsUrl),
  ZombieLibrary.load(CONFIG.zombies.sources),
  preload(extras), // заставки, звуки и картинки — вместе с моделями, а не после
  // Звуки разбираются в память здесь же: на телефоне отложенная загрузка
  // означала тишину первые полминуты боя.
  sfx.load(),
]);

// Дальше — только после нажатия. Загрузка к этому моменту идёт уже давно, так
// что ворота уходят сразу, а экран с репликами показывает остаток пути.
await pressed;
boot.show();
gate.hide(); // сперва подставляем следующий экран, потом убираем этот

let [gltf, prefabs, zombies] = await loading;

const gunEffects = new GunEffects(engine.scene, engine.camera);
const blood = new Blood(engine.scene);
const playerBlood = new Blood(engine.scene, CONFIG.blood.playerColor, CONFIG.blood.playerPool);
const healthBars = new HealthBars(engine.scene);
const explosions = new Explosions(engine.scene);
const shards = new Shards(engine.scene); // обломки взорванного: летят, падают, пропадают
const dust = new Dust(engine.scene);
const puffs = new Puffs(engine.scene);
const ammo = new Ammo(CONFIG.player.magazine); // патроны вверху по центру

// Счётчик кадров: в разработке всегда, в собранной игре — по `?fps` в адресе.
// Игроку он не нужен, а на телефоне без него просадку не поймать.
const stats = (import.meta.env.DEV || params.has('fps')) ? new Stats() : null;

let player = new Player(gltf);
player.effects = gunEffects;
player.blood = blood;
player.ownBlood = playerBlood;
player.sfx = sfx;
player.puffs = puffs;
player.onAmmo = (left) => { ammo.set(left); showAmmo(); };
// Отдача: камера коротко вздрагивает на каждом выстреле.
player.onShot = () => camera.shake(CONFIG.player.kick, CONFIG.player.kickFor);
ammo.set(player.rounds);
engine.scene.add(player.root);

/**
 * Ружьё, лежащее на уровне. Своей модели у него нет — берёт ту же, что висит у
 * персонажа за спиной, поэтому заводится только после него.
 */
const gunPickup = new GunPickup(engine.scene);

/**
 * Ружьё подобрано.
 *
 * Появились патроны, а указатель переходит к следующей цели. Кончились цели —
 * он гаснет и отпирает выход.
 */
gunPickup.onTaken = () => {
  showAmmo();

  // Очередь целей пересобирается целиком, а не сдвигается на одну вперёд.
  // Сдвиг снимал то, что сейчас первое, — а это не всегда подобранное ружьё:
  // в правке расстановки оно лежит и у вооружённого, в очередь не попадает, и
  // сдвиг выбрасывал из неё выход. Пересборка заодно сама отпирает выход.
  aimPointer();
};

/**
 * Стрелка под ногами: куда идти дальше.
 *
 * Ездит на самом персонаже, поэтому переживает смену уровня. Цель ей ставит
 * `aimPointer` — сейчас это лежащее ружьё, дальше будет что угодно.
 */
const pointer = new Pointer(player.root, engine.scene);

const locations = new LocationManager(engine.scene, prefabs, player, zombies);
locations.splash = splash;
locations.sfx = sfx;
locations.seeThrough = new SeeThrough(engine.camera);

const music = new Music();
const transmission = new Transmission(); // текст вступления по букве внизу экрана
const startMessage = new StartMessage(transmission); // пока говорит — персонаж стоит

// Галочка из панели разработчика. Читается до первой постановки на уровень:
// выключенное вступление не должно даже начинать замок, а панель появляется позже.
const NO_INTRO = 'dev:noIntro';
if (import.meta.env.DEV) startMessage.muted = localStorage.getItem(NO_INTRO) === '1';

/**
 * Начинать ли игру с оружием. Галочка в панели разработчика.
 *
 * Обычно герой безоружен: ружьё лежит в конце вводной локации, и до него надо
 * дойти. Но проверять стрельбу, каждый раз проходя вводную, — мучение, поэтому
 * в правке это включается одной галочкой. В собранной игре её нет.
 */
const WITH_GUN = 'dev:withGun';
if (import.meta.env.DEV && localStorage.getItem(WITH_GUN) === '1') player.arm();
const radio = new Radio(); // и рация в углу: видно, откуда голос и почему нельзя идти
const ending = new Ending(); // экран, которым игра кончается
const fog = new BattleFog();  // туман войны: карта открывается по мере хода
fog.start();

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

  // Финал звучал своей дорожкой — возвращаем ту, что положена уровню. Иначе
  // музыка конца игры играла дальше, пока уровень не сменится.
  music.play(locations.current?.data.number ?? 1);
}

/**
 * Передача от экрана загрузки к заставке уровня.
 *
 * Заставка поднимается ПЕРВОЙ, пока экран загрузки ещё на месте. Он выше неё по
 * слою и полностью её закрывает, так что видно по-прежнему только его — а когда
 * он уходит, под ним уже готовая заставка.
 *
 * Наоборот нельзя, и раньше было именно наоборот: сначала убирали экран
 * загрузки, и только потом, отдельным шагом, поднимали заставку. Между этими
 * двумя мгновениями не показан ни один экран, и в щель видно голый холст с
 * несобранной сценой.
 *
 * Тот же порядок, что и у перехода от кнопки к загрузке: сперва подставить
 * следующий экран, потом убрать текущий. Кто из двоих управится раньше —
 * неважно: пока идёт один, второй всегда чем-то накрыт.
 *
 * ?hold — экран загрузки остаётся на месте и не уходит. Нужен, чтобы разглядеть
 * его в покое: сам по себе он висит секунды и под пипетку не даётся. Игра под
 * ним при этом идёт своим чередом, он просто лежит сверху.
 */
splash.show(); // встаёт под экраном загрузки: он выше и её пока не видно

if (!params.has('hold')) {
  await boot.hide();  // он уходит — и под ним сразу она, а не голый холст
  splash.uncovered(); // с этого мгновения её и правда видно, отсюда и её время
}

/**
 * Цикл отрисовки пускается ДО сборки первого уровня, а не последней строкой.
 *
 * Пока идёт заставка, кадры уже идут, и вся долгая работа первого кадра —
 * сборка шейдеров под свет и туман — приходится на закрытый экран. Раньше
 * старт стоял в самом конце: между уходом заставки и первым кадром экран
 * оставался голым, и вся эта работа ложилась ровно на то мгновение, когда
 * игрок впервые видит игру.
 */
engine.start();

// Без перехвата: сорвалась сборка первого уровня — дальше идти некуда, и
// запуск обрывается целиком. Сказать об этом игроку успеет общий перехватчик
// наверху файла.
await locations.load(firstLevel);

let editor = null; // правка расстановки: появляется только на dev-сервере
const joystick = new Joystick();
const input = new Input(joystick);
const camera = new FollowCamera(engine.camera, player);
locations.camera = camera; // при смене уровня камера встаёт на персонажа сразу

engine.add({
  update(dt) {
    stats?.update(engine.renderer); // считаем кадры раньше всего: они идут всегда
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
    here.update(dt, player); // зомби: заметить, дойти, ударить
    gunEffects.update(dt);
    blood.update(dt);
    playerBlood.update(dt);
    explosions.update(dt);
    shards.update(dt);
    gunPickup.update(dt, player); // лежащее ружьё: крутится, а подошёл — летит в руки
    pointer.update(dt, player.yaw); // стрелка под ногами держит цель
    dust.update(dt, player.position);
    puffs.update(dt);
    camera.update(dt);
    healthBars.update(engine.camera, here, player); // после камеры: полоски строятся по её осям
    visibility.update(here); // ушедшее за край экрана не рисуем вовсе
    // заслонившее героя или ближних зомби — просвечивает
    locations.seeThrough.update(dt, player, here?.zombies);
    dayNight.update(dt); // сутки идут своим ходом: свет, небо и тени
    sun.follow(player.position); // тени ездят вместе с персонажем, иначе он выйдет за карту теней
    fog.update(engine.camera, player, dt); // за героем остаётся прорезанная дорожка
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

/** Патроны показываем, только когда есть чем стрелять. */
function showAmmo() {
  ammo.root.hidden = !player.armed;
}

/**
 * Куда сейчас вести героя и открыт ли выход.
 *
 * Пока на уровне лежит ружьё, стрелка ведёт к нему, а выход заперт: уйти, не
 * подобрав его, значит прийти на следующий уровень безоружным. Подобрал — выход
 * открывается, а стрелка гаснет: дальше дорогу игрок ищет сам.
 *
 * Это и есть то место, куда добавляются будущие цели: стрелке всё равно, на что
 * показывать, ей нужна лишь точка.
 */
function aimPointer() {
  /**
   * Очередь целей на этом уровне. Собирается заново на каждом.
   *
   * Отсюда и берутся все цели игры по порядку: ружьё и выход на вводной, выход
   * на ферме, выход на заправке. Выход попадает сюда сам на любом уровне, где он
   * есть, — отдельно перечислять уровни не нужно, и новый подхватится тем же
   * правилом.
   *
   * Добавится ключ, рубильник или ящик с патронами — просто встанет в список.
   * Указатель поведёт к первой цели, а взяв её, сам перейдёт к следующей.
   */
  const here = locations.current;
  const targets = [];

  // Ружьё: к нему ведём с подсветкой и с любого расстояния — пока оно лежит,
  // это единственное, что нужно сделать.
  const gun = gunPickup.object && !player.armed ? gunPickup.object : null;
  if (gun) targets.push({ at: gun, halo: true });

  // Выход: без подсветки и только вблизи. Круг под дверью читался бы как «встань
  // сюда», а он и так на виду; напомнить стоит, лишь когда герой рядом.
  if (here?.exitMark) {
    targets.push({ at: here.exitMark, halo: false, within: CONFIG.pointer.exitWithin });
  }

  pointer.follow(targets);

  // Выход заперт, пока не взято ружьё: уйти без него значит прийти на следующий
  // уровень безоружным.
  here?.lockExit(Boolean(gun));
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
  location.onBlast = (at, object = null) => {
    const CFG = CONFIG.explosion;

    explosions.burst(at);
    shards.burst(at, object); // и сама вещь разлетается кусками своего цвета
    camera.shake(CFG.shake, CFG.shakeFor);

    // Дальний взрыв слышно тише: иначе бочка на том конце площадки грохочет
    // так же, как та, что рванула под ногами.
    const near = Math.max(0, 1 - at.distanceTo(player.position) / CFG.hearing);
    if (near > 0) sfx.play('explosion', CFG.volume * near, CFG.layers);
  };
}

/**
 * После смерти уровень начинается заново по любому нажатию.
 *
 * Ждём секунду, прежде чем слушать: иначе тот самый выстрел или касание стика,
 * на котором персонаж и погиб, тут же перезапустил бы игру, и падения никто бы
 * не увидел.
 */
for (const event of ['pointerdown', 'keydown', 'touchstart']) {
  addEventListener(event, () => {
    if (player.alive || locations.loading) return;

    // В правке расстановки уровень не перезапускается: там по клавишам двигают
    // предметы, и погибший под редактором персонаж уводил бы уровень из-под рук
    // на первом же нажатии.
    if (editor?.active) return;

    // Мгновение смерти и конец падения считает сам персонаж, в тот же миг, когда
    // его убили. Игра раньше засекала смерть своим кадром — то есть на кадр
    // позже удара, — и касание, попавшее в эту щель, перезапускало уровень
    // мгновенно. А удар как раз и приходит на касание: игрок жал стик, когда
    // его убили.
    if (performance.now() < player.restartAt) return;

    player.revive();
    locations.load(locations.current.data.id).catch(reportBreak);
  });
}

locations.onChange = (location) => {
  wireBlasts(location);
  gunPickup.place(location, player, locations.editing); // в правке лежит всегда
  aimPointer();
  showAmmo();
  showHud();
  updateDebugView();
  fog.reset(location.width, location.depth); // новый уровень — заново закрытая карта
  music.play(location.data.number ?? 1); // у каждого уровня своя дорожка
};

/**
 * Уровень открылся: заставка ушла, мир пошёл.
 *
 * Вступление взводится ИМЕННО здесь, а не при сборке сцены. Сборка быстрая, а
 * заставка висит после неё ещё пару секунд, и голос начинал говорить под
 * картинкой: игрок смотрел на заставку и слушал речь, которой ещё не время.
 * Хуже того, часть её он пропускал — субтитры идут по самой дорожке и в это
 * время шли под закрытым экраном.
 */
locations.onOpened = (location) => {
  startMessage.arm(location.data.number ?? 1);
};
/**
 * Первый уровень собрался раньше, чем эти двое были привязаны, — догоняем.
 *
 * Зовём именно их, а не повторяем список дел рядом. Раньше он был выписан здесь
 * второй раз, и два списка уже разошлись: подписка на взрывы в одном была, в
 * другом нет. Всякая новая строка в `onChange` точно так же оставалась бы за
 * бортом первого уровня — того самого, с которого игра и начинается.
 */
locations.onChange(locations.current);
locations.onOpened(locations.current);

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
    }, {
      label: 'с оружием',
      value: player.armed,
      onChange: (on) => {
        localStorage.setItem(WITH_GUN, on ? '1' : '0');

        // Выдать ружьё можно на месте, а вот отобрать — нет: половина игры
        // уже завязана на то, что оно есть. Поэтому снятая галочка вступает в
        // силу с ближайшей перезагрузки, о чём панель и говорит.
        if (on) player.arm();

        aimPointer(); // ружьё появилось или пропало — указателю есть что пересчитать
        showAmmo();
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

      // Прежнего персонажа отпускаем целиком, а не просто снимаем со сцены: у
      // него свой миксер и свой скелет, а под скелет отведена текстура костей.
      // Без этого каждое нажатие оставляло в видеопамяти ещё одного персонажа.
      // Ружьё, лежащее на уровне, — это копия узлов прежнего персонажа, и
      // геометрия у неё с ним общая. Убираем его до того, как ту геометрию
      // освободят, иначе оно осталось бы стоять на выброшенных буферах.
      // Положит его заново `onChange` при пересборке локации ниже.
      gunPickup.clear();

      player.dispose();
      player = new Player(freshPlayer);
      player.effects = gunEffects;
      player.blood = blood;
      player.ownBlood = playerBlood;
      player.sfx = sfx;
      player.puffs = puffs;
      player.onAmmo = (left) => { ammo.set(left); showAmmo(); };
      player.onShot = () => camera.shake(CONFIG.player.kick, CONFIG.player.kickFor);
      ammo.set(player.rounds);
      player.placeAt(spot, yaw);
      engine.scene.add(player.root);

      // Стрелка жила на прежнем персонаже и ушла вместе с ним — переселяем её
      // на нового. Без этого она осталась бы висеть на выброшенной модели и
      // пропала бы с экрана после первой же пересборки.
      pointer.attach(player.root);

      // всё, что держало ссылку на прежнего персонажа
      camera.target = player;
      locations.camera = camera;
      locations.player = player;

      // Локацию пересобираем на свежей библиотеке ДО того, как выбросить
      // прежнюю: пока она стоит на старых моделях, их геометрия ещё в работе.
      const oldProps = prefabs;
      const oldZombies = zombies;

      prefabs = freshPrefabs;
      zombies = freshZombies;
      locations.zombies = freshZombies;
      await locations.useLibrary(freshPrefabs);

      // А вот теперь старое никому не нужно. Без этого набор пропов и шаблоны
      // зомби оставались в видеопамяти целиком: замер показывал по два десятка
      // лишних геометрий на каждое нажатие, и они не уходили никогда.
      oldProps?.dispose();
      oldZombies?.dispose();

      Object.assign(window.__game, { player, prefabs, zombies });
      return `${freshPrefabs.prefabs.size} пропов, ${freshZombies.list().length} видов зомби, персонаж`;
    },
  });

  window.__game = {
    engine, player, camera, input, joystick, prefabs, zombies, locations, music, startMessage, ending, splash, fog,
    gunPickup, pointer,
    /** Переключение локаций из консоли: __game.go('gas_station') */
    go: (id) => locations.load(id),
  };
}
