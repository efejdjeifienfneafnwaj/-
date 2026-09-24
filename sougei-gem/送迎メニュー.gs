/**
 * 送迎ボード 設定シート用スクリプト（Gem連携）
 *
 * 先方がするのは「①②を直して保存する」だけ。
 * あとはこのスクリプトが1時間ごとに自動で
 *   住所 → 座標（③座標）
 *   区間の実測時間（④実測。Googleマップ）
 *   Gemが読む「送迎データ（Gem用・自動更新）」ドキュメント
 * を作り直す。一度測った座標・区間は保存しておき、二度と測らない。
 *
 * ②利用者一覧の曜日セルは、先方の書き方をそのまま読む。
 *   ○(迎え14:10、送り17:55)
 *   ○(迎え14:45、送りなし)
 *   ○(自宅迎え9:40、送り16:05)          … 「自宅」「祖父母宅」などの場所つき
 *   ○(迎え14:10/クラブ活動あり15:00、送り18:05)   … 「/」の後ろは条件つきの別案
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
var SH_PAY   = '_payload';     // 配車ロジック.py と Gem指示文の元データ（非表示・さわらない）

var DAYS       = ['月', '火', '水', '木', '金', '土', '日'];
var NEAR_K     = 10;                  // 各住所から近い何件まで実測するか
var TIME_LIMIT = 4.5 * 60 * 1000;     // 1回の実行はここで打ち切る（上限6分のため）
var DOC_TITLE  = '送迎データ（Gem用・自動更新）';


/* ══════════════════════════════════════════════════════════
   メニュー
   ══════════════════════════════════════════════════════════ */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🚐 送迎')
    .addItem('今すぐGemに反映する', '今すぐ反映する')
    .addSeparator()
    .addItem('【初回】自動反映をONにする', '自動反映をONにする')
    .addItem('【初回】Gemの準備', 'Gemの準備')
    .addToUi();
}

/** メニュー：今すぐ反映する（結果を画面に出す） */
function 今すぐ反映する() {
  var r = 更新する_();
  var msg = r.busy ? '別の反映処理が動いています。少し待ってからもう一度押してください。' :
    'Gemに反映しました\n\n' +
    '利用者：' + r.users + '名　車両：' + r.vehicles + '台\n' +
    '座標：新しく調べた ' + r.geoNew + '件' + (r.geoNg ? '（見つからない ' + r.geoNg + '件）' : '') + '\n' +
    '実測：新しく測った ' + r.realNew + '区間' + (r.realLeft ? '（残り ' + r.realLeft + '区間は次の自動反映で続きを測ります）' : '') + '\n\n' +
    (r.issues ? '⚠ 確認が必要なことが ' + r.issues + '件あります。「' + SH_CHECK + '」シートを見てください。'
              : '確認が必要なことはありません。');
  SpreadsheetApp.getUi().alert(msg);
}

/** メニュー：1時間ごとの自動反映を仕掛ける（重複しない） */
function 自動反映をONにする() {
  var ts = ScriptApp.getProjectTriggers();
  for (var i = 0; i < ts.length; i++) {
    if (ts[i].getHandlerFunction() === '自動反映') ScriptApp.deleteTrigger(ts[i]);
  }
  ScriptApp.newTrigger('自動反映').timeBased().everyHours(1).create();
  今すぐ反映する();
}

/** 1時間ごとに呼ばれる。名簿が変わっていなくて、測り残しも無ければ何もしない */
function 自動反映() {
  var props = PropertiesService.getDocumentProperties();
  var h = 名簿の指紋_();
  if (h === props.getProperty('LAST_HASH') && props.getProperty('PENDING') !== '1') return;
  更新する_();
}


/* ══════════════════════════════════════════════════════════
   本体：読む → 座標 → 実測 → Gem用ドキュメント
   ══════════════════════════════════════════════════════════ */

