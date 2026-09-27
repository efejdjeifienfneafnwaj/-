// 蒼穹艦隊戦 ─ 飛行戦艦 vs 飛行空母 一人称空中戦
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const V3 = THREE.Vector3;
const $ = (id) => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);

// ------------------------------------------------------------ 設定
const settings = { sens: 1, invertY: false, volume: 0.5, difficulty: 1 };
const ALLY_POS = new V3(0, 0, 0);
const ENEMY_POS = new V3(0, 60, -1800);
const WORLD_LIMIT = 4000;

// ------------------------------------------------------------ レンダラ・シーン
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
$('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xa8c4e0, 700, 4800);
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 9000);
camera.rotation.order = 'YXZ';
scene.add(camera);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x4a5a70, 1.1));
const sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
sun.position.set(800, 900, 300);
scene.add(sun);

// ------------------------------------------------------------ 空・雲海
{
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(8000, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0x1a4a9a) }, bottom: { value: new THREE.Color(0xbcd6ee) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(normalize(vP).y*1.6+0.15,0.0,1.0); gl_FragColor = vec4(mix(bottom, top, h),1.0); }',
    })
  );
  scene.add(sky);
}

function makeCanvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const glowTex = makeCanvasTexture(64, (g, s) => {
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.3, 'rgba(255,255,255,.6)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
});
const cloudTex = makeCanvasTexture(128, (g, s) => {
  for (let i = 0; i < 18; i++) {
    const x = rand(30, 98), y = rand(40, 88), r = rand(18, 40);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  }
});
const seaTex = makeCanvasTexture(256, (g, s) => {
  g.fillStyle = '#dfe9f4'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 260; i++) {
    const x = rand(0, s), y = rand(0, s), r = rand(6, 30);
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '170,190,215'},${rand(0.15, 0.4)})`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
});
seaTex.wrapS = seaTex.wrapT = THREE.RepeatWrapping;
seaTex.repeat.set(40, 40);
{
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), new THREE.MeshLambertMaterial({ map: seaTex }));
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -380;
  scene.add(sea);
  const cloudMat = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, opacity: 0.85 });
  for (let i = 0; i < 160; i++) {
    const s = new THREE.Sprite(cloudMat);
    const a = rand(0, Math.PI * 2), r = rand(300, 5000);
    s.position.set(Math.cos(a) * r, rand(-340, 250), Math.sin(a) * r - 900);
    const sc = rand(250, 750);
    s.scale.set(sc, sc * 0.55, 1);
    scene.add(s);
  }
}

// ------------------------------------------------------------ マテリアル
const M = {
  allyHull: new THREE.MeshStandardMaterial({ color: 0x8a9bb0, metalness: 0.6, roughness: 0.45 }),
  allyDark: new THREE.MeshStandardMaterial({ color: 0x3a4658, metalness: 0.7, roughness: 0.5 }),
  allyLight: new THREE.MeshStandardMaterial({ color: 0x40e0ff, emissive: 0x40e0ff, emissiveIntensity: 2 }),
  hangarFloor: new THREE.MeshStandardMaterial({ color: 0x2c333d, metalness: 0.4, roughness: 0.7 }),
  stripe: new THREE.MeshStandardMaterial({ color: 0xffc020, emissive: 0xffa000, emissiveIntensity: 0.8 }),
  enemyHull: new THREE.MeshStandardMaterial({ color: 0x8a7070, metalness: 0.5, roughness: 0.5 }),
  enemyDark: new THREE.MeshStandardMaterial({ color: 0x4a3c3e, metalness: 0.6, roughness: 0.5 }),
  enemyLight: new THREE.MeshStandardMaterial({ color: 0xff3020, emissive: 0xff2010, emissiveIntensity: 2.5 }),
  turret: new THREE.MeshStandardMaterial({ color: 0x6b5d50, metalness: 0.7, roughness: 0.4 }),
  core: new THREE.MeshStandardMaterial({ color: 0xff40ff, emissive: 0xc020ff, emissiveIntensity: 2.5 }),
  shield: new THREE.MeshBasicMaterial({ color: 0x4090ff, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending }),
  gun: new THREE.MeshStandardMaterial({ color: 0x30363f, metalness: 0.8, roughness: 0.35 }),
};

// ------------------------------------------------------------ 当たり判定用ボックス
const colliders = []; // THREE.Box3 (ワールド座標)
function addBox(parent, origin, w, h, d, x, y, z, mat, collide = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  parent.add(m);
  if (collide) {
    const c = new V3(x, y, z).add(origin);
    colliders.push(new THREE.Box3(c.clone().sub(new V3(w / 2, h / 2, d / 2)), c.clone().add(new V3(w / 2, h / 2, d / 2))));
  }
  return m;
}
function addCyl(parent, rt, rb, h, x, y, z, mat, rotX = 0) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 20), mat);
  m.position.set(x, y, z);
  m.rotation.x = rotX;
  parent.add(m);
  return m;
}

// ------------------------------------------------------------ 自軍旗艦（格納庫つき）
// 船首は -Z（敵方向）。格納庫は船首側に口を開けている。
const ally = new THREE.Group();
ally.position.copy(ALLY_POS);
scene.add(ally);
const allyVisual = new THREE.Group();
ally.add(allyVisual);
const HANGAR = new THREE.Box3(new V3(-15, -8, -150), new V3(15, 8, -60));
const allyGunPoints = [];
{
  const o = ALLY_POS, g = allyVisual;
  addBox(g, o, 60, 40, 210, 0, 0, 45, M.allyHull);            // 後部船体
  addBox(g, o, 60, 12, 90, 0, -14, -105, M.allyHull);          // 格納庫 床
  addBox(g, o, 60, 12, 90, 0, 14, -105, M.allyHull);           // 格納庫 天井
  addBox(g, o, 15, 16, 90, -22.5, 0, -105, M.allyHull);        // 左壁
  addBox(g, o, 15, 16, 90, 22.5, 0, -105, M.allyHull);         // 右壁
  addBox(g, o, 40, 12, 40, 0, -14, -170, M.allyDark);          // 船首下部
  addBox(g, o, 30, 36, 50, 0, 38, 60, M.allyDark);             // 艦橋
  addBox(g, o, 20, 10, 30, 0, 60, 60, M.allyHull);             // 艦橋上部
  addBox(g, o, 80, 6, 60, 0, -4, 90, M.allyHull);              // 翼
  addBox(g, o, 30, 18, 260, 0, -28, 20, M.allyDark);           // キール
  // 格納庫の内装
  addBox(g, o, 29, 0.3, 90, 0, -7.9, -105, M.hangarFloor, false);
  for (let i = 0; i < 9; i++) addBox(g, o, 1.2, 0.35, 5, 0, -7.7, -65 - i * 10, M.stripe, false);
  for (let i = 0; i < 6; i++) {
    addBox(g, o, 0.6, 0.6, 3, -14.4, 5, -70 - i * 15, M.allyLight, false);
    addBox(g, o, 0.6, 0.6, 3, 14.4, 5, -70 - i * 15, M.allyLight, false);
  }
  addBox(g, o, 30, 0.8, 0.8, 0, 7.5, -150, M.allyLight, false);
  const hl = new THREE.PointLight(0x9fe8ff, 400, 80, 1.5);
  hl.position.set(0, 5, -95); g.add(hl);
  // エンジン
  for (const x of [-18, 18]) for (const y of [-8, 8]) {
    addCyl(g, 7, 8, 12, x, y, 155, M.allyDark, Math.PI / 2);
    addCyl(g, 6, 6, 1, x, y, 161.5, M.allyLight, Math.PI / 2);
  }
  // 主砲塔
  for (const z of [-20, 20, 110]) {
    addCyl(g, 8, 9, 5, 0, 22.5, z, M.allyDark);
    addBox(g, o, 3, 3, 26, -3, 24, z - 13, M.gun, false);
    addBox(g, o, 3, 3, 26, 3, 24, z - 13, M.gun, false);
    allyGunPoints.push(new V3(0, 24, z - 26).add(o));
  }
}

// ------------------------------------------------------------ 敵飛行空母
const enemy = new THREE.Group();
enemy.position.copy(ENEMY_POS);
scene.add(enemy);
const enemyVisual = new THREE.Group();
enemy.add(enemyVisual);
{
  const o = ENEMY_POS, g = enemyVisual;
  addBox(g, o, 90, 28, 420, 0, 0, 0, M.enemyHull);             // 主船体
  addBox(g, o, 120, 4, 470, 0, 16, 0, M.enemyDark);            // 飛行甲板
  addBox(g, o, 18, 40, 70, 48, 38, -20, M.enemyHull);          // アイランド
  addBox(g, o, 10, 14, 30, 48, 64, -20, M.enemyDark);
  addBox(g, o, 50, 16, 320, 0, -21, 0, M.enemyDark);           // 下部キール
  addBox(g, o, 60, 20, 40, 0, 0, 230, M.enemyDark);            // 船首（主砲）
  addBox(g, o, 100, 3, 1, 0, 18.5, 234.5, M.enemyLight, false);
  for (let i = 0; i < 10; i++) {
    addBox(g, o, 1.5, 0.6, 12, -3, 18.4, 200 - i * 40, M.enemyLight, false);
    addBox(g, o, 1.5, 0.6, 12, 3, 18.4, 200 - i * 40, M.enemyLight, false);
  }
  for (const x of [-46, 46]) for (let i = 0; i < 8; i++) addBox(g, o, 1, 2, 8, x, 0, 180 - i * 50, M.enemyLight, false);
  addCyl(g, 5, 5, 30, 0, 0, 262, M.gun, Math.PI / 2);          // 主砲身
}

// ------------------------------------------------------------ Blender製モデル（あれば差し替え）
const gltfLoader = new GLTFLoader();
let droneModel = null;
async function tryLoad(name) {
  try {
    const g = await gltfLoader.loadAsync(`models/${name}.glb`);
    return g.scene;
  } catch (e) { return null; }
}
async function loadModels() {
  const [a, e, d] = await Promise.all([tryLoad('ally_battleship'), tryLoad('enemy_carrier'), tryLoad('drone')]);
  let n = 0;
  if (a) { allyVisual.visible = false; ally.add(a); n++; }
  if (e) { enemyVisual.visible = false; enemy.add(e); n++; }
  if (d) { droneModel = d; n++; }
  $('loadInfo').textContent = n ? `Blenderモデル ${n}/3 を読み込みました` : '内蔵モデルを使用中（blender/generate_models.py でBlenderモデルを生成できます）';
}
loadModels();

// ------------------------------------------------------------ サウンド（WebAudio合成）
let actx = null, master = null, noiseBuf = null, boostGain = null;
function initAudio() {
  if (actx) return;
  actx = new AudioContext();
  master = actx.createGain(); master.gain.value = settings.volume; master.connect(actx.destination);
  noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = actx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 0.7;
  boostGain = actx.createGain(); boostGain.gain.value = 0;
  src.connect(bp); bp.connect(boostGain); boostGain.connect(master); src.start();
}
function tone(type, f0, f1, dur, vol) {
  if (!actx) return;
  const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur);
}
function noise(dur, vol, freq, type = 'lowpass') {
  if (!actx) return;
  const t = actx.currentTime, s = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
  s.buffer = noiseBuf; f.type = type; f.frequency.setValueAtTime(freq, t); f.frequency.exponentialRampToValueAtTime(60, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur);
}
const sfx = {
  shot: () => { tone('square', 700, 180, 0.06, 0.05); noise(0.05, 0.08, 3000); },
  missile: () => noise(0.7, 0.3, 2500, 'bandpass'),
  boom: (dist, big = 1) => noise(0.6 + big * 0.5, Math.min(0.9, big * 300 / (dist + 150)), 900),
  hit: () => tone('sawtooth', 220, 60, 0.15, 0.15),
  lock: () => tone('sine', 1400, 1400, 0.08, 0.08),
  alarm: () => { tone('square', 880, 880, 0.12, 0.06); },
};

// ------------------------------------------------------------ エフェクト
const effects = [];
function spawnGlow(pos, color, size, life, grow = 3, additive = true, vel = null) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color, transparent: true, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  }));
  s.position.copy(pos); s.scale.setScalar(size);
  scene.add(s);
  effects.push({ s, life, max: life, size, grow, vel });
}
function explosion(pos, big = 1) {
  spawnGlow(pos, 0xffffff, 8 * big, 0.25, 4);
  for (let i = 0; i < 6 + big * 6; i++) {
    const v = new V3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(5, 25) * big);
    spawnGlow(pos, i % 2 ? 0xff8030 : 0xffd060, rand(4, 10) * big, rand(0.5, 1.2), 2.5, true, v);
  }
  for (let i = 0; i < 3 + big * 2; i++) {
    const v = new V3(rand(-1, 1), rand(0, 1), rand(-1, 1)).multiplyScalar(6 * big);
    spawnGlow(pos, 0x404040, rand(6, 12) * big, rand(1.2, 2.2), 2, false, v);
  }
  sfx.boom(pos.distanceTo(player.pos), big);
}
function updateEffects(dt) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.life -= dt;
    if (e.life <= 0) { scene.remove(e.s); e.s.material.dispose(); effects.splice(i, 1); continue; }
    const k = 1 - e.life / e.max;
    e.s.scale.setScalar(e.size * (1 + k * e.grow));
    e.s.material.opacity = (1 - k) * (e.s.material.blending === THREE.AdditiveBlending ? 1 : 0.6);
    if (e.vel) e.s.position.addScaledVector(e.vel, dt);
  }
}
// ビーム（旗艦の主砲演出）
const beams = [];
function spawnBeam(a, b, color) {
  const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending }));
  scene.add(line);
  beams.push({ line, life: 0.35 });
}

// ------------------------------------------------------------ プレイヤー
const player = {
  pos: new V3(), vel: new V3(), yaw: 0, pitch: 0, hp: 100, boost: 100, missiles: 8,
  fireCd: 0, missileCd: 0, bumpCd: 0, boostDelay: 0, supplyT: 0, missileRegen: 0,
};
const keys = new Set();
let mouseDown = false;

// 一人称の両腕の武装
{
  const armMat = new THREE.MeshStandardMaterial({ color: 0x7a8898, metalness: 0.3, roughness: 0.5 });
  for (const x of [-0.42, 0.42]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.4), armMat);
    arm.position.set(x, -0.3, -0.8);
    camera.add(arm);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.04), M.allyLight);
    tip.position.set(x, -0.3, -1.0);
    camera.add(tip);
  }
}

// ------------------------------------------------------------ 標的（砲台・コア・ドローン・プラズマ弾）
let targets = [];
let bullets = [];
let missiles = [];
let state = 'title';
let game = {};

const bulletGeoP = new THREE.BoxGeometry(0.25, 0.25, 6);
const bulletMatP = new THREE.MeshBasicMaterial({ color: 0x80ffff, blending: THREE.AdditiveBlending, transparent: true });
const bulletGeoE = new THREE.SphereGeometry(0.9, 8, 6);
const bulletMatE = new THREE.MeshBasicMaterial({ color: 0xff7030, blending: THREE.AdditiveBlending, transparent: true });

function makeTurret(lx, ly, lz, under) {
  const root = new THREE.Group();
  root.position.set(lx, ly, lz);
  if (under) root.rotation.z = Math.PI;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(6, 7, 3, 16), M.turret);
  root.add(base);
  const head = new THREE.Group();
  head.position.y = 3.5;
  root.add(head);
  head.add(new THREE.Mesh(new THREE.SphereGeometry(4.5, 16, 10), M.turret));
  for (const x of [-1.5, 1.5]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 9), M.gun);
    b.position.set(x, 0.5, 5); head.add(b);
  }
  const eye = new THREE.Mesh(new THREE.SphereGeometry(1.2, 8, 6), M.enemyLight);
  eye.position.set(0, 2, 3.5); head.add(eye);
  enemy.add(root);
  return { type: 'turret', name: '対空砲台', obj: root, head, hp: 120, maxHp: 120, radius: 7, cd: rand(1, 3) };
}
function makeCore(lx) {
  const root = new THREE.Group();
  root.position.set(lx, 0, -222);
  const housing = new THREE.Mesh(new THREE.CylinderGeometry(13, 15, 16, 24), M.enemyDark);
  housing.rotation.x = Math.PI / 2; root.add(housing);
  const core = new THREE.Mesh(new THREE.SphereGeometry(8, 20, 14), M.core);
  core.position.z = -8; root.add(core);
  const shield = new THREE.Mesh(new THREE.SphereGeometry(20, 24, 16), M.shield);
  shield.position.z = -6; root.add(shield);
  enemy.add(root);
  return { type: 'core', name: '機関コア', obj: root, core, shield, hp: 500, maxHp: 500, radius: 11, centerOffset: new V3(0, 0, -8) };
}
function makeDrone(pos) {
  let mesh;
  if (droneModel) mesh = droneModel.clone();
  else {
    mesh = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ConeGeometry(1.4, 6, 8), M.enemyHull);
    body.rotation.x = Math.PI / 2; mesh.add(body);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(8, 0.3, 2), M.enemyDark);
    wing.position.z = -1; mesh.add(wing);
    const eng = new THREE.Mesh(new THREE.SphereGeometry(0.8, 8, 6), M.enemyLight);
    eng.position.z = -3; mesh.add(eng);
  }
  mesh.position.copy(pos);
  scene.add(mesh);
  return {
    type: 'drone', name: '無人戦闘機', obj: mesh, hp: 30 * settings.difficulty, maxHp: 30, radius: 4,
    dir: new V3(0, 0, 1), cd: rand(1, 2), offset: new V3(), offsetT: 0, speed: rand(75, 95),
  };
}
function makePlasma(from, to) {
  const mesh = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffe040, blending: THREE.AdditiveBlending, depthWrite: false }));
  mesh.scale.setScalar(22);
  mesh.position.copy(from);
  scene.add(mesh);
  return { type: 'plasma', name: '主砲プラズマ弾', obj: mesh, hp: 40, maxHp: 40, radius: 9, to, vel: to.clone().sub(from).normalize().multiplyScalar(150) };
}
function targetPos(t, out = new V3()) {
  if (t.centerOffset) return out.copy(t.centerOffset).applyMatrix4(t.obj.matrixWorld);
  return t.obj.getWorldPosition(out);
}

// ------------------------------------------------------------ ゲーム開始・リセット
function clearWorld() {
  for (const t of targets) {
    if (t.type === 'drone' || t.type === 'plasma') scene.remove(t.obj);
    else enemy.remove(t.obj);
  }
  for (const b of bullets) scene.remove(b.mesh);
  for (const m of missiles) scene.remove(m.mesh);
  targets = []; bullets = []; missiles = [];
}
function startGame() {
  initAudio();
  clearWorld();
  enemy.position.copy(ENEMY_POS);
  enemy.rotation.set(0, 0, 0);
  const tp = [[-50, 18, 150, false], [50, 18, 150, false], [-50, 18, -60, false], [50, 18, -160, false], [0, -29, 100, true], [0, -29, -100, true]];
  for (const [x, y, z, u] of tp) targets.push(makeTurret(x, y, z, u));
  targets.push(makeCore(-25), makeCore(25));
  enemy.updateMatrixWorld(true);
  Object.assign(player, {
    hp: 100, boost: 100, missiles: 8, fireCd: 0, missileCd: 0, bumpCd: 0, yaw: 0, pitch: 0,
    missileRegen: 0,
  });
  player.pos.set(0, -5, -75);
  player.vel.set(0, 0, 0);
  game = {
    t: 0, score: 0, allyHp: 100, droneT: 8, plasmaT: 14, allyGunT: 3, phase: 1, lock: null, lockT: 0,
    msgT: 0, dmgFlash: 0, endT: 0, shieldDown: false, kills: 0,
  };
  showScreen(null);
  $('hud').classList.remove('hidden');
  state = 'playing';
  message('格納庫ハッチ開放 ─ 出撃せよ！', 3);
  renderer.domElement.requestPointerLock();
}

// ------------------------------------------------------------ 画面遷移
const screens = ['title', 'help', 'settings', 'pause', 'result'];
let prevScreen = 'title';
function showScreen(id) {
  for (const s of screens) $(s).classList.toggle('hidden', s !== id);
}
$('btnStart').onclick = startGame;
$('btnRetry').onclick = startGame;
$('btnRetry2').onclick = startGame;
$('btnHelp').onclick = () => { prevScreen = 'title'; showScreen('help'); };
$('btnSettings').onclick = () => { prevScreen = 'title'; showScreen('settings'); };
document.querySelectorAll('.back').forEach((b) => (b.onclick = () => showScreen(prevScreen)));
$('btnResume').onclick = () => { state = 'playing'; showScreen(null); renderer.domElement.requestPointerLock(); };
const toTitle = () => { state = 'title'; clearWorld(); $('hud').classList.add('hidden'); showScreen('title'); };
$('btnTitle').onclick = toTitle;
$('btnTitle2').onclick = toTitle;
$('sens').oninput = (e) => { settings.sens = +e.target.value; $('sensVal').textContent = settings.sens.toFixed(1); };
$('invertY').onchange = (e) => (settings.invertY = e.target.checked);
$('volume').oninput = (e) => { settings.volume = +e.target.value; if (master) master.gain.value = settings.volume; };
$('difficulty').onchange = (e) => (settings.difficulty = +e.target.value);

document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && state === 'playing') {
    state = 'paused';
    showScreen('pause');
    mouseDown = false; keys.clear();
  }
});
renderer.domElement.addEventListener('click', () => {
  if (state === 'playing' && !document.pointerLockElement) renderer.domElement.requestPointerLock();
});
addEventListener('mousemove', (e) => {
  if (state !== 'playing' || !document.pointerLockElement) return;
  const s = 0.0022 * settings.sens;
  player.yaw -= e.movementX * s;
  player.pitch -= e.movementY * s * (settings.invertY ? -1 : 1);
  player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch));
});
addEventListener('mousedown', (e) => {
  if (state !== 'playing') return;
  if (e.button === 0) mouseDown = true;
  if (e.button === 2) fireMissile();
});
addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; });
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (state === 'playing' && e.code === 'KeyF') fireMissile();
  if (e.code === 'Space' || e.code.startsWith('Control')) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));

// ------------------------------------------------------------ HUD補助
function message(text, dur = 2.5) {
  $('message').textContent = text;
  $('message').style.opacity = 1;
  game.msgT = dur;
}
function damagePlayer(n) {
  if (state !== 'playing') return;
  player.hp -= n * settings.difficulty;
  game.dmgFlash = 0.4;
  sfx.hit();
  if (player.hp <= 0) { player.hp = 0; explosion(player.pos.clone(), 2); endGame(false, 'あなたの機体は撃墜された…'); }
}
function endGame(win, text) {
  state = win ? 'victory' : 'over';
  game.endT = win ? 6 : 2.2;
  game.endText = text;
  if (document.pointerLockElement) document.exitPointerLock();
}
function showResult() {
  const win = state === 'victory';
  state = 'result';
  const mm = Math.floor(game.t / 60), ss = Math.floor(game.t % 60).toString().padStart(2, '0');
  let rank = '';
  if (win) {
    const bonus = Math.round(game.allyHp * 50 + player.hp * 30 + Math.max(0, 300 - game.t) * 20);
    game.score += bonus;
    rank = game.score > 30000 ? 'S' : game.score > 20000 ? 'A' : game.score > 12000 ? 'B' : 'C';
  }
  $('resultTitle').textContent = win ? '作戦成功 ─ 敵空母撃沈！' : '作戦失敗';
  $('resultText').innerHTML = `${game.endText}<br><br>経過時間：${mm}:${ss}　撃墜数：${game.kills}<br>` +
    `旗艦耐久：${Math.round(game.allyHp)}%　スコア：${game.score}` + (win ? `<br><br><b style="font-size:28px">評価 ${rank}</b>` : '');
  $('hud').classList.add('hidden');
  showScreen('result');
}

// ------------------------------------------------------------ 武装
const tmpV = new V3(), tmpV2 = new V3();
function camBasis() {
  const q = camera.quaternion;
  return { fwd: new V3(0, 0, -1).applyQuaternion(q), right: new V3(1, 0, 0).applyQuaternion(q), up: new V3(0, 1, 0).applyQuaternion(q) };
}
function spawnBullet(pos, vel, owner, dmg, life = 2) {
  const mesh = new THREE.Mesh(owner === 'player' ? bulletGeoP : bulletGeoE, owner === 'player' ? bulletMatP : bulletMatE);
  mesh.position.copy(pos);
  mesh.lookAt(tmpV.copy(pos).add(vel));
  scene.add(mesh);
  bullets.push({ mesh, vel, owner, dmg, life });
}
let gunSide = 1;
function firePlayerGun() {
  const { fwd, right, up } = camBasis();
  // 照準点に向けて左右交互に射撃
  const aim = player.pos.clone().addScaledVector(fwd, 500);
  gunSide = -gunSide;
  const from = player.pos.clone().addScaledVector(right, 0.42 * gunSide).addScaledVector(up, -0.3).addScaledVector(fwd, 1.1);
  const dir = aim.sub(from).normalize();
  dir.x += rand(-0.006, 0.006); dir.y += rand(-0.006, 0.006);
  spawnBullet(from, dir.normalize().multiplyScalar(800).add(player.vel), 'player', 9, 1.4);
  sfx.shot();
}
function fireMissile() {
  if (player.missileCd > 0) return;
  if (player.missiles <= 0) { message('ミサイル残弾なし ─ 格納庫で補給せよ', 1.5); return; }
  player.missiles--;
  player.missileCd = 0.35;
  const { fwd, up } = camBasis();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 2, 6), M.gun);
  mesh.geometry.rotateX(Math.PI / 2);
  mesh.position.copy(player.pos).addScaledVector(up, -0.8);
  scene.add(mesh);
  const target = game.lockT >= 0.5 ? game.lock : null;
  missiles.push({ mesh, vel: fwd.clone().multiplyScalar(120).add(player.vel), target, life: 7, trailT: 0 });
  sfx.missile();
}
function isShielded(t) { return t.type === 'core' && !game.shieldDown; }
function damageTarget(t, n, hitPos) {
  if (t.dead) return;
  if (isShielded(t)) { spawnGlow(hitPos, 0x60a0ff, 3, 0.2); return; }
  t.hp -= n;
  spawnGlow(hitPos, 0xffe0a0, 2.5, 0.12);
  if (t.hp <= 0) killTarget(t);
}
function killTarget(t) {
  t.dead = true;
  const p = targetPos(t);
  if (t.type === 'turret') {
    explosion(p, 2.5);
    t.obj.visible = false;
    game.score += 1500;
    const left = targets.filter((x) => x.type === 'turret' && !x.dead).length;
    if (left > 0) message(`対空砲台 撃破！ 残り ${left} 基`);
    else {
      game.shieldDown = true;
      for (const c of targets) if (c.type === 'core') c.shield.visible = false;
      message('全砲台沈黙！ 機関部シールド消失 ─ 空母後部の機関コアを破壊せよ！', 4);
      sfx.alarm();
    }
  } else if (t.type === 'core') {
    explosion(p, 4);
    t.core.visible = false;
    game.score += 5000;
    const left = targets.filter((x) => x.type === 'core' && !x.dead).length;
    if (left > 0) message(`機関コア 破壊！ 残り ${left} 基`);
    else { message('敵空母ベヒモス、撃沈！', 5); endGame(true, '敵空母は炎に包まれ、雲海へと沈んでいった。'); }
  } else if (t.type === 'drone') {
    explosion(p, 1.2);
    scene.remove(t.obj);
    game.score += 300; game.kills++;
  } else if (t.type === 'plasma') {
    explosion(p, 2);
    scene.remove(t.obj);
    game.score += 800;
    message('主砲弾を迎撃！', 1.5);
  }
}

// 線分と球の交差
function segSphere(a, b, c, r) {
  const ab = tmpV.copy(b).sub(a), ac = tmpV2.copy(c).sub(a);
  const len2 = ab.lengthSq();
  const t = len2 > 0 ? Math.max(0, Math.min(1, ac.dot(ab) / len2)) : 0;
  return ab.multiplyScalar(t).add(a).distanceToSquared(c) <= r * r;
}
const ray = new THREE.Ray();
function segHitsHull(a, b) {
  const d = b.clone().sub(a), len = d.length();
  if (len === 0) return null;
  ray.set(a, d.divideScalar(len));
  const hit = new V3();
  for (const box of colliders) {
    if (ray.intersectBox(box, hit) && hit.distanceTo(a) <= len) return hit.clone();
  }
  return null;
}

// ------------------------------------------------------------ 更新処理
function updatePlayer(dt) {
  camera.rotation.set(player.pitch, player.yaw, 0);
  const { fwd, right } = camBasis();
  const acc = new V3();
  if (keys.has('KeyW')) acc.add(fwd);
  if (keys.has('KeyS')) acc.sub(fwd);
  if (keys.has('KeyD')) acc.add(right);
  if (keys.has('KeyA')) acc.sub(right);
  if (keys.has('Space')) acc.y += 1;
  if (keys.has('KeyC') || keys.has('ControlLeft') || keys.has('ControlRight')) acc.y -= 1;
  const wantBoost = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const boosting = wantBoost && player.boost > 0 && acc.lengthSq() > 0;
  if (boosting) { player.boost = Math.max(0, player.boost - 28 * dt); player.boostDelay = 0.6; }
  else { player.boostDelay -= dt; if (player.boostDelay <= 0) player.boost = Math.min(100, player.boost + 20 * dt); }
  if (acc.lengthSq() > 0) acc.normalize().multiplyScalar(boosting ? 300 : 95);
  player.vel.addScaledVector(acc, dt);
  player.vel.multiplyScalar(Math.exp(-1.3 * dt));
  if (player.vel.length() > 240) player.vel.setLength(240);
  player.pos.addScaledVector(player.vel, dt);

  // 船体との衝突
  const r = 2;
  for (const box of colliders) {
    const cp = box.clampPoint(player.pos, tmpV);
    const d2 = cp.distanceToSquared(player.pos);
    if (d2 >= r * r) continue;
    let n;
    if (d2 > 1e-6) n = player.pos.clone().sub(cp).normalize();
    else { // 中心が内部 → 最小貫通軸で押し出す
      const c = box.getCenter(new V3()), s = box.getSize(new V3()), p = player.pos.clone().sub(c);
      const pen = [s.x / 2 - Math.abs(p.x), s.y / 2 - Math.abs(p.y), s.z / 2 - Math.abs(p.z)];
      const i = pen.indexOf(Math.min(...pen));
      n = new V3(); n.setComponent(i, Math.sign(p.getComponent(i)) || 1);
    }
    player.pos.copy(cp).addScaledVector(n, r + 0.01);
    const vn = player.vel.dot(n);
    if (vn < 0) {
      if (vn < -90 && player.bumpCd <= 0) { damagePlayer(6); player.bumpCd = 0.8; message('船体に接触！', 1); }
      player.vel.addScaledVector(n, -vn * 1.3);
    }
  }
  player.bumpCd -= dt;

  // 高度・範囲制限
  if (player.pos.y < -330) { player.pos.y = -330; player.vel.y = Math.max(0, player.vel.y); }
  if (player.pos.y > 1200) { player.pos.y = 1200; player.vel.y = Math.min(0, player.vel.y); }
  const horiz = Math.hypot(player.pos.x, player.pos.z + 900);
  if (horiz > WORLD_LIMIT) {
    player.vel.x -= player.pos.x / horiz * 200 * dt;
    player.vel.z -= (player.pos.z + 900) / horiz * 200 * dt;
    if (game.msgT <= 0) message('作戦空域外 ─ 帰還せよ', 1);
  }

  camera.position.copy(player.pos);
  // ブースト時の視野角・振動
  const targetFov = boosting ? 92 : 75;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 5);
  camera.updateProjectionMatrix();
  if (boosting) camera.position.add(new V3(rand(-0.05, 0.05), rand(-0.05, 0.05), 0));
  if (boostGain) boostGain.gain.value += ((boosting ? 0.35 : 0.04) - boostGain.gain.value) * Math.min(1, dt * 6);
  if (boosting && Math.random() < 0.5) {
    spawnGlow(player.pos.clone().addScaledVector(fwd, -3).add(new V3(rand(-1, 1), -1.5, rand(-1, 1))), 0x60c0ff, 1.2, 0.25, 1);
  }

  // 射撃
  player.fireCd -= dt; player.missileCd -= dt;
  if (mouseDown && player.fireCd <= 0) { firePlayerGun(); player.fireCd = 0.075; }

  // ミサイル自然回復
  player.missileRegen += dt;
  if (player.missileRegen > 12 && player.missiles < 8) { player.missiles++; player.missileRegen = 0; }

  // 格納庫で補給
  const inHangar = HANGAR.containsPoint(player.pos);
  $('supply').style.display = inHangar && game.t > 4 ? 'block' : 'none';
  if (inHangar) {
    player.hp = Math.min(100, player.hp + 25 * dt);
    player.supplyT += dt;
    if (player.supplyT > 0.4 && player.missiles < 8) { player.missiles++; player.supplyT = 0; }
  }
}

function updateLock(dt) {
  const { fwd } = camBasis();
  let best = null, bestAng = 0.26; // 約15度
  for (const t of targets) {
    if (t.dead || isShielded(t)) continue;
    const p = targetPos(t, tmpV2);
    const d = p.clone().sub(player.pos);
    const dist = d.length();
    if (dist > 1300) continue;
    const ang = fwd.angleTo(d);
    if (ang < bestAng) { bestAng = ang; best = t; }
  }
  if (best !== game.lock) { game.lock = best; game.lockT = 0; }
  else if (best) {
    const before = game.lockT;
    game.lockT += dt;
    if (before < 0.5 && game.lockT >= 0.5) sfx.lock();
  }
}

function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    const a = b.mesh.position.clone();
    const nxt = a.clone().addScaledVector(b.vel, dt);
    let hit = false;
    if (b.owner === 'player') {
      for (const t of targets) {
        if (t.dead) continue;
        const r = isShielded(t) ? 20 : t.radius;
        const c = targetPos(t);
        if (segSphere(a, nxt, c, r)) { damageTarget(t, b.dmg, nxt); hit = true; break; }
      }
    } else if (state === 'playing' && segSphere(a, nxt, player.pos, 2.5)) {
      damagePlayer(b.dmg); hit = true;
    }
    if (!hit) {
      const h = segHitsHull(a, nxt);
      if (h) { spawnGlow(h, b.owner === 'player' ? 0x80ffff : 0xff8040, 2, 0.15); hit = true; }
    }
    b.life -= dt;
    if (hit || b.life <= 0) { scene.remove(b.mesh); bullets.splice(i, 1); continue; }
    b.mesh.position.copy(nxt);
  }
}

function updateMissiles(dt) {
  for (let i = missiles.length - 1; i >= 0; i--) {
    const m = missiles[i];
    const a = m.mesh.position.clone();
    if (m.target && !m.target.dead) {
      const desired = targetPos(m.target).sub(a).normalize();
      const speed = Math.min(260, m.vel.length() + 200 * dt);
      const dir = m.vel.clone().normalize().lerp(desired, Math.min(1, 4 * dt)).normalize();
      m.vel.copy(dir.multiplyScalar(speed));
    } else m.vel.setLength(Math.min(260, m.vel.length() + 200 * dt));
    const nxt = a.clone().addScaledVector(m.vel, dt);
    m.mesh.position.copy(nxt);
    m.mesh.lookAt(nxt.clone().add(m.vel));
    m.trailT -= dt;
    if (m.trailT <= 0) { spawnGlow(a, 0xbbbbbb, 1.6, 0.9, 2, false); spawnGlow(a, 0xffa040, 1, 0.1); m.trailT = 0.02; }
    m.life -= dt;
    let hit = null;
    for (const t of targets) {
      if (t.dead) continue;
      if (segSphere(a, nxt, targetPos(t), isShielded(t) ? 20 : t.radius + 2)) { hit = t; break; }
    }
    const hull = hit ? null : segHitsHull(a, nxt);
    if (hit || hull || m.life <= 0) {
      explosion(nxt, 1.4);
      if (hit) damageTarget(hit, 130, nxt);
      scene.remove(m.mesh); missiles.splice(i, 1);
    }
  }
}

function enemyShoot(from, speed, dmg, spread) {
  const dist = from.distanceTo(player.pos);
  const lead = player.pos.clone().addScaledVector(player.vel, dist / speed);
  const dir = lead.sub(from).normalize();
  dir.add(new V3(rand(-spread, spread), rand(-spread, spread), rand(-spread, spread))).normalize();
  spawnBullet(from, dir.multiplyScalar(speed), 'enemy', dmg, 4);
}

function updateEnemies(dt) {
  const diff = settings.difficulty;
  const alivePlaying = state === 'playing';
  for (const t of targets) {
    if (t.dead) continue;
    if (t.type === 'turret') {
      const p = targetPos(t);
      const dist = p.distanceTo(player.pos);
      if (dist < 900) {
        // 砲塔を自機に向ける
        const local = t.obj.worldToLocal(player.pos.clone());
        t.head.rotation.y = Math.atan2(local.x, local.z);
        t.cd -= dt;
        if (t.cd <= 0 && alivePlaying) {
          const muzzle = t.head.localToWorld(new V3(0, 0.5, 9));
          for (let k = 0; k < 3; k++) enemyShoot(muzzle, 260, 5, 0.03);
          t.cd = rand(1.2, 2.2) / diff;
        }
      }
    } else if (t.type === 'core') {
      const s = 1 + Math.sin(game.t * 4) * 0.08;
      t.core.scale.setScalar(s);
      if (t.shield.visible) t.shield.rotation.y += dt;
    } else if (t.type === 'drone') {
      t.offsetT -= dt;
      if (t.offsetT <= 0) { t.offset.set(rand(-1, 1), rand(-0.5, 0.5), rand(-1, 1)).setLength(rand(40, 90)); t.offsetT = rand(2.5, 4.5); }
      const goal = player.pos.clone().add(t.offset);
      const desired = goal.sub(t.obj.position).normalize();
      t.dir.lerp(desired, Math.min(1, 1.6 * dt)).normalize();
      t.obj.position.addScaledVector(t.dir, t.speed * dt);
      t.obj.lookAt(tmpV.copy(t.obj.position).add(t.dir));
      const toP = player.pos.clone().sub(t.obj.position);
      const dist = toP.length();
      t.cd -= dt;
      if (alivePlaying && dist < 450 && t.dir.dot(toP.normalize()) > 0.9 && t.cd <= 0) {
        enemyShoot(t.obj.position.clone(), 240, 3, 0.02);
        t.cd = rand(1.0, 1.8) / diff;
      }
      if (dist < 5) { killTarget(t); damagePlayer(10); }
    } else if (t.type === 'plasma') {
      t.obj.position.addScaledVector(t.vel, dt);
      t.obj.material.rotation += dt * 3;
      if (Math.random() < 0.6) spawnGlow(t.obj.position, 0xffc030, 10, 0.5, 1);
      if (t.obj.position.distanceTo(t.to) < 12) {
        t.dead = true; scene.remove(t.obj);
        explosion(t.to, 4);
        game.allyHp -= 7 * diff;
        message('旗艦被弾！ 主砲弾を迎撃せよ！', 2);
        sfx.alarm();
        if (game.allyHp <= 0 && state === 'playing') { game.allyHp = 0; endGame(false, '旗艦「アマテラス」が撃沈された…'); }
      }
    }
  }
  targets = targets.filter((t) => !(t.dead && (t.type === 'drone' || t.type === 'plasma')));

  if (state !== 'playing') return;
  // ドローン発艦
  game.droneT -= dt;
  const drones = targets.filter((t) => t.type === 'drone').length;
  if (game.droneT <= 0 && drones < Math.round(6 * diff)) {
    const p = enemy.localToWorld(new V3(rand(-30, 30), 22, rand(100, 200)));
    const d = makeDrone(p);
    d.dir.set(0, 0.3, 1).normalize();
    targets.push(d);
    game.droneT = (game.shieldDown ? 4 : 6.5) / diff;
  }
  // 敵主砲 → 旗艦
  game.plasmaT -= dt;
  if (game.plasmaT <= 0) {
    const from = enemy.localToWorld(new V3(0, 0, 278));
    const to = new V3(rand(-25, 25), rand(-10, 15), rand(-40, 140)).add(ALLY_POS);
    to.x = Math.sign(to.x || 1) * 30; // 船体側面に着弾
    targets.push(makePlasma(from, to));
    spawnGlow(from, 0xffe040, 40, 0.6, 2);
    message('警告：敵主砲 発射！', 1.5);
    sfx.alarm();
    game.plasmaT = rand(12, 16) / diff;
  }
  // 旗艦の艦砲射撃（演出）
  game.allyGunT -= dt;
  if (game.allyGunT <= 0) {
    const from = allyGunPoints[Math.floor(Math.random() * allyGunPoints.length)];
    const to = enemy.localToWorld(new V3(rand(-45, 45), rand(-10, 10), rand(-100, 200)));
    to.x = Math.sign(to.x) * 46;
    spawnBeam(from, to, 0x60e0ff);
    spawnGlow(to, 0x80e0ff, 18, 0.5, 2);
    game.allyGunT = rand(2, 4);
  }
}

// ------------------------------------------------------------ HUD描画
const radarCtx = $('radar').getContext('2d');
const markerDivs = new Map();
function project(p) {
  const v = p.clone().project(camera);
  if (v.z > 1) return null;
  return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
}
function updateHUD(dt) {
  $('hpBar').style.width = player.hp + '%';
  $('hpBar').style.background = player.hp < 30 ? '#ff5050' : '#4dff9a';
  $('boostBar').style.width = player.boost + '%';
  $('allyBar').style.width = Math.max(0, game.allyHp) + '%';
  $('speed').textContent = Math.round(player.vel.length() * 3.6);
  $('alt').textContent = Math.round(player.pos.y + 1000);
  $('score').textContent = game.score;
  $('time').textContent = `${Math.floor(game.t / 60)}:${Math.floor(game.t % 60).toString().padStart(2, '0')}`;
  $('missiles').textContent = `ミサイル ×${player.missiles}`;
  const tur = targets.filter((t) => t.type === 'turret' && !t.dead).length;
  const cores = targets.filter((t) => t.type === 'core' && !t.dead);
  const coreHp = cores.reduce((s, c) => s + Math.max(0, c.hp), 0) / 10;
  $('enemyStatus').innerHTML = `対空砲台：残り ${tur} / 6<br>機関シールド：${game.shieldDown ? '<span style="color:#ff6060">消失</span>' : '展開中'}<br>機関コア：${cores.length} 基（${Math.round(coreHp)}%）`;
  $('objective').textContent = game.shieldDown ? '目標：空母後部の機関コアを破壊せよ' : `目標：敵空母の対空砲台を破壊せよ（残り ${tur}）`;

  game.msgT -= dt;
  if (game.msgT <= 0) $('message').style.opacity = 0;
  game.dmgFlash = Math.max(0, game.dmgFlash - dt);
  $('damage').style.opacity = Math.max(game.dmgFlash * 2, player.hp < 25 ? 0.35 + Math.sin(game.t * 6) * 0.15 : 0);

  // 標的マーカー
  const seen = new Set();
  for (const t of targets) {
    if (t.dead || t.type === 'drone') continue;
    const p = targetPos(t);
    const sp = project(p);
    if (!sp) continue;
    let div = markerDivs.get(t);
    if (!div) { div = document.createElement('div'); $('markers').appendChild(div); markerDivs.set(t, div); }
    div.className = 'marker ' + (isShielded(t) ? 'shield' : t.type);
    div.style.left = sp.x + 'px'; div.style.top = sp.y + 'px';
    const dist = p.distanceTo(player.pos);
    div.textContent = dist < 700 || t.type === 'plasma' ? `${t.name}${isShielded(t) ? '(シールド)' : ''} ${Math.round(dist)}m` : '';
    seen.add(t);
  }
  for (const [t, div] of markerDivs) if (!seen.has(t)) { div.remove(); markerDivs.delete(t); }

  // ロックオン表示
  const lock = $('lock');
  if (game.lock && !game.lock.dead) {
    const sp = project(targetPos(game.lock));
    if (sp) {
      lock.style.display = 'block';
      lock.style.left = sp.x + 'px'; lock.style.top = sp.y + 'px';
      const locked = game.lockT >= 0.5;
      lock.classList.toggle('locked', locked);
      lock.style.color = locked ? '#ff4040' : '#ffd86a';
      lock.dataset.t = locked ? `ロックオン ${game.lock.name} ${Math.round(game.lock.hp)}` : 'ロック中…';
    } else lock.style.display = 'none';
  } else lock.style.display = 'none';

  // レーダー
  const g = radarCtx, R = 90, range = 1600;
  g.clearRect(0, 0, 180, 180);
  g.strokeStyle = 'rgba(80,255,160,.35)';
  g.beginPath(); g.arc(R, R, R * 0.5, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(R, 0); g.lineTo(R, 180); g.moveTo(0, R); g.lineTo(180, R); g.stroke();
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw), rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
  const dot = (p, color, size) => {
    const dx = p.x - player.pos.x, dz = p.z - player.pos.z;
    let x = (dx * rx + dz * rz) / range * R, y = -(dx * fx + dz * fz) / range * R;
    const l = Math.hypot(x, y);
    if (l > R - 4) { x *= (R - 4) / l; y *= (R - 4) / l; }
    g.fillStyle = color; g.fillRect(R + x - size / 2, R + y - size / 2, size, size);
  };
  dot(ally.position, '#60a0ff', 10);
  dot(enemy.position, '#ff4040', 12);
  for (const t of targets) {
    if (t.dead) continue;
    const p = targetPos(t);
    if (t.type === 'drone') dot(p, '#ff8080', 4);
    else if (t.type === 'plasma') dot(p, '#ffe040', 6);
  }
  g.fillStyle = '#fff';
  g.beginPath(); g.moveTo(R, R - 6); g.lineTo(R - 4, R + 4); g.lineTo(R + 4, R + 4); g.fill();
}

// ------------------------------------------------------------ メインループ
const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, clock.getDelta());
  const active = state === 'playing' || state === 'victory' || state === 'over';

  if (state === 'title') {
    // タイトル画面：艦隊を周回するカメラ
    const t = performance.now() * 0.00005;
    camera.position.set(Math.sin(t) * 900 + 200, 150, -900 + Math.cos(t) * 900);
    camera.lookAt(0, 0, -900);
    camera.fov = 60; camera.updateProjectionMatrix();
  }
  if (active) {
    game.t += state === 'playing' ? dt : 0;
    if (state === 'playing') { updatePlayer(dt); updateLock(dt); }
    updateEnemies(dt);
    updateBullets(dt);
    updateMissiles(dt);
    if (state === 'playing') updateHUD(dt);
    if (state === 'victory') {
      // 撃沈演出
      enemy.position.y -= dt * 12;
      enemy.rotation.z += dt * 0.04;
      enemy.rotation.x += dt * 0.02;
      if (Math.random() < 0.3) explosion(enemy.localToWorld(new V3(rand(-50, 50), rand(-10, 20), rand(-200, 200))), rand(2, 4));
    }
    if (state !== 'playing') {
      camera.position.copy(player.pos);
      if (state === 'victory') camera.lookAt(enemy.position);
      game.endT -= dt;
      if (game.endT <= 0) showResult();
    }
    if (boostGain && state !== 'playing') boostGain.gain.value = 0;
  }
  // 旗艦の浮遊感
  ally.children.forEach((c) => (c.position.y = Math.sin(performance.now() * 0.0005) * 0.3));
  for (let i = beams.length - 1; i >= 0; i--) {
    beams[i].life -= dt;
    beams[i].line.material.opacity = beams[i].life / 0.35;
    if (beams[i].life <= 0) { scene.remove(beams[i].line); beams.splice(i, 1); }
  }
  updateEffects(dt);
  renderer.render(scene, camera);
}
loop();
