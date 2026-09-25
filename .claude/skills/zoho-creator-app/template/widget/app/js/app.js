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
