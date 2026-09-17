/* =========================================================================
 * routes.js — 承認経路ルール（v2）
 *
 *  ねらい：管理者が画面から経路を組めるようにするための「語彙」をここに集約する。
 *          エンジン（workflow.js）と設定画面（views.js）が同じ定義を参照するため、
 *          条件や承認者の種類を増やすときは、このファイルだけを直せばよい。
 *
 *  v1 との違い：
 *    v1 … 1ステップに条件1つだけ（when: {field, gte}）
 *    v2 … 条件を AND / OR で組み合わせ、入れ子にもできる
 *          { op:'AND', rules:[ {field,operator,value}, { op:'OR', rules:[...] } ] }
 *  v1 の定義はそのまま読み込めるよう normalize() で自動変換する。
 * ========================================================================= */
var RouteSpec = (function () {

  /* ---------- 条件で使える演算子 ---------- */
  var OPERATORS = [
    { key: 'gte',        label: '以上',           types: ['number'],  value: 'number' },
    { key: 'gt',         label: 'より大きい',      types: ['number'],  value: 'number' },
    { key: 'lte',        label: '以下',           types: ['number'],  value: 'number' },
    { key: 'lt',         label: '未満',           types: ['number'],  value: 'number' },
    { key: 'between',    label: 'の範囲',        types: ['number'],  value: 'range' },
    { key: 'eq',         label: 'と等しい',        types: ['number', 'text', 'choice', 'date'], value: 'same' },
    { key: 'neq',        label: 'と等しくない',    types: ['number', 'text', 'choice', 'date'], value: 'same' },
    { key: 'in',         label: 'のいずれか',      types: ['text', 'choice'], value: 'multi' },
    { key: 'notin',      label: 'のいずれでもない', types: ['text', 'choice'], value: 'multi' },
    { key: 'contains',   label: 'を含む',          types: ['text'],    value: 'text' },
    { key: 'isTrue',     label: 'がチェックされている',   types: ['bool'], value: 'none' },
    { key: 'isFalse',    label: 'がチェックされていない', types: ['bool'], value: 'none' },
    { key: 'isEmpty',    label: 'が未入力',        types: ['text', 'choice', 'date', 'number'], value: 'none' },
    { key: 'isNotEmpty', label: 'が入力済み',      types: ['text', 'choice', 'date', 'number'], value: 'none' }
  ];
  function operatorsFor(type) {
    return OPERATORS.filter(function (o) { return o.types.indexOf(type) >= 0; });
  }
  function operatorLabel(key) {
    var o = OPERATORS.filter(function (x) { return x.key === key; })[0];
    return o ? o.label : key;
  }

  /* ---------- 申請テンプレートの項目を「条件に使える項目」に変換 ---------- */
  function fieldType(f) {
    if (f.type === 'currency' || f.type === 'number') return 'number';
    if (f.type === 'checkbox') return 'bool';
    if (f.type === 'select' || f.type === 'radio' || f.type === 'vendor' ||
        f.type === 'account' || f.type === 'employee' || f.type === 'department') return 'choice';
    if (f.type === 'date' || f.type === 'daterange') return 'date';
    return 'text';
  }

  /** 組み込み項目（どの申請区分にも必ず存在する） */
  var BUILTIN = [
    { key: '__amount',          label: '申請金額',         type: 'number', builtin: true },
    { key: '__applicant_dept',  label: '申請者の所属部署',  type: 'choice', builtin: true },
    { key: '__applicant_title', label: '申請者の役職',      type: 'choice', builtin: true },
    { key: '__line_count',      label: '明細の行数',        type: 'number', builtin: true },
    { key: '__attachment_count',label: '添付ファイルの数',  type: 'number', builtin: true }
  ];

  /**
   * ある申請区分で条件に使える項目の一覧を返す
   * @param {object} template TEMPLATES の1件
   * @param {object} masters  {departments:[], titles:[]}
   */
  function fieldsFor(template, masters) {
    var out = BUILTIN.map(function (b) {
      var o = { key: b.key, label: b.label, type: b.type, builtin: true };
      if (b.key === '__applicant_dept') o.options = (masters && masters.departments) || [];
      if (b.key === '__applicant_title') o.options = (masters && masters.titles) || [];
      return o;
    });
    (template.fields || []).forEach(function (f) {
      if (f.type === 'lines' || f.type === 'files') return;   // 行データ・添付は組み込み項目で扱う
      /* 申請金額そのものの項目は「申請金額」（組み込み）で代表させる。
         同じものが2つ並ぶと、管理者がどちらを選ぶべきか分からなくなるため。 */
      if (f.routeKey) return;
      out.push({
        key: f.key, label: f.label, type: fieldType(f),
        options: f.options || null, builtin: false
      });
    });
    return out;
  }

  /* ---------- 承認者の指定方式 ---------- */
  var ASSIGNEES = [
    { mode: 'manager',        label: '申請者の上長',
      hint: '申請した人の上長をたどります。2段にすると「上長の上長」になります。',
      params: [{ key: 'level', label: '何段上', type: 'number', def: 1, min: 1, max: 5 }] },
    { mode: 'title',          label: '役職で指定',
      hint: '申請者と同じ部署の、指定した役職の人。いなければ他部署の同役職を探します。',
      params: [{ key: 'title', label: '役職', type: 'title' }] },
    { mode: 'department',     label: '部署で指定',
      hint: '指定した部署の中で、いちばん役職が上の人が代表で承認します。',
      params: [{ key: 'department', label: '部署', type: 'department' }],
      options: [{ key: 'includeSub', label: '下位の部署も含める', type: 'bool' }] },
    { mode: 'fixed',          label: '特定の人を指名',
      hint: 'この人だけが承認します。',
      warn: '氏名を直接指定すると、異動・退職のたびに経路を手で直す必要があります。役職や部署での指定を検討してください。',
      params: [{ key: 'employeeId', label: '社員', type: 'employee' }] },
    { mode: 'applicantSelect', label: '申請者が選ぶ',
      hint: '申請するときに、申請者が承認者を選びます。',
      params: [] }
  ];
  function assigneeDef(mode) {
    return ASSIGNEES.filter(function (a) { return a.mode === mode; })[0] || ASSIGNEES[0];
  }

  /* ---------- ステップの種類 ---------- */
  var STEP_TYPES = [
    { key: '承認', label: '承認（1人）',        hint: '指定された1人が承認すれば次へ進みます。' },
    { key: '合議', label: '合議（複数人）',      hint: '対象者が複数います。何人の承認で次へ進むかを下で指定します。', quorum: true },
    { key: '或議', label: '或議（誰か1人）',    hint: '対象者のうち誰か1人が承認すれば次へ進みます。' },
    { key: '回覧', label: '回覧（確認のみ）',    hint: '承認ではなく既読の記録だけ。差戻しはできません。' }
  ];

  /* 可決条件：「全員」「何人」「何%」を同じ仕組みで表す。
     取締役会の過半数決議のような規程を、そのまま設定できるようにするため。 */
  var QUORUM_MODES = [
    { key: 'all',     label: '全員の承認', needsValue: false },
    { key: 'count',   label: '指定した人数',  needsValue: true, unit: '人' },
    { key: 'percent', label: '指定した割合',  needsValue: true, unit: '%' }
  ];
  /**
   * そのステップを可決するのに必要な人数を返す
   * @param {object} step
   * @param {number} memberCount 対象者の人数
   */
  function requiredApprovals(step, memberCount) {
    var n = Math.max(1, memberCount || 1);
    var q = step && step.quorum;
    if (!q || q.mode === 'all' || !q.mode) return n;
    if (q.mode === 'count') return Math.min(n, Math.max(1, Number(q.value) || 1));
    if (q.mode === 'percent') return Math.min(n, Math.max(1, Math.ceil(n * (Number(q.value) || 100) / 100)));
    return n;
  }
  function quorumLabel(step, memberCount) {
    var q = (step && step.quorum) || { mode: 'all' };
    if (q.mode === 'count') return String(q.value || 1) + '人の承認で次へ';
    if (q.mode === 'percent') return String(q.value || 100) + '%（' + requiredApprovals(step, memberCount) + '人）の承認で次へ';
    return '全員（' + (memberCount || 0) + '人）の承認で次へ';
  }

  /* ---------- 条件の評価 ---------- */
  function num(v) {
    if (v == null || v === '') return 0;
    /* 全角数字とカンマ・円記号を取り除いてから数値化する */
    var s = String(v).replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
    var n = Number(s.replace(/[^\d.\-]/g, ''));
    return isFinite(n) ? n : 0;
  }
  function isBlank(v) { return v == null || v === '' || (Array.isArray(v) && !v.length); }

  /** 1つのルールを評価する */
  function evalRule(rule, ctx) {
    if (!rule || !rule.field) return true;
    var v = valueOf(rule.field, ctx);
    switch (rule.operator) {
      case 'gte':        return num(v) >= num(rule.value);
      case 'gt':         return num(v) >  num(rule.value);
      case 'lte':        return num(v) <= num(rule.value);
      case 'lt':         return num(v) <  num(rule.value);
      case 'between':    return num(v) >= num(rule.value) && num(v) <= num(rule.value2);
      case 'eq':         return String(v) === String(rule.value);
      case 'neq':        return String(v) !== String(rule.value);
      case 'in':         return toList(rule.value).indexOf(String(v)) >= 0;
      case 'notin':      return toList(rule.value).indexOf(String(v)) < 0;
      case 'contains':   return String(v).indexOf(String(rule.value)) >= 0;
      case 'isTrue':     return v === true || String(v) === 'true';
      case 'isFalse':    return !(v === true || String(v) === 'true');
      case 'isEmpty':    return isBlank(v);
      case 'isNotEmpty': return !isBlank(v);
      default:           return true;
    }
  }
  function toList(v) {
    if (Array.isArray(v)) return v.map(String);
    return String(v == null ? '' : v).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  /** 項目の現在値を取り出す（組み込み項目はここで計算する） */
  function valueOf(key, ctx) {
    var data = (ctx && ctx.data) || {};
    var ap = (ctx && ctx.applicant) || {};
    switch (key) {
      case '__amount':           return (ctx && ctx.amount != null) ? ctx.amount : 0;
      case '__applicant_dept':   return ap.Department_name || ap.Department || '';
      case '__applicant_title':  return ap.Title || '';
      case '__line_count':
        var lf = ((ctx && ctx.template && ctx.template.fields) || []).filter(function (f) { return f.type === 'lines'; })[0];
        return lf && Array.isArray(data[lf.key]) ? data[lf.key].length : 0;
      case '__attachment_count': return (ctx && ctx.attachmentCount) || 0;
      default:
        if (data[key] !== undefined && data[key] !== '') return data[key];
        /* v1 の定義は金額項目を直接指していることがある（例 when:{field:'amount'}）。
           その項目が申請金額そのものなら、組み込みの申請金額で補う。 */
        var tf = ((ctx && ctx.template && ctx.template.fields) || []).filter(function (f) { return f.key === key; })[0];
        if (tf && tf.routeKey) return (ctx && ctx.amount != null) ? ctx.amount : 0;
        return data[key];
    }
  }

  /** 条件グループ（AND / OR、入れ子可）を評価する */
  function evalGroup(group, ctx) {
    if (!group) return true;
    if (group.field) return evalRule(group, ctx);              // 単独ルールが渡された場合
    var rules = group.rules || [];
    if (!rules.length) return true;
    var op = (group.op || 'AND').toUpperCase();
    if (op === 'OR') {
      return rules.some(function (r) { return evalGroup(r, ctx); });
    }
    return rules.every(function (r) { return evalGroup(r, ctx); });
  }

  /* ---------- v1 → v2 変換 ---------- */
  /** 旧 when（条件1つ）を conditions（グループ）に直す */
  function whenToGroup(when) {
    if (!when || !when.field) return null;
    var rules = [];
    ['gte', 'gt', 'lte', 'lt', 'eq', 'neq'].forEach(function (op) {
      if (when[op] !== undefined) rules.push({ field: when.field, operator: op, value: when[op] });
    });
    if (when['in'] !== undefined) rules.push({ field: when.field, operator: 'in', value: when['in'] });
    if (!rules.length) return null;
    return { op: 'AND', rules: rules };
  }

  /**
   * 経路定義を v2 の形に揃える（保存済みの v1 定義もそのまま読める）
   * @param {object} routeRule
   * @param {object} [template] 渡すと、金額項目を直接指した条件を「申請金額」に寄せる
   */
  function normalize(routeRule, template) {
    var amountKey = null;
    ((template && template.fields) || []).forEach(function (f) { if (f.routeKey) amountKey = f.key; });
    var steps = ((routeRule && routeRule.steps) || []).map(function (st, i) {
      var s = {};
      Object.keys(st).forEach(function (k) { s[k] = st[k]; });
      s.id = s.id || ('s' + (i + 1));
      s.type = s.type || '承認';
      s.days = Number(s.days) || 3;
      s.assignee = s.assignee || { mode: 'manager', level: 1 };
      if (!s.conditions && s.when) s.conditions = whenToGroup(s.when);
      if (!s.conditions) s.conditions = null;                 // 条件なし＝常に通る
      if (s.conditions) retarget(s.conditions, amountKey, knownKeys(template));
      return s;
    });
    return { version: 2, steps: steps };
  }

  /** テンプレートで有効な項目キーの一覧 */
  function knownKeys(template) {
    var keys = BUILTIN.map(function (b) { return b.key; });
    ((template && template.fields) || []).forEach(function (f) { keys.push(f.key); });
    return keys;
  }

  /**
   * 条件の項目キーを整える
   *  ・金額項目を直接指しているもの → 「申請金額」に寄せる
   *  ・テンプレートに存在しない項目を指しているもの
   *      数値系の演算子なら申請金額とみなして寄せる（v1 定義の救済）
   *      それ以外は _unknown を立て、設定エラーとして画面に出す
   *    ※ 黙って false になる（＝段が消える）のを避けるための処置。
   */
  var NUMERIC_OPS = ['gte', 'gt', 'lte', 'lt', 'between'];
  function retarget(group, amountKey, known) {
    if (!group) return;
    if (group.field) {
      if (amountKey && group.field === amountKey) { group.field = '__amount'; return; }
      if (known && known.indexOf(group.field) < 0) {
        if (NUMERIC_OPS.indexOf(group.operator) >= 0) { group._was = group.field; group.field = '__amount'; }
        else { group._unknown = group.field; }
      }
      return;
    }
    (group.rules || []).forEach(function (r) { retarget(r, amountKey, known); });
  }

  /**
   * 経路定義の設定ミスを洗い出す（保存前チェック用）
   * @returns {Array} [{step, kind, message}]
   */
  function problems(steps, template) {
    var out = [], known = knownKeys(template);
    (steps || []).forEach(function (st, i) {
      var label = (i + 1) + '段目「' + (st.name || '（名称なし）') + '」';
      function walk(g) {
        if (!g) return;
        if (g.field) {
          if (g._unknown || known.indexOf(g.field) < 0) {
            out.push({ step: i, kind: 'unknownField',
              message: label + 'の条件が、この申請区分に存在しない項目「' + (g._unknown || g.field) + '」を指しています。この条件は成立しません。' });
          }
          var op = OPERATORS.filter(function (o) { return o.key === g.operator; })[0];
          if (!op) {
            out.push({ step: i, kind: 'unknownOperator', message: label + 'の条件に不明な比較方法が使われています。' });
          } else if (op.value !== 'none') {
            if (g.value === '' || g.value == null) {
              out.push({ step: i, kind: 'emptyValue', message: label + 'の条件の値が空です。このままでは条件が意味を持ちません。' });
            }
            if (op.value === 'range' && (g.value2 === '' || g.value2 == null)) {
              out.push({ step: i, kind: 'emptyValue', message: label + 'の条件の上限が空です。' });
            }
          }
          return;
        }
        (g.rules || []).forEach(walk);
      }
      walk(st.conditions);
    });
    return out;
  }

  /** 条件を日本語の文章にする（設定画面と経路プレビューの説明に使う） */
  function describe(group, fields) {
    if (!group) return '条件なし（常に経路に入ります）';
    function labelOf(key) {
      var f = (fields || []).filter(function (x) { return x.key === key; })[0];
      return f ? f.label : key;
    }
    function one(r) {
      var op = OPERATORS.filter(function (o) { return o.key === r.operator; })[0];
      var vt = op ? op.value : 'same';
      var val = '';
      if (vt === 'none') {
        /* 「〜がチェックされている」「〜が未入力」は演算子側に助詞が入っている */
        return labelOf(r.field) + ' ' + operatorLabel(r.operator);
      }
      if (vt === 'range') val = fmt(r.value) + ' ～ ' + fmt(r.value2);
      else if (vt === 'multi') val = toList(r.value).join('・');
      else val = fmt(r.value);
      return labelOf(r.field) + ' が ' + val + ' ' + operatorLabel(r.operator);
    }
    function fmt(v) {
      var n = Number(v);
      return (isFinite(n) && String(v).match(/^\d+$/)) ? n.toLocaleString('ja-JP') : String(v == null ? '' : v);
    }
    function walk(g) {
      if (g.field) return one(g);
      var joiner = (g.op || 'AND').toUpperCase() === 'OR' ? ' または ' : ' かつ ';
      var parts = (g.rules || []).map(function (r) {
        return (r.rules && r.rules.length > 1) ? '（' + walk(r) + '）' : walk(r);
      });
      return parts.join(joiner);
    }
    var text = walk(group);
    return text || '条件なし（常に経路に入ります）';
  }

  /* ---------- 空のひな形 ---------- */
  function newRule(field) { return { field: field || '__amount', operator: 'gte', value: 0 }; }
  function newGroup() { return { op: 'AND', rules: [newRule()] }; }
  function newStep(n) {
    return { id: 's' + Date.now().toString(36), name: '承認' + (n || 1), type: '承認',
             assignee: { mode: 'manager', level: 1 }, days: 3, conditions: null };
  }

  return {
    OPERATORS: OPERATORS, ASSIGNEES: ASSIGNEES, STEP_TYPES: STEP_TYPES, BUILTIN: BUILTIN,
    QUORUM_MODES: QUORUM_MODES, requiredApprovals: requiredApprovals, quorumLabel: quorumLabel,
    operatorsFor: operatorsFor, operatorLabel: operatorLabel, fieldsFor: fieldsFor, fieldType: fieldType,
    assigneeDef: assigneeDef, evalGroup: evalGroup, evalRule: evalRule, valueOf: valueOf,
    normalize: normalize, whenToGroup: whenToGroup, describe: describe,
    knownKeys: knownKeys, problems: problems,
    newRule: newRule, newGroup: newGroup, newStep: newStep, num: num, toList: toList
  };
})();
