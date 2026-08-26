/* =========================================================================
 * assess.js — 発達アセスメントの採点・比較・レーダーチャート
 *
 * 【算出の考え方】
 *  各項目には「おおむね達成される目安の月齢」がある。項目を月齢順に並べ、
 *  ひとつ前の項目からの月数の幅(span)を、その項目の達成度(できる=1.0 /
 *  芽生え=0.5 / これから=0)で按分して積み上げ、領域ごとの「発達の目安月齢」
 *  とする。標準化された検査ではないため、あくまで支援の見立てに使う参考値。
 * ========================================================================= */
window.Assess = (function () {
  'use strict';

  const h = UI.h;

  /* ---- 採点 ------------------------------------------------------------- */

  /** 1領域の発達目安月齢を求める */
  function domainMonths(domain, scores) {
    let prev = 0, total = 0;
    domain.items.forEach(function (it) {
      const span = it.month - prev;
      const s = Number(scores && scores[it.id]);
      const ratio = s === 2 ? 1 : s === 1 ? 0.5 : 0;
      total += span * ratio;
      prev = it.month;
    });
    return Math.round(total * 10) / 10;
  }

  /** 未評価の項目数 */
  function unratedCount(scores) {
    let n = 0;
    DATA.domains.forEach(function (d) {
      d.items.forEach(function (it) {
        const s = scores && scores[it.id];
        if (s === undefined || s === null || s === '') n++;
      });
    });
    return n;
  }

  /** アセスメント1件のサマリを作る */
  function summarize(assessment, child) {
    const scores = assessment.scores || {};
    const perDomain = DATA.domains.map(function (d) {
      return { id: d.id, name: d.name, color: d.color, months: domainMonths(d, scores) };
    });
    const avg = perDomain.reduce(function (a, x) { return a + x.months; }, 0) / perDomain.length;
    const chrono = child ? UI.ageInMonths(child.birthday, assessment.date) : null;
    return {
      perDomain: perDomain,
      averageMonths: Math.round(avg * 10) / 10,
      chronoMonths: chrono,
      // 発達指数の目安(生活月齢に対する比)。参考値であることを必ず併記する。
      ratio: (chrono && chrono > 0) ? Math.round((avg / chrono) * 100) : null,
      unrated: unratedCount(scores)
    };
  }

  /** その児童のアセスメントを実施日の古い順に返す */
  function history(childId) {
    return Store.byChild('assessments', childId).slice().sort(function (a, b) {
      return String(a.date).localeCompare(String(b.date));
    });
  }

  /** 直前のアセスメント(同一児童・実施日がより古いもののうち最新) */
  function previousOf(assessment) {
    const hist = history(assessment.childId).filter(function (a) {
      return a.id !== assessment.id && String(a.date) < String(assessment.date);
    });
    return hist.length ? hist[hist.length - 1] : null;
  }

  /* ---- 前回との差分 ------------------------------------------------------
   * gained  : 前回「これから/芽生え」→ 今回「できる」になった項目
   * emerging: 今回「芽生え」の項目(次に伸ばしたいところ)
   * ---------------------------------------------------------------------- */
  function diff(current, previous) {
    const cur = (current && current.scores) || {};
    const prv = (previous && previous.scores) || null;
    const gained = [], emerging = [], next = [];
    DATA.domains.forEach(function (d) {
      d.items.forEach(function (it) {
        const c = Number(cur[it.id]);
        const p = prv ? Number(prv[it.id]) : NaN;
        if (c === 2 && prv && (p === 0 || p === 1)) {
          gained.push({ domain: d, item: it, from: p });
        }
        if (c === 1) emerging.push({ domain: d, item: it });
      });
      // 各領域で「まだできていない項目のうち最も月齢の低いもの」= 次の一歩
      const notYet = d.items.filter(function (it) { return Number(cur[it.id]) !== 2; });
      if (notYet.length) next.push({ domain: d, item: notYet[0], score: Number(cur[notYet[0].id]) || 0 });
    });
    return { gained: gained, emerging: emerging, next: next };
  }

  /* ---- レーダーチャート(依存ライブラリなしの手書きSVG) ----------------- */
  function radar(series, opts) {
    opts = opts || {};
    const size = opts.size || 320;
    const cx = size / 2, cy = size / 2 + 6;
    const R = size * 0.34;
    const max = DATA.MAX_MONTH;
    const axes = DATA.domains;
    const n = axes.length;
    const NS = 'http://www.w3.org/2000/svg';

    function svgEl(tag, attrs) {
      const el = document.createElementNS(NS, tag);
      Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
      return el;
    }
    function point(i, v) {
      const ang = -Math.PI / 2 + (Math.PI * 2 * i) / n;
      const r = R * Math.max(0, Math.min(1, v / max));
      return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
    }

    const svg = svgEl('svg', {
      viewBox: '0 0 ' + size + ' ' + (size + 12), class: 'radar',
      role: 'img', 'aria-label': '5領域の発達の目安をあらわすレーダーチャート'
    });

    // 目盛りの多角形(12か月ごと)
    for (let g = 1; g <= 6; g++) {
      const pts = [];
      for (let i = 0; i < n; i++) pts.push(point(i, (max / 6) * g).join(','));
      svg.appendChild(svgEl('polygon', {
        points: pts.join(' '), fill: 'none',
        stroke: g === 6 ? '#94a3b8' : '#e2e8f0', 'stroke-width': g === 6 ? 1.2 : 1
      }));
    }
    // 軸線とラベル
    axes.forEach(function (d, i) {
      const p = point(i, max);
      svg.appendChild(svgEl('line', { x1: cx, y1: cy, x2: p[0], y2: p[1], stroke: '#e2e8f0' }));
      const lp = point(i, max * 1.24);
      const t = svgEl('text', {
        x: lp[0], y: lp[1], 'text-anchor': 'middle', 'dominant-baseline': 'middle',
        class: 'radar-label'
      });
      d.name.split('・').forEach(function (part, k, arr) {
        const ts = svgEl('tspan', { x: lp[0], dy: k === 0 ? (arr.length > 1 ? -6 : 0) : 12 });
        ts.textContent = part + (k < arr.length - 1 ? '・' : '');
        t.appendChild(ts);
      });
      svg.appendChild(t);
    });

    // 生活月齢の基準線
    if (opts.chronoMonths) {
      const pts = [];
      for (let i = 0; i < n; i++) pts.push(point(i, opts.chronoMonths).join(','));
      svg.appendChild(svgEl('polygon', {
        points: pts.join(' '), fill: 'none', stroke: '#64748b',
        'stroke-width': 1.2, 'stroke-dasharray': '4 3'
      }));
    }

    // データ系列
    series.forEach(function (s) {
      const pts = s.values.map(function (v, i) { return point(i, v).join(','); });
      svg.appendChild(svgEl('polygon', {
        points: pts.join(' '), fill: s.color, 'fill-opacity': s.fillOpacity != null ? s.fillOpacity : 0.22,
        stroke: s.color, 'stroke-width': 2, 'stroke-dasharray': s.dashed ? '5 4' : ''
      }));
      if (!s.dashed) {
        s.values.forEach(function (v, i) {
          const p = point(i, v);
          svg.appendChild(svgEl('circle', { cx: p[0], cy: p[1], r: 3.5, fill: s.color }));
        });
      }
    });

    return svg;
  }

  /** チャートの凡例 */
  function legend(series, chronoMonths) {
    return h('div', { class: 'legend' },
      series.map(function (s) {
        return h('span', { class: 'legend-item' }, [
          h('span', { class: 'legend-swatch', style: 'background:' + s.color +
            (s.dashed ? ';opacity:.55' : '') }),
          s.name
        ]);
      }).concat(chronoMonths ? [
        h('span', { class: 'legend-item' }, [
          h('span', { class: 'legend-swatch dashed' }),
          '生活年齢の目安(' + UI.ageText(chronoMonths) + ')'
        ])
      ] : [])
    );
  }

  return {
    domainMonths: domainMonths,
    summarize: summarize,
    history: history,
    previousOf: previousOf,
    diff: diff,
    radar: radar,
    legend: legend,
    unratedCount: unratedCount
  };
})();
