import * as THREE from 'three';
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
import { EndMessage } from './core/EndMessage.js';
import { tally } from './core/tally.js';
import { AmmoPickup } from './entities/AmmoPickup.js';
import { Car } from './entities/Car.js';
import { CarSound } from './core/CarSound.js';
import { Pointer } from './fx/Pointer.js';
import { Joystick } from './ui/Joystick.js';
import { Splash } from './ui/Splash.js';
import { Boot } from './ui/Boot.js';
import { Gate } from './ui/Gate.js';
import { readChain } from './world/chain.js';
import { asset } from './core/paths.js';
import { Music } from './core/Music.js';
import { attachListener, unlockAudio, wakeAudio } from './core/audio.js';
import { StartMessage } from './core/StartMessage.js';
import { ControlsHint } from './ui/ControlsHint.js';
import { yandex } from './core/yandex.js';
import { applyLanguage, levelName } from './core/i18n.js';
import { progress, saveOnLeave } from './core/progress.js';
import { LevelMap, LevelMapButton } from './ui/LevelMap.js';
import { Pause } from './ui/Pause.js';
import { LevelResult } from './ui/LevelResult.js';
import { lockViewport } from './core/viewport.js';
import { SkipHint } from './ui/SkipHint.js';
import { DeathScreen } from './ui/DeathScreen.js';
import { Transmission } from './ui/Transmission.js';
import { Radio } from './ui/Radio.js';
import { Ammo } from './ui/Ammo.js';
import { Stats } from './ui/Stats.js';
import { Ending } from './ui/Ending.js';
import { BattleFog } from './fx/BattleFog.js';
import { Sfx } from './core/Sfx.js';
import { GunEffects } from './fx/GunEffects.js';
import { Blood } from './fx/Blood.js';
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
 * Снять служебный поток, если он остался с прежних сборок.
 *
 * Игра его больше не заводит: обновлениями занимается сам сервер, а поток
 * только мешал — он хранил файлы у себя и раздавал их вместо новых. Но у тех,
 * кто открывал игру раньше, он уже установлен и сам собой не исчезнет: без
 * этой уборки такой игрок навсегда остался бы на той сборке, что успела осесть
 * в его браузере, и никакое обновление до него больше не дошло бы.
 *
 * Разовая и тихая: снимаем поток, выбрасываем его хранилище и молчим. Не вышло
 * — значит и не было, ругаться не о чем.
 */
async function dropServiceWorker() {
  try {
    const workers = await (navigator.serviceWorker?.getRegistrations?.() ?? []);
    await Promise.all(workers.map((one) => one.unregister()));

    // Через `globalThis`, а не прямо по имени: на незащищённом соединении —
    // а это весь dev-сервер по локальной сети — такого имени в браузере нет
    // вовсе, и обращение к нему не вернуло бы пустоту, а бросило бы ошибку.
    const store = globalThis.caches;
    const names = await (store?.keys?.() ?? []);
    await Promise.all(names.map((name) => store.delete(name)));
  } catch {
    // ничего этого в браузере может и не быть — не беда
  }
}
dropServiceWorker();

// Замок на масштаб и прокрутку: щипок растягивал страницу, а холст оставался
// прежним — и экран разъезжался на две половины. Ставится первым делом, до
// всего остального: игрок может ущипнуть экран и на чёрных воротах.
lockViewport();

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

/**
 * Площадка поднимается самой первой, до единой надписи на экране.
 *
 * Причин две. Язык: он берётся у площадки и обязан примениться до того, как
 * собран первый экран — часть надписей читается ровно в тот миг, когда экран
 * создаётся, и переписанные позже они уже никуда не попадут. И прогресс: по
 * нему решается, какой уровень открывать, а решать это надо раньше, чем
 * заставка начнёт готовить картинку.
 *
 * Вне площадки оба вызова отвечают пустотой, и игра идёт своим чередом.
 */
await yandex.start();

/**
 * Язык берётся у площадки, а `?lang=` его перебивает.
 *
 * Перебивает только для проверки: сама площадка тоже открывает игру на нужном
 * языке отдельной вкладкой из своей панели отладки, и переключателя внутри игры
 * быть не должно — это её прямое требование.
 */
applyLanguage(params.get('lang') ?? yandex.language());

const saved = await progress.load();

/**
 * Время похода продолжается с того, на чём вкладку закрыли.
 *
 * Счёт на финале ведёт нынешний заход, а сумму хранят сохранения: город
 * проходят в несколько присестов, и без этого финал показывал время последнего
 * захода вместо всего пути.
 *
 * Само время отдаётся приростом, на каждой остановке часов: смена уровня, экран
 * смерти, карта, свёрнутая вкладка. Отдельной записи ради него не заводится —
 * прирост ложится в ту же отложенную запись, что и место с снаряжением.
 */
tally.seed(progress.played);
tally.onSpent = (seconds) => progress.addPlayed(seconds);

/**
 * Куда игра открывается.
 *
 * Адрес сильнее всего: `?location=` открывает то, что в нём написано. Дальше
 * выбор в панели разработчика. Потом сохранённое у площадки — ради него всё и
 * затевалось: игрок возвращается туда, где остановился. И только если ничего
 * этого нет, игра начинается сначала.
 */
const firstLevel = params.get('location') ?? remembered ?? saved.level ?? CONFIG.locations.first;

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
  /**
   * Цепочку читаем от начала игры, а не от того уровня, с которого её открыли.
   *
   * Это одно и то же, пока игра запускается как задумано. Но в разработке
   * уровень выбирают адресом или панелью, и тогда цепочка от него обрывала всё,
   * что осталось позади: карта уровней показывала не всю игру, а её хвост, а
   * заставки пройденных уровней не готовились вовсе.
   */
  chain = await readChain(CONFIG.locations.first);

  // Уровня, открытого в обход цепочки, в ней может и не быть — тогда дописываем
  // его в конец, чтобы игра знала и о нём.
  if (!chain.some((level) => level.id === firstLevel)) {
    chain.push(...await readChain(firstLevel));
  }

  const files = [];

  for (const level of chain) {
    files.push(asset(`locations/${level.id}.json`));
    files.push(`${CONFIG.splash.folder}${level.number}.png`);
    files.push(`${CONFIG.music.folder}${level.number}.mp3`);
  }
  files.push(`${CONFIG.music.folder}${CONFIG.ending.track}.mp3`);

  // Финальная картинка и ответная передача: они нужны в самом конце, но греются
  // здесь же. Ждать их загрузки после последнего уровня значило бы показать
  // игроку пустой чёрный экран ровно на том месте, где ему отвечают.
  files.push(CONFIG.ending.image, CONFIG.endMessage.file);
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
// Звуки мира слушает камера — точка, куда она смотрит: от неё и считается
// громкость. Слышно то, что видно, — и при пролёте к вожаку, и при облёте
// погибшего. `camera` объявлена ниже, но спрашивают её только в игре.
sfx.hearFrom = () => camera.focus;
const carSound = new CarSound(); // мотор машины: своя дорожка по кругу

