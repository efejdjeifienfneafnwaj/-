# Zoho Creator アプリ作成キット

Claude Code のプロジェクトに置いておくと、「Zoho Creator でアプリにして」と言うだけで
**インポートが通る .ds と、動くウィジェット zip** が出てくるようにするためのものです。

## なぜ必要か

Claude は Zoho Creator の `.ds` ファイルの文法を知りません。
一般的な設定ファイルの見た目から類推して書くと、
**「アプリの作成中に問題が発生しました」とだけ表示されて原因が分からないまま止まります。**

SDK の呼び方も同様で、`reportName` と書くと動かず（正しくは `report_name`）、
エラーも出ないまま画面が空になります。

このキットは、その2つを**実際に動いている Creator アプリから読み取った事実**として持っています。

## 置き方

プロジェクトの直下にフォルダごと置くだけです。

```
your-project/
├── .claude/
│   └── skills/
│       └── zoho-creator-app/     ← このフォルダの中身をここに置く
│           ├── SKILL.md
│           ├── reference/
│           ├── template/
│           └── verify/
└── （あなたのコード）
```

スキルとして置かない場合は、`SKILL.md` の中身を `CLAUDE.md` に貼っても機能します。
その場合も `reference/` `template/` `verify/` は同じ階層に置いてください。

## 中身

| 場所 | 内容 |
|---|---|
| `SKILL.md` | 入口。作業手順と設計方針 |
| `reference/ds-format.md` | .ds の文法（実際のエクスポートから書き起こし） |
| `reference/widget-package.md` | zip の構造と SDK の正しい呼び方 |
| `reference/pitfalls.md` | 実際に踏んだ落とし穴11件と、その対処 |
| `reference/checklist.md` | 完成前の確認項目 |
| `template/generate_ds.py` | .ds の生成スクリプト。スキーマを書き換えて使う |
| `template/widget/` | 動くウィジェットの雛形（デモモード付き） |
| `verify/schema-check.js` | .ds と対応表の項目名を機械的に突き合わせる |
| `verify/sdk-mock-test.js` | SDK の呼び方が正しいかをモックで検証する |
| `verify/demo-smoke-test.js` | デモモードで画面が動くかを確認する |
| `reference/sample-output.ds` | 生成された .ds の実例（文法の見本） |

## 使い方

```bash
# 1. スキーマを決めて .ds を生成
cd template && vi generate_ds.py     # APP_NAME と FORMS を書き換える
python3 generate_ds.py

# 2. 対応表と .ds がずれていないか確認
node ../verify/schema-check.js SampleApp.ds widget/app/js/config.js

# 3. ブラウザで動くか確認（アップロード前）
npm install playwright
node ../verify/demo-smoke-test.js widget/app/widget.html
node ../verify/sdk-mock-test.js widget/app/widget.html

# 4. zip を作る
cd widget && zip -r ../dist/my-widget.zip plugin-manifest.json app
```

## 最も重要なこと

**`.ds` の正解は、その環境の Creator がエクスポートしたものにしかありません。**

このキットの文法は1つのアプリの出力から書き起こしたものなので、
確認できていない要素（ルックアップ、選択肢、日付型など）があります。

確実にしたい場合は、対象の Creator で既存アプリを開き、
**設定 → アプリケーションIDE → DSファイルのエクスポート**。
出てきたファイルをこのキットの `reference/` に追加してください。それがその環境の正解です。

だからこそ、Creator 側は **text / textarea / number の3種類だけ**で組み、
意味づけはウィジェット側の JavaScript が持つ、という方針を採っています。
未確認の型に依存しなければ、取り込みが失敗する余地がありません。
