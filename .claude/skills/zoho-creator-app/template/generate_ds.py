# -*- coding: utf-8 -*-
"""
Zoho Creator の .ds ファイルを生成する。

使い方：
  1. 下の APP_NAME と FORMS を書き換える
  2. python3 generate_ds.py
  3. 出力された .ds を Creator に取り込む

なぜスクリプトで生成するか：
  .ds は web / phone / tablet のレイアウト定義がフォーム数に比例して長くなる。
  12フォームで約3,000行になり、手で書くと必ずどこかで食い違う。

フィールド型は text / textarea / number の3種類だけを使う。
理由は reference/ds-format.md を参照。
"""
import io

T, TA, N = 'text', 'textarea', 'number'

# ============================================================================
# ここを書き換える
# ============================================================================
APP_NAME = "サンプルアプリ"          # 日本語可。引用符で囲まれて出力される
APP_LINK = "Sample_App"              # 使わないが、命名の参考に
OUT_FILE = "SampleApp.ds"
MENU_LABEL = "サンプル"              # 左メニューのセクション名
PAGE_NAME = "Sample_Console"         # ウィジェットを載せるページ
PAGE_LABEL = "コンソール"

# (フォームのリンク名, 表示名, [(フィールド名, 表示名, 型), ...])
FORMS = [
    ('Sample_Item_Form', '【システム用】品目', [
        ('item_id',    '品目ID',          T),
        ('item_name',  '品名',            T),
        ('category',   '区分',            T),
        ('qty',        '数量',            N),
        ('unit_price', '単価',            N),
        ('note',       '備考',            TA),
        ('data_json',  '付帯情報（JSON）', TA),
        ('is_active',  '有効（true/false）', T),
        ('updated_at', '更新日時',        T),
    ]),
    ('Sample_Log_Form', '【システム用】操作記録', [
        ('log_time',   '日時',     T),
        ('actor_name', '操作者',   T),
        ('action',     '操作',     T),
        ('target_id',  '対象ID',   T),
        ('detail',     '内容',     TA),
    ]),
]

REPORT_LABEL = {
    'Sample_Item_Form': '品目 一覧',
    'Sample_Log_Form':  '操作記録 一覧',
}
ICON = {
    'Sample_Item_Form': 'design-todo',
    'Sample_Log_Form':  'files-archive',
}
# ============================================================================


def rep(f):
    return f.replace('_Form', '_Report')


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
    open(OUT_FILE, 'w', encoding='utf-8').write(build())
    print('%s を生成しました（%d フォーム / %d 項目）'
          % (OUT_FILE, len(FORMS), sum(len(f[2]) for f in FORMS)))
