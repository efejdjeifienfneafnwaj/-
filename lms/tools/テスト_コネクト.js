/* 社内コミュニティ（掲示板・サンクスカード・表彰）と、3つのアプリの入口を確かめる */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const serveAsset = require('./_部品を返す');

const html = fs.readFileSync(
  path.join(__dirname, '..', 'lms-widget', 'app', 'widget.html'), 'utf8');

let ok = 0, ng = 0;
function check(name, cond, extra){
  if(cond){ ok++; console.log('  ✅ ' + name); }
  else    { ng++; console.log('  ❌ ' + name + (extra ? '　（' + extra + '）' : '')); }
}

/* ブラウザの中の ZOHO は、テスト用サーバーの1つの表を見に行く。
   こうしないと、人ごとにブラウザが分かれて「相手に届いたか」を確かめられない。 */
function stub(email){
  return ({ email }) => {
    const call = (method, q) => fetch('/__api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, q })
    }).then(r => r.json());
    window.__api = call;
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
  };
}

const ROSTER = [
  { person_key:'田中 一郎', person_name:'田中 一郎', email:'owner@example.com',
    dept:'事務', role:'admin' },
  { person_key:'佐藤 花子', person_name:'佐藤 花子', email:'hana@example.com',
    dept:'介護職', role:'learner' },
  { person_key:'鈴木 次郎', person_name:'鈴木 次郎', email:'jiro@example.com',
    dept:'看護職', role:'learner' }
];

