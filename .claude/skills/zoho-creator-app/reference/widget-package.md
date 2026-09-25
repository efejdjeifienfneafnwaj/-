# ウィジェット（zip）の作り方

## この文書の出どころ

実際に Zoho Creator 上で動作しているウィジェットの zip を展開して確認した内容。
SDK の呼び出し方は、その中で実際に動いているコードから読み取った。

**2026年9月に訂正**：初版の「`ZOHO.CREATOR.init()` で初期化する」は誤り。
v2 の SDK（`version/2.0/widgetsdk-min.js`）には `init()` が無く、`init` の有無で SDK を判定した
ウィジェットは、実際の Creator（JP データセンター）で SDK が読み込まれているのに「SDK未検出」で止まった。
判定をデータ操作の関数に変えて直ったことを、同じ環境で確認済み。
あわせて、Zoho の JS API v2 の資料と食い違っていた点（`getInitParams()` の戻り値、更新の関数名、
追加の応答の形）は、**どちらの形でも動く書き方**に改めた（下記）。

---

## zip の構造

```
plugin-manifest.json      ← zip の直下（必須）
app/
├── widget.html           ← インデックスページに指定するファイル
├── css/style.css
├── js/*.js
└── translations/en.json  ← 空の {} でよい
```

zip 化するときは `plugin-manifest.json` と `app/` を固める。
**1階層上のフォルダごと固めない**こと（`myapp/plugin-manifest.json` になると認識されない）。

```bash
cd widget && zip -r ../dist/my-widget.zip plugin-manifest.json app
```

## plugin-manifest.json

```json
{
  "service": "CREATOR",
  "cspDomains": {
    "connect-src": [],
    "script-src": [],
    "style-src": [],
    "img-src": ["data:"],
    "font-src": []
  },
  "config": []
}
```

**`widgets` 配列は不要。** インデックスページは Creator のアップロード画面で指定する。
外部のスクリプトやフォントを読み込むなら `cspDomains` に列挙する
（例：YouTube を埋め込むなら `script-src` に `https://s.ytimg.com`）。

## widget.html

```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>アプリ名</title>
<link rel="stylesheet" href="css/style.css">
<script src="https://js.zohostatic.com/creator/widgets/version/2.0/widgetsdk-min.js"></script>
</head>
<body>
  <div id="app"></div>
  <script src="js/config.js"></script>
  <script src="js/data.js"></script>
  <script src="js/app.js"></script>
</body>
</html>
```

SDK は `js.zohostatic.com` から読む。これは Zoho 自身が配信しているので許可されている。

---

## SDK の呼び方（ここが最も間違えやすい）

**パラメータ名は snake_case。** camelCase で書くと動かない。

### 取得

```js
ZOHO.CREATOR.DATA.getRecords({
  report_name: 'Wf_Employee_Report',
  max_records: 1000,          // 上限 1000
  criteria: 'emp_no == "S0001"'   // 省略可
}).then(function (res) {
  var rows = (res && res.data) || [];
});
```

**0件のときもエラーが返る**（コード 9220 など）。握って空配列で進めること。

```js
.catch(function (e) {
  console.warn('取得できませんでした（0件の可能性）', e);
  return [];
});
```

### 追加

```js
ZOHO.CREATOR.DATA.addRecords({
  form_name: 'Wf_Employee_Form',
  payload: { data: { emp_name: '山田 直樹', leave_balance: 12 } }
}).then(checkRes).then(function (res) {
  var id = recordId(res);   // 読めなければ仮の ID を振らずにエラーにする
});
```

`payload.data` は**オブジェクト**（配列ではない）。

応答の形は2通りありうる。**両方から ID を読む**こと（雛形の `recordId()`）。

```js
{ code: 3000, data: { ID: '…' } }                              // このスキルの初版で観測した形
{ code: 3000, result: [ { code: 3000, data: { ID: '…' } } ] }   // REST API v2.1 の形
```

後者では、全体の `code` が 3000 でも、`result` の中のレコードが失敗（3001 など）していることがある。
`code` と `result[].code` の両方を確かめる（雛形の `checkRes()`）。

### 更新

```js
var D = ZOHO.CREATOR.DATA;
var fn = typeof D.updateRecordById === 'function' ? 'updateRecordById' : 'updateRecord';
D[fn]({
  report_name: 'Wf_Employee_Report',
  id: String(recordId),
  payload: { data: { leave_balance: 10 } }
}).then(checkRes);
```

関数名は資料によって食い違う。Zoho の JS API v2 の資料では `updateRecordById`、
このスキルの初版（観測したコード）では `updateRecord`。**ある方を呼ぶ**。
どちらが実際に使えるかは、まだ実機で確かめていない。

### 初期化とログインユーザー

