import { CONFIG } from '../config.js';
import { asset } from './paths.js';

/**
 * Язык игры: определяется один раз при запуске и больше не меняется.
 *
 * Так предписано площадкой: язык берётся из её интерфейса в момент старта, а
 * переключателя внутри игры быть не должно. И два языка на экране разом тоже
 * запрещены, поэтому выбранный применяется целиком, до первого показанного
 * экрана.
 *
 * Устроено переписыванием готовых настроек, а не отдельным словарём, из
 * которого все спрашивают строки. Причина простая: надписи в игре и так лежат
 * в настройках рядом с тем, что они описывают, и разносить их по двум местам
 * значило бы держать список ключей, который однажды разойдётся с игрой. Здесь
 * же перевод — это просто другое значение того же поля.
 *
 * Русский ничего не переписывает: он и так лежит в настройках.
 */

/** Какие языки игра знает. Первый — родной, на нём написаны сами настройки. */
export const LANGUAGES = ['ru', 'en'];

/**
 * Переводы: путь в настройках → строка или набор строк.
 *
 * Путь тот же, что и в самих настройках, поэтому найти, куда ложится перевод,
 * можно поиском по имени поля.
 */
const EN = {
  'gate.label': 'Play',
  'gate.keyBefore': 'or press',

  'boot.failed': 'The game did not load. Check your connection and reload the page.',

  'boot.lines': [
    'Loading ammo… and a little optimism.',
    'The zombies are waiting patiently… almost.',
    'Loading the map. We hope there is a way out on it.',
    'Filing the brains away.',
    'Loading survivors… those still counted as such.',
  ],

  // Подсказка по клавишам — одна на все экраны с выбором.
  'keys.pick': '↑ ↓ — choose · Enter — confirm',
  'keys.pickRow': '← → — choose · Enter — confirm',
  'keys.press': 'Enter — confirm',
  'keys.close': 'Esc — close',

  'death.title': 'You died',
  'death.note': 'The city forgives no pauses',
  'death.again': 'Once more',
  'death.fromStart': 'From scratch',
  'death.confirmTitle': 'Start over?',
  'death.confirmNote': 'Levels you have passed will be lost',
  'death.keep': 'Cancel',
  'death.wipe': 'Start over',

  'controlsHint.titleKeys': 'Lead your man',
  'controlsHint.titleTouch': 'Lead your man',
  'controlsHint.note': 'Shooting, vaulting and throwing he does himself',
  'controlsHint.tailKeys': 'press any key',
  'controlsHint.tailTouch': 'touch the screen',

  'skipHint.keys': 'Esc — skip',
  'skipHint.touch': 'tap to skip',

  'pause.title': 'Paused',
  'pause.note': 'Shooting, vaulting and throwing he does himself',
  'pause.hintKeys': 'Lead your man',
  'pause.hintTouch': 'Lead your man',
  'pause.tailKeys': 'Esc or Enter — resume',
  'pause.tailTouch': 'touch the screen to resume',

  'levelMap.title': 'Levels',
  'levelMap.openLabel': 'Open the level map',
  'levelMap.closeLabel': 'Close the map',
  'levelMap.hereLabel': 'here',
  'levelMap.passedLabel': 'cleared',
  'levelMap.lockedLabel': '🔒 locked',
  // Не строка, а способ её собрать: у нулевого уровня номера нет, у остальных есть.
  'levelMap.numberLabel': (number) => (number === 0 ? 'Start' : `Level ${number}`),

  'ending.title': 'Finale',
  'ending.caption': 'Through the Dead City',
  'ending.killsLabel': 'Put down',
  'ending.deathsLabel': 'Deaths',
  'ending.timeLabel': 'On the road',
  'ending.againLabel': 'Play again',
  'ending.rateLabel': 'Rate the game',
  'ending.boardTitle': 'Records',
  'ending.boardTimeLabel': 'Time',
  'ending.boardDeathsLabel': 'Deaths',
  'ending.boardHidden': 'User is hidden',

  'levelResult.doneLabel': 'cleared',
  'levelResult.killsLabel': 'Put down',
  'levelResult.deathsLabel': 'Deaths',
  'levelResult.timeLabel': 'On the road',
  'levelResult.continueLabel': 'Continue',
  'levelResult.enterHint': 'Enter — continue',

  'endMessage.file': asset('assets/audio/end_message_eng.mp3'),
  'endMessage.lines': [
    'I hear you. God, I hear you.',
    'You made it out. You really made it out.',
    "I see a light at the northern post — that's you, isn't it? Wave at me. Just wave.",
    'I called into nothing so many times I stopped believing anyone would answer.',
    'There are people here. There are children, can you believe it. They kept asking if anyone else would come.',
    "Walk to the gate, they're waiting for you. You don't have to go anywhere alone anymore.",
    'You made it.',
  ],
  // Своя запись — свои паузы, замеренные по ней же: по огибающей громкости и
  // сверенные с разбором речи по словам. Каждая отметка стоит на настоящей
  // паузе между репликами, поэтому темп по всей записи ровный — около 18
  // знаков в секунду, от первой реплики до последней.
  'endMessage.times': [0.04, 2.46, 5.06, 10.6, 14.64, 20.68, 25.62],

  // Голос вступления и его субтитры: своя дорожка и свой текст.
  'startMessage.file': asset('assets/audio/start_message_eng.mp3'),
  // Слово в слово с озвучкой: субтитры идут за самой дорожкой, и расхождение
  // текста с голосом видно сразу.
  'startMessage.lines': [
    'Hey... If you can hear me — answer.',
    "I made it to the evacuation point beyond the northern edge of the city. But they won't wait here for long.",
    "After the accident, they found you near the old farm. I've been trying to reach you every day.",
    'The main road is blocked. The only way through is through the city.',
    'That place is crawling with those things. Stay away from them. If you can go around — do it.',
    "And if you have to shoot... do it from a distance. Don't let them get close.",
    'You need to reach the northern exit.',
    'Please... make it in time.',
    "I'll be waiting.",
  ],
};

