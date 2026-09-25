/* 使い方：NODE_PATH=... node tools/背景画像を作る.js lms-widget/app/bg.jpg（Chromium で描いて撮る） */
/* 入口の背景：明るいオフィス（窓の外にビル街・観葉植物・白い机・マグカップと本）。
   SVG で奥行きごとに描き分け、被写界深度のぼかし・窓の光のにじみ・細かい粒子を重ねて写真に寄せる。
   出力：2880×1620 の JPEG */
const { chromium } = require('playwright-core');
const fs = require('fs');
let seed = 20260925;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const R = (a, b) => a + rnd() * (b - a);
const pick = a => a[Math.floor(rnd() * a.length)];
const W = 1920, H = 1080, HORIZON = 820;
const f = n => n.toFixed(1);

/* ── ビル（ガラスのタワー）。面の明暗・階の線・縦の目地・映り込み ── */
let gid = 0;
const defs = [];
function tower(x, w, top, tone, detail){
  const id = 'tw' + (gid++);
  const [c1, c2, c3] = tone;
  defs.push(`<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="${c1}"/><stop offset=".55" stop-color="${c2}"/><stop offset="1" stop-color="${c3}"/></linearGradient>`);
  let s = `<rect x="${f(x)}" y="${f(top)}" width="${f(w)}" height="${f(HORIZON - top + 10)}" fill="url(#${id})"/>`;
  /* 屋上の段 */
  if(rnd() < .5){ const iw = w * R(.4, .7); s += `<rect x="${f(x + (w - iw) / 2)}" y="${f(top - R(8, 26))}" width="${f(iw)}" height="${f(R(10, 28))}" fill="${c2}"/>`; }
  if(detail > 0){
    const fl = detail > 1 ? R(9, 13) : R(12, 18);
    for(let y = top + fl; y < HORIZON; y += fl){
      s += `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${detail > 1 ? 1.3 : 1.6}" fill="#ffffff" opacity="${f(R(.18, .34))}"/>`;
    }
    const col = detail > 1 ? R(9, 14) : R(14, 22);
    for(let xx = x + col; xx < x + w - 2; xx += col){
      s += `<rect x="${f(xx)}" y="${f(top)}" width="1" height="${f(HORIZON - top)}" fill="#6f8db3" opacity="${f(R(.10, .2))}"/>`;
    }
    /* 空の映り込み（斜めの明るい帯） */
    const rid = 'rf' + (gid++);
    defs.push(`<linearGradient id="${rid}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".45" stop-color="#fff" stop-opacity="${f(R(.18, .32))}"/>
      <stop offset=".6" stop-color="#fff" stop-opacity="0"/></linearGradient>`);
    s += `<rect x="${f(x)}" y="${f(top)}" width="${f(w)}" height="${f(HORIZON - top)}" fill="url(#${rid})"/>`;
    /* ところどころ灯りの点いた窓 */
    for(let i = 0; i < w * (HORIZON - top) / 9000; i++){
      s += `<rect x="${f(R(x + 2, x + w - 8))}" y="${f(R(top + 6, HORIZON - 10))}" width="${f(R(4, 8))}" height="${f(R(3, 6))}" fill="#f4f8fc" opacity="${f(R(.12, .28))}"/>`;
    }
  }
  return s;
}
function skyline(x0, x1, hMin, hMax, tones, detail, gapMin, gapMax){
  let s = '', x = x0;
  while(x < x1){
    const w = R(50, 150);
    s += tower(x, w, R(hMin, hMax), pick(tones), detail);
    x += w + R(gapMin, gapMax);
  }
  return s;
}

