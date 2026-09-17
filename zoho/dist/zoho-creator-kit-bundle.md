# Zoho Creator アプリ作成キット（1ファイル版）

このファイルを Claude Code に渡して、次のように頼んでください。

> このファイルの中身を `.claude/skills/zoho-creator-app/` に展開してください。
> 各ファイルの先頭に `=== FILE: 相対パス ===` と書いてあるので、その通りのパスで作成してください。

zip を展開できる環境なら zip 版のほうが確実です。これはチャットにしか渡せない場合のための形式です。

---

## 収録ファイル

- `README.md`
- `SKILL.md`
- `reference/checklist.md`
- `reference/ds-format.md`
- `reference/pitfalls.md`
- `reference/sample-output.ds`
- `reference/widget-package.md`
- `template/generate_ds.py`
- `template/widget/app/css/style.css`
- `template/widget/app/js/app.js`
- `template/widget/app/js/config.js`
- `template/widget/app/js/data.js`
- `template/widget/app/translations/en.json`
- `template/widget/app/widget.html`
- `template/widget/plugin-manifest.json`
- `verify/demo-smoke-test.js`
- `verify/schema-check.js`
- `verify/sdk-mock-test.js`

---

=== FILE: README.md ===

````markdown
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
````

=== FILE: SKILL.md ===

````markdown
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
````

=== FILE: reference/checklist.md ===

```markdown
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
```

=== FILE: reference/ds-format.md ===

````markdown
# .ds ファイルの文法

## この文書の出どころ

実際に Zoho Creator 上で動作しているアプリからエクスポートされた .ds を読んで書き起こした。
**推測は含まない。** ただし観測した1アプリで使われていた構文に限られるため、
ここに無い要素（ルックアップ、選択肢、サブフォーム、日付型など）の書き方は**確認できていない**。

だからこそ、Creator 側は text / textarea / number の3種類だけで組む方針を採る。

**より確実にしたい場合**：対象の Creator で既存アプリを開き、
**設定 → アプリケーションIDE → DSファイルのエクスポート**。出てきたファイルがその環境の正解。

---

## 全体構造

```
/*
 * コメントはブロックコメントで書ける
 */
application "アプリ名（日本語可・引用符で囲む）"
{
	date format = "yyyy-MM-dd"
	time zone = "Asia/Tokyo"
	time format = "24-hr"

	forms { ... }
	reports { ... }
	pages { ... }
	share_settings { ... }
	web { ... }
	phone { ... }
	tablet { ... }
	translation { ... }
}
```

### ここを間違えると失敗する

| 項目 | 正しい | 誤り（通らない） |
|---|---|---|
| アプリ名 | `application "社内申請システム"` | `application 社内申請システム`（引用符なし） |
| 構造 | `forms { form X { } }` | `application { form X { } }`（forms ブロックなし） |
| フィールド | `field_name` 改行 `( type = text ... )` | `Field_Name = textfield` |
| フォーム先頭 | `Section` 要素が必須 | 省略 |
| 成功メッセージ | `success message = "..."` | `successmessage = "..."` |
| レポート | `list X { show all rows from Form ( ... ) }` | `view X { type = report }` |

**アプリ名に引用符が無いと、Creator は宣言を解釈できず、アプリ名が既定値
（既存アプリの名前など）のままになる。** これが「アプリ名が変わらない」現象の正体。

---

## forms ブロック

```
	forms
	{
		form Wf_Employee_Form
		{
			displayname = "【システム用】社員マスタ"
			success message = "保存しました。"
			Section
			(
				type = section
				row = 1
				column = 0
				width = medium
			)
			emp_name
			(
				type = text
				displayname = "氏名"
				row = 1
				column = 1
				width = medium
			)
			note
			(
				type = textarea
				displayname = "備考"
				height = 300px
				row = 1
				column = 1
				width = medium
			)
			leave_balance
			(
				type = number
				displayname = "有給残日数"
				row = 1
				column = 1
				width = medium
			)
			actions
			{
				on add
				{
					submit
					(
						type = submit
						displayname = "送信"
					)
					reset
					(
						type = reset
						displayname = "リセット"
					)
				}
				on edit
				{
					update
					(
						type = submit
						displayname = "更新"
					)
					cancel
					(
						type = cancel
						displayname = "キャンセル"
					)
				}
			}
		}
	}
```

### 確認できているフィールド型

| type | 用途 | 備考 |
|---|---|---|
| `text` | 単一行テキスト | 日付・ID・真偽値もこれで持つ |
| `textarea` | 複数行テキスト | `height = 300px` を併記する。JSON の格納先 |
| `number` | 数値 | 金額もこれで持つ |
| `section` | セクション見出し | フォーム先頭に1つ必須。`column = 0` |
| `submit` / `reset` / `cancel` | actions ブロック内 | |

**`date` / `picklist` / `lookup` / `currency` / `checkbox` などは未確認。**
必要になったら、その環境でエクスポートした .ds を見て確かめること。

### 命名

- フォーム名・フィールド名は半角英数字とアンダースコア（リンク名）
- 表示名は `displayname = "日本語"` で与える
- フォーム名は `_Form`、レポート名は `_Report` で揃えると対応が追いやすい

---

## reports ブロック

```
	reports
	{
		list Wf_Employee_Report
		{
			displayName = "社員マスタ"
			show all rows from Wf_Employee_Form
			(
				emp_name as "氏名"
				note as "備考"
				leave_balance as "有給残日数"
			)
		}
	}
```

`displayName` の **N が大文字**であることに注意（forms 側は `displayname`）。
観測した .ds がそうなっている。

---

## pages ブロック

```
	pages
	{
		page Wf_Console
		{
			displayname="社内申請コンソール"
			Content=""
		}
	}
```

`Content=""` で空のページを作り、取り込み後に Creator の画面編集でウィジェットを配置する。

---

## share_settings ブロック

観測した .ds をそのまま使ってよい。プロファイルとロールの定義。

```
	share_settings
	{
		"Developer"
		{
			name = "Developer"
			type = Developer
			permissions = {Chat:false, Predefined:true, ApiAccess:true, PIIAccess:true, ePHIAccess:true}
			description = "Developer Profile\n"
		}
		"Administrator"
		{
			name = "Administrator"
			type = Users_Permissions
			permissions = {Chat:true, Predefined:true, ApiAccess:true, PIIAccess:true, ePHIAccess:true}
			description = "Full access profile\n"
		}
		"Customer"
		{
			name = "Customer"
			type = Customer_Portal
			permissions = {Chat:false, Predefined:true, ApiAccess:true, PIIAccess:true, ePHIAccess:true}
			description = "Default portal profile\n"
		}
		roles
		{
			"CEO"
			{
				description = "All access"
			}
		}
	}
```

---

## web / phone / tablet ブロック

画面レイアウトの定義。**省略できるかは未確認**なので、観測した形をそのまま出しておくのが安全。

```
	web
	{
		forms
		{
			form Wf_Employee_Form
			{
				label placement = left
			}
		}
		reports
		{
			report Wf_Employee_Report
			{
				quickview
				(
					layout
					(
						type = -1
						datablock1
						(
							layout type = -1
							fields
							(
								emp_name as "氏名"
							)
						)
					)
					menu
					(
						header
						(
							Edit as "編集"
							Delete as "削除"
							Print as "印刷"
							Add
							Import
							Export
						)
						record
						(
							Edit as "編集"
							Delete as "削除"
							Print as "印刷"
						)
					)
					action
					(
						on click
						(
							View Record as "レコード表示"
						)
					)
				)
				detailview
				(
					layout
					(
						type = 1
						datablock1
						(
							layout type = -2
							title = "概要"
							fields
							(
								emp_name as "氏名"
							)
						)
					)
					menu
					(
						header
						(
							Edit as "編集"
							Delete as "削除"
							Print as "印刷"
						)
					)
				)
			}
		}
		menu
		{
			space Space
			{
				displayname = "Space"
				icon = "objects-spaceship"
				section Section_App
				{
					displayname = "アプリ名"
					icon = "files-paper"
					page Wf_Console
					{
						icon = "tech-desktop"
					}
					report Wf_Employee_Report
					{
						icon = "users-multiple-11"
					}
					form Wf_Employee_Form
					{
						icon = "ui-2-settings-90"
					}
				}
			}
			preference
			{
				icon
				{
					style = solid
					show = {space,section,component}
				}
			}
		}
		customize
		{
			new theme = 4
			font = "lato"
			color options
			{
				color = "2"
			}
			logo
			{
				preference = "none"
				placement = "left"
			}
		}
	}
	phone
	{
		forms
		{
			form Wf_Employee_Form
			{
				label placement = auto
			}
		}
		customize
		{
			layout = slidingpane
			font = "default"
			style = "3"
			color options
			{
				color = blue
			}
			logo
			{
				preference = "company_logo"
			}
		}
	}
	tablet { （phone と同じ形） }
	translation
	{
		{"Language_Settings":{"LANGAGUE_WITH_LOGIN":"browser"}}
	}
```

