/*
 * SDK の呼び方が正しいかを、モックで検証する。
 *
 *   node verify/sdk-mock-test.js <path/to/app/widget.html>
 *
 * 間違ったパラメータ名（reportName など）を渡すと即エラーになるモックを注入するので、
 * これが通れば snake_case で呼べていることが保証される。
 *
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
const path = require('path');

const target = process.argv[2];
if (!target) { console.error('使い方: node verify/sdk-mock-test.js <app/widget.html>'); process.exit(2); }
const url = 'file://' + path.resolve(target);

(async () => {
  const errs = [];
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/zohostatic|ERR_|net::/i.test(m.text())) errs.push('CONSOLE: ' + m.text());
  });

  /* 正しいパラメータ名しか受け付けないモック */
  await page.addInitScript(() => {
    window.__calls = { get: [], add: [], update: [] };
    const ROWS = {};   // 0件のときもエラーを返す挙動を再現する
    window.ZOHO = {
      CREATOR: {
        init: () => Promise.resolve(),
        UTIL: { getInitParams: () => ({ loginUser: 'test@example.co.jp' }) },
        DATA: {
          getRecords: (q) => {
            window.__calls.get.push(q);
            if (!q || !q.report_name) return Promise.reject(new Error('report_name がありません: ' + JSON.stringify(q)));
            if (!q.max_records) return Promise.reject(new Error('max_records がありません'));
            if (q.reportName || q.pageSize || q.page) return Promise.reject(new Error('camelCase のパラメータが混ざっています'));
            const rows = ROWS[q.report_name];
            if (!rows || !rows.length) return Promise.reject({ code: 9220, message: 'No records found' });
            return Promise.resolve({ data: rows });
          },
          addRecords: (q) => {
            window.__calls.add.push(q);
            if (!q.form_name) return Promise.reject(new Error('form_name がありません'));
            if (q.formName) return Promise.reject(new Error('camelCase（formName）が使われています'));
            if (!q.payload || !q.payload.data) return Promise.reject(new Error('payload.data がありません'));
            if (Array.isArray(q.payload.data)) return Promise.reject(new Error('payload.data は配列ではなくオブジェクトです'));
            return Promise.resolve({ data: { ID: String(Date.now()) } });
          },
          updateRecord: (q) => {
            window.__calls.update.push(q);
            if (!q.report_name || !q.id || !q.payload || !q.payload.data) {
              return Promise.reject(new Error('updateRecord のパラメータが不足しています'));
            }
            return Promise.resolve({ data: { ID: q.id } });
          }
        }
      }
    };
  });

  await page.goto(url);
  await page.waitForTimeout(3000);

  const ok = (label, cond, extra) => {
    console.log((cond ? '✓ ' : '✗ ') + label + (extra ? '  ' + extra : ''));
    if (!cond) errs.push(label);
  };

  const calls = await page.evaluate(() => window.__calls);
  ok('Creator 接続として起動する',
     await page.evaluate(() => (typeof DB !== 'undefined') && DB.isConnected() === true));
  ok('0件のレポートでも落ちない', errs.filter(e => /9220|No records/.test(e)).length === 0);
  ok('getRecords を正しいパラメータ名で呼んでいる',
     calls.get.length > 0 && calls.get.every(q => q.report_name && q.max_records && !q.reportName),
     calls.get.length + '回');

  /* 追加・更新まで動かしているアプリなら、その痕跡も見る */
  if (calls.add.length) {
    ok('addRecords を正しい形で呼んでいる',
       calls.add.every(q => q.form_name && q.payload && q.payload.data && !Array.isArray(q.payload.data)),
       calls.add.length + '回');
  }
  if (calls.update.length) {
    ok('updateRecord を正しい形で呼んでいる',
       calls.update.every(q => q.report_name && q.id && q.payload && q.payload.data),
       calls.update.length + '回');
  }

  console.log('\n--- エラー ---');
  console.log(errs.length ? errs.join('\n') : 'なし');
  await browser.close();
  process.exit(errs.length ? 1 : 0);
})();
