// 歩行者: 歩道を歩き、銃声や暴走車から逃げる。雨なので多くがビニール傘を差している
import * as THREE from 'three';
import { P, N, CURB } from './city.js';
import { rand, randi, pick, clamp, damp, wrapAngle } from './util.js';

const SHIRTS = [0x2b2f3a, 0x1f2430, 0x3a3a3f, 0xe8e6df, 0x6b2a2a, 0x2d4a3a, 0xc9b28a, 0x8a6a9a, 0x335577, 0xd9d4c5];
const PANTS = [0x1a1c22, 0x23252c, 0x3b3f4a, 0x2a2f45, 0x4a3f33, 0x111111];
const W = 5.6; // 歩道の中心線(道路中心から)

let umbrellaGeo = null, umbrellaMat = null, handleMat = null;
function umbrella() {
  if (!umbrellaGeo) {
    umbrellaGeo = new THREE.ConeGeometry(0.52, 0.28, 12, 1, true);
    umbrellaMat = new THREE.MeshStandardMaterial({ color: 0xe8f2ff, transparent: true, opacity: 0.35, roughness: 0.1, side: THREE.DoubleSide, depthWrite: false });
    handleMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
  }
  const g = new THREE.Group();
  const canopy = new THREE.Mesh(umbrellaGeo, umbrellaMat); canopy.position.y = 0.72; g.add(canopy);
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.8, 5), handleMat); stick.position.y = 0.3; g.add(stick);
  return g;
}

export class Ped {
  constructor(game, x, z) {
    this.game = game;
    const o = game.assets.cloneUnique('person');
    o.traverse((m) => {
      if (!m.isMesh) return;
      if (m.material.name === 'Shirt') m.material.color.set(pick(SHIRTS));
      if (m.material.name === 'Pants') m.material.color.set(pick(PANTS));
    });
    o.traverse((m) => { if (m.isMesh) m.layers.set(1); }); // 路面反射には映さない(負荷軽減)
    this.obj = o;
    this.parts = {
      armL: o.getObjectByName('ArmL'), armR: o.getObjectByName('ArmR'),
      legL: o.getObjectByName('LegL'), legR: o.getObjectByName('LegR'), head: o.getObjectByName('HeadPivot'),
    };
    const s = rand(0.92, 1.08);
    o.scale.setScalar(s);
    this.height = 1.75 * s;
    if (Math.random() < 0.6) {
      this.umbrella = umbrella();
      this.umbrella.position.set(0.12, 1.15, -0.1);
      this.umbrella.traverse((m) => m.layers.set(1));
      o.add(this.umbrella);
      this.parts.armR.rotation.x = -1.1;
    }
    game.scene.add(o);
    this.pos = new THREE.Vector3(x, CURB, z);
    this.yaw = 0;
    this.state = 'walk';
    this.speed = rand(1.1, 1.5);
    this.phase = rand(0, 10);
    this.hp = 30;
    this.fear = 0;
    this.downT = 0;
    this.pickRoute();
  }

  // 自分のいる街区の歩道をぐるっと回る。角で時々道路を渡る
  pickRoute() {
    const i = clamp(Math.floor(this.pos.x / P), 0, N - 1);
    const k = clamp(Math.floor(this.pos.z / P), 0, N - 1);
    this.block = [i, k];
    this.corners = [[i * P + W, k * P + W], [(i + 1) * P - W, k * P + W], [(i + 1) * P - W, (k + 1) * P - W], [i * P + W, (k + 1) * P - W]];
    let best = 0, bd = 1e9;
    this.corners.forEach(([x, z], n) => { const d = Math.hypot(x - this.pos.x, z - this.pos.z); if (d < bd) { bd = d; best = n; } });
    this.ci = best;
    this.dirSign = Math.random() < 0.5 ? 1 : -1;
    this.target = this.corners[this.ci];
  }

  nextCorner() {
    if (Math.random() < 0.25) {
      // 横断歩道を渡って隣の街区へ
      const [x, z] = this.target;
      const opts = [[x - 2 * W, z], [x + 2 * W, z], [x, z - 2 * W], [x, z + 2 * W]]
        .filter(([ax, az]) => ax > 0 && az > 0 && ax < N * P && az < N * P
          && (Math.floor(ax / P) !== this.block[0] || Math.floor(az / P) !== this.block[1]));
      if (opts.length) { this.target = pick(opts); this.crossing = true; return; }
    }
    this.ci = (this.ci + this.dirSign + 4) % 4;
    this.target = this.corners[this.ci];
  }

  scare(x, z, amount) {
    if (this.state === 'down') return;
    const d = Math.hypot(this.pos.x - x, this.pos.z - z);
    this.fear = Math.max(this.fear, amount);
    this.fleeFrom = [x, z];
    if (this.state !== 'flee') { this.state = 'flee'; if (Math.random() < 0.4) this.game.audio.scream(this.pos, d); }
  }

  knock(dirX, dirZ, force) {
    if (this.state === 'down') return false;
    this.state = 'down';
    this.downT = 0;
    this.fallDir = Math.atan2(-dirX, -dirZ); // 押された方向へ前のめりに倒れる
    this.slide = [dirX * force, dirZ * force];
    if (this.umbrella) { this.umbrella.visible = false; }
    return true;
  }

