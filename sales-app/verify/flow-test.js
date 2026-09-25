/*
 * 営業管理テストの動作検証（Creator 接続を模したモックで、主要な操作を全部通す）
 *
 *   node sales-app/verify/flow-test.js
 *
 * スキル付属の verify/sdk-mock-test.js は「全レポート0件」で起動するため、
 * このアプリでは担当者マスタが空 → 初回登録画面で止まり、追加や更新までは通らない。
 * ここでは .ds から読み取ったフォーム定義を持つモックで、次を機械的に確かめる。
 *
 *   - 追加・更新で送る項目名が .ds のフォームに実在するか（無い項目は即エラー）
 *   - text 項目には文字列、number 項目には数値を送っているか
 *   - getRecords / addRecords / updateRecord のパラメータ名が snake_case か
 *   - criteria が実績のある「項目 == "値"」の形だけか
 *   - マネージャー / 担当者 / 未登録 / 在籍なし / マスタ空 / 読み込み失敗 /
 *     iframe 内での接続失敗 / デモモード の各場面
 *   - 各画面とモーダルが 375px 幅で横スクロールしないか
 *
 * 実際の Creator での動作を保証するものではない（モックはスキルの資料に書かれた挙動を再現したもの）。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

/* --- playwright の読み込み（スキルの verify/ と同じ探し方） --- */
function loadPlaywright() {
  const names = ['playwright', 'playwright-core'];
  try {
    const root = require('child_process').execSync('npm root -g', { encoding: 'utf8' }).trim();
    if (root) names.push(path.join(root, 'playwright'), path.join(root, 'playwright-core'));
  } catch (e) { /* npm が無い環境は無視 */ }
  for (const n of names) { try { return require(n); } catch (e) { /* 次を試す */ } }
  console.error('playwright を読み込めませんでした。npm i -D playwright && npx playwright install chromium を実行してください。');
  process.exit(2);
}
const { chromium } = loadPlaywright();
async function launchBrowser() {
  const attempts = [];
  if (process.env.CHROME_PATH) attempts.push({ executablePath: process.env.CHROME_PATH });
  attempts.push({}, { channel: 'chrome' });
  let last = null;
  for (const opt of attempts) { try { return await chromium.launch(opt); } catch (e) { last = e; } }
  console.error('ブラウザを起動できませんでした: ' + (last && last.message));
  process.exit(2);
}

const ROOT = path.resolve(__dirname, '..');
const HTML = path.join(ROOT, 'widget', 'app', 'widget.html');
const DS = fs.readFileSync(path.join(ROOT, 'ds', 'SalesApp.ds'), 'utf8');

/* --- .ds からフォームの項目と型、レポートとフォームの対応を読む --- */
function parseDs(text) {
  const forms = {}, reports = {};
  const block = text.slice(text.indexOf('\tforms\n\t{'), text.indexOf('\treports\n\t{'));
  let form = null, field = null;
  block.split('\n').forEach(line => {
    let m = line.match(/^\t\tform (\w+)/);
    if (m) { form = m[1]; forms[form] = {}; field = null; return; }
    m = line.match(/^\t\t\t(\w+)$/);
    if (m && form) { field = (m[1] === 'Section' || m[1] === 'actions') ? null : m[1]; return; }
    m = line.match(/^\t\t\t\ttype = (\w+)/);
    if (m && form && field) { forms[form][field] = m[1]; field = null; }
  });
  const re = /list (\w+)\s*\{[^}]*?show all rows from (\w+)/g;
  let r;
  while ((r = re.exec(text))) reports[r[1]] = r[2];
  return { forms, reports };
}
const SCHEMA = parseDs(DS);

