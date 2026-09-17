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
    test: {}           // 経路テストの入力値
  };

  /* ---------- マスタ ---------- */
  function masters() {
    return {
      departments: S().departments.map(function (d) { return d.Department_Name; }),
      titles: CFG.TITLES
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
    return '<div class="re-step" data-idx="' + i + '">' +
      '<div class="re-step-no">' + (i + 1) + '</div>' +
      '<div class="re-step-body">' +
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
        '<label class="inline-row" style="margin-top:6px;font-size:11.5px"><input type="checkbox" data-f="opt" style="width:auto;min-height:auto"' +
        (a.includeSub ? ' checked' : '') + '> ' + E(def.options[0].label) + '</label>' : '') +
      '</div>' +
      (s.type === '合議' ? '<div class="field"><label>何人の承認で次へ進むか</label>' +
        '<div class="inline-row"><select data-f="qmode" style="flex:1">' +
        RouteSpec.QUORUM_MODES.map(function (q) {
          return '<option value="' + E(q.key) + '"' + (((s.quorum || {}).mode || 'all') === q.key ? ' selected' : '') + '>' + E(q.label) + '</option>';
        }).join('') + '</select>' +
        (((s.quorum || {}).mode === 'count' || (s.quorum || {}).mode === 'percent') ?
          '<input data-f="qval" type="number" min="1" value="' + E((s.quorum || {}).value || 1) + '" style="width:90px">' +
          '<span class="page-sub">' + E((s.quorum || {}).mode === 'percent' ? '%' : '人') + '</span>' : '') +
        '</div><div class="help">例：5人中3人の承認で可決、といった規程をそのまま表せます。</div></div>' : '') +
      '<div class="field"><label>標準処理日数</label>' +
      '<input data-f="days" type="number" min="1" max="30" value="' + E(s.days) + '">' +
      '<div class="help">この段に回ってきてからの日数です。超えると遅延として表示されます。</div></div>' +
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
          (s.skipped ? '–' : s.step_no) + '</div><div class="route-body">' +
          '<div class="route-name">' + E(s.name) + ' <span class="tag">' + E(s.type) + '</span></div>' +
          '<div class="route-meta">' + (s.skipped ? '<span class="delay">' + E(s.skipReason) + '</span>' :
            E(s.approverName) + (s.approverTitle ? '（' + E(s.approverTitle) + '）' : '') +
            (s.delegateName ? ' <span class="tag">代理：' + E(s.delegateName) + '</span>' : '') +
            ' ／ 標準 ' + s.days + '日') + '</div></div></div>';
      }).join('') + '</div>' +
      (live.length === 0 ? '<div class="badge b-rejected" style="margin-top:10px">すべてのステップがスキップされます。承認者が存在しないか、条件に合っていません。</div>' : '');
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
        if (!route.length) {
          bad = bad || { kind: '経路が空', detail: UI.yen(amt) + ' のとき、条件に合うステップが1つもありません', amt: amt };
        } else if (!live.length) {
          bad = bad || { kind: '承認されずに完了', detail: UI.yen(amt) + ' のとき、全ステップがスキップされます', amt: amt };
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

    if (!fatal.length && !warn.length) {
      box.innerHTML = head + '<div class="badge b-approved" style="font-size:12.5px;padding:8px 14px">' +
        '全 ' + emps.length + '名で経路が成立しました。このまま保存して問題ありません。</div>';
      return;
    }
    box.innerHTML = head +
      (fatal.length ?
        '<div class="badge b-rejected" style="font-size:12.5px;padding:8px 14px;margin-bottom:8px">' +
        '要修正 ' + fatal.length + '名：誰の承認も経ないまま完了してしまいます</div>' + table(fatal, 'b-rejected') : '') +
      (warn.length ?
        '<div class="badge b-sentback" style="font-size:12.5px;padding:8px 14px;margin-bottom:8px">' +
        '確認 ' + warn.length + '名：一部の段で承認者が決まりません（他の段があるため申請自体は流れます）</div>' +
        table(warn, 'b-sentback') : '') +
      '<div class="page-sub">問題なし ' + okCount + '名。' +
      '「承認者が決まらない」の多くは、社員マスタの上長が未設定か、その役職の人が在籍していないことが原因です。</div>';
  }

  function remedy(x) {
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
    function wire() {
      var mb = document.querySelector('.modal-body');
      mb.querySelectorAll('[data-c]').forEach(function (n) {
        var kind = n.dataset.c, path = parsePath(n.dataset.path || '');
        var ev = (n.tagName === 'SELECT' || n.tagName === 'INPUT') ? 'change' : 'click';
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
          if (kind === 'val') { r.value = n.value; }
          if (kind === 'val2') { r.value2 = n.value; }
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
            if (def.params.length && def.params[0].def != null) s.assignee[def.params[0].key] = def.params[0].def;
          } else if (k === 'opt') {
            s.assignee.includeSub = n.checked;
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
            c.id = 's' + Date.now().toString(36); c.name = c.name + '（複製）';
            st.steps.splice(i + 1, 0, c);
          } else if (a === 'del') {
            if (!confirm('このステップを削除しますか？')) return;
            st.steps.splice(i, 1);
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
        else if (a === 'reset') { st.loadedFor = null; App.refresh(); }
        else if (a === 'runtest') { runTest(el); }
        else if (a === 'diagnose') { diagnose(el); }
        else if (a === 'save') { save(); }
      });
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
        title: '保存前の確認', okText: 'それでも保存する', okClass: 'btn-warning',
        bodyHtml: '<div class="page-sub" style="margin-bottom:10px">次の点が気になります。</div>' +
          '<ul style="padding-left:18px;line-height:1.9">' + warnings.map(function (p) { return '<li>' + E(p) + '</li>'; }).join('') + '</ul>',
        onOk: doSave
      });
      return;
    }
    doSave();
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
