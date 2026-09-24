/**
 * 送迎表スクリプト（スプレッドシートだけで完結する版）
 *
 * 先方がすること
 *   ・名簿が変わったら ①② を直す（1時間以内に自動で送迎表へ反映）
 *   ・「月曜の送迎表」などのシートを開いて見る
 *   ・使えない車・お休みの方がいる日は、そのシートの上の黄色い欄に書く（数十秒で組み直す）
 *
 * このスクリプトが自動でやること（1時間ごと。名簿が変わっていなければ何もしない）
 *   住所 → 座標（③座標）
 *   区間の移動時間（④実測。Googleマップで測る。一度測った区間は二度と測らない）
 *   曜日ごとの送迎表（配車の計算は下の「配車の計算」。配車ロジック.py と同じ結果になる）
 *
 * ②利用者一覧の曜日セルは、先方の書き方をそのまま読む。
 *   ○(迎え14:10、送り17:55)
 *   ○(迎え14:45、送りなし)
 *   ○(自宅迎え9:40、送り16:05)          … 「自宅」「祖父母宅」などの場所つき
 *   ○(迎え14:10/クラブ活動あり15:00、送り18:05)   … 「/」の後ろは別案（その日だけ使える）
 *   ○(迎えなし、送りなし/送りあり：14:15)          … 普段は無し。別案の日だけ送る
 *   ○(自力16:00、送り17:50)               … 「自力」の区間は送迎しない
 *   ○                                     … F列・G列の時刻を使う
 *   14:35                                 … その曜日だけのお迎え時刻
 *
 * APIキーは不要。Apps Scriptの無料枠で動く。
 */

var SH_FAC   = '①施設・車両設定';
var SH_USER  = '②利用者一覧';
var SH_GEO   = '③座標';
var SH_REAL  = '④実測';
var SH_CHECK = '⚠要確認';
var SHEET_SUFFIX = '曜の送迎表';          // 「月曜の送迎表」など

var DAYS         = ['月', '火', '水', '木', '金', '土', '日'];
var NEAR_K       = 10;                  // 各住所から近い何件まで実測するか
var TIME_MEASURE = 3 * 60 * 1000;       // 実測に使う時間の上限（残りで送迎表を作る。全体の上限は6分）

// 送迎表シートの入力欄（C列の3〜6行目）。チャットもこの欄を書き換える
var IN_ROW_OFFV = 3, IN_ROW_OFFU = 4, IN_ROW_ALT = 5, IN_ROW_PIN = 6, IN_COL = 3;
var OUT_ROW = 9;                         // 送迎表を書き始める行（その上の行は「組み直しています」の表示用）


/* ══════════════════════════════════════════════════════════
   メニュー
   ══════════════════════════════════════════════════════════ */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🚐 送迎')
    .addItem('💬 Geminiと話す', 'Geminiと話す')
    .addItem('今すぐ送迎表を作り直す', '今すぐ反映する')
    .addSeparator()
    .addItem('【初回】自動更新をONにする', '自動更新をONにする')
    .addItem('【初回】GeminiのAPIキーを登録する', 'APIキーを登録する')
    .addToUi();
}

/** メニュー：今すぐ反映する（結果を画面に出す） */
function 今すぐ反映する() {
  var r = 更新する_();
  var msg = r.busy ? '別の処理が動いています。少し待ってからもう一度押してください。' :
    '送迎表を作り直しました\n\n' +
    '利用者：' + r.users + '名　車両：' + r.vehicles + '台\n' +
    '座標：新しく調べた ' + r.geoNew + '件' + (r.geoNg ? '（見つからない ' + r.geoNg + '件）' : '') + '\n' +
    '実測：新しく測った ' + r.realNew + '区間' +
    (r.realLeft ? '\n　　　残り ' + r.realLeft + '区間は、次の自動更新で続きを測ります（それまでは直線距離で見積もり）' : '') + '\n\n' +
    (r.issues ? '⚠ 確認が必要なことが ' + r.issues + '件あります。「' + SH_CHECK + '」シートを見てください。'
              : '確認が必要なことはありません。');
  SpreadsheetApp.getUi().alert(msg);
}

/** メニュー：1時間ごとの自動更新と、入力欄の見張りを仕掛ける（重複しない） */
function 自動更新をONにする() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var f = t.getHandlerFunction();
    if (f === '自動更新' || f === '入力が変わった' || f === '自動反映') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('自動更新').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('入力が変わった').forSpreadsheet(ss).onEdit().create();
  今すぐ反映する();
}

/** 1時間ごとに呼ばれる。名簿が変わっていなくて、測り残しも無ければ何もしない */
function 自動更新() {
  var props = PropertiesService.getDocumentProperties();
  if (名簿の指紋_() === props.getProperty('LAST_HASH') && props.getProperty('PENDING') !== '1') return;
  更新する_();
}

/** 送迎表シートの黄色い欄（使わない車・お休み・別案）が変わったら、その曜日だけ組み直す */
function 入力が変わった(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet(), name = sh.getName();
  if (name.slice(-SHEET_SUFFIX.length) !== SHEET_SUFFIX) return;
  var r = e.range.getRow(), c = e.range.getColumn();
  if (c > IN_COL || c + e.range.getNumColumns() - 1 < IN_COL) return;
  if (r > IN_ROW_PIN || r + e.range.getNumRows() - 1 < IN_ROW_OFFV) return;

  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(60 * 1000)) return;
  try {
    var ss = sh.getParent();
    sh.getRange(OUT_ROW - 1, 1).setValue('⏳ 組み直しています…').setFontColor('#1a73e8');
    SpreadsheetApp.flush();
    var fac = 施設を読む_(ss), parsed = 利用者を読む_(ss, fac);
    var day = name.slice(0, name.length - SHEET_SUFFIX.length);
    曜日の送迎表を作る_(ss, day, fac, parsed.rides, 保存済みの座標_(ss), 保存済みの実測_(ss));
  } finally {
    lock.releaseLock();
  }
}


/* ══════════════════════════════════════════════════════════
   本体：読む → 座標 → 実測 → 送迎表
   ══════════════════════════════════════════════════════════ */

function 更新する_() {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(1000)) return { busy: true };
  try {
    var start  = new Date().getTime();
    var ss     = SpreadsheetApp.getActiveSpreadsheet();
    var fac    = 施設を読む_(ss);
    var parsed = 利用者を読む_(ss, fac);
    var issues = parsed.issues.slice();
    if (!fac.addr)            issues.push(['①施設', '施設住所が入っていません']);
    if (!fac.vehicles.length) issues.push(['①施設', '車両が1台も入っていません（10行目から 車両名・定員数）']);

    var addrs = [];
    if (fac.addr) addrs.push(fac.addr);
    parsed.rides.forEach(function (r) { addrs.push(r.addr); });
    var g = 座標をそろえる_(ss, uniq_(addrs), fac.pref);
    g.issues.forEach(function (x) { issues.push(x); });

    var m = 実測をそろえる_(ss, g.pos, fac.addr, start);

    var days = DAYS.filter(function (d) { return parsed.rides.some(function (r) { return r.day === d; }); });
    days.forEach(function (d) { 曜日の送迎表を作る_(ss, d, fac, parsed.rides, g.pos, m.real); });
    // 送迎の無くなった曜日のシートは消す
    DAYS.forEach(function (d) {
      var sh = ss.getSheetByName(d + SHEET_SUFFIX);
      if (sh && days.indexOf(d) < 0) ss.deleteSheet(sh);
    });

    要確認シートに書く_(ss, issues);

    var props = PropertiesService.getDocumentProperties();
    props.setProperty('LAST_HASH', 名簿の指紋_());
    props.setProperty('PENDING', m.left ? '1' : '0');

    return { users: parsed.users, vehicles: fac.vehicles.length, geoNew: g.done, geoNg: g.ng,
             realNew: m.done, realLeft: m.left, issues: issues.length };
  } finally {
    lock.releaseLock();
  }
}

/** ①② の中身から作る指紋。変わっていなければ自動更新をとばす */
function 名簿の指紋_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), s = '';
  [SH_FAC, SH_USER].forEach(function (n) {
    var sh = ss.getSheetByName(n);
    if (sh && sh.getLastRow()) s += JSON.stringify(sh.getRange(1, 1, sh.getLastRow(), Math.max(1, sh.getLastColumn())).getDisplayValues());
  });
  var d = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8);
  return Utilities.base64Encode(d);
}

/** ③座標 に保存してある座標（入力欄の組み直し用。新しく調べはしない） */
function 保存済みの座標_(ss) {
  var sh = ss.getSheetByName(SH_GEO), pos = {};
  if (!sh || sh.getLastRow() < 2) return pos;
  sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function (v) {
    var a = String(v[0] || '').trim();
    if (a && v[1] !== '' && v[2] !== '') pos[a] = [Number(v[1]), Number(v[2])];
  });
  return pos;
}

/** ④実測 に保存してある移動時間（同上） */
function 保存済みの実測_(ss) {
  var sh = ss.getSheetByName(SH_REAL), real = {};
  if (!sh || sh.getLastRow() < 2) return real;
  sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function (v) {
    var a = String(v[0] || '').trim(), b = String(v[1] || '').trim();
    if (a && b && v[2] !== '') real[a + '||' + b] = real[b + '||' + a] = Number(v[2]);
  });
  return real;
}

/* ══════════════════════════════════════════════════════════
   ①施設・車両設定 を読む
   ══════════════════════════════════════════════════════════ */

function 施設を読む_(ss) {
  var sh = ss.getSheetByName(SH_FAC);
  if (!sh) throw new Error(SH_FAC + ' シートがありません');
  var vals = sh.getRange(1, 1, Math.max(sh.getLastRow(), 15), 4).getDisplayValues();
  return 施設を解釈_(vals);
}

/** 表示値の2次元配列から施設情報を取り出す（テストしやすいようシートから切り離してある） */
function 施設を解釈_(vals) {
  var out = { name: '', addr: '', rawAddr: '', pref: '', mode: '放デイ', stop: null, depart: '9:00', vehicles: [] };
  // 車両は「車両名」の見出し行の次から。
  // （1行目のタイトル「①施設・車両設定」にも“車両設定”の文字があるので、それを目印にしない）
  var inVeh = false;
  for (var i = 0; i < vals.length; i++) {
    var a = norm_(vals[i][0]), b = String(vals[i][1] || '').trim();
    if (!inVeh) {
      if (a.indexOf('施設名') === 0)   out.name = b;
      if (a.indexOf('施設住所') === 0) out.rawAddr = b;
      if (a.indexOf('事業区分') === 0 && b) out.mode = (b.indexOf('介護') >= 0) ? '介護' : '放デイ';
      if (a.indexOf('乗降') === 0 && Number(b) > 0) out.stop = Number(b);
      if (a.indexOf('出発時刻') === 0 && 時刻文字に_(b)) out.depart = 時刻文字に_(b);
      if (a.indexOf('車両名') === 0) inVeh = true;
      continue;
    }
    var nm = String(vals[i][0] || '').trim();
    var cap = Number(全角を半角に_(String(vals[i][2] || '')).replace(/[^\d]/g, ''));
    if (nm && cap > 0) out.vehicles.push({ name: nm, cap: cap });
  }
  var pm = out.rawAddr.match(/^(東京都|北海道|(?:京都|大阪)府|.{2,3}県)/);
  out.pref = pm ? pm[1] : '';
  out.addr = out.rawAddr ? 住所を整える_(out.rawAddr, '') : '';
  if (out.stop == null) out.stop = (out.mode === '介護') ? 10 : 5;
  return out;
}


/* ══════════════════════════════════════════════════════════
   ②利用者一覧 を読む
   ══════════════════════════════════════════════════════════ */