/* --- 日付（アプリと同じく日本時間） --- */
const jst = () => new Date(Date.now() + 9 * 3600000);
const TODAY = jst().toISOString().slice(0, 10);
const MON = TODAY.slice(0, 7);
const addDays = (k, n) => { const d = new Date(k + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const addMonths = (m, n) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7);
const PREV = addMonths(MON, -1), NEXT = addMonths(MON, 1);
const SLASH_TODAY = `${+TODAY.slice(0, 4)}/${+TODAY.slice(5, 7)}/${+TODAY.slice(8, 10)}`;   // CSV でよくある書き方

/* --- Creator 側のデータ（リンク名のまま。数値は Creator と同じく文字列で返す） --- */
const SEED = {
  Sales_Staff_Form: [
    { ID: '101', staff_name: '山田 花子', staff_email: 'yamada@example.co.jp', staff_team: '営業部', staff_role: 'manager', is_active: 'true' },
    { ID: '102', staff_name: '伊藤 大輔', staff_email: 'ito@example.co.jp', staff_team: '営業部', staff_role: 'member', is_active: 'true' },
    { ID: '103', staff_name: '渡辺 さくら', staff_email: 'WATANABE@example.co.jp', staff_team: '営業部', staff_role: 'member', is_active: 'true' },
    { ID: '104', staff_name: '小川 誠', staff_email: 'ogawa@example.co.jp', staff_team: '営業部', staff_role: 'member', is_active: 'false' },
    { ID: '105', staff_name: '森 学', staff_email: 'mori@example.co.jp', staff_team: '', staff_role: '', is_active: '' }
  ],
  Sales_Customer_Form: [
    { ID: '201', cust_name: 'テスト商事', industry: '卸売', cust_rank: 'A', contact_person: '', cust_phone: '', cust_address: '', owner_id: '102', owner_name: '伊藤 大輔', cust_note: '', is_active: 'true' },
    /* CSV で取り込んだ直後を想定：主担当は名前だけ */
    { ID: '202', cust_name: 'サンプル工業', industry: '製造業', cust_rank: 'B', contact_person: '', cust_phone: '', cust_address: '', owner_id: '', owner_name: '渡辺 さくら', cust_note: '', is_active: 'true' }
  ],
  Sales_Deal_Form: [
    { ID: '301', deal_name: '案件A', customer_id: '201', customer_name: 'テスト商事', owner_id: '102', owner_name: '伊藤 大輔', owner_email: '', deal_stage: '交渉', deal_amount: '1000000', win_prob: '70', close_plan: TODAY, closed_on: '', next_action: '見積提示', next_action_on: addDays(TODAY, -1), deal_note: '' },
    /* 名前だけで担当が入っていて、確定日が「2026/9/25」形式 */
    { ID: '302', deal_name: '案件B', customer_id: '', customer_name: 'サンプル工業', owner_id: '', owner_name: '渡辺 さくら', deal_stage: '受注', deal_amount: '2000000', win_prob: '100', close_plan: '', closed_on: SLASH_TODAY, next_action: '', next_action_on: '', deal_note: '' },
    /* 確度が空 → ステージの標準（提案 30%）で計算される */
    { ID: '303', deal_name: '案件C', customer_id: '202', customer_name: 'サンプル工業', owner_id: '101', owner_name: '山田 花子', owner_email: 'yamada@example.co.jp', deal_stage: '提案', deal_amount: '500000', win_prob: '', close_plan: NEXT + '-10', closed_on: '', next_action: '訪問', next_action_on: addDays(TODAY, 3), deal_note: '' },
    { ID: '304', deal_name: '案件D', customer_id: '201', customer_name: 'テスト商事', owner_id: '102', owner_name: '伊藤 大輔', deal_stage: '受注', deal_amount: '800000', win_prob: '100', close_plan: PREV + '-10', closed_on: PREV + '-10', next_action: '', next_action_on: '', deal_note: '' },
    { ID: '305', deal_name: '案件E', customer_id: '202', customer_name: 'サンプル工業', owner_id: '103', owner_name: '渡辺 さくら', deal_stage: '見積', deal_amount: '3000000', win_prob: '50', close_plan: NEXT + '-15', closed_on: '', next_action: '条件確認', next_action_on: addDays(TODAY, 5), deal_note: '' }
  ],
  Sales_Activity_Form: [
    { ID: '401', act_date: addDays(TODAY, -2), act_type: '訪問', customer_id: '201', customer_name: 'テスト商事', deal_id: '301', deal_name: '案件A', staff_id: '102', staff_name: '伊藤 大輔', act_summary: '打合せ' }
  ],
  Sales_Target_Form: [
    { ID: '501', target_month: MON, staff_id: '102', staff_name: '伊藤 大輔', target_amount: '2000000' },
    /* 名前だけ・「2026/9」形式 */
    { ID: '502', target_month: `${+MON.slice(0, 4)}/${+MON.slice(5, 7)}`, staff_id: '', staff_name: '渡辺 さくら', target_amount: '4000000' }
  ],
  Sales_Log_Form: []
};

/* --- 正しい呼び方しか受け付けないモック（ページ内で実行される） --- */
function installMock(a) {
  window.__calls = []; window.__violations = [];
  const db = JSON.parse(JSON.stringify(a.seed));
  let seq = 0;
  const bad = (msg) => { window.__violations.push(msg); return Promise.reject({ code: 9999, message: 'MOCK: ' + msg }); };
  const camel = (q) => Object.keys(q || {}).filter(k => /[A-Z]/.test(k));
  function checkData(form, data, op) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return op + ': payload.data はオブジェクトで送る';
    for (const k of Object.keys(data)) {
      const t = a.forms[form][k], v = data[k];
      if (!t) return op + ': ' + form + ' に無い項目 ' + k;
      if (t === 'number' && (typeof v !== 'number' || !isFinite(v))) return op + ': ' + k + ' は数値で送る（' + JSON.stringify(v) + '）';
      if (t !== 'number' && typeof v !== 'string') return op + ': ' + k + ' は文字列で送る（' + JSON.stringify(v) + '）';
    }
    return null;
  }
  window.ZOHO = { CREATOR: {
    init: () => a.initMode === 'reject' ? Promise.reject(new Error('init failed')) : Promise.resolve(),
    UTIL: { getInitParams: () => ({ loginUser: a.login }) },
    DATA: {
      getRecords: (q) => {
        window.__calls.push({ op: 'get', q: JSON.parse(JSON.stringify(q)) });
        if (camel(q).length) return bad('get: camelCase のパラメータ ' + camel(q));
        const form = a.reports[q.report_name];
        if (!form) return bad('get: 不明なレポート ' + q.report_name);
        if (!(q.max_records > 0 && q.max_records <= 1000)) return bad('get: max_records が不正');
        if (a.faults[q.report_name]) return Promise.reject(a.faults[q.report_name]);
        let rows = db[form] || [];
        if (q.criteria != null) {
          const m = String(q.criteria).match(/^(\w+) == "([^"\\]*)"$/);
          if (!m || !a.forms[form][m[1]]) return bad('get: 実績のない形の criteria ' + q.criteria);
          rows = rows.filter(r => String(r[m[1]] == null ? '' : r[m[1]]) === m[2]);
        }
        if (!rows.length) return Promise.reject({ code: 9220, message: 'No records found' });
        return Promise.resolve({ code: 3000, data: JSON.parse(JSON.stringify(rows)) });
      },
      addRecords: (q) => {
        window.__calls.push({ op: 'add', q: JSON.parse(JSON.stringify(q)) });
        if (camel(q).length) return bad('add: camelCase のパラメータ ' + camel(q));
        if (!a.forms[q.form_name]) return bad('add: 不明なフォーム ' + q.form_name);
        const e = checkData(q.form_name, q.payload && q.payload.data, 'add');
        if (e) return bad(e);
        const id = String(4200000000000000 + (++seq));
        (db[q.form_name] = db[q.form_name] || []).push(Object.assign({ ID: id }, q.payload.data));
        return Promise.resolve({ code: 3000, data: { ID: id }, message: 'Data Added Successfully' });
      },
      updateRecord: (q) => {
        window.__calls.push({ op: 'update', q: JSON.parse(JSON.stringify(q)) });
        if (camel(q).length) return bad('update: camelCase のパラメータ ' + camel(q));
        const form = a.reports[q.report_name];
        if (!form) return bad('update: 不明なレポート ' + q.report_name);
        if (typeof q.id !== 'string' || !q.id) return bad('update: id は文字列で送る');
        const e = checkData(form, q.payload && q.payload.data, 'update');
        if (e) return bad(e);
        const row = (db[form] || []).find(r => String(r.ID) === q.id);
        if (!row) return bad('update: レコードが無い ' + q.id);
        Object.assign(row, q.payload.data);
        return Promise.resolve({ code: 3000, data: { ID: q.id }, message: 'Data Updated Successfully' });
      }
    }
  } };
}

