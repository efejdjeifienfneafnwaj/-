/**
 * 送迎ボード 設定シート用　座標づけスクリプト
 *
 * ①施設・車両設定 と ②利用者一覧 に入力された住所を読み取り、
 * 「③座標」シートに緯度経度を書き出します。
 * そのあと「Gem用テキスト」を作れば、Geminiに貼るだけの形になります。
 *
 * APIキーは不要です。無料の範囲で動きます。
 */

var SH_FAC  = '①施設・車両設定';
var SH_USER = '②利用者一覧';
var SH_GEO  = '③座標';
var SH_STAFF= '④職員';      // 無くてもよい（あれば読む）
var SH_PAY  = '_payload';   // Gemの準備ファイルの元データ（非表示・さわらない）
var SH_REAL = '⑤実測';      // Googleマップで測った移動時間の貯金箱

var NEAR_K     = 10;        // 各住所について、近い何件まで測るか
var TIME_LIMIT = 4.5 * 60 * 1000;   // 1回の実行はここで打ち切る（上限6分のため）

/** スプレッドシートを開いたときにメニューを足す */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🚐 送迎')
    .addItem('① 座標を作る', '座標を作る')
    .addItem('② Gem用テキストを作る', 'Gem用テキストを作る')
    .addSeparator()
    .addItem('④ 実測時間を取る（Googleマップ）', '実測時間を取る')
    .addSeparator()
    .addItem('③ Gemの準備（初回だけ）', 'Gemの準備')
    .addToUi();
}

/** 空白・改行を取り除いて見出しを比べやすくする */
function norm_(s) {
  return String(s == null ? '' : s).replace(/\s+/g, '');
}

/** ②利用者一覧 の見出し行と列の位置を調べる */
function 列を調べる_(sh) {
  var last = sh.getLastColumn() || 13;
  var headRow = 0;
  for (var r = 1; r <= 10; r++) {
    var vals = sh.getRange(r, 1, 1, last).getValues()[0];
    for (var i = 0; i < vals.length; i++) {
      if (norm_(vals[i]).indexOf('氏名') >= 0) { headRow = r; break; }
    }
    if (headRow) break;
  }
  if (!headRow) throw new Error(SH_USER + ' に「氏名」の見出しが見つかりません');

  var head = sh.getRange(headRow, 1, 1, last).getValues()[0];
  var col = { headRow: headRow };
  for (var c = 0; c < head.length; c++) {
    var h = norm_(head[c]), n = c + 1;
    if      (h.indexOf('氏名') >= 0)           col.name    = n;
    else if (h.indexOf('お迎え先住所') >= 0)   col.addrAm  = n;
    else if (h.indexOf('お送り先住所') >= 0)   col.addrPm  = n;
    else if (h.indexOf('お迎え先') >= 0)       col.placeAm = n;
    else if (h.indexOf('お送り先名') >= 0)     col.placePm = n;
    else if (h.indexOf('お迎え時刻') >= 0)     col.timeAm  = n;
    else if (h.indexOf('お送り時刻') >= 0)     col.timePm  = n;
  }
  if (!col.name || !col.addrAm) throw new Error('氏名またはお迎え先住所の列が見つかりません');
  return col;
}

/** ①施設・車両設定 から 施設名・施設住所・車両を読む */
function 施設を読む_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH_FAC);
  if (!sh) throw new Error(SH_FAC + ' シートがありません');
  var last = Math.max(sh.getLastRow(), 15);
  var vals = sh.getRange(1, 1, last, 3).getValues();
  var out = { name: '', addr: '', vehicles: [] };
  var inVeh = false;
  for (var i = 0; i < vals.length; i++) {
    var a = norm_(vals[i][0]);
    if (a.indexOf('施設名') >= 0)   out.name = String(vals[i][1] || '').trim();
    if (a.indexOf('施設住所') >= 0) out.addr = String(vals[i][1] || '').trim();
    if (a.indexOf('車両設定') >= 0) { inVeh = true; continue; }
    if (inVeh) {
      if (a.indexOf('車両名') >= 0) continue;          // 見出し行
      var nm  = String(vals[i][0] || '').trim();
      var cap = vals[i][2];
      if (nm && cap) out.vehicles.push({ name: nm, cap: Number(cap) });
    }
  }
  return out;
}

