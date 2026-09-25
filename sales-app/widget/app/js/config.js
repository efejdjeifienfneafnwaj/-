/* =========================================================================
 * config.js — Creator のフォーム／レポート名と、項目名の対応表
 *
 * Creator 側のリンク名を変えたら、このファイルだけを直せば済むようにする。
 * .ds とずれると静かに壊れるので、変更後は必ず verify/schema-check.js を通す。
 * ========================================================================= */
var CFG = {
  APP_TITLE: '営業管理テスト',
  STORAGE_PREFIX: 'salesapp_',

  /* レコードを追加するときに使うフォームのリンク名 */
  FORMS: {
    Staff:      'Sales_Staff_Form',
    Customers:  'Sales_Customer_Form',
    Deals:      'Sales_Deal_Form',
    Activities: 'Sales_Activity_Form',
    Targets:    'Sales_Target_Form',
    Logs:       'Sales_Log_Form'
  },

  /* 取得・更新するときに使うレポートのリンク名 */
  REPORTS: {
    Staff:      'Sales_Staff_Report',
    Customers:  'Sales_Customer_Report',
    Deals:      'Sales_Deal_Report',
    Activities: 'Sales_Activity_Report',
    Targets:    'Sales_Target_Report',
    Logs:       'Sales_Log_Report'
  },

  /* 画面内部の項目名 ⇔ Creator のフィールド リンク名
     Updated_At を持つ項目にだけ、保存時に更新日時を書き込む（操作記録には無い） */
  FIELD_MAP: {
    Staff: {
      Name:       'staff_name',
      Email:      'staff_email',
      Team:       'staff_team',
      Role:       'staff_role',
      Is_Active:  'is_active',
      Updated_At: 'updated_at'
    },
    Customers: {
      Name:       'cust_name',
      Industry:   'industry',
      Rank:       'cust_rank',
      Contact:    'contact_person',
      Phone:      'cust_phone',
      Address:    'cust_address',
      Owner_ID:   'owner_id',
      Owner_Name: 'owner_name',
      Note:       'cust_note',
      Is_Active:  'is_active',
      Updated_At: 'updated_at'
    },
    Deals: {
      Name:           'deal_name',
      Customer_ID:    'customer_id',
      Customer_Name:  'customer_name',
      Owner_ID:       'owner_id',
      Owner_Name:     'owner_name',
      Owner_Email:    'owner_email',
      Stage:          'deal_stage',
      Amount:         'deal_amount',
      Prob:           'win_prob',
      Close_Plan:     'close_plan',
      Closed_On:      'closed_on',
      Next_Action:    'next_action',
      Next_Action_On: 'next_action_on',
      Note:           'deal_note',
      Updated_At:     'updated_at'
    },
    Activities: {
      Date:          'act_date',
      Type:          'act_type',
      Customer_ID:   'customer_id',
      Customer_Name: 'customer_name',
      Deal_ID:       'deal_id',
      Deal_Name:     'deal_name',
      Staff_ID:      'staff_id',
      Staff_Name:    'staff_name',
      Staff_Email:   'staff_email',
      Summary:       'act_summary',
      Updated_At:    'updated_at'
    },
    Targets: {
      Month:      'target_month',
      Staff_ID:   'staff_id',
      Staff_Name: 'staff_name',
      Staff_Email: 'staff_email',
      Amount:     'target_amount',
      Updated_At: 'updated_at'
    },
    Logs: {
      Log_Time:   'log_time',
      Actor_Name: 'actor_name',
      Action:     'log_action',
      Target_ID:  'target_id',
      Detail:     'log_detail'
    }
  },

  /* "true" / "false" の文字列で保存される項目。読み込み時に真偽値へ戻す */
  BOOL_FIELDS: ['Is_Active'],
  /* 空欄のときに true とみなす項目（Creator の画面から直接登録して空欄でも「在籍」「取引中」になる） */
  BOOL_DEFAULT_TRUE: ['Is_Active'],

  /* 日付（yyyy-MM-dd）・年月（yyyy-MM）として読む項目。「2026/9/5」などもそろえてから使う */
  DATE_FIELDS: ['Close_Plan', 'Closed_On', 'Next_Action_On', 'Date'],
  MONTH_FIELDS: ['Month'],

  /* 案件のステージ。値は日本語のまま Creator の text 項目に入る（CSV でもそのまま書ける） */
  STAGES: [
    { key: 'リード', prob: 10,  open: true },
    { key: '提案',   prob: 30,  open: true },
    { key: '見積',   prob: 50,  open: true },
    { key: '交渉',   prob: 70,  open: true },
    { key: '受注',   prob: 100, open: false, won: true },
    { key: '失注',   prob: 0,   open: false }
  ],
  ACT_TYPES: ['訪問', '電話', 'メール', 'オンライン商談', 'その他'],
  RANKS: ['A', 'B', 'C'],
  ROLES: { manager: 'マネージャー', member: '担当' },

  MAX_RECORDS: 1000
};
