// 夜ノ街 — エントリポイント。レンダラ・ポストエフェクト・ゲームループ・状態遷移
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { loadAssets } from './assets.js';
import { buildCity, groundY, districtAt, P, N, EXTENT } from './city.js';
import { Traffic, Police, resolveCarCollisions } from './vehicles.js';
import { Peds } from './peds.js';
import { Player } from './player.js';
import { Hud } from './hud.js';
import { Audio } from './audio.js';
import { Input } from './input.js';
import { Wanted } from './wanted.js';
import { Missions } from './missions.js';
import { Particles, Tracers, makeRain, makeSky } from './fx.js';
import { makeGlowSprite } from './textures.js';
import { clamp, damp, rand, yen } from './util.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
let pixelRatio = Math.min(devicePixelRatio, params.get('q') === 'low' ? 0.75 : 1.25);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.info.autoReset = false;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x070812, 0.0095);
scene.background = new THREE.Color(0x05060b);
const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.05, 1200);
camera.layers.enable(1);
scene.add(camera);
scene.add(new THREE.HemisphereLight(0x4a5a9a, 0x1a1016, 1.1));
const moon = new THREE.DirectionalLight(0x8090ff, 0.35);
moon.position.set(-100, 200, 60);
scene.add(moon);
const sky = makeSky();
scene.add(sky);
const rain = makeRain(params.get('q') === 'low' ? 4000 : 9000);
scene.add(rain);