/** ②利用者一覧 から利用者を読む（見本の「例）」の行と空行は飛ばす） */
function 利用者を読む_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH_USER);
  if (!sh) throw new Error(SH_USER + ' シートがありません');
  var col  = 列を調べる_(sh);
  var last = sh.getLastRow();
  var out  = [];
  for (var r = col.headRow + 1; r <= last; r++) {
    var nm = String(sh.getRange(r, col.name).getValue() || '').trim();
    if (!nm) continue;
    if (nm.indexOf('例）') === 0 || nm.indexOf('例)') === 0) continue;
    out.push({
      row:     r,
      name:    nm,
      placeAm: col.placeAm ? String(sh.getRange(r, col.placeAm).getValue() || '').trim() : '',
      addrAm:  String(sh.getRange(r, col.addrAm).getValue() || '').trim(),
      addrPm:  col.addrPm ? String(sh.getRange(r, col.addrPm).getValue() || '').trim() : '',
      // getValue() だと 14:30 が 7:30 になることがある（スクリプトのタイムゾーンの影響）。
      // getDisplayValue() は画面に出ている文字をそのまま返すので、ずれない。
      timeAm:  時刻文字に_(col.timeAm ? sh.getRange(r, col.timeAm).getDisplayValue() : ''),
      timePm:  時刻文字に_(col.timePm ? sh.getRange(r, col.timePm).getDisplayValue() : '')
    });
  }
  return out;
}

/**
 * セルの時刻を 'H:MM' の文字にする。
 * 画面に出ている文字をそのまま解釈するので、タイムゾーンの影響を受けない。
 * 「14:30」「14：30」「午後2:30」「2:30 PM」のどれでも読める。
 */
function 時刻文字に_(v) {
  if (v === '' || v == null) return '';
  var s = String(v).trim();
  if (!s) return '';

  var pm = /午後|P\.?M\.?/i.test(s);
  var am = /午前|A\.?M\.?/i.test(s);
  var m  = s.match(/(\d{1,2})\s*[:：]\s*(\d{1,2})/);
  if (!m) return '';

  var h  = Number(m[1]);
  var mi = (m[2].length === 1) ? ('0' + m[2]) : m[2];
  if (pm && h < 12)  h += 12;      // 午後2:30 → 14:30
  if (am && h === 12) h = 0;       // 午前12:05 → 0:05
  if (!(h >= 0 && h <= 23)) return '';
  if (Number(mi) > 59) return '';
  return h + ':' + mi;
}

/** ③座標 シートを用意して、すでに調べた住所を覚えておく */
function 座標シート_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SH_GEO);
  if (!sh) {
    sh = ss.insertSheet(SH_GEO);
    sh.getRange(1, 1, 1, 5)
      .setValues([['住所', '緯度', '経度', 'Googleの解釈（必ず確認）', '使われている場所']])
      .setFontWeight('bold').setBackground('#e8f0fb');
    sh.setColumnWidth(1, 260); sh.setColumnWidth(4, 320); sh.setColumnWidth(5, 240);
    sh.setFrozenRows(1);
  }
  return sh;
}

/** ── メニュー① 座標を作る ───────────────────────── */
function 座標を作る() {
  var ui  = SpreadsheetApp.getUi();
  var fac = 施設を読む_();
  var us  = 利用者を読む_();

  // 住所を集めて重複をまとめる（同じ学校に10人いても1回だけ調べる）
  var uniq = {}, order = [];
  function add(addr, who) {
    var a = String(addr || '').trim();
    if (!a) return;
    if (!uniq[a]) { uniq[a] = []; order.push(a); }
    uniq[a].push(who);
  }
  if (fac.addr) add(fac.addr, '事業所');
  for (var i = 0; i < us.length; i++) {
    add(us[i].addrAm, us[i].name + '(迎)');
    add(us[i].addrPm, us[i].name + '(送)');
  }
  if (!order.length) {
    ui.alert('住所が1件も入力されていません。①の施設住所と②のお迎え先住所を埋めてください。');
    return;
  }

  // すでに座標がある住所は飛ばす（作り直しても課金・待ち時間が増えない）
  var sh   = 座標シート_();
  var last = sh.getLastRow();
  var have = {}, rowOf = {};
  if (last >= 2) {
    var old = sh.getRange(2, 1, last - 1, 3).getValues();
    for (var j = 0; j < old.length; j++) {
      var a = String(old[j][0] || '').trim();
      if (!a) continue;
      rowOf[a] = j + 2;
      if (old[j][1] && old[j][2]) have[a] = true;
    }
  }

  var geo  = Maps.newGeocoder().setLanguage('ja').setRegion('jp');
  var done = 0, skip = 0, ng = 0;

  for (var k = 0; k < order.length; k++) {
    var addr = order[k];
    var r    = rowOf[addr] || (sh.getLastRow() + 1);
    sh.getRange(r, 1).setValue(addr);
    sh.getRange(r, 5).setValue(uniq[addr].join('、'));
    rowOf[addr] = r;

    if (have[addr]) { skip++; continue; }

    var res = geo.geocode(addr);
    if (res.status === 'OK' && res.results && res.results.length) {
      var loc = res.results[0].geometry.location;
      sh.getRange(r, 2).setValue(Number(loc.lat.toFixed(6)));
      sh.getRange(r, 3).setValue(Number(loc.lng.toFixed(6)));
      sh.getRange(r, 4).setValue(res.results[0].formatted_address).setBackground(null);
      done++;
    } else {
      sh.getRange(r, 2, 1, 2).clearContent();
      sh.getRange(r, 4).setValue('みつかりません（' + res.status + '）').setBackground('#ffe0e0');
      ng++;
    }
    Utilities.sleep(200);   // 続けて投げすぎないよう少し待つ
  }

  ui.alert(
    '座標を作りました\n\n' +
    '新しく調べた：' + done + '件\n' +
    'すでにあった：' + skip + '件\n' +
    'みつからない：' + ng + '件\n\n' +
    '★「' + SH_GEO + '」のD列（Googleの解釈）を必ず確認してください。\n' +
    '　別の市町村になっていたら、その行のB・C列を消して住所を直し、もう一度実行します。'
  );
}

