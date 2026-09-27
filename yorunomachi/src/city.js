// 街の生成: 道路網・ビル・看板・街灯・電柱・自販機・地面(反射する濡れた路面)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { rand, randi, pick, clamp } from './util.js';
import * as T from './textures.js';

export const N = 7;            // 内側の街区数(一辺)
export const P = 62;           // 道路中心線の間隔
export const ROAD = 4.5;       // 車道の半幅
export const WALK = 7.5;       // 歩道の外側(=建物の壁)までの距離
export const CURB = 0.15;      // 歩道の高さ
export const EXTENT = N * P;   // 街の端から端

// 特別な街区
const PARK = [3, 3];
const CHOP = [6, 1];
const KOBAN = [1, 5];
const LOT = [2, 1];

const DISTRICTS = [
  { name: '歌舞区 一番街', test: (x, z) => x >= EXTENT / 2 && z < EXTENT / 2 },
  { name: '稲荷町', test: (x, z) => x < EXTENT / 2 && z < EXTENT / 2 },
  { name: '宵ヶ丘', test: (x, z) => x < EXTENT / 2 && z >= EXTENT / 2 },
  { name: '港南 倉庫街', test: () => true },
];
export function districtAt(x, z) {
  return DISTRICTS.find((d) => d.test(x, z)).name;
}

// ---------------------------------------------------------------- 当たり判定(軸平行の箱)
export class Colliders {
  constructor() { this.list = []; this.cell = 16; this.grid = new Map(); }
  add(minX, minZ, maxX, maxZ, tag = 'wall') {
    const c = { minX, minZ, maxX, maxZ, tag };
    this.list.push(c);
    const s = this.cell;
    for (let i = Math.floor(minX / s); i <= Math.floor(maxX / s); i++)
      for (let k = Math.floor(minZ / s); k <= Math.floor(maxZ / s); k++) {
        const key = i * 10007 + k;
        if (!this.grid.has(key)) this.grid.set(key, []);
        this.grid.get(key).push(c);
      }
    return c;
  }
  near(x, z, r) {
    const s = this.cell, out = new Set();
    for (let i = Math.floor((x - r) / s); i <= Math.floor((x + r) / s); i++)
      for (let k = Math.floor((z - r) / s); k <= Math.floor((z + r) / s); k++) {
        const g = this.grid.get(i * 10007 + k);
        if (g) for (const c of g) out.add(c);
      }
    return out;
  }
  // 円(x,z,r)を箱の外へ押し出す。押し出したら法線を返す
  resolve(pos, r) {
    let hit = null;
    for (const c of this.near(pos.x, pos.z, r + 1)) {
      const cx = clamp(pos.x, c.minX, c.maxX), cz = clamp(pos.z, c.minZ, c.maxZ);
      let dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 < 1e-8) { // 中心が箱の中: 一番近い面から出す
        const opts = [[pos.x - c.minX, -1, 0], [c.maxX - pos.x, 1, 0], [pos.z - c.minZ, 0, -1], [c.maxZ - pos.z, 0, 1]];
        opts.sort((a, b) => a[0] - b[0]);
        dx = opts[0][1]; dz = opts[0][2];
        pos.x += dx * (opts[0][0] + r); pos.z += dz * (opts[0][0] + r);
      } else {
        const d = Math.sqrt(d2);
        dx /= d; dz /= d;
        pos.x = cx + dx * r; pos.z = cz + dz * r;
      }
      hit = { nx: dx, nz: dz, c };
    }
    return hit;
  }
  // 線分と箱の交差(射撃・視線用)。最も近い t を返す
  raycast(ox, oz, dx, dz, maxT) {
    let best = maxT;
    const steps = Math.ceil(maxT / 8);
    const seen = new Set();
    for (let s = 0; s <= steps; s++) {
      const t = (s / steps) * maxT;
      for (const c of this.near(ox + dx * t, oz + dz * t, 8)) {
        if (seen.has(c)) continue; seen.add(c);
        let t0 = 0, t1 = best;
        for (const [o, d, mn, mx] of [[ox, dx, c.minX, c.maxX], [oz, dz, c.minZ, c.maxZ]]) {
          if (Math.abs(d) < 1e-9) { if (o < mn || o > mx) { t0 = 1; t1 = 0; } continue; }
          let a = (mn - o) / d, b = (mx - o) / d;
          if (a > b) [a, b] = [b, a];
          t0 = Math.max(t0, a); t1 = Math.min(t1, b);
        }
        if (t0 <= t1 && t0 < best) best = t0;
      }
    }
    return best;
  }
}

// 地面の高さ(歩道は少し高い)
export function groundY(x, z) {
  const qx = Math.abs(((x % P) + P) % P - P / 2); // 街区中心からの距離
  const qz = Math.abs(((z % P) + P) % P - P / 2);
  const toRoadX = P / 2 - qx, toRoadZ = P / 2 - qz;
  if (toRoadX > ROAD && toRoadZ > ROAD && !isOpenLot(x, z)) return CURB;
  return 0;
}
function blockOf(x, z) { return [Math.floor(x / P), Math.floor(z / P)]; }
function isOpenLot(x, z) {
  const [i, k] = blockOf(x, z);
  return (i === CHOP[0] && k === CHOP[1]) || (i === LOT[0] && k === LOT[1]);
}

