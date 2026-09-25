/* =========================================================================
 * app.js — 起動と画面（営業管理）
 *
 *   ダッシュボード / 案件 / 顧客 / 活動履歴 / 目標・担当者（マネージャーのみ）
 *
 * 本人の判定は Creator が教えるログインID（getInitParams().loginUser）で行い、
 * 担当者マスタに無ければ業務データを読まずに止める。
 * ただし、ウィジェット側の制御は「画面の親切」であって守りではない。
 * 守りは Creator 側のロールとレコードレベル権限で行う（README.md 参照）。
 * ========================================================================= */
var App = (function () {
  var esc = UI.esc;
  var TABS = [
    { key: 'dashboard',  label: 'ダッシュボード' },
    { key: 'deals',      label: '案件' },
    { key: 'customers',  label: '顧客' },
    { key: 'activities', label: '活動履歴' },
    { key: 'targets',    label: '目標',   manager: true },
    { key: 'staff',      label: '担当者', manager: true }
  ];
  var LIST_KEY = { Staff: 'staff', Customers: 'customers', Deals: 'deals', Activities: 'activities', Targets: 'targets' };
  var STAGE_IDX = {};
  CFG.STAGES.forEach(function (s, i) { STAGE_IDX[s.key] = i; });

  var state = {
    login: '', me: null, isManager: false,
    staff: [], customers: [], deals: [], activities: [], targets: [],
    warnings: [], tab: 'dashboard', targetMonth: Dates.month(),
    f: { q: '', owner: '', stage: 'open', custQ: '', custAll: false, actType: '', actQ: '' }
  };
  var logWarned = false;

  /* ---------- 小道具 ---------- */
  function $(id) { return document.getElementById(id); }
  function setView(html) { $('view').innerHTML = html; }
  function loading() { return '<div class="card muted">読み込み中…</div>'; }
  function assign(to, from) { Object.keys(from).forEach(function (k) { to[k] = from[k]; }); return to; }
  function same(a, b) { return String(a == null ? '' : a) === String(b == null ? '' : b); }
  function byId(list, id) { for (var i = 0; i < list.length; i++) if (same(list[i].ID, id)) return list[i]; return null; }
  function sum(list, f) { return list.reduce(function (a, x) { return a + f(x); }, 0); }
  function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function pct(r) { return r == null ? '—' : Math.round(r * 100) + '%'; }
  function day(v) { return Dates.isDate(v) ? Dates.md(v) : String(v == null ? '' : v); }

  function stageInfo(d) {
    var k = String(d.Stage == null ? '' : d.Stage).trim() || CFG.STAGES[0].key;
    var i = STAGE_IDX.hasOwnProperty(k) ? STAGE_IDX[k] : -1;
    var def = i >= 0 ? CFG.STAGES[i] : { key: k, prob: null, open: true };
    return { key: k, idx: i, open: !!def.open, won: !!def.won, prob: def.prob };
  }
  function isOpen(d) { return stageInfo(d).open; }
  function isWon(d) { return stageInfo(d).won; }
  function amt(x) { return Num.num(x.Amount); }
  /* 確度が空なら、ステージの標準確度を使う */
  function prob(d) {
    var p = Num.parse(d.Prob);
    if (isNaN(p)) p = stageInfo(d).prob || 0;
    return Math.max(0, Math.min(100, p));
  }
  function weighted(d) { return amt(d) * prob(d) / 100; }
  function badge(s) { return '<span class="badge st-' + (s.idx >= 0 ? s.idx : 'x') + '">' + esc(s.key) + '</span>'; }
  function wonIn(mon) { return function (d) { return isWon(d) && String(d.Closed_On).slice(0, 7) === mon; }; }
  function ownedBy(id) { return function (d) { return same(d.Owner_ID, id); }; }

  function isManagerRole(role) { return /^(manager|admin|マネージャー|管理者)$/i.test(String(role == null ? '' : role).trim()); }
  function roleLabel(role) { return isManagerRole(role) ? CFG.ROLES.manager : CFG.ROLES.member; }
  function activeStaff() { return state.staff.filter(function (s) { return s.Is_Active; }); }
  function staffChoices(selected) {
    var list = state.staff.filter(function (s) { return s.Is_Active || same(s.ID, selected); });
    return [{ value: '', label: '（未設定）' }].concat(list.map(function (s) {
      return { value: s.ID, label: s.Name + (s.Is_Active ? '' : '（在籍なし）') };
    }));
  }
  function findByEmail(login) {
    var l = String(login).trim().toLowerCase();
    var hits = state.staff.filter(function (s) { return String(s.Email).trim().toLowerCase() === l; });
    return hits.filter(function (s) { return s.Is_Active; })[0] || hits[0] || null;
  }

  /* ---------- 起動 ---------- */
  function boot() {
    bindEvents();
    setView(loading());
    DB.init(Seed.build).then(function (res) {
      $('mode').textContent = res.connected ? 'Creator 接続済' : 'デモモード（このブラウザ内だけに保存）';
      $('mode').className = 'chip ' + (res.connected ? 'ok' : 'demo');
      $('demo-tools').hidden = res.connected;
      $('who').hidden = !res.connected;   /* デモでは切替メニューに同じ表示が出る */
      start();
    }, function (e) {
      $('mode').textContent = '未接続';
      stop('Zoho Creator に接続できませんでした', [DB.errText(e),
        'ページを再読み込みしてください。続く場合は、下の診断情報を添えて管理者に連絡してください。'],
        'SDK の状態：' + ((e && e.diag) || DB.sdkShape()));
    });
  }

  /* 本人確認 → 業務データの読み込み → 描画 */
  function start() {
    UI.closeModal();
    state.me = null; state.isManager = false; state.warnings = [];
    state.login = DB.isConnected()
      ? String((DB.initParams() || {}).loginUser || '').trim()
      : String(DB.lsGet('demo_login', '') || Seed.DEFAULT_LOGIN);
    renderWho(); renderTabs();
    if (!state.login) {
      return stop('ログインしている利用者を確認できませんでした', ['Creator にログインした状態で開いてください。'],
        DB.isConnected() ? 'getInitParams の結果：' + (Object.keys(DB.initParams() || {}).join(',') || '（空）') + ' / SDK の状態：' + DB.sdkShape() : '');
    }
    setView(loading());
    DB.list('Staff').then(function (staff) {
      state.staff = staff;
      if (DB.isDemo()) fillDemoSwitcher();
      if (!staff.length) return showBootstrap();
      var me = findByEmail(state.login);
      if (!me) {
        return stop('このアカウントは担当者マスタに登録されていません', [
          'ログイン中のアカウント：' + state.login,
          '管理者に、担当者マスタへの登録（メールアドレス＝ログインID）を依頼してください。',
          '登録が確認できるまで、案件や顧客のデータは読み込んでいません。']);
      }
      if (!me.Is_Active) {
        return stop('このアカウントは「在籍なし」になっています', [
          'ログイン中のアカウント：' + state.login, '利用を再開する場合は、管理者に連絡してください。']);
      }
      state.me = me;
      state.isManager = isManagerRole(me.Role);
      renderWho();
      return loadBusiness().then(function () { linkRefs(); renderTabs(); render(); });
    }, function (e) {
      stop('担当者マスタを読み込めませんでした', [DB.errText(e),
        'Creator の権限設定で、この利用者が「担当者 一覧」レポートを閲覧できるか確認してください。',
        '担当者マスタがまだ空の場合は、Creator の「担当者 一覧」から自分を1件登録してから開き直してください' +
        '（メールアドレスはログインID、権限は manager、在籍は true）。']);
    }).catch(function (e) {
      console.error(e);
      stop('画面の表示中に問題が発生しました', [DB.errText(e)]);
    });
  }

  function loadBusiness() {
    var mgr = state.isManager;
    function soft(label, p) {
      return p.then(function (rows) {
        if (rows.truncated) state.warnings.push(label + 'が ' + CFG.MAX_RECORDS + ' 件の取得上限に達しました。集計が不完全な可能性があります。');
        return rows;
      }, function (e) {
        state.warnings.push(label + 'を読み込めませんでした：' + DB.errText(e));
        return [];
      });
    }
    return Promise.all([
      soft('顧客', DB.list('Customers')),
      soft('案件', mgr ? DB.list('Deals') : listMine('Deals', 'Owner_ID', 'Owner_Name')),
      soft('活動履歴', mgr ? DB.list('Activities') : listMine('Activities', 'Staff_ID', 'Staff_Name')),
      soft('目標', mgr ? DB.list('Targets') : listMine('Targets', 'Staff_ID', 'Staff_Name'))
    ]).then(function (r) {
      state.customers = r[0]; state.deals = r[1]; state.activities = r[2]; state.targets = r[3];
    });
  }

  /* 担当者（member）は、自分の分だけをサーバー側で絞って取得する。
     ID で1回、名前で1回（CSV 取り込み直後で ID が入っていない行を拾うため）。
     criteria は実績のある「項目 == "値"」の形だけを使う */
  function listMine(entity, idKey, nameKey) {
    var map = CFG.FIELD_MAP[entity], me = state.me;
    var qs = [DB.list(entity, map[idKey] + ' == "' + me.ID + '"')];
    var nm = String(me.Name || '');
    if (nm && !/["\\]/.test(nm)) qs.push(DB.list(entity, map[nameKey] + ' == "' + nm + '"'));
    return Promise.all(qs).then(function (lists) {
      var staffIds = {}, seen = {}, out = [];
      state.staff.forEach(function (s) { staffIds[String(s.ID)] = true; });
      lists.forEach(function (rows) {
        rows.forEach(function (r) {
          if (seen[r.ID]) return;
          /* 名前で拾った行のうち、ID が別の担当者を指しているもの（同姓同名など）は除く */
          var id = String(r[idKey] == null ? '' : r[idKey]);
          if (id !== String(me.ID) && staffIds[id]) return;
          seen[r.ID] = true; out.push(r);
        });
      });
      out.truncated = lists.some(function (l) { return l.truncated; });
      return out;
    });
  }

  /* 関係の解決：ID で見つからなければ名前で探す（同名が複数あるときは決めない） */
  function resolve(rows, idKey, nameKey, list) {
    var ids = {}, names = {};
    list.forEach(function (x) {
      ids[String(x.ID)] = x;
      if (x.Name) (names[x.Name] = names[x.Name] || []).push(x);
    });
    rows.forEach(function (r) {
      var hit = ids[String(r[idKey])];
      if (!hit && r[nameKey] && names[r[nameKey]] && names[r[nameKey]].length === 1) {
        hit = names[r[nameKey]][0];
        r[idKey] = hit.ID;
      }
      if (hit) r[nameKey] = hit.Name;
    });
  }
  function linkRefs() {
    resolve(state.customers, 'Owner_ID', 'Owner_Name', state.staff);
    resolve(state.deals, 'Customer_ID', 'Customer_Name', state.customers);
    resolve(state.deals, 'Owner_ID', 'Owner_Name', state.staff);
    resolve(state.activities, 'Customer_ID', 'Customer_Name', state.customers);
    resolve(state.activities, 'Deal_ID', 'Deal_Name', state.deals);
    resolve(state.activities, 'Staff_ID', 'Staff_Name', state.staff);
    resolve(state.targets, 'Staff_ID', 'Staff_Name', state.staff);
  }

  /* ---------- 止める画面・初回登録 ---------- */
  function stop(title, lines, diag) {
    state.me = null; state.isManager = false;
    renderTabs(); renderWho();
    setView('<div class="card narrow stop"><h2>' + esc(title) + '</h2>' +
      lines.map(function (l) { return '<p>' + esc(l) + '</p>'; }).join('') +
      (diag ? '<div class="diag"><div class="muted small">診断情報</div><code>' + esc(diag) + '</code></div>' : '') + '</div>');
  }
  function showBootstrap() {
    setView('<div class="card narrow"><h2>はじめに：管理者の登録</h2>' +
      '<p>担当者マスタにまだ誰も登録されていません。ログイン中のアカウントを、最初のマネージャーとして登録します。</p>' +
      '<p class="muted">ログイン中のアカウント：<strong>' + esc(state.login) + '</strong></p>' +
      '<div class="field"><label for="boot-name">氏名 <span class="req" aria-hidden="true">*</span></label>' +
      '<input id="boot-name" maxlength="255" placeholder="例：山田 太郎"></div>' +
      '<p class="form-error" id="boot-error" role="alert" hidden></p>' +
      '<div class="row"><button type="button" class="btn btn-primary" data-act="bootstrap">マネージャーとして登録</button></div>' +
      '<p class="muted small">Creator の「担当者 一覧」から直接登録したり、CSV で取り込んだりしても構いません。' +
      'その場合はメールアドレスをログインIDと同じにし、権限に manager か member を入れてください。</p></div>');
  }

  /* ---------- ヘッダー・タブ ---------- */
  function renderWho() {
    $('who').textContent = state.me ? state.me.Name + '（' + roleLabel(state.me.Role) + '）' : (state.login || '');
  }
  function visibleTabs() {
    return state.me ? TABS.filter(function (t) { return !t.manager || state.isManager; }) : [];
  }
  function renderTabs() {
    var tabs = visibleTabs();
    if (tabs.length && !tabs.some(function (t) { return t.key === state.tab; })) state.tab = 'dashboard';
    $('tabs').innerHTML = tabs.map(function (t) {
      var on = t.key === state.tab;
      return '<button type="button" role="tab" class="tab' + (on ? ' active' : '') + '" aria-selected="' + on +
        '" data-tab="' + t.key + '">' + esc(t.label) + '</button>';
    }).join('');
    $('tabs').hidden = !tabs.length;
  }
  function fillDemoSwitcher() {
    var hit = false;
    var opts = activeStaff().map(function (s) {
      var on = String(s.Email).toLowerCase() === state.login.toLowerCase();
      hit = hit || on;
      return '<option value="' + esc(s.Email) + '"' + (on ? ' selected' : '') + '>' + esc(s.Name + '（' + roleLabel(s.Role) + '）') + '</option>';
    }).join('');
    $('demo-as').innerHTML = (hit ? '' : '<option value="" selected>利用者を選ぶ</option>') + opts;
  }

  var VIEWS = {};
  var LISTS = {};
  function render() {
    if (!state.me) return;
    var warn = state.warnings.map(function (w) { return '<div class="notice warn" role="alert">' + esc(w) + '</div>'; }).join('');
    setView(warn + VIEWS[state.tab]());
  }
  function refreshList() {
    var box = $('list');
    if (box && LISTS[state.tab]) box.innerHTML = LISTS[state.tab]();
  }

  /* ---------- ダッシュボード ---------- */
  function followReason(d, today) {
    var r = [];
    if (Dates.isDate(d.Next_Action_On) && d.Next_Action_On < today) r.push('次回アクションの期限切れ（' + day(d.Next_Action_On) + '）');
    if (Dates.isDate(d.Close_Plan) && d.Close_Plan < today) r.push('受注予定日を過ぎています（' + day(d.Close_Plan) + '）');
    if (!d.Next_Action && !d.Next_Action_On) r.push('次回アクションが未設定');
    return r.join(' / ');
  }
  function kpi(key, label, value, raw, sub, extra) {
    return '<div class="kpi" data-kpi="' + key + '" data-value="' + esc(raw) + '">' +
      '<div class="kpi-label">' + esc(label) + '</div><div class="kpi-value">' + esc(value) + '</div>' +
      (sub ? '<div class="kpi-sub">' + esc(sub) + '</div>' : '') + (extra || '') + '</div>';
  }
  VIEWS.dashboard = function () {
    var today = Dates.today(), mon = Dates.month();
    var open = state.deals.filter(isOpen);
    var won = state.deals.filter(wonIn(mon));
    var wonNoDate = state.deals.filter(function (d) { return isWon(d) && !Dates.isDate(d.Closed_On); });
    var wonAmt = sum(won, amt);
    var monTargets = state.targets.filter(function (t) { return t.Month === mon; });
    var target = sum(monTargets, amt);
    var rate = target > 0 ? wonAmt / target : null;
    var pipe = sum(open, amt), wsum = sum(open, weighted);
    var closing = open.filter(function (d) { return String(d.Close_Plan).slice(0, 7) === mon; });
    var follow = open.map(function (d) { return { d: d, why: followReason(d, today) }; })
      .filter(function (x) { return x.why; })
      .sort(function (a, b) { return cmp(a.d.Next_Action_On || a.d.Close_Plan || '9', b.d.Next_Action_On || b.d.Close_Plan || '9'); });

    var html = '<div class="kpis">' +
      kpi('won', Dates.monthLabel(mon) + 'の受注', Num.yen(wonAmt), wonAmt, won.length + '件') +
      kpi('rate', '目標達成率', rate == null ? '目標未設定' : pct(rate), rate == null ? '' : Math.round(rate * 100),
        '目標 ' + Num.yen(target), '<div class="bar"><span style="width:' + Math.min(100, Math.round((rate || 0) * 100)) + '%"></span></div>') +
      kpi('pipeline', '進行中の案件', Num.yen(pipe), pipe, open.length + '件') +
      kpi('weighted', '加重見込み', Num.yen(wsum), Math.round(wsum), '金額 × 確度') +
      kpi('closing', '今月の受注予定', Num.yen(sum(closing, amt)), sum(closing, amt), closing.length + '件') +
      '</div>';

    if (wonNoDate.length) {
      html += '<div class="notice">受注のうち確定日が空の案件が ' + wonNoDate.length + ' 件あります（今月の実績に数えていません）。案件の編集で確定日を入れてください。</div>';
    }

    /* ステージ別 */
    var stages = CFG.STAGES.filter(function (s) { return s.open; }).map(function (s) {
      var ds = open.filter(function (d) { return stageInfo(d).key === s.key; });
      return { s: { key: s.key, idx: STAGE_IDX[s.key] }, n: ds.length, amt: sum(ds, amt) };
    });
    var unknown = open.filter(function (d) { return stageInfo(d).idx < 0; });
    if (unknown.length) stages.push({ s: { key: '不明なステージ', idx: -1 }, n: unknown.length, amt: sum(unknown, amt) });
    var maxAmt = Math.max.apply(null, stages.map(function (x) { return x.amt; }).concat([1]));
    html += '<div class="card"><h3>ステージ別（進行中）</h3>' + stages.map(function (x) {
      return '<div class="stage-row">' + badge(x.s) + '<div class="bar"><span style="width:' + Math.round(x.amt / maxAmt * 100) + '%"></span></div>' +
        '<span class="num">' + x.n + '件</span><span class="num">' + Num.yen(x.amt) + '</span></div>';
    }).join('') + '</div>';

    /* 担当者別 */
    var people = state.isManager ? activeStaff() : [state.me];
    var rows = people.map(function (s) {
      var mine = ownedBy(s.ID), o = open.filter(mine);
      var w = sum(won.filter(mine), amt);
      var tg = sum(monTargets.filter(function (t) { return same(t.Staff_ID, s.ID); }), amt);
      return { name: s.Name, won: w, target: tg, rate: tg > 0 ? w / tg : null, open: sum(o, amt), weighted: sum(o, weighted) };
    });
    if (state.isManager) {
      var known = {};
      state.staff.forEach(function (s) { known[String(s.ID)] = true; });
      var orphan = function (d) { return !known[String(d.Owner_ID)]; };
      var oo = open.filter(orphan), ow = won.filter(orphan);
      if (oo.length || ow.length) rows.push({ name: '（担当者未設定）', won: sum(ow, amt), target: 0, rate: null, open: sum(oo, amt), weighted: sum(oo, weighted) });
    }
    html += '<div class="card"><h3>' + (state.isManager ? '担当者別（' + Dates.monthLabel(mon) + '）' : '自分の実績（' + Dates.monthLabel(mon) + '）') + '</h3>' +
      '<div class="table-wrap"><table><thead><tr><th>担当者</th><th class="r">受注</th><th class="r">目標</th><th class="r">達成率</th><th class="r">進行中</th><th class="r">加重見込み</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td>' + esc(r.name) + '</td><td class="r">' + Num.yen(r.won) + '</td><td class="r">' + (r.target ? Num.yen(r.target) : '—') + '</td>' +
          '<td class="r">' + pct(r.rate) + '</td><td class="r">' + Num.yen(r.open) + '</td><td class="r">' + Num.yen(r.weighted) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';

    /* 要フォロー */
    html += '<div class="card"><h3>要フォロー <span class="count">' + follow.length + '件</span></h3>' +
      (follow.length ? '<div class="table-wrap"><table><thead><tr><th>案件</th><th>顧客</th><th>担当</th><th>理由</th></tr></thead><tbody>' +
        follow.map(function (x) {
          return '<tr><td><button type="button" class="link" data-act="editDeal" data-id="' + esc(x.d.ID) + '">' + esc(x.d.Name || '（無題）') + '</button></td>' +
            '<td>' + esc(x.d.Customer_Name) + '</td><td>' + esc(x.d.Owner_Name) + '</td><td class="late">' + esc(x.why) + '</td></tr>';
        }).join('') + '</tbody></table></div>'
        : '<p class="empty">期限切れや予定日超過の案件はありません。</p>') + '</div>';

    /* 今月の受注予定 */
    html += '<div class="card"><h3>今月の受注予定 <span class="count">' + closing.length + '件</span></h3>' +
      (closing.length ? '<div class="table-wrap"><table><thead><tr><th>案件</th><th>顧客</th><th>担当</th><th>ステージ</th><th class="r">金額</th><th class="r">確度</th><th>予定日</th></tr></thead><tbody>' +
        closing.slice().sort(function (a, b) { return cmp(a.Close_Plan, b.Close_Plan); }).map(function (d) {
          return '<tr><td><button type="button" class="link" data-act="editDeal" data-id="' + esc(d.ID) + '">' + esc(d.Name || '（無題）') + '</button></td>' +
            '<td>' + esc(d.Customer_Name) + '</td><td>' + esc(d.Owner_Name) + '</td><td>' + badge(stageInfo(d)) + '</td>' +
            '<td class="r">' + Num.yen(d.Amount) + '</td><td class="r">' + prob(d) + '%</td><td>' + esc(day(d.Close_Plan)) + '</td></tr>';
        }).join('') + '</tbody></table></div>'
        : '<p class="empty">今月が受注予定日の案件はありません。</p>') + '</div>';
    return html;
  };

  /* ---------- 案件 ---------- */
  VIEWS.deals = function () {
    var f = state.f;
    var chips = [{ k: 'open', l: '進行中' }, { k: 'all', l: 'すべて' }]
      .concat(CFG.STAGES.map(function (s) { return { k: s.key, l: s.key }; }));
    return '<div class="card"><div class="toolbar">' +
      '<button type="button" class="btn btn-primary" data-act="newDeal">＋ 新規案件</button>' +
      '<input type="search" data-filter="q" value="' + esc(f.q) + '" placeholder="案件名・顧客名で検索" aria-label="案件を検索">' +
      (state.isManager ? '<select data-filter="owner" aria-label="担当者で絞り込み">' +
        UI.options([{ value: '', label: '担当者：すべて' }].concat(state.staff.map(function (s) { return { value: s.ID, label: s.Name }; })), f.owner) +
        '</select>' : '') +
      '</div><div class="chips" role="group" aria-label="ステージで絞り込み">' +
      chips.map(function (c) {
        var on = f.stage === c.k;
        return '<button type="button" class="chip-btn' + (on ? ' on' : '') + '" aria-pressed="' + on + '" data-act="stageFilter" data-id="' + esc(c.k) + '">' + esc(c.l) + '</button>';
      }).join('') + '</div><div id="list">' + LISTS.deals() + '</div></div>';
  };
  function dealSort(a, b) {
    var ao = isOpen(a), bo = isOpen(b);
    if (ao !== bo) return ao ? -1 : 1;
    return ao ? cmp(a.Close_Plan || '9999', b.Close_Plan || '9999') : cmp(b.Closed_On || '', a.Closed_On || '');
  }
  LISTS.deals = function () {
    var f = state.f, q = f.q.toLowerCase(), today = Dates.today();
    var list = state.deals.filter(function (d) {
      var s = stageInfo(d);
      if (f.stage === 'open' && !s.open) return false;
      if (f.stage !== 'open' && f.stage !== 'all' && s.key !== f.stage) return false;
      if (f.owner && !same(d.Owner_ID, f.owner)) return false;
      if (q && (String(d.Name) + ' ' + String(d.Customer_Name)).toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(dealSort);
    if (!list.length) return '<p class="empty">該当する案件はありません。</p>';
    return '<div class="table-wrap"><table class="wide"><thead><tr><th>案件名</th><th>顧客</th><th>担当</th><th>ステージ</th>' +
      '<th class="r">金額</th><th class="r">確度</th><th>受注予定</th><th>次回アクション</th></tr></thead><tbody>' +
      list.map(function (d) {
        var s = stageInfo(d), late = s.open && Dates.isDate(d.Next_Action_On) && d.Next_Action_On < today;
        return '<tr><td><button type="button" class="link" data-act="editDeal" data-id="' + esc(d.ID) + '">' + esc(d.Name || '（無題）') + '</button></td>' +
          '<td>' + esc(d.Customer_Name) + '</td><td>' + esc(d.Owner_Name) + '</td><td>' + badge(s) + '</td>' +
          '<td class="r">' + Num.yen(d.Amount) + '</td><td class="r">' + prob(d) + '%</td>' +
          '<td>' + esc(s.open ? day(d.Close_Plan) : day(d.Closed_On)) + '</td>' +
          '<td' + (late ? ' class="late"' : '') + '>' + esc(d.Next_Action) + (d.Next_Action_On ? ' <small>' + esc(day(d.Next_Action_On)) + '</small>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="sum">' + list.length + '件　合計 ' + Num.yen(sum(list, amt)) + '</p>';
  };

  function dateField(name, label, v, hint) {
    var ok = Dates.isDate(v);
    return UI.field({ name: name, label: label, type: 'date', value: ok ? v : '',
      hint: (!ok && v) ? '元の値「' + v + '」は日付として読めないため空欄で表示しています' : hint });
  }
  function openDeal(id, preset) {
    var d = id ? byId(state.deals, id) : null;
    if (id && !d) return UI.toast('案件が見つかりません', 'error');
    var custs = state.customers.filter(function (c) { return c.Is_Active || (d && same(c.ID, d.Customer_ID)); });
    if (!custs.length) return UI.toast('先に顧客を登録してください', 'error');
    var v = d || assign({ Name: '', Customer_ID: '', Owner_ID: state.me.ID, Stage: CFG.STAGES[0].key, Amount: '', Prob: CFG.STAGES[0].prob,
      Close_Plan: '', Closed_On: '', Next_Action: '', Next_Action_On: '', Note: '' }, preset || {});
    var st = stageInfo(v);
    var stageOpts = CFG.STAGES.map(function (s) { return s.key; });
    if (st.idx < 0) stageOpts.push(st.key);
    var owner = byId(state.staff, v.Owner_ID);

    var body = '<div class="form-grid">' +
      UI.field({ name: 'Name', label: '案件名', value: v.Name, required: true, full: true }) +
      UI.field({ name: 'Customer_ID', label: '顧客', type: 'select', value: v.Customer_ID, required: true,
        options: [{ value: '', label: '選択してください' }].concat(custs.map(function (c) { return { value: c.ID, label: c.Name }; })) }) +
      (state.isManager
        ? UI.field({ name: 'Owner_ID', label: '担当者', type: 'select', value: v.Owner_ID, options: staffChoices(v.Owner_ID) })
        : '<div class="field"><span class="label">担当者</span><div class="static">' + esc(owner ? owner.Name : (v.Owner_Name || state.me.Name)) + '</div></div>') +
      UI.field({ name: 'Stage', label: 'ステージ', type: 'select', value: st.key, options: stageOpts }) +
      UI.field({ name: 'Amount', label: '金額（円）', value: v.Amount === '' ? '' : amt(v), placeholder: '例：3000000 / 300万' }) +
      UI.field({ name: 'Prob', label: '確度（%）', type: 'number', value: prob(v), attrs: ' min="0" max="100" step="1"', hint: 'ステージを変えると標準の確度が入ります' }) +
      dateField('Close_Plan', '受注予定日', v.Close_Plan) +
      dateField('Closed_On', '確定日（受注・失注）', v.Closed_On, '受注・失注にして空欄なら今日の日付が入ります') +
      UI.field({ name: 'Next_Action', label: '次回アクション', value: v.Next_Action }) +
      dateField('Next_Action_On', '次回アクション日', v.Next_Action_On) +
      UI.field({ name: 'Note', label: '備考', type: 'textarea', value: v.Note, full: true }) +
      '</div>';

    UI.openModal(d ? '案件の編集' : '新規案件', body, {
      onOpen: function (form) {
        form.elements.Stage.addEventListener('change', function () {
          var s = stageInfo({ Stage: form.elements.Stage.value });
          if (s.prob != null) form.elements.Prob.value = s.prob;
          if (s.open) form.elements.Closed_On.value = '';
          else if (!form.elements.Closed_On.value) form.elements.Closed_On.value = Dates.today();
        });
      },
      onSubmit: function (x) {
        if (!x.Name) throw UI.userError('案件名を入れてください');
        var cust = byId(state.customers, x.Customer_ID);
        if (!cust) throw UI.userError('顧客を選んでください');
        var amount = x.Amount === '' ? 0 : Num.parse(x.Amount);
        if (isNaN(amount) || amount < 0) throw UI.userError('金額が数値として読めません（例：3000000 / 300万）');
        var p = Num.parse(x.Prob);
        if (isNaN(p) || p < 0 || p > 100) throw UI.userError('確度は 0〜100 の数値で入れてください');
        var s = stageInfo({ Stage: x.Stage });
        var ownerId = state.isManager ? x.Owner_ID : (d ? d.Owner_ID : state.me.ID);
        var o = byId(state.staff, ownerId);
        var obj = {
          Name: x.Name, Customer_ID: cust.ID, Customer_Name: cust.Name,
          Owner_ID: o ? o.ID : '', Owner_Name: o ? o.Name : '', Owner_Email: o ? o.Email : '',
          Stage: s.key, Amount: Math.round(amount), Prob: Math.round(p),
          Close_Plan: x.Close_Plan, Closed_On: s.open ? '' : (x.Closed_On || Dates.today()),
          Next_Action: x.Next_Action, Next_Action_On: x.Next_Action_On, Note: x.Note
        };
        var before = d ? stageInfo(d).key : '';
        return save('Deals', d, obj, d ? '案件更新' : '案件追加', function (r) {
          return r.Name + '（' + r.Customer_Name + '）' + (d && before !== r.Stage ? ' ' + before + '→' + r.Stage : ' ' + r.Stage) + ' ' + Num.yen(r.Amount);
        });
      }
    });
  }

  /* ---------- 顧客 ---------- */
  VIEWS.customers = function () {
    var f = state.f;
    return '<div class="card"><div class="toolbar">' +
      '<button type="button" class="btn btn-primary" data-act="newCustomer">＋ 新規顧客</button>' +
      '<input type="search" data-filter="custQ" value="' + esc(f.custQ) + '" placeholder="会社名・業種・先方担当者で検索" aria-label="顧客を検索">' +
      '<label class="check"><input type="checkbox" data-filter="custAll"' + (f.custAll ? ' checked' : '') + '> 取引終了も表示</label>' +
      '</div><div id="list">' + LISTS.customers() + '</div></div>';
  };
  LISTS.customers = function () {
    var f = state.f, q = f.custQ.toLowerCase();
    var list = state.customers.filter(function (c) {
      if (!f.custAll && !c.Is_Active) return false;
      return !q || [c.Name, c.Industry, c.Contact].join(' ').toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) { return cmp(String(a.Rank || 'Z'), String(b.Rank || 'Z')) || cmp(String(a.Name), String(b.Name)); });
    if (!list.length) return '<p class="empty">該当する顧客はありません。</p>';
    return '<div class="table-wrap"><table class="wide"><thead><tr><th>会社名</th><th>業種</th><th>ランク</th><th>先方担当者</th><th>電話</th>' +
      '<th>主担当</th><th class="r">進行中</th><th class="r">受注累計</th><th>状態</th></tr></thead><tbody>' +
      list.map(function (c) {
        var ds = state.deals.filter(function (d) { return same(d.Customer_ID, c.ID); });
        var o = ds.filter(isOpen);
        return '<tr><td><button type="button" class="link" data-act="editCustomer" data-id="' + esc(c.ID) + '">' + esc(c.Name || '（無名）') + '</button></td>' +
          '<td>' + esc(c.Industry) + '</td><td>' + esc(c.Rank) + '</td><td>' + esc(c.Contact) + '</td><td>' + esc(c.Phone) + '</td>' +
          '<td>' + esc(c.Owner_Name) + '</td><td class="r">' + o.length + '件 ' + Num.yen(sum(o, amt)) + '</td>' +
          '<td class="r">' + Num.yen(sum(ds.filter(isWon), amt)) + '</td><td>' + (c.Is_Active ? '取引中' : '<span class="muted">取引終了</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div><p class="sum">' + list.length + '社</p>';
  };
  function customerRelated(c) {
    var ds = state.deals.filter(function (d) { return same(d.Customer_ID, c.ID); }).sort(dealSort);
    var as = state.activities.filter(function (a) { return same(a.Customer_ID, c.ID); })
      .sort(function (a, b) { return cmp(b.Date, a.Date); }).slice(0, 5);
    return '<div class="related"><h3>この顧客の案件 <span class="count">' + ds.length + '件</span></h3>' +
      (ds.length ? '<ul>' + ds.map(function (d) {
        return '<li>' + badge(stageInfo(d)) + ' ' + esc(d.Name) + ' <span class="muted">' + Num.yen(d.Amount) + '</span></li>';
      }).join('') + '</ul>' : '<p class="empty">まだありません。</p>') +
      '<h3>最近の活動</h3>' +
      (as.length ? '<ul>' + as.map(function (a) {
        return '<li><span class="muted">' + esc(day(a.Date)) + ' ' + esc(a.Type) + '</span> ' + esc(a.Summary) + '</li>';
      }).join('') + '</ul>' : '<p class="empty">まだありません。</p>') +
      '<div class="row"><button type="button" class="btn btn-sm" data-act="newDealFor" data-id="' + esc(c.ID) + '">＋ この顧客の案件を追加</button>' +
      '<button type="button" class="btn btn-sm" data-act="newActivityFor" data-id="' + esc(c.ID) + '">＋ 活動を記録</button></div></div>';
  }
  function openCustomer(id) {
    var c = id ? byId(state.customers, id) : null;
    if (id && !c) return UI.toast('顧客が見つかりません', 'error');
    var v = c || { Name: '', Industry: '', Rank: '', Contact: '', Phone: '', Address: '', Owner_ID: state.me.ID, Note: '', Is_Active: true };
    var ranks = [{ value: '', label: '（未設定）' }].concat(CFG.RANKS);
    if (v.Rank && CFG.RANKS.indexOf(v.Rank) < 0) ranks.push(v.Rank);
    var body = '<div class="form-grid">' +
      UI.field({ name: 'Name', label: '会社名', value: v.Name, required: true, full: true }) +
      UI.field({ name: 'Industry', label: '業種', value: v.Industry }) +
      UI.field({ name: 'Rank', label: 'ランク', type: 'select', value: v.Rank, options: ranks }) +
      UI.field({ name: 'Contact', label: '先方担当者', value: v.Contact }) +
      UI.field({ name: 'Phone', label: '電話番号', type: 'tel', value: v.Phone }) +
      UI.field({ name: 'Address', label: '所在地', value: v.Address, full: true }) +
      UI.field({ name: 'Owner_ID', label: '主担当', type: 'select', value: v.Owner_ID, options: staffChoices(v.Owner_ID) }) +
      UI.field({ name: 'Is_Active', label: '取引中', type: 'checkbox', value: v.Is_Active }) +
      UI.field({ name: 'Note', label: '備考', type: 'textarea', value: v.Note, full: true }) +
      '</div>';
    UI.openModal(c ? '顧客の編集' : '新規顧客', body, {
      footHtml: c ? customerRelated(c) : '',
      onSubmit: function (x) {
        if (!x.Name) throw UI.userError('会社名を入れてください');
        var dup = state.customers.filter(function (o) { return o !== c && String(o.Name).trim() === x.Name; });
        if (dup.length) throw UI.userError('同じ会社名の顧客がすでにあります：' + x.Name);
        var o = byId(state.staff, x.Owner_ID);
        var obj = { Name: x.Name, Industry: x.Industry, Rank: x.Rank, Contact: x.Contact, Phone: x.Phone, Address: x.Address,
          Owner_ID: o ? o.ID : '', Owner_Name: o ? o.Name : '', Note: x.Note, Is_Active: x.Is_Active };
        return save('Customers', c, obj, c ? '顧客更新' : '顧客追加', function (r) { return r.Name; });
      }
    });
  }

  /* ---------- 活動履歴 ---------- */
  VIEWS.activities = function () {
    var f = state.f;
    return '<div class="card"><div class="toolbar">' +
      '<button type="button" class="btn btn-primary" data-act="newActivity">＋ 活動を記録</button>' +
      '<select data-filter="actType" aria-label="種別で絞り込み">' + UI.options([{ value: '', label: '種別：すべて' }].concat(CFG.ACT_TYPES), f.actType) + '</select>' +
      '<input type="search" data-filter="actQ" value="' + esc(f.actQ) + '" placeholder="顧客・案件・内容で検索" aria-label="活動を検索">' +
      '</div><div id="list">' + LISTS.activities() + '</div></div>';
  };
  LISTS.activities = function () {
    var f = state.f, q = f.actQ.toLowerCase();
    var list = state.activities.filter(function (a) {
      if (f.actType && a.Type !== f.actType) return false;
      return !q || [a.Customer_Name, a.Deal_Name, a.Summary, a.Staff_Name].join(' ').toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) { return cmp(b.Date, a.Date) || cmp(String(b.ID), String(a.ID)); });
    if (!list.length) return '<p class="empty">該当する活動はありません。</p>';
    return '<div class="table-wrap"><table class="wide"><thead><tr><th>日付</th><th>種別</th><th>顧客</th><th>案件</th><th>担当</th><th>内容</th></tr></thead><tbody>' +
      list.map(function (a) {
        return '<tr><td><button type="button" class="link" data-act="editActivity" data-id="' + esc(a.ID) + '">' + esc(day(a.Date) || '（日付なし）') + '</button></td>' +
          '<td>' + esc(a.Type) + '</td><td>' + esc(a.Customer_Name) + '</td><td>' + esc(a.Deal_Name) + '</td><td>' + esc(a.Staff_Name) + '</td>' +
          '<td class="clip">' + esc(a.Summary) + '</td></tr>';
      }).join('') + '</tbody></table></div><p class="sum">' + list.length + '件</p>';
  };
  function dealChoicesFor(custId, keepId) {
    var ds = state.deals.filter(function (d) { return same(d.Customer_ID, custId) && (isOpen(d) || same(d.ID, keepId)); });
    return [{ value: '', label: '（案件なし）' }].concat(ds.map(function (d) { return { value: d.ID, label: d.Name + '（' + stageInfo(d).key + '）' }; }));
  }
  function openActivity(id, preset) {
    var a = id ? byId(state.activities, id) : null;
    if (id && !a) return UI.toast('活動が見つかりません', 'error');
    var custs = state.customers.filter(function (c) { return c.Is_Active || (a && same(c.ID, a.Customer_ID)); });
    if (!custs.length) return UI.toast('先に顧客を登録してください', 'error');
    var v = a || assign({ Date: Dates.today(), Type: CFG.ACT_TYPES[0], Customer_ID: '', Deal_ID: '', Staff_ID: state.me.ID, Summary: '' }, preset || {});
    var types = CFG.ACT_TYPES.slice();
    if (v.Type && types.indexOf(v.Type) < 0) types.push(v.Type);
    var staffName = (byId(state.staff, v.Staff_ID) || {}).Name || v.Staff_Name || state.me.Name;
    var body = '<div class="form-grid">' +
      dateField('Date', '活動日', v.Date) +
      UI.field({ name: 'Type', label: '種別', type: 'select', value: v.Type, options: types }) +
      UI.field({ name: 'Customer_ID', label: '顧客', type: 'select', value: v.Customer_ID, required: true,
        options: [{ value: '', label: '選択してください' }].concat(custs.map(function (c) { return { value: c.ID, label: c.Name }; })) }) +
      UI.field({ name: 'Deal_ID', label: '案件', type: 'select', value: v.Deal_ID, options: dealChoicesFor(v.Customer_ID, v.Deal_ID) }) +
      (state.isManager
        ? UI.field({ name: 'Staff_ID', label: '担当者', type: 'select', value: v.Staff_ID, options: staffChoices(v.Staff_ID) })
        : '<div class="field"><span class="label">担当者</span><div class="static">' + esc(staffName) + '</div></div>') +
      UI.field({ name: 'Summary', label: '内容', type: 'textarea', value: v.Summary, required: true, full: true }) +
      '</div>';
    UI.openModal(a ? '活動の編集' : '活動を記録', body, {
      onOpen: function (form) {
        form.elements.Customer_ID.addEventListener('change', function () {
          form.elements.Deal_ID.innerHTML = UI.options(dealChoicesFor(form.elements.Customer_ID.value, ''), '');
        });
      },
      onSubmit: function (x) {
        if (!Dates.isDate(x.Date)) throw UI.userError('活動日を入れてください');
        var cust = byId(state.customers, x.Customer_ID);
        if (!cust) throw UI.userError('顧客を選んでください');
        if (!x.Summary) throw UI.userError('内容を入れてください');
        var deal = x.Deal_ID ? byId(state.deals, x.Deal_ID) : null;
        var sid = state.isManager ? x.Staff_ID : (a ? a.Staff_ID : state.me.ID);
        var s = byId(state.staff, sid);
        var obj = { Date: x.Date, Type: x.Type, Customer_ID: cust.ID, Customer_Name: cust.Name,
          Deal_ID: deal ? deal.ID : '', Deal_Name: deal ? deal.Name : '',
          Staff_ID: s ? s.ID : '', Staff_Name: s ? s.Name : '', Staff_Email: s ? s.Email : '', Summary: x.Summary };
        return save('Activities', a, obj, a ? '活動更新' : '活動記録', function (r) { return r.Date + ' ' + r.Type + ' ' + r.Customer_Name; });
      }
    });
  }

  /* ---------- 目標（マネージャー） ---------- */
  function targetsOf(staffId, mon) {
    return state.targets.filter(function (t) { return same(t.Staff_ID, staffId) && t.Month === mon; });
  }
  VIEWS.targets = function () {
    var mon = state.targetMonth, won = state.deals.filter(wonIn(mon));
    return '<div class="card"><div class="toolbar month-nav">' +
      '<button type="button" class="btn btn-sm" data-act="monthPrev" aria-label="前の月">‹ 前月</button>' +
      '<strong data-month="' + esc(mon) + '">' + esc(Dates.monthLabel(mon)) + '</strong>' +
      '<button type="button" class="btn btn-sm" data-act="monthNext" aria-label="次の月">翌月 ›</button></div>' +
      '<div class="table-wrap"><table class="mid"><thead><tr><th>担当者</th><th>チーム</th><th>目標金額</th><th class="r">受注実績</th><th class="r">達成率</th></tr></thead><tbody>' +
      activeStaff().map(function (s) {
        var ts = targetsOf(s.ID, mon), tg = sum(ts, amt), w = sum(won.filter(ownedBy(s.ID)), amt);
        return '<tr><td>' + esc(s.Name) + '</td><td>' + esc(s.Team) + '</td>' +
          '<td><input class="money" data-target-staff="' + esc(s.ID) + '" value="' + (ts.length ? tg : '') + '" placeholder="例：300万" aria-label="' + esc(s.Name) + 'の目標金額">' +
          (ts.length > 1 ? '<small class="late">同じ月の目標が ' + ts.length + ' 件あります（合計を表示）</small>' : '') + '</td>' +
          '<td class="r">' + Num.yen(w) + '</td><td class="r">' + pct(tg > 0 ? w / tg : null) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="form-error" id="target-error" role="alert" hidden></p>' +
      '<div class="row"><button type="button" class="btn btn-primary" data-act="saveTargets">目標を保存</button>' +
      '<span class="muted small">「300万」「3,000,000」のどちらでも入力できます。</span></div></div>';
  };
  function saveTargets(btn) {
    var mon = state.targetMonth, err = $('target-error'), jobs = [], bad = [];
    err.hidden = true;
    Array.prototype.forEach.call(document.querySelectorAll('[data-target-staff]'), function (inp) {
      var s = byId(state.staff, inp.getAttribute('data-target-staff')), raw = inp.value.trim();
      var ts = targetsOf(s.ID, mon), cur = ts.length ? sum(ts, amt) : null;
      var n = raw === '' ? 0 : Num.parse(raw);
      if (isNaN(n) || n < 0) { bad.push(s.Name + '「' + raw + '」'); return; }
      n = Math.round(n);
      if (raw === '' && !ts.length) return;
      if (cur !== n) jobs.push({ s: s, t: ts[0] || null, amount: n });
    });
    if (bad.length) { err.textContent = '数値として読めません：' + bad.join('、'); err.hidden = false; return; }
    if (!jobs.length) { UI.toast('変更はありません'); return; }
    btn.disabled = true;
    var done = 0;
    jobs.reduce(function (p, j) {
      return p.then(function () {
        var obj = { Month: mon, Staff_ID: j.s.ID, Staff_Name: j.s.Name, Staff_Email: j.s.Email, Amount: j.amount };
        return (j.t ? DB.update('Targets', j.t.ID, obj) : DB.add('Targets', obj)).then(function (res) {
          if (j.t) assign(j.t, obj); else state.targets.push(res);
          done++;
          log('目標更新', j.t ? j.t.ID : res.ID, Dates.monthLabel(mon) + ' ' + j.s.Name + ' ' + Num.yen(j.amount));
        });
      });
    }, Promise.resolve()).then(function () {
      UI.toast('目標を保存しました（' + done + '件）');
      render();
    }, function (e) {
      render();
      var el = $('target-error');
      el.textContent = done + '件を保存したところで失敗しました：' + DB.errText(e);
      el.hidden = false;
    });
  }

  /* ---------- 担当者（マネージャー） ---------- */
  VIEWS.staff = function () {
    return '<div class="card"><div class="toolbar"><button type="button" class="btn btn-primary" data-act="newStaff">＋ 担当者を追加</button>' +
      '<span class="muted small">メールアドレスは Creator のログインIDと同じにしてください。</span></div>' +
      '<div class="table-wrap"><table class="wide"><thead><tr><th>氏名</th><th>メールアドレス</th><th>チーム</th><th>権限</th><th>在籍</th></tr></thead><tbody>' +
      state.staff.slice().sort(function (a, b) { return (b.Is_Active - a.Is_Active) || cmp(String(a.Team), String(b.Team)); }).map(function (s) {
        return '<tr><td><button type="button" class="link" data-act="editStaff" data-id="' + esc(s.ID) + '">' + esc(s.Name || '（無名）') + '</button></td>' +
          '<td>' + esc(s.Email) + '</td><td>' + esc(s.Team) + '</td><td>' + esc(roleLabel(s.Role)) + '</td>' +
          '<td>' + (s.Is_Active ? '在籍' : '<span class="muted">在籍なし</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  };
  function openStaff(id) {
    var s = id ? byId(state.staff, id) : null;
    if (id && !s) return UI.toast('担当者が見つかりません', 'error');
    var v = s || { Name: '', Email: '', Team: '', Role: 'member', Is_Active: true };
    var body = '<div class="form-grid">' +
      UI.field({ name: 'Name', label: '氏名', value: v.Name, required: true }) +
      UI.field({ name: 'Email', label: 'メールアドレス（ログインID）', type: 'email', value: v.Email, required: true }) +
      UI.field({ name: 'Team', label: 'チーム', value: v.Team }) +
      UI.field({ name: 'Role', label: '権限', type: 'select', value: isManagerRole(v.Role) ? 'manager' : 'member',
        options: [{ value: 'member', label: CFG.ROLES.member }, { value: 'manager', label: CFG.ROLES.manager }] }) +
      UI.field({ name: 'Is_Active', label: '在籍', type: 'checkbox', value: v.Is_Active }) +
      '</div>';
    UI.openModal(s ? '担当者の編集' : '担当者を追加', body, {
      onSubmit: function (x) {
        if (!x.Name) throw UI.userError('氏名を入れてください');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x.Email)) throw UI.userError('メールアドレスの形が正しくありません');
        var mail = x.Email.toLowerCase();
        if (state.staff.some(function (o) { return o !== s && String(o.Email).trim().toLowerCase() === mail; })) {
          throw UI.userError('同じメールアドレスの担当者がすでにいます');
        }
        if (s && s === state.me && (x.Role !== 'manager' || !x.Is_Active)) {
          throw UI.userError('自分自身の権限や在籍は外せません。ほかのマネージャーに依頼してください。');
        }
        var obj = { Name: x.Name, Email: x.Email, Team: x.Team, Role: x.Role, Is_Active: x.Is_Active };
        return save('Staff', s, obj, s ? '担当者更新' : '担当者追加', function (r) { return r.Name + ' ' + r.Email + ' ' + r.Role; })
          .then(function () { renderWho(); });
      }
    });
  }

  /* ---------- 保存と操作記録 ---------- */
  function save(entity, existing, obj, action, describe) {
    var p = existing ? DB.update(entity, existing.ID, obj) : DB.add(entity, obj);
    return p.then(function (res) {
      var rec = existing ? assign(existing, obj) : res;
      if (!existing) state[LIST_KEY[entity]].push(rec);
      log(action, rec.ID, describe(rec));
      linkRefs();
      render();
      UI.toast('保存しました');
      return rec;
    });
  }
  function log(action, targetId, detail) {
    return DB.add('Logs', {
      Log_Time: Dates.nowJST(),
      Actor_Name: state.me ? state.me.Name + '（' + state.login + '）' : state.login,
      Action: action, Target_ID: String(targetId || ''), Detail: String(detail || '').slice(0, 480)
    }).catch(function (e) {
      console.warn('操作記録を保存できませんでした', e);
      if (!logWarned) { logWarned = true; UI.toast('操作記録を保存できませんでした：' + DB.errText(e), 'error'); }
    });
  }

  /* ---------- 操作 ---------- */
  var ACT = {
    newDeal: function () { openDeal(null); },
    editDeal: function (id) { openDeal(id); },
    newDealFor: function (id) { UI.closeModal(); openDeal(null, { Customer_ID: id }); },
    stageFilter: function (k) { state.f.stage = k; render(); },
    newCustomer: function () { openCustomer(null); },
    editCustomer: function (id) { openCustomer(id); },
    newActivity: function () { openActivity(null); },
    newActivityFor: function (id) { UI.closeModal(); openActivity(null, { Customer_ID: id }); },
    editActivity: function (id) { openActivity(id); },
    monthPrev: function () { state.targetMonth = Dates.addMonths(state.targetMonth, -1); render(); },
    monthNext: function () { state.targetMonth = Dates.addMonths(state.targetMonth, 1); render(); },
    saveTargets: function (id, el) { saveTargets(el); },
    newStaff: function () { openStaff(null); },
    editStaff: function (id) { openStaff(id); },
    bootstrap: function (id, btn) {
      var name = $('boot-name').value.trim(), err = $('boot-error');
      if (!name) { err.textContent = '氏名を入れてください'; err.hidden = false; return; }
      btn.disabled = true;
      /* 登録の直前にもう一度確かめる（同時に2人が開いたときに、両方が管理者になるのを避ける） */
      DB.list('Staff').then(function (staff) {
        if (staff.length) return start();
        return DB.add('Staff', { Name: name, Email: state.login, Team: '', Role: 'manager', Is_Active: true }).then(function (rec) {
          state.me = rec;
          log('担当者追加', rec.ID, name + '（最初のマネージャーとして登録）');
          start();
        });
      }).catch(function (e) {
        btn.disabled = false;
        err.textContent = '登録できませんでした：' + DB.errText(e);
        err.hidden = false;
      });
    }
  };

  function bindEvents() {
    document.addEventListener('click', function (e) {
      var el = e.target.closest('[data-act]');
      if (el && ACT[el.getAttribute('data-act')]) ACT[el.getAttribute('data-act')](el.getAttribute('data-id'), el);
    });
    $('tabs').addEventListener('click', function (e) {
      var el = e.target.closest('[data-tab]');
      if (!el) return;
      state.tab = el.getAttribute('data-tab');
      renderTabs(); render();
    });
    function onFilter(e) {
      var el = e.target.closest('[data-filter]');
      if (!el) return;
      state.f[el.getAttribute('data-filter')] = (el.type === 'checkbox') ? el.checked : el.value;
      refreshList();
    }
    $('view').addEventListener('input', onFilter);
    $('view').addEventListener('change', onFilter);
    $('reload').addEventListener('click', function () { start(); });
    $('demo-as').addEventListener('change', function () { DB.lsSet('demo_login', this.value); start(); });
    $('demo-reset').addEventListener('click', function () {
      DB.resetDemo(Seed.build);
      DB.lsSet('demo_login', Seed.DEFAULT_LOGIN);
      UI.toast('デモデータを初期化しました');
      start();
    });
  }

  return { boot: boot };
})();

document.addEventListener('DOMContentLoaded', App.boot);