/**
 * Названия уровней: они живут в файлах самих уровней, а не в настройках.
 * Ключ — имя уровня, то же, что в адресе.
 */
const LEVEL_NAMES = {
  en: {
    tutorial: 'House on the Outskirts',
    farm: 'Wilson Farm',
    gas_station: 'Gas Station on Route 40',
    highway: 'Highway to the Crossroads',
    crossroads: 'The Dead Crossroads',
    north_exit: 'The North Exit',
  },
};

let current = LANGUAGES[0];

/** На каком языке идёт игра. */
export function language() { return current; }

/**
 * Свести язык площадки к тому, что игра знает.
 *
 * Площадка отдаёт код из двух букв и сама подставляет запасной, если родного
 * языка игрока среди её двадцати шести нет. Нам остаётся отмести то, чего не
 * знаем уже мы: всё незнакомое идёт на английский, как принято.
 *
 * @param {string} [code] — код языка от площадки
 */
export function pickLanguage(code) {
  const wanted = String(code || '').slice(0, 2).toLowerCase();
  return LANGUAGES.includes(wanted) ? wanted : 'en';
}

/**
 * Применить язык: переписать надписи в настройках.
 *
 * Зовётся до того, как собран первый экран. Позже нельзя: часть надписей
 * читается в тот миг, когда экран создаётся, и переписанные после этого они уже
 * никуда не попадут.
 *
 * @param {string} code
 */
export function applyLanguage(code) {
  current = pickLanguage(code);

  /**
   * Сказать языку страницы, что он сменился.
   *
   * Не косметика и не про читалки одни. Браузер смотрит на `lang` и, увидев
   * русский документ у англоязычного игрока, предлагает перевести страницу —
   * своей полосой поверх игры. А переводить тут нечего: весь текст игра ставит
   * сама и уже на нужном языке.
   *
   * Ставится до выхода по родному языку: русский тоже надо объявить, если до
   * этого в разметке стояло другое.
   */
  document.documentElement.lang = current;

  if (current === LANGUAGES[0]) return; // родной язык уже в настройках

  const words = current === 'en' ? EN : null;
  if (!words) return;

  for (const [path, value] of Object.entries(words)) {
    put(CONFIG, path, value);
  }
}

/**
 * Название уровня на нынешнем языке.
 *
 * Отдельно от прочего: названия лежат в файлах уровней, и переписывать их там
 * нельзя — файлы правит редактор расстановки и пишет обратно.
 *
 * @param {string} id — имя уровня @param {string} fallback — как в файле
 */
export function levelName(id, fallback) {
  return LEVEL_NAMES[current]?.[id] ?? fallback;
}

/** Положить значение по пути вида `death.again`. */
function put(target, path, value) {
  const keys = path.split('.');
  const last = keys.pop();

  let node = target;
  for (const key of keys) {
    if (!node[key]) return; // такого раздела нет: молча пропускаем
    node = node[key];
  }
  node[last] = value;
}
