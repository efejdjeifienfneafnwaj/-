/* =========================================================================
 * view-children.js — 児童の登録・一覧・児童カルテのホーム
 * ========================================================================= */
window.ViewChildren = (function () {
  'use strict';
  const h = UI.h;

  const CHILD_FIELDS = [
    { key: 'name',        label: '氏名', required: true },
    { key: 'kana',        label: 'ふりがな' },
    { key: 'birthday',    label: '生年月日', type: 'date', required: true },
    { key: 'gender',      label: '性別', options: ['', '男', '女', 'その他・回答しない'] },
    { key: 'recipientNo', label: '受給者証番号' },
    { key: 'serviceType', label: 'サービス種別', options: DATA.SERVICE_TYPES },
    { key: 'startDate',   label: '利用開始日', type: 'date' },
    { key: 'guardian',    label: '保護者氏名' },
    { key: 'relation',    label: '続柄', options: ['', '父', '母', '祖父', '祖母', 'その他'] },
    { key: 'belongTo',    label: '所属(園・学校・学年)' },
    { key: 'consultOffice', label: '相談支援事業所' },
    { key: 'consultant',  label: '相談支援専門員' },
    { key: 'manager',     label: '担当児童発達支援管理責任者' },
    { key: 'diagnosis',   label: '診断名・医療的ケア', wide: true },
    { key: 'handbook',    label: '手帳の種類・等級' },
    { key: 'care',        label: 'アレルギー・服薬・配慮事項', wide: true, textarea: true },
    { key: 'memo',        label: '備考', wide: true, textarea: true }
  ];

  /* ---- 一覧 ------------------------------------------------------------- */
  function renderList(root) {
    const children = Store.list('children').slice().sort(function (a, b) {
      return String(a.kana || a.name).localeCompare(String(b.kana || b.name), 'ja');
    });

    root.appendChild(h('div', { class: 'page-head' }, [
      h('div', {}, [
        h('h1', {}, '児童一覧'),
        h('p', { class: 'muted' }, '登録児童 ' + children.length + '名。名前を選ぶと、その児童の計画・アセスメント・記録が開きます。')
      ]),
      h('button', { class: 'btn primary', onclick: function () { openEditor(null); } }, '＋ 児童を登録')
    ]));

    if (!children.length) {
      root.appendChild(h('div', { class: 'empty' }, [
        h('p', {}, 'まだ児童が登録されていません。'),
        h('p', { class: 'muted' }, '「＋ 児童を登録」から始めてください。入力したデータはこの端末のブラウザ内だけに保存されます。')
      ]));
      return;
    }

    const grid = h('div', { class: 'card-grid' });
    children.forEach(function (c) {
      const months = UI.ageInMonths(c.birthday, UI.today());
      const plans = Store.byChild('plans', c.id);
      const assess = Assess.history(c.id);
      const last = assess.length ? assess[assess.length - 1] : null;
      const due = last ? UI.addMonths(last.date, 6) : null;
      const overdue = due && due < UI.today();

      grid.appendChild(h('div', {
        class: 'child-card', tabindex: '0', role: 'button',
        onclick: function () { App.openChild(c.id, 'home'); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); App.openChild(c.id, 'home'); } }
      }, [
        h('div', { class: 'child-card-name' }, c.name || '(氏名未入力)'),
        h('div', { class: 'child-card-kana' }, c.kana || ''),
        h('div', { class: 'child-card-meta' }, [
          h('span', {}, UI.ageText(months)),
          c.serviceType ? h('span', { class: 'tag' }, c.serviceType) : null
        ]),
        h('div', { class: 'child-card-stats' }, [
          h('span', {}, '計画 ' + plans.length + '件'),
          h('span', {}, 'アセスメント ' + assess.length + '回')
        ]),
        due ? h('div', { class: 'child-card-due' + (overdue ? ' overdue' : '') },
          (overdue ? '⚠ 次回アセスメント時期を過ぎています(' : '次回アセスメント目安 ') +
          UI.fmtDate(due) + (overdue ? ')' : '')) : null
      ]));
    });
    root.appendChild(grid);
  }

  /* ---- 登録・編集フォーム ------------------------------------------------ */
  function openEditor(childId) {
    const child = childId ? Store.get('children', childId) : {};
    const form = h('form', { class: 'form-grid' });

    CHILD_FIELDS.forEach(function (f) {
      let ctl;
      if (f.options) ctl = UI.select(f.key, f.options, child[f.key]);
      else if (f.textarea) ctl = UI.textarea(f.key, child[f.key], 2);
      else ctl = UI.input(f.key, child[f.key], { type: f.type || 'text', required: f.required || null });
      const wrap = UI.field(f.label + (f.required ? ' *' : ''), ctl);
      if (f.wide) wrap.classList.add('wide');
      form.appendChild(wrap);
    });

    App.modal(childId ? '児童情報の編集' : '児童の登録', form, [
      childId ? h('button', {
        class: 'btn danger ghost', type: 'button', onclick: function () {
          if (!UI.confirmDanger('「' + (child.name || '') + '」を削除します。\n' +
            'この児童の計画・アセスメント・記録もすべて削除され、元に戻せません。よろしいですか?')) return;
          Store.removeChild(childId);
          App.closeModal();
          App.go('children');
          UI.toast('削除しました');
        }
      }, '削除') : null,
      h('button', { class: 'btn', type: 'button', onclick: App.closeModal }, 'キャンセル'),
      h('button', {
        class: 'btn voice', type: 'button', onclick: function () {
          Voice.fillForm(form, CHILD_FIELDS.map(function (f) {
            return { name: f.key, label: f.label, hint: f.key === 'birthday'
              ? '「2021年5月10日」のように言ってください' : null };
          }), '音声で児童情報を入力');
        }
      }, '🎤 音声で入力'),
      h('button', {
        class: 'btn primary', type: 'button', onclick: function () {
          const data = UI.readForm(form);
          if (!data.name || !data.name.trim()) { UI.toast('氏名を入力してください', 'warn'); return; }
          if (!data.birthday) { UI.toast('生年月日を入力してください', 'warn'); return; }
          const obj = Object.assign({}, child, data);
          Store.put('children', obj);
          App.closeModal();
          UI.toast('保存しました');
          if (childId) App.render(); else App.openChild(obj.id, 'home');
        }
      }, '保存')
    ]);
  }

  /* ---- 児童カルテ ホーム -------------------------------------------------- */
  function renderHome(root, child) {
    const months = UI.ageInMonths(child.birthday, UI.today());
    const hist = Assess.history(child.id);
    const last = hist.length ? hist[hist.length - 1] : null;
    const plans = Store.byChild('plans', child.id).slice().sort(function (a, b) {
      return String(b.createdDate).localeCompare(String(a.createdDate));
    });
    const splans = Store.byChild('splans', child.id);
    const records = Store.byChild('records', child.id);

    /* 基本情報 */
    const info = h('div', { class: 'panel' }, [
      h('div', { class: 'panel-head' }, [
        h('h2', {}, '基本情報'),
        h('button', { class: 'btn small', onclick: function () { openEditor(child.id); } }, '編集')
      ]),
      h('dl', { class: 'kv' }, CHILD_FIELDS.filter(function (f) {
        return child[f.key];
      }).map(function (f) {
        return h('div', { class: 'kv-row' + (f.wide ? ' wide' : '') }, [
          h('dt', {}, f.label),
          h('dd', {}, f.type === 'date' ? UI.fmtDate(child[f.key]) : child[f.key])
        ]);
      }).concat([
        h('div', { class: 'kv-row' }, [h('dt', {}, '現在の年齢'), h('dd', {}, UI.ageText(months))])
      ]))
    ]);

    /* 次にやること */
    const todo = [];
    if (!last) {
      todo.push({ text: '発達アセスメントがまだ行われていません。最初の記録をとりましょう。', view: 'assess', cta: 'アセスメントを行う' });
    } else {
      const due = UI.addMonths(last.date, 6);
      if (due < UI.today()) {
        todo.push({ text: '前回のアセスメントから6か月以上たっています(前回 ' + UI.fmtDate(last.date) + ')。モニタリングの時期です。', view: 'assess', cta: 'アセスメントを行う', warn: true });
      } else {
        todo.push({ text: '次回のアセスメント目安は ' + UI.fmtDate(due) + ' です(前回 ' + UI.fmtDate(last.date) + ')。', view: 'assess', cta: '前回の結果を見る' });
      }
    }
    if (!plans.length) {
      todo.push({ text: '個別支援計画がまだ作成されていません。', view: 'plan', cta: '計画を作成する' });
    } else if (plans[0].endDate && plans[0].endDate < UI.today()) {
      todo.push({ text: '個別支援計画の支援期間が終了しています(' + UI.fmtDate(plans[0].endDate) + ')。見直しの時期です。', view: 'plan', cta: '計画を見直す', warn: true });
    }

    const todoPanel = h('div', { class: 'panel' }, [
      h('div', { class: 'panel-head' }, h('h2', {}, '次にやること')),
      todo.length
        ? h('ul', { class: 'todo' }, todo.map(function (t) {
            return h('li', { class: t.warn ? 'warn' : '' }, [
              h('span', {}, t.text),
              h('button', { class: 'btn small', onclick: function () { App.openChild(child.id, t.view); } }, t.cta)
            ]);
          }))
        : h('p', { class: 'muted' }, '当面の対応事項はありません。')
    ]);

    /* 発達の推移 */
    let trend;
    if (last) {
      const sum = Assess.summarize(last, child);
      const prev = Assess.previousOf(last);
      const series = [];
      if (prev) {
        const ps = Assess.summarize(prev, child);
        series.push({
          name: '前回(' + UI.fmtDate(prev.date) + ')', color: '#94a3b8', dashed: true, fillOpacity: 0.1,
          values: ps.perDomain.map(function (d) { return d.months; })
        });
      }
      series.push({
        name: '今回(' + UI.fmtDate(last.date) + ')', color: '#2f7d64',
        values: sum.perDomain.map(function (d) { return d.months; })
      });
      trend = h('div', { class: 'panel' }, [
        h('div', { class: 'panel-head' }, [
          h('h2', {}, '発達の目安(最新)'),
          h('button', { class: 'btn small', onclick: function () { App.openChild(child.id, 'assess'); } }, '詳しく見る')
        ]),
        h('div', { class: 'radar-wrap' }, [
          Assess.radar(series, { chronoMonths: sum.chronoMonths, size: 300 }),
          Assess.legend(series, sum.chronoMonths)
        ])
      ]);
    } else {
      trend = h('div', { class: 'panel' }, [
        h('div', { class: 'panel-head' }, h('h2', {}, '発達の目安')),
        h('p', { class: 'muted' }, 'アセスメントを1回記録すると、5領域のグラフが表示されます。')
      ]);
    }

    /* 書類・記録のショートカット */
    const links = h('div', { class: 'panel' }, [
      h('div', { class: 'panel-head' }, h('h2', {}, '書類と記録')),
      h('div', { class: 'shortcut-grid' }, [
        shortcut('個別支援計画', plans.length + '件', 'plan', child),
        shortcut('専門的支援実施計画', splans.length + '件', 'splan', child),
        shortcut('発達アセスメント', hist.length + '回', 'assess', child),
        shortcut('記録・文字起こし', records.length + '件', 'records', child)
      ])
    ]);

    root.appendChild(h('div', { class: 'two-col' }, [
      h('div', {}, [todoPanel, info]),
      h('div', {}, [trend, links])
    ]));
  }

  function shortcut(title, count, view, child) {
    return h('button', {
      class: 'shortcut', onclick: function () { App.openChild(child.id, view); }
    }, [h('span', { class: 'shortcut-title' }, title), h('span', { class: 'shortcut-count' }, count)]);
  }

  return { renderList: renderList, renderHome: renderHome, openEditor: openEditor, FIELDS: CHILD_FIELDS };
})();
