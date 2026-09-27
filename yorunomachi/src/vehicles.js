// 車両: 物理(アーケード寄り)、一般車の交通AI、パトカーの追跡AI
import * as THREE from 'three';
import { P, N, ROAD, groundY, nodeAt, nearestNode } from './city.js';
import { rand, randi, pick, clamp, wrapAngle, damp } from './util.js';
import { makeGlowSprite } from './textures.js';
import { carTemplate, carMaterial } from './carmodel.js';

export const SPECS = {
  kei:    { model: 'car_kei',    L: 3.4, W: 1.48, maxSpeed: 31, acc: 11, price: 45000,  eye: [0.34, 1.3, 0.2],  name: '軽自動車' },
  sedan:  { model: 'car_taxi',   L: 4.7, W: 1.72, maxSpeed: 40, acc: 14, price: 90000,  eye: [0.38, 1.18, 0.45], name: 'セダン' },
  taxi:   { model: 'car_taxi',   L: 4.7, W: 1.72, maxSpeed: 38, acc: 13, price: 70000,  eye: [0.38, 1.18, 0.45], name: 'タクシー' },
  police: { model: 'car_police', L: 4.7, W: 1.72, maxSpeed: 46, acc: 17, price: 260000, eye: [0.38, 1.18, 0.45], name: 'パトカー' },
};
const KEI_COLORS = [0xf2f2ee, 0xb9bcc0, 0x16171a, 0x9fd9c8, 0xf0b7c4, 0xe8d36a, 0x7aa0d8, 0xc4402f];
const SEDAN_COLORS = [0x1a1b20, 0xe9e9e6, 0x8d9096, 0x2a3550, 0x5a1b1e];
const TAXI_COLORS = [0xf2c230, 0x1d2b4a, 0x2e6b3a];

let headTex = null;
function headlightTexture() {
  if (headTex) return headTex;
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 128, 0, 32, 128, 128);
  grd.addColorStop(0, 'rgba(255,240,210,0.9)'); grd.addColorStop(0.5, 'rgba(255,230,200,0.25)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 128);
  headTex = new THREE.CanvasTexture(c); headTex.colorSpace = THREE.SRGBColorSpace;
  return headTex;
}

const _v = new THREE.Vector3();

