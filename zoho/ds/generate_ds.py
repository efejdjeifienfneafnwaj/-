# -*- coding: utf-8 -*-
"""
社内申請システムの .ds を生成する。

文法は Creator が実際にエクスポートした .ds に合わせてある（推測ではない）。
要点：
  ・application "日本語名" は引用符で囲む
  ・forms { } / reports { } / pages { } のブロック構造
  ・フィールドは  名前\n( type = text ... )  の括弧記法
  ・各フォームの先頭に Section 要素が要る
  ・フィールド型は text / textarea / number のみ使う
    （実績のある型だけに絞る。日付・金額・真偽もすべて text で持ち、
      意味づけは widget 側が担当する＝LMS アプリと同じ設計）
"""
import io

T, TA, N = 'text', 'textarea', 'number'

FORMS = [
    ('Wf_Dept_Form', '【システム用】部署マスタ', [
        ('dept_id', '部署ID', T), ('dept_code', '部署コード', T), ('dept_name', '部署名', T),
        ('parent_id', '上位部署ID', T), ('head_id', '部門長ID', T), ('sort_order', '表示順', N),
        ('updated_at', '更新日時', T),
    ]),
    ('Wf_Employee_Form', '【システム用】社員マスタ', [
        ('emp_id', '社員ID', T), ('emp_no', '社員番号', T), ('emp_name', '氏名', T),
        ('emp_kana', 'フリガナ', T), ('email', 'メール', T), ('dept_name', '所属', T),
        ('title', '役職', T), ('manager_id', '上長ID', T), ('manager_name', '上長名', T),
        ('roles', '権限（カンマ区切り）', T), ('join_date', '入社日', T),
        ('leave_balance', '有給残日数', N), ('deputy_id', '代理人ID', T),
        ('deputy_from', '代理開始日', T), ('deputy_to', '代理終了日', T),
        ('is_active', '在籍（true/false）', T), ('updated_at', '更新日時', T),
    ]),
    ('Wf_Vendor_Form', '【システム用】取引先マスタ', [
        ('vendor_id', '取引先ID', T), ('vendor_code', '取引先コード', T), ('vendor_name', '取引先名', T),
        ('invoice_reg_no', '登録番号', T), ('is_qualified', '適格事業者（true/false）', T),
        ('payment_terms', '支払条件', T), ('updated_at', '更新日時', T),
    ]),
    ('Wf_Account_Form', '【システム用】勘定科目マスタ', [
        ('account_id', '科目ID', T), ('account_code', '科目コード', T), ('account_name', '勘定科目', T),
        ('tax_category', '既定税区分', T), ('is_active', '有効（true/false）', T),
        ('updated_at', '更新日時', T),
    ]),
    ('Wf_Type_Form', '【システム用】申請テンプレート', [
        ('type_code', '区分コード', T), ('type_name', '申請名', T), ('category', 'カテゴリ', T),
        ('icon', 'アイコン', T), ('description', '説明', T),
        ('field_schema', '項目定義（JSON）', TA), ('route_rule', '経路定義（JSON）', TA),
        ('sensitivity', '機微度', T), ('sort_order', '表示順', N),
        ('is_active', '有効（true/false）', T), ('updated_at', '更新日時', T),
    ]),
    ('Wf_Request_Form', '【システム用】申請', [
        ('request_no', '申請番号', T), ('type_code', '区分コード', T), ('type_name', '申請区分', T),
        ('subject', '件名', T), ('applicant_id', '申請者ID', T), ('applicant_name', '申請者', T),
        ('applicant_dept', '申請者所属', T), ('amount', '金額', N), ('status', 'ステータス', T),
        ('applied_on', '申請日時', T), ('completed_on', '完了日時', T), ('current_step', '現在ステップ', N),
        ('route_json', '承認経路（JSON）', TA), ('form_data_json', '入力値（JSON）', TA),
        ('payment_due', '支払期日', T), ('paid', '支払済（true/false）', T),
        ('journal_exported', '仕訳出力済（true/false）', T), ('updated_at', '更新日時', T),
    ]),
    ('Wf_Line_Form', '【システム用】申請明細', [
        ('request_id', '申請ID', T), ('request_no', '申請番号', T), ('line_no', '行番号', N),
        ('line_date', '取引年月日', T), ('account_name', '勘定科目', T), ('vendor_name', '取引先', T),
        ('description', '摘要', T), ('qty', '数量', N), ('unit_price', '単価', N),
        ('amount', '取引金額', N), ('tax_rate', '税区分', T), ('tax_amount', '消費税額', N),
        ('invoice_no', '登録番号', T), ('updated_at', '更新日時', T),
    ]),
    ('Wf_Approval_Form', '【システム用】承認履歴', [
        ('request_id', '申請ID', T), ('request_no', '申請番号', T), ('step_no', 'ステップ番号', N),
        ('step_name', 'ステップ名', T), ('step_type', '種別', T),
        ('approver_id', '承認者ID', T), ('approver_name', '承認者', T),
        ('acted_by_id', '処理者ID', T), ('acted_by_name', '処理者', T),
        ('action', '処理', T), ('comment', 'コメント', TA), ('due_date', '期限', T),
        ('acted_on', '処理日時', T), ('is_delegate', '代理承認（true/false）', T),
        ('updated_at', '更新日時', T),
    ]),
    ('Wf_Access_Form', '【システム用】閲覧証跡（追記専用）', [
        ('log_time', '日時', T), ('session_id', 'セッションID', T),
        ('actor_id', '操作者ID', T), ('actor_name', '操作者', T), ('actor_dept', '操作者所属', T),
        ('actor_role', '操作者権限', T), ('login_user', 'ログインID', T),
        ('action', '操作', T), ('target_type', '対象種別', T), ('target_id', '対象ID', T),
        ('target_no', '対象申請番号', T), ('target_subject', '対象件名', T),
        ('type_code', '申請区分', T), ('sensitivity', '機微度', T),
        ('owner_dept', '申請の所有部署', T), ('cross_dept', '他部署からの閲覧（true/false）', T),
        ('result_count', '結果件数', N), ('duration_sec', '滞在秒数', N),
        ('detail', '備考', TA), ('user_agent', '端末情報', T),
    ]),
    ('Wf_Audit_Form', '【システム用】操作証跡', [
        ('log_time', '日時', T), ('user_id', '操作者ID', T), ('user_name', '操作者', T),
        ('action_type', '操作種別', T), ('target_type', '対象種別', T), ('target_id', '対象ID', T),
        ('detail', '内容', TA), ('session_id', 'セッションID', T),
    ]),
    ('Wf_Notify_Form', '【システム用】通知', [
        ('to_user_id', '宛先ID', T), ('request_id', '申請ID', T), ('request_no', '申請番号', T),
        ('kind', '種別', T), ('message', '本文', T), ('is_read', '既読（true/false）', T),
        ('created_time', '作成日時', T),
    ]),
]

