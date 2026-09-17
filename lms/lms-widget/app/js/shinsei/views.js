/* =========================================================================
 * views.js — 画面描画
 * すべての一覧・詳細・出力は Access.log() を通してから描画します。
 * ========================================================================= */
var Views = (function () {
  var S = function () { return App.state; };
  var me = function () { return App.me(); };
  var E = UI.esc;

  /* ---------- 共通ヘルパ ---------- */
  function tplOf(code) { return App.templateByCode(code); }
  function dataOf(req) { try { return JSON.parse(req.Form_Data_JSON || '{}'); } catch (e) { return {}; } }
  function routeOf(req) { try { return JSON.parse(req.Route_JSON || '[]'); } catch (e) { return []; } }
  function empName(id) { var e = App.employeeById(id); return e ? e.Employee_Name : ''; }
  function visibleRequests() { return Perm.filterRequests(me(), S().requests, S().approvals); }
  function myPendingSteps() {
    var out = [];
    visibleRequests().forEach(function (r) {
      if (r.Status !== CFG.STATUS.ACTIVE) return;
      var route = routeOf(r), cur = WF.currentStep(route);
      var step = route.filter(function (s) { return s.step_no === cur; })[0];
      if (!step || step.action) return;
      var opt = { req: r, route: route, employees: S().employees };
      if (WF.canAct(step, me().ID, opt)) {
        /* 本来の承認者ではなく、期限超過で権限が広がって回ってきたものは印を付ける */
        var own = String(step.approverId) === String(me().ID) ||
          (step.delegateId && String(step.delegateId) === String(me().ID)) ||
          (step.members || []).some(function (m) { return String(m.id) === String(me().ID); });
        out.push({ req: r, step: step, viaEscalation: !own });
      }
    });
    return out;
  }
  function pageHead(title, sub, actions) {
    return '<div class="page-head"><div><div class="page-title">' + E(title) + '</div>' +
      (sub ? '<div class="page-sub">' + E(sub) + '</div>' : '') + '</div>' +
      (actions ? '<div class="page-actions">' + actions + '</div>' : '') + '</div>';
  }

  /* =======================================================================
   * ダッシュボード
   * ===================================================================== */
  function dashboard(el) {
    var reqs = visibleRequests();
    var mine = S().requests.filter(function (r) { return String(r.Applicant) === String(me().ID); });
    var pending = myPendingSteps();
    var sentback = mine.filter(function (r) { return r.Status === CFG.STATUS.SENTBACK; });
    var drafts = mine.filter(function (r) { return r.Status === CFG.STATUS.DRAFT; });
    var thisMonth = reqs.filter(function (r) { return r.Applied_On && String(r.Applied_On).slice(0, 7) === new Date().toISOString().slice(0, 7); });
    var approvedAmt = reqs.filter(function (r) { return r.Status === CFG.STATUS.APPROVED; })
      .reduce(function (a, r) { return a + (Number(r.Amount) || 0); }, 0);
    /* 平均リードタイム */
    var lts = reqs.filter(function (r) { return r.Status === CFG.STATUS.APPROVED && r.Applied_On && r.Completed_On; })
      .map(function (r) { return (new Date(r.Completed_On) - new Date(r.Applied_On)) / 86400000; });
    var avgLT = lts.length ? (lts.reduce(function (a, b) { return a + b; }, 0) / lts.length).toFixed(1) : '—';

    /* 月次推移 */
    var months = [], mm = {};
    for (var i = 5; i >= 0; i--) { var dt = new Date(); dt.setMonth(dt.getMonth() - i); var k = dt.toISOString().slice(0, 7); months.push(k); mm[k] = 0; }
    reqs.forEach(function (r) { var k = String(r.Applied_On || '').slice(0, 7); if (mm[k] != null) mm[k]++; });
    var bars = months.map(function (k) { return { label: k.slice(5) + '月', value: mm[k] }; });

    /* 区分別 */
    var byType = {};
    reqs.forEach(function (r) { var n = (tplOf(r.Type_Code) || {}).name || r.Type_Code; byType[n] = (byType[n] || 0) + 1; });
    var donutData = Object.keys(byType).map(function (k) { return { label: k, value: byType[k] }; })
      .sort(function (a, b) { return b.value - a.value; }).slice(0, 7);

    /* 自分に対する閲覧（誰が自分の申請を見たか）＝この製品の売り */
    var myReqIds = {}; mine.forEach(function (r) { myReqIds[r.ID] = true; });
    var viewsOnMine = S().accessLogs.filter(function (l) {
      return myReqIds[l.Target_ID] && l.Action === CFG.ACCESS.ACTIONS.VIEW_DETAIL && String(l.Actor) !== String(me().ID);
    }).sort(function (a, b) { return new Date(b.Log_Time) - new Date(a.Log_Time); }).slice(0, 6);

    var html = pageHead('ダッシュボード', me().Employee_Name + ' さん（' + (me().Department_name || '') + '／' + me().Title + '）の状況', '');
    html += '<div class="grid kpi-grid" style="margin-bottom:14px">' +
      kpi('承認待ち（あなたの処理）', pending.length + ' 件', pending.length ? '今すぐ処理が必要です' : '未処理はありません', pending.length > 0) +
      kpi('差戻し', sentback.length + ' 件', '修正して再申請してください') +
      kpi('下書き', drafts.length + ' 件', '未提出の申請') +
      kpi('今月の申請', thisMonth.length + ' 件', '閲覧可能な範囲での集計') +
      '</div>';
    html += '<div class="grid kpi-grid" style="margin-bottom:14px">' +
      kpi('承認済 累計金額', UI.yen(approvedAmt), '閲覧権限のある申請のみ') +
      kpi('平均承認リードタイム', avgLT + ' 日', '申請から完了までの平均') +
      kpi('あなたの申請が見られた回数', viewsOnMine.length ? S().accessLogs.filter(function (l) { return myReqIds[l.Target_ID] && String(l.Actor) !== String(me().ID); }).length + ' 回' : '0 回', '直近の閲覧者は下部に表示') +
      kpi('有給残', (me().Paid_Leave_Balance || 0) + ' 日', '年次有給休暇') +
      '</div>';

    html += '<div class="grid two-col" style="margin-bottom:14px">' +
      '<div class="card"><div class="card-head"><div class="card-title">月次の申請件数</div></div><div class="card-body">' + UI.barChart(bars) + '</div></div>' +
      '<div class="card"><div class="card-head"><div class="card-title">申請区分の構成</div></div><div class="card-body">' + (donutData.length ? UI.donut(donutData) : UI.empty('📭', 'データがありません', '')) + '</div></div>' +
      '</div>';

    html += '<div class="grid two-col">' +
      '<div class="card"><div class="card-head"><div class="card-title">あなたの未処理タスク</div>' +
      '<button class="btn btn-sm" data-go="inbox" style="margin-left:auto">すべて見る</button></div>' +
      '<div class="card-body" style="padding:0">' + taskList(pending) + '</div></div>' +
      '<div class="card"><div class="card-head"><div class="card-title">あなたの申請を閲覧した人</div>' +
      '<span class="tag" style="margin-left:auto">閲覧証跡</span></div>' +
      '<div class="card-body" style="padding:0">' + viewerList(viewsOnMine) + '</div></div>' +
      '</div>';
    /* セットアップの案内は毎日見るものではないので、いちばん下に置く */
    if (Perm.isAdmin(me())) html += Setup.progressCard();

    el.innerHTML = html;
    el.querySelectorAll('[data-go]').forEach(function (b) { b.addEventListener('click', function () { App.go(b.dataset.go); }); });
    el.querySelectorAll('[data-req]').forEach(function (b) { b.addEventListener('click', function () { openDetail(b.dataset.req); }); });
    Setup.bindProgress(el);
    Access.log(CFG.ACCESS.ACTIONS.VIEW_LIST, { targetType: 'ダッシュボード', resultCount: reqs.length });
  }
  function kpi(label, value, foot, attention) {
    return '<div class="card kpi' + (attention ? ' attention' : '') + '"><div class="kpi-label">' + E(label) + '</div>' +
      '<div class="kpi-value">' + E(value) + '</div><div class="kpi-foot">' + E(foot || '') + '</div></div>';
  }
  function taskList(pending) {
    if (!pending.length) return UI.empty('✅', '未処理のタスクはありません', 'あなたが承認すべき申請は現在ありません');
    return '<div class="table-wrap"><table class="tbl"><tbody>' + pending.slice(0, 8).map(function (p) {
      var delayed = WF.isDelayed(p.req, p.step, routeOf(p.req));
      return '<tr data-req="' + E(p.req.ID) + '"><td class="nowrap"><span class="tag">' + E((tplOf(p.req.Type_Code) || {}).name || '') + '</span></td>' +
        '<td>' + E(p.req.Subject) + '<div class="page-sub">' + E(p.req.Applicant_name) + '／' + E(p.step.name) + '</div></td>' +
        '<td class="num nowrap">' + UI.yen(p.req.Amount) + '</td>' +
        '<td class="nowrap">' + (delayed ? '<span class="delay">遅延 ' + WF.overdueDays(p.req, p.step, routeOf(p.req)) + '日</span>' : UI.relTime(p.req.Applied_On)) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }
  function viewerList(logs) {
    if (!logs.length) return UI.empty('👀', 'まだ閲覧されていません', 'あなたの申請を他の人が開くと、ここに記録が残ります');
    return '<div class="table-wrap"><table class="tbl"><tbody>' + logs.map(function (l) {
      return '<tr data-req="' + E(l.Target_ID) + '"><td class="nowrap">' + E(l.Actor_Name) + '<div class="page-sub">' + E(l.Actor_Dept) + '</div></td>' +
        '<td>' + E(l.Target_No) + ' ' + E(l.Target_Subject) + '</td>' +
        '<td class="nowrap">' + E(UI.relTime(l.Log_Time)) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }

  /* =======================================================================
   * 申請する（テンプレート選択）
   * ===================================================================== */
  function newRequest(el) {
    var cats = {};
    App.templates().forEach(function (t) { (cats[t.category] = cats[t.category] || []).push(t); });
    var html = pageHead('申請する', '申請の種類を選んでください。金額に応じて承認経路は自動で決まります。');
    Object.keys(cats).forEach(function (c) {
      html += '<div class="nav-group" style="margin:16px 0 8px;padding:0">' + E(c) + '</div><div class="tpl-grid">';
      cats[c].forEach(function (t) {
        html += '<button class="tpl-card" data-tpl="' + E(t.code) + '">' +
          '<div class="tpl-ico">' + E(t.icon) + '</div><div class="tpl-name">' + E(t.name) + ' ' + UI.sensBadge(t.code) + '</div>' +
          '<div class="tpl-desc">' + E(t.desc) + '</div></button>';
      });
      html += '</div>';
    });
    el.innerHTML = html;
    el.querySelectorAll('[data-tpl]').forEach(function (b) {
      b.addEventListener('click', function () { App.go('form/' + b.dataset.tpl); });
    });
  }

  /* =======================================================================
   * 申請フォーム
   * ===================================================================== */
  var formState = { code: null, data: {}, editingId: null, saveTimer: null, pendingFiles: [] };
/* 添付は申請レコードが出来てから紐づける必要があるため、送信までは画面上で預かる。
   （先に保存すると、送信をやめた場合に行き場のないファイルが残るため） */
  function form(el, code, editId) {
    var t = tplOf(code);
    if (!t) { el.innerHTML = UI.empty('❓', 'テンプレートが見つかりません', code); return; }
    formState.code = code; formState.editingId = editId || null;
    formState.data = {}; formState.pendingFiles = [];
    if (editId) {
      var r = App.requestById(editId);
      if (r) formState.data = dataOf(r);
    }
    (t.fields || []).forEach(function (f) { if (f.type === 'lines' && !formState.data[f.key]) formState.data[f.key] = [{}]; });

    el.innerHTML = pageHead(t.icon + ' ' + t.name, t.desc,
      '<button class="btn" data-act="draft">下書き保存</button>' +
      '<button class="btn btn-primary" data-act="submit">申請する</button>') +
      '<div class="grid two-col">' +
      '<div class="card"><div class="card-head"><div class="card-title">申請内容</div><span class="tag" id="autosave" style="margin-left:auto"></span></div>' +
      '<div class="card-body"><div class="form-grid" id="formGrid"></div></div></div>' +
      '<div><div class="card" style="margin-bottom:14px"><div class="card-head"><div class="card-title">承認経路プレビュー</div></div>' +
      '<div class="card-body" id="routePrev"></div></div>' +
      '<div class="card"><div class="card-head"><div class="card-title">この申請の取り扱い</div></div>' +
      '<div class="card-body" id="policyBox"></div></div></div></div>';

    renderFields(el.querySelector('#formGrid'), t);
    renderRoutePreview(el.querySelector('#routePrev'), t);
    renderPolicy(el.querySelector('#policyBox'), t);
    el.querySelector('[data-act="draft"]').addEventListener('click', function () { submit(t, true); });
    el.querySelector('[data-act="submit"]').addEventListener('click', function () { submit(t, false); });
  }

  function renderFields(grid, t) {
    grid.innerHTML = (t.fields || []).map(function (f) { return fieldHtml(f); }).join('');
    UI.bindMoneyInputs(grid);
    grid.querySelectorAll('[data-field]').forEach(function (inp) {
      inp.addEventListener('input', onFieldChange); inp.addEventListener('change', onFieldChange);
    });
    bindLines(grid, t);
    bindFiles(grid, t);
  }
  function fieldHtml(f) {
    var v = formState.data[f.key];
    var cls = 'field' + (f.full || f.type === 'lines' || f.type === 'textarea' ? ' full' : '') + (f.type === 'currency' ? ' money' : '');
    var label = '<label for="f_' + E(f.key) + '">' + E(f.label) + (f.required ? '<span class="req">*</span>' : '') + '</label>';
    var input = '';
    switch (f.type) {
      case 'textarea': input = '<textarea id="f_' + E(f.key) + '" data-field="' + E(f.key) + '" placeholder="' + E(f.placeholder || '') + '">' + E(v || '') + '</textarea>'; break;
      case 'currency': input = '<input id="f_' + E(f.key) + '" data-field="' + E(f.key) + '" data-money="1" inputmode="numeric" value="' + E(v ? Number(v).toLocaleString('ja-JP') : '') + '" placeholder="0">'; break;
      case 'number': input = '<input id="f_' + E(f.key) + '" data-field="' + E(f.key) + '" type="number" step="0.5" value="' + E(v || '') + '">'; break;
      case 'date': input = '<input id="f_' + E(f.key) + '" data-field="' + E(f.key) + '" type="date" value="' + E(v || '') + '">'; break;
      case 'checkbox': input = '<label class="inline-row"><input id="f_' + E(f.key) + '" data-field="' + E(f.key) + '" type="checkbox" style="width:auto;min-height:auto"' + (v ? ' checked' : '') + '> はい</label>'; break;
      case 'select': input = sel(f.key, (f.options || []).map(function (o) { return { v: o, t: o }; }), v); break;
      case 'employee': input = sel(f.key, S().employees.map(function (e) { return { v: e.ID, t: e.Employee_Name + '（' + e.Department_name + '）' }; }), v); break;
      case 'department': input = sel(f.key, S().departments.map(function (d) { return { v: d.Department_Name, t: d.Department_Name }; }), v); break;
      case 'vendor': input = sel(f.key, S().vendors.map(function (x) { return { v: x.ID, t: x.Vendor_Name + (x.Is_Qualified ? '' : '（未登録事業者）') }; }).concat([NEW_OPT('Vendors')]), v); break;
      case 'account': input = sel(f.key, S().accounts.map(function (a) { return { v: a.ID, t: a.Account_Code + ' ' + a.Account_Name }; }).concat([NEW_OPT('Accounts')]), v); break;
      case 'lines': return '<div class="' + cls + '">' + label + linesHtml(f) + '</div>';
      case 'files': return '<div class="' + cls + '" data-wrap="' + E(f.key) + '">' + label +
        filesHtml(f) + (f.help ? '<div class="help">' + E(f.help) + '</div>' : '') +
        '<div class="err-msg" hidden></div></div>';
      default: input = '<input id="f_' + E(f.key) + '" data-field="' + E(f.key) + '" value="' + E(v || '') + '" placeholder="' + E(f.placeholder || '') + '">';
    }
    return '<div class="' + cls + '" data-wrap="' + E(f.key) + '">' + label + input +
      (f.help ? '<div class="help">' + E(f.help) + '</div>' : '') + '<div class="err-msg" hidden></div></div>';
  }
  function sel(key, opts, v) {
    return '<select id="f_' + E(key) + '" data-field="' + E(key) + '"><option value="">選択してください</option>' +
      opts.map(function (o) { return '<option value="' + E(o.v) + '"' + (String(v) === String(o.v) ? ' selected' : '') + '>' + E(o.t) + '</option>'; }).join('') + '</select>';
  }
  function linesHtml(f) {
    var rows = formState.data[f.key] || [{}];
    var head = f.columns.map(function (c) { return '<th' + (c.w ? ' style="width:' + c.w + '"' : '') + '>' + E(c.label) + '</th>'; }).join('') + '<th style="width:32px"></th>';
    var body = rows.map(function (ln, i) {
      return '<tr data-line="' + i + '">' + f.columns.map(function (c) { return '<td>' + lineCell(f.key, i, c, ln[c.key]) + '</td>'; }).join('') +
        '<td><button type="button" class="line-del" data-del="' + i + '" aria-label="行を削除">×</button></td></tr>';
    }).join('');
    var sum = WF.sumLines(rows, f.columns);
    return '<div class="table-wrap"><table class="tbl lines"><thead><tr>' + head + '</tr></thead><tbody data-lines="' + E(f.key) + '">' + body + '</tbody>' +
      '<tfoot><tr class="sum-row"><td colspan="' + (f.columns.length - 1) + '">合計（うち消費税 ' + UI.yen(sum.tax) + '）</td>' +
      '<td class="num">' + UI.yen(sum.total) + '</td><td></td></tr></tfoot></table></div>' +
      '<div style="margin-top:8px"><button type="button" class="btn btn-sm" data-addline="' + E(f.key) + '">＋ 行を追加</button></div>';
  }
  /* マスタが空だと明細が入力できず申請そのものが出せなくなる。
     申請画面を離れずにその場で足せるよう、選択肢の末尾に登録口を置く。 */
  var NEW_VALUE = '__newmaster__';
  function NEW_OPT(masterKey) { return { v: NEW_VALUE + ':' + masterKey, t: '＋ 新しく登録する…' }; }
  function addNewOpt(masterKey) {
    if (!Masters.DEFS[masterKey].canEdit(me())) return '';
    return '<option value="' + NEW_VALUE + ':' + masterKey + '">＋ 新しく登録する…</option>';
  }
  /** 選択された値が「＋ 新しく登録する…」かどうか。true なら登録ダイアログを開いて処理を引き取る */
  function handleNewMaster(value, t, apply) {
    if (String(value || '').indexOf(NEW_VALUE + ':') !== 0) return false;
    var mk = String(value).split(':')[1];
    if (!Masters.DEFS[mk].canEdit(me())) { UI.toast('登録の権限がありません', 'error'); redrawForm(t); return true; }
    Masters.openForm(mk, null, {
      onSaved: function (saved) { apply(saved.ID); redrawForm(t); }
    });
    /* ダイアログを閉じただけの場合に選択が残らないよう、いったん元に戻す */
    redrawForm(t);
    return true;
  }

  function lineCell(fk, i, c, v) {
    var a = 'data-line-field="' + E(fk) + '|' + i + '|' + E(c.key) + '"';
    if (c.type === 'date') return '<input type="date" ' + a + ' value="' + E(v || '') + '">';
    if (c.type === 'currency') return '<input ' + a + ' data-money="1" inputmode="numeric" style="text-align:right" value="' + E(v ? Number(v).toLocaleString('ja-JP') : '') + '">';
    if (c.type === 'number') return '<input type="number" ' + a + ' value="' + E(v || '') + '">';
    if (c.type === 'calc') return '<input ' + a + ' readonly style="text-align:right;background:var(--surface-2)" value="' + E(v || '') + '">';
    if (c.type === 'tax') return '<select ' + a + '>' + CFG.TAX.map(function (t) { return '<option' + (v === t.key ? ' selected' : '') + '>' + E(t.key) + '</option>'; }).join('') + '</select>';
    if (c.type === 'account') return '<select ' + a + '><option value="">—</option>' + S().accounts.map(function (x) { return '<option value="' + E(x.ID) + '"' + (String(v) === String(x.ID) ? ' selected' : '') + '>' + E(x.Account_Name) + '</option>'; }).join('') + addNewOpt('Accounts') + '</select>';
    if (c.type === 'vendor') return '<select ' + a + '><option value="">—</option>' + S().vendors.map(function (x) { return '<option value="' + E(x.ID) + '"' + (String(v) === String(x.ID) ? ' selected' : '') + '>' + E(x.Vendor_Name) + '</option>'; }).join('') + addNewOpt('Vendors') + '</select>';
    if (c.type === 'select') return '<select ' + a + '>' + (c.options || []).map(function (o) { return '<option' + (v === o ? ' selected' : '') + '>' + E(o) + '</option>'; }).join('') + '</select>';
    return '<input ' + a + ' value="' + E(v || '') + '">';
  }
  /* ---------- 添付ファイル ---------- */
  function filesHtml(f) {
    var staged = formState.pendingFiles.filter(function (x) { return x.fieldKey === f.key; });
    var rows = staged.length ? '<div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th>ファイル名</th><th class="num">サイズ</th>' +
      (f.denshicho ? '<th>取引年月日</th><th class="num">取引金額</th><th>取引先</th>' : '') +
      '<th style="width:36px"></th></tr></thead><tbody>' +
      staged.map(function (x, i) {
        return '<tr><td>' + E(x.file.name) + '</td>' +
          '<td class="num nowrap">' + Math.round(x.file.size / 1024) + ' KB</td>' +
          (f.denshicho ? '<td class="nowrap">' + E(UI.fmtDate(x.meta.tradeDate)) + '</td>' +
            '<td class="num nowrap">' + UI.yen(x.meta.tradeAmount) + '</td>' +
            '<td>' + E(x.meta.tradePartner) + '</td>' : '') +
          '<td><button type="button" class="line-del" data-delfile="' + E(f.key) + '|' + i + '" aria-label="削除">×</button></td></tr>';
      }).join('') + '</tbody></table></div>' :
      '<div class="page-sub">まだ添付されていません</div>';
    return rows +
      '<div class="inline-row" style="margin-top:8px">' +
      '<input type="file" id="fi_' + E(f.key) + '" accept="' + E(CFG.ATTACH.ACCEPT.join(',')) + '" style="display:none">' +
      '<button type="button" class="btn btn-sm" data-addfile="' + E(f.key) + '">📎 ファイルを添付</button>' +
      '<span class="page-sub">' + E(CFG.ATTACH.ACCEPT_LABEL) + '／1ファイル ' +
      Math.round(CFG.ATTACH.MAX_BYTES / 1024 / 1024) + 'MB まで／最大 ' + CFG.ATTACH.MAX_FILES + '点</span></div>';
  }

  function bindFiles(grid, t) {
    grid.querySelectorAll('[data-addfile]').forEach(function (b) {
      var key = b.dataset.addfile;
      var inp = grid.querySelector('#fi_' + key);
      b.addEventListener('click', function () { inp.value = ''; inp.click(); });
      inp.addEventListener('change', function () {
        var file = inp.files && inp.files[0]; if (!file) return;
        var f = (t.fields || []).filter(function (x) { return x.key === key; })[0] || {};
        var count = formState.pendingFiles.filter(function (x) { return x.fieldKey === key; }).length;
        var err = Files.validate(file, count);
        if (err) { UI.toast(err, 'error'); return; }
        if (f.denshicho) { askTradeInfo(file, function (meta) { stage(key, file, meta, t); }); }
        else { stage(key, file, {}, t); }
      });
    });
    grid.querySelectorAll('[data-delfile]').forEach(function (b) {
      b.addEventListener('click', function () {
        var p = b.dataset.delfile.split('|'), key = p[0], idx = Number(p[1]);
        var list = formState.pendingFiles.filter(function (x) { return x.fieldKey === key; });
        var target = list[idx];
        formState.pendingFiles = formState.pendingFiles.filter(function (x) { return x !== target; });
        redrawForm(t);
      });
    });
  }
  function stage(key, file, meta, t) {
    formState.pendingFiles.push({ fieldKey: key, file: file, meta: meta });
    redrawForm(t);
    UI.toast(file.name + ' を添付しました（申請時に保存されます）', 'success');
  }

  /** 電子帳簿保存法の検索要件（取引年月日・取引金額・取引先）を聞く */
  function askTradeInfo(file, done) {
    UI.modal({
      title: '取引情報の入力', okText: '添付する',
      bodyHtml:
        '<div class="page-sub" style="margin-bottom:10px">' + E(file.name) + '</div>' +
        '<div class="form-grid">' +
        '<div class="field"><label>取引年月日<span class="req">*</span></label><input id="td_date" type="date"></div>' +
        '<div class="field money"><label>取引金額<span class="req">*</span></label><input id="td_amt" data-money="1" inputmode="numeric"></div>' +
        '<div class="field full"><label>取引先<span class="req">*</span></label>' +
        '<input id="td_partner" list="td_vendors" placeholder="取引先名を入力または選択">' +
        '<datalist id="td_vendors">' + S().vendors.map(function (v) { return '<option value="' + E(v.Vendor_Name) + '">'; }).join('') + '</datalist>' +
        '</div></div>' +
        '<div class="page-sub" style="margin-top:10px">電子帳簿保存法の検索要件を満たすため、この3点を記録します。</div>',
      onOk: function (box) {
        var d = box.querySelector('#td_date').value;
        var a = UI.rawNum(box.querySelector('#td_amt').value);
        var v = box.querySelector('#td_partner').value.trim();
        if (!d || !a || !v) { UI.toast('取引年月日・取引金額・取引先はすべて必須です', 'error'); return false; }
        done({ tradeDate: d, tradeAmount: a, tradePartner: v });
      }
    });
    UI.bindMoneyInputs(document.querySelector('.modal'));
  }

  function bindLines(grid, t) {
    grid.querySelectorAll('[data-addline]').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.dataset.addline;
        formState.data[k] = (formState.data[k] || []).concat([{}]);
        redrawForm(t);
      });
    });
    grid.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        var tb = b.closest('tbody'); var k = tb.dataset.lines;
        formState.data[k].splice(Number(b.dataset.del), 1);
        if (!formState.data[k].length) formState.data[k] = [{}];
        redrawForm(t);
      });
    });
    grid.querySelectorAll('[data-line-field]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var p = inp.dataset.lineField.split('|');
        var k = p[0], i = Number(p[1]), c = p[2];
        /* 「＋ 新しく登録する…」を選んだときは、登録して戻ってきた ID をこのセルに入れる */
        if (handleNewMaster(inp.value, t, function (id) { formState.data[k][i][c] = id; })) return;
        var col = (t.fields.filter(function (f) { return f.key === k; })[0].columns || []).filter(function (x) { return x.key === c; })[0];
        formState.data[k][i][c] = (col && (col.type === 'currency' || col.type === 'number')) ? UI.rawNum(inp.value) : inp.value;
        /* 計算列の更新 */
        (t.fields.filter(function (f) { return f.key === k; })[0].columns || []).forEach(function (cc) {
          if (cc.type === 'calc' && cc.formula === 'qty*unit_price') {
            formState.data[k][i].amount = UI.rawNum(formState.data[k][i].qty) * UI.rawNum(formState.data[k][i].unit_price);
          }
        });
        redrawForm(t);
      });
    });
  }
  function redrawForm(t) {
    var grid = document.querySelector('#formGrid'); if (!grid) return;
    renderFields(grid, t);
    renderRoutePreview(document.querySelector('#routePrev'), t);
    renderPolicy(document.querySelector('#policyBox'), t);
    autosaveNote();
  }
  function onFieldChange(e) {
    var k = e.target.dataset.field;
    var f = (tplOf(formState.code).fields || []).filter(function (x) { return x.key === k; })[0] || {};
    var v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (handleNewMaster(v, tplOf(formState.code), function (id) { formState.data[k] = id; })) return;
    formState.data[k] = (f.type === 'currency') ? UI.rawNum(v) : v;
    renderRoutePreview(document.querySelector('#routePrev'), tplOf(formState.code));
    renderPolicy(document.querySelector('#policyBox'), tplOf(formState.code));
    autosaveNote();
  }
  function autosaveNote() {
    var el = document.querySelector('#autosave'); if (!el) return;
    clearTimeout(formState.saveTimer);
    formState.saveTimer = setTimeout(function () {
      DB.lsSet('draft_' + formState.code, formState.data);
      var d = new Date();
      el.textContent = '下書き自動保存 ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    }, 1200);
  }
  function renderRoutePreview(box, t) {
    if (!box) return;
    var amount = WF.amountOf(t, formState.data);
    var route = WF.buildRoute(t, formState.data, me(), S().employees, {
      data: formState.data, applicant: me(), amount: amount, template: t,
      attachmentCount: formState.pendingFiles.length
    });
    var needPick = route.filter(function (s) { return s.needsPick; });
    box.innerHTML = '<div class="page-sub" style="margin-bottom:10px">申請金額 <strong>' + UI.yen(amount) + '</strong> に基づく経路（入力に応じて自動で変わります）</div>' +
      '<div class="route">' + route.map(function (s) {
        return '<div class="route-step"><div class="route-dot' + (s.skipped ? '' : '') + '">' + s.step_no + '</div><div class="route-body">' +
          '<div class="route-name">' + E(s.name) + ' <span class="tag">' + E(s.type) + '</span></div>' +
          '<div class="route-meta">' + (s.skipped ? '<span class="delay">' + E(s.skipReason) + '</span>' :
            E(s.approverName) + (s.approverTitle ? '（' + E(s.approverTitle) + '）' : '') +
            (s.delegateName ? ' <span class="tag">代理：' + E(s.delegateName) + '</span>' : '') +
            ' ／ 標準 ' + s.days + '日' +
            ((s.escalate || {}).mode && s.escalate.mode !== 'none' ?
              '／' + s.escalate.afterDays + '日超過で' + RouteSpec.escalationDef(s.escalate.mode).label.replace(/（.*/, '') : '')) + '</div>' +
          (s.warning ? '<div class="route-meta"><span class="badge b-sentback">' + E(s.warning) + '</span></div>' : '') +
          (s.needsPick ?
            '<div style="margin-top:6px"><select data-pick="' + E(s.pickKey) + '" style="width:100%;min-height:32px;border:1px solid var(--border-strong);border-radius:6px;padding:4px 8px">' +
            '<option value="">承認者を選んでください</option>' +
            S().employees.filter(function (e) { return e.Is_Active !== false && String(e.ID) !== String(me().ID); })
              .map(function (e) {
                return '<option value="' + E(e.ID) + '"' + (String(formState.data[s.pickKey]) === String(e.ID) ? ' selected' : '') +
                  '>' + E(e.Employee_Name + '（' + (e.Department_name || '') + '／' + e.Title + '）') + '</option>';
              }).join('') + '</select></div>' : '') +
          '</div></div>';
      }).join('') + '</div>';
    box.querySelectorAll('[data-pick]').forEach(function (n) {
      n.addEventListener('change', function () {
        formState.data[n.dataset.pick] = n.value;
        renderRoutePreview(box, t);
      });
    });
  }
  function renderPolicy(box, t) {
    if (!box) return;
    var sens = CFG.ACCESS.SENSITIVITY[t.code] || 'C';
    var who = [];
    if (CFG.SCOPE_TYPES.finance.indexOf(t.code) >= 0) who.push('経理担当');
    if (CFG.SCOPE_TYPES.hr.indexOf(t.code) >= 0) who.push('人事担当');
    who.push('経路上の承認者');
    if (sens !== 'S') who.push('同一部署の上長');
    who.push('システム管理者');
    var v = (formState.data.vendor && App.vendorById(formState.data.vendor));
    box.innerHTML =
      '<div class="page-sub">機微度 ' + UI.sensBadge(t.code) + '</div>' +
      '<div style="margin-top:8px;font-size:12px">この申請を閲覧できるのは次の人です。<br><strong>' + E(who.join('・')) + '</strong></div>' +
      '<div style="margin-top:10px;font-size:11.5px;color:var(--text-muted)">開いた人・日時・滞在時間はすべて閲覧証跡に記録され、あなた自身も確認できます。</div>' +
      (v && !v.Is_Qualified ? '<div style="margin-top:10px" class="badge b-sentback">選択中の取引先は適格請求書発行事業者ではありません（仕入税額控除の対象外）</div>' : '');
  }

  function validate(t) {
    var errs = [];
    /* 申請者が承認者を選ぶ段があるのに未選択なら止める */
    var rt = WF.buildRoute(t, formState.data, me(), S().employees, {
      data: formState.data, applicant: me(), amount: WF.amountOf(t, formState.data),
      template: t, attachmentCount: formState.pendingFiles.length
    });
    rt.forEach(function (st) {
      if (st.needsPick && !formState.data[st.pickKey]) errs.push(st.name + 'の承認者');
    });
    document.querySelectorAll('.field').forEach(function (w) { w.classList.remove('err'); var m = w.querySelector('.err-msg'); if (m) { m.hidden = true; m.textContent = ''; } });
    (t.fields || []).forEach(function (f) {
      if (!f.required) return;
      var v = formState.data[f.key];
      var bad;
      if (f.type === 'lines') {
        bad = !(v && v.length && v.some(function (ln) { return Object.keys(ln).some(function (k) { return ln[k]; }); }));
      } else if (f.type === 'files') {
        bad = !formState.pendingFiles.some(function (x) { return x.fieldKey === f.key; });
      } else {
        bad = (v == null || v === '' || v === false);
      }
      if (bad) {
        errs.push(f.label);
        var w = document.querySelector('[data-wrap="' + f.key + '"]');
        if (w) { w.classList.add('err'); var m = w.querySelector('.err-msg'); if (m) { m.hidden = false; m.textContent = f.label + 'は必須です'; } }
      }
    });
    return errs;
  }

  function submit(t, asDraft) {
    if (App.blockIfImpersonating('申請')) return;
    if (!asDraft) {
      var errs = validate(t);
      if (errs.length) {
        /* 以前は3件までしか出さず、画面外の項目だと何を直せばよいか分からなかった。
           全部を並べたうえで、最初の未入力欄まで画面を送る。 */
        UI.modal({
          title: '入力がそろっていません', okText: '入力に戻る', hideCancel: true,
          bodyHtml: '<div class="page-sub" style="margin-bottom:10px">次の項目を入れてから申請してください。</div>' +
            '<ul style="margin:0;padding-left:20px;font-size:13px;line-height:2">' +
            errs.map(function (x) { return '<li>' + E(x) + '</li>'; }).join('') + '</ul>' +
            '<div class="page-sub" style="margin-top:10px">ここまでの入力は「下書き保存」で残せます。</div>'
        });
        var first = document.querySelector('.field.err');
        if (first) {
          first.scrollIntoView({ behavior: 'smooth', block: 'center' });
          var fi = first.querySelector('input,select,textarea');
          if (fi) setTimeout(function () { fi.focus(); }, 300);
        }
        return;
      }
    }
    var data = formState.data;
    var amount = WF.amountOf(t, data);
    if (amount < 0) { UI.toast('金額にマイナスは指定できません', 'error'); return; }
    var route = WF.buildRoute(t, data, me(), S().employees, {
      data: data, applicant: me(), amount: amount, template: t,
      attachmentCount: formState.pendingFiles.length
    });
    /* 生きた承認段が1つも無いまま申請すると、誰の承認トレイにも出ず永久に止まる。
       送信前に止めて、なぜ経路が組めなかったかを本人に見せる。 */
    if (!asDraft && !WF.isRoutable(route)) {
      var why = route.length
        ? route.map(function (s) { return '・' + s.step_no + '段目「' + s.name + '」：' + (s.skipReason || '条件に合いません'); }).join('<br>')
        : '・この申請区分に、条件を満たす承認ステップが1つもありません';
      var canFix = Perm.isAdmin(me());
      UI.modal({
        title: '承認者が決まらないため申請できません',
        okText: canFix ? '社員マスタを開く' : '下書きとして保存する',
        cancelText: '入力に戻る',
        bodyHtml: '<div class="page-sub" style="margin-bottom:10px">次の理由で承認経路を組めませんでした。</div>' +
          '<div style="font-size:12.5px;line-height:1.9">' + why + '</div>' +
          '<div class="page-sub" style="margin-top:12px">' +
          (canFix
            ? '社員マスタで役職と上長を登録すると、経路が自動で組まれます。'
            : '社員マスタの役職・上長が未登録の可能性があります。システム管理者にご連絡ください。') +
          '　入力内容は「下書きとして保存」で残せます。</div>',
        onOk: function () {
          if (canFix) { App.go('admin?tab=Employees'); return; }
          submit(t, true);
        }
      });
      return;
    }
    var status = asDraft ? CFG.STATUS.DRAFT : CFG.STATUS.ACTIVE;
    var subject = data.subject || data.emp_name || (t.name + '（' + UI.fmtDate(new Date().toISOString()) + '）');
    var req = {
      Request_No: App.nextRequestNo(),
      Type_Code: t.code, Request_Type_name: t.name, Subject: subject,
      Applicant: me().ID, Applicant_name: me().Employee_Name,
      Applicant_Dept: me().Department_name, Applicant_Dept_name: me().Department_name,
      Amount: amount, Status: status,
      Applied_On: asDraft ? '' : DB.nowISO(), Completed_On: '',
      Current_Step: asDraft ? 0 : WF.currentStep(route),
      Route_JSON: JSON.stringify(route), Form_Data_JSON: JSON.stringify(data),
      Paid: false, Journal_Exported: false
    };
    DB.add('Requests', req).then(function (saved) {
      S().requests.push(saved);
      var jobs = route.map(function (s) {
        /* 期限は「その段に回ってきた時点」で確定する。
           申請時に全段ぶん書くと、後の段ほど期限が早いという不整合になる。 */
        var due = (s.step_no === WF.currentStep(route)) ? WF.dueDateOf(req, route, s) : null;
        return DB.add('Approvals', {
          Request: saved.ID, Request_No: saved.Request_No,
          Step_No: s.step_no, Step_Name: s.name, Step_Type: s.type,
          Approver: s.approverId, Approver_name: s.approverName,
          Action: s.skipped ? CFG.ACTION.SKIP : CFG.ACTION.PENDING,
          Comment: s.skipReason || '', Is_Delegate: !!s.delegateId,
          Due_Date: due ? due.toISOString().slice(0, 10) : ''
        }).then(function (a) { S().approvals.push(a); });
      });
      return Promise.all(jobs).then(function () { return saved; });
    }).then(function (saved) {
      /* 申請レコードが出来てから添付を保存する（分割保存のため直列に実行） */
      var pend = formState.pendingFiles.slice();
      if (!pend.length) return saved;
      UI.toast('添付を保存しています…');
      var i = 0;
      function next() {
        if (i >= pend.length) return Promise.resolve(saved);
        var x = pend[i++];
        return Files.upload(x.file, x.meta, saved).then(next);
      }
      return next().then(function () { formState.pendingFiles = []; return saved; });
    }).then(function (saved) {
      App.audit(asDraft ? '下書き保存' : '申請', '申請', saved.ID, saved.Request_No + ' ' + subject + '（' + UI.yen(amount) + '）');
      UI.toast(asDraft ? '下書きを保存しました' : '申請しました。承認者に通知されます。', 'success');
      App.go('mine');
    }).catch(function (e) {
      UI.toast('保存に失敗しました：' + (e && e.message ? e.message : e), 'error');
    });
  }

  /* =======================================================================
   * 自分の申請
   * ===================================================================== */
  function mine(el) {
    var tab = App.param('tab') || 'すべて';
    var rows = S().requests.filter(function (r) { return String(r.Applicant) === String(me().ID); });
    var counts = { 'すべて': rows.length };
    [CFG.STATUS.DRAFT, CFG.STATUS.ACTIVE, CFG.STATUS.SENTBACK, CFG.STATUS.APPROVED, CFG.STATUS.REJECTED].forEach(function (s) {
      counts[s] = rows.filter(function (r) { return r.Status === s; }).length;
    });
    var shown = tab === 'すべて' ? rows : rows.filter(function (r) { return r.Status === tab; });
    shown.sort(function (a, b) { return new Date(b.Applied_On || 0) - new Date(a.Applied_On || 0); });

    /* ログイン直後に最初に開く画面。
       「自分が出したもの」と「自分が止めているもの」が一目で分かるようにする。 */
    var pending = myPendingSteps();
    var todo = '';
    if (pending.length) {
      todo =
        '<div class="card" style="border-color:var(--warning);margin-bottom:14px">' +
        '<div class="card-head"><div class="card-title">あなたの承認待ち ' + pending.length + ' 件</div>' +
        '<button class="btn btn-sm btn-primary" data-go="inbox" style="margin-left:auto">承認画面を開く</button></div>' +
        '<div class="card-body" style="padding-top:0">' +
        requestTable(pending.map(function (x) { return x.req; }), false) + '</div></div>';
    }
    /* セットアップの案内は、申請と承認より下に置く。
       毎日開く画面の一番上に手順が居座ると、本来の用事が押し下がる。 */
    var setupCard = (typeof Setup !== 'undefined' && Perm.isAdmin(me())) ? Setup.progressCard() : '';

    el.innerHTML = pageHead('マイページ', me().Employee_Name + ' さん（' + (me().Department_name || '所属未設定') + '／' +
      (me().Title || '役職未設定') + '）｜' + Perm.normalizeRoles(me().Roles || [])[0],
      '<button class="btn btn-primary" data-go="new">＋ 新規申請</button>') +
      todo +
      '<div class="card-title" style="margin:4px 0 8px">自分の申請</div>' +
      '<div class="tabs">' + Object.keys(counts).map(function (k) {
        return '<button class="tab' + (k === tab ? ' active' : '') + '" data-tab="' + E(k) + '">' + E(k) + '<span class="n">' + counts[k] + '</span></button>';
      }).join('') + '</div>' +
      '<div class="card">' + requestTable(shown, true) + '</div>' +
      setupCard;
    bindTable(el);
    if (setupCard) Setup.bindProgress(el);
    el.querySelectorAll('[data-tab]').forEach(function (b) { b.addEventListener('click', function () { App.go('mine?tab=' + encodeURIComponent(b.dataset.tab)); }); });
    el.querySelectorAll('[data-go]').forEach(function (b) { b.addEventListener('click', function () { App.go(b.dataset.go); }); });
    Access.log(CFG.ACCESS.ACTIONS.VIEW_LIST, { targetType: '自分の申請', resultCount: shown.length, detail: 'タブ：' + tab });
  }

  function requestTable(rows, showViews) {
    if (!rows.length) return UI.empty('📭', '該当する申請はありません', '条件を変えるか、新しく申請してください');
    var viewCount = {};
    if (showViews) {
      S().accessLogs.forEach(function (l) {
        if (l.Action === CFG.ACCESS.ACTIONS.VIEW_DETAIL && String(l.Actor) !== String(me().ID)) viewCount[l.Target_ID] = (viewCount[l.Target_ID] || 0) + 1;
      });
    }
    return '<div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th>申請番号</th><th>区分</th><th>件名</th><th>申請者</th><th class="num">金額</th><th>ステータス</th><th>現在の承認者</th><th>申請日</th>' +
      (showViews ? '<th class="num">閲覧</th>' : '') + '</tr></thead><tbody>' +
      rows.map(function (r) {
        var route = routeOf(r), cur = WF.currentStep(route);
        var step = route.filter(function (s) { return s.step_no === cur; })[0];
        var delayed = step && WF.isDelayed(r, step, route);
        return '<tr data-req="' + E(r.ID) + '"><td class="nowrap">' + E(r.Request_No) + '</td>' +
          '<td class="nowrap"><span class="tag">' + E((tplOf(r.Type_Code) || {}).name || r.Type_Code) + '</span></td>' +
          '<td>' + E(r.Subject) + '</td><td class="nowrap">' + E(r.Applicant_name) + '</td>' +
          '<td class="num nowrap">' + UI.yen(r.Amount) + '</td><td class="nowrap">' + UI.statusBadge(r.Status) + '</td>' +
          '<td class="nowrap">' + (step ? E(step.approverName) + (delayed ? ' <span class="delay">遅延</span>' : '') : '—') + '</td>' +
          '<td class="nowrap">' + E(UI.fmtDate(r.Applied_On)) + '</td>' +
          (showViews ? '<td class="num nowrap">' + (viewCount[r.ID] ? '<span class="badge b-info">' + viewCount[r.ID] + '</span>' : '—') + '</td>' : '') +
          '</tr>';
      }).join('') + '</tbody></table></div>';
  }
  function bindTable(el) {
    el.querySelectorAll('[data-req]').forEach(function (tr) {
      tr.addEventListener('click', function () { openDetail(tr.dataset.req); });
    });
  }

  /* =======================================================================
   * 承認する（マイタスク）
   * ===================================================================== */
  function inbox(el) {
    var pending = myPendingSteps();
    var doneIds = {};
    S().approvals.forEach(function (a) { if (String(a.Acted_By) === String(me().ID)) doneIds[a.Request] = a; });
    var done = S().requests.filter(function (r) { return doneIds[r.ID]; })
      .sort(function (a, b) { return new Date(doneIds[b.ID].Acted_On || 0) - new Date(doneIds[a.ID].Acted_On || 0); }).slice(0, 60);
    var tab = App.param('tab') || 'pending';

    el.innerHTML = pageHead('承認する', 'あなたが処理すべき申請の一覧です',
      (tab === 'pending' && pending.length ? '<button class="btn btn-success" data-act="bulk">選択した申請を一括承認</button>' : '')) +
      '<div class="tabs">' +
      '<button class="tab' + (tab === 'pending' ? ' active' : '') + '" data-tab="pending">未処理<span class="n">' + pending.length + '</span></button>' +
      '<button class="tab' + (tab === 'done' ? ' active' : '') + '" data-tab="done">処理済<span class="n">' + done.length + '</span></button></div>' +
      '<div class="card">' + (tab === 'pending' ? pendingTable(pending) : requestTable(done, false)) + '</div>';

    el.querySelectorAll('[data-tab]').forEach(function (b) { b.addEventListener('click', function () { App.go('inbox?tab=' + b.dataset.tab); }); });
    bindTable(el);
    var bulk = el.querySelector('[data-act="bulk"]');
    if (bulk) bulk.addEventListener('click', function () { bulkApprove(el); });
    el.querySelectorAll('.checkcell input').forEach(function (c) { c.addEventListener('click', function (e) { e.stopPropagation(); }); });
    Access.log(CFG.ACCESS.ACTIONS.VIEW_LIST, { targetType: '承認トレイ', resultCount: pending.length });
  }
  function pendingTable(pending) {
    if (!pending.length) return UI.empty('✅', '未処理の承認はありません', 'あなたの処理待ちはすべて片付いています');
    return '<div class="table-wrap"><table class="tbl"><thead><tr><th class="checkcell"><input type="checkbox" data-all></th>' +
      '<th>申請番号</th><th>区分</th><th>件名</th><th>申請者</th><th class="num">金額</th><th>あなたの役割</th><th>経過</th></tr></thead><tbody>' +
      pending.map(function (p) {
        var delayed = WF.isDelayed(p.req, p.step, routeOf(p.req));
        var isDel = p.step.delegateId && String(p.step.delegateId) === String(me().ID);
        return '<tr data-req="' + E(p.req.ID) + '"><td class="checkcell"><input type="checkbox" data-pick="' + E(p.req.ID) + '"></td>' +
          '<td class="nowrap">' + E(p.req.Request_No) + '</td>' +
          '<td class="nowrap"><span class="tag">' + E((tplOf(p.req.Type_Code) || {}).name || '') + '</span> ' + UI.sensBadge(p.req.Type_Code) + '</td>' +
          '<td>' + E(p.req.Subject) + '</td><td class="nowrap">' + E(p.req.Applicant_name) + '<div class="page-sub">' + E(p.req.Applicant_Dept_name) + '</div></td>' +
          '<td class="num nowrap">' + UI.yen(p.req.Amount) + '</td>' +
          '<td class="nowrap">' + E(p.step.name) + ' <span class="tag">' + E(p.step.type) + '</span>' + (isDel ? '<span class="tag">代理</span>' : '') +
          (p.viaEscalation ? ' <span class="badge b-sentback">期限超過で回付</span>' : '') + '</td>' +
          '<td class="nowrap">' + (delayed ? '<span class="delay">遅延' + WF.overdueDays(p.req, p.step, routeOf(p.req)) + '日</span>' : UI.relTime(p.req.Applied_On)) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function bulkApprove(el) {
    var ids = Array.prototype.slice.call(el.querySelectorAll('[data-pick]:checked')).map(function (c) { return c.dataset.pick; });
    if (!ids.length) { UI.toast('申請を選択してください', 'warn'); return; }
    UI.modal({
      title: ids.length + ' 件を一括承認', okText: '承認する', okClass: 'btn-success',
      bodyHtml: '<div class="field"><label>共通コメント</label><textarea id="bulkC" placeholder="内容を確認しました。"></textarea></div>' +
        '<div class="page-sub">一括承認も1件ずつ承認証跡・閲覧証跡に記録されます。</div>',
      onOk: function (box) {
        var c = box.querySelector('#bulkC').value;
        Promise.all(ids.map(function (id) { return act(id, CFG.ACTION.APPROVE, c, null, true); }))
          .then(function () { UI.toast(ids.length + ' 件を承認しました', 'success'); App.refresh(); });
      }
    });
  }

  /* =======================================================================
   * 申請詳細（ドロワー）＋ 閲覧者タブ
   * ===================================================================== */
  function openDetail(id) {
    var req = App.requestById(id);
    if (!req) { UI.toast('申請が見つかりません', 'error'); return; }
    if (!Perm.canViewRequest(me(), req, S().approvals)) {
      Access.denied('申請', req.Request_No + ' への閲覧権限なし');
      UI.toast('この申請を閲覧する権限がありません（アクセス拒否として記録しました）', 'error');
      return;
    }
    var t = tplOf(req.Type_Code) || { fields: [], name: req.Type_Code };
    Access.openDetail(req, t.name);

    var route = routeOf(req), data = dataOf(req), cur = WF.currentStep(route);
    var step = route.filter(function (s) { return s.step_no === cur; })[0];
    var actOpt = { req: req, route: route, employees: S().employees };
    var canActNow = req.Status === CFG.STATUS.ACTIVE && step && WF.canAct(step, me().ID, actOpt) && !step.action;
    var viaEsc = canActNow && String(step.approverId) !== String(me().ID) &&
      !(step.delegateId && String(step.delegateId) === String(me().ID)) &&
      !(step.members || []).some(function (m) { return String(m.id) === String(me().ID); });
    var isMine = String(req.Applicant) === String(me().ID);

    var body =
      '<div class="print-title">' + E(t.name) + '</div>' +
      '<div class="card" style="margin-bottom:14px"><div class="card-body">' +
      '<div class="inline-row" style="margin-bottom:10px">' + UI.statusBadge(req.Status) + UI.sensBadge(req.Type_Code) +
      '<span class="tag">' + E(req.Request_No) + '</span><span class="tag">' + E(t.name) + '</span></div>' +
      '<div style="font-size:16px;font-weight:700">' + E(req.Subject) + '</div>' +
      '<dl class="dl" style="margin-top:12px">' +
      '<dt>申請者</dt><dd>' + E(req.Applicant_name) + '（' + E(req.Applicant_Dept_name) + '）</dd>' +
      '<dt>申請日</dt><dd>' + E(UI.fmtDateTime(req.Applied_On)) + '</dd>' +
      '<dt>金額</dt><dd><strong>' + UI.yen(req.Amount) + '</strong></dd>' +
      '<dt>完了日</dt><dd>' + E(UI.fmtDateTime(req.Completed_On)) + '</dd>' +
      '</dl></div></div>' +
      '<div class="tabs" id="dtabs">' +
      '<button class="tab active" data-dt="content">申請内容</button>' +
      '<button class="tab" data-dt="route">承認経路・履歴</button>' +
      '<button class="tab" data-dt="views">閲覧者<span class="n" id="vcount"></span></button>' +
      '</div><div id="dbody"></div>';

    var foot = '';
    if (canActNow && viaEsc) {
      body = body.replace('<div class="tabs" id="dtabs">',
        '<div class="badge b-sentback" style="display:block;padding:8px 12px;margin-bottom:12px;font-size:12px">' +
        'この申請は、本来の承認者（' + E(step.approverName) + '）の期限超過により、あなたにも承認できるようになっています。' +
        'あなたが承認した場合、その記録が残ります。</div><div class="tabs" id="dtabs">');
    }
    if (canActNow) {
      foot = '<button class="btn btn-success" data-a="approve">承認</button>' +
        '<button class="btn" data-a="cond">条件付承認</button>' +
        '<button class="btn btn-warning" data-a="sendback">差戻し</button>' +
        '<button class="btn btn-danger" data-a="reject">却下</button>';
      if (step.type === '回覧') foot = '<button class="btn btn-primary" data-a="read">既読にする</button>';
    } else if (isMine && (req.Status === CFG.STATUS.DRAFT || req.Status === CFG.STATUS.SENTBACK)) {
      foot = '<button class="btn btn-primary" data-a="edit">修正して再申請</button>' +
        '<button class="btn" data-a="cancel">取下げ</button>';
    } else if (isMine && req.Status === CFG.STATUS.ACTIVE) {
      foot = '<button class="btn" data-a="pullback">引き戻す</button>';
    }
    if (Perm.canExport(me())) foot += '<button class="btn btn-sm" data-a="csv" style="margin-left:auto">この申請をCSV出力</button>';

    var el = UI.drawer(req.Request_No + '　' + req.Subject, body, foot,
      function () { Access.closeDetail(req); },
      function () {
        Access.log(CFG.ACCESS.ACTIONS.PRINT, {
          targetType: '申請', targetId: req.ID, targetNo: req.Request_No,
          targetSubject: req.Subject, typeCode: req.Type_Code,
          ownerDept: req.Applicant_Dept_name, detail: '申請書を印刷'
        });
      });
    var dbody = el.querySelector('#dbody');
    function paint(which) {
      if (which === 'content') dbody.innerHTML = contentHtml(t, data, req);
      else if (which === 'route') dbody.innerHTML = routeHtml(req, route);
      else dbody.innerHTML = viewsHtml(req);
      if (which === 'views') Access.log(CFG.ACCESS.ACTIONS.VIEW_LOG, { targetType: '申請の閲覧者一覧', targetId: req.ID, targetNo: req.Request_No });
      dbody.querySelectorAll('[data-dlfile]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (App.blockIfImpersonating('添付ファイルの取得')) return;
          if (!Perm.canViewRequest(me(), req, S().approvals)) {
            Access.denied('添付ファイルの取得', req.Request_No + ' への閲覧権限なし');
            UI.toast('この添付を取得する権限がありません（記録しました）', 'error'); return;
          }
          b.disabled = true; b.textContent = '取得中…';
          Files.download(b.dataset.dlfile, req).then(function (h) {
            UI.toast(h.File_Name + ' を取得しました', 'success');
          }).catch(function (e) {
            UI.toast('取得に失敗しました：' + (e && e.message ? e.message : e), 'error');
          }).then(function () { b.disabled = false; b.textContent = '取得'; });
        });
      });
    }
    paint('content');
    el.querySelector('#vcount').textContent = S().accessLogs.filter(function (l) { return String(l.Target_ID) === String(req.ID) && l.Action === CFG.ACCESS.ACTIONS.VIEW_DETAIL; }).length;
    el.querySelectorAll('[data-dt]').forEach(function (b) {
      b.addEventListener('click', function () {
        el.querySelectorAll('[data-dt]').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active'); paint(b.dataset.dt);
      });
    });
    el.querySelectorAll('[data-a]').forEach(function (b) {
      b.addEventListener('click', function () { onDetailAction(b.dataset.a, req, step, t); });
    });
  }

  function contentHtml(t, data, req) {
    var rows = (t.fields || []).map(function (f) {
      if (f.type === 'lines') return '';
      var v = data[f.key];
      if (f.type === 'currency') v = UI.yen(v);
      else if (f.type === 'date') v = UI.fmtDate(v);
      else if (f.type === 'checkbox') v = v ? 'はい' : 'いいえ';
      else if (f.type === 'vendor') { var ven = App.vendorById(v); v = ven ? ven.Vendor_Name + (ven.Is_Qualified ? '（登録番号 ' + ven.Invoice_Reg_No + '）' : '（未登録事業者）') : '—'; }
      else if (f.type === 'account') { var ac = App.accountById(v); v = ac ? ac.Account_Code + ' ' + ac.Account_Name : '—'; }
      else if (f.type === 'employee') v = empName(v) || '—';
      return '<dt>' + E(f.label) + '</dt><dd>' + E(v || '—') + '</dd>';
    }).join('');
    var lines = (t.fields || []).filter(function (f) { return f.type === 'lines'; }).map(function (f) {
      var ls = data[f.key] || [], sum = WF.sumLines(ls, f.columns);
      if (!ls.length) return '';
      return '<div class="card" style="margin-top:14px"><div class="card-head"><div class="card-title">' + E(f.label) + '</div></div>' +
        '<div class="table-wrap"><table class="tbl"><thead><tr>' + f.columns.map(function (c) { return '<th>' + E(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        ls.map(function (ln) {
          return '<tr>' + f.columns.map(function (c) {
            var v = ln[c.key];
            if (c.type === 'currency' || c.type === 'calc') v = UI.yen(v);
            else if (c.type === 'date') v = UI.fmtDate(v);
            else if (c.type === 'vendor') { var ven = App.vendorById(v); v = ven ? ven.Vendor_Name : '—'; }
            else if (c.type === 'account') { var ac = App.accountById(v); v = ac ? ac.Account_Name : '—'; }
            return '<td' + (c.type === 'currency' || c.type === 'calc' ? ' class="num"' : '') + '>' + E(v || '—') + '</td>';
          }).join('') + '</tr>';
        }).join('') +
        '<tr class="sum-row"><td colspan="' + (f.columns.length - 1) + '">合計（うち消費税 ' + UI.yen(sum.tax) + '）</td><td class="num">' + UI.yen(sum.total) + '</td></tr>' +
        '</tbody></table></div></div>';
    }).join('');
    return '<div class="card"><div class="card-body"><dl class="dl">' + rows + '</dl></div></div>' + lines + attachHtml(req);
  }

  /** 添付ファイルの一覧（ダウンロードは証跡に残る） */
  function attachHtml(req) {
    var files = Files.listFor(req.ID);
    var denshicho = Files.needsTradeInfo(req.Type_Code);
    if (!files.length) {
      return '<div class="card" style="margin-top:14px"><div class="card-head"><div class="card-title">添付ファイル</div></div>' +
        '<div class="card-body"><div class="page-sub">添付はありません</div></div></div>';
    }
    return '<div class="card" style="margin-top:14px"><div class="card-head"><div class="card-title">添付ファイル（' + files.length + '件）</div>' +
      '<span class="tag" style="margin-left:auto">取得は証跡に記録されます</span></div>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>ファイル名</th><th class="num">サイズ</th>' +
      (denshicho ? '<th>取引年月日</th><th class="num">取引金額</th><th>取引先</th>' : '') +
      '<th>登録者</th><th style="width:96px"></th></tr></thead><tbody>' +
      files.map(function (f) {
        return '<tr><td>' + E(f.File_Name) + '</td>' +
          '<td class="num nowrap">' + Math.round((f.File_Size || 0) / 1024) + ' KB</td>' +
          (denshicho ? '<td class="nowrap">' + E(UI.fmtDate(f.Trade_Date)) + '</td>' +
            '<td class="num nowrap">' + UI.yen(f.Trade_Amount) + '</td>' +
            '<td>' + E(f.Trade_Partner || '—') + '</td>' : '') +
          '<td class="nowrap">' + E(f.Uploaded_By_Name || '') + '<div class="page-sub">' + E(UI.fmtDate(f.Uploaded_At)) + '</div></td>' +
          '<td class="nowrap"><button class="btn btn-sm" data-dlfile="' + E(f.File_Key) + '">取得</button></td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  function routeHtml(req, route) {
    var cur = WF.currentStep(route);
    var stamps = route.filter(function (s) { return s.action === CFG.ACTION.APPROVE || s.action === CFG.ACTION.COND; });
    return '<div class="card"><div class="card-head"><div class="card-title">承認経路</div>' +
      (stamps.length ? '<div class="hanko-row" style="margin-left:auto">' + stamps.map(function (s) { return UI.hanko(s.acted_by_name || s.approverName, false); }).join('') + '</div>' : '') +
      '</div><div class="card-body"><div class="route">' +
      route.map(function (s) {
        var cls = s.skipped ? '' : (s.action === CFG.ACTION.REJECT ? 'rejected' : (s.action ? 'done' : (s.step_no === cur ? 'current' : '')));
        var mark = s.skipped ? '–' : (s.action === CFG.ACTION.APPROVE || s.action === CFG.ACTION.COND ? '✓' : (s.action === CFG.ACTION.REJECT ? '✕' : (s.action === CFG.ACTION.SENDBACK ? '↩' : (s.action === CFG.ACTION.READ ? '👁' : s.step_no))));
        var meta = s.skipped ? s.skipReason
          : (s.action ? (s.acted_by_name || s.approverName) + ' が ' + s.action + '　' + UI.fmtDateTime(s.acted_on)
            : (s.approverName + (s.approverTitle ? '（' + s.approverTitle + '）' : '') + (s.delegateName ? '／代理：' + s.delegateName : '') + '　標準' + s.days + '日'));
        var need = (s.type === '合議') ? '（' + ((s.approvedBy || []).length) + '/' + ((s.members || []).length || 1) + '名 承認済）' : '';
        return '<div class="route-step"><div class="route-dot ' + cls + '">' + E(String(mark)) + '</div><div class="route-body">' +
          '<div class="route-name">' + E(s.name) + ' <span class="tag">' + E(s.type) + '</span>' + E(need) + '</div>' +
          '<div class="route-meta">' + E(meta) + '</div>' +
          (s.warning ? '<div class="route-meta"><span class="badge b-sentback">⚠ ' + E(s.warning) + '</span></div>' : '') +
          (s.comment ? '<div class="route-comment">' + E(s.comment) + '</div>' : '') + '</div></div>';
      }).join('') + '</div></div></div>';
  }

  /** 閲覧者タブ：この申請を誰がいつ何回見たか */
  function viewsHtml(req) {
    var logs = S().accessLogs.filter(function (l) { return String(l.Target_ID) === String(req.ID); })
      .sort(function (a, b) { return new Date(b.Log_Time) - new Date(a.Log_Time); });
    if (!logs.length) return '<div class="card"><div class="card-body">' + UI.empty('👀', 'まだ誰も閲覧していません', '') + '</div></div>';
    var by = {};
    logs.forEach(function (l) {
      var k = l.Actor || l.Actor_Name;
      by[k] = by[k] || { name: l.Actor_Name, dept: l.Actor_Dept, role: l.Actor_Role, count: 0, last: l.Log_Time, actions: {}, cross: l.Cross_Dept };
      by[k].count++; by[k].actions[l.Action] = (by[k].actions[l.Action] || 0) + 1;
      if (new Date(l.Log_Time) > new Date(by[k].last)) by[k].last = l.Log_Time;
    });
    var people = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.count - a.count; });
    var summary = '<div class="card" style="margin-bottom:14px"><div class="card-head"><div class="card-title">閲覧者サマリ（' + people.length + '名 / 延べ' + logs.length + '件）</div></div>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>氏名</th><th>所属</th><th>権限</th><th class="num">回数</th><th>内訳</th><th>最終閲覧</th></tr></thead><tbody>' +
      people.map(function (p) {
        return '<tr><td class="nowrap">' + E(p.name) + (p.cross ? ' <span class="badge b-sentback">他部署</span>' : '') + '</td>' +
          '<td class="nowrap">' + E(p.dept) + '</td><td class="nowrap">' + E(p.role) + '</td>' +
          '<td class="num">' + p.count + '</td>' +
          '<td>' + Object.keys(p.actions).map(function (a) { return '<span class="tag">' + E(a) + ' ' + p.actions[a] + '</span>'; }).join(' ') + '</td>' +
          '<td class="nowrap">' + E(UI.fmtDateTime(p.last)) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
    var detail = '<div class="card"><div class="card-head"><div class="card-title">閲覧証跡（明細）</div></div>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>日時</th><th>氏名</th><th>操作</th><th>滞在</th><th>備考</th></tr></thead><tbody>' +
      logs.slice(0, 80).map(function (l) {
        return '<tr><td class="nowrap">' + E(UI.fmtDateTime(l.Log_Time)) + '</td><td class="nowrap">' + E(l.Actor_Name) + '</td>' +
          '<td class="nowrap"><span class="tag">' + E(l.Action) + '</span></td>' +
          '<td class="nowrap">' + (l.Duration_Sec ? E(l.Duration_Sec) + '秒' : '—') + '</td>' +
          '<td>' + E(l.Detail || '') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
    return summary + detail;
  }

  /* ---------- 詳細画面のアクション ---------- */
  function onDetailAction(a, req, step, t) {
    if (a === 'csv') { exportRequests([req], '申請_' + req.Request_No); return; }
    if (a === 'edit') { UI.closeDrawer(); App.go('form/' + req.Type_Code + '?edit=' + req.ID); return; }
    if (a === 'cancel') {
      UI.confirmBox('取下げ', 'この申請を取り下げます。よろしいですか？', '取り下げる', 'btn-danger').then(function (ok) {
        if (!ok) return;
        DB.update('Requests', req.ID, { Status: CFG.STATUS.CANCELED }).then(function () {
          req.Status = CFG.STATUS.CANCELED;
          App.audit('取下げ', '申請', req.ID, req.Request_No);
          UI.toast('取り下げました', 'success'); UI.closeDrawer(); App.refresh();
        });
      });
      return;
    }
    if (a === 'pullback') {
      var route = routeOf(req);
      var acted = route.some(function (s) { return s.action; });
      if (acted) { UI.toast('すでに承認処理が開始されているため引き戻せません', 'warn'); return; }
      DB.update('Requests', req.ID, { Status: CFG.STATUS.DRAFT, Applied_On: '' }).then(function () {
        req.Status = CFG.STATUS.DRAFT; req.Applied_On = '';
        App.audit('引き戻し', '申請', req.ID, req.Request_No);
        UI.toast('引き戻しました。下書きに戻ります。', 'success'); UI.closeDrawer(); App.refresh();
      });
      return;
    }
    var map = { approve: CFG.ACTION.APPROVE, reject: CFG.ACTION.REJECT, sendback: CFG.ACTION.SENDBACK, cond: CFG.ACTION.COND, read: CFG.ACTION.READ };
    var action = map[a]; if (!action) return;
    var needComment = (action === CFG.ACTION.REJECT || action === CFG.ACTION.SENDBACK || action === CFG.ACTION.COND);
    var route2 = routeOf(req);
    var backOpts = route2.filter(function (s) { return s.step_no < step.step_no && !s.skipped; });
    UI.modal({
      title: action + 'する', okText: action + 'する',
      okClass: action === CFG.ACTION.REJECT ? 'btn-danger' : (action === CFG.ACTION.SENDBACK ? 'btn-warning' : 'btn-success'),
      bodyHtml:
        '<div class="field"><label>コメント' + (needComment ? '<span class="req">*</span>' : '') + '</label>' +
        '<textarea id="cmt" placeholder="' + (action === CFG.ACTION.REJECT ? '却下理由を記入してください' : '内容を確認しました。') + '"></textarea></div>' +
        (action === CFG.ACTION.SENDBACK ?
          '<div class="field"><label>差戻し先</label><select id="backTo"><option value="">申請者へ差し戻す</option>' +
          backOpts.map(function (s) { return '<option value="' + s.step_no + '">' + E(s.step_no + '. ' + s.name + '（' + s.approverName + '）へ') + '</option>'; }).join('') +
          '</select></div>' : '') +
        '<div class="page-sub">処理内容・日時・あなたの氏名が証跡として記録されます。</div>',
      onOk: function (box) {
        var c = box.querySelector('#cmt').value.trim();
        if (needComment && !c) { UI.toast('コメントは必須です', 'error'); return false; }
        var backTo = box.querySelector('#backTo') ? box.querySelector('#backTo').value : null;
        act(req.ID, action, c, backTo ? Number(backTo) : null).then(function () {
          UI.toast(action + 'しました', 'success'); UI.closeDrawer(); App.refresh();
        });
      }
    });
  }

  /** 承認処理の実体 */
  function act(reqId, action, comment, backToStep, silent) {
    if (App.blockIfImpersonating('承認操作')) return Promise.resolve();
    var req = App.requestById(reqId);
    var route = routeOf(req);
    var cur = WF.currentStep(route);
    /* 画面を開いてから他の承認者が処理して段が進んでいることがある。
       押した瞬間に取り直して、自分がその段の担当かを必ず再確認する。 */
    var step = route.filter(function (s) { return s.step_no === cur; })[0];
    if (!step || step.action) {
      Access.denied('承認操作', req.Request_No + '：すでに処理済みの段に対する操作');
      UI.toast('この申請はすでに処理されています。画面を更新します。', 'warn');
      return Promise.resolve().then(function () { App.refresh(); });
    }
    if (!WF.canAct(step, me().ID, { req: req, route: route, employees: S().employees })) {
      Access.denied('承認操作', req.Request_No + ' ' + cur + '段目：担当ではない利用者による ' + action);
      UI.toast('この段の承認者はあなたではありません（記録しました）', 'error');
      return Promise.resolve().then(function () { App.refresh(); });
    }
    var res = WF.applyAction(req, route, cur, me().ID, me().Employee_Name, action, comment, backToStep);
    var patch = {
      Route_JSON: JSON.stringify(res.route), Status: res.status, Current_Step: res.nextStep,
      Completed_On: res.status === CFG.STATUS.APPROVED ? DB.nowISO() : ''
    };
    Object.keys(patch).forEach(function (k) { req[k] = patch[k]; });
    var apRow = S().approvals.filter(function (x) { return String(x.Request) === String(reqId) && Number(x.Step_No) === Number(cur); })[0];
    var jobs = [DB.update('Requests', reqId, patch)];
    if (apRow) {
      var ap = { Action: action, Acted_By: me().ID, Acted_By_name: me().Employee_Name, Comment: comment || '', Acted_On: DB.nowISO() };
      Object.keys(ap).forEach(function (k) { apRow[k] = ap[k]; });
      jobs.push(DB.update('Approvals', apRow.ID, ap));
    }
    if (res.nextStep) {
      var nextRow = S().approvals.filter(function (x) { return String(x.Request) === String(reqId) && Number(x.Step_No) === Number(res.nextStep); })[0];
      var nextStepDef = res.route.filter(function (x) { return x.step_no === res.nextStep; })[0];
      if (nextRow && nextStepDef) {
        var d = WF.dueDateOf(req, res.route, nextStepDef);
        if (d) {
          var due2 = d.toISOString().slice(0, 10);
          nextRow.Due_Date = due2;
          jobs.push(DB.update('Approvals', nextRow.ID, { Due_Date: due2 }));
        }
      }
    }
    jobs.push(DB.add('Notifications', {
      To_User: req.Applicant, Request: reqId, Kind: action,
      Message: req.Request_No + ' ' + req.Subject + ' が ' + me().Employee_Name + ' により' + action + 'されました',
      Is_Read: false, Created_Time: DB.nowISO()
    }).then(function (n) { S().notifications.push(n); }));
    App.audit(action, '申請', reqId, req.Request_No + ' / ' + (comment || ''));
    return Promise.all(jobs);
  }

  /* =======================================================================
   * すべての申請（検索）
   * ===================================================================== */
  var sf = { q: '', type: '', status: '', from: '', to: '', min: '', max: '', dept: '' };
  function search(el) {
    var all = visibleRequests();
    el.innerHTML = pageHead('すべての申請', '閲覧権限のある申請のみ表示されます（権限外は件数にも含まれません）',
      (Perm.canExport(me()) ? '<button class="btn" data-act="csv">CSV出力</button>' : '<span class="tag">CSV出力の権限がありません</span>')) +
      '<div class="card" style="margin-bottom:14px"><div class="card-body"><div class="form-grid">' +
      '<div class="field"><label>キーワード</label><input id="s_q" value="' + E(sf.q) + '" placeholder="申請番号・件名・申請者"></div>' +
      '<div class="field"><label>申請区分</label><select id="s_type"><option value="">すべて</option>' +
      App.templates().map(function (t) { return '<option value="' + E(t.code) + '"' + (sf.type === t.code ? ' selected' : '') + '>' + E(t.name) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label>ステータス</label><select id="s_status"><option value="">すべて</option>' +
      Object.keys(CFG.STATUS).map(function (k) { var v = CFG.STATUS[k]; return '<option' + (sf.status === v ? ' selected' : '') + '>' + E(v) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label>部署</label><select id="s_dept"><option value="">すべて</option>' +
      S().departments.map(function (d) { return '<option' + (sf.dept === d.Department_Name ? ' selected' : '') + '>' + E(d.Department_Name) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label>申請日（自）</label><input id="s_from" type="date" value="' + E(sf.from) + '"></div>' +
      '<div class="field"><label>申請日（至）</label><input id="s_to" type="date" value="' + E(sf.to) + '"></div>' +
      '<div class="field money"><label>金額（下限）</label><input id="s_min" data-money="1" value="' + E(sf.min) + '"></div>' +
      '<div class="field money"><label>金額（上限）</label><input id="s_max" data-money="1" value="' + E(sf.max) + '"></div>' +
      '</div><div class="inline-row" style="margin-top:12px"><button class="btn btn-primary" data-act="search">検索</button>' +
      '<button class="btn" data-act="clear">条件クリア</button><span class="page-sub" id="scount"></span></div></div></div>' +
      '<div class="card" id="sresult"></div>';
    UI.bindMoneyInputs(el);
    function run(logIt) {
      ['q', 'type', 'status', 'dept', 'from', 'to', 'min', 'max'].forEach(function (k) {
        var n = el.querySelector('#s_' + k); if (n) sf[k] = n.value;
      });
      var rows = all.filter(function (r) {
        if (sf.q) {
          var hay = (r.Request_No + ' ' + r.Subject + ' ' + r.Applicant_name).toLowerCase();
          if (hay.indexOf(sf.q.toLowerCase()) < 0) return false;
        }
        if (sf.type && r.Type_Code !== sf.type) return false;
        if (sf.status && r.Status !== sf.status) return false;
        if (sf.dept && r.Applicant_Dept_name !== sf.dept) return false;
        if (sf.from && String(r.Applied_On).slice(0, 10) < sf.from) return false;
        if (sf.to && String(r.Applied_On).slice(0, 10) > sf.to) return false;
        if (sf.min && Number(r.Amount) < UI.rawNum(sf.min)) return false;
        if (sf.max && Number(r.Amount) > UI.rawNum(sf.max)) return false;
        return true;
      }).sort(function (a, b) { return new Date(b.Applied_On || 0) - new Date(a.Applied_On || 0); });
      el.querySelector('#sresult').innerHTML = requestTable(rows, false);
      el.querySelector('#scount').textContent = rows.length + ' 件';
      bindTable(el);
      if (logIt) {
        Access.log(CFG.ACCESS.ACTIONS.SEARCH, {
          targetType: '申請検索', resultCount: rows.length,
          detail: '条件：' + JSON.stringify(sf).slice(0, 180)
        });
      }
      return rows;
    }
    var current = run(false);
    /* 画面を開いただけで一覧が見えるので、初期表示も記録する */
    Access.log(CFG.ACCESS.ACTIONS.VIEW_LIST, {
      targetType: '申請検索', resultCount: current.length, detail: '画面表示（前回条件を保持）'
    });
    el.querySelector('[data-act="search"]').addEventListener('click', function () { current = run(true); });
    el.querySelector('[data-act="clear"]').addEventListener('click', function () { sf = { q: '', type: '', status: '', from: '', to: '', min: '', max: '', dept: '' }; App.refresh(); });
    var cs = el.querySelector('[data-act="csv"]');
    if (cs) cs.addEventListener('click', function () { exportRequests(current, '申請一覧'); });
  }

  function exportRequests(rows, name) {
    if (App.blockIfImpersonating('CSV出力')) return;
    if (!Perm.canExport(me())) {
      Access.denied('CSV出力', '権限なし：' + name);
      UI.toast('CSV出力の権限がありません（記録しました）', 'error'); return;
    }
    var headers = ['申請番号', '申請区分', '件名', '申請者', '所属', '金額', 'ステータス', '申請日', '完了日', '現在の承認者'];
    var data = rows.map(function (r) {
      var route = routeOf(r), cur = WF.currentStep(route);
      var st = route.filter(function (s) { return s.step_no === cur; })[0];
      return [r.Request_No, (tplOf(r.Type_Code) || {}).name || r.Type_Code, r.Subject, r.Applicant_name, r.Applicant_Dept_name,
      r.Amount, r.Status, UI.fmtDate(r.Applied_On), UI.fmtDate(r.Completed_On), st ? st.approverName : ''];
    });
    UI.download(name + '_' + new Date().toISOString().slice(0, 10) + '.csv', UI.toCSV(headers, data));
    Access.log(CFG.ACCESS.ACTIONS.EXPORT_CSV, { targetType: '申請', resultCount: rows.length, detail: name + ' を ' + rows.length + '件 出力' });
    App.audit('CSV出力', '申請', '', name + '／' + rows.length + '件');
    UI.toast(rows.length + ' 件を出力しました（出力操作も証跡に記録されます）', 'success');
  }

  /* =======================================================================
   * 経理処理
   * ===================================================================== */
  function finance(el) {
    if (!Perm.isFinance(me()) && !Perm.isAdmin(me())) {
      Access.denied('経理処理', '権限なし');
      el.innerHTML = pageHead('経理処理') + UI.empty('🔒', 'この画面を開く権限がありません', 'アクセス拒否として証跡に記録しました');
      return;
    }
    var rows = Perm.filterRequests(me(), S().requests.filter(function (r) {
      return r.Status === CFG.STATUS.APPROVED && CFG.SCOPE_TYPES.finance.indexOf(r.Type_Code) >= 0;
    }), S().approvals).sort(function (a, b) { return new Date(b.Completed_On || 0) - new Date(a.Completed_On || 0); });
    var unpaid = rows.filter(function (r) { return !r.Paid; });
    el.innerHTML = pageHead('経理処理', '承認済の経費・支払申請の検収と支払処理',
      '<button class="btn" data-act="journal">仕訳CSV出力</button><button class="btn" data-act="fb">振込データ出力</button>') +
      '<div class="grid kpi-grid" style="margin-bottom:14px">' +
      kpi('未払い', unpaid.length + ' 件', UI.yen(unpaid.reduce(function (a, r) { return a + Number(r.Amount || 0); }, 0))) +
      kpi('支払済', (rows.length - unpaid.length) + ' 件', '') +
      kpi('今月検収', rows.filter(function (r) { return String(r.Completed_On).slice(0, 7) === new Date().toISOString().slice(0, 7); }).length + ' 件', '') +
      '</div><div class="card"><div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th>申請番号</th><th>区分</th><th>申請者</th><th class="num">金額</th><th>支払期日</th><th>状態</th><th></th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td class="nowrap">' + E(r.Request_No) + '</td><td class="nowrap"><span class="tag">' + E((tplOf(r.Type_Code) || {}).name || '') + '</span></td>' +
          '<td class="nowrap">' + E(r.Applicant_name) + '</td><td class="num nowrap">' + UI.yen(r.Amount) + '</td>' +
          '<td class="nowrap"><input type="date" data-due="' + E(r.ID) + '" value="' + E(String(r.Payment_Due_Date || '').slice(0, 10)) + '" style="min-height:28px"></td>' +
          '<td class="nowrap">' + (r.Paid ? '<span class="badge b-approved">支払済</span>' : '<span class="badge b-pending">未払</span>') + '</td>' +
          '<td class="nowrap"><button class="btn btn-sm" data-pay="' + E(r.ID) + '">' + (r.Paid ? '取消' : '支払済にする') + '</button>' +
          '<button class="btn btn-sm" data-open="' + E(r.ID) + '">詳細</button></td></tr>';
      }).join('') + '</tbody></table></div></div>';
    el.querySelectorAll('[data-open]').forEach(function (b) { b.addEventListener('click', function () { openDetail(b.dataset.open); }); });
    el.querySelectorAll('[data-pay]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (App.blockIfImpersonating('支払状態の変更')) return;
        var r = App.requestById(b.dataset.pay);
        DB.update('Requests', r.ID, { Paid: !r.Paid }).then(function () {
          r.Paid = !r.Paid; App.audit(r.Paid ? '支払済に変更' : '支払取消', '申請', r.ID, r.Request_No);
          UI.toast('更新しました', 'success'); App.refresh();
        });
      });
    });
    el.querySelectorAll('[data-due]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        if (App.blockIfImpersonating('支払期日の設定')) return;
        var r = App.requestById(inp.dataset.due);
        DB.update('Requests', r.ID, { Payment_Due_Date: inp.value }).then(function () {
          r.Payment_Due_Date = inp.value; App.audit('支払期日設定', '申請', r.ID, inp.value); UI.toast('支払期日を設定しました', 'success');
        });
      });
    });
    el.querySelector('[data-act="journal"]').addEventListener('click', function () { exportJournal(rows); });
    el.querySelector('[data-act="fb"]').addEventListener('click', function () { exportFB(unpaid); });
    Access.log(CFG.ACCESS.ACTIONS.VIEW_LIST, { targetType: '経理処理', resultCount: rows.length });
  }
  function exportJournal(rows) {
    if (App.blockIfImpersonating('仕訳CSV出力')) return;
    if (!Perm.canExport(me())) { Access.denied('CSV出力', '権限なし：仕訳データ'); UI.toast('出力の権限がありません（記録しました）', 'error'); return; }
    var headers = ['取引日', '借方勘定科目', '借方金額', '貸方勘定科目', '貸方金額', '税区分', '摘要', '取引先', '登録番号', '申請番号'];
    var out = [];
    rows.forEach(function (r) {
      var t = tplOf(r.Type_Code), data = dataOf(r);
      var lf = (t.fields || []).filter(function (f) { return f.type === 'lines'; })[0];
      if (lf && data[lf.key]) {
        data[lf.key].forEach(function (ln) {
          var ac = App.accountById(ln.account), ven = App.vendorById(ln.vendor);
          var amt = UI.rawNum(ln.amount) || (UI.rawNum(ln.qty) * UI.rawNum(ln.unit_price));
          out.push([UI.fmtDate(ln.date || r.Completed_On), ac ? ac.Account_Name : '未設定', amt, '未払金', amt,
          ln.tax || '課税10%', ln.desc || ln.item || r.Subject, ven ? ven.Vendor_Name : '', ven ? ven.Invoice_Reg_No : '', r.Request_No]);
        });
      } else {
        var ac2 = App.accountById(data.account), v2 = App.vendorById(data.vendor);
        out.push([UI.fmtDate(r.Completed_On), ac2 ? ac2.Account_Name : '未設定', r.Amount, '未払金', r.Amount,
        data.tax || '課税10%', r.Subject, v2 ? v2.Vendor_Name : '', v2 ? v2.Invoice_Reg_No : '', r.Request_No]);
      }
    });
    UI.download('仕訳データ_' + new Date().toISOString().slice(0, 10) + '.csv', UI.toCSV(headers, out));
    Access.log(CFG.ACCESS.ACTIONS.EXPORT_CSV, { targetType: '仕訳データ', resultCount: out.length, detail: '会計連携用' });
    App.audit('仕訳CSV出力', '経理', '', out.length + '行');
    UI.toast('仕訳データを出力しました（' + out.length + '行）', 'success');
  }
  function exportFB(rows) {
    if (App.blockIfImpersonating('振込データ出力')) return;
    if (!Perm.canExport(me())) { Access.denied('CSV出力', '権限なし：振込データ'); UI.toast('出力の権限がありません（記録しました）', 'error'); return; }
    var headers = ['支払期日', '取引先', '登録番号', '支払金額', '申請番号', '件名', '申請者'];
    var out = rows.map(function (r) {
      var data = dataOf(r), v = App.vendorById(data.vendor);
      return [UI.fmtDate(r.Payment_Due_Date), v ? v.Vendor_Name : r.Applicant_name, v ? v.Invoice_Reg_No : '', r.Amount, r.Request_No, r.Subject, r.Applicant_name];
    });
    UI.download('振込データ_' + new Date().toISOString().slice(0, 10) + '.csv', UI.toCSV(headers, out));
    Access.log(CFG.ACCESS.ACTIONS.EXPORT_CSV, { targetType: '振込データ', resultCount: out.length });
    App.audit('振込データ出力', '経理', '', out.length + '件');
    UI.toast('振込データを出力しました', 'success');
  }

  /* =======================================================================
   * 閲覧証跡（監査）— 本システムの中核画面
   * ===================================================================== */
  var af = { q: '', actor: '', action: '', from: '', to: '', onlyAnomaly: false };
  function accessAudit(el) {
    var canAll = Perm.canViewAllLogs(me());
    var logs = S().accessLogs.slice();
    if (!canAll) {
      /* 管理者以外は「自分の申請に対する閲覧」と「自分自身の操作履歴」だけ見られる */
      var mineIds = {};
      S().requests.forEach(function (r) { if (String(r.Applicant) === String(me().ID)) mineIds[r.ID] = true; });
      logs = logs.filter(function (l) { return mineIds[l.Target_ID] || String(l.Actor) === String(me().ID); });
    }
    logs.sort(function (a, b) { return new Date(b.Log_Time) - new Date(a.Log_Time); });
    var flagged = Access.anomalies(S().accessLogs.slice());
    var flaggedIds = {}; flagged.forEach(function (l) { flaggedIds[l.ID || (l.Log_Time + l.Actor)] = l._reasons; });

    var actors = {}; logs.forEach(function (l) { if (l.Actor_Name) actors[l.Actor] = l.Actor_Name; });

    el.innerHTML = pageHead('閲覧証跡', canAll ? '誰が・いつ・どの申請を・どう扱ったかの全記録（追記のみ／削除不可）'
      : 'あなたの申請が誰に見られたか、およびあなた自身の操作履歴',
      (Perm.canExport(me()) ? '<button class="btn" data-act="csv">証跡CSV出力</button>' : '')) +
      (canAll ? '<div class="grid kpi-grid" style="margin-bottom:14px">' +
        kpi('総記録数', UI.num(S().accessLogs.length) + ' 件', '保存期間 ' + Math.round(CFG.ACCESS.RETENTION_DAYS / 365) + '年') +
        kpi('本日の閲覧', S().accessLogs.filter(function (l) { return String(l.Log_Time).slice(0, 10) === new Date().toISOString().slice(0, 10); }).length + ' 件', '') +
        kpi('要確認フラグ', flagged.length + ' 件', '深夜・他部署機微・大量閲覧・出力多発', flagged.length > 0) +
        kpi('CSV出力回数', S().accessLogs.filter(function (l) { return l.Action === CFG.ACCESS.ACTIONS.EXPORT_CSV; }).length + ' 件', '持ち出しの証跡') +
        '</div>' : '') +
      '<div class="card" style="margin-bottom:14px"><div class="card-body"><div class="form-grid">' +
      '<div class="field"><label>キーワード</label><input id="a_q" value="' + E(af.q) + '" placeholder="申請番号・件名・氏名"></div>' +
      '<div class="field"><label>操作者</label><select id="a_actor"><option value="">すべて</option>' +
      Object.keys(actors).map(function (k) { return '<option value="' + E(k) + '"' + (af.actor === k ? ' selected' : '') + '>' + E(actors[k]) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label>操作</label><select id="a_action"><option value="">すべて</option>' +
      Object.keys(CFG.ACCESS.ACTIONS).map(function (k) { var v = CFG.ACCESS.ACTIONS[k]; return '<option' + (af.action === v ? ' selected' : '') + '>' + E(v) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label>期間（自）</label><input id="a_from" type="date" value="' + E(af.from) + '"></div>' +
      '<div class="field"><label>期間（至）</label><input id="a_to" type="date" value="' + E(af.to) + '"></div>' +
      '<div class="field"><label>表示</label><label class="inline-row"><input type="checkbox" id="a_anom" style="width:auto;min-height:auto"' + (af.onlyAnomaly ? ' checked' : '') + '> 要確認のみ</label></div>' +
      '</div><div class="inline-row" style="margin-top:12px"><button class="btn btn-primary" data-act="filter">絞り込む</button><span class="page-sub" id="acount"></span></div></div></div>' +
      (canAll && flagged.length ? anomalyCard(flagged) : '') +
      '<div class="card" id="alogs"></div>';

    function run() {
      ['q', 'actor', 'action', 'from', 'to'].forEach(function (k) { var n = el.querySelector('#a_' + k); if (n) af[k] = n.value; });
      af.onlyAnomaly = el.querySelector('#a_anom').checked;
      var rows = logs.filter(function (l) {
        var key = l.ID || (l.Log_Time + l.Actor);
        if (af.onlyAnomaly && !flaggedIds[key]) return false;
        if (af.actor && String(l.Actor) !== af.actor) return false;
        if (af.action && l.Action !== af.action) return false;
        if (af.from && String(l.Log_Time).slice(0, 10) < af.from) return false;
        if (af.to && String(l.Log_Time).slice(0, 10) > af.to) return false;
        if (af.q) {
          var hay = ((l.Target_No || '') + ' ' + (l.Target_Subject || '') + ' ' + (l.Actor_Name || '')).toLowerCase();
          if (hay.indexOf(af.q.toLowerCase()) < 0) return false;
        }
        return true;
      });
      el.querySelector('#acount').textContent = UI.num(rows.length) + ' 件';
      el.querySelector('#alogs').innerHTML = logTable(rows.slice(0, 400), flaggedIds);
      return rows;
    }
    var cur = run();
    el.querySelector('[data-act="filter"]').addEventListener('click', function () { cur = run(); });
    var c = el.querySelector('[data-act="csv"]');
    if (c) c.addEventListener('click', function () {
      if (App.blockIfImpersonating('閲覧証跡のCSV出力')) return;
      var headers = ['日時', '操作者', '所属', '権限', '操作', '対象申請番号', '件名', '申請区分', '機微度', '所有部署', '他部署', '滞在秒', '件数', '備考'];
      var data = cur.map(function (l) {
        return [UI.fmtDateTime(l.Log_Time), l.Actor_Name, l.Actor_Dept, l.Actor_Role, l.Action, l.Target_No, l.Target_Subject,
        (tplOf(l.Request_Type_Code) || {}).name || '', l.Sensitivity, l.Owner_Dept, l.Cross_Dept ? '○' : '', l.Duration_Sec, l.Result_Count, l.Detail];
      });
      UI.download('閲覧証跡_' + new Date().toISOString().slice(0, 10) + '.csv', UI.toCSV(headers, data));
      Access.log(CFG.ACCESS.ACTIONS.EXPORT_CSV, { targetType: '閲覧証跡', resultCount: data.length, detail: '監査証跡の出力' });
      App.audit('閲覧証跡のCSV出力', '証跡', '', data.length + '件');
      UI.toast('証跡を出力しました（この出力自体も記録されます）', 'success');
    });
    Access.log(CFG.ACCESS.ACTIONS.VIEW_LOG, { targetType: '閲覧証跡画面', resultCount: logs.length, detail: canAll ? '全社範囲' : '自分の範囲' });
  }
  function anomalyCard(flagged) {
    var top = flagged.slice().sort(function (a, b) { return new Date(b.Log_Time) - new Date(a.Log_Time); }).slice(0, 8);
    return '<div class="card" style="margin-bottom:14px;border-color:var(--warning)"><div class="card-head">' +
      '<div class="card-title">要確認の閲覧（' + flagged.length + '件）</div><span class="tag" style="margin-left:auto">自動検知</span></div>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>日時</th><th>操作者</th><th>対象</th><th>検知理由</th></tr></thead><tbody>' +
      top.map(function (l) {
        return '<tr><td class="nowrap">' + E(UI.fmtDateTime(l.Log_Time)) + '</td><td class="nowrap">' + E(l.Actor_Name) + '<div class="page-sub">' + E(l.Actor_Dept) + '</div></td>' +
          '<td>' + E(l.Target_No || '') + ' ' + E(l.Target_Subject || '') + '</td>' +
          '<td>' + (l._reasons || []).map(function (r) { return '<span class="badge b-sentback">' + E(r) + '</span>'; }).join(' ') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }
  function logTable(rows, flaggedIds) {
    if (!rows.length) return UI.empty('🗂', '該当する記録がありません', '条件を変えて再検索してください');
    return '<div class="table-wrap"><table class="tbl"><thead><tr><th>日時</th><th>操作者</th><th>操作</th><th>対象申請</th><th>機微度</th><th>滞在</th><th>検知</th></tr></thead><tbody>' +
      rows.map(function (l) {
        var key = l.ID || (l.Log_Time + l.Actor);
        var rs = flaggedIds[key];
        return '<tr' + (l.Target_ID ? ' data-req="' + E(l.Target_ID) + '"' : '') + '>' +
          '<td class="nowrap">' + E(UI.fmtDateTime(l.Log_Time)) + '</td>' +
          '<td class="nowrap">' + E(l.Actor_Name) + '<div class="page-sub">' + E(l.Actor_Dept) + '</div></td>' +
          '<td class="nowrap"><span class="tag">' + E(l.Action) + '</span></td>' +
          '<td>' + E(l.Target_No || l.Target_Type || '') + ' ' + E(l.Target_Subject || '') + (l.Cross_Dept ? ' <span class="badge b-sentback">他部署</span>' : '') + '</td>' +
          '<td class="nowrap">' + (l.Sensitivity ? '<span class="tag">' + E(l.Sensitivity) + '</span>' : '—') + '</td>' +
          '<td class="nowrap">' + (l.Duration_Sec ? E(l.Duration_Sec) + '秒' : '—') + '</td>' +
          '<td>' + (rs && rs.length ? rs.map(function (r) { return '<span class="badge b-sentback">' + E(r) + '</span>'; }).join(' ') : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  /* =======================================================================
   * 設定・マスタ
   * ===================================================================== */
  function admin(el) {
    /* ★統合：社員・部署は統合側の「職員登録」で扱う（登録する場所を1つにする） */
    var bridged = (typeof window !== 'undefined') && window.SHINSEI_BRIDGE;
    var tab = App.param('tab') || (bridged ? 'Vendors' : 'Employees');
    if (bridged && (tab === 'Employees' || tab === 'Departments')) { window.SHINSEI_BRIDGE.openStaff(); return; }
    /* 社員・部署・取引先・勘定科目は編集できる画面（masters.js）に委譲する。
       運用設定とテンプレート一覧だけここで描く。 */
    if (Masters.DEFS[tab]) { Masters.render(el, tab, App.param('focus')); return; }
    if (!Perm.isAdmin(me())) {
      Access.denied('管理設定', '権限なし');
      el.innerHTML = pageHead('設定') + UI.empty('🔒', 'この画面を開く権限がありません', 'アクセス拒否として証跡に記録しました');
      return;
    }
    el.innerHTML = pageHead('設定・マスタ', '承認経路の前提になる情報です。変更はすべて操作証跡に残ります。') +
      '<div class="tabs">' +
      Object.keys(Masters.DEFS).filter(function (k) { return !(bridged && (k === 'Employees' || k === 'Departments')); }).map(function (k) {
        return '<button class="tab" data-mtab="' + k + '">' + Masters.DEFS[k].icon + ' ' + E(Masters.DEFS[k].label) +
          '<span class="n">' + Masters.DEFS[k].list().length + '</span></button>';
      }).join('') +
      '<button class="tab' + (tab === 'tpl' ? ' active' : '') + '" data-mtab="tpl">📄 申請テンプレート</button>' +
      '<button class="tab' + (tab === '__other' ? ' active' : '') + '" data-mtab="__other">⚙️ 運用設定</button>' +
      '</div><div class="card" id="abody"></div>';
    var b = el.querySelector('#abody');
    if (tab === 'tpl') b.innerHTML = tplAdmin(); else b.innerHTML = sysAdmin();
    el.querySelectorAll('[data-mtab]').forEach(function (x) { x.addEventListener('click', function () { App.go('admin?tab=' + x.dataset.mtab); }); });
    bindSys(b);
    Access.log(CFG.ACCESS.ACTIONS.VIEW_LIST, { targetType: '管理設定', detail: 'タブ：' + tab });
  }

  function simpleTable(headers, rows) {
    return '<div class="table-wrap"><table class="tbl"><thead><tr>' + headers.map(function (h) { return '<th>' + E(h) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + rows.map(function (r) {
        return '<tr>' + r.map(function (c) { return '<td>' + E(c == null ? '' : c) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }
  function tplAdmin() {
    return '<div class="card-body">' +
      '<div class="page-sub" style="margin-bottom:10px">テンプレート定義（JSON）。Creator の Request_Types フォームに保存されている内容です。</div>' +
      simpleTable(['コード', '名称', 'カテゴリ', '機微度', '段数', '経路の条件'], App.templates().map(function (t) {
        var flds = RouteSpec.fieldsFor(t, {
          departments: S().departments.map(function (d) { return d.Department_Name; }), titles: CFG.TITLES,
          vendors: S().vendors.map(function (v) { return v.Vendor_Name; }),
          accounts: S().accounts.map(function (a) { return a.Account_Name; })
        });
        var norm = RouteSpec.normalize(t.route, t).steps;
        return [t.code, t.name, t.category, CFG.ACCESS.SENSITIVITY[t.code] || 'C', norm.length,
        norm.map(function (s) { return s.name + (s.conditions ? '〔' + RouteSpec.describe(s.conditions, flds) + '〕' : ''); }).join(' → ')];
      })) + '</div>';
  }
  function sysAdmin() {
    return '<div class="card-body"><div class="form-grid">' +
      '<div class="field"><label>日付表示</label><label class="inline-row"><input type="checkbox" id="sw_wareki" style="width:auto;min-height:auto"' + (UI.useWareki() ? ' checked' : '') + '> 和暦で表示する</label></div>' +
      '<div class="field"><label>接続状態</label><div>' + (DB.isConnected() ? '<span class="badge b-approved">Zoho Creator に接続済（' + E(DB.kind()) + '）</span>' : '<span class="badge b-sentback">デモモード（localStorage）</span>') + '</div></div>' +
      '<div class="field full"><label>閲覧証跡の運用</label><div class="page-sub">' +
      '記録対象：' + Object.keys(CFG.ACCESS.ACTIONS).map(function (k) { return CFG.ACCESS.ACTIONS[k]; }).join('／') + '<br>' +
      '保存期間：' + CFG.ACCESS.RETENTION_DAYS + '日（約' + Math.round(CFG.ACCESS.RETENTION_DAYS / 365) + '年）<br>' +
      '異常検知：深夜' + CFG.ACCESS.ANOMALY.NIGHT_FROM + '時以降／1時間に' + CFG.ACCESS.ANOMALY.BULK_VIEW_PER_HOUR + '件超の閲覧／1日' + CFG.ACCESS.ANOMALY.EXPORT_PER_DAY + '回超のCSV出力／他部署の機微申請の閲覧' +
      '</div></div>' +
      '<div class="field full"><label>デモデータ</label><div class="inline-row">' +
      '<button class="btn" id="sw_reseed">デモデータを再投入</button><button class="btn btn-danger" id="sw_wipe">全データ初期化</button>' +
      '</div><div class="help">Creator 接続時はこの操作は無効です（本番データは保護されます）。</div></div>' +
      '</div></div>';
  }
  function bindSys(b) {
    var w = b.querySelector('#sw_wareki');
    if (w) w.addEventListener('change', function () { UI.setWareki(w.checked); UI.toast('表示形式を変更しました', 'success'); App.refresh(); });
    var rs = b.querySelector('#sw_reseed');
    if (rs) rs.addEventListener('click', function () {
      if (DB.isConnected()) { UI.toast('Creator 接続中は実行できません', 'warn'); return; }
      UI.confirmBox('デモデータ再投入', '現在のデモデータを破棄して初期状態に戻します。', '再投入する', 'btn-danger').then(function (ok) {
        if (ok) { DB.resetDemo(); UI.toast('再投入しました', 'success'); App.boot(); }
      });
    });
    var wp = b.querySelector('#sw_wipe');
    if (wp) wp.addEventListener('click', function () {
      if (DB.isConnected()) { UI.toast('Creator 接続中は実行できません', 'warn'); return; }
      UI.confirmBox('全データ初期化', 'すべてのデモデータを削除します。', '削除する', 'btn-danger').then(function (ok) {
        if (ok) { DB.wipeDemo(); UI.toast('初期化しました', 'success'); App.boot(); }
      });
    });
  }

  return {
    dashboard: dashboard, newRequest: newRequest, form: form, mine: mine, inbox: inbox,
    search: search, finance: finance, accessAudit: accessAudit, admin: admin,
    openDetail: openDetail, exportRequests: exportRequests
  };
})();
