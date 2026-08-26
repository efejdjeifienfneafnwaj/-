#!/usr/bin/env python3
"""
dist/individual-support-plan-app.html を生成する。

index.html が読み込む css/*.css・js/*.js をすべて1枚のHTMLに埋め込んだ、
単一ファイル版を作る。理由:

  ・file:// で複数ファイルを直接開くと、ブラウザによっては相対パスの
    スクリプト読み込みが制限され、白画面になることがある(Safari など)。
  ・Zohoウィジェットのように、1ファイルとして扱いたい配布先がある。

使い方:
    python3 tools/build-bundle.py
"""
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
OUT_DIR = os.path.join(ROOT, 'dist')
OUT = os.path.join(OUT_DIR, 'individual-support-plan-app.html')

# index.html に書かれている順のまま
JS_FILES = [
    'js/data.js', 'js/store.js', 'js/ui.js', 'js/assess.js', 'js/print.js',
    'js/xlsx-template.js', 'js/xlsx.js',
    'js/view-children.js', 'js/view-assess.js', 'js/view-plan.js',
    'js/view-splan.js', 'js/view-records.js', 'js/app.js',
]
CSS_SCREEN = 'css/style.css'
CSS_PRINT = 'css/print.css'


def read(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def build():
    html = read('index.html')

    style_tag = (
        '<style>\n' + read(CSS_SCREEN) + '\n</style>\n'
        '<style media="print">\n' + read(CSS_PRINT) + '\n</style>'
    )
    html = re.sub(r'<link rel="stylesheet" href="css/style\.css">', '', html)
    html = re.sub(r'<link rel="stylesheet" href="css/print\.css"[^>]*>', '', html)
    html = html.replace('</head>', style_tag + '\n</head>')

    scripts = []
    for rel in JS_FILES:
        js = read(rel)
        scripts.append('<script>\n/* ---- ' + rel + ' ---- */\n' + js + '\n</script>')
        html = re.sub(r'\s*<script src="%s"></script>' % re.escape(rel), '', html)

    html = html.replace('</body>', '\n'.join(scripts) + '\n</body>')

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(html)

    size_kb = os.path.getsize(OUT) / 1024
    print('書き出し: %s (%.0f KB)' % (os.path.relpath(OUT, ROOT), size_kb))


if __name__ == '__main__':
    build()