function 利用者を読む_(ss, fac) {
  var sh = ss.getSheetByName(SH_USER);
  if (!sh) throw new Error(SH_USER + ' シートがありません');
  var vals = sh.getRange(1, 1, sh.getLastRow(), Math.max(13, sh.getLastColumn())).getDisplayValues();
  return 利用者を解釈_(vals, fac.pref);
}

/**
 * 表示値の2次元配列から、曜日ごとの乗車（rides）を作る。
 * ride = { day, trip:'お迎え'|'お送り', name, place, addr, time, note, cond }
 *   cond … 条件つき（「送りあり：14:15」のように、指示があった日だけ乗る）
 */
function 利用者を解釈_(vals, pref) {
  var headRow = -1;
  for (var r = 0; r < Math.min(10, vals.length); r++) {
    if (vals[r].some(function (v) { return norm_(v).indexOf('氏名') >= 0; })) { headRow = r; break; }
  }
  if (headRow < 0) throw new Error(SH_USER + ' に「氏名」の見出しが見つかりません');

  var head = vals[headRow], col = { day: {}, extra: [] };
  for (var c = 0; c < head.length; c++) {
    var h = norm_(head[c]);
    if (!h) continue;
    if      (h.indexOf('氏名') >= 0)         col.name    = c;
    else if (h.indexOf('お迎え先住所') >= 0) col.addrAm  = c;
    else if (h.indexOf('お送り先住所') >= 0) col.addrPm  = c;
    else if (h.indexOf('お迎え先') >= 0)     col.placeAm = c;
    else if (h.indexOf('お送り先') >= 0)     col.placePm = c;
    else if (h.indexOf('お迎え時刻') >= 0)   col.timeAm  = c;
    else if (h.indexOf('お送り時刻') >= 0)   col.timePm  = c;
    else if (DAYS.indexOf(h) >= 0)           col.day[h]  = c;
    else if (h.indexOf('住所') >= 0)         col.extra.push({ c: c, label: h.replace(/[（(].*$/, '').replace(/住所.*$/, '') });
  }
  if (col.name == null) throw new Error('氏名の列が見つかりません');

  function cell(row, k) { return (k == null) ? '' : String(row[k] == null ? '' : row[k]).trim(); }

  var rides = [], issues = [], users = 0;
  for (var r2 = headRow + 1; r2 < vals.length; r2++) {
    var row = vals[r2], name = cell(row, col.name).replace(/\s+/g, ' ');
    if (!name || /^例[）)]/.test(name)) continue;
    users++;
    var rowNo = r2 + 1;
    var base = {
      placeAm: cell(row, col.placeAm), addrAm: cell(row, col.addrAm),
      placePm: cell(row, col.placePm), addrPm: cell(row, col.addrPm),
      timeAm: 時刻文字に_(cell(row, col.timeAm)), timePm: 時刻文字に_(cell(row, col.timePm)),
      extra: col.extra.map(function (e) { return { label: e.label, addr: cell(row, e.c) }; })
    };

    var anyDay = false;
    DAYS.forEach(function (d) {
      if (col.day[d] == null) return;
      var v = cell(row, col.day[d]);
      if (!v) return;
      anyDay = true;
      var legs = 曜日セルを読む_(v, base);
      legs.forEach(function (lg) {
        if (lg.warn) { issues.push([rowNo + '行 ' + name, d + '曜：' + lg.warn]); return; }
        if (!lg.addr) {
          issues.push([rowNo + '行 ' + name, d + '曜の' + lg.trip + '：「' + (lg.place || lg.trip + '先') + '」の住所が入っていません']);
          return;
        }
        rides.push({ day: d, trip: lg.trip, name: name, place: lg.place, rawAddr: lg.addr,
                     addr: 住所を整える_(lg.addr, pref), time: lg.time, note: lg.note || '', cond: lg.cond || '', alt: lg.alt || null });
      });
    });
    if (!anyDay) issues.push([rowNo + '行 ' + name, '利用曜日に何も入っていないため、配車に出てきません（休止中なら問題ありません）']);
  }
  return { rides: rides, issues: issues, users: users };
}

/**
 * 曜日セル1つを読む。戻り値は乗車の配列 [{trip, place, addr, time, note, cond} | {warn}]
 */
var JIRIKI = /自力|各自|保護者/;     // この言葉がある区間は送迎しない

function 曜日セルを読む_(v, base) {
  var s = 全角を半角に_(String(v)).trim();
  var m = s.match(/[（(]([\s\S]*)[)）]/);
  var inner = m ? m[1].trim() : s.replace(/^[○〇◯●]/, '').trim();

  // 「自力16:00」だけ → その日は送迎なし
  if (!/迎え|送り/.test(inner) && JIRIKI.test(inner)) return [];

  // 「○」だけ、または時刻だけ → F列・G列の時刻と、お迎え先／お送り先を使う
  if (!/迎え|送り/.test(inner)) {
    var t = 時刻文字に_(inner);
    if (inner && !t) return [{ warn: '「' + v + '」の書き方が読めません' }];
    var out = [];
    if (base.addrAm) out.push({ trip: 'お迎え', place: base.placeAm, addr: base.addrAm, time: t || base.timeAm });
    if (base.addrPm) out.push({ trip: 'お送り', place: base.placePm, addr: base.addrPm, time: base.timePm });
    return out;
  }

  var legs = [];
  inner.split(/[、,]/).forEach(function (part) {
    part = part.trim();
    if (!part) return;
    if (JIRIKI.test(part) && !/迎え|送り/.test(part)) return;   // 「自力16:00」＝自分で来る・帰る。送迎なし
    var segs = part.split(/[\/／]/).map(function (x) { return x.trim(); }).filter(String);
    var first = segs[0].match(/^(.*?)(迎え|送り)(.*)$/);
    if (!first) { legs.push({ warn: '「' + part + '」の書き方が読めません' }); return; }
    var trip  = (first[2] === '迎え') ? 'お迎え' : 'お送り';
    var label = first[1].replace(/[：:]/g, '').trim();          // 自宅・祖父母宅 など
    var rest  = first[3];
    var none  = /なし/.test(rest);
    var time  = 時刻文字に_(rest) || (trip === 'お迎え' ? base.timeAm : base.timePm);
    var place = 場所を探す_(trip, label, base);

    // 「/」の後ろ＝条件つきの別案
    var alts = segs.slice(1).map(function (x) {
      var at = 時刻文字に_(x);
      return { label: x.replace(/\d{1,2}\s*[:：]\s*\d{2}/, '').replace(/[：:]/g, '').trim(), time: at };
    });

    if (none) {
      // 普段は無し。「送りあり：14:15」のような別案があれば条件つきで載せる
      alts.forEach(function (a) {
        if (!a.time) return;
        legs.push({ trip: trip, place: place.place, addr: place.addr, time: a.time,
                    cond: a.label || (trip === 'お迎え' ? '迎えあり' : '送りあり') });
      });
      return;
    }
    var note = alts.filter(function (a) { return a.time; })
                   .map(function (a) { return (a.label || '別案') + 'の日は' + a.time; }).join('、');
    var alt = alts.filter(function (a) { return a.time; })[0] || null;
    legs.push({ trip: trip, place: place.place, addr: place.addr, time: time, note: note, alt: alt });
  });
  return legs;
}

/** 「自宅」「祖父母宅」などの場所名から住所を探す */
function 場所を探す_(trip, label, base) {
  var defPlace = (trip === 'お迎え') ? base.placeAm : base.placePm;
  var defAddr  = (trip === 'お迎え') ? base.addrAm  : base.addrPm;
  if (!label) return { place: defPlace, addr: defAddr };

  var keys = [label, label.replace(/宅$/, '')].filter(String);
  function hit(p) { return p && keys.some(function (k) { return p.indexOf(k) >= 0; }); }
  if (hit(base.placeAm) && base.addrAm) return { place: label, addr: base.addrAm };
  if (hit(base.placePm) && base.addrPm) return { place: label, addr: base.addrPm };
  for (var i = 0; i < base.extra.length; i++) {
    if (hit(base.extra[i].label) && base.extra[i].addr) return { place: label, addr: base.extra[i].addr };
  }
  return { place: label, addr: '' };      // 見つからない → 呼び出し側で「住所なし」の警告
}


/* ══════════════════════════════════════════════════════════
   文字の下ごしらえ
   ══════════════════════════════════════════════════════════ */

function norm_(s) { return String(s == null ? '' : s).replace(/\s+/g, ''); }

function uniq_(a) {
  var seen = {}, out = [];
  a.forEach(function (x) { if (x && !seen[x]) { seen[x] = 1; out.push(x); } });
  return out;
}

function 全角を半角に_(s) {
  return String(s)
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
    .replace(/[：]/g, ':').replace(/[（]/g, '(').replace(/[）]/g, ')').replace(/[／]/g, '/');
}

/**
 * 'H:MM' の文字にする。「14:30」「14：30」「午後2:30」「2:30 PM」のどれでも読める。
 * 読めなければ ''。
 */
function 時刻文字に_(v) {
  if (v === '' || v == null) return '';
  var s = 全角を半角に_(String(v)).trim();
  var pm = /午後|P\.?M\.?/i.test(s), am = /午前|A\.?M\.?/i.test(s);
  var m = s.match(/(\d{1,2})\s*:\s*(\d{1,2})/);
  if (!m) return '';
  var h = Number(m[1]), mi = (m[2].length === 1) ? '0' + m[2] : m[2];
  if (pm && h < 12) h += 12;
  if (am && h === 12) h = 0;
  if (!(h >= 0 && h <= 23) || Number(mi) > 59) return '';
  return h + ':' + mi;
}

/**
 * Googleマップで外れにくい住所にする。これが座標・実測の「キー」にもなる。
 *   ・全角英数字を半角に、ハイフンのゆれをそろえる
 *   ・番地の後ろの建物名・部屋番号を落とす（空白で区切られた後ろ）
 *   ・都道府県が無ければ施設と同じ都道府県を頭に付ける
 */
function 住所を整える_(addr, pref) {
  var s = 全角を半角に_(addr)
    .replace(/(\d)\s*[‐‑‒–—―−－ー]\s*(?=\d)/g, '$1-')
    .replace(/[　]/g, ' ').trim();
  // 空白で区切り、数字が出てきた語までを残す（「○○町 1-2-3」のように町名と番地の間の空白は詰めて残す）
  var toks = s.split(/\s+/), keep = [];
  for (var i = 0; i < toks.length; i++) {
    keep.push(toks[i]);
    if (/\d/.test(keep.join(''))) break;
  }
  s = keep.join('');
  if (pref && !/^(東京都|北海道|(?:京都|大阪)府|.{2,3}県)/.test(s)) s = pref + s;
  return s;
}

/** 住所から市区町村名を取り出す（Googleの解釈と食い違っていないかの確認用） */
function 市区町村_(addr) {
  var s = String(addr).replace(/^(東京都|北海道|(?:京都|大阪)府|.{2,3}県)/, '');
  var m = s.match(/^(.+?[市区町村])/);
  return m ? m[1] : '';
}


/* ══════════════════════════════════════════════════════════
   ③座標（一度調べた住所は二度と調べない）
   ══════════════════════════════════════════════════════════ */