export class Car {
  constructor(game, kind, x, z, yaw, color) {
    this.game = game;
    this.kind = kind;
    this.spec = SPECS[kind];
    const src = game.assets.get(this.spec.model);
    const tpl = carTemplate(src, { andon: kind === 'taxi' });
    const paint = color ?? (kind === 'police' ? 0x0d0d0f : kind === 'taxi' ? pick(TAXI_COLORS) : kind === 'kei' ? pick(KEI_COLORS) : pick(SEDAN_COLORS));
    this.mat = carMaterial(paint);
    this.obj = new THREE.Group();
    this.bodyMesh = new THREE.Mesh(tpl.body, this.mat);
    this.obj.add(this.bodyMesh);
    // タイヤ(回転・操舵するので別メッシュ。路面反射には映さない)
    const order = ['FL', 'FR', 'RL', 'RR'];
    this.wheels = order.map((t) => {
      const w = tpl.wheels.find((q) => q.tag === t);
      const m = new THREE.Mesh(w.geo, this.mat);
      m.position.copy(w.pos); m.rotation.order = 'YXZ'; m.layers.set(1);
      this.obj.add(m);
      return m;
    });
    // 地面を照らすヘッドライトの光だまり
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 11),
      new THREE.MeshBasicMaterial({ map: headlightTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 }));
    beam.rotation.x = -Math.PI / 2;
    beam.position.set(0, 0.04, -this.spec.L / 2 - 5.2);
    beam.layers.set(1);
    this.obj.add(beam);
    this.beam = beam;
    game.scene.add(this.obj);

    this.pos = new THREE.Vector3(x, 0, z);
    this.yaw = yaw;
    this.vel = new THREE.Vector2();
    this.speed = 0;          // 前後方向の速度(m/s)
    this.steer = 0;
    this.hp = 100;
    this.driver = null;      // 'npc' | 'player' | 'police' | null
    this.ai = null;
    this.wheelSpin = 0;
    this.braking = false;
    this.dead = false;
    this.smoke = 0;
    this.siren = kind === 'police';
    this.sync();
  }

  get fwd() { return _v.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  circles() {
    const f = this.spec.L / 2 - this.spec.W / 2;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    return [{ x: this.pos.x + fx * f, z: this.pos.z + fz * f }, { x: this.pos.x - fx * f, z: this.pos.z - fz * f }];
  }
  get radius() { return this.spec.W / 2 + 0.1; }

  // 入力: throttle(-1..1), steer(-1..1), handbrake(bool)
  drive(dt, throttle, steerIn, handbrake) {
    const s = this.spec;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let vF = this.vel.x * fx + this.vel.y * fz;
    let vR = this.vel.x * rx + this.vel.y * rz;
    const broken = this.hp <= 0;
    if (broken) throttle = Math.min(throttle, 0) * 0.2;
    this.braking = false;
    if (throttle > 0) {
      if (vF < -0.5) { vF += 22 * dt * throttle; this.braking = true; }
      else vF += s.acc * throttle * dt * (1 - Math.pow(Math.max(vF, 0) / s.maxSpeed, 2));
    } else if (throttle < 0) {
      if (vF > 0.5) { vF += 24 * dt * throttle; this.braking = true; }
      else vF = Math.max(vF + 8 * throttle * dt, -9);
    } else {
      vF -= Math.sign(vF) * Math.min(Math.abs(vF), 2.2 * dt);
    }
    vF -= vF * 0.08 * dt;
    if (handbrake) { vF -= Math.sign(vF) * Math.min(Math.abs(vF), 9 * dt); this.braking = true; }
    const grip = handbrake ? 1.4 : 7.5;
    vR *= Math.exp(-grip * dt);
    this.steer = damp(this.steer, steerIn, 8, dt);
    const angle = this.steer * 0.55 / (1 + Math.abs(vF) * 0.12);
    const yawRate = (vF * Math.tan(angle)) / (s.L * 0.6) * (handbrake ? 1.35 : 1);
    this.yaw += yawRate * dt;
    const nfx = -Math.sin(this.yaw), nfz = -Math.cos(this.yaw);
    const nrx = Math.cos(this.yaw), nrz = -Math.sin(this.yaw);
    this.vel.set(nfx * vF + nrx * vR, nfz * vF + nrz * vR);
    this.speed = vF;
    this.slip = Math.abs(vR);
    this.integrate(dt);
  }

  integrate(dt) {
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.y * dt;
    // 建物との衝突(前後2つの円)
    const r = this.radius;
    const f = this.spec.L / 2 - this.spec.W / 2;
    for (const sgn of [1, -1]) {
      const fx = -Math.sin(this.yaw) * f * sgn, fz = -Math.cos(this.yaw) * f * sgn;
      const c = { x: this.pos.x + fx, z: this.pos.z + fz };
      const hit = this.game.city.colliders.resolve(c, r);
      if (hit) {
        this.pos.x = c.x - fx; this.pos.z = c.z - fz;
        const vn = this.vel.x * hit.nx + this.vel.y * hit.nz;
        if (vn < 0) {
          this.vel.x -= vn * hit.nx * 1.3; this.vel.y -= vn * hit.nz * 1.3;
          this.vel.multiplyScalar(0.85);
          this.impact(-vn, hit.c.tag);
        }
      }
    }
    this.pos.y = damp(this.pos.y, groundY(this.pos.x, this.pos.z) * 0.6, 12, dt);
  }

  impact(v, what) {
    if (v < 2) return;
    this.hp = Math.max(0, this.hp - v * (this.kind === 'police' ? 0.9 : 1.4));
    if (this.driver === 'player') {
      this.game.shake(Math.min(1, v / 18));
      this.game.audio.crash(Math.min(1, v / 20));
    } else if (this.game.player && this.pos.distanceTo(this.game.player.pos) < 40) {
      this.game.audio.crash(Math.min(0.6, v / 25));
    }
  }

  sync(dt = 0) {
    this.obj.position.copy(this.pos);
    this.obj.rotation.set(0, this.yaw, 0);
    // 車体のロール・ピッチ(加減速と旋回で少し傾く)
    const lean = clamp(this.steer * this.speed * 0.004, -0.06, 0.06);
    this.obj.rotation.z = -lean;
    this.wheelSpin += (this.speed / 0.3) * dt;
    this.wheels.forEach((w, i) => {
      if (!w) return;
      w.rotation.x = -this.wheelSpin;
      if (i < 2) w.rotation.y = this.steer * 0.5;
    });
    const u = this.mat.userData.u;
    u.uBrake.value = this.wrecked ? 0 : this.braking ? 3.5 : 1;
    if (this.kind === 'police') {
      const on = this.siren && this.driver === 'police';
      const ph = Math.floor(performance.now() / 166) % 2;
      if (on) u.uSiren.value.setRGB(ph ? 12 : 0.5, 0, ph ? 0.5 : 12);
      else u.uSiren.value.setRGB(0.4, 0.02, 0.02);
    }
    this.beam.visible = this.hp > 0;
  }

  remove() { this.game.scene.remove(this.obj); this.dead = true; }
}