// ---------------------------------------------------------------- ポストエフェクト
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.55, 0.45, 0.92);
composer.addPass(bloom);
const finalPass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uHurt: { value: 0 }, uSpeed: { value: 0 }, uFade: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uHurt, uSpeed, uFade; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uTime) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      float r = length(c);
      // 色収差(ダメージ時・高速時に強く)
      float ca = 0.0015 + uHurt * 0.01 + uSpeed * 0.003;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + c * ca).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - c * ca).b;
      // 周辺減光
      col *= smoothstep(0.95, 0.25, r * (1.0 + uSpeed * 0.3));
      // 夜の色味(シャドウを青緑、ハイライトを暖色へ)
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, col * vec3(0.85, 0.98, 1.15), smoothstep(0.4, 0.0, l) * 0.5);
      col += (hash(vUv * 800.0) - 0.5) * 0.035;
      col = mix(col, vec3(l) * vec3(1.0, 0.4, 0.4), uHurt * 0.4);
      col *= 1.0 - uFade;
      gl_FragColor = vec4(col, 1.0);
    }`,
});
composer.addPass(finalPass);
composer.addPass(new OutputPass());

// ---------------------------------------------------------------- ゲーム
const game = {
  scene, camera, renderer,
  money: 0, goal: 3000000, time: 0,
  startMinutes: 23 * 60, endMinutes: 29 * 60, // 23:00 → 翌5:00
  timeScale: 12,  // 現実1秒 = ゲーム内12秒(約30分で夜明け)
  state: 'loading',
  arrest: 0, hurtFlash: 0, shakeAmt: 0,
  groundY,
  glowTex: makeGlowSprite(),
  audio: new Audio(),
  input: new Input(canvas),
  clockMinutes() { return this.startMinutes + this.time * this.timeScale / 60; },
  areaName() { return districtAt(this.player.pos.x, this.player.pos.z); },
  allCars() { return this.traffic.cars; },
  shake(a) { this.shakeAmt = Math.max(this.shakeAmt, a); },
  addMoney(v, fx = true) {
    this.money = Math.max(0, this.money + v);
    if (fx && v > 0) { this.audio.cash(); this.hud.toast(`+${yen(v)}`, 'money'); this.hud.flashMoney(); }
  },
};

const loadingEl = document.getElementById('loading');
const startBtn = document.getElementById('start');
startBtn.disabled = true;

async function init() {
  // 看板の文字を正しいフォントで描くため、先にフォントを読み込む
  try {
    await Promise.race([
      Promise.all(['900 40px "Zen Kaku Gothic New"', '400 40px "Dela Gothic One"', '400 40px "Yuji Syuku"'].map((f) => document.fonts.load(f, '夜ノ街'))),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch { /* フォントが無くても続行 */ }
  game.assets = await loadAssets('assets/models/', (p) => { loadingEl.textContent = `アセット読み込み中… ${Math.round(p * 100)}%`; });
  loadingEl.textContent = '街を生成中…';
  await new Promise((r) => setTimeout(r, 30));
  game.city = buildCity(scene, game.assets);
  // 路面反射はレイヤー0のみ(人・雨・光のにじみは映さない)
  const g0 = game.city.ground;
  const origGet = g0.getReflectionCamera;
  g0.getReflectionCamera = (cam) => { const rc = origGet.call(g0, cam); rc.layers.set(0); return rc; };

  game.sparks = new Particles(scene, game.glowTex, true, 1200);
  game.smoke = new Particles(scene, game.glowTex, false, 600);
  game.tracers = new Tracers(scene);
  game.hud = new Hud(game);
  const k = game.city.specials;
  game.startPos = { x: 3 * P + 5.6, z: 2 * P + 24 };
  game.player = new Player(game, game.startPos.x, game.startPos.z);
  game.traffic = new Traffic(game, params.get('q') === 'low' ? 16 : 24);
  game.police = new Police(game);
  game.peds = new Peds(game, params.get('q') === 'low' ? 26 : 40);
  game.wanted = new Wanted(game);
  game.missions = new Missions(game);
  // 最初に街を埋める
  for (let i = 0; i < 80; i++) { game.traffic.spawnNpc(game.player.pos.x, game.player.pos.z, 15, 170); game.peds.update(0.016); }
  game.state = 'title';
  loadingEl.textContent = '';
  startBtn.disabled = false;
  if (params.has('autostart')) startGame();
}

// ---------------------------------------------------------------- 射撃判定
game.shoot = (o, d, who) => {
  const maxT = 160;
  let best = { t: maxT, kind: null };
  // 建物
  const hl = Math.hypot(d.x, d.z);
  if (hl > 1e-4) {
    const th = game.city.colliders.raycast(o.x, o.z, d.x / hl, d.z / hl, maxT * hl);
    const t = th / hl;
    if (t < best.t) best = { t, kind: 'wall' };
  }
  if (d.y < -1e-4) { const t = (0 - o.y) / d.y; if (t < best.t) best = { t, kind: 'ground' }; }
  // 歩行者(縦長の円柱として判定)
  for (const p of game.peds.list) {
    if (p.state === 'down') continue;
    const rx = p.pos.x - o.x, rz = p.pos.z - o.z;
    const t = (rx * d.x + rz * d.z) / (hl * hl);
    if (t < 0 || t > best.t) continue;
    const cx = o.x + d.x * t - p.pos.x, cz = o.z + d.z * t - p.pos.z;
    const y = o.y + d.y * t - p.pos.y;
    if (cx * cx + cz * cz < 0.1 && y > 0 && y < p.height) best = { t, kind: 'ped', ped: p, head: y > p.height - 0.3 };
  }
  // 車(向きのある箱)
  for (const c of game.allCars()) {
    const cos = Math.cos(-c.yaw), sin = Math.sin(-c.yaw);
    const lx0 = o.x - c.pos.x, lz0 = o.z - c.pos.z;
    const ox = lx0 * cos + lz0 * sin, oz = -lx0 * sin + lz0 * cos, oy = o.y - c.pos.y - 0.75;
    const dx = d.x * cos + d.z * sin, dz = -d.x * sin + d.z * cos, dy = d.y;
    const hx = c.spec.W / 2, hy = 0.75, hz = c.spec.L / 2;
    let t0 = 0, t1 = best.t;
    for (const [oo, dd, h] of [[ox, dx, hx], [oy, dy, hy], [oz, dz, hz]]) {
      if (Math.abs(dd) < 1e-8) { if (Math.abs(oo) > h) { t0 = 1; t1 = 0; } continue; }
      let a = (-h - oo) / dd, b = (h - oo) / dd;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    }
    if (t0 <= t1 && t0 < best.t && c !== game.player.inCar) best = { t: t0, kind: 'car', car: c };
  }
  const hit = o.clone().addScaledVector(d, best.t);
  const muzzle = game.player.gunHolder.localToWorld(new THREE.Vector3(0, 0.06, -0.22));
  game.tracers.add(muzzle, hit);
  if (best.kind) {
    const n = best.kind === 'ped' ? [0.6, 0.1, 0.1] : [1, 0.75, 0.4];
    for (let i = 0; i < 10; i++) game.sparks.emit({ x: hit.x, y: hit.y, z: hit.z, vx: rand(-3, 3) - d.x * 2, vy: rand(0, 4), vz: rand(-3, 3) - d.z * 2, life: rand(0.15, 0.4), s0: 0.08, s1: 0.02, c: n, grav: 9 });
    game.smoke.emit({ x: hit.x, y: hit.y, z: hit.z, vy: 0.4, life: 0.8, s0: 0.2, s1: 0.9, c: [0.5, 0.5, 0.52], a: 0.35 });
  }
  // 銃声で周囲がパニック
  game.peds.scareAll(o.x, o.z, 45, 1);
  const witnesses = game.peds.list.some((p) => p.state !== 'down' && p.pos.distanceTo(o) < 35) || game.police.nearest < 60;
  if (best.kind === 'ped') {
    const p = best.ped;
    p.hp -= best.head ? 100 : 40;
    game.hud.hitmark(); game.audio.hitMarker();
    if (p.hp <= 0 || best.head) { p.knock(d.x, d.z, 2); game.onPedHit(p, 'gun'); }
    else p.scare(o.x, o.z, 1);
  } else if (best.kind === 'car') {
    const c = best.car;
    c.hp = Math.max(0, c.hp - 8);
    game.hud.hitmark(); game.audio.hitMarker();
    if (c.driver === 'police') game.wanted.crime(3, 'パトカーへの発砲');
    if (c.driver === 'npc' && c.ai) { c.ai.cruise = 16; c.ai.wait = 0; }
  }
  if (witnesses && game.wanted.stars < 1) game.wanted.crime(1, '発砲の通報');
};

game.onPedHit = (p, how) => {
  game.wanted.crime(2, how === 'car' ? 'ひき逃げ' : '通行人への暴行');
  game.peds.scareAll(p.pos.x, p.pos.z, 30, 1);
};
game.onEnterCar = () => {
  const st = game.audio.stations[game.audio.station];
  game.hud.radio(st.style ? st.name : '');
};
game.hurtPlayer = (amt, cause) => {
  if (game.state !== 'play') return;
  const p = game.player;
  if (p.inCar && cause !== 'fire') { p.inCar.hp = Math.max(0, p.inCar.hp - amt * 0.5); amt *= 0.25; }
  p.hp -= amt;
  game.hurtFlash = Math.min(1, game.hurtFlash + amt / 30);
  game.shake(Math.min(0.6, amt / 25));
  if (p.hp <= 0) wasted();
};

function respawn(x, z, label, sub, cls) {
  const p = game.player;
  game.state = 'dead';
  game.hud.big(label, sub, cls, 0);
  document.getElementById('bigtext').classList.remove('hidden');
  game.missions.abort();
  setTimeout(() => {
    if (p.inCar) p.exitCar();
    p.pos.set(x, groundY(x, z), z); p.hp = 100; p.vx = p.vz = 0;
    game.wanted.clear();
    for (const c of game.police.cars) c.remove();
    game.arrest = 0;
    document.getElementById('bigtext').classList.add('hidden');
    game.state = 'play';
  }, 3500);
}
function wasted() {
  const fee = Math.round(game.money * 0.1);
  game.money -= fee;
  game.audio.jingle(false);
  const s = game.city.specials.shrine;
  respawn(s.x, s.z + 6, '病院送り', `治療費 −${yen(fee)}　…神社で目を覚ました`, 'red');
  game.time += 20 * 60 / game.timeScale; // 20分経過
}
function busted() {
  const fee = Math.round(game.money * 0.15);
  game.money -= fee;
  game.player.ammo = 12; game.player.reserve = 24;
  game.audio.jingle(false);
  const k = game.city.specials.koban;
  respawn(k.x, k.z - 2, '逮捕', `罰金 −${yen(fee)}　…交番で説教を食らった`, 'red');
  game.time += 30 * 60 / game.timeScale;
}
game.win = () => {
  game.state = 'end';
  game.addMoney(-game.goal, false);
  game.audio.jingle(true);
  const t = game.clockMinutes();
  const hh = Math.floor(t / 60) % 24, mm = Math.floor(t % 60);
  endScreen('完済', `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}　三百万円を返し切った。手元に ${yen(game.money)}`, 'gold');
  const line = document.createElement('div');
  line.className = 'sub'; line.style.cssText = 'font-family:"Zen Kaku Gothic New";letter-spacing:.1em;margin-top:18px;font-size:17px';
  line.textContent = '金田「…本当に揃えやがった。お前、うちで働かねえか？」';
  document.getElementById('bigtext').insertBefore(line, document.getElementById('bigtext').lastChild);
};
function dawnFail() {
  game.state = 'end';
  game.audio.jingle(false);
  endScreen('夜明け', `返済できず…所持金 ${yen(game.money)} / ${yen(game.goal)}`, 'red');
}
function endScreen(main, sub, cls) {
  game.input.unlock();
  game.input.enabled = false;
  document.getElementById('hud').classList.add('hidden');
  game.hud.big(main, sub, cls, 0);
  const b = document.getElementById('bigtext');
  b.classList.remove('hidden');
  const again = document.createElement('div');
  again.className = 'sub'; again.style.marginTop = '30px'; again.style.fontSize = '14px'; again.style.pointerEvents = 'auto'; again.style.cursor = 'pointer';
  again.textContent = '― クリックでもう一度 ―';
  b.appendChild(again);
  b.style.pointerEvents = 'auto';
  b.onclick = () => location.reload();
}

// ---------------------------------------------------------------- 開始
function startGame() {
  if (game.state !== 'title') return;
  game.audio.start();
  document.getElementById('title').classList.add('fade');
  document.getElementById('hud').classList.remove('hidden');
  game.input.enabled = true;
  game.input.lock();
  game.state = 'play';
  const sp = game.startPos;
  game.player.pos.set(sp.x, groundY(sp.x, sp.z), sp.z);
  game.player.yaw = Math.PI; // 通りの奥(南)を向く
  game.peds.populate(sp.x, sp.z, 90);
  setTimeout(() => game.hud.say('金田', 'おう、俺だ。…三百万、夜明けまでに耳を揃えて持ってこい。', 5), 800);
  setTimeout(() => !game.missions.active && game.hud.say('金田', '仕事なら回してやる。事務所（黄色い印）に来い。車が売りたきゃヤマ自動車（紫）だ。', 6), 6500);
  setTimeout(() => game.hud.toast('F：車に乗る　E：話す/買う　M：地図'), 1500);
}
startBtn.addEventListener('click', startGame);

function togglePause(force) {
  const pause = document.getElementById('pause');
  const on = force ?? game.state === 'play';
  if (on && game.state === 'play') {
    game.state = 'pause'; pause.classList.remove('hidden'); game.hud.drawBigMap(); game.input.unlock();
  } else if (!on && game.state === 'pause') {
    game.state = 'play'; pause.classList.add('hidden'); game.input.lock();
  }
}
document.getElementById('pause').addEventListener('click', () => togglePause(false));
addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' || e.code === 'Escape' || e.code === 'KeyP') {
    if (game.state === 'play' && e.code !== 'Escape') togglePause(true);
    else if (game.state === 'pause') togglePause(false);
  }
});
document.addEventListener('pointerlockchange', () => {
  // Esc でロックが外れたら一時停止
  if (!document.pointerLockElement && game.state === 'play' && game.input.wasLocked) togglePause(true);
  game.input.wasLocked = !!document.pointerLockElement;
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- ループ
const clock = new THREE.Clock();
let fpsAcc = 0, fpsN = 0, titleT = 0;
let simT = 0;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (game.state === 'loading') return;
  simulate(dt);
  renderFrame(dt);
}

function simulate(dt) {
  simT += dt;
  const t = simT;
  const g = game, p = g.player, input = g.input;

  if (g.state === 'play' || g.state === 'dead' || g.state === 'title' || g.state === 'end') {
    if (g.state === 'play') {
      g.time += dt;
      p.update(dt, input);
      if (input.hit('KeyQ') && p.inCar) g.hud.radio(g.audio.nextStation().replace('ラジオ OFF', ''));
      g.wanted.update(dt);
      const pr = g.missions.update(dt, t);
      let prompt = pr;
      if (!prompt && !p.inCar) {
        const nearCar = g.allCars().some((c) => Math.hypot(c.pos.x - p.pos.x, c.pos.z - p.pos.z) < 3.6 + c.spec.L * 0.25 && !(c.driver === 'police' && Math.abs(c.speed) > 2));
        const nearVend = g.city.vendings.some((v) => Math.hypot(v.x - p.pos.x, v.z - p.pos.z) < 2);
        if (nearVend) prompt = '<kbd>E</kbd> 缶コーヒーを買う（¥150）';
        else if (nearCar) prompt = '<kbd>F</kbd> 車に乗る';
      }
      if (!prompt && p.inCar && p.inCar.hp <= 0) prompt = '車が燃えている！ <kbd>F</kbd> で降りろ！';
      g.hud.prompt(prompt);
      updateArrest(dt);
      if (g.clockMinutes() >= g.endMinutes) dawnFail();
    } else if (g.state === 'title') {
      // タイトル: 夜の大通りをゆっくり進むカメラ
      titleT += dt;
      const x = (titleT * 4) % (EXTENT - 40) + 20;
      camera.position.set(x, 3.2, 3 * P - 2.5);
      camera.rotation.set(-0.03, -Math.PI / 2 + 0.25 + Math.sin(titleT * 0.1) * 0.08, 0, 'YXZ');
      p.pos.set(x, 0, 3 * P);
      if (!g.titlePop) { g.titlePop = true; g.peds.populate(x + 40, 3 * P, 90); }
      p.gunHolder.visible = false;
    }
    g.traffic.update(dt);
    resolveCarCollisions(g, dt);
    g.police.update(dt);
    g.peds.update(dt);
    updateCarDamage(dt);
    g.sparks.update(dt); g.smoke.update(dt); g.tracers.update(dt);
    g.hud.update(dt);
    g.audio.update({ pos: p.pos, inCar: !!p.inCar, speed: p.inCar ? p.inCar.speed : 0, throttle: p.throttle ?? 0, policeDist: g.police.nearest ?? 1e9 });
  }
  input.endFrame();
}

function renderFrame(dt) {
  const g = game, p = g.player, t = simT;
  // カメラの揺れ
  g.shakeAmt = damp(g.shakeAmt, 0, 6, dt);
  if (g.shakeAmt > 0.001) {
    camera.position.x += (Math.random() - 0.5) * g.shakeAmt * 0.3;
    camera.position.y += (Math.random() - 0.5) * g.shakeAmt * 0.3;
  }
  g.hurtFlash = damp(g.hurtFlash, 0, 2.5, dt);
  // 夜明けが近づくと空が明るむ
  const dawn = clamp((g.clockMinutes() - (g.endMinutes - 60)) / 60, 0, 1);
  sky.material.uniforms.uDawn.value = dawn;
  sky.material.uniforms.uTime.value = t;
  sky.position.copy(camera.position);
  rain.material.uniforms.uTime.value = t;
  rain.material.uniforms.uCam.value.copy(camera.position);
  g.city.update(t);
  const fovScale = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  g.city.setGlowScale(fovScale);
  g.sparks.mat.uniforms.uScale.value = g.smoke.mat.uniforms.uScale.value = fovScale;
  finalPass.uniforms.uTime.value = t;
  finalPass.uniforms.uHurt.value = g.hurtFlash;
  finalPass.uniforms.uSpeed.value = p.inCar ? Math.min(1, Math.abs(p.inCar.speed) / 40) : 0;
  renderer.info.reset();
  composer.render();
  // 重いときは解像度を自動で下げる
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 2) {
    const fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0;
    if (fps < 38 && pixelRatio > 0.6) { pixelRatio = Math.max(0.6, pixelRatio - 0.15); renderer.setPixelRatio(pixelRatio); composer.setPixelRatio(pixelRatio); }
    else if (fps > 58 && pixelRatio < Math.min(devicePixelRatio, 1.25)) { pixelRatio = Math.min(1.25, pixelRatio + 0.1); renderer.setPixelRatio(pixelRatio); composer.setPixelRatio(pixelRatio); }
    game.fps = fps;
  }
}

// 逮捕: 徒歩で停車中のパトカーのそばにいるとゲージが溜まる。★3以上では撃たれる
function updateArrest(dt) {
  const g = game, p = g.player;
  let near = false;
  for (const c of g.police.cars) {
    if (c.driver !== 'police' || g.wanted.stars === 0) continue;
    const d = Math.hypot(c.pos.x - p.pos.x, c.pos.z - p.pos.z);
    if (!p.inCar && d < 7 && Math.abs(c.speed) < 2.5) near = true;
    if (p.inCar && d < 6 && Math.abs(p.inCar.speed) < 1 && Math.abs(c.speed) < 2) near = true;
    if (g.wanted.stars >= 3 && d < 32) {
      c.fireT = (c.fireT ?? rand(0.5, 1.5)) - dt;
      if (c.fireT <= 0) {
        c.fireT = rand(0.8, 1.6);
        const dx = p.pos.x - c.pos.x, dz = p.pos.z - c.pos.z;
        if (g.city.colliders.raycast(c.pos.x, c.pos.z, dx / d, dz / d, d) >= d - 1) {
          g.audio.gunshot();
          if (Math.random() < 0.55) g.hurtPlayer(rand(5, 10), 'gun');
          g.tracers.add(new THREE.Vector3(c.pos.x, 1.3, c.pos.z), new THREE.Vector3(p.pos.x + rand(-1, 1), 1.4, p.pos.z + rand(-1, 1)));
        }
      }
    }
  }
  g.arrest = near ? Math.min(1, g.arrest + dt / 2.5) : Math.max(0, g.arrest - dt * 0.6);
  if (g.arrest >= 1) busted();
}

// 車の損傷: 煙 → 炎上 → 爆発
function updateCarDamage(dt) {
  const g = game;
  for (const c of g.allCars()) {
    if (c.dead || c.wrecked) continue;
    if (c.hp < 45 && Math.random() < dt * (c.hp < 20 ? 30 : 10)) {
      const f = c.fwd;
      g.smoke.emit({ x: c.pos.x + f.x * c.spec.L * 0.4, y: 1.0, z: c.pos.z + f.z * c.spec.L * 0.4, vx: rand(-0.3, 0.3), vy: rand(1, 2), vz: rand(-0.3, 0.3), life: 2.2, s0: 0.5, s1: 2.6, c: c.hp < 20 ? [0.08, 0.08, 0.08] : [0.45, 0.45, 0.48], a: 0.5 });
    }
    if (c.hp <= 0) {
      c.burn = (c.burn ?? 5) - dt;
      if (Math.random() < dt * 40) g.sparks.emit({ x: c.pos.x + rand(-0.8, 0.8), y: 1 + rand(0, 0.5), z: c.pos.z + rand(-1, 1), vy: rand(1.5, 3), life: rand(0.4, 0.8), s0: 0.9, s1: 0.2, c: [1, 0.45, 0.12] });
      if (c.driver === 'police') { c.driver = null; g.peds.spawnAt(c.pos.x + 2, c.pos.z + 2).scare(c.pos.x, c.pos.z, 1); }
      if (c.driver === 'npc') { c.driver = null; c.ai = null; g.peds.spawnAt(c.pos.x + 2, c.pos.z + 2).scare(c.pos.x, c.pos.z, 1); }
      if (c.burn <= 0) explode(c);
    }
  }
}
function explode(c) {
  const g = game;
  c.wrecked = true;
  c.mat.userData.u.uPaint.value.set(0x0a0a0a);
  c.mat.color.set(0x333333);
  c.beam.visible = false;
  g.audio.crash(1); g.audio.gunshot();
  for (let i = 0; i < 60; i++) g.sparks.emit({ x: c.pos.x, y: 1, z: c.pos.z, vx: rand(-8, 8), vy: rand(2, 10), vz: rand(-8, 8), life: rand(0.4, 1.1), s0: 1.6, s1: 0.2, c: [1, 0.55, 0.2], grav: 6, drag: 1.5 });
  for (let i = 0; i < 20; i++) g.smoke.emit({ x: c.pos.x + rand(-1, 1), y: 1.5, z: c.pos.z + rand(-1, 1), vx: rand(-1, 1), vy: rand(1, 3), vz: rand(-1, 1), life: 4, s0: 1.5, s1: 6, c: [0.06, 0.06, 0.07], a: 0.7 });
  const flash = new THREE.PointLight(0xff8a3a, 400, 40, 1.5);
  flash.position.set(c.pos.x, 2, c.pos.z); g.scene.add(flash);
  let k = 1; const fade = () => { k *= 0.85; flash.intensity = 400 * k; if (k > 0.02) requestAnimationFrame(fade); else g.scene.remove(flash); }; fade();
  const d = Math.hypot(g.player.pos.x - c.pos.x, g.player.pos.z - c.pos.z);
  g.shake(Math.max(0, 1 - d / 40));
  if (g.player.inCar === c) g.hurtPlayer(200, 'fire');
  else if (d < 7) g.hurtPlayer(70 * (1 - d / 7), 'fire');
  g.peds.scareAll(c.pos.x, c.pos.z, 50, 1);
  for (const p of g.peds.list) {
    const pd = Math.hypot(p.pos.x - c.pos.x, p.pos.z - c.pos.z);
    if (pd < 5) p.knock((p.pos.x - c.pos.x) / pd, (p.pos.z - c.pos.z) / pd, 6);
  }
  if (c.driver === 'player' && g.player.inCar === c) { /* hurtPlayer で処理 */ }
  c.driver = null;
}

// デバッグ・自動テスト用
window.__game = game;
// 描画せずにシミュレーションだけ進める(自動テスト用)
window.__step = (dt, n = 1) => { for (let i = 0; i < n; i++) simulate(dt); };
init().catch((e) => { loadingEl.textContent = '読み込みに失敗しました: ' + e.message; console.error(e); });
frame();