/* ── 葉（先のとがった形・中央が明るいグラデーション・葉脈） ── */
const LEAF_G = [
  ['#9fd07f', '#5f9f47', '#3d7a33'], ['#a9d88a', '#6aac51', '#44843a'], ['#8cc56d', '#4f8f3e', '#2f6a2b'],
  ['#b5df95', '#78b85c', '#4c8d3f'], ['#94c975', '#56963f', '#356f2f'], ['#c1e6a2', '#86c268', '#58984a']
];
const LEAF_D = [['#6fa65a', '#3f7a35', '#265226'], ['#7bb163', '#46853b', '#2c5c2a'], ['#5f9950', '#356d2f', '#1f4520']];
LEAF_D.forEach((g, i) => defs.push(`<linearGradient id="ld${i}" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="${g[0]}"/><stop offset=".5" stop-color="${g[1]}"/><stop offset="1" stop-color="${g[2]}"/></linearGradient>`));
LEAF_G.forEach((g, i) => defs.push(`<linearGradient id="lf${i}" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="${g[0]}"/><stop offset=".48" stop-color="${g[1]}"/><stop offset="1" stop-color="${g[2]}"/></linearGradient>`));
function leaf(x, y, ang, L, Wd, dark){
  const g = dark ? 'ld' + Math.floor(rnd() * LEAF_D.length) : 'lf' + Math.floor(rnd() * LEAF_G.length);
  const bend = R(-.25, .25) * Wd;
  const d = `M0 0 C${f(L * .25)} ${f(-Wd * 1.05 + bend)} ${f(L * .72)} ${f(-Wd * .9 + bend)} ${f(L)} ${f(bend * .6)} ` +
            `C${f(L * .72)} ${f(Wd * .85 + bend)} ${f(L * .25)} ${f(Wd * 1.0 + bend)} 0 0Z`;
  return `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(ang)})">` +
    `<path d="${d}" fill="url(#${g})"/>` +
    `<path d="M0 0 Q${f(L * .5)} ${f(bend * .6)} ${f(L * .96)} ${f(bend * .6)}" fill="none" stroke="#d9f0c4" stroke-opacity=".55" stroke-width="${f(Math.max(1, Wd * .09))}"/>` +
    `<path d="${d}" fill="none" stroke="#2c5e28" stroke-opacity=".25" stroke-width="1"/>` +
    `</g>`;
}
/* 茎に沿って葉を付ける */
function plant(baseX, baseY, stems, dir, scale, spread){
  let back = '', front = '';
  for(let i = 0; i < stems; i++){
    const len = R(260, 620) * scale;
    const a0 = (-90 + dir * R(2, spread || 55)) * Math.PI / 180;
    const cx = baseX + R(-30, 30) * scale, cy = baseY;
    const ex = cx + Math.cos(a0) * len, ey = cy + Math.sin(a0) * len;
    const mx = cx + Math.cos(a0) * len * .5 + dir * R(20, 80) * scale, my = cy + Math.sin(a0) * len * .5;
    back += `<path d="M${f(cx)} ${f(cy)} Q${f(mx)} ${f(my)} ${f(ex)} ${f(ey)}" fill="none" stroke="#4a7a3a" stroke-width="${f(4 * scale)}" stroke-linecap="round" opacity=".85"/>`;
    const n = Math.floor(R(7, 13));
    for(let k = 1; k <= n; k++){
      const t = k / n;
      const px = (1 - t) * (1 - t) * cx + 2 * (1 - t) * t * mx + t * t * ex;
      const py = (1 - t) * (1 - t) * cy + 2 * (1 - t) * t * my + t * t * ey;
      const side = k % 2 ? 1 : -1;
      const ang = a0 * 180 / Math.PI + side * R(35, 75);
      const L = R(70, 130) * scale * (1.1 - t * .35), Wd = L * R(.26, .36);
      if(rnd() < .4) back += leaf(px, py, ang, L * 1.05, Wd * 1.05, true);
      else front += leaf(px, py, ang, L, Wd, false);
    }
    front += leaf(ex, ey, a0 * 180 / Math.PI + R(-15, 15), R(80, 120) * scale, R(22, 34) * scale);
  }
  return { back, front };
}