// ---------------------------------------------------------------- 一般車の交通
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const LANE = 2.1;

function laneOffset(dx, dz) { return [dz * LANE, -dx * LANE]; } // 左側通行: 進行方向の左

export class Traffic {
  constructor(game, count = 26) {
    this.game = game;
    this.cars = [];
    this.target = count;
  }

  spawnNpc(nearX, nearZ, minD = 70, maxD = 170) {
    for (let tries = 0; tries < 20; tries++) {
      const i = randi(0, N), k = randi(0, N);
      const [dx, dz] = pick(DIRS);
      const a = nodeAt(i, k), b = nodeAt(i + dx, k + dz);
      if (!a || !b) continue;
      const s = rand(12, P - 12);
      const [lx, lz] = laneOffset(dx, dz);
      const x = a.x + dx * s + lx, z = a.z + dz * s + lz;
      const d = Math.hypot(x - nearX, z - nearZ);
      if (d < minD || d > maxD) continue;
      if (this.game.allCars().some((c) => Math.hypot(c.pos.x - x, c.pos.z - z) < 12)) continue;
      const kind = Math.random() < 0.3 ? 'taxi' : Math.random() < 0.55 ? 'kei' : 'sedan';
      const car = new Car(this.game, kind, x, z, Math.atan2(-dx, -dz));
      car.driver = 'npc';
      car.ai = { a, b, dx, dz, s, turn: null, speed: 0, wait: 0, cruise: rand(9, 13), honk: 0 };
      this.cars.push(car);
      return car;
    }
    return null;
  }

  update(dt) {
    const g = this.game;
    const px = g.player.pos.x, pz = g.player.pos.z;
    // 遠すぎる車は消して、プレイヤーの周囲に補充
    for (const c of this.cars) {
      if (c.driver === 'npc' && Math.hypot(c.pos.x - px, c.pos.z - pz) > 220) c.remove();
    }
    this.cars = this.cars.filter((c) => !c.dead);
    const npcCount = this.cars.filter((c) => c.driver === 'npc').length;
    if (npcCount < this.target) this.spawnNpc(px, pz);

    for (const car of this.cars) {
      if (car.driver === 'npc') this.steerNpc(car, dt);
      else if (car.driver === null) {
        // 無人の車は慣性で止まる
        car.drive(dt, 0, 0, true);
      }
      car.sync(dt);
    }
  }

