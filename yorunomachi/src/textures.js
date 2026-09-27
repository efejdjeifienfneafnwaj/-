// キャンバスで手続き生成するテクスチャ類(外部画像ファイル不要)
import * as THREE from 'three';
import { rand, pick } from './util.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, { srgb = true, repeat = false } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// ビル外壁: 1枚 = 横8窓 × 縦8階 (24m × 28m)。map と emissiveMap を対で作る
export const FACADE_W = 24, FACADE_H = 28;
export function makeFacade(style) {
  const S = 512;
  const [c, g] = canvas(S, S);
  const [e, ge] = canvas(S, S);
  const cols = 8, rows = 8, cw = S / cols, rh = S / rows;
  const wall = { concrete: '#6d6f73', tile: '#8a7f70', dark: '#23262d', white: '#a9adb0' }[style];
  g.fillStyle = wall; g.fillRect(0, 0, S, S);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, S, S);
  // 外壁の汚れ・タイル目地
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = `rgba(0,0,0,${rand(0.02, 0.07)})`;
    g.fillRect(rand(0, S), rand(0, S), rand(1, 4), rand(2, 30));
  }
  if (style === 'tile') {
    g.strokeStyle = 'rgba(0,0,0,.12)'; g.lineWidth = 1;
    for (let y = 0; y < S; y += 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); }
  }
  const warm = ['#ffd9a0', '#ffe7c2', '#ffcf8a', '#fff1d6'];
  const cool = ['#d8f0ff', '#e9f7ff', '#c8ffe9'];
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const x = k * cw, y = r * rh;
      const glassy = style === 'dark';
      const ww = glassy ? cw - 6 : cw * 0.5, wh = glassy ? rh - 10 : rh * 0.48;
      const wx = x + (cw - ww) / 2, wy = y + (rh - wh) / 2 - 2;
      // 窓枠
      g.fillStyle = 'rgba(20,20,24,.9)'; g.fillRect(wx - 2, wy - 2, ww + 4, wh + 4);
      const lit = Math.random() < (glassy ? 0.22 : 0.3);
      if (lit) {
        const col = Math.random() < 0.6 ? pick(warm) : pick(cool);
        g.fillStyle = col; g.fillRect(wx, wy, ww, wh);
        const inten = rand(0.3, 0.75);
        ge.globalAlpha = inten; ge.fillStyle = col; ge.fillRect(wx, wy, ww, wh);
        // カーテン・ブラインド
        if (Math.random() < 0.5) {
          ge.globalAlpha = inten * 0.5; ge.fillStyle = '#000';
          const bw = rand(0.2, 0.6) * ww;
          ge.fillRect(Math.random() < 0.5 ? wx : wx + ww - bw, wy, bw, wh);
          g.fillStyle = 'rgba(60,40,30,.5)'; g.fillRect(wx, wy, bw, wh);
        }
        if (Math.random() < 0.35) {
          ge.globalAlpha = inten * 0.35; ge.fillStyle = '#000';
          for (let yy = wy; yy < wy + wh; yy += 4) ge.fillRect(wx, yy, ww, 1.5);
        }
        ge.globalAlpha = 1;
      } else {
        const grd = g.createLinearGradient(wx, wy, wx + ww, wy + wh);
        grd.addColorStop(0, '#1b2230'); grd.addColorStop(1, '#0c0f16');
        g.fillStyle = grd; g.fillRect(wx, wy, ww, wh);
      }
      if (!glassy) { // 窓の桟
        g.fillStyle = 'rgba(25,25,28,.85)'; g.fillRect(wx + ww / 2 - 1, wy, 2, wh);
        ge.fillStyle = '#000'; ge.fillRect(wx + ww / 2 - 1, wy, 2, wh);
      }
      // エアコン室外機
      if (!glassy && Math.random() < 0.18) {
        g.fillStyle = '#b8b8b2'; g.fillRect(wx + ww + 2, wy + wh - 12, 12, 10);
      }
    }
  }
  return { map: tex(c, { repeat: true }), emissive: tex(e, { repeat: true }) };
}