/* ── 組み立て ── */
defs.push(`
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#7fb4ea"/><stop offset=".3" stop-color="#a9cdf1"/><stop offset=".62" stop-color="#d9e9f8"/><stop offset="1" stop-color="#f2f7fd"/></linearGradient>
  <radialGradient id="sun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="#fff" stop-opacity=".75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  <linearGradient id="haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f8fd" stop-opacity="0"/><stop offset="1" stop-color="#f4f8fd" stop-opacity=".95"/></linearGradient>
  <linearGradient id="mul" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fbfcfe"/><stop offset=".35" stop-color="#e6ecf3"/><stop offset=".8" stop-color="#cdd8e4"/><stop offset="1" stop-color="#b3c2d3"/></linearGradient>
  <linearGradient id="sill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9eef4"/><stop offset=".5" stop-color="#dfe6ee"/><stop offset="1" stop-color="#f3f6fa"/></linearGradient>
  <linearGradient id="ceil" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7f8fa"/><stop offset="1" stop-color="#e8ecf1"/></linearGradient>
  <linearGradient id="desk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9eef4"/><stop offset=".25" stop-color="#f5f8fb"/><stop offset="1" stop-color="#ffffff"/></linearGradient>
  <linearGradient id="deskRef" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfe0f3" stop-opacity=".55"/><stop offset="1" stop-color="#cfe0f3" stop-opacity="0"/></linearGradient>
  <linearGradient id="mug" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#d9e0e8"/><stop offset=".3" stop-color="#ffffff"/><stop offset=".62" stop-color="#f4f7fa"/><stop offset="1" stop-color="#c9d3de"/></linearGradient>
  <linearGradient id="pot" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#dfe5ec"/><stop offset=".35" stop-color="#fbfcfd"/><stop offset="1" stop-color="#c7d1dc"/></linearGradient>
  <linearGradient id="chair" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#b9c3cf"/><stop offset=".5" stop-color="#d3dae3"/><stop offset="1" stop-color="#aeb9c6"/></linearGradient>
  <linearGradient id="bk1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fb6d0"/><stop offset="1" stop-color="#7d97b6"/></linearGradient>
  <linearGradient id="bk2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f2f5f8"/><stop offset="1" stop-color="#dfe5ec"/></linearGradient>
  <linearGradient id="bk3" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9d4e1"/><stop offset="1" stop-color="#b2c0d1"/></linearGradient>
  <filter id="dFar" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="4.5"/></filter>
  <filter id="dMid" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="2.6"/></filter>
  <filter id="dNear" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="1.8"/></filter>
  <filter id="dRoom" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="3.2"/></filter>
  <filter id="dPlant" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="1.4"/></filter>
  <filter id="dPlantBack" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="3.4"/></filter>
  <filter id="dFg" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="9"/></filter>
  <filter id="dSoft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="14"/></filter>
  <filter id="dCloud" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="30"/></filter>
`);

