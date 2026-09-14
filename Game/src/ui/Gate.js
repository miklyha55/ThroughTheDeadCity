import { CONFIG } from '../config.js';

const CFG = CONFIG.gate;

/**
 * Чёрный экран с одной кнопкой, с которого игра начинается.
 *
 * Нужен не ради торжественности. Браузер не выпускает звук наружу, пока игрок
 * ничего не нажал, и снять этот запрет можно только изнутри самого жеста. Пока
 * первым касанием был хват за стик, окно между касанием и первым выстрелом
 * оказывалось слишком узким: на телефоне звуковая сессия не успевала подняться,
 * и первые выстрелы уходили в тишину. Отдельная кнопка даёт этот жест заведомо
 * раньше — и запас времени, пока идёт загрузка.
 *
 * Загрузка при этом не ждёт нажатия: она началась ещё до того, как ворота
 * показались, и идёт под ними. Нажатие не стоит игроку ни секунды.
 *
 * Нажимается вся площадь экрана, а не только сама кнопка: кнопка тут — метка,
 * куда смотреть, и промахнуться мимо неё пальцем не должно ничего стоить.
 */
export class Gate {
  constructor(container = document.body) {
    this.root = document.createElement('div');
    this.root.className = 'gate';
    this.root.hidden = true;

    this.button = document.createElement('button');
    this.button.className = 'gate__play';
    this.button.type = 'button';
    this.button.textContent = CFG.label;

    this.root.appendChild(this.button);
    container.appendChild(this.root);
  }

  show() {
    this.root.hidden = false;
  }

  hide() {
    this.root.hidden = true;
  }

  /**
   * Дождаться нажатия.
   *
   * @param {() => void} [onPress] — зовётся синхронно, прямо внутри жеста:
   *   отложенное на кадр или на `await` браузер уже не считает ответом игрока,
   *   а разрешение на звук выдаётся только по такому ответу.
   * @returns {Promise<void>}
   */
  press(onPress) {
    return new Promise((done) => {
      const go = () => {
        onPress?.();
        done();
      };

      // Именно `pointerdown`, а не `click`: касание должно засчитаться в момент,
      // когда палец лёг, а не когда поднялся.
      this.root.addEventListener('pointerdown', go, { once: true });
    });
  }
}