function 座標をそろえる_(ss, addrs, pref) {
  var sh = ss.getSheetByName(SH_GEO);
  if (!sh) {
    sh = ss.insertSheet(SH_GEO);
    sh.getRange(1, 1, 1, 4).setValues([['住所', '緯度', '経度', 'Googleの解釈']])
      .setFontWeight('bold').setBackground('#e8f0fb');
    sh.setColumnWidth(1, 300); sh.setColumnWidth(4, 360); sh.setFrozenRows(1);
  }
  var pos = {}, rowOf = {}, last = sh.getLastRow();
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, 3).getValues().forEach(function (v, i) {
      var a = String(v[0] || '').trim();
      if (!a) return;
      rowOf[a] = i + 2;
      if (v[1] !== '' && v[2] !== '') pos[a] = [Number(v[1]), Number(v[2])];
    });
  }

  var geo = Maps.newGeocoder().setLanguage('ja').setRegion('jp');
  var done = 0, ng = 0, issues = [];
  addrs.forEach(function (a) {
    if (pos[a]) return;
    var r = rowOf[a] || (sh.getLastRow() + 1);
    rowOf[a] = r;
    sh.getRange(r, 1).setValue(a);
    var res = geo.geocode(a);
    if (res.status === 'OK' && res.results && res.results.length) {
      var loc = res.results[0].geometry.location, fa = res.results[0].formatted_address;
      var city = 市区町村_(a);
      if (city && fa.indexOf(city) < 0) {
        // 別の市町村に飛んだ座標は使わない（黙って違う場所で配車されるのが一番危ない）
        sh.getRange(r, 2, 1, 2).clearContent();
        sh.getRange(r, 4).setValue('⚠ ' + fa).setBackground('#ffe0e0');
        issues.push(['住所 ' + a, 'Googleが別の場所（' + fa + '）と解釈しました。②の住所を直してください']);
        ng++;
      } else {
        sh.getRange(r, 2, 1, 3).setValues([[Number(loc.lat.toFixed(6)), Number(loc.lng.toFixed(6)), fa]]);
        sh.getRange(r, 4).setBackground(null);
        pos[a] = [Number(loc.lat.toFixed(6)), Number(loc.lng.toFixed(6))];
        done++;
      }
    } else {
      sh.getRange(r, 4).setValue('⚠ みつかりません（' + res.status + '）').setBackground('#ffe0e0');
      issues.push(['住所 ' + a, 'Googleマップで見つかりません。番地を丁目までにするなど、書き方を直してください']);
      ng++;
    }
    Utilities.sleep(150);
  });
  // 前回見つからなかった住所も、要確認に出し続ける
  return { pos: pos, done: done, ng: ng, issues: issues };
}


/* ══════════════════════════════════════════════════════════
   ④実測（事業所↔全住所 と 各住所から近い10件。測った区間は二度と測らない）
   ══════════════════════════════════════════════════════════ */

function 直線km_(a, b) {
  var R = 6371, t = Math.PI / 180;
  var dLa = (b[0] - a[0]) * t, dLo = (b[1] - a[1]) * t;
  var h = Math.sin(dLa / 2) * Math.sin(dLa / 2) +
          Math.cos(a[0] * t) * Math.cos(b[0] * t) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 測るべき区間の一覧（住所の組）。テストしやすいよう純粋な関数にしてある */
function 測る区間_(pos, facAddr) {
  var pts = Object.keys(pos).sort();
  var want = {}, out = [];
  function add(a, b) {
    if (a === b) return;
    var k = a < b ? a + '||' + b : b + '||' + a;
    if (!want[k]) { want[k] = 1; out.push(a < b ? [a, b] : [b, a]); }
  }
  pts.forEach(function (a) {
    if (facAddr && pos[facAddr] && a !== facAddr) add(facAddr, a);
    pts.filter(function (b) { return b !== a; })
       .map(function (b) { return { b: b, d: 直線km_(pos[a], pos[b]) }; })
       .sort(function (x, y) { return x.d - y.d; })
       .slice(0, NEAR_K)
       .forEach(function (x) { add(a, x.b); });
  });
  return out;
}

function 実測をそろえる_(ss, pos, facAddr, start) {
  var sh = ss.getSheetByName(SH_REAL);
  if (!sh) {
    sh = ss.insertSheet(SH_REAL);
    sh.getRange(1, 1, 1, 4).setValues([['出発', '到着', '分', '測った日']])
      .setFontWeight('bold').setBackground('#e8f0fb');
    sh.setColumnWidth(1, 300); sh.setColumnWidth(2, 300); sh.setFrozenRows(1);
  }
  var real = {}, last = sh.getLastRow();
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, 3).getValues().forEach(function (v) {
      var a = String(v[0] || '').trim(), b = String(v[1] || '').trim();
      if (a && b && v[2] !== '') real[a + '||' + b] = real[b + '||' + a] = Number(v[2]);
    });
  }

  var todo = 測る区間_(pos, facAddr).filter(function (p) { return real[p[0] + '||' + p[1]] == null; });
  var done = 0, buf = [];
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy/MM/dd');
  for (var i = 0; i < todo.length; i++) {
    if (new Date().getTime() - start > TIME_MEASURE) break;
    var a = todo[i][0], b = todo[i][1], min = null;
    try {
      var res = Maps.newDirectionFinder().setOrigin(pos[a][0], pos[a][1]).setDestination(pos[b][0], pos[b][1])
        .setMode(Maps.DirectionFinder.Mode.DRIVING).setLanguage('ja').getDirections();
      if (res && res.status === 'OK' && res.routes && res.routes.length) {
        min = Math.round(res.routes[0].legs[0].duration.value / 60);
      }
    } catch (e) {
      Logger.log('測定エラー: ' + e.message);
      if (/上限|quota|Service invoked too many times/i.test(e.message)) break;   // 今日の無料枠を使い切った
    }
    done++;
    if (min != null) {
      real[a + '||' + b] = real[b + '||' + a] = min;
      buf.push([a, b, min, today]);
    }
    if (buf.length >= 20) { sh.getRange(sh.getLastRow() + 1, 1, buf.length, 4).setValues(buf); buf = []; }
    Utilities.sleep(100);
  }
  if (buf.length) sh.getRange(sh.getLastRow() + 1, 1, buf.length, 4).setValues(buf);
  return { real: real, done: done, left: todo.length - done };
}



/* ══════════════════════════════════════════════════════════
   便に分ける
   ══════════════════════════════════════════════════════════ */

/**
 * 時刻が WAVE_GAP 分以上あく所で便を分ける。
 * 例）保育園のお迎え（10時台）と小学校のお迎え（14時台）は別の便にし、
 *     どちらの便でも全車を使えるようにする。時刻の無い方は最後の便に入れる。
 */
var WAVE_GAP = 60;
function 便に分ける_(list) {
  function tm(r) { var m = String(r.time || '').match(/^(\d+):(\d+)$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
  var timed = list.filter(function (r) { return tm(r) != null; }).sort(function (a, b) { return tm(a) - tm(b); });
  var untimed = list.filter(function (r) { return tm(r) == null; });
  var waves = [], cur = [], prev = null;
  timed.forEach(function (r) {
    var t = tm(r);
    if (prev != null && t - prev >= WAVE_GAP) { waves.push(cur); cur = []; }
    cur.push(r); prev = t;
  });
  if (cur.length) waves.push(cur);
  if (untimed.length) { if (waves.length) waves[waves.length - 1] = waves[waves.length - 1].concat(untimed); else waves.push(untimed); }
  return waves;
}

function 時間帯_(list) {
  var ts = list.map(function (r) { return r.time; }).filter(String);
  if (!ts.length) return '時刻指定なし';
  var mins = ts.map(function (t) { var p = t.split(':'); return Number(p[0]) * 60 + Number(p[1]); });
  var lo = Math.min.apply(null, mins), hi = Math.max.apply(null, mins);
  var f = function (m) { return Math.floor(m / 60) + ':' + ('0' + (m % 60)).slice(-2); };
  return lo === hi ? f(lo) : f(lo) + '〜' + f(hi);
}

/* ══════════════════════════════════════════════════════════
   配車の計算（配車ロジック.py を一行ずつ移したもの。版 2026-09-24）
   Python版と同じ結果になるよう、乱数（Pythonの random）と
   四捨五入（Pythonの round は偶数への丸め）も同じ動きにしてある。
   ══════════════════════════════════════════════════════════ */

var LOGIC_VERSION  = '2026-09-24';
var RUN2_MIN_STOPS = 6;    // これ未満の軒数なら、時短目的では分けない
var RUN2_REQ_GAIN  = 10;   // 平均でこれ以上早くなること（分）
var RUN2_MAX_LOSS  = 10;   // 最後の方がこれ以上遅くなるなら分けない（分）
var RUN2_PENALTY   = 60;   // 2便が必要になる配車には、このぶん不利な点をつける
var LATE_WEIGHT    = 5;    // 遅れ1分を、走行何分ぶんの損と数えるか。0にすると配車ロジック.py と同じ動き
                           // （0だと走行時間を縮めるために1台へ詰め込み、指定時刻に遅れる組み方を選んでしまう）

/** Python の random.Random と同じ乱数（メルセンヌ・ツイスタ） */
function PyRandom_(seed) {
  var N = 624, mt = new Array(N), mti = N + 1;
  function initGenrand(s) {
    mt[0] = s >>> 0;
    for (mti = 1; mti < N; mti++) {
      mt[mti] = (Math.imul(1812433253, mt[mti - 1] ^ (mt[mti - 1] >>> 30)) + mti) >>> 0;
    }
  }
  function initByArray(key) {
    initGenrand(19650218);
    var i = 1, j = 0, k = Math.max(N, key.length);
    for (; k; k--) {
      mt[i] = ((mt[i] ^ Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), 1664525)) + key[j] + j) >>> 0;
      i++; j++;
      if (i >= N) { mt[0] = mt[N - 1]; i = 1; }
      if (j >= key.length) j = 0;
    }
    for (k = N - 1; k; k--) {
      mt[i] = ((mt[i] ^ Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), 1566083941)) - i) >>> 0;
      i++;
      if (i >= N) { mt[0] = mt[N - 1]; i = 1; }
    }
    mt[0] = 0x80000000;
  }
  function genrand() {
    var y, kk;
    if (mti >= N) {
      for (kk = 0; kk < N - 397; kk++) {
        y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff);
        mt[kk] = mt[kk + 397] ^ (y >>> 1) ^ ((y & 1) ? 0x9908b0df : 0);
      }
      for (; kk < N - 1; kk++) {
        y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff);
        mt[kk] = mt[kk + (397 - N)] ^ (y >>> 1) ^ ((y & 1) ? 0x9908b0df : 0);
      }
      y = (mt[N - 1] & 0x80000000) | (mt[0] & 0x7fffffff);
      mt[N - 1] = mt[396] ^ (y >>> 1) ^ ((y & 1) ? 0x9908b0df : 0);
      mti = 0;
    }
    y = mt[mti++];
    y ^= (y >>> 11);
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= (y >>> 18);
    return y >>> 0;
  }
  function randbelow(n) {
    var k = 32 - Math.clz32(n), r = genrand() >>> (32 - k);
    while (r >= n) r = genrand() >>> (32 - k);
    return r;
  }
  initByArray([Math.abs(seed) >>> 0]);
  return {
    random: function () { var a = genrand() >>> 5, b = genrand() >>> 6; return (a * 67108864 + b) / 9007199254740992; },
    randrange: function (n) { return randbelow(n); },
    choice: function (seq) { return seq[randbelow(seq.length)]; },
    sample: function (pop, k) {
      var n = pop.length, res = [], i, j;
      var setsize = 21;
      if (k > 5) setsize += Math.pow(4, Math.ceil(Math.log(k * 3) / Math.log(4)));
      if (n <= setsize) {
        var pool = pop.slice();
        for (i = 0; i < k; i++) { j = randbelow(n - i); res.push(pool[j]); pool[j] = pool[n - i - 1]; }
      } else {
        var sel = {};
        for (i = 0; i < k; i++) { j = randbelow(n); while (sel[j]) j = randbelow(n); sel[j] = 1; res.push(pop[j]); }
      }
      return res;
    }
  };
}

