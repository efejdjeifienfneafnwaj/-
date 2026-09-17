/* ログイン画面に並ぶアプリのカード（名前・説明・アイコン）を
   設定画面から変えられること、はじめの状態に戻せることを確かめる */
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

function stub(email, persons){
  return ({ email, persons }) => {
    const db = { Lms_Person: persons.map((p, i) => Object.assign({ ID: String(100 + i) }, p)) };
    const key = n => String(n).replace(/_(Report|Form)$/, '');
    let seq = 1000;
    window.__db = db;
    window.ZOHO = { CREATOR: {
      UTIL: { getInitParams: () => Promise.resolve({ loginUser: email }) },
      DATA: {
        getRecords: q => {
          let rows = (db[key(q.report_name)] || []).slice();
          const conds = [];
          String(q.criteria || '').replace(
            /([A-Za-z_][A-Za-z0-9_]*)\s*==\s*"([^"]*)"/g,
            (m, f, v) => { conds.push([f, v]); return m; });
          if(conds.length) rows = rows.filter(r => conds.every(c => String(r[c[0]] || '') === c[1]));
          if(!rows.length) return Promise.resolve({ code:3100, message:'No records found' });
          return Promise.resolve({ code:3000, data:rows });
        },
        addRecords: q => {
          const k = key(q.form_name); db[k] = db[k] || [];
          const r = Object.assign({}, q.payload.data, { ID: String(++seq) });
          db[k].push(r);
          return Promise.resolve({ code:3000, data:{ ID:r.ID } });
        },
        updateRecordById: q => {
          const k = key(q.report_name), a = db[k] || [];
          const r = a.filter(x => String(x.ID) === String(q.id))[0];
          if(r) Object.assign(r, q.payload.data);
          return Promise.resolve({ code:3000 });
        },
        updateRecords: () => Promise.resolve({ code:3000 }),
        deleteRecordById: () => Promise.resolve({ code:3000 }),
        getRecordCount: () => Promise.resolve({ code:3000, result:{ records_count:0 } })
      }
    }};
  };
}

const OWNER = { person_key:'田中 一郎', person_name:'田中 一郎',
                email:'owner@example.com', dept:'事務', role:'admin' };

const cardText = (page, id, sel) =>
  page.$eval('#gate [data-app="' + id + '"] ' + sel, e => e.textContent.trim());

