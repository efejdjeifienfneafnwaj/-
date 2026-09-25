/*
 * デモモード（Creator 未接続）で画面が動くかを確認する。
 *
 *   node verify/demo-smoke-test.js <path/to/app/widget.html>
 *
 * アップロード前にここを通しておくと、Creator 上での確認が1往復で済む。
 *
 * 本物の SDK は読み込ませない（Creator 未接続の状態を、ネットワークの有無に関係なく再現する）。
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
if (!target) { console.error('使い方: node verify/demo-smoke-test.js <app/widget.html>'); process.exit(2); }
const url = 'file://' + path.resolve(target);

(async () => {
  const errs = [];
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route(/widgetsdk-min\.js/, r => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/zohostatic|ERR_|net::/i.test(m.text())) errs.push('CONSOLE: ' + m.text());
  });

  await page.goto(url);
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload();
  /* デモモードに切り替わるまで待つ（isDemo が無いアプリは従来どおり時間で待つ） */
  const hasIsDemo = await page.evaluate(() => typeof DB !== 'undefined' && typeof DB.isDemo === 'function').catch(() => false);
  if (hasIsDemo) {
    await page.waitForFunction(() => DB.isDemo() === true, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(800);
  } else {
    await page.waitForTimeout(8000);
  }

  const ok = (label, cond, extra) => {
    console.log((cond ? '✓ ' : '✗ ') + label + (extra ? '  ' + extra : ''));
    if (!cond) errs.push(label);
  };

  /* 判定の関数名はアプリによって違う（isDemo / isConnected）。
     どちらで書かれていても読めるようにし、無ければ落とさずに失敗として報告する。 */
  ok('デモモードで起動する', await page.evaluate(() => {
    if (typeof DB === 'undefined') return false;
    if (typeof DB.isDemo === 'function') return DB.isDemo() === true;
    if (typeof DB.isConnected === 'function') return DB.isConnected() === false;
    return false;
  }));
  ok('画面が描画される', (await page.locator('#view').textContent()).trim().length > 10);
  ok('コンソールエラーがない', errs.length === 0);

  await page.setViewportSize({ width: 375, height: 760 });
  await page.waitForTimeout(400);
  ok('375px幅で横スクロールしない',
     !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)));

  await page.screenshot({ path: 'verify-screenshot.png', fullPage: false });
  console.log('\nスクリーンショット: verify-screenshot.png');
  console.log('--- エラー ---');
  console.log(errs.length ? errs.join('\n') : 'なし');
  await browser.close();
  process.exit(errs.length ? 1 : 0);
})().catch(function (e) {
  /* 想定外の失敗でスタックトレースだけが出ると、何を直せばよいか分からない。
     どこで止まったかを1行で示す。 */
  console.error('検証中に止まりました: ' + (e && e.message ? e.message : e));
  console.error('widget.html のパスが正しいか、画面が起動しているかを確認してください。');
  process.exit(2);
});
