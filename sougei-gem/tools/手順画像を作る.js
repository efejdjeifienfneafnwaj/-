// 導入手順の図解（画面のイメージ）を PNG で作る
const { chromium } = require('playwright');
const fs = require('fs');
// 使い方： cd に playwright を入れたフォルダで node 手順画像を作る.js <出力先フォルダ>
const OUT = process.argv[2];

const CSS = `
*{box-sizing:border-box}body{margin:0;font-family:'Noto Sans CJK JP',sans-serif;background:#eef1f5;color:#222}
.page{width:1280px;padding:28px 32px 30px}
.head{display:flex;align-items:center;gap:14px;margin-bottom:6px}
.no{background:#1f3a93;color:#fff;font-weight:700;font-size:26px;border-radius:10px;padding:4px 16px}
.ttl{font-size:28px;font-weight:700}
.img{margin-left:auto;font-size:13px;color:#777;border:1px solid #bbb;border-radius:12px;padding:2px 10px;background:#fff}
.lead{font-size:16px;color:#444;margin:4px 0 16px}
.row{display:flex;gap:22px;align-items:flex-start}
.win{flex:1;min-width:0;background:#fff;border:1px solid #c9ced6;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,.08);overflow:hidden;position:relative}
.bar{background:#f1f3f4;border-bottom:1px solid #dde1e6;padding:7px 12px;font-size:13px;color:#555;display:flex;gap:6px;align-items:center}
.dot{width:10px;height:10px;border-radius:50%;background:#d0d4da;display:inline-block}
.menu{display:flex;gap:16px;padding:6px 14px;font-size:14px;border-bottom:1px solid #eee;color:#333}
.dd{position:absolute;background:#fff;border:1px solid #c9ced6;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.15);font-size:14px;padding:4px 0;min-width:230px}
.dd div{padding:6px 14px}
.hl{outline:3px solid #e53935;outline-offset:1px;border-radius:4px}
.hlb{box-shadow:0 0 0 3px #e53935;border-radius:4px}
.n{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:#e53935;color:#fff;font-weight:700;font-size:15px;flex:none}
.pin{position:absolute}
.steps{width:360px;flex:none}
.st{display:flex;gap:10px;background:#fff;border-radius:10px;padding:10px 12px;margin-bottom:10px;font-size:15px;line-height:1.55;border:1px solid #dde1e6}
.st b{color:#1f3a93}
.note{font-size:13px;color:#666;background:#fff8e1;border:1px solid #f2e3a6;border-radius:8px;padding:8px 10px;margin-top:6px;line-height:1.55}
table.g{border-collapse:collapse;font-size:13px}table.g td,table.g th{border:1px solid #dadce0;padding:4px 7px;height:26px}
table.g th{background:#f8f9fa;color:#666;font-weight:400;width:26px}
.y{background:#fff2cc}
.btn{display:inline-block;padding:6px 16px;border-radius:18px;font-size:14px}
.pri{background:#1a73e8;color:#fff}.sec{border:1px solid #c9ced6;color:#1a73e8;background:#fff}
.file{display:flex;align-items:center;gap:8px;padding:7px 12px;border-bottom:1px solid #f0f0f0;font-size:14px}
.ic{width:18px;height:18px;border-radius:3px;display:inline-block}
.tabs{display:flex;gap:2px;background:#f1f3f4;border-top:1px solid #dde1e6;padding:4px 8px;font-size:12px}
.tabs span.n{background:#e53935;color:#fff;border:0;border-radius:50%;padding:0}
.tabs span:not(.n){white-space:nowrap;background:#fff;border:1px solid #dde1e6;border-radius:4px 4px 0 0;padding:3px 9px;color:#444}
.chat{padding:14px 18px;font-size:14px;line-height:1.6}
.me{background:#e8f0fe;border-radius:14px;padding:8px 14px;margin:0 0 12px auto;width:fit-content}
.field{border:1px solid #c9ced6;border-radius:8px;padding:8px 10px;font-size:14px;margin:4px 0 12px;color:#333}
.lbl{font-size:13px;color:#555}
.chip{display:inline-flex;gap:6px;align-items:center;border:1px solid #c9ced6;border-radius:8px;padding:5px 9px;font-size:12px;margin:3px}
`;