/* --- 検証の記録 --- */
let failures = 0, checks = 0;
function ok(label, cond, extra) {
  checks++;
  if (!cond) failures++;
  console.log((cond ? '  ✓ ' : '  ✗ ') + label + (extra ? '  ' + extra : ''));
}

let browser;
async function openApp(opt) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  /* 本物の SDK は読ませない（ネットワークがある環境でもモックが上書きされないように） */
  await ctx.route(/widgetsdk-min\.js/, r => r.abort());
  if (opt.mock) {
    await ctx.addInitScript(installMock, {
      seed: opt.seed || SEED, forms: SCHEMA.forms, reports: SCHEMA.reports,
      login: opt.login, faults: opt.faults || {}, initMode: opt.initMode || 'ok'
    });
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/net::|ERR_/.test(m.text())) errors.push('CONSOLE: ' + m.text()); });
  let target = page;
  if (opt.iframe) {
    const parent = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'salesapp-')), 'parent.html');
    fs.writeFileSync(parent, '<!DOCTYPE html><iframe id="w" src="file://' + HTML + (opt.query || '') + '" style="width:1000px;height:800px"></iframe>');
    await page.goto('file://' + parent);
    await page.waitForSelector('#w');
    target = await (await page.$('#w')).contentFrame();
  } else {
    await page.goto('file://' + HTML + (opt.query || ''));
  }
  await target.waitForFunction(() => {
    const v = document.querySelector('#view');
    return v && v.textContent.trim() && !/読み込み中/.test(v.textContent);
  }, null, { timeout: 15000 });
  await target.waitForTimeout(150);
  return { ctx, page, f: target, errors };
}
const calls = (f, op) => f.evaluate(o => window.__calls.filter(c => c.op === o), op);
const violations = f => f.evaluate(() => window.__violations);
const kpi = (f, key) => f.$eval('[data-kpi="' + key + '"]', el => el.getAttribute('data-value'));
const viewText = f => f.$eval('#view', el => el.innerText);
const tabs = f => f.$$eval('#tabs [data-tab]', b => b.map(x => x.getAttribute('data-tab')));
const overflow = f => f.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
async function tab(f, key) { await f.click('#tabs [data-tab="' + key + '"]'); await f.waitForTimeout(80); }
async function submitModal(f) {
  await f.click('#modal-submit');
  await f.waitForFunction(() => !document.querySelector('#modal-form') || !document.querySelector('#modal-error').hidden, null, { timeout: 5000 });
  const err = await f.$('#modal-error');
  return err ? f.$eval('#modal-error', el => el.textContent) : null;   // null = 閉じた（保存できた）
}
async function closeModal(f) { await f.click('#modal [data-close].btn'); await f.waitForSelector('#modal-form', { state: 'detached' }); }
const lastAdd = async (f, form) => (await calls(f, 'add')).filter(c => c.q.form_name === form).pop();