const loading = Promise.all([
  loadGLTF(CONFIG.player.modelUrl),
  PrefabLibrary.load(CONFIG.props.libraryUrl, CONFIG.props.prefabsUrl),
  ZombieLibrary.load(CONFIG.zombies.sources),
  preload(extras), // заставки, звуки и картинки — вместе с моделями, а не после
  // Звуки разбираются в память здесь же: на телефоне отложенная загрузка
  // означала тишину первые полминуты боя.
  sfx.load(),
  carSound.load(),
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
const puffs = new Puffs(engine.scene);
const exhaust = new Puffs(engine.scene, CONFIG.exhaust); // дым из выхлопной трубы машины
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
player.onMagazine = (size) => ammo.resize(size); // коробка патронов: гильз стало больше
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
 * Коробка патронов на последнем уровне: подобрал — магазин на двадцать.
 * Взята — стрелка идёт к следующей цели, как и после ружья.
 */
/**
 * Таран на шоссе: подошёл — сел, и уровень дальше едет, а не идёт.
 *
 * Машина есть ровно на одном уровне, поэтому всё про неё собрано здесь, а игра
 * о ней знает одно: пока `car.driving`, ввод уходит ей, а не герою.
 */
const car = new Car(engine.scene);

/**
 * Звук машины.
 *
 * Мотор гудит, пока в ней сидят и игра идёт: на паузе, под картой и в свёрнутой
 * вкладке он стоит, как стоит и сама машина. Проверяется отдельным обновлением,
 * которое идёт всегда, — основной кадр на паузе обрывается раньше, и мотор так
 * и продолжал бы гудеть над стоящим миром.
 */
let carAccelerating = false; // набирала ли машина ход в прошлом кадре
let carPushing = false;      // держали ли газ в прошлом кадре: по этому ловим отпускание
let carGasWait = 0;          // с до следующего рыка: подряд он не повторяется
let carSmoke = 0;            // накопленные доли клуба выхлопа: выпускаем целыми

/**
 * Выпустить клубы из выхлопной трубы.
 *
 * Труба — сзади и чуть сбоку, как у настоящей машины; её место задано в осях
 * кузова и поворачивается вместе с ним. Дым выдувается назад от машины, а дальше
 * поднимается и расплывается сам.
 *
 * @param {number} count — сколько клубов
 */
function smoke(count) {
  if (count <= 0 || !car.root) return;

  const [back, up, side] = CONFIG.car.exhaustAt;
  const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw); // вперёд по кузову
  const rx = fz, rz = -fx;                               // и вбок

  const at = new THREE.Vector3(
    car.position.x + fx * back + rx * side,
    up,
    car.position.z + fz * back + rz * side,
  );
  const blow = new THREE.Vector3(fx, 0, fz).multiplyScalar(-CONFIG.car.exhaustBlow);

  for (let i = 0; i < count; i++) exhaust.burst(at, blow);
}
engine.add({
  update(dt) {
    // `running()` спрашиваем, только когда в машине сидят: это обновление
    // заводится раньше, чем объявлено всё, о чём он спрашивает.
    carSound.set(car.driving && running(), dt, car.driving ? car.speed / CONFIG.car.maxSpeed : 0);
  },
});

car.onBoard = () => {
  carPushing = false;
  carAccelerating = false;
  carGasWait = 0;
  // Герой уезжает внутри машины: модель снимается с глаз, стрельба отбирается
  // вместе с ней. Прятать, а не выбрасывать: обратно он появится, если машину
  // разобьют.
  player.root.visible = false;
  player.frozen = true; // и стрелять он не может: за рулём его вовсе не обновляют

  // За рулём туман войны снимается весь: машина идёт втрое быстрее героя, и
  // дорога впереди должна быть видна раньше, чем до неё доезжаешь.
  fog.revealAll();

  camera.target = car;      // камера ведёт машину
  ammo.root.hidden = true;  // патроны за рулём не считают
  pointer.attach(car.root, CONFIG.car.pointerOffset); // стрелка переезжает на машину — за край кузова
  aimPointer();
};


// Удар о твёрдое: звук один раз и до конца — пока он играет, новых нет.
car.onCrash = () => {
  if (sfx.busy('carCrash')) return;
  sfx.play('carCrash', CONFIG.car.crashVolume, 1, 1, { echo: false, spread: false });
};

car.onRam = (at, speed) => {
  // Сбитый читается ударом: толчок камере, пыль из-под колёс и глухой стук.
  camera.shake(CONFIG.car.ramShake, CONFIG.car.ramShakeFor);
  puffs.burst(at);
  sfx.playAt('throw', at, CONFIG.car.ramVolume * Math.min(1, speed / CONFIG.car.maxSpeed), undefined,
    1, 0.7, { echo: false, spread: false });
};

car.onWreck = (at) => {
  // Машина догорела: взрыв на её месте, и герой выходит там же — дальше пешком,
  // со стрельбой, как на всех прочих уровнях.
  if (at) {
    const CFG = CONFIG.car;

    /**
     * Взрыв как у бочки — та же светящаяся сфера и те же осколки цвета самой
     * вещи, — только крупнее: рвётся не канистра, а целая машина.
     *
     * Кузов разлетается и пропадает. Раньше он оставался стоять целым, а шар
     * загорался внутри него, на высоте метра, — и весь взрыв прятался под
     * крышей. Теперь осколки берут цвет с кузова, пока он ещё есть, и только
     * потом он убирается.
     */
    const at1 = at.clone().setY(CFG.wreckHeight);
    for (let i = 0; i < CFG.wreckShards; i++) {
      const wave = () => {
        shards.burst(at1, car.root);
        puffs.burst(at);
        puffs.burst(at.clone().setY(CFG.wreckHeight + 1.2)); // дым столбом, а не только понизу
      };
      if (i === 0) wave();
      else setTimeout(wave, i * CFG.wreckWave * 1000);
    }

    // Шары — волной вдоль кузова: один, даже большой, — это вспышка посередине,
    // а рвётся машина от капота до багажника.
    const along = new THREE.Vector3(Math.sin(car.yaw), 0, Math.cos(car.yaw));
    for (let i = 0; i < CFG.wreckBlasts; i++) {
      const shift = CFG.wreckBlasts === 1 ? 0 : (i / (CFG.wreckBlasts - 1) - 0.5) * 2 * CFG.wreckSpread;
      const spot = at1.clone().addScaledVector(along, shift);
      spot.x += (Math.random() - 0.5) * 0.8;
      spot.z += (Math.random() - 0.5) * 0.8;
      if (i === 0) explosions.burst(spot);
      else setTimeout(() => explosions.burst(spot), i * CFG.wreckWave * 1000);
    }

    // Хлам вокруг разлетается от удара, как от бочки.
    locations.current.debris?.blast(at, CONFIG.explosion.kickRadius, CONFIG.explosion.kick,
      CONFIG.explosion.lift);

    // Кузова больше нет — осколки уже взяли с него цвет.
    car.root.visible = false;

    camera.shake(CONFIG.explosion.shake * CFG.wreckShake, CONFIG.explosion.shakeFor);
    sfx.play('explosion', CONFIG.explosion.volume, CONFIG.explosion.layers, 1,
      { echo: false, spread: false });

    /**
     * Взрыв сносит тех, кто добивал машину.
     *
     * Без этого высадка была приговором: машину доламывает толпа, стоящая
     * вплотную, герой появляется ровно между ними и гибнет в тот же кадр — с
     * одного удара, ещё не увидев, что случилось. Теперь у него есть расчищенный
     * круг и мгновение, чтобы оглядеться.
     */
    for (const zombie of locations.current.zombies) {
      if (!zombie.alive || zombie === locations.current.boss) continue;
      if (zombie.position.distanceTo(at) > CONFIG.explosion.radius) continue;

      zombie.crush(at, CONFIG.explosion.gore, 'blast');
    }

    // Выходит он сбоку от кузова, а не внутрь него: поставленный в ту же точку,
    // герой стоял прямо в модели — торчал из крыши.
    const side = car.yaw + Math.PI / 2;
    const out = at.clone();
    out.x += Math.sin(side) * CONFIG.car.radius * 1.6;
    out.z += Math.cos(side) * CONFIG.car.radius * 1.6;
    locations.current.clampPosition(out);
    player.placeAt(out, car.yaw);
  }

  player.root.visible = true;
  player.frozen = false;

  // Пешком — снова в тумане войны: карта закрывается и прорезается вокруг героя
  // по мере хода, как на любом другом уровне.
  const here = locations.current;
  if (here) closeFog(here.width, here.depth);

  camera.target = player;
  ammo.root.hidden = !player.armed;
  pointer.attach(player.root);
  aimPointer();
};

const ammoPickup = new AmmoPickup(engine.scene);
ammoPickup.onTaken = () => {
  rememberKit();
  aimPointer();
};

/**
 * Ружьё подобрано.
 *
 * Появились патроны, а указатель переходит к следующей цели. Кончились цели —
 * он гаснет и отпирает выход.
 */
gunPickup.onTaken = () => {
  showAmmo();
  rememberKit();

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
locations.seeThrough = new SeeThrough(engine.camera, engine.renderer);

const music = new Music();
const transmission = new Transmission(); // текст вступления по букве внизу экрана
const startMessage = new StartMessage(transmission); // пока говорит — персонаж стоит

/**
 * Подсказка по управлению: как только вступление отговорило, игрок узнаёт, что
 * от него требуется. Один раз за сеанс и только на том уровне, где звучала речь.
 */
const controlsHint = new ControlsHint();

/** Сноска о том, что речь можно пропустить: живёт ровно столько, сколько речь. */
const skipHint = new SkipHint(transmission.root);

startMessage.onSpeak = () => skipHint.arm();
startMessage.onDone = () => {
  skipHint.hide();
  controlsHint.show();
};

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

/**
 * Снаряжение возвращается вместе с местом.
 *
 * Ружьё и коробку патронов подбирают один раз за игру, и хранится это у
 * площадки рядом с последним уровнем. Без этого игрок, закрывший вкладку на
 * ферме, открывал её там же, но безоружным — а ружьё лежит на вводной, и взять
 * его уже негде.
 */
if (progress.armed) player.arm();
if (progress.magazine > player.magazine) {
  player.extendMagazine(progress.magazine, progress.perReload || CONFIG.ammoPickup.roundsPerReload);
}
const radio = new Radio(); // и рация в углу: видно, откуда голос и почему нельзя идти
const ending = new Ending(); // экран, которым игра кончается

// ?board=demo — финал с выдуманной таблицей рекордов: вёрстку таблицы так видно
// без площадки, где SDK нет и живых строк она не отдаёт.
if (params.get('board') === 'demo') {
  const { showBoardDemo } = await import('./dev/boardDemo.js');
  showBoardDemo(ending);
}

// Ответная передача: тот же голос по рации, но уже после города. Субтитры у неё
// свои — другая запись, другие реплики и другие паузы.
// Ответная передача: свои субтитры — другая запись, другие реплики и паузы, —
// и своя сноска о пропуске над ними.
const endText = new Transmission(document.body, CONFIG.endMessage, true);
const endMessage = new EndMessage(endText, radio, null, new SkipHint(endText.root));
const fog = new BattleFog();  // туман войны: карта открывается по мере хода
fog.start();

/**
 * Туман войны в режиме отладки выключен.
 *
 * С `?debug=` в адресе смотрят на сам уровень — контуры столкновений, ввод,
 * расстановку, — и закрытая карта в этом только мешает. Поэтому всякий раз,
 * когда игра закрывает карту заново, в отладке она тут же открывается целиком.
 *
 * То же даёт галочка «без тумана» в панели разработчика: она помнится между
 * перезагрузками, как и соседние. В собранной игре панели нет, и галочка не
 * действует.
 */
const NO_FOG_KEY = 'dev:noFog';
let NO_FOG = params.has('debug')
  || (import.meta.env.DEV && localStorage.getItem(NO_FOG_KEY) === '1');

/** Закрыть карту туманом — или сразу открыть её, если идёт отладка. */
function closeFog(width, depth) {
  fog.reset(width, depth);
  if (NO_FOG) fog.revealAll();
}

/**
 * Игра пройдена: последний уровень выпустил персонажа наружу.
 *
 * Мир останавливается целиком — не только управление. Иначе за картинкой
 * продолжали бы бегать зомби, топать шаги и хрипеть голоса, и финал звучал бы
 * как продолжение боя. Остаётся одна музыка, зациклённая, как и на уровнях.
 */
let finished = false;

// Открыта ли карта уровней: пока да, мир под ней стоит. Объявлено здесь, рядом
// с таким же флагом финала, и заведомо раньше игрового цикла — тот читает оба.
let mapOpen = false;
let paused = false; // игрок сам остановил игру: `Escape`
let resultOpen = false; // висит итог пройденного уровня: мир стоит до «Продолжить»
let levelStart = { id: null, kills: 0, deaths: 0, seconds: 0 }; // счёт на входе в уровень

/**
 * Игра пройдена — но финал показывается не сразу.
 *
 * Сперва отвечает та, что звала героя через весь город: чёрный экран, рация,
 * речь. Только когда она отговорит, из-под чёрного проступает финальная
 * картинка с итогом пути. Порядок именно такой: разговор — это конец истории, а
 * картинка — то, что после него остаётся.
 */
locations.onPassed = (id) => progress.pass(id);

locations.onFinish = () => {
  if (finished) return;

  finished = true;
  tally.pause();                    // путь кончился: часы больше не идут
  sfx.silence();                    // мир замер — его звуки замолкают вместе с ним

  // Результат уходит в таблицу рекордов площадки: время похода и число смертей
  // строкой. Ждать его ответа не нужно — финал показывается и без него, а
  // таблицу всё равно читаем заново через мгновение.
  yandex.setLeaderboard(
    CONFIG.yandex.leaderboard,
    Math.round(tally.seconds * 1000),
    String(tally.deaths),
  );

  // Под передачей играет дорожка вводной: с неё голос по рации начинался, ею же
  // и кончается. Громкость у неё своя, приглушённая, — она заведена как раз под
  // речь поверх музыки.
  music.play(CONFIG.endMessage.track);

  // А музыка финала начинается вместе с картинкой, когда голос отговорил.
  endMessage.onDone = () => {
    music.play(CONFIG.ending.track);
    ending.show();

    // Таблица подгружается уже поверх финала: пока её нет, игрок видит итог.
    yandex
      .leaderboard(CONFIG.yandex.leaderboard, CONFIG.yandex.leaderboardTop)
      .then((board) => ending.showBoard(board));
  };
  endMessage.play();
};

// Кнопка оценки на финале появляется, только если площадка её примет.
yandex.canReview().then((can) => ending.offerRate(can));
ending.onRate = () => yandex.requestReview();

/** Пройти город заново — прямо с финального экрана. */
ending.onAgain = () => {
  finished = false;
  ending.hide();
  endMessage.skip();

  tally.reset();
  levelStart.id = null; // счёт начат заново — и снимок уровня вместе с ним
  progress.reset();

  // Всё с начала, как при первом запуске: дорожка снимется и начнётся с нуля,
  // а вступление по рации прозвучит ещё раз.
  music.silence();
  startMessage.reset();

  player.revive();
  player.disarm();
  locations.load(CONFIG.locations.first).catch(reportBreak);
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

/**
 * Зум в режиме отладки: колесо мыши и клавиши «+», «−», «0».
 *
 * В игре масштаб один и тот же всегда — по нему выверены и туман, и подсказки,
 * и то, сколько зомби видно заранее. А при отладке нужно то отъехать и увидеть
 * уровень целиком, то приблизиться к одному стыку забора. Поэтому зум есть
 * только на dev-сервере и с `?debug=` в адресе; в собранной игре его нет.
 *
 * Камера ортографическая, и зум у неё — штатный `zoom` three.js: кадрирование
 * под размер экрана он не трогает, только множит масштаб поверх.
 */
if (import.meta.env.DEV || params.has('debug')) {
  const view = engine.camera;
  const setZoom = (value) => {
    view.zoom = Math.min(CONFIG.camera.debugZoomMax, Math.max(CONFIG.camera.debugZoomMin, value));
    view.updateProjectionMatrix();
  };

  // Колесо без Ctrl: с Ctrl браузер приближает саму страницу, и это погашено.
  addEventListener('wheel', (event) => {
    if (event.ctrlKey) return;
    setZoom(view.zoom * Math.pow(CONFIG.camera.debugZoomStep, -Math.sign(event.deltaY)));
  }, { passive: true });

  addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.code === 'Equal' || event.code === 'NumpadAdd') setZoom(view.zoom * CONFIG.camera.debugZoomStep);
    else if (event.code === 'Minus' || event.code === 'NumpadSubtract') setZoom(view.zoom / CONFIG.camera.debugZoomStep);
    else if (event.code === 'Digit0' || event.code === 'Numpad0') setZoom(1); // как в игре
  });
}