function page(no, title, lead, win, steps, note) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div class="page">
  <div class="head"><span class="no">手順 ${no}</span><span class="ttl">${title}</span><span class="img">画面のイメージ（実際の画面と細部は異なります）</span></div>
  <div class="lead">${lead}</div>
  <div class="row"><div style="flex:1">${win}</div><div class="steps">
  ${steps.map((s, i) => `<div class="st"><span class="n">${i + 1}</span><div>${s}</div></div>`).join('')}
  ${note ? `<div class="note">${note}</div>` : ''}</div></div></div></body></html>`;
}
const W = (title, inner, h) => `<div class="win" style="height:${h === 'auto' ? 'auto' : (h || 520) + 'px'}"><div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span>&nbsp;${title}</div>${inner}</div>`;
const M = n => `<span class="n" style="margin:0 6px;vertical-align:middle">${n}</span>`;

function grid(rows, cols, cells, w) {
  let h = '<table class="g"><tr><th></th>' + cols.map(c => `<th>${c}</th>`).join('') + '</tr>';
  rows.forEach((r, i) => { h += `<tr><th>${r}</th>` + cols.map((c, j) => { const v = cells[i] && cells[i][j]; return v ? `<td ${v.cls ? `class="${v.cls}"` : ''} style="width:${(w && w[j]) || 90}px">${v.t || ''}</td>` : `<td style="width:${(w && w[j]) || 90}px"></td>`; }).join('') + '</tr>'; });
  return h + '</table>';
}

const pages = [];

// 1 スプシにする
pages.push(page(1, '設定シートをGoogleスプレッドシートにする',
  '船井から受け取った <b>設定シート.xlsx</b> を、事業所のGoogleアカウントのドライブに上げます。',
  W('Googleドライブ', `
   <div style="display:flex;height:490px">
    <div style="width:210px;border-right:1px solid #eee;padding:14px">
      ${M(1)}<span class="btn sec hlb" style="font-size:16px;padding:10px 20px">＋ 新規</span>
      <div style="margin-top:18px;font-size:14px;color:#555;line-height:2.2">マイドライブ<br>共有アイテム<br>最近使用したアイテム</div>
    </div>
    <div style="flex:1;padding:14px;position:relative">
      <div class="dd" style="left:0px;top:10px"><div>フォルダ</div><div class="hl">ファイルのアップロード ${M(2)}</div><div>フォルダのアップロード</div></div>
      <div style="margin-top:150px;border:1px solid #dde1e6;border-radius:8px">
        <div class="bar" style="background:#fff">設定シート.xlsx を開いたところ</div>
        <div class="menu">${M(3)}<span class="hl">ファイル</span><span>編集</span><span>表示</span><span>挿入</span></div>
        <div style="position:relative;height:200px"><div class="dd" style="left:10px;top:4px"><div>共有</div><div>コピーを作成</div><div class="hl">Google スプレッドシートとして保存 ${M(4)}</div><div>ダウンロード</div></div></div>
      </div>
    </div></div>`),
  ['左上の <b>「＋ 新規」</b> を押す', '<b>「ファイルのアップロード」</b> → 設定シート.xlsx を選ぶ', 'アップロードしたファイルを開き、<b>「ファイル」</b>', '<b>「Google スプレッドシートとして保存」</b>。新しく開いたスプレッドシートを、この先ずっと使います'],
  '元の .xlsx ファイルは削除してかまいません。'));

// 2 スクリプト
pages.push(page(2, 'スクリプトを貼る',
  'スプレッドシートに、送迎表を作る仕組み（送迎メニュー.gs）を入れます。',
  `<div style="display:flex;flex-direction:column;gap:14px">` +
  W('スプレッドシート', `<div class="menu"><span>ファイル</span><span>編集</span><span>表示</span><span>挿入</span><span>表示形式</span><span>データ</span><span>ツール</span><span class="hl">拡張機能</span>${M(1)}<span>ヘルプ</span></div>
    <div style="position:relative;height:120px"><div class="dd" style="left:380px;top:4px"><div>アドオン</div><div>マクロ</div><div class="hl">Apps Script ${M(2)}</div></div></div>`, 190) +
  W('Apps Script', `<div style="display:flex;height:290px">
    <div style="width:190px;border-right:1px solid #eee;padding:10px;font-size:14px"><div class="hl" style="padding:3px 6px">無題のプロジェクト</div>${M(5)}<div style="margin-top:14px;color:#555">ファイル</div><div style="background:#e8f0fe;padding:4px 8px;margin-top:6px;border-radius:4px">コード.gs</div></div>
    <div style="flex:1;padding:10px;position:relative"><div style="margin-bottom:8px"><span class="hl" style="padding:2px 8px;font-size:16px">💾</span>${M(4)}</div>
    <div class="hlb" style="font-family:monospace;font-size:12px;color:#555;background:#fafafa;padding:10px;height:210px;line-height:1.6">/**<br> * 送迎表スクリプト（スプレッドシートだけで完結する版）<br> …<br>（送迎メニュー.gs の中身を全部貼る） ${M(3)}</div></div></div>`, 330) + `</div>`,
  ['上のメニューの <b>「拡張機能」</b>', '<b>「Apps Script」</b>（新しいタブで開きます）', '<b>コード.gs</b> の中身を全部消し、<b>送迎メニュー.gs の中身を全部貼る</b>', '<b>💾（保存）</b> を押す', '左上の名前を押して <b>「送迎ボード」</b> に変える'],
  'スプレッドシートのタブに戻って <b>再読み込み（F5）</b>。上のメニューに <b>🚐 送迎</b> が出ればOK。Apps Script の「▶ 実行」は押さなくて大丈夫です。'));

// 3 データ
pages.push(page(3, '施設・車両・名簿を入れる',
  '黄色いセルに入力します。名簿は、今お使いのものをコピーして貼るだけで大丈夫です。',
  `<div style="display:flex;flex-direction:column;gap:14px">` +
  W('①施設・車両設定', `<div style="padding:10px">` + grid([4, 5, 6, 7, 8, 9, 10, 11, 12], ['A', 'B', 'C'], [
    [{ t: '項目' }, { t: '入力値' }], [{ t: '施設名' }, { t: '○○事業所 ' + M(1), cls: 'y hl' }], [{ t: '施設住所' }, { t: '○○市○○町1-2-3', cls: 'y hl' }], [], [{ t: '▼ 車両設定' }],
    [{ t: '車両名' }, {}, { t: '定員数' }], [{ t: '1号車 ' + M(2), cls: 'y hl' }, {}, { t: '7', cls: 'y hl' }], [{ t: '2号車', cls: 'y' }, {}, { t: '7', cls: 'y' }], [{ t: '3号車', cls: 'y' }, {}, { t: '4', cls: 'y' }]
  ], [120, 200, 70]) + `</div>` + `<div class="tabs"><span style="font-weight:700">①施設・車両設定</span><span>②利用者一覧</span></div>`, 350) +
  W('②利用者一覧', `<div style="padding:10px">` + grid([4, 5, 6, 7], ['A', 'B', 'C', 'H'], [
    [{ t: '氏名' }, { t: 'お迎え先' }, { t: 'お迎え先住所' }, { t: '月' }], [{ t: '例）ヤマダタロウ' }, { t: '○○小学校' }, { t: '○○市…' }, { t: '○' }],
    [{ t: M(3) + 'ヤマダ タロウ', cls: 'hl' }, { t: '○○小学校' }, { t: '○○市○○1-2' }, { t: '○(迎え14:10、送り17:55)' }], [{ t: 'サトウ ハナ' }, { t: '自宅' }, { t: '○○市△△3-4' }, { t: '' }]
  ], [170, 100, 120, 190]) + `</div>`, 190) + `</div>`,
  ['<b>B5</b> に施設名、<b>B6</b> に施設住所（番地まで。建物名は入れない）', '<b>10行目から</b>、A列に車両名、C列に定員数', '<b>②利用者一覧</b> の <b>A6</b> から、名簿を貼る'],
  '曜日の欄は <b>○(迎え14:10、送り17:55)</b> のように書きます。「自宅迎え」「送りなし」「自力」なども、そのまま読み取ります。'));

// 4 自動更新
pages.push(page(4, '自動更新をONにする（最初の1回だけ）',
  '住所を調べ、移動時間をGoogleマップで測り、曜日ごとの送迎表を作ります。最長5分ほどかかります。',
  `<div style="display:flex;gap:14px">` +
  W('スプレッドシート', `<div class="menu"><span>拡張機能</span><span>ヘルプ</span><span class="hl">🚐 送迎</span>${M(1)}</div>
    <div style="position:relative;height:200px"><div class="dd" style="left:60px;top:4px"><div>今すぐ送迎表を作り直す</div><div style="border-top:1px solid #eee"></div><div class="hl">【初回】自動更新をONにする ${M(2)}</div></div></div>`, 260) +
  W('承認の画面', `<div style="padding:16px;font-size:14px;line-height:1.8">
    <div style="font-weight:700">承認が必要です</div><div style="text-align:right">${M(3)}<span class="btn pri hl">続行</span></div>
    <div style="border-top:1px solid #eee;margin-top:10px;padding-top:10px;font-weight:700">このアプリは Google で確認されていません</div>
    <div style="color:#1a73e8"><span class="hl" style="padding:0 4px">詳細</span>${M(4)}</div>
    <div style="color:#1a73e8"><span class="hl" style="padding:0 4px">送迎ボード（安全ではないページ）に移動</span>${M(5)}</div>
    <div style="text-align:right;margin-top:8px">${M(6)}<span class="btn pri hl">許可</span></div></div>`, 330) + `</div>`,
  ['上のメニューの <b>🚐 送迎</b>', '<b>【初回】自動更新をONにする</b>', '「承認が必要です」→ <b>続行</b>（アカウントを選ぶ）', '「確認されていません」→ 左下の <b>詳細</b>', '<b>送迎ボード（安全ではないページ）に移動</b>', '<b>許可</b>'],
  '自分のスプレッドシートに付けた仕組みなので、この警告は必ず出ます。問題ありません。<br>承認のあと何も起きなければ、もう一度「【初回】自動更新をONにする」を押してください。'));

// 5 確認
pages.push(page(5, '送迎表とGem用データができたか確認する',
  '「送迎表を作り直しました」と出たら完了です。2か所を確認します。',
  `<div style="display:flex;flex-direction:column;gap:14px">` +
  W('スプレッドシート（下のタブ）', `<div style="height:40px"></div><div class="tabs" style="font-size:13px"><span>①施設・車両設定</span><span>②利用者一覧</span>${M(1)}<span class="hl">月曜の送迎表</span><span class="hl">火曜の送迎表</span><span class="hl">水曜の送迎表</span><span>…</span><span class="hl">土曜の送迎表</span><span style="color:#c00">⚠要確認</span></div>`, 120) +
  W('Googleドライブ（スプレッドシートと同じフォルダ）', `<div style="padding:6px 0">
    <div class="file"><span class="ic" style="background:#34a853"></span>設定シート <span style="margin-left:auto">${M(2)}</span></div>
    ${['月', '火', '水', '木', '金', '土'].map(d => `<div class="file hl" style="margin:2px 8px"><span class="ic" style="background:#4285f4"></span>送迎データ_${d}曜（Gem用・自動更新）</div>`).join('')}
    </div>`, 330) + `</div>`,
  ['下のタブに <b>「月曜の送迎表」〜「土曜の送迎表」</b> がある', 'ドライブに <b>「送迎データ_月曜」〜「_土曜」の6つ</b> がある（次の手順で Gem に入れます）'],
  '<b>⚠要確認</b> のタブが出たら開いて、書いてある所（住所の空欄など）を②で直し、<b>🚐 送迎 → 今すぐ送迎表を作り直す</b>。'));

// 6 Gem
pages.push(page(6, 'Gem「送迎配車アシスタント」を作る',
  '事業所のGoogleアカウントの Gemini で作ります。',
  W('Gemini ─ 新しい Gem', `<div style="display:flex;height:490px">
    <div style="width:200px;border-right:1px solid #eee;padding:14px;font-size:14px;line-height:2.2;color:#555"><span class="hl" style="padding:2px 6px">Gem マネージャー</span>${M(1)}<br>チャット<br>…</div>
    <div style="flex:1;padding:16px 20px">
      <div style="text-align:right">${M(2)}<span class="btn sec hl">＋ 新しい Gem</span></div>
      <div class="lbl">${M(3)}名前</div><div class="field hlb">送迎配車アシスタント</div>
      <div class="lbl">${M(4)}カスタム指示</div><div class="field hlb" style="height:90px;color:#666"># 送迎配車アシスタント ── Gem 指示文<br>あなたは福祉事業所の「送迎配車アシスタント」です。…<br>（Gem指示文.md の中身を全部貼る）</div>
      <div class="lbl">${M(5)}知識</div><div class="field hlb">${['月', '火', '水', '木', '金', '土'].map(d => `<span class="chip"><span class="ic" style="background:#4285f4;width:12px;height:12px"></span>送迎データ_${d}曜</span>`).join('')}<span style="float:right;font-size:20px">＋</span></div>
      <div style="text-align:right">${M(6)}<span class="btn pri hl">保存</span></div>
    </div></div>`),
  ['左の <b>Gem マネージャー</b>', '<b>＋ 新しい Gem</b>', '名前：<b>送迎配車アシスタント</b>', 'カスタム指示：<b>Gem指示文.md の中身を全部</b>貼る', '知識の <b>＋</b> → Googleドライブから <b>送迎データ_月曜〜_土曜の6つ</b>', '<b>保存</b>'],
  '送迎の無い曜日のファイルも入れておきます。あとで利用者が増えても、知識を入れ直さずに済みます。'));

// 7 Gem を使う
pages.push(page(7, 'Gemで送迎表を見る・組み替える',
  '作ったGemで <b>新しいチャット</b> を開き、モデルを <b>Pro</b> にして話しかけます。',
  W('Gemini ─ 送迎配車アシスタント', `<div class="chat">
    <div style="text-align:right">${M(1)}<span class="me hlb" style="display:inline-block">水曜のお迎えを見せて</span></div>
    <div>水曜日・お迎え②（14:10〜15:00）です。</div>
    <div style="margin:6px 0 4px;font-weight:700">■ 1号車（定員7名）　事業所出発 13:54 → 帰着 15:29</div>
    <table class="g" style="margin-bottom:12px"><tr><td>順</td><td>氏名</td><td>地点</td><td>指定</td><td>到着</td><td>出発</td></tr>
    <tr><td>1</td><td>ヤマダ タロウ</td><td>P1</td><td>14:10</td><td>14:10</td><td>14:15</td></tr>
    <tr><td>2</td><td>サトウ ハナ</td><td>P3</td><td>14:30</td><td>14:32</td><td>14:37</td></tr></table>
    <div style="text-align:right">${M(2)}<span class="me hlb" style="display:inline-block">2号車は車検で使えない。タナカさんは1号車にして</span></div>
    <div>2号車の3名を1号車と3号車に移し、時刻を計算し直しました。…</div></div>`, 'auto'),
  ['<b>「今日の送迎」「水曜のお迎えを見せて」</b> → スプレッドシートの送迎表と同じ表が出る', '<b>「2号車は使えない」「○○さん休み」「○○さんを1号車に」</b> → Gemが組み替えて、時刻を出し直す'],
  'Gemで組み替えた結果は、そのチャットの中だけのものです。印刷する正式な送迎表にしたいときは、手順9の黄色い欄に書きます。<br>名簿を直したあとは、Gemでは <b>新しいチャット</b> で聞いてください。'));

// 8 共有
pages.push(page(8, '船井に共有する（編集者）',
  'スプレッドシートとGemのオーナーは <b>事業所のアカウント</b> のままにし、船井を <b>編集者</b> として追加します。',
  `<div style="display:flex;gap:14px">` +
  W('スプレッドシート', `<div style="text-align:right;padding:10px">${M(1)}<span class="btn pri hl">共有</span></div>
    <div style="margin:0 14px;border:1px solid #dde1e6;border-radius:10px;padding:14px;font-size:14px">
      <div style="font-weight:700;margin-bottom:8px">「設定シート」を共有</div>
      <div>${M(2)}</div><div class="field hlb">funai-tantou@example.co.jp</div>
      <div style="text-align:right">${M(3)}<span class="btn sec hl">編集者 ▾</span></div>
      <div style="text-align:right;margin-top:10px"><span class="btn pri hl">送信</span></div></div>`, 330) +
  W('Gemini ─ Gem マネージャー', `<div style="padding:14px;font-size:14px">
      <div class="file" style="border:1px solid #eee;border-radius:8px">送迎配車アシスタント<span style="margin-left:auto" class="hl">共有</span>${M(4)}</div>
      <div style="border:1px solid #dde1e6;border-radius:10px;padding:14px;margin-top:12px">
      <div class="field hlb">funai-tantou@example.co.jp</div>
      <div style="text-align:right"><span class="btn sec hl">編集者 ▾</span></div></div></div>`, 330) + `</div>`,
  ['スプレッドシート右上の <b>共有</b>', '船井担当者のメールアドレスを入れる', '役割を <b>編集者</b> にして <b>送信</b>', 'Gem マネージャーで「送迎配車アシスタント」の <b>共有</b> → 同じく <b>編集者</b> で追加'],
  'オーナーを職員個人や船井のアカウントにしないでください。そのアカウントが無くなると、スプレッドシート・Gem・送迎データがまとめて使えなくなります。'));

// 9 毎日
pages.push(page(9, '毎日の使い方（送迎表シートの黄色い欄）',
  '正式な送迎表（印刷用）は「○曜の送迎表」シートです。その日だけの変更は、上の黄色い欄に書きます。',
  W('水曜の送迎表', `<div style="padding:10px"><div style="font-size:18px;font-weight:700;margin:2px 0 4px">水曜日の送迎表</div><div style="font-size:13px;color:#888;margin-bottom:8px">黄色い欄に書くと、数十秒でこの曜日を組み直します。その日が終わったら消してください。</div>` + grid([3, 4, 5, 6], ['A', 'B', 'C', 'D'], [
    [{}, { t: '使わない車' }, { t: '2号車 ' + M(1), cls: 'y hl' }, { t: '例）シエンタ２号' }],
    [{}, { t: 'お休みの方' }, { t: 'ヤマダ ' + M(2), cls: 'y hl' }, { t: '名前の一部でよい' }],
    [{}, { t: '別案で送迎する方' }, { t: '', cls: 'y' }, { t: 'クラブ活動あり など' }],
    [{}, { t: '車の固定' }, { t: 'サトウ→1号車 ' + M(3), cls: 'y hl' }, { t: '(お迎え) を付けると片道だけ' }]
  ], [40, 140, 220, 260]) + `
    <div style="margin-top:14px;background:#1f3a93;color:#fff;padding:6px 10px;font-weight:700;border-radius:4px">■■ お迎え②（14:10〜15:00）11名</div>
    <div style="color:#c00;margin:6px 0">⚠ 2号車 を外して組んでいます</div>
    <div style="background:#e8f0fb;padding:5px 10px;font-weight:700">■ 1号車（定員7名）</div>
    <div style="font-size:13px;padding:4px 10px;color:#555">事業所出発 13:54 → 帰着 15:29 …</div></div>`, 'auto'),
  ['<b>使わない車</b>：車検・故障などの車の名前', '<b>お休みの方</b>：欠席の方の名前', '<b>車の固定</b>：「サトウ→1号車」のように、乗せたい車を決める'],
  '書くと数十秒でその曜日が組み直され、Gem用データも書き直されます。<b>その日が終わったら消してください</b>（残すと翌週も外れたままです）。<br>名簿（住所・曜日・時刻）が変わったら②を直すだけ。1時間以内に反映されます。'));

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5 });
  for (let i = 0; i < pages.length; i++) {
    await p.setContent(pages[i]);
    await p.waitForTimeout(150);
    const el = await p.$('.page');
    await el.screenshot({ path: `${OUT}/手順${i + 1}.png` });
  }
  await b.close();
  console.log('made', pages.length);
})();
