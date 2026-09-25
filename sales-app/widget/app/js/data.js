/* =========================================================================
 * data.js — データアクセス層
 *
 *   1) Zoho Creator SDK 経由（本番）
 *   2) ローカルで開いたときはデモモード（localStorage）に自動で切り替わる
 *
 * スキルの雛形（template/widget/app/js/data.js）からの変更点：
 *   - SDK v2 には ZOHO.CREATOR.init() が無い（実際の Creator で「init が無い」ために止まった）。
 *     init は「あれば呼ぶ」扱いにし、SDK の有無はデータ操作の関数があるかで判定する
 *   - getInitParams() は v2 では Promise を返す。同期の値でも Promise でも受け取れるようにする
 *   - 更新は v2 の資料にある updateRecordById を優先し、無ければ updateRecord を使う
 *   - Creator の中（iframe の中）で SDK が使えないときは、デモへ落とさずエラーで止める
 *     （利用者が「保存されない画面」に入力してしまうのを防ぐ）。止めるときは SDK の形を表示する
 *   - 取得エラーのうち「0件」だけを空配列にし、権限エラーなどは呼び出し側へ返す
 *   - 追加・更新の応答の code を確認する（成功は 3000。REST API v2.1 形式の result 配列も見る）
 *   - 更新日時は FIELD_MAP に Updated_At がある項目にだけ書く（操作記録には送らない）
 * ========================================================================= */
