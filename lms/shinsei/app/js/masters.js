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
  /* 空のまま渡すと、経費精算の明細で科目が1つも選べず申請できない。
     日本の一般的な販管費の科目を、そのまま使える形で用意しておく。 */
  var STARTER_ACCOUNTS = [
    ['5101', '旅費交通費', '課税10%'], ['5102', '会議費', '課税10%'],
    ['5103', '接待交際費', '課税10%'], ['5104', '消耗品費', '課税10%'],
    ['5105', '通信費', '課税10%'], ['5106', '水道光熱費', '課税10%'],
    ['5107', '広告宣伝費', '課税10%'], ['5108', '支払手数料', '課税10%'],
    ['5109', '外注費', '課税10%'], ['5110', '地代家賃', '課税10%'],
    ['5111', '修繕費', '課税10%'], ['5112', '保険料', '非課税'],
    ['5113', '租税公課', '不課税'], ['5114', '新聞図書費', '軽減8%'],
    ['5115', '諸会費', '不課税'], ['5116', '教育研修費', '課税10%'],
    ['5117', '採用費', '課税10%'], ['5118', '荷造運賃', '課税10%'],
    ['5119', 'リース料', '課税10%'], ['5120', '雑費', '課税10%']
  ].map(function (a) {
    return { Account_Code: a[0], Account_Name: a[1], Tax_Category: a[2], Is_Active: true };
  });

  var DEFS = {
    Employees: {
      label: '社員', icon: '👤', entity: 'Employees', codeKey: 'Employee_ID',
      /* 人事も編集できる。組織の維持は人事の仕事なので、管理者だけに絞ると回らない。 */
      canEdit: function (u) { return Perm.isAdmin(u) || Perm.isHR(u); },
      list: function () { return S().employees; },
      columns: [
        { key: 'Employee_ID', label: '社員番号', w: '100px' },
        { key: 'Employee_Name', label: '氏名' },
        { key: 'Title', label: '役職', w: '90px' },
        { key: 'Department_name', label: '所属' },
        { key: 'Manager', label: '上長', render: function (v) { var e = App.employeeById(v); return e ? e.Employee_Name : '（未設定）'; } },
        { key: 'Roles', label: '権限', w: '120px',
          render: function (v) { return Perm.normalizeRoles(v || [])[0]; } },
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
        { key: 'Roles', label: '権限', type: 'roles', required: true,
          help: '「一般」は申請と承認だけ。「システム管理者」はすべての設定と元データを編集できます。' },
        { key: 'Join_Date', label: '入社日', type: 'date' },
        { key: 'Paid_Leave_Balance', label: '有給残日数', type: 'number' },
        { key: 'Deputy', label: '代理人（職務代行）', type: 'employee',
          help: '不在時に代わりに承認する人。期間を必ず入れてください。' },
        { key: 'Deputy_From', label: '代理の開始日', type: 'date' },
        { key: 'Deputy_To', label: '代理の終了日', type: 'date' },
        { key: 'Is_Active', label: '在籍している', type: 'bool', def: true,
          help: '外すと、この人はログインできなくなり、承認経路からも自動で外れます。' }
      ],
      label_of: function (r) { return r.Employee_Name; },
      csv: {
        file: '社員名簿',
        matchKey: 'Email',                 // この列で既存を判定する（一致すれば更新、無ければ追加）
        columns: [
          { key: 'Employee_ID',   label: '社員番号',       required: true,  example: 'S0001' },
          { key: 'Employee_Name', label: '氏名',           required: true,  example: '山田 太郎' },
          { key: 'Employee_Kana', label: 'フリガナ',       required: false, example: 'ヤマダ タロウ' },
          { key: 'Email',         label: 'メールアドレス', required: true,  example: 'yamada@example.co.jp' },
          { key: 'Department_name', label: '所属部署',     required: true,  example: '第一営業部', from: 'dept' },
          { key: 'Title',         label: '役職',           required: true,  example: '一般', options: function () { return CFG.TITLES; } },
          { key: 'Manager_name',  label: '上長（氏名）',   required: false, example: '佐藤 健太' },
          { key: 'Roles',         label: '権限',           required: false, example: '一般',
            options: function () { return CFG.ROLES; }, multi: true },
          { key: 'Join_Date',     label: '入社日',         required: false, example: '2020-04-01' },
          { key: 'Is_Active',     label: '在籍',           required: false, example: '○', bool: true }
        ],
        notes: [
          '役職と権限は、下の選択肢から選んで入力してください（それ以外を書くと取り込めません）。',
          '権限は「一般」か「システム管理者」の2つだけです。',
          '一般は、申請と承認だけができます。社員・部署・取引先・勘定科目・承認経路・申請区分は一切さわれません。',
          'システム管理者は、すべてを閲覧・編集できます。Zoho の本アカウントを持つ人に付けてください。',
          '権限を空にすると「一般」として取り込みます。',
          '上長は氏名で書けます。社員番号やIDは不要です。',
          '在籍は ○ か 空欄。退職した人は「×」と書いてください。',
          'メールアドレスは1人1つにしてください。同じアドレスを複数人で使うと、誰が見たか・誰が承認したかを区別できなくなります。'
        ]
      }
    },
    Departments: {
      label: '部署', icon: '🏢', entity: 'Departments', codeKey: 'Department_Code',
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
      label_of: function (r) { return r.Department_Name; },
      csv: {
        file: '部署一覧', matchKey: 'Department_Code',
        columns: [
          { key: 'Department_Code', label: '部署コード', required: true,  example: 'D100' },
          { key: 'Department_Name', label: '部署名',     required: true,  example: '第一営業部' },
          { key: 'Parent_Name',     label: '上位部署',   required: false, example: '営業本部' },
          { key: 'Sort_Order',      label: '表示順',     required: false, example: '1' }
        ],
        notes: [
          '部署名は、社員名簿の「所属部署」と同じ表記にしてください。文字が1つでも違うと紐づきません。',
          '上位部署は、この表に書いた別の部署名で指定します。無ければ空欄で構いません。',
          '上位部署を使うと、承認経路で「下位の部署も含める」が使えるようになります。'
        ]
      }
    },
    Vendors: {
      label: '取引先', icon: '🏪', entity: 'Vendors', codeKey: 'Vendor_Code',
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
      label_of: function (r) { return r.Vendor_Name; },
      csv: {
        file: '取引先一覧', matchKey: 'Vendor_Code',
        columns: [
          { key: 'Vendor_Code',    label: '取引先コード', required: false, example: 'V001' },
          { key: 'Vendor_Name',    label: '取引先名',     required: true,  example: '株式会社サンプル' },
          { key: 'Invoice_Reg_No', label: '登録番号',     required: false, example: 'T1234567890123' },
          { key: 'Is_New',         label: '新規',         required: false, example: '', bool: true },
          { key: 'Payment_Terms',  label: '支払条件',     required: false, example: '月末締め翌月末払い' }
        ],
        notes: [
          '登録番号は T に続く13桁の数字です。正しく入れると「適格請求書発行事業者」が自動で付きます。',
          '登録番号が無い取引先は空欄のままで構いません。経費申請時に「仕入税額控除の対象外」と表示されます。',
          '新規は ○ か 空欄。承認経路の条件「新規の取引先を含む」で使えます。'
        ]
      }
    },

    Accounts: {
      label: '勘定科目', icon: '📒', entity: 'Accounts', codeKey: 'Account_Code',
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
      label_of: function (r) { return r.Account_Name; },
      csv: {
        file: '勘定科目一覧', matchKey: 'Account_Code',
        columns: [
          { key: 'Account_Code',  label: '科目コード',   required: true,  example: '5110' },
          { key: 'Account_Name',  label: '勘定科目',     required: true,  example: '旅費交通費' },
          { key: 'Tax_Category',  label: '既定の税区分', required: false, example: '課税10%',
            options: function () { return CFG.TAX.map(function (t) { return t.key; }); } },
          { key: 'Is_Active',     label: '有効',         required: false, example: '○', bool: true }
        ],
        notes: [
          '科目コードは会計システムのものと合わせてください。仕訳CSVにそのまま出力されます。',
          '税区分は下の選択肢から選んでください。',
          '有効は ○ か 空欄。使わなくなった科目は「×」と書いてください。'
        ]
      }
    }
  };


  /* =======================================================================
   * CSV の書き出しと取り込み
   *
   *  「決まった型で入力してください」と言うより、その型を配るほうが早い。
   *  書き出したファイルには記入例と入力のしかたを同梱し、
   *  そのまま Excel で開いて追記 → 戻す、という往復ができるようにする。
   * ===================================================================== */

  /** CSV の1セルを組み立てる */
  function cell(v) {
    var s2 = (v == null ? '' : String(v));
    return /[",\n\r]/.test(s2) ? '"' + s2.replace(/"/g, '""') + '"' : s2;
  }

  /** 画面上の値を、CSV に書く形へ直す */
  function toCsvValue(col, rec) {
    if (col.key === 'Manager_name') {
      var m = App.employeeById(rec.Manager);
      return m ? m.Employee_Name : '';
    }
    if (col.key === 'Parent_Name') {
      var d = S().departments.filter(function (x) { return String(x.ID) === String(rec.Parent_Department); })[0];
      return d ? d.Department_Name : '';
    }
    var v = rec[col.key];
    if (col.bool) return v === false ? '×' : (v ? '○' : '');
    if (Array.isArray(v)) return v.join('・');
    if (col.key === 'Join_Date' || col.key === 'First_Traded_On') return String(v || '').slice(0, 10);
    return v == null ? '' : v;
  }

  /**
   * 記入用のファイルを書き出す
   * @param {string} key   マスタの種類
   * @param {boolean} withData true なら現在の登録内容も入れる（直して戻すため）
   */
  function exportCsv(key, withData) {
    var def = DEFS[key], spec = def.csv;
    var lines = [];
    lines.push(spec.columns.map(function (c) { return cell(c.label); }).join(','));

    if (withData) {
      def.list().forEach(function (r) {
        lines.push(spec.columns.map(function (c) { return cell(toCsvValue(c, r)); }).join(','));
      });
    } else {
      lines.push(spec.columns.map(function (c) { return cell(c.example || ''); }).join(','));
    }

    /* 空行より下は取り込まれない。Excel で開いたときに説明が見えるようにしておく */
    var pad = new Array(spec.columns.length).join(',');
    lines.push(pad);
    lines.push(cell('■ 入力のしかた') + pad);
    lines.push(cell('この行より下は読み込まれません。消さずに残して構いません。') + pad);
    if (!withData) lines.push(cell('2行目は記入例です。書き換えるか、行ごと消してください。') + pad);
    (spec.notes || []).forEach(function (n) { lines.push(cell('・' + n) + pad); });

    spec.columns.forEach(function (c) {
      if (!c.options) return;
      lines.push(pad);
      lines.push(cell('「' + c.label + '」に書ける値') + pad);
      c.options().forEach(function (o) { lines.push(cell('　' + o) + pad); });
    });
    if (key === 'Employees' && S().departments.length) {
      lines.push(pad);
      lines.push(cell('「所属部署」に書ける値（部署マスタに登録済みのもの）') + pad);
      S().departments.forEach(function (d) { lines.push(cell('　' + d.Department_Name) + pad); });
    }

    var name = spec.file + (withData ? '_現在の登録' : '_記入用') + '_' + new Date().toISOString().slice(0, 10) + '.csv';
    UI.download(name, lines.join('\r\n'));
    Access.log(CFG.ACCESS.ACTIONS.EXPORT_CSV, {
      targetType: def.label + 'マスタ', resultCount: withData ? def.list().length : 0,
      detail: withData ? '現在の登録内容を書き出し' : '記入用の様式を書き出し'
    });
    UI.toast(name + ' を書き出しました', 'success');
  }

  /* ---------- 取り込み ---------- */

  /** CSV を行と列に分解する（引用符の中の改行とカンマも扱う） */
  function parseCsv(text) {
    var rows = [], row = [], cur = '', q = false;
    text = String(text).replace(/^\uFEFF/, '');
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (ch !== '\r') cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  /** 権限が空欄のときの既定。権限は2種類しかないため、既定は必ず一般にする。
      （管理者は取り違えると全部見えてしまうので、自動では付けない） */
  function suggestRoles() {
    return [CFG.ROLE_USER];
  }

  /** 取り込む内容を1行ずつ検証する */
  function analyze(key, text) {
    var def = DEFS[key], spec = def.csv;
    var rows = parseCsv(text);
    if (!rows.length) return { error: 'ファイルが空です' };

    /* 見出し行を列に対応づける（列の順番が入れ替わっていても読めるようにする） */
    var header = rows[0].map(function (h) { return String(h).trim(); });
    var idx = {};
    spec.columns.forEach(function (c) {
      var i = header.indexOf(c.label);
      if (i >= 0) idx[c.key] = i;
    });
    var missing = spec.columns.filter(function (c) { return c.required && idx[c.key] === undefined; });
    if (missing.length) {
      return { error: '見出し行に必要な列がありません：' + missing.map(function (c) { return c.label; }).join('、') +
        '　（「記入用の様式を書き出す」で出したファイルを使ってください）' };
    }

    var out = [], seenKey = {};
    for (var r = 1; r < rows.length; r++) {
      var raw = rows[r];
      /* 空行より下は説明なので読まない */
      if (!raw.length || raw.every(function (v) { return String(v).trim() === ''; })) break;

      var rec = {}, problems = [], rawVal = {};
      spec.columns.forEach(function (c) {
        var v = idx[c.key] === undefined ? '' : String(raw[idx[c.key]] == null ? '' : raw[idx[c.key]]).trim();
        rawVal[c.key] = v;
        if (c.required && !v) problems.push(c.label + 'が空です');
        if (v && c.options) {
          var allowed = c.options();
          if (c.multi) {
            var parts = v.split(/[,、・]/).map(function (x) { return x.trim(); }).filter(Boolean);
            var bad = parts.filter(function (x) { return allowed.indexOf(x) < 0; });
            if (bad.length) problems.push(c.label + '「' + bad.join('・') + '」は選択肢にありません');
            rec[c.key] = parts;
            return;
          }
          if (allowed.indexOf(v) < 0) problems.push(c.label + '「' + v + '」は選択肢にありません');
        }
        if (c.bool) { rec[c.key] = !(v === '×' || v === 'x' || v === '✕' || v === 'false'); return; }
        rec[c.key] = v;
      });

      /* 記入例の行をそのまま残している場合は飛ばす。
         真偽値の列は変換後だと比較できないので、書かれていた文字列そのもので見る。 */
      var withExample = spec.columns.filter(function (c) { return c.example; });
      var isExample = withExample.length > 0 && withExample.every(function (c) {
        return rawVal[c.key] === String(c.example);
      });
      if (isExample) { out.push({ line: r + 1, rec: rec, skip: true, problems: ['記入例の行なので取り込みません'] }); continue; }

      /* マスタごとの追加検証 */
      if (key === 'Employees') {
        if (rec.Email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rec.Email)) problems.push('メールアドレスの形式が正しくありません');
        var lower = String(rec.Email || '').toLowerCase();
        if (lower && seenKey[lower]) problems.push('このファイルの中でメールアドレスが重複しています（' + seenKey[lower] + '行目）');
        if (lower) seenKey[lower] = r + 1;
        if (rec.Department_name && !S().departments.some(function (d) { return d.Department_Name === rec.Department_name; })) {
          problems.push('部署「' + rec.Department_name + '」が部署マスタにありません');
        }
        if (!rec.Roles || !rec.Roles.length) {
          rec.Roles = suggestRoles(rec.Title, rec.Department_name);
          rec._suggested = true;
        }
      }
      if (key === 'Vendors' && rec.Invoice_Reg_No && !/^T\d{13}$/.test(rec.Invoice_Reg_No)) {
        problems.push('登録番号は T に続く13桁の数字で入力してください');
      }

      /* 既存と照合して、追加か更新かを決める */
      var mk = spec.matchKey, existing = null;
      if (mk && rec[mk]) {
        existing = def.list().filter(function (x) {
          return String(x[mk] || '').toLowerCase() === String(rec[mk]).toLowerCase();
        })[0] || null;
      }
      out.push({ line: r + 1, rec: rec, existing: existing, problems: problems, skip: false });
    }
    return { rows: out };
  }

  /** 取り込み画面 */
  function openImport(key) {
    var def = DEFS[key];
    if (App.blockIfImpersonating('マスタの取り込み')) return;
    if (!def.canEdit(me())) { Access.denied('マスタの取り込み', def.label); UI.toast('取り込みの権限がありません（記録しました）', 'error'); return; }

    var analyzed = null;
    UI.modal({
      title: def.label + 'マスタの取り込み',
      okText: '取り込む',
      bodyHtml:
        '<div class="page-sub" style="margin-bottom:10px">' +
        '「記入用の様式を書き出す」で出したファイルに記入して、ここに戻してください。' +
        '取り込む前に、何件入るか・何件弾かれるかを表示します。</div>' +
        '<div class="inline-row" style="margin-bottom:10px">' +
        '<input type="file" id="imp_file" accept=".csv,text/csv" style="flex:1">' +
        '</div>' +
        '<div class="page-sub" style="margin-bottom:6px">ファイルを選ばず、Excel からそのまま貼り付けることもできます。</div>' +
        '<textarea id="imp_text" style="width:100%;min-height:110px;font-family:monospace;font-size:11.5px" ' +
        'placeholder="ここに貼り付け（1行目は見出し行）"></textarea>' +
        '<div id="imp_result" style="margin-top:12px"></div>',
      onOk: function () {
        if (!analyzed || !analyzed.rows) { UI.toast('先にファイルを選ぶか貼り付けてください', 'error'); return false; }
        var ok = analyzed.rows.filter(function (r) { return !r.skip && !r.problems.length; });
        if (!ok.length) { UI.toast('取り込める行がありません', 'error'); return false; }
        runImport(key, ok);
      }
    });

    var box = document.querySelector('.modal');
    function show(text) {
      analyzed = analyze(key, text);
      var el = box.querySelector('#imp_result');
      if (analyzed.error) {
        el.innerHTML = '<div class="badge b-rejected" style="display:block;padding:8px 12px">' + E(analyzed.error) + '</div>';
        return;
      }
      var rows = analyzed.rows;
      var ok = rows.filter(function (r) { return !r.skip && !r.problems.length; });
      var ng = rows.filter(function (r) { return r.problems.length; });
      var add = ok.filter(function (r) { return !r.existing; }).length;
      var upd = ok.length - add;
      var sug = ok.filter(function (r) { return r.rec._suggested; }).length;

      el.innerHTML =
        '<div class="inline-row" style="margin-bottom:8px">' +
        '<span class="badge ' + (ok.length ? 'b-approved' : 'b-draft') + '">取り込める ' + ok.length + '件</span>' +
        (add ? '<span class="tag">新規 ' + add + '件</span>' : '') +
        (upd ? '<span class="tag">更新 ' + upd + '件</span>' : '') +
        (ng.length ? '<span class="badge b-rejected">取り込めない ' + ng.length + '件</span>' : '') +
        (sug ? '<span class="tag">権限を自動提案 ' + sug + '件</span>' : '') +
        '</div>' +
        (ng.length ?
          '<div class="table-wrap" style="max-height:220px;overflow:auto"><table class="tbl"><thead><tr>' +
          '<th style="width:60px">行</th><th>内容</th><th>理由</th></tr></thead><tbody>' +
          ng.slice(0, 40).map(function (r) {
            return '<tr><td>' + r.line + '</td>' +
              '<td>' + E(def.csv.columns.slice(0, 3).map(function (c) { return r.rec[c.key]; }).filter(Boolean).join(' / ')) + '</td>' +
              '<td>' + r.problems.map(function (p) { return '<span class="badge b-sentback">' + E(p) + '</span>'; }).join(' ') + '</td></tr>';
          }).join('') + '</tbody></table></div>' : '') +
        (ok.length ?
          '<div class="page-sub" style="margin-top:8px">取り込む例：' +
          E(ok.slice(0, 3).map(function (r) { return def.csv.columns.slice(0, 2).map(function (c) { return r.rec[c.key]; }).filter(Boolean).join(' '); }).join('／')) +
          (ok.length > 3 ? ' ほか' + (ok.length - 3) + '件' : '') + '</div>' : '');
    }

    box.querySelector('#imp_file').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () { box.querySelector('#imp_text').value = ''; show(String(rd.result || '')); };
      rd.onerror = function () { UI.toast('ファイルを読み込めませんでした', 'error'); };
      rd.readAsText(f, 'UTF-8');
    });
    var ta = box.querySelector('#imp_text');
    var t = null;
    ta.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(function () { if (ta.value.trim()) show(ta.value); }, 400);
    });
  }

  /** 実際に登録する（直列に実行して、途中で失敗しても件数が分かるようにする） */
  function runImport(key, rows) {
    var def = DEFS[key];
    var added = 0, updated = 0, failed = 0;
    var i = 0;

    function normalize(rec) {
      var o = {};
      Object.keys(rec).forEach(function (k) { if (k.indexOf('_') !== 0) o[k] = rec[k]; });
      if (key === 'Employees') {
        o.Department = o.Department_name;
        /* 上長は氏名で書けるようにしてある。ここで実在の人に解決する */
        if (o.Manager_name) {
          var m = S().employees.filter(function (e) { return e.Employee_Name === o.Manager_name; })[0];
          o.Manager = m ? m.ID : '';
        }
      }
      if (key === 'Departments' && o.Parent_Name) {
        var d = S().departments.filter(function (x) { return x.Department_Name === o.Parent_Name; })[0];
        o.Parent_Department = d ? d.ID : '';
        delete o.Parent_Name;
      }
      if (key === 'Vendors' && /^T\d{13}$/.test(o.Invoice_Reg_No || '')) o.Is_Qualified = true;
      return o;
    }

    function step() {
      if (i >= rows.length) return finish();
      var r = rows[i++];
      var obj = normalize(r.rec);
      var p;
      if (r.existing) {
        Object.keys(obj).forEach(function (k) { r.existing[k] = obj[k]; });
        p = DB.update(def.entity, r.existing.ID, obj).then(function () { updated++; });
      } else {
        p = DB.add(def.entity, obj).then(function (saved) { def.list().push(saved); added++; });
      }
      return p.catch(function (e) { failed++; console.warn('取り込みに失敗', r.line, e); }).then(step);
    }

    function finish() {
      /* 上長を氏名で書いた行が、後から登録された人を指していることがあるので解決し直す */
      if (key === 'Employees') {
        var byName = {};
        S().employees.forEach(function (e) { if (e.Employee_Name) byName[e.Employee_Name] = e.ID; });
        S().employees.forEach(function (e) {
          if (!e.Manager && e.Manager_name && byName[e.Manager_name]) e.Manager = byName[e.Manager_name];
        });
      }
      App.audit('マスタ一括取り込み', def.label, '',
        '新規' + added + '件／更新' + updated + '件' + (failed ? '／失敗' + failed + '件' : ''));
      UI.toast('新規 ' + added + '件、更新 ' + updated + '件を取り込みました' + (failed ? '（失敗 ' + failed + '件）' : ''),
        failed ? 'warn' : 'success');
      App.refresh();
    }

    UI.toast('取り込んでいます…');
    step();
  }

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
      (editable ?
        '<button class="btn" data-act="tpl">📄 記入用の様式を書き出す</button>' +
        '<button class="btn" data-act="exp">現在の登録を書き出す</button>' +
        '<button class="btn" data-act="imp">📥 ファイルから取り込む</button>' +
        '<button class="btn btn-primary" data-act="add">＋ ' + E(def.label) + 'を追加</button>'
        : '<span class="tag">このマスタの編集権限がありません</span>') +
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
    if (!rows.length) {
      /* 勘定科目が1件も無いと経費精算の明細が入力できないため、
         その場で標準セットを入れられるようにする。 */
      if (def.entity === 'Accounts' && !def.list().length && editable) {
        return UI.empty('📒', '勘定科目がまだ登録されていません',
          '経費精算・購買申請の明細で科目が選べません。まずは標準の科目を入れるか、会計システムの科目表を取り込んでください。') +
          '<div style="text-align:center;padding:0 16px 20px"><button class="btn btn-primary" data-act="seedacc">' +
          '標準の勘定科目 ' + STARTER_ACCOUNTS.length + ' 件を登録する</button>' +
          '<div class="page-sub" style="margin-top:8px">登録後に名称・コード・税区分は自由に変更できます。</div></div>';
      }
      return UI.empty('📭', '該当する' + def.label + 'がありません', '絞り込みを変えるか、新しく追加してください');
    }
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
  /**
   * マスタの追加・編集ダイアログ
   * @param {object} [opts] 申請画面から呼ぶとき用。
   *   onSaved(saved) を渡すと、画面全体の再描画をせずに呼び出し元へ返す
   *   （入力途中の申請フォームが消えないようにするため）
   */
  /**
   * 既存のコードから次の連番を作る（S0007 → S0008、101 → 102）。
   * 手で1件ずつ足すとき、番号を調べ直さずに済むようにする。
   * 桁数と接頭辞は既存のものに合わせる。推定できなければ空を返す。
   */
  function nextCode(def) {
    var key = def.codeKey;
    if (!key) return '';
    var best = null;
    def.list().forEach(function (r) {
      var m = /^([A-Za-z\-_]*)(\d+)$/.exec(String(r[key] == null ? '' : r[key]).trim());
      if (!m) return;
      var cand = { prefix: m[1], width: m[2].length, num: Number(m[2]) };
      if (!best || cand.num > best.num) best = cand;
    });
    if (!best) return '';
    var n = String(best.num + 1);
    while (n.length < best.width) n = '0' + n;
    return best.prefix + n;
  }

  function openForm(key, id, opts) {
    var def = DEFS[key];
    if (App.blockIfImpersonating('マスタの編集')) return;
    if (!def.canEdit(me())) { Access.denied('マスタの編集', def.label); UI.toast('編集の権限がありません（記録しました）', 'error'); return; }
    var rec = id ? def.list().filter(function (r) { return String(r.ID) === String(id); })[0] : null;
    var draft = {};
    def.fields.forEach(function (f) {
      draft[f.key] = rec ? rec[f.key] : (f.def !== undefined ? f.def : (f.type === 'roles' ? [CFG.ROLE_USER] : ''));
    });
    /* 新規追加のときはコードの連番を入れておく（必須なのに空で止まるのを防ぐ） */
    if (!rec && def.codeKey && !draft[def.codeKey]) draft[def.codeKey] = nextCode(def);

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
            var picked = box.querySelector('[data-role]:checked');
            draft[f.key] = [picked ? picked.dataset.role : CFG.ROLE_USER];
          } else draft[f.key] = n.value;
        });
        var err = validate(key, def, draft, rec);
        if (err) { UI.toast(err, 'error'); return false; }
        save(key, def, draft, rec, opts);
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
        /* 権限は2つに1つ。複数選択にすると「承認者だけど管理者」のような
           中間状態が生まれ、どこまでさわれるのか誰も説明できなくなる。 */
        var isAdminRole = Perm.normalizeRoles(v || [])[0] === CFG.ROLE_ADMIN;
        input = '<div style="display:grid;gap:8px">' + CFG.ROLES.map(function (r) {
          var on = (r === CFG.ROLE_ADMIN) === isAdminRole;
          return '<label class="inline-row" style="gap:8px;align-items:flex-start">' +
            '<input type="radio" name="m_role" data-role="' + E(r) + '" style="width:auto;min-height:auto;margin-top:3px"' +
            (on ? ' checked' : '') + '>' +
            '<span><b>' + E(r) + '</b><br><span class="page-sub">' +
            (r === CFG.ROLE_ADMIN
              ? 'すべての申請を閲覧でき、社員・部署・取引先・勘定科目・承認経路・申請区分を編集できます。'
              : '申請と承認だけができます。元データや承認経路は開けません。') +
            '</span></span></label>';
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
  function save(key, def, d, rec, opts) {
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
      /* 申請フォームから呼ばれた場合は、入力途中の内容を消さないよう全体再描画をしない */
      if (opts && opts.onSaved) opts.onSaved(saved); else App.refresh();
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

  /** 標準の勘定科目をまとめて登録する（空のままだと経費精算が出せないため） */
  function seedAccounts() {
    if (App.blockIfImpersonating('勘定科目の登録')) return;
    if (!DEFS.Accounts.canEdit(me())) { UI.toast('勘定科目を登録する権限がありません', 'error'); return; }
    var have = {};
    S().accounts.forEach(function (a) { have[String(a.Account_Code)] = true; });
    var add = STARTER_ACCOUNTS.filter(function (a) { return !have[a.Account_Code]; });
    if (!add.length) { UI.toast('標準の勘定科目はすべて登録済みです'); return; }
    UI.toast('勘定科目を登録しています…');
    /* Creator 側の書き込みは直列にする（一括で投げると取りこぼす） */
    var i = 0;
    function next() {
      if (i >= add.length) return Promise.resolve();
      var o = add[i++];
      return DB.add('Accounts', o).then(function (saved) { S().accounts.push(saved); return next(); });
    }
    next().then(function () {
      App.audit('マスタ追加', '勘定科目', '', '標準の勘定科目 ' + add.length + ' 件を一括登録');
      UI.toast(add.length + ' 件の勘定科目を登録しました', 'success');
      App.refresh();
    }).catch(function (e) {
      UI.toast('登録に失敗しました：' + (e && e.message ? e.message : e), 'error');
      App.refresh();
    });
  }

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
    var tpl = el.querySelector('[data-act="tpl"]');
    if (tpl) tpl.addEventListener('click', function () { exportCsv(key, false); });
    var exp = el.querySelector('[data-act="exp"]');
    if (exp) exp.addEventListener('click', function () { exportCsv(key, true); });
    var imp = el.querySelector('[data-act="imp"]');
    if (imp) imp.addEventListener('click', function () { openImport(key); });
    var seedAcc = el.querySelector('[data-act="seedacc"]');
    if (seedAcc) seedAcc.addEventListener('click', function () { seedAccounts(); });
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

  return { render: render, openForm: openForm, DEFS: DEFS, seedAccounts: seedAccounts, STARTER_ACCOUNTS: STARTER_ACCOUNTS,
           exportCsv: exportCsv, openImport: openImport, analyze: analyze, parseCsv: parseCsv, suggestRoles: suggestRoles };
})();
