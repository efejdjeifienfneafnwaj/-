# 完成前の確認

各項目を**実際に確認してから**チェックする。「たぶん大丈夫」は数えない。

## .ds

- [ ] `application "アプリ名"` が**引用符で囲まれている**
- [ ] `forms { }` / `reports { }` / `pages { }` のブロック構造になっている
- [ ] 各フォームの先頭に `Section` 要素がある
- [ ] フィールドは `名前` 改行 `( type = ... )` の括弧記法
- [ ] 使っている型が `text` / `textarea` / `number` / `section` だけ
- [ ] `textarea` に `height = 300px` を付けた
- [ ] レポートが `list X { show all rows from Form ( ... ) }` の形
- [ ] `displayName`（reports 側）の N が大文字
- [ ] 手書きではなく**スクリプトで生成**している
- [ ] **実際に Creator に取り込んで成功した**

## ウィジェット zip

- [ ] `plugin-manifest.json` が zip の**直下**にある（フォルダごと固めていない）
- [ ] `app/widget.html` がある
- [ ] `app/translations/en.json` がある（中身は `{}` でよい）
- [ ] SDK を `https://js.zohostatic.com/creator/widgets/version/2.0/widgetsdk-min.js` から読んでいる
- [ ] 外部リソースを使うなら `cspDomains` に列挙した
- [ ] アップロード時にインデックスページへ **`app/widget.html`** を指定した

## SDK の呼び方

- [ ] `getRecords({ report_name, max_records })` — **snake_case**
- [ ] `addRecords({ form_name, payload: { data: {...} } })` — data は**オブジェクト**
- [ ] `updateRecord({ report_name, id, payload: { data } })` — `updateRecordById` ではない
- [ ] 0件のレポートで `catch` して空配列を返している
- [ ] `verify/sdk-mock-test.js` が通る

## データの扱い

- [ ] 項目名の対応表（`CFG.FIELD_MAP`）が1か所にある
- [ ] 真偽値を `"true"` / `"false"` の文字列として読み書きしている
- [ ] `CFG.BOOL_FIELDS` に真偽値の項目を列挙した
- [ ] 数値の解釈が**1つの関数**に統一されている（独自パーサを複数書いていない）
- [ ] 関係（ID）が解決できないとき、**氏名など別の手がかりでも解決**できる
- [ ] `verify/schema-check.js` が不一致0で通る

## 動作

- [ ] Creator 未接続でもデモモードで動く（ローカルで `app/widget.html` を開いて確認した）
- [ ] `verify/demo-smoke-test.js` が通る
- [ ] コンソールエラーが0件
- [ ] 375px 幅で横スクロールが発生しない
- [ ] 表は `overflow-x:auto` の内側に閉じている

## 権限（業務システムを作る場合）

- [ ] 本人の判定に `getInitParams().loginUser` を使っている（クライアントの申告を信用していない）
- [ ] ログインIDがマスタに無い場合、**データを読まずに止める**
- [ ] Creator 側のロールとレコードレベル権限の設定手順を文書に書いた
- [ ] 「ウィジェット側の制御は画面の親切であり、守りではない」と明記した

## 報告

- [ ] 「動作確認済み」と書いた範囲を、**実際に全パターンで確認した**
      （1件の成功例は、他が動く証拠にならない）
- [ ] 未検証のものは「未検証」と明記した