function 更新する_() {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(1000)) return { busy: true };
  try {
    var start = new Date().getTime();
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var fac   = 施設を読む_(ss);
    var parsed = 利用者を読む_(ss, fac);
    var issues = parsed.issues.slice();
    if (!fac.addr)            issues.push(['①施設', '施設住所が入っていません']);
    if (!fac.vehicles.length) issues.push(['①施設', '車両が1台も入っていません（10行目から 車両名・定員数）']);

    // ── 座標 ──
    var addrs = [];
    if (fac.addr) addrs.push(fac.addr);
    parsed.rides.forEach(function (r) { addrs.push(r.addr); });
    var g = 座標をそろえる_(ss, uniq_(addrs), fac.pref);
    g.issues.forEach(function (x) { issues.push(x); });

    // ── 実測（時間の許すかぎり。残りは次回）──
    var m = 実測をそろえる_(ss, g.pos, fac.addr, start);

    // ── Gem用ドキュメント ──
    var text = Gem用テキスト_(fac, parsed.rides, g.pos, m.real, issues);
    var url  = Gem用ドキュメントに書く_(text);

    要確認シートに書く_(ss, issues);

    var props = PropertiesService.getDocumentProperties();
    props.setProperty('LAST_HASH', 名簿の指紋_());
    props.setProperty('PENDING', m.left ? '1' : '0');

    return { users: parsed.users, vehicles: fac.vehicles.length, geoNew: g.done, geoNg: g.ng,
             realNew: m.done, realLeft: m.left, issues: issues.length, url: url };
  } finally {
    lock.releaseLock();
  }
}

/** ①② の中身から作る指紋。変わっていなければ自動反映をとばす */
function 名簿の指紋_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), s = '';
  [SH_FAC, SH_USER].forEach(function (n) {
    var sh = ss.getSheetByName(n);
    if (sh && sh.getLastRow()) s += JSON.stringify(sh.getRange(1, 1, sh.getLastRow(), Math.max(1, sh.getLastColumn())).getDisplayValues());
  });
  var d = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8);
  return Utilities.base64Encode(d);
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
  var inVeh = false;
  for (var i = 0; i < vals.length; i++) {
    var a = norm_(vals[i][0]), b = String(vals[i][1] || '').trim();
    if (!inVeh) {
      if (a.indexOf('施設名') >= 0)   out.name = b;
      if (a.indexOf('施設住所') >= 0) out.rawAddr = b;
      if (a.indexOf('事業区分') >= 0 && b) out.mode = (b.indexOf('介護') >= 0) ? '介護' : '放デイ';
      if (a.indexOf('乗降') >= 0 && Number(b) > 0) out.stop = Number(b);
      if (a.indexOf('出発時刻') >= 0 && 時刻文字に_(b)) out.depart = 時刻文字に_(b);
      if (a.indexOf('車両設定') >= 0) inVeh = true;
      continue;
    }
    if (a.indexOf('車両名') >= 0) continue;           // 見出し行
    var nm = String(vals[i][0] || '').trim();
    var cap = Number(String(vals[i][2] || '').replace(/[^\d]/g, ''));
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
                     addr: 住所を整える_(lg.addr, pref), time: lg.time, note: lg.note || '', cond: lg.cond || '' });
      });
    });
    if (!anyDay) issues.push([rowNo + '行 ' + name, '利用曜日に何も入っていないため、配車に出てきません（休止中なら問題ありません）']);
  }
  return { rides: rides, issues: issues, users: users };
}

/**
 * 曜日セル1つを読む。戻り値は乗車の配列 [{trip, place, addr, time, note, cond} | {warn}]
 */