このボイラープレートはフォーム数に比例して長くなる（12フォームで約3,000行）。
**手で書かず、`template/generate_ds.py` のようにスクリプトで生成すること。**

---

## 取り込み後にアプリ名を変える

取り込んだアプリの表示名は後から変更できる。

1. Creator のホームで、アプリカードの **「✏️ 編集」**
2. アプリケーション名を変更して保存

**リンク名（URL に出る識別子）は作成後に変更できない。**
ただしウィジェットは `ZOHO.CREATOR.init()` が実行中のアプリ文脈を拾うため、
**リンク名が何であってもウィジェットの動作には影響しない。**
````

=== FILE: reference/pitfalls.md ===

````markdown
# 実際に踏んだ落とし穴

すべて、動くと思って書いたものが動かなかった実例。

---

## 1. .ds が「アプリの作成中に問題が発生しました」で止まる

**原因**：一般的な設定ファイルの見た目から類推した文法で書いた。

Creator は何が悪いか教えてくれない。エラーは1行目を指すが、実際の原因はどこにでもありうる。

**対処**：`reference/ds-format.md` の文法に従う。
それでも通らないなら、その環境の既存アプリから .ds をエクスポートして見比べる。

**切り分け方**：最小のファイルから段階的に大きくする。

```
probe_1: 1フォーム・テキスト2項目・コメントなし
probe_2: 各フィールド型
probe_3: reports ブロック
probe_4: コメントと日本語
```

どこで落ちるかが分かれば原因が絞れる。

---

## 2. アプリ名が指定したものにならない

**原因**：`application 社内申請システム` と引用符なしで書いた。

Creator は宣言を解釈できず、既定値（既存アプリの名前）のままになる。

**対処**：`application "社内申請システム"` と引用符で囲む。日本語のままでよい。

---

## 3. SDK を呼んでも何も起きない

**原因**：パラメータ名を camelCase で書いた。

```js
// 動かない
ZOHO.CREATOR.DATA.getRecords({ reportName: 'X', pageSize: 200 })
// 正しい
ZOHO.CREATOR.DATA.getRecords({ report_name: 'X', max_records: 1000 })
```

**対処**：`reference/widget-package.md` の表を見て確認する。
**モックを書いて検証する**のが確実（`verify/` 参照）。間違ったパラメータ名なら
即エラーになるモックを書けば、正しい呼び方であることが保証できる。

---

## 4. 0件のレポートでアプリが止まる

**原因**：レコードが1件も無いレポートを取得すると、SDK が成功ではなくエラーを返す。

**対処**：`catch` して空配列で進める。初期導入時はどのレポートも0件なので、ここで必ず踏む。

---

## 5. 真偽値が全部 true になる

**原因**：Creator 側は text 型なので `"false"` という**文字列**が返る。JavaScript では真。

```js
if (e.Is_Active !== false) { /* "false" は false ではないので通ってしまう */ }
```

**対処**：読み込み時に変換する。どの項目が真偽値かを `CFG.BOOL_FIELDS` に列挙しておく。

```js
function toBool(v) {
  if (typeof v === 'boolean') return v;
  var s = String(v == null ? '' : v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}
```

---

## 6. マスタを CSV で入れた直後、関係が解決できない

**原因**：`manager_id` に入れるべき Creator のレコード ID は、取り込むまで分からない。

**対処**：**氏名でも解決できるようにしておく。**

```js
var byName = {};
employees.forEach(function (e) { if (e.Employee_Name) byName[e.Employee_Name] = e.ID; });
employees.forEach(function (e) {
  if (e.Manager && !employeeById(e.Manager)) e.Manager = byName[e.Manager_name] || '';
});
```

ID 列と氏名列の両方を持たせておくと、初期導入がはるかに楽になる。

---

## 7. 数値の解釈が場所によって違う

**原因**：`String(v).replace(/[^\d.-]/g,'')` のような独自パーサを複数箇所に書いた。

`"30万円"` が `30` になり、画面と CSV 出力で金額が食い違った。

**対処**：数値の解釈は**1つの関数に統一する**。単位語を含む入力は、
黙って数字だけ拾うのではなく「読めない」として拒否するか、正しく展開する。

```js
// 「30万」→ 300000、「30万円分」→ 読めない（NaN）
function parseNum(v) {
  var s = String(v).replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
  var m = s.match(/^([\d,\.]+)\s*(億|万|千)?\s*円?$/);
  if (m) return Number(m[1].replace(/,/g,'')) * ({'億':1e8,'万':1e4,'千':1e3}[m[2]] || 1);
  var plain = s.replace(/[¥￥,\s]/g, '');
  return /^-?\d+(\.\d+)?$/.test(plain) ? Number(plain) : NaN;
}
```

**黙って誤った値になるのが最も危険。** 画面には正しく見えたまま、
全く違う動作をするものが本番に出る。

---

## 8. 日時の集計が環境によってずれる

**原因**：`toISOString()` は UTC を返す。日本時間で「深夜」「1日あたり」を数えたいのに、
ブラウザのタイムゾーンによって境界がずれた。

**対処**：時刻の読み取りと日付キーで、作るインスタンスを分ける。

```js
var jstLocal = new Date(d.getTime() + (9 * 60 + d.getTimezoneOffset()) * 60000);  // getHours() 用
var jstKey   = new Date(d.getTime() + 9 * 3600000);                                // toISOString() 用
```

---

## 9. 複数行テキストに入れた JSON が切れる

**原因**：Creator の複数行項目には最大文字数がある。

**対処**：JSON を入れる項目は**最大文字数を大きめに設定**しておく（64000 など）。
大きなデータは分割して複数レコードに保存する
（base64 を 30,000 文字ずつに割り、同じキーで束ねて連番で並べる、など）。

取り込み後に実データで1度試して、入る上限を確認すること。

---

## 10. 画面の権限制御を「守り」だと思い込む

**原因**：ウィジェット側でメニューやボタンを隠したので安全だと考えた。

開発者ツールを開けばデータは見える。ウィジェットが全レコードを取得していれば、
`App.state` を覗くだけで全部読める。

**対処**：**Creator 側のロールとレコードレベル権限が唯一の守り。**
ウィジェット側の制御は「画面の親切」であって、それだけでは何も守らない。
取得自体を `criteria` でサーバー側に絞るのが本筋。

---

## 11. 「検証済み」と言えるのは、検証した範囲だけ

12種類の申請様式のうち1種類だけで金額分岐を確認して「動作確認済み」と報告した。
実際には2種類で条件が存在しない項目を指しており、**金額分岐が全く効いていなかった**。

**対処**：同じ検証を**全パターンで機械的に回す**。
1件の成功例は、他が動く証拠にならない。
````

=== FILE: reference/sample-output.ds ===

