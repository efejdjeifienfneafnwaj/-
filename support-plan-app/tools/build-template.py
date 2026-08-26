#!/usr/bin/env python3
"""
support-plan-app/js/xlsx-template.js を生成する。

厚生労働省が公表している「個別支援計画参考様式」(別紙1-1／1-2)の xlsx を
部品(XML)に分解し、base64 にしてJSファイルに埋め込む。アプリはこの部品の
うちシートと図形の XML だけを差し替えて zip に詰め直すため、罫線・列幅・
印刷設定は原本のまま保たれる。

あわせて、値を差し込むセル用に「文字を折り返す」書式を styles.xml に追加し、
元の書式番号から追加した書式番号への対応表を JS に書き出す。原本の書式には
折り返し指定がなく、そのままでは長い支援内容が1行に潰れて読めないため。

使い方:
    python3 tools/build-template.py <参考様式.xlsx>
"""
import base64
import json
import os
import re
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'js', 'xlsx-template.js')

# 値を差し込むセルと、そこに使う配置。
#   top    … 長い文章。上ぞろえ＋折り返し
#   center … 短い語句。中央ぞろえ＋折り返し
FILL_CELLS = {
    'xl/worksheets/sheet1.xml': {
        'top':    ['D5', 'D7', 'D9', 'D10', 'H10',
                   'C15', 'D15', 'H15', 'C18', 'D18', 'H18'],
        'center': ['B15', 'F15', 'G15', 'I15', 'E15',
                   'B18', 'F18', 'G18', 'I18', 'E18'],
    },
    'xl/worksheets/sheet2.xml': {
        'top':    ['B16'],
        'center': ['B4', 'R4', 'N18', 'S18'],
    },
}

ALIGN = {
    'top':    '<alignment horizontal="left" vertical="top" wrapText="1"/>',
    'center': '<alignment horizontal="center" vertical="center" wrapText="1"/>',
}


def cell_style(sheet_xml, ref):
    """シートXMLから、そのセルの書式番号(s=)を取り出す"""
    m = re.search(r'<c r="%s"([^>]*?)(?:/>|>)' % ref, sheet_xml)
    if not m:
        return None
    s = re.search(r'\bs="(\d+)"', m.group(1))
    return int(s.group(1)) if s else 0


def build(src):
    z = zipfile.ZipFile(src)
    parts = {name: z.read(name) for name in z.namelist()}

    styles = parts['xl/styles.xml'].decode('utf-8')
    cx = re.search(r'(<cellXfs count=")(\d+)(">)(.*?)(</cellXfs>)', styles, re.S)
    if not cx:
        sys.exit('styles.xml の cellXfs が見つかりません')
    xfs = re.findall(r'<xf [^>]*/>|<xf [^>]*>.*?</xf>', cx.group(4), re.S)

    # 差し込むセルが使っている書式を集め、折り返し版を追加する
    wrap_map = {'top': {}, 'center': {}}
    added = []
    for sheet_name, modes in FILL_CELLS.items():
        sheet_xml = parts[sheet_name].decode('utf-8')
        for mode, refs in modes.items():
            for ref in refs:
                s = cell_style(sheet_xml, ref)
                if s is None or str(s) in wrap_map[mode]:
                    continue
                base = xfs[s]
                # 既存の alignment を折り返し付きに差し替える
                body = re.sub(r'<alignment[^>]*/>', '', base)
                body = body.replace('/>', '>').replace('</xf>', '')
                if not body.endswith('>'):
                    body += '>'
                if 'applyAlignment' not in body:
                    body = body.replace('<xf ', '<xf ', 1)
                    body = re.sub(r'(<xf [^>]*?)>', r'\1 applyAlignment="1">', body, count=1)
                new_xf = body + ALIGN[mode] + '</xf>'
                wrap_map[mode][str(s)] = len(xfs) + len(added)
                added.append(new_xf)

    xfs_all = xfs + added
    styles = (styles[:cx.start()] + cx.group(1) + str(len(xfs_all)) + cx.group(3)
              + ''.join(xfs_all) + cx.group(5) + styles[cx.end():])
    parts['xl/styles.xml'] = styles.encode('utf-8')

    # [Content_Types].xml は zip の先頭に置く決まり
    order = sorted(parts, key=lambda p: (p != '[Content_Types].xml', p))

    lines = [
        '/* ' + '=' * 71,
        ' * xlsx-template.js — 厚生労働省「個別支援計画参考様式」(別紙1-1／1-2)',
        ' *',
        ' * 参考様式の xlsx を部品(XML)に分解して base64 で埋め込んだもの。',
        ' * wrapStyles は、値を差し込むセルの書式番号を「文字を折り返す書式」に',
        ' * 読み替えるための対応表。',
        ' *',
        ' * ※ tools/build-template.py が生成する。手で書き換えないこと。',
        ' * ' + '=' * 71 + ' */',
        'window.XLSX_TEMPLATE = {',
        '  order: ' + json.dumps(order, ensure_ascii=False) + ',',
        '  wrapStyles: ' + json.dumps(wrap_map, ensure_ascii=False) + ',',
        '  parts: {',
    ]
    for name in order:
        b64 = base64.b64encode(parts[name]).decode()
        chunks = [b64[i:i + 100] for i in range(0, len(b64), 100)]
        joined = "'\n      + '".join(chunks)
        lines.append('    %s:\n        %s%s%s,' % (json.dumps(name, ensure_ascii=False), "'", joined, "'"))
    lines += ['  }', '};', '']

    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))

    print('部品 %d 個、追加した書式 %d 個 → %s (%.0f KB)'
          % (len(order), len(added), os.path.relpath(OUT), os.path.getsize(OUT) / 1024))
    print('wrapStyles:', json.dumps(wrap_map, ensure_ascii=False))


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    build(sys.argv[1])
