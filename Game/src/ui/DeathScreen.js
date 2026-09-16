import { CONFIG } from '../config.js';

const CFG = CONFIG.death;

/**
 * Экран смерти: что случилось и кнопка «начать заново».
 *
 * Раньше уровень перезапускался от любого нажатия. Работало это плохо: игрок
 * погибал, обычно не отпуская стик, и первое же его движение начинало уровень
 * заново — падения он не видел, а перезапуск выглядел как сбой. Кнопка убирает
 * это целиком: пока её не нажали, ничего не происходит.
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

    this.button = document.createElement('button');
    this.button.className = 'death__again';
    this.button.type = 'button';
    this.button.textContent = CFG.button;

    this.card.append(this.title, this.note, this.button);
    this.root.appendChild(this.card);
    container.appendChild(this.root);

    this.shown = false;
    this.onRestart = null;
    this._fade = null;

    // Именно на нажатии, а не на отпускании: касание должно засчитаться в тот
    // же миг, когда палец лёг на кнопку.
    this.button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (!this.shown) return;

      this.hide();
      this.onRestart?.();
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
