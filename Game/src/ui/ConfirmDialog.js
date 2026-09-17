/**
 * Окно «точно?»: вопрос и два ответа, поверх всего остального.
 *
 * Нужно перед тем, что нельзя отменить. В игре такое одно — сброс всей игры с
 * начала, и кнопка его стоит вплотную к той, которую нажимают почти всегда.
 * Промах пальцем не должен стоить всего пройденного.
 *
 * Своё окно, а не подмена кнопок на месте: подменённые читаются как продолжение
 * прежнего экрана, и отвечают на них не глядя. Окно поверх — это остановка,
 * а её и добиваемся.
 *
 * Спрашивает один раз и отвечает обещанием: `await dialog.ask(...)` вернёт
 * `true`, если согласились. Так у вызывающего остаётся обычный прямой код, без
 * россыпи обработчиков.
 */
export class ConfirmDialog {
  constructor(container = document.body) {
    this.root = document.createElement('div');
    this.root.className = 'confirm';
    this.root.hidden = true;

    this.card = document.createElement('div');
    this.card.className = 'confirm__card';

    this.title = document.createElement('p');
    this.title.className = 'confirm__title';

    this.note = document.createElement('p');
    this.note.className = 'confirm__note';

    const buttons = document.createElement('div');
    buttons.className = 'confirm__buttons';

    // «Отмена» первой и она же главная: к безопасному ответу и должна вести
    // рука, а не к тому, после которого ничего не вернуть.
    this.no = document.createElement('button');
    this.no.className = 'confirm__no';
    this.no.type = 'button';

    this.yes = document.createElement('button');
    this.yes.className = 'confirm__yes';
    this.yes.type = 'button';

    buttons.append(this.no, this.yes);
    this.card.append(this.title, this.note, buttons);
    this.root.appendChild(this.card);
    container.appendChild(this.root);

    this.shown = false;
    this._answer = null;
    this._fade = null;

    this.no.addEventListener('pointerdown', (e) => this._close(e, false));
    this.yes.addEventListener('pointerdown', (e) => this._close(e, true));

    // Мимо карточки — то же, что «отмена»: так ведут себя все окна такого рода,
    // и искать кнопку глазами не приходится.
    this.root.addEventListener('pointerdown', (event) => {
      if (event.target === this.root) this._close(event, false);
    });

    // И клавишей — для тех, кто играет за столом.
    this._onKey = (event) => {
      if (!this.shown) return;
      if (event.code === 'Escape') this._close(event, false);
    };
    addEventListener('keydown', this._onKey);
  }

  /**
   * Спросить и дождаться ответа.
   *
   * @param {{title: string, note?: string, yes: string, no: string}} words
   * @returns {Promise<boolean>} согласились ли
   */
  ask({ title, note = '', yes, no }) {
    // Второй вопрос поверх первого — это уже неразбериха. Отвечаем на него
    // отказом и открываем новый.
    if (this.shown) this._close(null, false);

    this.title.textContent = title;
    this.note.textContent = note;
    this.note.hidden = !note;
    this.yes.textContent = yes;
    this.no.textContent = no;

    this.shown = true;
    clearTimeout(this._fade);
    this.root.hidden = false;

    // Кадр на то, чтобы браузер заметил появление: без него переходу
    // прозрачности не с чего начинать, и окно возникнет рывком.
    requestAnimationFrame(() => this.root.classList.add('confirm--on'));

    return new Promise((done) => { this._answer = done; });
  }

  _close(event, agreed) {
    if (event?.cancelable) event.preventDefault();
    if (!this.shown) return;

    this.shown = false;
    this.root.classList.remove('confirm--on');

    // Сперва растворяется и только потом уходит из разметки: снятое сразу,
    // окно моргнуло бы.
    this._fade = setTimeout(() => { this.root.hidden = true; }, FADE);

    const answer = this._answer;
    this._answer = null;
    answer?.(agreed);
  }
}

// Столько же длится переход прозрачности в стилях.
const FADE = 260;