/** ── メニュー② Gem用テキストを作る ───────────────── */
function Gem用テキストを作る() {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var fac = 施設を読む_();
  var us  = 利用者を読む_();
  var sh  = ss.getSheetByName(SH_GEO);
  if (!sh || sh.getLastRow() < 2) {
    SpreadsheetApp.getUi().alert('先に「① 座標を作る」を実行してください。');
    return;
  }

  // 住所 → 座標 の対応表
  var pos = {}, miss = [];
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();
  for (var i = 0; i < vals.length; i++) {
    var a = String(vals[i][0] || '').trim();
    if (a && vals[i][1] && vals[i][2]) pos[a] = [vals[i][1], vals[i][2]];
  }

  var L = [];
  L.push('事業区分：放デイ');
  L.push('便：お迎え');
  L.push('事業所の住所（CONFIG.facility にこの文字列をそのまま入れる）：' + (fac.addr || '（未入力）'));
  L.push('事業所の座標（CONFIG.fac_pos）：' +
         (pos[fac.addr] ? pos[fac.addr][0] + ', ' + pos[fac.addr][1] : '（未取得）'));
  L.push('事業所名（CONFIG.facility_name・表示用）：' + (fac.name || '（未入力）'));
  L.push('乗降にかかる時間：5分');
  L.push('出発時刻：自動（最初のお迎え時刻から逆算する）');
  L.push('2便：使わない');
  L.push('');
  L.push('【車両】車両名/定員/添乗員');
  if (fac.vehicles.length) {
    for (var v = 0; v < fac.vehicles.length; v++) {
      L.push(fac.vehicles[v].name + '/' + fac.vehicles[v].cap + '/可');
    }
  } else {
    L.push('（①シートの車両設定が未入力です）');
  }
  L.push('');
  L.push('【利用者】氏名/お迎え先/住所/緯度/経度/お迎え時刻');
  for (var u = 0; u < us.length; u++) {
    var c = us[u], p = pos[c.addrAm];
    if (!p) { miss.push(c.name + '（' + (c.addrAm || '住所なし') + '）'); continue; }
    L.push([c.name, c.placeAm, c.addrAm, p[0], p[1], c.timeAm].join('/'));
  }
  L.push('');
  L.push('【職員】氏名/役割');
  var st = ss.getSheetByName(SH_STAFF);
  var staffN = 0;
  if (st && st.getLastRow() >= 2) {
    var sv = st.getRange(2, 1, st.getLastRow() - 1, 2).getValues();
    for (var s = 0; s < sv.length; s++) {
      var nm = String(sv[s][0] || '').trim();
      if (!nm) continue;
      L.push(nm + '/' + (String(sv[s][1] || '').indexOf('運転') >= 0 ? '運転手' : '支援員'));
      staffN++;
    }
  }
  if (!staffN) {
    L.push('（「' + SH_STAFF + '」シートに 氏名／役割 を入れるか、ここに手で追記してください）');
  }

  // ── 実測した移動時間を付ける（あれば）──
  var realSh = ss.getSheetByName(SH_REAL);
  var realN = 0;
  if (realSh && realSh.getLastRow() >= 2) {
    var rv = realSh.getRange(2, 1, realSh.getLastRow() - 1, 3).getValues();
    var lines = [];
    for (var q = 0; q < rv.length; q++) {
      var f = String(rv[q][0] || '').trim(), t2 = String(rv[q][1] || '').trim();
      if (!f || !t2 || rv[q][2] === '') continue;
      lines.push(f + '/' + t2 + '/' + rv[q][2]);
      realN++;
    }
    if (lines.length) {
      L.push('');
      L.push('【実測の移動時間】出発/到着/分　※Googleマップで実測。往復どちらでも同じ値を使う');
      L = L.concat(lines);
    }
  }

  var text = L.join('\n');
  if (miss.length) {
    text += '\n\n※ 座標が無いため外した方：' + miss.join('、');
  }
  if (!realN) {
    text += '\n\n※ 実測の移動時間がありません（「④ 実測時間を取る」を実行すると精度が上がります）';
  }

  // 同じGoogleドキュメントを毎回上書きする。
  // このドキュメントをGemの「知識」に入れておけば、貼り直さずに済む（かどうかは要検証）
  var url = Gem用ドキュメントに書く_(text);

  var html = HtmlService.createHtmlOutput(
      '<p style="font:13px sans-serif">' +
      '<b>方法A：</b>下の枠を全部コピーしてGemに貼る<br>' +
      '<b>方法B：</b><a href="' + url + '" target="_blank">この Googleドキュメント</a> を ' +
      'Gemの「知識」に入れておく（内容は実行のたびに上書きされます）</p>' +
      '<textarea style="width:100%;height:340px;font:12px monospace" onclick="this.select()">' +
      text.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</textarea>')
    .setWidth(780).setHeight(500);
  SpreadsheetApp.getUi().showModalDialog(html, 'Gemに渡すデータ');
}

/**
 * Gem用のGoogleドキュメントを用意して中身を差し替える。
 * 初回だけ作り、以降は同じファイルを上書きするので、
 * Gemの「知識」に一度入れておけば入れ直す必要がない（＝URLが変わらない）。
 */
function Gem用ドキュメントに書く_(text) {
  var props = PropertiesService.getDocumentProperties();
  var id = props.getProperty('GEM_DOC_ID');
  var doc = null;

  if (id) {
    try { doc = DocumentApp.openById(id); } catch (e) { doc = null; }  // 消された場合は作り直す
  }
  if (!doc) {
    doc = DocumentApp.create('送迎データ（Gem用・自動更新）');
    props.setProperty('GEM_DOC_ID', doc.getId());
    // スプレッドシートと同じフォルダへ移す（マイドライブ直下に散らからないように）
    try {
      var parents = DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId()).getParents();
      if (parents.hasNext()) DriveApp.getFileById(doc.getId()).moveTo(parents.next());
    } catch (e) { /* 移せなくても本体の動作には影響しない */ }
  }

  var url  = doc.getUrl();
  var body = doc.getBody();
  body.clear();
  body.appendParagraph('※ このファイルは「🚐 送迎 → ② Gem用テキストを作る」で自動更新されます。');
  body.appendParagraph('※ 手で書き換えても、次の実行で上書きされます。');
  body.appendParagraph('');
  body.appendParagraph(text);
  doc.saveAndClose();
  return url;
}