  update(dt) {
    const p = this.parts;
    if (this.state === 'down') {
      this.downT += dt;
      const t = Math.min(1, this.downT * 3.5);
      this.pos.x += this.slide[0] * dt; this.pos.z += this.slide[1] * dt;
      this.slide[0] *= Math.exp(-4 * dt); this.slide[1] *= Math.exp(-4 * dt);
      this.game.city.colliders.resolve(this.pos, 0.3);
      this.obj.position.set(this.pos.x, this.game.groundY(this.pos.x, this.pos.z) + 0.1 * t, this.pos.z);
      this.obj.rotation.set(0, this.fallDir, 0);
      this.obj.rotateX(-Math.PI / 2 * (1 - Math.pow(1 - t, 3)));
      p.armL.rotation.x = -2.6 * t; p.armR.rotation.x = -2.2 * t;
      if (this.downT > 14) this.dead = true;
      return;
    }
    let spd = this.speed;
    let tx, tz;
    if (this.state === 'flee') {
      this.fear -= dt * 0.12;
      if (this.fear <= 0) { this.state = 'walk'; this.pickRoute(); }
      const [fx, fz] = this.fleeFrom;
      let ax = this.pos.x - fx, az = this.pos.z - fz;
      const l = Math.hypot(ax, az) || 1;
      tx = this.pos.x + (ax / l) * 10; tz = this.pos.z + (az / l) * 10;
      spd = 4.6;
    } else {
      [tx, tz] = this.target;
      if (Math.hypot(tx - this.pos.x, tz - this.pos.z) < 0.8) {
        if (this.crossing) { this.crossing = false; this.pickRoute(); }
        else this.nextCorner();
        [tx, tz] = this.target;
      }
    }
    const want = Math.atan2(-(tx - this.pos.x), -(tz - this.pos.z));
    this.yaw += wrapAngle(want - this.yaw) * Math.min(1, dt * 6);
    this.pos.x += -Math.sin(this.yaw) * spd * dt;
    this.pos.z += -Math.cos(this.yaw) * spd * dt;
    const hit = this.game.city.colliders.resolve(this.pos, 0.3);
    if (hit && this.state === 'flee') this.yaw += 1.2; // 壁にぶつかったら向きを変える
    this.pos.y = this.game.groundY(this.pos.x, this.pos.z);
    // 歩行アニメーション
    this.phase += dt * spd * 3.2;
    const sw = Math.sin(this.phase) * (this.state === 'flee' ? 0.9 : 0.5);
    p.legL.rotation.x = sw; p.legR.rotation.x = -sw;
    p.armL.rotation.x = -sw * 0.8;
    if (!this.umbrella || this.state === 'flee') p.armR.rotation.x = sw * 0.8;
    if (this.umbrella && this.state === 'flee') this.umbrella.visible = false;
    this.obj.position.set(this.pos.x, this.pos.y + Math.abs(Math.cos(this.phase)) * 0.04, this.pos.z);
    this.obj.rotation.set(0, this.yaw, 0);
  }

  remove() { this.game.scene.remove(this.obj); this.dead = true; }
}

export class Peds {
  constructor(game, count = 42) { this.game = game; this.list = []; this.target = count; }

  spawnAt(x, z) { const p = new Ped(this.game, x, z); this.list.push(p); return p; }

  // 歩道上のランダムな地点(建物・電柱に重ならない場所)
  sidewalkPoint(cx, cz, minD, maxD) {
    const col = this.game.city.colliders;
    for (let t = 0; t < 12; t++) {
      const i = randi(0, N - 1), k = randi(0, N - 1);
      const side = randi(0, 3), u = rand(W, P - W);
      const x = i * P + [u, P - W, u, W][side], z = k * P + [W, u, P - W, u][side];
      const d = Math.hypot(x - cx, z - cz);
      if (d < minD || d > maxD) continue;
      if ([...col.near(x, z, 1)].some((c) => x > c.minX - 0.5 && x < c.maxX + 0.5 && z > c.minZ - 0.5 && z < c.maxZ + 0.5)) continue;
      return [x, z];
    }
    return null;
  }

  // 指定地点の周りを人で埋める(ゲーム開始時など)
  populate(cx, cz, radius) {
    for (const p of this.list) this.game.scene.remove(p.obj);
    this.list = [];
    for (let n = 0; n < this.target * 6 && this.list.length < this.target; n++) {
      const pt = this.sidewalkPoint(cx, cz, 4, radius);
      if (pt) this.spawnAt(pt[0], pt[1]);
    }
  }

  update(dt) {
    const g = this.game;
    const px = g.player.pos.x, pz = g.player.pos.z;
    for (const p of this.list) {
      if (Math.hypot(p.pos.x - px, p.pos.z - pz) > 110) p.remove();
    }
    this.list = this.list.filter((p) => { if (p.dead) g.scene.remove(p.obj); return !p.dead; });
    if (this.list.length < this.target) {
      // 適度な距離の歩道に出現
      const pt = this.sidewalkPoint(px, pz, 45, 100);
      if (pt) this.spawnAt(pt[0], pt[1]);
    }
    for (const p of this.list) {
      // 近くを暴走する車から逃げる/はねられる
      for (const c of g.allCars()) {
        if (Math.abs(c.speed) < 3 || p.state === 'down') continue;
        for (const cc of c.circles()) {
          const dx = p.pos.x - cc.x, dz = p.pos.z - cc.z;
          const d = Math.hypot(dx, dz);
          if (d < c.radius + 0.35 && Math.abs(c.speed) > 4) {
            const f = Math.abs(c.speed);
            if (p.knock(c.vel.x / f, c.vel.y / f, f * 0.6)) {
              g.audio.thud(p.pos);
              if (c.driver === 'player') g.onPedHit(p, 'car');
            }
          } else if (d < 7 && c.driver === 'player' && Math.abs(c.speed) > 8) p.scare(cc.x, cc.z, 0.6);
        }
      }
      p.update(dt);
    }
  }

  scareAll(x, z, radius, amount) {
    for (const p of this.list) if (Math.hypot(p.pos.x - x, p.pos.z - z) < radius) p.scare(x, z, amount);
  }
}
