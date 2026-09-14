import * as THREE from 'three';

/**
 * Общее у персонажа и зомби: скин, миксер и работа с клипами.
 *
 * Оба — один и тот же скелет из mixamo и одна и та же возня вокруг него: собрать
 * клипы в таблицу, отсеять служебные, пометить разовые, посчитать длительности с
 * поправкой на темп, переключиться с растворением. Раньше это было написано в
 * каждом заново и успело разойтись в мелочах — где-то клип перезапускался, где-то
 * нет, где-то длительность бралась без запаса на отсутствующий клип.
 *
 * Наследники добавляют своё: у персонажа стрельба и прыжок, у зомби состояния.
 */
export class Figure {
  /**
   * @param {THREE.Object3D} root — скин со своим скелетом
   * @param {THREE.AnimationClip[]} clips — его клипы
   * @param {number} fade — за сколько секунд клипы растворяются друг в друга
   */
  constructor(root, clips, fade) {
    this.root = root;
    this.fade = fade;
    this.current = null;

    // тени: фигура и отбрасывает, и принимает — иначе она висит над сценой
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
    });

    this.mixer = new THREE.AnimationMixer(root);
    this.actions = new Map();
    for (const clip of clips) {
      if (clip.name.startsWith('Armature|')) continue; // служебный клип из mixamo-экспорта
      this.actions.set(clip.name, this.mixer.clipAction(clip));
    }
  }

  get position() { return this.root.position; }

  /**
   * Клипы, которые играются один раз и замирают на последнем кадре: смерть,
   * удар, реакция на попадание. Зацикливать их нельзя — смерть повторялась бы.
   *
   * @param {string[]} names
   */
  once(names) {
    for (const name of names) {
      const action = this.actions.get(name);
      if (!action) continue;

      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    }
  }

  /**
   * Сколько длится клип с поправкой на темп, которым его играют.
   *
   * Клип, ускоренный вдвое, и длится вдвое меньше — а логика сверяется именно с
   * реальным временем. Запасное значение нужно на случай, когда клипа в модели
   * нет: без него всё, что считается от длительности, обращалось бы в ноль.
   *
   * @param {string} name @param {number} [speed] @param {number} [fallback] — с
   */
  lengthOf(name, speed = 1, fallback = 1) {
    return (this.actions.get(name)?.getClip().duration ?? fallback) / speed;
  }

  /**
   * Переключиться на клип. Тот же самый не трогаем: перезапуск с нуля виден как
   * рывок, а цикл бега должен идти непрерывно.
   */
  play(name, fade = this.fade) {
    const next = this.actions.get(name);
    if (!next || next === this.current) return;

    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (this.current) this.current.fadeOut(fade);
    this.current = next;
  }

  /**
   * Начать клип заново, даже если он уже идёт.
   *
   * Нужно всему, что может повториться подряд: вторая пуля в того же зомби,
   * второй удар по персонажу, второй бросок. `play` сам по себе такой клип не
   * перезапустит, и повтор не был бы виден — фигура досматривала бы первый.
   *
   * @param {string} name @param {number} fade @param {number} [speed] — темп клипа
   */
  restart(name, fade = this.fade, speed = 1) {
    this.play(name, fade);
    if (!this.current) return;

    this.current.reset().play();
    this.current.timeScale = speed;
  }
}