// 1階の店舗ファサード(シャッター/ガラス張り)
export function makeStorefronts() {
  const W = 1024, H = 128;
  const [c, g] = canvas(W, H);
  const [e, ge] = canvas(W, H);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
  const n = 8, cw = W / n;
  for (let i = 0; i < n; i++) {
    const x = i * cw;
    const kind = i % 4;
    if (kind === 0) { // シャッター
      g.fillStyle = '#7b7f84'; g.fillRect(x, 0, cw, H);
      for (let y = 8; y < H; y += 5) { g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x, y, cw, 2); }
      g.fillStyle = 'rgba(40,40,40,.6)';
      g.font = 'bold 18px sans-serif'; g.fillText(pick(['テナント募集', '貸店舗', '本日休業']), x + 12, 70);
    } else { // 明るいガラス店舗
      const col = pick(['#e8c9a0', '#bfe3ee', '#e9c3cf', '#e9df9f', '#c9e8c0']);
      g.fillStyle = '#222'; g.fillRect(x, 0, cw, H);
      g.fillStyle = col; g.fillRect(x + 6, 14, cw - 12, H - 20);
      ge.fillStyle = col; ge.fillRect(x + 6, 14, cw - 12, H - 20);
      // 棚・人影
      for (let k = 0; k < 6; k++) {
        const sx = x + 10 + k * 20, sh = rand(20, 60);
        g.fillStyle = `hsl(${rand(0, 360)},40%,45%)`; g.fillRect(sx, H - 6 - sh, 14, sh);
        ge.fillStyle = 'rgba(0,0,0,.55)'; ge.fillRect(sx, H - 6 - sh, 14, sh);
      }
      g.fillStyle = '#333'; ge.fillStyle = '#000';
      for (let k = 0; k < 3; k++) { g.fillRect(x + 6 + k * (cw - 12) / 3, 14, 3, H - 20); ge.fillRect(x + 6 + k * (cw - 12) / 3, 14, 3, H - 20); }
    }
  }
  return { map: tex(c, { repeat: true }), emissive: tex(e, { repeat: true }) };
}

// 縦看板・横看板のアトラス
const V_SIGNS = ['居酒屋', 'ラーメン', 'カラオケ', '焼肉', '質', '薬', '麻雀', 'スナック夜霧', '喫茶', 'ホテル', '寿司', '金融', '占い', 'BAR', '餃子', '整体'];
const H_SIGNS = ['コンビニ ヨルマート', '居酒屋 ほろ酔い', 'ラーメン 龍', '牛丼 ほし屋', '漫画喫茶', 'カラオケ 歌宴', '不動産', '中華 飯店',
  '焼鳥 とり吉', '立ち食いそば', 'ゲームセンター', '古着 屋根裏', '歯科医院', 'クリーニング', '回転寿司', 'ドラッグストア'];
const NEON = ['#ff2e88', '#35e8ff', '#ffb62e', '#8cff5a', '#ff4b3a', '#c070ff', '#ffffff', '#ffe23a'];

function fitText(g, text, max, weight, font, start) {
  let size = start;
  do { g.font = `${weight} ${size}px ${font}`; size -= 2; } while (g.measureText(text).width > max && size > 10);
}

export function makeSignAtlas() {
  // 縦看板: 128x512 セル × 8列 × 2行、横看板: 512x128 セル × 2列 × 8行
  const [vc, vg] = canvas(1024, 1024);
  const [hc, hg] = canvas(1024, 1024);
  const font = '"Zen Kaku Gothic New", "Hiragino Sans", "Yu Gothic", sans-serif';
  V_SIGNS.forEach((t, i) => {
    const x = (i % 8) * 128, y = Math.floor(i / 8) * 512;
    const col = NEON[i % NEON.length];
    const inverted = i % 3 === 0;
    vg.fillStyle = inverted ? col : '#111';
    vg.fillRect(x + 4, y + 4, 120, 504);
    vg.strokeStyle = inverted ? '#fff' : col; vg.lineWidth = 5;
    vg.strokeRect(x + 10, y + 10, 108, 492);
    vg.fillStyle = inverted ? '#111' : col;
    vg.shadowColor = col; vg.shadowBlur = inverted ? 0 : 14;
    const chars = [...t];
    const step = Math.min(96, 470 / chars.length);
    vg.font = `900 ${Math.floor(step * 0.86)}px ${font}`;
    vg.textAlign = 'center'; vg.textBaseline = 'middle';
    chars.forEach((ch, k) => vg.fillText(ch, x + 64, y + 30 + step * (k + 0.5) + (470 - step * chars.length) / 2));
    vg.shadowBlur = 0;
  });
  H_SIGNS.forEach((t, i) => {
    const x = (i % 2) * 512, y = Math.floor(i / 2) * 128;
    const col = NEON[(i * 3) % NEON.length];
    const bg = i % 2 === 0 ? '#cfc8b4' : '#141418';
    hg.fillStyle = bg; hg.fillRect(x + 3, y + 3, 506, 122);
    hg.fillStyle = col; hg.fillRect(x + 3, y + 3, 506, 14);
    hg.fillStyle = i % 2 === 0 ? '#1a1a1a' : col;
    hg.shadowColor = col; hg.shadowBlur = i % 2 === 0 ? 0 : 12;
    hg.textAlign = 'center'; hg.textBaseline = 'middle';
    fitText(hg, t, 470, 900, font, 72);
    hg.fillText(t, x + 256, y + 72);
    hg.shadowBlur = 0;
  });
  return { v: tex(vc), h: tex(hc), vCount: V_SIGNS.length, hCount: H_SIGNS.length };
}