function 曜日セルを読む_(v, base) {
  var s = 全角を半角に_(String(v)).trim();
  var m = s.match(/[（(]([\s\S]*)[)）]/);
  var inner = m ? m[1].trim() : s.replace(/^[○〇◯●]/, '').trim();

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
    legs.push({ trip: trip, place: place.place, addr: place.addr, time: time, note: note });
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
    if (new Date().getTime() - start > TIME_LIMIT) break;
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
   Gem用テキスト
   曜日×便ごとに、配車ロジック.py にそのまま貼れる Python のコードを並べる。
   Gemは書き写すだけで、並べ替えや計算をしなくて済む（＝書き写しミスが出にくい）。
   ══════════════════════════════════════════════════════════ */

function py_(s) { return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"; }

function Gem用テキスト_(fac, rides, pos, real, issues) {
  var L = [];
  var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm');
  L.push('# 送迎データ　' + (fac.name || '') + '　（' + now + ' 更新）');
  L.push('# 事業区分：' + fac.mode + '　車両：' + fac.vehicles.length + '台');
  L.push('# 使い方：該当する曜日・便のコードを、配車ロジック.py の「ここから下はロジック」の行の直前にそのまま貼って実行する');
  if (issues.length) {
    L.push('# ⚠ 名簿に確認が必要な点が ' + issues.length + '件あります（該当の方は下のデータに入っていません）：');
    issues.slice(0, 30).forEach(function (x) { L.push('#   ' + x[0] + '：' + x[1]); });
  }
  L.push('');

  var vehicles = fac.vehicles.map(function (v) {
    return "    {'name': " + py_(v.name) + ", 'cap': " + v.cap + ", 'wc_max': 0, 'wc_seats': 1, 'walker_max': None},";
  });
  var fp = pos[fac.addr];

  DAYS.forEach(function (d) {
    ['お迎え', 'お送り'].forEach(function (trip) {
      var all = rides.filter(function (r) { return r.day === d && r.trip === trip; });
      var waves = 便に分ける_(all);
      waves.forEach(function (list, wi) {
      var tag = (waves.length > 1) ? '①②③④⑤⑥⑦⑧⑨'.charAt(wi) + '（' + 時間帯_(list) + '）' : '';
      var normal = list.filter(function (r) { return !r.cond; });
      var cond   = list.filter(function (r) { return r.cond; });
      var noPos  = list.filter(function (r) { return !pos[r.addr]; });

      L.push('## ' + d + '曜・' + trip + tag + '（' + normal.length + '名）');
      L.push('```python');
      L.push('CONFIG = {');
      L.push("    'mode': " + py_(fac.mode) + ", 'trip': " + py_(trip) + ',');
      L.push("    'facility': " + py_(fac.addr) + ", 'facility_name': " + py_(fac.name) + ',');
      L.push("    'fac_pos': " + (fp ? '(' + fp[0] + ', ' + fp[1] + ')' : 'None') + ',');
      L.push("    'depart': " + py_(fac.depart) + ", 'auto_depart': None, 'stop': " + fac.stop + ", 'turn': 5,");
      L.push("    'factor': 3.0, 'use_run2': " + (fac.mode === '介護' ? 'True' : 'False') + ", 'seed': 0,");
      L.push('}');
      L.push('VEHICLES = [');
      L = L.concat(vehicles);
      L.push(']');
      L.push('USERS = [');
      function userLine(r) {
        var p = pos[r.addr];
        return "{'name': " + py_(r.name) + ", 'addr': " + py_(r.addr) + ", 'pos': (" + p[0] + ', ' + p[1] + ')' +
               ", 'mob': '', 'target': " + py_(r.time) + ", 'note': " + py_([r.place, r.note].filter(String).join('／')) + '}';
      }
      normal.forEach(function (r) { if (pos[r.addr]) L.push('    ' + userLine(r) + ','); });
      L.push(']');
      cond.forEach(function (r) {
        if (!pos[r.addr]) return;
        L.push('# 条件つき（「' + r.name + 'さん' + r.cond + '」と言われたときだけ # を外す）');
        L.push('# USERS.append(' + userLine(r) + ')');
      });
      L.push('OFF_VEHICLES = []');
      L.push('OFF_USERS = []');

      // この便に出てくる住所どうしの実測だけ載せる（表を小さく保つ）
      var here = uniq_([fac.addr].concat(list.map(function (r) { return r.addr; })));
      var pairs = [];
      for (var i = 0; i < here.length; i++) for (var j = i + 1; j < here.length; j++) {
        var v = real[here[i] + '||' + here[j]];
        if (v != null) pairs.push('    (' + py_(here[i]) + ', ' + py_(here[j]) + '): ' + v + ',');
      }
      L.push('REAL = {');
      L = L.concat(pairs);
      L.push('}');
      L.push('```');
      if (noPos.length) {
        L.push('※ 座標が無いため外した方：' + uniq_(noPos.map(function (r) { return r.name; })).join('、'));
      }
      L.push('');
      });
    });
  });
  return L.join('\n');
}

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

/** 同じGoogleドキュメントを毎回上書きする（Gemの知識に入れっぱなしにできるよう、URLを変えない） */
function Gem用ドキュメントに書く_(text) {
  var props = PropertiesService.getDocumentProperties();
  var id = props.getProperty('GEM_DOC_ID'), doc = null;
  if (id) { try { doc = DocumentApp.openById(id); } catch (e) { doc = null; } }
  if (!doc) {
    doc = DocumentApp.create(DOC_TITLE);
    props.setProperty('GEM_DOC_ID', doc.getId());
    try { DriveApp.getFileById(doc.getId()).moveTo(同じフォルダ_()); } catch (e) {}
  }
  var body = doc.getBody();
  body.clear();
  body.appendParagraph('※ このファイルはスプレッドシートから自動で作り直されます。手で書き換えないでください。');
  body.appendParagraph(text).setFontFamily('Courier New').setFontSize(9);
  doc.saveAndClose();
  return doc.getUrl();
}

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
   【初回】Gemの準備
   シートに埋め込んである「配車ロジック.py」をドライブに書き出し、Gemの作り方を表示する。
   ══════════════════════════════════════════════════════════ */

function 埋め込みを取り出す_(key) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH_PAY);
  if (!sh) throw new Error('このシートには準備データが入っていません（' + SH_PAY + ' が無い）');
  var lastC = Math.max(2, sh.getLastColumn());
  var vals = sh.getRange(1, 1, sh.getLastRow(), lastC).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).trim() !== key) continue;
    var b64 = '';
    for (var c = 1; c < lastC; c++) {
      var v = String(vals[i][c] == null ? '' : vals[i][c]).trim();
      if (!v) break;
      b64 += v;
    }
    return Utilities.newBlob(Utilities.base64Decode(b64)).getDataAsString('UTF-8');
  }
  throw new Error('準備データ「' + key + '」が見つかりません');
}