**v2 の SDK には `ZOHO.CREATOR.init()` が無い。** 読み込めばそのまま `DATA` / `UTIL` が使える。
`init` は v1 の SDK の関数で、「あれば呼ぶ」だけにする。**`init` の有無で SDK を判定してはいけない**
（実際の Creator で、SDK が読み込まれているのに「SDK未検出」で止まった）。

```js
var C = ZOHO.CREATOR;
Promise.resolve(typeof C.init === 'function' ? C.init() : null)   // v2 には無い
  .then(function () { return C.UTIL.getInitParams(); })              // v2 は Promise を返す
  .then(function (p) {
    var login = (p || {}).loginUser;   // ログインしている人のメールアドレス
  });
```

`getInitParams()` は v2 では **Promise** を返す（初版の資料は同期の値として書いていた）。
`Promise.resolve()` で包めば、どちらでも受け取れる。

`loginUser` は**サーバーが保証する値**。本人判定はこれを社員マスタのメールと突き合わせて行う。
クライアントが名乗る値を信用しないこと。

### まとめ

| 操作 | 関数 | パラメータ |
|---|---|---|
| SDK の判定 | `CREATOR.DATA.getRecords` が関数か | — （`init` の有無で判定しない） |
| 初期化 | 不要（v2）。`CREATOR.init` が**あるときだけ**呼ぶ | — |
| ログイン情報 | `UTIL.getInitParams()`（v2 は **Promise**） | — |
| 取得 | `DATA.getRecords` | `report_name` / `max_records` / `criteria` |
| 追加 | `DATA.addRecords` | `form_name` / `payload.data`（オブジェクト）。ID は `data` と `result` の両方から読む |
| 更新 | `DATA.updateRecordById`（無ければ `DATA.updateRecord`） | `report_name` / `id` / `payload.data` |

---

## 接続判定とデモモード

**Creator にアップロードする前に画面を確認できるようにしておく。**
これが無いと、修正のたびに zip を作り直してアップロードすることになり、開発が進まない。

```js
// SDK の判定はデータ操作の関数で行う（v2 には init が無いので、init で判定すると必ず「未検出」になる）
function sdkReady() {
  return typeof ZOHO !== 'undefined' && ZOHO && ZOHO.CREATOR && ZOHO.CREATOR.DATA &&
    typeof ZOHO.CREATOR.DATA.getRecords === 'function';
}
// Creator のウィジェットは iframe の中で動く。デモへ落としてよいのは iframe の外（ローカル）だけ
function inFrame() { try { return window.self !== window.top; } catch (e) { return true; } }

if (!sdkReady()) {
  if (!inFrame()) startDemo('SDK未検出');
  else showError('Zoho Creator に接続できませんでした（SDK未検出）', sdkShape());   // SDK が持つ関数を表示
  return;
}
var C = ZOHO.CREATOR;
var timer = setTimeout(function () { failOrDemo('SDK応答なし'); }, 8000);   // 固まるのを防ぐ
Promise.resolve(typeof C.init === 'function' ? C.init() : null)
  .then(function () { return C.UTIL.getInitParams(); })
  .then(function (p) { clearTimeout(timer); connected = true; initParams = p || {}; })
  .catch(function (e) { clearTimeout(timer); failOrDemo('SDK初期化エラー'); });
```

実際の書き方（Creator の中では2秒まで待ってから判定する、止めた画面に SDK の形を出す、など）は
`template/widget/app/js/data.js` の `init()` を使うこと。

デモモードでは localStorage 上の疑似データで全機能が動くようにする。
ローカルで `app/widget.html` をブラウザで開くだけで確認できる状態になる。

**Creator の中（iframe の中）ではデモへ落とさない。** SDK が使えないままデモで起動すると、
利用者は保存されない画面に入力してしまう。雛形は iframe の中ではエラー画面で止め、
SDK が持っている関数の一覧（診断情報）を表示する。確認のために iframe の中でデモを使いたいときは、
URL に `?demo=1` を付ける。

---

## 項目名の対応表を持つ

Creator 側は snake_case、画面側は読みやすい名前、という食い違いが必ず出る。
**1か所に対応表を持ち、変換を1つの関数に閉じ込める。**

```js
CFG.FIELD_MAP = {
  Employees: {
    Employee_Name: 'emp_name',
    Department_name: 'dept_name',
    Manager: 'manager_id',
    Is_Active: 'is_active'
  }
};
CFG.BOOL_FIELDS = ['Is_Active'];   // "true"/"false" の文字列で保存される項目
```

Creator 側のリンク名を変えるときは、この表だけを直せば済む。

**`.ds` と対応表がずれると静かに壊れる**ので、機械的に突き合わせる検査を書いておくこと
（`verify/schema-check.js` 参照）。
