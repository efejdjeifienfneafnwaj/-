/* =========================================================================
 * masters.js — マスタ管理（社員・部署・取引先・勘定科目）
 *
 *  なぜ画面を持つか：
 *   経路診断が「社員マスタで上長を設定してください」と指示しても、
 *   そこへ行く手段が製品内に無ければ、担当者は Creator の素のフォームに出される。
 *   設定作業が製品の外に出ると、運用は続かない。
 *
 *  変更は必ず操作証跡に残す。マスタは決裁の前提そのものなので、
 *  「いつ誰が誰の役職・上長・権限を変えたか」を後から説明できる必要がある。
 * ========================================================================= */
var Masters = (function () {
  var E = UI.esc;
  var S = function () { return App.state; };
  var me = function () { return App.me(); };

  /* ---------- 定義：エンティティごとの項目 ---------- */
  var DEFS = {
    Employees: {
      label: '社員', icon: '👤', entity: 'Employees',
      /* 人事も編集できる。組織の維持は人事の仕事なので、管理者だけに絞ると回らない。 */
      canEdit: function (u) { return Perm.isAdmin(u) || Perm.isHR(u); },
      list: function () { return S().employees; },
      columns: [
        { key: 'Employee_ID', label: '社員番号', w: '100px' },
        { key: 'Employee_Name', label: '氏名' },
        { key: 'Title', label: '役職', w: '90px' },
        { key: 'Department_name', label: '所属' },
        { key: 'Manager', label: '上長', render: function (v) { var e = App.employeeById(v); return e ? e.Employee_Name : '（未設定）'; } },
        { key: 'Roles', label: '権限', render: function (v) { return (v || []).join('・'); } },
        { key: 'Email', label: 'メール' },
        { key: 'Is_Active', label: '在籍', w: '70px', render: function (v) { return v === false ? '退職' : '在籍'; } }
      ],
      fields: [
        { key: 'Employee_ID', label: '社員番号', type: 'text', required: true },
        { key: 'Employee_Name', label: '氏名', type: 'text', required: true },
        { key: 'Employee_Kana', label: 'フリガナ', type: 'text' },
        { key: 'Email', label: 'メールアドレス', type: 'text', required: true,
          help: 'Zoho のログインIDと一致させてください。本人の判定に使います。1人1つにしてください（共有アドレスは使えません）。' },
        { key: 'Department_name', label: '所属部署', type: 'dept', required: true },
        { key: 'Title', label: '役職', type: 'title', required: true,
          help: '閲覧範囲の判定に使います。同じ部署で自分より下位の役職の申請だけが見えます。' },
        { key: 'Manager', label: '上長', type: 'employee',
          help: '承認経路の「申請者の上長」で使います。未設定だと経路が組めません。' },
        { key: 'Roles', label: '権限', type: 'roles', required: true },
        { key: 'Join_Date', label: '入社日', type: 'date' },
        { key: 'Paid_Leave_Balance', label: '有給残日数', type: 'number' },
        { key: 'Deputy', label: '代理人（職務代行）', type: 'employee',
          help: '不在時に代わりに承認する人。期間を必ず入れてください。' },
        { key: 'Deputy_From', label: '代理の開始日', type: 'date' },
        { key: 'Deputy_To', label: '代理の終了日', type: 'date' },
        { key: 'Is_Active', label: '在籍している', type: 'bool', def: true,
          help: '外すと、この人はログインできなくなり、承認経路からも自動で外れます。' }
      ],
      label_of: function (r) { return r.Employee_Name; }
    },
    Departments: {
      label: '部署', icon: '🏢', entity: 'Departments',
      canEdit: function (u) { return Perm.isAdmin(u); },
      list: function () { return S().departments; },
      columns: [
        { key: 'Department_Code', label: 'コード', w: '110px' },
        { key: 'Department_Name', label: '部署名' },
        { key: 'Parent_Department', label: '上位部署', render: function (v) {
            var d = S().departments.filter(function (x) { return String(x.ID) === String(v); })[0];
            return d ? d.Department_Name : '—'; } },
        { key: 'Sort_Order', label: '表示順', w: '80px' }
      ],
      fields: [
        { key: 'Department_Code', label: '部署コード', type: 'text', required: true },
        { key: 'Department_Name', label: '部署名', type: 'text', required: true,
          help: '社員マスタと承認経路はこの文字列で紐づきます。表記を統一してください。' },
        { key: 'Parent_Department', label: '上位部署', type: 'deptId',
          help: '「下位の部署も含める」で対象を広げるときに使います。' },
        { key: 'Sort_Order', label: '表示順', type: 'number' }
      ],
      label_of: function (r) { return r.Department_Name; }
    },
    Vendors: {
      label: '取引先', icon: '🏪', entity: 'Vendors',
      canEdit: function (u) { return Perm.isAdmin(u) || Perm.isFinance(u); },
      list: function () { return S().vendors; },
      columns: [
        { key: 'Vendor_Code', label: 'コード', w: '100px' },
        { key: 'Vendor_Name', label: '取引先名' },
        { key: 'Invoice_Reg_No', label: '登録番号', render: function (v) { return v || '—'; } },
        { key: 'Is_Qualified', label: '適格請求書', w: '110px', render: function (v) { return v ? '○' : '×（控除対象外）'; } },
        { key: 'Is_New', label: '新規', w: '70px', render: function (v) { return v ? '新規' : '—'; } }
      ],
      fields: [
        { key: 'Vendor_Code', label: '取引先コード', type: 'text' },
        { key: 'Vendor_Name', label: '取引先名', type: 'text', required: true },
        { key: 'Invoice_Reg_No', label: '適格請求書発行事業者 登録番号', type: 'text',
          help: 'T に続く13桁の数字。入れると自動で「適格」になります。' },
        { key: 'Is_Qualified', label: '適格請求書発行事業者である', type: 'bool' },
        { key: 'Is_New', label: '新規の取引先として扱う', type: 'bool',
          help: '承認経路の条件「新規の取引先を含む」で使えます。取引が定着したら外してください。' },
        { key: 'First_Traded_On', label: '初回取引日', type: 'date' },
        { key: 'Payment_Terms', label: '支払条件', type: 'text' },
        { key: 'Note', label: '備考', type: 'textarea' }
      ],
      label_of: function (r) { return r.Vendor_Name; }
    },
    Accounts: {
      label: '勘定科目', icon: '📒', entity: 'Accounts',
      canEdit: function (u) { return Perm.isAdmin(u) || Perm.isFinance(u); },
      list: function () { return S().accounts; },
      columns: [
        { key: 'Account_Code', label: 'コード', w: '100px' },
        { key: 'Account_Name', label: '勘定科目' },
        { key: 'Tax_Category', label: '既定税区分', w: '120px' },
        { key: 'Is_Active', label: '有効', w: '70px', render: function (v) { return v === false ? '停止' : '有効'; } }
      ],
      fields: [
        { key: 'Account_Code', label: '科目コード', type: 'text', required: true,
          help: '会計システムの科目コードと合わせてください。仕訳CSVに出力されます。' },
        { key: 'Account_Name', label: '勘定科目', type: 'text', required: true },
        { key: 'Tax_Category', label: '既定の税区分', type: 'tax' },
        { key: 'Is_Active', label: '有効', type: 'bool', def: true }
      ],
      label_of: function (r) { return r.Account_Name; }
    }
  };

  /* ---------- 一覧の描画 ---------- */
  function render(el, which, focusId) {
    var key = which || 'Employees';
    var def = DEFS[key];
    if (!def) { el.innerHTML = UI.empty('❓', '不明なマスタです', key); return; }
    if (!Perm.isAdmin(me()) && !Perm.isHR(me()) && !Perm.isFinance(me())) {
      Access.denied('マスタ管理', '権限なし');
      el.innerHTML = '<div class="page-head"><div class="page-title">設定・マスタ</div></div>' +
        UI.empty('🔒', 'この画面を開く権限がありません', 'アクセス拒否として証跡に記録しました');
      return;
    }
    var editable = def.canEdit(me());
    var rows = def.list().slice();
    var q = (st.query[key] || '').trim();
    if (q) {
      rows = rows.filter(function (r) {
        return def.columns.some(function (c) {
          var v = c.render ? c.render(r[c.key]) : r[c.key];
          return String(v == null ? '' : v).indexOf(q) >= 0;
        });
      });
    }

    el.innerHTML =
      '<div class="page-head"><div><div class="page-title">設定・マスタ</div>' +
      '<div class="page-sub">承認経路の前提になる情報です。変更はすべて操作証跡に残ります。</div></div>' +
      '<div class="page-actions">' +
      (editable ? '<button class="btn btn-primary" data-act="add">＋ ' + E(def.label) + 'を追加</button>' : '<span class="tag">このマスタの編集権限がありません</span>') +
      '</div></div>' +
      '<div class="tabs">' +
      Object.keys(DEFS).map(function (k) {
        return '<button class="tab' + (k === key ? ' active' : '') + '" data-mtab="' + k + '">' +
          DEFS[k].icon + ' ' + E(DEFS[k].label) + '<span class="n">' + DEFS[k].list().length + '</span></button>';
      }).join('') +
      '<button class="tab' + (key === '__other' ? ' active' : '') + '" data-mtab="__other">⚙️ 運用設定</button>' +
      '</div>' +
      '<div class="card" style="margin-bottom:12px"><div class="card-body" style="padding:12px 16px">' +
      '<div class="inline-row"><input id="mq" value="' + E(q) + '" placeholder="絞り込み（氏名・部署・コードなど）" style="flex:1;max-width:340px;min-height:34px;border:1px solid var(--border-strong);border-radius:6px;padding:6px 10px">' +
      '<span class="page-sub">' + rows.length + ' / ' + def.list().length + ' 件</span></div></div></div>' +
      '<div class="card">' + tableHtml(def, rows, editable, focusId) + '</div>' +
      (key === 'Employees' ? healthHtml() : '');

    bind(el, key, def, editable);
  }

  function tableHtml(def, rows, editable, focusId) {
    if (!rows.length) return UI.empty('📭', '該当する' + def.label + 'がありません', '絞り込みを変えるか、新しく追加してください');
    return '<div class="table-wrap"><table class="tbl"><thead><tr>' +
      def.columns.map(function (c) { return '<th' + (c.w ? ' style="width:' + c.w + '"' : '') + '>' + E(c.label) + '</th>'; }).join('') +
      (editable ? '<th style="width:70px"></th>' : '') + '</tr></thead><tbody>' +
      rows.map(function (r) {
        var hot = focusId && String(r.ID) === String(focusId);
        return '<tr data-row="' + E(r.ID) + '"' + (hot ? ' style="background:var(--primary-weak)"' : '') + '>' +
          def.columns.map(function (c) {
            var v = c.render ? c.render(r[c.key], r) : r[c.key];
            var warn = (c.key === 'Manager' && !r[c.key] && r.Title !== CFG.TITLES[0] && r.Is_Active !== false);
            return '<td' + (c.w ? ' class="nowrap"' : '') + '>' +
              (warn ? '<span class="badge b-sentback">未設定</span>' : E(v == null ? '' : v)) + '</td>';
          }).join('') +
          (editable ? '<td class="nowrap"><button class="btn btn-sm" data-edit="' + E(r.ID) + '">編集</button></td>' : '') +
          '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  /** 社員マスタの健全性（経路が組めない原因の多くはここにある） */
  function healthHtml() {
    var emps = S().employees.filter(function (e) { return e.Is_Active !== false; });
    var noMgr = emps.filter(function (e) { return !e.Manager && e.Title !== CFG.TITLES[0]; });
    var noMail = emps.filter(function (e) { return !e.Email; });
    var dupMail = {};
    emps.forEach(function (e) { if (e.Email) dupMail[e.Email.toLowerCase()] = (dupMail[e.Email.toLowerCase()] || 0) + 1; });
    var shared = Object.keys(dupMail).filter(function (k) { return dupMail[k] > 1; });
    var noDept = emps.filter(function (e) { return !e.Department_name; });
    var items = [];
    if (noMgr.length) items.push({ t: '上長が未設定', n: noMgr.length, d: '承認経路の「申請者の上長」が解決できません', who: noMgr });
    if (noMail.length) items.push({ t: 'メールが未設定', n: noMail.length, d: 'ポータルからログインできません', who: noMail });
    if (shared.length) items.push({ t: 'メールが重複', n: shared.length, d: '同じアドレスを複数人で使うと、誰が見たか・誰が承認したかを区別できません', who: [] });
    if (noDept.length) items.push({ t: '所属が未設定', n: noDept.length, d: '部署による閲覧制御と経路解決が効きません', who: noDept });
    if (!items.length) {
      return '<div class="card" style="margin-top:14px;border-color:var(--success)"><div class="card-body">' +
        '<span class="badge b-approved">在籍 ' + emps.length + '名の登録に不足はありません</span></div></div>';
    }
    return '<div class="card" style="margin-top:14px;border-color:var(--warning)">' +
      '<div class="card-head"><div class="card-title">登録の不足（' + items.length + '件）</div>' +
      '<span class="tag" style="margin-left:auto">承認経路が組めない原因になります</span></div>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>内容</th><th class="num">人数</th><th>影響</th><th>対象</th></tr></thead><tbody>' +
      items.map(function (i) {
        return '<tr><td class="nowrap"><span class="badge b-sentback">' + E(i.t) + '</span></td>' +
          '<td class="num">' + i.n + '</td><td>' + E(i.d) + '</td>' +
          '<td>' + i.who.slice(0, 6).map(function (e) {
            return '<button class="btn btn-sm" data-edit="' + E(e.ID) + '">' + E(e.Employee_Name) + '</button>';
          }).join(' ') + (i.who.length > 6 ? ' ほか' + (i.who.length - 6) + '名' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  /* ---------- 編集フォーム ---------- */
  function openForm(key, id) {
    var def = DEFS[key];
    if (App.blockIfImpersonating('マスタの編集')) return;
    if (!def.canEdit(me())) { Access.denied('マスタの編集', def.label); UI.toast('編集の権限がありません（記録しました）', 'error'); return; }
    var rec = id ? def.list().filter(function (r) { return String(r.ID) === String(id); })[0] : null;
    var draft = {};
    def.fields.forEach(function (f) {
      draft[f.key] = rec ? rec[f.key] : (f.def !== undefined ? f.def : (f.type === 'roles' ? ['申請者'] : ''));
    });

    UI.modal({
      title: (rec ? def.label + 'を編集' : def.label + 'を追加') + (rec ? '：' + def.label_of(rec) : ''),
      okText: '保存する',
      bodyHtml: '<div class="form-grid">' + def.fields.map(function (f) { return fieldHtml(f, draft[f.key]); }).join('') + '</div>' +
        (rec && key === 'Employees' ? '<div class="page-sub" style="margin-top:10px">※ 役職・上長・権限を変えると、次に出される申請から経路と閲覧範囲が変わります。' +
          '進行中の申請は従前のまま流れます。</div>' : ''),
      onOk: function (box) {
        /* 入力を集める */
        def.fields.forEach(function (f) {
          var n = box.querySelector('[data-m="' + f.key + '"]');
          if (!n) return;
          if (f.type === 'bool') draft[f.key] = n.checked;
          else if (f.type === 'number') draft[f.key] = Number(n.value) || 0;
          else if (f.type === 'roles') {
            draft[f.key] = Array.prototype.slice.call(box.querySelectorAll('[data-role]:checked')).map(function (c) { return c.dataset.role; });
          } else draft[f.key] = n.value;
        });
        var err = validate(key, def, draft, rec);
        if (err) { UI.toast(err, 'error'); return false; }
        save(key, def, draft, rec);
      }
    });
    UI.bindMoneyInputs(document.querySelector('.modal'));
    /* 登録番号を入れたら自動で「適格」にする */
    var reg = document.querySelector('[data-m="Invoice_Reg_No"]');
    if (reg) {
      reg.addEventListener('input', function () {
        var q = document.querySelector('[data-m="Is_Qualified"]');
        if (q && /^T\d{13}$/.test(reg.value.trim())) q.checked = true;
      });
    }
  }

  function fieldHtml(f, v) {
    var cls = 'field' + (f.type === 'textarea' || f.type === 'roles' || f.help ? ' full' : '');
    var input;
    switch (f.type) {
      case 'bool':
        input = '<label class="inline-row"><input type="checkbox" data-m="' + E(f.key) + '" style="width:auto;min-height:auto"' + (v ? ' checked' : '') + '> はい</label>'; break;
      case 'textarea':
        input = '<textarea data-m="' + E(f.key) + '">' + E(v || '') + '</textarea>'; break;
      case 'number':
        input = '<input data-m="' + E(f.key) + '" type="number" value="' + E(v == null ? '' : v) + '">'; break;
      case 'date':
        input = '<input data-m="' + E(f.key) + '" type="date" value="' + E(String(v || '').slice(0, 10)) + '">'; break;
      case 'title':
        input = sel(f.key, CFG.TITLES.map(function (t) { return { v: t, t: t }; }), v); break;
      case 'tax':
        input = sel(f.key, CFG.TAX.map(function (t) { return { v: t.key, t: t.key }; }), v); break;
      case 'dept':
        input = sel(f.key, S().departments.map(function (d) { return { v: d.Department_Name, t: d.Department_Name }; }), v); break;
      case 'deptId':
        input = sel(f.key, S().departments.map(function (d) { return { v: d.ID, t: d.Department_Name }; }), v); break;
      case 'employee':
        input = sel(f.key, S().employees.filter(function (e) { return e.Is_Active !== false; })
          .map(function (e) { return { v: e.ID, t: e.Employee_Name + '（' + (e.Department_name || '') + '／' + e.Title + '）' }; }), v); break;
      case 'roles':
        input = '<div class="inline-row" style="gap:14px;flex-wrap:wrap">' + CFG.ROLES.map(function (r) {
          return '<label class="inline-row" style="gap:5px"><input type="checkbox" data-role="' + E(r) + '" style="width:auto;min-height:auto"' +
            ((v || []).indexOf(r) >= 0 ? ' checked' : '') + '> ' + E(r) + '</label>';
        }).join('') + '</div><input type="hidden" data-m="' + E(f.key) + '">'; break;
      default:
        input = '<input data-m="' + E(f.key) + '" value="' + E(v == null ? '' : v) + '">';
    }
    return '<div class="' + cls + '"><label>' + E(f.label) + (f.required ? '<span class="req">*</span>' : '') + '</label>' +
      input + (f.help ? '<div class="help">' + E(f.help) + '</div>' : '') + '</div>';
  }
  function sel(key, opts, v) {
    return '<select data-m="' + E(key) + '"><option value="">選択してください</option>' +
      opts.map(function (o) { return '<option value="' + E(o.v) + '"' + (String(v) === String(o.v) ? ' selected' : '') + '>' + E(o.t) + '</option>'; }).join('') + '</select>';
  }

  /* ---------- 検証 ---------- */
  function validate(key, def, d, rec) {
    for (var i = 0; i < def.fields.length; i++) {
      var f = def.fields[i];
      if (!f.required) continue;
      var v = d[f.key];
      if (v == null || v === '' || (Array.isArray(v) && !v.length)) return f.label + 'は必須です';
    }
    if (key === 'Employees') {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(d.Email).trim())) return 'メールアドレスの形式が正しくありません';
      var dup = S().employees.filter(function (e) {
        return (!rec || String(e.ID) !== String(rec.ID)) && String(e.Email || '').toLowerCase() === String(d.Email).trim().toLowerCase();
      })[0];
      if (dup) return 'このメールアドレスは ' + dup.Employee_Name + ' さんが使っています。1人1つにしてください。';
      if (rec && String(d.Manager) === String(rec.ID)) return '自分自身を上長にはできません';
      /* 上長のたどりが循環しないか確かめる */
      if (d.Manager && rec) {
        var seen = {}, cur = d.Manager, guard = 0;
        while (cur && guard++ < 30) {
          if (String(cur) === String(rec.ID)) return '上長の関係が循環しています（' + (App.employeeById(d.Manager) || {}).Employee_Name + ' をたどると本人に戻ります）';
          if (seen[cur]) break;
          seen[cur] = true;
          var up = App.employeeById(cur);
          cur = up ? up.Manager : null;
        }
      }
      if (d.Deputy && (!d.Deputy_From || !d.Deputy_To)) return '代理人を設定する場合は、開始日と終了日の両方を入れてください';
      if (d.Deputy_From && d.Deputy_To && d.Deputy_From > d.Deputy_To) return '代理の開始日が終了日より後になっています';
      if (d.Deputy && String(d.Deputy) === String(rec && rec.ID)) return '自分自身を代理人にはできません';
    }
    if (key === 'Vendors') {
      var no = String(d.Invoice_Reg_No || '').trim();
      if (no && !/^T\d{13}$/.test(no)) return '登録番号は T に続く13桁の数字で入力してください（例：T1234567890123）';
      if (no) d.Is_Qualified = true;
    }
    if (key === 'Departments') {
      var dupd = S().departments.filter(function (x) {
        return (!rec || String(x.ID) !== String(rec.ID)) && x.Department_Name === d.Department_Name;
      })[0];
      if (dupd) return 'この部署名はすでに登録されています';
      if (rec && String(d.Parent_Department) === String(rec.ID)) return '自分自身を上位部署にはできません';
    }
    return null;
  }

  /* ---------- 保存 ---------- */
  function save(key, def, d, rec) {
    var before = rec ? def.fields.map(function (f) {
      var v = rec[f.key];
      return f.label + '=' + (Array.isArray(v) ? v.join('・') : (v === true ? 'はい' : v === false ? 'いいえ' : (v == null ? '' : v)));
    }).join(' / ') : '（新規）';
    var after = def.fields.map(function (f) {
      var v = d[f.key];
      return f.label + '=' + (Array.isArray(v) ? v.join('・') : (v === true ? 'はい' : v === false ? 'いいえ' : (v == null ? '' : v)));
    }).join(' / ');

    function done(saved) {
      /* 部署名を変えたら、その部署に属する社員の表示も合わせる */
      if (key === 'Departments' && rec && rec.Department_Name !== d.Department_Name) {
        S().employees.forEach(function (e) {
          if (e.Department_name === rec.Department_Name) { e.Department_name = d.Department_Name; e.Department = d.Department_Name; }
        });
      }
      App.audit(rec ? 'マスタ変更' : 'マスタ追加', def.label, saved.ID,
        def.label_of(saved) + '／変更前：' + before.slice(0, 600) + '／変更後：' + after.slice(0, 600));
      UI.toast(def.label_of(saved) + ' を保存しました', 'success');
      App.refresh();
    }

    if (rec) {
      var patch = {};
      def.fields.forEach(function (f) { patch[f.key] = d[f.key]; });
      Object.keys(patch).forEach(function (k) { rec[k] = patch[k]; });
      if (key === 'Employees') { rec.Department = rec.Department_name; rec.Manager_name = (App.employeeById(rec.Manager) || {}).Employee_Name || ''; }
      DB.update(def.entity, rec.ID, patch)
        .then(function () { done(rec); })
        .catch(function (e) { UI.toast('保存に失敗しました：' + (e && e.message ? e.message : e), 'error'); });
    } else {
      var obj = {};
      def.fields.forEach(function (f) { obj[f.key] = d[f.key]; });
      if (key === 'Employees') { obj.Department = obj.Department_name; obj.Manager_name = (App.employeeById(obj.Manager) || {}).Employee_Name || ''; }
      DB.add(def.entity, obj)
        .then(function (saved) { def.list().push(saved); done(saved); })
        .catch(function (e) { UI.toast('保存に失敗しました：' + (e && e.message ? e.message : e), 'error'); });
    }
  }

  /* ---------- 状態と結線 ---------- */
  var st = { query: {} };

  function bind(el, key, def, editable) {
    el.querySelectorAll('[data-mtab]').forEach(function (b) {
      b.addEventListener('click', function () { App.go('admin?tab=' + b.dataset.mtab); });
    });
    var q = el.querySelector('#mq');
    if (q) {
      var timer = null;
      q.addEventListener('input', function () {
        clearTimeout(timer);
        timer = setTimeout(function () { st.query[key] = q.value; App.refresh(); q = document.querySelector('#mq'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 350);
      });
    }
    var add = el.querySelector('[data-act="add"]');
    if (add) add.addEventListener('click', function () { openForm(key, null); });
    el.querySelectorAll('[data-edit]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        /* 健全性の表からは社員を直接開く */
        openForm(DEFS[key] && DEFS[key].list().some(function (r) { return String(r.ID) === String(b.dataset.edit); }) ? key : 'Employees', b.dataset.edit);
      });
    });
    if (editable) {
      el.querySelectorAll('[data-row]').forEach(function (tr) {
        tr.addEventListener('click', function () { openForm(key, tr.dataset.row); });
      });
    }
  }

  return { render: render, openForm: openForm, DEFS: DEFS };
})();
