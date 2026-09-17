/*
 * デモモード（Creator 未接続）で画面が動くかを確認する。
 *
 *   node verify/demo-smoke-test.js <path/to/app/widget.html>
 *
 * アップロード前にここを通しておくと、Creator 上での確認が1往復で済む。
 */
const { chromium } = require('playwright');
const path = require('path');

const target = process.argv[2];
if (!target) { console.error('使い方: node verify/demo-smoke-test.js <app/widget.html>'); process.exit(2); }
const url = 'file://' + path.resolve(target);
const exe = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

(async () => {
  const errs = [];
  const browser = await chromium.launch({ executablePath: exe });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/zohostatic|ERR_|net::/i.test(m.text())) errs.push('CONSOLE: ' + m.text());
  });

  await page.goto(url);
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload();
  /* SDK の読み込み失敗を待ってデモモードに落ちるまで */
  await page.waitForTimeout(8000);

  const ok = (label, cond, extra) => {
    console.log((cond ? '✓ ' : '✗ ') + label + (extra ? '  ' + extra : ''));
    if (!cond) errs.push(label);
  };

  ok('デモモードで起動する', await page.evaluate(() => (typeof DB !== 'undefined') && DB.isDemo() === true));
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
})();
