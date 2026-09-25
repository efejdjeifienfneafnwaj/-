/* 社内コミュニティのチャット：部屋（全員・職種・管理者が作る部屋）、発言と読み込み、
   ほかの人に届くこと、未読の数、消す、前の月を読む、見られる部屋の出し分けを確かめる */
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
  { person_key:'佐藤 花子', person_name:'佐藤 花子', email:'hana@example.com', dept:'介護職', role:'learner' },
  { person_key:'鈴木 次郎', person_name:'鈴木 次郎', email:'jiro@example.com', dept:'介護職', role:'learner' },
  { person_key:'山田 三郎', person_name:'山田 三郎', email:'yamada@example.com', dept:'事務', role:'learner' }
];
/* 3か月前の発言（「前の月を読む」の確かめ用） */
const OLD = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 2); d.setHours(10);
  return { at:d.toISOString(), m:d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) }; })();
(async () => {
  const DB = { Lms_Person: ROSTER.map((p, i) => Object.assign({ ID:String(100+i) }, p)),
    Lms_Chat: [{ ID:'90', chat_key:'c-old', room:'all', chat_month:OLD.m, person_name:'鈴木 次郎',
                 body:'むかしの発言です', posted_at:OLD.at, deleted:'' }] };
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

  const pages = [];
  async function openIn(email){
    const pg = await open(email, 'connect'); pg.on('dialog', d => d.accept()); pages.push(pg);
    await pg.evaluate(() => { CHAT_EVERY = 400; });
    await pg.evaluate(() => route('chat'));
    await pg.waitForSelector('.chat');
    await pg.waitForTimeout(600);
    return pg;
  }
  const chats = () => (DB.Lms_Chat || []).filter(r => r.chat_key !== 'c-old');
  const rooms = pg => pg.$$eval('.chr b', e => e.map(x => x.textContent));

  console.log('① 部屋の一覧');
  const hana = await openIn('hana@example.com');
  check('メニューに「チャット」がある', await hana.$$eval('.nav-i', e => e.some(x => /チャット/.test(x.textContent))));
  const hr = await rooms(hana);
  check('「全員」の部屋がある', hr.indexOf('全員') >= 0, hr.join(','));
  check('自分の職種（介護職）の部屋がある', hr.indexOf('介護職') >= 0);
  check('ほかの職種（事務）の部屋は出ない', hr.indexOf('事務') < 0);
  check('はじめは「全員」の部屋が開く', /# 全員/.test(await hana.$eval('.chat-top', e => e.textContent)));
  check('みんなが見られる場だという注意書き', /職員みんなが見られる/.test(await hana.$eval('.chat-note', e => e.textContent)));
  const boss = await openIn('owner@example.com');
  const br = await rooms(boss);
  check('管理者にはすべての職種の部屋が出る', br.indexOf('事務') >= 0 && br.indexOf('介護職') >= 0);

  console.log('② 発言する・ほかの人に届く');
  await hana.fill('#chIn', '1行目');
  await hana.press('#chIn', 'Shift+Enter');
  await hana.type('#chIn', '2行目');
  check('Shift+Enter では送らず改行になる', (await hana.$eval('#chIn', e => e.value)) === '1行目\n2行目');
  await hana.press('#chIn', 'Enter');
  await hana.waitForTimeout(2600);
  const c1 = chats()[0] || {};
  check('Enter で送り、Creator に1行入る', chats().length === 1 && c1.body === '1行目\n2行目', JSON.stringify(c1));
  const now = new Date();
  check('部屋・月・発言した人が入る', c1.room === 'all' && c1.person_name === '佐藤 花子' &&
    c1.chat_month === now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2));
  check('自分の発言は右側（mine）', await hana.$$eval('.cm.mine .cm-t', e => e.some(x => /2行目/.test(x.textContent))));
  check('入力欄は空に戻る', (await hana.$eval('#chIn', e => e.value)) === '');
  await hana.fill('#chIn', '<img src=x onerror="window.__xss=1"> https://example.com/a');
  await hana.press('#chIn', 'Enter');
  await hana.waitForTimeout(2600);
  check('タグは文字のまま出る（動かない）', await hana.evaluate(() => !window.__xss && !document.querySelector('.cm-t img')));
  check('https の URL はリンクになる', await hana.$$eval('.cm-t a', e => e.some(a => a.getAttribute('href') === 'https://example.com/a' && a.rel.indexOf('noopener') >= 0)));
  const jiro = await openIn('jiro@example.com');
  await jiro.waitForTimeout(1500);
  check('ほかの人の画面に届く（左側・名前つき）', await jiro.$$eval('.cm:not(.mine)', e => e.some(x => /佐藤 花子/.test(x.textContent) && /2行目/.test(x.textContent))));
  await hana.fill('#chIn', 'いま届きますか');
  await hana.press('#chIn', 'Enter');
  await jiro.waitForFunction(() => /いま届きますか/.test(document.getElementById('chLog').textContent), null, { timeout:8000 }).catch(() => {});
  check('開いたままの画面に、数秒で新しい発言が出る', /いま届きますか/.test(await jiro.$eval('#chLog', e => e.textContent)));
  if(process.env.SHOT) await jiro.screenshot({ path: process.env.SHOT + '/chat.png' });

  console.log('③ 職種の部屋と未読');
  await jiro.click('[data-room="dept:介護職"]');
  await jiro.fill('#chIn', '介護職のみなさんへ');
  await jiro.press('#chIn', 'Enter');
  await jiro.waitForTimeout(2600);
  check('職種の部屋の発言は room = dept:介護職', chats().some(r => r.room === 'dept:介護職' && /介護職のみなさん/.test(r.body)));
  await hana.evaluate(() => route('feed'));
  await hana.evaluate(() => { CHAT.loaded = false; LOADED.all = false; return loadChatMonth(curMonth()).then(() => drawNav(VIEW_NOW)); });
  await hana.waitForTimeout(300);
  const badge = await hana.$$eval('.nav-i', e => { const b = e.filter(x => /チャット/.test(x.textContent))[0]; return b ? b.textContent : ''; });
  check('ほかの画面にいると、メニューに未読の数が出る', /チャット\s*\d/.test(badge), badge);
  await hana.evaluate(() => route('chat'));
  await hana.waitForSelector('[data-room="dept:介護職"] .chr-n');
  check('部屋の一覧にも未読の数', (await hana.$eval('[data-room="dept:介護職"] .chr-n', e => e.textContent)) === '1');
  await hana.click('[data-room="dept:介護職"]');
  await hana.waitForTimeout(300);
  check('部屋を開くと未読が消える', (await hana.$('[data-room="dept:介護職"] .chr-n')) === null);
  const yamada = await openIn('yamada@example.com');
  await yamada.waitForTimeout(800);
  check('事務の人には介護職の部屋が出ない', (await rooms(yamada)).indexOf('介護職') < 0);

  console.log('④ 消す・前の月を読む');
  await hana.click('[data-room="all"]');
  await hana.waitForTimeout(300);
  const myId = await hana.$eval('.cm.mine [data-cdel]', e => e.getAttribute('data-cdel'));
  await hana.click('.cm.mine [data-cdel]');
  await hana.waitForTimeout(2600);
  check('自分の発言を消すと Creator に「削除あり」', (DB.Lms_Chat.filter(r => r.chat_key === myId)[0] || {}).deleted === 'あり');
  check('ほかの人の発言には消すボタンが出ない（一般の人）', (await hana.$('.cm:not(.mine) [data-cdel]')) === null);
  check('はじめは3か月前の発言は読まない', !/むかしの発言/.test(await hana.$eval('#chLog', e => e.textContent)));
  await hana.click('#chMore');
  await hana.waitForTimeout(800);
  const log1 = await hana.$eval('#chLog', e => e.textContent);
  if(!/むかしの発言/.test(log1)){ await hana.click('#chMore'); await hana.waitForTimeout(800); }
  check('「前の月を読む」で古い発言が出る', /むかしの発言/.test(await hana.$eval('#chLog', e => e.textContent)));

  console.log('⑤ 管理者が部屋を作る');
  await boss.click('#chNew');
  await boss.fill('#chRn', '送迎チーム');
  await boss.fill('#chRd', '送迎の連絡用');
  await boss.selectOption('#chRt', '介護職');
  await boss.click('#chRs');
  await boss.waitForTimeout(2600);
  check('部屋ができて開く', /# 送迎チーム/.test(await boss.$eval('.chat-top', e => e.textContent)));
  await hana.evaluate(() => loadCourses().then(() => viewChat()));
  await hana.waitForTimeout(300);
  check('介護職の人の一覧に出る', (await rooms(hana)).indexOf('送迎チーム') >= 0);
  await yamada.evaluate(() => loadCourses().then(() => viewChat()));
  await yamada.waitForTimeout(300);
  check('事務の人の一覧には出ない', (await rooms(yamada)).indexOf('送迎チーム') < 0);
  check('一般の人には「部屋を作る」が出ない', (await hana.$('#chNew')) === null);
  await boss.click('#chEdit');
  await boss.click('#chRx');
  await boss.waitForTimeout(400);
  check('部屋を閉じると一覧から消える', (await rooms(boss)).indexOf('送迎チーム') < 0);
  if(process.env.SHOT){
    const sp = await browser.newContext({ viewport:{ width:390, height:780 }, isMobile:true, hasTouch:true });
    const sg = await sp.newPage();
    await sg.addInitScript(stub('hana@example.com'), { email:'hana@example.com' });
    await sg.goto(base); await sg.waitForSelector('#gate [data-app="connect"]');
    await sg.click('#gate [data-app="connect"]'); await sg.waitForSelector('#app.on');
    await sg.evaluate(() => { CHAT.room = 'all'; route('chat'); });
    await sg.waitForTimeout(1500);
    await sg.screenshot({ path: process.env.SHOT + '/chat_sp.png' });
  }

  check('画面のエラーが出ていない（' + errs.join(' / ') + '）', errs.length === 0);
  await browser.close();
  srv.close();
  console.log('\n合格 ' + ok + ' 件 / 不合格 ' + ng + ' 件');
  process.exit(ng ? 1 : 0);
})();
