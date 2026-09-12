/**
 * Кнопка-переключатель поверх игры.
 *
 * Все такие кнопки складываются в одну колонку в углу экрана: заводится она
 * при первой кнопке, дальше все попадают в неё же.
 */
let holder = null;

export function createToggle(label, onChange, active = false) {
  if (!holder) {
    holder = document.createElement('div');
    holder.className = 'toggles';
    document.body.appendChild(holder);
  }

  const button = document.createElement('button');
  button.className = 'toggle';
  button.textContent = label;
  button.dataset.on = active ? '1' : '0';
  holder.appendChild(button);

  button.addEventListener('click', () => {
    active = !active;
    button.dataset.on = active ? '1' : '0';
    onChange(active);
  });

  onChange(active);
  return button;
}