(async () => {
  const srv = http.createServer((q, s) => {
    if(serveAsset(q, s)) return;
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
  await page.addInitScript(stub('owner@example.com', [OWNER]), { email:'owner@example.com', persons:[OWNER] });
  await page.goto(base);
  await page.waitForSelector('#gate [data-app="lms"]');

  console.log('① はじめの状態');
  check('社内申請のカードが出る', (await page.$('#gate [data-app="shinsei"]')) !== null);
  check('名前ははじめの値', (await cardText(page, 'shinsei', 'b')) === '社内申請');
  check('説明ははじめの値',
    (await cardText(page, 'shinsei', '.hub-s')) === '稟議・経費・休暇の申請と承認');
  /* 「名前がめっちゃ小さいし背景とかぶって見えづらい」への対策。
     アプリの名前は白い札の上に大きく出し、入る人の名前も太く大きく出す */
  const look = await page.evaluate(() => {
    const b = document.querySelector('#gate [data-app="shinsei"] b');
    const card = document.querySelector('#gate [data-app="shinsei"]');
    const name = document.querySelector('#gate .gpill.name b');
    const bg = getComputedStyle(card).backgroundColor.match(/[\d.]+/g).map(Number);
    return { app: parseFloat(getComputedStyle(b).fontSize),
             name: name ? parseFloat(getComputedStyle(name).fontSize) : 0,
             opaque: bg.length < 4 || bg[3] >= .85 };
  });
  check('アプリの名前は 18px 以上', look.app >= 18, look.app + 'px');
  check('アプリの札は白くて写真が透けない', look.opaque);
  check('入る人の名前も 18px 以上', look.name >= 18, look.name + 'px');

  console.log('② 設定画面から名前・説明・アイコンを変える');
  await page.click('#gate [data-app="lms"]');
  await page.waitForSelector('#app.on');
  await page.evaluate(() => route('asettings'));
  await page.waitForSelector('#cfAppsSave');
  check('e-ラーニングの名前は上の欄で変えるので、ここでは触れない',
    await page.$eval('#cfA_lms_n', e => e.disabled) === true);
  /* zip に bg.jpg があるとき、設定画面のプレビューの写真が枠から出て
     画面全体を覆い、設定が「見当たらない」状態になっていた */
  const pv = await page.evaluate(() => {
    const img = document.querySelector('.hero-pv .hero-file');
    if(!img) return { img:false };
    const b = img.getBoundingClientRect(), box = img.parentElement.getBoundingClientRect();
    return { img:true, h:Math.round(b.height), inBox: b.top >= box.top - 1 && b.bottom <= box.bottom + 1 && b.height < 200 };
  });
  check('背景画像のプレビューは枠の中に収まっている（画面を覆わない）', pv.img && pv.inBox, JSON.stringify(pv));
  const covered = await page.evaluate(() => {
    const el = document.elementFromPoint(640, 300);
    return el ? (el.className || el.tagName) : '';
  });
  check('設定画面の中身が前に出ている（画像に隠れていない）', !/hero-file|hero-img/.test(String(covered)), String(covered));
  await page.fill('#cfA_shinsei_n', 'ワークフロー');
  await page.fill('#cfA_shinsei_s', '稟議と経費の申請');
  await page.selectOption('#cfA_shinsei_i', 'medal');
  await page.click('#cfAppsSave');
  await page.waitForTimeout(400);
  check('設定に上書きが入った',
    await page.evaluate(() => config().apps.shinsei.name) === 'ワークフロー');
  check('アイコンも入った',
    await page.evaluate(() => appDef('shinsei').icon) === 'medal');

  console.log('③ ログイン画面に反映される');
  await page.evaluate(() => route('hub'));
  await page.waitForSelector('#gate [data-app="shinsei"]');
  check('カードの名前が変わった', (await cardText(page, 'shinsei', 'b')) === 'ワークフロー');
  check('カードの説明が変わった',
    (await cardText(page, 'shinsei', '.hub-s')) === '稟議と経費の申請');
  /* innerHTML はブラウザが書き直す（<circle/> → <circle></circle>）ので、
     文字列ではなく「どの図形が並んでいるか」で見る。
     メダルは 丸＋リボン、書類（はじめの絵）は 線だけ */
  check('アイコンの絵が差し替わった（メダル＝丸＋リボン）',
    await page.$eval('#gate [data-app="shinsei"] .hub-i svg',
      el => Array.prototype.map.call(el.children, c => c.tagName.toLowerCase()).join(','))
      === 'circle,path');
  check('中の画面の見出しも変わった',
    await page.evaluate(() => appLabel('shinsei')) === 'ワークフロー');

  console.log('④ 触っていないカードは、はじめのまま');
  check('船井コネクトはそのまま', (await cardText(page, 'connect', 'b')) === '船井コネクト');
  check('上書きは触ったカードの分だけ',
    await page.evaluate(() => Object.keys(config().apps).join(',')) === 'shinsei');

  console.log('⑤ はじめの状態に戻せる');
  await page.click('#gate [data-app="lms"]');
  await page.waitForSelector('#app.on');
  await page.evaluate(() => route('asettings'));
  await page.waitForSelector('#cfAppsReset');
  page.once('dialog', d => d.accept());
  await page.click('#cfAppsReset');
  await page.waitForTimeout(400);
  await page.evaluate(() => route('hub'));
  await page.waitForSelector('#gate [data-app="shinsei"]');
  check('名前が戻った', (await cardText(page, 'shinsei', 'b')) === '社内申請');
  check('説明が戻った',
    (await cardText(page, 'shinsei', '.hub-s')) === '稟議・経費・休暇の申請と承認');

  check('画面のエラーが出ていない（' + errs.join(' / ') + '）', errs.length === 0);

  await browser.close();
  srv.close();
  console.log('\n合格 ' + ok + ' 件 / 不合格 ' + ng + ' 件');
  process.exit(ng ? 1 : 0);
})();
