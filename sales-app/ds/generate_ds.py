# -*- coding: utf-8 -*-
"""
営業管理テスト の .ds ファイルを生成する。

使い方：
  python3 generate_ds.py        → このスクリプトと同じフォルダに SalesApp.ds を出力

なぜスクリプトで生成するか：
  .ds は web / phone / tablet のレイアウト定義がフォーム数に比例して長くなる。
  手で書くと必ずどこかで食い違う。

フィールド型は text / textarea / number の3種類だけを使う（スキルの方針）。
関係（顧客・担当者など）は Creator のレコード ID を文字列で持ち、
名前の列も併せて持つ（CSV 取り込み直後でも名前で関係を解決できるようにするため）。
案件・活動・目標には担当者のメールも持たせる。Creator 側で「本人のレコードだけ」を
見せる権限設定（zoho.loginuser との突き合わせ）に使うため。

項目名を変えたら、ウィジェットの js/config.js の FIELD_MAP も合わせて直し、
verify/schema-check.js で突き合わせること。
"""
import io
import os
import re

T, TA, N = 'text', 'textarea', 'number'

# ============================================================================
# スキーマ定義
# ============================================================================
APP_NAME = "営業管理テスト"          # 日本語可。引用符で囲まれて出力される
OUT_FILE = "SalesApp.ds"
MENU_LABEL = "営業管理"              # 左メニューのセクション名
PAGE_NAME = "Sales_Console"          # ウィジェットを載せるページ
PAGE_LABEL = "営業コンソール"

# (フォームのリンク名, 表示名, [(フィールド名, 表示名, 型), ...])
FORMS = [
    ('Sales_Staff_Form', '【システム用】担当者マスタ', [
        ('staff_name',     '氏名',                         T),
        ('staff_email',    'メールアドレス（ログインID）', T),
        ('staff_team',     'チーム',                       T),
        ('staff_role',     '権限（manager / member）',     T),
        ('is_active',      '在籍（true/false）',           T),
        ('updated_at',     '更新日時',                     T),
    ]),
    ('Sales_Customer_Form', '【システム用】顧客', [
        ('cust_name',      '会社名',                       T),
        ('industry',       '業種',                         T),
        ('cust_rank',      'ランク（A/B/C）',              T),
        ('contact_person', '先方担当者',                   T),
        ('cust_phone',     '電話番号',                     T),
        ('cust_address',   '所在地',                       T),
        ('owner_id',       '主担当ID',                     T),
        ('owner_name',     '主担当',                       T),
        ('cust_note',      '備考',                         TA),
        ('is_active',      '取引中（true/false）',         T),
        ('updated_at',     '更新日時',                     T),
    ]),
    ('Sales_Deal_Form', '【システム用】案件', [
        ('deal_name',      '案件名',                       T),
        ('customer_id',    '顧客ID',                       T),
        ('customer_name',  '顧客名',                       T),
        ('owner_id',       '担当者ID',                     T),
        ('owner_name',     '担当者名',                     T),
        ('owner_email',    '担当者メール（権限設定用）',   T),
        ('deal_stage',     'ステージ',                     T),
        ('deal_amount',    '金額（円）',                   N),
        ('win_prob',       '確度（%）',                    N),
        ('close_plan',     '受注予定日（yyyy-MM-dd）',     T),
        ('closed_on',      '確定日（受注・失注）',         T),
        ('next_action',    '次回アクション',               T),
        ('next_action_on', '次回アクション日',             T),
        ('deal_note',      '備考',                         TA),
        ('updated_at',     '更新日時',                     T),
    ]),
    ('Sales_Activity_Form', '【システム用】活動履歴', [
        ('act_date',       '活動日（yyyy-MM-dd）',         T),
        ('act_type',       '種別',                         T),
        ('customer_id',    '顧客ID',                       T),
        ('customer_name',  '顧客名',                       T),
        ('deal_id',        '案件ID',                       T),
        ('deal_name',      '案件名',                       T),
        ('staff_id',       '担当者ID',                     T),
        ('staff_name',     '担当者名',                     T),
        ('staff_email',    '担当者メール（権限設定用）',   T),
        ('act_summary',    '内容',                         TA),
        ('updated_at',     '更新日時',                     T),
    ]),
    ('Sales_Target_Form', '【システム用】月次目標', [
        ('target_month',   '対象月（yyyy-MM）',            T),
        ('staff_id',       '担当者ID',                     T),
        ('staff_name',     '担当者名',                     T),
        ('staff_email',    '担当者メール（権限設定用）',   T),
        ('target_amount',  '目標金額（円）',               N),
        ('updated_at',     '更新日時',                     T),
    ]),
    # 操作記録は追記のみなので updated_at を持たない。
    # ウィジェットは FIELD_MAP に Updated_At がある項目にだけ更新日時を書く。
    ('Sales_Log_Form', '【システム用】操作記録', [
        ('log_time',       '日時',                         T),
        ('actor_name',     '操作者',                       T),
        ('log_action',     '操作',                         T),
        ('target_id',      '対象ID',                       T),
        ('log_detail',     '内容',                         TA),
    ]),
]

