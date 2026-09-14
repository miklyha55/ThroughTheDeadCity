import * as THREE from 'three';
import { CONFIG } from '../config.js';

/** Рендерер, сцена и игровой цикл. Всё, что имеет update(dt), регистрируется через add(). */
export class Engine {
  constructor(container) {
    this.container = container;
    this.updatables = [];
    this.timer = new THREE.Timer();

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = CONFIG.world.exposure;
    container.appendChild(this.renderer.domElement);

    // Холст красится тем же чёрным, что и страница, и красится СРАЗУ.
    //
    // Пустой холст WebGL непрозрачен и чёрен по-настоящему, в ноль. Страница же
    // чуть светлее, и пока игра не нарисовала первый кадр, поверх страницы
    // лежал прямоугольник другого чёрного во весь экран. Через прозрачные
    // экраны поверх него — тот, что с кнопкой, — это и было видно как деление
    // экрана на две почти одинаковые, но разные половины.
    //
    // Одного `setClearColor` мало: он говорит, чем красить в следующий раз, а
    // покрасить должен кто-то. Поэтому сразу же и красим.
    this.renderer.setClearColor(CONFIG.world.pageColor, 1);
    this.renderer.clear();

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);

    this._resize = this._resize.bind(this);
    addEventListener('resize', this._resize);
    this._resize();
  }

  add(updatable) {
    this.updatables.push(updatable);
    return updatable;
  }

  _resize() {
    const w = this.container.clientWidth || innerWidth;
    const h = this.container.clientHeight || innerHeight;

    // У орто-камеры нет aspect — фрустум собираем руками. Масштаб привязан к КОРОТКОЙ стороне
    // экрана: квадрат viewSize × viewSize виден целиком и в портрете, и в ландшафте,
    // а приближение (пикселей на метр) остаётся одинаковым при любом соотношении сторон.
    const aspect = w / h;
    const halfH = (CONFIG.camera.viewSize / 2) * Math.max(1, 1 / aspect);
    const halfW = halfH * aspect;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  start() {
    this.renderer.setAnimationLoop((timestamp) => {
      this.timer.update(timestamp);
      const dt = Math.min(this.timer.getDelta(), 0.05); // страховка от фриза вкладки
      for (const u of this.updatables) u.update(dt);
      this.renderer.render(this.scene, this.camera);
    });
  }
}
