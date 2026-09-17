/* Zoho Creator にログインしている状態を作って、
   「誰が管理画面に入れるか」を確かめる。暗証番号は使わない。 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const serveAsset = require('./_部品を返す');

const html = fs.readFileSync(
  path.join(__dirname, '..', 'lms-widget', 'app', 'widget.html'), 'utf8');

let ok = 0, ng = 0;
function check(name, cond, extra){
  if(cond){ ok++; console.log('  ✅ ' + name); }
  else    { ng++; console.log('  ❌ ' + name + (extra ? '　（' + extra + '）' : '')); }
}

/* ブラウザの中に、Creator の代わりになるものを置く */
function stub(email, persons){
  return ({ email, persons }) => {
    const db = { Lms_Person: persons.map((p, i) =>
      Object.assign({ ID: String(100 + i) }, p)) };
    const key = n => String(n).replace(/_(Report|Form)$/, '');
    let seq = 1000;
    window.__db = db;
    window.ZOHO = { CREATOR: {
      UTIL: { getInitParams: () => Promise.resolve({ loginUser: email }) },
      DATA: {
        getRecords: q => Promise.resolve({ code: 3000, data: (db[key(q.report_name)] || []).slice() }),
        addRecords: q => {
          const k = key(q.form_name); db[k] = db[k] || [];
          const r = Object.assign({}, q.payload.data, { ID: String(++seq) });
          db[k].push(r);
          return Promise.resolve({ code: 3000, data: { ID: r.ID } });
        },
        updateRecordById: q => {
          const a = db[key(q.report_name)] || [];
          const r = a.filter(x => String(x.ID) === String(q.id))[0];
          if(r) Object.assign(r, q.payload.data);
          return Promise.resolve({ code: 3000 });
        },
        updateRecords: () => Promise.resolve({ code: 3000 }),
        deleteRecordById: () => Promise.resolve({ code: 3000 }),
        getRecordCount: () => Promise.resolve({ code: 3000, result: { records_count: 0 } })
      }
    }};
  };
}