```text
/*
 * サンプルアプリ
 * このファイルはスクリプトで生成されています。手で編集しないでください。
 */
application "サンプルアプリ"
{
	date format = "yyyy-MM-dd"
	time zone = "Asia/Tokyo"
	time format = "24-hr"

	forms
	{
		form Sample_Item_Form
		{
			displayname = "【システム用】品目"
			success message = "保存しました。"
			Section
			(
				type = section
				row = 1
				column = 0
				width = medium
			)
			item_id
			(
				type = text
				displayname = "品目ID"
				row = 1
				column = 1
				width = medium
			)
			item_name
			(
				type = text
				displayname = "品名"
				row = 1
				column = 1
				width = medium
			)
			category
			(
				type = text
				displayname = "区分"
				row = 1
				column = 1
				width = medium
			)
			qty
			(
				type = number
				displayname = "数量"
				row = 1
				column = 1
				width = medium
			)
			unit_price
			(
				type = number
				displayname = "単価"
				row = 1
				column = 1
				width = medium
			)
			note
			(
				type = textarea
				displayname = "備考"
				height = 300px
				row = 1
				column = 1
				width = medium
			)
			data_json
			(
				type = textarea
				displayname = "付帯情報（JSON）"
				height = 300px
				row = 1
				column = 1
				width = medium
			)
			is_active
			(
				type = text
				displayname = "有効（true/false）"
				row = 1
				column = 1
				width = medium
			)
			updated_at
			(
				type = text
				displayname = "更新日時"
				row = 1
				column = 1
				width = medium
			)
			actions
			{
				on add
				{
					submit
					(
						type = submit
						displayname = "送信"
					)
					reset
					(
						type = reset
						displayname = "リセット"
					)
				}
				on edit
				{
					update
					(
						type = submit
						displayname = "更新"
					)
					cancel
					(
						type = cancel
						displayname = "キャンセル"
					)
				}
			}
		}
		form Sample_Log_Form
		{
			displayname = "【システム用】操作記録"
			success message = "保存しました。"
			Section
			(
				type = section
				row = 1
				column = 0
				width = medium
			)
			log_time
			(
				type = text
				displayname = "日時"
				row = 1
				column = 1
				width = medium
			)
			actor_name
			(
				type = text
				displayname = "操作者"
				row = 1
				column = 1
				width = medium
			)
			action
			(
				type = text
				displayname = "操作"
				row = 1
				column = 1
				width = medium
			)
			target_id
			(
				type = text
				displayname = "対象ID"
				row = 1
				column = 1
				width = medium
			)
			detail
			(
				type = textarea
				displayname = "内容"
				height = 300px
				row = 1
				column = 1
				width = medium
			)
			actions
			{
				on add
				{
					submit
					(
						type = submit
						displayname = "送信"
					)
					reset
					(
						type = reset
						displayname = "リセット"
					)
				}
				on edit
				{
					update
					(
						type = submit
						displayname = "更新"
					)
					cancel
					(
						type = cancel
						displayname = "キャンセル"
					)
				}
			}
		}
	}

	reports
	{
		list Sample_Item_Report
		{
			displayName = "品目 一覧"
			show all rows from Sample_Item_Form
			(
				item_id as "品目ID"
				item_name as "品名"
				category as "区分"
				qty as "数量"
				unit_price as "単価"
				note as "備考"
				data_json as "付帯情報（JSON）"
				is_active as "有効（true/false）"
				updated_at as "更新日時"
			)
		}
		list Sample_Log_Report
		{
			displayName = "操作記録 一覧"
			show all rows from Sample_Log_Form
			(
				log_time as "日時"
				actor_name as "操作者"
				action as "操作"
				target_id as "対象ID"
				detail as "内容"
			)
		}
	}

	pages
	{
		page Sample_Console
		{
			displayname="コンソール"
			Content=""
		}
	}

	share_settings
	{
		"Developer"
		{
			name = "Developer"
			type = Developer
			permissions = {Chat:false, Predefined:true, ApiAccess:true, PIIAccess:true, ePHIAccess:true}
			description = "Developer Profile\n"
		}
		"Administrator"
		{
			name = "Administrator"
			type = Users_Permissions
			permissions = {Chat:true, Predefined:true, ApiAccess:true, PIIAccess:true, ePHIAccess:true}
			description = "Full access profile\n"
		}
		"Customer"
		{
			name = "Customer"
			type = Customer_Portal
			permissions = {Chat:false, Predefined:true, ApiAccess:true, PIIAccess:true, ePHIAccess:true}
			description = "Default portal profile\n"
		}
		roles
		{
			"CEO"
			{
				description = "All access"
			}
		}
	}

	web
	{
		forms
		{
			form Sample_Item_Form
			{
				label placement = left
			}
			form Sample_Log_Form
			{
				label placement = left
			}
		}
		reports
		{
			report Sample_Item_Report
			{
				quickview
				(
					layout
					(
						type = -1
						datablock1
						(
							layout type = -1
							fields
							(
									item_id as "品目ID"
									item_name as "品名"
									category as "区分"
									qty as "数量"
									unit_price as "単価"
									note as "備考"
									data_json as "付帯情報（JSON）"
									is_active as "有効（true/false）"
									updated_at as "更新日時"
							)
						)
					)
					menu
					(
						header
						(
							Edit as "編集"
							Delete as "削除"
							Print as "印刷"
							Add
							Import
							Export
						)
						record
						(
							Edit as "編集"
							Delete as "削除"
							Print as "印刷"
						)
					)
					action
					(
						on click
						(
							View Record as "レコード表示"
						)
					)
				)
				detailview
				(
					layout
					(
						type = 1
						datablock1
						(
							layout type = -2
							title = "概要"
							fields
							(
									item_id as "品目ID"
									item_name as "品名"
									category as "区分"
									qty as "数量"
									unit_price as "単価"
									note as "備考"
									data_json as "付帯情報（JSON）"
									is_active as "有効（true/false）"
									updated_at as "更新日時"
							)
						)
					)
					menu
					(
						header
						(
							Edit as "編集"
							Delete as "削除"
							Print as "印刷"
						)
					)
				)
			}
			report Sample_Log_Report
			{
				quickview
				(
					layout
					(
						type = -1
						datablock1
						(
							layout type = -1
							fields
							(
									log_time as "日時"
									actor_name as "操作者"
									action as "操作"
									target_id as "対象ID"
									detail as "内容"
							)
						)
					)
					menu
					(
						header
						(
							Edit as "編集"
							Delete as "削除"
							Print as "印刷"
							Add
							Import
							Export
						)
						record
						(
							Edit as "編集"
							Delete as "削除"
							Print as "印刷"
						)
					)
					action
					(
						on click
						(
							View Record as "レコード表示"
						)
					)
				)
				detailview
				(
					layout
					(
						type = 1
						datablock1
						(
							layout type = -2
							title = "概要"
							fields
							(
									log_time as "日時"
									actor_name as "操作者"
									action as "操作"
									target_id as "対象ID"
									detail as "内容"
							)
						)
					)
					menu
					(
						header
						(
							Edit as "編集"
							Delete as "削除"
							Print as "印刷"
						)
					)
				)
			}
		}
		menu
		{
			space Space
			{
				displayname = "Space"
				icon = "objects-spaceship"
				section Section_App
				{
					displayname = "サンプル"
					icon = "files-paper"
					page Sample_Console
					{
						icon = "tech-desktop"
					}
					report Sample_Item_Report
					{
						icon = "design-todo"
					}
					report Sample_Log_Report
					{
						icon = "files-archive"
					}
					form Sample_Item_Form
					{
						icon = "ui-2-settings-90"
					}
					form Sample_Log_Form
					{
						icon = "ui-2-settings-90"
					}
				}
				section ZC_App_Preferences
				{
					displayname = "App Preferences"
					icon = "design-app"
					systemcomponent
					{
						type = localization
						displayname = "Language Selection"
						icon = "education-language"
					}
				}
			}
			preference
			{
				icon
				{
					style = solid
					show = {space,section,component}
				}
			}
		}
		customize
		{
			new theme = 4
			font = "lato"
			color options
			{
				color = "2"
			}
			logo
			{
				preference = "none"
				placement = "left"
			}
		}
	}
	phone
	{
		forms
		{
			form Sample_Item_Form
			{
				label placement = auto
			}
			form Sample_Log_Form
			{
				label placement = auto
			}
		}
		customize
		{
			layout = slidingpane
			font = "default"
			style = "3"
			color options
			{
				color = blue
			}
			logo
			{
				preference = "company_logo"
			}
		}
	}
	tablet
	{
		forms
		{
			form Sample_Item_Form
			{
				label placement = auto
			}
			form Sample_Log_Form
			{
				label placement = auto
			}
		}
		customize
		{
			layout = slidingpane
			font = "default"
			style = "3"
			color options
			{
				color = blue
			}
			logo
			{
				preference = "company_logo"
			}
		}
	}
	translation
	{
		{"Language_Settings":{"LANGAGUE_WITH_LOGIN":"browser"}}
	}
}
```

=== FILE: reference/widget-package.md ===

````markdown
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
````

=== FILE: template/generate_ds.py ===

