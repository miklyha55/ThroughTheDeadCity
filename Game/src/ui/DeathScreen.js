import { CONFIG } from '../config.js';
import { ConfirmDialog } from './ConfirmDialog.js';

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

    // Окно «точно?» перед сбросом. Живёт отдельно и всплывает поверх этого
    // экрана, а не подменяет его кнопки: подменённые читаются как продолжение
    // прежнего экрана, и отвечают на них не глядя.
    this.dialog = new ConfirmDialog(container);

    this.shown = false;
    this.onAgain = null;     // переиграть этот уровень
    this.onFromStart = null; // и начать игру заново, с первого

    this._fade = null;

    /**
     * Именно на нажатии, а не на отпускании: касание должно засчитаться в тот
     * же миг, когда палец лёг на кнопку.
     *
     * Второе нажатие не проходит, пока идёт первое. Между ним и перезапуском
     * уровня стоит рекламный ролик — это секунды, экран смерти всё это время на
     * месте, и нетерпеливый игрок успевает нажать ещё раз. Каждое такое нажатие
     * заказывало свой ролик и свою загрузку уровня, и они мешали друг другу:
     * уровень начинался заново только с третьего раза.
     */
    this.busy = false;

    /**
     * Экран не тает: он гаснет разом, и только потом идёт всё остальное.
     *
     * Растворение тут было лишним. Пока карточка таяла, она теряла своё
     * смещение и съезжала вниз — кнопки дёргались на глазах у игрока. А следом
     * всё равно приходит реклама или новый уровень, и полсекунды угасания под
     * ними никто не видит.
     */
    this._press(this.again, async () => {
      if (this.busy) return;

      this.busy = true;
      this.again.disabled = true;
      this.veil(true); // и до конца ролика на экране ничего, кроме черноты
      try {
        await this.onAgain?.();
      } finally {
        this.veil(false);
        this.busy = false;
        this.again.disabled = false;
      }
    });

    /**
     * Сброс сам по себе ничего не запускает: сперва вопрос, и всегда.
     *
     * Без исключений, даже на первом уровне, где терять нечего. Кнопка, которая
     * то спрашивает, то нет, читается как сломанная: игрок жмёт и не понимает,
     * почему в этот раз обошлось без вопроса.
     *
     * Отказались — экран смерти остаётся на месте, как будто и не нажимали.
     * Согласились — уходим и начинаем заново.
     */
    this.fromStart.addEventListener('click', async (event) => {
      event.preventDefault();
      if (!this.shown) return;

      const agreed = await this.dialog.ask({
        title: CFG.confirmTitle,
        note: CFG.confirmNote,
        yes: CFG.wipe,
        no: CFG.keep,
      });
      if (!agreed) return;

      // Пока спрашивали, игрок мог уйти с экрана: открылась правка расстановки
      // или уровень начался заново сам.
      if (!this.shown) return;

      // И окно, и экран уходят разом: дальше игра начинается с первого уровня,
      // и тающие поверх него остатки прошлой попытки ни к чему.
      this.dialog.snap();
      this._snap();
      this.veil(true);

      // Заслонка снимается, когда первый уровень уже собран: `onFromStart`
      // ведёт загрузку, и ждать её — значит ждать готового кадра.
      try {
        await this.onFromStart?.();
      } finally {
        this.veil(false);
      }
    });
  }

  _press(button, act) {
    // По отпусканию: нажал — кнопка сжалась, отпустил — сработала.
    button.addEventListener('click', (event) => {
      event.preventDefault();
      if (!this.shown) return;

      this._snap(); // разом: за нажатием идёт реклама или новый уровень
      act();
    });
  }

  /** Убрать экран немедленно: без растворения и без съезжающей карточки. */
  _snap() {
    clearTimeout(this._fade);
    this.shown = false;
    this.root.classList.remove('death--on');
    this.root.hidden = true;
  }

  /**
   * Чёрная заслонка на время ролика и перезапуска.
   *
   * Между нажатием и рекламой проходит секунда-другая: площадка ещё только
   * поднимает баннер. Без заслонки в эту щель видно и уходящую карточку, и
   * живой уровень с телом героя, а потом поверх всего этого всплывает реклама.
   * Здесь же всё гаснет разом, и до самого нового уровня экран чёрный.
   *
   * Стили прямо на элементе: заслонка нужна ровно одному месту, и заводить ради
   * неё правило в общей таблице незачем.
   */
  veil(on) {
    if (!this._veil) {
      this._veil = document.createElement('div');
      this._veil.style.cssText = 'position:fixed;inset:0;z-index:86;background:#000;'
        + 'pointer-events:auto;display:none';
      this.root.parentNode.appendChild(this._veil);
    }
    this._veil.style.display = on ? 'block' : 'none';
  }

  show() {
    if (this.shown) return;

    this.shown = true;
    this.busy = false;
    this.again.disabled = false;
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
