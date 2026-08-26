/* =========================================================================
 * ui.js — 共通ユーティリティ(DOM生成・日付・トースト・確認ダイアログ)
 * ========================================================================= */
window.UI = (function () {
  'use strict';

  /* ---- DOM ------------------------------------------------------------- */
  function h(tag, attrs, children) {
    const el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') {
          el.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === 'value') el.value = v;
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    (Array.isArray(children) ? children : children != null ? [children] : [])
      .forEach(function (c) {
        if (c === null || c === undefined || c === false) return;
        el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
      });
    return el;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* ---- 日付・月齢 ------------------------------------------------------- */
  function today() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
           String(d.getDate()).padStart(2, '0');
  }

  /** 生年月日と基準日から満月齢を返す(基準日が未来でなければ0以上) */
  function ageInMonths(birth, at) {
    if (!birth) return null;
    const b = new Date(birth), t = new Date(at || today());
    if (isNaN(b) || isNaN(t)) return null;
    let m = (t.getFullYear() - b.getFullYear()) * 12 + (t.getMonth() - b.getMonth());
    if (t.getDate() < b.getDate()) m -= 1;
    return m < 0 ? null : m;
  }

  /** 月齢を「◯歳◯か月」に */
  function ageText(months) {
    if (months === null || months === undefined) return '—';
    const y = Math.floor(months / 12), m = Math.round(months % 12);
    return y + '歳' + m + 'か月';
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  /** iso日付に月数を足す(次回モニタリング予定日の算出などに使う) */
  function addMonths(iso, n) {
    const d = new Date(iso || today());
    if (isNaN(d)) return '';
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    // 月末調整(1/31 + 1か月 → 2/28 など)
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
           String(d.getDate()).padStart(2, '0');
  }

  /* ---- 通知・確認 ------------------------------------------------------- */
  let toastTimer = null;
  function toast(msg, kind) {
    let box = $('#toast');
    if (!box) {
      box = h('div', { id: 'toast', class: 'toast' });
      document.body.appendChild(box);
    }
    box.textContent = msg;
    box.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.className = 'toast'; }, 2600);
  }

  function confirmDanger(message) { return window.confirm(message); }

  /* ---- フォーム部品 ----------------------------------------------------- */
  function field(label, control, hint) {
    return h('label', { class: 'field' }, [
      h('span', { class: 'field-label' }, label),
      control,
      hint ? h('span', { class: 'field-hint' }, hint) : null
    ]);
  }

  function input(name, value, opts) {
    return h('input', Object.assign({ type: 'text', name: name, value: value || '' }, opts || {}));
  }

  function textarea(name, value, rows, placeholder) {
    return h('textarea', { name: name, rows: rows || 3, placeholder: placeholder || '' }, value || '');
  }

  function select(name, options, value, opts) {
    const sel = h('select', Object.assign({ name: name }, opts || {}));
    options.forEach(function (o) {
      const val = typeof o === 'object' ? o.value : o;
      const lab = typeof o === 'object' ? o.label : o;
      sel.appendChild(h('option', { value: val, selected: String(val) === String(value) }, lab));
    });
    return sel;
  }

  /** フォーム要素から name→値 のオブジェクトを取り出す */
  function readForm(form) {
    const out = {};
    $$('input,select,textarea', form).forEach(function (el) {
      if (!el.name) return;
      if (el.type === 'checkbox') {
        if (out[el.name] === undefined) out[el.name] = [];
        if (el.checked) out[el.name].push(el.value);
      } else if (el.type === 'radio') {
        if (el.checked) out[el.name] = el.value;
      } else {
        out[el.name] = el.value;
      }
    });
    return out;
  }

  /* ---- ファイル --------------------------------------------------------- */
  function download(filename, text, mime) {
    const blob = new Blob([text], { type: (mime || 'application/json') + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 0);
  }

  return {
    h: h, esc: esc, clear: clear, $: $, $$: $$,
    today: today, ageInMonths: ageInMonths, ageText: ageText, fmtDate: fmtDate, addMonths: addMonths,
    toast: toast, confirmDanger: confirmDanger,
    field: field, input: input, textarea: textarea, select: select, readForm: readForm,
    download: download
  };
})();
