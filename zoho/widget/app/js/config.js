/* =========================================================================
 * config.js — アプリ定数 / Creator フォーム・レポート名 / 申請テンプレート定義
 * Creator 側のリンク名を変更した場合は CFG.FORMS / CFG.REPORTS のみ修正すれば動作します。
 * ========================================================================= */
var CFG = {
  APP_TITLE: '社内申請システム',
  STORAGE_PREFIX: 'wf_',

  /* Creator のフォーム リンク名（レコード追加時に使用）
   * ※ 名前と項目名は ds/ShanaiShinsei.ds と一対一で対応しています。 */
  FORMS: {
    Departments:   'Wf_Dept_Form',
    Employees:     'Wf_Employee_Form',
    Vendors:       'Wf_Vendor_Form',
    Accounts:      'Wf_Account_Form',
    RequestTypes:  'Wf_Type_Form',
    Requests:      'Wf_Request_Form',
    RequestLines:  'Wf_Line_Form',
    Approvals:     'Wf_Approval_Form',
    AccessLogs:    'Wf_Access_Form',
    AuditLogs:     'Wf_Audit_Form',
    Notifications: 'Wf_Notify_Form'
  },

  /* Creator のレポート リンク名（取得・更新時に使用） */
  REPORTS: {
    Departments:   'Wf_Dept_Report',
    Employees:     'Wf_Employee_Report',
    Vendors:       'Wf_Vendor_Report',
    Accounts:      'Wf_Account_Report',
    RequestTypes:  'Wf_Type_Report',
    Requests:      'Wf_Request_Report',
    RequestLines:  'Wf_Line_Report',
    Approvals:     'Wf_Approval_Report',
    AccessLogs:    'Wf_Access_Report',
    AuditLogs:     'Wf_Audit_Report',
    Notifications: 'Wf_Notify_Report'
  },

  /* =======================================================================
   * 画面内部の項目名 ⇔ Creator のフィールド リンク名 の対応表
   * Creator 側は text / textarea / number しか使わない方針のため、
   * ルックアップや選択肢の型崩れが起きません。関係は ID を文字列で持ちます。
   * ===================================================================== */
  FIELD_MAP: {
    Departments: { Dept_Key: 'dept_id', Department_Code: 'dept_code', Department_Name: 'dept_name',
                   Parent_Department: 'parent_id', Dept_Head: 'head_id', Sort_Order: 'sort_order' },
    Employees:   { Emp_Key: 'emp_id', Employee_ID: 'emp_no', Employee_Name: 'emp_name',
                   Employee_Kana: 'emp_kana', Email: 'email', Department_name: 'dept_name',
                   Title: 'title', Manager: 'manager_id', Manager_name: 'manager_name',
                   Roles: 'roles', Join_Date: 'join_date', Paid_Leave_Balance: 'leave_balance',
                   Deputy: 'deputy_id', Deputy_From: 'deputy_from', Deputy_To: 'deputy_to',
                   Is_Active: 'is_active' },
    Vendors:     { Vendor_Key: 'vendor_id', Vendor_Code: 'vendor_code', Vendor_Name: 'vendor_name',
                   Invoice_Reg_No: 'invoice_reg_no', Is_Qualified: 'is_qualified',
                   Payment_Terms: 'payment_terms' },
    Accounts:    { Account_Key: 'account_id', Account_Code: 'account_code',
                   Account_Name: 'account_name', Tax_Category: 'tax_category', Is_Active: 'is_active' },
    RequestTypes:{ Type_Code: 'type_code', Type_Name: 'type_name', Category: 'category', Icon: 'icon',
                   Description: 'description', Field_Schema: 'field_schema', Route_Rule: 'route_rule',
                   Sensitivity: 'sensitivity', Sort_Order: 'sort_order', Is_Active: 'is_active' },
    Requests:    { Request_No: 'request_no', Type_Code: 'type_code', Request_Type_name: 'type_name',
                   Subject: 'subject', Applicant: 'applicant_id', Applicant_name: 'applicant_name',
                   Applicant_Dept_name: 'applicant_dept', Amount: 'amount', Status: 'status',
                   Applied_On: 'applied_on', Completed_On: 'completed_on', Current_Step: 'current_step',
                   Route_JSON: 'route_json', Form_Data_JSON: 'form_data_json',
                   Payment_Due_Date: 'payment_due', Paid: 'paid', Journal_Exported: 'journal_exported' },
    RequestLines:{ Request: 'request_id', Request_No: 'request_no', Line_No: 'line_no',
                   Line_Date: 'line_date', Account_Name: 'account_name', Vendor_Name: 'vendor_name',
                   Description: 'description', Qty: 'qty', Unit_Price: 'unit_price', Amount: 'amount',
                   Tax_Rate: 'tax_rate', Tax_Amount: 'tax_amount', Invoice_No: 'invoice_no' },
    Approvals:   { Request: 'request_id', Request_No: 'request_no', Step_No: 'step_no',
                   Step_Name: 'step_name', Step_Type: 'step_type', Approver: 'approver_id',
                   Approver_name: 'approver_name', Acted_By: 'acted_by_id', Acted_By_name: 'acted_by_name',
                   Action: 'action', Comment: 'comment', Due_Date: 'due_date', Acted_On: 'acted_on',
                   Is_Delegate: 'is_delegate' },
    AccessLogs:  { Log_Time: 'log_time', Session_ID: 'session_id', Actor: 'actor_id',
                   Actor_Name: 'actor_name', Actor_Dept: 'actor_dept', Actor_Role: 'actor_role',
                   Login_User: 'login_user', Action: 'action', Target_Type: 'target_type',
                   Target_ID: 'target_id', Target_No: 'target_no', Target_Subject: 'target_subject',
                   Request_Type_Code: 'type_code', Sensitivity: 'sensitivity', Owner_Dept: 'owner_dept',
                   Cross_Dept: 'cross_dept', Result_Count: 'result_count', Duration_Sec: 'duration_sec',
                   Detail: 'detail', User_Agent: 'user_agent' },
    AuditLogs:   { Log_Time: 'log_time', User: 'user_id', User_name: 'user_name',
                   Action_Type: 'action_type', Target_Type: 'target_type', Target_ID: 'target_id',
                   Detail: 'detail', Session_ID: 'session_id' },
    Notifications:{ To_User: 'to_user_id', Request: 'request_id', Request_No: 'request_no',
                    Kind: 'kind', Message: 'message', Is_Read: 'is_read', Created_Time: 'created_time' }
  },

  /* 文字列 "true"/"false" で保存される真偽項目（読み込み時に真偽値へ戻す） */
  BOOL_FIELDS: ['Is_Active', 'Is_Qualified', 'Is_Read', 'Is_Delegate', 'Cross_Dept', 'Paid', 'Journal_Exported'],

  /* 公開済み Deluge 関数を使う場合の API 名（未公開なら widget 側の workflow.js が計算） */
  CUSTOM_API: { calcRoute: 'calc_route', actOnStep: 'act_on_step', writeAccessLog: 'write_access_log' },

  /* =======================================================================
   * 閲覧証跡（本システムの中核）
   * 「誰が・いつ・どの申請の・何を・どこから見たか」を全操作で記録します。
   * 記録は Creator 側 Access_Logs フォームに書き込み、widget からは追記のみ
   * （更新・削除の権限を与えない＝証跡の改ざん防止）。
   * ===================================================================== */
  ACCESS: {
    /* 記録する操作種別 */
    ACTIONS: {
      VIEW_DETAIL:  '詳細閲覧',
      VIEW_LIST:    '一覧閲覧',
      SEARCH:       '検索',
      EXPORT_CSV:   'CSV出力',
      PRINT:        '印刷',
      DOWNLOAD:     '添付DL',
      VIEW_LOG:     '閲覧証跡の閲覧',
      DENIED:       'アクセス拒否',
      LOGIN:        '利用開始',
      SWITCH_USER:  'ユーザー切替'
    },
    /* 機微度：申請区分ごとに閲覧証跡の重みを変える */
    SENSITIVITY: {
      OFFBOARD: 'S', ONBOARD: 'S', LEAVE: 'A', OVERTIME: 'A',
      CONTRACT: 'A', PAYMENT: 'A', RINGI: 'B', PURCHASE: 'B',
      EXPENSE: 'B', TRANSPORT: 'C', TRIP: 'C', SEAL: 'B'
    },
    /* 異常検知のしきい値（閲覧監査画面でフラグ表示） */
    ANOMALY: {
      NIGHT_FROM: 22,        // 22時以降
      NIGHT_TO: 5,           // 5時まで
      BULK_VIEW_PER_HOUR: 30,// 1時間に30件超の詳細閲覧
      EXPORT_PER_DAY: 3,     // 1日3回超のCSV出力
      CROSS_DEPT: true       // 他部署かつ機微度S/Aの閲覧
    },
    RETENTION_DAYS: 2555     // 7年（電子帳簿保存法の保存期間に合わせる）
  },

  /* =======================================================================
   * 権限マトリクス（widget 側の表示制御）
   * ※ Creator 側でも Roles + レコードレベル条件で同じ制限を必ず設定すること。
   *   widget だけの制御は「画面の親切」であって「守り」ではありません。
   * ===================================================================== */
  PERMISSIONS: {
    申請者: { scope: 'own',        canExport: false, canViewLog: 'own',  canViewAmountOfOthers: false },
    承認者: { scope: 'assigned',   canExport: false, canViewLog: 'own',  canViewAmountOfOthers: true  },
    経理:   { scope: 'finance',    canExport: true,  canViewLog: 'own',  canViewAmountOfOthers: true  },
    人事:   { scope: 'hr',         canExport: true,  canViewLog: 'own',  canViewAmountOfOthers: true  },
    管理者: { scope: 'all',        canExport: true,  canViewLog: 'all',  canViewAmountOfOthers: true  }
  },
  /* 経理が閲覧してよい申請区分 / 人事が閲覧してよい申請区分 */
  SCOPE_TYPES: {
    finance: ['EXPENSE', 'TRANSPORT', 'PAYMENT', 'TRIP', 'RINGI', 'PURCHASE', 'CONTRACT'],
    hr: ['LEAVE', 'OVERTIME', 'ONBOARD', 'OFFBOARD']
  },

  STATUS: {
    DRAFT: '下書き', ACTIVE: '申請中', APPROVED: '承認済',
    REJECTED: '却下', SENTBACK: '差戻し', CANCELED: '取下げ'
  },
  ACTION: {
    PENDING: '未処理', APPROVE: '承認', REJECT: '却下', SENDBACK: '差戻し',
    COND: '条件付承認', READ: '既読', SKIP: 'スキップ'
  },
  TITLES: ['社長', '本部長', '部長', '課長', '主任', '一般'],
  ROLES: ['申請者', '承認者', '管理者', '経理', '人事'],
  TAX: [
    { key: '課税10%', rate: 0.10 }, { key: '軽減8%', rate: 0.08 },
    { key: '非課税', rate: 0 }, { key: '不課税', rate: 0 }
  ],
  PAGE_SIZE: 200
};

