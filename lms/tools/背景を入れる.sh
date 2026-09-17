#!/bin/sh
# ログイン画面の背景写真を zip に入れる。
#   使い方: tools/背景を入れる.sh 写真.jpg
# 入れた写真は app/bg.jpg として配られ、設定画面で登録した画像が無いときに使われる。
# 設定画面からの登録は Creator の保存できる大きさに限りがある（小さく縮めて保存する）ので、
# 写真はこちらの方法が確実。
set -e
cd "$(dirname "$0")/.."
[ -f "$1" ] || { echo "使い方: $0 写真.jpg"; exit 1; }
cp "$1" lms-widget/app/bg.jpg
ls -la lms-widget/app/bg.jpg
echo "OK: lms-widget/app/bg.jpg に入れました。tools/zipを作る.sh で zip を作り直してください。"
