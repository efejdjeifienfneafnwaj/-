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
      }
      no++;
      var row = {
        step_no: no, name: st.name, type: st.type || '承認', days: st.days || 3,
        approverId: approver ? approver.ID : '', approverName: approver ? approver.Employee_Name : '（該当者なし）',
        approverTitle: approver ? approver.Title : '',
        members: members.map(function (m) { return { id: m.ID, name: m.Employee_Name }; }),
        quorum: st.quorum || null,
        required: (st.type === '合議') ? RouteSpec.requiredApprovals(st, members.length) : 1,
        skipped: false, skipReason: '',
        needsPick: needsPick, pickKey: pickKey
      };
      /* 自動スキップ判定（重複は後段を残すため、ここでは判定しない） */
      if (needsPick) { row.approverName = '（申請時に選択）'; }
      else if (!approver) { row.skipped = true; row.skipReason = '該当する承認者が存在しないため自動スキップ'; }
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
        r.skipReason = '同じ承認者が' + (out[last].step_no) + '段目「' + out[last].name + '」にもいるため、上位の段に統合しました';
        r.mergedInto = out[last].step_no;
      }
    });
    return out;
  }

  /** 経路が成立しているか（1段でも生きた承認段があるか）を判定する */
  function isRoutable(route) {
    return (route || []).some(function (s) { return !s.skipped && !s.needsPick; }) ||
           (route || []).some(function (s) { return !s.skipped && s.needsPick && s.approverId; });
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

  /** ある社員がそのステップを処理できるか（本人 or 代理人 or 合議メンバー） */
  function canAct(step, meId) {
    if (!step) return false;
    if (String(step.approverId) === String(meId)) return true;
    if (step.delegateId && String(step.delegateId) === String(meId)) return true;
    if ((step.type === '合議' || step.type === '或議') && (step.members || []).some(function (m) { return String(m.id) === String(meId); })) return true;
    return false;
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
    delegateOf: delegateOf, match: match, num: num, departmentMembers: departmentMembers
  };
})();