/* ══════════════════════════════════════════════════════════
   ③ Gemの準備（初回だけ）
   　このシートに埋め込んである「Gem指示文」と「配車ロジック.py」を
   　ドライブに書き出して、Gemの作り方と一緒に表示します。
   ══════════════════════════════════════════════════════════ */

/**
 * 非表示シートから取り出して元の文字に戻す。
 * セル1つに入る文字数に上限があるので、B列から右へ分割して保存してある。
 * 空のセルが出てくるまで、順につなぎ直す。
 */
function 埋め込みを取り出す_(key) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH_PAY);
  if (!sh) throw new Error('このシートには準備データが入っていません（' + SH_PAY + ' が無い）');
  var lastC = Math.max(2, sh.getLastColumn());
  var vals  = sh.getRange(1, 1, sh.getLastRow(), lastC).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).trim() !== key) continue;
    var b64 = '';
    for (var c = 1; c < lastC; c++) {
      var v = String(vals[i][c] == null ? '' : vals[i][c]).trim();
      if (!v) break;
      b64 += v;
    }
    if (!b64) break;
    return Utilities.newBlob(Utilities.base64Decode(b64)).getDataAsString('UTF-8');
  }
  throw new Error('準備データ「' + key + '」が見つかりません');
}

/** スプレッドシートと同じフォルダを返す（取れなければマイドライブ直下） */
function 同じフォルダ_() {
  try {
    var ps = DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId()).getParents();
    if (ps.hasNext()) return ps.next();
  } catch (e) {}
  return DriveApp.getRootFolder();
}

