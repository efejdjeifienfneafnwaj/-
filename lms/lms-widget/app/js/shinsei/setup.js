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

  /**
   * 社員が1人もいない＝まだ誰も入れない状態。
   * 「読み取りに失敗して0件に見えている」ときは初回扱いにしない。
   * 失敗を初回と取り違えると、登録済みの人がもう一度作られてしまう。
   */
  function isFirstRun() {
    if (S().loadFailed && S().loadFailed.Employees) return false;
    return !S().employees || S().employees.length === 0;
  }

  /** セットアップの進み具合。保存せず、その時点のデータから毎回判定する */
  function steps() {
    var emps = (S().employees || []).filter(function (e) { return e.Is_Active !== false; });
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
      /* 未接続のまま登録しても、その内容は開いている端末の中にしか残らない。
         ポータルから開いてこの画面が出た場合は、ほぼ接続の問題なので先に知らせる。 */
      (DB.isConnected() ? '' :
        '<div class="card" style="border-color:var(--warning);margin-bottom:14px"><div class="card-body">' +
        '<b>Zoho Creator に接続されていません。</b>' +
        '<div class="page-sub" style="margin-top:6px">' +
        'このまま登録しても、内容はこの端末の中にしか残りません（お試し用の動作です）。' +
        'ポータルから開いていてこの表示が出る場合は、ウィジェットがまだアップロードされていないか、' +
        'ポータルにレポートが共有されていない可能性があります。' +
        'すでに管理者を登録済みであれば、この画面で登録し直さず、システム管理者にご確認ください。' +
        '</div></div></div>') +
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
      '権限は「システム管理者」で登録されます。以後、このメールアドレスでポータルにログインすると、' +
      'すべての設定と元データを編集できます。入力した部署名は、部署マスタにも同時に登録されます。' +
      '</div>' +
      '<div class="inline-row" style="margin-top:16px">' +
      '<button class="btn btn-primary" id="su_go">この内容で始める</button>' +
      '</div>' +
      '</div></div>' +
      '<div class="card"><div class="card-head"><div class="card-title">このあとの流れ</div></div>' +
      '<div class="card-body"><ol class="setup-list">' +
      '<li>部署を登録する</li>' +
      '<li>社員を登録する（記入用の様式を書き出して、記入して、取り込む）</li>' +
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

    /* 書き込む直前に、もう一度社員マスタを読み直す。
       別の画面やポータルから先に登録されていた場合、ここで気づかないと
       同じ人が二重に登録され、以後どちらのレコードで照合されるか分からなくなる。 */
    DB.list('Employees').catch(function () { return null; }).then(function (rows) {
      if (rows === null) {
        btn.disabled = false; btn.textContent = 'この内容で始める';
        UI.toast('社員マスタを確認できませんでした。通信状況を確かめて、もう一度お試しください。', 'error');
        return null;
      }
      if (rows.length) {
        /* すでに誰かが登録済み。ここでは作らず、通常の本人確認に進む。 */
        UI.toast('すでに ' + rows.length + ' 名が登録されています。登録はせずに開きます。', 'warn');
        App.boot();
        return null;
      }
      return createRecords(el, btn, { email: email, name: name, dept: dept, title: title, kana: kana, no: no });
    });
  }

  function createRecords(el, btn, v) {
    var email = v.email, name = v.name, dept = v.dept, title = v.title, kana = v.kana, no = v.no;
    /* 部署 → 社員 の順に作る。社員は部署名で紐づくため */
    return DB.add('Departments', {
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
   * 画面の下に出す「セットアップの続き」（管理者のみ）
   * ===================================================================== */
  function progressCard() {
    var rest = remaining();
    if (!rest.length) return '';
    var all = steps();
    var doneCount = all.length - rest.length;
    return '<div class="card" style="margin-top:18px;border-color:var(--border-strong)">' +
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
    isFirstRun: isFirstRun, renderFirstRun: renderFirstRun,
    steps: steps, remaining: remaining, progressCard: progressCard, bindProgress: bindProgress
  };
})();
