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
  var PENDING_KEY = 'pending_access_logs';
  var retryTimer = null;

  /* 送信できなかった証跡をブラウザに退避する。
     タブを閉じても次回起動時に送り直せるようにするため。 */
  function savePending() {
    try { DB.lsSet(PENDING_KEY, queue.slice(0, 500)); } catch (e) { }
  }
  function loadPending() {
    var saved = DB.lsGet(PENDING_KEY, []);
    if (saved && saved.length) {
      queue = saved.concat(queue);
      console.info('[社内申請システム] 未送信の閲覧証跡 ' + saved.length + ' 件を再送します');
    }
  }
  function pendingCount() { return queue.length; }

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
      /* どちらかの部署が不明なら「他部署」に倒す。検知漏れより過検知を選ぶ。 */
      Cross_Dept: (!opt.ownerDept || !me.Department_name) ? !!opt.targetId : (opt.ownerDept !== me.Department_name),
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
    savePending();
    updateBadge();
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
      /* 開始と同じ種別で記録すると閲覧回数が二重に数えられるため、終了は別種別にする */
      log(CFG.ACCESS.ACTIONS.VIEW_END, {
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
    var failed = [];
    var jobs = batch.map(function (r) {
      return DB.add('AccessLogs', r).catch(function (e) { failed.push(r); });
    });
    Promise.all(jobs).then(function () {
      sending = false;
      if (failed.length) {
        queue = failed.concat(queue);
        savePending();
        /* 操作が止まっても再送を続ける（最大30秒間隔） */
        if (!retryTimer) {
          retryTimer = setTimeout(function () { retryTimer = null; flush(); }, 30000);
        }
      } else {
        DB.lsSet(PENDING_KEY, []);
      }
      updateBadge();
    });
  }
  function updateBadge() {
    var el = (typeof document !== 'undefined') && document.getElementById('pendingLogs');
    if (!el) return;
    if (queue.length) {
      el.hidden = false;
      el.textContent = '証跡 未送信 ' + queue.length + '件';
    } else { el.hidden = true; }
  }

  /** 記録の成功を待ってから次に進みたい場面で使う（機微度S/Aの閲覧・出力） */
  function logAndWait(action, opt) {
    var rec = log(action, opt);
    return new Promise(function (resolve) {
      var tries = 0;
      (function check() {
        if (queue.indexOf(rec) < 0) return resolve(true);
        if (++tries > 20) return resolve(false);
        setTimeout(check, 150);
      })();
    });
  }

  /** 異常検知：閲覧監査画面でフラグを立てる */
  function anomalies(logs) {
    var A = CFG.ACCESS.ANOMALY, byActorHour = {}, byActorDayExport = {}, flagged = [];
    logs.forEach(function (l) {
      var d = new Date(l.Log_Time);
      if (isNaN(d)) {
        /* 日時が壊れた記録は、握りつぶさず検知対象にする（監査上むしろ重要） */
        l._reasons = ['日時が不正']; l._hourKey = 'bad'; l._dayKey = 'bad';
        return;
      }
      var reasons = [];
      /* 閲覧者の端末のタイムゾーンに左右されないよう、日本時間で判定する */
      var jst = new Date(d.getTime() + (9 * 60 + d.getTimezoneOffset()) * 60000);
      var h = jst.getHours();
      if (h >= A.NIGHT_FROM || h < A.NIGHT_TO) reasons.push('深夜アクセス');
      if (A.CROSS_DEPT && l.Cross_Dept && (l.Sensitivity === 'S' || l.Sensitivity === 'A')) reasons.push('他部署の機微申請を閲覧');
      var hk = l.Actor + '|' + jst.toISOString().slice(0, 13);
      if (l.Action === CFG.ACCESS.ACTIONS.VIEW_DETAIL) { byActorHour[hk] = (byActorHour[hk] || 0) + 1; }
      var dk = l.Actor + '|' + jst.toISOString().slice(0, 10);
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

  /* 離脱時にも送り切ろうとする */
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', function () { savePending(); flush(); });
    window.addEventListener('visibilitychange', function () { if (document.hidden) { savePending(); flush(); } });
  }

  return {
    log: log, logAndWait: logAndWait, openDetail: openDetail, closeDetail: closeDetail,
    denied: denied, flush: flush, anomalies: anomalies, loadPending: loadPending,
    pendingCount: pendingCount, updateBadge: updateBadge,
    sessionId: function () { return sessionId; }
  };
})();

/* =========================================================================
 * Files — 添付ファイル
 *   Creator 側は text / textarea / number しか使わない方針のため、
 *   ファイルを base64 にして CFG.ATTACH.CHUNK_CHARS 文字ずつに分割し、
 *   Wf_File_Form へ複数レコードとして保存する。
 *   同じ file_key のレコードを chunk_index 順に連結すれば元に戻る。
 *
 *   取得・ダウンロードは必ず Access.log() を通し、証跡に残す。
 * ========================================================================= */
var Files = (function () {

  function readAsBase64(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () {
        var s = String(r.result || '');
        var i = s.indexOf(',');
        resolve(i >= 0 ? s.slice(i + 1) : s);
      };
      r.onerror = function () { reject(new Error('ファイルを読み込めませんでした')); };
      r.readAsDataURL(file);
    });
  }

  /** アップロード前の検証。問題があればメッセージを返す（無ければ null） */
  function validate(file, existingCount) {
    if (!file) return 'ファイルが選択されていません';
    if (file.size > CFG.ATTACH.MAX_BYTES) {
      return 'ファイルが大きすぎます（上限 ' + Math.round(CFG.ATTACH.MAX_BYTES / 1024 / 1024) + 'MB、選択されたファイルは ' +
        (file.size / 1024 / 1024).toFixed(1) + 'MB）';
    }
    if (CFG.ATTACH.ACCEPT.indexOf(file.type) < 0) {
      return '対応していない形式です（' + CFG.ATTACH.ACCEPT_LABEL + ' のみ）';
    }
    if (existingCount >= CFG.ATTACH.MAX_FILES) {
      return '添付は1申請あたり ' + CFG.ATTACH.MAX_FILES + ' 点までです';
    }
    return null;
  }

  /**
   * ファイルを分割して保存する
   * @param {File} file
   * @param {object} meta {tradeDate, tradeAmount, tradePartner}
   * @param {object} req  {ID, Request_No}
   * @returns {Promise<object>} 保存したファイルの見出し情報
   */
  function upload(file, meta, req) {
    var me = App.me() || {};
    var key = 'f_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    return readAsBase64(file).then(function (b64) {
      var size = CFG.ATTACH.CHUNK_CHARS;
      var total = Math.max(1, Math.ceil(b64.length / size));
      var head = {
        File_Key: key, Request: (req && req.ID) || '', Request_No: (req && req.Request_No) || '',
        File_Name: file.name, Mime_Type: file.type, File_Size: file.size,
        Trade_Date: (meta && meta.tradeDate) || '', Trade_Amount: (meta && meta.tradeAmount) || '',
        Trade_Partner: (meta && meta.tradePartner) || '',
        Chunk_Total: total, Uploaded_By: me.ID || '', Uploaded_By_Name: me.Employee_Name || '',
        Uploaded_At: DB.nowISO(), Deleted: false
      };
      /* 分割レコードを順番に書き込む（並列にすると順序が乱れる環境があるため直列） */
      var i = 0;
      function step() {
        if (i >= total) return Promise.resolve();
        var rec = {};
        Object.keys(head).forEach(function (k) { rec[k] = head[k]; });
        rec.Chunk_Index = i;
        rec.Data_Base64 = b64.slice(i * size, (i + 1) * size);
        i++;
        return DB.add('Files', rec).then(function (saved) {
          if (App.state.files) App.state.files.push(headerOf(saved));
          return step();
        });
      }
      return step().then(function () { return head; });
    });
  }

  /** レコードから本体を除いた見出しを作る（メモリを食わせない） */
  function headerOf(r) {
    var o = {};
    Object.keys(r).forEach(function (k) { if (k !== 'Data_Base64') o[k] = r[k]; });
    return o;
  }

  /** 申請に紐づく添付の一覧（ファイル単位にまとめる） */
  function listFor(requestId) {
    var rows = (App.state.files || []).filter(function (f) {
      return String(f.Request) === String(requestId) && !f.Deleted;
    });
    var by = {};
    rows.forEach(function (f) {
      if (!by[f.File_Key]) by[f.File_Key] = f;
    });
    return Object.keys(by).map(function (k) { return by[k]; })
      .sort(function (a, b) { return new Date(a.Uploaded_At) - new Date(b.Uploaded_At); });
  }

  /** 本体を取り寄せて連結する */
  function fetchBody(fileKey) {
    var criteria = 'file_key == "' + String(fileKey).replace(/"/g, '') + '"';
    return DB.list('Files', criteria).then(function (rows) {
      var mine = rows.filter(function (r) { return String(r.File_Key) === String(fileKey); });
      if (!mine.length) throw new Error('ファイルの本体が見つかりません');
      mine.sort(function (a, b) { return Number(a.Chunk_Index) - Number(b.Chunk_Index); });
      var expected = Number(mine[0].Chunk_Total) || mine.length;
      if (mine.length !== expected) {
        throw new Error('ファイルが不完全です（' + mine.length + '/' + expected + ' 分割）');
      }
      return { head: headerOf(mine[0]), b64: mine.map(function (r) { return r.Data_Base64 || ''; }).join('') };
    });
  }

  /** ダウンロード（証跡に残す） */
  function download(fileKey, req) {
    return fetchBody(fileKey).then(function (res) {
      var bin = atob(res.b64);
      var buf = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      var blob = new Blob([buf], { type: res.head.Mime_Type || 'application/octet-stream' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = res.head.File_Name || 'attachment';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      Access.log(CFG.ACCESS.ACTIONS.DOWNLOAD, {
        targetType: '添付ファイル', targetId: (req && req.ID) || res.head.Request,
        targetNo: res.head.Request_No, targetSubject: (req && req.Subject) || '',
        typeCode: (req && req.Type_Code) || '',
        ownerDept: (req && req.Applicant_Dept_name) || '',
        detail: res.head.File_Name + '（' + Math.round((res.head.File_Size || 0) / 1024) + 'KB）を取得'
      });
      return res.head;
    });
  }

  /** 削除（実体は消さず deleted を立てる＝証跡を残す） */
  function remove(fileKey) {
    var rows = (App.state.files || []).filter(function (f) { return String(f.File_Key) === String(fileKey); });
    var jobs = rows.map(function (f) {
      f.Deleted = true;
      return DB.update('Files', f.ID, { Deleted: true });
    });
    return Promise.all(jobs);
  }

  /** 電子帳簿保存法の対象区分か */
  function needsTradeInfo(typeCode) {
    return CFG.ATTACH.DENSHICHO_TYPES.indexOf(typeCode) >= 0;
  }

  return {
    validate: validate, upload: upload, listFor: listFor, fetchBody: fetchBody,
    download: download, remove: remove, headerOf: headerOf, needsTradeInfo: needsTradeInfo
  };
})();

/* =========================================================================
 * Perm — 権限判定（widget 側の表示制御）
 *  ※ Creator 側のロール／レコードレベル条件と必ず二重にかけること。
 * ========================================================================= */
var Perm = (function () {
  function roles(me) { return (me && me.Roles) || ['申請者']; }

  /** 役職の序列（小さいほど上位）。未設定は最下位として扱う。 */
  function rank(title) {
    var i = CFG.TITLES.indexOf(title);
    return i < 0 ? 999 : i;
  }

  /**
   * そのユーザーが持つ「閲覧できる範囲」を集合で返す。
   *  以前は単一の値にまとめていたため、経理と人事を兼務すると
   *  ロールの記述順で片方の範囲を失っていた（同値の比較で先勝ちになるため）。
   */
  function scopes(me) {
    var set = { own: true };
    roles(me).forEach(function (r) {
      var p = CFG.PERMISSIONS[r]; if (!p) return;
      set[p.scope] = true;
    });
    if (set.all) return { all: true, own: true, assigned: true, finance: true, hr: true };
    return set;
  }
  function scope(me) {
    var s = scopes(me);
    return s.all ? 'all' : (s.finance ? 'finance' : (s.hr ? 'hr' : (s.assigned ? 'assigned' : 'own')));
  }

  /** 申請の機微度（テンプレート定義を優先し、無ければ最も厳しい側に倒す） */
  function sensitivityOf(req) {
    var t = (typeof App !== 'undefined' && App.templateByCode) ? App.templateByCode(req.Type_Code) : null;
    if (t && t.sensitivity) return t.sensitivity;
    var s = CFG.ACCESS.SENSITIVITY[req.Type_Code];
    return s || 'S';   // 未知の区分は最も厳しく扱う（既定を緩めると設定漏れが漏洩になる）
  }

  /** 自分がこの申請の経路上にいるか（承認者・処理者・合議メンバー・代理人） */
  function onRoute(me, req, approvals) {
    var mine = (approvals || []).some(function (a) {
      return String(a.Request) === String(req.ID) &&
        (String(a.Approver) === String(me.ID) || String(a.Acted_By) === String(me.ID));
    });
    if (mine) return true;
    /* 合議メンバーと代理人は Approvals に行が無いことがあるので経路本体も見る */
    var route = [];
    try { route = JSON.parse(req.Route_JSON || '[]'); } catch (e) { route = []; }
    return route.some(function (s) {
      if (String(s.approverId) === String(me.ID)) return true;
      if (s.delegateId && String(s.delegateId) === String(me.ID)) return true;
      return (s.members || []).some(function (m) { return String(m.id) === String(me.ID); });
    });
  }

  /** 申請レコードを閲覧してよいか */
  function canViewRequest(me, req, approvals) {
    if (!me || !req) return false;
    var sc = scopes(me);
    if (sc.all) return true;
    if (String(req.Applicant) === String(me.ID)) return true;
    if (onRoute(me, req, approvals)) return true;
    if (sc.finance && CFG.SCOPE_TYPES.finance.indexOf(req.Type_Code) >= 0) return true;
    if (sc.hr && CFG.SCOPE_TYPES.hr.indexOf(req.Type_Code) >= 0) return true;

    /* 同一部署の「上位役職者」は部下の申請を閲覧できる。
       以前は役職を見ておらず、承認者ロールさえ持てば同部署の全員分が読めていた。 */
    if (roles(me).indexOf('承認者') >= 0) {
      var myDept = me.Department_name || '';
      var theirDept = req.Applicant_Dept_name || req.Applicant_Dept || '';
      if (!myDept || !theirDept) return false;          // 部署不明どうしを一致させない
      if (myDept !== theirDept) return false;
      if (sensitivityOf(req) === 'S') return false;     // 機微度Sは部署ルールの対象外
      var applicant = (typeof App !== 'undefined' && App.employeeById) ? App.employeeById(req.Applicant) : null;
      if (!applicant) return false;
      if (String(applicant.ID) === String(me.ID)) return true;
      return rank(me.Title) < rank(applicant.Title);    // 自分の役職が申請者より上位のときだけ
    }
    return false;
  }
  function filterRequests(me, reqs, approvals) {
    return (reqs || []).filter(function (r) { return canViewRequest(me, r, approvals); });
  }
  function canExport(me) {
    return roles(me).some(function (r) { return (CFG.PERMISSIONS[r] || {}).canExport; });
  }
  function canViewAllLogs(me) {
    return roles(me).some(function (r) { return (CFG.PERMISSIONS[r] || {}).canViewLog === 'all'; });
  }
  function isAdmin(me) { return roles(me).indexOf('管理者') >= 0; }
  function isFinance(me) { return roles(me).indexOf('経理') >= 0; }
  function isHR(me) { return roles(me).indexOf('人事') >= 0; }

  return { canViewRequest: canViewRequest, filterRequests: filterRequests, canExport: canExport, canViewAllLogs: canViewAllLogs, isAdmin: isAdmin, isFinance: isFinance, isHR: isHR, scope: scope, scopes: scopes, rank: rank, sensitivityOf: sensitivityOf, onRoute: onRoute };
})();
