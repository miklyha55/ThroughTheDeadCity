import { registerSW } from 'virtual:pwa-register';
import { CONFIG } from '../config.js';

const CFG = CONFIG.updates;

/**
 * «Вышла новая версия» — строка внизу и кнопка, которая её ставит.
 *
 * Сама игра ничего не проверяет: за неё это делает служебный поток. Он держит
 * файлы игры у себя, сам замечает, что на сервере лежит сборка новее, и зовёт
 * сюда. Молча подменять версию под игроком он не станет — решает игрок.
 *
 * Именно поэтому нажатие теперь работает с первого раза. Своя проверка версий,
 * что была здесь раньше, спотыкалась о кэш раздачи: она видела новую сборку, но
 * перезагрузка приносила ту же старую страницу из кэша, и кнопка возвращалась
 * снова и снова, пока не нажмёшь перезагрузку с очисткой. Служебный поток сам
 * себе кэш: он подменяет файлы у себя, и страница после него приходит уже новая.
 *
 * Стоит вверху, а не внизу. Внизу у игры занято всё: слева рация, по центру
 * субтитры, справа счётчик кадров, и поверх этого палец возит стик.
 */
export class UpdatePrompt {
  constructor(container = document.body) {
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

    this.root.append(text, this.button);
    container.appendChild(this.root);

    // Обновить поток и перезагрузиться. Всё остальное он делает сам.
    const update = registerSW({
      onNeedRefresh: () => this.show(),
    });

    this.button.addEventListener('click', () => {
      // Второе нажатие ничего не ускорит, а вид «кнопка не сработала» даёт.
      this.button.disabled = true;
      this.button.textContent = CFG.applying;
      update(true);
    });
  }

  show() {
    this.root.hidden = false;
  }
}