/** Python の round(x)（ちょうど半分は偶数へ） */
function pyRound_(x) {
  var r = Math.round(x);
  if (Math.abs(x % 1) === 0.5) r = 2 * Math.round(x / 2);
  return r;
}

/**
 * 配車を組む。戻り値は Python版の print と同じ行の配列。
 *   cfg      … CONFIG（mode, trip, facility, facility_name, fac_pos, depart, auto_depart, stop, turn, factor, use_run2, seed）
 *   vehicles … [{name, cap, wc_max, wc_seats, walker_max}]
 *   users    … [{name, addr, pos:[緯度,経度], mob, target, note}]
 *   real     … {'住所A\u0000住所B': 分}（片方向だけ入っていればよい）
 */
function 配車する_(cfg, VEHICLES, USERS, REAL, OFF_VEHICLES, OFF_USERS) {
  var OUT = [];
  function print(s) { OUT.push(s == null ? '' : s); }
  var PINS = cfg.pins || {};                   // 固定 {氏名: 車両名}。無ければ配車ロジック.py と同じ動き
  var META = { rows: [], late: [], unassigned: [] };   // 画面・チャット用の結果（誰がどの車か）
  OUT.meta = META;
  var LEG = { real: 0, est: 0 };
  var SEP = '\u0000';
  var realKeys = Object.keys(REAL);

  function toM(s) {
    if (!s) return null;
    var p = String(s).split(':');
    if (p.length !== 2 || !/^\s*[+-]?\d+\s*$/.test(p[0]) || !/^\s*[+-]?\d+\s*$/.test(p[1])) return null;
    return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
  }
  function toHm(m) {
    if (m == null) return '';
    m = pyRound_(m);
    var h = Math.floor(m / 60), mm = m - h * 60;
    return h + ':' + (mm < 10 ? '0' : '') + mm;
  }
  function samePos(a, b) { return a != null && b != null && a[0] === b[0] && a[1] === b[1]; }
  function haversine(a, b) {
    if (a == null || b == null) return 0.0;
    var d = Math.PI / 180;
    var lat1 = a[0] * d, lon1 = a[1] * d, lat2 = b[0] * d, lon2 = b[1] * d;
    var dlat = lat2 - lat1, dlon = lon2 - lon1;
    var h = Math.pow(Math.sin(dlat / 2), 2) + Math.cos(lat1) * Math.cos(lat2) * Math.pow(Math.sin(dlon / 2), 2);
    return 2 * 6371.0 * Math.asin(Math.min(1.0, Math.sqrt(h)));
  }
  function legmin(a, b, aa, ab) {
    if (aa && ab && aa === ab) return 0;
    if (aa && ab) {
      var v = REAL[aa + SEP + ab];
      if (v == null) v = REAL[ab + SEP + aa];
      if (v != null) { LEG.real++; return Math.max(0, pyRound_(v)); }
    }
    if (a == null || b == null) return 0;
    if (samePos(a, b)) return 0;
    LEG.est++;
    return Math.max(1, pyRound_(haversine(a, b) * cfg.factor));
  }
  function walkerMax(v) { return v.walker_max == null ? 99 : Number(v.walker_max); }
  function capAt(v, wc) { return Number(v.cap) - (Number(v.wc_seats == null ? 1 : v.wc_seats) - 1) * wc; }
  function addLoad(load, group) {
    var n = load[0], wc = load[1], wk = load[2];
    group.forEach(function (c) { if (c.mob === 'wc') wc++; else if (c.mob === 'walker') wk++; n++; });
    return [n, wc, wk];
  }
  function canFit(v, load, group) {
    var l = addLoad(load, group);
    if (l[1] > Number(v.wc_max || 0)) return false;
    if (l[2] > walkerMax(v)) return false;
    var lim = capAt(v, l[1]);
    return lim > 0 && l[0] <= lim;
  }
  function fitCount(v, us) {
    var load = [0, 0, 0], n = 0;
    for (var i = 0; i < us.length; i++) {
      if (!canFit(v, load, [us[i]])) break;
      load = addLoad(load, [us[i]]); n++;
    }
    return n;
  }
  function runsAllowed() { return (cfg.use_run2 && cfg.mode === '介護') ? 2 : 1; }
  function fitsInRuns(v, us, runs) {
    var rest = us.slice();
    for (var r = 0; r < runs; r++) {
      if (!rest.length) return true;
      var k = fitCount(v, rest);
      if (k === 0) return false;
      rest = rest.slice(k);
    }
    return !rest.length;
  }
  function whyNot(v, group) {
    var wc = group.filter(function (c) { return c.mob === 'wc'; }).length;
    var wk = group.filter(function (c) { return c.mob === 'walker'; }).length;
    if (wc && Number(v.wc_max || 0) === 0) return '車いす不可';
    if (wc > Number(v.wc_max || 0))        return '車いす定員';
    if (wk > walkerMax(v))                 return '歩行器の上限';
    return '定員';
  }

  // 手順1　まとまりを作る
  function makeGroups(us) {
    var keys = [], bag = {};
    us.forEach(function (c) {
      var k = c.addr + SEP + c.target;
      if (!bag[k]) { bag[k] = []; keys.push(k); }
      bag[k].push(c);
    });
    var gs = keys.map(function (k) { return bag[k]; });
    var key = function (g) { var t = toM(g[0].target); return t != null ? t : 99 * 60; };
    return gs.map(function (g, i) { return { g: g, i: i }; })
             .sort(function (x, y) { return key(x.g) - key(y.g) || x.i - y.i; })
             .map(function (x) { return x.g; });
  }

  // 手順3　車内の順番
  function orderStops(gidx, groups, departMin) {
    if (gidx.length <= 1) return gidx.slice();
    var items = gidx.map(function (gi) {
      var tg = '';
      for (var q = 0; q < groups[gi].length; q++) if (groups[gi][q].target) { tg = groups[gi][q].target; break; }
      return { pos: groups[gi][0].pos, addr: groups[gi][0].addr || '', target: tg };
    });
    var rest = items.map(function (_, i) { return i; }), nn = [];
    var cur = cfg.fac_pos, curA = cfg.facility;
    while (rest.length) {
      var bi = 0, bm = Infinity;
      for (var k = 0; k < rest.length; k++) {
        var m = legmin(cur, items[rest[k]].pos, curA, items[rest[k]].addr);
        if (m < bm) { bm = m; bi = k; }
      }
      var pick = rest.splice(bi, 1)[0]; nn.push(pick);
      cur = items[pick].pos; curA = items[pick].addr;
    }
    var eta = {}, t = departMin, prev = cfg.fac_pos, prevA = cfg.facility;
    nn.forEach(function (i) {
      t += legmin(prev, items[i].pos, prevA, items[i].addr);
      eta[i] = t;
      t += cfg.stop;
      prev = items[i].pos; prevA = items[i].addr;
    });
    var keyed = nn.map(function (i, p) { var tg = toM(items[i].target); return [tg != null ? tg : eta[i], p, i]; });
    keyed.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]; });
    return keyed.map(function (x) { return gidx[x[2]]; });
  }
  function routeMinutes(gidx, groups) {
    if (!gidx.length) return 0;
    var total = 0, prev = cfg.fac_pos, prevA = cfg.facility;
    gidx.forEach(function (gi) {
      var c = groups[gi][0];
      total += legmin(prev, c.pos, prevA, c.addr || '');
      prev = c.pos; prevA = c.addr || '';
    });
    return total + legmin(prev, cfg.fac_pos, prevA, cfg.facility);
  }
  function ordMap(assign, groups, vehicles, departMin) {
    var m = vehicles.map(function () { return []; });
    assign.forEach(function (vi, gi) { if (vi >= 0) m[vi].push(gi); });
    return m.map(function (g) { return orderStops(g, groups, departMin); });
  }
  function totalScore(assign, groups, vehicles, departMin, noLate) {
    var om = ordMap(assign, groups, vehicles, departMin), total = 0;
    om.forEach(function (g) { if (g.length) total += routeMinutes(g, groups); });
    var lw = noLate ? 0 : ((cfg.late_weight == null) ? LATE_WEIGHT : cfg.late_weight);
    vehicles.forEach(function (v, vi) {
      var seq = [];
      om[vi].forEach(function (gi) { seq = seq.concat(groups[gi]); });
      if (seq.length && !fitsInRuns(v, seq, 1)) total += RUN2_PENALTY;
      if (seq.length && lw > 0) {
        // 指定時刻への遅れ（分）も損として数える
        var rows = buildSchedule(seq, departFor(seq, departMin))[0], late = 0;
        rows.forEach(function (r, i) { if (i === 0 || !r.same) late += r.late; });
        total += lw * late;
      }
    });
    return total;
  }

  // 手順2　貪欲法で割り当てる
  function greedy(groups, vehicles) {
    var load = vehicles.map(function () { return [0, 0, 0]; });
    var held = vehicles.map(function () { return []; });
    var last = vehicles.map(function () { return null; });
    var assign = groups.map(function () { return -1; }), unassigned = [];
    var runs = runsAllowed();
    var order = groups.map(function (_, i) { return i; });
    if (cfg.mode === '介護') {
      var k = function (gi) { return groups[gi].some(function (c) { return c.mob; }) ? 0 : 1; };
      order.sort(function (a, b) { return k(a) - k(b) || a - b; });
    }
    // 固定された組を先に置く（ほかの組はその残りに入れる）
    order = order.filter(function (gi) { return pinOf[gi] >= 0; })
                 .concat(order.filter(function (gi) { return pinOf[gi] < 0; }));
    order.forEach(function (gi) {
      var g = groups[gi], gt = toM(g[0].target);
      gt = gt != null ? gt : 99 * 60;
      if (pinOf[gi] >= 0) {
        var pv = pinOf[gi];
        assign[gi] = pv; load[pv] = addLoad(load[pv], g); held[pv] = held[pv].concat(g); last[pv] = gt;
        return;
      }
      var best = -1, bestSc = Infinity;
      vehicles.forEach(function (v, vi) {
        if (!canFit(v, load[vi], g)) return;
        var tdiff = last[vi] == null ? 0 : Math.abs(gt - last[vi]);
        var pen = (last[vi] != null && tdiff > 30) ? 10000 : 0;
        var sc = pen + load[vi][0];
        if (sc < bestSc) { bestSc = sc; best = vi; }
      });
      if (best < 0 && runs > 1) {
        vehicles.forEach(function (v, vi) {
          if (!fitsInRuns(v, held[vi].concat(g), runs)) return;
          if (best < 0 || load[vi][0] < load[best][0]) best = vi;
        });
      }
      if (best < 0) {
        var rs = {};
        vehicles.forEach(function (v) { rs[whyNot(v, g)] = 1; });
        var reasons = Object.keys(rs).sort();
        if (!reasons.length) reasons = ['車両なし'];
        unassigned.push([g, '全車とも' + reasons.join('・')]);
        return;
      }
      assign[gi] = best;
      load[best] = addLoad(load[best], g);
      held[best] = held[best].concat(g);
      last[best] = gt;
    });
    return [assign, unassigned];
  }

  // 手順4　組み直して改善する
  function isValid(assign, groups, vehicles) {
    var runs = runsAllowed();
    var seats = vehicles.map(function () { return []; });
    for (var gi = 0; gi < assign.length; gi++) {
      var vi = assign[gi];
      if (vi < 0) continue;
      if (vi >= vehicles.length) return false;
      seats[vi] = seats[vi].concat(groups[gi]);
    }
    for (var v = 0; v < vehicles.length; v++) {
      if (seats[v].length && !fitsInRuns(vehicles[v], seats[v], runs)) return false;
    }
    for (var w = 0; w < vehicles.length; w++) {
      var ts = [];
      assign.forEach(function (x, g) { if (x === w) { var t = toM(groups[g][0].target); if (t != null) ts.push(t); } });
      ts.sort(function (a, b) { return a - b; });
      for (var i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] > 30) return false;
    }
    return true;
  }
  function improve(assign, groups, vehicles, departMin) {
    var rnd = PyRandom_(cfg.seed || 0);
    var best = assign.slice(), bestSc = totalScore(best, groups, vehicles, departMin);
    var live = [];
    best.forEach(function (vi, gi) { if (vi >= 0 && pinOf[gi] < 0) live.push(gi); });
    if (live.length < 2) return [best, bestSc, 0];
    var improved = 0;
    for (var it = 0; it < 4000; it++) {
      var trial = best.slice();
      if (rnd.random() < 0.5) {
        var ab = rnd.sample(live, 2), tmp = trial[ab[0]];
        trial[ab[0]] = trial[ab[1]]; trial[ab[1]] = tmp;
      } else {
        var gi = rnd.choice(live);
        trial[gi] = rnd.randrange(vehicles.length);
      }
      if (!isValid(trial, groups, vehicles)) continue;
      var sc = totalScore(trial, groups, vehicles, departMin);
      if (sc < bestSc) { best = trial; bestSc = sc; improved++; }
    }
    return [best, bestSc, improved];
  }

  function reverseDepart() { return cfg.auto_depart == null ? (cfg.mode === '放デイ') : !!cfg.auto_depart; }
  function departFor(seq, def) {
    if (!seq.length || !reverseDepart()) return def;
    var tg = toM(seq[0].target);
    if (tg == null) return def;
    var keep = { real: LEG.real, est: LEG.est };
    var travel = legmin(cfg.fac_pos, seq[0].pos, cfg.facility, seq[0].addr || '');
    LEG.real = keep.real; LEG.est = keep.est;
    return Math.max(0, tg - travel);
  }

  // 手順5　時刻を計算する
  function buildSchedule(seq, departMin) {
    var rows = [], t = departMin, prev = cfg.fac_pos, prevA = cfg.facility, i = 0;
    while (i < seq.length) {
      var j = i;
      while (j + 1 < seq.length && samePos(seq[j + 1].pos, seq[i].pos) && seq[j + 1].target === seq[i].target) j++;
      var chunk = seq.slice(i, j + 1);
      var travel = legmin(prev, chunk[0].pos, prevA, chunk[0].addr || '');
      t += travel;
      var arrive = t, wait = 0, tg = toM(chunk[0].target);
      if (tg != null && tg > arrive) { wait = tg - arrive; arrive = tg; }
      t = arrive + cfg.stop;
      var late = (tg != null && arrive > tg) ? arrive - tg : 0;
      chunk.forEach(function (c, k) {
        rows.push({ c: c, arrive: arrive, depart: t, wait: k === 0 ? wait : 0, late: late,
                    travel: k === 0 ? travel : 0, same: k > 0 });
      });
      prev = chunk[0].pos; prevA = chunk[0].addr || '';
      i = j + 1;
    }
    var back = t + (seq.length ? legmin(prev, cfg.fac_pos, prevA, cfg.facility) : 0);
    return [rows, back];
  }

  // 手順6　2便を使うか判断する
  function splitRun2(seq, v, departMin) {
    if (!cfg.use_run2 || cfg.mode !== '介護') return [seq, [], ''];
    var fit1 = fitCount(v, seq);
    if (fit1 < seq.length) {
      var rest = seq.slice(fit1);
      return [seq.slice(0, fit1), rest.slice(0, fitCount(v, rest)), '1便に乗り切らないため'];
    }
    var st = {};
    seq.forEach(function (c) { st[c.addr] = 1; });
    if (Object.keys(st).length < RUN2_MIN_STOPS) return [seq, [], ''];
    var base = buildSchedule(seq, departMin)[0];
    var sum = function (rs) { return rs.reduce(function (s, r) { return s + r.arrive; }, 0); };
    var mx = function (rs) { return Math.max.apply(null, rs.map(function (r) { return r.arrive; })); };
    var baseAvg = sum(base) / base.length, baseLast = mx(base);
    var best = null;
    for (var cut = 1; cut < seq.length; cut++) {
      var a = seq.slice(0, cut), b = seq.slice(cut);
      if (fitCount(v, a) < a.length || fitCount(v, b) < b.length) continue;
      var ra = buildSchedule(a, departMin), rb = buildSchedule(b, ra[1] + cfg.turn)[0];
      var rows = ra[0].concat(rb);
      var gain = baseAvg - sum(rows) / rows.length, loss = mx(rows) - baseLast;
      if (gain >= RUN2_REQ_GAIN && loss < RUN2_MAX_LOSS) {
        if (best == null || gain > best[0]) best = [gain, a, b];
      }
    }
    if (best) return [best[1], best[2], '分けたほうが平均で' + pyRound_(best[0]) + '分早いため'];
    return [seq, [], ''];
  }

  // ── 実行 ──
  var vehicles = VEHICLES.filter(function (v) { return OFF_VEHICLES.indexOf(v.name) < 0; });
  var users    = USERS.filter(function (c) { return OFF_USERS.indexOf(c.name) < 0; });
  if (!vehicles.length) { print('走れる車がありません'); return OUT; }
  if (!users.length)    { print('送迎する方がいません'); return OUT; }

  var warnCfg = [];
  if (realKeys.length) {
    var keys = {};
    realKeys.forEach(function (k) { var p = k.split(SEP); keys[p[0]] = 1; keys[p[1]] = 1; });
    if (!keys[cfg.facility]) {
      warnCfg.push("CONFIG['facility'] が実測表にありません（いまは「" + cfg.facility + "」）。\n" +
                   '　　実測表に出てくる住所のどれかと一字一句そろえてください。\n' +
                   '　　候補: ' + Object.keys(keys).sort().slice(0, 5).join('／'));
    }
    var miss = users.filter(function (c) { return c.addr && !keys[c.addr]; }).map(function (c) { return c.name; });
    if (miss.length) warnCfg.push('実測表に住所が無い方: ' + miss.slice(0, 5).join('、') + '（その区間は直線距離で見積もります）');
  }

  var departMin = toM(cfg.depart) || 0;
  var groups = makeGroups(users);
  var pinOf = groups.map(function (g) {
    for (var q = 0; q < g.length; q++) {
      var want = PINS[g[q].name];
      if (!want) continue;
      for (var vi = 0; vi < vehicles.length; vi++) if (vehicles[vi].name === want) return vi;
    }
    return -1;
  });
  users.forEach(function (c) {
    var want = PINS[c.name];
    if (want && !vehicles.some(function (v) { return v.name === want; })) {
      print('⚠ ' + c.name + ' を ' + want + ' に固定できません（その車は使わない設定か、名前が違います）');
    }
  });
  var gr = greedy(groups, vehicles), assign = gr[0], unassigned = gr[1];
  var im = improve(assign, groups, vehicles, departMin);
  assign = im[0];
  var improved = im[2];
  // 表示するのは走行時間（遅れの損は入れない）
  var score = totalScore(assign, groups, vehicles, departMin, true);
  var om = ordMap(assign, groups, vehicles, departMin);
  LEG.real = LEG.est = 0;

  print('［配車ロジック ' + LOGIC_VERSION + '］');
  warnCfg.forEach(function (w) { w.split('\n').forEach(function (l, i) { print(i ? l : '⚠ 設定を確認してください: ' + l); }); });
  if (warnCfg.length) print();
  print('【' + (cfg.facility_name || cfg.facility) + '　' + cfg.trip + '】');
  if (reverseDepart()) print('出発時刻 各車とも最初のお迎え時刻から逆算 ／ 乗降 ' + cfg.stop + '分');
  else                 print('一斉出発 ' + cfg.depart + ' ／ 乗降 ' + cfg.stop + '分');
  if (!realKeys.length) print('（移動時間は直線距離 × ' + cfg.factor.toFixed(1) + ' で見積もり）');
  print();

  var warn = [];
  vehicles.forEach(function (v, vi) {
    var gis = om[vi];
    if (!gis.length) return;
    var seq = [];
    gis.forEach(function (gi) { seq = seq.concat(groups[gi]); });
    var sp = splitRun2(seq, v, departMin), run1 = sp[0], run2 = sp[1], reason = sp[2];
    var dep1 = departFor(run1, departMin);
    [run1, run2].forEach(function (part, ri) {
      if (!part.length) return;
      var dep = dep1;
      if (ri === 1) dep = buildSchedule(run1, dep1)[1] + cfg.turn;
      var bs = buildSchedule(part, dep), rows = bs[0], back = bs[1];
      var backNote = '';
      if (rows.length) {
        var lr = rows[rows.length - 1], keep = { real: LEG.real, est: LEG.est };
        var mv = legmin(lr.c.pos, cfg.fac_pos, lr.c.addr || '', cfg.facility);
        LEG.real = keep.real; LEG.est = keep.est;
        backNote = '［帰り＝最後のお宅を出た ' + toHm(lr.depart) + ' ＋ 移動' + mv + '分 ＝ ' + toHm(lr.depart + mv) + '］';
      }
      var label = v.name + '（定員' + v.cap + '名）';
      if (run2.length) label += '　' + (ri + 1) + '便';
      print('■ ' + label);
      print('　事業所出発 ' + toHm(dep) + ' → 帰着 ' + toHm(back) + '（' + (back - dep) + '分）');
      if (backNote) print('　' + backNote);
      if (ri === 1 && reason) print('　※ ' + reason);
      print('| # | 氏名 | 住所 | 到着 | 出発 | 備考 |');
      print('|---|------|------|------|------|------|');
      rows.forEach(function (r, i) {
        var c = r.c, note = [];
        if (c.mob === 'wc')     note.push('車いす');
        if (c.mob === 'walker') note.push('歩行器');
        if (c.target)           note.push('指定' + c.target);
        if (r.wait)             note.push('待機' + r.wait + '分');
        if (r.late)             note.push('⚠' + r.late + '分遅れ');
        if (r.same)             note.push('同じ住所');
        if (c.note)             note.push(c.note);
        if (PINS[c.name] === v.name) note.push('固定');
        META.rows.push({ name: c.name, vehicle: v.name, run: run2.length ? ri + 1 : 1,
                         arrive: toHm(r.arrive), late: r.late });
        print('| ' + (i + 1) + ' | ' + c.name + ' | ' + c.addr + ' | ' + toHm(r.arrive) + ' | ' + toHm(r.depart) + ' | ' + note.join('、') + ' |');
      });
      rows.forEach(function (r) {
        if (r.late) warn.push(r.c.name + ' が指定' + r.c.target + ' に ' + r.late + '分 遅れます');
        if (r.late) META.late.push({ name: r.c.name, min: r.late });
      });
      var ld = addLoad([0, 0, 0], part);
      if (ld[0] > capAt(v, ld[1])) warn.push(v.name + ' が定員を超えています');
      print();
    });
    var boarded = run1.concat(run2);
    seq.forEach(function (c) { if (boarded.indexOf(c) < 0) unassigned.push([[c], '2便でも乗り切らない']); });
  });

  if (unassigned.length) {
    print('⚠ 未割当');
    unassigned.forEach(function (u) { u[0].forEach(function (c) {
      print('　' + c.name + '（' + c.addr + '／' + u[1] + '）');
      META.unassigned.push(c.name);
    }); });
    print();
  }

  print('── 要点 ──');
  print('移動時間の合計 ' + score + '分（往復・' + improved + '回の組み直しで短縮）');
  var tot = LEG.real + LEG.est;
  if (realKeys.length && tot && LEG.real === 0) {
    print('⚠ 実測表が渡されているのに、1区間も使えていません。');
    print('　 住所の書き方が実測表と合っているか確認してください（全部見積もりになっています）');
  } else if (realKeys.length && tot) {
    print('実際に走る ' + tot + '区間のうち ' + LEG.real + '区間（' + pyRound_(LEG.real / tot * 100) + '%）がGoogleマップの実測値です');
    if (LEG.est) print('　残り ' + LEG.est + '区間は直線距離からの見積もりです');
  } else if (!realKeys.length) {
    print('実測表が入っていないため、すべて直線距離からの見積もりです');
  }
  if (warn.length) {
    print('── 注意 ──');
    uniq_(warn).forEach(function (w) { print('　' + w); });
  }
  if (realKeys.length && LEG.real > 0) print('※ 時刻はGoogleマップの実測値をもとに計算しています。当日の道路状況で差が出ます。');
  else                                 print('※ 時刻は座標からの直線距離をもとにした概算です。実際の道路状況とは差が出ます。');
  return OUT;
}