REPORT_LABEL = {
    'Wf_Dept_Form': '部署マスタ', 'Wf_Employee_Form': '社員マスタ', 'Wf_Vendor_Form': '取引先マスタ',
    'Wf_Account_Form': '勘定科目マスタ', 'Wf_Type_Form': '申請テンプレート', 'Wf_Request_Form': '申請 一覧',
    'Wf_Line_Form': '申請明細 一覧', 'Wf_Approval_Form': '承認履歴 一覧', 'Wf_Access_Form': '閲覧証跡 一覧',
    'Wf_Audit_Form': '操作証跡 一覧', 'Wf_Notify_Form': '通知 一覧',
}
ICON = {
    'Wf_Dept_Form': 'business-bank', 'Wf_Employee_Form': 'users-multiple-11',
    'Wf_Vendor_Form': 'business-briefcase-24', 'Wf_Account_Form': 'business-money-coins',
    'Wf_Type_Form': 'design-todo', 'Wf_Request_Form': 'files-paper', 'Wf_Line_Form': 'design-todo',
    'Wf_Approval_Form': 'ui-1-check', 'Wf_Access_Form': 'ui-1-eye', 'Wf_Audit_Form': 'files-archive',
    'Wf_Notify_Form': 'ui-1-email-85',
}
def rep(f): return f.replace('_Form', '_Report')