let body = '';
body += `<rect width="${W}" height="${H}" fill="url(#sky)"/>`;
/* 雲 */
for(let i = 0; i < 9; i++) body += `<ellipse cx="${f(R(0, W))}" cy="${f(R(60, 300))}" rx="${f(R(120, 320))}" ry="${f(R(30, 70))}" fill="#fff" opacity="${f(R(.25, .55))}" filter="url(#dCloud)"/>`;
/* 遠くのビル → 中くらい → 近く */
const FAR = [['#c3d7ee', '#b4cbe7', '#a6c0e1'], ['#cadcf0', '#bcd1ea', '#afc7e4']];
const MID = [['#a7c3e3', '#8fb1d9', '#7a9fcd'], ['#b3cbe8', '#9bbadd', '#83a7d2'], ['#9dbbdf', '#86a9d3', '#6f95c6']];
const NEAR = [['#93b4dc', '#7a9fcf', '#6189c0'], ['#a2bfe2', '#86a9d6', '#6d93c7'], ['#8aaed9', '#7098cb', '#5a82b9']];
body += `<g filter="url(#dFar)" opacity=".85">${skyline(-40, W + 40, 250, 520, FAR, 0, -10, 20)}</g>`;
body += `<rect x="0" y="520" width="${W}" height="${HORIZON - 520}" fill="url(#haze)" opacity=".3"/>`;
body += `<g filter="url(#dMid)">${skyline(-30, W + 30, 300, 580, MID, 1, 4, 34)}</g>`;
body += `<g filter="url(#dNear)">${skyline(-20, 560, 240, 420, NEAR, 2, 30, 90)}${skyline(1400, W + 20, 230, 400, NEAR, 2, 30, 90)}</g>`;
body += `<rect x="0" y="680" width="${W}" height="${HORIZON - 680}" fill="url(#haze)" opacity=".45"/>`;
/* 窓から入る光 */
body += `<ellipse cx="880" cy="150" rx="520" ry="210" fill="url(#sun)" opacity=".62"/>`;
/* 天井と照明 */
body += `<g filter="url(#dRoom)"><rect x="0" y="-10" width="${W}" height="78" fill="url(#ceil)"/>`;
for(let i = 0; i < 5; i++){ const x = 180 + i * 390; body += `<polygon points="${x},4 ${x + 150},4 ${x + 110},46 ${x - 40},46" fill="#fff" opacity=".95"/>`; }
body += `</g>`;
/* 窓枠（立体の柱・上の枠・窓台） */
body += `<g filter="url(#dRoom)">`;
[150, 548, 1010, 1440, 1800].forEach(x => { body += `<rect x="${x}" y="60" width="34" height="${HORIZON - 40}" fill="url(#mul)"/>`; });
body += `<rect x="0" y="58" width="${W}" height="16" fill="#e4eaf1"/><rect x="0" y="72" width="${W}" height="3" fill="#cdd7e2"/>`;
body += `<rect x="0" y="${HORIZON - 6}" width="${W}" height="40" fill="url(#sill)"/><rect x="0" y="${HORIZON + 32}" width="${W}" height="4" fill="#d3dce6"/>`;
body += `</g>`;
/* ガラスの映り込み（斜めの光） */
for(let i = 0; i < 7; i++){ const x = R(100, W - 200); body += `<polygon points="${f(x)},80 ${f(x + R(40, 110))},80 ${f(x - 180)},${HORIZON} ${f(x - 250)},${HORIZON}" fill="#fff" opacity="${f(R(.04, .1))}"/>`; }
/* 光の玉（ぼけ） */
for(let i = 0; i < 22; i++) body += `<circle cx="${f(R(200, W - 200))}" cy="${f(R(90, 700))}" r="${f(R(6, 22))}" fill="#fff" opacity="${f(R(.12, .35))}" filter="url(#dSoft)"/>`;
/* 左奥の椅子の背 */
body += `<g filter="url(#dSoft)" opacity=".95"><path d="M-40 700 Q110 650 250 700 L270 1080 L-40 1080Z" fill="url(#chair)"/>` +
        `<rect x="20" y="730" width="210" height="220" rx="40" fill="#cfd7e0"/></g>`;
/* 机 */
body += `<g filter="url(#dRoom)"><path d="M-10 890 L${W + 10} 872 L${W + 10} ${H + 10} L-10 ${H + 10}Z" fill="url(#desk)"/>` +
        `<path d="M-10 890 L${W + 10} 872" stroke="#d6dee7" stroke-width="3"/>` +
        `<path d="M-10 896 L${W + 10} 878 L${W + 10} 960 L-10 980Z" fill="url(#deskRef)"/></g>`;
[150, 548, 1010, 1440].forEach(x => { body += `<rect x="${x - 10}" y="895" width="54" height="120" fill="#fff" opacity=".35" filter="url(#dSoft)"/>`; });
/* 左の観葉植物（大きい・手前） */
const pl = plant(40, 930, 15, 1, 1.35, 30);
body += `<g filter="url(#dPlantBack)" opacity=".92">${pl.back}</g><g filter="url(#dPlant)">${pl.front}</g>`;
/* 手前の大きくぼけた葉（写真の奥行き） */
body += `<g filter="url(#dFg)" opacity=".9">${leaf(-60, 1010, -38, 330, 95, false)}${leaf(-40, 1080, -12, 300, 90, true)}${leaf(40, 1100, -62, 260, 80, false)}</g>`;
/* 右の観葉植物（机の上・鉢つき） */
const pr = plant(1840, 800, 11, -1, .92, 40);
body += `<g filter="url(#dPlantBack)" opacity=".92">${pr.back}</g><g filter="url(#dPlant)">${pr.front}</g>`;
body += `<g filter="url(#dNear)"><ellipse cx="1830" cy="900" rx="110" ry="16" fill="#9aa9ba" opacity=".35" filter="url(#dSoft)"/>` +
        `<path d="M1740 790 L1920 790 L1905 895 L1755 895Z" fill="url(#pot)"/><rect x="1732" y="780" width="196" height="16" rx="6" fill="#eef2f6"/></g>`;
