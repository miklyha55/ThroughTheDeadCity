import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const gltfLoader = new GLTFLoader();

export function loadGLTF(url) {
  return gltfLoader.loadAsync(url);
}
