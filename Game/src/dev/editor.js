import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

/**
 * Правка расстановки прямо в игре.
 *
 * Включается клавишей Tab, дальше — мышью: щёлкнул по предмету, потянул за
 * гизмо, сохранил. Правки уезжают в тот же JSON, из которого локация и собирается, так
 * что после перезагрузки страницы всё остаётся на местах.
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
export function createEditor({ engine, locations, joystick, onToggle }) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const down = new THREE.Vector2();

  const gizmo = new TransformControls(engine.camera, engine.renderer.domElement);
  gizmo.setSpace('world');
  gizmo.addEventListener('dragging-changed', (e) => { dragging = e.value; });

  let active = false;
  let dragging = false;
  let picked = null;

  const panel = document.createElement('div');
  panel.className = 'editor';
  panel.hidden = true;
  document.body.appendChild(panel);

  const status = (text) => {
    panel.textContent = active
      ? `правка: ${locations.current.data.name}\n`
        + 'W — сдвиг · E — поворот · R — размер · S — сохранить · Tab — выйти\n'
        + 'сохранение переводит россыпь и зомби в поимённый список\n'
        + text
      : '';
  };

  /** Что можно тянуть: всё, что локация расставила на площадке. */
  const targets = () => locations.current.placed.map((p) => p.object);

  function pick(event) {
    const rect = engine.renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const list = targets();
    raycaster.setFromCamera(pointer, engine.camera);

    const hit = raycaster.intersectObjects(list, true)[0];
    if (!hit) {
      gizmo.detach();
      picked = null;
      status(`мимо · под мышью пусто (предметов на локации: ${list.length})`);
      return;
    }

    // Попали в меш внутри пропа — поднимаемся до самого пропа: тянуть нужно его
    // целиком, а не отдельную деталь.
    let object = hit.object;
    while (object.parent && !list.includes(object)) object = object.parent;

    picked = object;
    gizmo.attach(object);
    status(`выбран ${object.name || 'проп'}`);
  }

  async function save() {
    status('сохраняю…');
    const location = locations.current;

    const response = await fetch('/api/save-location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: location.data.id, data: location.snapshot() }),
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
    onToggle?.(active);
    status('щёлкни по предмету');
  }

  addEventListener('keydown', (event) => {
    // Tab: на маке он свободен, в отличие от F-ряда, занятого яркостью,
    // громкостью и Mission Control. Браузеру его перехватываем — иначе он
    // уведёт фокус на элементы страницы.
    if (event.code === 'Tab') {
      event.preventDefault();
      toggle();
      return;
    }
    if (!active) return;

    if (event.code === 'KeyW') gizmo.setMode('translate');
    if (event.code === 'KeyE') gizmo.setMode('rotate');
    if (event.code === 'KeyR') gizmo.setMode('scale');
    if (event.code === 'KeyS') save();
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
  };
}
