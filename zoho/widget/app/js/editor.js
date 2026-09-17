/* =========================================================================
 * editor.js — 承認経路の設定画面（管理者向け）
 *
 *  設計方針：
 *   ・非エンジニアが触る画面なので、JSON を書かせない。
 *   ・「どういう順番で・誰が・どんなときに」の3点だけを選ばせる。
 *   ・保存する前に、その場で流れを試せるようにする（経路テスト）。
 *     これが無いと、実際に申請してみるまで正しさが分からない。
 * ========================================================================= */
var RouteEditor = (function () {
  var E = UI.esc;
  var S = function () { return App.state; };

  var st = {
    code: null,        // 編集中の申請区分
    steps: [],         // 編集中の経路（RouteSpec.normalize 済み）
    dirty: false,
    open: {},          // ステップカードの開閉状態
    test: {}           // 経路テストの入力値
  };

  /* ---------- マスタ ---------- */
  function masters() {
    return {
      departments: S().departments.map(function (d) { return d.Department_Name; }),
      titles: CFG.TITLES,
      vendors: S().vendors.map(function (v) { return v.Vendor_Name; }),
      accounts: S().accounts.map(function (a) { return a.Account_Name; })
    };
  }
  function fieldsOf(code) {
    var t = App.templateByCode(code) || { fields: [] };
    return RouteSpec.fieldsFor(t, masters());
  }

  /* =======================================================================
   * 画面全体
   * ===================================================================== */
  function render(el) {
    if (!Perm.isAdmin(App.me())) {
      Access.denied('承認経路の設定', '権限なし');
      el.innerHTML = '<div class="page-head"><div class="page-title">承認経路の設定</div></div>' +
        UI.empty('🔒', 'この画面を開く権限がありません', 'アクセス拒否として証跡に記録しました');
      return;
    }
    if (!st.code) st.code = (App.templates()[0] || {}).code;
    loadSteps(st.code);

    el.innerHTML =
      '<div class="page-head"><div><div class="page-title">承認経路の設定</div>' +
      '<div class="page-sub">申請の種類ごとに、誰がどの順番で承認するかを決めます。保存する前に下部で流れを試せます。</div></div>' +
      '<div class="page-actions">' +
      '<button class="btn" data-act="reset">編集を破棄</button>' +
      '<button class="btn btn-primary" data-act="save"' + (st.dirty ? '' : ' disabled') + '>この経路を保存</button>' +
      '</div></div>' +
      '<div class="route-editor">' +
      '<aside class="re-list">' + typeListHtml() + '</aside>' +
      '<section class="re-main">' + stepsHtml() + testHtml() + '</section>' +
      '</div>';

    bind(el);
    Access.log(CFG.ACCESS.ACTIONS.VIEW_LIST, { targetType: '承認経路の設定', detail: '申請区分：' + st.code });
  }

  function loadSteps(code) {
    if (st.loadedFor === code) return;
    var t = App.templateByCode(code) || { route: { steps: [] } };
    st.steps = RouteSpec.normalize(t.route, t).steps;
    st.loadedFor = code;
    st.dirty = false;
    /* 経路テストの既定の申請者は一般社員にする。
       役職が上の人を既定にすると上長が居らず、経路が短く出て誤解を招くため。 */
    var plain = S().employees.filter(function (e) { return e.Title === '一般' && e.Manager; })[0] ||
                S().employees.filter(function (e) { return e.Manager; })[0] || S().employees[0];
    st.test = { __applicant: plain ? plain.ID : '' };
    /* 3段を超えるときは畳んだ状態で始める（俯瞰してから編集に入れるように） */
    st.open = {};
    if (st.steps.length > 3) st.steps.forEach(function (_s, i) { st.open[i] = false; });
  }

  /* ---------- 左：申請区分の一覧 ---------- */
  function typeListHtml() {
    var cats = {};
    App.templates().forEach(function (t) { (cats[t.category] = cats[t.category] || []).push(t); });
    return Object.keys(cats).map(function (c) {
      return '<div class="nav-group">' + E(c) + '</div>' +
        cats[c].map(function (t) {
          var n = RouteSpec.normalize(t.route, t).steps.length;
          return '<button class="re-type' + (t.code === st.code ? ' active' : '') + '" data-type="' + E(t.code) + '">' +
            '<span class="ico">' + E(t.icon) + '</span>' +
            '<span class="re-type-name">' + E(t.name) + '</span>' +
            '<span class="tag">' + n + '段</span></button>';
        }).join('');
    }).join('');
  }

  /* ---------- 右：ステップの編集 ---------- */
  function stepsHtml() {
    var t = App.templateByCode(st.code) || {};
    var flds = fieldsOf(st.code);
    var body = st.steps.length ? st.steps.map(function (s, i) { return stepCard(s, i, flds); }).join('')
      : UI.empty('🧭', 'まだ承認ステップがありません', '「＋ ステップを追加」から作成してください');
    return '<div class="card" style="margin-bottom:14px">' +
      '<div class="card-head"><div class="card-title">' + E(t.icon || '') + ' ' + E(t.name || '') + ' の承認経路</div>' +
      '<span class="tag" style="margin-left:auto">上から順に流れます</span></div>' +
      '<div class="card-body">' + body +
      '<div style="margin-top:12px"><button class="btn" data-act="addstep">＋ ステップを追加</button></div>' +
      '</div></div>';
  }

  function stepCard(s, i, flds) {
    var a = s.assignee || {};
    var def = RouteSpec.assigneeDef(a.mode);
    var open = (st.open[i] !== false);
    /* 折りたたみ：5段あると編集画面が3画面分になり、目的の段に辿り着けない。
       閉じているときも「誰が・どんなときに」が1行で分かるようにする。 */
    var pk = def.params.length ? def.params[0].key : null;
    var who = def.label + (pk && a[pk] ? '（' + a[pk] + '）' : '');
    var cond = s.conditions ? RouteSpec.describe(s.conditions, flds) : '条件なし';
    var summary =
      '<button type="button" class="re-summary" data-act="toggle">' +
      '<span class="re-caret">' + (open ? '▾' : '▸') + '</span>' +
      '<strong>' + E(s.name || '（名称なし）') + '</strong>' +
      '<span class="tag">' + E(s.type) + '</span>' +
      (s.mustNotSkip ? '<span class="badge b-info">省略不可</span>' : '') +
      ((s.escalate || {}).mode && s.escalate.mode !== 'none' ? '<span class="badge b-progress">' + E(s.escalate.afterDays) + '日で' + E(RouteSpec.escalationDef(s.escalate.mode).label.replace(/（.*/, '')) + '</span>' : '') +
      '<span class="re-summary-who">' + E(who) + '</span>' +
      '<span class="re-summary-cond">' + E(cond) + '</span>' +
      '</button>';
    if (!open) {
      return '<div class="re-step re-step-closed" data-idx="' + i + '">' +
        '<div class="re-step-no">' + (i + 1) + '</div>' +
        '<div class="re-step-body">' + summary + '</div></div>';
    }
    return '<div class="re-step" data-idx="' + i + '">' +
      '<div class="re-step-no">' + (i + 1) + '</div>' +
      '<div class="re-step-body">' + summary +
      '<div class="form-grid" style="gap:10px">' +
      '<div class="field"><label>ステップ名</label>' +
      '<input data-f="name" value="' + E(s.name) + '" placeholder="部長決裁"></div>' +
      '<div class="field"><label>種類</label><select data-f="type">' +
      RouteSpec.STEP_TYPES.map(function (x) {
        return '<option value="' + E(x.key) + '"' + (s.type === x.key ? ' selected' : '') + '>' + E(x.label) + '</option>';
      }).join('') + '</select>' +
      '<div class="help">' + E((RouteSpec.STEP_TYPES.filter(function (x) { return x.key === s.type; })[0] || {}).hint || '') + '</div></div>' +
      '<div class="field"><label>承認するのは誰か</label><select data-f="mode">' +
      RouteSpec.ASSIGNEES.map(function (x) {
        return '<option value="' + E(x.mode) + '"' + (a.mode === x.mode ? ' selected' : '') + '>' + E(x.label) + '</option>';
      }).join('') + '</select>' +
      '<div class="help">' + E(def.hint) + '</div></div>' +
      '<div class="field"><label>' + E(def.params.length ? def.params[0].label : '（指定不要）') + '</label>' +
      assigneeParamHtml(def, a) +
      (def.warn ? '<div class="help" style="color:var(--warning)">⚠ ' + E(def.warn) + '</div>' : '') +
      ((def.options || []).length ?
        '<label class="inline-row" style="margin-top:6px;font-size:11.5px"><input type="checkbox" data-f="opt" data-optkey="' + E(def.options[0].key) + '" style="width:auto;min-height:auto"' +
        (a[def.options[0].key] ? ' checked' : '') + '> ' + E(def.options[0].label) + '</label>' : '') +
      '</div>' +
      '<div class="field full"><label>この段の扱い</label>' +
      '<label class="inline-row" style="font-size:11.5px"><input type="checkbox" data-f="mustnotskip" style="width:auto;min-height:auto"' +
      (s.mustNotSkip ? ' checked' : '') + '> この段は省略しない（該当者がいない場合、申請を止める）</label>' +
      '<div class="help">経理検収・法務レビューのように、必ず通さなければならない段に使います。' +
      '通常は該当者がいなければ自動でスキップされますが、これを入れると申請自体を止めます。</div></div>' +
      (s.type === '合議' ? '<div class="field"><label>何人の承認で次へ進むか</label>' +
        '<div class="inline-row"><select data-f="qmode" style="flex:1">' +
        RouteSpec.QUORUM_MODES.map(function (q) {
          return '<option value="' + E(q.key) + '"' + (((s.quorum || {}).mode || 'all') === q.key ? ' selected' : '') + '>' + E(q.label) + '</option>';
        }).join('') + '</select>' +
        (((s.quorum || {}).mode === 'count' || (s.quorum || {}).mode === 'percent') ?
          '<input data-f="qval" type="number" min="1" value="' + E((s.quorum || {}).value || 1) + '" style="width:90px">' +
          '<span class="page-sub">' + E((s.quorum || {}).mode === 'percent' ? '%' : '人') + '</span>' : '') +
        '</div><div class="help">例：5人中3人の承認で可決、といった規程をそのまま表せます。</div>' +
        consensusMembersHtml(s) + '</div>' : '') +
      '<div class="field"><label>標準処理日数</label>' +
      '<input data-f="days" type="number" min="1" max="30" value="' + E(s.days) + '">' +
      '<div class="help">この段に回ってきてからの日数です。超えると遅延として表示されます。</div></div>' +
      '<div class="field"><label>期限を過ぎたときの扱い</label>' +
      '<div class="inline-row"><select data-f="escmode" style="flex:1">' +
      RouteSpec.ESCALATIONS.map(function (x) {
        return '<option value="' + E(x.key) + '"' + (((s.escalate || {}).mode || 'none') === x.key ? ' selected' : '') + '>' + E(x.label) + '</option>';
      }).join('') + '</select>' +
      (((s.escalate || {}).mode && s.escalate.mode !== 'none') ?
        '<input data-f="escdays" type="number" min="1" max="60" value="' + E((s.escalate || {}).afterDays || s.days) + '" style="width:80px">' +
        '<span class="page-sub">日超過で</span>' : '') +
      '</div><div class="help">' + E(RouteSpec.escalationDef((s.escalate || {}).mode).hint) + '</div></div>' +
      '<div class="field"><label>並び順</label><div class="inline-row">' +
      '<button class="btn btn-sm" data-act="up"' + (i === 0 ? ' disabled' : '') + '>↑ 上へ</button>' +
      '<button class="btn btn-sm" data-act="down"' + (i === st.steps.length - 1 ? ' disabled' : '') + '>↓ 下へ</button>' +
      '<button class="btn btn-sm" data-act="dup">複製</button>' +
      '<button class="btn btn-sm btn-danger" data-act="del">削除</button>' +
      '</div></div>' +
      '</div>' +
      '<div class="re-cond">' +
      '<div class="re-cond-head"><strong>このステップを通す条件</strong>' +
      '<button class="btn btn-sm" data-act="cond" style="margin-left:auto">条件を編集</button></div>' +
      '<div class="re-cond-text' + (s.conditions ? '' : ' muted') + '">' +
      E(RouteSpec.describe(s.conditions, flds)) + '</div></div>' +
      '</div></div>';
  }

  /** 合議の対象者が誰になるかを実名で見せる（誰が数えられるのか分からないのを防ぐ） */
  function consensusMembersHtml(step) {
    var a = step.assignee || {};
    var dept = (a.department === '__first__') ? '' : a.department;
    if (!dept) {
      return '<div class="help">対象は「申請者の所属部署の全員（申請者本人を除く）」です。部署で指定すると対象が固定できます。</div>';
    }
    var mem = WF.departmentMembers(dept, S().employees, S().departments, a.includeSub);
    var need = RouteSpec.requiredApprovals(step, mem.length);
    if (!mem.length) return '<div class="help" style="color:var(--danger)">⚠ ' + E(dept) + ' に在籍者がいません。この段は成立しません。</div>';
    return '<div class="help">対象は ' + E(dept) + ' の ' + mem.length + '名（' +
      E(mem.slice(0, 5).map(function (m) { return m.Employee_Name; }).join('・')) + (mem.length > 5 ? ' ほか' : '') +
      '）。<strong>' + need + '名</strong>の承認で次へ進みます。</div>';
  }

  function assigneeParamHtml(def, a) {
    if (!def.params.length) return '<input value="申請者が選びます" disabled>';
    var p = def.params[0];
    if (p.type === 'number') {
      return '<input data-f="p" type="number" min="' + p.min + '" max="' + p.max + '" value="' + E(a[p.key] || p.def) + '">';
    }
    if (p.type === 'title') {
      return '<select data-f="p">' + CFG.TITLES.map(function (x) {
        return '<option' + (a.title === x ? ' selected' : '') + '>' + E(x) + '</option>';
      }).join('') + '</select>';
    }
    if (p.type === 'department') {
      return '<select data-f="p">' + S().departments.map(function (d) {
        return '<option' + (a.department === d.Department_Name ? ' selected' : '') + '>' + E(d.Department_Name) + '</option>';
      }).join('') + '</select>';
    }
    if (p.type === 'employee') {
      return '<select data-f="p"><option value="">選択してください</option>' + S().employees.map(function (e) {
        return '<option value="' + E(e.ID) + '"' + (String(a.employeeId) === String(e.ID) ? ' selected' : '') +
          '>' + E(e.Employee_Name + '（' + (e.Department_name || '') + '／' + e.Title + '）') + '</option>';
      }).join('') + '</select>';
    }
    return '<input data-f="p" value="">';
  }

  /* =======================================================================
   * 経路テスト — 保存前に流れを確かめる
   * ===================================================================== */
  function testHtml() {
    var flds = fieldsOf(st.code).filter(function (f) {
      return f.builtin || f.type === 'number' || f.type === 'choice' || f.type === 'bool';
    });
    var inputs = flds.map(function (f) {
      var v = st.test[f.key] == null ? '' : st.test[f.key];
      var input;
      if (f.type === 'number') input = '<input data-t="' + E(f.key) + '" inputmode="numeric" value="' + E(v) + '" placeholder="0">';
      else if (f.type === 'bool') input = '<select data-t="' + E(f.key) + '"><option value="">—</option>' +
        '<option value="true"' + (String(v) === 'true' ? ' selected' : '') + '>はい</option>' +
        '<option value="false"' + (String(v) === 'false' ? ' selected' : '') + '>いいえ</option></select>';
      else if (f.options && f.options.length) input = '<select data-t="' + E(f.key) + '"><option value="">—</option>' +
        f.options.map(function (o) { return '<option' + (String(v) === String(o) ? ' selected' : '') + '>' + E(o) + '</option>'; }).join('') + '</select>';
      else input = '<input data-t="' + E(f.key) + '" value="' + E(v) + '">';
      return '<div class="field"><label>' + E(f.label) + '</label>' + input + '</div>';
    }).join('');

    return '<div class="card"><div class="card-head"><div class="card-title">経路テスト</div>' +
      '<span class="tag" style="margin-left:auto">保存しなくても試せます</span></div>' +
      '<div class="card-body">' +
      '<div class="page-sub" style="margin-bottom:10px">条件を入れて「試す」を押すと、この設定でどう流れるかを表示します。' +
      '申請者を変えると、上長のたどり方も確認できます。</div>' +
      '<div class="form-grid">' +
      '<div class="field"><label>申請者として試す</label><select data-t="__applicant">' +
      S().employees.map(function (e) {
        return '<option value="' + E(e.ID) + '"' + (String(st.test.__applicant) === String(e.ID) ? ' selected' : '') +
          '>' + E(e.Employee_Name + '（' + (e.Department_name || '') + '／' + e.Title + '）') + '</option>';
      }).join('') + '</select></div>' + inputs +
      '</div><div class="inline-row" style="margin-top:12px">' +
      '<button class="btn btn-primary" data-act="runtest">この条件で試す</button>' +
      '<button class="btn" data-act="diagnose">全社員で診断する</button>' +
      '<span class="page-sub">全員分を総当たりして、承認者が決まらないケースを洗い出します</span></div>' +
      '<div id="testResult" style="margin-top:14px"></div>' +
      '</div></div>';
  }

  function runTest(el) {
    var applicant = App.employeeById(st.test.__applicant) || S().employees[0];
    var t = App.templateByCode(st.code) || { fields: [] };
    var data = {};
    Object.keys(st.test).forEach(function (k) {
      if (k.indexOf('__') === 0) return;
      data[k] = st.test[k];
    });
    var amount = st.test.__amount != null && st.test.__amount !== '' ? RouteSpec.num(st.test.__amount) : WF.amountOf(t, data);
    var ctx = {
      data: data, applicant: applicant, amount: amount, template: t,
      attachmentCount: RouteSpec.num(st.test.__attachment_count)
    };
    var route = WF.buildRoute({ fields: t.fields, route: { steps: st.steps } }, data, applicant, S().employees, ctx);
    var live = route.filter(function (s) { return !s.skipped; });
    var box = el.querySelector('#testResult');

    if (!route.length) {
      box.innerHTML = '<div class="badge b-rejected">条件に合うステップが1つもありません。このままだと申請が即座に承認済みになります。</div>';
      return;
    }
    box.innerHTML =
      '<div class="page-sub" style="margin-bottom:8px">申請金額 <strong>' + UI.yen(amount) + '</strong>／申請者 <strong>' +
      E(applicant.Employee_Name) + '（' + E(applicant.Department_name || '') + '）</strong>' +
      ' → <strong>' + live.length + '段</strong>で流れます</div>' +
      '<div class="route">' + route.map(function (s) {
        return '<div class="route-step"><div class="route-dot' + (s.skipped ? '' : ' current') + '">' +
          (s.skipped ? '–' : s.live_no) + '</div><div class="route-body">' +
          '<div class="route-name">' + E(s.name) + ' <span class="tag">' + E(s.type) + '</span>' +
          (s.mustNotSkip ? ' <span class="badge b-info">省略不可</span>' : '') + '</div>' +
          '<div class="route-meta">' + (s.skipped ? '<span class="delay">' + E(s.skipReason) + '</span>' :
            E(s.approverName) + (s.approverTitle ? '（' + E(s.approverTitle) + '）' : '') +
            (s.delegateName ? ' <span class="tag">代理：' + E(s.delegateName) + '</span>' : '') +
            (s.type === '合議' ? ' <span class="tag">' + E(RouteSpec.quorumLabel(s, (s.members || []).length)) + '</span>' : '') +
            ' ／ 標準 ' + s.days + '日' +
            ((s.escalate || {}).mode && s.escalate.mode !== 'none' ?
              '／' + s.escalate.afterDays + '日超過で' + RouteSpec.escalationDef(s.escalate.mode).label.replace(/（.*/, '') : '')) + '</div>' +
          (s.warning ? '<div class="route-meta"><span class="badge b-sentback">⚠ ' + E(s.warning) + '</span></div>' : '') +
          (s.blocking ? '<div class="route-meta"><span class="badge b-rejected">省略不可の段が成立していないため、この条件では申請できません</span></div>' : '') +
          '</div></div>';
      }).join('') + '</div>' +
      (live.length === 0 ? '<div class="badge b-rejected" style="margin-top:10px">すべてのステップがスキップされます。この条件では申請できません。</div>' : '') +
      (route.some(function (s) { return s.warning; }) ?
        '<div class="page-sub" style="margin-top:10px">⚠ の付いた段は、同じ部署に該当役職者がいないため他部署の人に回っています。' +
        '「同じ部署にいない場合、他部署には回さない」を入れるか、組織マスタを見直してください。</div>' : '');
  }

  /* =======================================================================
   * 総当たり診断
   *   「経路は正しいが組織マスタが追いついておらず、誰も承認者にならない」
   *   という事故を、本番に出す前に潰すための機能。
   *   全社員 × 金額の境界値で経路を組み、成立しないケースを列挙する。
   * ===================================================================== */

  /** 条件に出てくる金額のしきい値を集め、その境界で試す金額の一覧を作る */
  function amountSamples() {
    var vals = {};
    function walk(g) {
      if (!g) return;
      if (g.field) {
        if (g.field === '__amount' && ['gte', 'gt', 'lte', 'lt', 'between'].indexOf(g.operator) >= 0) {
          vals[RouteSpec.num(g.value)] = true;
          if (g.value2 != null) vals[RouteSpec.num(g.value2)] = true;
        }
        return;
      }
      (g.rules || []).forEach(walk);
    }
    st.steps.forEach(function (s) { walk(s.conditions); });
    var list = Object.keys(vals).map(Number).filter(function (n) { return n > 0; }).sort(function (a, b) { return a - b; });
    var out = [0];
    list.forEach(function (v) { out.push(Math.max(0, v - 1)); out.push(v); });
    out.push((list.length ? list[list.length - 1] : 100000) * 2 + 1);
    return out.filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (a, b) { return a - b; });
  }

  function diagnose(el) {
    var t = App.templateByCode(st.code) || { fields: [] };
    var emps = S().employees.filter(function (e) { return e.Is_Active !== false; });
    var amounts = amountSamples();
    var fatal = [], warn = [], okCount = 0, cases = 0;
    var topTitle = CFG.TITLES[0];
    var crossByStep = {};

    emps.forEach(function (ap) {
      var bad = null, soft = null;
      amounts.forEach(function (amt) {
        cases++;
        var route = WF.buildRoute({ fields: t.fields, route: { steps: st.steps } }, {}, ap, S().employees, {
          data: {}, applicant: ap, amount: amt, template: t, attachmentCount: 0
        });
        var live = route.filter(function (s) { return !s.skipped; });
        var unresolved = route.filter(function (s) { return s.skipped && /承認者が存在しない/.test(s.skipReason); });

        /* 致命的：誰も承認しないまま承認済みになる */
        var blocked = route.filter(function (s) { return s.blocking; });
        var crossed = route.filter(function (s) { return !s.skipped && s.warning; });
        if (!route.length) {
          bad = bad || { kind: '経路が空', detail: UI.yen(amt) + ' のとき、条件に合うステップが1つもありません', amt: amt };
        } else if (!live.length) {
          /* 組織の最上位に上長がいないだけのケースは、構造上あたりまえなので赤にしない */
          var onlyTop = (ap.Title === topTitle) && route.every(function (r) {
            var def = st.steps.filter(function (x) { return x.name === r.name; })[0];
            return !def || (def.assignee || {}).mode === 'manager';
          });
          if (onlyTop) {
            soft = soft || { kind: '最上位者は経路が組めない', detail: '上長がいないため ' + UI.yen(amt) + ' のとき申請できません。社長・会長の申請を想定するなら、上長以外の段を足してください', amt: amt };
          } else {
            bad = bad || { kind: 'この経路では申請できない', detail: UI.yen(amt) + ' のとき、承認者が1人も決まりません', amt: amt };
          }
        } else if (blocked.length) {
          bad = bad || { kind: '省略不可の段が成立しない', detail: blocked.map(function (b) { return '「' + b.name + '」'; }).join('、') + ' の該当者がいません', amt: amt };
        } else if (crossed.length) {
          /* 他部署フォールバックは段ごとにまとめて出す（人数分並べるとノイズになる） */
          crossed.forEach(function (c) {
            crossByStep[c.name] = crossByStep[c.name] || { step: c.name, warning: c.warning, depts: {} };
            crossByStep[c.name].depts[ap.Department_name || '（部署未設定）'] = true;
          });
        } else if (unresolved.length) {
          /* 注意：一部の段が解決できないが、他の段が生きているので流れる。
             ただし「組織の最上位に上長が居ない」のは構造上あたりまえなので報告しない。
             一般社員に上長が無いのはマスタの不備なので、こちらは必ず報告する。 */
          var isTopOfOrg = (ap.Title === CFG.TITLES[0]);
          var onlyTopManager = isTopOfOrg && unresolved.every(function (u) {
            var stepDef = st.steps.filter(function (x) { return x.name === u.name; })[0];
            return stepDef && (stepDef.assignee || {}).mode === 'manager';
          });
          if (!onlyTopManager) {
            soft = soft || { kind: '一部の段が決まらない', detail: unresolved.map(function (u) { return u.step_no + '段目「' + u.name + '」'; }).join('、'), amt: amt };
          }
        }
      });
      if (bad) fatal.push({ emp: ap, p: bad });
      else if (soft) warn.push({ emp: ap, p: soft });
      else okCount++;
    });

    var box = el.querySelector('#testResult');
    var head = '<div class="page-sub" style="margin-bottom:10px">在籍 ' + emps.length + '名 × 金額 ' + amounts.length +
      '通り＝' + cases + '件を検証しました。</div>';

    function table(rows, cls) {
      return '<div class="table-wrap" style="margin-bottom:12px"><table class="tbl"><thead><tr>' +
        '<th>社員</th><th>所属／役職</th><th>内容</th><th>直し方</th></tr></thead><tbody>' +
        rows.map(function (x) {
          return '<tr><td class="nowrap">' + E(x.emp.Employee_Name) + '</td>' +
            '<td class="nowrap">' + E(x.emp.Department_name || '（未設定）') + '／' + E(x.emp.Title || '（未設定）') + '</td>' +
            '<td><span class="badge ' + cls + '">' + E(x.p.kind) + '</span> ' + E(x.p.detail) + '</td>' +
            '<td class="nowrap">' + E(remedy(x)) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }

    var crossList = Object.keys(crossByStep).map(function (k) { return crossByStep[k]; });
    var crossHtml = crossList.length ?
      '<div class="card" style="border-color:var(--warning);margin-bottom:12px"><div class="card-head">' +
      '<div class="card-title">他部署の役職者に回る段（' + crossList.length + '件）</div></div>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>段</th><th>内容</th><th>対象となる申請者の部署</th><th>直し方</th></tr></thead><tbody>' +
      crossList.map(function (c) {
        return '<tr><td class="nowrap">' + E(c.step) + '</td><td>' + E(c.warning) + '</td>' +
          '<td>' + E(Object.keys(c.depts).join('・')) + '</td>' +
          '<td class="nowrap">「他部署には回さない」を入れる</td></tr>';
      }).join('') + '</tbody></table></div></div>' : '';

    if (!fatal.length && !warn.length && !crossList.length) {
      box.innerHTML = head + '<div class="badge b-approved" style="font-size:12.5px;padding:8px 14px">' +
        '全 ' + emps.length + '名について、承認者が決まらないケースはありませんでした。</div>' +
        '<div class="page-sub" style="margin-top:8px">※ 検査したのは「承認者が決まるか」「他部署に回らないか」「省略できない段が成立するか」です。' +
        '決裁権限の妥当性そのもの（誰が決裁すべきか）は判断していません。</div>';
      return;
    }
    box.innerHTML = head + crossHtml +
      (fatal.length ?
        '<div class="badge b-rejected" style="font-size:12.5px;padding:8px 14px;margin-bottom:8px">' +
        '要修正 ' + fatal.length + '名：誰の承認も経ないまま完了してしまいます</div>' + table(fatal, 'b-rejected') : '') +
      (warn.length ?
        '<div class="badge b-sentback" style="font-size:12.5px;padding:8px 14px;margin-bottom:8px">' +
        '確認 ' + warn.length + '名：一部の段で承認者が決まりません（他の段があるため申請自体は流れます）</div>' +
        table(warn, 'b-sentback') : '') +
      (!fatal.length && !warn.length ?
        '<div class="badge b-approved" style="font-size:12.5px;padding:8px 14px">承認者が決まらないケースはありませんでした。</div>' : '') +
      '<div class="page-sub">問題なし ' + okCount + '名。' +
      '「承認者が決まらない」の多くは、社員マスタの上長が未設定か、その役職の人が在籍していないことが原因です。</div>';
  }

  function remedy(x) {
    if (x.p.kind === '他部署の役職者に回る') return '「他部署には回さない」を入れる';
    if (x.p.kind === '省略不可の段が成立しない') return '該当部署に在籍者を登録';
    if (x.p.kind === 'この経路では申請できない') return '申請者以外が承認者になる段を入れる';
    if (x.p.kind === '最上位者は経路が組めない') return '上長以外の段を足す';
    if (x.p.kind === '一部の段が決まらない') {
      if (!x.emp.Manager) return '社員マスタで上長を設定';
      return '該当役職の在籍を確認';
    }
    if (x.p.kind === '経路が空') return '条件なしのステップを1つ入れる';
    if (x.p.kind === '承認されずに完了') return '申請者以外が承認者になる段を入れる';
    return 'マスタを確認';
  }

  /* =======================================================================
   * 条件エディタ（モーダル）
   * ===================================================================== */
  function openCondition(idx) {
    var s = st.steps[idx];
    var flds = fieldsOf(st.code);
    var draft = s.conditions ? JSON.parse(JSON.stringify(s.conditions)) : null;

    function body() {
      return '<div class="page-sub" style="margin-bottom:10px">条件を満たしたときだけ、このステップが経路に入ります。' +
        '条件を付けなければ必ず通ります。</div>' +
        (draft ? groupHtml(draft, []) :
          '<div class="inline-row"><span class="tag">条件なし（常に通る）</span>' +
          '<button class="btn btn-sm" data-c="addroot">条件を付ける</button></div>') +
        '<div class="re-preview" id="condPreview">' + E(RouteSpec.describe(draft, flds)) + '</div>';
    }

    function groupHtml(g, path) {
      var p = path.join('.');
      return '<div class="re-group" data-path="' + E(p) + '">' +
        '<div class="inline-row" style="margin-bottom:8px">' +
        '<select data-c="op" data-path="' + E(p) + '">' +
        '<option value="AND"' + (g.op !== 'OR' ? ' selected' : '') + '>すべてを満たす（かつ）</option>' +
        '<option value="OR"' + (g.op === 'OR' ? ' selected' : '') + '>いずれかを満たす（または）</option>' +
        '</select>' +
        (path.length ? '<button class="btn btn-sm btn-danger" data-c="delgroup" data-path="' + E(p) + '">このまとまりを削除</button>' : '') +
        '</div>' +
        (g.rules || []).map(function (r, i) {
          return r.rules ? groupHtml(r, path.concat([i])) : ruleHtml(r, path.concat([i]));
        }).join('') +
        '<div class="inline-row" style="margin-top:6px">' +
        '<button class="btn btn-sm" data-c="addrule" data-path="' + E(p) + '">＋ 条件を追加</button>' +
        (path.length < 2 ? '<button class="btn btn-sm" data-c="addgroup" data-path="' + E(p) + '">＋ 入れ子のまとまり</button>' : '') +
        '</div></div>';
    }

    function ruleHtml(r, path) {
      var p = path.join('.');
      var f = flds.filter(function (x) { return x.key === r.field; })[0] || flds[0];
      var ops = RouteSpec.operatorsFor(f.type);
      var opDef = ops.filter(function (o) { return o.key === r.operator; })[0] || ops[0];
      var valHtml = '';
      if (opDef.value === 'none') valHtml = '<input disabled value="—">';
      else if (opDef.value === 'range') {
        valHtml = '<div class="inline-row"><input data-c="val" data-path="' + E(p) + '" value="' + E(r.value) + '" style="width:44%">' +
          '<span>～</span><input data-c="val2" data-path="' + E(p) + '" value="' + E(r.value2 == null ? '' : r.value2) + '" style="width:44%"></div>';
      } else if (opDef.value === 'multi') {
        valHtml = '<input data-c="val" data-path="' + E(p) + '" value="' + E(RouteSpec.toList(r.value).join(',')) + '" placeholder="カンマ区切り">';
      } else if (f.options && f.options.length) {
        valHtml = '<select data-c="val" data-path="' + E(p) + '">' + f.options.map(function (o) {
          return '<option' + (String(r.value) === String(o) ? ' selected' : '') + '>' + E(o) + '</option>';
        }).join('') + '</select>';
      } else if (f.type === 'number') {
        var pv = RouteSpec.parseNum(r.value);
        valHtml = '<input data-c="val" data-path="' + E(p) + '" value="' + E(r.value == null ? '' : r.value) + '" placeholder="300000 または 30万">' +
          '<span class="page-sub" style="min-width:110px">' +
          (r.value === '' || r.value == null ? '金額を入力' : (isNaN(pv) ? '<span style="color:var(--danger)">数値として読めません</span>' : '＝' + UI.yen(pv))) +
          '</span>';
      } else {
        valHtml = '<input data-c="val" data-path="' + E(p) + '" value="' + E(r.value == null ? '' : r.value) + '">';
      }
      return '<div class="re-rule">' +
        '<select data-c="field" data-path="' + E(p) + '">' + flds.map(function (x) {
          return '<option value="' + E(x.key) + '"' + (x.key === r.field ? ' selected' : '') + '>' + E(x.label) + '</option>';
        }).join('') + '</select>' +
        '<select data-c="op2" data-path="' + E(p) + '">' + ops.map(function (o) {
          return '<option value="' + E(o.key) + '"' + (o.key === r.operator ? ' selected' : '') + '>' + E(o.label) + '</option>';
        }).join('') + '</select>' +
        valHtml +
        '<button class="line-del" data-c="delrule" data-path="' + E(p) + '" aria-label="削除">×</button>' +
        '</div>';
    }

    function at(path) {
      if (!path.length) return draft;
      var node = draft;
      for (var i = 0; i < path.length; i++) node = node.rules[path[i]];
      return node;
    }
    function parentOf(path) {
      if (path.length <= 0) return null;
      return path.length === 1 ? draft : at(path.slice(0, -1));
    }
    function parsePath(sv) { return sv === '' ? [] : sv.split('.').map(Number); }

    var box = UI.modal({
      title: 'ステップ「' + s.name + '」を通す条件', okText: 'この条件にする', bodyHtml: body(),
      onOk: function () {
        /* 空の値や、数値として読めない金額のまま確定させない。
           そのまま保存すると「申請金額が〔空〕以上」＝常に通る条件になってしまう。 */
        var bad = [];
        (function walk(g) {
          if (!g) return;
          if (g.field) {
            var f2 = flds.filter(function (x) { return x.key === g.field; })[0] || {};
            var op = RouteSpec.OPERATORS.filter(function (o) { return o.key === g.operator; })[0];
            if (op && op.value !== 'none') {
              if (g.value === '' || g.value == null) bad.push((f2.label || g.field) + ' の値が空です');
              else if (f2.type === 'number' && isNaN(RouteSpec.parseNum(g.value))) {
                bad.push((f2.label || g.field) + ' の「' + g.value + '」は数値として読めません（例：300000／300,000／30万）');
              }
              if (op.value === 'range') {
                if (g.value2 === '' || g.value2 == null) bad.push((f2.label || g.field) + ' の上限が空です');
                else if (isNaN(RouteSpec.parseNum(g.value2))) bad.push((f2.label || g.field) + ' の上限が数値として読めません');
              }
            }
            return;
          }
          (g.rules || []).forEach(walk);
        })(draft);
        if (bad.length) { UI.toast(bad[0], 'error'); return false; }
        /* 金額は数値に正規化して保存する（「30万」→ 300000） */
        (function norm(g) {
          if (!g) return;
          if (g.field) {
            var f2 = flds.filter(function (x) { return x.key === g.field; })[0] || {};
            if (f2.type === 'number') {
              if (g.value !== '' && g.value != null) g.value = RouteSpec.parseNum(g.value);
              if (g.value2 !== '' && g.value2 != null) g.value2 = RouteSpec.parseNum(g.value2);
            }
            return;
          }
          (g.rules || []).forEach(norm);
        })(draft);
        st.steps[idx].conditions = draft && (draft.rules || []).length ? draft : null;
        st.dirty = true;
        App.refresh();
      }
    });

    function repaint() {
      var mb = document.querySelector('.modal-body');
      mb.innerHTML = body();
      wire();
    }
    /* 入力途中は再描画するとカーソルが飛ぶので、円換算とプレビューだけ書き換える */
    function repaintPreviewOnly() {
      var pv = document.querySelector('#condPreview');
      if (pv) pv.textContent = RouteSpec.describe(draft, flds);
      document.querySelectorAll('.re-rule').forEach(function (row) {
        var inp = row.querySelector('[data-c="val"]');
        var note = row.querySelector('.page-sub');
        if (!inp || !note || inp.tagName === 'SELECT') return;
        var v = inp.value, n2 = RouteSpec.parseNum(v);
        if (v === '') note.textContent = '金額を入力';
        else if (isNaN(n2)) note.innerHTML = '<span style="color:var(--danger)">数値として読めません</span>';
        else note.textContent = '＝' + UI.yen(n2);
      });
    }
    function wire() {
      var mb = document.querySelector('.modal-body');
      mb.querySelectorAll('[data-c]').forEach(function (n) {
        var kind = n.dataset.c, path = parsePath(n.dataset.path || '');
        var ev = (n.tagName === 'SELECT') ? 'change' : (n.tagName === 'INPUT' ? 'input' : 'click');
        n.addEventListener(ev, function (e) {
          e.preventDefault();
          if (kind === 'addroot') { draft = RouteSpec.newGroup(); return repaint(); }
          if (kind === 'op') { at(path).op = n.value; return repaint(); }
          if (kind === 'addrule') { at(path).rules.push(RouteSpec.newRule(flds[0].key)); return repaint(); }
          if (kind === 'addgroup') { at(path).rules.push(RouteSpec.newGroup()); return repaint(); }
          if (kind === 'delgroup') {
            var par = parentOf(path); par.rules.splice(path[path.length - 1], 1);
            if (!draft.rules.length) draft = null;
            return repaint();
          }
          if (kind === 'delrule') {
            var pr = parentOf(path); pr.rules.splice(path[path.length - 1], 1);
            if (!draft.rules.length) draft = null;
            return repaint();
          }
          var r = at(path);
          if (kind === 'field') {
            r.field = n.value;
            var nf = flds.filter(function (x) { return x.key === r.field; })[0];
            var allowed = RouteSpec.operatorsFor(nf.type);
            if (!allowed.some(function (o) { return o.key === r.operator; })) r.operator = allowed[0].key;
            r.value = ''; r.value2 = '';
            return repaint();
          }
          if (kind === 'op2') { r.operator = n.value; return repaint(); }
          if (kind === 'val') { r.value = n.value; if (n.type !== 'select-one') { repaintPreviewOnly(); return; } }
          if (kind === 'val2') { r.value2 = n.value; repaintPreviewOnly(); return; }
          var pv = document.querySelector('#condPreview');
          if (pv) pv.textContent = RouteSpec.describe(draft, flds);
        });
      });
    }
    wire();
    return box;
  }

  /* =======================================================================
   * イベント結線
   * ===================================================================== */
  function bind(el) {
    el.querySelectorAll('[data-type]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (st.dirty && !confirm('保存していない変更があります。破棄して切り替えますか？')) return;
        st.code = b.dataset.type; st.loadedFor = null; App.refresh();
      });
    });
    el.querySelectorAll('.re-step').forEach(function (card) {
      var i = Number(card.dataset.idx);
      card.querySelectorAll('[data-f]').forEach(function (n) {
        n.addEventListener('change', function () {
          if (n.type === 'checkbox') { /* checked を使う */ }
          var s = st.steps[i];
          var k = n.dataset.f;
          if (k === 'name') s.name = n.value;
          else if (k === 'type') s.type = n.value;
          else if (k === 'days') s.days = Math.max(1, Number(n.value) || 1);
          else if (k === 'mode') {
            var def = RouteSpec.assigneeDef(n.value);
            s.assignee = { mode: n.value };
            /* 画面が「選択済み」に見えるのに内部が空、という食い違いを無くすため既定値を入れる */
            if (def.params.length) {
              var pk0 = def.params[0].key, dv = def.params[0].def;
              if (dv === '__first__') dv = (S().departments[0] || {}).Department_Name || '';
              if (dv != null && dv !== '') s.assignee[pk0] = dv;
            }
          } else if (k === 'opt') {
            s.assignee[n.dataset.optkey || 'includeSub'] = n.checked;
          } else if (k === 'mustnotskip') {
            s.mustNotSkip = n.checked;
          } else if (k === 'escmode') {
            s.escalate = { mode: n.value, afterDays: (s.escalate || {}).afterDays || s.days || 3 };
          } else if (k === 'escdays') {
            s.escalate = s.escalate || { mode: 'remind' };
            s.escalate.afterDays = Math.max(1, Number(n.value) || 1);
          } else if (k === 'qmode') {
            s.quorum = { mode: n.value, value: (s.quorum || {}).value || (n.value === 'percent' ? 100 : 1) };
            if (n.value === 'all') s.quorum = null;
          } else if (k === 'qval') {
            s.quorum = s.quorum || { mode: 'count' };
            s.quorum.value = Math.max(1, Number(n.value) || 1);
          } else if (k === 'p') {
            var d2 = RouteSpec.assigneeDef(s.assignee.mode);
            if (d2.params.length) {
              var pk = d2.params[0].key;
              s.assignee[pk] = (d2.params[0].type === 'number') ? Number(n.value) : n.value;
            }
          }
          st.dirty = true; App.refresh();
        });
      });
      card.querySelectorAll('[data-act]').forEach(function (b) {
        b.addEventListener('click', function () {
          var a = b.dataset.act;
          if (a === 'up' && i > 0) { var x = st.steps[i - 1]; st.steps[i - 1] = st.steps[i]; st.steps[i] = x; }
          else if (a === 'down' && i < st.steps.length - 1) { var y = st.steps[i + 1]; st.steps[i + 1] = st.steps[i]; st.steps[i] = y; }
          else if (a === 'dup') {
            var c = JSON.parse(JSON.stringify(st.steps[i]));
            c.id = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); c.name = c.name + '（複製）';
            st.steps.splice(i + 1, 0, c);
            st.open = {};
          } else if (a === 'del') {
            if (!confirm('このステップを削除しますか？')) return;
            st.steps.splice(i, 1);
            st.open = {};   // 位置がずれるので開閉状態は作り直す
          } else if (a === 'toggle') {
            /* 折りたたみの開閉。編集状態は変えないので dirty にしない。 */
            st.open[i] = (st.open[i] === false);
            App.refresh(); return;
          } else if (a === 'cond') { openCondition(i); return; }
          else return;
          st.dirty = true; App.refresh();
        });
      });
    });
    el.querySelectorAll('[data-t]').forEach(function (n) {
      n.addEventListener('change', function () { st.test[n.dataset.t] = n.value; });
      n.addEventListener('input', function () { st.test[n.dataset.t] = n.value; });
    });
    var head = el.querySelector('.page-actions');
    el.querySelectorAll('[data-act]').forEach(function (b) {
      if (b.closest('.re-step')) return;
      b.addEventListener('click', function () {
        var a = b.dataset.act;
        if (a === 'addstep') { st.steps.push(RouteSpec.newStep(st.steps.length + 1)); st.dirty = true; App.refresh(); }
        else if (a === 'reset') {
          if (st.dirty && !confirm('保存していない変更をすべて破棄します。よろしいですか？')) return;
          st.loadedFor = null; App.refresh();
        }
        else if (a === 'runtest') { runTest(el); }
        else if (a === 'diagnose') { diagnose(el); }
        else if (a === 'save') { save(); }
      });
    });
  }

  /* =======================================================================
   * 保存前の差分
   *   決裁基準の変更は稟議規程の改定そのものなので、
   *   「何がどう変わるか」を見せずに確定させない。
   *   特に、決裁が緩くなる方向（段が減る・決裁者が下位になる）は赤で示す。
   * ===================================================================== */
  function stepSignature(s2, t) {
    var def = RouteSpec.assigneeDef(s2.assignee.mode);
    var pk = def.params.length ? def.params[0].key : null;
    return [s2.name, s2.type, s2.assignee.mode, pk ? s2.assignee[pk] : '', s2.days,
            s2.conditions ? RouteSpec.describe(s2.conditions, fieldsOf(st.code)) : ''].join('|');
  }

  function stepDiff(before, after, t) {
    var out = [];
    var maxLen = Math.max(before.length, after.length);
    for (var i = 0; i < maxLen; i++) {
      var b = before[i], a = after[i];
      if (!b && a) { out.push({ kind: 'added', no: i + 1, text: a.name + ' を追加' }); continue; }
      if (b && !a) { out.push({ kind: 'removed', no: i + 1, text: b.name + ' を削除' }); continue; }
      if (stepSignature(b, t) === stepSignature(a, t)) continue;
      var changes = [];
      if (b.name !== a.name) changes.push('名称：' + b.name + ' → ' + a.name);
      if (b.type !== a.type) changes.push('種類：' + b.type + ' → ' + a.type);
      var bd = RouteSpec.assigneeDef(b.assignee.mode), ad = RouteSpec.assigneeDef(a.assignee.mode);
      var bp = bd.params.length ? b.assignee[bd.params[0].key] : '', ap2 = ad.params.length ? a.assignee[ad.params[0].key] : '';
      if (b.assignee.mode !== a.assignee.mode || String(bp) !== String(ap2)) {
        changes.push('承認者：' + bd.label + (bp ? '（' + bp + '）' : '') + ' → ' + ad.label + (ap2 ? '（' + ap2 + '）' : ''));
      }
      if (Number(b.days) !== Number(a.days)) changes.push('日数：' + b.days + '日 → ' + a.days + '日');
      var bc = b.conditions ? RouteSpec.describe(b.conditions, fieldsOf(st.code)) : '条件なし';
      var ac = a.conditions ? RouteSpec.describe(a.conditions, fieldsOf(st.code)) : '条件なし';
      if (bc !== ac) changes.push('条件：' + bc + ' → ' + ac);
      if (changes.length) out.push({ kind: 'changed', no: i + 1, text: a.name + '：' + changes.join('／') });
    }
    return out;
  }

  /** 金額帯ごとに、変更前後で誰が決裁するかを並べる */
  function bandDiff(before, after, t) {
    var applicant = App.employeeById(st.test.__applicant) ||
      S().employees.filter(function (e) { return e.Title === '一般' && e.Manager; })[0] || S().employees[0];
    /* 変更前後の両方のしきい値を集めて境界を作る */
    var vals = {};
    function walk(g) {
      if (!g) return;
      if (g.field) {
        if (g.field === '__amount' && ['gte', 'gt', 'lte', 'lt', 'between'].indexOf(g.operator) >= 0) {
          vals[RouteSpec.num(g.value)] = true;
          if (g.value2 != null) vals[RouteSpec.num(g.value2)] = true;
        }
        return;
      }
      (g.rules || []).forEach(walk);
    }
    before.concat(after).forEach(function (s2) { walk(s2.conditions); });
    var list = Object.keys(vals).map(Number).filter(function (n) { return n > 0; }).sort(function (a, b) { return a - b; });
    var samples = [0];
    list.forEach(function (v) { samples.push(Math.max(0, v - 1)); samples.push(v); });
    samples.push((list.length ? list[list.length - 1] : 100000) * 2 + 1);
    samples = samples.filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (a, b) { return a - b; });

    function chainOf(steps, amt) {
      var r = WF.buildRoute({ fields: t.fields, route: { steps: steps } }, {}, applicant, S().employees,
        { data: {}, applicant: applicant, amount: amt, template: t, attachmentCount: 0 });
      return r.filter(function (x) { return !x.skipped; })
        .map(function (x) { return x.name + '（' + x.approverName + '）'; });
    }
    return {
      applicant: applicant,
      rows: samples.map(function (amt) {
        var b = chainOf(before, amt), a = chainOf(after, amt);
        var same = b.join('→') === a.join('→');
        return { amt: amt, before: b, after: a, same: same, looser: a.length < b.length };
      })
    };
  }

  function showDiff(onConfirm) {
    var t = App.templateByCode(st.code) || { fields: [] };
    var before = RouteSpec.normalize(t.route, t).steps;
    var sd = stepDiff(before, st.steps, t);
    var bd = bandDiff(before, st.steps, t);
    var changed = bd.rows.filter(function (r) { return !r.same; });
    var looser = bd.rows.filter(function (r) { return r.looser; });

    var kindLabel = { added: '追加', removed: '削除', changed: '変更' };
    var kindCls = { added: 'b-approved', removed: 'b-rejected', changed: 'b-progress' };
    var html =
      (sd.length ?
        '<div class="page-sub" style="margin-bottom:6px">ステップの変更</div>' +
        '<ul style="padding-left:18px;line-height:1.9;margin-bottom:14px">' +
        sd.map(function (d) {
          return '<li><span class="badge ' + kindCls[d.kind] + '">' + kindLabel[d.kind] + '</span> ' + E(d.text) + '</li>';
        }).join('') + '</ul>'
        : '<div class="page-sub" style="margin-bottom:14px">ステップの構成に変更はありません。</div>') +
      (changed.length ?
        '<div class="page-sub" style="margin-bottom:6px">金額帯ごとの決裁者（' + E(bd.applicant.Employee_Name) +
        ' さんが申請した場合）</div>' +
        '<div class="table-wrap"><table class="tbl"><thead><tr><th class="num">申請金額</th><th>変更前</th><th>変更後</th></tr></thead><tbody>' +
        changed.map(function (r) {
          return '<tr' + (r.looser ? ' style="background:var(--danger-weak)"' : '') + '>' +
            '<td class="num nowrap">' + UI.yen(r.amt) + '</td>' +
            '<td>' + (r.before.length ? E(r.before.join(' → ')) : '<span class="delay">申請できません</span>') + '</td>' +
            '<td>' + (r.after.length ? E(r.after.join(' → ')) : '<span class="delay">申請できません</span>') +
            (r.looser ? ' <span class="badge b-rejected">決裁が減ります</span>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>'
        : '<div class="page-sub">この変更で、決裁者の顔ぶれが変わる金額帯はありませんでした。</div>') +
      (looser.length ?
        '<div class="badge b-rejected" style="display:block;margin-top:12px;padding:8px 12px;font-size:12px">' +
        '⚠ ' + looser.length + 'つの金額帯で決裁の段数が減ります。決裁権限規程と整合しているか確認してください。</div>' : '') +
      '<div class="page-sub" style="margin-top:12px">※ 進行中の申請は、申請時の経路で最後まで流れます。この変更は新しい申請から適用されます。</div>';

    UI.modal({
      title: 'この変更を保存しますか',
      bodyHtml: html,
      okText: '保存する',
      okClass: looser.length ? 'btn-warning' : 'btn-primary',
      onOk: onConfirm
    });
  }

  /* ---------- 保存 ---------- */
  function save() {
    var t = App.templateByCode(st.code) || { fields: [] };
    /* 設定として成立しないものは保存を拒否する。
       「気になります → それでも保存する」だと必ず押されるため、
       直さないと保存できないものと、注意喚起にとどめるものを分ける。 */
    var errors = RouteSpec.problems(st.steps, t).map(function (p) { return p.message; });
    st.steps.forEach(function (s2, i) {
      if (!s2.name) errors.push((i + 1) + '段目のステップ名が空です。');
      var def = RouteSpec.assigneeDef(s2.assignee.mode);
      if (def.params.length && !s2.assignee[def.params[0].key]) {
        errors.push((i + 1) + '段目「' + s2.name + '」の' + def.params[0].label + 'が未設定です。');
      }
    });
    if (errors.length) {
      UI.modal({
        title: 'この内容では保存できません',
        bodyHtml: '<div class="page-sub" style="margin-bottom:10px">次を直してから保存してください。</div>' +
          '<ul style="padding-left:18px;line-height:1.9">' + errors.map(function (m) { return '<li>' + E(m) + '</li>'; }).join('') + '</ul>',
        cancelText: '閉じる'
      });
      return;
    }
    var warnings = validate();
    if (warnings.length) {
      UI.modal({
        title: '保存前の確認', okText: '確認して次へ', okClass: 'btn-warning',
        bodyHtml: '<div class="page-sub" style="margin-bottom:10px">次の点が気になります。</div>' +
          '<ul style="padding-left:18px;line-height:1.9">' + warnings.map(function (p) { return '<li>' + E(p) + '</li>'; }).join('') + '</ul>',
        onOk: function () { setTimeout(function () { showDiff(doSave); }, 80); }
      });
      return;
    }
    showDiff(doSave);
  }
  function validate() {
    var out = [];
    if (!st.steps.length) out.push('ステップが1つもありません。この申請区分は申請できなくなります（承認者が決まらないため送信が止まります）。');
    st.steps.forEach(function (s, i) {
      if (!s.name) out.push((i + 1) + '段目のステップ名が空です。');
      var def = RouteSpec.assigneeDef(s.assignee.mode);
      if (def.params.length) {
        var pk = def.params[0].key;
        if (!s.assignee[pk]) out.push((i + 1) + '段目「' + s.name + '」の' + def.params[0].label + 'が未設定です。');
      }
      if (s.type === '回覧' && s.conditions == null && i === st.steps.length - 1 && st.steps.length === 1) {
        out.push('回覧だけの経路です。承認の記録は残りません。');
      }
    });
    var noCond = st.steps.filter(function (s) { return !s.conditions; });
    if (st.steps.length && !noCond.length) {
      out.push('すべてのステップに条件が付いています。条件に合わない申請は承認者が決まらず、申請できません。条件なしのステップを1つ入れてください。');
    }
    /* 保存前に総当たりを走らせ、成立しない社員がいれば知らせる */
    var t = App.templateByCode(st.code) || { fields: [] };
    var emps = S().employees.filter(function (e) { return e.Is_Active !== false; });
    var ng = emps.filter(function (ap) {
      var route = WF.buildRoute({ fields: t.fields, route: { steps: st.steps } }, {}, ap, S().employees,
        { data: {}, applicant: ap, amount: 999999999, template: t, attachmentCount: 0 });
      return !route.filter(function (s) { return !s.skipped; }).length;
    });
    if (ng.length) {
      out.push(emps.length + '名中 ' + ng.length + '名（' + ng.slice(0, 3).map(function (e) { return e.Employee_Name; }).join('、') +
        (ng.length > 3 ? ' ほか' : '') + '）は、この経路で承認者が1人も決まらず、申請できません。「全社員で診断する」で詳細を確認してください。');
    }
    return out;
  }
  function doSave() {
    var t = App.templateByCode(st.code);
    /* 変更前の定義を証跡に残す（決裁基準をいつ誰が何から何に変えたかの証明） */
    var before = '';
    try {
      before = RouteSpec.normalize(t.route, t).steps.map(function (s2) {
        return s2.name + '(' + (s2.assignee || {}).mode + ')' +
          (s2.conditions ? '〔' + RouteSpec.describe(s2.conditions, RouteSpec.fieldsFor(t, masters())) + '〕' : '');
      }).join(' → ');
    } catch (e) { before = '(取得できず)'; }
    var rule = { version: 2, steps: st.steps };
    var rec = S().requestTypes.filter(function (r) { return r.Type_Code === st.code; })[0];
    var json = JSON.stringify(rule);

    function after() {
      t.route = rule;                       // 画面上のテンプレートも差し替える
      st.dirty = false;
      App.audit('承認経路の変更', '申請テンプレート', st.code,
        t.name + '／' + st.steps.length + '段：' + st.steps.map(function (s2) { return s2.name; }).join(' → ') +
        '／変更前：' + (before || '(なし)') + '／変更後の定義：' + json.slice(0, 1200));
      UI.toast('承認経路を保存しました', 'success');
      App.refresh();
    }
    if (rec) {
      rec.Route_Rule = json;
      DB.update('RequestTypes', rec.ID, { Route_Rule: json }).then(after).catch(function (e) {
        UI.toast('保存に失敗しました：' + (e && e.message ? e.message : e), 'error');
      });
    } else {
      /* Creator に申請テンプレートが未登録の場合は新規に作る */
      DB.add('RequestTypes', {
        Type_Code: t.code, Type_Name: t.name, Category: t.category, Icon: t.icon,
        Description: t.desc, Field_Schema: JSON.stringify({ fields: t.fields }), Route_Rule: json,
        Sensitivity: CFG.ACCESS.SENSITIVITY[t.code] || 'C', Sort_Order: 99, Is_Active: true
      }).then(function (saved) { S().requestTypes.push(saved); after(); }).catch(function (e) {
        UI.toast('保存に失敗しました：' + (e && e.message ? e.message : e), 'error');
      });
    }
  }

  return { render: render, _state: st };
})();