REPORT_LABEL = {
    'Sales_Staff_Form':    '担当者 一覧',
    'Sales_Customer_Form': '顧客 一覧',
    'Sales_Deal_Form':     '案件 一覧',
    'Sales_Activity_Form': '活動履歴 一覧',
    'Sales_Target_Form':   '月次目標 一覧',
    'Sales_Log_Form':      '操作記録 一覧',
}
# アイコン名は、スキルの資料（実際にエクスポートされた .ds）に出てくるものだけを使う。
# 存在しない名前を書くと取り込みで失敗する恐れがあるため、推測で増やさない。
ICON = {
    'Sales_Staff_Form':    'users-multiple-11',
    'Sales_Customer_Form': 'files-paper',
    'Sales_Deal_Form':     'design-todo',
    'Sales_Activity_Form': 'files-paper',
    'Sales_Target_Form':   'design-todo',
    'Sales_Log_Form':      'files-archive',
}
# ============================================================================


def rep(f):
    return f[:-len('_Form')] + '_Report'


LINK = re.compile(r'^[A-Za-z][A-Za-z0-9_]*$')


def validate():
    """生成前に、Creator に弾かれる／静かに壊れる定義を止める。"""
    errors = []
    seen_forms = set()
    for fname, fdisp, fields in FORMS:
        if not LINK.match(fname) or not fname.endswith('_Form'):
            errors.append('フォーム名は英数字とアンダースコアで、_Form で終える: %s' % fname)
        if fname in seen_forms:
            errors.append('フォーム名が重複: %s' % fname)
        seen_forms.add(fname)
        seen = set()
        for key, label, ftype in fields:
            if not LINK.match(key):
                errors.append('%s: フィールド名は英数字とアンダースコア: %s' % (fname, key))
            if key in ('Section', 'actions'):
                errors.append('%s: 予約された要素名は使えない: %s' % (fname, key))
            if key in seen:
                errors.append('%s: フィールド名が重複: %s' % (fname, key))
            seen.add(key)
            if ftype not in (T, TA, N):
                errors.append('%s.%s: 型は text / textarea / number のみ: %s' % (fname, key, ftype))
        for s in [fdisp, REPORT_LABEL.get(fname, '')] + [f[1] for f in fields]:
            if '"' in s:
                errors.append('%s: 表示名に " は使えない: %s' % (fname, s))
    if '"' in APP_NAME + MENU_LABEL + PAGE_LABEL:
        errors.append('アプリ名・メニュー名・ページ名に " は使えない')
    if errors:
        raise SystemExit('スキーマ定義に問題があります:\n  ' + '\n  '.join(errors))


