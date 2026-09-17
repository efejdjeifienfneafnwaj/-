/* 自動リマインド：未修了の人の行が Creator の表に用意され、修了したら「送らない」になること */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const serveAsset = require('./_部品を返す');

const html = fs.readFileSync(path.join(__dirname, '..', 'lms-widget', 'app', 'widget.html'), 'utf8');
let ok = 0, ng = 0;
function check(name, cond, extra){
  if(cond){ ok++; console.log('  ✅ ' + name); }
  else    { ng++; console.log('  ❌ ' + name + (extra ? '　（' + extra + '）' : '')); }
}
function stub(email){
  return ({ email }) => {
    const call = (m, q) => fetch('/__api', { method:'POST', headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ method:m, q }) }).then(r => r.json());
    window.ZOHO = { CREATOR: { UTIL: { getInitParams: () => Promise.resolve({ loginUser: email }) },
      DATA: { getRecords: q => call('getRecords', q), addRecords: q => call('addRecords', q),
        updateRecordById: q => call('updateRecordById', q), updateRecords: q => call('updateRecords', q),
        deleteRecordById: q => call('deleteRecordById', q),
        getRecordCount: () => Promise.resolve({ code:3000, result:{ records_count:0 } }) } } };
  };
}
const COURSE = { id:'c1', cat:'その他', title:'避難訓練研修', required:true, passRate:0.8, deadline:'2026-12-31',
  cycle:'yearly', assign:{ rules:[{ mode:'all', targets:[] }] }, desc:'',
  chapters:[{ id:'c1v1', title:'第1章', videoId:'abc', dur:60 }], quiz:[] };