/* ======================================================================= */
async function managerScenario() {
  console.log('\n■ マネージャー（Creator 接続・モック）');
  const { ctx, f, errors } = await openApp({ mock: true, login: 'Yamada@Example.co.jp' });
  ok('大文字小文字が違うログインIDでも本人と判定する', /山田 花子（マネージャー）/.test(await f.$eval('#who', e => e.textContent)));
  ok('マネージャーには全タブが出る', (await tabs(f)).join(',') === 'dashboard,deals,customers,activities,targets,staff');
  const gets = await calls(f, 'get');
  ok('マネージャーは絞り込みなしで取得する', gets.every(c => !c.q.criteria), gets.map(c => c.q.report_name).join(' '));

  /* ダッシュボード（期待値は SEED から手計算） */
  ok('今月の受注 = 案件B（名前だけ・2026/9/25 形式の確定日）', await kpi(f, 'won') === '2000000', await kpi(f, 'won'));
  ok('達成率 = 200万 / (200万 + 名前だけ・2026/9 形式の400万) = 33%', await kpi(f, 'rate') === '33', await kpi(f, 'rate'));
  ok('進行中 = 100万 + 50万 + 300万', await kpi(f, 'pipeline') === '4500000', await kpi(f, 'pipeline'));
  ok('加重見込み = 70万 + 15万（確度空→提案30%）+ 150万', await kpi(f, 'weighted') === '2350000', await kpi(f, 'weighted'));
  ok('今月の受注予定 = 案件A', await kpi(f, 'closing') === '1000000', await kpi(f, 'closing'));
  const dash = await viewText(f);
  ok('要フォローに期限切れの案件Aが出る', /案件A[\s\S]*次回アクションの期限切れ/.test(dash));
  ok('担当者別に在籍者だけが出る（小川は在籍なし・森は空欄→在籍）', /森 学/.test(dash) && !/小川 誠/.test(dash));
  ok('担当者未設定の行が出ない（名前で解決できている）', !/担当者未設定/.test(dash));

  /* 案件：一覧・追加・入力エラー・ステージ変更 */
  await tab(f, 'deals');
  ok('案件一覧（進行中）は3件', (await f.$$('#list tbody tr')).length === 3);
  await f.click('[data-act="stageFilter"][data-id="all"]');
  ok('「すべて」で5件', (await f.$$('#list tbody tr')).length === 5);
  await f.fill('[data-filter="q"]', 'サンプル');
  ok('検索で絞り込める（サンプル工業 → 3件）', (await f.$$('#list tbody tr')).length === 3);
  ok('検索中も入力欄のフォーカスが外れない', await f.evaluate(() => document.activeElement.getAttribute('data-filter') === 'q'));
  await f.fill('[data-filter="q"]', '');

  await f.click('[data-act="newDeal"]');
  await f.fill('#f_Name', '新規テスト案件');
  await f.selectOption('#f_Customer_ID', '201');
  await f.selectOption('#f_Owner_ID', '102');
  await f.selectOption('#f_Stage', '提案');
  ok('ステージを選ぶと標準の確度が入る', await f.inputValue('#f_Prob') === '30');
  await f.fill('#f_Amount', '30万円分');
  let err = await submitModal(f);
  ok('読めない金額（30万円分）は保存しない', err && /金額が数値として読めません/.test(err), err);
  await f.fill('#f_Amount', '120万');
  await f.fill('#f_Close_Plan', addDays(TODAY, 20));
  await f.fill('#f_Next_Action', '提案書の送付');
  err = await submitModal(f);
  ok('新規案件を保存できる', err === null, err);
  let add = await lastAdd(f, 'Sales_Deal_Form');
  const dd = add && add.q.payload.data;
  ok('金額「120万」は数値 1200000 で送る', dd && dd.deal_amount === 1200000);
  ok('担当・顧客は ID と名前の両方を送る', dd && dd.owner_id === '102' && dd.owner_name === '伊藤 大輔' && dd.customer_id === '201' && dd.customer_name === 'テスト商事');
  ok('権限設定用に担当者のメールも送る', dd && dd.owner_email === 'ito@example.co.jp');
  ok('進行中の案件は確定日を空で送る', dd && dd.closed_on === '');
  ok('案件には更新日時を送る', dd && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(dd.updated_at));

  await f.click('[data-act="editDeal"][data-id="301"]');
  await f.selectOption('#f_Stage', '受注');
  ok('受注にすると確度100・確定日に今日が入る', await f.inputValue('#f_Prob') === '100' && await f.inputValue('#f_Closed_On') === TODAY);
  err = await submitModal(f);
  ok('ステージ変更を保存できる', err === null, err);
  const up = (await calls(f, 'update')).pop();
  ok('updateRecord をレポート名と文字列の id で呼ぶ', up && up.q.report_name === 'Sales_Deal_Report' && up.q.id === '301');
  ok('更新内容（受注・確度100・確定日）', up && up.q.payload.data.deal_stage === '受注' && up.q.payload.data.win_prob === 100 && up.q.payload.data.closed_on === TODAY);
  ok('メールが空だった案件も、保存するとメールが埋まる', (await calls(f, 'update')).some(c => c.q.id === '301') && up.q.payload.data.owner_email === 'ito@example.co.jp');
  await tab(f, 'dashboard');
  ok('受注にした案件が今月の受注に加わる（200万 + 100万）', await kpi(f, 'won') === '3000000', await kpi(f, 'won'));

  /* 顧客：名前だけの主担当を ID で保存し直す・重複チェック */
  await tab(f, 'customers');
  ok('名前だけの主担当（渡辺 さくら）を表示できる', /サンプル工業[\s\S]*渡辺 さくら/.test(await viewText(f)));
  await f.click('[data-act="editCustomer"][data-id="202"]');
  ok('顧客の編集に関連する案件が出る', /この顧客の案件/.test(await f.$eval('#modal', e => e.innerText)));
  err = await submitModal(f);
  ok('顧客を保存できる', err === null, err);
  const cu = (await calls(f, 'update')).pop();
  ok('保存すると主担当の ID（103）が埋まる', cu && cu.q.report_name === 'Sales_Customer_Report' && cu.q.payload.data.owner_id === '103');
  ok('真偽値は "true" の文字列で送る', cu && cu.q.payload.data.is_active === 'true');
  await f.click('[data-act="newCustomer"]');
  await f.fill('#f_Name', 'テスト商事');
  err = await submitModal(f);
  ok('同じ会社名は登録しない', err && /すでにあります/.test(err), err);
  await f.fill('#f_Name', 'ニュー物産');
  await f.selectOption('#f_Rank', 'A');
  await f.uncheck('#f_Is_Active');
  err = await submitModal(f);
  ok('新規顧客を保存できる', err === null, err);
  add = await lastAdd(f, 'Sales_Customer_Form');
  ok('チェックを外した真偽値は "false" の文字列で送る', add && add.q.payload.data.is_active === 'false');
  ok('取引終了の顧客は既定の一覧に出ない', !/ニュー物産/.test(await viewText(f)));
  await f.check('[data-filter="custAll"]');
  ok('「取引終了も表示」で出る', /ニュー物産/.test(await viewText(f)));

  /* 活動：顧客を選ぶと、その顧客の進行中の案件だけが選べる */
  await tab(f, 'activities');
  await f.click('[data-act="newActivity"]');
  await f.selectOption('#f_Customer_ID', '201');
  const dealOpts = await f.$$eval('#f_Deal_ID option', o => o.map(x => x.textContent));
  ok('受注済みの案件Aは選択肢に出ず、新規テスト案件は出る', !dealOpts.some(t => /案件A/.test(t)) && dealOpts.some(t => /新規テスト案件/.test(t)), dealOpts.join(' / '));
  await f.selectOption('#f_Deal_ID', { label: '新規テスト案件（提案）' });
  await f.selectOption('#f_Type', '電話');
  await f.fill('#f_Summary', '提案書の感想を確認');
  err = await submitModal(f);
  ok('活動を保存できる', err === null, err);
  add = await lastAdd(f, 'Sales_Activity_Form');
  ok('活動は日付・案件・担当者（自分）を送る', add && add.q.payload.data.act_date === TODAY && add.q.payload.data.deal_name === '新規テスト案件' && add.q.payload.data.staff_id === '101' && add.q.payload.data.staff_email === 'yamada@example.co.jp');

  /* 目標：更新と追加・読めない値 */
  await tab(f, 'targets');
  await f.fill('[data-target-staff="102"]', '三百万');
  await f.click('[data-act="saveTargets"]');
  await f.waitForTimeout(100);
  ok('読めない目標金額（三百万）は保存しない', /数値として読めません/.test(await f.$eval('#target-error', e => e.textContent)));
  const before = (await calls(f, 'update')).length + (await calls(f, 'add')).length;
  await f.fill('[data-target-staff="102"]', '250万');
  await f.fill('[data-target-staff="105"]', '1,000,000');
  await f.click('[data-act="saveTargets"]');
  await f.waitForFunction(() => /目標を保存しました/.test(document.querySelector('#toast').textContent), null, { timeout: 5000 });
  const tUp = (await calls(f, 'update')).filter(c => c.q.report_name === 'Sales_Target_Report').pop();
  const tAdd = await lastAdd(f, 'Sales_Target_Form');
  ok('既存の目標は更新（250万）', tUp && tUp.q.id === '501' && tUp.q.payload.data.target_amount === 2500000);
  ok('無かった目標は追加（100万・今月・担当者のメール付き）', tAdd && tAdd.q.payload.data.staff_id === '105' && tAdd.q.payload.data.target_amount === 1000000 && tAdd.q.payload.data.target_month === MON && tAdd.q.payload.data.staff_email === 'mori@example.co.jp');
  const after = (await calls(f, 'update')).length + (await calls(f, 'add')).length;
  ok('変えていない行は送らない（更新1・追加1・記録2）', after - before === 4, String(after - before));
  await f.click('[data-act="monthNext"]');
  ok('翌月に切り替えられる', await f.$eval('[data-month]', e => e.getAttribute('data-month')) === NEXT);

  /* 担当者：編集・自分の権限は外せない・重複メール */
  await tab(f, 'staff');
  await f.click('[data-act="editStaff"][data-id="102"]');
  await f.fill('#f_Team', '営業2部');
  err = await submitModal(f);
  ok('担当者を保存できる', err === null, err);
  const su = (await calls(f, 'update')).pop();
  ok('担当者の更新内容', su && su.q.report_name === 'Sales_Staff_Report' && su.q.payload.data.staff_team === '営業2部' && su.q.payload.data.is_active === 'true');
  await f.click('[data-act="editStaff"][data-id="101"]');
  await f.selectOption('#f_Role', 'member');
  err = await submitModal(f);
  ok('自分自身をマネージャーから外せない', err && /自分自身/.test(err), err);
  await closeModal(f);
  await f.click('[data-act="newStaff"]');
  await f.fill('#f_Name', '重複 太郎');
  await f.fill('#f_Email', 'ITO@example.co.jp');
  err = await submitModal(f);
  ok('同じメールアドレス（大文字小文字違い）は登録しない', err && /同じメールアドレス/.test(err), err);
  await closeModal(f);

  /* 操作記録：更新日時を送らず、成功した操作の数だけ残る */
  const logs = (await calls(f, 'add')).filter(c => c.q.form_name === 'Sales_Log_Form');
  ok('操作記録に updated_at を送らない', logs.length > 0 && logs.every(c => !('updated_at' in c.q.payload.data)));
  ok('操作記録は成功した保存の数だけ（案件2・顧客2・活動1・目標2・担当者1 = 8）', logs.length === 8, String(logs.length));

  /* 375px */
  await f.setViewportSize({ width: 375, height: 800 });
  const widths = [];
  for (const t of await tabs(f)) { await tab(f, t); widths.push(t + ':' + await overflow(f)); }
  await tab(f, 'deals');
  await f.click('[data-act="editDeal"][data-id="303"]');
  widths.push('modal:' + await overflow(f));
  await closeModal(f);
  ok('375px 幅で全画面・モーダルとも横スクロールしない', widths.every(w => w.endsWith(':0')), widths.join(' '));

  const v = await violations(f);
  ok('SDK の呼び方の違反が0件', v.length === 0, v.join(' / '));
  ok('ページエラー・コンソールエラーが0件', errors.length === 0, errors.join(' / '));
  await ctx.close();
}

