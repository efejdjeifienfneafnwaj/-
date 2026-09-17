/* =========================================================================
 * workflow.js — 承認経路エンジン
 *  ・金額などの条件で経路を動的に組み立てる（職務権限規程の再現）
 *  ・申請者＝承認者、承認者不在は理由付きで自動スキップ
 *  ・代理承認（職務代行）を期間で判定
 *  ・承認 / 却下 / 差戻し / 条件付承認 / 既読（回覧）の遷移
 * ========================================================================= */
var WF = (function () {

  /* ---------- 条件評価 ---------- */
  function num(v) { if (v == null || v === '') return 0; return Number(String(v).replace(/[^\d.-]/g, '')) || 0; }
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
    if (a.mode === 'fixed') return byId[String(a.employeeId)] || null;
    if (a.mode === 'manager') {
      var cur = applicant, lv = a.level || 1;
      for (var i = 0; i < lv; i++) { cur = cur && cur.Manager ? byId[String(cur.Manager)] : null; if (!cur) return null; }
      return cur || null;
    }
    if (a.mode === 'title') {
      var dept = deptName || (applicant && (applicant.Department_name || applicant.Department));
      var sameDept = employees.filter(function (e) { return e.Is_Active !== false && e.Title === a.title && (e.Department_name || e.Department) === dept; });
      if (sameDept.length) return sameDept[0];
      var any = employees.filter(function (e) { return e.Is_Active !== false && e.Title === a.title; });
      return any[0] || null;
    }
    if (a.mode === 'department') {
      var mem = employees.filter(function (e) { return e.Is_Active !== false && (e.Department_name || e.Department) === a.department; });
      /* 部署内で最上位の役職者を代表承認者にする */
      mem.sort(function (x, y) { return CFG.TITLES.indexOf(x.Title) - CFG.TITLES.indexOf(y.Title); });
      return mem[0] || null;
    }
    if (a.mode === 'applicantSelect') return null; // 申請時に選択
    return null;
  }
  function departmentMembers(deptName, employees) {
    return employees.filter(function (e) { return e.Is_Active !== false && (e.Department_name || e.Department) === deptName; });
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
  function buildRoute(template, formData, applicant, employees) {
    var steps = (template.route && template.route.steps) || [];
    var out = [], no = 0, seen = {};
    steps.forEach(function (st) {
      if (!match(st.when, formData)) return;                       // 条件に合致しない段はそもそも生成しない
      var approver = null, members = [];
      if ((st.assignee || {}).mode === 'applicantSelect' && formData['__approver_' + st.name]) {
        var byId = {}; employees.forEach(function (e) { byId[String(e.ID)] = e; });
        approver = byId[String(formData['__approver_' + st.name])] || null;
      } else {
        approver = resolveAssignee(st, applicant, employees);
      }
      if (st.type === '合議' || st.type === '或議') {
        members = departmentMembers((st.assignee || {}).department || (applicant && applicant.Department_name), employees);
      }
      no++;
      var row = {
        step_no: no, name: st.name, type: st.type || '承認', days: st.days || 3,
        approverId: approver ? approver.ID : '', approverName: approver ? approver.Employee_Name : '（該当者なし）',
        approverTitle: approver ? approver.Title : '',
        members: members.map(function (m) { return { id: m.ID, name: m.Employee_Name }; }),
        skipped: false, skipReason: ''
      };
      /* 自動スキップ判定 */
      if (!approver) { row.skipped = true; row.skipReason = '該当する承認者が存在しないため自動スキップ'; }
      else if (applicant && String(approver.ID) === String(applicant.ID)) { row.skipped = true; row.skipReason = '申請者本人のため自動スキップ'; }
      else if (seen[String(approver.ID)] && st.type === '承認') { row.skipped = true; row.skipReason = '同一承認者の重複のため自動スキップ'; }
      if (!row.skipped && approver) seen[String(approver.ID)] = true;
      /* 代理承認 */
      if (!row.skipped && approver) {
        var dep = delegateOf(approver, employees);
        if (dep) { row.delegateId = dep.ID; row.delegateName = dep.Employee_Name; }
      }
      out.push(row);
    });
    return out;
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
      var need = (s.members || []).length || 1;
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
    return { status: next === 0 ? CFG.STATUS.APPROVED : CFG.STATUS.ACTIVE, route: route, nextStep: next };
  }

  /** 遅延判定（標準処理日数を超過しているか） */
  function isDelayed(req, step) {
    if (!step || step.action) return false;
    var base = req.Applied_On ? new Date(req.Applied_On) : null; if (!base) return false;
    var limit = new Date(base.getTime() + (step.days || 3) * 86400000);
    return new Date() > limit;
  }
  function overdueDays(req, step) {
    if (!isDelayed(req, step)) return 0;
    var base = new Date(req.Applied_On);
    var limit = new Date(base.getTime() + (step.days || 3) * 86400000);
    return Math.floor((Date.now() - limit) / 86400000) + 1;
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
    delegateOf: delegateOf, match: match, num: num, departmentMembers: departmentMembers
  };
})();
