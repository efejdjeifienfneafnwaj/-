# 確認用のツール

## スモークテスト.js
Chromium で実際にウィジェットを開いて、入口から管理画面までを通しで操作し、
「受講者に管理画面への道が出ていないか」を毎回確かめます。

```
npm install playwright-core            # 初回だけ
NODE_PATH=./node_modules node tools/スモークテスト.js
```

Chromium の場所が違うときは `CHROME=/path/to/chrome` を付けてください。