const ROSTER = [
  { person_key:'田中 一郎', person_name:'田中 一郎', email:'owner@example.com', dept:'事務', role:'admin' },
  { person_key:'佐藤 花子', person_name:'佐藤 花子', email:'hana@example.com', dept:'介護職', role:'learner' },
  { person_key:'鈴木 次郎', person_name:'鈴木 次郎', email:'', dept:'介護職', role:'learner' }
];
(async () => {
  const DB = { Lms_Person: ROSTER.map((p, i) => Object.assign({ ID:String(100+i) }, p)),
               Lms_Course: [{ ID:'1', course_json: JSON.stringify([COURSE]), config_json: '{}' }] };
  let seq = 1000; const tbl = n => String(n).replace(/_(Report|Form)$/, '');
  function api(method, q){
    if(method === 'getRecords'){
      let rows = (DB[tbl(q.report_name)] || []).slice(); const conds = [];
      String(q.criteria || '').replace(/([A-Za-z_][A-Za-z0-9_]*)\s*==\s*"([^"]*)"/g, (m, f, v) => { conds.push([f, v]); return m; });
      if(conds.length) rows = rows.filter(r => conds.every(c => String(r[c[0]] || '') === c[1]));
      if(!rows.length) return { code:3100 }; return { code:3000, data:rows };
    }
    if(method === 'addRecords'){ const k = tbl(q.form_name); DB[k] = DB[k] || [];
      const r = Object.assign({}, q.payload.data, { ID:String(++seq) }); DB[k].push(r); return { code:3000, data:{ ID:r.ID } }; }
    if(method === 'updateRecordById'){ const a = DB[tbl(q.report_name)] || [];
      const r = a.filter(x => String(x.ID) === String(q.id))[0]; if(r) Object.assign(r, q.payload.data); return { code:3000 }; }
    return { code:3000 };
  }
  const srv = http.createServer((q, s) => {
    if(q.url === '/__api'){ let b = ''; q.on('data', c => { b += c; }); q.on('end', () => {
      let out; try{ const j = JSON.parse(b); out = api(j.method, j.q); } catch(e){ out = { code:3000 }; }
      s.writeHead(200, { 'Content-Type':'application/json' }); s.end(JSON.stringify(out)); }); return; }
    if(serveAsset(q, s)) return;
    s.writeHead(200, { 'Content-Type':'text/html; charset=utf-8' }); s.end(html);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const errs = [];
  async function open(email, app){
    const ctx = await browser.newContext({ viewport:{ width:1280, height:900 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(String(e)));
    await page.addInitScript(stub(email), { email });
    await page.goto(base);
    await page.waitForSelector('#gate [data-app="' + app + '"]');
    await page.click('#gate [data-app="' + app + '"]');
    await page.waitForSelector('#app.on'); await page.waitForTimeout(400);
    return page;
  }
  const drained = p => p.waitForFunction(() => Object.keys(SYNC.pend).length === 0, null, { timeout:20000 });
  const rows = () => DB.Lms_Remind || [];

  console.log('① 管理者が受講者の状況を開くと、未修了の人の行ができること');
  const owner = await open('owner@example.com', 'lms');
  await owner.evaluate(() => route('ausers'));
  await owner.waitForTimeout(800);
  await drained(owner);
  const hana = rows().filter(r => r.person_name === '佐藤 花子')[0];
  check('佐藤さんの行ができた', !!hana);
  check('送る印が付いている', hana && hana.active === 'true');
  check('宛先はメールアドレス', hana && hana.email === 'hana@example.com');
  check('本文に名前と研修名が入っている', hana && /佐藤 花子 さん/.test(hana.mail_body) && /避難訓練研修/.test(hana.mail_body));
  check('本文に期限が入っている', hana && /2026-12-31/.test(hana.mail_body));
  check('件名が入っている', hana && hana.mail_subject === '【研修】未修了の研修のご案内');
  check('メールアドレスの無い人の行は作らない', !rows().some(r => r.person_name === '鈴木 次郎'));
  check('同じ日にもう一度開いても送り直さない',
    await owner.evaluate(() => { const b = Object.keys(SYNC.pend).length; refreshAllRemindsDaily(); return Object.keys(SYNC.pend).length === b; }));

  console.log('② 本人が受講し終えると、自分の行が「送らない」になること');
  const hanaP = await open('hana@example.com', 'lms');
  await hanaP.evaluate(() => {
    const co = courses()[0];
    putRec('佐藤 花子', 'c1v1', { dur:60, ranges:[[0, 60]], pos:60, fast:false }, termFor(co));
    pushRemindSelf();
  });
  await hanaP.waitForTimeout(2600);
  await drained(hanaP);
  const hana2 = rows().filter(r => r.person_name === '佐藤 花子')[0];
  check('修了したら送らない', hana2 && hana2.active === 'false', hana2 && hana2.active);
  check('未修了の数が0', hana2 && String(hana2.pending_count) === '0');
  check('行は増えていない（1人1行）', rows().filter(r => r.person_name === '佐藤 花子').length === 1);

  console.log('③ 設定で止めると、全員「送らない」になること');
  await owner.evaluate(() => route('asettings'));
  await owner.waitForSelector('#rmOn');
  check('設定に件名と本文の欄がある', (await owner.$('#rmSub')) !== null && (await owner.$('#rmBody')) !== null);
  await owner.uncheck('#rmOn');
  await owner.click('#rmSave');
  await owner.waitForTimeout(500);
  await drained(owner);
  check('管理者本人の行も送らない', rows().every(r => r.active === 'false'));
  check('設定に残っている', await owner.evaluate(() => config().remindOn === false));

  console.log('④ 文面を変えると、行の本文も変わること');
  await owner.check('#rmOn');
  await owner.fill('#rmBody', '{name} さん、{count} 件の研修が未修了です。\n{list}');
  await owner.click('#rmSave');
  await owner.waitForTimeout(500);
  await drained(owner);
  const tanaka = rows().filter(r => r.person_name === '田中 一郎')[0];
  check('新しい文面で送る印', tanaka && tanaka.active === 'true' && /田中 一郎 さん、1 件の研修/.test(tanaka.mail_body), tanaka && tanaka.mail_body);

  check('画面のエラーが出ていない（' + errs.join(' / ') + '）', errs.length === 0);
  await browser.close(); srv.close();
  console.log('\n合格 ' + ok + ' 件 / 不合格 ' + ng + ' 件');
  process.exit(ng ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
