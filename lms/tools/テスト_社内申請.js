/* 社内申請システムが統合された枠の中で動くことを確かめる。
   ログインは統合側（メールアドレス→名簿）、社員と部署は統合側の名簿と職種を使う。 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const APP = path.join(__dirname, '..', 'lms-widget', 'app');
const html = fs.readFileSync(path.join(APP, 'widget.html'), 'utf8');

let ok = 0, ng = 0;
function check(name, cond, extra){
  if(cond){ ok++; console.log('  ✅ ' + name); }
  else    { ng++; console.log('  ❌ ' + name + (extra ? '　（' + extra + '）' : '')); }
}
const MIME = { '.js':'application/javascript', '.css':'text/css', '.json':'application/json' };

function stub(email){
  return ({ email }) => {
    const call = (method, q) => fetch('/__api', {
      method:'POST', headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ method, q })
    }).then(r => r.json());
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
    dept:'事務', title:'部長', role:'admin' },
  { person_key:'佐藤 花子', person_name:'佐藤 花子', email:'hana@example.com',
    dept:'介護職', title:'一般', manager_name:'鈴木 次郎', role:'learner' },
  { person_key:'鈴木 次郎', person_name:'鈴木 次郎', email:'jiro@example.com',
    dept:'介護職', title:'課長', manager_name:'田中 一郎', role:'learner' }
];

(async () => {
  const DB = { Lms_Person: ROSTER.map((p, i) => Object.assign({ ID:String(100+i) }, p)) };
  let seq = 1000;
  const tbl = n => String(n).replace(/_(Report|Form)$/, '');
  function api(method, q){
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
    if(q.url === '/__api' && q.method === 'POST'){
      let b = ''; q.on('data', c => { b += c; });
      q.on('end', () => {
        let out; try{ const j = JSON.parse(b); out = api(j.method, j.q); } catch(e){ out = { code:3000 }; }
        s.writeHead(200, { 'Content-Type':'application/json' }); s.end(JSON.stringify(out));
      });
      return;
    }
    /* 部品（css/js）はファイルから返す */
    const u = q.url.split('?')[0];
    const f = path.join(APP, u);
    if(u !== '/' && fs.existsSync(f) && fs.statSync(f).isFile()){
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
  async function open(email){
    const ctx = await browser.newContext({ viewport:{ width:1280, height:900 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(String(e)));
    page.on('console', m => {
      if(m.type() !== 'error') return;
      if(/Failed to load resource/.test(m.text())) return;   /* 外部のフォント等（この環境では取れない） */
      errs.push('console: ' + m.text());
    });
    await page.addInitScript(stub(email), { email });
    await page.goto(base);
    await page.waitForSelector('#gate .gate-card');
    await page.waitForTimeout(300);
    return page;
  }
  const side = p => p.$$eval('#side .nav-i span, #side .nav-s, #side .nav-h',
    els => els.map(e => e.textContent.trim()));

  console.log('① ログイン画面でアプリを選ぶ');
  const hana = await open('hana@example.com');
  const cards = await hana.$$eval('#gate [data-app]', els => els.map(e => e.textContent.trim().slice(0, 4)));
  check('入口に3つのアプリが並ぶ', cards.length === 3, cards.join('/'));
  check('社内申請が押せる', !(await hana.$eval('#gate [data-app="shinsei"]', e => e.disabled)));
  check('「はじめる」ボタンは無い（カードを押して入る）', (await hana.$('#gGo')) === null);

  console.log('② 社内申請に入る（一般の人）');
  await hana.click('#gate [data-app="shinsei"]');
  await hana.waitForSelector('#shinsei:not([hidden]) #view .page-title', { timeout:15000 });
  await hana.waitForTimeout(500);
  check('社内申請の画面が出た', !(await hana.$eval('#shinsei', e => e.hidden)));
  check('e-ラーニングの入れ物は隠れている', await hana.$eval('#main', e => e.hidden));
  const title = await hana.$eval('#view .page-title', e => e.textContent.trim());
  check('マイページが開く', /マイページ|ダッシュボード/.test(title), title);
  const who = await hana.evaluate(() => App.me().Employee_Name + '|' + App.me().Department_name + '|' + App.me().Roles.join());
  check('本人は統合側の名簿から決まる', who === '佐藤 花子|介護職|一般', who);
  let L = await side(hana);
  check('左メニューは社内申請の項目', L.some(t => t === '申請する') && L.some(t => t === '承認する'));
  check('管理の項目は出ない', !L.some(t => t === '設定・マスタ') && !L.some(t => t === '承認経路の設定'));
  check('「アプリを選ぶ」がある', L.some(t => t === 'アプリを選ぶ'));
  check('社員は名簿から3人', await hana.evaluate(() => App.state.employees.length) === 3);
  check('部署は職種から', await hana.evaluate(() => App.state.departments.map(d => d.Department_Name).indexOf('介護職') >= 0));
  check('上長が氏名で結びついている',
    await hana.evaluate(() => (App.employeeById(App.me().Manager) || {}).Employee_Name) === '鈴木 次郎');

  console.log('③ 直に管理画面を呼んでも開かない');
  await hana.evaluate(() => route('s_admin'));
  await hana.waitForTimeout(400);
  const t2 = await hana.$eval('#view .page-title', e => e.textContent.trim()).catch(() => '');
  check('設定・マスタは開かず、マイページに戻る', !/設定/.test(t2), t2);

  console.log('④ 申請を出す（休暇申請）');
  await hana.evaluate(() => route('s_new'));
  await hana.waitForSelector('#view [data-tpl]');
  check('申請の種類が並ぶ', (await hana.$$('#view [data-tpl]')).length >= 5);
  await hana.click('#view [data-tpl="LEAVE"]');
  await hana.waitForSelector('#f_leave_type');
  await hana.selectOption('#f_leave_type', '年次有給休暇');
  await hana.fill('#f_from_date', '2026-10-01');
  await hana.fill('#f_to_date', '2026-10-01');
  await hana.fill('#f_days', '1');
  await hana.fill('#f_reason', '私用のため');
  await hana.click('#view [data-act="submit"]');
  await hana.waitForTimeout(1200);
  const req = (DB.Lms_Request || DB.Wf_Request || []);
  check('Creator の申請の表に1行入った', req.length === 1, String(req.length));
  check('申請者は統合側の氏名', req[0] && req[0].applicant_name === '佐藤 花子', req[0] && req[0].applicant_name);
  check('申請中になっている', req[0] && req[0].status === '申請中', req[0] && req[0].status);
  const appr = DB.Wf_Approval || [];
  check('承認の行ができた', appr.length >= 1, String(appr.length));
  check('1段目の承認者は上長の鈴木さん',
    appr.length && appr[0].approver_name === '鈴木 次郎', appr.length && appr[0].approver_name);

  console.log('⑤ 上長がログインすると承認待ちに出る');
  const jiro = await open('jiro@example.com');
  await jiro.click('#gate [data-app="shinsei"]');
  await jiro.waitForSelector('#shinsei:not([hidden]) #view .page-title', { timeout:15000 });
  await jiro.waitForTimeout(500);
  check('承認待ちが1件', await jiro.evaluate(() => App.pendingCount()) === 1);
  L = await side(jiro);
  check('左メニューの「承認する」にバッジ',
    await jiro.$$eval('#side .nav-i', els => els.some(e => /承認する/.test(e.textContent) && /1/.test(e.textContent))));

  console.log('⑥ アプリは完全に分かれていること／キー操作が漏れないこと');
  await jiro.evaluate(() => route('home'));
  await jiro.waitForTimeout(300);
  check('社内申請の中から e-ラーニングの画面は開かない', !(await jiro.$eval('#shinsei', e => e.hidden)));
  check('上の帯は「社内申請」', (await jiro.$eval('#topLogo .nm', e => e.textContent)) === '社内申請');
  /* 入口に戻って e-ラーニングに入りなおす */
  await jiro.evaluate(() => route('hub'));
  await jiro.waitForSelector('#gate [data-app="lms"]');
  await jiro.click('#gate [data-app="lms"]');
  await jiro.waitForSelector('#app.on');
  await jiro.waitForTimeout(400);
  check('e-ラーニングの入れ物が出る', !(await jiro.$eval('#main', e => e.hidden)));
  check('社内申請の入れ物は隠れる', await jiro.$eval('#shinsei', e => e.hidden));
  check('e-ラーニングの左メニューに社内申請の項目は無い',
    !(await side(jiro)).some(t => /申請する|承認する/.test(t)));
  const h0 = await jiro.evaluate(() => location.hash);
  await jiro.keyboard.press('n');       /* 社内申請では「新規申請」のショートカット */
  await jiro.waitForTimeout(200);
  check('e-ラーニングで n を押しても社内申請が動かない', (await jiro.evaluate(() => location.hash)) === h0);
  await jiro.evaluate(() => route('hub'));
  await jiro.waitForSelector('#gate [data-app="shinsei"]');
  await jiro.click('#gate [data-app="shinsei"]');
  await jiro.waitForSelector('#shinsei:not([hidden]) #view .page-title', { timeout:15000 });
  await jiro.evaluate(() => route('s_inbox'));
  await jiro.waitForTimeout(400);
  check('社内申請に戻ると承認トレイが開く',
    /承認/.test(await jiro.$eval('#view .page-title', e => e.textContent.trim()).catch(() => '')));

  console.log('⑦ システム管理者には管理の項目が出る');
  const owner = await open('owner@example.com');
  await owner.click('#gate [data-app="shinsei"]');
  await owner.waitForSelector('#shinsei:not([hidden]) #view .page-title', { timeout:15000 });
  await owner.waitForTimeout(500);
  L = await side(owner);
  check('設定・マスタが出る', L.some(t => t === '設定・マスタ'));
  check('承認経路の設定が出る', L.some(t => t === '承認経路の設定'));
  check('管理メニューに「職員登録」がある', L.some(t => t === '職員登録'));
  await owner.evaluate(() => route('s_admin'));
  await owner.waitForTimeout(500);
  const tabs = await owner.$$eval('#view .tabs .tab', els => els.map(e => e.textContent.trim()));
  check('設定・マスタに「社員」「部署」のタブは無い（職員登録に一本化）',
    !tabs.some(t => /社員|部署/.test(t)) && tabs.some(t => /取引先/.test(t)), tabs.join('/'));
  await owner.evaluate(() => App.go('admin?tab=Employees'));
  await owner.waitForTimeout(600);
  check('「社員」を直に開こうとすると統合の職員登録が出る', (await owner.$('#main:not([hidden]) #p1n')) !== null);
  check('その一覧に名簿の人が並ぶ', (await owner.$eval('#main', e => e.textContent)).indexOf('佐藤 花子') >= 0);
  check('左メニューは社内申請のまま', (await side(owner)).some(t => t === '申請する'));

  check('画面のエラーが出ていない（' + errs.slice(0, 3).join(' / ') + '）', errs.length === 0);
  await browser.close(); srv.close();
  console.log('\n合格 ' + ok + ' 件 / 不合格 ' + ng + ' 件');
  process.exit(ng ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