```python
# -*- coding: utf-8 -*-
"""
Zoho Creator の .ds ファイルを生成する。

使い方：
  1. 下の APP_NAME と FORMS を書き換える
  2. python3 generate_ds.py
  3. 出力された .ds を Creator に取り込む

なぜスクリプトで生成するか：
  .ds は web / phone / tablet のレイアウト定義がフォーム数に比例して長くなる。
  12フォームで約3,000行になり、手で書くと必ずどこかで食い違う。

フィールド型は text / textarea / number の3種類だけを使う。
理由は reference/ds-format.md を参照。
"""
import io

T, TA, N = 'text', 'textarea', 'number'

# ============================================================================
# ここを書き換える
# ============================================================================
APP_NAME = "サンプルアプリ"          # 日本語可。引用符で囲まれて出力される
APP_LINK = "Sample_App"              # 使わないが、命名の参考に
OUT_FILE = "SampleApp.ds"
MENU_LABEL = "サンプル"              # 左メニューのセクション名
PAGE_NAME = "Sample_Console"         # ウィジェットを載せるページ
PAGE_LABEL = "コンソール"

# (フォームのリンク名, 表示名, [(フィールド名, 表示名, 型), ...])
FORMS = [
    ('Sample_Item_Form', '【システム用】品目', [
        ('item_id',    '品目ID',          T),
        ('item_name',  '品名',            T),
        ('category',   '区分',            T),
        ('qty',        '数量',            N),
        ('unit_price', '単価',            N),
        ('note',       '備考',            TA),
        ('data_json',  '付帯情報（JSON）', TA),
        ('is_active',  '有効（true/false）', T),
        ('updated_at', '更新日時',        T),
    ]),
    ('Sample_Log_Form', '【システム用】操作記録', [
        ('log_time',   '日時',     T),
        ('actor_name', '操作者',   T),
        ('action',     '操作',     T),
        ('target_id',  '対象ID',   T),
        ('detail',     '内容',     TA),
    ]),
]

REPORT_LABEL = {
    'Sample_Item_Form': '品目 一覧',
    'Sample_Log_Form':  '操作記録 一覧',
}
ICON = {
    'Sample_Item_Form': 'design-todo',
    'Sample_Log_Form':  'files-archive',
}
# ============================================================================


def rep(f):
    return f.replace('_Form', '_Report')


def build():
    o = io.StringIO()
    W = o.write

    W('/*\n * %s\n * このファイルはスクリプトで生成されています。手で編集しないでください。\n */\n' % APP_NAME)
    W('application "%s"\n{\n' % APP_NAME)
    W('\tdate format = "yyyy-MM-dd"\n')
    W('\ttime zone = "Asia/Tokyo"\n')
    W('\ttime format = "24-hr"\n\n')

    # ---- forms ----
    W('\tforms\n\t{\n')
    for fname, fdisp, fields in FORMS:
        W('\t\tform %s\n\t\t{\n' % fname)
        W('\t\t\tdisplayname = "%s"\n' % fdisp)
        W('\t\t\tsuccess message = "保存しました。"\n')
        W('\t\t\tSection\n\t\t\t(\n\t\t\t\ttype = section\n\t\t\t\trow = 1\n\t\t\t\tcolumn = 0\n\t\t\t\twidth = medium\n\t\t\t)\n')
        for key, label, ftype in fields:
            W('\t\t\t%s\n\t\t\t(\n' % key)
            W('\t\t\t\ttype = %s\n' % ftype)
            W('\t\t\t\tdisplayname = "%s"\n' % label)
            if ftype == TA:
                W('\t\t\t\theight = 300px\n')
            W('\t\t\t\trow = 1\n\t\t\t\tcolumn = 1\n\t\t\t\twidth = medium\n\t\t\t)\n')
        W('\t\t\tactions\n\t\t\t{\n')
        W('\t\t\t\ton add\n\t\t\t\t{\n')
        W('\t\t\t\t\tsubmit\n\t\t\t\t\t(\n\t\t\t\t\t\ttype = submit\n\t\t\t\t\t\tdisplayname = "送信"\n\t\t\t\t\t)\n')
        W('\t\t\t\t\treset\n\t\t\t\t\t(\n\t\t\t\t\t\ttype = reset\n\t\t\t\t\t\tdisplayname = "リセット"\n\t\t\t\t\t)\n')
        W('\t\t\t\t}\n')
        W('\t\t\t\ton edit\n\t\t\t\t{\n')
        W('\t\t\t\t\tupdate\n\t\t\t\t\t(\n\t\t\t\t\t\ttype = submit\n\t\t\t\t\t\tdisplayname = "更新"\n\t\t\t\t\t)\n')
        W('\t\t\t\t\tcancel\n\t\t\t\t\t(\n\t\t\t\t\t\ttype = cancel\n\t\t\t\t\t\tdisplayname = "キャンセル"\n\t\t\t\t\t)\n')
        W('\t\t\t\t}\n\t\t\t}\n\t\t}\n')
    W('\t}\n\n')

    # ---- reports ----
    W('\treports\n\t{\n')
    for fname, fdisp, fields in FORMS:
        W('\t\tlist %s\n\t\t{\n' % rep(fname))
        W('\t\t\tdisplayName = "%s"\n' % REPORT_LABEL.get(fname, fdisp))
        W('\t\t\tshow all rows from %s\n\t\t\t(\n' % fname)
        for key, label, _t in fields:
            W('\t\t\t\t%s as "%s"\n' % (key, label))
        W('\t\t\t)\n\t\t}\n')
    W('\t}\n\n')

    # ---- pages ----
    W('\tpages\n\t{\n\t\tpage %s\n\t\t{\n\t\t\tdisplayname="%s"\n\t\t\tContent=""\n\t\t}\n\t}\n\n'
      % (PAGE_NAME, PAGE_LABEL))

    # ---- share settings ----
    W('''\tshare_settings
\t{
\t\t"Developer"
\t\t{
\t\t\tname = "Developer"
\t\t\ttype = Developer
\t\t\tpermissions = {Chat:false, Predefined:true, ApiAccess:true, PIIAccess:true, ePHIAccess:true}
\t\t\tdescription = "Developer Profile\\n"
\t\t}
\t\t"Administrator"
\t\t{
\t\t\tname = "Administrator"
\t\t\ttype = Users_Permissions
\t\t\tpermissions = {Chat:true, Predefined:true, ApiAccess:true, PIIAccess:true, ePHIAccess:true}
\t\t\tdescription = "Full access profile\\n"
\t\t}
\t\t"Customer"
\t\t{
\t\t\tname = "Customer"
\t\t\ttype = Customer_Portal
\t\t\tpermissions = {Chat:false, Predefined:true, ApiAccess:true, PIIAccess:true, ePHIAccess:true}
\t\t\tdescription = "Default portal profile\\n"
\t\t}
\t\troles
\t\t{
\t\t\t"CEO"
\t\t\t{
\t\t\t\tdescription = "All access"
\t\t\t}
\t\t}
\t}

''')

    # ---- web ----
    W('\tweb\n\t{\n\t\tforms\n\t\t{\n')
    for fname, _, _ in FORMS:
        W('\t\t\tform %s\n\t\t\t{\n\t\t\t\tlabel placement = left\n\t\t\t}\n' % fname)
    W('\t\t}\n\t\treports\n\t\t{\n')
    for fname, _, fields in FORMS:
        flds = ''.join('\t\t\t\t\t\t\t\t\t%s as "%s"\n' % (k, l) for k, l, _t in fields)
        W('\t\t\treport %s\n\t\t\t{\n' % rep(fname))
        W('\t\t\t\tquickview\n\t\t\t\t(\n\t\t\t\t\tlayout\n\t\t\t\t\t(\n\t\t\t\t\t\ttype = -1\n')
        W('\t\t\t\t\t\tdatablock1\n\t\t\t\t\t\t(\n\t\t\t\t\t\t\tlayout type = -1\n\t\t\t\t\t\t\tfields\n\t\t\t\t\t\t\t(\n')
        W(flds)
        W('\t\t\t\t\t\t\t)\n\t\t\t\t\t\t)\n\t\t\t\t\t)\n')
        W('\t\t\t\t\tmenu\n\t\t\t\t\t(\n\t\t\t\t\t\theader\n\t\t\t\t\t\t(\n')
        W('\t\t\t\t\t\t\tEdit as "編集"\n\t\t\t\t\t\t\tDelete as "削除"\n\t\t\t\t\t\t\tPrint as "印刷"\n\t\t\t\t\t\t\tAdd\n\t\t\t\t\t\t\tImport\n\t\t\t\t\t\t\tExport\n')
        W('\t\t\t\t\t\t)\n\t\t\t\t\t\trecord\n\t\t\t\t\t\t(\n\t\t\t\t\t\t\tEdit as "編集"\n\t\t\t\t\t\t\tDelete as "削除"\n\t\t\t\t\t\t\tPrint as "印刷"\n\t\t\t\t\t\t)\n\t\t\t\t\t)\n')
        W('\t\t\t\t\taction\n\t\t\t\t\t(\n\t\t\t\t\t\ton click\n\t\t\t\t\t\t(\n\t\t\t\t\t\t\tView Record as "レコード表示"\n\t\t\t\t\t\t)\n\t\t\t\t\t)\n')
        W('\t\t\t\t)\n')
        W('\t\t\t\tdetailview\n\t\t\t\t(\n\t\t\t\t\tlayout\n\t\t\t\t\t(\n\t\t\t\t\t\ttype = 1\n')
        W('\t\t\t\t\t\tdatablock1\n\t\t\t\t\t\t(\n\t\t\t\t\t\t\tlayout type = -2\n\t\t\t\t\t\t\ttitle = "概要"\n\t\t\t\t\t\t\tfields\n\t\t\t\t\t\t\t(\n')
        W(flds)
        W('\t\t\t\t\t\t\t)\n\t\t\t\t\t\t)\n\t\t\t\t\t)\n')
        W('\t\t\t\t\tmenu\n\t\t\t\t\t(\n\t\t\t\t\t\theader\n\t\t\t\t\t\t(\n\t\t\t\t\t\t\tEdit as "編集"\n\t\t\t\t\t\t\tDelete as "削除"\n\t\t\t\t\t\t\tPrint as "印刷"\n\t\t\t\t\t\t)\n\t\t\t\t\t)\n')
        W('\t\t\t\t)\n\t\t\t}\n')
    W('\t\t}\n')

    W('\t\tmenu\n\t\t{\n\t\t\tspace Space\n\t\t\t{\n\t\t\t\tdisplayname = "Space"\n\t\t\t\ticon = "objects-spaceship"\n')
    W('\t\t\t\tsection Section_App\n\t\t\t\t{\n\t\t\t\t\tdisplayname = "%s"\n\t\t\t\t\ticon = "files-paper"\n' % MENU_LABEL)
    W('\t\t\t\t\tpage %s\n\t\t\t\t\t{\n\t\t\t\t\t\ticon = "tech-desktop"\n\t\t\t\t\t}\n' % PAGE_NAME)
    for fname, _, _ in FORMS:
        W('\t\t\t\t\treport %s\n\t\t\t\t\t{\n\t\t\t\t\t\ticon = "%s"\n\t\t\t\t\t}\n' % (rep(fname), ICON.get(fname, 'design-todo')))
    for fname, _, _ in FORMS:
        W('\t\t\t\t\tform %s\n\t\t\t\t\t{\n\t\t\t\t\t\ticon = "ui-2-settings-90"\n\t\t\t\t\t}\n' % fname)
    W('\t\t\t\t}\n')
    W('\t\t\t\tsection ZC_App_Preferences\n\t\t\t\t{\n\t\t\t\t\tdisplayname = "App Preferences"\n\t\t\t\t\ticon = "design-app"\n')
    W('\t\t\t\t\tsystemcomponent\n\t\t\t\t\t{\n\t\t\t\t\t\ttype = localization\n\t\t\t\t\t\tdisplayname = "Language Selection"\n\t\t\t\t\t\ticon = "education-language"\n\t\t\t\t\t}\n')
    W('\t\t\t\t}\n\t\t\t}\n')
    W('\t\t\tpreference\n\t\t\t{\n\t\t\t\ticon\n\t\t\t\t{\n\t\t\t\t\tstyle = solid\n\t\t\t\t\tshow = {space,section,component}\n\t\t\t\t}\n\t\t\t}\n')
    W('\t\t}\n')
    W('\t\tcustomize\n\t\t{\n\t\t\tnew theme = 4\n\t\t\tfont = "lato"\n\t\t\tcolor options\n\t\t\t{\n\t\t\t\tcolor = "2"\n\t\t\t}\n')
    W('\t\t\tlogo\n\t\t\t{\n\t\t\t\tpreference = "none"\n\t\t\t\tplacement = "left"\n\t\t\t}\n\t\t}\n')
    W('\t}\n')

    # ---- phone / tablet ----
    for dev in ('phone', 'tablet'):
        W('\t%s\n\t{\n\t\tforms\n\t\t{\n' % dev)
        for fname, _, _ in FORMS:
            W('\t\t\tform %s\n\t\t\t{\n\t\t\t\tlabel placement = auto\n\t\t\t}\n' % fname)
        W('\t\t}\n\t\tcustomize\n\t\t{\n\t\t\tlayout = slidingpane\n\t\t\tfont = "default"\n\t\t\tstyle = "3"\n')
        W('\t\t\tcolor options\n\t\t\t{\n\t\t\t\tcolor = blue\n\t\t\t}\n\t\t\tlogo\n\t\t\t{\n\t\t\t\tpreference = "company_logo"\n\t\t\t}\n\t\t}\n\t}\n')

    W('\ttranslation\n\t{\n\t\t{"Language_Settings":{"LANGAGUE_WITH_LOGIN":"browser"}}\n\t}\n')
    W('}\n')
    return o.getvalue()


if __name__ == '__main__':
    open(OUT_FILE, 'w', encoding='utf-8').write(build())
    print('%s を生成しました（%d フォーム / %d 項目）'
          % (OUT_FILE, len(FORMS), sum(len(f[2]) for f in FORMS)))
```