  steerNpc(car, dt) {
    const ai = car.ai;
    const g = this.game;
    // 前方の障害物を確認(車・プレイヤー・歩行者)
    const fx = -Math.sin(car.yaw), fz = -Math.cos(car.yaw);
    let block = 99;
    const check = (x, z, w) => {
      const rx = x - car.pos.x, rz = z - car.pos.z;
      const ahead = rx * fx + rz * fz;
      const side = Math.abs(rx * -fz + rz * fx);
      if (ahead > 0 && ahead < 16 && side < w) block = Math.min(block, ahead);
    };
    for (const o of g.allCars()) if (o !== car) check(o.pos.x, o.pos.z, 2.2);
    check(g.player.pos.x, g.player.pos.z, 1.8);
    for (const p of g.peds.list) if (p.state !== 'down') check(p.pos.x, p.pos.z, 1.4);
    let target = ai.cruise;
    if (ai.turn) target = Math.min(target, 6.5);
    if (block < 16) target = Math.min(target, Math.max(0, (block - 5.5) * 1.1));
    if (ai.wait > 0) { ai.wait -= dt; target = 0; }
    ai.speed = damp(ai.speed, target, target < ai.speed ? 5 : 1.5, dt);
    car.braking = target < ai.speed - 0.5 || ai.speed < 0.3;
    if (block < 7 && ai.speed < 0.5) {
      ai.honk -= dt;
      if (ai.honk < 0) { ai.honk = rand(3, 6); if (car.pos.distanceTo(g.player.pos) < 35) g.audio.horn(car.pos); }
    }
    const move = ai.speed * dt;
    const prev = car.pos.clone();
    if (!ai.turn) {
      ai.s += move;
      const [lx, lz] = laneOffset(ai.dx, ai.dz);
      car.pos.set(ai.a.x + ai.dx * ai.s + lx, 0, ai.a.z + ai.dz * ai.s + lz);
      car.yaw = Math.atan2(-ai.dx, -ai.dz);
      if (ai.s > P - 10) this.beginTurn(car);
    } else {
      const t = ai.turn;
      t.u = Math.min(1, t.u + move / t.len);
      const u = t.u, iu = 1 - u;
      const x = iu * iu * t.p0[0] + 2 * iu * u * t.p1[0] + u * u * t.p2[0];
      const z = iu * iu * t.p0[1] + 2 * iu * u * t.p1[1] + u * u * t.p2[1];
      car.pos.set(x, 0, z);
      const dxz = [car.pos.x - prev.x, car.pos.z - prev.z];
      if (Math.hypot(dxz[0], dxz[1]) > 1e-4) car.yaw = Math.atan2(-dxz[0], -dxz[1]);
      if (u >= 1) { ai.turn = null; ai.s = 10; }
    }
    car.speed = ai.speed;
    car.vel.set(-Math.sin(car.yaw) * ai.speed, -Math.cos(car.yaw) * ai.speed);
    car.steer = ai.turn ? ai.turn.dir * 0.6 : 0;
  }

  beginTurn(car) {
    const ai = car.ai;
    const b = ai.b;
    const options = DIRS.filter(([dx, dz]) => !(dx === -ai.dx && dz === -ai.dz) && nodeAt(b.i + dx, b.k + dz));
    const [ndx, ndz] = options.length ? pick(options) : [-ai.dx, -ai.dz];
    const [lx, lz] = laneOffset(ai.dx, ai.dz);
    const [nlx, nlz] = laneOffset(ndx, ndz);
    const p0 = [b.x - ai.dx * 10 + lx, b.z - ai.dz * 10 + lz];
    const p2 = [b.x + ndx * 10 + nlx, b.z + ndz * 10 + nlz];
    // 直進なら中点、曲がるなら角
    const straight = ndx === ai.dx && ndz === ai.dz;
    const p1 = straight ? [(p0[0] + p2[0]) / 2, (p0[1] + p2[1]) / 2] : [b.x + lx + nlx, b.z + lz + nlz];
    const cross = ai.dx * ndz - ai.dz * ndx;
    ai.turn = { p0, p1, p2, u: 0, len: straight ? 20 : 15, dir: straight ? 0 : -Math.sign(cross) };
    ai.a = b; ai.b = nodeAt(b.i + ndx, b.k + ndz); ai.dx = ndx; ai.dz = ndz;
  }
}