/** 同じ名前のファイルがあれば中身を差し替え、無ければ作る */
function ファイルを用意_(folder, name, content, type) {
  var it = folder.getFilesByName(name);
  if (it.hasNext()) {
    var f = it.next();
    f.setContent(content);
    return f;
  }
  return folder.createFile(name, content, type);
}

function Gemの準備() {
  var ui = SpreadsheetApp.getUi();
  var logic, prompt;
  try {
    logic  = 埋め込みを取り出す_('logic');
    prompt = 埋め込みを取り出す_('prompt');
  } catch (e) {
    ui.alert(e.message);
    return;
  }

  var folder = 同じフォルダ_();
  var f1 = ファイルを用意_(folder, '配車ロジック.py', logic, MimeType.PLAIN_TEXT);

  var html = HtmlService.createHtmlOutput(
    '<div style="font:13px/1.7 sans-serif">' +
    '<p><b>Gemの作り方（初回だけ）</b></p>' +
    '<ol style="padding-left:18px">' +
    '<li>Gemini を開き、<b>Gem マネージャー → 新しい Gem</b></li>' +
    '<li>名前：<code>送迎配車アシスタント</code></li>' +
    '<li><b>「指示」欄</b>に、下の枠の中身を全部貼る</li>' +
    '<li><b>「知識」</b>に、ドライブから ' +
    '<a href="' + f1.getUrl() + '" target="_blank"><b>配車ロジック.py</b></a> を追加する' +
    '<br><span style="color:#666">（このシートと同じフォルダに作りました）</span></li>' +
    '<li>保存</li>' +
    '</ol>' +
    '<p style="color:#666">そのあと「② Gem用テキストを作る」で出るドキュメントも「知識」に入れると、' +
    '毎回コピペせずに済みます。</p>' +
    '<textarea style="width:100%;height:300px;font:12px monospace" onclick="this.select()">' +
    prompt.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</textarea>' +
    '</div>')
    .setWidth(820).setHeight(600);
  ui.showModalDialog(html, 'Gemの準備');
}


/* ══════════════════════════════════════════════════════════
   ④ 実測時間を取る
   　Googleマップの経路検索で、区間の所要時間を実際に測ります。
   　APIキーも課金設定も不要です（Apps Scriptの無料サービス）。

   　全部の組み合わせは測りません。実際に走る可能性がある区間だけ測ります。
   　　・事業所 ↔ 全住所
   　　・各住所から近い10件
   　これで実走区間の9割以上をカバーできます。

   　測った結果は「⑤実測」に貯まり、二度と測り直しません。
   　6分の制限で途中終了したら、もう一度押せば続きから再開します。
   ══════════════════════════════════════════════════════════ */

/** 緯度経度から直線距離（km） */
function 直線km_(a, b) {
  var R = 6371, t = Math.PI / 180;
  var dLa = (b[0] - a[0]) * t, dLo = (b[1] - a[1]) * t;
  var h = Math.sin(dLa/2) * Math.sin(dLa/2) +
          Math.cos(a[0]*t) * Math.cos(b[0]*t) * Math.sin(dLo/2) * Math.sin(dLo/2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** ⑤実測 シートを用意する */
function 実測シート_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SH_REAL);
  if (!sh) {
    sh = ss.insertSheet(SH_REAL);
    sh.getRange(1, 1, 1, 4).setValues([['出発', '到着', '分', '取得日']])
      .setFontWeight('bold').setBackground('#e8f0fb');
    sh.setColumnWidth(1, 240); sh.setColumnWidth(2, 240);
    sh.setFrozenRows(1);
  }
  return sh;
}

/** 2地点間を実際に測る。取れなければ null */
function 二点間を測る_(from, to) {
  try {
    var res = Maps.newDirectionFinder()
      .setOrigin(from[0], from[1])
      .setDestination(to[0], to[1])
      .setMode(Maps.DirectionFinder.Mode.DRIVING)
      .setLanguage('ja')
      .getDirections();
    if (res && res.status === 'OK' && res.routes && res.routes.length) {
      var leg = res.routes[0].legs[0];
      return Math.round(leg.duration.value / 60);
    }
  } catch (e) {
    Logger.log('測定エラー: ' + e.message);
  }
  return null;
}

