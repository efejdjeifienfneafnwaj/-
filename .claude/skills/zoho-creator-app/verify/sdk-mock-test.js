/*
 * SDK の呼び方が正しいかを、モックで検証する。
 *
 *   node verify/sdk-mock-test.js <path/to/app/widget.html>
 *
 * 間違ったパラメータ名（reportName など）を渡すと即エラーになるモックを注入するので、
 * これが通れば snake_case で呼べていることが保証される。
 *
 * モックは SDK の形を2通り用意し、どちらでも接続できることを確かめる。
 *   v2doc  : Zoho の JS API v2 の資料の形。init() が無い・getInitParams() は Promise・
 *            更新は updateRecordById・追加の応答は { result: [ { code, data: { ID } } ] }
 *   legacy : このスキルの初版の資料の形。init() あり・getInitParams() は同期・更新は updateRecord
 * 実際の Creator では、init() の有無で SDK を判定していたために「SDK未検出」で止まった。
 * v2doc で接続できれば、その不具合は無い。
 *
 * さらに Creator と同じく iframe の中で開き、次を確かめる。
 *   - v2doc の SDK で接続できる
 *   - SDK が無いときにデモモードへ落ちない（保存されない画面に入力させない）
 *
 * 本物の SDK は読み込ませない（ネットワークがある環境でもモックが上書きされないように）。
 * 事前に: npm install playwright（ブラウザは PLAYWRIGHT_BROWSERS_PATH のものを使う）
 */
/* --- playwright の読み込み（環境によって置き場所が違うため順に探す） --- */
function loadPlaywright() {
  const tried = [];
  const names = ['playwright', 'playwright-core'];
  try {
    const root = require('child_process').execSync('npm root -g', { encoding: 'utf8' }).trim();
    if (root) names.push(require('path').join(root, 'playwright'), require('path').join(root, 'playwright-core'));
  } catch (e) { /* npm が無い環境は無視して次を試す */ }
  for (const n of names) {
    try { return require(n); } catch (e) { tried.push(n); }
  }
  console.error('playwright を読み込めませんでした。次を実行してから、もう一度お試しください。\n' +
    '  npm i -D playwright && npx playwright install chromium\n' +
    '探した場所: ' + tried.join(' / '));
  process.exit(2);
}
const { chromium } = loadPlaywright();

/* --- ブラウザの起動（CHROME_PATH → playwright 同梱 → 端末の Chrome の順に試す） --- */
async function launchBrowser() {
  const attempts = [];
  if (process.env.CHROME_PATH) attempts.push({ executablePath: process.env.CHROME_PATH });
  attempts.push({});                      // playwright install で入れたブラウザ
  attempts.push({ channel: 'chrome' });   // 端末にインストール済みの Chrome
  let last = null;
  for (const opt of attempts) {
    try { return await chromium.launch(opt); } catch (e) { last = e; }
  }
  console.error('ブラウザを起動できませんでした。`npx playwright install chromium` を実行するか、\n' +
    'CHROME_PATH に Chrome の実行ファイルのパスを指定してください。\n' + (last && last.message));
  process.exit(2);
}
const fs = require('fs');
const os = require('os');
const path = require('path');

const target = process.argv[2];
if (!target) { console.error('使い方: node verify/sdk-mock-test.js <app/widget.html>'); process.exit(2); }
const url = 'file://' + path.resolve(target);

/* 正しいパラメータ名しか受け付けないモック（ページの中で実行される） */
function installMock(variant) {
  window.__calls = { get: [], add: [], update: [] };
  const v2 = variant === 'v2doc';
  const ROWS = {};   // 0件のときもエラーを返す挙動を再現する
  let seq = 0;
  const DATA = {
    getRecords: (q) => {
      window.__calls.get.push(q);
      if (!q || !q.report_name) return Promise.reject(new Error('report_name がありません: ' + JSON.stringify(q)));
      if (!q.max_records) return Promise.reject(new Error('max_records がありません'));
      if (q.reportName || q.pageSize || q.page) return Promise.reject(new Error('camelCase のパラメータが混ざっています'));
      const rows = ROWS[q.report_name];
      if (!rows || !rows.length) return Promise.reject({ code: 9220, message: 'No records found' });
      return Promise.resolve({ code: 3000, data: rows });
    },
    addRecords: (q) => {
      window.__calls.add.push(q);
      if (!q.form_name) return Promise.reject(new Error('form_name がありません'));
      if (q.formName) return Promise.reject(new Error('camelCase（formName）が使われています'));
      if (!q.payload || !q.payload.data) return Promise.reject(new Error('payload.data がありません'));
      if (Array.isArray(q.payload.data)) return Promise.reject(new Error('payload.data は配列ではなくオブジェクトです'));
      const id = String(4200000000000000 + (++seq));
      /* v2doc は REST API v2.1 の形（ID は result の中）で返す */
      return Promise.resolve(v2 ? { code: 3000, result: [{ code: 3000, data: { ID: id }, message: 'success' }] }
                                : { code: 3000, data: { ID: id } });
    }
  };
  const update = (fn) => (q) => {
    window.__calls.update.push(Object.assign({ fn: fn }, q));
    if (!q.report_name || !q.id || !q.payload || !q.payload.data) {
      return Promise.reject(new Error(fn + ' のパラメータが不足しています'));
    }
    if (q.reportName || q.recordId) return Promise.reject(new Error('camelCase のパラメータが混ざっています'));
    return Promise.resolve({ code: 3000, data: { ID: q.id } });
  };
  /* 片方しか用意しない。無い方を呼べば「is not a function」で落ちる */
  if (v2) DATA.updateRecordById = update('updateRecordById');
  else DATA.updateRecord = update('updateRecord');
  const CREATOR = {
    UTIL: {
      getInitParams: v2 ? () => Promise.resolve({ loginUser: 'test@example.co.jp' })
                        : () => ({ loginUser: 'test@example.co.jp' })
    },
    DATA: DATA
  };
  if (!v2) CREATOR.init = () => Promise.resolve();   // v2 の SDK には init が無い
  window.ZOHO = { CREATOR: CREATOR };
}

