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
ただしウィジェットの SDK は、ウィジェットが載っているアプリを対象に動く（`app_name` を省略した場合）。
そのため、**リンク名が何であってもウィジェットの動作には影響しない。**
（初版はこの仕組みを `ZOHO.CREATOR.init()` によるものと書いていたが、v2 の SDK には `init()` が無い。
`app_name` を省略した雛形のウィジェットが、実際の Creator で動くことは確認済み）
