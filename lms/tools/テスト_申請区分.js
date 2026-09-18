/* 社内申請の「申請区分（テンプレート）」を画面から作る・直す・使わないにする、を
   実際に操作して確かめる。作った区分が「申請する」に並び、入力欄が出るところまで。 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const APP = path.join(__dirname, '..', 'lms-widget', 'app');
const html = fs.readFileSync(path.join(APP, 'widget.html'), 'utf8');
const MIME = { '.js':'application/javascript', '.css':'text/css', '.json':'application/json' };

let ok = 0, ng = 0;
function check(name, cond, extra){
  if(cond){ ok++; console.log('  ✅ ' + name); }
  else    { ng++; console.log('  ❌ ' + name + (extra ? '　（' + extra + '）' : '')); }
}

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
    dept:'介護職', title:'一般', manager_name:'田中 一郎', role:'learner' }
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
  const ctx = await browser.newContext({ viewport:{ width:1280, height:900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => {
    if(m.type() !== 'error') return;
    if(/Failed to load resource/.test(m.text())) return;
    errs.push('console: ' + m.text());
  });
  await page.addInitScript(stub('owner@example.com'), { email:'owner@example.com' });
  await page.goto(base);
  await page.waitForSelector('#gate .gate-card');
  await page.click('#gate [data-app="shinsei"]');
  await page.waitForSelector('#shinsei:not([hidden]) #view .page-title', { timeout:15000 });
  /* 確認のダイアログは自動で「はい」にする */
  await page.evaluate(() => { UI.confirmBox = () => Promise.resolve(true); });

  const openTpl = async () => {
    await page.evaluate(() => App.go('admin?tab=tpl'));
    await page.waitForSelector('[data-tpl-new]');
  };
  /* 統合側では申請区分の表は Wf_Type、列名は小文字（type_code など）に写される */
  const rtRows = () => DB.Wf_Type || [];
  const rtRow = code => rtRows().filter(r => r.type_code === code)[0];

  console.log('① 申請区分の一覧が出る');
  await openTpl();
  check('「＋ 新しい申請区分」がある', (await page.$('[data-tpl-new]')) !== null);
  check('組み込みの稟議書が並ぶ', (await page.$('[data-tpl-edit="RINGI"]')) !== null);
  check('編集・経路・複製・使わない のボタンがある',
    (await page.$('[data-tpl-route="RINGI"]')) !== null &&
    (await page.$('[data-tpl-copy="RINGI"]')) !== null &&
    (await page.$('[data-tpl-off="RINGI"]')) !== null);

  console.log('② 新しい申請区分を作る');
  await page.click('[data-tpl-new]');
  await page.waitForSelector('[data-tb="code"]');
  check('はじめから「件名」の項目が1つある', (await page.$$('#tplFields tbody tr')).length === 1);
  await page.fill('[data-tb="code"]', 'FACILITY');
  await page.fill('[data-tb="name"]', '設備購入申請');
  await page.fill('[data-tb="category"]', '稟議・購買');
  await page.fill('[data-tb="desc"]', '10万円未満の備品・設備の購入');
  await page.click('[data-tpl-addf]');
  await page.waitForSelector('[data-tf="label"][data-i="1"]');
  await page.fill('[data-tf="label"][data-i="1"]', '品名');
  await page.fill('[data-tf="key"][data-i="1"]', 'item_name');
  await page.click('[data-tpl-addf]');
  await page.waitForSelector('[data-tf="label"][data-i="2"]');
  await page.fill('[data-tf="label"][data-i="2"]', '金額');
  await page.fill('[data-tf="key"][data-i="2"]', 'amount');
  await page.selectOption('[data-tf="type"][data-i="2"]', 'currency');
  await page.waitForSelector('[data-tf="key"][data-i="2"]');
  await page.check('[data-tf="required"][data-i="2"]');
  await page.click('[data-tpl-addf]');
  await page.waitForSelector('[data-tf="label"][data-i="3"]');
  await page.fill('[data-tf="label"][data-i="3"]', '用途');
  await page.fill('[data-tf="key"][data-i="3"]', 'purpose');
  await page.selectOption('[data-tf="type"][data-i="3"]', 'select');
  await page.waitForSelector('[data-tf="options"][data-i="3"]');
  check('種類を「選択」にすると選択肢の欄が出る', (await page.$('[data-tf="options"][data-i="3"]')) !== null);
  check('種類を変えても、前に打ったラベルが残っている',
    (await page.$eval('[data-tf="label"][data-i="1"]', e => e.value)) === '品名');
  await page.fill('[data-tf="options"][data-i="3"]', '事務所、現場');
  await page.screenshot({ path:'/tmp/claude-0/tpl_form.png' });
  await page.click('[data-tpl-save]');
  await page.waitForSelector('[data-tpl-edit="FACILITY"]', { timeout:5000 });
  const made = await page.evaluate(() => App.templateByCode('FACILITY'));
  check('作った区分が読み込まれた', !!made, JSON.stringify(made));
  check('項目は 件名＋3つ', made && made.fields.length === 4);
  check('金額は必須の金額欄', made && made.fields[2].type === 'currency' && made.fields[2].required === true);
  check('選択肢が「、」で分かれた', made && JSON.stringify(made.fields[3].options) === '["事務所","現場"]');
  const row = rtRow('FACILITY');
  check('Creator の申請区分の表に1行入った', !!row);
  check('項目の定義が JSON で入っている', row && JSON.parse(row.field_schema).fields.length === 4);
  check('承認経路は空で、あとから組む形', row && JSON.parse(row.route_rule).steps.length === 0);
  check('一覧に「未設定」と出て、経路が要ると分かる',
    (await page.$eval('[data-tpl-edit="FACILITY"]', e => e.closest('tr').textContent)).indexOf('未設定') >= 0);

  console.log('③ 「申請する」に並び、入力欄が出る');
  await page.evaluate(() => App.go('new'));
  await page.waitForSelector('[data-tpl="FACILITY"]');
  check('申請の種類に出る', (await page.$('[data-tpl="FACILITY"]')) !== null);
  check('カテゴリの見出しの下にある',
    (await page.$eval('#view', e => e.textContent)).indexOf('稟議・購買') >= 0);
  await page.click('[data-tpl="FACILITY"]');
  await page.waitForSelector('#f_item_name');
  check('品名・金額・用途の入力欄が出る',
    (await page.$('#f_item_name')) !== null && (await page.$('#f_amount')) !== null && (await page.$('#f_purpose')) !== null);
  check('用途は2つから選ぶ', (await page.$$('#f_purpose option')).length >= 2);

  console.log('④ 作った区分を直す');
  await openTpl();
  await page.click('[data-tpl-edit="FACILITY"]');
  await page.waitForSelector('[data-tb="name"]');
  check('コードは変えられない', await page.$eval('[data-tb="code"]', e => e.disabled));
  await page.fill('[data-tb="name"]', '設備購入稟議');
  await page.click('[data-tpl-del="3"]');
  await page.waitForFunction(() => document.querySelectorAll('#tplFields tbody tr').length === 3);
  await page.click('[data-tpl-save]');
  await page.waitForSelector('[data-tpl-edit="FACILITY"]');
  const fixed = await page.evaluate(() => App.templateByCode('FACILITY'));
  check('名前が変わった', fixed && fixed.name === '設備購入稟議');
  check('項目が1つ減った', fixed && fixed.fields.length === 3);
  check('Creator の行は増えず、同じ行が直った', rtRows().filter(r => r.type_code === 'FACILITY').length === 1);

  console.log('⑤ 組み込みの区分を直しても、承認経路はそのまま');
  await page.click('[data-tpl-edit="RINGI"]');
  await page.waitForSelector('[data-tb="desc"]');
  await page.fill('[data-tb="desc"]', '一般稟議（説明を直した）');
  await page.click('[data-tpl-save]');
  await page.waitForSelector('[data-tpl-edit="RINGI"]');
  const ringi = await page.evaluate(() => { const t = App.templateByCode('RINGI'); return { desc:t.desc, steps:RouteSpec.normalize(t.route, t).steps.length, fields:t.fields.length }; });
  check('説明が変わった', ringi.desc === '一般稟議（説明を直した）');
  check('承認経路は5段のまま', ringi.steps === 5, String(ringi.steps));
  check('項目も減っていない', ringi.fields === 8, String(ringi.fields));
  check('組み込みの経路ごと Creator に写された', rtRow('RINGI') && JSON.parse(rtRow('RINGI').route_rule).steps.length === 5);

  console.log('⑥ 使わない → また使う');
  await page.click('[data-tpl-off="FACILITY"]');
  await page.waitForSelector('[data-tpl-on="FACILITY"]');
  check('一覧から消え、「使っていない」に移った', (await page.$('[data-tpl-edit="FACILITY"]')) === null);
  check('読み込みからも外れた', await page.evaluate(() => !App.templateByCode('FACILITY')));
  await page.evaluate(() => App.go('new'));
  await page.waitForSelector('[data-tpl="RINGI"]');
  check('「申請する」に出ない', (await page.$('[data-tpl="FACILITY"]')) === null);
  await openTpl();
  await page.click('[data-tpl-on="FACILITY"]');
  await page.waitForSelector('[data-tpl-edit="FACILITY"]');
  check('また使うと一覧に戻る', await page.evaluate(() => !!App.templateByCode('FACILITY')));

  console.log('⑦ 間違った入力は保存されない');
  await page.click('[data-tpl-new]');
  await page.waitForSelector('[data-tb="code"]');
  await page.fill('[data-tb="code"]', 'FACILITY');
  await page.fill('[data-tb="name"]', 'かぶり');
  await page.click('[data-tpl-save]');
  await page.waitForTimeout(300);
  check('同じコードは弾かれ、入力画面のまま', (await page.$('[data-tb="code"]')) !== null);
  await page.fill('[data-tb="code"]', 'bad code');
  await page.click('[data-tpl-save]');
  await page.waitForTimeout(300);
  check('小文字や空白のコードも弾かれる', (await page.$('[data-tb="code"]')) !== null);
  check('Creator の表は増えていない', rtRows().filter(r => r.type_name === 'かぶり').length === 0);
  await page.click('[data-tpl-cancel]');
  await page.waitForSelector('[data-tpl-new]');
  check('「やめる」で一覧に戻る', (await page.$('[data-tb="code"]')) === null);

  console.log('⑧ 「経路」から承認経路の設定に、その区分を選んだ状態で入る');
  await page.click('[data-tpl-route="FACILITY"]');
  await page.waitForTimeout(500);
  check('承認経路の画面が開いた', (await page.$eval('#view', e => e.textContent)).indexOf('承認経路の設定') >= 0);
  check('選ばれている区分は作ったもの', await page.evaluate(() => RouteEditor._state.code) === 'FACILITY');

  console.log('⑨ 左メニューの「申請フォーマットの作成・編集」から直接開ける');
  await page.evaluate(() => route('s_templates'));
  await page.waitForSelector('[data-tpl-new]');
  check('左メニューに項目がある', (await page.$('.nav-i[data-go="s_templates"]')) !== null);
  check('見出しが「申請フォーマットの作成・編集」', (await page.$eval('#view .page-title', e => e.textContent)).indexOf('申請フォーマットの作成・編集') >= 0);
  check('「＋ 新しい申請フォーマット」のボタンがある', /新しい申請フォーマット/.test(await page.$eval('[data-tpl-new]', e => e.textContent)));
  check('作った区分の「編集」がある', (await page.$('[data-tpl-edit="FACILITY"]')) !== null);
  await page.click('[data-tpl-edit="FACILITY"]');
  await page.waitForSelector('[data-tb="code"]');
  check('この画面でも編集に入れる', (await page.$eval('[data-tb="name"]', e => e.value)) === '設備購入稟議');
  await page.click('[data-tpl-cancel]');
  await page.waitForSelector('[data-tpl-new]');
  await page.evaluate(() => route('s_new'));
  await page.waitForSelector('[data-go-templates]');
  check('「申請する」に管理者向けの「申請フォーマットを作る・直す」がある', (await page.$('[data-go-templates]')) !== null);
  await page.click('[data-go-templates]');
  await page.waitForSelector('[data-tpl-new]');
  check('そのボタンからも開ける', (await page.$eval('#view .page-title', e => e.textContent)).indexOf('申請フォーマット') >= 0);

  console.log('⑩ 一般の人には出ない');
  const hana = await ctx.newPage();
  hana.on('pageerror', e => errs.push(String(e)));
  await hana.addInitScript(stub("hana@example.com"), { email:"hana@example.com" });
  await hana.goto(base);
  await hana.waitForSelector('#gate .gate-card');
  await hana.click('#gate [data-app="shinsei"]');
  await hana.waitForSelector('#shinsei:not([hidden]) #view .page-title', { timeout:15000 });
  check('一般には左メニューに出ない', (await hana.$('.nav-i[data-go="s_templates"]')) === null);
  await hana.evaluate(() => route('s_new'));
  await hana.waitForSelector('[data-tpl]');
  check('「申請する」にも作る・直すのボタンは出ない', (await hana.$('[data-go-templates]')) === null);

  check('画面のエラーが出ていない（' + errs.slice(0, 3).join(' / ') + '）', errs.length === 0);
  await browser.close(); srv.close();
  console.log('\n合格 ' + ok + ' 件 / 不合格 ' + ng + ' 件');
  process.exit(ng ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