function 同じフォルダ_() {
  try {
    var ps = DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId()).getParents();
    if (ps.hasNext()) return ps.next();
  } catch (e) {}
  return DriveApp.getRootFolder();
}

function Gemの準備() {
  var ui = SpreadsheetApp.getUi();
  var logic, prompt;
  try { logic = 埋め込みを取り出す_('logic'); prompt = 埋め込みを取り出す_('prompt'); }
  catch (e) { ui.alert(e.message); return; }

  var folder = 同じフォルダ_();
  var it = folder.getFilesByName('配車ロジック.py');
  var f1 = it.hasNext() ? it.next() : null;
  if (f1) f1.setContent(logic); else f1 = folder.createFile('配車ロジック.py', logic, MimeType.PLAIN_TEXT);

  var r = 更新する_();          // Gem用ドキュメントもここで作っておく
  var docUrl = r.url || '';

  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); };
  var html = HtmlService.createHtmlOutput(
    '<div style="font:13px/1.7 sans-serif">' +
    '<ol style="padding-left:18px">' +
    '<li>Gemini で <b>Gem マネージャー → 新しい Gem</b>。名前：<code>送迎配車アシスタント</code></li>' +
    '<li><b>「指示」</b>に下の枠の中身を全部貼る</li>' +
    '<li><b>「知識」</b>にドライブから2つ追加：' +
    '<a href="' + f1.getUrl() + '" target="_blank"><b>配車ロジック.py</b></a> と ' +
    '<a href="' + docUrl + '" target="_blank"><b>' + DOC_TITLE + '</b></a></li>' +
    '<li><b style="color:#c00">「デフォルトツール」で「コード実行」を有効にする</b>（忘れると動きません）</li>' +
    '<li>保存。会話ではモデルを <b>Pro</b> にする</li>' +
    '</ol>' +
    '<textarea style="width:100%;height:280px;font:12px monospace" onclick="this.select()">' + esc(prompt) + '</textarea>' +
    '</div>').setWidth(820).setHeight(600);
  ui.showModalDialog(html, 'Gemの準備（初回だけ）');
}
