/* =========================================================================
 * ui.js — 共通UI部品と表示ユーティリティ
 * ========================================================================= */
var UI = (function () {

  /* ---------- 文字列処理（XSS対策：innerHTML へ渡す値は必ず esc） ---------- */
  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function yen(n) {
    var v = Number(String(n == null ? 0 : n).replace(/[^\d.-]/g, '')) || 0;
    return '¥' + v.toLocaleString('ja-JP');
  }
  function num(n) { return (Number(n) || 0).toLocaleString('ja-JP'); }

  /* ---------- 日付（和暦トグル対応） ---------- */
  var ERA = [{ name: '令和', start: new Date(2019, 4, 1) }, { name: '平成', start: new Date(1989, 0, 8) }, { name: '昭和', start: new Date(1926, 11, 25) }];
  function useWareki() { return DB.lsGet('wareki', false); }
  function setWareki(v) { DB.lsSet('wareki', !!v); }
  function fmtDate(v) {
    if (!v) return '—';
    var d = new Date(v); if (isNaN(d)) return String(v);
    if (!useWareki()) return d.getFullYear() + '/' + p2(d.getMonth() + 1) + '/' + p2(d.getDate());
    for (var i = 0; i < ERA.length; i++) {
      if (d >= ERA[i].start) {
        var y = d.getFullYear() - ERA[i].start.getFullYear() + 1;
        return ERA[i].name + (y === 1 ? '元' : y) + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
      }
    }
    return d.getFullYear() + '/' + p2(d.getMonth() + 1) + '/' + p2(d.getDate());
  }
  function fmtDateTime(v) {
    if (!v) return '—';
    var d = new Date(v); if (isNaN(d)) return String(v);
    return fmtDate(v) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  }
  function p2(n) { return ('0' + n).slice(-2); }
  function relTime(v) {
    if (!v) return '';
    var diff = Date.now() - new Date(v).getTime();
    var m = Math.floor(diff / 60000);
    if (m < 1) return 'たった今'; if (m < 60) return m + '分前';
    var h = Math.floor(m / 60); if (h < 24) return h + '時間前';
    var d = Math.floor(h / 24); if (d < 31) return d + '日前';
    return fmtDate(v);
  }

  /* ---------- バッジ ---------- */
  function statusBadge(s) {
    var m = {};
    m[CFG.STATUS.DRAFT] = 'b-draft'; m[CFG.STATUS.ACTIVE] = 'b-progress';
    m[CFG.STATUS.APPROVED] = 'b-approved'; m[CFG.STATUS.REJECTED] = 'b-rejected';
    m[CFG.STATUS.SENTBACK] = 'b-sentback'; m[CFG.STATUS.CANCELED] = 'b-canceled';
    return '<span class="badge ' + (m[s] || 'b-draft') + '">' + esc(s) + '</span>';
  }
  function sensBadge(code) {
    var s = CFG.ACCESS.SENSITIVITY[code] || 'C';
    var cls = s === 'S' ? 'b-rejected' : s === 'A' ? 'b-sentback' : s === 'B' ? 'b-progress' : 'b-draft';
    return '<span class="badge ' + cls + '" title="機微度">' + s + '</span>';
  }

  /* ---------- トースト ---------- */
  function toast(msg, kind) {
    var root = document.getElementById('toastRoot');
    var el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(function () { el.style.opacity = '0'; el.style.transition = '.3s'; setTimeout(function () { el.remove(); }, 300); }, 3200);
  }

  /* ---------- モーダル ---------- */
  var lastFocus = null;
  function modal(opts) {
    close();
    lastFocus = document.activeElement;
    var root = document.getElementById('modalRoot');
    var scrim = document.createElement('div'); scrim.className = 'scrim'; scrim.dataset.close = '1';
    var box = document.createElement('div'); box.className = 'modal'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
    box.innerHTML =
      '<div class="modal-head">' + esc(opts.title) + '</div>' +
      '<div class="modal-body">' + (opts.bodyHtml || '') + '</div>' +
      '<div class="modal-foot">' +
      '<button class="btn" data-act="cancel">' + esc(opts.cancelText || 'キャンセル') + '</button>' +
      (opts.okText ? '<button class="btn ' + (opts.okClass || 'btn-primary') + '" data-act="ok">' + esc(opts.okText) + '</button>' : '') +
      '</div>';
    root.appendChild(scrim); root.appendChild(box);
    function onKey(e) { if (e.key === 'Escape') { close(); } }
    document.addEventListener('keydown', onKey);
    box._onKey = onKey;
    scrim.addEventListener('click', close);
    box.querySelector('[data-act="cancel"]').addEventListener('click', function () { if (opts.onCancel) opts.onCancel(); close(); });
    var ok = box.querySelector('[data-act="ok"]');
    if (ok) ok.addEventListener('click', function () { if (opts.onOk) { if (opts.onOk(box) === false) return; } close(); });
    var f = box.querySelector('input,textarea,select,button[data-act="ok"]'); if (f) f.focus();
    return box;
  }
  function close() {
    var root = document.getElementById('modalRoot');
    var box = root.querySelector('.modal');
    if (box && box._onKey) document.removeEventListener('keydown', box._onKey);
    root.innerHTML = '';
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) { } }
  }
  function confirmBox(title, message, okText, okClass) {
    return new Promise(function (resolve) {
      modal({
        title: title, bodyHtml: '<div>' + esc(message) + '</div>', okText: okText || 'OK', okClass: okClass,
        onOk: function () { resolve(true); }, onCancel: function () { resolve(false); }
      });
    });
  }

  /* ---------- ドロワー ---------- */
  function drawer(title, bodyHtml, footHtml, onClose, onPrint) {
    closeDrawer();
    var root = document.getElementById('drawerRoot');
    var scrim = document.createElement('div'); scrim.className = 'scrim';
    var el = document.createElement('div'); el.className = 'drawer'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    el.innerHTML =
      '<div class="drawer-head"><strong style="flex:1">' + esc(title) + '</strong>' +
      '<button class="btn btn-sm no-print" data-act="print">🖨 印刷</button>' +
      '<button class="icon-btn" data-act="x" aria-label="閉じる">✕</button></div>' +
      '<div class="drawer-body">' + bodyHtml + '</div>' +
      (footHtml ? '<div class="drawer-foot">' + footHtml + '</div>' : '');
    root.appendChild(scrim); root.appendChild(el);
    el._onClose = onClose;
    function shut() { closeDrawer(); }
    scrim.addEventListener('click', shut);
    el.querySelector('[data-act="x"]').addEventListener('click', shut);
    /* 紙は最も基本的な持ち出し経路なので必ず記録する。
       印刷ボタンからの window.print() も beforeprint を発火させるため、
       記録は beforeprint に一本化して二重計上を防ぐ。 */
    if (onPrint) {
      var lastPrintAt = 0;
      el._onBeforePrint = function () {
        var now = Date.now();
        if (now - lastPrintAt < 1500) return;   // 同じ印刷操作で2回数えない
        lastPrintAt = now;
        try { onPrint(); } catch (e) { console.warn('印刷の記録に失敗', e); }
      };
      window.addEventListener('beforeprint', el._onBeforePrint);
    }
    el.querySelector('[data-act="print"]').addEventListener('click', function () { window.print(); });
    function onKey(e) { if (e.key === 'Escape' && !document.querySelector('.modal')) shut(); }
    document.addEventListener('keydown', onKey); el._onKey = onKey;
    return el;
  }
  function closeDrawer(skipCallback) {
    var root = document.getElementById('drawerRoot');
    var el = root.querySelector('.drawer');
    if (el) {
      if (el._onKey) document.removeEventListener('keydown', el._onKey);
      if (el._onBeforePrint) window.removeEventListener('beforeprint', el._onBeforePrint);
      /* 画面遷移やブラウザバックで閉じられた場合も滞在時間を残す */
      if (!skipCallback && el._onClose) { try { el._onClose(); } catch (e) { } }
    }
    root.innerHTML = '';
  }

  /* ---------- 空状態・スケルトン ---------- */
  function empty(icon, title, desc, actionHtml) {
    return '<div class="empty"><div class="em-ico">' + esc(icon) + '</div><div class="em-title">' + esc(title) + '</div>' +
      '<div class="em-desc">' + esc(desc || '') + '</div>' + (actionHtml ? '<div style="margin-top:14px">' + actionHtml + '</div>' : '') + '</div>';
  }
  function skeleton(rows) {
    var h = '';
    for (var i = 0; i < (rows || 6); i++) h += '<div class="skeleton" style="margin:10px 0;width:' + (60 + (i * 7) % 40) + '%"></div>';
    return '<div class="card"><div class="card-body">' + h + '</div></div>';
  }

  /* ---------- SVG グラフ（外部ライブラリ不使用） ---------- */
  var PALETTE = ['#2563eb', '#0891b2', '#16a34a', '#d97706', '#7c3aed', '#dc2626', '#0f766e', '#be185d'];
  function barChart(data, opt) {
    opt = opt || {};
    var w = 100, h = opt.height || 150, pad = 18;
    var max = Math.max.apply(null, data.map(function (d) { return d.value; }).concat([1]));
    var bw = data.length ? (w - pad) / data.length : 0;
    var bars = data.map(function (d, i) {
      var bh = (h - 30) * (d.value / max);
      var x = pad + i * bw + bw * 0.18, y = h - 22 - bh;
      return '<rect x="' + x.toFixed(2) + '" y="' + y.toFixed(2) + '" width="' + (bw * 0.64).toFixed(2) + '" height="' + Math.max(bh, .6).toFixed(2) +
        '" rx="1" fill="' + (opt.color || PALETTE[0]) + '" opacity="' + (0.55 + 0.45 * (d.value / max)).toFixed(2) + '"><title>' + esc(d.label) + '：' + num(d.value) + '</title></rect>' +
        '<text x="' + (x + bw * 0.32).toFixed(2) + '" y="' + (h - 8) + '" text-anchor="middle" style="font-size:3.4px">' + esc(d.label) + '</text>' +
        '<text x="' + (x + bw * 0.32).toFixed(2) + '" y="' + (y - 2).toFixed(2) + '" text-anchor="middle" style="font-size:3.4px">' + num(d.value) + '</text>';
    }).join('');
    return '<svg class="chart" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" role="img" aria-label="棒グラフ">' +
      '<line x1="' + pad + '" y1="' + (h - 22) + '" x2="' + w + '" y2="' + (h - 22) + '" stroke="currentColor" opacity=".18" stroke-width=".4"/>' + bars + '</svg>';
  }
  function donut(data) {
    var total = data.reduce(function (a, b) { return a + b.value; }, 0) || 1;
    var cx = 50, cy = 50, r = 34, sw = 16, acc = 0;
    var segs = data.map(function (d, i) {
      var frac = d.value / total, C = 2 * Math.PI * r;
      var seg = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + PALETTE[i % PALETTE.length] + '" stroke-width="' + sw +
        '" stroke-dasharray="' + (C * frac).toFixed(2) + ' ' + (C * (1 - frac)).toFixed(2) + '" stroke-dashoffset="' + (-C * acc).toFixed(2) +
        '" transform="rotate(-90 ' + cx + ' ' + cy + ')"><title>' + esc(d.label) + '：' + num(d.value) + '件</title></circle>';
      acc += frac; return seg;
    }).join('');
    var legend = data.map(function (d, i) {
      return '<span><i style="background:' + PALETTE[i % PALETTE.length] + '"></i>' + esc(d.label) + ' ' + num(d.value) + '</span>';
    }).join('');
    return '<svg class="chart" viewBox="0 0 100 100" style="max-height:170px" role="img" aria-label="構成比">' + segs +
      '<text x="50" y="49" text-anchor="middle" style="font-size:9px;font-weight:700" fill="currentColor">' + num(total) + '</text>' +
      '<text x="50" y="58" text-anchor="middle" style="font-size:4.5px">件</text></svg><div class="legend">' + legend + '</div>';
  }
  function sparkline(values, color) {
    if (!values.length) return '';
    var max = Math.max.apply(null, values) || 1, w = 100, h = 26;
    var pts = values.map(function (v, i) { return (i * w / (values.length - 1 || 1)).toFixed(1) + ',' + (h - (v / max) * (h - 4) - 2).toFixed(1); }).join(' ');
    return '<svg class="chart" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" style="height:26px"><polyline points="' + pts + '" fill="none" stroke="' + (color || PALETTE[0]) + '" stroke-width="1.4"/></svg>';
  }

  /* ---------- 印影 ---------- */
  function hanko(name, stamped) {
    var chars = String(name || '').replace(/\s/g, '').slice(0, 3);
    return '<div class="hanko' + (stamped ? ' hanko-stamp' : '') + '" title="' + esc(name) + '"><span>' + esc(chars) + '</span></div>';
  }

  /* ---------- CSV（BOM付きUTF-8：Excelで文字化けしない） ---------- */
  function toCSV(headers, rows) {
    function cell(v) {
      var s = (v == null ? '' : String(v));
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    return headers.map(cell).join(',') + '\r\n' + rows.map(function (r) { return r.map(cell).join(','); }).join('\r\n');
  }
  function download(filename, text) {
    var blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  /* ---------- 入力補助 ---------- */
  function bindMoneyInputs(scope) {
    (scope || document).querySelectorAll('input[data-money]').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var caretEnd = inp.selectionStart === inp.value.length;
        var v = inp.value.replace(/[^\d]/g, '');
        inp.value = v ? Number(v).toLocaleString('ja-JP') : '';
        if (caretEnd) { try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (e) { } }
      });
    });
  }
  /* 数値の解釈は RouteSpec.num に一本化する。
     独自実装を残すと「30万円」が 30 になるなど、画面と出力で金額が食い違う。 */
  function rawNum(v) { return (typeof RouteSpec !== 'undefined') ? RouteSpec.num(v) : (Number(String(v == null ? '' : v).replace(/[^\d.-]/g, '')) || 0); }

  return {
    esc: esc, yen: yen, num: num, fmtDate: fmtDate, fmtDateTime: fmtDateTime, relTime: relTime,
    statusBadge: statusBadge, sensBadge: sensBadge, toast: toast, modal: modal, closeModal: close,
    confirmBox: confirmBox, drawer: drawer, closeDrawer: closeDrawer, empty: empty, skeleton: skeleton,
    barChart: barChart, donut: donut, sparkline: sparkline, hanko: hanko, toCSV: toCSV, download: download,
    bindMoneyInputs: bindMoneyInputs, rawNum: rawNum, useWareki: useWareki, setWareki: setWareki, PALETTE: PALETTE
  };
})();