// ---------------------------------------------------------------- 地面シェーダ(雨に濡れたアスファルト+反射)
const GroundShader = {
  name: 'WetAsphalt',
  uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null },
    uGrain: { value: null }, uLight: { value: null }, uTime: { value: 0 },
    uOrigin: { value: new THREE.Vector2() }, uExtent: { value: 1 }, uP: { value: P }, uRain: { value: 1 },
  }]),
  vertexShader: /* glsl */`
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vWorld;
    #include <common>
    #include <fog_pars_vertex>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      #include <logdepthbuf_vertex>
      #include <fog_vertex>
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse, uGrain, uLight;
    uniform vec2 uOrigin; uniform float uExtent, uP, uTime, uRain;
    varying vec4 vUv; varying vec3 vWorld;
    #include <common>
    #include <fog_pars_fragment>
    #include <logdepthbuf_pars_fragment>

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    // 路面標示(白線・横断歩道・停止線)
    float markings(vec2 p) {
      vec2 q = mod(p + uP * 0.5, uP) - uP * 0.5;   // 最寄りの道路中心線からの距離
      float m = 0.0;
      float inX = step(abs(q.x), 4.5), inZ = step(abs(q.y), 4.5);
      float nearZ = step(abs(q.y), 7.5), nearX = step(abs(q.x), 7.5);
      // 縦方向の道路(x が中心線付近)
      float alongV = inX * (1.0 - nearZ);
      float alongH = inZ * (1.0 - nearX);
      float dashV = step(mod(p.y, 8.0), 4.0), dashH = step(mod(p.x, 8.0), 4.0);
      m += alongV * step(abs(q.x), 0.08) * dashV * step(11.5, abs(q.y));
      m += alongH * step(abs(q.y), 0.08) * dashH * step(11.5, abs(q.x));
      m += alongV * step(abs(abs(q.x) - 4.15), 0.07);
      m += alongH * step(abs(abs(q.y) - 4.15), 0.07);
      // 横断歩道
      float zebraV = inX * step(8.2, abs(q.y)) * step(abs(q.y), 10.8) * step(abs(q.x), 4.0) * step(mod(q.x + 0.25, 1.0), 0.5);
      float zebraH = inZ * step(8.2, abs(q.x)) * step(abs(q.x), 10.8) * step(abs(q.y), 4.0) * step(mod(q.y + 0.25, 1.0), 0.5);
      m += zebraV + zebraH;
      // 停止線(左側通行: 交差点へ向かう車線側)
      m += alongV * step(abs(abs(q.y) - 11.3), 0.18) * step(0.0, -q.x * sign(q.y)) * step(abs(q.x), 4.1);
      m += alongH * step(abs(abs(q.x) - 11.3), 0.18) * step(0.0, q.y * sign(q.x)) * step(abs(q.y), 4.1);
      return clamp(m, 0.0, 1.0);
    }

    // 雨の波紋
    vec2 ripples(vec2 p) {
      vec2 off = vec2(0.0);
      vec2 cell = floor(p * 1.6);
      for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) {
        vec2 c = cell + vec2(float(i), float(j));
        float h = hash(c);
        vec2 center = (c + vec2(hash(c + 3.1), hash(c + 7.7))) / 1.6;
        float t = fract(uTime * 0.9 + h);
        vec2 d = p - center;
        float r = length(d);
        float ring = sin((r - t * 0.55) * 60.0) * smoothstep(0.06, 0.0, abs(r - t * 0.55)) * (1.0 - t);
        off += normalize(d + 1e-4) * ring;
      }
      return off * 0.012 * uRain;
    }

    void main() {
      #include <logdepthbuf_fragment>
      vec2 p = vWorld.xz;
      float grain = texture2D(uGrain, p * 0.35).r;
      float puddle = smoothstep(0.52, 0.38, texture2D(uGrain, p * 0.018 + 0.3).r);
      puddle = max(puddle, smoothstep(0.47, 0.35, texture2D(uGrain, p * 0.05).r) * 0.6);
      vec3 base = vec3(0.075, 0.078, 0.085) * (0.7 + grain * 0.6);
      float mk = markings(p);
      base = mix(base, vec3(0.55, 0.55, 0.52) * (0.8 + grain * 0.3), mk * 0.85);
      // 焼き込みライトマップ(街灯や店先の光)
      vec3 lm = texture2D(uLight, (p - uOrigin) / uExtent).rgb;
      vec3 lit = base * (vec3(0.09, 0.1, 0.16) + lm * 2.2);
      // 反射(水たまりほど強く、細かい凹凸と波紋で歪ませる)
      vec3 toCam = normalize(cameraPosition - vWorld);
      float fres = 0.08 + 0.92 * pow(1.0 - max(toCam.y, 0.0), 4.0);
      vec2 distort = (vec2(grain, texture2D(uGrain, p * 0.35 + 0.5).r) - 0.5) * 0.03 * (1.0 - puddle);
      distort += ripples(p) * puddle;
      vec4 uv = vUv; uv.xy += distort * uv.w;
      vec3 refl = texture2DProj(tDiffuse, uv).rgb;
      float wet = mix(0.35, 1.0, puddle) * (1.0 - mk * 0.5);
      vec3 col = lit + refl * fres * wet * 1.1 + lm * puddle * 0.25;
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }`,
};

// ---------------------------------------------------------------- ジオメトリ補助
function quad(pos, uv, a, b, c, d, u0, v0, u1, v1) {
  // a,b,c,d: 左下,右下,右上,左上
  pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
}
function geo(pos, uv) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

// glb の小物をまとめて InstancedMesh にする(同じ物を大量に置くとき用)
function instanceAsset(src, list) {
  const g = new THREE.Group();
  if (!list.length) return g;
  src.updateMatrixWorld(true);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
  src.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    const im = new THREE.InstancedMesh(geo, mesh.material, list.length);
    list.forEach((t, n) => { M.compose(new THREE.Vector3(t.x, t.y ?? 0, t.z), Q.setFromAxisAngle(Y, t.yaw ?? 0), new THREE.Vector3().setScalar(t.s ?? 1)); im.setMatrixAt(n, M); });
    im.computeBoundingSphere();
    g.add(im);
  });
  return g;
}

