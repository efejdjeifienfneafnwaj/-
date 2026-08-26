/* =========================================================================
 * view-plan.js — 個別支援計画
 *   5領域(健康・生活/運動・感覚/認知・行動/言語・コミュニケーション/
 *   人間関係・社会性)ごとに目標と支援内容を書く様式。
 *   最新のアセスメント結果から目標のたたき台を差し込める。
 * ========================================================================= */
window.ViewPlan = (function () {
  'use strict';
  const h = UI.h;

  let editing = null;

  const HEAD_FIELDS = [
    { key: 'createdDate', label: '計画作成日', type: 'date' },
    { key: 'planNo',      label: '計画の回次', placeholder: '例: 第3期' },
    { key: 'author',      label: '計画作成者(児童発達支援管理責任者)' },
    { key: 'prevDate',    label: '前回作成日', type: 'date' },
    { key: 'startDate',   label: '支援期間(開始)', type: 'date' },
    { key: 'endDate',     label: '支援期間(終了)', type: 'date' },
    { key: 'frequency',   label: '利用予定(頻度・時間)', placeholder: '例: 週2回(火・金)14:30〜17:00' },
    { key: 'monitorDate', label: '次回モニタリング予定日', type: 'date' }
  ];

  const TEXT_BLOCKS = [
    { key: 'wishSelf',   label: '本人の希望・意向', rows: 3,
      hint: '本人が言葉で表しにくい場合は、表情・行動から読み取った様子を書きます。' },
    { key: 'wishFamily', label: 'ご家族の希望・意向', rows: 3 },
    { key: 'assessmentSummary', label: 'アセスメントのまとめ(現在の状況・強み・課題)', rows: 5 },
    { key: 'policy',     label: '総合的な支援の方針', rows: 4 }
  ];

  const GOAL_ROWS = [
    { key: 'goal',     label: '支援目標', rows: 3 },
    { key: 'support',  label: '具体的な支援内容・方法', rows: 4 },
    { key: 'period',   label: '達成時期' },
    { key: 'staff',    label: '担当者・提供機関' },
    { key: 'note',     label: '留意事項・本人の強みの活かし方', rows: 2 }
  ];

  const TAIL_BLOCKS = [
    { key: 'longGoal',    label: '長期目標(おおむね1年)', rows: 3 },
    { key: 'shortGoal',   label: '短期目標(おおむね6か月)', rows: 3 },
    { key: 'familySupport',    label: '家族支援(相談・助言、ペアレントプログラム等)', rows: 3 },
    { key: 'transitionSupport', label: '移行支援(就園・就学・進級に向けた支援)', rows: 3 },
    { key: 'cooperation', label: '関係機関との連携(園・学校・医療・相談支援)', rows: 3 },
    { key: 'careNote',    label: '支援の提供にあたっての留意事項(健康・安全面)', rows: 3 }
  ];

  /* ---- 一覧 -------------------------------------------------------------- */
  function render(root, child) {
    if (editing) { renderEditor(root, child); return; }

    const plans = Store.byChild('plans', child.id).slice().sort(function (a, b) {
      return String(b.createdDate || '').localeCompare(String(a.createdDate || ''));
    });

    root.appendChild(h('div', { class: 'page-head' }, [
      h('div', {}, [
        h('h1', {}, '個別支援計画'),
        h('p', { class: 'muted' }, '5領域ごとに目標と支援内容を整理する様式です。作成後は印刷して、説明・同意にお使いください。')
      ]),
      h('button', { class: 'btn primary', onclick: function () { startNew(child); } }, '＋ 新しい計画を作成')
    ]));

    if (!plans.length) {
      root.appendChild(h('div', { class: 'empty' }, [
        h('p', {}, 'まだ個別支援計画がありません。'),
        h('p', { class: 'muted' }, 'アセスメントを先に記録しておくと、目標のたたき台を自動で差し込めます。')
      ]));
      return;
    }

    const list = h('div', { class: 'record-list' });
    plans.forEach(function (p) {
      list.appendChild(h('div', { class: 'record-item' }, [
        h('div', { class: 'record-main' }, [
          h('div', { class: 'record-title' }, [
            (p.planNo ? p.planNo + '　' : '') + UI.fmtDate(p.createdDate) + ' 作成',
            p.agreeDate ? h('span', { class: 'tag ok' }, '同意済 ' + UI.fmtDate(p.agreeDate))
                        : h('span', { class: 'tag' }, '未同意')
          ]),
          h('div', { class: 'record-meta' }, [
            h('span', {}, '作成者: ' + (p.author || '—')),
            h('span', {}, '支援期間: ' + (p.startDate ? UI.fmtDate(p.startDate) : '—') + ' 〜 ' +
              (p.endDate ? UI.fmtDate(p.endDate) : '—')),
            p.monitorDate ? h('span', {}, '次回モニタリング: ' + UI.fmtDate(p.monitorDate)) : null
          ]),
          p.policy ? h('p', { class: 'record-body' }, p.policy) : null
        ]),
        h('div', { class: 'record-actions' }, [
          h('button', { class: 'btn small', onclick: function () { editing = JSON.parse(JSON.stringify(p)); App.render(); } }, '開く'),
          h('button', { class: 'btn small', onclick: function () { Print.plan(child, p); } }, '印刷'),
          h('button', { class: 'btn small', onclick: function () { toExcel(child, p); } }, 'Excel出力'),
          h('button', { class: 'btn small', onclick: function () {
            const copy = JSON.parse(JSON.stringify(p));
            delete copy.id; delete copy.createdAt; delete copy.updatedAt;
            copy.prevDate = p.createdDate;
            copy.createdDate = UI.today();
            copy.explainDate = ''; copy.agreeDate = ''; copy.signer = '';
            editing = copy; App.render();
            UI.toast('前回の内容を引き継いで新しい計画を作ります');
          } }, '引き継いで新規'),
          h('button', { class: 'btn small danger ghost', onclick: function () {
            if (!UI.confirmDanger('この計画を削除します。元に戻せません。')) return;
            Store.remove('plans', p.id); UI.toast('削除しました'); App.render();
          } }, '削除')
        ])
      ]));
    });
    root.appendChild(h('div', { class: 'panel' }, list));
  }

  /* ---- 新規 -------------------------------------------------------------- */
  function startNew(child) {
    const prev = Store.byChild('plans', child.id).slice().sort(function (a, b) {
      return String(b.createdDate || '').localeCompare(String(a.createdDate || ''));
    })[0];
    const start = UI.today();
    editing = {
      childId: child.id,
      createdDate: start,
      planNo: prev ? nextPlanNo(prev.planNo) : '第1期',
      author: Store.settings().manager || child.manager || '',
      prevDate: prev ? prev.createdDate : '',
      startDate: start,
      endDate: UI.addMonths(start, 6),
      monitorDate: UI.addMonths(start, 6),
      frequency: '',
      goals: {}
    };
    DATA.domains.forEach(function (d) { editing.goals[d.id] = {}; });
    App.render();
  }

  function nextPlanNo(prevNo) {
    const m = String(prevNo || '').match(/(\d+)/);
    return m ? '第' + (Number(m[1]) + 1) + '期' : '';
  }

  /* ---- 編集 -------------------------------------------------------------- */
  function renderEditor(root, child) {
    const form = h('form', { onsubmit: function (e) { e.preventDefault(); } });

    root.appendChild(h('div', { class: 'page-head' }, [
      h('div', {}, [
        h('h1', {}, '個別支援計画の作成'),
        h('p', { class: 'muted' }, child.name + '　(' + UI.ageText(UI.ageInMonths(child.birthday, UI.today())) + ')')
      ]),
      h('div', { class: 'btn-row' }, [
        h('button', { class: 'btn', type: 'button', onclick: function () { editing = null; App.render(); } }, 'キャンセル'),
        h('button', { class: 'btn', type: 'button', onclick: function () { saveThen(form, child, toExcel); } }, '保存してExcel出力'),
        h('button', { class: 'btn primary', type: 'button', onclick: function () { save(form, child); } }, '保存する')
      ])
    ]));

    /* 基本情報 */
    const headGrid = h('div', { class: 'form-grid' });
    HEAD_FIELDS.forEach(function (f) {
      headGrid.appendChild(UI.field(f.label, UI.input(f.key, editing[f.key], {
        type: f.type || 'text', placeholder: f.placeholder || ''
      })));
    });
    form.appendChild(h('div', { class: 'panel' }, [
      h('div', { class: 'panel-head' }, h('h2', {}, '基本事項')), headGrid
    ]));

    /* 意向・方針 */
    const wishGrid = h('div', { class: 'form-grid' });
    TEXT_BLOCKS.forEach(function (f) {
      const fld = UI.field(f.label, UI.textarea(f.key, editing[f.key], f.rows), f.hint);
      fld.classList.add('wide');
      wishGrid.appendChild(fld);
    });
    form.appendChild(h('div', { class: 'panel' }, [
      h('div', { class: 'panel-head' }, [
        h('h2', {}, '意向とアセスメント'),
        h('button', { class: 'btn small', type: 'button', onclick: function () { fillFromAssessment(form, child); } },
          'アセスメントから下書きを入れる')
      ]),
      wishGrid
    ]));

    /* 5領域の目標 */
    const goalsPanel = h('div', { class: 'panel' }, [
      h('div', { class: 'panel-head' }, [
        h('h2', {}, '5領域ごとの支援目標'),
        h('span', { class: 'muted small' }, '書くことがない領域は空欄のままで構いません')
      ])
    ]);
    DATA.domains.forEach(function (d) {
      const g = editing.goals[d.id] || {};
      const grid = h('div', { class: 'form-grid' });
      GOAL_ROWS.forEach(function (r) {
        const name = 'goals.' + d.id + '.' + r.key;
        const ctl = r.rows ? UI.textarea(name, g[r.key], r.rows) : UI.input(name, g[r.key]);
        const fld = UI.field(r.label, ctl);
        if (r.rows) fld.classList.add('wide');
        grid.appendChild(fld);
      });
      grid.appendChild(UI.field('優先順位',
        UI.select('goals.' + d.id + '.priority', ['', '1', '2', '3', '4', '5'], g.priority)));
      goalsPanel.appendChild(h('div', { class: 'goal-block' }, [
        h('h3', { class: 'goal-head', style: 'border-left-color:' + d.color }, [
          d.name, h('span', { class: 'goal-desc' }, d.desc)
        ]),
        grid
      ]));
    });
    form.appendChild(goalsPanel);

    /* その他の欄 */
    const tailGrid = h('div', { class: 'form-grid' });
    TAIL_BLOCKS.forEach(function (f) {
      const fld = UI.field(f.label, UI.textarea(f.key, editing[f.key], f.rows));
      fld.classList.add('wide');
      tailGrid.appendChild(fld);
    });
    form.appendChild(h('div', { class: 'panel' }, [
      h('div', { class: 'panel-head' }, h('h2', {}, '目標・家族支援・連携')), tailGrid
    ]));

    /* 説明と同意 */
    const agreeGrid = h('div', { class: 'form-grid' }, [
      UI.field('保護者へ説明した日', UI.input('explainDate', editing.explainDate, { type: 'date' })),
      UI.field('同意を得た日', UI.input('agreeDate', editing.agreeDate, { type: 'date' })),
      UI.field('説明者', UI.input('explainer', editing.explainer)),
      UI.field('同意者(保護者氏名)', UI.input('signer', editing.signer))
    ]);
    form.appendChild(h('div', { class: 'panel' }, [
      h('div', { class: 'panel-head' }, h('h2', {}, '説明と同意')), agreeGrid,
      h('p', { class: 'note' }, '※ 印刷した計画書には署名・押印欄が入ります。同意を得た計画書の写しは保護者へお渡しください。')
    ]));

    form.appendChild(h('div', { class: 'btn-row end' }, [
      h('button', { class: 'btn', type: 'button', onclick: function () { editing = null; App.render(); } }, 'キャンセル'),
      h('button', { class: 'btn primary', type: 'button', onclick: function () { save(form, child); } }, '保存する')
    ]));

    root.appendChild(form);
  }

  /* ---- アセスメント結果から下書き ---------------------------------------- */
  function fillFromAssessment(form, child) {
    const hist = Assess.history(child.id);
    if (!hist.length) { UI.toast('先に発達アセスメントを記録してください', 'warn'); return; }
    const latest = hist[hist.length - 1];
    const sum = Assess.summarize(latest, child);
    const prev = Assess.previousOf(latest);
    const d = Assess.diff(latest, prev);

    /* アセスメントのまとめ */
    const lines = [];
    lines.push(UI.fmtDate(latest.date) + '実施の発達アセスメント(生活年齢 ' + UI.ageText(sum.chronoMonths) + ')より。');
    lines.push('【領域ごとの発達の目安】');
    sum.perDomain.forEach(function (x) { lines.push('・' + x.name + ': ' + UI.ageText(x.months)); });
    if (d.gained.length) {
      lines.push('【前回からできるようになったこと】');
      d.gained.slice(0, 8).forEach(function (g) { lines.push('・' + g.item.text + '(' + g.domain.name + ')'); });
    }
    if (d.emerging.length) {
      lines.push('【芽生えており、支援で伸びが期待できること】');
      d.emerging.slice(0, 8).forEach(function (g) { lines.push('・' + g.item.text + '(' + g.domain.name + ')'); });
    }
    if (latest.comment) { lines.push('【観察所見】'); lines.push(latest.comment); }
    setIfEmpty(form, 'assessmentSummary', lines.join('\n'));

    /* 5領域の目標のたたき台 */
    d.next.forEach(function (n) {
      setIfEmpty(form, 'goals.' + n.domain.id + '.goal',
        n.item.text.replace(/。$/, '') + 'ことを目指す。' +
        (n.score === 1 ? '(現在「芽生え」の段階)' : ''));
      setIfEmpty(form, 'goals.' + n.domain.id + '.period', editing.endDate ? UI.fmtDate(editing.endDate) : '');
    });

    UI.toast('空欄にアセスメントからの下書きを入れました。内容を確認して書き直してください。');
  }

  function setIfEmpty(form, name, value) {
    const el = form.querySelector('[name="' + name.replace(/"/g, '\\"') + '"]');
    if (el && !String(el.value).trim()) el.value = value;
  }

  /* ---- 保存 -------------------------------------------------------------- */
  function save(form, child) {
    saveThen(form, child, null);
  }

  /** 保存したうえで、続けて after(child, 保存した計画) を呼ぶ */
  function saveThen(form, child, after) {
    const flat = UI.readForm(form);
    const obj = Object.assign({}, editing, { childId: child.id, goals: editing.goals || {} });
    Object.keys(flat).forEach(function (k) {
      if (k.indexOf('goals.') === 0) {
        const parts = k.split('.');
        if (!obj.goals[parts[1]]) obj.goals[parts[1]] = {};
        obj.goals[parts[1]][parts[2]] = flat[k];
      } else {
        obj[k] = flat[k];
      }
    });
    const saved = Store.put('plans', obj);
    editing = null;
    UI.toast('個別支援計画を保存しました');
    App.render();
    if (after) after(child, saved);
  }

  /* ---- 厚生労働省の参考様式(xlsx)へ書き出す ------------------------------ */
  function toExcel(child, plan) {
    try {
      Xlsx.exportPlan(child, plan);
      UI.toast('Excelファイルを書き出しました');
    } catch (e) {
      console.error(e);
      UI.toast('Excelの書き出しに失敗しました: ' + e.message, 'warn');
    }
  }

  function reset() { editing = null; }

  return { render: render, reset: reset, HEAD_FIELDS: HEAD_FIELDS, TEXT_BLOCKS: TEXT_BLOCKS,
           GOAL_ROWS: GOAL_ROWS, TAIL_BLOCKS: TAIL_BLOCKS };
})();
