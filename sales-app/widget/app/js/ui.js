/* =========================================================================
 * ui.js — 画面部品（エスケープ・トースト・モーダル・入力欄）
 *
 * alert() / confirm() は使わない。Creator の iframe の設定によっては
 * ダイアログが出ないことがあるため、メッセージは画面の中に出す。
 * ========================================================================= */
var UI = (function () {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- トースト ---------- */
  var toastTimer = null;
  function toast(msg, kind) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, kind === 'error' ? 7000 : 2800);
  }

  /* ---------- モーダル ----------
     opts.onSubmit(values, form) は Promise を返す。失敗（reject / throw）なら
     メッセージをモーダル内に出して開いたままにする */
  var lastFocus = null, busy = false;
  function openModal(title, bodyHtml, opts) {
    opts = opts || {};
    lastFocus = document.activeElement;
    var root = document.getElementById('modal');
    root.innerHTML =
      '<div class="modal-backdrop">' +
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">' +
      '<div class="modal-head"><h2 id="modal-title">' + esc(title) + '</h2>' +
      '<button type="button" class="icon-btn" data-close aria-label="閉じる">×</button></div>' +
      '<form id="modal-form" novalidate>' + bodyHtml +
      '<p class="form-error" id="modal-error" role="alert" hidden></p>' +
      '<div class="modal-foot">' +
      '<button type="button" class="btn" data-close>キャンセル</button>' +
      (opts.onSubmit ? '<button type="submit" class="btn btn-primary" id="modal-submit">' + esc(opts.submitLabel || '保存') + '</button>' : '') +
      '</div></form>' + (opts.footHtml || '') + '</div></div>';

    var backdrop = root.firstChild, form = document.getElementById('modal-form');
    var downOnBackdrop = false;
    backdrop.addEventListener('mousedown', function (e) { downOnBackdrop = (e.target === backdrop); });
    backdrop.addEventListener('click', function (e) {
      if (busy) return;
      if (e.target === backdrop && downOnBackdrop) closeModal();
      else if (e.target.closest('[data-close]')) closeModal();
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (busy || !opts.onSubmit) return;
      var errEl = document.getElementById('modal-error'), btn = document.getElementById('modal-submit');
      errEl.hidden = true;
      busy = true; btn.disabled = true; btn.textContent = '保存中…';
      Promise.resolve().then(function () { return opts.onSubmit(values(form), form); }).then(function () {
        busy = false; closeModal();
      }, function (err) {
        busy = false; btn.disabled = false; btn.textContent = opts.submitLabel || '保存';
        errEl.textContent = (err && err.userMessage) || ('保存できませんでした：' + DB.errText(err));
        errEl.hidden = false;
      });
    });
    if (opts.onOpen) opts.onOpen(form);
    var first = form.querySelector('input:not([type=hidden]),select,textarea');
    if (first) first.focus();
  }
  function closeModal() {
    document.getElementById('modal').innerHTML = '';
    busy = false;
    if (lastFocus && document.body.contains(lastFocus)) lastFocus.focus();
  }
  function isModalOpen() { return !!document.getElementById('modal-form'); }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isModalOpen() && !busy) closeModal();
  });

  /** 入力の誤りを利用者向けの文言で返すためのエラー */
  function userError(msg) { var e = new Error(msg); e.userMessage = msg; return e; }

  /* ---------- 入力欄 ----------
     f: { name, label, type, value, options, required, full, placeholder, hint, attrs } */
  function field(f) {
    var id = 'f_' + f.name, v = f.value == null ? '' : f.value;
    var req = f.required ? ' <span class="req" aria-hidden="true">*</span>' : '';
    var attrs = (f.required ? ' required' : '') + (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '') + (f.attrs || '');
    var ctl;
    if (f.type === 'checkbox') {
      return '<div class="field' + (f.full ? ' full' : '') + '"><label class="check"><input type="checkbox" id="' + id + '" name="' + esc(f.name) + '"' +
        (v ? ' checked' : '') + '> ' + esc(f.label) + '</label>' + (f.hint ? '<small>' + esc(f.hint) + '</small>' : '') + '</div>';
    }
    if (f.type === 'textarea') {
      ctl = '<textarea id="' + id + '" name="' + esc(f.name) + '" rows="3"' + attrs + '>' + esc(v) + '</textarea>';
    } else if (f.type === 'select') {
      ctl = '<select id="' + id + '" name="' + esc(f.name) + '"' + attrs + '>' + options(f.options, v) + '</select>';
    } else {
      ctl = '<input id="' + id + '" name="' + esc(f.name) + '" type="' + (f.type || 'text') + '" value="' + esc(v) + '"' +
        (f.type === 'text' || !f.type ? ' maxlength="255"' : '') + attrs + '>';
    }
    return '<div class="field' + (f.full ? ' full' : '') + '"><label for="' + id + '">' + esc(f.label) + req + '</label>' + ctl +
      (f.hint ? '<small>' + esc(f.hint) + '</small>' : '') + '</div>';
  }
  function options(list, selected) {
    return (list || []).map(function (o) {
      var val = (typeof o === 'object') ? o.value : o, lab = (typeof o === 'object') ? o.label : o;
      return '<option value="' + esc(val) + '"' + (String(val) === String(selected) ? ' selected' : '') + '>' + esc(lab) + '</option>';
    }).join('');
  }
  function values(form) {
    var out = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name) return;
      out[el.name] = (el.type === 'checkbox') ? el.checked : String(el.value).trim();
    });
    return out;
  }

  return {
    esc: esc, toast: toast, openModal: openModal, closeModal: closeModal, isModalOpen: isModalOpen,
    field: field, options: options, values: values, userError: userError
  };
})();