async function memberScenario() {
  console.log('\n■ 担当者（伊藤）');
  let { ctx, f, errors } = await openApp({ mock: true, login: 'ito@example.co.jp' });
  ok('目標・担当者タブが出ない', (await tabs(f)).join(',') === 'dashboard,deals,customers,activities');
  const gets = await calls(f, 'get');
  const scoped = gets.filter(c => /Deal|Activity|Target/.test(c.q.report_name));
  ok('案件・活動・目標は必ず criteria 付きで取得する', scoped.length === 6 && scoped.every(c => c.q.criteria), scoped.map(c => c.q.criteria).join(' | '));
  ok('criteria は ID と名前の等値条件', scoped.some(c => c.q.criteria === 'owner_id == "102"') && scoped.some(c => c.q.criteria === 'owner_name == "伊藤 大輔"'));
  ok('自分の達成率 = 0 / 200万', await kpi(f, 'rate') === '0', await kpi(f, 'rate'));
  ok('自分の進行中 = 案件Aだけ', await kpi(f, 'pipeline') === '1000000', await kpi(f, 'pipeline'));
  await tab(f, 'deals');
  await f.click('[data-act="stageFilter"][data-id="all"]');
  const txt = await viewText(f);
  ok('自分の案件だけが見える（A・D）', /案件A/.test(txt) && /案件D/.test(txt) && !/案件B|案件C|案件E/.test(txt));
  await f.click('[data-act="newDeal"]');
  ok('担当者は選べない（自分に固定）', !(await f.$('#f_Owner_ID')));
  await f.fill('#f_Name', '担当者の新規案件');
  await f.selectOption('#f_Customer_ID', '201');
  await f.fill('#f_Amount', '50万');
  const err = await submitModal(f);
  ok('担当者も案件を追加できる', err === null, err);
  const add = await lastAdd(f, 'Sales_Deal_Form');
  ok('担当は自分（102）で送る', add && add.q.payload.data.owner_id === '102');
  const v = await violations(f);
  ok('SDK の呼び方の違反が0件', v.length === 0, v.join(' / '));
  ok('ページエラー・コンソールエラーが0件', errors.length === 0, errors.join(' / '));
  await ctx.close();

  console.log('\n■ 担当者（渡辺：マスタは大文字のメール・案件と目標は名前だけ）');
  ({ ctx, f, errors } = await openApp({ mock: true, login: 'watanabe@example.co.jp' }));
  ok('本人と判定できる', /渡辺 さくら/.test(await f.$eval('#who', e => e.textContent)));
  ok('名前だけの受注（案件B）が自分の実績に入る', await kpi(f, 'won') === '2000000', await kpi(f, 'won'));
  ok('名前だけの目標（400万）が自分の目標に入る → 50%', await kpi(f, 'rate') === '50', await kpi(f, 'rate'));
  ok('ページエラー・コンソールエラーが0件', errors.length === 0, errors.join(' / '));
  await ctx.close();
}

