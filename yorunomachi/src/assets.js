// Blender で生成した glb を読み込んで複製するための窓口
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const NAMES = ['car_kei', 'car_taxi', 'car_police', 'vending', 'pole', 'lantern', 'cone', 'person', 'pistol', 'torii'];

export async function loadAssets(base = 'assets/models/', onProgress = () => {}) {
  const loader = new GLTFLoader();
  const store = {};
  let done = 0;
  await Promise.all(NAMES.map(async (n) => {
    const gltf = await loader.loadAsync(`${base}${n}${window.__MODEL_EXT ?? '.glb'}`);
    const root = gltf.scene;
    root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false; o.receiveShadow = false;
        const m = o.material;
        // 夜景でしっかり光るよう、発光部はブルームのしきい値を超える強さにする
        if (m.emissive && m.emissive.getHex() !== 0) m.emissiveIntensity = Math.max(m.emissiveIntensity, 3);
        // 自販機は筐体ごと明るく光って見えるように
        if (m.name === 'VendRed') { m.emissive.setRGB(0.5, 0.03, 0.04); m.emissiveIntensity = 0.5; }
        if (m.name === 'VendPanel') m.emissiveIntensity = 1.4;
      }
    });
    store[n] = root;
    onProgress(++done / NAMES.length);
  }));
  return {
    get: (n) => store[n],
    clone: (n) => store[n].clone(true),
    // マテリアルも複製する(個体ごとに色を変えるとき用)
    cloneUnique(n) {
      const c = store[n].clone(true);
      c.traverse((o) => { if (o.isMesh) o.material = o.material.clone(); });
      return c;
    },
  };
}
