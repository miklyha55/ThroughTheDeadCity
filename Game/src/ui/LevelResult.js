import { CONFIG } from '../config.js';

const CFG = CONFIG.levelResult;

/**
 * Итог уровня: экран между выходом с уровня и заставкой следующего.
 *
 * Выглядит так же, как финал, и собран на тех же стилях: картинка пройденного
 * уровня во весь экран с медленным наездом, а поверх — название, три цифры и
 * кнопка. Разница в том, что финал подводит итог всему городу, а этот экран —
 * одному уровню, и кнопка на нём не «заново», а «дальше».
 *
 * Мир под ним стоит: зомби не добегают, часы похода не идут. Дальше игра
 * пускает только по кнопке — или по Enter, чтобы за столом не тянуться к мыши.
 */
export class LevelResult {
  constructor(container = document.body) {
    this.root = document.createElement('div');
    this.root.className = 'ending ending--level';
    container.appendChild(this.root);

    this.frame = document.createElement('div');
    this.frame.className = 'ending__frame';

    this.caption = document.createElement('p');
    this.caption.className = 'ending__caption';

    this.stats = document.createElement('dl');
    this.stats.className = 'ending__stats';
    this.rows = {};

    for (const [key, label] of [
      ['kills', CFG.killsLabel], ['deaths', CFG.deathsLabel], ['time', CFG.timeLabel],
    ]) {
      const name = document.createElement('dt');
      name.textContent = label;

      const value = document.createElement('dd');
      value.textContent = '—';

      this.stats.append(name, value);
      this.rows[key] = value;
    }

    const buttons = document.createElement('div');
    buttons.className = 'ending__buttons';

    this.next = document.createElement('button');
    this.next.className = 'ending__again';
    this.next.type = 'button';
    this.next.textContent = CFG.continueLabel;
    buttons.append(this.next);

    // Подсказка «Enter — продолжить»: только за столом, где клавиша и есть.
    this.hint = document.createElement('p');
    this.hint.className = 'ending__hint';
    this.hint.textContent = CFG.enterHint;
    this.hint.hidden = !matchMedia('(hover: hover) and (pointer: fine)').matches;

    this.card = document.createElement('div');
    this.card.className = 'ending__card';
    this.card.append(this.caption, this.stats, buttons, this.hint);

    this.root.append(this.frame, this.card);

    this.shown = false;
    this.onContinue = null; // кому сказать, что игрок пошёл дальше

    // По отпусканию: нажал — кнопка сжалась, отпустил — пошли дальше.
    this.next.addEventListener('click', (event) => {
      event.preventDefault();
      this._continue();
    });

    addEventListener('keydown', (event) => {
      if (!this.shown || event.repeat) return;
      if (event.code === 'Enter' || event.code === 'NumpadEnter') this._continue();
    });
  }

  /**
   * Показать итог уровня.
   *
   * @param {{name: string, number: number, kills: number, deaths: number, seconds: number}} result
   */
  show(result) {
    this.shown = true;
    clearTimeout(this._leave);
    this.root.classList.remove('ending--leaving');

    this.frame.style.backgroundImage = `url(${CONFIG.splash.folder}${result.number}.png)`;
    this.caption.textContent = `${result.name} — ${CFG.doneLabel}`;
    this.rows.kills.textContent = String(result.kills);
    this.rows.deaths.textContent = String(result.deaths);
    this.rows.time.textContent = clock(result.seconds);

    // Карточка всплывает заново при каждом показе. Её анимация отыграла ещё при
    // загрузке страницы, и без перезапуска на втором уровне она стояла бы сразу.
    this.card.style.animation = 'none';
    void this.card.offsetWidth;
    this.card.style.animation = '';

    this.root.classList.add('ending--on');
  }

  hide() {
    if (!this.shown) return;

    this.shown = false;

    // Сперва «уходит», потом «не показан»: наезд на картинке держится на обоих
    // классах и не обрывается, пока экран тает. Оборвись он — картинка прыгала
    // бы к исходному масштабу посреди растворения.
    this.root.classList.add('ending--leaving');
    this.root.classList.remove('ending--on');

    clearTimeout(this._leave);
    this._leave = setTimeout(() => this.root.classList.remove('ending--leaving'), CFG.fadeFor * 1000);
  }

  _continue() {
    if (!this.shown) return;

    this.hide();
    this.onContinue?.();
  }
}

/** Время в виде «7:42» — минуты и секунды. */
function clock(seconds) {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
