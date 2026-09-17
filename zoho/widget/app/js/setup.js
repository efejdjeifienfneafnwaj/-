/* =========================================================================
 * setup.js — 初回セットアップ
 *
 *  社員マスタが空のとき、誰もログインできない。照合する相手がいないため。
 *  そこで「社員が0件のときだけ」、ログイン中の人を最初の管理者として受け入れる。
 *  1件でも登録されたら、以降は通常の照合に戻り、この画面は二度と開かない。
 *
 *  誰が最初のセットアップを始めたかは、証跡の一番最初に記録する。
 * ========================================================================= */
var Setup = (function () {
  var E = UI.esc;
  var S = function () { return App.state; };

  /** 社員が1人もいない＝まだ誰も入れない状態 */
  function isFirstRun() {
    return !S().employees || S().employees.length === 0;
  }

  /** セットアップの進み具合。保存せず、その時点のデータから毎回判定する */
  function steps() {
    var emps = (S().employees || []).filter(function (e) { return e.Is_Active !== false; });
    var admins = emps.filter(function (e) { return Perm.normalizeRoles(e.Roles || [])[0] === CFG.ROLE_ADMIN; });
    var me = App.me();
    var selfRegistered = !!(me && me.ID);
    var diag = selfRegistered ? diagnoseAll() : { fatal: 1 };
    return [
      { key: 'self',  label: 'あなたを登録する',
        done: selfRegistered,
        detail: selfRegistered ? me.Employee_Name + '（' + (me.Department_name || '') + '／' + me.Title + '）' : '未登録',
        hint: 'ログイン中のメールアドレスで、最初の管理者として登録します。' },
      { key: 'dept',  label: '部署を登録する',
        done: (S().departments || []).length > 0,
        detail: (S().departments || []).length + ' 件',
        hint: '社員の所属と承認経路が、この部署名で紐づきます。先に登録してください。',
        go: 'admin?tab=Departments' },
      { key: 'emp',   label: '社員を登録する',
        done: emps.length >= 2,
        detail: emps.length + ' 名',
        hint: '「記入用の様式を書き出す」で出したファイルに記入して、取り込むのが早いです。',
        go: 'admin?tab=Employees' },
      { key: 'admin', label: '管理者を2人以上にする',
        done: admins.length >= 2,
        detail: admins.length + ' 名（' + admins.slice(0, 3).map(function (e) { return e.Employee_Name; }).join('・') + '）',
        hint: '1人だけだと、その人が異動・退職した時に誰も設定を変えられなくなります。',
        go: 'admin?tab=Employees' },
      { key: 'acc',   label: '勘定科目を登録する',
        done: (S().accounts || []).length > 0,
        detail: (S().accounts || []).length + ' 件',
        hint: '経費精算・購買申請の明細で使います。空のままだとこの2つの申請が出せません。標準の科目をその場で入れられます。',
        go: 'admin?tab=Accounts' },
      { key: 'route', label: '承認経路を確かめる',
        done: selfRegistered && emps.length >= 2 && diag.fatal === 0,
        detail: !selfRegistered ? '—' : (diag.fatal === 0 ? '全員で成立しています' : diag.fatal + ' 名で本来の承認者が決まりません'),
        hint: '「全社員で診断する」で、承認者が決まらない人がいないか確認します。' +
              '承認者が未登録の段は、暫定でシステム管理者に回ります（申請は止まりませんが、決裁者は本来の人に直してください）。',
        go: 'routes' }
    ];
  }

  /**
   * 全申請区分 × 全社員で、経路が成立しない人を数える。
   * 「管理者が肩代わりしている段」も未完了として数える。
   * 肩代わりのおかげで申請は通るが、本来の決裁者が決まっていない状態のため、
   * セットアップ完了とは呼べない。
   */
  function diagnoseAll() {
    var emps = (S().employees || []).filter(function (e) { return e.Is_Active !== false; });
    if (!emps.length) return { fatal: 0 };
    var fatal = 0;
    emps.forEach(function (ap) {
      var broken = App.templates().some(function (t) {
        var route = WF.buildRoute(t, {}, ap, S().employees,
          { data: {}, applicant: ap, amount: 0, template: t, attachmentCount: 0 });
        if (!WF.isRoutable(route)) return true;
        return route.some(function (s) {
          return !s.skipped && (s.fallbackAdmin || (s.selfApproval && !s.selfApprovalOrgTop));
        });
      });
      if (broken) fatal++;
    });
    return { fatal: fatal };
  }

  function remaining() { return steps().filter(function (s) { return !s.done; }); }

  /* =======================================================================
   * システム管理者のパスワード
   *
   *  本人確認そのものは Zoho のポータルログインが行う。ここで足すのは
   *  「管理者の画面に入るときだけ、もう一度本人に確認する」ための鍵。
   *  共有端末で開きっぱなしのまま、他の人がマスタや経路をさわるのを防ぐ。
   *  一般利用者にはパスワードは無い（ポータルにログインできた時点で申請・承認はできる）。
   * ===================================================================== */
  var AUTH_KEY = 'admin_ok_';

  /** 端末ごとの乱数。同じパスワードでも保存される値が人ごとに変わる。 */
  function newSalt() {
    var a = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(a);
    else for (var i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  /**
   * パスワードを保存できる形にする。
   * https で開かれた Creator 上では SHA-256 を使う。
   * file:// での動作確認時は crypto.subtle が使えないため簡易計算に落ちる。
   * （その場合は保存先も端末内のみで、実運用の経路には乗らない）
   */
  function hashPass(salt, pw) {
    var text = salt + '\u0000' + pw;
    if (window.crypto && window.crypto.subtle && window.TextEncoder) {
      return window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
        .then(function (buf) {
          return 'sha256:' + Array.prototype.map.call(new Uint8Array(buf), function (b) {
            return ('0' + b.toString(16)).slice(-2);
          }).join('');
        })
        .catch(function () { return weak(text); });
    }
    return Promise.resolve(weak(text));
  }
  function weak(text) {
    var h1 = 0x811c9dc5, h2 = 0x01000193;
    for (var i = 0; i < text.length; i++) {
      h1 = ((h1 ^ text.charCodeAt(i)) * 16777619) >>> 0;
      h2 = ((h2 + text.charCodeAt(i) * (i + 7)) * 2246822519) >>> 0;
    }
    return 'weak:' + h1.toString(16) + h2.toString(16);
  }

  function hasPassword(emp) { return !!(emp && emp.Admin_Pass); }
  /** この画面を開いている間、すでにパスワードを通したか */
  function unlocked(emp) {
    if (!emp) return false;
    try { return sessionStorage.getItem(AUTH_KEY + emp.ID) === '1'; } catch (e) { return false; }
  }
  function markUnlocked(emp, on) {
    try {
      if (on) sessionStorage.setItem(AUTH_KEY + emp.ID, '1');
      else sessionStorage.removeItem(AUTH_KEY + emp.ID);
    } catch (e) { /* プライベートモードなどで使えなくても、その回だけ通せばよい */ }
  }

  function savePassword(emp, pw) {
    var salt = newSalt();
    return hashPass(salt, pw).then(function (hash) {
      return DB.update('Employees', emp.ID, { Admin_Pass: hash, Admin_Salt: salt })
        .then(function () { emp.Admin_Pass = hash; emp.Admin_Salt = salt; });
    });
  }
  function verifyPassword(emp, pw) {
    return hashPass(emp.Admin_Salt || '', pw).then(function (hash) { return hash === emp.Admin_Pass; });
  }

  /* 管理者パスワードの画面。解錠できたら onDone(true)、一般利用者として続けるなら onDone(false) */
  function renderAdminGate(el, emp, onDone) {
    var first = !hasPassword(emp);
    var tries = 0;
    function paint(msg) {
      el.innerHTML =
        '<div class="setup-wrap">' +
        '<div class="setup-head">' +
        '<div class="setup-badge">' + (first ? '管理者パスワードの設定' : '管理者パスワードの確認') + '</div>' +
        '<h1>' + E(emp.Employee_Name) + ' さん</h1>' +
        '<p>' + (first
          ? 'あなたはシステム管理者です。設定と元データを開くためのパスワードを決めてください。' +
            '以後、この画面を開くたびに入力します。'
          : '設定と元データを開くには、管理者パスワードを入力してください。') + '</p>' +
        '</div>' +
        '<div class="card"><div class="card-body">' +
        (msg ? '<div class="badge b-rejected" style="display:block;padding:8px 12px;margin-bottom:12px">' + E(msg) + '</div>' : '') +
        '<div class="form-grid">' +
        '<div class="field full"><label>パスワード<span class="req">*</span></label>' +
        '<input id="ag_pw" type="password" autocomplete="' + (first ? 'new-password' : 'current-password') + '">' +
        (first ? '<div class="help">8文字以上。英字と数字を混ぜてください。</div>' : '') + '</div>' +
        (first ? '<div class="field full"><label>パスワード（確認）<span class="req">*</span></label>' +
          '<input id="ag_pw2" type="password" autocomplete="new-password"></div>' : '') +
        '</div>' +
        '<div class="inline-row" style="margin-top:16px">' +
        '<button class="btn btn-primary" id="ag_go">' + (first ? 'このパスワードにする' : '管理者として入る') + '</button>' +
        '<button class="btn" id="ag_skip">一般利用者として使う（申請・承認のみ）</button>' +
        '</div>' +
        '<div class="page-sub" style="margin-top:12px">' +
        'このパスワードは、管理画面を開くための鍵です。ポータルへのログインそのものは Zoho が確認しています。' +
        '忘れた場合は、ほかのシステム管理者に解除してもらってください。' +
        '</div>' +
        '</div></div></div>';

      el.querySelector('#ag_skip').addEventListener('click', function () {
        Access.log(CFG.ACCESS.ACTIONS.LOGIN, { targetType: '管理者パスワード', detail: '一般利用者として利用を継続' });
        onDone(false);
      });
      el.querySelector('#ag_go').addEventListener('click', submit);
      el.querySelector('#ag_pw').addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
      var pw2 = el.querySelector('#ag_pw2');
      if (pw2) pw2.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
      el.querySelector('#ag_pw').focus();
    }

    function submit() {
      var pw = el.querySelector('#ag_pw').value;
      if (first) {
        var pw2v = el.querySelector('#ag_pw2').value;
        if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) { paint('8文字以上で、英字と数字を混ぜてください。'); return; }
        if (pw !== pw2v) { paint('確認用のパスワードが一致しません。'); return; }
        savePassword(emp, pw).then(function () {
          App.audit('管理者パスワード設定', '社員', emp.ID, emp.Employee_Name + ' が管理者パスワードを設定');
          markUnlocked(emp, true);
          UI.toast('管理者パスワードを設定しました', 'success');
          onDone(true);
        }).catch(function (e) { paint('保存に失敗しました：' + (e && e.message ? e.message : e)); });
        return;
      }
      verifyPassword(emp, pw).then(function (ok) {
        if (ok) {
          markUnlocked(emp, true);
          Access.log(CFG.ACCESS.ACTIONS.LOGIN, { targetType: '管理者パスワード', detail: '管理者として解錠' });
          onDone(true);
          return;
        }
        tries++;
        Access.denied('管理者パスワード', 'パスワード誤り（' + tries + '回目）');
        paint(tries >= 3
          ? 'パスワードが違います（' + tries + '回目）。誤りは記録されています。'
          : 'パスワードが違います。もう一度入力してください。');
      });
    }
    paint('');
  }

  /** 管理者パスワードを解除する（別のシステム管理者だけができる） */
  function resetPassword(emp) {
    if (!Perm.isAdmin(App.me())) { UI.toast('システム管理者だけが解除できます', 'error'); return; }
    UI.confirmBox('管理者パスワードの解除',
      emp.Employee_Name + ' さんの管理者パスワードを解除します。次回ログイン時に本人が設定し直します。',
      '解除する', 'btn-warning').then(function (ok) {
      if (!ok) return;
      DB.update('Employees', emp.ID, { Admin_Pass: '', Admin_Salt: '' }).then(function () {
        emp.Admin_Pass = ''; emp.Admin_Salt = '';
        markUnlocked(emp, false);
        App.audit('管理者パスワード解除', '社員', emp.ID,
          App.me().Employee_Name + ' が ' + emp.Employee_Name + ' の管理者パスワードを解除');
        UI.toast('解除しました', 'success');
        App.refresh();
      }).catch(function (e) { UI.toast('解除に失敗しました：' + (e && e.message ? e.message : e), 'error'); });
    });
  }

  /* =======================================================================
   * 初回の画面（社員が0件のときだけ出る）
   * ===================================================================== */
  function renderFirstRun(el) {
    var p = DB.initParams() || {};
    var email = p.loginUser || p.loginuser || '';

    el.innerHTML =
      '<div class="setup-wrap">' +
      '<div class="setup-head">' +
      '<div class="setup-badge">初回セットアップ</div>' +
      '<h1>社内申請システムを使い始めます</h1>' +
      '<p>まだ社員が1人も登録されていません。' +
      'いま開いているあなたを、最初の管理者として登録します。</p>' +
      '</div>' +
      '<div class="card"><div class="card-body">' +
      '<div class="form-grid">' +
      '<div class="field full"><label>メールアドレス</label>' +
      '<input id="su_email" value="' + E(email) + '"' + (email ? ' readonly' : '') + '>' +
      '<div class="help">' + (email
        ? 'ログイン中のアドレスです。これが今後の本人確認に使われます。'
        : 'Creator に接続されていないため自動入力できません。実際に使うアドレスを入れてください。') + '</div></div>' +
      '<div class="field"><label>氏名<span class="req">*</span></label><input id="su_name" placeholder="山田 太郎"></div>' +
      '<div class="field"><label>フリガナ</label><input id="su_kana" placeholder="ヤマダ タロウ"></div>' +
      '<div class="field"><label>部署名<span class="req">*</span></label><input id="su_dept" placeholder="情報システム部"></div>' +
      '<div class="field"><label>役職<span class="req">*</span></label><select id="su_title">' +
      CFG.TITLES.map(function (t) { return '<option' + (t === '課長' ? ' selected' : '') + '>' + E(t) + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="field"><label>社員番号</label><input id="su_no" placeholder="S0001"></div>' +
      '</div>' +
      '<div class="page-sub" style="margin-top:12px">' +
      '権限は「システム管理者」で登録されます。次の画面で管理者パスワードを決めてもらいます。' +
      '入力した部署名は、部署マスタにも同時に登録されます。' +
      '</div>' +
      '<div class="inline-row" style="margin-top:16px">' +
      '<button class="btn btn-primary" id="su_go">この内容で始める</button>' +
      '</div>' +
      '</div></div>' +
      '<div class="card"><div class="card-head"><div class="card-title">このあとの流れ</div></div>' +
      '<div class="card-body"><ol class="setup-list">' +
      '<li>部署を登録する</li>' +
      '<li>社員を登録する（記入用の様式を書き出して、記入して、取り込む）</li>' +
      '<li>管理者を2人以上にする</li>' +
      '<li>勘定科目を登録する（標準の科目をそのまま入れられます）</li>' +
      '<li>承認経路を確かめる（全社員で診断）</li>' +
      '<li>社員をポータルに招待する</li>' +
      '</ol>' +
      '<div class="page-sub">一度で終える必要はありません。残りはダッシュボードに表示され続けます。</div>' +
      '</div></div>' +
      '</div>';

    el.querySelector('#su_go').addEventListener('click', function () { createFirstAdmin(el); });
  }

  function createFirstAdmin(el) {
    var email = el.querySelector('#su_email').value.trim();
    var name = el.querySelector('#su_name').value.trim();
    var dept = el.querySelector('#su_dept').value.trim();
    var title = el.querySelector('#su_title').value;
    var kana = el.querySelector('#su_kana').value.trim();
    var no = el.querySelector('#su_no').value.trim();

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { UI.toast('メールアドレスを正しく入れてください', 'error'); return; }
    if (!name) { UI.toast('氏名を入れてください', 'error'); return; }
    if (!dept) { UI.toast('部署名を入れてください', 'error'); return; }

    var btn = el.querySelector('#su_go');
    btn.disabled = true; btn.textContent = '登録しています…';

    /* 部署 → 社員 の順に作る。社員は部署名で紐づくため */
    DB.add('Departments', {
      Department_Code: 'D001', Department_Name: dept, Parent_Department: '', Sort_Order: 1
    }).then(function (d) {
      S().departments.push(d);
      return DB.add('Employees', {
        Employee_ID: no || 'S0001', Employee_Name: name, Employee_Kana: kana, Email: email,
        Department_name: dept, Department: dept, Title: title, Manager: '', Manager_name: '',
        Roles: [CFG.ROLE_ADMIN], Join_Date: '', Paid_Leave_Balance: 0,
        Deputy: '', Deputy_From: '', Deputy_To: '', Is_Active: true
      });
    }).then(function (e) {
      S().employees.push(e);
      /* 誰がセットアップを開始したかを、証跡の一番最初に残す */
      Access.log(CFG.ACCESS.ACTIONS.LOGIN, {
        targetType: '初回セットアップ',
        detail: '最初の管理者として ' + name + '（' + email + '）を登録'
      });
      App.audit('初回セットアップ', '社員', e.ID, '最初の管理者：' + name + ' / ' + email + ' / ' + dept + ' / ' + title);
      UI.toast('登録しました。続けて部署と社員を登録してください。', 'success');
      App.boot();   // 本人確認をやり直して通常の画面に入る
    }).catch(function (err) {
      btn.disabled = false; btn.textContent = 'この内容で始める';
      UI.toast('登録に失敗しました：' + (err && err.message ? err.message : err), 'error');
    });
  }

  /* =======================================================================
   * ダッシュボードに出す「セットアップの続き」
   * ===================================================================== */
  function progressCard() {
    var rest = remaining();
    if (!rest.length) return '';
    var all = steps();
    var doneCount = all.length - rest.length;
    return '<div class="card" style="margin-bottom:14px;border-color:var(--warning)">' +
      '<div class="card-head"><div class="card-title">セットアップの続き（' + doneCount + '/' + all.length + '）</div>' +
      '<span class="tag" style="margin-left:auto">管理者にのみ表示されます</span></div>' +
      '<div class="table-wrap"><table class="tbl"><tbody>' +
      all.map(function (s) {
        return '<tr><td class="nowrap" style="width:34px">' + (s.done ? '<span class="badge b-approved">済</span>' : '<span class="badge b-sentback">未</span>') + '</td>' +
          '<td><strong>' + E(s.label) + '</strong><div class="page-sub">' + E(s.hint) + '</div></td>' +
          '<td class="nowrap">' + E(s.detail) + '</td>' +
          '<td class="nowrap">' + (!s.done && s.go ? '<button class="btn btn-sm" data-setupgo="' + E(s.go) + '">開く</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="card-body" style="padding-top:10px"><div class="page-sub">' +
      '社員の登録が済んだら、Creator の設定からポータルユーザーとして招待してください。' +
      '招待されるのは、ここに登録したメールアドレスの人です。</div></div></div>';
  }

  function bindProgress(el) {
    el.querySelectorAll('[data-setupgo]').forEach(function (b) {
      b.addEventListener('click', function () { App.go(b.dataset.setupgo); });
    });
  }

  return {
    renderAdminGate: renderAdminGate, hasPassword: hasPassword, unlocked: unlocked,
    markUnlocked: markUnlocked, resetPassword: resetPassword,
    isFirstRun: isFirstRun, renderFirstRun: renderFirstRun,
    steps: steps, remaining: remaining, progressCard: progressCard, bindProgress: bindProgress
  };
})();