o = io.StringIO()
W = o.write

W('/*\n')
W(' * Purpose : 社内申請・承認ワークフロー（閲覧証跡つき）用データ保存アプリ\n')
W(' *           ・すべての項目を text / textarea / number で持ち、意味づけは\n')
W(' *             ウィジェット側が担当する（ルックアップや選択肢に依存しない）\n')
W(' *           ・Wf_Access_Form が「誰が何を見たか」の証跡。追記専用。\n')
W(' *             取り込み後、この1フォームだけは全ロールで編集・削除を無効にすること。\n')
W(' */\n')
W('application "社内申請システム"\n{\n')
W('\tdate format = "yyyy-MM-dd"\n')
W('\ttime zone = "Asia/Tokyo"\n')
W('\ttime format = "24-hr"\n\n')

# ---- forms ----
W('\tforms\n\t{\n')
for fname, fdisp, fields in FORMS:
    W('\t\tform %s\n\t\t{\n' % fname)
    W('\t\t\tdisplayname = "%s"\n' % fdisp)
    W('\t\t\tsuccess message = "保存しました。"\n')
    W('\t\t\tSection\n\t\t\t(\n\t\t\t\ttype = section\n\t\t\t\trow = 1\n\t\t\t\tcolumn = 0\n\t\t\t\twidth = medium\n\t\t\t)\n')
    for key, label, ftype in fields:
        W('\t\t\t%s\n\t\t\t(\n' % key)
        W('\t\t\t\ttype = %s\n' % ftype)
        W('\t\t\t\tdisplayname = "%s"\n' % label)
        if ftype == TA:
            W('\t\t\t\theight = 300px\n')
        W('\t\t\t\trow = 1\n\t\t\t\tcolumn = 1\n\t\t\t\twidth = medium\n\t\t\t)\n')
    W('\t\t\tactions\n\t\t\t{\n')
    W('\t\t\t\ton add\n\t\t\t\t{\n')
    W('\t\t\t\t\tsubmit\n\t\t\t\t\t(\n\t\t\t\t\t\ttype = submit\n\t\t\t\t\t\tdisplayname = "送信"\n\t\t\t\t\t)\n')
    W('\t\t\t\t\treset\n\t\t\t\t\t(\n\t\t\t\t\t\ttype = reset\n\t\t\t\t\t\tdisplayname = "リセット"\n\t\t\t\t\t)\n')
    W('\t\t\t\t}\n')
    W('\t\t\t\ton edit\n\t\t\t\t{\n')
    W('\t\t\t\t\tupdate\n\t\t\t\t\t(\n\t\t\t\t\t\ttype = submit\n\t\t\t\t\t\tdisplayname = "更新"\n\t\t\t\t\t)\n')
    W('\t\t\t\t\tcancel\n\t\t\t\t\t(\n\t\t\t\t\t\ttype = cancel\n\t\t\t\t\t\tdisplayname = "キャンセル"\n\t\t\t\t\t)\n')
    W('\t\t\t\t}\n')
    W('\t\t\t}\n')
    W('\t\t}\n')
W('\t}\n\n')

# ---- reports ----
W('\treports\n\t{\n')
for fname, fdisp, fields in FORMS:
    W('\t\tlist %s\n\t\t{\n' % rep(fname))
    W('\t\t\tdisplayName = "%s"\n' % REPORT_LABEL[fname])
    W('\t\t\tshow all rows from %s\n\t\t\t(\n' % fname)
    for key, label, ftype in fields:
        W('\t\t\t\t%s as "%s"\n' % (key, label))
    W('\t\t\t)\n\t\t}\n')
W('\t}\n\n')

# ---- pages ----
W('\tpages\n\t{\n\t\tpage Wf_Console\n\t\t{\n\t\t\tdisplayname="社内申請コンソール"\n\t\t\tContent=""\n\t\t}\n\t}\n\n')

