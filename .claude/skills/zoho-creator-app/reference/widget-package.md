# ウィジェット（zip）の作り方

## この文書の出どころ

実際に Zoho Creator 上で動作しているウィジェットの zip を展開して確認した内容。
SDK の呼び出し方は、その中で実際に動いているコードから読み取った。

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
}).then(function (res) {
  var d = res && res.data;
  var id = d && (d.ID || (d[0] && d[0].ID));
});
```

`payload.data` は**オブジェクト**（配列ではない）。

### 更新

```js
ZOHO.CREATOR.DATA.updateRecord({
  report_name: 'Wf_Employee_Report',
  id: String(recordId),
  payload: { data: { leave_balance: 10 } }
});
```

関数名は `updateRecord`。`updateRecordById` ではない。

### 初期化とログインユーザー

```js
ZOHO.CREATOR.init().then(function () {
  var p = ZOHO.CREATOR.UTIL.getInitParams() || {};
  var login = p.loginUser;   // ログインしている人のメールアドレス
});
```

`loginUser` は**サーバーが保証する値**。本人判定はこれを社員マスタのメールと突き合わせて行う。
クライアントが名乗る値を信用しないこと。

### まとめ

| 操作 | 関数 | パラメータ |
|---|---|---|
| 取得 | `DATA.getRecords` | `report_name` / `max_records` / `criteria` |
| 追加 | `DATA.addRecords` | `form_name` / `payload.data`（オブジェクト） |
| 更新 | `DATA.updateRecord` | `report_name` / `id` / `payload.data` |
| 初期化 | `CREATOR.init()` | — |
| ログイン情報 | `UTIL.getInitParams()` | — |

---

## 接続判定とデモモード

**Creator にアップロードする前に画面を確認できるようにしておく。**
これが無いと、修正のたびに zip を作り直してアップロードすることになり、開発が進まない。

```js
var hasSDK = (typeof ZOHO !== 'undefined' && ZOHO.CREATOR && typeof ZOHO.CREATOR.init === 'function');
if (!hasSDK) { startDemo('SDK未検出'); return; }

// 応答が無いまま固まるのを防ぐ
var timer = setTimeout(function () { startDemo('SDK応答なし'); }, 6000);
ZOHO.CREATOR.init().then(function () {
  clearTimeout(timer);
  connected = true;
}).catch(function () {
  clearTimeout(timer);
  startDemo('SDK初期化エラー');
});
```

デモモードでは localStorage 上の疑似データで全機能が動くようにする。
ローカルで `app/widget.html` をブラウザで開くだけで確認できる状態になる。

**ただし本番では注意**：Creator 上で動いているのに SDK が一時的に応答しないと、
デモモードで起動してしまう。本番向けには「`ZOHO` が存在するならデモへ落とさずエラー画面で止める」
という分岐を入れる方が安全。

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
