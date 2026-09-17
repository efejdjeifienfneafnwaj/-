/* =========================================================================
 * seed.js — デモモード用の初期データ（Creator 未接続時のみ使用）
 * 本番（Creator接続時）はこのファイルのデータは一切使われません。
 * ========================================================================= */
var Seed = (function () {
  function empty() {
    return { Employees: [], Departments: [], Vendors: [], Accounts: [], RequestTypes: [], Requests: [], RequestLines: [], Approvals: [], RouteRules: [], AuditLogs: [], AccessLogs: [], Notifications: [], Files: [] };
  }
  /**
   * 日本時間の h 時ちょうど付近を表す ISO 文字列（UTC）を作る。
   * 保存は UTC、判定は日本時間という前提に合わせるため、
   * 意図した「日本時間の時刻」から9時間引いて組み立てる。
   */
  function d(offsetDays, h) {
    var x = new Date(); x.setDate(x.getDate() + offsetDays);
    if (h == null) return x.toISOString();
    var utc = Date.UTC(x.getFullYear(), x.getMonth(), x.getDate(), h - 9, Math.floor(Math.random() * 60), 0, 0);
    return new Date(utc).toISOString();
  }
  function ymd(offsetDays) { var x = new Date(); x.setDate(x.getDate() + offsetDays); return x.toISOString().slice(0, 10); }

  function build() {
    var db = empty();

    db.Departments = [
      { ID: 'd1', Department_Code: 'D100', Department_Name: '経営企画部', Parent_Department: '' },
      { ID: 'd2', Department_Code: 'D200', Department_Name: '営業本部', Parent_Department: '' },
      { ID: 'd3', Department_Code: 'D210', Department_Name: '第一営業部', Parent_Department: 'd2' },
      { ID: 'd4', Department_Code: 'D220', Department_Name: '第二営業部', Parent_Department: 'd2' },
      { ID: 'd5', Department_Code: 'D300', Department_Name: '管理本部', Parent_Department: '' },
      { ID: 'd6', Department_Code: 'D310', Department_Name: '総務部', Parent_Department: 'd5' },
      { ID: 'd7', Department_Code: 'D320', Department_Name: '経理部', Parent_Department: 'd5' },
      { ID: 'd8', Department_Code: 'D330', Department_Name: '人事部', Parent_Department: 'd5' },
      { ID: 'd9', Department_Code: 'D400', Department_Name: '開発部', Parent_Department: '' },
      { ID: 'd10', Department_Code: 'D500', Department_Name: 'カスタマーサクセス部', Parent_Department: '' }
    ];

    var E = [
      ['e1', 'S0001', '高橋 誠一', 'タカハシ セイイチ', '社長', '経営企画部', '', ['承認者', '管理者'], -4000],
      ['e2', 'S0002', '田中 浩之', 'タナカ ヒロユキ', '本部長', '営業本部', 'e1', ['承認者'], -3200],
      ['e3', 'S0003', '鈴木 由美', 'スズキ ユミ', '部長', '第一営業部', 'e2', ['承認者'], -2800],
      ['e4', 'S0004', '佐藤 健太', 'サトウ ケンタ', '課長', '第一営業部', 'e3', ['承認者', '申請者'], -2100],
      ['e5', 'S0005', '山田 直樹', 'ヤマダ ナオキ', '一般', '第一営業部', 'e4', ['申請者'], -900],
      ['e6', 'S0006', '伊藤 麻衣', 'イトウ マイ', '主任', '第一営業部', 'e4', ['申請者'], -1500],
      ['e7', 'S0007', '渡辺 翔', 'ワタナベ ショウ', '一般', '第二営業部', 'e8', ['申請者'], -700],
      ['e8', 'S0008', '中村 剛', 'ナカムラ ツヨシ', '部長', '第二営業部', 'e2', ['承認者'], -2600],
      ['e9', 'S0009', '小林 恵子', 'コバヤシ ケイコ', '本部長', '管理本部', 'e1', ['承認者', '管理者'], -3400],
      ['e10', 'S0010', '加藤 裕子', 'カトウ ユウコ', '部長', '経理部', 'e9', ['承認者', '経理'], -2900],
      ['e11', 'S0011', '吉田 大輔', 'ヨシダ ダイスケ', '課長', '経理部', 'e10', ['経理', '申請者'], -1800],
      ['e12', 'S0012', '山本 千秋', 'ヤマモト チアキ', '部長', '人事部', 'e9', ['承認者', '人事'], -2700],
      ['e13', 'S0013', '松本 亮', 'マツモト リョウ', '課長', '人事部', 'e12', ['人事', '申請者'], -1600],
      ['e14', 'S0014', '井上 彩', 'イノウエ アヤ', '課長', '総務部', 'e9', ['申請者', '承認者'], -2000],
      ['e15', 'S0015', '木村 隆', 'キムラ タカシ', '部長', '開発部', 'e1', ['承認者'], -2500],
      ['e16', 'S0016', '林 智也', 'ハヤシ トモヤ', '主任', '開発部', 'e15', ['申請者', '管理者'], -1200],
      ['e17', 'S0017', '清水 美穂', 'シミズ ミホ', '一般', '開発部', 'e15', ['申請者'], -600],
      ['e18', 'S0018', '斎藤 学', 'サイトウ マナブ', '部長', 'カスタマーサクセス部', 'e1', ['承認者'], -2400],
      ['e19', 'S0019', '森 優子', 'モリ ユウコ', '一般', 'カスタマーサクセス部', 'e18', ['申請者'], -500],
      ['e20', 'S0020', '池田 亮介', 'イケダ リョウスケ', '一般', '総務部', 'e14', ['申請者'], -400]
    ];
    db.Employees = E.map(function (r) {
      return {
        ID: r[0], Employee_ID: r[1], Employee_Name: r[2], Employee_Kana: r[3], Title: r[4],
        Department: r[5], Department_name: r[5], Manager: r[6], Manager_name: (E.filter(function (x) { return x[0] === r[6]; })[0] || [])[2] || '',
        Roles: r[7], Join_Date: ymd(r[8]), Email: r[1].toLowerCase() + '@sunrise-trading.co.jp',
        Paid_Leave_Balance: 10 + Math.floor(Math.random() * 11), Is_Active: true,
        Deputy: '', Deputy_From: '', Deputy_To: ''
      };
    });
    /* 代理承認のデモ：鈴木部長が不在期間、佐藤課長が職務代行 */
    db.Employees[2].Deputy = 'e4'; db.Employees[2].Deputy_From = ymd(-3); db.Employees[2].Deputy_To = ymd(7);

    db.Vendors = [
      ['v1', 'V001', '株式会社ニホンオフィス', 'T1234567890123', true], ['v2', 'V002', 'サクラ電機株式会社', 'T2345678901234', true],
      ['v3', 'V003', '有限会社みどり印刷', 'T3456789012345', true], ['v4', 'V004', 'クラウドワークス合同会社', '', false],
      ['v5', 'V005', '東京ビジネスホテル', 'T4567890123456', true], ['v6', 'V006', '株式会社アオゾラ広告', 'T5678901234567', true],
      ['v7', 'V007', 'フリーランス 佐々木', '', false], ['v8', 'V008', '西日本物流株式会社', 'T6789012345678', true],
      ['v9', 'V009', '株式会社テックサポート', 'T7890123456789', true], ['v10', 'V010', 'グリーンケータリング', 'T8901234567890', true],
      ['v11', 'V011', '丸山法律事務所', 'T9012345678901', true], ['v12', 'V012', '個人タクシー 高木', '', false]
    ].map(function (r) { return { ID: r[0], Vendor_Code: r[1], Vendor_Name: r[2], Invoice_Reg_No: r[3], Is_Qualified: r[4] }; });

    db.Accounts = [
      ['a1', '5110', '旅費交通費', '課税10%'], ['a2', '5120', '会議費', '課税10%'], ['a3', '5130', '接待交際費', '課税10%'],
      ['a4', '5140', '消耗品費', '課税10%'], ['a5', '5150', '通信費', '課税10%'], ['a6', '5160', '支払手数料', '課税10%'],
      ['a7', '5170', '外注費', '課税10%'], ['a8', '5180', '広告宣伝費', '課税10%'], ['a9', '5190', '地代家賃', '非課税'],
      ['a10', '5200', '水道光熱費', '課税10%'], ['a11', '5210', '新聞図書費', '課税10%'], ['a12', '5220', '研修費', '課税10%'],
      ['a13', '5230', '福利厚生費', '課税10%'], ['a14', '5240', '租税公課', '不課税'], ['a15', '5250', '荷造運賃', '課税10%'],
      ['a16', '5260', '車両費', '課税10%'], ['a17', '5270', '保険料', '非課税'], ['a18', '5280', '減価償却費', '不課税'],
      ['a19', '5290', '雑費', '課税10%'], ['a20', '5300', '会費・諸会費', '不課税']
    ].map(function (r) { return { ID: r[0], Account_Code: r[1], Account_Name: r[2], Tax_Category: r[3] }; });

    db.RequestTypes = TEMPLATES.map(function (t, i) {
      return {
        ID: 'rt' + (i + 1), Type_Code: t.code, Type_Name: t.name, Category: t.category, Icon: t.icon,
        Description: t.desc, Field_Schema: JSON.stringify({ fields: t.fields }), Route_Rule: JSON.stringify(t.route),
        Sensitivity: CFG.ACCESS.SENSITIVITY[t.code] || 'C', Is_Active: true, Sort_Order: i + 1
      };
    });

    /* ---- 申請データ生成 ---- */
    var subjects = {
      RINGI: ['営業支援システム導入の件', 'CRM年間ライセンス更新の件', '展示会出展費用の件', '社用車1台購入の件', 'オフィス複合機リース更改の件'],
      EXPENSE: ['9月度 経費精算', '8月度 経費精算', '顧客訪問に伴う経費精算', '展示会運営経費の精算'],
      TRANSPORT: ['9月度 交通費精算', '8月度 交通費精算', '関西出張分 交通費'],
      PURCHASE: ['ノートPC 3台購入', '事務用品 定期補充', 'モニター増設分 購入', '来客用椅子の購入'],
      PAYMENT: ['9月分 外注費支払', 'クラウド利用料 支払', '広告出稿料 支払', '法律顧問料 支払'],
      SEAL: ['業務委託基本契約書への押印', '入札書類への押印', '銀行口座開設書類への押印'],
      LEAVE: ['有給休暇申請（10/2-10/3）', '有給休暇申請（9/24）', '特別休暇申請', '半休申請（午後）'],
      TRIP: ['大阪支社訪問（1泊2日）', '福岡顧客訪問（2泊3日）', '名古屋展示会視察'],
      OVERTIME: ['月末処理に伴う時間外労働', '障害対応に伴う休日出勤', 'リリース前作業の時間外'],
      ONBOARD: ['10月1日入社者 手続き', '11月1日入社者 手続き'],
      OFFBOARD: ['9月末退職者 手続き'],
      CONTRACT: ['SaaS利用契約のレビュー', '業務委託契約（新規）のレビュー', 'NDA締結のレビュー']
    };
    var applicants = ['e5', 'e6', 'e7', 'e11', 'e13', 'e16', 'e17', 'e19', 'e20', 'e4', 'e14'];
    var comments = {
      approve: ['内容確認しました。問題ありません。', '相見積の取得を確認済みです。承認します。', '予算内のため承認。', '至急対応をお願いします。', '規程に適合していることを確認しました。'],
      sendback: ['見積書の添付が漏れています。追加のうえ再申請をお願いします。', '金額の内訳が不明瞭です。明細を分けてください。', '実施時期を明記してください。'],
      reject: ['今期予算の枠を超過しているため見送ります。', '他部署で同等の契約があるため不要と判断します。']
    };
    var byId = {}; db.Employees.forEach(function (e) { byId[e.ID] = e; });
    var tByCode = {}; TEMPLATES.forEach(function (t) { tByCode[t.code] = t; });
    var seq = 0, codes = Object.keys(subjects);

    function makeLines(code, n) {
      var arr = [];
      for (var i = 0; i < n; i++) {
        if (code === 'TRANSPORT') {
          arr.push({ date: ymd(-Math.floor(Math.random() * 60)), from: ['東京', '品川', '新宿', '横浜'][i % 4], to: ['大手町', '川崎', '千葉', '大宮'][i % 4], purpose: '顧客訪問', roundtrip: '往復', amount: (Math.floor(Math.random() * 12) + 3) * 100 });
        } else if (code === 'PURCHASE') {
          arr.push({ item: ['ノートPC', 'モニター', '事務椅子', 'トナー'][i % 4], model: 'MDL-' + (100 + i), vendor: 'v' + (1 + (i % 3)), qty: 1 + (i % 3), unit_price: (Math.floor(Math.random() * 15) + 3) * 10000 });
        } else {
          arr.push({ date: ymd(-Math.floor(Math.random() * 60)), account: 'a' + (1 + (i % 6)), vendor: 'v' + (1 + (i % 12)), desc: ['顧客訪問時の飲食', '書籍購入', 'タクシー代', '会議用茶菓', 'резерв'][i % 5].replace('резерв', '郵送料'), invoice_no: '', tax: '課税10%', amount: (Math.floor(Math.random() * 40) + 3) * 500 });
        }
      }
      return arr;
    }

    codes.forEach(function (code) {
      var t = tByCode[code]; if (!t) return;
      subjects[code].forEach(function (sub, k) {
        var reps = (code === 'EXPENSE' || code === 'TRANSPORT' || code === 'LEAVE') ? 2 : 1;
        for (var rep = 0; rep < reps; rep++) {
          seq++;
          var applicantId = applicants[seq % applicants.length];
          var ap = byId[applicantId];
          var daysAgo = -(Math.floor(Math.random() * 85) + 1);
          var data = {};
          (t.fields || []).forEach(function (f) {
            if (f.type === 'lines') { data[f.key] = makeLines(code, 2 + (seq % 3)); }
            else if (f.type === 'currency') { data[f.key] = (Math.floor(Math.random() * 60) + 2) * 50000; }
            else if (f.type === 'number') { data[f.key] = (code === 'LEAVE') ? (1 + (seq % 5)) : (1 + (seq % 8)); }
            else if (f.type === 'date') { data[f.key] = ymd(daysAgo + 7); }
            else if (f.type === 'select') { data[f.key] = (f.options || [''])[seq % (f.options || ['']).length]; }
            else if (f.type === 'vendor') { data[f.key] = 'v' + (1 + (seq % 12)); }
            else if (f.type === 'account') { data[f.key] = 'a' + (1 + (seq % 20)); }
            else if (f.type === 'employee') { data[f.key] = applicants[(seq + 3) % applicants.length]; }
            else if (f.type === 'department') { data[f.key] = '第一営業部'; }
            else if (f.type === 'checkbox') { data[f.key] = seq % 3 === 0; }
            else if (f.type === 'textarea') { data[f.key] = '本件は当部の年度計画に基づくものです。関連部署とは事前に調整済みです。'; }
            else { data[f.key] = sub; }
          });
          if (data.subject !== undefined) data.subject = sub;
          var amount = WF.amountOf(t, data);
          var route = WF.buildRoute(t, data, ap, db.Employees);
          var r = seq % 10;
          var status = r < 5 ? CFG.STATUS.APPROVED : (r < 8 ? CFG.STATUS.ACTIVE : (r === 8 ? CFG.STATUS.SENTBACK : CFG.STATUS.REJECTED));
          if (seq % 17 === 0) status = CFG.STATUS.DRAFT;

          var live = route.filter(function (s) { return !s.skipped; });
          if (status === CFG.STATUS.APPROVED) {
            live.forEach(function (s, i) {
              s.action = s.type === '回覧' ? CFG.ACTION.READ : CFG.ACTION.APPROVE;
              s.acted_by = s.approverId; s.acted_by_name = s.approverName;
              s.acted_on = d(daysAgo + i + 1, 10 + i); s.comment = comments.approve[(seq + i) % comments.approve.length];
            });
          } else if (status === CFG.STATUS.ACTIVE) {
            var done = Math.max(0, (seq % Math.max(live.length, 1)));
            live.forEach(function (s, i) {
              if (i < done) { s.action = CFG.ACTION.APPROVE; s.acted_by = s.approverId; s.acted_by_name = s.approverName; s.acted_on = d(daysAgo + i + 1, 11); s.comment = comments.approve[(seq + i) % comments.approve.length]; }
            });
          } else if (status === CFG.STATUS.SENTBACK) {
            if (live[0]) { live[0].action = CFG.ACTION.SENDBACK; live[0].acted_by = live[0].approverId; live[0].acted_by_name = live[0].approverName; live[0].acted_on = d(daysAgo + 1, 14); live[0].comment = comments.sendback[seq % comments.sendback.length]; }
          } else if (status === CFG.STATUS.REJECTED) {
            live.forEach(function (s, i) {
              if (i === 0 && live.length > 1) { s.action = CFG.ACTION.APPROVE; s.acted_by = s.approverId; s.acted_by_name = s.approverName; s.acted_on = d(daysAgo + 1, 9); s.comment = comments.approve[seq % comments.approve.length]; }
              else if (i === Math.min(1, live.length - 1)) { s.action = CFG.ACTION.REJECT; s.acted_by = s.approverId; s.acted_by_name = s.approverName; s.acted_on = d(daysAgo + 2, 16); s.comment = comments.reject[seq % comments.reject.length]; }
            });
          }
          var req = {
            ID: 'r' + seq,
            Request_No: 'REQ-' + new Date().getFullYear() + '-' + String(1000 + seq),
            Type_Code: code, Request_Type: 'rt' + (TEMPLATES.map(function (x) { return x.code; }).indexOf(code) + 1), Request_Type_name: t.name,
            Subject: sub, Applicant: applicantId, Applicant_name: ap.Employee_Name,
            Applicant_Dept: ap.Department_name, Applicant_Dept_name: ap.Department_name,
            Amount: amount, Status: status,
            Applied_On: status === CFG.STATUS.DRAFT ? '' : d(daysAgo, 9),
            Completed_On: status === CFG.STATUS.APPROVED ? d(daysAgo + live.length + 1, 17) : '',
            Current_Step: WF.currentStep(route),
            Route_JSON: JSON.stringify(route), Form_Data_JSON: JSON.stringify(data),
            Payment_Due_Date: '', Paid: false, Journal_Exported: false
          };
          db.Requests.push(req);
          route.forEach(function (s) {
            db.Approvals.push({
              ID: 'ap' + db.Approvals.length, Request: req.ID, Step_No: s.step_no, Step_Name: s.name,
              Step_Type: s.type, Approver: s.approverId, Approver_name: s.approverName,
              Acted_By: s.acted_by || '', Acted_By_name: s.acted_by_name || '',
              Action: s.skipped ? CFG.ACTION.SKIP : (s.action || CFG.ACTION.PENDING),
              Comment: s.comment || s.skipReason || '', Acted_On: s.acted_on || '', Is_Delegate: !!s.delegateId
            });
          });
        }
      });
    });

    /* ---- 閲覧証跡のデモ（過去30日・意図的に異常パターンを数件混ぜる） ---- */
    var acts = [CFG.ACCESS.ACTIONS.VIEW_DETAIL, CFG.ACCESS.ACTIONS.VIEW_LIST, CFG.ACCESS.ACTIONS.SEARCH, CFG.ACCESS.ACTIONS.VIEW_DETAIL, CFG.ACCESS.ACTIONS.VIEW_DETAIL, CFG.ACCESS.ACTIONS.PRINT, CFG.ACCESS.ACTIONS.EXPORT_CSV];
    for (var i = 0; i < 260; i++) {
      var actor = db.Employees[i % db.Employees.length];
      /* 実運用に近づける：閲覧の大半は自部署／自分が関係する申請に集中させる */
      var pool = db.Requests.filter(function (x) { return x.Applicant_Dept_name === actor.Department_name; });
      var req2 = (i % 23 === 0 || !pool.length) ? db.Requests[(i * 7) % db.Requests.length] : pool[(i * 3) % pool.length];
      var hour = (i % 47 === 0) ? 23 : (i % 53 === 0 ? 3 : 9 + (i % 9));
      db.AccessLogs.push({
        ID: 'al' + i, Log_Time: d(-(i % 30), hour), Session_ID: 'seed', Actor: actor.ID, Actor_Name: actor.Employee_Name,
        Actor_Dept: actor.Department_name, Actor_Role: (actor.Roles || []).join('・'), Login_User: actor.Email,
        Action: acts[i % acts.length], Target_Type: '申請', Target_ID: req2.ID, Target_No: req2.Request_No,
        Target_Subject: req2.Subject, Request_Type_Code: req2.Type_Code,
        Sensitivity: CFG.ACCESS.SENSITIVITY[req2.Type_Code] || 'C',
        Owner_Dept: req2.Applicant_Dept_name, Cross_Dept: req2.Applicant_Dept_name !== actor.Department_name,
        Result_Count: '', Duration_Sec: 5 + (i % 90), Detail: '', User_Agent: 'seed-data'
      });
    }
    /* 大量閲覧の異常パターン（同一ユーザーが1時間に40件） */
    for (var j = 0; j < 40; j++) {
      var rq = db.Requests[(j * 3) % db.Requests.length];
      db.AccessLogs.push({
        ID: 'alx' + j, Log_Time: d(-2, 21), Session_ID: 'seedx', Actor: 'e20', Actor_Name: '池田 亮介',
        Actor_Dept: '総務部', Actor_Role: '申請者', Login_User: 's0020@sunrise-trading.co.jp',
        Action: CFG.ACCESS.ACTIONS.VIEW_DETAIL, Target_Type: '申請', Target_ID: rq.ID, Target_No: rq.Request_No,
        Target_Subject: rq.Subject, Request_Type_Code: rq.Type_Code, Sensitivity: CFG.ACCESS.SENSITIVITY[rq.Type_Code] || 'C',
        Owner_Dept: rq.Applicant_Dept_name, Cross_Dept: rq.Applicant_Dept_name !== '総務部',
        Result_Count: '', Duration_Sec: 4, Detail: '', User_Agent: 'seed-data'
      });
    }

    /* 添付のデモ（本体は極小のダミー。分割・再結合の動作確認用） */
    var dummy = 'JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PC9UeXBlL0NhdGFsb2c+PgplbmRvYmoKdHJhaWxlcgo8PC9Sb290IDEgMCBSPj4K';
    db.Requests.filter(function (r) { return ['EXPENSE', 'PAYMENT', 'PURCHASE'].indexOf(r.Type_Code) >= 0; })
      .slice(0, 8).forEach(function (r, i) {
        var key = 'fseed' + i;
        var ven = db.Vendors[i % db.Vendors.length];
        db.Files.push({
          ID: 'fl' + i, File_Key: key, Request: r.ID, Request_No: r.Request_No,
          File_Name: (r.Type_Code === 'PAYMENT' ? '請求書_' : '領収書_') + r.Request_No + '.pdf',
          Mime_Type: 'application/pdf', File_Size: 120000 + i * 9000,
          Trade_Date: ymd(-(10 + i)), Trade_Amount: Math.round((r.Amount || 100000) / 2),
          Trade_Partner: ven.Vendor_Name, Chunk_Index: 0, Chunk_Total: 1,
          Data_Base64: dummy, Uploaded_By: r.Applicant, Uploaded_By_Name: r.Applicant_name,
          Uploaded_At: r.Applied_On || d(-12, 10), Deleted: false
        });
      });

    db.Notifications = db.Requests.slice(0, 12).map(function (r, i) {
      return { ID: 'n' + i, To_User: r.Applicant, Request: r.ID, Kind: r.Status === CFG.STATUS.SENTBACK ? '差戻し' : '承認結果', Message: r.Request_No + ' ' + r.Subject + ' が' + r.Status + 'になりました', Is_Read: i > 4, Created_Time: d(-i, 12) };
    });
    return db;
  }
  return { build: build, empty: empty };
})();