# ---- share settings ----
W('''\tshare_settings
\t{
\t\t"Developer"
\t\t{
\t\t\tname = "Developer"
\t\t\ttype = Developer
\t\t\tpermissions = {Chat:false, Predefined:true, ApiAccess:true, PIIAccess:true, ePHIAccess:true}
\t\t\tdescription = "Developer Profile\\n"
\t\t}
\t\t"Administrator"
\t\t{
\t\t\tname = "Administrator"
\t\t\ttype = Users_Permissions
\t\t\tpermissions = {Chat:true, Predefined:true, ApiAccess:true, PIIAccess:true, ePHIAccess:true}
\t\t\tdescription = "Full access profile\\n"
\t\t}
\t\t"Customer"
\t\t{
\t\t\tname = "Customer"
\t\t\ttype = Customer_Portal
\t\t\tpermissions = {Chat:false, Predefined:true, ApiAccess:true, PIIAccess:true, ePHIAccess:true}
\t\t\tdescription = "Default portal profile\\n"
\t\t}
\t\troles
\t\t{
\t\t\t"CEO"
\t\t\t{
\t\t\t\tdescription = "All access"
\t\t\t}
\t\t}
\t}

''')

# ---- web ----
W('\tweb\n\t{\n')
W('\t\tforms\n\t\t{\n')
for fname, _, _ in FORMS:
    W('\t\t\tform %s\n\t\t\t{\n\t\t\t\tlabel placement = left\n\t\t\t}\n' % fname)
W('\t\t}\n')
W('\t\treports\n\t\t{\n')
for fname, _, fields in FORMS:
    flds = ''.join('\t\t\t\t\t\t\t\t\t%s as "%s"\n' % (k, l) for k, l, _t in fields)
    W('\t\t\treport %s\n\t\t\t{\n' % rep(fname))
    W('\t\t\t\tquickview\n\t\t\t\t(\n\t\t\t\t\tlayout\n\t\t\t\t\t(\n\t\t\t\t\t\ttype = -1\n')
    W('\t\t\t\t\t\tdatablock1\n\t\t\t\t\t\t(\n\t\t\t\t\t\t\tlayout type = -1\n\t\t\t\t\t\t\tfields\n\t\t\t\t\t\t\t(\n')
    W(flds)
    W('\t\t\t\t\t\t\t)\n\t\t\t\t\t\t)\n\t\t\t\t\t)\n')
    W('\t\t\t\t\tmenu\n\t\t\t\t\t(\n\t\t\t\t\t\theader\n\t\t\t\t\t\t(\n')
    W('\t\t\t\t\t\t\tEdit as "編集"\n\t\t\t\t\t\t\tDelete as "削除"\n\t\t\t\t\t\t\tPrint as "印刷"\n\t\t\t\t\t\t\tAdd\n\t\t\t\t\t\t\tImport\n\t\t\t\t\t\t\tExport\n')
    W('\t\t\t\t\t\t)\n\t\t\t\t\t\trecord\n\t\t\t\t\t\t(\n\t\t\t\t\t\t\tEdit as "編集"\n\t\t\t\t\t\t\tDelete as "削除"\n\t\t\t\t\t\t\tPrint as "印刷"\n\t\t\t\t\t\t)\n\t\t\t\t\t)\n')
    W('\t\t\t\t\taction\n\t\t\t\t\t(\n\t\t\t\t\t\ton click\n\t\t\t\t\t\t(\n\t\t\t\t\t\t\tView Record as "レコード表示"\n\t\t\t\t\t\t)\n\t\t\t\t\t)\n')
    W('\t\t\t\t)\n')
    W('\t\t\t\tdetailview\n\t\t\t\t(\n\t\t\t\t\tlayout\n\t\t\t\t\t(\n\t\t\t\t\t\ttype = 1\n')
    W('\t\t\t\t\t\tdatablock1\n\t\t\t\t\t\t(\n\t\t\t\t\t\t\tlayout type = -2\n\t\t\t\t\t\t\ttitle = "概要"\n\t\t\t\t\t\t\tfields\n\t\t\t\t\t\t\t(\n')
    W(flds)
    W('\t\t\t\t\t\t\t)\n\t\t\t\t\t\t)\n\t\t\t\t\t)\n')
    W('\t\t\t\t\tmenu\n\t\t\t\t\t(\n\t\t\t\t\t\theader\n\t\t\t\t\t\t(\n\t\t\t\t\t\t\tEdit as "編集"\n\t\t\t\t\t\t\tDelete as "削除"\n\t\t\t\t\t\t\tPrint as "印刷"\n\t\t\t\t\t\t)\n\t\t\t\t\t)\n')
    W('\t\t\t\t)\n\t\t\t}\n')