const ROSTER = [
  { person_key:'田中 一郎', person_name:'田中 一郎', email:'owner@example.com',
    dept:'本部', title:'総務部長', role:'admin' },
  { person_key:'佐藤 花子', person_name:'佐藤 花子', email:'staff@example.com',
    dept:'製造', title:'主任', role:'learner' },
  { person_key:'鈴木 次郎', person_name:'鈴木 次郎', email:'bucho@example.com',
    dept:'製造', title:'工場長', role:'dept', scope:'製造' }
];

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

  async function open(email, persons){
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    await page.addInitScript(stub(email, persons), { email, persons });
    await page.goto(base);
    await page.waitForSelector('#gate .gate-card, #app.on', { timeout: 15000 });
    await page.waitForTimeout(400);
    /* 入口に本人の名前が出ていれば、e-ラーニングのカードを押して入る */
    if(await page.$('#gate [data-app="lms"]:not([disabled])')){
      const known = await page.$('#gate .ro-lg');
      if(known){ await page.click('#gate [data-app="lms"]'); await page.waitForSelector('#app.on'); await page.waitForTimeout(300); }
    }
    page.__errs = errs;
    return page;
  }
  const admLabel = p => p.$eval('#gAdm', e => e.textContent.trim()).catch(() => null);
  const sideLabels = p => p.$$eval('#side .nav-i span, #side .nav-s, #side .nav-h',
    els => els.map(e => e.textContent.trim()));

  console.log('① 名簿でシステム管理者になっている人');
  let p = await open('owner@example.com', ROSTER);
  check('入口で名前を確かめて、カードを押すだけで入れる', (await p.$('#app.on')) !== null);
  check('暗証番号をきかれない', (await p.$('#apA')) === null);
  check('権限はシステム管理者', await p.evaluate(() => MY_ROLE) === 'admin');
  let L = await sideLabels(p);
  check('メニューは1つで、受講者の項目がある', L.some(t => t === '研修コース'));
  check('同じメニューに管理の項目もある', L.some(t => t === 'コース管理'));
  check('「管理」の見出しが出る', L.some(t => t === '管理'));
  check('設定も出る', L.some(t => t === '設定'));
  check('職員登録も出る', L.some(t => t === '職員登録'));
  check('上の帯は e-ラーニングの名前', (await p.$eval('#topLogo .nm', e => e.textContent)) === '船井e-ラーニング');
  check('コネクトの項目は出ない', !L.some(t => /掲示板|サンクス|メンバー/.test(t)));
  await p.evaluate(() => route('feed'));
  await p.waitForTimeout(250);
  check('e-ラーニングの中から掲示板は開かない', (await p.$('#fdBody')) === null);

  console.log('② ふつうの受講者');
  p = await open('staff@example.com', ROSTER);
  check('権限は受講者', await p.evaluate(() => MY_ROLE) === 'learner');
  L = await sideLabels(p);
  check('受講者の項目だけが出る', L.some(t => t === '研修コース'));
  check('管理の項目は出ない',
    !L.some(t => /管理|設定|権限|一括登録/.test(t)));
  check('コース編集は開けない', !(await p.evaluate(() => canOpen('acedit'))));
  await p.evaluate(() => route('acedit'));
  await p.waitForTimeout(300);
  check('直に呼んでもコース編集は開かない', (await p.$('#ceTab')) === null);

  console.log('③ 権限は2つだけ（システム管理者 と 一般）');
  check('選べる権限は2つ', (await p.evaluate(() => ROLES.map(r => r.label))).length === 2);
  check('その2つは「一般」と「システム管理者」',
    (await p.evaluate(() => ROLES.map(r => r.label))).join('/') === '一般/システム管理者');
  /* 古い名簿に残っている部門管理者・研修管理者は、管理者として扱う */
  p = await open('bucho@example.com', ROSTER);
  check('古い「部門管理者」はシステム管理者として扱う',
    await p.evaluate(() => MY_ROLE) === 'admin');
  L = await sideLabels(p);
  check('管理の項目が全部出る',
    L.some(t => t === 'コース管理') && L.some(t => t === '設定') &&
    L.some(t => t === '職員登録'));

  console.log('④ 名簿がまだ空のとき（最初の1人）');
  p = await open('owner@example.com', []);
  check('入口に「はじめに管理者を登録する」が出る',
    (await admLabel(p)) === 'はじめに管理者を登録する');
  await p.click('#gAdm');
  await p.waitForSelector('#faName');
  check('暗証番号ではなく、名前の登録をきかれる', true);
  check('ログイン中のメールアドレスが出ている',
    (await p.$eval('#main .ro', e => e.textContent.trim())) === 'owner@example.com');
  await p.fill('#faName', '田中 一郎');
  await p.selectOption('#faDept', { index: 1 });
  check('役職の欄は無い（登録は氏名と職種だけ）', (await p.$('#faTitle')) === null);
  await p.click('#faGo');
  await p.waitForTimeout(600);
  check('システム管理者として登録された',
    await p.evaluate(() => { const q = personByEmail('owner@example.com');
      return !!q && q.name === '田中 一郎' && roleOf(q) === 'admin'; }));
  check('管理画面が開いた', await p.evaluate(() => MODE) === 'admin');

  console.log('⑤ 受講者だけ先に取り込まれていて、管理できる人が居ないとき');
  /* 本人も名簿にいる（受講者として）ので入口は通らない。ホームから登録できること */
  p = await open('staff@example.com', [ROSTER[1]]);
  check('ホームに「自分を管理者として登録する」が出る', (await p.$('#hmAdm')) !== null);
  await p.click('#hmAdm');
  await p.waitForSelector('#faName');
  const warn = await p.$eval('#main .note', e => e.textContent).catch(() => '');
  check('すでに登録がある旨の注意が出る', warn.indexOf('1名') >= 0, warn.slice(0, 40));

  console.log('⑤b 管理者がそろっていれば、その案内は出ないこと');
  p = await open('staff@example.com', ROSTER);
  check('ホームに登録の案内は出ない', (await p.$('#hmAdm')) === null);

  console.log('⑤c 一度だれかが名乗り出たら、その入口は二度と出ないこと');
  /* Creator 側で「自分の記録だけ」に絞ると、受講者からは名簿が自分の1行しか
     見えない。名簿を数えるだけだと「まだ管理者がいない」と誤判定してしまう */
  p = await open('owner@example.com', []);
  await p.click('#gAdm');
  await p.waitForSelector('#faName');
  await p.fill('#faName', '田中 一郎');
  await p.selectOption('#faDept', { index: 1 });
  await p.click('#faGo');
  await p.waitForTimeout(500);
  check('設定に「決まった」印が付く', await p.evaluate(() => config().adminClaimed === true));
  check('自分の1行しか見えなくても、もう入口は出ない',
    await p.evaluate(() => {
      /* 受講者から見える名簿が自分の1行だけ、という状況を作る */
      MEM.people = { '渡辺 三郎':{ name:'渡辺 三郎', email:'x@example.com',
                                   dept:'介護職', role:'learner' } };
      return noAdminYet() === false;
    }));

  console.log('⑥ 名簿に無いメールアドレス');
  p = await open('yoso@example.com', ROSTER);
  check('入口に管理者の登録ボタンが出ない', (await admLabel(p)) === null);
  const body = await p.$eval('#gate', e => e.textContent);
  check('登録されていない旨が出る', body.indexOf('登録されていません') >= 0);

  check('画面のエラーが出ていない（' + (p.__errs || []).join(' / ') + '）',
    (p.__errs || []).length === 0);

  await browser.close(); srv.close();
  console.log('\n合格 ' + ok + ' 件 / 不合格 ' + ng + ' 件');
  process.exit(ng ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
