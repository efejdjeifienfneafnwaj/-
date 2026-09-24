// 送迎メニュー.gs の「配車の計算」が、配車ロジック.py と同じ結果を出すかを確かめる。
// 架空のデータをランダムに作り、両方で動かして出力を1行ずつ比べる。
//   使い方：  node tools/python版と比べる.js [件数]
// 遅れの損（LATE_WEIGHT）は Python版に無いので、比べるときは 0 にする。
const fs = require('fs'), vm = require('vm'), cp = require('child_process'), path = require('path');
const dir = path.join(__dirname, '..');
const ctx = { Object }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(dir, '送迎メニュー.gs'), 'utf8'), ctx);
const logic = fs.readFileSync(path.join(dir, '配車ロジック.py'), 'utf8');
const marker = logic.split('\n').find(l => l.includes('ここから下はロジック'));

const py = s => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
const pv = v => v === null ? 'None' : v === true ? 'True' : v === false ? 'False' :
  typeof v === 'string' ? py(v) : Array.isArray(v) ? '(' + v.join(', ') + ')' : String(v);
const dict = o => '{' + Object.entries(o).map(([k, v]) => py(k) + ': ' + pv(v)).join(', ') + '}';
function pySource(c) {
  return 'CONFIG = ' + dict(c.cfg) + '\nVEHICLES = [' + c.veh.map(dict).join(',\n') + ']\n' +
    'USERS = [' + c.users.map(dict).join(',\n') + ']\n' +
    'OFF_VEHICLES = ' + JSON.stringify(c.offV) + '\nOFF_USERS = ' + JSON.stringify(c.offU) + '\n' +
    'REAL = {' + Object.entries(c.real).map(([k, v]) => { const [a, b] = k.split('\u0000'); return '(' + py(a) + ', ' + py(b) + '): ' + v; }).join(',\n') + '}\n';
}
// 「注意」の並びは Python の set の順で毎回変わるので、並べ替えてから比べる
function norm(t) {
  const L = t.replace(/\n+$/, '').split('\n'), i = L.indexOf('── 注意 ──');
  if (i < 0) return L;
  let j = i + 1; while (j < L.length && L[j].startsWith('　')) j++;
  return L.slice(0, i + 1).concat(L.slice(i + 1, j).sort(), L.slice(j));
}

let s = 20260924;
const R = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
const ri = (a, b) => a + Math.floor(R() * (b - a + 1));
const N = Number(process.argv[2] || 40);
let bad = 0;
for (let n = 0; n < N; n++) {
  const mode = R() < 0.6 ? '介護' : '放デイ';
  const fac = [+(34.70 + R() * 0.03).toFixed(4), +(136.88 + R() * 0.05).toFixed(4)];
  const veh = [];
  for (let i = 0; i < ri(1, 4); i++) veh.push({ name: (i + 1) + '号車', cap: ri(2, 8), wc_max: ri(0, 2), wc_seats: ri(1, 2), walker_max: R() < 0.4 ? null : ri(0, 2) });
  const nu = ri(1, 20), addrs = [];
  for (let i = 0; i < ri(1, nu); i++) addrs.push({ a: '町' + i + '-' + ri(1, 9), p: [+(34.70 + R() * 0.04).toFixed(4), +(136.87 + R() * 0.07).toFixed(4)] });
  const users = [];
  for (let i = 0; i < nu; i++) {
    const A = addrs[ri(0, addrs.length - 1)];
    const tg = R() < (mode === '介護' ? 0.25 : 0.9) ? ri(8, 16) + ':' + String(ri(0, 11) * 5).padStart(2, '0') : '';
    users.push({ name: '利用者' + i, addr: A.a, pos: A.p, mob: R() < 0.2 ? 'wc' : R() < 0.2 ? 'walker' : '', target: tg, note: '' });
  }
  const real = {}, all = [{ a: '事業所', p: fac }].concat(addrs);
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (R() < 0.5) real[all[i].a + '\u0000' + all[j].a] = ri(1, 25);
  const c = { cfg: { mode, trip: 'お迎え', facility: '事業所', facility_name: '', fac_pos: fac, depart: '9:00', auto_depart: null,
                     stop: ri(3, 10), turn: 5, factor: 3.0, use_run2: R() < 0.8, seed: 0, late_weight: 0 },
              veh, users, real: R() < 0.15 ? {} : real, offV: R() < 0.2 ? ['1号車'] : [], offU: R() < 0.2 ? ['利用者0'] : [] };
  const js = ctx.配車する_(c.cfg, c.veh, c.users, c.real, c.offV, c.offU).join('\n');
  const out = cp.execFileSync('python3', ['-'], { input: logic.replace(marker, pySource(c) + marker), encoding: 'utf8' });
  const a = norm(out), b = norm(js);
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    bad++;
    const k = a.findIndex((x, i) => x !== b[i]);
    console.log('不一致 ' + n + ' 行' + k + '\n  py: ' + a[k] + '\n  js: ' + b[k]);
  }
}
console.log(N + '件中 不一致 ' + bad + '件');
process.exit(bad ? 1 : 0);
