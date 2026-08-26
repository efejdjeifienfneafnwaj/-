/* =========================================================================
 * xlsx.js — 厚生労働省「個別支援計画参考様式」への差し込み出力
 *
 *   xlsx は「XMLファイルを集めた zip」なので、
 *     1. 埋め込んだ原本の部品(xlsx-template.js)を取り出す
 *     2. シートと図形の XML だけを書き換える
 *     3. zip に詰め直す(無圧縮=stored。Excel はこれを問題なく開ける)
 *   という手順で、外部ライブラリなしに書き出す。
 *   罫線・列幅・印刷設定は原本の部品をそのまま使うので崩れない。
 * ========================================================================= */
window.Xlsx = (function () {
  'use strict';

  /* ---- base64 / バイト列 ------------------------------------------------ */
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function bytesToText(bytes) { return new TextDecoder('utf-8').decode(bytes); }
  function textToBytes(text) { return new TextEncoder().encode(text); }

  /* ---- CRC32(zip に必要) ----------------------------------------------- */
  let CRC_TABLE = null;
  function crcTable() {
    if (CRC_TABLE) return CRC_TABLE;
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      CRC_TABLE[n] = c >>> 0;
    }
    return CRC_TABLE;
  }
  function crc32(bytes) {
    const t = crcTable();
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ---- zip(無圧縮)を組み立てる ---------------------------------------- */
  function zip(files) {
    // files: [{ name, bytes }]
    const chunks = [];
    const central = [];
    let offset = 0;

    // 更新日時は固定(1980-01-01)。ファイルごとに変える必要がない。
    const dosTime = 0, dosDate = 33;

    files.forEach(function (f) {
      const nameBytes = textToBytes(f.name);
      const crc = crc32(f.bytes);
      const size = f.bytes.length;

      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034B50, true);   // ローカルヘッダ署名
      lv.setUint16(4, 20, true);           // 展開に必要なバージョン
      lv.setUint16(6, 0x0800, true);       // UTF-8 フラグ
      lv.setUint16(8, 0, true);            // 圧縮方式 0 = 無圧縮
      lv.setUint16(10, dosTime, true);
      lv.setUint16(12, dosDate, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, size, true);
      lv.setUint32(22, size, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);

      chunks.push(local, f.bytes);

      const cen = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(cen.buffer);
      cv.setUint32(0, 0x02014B50, true);   // 中央ディレクトリ署名
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, dosTime, true);
      cv.setUint16(14, dosDate, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, size, true);
      cv.setUint32(24, size, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint32(42, offset, true);      // ローカルヘッダの位置
      cen.set(nameBytes, 46);
      central.push(cen);

      offset += local.length + size;
    });

    const centralStart = offset;
    let centralSize = 0;
    central.forEach(function (c) { chunks.push(c); centralSize += c.length; });

    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054B50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, centralStart, true);
    chunks.push(end);

    let total = 0;
    chunks.forEach(function (c) { total += c.length; });
    const out = new Uint8Array(total);
    let pos = 0;
    chunks.forEach(function (c) { out.set(c, pos); pos += c.length; });
    return out;
  }

  /* ---- XML の小道具 ------------------------------------------------------ */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/\r\n?/g, '\n');
  }

  /**
   * 1つのセルに文字列を入れる。
   * mode に 'top' / 'center' を渡すと、原本の書式を「文字を折り返す書式」に
   * 読み替える(原本の書式には折り返し指定がなく、長い支援内容が1行に潰れるため)。
   */
  function setCell(rowXml, ref, text, mode) {
    const re = new RegExp('<c r="' + ref + '"([^>]*?)(/>|>[\\s\\S]*?</c>)');
    if (!re.test(rowXml)) return rowXml;
    return rowXml.replace(re, function (m, attrs) {
      let keep = attrs.replace(/\s+t="[^"]*"/g, '');
      if (mode && text) keep = restyle(keep, mode);
      if (text === null || text === undefined || text === '') {
        return '<c r="' + ref + '"' + keep + '/>';
      }
      return '<c r="' + ref + '"' + keep + ' t="inlineStr"><is><t xml:space="preserve">' +
        esc(text) + '</t></is></c>';
    });
  }

  /** 書式番号を、折り返しありの書式番号に差し替える */
  function restyle(attrs, mode) {
    const map = (window.XLSX_TEMPLATE.wrapStyles || {})[mode] || {};
    const m = attrs.match(/\bs="(\d+)"/);
    const cur = m ? m[1] : '0';
    if (map[cur] === undefined) return attrs;
    return m ? attrs.replace(/\bs="\d+"/, 's="' + map[cur] + '"')
             : attrs + ' s="' + map[cur] + '"';
  }

  /** 行のXMLを、別の行番号に付け替える */
  function moveRow(rowXml, to) {
    return rowXml
      .replace(/(<row[^>]*\sr=")(\d+)(")/, '$1' + to + '$3')
      .replace(/(<c r="[A-Z]+)(\d+)(")/g, function (m, a, n, c) { return a + to + c; });
  }

  function rowNum(rowXml) {
    const m = rowXml.match(/<row[^>]*\sr="(\d+)"/);
    return m ? Number(m[1]) : -1;
  }

  function splitRows(sheetXml) {
    const m = sheetXml.match(/<sheetData>([\s\S]*)<\/sheetData>/);
    if (!m) return null;
    const rows = m[1].match(/<row\b[^>]*\/>|<row\b[^>]*>[\s\S]*?<\/row>/g) || [];
    return { head: sheetXml.slice(0, m.index + '<sheetData>'.length),
             rows: rows,
             tail: sheetXml.slice(m.index + m[0].length - '</sheetData>'.length) };
  }


  /* ---- 行の高さ ----------------------------------------------------------
   * 原本の行は高さが固定されているため、長い支援内容を入れると下が隠れる。
   * 列幅から折り返し行数を見積もって、必要なぶんだけ行を高くする。
   * ---------------------------------------------------------------------- */

  /** 全角を2、半角を1として数え、幅 width に何行で収まるかを返す */
  function wrapLines(text, width) {
    if (!text) return 1;
    const w = Math.max(4, width);
    let lines = 0;
    String(text).split('\n').forEach(function (seg) {
      let units = 0;
      for (let i = 0; i < seg.length; i++) units += seg.charCodeAt(i) > 0x7f ? 2 : 1;
      lines += Math.max(1, Math.ceil(units / w));
    });
    return lines;
  }

  const LINE_H = 15.5, PAD_H = 7;

  /** 複数セルぶんの見積もりから、行の高さを決める */
  function neededHeight(cells, minHeight) {
    let lines = 1;
    cells.forEach(function (c) { lines = Math.max(lines, wrapLines(c[0], c[1])); });
    return Math.max(minHeight, lines * LINE_H + PAD_H);
  }

  function setRowHeight(rowXml, height) {
    const h = String(Math.round(height * 100) / 100);
    return rowXml.replace(/<row([^>]*?)(\/?)>/, function (m, attrs, slash) {
      let a = attrs.replace(/\s+ht="[^"]*"/g, '').replace(/\s+customHeight="[^"]*"/g, '');
      return '<row' + a + ' ht="' + h + '" customHeight="1"' + slash + '>';
    });
  }

  /* 原本の列幅(文字数)。結合セルはその合計を使う。 */
  const W = { B: 10.9, C: 20.1, D: 34.6, E: 16.5, F: 7.2, G: 12.9, H: 24.1, I: 6.1 };
  const W_D_E = W.D + W.E;                                   // 支援内容 D:E
  const W_D_I = W.D + W.E + W.F + W.G + W.H + W.I;           // 意向・方針 D:I
  const W_D_G = W.D + W.E + W.F + W.G;                       // 長期/短期目標 D:G
  const W_H_I = W.H + W.I;                                   // 提供時間 H:I

  /* ---- 別紙1-1(計画書本体)への差し込み --------------------------------- */
  /* 原本の表は 15〜18 行の4行。5領域ぶん書くときは行を足し、
     19行目以降(注記・同意欄)と結合セル・図形の位置をまとめてずらす。 */
  function fillSheet1(xml, child, plan, goals) {
    const parts = splitRows(xml);
    if (!parts) throw new Error('様式のシートを読み取れませんでした');

    const GOAL_FIRST = 15, GOAL_LAST = 18;
    const n = Math.max(1, goals.length);
    const delta = n - (GOAL_LAST - GOAL_FIRST + 1);

    const byNum = {};
    parts.rows.forEach(function (r) { byNum[rowNum(r)] = r; });
    const midTpl = byNum[GOAL_FIRST];   // 途中の行
    const lastTpl = byNum[GOAL_LAST];   // 最終行(下辺が太線)

    const out = [];
    parts.rows.forEach(function (row) {
      const r = rowNum(row);

      if (r < GOAL_FIRST) {
        let x = row;
        if (r === 5) {
          const v = joinWishes(plan);
          x = setRowHeight(setCell(x, 'D5', v, 'top'), neededHeight([[v, W_D_I]], 76.5));
        }
        if (r === 7) {
          x = setRowHeight(setCell(x, 'D7', plan.policy, 'top'),
                           neededHeight([[plan.policy, W_D_I]], 37.5));
        }
        if (r === 9) {
          const v = withPeriod(plan.longGoal, plan.startDate, plan.endDate);
          x = setRowHeight(setCell(x, 'D9', v, 'top'), neededHeight([[v, W_D_G]], 38.25));
        }
        if (r === 10) {
          const v = withPeriod(plan.shortGoal, plan.startDate, plan.endDate);
          x = setCell(x, 'D10', v, 'top');
          x = setCell(x, 'H10', plan.frequency, 'top');
          x = setRowHeight(x, neededHeight([[v, W_D_G], [plan.frequency, W_H_I]], 37.5));
        }
        out.push(x);
        return;
      }

      if (r >= GOAL_FIRST && r <= GOAL_LAST) {
        if (r !== GOAL_FIRST) return; // 目標行はまとめて作り直すので読み飛ばす
        goals.forEach(function (g, i) {
          const target = GOAL_FIRST + i;
          let x = moveRow(i === n - 1 ? lastTpl : midTpl, target);
          x = setCell(x, 'B' + target, g.domainName, 'center');
          x = setCell(x, 'C' + target, g.goal, 'top');
          x = setCell(x, 'D' + target, g.support, 'top');
          x = setCell(x, 'E' + target, '');
          x = setCell(x, 'F' + target, g.period, 'center');
          x = setCell(x, 'G' + target, g.staff, 'center');
          x = setCell(x, 'H' + target, g.note, 'top');
          x = setCell(x, 'I' + target, g.priority, 'center');
          x = setRowHeight(x, neededHeight([
            [g.goal, W.C], [g.support, W_D_E], [g.note, W.H], [g.domainName, W.B]
          ], 37.5));
          out.push(x);
        });
        return;
      }

      // 19行目以降(注記・同意欄)
      let x = moveRow(row, r + delta);
      const nr = r + delta;
      if (r === 23) {
        x = setCell(x, 'B' + nr, '児童発達支援管理責任者氏名：' + (plan.author || ''));
        x = setCell(x, 'E' + nr, jpDate(plan.explainDate) || '　　　　年　　月　　日');
        x = setCell(x, 'F' + nr, '（保護者署名）' + (plan.signer ? '　' + plan.signer : ''));
      }
      out.push(x);
    });

    /* 結合セルの付け替え */
    let tail = parts.tail;
    const merges = [];
    const mm = tail.match(/<mergeCells[^>]*>([\s\S]*?)<\/mergeCells>/);
    if (mm) {
      (mm[1].match(/<mergeCell ref="[^"]+"\/>/g) || []).forEach(function (mc) {
        const ref = mc.match(/ref="([^"]+)"/)[1];
        // 目標行の 支援内容 は D:E をまたぐ(見出し D14:E14 と同じ形にそろえる)
        if (/^D14:E14$/.test(ref)) { merges.push(ref); return; }
        merges.push(ref.replace(/([A-Z]+)(\d+)/g, function (s, col, num) {
          const v = Number(num);
          return col + (v > GOAL_LAST ? v + delta : v);
        }));
      });
    }
    for (let i = 0; i < n; i++) merges.push('D' + (GOAL_FIRST + i) + ':E' + (GOAL_FIRST + i));

    const mergeXml = '<mergeCells count="' + merges.length + '">' +
      merges.map(function (r) { return '<mergeCell ref="' + r + '"/>'; }).join('') + '</mergeCells>';
    tail = mm ? tail.replace(/<mergeCells[^>]*>[\s\S]*?<\/mergeCells>/, mergeXml)
              : tail.replace('</sheetData>', '</sheetData>' + mergeXml);

    return { xml: parts.head + out.join('') + tail, delta: delta };
  }

  function joinWishes(plan) {
    const a = [];
    if (plan.wishSelf) a.push('【本人】' + plan.wishSelf);
    if (plan.wishFamily) a.push('【ご家族】' + plan.wishFamily);
    return a.join('\n');
  }

  function withPeriod(text, start, end) {
    if (!text) return '';
    if (!start && !end) return text;
    return text + '\n（期間：' + (jpDate(start) || '') + '〜' + (jpDate(end) || '') + '）';
  }

  function jpDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  /* ---- 別紙1-2(別表)への差し込み --------------------------------------- */
  function fillSheet2(xml, child, plan) {
    const parts = splitRows(xml);
    if (!parts) return xml;
    const out = parts.rows.map(function (row) {
      const r = rowNum(row);
      let x = row;
      if (r === 4) {
        x = setCell(x, 'B4', child.name || '', 'center');
        x = setCell(x, 'R4', jpDate(plan.createdDate) || '　　　年　　月　　日', 'center');
      }
      if (r === 16) {
        x = setCell(x, 'B16', plan.careNote || '', 'top');
        x = setRowHeight(x, neededHeight([[plan.careNote, 90]], 37.5));
      }
      if (r === 18) {
        x = setCell(x, 'N18', jpDate(plan.agreeDate) || '　　　年　　月　　日', 'center');
        x = setCell(x, 'S18', plan.signer || '', 'center');
      }
      return x;
    });
    return parts.head + out.join('') + parts.tail;
  }

  /* ---- 図形(テキストボックス)の差し込み --------------------------------- */
  function fillDrawing(xml, child, plan, delta) {
    let out = xml
      .replace(/<a:t>作成年月日：[\s\S]*?<\/a:t>/,
        '<a:t>' + esc('作成年月日：' + (jpDate(plan.createdDate) || '　　年　　月　　日')) + '</a:t>')
      .replace(/<a:t>利用児氏名：[\s\S]*?<\/a:t>/,
        '<a:t>' + esc('利用児氏名：' + (child.name || '')) + '</a:t>');

    // 「押印廃止」の吹き出しは同意欄の高さにあるので、行を足したぶんだけ下げる
    if (delta) {
      out = out.replace(/<xdr:(twoCellAnchor|oneCellAnchor)[\s\S]*?<\/xdr:\1>/g, function (seg) {
        if (seg.indexOf('押印廃止') < 0) return seg;
        return seg.replace(/<xdr:row>(\d+)<\/xdr:row>/g, function (m, num) {
          return '<xdr:row>' + (Number(num) + delta) + '</xdr:row>';
        });
      });
    }
    return out;
  }

  /* ---- 個別支援計画を xlsx として書き出す -------------------------------- */
  function exportPlan(child, plan) {
    if (!window.XLSX_TEMPLATE) throw new Error('様式データが読み込まれていません');

    // 記入のある領域だけを行にする(すべて空なら1行だけ空欄で出す)
    const goals = [];
    DATA.domains.forEach(function (d) {
      const g = (plan.goals && plan.goals[d.id]) || {};
      if (!g.goal && !g.support && !g.period && !g.staff && !g.note) return;
      goals.push({
        domainName: d.name, goal: g.goal || '', support: g.support || '',
        period: g.period || '', staff: g.staff || '', note: g.note || '',
        priority: g.priority || ''
      });
    });
    if (!goals.length) {
      goals.push({ domainName: '', goal: '', support: '', period: '', staff: '', note: '', priority: '' });
    }

    const T = window.XLSX_TEMPLATE;
    const files = T.order.map(function (name) {
      const bytes = b64ToBytes(T.parts[name]);
      return { name: name, bytes: bytes };
    });

    // シート1 → シート2 → 図形 の順に差し替える
    let delta = 0;
    files.forEach(function (f) {
      if (f.name === 'xl/worksheets/sheet1.xml') {
        const r = fillSheet1(bytesToText(f.bytes), child, plan, goals);
        delta = r.delta;
        f.bytes = textToBytes(r.xml);
      }
    });
    files.forEach(function (f) {
      if (f.name === 'xl/worksheets/sheet2.xml') {
        f.bytes = textToBytes(fillSheet2(bytesToText(f.bytes), child, plan));
      } else if (f.name === 'xl/drawings/drawing1.xml') {
        f.bytes = textToBytes(fillDrawing(bytesToText(f.bytes), child, plan, delta));
      }
    });

    const bytes = zip(files);
    const stamp = (plan.createdDate || UI.today()).replace(/-/g, '');
    const safeName = String(child.name || '児童').replace(/[\\/:*?"<>|]/g, '_');
    saveBlob(new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }), '個別支援計画_' + safeName + '_' + stamp + '.xlsx');
  }

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 0);
  }

  return { exportPlan: exportPlan, zip: zip, crc32: crc32 };
})();
