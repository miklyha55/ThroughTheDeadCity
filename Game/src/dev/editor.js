import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { CONFIG } from '../config.js';
import { asset } from '../core/paths.js';

// м/с, с которой камера едет по локации от WASD и стрелок вверх-вниз
const PAN_SPEED = 18;

// рад/с разворота камеры стрелками влево-вправо
const TURN_SPEED = 1.2;

// Шар, которым ловится фигура при выборе: по росту человека и чуть шире плеч.
const FIGURE_HEIGHT = 1.9;
const _bubble = new THREE.Sphere(new THREE.Vector3(), 0.85);
const _where = new THREE.Vector3();

/**
 * Правка расстановки прямо в игре.
 *
 * Включается клавишей Tab, дальше — мышью: щёлкнул по предмету, потянул за
 * гизмо, сохранил. Правки уезжают в тот же JSON, из которого локация и собирается, так
 * что после перезагрузки страницы всё остаётся на местах.
 *
 * Камера ходит по локации стрелками, игра при этом стоит.
 *
 * Двигается всё, что стоит на локации, — и поштучные пропы, и россыпь.
 *
 * Сохранение приводит файл к одному виду: и россыпь, и орды зомби записываются
 * поимённо, с координатами, а процедурные разделы из него уходят. Иначе правку
 * было бы не сохранить — зона задаёт не места, а правило, по которому они
 * разыгрываются заново при каждой загрузке.
 *
 * Забор и выход мышью не трогаются: они описаны стороной и шириной проёма.
 *
 * Пока редактор открыт, локация пересобирается без слияния статики: слитая
 * геометрия неподвижна, и тянуть в ней было бы нечего.
 */
