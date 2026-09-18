import { CONFIG } from '../config.js';

const CFG = CONFIG.levelMap;

/**
 * Карта уровней: список, с которого можно уйти на любой из них.
 *
 * Простой столбец карточек сверху вниз, по одной на уровень, в том порядке, в
 * каком уровни идут по цепочке. Открыт тот, что пройден, тот, на котором игрок
 * стоит, и следующий за пройденным; дальше по цепочке — замок. Уйти вперёд по
 * карте значило бы пропустить город, ради которого игра и затевалась.
 *
 * Что пройдено, карта не решает и не помнит: ей приносят готовый ответ снаружи,
 * а он идёт из сохранений у площадки. Поэтому замки переживают и перезагрузку
 * страницы, и смену устройства.
 *
 * Пока карта открыта, мир под ней стоит. Иначе зомби доберутся до героя, пока
 * тот разглядывает список, и вернуться будет уже некуда.
 *
 * Список ей дают снаружи: цепочка уровней уже прочитана при запуске, и читать
 * её второй раз незачем.
 */
export class LevelMap {
  constructor(container = document.body) {
    this.root = document.createElement('div');
    this.root.className = 'levelmap';
    this.root.hidden = true;

    const sheet = document.createElement('div');
    sheet.className = 'levelmap__sheet';

    const head = document.createElement('div');
    head.className = 'levelmap__head';

    const title = document.createElement('p');
    title.className = 'levelmap__title';
    title.textContent = CFG.title;

    this.close = document.createElement('button');
    this.close.className = 'levelmap__close';
    this.close.type = 'button';
    this.close.setAttribute('aria-label', CFG.closeLabel);
    this.close.textContent = '✕';

    head.append(title, this.close);

    // Прокручивается только список, а заголовок стоит на месте: иначе на
    // телефоне, где карточек не видно целиком, уезжает и он.
    this.list = document.createElement('div');
    this.list.className = 'levelmap__list';

    sheet.append(head, this.list);
    this.root.appendChild(sheet);
    container.appendChild(this.root);

    this.shown = false;
    this.onPick = null;   // кому сказать, какой уровень выбрали
    this.onToggle = null; // и что карта открылась или закрылась
    this._fade = null;

    this.close.addEventListener('click', () => this.hide());

    // Щелчок мимо карточек — тоже закрытие: так ведут себя все шторки, и искать
    // крестик глазами не приходится.
    this.root.addEventListener('pointerdown', (event) => {
      if (event.target === this.root) this.hide();
    });
  }

  /**
   * Заполнить список.
   *
   * @param {Array<{id: string, number: number, name: string}>} levels — цепочка
   * @param {string} [current] — на каком уровне игрок сейчас: он помечается
   */
  /**
   * @param {Array} levels — цепочка уровней
   * @param {string} [current] — на каком игрок сейчас
   * @param {(id: string) => boolean} [passed] — пройден ли уровень
   */
  fill(levels, current = null, passed = () => false) {
    this.list.textContent = '';

    // Открыт уровень, если он пройден, если игрок на нём стоит или если пройден
    // предыдущий по цепочке. Считаем подряд, сверху вниз: первый непройденный
    // открывается — он и есть «куда идти дальше», — а всё, что за ним, заперто.
    let reached = true;

    for (const level of levels) {
      const done = passed(level.id);
      const here = level.id === current;
      const open = reached || done || here;
      reached = open && done; // дальше пускаем, только если этот и правда пройден

      this.list.appendChild(this._card(level, here, done, !open));
    }
  }

  _card(level, here, done = false, locked = false) {
    const card = document.createElement('button');
    card.className = 'levelmap__card';
    card.type = 'button';
    if (here) card.dataset.here = '1';
    if (done) card.dataset.passed = '1';
    if (locked) {
      card.dataset.locked = '1';
      card.disabled = true; // заперт — не нажимается ни мышью, ни с клавиатуры
    }

    // Заставка уровня: та же картинка, что показывается перед входом в него.
    // По ней уровень и узнают — название читают уже вторым.
    const shot = document.createElement('span');
    shot.className = 'levelmap__shot';
    // Путь уже готовый: папка заставок в настройках лежит с учётом того, куда
    // игру выложат.
    shot.style.backgroundImage = `url(${CONFIG.splash.folder}${level.number}.png)`;

    const text = document.createElement('span');
    text.className = 'levelmap__text';

    const number = document.createElement('span');
    number.className = 'levelmap__number';
    number.textContent = CFG.numberLabel(level.number);

    const name = document.createElement('span');
    name.className = 'levelmap__name';
    name.textContent = level.name;

    text.append(number, name);
    card.append(shot, text);

    // Метка одна: «здесь» важнее «пройден», а замок важнее обоих — он один
    // объясняет, почему карточка не нажимается.
    if (locked) {
      const mark = document.createElement('span');
      mark.className = 'levelmap__locked';
      mark.textContent = CFG.lockedLabel;
      card.appendChild(mark);
    } else if (here || done) {
      const mark = document.createElement('span');
      mark.className = here ? 'levelmap__here' : 'levelmap__passed';
      mark.textContent = here ? CFG.hereLabel : CFG.passedLabel;
      card.appendChild(mark);
    }

    if (locked) return card; // нажимать нечего: уровень ещё не открыт

    card.addEventListener('click', () => {
      this.hide();
      this.onPick?.(level.id);
    });

    return card;
  }

  show() {
    if (this.shown) return;

    this.shown = true;
    clearTimeout(this._fade);
    this.root.hidden = false;

    // Открывается всегда сверху: список короткий, и возвращаться к началу
    // вручную было бы странно.
    this.list.scrollTop = 0;

    // Кадр на то, чтобы браузер заметил появление: без него переходу
    // прозрачности не с чего начинать.
    requestAnimationFrame(() => this.root.classList.add('levelmap--on'));

    this.onToggle?.(true);
  }

  hide() {
    if (!this.shown) return;

    this.shown = false;
    this.root.classList.remove('levelmap--on');

    // Сперва растворяется и только потом уходит из разметки: снятая сразу,
    // карта моргнула бы поверх уже идущей игры.
    this._fade = setTimeout(() => { this.root.hidden = true; }, CFG.fadeFor * 1000);

    this.onToggle?.(false);
  }

  toggle() {
    if (this.shown) this.hide();
    else this.show();
  }
}

/**
 * Кнопка, которой карта открывается: уголок вверху справа.
 *
 * Отдельно от самой карты, потому что живёт она не там: карта лежит поверх
 * всего экрана, а кнопка — в ряду прочих значков игры.
 */
export class LevelMapButton {
  constructor(container = document.body) {
    this.root = document.createElement('button');
    this.root.className = 'mapbutton';
    this.root.type = 'button';
    this.root.setAttribute('aria-label', CFG.openLabel);

    // Три полоски: список сверху вниз — то же, что и на самой карте.
    for (let i = 0; i < 3; i++) {
      const line = document.createElement('span');
      line.className = 'mapbutton__line';
      this.root.appendChild(line);
    }

    container.appendChild(this.root);
    this.onPress = null;

    this.root.addEventListener('click', () => this.onPress?.());
  }

  show() { this.root.hidden = false; }
  hide() { this.root.hidden = true; }
}
