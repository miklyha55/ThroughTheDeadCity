import * as THREE from 'three';

/**
 * Зомби на локации. Пока только стоит и дышит: из всех клипов играет Idle.
 * Дальше сюда добавится преследование, удар и смерть — клипы уже в модели.
 */
export class Zombie {
  /**
   * @param {THREE.Object3D} model — клон скина со своим скелетом
   * @param {THREE.AnimationClip[]} clips — общие клипы библиотеки
   */
  constructor(model, clips) {
    this.root = model;
    this.root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false; // скиннинг ломает bounding box в bind-позе
      }
    });

    this.mixer = new THREE.AnimationMixer(model);
    this.actions = new Map();
    for (const clip of clips) {
      if (clip.name.startsWith('Armature|')) continue; // служебный клип из mixamo-экспорта
      this.actions.set(clip.name, this.mixer.clipAction(clip));
    }

    this.current = null;
    this.play('Idle');
  }

  get position() { return this.root.position; }

  play(name, fade = 0.25) {
    const next = this.actions.get(name);
    if (!next || next === this.current) return;
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (this.current) this.current.fadeOut(fade);
    this.current = next;
  }

  /**
   * Сдвигает анимацию по фазе и темпу.
   * Без этого толпа дышит синхронно, как один механизм.
   */
  desync(offset, speed) {
    if (!this.current) return;
    this.current.time = offset;
    this.current.timeScale = speed;
  }

  update(dt) {
    this.mixer.update(dt);
  }
}
