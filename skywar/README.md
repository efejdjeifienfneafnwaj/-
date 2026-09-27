# 蒼穹艦隊戦 ─ SKY FLEET ─

Three.js 製のブラウザ向け一人称 3D 空中戦アクションゲームです。近未来の雲海上空で、自軍旗艦「アマテラス」の格納庫からジェットブースターで出撃し、敵飛行空母「ベヒモス」を撃沈します。UI・説明・メニューはすべて日本語です。

## 起動方法

ES モジュールを使うため、ローカルサーバー経由で開いてください（Three.js は CDN から読み込みます）。

```bash
cd skywar
python -m http.server 8000
# ブラウザで http://localhost:8000 を開く
```

## 操作

| 操作 | 内容 |
|---|---|
| マウス | 視点移動 |
| W / A / S / D | 前進 / 左 / 後退 / 右 |
| スペース / C（Ctrl） | 上昇 / 下降 |
| Shift | ジェットブースト |
| 左クリック | 機関砲 |
| 右クリック / F | ホーミングミサイル（ロックオン） |
| Esc | 一時停止 |

## 作戦の流れ

1. 敵空母の対空砲台（6 基）を全て破壊 → 機関部のシールドが消失
2. 空母後部の機関コア（2 基）を破壊 → 撃沈で勝利
3. 敵主砲のプラズマ弾は旗艦を狙います。撃ち落として旗艦を守ってください
4. 自軍格納庫に戻ると修理・ミサイル補給ができます

機体か旗艦の耐久が 0 になると敗北です。設定画面でマウス感度・上下反転・音量・難易度を変更できます。

## Blender モデル

`blender/generate_models.py` は Blender の Python API（bpy）で艦艇・ドローンのモデルを作り、glTF（.glb）として `models/` に書き出します。

```bash
cd skywar
blender -b -P blender/generate_models.py
```

ゲームは起動時に `models/ally_battleship.glb` / `enemy_carrier.glb` / `drone.glb` を読み込み、見つからない場合は同じ寸法の内蔵モデルを使います。当たり判定はゲーム側の寸法で決まっているため、Blender 上で編集する場合も船体の大まかな寸法は変えないでください。

## 構成

- `index.html` … 画面・HUD・メニュー
- `style.css` … UI スタイル
- `js/main.js` … ゲーム本体（描画・操作・敵 AI・当たり判定・効果音）
- `blender/generate_models.py` … Blender モデル生成スクリプト
- `models/` … 生成した .glb の配置先
