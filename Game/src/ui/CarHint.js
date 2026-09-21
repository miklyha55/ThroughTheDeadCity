import { CONFIG } from '../config.js';
import { HintCard } from './HintCard.js';

const CFG = CONFIG.carHint;

/**
 * Подсказка по машине: показывается один раз, когда герой впервые сел за руль.
 *
 * Машина меняет правила игры целиком, и меняет молча. Стрелять из неё нельзя,
 * зато толпа, от которой всю игру убегали, давится колёсами — а бочка или
 * канистра, которую до сих пор полезно было подрывать издали, теперь рвёт саму
 * машину, едва её задели. Ни того, ни другого по виду не понять: обе вещи
 * выясняются наездом, и вторая — ценой трети запаса прочности.
 *
 * Поэтому подсказка и висит по времени, а не до первого действия. Игрок за
 * рулём трогается сразу, и подсказка, уходящая по нажатию, исчезла бы
 * непрочитанной — а здесь написано не «как», а «чего не делать», и это надо
 * успеть прочесть.
 *
 * Показывается на любом управлении одинаково: правила от того, чем играют, не
 * зависят — в отличие от подсказки по управлению, где клавиши и стик разные.
 */
export class CarHint extends HintCard {
  constructor(container = document.body) {
    super(container, {
      armAfter: CFG.armAfter,
      holdFor: CFG.holdFor,
      fadeFor: CFG.fadeFor,
      closeOnInput: false, // читают, а не осваивают: пусть висит своё время
    });

    this.title = document.createElement('p');
    this.title.className = 'hint__title';
    this.title.textContent = CFG.title;

    this.card.append(this.title, line('good', CFG.ram), line('bad', CFG.avoid));
  }
}

/**
 * Строка правила с точкой на левом поле: зелёной у того, что можно, красной у
 * того, чего нельзя. Цвет тут несёт смысл раньше текста — до чтения видно, что
 * строки про разное.
 *
 * @param {'good'|'bad'} kind
 * @param {string} text
 */
function line(kind, text) {
  const row = document.createElement('p');
  row.className = 'hint__line';

  const mark = document.createElement('span');
  mark.className = `hint__mark hint__mark--${kind}`;

  const label = document.createElement('span');
  label.textContent = text;

  row.append(mark, label);
  return row;
}
