/* =========================================================================
 * data.js — データアクセス層
 *   1) Zoho Creator SDK 経由（本番）
 *   2) SDK が無い環境ではデモモード（localStorage）に自動フォールバック
 *   すべての読み取りは Access.log() を通し、「誰が何を見たか」を必ず残します。
 * ========================================================================= */
var DB = (function () {
  var connected = false;
  var sdkKind = 'demo';          // 'data' | 'api' | 'demo'
  var store = null;              // デモモード時のインメモリDB
  var initParams = {};

  /* ---------- 共通ユーティリティ ---------- */
  function uid(p) { return (p || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function nowISO() { return new Date().toISOString(); }
  function lsKey(k) { return CFG.STORAGE_PREFIX + k; }
  function lsGet(k, d) { try { var v = localStorage.getItem(lsKey(k)); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(lsKey(k), JSON.stringify(v)); } catch (e) { console.warn('保存に失敗', e); } }

  /* ---------- 初期化：SDK の有無を判定 ---------- */
  function init() {
    return new Promise(function (resolve) {
      var hasSDK = (typeof ZOHO !== 'undefined' && ZOHO.CREATOR && typeof ZOHO.CREATOR.init === 'function');
      if (!hasSDK) { startDemo('SDK未検出'); return resolve({ connected: false, kind: 'demo' }); }
      var done = false;
      var timer = setTimeout(function () {
        if (!done) { done = true; startDemo('SDK応答なし'); resolve({ connected: false, kind: 'demo' }); }
      }, 6000);
      try {
        ZOHO.CREATOR.init().then(function () {
          if (done) return; done = true; clearTimeout(timer);
          connected = true;
          sdkKind = 'data';
          try { initParams = (ZOHO.CREATOR.UTIL && ZOHO.CREATOR.UTIL.getInitParams) ? (ZOHO.CREATOR.UTIL.getInitParams() || {}) : {}; } catch (e) { initParams = {}; }
          resolve({ connected: true, kind: sdkKind });
        }).catch(function (e) {
          if (done) return; done = true; clearTimeout(timer);
          startDemo('SDK初期化エラー: ' + (e && e.message ? e.message : e));
          resolve({ connected: false, kind: 'demo' });
        });
      } catch (e) {
        if (!done) { done = true; clearTimeout(timer); startDemo('SDK例外'); resolve({ connected: false, kind: 'demo' }); }
      }
    });
  }
  function startDemo(reason) {
    connected = false; sdkKind = 'demo';
    console.info('[社内申請システム] デモモードで起動します（' + reason + '）');
    store = lsGet('demo_db', null);
    if (!store) { store = Seed.build(); lsGet && lsSet('demo_db', store); }
  }
  function persist() { if (sdkKind === 'demo') lsSet('demo_db', store); }

  /* ---------- Creator API ラッパ ----------
   * パラメータ名は実際に Creator 上で動作している呼び出しに合わせてある：
   *   getRecords  : { report_name, max_records, criteria }
   *   addRecords  : { form_name,   payload: { data: {...} } }
   *   updateRecord: { report_name, id, payload: { data: {...} } }
   * 0件のときも SDK がエラーを返すこと（コード 9220 / 3100）があるため、
   * 取得側は握って空配列で進める。
   * ------------------------------------------------------------------- */
  var MAX_RECORDS = 1000;

  function sdkGetAll(reportName, criteria) {
    var q = { report_name: reportName, max_records: MAX_RECORDS };
    if (criteria) q.criteria = criteria;
    return ZOHO.CREATOR.DATA.getRecords(q).then(function (res) {
      var rows = (res && res.data) || [];
      if (rows.length >= MAX_RECORDS) console.warn('[社内申請システム] ' + reportName + ' が上限' + MAX_RECORDS + '件に達しました');
      return rows;
    }).catch(function (e) {
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
    if (sdkKind === 'demo') {
      return Promise.resolve(JSON.parse(JSON.stringify(store[entity] || [])));
    }
    return sdkGetAll(CFG.REPORTS[entity], criteria).then(function (rows) {
      return rows.map(function (r) { return Mapper.fromCreator(entity, r); });
    });
  }
  function add(entity, obj) {
    if (sdkKind === 'demo') {
      obj.ID = obj.ID || uid(entity);
      obj.Added_Time = nowISO();
      store[entity] = store[entity] || []; store[entity].push(obj); persist();
      return Promise.resolve(obj);
    }
    return sdkAdd(CFG.FORMS[entity], Mapper.toCreator(entity, obj)).then(function (res) {
      var d = res && res.data;
      var id = d && (d.ID || (d[0] && d[0].ID));
      obj.ID = id || uid(entity);
      return obj;
    });
  }
  function update(entity, id, patch) {
    if (sdkKind === 'demo') {
      var rows = store[entity] || [];
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i].ID) === String(id)) { Object.keys(patch).forEach(function (k) { rows[i][k] = patch[k]; }); persist(); return Promise.resolve(rows[i]); }
      }
      return Promise.resolve(null);
    }
    return sdkUpdate(CFG.REPORTS[entity], id, Mapper.toCreator(entity, patch)).then(function () { return patch; });
  }
  function resetDemo() { store = Seed.build(); persist(); }
  function wipeDemo() { store = Seed.empty(); persist(); }

  return {
    init: init, list: list, add: add, update: update,
    isConnected: function () { return connected; },
    kind: function () { return sdkKind; },
    initParams: function () { return initParams; },
    resetDemo: resetDemo, wipeDemo: wipeDemo,
    uid: uid, nowISO: nowISO, lsGet: lsGet, lsSet: lsSet
  };
})();