/* =========================================================================
 * 申請テンプレート定義
 *  fields[].type : text | textarea | number | currency | date | daterange |
 *                  select | radio | checkbox | employee | department |
 *                  vendor | account | lines
 *  route.steps[] : name / type(承認|合議|或議|回覧) / assignee / days / when
 *  assignee.mode : manager(上長N段) | title(役職) | department(部署) |
 *                  fixed(固定) | applicantSelect(申請時選択)
 *  when          : { field:'amount', gte:100000, lt:500000 } 省略時は常に経路に含む
 * ========================================================================= */
var TEMPLATES = [
  {
    code: 'RINGI', name: '稟議書', icon: '📋', category: '稟議・購買',
    desc: '一般稟議。金額により決裁者が自動で変わります。',
    fields: [
      { key: 'subject', label: '件名', type: 'text', required: true, full: true },
      { key: 'amount', label: '金額（税込）', type: 'currency', required: true, routeKey: true },
      { key: 'exec_date', label: '実行予定日', type: 'date', required: true },
      { key: 'category', label: '区分', type: 'select', required: true, options: ['設備投資', '業務委託', 'システム導入', '広告宣伝', 'その他'] },
      { key: 'reason', label: '起案理由・背景', type: 'textarea', required: true, full: true },
      { key: 'effect', label: '期待効果', type: 'textarea', full: true },
      { key: 'risk', label: 'リスク・代替案', type: 'textarea', full: true }
    ],
    route: { steps: [
      { name: '直属上長', type: '承認', assignee: { mode: 'manager', level: 1 }, days: 2 },
      { name: '部長決裁', type: '承認', assignee: { mode: 'title', title: '部長' }, days: 3, when: { field: 'amount', gte: 100000 } },
      { name: '本部長決裁', type: '承認', assignee: { mode: 'title', title: '本部長' }, days: 3, when: { field: 'amount', gte: 500000 } },
      { name: '社長決裁', type: '承認', assignee: { mode: 'title', title: '社長' }, days: 5, when: { field: 'amount', gte: 3000000 } },
      { name: '経理回覧', type: '回覧', assignee: { mode: 'department', department: '経理部' }, days: 3 }
    ] }
  },
  {
    code: 'EXPENSE', name: '経費精算', icon: '🧾', category: '経費',
    desc: '明細行ごとに勘定科目・税区分・インボイス番号を登録。',
    fields: [
      { key: 'subject', label: '件名', type: 'text', required: true, full: true },
      { key: 'pay_month', label: '精算対象月', type: 'text', required: true, placeholder: '2026-09' },
      { key: 'bank_note', label: '振込先メモ', type: 'text' },
      { key: 'lines', label: '経費明細', type: 'lines', required: true, full: true, columns: [
        { key: 'date', label: '日付', type: 'date', w: '120px' },
        { key: 'account', label: '勘定科目', type: 'account', w: '140px' },
        { key: 'vendor', label: '取引先', type: 'vendor', w: '150px' },
        { key: 'desc', label: '摘要', type: 'text' },
        { key: 'invoice_no', label: '登録番号', type: 'text', w: '140px' },
        { key: 'tax', label: '税区分', type: 'tax', w: '110px' },
        { key: 'amount', label: '金額(税込)', type: 'currency', w: '120px' }
      ] }
    ],
    route: { steps: [
      { name: '直属上長', type: '承認', assignee: { mode: 'manager', level: 1 }, days: 2 },
      { name: '部長承認', type: '承認', assignee: { mode: 'title', title: '部長' }, days: 3, when: { field: 'amount', gte: 50000 } },
      { name: '経理検収', type: '承認', assignee: { mode: 'department', department: '経理部' }, days: 3 }
    ] }
  },
  {
    code: 'TRANSPORT', name: '交通費精算', icon: '🚃', category: '経費',
    desc: '区間ごとに往復区分・定期控除を判定します。',
    fields: [
      { key: 'subject', label: '件名', type: 'text', required: true, full: true },
      { key: 'pay_month', label: '精算対象月', type: 'text', required: true, placeholder: '2026-09' },
      { key: 'lines', label: '交通費明細', type: 'lines', required: true, full: true, columns: [
        { key: 'date', label: '日付', type: 'date', w: '120px' },
        { key: 'from', label: '出発地', type: 'text', w: '130px' },
        { key: 'to', label: '到着地', type: 'text', w: '130px' },
        { key: 'purpose', label: '目的', type: 'text' },
        { key: 'roundtrip', label: '往復', type: 'select', options: ['片道', '往復'], w: '90px' },
        { key: 'amount', label: '金額', type: 'currency', w: '110px' }
      ] }
    ],
    route: { steps: [
      { name: '直属上長', type: '承認', assignee: { mode: 'manager', level: 1 }, days: 2 },
      { name: '経理検収', type: '承認', assignee: { mode: 'department', department: '経理部' }, days: 3 }
    ] }
  },
  {
    code: 'PURCHASE', name: '購買申請', icon: '🛒', category: '稟議・購買',
    desc: '備品・消耗品の購入。相見積の有無を記録します。',
    fields: [
      { key: 'subject', label: '件名', type: 'text', required: true, full: true },
      { key: 'need_by', label: '希望納期', type: 'date', required: true },
      { key: 'quote_count', label: '相見積社数', type: 'number', required: true },
      { key: 'reason', label: '購入理由', type: 'textarea', required: true, full: true },
      { key: 'lines', label: '購入明細', type: 'lines', required: true, full: true, columns: [
        { key: 'item', label: '品名', type: 'text' },
        { key: 'model', label: '型番', type: 'text', w: '140px' },
        { key: 'vendor', label: '取引先', type: 'vendor', w: '150px' },
        { key: 'qty', label: '数量', type: 'number', w: '80px' },
        { key: 'unit_price', label: '単価', type: 'currency', w: '110px' },
        { key: 'amount', label: '金額', type: 'calc', formula: 'qty*unit_price', w: '120px' }
      ] }
    ],
    route: { steps: [
      { name: '直属上長', type: '承認', assignee: { mode: 'manager', level: 1 }, days: 2 },
      { name: '部長承認', type: '承認', assignee: { mode: 'title', title: '部長' }, days: 3, when: { field: 'amount', gte: 100000 } },
      { name: '本部長決裁', type: '承認', assignee: { mode: 'title', title: '本部長' }, days: 3, when: { field: 'amount', gte: 500000 } },
      { name: '総務発注', type: '承認', assignee: { mode: 'department', department: '総務部' }, days: 2 }
    ] }
  },
  {
    code: 'PAYMENT', name: '支払申請', icon: '💴', category: '経費',
    desc: '請求書払い。適格請求書発行事業者かを自動判定します。',
    fields: [
      { key: 'subject', label: '件名', type: 'text', required: true, full: true },
      { key: 'vendor', label: '取引先', type: 'vendor', required: true },
      { key: 'invoice_number', label: '請求書番号', type: 'text', required: true },
      { key: 'amount', label: '請求金額（税込）', type: 'currency', required: true, routeKey: true },
      { key: 'tax', label: '税区分', type: 'select', required: true, options: ['課税10%', '軽減8%', '非課税', '不課税'] },
      { key: 'account', label: '勘定科目', type: 'account', required: true },
      { key: 'due_date', label: '支払期日', type: 'date', required: true },
      { key: 'note', label: '摘要', type: 'textarea', full: true }
    ],
    route: { steps: [
      { name: '直属上長', type: '承認', assignee: { mode: 'manager', level: 1 }, days: 2 },
      { name: '部長承認', type: '承認', assignee: { mode: 'title', title: '部長' }, days: 3, when: { field: 'amount', gte: 100000 } },
      { name: '本部長決裁', type: '承認', assignee: { mode: 'title', title: '本部長' }, days: 3, when: { field: 'amount', gte: 1000000 } },
      { name: '経理支払処理', type: '承認', assignee: { mode: 'department', department: '経理部' }, days: 3 }
    ] }
  },
  {
    code: 'SEAL', name: '押印申請', icon: '🔴', category: 'その他',
    desc: '印章種別・押印枚数・返却期限を管理します。',
    fields: [
      { key: 'subject', label: '書類名', type: 'text', required: true, full: true },
      { key: 'seal_type', label: '印章種別', type: 'select', required: true, options: ['代表者印（実印）', '角印', '銀行印', '契約印'] },
      { key: 'sheets', label: '押印枚数', type: 'number', required: true },
      { key: 'counterparty', label: '相手先', type: 'text', required: true },
      { key: 'use_date', label: '使用日', type: 'date', required: true },
      { key: 'return_date', label: '返却予定日', type: 'date' },
      { key: 'reason', label: '押印理由', type: 'textarea', required: true, full: true }
    ],
    route: { steps: [
      { name: '直属上長', type: '承認', assignee: { mode: 'manager', level: 1 }, days: 1 },
      { name: '総務確認', type: '承認', assignee: { mode: 'department', department: '総務部' }, days: 2 },
      { name: '実印決裁', type: '承認', assignee: { mode: 'title', title: '社長' }, days: 3, when: { field: 'seal_type', eq: '代表者印（実印）' } }
    ] }
  },
  {
    code: 'LEAVE', name: '休暇申請', icon: '🏖️', category: '人事・労務',
    desc: '有給残日数と連動。半休・時間単位年休に対応。',
    fields: [
      { key: 'leave_type', label: '休暇種別', type: 'select', required: true, options: ['年次有給休暇', '半休（午前）', '半休（午後）', '時間単位年休', '特別休暇', '慶弔休暇', '振替休日', '欠勤'] },
      { key: 'from_date', label: '開始日', type: 'date', required: true },
      { key: 'to_date', label: '終了日', type: 'date', required: true },
      { key: 'days', label: '取得日数', type: 'number', required: true },
      { key: 'reason', label: '理由', type: 'textarea', full: true },
      { key: 'handover', label: '業務引継ぎ先', type: 'employee' }
    ],
    route: { steps: [
      { name: '直属上長', type: '承認', assignee: { mode: 'manager', level: 1 }, days: 1 },
      { name: '部長承認', type: '承認', assignee: { mode: 'title', title: '部長' }, days: 2, when: { field: 'days', gte: 5 } },
      { name: '人事記録', type: '回覧', assignee: { mode: 'department', department: '人事部' }, days: 3 }
    ] }
  },
  {
    code: 'TRIP', name: '出張申請', icon: '✈️', category: '経費',
    desc: '規程に基づく日当・宿泊上限を表示します。',
    fields: [
      { key: 'subject', label: '出張目的', type: 'text', required: true, full: true },
      { key: 'destination', label: '出張先', type: 'text', required: true },
      { key: 'from_date', label: '出発日', type: 'date', required: true },
      { key: 'to_date', label: '帰着日', type: 'date', required: true },
      { key: 'nights', label: '宿泊数', type: 'number', required: true },
      { key: 'transport_fee', label: '交通費見込', type: 'currency', required: true },
      { key: 'hotel_fee', label: '宿泊費見込', type: 'currency', required: true },
      { key: 'per_diem', label: '日当', type: 'currency' },
      { key: 'amount', label: '合計見込（税込）', type: 'currency', required: true, routeKey: true },
      { key: 'advance', label: '仮払希望', type: 'checkbox' }
    ],
    route: { steps: [
      { name: '直属上長', type: '承認', assignee: { mode: 'manager', level: 1 }, days: 2 },
      { name: '部長承認', type: '承認', assignee: { mode: 'title', title: '部長' }, days: 2, when: { field: 'amount', gte: 100000 } },
      { name: '本部長決裁', type: '承認', assignee: { mode: 'title', title: '本部長' }, days: 3, when: { field: 'amount', gte: 300000 } },
      { name: '経理仮払', type: '承認', assignee: { mode: 'department', department: '経理部' }, days: 2 }
    ] }
  },
  {
    code: 'OVERTIME', name: '残業・休日出勤申請', icon: '🕘', category: '人事・労務',
    desc: '当月累計と36協定上限を突き合わせます。',
    fields: [
      { key: 'work_date', label: '対象日', type: 'date', required: true },
      { key: 'work_type', label: '区分', type: 'select', required: true, options: ['時間外労働', '休日出勤', '深夜労働'] },
      { key: 'hours', label: '見込時間数', type: 'number', required: true },
      { key: 'reason', label: '理由', type: 'textarea', required: true, full: true }
    ],
    route: { steps: [
      { name: '直属上長', type: '承認', assignee: { mode: 'manager', level: 1 }, days: 1 },
      { name: '部長承認', type: '承認', assignee: { mode: 'title', title: '部長' }, days: 2, when: { field: 'hours', gte: 20 } },
      { name: '人事確認', type: '回覧', assignee: { mode: 'department', department: '人事部' }, days: 3 }
    ] }
  },
  {
    code: 'ONBOARD', name: '入社手続き申請', icon: '🎓', category: '人事・労務',
    desc: '貸与品・アカウント発行をチェックリスト化。',
    fields: [
      { key: 'emp_name', label: '入社者氏名', type: 'text', required: true },
      { key: 'emp_kana', label: 'フリガナ', type: 'text', required: true },
      { key: 'join_date', label: '入社日', type: 'date', required: true },
      { key: 'emp_type', label: '雇用区分', type: 'select', required: true, options: ['正社員', '契約社員', 'パート・アルバイト', '嘱託', '派遣'] },
      { key: 'department', label: '配属部署', type: 'department', required: true },
      { key: 'title', label: '役職', type: 'select', options: ['一般', '主任', '課長', '部長', '本部長'] },
      { key: 'equipment', label: '貸与品', type: 'text', full: true, placeholder: 'ノートPC / 社用携帯 / 入館証 / 名刺' },
      { key: 'accounts_needed', label: '必要アカウント', type: 'text', full: true, placeholder: 'メール / 勤怠 / Zoho / 会計' }
    ],
    route: { steps: [
      { name: '配属部署長', type: '承認', assignee: { mode: 'title', title: '部長' }, days: 2 },
      { name: '人事手続き', type: '承認', assignee: { mode: 'department', department: '人事部' }, days: 3 },
      { name: '情シス手配', type: '合議', assignee: { mode: 'department', department: '開発部' }, days: 3 },
      { name: '総務手配', type: '合議', assignee: { mode: 'department', department: '総務部' }, days: 3 }
    ] }
  },
  {
    code: 'OFFBOARD', name: '退職手続き申請', icon: '👋', category: '人事・労務',
    desc: '貸与品返却・アカウント停止まで追跡します。',
    fields: [
      { key: 'emp', label: '対象者', type: 'employee', required: true },
      { key: 'resign_date', label: '退職日', type: 'date', required: true },
      { key: 'last_work_date', label: '最終出社日', type: 'date', required: true },
      { key: 'reason', label: '退職事由', type: 'select', required: true, options: ['自己都合', '会社都合', '定年', '契約期間満了'] },
      { key: 'successor', label: '引継ぎ先', type: 'employee', required: true },
      { key: 'note', label: '引継ぎ事項', type: 'textarea', full: true }
    ],
    route: { steps: [
      { name: '直属上長', type: '承認', assignee: { mode: 'manager', level: 1 }, days: 2 },
      { name: '本部長承認', type: '承認', assignee: { mode: 'title', title: '本部長' }, days: 3 },
      { name: '人事手続き', type: '承認', assignee: { mode: 'department', department: '人事部' }, days: 5 },
      { name: '情シス・総務', type: '合議', assignee: { mode: 'department', department: '総務部' }, days: 5 }
    ] }
  },
  {
    code: 'CONTRACT', name: '契約書レビュー依頼', icon: '📑', category: 'その他',
    desc: '法務チェックと締結決裁をまとめて実施。',
    fields: [
      { key: 'subject', label: '契約名', type: 'text', required: true, full: true },
      { key: 'counterparty', label: '契約相手先', type: 'vendor', required: true },
      { key: 'contract_type', label: '契約種別', type: 'select', required: true, options: ['業務委託', '売買', '秘密保持(NDA)', 'ライセンス', '賃貸借', 'その他'] },
      { key: 'amount', label: '契約金額（税込）', type: 'currency', required: true, routeKey: true },
      { key: 'start_date', label: '契約開始日', type: 'date', required: true },
      { key: 'end_date', label: '契約終了日', type: 'date' },
      { key: 'auto_renew', label: '自動更新条項あり', type: 'checkbox' },
      { key: 'note', label: '留意事項', type: 'textarea', full: true }
    ],
    route: { steps: [
      { name: '直属上長', type: '承認', assignee: { mode: 'manager', level: 1 }, days: 2 },
      { name: '法務レビュー', type: '承認', assignee: { mode: 'department', department: '総務部' }, days: 5 },
      { name: '本部長決裁', type: '承認', assignee: { mode: 'title', title: '本部長' }, days: 3, when: { field: 'amount', gte: 500000 } },
      { name: '社長決裁', type: '承認', assignee: { mode: 'title', title: '社長' }, days: 5, when: { field: 'amount', gte: 3000000 } }
    ] }
  }
];