/* ══════════════════════════════════════════════════════════
   曜日ごとの送迎表シート
   ══════════════════════════════════════════════════════════ */

/** 「、」「,」「改行」で区切った名前の一覧（「ヤマダ タロウ」のような氏名の間の空白では区切らない） */
function 名前の一覧_(s) {
  return 全角を半角に_(String(s || '')).split(/[、,，\n]+/).map(function (x) { return x.trim(); }).filter(String);
}
function 名前を比べる形_(s) { return 全角を半角に_(String(s || '')).replace(/[\s　]+/g, ''); }

/**
 * その日の入力欄を当てはめた乗車の一覧と、当てはめられなかった入力の警告を返す。
 * テストしやすいようシートから切り離してある。
 */
function 入力を当てはめる_(dayRides, vehicles, inOffV, inOffU, inAlt, inPin) {
  var warns = [], offV = [];
  名前の一覧_(inOffV).forEach(function (tok) {
    var k = 名前を比べる形_(tok);
    var hit = vehicles.filter(function (v) { return 名前を比べる形_(v.name).indexOf(k) >= 0; });
    if (hit.length === 1) offV.push(hit[0].name);
    else if (!hit.length) warns.push('「' + tok + '」という車が見つかりません（①の車両名を確認してください）');
    else warns.push('「' + tok + '」に当てはまる車が' + hit.length + '台あります。車両名をもっと詳しく書いてください');
  });

  var names = uniq_(dayRides.map(function (r) { return r.name; }));
  function whoIs(list, what) {
    var out = [];
    名前の一覧_(list).forEach(function (tok) {
      var k = 名前を比べる形_(tok);
      var hit = names.filter(function (n) { return 名前を比べる形_(n).indexOf(k) >= 0; });
      if (hit.length === 1) out.push(hit[0]);
      else if (!hit.length) warns.push(what + '「' + tok + '」に当てはまる方が、この曜日にいません');
      else warns.push(what + '「' + tok + '」に当てはまる方が' + hit.length + '名います（' + hit.join('、') + '）。もっと詳しく書いてください');
    });
    return out;
  }
  var offU = whoIs(inOffU, 'お休み');
  var alt  = whoIs(inAlt, '別案');

  var rides = [];
  dayRides.forEach(function (r) {
    if (offU.indexOf(r.name) >= 0) return;
    var useAlt = alt.indexOf(r.name) >= 0;
    if (r.cond) {
      if (useAlt) rides.push(Object.assign({}, r, { cond: '', note: r.cond }));
      return;
    }
    if (useAlt && r.alt) rides.push(Object.assign({}, r, { time: r.alt.time, note: r.alt.label || '別案' }));
    else rides.push(r);
  });
  alt.forEach(function (n) {
    var has = dayRides.some(function (r) { return r.name === n && (r.cond || r.alt); });
    if (!has) warns.push('別案「' + n + '」：②にこの曜日の別案（「/」の後ろ）が書かれていません');
  });

  // 車の固定：「サトウ→1号車」「サトウ→1号車（お迎え）」を「、」で並べる
  var pins = [];
  全角を半角に_(String(inPin || '')).split(/[、,，\n]+/).map(function (x) { return x.trim(); }).filter(String).forEach(function (item) {
    var m = item.match(/^(.+?)\s*(?:→|->|⇒|＞|>)\s*(.+?)\s*(?:\((お迎え|お送り)\))?$/);
    if (!m) { warns.push('車の固定「' + item + '」の書き方が読めません（例：サトウ→1号車）'); return; }
    var who = whoIs(m[1], '車の固定');
    if (who.length !== 1) return;
    var k = 名前を比べる形_(m[2]);
    var hv = vehicles.filter(function (v) { return 名前を比べる形_(v.name).indexOf(k) >= 0; });
    if (hv.length !== 1) { warns.push('車の固定「' + item + '」：「' + m[2] + '」という車が' + (hv.length ? '複数あります' : '見つかりません')); return; }
    pins.push({ name: who[0], vehicle: hv[0].name, trip: m[3] || '' });
  });
  return { rides: rides, offV: offV, pins: pins, warns: warns };
}

