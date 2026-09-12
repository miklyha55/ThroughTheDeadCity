import * as THREE from 'three';

/**
 * Рисует контуры столкновений поверх сцены: ?debug=collision в адресе.
 * Видно, где именно стоит преграда — по корпусу машины, по стволу дерева,
 * по опорам башни, — и где персонаж пройдёт между ними.
 */
const MATERIAL = new THREE.LineBasicMaterial({ color: 0x00ff88, depthTest: false, transparent: true, opacity: 0.9 });

export function showObstacles(scene, obstacles, height = 0.06) {
  const group = new THREE.Group();
  group.name = 'debug:obstacles';
  group.renderOrder = 999;

  for (const item of obstacles.items) {
    const points = [];
    for (let i = 0; i < item.points.length; i += 2) {
      points.push(new THREE.Vector3(item.points[i], height, item.points[i + 1]));
    }
    group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), MATERIAL));
  }

  scene.add(group);
  return group;
}
