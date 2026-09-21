import { CONFIG } from '../config.js';
import { HintCard } from './HintCard.js';

const CFG = CONFIG.controlsHint;

/**
 * Подсказка по управлению: показывается один раз, когда вступление отговорило.
 *
 * Показывать её раньше нельзя — она легла бы поверх субтитров, и читать
 * пришлось бы оба текста разом. Позже уже поздно: игрок к этому времени успеет
 * потыкать в экран и решить, что игра его не слушается.
 *
 * Управление тут разное на разных машинах, и подсказка это учитывает: там, где
 * есть мышь и клавиатура, показываются клавиши, на сенсорном экране — стик.
 * Определяется это не по ширине окна и не по названию браузера, а по тому, чем
 * в это окно тычут: ноутбук с сенсорным экраном ломает любую догадку по размеру.
 *
 * Уходит она по первому же действию игрока: первое касание стика и есть тот
 * знак, после которого подсказка больше не нужна. Всё прочее — всплытие,
 * растворение, уход по времени — общее у всех подсказок и живёт в `HintCard`.
 */
export class ControlsHint extends HintCard {
  constructor(container = document.body) {
    super(container, {
      armAfter: CFG.armAfter,
      holdFor: CFG.holdFor,
      fadeFor: CFG.fadeFor,
    });

    this.keys = buildKeys();
    this.stick = buildStick();

    this.title = document.createElement('p');
    this.title.className = 'hint__title';

    this.note = document.createElement('p');
    this.note.className = 'hint__note';
    this.note.textContent = CFG.note;

    this.tail = document.createElement('p');
    this.tail.className = 'hint__tail';

    this.card.append(this.keys, this.stick, this.title, this.note, this.tail);
  }

  /** Есть ли у машины мышь с клавиатурой — или это сенсорный экран. */
  get keyboard() { return byKeyboard(); }

  /** Чем играют, спрашивается перед самым показом: окно могло и смениться. */
  _prepare() {
    const byKeys = this.keyboard;
    this.keys.hidden = !byKeys;
    this.stick.hidden = byKeys;
    this.title.textContent = byKeys ? CFG.titleKeys : CFG.titleTouch;
    this.tail.textContent = byKeys ? CFG.tailKeys : CFG.tailTouch;
  }
}

/**
 * Чем в это окно тычут: мышь с клавиатурой или палец.
 *
 * Не по ширине окна и не по названию браузера: ноутбук с сенсорным экраном
 * ломает любую догадку по размеру. Спрашивают отсюда и подсказка, и пауза — обе
 * показывают разное на клавиатуре и на телефоне.
 */
export function byKeyboard() {
  return matchMedia('(hover: hover) and (pointer: fine)').matches;
}

/**
 * Клавиши: W сверху, A S D под ней — как они и лежат под рукой.
 *
 * Отдаётся наружу: ту же пару картинок показывает пауза, и рисовать их второй
 * раз значило бы держать две подсказки, которые однажды разойдутся.
 */
export function buildKeys() {
  const box = document.createElement('div');
  box.className = 'hint__keys';

  const top = document.createElement('div');
  top.className = 'hint__row';
  top.appendChild(key('W'));

  const bottom = document.createElement('div');
  bottom.className = 'hint__row';
  bottom.append(key('A'), key('S'), key('D'));

  box.append(top, bottom);
  return box;
}

function key(letter) {
  const cap = document.createElement('span');
  cap.className = 'hint__key';
  cap.textContent = letter;
  return cap;
}

/** Стик: круг с ручкой, отведённой в сторону, — как его и держат пальцем. */
export function buildStick() {
  const box = document.createElement('div');
  box.className = 'hint__stick';

  const base = document.createElement('span');
  base.className = 'hint__base';

  const knob = document.createElement('span');
  knob.className = 'hint__knob';

  base.appendChild(knob);
  box.appendChild(base);
  return box;
}