async function stopScenarios() {
  console.log('\n■ 担当者マスタに無いアカウント');
  let { ctx, f, errors } = await openApp({ mock: true, login: 'nobody@example.co.jp' });
  let gets = await calls(f, 'get');
  ok('止める画面を出す', /登録されていません/.test(await viewText(f)));
  ok('担当者マスタ以外は読まない', gets.length === 1 && gets[0].q.report_name === 'Sales_Staff_Report', gets.map(c => c.q.report_name).join(' '));
  ok('タブを出さない', (await tabs(f)).length === 0);
  ok('ページエラー・コンソールエラーが0件', errors.length === 0, errors.join(' / '));
  await ctx.close();

  console.log('\n■ 在籍なしのアカウント');
  ({ ctx, f, errors } = await openApp({ mock: true, login: 'ogawa@example.co.jp' }));
  gets = await calls(f, 'get');
  ok('止める画面を出し、担当者マスタ以外は読まない', /在籍なし/.test(await viewText(f)) && gets.length === 1);
  await ctx.close();

  console.log('\n■ 担当者マスタを読めない（権限エラー）');
  ({ ctx, f, errors } = await openApp({ mock: true, login: 'yamada@example.co.jp', faults: { Sales_Staff_Report: { code: 2933, message: 'No permission to access the report' } } }));
  gets = await calls(f, 'get');
  const t = await viewText(f);
  ok('「0件」と取り違えず、エラーとして止める', /読み込めませんでした/.test(t) && /2933/.test(t));
  ok('初回登録ボタンを出さない', !(await f.$('[data-act="bootstrap"]')));
  ok('ほかのレポートは読まない', gets.length === 1);
  await ctx.close();

  console.log('\n■ 案件レポートだけ読めない');
  ({ ctx, f, errors } = await openApp({ mock: true, login: 'yamada@example.co.jp', faults: { Sales_Deal_Report: { code: 2933, message: 'No permission' } } }));
  ok('画面は出して、読めなかったことを明示する', /案件を読み込めませんでした/.test(await viewText(f)) && (await tabs(f)).length === 6);
  await ctx.close();

  console.log('\n■ 担当者マスタが空（初回導入）');
  const empty = Object.assign({}, SEED, { Sales_Staff_Form: [] });
  ({ ctx, f, errors } = await openApp({ mock: true, login: 'first@example.co.jp', seed: empty }));
  ok('初回登録画面を出す', !!(await f.$('[data-act="bootstrap"]')));
  await f.click('[data-act="bootstrap"]');
  ok('氏名が空なら登録しない', /氏名を入れてください/.test(await f.$eval('#boot-error', e => e.textContent)));
  await f.fill('#boot-name', '最初 の人');
  await f.click('[data-act="bootstrap"]');
  await f.waitForFunction(() => !document.querySelector('#tabs').hidden, null, { timeout: 5000 });
  const sa = await lastAdd(f, 'Sales_Staff_Form');
  ok('ログインIDでマネージャーとして登録する', sa && sa.q.payload.data.staff_email === 'first@example.co.jp' && sa.q.payload.data.staff_role === 'manager' && sa.q.payload.data.is_active === 'true');
  ok('登録後はマネージャーとして使える', (await tabs(f)).length === 6);
  const v = await violations(f);
  ok('SDK の呼び方の違反が0件', v.length === 0, v.join(' / '));
  ok('ページエラー・コンソールエラーが0件', errors.length === 0, errors.join(' / '));
  await ctx.close();
}

