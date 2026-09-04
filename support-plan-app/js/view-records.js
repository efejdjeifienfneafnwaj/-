/* =========================================================================
 * view-records.js — 記録・文字起こし
 *   面談や観察の記録を児童ごとに蓄積する。
 *   ブラウザの音声入力(対応環境のみ)で口述をそのまま本文に流し込める。
 * ========================================================================= */
window.ViewRecords = (function () {
  'use strict';
  const h = UI.h;

  let editing = null;
  let keyword = '';

  function render(root, child) {
    if (editing) { renderEditor(root, child); return; }

    const all = Store.byChild('records', child.id).slice().sort(function (a, b) {
      return String(b.date).localeCompare(String(a.date));
    });
    const kw = keyword.trim();
    const records = kw ? all.filter(function (r) {
      return (r.title + ' ' + r.body + ' ' + (r.kind || '') + ' ' + (r.attendees || ''))
        .toLowerCase().indexOf(kw.toLowerCase()) >= 0;
    }) : all;

    root.appendChild(h('div', { class: 'page-head' }, [
      h('div', {}, [
        h('h1', {}, '記録・文字起こし'),
        h('p', { class: 'muted' }, '面談や観察の記録を、児童ごとに残しておく場所です。アセスメントや計画を書くときの材料になります。')
      ]),
      h('button', { class: 'btn primary', onclick: function () { startNew(child); } }, '＋ 記録を追加')
    ]));

    root.appendChild(h('div', { class: 'panel' }, [
      h('div', { class: 'search-row' }, [
        UI.input('kw', keyword, {
          placeholder: '本文・タイトル・種別からさがす', class: 'search',
          oninput: function (e) { keyword = e.target.value; renderListOnly(root, child); }
        }),
        h('span', { class: 'muted' }, all.length + '件中 ' + records.length + '件')
      ]),
      buildList(records, child)
    ]));
  }

  function renderListOnly(root, child) {
    // 検索のたびに全画面を作り直すと入力欄のカーソルが飛ぶので、一覧だけ差し替える
    const all = Store.byChild('records', child.id).slice().sort(function (a, b) {
      return String(b.date).localeCompare(String(a.date));
    });
    const kw = keyword.trim();
    const records = kw ? all.filter(function (r) {
      return (r.title + ' ' + r.body + ' ' + (r.kind || '') + ' ' + (r.attendees || ''))
        .toLowerCase().indexOf(kw.toLowerCase()) >= 0;
    }) : all;
    const old = UI.$('.record-list', root);
    if (old) old.replaceWith(buildList(records, child));
    const counter = UI.$('.search-row .muted', root);
    if (counter) counter.textContent = all.length + '件中 ' + records.length + '件';
  }

  function buildList(records, child) {
    const list = h('div', { class: 'record-list' });
    if (!records.length) {
      list.appendChild(h('p', { class: 'muted pad' }, '該当する記録がありません。'));
      return list;
    }
    records.forEach(function (r) {
      const preview = String(r.body || '').slice(0, 160);
      list.appendChild(h('div', { class: 'record-item' }, [
        h('div', { class: 'record-main' }, [
          h('div', { class: 'record-title' }, [
            UI.fmtDate(r.date) + '　' + (r.title || '(表題なし)'),
            r.kind ? h('span', { class: 'tag' }, r.kind) : null
          ]),
          r.attendees ? h('div', { class: 'record-meta' }, h('span', {}, '出席・話者: ' + r.attendees)) : null,
          h('p', { class: 'record-body' }, preview + (String(r.body || '').length > 160 ? '…' : ''))
        ]),
        h('div', { class: 'record-actions' }, [
          h('button', { class: 'btn small', onclick: function () { editing = JSON.parse(JSON.stringify(r)); App.render(); } }, '開く'),
          h('button', { class: 'btn small', onclick: function () { Print.record(child, r); } }, '印刷'),
          h('button', { class: 'btn small danger ghost', onclick: function () {
            if (!UI.confirmDanger('この記録を削除します。元に戻せません。')) return;
            Store.remove('records', r.id); UI.toast('削除しました'); App.render();
          } }, '削除')
        ])
      ]));
    });
    return list;
  }

  function startNew(child) {
    editing = {
      childId: child.id, date: UI.today(), kind: DATA.RECORD_KINDS[0],
      title: '', attendees: '', body: '', summary: ''
    };
    App.render();
  }

  /* ---- 編集 -------------------------------------------------------------- */
  function renderEditor(root, child) {
    const form = h('form', { onsubmit: function (e) { e.preventDefault(); } });

    root.appendChild(h('div', { class: 'page-head' }, [
      h('div', {}, [
        h('h1', {}, editing.id ? '記録の編集' : '記録の追加'),
        h('p', { class: 'muted' }, child.name)
      ]),
      h('div', { class: 'btn-row' }, [
        h('button', { class: 'btn', type: 'button', onclick: function () { stopRecog(); editing = null; App.render(); } }, 'キャンセル'),
        h('button', { class: 'btn primary', type: 'button', onclick: function () { save(form, child); } }, '保存する')
      ])
    ]));

    const body = UI.textarea('body', editing.body, 20,
      '面談や観察の内容をそのまま書き起こします。\n\n例:\n母:　最近、家でも「かして」が言えるようになってきました。\n支援者:　事業所でも、おもちゃの貸し借りの場面で増えています。');
    body.classList.add('transcript');

    form.appendChild(h('div', { class: 'panel' }, [
      h('div', { class: 'form-grid' }, [
        UI.field('日付', UI.input('date', editing.date, { type: 'date' })),
        UI.field('種別', UI.select('kind', DATA.RECORD_KINDS, editing.kind)),
        UI.field('表題', UI.input('title', editing.title, { placeholder: '例: 半年モニタリング面談' })),
        UI.field('出席者・話者', UI.input('attendees', editing.attendees, { placeholder: '例: 母、児発管(山田)' }))
      ])
    ]));

    form.appendChild(h('div', { class: 'panel' }, [
      h('div', { class: 'panel-head' }, [
        h('h2', {}, '本文(文字起こし)'),
        h('div', { class: 'btn-row' }, [
          speechButton(body),
          h('button', { class: 'btn small', type: 'button', onclick: function () { insertSpeaker(body); } }, '話者行を挿入'),
          h('button', { class: 'btn small ghost', type: 'button', onclick: function () { insertStamp(body); } }, '時刻を挿入')
        ])
      ]),
      body,
      h('p', { class: 'note' }, '長い面談は、話者ごとに行を分けておくと後から読み返しやすくなります。'),
      (function () {
        const f = UI.field('要点(計画やアセスメントに引用したい部分)',
          UI.textarea('summary', editing.summary, 4, '例: 家庭でも要求を言葉で伝える場面が増えている / 就学に向けた不安が強い'));
        f.classList.add('wide');
        return f;
      })()
    ]));

    form.appendChild(h('div', { class: 'btn-row end' }, [
      h('button', { class: 'btn', type: 'button', onclick: function () { stopRecog(); editing = null; App.render(); } }, 'キャンセル'),
      h('button', { class: 'btn primary', type: 'button', onclick: function () { save(form, child); } }, '保存する')
    ]));

    root.appendChild(form);
  }

  /* ---- 補助ボタン -------------------------------------------------------- */
  function insertSpeaker(ta) {
    const name = window.prompt('話者名を入れてください(例: 母、本人、支援者)', '母');
    if (name === null) return;
    insertAtCursor(ta, (ta.value && !/\n$/.test(ta.value) ? '\n' : '') + name + ': ');
  }

  function insertStamp(ta) {
    const d = new Date();
    const t = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    insertAtCursor(ta, (ta.value && !/\n$/.test(ta.value) ? '\n' : '') + '[' + t + '] ');
  }

  function insertAtCursor(ta, text) {
    const s = ta.selectionStart, e = ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
    ta.selectionStart = ta.selectionEnd = s + text.length;
    ta.focus();
  }

  /* ---- 音声入力 ----------------------------------------------------------
   * 実処理は voice.js に集約している(同意の確認・再接続・エラー表示も含む)。
   * ---------------------------------------------------------------------- */
  function speechButton(ta) {
    const btn = Voice.micButton(ta, '🎤 音声で書き起こす');
    btn.classList.add('btn', 'small');
    btn.classList.remove('mic-btn');
    return btn;
  }

  function stopRecog() { Voice.stop(); }

  /* ---- 保存 -------------------------------------------------------------- */
  function save(form, child) {
    stopRecog();
    const data = UI.readForm(form);
    const obj = Object.assign({}, editing, data, { childId: child.id });
    if (!obj.title.trim() && !obj.body.trim()) {
      UI.toast('表題か本文を入力してください', 'warn');
      return;
    }
    Store.put('records', obj);
    editing = null;
    UI.toast('記録を保存しました');
    App.render();
  }

  function reset() { stopRecog(); editing = null; keyword = ''; }

  return { render: render, reset: reset };
})();