=== FILE: template/widget/app/css/style.css ===

```css
:root{
  --bg:#f6f7f9; --surface:#fff; --border:#e5e7eb; --text:#111827; --muted:#6b7280; --primary:#2563eb;
}
[data-theme="dark"]{ --bg:#0f1115; --surface:#161a20; --border:#272d36; --text:#e8eaed; --muted:#9aa3af; --primary:#60a5fa; }
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--text);font-family:"Hiragino Kaku Gothic ProN","Yu Gothic Medium",Meiryo,system-ui,sans-serif;font-size:13.5px;line-height:1.7}
.topbar{display:flex;align-items:center;gap:10px;padding:12px 16px;background:var(--surface);border-bottom:1px solid var(--border)}
.chip{font-size:11px;color:var(--muted);background:var(--bg);border-radius:6px;padding:3px 8px}
.view{padding:20px 16px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:14px}
/* 表は必ず折り返さず横スクロールさせる。ページ全体が横に伸びると
   スマホで操作できなくなるため、スクロールは表の内側に閉じ込める */
.table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
table{width:100%;border-collapse:collapse;font-size:12.5px;min-width:520px}
th{text-align:left;color:var(--muted);font-size:11.5px;padding:8px;border-bottom:1px solid var(--border)}
td{padding:9px 8px;border-bottom:1px solid var(--border)}
.btn{height:34px;padding:0 14px;border:1px solid var(--border);background:var(--surface);border-radius:8px;cursor:pointer;font-weight:600}
.btn-primary{background:var(--primary);border-color:var(--primary);color:#fff}
input,select{min-height:34px;border:1px solid var(--border);border-radius:8px;padding:6px 10px;width:100%}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
@media (max-width:640px){
  .view{padding:14px 12px}
  .row input{max-width:none!important;flex:1 1 140px}
}
```

=== FILE: template/widget/app/js/app.js ===