W('\t\t}\n')

# menu
W('\t\tmenu\n\t\t{\n\t\t\tspace Space\n\t\t\t{\n\t\t\t\tdisplayname = "Space"\n\t\t\t\ticon = "objects-spaceship"\n')
W('\t\t\t\tsection Section_Wf\n\t\t\t\t{\n\t\t\t\t\tdisplayname = "社内申請システム"\n\t\t\t\t\ticon = "files-paper"\n')
W('\t\t\t\t\tpage Wf_Console\n\t\t\t\t\t{\n\t\t\t\t\t\ticon = "tech-desktop"\n\t\t\t\t\t}\n')
for fname, _, _ in FORMS:
    W('\t\t\t\t\treport %s\n\t\t\t\t\t{\n\t\t\t\t\t\ticon = "%s"\n\t\t\t\t\t}\n' % (rep(fname), ICON[fname]))
for fname, _, _ in FORMS:
    W('\t\t\t\t\tform %s\n\t\t\t\t\t{\n\t\t\t\t\t\ticon = "ui-2-settings-90"\n\t\t\t\t\t}\n' % fname)
W('\t\t\t\t}\n')
W('\t\t\t\tsection ZC_App_Preferences\n\t\t\t\t{\n\t\t\t\t\tdisplayname = "App Preferences"\n\t\t\t\t\ticon = "design-app"\n')
W('\t\t\t\t\tsystemcomponent\n\t\t\t\t\t{\n\t\t\t\t\t\ttype = localization\n\t\t\t\t\t\tdisplayname = "Language Selection"\n\t\t\t\t\t\ticon = "education-language"\n\t\t\t\t\t}\n')
W('\t\t\t\t}\n\t\t\t}\n')
W('\t\t\tpreference\n\t\t\t{\n\t\t\t\ticon\n\t\t\t\t{\n\t\t\t\t\tstyle = solid\n\t\t\t\t\tshow = {space,section,component}\n\t\t\t\t}\n\t\t\t}\n')
W('\t\t}\n')
W('\t\tcustomize\n\t\t{\n\t\t\tnew theme = 4\n\t\t\tfont = "lato"\n\t\t\tcolor options\n\t\t\t{\n\t\t\t\tcolor = "2"\n\t\t\t}\n')
W('\t\t\tlogo\n\t\t\t{\n\t\t\t\tpreference = "none"\n\t\t\t\tplacement = "left"\n\t\t\t}\n\t\t}\n')
W('\t}\n')

# phone / tablet
for dev in ('phone', 'tablet'):
    W('\t%s\n\t{\n\t\tforms\n\t\t{\n' % dev)
    for fname, _, _ in FORMS:
        W('\t\t\tform %s\n\t\t\t{\n\t\t\t\tlabel placement = auto\n\t\t\t}\n' % fname)
    W('\t\t}\n\t\tcustomize\n\t\t{\n\t\t\tlayout = slidingpane\n\t\t\tfont = "default"\n\t\t\tstyle = "3"\n')
    W('\t\t\tcolor options\n\t\t\t{\n\t\t\t\tcolor = blue\n\t\t\t}\n\t\t\tlogo\n\t\t\t{\n\t\t\t\tpreference = "company_logo"\n\t\t\t}\n\t\t}\n\t}\n')

W('\ttranslation\n\t{\n\t\t{"Language_Settings":{"LANGAGUE_WITH_LOGIN":"browser"}}\n\t}\n')
W('}\n')

open('zoho/ds/ShanaiShinsei.ds', 'w', encoding='utf-8').write(o.getvalue())
print('forms: %d / fields: %d' % (len(FORMS), sum(len(f[2]) for f in FORMS)))