/** 1つの曜日について、便ごとに配車して行を作る（シートに書く前の形） */
function 曜日の配車_(day, fac, rides, pos, real, inputs) {
  var vehicles = fac.vehicles.map(function (v) {
    return { name: v.name, cap: v.cap, wc_max: 0, wc_seats: 1, walker_max: null };
  });
  var ap = 入力を当てはめる_(rides.filter(function (r) { return r.day === day; }), vehicles,
                            inputs.offV, inputs.offU, inputs.alt, inputs.pin);
  var blocks = [];
  ['お迎え', 'お送り'].forEach(function (trip) {
    var all = ap.rides.filter(function (r) { return r.trip === trip; });
    var waves = 便に分ける_(all);
    waves.forEach(function (list, wi) {
      var tag = (waves.length > 1) ? '①②③④⑤⑥⑦⑧⑨'.charAt(wi) : '';
      var noPos = uniq_(list.filter(function (r) { return !pos[r.addr]; }).map(function (r) { return r.name; }));
      var users = list.filter(function (r) { return pos[r.addr]; }).map(function (r) {
        return { name: r.name, addr: r.addr, pos: pos[r.addr], mob: '', target: r.time,
                 note: [r.place, r.note].filter(String).join('／') };
      });
      // この便に出てくる住所どうしの実測だけ渡す（配車ロジック.py に渡していた表と同じ）
      var here = uniq_([fac.addr].concat(list.map(function (r) { return r.addr; })));
      var rs = {};
      for (var i = 0; i < here.length; i++) for (var j = i + 1; j < here.length; j++) {
        var v = real[here[i] + '||' + here[j]];
        if (v != null) rs[here[i] + '\u0000' + here[j]] = v;
      }
      var pins = {};
      ap.pins.forEach(function (p) { if (!p.trip || p.trip === trip) pins[p.name] = p.vehicle; });
      var cfg = { mode: fac.mode, trip: trip, facility: fac.addr, facility_name: fac.name,
                  fac_pos: pos[fac.addr] || null, depart: fac.depart, auto_depart: null,
                  stop: fac.stop, turn: 5, factor: 3.0, use_run2: fac.mode === '介護', seed: 0, pins: pins };
      var lines = 配車する_(cfg, vehicles, users, rs, ap.offV, []);
      blocks.push({ title: trip + tag + '（' + 時間帯_(list) + '）' + users.length + '名', trip: trip,
                    lines: lines, meta: lines.meta, noPos: noPos });
    });
  });
  return { blocks: blocks, warns: ap.warns, offV: ap.offV };
}

