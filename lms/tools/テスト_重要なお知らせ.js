/* 重要なお知らせ：宛先の選び方・メールの依頼（Lms_Mail）・どのアプリでも出る赤い帯・
   「確認しました」・確認していない人への再送・テストメール を確かめる。
   Creator のワークフロー（行が増えたら送る）は、このテストのサーバーがまねる */
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
  { person_key:'佐藤 花子', person_name:'佐藤 花子', email:'hana@example.com', dept:'介護職', role:'learner',
    notify_email:'hana.phone@example.jp' },
  { person_key:'鈴木 次郎', person_name:'鈴木 次郎', email:'jiro@example.com', dept:'介護職', role:'learner' },
  { person_key:'高橋 三郎', person_name:'高橋 三郎', email:'', dept:'介護職', role:'learner' }
];
const SENT = [];      /* ワークフローが送ったメール */
let WORKFLOW = true;  /* false にすると、ワークフローが動いていない Creator をまねる */
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
      const r = Object.assign({}, q.payload.data, { ID:String(++seq) }); DB[k].push(r);
      if(k === 'Lms_Mail' && WORKFLOW){
        /* ワークフロー「レコードの作成時」：1人ずつ送り、送った印を付ける */
        r._payloadKeys = Object.keys(q.payload.data).join(',');
        const to = String(r.to_list || '').split(',').map(x => x.trim()).filter(x => /@/.test(x));
        to.forEach(a => SENT.push({ to:a, subject:r.mail_subject, body:r.mail_body }));
        r.status = '送信済み'; r.sent_count = to.length; r.sent_at = '2026-09-25 10:00:00';
      }
      return { code:3000, data:{ ID:r.ID } }; }
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

  const pages = [];
  async function openIn(email, app){ const pg = await open(email, app); pg.on('dialog', d => d.accept()); pages.push(pg); return pg; }
  const mails = () => DB.Lms_Mail || [];

  console.log('① 管理者が「重要」で配信する');
  const boss = await openIn('owner@example.com', 'lms');
  await boss.evaluate(() => route('anews'));
  await boss.waitForSelector('#nwImp');
  await boss.fill('#nwT', '台風接近のため明日は臨時休業です');
  await boss.fill('#nwB', '利用者さまへの連絡は各事業所の管理者が行います。');
  await boss.selectOption('#nwG', '介護職');
  await boss.check('#nwImp');
  const toText = await boss.$eval('#nwTo', e => e.textContent);
  check('メールが届く人数が出る（介護職でメールがある2名）', /メールが届く方：2名/.test(toText), toText);
  check('メールアドレスの無い方の名前が出る', /高橋 三郎/.test(toText));
  await boss.click('#nwGo');
  await boss.waitForTimeout(3000);
  const nw = (DB.Lms_News || [])[0] || {};
  check('お知らせに important = true が入る', nw.important === 'true', JSON.stringify(nw));
  const m1 = mails()[0] || {};
  check('Lms_Mail に1行入る', mails().length === 1);
  check('宛先は配信先の職種の人だけ（事務の管理者は入らない）', !/owner@/.test(m1.to_list || ''), m1.to_list);
  check('プロフィールのスマホ用アドレスがあれば、そちらに送る',
    /hana\.phone@example\.jp/.test(m1.to_list || '') && !/hana@example\.com/.test(m1.to_list || ''), m1.to_list);
  check('名簿のアドレスの人にも送る', /jiro@example\.com/.test(m1.to_list || ''));
  check('人数（to_count）が 2', Number(m1.to_count) === 2);
  check('件名は【重要】で始まる', /^【重要】台風接近/.test(m1.mail_subject || ''));
  check('本文にお知らせの本文が入る', /各事業所の管理者/.test(m1.mail_body || ''));
  check('送った印（status・sent_at）はウィジェットから送らない', !/status|sent_at|sent_count/.test(m1._payloadKeys || ''), m1._payloadKeys);
  check('ワークフローが 2 通送った', SENT.length === 2);
  await boss.click('#nwReload');
  await boss.waitForTimeout(1500);
  const rowText = await boss.$eval('tr.imp-row', e => e.textContent);
  check('管理画面に「送信済み 2通」', /送信済み 2通/.test(rowText), rowText);
  check('確認は 0 / 3名', /0 \/ 3名/.test(rowText));
  check('配信した人にも帯は出ない（対象外）', await boss.$eval('#alertBar', e => e.hidden));

  console.log('② どのアプリでも赤い帯が出る');
  const hana = await openIn('hana@example.com', 'connect');
  await hana.waitForSelector('#alertBar:not([hidden])', { timeout:5000 }).catch(() => {});
  check('社内コミュニティで帯が出る', await hana.$eval('#alertBar', e => !e.hidden && /台風接近/.test(e.textContent)));
  await hana.click('#abMore');
  check('「内容を見る」で本文が出る', await hana.$eval('#alertBar', e => /各事業所の管理者/.test(e.textContent)));
  await hana.evaluate(() => route('members'));
  await hana.waitForTimeout(200);
  check('画面を移っても帯は残る', await hana.$eval('#alertBar', e => !e.hidden));
  await hana.click('#abOk');
  await hana.waitForTimeout(2600);
  check('「確認しました」で帯が消える', await hana.$eval('#alertBar', e => e.hidden));
  const ack = (DB.Lms_React || []).filter(r => r.kind === 'ack')[0] || {};
  check('確認した印が Lms_React に入る', ack.person_name === '佐藤 花子' && ack.post_key === nw.news_key, JSON.stringify(ack));
  const jiro = await openIn('jiro@example.com', 'shinsei');
  await jiro.waitForTimeout(800);
  check('社内申請を開いていても帯が出る', await jiro.$eval('#alertBar', e => !e.hidden && /台風接近/.test(e.textContent)));
  if(process.env.SHOT) await jiro.screenshot({ path: process.env.SHOT + '/alert_shinsei.png' });

  console.log('③ 確認していない人にだけ送り直す');
  await boss.click('#nwReload');
  await boss.waitForTimeout(1500);
  check('確認は 1 / 3名', /1 \/ 3名/.test(await boss.$eval('tr.imp-row', e => e.textContent)));
  if(!(await boss.$('tr.imp-open'))) await boss.click('[data-nopen]');
  const open1 = await boss.$eval('tr.imp-open', e => e.textContent);
  check('まだ確認していない方に鈴木・高橋', /鈴木 次郎/.test(open1) && /高橋 三郎/.test(open1) && !/佐藤 花子/.test(open1.split('メールの依頼')[0]));
  check('メールの無い方の名前を知らせる', /送れない方：高橋 三郎/.test(open1));
  if(process.env.SHOT) await boss.screenshot({ path: process.env.SHOT + '/anews.png', fullPage:true });
  await boss.click('[data-nresend]');
  await boss.waitForTimeout(3000);
  const m2 = mails()[1] || {};
  check('再送の行は確認していない人だけ（鈴木）', m2.to_list === 'jiro@example.com' && m2.kind === 'resend', JSON.stringify(m2));

  console.log('④ テストメール');
  await boss.evaluate(() => route('asettings'));
  await boss.waitForSelector('#mlUrl');
  await boss.fill('#mlUrl', 'javascript:alert(1)');
  await boss.click('#mlSave');
  check('https 以外の URL は保存しない', await boss.evaluate(() => !config().portalUrl));
  await boss.fill('#mlUrl', 'https://example.zohocreatorportal.jp/');
  await boss.click('#mlSave');
  await boss.waitForSelector('#mlTest');
  await boss.click('#mlTest');
  await boss.waitForTimeout(3000);
  const m3 = mails()[2] || {};
  check('テストメールは自分あて', m3.kind === 'test' && m3.to_list === 'owner@example.com', JSON.stringify(m3));
  check('本文にポータルの URL が入る', /https:\/\/example\.zohocreatorportal\.jp\//.test(m3.mail_body || ''));
  await boss.waitForSelector('#mlState');
  check('設定画面に送信済みと出る', /送信済み 1通/.test(await boss.$eval('#mlState', e => e.textContent)));

  console.log('⑤ ワークフローが動いていないとき');
  const warn = await boss.evaluate(() => mailState({ id:'x', at:new Date(Date.now() - 10 * 60000).toISOString(), count:3 }));
  check('5分たっても送られていなければ警告', warn.warn === true && /送信待ちのまま/.test(warn.t), JSON.stringify(warn));

  console.log('⑥ 普通のお知らせ');
  await boss.evaluate(() => route('anews'));
  await boss.waitForSelector('#nwT');
  await boss.fill('#nwT', '研修のご案内');
  await boss.click('#nwGo');
  await boss.waitForTimeout(2600);
  const plain = (DB.Lms_News || []).filter(r => r.title === '研修のご案内')[0] || {};
  check('普通のお知らせには important を送らない（項目の無い Creator でも出せる）', plain.news_key && plain.important === undefined, JSON.stringify(plain));
  check('普通のお知らせではメールを頼まない', mails().length === 3);
  await hana.evaluate(() => { APP_NOW = 'lms'; route('mynews'); });
  await hana.waitForTimeout(300);
  check('受講者のお知らせ一覧に「重要」と「確認済み」', await hana.$eval('#main', e => /重要/.test(e.textContent) && /確認済み/.test(e.textContent)).catch(() => false));

  check('画面のエラーが出ていない（' + errs.join(' / ') + '）', errs.length === 0);
  await browser.close();
  srv.close();
  console.log('\n合格 ' + ok + ' 件 / 不合格 ' + ng + ' 件');
  process.exit(ng ? 1 : 0);
})();