async function frameScenarios() {
  console.log('\n■ Creator の中（iframe）で接続に失敗');
  let { ctx, f } = await openApp({ mock: true, login: 'yamada@example.co.jp', iframe: true, initMode: 'reject' });
  ok('SDK の初期化に失敗したらデモに落とさず止める', /接続できませんでした/.test(await viewText(f)) && await f.evaluate(() => DB.isDemo()) === false);
  await ctx.close();
  ({ ctx, f } = await openApp({ mock: false, iframe: true }));
  ok('SDK を読み込めなかったらデモに落とさず止める', /接続できませんでした/.test(await viewText(f)) && await f.evaluate(() => DB.isDemo()) === false);
  await ctx.close();
  ({ ctx, f } = await openApp({ mock: false, iframe: true, query: '?demo=1' }));
  ok('iframe の中でも ?demo=1 ならデモで動く', await f.evaluate(() => DB.isDemo()) === true && (await tabs(f)).length === 6);
  await ctx.close();
}

async function demoScenario() {
  console.log('\n■ デモモード（ローカルで開いたとき）');
  const { ctx, f, errors } = await openApp({ mock: false });
  ok('デモモードで起動する', await f.evaluate(() => DB.isDemo()) === true);
  ok('ダッシュボードに数字が出る', Number(await kpi(f, 'pipeline')) > 0);
  await f.selectOption('#demo-as', 'suzuki@example.com');
  await f.waitForFunction(() => /鈴木/.test(document.querySelector('#demo-as').selectedOptions[0].textContent) && !document.querySelector('#tabs').hidden);
  await f.waitForTimeout(100);
  ok('利用者を担当者に切り替えると、目標・担当者タブが消える', (await tabs(f)).length === 4);
  await tab(f, 'deals');
  await f.click('[data-act="stageFilter"][data-id="all"]');
  const owners = await f.$$eval('#list tbody tr td:nth-child(3)', tds => [...new Set(tds.map(td => td.textContent))]);
  ok('担当者には自分の案件だけが見える', owners.length === 1 && owners[0] === '鈴木 健太', owners.join(','));
  await f.click('[data-act="newDeal"]');
  await f.fill('#f_Name', 'デモで追加した案件');
  await f.selectOption('#f_Customer_ID', { index: 1 });
  await f.fill('#f_Amount', '10万');
  const err = await submitModal(f);
  ok('デモでも追加できる', err === null, err);
  await f.reload();
  await f.waitForFunction(() => !document.querySelector('#tabs').hidden);
  await tab(f, 'deals');
  ok('再読み込みしても残る（このブラウザ内に保存）', /デモで追加した案件/.test(await viewText(f)));
  await f.click('#demo-reset');
  await f.waitForFunction(() => !document.querySelector('#tabs').hidden);
  await tab(f, 'deals');
  ok('「デモを初期化」で元に戻る', !/デモで追加した案件/.test(await viewText(f)));
  ok('ページエラー・コンソールエラーが0件', errors.length === 0, errors.join(' / '));
  await ctx.close();
}

(async () => {
  browser = await launchBrowser();
  console.log('.ds から読んだフォーム: ' + Object.keys(SCHEMA.forms).map(k => k + '(' + Object.keys(SCHEMA.forms[k]).length + ')').join(' '));
  await managerScenario();
  await memberScenario();
  await stopScenarios();
  await frameScenarios();
  await demoScenario();
  await browser.close();
  console.log('\n' + checks + ' 項目中 ' + (checks - failures) + ' 項目 OK' + (failures ? ' / ' + failures + ' 項目 NG' : ''));
  process.exit(failures ? 1 : 0);
})().catch(e => {
  console.error('検証中に止まりました: ' + (e && e.stack ? e.stack : e));
  process.exit(2);
});
