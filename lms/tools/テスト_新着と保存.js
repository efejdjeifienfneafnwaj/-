/* ① 誰かがお知らせを配信・掲示板に投稿したとき、別の人の画面が気づけること
   ② Zoho のログインが切れたとき「電波が悪い」ではなく、切れたと分かる知らせが残ること
   ③ 視聴の保存が短い間隔で行われること
   2人が同じ Creator（テスト用サーバー）を見ている状態を作って確かめる。 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const APP = path.join(__dirname, '..', 'lms-widget', 'app');
const html = fs.readFileSync(path.join(APP, 'widget.html'), 'utf8');
const MIME = { '.js':'application/javascript', '.css':'text/css', '.json':'application/json',
               '.jpg':'image/jpeg', '.png':'image/png' };

let ok = 0, ng = 0;
function check(name, cond, extra){
  if(cond){ ok++; console.log('  ✅ ' + name); }
  else    { ng++; console.log('  ❌ ' + name + (extra ? '　（' + extra + '）' : '')); }
}

/* ブラウザの中に置く ZOHO。読み書きはテスト用サーバーに投げるので、2人が同じ表を見る */
function stub({ email }){
  const call = (method, q) => fetch('/__api', {
    method:'POST', headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify({ method, q })
  }).then(r => r.json()).then(j => {
    /* ログイン切れは Promise の失敗として返す（Creator の振る舞いに合わせる） */
    if(j && j.__reject) return Promise.reject(j.__reject);
    return j;
  });
  window.ZOHO = { CREATOR: {
    UTIL: { getInitParams: () => Promise.resolve({ loginUser: email }) },
    DATA: {
      getRecords: q => call('getRecords', q),
      addRecords: q => call('addRecords', q),
      updateRecordById: q => call('updateRecordById', q),
      updateRecords: q => call('updateRecords', q),
      deleteRecordById: q => call('deleteRecordById', q),
      getRecordCount: () => Promise.resolve({ code:3000, result:{ records_count:0 } })
    }
  }};
}

const ROSTER = [
  { person_key:'田中 一郎', person_name:'田中 一郎', email:'owner@example.com',
    dept:'事務', title:'部長', role:'admin' },
  { person_key:'佐藤 花子', person_name:'佐藤 花子', email:'hana@example.com',
    dept:'介護職', title:'一般', role:'learner' }
];