```javascript
/* =========================================================================
 * app.js — 起動と画面
 *   この雛形は「一覧を出す・追加する・更新する」の最小形。
 *   ここに自分のアプリの画面を足していく。
 * ========================================================================= */
var App = (function () {
  var state = { items: [], me: null };

  /* ---------- デモ用の初期データ（Creator 接続時は使われない） ---------- */
  function seed() {
    return {
      Items: [
        { ID: 'i1', Item_Key: 'A001', Item_Name: 'ノートPC', Category: '備品', Qty: 3, Unit_Price: 180000, Note: '', Data_JSON: '{}', Is_Active: true },
        { ID: 'i2', Item_Key: 'A002', Item_Name: 'モニター', Category: '備品', Qty: 5, Unit_Price: 32000, Note: '', Data_JSON: '{}', Is_Active: true },
        { ID: 'i3', Item_Key: 'B001', Item_Name: 'トナー', Category: '消耗品', Qty: 12, Unit_Price: 8800, Note: '在庫僅少', Data_JSON: '{}', Is_Active: false }
      ],
      Logs: []
    };
  }

  /* ---------- 操作記録（誰が何をしたかを残す） ---------- */
  function log(action, targetId, detail) {
    return DB.add('Logs', {
      Log_Time: DB.nowISO(),
      Actor_Name: (state.me && state.me.name) || '（未確定）',
      Action: action, Target_ID: targetId || '', Detail: String(detail || '').slice(0, 480)
    }).catch(function (e) { console.warn('記録に失敗', e); });
  }

  /* ---------- 起動 ---------- */
  function boot() {
    DB.init(seed).then(function (res) {
      var chip = document.getElementById('mode');
      chip.textContent = res.connected ? 'Zoho Creator 接続済' : 'デモモード（未接続）';

      /* ログインしている人はサーバーが教えてくれる。クライアントの申告を信用しない */
      var p = DB.initParams() || {};
      state.me = { login: p.loginUser || '', name: p.loginUser || 'デモ利用者' };
      document.getElementById('who').textContent = state.me.name;

      return DB.list('Items');
    }).then(function (rows) {
      state.items = rows;
      log('利用開始', '', DB.isConnected() ? 'Creator接続' : 'デモ');
      render();
    }).catch(function (e) {
      console.error(e);
      document.getElementById('view').innerHTML =
        '<div class="card">起動に失敗しました：' + esc(e && e.message ? e.message : e) + '</div>';
    });
  }

  /* ---------- 描画 ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function render() {
    var total = state.items.filter(function (r) { return r.Is_Active; })
      .reduce(function (a, r) { return a + Num.num(r.Qty) * Num.num(r.Unit_Price); }, 0);

    document.getElementById('view').innerHTML =
      '<div class="card"><div class="grid">' +
      '<div><div>登録件数</div><strong style="font-size:22px">' + state.items.length + '</strong></div>' +
      '<div><div>有効な在庫金額</div><strong style="font-size:22px">' + Num.yen(total) + '</strong></div>' +
      '</div></div>' +
      '<div class="card">' +
      '<div class="row" style="margin-bottom:12px">' +
      '<input id="f_name" placeholder="品名" style="max-width:200px">' +
      '<input id="f_cat" placeholder="区分" style="max-width:140px">' +
      '<input id="f_qty" placeholder="数量" style="max-width:100px">' +
      '<input id="f_price" placeholder="単価（30万 も可）" style="max-width:170px">' +
      '<button class="btn btn-primary" id="add">追加</button></div>' +
      '<div class="table-wrap"><table><thead><tr><th>コード</th><th>品名</th><th>区分</th><th>数量</th><th>単価</th><th>金額</th><th>状態</th></tr></thead><tbody>' +
      state.items.map(function (r) {
        return '<tr><td>' + esc(r.Item_Key) + '</td><td>' + esc(r.Item_Name) + '</td><td>' + esc(r.Category) + '</td>' +
          '<td>' + Num.num(r.Qty) + '</td><td>' + Num.yen(r.Unit_Price) + '</td>' +
          '<td>' + Num.yen(Num.num(r.Qty) * Num.num(r.Unit_Price)) + '</td>' +
          '<td><button class="btn" data-toggle="' + esc(r.ID) + '">' + (r.Is_Active ? '有効' : '停止') + '</button></td></tr>';
      }).join('') + '</tbody></table></div></div>';

    document.getElementById('add').addEventListener('click', addItem);
    document.querySelectorAll('[data-toggle]').forEach(function (b) {
      b.addEventListener('click', function () { toggle(b.dataset.toggle); });
    });
  }

  function addItem() {
    var name = document.getElementById('f_name').value.trim();
    if (!name) { alert('品名を入れてください'); return; }
    var price = Num.parse(document.getElementById('f_price').value);
    if (document.getElementById('f_price').value && isNaN(price)) {
      alert('単価が数値として読めません（例：180000 / 18万）'); return;
    }
    var obj = {
      Item_Key: 'X' + String(state.items.length + 1).padStart(3, '0'),
      Item_Name: name,
      Category: document.getElementById('f_cat').value.trim(),
      Qty: Num.num(document.getElementById('f_qty').value),
      Unit_Price: isNaN(price) ? 0 : price,
      Note: '', Data_JSON: '{}', Is_Active: true
    };
    DB.add('Items', obj).then(function (saved) {
      state.items.push(saved);
      log('追加', saved.ID, saved.Item_Name);
      render();
    }).catch(function (e) { alert('保存に失敗しました：' + (e && e.message ? e.message : e)); });
  }

  function toggle(id) {
    var r = state.items.filter(function (x) { return String(x.ID) === String(id); })[0];
    if (!r) return;
    var next = !r.Is_Active;
    DB.update('Items', id, { Is_Active: next }).then(function () {
      r.Is_Active = next;
      log('状態変更', id, r.Item_Name + ' → ' + (next ? '有効' : '停止'));
      render();
    }).catch(function (e) { alert('更新に失敗しました：' + (e && e.message ? e.message : e)); });
  }

  return { boot: boot, state: state, render: render, seed: seed };
})();

document.addEventListener('DOMContentLoaded', App.boot);
```

=== FILE: template/widget/app/js/config.js ===

```javascript
/* =========================================================================
 * config.js — Creator のフォーム／レポート名と、項目名の対応表
 *
 * Creator 側のリンク名を変えたら、このファイルだけを直せば済むようにする。
 * ========================================================================= */
var CFG = {
  STORAGE_PREFIX: 'sample_',

  /* レコードを追加するときに使うフォームのリンク名 */
  FORMS: {
    Items: 'Sample_Item_Form',
    Logs:  'Sample_Log_Form'
  },

  /* 取得・更新するときに使うレポートのリンク名 */
  REPORTS: {
    Items: 'Sample_Item_Report',
    Logs:  'Sample_Log_Report'
  },

  /* 画面内部の項目名 ⇔ Creator のフィールド リンク名
     Creator 側は snake_case、画面側は読みやすい名前、という食い違いをここで吸収する */
  FIELD_MAP: {
    Items: {
      Item_Key:   'item_id',
      Item_Name:  'item_name',
      Category:   'category',
      Qty:        'qty',
      Unit_Price: 'unit_price',
      Note:       'note',
      Data_JSON:  'data_json',
      Is_Active:  'is_active'
    },
    Logs: {
      Log_Time:   'log_time',
      Actor_Name: 'actor_name',
      Action:     'action',
      Target_ID:  'target_id',
      Detail:     'detail'
    }
  },

  /* "true" / "false" の文字列で保存される項目。読み込み時に真偽値へ戻す */
  BOOL_FIELDS: ['Is_Active'],

  MAX_RECORDS: 1000
};
```

=== FILE: template/widget/app/js/data.js ===

