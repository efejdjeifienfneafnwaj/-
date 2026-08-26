/* =========================================================================
 * app.js — 画面の切り替えと全体の枠組み
 * ========================================================================= */
window.App = (function () {
  'use strict';
  const h = UI.h;

  const CHILD_TABS = [
    { id: 'home',    label: 'ホーム' },
    { id: 'plan',    label: '個別支援計画' },
    { id: 'splan',   label: '専門的支援実施計画' },
    { id: 'assess',  label: '発達アセスメント' },
    { id: 'records', label: '記録・文字起こし' }
  ];

  let state = { view: 'children', childId: null };

  /* ---- 画面遷移 ---------------------------------------------------------- */
  function go(view) {
    resetViews();
    state.view = view;
    if (view === 'children' || view === 'settings') state.childId = null;
    render();
  }

  function openChild(childId, view) {
    if (state.childId !== childId) resetViews();
    state.childId = childId;
    state.view = view || 'home';
    render();
  }

  /** 別の画面へ移るとき、各画面の編集中の状態を捨てる */
  function resetViews() {
    [ViewAssess, ViewPlan, ViewSplan, ViewRecords].forEach(function (v) {
      if (v && v.reset) v.reset();
    });
  }

  /* ---- 描画 -------------------------------------------------------------- */
  function render() {
    const app = UI.$('#app');
    UI.clear(app);
    app.appendChild(renderHeader());

    const main = h('main', { class: 'main' });
    app.appendChild(main);

    if (state.view === 'settings') { renderSettings(main); return; }

    if (!state.childId) { ViewChildren.renderList(main); return; }

    const child = Store.get('children', state.childId);
    if (!child) { state.childId = null; ViewChildren.renderList(main); return; }

    main.appendChild(renderChildBar(child));
    const body = h('div', { class: 'child-body' });
    main.appendChild(body);

    switch (state.view) {
      case 'plan':    ViewPlan.render(body, child); break;
      case 'splan':   ViewSplan.render(body, child); break;
      case 'assess':  ViewAssess.render(body, child); break;
      case 'records': ViewRecords.render(body, child); break;
      default:        ViewChildren.renderHome(body, child);
    }
  }

  function renderHeader() {
    const s = Store.settings();
    return h('header', { class: 'topbar' }, [
      h('button', {
        class: 'brand', title: '児童一覧へ戻る',
        onclick: function () { go('children'); }
      }, [
        h('span', { class: 'brand-mark' }, '計'),
        h('span', {}, [
          h('span', { class: 'brand-name' }, '個別支援計画 作成支援'),
          h('span', { class: 'brand-sub' }, s.officeName || '事業所名は「設定」から登録できます')
        ])
      ]),
      h('nav', { class: 'topnav' }, [
        h('button', {
          class: 'navlink' + (!state.childId && state.view !== 'settings' ? ' on' : ''),
          onclick: function () { go('children'); }
        }, '児童一覧'),
        h('button', {
          class: 'navlink' + (state.view === 'settings' ? ' on' : ''),
          onclick: function () { go('settings'); }
        }, '設定・データ')
      ])
    ]);
  }

  function renderChildBar(child) {
    const months = UI.ageInMonths(child.birthday, UI.today());
    return h('div', { class: 'childbar' }, [
      h('div', { class: 'childbar-id' }, [
        h('button', { class: 'back', onclick: function () { go('children'); } }, '← 一覧'),
        h('div', {}, [
          h('div', { class: 'childbar-name' }, child.name || '(氏名未入力)'),
          h('div', { class: 'childbar-meta' },
            [UI.ageText(months), child.serviceType, child.belongTo].filter(Boolean).join('　/　'))
        ])
      ]),
      h('div', { class: 'tabs' }, CHILD_TABS.map(function (t) {
        return h('button', {
          class: 'tab' + (state.view === t.id ? ' on' : ''),
          onclick: function () { openChild(child.id, t.id); }
        }, t.label);
      }))
    ]);
  }

  /* ---- 設定・データ管理 --------------------------------------------------- */
  function renderSettings(root) {
    const s = Store.settings();

    root.appendChild(h('div', { class: 'page-head' }, h('div', {}, [
      h('h1', {}, '設定・データ管理'),
      h('p', { class: 'muted' }, '事業所の情報と、データの持ち出し・取り込みを行います。')
    ])));

    /* 事業所情報 */
    const form = h('form', { class: 'form-grid', onsubmit: function (e) { e.preventDefault(); } }, [
      UI.field('事業所名', UI.input('officeName', s.officeName)),
      UI.field('サービス種別', UI.select('serviceType', DATA.SERVICE_TYPES, s.serviceType)),
      UI.field('児童発達支援管理責任者(既定値)', UI.input('manager', s.manager),
        '計画やアセスメントを新しく作るとき、作成者の欄に自動で入ります。'),
      UI.field('電話番号', UI.input('tel', s.tel)),
      (function () { const f = UI.field('所在地', UI.input('address', s.address)); f.classList.add('wide'); return f; })()
    ]);
    root.appendChild(h('div', { class: 'panel' }, [
      h('div', { class: 'panel-head' }, h('h2', {}, '事業所情報')),
      form,
      h('div', { class: 'panel-actions' }, h('button', {
        class: 'btn primary', onclick: function () {
          Store.settings(UI.readForm(form));
          UI.toast('保存しました');
          render();
        }
      }, '保存する'))
    ]));

    /* データ */
    const db = Store.load();
    const kb = Math.round(Store.usedBytes() / 1024);
    root.appendChild(h('div', { class: 'panel' }, [
      h('div', { class: 'panel-head' }, h('h2', {}, 'データの保管状況')),
      h('dl', { class: 'kv' }, [
        ['登録児童', db.children.length + '名'],
        ['個別支援計画', db.plans.length + '件'],
        ['専門的支援実施計画', db.splans.length + '件'],
        ['発達アセスメント', db.assessments.length + '件'],
        ['記録・文字起こし', db.records.length + '件'],
        ['使用容量の目安', kb + ' KB']
      ].map(function (r) {
        return h('div', { class: 'kv-row' }, [h('dt', {}, r[0]), h('dd', {}, r[1])]);
      })),
      h('div', { class: 'notice' }, [
        h('strong', {}, 'データはこの端末のブラウザの中だけに保存されます。'),
        h('p', {}, 'インターネットへ送信されることはありません。そのぶん、ブラウザの閲覧履歴の削除' +
          '(「Cookieとサイトデータ」の消去)や、別の端末・別のブラウザからの利用では、データは引き継がれません。'),
        h('p', {}, '大切な記録ですので、定期的にバックアップを保存し、事業所で定めた場所に保管してください。')
      ])
    ]));

    root.appendChild(h('div', { class: 'panel' }, [
      h('div', { class: 'panel-head' }, h('h2', {}, 'バックアップ')),
      h('div', { class: 'btn-row' }, [
        h('button', {
          class: 'btn primary', onclick: function () {
            UI.download('個別支援計画バックアップ_' + UI.today() + '.json', Store.exportJson());
            UI.toast('バックアップを保存しました');
          }
        }, 'バックアップを書き出す'),
        h('label', { class: 'btn' }, [
          '取り込む(追加)',
          h('input', { type: 'file', accept: '.json,application/json', hidden: true,
            onchange: function (e) { importFile(e.target.files[0], 'merge'); } })
        ]),
        h('label', { class: 'btn danger ghost' }, [
          '取り込む(全部入れ替え)',
          h('input', { type: 'file', accept: '.json,application/json', hidden: true,
            onchange: function (e) { importFile(e.target.files[0], 'replace'); } })
        ])
      ]),
      h('p', { class: 'note' }, '「追加」は、いまのデータを残したまま、ファイルにしかないものを足します。' +
        '「全部入れ替え」は、いまのデータを捨ててファイルの内容に置き換えます。')
    ]));

    root.appendChild(h('div', { class: 'panel danger-zone' }, [
      h('div', { class: 'panel-head' }, h('h2', {}, 'すべて消去')),
      h('p', { class: 'muted' }, 'この端末に保存されている児童・計画・記録をすべて削除します。元に戻せません。'),
      h('button', {
        class: 'btn danger', onclick: function () {
          if (!UI.confirmDanger('保存されているデータをすべて削除します。\n元に戻せません。本当によろしいですか?')) return;
          if (!UI.confirmDanger('最終確認です。バックアップは保存しましたか?\n\nこのまま削除する場合は「OK」を押してください。')) return;
          Store.clearAll();
          UI.toast('すべて削除しました');
          go('children');
        }
      }, 'すべて削除する')
    ]));
  }

  function importFile(file, mode) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      try {
        if (mode === 'replace' &&
            !UI.confirmDanger('いまのデータをすべて捨てて、ファイルの内容に置き換えます。よろしいですか?')) return;
        Store.importJson(String(reader.result), mode);
        UI.toast('取り込みました');
        render();
      } catch (e) {
        alert('取り込めませんでした。\n' + e.message);
      }
    };
    reader.readAsText(file);
  }

  /* ---- 共通ダイアログ ---------------------------------------------------- */
  function modal(title, content, buttons) {
    closeModal();
    const box = h('div', { class: 'modal-box', role: 'dialog', 'aria-modal': 'true' }, [
      h('div', { class: 'modal-head' }, [
        h('h2', {}, title),
        h('button', { class: 'modal-close', 'aria-label': '閉じる', onclick: closeModal }, '×')
      ]),
      h('div', { class: 'modal-body' }, content),
      h('div', { class: 'modal-foot' }, (buttons || []).filter(Boolean))
    ]);
    const overlay = h('div', {
      class: 'modal-overlay', id: 'modal',
      onclick: function (e) { if (e.target === overlay) closeModal(); }
    }, box);
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onEsc);
    const first = box.querySelector('input,select,textarea');
    if (first) first.focus();
  }

  function onEsc(e) { if (e.key === 'Escape') closeModal(); }

  function closeModal() {
    const m = UI.$('#modal');
    if (m) m.remove();
    document.removeEventListener('keydown', onEsc);
  }

  /* ---- 起動 -------------------------------------------------------------- */
  function init() {
    Store.load();
    render();
  }

  return { init: init, render: render, go: go, openChild: openChild, modal: modal, closeModal: closeModal };
})();

document.addEventListener('DOMContentLoaded', function () { App.init(); });