// ---------------------------------------------------------------- パトカー
export class Police {
  constructor(game) {
    this.game = game;
    this.cars = [];
    this.light = new THREE.PointLight(0xff0000, 0, 30, 1.6);
    game.scene.add(this.light);
  }

  wantedCount(stars) { return [0, 1, 2, 3, 5, 6][stars]; }

  spawn() {
    const g = this.game;
    const p = g.player.pos;
    for (let tries = 0; tries < 30; tries++) {
      const i = randi(0, N), k = randi(0, N);
      const n = nodeAt(i, k);
      const d = Math.hypot(n.x - p.x, n.z - p.z);
      if (d < 90 || d > 190) continue;
      const car = new Car(g, 'police', n.x, n.z, Math.atan2(n.x - p.x, n.z - p.z));
      car.driver = 'police';
      car.ai = { wp: null, stuck: 0, reverse: 0, lost: 0 };
      this.cars.push(car);
      g.traffic.cars.push(car);
      return;
    }
  }

  update(dt) {
    const g = this.game;
    const stars = g.wanted.stars;
    this.cars = this.cars.filter((c) => !c.dead);
    const active = this.cars.filter((c) => c.driver === 'police');
    if (active.length < this.wantedCount(stars)) {
      this.spawnTimer = (this.spawnTimer ?? 0) - dt;
      if (this.spawnTimer <= 0) { this.spawn(); this.spawnTimer = 4; }
    }
    let nearest = null, nd = 1e9;
    for (const car of active) {
      const d = car.pos.distanceTo(g.player.pos);
      if (stars === 0) {
        // 手配が消えたら去っていく
        car.siren = false;
        this.patrol(car, dt);
        if (d > 160) { car.remove(); }
        continue;
      }
      car.siren = true;
      this.chase(car, dt, d);
      if (d < nd) { nd = d; nearest = car; }
    }
    // サイレンの赤青ライト(最寄りの1台だけ実ライト)
    if (nearest && nd < 60) {
      const ph = Math.floor(performance.now() / 166) % 2;
      this.light.color.set(ph ? 0xff1010 : 0x1030ff);
      this.light.intensity = 60;
      this.light.position.copy(nearest.pos).y = 2.2;
    } else this.light.intensity = 0;
    this.nearest = nearest ? nd : 1e9;
  }

  patrol(car, dt) {
    car.drive(dt, 0.4, 0, false);
  }

