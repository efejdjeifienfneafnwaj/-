#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
3つのアプリ（社内申請・e-ラーニング・コネクト）を1つの Creator アプリにするための .ds を作る。

・社内申請のフォーム（Wf_*）は shinsei/ShanaiShinsei.ds をそのまま使う
・e-ラーニングとコネクトのフォーム（Lms_*）は、ウィジェットが送る項目名から生成する
  （項目名は widget.html の payloadFor / rowsTo* と一対一）
出力: lms-widget/FunaiPortal.ds
"""
import io, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'shinsei', 'ShanaiShinsei.ds')
OUT = os.path.join(ROOT, 'lms-widget', 'FunaiPortal.ds')

T, A = 'text', 'textarea'
N = 'number'
# (リンク名, 表示名, 型)
FORMS = [
  ('Lms_Course_Form', 'Lms_Course_Report', '【システム用】コース定義', 'コース定義', [
    ('course_json', 'コース定義（JSON）', A), ('config_json', '設定（JSON）', A)]),
  ('Lms_Person_Form', 'Lms_Person_Report', '【システム用】名簿', '名簿', [
    ('person_key', '名簿キー', T), ('person_name', '氏名', T), ('email', 'メールアドレス', T),
    ('dept', '職種', T), ('grp', 'グループ', T), ('emp_no', '社員番号', T),
    ('title', '役職', T), ('role', '権限', T), ('scope', '見られる範囲', T),
    ('first_at', '初回', T),
    ('kana', 'フリガナ', T), ('manager_name', '上長', T), ('join_date', '入社日', T),
    ('leave_balance', '有給残日数', N), ('deputy_name', '代理人', T),
    ('deputy_from', '代理開始日', T), ('deputy_to', '代理終了日', T),
    ('is_active', '在籍（true/false）', T),
    ('photo', '顔写真（データURI）', A), ('profile', '自己紹介', A)]),
  ('Lms_Record_Form', 'Lms_Record_Report', '【システム用】受講記録', '受講記録', [
    ('rec_key', '記録キー', T), ('person_name', '氏名', T), ('dept', '職種', T), ('term', '年度', T),
    ('course_id', 'コースID', T), ('course_name', 'コース名', T),
    ('chapter_id', '章ID', T), ('chapter_name', '章名', T),
    ('duration_sec', '動画の長さ（秒）', N), ('watched_sec', '視聴秒数', N),
    ('watched_pct', '視聴率（%）', N), ('ranges_json', '視聴区間（JSON）', A),
    ('last_pos', '最後の位置（秒）', N), ('fast', '早送りあり', T)]),
  ('Lms_Quiz_Form', 'Lms_Quiz_Report', '【システム用】テスト結果', 'テスト結果', [
    ('quiz_key', 'テストキー', T), ('person_name', '氏名', T), ('dept', '職種', T), ('term', '年度', T),
    ('course_id', 'コースID', T), ('course_name', 'コース名', T),
    ('score', '正解数', N), ('q_total', '問題数', N), ('tries', '受験回数', N),
    ('history_json', '受験履歴（JSON）', A), ('passed', '合否', T), ('taken_at', '受験日時', T)]),
  ('Lms_Daily_Form', 'Lms_Daily_Report', '【システム用】日別視聴', '日別視聴', [
    ('day_key', '日別キー', T), ('person_name', '氏名', T), ('dept', '職種', T), ('grp', 'グループ', T),
    ('study_day', '日付', T), ('watched_sec', '視聴秒数', N)]),
  ('Lms_Survey_Form', 'Lms_Survey_Report', '【システム用】アンケート', 'アンケート', [
    ('survey_key', 'アンケートキー', T), ('person_name', '氏名', T), ('dept', '職種', T), ('term', '年度', T),
    ('course_id', 'コースID', T), ('course_name', 'コース名', T),
    ('score', '満足度', N), ('useful', '役立ち度', T), ('free_comment', '自由記述', A),
    ('taken_at', '回答日時', T)]),
  ('Lms_News_Form', 'Lms_News_Report', '【システム用】お知らせ', 'お知らせ', [
    ('news_key', 'お知らせキー', T), ('title', '件名', T), ('body', '本文', A),
    ('target', '宛先', T), ('posted_by', '投稿者', T), ('posted_at', '投稿日時', T), ('deleted', '削除', T)]),
  ('Lms_Post_Form', 'Lms_Post_Report', '【システム用】投稿', '投稿', [
    ('post_key', '投稿キー', T), ('kind', '種別', T), ('author_name', '投稿者', T),
    ('author_email', '投稿者メール', T), ('to_name', '宛先（サンクス）', T), ('title', '件名', T),
    ('body', '本文', A), ('target', '宛先の職種', T), ('posted_at', '投稿日時', T), ('deleted', '削除', T)]),
  ('Lms_React_Form', 'Lms_React_Report', '【システム用】いいね・コメント', 'いいね・コメント', [
    ('react_key', '反応キー', T), ('post_key', '投稿キー', T), ('kind', '種別', T),
    ('person_name', '名前', T), ('body', 'コメント本文', A), ('at', '日時', T), ('deleted', '削除', T)]),
]

def field(name, disp, typ):
    extra = '\n\t\t\t\theight = 300px' if typ == A else ''
    return ('\t\t\t%s\n\t\t\t(\n\t\t\t\ttype = %s\n\t\t\t\tdisplayname = "%s"%s\n'
            '\t\t\t\trow = 1\n\t\t\t\tcolumn = 1\n\t\t\t\twidth = medium\n\t\t\t)\n') % (name, typ, disp, extra)

ACTIONS = ('\t\t\tactions\n\t\t\t{\n\t\t\t\ton add\n\t\t\t\t{\n\t\t\t\t\tsubmit\n\t\t\t\t\t(\n\t\t\t\t\t\ttype = submit\n'
           '\t\t\t\t\t\tdisplayname = "送信"\n\t\t\t\t\t)\n\t\t\t\t\treset\n\t\t\t\t\t(\n\t\t\t\t\t\ttype = reset\n'
           '\t\t\t\t\t\tdisplayname = "リセット"\n\t\t\t\t\t)\n\t\t\t\t}\n\t\t\t\ton edit\n\t\t\t\t{\n\t\t\t\t\tupdate\n'
           '\t\t\t\t\t(\n\t\t\t\t\t\ttype = submit\n\t\t\t\t\t\tdisplayname = "更新"\n\t\t\t\t\t)\n\t\t\t\t\tcancel\n'
           '\t\t\t\t\t(\n\t\t\t\t\t\ttype = cancel\n\t\t\t\t\t\tdisplayname = "キャンセル"\n\t\t\t\t\t)\n\t\t\t\t}\n\t\t\t}\n')

def form_block(f):
    name, rep, disp, rdisp, fields = f
    s = '\t\tform %s\n\t\t{\n\t\t\tdisplayname = "%s"\n\t\t\tsuccess message = "保存しました。"\n' % (name, disp)
    s += '\t\t\tSection\n\t\t\t(\n\t\t\t\ttype = section\n\t\t\t\trow = 1\n\t\t\t\tcolumn = 0\n\t\t\t\twidth = medium\n\t\t\t)\n'
    for fn, fd, ft in fields: s += field(fn, fd, ft)
    s += ACTIONS + '\t\t}\n'
    return s

def list_block(f):
    name, rep, disp, rdisp, fields = f
    s = '\t\tlist %s\n\t\t{\n\t\t\tdisplayName = "%s"\n\t\t\tshow all rows from %s\n\t\t\t(\n' % (rep, rdisp, name)
    for fn, fd, ft in fields: s += '\t\t\t\t%s as "%s"\n' % (fn, fd)
    s += '\t\t\t)\n\t\t}\n'
    return s

def web_report_block(f):
    name, rep, disp, rdisp, fields = f
    fl = ''.join('\t\t\t\t\t\t\t\t\t\t%s as "%s"\n' % (fn, fd) for fn, fd, ft in fields)
    return ('\t\t\treport %s\n\t\t\t{\n\t\t\t\tquickview\n\t\t\t\t(\n\t\t\t\t\tlayout\n\t\t\t\t\t(\n\t\t\t\t\t\ttype = -1\n'
            '\t\t\t\t\t\tdatablock1\n\t\t\t\t\t\t(\n\t\t\t\t\t\t\tlayout type = -1\n\t\t\t\t\t\t\tfields\n\t\t\t\t\t\t\t(\n%s'
            '\t\t\t\t\t\t\t)\n\t\t\t\t\t\t)\n\t\t\t\t\t)\n\t\t\t\t\tmenu\n\t\t\t\t\t(\n\t\t\t\t\t\theader\n\t\t\t\t\t\t(\n'
            '\t\t\t\t\t\t\tEdit as "編集"\n\t\t\t\t\t\t\tDelete as "削除"\n\t\t\t\t\t\t\tPrint as "印刷"\n\t\t\t\t\t\t\tAdd\n'
            '\t\t\t\t\t\t\tImport\n\t\t\t\t\t\t\tExport\n\t\t\t\t\t\t)\n\t\t\t\t\t\trecord\n\t\t\t\t\t\t(\n'
            '\t\t\t\t\t\t\tEdit as "編集"\n\t\t\t\t\t\t\tDelete as "削除"\n\t\t\t\t\t\t\tPrint as "印刷"\n\t\t\t\t\t\t)\n'
            '\t\t\t\t\t)\n\t\t\t\t\taction\n\t\t\t\t\t(\n\t\t\t\t\t\ton click\n\t\t\t\t\t\t(\n'
            '\t\t\t\t\t\t\tView Record as "レコード表示"\n\t\t\t\t\t\t)\n\t\t\t\t\t)\n\t\t\t\t)\n'
            '\t\t\t\tdetailview\n\t\t\t\t(\n\t\t\t\t\tlayout\n\t\t\t\t\t(\n\t\t\t\t\t\ttype = 1\n\t\t\t\t\t\tdatablock1\n'
            '\t\t\t\t\t\t(\n\t\t\t\t\t\t\tlayout type = -2\n\t\t\t\t\t\t\ttitle = "概要"\n\t\t\t\t\t\t\tfields\n\t\t\t\t\t\t\t(\n%s'
            '\t\t\t\t\t\t\t)\n\t\t\t\t\t\t)\n\t\t\t\t\t)\n\t\t\t\t\tmenu\n\t\t\t\t\t(\n\t\t\t\t\t\theader\n\t\t\t\t\t\t(\n'
            '\t\t\t\t\t\t\tEdit as "編集"\n\t\t\t\t\t\t\tDelete as "削除"\n\t\t\t\t\t\t\tPrint as "印刷"\n\t\t\t\t\t\t)\n'
            '\t\t\t\t\t)\n\t\t\t\t)\n\t\t\t}\n') % (rep, fl, fl)

def insert_before(s, anchor, block, nth=1, where=''):
    idx = -1; start = 0
    for _ in range(nth):
        idx = s.find(anchor, start)
        if idx < 0: raise SystemExit('目印が見つかりません: ' + where + ' / ' + repr(anchor[:40]))
        start = idx + 1
    return s[:idx] + block + s[idx:]

def main():
    s = io.open(SRC, encoding='utf-8').read()
    # 重複チェック（同じ項目名が2回あると Creator が取り込みで止まる）
    for f in FORMS:
        names = [x[0] for x in f[4]]
        dup = set(n for n in names if names.count(n) > 1)
        if dup: raise SystemExit('項目名が重複: %s %s' % (f[0], dup))
    s = s.replace('application "社内申請システム"', 'application "船井ポータル"', 1)
    s = s.replace(' * Purpose : 社内申請・承認ワークフロー（閲覧証跡つき）用データ保存アプリ',
                  ' * Purpose : 船井ポータル（社内申請・e-ラーニング・コネクト）用データ保存アプリ\n'
                  ' *           Wf_* … 社内申請 / Lms_* … e-ラーニングとコネクト', 1)
    s = s.replace('displayname="社内申請コンソール"', 'displayname="船井ポータル"', 1)
    s = s.replace('displayname = "社内申請システム"', 'displayname = "船井ポータル"', 1)

    forms = ''.join(form_block(f) for f in FORMS)
    lists = ''.join(list_block(f) for f in FORMS)
    webrep = ''.join(web_report_block(f) for f in FORMS)
    webform = ''.join('\t\t\tform %s\n\t\t\t{\n\t\t\t\tlabel placement = left\n\t\t\t}\n' % f[0] for f in FORMS)
    phform = ''.join('\t\t\tform %s\n\t\t\t{\n\t\t\t\tlabel placement = auto\n\t\t\t}\n' % f[0] for f in FORMS)
    menu = ''.join('\t\t\t\t\treport %s\n\t\t\t\t\t{\n\t\t\t\t\t\ticon = "files-paper"\n\t\t\t\t\t}\n' % f[1] for f in FORMS)
    # フォームもメニューの section に載せる。載っていないと Creator が
    # 「does not have section mapping for Web version」で取り込みを止める
    menuf = ''.join('\t\t\t\t\tform %s\n\t\t\t\t\t{\n\t\t\t\t\t\ticon = "ui-2-settings-90"\n\t\t\t\t\t}\n' % f[0] for f in FORMS)

    s = insert_before(s, '\t}\n\n\treports\n', forms, where='forms')
    s = insert_before(s, '\t}\n\n\tpages\n', lists, where='reports')
    s = insert_before(s, '\t\t}\n\t\treports\n\t\t{\n\t\t\treport Wf_Dept_Report', webform, where='web forms')
    s = insert_before(s, '\t\t}\n\t\tmenu\n', webrep, where='web reports')
    s = insert_before(s, '\t\t}\n\t\tcustomize\n\t\t{\n\t\t\tlayout = slidingpane', phform, nth=1, where='phone forms')
    s = insert_before(s, '\t\t}\n\t\tcustomize\n\t\t{\n\t\t\tlayout = slidingpane', phform, nth=2, where='tablet forms')
    s = insert_before(s, '\t\t\t\t\tform Wf_Dept_Form\n\t\t\t\t\t{\n\t\t\t\t\t\ticon = "ui-2-settings-90"', menu, where='menu reports')
    s = insert_before(s, '\t\t\t\t}\n\t\t\t\tsection ZC_App_Preferences', menuf, where='menu forms')

    # 自己点検：すべてのフォームが web/phone/tablet の forms と menu に載っているか
    import re as _re
    all_forms = _re.findall(r'^\t\tform (\w+)\n', s, _re.M)
    for fn in all_forms:
        for label, pat in [('web/phone/tablet', r'^\t\t\tform %s\n' % fn), ('menu', r'^\t\t\t\t\tform %s\n' % fn)]:
            n = len(_re.findall(pat, s, _re.M))
            need = 3 if label != 'menu' else 1
            if n < need: raise SystemExit('%s が %s に載っていません（%d/%d）' % (fn, label, n, need))
    all_lists = _re.findall(r'^\t\tlist (\w+)\n', s, _re.M)
    for ln in all_lists:
        if not _re.search(r'^\t\t\treport %s\n' % ln, s, _re.M): raise SystemExit(ln + ' が web.reports に無い')
        if not _re.search(r'^\t\t\t\t\treport %s\n' % ln, s, _re.M): raise SystemExit(ln + ' が menu に無い')

    # 括弧の対応を確かめる
    if s.count('{') != s.count('}'): raise SystemExit('波括弧の数が合いません')
    if s.count('(') != s.count(')'): raise SystemExit('丸括弧の数が合いません')
    io.open(OUT, 'w', encoding='utf-8').write(s)
    print('ok:', OUT, len(s), 'chars,', len(FORMS), 'forms added')

if __name__ == '__main__':
    main()
