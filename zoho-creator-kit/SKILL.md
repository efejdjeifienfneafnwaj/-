---
name: zoho-creator-app
description: Zoho Creator のアプリ（.ds ファイル）とウィジェット（zip）を作る。「Zoho Creator でアプリにして」「Creator のウィジェットを作って」「.ds ファイルを作って」「Creator に載せて」と言われたとき、または既存の HTML ツールを Creator 上の業務システムにするときに使う。推測で .ds を書くとインポートが必ず失敗するため、着手前に必ず reference/ を読むこと。
---

# Zoho Creator アプリ作成

## 最初に読むこと

**推測で .ds を書かないこと。** 一般的な設定ファイルの見た目から類推した文法は Creator のパーサに通らず、
「アプリの作成中に問題が発生しました」とだけ表示されて原因が分からないまま止まる。

.ds は **Creator 自身がエクスポートする形式**であり、正解はその出力にしかない。
このキットの `reference/ds-format.md` は、実際に動作している Creator アプリから
エクスポートされた .ds を読んで書き起こしたもの。これに従えば通る。

作業の順番：

1. `reference/ds-format.md` を読む（.ds の文法）
2. `reference/widget-package.md` を読む（zip の構造と SDK の呼び方）
3. `reference/pitfalls.md` を読む（実際に踏んだ落とし穴）
4. `template/generate_ds.py` のスキーマ定義を書き換えて .ds を生成する
5. `template/widget/` を土台にウィジェットを作る
6. `verify/smoke-test.js` でブラウザ検証する

## 設計の基本方針

**Creator 側のフィールドは text / textarea / number の3種類だけ使う。**

ルックアップ（他フォーム参照）や選択肢（ドロップダウン）は使わない。
関係は ID を文字列で持ち、日付・金額・真偽値も文字列か数値で保存し、
**意味づけはウィジェット側の JavaScript が担当する。**

| 利点 | 理由 |
|---|---|
| 取り込みが確実 | 実績のある3つの型しか使わないのでパーサに弾かれにくい |
| 順序に依存しない | ルックアップの参照先を先に作る必要がない |
| 型崩れが起きない | 選択肢の値ずれ、日付書式の食い違いが原理的に起きない |
| 移植しやすい | 同じ JSON を別の基盤に載せ替えられる |

真偽値は `"true"` / `"false"` の文字列で保存し、読み込み時にウィジェットが真偽値へ戻す。

## 成果物

```
<app>/
├── ds/
│   ├── <AppName>.ds          ← Creator に取り込むアプリ定義
│   └── generate_ds.py        ← 上記の生成スクリプト（スキーマ変更時に再生成）
└── widget/
    ├── plugin-manifest.json
    └── app/
        ├── widget.html       ← インデックスページに指定するファイル
        ├── css/ js/
        └── translations/en.json
```

zip は `widget/` の中身を固めたもの。**`plugin-manifest.json` が zip の直下に来ること。**

## 完成前の確認

`reference/checklist.md` の全項目を自分で確認してから完成とする。
特に次の2つは、確認せずに渡すと必ず後で問題になる。

- **SDK のパラメータ名が snake_case になっているか**（`reportName` ではなく `report_name`）
- **Creator 未接続時にデモモードで動くか**（アップロード前に画面を確認できる）