/** 送迎表シートを作る（入力欄の中身は残す） */
function 曜日の送迎表を作る_(ss, day, fac, rides, pos, real) {
  var name = day + SHEET_SUFFIX;
  var sh = ss.getSheetByName(name);
  if (!sh) {
    // 月→土の順に並ぶよう、前の曜日のシートの後ろに入れる
    var idx = ss.getSheets().length, di = DAYS.indexOf(day);
    for (var k = di - 1; k >= 0; k--) {
      var prev = ss.getSheetByName(DAYS[k] + SHEET_SUFFIX);
      if (prev) { idx = prev.getIndex(); break; }
    }
    sh = ss.insertSheet(name, idx);
  }
  送迎表の枠を作る_(sh, day);          // 前の版のシートでも欄の並びをそろえる（入力の中身は消さない）
  var res = 曜日の配車_(day, fac, rides, pos, real, 入力を読む_(sh));
  送迎表を書く_(sh, res);
  sh.getRange(1, 5).setValue('更新 ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'M/d HH:mm'));
  return res;
}

function 入力を読む_(sh) {
  return {
    offV: sh.getRange(IN_ROW_OFFV, IN_COL).getDisplayValue(),
    offU: sh.getRange(IN_ROW_OFFU, IN_COL).getDisplayValue(),
    alt:  sh.getRange(IN_ROW_ALT,  IN_COL).getDisplayValue(),
    pin:  sh.getRange(IN_ROW_PIN,  IN_COL).getDisplayValue()
  };
}

function 送迎表の枠を作る_(sh, day) {
  sh.getRange(1, 1).setValue(day + '曜日の送迎表').setFontSize(14).setFontWeight('bold');
  sh.getRange(2, 2).setValue('黄色い欄に書くと、数十秒でこの曜日を組み直します（「💬 Geminiと話す」からも書き換えられます）。その日が終わったら消してください。')
    .setFontColor('#888888');
  sh.getRange(IN_ROW_OFFV, 2, 4, 1).setValues([['使わない車'], ['お休みの方'], ['別案で送迎する方'], ['車の固定']]).setFontWeight('bold');
  sh.getRange(IN_ROW_OFFV, IN_COL, 4, 1).setBackground('#fff2cc').setNumberFormat('@').setFontColor('#000000');
  sh.getRange(IN_ROW_OFFV, 4, 4, 1).setValues([
    ['例）シエンタ２号　（複数は「、」で区切る）'],
    ['例）ヤマダ　（名前の一部でよい）'],
    ['②に「送りあり」「クラブ活動あり」など「/」の後ろに別案が書いてある方'],
    ['例）サトウ→1号車、タナカ→2号車（お迎え）　（便を書かなければ両方）']
  ]).setFontColor('#888888').setFontWeight('normal').setBackground(null);
  sh.setColumnWidth(1, 36); sh.setColumnWidth(2, 130); sh.setColumnWidth(3, 280);
  sh.setColumnWidth(4, 56); sh.setColumnWidth(5, 56); sh.setColumnWidth(6, 330);
}

/** 配車の結果（行）をシートに書く */
function 送迎表を書く_(sh, res) {
  var W = 6, rows = [], style = { title: [], car: [], head: [], warn: [], note: [] };
  function add(vals, kind) {
    var r = vals.slice(0, W);
    while (r.length < W) r.push('');
    rows.push(r);
    if (kind) style[kind].push(rows.length);
  }
  res.warns.forEach(function (w) { add(['⚠ ' + w], 'warn'); });
  if (res.offV.length) add(['⚠ ' + res.offV.join('、') + ' を外して組んでいます'], 'warn');
  if (res.warns.length || res.offV.length) add([]);
  if (!res.blocks.length) add(['この曜日の送迎はありません']);

  res.blocks.forEach(function (b) {
    add(['■■ ' + b.title], 'title');
    b.lines.forEach(function (l) {
      if (/^［配車ロジック/.test(l) || /^【/.test(l) || /^\|---/.test(l)) return;
      if (/^\| # \|/.test(l)) { add(['#', '氏名', '住所', '到着', '出発', '備考'], 'head'); return; }
      if (/^\| /.test(l)) { add(l.replace(/^\|\s*|\s*\|$/g, '').split(/\s*\|\s*/), /⚠/.test(l) ? 'warn' : null); return; }
      if (/^■ /.test(l)) { add([l], 'car'); return; }
      // 先方向けの言い方に直す
      var m = l.match(/^⚠ 設定を確認してください: 実測表に住所が無い方: (.*)（その区間は直線距離で見積もります）$/);
      if (m) { add(['※ まだ移動時間を測れていない方：' + m[1] + '（直線距離で見積もり。自動更新で測ります）'], 'note'); return; }
      if (/^⚠ 設定を確認してください: CONFIG/.test(l) || /^　　(実測表に出てくる|候補:)/.test(l)) {
        if (/CONFIG/.test(l)) add(['※ 施設からの移動時間をまだ測れていません（直線距離で見積もり。自動更新で測ります）'], 'note');
        return;
      }
      if (/^⚠ 実測表が渡されているのに/.test(l)) { add(['※ 移動時間をまだ測れていません（直線距離で見積もり）'], 'note'); return; }
      if (/^　 住所の書き方が実測表と/.test(l)) return;
      add([l], /⚠/.test(l) ? 'warn' : (/^※|^（|^出発時刻|^一斉出発|^　/.test(l) ? 'note' : null));
    });
    if (b.noPos.length) add(['⚠ 座標が無いため外した方：' + b.noPos.join('、')], 'warn');
    add([]);
  });

  // 前回の表を消して書き直す（入力欄は残す）
  var last = Math.max(sh.getLastRow(), OUT_ROW);
  sh.getRange(OUT_ROW - 1, 1, last - OUT_ROW + 2, W).clearContent().clearFormat();
  var out = sh.getRange(OUT_ROW, 1, rows.length, W);
  out.setNumberFormat('@').setValues(rows).setVerticalAlignment('middle');

  function each(kind, fn) {
    if (!style[kind].length) return;
    var a1 = style[kind].map(function (i) { var r = OUT_ROW + i - 1; return 'A' + r + ':F' + r; });
    fn(sh.getRangeList(a1));
  }
  each('title', function (rl) { rl.setFontWeight('bold').setFontSize(12).setBackground('#1f3a93').setFontColor('#ffffff'); });
  each('car',   function (rl) { rl.setFontWeight('bold').setBackground('#e8f0fb'); });
  each('head',  function (rl) { rl.setFontWeight('bold').setBackground('#f3f3f3').setHorizontalAlignment('center'); });
  each('warn',  function (rl) { rl.setFontColor('#c00000'); });
  each('note',  function (rl) { rl.setFontColor('#666666'); });
}


/* ══════════════════════════════════════════════════════════
   ⚠要確認シート
   ══════════════════════════════════════════════════════════ */

function 要確認シートに書く_(ss, issues) {
  var sh = ss.getSheetByName(SH_CHECK);
  if (!issues.length) {
    if (sh) sh.clear().getRange(1, 1).setValue('確認が必要なことはありません（' +
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm') + '）');
    return;
  }
  if (!sh) sh = ss.insertSheet(SH_CHECK);
  sh.clear();
  sh.getRange(1, 1, 1, 2).setValues([['どこ', '確認してほしいこと']]).setFontWeight('bold').setBackground('#ffe0e0');
  sh.getRange(2, 1, issues.length, 2).setValues(issues);
  sh.setColumnWidth(1, 260); sh.setColumnWidth(2, 620); sh.setFrozenRows(1);
  sh.setTabColor('#e06666');
}




/* ══════════════════════════════════════════════════════════
   💬 Geminiと話す
   Gemini には「言葉を理解して、入力欄をどう書き換えるか」だけを頼む。
   計算はこのスクリプト（配車の計算）が行い、何が変わったかもスクリプトが数えて伝える。
   Gemini に送るのは 氏名・車両名・時刻 だけ。住所は送らない。
   ══════════════════════════════════════════════════════════ */

var GEMINI_MODELS = ['gemini-flash-latest', 'gemini-2.5-flash'];   // 上から順に試す（スクリプトのプロパティ GEMINI_MODEL で変えられる）

function APIキーを登録する() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('GeminiのAPIキーを登録',
    'Google AI Studio（aistudio.google.com）の「Get API key」で作ったキーを貼ってください。\n' +
    'キーはこのスプレッドシートのスクリプトの中だけに保存されます。', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var key = r.getResponseText().trim();
  if (!key) return;
  PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', key);
  try {
    Geminiに聞く_('テストです。reply に「OK」とだけ入れて返してください。', [], '');
    ui.alert('登録しました。「🚐 送迎 → 💬 Geminiと話す」から使えます。');
  } catch (e) {
    ui.alert('キーは保存しましたが、Geminiにつながりませんでした。\n\n' + e.message);
  }
}

function Geminiと話す() {
  var html = HtmlService.createHtmlOutput(チャット画面_()).setTitle('💬 Geminiと話す');
  SpreadsheetApp.getUi().showSidebar(html);
}

// サイドバーから呼ぶ窓口（google.script.run から呼ぶので英字の名前にしてある）
function chatInit() { return チャットの初期情報_(); }
function chatSend(msg, day, history) { return チャット_(msg, day, history); }

/** サイドバーを開いたときの情報 */
function チャットの初期情報_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var days = DAYS.filter(function (d) { return ss.getSheetByName(d + SHEET_SUFFIX); });
  var today = '日月火水木金土'.charAt(new Date().getDay());
  var act = ss.getActiveSheet().getName();
  var cur = (act.slice(-SHEET_SUFFIX.length) === SHEET_SUFFIX) ? act.slice(0, act.length - SHEET_SUFFIX.length) : today;
  if (days.indexOf(cur) < 0) cur = days[0] || '';
  return { days: days, day: cur, hasKey: !!PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') };
}

/** サイドバーから呼ばれる。msg=話しかけた言葉、day=曜日、history=[{role,text}] */
function チャット_(msg, day, history) {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(60 * 1000)) return { reply: '別の処理が動いています。少し待ってからもう一度送ってください。', day: day };
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var fac = 施設を読む_(ss), parsed = 利用者を読む_(ss, fac);
    var pos = 保存済みの座標_(ss), real = 保存済みの実測_(ss);

    var sh = ss.getSheetByName(day + SHEET_SUFFIX);
    if (!sh) return { reply: day + '曜日の送迎表がありません。先に「今すぐ送迎表を作り直す」を押してください。', day: day };
    var inputs = 入力を読む_(sh);
    var before = 曜日の配車_(day, fac, parsed.rides, pos, real, inputs);

    var ctx = チャットの状況_(day, fac, parsed.rides, inputs, before);
    var ans = Geminiに聞く_(msg, history || [], ctx);

    // 別の曜日の話だったら、その曜日で考え直す
    if (ans.day && ans.day !== day && ss.getSheetByName(ans.day + SHEET_SUFFIX)) {
      day = ans.day;
      sh = ss.getSheetByName(day + SHEET_SUFFIX);
      inputs = 入力を読む_(sh);
      before = 曜日の配車_(day, fac, parsed.rides, pos, real, inputs);
      ans = Geminiに聞く_(msg, history || [], チャットの状況_(day, fac, parsed.rides, inputs, before));
    }

    var next = 指示を入力欄に当てはめる_(inputs, ans, before);
    var changed = ['offV', 'offU', 'alt', 'pin'].some(function (k) { return next[k] !== inputs[k]; });
    var reply = String(ans.reply || '').trim();
    if (!changed) return { reply: reply || '（変更はありません）', day: day, changed: false };

    sh.getRange(IN_ROW_OFFV, IN_COL, 4, 1).setValues([[next.offV], [next.offU], [next.alt], [next.pin]]);
    var after = 曜日の送迎表を作る_(ss, day, fac, parsed.rides, pos, real);
    return { reply: reply, changes: 変わったこと_(before, after), day: day, changed: true };
  } catch (e) {
    return { reply: '⚠ ' + e.message, day: day, changed: false };
  } finally {
    lock.releaseLock();
  }
}

/** Gemini に渡す「いまの状況」。住所は入れない */
function チャットの状況_(day, fac, rides, inputs, res) {
  var L = [];
  L.push('【曜日】' + day);
  L.push('【車両】' + fac.vehicles.map(function (v) { return v.name + '（定員' + v.cap + '）'; }).join('、'));
  var names = uniq_(rides.filter(function (r) { return r.day === day; }).map(function (r) { return r.name; }));
  L.push('【この曜日の利用者（氏名はこの書き方のまま使う）】' + names.join('、'));
  var alts = rides.filter(function (r) { return r.day === day && (r.cond || r.alt); }).map(function (r) {
    return r.name + '（' + r.trip + '：' + (r.cond ? r.cond + ' ' + r.time : r.alt.label + ' ' + r.alt.time) + '）';
  });
  if (alts.length) L.push('【別案が使える方】' + alts.join('、'));
  L.push('【いまの入力欄】使わない車：' + (inputs.offV || 'なし') + '／お休み：' + (inputs.offU || 'なし') +
         '／別案：' + (inputs.alt || 'なし') + '／車の固定：' + (inputs.pin || 'なし'));
  L.push('【いまの送迎表】');
  res.blocks.forEach(function (b) {
    L.push('■ ' + b.title);
    var byCar = {};
    b.meta.rows.forEach(function (r) {
      var k = r.vehicle + (r.run > 1 ? '（' + r.run + '便）' : '');
      (byCar[k] = byCar[k] || []).push(r.name + ' ' + r.arrive + (r.late ? '（' + r.late + '分遅れ）' : ''));
    });
    Object.keys(byCar).forEach(function (k) { L.push('　' + k + '：' + byCar[k].join(' → ')); });
    if (b.meta.unassigned.length) L.push('　未割当：' + b.meta.unassigned.join('、'));
  });
  if (res.warns.length) L.push('【入力欄の警告】' + res.warns.join('／'));
  return L.join('\n');
}

var CHAT_RULES = [
  'あなたは福祉事業所の送迎表を直すアシスタントです。',
  '職員の言葉を読み取り、送迎表シートの入力欄をどう変えるかを JSON で返します。配車の計算はしません（スクリプトが行います）。',
  '',
  '返す項目：',
  '- reply：職員への短い返事（1〜3文）。計算結果の予想（何分になる等）は書かない。スクリプトが実際の結果を添えます',
  '- day：別の曜日の話なら その曜日（月〜日の1文字）。いまの曜日のままなら空',
  '- off_vehicles_add / off_vehicles_remove：使わない車に 足す／戻す 車両名',
  '- absent_add / absent_remove：お休みに 足す／戻す 氏名',
  '- alt_add / alt_remove：別案（「送りあり」「クラブ活動あり」など）を 使う／やめる 氏名',
  '- pins_add：車の固定 [{name, vehicle, trip}]。trip は「お迎え」「お送り」、両方なら空',
  '- pins_remove：固定をやめる氏名',
  '- swaps：2人の車を入れ替える [{a, b, trip}]',
  '- reset：入力欄を全部空にするとき true',
  '',
  '守ること：',
  '- 氏名・車両名は【この曜日の利用者】【車両】に書かれたとおりに書く。呼び方のゆれ（「ハナちゃん」「サトウさん」）は一覧と照らして直す',
  '- 誰のことか・どの車か確信が持てないときは、何も変更せず reply で聞き返す',
  '- 入力欄は曜日ごとに残る。言われていないものは変えない（「今日だけ」でも、その曜日の欄に書く）',
  '- 「元に戻して」「全部やめて」は reset、または該当の remove を使う',
  '- 質問だけのとき（「なぜ？」「遅れている人は？」）は変更せず、【いまの送迎表】を見て reply で答える',
  '- 名簿（住所・利用曜日・時刻）そのものを変えたいと言われたら、「②利用者一覧を直してください」と reply で案内する'
].join('\n');

var CHAT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    reply: { type: 'STRING' },
    day: { type: 'STRING' },
    off_vehicles_add: { type: 'ARRAY', items: { type: 'STRING' } },
    off_vehicles_remove: { type: 'ARRAY', items: { type: 'STRING' } },
    absent_add: { type: 'ARRAY', items: { type: 'STRING' } },
    absent_remove: { type: 'ARRAY', items: { type: 'STRING' } },
    alt_add: { type: 'ARRAY', items: { type: 'STRING' } },
    alt_remove: { type: 'ARRAY', items: { type: 'STRING' } },
    pins_add: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      name: { type: 'STRING' }, vehicle: { type: 'STRING' }, trip: { type: 'STRING' } }, required: ['name', 'vehicle'] } },
    pins_remove: { type: 'ARRAY', items: { type: 'STRING' } },
    swaps: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      a: { type: 'STRING' }, b: { type: 'STRING' }, trip: { type: 'STRING' } }, required: ['a', 'b'] } },
    reset: { type: 'BOOLEAN' }
  },
  required: ['reply']
};