```javascript
/* =========================================================================
 * data.js — データアクセス層
 *
 *   1) Zoho Creator SDK 経由（本番）
 *   2) SDK が無い環境ではデモモード（localStorage）に自動で切り替わる
 *
 * デモモードがあると、Creator にアップロードする前にブラウザで画面を確認できる。
 * これが無いと、修正のたびに zip を作り直してアップロードすることになる。
 * ========================================================================= */
var DB = (function () {
  var connected = false;
  var demo = false;
  var store = null;
  var initParams = {};

  function uid(p) { return (p || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function nowISO() { return new Date().toISOString(); }
  function lsKey(k) { return CFG.STORAGE_PREFIX + k; }
  function lsGet(k, d) { try { var v = localStorage.getItem(lsKey(k)); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(lsKey(k), JSON.stringify(v)); } catch (e) { console.warn('保存に失敗', e); } }

  /* ---------- 初期化 ---------- */
  function init(seedFn) {
    return new Promise(function (resolve) {
      var hasSDK = (typeof ZOHO !== 'undefined' && ZOHO.CREATOR && typeof ZOHO.CREATOR.init === 'function');
      if (!hasSDK) { startDemo('SDK未検出', seedFn); return resolve({ connected: false }); }

      var done = false;
      /* 応答が無いまま固まるのを防ぐ */
      var timer = setTimeout(function () {
        if (done) return;
        done = true; startDemo('SDK応答なし', seedFn); resolve({ connected: false });
      }, 6000);

      try {
        ZOHO.CREATOR.init().then(function () {
          if (done) return; done = true; clearTimeout(timer);
          connected = true;
          try { initParams = (ZOHO.CREATOR.UTIL && ZOHO.CREATOR.UTIL.getInitParams()) || {}; } catch (e) { initParams = {}; }
          resolve({ connected: true });
        }).catch(function (e) {
          if (done) return; done = true; clearTimeout(timer);
          startDemo('SDK初期化エラー: ' + (e && e.message ? e.message : e), seedFn);
          resolve({ connected: false });
        });
      } catch (e) {
        if (!done) { done = true; clearTimeout(timer); startDemo('SDK例外', seedFn); resolve({ connected: false }); }
      }
    });
  }
  function startDemo(reason, seedFn) {
    connected = false; demo = true;
    console.info('[アプリ] デモモードで起動します（' + reason + '）');
    store = lsGet('demo_db', null);
    if (!store && seedFn) { store = seedFn(); lsSet('demo_db', store); }
    if (!store) store = {};
  }
  function persist() { if (demo) lsSet('demo_db', store); }

  /* ---------- SDK ラッパ（パラメータ名は snake_case） ---------- */
  function sdkGet(reportName, criteria) {
    var q = { report_name: reportName, max_records: CFG.MAX_RECORDS };
    if (criteria) q.criteria = criteria;
    return ZOHO.CREATOR.DATA.getRecords(q).then(function (res) {
      var rows = (res && res.data) || [];
      if (rows.length >= CFG.MAX_RECORDS) console.warn('[アプリ] ' + reportName + ' が上限に達しました');
      return rows;
    }).catch(function (e) {
      /* 0件のときもエラーが返る。ここで握らないと初期導入時にアプリが止まる */
      console.warn('取得できませんでした（0件の可能性）: ' + reportName, e);
      return [];
    });
  }
  function sdkAdd(formName, data) {
    return ZOHO.CREATOR.DATA.addRecords({ form_name: formName, payload: { data: data } });
  }
  function sdkUpdate(reportName, id, data) {
    return ZOHO.CREATOR.DATA.updateRecord({ report_name: reportName, id: String(id), payload: { data: data } });
  }

  /* ---------- 公開メソッド ---------- */
  function list(entity, criteria) {
    if (demo) {
      var rows = JSON.parse(JSON.stringify(store[entity] || []));
      /* デモモードでは criteria を解釈できないので、単純な等値条件だけ手元で絞る */
      var m = criteria && String(criteria).match(/^(\w+)\s*==\s*"(.*)"$/);
      if (m) {
        var map = CFG.FIELD_MAP[entity] || {}, mine = null;
        Object.keys(map).forEach(function (k) { if (map[k] === m[1]) mine = k; });
        if (mine) rows = rows.filter(function (r) { return String(r[mine]) === m[2]; });
      }
      return Promise.resolve(rows);
    }
    return sdkGet(CFG.REPORTS[entity], criteria).then(function (rows) {
      return rows.map(function (r) { return Mapper.fromCreator(entity, r); });
    });
  }
  function add(entity, obj) {
    if (demo) {
      obj.ID = obj.ID || uid(entity);
      store[entity] = store[entity] || []; store[entity].push(obj); persist();
      return Promise.resolve(obj);
    }
    return sdkAdd(CFG.FORMS[entity], Mapper.toCreator(entity, obj)).then(function (res) {
      var d = res && res.data;
      obj.ID = (d && (d.ID || (d[0] && d[0].ID))) || uid(entity);
      return obj;
    });
  }
  function update(entity, id, patch) {
    if (demo) {
      (store[entity] || []).forEach(function (r) {
        if (String(r.ID) === String(id)) Object.keys(patch).forEach(function (k) { r[k] = patch[k]; });
      });
      persist();
      return Promise.resolve(patch);
    }
    return sdkUpdate(CFG.REPORTS[entity], id, Mapper.toCreator(entity, patch)).then(function () { return patch; });
  }

  return {
    init: init, list: list, add: add, update: update,
    isConnected: function () { return connected; },
    isDemo: function () { return demo; },
    initParams: function () { return initParams; },
    resetDemo: function (seedFn) { store = seedFn ? seedFn() : {}; persist(); },
    uid: uid, nowISO: nowISO, lsGet: lsGet, lsSet: lsSet
  };
})();

/* =========================================================================
 * Mapper — 画面内部の項目名 ⇔ Creator のフィールド リンク名
 * ========================================================================= */
var Mapper = (function () {
  /* ルックアップを使う設計に変えても壊れないようにしておく */
  function flat(v) { return (v && typeof v === 'object') ? (v.ID || v.id || v.display_value || '') : (v == null ? '' : v); }
  function isBool(key) { return CFG.BOOL_FIELDS.indexOf(key) >= 0; }

  /** Creator 側は text 型なので "false" という文字列が返る。JavaScript では真になるため必ず変換する */
  function toBool(v) {
    if (typeof v === 'boolean') return v;
    var s = String(v == null ? '' : v).trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'yes' || s === '○';
  }

  function fromCreator(entity, r) {
    var map = CFG.FIELD_MAP[entity] || {};
    var o = { ID: r.ID };
    Object.keys(map).forEach(function (mine) {
      var v = flat(r[map[mine]]);
      o[mine] = isBool(mine) ? toBool(v) : v;
    });
    return o;
  }
  function toCreator(entity, o) {
    var map = CFG.FIELD_MAP[entity] || {};
    var d = {};
    Object.keys(map).forEach(function (mine) {
      if (!(mine in o)) return;
      var v = o[mine];
      if (isBool(mine)) v = (v ? 'true' : 'false');
      else if (Array.isArray(v)) v = v.join(',');
      else if (v == null) v = '';
      d[map[mine]] = v;
    });
    d.updated_at = DB.nowISO();
    return d;
  }
  return { fromCreator: fromCreator, toCreator: toCreator, flat: flat, toBool: toBool };
})();

/* =========================================================================
 * Num — 数値の解釈は1か所に統一する
 *   独自パーサを複数書くと「30万円」が 30 になるなど、場所によって値が食い違う。
 * ========================================================================= */
var Num = (function () {
  function parse(v) {
    if (v == null || v === '') return NaN;
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    var s = String(v)
      .replace(/[０-９．－]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[，]/g, ',').trim();
    var unit = s.match(/^([\d,\.]+)\s*(億|万|千)?\s*円?$/);
    if (unit) {
      var base = Number(unit[1].replace(/,/g, ''));
      if (!isFinite(base)) return NaN;
      return base * ({ '億': 1e8, '万': 1e4, '千': 1e3 }[unit[2]] || 1);
    }
    var plain = s.replace(/[¥￥,\s]/g, '');
    return /^-?\d+(\.\d+)?$/.test(plain) ? Number(plain) : NaN;
  }
  function num(v) { var n = parse(v); return isNaN(n) ? 0 : n; }
  function yen(v) { return '¥' + num(v).toLocaleString('ja-JP'); }
  return { parse: parse, num: num, yen: yen };
})();
```

=== FILE: template/widget/app/translations/en.json ===

```json
{}
```

=== FILE: template/widget/app/widget.html ===

```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>サンプルアプリ</title>
<link rel="stylesheet" href="css/style.css">
<!-- Creator の SDK。ここだけ外部読み込みが許される -->
<script src="https://js.zohostatic.com/creator/widgets/version/2.0/widgetsdk-min.js"></script>
</head>
<body>
<div class="app">
  <header class="topbar">
    <strong>サンプルアプリ</strong>
    <span id="mode" class="chip">接続確認中…</span>
    <span id="who" class="chip"></span>
  </header>
  <main id="view" class="view"></main>
</div>
<script src="js/config.js"></script>
<script src="js/data.js"></script>
<script src="js/app.js"></script>
</body>
</html>
```

=== FILE: template/widget/plugin-manifest.json ===

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

=== FILE: verify/demo-smoke-test.js ===