// ---------------------------------------------------------------- 街の生成本体
export function buildCity(scene, assets) {
  const group = new THREE.Group();
  scene.add(group);
  const col = new Colliders();
  const glowLights = [];       // ライトマップ用
  const glowSprites = [];      // 光のにじみスプライト
  const lamps = [];            // 街灯位置
  const shopFronts = [];       // 歩行者の目的地にも使う
  const parkedSpots = [];
  const vendings = [];

  const facades = ['concrete', 'tile', 'dark', 'white'].map((s) => ({ s, ...T.makeFacade(s) }));
  const store = T.makeStorefronts();
  const signs = T.makeSignAtlas();
  const bill = T.makeBillboards();

  const wallGeo = facades.map(() => ({ pos: [], uv: [] }));
  const storeGeo = { pos: [], uv: [] };
  const roofGeo = { pos: [], uv: [] };
  const vSignGeo = { pos: [], uv: [] };
  const hSignGeo = { pos: [], uv: [] };
  const billGeo = { pos: [], uv: [] };
  const boxes = []; // 屋上設備など雑多な箱

  // 建物1棟。faces: 道路に面した壁(店舗を付ける)の向き集合 'N','S','E','W'
  function building(x0, z0, x1, z1, h, faces, opts = {}) {
    const fi = opts.facade ?? randi(0, facades.length - 1);
    const W = wallGeo[fi];
    const storeH = faces.size ? 4.5 : 0;
    const walls = [
      // [始点, 終点, 外向き法線の名前]  壁は反時計回り(外から見て左→右)
      { a: [x0, z1], b: [x1, z1], f: 'S' },
      { a: [x1, z1], b: [x1, z0], f: 'E' },
      { a: [x1, z0], b: [x0, z0], f: 'N' },
      { a: [x0, z0], b: [x0, z1], f: 'W' },
    ];
    const floorOff = randi(0, 7) / 8;
    for (const w of walls) {
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      const u0 = randi(0, 7) / 8;
      const hasStore = faces.has(w.f);
      const yb = hasStore ? storeH : 0;
      quad(W.pos, W.uv, [w.a[0], yb, w.a[1]], [w.b[0], yb, w.b[1]], [w.b[0], h, w.b[1]], [w.a[0], h, w.a[1]],
        u0, floorOff + yb / T.FACADE_H, u0 + len / T.FACADE_W, floorOff + h / T.FACADE_H);
      if (hasStore) {
        const su = rand(0, 1);
        quad(storeGeo.pos, storeGeo.uv, [w.a[0], 0, w.a[1]], [w.b[0], 0, w.b[1]], [w.b[0], storeH, w.b[1]], [w.a[0], storeH, w.a[1]],
          su, 0, su + len / 48, 1);
        decorateFacade(w, len, h);
      }
    }
    quad(roofGeo.pos, roofGeo.uv, [x0, h, z1], [x1, h, z1], [x1, h, z0], [x0, h, z0], 0, 0, (x1 - x0) / 4, (z1 - z0) / 4);
    // 屋上: パラペット・給水塔・室外機
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    if (Math.random() < 0.6) boxes.push({ x: cx + rand(-3, 3), y: h + 1.2, z: cz + rand(-3, 3), sx: 2.4, sy: 2.4, sz: 2.4, c: 0x6a6d70 });
    for (let i = 0; i < randi(1, 4); i++) boxes.push({ x: rand(x0 + 2, x1 - 2), y: h + 0.5, z: rand(z0 + 2, z1 - 2), sx: 1.4, sy: 1, sz: 1, c: 0x9a9c98 });
    // 高いビルは屋上広告
    if (h > 34 && Math.random() < 0.55 && faces.size) {
      const w = [...walls].find((q) => faces.has(q.f));
      const dx = w.b[0] - w.a[0], dz = w.b[1] - w.a[1], len = Math.hypot(dx, dz);
      const bw = Math.min(len * 0.8, 16), bh = bw / 2;
      const mx = (w.a[0] + w.b[0]) / 2, mz = (w.a[1] + w.b[1]) / 2;
      const ux = dx / len, uz = dz / len; const nx = -uz, nz = ux;
      const k = randi(0, 3), u0 = (k % 2) * 0.5, v0 = 1 - (Math.floor(k / 2) + 1) * 0.5;
      const ox = mx - nx * 2, oz = mz - nz * 2; // 少し内側
      quad(billGeo.pos, billGeo.uv,
        [ox - ux * bw / 2, h + 1.5, oz - uz * bw / 2], [ox + ux * bw / 2, h + 1.5, oz + uz * bw / 2],
        [ox + ux * bw / 2, h + 1.5 + bh, oz + uz * bw / 2], [ox - ux * bw / 2, h + 1.5 + bh, oz - uz * bw / 2],
        u0, v0, u0 + 0.5, v0 + 0.5);
      glowSprites.push({ x: ox + nx, y: h + 1.5 + bh / 2, z: oz + nz, s: bw * 1.3, c: 0xff4aa0, o: 0.18 });
    }
    col.add(x0, z0, x1, z1, 'building');
  }

  // 店舗の看板・光
  function decorateFacade(w, len, h) {
    const dx = (w.b[0] - w.a[0]) / len, dz = (w.b[1] - w.a[1]) / len;
    const nx = -dz, nz = dx; // 外向き法線
    const shops = Math.max(1, Math.floor(len / 8));
    for (let s = 0; s < shops; s++) {
      const t = (s + 0.5) / shops * len;
      const px = w.a[0] + dx * t, pz = w.a[1] + dz * t;
      shopFronts.push({ x: px + nx * 2.5, z: pz + nz * 2.5 });
      // 横看板
      if (Math.random() < 0.75) {
        const k = randi(0, signs.hCount - 1);
        const u0 = (k % 2) * 0.5, v1 = 1 - Math.floor(k / 2) * 0.125, v0 = v1 - 0.125;
        const hw = Math.min(len / shops * 0.42, 3.2), y0 = 4.65, y1 = y0 + hw * 0.5;
        const ox = px + nx * 0.12, oz = pz + nz * 0.12;
        quad(hSignGeo.pos, hSignGeo.uv, [ox - dx * hw, y0, oz - dz * hw], [ox + dx * hw, y0, oz + dz * hw],
          [ox + dx * hw, y1, oz + dz * hw], [ox - dx * hw, y1, oz - dz * hw], u0, v0, u0 + 0.5, v1);
      }
      // 店先の光(ライトマップ)
      const warm = pick([[255, 220, 170], [230, 245, 255], [255, 200, 220], [255, 235, 190]]);
      glowLights.push({ x: px + nx * 2.2, z: pz + nz * 2.2, r: 5.5, w: 9, rot: Math.atan2(dz, dx), color: warm, i: 0.5 });
    }
    // 縦看板(壁から突き出す)
    const nV = Math.floor(len / 12) + (Math.random() < 0.5 ? 1 : 0);
    for (let s = 0; s < nV; s++) {
      if (h < 10) break;
      const t = rand(2, len - 2);
      const k = randi(0, signs.vCount - 1);
      const u0 = (k % 8) * 0.125, v1 = 1 - Math.floor(k / 8) * 0.5, v0 = v1 - 0.5;
      const sh = Math.min(h - 6.5, rand(4.5, 7)), sw = sh / 4;
      const y0 = 6, y1 = y0 + sh;
      const bx = w.a[0] + dx * t + nx * 0.2, bz = w.a[1] + dz * t + nz * 0.2;
      const fx = bx + nx * sw, fz = bz + nz * sw;
      // 表と裏(文字が鏡写しにならないよう2枚)
      quad(vSignGeo.pos, vSignGeo.uv, [bx, y0, bz], [fx, y0, fz], [fx, y1, fz], [bx, y1, bz], u0, v0, u0 + 0.125, v1);
      quad(vSignGeo.pos, vSignGeo.uv, [fx, y0, fz], [bx, y0, bz], [bx, y1, bz], [fx, y1, fz], u0, v0, u0 + 0.125, v1);
      const cHex = [0xff2e88, 0x35e8ff, 0xffb62e, 0x8cff5a, 0xff4b3a, 0xc070ff, 0xffffff, 0xffe23a][k % 8];
      glowSprites.push({ x: (bx + fx) / 2 + nx * 0.3, y: (y0 + y1) / 2, z: (bz + fz) / 2 + nz * 0.3, s: sh * 1.3, c: cHex, o: 0.22 });
      const c = new THREE.Color(cHex);
      glowLights.push({ x: bx + nx * 3, z: bz + nz * 3, r: 7, color: [c.r * 255, c.g * 255, c.b * 255], i: 0.35 });
    }
  }

  // ---------- 街区ごとに建物を配置
  const lo = -1, hi = N;
  for (let i = lo; i <= hi; i++) {
    for (let k = lo; k <= hi; k++) {
      const outer = i < 0 || k < 0 || i >= N || k >= N;
      const bx0 = i * P + WALK, bz0 = k * P + WALK, bx1 = (i + 1) * P - WALK, bz1 = (k + 1) * P - WALK;
      if (outer) {
        // 外周は街の内側を向いた壁のようなビル群(ワールドの端)
        if ((i < 0 || i >= N) && (k < 0 || k >= N)) { col.add(bx0, bz0, bx1, bz1); continue; }
        const lots = 3;
        for (let s = 0; s < lots; s++) {
          const faces = new Set();
          let x0, z0, x1, z1;
          if (i < 0) { faces.add('E'); x0 = bx1 - 16; x1 = bx1; z0 = bz0 + (s * (bz1 - bz0)) / lots; z1 = bz0 + ((s + 1) * (bz1 - bz0)) / lots; }
          else if (i >= N) { faces.add('W'); x0 = bx0; x1 = bx0 + 16; z0 = bz0 + (s * (bz1 - bz0)) / lots; z1 = bz0 + ((s + 1) * (bz1 - bz0)) / lots; }
          else if (k < 0) { faces.add('S'); z0 = bz1 - 16; z1 = bz1; x0 = bx0 + (s * (bx1 - bx0)) / lots; x1 = bx0 + ((s + 1) * (bx1 - bx0)) / lots; }
          else { faces.add('N'); z0 = bz0; z1 = bz0 + 16; x0 = bx0 + (s * (bx1 - bx0)) / lots; x1 = bx0 + ((s + 1) * (bx1 - bx0)) / lots; }
          building(x0 + 0.3, z0 + 0.3, x1 - 0.3, z1 - 0.3, rand(18, 50), faces);
        }
        col.add(bx0, bz0, bx1, bz1);
        continue;
      }
      if (i === PARK[0] && k === PARK[1]) continue;
      if (i === CHOP[0] && k === CHOP[1]) continue;
      if (i === LOT[0] && k === LOT[1]) continue;
      // 街の中心ほど高層
      const cdist = Math.hypot(i - N / 2 + 0.5, k - N / 2 + 0.5) / (N / 2);
      const hBase = 14 + (1 - cdist) * 45;
      const nx = randi(2, 3), nz = randi(2, 3);
      const sx = (bx1 - bx0) / nx, sz = (bz1 - bz0) / nz;
      for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) {
        if (i === KOBAN[0] && k === KOBAN[1] && a === 0 && b === 0) continue; // 交番の場所
        const faces = new Set();
        if (a === 0) faces.add('W');
        if (a === nx - 1) faces.add('E');
        if (b === 0) faces.add('N');
        if (b === nz - 1) faces.add('S');
        const gap = 0.25;
        const h = Math.max(9, hBase * rand(0.45, 1.35) + (Math.random() < 0.1 ? 30 : 0));
        building(bx0 + a * sx + gap, bz0 + b * sz + gap, bx0 + (a + 1) * sx - gap, bz0 + (b + 1) * sz - gap,
          Math.round(h / 3.5) * 3.5, faces);
      }
    }
  }

  // 道路の突き当たり(街の外周)をビルでふさぐ
  for (let l = 0; l <= N; l++) {
    const c = l * P, h = () => rand(20, 45);
    building(-P + WALK, c - WALK, -WALK - 6, c + WALK, h(), new Set(['E']));
    building(EXTENT + WALK + 6, c - WALK, EXTENT + P - WALK, c + WALK, h(), new Set(['W']));
    building(c - WALK, -P + WALK, c + WALK, -WALK - 6, h(), new Set(['S']));
    building(c - WALK, EXTENT + WALK + 6, c + WALK, EXTENT + P - WALK, h(), new Set(['N']));
  }

  // ---------- 建物メッシュを組み立て
  facades.forEach((f, idx) => {
    const g = wallGeo[idx];
    if (!g.pos.length) return;
    const m = new THREE.MeshStandardMaterial({ map: f.map, emissiveMap: f.emissive, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.85 });
    group.add(new THREE.Mesh(geo(g.pos, g.uv), m));
  });
  group.add(new THREE.Mesh(geo(storeGeo.pos, storeGeo.uv),
    new THREE.MeshStandardMaterial({ map: store.map, emissiveMap: store.emissive, emissive: 0xffffff, emissiveIntensity: 0.75, roughness: 0.5 })));
  const roofTex = T.makeGrain();
  group.add(new THREE.Mesh(geo(roofGeo.pos, roofGeo.uv), new THREE.MeshStandardMaterial({ color: 0x2c2d31, map: roofTex, roughness: 1 })));
  group.add(new THREE.Mesh(geo(vSignGeo.pos, vSignGeo.uv),
    new THREE.MeshBasicMaterial({ map: signs.v, color: new THREE.Color(1.8, 1.8, 1.8) })));
  group.add(new THREE.Mesh(geo(hSignGeo.pos, hSignGeo.uv),
    new THREE.MeshBasicMaterial({ map: signs.h, color: new THREE.Color(1.3, 1.3, 1.3) })));
  if (billGeo.pos.length) {
    const bm = new THREE.MeshBasicMaterial({ map: bill, color: new THREE.Color(1.7, 1.7, 1.7), side: THREE.DoubleSide });
    group.add(new THREE.Mesh(geo(billGeo.pos, billGeo.uv), bm));
  }
  {
    const g = new THREE.BoxGeometry(1, 1, 1);
    const m = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ roughness: 0.8 }), boxes.length);
    const M = new THREE.Matrix4(), c = new THREE.Color();
    boxes.forEach((b, i) => {
      M.makeScale(b.sx, b.sy, b.sz).setPosition(b.x, b.y, b.z);
      m.setMatrixAt(i, M); m.setColorAt(i, c.set(b.c));
    });
    group.add(m);
  }

  // ---------- 歩道(街区ごとの一段高い床)と縁石
  {
    const parts = [];
    for (let i = -1; i <= N; i++) for (let k = -1; k <= N; k++) {
      if ((i === CHOP[0] && k === CHOP[1]) || (i === LOT[0] && k === LOT[1])) continue;
      const x0 = i * P + ROAD, z0 = k * P + ROAD, w = P - ROAD * 2;
      const g = new THREE.BoxGeometry(w, CURB, w);
      g.translate(x0 + w / 2, CURB / 2, z0 + w / 2);
      // 上面のUVをワールド座標基準に
      const uv = g.attributes.uv, pos = g.attributes.position;
      for (let v = 0; v < uv.count; v++) uv.setXY(v, pos.getX(v) / 3, pos.getZ(v) / 3);
      parts.push(g);
    }
    const walk = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ map: T.makeSidewalk(), roughness: 0.55, metalness: 0.1 }));
    walk.name = 'sidewalk';
    group.add(walk);
  }

  // ---------- 特別な場所
  const specials = {};
  // 神社のある公園
  {
    const cx = PARK[0] * P + P / 2, cz = PARK[1] * P + P / 2;
    const torii = assets.clone('torii');
    torii.position.set(cx, CURB, cz + 16); // 正面は南(+Z)向き
    group.add(torii);
    // 参道の石畳と本殿
    const stone = new THREE.Mesh(new THREE.BoxGeometry(4, 0.05, 30), new THREE.MeshStandardMaterial({ color: 0x77736a, roughness: 0.9 }));
    stone.position.set(cx, CURB + 0.03, cz + 4);
    group.add(stone);
    const hall = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3322, roughness: 0.8 });
    const roofM = new THREE.MeshStandardMaterial({ color: 0x2a3a34, roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(9, 4, 7), wood); body.position.y = 2.6; hall.add(body);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(8.2, 3.5, 4), roofM); roof.rotation.y = Math.PI / 4; roof.scale.set(1.15, 1, 0.9); roof.position.y = 6.3; hall.add(roof);
    const base = new THREE.Mesh(new THREE.BoxGeometry(10, 0.6, 8), new THREE.MeshStandardMaterial({ color: 0x6b675f })); base.position.y = 0.3; hall.add(base);
    hall.position.set(cx, CURB, cz - 12);
    group.add(hall);
    col.add(cx - 5, cz - 16, cx + 5, cz - 8);
    // 木々
    const trunkG = new THREE.CylinderGeometry(0.18, 0.28, 3, 6); trunkG.translate(0, 1.5, 0);
    const leafG = new THREE.IcosahedronGeometry(2.4, 1); leafG.translate(0, 4.4, 0);
    const trees = [];
    for (let t = 0; t < 26; t++) {
      const a = rand(0, Math.PI * 2), r = rand(12, 21);
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (Math.abs(x - cx) < 4 && z > cz) continue; // 参道は空ける
      trees.push([x, z, rand(0.8, 1.4)]);
      col.add(x - 0.4, z - 0.4, x + 0.4, z + 0.4, 'tree');
    }
    const trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({ color: 0x3b2b20 }), trees.length);
    const leaves = new THREE.InstancedMesh(leafG, new THREE.MeshStandardMaterial({ color: 0x1f3a26, roughness: 0.9, flatShading: true }), trees.length);
    const M = new THREE.Matrix4();
    trees.forEach(([x, z, s], n) => { M.makeScale(s, s, s).setPosition(x, CURB, z); trunks.setMatrixAt(n, M); leaves.setMatrixAt(n, M); });
    group.add(trunks, leaves);
    // 提灯の列
    const lan = [];
    for (let z = cz - 6; z < cz + 14; z += 4) for (const sx of [-2.6, 2.6]) {
      lan.push({ x: cx + sx, y: 2.4, z, s: 0.8 });
      glowLights.push({ x: cx + sx, z, r: 4, color: [255, 90, 40], i: 0.6 });
      glowSprites.push({ x: cx + sx, y: 2.4, z, s: 1.6, c: 0xff5020, o: 0.5 });
    }
    group.add(instanceAsset(assets.get('lantern'), lan));
    specials.shrine = { x: cx, z: cz + 10 };
  }
  // 解体屋(車を売る場所)
  {
    const x0 = CHOP[0] * P + ROAD, z0 = CHOP[1] * P + ROAD, w = P - ROAD * 2;
    const fenceM = new THREE.MeshStandardMaterial({ color: 0x4a5058, metalness: 0.6, roughness: 0.5 });
    const shed = new THREE.Mesh(new THREE.BoxGeometry(18, 7, 12), new THREE.MeshStandardMaterial({ color: 0x3d4b5a, roughness: 0.7 }));
    shed.position.set(x0 + w - 12, 3.5, z0 + 10); group.add(shed);
    col.add(x0 + w - 21, z0 + 4, x0 + w - 3, z0 + 16);
    for (const [ax, az, bx, bz] of [[x0 + 3, z0 + 3, x0 + w - 3, z0 + 3.4], [x0 + w - 3.4, z0 + 3, x0 + w - 3, z0 + w - 3], [x0 + 3, z0 + 3, x0 + 3.4, z0 + w - 16]]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(bx - ax, 2.4, bz - az), fenceM);
      f.position.set((ax + bx) / 2, 1.2, (az + bz) / 2); group.add(f); col.add(ax, az, bx, bz);
    }
    // 廃車の山
    const junk = new THREE.MeshStandardMaterial({ color: 0x5b3d2b, roughness: 0.9, metalness: 0.3 });
    for (let n = 0; n < 7; n++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(4, 1.3, 1.8), junk);
      b.position.set(x0 + 8 + (n % 3) * 1.2, 0.65 + Math.floor(n / 3) * 1.3, z0 + 9 + (n % 2) * 2);
      b.rotation.y = rand(-0.4, 0.4); group.add(b);
    }
    col.add(x0 + 5, z0 + 6, x0 + 13, z0 + 14);
    const sign = makeTextSign('解体・買取 ヤマ自動車', 0xffb62e);
    sign.position.set(x0 + w - 12, 8.2, z0 + 16.1); group.add(sign);
    specials.chop = { x: x0 + w / 2 - 4, z: z0 + w / 2 + 6 };
    glowLights.push({ x: specials.chop.x, z: specials.chop.z, r: 14, color: [255, 180, 80], i: 0.55 });
  }
  // 交番
  {
    const x0 = KOBAN[0] * P + WALK + 1, z0 = KOBAN[1] * P + WALK + 1;
    const k = new THREE.Group();
    const wallM = new THREE.MeshStandardMaterial({ color: 0xcfc9bb, roughness: 0.8 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(8, 4.5, 7), wallM); body.position.set(4, 2.25, 3.5); k.add(body);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(9, 0.5, 8), new THREE.MeshStandardMaterial({ color: 0x333333 })); roof.position.set(4, 4.7, 3.5); k.add(roof);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.2, 0.15) }));
    lamp.position.set(4, 4.3, -0.2); k.add(lamp);
    const sign = makeTextSign('交 番', 0xffffff, '#1d3f8f'); sign.scale.setScalar(0.6); sign.position.set(4, 3.6, -0.02); k.add(sign);
    k.position.set(x0, CURB, z0); group.add(k);
    col.add(x0, z0, x0 + 8, z0 + 7);
    glowLights.push({ x: x0 + 4, z: z0 - 2, r: 6, color: [255, 60, 50], i: 0.5 });
    specials.koban = { x: x0 + 4, z: z0 - 3.2 };
  }
  // 駐車場
  {
    const x0 = LOT[0] * P + ROAD, z0 = LOT[1] * P + ROAD, w = P - ROAD * 2;
    const lineM = new THREE.MeshBasicMaterial({ color: 0x9a9a92 });
    for (let r = 0; r < 2; r++) for (let s = 0; s < 9; s++) {
      const x = x0 + 8 + s * 4.6, z = z0 + 14 + r * 22;
      const l = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 5.5), lineM); l.rotation.x = -Math.PI / 2; l.position.set(x - 2.3, 0.02, z); group.add(l);
      if (Math.random() < 0.6) parkedSpots.push({ x, z, yaw: r ? 0 : Math.PI });
    }
    const sign = makeTextSign('P 24時間 ¥300/60分', 0x35e8ff); sign.scale.setScalar(0.7);
    sign.position.set(x0 + 4, 4, z0 + 2); group.add(sign);
    glowLights.push({ x: x0 + w / 2, z: z0 + w / 2, r: 26, color: [200, 230, 255], i: 0.35 });
  }

  // ---------- 街灯・電柱・自販機を歩道に沿って配置
  const poleSpots = [];
  const lampPole = [], lampHead = [];
  const vendingSpots = [];
  for (let line = 0; line <= N; line++) {
    for (let seg = 0; seg < N; seg++) {
      for (const dir of ['x', 'z']) {
        // dir='x': x方向に走る道路(z = line*P)、segの区間
        for (const side of [-1, 1]) {
          const a = seg * P + 12, b = (seg + 1) * P - 12;
          for (let t = a; t <= b; t += 25) {
            const off = side * (ROAD + 0.6);
            const px = dir === 'x' ? t : line * P + off;
            const pz = dir === 'x' ? line * P + off : t;
            const yaw = dir === 'x' ? (side > 0 ? 0 : Math.PI) : (side > 0 ? Math.PI / 2 : -Math.PI / 2);
            if ((side > 0) === ((seg + line) % 2 === 0)) {
              lampPole.push({ x: px, z: pz, yaw });
              const hx = px - (dir === 'z' ? side * 1.6 : 0), hz = pz - (dir === 'x' ? side * 1.6 : 0);
              lampHead.push({ x: hx, z: hz, yaw });
              lamps.push({ x: hx, z: hz });
              glowLights.push({ x: hx, z: hz, r: 11, color: [255, 214, 160], i: 0.75 });
              glowSprites.push({ x: hx, y: 7.3, z: hz, s: 3.2, c: 0xffd9a0, o: 0.55 });
            } else {
              poleSpots.push({ x: px, z: pz, yaw, dir, line, seg, side });
            }
            col.add(px - 0.2, pz - 0.2, px + 0.2, pz + 0.2, 'pole');
          }
          // 自販機(建物の壁際)
          if (Math.random() < 0.55) {
            const t = rand(a + 4, b - 4);
            const off = side * (WALK - 0.45);
            const px = dir === 'x' ? t : line * P + off, pz = dir === 'x' ? line * P + off : t;
            if (!isOpenLot(px, pz) && line > 0 && line < N) {
              const yaw = dir === 'x' ? (side > 0 ? 0 : Math.PI) : (side > 0 ? Math.PI / 2 : -Math.PI / 2);
              vendingSpots.push({ x: px, z: pz, yaw });
            }
          }
        }
      }
    }
  }
  // 街灯(インスタンス)
  {
    const poleG = new THREE.CylinderGeometry(0.09, 0.12, 7.5, 8); poleG.translate(0, 3.75, 0);
    const armG = new THREE.BoxGeometry(0.1, 0.1, 1.8); armG.translate(0, 7.45, -0.85);
    const pg = mergeGeometries([poleG, armG]);
    const headG = new THREE.BoxGeometry(0.35, 0.12, 0.7); headG.translate(0, 7.35, 0);
    const pm = new THREE.InstancedMesh(pg, new THREE.MeshStandardMaterial({ color: 0x8a8d90, metalness: 0.6, roughness: 0.4 }), lampPole.length);
    const hm = new THREE.InstancedMesh(headG, new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 4.2, 3.2) }), lampHead.length);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(1, 1, 1), Y = new THREE.Vector3(0, 1, 0);
    lampPole.forEach((p, n) => { M.compose(new THREE.Vector3(p.x, CURB, p.z), Q.setFromAxisAngle(Y, p.yaw), S); pm.setMatrixAt(n, M); });
    lampHead.forEach((p, n) => { M.compose(new THREE.Vector3(p.x, CURB, p.z), Q.setFromAxisAngle(Y, p.yaw), S); hm.setMatrixAt(n, M); });
    group.add(pm, hm);
  }
  // 電柱と電線
  {
    const src = assets.get('pole');
    const meshes = [];
    src.traverse((o) => { if (o.isMesh) meshes.push(o); });
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(1, 1, 1), Y = new THREE.Vector3(0, 1, 0);
    for (const mesh of meshes) {
      mesh.updateWorldMatrix(true, false);
      const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      const im = new THREE.InstancedMesh(g, mesh.material, poleSpots.length);
      poleSpots.forEach((p, n) => { M.compose(new THREE.Vector3(p.x, CURB, p.z), Q.setFromAxisAngle(Y, p.yaw + Math.PI / 2), S); im.setMatrixAt(n, M); });
      group.add(im);
    }
    // 同じ道路・同じ側の電柱どうしを電線でつなぐ(たるみ付き)
    const wire = [];
    const byKey = new Map();
    for (const p of poleSpots) {
      const key = `${p.dir}${p.line}${p.side}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(p);
    }
    for (const list of byKey.values()) {
      list.sort((a, b) => (a.dir === 'x' ? a.x - b.x : a.z - b.z));
      for (let n = 0; n + 1 < list.length; n++) {
        const A = list[n], B = list[n + 1];
        if (Math.hypot(A.x - B.x, A.z - B.z) > P + 10) continue;
        for (const [yy, lat] of [[9.4, -0.67], [9.4, 0], [9.4, 0.67], [8.5, -0.5], [8.5, 0.5]]) {
          const ox = A.dir === 'x' ? 0 : lat, oz = A.dir === 'x' ? lat : 0;
          const steps = 10;
          for (let s = 0; s < steps; s++) {
            const t0 = s / steps, t1 = (s + 1) / steps;
            const sag = (t) => 0.9 * 4 * t * (1 - t);
            wire.push(A.x + (B.x - A.x) * t0 + ox, CURB + yy - sag(t0), A.z + (B.z - A.z) * t0 + oz);
            wire.push(A.x + (B.x - A.x) * t1 + ox, CURB + yy - sag(t1), A.z + (B.z - A.z) * t1 + oz);
          }
        }
      }
    }
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
    group.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x07080a })));
  }
  // 自販機
  group.add(instanceAsset(assets.get('vending'), vendingSpots.map((v) => ({ ...v, y: CURB }))));
  for (const v of vendingSpots) {
    vendings.push(v);
    const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw); // 正面方向
    col.add(v.x - 0.55, v.z - 0.55, v.x + 0.55, v.z + 0.55, 'vending');
    glowLights.push({ x: v.x + fx * 1.2, z: v.z + fz * 1.2, r: 3.5, color: [220, 235, 255], i: 0.8 });
  }
  // 路上のカラーコーン(工事中)
  const cones = [];
  for (let n = 0; n < 14; n++) {
    const line = randi(1, N - 1), t = rand(10, EXTENT - 10);
    if (Math.abs(((t % P) + P) % P - P / 2) > P / 2 - 12) continue;
    const vert = Math.random() < 0.5;
    for (let c = 0; c < 4; c++) {
      const lane = rand(-3.5, 3.5);
      cones.push({ x: vert ? line * P + lane : t + c * 1.6, z: vert ? t + c * 1.6 : line * P + lane, yaw: rand(0, 6) });
    }
  }
  group.add(instanceAsset(assets.get('cone'), cones));

  // ---------- 光のにじみ(加算スプライト)
  {
    const gs = glowSprites;
    const posA = new Float32Array(gs.length * 3), colA = new Float32Array(gs.length * 3), sizeA = new Float32Array(gs.length);
    const c = new THREE.Color();
    gs.forEach((g, n) => {
      posA.set([g.x, g.y, g.z], n * 3); c.set(g.c).multiplyScalar(g.o); colA.set([c.r, c.g, c.b], n * 3); sizeA[n] = g.s;
    });
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(posA, 3));
    bg.setAttribute('color', new THREE.BufferAttribute(colA, 3));
    bg.setAttribute('size', new THREE.BufferAttribute(sizeA, 1));
    const sprite = T.makeGlowSprite();
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: sprite }, uScale: { value: 600 } },
      vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC; uniform float uScale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vC; void main(){ gl_FragColor = vec4(vC * texture2D(map, gl_PointCoord).a, 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(bg, mat);
    pts.frustumCulled = false;
    pts.layers.set(1); // 反射には映さない
    group.add(pts);
    group.userData.glowMat = mat;
  }

  // ---------- 地面(反射する路面)
  const margin = P;
  const size = EXTENT + margin * 2;
  const lightmap = T.makeGroundLightmap(2048, size, glowLights.map((l) => ({ ...l, x: l.x + margin, z: l.z + margin })));
  const ground = new Reflector(new THREE.PlaneGeometry(size, size), {
    textureWidth: Math.floor(window.innerWidth * 0.5), textureHeight: Math.floor(window.innerHeight * 0.5),
    shader: GroundShader, multisample: 0, clipBias: 0.003,
  });
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(EXTENT / 2, 0, EXTENT / 2);
  ground.material.fog = true;
  const gu = ground.material.uniforms;
  gu.uGrain.value = roofTex;
  gu.uLight.value = lightmap;
  gu.uOrigin.value.set(-margin, -margin);
  gu.uExtent.value = size;
  group.add(ground);

  // 歩道にも同じライトマップを当てる(emissive として足す)
  const walk = group.getObjectByName('sidewalk');
  walk.material.onBeforeCompile = (sh) => {
    sh.uniforms.uLight = { value: lightmap };
    sh.uniforms.uOrigin = { value: new THREE.Vector2(-margin, -margin) };
    sh.uniforms.uExtent = { value: size };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vW; uniform sampler2D uLight; uniform vec2 uOrigin; uniform float uExtent;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * texture2D(uLight, (vW.xz - uOrigin) / uExtent).rgb * 2.4;');
  };

  // 駐車スポット: 道路の左端(路肩)にも
  for (let n = 0; n < 26; n++) {
    const line = randi(1, N - 1), seg = randi(0, N - 1), t = rand(seg * P + 14, (seg + 1) * P - 14);
    const vert = Math.random() < 0.5, side = Math.random() < 0.5 ? -1 : 1;
    const off = side * (ROAD - 1.1);
    // 左側通行: 左側の路肩に停めると進行方向は side によって決まる
    if (vert) parkedSpots.push({ x: line * P + off, z: t, yaw: side > 0 ? Math.PI : 0 });
    else parkedSpots.push({ x: t, z: line * P + off, yaw: side > 0 ? Math.PI / 2 : -Math.PI / 2 });
  }

  return {
    group, colliders: col, lamps, shopFronts, parkedSpots, specials, vendings,
    update(t) { gu.uTime.value = t; },
    setGlowScale(s) { group.userData.glowMat.uniforms.uScale.value = s; },
    ground,
  };
}

// テキスト入り看板(1枚板)
function makeTextSign(text, color, bg = '#111') {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 1024, 160);
  const hex = '#' + new THREE.Color(color).getHexString();
  g.strokeStyle = hex; g.lineWidth = 8; g.strokeRect(8, 8, 1008, 144);
  g.fillStyle = hex; g.shadowColor = hex; g.shadowBlur = 16;
  g.font = '900 92px "Zen Kaku Gothic New", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 512, 84);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.56), new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(2, 2, 2) }));
  return m;
}

// 道路グラフ(交差点ノード)
export function roadNodes() {
  const nodes = [];
  for (let i = 0; i <= N; i++) for (let k = 0; k <= N; k++) nodes.push({ i, k, x: i * P, z: k * P });
  return nodes;
}
export function nodeAt(i, k) { return i >= 0 && k >= 0 && i <= N && k <= N ? { i, k, x: i * P, z: k * P } : null; }
export function nearestNode(x, z) {
  return nodeAt(clamp(Math.round(x / P), 0, N), clamp(Math.round(z / P), 0, N));
}