/* =========================================================================
 * Mapper — widget のキャメル寄り項目名 ⇔ Creator フィールド リンク名
 * Creator 側のリンク名を変えたときはここだけ直せば済むようにしています。
 * ========================================================================= */
var Mapper = (function () {
  /* Creator のルックアップは {ID, display_value} で返る。
     本アプリは text 中心の設計だが、将来ルックアップ化しても壊れないようにしておく。 */
  function flat(v) { return (v && typeof v === 'object') ? (v.ID || v.id || v.display_value || '') : (v == null ? '' : v); }
  function isBool(key) { return CFG.BOOL_FIELDS.indexOf(key) >= 0; }
  function toBool(v) {
    if (typeof v === 'boolean') return v;
    var s = String(v == null ? '' : v).trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'yes' || s === '○';
  }

  /** Creator のレコード → 画面内部の形 */
  function fromCreator(entity, r) {
    var map = CFG.FIELD_MAP[entity] || {};
    var o = { ID: r.ID };
    Object.keys(map).forEach(function (mine) {
      var theirs = map[mine];
      var v = flat(r[theirs]);
      o[mine] = isBool(mine) ? toBool(v) : v;
    });
    /* 画面が使う別名を補う */
    if (entity === 'Employees') { o.Department = o.Department_name; }
    if (entity === 'Requests') { o.Applicant_Dept = o.Applicant_Dept_name; o.Amount = Number(o.Amount) || 0; }
    if (entity === 'Approvals') { o.Step_No = Number(o.Step_No) || 0; }
    if (entity === 'AccessLogs') {
      o.Result_Count = o.Result_Count === '' ? '' : Number(o.Result_Count);
      o.Duration_Sec = o.Duration_Sec === '' ? '' : Number(o.Duration_Sec);
    }
    return o;
  }

  /** 画面内部の形 → Creator へ送る形（真偽は "true"/"false" の文字列にする） */
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
 * Access — 閲覧証跡（このアプリの中核）
 *   ・詳細を開く / 一覧を出す / 検索する / CSV出力する / 印刷する
 *     …すべてを Access_Logs に追記する。
 *   ・書き込みは fire-and-forget（画面を止めない）だが、失敗は握りつぶさず
 *     未送信キューに積み、次回操作時に再送する。
 *   ・widget からは「追記」しかできない。更新・削除は Creator 側で権限を
 *     与えないこと（＝証跡の改ざん防止）。
 * ========================================================================= */
var Access = (function () {
  var queue = [];
  var sessionId = 'sess_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  var viewStart = {};

  function ctx() {
    var p = DB.initParams() || {};
    return {
      loginUser: p.loginUser || p.loginuser || '',
      appLinkName: p.appLinkName || '',
      env: p.environment || ''
    };
  }
  function sensitivityOf(typeCode) { return (CFG.ACCESS.SENSITIVITY[typeCode] || 'C'); }

  /**
   * 閲覧・操作を記録する
   * @param {string} action  CFG.ACCESS.ACTIONS のいずれか
   * @param {object} opt     {targetType, targetId, targetNo, targetSubject, typeCode,
   *                          ownerDept, detail, resultCount, durationSec}
   */
  function log(action, opt) {
    opt = opt || {};
    var me = App.me() || {};
    var c = ctx();
    var rec = {
      Log_Time: DB.nowISO(),
      Session_ID: sessionId,
      Actor: me.ID || '',
      Actor_Name: me.Employee_Name || c.loginUser || '不明',
      Actor_Dept: me.Department_name || me.Department || '',
      Actor_Role: (me.Roles || []).join('・'),
      Login_User: c.loginUser,
      Action: action,
      Target_Type: opt.targetType || '',
      Target_ID: opt.targetId || '',
      Target_No: opt.targetNo || '',
      Target_Subject: opt.targetSubject || '',
      Request_Type_Code: opt.typeCode || '',
      Sensitivity: opt.typeCode ? sensitivityOf(opt.typeCode) : '',
      Owner_Dept: opt.ownerDept || '',
      Cross_Dept: !!(opt.ownerDept && me.Department_name && opt.ownerDept !== me.Department_name),
      Result_Count: opt.resultCount == null ? '' : opt.resultCount,
      Duration_Sec: opt.durationSec == null ? '' : opt.durationSec,
      Detail: opt.detail || '',
      User_Agent: (navigator.userAgent || '').slice(0, 240)
    };
    /* 画面上の集計・閲覧者一覧へ即時反映（Creator への書き込みは非同期で追随） */
    try {
      if (typeof App !== 'undefined' && App.state && App.state.accessLogs) App.state.accessLogs.unshift(rec);
    } catch (e) { /* 起動直後は App 未定義のことがある */ }
    queue.push(rec);
    flush();
    return rec;
  }

  /** 詳細を開いた瞬間に記録し、閉じたときに滞在秒数を追記記録する */
  function openDetail(req, typeName) {
    log(CFG.ACCESS.ACTIONS.VIEW_DETAIL, {
      targetType: '申請', targetId: req.ID, targetNo: req.Request_No,
      targetSubject: req.Subject, typeCode: req.Type_Code,
      ownerDept: req.Applicant_Dept_name || req.Applicant_Dept,
      detail: (typeName || '') + ' / ' + (req.Status || '')
    });
    viewStart[req.ID] = Date.now();
  }
  function closeDetail(req) {
    var t = viewStart[req.ID]; if (!t) return;
    var sec = Math.round((Date.now() - t) / 1000);
    delete viewStart[req.ID];
    if (sec >= 3) {
      log(CFG.ACCESS.ACTIONS.VIEW_DETAIL, {
        targetType: '申請', targetId: req.ID, targetNo: req.Request_No,
        targetSubject: req.Subject, typeCode: req.Type_Code,
        ownerDept: req.Applicant_Dept_name || req.Applicant_Dept,
        durationSec: sec, detail: '閲覧終了（滞在' + sec + '秒）'
      });
    }
  }
  function denied(what, why) {
    log(CFG.ACCESS.ACTIONS.DENIED, { targetType: what, detail: why });
  }

  /** キュー送出。失敗したものはキューに戻して次回再送 */
  var sending = false;
  function flush() {
    if (sending || !queue.length) return;
    sending = true;
    var batch = queue.splice(0, queue.length);
    var jobs = batch.map(function (r) {
      return DB.add('AccessLogs', r).catch(function (e) { queue.push(r); throw e; });
    });
    Promise.all(jobs).then(function () { sending = false; })
      .catch(function () { sending = false; /* 次回操作時に再送 */ });
  }

  /** 異常検知：閲覧監査画面でフラグを立てる */
  function anomalies(logs) {
    var A = CFG.ACCESS.ANOMALY, byActorHour = {}, byActorDayExport = {}, flagged = [];
    logs.forEach(function (l) {
      var d = new Date(l.Log_Time); if (isNaN(d)) return;
      var reasons = [];
      var h = d.getHours();
      if (h >= A.NIGHT_FROM || h < A.NIGHT_TO) reasons.push('深夜アクセス');
      if (A.CROSS_DEPT && l.Cross_Dept && (l.Sensitivity === 'S' || l.Sensitivity === 'A')) reasons.push('他部署の機微申請を閲覧');
      var hk = l.Actor + '|' + d.toISOString().slice(0, 13);
      if (l.Action === CFG.ACCESS.ACTIONS.VIEW_DETAIL) { byActorHour[hk] = (byActorHour[hk] || 0) + 1; }
      var dk = l.Actor + '|' + d.toISOString().slice(0, 10);
      if (l.Action === CFG.ACCESS.ACTIONS.EXPORT_CSV) { byActorDayExport[dk] = (byActorDayExport[dk] || 0) + 1; }
      l._hourKey = hk; l._dayKey = dk; l._reasons = reasons;
    });
    logs.forEach(function (l) {
      if (byActorHour[l._hourKey] > A.BULK_VIEW_PER_HOUR) l._reasons.push('短時間の大量閲覧');
      if (byActorDayExport[l._dayKey] > A.EXPORT_PER_DAY) l._reasons.push('CSV出力の多発');
      if (l.Action === CFG.ACCESS.ACTIONS.DENIED) l._reasons.push('アクセス拒否');
      if (l._reasons.length) flagged.push(l);
    });
    return flagged;
  }

  return { log: log, openDetail: openDetail, closeDetail: closeDetail, denied: denied, flush: flush, anomalies: anomalies, sessionId: function () { return sessionId; } };
})();

/* =========================================================================
 * Perm — 権限判定（widget 側の表示制御）
 *  ※ Creator 側のロール／レコードレベル条件と必ず二重にかけること。
 * ========================================================================= */
var Perm = (function () {
  function roles(me) { return (me && me.Roles) || ['申請者']; }
  function best(me, key) {
    var v = null;
    roles(me).forEach(function (r) {
      var p = CFG.PERMISSIONS[r]; if (!p) return;
      if (key === 'canExport') v = v || p.canExport;
      else if (key === 'canViewLog') v = (p.canViewLog === 'all') ? 'all' : (v || p.canViewLog);
      else if (key === 'scope') {
        var order = { own: 0, assigned: 1, finance: 2, hr: 2, all: 3 };
        if (v == null || order[p.scope] > order[v]) v = p.scope;
      }
    });
    return v;
  }
  /** 申請レコードを閲覧してよいか */
  function canViewRequest(me, req, approvals) {
    if (!me) return false;
    var sc = best(me, 'scope');
    if (sc === 'all') return true;
    if (String(req.Applicant) === String(me.ID)) return true;
    var mine = (approvals || []).some(function (a) {
      return String(a.Request) === String(req.ID) &&
        (String(a.Approver) === String(me.ID) || String(a.Acted_By) === String(me.ID));
    });
    if (mine) return true;
    if (sc === 'finance' && CFG.SCOPE_TYPES.finance.indexOf(req.Type_Code) >= 0) return true;
    if (sc === 'hr' && CFG.SCOPE_TYPES.hr.indexOf(req.Type_Code) >= 0) return true;
    /* 同一部署の上位役職者は部下の申請を閲覧可（機微度Sを除く） */
    if (roles(me).indexOf('承認者') >= 0 && req.Applicant_Dept_name === me.Department_name) {
      if ((CFG.ACCESS.SENSITIVITY[req.Type_Code] || 'C') !== 'S') return true;
    }
    return false;
  }
  function filterRequests(me, reqs, approvals) {
    return reqs.filter(function (r) { return canViewRequest(me, r, approvals); });
  }
  function canExport(me) { return !!best(me, 'canExport'); }
  function canViewAllLogs(me) { return best(me, 'canViewLog') === 'all'; }
  function isAdmin(me) { return roles(me).indexOf('管理者') >= 0; }
  function isFinance(me) { return roles(me).indexOf('経理') >= 0; }
  function isHR(me) { return roles(me).indexOf('人事') >= 0; }
  return { canViewRequest: canViewRequest, filterRequests: filterRequests, canExport: canExport, canViewAllLogs: canViewAllLogs, isAdmin: isAdmin, isFinance: isFinance, isHR: isHR, scope: function (me) { return best(me, 'scope'); } };
})();