var DB = (function () {
  var connected = false;
  var demo = false;
  var store = null;
  var initParams = {};

  function uid(p) { return (p || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function lsKey(k) { return CFG.STORAGE_PREFIX + k; }
  function lsGet(k, d) { try { var v = localStorage.getItem(lsKey(k)); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(lsKey(k), JSON.stringify(v)); } catch (e) { console.warn('保存に失敗', e); } }

  function errText(e) {
    if (e == null) return '不明なエラー';
    if (typeof e === 'string') return e;
    var s = e.message ? String(e.message) : '';
    if (e.code) s += (s ? '' : 'エラー') + '（code ' + e.code + '）';
    if (e.error) { try { s += ' ' + (typeof e.error === 'string' ? e.error : JSON.stringify(e.error)); } catch (x) { /* 表示できない値は省く */ } }
    if (s) return s;
    try { return JSON.stringify(e); } catch (x) { return String(e); }
  }

  /* 0件のレポートは、成功ではなくエラーで返ってくる（9220 など）。
     これだけを空配列として扱う。何でも握ると、権限エラーで読めなかったデータが
     「0件」に見えてしまい、画面は正常なまま数字だけが間違う */
  function isNoRecords(e) {
    var s = '';
    try { s = (typeof e === 'string') ? e : (JSON.stringify(e) || ''); } catch (x) { s = ''; }
    s += ' ' + ((e && e.message) || '') + ' ' + ((e && e.code) || '');
    return /\b(9220|3100)\b/.test(s) || /no\s+(records?|data)/i.test(s);
  }

  /* Creator のウィジェットは iframe の中で動く。デモモードは iframe の外
     （ローカルでファイルを開いたとき）か、?demo=1 を付けたときだけ許す */
  function inFrame() { try { return window.self !== window.top; } catch (e) { return true; } }
  function demoAllowed() { return !inFrame() || /[?&]demo=1(&|$)/.test(location.search); }

  /* ---------- SDK の判定 ---------- */
  /* データ操作に使う関数があれば「SDK あり」とする（init の有無では判定しない） */
  function sdkReady() {
    return typeof ZOHO !== 'undefined' && !!ZOHO && !!ZOHO.CREATOR && !!ZOHO.CREATOR.DATA &&
      typeof ZOHO.CREATOR.DATA.getRecords === 'function';
  }
  /* SDK が持っている関数の一覧（止めたときの診断表示用。プロトタイプ上の関数も拾う） */
  function fnNames(o) {
    var out = [];
    for (var p = o; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
      Object.getOwnPropertyNames(p).forEach(function (k) {
        try { if (k !== 'constructor' && typeof o[k] === 'function' && out.indexOf(k) < 0) out.push(k); } catch (e) { /* 読めない項目は飛ばす */ }
      });
    }
    return out.sort().join(',') || '（なし）';
  }
  function sdkShape() {
    if (typeof ZOHO === 'undefined' || !ZOHO) return 'ZOHO=' + typeof ZOHO;
    var c = ZOHO.CREATOR;
    if (!c) return 'ZOHO=' + Object.keys(ZOHO).join(',') + ' / CREATOR=なし';
    return 'CREATOR=' + Object.keys(c).sort().join(',') + ' / init=' + typeof c.init +
      ' / DATA=' + (c.DATA ? fnNames(c.DATA) : 'なし') + ' / UTIL=' + (c.UTIL ? fnNames(c.UTIL) : 'なし');
  }

  /* ---------- 初期化 ---------- */
  function init(seedFn) {
    return new Promise(function (resolve, reject) {
      var done = false, timer = null, waited = 0;
      function fallback(reason) {
        if (done) return;
        done = true; clearTimeout(timer);
        if (demoAllowed()) { startDemo(reason, seedFn); resolve({ connected: false, reason: reason }); return; }
        var err = new Error('Zoho Creator に接続できませんでした（' + reason + '）');
        err.diag = sdkShape();
        reject(err);
      }
      function connect() {
        var c = ZOHO.CREATOR;
        /* 応答が無いまま固まるのを防ぐ */
        timer = setTimeout(function () { fallback('SDK応答なし'); }, 8000);
        Promise.resolve().then(function () {
          /* v1 形式の SDK は init() が必要。v2 には無いので、あるときだけ呼ぶ */
          return typeof c.init === 'function' ? c.init() : null;
        }).then(function () {
          /* v2 の getInitParams() は Promise を返す。同期で値を返す形にも対応する */
          var p = (c.UTIL && typeof c.UTIL.getInitParams === 'function') ? c.UTIL.getInitParams() : null;
          return Promise.resolve(p).catch(function (e) { console.warn('[営業管理] getInitParams に失敗', e); return null; });
        }).then(function (p) {
          if (done) return;
          done = true; clearTimeout(timer);
          connected = true;
          p = p || {};
          initParams = (!p.loginUser && p.data && p.data.loginUser) ? p.data : p;
          resolve({ connected: true });
        }).catch(function (e) {
          fallback('SDK初期化エラー: ' + errText(e));
        });
      }
      /* SDK は <head> で同期的に読み込むので通常はすぐ見つかる。
         Creator の中でだけ、念のため少し待ってから判定する */
      (function check() {
        if (sdkReady()) return connect();
        if (!inFrame() || waited >= 2000) return fallback('SDK未検出');
        waited += 100;
        setTimeout(check, 100);
      })();
    });
  }
  function startDemo(reason, seedFn) {
    connected = false; demo = true;
    console.info('[営業管理] デモモードで起動します（' + reason + '）');
    store = lsGet('demo_db', null);
    if (!store && seedFn) { store = seedFn(); lsSet('demo_db', store); }
    if (!store) store = {};
  }
  function persist() { if (demo) lsSet('demo_db', store); }

  /* ---------- SDK ラッパ（パラメータ名は snake_case） ---------- */
  function sdkGet(reportName, criteria) {
    var q = { report_name: reportName, max_records: CFG.MAX_RECORDS };
    if (criteria) q.criteria = criteria;
    return ZOHO.CREATOR.DATA.getRecords(q).then(function (res) {
      if (res && res.code != null && String(res.code) !== '3000') throw res;
      var rows = (res && res.data) || [];
      return { rows: rows, truncated: rows.length >= CFG.MAX_RECORDS };
    }).catch(function (e) {
      if (isNoRecords(e)) return { rows: [], truncated: false };
      throw e;
    });
  }
  /* 失敗が resolve で返ってくる場合に備えて code を確認する（成功は 3000）。
     REST API v2.1 形式では、レコードごとの結果が result 配列に入る */
  function checkRes(res) {
    if (res && res.code != null && String(res.code) !== '3000') throw res;
    if (res && Array.isArray(res.result)) {
      res.result.forEach(function (r) { if (r && r.code != null && String(r.code) !== '3000') throw r; });
    }
    return res;
  }
  function recordId(res) {
    var d = res && res.data;
    if (d && d.ID) return d.ID;
    if (Array.isArray(d) && d[0] && d[0].ID) return d[0].ID;
    var r = res && Array.isArray(res.result) ? res.result[0] : null;
    return (r && r.data && (r.data.ID || (r.data[0] && r.data[0].ID))) || null;
  }
  function sdkAdd(formName, data) {
    return ZOHO.CREATOR.DATA.addRecords({ form_name: formName, payload: { data: data } }).then(checkRes);
  }
  function sdkUpdate(reportName, id, data) {
    var D = ZOHO.CREATOR.DATA;
    /* v2 の資料では updateRecordById。スキルの資料では updateRecord。ある方を使う */
    var fn = typeof D.updateRecordById === 'function' ? 'updateRecordById' : 'updateRecord';
    return D[fn]({ report_name: reportName, id: String(id), payload: { data: data } }).then(checkRes);
  }

  /* デモモードでは criteria を解釈できないので、単純な等値条件だけ手元で絞る */
  function demoFilter(entity, rows, criteria) {
    if (!criteria) return rows;
    var m = String(criteria).match(/^(\w+)\s*==\s*"(.*)"$/);
    var map = CFG.FIELD_MAP[entity] || {}, mine = null;
    if (m) Object.keys(map).forEach(function (k) { if (map[k] === m[1]) mine = k; });
    if (!mine) { console.warn('[デモ] criteria を解釈できません: ' + criteria); return []; }
    return rows.filter(function (r) { return String(r[mine]) === m[2]; });
  }

  /* ---------- 公開メソッド ---------- */
  function list(entity, criteria) {
    if (demo) {
      var rows = JSON.parse(JSON.stringify(store[entity] || []));
      return Promise.resolve(demoFilter(entity, rows, criteria));
    }
    return sdkGet(CFG.REPORTS[entity], criteria).then(function (res) {
      var out = res.rows.map(function (r) { return Mapper.fromCreator(entity, r); });
      out.truncated = res.truncated;
      return out;
    });
  }
  function add(entity, obj) {
    if (demo) {
      obj.ID = obj.ID || uid(entity);
      if ((CFG.FIELD_MAP[entity] || {}).Updated_At) obj.Updated_At = Dates.nowJST();
      store[entity] = store[entity] || [];
      store[entity].push(JSON.parse(JSON.stringify(obj)));
      persist();
      return Promise.resolve(obj);
    }
    return sdkAdd(CFG.FORMS[entity], Mapper.toCreator(entity, obj)).then(function (res) {
      var id = recordId(res);
      if (!id) throw new Error('保存はできた可能性がありますが、レコードIDを受け取れませんでした。再読み込みして確認してください: ' + errText(res));
      obj.ID = String(id);
      return obj;
    });
  }
  function update(entity, id, patch) {
    if (demo) {
      var hit = false;
      (store[entity] || []).forEach(function (r) {
        if (String(r.ID) !== String(id)) return;
        hit = true;
        Object.keys(patch).forEach(function (k) { r[k] = patch[k]; });
        if ((CFG.FIELD_MAP[entity] || {}).Updated_At) r.Updated_At = Dates.nowJST();
      });
      if (!hit) return Promise.reject(new Error('対象のレコードがありません: ' + id));
      persist();
      return Promise.resolve(patch);
    }
    return sdkUpdate(CFG.REPORTS[entity], id, Mapper.toCreator(entity, patch)).then(function () { return patch; });
  }

  return {
    init: init, list: list, add: add, update: update,
    isConnected: function () { return connected; },
    isDemo: function () { return demo; },
    initParams: function () { return initParams; },
    sdkShape: sdkShape,
    resetDemo: function (seedFn) { store = seedFn ? seedFn() : {}; persist(); },
    uid: uid, lsGet: lsGet, lsSet: lsSet, errText: errText
  };
})();

/* =========================================================================
 * Mapper — 画面内部の項目名 ⇔ Creator のフィールド リンク名
 * ========================================================================= */
var Mapper = (function () {
  /* ルックアップを使う設計に変えても壊れないようにしておく */
  function flat(v) { return (v && typeof v === 'object') ? (v.ID || v.id || v.display_value || '') : (v == null ? '' : v); }
  function isBool(key) { return CFG.BOOL_FIELDS.indexOf(key) >= 0; }

  /** Creator 側は text 型なので "false" という文字列が返る。JavaScript では真になるため必ず変換する */
  function toBool(v) {
    if (typeof v === 'boolean') return v;
    var s = String(v == null ? '' : v).trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'yes' || s === '○';
  }

  function fromCreator(entity, r) {
    var map = CFG.FIELD_MAP[entity] || {};
    var o = { ID: String(r.ID) };
    Object.keys(map).forEach(function (mine) {
      var v = flat(r[map[mine]]);
      if (isBool(mine)) {
        /* 空欄は既定値にする（Creator の画面から直接登録して空欄のままでも「在籍」になるように） */
        o[mine] = (String(v).trim() === '') ? CFG.BOOL_DEFAULT_TRUE.indexOf(mine) >= 0 : toBool(v);
      } else if (CFG.DATE_FIELDS.indexOf(mine) >= 0) {
        o[mine] = Dates.norm(v);
      } else if (CFG.MONTH_FIELDS.indexOf(mine) >= 0) {
        o[mine] = Dates.normMonth(v);
      } else {
        o[mine] = v;
      }
    });
    return o;
  }
  function toCreator(entity, o) {
    var map = CFG.FIELD_MAP[entity] || {};
    var d = {};
    Object.keys(map).forEach(function (mine) {
      if (mine === 'Updated_At' || !(mine in o)) return;
      var v = o[mine];
      if (isBool(mine)) v = (toBool(v) ? 'true' : 'false');
      else if (Array.isArray(v)) v = v.join(',');
      else if (v == null) v = '';
      d[map[mine]] = v;
    });
    /* 更新日時は、その項目を持つフォームにだけ書く。フォームに無い項目は送らない */
    if (map.Updated_At) d[map.Updated_At] = Dates.nowJST();
    return d;
  }
  return { fromCreator: fromCreator, toCreator: toCreator, flat: flat, toBool: toBool };
})();

/* =========================================================================
 * Num — 数値の解釈は1か所に統一する
 *   独自パーサを複数書くと「30万円」が 30 になるなど、場所によって値が食い違う。
 * ========================================================================= */
var Num = (function () {
  function parse(v) {
    if (v == null || v === '') return NaN;
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    var s = String(v)
      .replace(/[０-９．－]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[，]/g, ',').trim();
    var unit = s.match(/^([\d,\.]+)\s*(億|万|千)?\s*円?$/);
    if (unit) {
      var base = Number(unit[1].replace(/,/g, ''));
      if (!isFinite(base)) return NaN;
      return base * ({ '億': 1e8, '万': 1e4, '千': 1e3 }[unit[2]] || 1);
    }
    var plain = s.replace(/[¥￥,\s]/g, '');
    return /^-?\d+(\.\d+)?$/.test(plain) ? Number(plain) : NaN;
  }
  function num(v) { var n = parse(v); return isNaN(n) ? 0 : n; }
  function yen(v) { return '¥' + Math.round(num(v)).toLocaleString('ja-JP'); }
  return { parse: parse, num: num, yen: yen };
})();

/* =========================================================================
 * Dates — 日付は「日本時間の yyyy-MM-dd 文字列」で扱う
 *   toISOString() は UTC を返すので、9時間ずらしたインスタンスから日付キーを作る。
 *   ブラウザのタイムゾーンに関係なく、日本時間の「今日」「今月」になる。
 * ========================================================================= */
var Dates = (function () {
  function pad(n) { n = Number(n); return (n < 10 ? '0' : '') + n; }
  function jst() { return new Date(Date.now() + 9 * 3600000); }
  function today() { return jst().toISOString().slice(0, 10); }
  function month() { return today().slice(0, 7); }
  function nowJST() { var s = jst().toISOString(); return s.slice(0, 10) + ' ' + s.slice(11, 19); }
  function addDays(key, n) {
    var d = new Date(key + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function addMonths(mkey, n) {
    var d = new Date(Date.UTC(Number(mkey.slice(0, 4)), Number(mkey.slice(5, 7)) - 1 + n, 1));
    return d.toISOString().slice(0, 7);
  }
  function monthEnd(mkey) { return addDays(addMonths(mkey, 1) + '-01', -1); }
  function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s == null ? '' : s)); }
  function isMonth(s) { return /^\d{4}-\d{2}$/.test(String(s == null ? '' : s)); }
  function clean(v) {
    return String(v == null ? '' : v).trim()
      .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[年月\/／．.]/g, '-').replace(/日/g, '');
  }
  /* CSV で「2026/9/5」のように入っていても、比較できる「2026-09-05」にそろえる。
     読めない形はそのまま返す（黙って別の日付にしない） */
  function norm(v) {
    var m = clean(v).match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/);
    return m ? m[1] + '-' + pad(m[2]) + '-' + pad(m[3]) : String(v == null ? '' : v).trim();
  }
  function normMonth(v) {
    var m = clean(v).match(/^(\d{4})-(\d{1,2})(?!\d)/);
    return m ? m[1] + '-' + pad(m[2]) : String(v == null ? '' : v).trim();
  }
  /* 今年の日付は「9/25」、ほかの年は「2027/1/15」と表示する */
  function md(key) {
    if (!isDate(key)) return '';
    var s = Number(key.slice(5, 7)) + '/' + Number(key.slice(8, 10));
    return key.slice(0, 4) === today().slice(0, 4) ? s : key.slice(0, 4) + '/' + s;
  }
  function monthLabel(mkey) { return isMonth(mkey) ? mkey.slice(0, 4) + '年' + Number(mkey.slice(5, 7)) + '月' : String(mkey); }
  return {
    today: today, month: month, nowJST: nowJST, addDays: addDays, addMonths: addMonths, monthEnd: monthEnd,
    isDate: isDate, isMonth: isMonth, norm: norm, normMonth: normMonth, md: md, monthLabel: monthLabel
  };
})();
