/* =========================================================================
 * config.js — Creator のフォーム／レポート名と、項目名の対応表
 *
 * Creator 側のリンク名を変えたら、このファイルだけを直せば済むようにする。
 * ========================================================================= */
var CFG = {
  STORAGE_PREFIX: 'sample_',

  /* レコードを追加するときに使うフォームのリンク名 */
  FORMS: {
    Items: 'Sample_Item_Form',
    Logs:  'Sample_Log_Form'
  },

  /* 取得・更新するときに使うレポートのリンク名 */
  REPORTS: {
    Items: 'Sample_Item_Report',
    Logs:  'Sample_Log_Report'
  },

  /* 画面内部の項目名 ⇔ Creator のフィールド リンク名
     Creator 側は snake_case、画面側は読みやすい名前、という食い違いをここで吸収する */
  FIELD_MAP: {
    Items: {
      Item_Key:   'item_id',
      Item_Name:  'item_name',
      Category:   'category',
      Qty:        'qty',
      Unit_Price: 'unit_price',
      Note:       'note',
      Data_JSON:  'data_json',
      Is_Active:  'is_active'
    },
    Logs: {
      Log_Time:   'log_time',
      Actor_Name: 'actor_name',
      Action:     'action',
      Target_ID:  'target_id',
      Detail:     'detail'
    }
  },

  /* "true" / "false" の文字列で保存される項目。読み込み時に真偽値へ戻す */
  BOOL_FIELDS: ['Is_Active'],

  MAX_RECORDS: 1000
};