/** Gemini に聞いて、JSON（CHAT_SCHEMA の形）を返す */
function Geminiに聞く_(msg, history, ctx) {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('GEMINI_API_KEY');
  if (!key) throw new Error('GeminiのAPIキーが登録されていません。「🚐 送迎 →【初回】GeminiのAPIキーを登録する」から登録してください。');
  var contents = [];
  history.slice(-8).forEach(function (h) {
    contents.push({ role: h.role === 'model' ? 'model' : 'user', parts: [{ text: String(h.text || '') }] });
  });
  contents.push({ role: 'user', parts: [{ text: (ctx ? ctx + '\n\n【職員の言葉】\n' : '') + msg }] });
  var body = {
    systemInstruction: { parts: [{ text: CHAT_RULES }] },
    contents: contents,
    generationConfig: { responseMimeType: 'application/json', responseSchema: CHAT_SCHEMA, temperature: 0 }
  };
  var models = props.getProperty('GEMINI_MODEL') ? [props.getProperty('GEMINI_MODEL')] : GEMINI_MODELS;
  var last = '';
  for (var i = 0; i < models.length; i++) {
    var res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + models[i] + ':generateContent', {
      method: 'post', contentType: 'application/json', payload: JSON.stringify(body),
      headers: { 'x-goog-api-key': key }, muteHttpExceptions: true
    });
    var code = res.getResponseCode(), text = res.getContentText();
    if (code === 404) { last = 'モデル ' + models[i] + ' が見つかりません'; continue; }
    if (code === 400 && /API key/i.test(text)) throw new Error('APIキーが正しくありません。登録し直してください。');
    if (code === 429) throw new Error('Geminiの利用上限に達しました。少し待ってからもう一度送ってください。');
    if (code !== 200) throw new Error('Geminiにつながりませんでした（' + code + '）。' + text.slice(0, 200));
    var j = JSON.parse(text);
    var part = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
    if (!part || !part.length) throw new Error('Geminiから返事がありませんでした。言い方を変えてもう一度送ってください。');
    return JSON.parse(part.map(function (x) { return x.text || ''; }).join(''));
  }
  throw new Error(last + '。スクリプトのプロパティ GEMINI_MODEL に使えるモデル名を入れてください。');
}

/** Gemini の指示を、入力欄の文字に当てはめる（テストしやすいようシートから切り離してある） */
function 指示を入力欄に当てはめる_(inputs, ans, before) {
  if (ans.reset) return { offV: '', offU: '', alt: '', pin: '' };
  function edit(cur, add, rem) {
    var list = 名前の一覧_(cur);
    (rem || []).forEach(function (x) {
      var k = 名前を比べる形_(x);
      list = list.filter(function (y) { var j = 名前を比べる形_(y); return !(j && (j.indexOf(k) >= 0 || k.indexOf(j) >= 0)); });
    });
    (add || []).forEach(function (x) {
      var k = 名前を比べる形_(x);
      if (k && !list.some(function (y) { return 名前を比べる形_(y) === k; })) list.push(String(x).trim());
    });
    return list.join('、');
  }
  // 車の固定：「氏名→車（便）」の並び
  var pins = 全角を半角に_(String(inputs.pin || '')).split(/[、,，\n]+/).map(function (x) { return x.trim(); }).filter(String);
  function pinName(item) { return 名前を比べる形_(item.split(/→|->|⇒|＞|>/)[0]); }
  function dropPin(name, trip) {
    var k = 名前を比べる形_(name);
    pins = pins.filter(function (it) {
      var n = pinName(it), t = (it.match(/\((お迎え|お送り)\)\s*$/) || [])[1] || '';
      var same = n && (n.indexOf(k) >= 0 || k.indexOf(n) >= 0);
      return !(same && (!trip || !t || t === trip));
    });
  }
  function addPin(name, vehicle, trip) {
    dropPin(name, trip);
    pins.push(String(name).trim() + '→' + String(vehicle).trim() + (trip ? '(' + trip + ')' : ''));
  }
  (ans.pins_remove || []).forEach(function (n) { dropPin(n, ''); });
  (ans.pins_add || []).forEach(function (p) { if (p && p.name && p.vehicle) addPin(p.name, p.vehicle, p.trip === 'お迎え' || p.trip === 'お送り' ? p.trip : ''); });
  // 入れ替え：いまの送迎表で乗っている車を入れ替えて、2人とも固定する
  (ans.swaps || []).forEach(function (sw) {
    before.blocks.forEach(function (b) {
      if (sw.trip && sw.trip !== b.trip) return;
      function carOf(name) {
        var k = 名前を比べる形_(name);
        var r = b.meta.rows.filter(function (x) { return 名前を比べる形_(x.name).indexOf(k) >= 0; })[0];
        return r ? r : null;
      }
      var ra = carOf(sw.a), rb = carOf(sw.b);
      if (!ra || !rb || ra.vehicle === rb.vehicle) return;
      addPin(ra.name, rb.vehicle, b.trip);
      addPin(rb.name, ra.vehicle, b.trip);
    });
  });
  return {
    offV: edit(inputs.offV, ans.off_vehicles_add, ans.off_vehicles_remove),
    offU: edit(inputs.offU, ans.absent_add, ans.absent_remove),
    alt:  edit(inputs.alt, ans.alt_add, ans.alt_remove),
    pin:  pins.join('、')
  };
}

/** 組み直す前と後を比べて、変わったことを文章にする（スクリプトが数えるので正確） */
function 変わったこと_(before, after) {
  function index(res) {
    var m = {}, late = 0, lateN = 0, un = [];
    res.blocks.forEach(function (b) {
      b.meta.rows.forEach(function (r) { m[b.trip + '\u0000' + r.name] = r.vehicle + (r.run > 1 ? '（' + r.run + '便）' : ''); });
      b.meta.late.forEach(function (x) { late += x.min; lateN++; });
      b.meta.unassigned.forEach(function (n) { un.push(n + '（' + b.trip + '）'); });
    });
    return { m: m, late: late, lateN: lateN, un: un };
  }
  var A = index(before), B = index(after), L = [];
  Object.keys(B.m).forEach(function (k) {
    var p = k.split('\u0000');
    if (A.m[k] == null) L.push('・' + p[1] + '：' + B.m[k] + ' に入りました（' + p[0] + '）');
    else if (A.m[k] !== B.m[k]) L.push('・' + p[1] + '：' + A.m[k] + ' → ' + B.m[k] + '（' + p[0] + '）');
  });
  Object.keys(A.m).forEach(function (k) {
    var p = k.split('\u0000');
    if (B.m[k] == null && !B.un.some(function (u) { return u.indexOf(p[1]) === 0; })) L.push('・' + p[1] + '：送迎表から外れました（' + p[0] + '）');
  });
  if (!L.length) L.push('・車の割り当ては変わりませんでした');
  L.push('・遅れ：' + (A.lateN ? A.lateN + '件・計' + A.late + '分' : 'なし') + ' → ' + (B.lateN ? B.lateN + '件・計' + B.late + '分' : 'なし'));
  if (B.un.length) L.push('⚠ 未割当：' + B.un.join('、'));
  after.warns.forEach(function (w) { L.push('⚠ ' + w); });
  return L.join('\n');
}

function チャット画面_() {
  return '<!DOCTYPE html><html><head><base target="_top"><style>' +
    'body{font:13px/1.6 sans-serif;margin:0;display:flex;flex-direction:column;height:100vh}' +
    '#top{padding:8px;border-bottom:1px solid #ddd;background:#f8f9fa}' +
    '#log{flex:1;overflow-y:auto;padding:8px}' +
    '.m{margin:6px 0;padding:6px 9px;border-radius:8px;white-space:pre-wrap;word-break:break-word}' +
    '.u{background:#e8f0fe;margin-left:24px}.a{background:#f1f3f4;margin-right:12px}.c{background:#fff8e1;margin-right:12px;font-size:12px}' +
    '.e{background:#fce8e6;color:#a50e0e}' +
    '#bot{padding:8px;border-top:1px solid #ddd}textarea{width:100%;box-sizing:border-box;height:64px;font:13px sans-serif}' +
    'button{margin-top:4px;width:100%;padding:7px;background:#1a73e8;color:#fff;border:0;border-radius:4px;font-size:13px}' +
    'button:disabled{background:#9aa0a6}.hint{color:#777;font-size:11px}' +
    '</style></head><body>' +
    '<div id="top">曜日：<select id="day"></select> <span class="hint">この曜日の送迎表を直します</span></div>' +
    '<div id="log"><div class="m a">例）「2号車は車検。ヤマダさん休み。サトウさんは1号車に乗せて」<br>「タナカさんとスズキさんの車を入れ替えて」<br>「全部元に戻して」<br>「遅れている人は？」</div></div>' +
    '<div id="bot"><textarea id="t" placeholder="ここに話しかける（Ctrl+Enterで送信）"></textarea>' +
    '<button id="b" onclick="send()">送る</button>' +
    '<div class="hint">Geminiには氏名・車・時刻だけを送ります（住所は送りません）。</div></div>' +
    '<script>' +
    'var hist=[];function add(t,c){var d=document.createElement("div");d.className="m "+c;d.textContent=t;var l=document.getElementById("log");l.appendChild(d);l.scrollTop=l.scrollHeight;}' +
    'google.script.run.withSuccessHandler(function(i){var s=document.getElementById("day");i.days.forEach(function(d){var o=document.createElement("option");o.value=d;o.textContent=d+"曜";s.appendChild(o)});s.value=i.day;' +
    'if(!i.hasKey)add("GeminiのAPIキーがまだ登録されていません。メニューの「【初回】GeminiのAPIキーを登録する」から登録してください。","e");}).chatInit();' +
    'document.getElementById("t").addEventListener("keydown",function(e){if(e.key==="Enter"&&(e.ctrlKey||e.metaKey))send();});' +
    'function send(){var t=document.getElementById("t"),b=document.getElementById("b"),msg=t.value.trim();if(!msg)return;' +
    'add(msg,"u");t.value="";b.disabled=true;b.textContent="考えています…";var day=document.getElementById("day").value;' +
    'google.script.run.withSuccessHandler(function(r){b.disabled=false;b.textContent="送る";' +
    'hist.push({role:"user",text:msg});hist.push({role:"model",text:r.reply||""});hist=hist.slice(-8);' +
    'if(r.day)document.getElementById("day").value=r.day;add(r.reply||"",/^⚠/.test(r.reply||"")?"e":"a");' +
    'if(r.changes)add("【変わったこと】\\n"+r.changes,"c");})' +
    '.withFailureHandler(function(e){b.disabled=false;b.textContent="送る";add("⚠ "+e.message,"e");}).chatSend(msg,day,hist);}' +
    '</script></body></html>';
}