/* variant: 'v2doc' / 'legacy' / 'none'（SDK なし）。iframe: Creator と同じく iframe の中で開く */
async function open(browser, variant, iframe) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route(/widgetsdk-min\.js/, r => r.abort());
  if (variant !== 'none') await ctx.addInitScript(installMock, variant);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/zohostatic|ERR_|net::/i.test(m.text())) errs.push('CONSOLE: ' + m.text());
  });
  let frame = page;
  if (iframe) {
    const parent = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-mock-')), 'parent.html');
    fs.writeFileSync(parent, '<!DOCTYPE html><iframe id="w" src="' + url + '" style="width:1000px;height:800px"></iframe>');
    await page.goto('file://' + parent);
    frame = await (await page.waitForSelector('#w')).contentFrame();
  } else {
    await page.goto(url);
  }
  /* 接続・デモ・エラー表示のどれかに落ち着くまで待ち、起動時の取得や記録が終わるのを待つ */
  await frame.waitForFunction(() => typeof DB !== 'undefined' && (
    (typeof DB.isConnected === 'function' && DB.isConnected()) ||
    (typeof DB.isDemo === 'function' && DB.isDemo()) ||
    /失敗|接続できません/.test(document.body.innerText)), null, { timeout: 15000 }).catch(() => {});
  await frame.waitForTimeout(1500);
  return { ctx, frame, errs };
}

(async () => {
  const report = [];
  let failed = 0;
  const ok = (label, cond, extra) => {
    console.log((cond ? '✓ ' : '✗ ') + label + (extra ? '  ' + extra : ''));
    if (!cond) failed++;
  };
  const browser = await launchBrowser();

  for (const variant of ['v2doc', 'legacy']) {
    const { ctx, frame, errs } = await open(browser, variant, false);
    const tag = '[' + variant + '] ';
    const calls = await frame.evaluate(() => window.__calls);
    ok(tag + 'Creator 接続として起動する',
       await frame.evaluate(() => (typeof DB !== 'undefined') && DB.isConnected() === true),
       variant === 'v2doc' ? '（init() の無い SDK）' : '');
    ok(tag + '0件のレポートでも落ちない', errs.filter(e => /9220|No records/.test(e)).length === 0);
    ok(tag + 'getRecords を正しいパラメータ名で呼んでいる',
       calls.get.length > 0 && calls.get.every(q => q.report_name && q.max_records && !q.reportName),
       calls.get.length + '回');
    /* 追加・更新まで動かしているアプリなら、その痕跡も見る */
    if (calls.add.length) {
      ok(tag + 'addRecords を正しい形で呼んでいる',
         calls.add.every(q => q.form_name && q.payload && q.payload.data && !Array.isArray(q.payload.data)),
         calls.add.length + '回');
    }
    if (calls.update.length) {
      ok(tag + '更新（' + calls.update[0].fn + '）を正しい形で呼んでいる',
         calls.update.every(q => q.report_name && q.id && q.payload && q.payload.data),
         calls.update.length + '回');
    }
    ok(tag + 'ページエラー・コンソールエラーがない', errs.length === 0);
    errs.forEach(e => report.push(tag + e));
    await ctx.close();
  }

  {
    const { ctx, frame, errs } = await open(browser, 'v2doc', true);
    ok('[iframe・v2doc] Creator と同じく iframe の中でも接続する',
       await frame.evaluate(() => (typeof DB !== 'undefined') && DB.isConnected() === true));
    errs.forEach(e => report.push('[iframe・v2doc] ' + e));
    await ctx.close();
  }
  {
    /* ここではアプリがエラー画面を出す（console.error も出る）のが正しい動きなので、エラーは数えない */
    const { ctx, frame } = await open(browser, 'none', true);
    ok('[iframe・SDKなし] デモモードに落ちない（エラー画面で止まる）',
       await frame.evaluate(() => (typeof DB !== 'undefined') && !(typeof DB.isDemo === 'function' && DB.isDemo())));
    await ctx.close();
  }

  console.log('\n--- エラー ---');
  console.log(report.length ? report.join('\n') : 'なし');
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch(function (e) {
  console.error('検証中に止まりました: ' + (e && e.message ? e.message : e));
  console.error('widget.html のパスが正しいか、画面が起動しているかを確認してください。');
  process.exit(2);
});
