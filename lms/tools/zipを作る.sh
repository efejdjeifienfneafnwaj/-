#!/bin/sh
# Creator のウィジェット zip を作る。
# 中身は app/ と plugin-manifest.json が「一番上」に並んでいないと、
# Creator が「マニフェストファイルが含まれていません」と言って受け付けない。
set -e
cd "$(dirname "$0")/.."
OUT="${1:-lms-widget.zip}"
rm -f "$OUT"
cd lms-widget
zip -qr "../$OUT" app plugin-manifest.json -x '*.DS_Store'
cd ..
# 作ったものを点検する
unzip -l "$OUT" | grep -q '^ *[0-9]* .* plugin-manifest.json$' \
  || { echo "NG: plugin-manifest.json が一番上にありません"; exit 1; }
unzip -l "$OUT" | grep -q 'app/widget.html' \
  || { echo "NG: app/widget.html がありません"; exit 1; }
echo "OK: $OUT"
unzip -l "$OUT"