  chase(car, dt, dist) {
    const g = this.game;
    const ai = car.ai;
    const tgt = g.player.inCar ? g.player.inCar.pos : g.player.pos;
    const col = g.city.colliders;
    const dx = tgt.x - car.pos.x, dz = tgt.z - car.pos.z;
    const d = Math.hypot(dx, dz);
    // 見通しが良ければ直接、そうでなければ交差点を経由
    const clear = col.raycast(car.pos.x, car.pos.z, dx / d, dz / d, d) >= d - 0.5;
    let aim;
    if (clear || d < 14) {
      aim = tgt; ai.wp = null;
      ai.lost = 0;
    } else {
      ai.lost += dt;
      if (!ai.wp || Math.hypot(ai.wp.x - car.pos.x, ai.wp.z - car.pos.z) < 9) {
        // いまいる交差点(または最寄り)から、目標に一番近づく隣の交差点へ
        const here = nearestNode(car.pos.x, car.pos.z);
        const atNode = Math.hypot(here.x - car.pos.x, here.z - car.pos.z) < 12;
        if (!atNode) ai.wp = here;
        else {
          let best = null, bd = 1e9;
          for (const [ox, oz] of DIRS) {
            const n = nodeAt(here.i + ox, here.k + oz);
            if (!n) continue;
            const nd = Math.hypot(n.x - tgt.x, n.z - tgt.z);
            if (nd < bd) { bd = nd; best = n; }
          }
          ai.wp = best;
        }
      }
      aim = ai.wp;
    }
    const want = Math.atan2(-(aim.x - car.pos.x), -(aim.z - car.pos.z));
    const diff = wrapAngle(want - car.yaw);
    let steer = clamp(diff * 2.2, -1, 1);
    let throttle = 1;
    if (Math.abs(diff) > 1.2 && car.speed > 12) throttle = -0.6;
    // 徒歩のプレイヤーの前では止まる(逮捕に来る)
    const stopDist = 7 + (car.speed * car.speed) / 30; // 制動距離を見込んで手前から減速
    if (!g.player.inCar && d < stopDist) throttle = car.speed > 1 ? -1 : 0;
    // 引っかかったらバック
    if (ai.reverse > 0) { ai.reverse -= dt; throttle = -1; steer = -steer; }
    else if (Math.abs(car.speed) < 1.2 && throttle > 0.5) {
      ai.stuck += dt;
      if (ai.stuck > 1.2) { ai.reverse = 1.1; ai.stuck = 0; }
    } else ai.stuck = 0;
    car.drive(dt, throttle, steer, Math.abs(diff) > 1.6 && car.speed > 8);
  }
}

// 車同士・車と人の当たり判定
export function resolveCarCollisions(game, dt) {
  const cars = game.allCars();
  for (let a = 0; a < cars.length; a++) {
    const A = cars[a];
    for (let b = a + 1; b < cars.length; b++) {
      const B = cars[b];
      if (Math.abs(A.pos.x - B.pos.x) > 7 || Math.abs(A.pos.z - B.pos.z) > 7) continue;
      for (const ca of A.circles()) for (const cb of B.circles()) {
        const dx = cb.x - ca.x, dz = cb.z - ca.z;
        const d = Math.hypot(dx, dz), min = A.radius + B.radius;
        if (d >= min || d < 1e-5) continue;
        const nx = dx / d, nz = dz / d, pen = min - d;
        const aK = A.driver === 'npc', bK = B.driver === 'npc';
        const wa = aK ? 0.15 : 0.5, wb = bK ? 0.15 : 0.5;
        const sum = wa + wb;
        A.pos.x -= nx * pen * (wa / sum); A.pos.z -= nz * pen * (wa / sum);
        B.pos.x += nx * pen * (wb / sum); B.pos.z += nz * pen * (wb / sum);
        const rv = (B.vel.x - A.vel.x) * nx + (B.vel.y - A.vel.y) * nz;
        if (rv < 0) {
          const j = -rv * 0.8;
          if (!aK) { A.vel.x -= nx * j * (wa / sum) * 2; A.vel.y -= nz * j * (wa / sum) * 2; }
          if (!bK) { B.vel.x += nx * j * (wb / sum) * 2; B.vel.y += nz * j * (wb / sum) * 2; }
          A.impact(-rv * 0.7); B.impact(-rv * 0.7);
          for (const [me, other] of [[A, B], [B, A]]) {
            if (me.driver === 'npc' && -rv > 3) { me.ai.wait = rand(2, 4); me.ai.speed = 0; }
            if (me.driver === 'police' && other.driver === 'player') game.hurtPlayer(-rv * 0.8, 'ram');
            if (other.driver === 'player' && me.driver === 'police' && -rv > 5) game.wanted.crime(3, 'パトカーに体当たり');
          }
        }
      }
    }
  }
}

export { makeGlowSprite };