def build():
    o = io.StringIO()
    W = o.write

    W('/*\n * %s\n * このファイルはスクリプトで生成されています。手で編集しないでください。\n */\n' % APP_NAME)
    W('application "%s"\n{\n' % APP_NAME)
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
        W('\t\t\t\t}\n\t\t\t}\n\t\t}\n')
    W('\t}\n\n')

    # ---- reports ----
    W('\treports\n\t{\n')
    for fname, fdisp, fields in FORMS:
        W('\t\tlist %s\n\t\t{\n' % rep(fname))
        W('\t\t\tdisplayName = "%s"\n' % REPORT_LABEL.get(fname, fdisp))
        W('\t\t\tshow all rows from %s\n\t\t\t(\n' % fname)
        for key, label, _t in fields:
            W('\t\t\t\t%s as "%s"\n' % (key, label))
        W('\t\t\t)\n\t\t}\n')
    W('\t}\n\n')

    # ---- pages ----
    W('\tpages\n\t{\n\t\tpage %s\n\t\t{\n\t\t\tdisplayname="%s"\n\t\t\tContent=""\n\t\t}\n\t}\n\n'
      % (PAGE_NAME, PAGE_LABEL))

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
    W('\tweb\n\t{\n\t\tforms\n\t\t{\n')
    for fname, _, _ in FORMS:
        W('\t\t\tform %s\n\t\t\t{\n\t\t\t\tlabel placement = left\n\t\t\t}\n' % fname)
    W('\t\t}\n\t\treports\n\t\t{\n')
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

    W('\t\tmenu\n\t\t{\n\t\t\tspace Space\n\t\t\t{\n\t\t\t\tdisplayname = "Space"\n\t\t\t\ticon = "objects-spaceship"\n')
    W('\t\t\t\tsection Section_App\n\t\t\t\t{\n\t\t\t\t\tdisplayname = "%s"\n\t\t\t\t\ticon = "files-paper"\n' % MENU_LABEL)
    W('\t\t\t\t\tpage %s\n\t\t\t\t\t{\n\t\t\t\t\t\ticon = "tech-desktop"\n\t\t\t\t\t}\n' % PAGE_NAME)
    for fname, _, _ in FORMS:
        W('\t\t\t\t\treport %s\n\t\t\t\t\t{\n\t\t\t\t\t\ticon = "%s"\n\t\t\t\t\t}\n' % (rep(fname), ICON.get(fname, 'design-todo')))
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

    # ---- phone / tablet ----
    for dev in ('phone', 'tablet'):
        W('\t%s\n\t{\n\t\tforms\n\t\t{\n' % dev)
        for fname, _, _ in FORMS:
            W('\t\t\tform %s\n\t\t\t{\n\t\t\t\tlabel placement = auto\n\t\t\t}\n' % fname)
        W('\t\t}\n\t\tcustomize\n\t\t{\n\t\t\tlayout = slidingpane\n\t\t\tfont = "default"\n\t\t\tstyle = "3"\n')
        W('\t\t\tcolor options\n\t\t\t{\n\t\t\t\tcolor = blue\n\t\t\t}\n\t\t\tlogo\n\t\t\t{\n\t\t\t\tpreference = "company_logo"\n\t\t\t}\n\t\t}\n\t}\n')

    W('\ttranslation\n\t{\n\t\t{"Language_Settings":{"LANGAGUE_WITH_LOGIN":"browser"}}\n\t}\n')
    W('}\n')
    return o.getvalue()


if __name__ == '__main__':
    validate()
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), OUT_FILE)
    # newline='\n' で、Windows で実行しても改行コードが変わらないようにする
    with open(out, 'w', encoding='utf-8', newline='\n') as fp:
        fp.write(build())
    print('%s を生成しました（%d フォーム / %d 項目）'
          % (out, len(FORMS), sum(len(f[2]) for f in FORMS)))
