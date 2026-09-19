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
/**
 * Наушники над кнопкой: в этой игре многое решает звук — рация, шаги, хрипы за
 * углом. Волны от чашек расходятся по кругу и тают, как звук.
 */
function headphones() {
  const wrap = document.createElement('div');
  wrap.className = 'gate__phones';
  wrap.setAttribute('aria-hidden', 'true');

  // Три волны с одним и тем же ходом, но со сдвигом по времени: так они идут
  // одна за другой, а не пульсируют разом.
  for (let i = 0; i < 3; i++) {
    const wave = document.createElement('span');
    wave.className = 'gate__wave';
    wave.style.animationDelay = `${i * 800}ms`;
    wrap.appendChild(wave);
  }

  wrap.insertAdjacentHTML('beforeend', `
    <svg class="gate__icon" viewBox="0 0 64 64" fill="none" stroke="currentColor"
         stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 38V32a20 20 0 0 1 40 0v6"/>
      <rect x="8" y="36" width="10" height="18" rx="4" fill="currentColor" fill-opacity="0.16"/>
      <rect x="46" y="36" width="10" height="18" rx="4" fill="currentColor" fill-opacity="0.16"/>
    </svg>`);

  return wrap;
}

export class Gate {
  constructor(container = document.body) {
    this.root = document.createElement('div');
    this.root.className = 'gate';
    this.root.hidden = true;

    this.button = document.createElement('button');
    this.button.className = 'gate__play';
    this.button.type = 'button';
    this.button.textContent = CFG.label;

    // Подсказка про Enter. Прячется там, где клавиатуры нет, — на телефоне она
    // звала бы нажать то, чего нет.
    this.keyHint = document.createElement('p');
    this.keyHint.className = 'gate__key';
    const key = document.createElement('kbd');
    key.textContent = CFG.keyName;
    this.keyHint.append(`${CFG.keyBefore} `, key, CFG.keyAfter ? ` ${CFG.keyAfter}` : '');
    this.keyHint.hidden = !matchMedia('(hover: hover) and (pointer: fine)').matches;

    // Кнопка и подсказка — одна связка: зазор до наушников их не разводит.
    const action = document.createElement('div');
    action.className = 'gate__action';
    action.append(this.button, this.keyHint);

    this.root.append(headphones(), action);
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
        this.root.removeEventListener('click', go);
        removeEventListener('keydown', onKey);
        onPress?.();
        done();
      };

      // За столом тянуться к мыши незачем: Enter делает то же самое. Нажатие
      // клавиши браузер тоже засчитывает как жест игрока — звук от него
      // разрешается так же, как от касания.
      const onKey = (event) => {
        if (this.root.hidden || event.repeat) return;
        if (event.code === 'Enter' || event.code === 'NumpadEnter') go();
      };

      // По отпусканию, как и все кнопки: нажал — кнопка сжалась, отпустил —
      // игра пошла. Отпускание браузер тоже засчитывает как жест игрока, и звук
      // от него разрешается так же.
      this.root.addEventListener('click', go);
      addEventListener('keydown', onKey);
    });
  }
}