/* 本（右下） */
body += `<g filter="url(#dNear)">` +
  `<ellipse cx="1790" cy="1062" rx="220" ry="26" fill="#8e9db0" opacity=".35" filter="url(#dSoft)"/>` +
  `<g transform="rotate(-2.5 1790 1030)"><rect x="1600" y="1004" width="360" height="56" rx="4" fill="url(#bk1)"/><rect x="1606" y="1010" width="348" height="6" fill="#fff" opacity=".25"/></g>` +
  `<g transform="rotate(-4 1790 980)"><rect x="1620" y="956" width="330" height="50" rx="4" fill="url(#bk2)"/>` +
    `${Array.from({ length: 9 }, (_, i) => `<rect x="1624" y="${962 + i * 4.6}" width="322" height=".8" fill="#c9d2dc"/>`).join('')}</g>` +
  `<g transform="rotate(-6 1800 935)"><rect x="1640" y="912" width="300" height="46" rx="4" fill="url(#bk3)"/>` +
    `<text x="1668" y="942" font-family="Georgia,serif" font-size="17" fill="#6d7f95" opacity=".75">Learn. Grow. Make an Impact.</text></g>` +
  `</g>`;
/* マグカップ（右下） */
body += `<g filter="url(#dNear)">` +
  `<ellipse cx="1628" cy="968" rx="92" ry="16" fill="#8e9db0" opacity=".35" filter="url(#dSoft)"/>` +
  `<path d="M1680 850 C1760 846 1766 930 1684 936" fill="none" stroke="#e8edf2" stroke-width="18"/>` +
  `<path d="M1680 850 C1760 846 1766 930 1684 936" fill="none" stroke="#c8d2dd" stroke-width="4" opacity=".6"/>` +
  `<path d="M1548 824 L1708 824 L1698 950 Q1628 972 1558 950Z" fill="url(#mug)"/>` +
  `<ellipse cx="1628" cy="824" rx="80" ry="15" fill="#f6f8fb"/><ellipse cx="1628" cy="826" rx="70" ry="11" fill="#8b6a4f"/>` +
  `<ellipse cx="1612" cy="824" rx="30" ry="4" fill="#b99576" opacity=".6"/>` +
  `</g>`;
/* 全体の空気感（ごく薄い白と、四隅のわずかな影） */
defs.push(`<radialGradient id="vig" cx=".5" cy=".45" r=".75"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#26405f" stop-opacity=".12"/></radialGradient>`);
body += `<rect width="${W}" height="${H}" fill="#f2f7ff" opacity=".06"/><rect width="${W}" height="${H}" fill="url(#vig)"/>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs.join('')}</defs>${body}</svg>`;
const uri = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
/* 窓の光のにじみ（明るいところをぼかして重ねる）と、細かい粒子 */
const grain = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>`;
const html = `<html><body style="margin:0;background:#fff">
<div style="position:relative;width:${W}px;height:${H}px;overflow:hidden">
  <img src="${uri}" style="position:absolute;inset:0;width:100%;height:100%">
  <img src="${uri}" style="position:absolute;inset:0;width:100%;height:100%;filter:blur(24px) brightness(1.1) saturate(1.15);opacity:.24;mix-blend-mode:screen">
  <img src="data:image/svg+xml;base64,${Buffer.from(grain).toString('base64')}" style="position:absolute;inset:0;width:100%;height:100%;opacity:.045;mix-blend-mode:soft-light">
</div></body></html>`;
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const p = await b.newPage({ viewport:{ width:W, height:H }, deviceScaleFactor:1.5 });
  await p.setContent(html);
  await p.waitForTimeout(800);
  await p.screenshot({ path: process.argv[2], type:'jpeg', quality:88 });
  await b.close();
  console.log('ok', fs.statSync(process.argv[2]).size);
})();
