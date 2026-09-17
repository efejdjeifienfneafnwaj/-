/* コース編集画面（とくにテストの選択肢）が実際に直せるかを確かめる */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const serveAsset = require('./_部品を返す');

const FILE = path.join(__dirname, '..', 'lms-widget', 'app', 'widget.html');
const html = fs.readFileSync(FILE, 'utf8');

let ok = 0, ng = 0;
function check(name, cond, extra){
  if(cond){ ok++; console.log('  ✅ ' + name); }
  else    { ng++; console.log('  ❌ ' + name + (extra ? '　（' + extra + '）' : '')); }
}

(async () => {
  const srv = http.createServer((q, s) => {
    if(serveAsset(q, s)) return;
    s.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); s.end(html);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port + '/';

  const browser = await chromium.launch({
    executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox']
  });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));

  console.log('① 管理画面に入る');
  await page.goto(base);
  await page.click('#gAdm');
  await page.waitForSelector('#apA');
  await page.fill('#apA', 'test1234');
  await page.fill('#apB', 'test1234');
  await page.click('#apGo');
  await page.waitForSelector('#main .wrap');
  check('管理画面が開いた', true);

  console.log('② コースを作って、テストの設問を足す');
  await page.evaluate(() => route('acourses'));
  await page.waitForSelector('#acNew');
  await page.click('#acNew');
  await page.waitForSelector('#ceTab');
  await page.click('#ceTab button[data-t="quiz"]');
  await page.waitForSelector('#ceAddQ');
  await page.click('#ceAddQ');
  await page.waitForSelector('[data-qc="0|0"]');
  check('設問が1つ増えた', (await page.$$('[data-qc="0|0"]')).length === 1);

  console.log('③ 選択肢の欄がちゃんとした幅で出ること');
  const w = await page.$eval('[data-qc="0|0"]', e => e.getBoundingClientRect().width);
  check('選択肢の入力欄が十分な幅（' + Math.round(w) + 'px）', w > 200, Math.round(w) + 'px');

  console.log('④ 選択肢が実際に打ち込めること');
  await page.fill('[data-qq="0"]', '障害者虐待の類型に含まれないものはどれですか。');
  const texts = ['身体的虐待', '経済的虐待', '業務的虐待', '心理的虐待'];
  for(let j = 0; j < 4; j++) await page.fill('[data-qc="0|' + j + '"]', texts[j]);
  for(let j = 0; j < 4; j++){
    const v = await page.inputValue('[data-qc="0|' + j + '"]');
    check('選択肢' + (j+1) + 'に「' + texts[j] + '」が入る', v === texts[j], v);
  }

  console.log('⑤ 文字を打っても、正解の丸が勝手に動かないこと');
  await page.check('[data-qa="0|2"]');
  await page.click('[data-qc="0|0"]');
  await page.type('[data-qc="0|0"]', 'あ');
  const a2 = await page.$eval('[data-qa="0|2"]', e => e.checked);
  const a0 = await page.$eval('[data-qa="0|0"]', e => e.checked);
  check('正解は3番目のまま', a2 === true && a0 === false);
  await page.fill('[data-qc="0|0"]', texts[0]);

  console.log('⑥ 保存して、開き直しても残っていること');
  await page.click('#ceSave');
  await page.waitForSelector('#acNew');
  await page.click('[data-edit]');
  await page.waitForSelector('#ceTab');
  await page.click('#ceTab button[data-t="quiz"]');
  await page.waitForSelector('[data-qc="0|0"]');
  for(let j = 0; j < 4; j++){
    const v = await page.inputValue('[data-qc="0|' + j + '"]');
    check('選択肢' + (j+1) + 'が残っている', v === texts[j], v);
  }
  check('正解の丸が残っている', await page.$eval('[data-qa="0|2"]', e => e.checked));
  check('問題文が残っている',
    (await page.inputValue('[data-qq="0"]')).indexOf('障害者虐待') === 0);

  console.log('⑦ 受講者側でも選択肢がきちんと出ること');
  const lw = await page.evaluate(() => {
    const q = { q:'x', c:['身体的虐待','経済的虐待','業務的虐待','心理的虐待'], a:2 };
    return q.c.length;
  });
  check('選択肢は4つ', lw === 4);

  check('画面のエラーが出ていない（' + errs.join(' / ') + '）', errs.length === 0);

  await browser.close(); srv.close();
  console.log('\n合格 ' + ok + ' 件 / 不合格 ' + ng + ' 件');
  process.exit(ng ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
