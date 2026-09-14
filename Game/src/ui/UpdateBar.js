import { CONFIG } from '../config.js';

const CFG = CONFIG.updates;

/**
 * Сообщение о новой версии: строка внизу экрана и кнопка.
 *
 * Появляется, когда сборка на сервере разошлась с открытой, и больше не
 * исчезает: игрок нажмёт, когда ему будет удобно. Само по себе оно ничего не
 * перезагружает — посреди боя это хуже устаревшей версии.
 *
 * Стоит над всем, что в игре, но ниже экранов, которые кроют её целиком:
 * заставки, загрузки и финала. Под ними игра всё равно не идёт, а строка на
 * чёрном экране читалась бы как часть загрузки.
 */
export class UpdateBar {
  /**
   * @param {() => void} onApply — что делать по нажатию
   * @param {HTMLElement} [container]
   */
  constructor(onApply, container = document.body) {
    this.root = document.createElement('div');
    this.root.className = 'update';
    this.root.hidden = true;

    const text = document.createElement('span');
    text.className = 'update__text';
    text.textContent = CFG.message;

    this.button = document.createElement('button');
    this.button.className = 'update__button';
    this.button.type = 'button';
    this.button.textContent = CFG.label;
    this.button.addEventListener('click', () => {
      // Второе нажатие ничего не ускорит, а вид «кнопка не сработала» даёт.
      this.button.disabled = true;
      this.button.textContent = CFG.applying;
      onApply();
    });

    this.root.append(text, this.button);
    container.appendChild(this.root);
  }

  show() {
    this.root.hidden = false;
  }
}
