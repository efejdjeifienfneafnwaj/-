/* =========================================================================
 * view-splan.js — 専門的支援実施計画
 *   専門職(PT/OT/ST/心理担当職員等)が行う支援の計画と、その実施記録。
 *   個別支援計画とひもづけて管理する。
 * ========================================================================= */
window.ViewSplan = (function () {
  'use strict';
  const h = UI.h;

  let editing = null;

  const HEAD_FIELDS = [
    { key: 'createdDate', label: '作成日', type: 'date' },
    { key: 'staffName',   label: '担当専門職 氏名' },
    { key: 'qualification', label: '資格・経験年数', placeholder: '例: 作業療法士 / 実務8年' },
    { key: 'startDate',   label: '実施期間(開始)', type: 'date' },
    { key: 'endDate',     label: '実施期間(終了)', type: 'date' },
    { key: 'form',        label: '実施形態', options: DATA.GROUP_FORMS },
    { key: 'frequency',   label: '実施頻度', placeholder: '例: 月2回' },
    { key: 'minutes',     label: '1回あたりの時間(分)', type: 'number', placeholder: '例: 40' },
    { key: 'place',       label: '実施場所', placeholder: '例: 個別支援室' },
    { key: 'evalDate',    label: '評価(振り返り)予定日', type: 'date' }
  ];

  const TEXT_BLOCKS = [
    { key: 'reason',   label: '専門的支援を必要とする理由(アセスメント結果)', rows: 5,
      hint: '発達アセスメントや日々の観察から、専門職の関わりが必要と判断した根拠を書きます。' },
    { key: 'goal',     label: '専門的支援の目標', rows: 4 },
    { key: 'content',  label: '支援内容・具体的な方法(用いるプログラム・教材・環境設定)', rows: 6 },
    { key: 'linkPlan', label: '個別支援計画との関連(どの領域・目標に対応するか)', rows: 3 },
    { key: 'share',    label: '他職員への引き継ぎ・日常場面への般化の方法', rows: 4,
      hint: '専門職以外の職員が普段の活動の中でどう関わるかを書いておくと、支援が続きます。' },
    { key: 'evalMethod', label: '評価方法・評価の視点', rows: 3 }
  ];

  /* ---- 一覧 -------------------------------------------------------------- */
  function render(root, child) {
    if (editing) { renderEditor(root, child); return; }

    const splans = Store.byChild('splans', child.id).slice().sort(function (a, b) {
      return String(b.createdDate || '').localeCompare(String(a.createdDate || ''));
    });

    root.appendChild(h('div', { class: 'page-head' }, [
      h('div', {}, [
        h('h1', {}, '専門的支援実施計画'),
        h('p', { class: 'muted' }, '理学療法士・作業療法士・言語聴覚士・心理担当職員などが行う支援の計画と実施記録です。')
      ]),
      h('button', { class: 'btn primary', onclick: function () { startNew(child); } }, '＋ 新しい計画を作成')
    ]));

    if (!splans.length) {
      root.appendChild(h('div', { class: 'empty' }, [
        h('p', {}, 'まだ専門的支援実施計画がありません。'),
        h('p', { class: 'muted' }, '個別支援計画のうち、専門職が重点的に担う部分を切り出して計画にします。')
      ]));
      return;
    }

    const list = h('div', { class: 'record-list' });
    splans.forEach(function (p) {
      const sessions = p.sessions || [];
      list.appendChild(h('div', { class: 'record-item' }, [
        h('div', { class: 'record-main' }, [
          h('div', { class: 'record-title' }, [
            UI.fmtDate(p.createdDate) + ' 作成',
            (p.professions || []).length ? h('span', { class: 'tag' }, (p.professions || []).join('・')) : null
          ]),
          h('div', { class: 'record-meta' }, [
            h('span', {}, '担当: ' + (p.staffName || '—')),
            h('span', {}, (p.form || '') + ' ' + (p.frequency || '') + (p.minutes ? ' / ' + p.minutes + '分' : '')),
            h('span', {}, '実施記録 ' + sessions.length + '回')
          ]),
          p.goal ? h('p', { class: 'record-body' }, p.goal) : null
        ]),
        h('div', { class: 'record-actions' }, [
          h('button', { class: 'btn small', onclick: function () { editing = JSON.parse(JSON.stringify(p)); App.render(); } }, '開く'),
          h('button', { class: 'btn small', onclick: function () { Print.splan(child, p); } }, '印刷'),
          h('button', { class: 'btn small danger ghost', onclick: function () {
            if (!UI.confirmDanger('この専門的支援実施計画を削除します。実施記録もいっしょに消えます。')) return;
            Store.remove('splans', p.id); UI.toast('削除しました'); App.render();
          } }, '削除')
        ])
      ]));
    });
    root.appendChild(h('div', { class: 'panel' }, list));
  }

  /* ---- 新規 -------------------------------------------------------------- */
  function startNew(child) {
    const start = UI.today();
    editing = {
      childId: child.id, createdDate: start,
      startDate: start, endDate: UI.addMonths(start, 6), evalDate: UI.addMonths(start, 6),
      form: '個別', professions: [], domains: [], sessions: []
    };
    App.render();
  }

  /* ---- 編集 -------------------------------------------------------------- */
  function renderEditor(root, child) {
    const form = h('form', { onsubmit: function (e) { e.preventDefault(); } });

    root.appendChild(h('div', { class: 'page-head' }, [
      h('div', {}, [
        h('h1', {}, '専門的支援実施計画'),
        h('p', { class: 'muted' }, child.name + '　(' + UI.ageText(UI.ageInMonths(child.birthday, UI.today())) + ')')
      ]),
      h('div', { class: 'btn-row' }, [
        h('button', { class: 'btn', type: 'button', onclick: function () { editing = null; App.render(); } }, 'キャンセル'),
        h('button', { class: 'btn voice', type: 'button', onclick: function () { voiceFill(form); } }, '🎤 音声で入力'),
        h('button', { class: 'btn primary', type: 'button', onclick: function () { save(form, child); } }, '保存する')
      ])
    ]));

    /* 専門職種・対象領域(複数選択) */
    const profBox = h('div', { class: 'check-grid' }, DATA.PROFESSIONS.map(function (p) {
      return h('label', { class: 'check' }, [
        h('input', { type: 'checkbox', name: 'professions', value: p,
          checked: (editing.professions || []).indexOf(p) >= 0 }),
        h('span', {}, p)
      ]);
    }));
    const domBox = h('div', { class: 'check-grid' }, DATA.domains.map(function (d) {
      return h('label', { class: 'check' }, [
        h('input', { type: 'checkbox', name: 'domains', value: d.id,
          checked: (editing.domains || []).indexOf(d.id) >= 0 }),
        h('span', {}, [h('span', { class: 'dot', style: 'background:' + d.color }), d.name])
      ]);
    }));

    const headGrid = h('div', { class: 'form-grid' });
    HEAD_FIELDS.forEach(function (f) {
      const ctl = f.options ? UI.select(f.key, f.options, editing[f.key])
                            : UI.input(f.key, editing[f.key], { type: f.type || 'text', placeholder: f.placeholder || '' });
      headGrid.appendChild(UI.field(f.label, ctl));
    });

    form.appendChild(h('div', { class: 'panel' }, [
      h('div', { class: 'panel-head' }, h('h2', {}, '基本事項')),
      headGrid,
      UI.field('関わる専門職種(複数選択可)', profBox),
      UI.field('重点的に支援する領域(複数選択可)', domBox)
    ]));

    /* 本文 */
    const grid = h('div', { class: 'form-grid' });
    TEXT_BLOCKS.forEach(function (f) {
      const fld = UI.field(f.label, UI.textarea(f.key, editing[f.key], f.rows), f.hint);
      fld.classList.add('wide');
      grid.appendChild(fld);
    });
    form.appendChild(h('div', { class: 'panel' }, [
      h('div', { class: 'panel-head' }, [
        h('h2', {}, '計画の内容'),
        h('button', { class: 'btn small', type: 'button', onclick: function () { fillFromAssessment(form, child); } },
          'アセスメントから理由の下書きを入れる')
      ]),
      grid
    ]));

    /* 説明と同意 */
    form.appendChild(h('div', { class: 'panel' }, [
      h('div', { class: 'panel-head' }, h('h2', {}, '説明と同意')),
      h('div', { class: 'form-grid' }, [
        UI.field('保護者へ説明した日', UI.input('explainDate', editing.explainDate, { type: 'date' })),
        UI.field('同意を得た日', UI.input('agreeDate', editing.agreeDate, { type: 'date' })),
        UI.field('説明者', UI.input('explainer', editing.explainer)),
        UI.field('同意者(保護者氏名)', UI.input('signer', editing.signer))
      ])
    ]));

    /* 実施記録 */
    form.appendChild(renderSessions(child));

    form.appendChild(h('div', { class: 'btn-row end' }, [
      h('button', { class: 'btn', type: 'button', onclick: function () { editing = null; App.render(); } }, 'キャンセル'),
      h('button', { class: 'btn primary', type: 'button', onclick: function () { save(form, child); } }, '保存する')
    ]));

    root.appendChild(form);
  }

  /* ---- 音声で入力 -------------------------------------------------------- */
  function voiceFill(form) {
    const defs = [
      { name: 'staffName', label: '担当する専門職のお名前', type: 'text' },
      { name: 'qualification', label: '資格と経験年数', hint: '例: 作業療法士 実務8年', type: 'text' },
      { name: 'frequency', label: '実施の頻度', hint: '例: 月2回', type: 'text' },
      { name: 'place', label: '実施する場所', type: 'text' }
    ];
    TEXT_BLOCKS.forEach(function (f) {
      defs.push({ name: f.key, label: f.label, hint: f.hint, type: 'textarea' });
    });
    Voice.fillForm(form, defs, '音声で専門的支援実施計画を入力');
  }

  /* ---- 実施記録 ---------------------------------------------------------- */
  function renderSessions(child) {
    const panel = h('div', { class: 'panel' }, [
      h('div', { class: 'panel-head' }, [
        h('h2', {}, '実施記録'),
        h('button', { class: 'btn small', type: 'button', onclick: function () {
          (editing.sessions = editing.sessions || []).push({
            date: UI.today(), staff: editing.staffName || '', minutes: editing.minutes || '',
            content: '', response: '', next: ''
          });
          App.render();
        } }, '＋ 実施を1件追加')
      ])
    ]);

    const sessions = editing.sessions || [];
    if (!sessions.length) {
      panel.appendChild(h('p', { class: 'muted' }, 'まだ実施記録がありません。支援を行うたびに1件ずつ追加してください。'));
      return panel;
    }

    sessions.forEach(function (s, i) {
      const grid = h('div', { class: 'form-grid' }, [
        UI.field('実施日', UI.input('s.' + i + '.date', s.date, { type: 'date' })),
        UI.field('実施者', UI.input('s.' + i + '.staff', s.staff)),
        UI.field('時間(分)', UI.input('s.' + i + '.minutes', s.minutes, { type: 'number' })),
        (function () { const f = UI.field('実施した内容', UI.textarea('s.' + i + '.content', s.content, 3)); f.classList.add('wide'); return f; })(),
        (function () { const f = UI.field('本人の様子・反応', UI.textarea('s.' + i + '.response', s.response, 3)); f.classList.add('wide'); return f; })(),
        (function () { const f = UI.field('次回に向けて', UI.textarea('s.' + i + '.next', s.next, 2)); f.classList.add('wide'); return f; })()
      ]);
      panel.appendChild(h('div', { class: 'session-block' }, [
        h('div', { class: 'session-head' }, [
          h('h3', {}, '第' + (i + 1) + '回'),
          h('button', { class: 'btn tiny danger ghost', type: 'button', onclick: function () {
            if (!UI.confirmDanger('この実施記録を削除しますか?')) return;
            editing.sessions.splice(i, 1); App.render();
          } }, '削除')
        ]),
        grid
      ]));
    });
    return panel;
  }

  /* ---- アセスメントから下書き -------------------------------------------- */
  function fillFromAssessment(form, child) {
    const hist = Assess.history(child.id);
    if (!hist.length) { UI.toast('先に発達アセスメントを記録してください', 'warn'); return; }
    const latest = hist[hist.length - 1];
    const sum = Assess.summarize(latest, child);
    // 生活年齢との差が大きい領域を優先して挙げる
    const gaps = sum.perDomain.map(function (x) {
      return { name: x.name, months: x.months, gap: (sum.chronoMonths || 0) - x.months };
    }).sort(function (a, b) { return b.gap - a.gap; });

    const lines = [UI.fmtDate(latest.date) + '実施の発達アセスメント(生活年齢 ' + UI.ageText(sum.chronoMonths) + ')より。'];
    gaps.slice(0, 3).forEach(function (g) {
      lines.push('・' + g.name + ' は発達の目安 ' + UI.ageText(g.months) +
        (g.gap > 0 ? '(生活年齢との差 約' + Math.round(g.gap) + 'か月)' : '') + '。');
    });
    if (latest.comment) lines.push('観察所見: ' + latest.comment);
    lines.push('以上から、専門職による重点的な関わりが必要と判断した。');

    const el = form.querySelector('[name="reason"]');
    if (el && !el.value.trim()) el.value = lines.join('\n');
    UI.toast('空欄に下書きを入れました。内容を確認して書き直してください。');
  }

  /* ---- 保存 -------------------------------------------------------------- */
  function save(form, child) {
    const flat = UI.readForm(form);
    const obj = Object.assign({}, editing, { childId: child.id });
    obj.sessions = (editing.sessions || []).map(function (s, i) {
      return {
        date: flat['s.' + i + '.date'] || '', staff: flat['s.' + i + '.staff'] || '',
        minutes: flat['s.' + i + '.minutes'] || '', content: flat['s.' + i + '.content'] || '',
        response: flat['s.' + i + '.response'] || '', next: flat['s.' + i + '.next'] || ''
      };
    });
    Object.keys(flat).forEach(function (k) {
      if (k.indexOf('s.') === 0) return;
      obj[k] = flat[k];
    });
    obj.professions = flat.professions || [];
    obj.domains = flat.domains || [];
    Store.put('splans', obj);
    editing = null;
    UI.toast('専門的支援実施計画を保存しました');
    App.render();
  }

  function reset() { editing = null; }

  return { render: render, reset: reset, HEAD_FIELDS: HEAD_FIELDS, TEXT_BLOCKS: TEXT_BLOCKS };
})();
