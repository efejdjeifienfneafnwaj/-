/* 職員の登録・編集と、職種の管理を、実際に操作して確かめる */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const html = fs.readFileSync(
  path.join(__dirname, '..', 'lms-widget', 'app', 'widget.html'), 'utf8');

let ok = 0, ng = 0;
function check(name, cond, extra){
  if(cond){ ok++; console.log('  ✅ ' + name); }
  else    { ng++; console.log('  ❌ ' + name + (extra ? '　（' + extra + '）' : '')); }
}

function stub(email, persons){
  return ({ email, persons }) => {
    const db = { Lms_Person: persons.map((p, i) => Object.assign({ ID: String(100 + i) }, p)) };
    const key = n => String(n).replace(/_(Report|Form)$/, '');
    let seq = 1000;
    window.__db = db;
    window.__sent = [];
    window.ZOHO = { CREATOR: {
      UTIL: { getInitParams: () => Promise.resolve({ loginUser: email }) },
      DATA: {
        getRecords: q => Promise.resolve({ code:3000, data:(db[key(q.report_name)] || []).slice() }),
        addRecords: q => {
          const k = key(q.form_name); db[k] = db[k] || [];
          const r = Object.assign({}, q.payload.data, { ID: String(++seq) });
          db[k].push(r); window.__sent.push(['add', k, r]);
          return Promise.resolve({ code:3000, data:{ ID:r.ID } });
        },
        updateRecordById: q => {
          const k = key(q.report_name), a = db[k] || [];
          const r = a.filter(x => String(x.ID) === String(q.id))[0];
          if(r) Object.assign(r, q.payload.data);
          window.__sent.push(['update', k, q.payload.data]);
          return Promise.resolve({ code:3000 });
        },
        updateRecords: () => Promise.resolve({ code:3000 }),
        deleteRecordById: q => {
          const k = key(q.report_name);
          db[k] = (db[k] || []).filter(x => String(x.ID) !== String(q.id));
          window.__sent.push(['delete', k, q.id]);
          return Promise.resolve({ code:3000 });
        },
        getRecordCount: () => Promise.resolve({ code:3000, result:{ records_count:0 } })
      }
    }};
  };
}

const OWNER = { person_key:'田中 一郎', person_name:'田中 一郎',
                email:'owner@example.com', dept:'事務', role:'admin' };
const STAFF = { person_key:'佐藤 はなこ', person_name:'佐藤 はなこ',
                email:'staff@example.com', dept:'介護職', role:'learner' };

