/* =========================================================================
 * seed.js — デモモード用の初期データ（Creator 接続時は使われない）
 *
 * 日付は「今日」からの相対で作るので、いつ開いても今月の数字が出る。
 * 会社名・人名・電話番号はすべて架空。
 * ========================================================================= */
var Seed = (function () {
  var DEFAULT_LOGIN = 'demo-manager@example.com';

  function build() {
    var t = Dates.today(), mon = Dates.month();
    var mStart = mon + '-01', mEnd = Dates.monthEnd(mon), prev = Dates.addMonths(mon, -1);
    function d(n) { return Dates.addDays(t, n); }
    /* 今月の受注日（月初より前にならないように） */
    function wonDay(n) { var x = d(n); return x < mStart ? mStart : x; }
    /* 今月中の受注予定日（月末を越えないように） */
    function planThisMonth(n) { var x = d(n); return x > mEnd ? mEnd : x; }

    var staff = [
      { ID: 's1', Name: '佐藤 美咲', Email: DEFAULT_LOGIN,           Team: '営業1課', Role: 'manager', Is_Active: true },
      { ID: 's2', Name: '鈴木 健太', Email: 'suzuki@example.com',    Team: '営業1課', Role: 'member',  Is_Active: true },
      { ID: 's3', Name: '高橋 陽菜', Email: 'takahashi@example.com', Team: '営業2課', Role: 'member',  Is_Active: true },
      { ID: 's4', Name: '田中 翔',   Email: 'tanaka@example.com',    Team: '営業2課', Role: 'member',  Is_Active: true }
    ];
    function sname(id) { return staff.filter(function (s) { return s.ID === id; })[0].Name; }
    function smail(id) { return staff.filter(function (s) { return s.ID === id; })[0].Email; }

    var customers = [
      ['c1', '株式会社みなと製作所',   '製造業',      'A', '総務部 山口様',         '03-0000-0001',   '東京都港区',     's2'],
      ['c2', '青葉システム株式会社',   'IT・通信',    'A', '情報システム部 小林様', '022-000-0002',   '宮城県仙台市',   's3'],
      ['c3', 'さくら運輸有限会社',     '物流',        'B', '営業所長 中村様',       '06-0000-0003',   '大阪府大阪市',   's2'],
      ['c4', '北斗フーズ株式会社',     '食品',        'B', '購買部 加藤様',         '011-000-0004',   '北海道札幌市',   's4'],
      ['c5', '株式会社ひかり住建',     '建設・不動産', 'C', '代表 吉田様',           '092-000-0005',   '福岡県福岡市',   's4'],
      ['c6', '東和メディカル株式会社', '医療・福祉',  'A', '事務長 山本様',         '052-000-0006',   '愛知県名古屋市', 's3'],
      ['c7', '株式会社つばさ商事',     '卸売',        'C', '営業部 松本様',         '045-000-0007',   '神奈川県横浜市', 's2'],
      ['c8', 'やまなみ観光株式会社',   'サービス',    'B', '企画室 井上様',         '0263-00-0008',   '長野県松本市',   's1']
    ].map(function (r) {
      return { ID: r[0], Name: r[1], Industry: r[2], Rank: r[3], Contact: r[4], Phone: r[5], Address: r[6],
        Owner_ID: r[7], Owner_Name: sname(r[7]), Note: '', Is_Active: true };
    });
    function cname(id) { return customers.filter(function (c) { return c.ID === id; })[0].Name; }

    /* [ID, 案件名, 顧客, 担当, ステージ, 金額, 確度, 受注予定日, 確定日, 次回アクション, 次回アクション日] */
    var deals = [
      ['d1',  '生産管理システム更新',     'c1', 's2', '交渉', 4800000, 70,  planThisMonth(12), '', '最終見積の提示',     d(2)],
      ['d2',  '基幹システム保守契約',     'c2', 's3', '受注', 2400000, 100, wonDay(-6),        wonDay(-6), '', ''],
      ['d3',  '配送管理クラウド導入',     'c3', 's2', '提案', 1800000, 30,  d(40),             '', '導入事例の送付',     d(-2)],
      ['d4',  '工場向け衛生管理システム', 'c4', 's4', '見積', 3200000, 50,  planThisMonth(20), '', '見積条件の確認',     d(5)],
      ['d5',  'モデルハウス予約システム', 'c5', 's4', 'リード', 900000, 10, d(75),             '', '初回ヒアリング',     d(7)],
      ['d6',  '電子カルテ連携',           'c6', 's3', '交渉', 6500000, 70,  d(25),             '', '役員向けプレゼン',   d(-1)],
      ['d7',  '受発注EDI',                'c7', 's2', '失注', 1200000, 0,   d(-20),            d(-15), '', ''],
      ['d8',  '観光予約サイト改修',       'c8', 's1', '提案', 2000000, 30,  d(50),             '', '要件整理の打合せ',   d(3)],
      ['d9',  '追加ライセンス',           'c1', 's2', '受注', 600000,  100, wonDay(-2),        wonDay(-2), '', ''],
      ['d10', '在庫分析ダッシュボード',   'c4', 's4', '受注', 1500000, 100, wonDay(-9),        wonDay(-9), '', ''],
      ['d11', 'BCP対策パッケージ',        'c2', 's3', '見積', 1100000, 50,  d(-3),             '', '稟議状況の確認',     d(1)],
      ['d12', '車両動態管理',             'c3', 's2', 'リード', 2700000, 10, d(90),            '', '課題のヒアリング',   d(10)],
      ['d13', 'スタッフ研修プログラム',   'c6', 's3', '受注', 800000,  100, prev + '-20',      prev + '-20', '', ''],
      ['d14', '会員アプリ開発',           'c5', 's4', '提案', 3600000, 30,  d(60),             '', '画面案の提示',       d(4)]
    ].map(function (r) {
      return { ID: r[0], Name: r[1], Customer_ID: r[2], Customer_Name: cname(r[2]), Owner_ID: r[3], Owner_Name: sname(r[3]), Owner_Email: smail(r[3]),
        Stage: r[4], Amount: r[5], Prob: r[6], Close_Plan: r[7], Closed_On: r[8], Next_Action: r[9], Next_Action_On: r[10], Note: '' };
    });
    function dname(id) { return deals.filter(function (x) { return x.ID === id; })[0].Name; }

    var activities = [
      ['a1', d(-1),  '訪問',           'c1', 'd1',  's2', '最終見積の前提条件を確認。来週、役員決裁の予定。'],
      ['a2', d(-2),  'オンライン商談', 'c6', 'd6',  's3', '連携範囲について打合せ。追加要件が2点あり。'],
      ['a3', d(-3),  '電話',           'c3', 'd3',  's2', 'ご担当者が不在。折り返し待ち。'],
      ['a4', d(-4),  'メール',         'c4', 'd4',  's4', '見積書を送付。'],
      ['a5', d(-6),  '訪問',           'c2', 'd2',  's3', '保守契約を締結。'],
      ['a6', d(-7),  '訪問',           'c8', 'd8',  's1', '新サイトへの要望をヒアリング。'],
      ['a7', d(-8),  '電話',           'c5', 'd5',  's4', '紹介経由で初回連絡。'],
      ['a8', d(-10), 'オンライン商談', 'c2', 'd11', 's3', 'パッケージのデモを実施。']
    ].map(function (r) {
      return { ID: r[0], Date: r[1], Type: r[2], Customer_ID: r[3], Customer_Name: cname(r[3]), Deal_ID: r[4], Deal_Name: dname(r[4]),
        Staff_ID: r[5], Staff_Name: sname(r[5]), Staff_Email: smail(r[5]), Summary: r[6] };
    });

    var targets = [
      [mon, 's1', 1000000], [mon, 's2', 3000000], [mon, 's3', 3500000], [mon, 's4', 2500000],
      [prev, 's2', 3000000], [prev, 's3', 3000000], [prev, 's4', 2000000]
    ].map(function (r, i) {
      return { ID: 't' + (i + 1), Month: r[0], Staff_ID: r[1], Staff_Name: sname(r[1]), Staff_Email: smail(r[1]), Amount: r[2] };
    });

    return { Staff: staff, Customers: customers, Deals: deals, Activities: activities, Targets: targets, Logs: [] };
  }

  return { build: build, DEFAULT_LOGIN: DEFAULT_LOGIN };
})();
