/* =========================================================================
 * voice.js — 音声入力の共通機能
 *
 *   ・マイクで話した内容を、そのまま項目に入れる
 *   ・「音声で入力」ウィザード…項目を1つずつ読み上げ表示し、順に答えていく
 *   ・アセスメントの音声採点…「できる／芽生え／これから」と言うだけで進む
 *
 * 【重要】ブラウザ標準の音声認識(Web Speech API)を使う。Chrome などでは
 * マイクの音声がブラウザ提供元のサーバーへ送られて文字に変換されるため、
 * 使う前に必ず同意を確認する。
 * ========================================================================= */
window.Voice = (function () {
  'use strict';
  const h = UI.h;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  let session = null;   // いま動いている認識セッション

  /* ---- 対応状況 ---------------------------------------------------------- */
  function supported() { return !!SR; }

  /** この環境で気をつけることがあれば、その説明を返す(なければ空文字) */
  function envWarning() {
    if (!supported()) {
      return 'このブラウザは音声入力に対応していません。Google Chrome または Microsoft Edge でお試しください。';
    }
    if (location.protocol === 'file:') {
      return 'ファイルを直接開いた状態では、ブラウザがマイクの使用を認めないことがあります。' +
             'うまく動かない場合は、Zohoなどに設置した状態でお試しください。';
    }
    return '';
  }

  /** 音声を外部で処理することへの同意(タブを閉じるまで1回) */
  function consent() {
    if (sessionStorage.getItem('sps.voiceOk')) return true;
    const ok = window.confirm(
      '【音声入力についての確認】\n\n' +
      'ブラウザの音声認識を使います。お使いのブラウザによっては、マイクの音声が\n' +
      'ブラウザ提供元(Google など)のサーバーへ送られて文字に変換されます。\n\n' +
      'お子さんの氏名やご家庭の状況など、配慮が必要な個人情報を話す場合は、\n' +
      '事業所の個人情報の取り扱い方針を確認したうえでご利用ください。\n\n' +
      '同意して音声入力を始めますか?');
    if (ok) sessionStorage.setItem('sps.voiceOk', '1');
    return ok;
  }

  function errorText(code) {
    switch (code) {
      case 'not-allowed':
      case 'service-not-allowed':
        return 'マイクの使用が許可されませんでした。ブラウザのアドレスバーにあるマイクの印から許可してください。';
      case 'audio-capture':
        return 'マイクが見つかりませんでした。接続をご確認ください。';
      case 'network':
        return '音声認識のサーバーに接続できませんでした。インターネット接続をご確認ください。';
      default:
        return '音声入力でエラーが起きました(' + code + ')';
    }
  }

  /* ---- 認識の開始・停止 --------------------------------------------------
   * opts: { onFinal(text), onInterim(text), onError(code, msg), onEnd() }
   * ---------------------------------------------------------------------- */
  function start(opts) {
    stop();
    const warn = envWarning();
    if (!supported()) { UI.toast(warn, 'warn'); return false; }
    if (!consent()) return false;

    let rec;
    try { rec = new SR(); } catch (e) { UI.toast('音声入力を開始できませんでした', 'warn'); return false; }

    rec.lang = 'ja-JP';
    rec.continuous = true;
    rec.interimResults = opts.interim !== false;

    const self = { rec: rec, stopping: false };

    rec.onresult = function (ev) {
      let final = '', interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) final += t; else interim += t;
      }
      if (interim && opts.onInterim) opts.onInterim(normalize(interim));
      if (final && opts.onFinal) opts.onFinal(normalize(final));
    };

    rec.onerror = function (ev) {
      // 無音や中断は日常的に起きるので黙って続ける
      if (ev.error === 'no-speech' || ev.error === 'aborted') return;
      if (opts.onError) opts.onError(ev.error, errorText(ev.error));
      else UI.toast(errorText(ev.error), 'warn');
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') stop();
    };

    // 連続認識は一定時間で勝手に切れるので、止めていなければ繋ぎ直す
    rec.onend = function () {
      if (self.stopping || session !== self) { if (opts.onEnd) opts.onEnd(); return; }
      try { rec.start(); } catch (e) { if (opts.onEnd) opts.onEnd(); }
    };

    try { rec.start(); } catch (e) {
      UI.toast('音声入力を開始できませんでした', 'warn');
      return false;
    }
    session = self;
    if (warn) UI.toast(warn, 'warn');
    return true;
  }

  function stop() {
    if (!session) return;
    const s = session;
    session = null;
    s.stopping = true;
    try { s.rec.onend = null; s.rec.stop(); } catch (e) { /* 既に止まっていれば何もしない */ }
  }

  function listening() { return !!session; }

  /* ---- 聞き取った文字の整え --------------------------------------------- */
  function normalize(text) {
    return String(text || '')
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (c) {
        return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
      })
      .trim();
  }

  /** 命令として言ったのか、内容として言ったのかを分ける。
   *  発話まるごとが命令語と一致したときだけ命令とみなす。 */
  function wholeMatch(text, words) {
    const t = normalize(text).replace(/[。、．，\s]/g, '');
    return words.some(function (w) { return t === w; });
  }

  const CMD = {
    next:   ['次', '次へ', 'つぎ', 'つぎへ', 'オッケー', 'オーケー', 'ok', 'OK', '完了', 'かんりょう'],
    prev:   ['戻る', 'もどる', '前', 'まえ', '前へ', 'まえへ'],
    clear:  ['消して', 'けして', 'クリア', '取り消し', 'とりけし', 'やり直し', 'やりなおし'],
    finish: ['終了', 'しゅうりょう', '終わり', 'おわり', '入力終了']
  };

  function command(text) {
    for (const key in CMD) if (wholeMatch(text, CMD[key])) return key;
    return null;
  }

  /* ---- 話した日付を「2021-05-10」の形に ---------------------------------- */
  const ERA = { '令和': 2018, '平成': 1988, '昭和': 1925 };

  function parseDate(text) {
    const t = normalize(text).replace(/\s/g, '');
    let m = t.match(/(令和|平成|昭和)(元|\d{1,2})年(\d{1,2})月(\d{1,2})日?/);
    if (m) {
      const y = ERA[m[1]] + (m[2] === '元' ? 1 : Number(m[2]));
      return iso(y, m[3], m[4]);
    }
    m = t.match(/(\d{4})年(\d{1,2})月(\d{1,2})日?/);
    if (m) return iso(m[1], m[2], m[3]);
    m = t.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
    if (m) return iso(m[1], m[2], m[3]);
    m = t.match(/(\d{1,2})月(\d{1,2})日?/);
    if (m) return iso(new Date().getFullYear(), m[1], m[2]);
    if (/今日|きょう/.test(t)) return UI.today();
    return '';
  }

  function iso(y, m, d) {
    return String(y) + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  /* =======================================================================
   * 1. 入力欄のマイクボタン
   * ===================================================================== */

  function insertAtCursor(el, text) {
    const s = el.selectionStart, e = el.selectionEnd;
    const before = el.value.slice(0, s);
    const sep = before && !/[\s\n]$/.test(before) ? '\n' : '';
    const add = sep + text;
    el.value = before + add + el.value.slice(e);
    el.selectionStart = el.selectionEnd = s + add.length;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /** textarea / input に付けるマイクボタンを作る */
  function micButton(target, label) {
    const btn = h('button', {
      type: 'button', class: 'mic-btn',
      title: supported() ? 'マイクで入力する' : 'このブラウザは音声入力に対応していません'
    }, label || '🎤');
    if (!supported()) { btn.disabled = true; btn.classList.add('off'); return btn; }

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      if (btn.classList.contains('rec')) { stop(); setOff(); return; }
      UI.$$('.mic-btn.rec').forEach(function (b) { b.classList.remove('rec'); b.textContent = label || '🎤'; });
      const ok = start({
        onFinal: function (t) { if (command(t) === 'finish') { stop(); setOff(); return; } insertAtCursor(target, t); },
        onEnd: setOff
      });
      if (!ok) return;
      btn.classList.add('rec');
      btn.textContent = '■';
      btn.title = '音声入力を止める';
      target.focus();
      UI.toast('マイクで入力中です。「終了」と言うか、■ で止まります。');
    });

    function setOff() {
      btn.classList.remove('rec');
      btn.textContent = label || '🎤';
      btn.title = 'マイクで入力する';
    }
    return btn;
  }

  /** 画面にある textarea すべてにマイクボタンを付ける(何度呼んでも重複しない) */
  function attachMics(root) {
    UI.$$('textarea', root || document).forEach(function (ta) {
      if (ta.dataset.mic) return;
      if (ta.closest('#print-root') || ta.closest('.voice-wiz')) return;
      ta.dataset.mic = '1';
      const wrap = h('div', { class: 'mic-wrap' });
      ta.parentNode.insertBefore(wrap, ta);
      wrap.appendChild(ta);
      wrap.appendChild(micButton(ta));
    });
  }

  /* =======================================================================
   * 2. 音声で入力ウィザード
   *    steps: [{ key, label, hint, type:'text'|'textarea'|'date'|'select',
   *              options:[...], value }]
   * ===================================================================== */
  function wizard(cfg) {
    const steps = cfg.steps || [];
    if (!steps.length) return;
    if (!supported()) { UI.toast(envWarning(), 'warn'); return; }

    const values = {};
    steps.forEach(function (s) { values[s.key] = s.value || ''; });

    let i = 0;
    const body = h('div', { class: 'voice-wiz' });
    const overlay = h('div', { class: 'modal-overlay', id: 'voice-modal' },
      h('div', { class: 'modal-box wiz-box' }, [
        h('div', { class: 'modal-head' }, [
          h('h2', {}, cfg.title || '音声で入力'),
          h('button', { class: 'modal-close', 'aria-label': '閉じる', onclick: close }, '×')
        ]),
        body
      ]));

    function close() {
      stop();
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }

    function finish() {
      stop();
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      if (cfg.onFinish) cfg.onFinish(values);
    }

    function go(n) {
      i = Math.max(0, Math.min(steps.length - 1, n));
      draw();
    }

    function draw() {
      const st = steps[i];
      UI.clear(body);

      body.appendChild(h('div', { class: 'vw-top' }, [
        h('div', { class: 'vw-progress' }, (i + 1) + ' / ' + steps.length),
        h('div', { class: 'vw-bar' }, h('div', {
          class: 'vw-bar-fill', style: 'width:' + ((i + 1) / steps.length * 100) + '%'
        })),
        h('div', { class: 'vw-state' + (listening() ? ' on' : '') },
          listening() ? '● 聞き取り中' : '■ 停止中')
      ]));

      body.appendChild(h('div', { class: 'vw-label' }, st.label));
      if (st.hint) body.appendChild(h('div', { class: 'vw-hint' }, st.hint));

      let control;
      if (st.type === 'select') {
        control = h('div', { class: 'vw-choices' }, (st.options || []).map(function (o) {
          return h('button', {
            type: 'button',
            class: 'vw-choice' + (values[st.key] === o ? ' on' : ''),
            onclick: function () { values[st.key] = o; draw(); }
          }, o || '(空欄)');
        }));
      } else if (st.type === 'date') {
        control = h('input', {
          type: 'date', class: 'vw-input', value: values[st.key] || '',
          onchange: function (e) { values[st.key] = e.target.value; }
        });
      } else {
        control = h('textarea', {
          class: 'vw-input', rows: st.type === 'text' ? 2 : 6,
          onchange: function (e) { values[st.key] = e.target.value; }
        }, values[st.key] || '');
      }
      body.appendChild(control);
      body.appendChild(h('div', { class: 'vw-live', id: 'vw-live' }, ''));

      body.appendChild(h('div', { class: 'vw-cmds' },
        '声で操作:「次へ」で次の項目、「戻る」で前、「消して」で消す、「終了」で入力を終わります。'));

      body.appendChild(h('div', { class: 'vw-actions' }, [
        h('button', { type: 'button', class: 'btn', disabled: i === 0, onclick: function () { go(i - 1); } }, '← 戻る'),
        h('button', { type: 'button', class: 'btn ghost', onclick: function () { values[st.key] = ''; draw(); } }, '消す'),
        h('button', {
          type: 'button', class: 'btn ' + (listening() ? 'danger' : 'primary'),
          onclick: function () { listening() ? (stop(), draw()) : listen(); }
        }, listening() ? '■ マイクを止める' : '🎤 マイクを使う'),
        i === steps.length - 1
          ? h('button', { type: 'button', class: 'btn primary', onclick: finish }, '入力を終える')
          : h('button', { type: 'button', class: 'btn primary', onclick: function () { go(i + 1); } }, '次へ →')
      ]));

      // 入力欄を書き換えたら values に反映されるようにしておく
      if (control.tagName === 'TEXTAREA') {
        control.addEventListener('input', function () { values[st.key] = control.value; });
      }
    }

    function setLive(t) {
      const el = UI.$('#vw-live', body);
      if (el) el.textContent = t || '';
    }

    function apply(text) {
      const st = steps[i];
      const cmd = command(text);
      if (cmd === 'next') { i < steps.length - 1 ? go(i + 1) : finish(); return; }
      if (cmd === 'prev') { go(i - 1); return; }
      if (cmd === 'clear') { values[st.key] = ''; draw(); return; }
      if (cmd === 'finish') { finish(); return; }

      if (st.type === 'date') {
        const d = parseDate(text);
        if (d) { values[st.key] = d; draw(); }
        else UI.toast('日付として聞き取れませんでした。「2021年5月10日」のように言ってください。', 'warn');
        return;
      }
      if (st.type === 'select') {
        const t = normalize(text).replace(/[。、\s]/g, '');
        const hit = (st.options || []).filter(function (o) {
          return o && (t === o || t.indexOf(o) >= 0 || o.indexOf(t) >= 0);
        })[0];
        if (hit) { values[st.key] = hit; draw(); }
        else UI.toast('選択肢の中から聞き取れませんでした。', 'warn');
        return;
      }
      values[st.key] = (values[st.key] ? values[st.key] + '\n' : '') + text;
      draw();
    }

    function listen() {
      const ok = start({
        onInterim: setLive,
        onFinal: function (t) { setLive(''); apply(t); },
        onEnd: function () { draw(); }
      });
      if (ok) draw();
    }

    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKey);
    draw();
    listen();
  }

  /** フォームの入力欄を、音声ウィザードで順に埋める。
   *  defs: [{ name, label, hint, type, options }] — name はフォーム内の name 属性 */
  function fillForm(form, defs, title) {
    const steps = [];
    defs.forEach(function (d) {
      const el = form.querySelector('[name="' + String(d.name).replace(/"/g, '\\"') + '"]');
      if (!el) return;
      steps.push({
        key: d.name, label: d.label, hint: d.hint,
        type: d.type || (el.tagName === 'TEXTAREA' ? 'textarea'
                        : el.tagName === 'SELECT' ? 'select'
                        : el.type === 'date' ? 'date' : 'text'),
        options: d.options || (el.tagName === 'SELECT'
          ? Array.prototype.map.call(el.options, function (o) { return o.value; }) : null),
        value: el.value
      });
    });
    if (!steps.length) { UI.toast('音声で入力できる項目が見つかりませんでした', 'warn'); return; }

    wizard({
      title: title || '音声で入力',
      steps: steps,
      onFinish: function (values) {
        let n = 0;
        Object.keys(values).forEach(function (name) {
          const el = form.querySelector('[name="' + name.replace(/"/g, '\\"') + '"]');
          if (!el) return;
          if (el.value !== values[name]) n++;
          el.value = values[name];
          el.dispatchEvent(new Event('change', { bubbles: true }));
        });
        UI.toast(n + '項目に音声入力の内容を反映しました。内容を確認して保存してください。');
      }
    });
  }

  /* =======================================================================
   * 3. アセスメントの音声採点
   *    items: [{ id, domainName, color, month, text }]
   *    onScore(id, score|null)  score: 2=できる 1=芽生え 0=これから
   * ===================================================================== */
  const SCORE_WORDS = [
    { score: 2, words: ['できる', '出来る', 'はい', 'まる', 'マル', '丸', 'オッケー', 'オーケー', 'よくできる'] },
    { score: 1, words: ['芽生え', 'めばえ', 'さんかく', '三角', 'ときどき', '時々', 'たまに', 'もう少し'] },
    { score: 0, words: ['これから', 'まだ', 'いいえ', 'ばつ', 'バツ', '×', 'できない', '出来ない'] }
  ];

  function scoreOf(text) {
    for (const s of SCORE_WORDS) if (wholeMatch(text, s.words)) return s.score;
    return null;
  }

  function scoring(cfg) {
    const items = cfg.items || [];
    if (!items.length) { UI.toast('採点する項目がありません', 'warn'); return; }
    if (!supported()) { UI.toast(envWarning(), 'warn'); return; }

    let i = 0;
    const body = h('div', { class: 'voice-wiz' });
    const overlay = h('div', { class: 'modal-overlay', id: 'voice-modal' },
      h('div', { class: 'modal-box wiz-box' }, [
        h('div', { class: 'modal-head' }, [
          h('h2', {}, '音声でアセスメント'),
          h('button', { class: 'modal-close', 'aria-label': '閉じる', onclick: close }, '×')
        ]),
        body
      ]));

    function close() {
      stop();
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      if (cfg.onEnd) cfg.onEnd();
    }
    function onKey(e) { if (e.key === 'Escape') close(); }

    function draw() {
      if (i >= items.length) { UI.toast('すべての項目が終わりました'); close(); return; }
      const it = items[i];
      UI.clear(body);

      body.appendChild(h('div', { class: 'vw-top' }, [
        h('div', { class: 'vw-progress' }, (i + 1) + ' / ' + items.length),
        h('div', { class: 'vw-bar' }, h('div', {
          class: 'vw-bar-fill', style: 'width:' + ((i + 1) / items.length * 100) + '%'
        })),
        h('div', { class: 'vw-state' + (listening() ? ' on' : '') },
          listening() ? '● 聞き取り中' : '■ 停止中')
      ]));

      body.appendChild(h('div', { class: 'vw-domain' }, [
        h('span', { class: 'dot', style: 'background:' + it.color }),
        it.domainName,
        h('span', { class: 'vw-month' }, it.month + 'か月ごろ')
      ]));
      body.appendChild(h('div', { class: 'vw-item' }, it.text));
      body.appendChild(h('div', { class: 'vw-live', id: 'vw-live' }, ''));

      body.appendChild(h('div', { class: 'vw-choices big' }, DATA.SCORES.map(function (sc) {
        return h('button', {
          type: 'button', class: 'vw-choice s' + sc.value + (it.score === sc.value ? ' on' : ''),
          onclick: function () { record(sc.value); }
        }, [h('strong', {}, sc.label), h('span', {}, sc.desc)]);
      })));

      body.appendChild(h('div', { class: 'vw-cmds' },
        '声で操作:「できる」「芽生え」「これから」で採点して次へ。' +
        '「とばす」で飛ばす、「戻る」で前、「終了」で終わります。'));

      body.appendChild(h('div', { class: 'vw-actions' }, [
        h('button', { type: 'button', class: 'btn', disabled: i === 0, onclick: function () { i--; draw(); } }, '← 戻る'),
        h('button', { type: 'button', class: 'btn ghost', onclick: function () { i++; draw(); } }, 'とばす'),
        h('button', {
          type: 'button', class: 'btn ' + (listening() ? 'danger' : 'primary'),
          onclick: function () { listening() ? (stop(), draw()) : listen(); }
        }, listening() ? '■ マイクを止める' : '🎤 マイクを使う'),
        h('button', { type: 'button', class: 'btn', onclick: close }, '終わる')
      ]));
    }

    function record(score) {
      const it = items[i];
      it.score = score;
      if (cfg.onScore) cfg.onScore(it.id, score);
      i++;
      draw();
    }

    function setLive(t) {
      const el = UI.$('#vw-live', body);
      if (el) el.textContent = t || '';
    }

    function apply(text) {
      if (wholeMatch(text, ['終了', 'しゅうりょう', '終わり', 'おわり', 'やめる'])) { close(); return; }
      if (wholeMatch(text, ['戻る', 'もどる', '前', 'まえ'])) { i = Math.max(0, i - 1); draw(); return; }
      if (wholeMatch(text, ['とばす', '飛ばす', 'スキップ', '次', 'つぎ', '次へ', 'つぎへ'])) { i++; draw(); return; }
      const s = scoreOf(text);
      if (s !== null) { record(s); return; }
      UI.toast('「' + text + '」は聞き取れませんでした。「できる」「芽生え」「これから」と言ってください。', 'warn');
    }

    function listen() {
      const ok = start({
        onInterim: setLive,
        onFinal: function (t) { setLive(''); apply(t); },
        onEnd: function () { draw(); }
      });
      if (ok) draw();
    }

    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKey);
    draw();
    listen();
  }

  return {
    supported: supported, envWarning: envWarning, consent: consent,
    start: start, stop: stop, listening: listening,
    normalize: normalize, command: command, parseDate: parseDate, wholeMatch: wholeMatch,
    micButton: micButton, attachMics: attachMics, fillForm: fillForm,
    wizard: wizard, scoring: scoring
  };
})();
