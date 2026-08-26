/* =========================================================================
 * print.js — 印刷用のA4帳票を組み立てる
 *   別ウィンドウを開かず、画面上に印刷専用の領域を差し替えてから
 *   window.print() を呼ぶ(file:// でも確実に動くため)。
 * ========================================================================= */
window.Print = (function () {
  'use strict';
  const h = UI.h;

  function sheetRoot() {
    let el = UI.$('#print-root');
    if (!el) { el = h('div', { id: 'print-root' }); document.body.appendChild(el); }
    return UI.clear(el);
  }

  function run(nodes) {
    const root = sheetRoot();
    (Array.isArray(nodes) ? nodes : [nodes]).forEach(function (n) { root.appendChild(n); });
    document.body.classList.add('printing');
    // レイアウト確定を待ってから印刷ダイアログを出す
    setTimeout(function () {
      window.print();
      setTimeout(function () { document.body.classList.remove('printing'); }, 300);
    }, 60);
  }

  /* ---- 共通パーツ -------------------------------------------------------- */
  function officeLine() {
    const s = Store.settings();
    const parts = [s.officeName, s.serviceType].filter(Boolean);
    return parts.join('　/　');
  }

  function sheetHead(title, child, right) {
    return h('div', { class: 'sheet-head' }, [
      h('div', { class: 'sheet-title-row' }, [
        h('h1', { class: 'sheet-title' }, title),
        h('div', { class: 'sheet-office' }, officeLine())
      ]),
      h('table', { class: 'sheet-meta' }, h('tbody', {}, [
        h('tr', {}, [
          h('th', {}, '児童氏名'),
          h('td', {}, (child.name || '') + (child.kana ? '(' + child.kana + ')' : '')),
          h('th', {}, '生年月日'),
          h('td', {}, UI.fmtDate(child.birthday) + '　' +
            UI.ageText(UI.ageInMonths(child.birthday, right && right.baseDate)) ),
          h('th', {}, '受給者証番号'),
          h('td', {}, child.recipientNo || '')
        ]),
        h('tr', {}, [
          h('th', {}, '保護者氏名'),
          h('td', {}, (child.guardian || '') + (child.relation ? '(' + child.relation + ')' : '')),
          h('th', {}, '所属'),
          h('td', {}, child.belongTo || ''),
          h('th', {}, right && right.label ? right.label : 'サービス種別'),
          h('td', {}, right && right.value ? right.value : (child.serviceType || ''))
        ])
      ]))
    ]);
  }

  function block(label, value) {
    return h('div', { class: 'sheet-block' }, [
      h('div', { class: 'sheet-block-label' }, label),
      h('div', { class: 'sheet-block-body' }, multiline(value))
    ]);
  }

  function multiline(text) {
    const frag = document.createDocumentFragment();
    String(text == null || text === '' ? '　' : text).split('\n').forEach(function (line, i) {
      if (i) frag.appendChild(document.createElement('br'));
      frag.appendChild(document.createTextNode(line));
    });
    return frag;
  }

  function signatureBox(labelDateA, dateA, labelDateB, dateB, signer, explainer) {
    return h('table', { class: 'sheet-table sign' }, h('tbody', {}, [
      h('tr', {}, [
        h('th', {}, labelDateA), h('td', {}, UI.fmtDate(dateA) || '　年　月　日'),
        h('th', {}, '説明者'), h('td', {}, explainer || '')
      ]),
      h('tr', {}, [
        h('th', {}, labelDateB), h('td', {}, UI.fmtDate(dateB) || '　年　月　日'),
        h('th', {}, '保護者署名'), h('td', { class: 'sign-space' }, (signer || '') + '　　　　　　　　　　㊞')
      ])
    ]));
  }

  /* ---- 個別支援計画 ------------------------------------------------------ */
  function plan(child, p) {
    const sheet = h('section', { class: 'sheet' });
    sheet.appendChild(sheetHead('個別支援計画書', child, {
      label: '作成日', value: UI.fmtDate(p.createdDate), baseDate: p.createdDate
    }));

    sheet.appendChild(h('table', { class: 'sheet-table' }, h('tbody', {}, [
      h('tr', {}, [
        h('th', {}, '計画作成者'), h('td', {}, p.author || ''),
        h('th', {}, '回次'), h('td', {}, p.planNo || ''),
        h('th', {}, '前回作成日'), h('td', {}, UI.fmtDate(p.prevDate) || '')
      ]),
      h('tr', {}, [
        h('th', {}, '支援期間'),
        h('td', { colspan: '3' }, (UI.fmtDate(p.startDate) || '') + ' 〜 ' + (UI.fmtDate(p.endDate) || '')),
        h('th', {}, '次回モニタリング'), h('td', {}, UI.fmtDate(p.monitorDate) || '')
      ]),
      h('tr', {}, [
        h('th', {}, '利用予定'), h('td', { colspan: '5' }, p.frequency || '')
      ])
    ])));

    sheet.appendChild(block('本人の希望・意向', p.wishSelf));
    sheet.appendChild(block('ご家族の希望・意向', p.wishFamily));
    sheet.appendChild(block('アセスメントのまとめ(現在の状況・強み・課題)', p.assessmentSummary));
    sheet.appendChild(block('総合的な支援の方針', p.policy));
    sheet.appendChild(h('div', { class: 'two-block' }, [
      block('長期目標(おおむね1年)', p.longGoal),
      block('短期目標(おおむね6か月)', p.shortGoal)
    ]));

    /* 5領域の表 */
    const tbl = h('table', { class: 'sheet-table goals' });
    tbl.appendChild(h('thead', {}, h('tr', {}, [
      h('th', { style: 'width:13%' }, '領域'),
      h('th', { style: 'width:24%' }, '支援目標'),
      h('th', { style: 'width:31%' }, '具体的な支援内容・方法'),
      h('th', { style: 'width:11%' }, '達成時期'),
      h('th', { style: 'width:12%' }, '担当者'),
      h('th', { style: 'width:9%' }, '優先順位')
    ])));
    const tb = h('tbody', {});
    DATA.domains.forEach(function (d) {
      const g = (p.goals && p.goals[d.id]) || {};
      const empty = !g.goal && !g.support && !g.period && !g.staff && !g.note;
      if (empty) return;
      tb.appendChild(h('tr', {}, [
        h('th', { scope: 'row', class: 'domain-cell' }, d.name),
        h('td', {}, multiline(g.goal)),
        h('td', {}, [
          multiline(g.support),
          g.note ? h('div', { class: 'sub-note' }, ['留意事項: ', multiline(g.note)]) : null
        ]),
        h('td', { class: 'center' }, g.period || ''),
        h('td', { class: 'center' }, g.staff || ''),
        h('td', { class: 'center' }, g.priority || '')
      ]));
    });
    if (!tb.children.length) {
      tb.appendChild(h('tr', {}, h('td', { colspan: '6', class: 'center muted' }, '(記載なし)')));
    }
    tbl.appendChild(tb);
    sheet.appendChild(h('div', { class: 'sheet-block' }, [
      h('div', { class: 'sheet-block-label' }, '5領域ごとの支援目標'), tbl
    ]));

    sheet.appendChild(block('家族支援', p.familySupport));
    sheet.appendChild(block('移行支援', p.transitionSupport));
    sheet.appendChild(block('関係機関との連携', p.cooperation));
    sheet.appendChild(block('支援の提供にあたっての留意事項', p.careNote));

    sheet.appendChild(h('p', { class: 'sheet-consent' },
      '上記の個別支援計画について説明を受け、内容に同意します。'));
    sheet.appendChild(signatureBox('説明日', p.explainDate, '同意日', p.agreeDate, p.signer, p.explainer));
    sheet.appendChild(h('div', { class: 'sheet-foot' }, officeLine()));

    run(sheet);
  }

  /* ---- 専門的支援実施計画 ------------------------------------------------ */
  function splan(child, p) {
    const sheet = h('section', { class: 'sheet' });
    sheet.appendChild(sheetHead('専門的支援実施計画書', child, {
      label: '作成日', value: UI.fmtDate(p.createdDate), baseDate: p.createdDate
    }));

    const domNames = (p.domains || []).map(function (id) {
      const d = DATA.domainById(id); return d ? d.name : id;
    }).join('・');

    sheet.appendChild(h('table', { class: 'sheet-table' }, h('tbody', {}, [
      h('tr', {}, [
        h('th', {}, '担当専門職'), h('td', {}, p.staffName || ''),
        h('th', {}, '職種'), h('td', { colspan: '3' }, (p.professions || []).join('・'))
      ]),
      h('tr', {}, [
        h('th', {}, '資格・経験'), h('td', {}, p.qualification || ''),
        h('th', {}, '重点領域'), h('td', { colspan: '3' }, domNames)
      ]),
      h('tr', {}, [
        h('th', {}, '実施期間'),
        h('td', {}, (UI.fmtDate(p.startDate) || '') + ' 〜 ' + (UI.fmtDate(p.endDate) || '')),
        h('th', {}, '実施形態'), h('td', {}, p.form || ''),
        h('th', {}, '頻度・時間'),
        h('td', {}, (p.frequency || '') + (p.minutes ? ' / 1回' + p.minutes + '分' : ''))
      ]),
      h('tr', {}, [
        h('th', {}, '実施場所'), h('td', {}, p.place || ''),
        h('th', {}, '評価予定日'), h('td', { colspan: '3' }, UI.fmtDate(p.evalDate) || '')
      ])
    ])));

    sheet.appendChild(block('専門的支援を必要とする理由(アセスメント結果)', p.reason));
    sheet.appendChild(block('専門的支援の目標', p.goal));
    sheet.appendChild(block('支援内容・具体的な方法', p.content));
    sheet.appendChild(block('個別支援計画との関連', p.linkPlan));
    sheet.appendChild(block('他職員への引き継ぎ・日常場面への般化', p.share));
    sheet.appendChild(block('評価方法・評価の視点', p.evalMethod));

    sheet.appendChild(h('p', { class: 'sheet-consent' },
      '上記の専門的支援実施計画について説明を受け、内容に同意します。'));
    sheet.appendChild(signatureBox('説明日', p.explainDate, '同意日', p.agreeDate, p.signer, p.explainer));

    /* 実施記録は次ページ */
    const sessions = p.sessions || [];
    if (sessions.length) {
      const s2 = h('section', { class: 'sheet' });
      s2.appendChild(sheetHead('専門的支援 実施記録', child, {
        label: '計画作成日', value: UI.fmtDate(p.createdDate), baseDate: p.createdDate
      }));
      const t = h('table', { class: 'sheet-table sessions' });
      t.appendChild(h('thead', {}, h('tr', {}, [
        h('th', { style: 'width:10%' }, '実施日'),
        h('th', { style: 'width:10%' }, '実施者'),
        h('th', { style: 'width:6%' }, '分'),
        h('th', { style: 'width:28%' }, '実施した内容'),
        h('th', { style: 'width:28%' }, '本人の様子・反応'),
        h('th', { style: 'width:18%' }, '次回に向けて')
      ])));
      t.appendChild(h('tbody', {}, sessions.map(function (s) {
        return h('tr', {}, [
          h('td', { class: 'center' }, UI.fmtDate(s.date) || ''),
          h('td', { class: 'center' }, s.staff || ''),
          h('td', { class: 'center' }, s.minutes || ''),
          h('td', {}, multiline(s.content)),
          h('td', {}, multiline(s.response)),
          h('td', {}, multiline(s.next))
        ]);
      })));
      s2.appendChild(t);
      s2.appendChild(h('div', { class: 'sheet-foot' }, officeLine()));
      run([sheet, s2]);
    } else {
      sheet.appendChild(h('div', { class: 'sheet-foot' }, officeLine()));
      run(sheet);
    }
  }

  /* ---- 保護者用アセスメント記録 ------------------------------------------ */
  function assessmentReport(child, a) {
    const sum = Assess.summarize(a, child);
    const prev = Assess.previousOf(a);
    const d = Assess.diff(a, prev);

    const sheet = h('section', { class: 'sheet' });
    sheet.appendChild(sheetHead('発達アセスメント記録(保護者用)', child, {
      label: '実施日', value: UI.fmtDate(a.date), baseDate: a.date
    }));

    sheet.appendChild(h('p', { class: 'lead' },
      'このシートは、半年ごとのモニタリングにあわせて、事業所の職員がお子さんの様子を' +
      '5つの領域からふりかえったものです。' +
      (prev ? '前回(' + UI.fmtDate(prev.date) + ')からの変化もあわせてご覧ください。' : '')));

    /* グラフと数値 */
    const series = [];
    if (prev) {
      series.push({
        name: '前回(' + UI.fmtDate(prev.date) + ')', color: '#94a3b8', dashed: true, fillOpacity: 0.1,
        values: Assess.summarize(prev, child).perDomain.map(function (x) { return x.months; })
      });
    }
    series.push({
      name: '今回(' + UI.fmtDate(a.date) + ')', color: '#2f7d64',
      values: sum.perDomain.map(function (x) { return x.months; })
    });

    const tbl = h('table', { class: 'sheet-table report' });
    tbl.appendChild(h('thead', {}, h('tr', {}, [
      h('th', {}, '領域'), h('th', {}, 'みかた'),
      h('th', { style: 'width:16%' }, '今回のめやす'),
      prev ? h('th', { style: 'width:14%' }, '前回からの変化') : null
    ])));
    tbl.appendChild(h('tbody', {}, sum.perDomain.map(function (x, i) {
      const dm = DATA.domains[i];
      let deltaCell = null;
      if (prev) {
        const pm = Assess.domainMonths(dm, prev.scores || {});
        const delta = Math.round((x.months - pm) * 10) / 10;
        deltaCell = h('td', { class: 'center ' + (delta > 0 ? 'up' : delta < 0 ? 'down' : '') },
          (delta > 0 ? '+' : '') + delta + 'か月');
      }
      return h('tr', {}, [
        h('th', { scope: 'row' }, [h('span', { class: 'dot', style: 'background:' + dm.color }), dm.name]),
        h('td', { class: 'small' }, dm.desc),
        h('td', { class: 'center' }, UI.ageText(x.months)),
        deltaCell
      ]);
    })));

    sheet.appendChild(h('div', { class: 'report-top' }, [
      h('div', { class: 'report-chart' }, [
        Assess.radar(series, { chronoMonths: sum.chronoMonths, size: 300 }),
        Assess.legend(series, sum.chronoMonths)
      ]),
      h('div', { class: 'report-table' }, tbl)
    ]));

    /* できるようになったこと */
    if (prev) {
      sheet.appendChild(h('div', { class: 'sheet-block' }, [
        h('div', { class: 'sheet-block-label' }, 'この半年でできるようになったこと'),
        d.gained.length
          ? h('ul', { class: 'report-list' }, d.gained.map(function (g) {
              return h('li', {}, [h('span', { class: 'chip', style: 'background:' + g.domain.color }, g.domain.name), g.item.text]);
            }))
          : h('p', { class: 'muted' }, '今回のチェックでは、新しく「できる」に変わった項目はありませんでした。日々の様子で気づかれた変化があれば、ぜひお聞かせください。')
      ]));
    }

    /* 芽生えていること */
    sheet.appendChild(h('div', { class: 'sheet-block' }, [
      h('div', { class: 'sheet-block-label' }, 'いま芽生えているところ(もう少しでできそうなこと)'),
      d.emerging.length
        ? h('ul', { class: 'report-list' }, d.emerging.slice(0, 12).map(function (g) {
            return h('li', {}, [h('span', { class: 'chip', style: 'background:' + g.domain.color }, g.domain.name), g.item.text]);
          }))
        : h('p', { class: 'muted' }, '　')
    ]));

    sheet.appendChild(block('事業所からのコメント', a.comment));
    sheet.appendChild(block('ご家庭でできる関わりの提案', a.homeAdvice));

    sheet.appendChild(h('p', { class: 'note' },
      '※ 「めやす」の月齢は、日々の様子のチェック結果から算出した目安であり、医学的な診断や' +
      '標準化された発達検査の結果ではありません。お子さんの育ちを一緒に見ていくための資料としてお使いください。' +
      '気になることがありましたら、遠慮なく担当職員にお声がけください。'));

    sheet.appendChild(h('table', { class: 'sheet-table sign' }, h('tbody', {}, h('tr', {}, [
      h('th', {}, '記入者'), h('td', {}, a.assessor || ''),
      h('th', {}, '実施場面'), h('td', {}, a.setting || ''),
      h('th', {}, '事業所'), h('td', {}, officeLine())
    ]))));

    run(sheet);
  }

  /* ---- 記録 -------------------------------------------------------------- */
  function record(child, r) {
    const sheet = h('section', { class: 'sheet' });
    sheet.appendChild(sheetHead('支援記録', child, {
      label: '記録日', value: UI.fmtDate(r.date), baseDate: r.date
    }));
    sheet.appendChild(h('table', { class: 'sheet-table' }, h('tbody', {}, h('tr', {}, [
      h('th', {}, '表題'), h('td', {}, r.title || ''),
      h('th', {}, '種別'), h('td', {}, r.kind || ''),
      h('th', {}, '出席者・話者'), h('td', {}, r.attendees || '')
    ]))));
    sheet.appendChild(block('内容', r.body));
    if (r.summary) sheet.appendChild(block('要点', r.summary));
    sheet.appendChild(h('div', { class: 'sheet-foot' }, officeLine()));
    run(sheet);
  }

  return { plan: plan, splan: splan, assessmentReport: assessmentReport, record: record };
})();