```javascript
/*
 * デモモード（Creator 未接続）で画面が動くかを確認する。
 *
 *   node verify/demo-smoke-test.js <path/to/app/widget.html>
 *
 * アップロード前にここを通しておくと、Creator 上での確認が1往復で済む。
 */
const { chromium } = require('playwright');
const path = require('path');

const target = process.argv[2];
if (!target) { console.error('使い方: node verify/demo-smoke-test.js <app/widget.html>'); process.exit(2); }
const url = 'file://' + path.resolve(target);
const exe = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

(async () => {
  const errs = [];
  const browser = await chromium.launch({ executablePath: exe });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/zohostatic|ERR_|net::/i.test(m.text())) errs.push('CONSOLE: ' + m.text());
  });

  await page.goto(url);
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload();
  /* SDK の読み込み失敗を待ってデモモードに落ちるまで */
  await page.waitForTimeout(8000);

  const ok = (label, cond, extra) => {
    console.log((cond ? '✓ ' : '✗ ') + label + (extra ? '  ' + extra : ''));
    if (!cond) errs.push(label);
  };

  ok('デモモードで起動する', await page.evaluate(() => (typeof DB !== 'undefined') && DB.isDemo() === true));
  ok('画面が描画される', (await page.locator('#view').textContent()).trim().length > 10);
  ok('コンソールエラーがない', errs.length === 0);

  await page.setViewportSize({ width: 375, height: 760 });
  await page.waitForTimeout(400);
  ok('375px幅で横スクロールしない',
     !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)));

  await page.screenshot({ path: 'verify-screenshot.png', fullPage: false });
  console.log('\nスクリーンショット: verify-screenshot.png');
  console.log('--- エラー ---');
  console.log(errs.length ? errs.join('\n') : 'なし');
  await browser.close();
  process.exit(errs.length ? 1 : 0);
})();
```

=== FILE: verify/schema-check.js ===

```javascript
/*
 * .ds と config.js の項目名を機械的に突き合わせる。
 *
 *   node verify/schema-check.js <path/to/App.ds> <path/to/config.js>
 *
 * 対応表と .ds がずれると、画面は動いているのにデータが空になる、という
 * 気づきにくい壊れ方をする。手で見比べず、必ずこれを通すこと。
 */
const fs = require('fs');

const dsPath = process.argv[2];
const cfgPath = process.argv[3];
if (!dsPath || !cfgPath) {
  console.error('使い方: node verify/schema-check.js <App.ds> <config.js>');
  process.exit(2);
}

eval(fs.readFileSync(cfgPath, 'utf8'));
const ds = fs.readFileSync(dsPath, 'utf8');

/* .ds の forms ブロックから、フォームごとのフィールド名を拾う */
const formsBlock = ds.slice(ds.indexOf('\tforms\n\t{'), ds.indexOf('\treports\n\t{'));
const dsForms = {};
let cur = null;
formsBlock.split('\n').forEach(line => {
  let m = line.match(/^\t\tform (\w+)/);
  if (m) { cur = m[1]; dsForms[cur] = new Set(); return; }
  m = line.match(/^\t\t\t(\w+)$/);
  if (m && cur && m[1] !== 'Section' && m[1] !== 'actions') dsForms[cur].add(m[1]);
});

const reportsBlock = ds.slice(ds.indexOf('\treports\n\t{'), ds.indexOf('\tpages\n\t{'));

let bad = 0, total = 0;
Object.keys(CFG.FIELD_MAP).forEach(entity => {
  const form = CFG.FORMS[entity];
  const fields = dsForms[form];
  if (!fields) { console.log('✗ .ds に form がありません:', entity, '→', form); bad++; return; }
  const map = CFG.FIELD_MAP[entity];
  const missing = Object.values(map).filter(f => !fields.has(f));
  total += Object.keys(map).length;
  if (missing.length) {
    console.log('✗', entity, '(' + form + ') .ds に無い項目:', missing.join(', '));
    bad += missing.length;
  } else {
    console.log('✓', entity.padEnd(14), form.padEnd(22), Object.keys(map).length + '項目 一致');
  }
});

Object.keys(CFG.REPORTS).forEach(entity => {
  const r = CFG.REPORTS[entity];
  if (!new RegExp('list ' + r + '\\b').test(reportsBlock)) {
    console.log('✗ .ds に report がありません:', r);
    bad++;
  }
});

console.log('\n照合', total, '項目 / 不一致', bad);
process.exit(bad ? 1 : 0);
```

=== FILE: verify/sdk-mock-test.js ===

```javascript
/*
 * SDK の呼び方が正しいかを、モックで検証する。
 *
 *   node verify/sdk-mock-test.js <path/to/app/widget.html>
 *
 * 間違ったパラメータ名（reportName など）を渡すと即エラーになるモックを注入するので、
 * これが通れば snake_case で呼べていることが保証される。
 *
 * 事前に: npm install playwright（ブラウザは PLAYWRIGHT_BROWSERS_PATH のものを使う）
 */
const { chromium } = require('playwright');
const path = require('path');

const target = process.argv[2];
if (!target) { console.error('使い方: node verify/sdk-mock-test.js <app/widget.html>'); process.exit(2); }
const url = 'file://' + path.resolve(target);
const exe = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

(async () => {
  const errs = [];
  const browser = await chromium.launch({ executablePath: exe });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/zohostatic|ERR_|net::/i.test(m.text())) errs.push('CONSOLE: ' + m.text());
  });

  /* 正しいパラメータ名しか受け付けないモック */
  await page.addInitScript(() => {
    window.__calls = { get: [], add: [], update: [] };
    const ROWS = {};   // 0件のときもエラーを返す挙動を再現する
    window.ZOHO = {
      CREATOR: {
        init: () => Promise.resolve(),
        UTIL: { getInitParams: () => ({ loginUser: 'test@example.co.jp' }) },
        DATA: {
          getRecords: (q) => {
            window.__calls.get.push(q);
            if (!q || !q.report_name) return Promise.reject(new Error('report_name がありません: ' + JSON.stringify(q)));
            if (!q.max_records) return Promise.reject(new Error('max_records がありません'));
            if (q.reportName || q.pageSize || q.page) return Promise.reject(new Error('camelCase のパラメータが混ざっています'));
            const rows = ROWS[q.report_name];
            if (!rows || !rows.length) return Promise.reject({ code: 9220, message: 'No records found' });
            return Promise.resolve({ data: rows });
          },
          addRecords: (q) => {
            window.__calls.add.push(q);
            if (!q.form_name) return Promise.reject(new Error('form_name がありません'));
            if (q.formName) return Promise.reject(new Error('camelCase（formName）が使われています'));
            if (!q.payload || !q.payload.data) return Promise.reject(new Error('payload.data がありません'));
            if (Array.isArray(q.payload.data)) return Promise.reject(new Error('payload.data は配列ではなくオブジェクトです'));
            return Promise.resolve({ data: { ID: String(Date.now()) } });
          },
          updateRecord: (q) => {
            window.__calls.update.push(q);
            if (!q.report_name || !q.id || !q.payload || !q.payload.data) {
              return Promise.reject(new Error('updateRecord のパラメータが不足しています'));
            }
            return Promise.resolve({ data: { ID: q.id } });
          }
        }
      }
    };
  });

  await page.goto(url);
  await page.waitForTimeout(3000);

  const ok = (label, cond, extra) => {
    console.log((cond ? '✓ ' : '✗ ') + label + (extra ? '  ' + extra : ''));
    if (!cond) errs.push(label);
  };

  const calls = await page.evaluate(() => window.__calls);
  ok('Creator 接続として起動する',
     await page.evaluate(() => (typeof DB !== 'undefined') && DB.isConnected() === true));
  ok('0件のレポートでも落ちない', errs.filter(e => /9220|No records/.test(e)).length === 0);
  ok('getRecords を正しいパラメータ名で呼んでいる',
     calls.get.length > 0 && calls.get.every(q => q.report_name && q.max_records && !q.reportName),
     calls.get.length + '回');

  /* 追加・更新まで動かしているアプリなら、その痕跡も見る */
  if (calls.add.length) {
    ok('addRecords を正しい形で呼んでいる',
       calls.add.every(q => q.form_name && q.payload && q.payload.data && !Array.isArray(q.payload.data)),
       calls.add.length + '回');
  }
  if (calls.update.length) {
    ok('updateRecord を正しい形で呼んでいる',
       calls.update.every(q => q.report_name && q.id && q.payload && q.payload.data),
       calls.update.length + '回');
  }

  console.log('\n--- エラー ---');
  console.log(errs.length ? errs.join('\n') : 'なし');
  await browser.close();
  process.exit(errs.length ? 1 : 0);
})();
```