export function createEditor({ engine, locations, joystick, camera, onToggle, onPick, toggles = [] }) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const down = new THREE.Vector2();

  const gizmo = new TransformControls(engine.camera, engine.renderer.domElement);
  gizmo.setSpace('world');
  gizmo.addEventListener('dragging-changed', (e) => { dragging = e.value; });

  let active = false;
  let dragging = false;
  let picked = null;

  // Какие стрелки зажаты прямо сейчас. Двигаем камеру в цикле, а не по самому
  // нажатию: автоповтор клавиатуры идёт рывками и с задержкой в полсекунды.
  const held = new Set();
  const ARROWS = {
    ArrowUp: [0, 1], ArrowDown: [0, -1],
    KeyA: [-1, 0], KeyD: [1, 0],
    KeyW: [0, 1], KeyS: [0, -1],
  };

  // Стрелки влево-вправо разворачивают камеру вокруг точки взгляда: с одного
  // ракурса не видно ни дальней стороны домов, ни того, что за ними стоит.
  const TURNS = { ArrowLeft: 1, ArrowRight: -1 };

  const panel = document.createElement('div');
  panel.className = 'editor';
  panel.hidden = true;

  // Переключатель уровней: стрелки по бокам от названия текущего.
  const switcher = document.createElement('div');
  switcher.className = 'editor__levels';

  const title = document.createElement('span');
  const prev = arrowButton('‹', -1);
  const next = arrowButton('›', 1);

  switcher.append(prev, title, next);

  const hint = document.createElement('div');
  panel.append(switcher, checkboxes(), hint);
  document.body.appendChild(panel);

  /**
   * Выключатели для отладки: галочки, которые переживают перезагрузку.
   *
   * Состояние хранится не в самой галочке, а снаружи — иначе оно не пережило бы
   * ни одной перезагрузки, а нужны они как раз тем, кто перезапускает уровень
   * по десять раз подряд.
   */
  function checkboxes() {
    const box = document.createElement('div');
    box.className = 'editor__toggles';

    for (const toggle of toggles) {
      const label = document.createElement('label');
      label.className = 'editor__toggle';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = toggle.value;
      input.addEventListener('change', () => toggle.onChange(input.checked));

      label.append(input, document.createTextNode(` ${toggle.label}`));
      box.appendChild(label);
    }
    return box;
  }

  /**
   * Кнопка соседнего уровня. Цепочка берётся из самих локаций: каждая знает,
   * какая идёт за ней, и по этим ссылкам список собирается сам — держать его
   * отдельно значило бы иметь два источника правды.
   */
  function arrowButton(label, step) {
    const button = document.createElement('button');
    button.className = 'editor__arrow';
    button.textContent = label;

    button.addEventListener('click', async () => {
      if (locations.loading || chain.length < 2) return;

      const at = chain.indexOf(locations.current.data.id);
      const to = chain[(at + step + chain.length) % chain.length];

      gizmo.detach();
      picked = null;
      await locations.load(to);
      onPick?.(to); // сюда игра и вернётся после перезагрузки
      status('щёлкни по предмету');
    });

    return button;
  }

  let chain = [];

  /**
   * Собирает цепочку уровней, идя по ссылкам `next` от самого первого.
   *
   * Именно от первого, а не от того, где стоим: за последним уровнем следующего
   * нет — там финал, — и цепочка, построенная с него, состояла бы из него одного.
   * Стрелки тогда никуда не ведут, и до начала игры из панели не добраться.
   *
   * Уровень, открытый в обход цепочки (через `?location=`), дописывается в конец:
   * иначе он выпал бы из переключения вместе со всем, что правили именно на нём.
   */
  async function readChain() {
    const list = [];
    let id = CONFIG.locations.first;

    while (id && !list.includes(id)) {
      list.push(id);

      const res = await fetch(asset(`locations/${id}.json`));
      if (!res.ok) break;
      id = (await res.json()).next;
    }

    const here = locations.current.data.id;
    if (!list.includes(here)) list.push(here);

    chain = list;
  }

  const status = (text) => {
    title.textContent = active ? locations.current.data.name : '';
    hint.textContent = active
      ? 'WASD — камера · ←→ поворот · 1 сдвиг · 2 разворот · 3 размер\n'
        + 'Enter — сохранить · Tab — выйти\n'
        + 'сохранение переводит россыпь и зомби в поимённый список\n'
        + text
      : '';
  };

  /**
   * Что можно тянуть: всё, что есть на площадке, — предметы, зомби, персонаж,
   * пол и область перехода на следующий уровень. Всё правится тем же гизмо, а
   * не числами в файле.
   */
  const targets = () => {
    const list = locations.current.placed.map((p) => p.object);
    for (const zombie of locations.current.zombies) list.push(zombie.root);
    if (locations.player) list.push(locations.player.root);
    if (locations.current.ground) list.push(locations.current.ground);
    if (locations.current.exitMark) list.push(locations.current.exitMark);
    return list;
  };

  /** Все фигуры на локации: персонаж и зомби. */
  const figures = () => {
    const list = locations.current.zombies.slice();
    if (locations.player) list.push(locations.player);
    return list;
  };

  /**
   * Что выбрано щелчком.
   *
   * Предметы ловятся обычным лучом, а фигуры — отдельной проверкой по шару
   * вокруг них. Дело в скине: луч по анимированному мешу считается в позе
   * привязки и по кэшированной сфере, поэтому по бегущему или дышащему
   * персонажу он то попадает, то нет. Шар вокруг ног такой мороки не знает.
   *
   * Фигура всегда важнее предмета: щёлкнув по зомби, стоящему за домом, хочется
   * взять его, а не крышу, которая ближе к камере. Промахнуться из-за этого
   * трудно — шар у фигуры размером с неё саму.
   */
  function nearestTarget(list) {
    let prop = null;
    let propAt = Infinity;

    const hit = raycaster.intersectObjects([locations.current.group], true)[0];
    if (hit) {
      let object = hit.object;
      while (object.parent && !list.includes(object)) object = object.parent;

      // взяли, только если луч упёрся именно в него, а не в стену перед ним
      if (list.includes(object)) {
        prop = object;
        propAt = hit.distance;
      }
    }

    let figure = null;
    let figureAt = Infinity; // из нескольких фигур берём ближнюю к камере

    for (const one of figures()) {
      const at = one.position;
      _bubble.center.set(at.x, at.y + FIGURE_HEIGHT / 2, at.z);

      const where = raycaster.ray.intersectSphere(_bubble, _where);
      if (!where) continue;

      const away = raycaster.ray.origin.distanceTo(where);
      if (away >= figureAt) continue;

      figure = one.root;
      figureAt = away;
    }

    return figure ?? prop;
  }

  /**
   * Что луч нашёл под курсором — строкой в панель.
   *
   * Пока правка отлаживается вслепую, это единственный способ понять, почему
   * щелчок не выбрал того, кого видно: не нашлась фигура, не попал шар или
   * объект просто не числится среди тех, кого можно двигать.
   */
  function report(list) {
    const hit = raycaster.intersectObjects([locations.current.group], true)[0];
    const crowd = figures();

    const near = crowd
      .map((one) => {
        const at = one.position;
        _bubble.center.set(at.x, at.y + FIGURE_HEIGHT / 2, at.z);
        return raycaster.ray.distanceToPoint(_bubble.center);
      })
      .sort((a, b) => a - b)[0];

    return `луч: ${hit ? hit.object.name || 'меш' : 'пусто'}`
      + ` · фигур ${crowd.length}`
      + ` · ближняя в ${near === undefined ? '—' : near.toFixed(2)} м от луча`
      + ` · двигать можно ${list.length}`;
  }

  function pick(event) {
    const rect = engine.renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const list = targets();
    raycaster.setFromCamera(pointer, engine.camera);

    const object = nearestTarget(list);
    if (!object) {
      gizmo.detach();
      picked = null;
      status(`мимо · ${report(list)}`);
      return;
    }

    picked = object;
    gizmo.attach(object);

    if (object === locations.player?.root) status('выбран персонаж: это точка старта');
    else if (object === locations.current.ground) status('выбран пол: двигается по высоте');
    else if (object === locations.current.exitMark) status('выбрана область перехода: размер — радиус');
    else if (locations.current.zombies.some((z) => z.root === object)) status('выбран зомби');
    else status(`выбран ${object.name || 'проп'}`);
  }

  async function save() {
    status('сохраняю…');
    const location = locations.current;

    const response = await fetch('/api/save-location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: location.data.id, data: location.snapshot(locations.player) }),
    });

    const result = await response.json();
    status(result.ok ? `сохранено: ${result.file}` : `не вышло: ${result.error}`);
  }

  async function toggle() {
    active = !active;
    panel.hidden = !active;
    locations.editing = active;
    joystick?.setEnabled(!active); // иначе щелчок по сцене уводит персонажа

    if (active) {
      engine.scene.add(gizmo.getHelper());
    } else {
      gizmo.detach();
      gizmo.getHelper().removeFromParent();
      picked = null;
    }

    // пересобираем локацию: в правке нужна несклеенная геометрия, в игре — склеенная
    await locations.load(locations.current.data.id);
    if (locations.current.exitMark) locations.current.exitMark.visible = active;
    if (active && chain.length === 0) await readChain();
    onToggle?.(active);
    status('щёлкни по предмету');
  }

  addEventListener('keyup', (event) => held.delete(event.code));

  addEventListener('keydown', (event) => {
    if (active && (ARROWS[event.code] || TURNS[event.code])) {
      event.preventDefault(); // иначе страница поедет вместе с камерой
      held.add(event.code);
      return;
    }

    // Tab: на маке он свободен, в отличие от F-ряда, занятого яркостью,
    // громкостью и Mission Control. Браузеру его перехватываем — иначе он
    // уведёт фокус на элементы страницы.
    if (event.code === 'Tab') {
      event.preventDefault();
      toggle();
      return;
    }
    if (!active) return;

    // Режимы гизмо переехали на цифры: WASD заняты камерой, а S к тому же
    // ездит назад — сохранять по ней больше нельзя.
    if (event.code === 'Digit1') gizmo.setMode('translate');
    if (event.code === 'Digit2') gizmo.setMode('rotate');
    if (event.code === 'Digit3') gizmo.setMode('scale');
    if (event.code === 'Enter') save();
    if (event.code === 'Escape') { gizmo.detach(); picked = null; }
  });

  // Слушаем нажатие на самом окне и в фазе перехвата: так выбор срабатывает
  // раньше, чем событие успеет забрать себе что-нибудь поверх сцены. Тянущееся
  // гизмо при этом не трогаем — оно уже перехватило указатель на себя.
  addEventListener('pointerdown', (event) => {
    if (!active || dragging || gizmo.axis) return;

    down.set(event.clientX, event.clientY);
    pick(event);
  }, true);

  return {
    get active() { return active; },
    get dragging() { return dragging; },

    /** Пока правка открыта, игра стоит, а камера ходит по локации стрелками. */
    update(dt) {
      let right = 0;
      let forward = 0;

      for (const code of held) {
        const [x, z] = ARROWS[code] ?? [0, 0];
        right += x;
        forward += z;
      }

      if (right || forward) camera?.pan(right * PAN_SPEED * dt, forward * PAN_SPEED * dt);

      let turn = 0;
      for (const code of held) turn += TURNS[code] ?? 0;
      if (turn) camera?.turn(turn * TURN_SPEED * dt);
    },
  };
}
