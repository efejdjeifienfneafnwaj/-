/* =========================================================================
 * data.js — データアクセス層
 *
 *   1) Zoho Creator SDK 経由（本番）
 *   2) SDK が無い環境ではデモモード（localStorage）に自動で切り替わる
 *
 * デモモードがあると、Creator にアップロードする前にブラウザで画面を確認できる。
 * これが無いと、修正のたびに zip を作り直してアップロードすることになる。
 * ========================================================================= */
var DB = (function () {
  var connected = false;
  var demo = false;
  var store = null;
  var initParams = {};

  function uid(p) { return (p || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function nowISO() { return new Date().toISOString(); }
  function lsKey(k) { return CFG.STORAGE_PREFIX + k; }
  function lsGet(k, d) { try { var v = localStorage.getItem(lsKey(k)); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(lsKey(k), JSON.stringify(v)); } catch (e) { console.warn('保存に失敗', e); } }

  /* ---------- 初期化 ---------- */
  function init(seedFn) {
    return new Promise(function (resolve) {
      var hasSDK = (typeof ZOHO !== 'undefined' && ZOHO.CREATOR && typeof ZOHO.CREATOR.init === 'function');
      if (!hasSDK) { startDemo('SDK未検出', seedFn); return resolve({ connected: false }); }

      var done = false;
      /* 応答が無いまま固まるのを防ぐ */
      var timer = setTimeout(function () {
        if (done) return;
        done = true; startDemo('SDK応答なし', seedFn); resolve({ connected: false });
      }, 6000);

      try {
        ZOHO.CREATOR.init().then(function () {
          if (done) return; done = true; clearTimeout(timer);
          connected = true;
          try { initParams = (ZOHO.CREATOR.UTIL && ZOHO.CREATOR.UTIL.getInitParams()) || {}; } catch (e) { initParams = {}; }
          resolve({ connected: true });
        }).catch(function (e) {
          if (done) return; done = true; clearTimeout(timer);
          startDemo('SDK初期化エラー: ' + (e && e.message ? e.message : e), seedFn);
          resolve({ connected: false });
        });
      } catch (e) {
        if (!done) { done = true; clearTimeout(timer); startDemo('SDK例外', seedFn); resolve({ connected: false }); }
      }
    });
  }
  function startDemo(reason, seedFn) {
    connected = false; demo = true;
    console.info('[アプリ] デモモードで起動します（' + reason + '）');
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
      var rows = (res && res.data) || [];
      if (rows.length >= CFG.MAX_RECORDS) console.warn('[アプリ] ' + reportName + ' が上限に達しました');
      return rows;
    }).catch(function (e) {
      /* 0件のときもエラーが返る。ここで握らないと初期導入時にアプリが止まる */
      console.warn('取得できませんでした（0件の可能性）: ' + reportName, e);
      return [];
    });
  }
  function sdkAdd(formName, data) {
    return ZOHO.CREATOR.DATA.addRecords({ form_name: formName, payload: { data: data } });
  }
  function sdkUpdate(reportName, id, data) {
    return ZOHO.CREATOR.DATA.updateRecord({ report_name: reportName, id: String(id), payload: { data: data } });
  }

  /* ---------- 公開メソッド ---------- */
  function list(entity, criteria) {
    if (demo) {
      var rows = JSON.parse(JSON.stringify(store[entity] || []));
      /* デモモードでは criteria を解釈できないので、単純な等値条件だけ手元で絞る */
      var m = criteria && String(criteria).match(/^(\w+)\s*==\s*"(.*)"$/);
      if (m) {
        var map = CFG.FIELD_MAP[entity] || {}, mine = null;
        Object.keys(map).forEach(function (k) { if (map[k] === m[1]) mine = k; });
        if (mine) rows = rows.filter(function (r) { return String(r[mine]) === m[2]; });
      }
      return Promise.resolve(rows);
    }
    return sdkGet(CFG.REPORTS[entity], criteria).then(function (rows) {
      return rows.map(function (r) { return Mapper.fromCreator(entity, r); });
    });
  }
  function add(entity, obj) {
    if (demo) {
      obj.ID = obj.ID || uid(entity);
      store[entity] = store[entity] || []; store[entity].push(obj); persist();
      return Promise.resolve(obj);
    }
    return sdkAdd(CFG.FORMS[entity], Mapper.toCreator(entity, obj)).then(function (res) {
      var d = res && res.data;
      obj.ID = (d && (d.ID || (d[0] && d[0].ID))) || uid(entity);
      return obj;
    });
  }
  function update(entity, id, patch) {
    if (demo) {
      (store[entity] || []).forEach(function (r) {
        if (String(r.ID) === String(id)) Object.keys(patch).forEach(function (k) { r[k] = patch[k]; });
      });
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
    resetDemo: function (seedFn) { store = seedFn ? seedFn() : {}; persist(); },
    uid: uid, nowISO: nowISO, lsGet: lsGet, lsSet: lsSet
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
    var o = { ID: r.ID };
    Object.keys(map).forEach(function (mine) {
      var v = flat(r[map[mine]]);
      o[mine] = isBool(mine) ? toBool(v) : v;
    });
    return o;
  }
  function toCreator(entity, o) {
    var map = CFG.FIELD_MAP[entity] || {};
    var d = {};
    Object.keys(map).forEach(function (mine) {
      if (!(mine in o)) return;
      var v = o[mine];
      if (isBool(mine)) v = (v ? 'true' : 'false');
      else if (Array.isArray(v)) v = v.join(',');
      else if (v == null) v = '';
      d[map[mine]] = v;
    });
    d.updated_at = DB.nowISO();
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
  function yen(v) { return '¥' + num(v).toLocaleString('ja-JP'); }
  return { parse: parse, num: num, yen: yen };
})();
