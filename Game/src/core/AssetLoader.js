import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const gltfLoader = new GLTFLoader();

/**
 * Ход загрузки моделей.
 *
 * Полоса на экране должна показывать настоящее положение дел, а не ползти по
 * таймеру: модели весят мегабайты, и на медленном канале выдуманная полоса
 * доходит до края задолго до того, как игра готова, — а потом стоит и врёт.
 *
 * Доля считается по байтам, если сервер сказал размер файла, и по числу готовых
 * файлов, если не сказал: под gzip длина заранее не известна.
 */
const tracked = new Map(); // url → { loaded, total, done }
let expected = 0;          // сколько файлов ждём: известно заранее, поэтому полоса не дёргается
let listener = null;

/**
 * @param {number} count — сколько моделей будет загружено
 * @param {(share: number) => void} onChange — доля от 0 до 1
 */
export function trackAssets(count, onChange) {
  expected = count;
  listener = onChange;
}

function report() {
  let done = 0;
  for (const file of tracked.values()) {
    done += file.done ? 1 : (file.total > 0 ? file.loaded / file.total : 0);
  }
  listener?.(Math.min(1, done / Math.max(expected, 1)));
}

/**
 * Прогреть файлы, которые игре понадобятся сразу: заставки, звуки, картинки.
 *
 * Без этого заставка первого уровня выходит пустой — файл ещё летит по сети, а
 * показать её нужно уже сейчас. Картинки именно декодируются, а не просто
 * скачиваются: скачанный, но не разобранный png браузер всё равно не нарисует
 * в тот же кадр.
 *
 * Сбой одного файла не держит остальных: не загрузилось — значит этого звука не
 * будет, но игра начнётся.
 *
 * @param {string[]} urls
 */
export function preload(urls) {
  return Promise.all(urls.map((url) => {
    const file = { loaded: 0, total: 0, done: false };
    tracked.set(url, file);

    const finish = () => {
      file.done = true;
      report();
    };

    if (/\.(png|jpg|jpeg|webp|gif)$/i.test(url)) {
      const image = new Image();
      image.src = url;
      return image.decode().then(finish, finish);
    }

    // остальному достаточно оказаться в кэше: дальше его возьмут уже оттуда
    return fetch(url).then((res) => res.arrayBuffer()).then(finish, finish);
  }));
}

export function loadGLTF(url) {
  const file = { loaded: 0, total: 0, done: false };
  tracked.set(url, file);

  return gltfLoader
    .loadAsync(url, (event) => {
      file.loaded = event.loaded;
      file.total = event.total ?? 0;
      report();
    })
    .then((gltf) => {
      file.done = true;
      report();
      return gltf;
    });
}
