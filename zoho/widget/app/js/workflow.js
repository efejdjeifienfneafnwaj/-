/* =========================================================================
 * workflow.js — 承認経路エンジン
 *  ・金額などの条件で経路を動的に組み立てる（職務権限規程の再現）
 *  ・申請者＝承認者、承認者不在は理由付きで自動スキップ
 *  ・代理承認（職務代行）を期間で判定
 *  ・承認 / 却下 / 差戻し / 条件付承認 / 既読（回覧）の遷移
 * ========================================================================= */
var WF = (function () {

  /* ---------- 条件評価 ---------- */
  /* 数値の解釈は RouteSpec.num に一本化する（全角数字の扱いが食い違うのを防ぐ） */
  function num(v) { return RouteSpec.num(v); }
  function match(when, data) {
    if (!when) return true;
    var v = data[when.field];
    if (when.eq !== undefined) return String(v) === String(when.eq);
    if (when.neq !== undefined) return String(v) !== String(when.neq);
    if (when.in !== undefined) return when.in.indexOf(v) >= 0;
    var n = num(v);
    if (when.gte !== undefined && n < when.gte) return false;
    if (when.gt !== undefined && n <= when.gt) return false;
    if (when.lte !== undefined && n > when.lte) return false;
    if (when.lt !== undefined && n >= when.lt) return false;
    return true;
  }

  /* ---------- 承認者の解決 ---------- */
  /** 承認者の指定を人が読める言葉にする（不在時の案内に使う） */
  function assigneeLabel(step) {
    var a = step.assignee || {};
    if (a.mode === 'manager') return (a.level > 1 ? a.level + '段上の上長' : '直属の上長');
    if (a.mode === 'title') return (a.department ? a.department + 'の' : '') + (a.title || '指定役職');
    if (a.mode === 'department') return (a.department || '指定部署') + 'の責任者';
    if (a.mode === 'fixed') return '指定された承認者';
    return '指定された承認者';
  }
  /**
   * 承認者が1人も決まらない段の受け皿。
   * そのまま段を消すと、誰も決裁しないまま承認済になってしまう。
   * 代わりにシステム管理者へ回し、暫定であることを経路に明示する。
   * ここで自動承認は絶対にしない（必ず人が押す）。
   */
  function fallbackApprover(applicant, employees) {
    var cand = (employees || []).filter(function (e) {
      return e.Is_Active !== false &&
        ((e.Roles || []).indexOf('管理者') >= 0) &&
        (!applicant || String(e.ID) !== String(applicant.ID));
    });
    cand.sort(function (x, y) { return CFG.TITLES.indexOf(x.Title) - CFG.TITLES.indexOf(y.Title); });
    return cand[0] || null;
  }
  function resolveAssignee(step, applicant, employees, deptName) {
    var a = step.assignee || {};
    var byId = {}; employees.forEach(function (e) { byId[String(e.ID)] = e; });
    function active(e) { return (e && e.Is_Active !== false) ? e : null; }
    if (a.mode === 'fixed') return active(byId[String(a.employeeId)]);
    if (a.mode === 'manager') {
      /* 上長をたどる。途中に退職者がいたら、その人を飛ばしてさらに上をたどる。 */
      var cur = applicant, lv = a.level || 1, guard = 0;
      for (var i = 0; i < lv; i++) {
        do {
          cur = (cur && cur.Manager) ? byId[String(cur.Manager)] : null;
          guard++;
        } while (cur && cur.Is_Active === false && guard < 20);
        if (!cur) return null;
      }
      return active(cur);
    }
    if (a.mode === 'title') {
      var dept = deptName || (applicant && (applicant.Department_name || applicant.Department));
      var sameDept = employees.filter(function (e) { return e.Is_Active !== false && e.Title === a.title && (e.Department_name || e.Department) === dept; });
      if (sameDept.length) return sameDept[0];
      if (a.noCrossDept) return null;              // 部署外へのフォールバックを禁止する設定
      /* 同部署に該当者がいない場合、他部署の同役職へ回る。
         決裁権限のない他部署の人に回ることになるため、印を付けて画面に警告を出す。 */
      var any = employees.filter(function (e) { return e.Is_Active !== false && e.Title === a.title; });
      if (any[0]) { any[0]._crossDeptFallback = true; }
      return any[0] || null;
    }
    if (a.mode === 'department') {
      var mem = departmentMembers(a.department, employees, (typeof App !== 'undefined' && App.state) ? App.state.departments : null, a.includeSub);
      /* 部署内で最上位の役職者を代表承認者にする */
      mem.sort(function (x, y) { return CFG.TITLES.indexOf(x.Title) - CFG.TITLES.indexOf(y.Title); });
      return mem[0] || null;
    }
    if (a.mode === 'applicantSelect') return null; // 申請時に選択
    return null;
  }
  /**
   * 部署のメンバーを集める
   * @param {boolean} includeSub 下位部署も含めるか（部署マスタの親子関係をたどる）
   */
  function departmentMembers(deptName, employees, departments, includeSub) {
    var names = [deptName];
    if (includeSub && departments && departments.length) {
      var byId = {}, byName = {};
      departments.forEach(function (d) { byId[String(d.ID)] = d; byName[d.Department_Name] = d; });
      var root = byName[deptName];
      if (root) {
        var queue = [String(root.ID)];
        while (queue.length) {
          var cur = queue.shift();
          departments.forEach(function (d) {
            if (String(d.Parent_Department) === cur && names.indexOf(d.Department_Name) < 0) {
              names.push(d.Department_Name); queue.push(String(d.ID));
            }
          });
        }
      }
    }
    return employees.filter(function (e) {
      return e.Is_Active !== false && names.indexOf(e.Department_name || e.Department) >= 0;
    });
  }

  /* ---------- 代理承認（職務代行）の判定 ---------- */
  function delegateOf(emp, employees, onDate) {
    if (!emp || !emp.Deputy) return null;
    var d = onDate ? new Date(onDate) : new Date();
    var from = emp.Deputy_From ? new Date(emp.Deputy_From) : null;
    var to = emp.Deputy_To ? new Date(emp.Deputy_To) : null;
    if (from && d < from) return null;
    if (to && d > to) return null;
    var byId = {}; employees.forEach(function (e) { byId[String(e.ID)] = e; });
    return byId[String(emp.Deputy)] || null;
  }

  /**
   * 経路を組み立てる
   * @returns {Array} [{step_no, name, type, approverId, approverName, days, skipped, skipReason, members[]}]
   */
  /**
   * 経路を組み立てる
   * @param {object} template  申請テンプレート（route.steps を持つ）
   * @param {object} formData  入力値
   * @param {object} applicant 申請者
   * @param {array}  employees 社員一覧
   * @param {object} [ctxIn]   条件評価に使う文脈（経路テストから差し込む用）
   * @returns {Array} [{step_no, name, type, approverId, approverName, days, skipped, skipReason, members[]}]
   */
  function buildRoute(template, formData, applicant, employees, ctxIn) {
    var spec = RouteSpec.normalize(template.route || { steps: [] }, template);
    var steps = spec.steps;
    var ctx = ctxIn || {
      data: formData || {},
      applicant: applicant,
      amount: amountOf(template, formData || {}),
      template: template,
      attachmentCount: 0
    };
    var out = [], no = 0, seen = {};
    steps.forEach(function (st) {
      /* 条件に合致しない段はそもそも生成しない */
      if (!RouteSpec.evalGroup(st.conditions, ctx)) return;
      var approver = null, members = [], needsPick = false;
      var pickKey = '__approver_' + (st.id || st.name);
      if ((st.assignee || {}).mode === 'applicantSelect') {
        var picked = (ctx.data || {})[pickKey];
        if (picked) {
          var byId = {}; employees.forEach(function (e) { byId[String(e.ID)] = e; });
          approver = byId[String(picked)] || null;
        } else {
          needsPick = true;   // 申請画面で選んでもらう。未選択でも段は消さない。
        }
      } else {
        approver = resolveAssignee(st, applicant, employees);
      }
      if (st.type === '合議' || st.type === '或議') {
        members = departmentMembers(
          (st.assignee || {}).department || (applicant && applicant.Department_name), employees,
          (typeof App !== 'undefined' && App.state) ? App.state.departments : null,
          (st.assignee || {}).includeSub);
        /* 申請者本人は自分の申請の合議に加われない */
        members = members.filter(function (m) { return !applicant || String(m.ID) !== String(applicant.ID); });
        /* 代表者が申請者本人だと段ごと消えてしまうため、メンバーの次順位に繰り上げる。
           部門長が自ら起票した退職・入社手続きで、部門の合議が丸ごと落ちるのを防ぐ。 */
        if (applicant && approver && String(approver.ID) === String(applicant.ID) && members.length) {
          var byId2 = {}; employees.forEach(function (e) { byId2[String(e.ID)] = e; });
          approver = byId2[String(members[0].ID)] || null;
        }
      }
      no++;
      var row = {
        step_no: no, name: st.name, type: st.type || '承認', days: st.days || 3,
        approverId: approver ? approver.ID : '', approverName: approver ? approver.Employee_Name : '（該当者なし）',
        approverTitle: approver ? approver.Title : '',
        members: members.map(function (m) { return { id: m.ID, name: m.Employee_Name }; }),
        quorum: st.quorum || null,
        mustNotSkip: !!st.mustNotSkip,
        escalate: st.escalate || { mode: 'none', afterDays: st.days || 3 },
        required: (st.type === '合議') ? RouteSpec.requiredApprovals(st, members.length) : 1,
        skipped: false, skipReason: '',
        needsPick: needsPick, pickKey: pickKey
      };
      /* 自動スキップ判定（重複は後段を残すため、ここでは判定しない） */
      if (needsPick) { row.approverName = '（申請時に選択）'; }
      else if (!approver) { row.skipped = true; row.skipReason = '該当する承認者が存在しないため自動スキップ'; row.assigneeLabel = assigneeLabel(st); }
      else if (applicant && String(approver.ID) === String(applicant.ID)) { row.skipped = true; row.skipReason = '申請者本人のため自動スキップ'; }
      if (approver && approver._crossDeptFallback) {
        row.crossDeptFallback = true;
        row.warning = '同じ部署に' + ((st.assignee || {}).title || '該当役職') + 'がいないため、他部署の' + approver.Employee_Name + ' が承認します';
        delete approver._crossDeptFallback;
      }
      if (st.mustNotSkip && row.skipped) {
        row.blocking = true;   // 統制上、省略してはいけない段（経理検収・法務レビューなど）
      }
      /* 代理承認 */
      if (!row.skipped && approver) {
        var dep = delegateOf(approver, employees);
        if (dep) { row.delegateId = dep.ID; row.delegateName = dep.Employee_Name; }
      }
      out.push(row);
    });

    /* 重複の解消：同じ人が複数の「承認」段に現れる場合、
       後の段（＝より上位の決裁）を残し、先の段をスキップする。
       先に消すと上位決裁が消えてしまい、内部統制上まったく逆の結果になる。 */
    /* 重複は「承認者本人」で判定する。
       代理人で判定すると、2人の承認者がたまたま同じ人を代理に立てているだけで
       別人の決裁段が消えてしまう（代理期間が終わっても経路は凍結済みなので戻らない）。 */
    var lastIndexOf = {};
    out.forEach(function (r, i) {
      if (r.skipped || r.type !== '承認' || !r.approverId) return;
      lastIndexOf[String(r.approverId)] = i;
    });
    out.forEach(function (r, i) {
      if (r.skipped || r.type !== '承認' || !r.approverId) return;
      var last = lastIndexOf[String(r.approverId)];
      if (last !== i) {
        r.skipped = true;
        r.skipReason = r.approverName + ' は' + (out[last].step_no) + '段目「' + out[last].name + '」でも承認するため、上位の段に統合しました';
        r.mergedInto = out[last].step_no;
      }
    });
    /* 代理人が複数段に重なる場合は、統合せずに知らせるだけにする。
       決裁の階層は保ったまま、同一人物が続けて押すことになる点を示す。 */
    var seenDelegate = {};
    out.forEach(function (r) {
      if (r.skipped || !r.delegateId) return;
      var k = String(r.delegateId);
      if (seenDelegate[k]) {
        r.warning = (r.warning ? r.warning + '／' : '') +
          r.delegateName + ' が ' + seenDelegate[k] + ' と この段の両方を代理で処理します';
      } else {
        seenDelegate[k] = r.step_no + '段目「' + r.name + '」';
      }
    });
    /* 生きた段が1つも残らなかったときだけ、最後の受け皿を立てる。
       ここで何もしないと、経路が空の申請は出すことすらできない（導入直後がこれにあたる）。
       段が1つでも生きている経路には手を触れない（既存の決裁順序を勝手に変えないため）。
       自動承認は絶対にしない。必ず誰かが承認ボタンを押し、その記録が残る。 */
    if (applicant && out.length && !out.some(function (r) { return !r.skipped && r.type !== '回覧'; })) {
      /* 回覧は「読んだ」だけで決裁ではないため、承認の段を生かす。最後尾＝最上位を選ぶ。 */
      var approvalRows = out.filter(function (r) { return r.type !== '回覧'; });
      var target = approvalRows[approvalRows.length - 1];
      if (target) {
        /* 組織の最上位（社長）は、上長がいないのが当たり前。
           部下を承認者に立てるのは決裁として逆立ちするので、本人の決裁として通す。 */
        var isOrgTop = applicant.Title === CFG.TITLES[0];
        var fb = isOrgTop ? null : fallbackApprover(applicant, employees);
        if (fb) {
          target.skipped = false; target.skipReason = '';
          target.approverId = fb.ID; target.approverName = fb.Employee_Name; target.approverTitle = fb.Title;
          target.fallbackAdmin = true;
          target.warning = '「' + (target.assigneeLabel || target.name) + '」にあたる社員が登録されていないため、' +
            '暫定でシステム管理者（' + fb.Employee_Name + '）が承認します。' +
            '社員マスタに役職と上長を登録すると、次の申請から本来の承認者に切り替わります。';
          var dep2 = delegateOf(fb, employees);
          if (dep2) { target.delegateId = dep2.ID; target.delegateName = dep2.Employee_Name; }
        } else if (isOrgTop || !(employees || []).some(function (e) {
          return e.Is_Active !== false && String(e.ID) !== String(applicant.ID);
        })) {
          /* 承認できる人が他にいない。自己承認として明示して通す（自動承認はしない）。 */
          target.skipped = false; target.skipReason = '';
          target.approverId = applicant.ID; target.approverName = applicant.Employee_Name;
          target.approverTitle = applicant.Title;
          target.selfApproval = true;
          target.selfApprovalOrgTop = isOrgTop;
          target.warning = isOrgTop
            ? applicant.Title + 'には上長がいないため、この申請はご本人の決裁になります（自己承認として証跡に残ります）。' +
              '別の人の承認を通したい場合は、承認経路に役職や部署を指定した段を足してください。'
            : '承認できる社員が他に登録されていないため、あなた自身が承認する形になります。' +
              '自己承認として証跡に残ります。社員を登録すると、次の申請から本来の承認者に切り替わります。';
        }
      }
    }

    /* 実際に流れる段に通し番号を振り直す（画面の「N段で流れます」と一致させる） */
    var liveNo = 0;
    out.forEach(function (r) { if (!r.skipped) { liveNo++; r.live_no = liveNo; } });
    return out;
  }

  /** 経路が成立しているか（1段でも生きた承認段があるか）を判定する */
  /**
   * 経路が成立しているか。
   *  回覧（既読のみ）は承認ではないため、回覧だけの経路は成立とみなさない。
   *  みなしてしまうと、誰の承認も無いまま「承認済」のレコードが生まれ、
   *  経理処理や仕訳出力の対象になってしまう。
   *  申請者が承認者を選ぶ段は、選ばれていなければ未成立として扱う。
   */
  function isRoutable(route) {
    return (route || []).some(function (s) {
      if (s.skipped) return false;
      if (s.type === '回覧') return false;
      if (s.needsPick && !s.approverId) return false;
      return true;
    });
  }
  /** 省略できない段が成立していない場合、その一覧を返す */
  function blockingSteps(route) {
    return (route || []).filter(function (s) { return s.blocking; });
  }

  /** 経路のうち、現在処理すべきステップ番号（1始まり）。完了なら 0 */
  function currentStep(route) {
    for (var i = 0; i < route.length; i++) {
      if (route[i].skipped) continue;
      if (route[i].action === CFG.ACTION.PENDING || !route[i].action) return route[i].step_no;
    }
    return 0;
  }

  /**
   * ある社員がそのステップを処理できるか（本人 or 代理人 or 合議メンバー）
   * @param {object} [opt] {req, route, employees} を渡すと、期限超過による権限の拡張も判定する
   */
  function canAct(step, meId, opt) {
    if (!step) return false;
    if (String(step.approverId) === String(meId)) return true;
    if (step.delegateId && String(step.delegateId) === String(meId)) return true;
    if ((step.type === '合議' || step.type === '或議') && (step.members || []).some(function (m) { return String(m.id) === String(meId); })) return true;
    /* 期限を過ぎた段は、設定があれば承認者の上長にも権限が広がる */
    if (opt && opt.req && escalatedTo(step, opt.req, opt.route, opt.employees).some(function (e) { return String(e.ID) === String(meId); })) return true;
    return false;
  }

  /** 期限超過で権限が広がる相手を返す（拡張の設定が無ければ空） */
  function escalatedTo(step, req, route, employees) {
    if (!step || step.action) return [];
    var esc = step.escalate || {};
    if (esc.mode !== 'expand') return [];
    if (!isEscalated(step, req, route)) return [];
    var byId = {}; (employees || []).forEach(function (e) { byId[String(e.ID)] = e; });
    var approver = byId[String(step.approverId)];
    var boss = approver && approver.Manager ? byId[String(approver.Manager)] : null;
    return (boss && boss.Is_Active !== false) ? [boss] : [];
  }

  /** エスカレーションの起算日を過ぎているか */
  function isEscalated(step, req, route) {
    if (!step || step.action) return false;
    var esc = step.escalate || {};
    if (!esc.mode || esc.mode === 'none') return false;
    var base = stepStartedAt(req, route || [], step);
    if (!base) return false;
    var days = Math.max(1, Number(esc.afterDays) || Number(step.days) || 3);
    return new Date() > new Date(new Date(base).getTime() + days * 86400000);
  }

  /**
   * ステップへの処理を適用し、申請全体の新ステータスを返す
   * @returns {{status:string, route:Array, nextStep:number}}
   */
  function applyAction(req, route, stepNo, meId, meName, action, comment, targetStepNo) {
    var idx = -1;
    for (var i = 0; i < route.length; i++) if (route[i].step_no === stepNo) idx = i;
    if (idx < 0) return { status: req.Status, route: route, nextStep: stepNo };
    var s = route[idx];
    var isDelegate = s.delegateId && String(s.delegateId) === String(meId);

    if (s.type === '合議' && action === CFG.ACTION.APPROVE) {
      s.approvedBy = s.approvedBy || [];
      if (s.approvedBy.indexOf(String(meId)) < 0) s.approvedBy.push(String(meId));
      s.comments = (s.comments || []).concat([{ by: meName, at: DB.nowISO(), text: comment || '' }]);
      var need = s.required || RouteSpec.requiredApprovals(s, (s.members || []).length) || 1;
      if (s.approvedBy.length < need) {
        return { status: CFG.STATUS.ACTIVE, route: route, nextStep: stepNo }; // 全員承認までこの段に留まる
      }
    }
    s.action = action;
    s.acted_by = meId; s.acted_by_name = meName + (isDelegate ? '（代理：' + s.approverName + ' の職務代行）' : '');
    s.acted_on = DB.nowISO();
    s.comment = comment || '';

    if (action === CFG.ACTION.REJECT) return { status: CFG.STATUS.REJECTED, route: route, nextStep: 0 };
    if (action === CFG.ACTION.SENDBACK) {
      if (targetStepNo) {
        for (var j = 0; j < route.length; j++) {
          if (route[j].step_no >= targetStepNo) { route[j].action = ''; route[j].acted_by = ''; route[j].acted_on = ''; route[j].approvedBy = []; }
        }
        return { status: CFG.STATUS.ACTIVE, route: route, nextStep: targetStepNo };
      }
      return { status: CFG.STATUS.SENTBACK, route: route, nextStep: 0 };
    }
    var next = currentStep(route);
    /* 次の段に回った時刻を記録しておく（遅延判定と督促の起点になる） */
    route.forEach(function (x) { if (x.step_no === next && !x.started_on) x.started_on = DB.nowISO(); });
    return { status: next === 0 ? CFG.STATUS.APPROVED : CFG.STATUS.ACTIVE, route: route, nextStep: next };
  }

  /**
   * 遅延判定
   *  申請日ではなく「その段に回ってきた時刻」を起点にする。
   *  申請日起点だと、前の段で10日かかった場合に、次の承認者は
   *  回ってきた瞬間に「遅延」と表示され、自分の責任でない遅延を突きつけられる。
   */
  function stepStartedAt(req, route, step) {
    if (!step) return null;
    var prev = null;
    (route || []).forEach(function (s) {
      if (s.step_no < step.step_no && s.acted_on) {
        if (!prev || new Date(s.acted_on) > new Date(prev)) prev = s.acted_on;
      }
    });
    return prev || step.started_on || req.Applied_On || null;
  }
  function dueDateOf(req, route, step) {
    var base = stepStartedAt(req, route, step);
    if (!base) return null;
    return new Date(new Date(base).getTime() + (step.days || 3) * 86400000);
  }
  function isDelayed(req, step, route) {
    if (!step || step.action) return false;
    var limit = dueDateOf(req, route || [], step);
    return !!limit && new Date() > limit;
  }
  function overdueDays(req, step, route) {
    if (!isDelayed(req, step, route)) return 0;
    var limit = dueDateOf(req, route || [], step);
    return Math.floor((Date.now() - limit.getTime()) / 86400000) + 1;
  }

  /** 明細合計と税額を集計 */
  function sumLines(lines, columns) {
    var total = 0, tax = 0;
    (lines || []).forEach(function (ln) {
      var amt = num(ln.amount);
      if (!amt && ln.qty && ln.unit_price) amt = num(ln.qty) * num(ln.unit_price);
      total += amt;
      var r = 0; (CFG.TAX || []).forEach(function (t) { if (t.key === ln.tax) r = t.rate; });
      if (r) tax += Math.floor(amt - amt / (1 + r));
    });
    return { total: total, tax: tax, net: total - tax };
  }

  /** 申請全体の金額（routeKey 項目 or 明細合計） */
  function amountOf(template, data) {
    var key = null;
    (template.fields || []).forEach(function (f) { if (f.routeKey) key = f.key; });
    if (key && data[key] != null && data[key] !== '') return num(data[key]);
    var lf = (template.fields || []).filter(function (f) { return f.type === 'lines'; })[0];
    if (lf) return sumLines(data[lf.key], lf.columns).total;
    return 0;
  }

  return {
    buildRoute: buildRoute, currentStep: currentStep, canAct: canAct, applyAction: applyAction,
    isDelayed: isDelayed, overdueDays: overdueDays, sumLines: sumLines, amountOf: amountOf,
    isRoutable: isRoutable, blockingSteps: blockingSteps, dueDateOf: dueDateOf, stepStartedAt: stepStartedAt,
    escalatedTo: escalatedTo, isEscalated: isEscalated,
    delegateOf: delegateOf, match: match, num: num, departmentMembers: departmentMembers,
    assigneeLabel: assigneeLabel, fallbackApprover: fallbackApprover
  };
})();