function 実測時間を取る() {
  var ui = SpreadsheetApp.getUi();
  var geo = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH_GEO);
  if (!geo || geo.getLastRow() < 2) {
    ui.alert('先に「① 座標を作る」を実行してください。');
    return;
  }

  // ── 座標つきの地点をそろえる ──
  var rows = geo.getRange(2, 1, geo.getLastRow() - 1, 3).getValues();
  var pts = [];
  for (var i = 0; i < rows.length; i++) {
    var a = String(rows[i][0] || '').trim();
    if (a && rows[i][1] && rows[i][2]) pts.push({ addr: a, pos: [Number(rows[i][1]), Number(rows[i][2])] });
  }
  if (pts.length < 2) { ui.alert('座標つきの住所が2件以上必要です。'); return; }

  var fac = String(施設を読む_().addr || '').trim();

  // ── 測るべき区間を洗い出す（重複しない組み合わせにする）──
  var want = {}, order = [];
  function add(i, j) {
    if (i === j) return;
    var k = (pts[i].addr < pts[j].addr) ? (i + '|' + j) : (j + '|' + i);
    if (!want[k]) { want[k] = [i, j]; order.push(k); }
  }
  for (var i = 0; i < pts.length; i++) {
    // 事業所との往復
    if (fac && pts[i].addr !== fac) {
      for (var f = 0; f < pts.length; f++) if (pts[f].addr === fac) add(f, i);
    }
    // 近い NEAR_K 件
    var others = [];
    for (var j = 0; j < pts.length; j++) if (j !== i) others.push({ j: j, d: 直線km_(pts[i].pos, pts[j].pos) });
    others.sort(function (x, y) { return x.d - y.d; });
    for (var k = 0; k < Math.min(NEAR_K, others.length); k++) add(i, others[k].j);
  }

  // ── すでに測った区間は飛ばす ──
  var sh = 実測シート_();
  var last = sh.getLastRow();
  var have = {};
  if (last >= 2) {
    var old = sh.getRange(2, 1, last - 1, 3).getValues();
    for (var m = 0; m < old.length; m++) {
      var a1 = String(old[m][0] || '').trim(), a2 = String(old[m][1] || '').trim();
      if (a1 && a2 && old[m][2] !== '') { have[a1 + '||' + a2] = true; have[a2 + '||' + a1] = true; }
    }
  }

  var todo = [];
  for (var o = 0; o < order.length; o++) {
    var p = want[order[o]];
    if (!have[pts[p[0]].addr + '||' + pts[p[1]].addr]) todo.push(p);
  }

  if (!todo.length) {
    ui.alert('測るべき区間はもうありません。\n\n' +
             '貯まっている区間：' + Math.max(0, sh.getLastRow() - 1) + '件\n' +
             '「② Gem用テキストを作る」に進んでください。');
    return;
  }

  // ── 測る（時間切れになったら途中で止めて、次回に続きから）──
  var start = new Date().getTime();
  var done = 0, ng = 0, stopped = false;
  var buf = [];
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy/MM/dd');

  for (var t = 0; t < todo.length; t++) {
    if (new Date().getTime() - start > TIME_LIMIT) { stopped = true; break; }
    var A = pts[todo[t][0]], B = pts[todo[t][1]];
    var min = 二点間を測る_(A.pos, B.pos);
    if (min === null) { ng++; } else { buf.push([A.addr, B.addr, min, today]); done++; }
    // 20件ごとに書き出す（途中で止まっても測り直しにならないように）
    if (buf.length >= 20) {
      sh.getRange(sh.getLastRow() + 1, 1, buf.length, 4).setValues(buf);
      buf = [];
    }
    Utilities.sleep(120);
  }
  if (buf.length) sh.getRange(sh.getLastRow() + 1, 1, buf.length, 4).setValues(buf);

  var remain = todo.length - done - ng;
  ui.alert(
    (stopped ? '途中まで測りました（時間切れ）' : '実測が終わりました') + '\n\n' +
    '今回測った：' + done + '件\n' +
    '測れなかった：' + ng + '件\n' +
    '残り：' + remain + '件\n\n' +
    (stopped
      ? '★ もう一度「④ 実測時間を取る」を押すと、続きから再開します。'
      : '「② Gem用テキストを作る」に進んでください。')
  );
}