(async () => {
  const srv = http.createServer((q, s) => {
    s.writeHead(200, { 'Content-Type':'text/html; charset=utf-8' }); s.end(html);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch({
    executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox']
  });
  const errs = [];
  const ctx = await browser.newContext({ viewport:{ width:1280, height:900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(String(e)));
  await page.addInitScript(stub('owner@example.com', [OWNER, STAFF]),
    { email:'owner@example.com', persons:[OWNER, STAFF] });
  await page.goto(base);
  await page.waitForSelector('#app.on');
  await page.waitForTimeout(400);

  console.log('① 職員の登録・編集がメニューから開けること');
  const side = await page.$$eval('#side .nav-i span, #side .nav-s',
    els => els.map(e => e.textContent.trim()));
  check('「職員の登録・編集」がある', side.some(t => t === '職員の登録・編集'));
  check('「職種」がある', side.some(t => t === '職種'));
  await page.evaluate(() => route('aimport'));
  await page.waitForSelector('#p1n');

  console.log('② 1人ずつ登録できること（氏名と職種だけ）');
  check('入力欄は氏名・職種・メール・権限の4つ',
    (await page.$('#p1n')) && (await page.$('#p1d')) &&
    (await page.$('#p1m')) && (await page.$('#p1r')) !== null);
  check('社員番号の欄は無い', (await page.$('#p1e')) === null);
  check('グループの欄は無い', (await page.$('#p1g')) === null);
  await page.fill('#p1n', '鈴木 次郎');
  await page.selectOption('#p1d', '看護職');
  await page.fill('#p1m', 'suzuki@example.com');
  await page.selectOption('#p1r', 'dept');
  await page.click('#p1Go');
  await page.waitForTimeout(400);
  check('名簿に入った', await page.evaluate(() => !!people()['鈴木 次郎']));
  check('職種が入っている', await page.evaluate(() => people()['鈴木 次郎'].dept) === '看護職');
  check('権限が部門管理者になった',
    await page.evaluate(() => roleOf(people()['鈴木 次郎'])) === 'dept');

  console.log('③ 職種を選ばないと登録できないこと');
  await page.fill('#p1n', '欠け 太郎');
  await page.click('#p1Go');
  await page.waitForTimeout(250);
  check('登録されない', !(await page.evaluate(() => !!people()['欠け 太郎'])));

  console.log('④ 登録済みの人を編集できること');
  await page.click('[data-ed="佐藤 はなこ"]');
  await page.waitForSelector('#pen');
  check('いまの氏名が入っている', (await page.inputValue('#pen')) === '佐藤 はなこ');
  check('いまの職種が選ばれている', (await page.inputValue('#ped')) === '介護職');
  check('いまの権限が選ばれている', (await page.inputValue('#per')) === 'learner');
  await page.selectOption('#ped', '事務');
  await page.selectOption('#per', 'admin');
  await page.click('#peGo');
  await page.waitForTimeout(400);
  check('職種が変わった', await page.evaluate(() => people()['佐藤 はなこ'].dept) === '事務');
  check('管理者に変えられた',
    await page.evaluate(() => roleOf(people()['佐藤 はなこ'])) === 'admin');

  console.log('⑤ 氏名を直すと、受講記録も一緒に付け替わること');
  await page.evaluate(() => {
    MEM.records['佐藤 はなこ|c1v1|2026'] = { t:'', dur:600, pos:10 };
    RID.records['佐藤 はなこ|c1v1|2026'] = '900';
    MEM.quizzes['佐藤 はなこ|c1|2026'] = { score:3, total:3, passed:true };
    cacheFlush('records'); cacheFlush('quizzes');
  });
  await page.click('[data-ed="佐藤 はなこ"]');
  await page.waitForSelector('#pen');
  await page.fill('#pen', '佐藤 花子');
  await page.click('#peGo');
  await page.waitForTimeout(500);
  check('新しい氏名で名簿にいる', await page.evaluate(() => !!people()['佐藤 花子']));
  check('古い氏名は消えた', !(await page.evaluate(() => !!people()['佐藤 はなこ'])));
  check('受講記録が付け替わった',
    await page.evaluate(() => !!MEM.records['佐藤 花子|c1v1|2026'] &&
                              !MEM.records['佐藤 はなこ|c1v1|2026']));
  check('レコード番号も一緒に動いた',
    await page.evaluate(() => RID.records['佐藤 花子|c1v1|2026']) === '900');
  check('テストの記録も付け替わった',
    await page.evaluate(() => !!MEM.quizzes['佐藤 花子|c1|2026']));
  check('メールアドレスは変わっていない',
    await page.evaluate(() => people()['佐藤 花子'].email) === 'staff@example.com');

  console.log('⑥ 同じ氏名には変えられないこと');
  await page.click('[data-ed="佐藤 花子"]');
  await page.waitForSelector('#pen');
  await page.fill('#pen', '田中 一郎');
  await page.click('#peGo');
  await page.waitForTimeout(350);
  check('田中さんは1人のまま',
    await page.evaluate(() => people()['田中 一郎'].email) === 'owner@example.com');
  check('佐藤さんも残っている', await page.evaluate(() => !!people()['佐藤 花子']));
  const esc0 = await page.$('#peNo');
  if(esc0) await esc0.click();
  await page.waitForTimeout(200);

  console.log('⑦ 職種を足す・名前を直す・消す');
  await page.evaluate(() => route('ajobs'));
  await page.waitForSelector('#jbNew');
  await page.fill('#jbNew', '送迎');
  await page.click('#jbAdd');
  await page.waitForTimeout(300);
  check('職種が足せた', (await page.evaluate(() => jobs())).indexOf('送迎') >= 0);
  const idx = await page.evaluate(() => jobs().indexOf('看護職'));
  await page.fill('[data-jb="' + idx + '"]', '看護師');
  await page.click('#jbSave');
  await page.waitForTimeout(400);
  check('職種の名前が変わった', (await page.evaluate(() => jobs())).indexOf('看護師') >= 0);
  check('その職種の人も付け替わった',
    await page.evaluate(() => people()['鈴木 次郎'].dept) === '看護師');
  page.once('dialog', d => d.accept());
  const di = await page.evaluate(() => jobs().indexOf('送迎'));
  await page.click('[data-jbdel="' + di + '"]');
  await page.waitForTimeout(350);
  check('職種が消せた', (await page.evaluate(() => jobs())).indexOf('送迎') < 0);

  console.log('⑧ 名簿から削除できること');
  /* 送信待ちが片づくまで待つ（レコード番号が付いてから消す） */
  await page.waitForFunction(() => Object.keys(SYNC.pend).length === 0, null,
    { timeout: 15000 });
  await page.evaluate(() => route('aimport'));
  await page.waitForSelector('#p1n');
  await page.click('[data-ed="鈴木 次郎"]');
  await page.waitForSelector('#peDel');
  page.once('dialog', d => d.accept());
  await page.click('#peDel');
  await page.waitForTimeout(400);
  check('名簿から消えた', !(await page.evaluate(() => !!people()['鈴木 次郎'])));
  check('Creator の行も消した',
    await page.evaluate(() => (window.__sent || []).some(x => x[0] === 'delete')));
  check('Creator 側にも残っていない',
    await page.evaluate(() => !(window.__db.Lms_Person || [])
      .some(r => r.person_name === '鈴木 次郎')));

  console.log('⑨ 受講者には職種の管理が見えないこと');
  const p2 = await ctx.newPage();
  p2.on('pageerror', e => errs.push(String(e)));
  await p2.addInitScript(stub('staff2@example.com',
    [OWNER, { person_key:'渡辺 三郎', person_name:'渡辺 三郎',
              email:'staff2@example.com', dept:'介護職', role:'learner' }]),
    { email:'staff2@example.com', persons:[OWNER,
      { person_key:'渡辺 三郎', person_name:'渡辺 三郎',
        email:'staff2@example.com', dept:'介護職', role:'learner' }] });
  await p2.goto(base);
  await p2.waitForSelector('#app.on');
  await p2.waitForTimeout(400);
  const s2 = await p2.$$eval('#side .nav-i span, #side .nav-s',
    els => els.map(e => e.textContent.trim()));
  check('「職種」が出ない', !s2.some(t => t === '職種'));
  check('「職員の登録・編集」が出ない', !s2.some(t => t === '職員の登録・編集'));
  await p2.evaluate(() => route('ajobs'));
  await p2.waitForTimeout(300);
  check('直に呼んでも開かない', (await p2.$('#jbNew')) === null);

  check('画面のエラーが出ていない（' + errs.join(' / ') + '）', errs.length === 0);

  await browser.close(); srv.close();
  console.log('\n合格 ' + ok + ' 件 / 不合格 ' + ng + ' 件');
  process.exit(ng ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
