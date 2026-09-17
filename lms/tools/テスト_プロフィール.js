/* 顔写真と自己紹介（プロフィール）と、メンバー一覧を確かめる */
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
const ROSTER = [
  { person_key:'田中 一郎', person_name:'田中 一郎', email:'owner@example.com', dept:'事務', title:'部長', role:'admin' },
  { person_key:'佐藤 花子', person_name:'佐藤 花子', email:'hana@example.com', dept:'介護職', role:'learner' }
];
(async () => {
  const DB = { Lms_Person: ROSTER.map((p, i) => Object.assign({ ID:String(100+i) }, p)) };
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

  console.log('① プロフィール画面で写真と自己紹介を保存できること');
  const hana = await open('hana@example.com', 'lms');
  await hana.evaluate(() => route('profile'));
  await hana.waitForSelector('#pfBio');
  check('写真が無いときは頭文字が出る', (await hana.$eval('.prof-photo', e => e.textContent.trim())) === '佐');
  /* 画像ファイルを選んだのと同じ結果を作る（正方形に縮めた JPEG のデータURI） */
  const uri = await hana.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 400; c.height = 300;
    const g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, 400, 300);
    return c.toDataURL('image/png');
  });
  await hana.setInputFiles('#pfFile', { name:'me.png', mimeType:'image/png',
    buffer: Buffer.from(uri.split(',')[1], 'base64') });
  await hana.waitForTimeout(600);
  check('選んだ写真が丸く出る', (await hana.$('.prof-photo img')) !== null);
  const w = await hana.evaluate(() => new Promise(res => { const i = new Image(); i.onload = () => res(i.width + 'x' + i.height); i.src = PROF.photo; }));
  check('正方形に小さくなっている（' + w + '）', w === '128x128');
  check('JPEG になっている', await hana.evaluate(() => /^data:image\/jpeg;base64,/.test(PROF.photo)));
  await hana.fill('#pfBio', '介護職3年目です。趣味は登山。');
  await hana.click('#pfSave');
  await hana.waitForTimeout(300);
  check('名簿に写真が入った', await hana.evaluate(() => !!people()['佐藤 花子'].photo));
  check('名簿に自己紹介が入った', await hana.evaluate(() => people()['佐藤 花子'].bio) === '介護職3年目です。趣味は登山。');
  const size = await hana.evaluate(() => people()['佐藤 花子'].photo.length);
  check('写真は小さい（' + Math.round(size / 1024) + 'KB）', size < 20000);
  await hana.waitForFunction(() => Object.keys(SYNC.pend).length === 0, null, { timeout:15000 });
  const row = DB.Lms_Person.filter(r => r.person_name === '佐藤 花子')[0];
  check('Creator の名簿に写真が送られた', !!row.photo && row.photo.indexOf('data:image/jpeg') === 0);
  check('Creator の名簿に自己紹介が送られた', row.profile === '介護職3年目です。趣味は登山。');
  const other = DB.Lms_Person.filter(r => r.person_name === '田中 一郎')[0];
  check('写真を設定していない人の行には photo を送っていない', !('photo' in other));
  check('端末の控えには写真を入れない',
    await hana.evaluate(() => !(JSON.parse(localStorage.getItem('lms_people') || '{}')['佐藤 花子'] || {}).photo));
  check('上の帯のアイコンも写真になる', (await hana.$('#topAva img')) !== null);

  console.log('② メンバー一覧に顔と自己紹介が並ぶこと');
  const owner = await open('owner@example.com', 'connect');
  await owner.evaluate(() => route('members'));
  await owner.waitForSelector('.mem');
  check('2人並ぶ', (await owner.$$('.mem')).length === 2);
  check('佐藤さんは写真', (await owner.$$eval('.mem', els => els.filter(e => /佐藤/.test(e.textContent) && e.querySelector('img')).length)) === 1);
  check('自己紹介が出る', (await owner.$eval('.members', e => e.textContent)).indexOf('趣味は登山') >= 0);
  await owner.fill('#memQ', '登山');
  await owner.waitForTimeout(400);
  check('自己紹介でも探せる', (await owner.$$('.mem')).length === 1);

  console.log('③ 掲示板の投稿にも写真が出ること');
  await owner.evaluate(() => { putPost({ kind:'post', by:'佐藤 花子', body:'テスト' }); route('feed'); });
  await owner.waitForSelector('.fd-card');
  check('投稿者の顔が写真', (await owner.$('.fd-card .fd-head .ava img')) !== null);

  console.log('④ 写真を消せること');
  await hana.evaluate(() => route('profile'));
  await hana.waitForSelector('#pfClear');
  await hana.click('#pfClear'); await hana.waitForTimeout(200);
  await hana.click('#pfSave'); await hana.waitForTimeout(300);
  check('名簿から写真が消えた', await hana.evaluate(() => !people()['佐藤 花子'].photo));

  check('画面のエラーが出ていない（' + errs.join(' / ') + '）', errs.length === 0);
  await browser.close(); srv.close();
  console.log('\n合格 ' + ok + ' 件 / 不合格 ' + ng + ' 件');
  process.exit(ng ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
