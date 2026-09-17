/* 研修ポータル ウィジェットの通し確認（Chromium で実際に開いて操作する）
   使い方: NODE_PATH=<playwright-core のある node_modules> node tools/スモークテスト.js  */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const FILE = path.join(__dirname, '..', 'lms-widget', 'app', 'widget.html');
const html = fs.readFileSync(FILE, 'utf8');

let ok = 0, ng = 0;
function check(name, cond){
  if(cond){ ok++; console.log('  ✅ ' + name); }
  else    { ng++; console.log('  ❌ ' + name); }
}

(async () => {
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port + '/';

  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));

  const sideLabels = () => page.$$eval('#side .nav-i span, #side .nav-s',
    els => els.map(e => e.textContent.trim()));
  /* 画面が広いときは左メニューが出しっぱなし。狭いときだけ ☰ を押す */
  const openSide = async () => {
    if(await page.isVisible('#burger')) await page.click('#burger');
    await page.waitForTimeout(80);
  };

  async function loginAsLearner(){
    await page.waitForSelector('#gName');
    await page.fill('#gName', '山田 太郎');
    await page.selectOption('#gDept', { index: 1 });
    await page.selectOption('#gGrp',  { index: 1 });
    await page.click('#gGo');
    await page.waitForSelector('#app.on');
  }

  console.log('① 上の帯の「ユーザー／管理」切り替えが消えていること');
  await page.goto(base);
  check('ソースに vsw が無い', !html.includes('vsw'));
  check('入口に #vsw が無い', (await page.$('#vsw')) === null);
  check('入口に「管理者の方はこちら」がある', (await page.$('#gAdm')) !== null);

  console.log('② 受講者は管理画面への道がどこにも無いこと');
  await loginAsLearner();
  check('#vsw が無い', (await page.$('#vsw')) === null);
  await openSide();
  const L1 = await sideLabels();
  check('左メニューに管理系が出ない',
    !L1.some(t => /管理画面|受講者の画面|権限|配信|名簿/.test(t)));
  check('左メニューに受講者用の項目が出る', L1.some(t => /研修コース/.test(t)));

  console.log('③ 入口→暗証番号→管理画面');
  await ctx.clearCookies();
  await page.evaluate(() => { try{ localStorage.clear(); }catch(e){} });
  await page.goto(base);
  await page.click('#gAdm');
  await page.waitForSelector('#apA');
  await page.fill('#apA', 'test1234');
  await page.fill('#apB', 'test1234');
  await page.click('#apGo');
  await page.waitForSelector('#main .wrap');
  await page.waitForTimeout(150);
  await openSide();
  const A1 = await sideLabels();
  check('管理画面の左メニューに「受講者の画面を見る」がある',
    A1.some(t => t === '受講者の画面を見る'));

  console.log('④ 管理⇄受講者の行き来');
  await page.click('#side [data-act="asuser"]');
  await page.waitForTimeout(150);
  await openSide();
  const A2 = await sideLabels();
  check('受講者側に切り替わる', A2.some(t => /研修コース/.test(t)));
  check('「管理画面にもどる」がある', A2.some(t => t === '管理画面にもどる'));
  await page.click('#side [data-act="aadmin"]');
  await page.waitForTimeout(150);
  await openSide();
  const A3 = await sideLabels();
  check('管理画面にもどれる', A3.some(t => t === '受講者の画面を見る'));

  console.log('⑤ 開きなおすと、また入口の暗証番号からしか入れないこと');
  /* 端末には admin=true が残ったまま、受講者として入りなおす */
  await page.evaluate(() => { try{ localStorage.removeItem('lms_me'); }catch(e){} });
  await page.goto(base);
  await loginAsLearner();
  await openSide();
  const R1 = await sideLabels();
  check('「管理画面にもどる」が出ない', !R1.some(t => t === '管理画面にもどる'));
  check('「受講者の画面を見る」も出ない', !R1.some(t => t === '受講者の画面を見る'));

  console.log('⑥ 暗証番号を間違えると入れないこと');
  await page.evaluate(() => { try{ localStorage.removeItem('lms_me'); }catch(e){} });
  await page.goto(base);
  await page.click('#gAdm');
  await page.waitForSelector('#apA');
  check('2回目は確認欄が出ない（決定済み）', (await page.$('#apB')) === null);
  await page.fill('#apA', 'wrong');
  await page.click('#apGo');
  await page.waitForTimeout(150);
  check('入力欄のままで管理画面に入らない', (await page.$('#apA')) !== null);
  await page.fill('#apA', 'test1234');
  await page.click('#apGo');
  await page.waitForTimeout(200);
  await openSide();
  const R2 = await sideLabels();
  check('正しい暗証番号なら入れる', R2.some(t => t === '受講者の画面を見る'));

  check('画面のエラーが出ていない（' + errs.join(' / ') + '）', errs.length === 0);

  await browser.close();
  srv.close();
  console.log('\n合格 ' + ok + ' 件 / 不合格 ' + ng + ' 件');
  process.exit(ng ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
