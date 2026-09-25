/* プロフィールの詳しい項目（資格・スキル・趣味・わたしのこと・通知先）と、
   メンバー一覧での絞り込み・1人のプロフィールを確かめる */
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

  const SHOT = process.env.SHOT || '';
  const person = n => DB.Lms_Person.filter(r => r.person_key === n)[0] || {};
  const mon = new Date().getMonth() + 1;

  console.log('① 資格・スキル・趣味をタグで足せる');
  const hana = await open('hana@example.com', 'connect');
  await hana.evaluate(() => route('profile'));
  await hana.waitForSelector('#pfA_quals');
  await hana.fill('#pfA_quals', '介護福祉士');
  await hana.press('#pfA_quals', 'Enter');
  await hana.fill('#pfA_quals', '普通自動車免許');
  await hana.click('#pfB_quals');
  await hana.fill('#pfA_hobbies', '登山、キャンプ');
  await hana.press('#pfA_hobbies', 'Enter');
  await hana.fill('#pfA_skills', 'レクリエーション');
  await hana.press('#pfA_skills', 'Enter');
  check('資格のタグが2つ並ぶ', (await hana.$$eval('#pfL_quals .ptag', e => e.length)) === 2);
  check('「、」区切りで趣味が2つ入る', (await hana.$$eval('#pfL_hobbies .ptag', e => e.map(x => x.textContent).join('|'))) === '登山|キャンプ');
  check('候補（datalist）に福祉の資格が出る',
    await hana.$$eval('#pfD_quals option', e => e.some(o => o.value === '保育士')));
  /* 同じものは二重に入らない */
  await hana.fill('#pfA_quals', '介護福祉士');
  await hana.press('#pfA_quals', 'Enter');
  check('同じ資格は二重に入らない', (await hana.$$eval('#pfL_quals .ptag', e => e.length)) === 2);

  console.log('② わたしのこと・誕生日・通知先');
  await hana.fill('#pfT_hometown', '千葉県東金市');
  await hana.fill('#pfT_now', 'パン屋めぐり');
  await hana.fill('#pfT_career', '2019年 入社\n2023年〜 児童発達支援');
  await hana.selectOption('#pfBm', String(mon));
  await hana.selectOption('#pfBd', '15');
  /* タグを足しても、書きかけの文字は消えない */
  await hana.fill('#pfA_skills', '手話');
  await hana.press('#pfA_skills', 'Enter');
  check('タグを足しても書きかけの出身地が消えない', (await hana.$eval('#pfT_hometown', e => e.value)) === '千葉県東金市');
  await hana.fill('#pfNotify', 'hana-phone');
  await hana.click('#pfSave');
  await hana.waitForTimeout(300);
  check('形の違うメールアドレスは保存しない', !person('佐藤 花子').notify_email && !person('佐藤 花子').prof_json);
  await hana.fill('#pfNotify', 'hana.phone@example.jp');
  await hana.click('#pfSave');
  await hana.waitForTimeout(2600);
  const row = person('佐藤 花子');
  let pj = {}; try{ pj = JSON.parse(row.prof_json || '{}'); }catch(e){}
  check('Creator の名簿に prof_json が入る', Array.isArray(pj.quals) && pj.quals.join('|') === '介護福祉士|普通自動車免許', row.prof_json);
  check('趣味・スキルも入る', (pj.hobbies || []).join('|') === '登山|キャンプ' && (pj.skills || []).join('|') === 'レクリエーション|手話');
  check('出身地・経歴・誕生日も入る', pj.hometown === '千葉県東金市' && /児童発達支援/.test(pj.career || '') &&
    pj.bday === ('0' + mon).slice(-2) + '-15', JSON.stringify(pj));
  check('通知を受け取るメールアドレスが入る', row.notify_email === 'hana.phone@example.jp');
  if(SHOT) await hana.screenshot({ path: SHOT + '/prof_edit.png', fullPage:true });

  console.log('③ メンバー一覧（別の人が開き直す）');
  const boss = await open('owner@example.com', 'connect');
  await boss.evaluate(() => route('members'));
  await boss.waitForSelector('.members');
  check('カードに資格・趣味のタグが出る',
    await boss.$$eval('.mem', els => els.some(e => /介護福祉士/.test(e.textContent) && /登山/.test(e.textContent))));
  check('今月生まれの方に出る', await boss.$eval('.mem-bday', e => /佐藤 花子/.test(e.textContent) && /15日/.test(e.textContent)).catch(() => false));
  if(SHOT) await boss.screenshot({ path: SHOT + '/members.png', fullPage:true });
  await boss.fill('#memQ', 'キャンプ');
  await boss.waitForTimeout(500);
  check('趣味の言葉で探せる', (await boss.$$eval('.mem', e => e.length)) === 1);
  await boss.fill('#memQ', '');
  await boss.waitForTimeout(500);
  await boss.click('.mem [data-tag="quals"][data-tv="介護福祉士"]');
  await boss.waitForTimeout(200);
  check('タグを押すと同じ資格の人だけになる', (await boss.$$eval('.mem', e => e.length)) === 1 &&
    (await boss.$('#memTagX')) !== null);
  await boss.click('#memTagX');
  await boss.click('[data-mtab="tags"]');
  await boss.waitForSelector('.tagrow');
  check('資格ごとの人数と名前が出る', await boss.$$eval('.tagrow', els => els.some(e => /介護福祉士/.test(e.textContent) && /1名/.test(e.textContent) && /佐藤 花子/.test(e.textContent))));
  if(SHOT) await boss.screenshot({ path: SHOT + '/members_tags.png', fullPage:true });
  await boss.click('.tagrow [data-mem="佐藤 花子"]');
  await boss.waitForSelector('.psheet-h');
  const sheet = await boss.$eval('#main', e => e.textContent);
  check('1人のプロフィールに出身地・経歴・今ハマっていること', /千葉県東金市/.test(sheet) && /児童発達支援/.test(sheet) && /パン屋めぐり/.test(sheet));
  check('ほかの人のプロフィールには「サンクスカードを送る」', (await boss.$('#memThanks')) !== null);
  check('通知先のメールアドレスは他の人に見せない', !/hana\.phone@example\.jp/.test(sheet));
  if(SHOT) await boss.screenshot({ path: SHOT + '/member_sheet.png', fullPage:true });
  await boss.click('#memThanks');
  await boss.waitForTimeout(400);
  check('サンクスカードの宛先に選ばれた状態で開く', await boss.evaluate(() => VIEW_NOW === 'thanks' && FEED.to === '佐藤 花子'));

  console.log('④ 外す・空にする');
  await hana.evaluate(() => route('profile'));
  await hana.waitForSelector('#pfL_quals');
  await hana.click('#pfL_quals [data-tdel="quals"][data-ti="1"]');
  await hana.fill('#pfNotify', '');
  await hana.click('#pfSave');
  await hana.waitForTimeout(2600);
  const row2 = person('佐藤 花子');
  let pj2 = {}; try{ pj2 = JSON.parse(row2.prof_json || '{}'); }catch(e){}
  check('外した資格は Creator からも消える', (pj2.quals || []).join('|') === '介護福祉士', row2.prof_json);
  check('通知先を空にすると Creator でも空になる', row2.notify_email === '', JSON.stringify(row2.notify_email));

  check('画面のエラーが出ていない（' + errs.join(' / ') + '）', errs.length === 0);
  await browser.close();
  srv.close();
  console.log('\n合格 ' + ok + ' 件 / 不合格 ' + ng + ' 件');
  process.exit(ng ? 1 : 0);
})();
