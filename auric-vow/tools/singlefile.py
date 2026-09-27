#!/usr/bin/env python3
"""Bundle dist/ into ONE self-contained HTML file (JS, CSS and fonts inlined).

The result opens by double-click from disk (file://) with no server:
    python3 tools/singlefile.py [dist_dir] [out.html]
"""
import base64
import os
import re
import sys

dist = sys.argv[1] if len(sys.argv) > 1 else 'dist'
out = sys.argv[2] if len(sys.argv) > 2 else 'AURIC_VOW.html'

html = open(os.path.join(dist, 'index.html'), encoding='utf-8').read()
js_rel = re.search(r'<script type="module" crossorigin src="\./([^"]+\.js)"></script>', html).group(1)
css_rel = re.search(r'<link rel="stylesheet" crossorigin href="\./([^"]+\.css)">', html).group(1)
css_dir = os.path.dirname(os.path.join(dist, css_rel))
css = open(os.path.join(dist, css_rel), encoding='utf-8').read()

MIME = {'.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.png': 'image/png', '.jpg': 'image/jpeg'}


def inline_url(m):
    url = m.group(1).strip('\'"')
    ext = os.path.splitext(url)[1].lower()
    if url.startswith('data:') or ext not in MIME:
        return m.group(0)
    data = open(os.path.normpath(os.path.join(css_dir, url)), 'rb').read()
    return 'url(data:%s;base64,%s)' % (MIME[ext], base64.b64encode(data).decode())


css = re.sub(r'url\(([^)]+)\)', inline_url, css)
js = open(os.path.join(dist, js_rel), encoding='utf-8').read().replace('</script', '<\\/script')

html = re.sub(r'\s*<script type="module" crossorigin src="[^"]+"></script>', '', html)
html = re.sub(r'\s*<link rel="stylesheet" crossorigin href="[^"]+">', lambda _: '\n    <style>' + css + '</style>', html)
html = html.replace('</body>', '  <script type="module">' + js + '</script>\n  </body>')
open(out, 'w', encoding='utf-8').write(html)
print('%s  %.1f MB' % (out, os.path.getsize(out) / 1e6))