// 屋上広告(大型ビルボード)
export function makeBillboards() {
  const [c, g] = canvas(1024, 512);
  const ads = [
    { bg: ['#ff2e88', '#6a0dad'], t: '夜ノ街銀行', s: 'すぐ借りられる。すぐ返せない。' },
    { bg: ['#0a4bff', '#00d0ff'], t: 'ネオ缶コーヒー', s: '眠らない街の、眠らない一本。' },
    { bg: ['#ff8a00', '#ff2a00'], t: '激辛らーめん地獄', s: '完食で無料。無理はしない。' },
    { bg: ['#141414', '#3a3a3a'], t: 'TOKYO 2040', s: '— 近日公開 —' },
  ];
  const font = '"Zen Kaku Gothic New", sans-serif';
  ads.forEach((a, i) => {
    const x = (i % 2) * 512, y = Math.floor(i / 2) * 256;
    const grd = g.createLinearGradient(x, y, x + 512, y + 256);
    grd.addColorStop(0, a.bg[0]); grd.addColorStop(1, a.bg[1]);
    g.fillStyle = grd; g.fillRect(x, y, 512, 256);
    g.fillStyle = 'rgba(255,255,255,.08)';
    for (let k = 0; k < 8; k++) { g.beginPath(); g.arc(x + rand(0, 512), y + rand(0, 256), rand(20, 90), 0, 7); g.fill(); }
    g.fillStyle = '#fff'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    fitText(g, a.t, 460, 900, font, 64); g.fillText(a.t, x + 28, y + 140);
    g.font = `700 22px ${font}`; g.fillStyle = 'rgba(255,255,255,.85)'; g.fillText(a.s, x + 30, y + 190);
  });
  return tex(c);
}

// 路面の細かいざらつき(タイル可能なノイズ)
export function makeGrain() {
  const S = 256;
  const [c, g] = canvas(S, S);
  const img = g.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const v = 110 + Math.random() * 60;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // 水たまり用の大きなまだら(アルファではなく G チャンネルに入れる)
  for (let i = 0; i < 40; i++) {
    const x = rand(0, S), y = rand(0, S), r = rand(10, 40);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(0,0,0,.5)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) { g.save(); g.translate(dx, dy); g.fillRect(x - r, y - r, r * 2, r * 2); g.restore(); }
  }
  return tex(c, { srgb: false, repeat: true });
}

// 歩道タイル
export function makeSidewalk() {
  const S = 256;
  const [c, g] = canvas(S, S);
  g.fillStyle = '#5b5a58'; g.fillRect(0, 0, S, S);
  const n = 4, s = S / n;
  for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) {
    const l = rand(-8, 8);
    g.fillStyle = `rgb(${88 + l},${87 + l},${85 + l})`;
    g.fillRect(i * s + 2, k * s + 2, s - 4, s - 4);
  }
  for (let i = 0; i < 800; i++) { g.fillStyle = `rgba(0,0,0,${rand(0.05, 0.2)})`; g.fillRect(rand(0, S), rand(0, S), 2, 2); }
  return tex(c, { repeat: true });
}

// 光のにじみを1枚に焼き込んだ地面ライトマップ(街全体を上から見た図)
export function makeGroundLightmap(size, extent, lights) {
  const [c, g] = canvas(size, size);
  g.fillStyle = '#000'; g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = 'lighter';
  const k = size / extent;
  for (const L of lights) {
    const x = L.x * k, y = L.z * k, r = L.r * k;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    const [cr, cg, cb] = L.color;
    grd.addColorStop(0, `rgba(${cr},${cg},${cb},${L.i})`);
    grd.addColorStop(0.4, `rgba(${cr},${cg},${cb},${L.i * 0.35})`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    if (L.w) { // 店先の横長の光
      g.save(); g.translate(x, y); g.rotate(L.rot || 0); g.scale(L.w / L.r, 1);
      g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fillStyle = (() => {
        const gg = g.createRadialGradient(0, 0, 0, 0, 0, r);
        gg.addColorStop(0, `rgba(${cr},${cg},${cb},${L.i})`); gg.addColorStop(1, 'rgba(0,0,0,0)'); return gg;
      })(); g.fill(); g.restore();
    } else {
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// 雨粒・光のフレア用のやわらかいスプライト
export function makeGlowSprite() {
  const [c, g] = canvas(64, 64);
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,.5)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return tex(c);
}
