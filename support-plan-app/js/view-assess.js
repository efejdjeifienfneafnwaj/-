/* =========================================================================
 * view-assess.js — 発達アセスメント(半年ごとのモニタリング用)
 *   ・5領域70項目のチェック
 *   ・前回との比較(できるようになったこと / 芽生えていること)
 *   ・保護者にお渡しするレポートの印刷
 * ========================================================================= */
window.ViewAssess = (function () {
  'use strict';
  const h = UI.h;

  let editing = null;   // 編集中のアセスメント
  let openDomain = null; // 開いている領域

  function render(root, child) {
    const hist = Assess.history(child.id);

    root.appendChild(h('div', { class: 'page-head' }, [
      h('div', {}, [
        h('h1', {}, '発達アセスメント'),
        h('p', { class: 'muted' }, '5領域70項目のチェックです。半年ごと(モニタリングの時期)に記録すると、前回からの変化が自動でまとまります。')
      ]),
      h('button', {
        class: 'btn primary', onclick: function () { startNew(child); }
      }, '＋ 新しいアセスメント')
    ]));

    if (editing) { renderEditor(root, child); return; }

    if (!hist.length) {
      root.appendChild(h('div', { class: 'empty' }, [
        h('p', {}, 'まだアセスメントの記録がありません。'),
        h('p', { class: 'muted' }, '「＋ 新しいアセスメント」から、いまのお子さんの様子をチェックしてください。')
      ]));
      return;
    }

    root.appendChild(renderTrend(child, hist));
    root.appendChild(renderHistoryList(child, hist));
  }

  /* ---- 推移表 ------------------------------------------------------------ */
  function renderTrend(child, hist) {
    const cols = hist.slice(-6); // 直近6回
    const table = h('table', { class: 'table trend' });
    const head = h('tr', {}, [h('th', {}, '領域')].concat(cols.map(function (a) {
      return h('th', {}, UI.fmtDate(a.date));
    })));
    table.appendChild(h('thead', {}, head));

    const tb = h('tbody', {});
    DATA.domains.forEach(function (d) {
      const cells = cols.map(function (a, i) {
        const m = Assess.domainMonths(d, a.scores || {});
        let delta = null;
        if (i > 0) {
          const prevM = Assess.domainMonths(d, cols[i - 1].scores || {});
          delta = Math.round((m - prevM) * 10) / 10;
        }
        return h('td', {}, [
          h('span', { class: 'trend-val' }, UI.ageText(m)),
          delta !== null ? h('span', { class: 'trend-delta' + (delta > 0 ? ' up' : delta < 0 ? ' down' : '') },
            (delta > 0 ? '+' : '') + delta + 'か月') : null
        ]);
      });
      tb.appendChild(h('tr', {}, [
        h('th', { scope: 'row' }, [
          h('span', { class: 'dot', style: 'background:' + d.color }), d.name
        ])
      ].concat(cells)));
    });

    // 生活年齢の行
    tb.appendChild(h('tr', { class: 'trend-chrono' }, [h('th', { scope: 'row' }, '生活年齢')]
      .concat(cols.map(function (a) {
        return h('td', {}, UI.ageText(UI.ageInMonths(child.birthday, a.date)));
      }))));
    table.appendChild(tb);

    const latest = hist[hist.length - 1];
    const sum = Assess.summarize(latest, child);
    const prev = Assess.previousOf(latest);
    const series = [];
    if (prev) {
      series.push({
        name: '前回(' + UI.fmtDate(prev.date) + ')', color: '#94a3b8', dashed: true, fillOpacity: 0.1,
        values: Assess.summarize(prev, child).perDomain.map(function (x) { return x.months; })
      });
    }
    series.push({
      name: '今回(' + UI.fmtDate(latest.date) + ')', color: '#2f7d64',
      values: sum.perDomain.map(function (x) { return x.months; })
    });

    return h('div', { class: 'panel' }, [
      h('div', { class: 'panel-head' }, h('h2', {}, '発達の推移')),
      h('div', { class: 'trend-layout' }, [
        h('div', { class: 'radar-wrap' }, [
          Assess.radar(series, { chronoMonths: sum.chronoMonths, size: 320 }),
          Assess.legend(series, sum.chronoMonths)
        ]),
        h('div', { class: 'table-scroll' }, table)
      ]),
      h('p', { class: 'note' }, '※ 表の数値は、チェック結果から算出した「発達の目安月齢」です。標準化された発達検査の結果ではありません。支援の見立てと、変化を共有するための参考値としてお使いください。')
    ]);
  }

  /* ---- 履歴一覧 ---------------------------------------------------------- */
  function renderHistoryList(child, hist) {
    const list = h('div', { class: 'record-list' });
    hist.slice().reverse().forEach(function (a) {
      const sum = Assess.summarize(a, child);
      list.appendChild(h('div', { class: 'record-item' }, [
        h('div', { class: 'record-main' }, [
          h('div', { class: 'record-title' }, UI.fmtDate(a.date) + ' 実施'),
          h('div', { class: 'record-meta' }, [
            h('span', {}, '記入者: ' + (a.assessor || '—')),
            h('span', {}, '生活年齢 ' + UI.ageText(sum.chronoMonths)),
            h('span', {}, '5領域平均 ' + UI.ageText(sum.averageMonths)),
            sum.unrated ? h('span', { class: 'tag warn' }, '未評価 ' + sum.unrated + '項目') : null
          ]),
          a.comment ? h('p', { class: 'record-body' }, a.comment) : null
        ]),
        h('div', { class: 'record-actions' }, [
          h('button', { class: 'btn small', onclick: function () { editing = a; openDomain = null; App.render(); } }, '開く'),
          h('button', { class: 'btn small', onclick: function () { Print.assessmentReport(child, a); } }, '保護者用を印刷'),
          h('button', {
            class: 'btn small danger ghost', onclick: function () {
              if (!UI.confirmDanger(UI.fmtDate(a.date) + ' のアセスメントを削除します。元に戻せません。')) return;
              Store.remove('assessments', a.id);
              UI.toast('削除しました'); App.render();
            }
          }, '削除')
        ])
      ]));
    });
    return h('div', { class: 'panel' }, [
      h('div', { class: 'panel-head' }, h('h2', {}, '実施履歴')),
      list
    ]);
  }

  /* ---- 新規作成 ---------------------------------------------------------- */
  function startNew(child) {
    const hist = Assess.history(child.id);
    const last = hist.length ? hist[hist.length - 1] : null;
    editing = {
      childId: child.id,
      date: UI.today(),
      assessor: Store.settings().manager || '',
      setting: '',
      comment: '',
      homeAdvice: '',
      // 前回の結果を初期値として引き継ぐ(「変わったところだけ直す」使い方ができる)
      scores: last ? Object.assign({}, last.scores) : {}
    };
    openDomain = DATA.domains[0].id;
    if (last) UI.toast('前回(' + UI.fmtDate(last.date) + ')の結果を引き継ぎました。変化したところを直してください。');
    App.render();
  }

  /* ---- 入力画面 ---------------------------------------------------------- */
  function renderEditor(root, child) {
    const chrono = UI.ageInMonths(child.birthday, editing.date);

    /* 見出し部分 */
    const head = h('form', { class: 'form-grid compact' }, [
      UI.field('実施日', UI.input('date', editing.date, {
        type: 'date', onchange: function (e) { editing.date = e.target.value; App.render(); }
      })),
      UI.field('記入者', UI.input('assessor', editing.assessor, {
        onchange: function (e) { editing.assessor = e.target.value; }
      })),
      UI.field('実施場面', UI.input('setting', editing.setting, {
        placeholder: '例: 事業所での活動観察、保護者面談',
        onchange: function (e) { editing.setting = e.target.value; }
      })),
      UI.field('生活年齢', h('div', { class: 'static-value' }, UI.ageText(chrono)))
    ]);

    /* 領域ごとのチェック */
    const sections = h('div', { class: 'assess-sections' });
    DATA.domains.forEach(function (d) {
      const done = d.items.filter(function (it) {
        const s = editing.scores[it.id]; return s !== undefined && s !== null && s !== '';
      }).length;
      const opened = openDomain === d.id;

      const header = h('button', {
        class: 'assess-head' + (opened ? ' open' : ''), type: 'button',
        onclick: function () { openDomain = opened ? null : d.id; App.render(); }
      }, [
        h('span', { class: 'dot', style: 'background:' + d.color }),
        h('span', { class: 'assess-head-name' }, d.name),
        h('span', { class: 'assess-head-count' }, done + '/' + d.items.length),
        h('span', { class: 'assess-head-months' }, UI.ageText(Assess.domainMonths(d, editing.scores))),
        h('span', { class: 'chev' }, opened ? '▲' : '▼')
      ]);

      const body = h('div', { class: 'assess-body' + (opened ? '' : ' hidden') });
      body.appendChild(h('p', { class: 'assess-desc' }, d.desc));
      d.items.forEach(function (it) {
        // 生活月齢の前後1年程度の項目は、いま注目したいところとして印をつける
        const focus = chrono !== null && it.month > chrono - 12 && it.month <= chrono + 6;
        const row = h('div', { class: 'assess-row' + (focus ? ' focus' : '') }, [
          h('div', { class: 'assess-item' }, [
            h('span', { class: 'assess-month' }, it.month + 'か月'),
            h('span', { class: 'assess-text' }, it.text)
          ]),
          h('div', { class: 'seg' }, DATA.SCORES.map(function (sc) {
            const on = String(editing.scores[it.id]) === String(sc.value);
            return h('button', {
              type: 'button', class: 'seg-btn s' + sc.value + (on ? ' on' : ''),
              title: sc.desc,
              onclick: function () {
                if (on) delete editing.scores[it.id];
                else editing.scores[it.id] = sc.value;
                App.render();
              }
            }, sc.label);
          }))
        ]);
        body.appendChild(row);
      });

      // 領域内の一括操作
      body.appendChild(h('div', { class: 'assess-bulk' }, [
        h('span', { class: 'muted' }, 'この領域をまとめて: '),
        h('button', { class: 'btn tiny', type: 'button', onclick: function () {
          d.items.forEach(function (it) { if (editing.scores[it.id] === undefined) editing.scores[it.id] = 0; });
          App.render();
        } }, '未評価を「これから」にする'),
        h('button', { class: 'btn tiny ghost', type: 'button', onclick: function () {
          d.items.forEach(function (it) { delete editing.scores[it.id]; });
          App.render();
        } }, 'クリア')
      ]));

      sections.appendChild(h('div', { class: 'assess-section' }, [header, body]));
    });

    /* 結果プレビュー */
    const sum = Assess.summarize(editing, child);
    const prevA = Assess.previousOf(editing);
    const series = [];
    if (prevA) {
      series.push({
        name: '前回(' + UI.fmtDate(prevA.date) + ')', color: '#94a3b8', dashed: true, fillOpacity: 0.1,
        values: Assess.summarize(prevA, child).perDomain.map(function (x) { return x.months; })
      });
    }
    series.push({
      name: '今回', color: '#2f7d64',
      values: sum.perDomain.map(function (x) { return x.months; })
    });

    const preview = h('div', { class: 'panel sticky' }, [
      h('div', { class: 'panel-head' }, h('h2', {}, '入力中の結果')),
      h('div', { class: 'radar-wrap' }, [
        Assess.radar(series, { chronoMonths: sum.chronoMonths, size: 300 }),
        Assess.legend(series, sum.chronoMonths)
      ]),
      h('ul', { class: 'domain-scores' }, sum.perDomain.map(function (x) {
        return h('li', {}, [
          h('span', { class: 'dot', style: 'background:' + x.color }),
          h('span', { class: 'ds-name' }, x.name),
          h('span', { class: 'ds-val' }, UI.ageText(x.months))
        ]);
      })),
      sum.unrated ? h('p', { class: 'note warn' }, '未評価が ' + sum.unrated + '項目あります。未評価は「これから」と同じ扱いで計算されるため、実際より低く出ることがあります。') : null,
      h('div', { class: 'form-grid' }, [
        (function () { const f = UI.field('支援者からのコメント(保護者用レポートに載ります)',
            UI.textarea('comment', editing.comment, 4, '例: 友達との関わりが増え、順番を待てる場面が出てきました。'));
          f.classList.add('wide'); f.querySelector('textarea').addEventListener('change', function (e) { editing.comment = e.target.value; });
          return f; })(),
        (function () { const f = UI.field('ご家庭でできる関わりの提案',
            UI.textarea('homeAdvice', editing.homeAdvice, 4, '例: 順番を待つ場面を、ご家庭のカード遊びでも作ってみてください。'));
          f.classList.add('wide'); f.querySelector('textarea').addEventListener('change', function (e) { editing.homeAdvice = e.target.value; });
          return f; })()
      ]),
      h('div', { class: 'panel-actions' }, [
        h('button', { class: 'btn', onclick: function () { editing = null; App.render(); } }, 'キャンセル'),
        h('button', {
          class: 'btn primary', onclick: function () {
            const saved = Store.put('assessments', editing);
            editing = null;
            UI.toast('アセスメントを保存しました');
            App.render();
            void saved;
          }
        }, '保存する')
      ])
    ]);

    root.appendChild(h('div', { class: 'assess-layout' }, [
      h('div', {}, [h('div', { class: 'panel' }, [head]), sections]),
      preview
    ]));
  }

  function reset() { editing = null; openDomain = null; }

  return { render: render, reset: reset };
})();
