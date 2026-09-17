/* =========================================================================
 * app.js — 起動・ルーティング・状態管理
 * ========================================================================= */
var App = (function () {
  var state = {
    employees: [], departments: [], vendors: [], accounts: [], requestTypes: [],
    requests: [], approvals: [], accessLogs: [], notifications: []
  };
  var currentUserId = null;
  var templates = [];
  var route = { name: 'dashboard', arg: '', params: {} };

  /* ---------- 参照ヘルパ ---------- */
  function me() { return employeeById(currentUserId) || state.employees[0] || { ID: '', Employee_Name: '未設定', Roles: ['申請者'] }; }
  function employeeById(id) { for (var i = 0; i < state.employees.length; i++) if (String(state.employees[i].ID) === String(id)) return state.employees[i]; return null; }
  function requestById(id) { for (var i = 0; i < state.requests.length; i++) if (String(state.requests[i].ID) === String(id)) return state.requests[i]; return null; }
  function vendorById(id) { for (var i = 0; i < state.vendors.length; i++) if (String(state.vendors[i].ID) === String(id)) return state.vendors[i]; return null; }
  function accountById(id) { for (var i = 0; i < state.accounts.length; i++) if (String(state.accounts[i].ID) === String(id)) return state.accounts[i]; return null; }
  function templateByCode(code) { for (var i = 0; i < templates.length; i++) if (templates[i].code === code) return templates[i]; return null; }
  function nextRequestNo() {
    var y = new Date().getFullYear(), max = 1000;
    state.requests.forEach(function (r) {
      var m = String(r.Request_No || '').match(/REQ-\d{4}-(\d+)/);
      if (m) max = Math.max(max, Number(m[1]));
    });
    return 'REQ-' + y + '-' + (max + 1);
  }

  /* ---------- 監査ログ（操作証跡：閲覧証跡とは別に「変更」を残す） ---------- */
  function audit(actionType, targetType, targetId, detail) {
    DB.add('AuditLogs', {
      Log_Time: DB.nowISO(), User: me().ID, User_name: me().Employee_Name,
      Action_Type: actionType, Target_Type: targetType, Target_ID: targetId || '',
      Detail: String(detail || '').slice(0, 480), Session_ID: Access.sessionId()
    }).catch(function () { /* 監査ログの失敗で業務を止めない（次回再送は Access 側で実施） */ });
  }

  /* ---------- テンプレート読み込み（Creator の Request_Types 優先） ---------- */
  function loadTemplates() {
    if (state.requestTypes && state.requestTypes.length) {
      templates = state.requestTypes.filter(function (t) { return t.Is_Active !== false; })
        .sort(function (a, b) { return (a.Sort_Order || 0) - (b.Sort_Order || 0); })
        .map(function (t) {
          var fields = [], route2 = { steps: [] };
          try { fields = (JSON.parse(t.Field_Schema || '{}').fields) || []; } catch (e) { console.warn('Field_Schema の解析に失敗', t.Type_Code); }
          try { route2 = JSON.parse(t.Route_Rule || '{"steps":[]}'); } catch (e) { console.warn('Route_Rule の解析に失敗', t.Type_Code); }
          return { code: t.Type_Code, name: t.Type_Name, icon: t.Icon || '📄', category: t.Category || 'その他', desc: t.Description || '', fields: fields, route: route2 };
        });
    }
    if (!templates.length) templates = TEMPLATES;   // フォールバック（定義未投入時）
  }

  /* ---------- データ取得 ---------- */
  function loadAll() {
    var keys = ['Employees', 'Departments', 'Vendors', 'Accounts', 'RequestTypes', 'Requests', 'Approvals', 'AccessLogs', 'Notifications'];
    return Promise.all(keys.map(function (k) {
      return DB.list(k).catch(function (e) { console.warn(k + ' の取得に失敗', e); return []; });
    })).then(function (res) {
      state.employees = res[0]; state.departments = res[1]; state.vendors = res[2]; state.accounts = res[3];
      state.requestTypes = res[4]; state.requests = res[5]; state.approvals = res[6];
      state.accessLogs = res[7]; state.notifications = res[8];
      /* Creator 側の Roles は複数選択（カンマ区切り文字列）で返ることがある */
      state.employees.forEach(function (e) {
        if (typeof e.Roles === 'string') e.Roles = e.Roles.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        if (!e.Roles || !e.Roles.length) e.Roles = ['申請者'];
        if (!e.Department_name) e.Department_name = e.Department || '';
      });
      loadTemplates();
    });
  }

  /* ---------- ログインユーザーの決定 ---------- */
  function resolveLoginUser() {
    var p = DB.initParams() || {};
    var login = (p.loginUser || p.loginuser || '').toLowerCase();
    if (login) {
      var hit = state.employees.filter(function (e) { return String(e.Email || '').toLowerCase() === login; })[0];
      if (hit) { currentUserId = hit.ID; return true; }
    }
    var saved = DB.lsGet('current_user', null);
    if (saved && employeeById(saved)) { currentUserId = saved; return false; }
    currentUserId = (state.employees[0] || {}).ID;
    return false;
  }

  /* ---------- ナビゲーション ---------- */
  var NAV = [
    { group: 'マイページ' },
    { key: 'dashboard', label: 'ダッシュボード', ico: '🏠' },
    { key: 'new', label: '申請する', ico: '✏️' },
    { key: 'mine', label: '自分の申請', ico: '📂' },
    { key: 'inbox', label: '承認する', ico: '🖊', badge: 'pending' },
    { group: '全社' },
    { key: 'search', label: 'すべての申請', ico: '🔍' },
    { key: 'access', label: '閲覧証跡', ico: '👁' },
    { group: '管理' },
    { key: 'finance', label: '経理処理', ico: '💴', roles: ['経理', '管理者'] },
    { key: 'admin', label: '設定・マスタ', ico: '⚙️', roles: ['管理者'] }
  ];
  function renderNav() {
    var pending = 0;
    state.requests.forEach(function (r) {
      if (r.Status !== CFG.STATUS.ACTIVE) return;
      var rt; try { rt = JSON.parse(r.Route_JSON || '[]'); } catch (e) { rt = []; }
      var cur = WF.currentStep(rt);
      var st = rt.filter(function (s) { return s.step_no === cur; })[0];
      if (st && WF.canAct(st, me().ID) && !st.action) pending++;
    });
    var roles = me().Roles || [];
    var html = NAV.filter(function (n) { return !n.roles || n.roles.some(function (r) { return roles.indexOf(r) >= 0; }); })
      .map(function (n) {
        if (n.group) return '<div class="nav-group">' + UI.esc(n.group) + '</div>';
        return '<button class="nav-item' + (route.name === n.key ? ' active' : '') + '" data-nav="' + n.key + '">' +
          '<span class="ico">' + n.ico + '</span><span>' + UI.esc(n.label) + '</span>' +
          (n.badge === 'pending' && pending ? '<span class="count">' + pending + '</span>' : '') + '</button>';
      }).join('');
    var nav = document.getElementById('nav');
    nav.innerHTML = html;
    nav.querySelectorAll('[data-nav]').forEach(function (b) {
      b.addEventListener('click', function () { go(b.dataset.nav); document.getElementById('sidebar').classList.remove('open'); });
    });
    var unread = state.notifications.filter(function (n) { return String(n.To_User) === String(me().ID) && !n.Is_Read; }).length;
    var badge = document.getElementById('bellBadge');
    badge.hidden = !unread; badge.textContent = unread;
  }
  function renderUserSwitch() {
    var sel = document.getElementById('userSwitch');
    sel.innerHTML = state.employees.map(function (e) {
      return '<option value="' + UI.esc(e.ID) + '"' + (String(e.ID) === String(currentUserId) ? ' selected' : '') + '>' +
        UI.esc(e.Employee_Name + '（' + e.Title + '／' + (e.Roles || []).join('・') + '）') + '</option>';
    }).join('');
  }

  /* ---------- ルーティング ---------- */
  function parseHash() {
    var h = (location.hash || '#dashboard').slice(1);
    var qi = h.indexOf('?');
    var params = {};
    if (qi >= 0) {
      h.slice(qi + 1).split('&').forEach(function (kv) { var p = kv.split('='); params[p[0]] = decodeURIComponent(p[1] || ''); });
      h = h.slice(0, qi);
    }
    var parts = h.split('/');
    return { name: parts[0] || 'dashboard', arg: parts[1] || '', params: params };
  }
  function go(path) { location.hash = '#' + path; }
  function param(k) { return route.params[k] || ''; }
  function render() {
    route = parseHash();
    var el = document.getElementById('view');
    el.innerHTML = '';
    try {
      switch (route.name) {
        case 'new': Views.newRequest(el); break;
        case 'form': Views.form(el, route.arg, param('edit')); break;
        case 'mine': Views.mine(el); break;
        case 'inbox': Views.inbox(el); break;
        case 'search': Views.search(el); break;
        case 'finance': Views.finance(el); break;
        case 'access': Views.accessAudit(el); break;
        case 'admin': Views.admin(el); break;
        default: Views.dashboard(el);
      }
    } catch (e) {
      console.error(e);
      el.innerHTML = UI.empty('⚠️', '画面の表示中にエラーが発生しました', String(e && e.message ? e.message : e));
    }
    renderNav();
    el.focus();
  }
  function refresh() { render(); }

  /* ---------- 通知 ---------- */
  function openNotifications() {
    var list = state.notifications.filter(function (n) { return String(n.To_User) === String(me().ID); })
      .sort(function (a, b) { return new Date(b.Created_Time) - new Date(a.Created_Time); }).slice(0, 30);
    UI.modal({
      title: '通知', okText: 'すべて既読にする',
      bodyHtml: list.length ? '<div class="table-wrap"><table class="tbl"><tbody>' + list.map(function (n) {
        return '<tr data-n="' + UI.esc(n.Request) + '"><td>' + (n.Is_Read ? '' : '<span class="badge b-progress">未読</span> ') + UI.esc(n.Message) +
          '<div class="page-sub">' + UI.esc(UI.relTime(n.Created_Time)) + '</div></td></tr>';
      }).join('') + '</tbody></table></div>' : UI.empty('🔔', '通知はありません', ''),
      onOk: function () {
        var jobs = list.filter(function (n) { return !n.Is_Read; }).map(function (n) {
          n.Is_Read = true; return DB.update('Notifications', n.ID, { Is_Read: true });
        });
        Promise.all(jobs).then(function () { renderNav(); });
      }
    });
    document.querySelectorAll('[data-n]').forEach(function (tr) {
      tr.addEventListener('click', function () { UI.closeModal(); Views.openDetail(tr.dataset.n); });
    });
  }

  /* ---------- テーマ ---------- */
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    DB.lsSet('theme', t);
  }
  function initTheme() {
    var saved = DB.lsGet('theme', null);
    if (!saved) saved = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    applyTheme(saved);
  }

  /* ---------- キーボードショートカット ---------- */
  function initKeys() {
    document.addEventListener('keydown', function (e) {
      if (/input|textarea|select/i.test((e.target.tagName || ''))) {
        if (e.key === 'Escape') e.target.blur();
        return;
      }
      if (e.key === '/') { e.preventDefault(); document.getElementById('globalSearch').focus(); }
      else if (e.key === 'n') { go('new'); }
      else if (e.key === 'a') { go('inbox'); }
      else if (e.key === 'd') { go('dashboard'); }
      else if (e.key === 'l') { go('access'); }
      else if (e.key === '?') { showHelp(); }
    });
  }
  function showHelp() {
    UI.modal({
      title: 'キーボードショートカット',
      bodyHtml: '<dl class="dl">' +
        '<dt>/</dt><dd>検索にフォーカス</dd><dt>n</dt><dd>新規申請</dd><dt>a</dt><dd>承認トレイ</dd>' +
        '<dt>d</dt><dd>ダッシュボード</dd><dt>l</dt><dd>閲覧証跡</dd><dt>Esc</dt><dd>閉じる</dd><dt>?</dt><dd>このヘルプ</dd></dl>'
    });
  }

  /* ---------- 起動 ---------- */
  function boot() {
    initTheme();
    document.getElementById('view').innerHTML = UI.skeleton(7);
    DB.init().then(function (res) {
      var chip = document.getElementById('modeChip');
      chip.textContent = res.connected ? 'Zoho Creator 接続済' : 'デモモード（未接続）';
      chip.style.color = res.connected ? 'var(--success)' : 'var(--warning)';
      return loadAll();
    }).then(function () {
      var fromSSO = resolveLoginUser();
      renderUserSwitch();
      Access.log(CFG.ACCESS.ACTIONS.LOGIN, { targetType: 'アプリ', detail: (DB.isConnected() ? 'Creator接続' : 'デモ') + (fromSSO ? '／SSOユーザー自動判定' : '') });
      render();
    }).catch(function (e) {
      console.error(e);
      document.getElementById('view').innerHTML = UI.empty('⚠️', '起動に失敗しました', String(e && e.message ? e.message : e));
    });
  }

  function initChrome() {
    document.getElementById('btnTheme').addEventListener('click', function () {
      applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });
    document.getElementById('btnBell').addEventListener('click', openNotifications);
    document.getElementById('btnMenu').addEventListener('click', function () {
      document.getElementById('sidebar').classList.toggle('open');
    });
    document.getElementById('userSwitch').addEventListener('change', function (e) {
      var prev = me().Employee_Name;
      currentUserId = e.target.value;
      DB.lsSet('current_user', currentUserId);
      Access.log(CFG.ACCESS.ACTIONS.SWITCH_USER, { targetType: 'アプリ', detail: prev + ' → ' + me().Employee_Name });
      UI.toast(me().Employee_Name + ' として表示しています', 'success');
      renderNav(); render();
    });
    var gs = document.getElementById('globalSearch');
    gs.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var q = gs.value.trim();
        if (!q) return;
        location.hash = '#search';
        setTimeout(function () {
          var f = document.getElementById('s_q');
          if (f) { f.value = q; var b = document.querySelector('[data-act="search"]'); if (b) b.click(); }
        }, 60);
      }
    });
    window.addEventListener('hashchange', render);
    initKeys();
  }

  return {
    boot: boot, initChrome: initChrome, go: go, param: param, refresh: refresh, render: render,
    state: state, me: me, audit: audit,
    employeeById: employeeById, requestById: requestById, vendorById: vendorById, accountById: accountById,
    templates: function () { return templates; }, templateByCode: templateByCode, nextRequestNo: nextRequestNo,
    showHelp: showHelp
  };
})();

document.addEventListener('DOMContentLoaded', function () {
  App.initChrome();
  App.boot();
});
