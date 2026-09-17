import { CONFIG } from '../config.js';

const CFG = CONFIG.death;

/**
 * Экран смерти: что случилось и куда отсюда идти.
 *
 * Раньше уровень перезапускался от любого нажатия. Работало это плохо: игрок
 * погибал, обычно не отпуская стик, и первое же его движение начинало уровень
 * заново — падения он не видел, а перезапуск выглядел как сбой. Кнопки убирают
 * это целиком: пока не нажали, ничего не происходит.
 *
 * Кнопок две: переиграть этот уровень и начать игру с самого начала.
 *
 * Поднимается экран не в момент удара, а когда персонаж уже упал: длину падения
 * отмеряет сам персонаж по своей анимации, а игра только ждёт этого мига.
 *
 * Тёмный он, но не глухой: сквозь него видно площадку и то место, где всё
 * кончилось. Глухая заливка читалась бы как выход из игры, а это всего лишь
 * одна неудачная попытка.
 */
export class DeathScreen {
  constructor(container = document.body) {
    this.root = document.createElement('div');
    this.root.className = 'death';
    this.root.hidden = true;

    this.card = document.createElement('div');
    this.card.className = 'death__card';

    this.title = document.createElement('p');
    this.title.className = 'death__title';
    this.title.textContent = CFG.title;

    this.note = document.createElement('p');
    this.note.className = 'death__note';
    this.note.textContent = CFG.note;

    /**
     * Две двери отсюда, и разные.
     *
     * Первая — переиграть этот уровень: её нажимают почти всегда, поэтому она
     * крупнее и стоит выше. Вторая — начать всю игру с самого начала, и она
     * намеренно тише: попасть по ней случайно, метя в первую, значит потерять
     * всё пройденное.
     */
    const buttons = document.createElement('div');
    buttons.className = 'death__buttons';

    this.again = document.createElement('button');
    this.again.className = 'death__again';
    this.again.type = 'button';
    this.again.append(playIcon(), label(CFG.again));

    this.fromStart = document.createElement('button');
    this.fromStart.className = 'death__start';
    this.fromStart.type = 'button';
    this.fromStart.textContent = CFG.fromStart;

    buttons.append(this.again, this.fromStart);
    this.card.append(this.title, this.note, buttons);
    this.root.appendChild(this.card);
    container.appendChild(this.root);

    this.shown = false;
    this.onAgain = null;     // переиграть этот уровень
    this.onFromStart = null; // и начать игру заново, с первого
    this._fade = null;

    // Именно на нажатии, а не на отпускании: касание должно засчитаться в тот
    // же миг, когда палец лёг на кнопку.
    this._press(this.again, () => this.onAgain?.());
    this._press(this.fromStart, () => this.onFromStart?.());
  }

  _press(button, act) {
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (!this.shown) return;

      this.hide();
      act();
    });
  }

  show() {
    if (this.shown) return;

    this.shown = true;
    clearTimeout(this._fade);
    this.root.hidden = false;

    // Кадр на то, чтобы браузер заметил появление: без него переходу
    // прозрачности не с чего начинать, и экран возникнет рывком.
    requestAnimationFrame(() => this.root.classList.add('death--on'));
  }

  hide() {
    if (!this.shown) return;

    this.shown = false;
    this.root.classList.remove('death--on');

    // Сперва растворяется и только потом уходит из разметки: снятый сразу,
    // экран моргнул бы поверх уже начавшегося уровня.
    this._fade = setTimeout(() => { this.root.hidden = true; }, CFG.fadeFor * 1000);
  }
}

/**
 * Значок «играть»: треугольник в квадратной рамке.
 *
 * Рисуется разметкой, а не картинкой: файл ради двух фигур — это лишний запрос
 * к серверу и лишняя строка в списке того, что нужно загрузить. Цвет он берёт у
 * самой кнопки (`currentColor`), поэтому подсветка при наведении красит его
 * заодно с надписью.
 */
function playIcon() {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'death__icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true'); // читалке он не нужен: рядом есть слова

  // Квадрат со скруглением — в тон кнопке, у которой тоже скруглённые края.
  const box = document.createElementNS(SVG, 'rect');
  box.setAttribute('x', '2.6');
  box.setAttribute('y', '2.6');
  box.setAttribute('width', '18.8');
  box.setAttribute('height', '18.8');
  box.setAttribute('rx', '5');
  box.setAttribute('fill', 'none');
  box.setAttribute('stroke', 'currentColor');
  box.setAttribute('stroke-width', '1.7');

  // Треугольник внутри, чуть сдвинут вправо: у знака «играть» зрительный центр
  // приходится не на середину, а ближе к острию.
  const play = document.createElementNS(SVG, 'path');
  play.setAttribute('d', 'M9.9 8.2 16.2 12l-6.3 3.8z');
  play.setAttribute('fill', 'currentColor');
  play.setAttribute('stroke', 'currentColor');
  play.setAttribute('stroke-width', '1.5');
  play.setAttribute('stroke-linejoin', 'round');

  svg.append(box, play);
  return svg;
}

/** Надпись на кнопке отдельным узлом: рядом со значком ей нужна своя строка. */
function label(text) {
  const span = document.createElement('span');
  span.textContent = text;
  return span;
}

const SVG = 'http://www.w3.org/2000/svg';