(async () => {
  /* テスト用の「Creator」。全員が同じ表を見る */
  const DB = { Lms_Person: ROSTER.map((p, i) => Object.assign({ ID:String(100+i) }, p)) };
  let seq = 1000;
  const tbl = n => String(n).replace(/_(Report|Form)$/, '');
  function api(method, q){
    if(method === 'getRecords'){
      let rows = (DB[tbl(q.report_name)] || []).slice();
      /* 検索条件を効かせる。効かせないと、更新のときに別の行を書き換えてしまい、
         本物の Creator では起きない壊れ方をテストが見逃す */
      const crit = String(q.criteria || '');
      const conds = [];
      crit.replace(/([A-Za-z_][A-Za-z0-9_]*)\s*==\s*"([^"]*)"/g, (m, f, v) => {
        conds.push([f, v]); return m;
      });
      if(conds.length){
        rows = rows.filter(r => conds.every(c => String(r[c[0]] || '') === c[1]));
      }
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
    if(method === 'deleteRecordById'){
      const k = tbl(q.report_name);
      DB[k] = (DB[k] || []).filter(x => String(x.ID) !== String(q.id));
      return { code:3000 };
    }
    return { code:3000 };
  }
  const srv = http.createServer((q, s) => {
    if(serveAsset(q, s)) return;
    if(q.url === '/__api' && q.method === 'POST'){
      let b = '';
      q.on('data', c => { b += c; });
      q.on('end', () => {
        let out;
        try{ const j = JSON.parse(b); out = api(j.method, j.q); }
        catch(e){ out = { code:3000 }; }
        s.writeHead(200, { 'Content-Type':'application/json' });
        s.end(JSON.stringify(out));
      });
      return;
    }
    s.writeHead(200, { 'Content-Type':'text/html; charset=utf-8' }); s.end(html);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch({
    executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox']
  });
  const errs = [];

  async function open(email){
    const ctx = await browser.newContext({ viewport:{ width:1280, height:900 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(String(e)));
    await page.addInitScript(stub(email), { email });
    await page.goto(base);
    await page.waitForSelector('#gate [data-app="connect"]');
    page.__gate = true;
    return page;
  }
  /* 入口でカードを押して入る */
  async function enter(page, app){
    await page.click('#gate [data-app="' + (app || 'connect') + '"]');
    await page.waitForSelector('#app.on');
    await page.waitForTimeout(400);
  }
  const side = p => p.$$eval('#side .nav-i span, #side .nav-s',
    els => els.map(e => e.textContent.trim()));

  console.log('① ログイン画面に、3つのアプリが並ぶこと');
  const hana = await open('hana@example.com');
  check('入口に3つのカードが出る', (await hana.$$('#gate [data-app]')).length === 3);
  const names = await hana.$$eval('#gate [data-app] b', els => els.map(e => e.textContent.trim()));
  check('3つの名前が並ぶ',
    names.join('/') === '社内申請/PortalNavi/社内コミュニティ', names.join('/'));
  await enter(hana, 'connect');
  check('コネクトを押すと掲示板が開く', (await hana.$('#fdBody')) !== null);
  const L = await side(hana);
  check('上の帯は「社内コミュニティ」（船井は付けない）', (await hana.$eval('#topLogo .nm', e => e.textContent)) === '社内コミュニティ');
  check('メニューに「表彰」がある', L.some(t => t === '表彰'));
  check('e-ラーニングの項目は出ない', !L.some(t => /研修コース|マイダッシュボード|修了証/.test(t)));
  check('メンバーとプロフィールがある', L.some(t => t === 'メンバー') && L.some(t => t === 'プロフィール'));
  await hana.evaluate(() => route('home'));
  await hana.waitForTimeout(250);
  check('コネクトの中から e-ラーニングの画面は開かない（掲示板に戻る）', (await hana.$('#fdBody')) !== null);
  check('メニューに「掲示板」がある', L.some(t => t === '掲示板'));
  check('メニューに「サンクスカード」がある', L.some(t => t === 'サンクスカード'));
  check('メニューに「アプリを選ぶ」がある', L.some(t => t === 'アプリを選ぶ'));

  console.log('② 掲示板に投稿すると、押した瞬間に保存されること');
  await hana.waitForSelector('#fdBody');
  await hana.fill('#fdBody', 'おはようございます。今日の送迎は9時出発です。');
  await hana.click('#fdGo');
  await hana.waitForTimeout(300);
  check('画面に出た', (await hana.$$('.fd-card')).length === 1);
  await hana.waitForFunction(() => Object.keys(SYNC.pend).length === 0, null, { timeout:15000 });
  const posts1 = DB.Lms_Post || [];
  check('Creator に1行入った', posts1.length === 1, String(posts1.length));
  check('書いた人の名前が入っている', posts1[0] && posts1[0].author_name === '佐藤 花子');

  console.log('③ 別の人の画面にも、開いたときに出ること');
  const jiro = await open('jiro@example.com');
  await enter(jiro, 'connect');
  await jiro.waitForSelector('.fd-card');
  check('鈴木さんにも見える',
    (await jiro.$eval('.fd-card .fd-body', e => e.textContent)).indexOf('9時出発') >= 0);

  console.log('④ いいねとコメント');
  await jiro.click('[data-plike]');
  await jiro.waitForTimeout(300);
  check('いいねが1になった',
    (await jiro.$eval('.fd-like span', e => e.textContent)) === '1');
  check('自分のいいねとして色が付く', await jiro.$eval('.fd-like', e => e.classList.contains('on')));
  await jiro.click('[data-plike]');
  await jiro.waitForTimeout(300);
  check('もう一度押すと取り消せる',
    (await jiro.$eval('.fd-like span', e => e.textContent)) === '0');
  await jiro.click('[data-popen]');
  await jiro.waitForSelector('[data-rc]');
  await jiro.fill('[data-rc]', '了解しました！');
  await jiro.click('[data-csend]');
  await jiro.waitForTimeout(300);
  check('コメントが付いた',
    (await jiro.$eval('.fd-cmt span', e => e.textContent)) === '1');
  await jiro.waitForFunction(() => Object.keys(SYNC.pend).length === 0, null, { timeout:15000 });
  const rc1 = DB.Lms_React || [];
  check('コメントも Creator に入った',
    rc1.filter(r => r.kind === 'comment' && !r.deleted).length === 1);

  console.log('⑤ サンクスカード');
  await jiro.evaluate(() => route('thanks'));
  await jiro.waitForSelector('#fdTo');
  const opts = await jiro.$$eval('#fdTo option', els => els.map(e => e.textContent.trim()));
  check('自分は宛先に出ない', opts.indexOf('鈴木 次郎') < 0);
  check('ほかの人は宛先に出る', opts.indexOf('佐藤 花子') >= 0);
  await jiro.selectOption('#fdTo', '佐藤 花子');
  await jiro.fill('#fdBody', '急なシフト変更に対応いただき、助かりました。');
  await jiro.click('#fdGo');
  await jiro.waitForTimeout(400);
  check('サンクスが1枚出た', (await jiro.$$('.fd-card')).length === 1);
  check('宛先が出ている',
    (await jiro.$eval('.fd-to b', e => e.textContent.trim())) === '佐藤 花子');
  check('全社の合計が1になった',
    (await jiro.$$eval('.tile .big', els => els.map(e => e.textContent.trim())))[1] === '1');

  await jiro.waitForFunction(() => Object.keys(SYNC.pend).length === 0, null, { timeout:15000 });

  console.log('⑥ サンクスは掲示板にも並ぶこと／もらった数が出ること');
  const hana2 = await open('hana@example.com');
  await enter(hana2, 'connect');
  await hana2.evaluate(() => route('thanks'));
  await hana2.waitForSelector('.tile .big');
  check('佐藤さんの「もらった数」が1',
    (await hana2.$$eval('.tile .big', els => els.map(e => e.textContent.trim())))[0] === '1');
  await hana2.evaluate(() => route('feed'));
  await hana2.waitForSelector('.fd-card');
  const hc = await hana2.$$eval('.fd-card .fd-body', els => els.map(e => e.textContent.slice(0,14)));
  check('掲示板にはサンクスも並ぶ', hc.length === 2, hc.join(' | '));

  console.log('⑦ 削除は本人と管理者だけ');
  const jiro2 = await open('jiro@example.com');
  await enter(jiro2, 'connect');
  await jiro2.waitForSelector('.fd-card');
  const dels = await jiro2.$$eval('[data-pdel]', els => els.length);
  check('鈴木さんは自分のサンクスだけ消せる', dels === 1, String(dels));
  const owner = await open('owner@example.com');
  await enter(owner, 'connect');
  await owner.waitForSelector('.fd-card');
  const od = await owner.$$eval('[data-pdel]', els => els.length);
  const oc = await owner.$$eval('.fd-card .fd-body', els => els.map(e => e.textContent.slice(0,14)));
  check('システム管理者は全部消せる', od === 2, od + ' / ' + oc.join(' | '));
  owner.once('dialog', d => d.accept());
  await owner.click('[data-pdel]');
  await owner.waitForTimeout(400);
  check('消すと画面から減る', (await owner.$$('.fd-card')).length === 1);
  await owner.waitForFunction(() => Object.keys(SYNC.pend).length === 0, null, { timeout:15000 });
  const posts2 = DB.Lms_Post || [];
  check('行は残して「削除あり」の印が付く',
    posts2.filter(r => r.deleted === 'あり').length === 1);

  console.log('⑧ 宛先を職種にすると、その職種の人にだけ出ること');
  await owner.evaluate(() => {
    putPost({ kind:'post', by:'田中 一郎', body:'看護職の方へ連絡です', target:'看護職' });
  });
  await owner.waitForTimeout(200);
  const hana3 = await open('hana@example.com');
  await enter(hana3, 'connect');
  await hana3.waitForTimeout(400);
  const hb = await hana3.$$eval('.fd-body', els => els.map(e => e.textContent));
  check('介護職の佐藤さんには出ない', !hb.some(t => t.indexOf('看護職の方へ') >= 0));
  const jiro3 = await open('jiro@example.com');
  await enter(jiro3, 'connect');
  await jiro3.waitForTimeout(400);
  const jb = await jiro3.$$eval('.fd-body', els => els.map(e => e.textContent));
  check('看護職の鈴木さんには出る', jb.some(t => t.indexOf('看護職の方へ') >= 0));

  console.log('⑦ 社員表彰制度');
  const boss = await open('owner@example.com');
  await enter(boss, 'connect');
  await boss.evaluate(() => route('awards'));
  await boss.waitForSelector('#awGo');
  check('管理者には「表彰する」の欄が出る', (await boss.$('#awTitle')) !== null);
  await boss.fill('#awTitle', '月間MVP');
  await boss.selectOption('#awTo', '佐藤 花子');
  await boss.fill('#awBody', '送迎表の作り方を見直し、毎週2時間の作業を無くしてくれました。');
  await boss.click('#awGo');
  await boss.waitForTimeout(400);
  check('表彰が一覧に並ぶ', (await boss.$$('.pill.aw')).length === 1);
  check('受賞者と表彰名が出る',
    /佐藤 花子.*月間MVP/.test(await boss.$eval('.fd-aw', e => e.textContent)));
  check('殿堂に受賞者が載る', /佐藤 花子/.test(await boss.$eval('.rolelist', e => e.textContent)));
  check('全社の表彰の数が 1', (await boss.$$eval('.tile .big', els => els.map(e => e.textContent)))[1] === '1');
  await boss.waitForFunction(() => Object.keys(SYNC.pend).length === 0, { timeout:10000 });
  check('Creator の投稿の表に kind=award で入る', (DB.Lms_Post || []).some(r => r.kind === 'award' && r.to_name === '佐藤 花子'));

  const hana4 = await open('hana@example.com');
  await enter(hana4, 'connect');
  await hana4.waitForTimeout(400);
  check('受賞者の掲示板にも表彰が並ぶ（みんなで祝える）', (await hana4.$$('.pill.aw')).length === 1);
  await hana4.evaluate(() => route('awards'));
  await hana4.waitForTimeout(300);
  check('受講者には「表彰する」の欄は出ない', (await hana4.$('#awGo')) === null);
  check('自分の受賞が 1 と出る', (await hana4.$$eval('.tile .big', els => els.map(e => e.textContent)))[0] === '1');
  await hana4.evaluate(() => route('members'));
  await hana4.waitForTimeout(300);
  check('メンバー一覧に受賞の数が出る', /受賞 1回/.test(await hana4.$eval('.members', e => e.textContent)));

  console.log('⑧ 推薦と投票で決める');
  await hana4.evaluate(() => route('awards'));
  await hana4.waitForSelector('#nmGo');
  check('受講者にも「推薦する」が出る', (await hana4.$('#nmTitle')) !== null);
  await hana4.fill('#nmTitle', '年間MVP');
  await hana4.selectOption('#nmTo', '鈴木 次郎');
  await hana4.fill('#nmBody', '新人の指導を毎日欠かさず、チームの雰囲気が良くなりました。');
  await hana4.click('#nmGo');
  await hana4.waitForTimeout(400);
  check('候補として並ぶ', (await hana4.$$('[data-pvote]')).length === 1);
  await hana4.click('[data-pvote]');
  await hana4.waitForTimeout(300);
  check('推薦した人が投票できる（1票）', (await hana4.$eval('[data-pvote] span', e => e.textContent)) === '1');
  await hana4.waitForFunction(() => Object.keys(SYNC.pend).length === 0, { timeout:10000 });
  const jiro4 = await open('jiro@example.com');
  await enter(jiro4, 'connect');
  await jiro4.evaluate(() => route('awards'));
  await jiro4.waitForSelector('[data-pvote]');
  await jiro4.click('[data-pvote]');
  await jiro4.waitForTimeout(300);
  check('自分には投票できない', (await jiro4.$eval('[data-pvote] span', e => e.textContent)) === '1');
  check('自分には投票できないと知らせる', /自分には投票できません/.test(await jiro4.$eval('.toast', e => e.textContent)));
  check('受講者には「この方を表彰する」は出ない', (await jiro4.$('[data-adecide]')) === null);
  const boss2 = await open('owner@example.com');
  await enter(boss2, 'connect');
  await boss2.evaluate(() => route('awards'));
  await boss2.waitForSelector('[data-adecide]');
  await boss2.click('[data-pvote]');
  await boss2.waitForTimeout(300);
  check('管理者も投票できる（2票）', (await boss2.$eval('[data-pvote] span', e => e.textContent)) === '2');
  check('掲示板にも候補が出て投票できる', await boss2.evaluate(() => postList('').some(p => p.kind === 'nominee')));
  boss2.once('dialog', d => d.accept());
  await boss2.click('[data-adecide]');
  await boss2.waitForTimeout(500);
  check('確定すると候補は消える', (await boss2.$$('[data-pvote]')).length === 0);
  const decided = await boss2.$$eval('.fd-aw', els => els.map(e => e.textContent));
  check('表彰に変わる（年間MVP・鈴木 次郎）', decided.some(t => /鈴木 次郎.*年間MVP/.test(t)), decided.join(' / '));
  check('票の数が理由に添えられる', /投票 2 票/.test(await boss2.$eval('#main', e => e.textContent)));
  check('全社の表彰の数が 2', (await boss2.$$eval('.tile .big', els => els.map(e => e.textContent)))[1] === '2');

  check('画面のエラーが出ていない（' + errs.join(' / ') + '）', errs.length === 0);

  await browser.close(); srv.close();
  console.log('\n合格 ' + ok + ' 件 / 不合格 ' + ng + ' 件');
  process.exit(ng ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