(async () => {
  const DB = { Lms_Person: ROSTER.map((p, i) => Object.assign({ ID:String(100 + i) }, p)) };
  let seq = 1000;
  let failWrites = false;          /* true でログイン確認の画面を返す（ログイン切れ） */
  const tbl = n => String(n).replace(/_(Report|Form)$/, '');
  /* Creator がログイン確認の画面に飛ばしたときの返事。JSON ではなく HTML が返る */
  const AUTH_FAIL = { __reject: { status:0, responseText:
    '<!DOCTYPE html><html><head><title>Confirm Password</title></head>' +
    '<body>/portal/app5/confirmPassword?serviceurl=https://example.zohocreatorportal.jp</body></html>' } };

  function api(method, q){
    const writing = (method !== 'getRecords');
    if(writing && failWrites) return AUTH_FAIL;
    if(method === 'getRecords'){
      let rows = (DB[tbl(q.report_name)] || []).slice();
      const conds = [];
      String(q.criteria || '').replace(/([A-Za-z_][A-Za-z0-9_]*)\s*==\s*"([^"]*)"/g,
        (m, f, v) => { conds.push([f, v]); return m; });
      if(conds.length) rows = rows.filter(r => conds.every(c => String(r[c[0]] || '') === c[1]));
      if(!rows.length) return { code:3100, message:'No records found' };
      return { code:3000, data:rows };
    }
    if(method === 'addRecords'){
      const k = tbl(q.form_name); DB[k] = DB[k] || [];
      const r = Object.assign({}, q.payload.data, { ID:String(++seq) });
      DB[k].push(r);
      return { code:3000, data:{ ID:r.ID } };
    }
    if(method === 'updateRecordById'){
      const a = DB[tbl(q.report_name)] || [];
      const r = a.filter(x => String(x.ID) === String(q.id))[0];
      if(r) Object.assign(r, q.payload.data);
      return { code:3000 };
    }
    return { code:3000 };
  }

  const srv = http.createServer((q, s) => {
    if(q.url === '/__fail' || q.url === '/__ok'){
      failWrites = (q.url === '/__fail');
      s.writeHead(200, { 'Content-Type':'text/plain' }); s.end('ok'); return;
    }
    if(q.url === '/__api' && q.method === 'POST'){
      let b = ''; q.on('data', c => { b += c; });
      q.on('end', () => {
        let out; try{ const j = JSON.parse(b); out = api(j.method, j.q); } catch(e){ out = { code:3000 }; }
        s.writeHead(200, { 'Content-Type':'application/json' }); s.end(JSON.stringify(out));
      });
      return;
    }
    const u = q.url.split('?')[0];
    const f = path.join(APP, u);
    if(u !== '/' && f.startsWith(APP) && fs.existsSync(f) && fs.statSync(f).isFile()){
      s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'text/plain' });
      s.end(fs.readFileSync(f)); return;
    }
    s.writeHead(200, { 'Content-Type':'text/html; charset=utf-8' }); s.end(html);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch({
    executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args:['--no-sandbox']
  });
  const errs = [];

  /* 2人ぶんの画面を開く。別のブラウザ（別の端末）として扱う */
  async function open(email, app){
    const ctx = await browser.newContext({ viewport:{ width:1280, height:900 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(email + ': ' + e));
    await page.addInitScript(stub, { email });
    await page.goto(base);
    await page.waitForSelector('#gate [data-app="' + app + '"]');
    await page.click('#gate [data-app="' + app + '"]');
    await page.waitForSelector('#app.on', { timeout:15000 });
    return page;
  }

  console.log('① お知らせを配信すると、別の人の画面が気づく');
  const a = await open('owner@example.com', 'lms');     /* 配信する人（管理者） */
  const b = await open('hana@example.com', 'lms');      /* 受け取る人（受講者） */
  check('受け取る人のメニューに、はじめは数字が出ていない',
    (await b.$('.nav-s .pill.req')) === null);
  await a.evaluate(() => putNews({ title:'防災訓練のお知らせ', body:'来週行います', by:'田中 一郎',
                                   at:new Date().toISOString(), group:'' }));
  await a.waitForFunction(() => Object.keys(SYNC.pend).length === 0, { timeout:10000 });
  check('配信した行が Creator に入った', (DB.Lms_News || []).length === 1);
  /* 90秒待たずに、取り込みだけを呼ぶ */
  await b.evaluate(() => pollNow());
  await b.waitForTimeout(600);
  check('受け取る人の画面に取り込まれた',
    await b.evaluate(() => Object.keys(MEM.news).length) === 1);
  check('「新しいお知らせが届いています」と出る',
    /新しいお知らせ 1 件が届いています/.test(await b.$eval('.toast', e => e.textContent)),
    await b.$eval('.toast', e => e.textContent));
  check('マイページの「お知らせ」に 1 と出る',
    (await b.$eval('.nav-s .pill.req', e => e.textContent)) === '1');

  console.log('② 開いたら数字が消える（読んだ印）');
  await b.evaluate(() => route('mynews'));
  await b.waitForTimeout(300);
  check('お知らせを開くと数字が消える', (await b.$('.nav-s .pill.req')) === null);

  console.log('③ 掲示板に投稿すると、コネクトにいる人が気づく');
  /* 掲示板そのものを開いているあいだは feedWatch が見ているので、
     ここでは「コネクトの別の画面にいる」状態にする（気づけないと困るのはこちら） */
  const c = await open('hana@example.com', 'connect');
  await c.evaluate(() => route('members'));
  await c.waitForTimeout(300);
  await c.evaluate(() => markFeedSeen());
  await a.evaluate(() => putPost({ kind:'post', by:'田中 一郎', byMail:'owner@example.com',
                                   title:'今月の目標', body:'よろしくお願いします',
                                   at:new Date().toISOString() }));
  await a.waitForFunction(() => Object.keys(SYNC.pend).length === 0, { timeout:10000 });
  await c.evaluate(() => pollNow());
  await c.waitForTimeout(600);
  check('掲示板の新着が取り込まれた',
    await c.evaluate(() => postList().length) === 1);
  check('「掲示板 1 件が届いています」と出る',
    /掲示板 1 件/.test(await c.$eval('.toast', e => e.textContent)),
    await c.$eval('.toast', e => e.textContent));
  check('メニューの「掲示板」に 1 と出る',
    (await c.$eval('.nav-i .pill.req', e => e.textContent)) === '1');
  check('自分の投稿は新着に数えない', await c.evaluate(() => {
    putPost({ kind:'post', by:'佐藤 花子', byMail:'hana@example.com', title:'自分',
              body:'自分の投稿', at:new Date().toISOString() });
    return feedUnread();
  }) === 1);
  await c.evaluate(() => route('feed'));
  await c.waitForTimeout(300);
  check('掲示板を開くと数字が消える', (await c.$('.nav-i .pill.req')) === null);

  console.log('④ 動画を見ているあいだは取り込みに行かない');
  check('再生中は読みに行かない', await b.evaluate(() => {
    P.timer = setInterval(function(){}, 1000);
    var before = Object.keys(MEM.news).length;
    return pollNow().then(function(){
      clearInterval(P.timer); P.timer = null;
      return Object.keys(MEM.news).length === before;
    });
  }));

  console.log('⑤ ログインが切れたとき、切れたと分かる知らせが残る');
  await fetch(base + '__fail').catch(() => {});
  await b.evaluate(() => { putNews({ title:'切れた後の配信', body:'', by:'佐藤 花子',
                                     at:new Date().toISOString(), group:'' }); });
  await b.waitForSelector('#holdBar:not([hidden])', { timeout:15000 });
  const bar = await b.$eval('#holdBar', e => e.textContent);
  check('「Zoho のログインが切れた」と出る', /ログインが切れた/.test(bar), bar);
  check('「電波」の話ではない', !/電波/.test(bar), bar);
  check('記録が端末に残っていると伝える', /端末に残って/.test(bar), bar);
  check('「再読み込み」のボタンがある',
    (await b.$eval('#holdBar button', e => e.textContent)) === '再読み込み');
  check('送信待ちは消えずに残っている',
    await b.evaluate(() => Object.keys(SYNC.pend).length) > 0);

  console.log('⑥ つながれば知らせは消える');
  await fetch(base + '__ok').catch(() => {});
  await b.evaluate(() => flushSync());
  await b.waitForFunction(() => Object.keys(SYNC.pend).length === 0, { timeout:15000 });
  await b.waitForTimeout(300);
  check('保存できたら知らせが消える',
    await b.$eval('#holdBar', e => e.hidden) === true);

  console.log('⑦ 視聴の保存の間隔');
  const src = html;
  check('視聴の保存は20秒おき', /P\.saveT > 20000/.test(src));
  check('学習時間の送信は1分おき', /_dailySentAt > 60000/.test(src));

  check('画面のエラーが出ていない（' + errs.slice(0, 3).join(' / ') + '）', errs.length === 0);
  await browser.close(); srv.close();
  console.log('\n合格 ' + ok + ' 件 / 不合格 ' + ng + ' 件');
  process.exit(ng ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