engine.add({
  update(dt) {
    stats?.update(engine.renderer); // считаем кадры раньше всего: они идут всегда
    if (editor?.active) {
      editor.update(dt); // мир замер, но камеру ещё водят стрелками
      return;
    }

    // Под заставкой, на финальном экране, на паузе и под картой уровней мир
    // замер: там либо старый уровень уже снят со сцены, либо игра кончилась,
    // либо игрок сам её остановил, — а бежать всё это время персонаж иначе
    // продолжал бы как ни в чём не бывало.
    if (locations.loading || finished || mapOpen || paused || resultOpen || pausedByHost) return;

    /**
     * Камера показывает вожака — мир стоит.
     *
     * Работает только то, без чего картинки нет: сама камера, отсечение по
     * кадру и туман, который проецируется от камеры. Музыка идёт своим ходом,
     * ей цикл не нужен. Персонаж, зомби, физика и указатель ждут.
     */
    if (camera.pausing) {
      camera.update(dt);
      visibility.update(locations.current);
      fog.update(engine.camera, player, dt);
      return;
    }

    input.update();
    watchDeath(); // упал и долежал — поднимаем экран с кнопкой
    player.frozen = startMessage.locked || car.driving; // за рулём он тоже не ходит
    radio.toggle(startMessage.locked);   // рация висит ровно столько, сколько речь
    const here = locations.current;

    if (car.driving) {
      // За рулём ввод уходит машине, а герой едет внутри: его не двигают и не
      // обновляют вовсе — кроме миксера, чтобы поза не застыла на полушаге.
      const speedBefore = car.speed;
      car.update(dt, input.move, camera.moveYaw, here, input.fromKeys);

      /**
       * Разгон — по приросту скорости, а не по нажатию: машина могла и так идти
       * на полном ходу. Когда она и правда набирает ход, она рычит и труба
       * выплёвывает клуб дыма — тем сильнее, чем больше ей предстоит набрать.
       */
      const CAR = CONFIG.car;
      const accelerating = dt > 0 && (car.speed - speedBefore) / dt > CAR.gasFrom;
      carGasWait = Math.max(0, carGasWait - dt);
      if (accelerating && !carAccelerating && carGasWait <= 0) {
        const headroom = Math.max(CAR.gasMinShare, 1 - speedBefore / CAR.maxSpeed);
        sfx.play('carGas', CAR.gasVolume * headroom, 1, 1, { echo: false });
        carGasWait = CAR.gasEvery;
        smoke(Math.round(CAR.exhaustKick * headroom)); // и труба выплёвывает клуб
      }
      carAccelerating = accelerating;

      // Остановка — когда газ бросили, а машина шла ходко.
      const pushing = input.move.lengthSq() > 0;
      if (!pushing && carPushing && speedBefore > CAR.stopFrom) {
        sfx.play('carStop', CAR.stopVolume, 1, 1, { echo: false });
      }
      carPushing = pushing;

      // Выхлоп струйкой: на холостых тонко, чем дальше отведён газ — тем гуще.
      const push = Math.min(1, input.move.length());
      carSmoke += (CAR.exhaustIdle + (CAR.exhaustFull - CAR.exhaustIdle) * push) * dt;
      if (carSmoke >= 1) {
        smoke(Math.floor(carSmoke));
        carSmoke -= Math.floor(carSmoke);
      }

      player.root.position.copy(car.position); // тело едет внутри кузова
    } else {
      player.update(dt, input.move, camera.moveYaw, here);

      // Подошёл к машине — сел. Отдельной кнопки нет: на уровне она одна, и
      // подходить к ней незачем, кроме как чтобы ехать.
      if (car.reachable(player.position)) car.board();
    }

    // Кто сейчас идёт по уровню: герой или машина. Вехи, выход и зомби смотрят
    // на него одного — им всё равно, на чём игрок приехал.
    const hero = car.driving ? car : player;

    // Дошёл до вехи — она гаснет, и стрелка ведёт к следующей цели.
    if (here.reachGuide(hero.position)) aimPointer();

    if (here.reachedExit(hero.position)) {
      locations.advance(); // вышел через проём — следующая локация
    } else if (!car.driving) {
      // в прыжке он летит над препятствием, поэтому выталкивать его оттуда нельзя
      if (!player.jumping) here.obstacles.resolve(player.position, CONFIG.player.radius);
      here.clampPosition(player.position); // и за забор тоже
    }
    here.update(dt, hero); // зомби: заметить, дойти, ударить
    gunEffects.update(dt);
    blood.update(dt);
    playerBlood.update(dt);
    explosions.update(dt);
    shards.update(dt);
    gunPickup.update(dt, player); // лежащее ружьё: крутится, а подошёл — летит в руки
    ammoPickup.update(dt, player); // и коробка патронов — точно так же
    pointer.update(dt); // стрелка держит цель: поворот носителя — героя или машины — вычитает сама
    puffs.update(dt);
    exhaust.update(dt);
    camera.update(dt);
    // После камеры: полоски строятся по её осям. Машина в них же — пока в ней едут.
    healthBars.update(engine.camera, here, player, car.driving ? [car] : []);
    visibility.update(here); // ушедшее за край экрана не рисуем вовсе
    watchAmmo();
    // просвечивает только заслонившее героя или зомби у него на прицеле
    locations.seeThrough.update(dt, player, player.spotted);
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

/** Отложить в сохранения снаряжение героя: ружьё и вместимость магазина. */
function rememberKit() {
  progress.setKit({
    armed: player.armed,
    magazine: player.magazine,
    perReload: player.roundsPerReload,
  });
}

/** Патроны показываем, только когда есть чем стрелять — и не из-за руля. */
function showAmmo() {
  ammo.root.hidden = !player.armed || car.driving;
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

  /**
   * Дошёл ли герой до конца пути: вехи кончились.
   *
   * Отсюда меняется всё остальное. Пока вехи впереди, стрелка ведёт по ним; а
   * когда пройдены все, дорога позади, и вести назад ей уже нечего.
   */
  const marks = here?.guide ?? [];
  const wayDone = marks.length > 0 && marks.every((mark) => mark.done);

  /**
   * Ружьё: к нему ведём с подсветкой и с любого расстояния — пока оно лежит,
   * это единственное, что нужно сделать.
   *
   * Но только пока герой не ушёл. Прошёл весь уровень, не подобрав ружья, —
   * стрелка на него больше не показывает: он уже у запертого выхода, и тянуть
   * его назад через всю площадку незачем. Дальше он смотрит только на выход,
   * а тот всё равно не пустит без оружия.
   */
  const gun = gunPickup.object && !player.armed ? gunPickup.object : null;
  if (gun && !wayDone) targets.push({ at: gun, halo: true });

  // Машина: пока в неё не сели, это главное на уровне — к ней и ведём, с кругом
  // на полу, как к вещи, которую надо подобрать. Села — стрелка идёт дальше, к
  // вехам и выезду, а обратно к машине ей уже незачем.
  if (car.object && !car.driving && !car.wrecked) targets.push({ at: car.object, halo: true });

  // Коробка патронов: с кругом, как ружьё, — пока игрок её не проигнорировал.
  // В очереди её держит только это: выход она не запирает, брать необязательно.
  const shells = ammoPickup.object && !ammoPickup.skipped ? ammoPickup.object : null;
  if (shells) targets.push({ at: shells, halo: true });

  // Вожак: пока жив, стрелка ведёт только на него — с любого расстояния и без
  // круга на полу, под таким великаном его всё равно не видно. Выход за ним в
  // очереди и сам откроется, когда вожак упадёт.
  const boss = here?.boss?.alive ? here.boss : null;
  if (boss) targets.push({ at: boss, halo: false });

  /**
   * Вехи по дороге: точки, через которые лежит путь.
   *
   * Идут раньше всего прочего, кроме подбираемых вещей: веха стоит на повороте,
   * а выход — в конце уровня, и без неё стрелка тянула бы напрямик, сквозь
   * стены. Пройденные из очереди уходят сами.
   */
  for (const mark of here?.guide ?? []) {
    if (!mark.done) targets.push({ at: mark.at, halo: mark.halo });
  }

  // Уровень, где выход — только через всех: пока живы, выход заперт, а когда
  // перебиты, стрелка ведёт к нему с любого расстояния.
  const clearing = Boolean(here?.mustClear);

  /**
   * Выход: с любого расстояния, но без круга на полу.
   *
   * Расстояния тут больше нет. Оно было: стрелка подхватывала выход за
   * двадцать шесть метров, а дальше гасла — и на больших уровнях игрок
   * оставался без всякой подсказки посреди площадки, разыскивая переход
   * наугад. Круг под ним по-прежнему не рисуем: он читался бы как «встань
   * сюда», а выход и так на виду, когда до него дошли.
   */
  // Показываем его и на зачищаемом уровне: идти всё равно туда, а что он
  // заперт, видно по самой метке — она тускнеет, пока не перебиты все.
  if (here?.exitMark) {
    targets.push({ at: here.exitMark, halo: false });
  }

  pointer.follow(targets);

  // Выход заперт, пока не взято ружьё: уйти без него значит прийти на следующий
  // уровень безоружным. На вводном уровне запор ружьём не держит: уйти можно
  // и без него, а ружьё остаётся наградой для тех, кто его поднимет.
  // И пока жив вожак: уйти, не победив его, нельзя.
  // Запирает выход само ружьё, а не стрелка: она может уже и не вести к нему,
  // но пройти дальше без оружия всё равно нельзя.
  const zeroLevel = here?.data?.number === 0;
  here?.lockExit((!zeroLevel && Boolean(gun)) || Boolean(boss) || clearing);
}

/**
 * Прошёл ли игрок мимо патронов.
 *
 * Стрелка ведёт к коробке, пока та на экране. Побывала в кадре и ушла из него
 * невзятой — значит игрок решил не брать, и стрелка переходит к следующей цели.
 * Вернуться к ней можно, но уже без подсказки.
 *
 * Считается именно «была и ушла», а не просто «не видно»: в начале уровня
 * коробка может ещё не попасть в кадр, и забыть её сразу было бы неверно.
 */
function watchAmmo() {
  if (!ammoPickup.object || ammoPickup.skipped || ammoPickup.flight > 0) return;

  const inView = visibility.inView(ammoPickup.object.position);
  if (inView) {
    ammoPickup.seen = true;
    return;
  }
  if (!ammoPickup.seen) return;

  ammoPickup.skipped = true;
  aimPointer();
}

/** Название нынешнего уровня на языке игры. */
function levelTitle() {
  const level = locations.current?.data;
  return level ? levelName(level.id, level.name) : '';
}

function showHud() {
  hud.hidden = false;
  hud.textContent = editor?.active
    ? `${levelTitle()} · правка`
    : levelTitle();
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
/**
 * Толпа за заграждением: что сцена показывает и как звучит.
 *
 * Камера летит к толпе, не останавливая игру, — герой в это время может и
 * бежать, и стрелять. Толпа ревёт одним разом, а не каждым зомби поодиночке:
 * голоса зомби гаснут с расстоянием от героя, и далёкая толпа молчала бы.
 * Каждый кусок заграждения разлетается осколками своего цвета, в пыли.
 */
function wireHorde(location) {
  const CFG = CONFIG.horde;

  // Один пролёт на весь прорыв: камера уходит к заграждению, показывает, как
  // оно разлетается, и возвращается к герою. Игра при этом не останавливается.
  let hordeAt = null; // где стоит толпа: оттуда она и ревёт
  location.onHorde = (at) => {
    hordeAt = at.clone(); // отсюда же потом ревёт толпа
    fog.revealAll(); // толпа бежит по всей дороге — прятать в тумане больше нечего
    camera.show(at.clone(), 1.4, { pause: false, timing: CFG.camera });
    aimPointer();    // к заграждению больше не ведём: герой его уже нашёл
  };

  location.onHordeWake = () => {
    sfx.playAt('zombieAlert', hordeAt, CFG.roarVolume, CFG.hearing, 3, CFG.roarPitch);
  };

  let crashed = false;
  let broken = 0; // какая по счёту секция заграждения рушится
  location.onBreak = (object) => {
    const at = object.position.clone().setY(0.6);

    // Не один залп, а несколько подряд: секция сетки крупная, и одной горсти
    // осколков на неё мало — разлёт читается как щелчок, а не как обвал.
    for (let i = 0; i < CFG.bursts; i++) {
      const wave = () => {
        shards.burst(at, object);
        puffs.burst(at);
        puffs.burst(at.clone().setY(CFG.dustAbove)); // пыль столбом, а не только под ногами
      };
      if (i === 0) wave();
      else setTimeout(wave, i * CFG.burstEvery * 1000);
    }

    /**
     * И огонь — тот же шар, что у взорванной бочки.
     *
     * Не на каждой секции: их два десятка, и огонь на всех сразу — сплошная
     * пелена, в которой не разобрать ни одного взрыва. Через две на третью
     * выходит цепь, идущая волной вдоль заграждения: видно и ширину пролома, и
     * что рвануло по всей стене, а не в одной точке.
     */
    const piece = broken++;
    if (piece % CFG.flashEach === 0) {
      const spot = at.clone().setY(CFG.flashHeight);
      spot.x += (Math.random() - 0.5) * 2 * CFG.flashSpread;
      spot.z += (Math.random() - 0.5) * 2 * CFG.flashSpread;

      const wave = (piece / CFG.flashEach) * CFG.flashWave * 1000;
      if (wave <= 0) explosions.burst(spot);
      else setTimeout(() => explosions.burst(spot), wave);
    }

    // Грохот и тряска — один раз на всё заграждение, а не на каждый кусок.
    if (crashed) return;
    crashed = true;
    camera.shake(CFG.shake, CFG.shakeFor);

    // Одной дорожкой и без отзвука: раскат от домов и наложенные копии делали
    // из удара кашу — грохот расползался и терял тот самый миг обвала.
    sfx.playAt('explosion', at, CONFIG.explosion.volume * CFG.crashVolume, CFG.hearing,
      1, 0.62, { echo: false, spread: false });
  };

  location.onCleared = () => aimPointer(); // перебиты все — выход открыт, стрелка к нему
}

/** Что сцена делает со взрывом: вспышка на месте и толчок камере. */
function wireBlasts(location) {
  location.onBlast = (at, object = null) => {
    const CFG = CONFIG.explosion;

    explosions.burst(at);
    shards.burst(at, object); // и сама вещь разлетается кусками своего цвета
    camera.shake(CFG.shake, CFG.shakeFor);

    // Дальний взрыв слышно тише: иначе бочка на том конце площадки грохочет
    // так же, как та, что рванула под ногами. Без отзвука и без разброса между
    // дорожками: у взрыва свой длинный хвост, и повтор сэмпла вдогонку слышался
    // не как эхо, а как второй взрыв через долю секунды.
    sfx.playAt('explosion', at, CFG.volume, CFG.hearing, CFG.layers, 1, { echo: false, spread: false });
  };
}

/**
 * Смерть: экран с кнопкой, и уровень начинается заново только по ней.
 *
 * Раньше сгодилось бы любое нажатие, и это выходило боком: игрок погибал, не
 * отпустив стика, и первое же его движение начинало уровень заново — падения он
 * не видел вовсе. Кнопка эту случайность убирает.
 */
/**
 * Карта уровней и кнопка, которой она открывается.
 *
 * Открыты все уровни и всегда: игра короткая, запирать в ней нечего, и ничего о
 * пройденном она не помнит. Список берётся из уже прочитанной цепочки — читать
 * файлы второй раз незачем.
 */
const levelMap = new LevelMap();
const mapButton = new LevelMapButton();

mapButton.onPress = () => {
  levelMap.fill(chain, locations.current?.data?.id, (id) => progress.isPassed(id));
  levelMap.show();
};

levelMap.onPick = (id) => {
  if (id === locations.current?.data?.id) return; // тот же уровень заново не грузим
  locations.load(id).catch(reportBreak);
};

/**
 * Пока карта открыта, мир под ней стоит.
 *
 * Иначе зомби доберутся до героя, пока тот разглядывает список, и возвращаться
 * будет уже некуда. Тот же приём, что и в правке расстановки: игровой цикл
 * видит поднятый флаг и не трогает ни персонажа, ни толпу.
 */
levelMap.onToggle = (on) => {
  mapOpen = on;
  if (on) tally.pause(); else tally.resume(); // под картой время пути стоит
  if (on) yandex.pause(); else yandex.play(); // открытая карта — это пауза
  joystick.setEnabled(!on); // и стик под картой не ловит палец
  input.enabled = !on;
};

// Под ответной передачей кнопки карты быть не должно: игра уже кончилась, и
// уходить с финала на уровень некуда.
endMessage.mapButton = mapButton;

const deathScreen = new DeathScreen();

/**
 * Пауза: `Escape` ставит, `Enter` снимает.
 *
 * Останавливает ровно то же, что и карта уровней, и по той же причине: под
 * открытым экраном зомби дошли бы до героя сами. Время пути тоже стоит — иначе
 * поставленная на ночь пауза приписала бы игроку восемь часов похода.
 */
const pause = new Pause();

pause.onToggle = (on) => {
  paused = on;
  if (on) tally.pause(); else tally.resume(); // на паузе время пути стоит
  if (on) yandex.pause(); else yandex.play(); // и для площадки это тоже пауза
  joystick.setEnabled(!on); // стик под экраном не ловит палец
  input.enabled = !on;
};

/**
 * Итог уровня: после выхода с каждого уровня, кроме последнего.
 *
 * Тот же вид, что у финала, но цифры за один уровень — считаются от снимка,
 * снятого на входе в него. Мир на это время стоит так же, как под паузой, а
 * следующий уровень грузится только по «Продолжить».
 */
const levelResult = new LevelResult();

locations.onLevelDone = (id, proceed) => {
  resultOpen = true;
  tally.pause();   // время за итогом в путь не идёт
  yandex.pause();  // для площадки это пауза
  joystick.setEnabled(false);
  input.enabled = false;

  const data = locations.current?.data ?? {};
  levelResult.show({
    name: levelName(id, data.name ?? id),
    number: data.number ?? 1,
    kills: tally.kills - levelStart.kills,
    deaths: tally.deaths - levelStart.deaths,
    seconds: tally.seconds - levelStart.seconds,
  });

  levelResult.onContinue = () => {
    resultOpen = false;
    joystick.setEnabled(true);
    input.enabled = true;
    yandex.play();
    proceed(); // заставка и следующий уровень — дальше всё как раньше
  };
};

/**
 * Можно ли вставать на паузу прямо сейчас.
 *
 * Под заставкой и финальной речью `Escape` занят пропуском: одно нажатие иначе
 * и оборвало бы речь, и подняло экран. На экране смерти, под картой и на финале
 * мир и так стоит — вставать там не от чего.
 */
pause.canOpen = () => !locations.loading && !finished && !mapOpen && !resultOpen && !editor?.active
  && !deathScreen.shown && !startMessage.locked && !endMessage.speaking;


/**
 * Площадка просит остановиться и продолжить.
 *
 * Приходит при показе рекламы, переключении вкладки и сворачивании окна. Своё
 * состояние паузы ведём отдельным флагом, а не выводим из этих событий: игра
 * могла встать и сама — под картой уровней или в правке расстановки, — и тогда
 * возвращать её в ход по чужой команде нельзя.
 */
let pausedByHost = false;
yandex.onPause = () => { pausedByHost = true; tally.pause(); };
yandex.onResume = () => { pausedByHost = false; if (running()) tally.resume(); };

/**
 * Идёт ли мир прямо сейчас.
 *
 * По этому же решают и часы пути: время засчитывается ровно тогда, когда игрок
 * и правда идёт по городу, — не под рекламой, не под картой, не на экране
 * смерти и не в свёрнутой вкладке.
 */
function running() {
  return !locations.loading && !finished && !mapOpen && !paused && !resultOpen && !pausedByHost
    && !deathScreen.shown && player.alive && !document.hidden;
}

// Вкладку убрали из виду — часы встают: свёрнутый браузер и переключение на
// другое приложение это не игра. Площадка присылает об этом и своё событие, но
// вне её никаких событий нет, а время идти не должно всё равно.
//
// Подписано ДО `saveOnLeave`: уходя со страницы, часы сперва отдают недосчитанный
// отрезок, и только потом сохранения дожимают отложенную запись. В обратном
// порядке последние минуты не успевали бы уйти.
addEventListener('visibilitychange', () => {
  if (document.hidden) tally.pause();
  else if (running()) tally.resume();
});
addEventListener('pagehide', () => tally.pause());

saveOnLeave();

/**
 * Ещё раз: тот же уровень с начала, через рекламный ролик.
 *
 * Перезапуск только за досмотренный ролик: отказался игрок (кнопка «Отказаться»
 * на самой рекламе), закрыл её раньше времени или ролика вовсе не нашлось —
 * уровень не трогаем, экран смерти остаётся со своими кнопками. Сбросить игру
 * при желании можно и кнопкой «С начала», которая рекламы не требует.
 *
 * Момент выбран нарочно: игрок в эту секунду ничего не делает, он только что
 * умер и сам нажал кнопку. Показывать ролик там, где по экрану возят пальцем,
 * площадка прямо запрещает — случайные нажатия она считает обманом.
 */
deathScreen.onAgain = async () => {
  const result = await yandex.showRewarded();

  // Не досмотрел — награды нет: остаёмся на экране смерти, где игрок сам решит,
  // попробовать «Ещё раз» снова или начать с начала.
  if (result !== 'rewarded') {
    deathScreen.show();
    return;
  }

  /**
   * Пауза площадки снимается здесь же, а не ждёт её сигнала.
   *
   * Показывая ролик, площадка присылает «встать», а по его концу — «идти
   * дальше». Второе приходит не всегда: ролик закрыли слишком быстро, сеть
   * подвела, ролика не нашлось вовсе. Игра в этом случае молча стояла: уровень
   * собирался, картинка была, а мир не двигался, и со стороны это выглядело как
   * «перезапуск не сработал».
   *
   * Ролик кончился — значит игра идёт. Это мы знаем наверняка, и ждать
   * подтверждения не от кого.
   */
  pausedByHost = false;

  tally.resume();
  player.revive();
  await locations.load(locations.current.data.id).catch(reportBreak);
};

/**
 * С начала: вся игра заново, с первого уровня.
 *
 * Сбрасывается не только место, но и оружие: вводная локация начинается
 * безоружным, ружьё лежит там на полу, и поднять его нужно заново.
 */
deathScreen.onFromStart = async () => {
  // Пройденное стирается: игрок согласился на это в отдельном окне, и с этой
  // минуты игра для него начинается с чистого листа.
  progress.reset(); // вместе с прогрессом уходит и снаряжение
  tally.reset();
  levelStart.id = null; // счёт начат заново — и снимок уровня вместе с ним

  // Всё с начала, как при первом запуске: дорожка снимется и начнётся с нуля,
  // а вступление по рации прозвучит ещё раз.
  music.silence();
  startMessage.reset();

  player.revive();
  player.disarm();
  await locations.load(CONFIG.locations.first).catch(reportBreak);
};

/**
 * Пора ли поднимать экран смерти. Зовётся каждый кадр из игрового цикла.
 *
 * Мгновение смерти и конец падения считает сам персонаж, в тот же миг, когда
 * его убили: он отмеряет длину падения по своей анимации. Игра раньше засекала
 * смерть своим кадром — то есть на кадр позже удара, — и экран успевал выскочить
 * прежде, чем персонаж коснулся земли.
 */
function watchDeath() {
  // В правке расстановки уровень не перезапускается: там двигают предметы, и
  // погибший под редактором персонаж уводил бы уровень из-под рук.
  if (editor?.active || locations.loading || finished) {
    deathScreen.hide();
    return;
  }

  if (player.alive) return;
  if (performance.now() < player.restartAt) return;

  // Нажато «Ещё раз» и идёт ролик: экран смерти на это время спрятан, но это та
  // же смерть. Поднимать его заново и засчитывать вторую смерть нельзя — после
  // ролика он либо сам вернётся (отказался от награды), либо уровень начнётся.
  if (deathScreen.busy) return;

  if (!deathScreen.shown) {
    yandex.pause();   // попытка кончилась — геймплей встал
    tally.deaths += 1;
    tally.pause();    // и часы пути вместе с ней: под экраном смерти никто не идёт
  }
  deathScreen.show();
}

/**
 * Уровень уходит — геймплей встал.
 *
 * Площадка меряет по этим отметкам своё, и правило у неё простое: остановиться
 * надо в тот же миг, когда игра и правда встала. Под заставкой мир не живёт,
 * значит и отметка ставится здесь, а не после сборки нового уровня.
 */
locations.onLoading = () => {
  yandex.pause();
  tally.pause(); // под заставкой герой не идёт — и время ему не идёт
};

locations.onChange = (location) => {
  deathScreen.hide(); // уровень начинается заново — экрану смерти тут не место

  // Где игрок остановился: по этому месту игра и откроется в следующий раз.
  progress.setLevel(location.data.id);

  wireBlasts(location);
  location.onKill = () => { tally.kills += 1; };
  location.onBossDown = () => aimPointer(); // вожак упал — стрелка к выходу, выход открыт

  /**
   * Шаг вожака: земля вздрагивает.
   *
   * Сила падает с расстоянием и за `stepShakeRange` гаснет совсем: вздрагивать
   * от шагов, которых даже не слышно, кадр не должен.
   */
  location.onBossStep = (away) => {
    const CFG = CONFIG.boss;

    // Гаснет не сразу, а к самому краю: вблизи сила почти полная, и толчок
    // читается, пока вожак в кадре. Линейное затухание съедало его уже на
    // середине радиуса — а там он обычно и стоит, швыряя хлам.
    const share = 1 - Math.min(1, away / CFG.stepShakeRange) ** 2;
    if (share <= 0) return;

    camera.shake(CFG.stepShake * share, CFG.stepShakeFor);
  };
  wireHorde(location);
  // Вожак заметил героя — его круг разом проступает из тумана, а камера плывёт
  // к нему, показывает и возвращается. Смотрим на уровень груди великана.
  location.onBossSpotted = (boss) => {
    fog.reveal(boss.position.x, boss.position.z, CONFIG.boss.senseRadius);
    camera.show(boss.position, boss.bodyHeight * 0.5);
  };
  gunPickup.place(location, player, locations.editing); // в правке лежит всегда
  ammoPickup.place(location, player, locations.editing);

  // Машина есть ровно на одном уровне; на всех прочих `place` просто снимает
  // прежнюю. Заодно возвращаем герою вид и управление: уровень начинается с
  // того, что он стоит на своих двоих, даже если прошлый кончился за рулём.
  car.place(location);
  player.root.visible = true;
  camera.target = player;

  // Камера встаёт на героя сразу, без перелёта. Менеджер уровней уже ставил её
  // мгновенно — но на прежнюю цель: если уровень кончился за рулём, это была
  // машина на старом месте, и камера потом ехала оттуда через всю карту.
  camera.snap();
  pointer.attach(player.root);

  aimPointer();
  showAmmo();
  showHud();
  updateDebugView();
  closeFog(location.width, location.depth); // новый уровень — заново закрытая карта
  // Своя дорожка у каждого уровня, кроме тех, где её нет: `music: null` в файле
  // уровня — это тишина под ветер, а не отсутствующий файл.
  music.play(location.data.music === null ? null : (location.data.music ?? location.data.number ?? 1));
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
  tally.resume(); // уровень открылся — путь пошёл

  // Итог уровня считается от входа в него. Перезапуск после смерти — это тот же
  // уровень, и снимок не сбрасывается: смерти на нём и время всех попыток
  // входят в его итог.
  if (levelStart.id !== location.data.id) {
    levelStart = { id: location.data.id, kills: tally.kills, deaths: tally.deaths, seconds: tally.seconds };
  }
  startMessage.arm(location.data.number ?? 1);

  /**
   * Площадке говорим, что игра готова, ровно здесь.
   *
   * Не тогда, когда догрузились файлы, а тогда, когда ушёл последний экран и
   * игрок может действовать: площадка меряет именно этот миг. Второй раз
   * говорить нечего, дальше это просто смена уровней.
   */
  yandex.loaded();

  // Уровень открылся — геймплей пошёл.
  yandex.play();
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
    onToggle: (on) => {
      showHud();
      // В правке те же WASD водят камеру — персонажу они на это время не свои.
      input.enabled = !on;
      if (on) {
        controlsHint.hide();  // и подсказка по управлению там ни к чему
        skipHint.hide();
        deathScreen.hide();   // и экран смерти: в правке уровень не перезапускают
        levelMap.hide();      // и карта: уровни там переключают стрелками панели
      }
      mapButton.root.hidden = on;
    },
    toggles: [{
      label: 'без вступления',
      value: startMessage.muted,
      onChange: (off) => {
        startMessage.mute(off);
        localStorage.setItem(NO_INTRO, off ? '1' : '0');
      },
    }, {
      label: 'без тумана',
      value: NO_FOG,
      onChange: (off) => {
        localStorage.setItem(NO_FOG_KEY, off ? '1' : '0');
        NO_FOG = off || params.has('debug');

        // Действует сразу, без перезагрузки: сняли галочку — карта снова
        // закрыта, и туман прорезается вокруг героя заново.
        const here = locations.current;
        if (NO_FOG) fog.revealAll();
        else if (here) closeFog(here.width, here.depth);
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
      ammoPickup.clear(); // модель у неё из библиотеки уровня, которую сейчас сменят
      car.clear();        // и машина оттуда же

      player.dispose();
      player = new Player(freshPlayer);
      player.effects = gunEffects;
      player.blood = blood;
      player.ownBlood = playerBlood;
      player.sfx = sfx;
      player.puffs = puffs;
      player.onAmmo = (left) => { ammo.set(left); showAmmo(); };
      player.onMagazine = (size) => ammo.resize(size);
      ammo.resize(player.magazine);
player.onMagazine = (size) => ammo.resize(size); // коробка патронов: гильз стало больше
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
    gunPickup, ammoPickup, car, pointer, controlsHint, skipHint, deathScreen, levelMap,
    endMessage, // ответная передача: её удобно щупать из консоли
    yandex, progress, // площадка и сохранения: их удобно щупать из консоли
    sfx, carSound, // звуки: какие играют и насколько громко — для отладки громкостей
    /** Переключение локаций из консоли: __game.go('gas_station') */
    go: (id) => locations.load(id),
  };
}
