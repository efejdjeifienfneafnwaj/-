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
  let noRemind = false;            /* true で Lms_Remind の表が無い状態にする（code 2894） */
  let noCrit = false;              /* true で条件付きの検索を 400 で弾く（先方の Creator の振る舞い） */
  let noEdit = false;              /* true で「編集」だけ権限で拒否する（ポータルユーザーの権限不足） */
  const tbl = n => String(n).replace(/_(Report|Form)$/, '');
  /* Creator がログイン確認の画面に飛ばしたときの返事。JSON ではなく HTML が返る */
  const AUTH_FAIL = { __reject: { status:0, responseText:
    '<!DOCTYPE html><html><head><title>Confirm Password</title></head>' +
    '<body>/portal/app5/confirmPassword?serviceurl=https://example.zohocreatorportal.jp</body></html>' } };

  /* .ds を取り込み直していないときの Creator の返事 */
  const NO_BOX = name => ({ __reject: { status:404, statusText:'', responseText:
    '{"code":2894,"message":"No report named ' + name + ' found. Please check and try again."}' } });

  function api(method, q){
    const writing = (method !== 'getRecords');
    if(writing && failWrites) return AUTH_FAIL;
    const box = String(q.form_name || q.report_name || '');
    if(noRemind && /^Lms_Remind/.test(box)) return NO_BOX(box);
    if(method === 'getRecords'){
      if(noCrit && q.criteria) return { __reject: { status:400, statusText:'', responseText:
        '{"code":3400,"message":"Invalid criteria"}' } };
      let rows = (DB[tbl(q.report_name)] || []).slice();
      const conds = [];
      String(q.criteria || '').replace(/([A-Za-z_][A-Za-z0-9_]*)\s*==\s*"([^"]*)"/g,
        (m, f, v) => { conds.push([f, v]); return m; });
      if(conds.length) rows = rows.filter(r => conds.every(c => String(r[c[0]] || '') === c[1]));
      if(!rows.length && q.criteria) return { __reject: { status:400, statusText:'', responseText:
        '{"code":9280,"message":"No records found matching the given criteria."}' } };
      if(!rows.length) return { code:3100, message:'No records found' };
      /* 1000件を超えるときは、続きの印（record_cursor）を付けて分けて返す */
      const max = Number(q.max_records) || 200, start = Number(q.record_cursor || 0);
      const pageRows = rows.slice(start, start + max);
      if(!pageRows.length) return { code:3100, message:'No records found' };
      const out = { code:3000, data:pageRows };
      if(start + max < rows.length) out.record_cursor = String(start + max);
      return out;
    }
    if(method === 'addRecords'){
      const k = tbl(q.form_name); DB[k] = DB[k] || [];
      const r = Object.assign({}, q.payload.data, { ID:String(++seq) });
      DB[k].push(r);
      return { code:3000, data:{ ID:r.ID } };
    }
    if(method === 'deleteRecordById'){
      const k = tbl(q.report_name);
      DB[k] = (DB[k] || []).filter(x => String(x.ID) !== String(q.id));
      return { code:3000 };
    }
    if(method === 'updateRecordById' && noEdit) return { __reject: { status:403, statusText:'', responseText:
      '{"code":2896,"message":"Permission denied. You do not have permission to edit records in this report."}' } };
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
    if(q.url === '/__noedit' || q.url === '/__editok'){
      noEdit = (q.url === '/__noedit');
      s.writeHead(200, { 'Content-Type':'text/plain' }); s.end('ok'); return;
    }
    if(q.url === '/__nocrit'){
      noCrit = true;
      s.writeHead(200, { 'Content-Type':'text/plain' }); s.end('ok'); return;
    }
    if(q.url === '/__noremind'){
      noRemind = true;
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
    /* 記録の読み込みが終わってから、そのアプリの最初の画面が描かれる。
       待たないと、このあとの route() が後から来た route() に上書きされる */
    await page.waitForFunction(() => VIEW_NOW === appHome(), { timeout:15000 });
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
  check('画面を閉じないよう伝える', /閉じずに/.test(bar), bar);
  check('「再送する」のボタンがある',
    (await b.$eval('#holdBar button', e => e.textContent)) === '再送する');
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
  const tick = (src.match(/function startTick\(\)\{[\s\S]*?\n\}/) || [''])[0];
  check('再生中の自動保存は、ボタンと同じ経路（saveProgressNow）で5秒→20秒ごと', /P\.firstSaved \? 20000 : 5000/.test(tick) && /saveProgressNow\(true\)/.test(tick) && !/queueSync/.test(tick));
  check('putRec は Creator に送らない（メモリだけ）', !/cacheFlush\('records'\);\n  queueSync\('record'/.test(src));
  check('閉じる前に、保存していない視聴があれば確認が出る', /svUnsaved\(\)\)\{ e\.preventDefault\(\); e\.returnValue = ''; \}/.test(src));
  check('学習時間も自動では送らず、保存を押したときに送る', /学習時間も自動では送らない[\s\S]{0,80}if\(force\)\{/.test(src));

  console.log('⑧ Creator に表が無いとき（.ds を取り込み直していない）');
  await fetch(base + '__noremind').catch(() => {});
  /* 受講者の画面。リマインドの行は通らないが、学習時間は通らないといけない */
  await b.evaluate(() => { TOASTED = []; });
  await b.evaluate(() => {
    pushRemind('佐藤 花子');        /* ← 通らない行（Lms_Remind が無い） */
    bumpDaily('佐藤 花子', 600, true);  /* ← 受講者の記録。こちらは通らないと困る */
  });
  await b.waitForFunction(() => pendKeys().length === 0, { timeout:20000 });
  check('表が無い行は預かりになる',
    await b.evaluate(() => Object.keys(SYNC.hold).length) === 1);
  check('後ろに並んでいた学習時間は届く（1件で行列が止まらない）',
    (DB.Lms_Daily || []).length === 1, JSON.stringify(DB.Lms_Daily || []));
  check('控えは消していない（表を入れ直せば送られる）',
    await b.evaluate(() => Object.keys(SYNC.pend).length) === 1);
  check('無い表と分かった', await b.evaluate(() => MISSING.remind === true));
  check('それ以降は行を積まない', await b.evaluate(() => pushRemind('佐藤 花子') === false));
  check('受講者に「電波」の知らせは出さない',
    !/電波/.test(await b.$eval('.toast', e => e.textContent)),
    await b.$eval('.toast', e => e.textContent));
  check('受講者には管理者向けの知らせも出さない',
    await b.evaluate(() => {
      var el = document.getElementById('holdBar');
      return !el || el.hidden;
    }));
  check('行列の見た目は不安にさせない言い方',
    (await b.$eval('#syncBadge', e => e.textContent)) === '保存済み（未作成の表を除く）',
    await b.$eval('#syncBadge', e => e.textContent));

  console.log('⑩ 条件付きの検索が 400 で弾かれる Creator でも、保存と集計が通る');
  await fetch(base + '__nocrit').catch(() => {});
  /* 管理者（まだ学習時間の行が無い人）が視聴 → 「既にある行か」の検索が弾かれる */
  await a.evaluate(() => { bumpDaily('田中 一郎', 300, true); });
  await a.waitForFunction(() => pendKeys().length === 0, { timeout:20000 });
  const mineRows = () => (DB.Lms_Daily || []).filter(r => r.person_name === '田中 一郎');
  check('検索が弾かれても、行は追加される', mineRows().length === 1, JSON.stringify(mineRows()));
  check('弾かれた表を覚えている', await a.evaluate(() => !!NO_CRIT[FORM.dailyR]));
  await a.evaluate(() => { bumpDaily('田中 一郎', 60, true); });
  await a.waitForFunction(() => pendKeys().length === 0, { timeout:20000 });
  check('2回目は同じ行の更新で、二重にならない', mineRows().length === 1 && Number(mineRows()[0].watched_sec) === 360,
    JSON.stringify(mineRows()));
  check('受講者に「電波」の知らせは出ていない',
    !/電波/.test(await a.$eval('.toast', e => e.textContent)));
  /* 管理画面の読み込み（コースごとの条件付き）も通る */
  const loaded = await a.evaluate(() => { LOADED.all = false; return loadAll().then(() => ({ partial:LOADED.partial, quizzes:Object.keys(MEM.quizzes).length })); });
  check('管理画面の読み込みが失敗扱いにならない', loaded.partial === false, JSON.stringify(loaded));
  /* 1000件を超える表は、続きを読んで全部そろう */
  DB.Lms_News = [];
  for(let i = 0; i < 1200; i++) DB.Lms_News.push({ ID:String(50000 + i), news_key:'n' + i, title:'お知らせ' + i, body:'', target:'', posted_by:'田中 一郎', posted_at:'2026-09-01T00:00:00.000Z', deleted:'' });
  const newsN = await a.evaluate(() => { MEM.news = {}; return loadNews().then(() => Object.keys(MEM.news).length); });
  check('1000件を超える表も続きを読んで全部そろう（1200件）', newsN === 1200, String(newsN));
  check('切れた印は付かない', await a.evaluate(() => LOADED.truncated === false));

  console.log('⑪ 接続テストが、視聴記録が集計に結びつかない理由を出す');
  const ch0 = await a.evaluate(() => ({ chap:courses()[0].chapters[0].id, co:courses()[0].id, term:currentTerm() }));
  const now = new Date().toISOString();
  DB.Lms_Record = [
    { ID:'70001', rec_key:'佐藤 花子|' + ch0.chap + '|' + ch0.term, person_name:'佐藤 花子', chapter_id:ch0.chap,
      course_id:ch0.co, term:ch0.term, watched_pct:'17', ranges_json:'[[0,30]]', duration_sec:'180', updated_at:now },
    /* コースを作り直して course_id が変わった行。章IDで結びつくので集計には入る */
    { ID:'70004', rec_key:'佐藤 花子|' + ch0.chap + '|' + ch0.term, person_name:'佐藤 花子', chapter_id:ch0.chap,
      course_id:'old_course', term:ch0.term, watched_pct:'9', ranges_json:'[[0,16]]', duration_sec:'180', updated_at:now },
    { ID:'70002', rec_key:'山田|' + ch0.chap + '|' + ch0.term, person_name:'山田', chapter_id:ch0.chap,
      course_id:'x', term:ch0.term, watched_pct:'4', ranges_json:'[[0,7]]', duration_sec:'180', updated_at:now },
    { ID:'70005', rec_key:'鈴木|' + ch0.chap + '|' + ch0.term, person_name:'鈴木', chapter_id:ch0.chap,
      course_id:ch0.co, term:ch0.term, watched_pct:'3', ranges_json:'[[0,5]]', duration_sec:'180', updated_at:now },
    { ID:'70003', rec_key:'佐藤 花子|old_ch|' + ch0.term, person_name:'佐藤 花子', chapter_id:'old_ch',
      course_id:'x', term:ch0.term, watched_pct:'50', ranges_json:'[[0,90]]', duration_sec:'180', updated_at:now }
  ];
  await a.evaluate(() => route('asettings'));
  await a.waitForSelector('#dgRun');
  await a.click('#dgRun');
  await a.waitForFunction(() => /── 結果|ここで止まりました/.test((document.getElementById('dgOut') || {}).textContent || ''), { timeout:30000 });
  const dg = await a.$eval('#dgOut', e => e.textContent);
  check('突き合わせの項が出る', /③-5/.test(dg));
  check('名簿にある人の行は ✅', /✅ 行1：佐藤 花子/.test(dg), dg.split('\n').filter(l => /行1/.test(l)).join(''));
  check('名簿に無い氏名は ❌ で理由を出す', /❌ 行3：山田[\s\S]*名簿にこの氏名がありません/.test(dg));
  check('今のコースに無い章は ❌ で理由を出す', /❌ 行5：[\s\S]*今のコースにありません/.test(dg));
  check('コースIDが違っても章IDで結びつく（△ で知らせる）', /✅ 行2：佐藤 花子[\s\S]*△ コースID "old_course"/.test(dg),
    dg.split('\n').filter(l => /行2|old_course/.test(l)).join(' | '));
  /* 管理画面の「ユーザー」でも未着手にならない */
  await a.evaluate(() => route('ausers'));
  await a.waitForSelector('tbody tr');
  const hanaRow = await a.$$eval('tbody tr', trs => trs.map(t => t.textContent).filter(t => /佐藤 花子/.test(t))[0] || '');
  check('管理画面のユーザーで、受講した人が「学習中」になる（未着手ではない）', /学習中/.test(hanaRow), hanaRow.slice(0, 160));

  console.log('⑫ 名簿に無い氏名の記録を、名簿の人に付け替える');
  check('「名簿に無い氏名の受講記録」の札が出る', (await a.$('[data-adopt="山田"]')) !== null);
  const taroBefore = await a.$$eval('tbody tr', trs => trs.map(t => t.textContent).filter(t => /田中 一郎/.test(t))[0] || '');
  check('付け替える前の田中さんは未着手', /未着手/.test(taroBefore));
  await a.selectOption('[data-adopt-to="0"]', '田中 一郎');
  a.once('dialog', d => d.accept());
  await a.click('[data-adopt="山田"]');
  await a.waitForFunction(() => pendKeys().length === 0, { timeout:20000 });
  const moved = (DB.Lms_Record || []).filter(r => r.ID === '70002')[0];
  check('Creator の行を行番号のまま書き換える（新しい行を作らない）', moved && moved.person_name === '田中 一郎' && (DB.Lms_Record || []).length === 5,
    JSON.stringify({ n:(DB.Lms_Record || []).length, moved:moved && moved.person_name }));
  check('鍵（rec_key）も新しい氏名になる', moved && /^田中 一郎\|/.test(moved.rec_key), moved && moved.rec_key);
  await a.waitForTimeout(300);
  check('札が消える', (await a.$('[data-adopt="山田"]')) === null);
  const taroAfter = await a.$$eval('tbody tr', trs => trs.map(t => t.textContent).filter(t => /田中 一郎/.test(t))[0] || '');
  check('付け替えた田中さんが「学習中」になる', /学習中/.test(taroAfter), taroAfter.slice(0, 160));
  /* 古いテストデータは消す */
  check('もう1人の古い氏名（鈴木）の札が残っている', (await a.$('[data-purge="鈴木"]')) !== null);
  a.once('dialog', d => d.accept());
  await a.click('[data-purge="鈴木"]');
  await a.waitForTimeout(600);
  check('Creator の行が消える', !(DB.Lms_Record || []).some(r => r.ID === '70005'), JSON.stringify((DB.Lms_Record || []).map(r => r.ID)));
  check('札が消える', (await a.$('[data-purge="鈴木"]')) === null);
  delete DB.Lms_Record;

  console.log('⑬ Creator の中では、受講記録の控えを端末（localStorage）に持たない');
  const lsKeys = await b.evaluate(() => ['records','daily','people','quizzes','surveys','news','posts','reacts','reminds','pend']
    .filter(k => localStorage.getItem('lms_' + k) !== null));
  check('受講したあとも、記録・名簿・送信待ちが端末に書かれていない', lsKeys.length === 0, '残っている鍵：' + lsKeys.join(','));
  check('端末に残るのは既読・表示の設定だけ', await b.evaluate(() => Object.keys(localStorage).every(k => /^lms_(me|admin|newsSeen|feedSeen|autoNext|remindAllAt|noCrit|dataset|theme|termMigrated)/.test(k) || !/^lms_/.test(k))),
    await b.evaluate(() => Object.keys(localStorage).join(',')));
  console.log('⑭ 端末に古い控えが残っていても、Creator には送り込まない');
  await a.evaluate(() => setConfig(config()));            /* コース定義の行を Creator に作る（データの印になる） */
  await a.waitForFunction(() => pendKeys().length === 0, { timeout:20000 });
  const stamp = String(((DB.Lms_Course || [])[0] || {}).ID || '');
  check('コース定義の行がある（印になる）', !!stamp, JSON.stringify(DB.Lms_Course));
  const seed = ({ chap, term }) => {
    /* 古いアプリで使っていた端末の控え：別の印、山田の記録、その送信待ち */
    localStorage.setItem('lms_dataset', JSON.stringify('OLD_APP'));
    localStorage.setItem('lms_records', JSON.stringify({ ['山田|' + chap + '|' + term]: { dur:180, ranges:[[0,30]], fast:false, pos:30, updated:new Date().toISOString() } }));
    localStorage.setItem('lms_pend', JSON.stringify(['record\u0000山田|' + chap + '|' + term]));
  };
  const before = (DB.Lms_Record || []).length;
  const ctxS = await browser.newContext({ viewport:{ width:1280, height:900 } });
  const stale = await ctxS.newPage();
  stale.on('pageerror', e => errs.push('stale: ' + e));
  await stale.addInitScript(stub, { email:'hana@example.com' });
  await stale.addInitScript(seed, ch0);
  await stale.goto(base);
  await stale.waitForSelector('#gate [data-app="lms"]');
  await stale.click('#gate [data-app="lms"]');
  await stale.waitForSelector('#app.on', { timeout:15000 });
  await stale.waitForFunction(() => VIEW_NOW === appHome(), { timeout:15000 });
  await stale.waitForTimeout(1500);
  check('印が今の Creator のものに書き換わる', await stale.evaluate(() => LS.get('dataset', '')) === stamp);
  check('古い控えの記録（山田）は捨てられる', await stale.evaluate(() => !Object.keys(MEM.records).some(k => /^山田/.test(k))));
  check('古い送信待ちが新しい表に送られない', (DB.Lms_Record || []).length === before && !(DB.Lms_Record || []).some(r => /山田/.test(r.person_name || '')),
    JSON.stringify((DB.Lms_Record || []).map(r => r.person_name)));
  await ctxS.close();

  console.log('⑮ 「進行状況を保存する」を押すと、Creator に書いて読み返した%が出る');
  const sv = await open('hana@example.com', 'lms');
  await sv.evaluate(() => route('learn', courses()[0].id, 0));
  await sv.waitForSelector('#svGo');
  check('動画の下に大きな保存ボタンがある', (await sv.$('#svGo.btn.big')) !== null);
  check('自動保存のことが書いてある', /自動で保存/.test(await sv.$eval('.save-box', e => e.textContent)));
  /* YouTube は無いので、見た区間を手で塗る（0〜30秒／180秒） */
  /* 再生中の状態を作る（YouTube は無いので、プレイヤーが持つ値を手で入れる） */
  await sv.evaluate(() => {
    var co = courses()[0];
    P.course = co; P.chap = co.chapters[0]; P.owner = normName(me().name); P.term = currentTerm();
    P.tr = trackerUnpack({ dur:180, ranges:[[0,30]], fast:false });
  });
  await sv.click('#svGo');
  try{
    await sv.waitForFunction(() => /保存しました|保存できません/.test(document.getElementById('svState').textContent), { timeout:20000 });
  }catch(e){
    console.log('   [debug] svState=' + await sv.$eval('#svState', el => el.textContent) +
      ' busy=' + await sv.evaluate(() => SYNC.busy) + ' pend=' + await sv.evaluate(() => Object.keys(SYNC.pend).join(',')) +
      ' errs=' + errs.slice(-3).join(' / '));
    throw e;
  }
  const svText = await sv.$eval('#svState', e => e.textContent);
  check('Creator から読み返した視聴%が出る', /保存しました：Creator の記録 = 視聴 17%/.test(svText), svText);
  const svRow = (DB.Lms_Record || []).filter(r => r.person_name === '佐藤 花子' && Number(r.watched_pct) === 17)[0];
  check('Creator の行に 17% が入っている', !!svRow, JSON.stringify((DB.Lms_Record || []).map(r => [r.person_name, r.watched_pct])));
  /* もう一度押しても行は増えない */
  await sv.evaluate(() => { P.tr = trackerUnpack({ dur:180, ranges:[[0,60]], fast:false }); });
  await sv.click('#svGo');
  await sv.waitForFunction(() => /視聴 33%/.test(document.getElementById('svState').textContent), { timeout:20000 });
  check('2回目は同じ行の更新（33%）', (DB.Lms_Record || []).filter(r => r.person_name === '佐藤 花子').length === 1 &&
    (DB.Lms_Record || []).some(r => r.person_name === '佐藤 花子' && Number(r.watched_pct) === 33));
  /* 失敗したときは Creator の返事が出る */
  await fetch(base + '__fail').catch(() => {});
  await sv.click('#svGo');
  await sv.waitForFunction(() => /保存できませんでした/.test(document.getElementById('svState').textContent), { timeout:20000 });
  check('失敗したときは理由がその場に出る', /保存できませんでした/.test(await sv.$eval('#svState', e => e.textContent)));
  await fetch(base + '__ok').catch(() => {});
  DB.Lms_Record = (DB.Lms_Record || []).filter(r => r.person_name !== '佐藤 花子');
  /* 「次の章へ」を押すと保存してから移る */
  await sv.evaluate(() => route('learn', courses()[1].id, 0));
  await sv.waitForSelector('#nextCh:not([disabled])');
  await sv.evaluate(() => {
    var co = courses()[1];
    P.course = co; P.chap = co.chapters[0]; P.owner = normName(me().name); P.term = currentTerm();
    P.tr = trackerUnpack({ dur:100, ranges:[[0,25]], fast:false });
  });
  const c2ch0 = await sv.evaluate(() => courses()[1].chapters[0].id);
  await sv.click('#nextCh');
  await sv.waitForFunction(() => P.chap && P.chap.id === courses()[1].chapters[1].id, { timeout:20000 });
  check('「次の章へ」で前の章が Creator に保存される（25%）',
    (DB.Lms_Record || []).some(r => r.person_name === '佐藤 花子' && r.chapter_id === c2ch0 && Number(r.watched_pct) === 25),
    JSON.stringify((DB.Lms_Record || []).map(r => [r.chapter_id, r.watched_pct])));
  /* 編集が権限で拒否されるポータルでも、追加で残る */
  await fetch(base + '__noedit').catch(() => {});
  await sv.evaluate(() => { P.tr = trackerUnpack({ dur:100, ranges:[[0,50]], fast:false }); });
  await sv.click('#svGo');
  await sv.waitForFunction(() => /保存しました|保存できません/.test(document.getElementById('svState').textContent), { timeout:20000 });
  check('編集が拒否されても、新しい行として残る（50%）',
    (DB.Lms_Record || []).some(r => r.person_name === '佐藤 花子' && Number(r.watched_pct) === 50),
    await sv.$eval('#svState', e => e.textContent));
  await fetch(base + '__editok').catch(() => {});
  DB.Lms_Record = (DB.Lms_Record || []).filter(r => r.person_name !== '佐藤 花子');

  console.log('⑨ 管理者には、どの表を入れ直すか伝える');
  /* ⑪で管理画面を開いた時点で検知済みなので、いったん忘れさせてから改めて送る */
  await a.evaluate(() => { delete MISSING.remind; delete SYNC.hold[Object.keys(SYNC.hold).filter(k => /^remind/.test(k))[0]]; delete MEM.reminds['田中 一郎']; pushRemind('田中 一郎'); });
  await a.waitForSelector('#holdBar:not([hidden])', { timeout:20000 });
  const abar = await a.$eval('#holdBar', e => e.textContent);
  check('表の名前が出る', /自動リマインド（Lms_Remind）/.test(abar), abar);
  check('取り込み直すよう伝える', /PortalNavi\.ds/.test(abar), abar);

  check('画面のエラーが出ていない（' + errs.slice(0, 3).join(' / ') + '）', errs.length === 0);
  await browser.close(); srv.close();
  console.log('\n合格 ' + ok + ' 件 / 不合格 ' + ng + ' 件');
  process.exit(ng ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
