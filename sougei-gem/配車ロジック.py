# -*- coding: utf-8 -*-
"""送迎の配車を組むスクリプト（送迎ナビと同じ手順）

使い方
  下の「入力」だけを書き換えて実行する。ロジック側はいじらない。
  座標は (緯度, 経度) の順。緯度が34〜45、経度が129〜146の範囲。

出力
  車ごとの送迎表（乗る順・到着・出発）、未割当。
"""

import math, random

# このファイルの版。書き換えないこと。
# 出力の1行目に出るので、ちゃんとこのファイルが実行されたか確認できる。
LOGIC_VERSION = '2026-09-24'

# ══════════════════════════════════════════════════════════
# 入力　ここだけ書き換える
# ══════════════════════════════════════════════════════════

CONFIG = {
    'mode':     '介護',              # '介護' か '放デイ'
    'trip':     'お迎え',            # 'お迎え' か 'お送り'
    # facility には【事業所の住所】を入れる。実測表(REAL)のキーと一字一句そろえること。
    # 施設名を入れると実測表を引けなくなり、精度が落ちる。
    'facility':      '中央町1-1-1',
    'facility_name': '',             # 表示用の施設名（任意。空なら住所を表示）
    'fac_pos':  (34.7180, 136.9105), # 事業所の座標
    'depart':   '9:00',              # 一斉出発時刻（介護）
    'auto_depart': None,             # None＝放デイなら自動。True/Falseで固定もできる
                                     # 自動のとき、事業所の出発時刻は
                                     # 「最初のお迎え時刻 − そこまでの移動時間」で逆算する
    'stop':     10,                  # 乗降にかかる時間（分）
    'turn':     5,                   # 1便→2便の折り返し（分）
    'factor':   3.0,                 # 直線1kmあたりの分数。あとで合わせる
    'use_run2': True,                # 2便を使うか
    'seed':     0,                   # 毎回同じ結果にするための種。変えない
}

# 車両　cap=利用者定員 / wc_max=うち車いす定員 / wc_seats=車いす1台が使う席数
#       walker_max=歩行器の上限（None＝制限なし）
VEHICLES = [
    {'name': '1号車', 'cap': 6, 'wc_max': 2, 'wc_seats': 2, 'walker_max': 2},
    {'name': '2号車', 'cap': 4, 'wc_max': 1, 'wc_seats': 2, 'walker_max': 1},
    {'name': '3号車', 'cap': 7, 'wc_max': 0, 'wc_seats': 1, 'walker_max': None},
]

# 利用者　mob='wc'（車いす）/'walker'（歩行器）/''（なし）
#         target=お迎え時刻の指定（''なら指定なし）
USERS = [
    {'name': '青木 一郎', 'addr': '桜町2-4-1',   'pos': (34.7213, 136.9021), 'mob': 'wc',     'target': ''},
    {'name': '石田 花子', 'addr': '桜町2-4-1',   'pos': (34.7213, 136.9021), 'mob': '',       'target': ''},
    {'name': '上原 三郎', 'addr': '桜町5-2',     'pos': (34.7255, 136.8977), 'mob': 'walker', 'target': ''},
    {'name': '江口 よし', 'addr': '中央町3-7',   'pos': (34.7165, 136.9142), 'mob': '',       'target': '9:30'},
    {'name': '大西 五郎', 'addr': '東町4-3',     'pos': (34.7051, 136.9388), 'mob': 'wc',     'target': ''},
    {'name': '加藤 ハル', 'addr': '若葉町1-12',  'pos': (34.7302, 136.9210), 'mob': '',       'target': ''},
    {'name': '木下 七海', 'addr': '若葉町1-15',  'pos': (34.7310, 136.9225), 'mob': 'walker', 'target': ''},
    {'name': '熊谷 八重', 'addr': '東町4-3',     'pos': (34.7051, 136.9388), 'mob': '',       'target': ''},
    {'name': '小池 九市', 'addr': '西町6-1',     'pos': (34.7128, 136.8840), 'mob': '',       'target': ''},
    {'name': '佐藤 とめ', 'addr': '西町6-8',     'pos': (34.7141, 136.8822), 'mob': 'wc',     'target': ''},
]

# 休車・欠席　名前をそのまま並べる
OFF_VEHICLES = []
OFF_USERS    = []

# 実測の移動時間（分）。スプレッドシートの「④ 実測時間を取る」で作った表をここに貼る。
# キーは (出発の住所, 到着の住所)。同じ区間は往復どちらでも同じ値を使う。
# ここに無い区間だけ、直線距離 × factor で見積もる。
REAL = {
    # ('中央町1-1-1', '桜町2-4-1'): 4,
    # ('桜町2-4-1',   '桜町5-2'):   6,
}

# 係数（factor）を合わせるための実測データ
# 実際に何分かかるか分かっている区間を並べて、最後の calibrate() を有効にすると
# おすすめの factor が出る。3〜5区間あれば十分。
CALIBRATION = [
    # (出発の座標, 到着の座標, 実際にかかる分)
    # ((34.7180, 136.9105), (34.7213, 136.9021), 9),
]

# 2便に分ける判断のしきい値（送迎ナビと同じ値）
RUN2_MIN_STOPS = 6    # これ未満の軒数なら、時短目的では分けない
RUN2_REQ_GAIN  = 10   # 平均でこれ以上早くなること（分）
RUN2_MAX_LOSS  = 10   # 最後の方がこれ以上遅くなるなら分けない（分）

# ══════════════════════════════════════════════════════════
# ここから下はロジック。書き換えない
# ══════════════════════════════════════════════════════════

def to_m(s):
    """'9:30' → 570。空や不正なら None"""
    if not s: return None
    try:
        h, m = str(s).split(':')
        return int(h) * 60 + int(m)
    except Exception:
        return None

def to_hm(m):
    """570 → '9:30'"""
    if m is None: return ''
    m = int(round(m))
    return '%d:%02d' % (m // 60, m % 60)

def haversine_km(a, b):
    """2点間の直線距離（km）"""
    if a is None or b is None: return 0.0
    lat1, lon1 = math.radians(a[0]), math.radians(a[1])
    lat2, lon2 = math.radians(b[0]), math.radians(b[1])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2
    return 2 * 6371.0 * math.asin(min(1.0, math.sqrt(h)))

# 実測を使えた回数と、直線で見積もった回数（最後に内訳を出す）
LEG_STATS = {'real': 0, 'est': 0}

def legmin(a, b, aa='', ab=''):
    """移動時間（分）。
       aa, ab に住所を渡すと、まず実測表 REAL を見る。
       無ければ直線距離 × factor で見積もる。"""
    if aa and ab and aa == ab: return 0
    if aa and ab:
        v = REAL.get((aa, ab))
        if v is None: v = REAL.get((ab, aa))     # 逆向きも同じ値として使う
        if v is not None:
            LEG_STATS['real'] += 1
            return max(0, int(round(v)))
    if a is None or b is None: return 0
    if a == b: return 0
    LEG_STATS['est'] += 1
    return max(1, int(round(haversine_km(a, b) * CONFIG['factor'])))

def walker_max(v):
    w = v.get('walker_max')
    return 99 if w is None else int(w)

def cap_at(v, wc):
    """車いすwc台を載せたときに乗れる人数"""
    return int(v['cap']) - (int(v.get('wc_seats', 1)) - 1) * wc

def can_fit(v, load, group):
    """load=(人数, 車いす, 歩行器) の車に group を足せるか"""
    n, wc, wk = load
    for c in group:
        if c['mob'] == 'wc':       wc += 1
        elif c['mob'] == 'walker': wk += 1
        n += 1
    if wc > int(v.get('wc_max', 0)): return False
    if wk > walker_max(v):           return False
    lim = cap_at(v, wc)
    return lim > 0 and n <= lim

def add_load(load, group):
    n, wc, wk = load
    for c in group:
        if c['mob'] == 'wc':       wc += 1
        elif c['mob'] == 'walker': wk += 1
        n += 1
    return (n, wc, wk)

def fit_count(v, users):
    """先頭から順に、何人まで乗れるか"""
    load = (0, 0, 0)
    n = 0
    for c in users:
        if not can_fit(v, load, [c]): break
        load = add_load(load, [c]); n += 1
    return n

def runs_allowed():
    """1台が何便まで走れるか"""
    return 2 if (CONFIG['use_run2'] and CONFIG['mode'] == '介護') else 1

def fits_in_runs(v, users, runs):
    """users を runs 便までに収められるか（順番どおりに詰めていく）"""
    rest = list(users)
    for _ in range(runs):
        if not rest: return True
        k = fit_count(v, rest)
        if k == 0: return False
        rest = rest[k:]
    return not rest

def why_not(v, group):
    """乗れない理由"""
    wc = sum(1 for c in group if c['mob'] == 'wc')
    wk = sum(1 for c in group if c['mob'] == 'walker')
    if wc and int(v.get('wc_max', 0)) == 0: return '車いす不可'
    if wc > int(v.get('wc_max', 0)):        return '車いす定員'
    if wk > walker_max(v):                  return '歩行器の上限'
    return '定員'


# ── 手順1　まとまりを作る（住所＋お迎え時刻が同じ人は同じ車の連続した順番）──
def make_groups(users):
    bag = {}
    for c in users:
        k = (c['addr'], c['target'])
        bag.setdefault(k, []).append(c)
    gs = list(bag.values())
    # お迎え時刻の早い順。指定なしは最後
    gs.sort(key=lambda g: (to_m(g[0]['target']) if to_m(g[0]['target']) is not None else 99*60))
    return gs


# ── 手順3　車内の順番（最近傍でまわり、指定時刻／到着見込みで並べ替え）──
def order_stops(group_idxs, groups, depart_min):
    if len(group_idxs) <= 1: return list(group_idxs)
    items = [{'pos': groups[gi][0]['pos'],
              'addr': groups[gi][0].get('addr', ''),
              'target': next((c['target'] for c in groups[gi] if c['target']), '')}
             for gi in group_idxs]

    # ① 最近傍法で一周の順番を作る
    rest, nn = list(range(len(items))), []
    cur, cur_a = CONFIG['fac_pos'], CONFIG['facility']
    while rest:
        bi, bm = 0, float('inf')
        for k, idx in enumerate(rest):
            m = legmin(cur, items[idx]['pos'], cur_a, items[idx]['addr'])
            if m < bm: bm, bi = m, k
        pick = rest.pop(bi); nn.append(pick)
        cur, cur_a = items[pick]['pos'], items[pick]['addr']

    # ② その順で回ったときの到着見込み
    eta, t = {}, depart_min
    prev, prev_a = CONFIG['fac_pos'], CONFIG['facility']
    for i in nn:
        t += legmin(prev, items[i]['pos'], prev_a, items[i]['addr'])
        eta[i] = t
        t += CONFIG['stop']
        prev, prev_a = items[i]['pos'], items[i]['addr']

    # ③ 指定時刻があればそれ、無ければ見込みで並べ替え
    keyed = []
    for pos, i in enumerate(nn):
        tg = to_m(items[i]['target'])
        keyed.append((tg if tg is not None else eta[i], pos, i))
    keyed.sort()
    return [group_idxs[x[2]] for x in keyed]


def route_minutes(group_idxs, groups):
    """事業所を出て全員を回り、事業所へ帰るまでの移動時間の合計。
       帰りの区間も入れる。入れないと、最後のお宅が事業所から遠い案を
       選んでしまい、実際の拘束時間が長くなる"""
    if not group_idxs: return 0
    total = 0
    prev, prev_a = CONFIG['fac_pos'], CONFIG['facility']
    for gi in group_idxs:
        c = groups[gi][0]
        total += legmin(prev, c['pos'], prev_a, c.get('addr', ''))
        prev, prev_a = c['pos'], c.get('addr', '')
    total += legmin(prev, CONFIG['fac_pos'], prev_a, CONFIG['facility'])   # 帰り
    return total

def ord_map(assign, groups, vehicles, depart_min):
    m = {vi: [] for vi in range(len(vehicles))}
    for gi, vi in enumerate(assign):
        if vi >= 0: m[vi].append(gi)
    for vi in m:
        m[vi] = order_stops(m[vi], groups, depart_min)
    return m

RUN2_PENALTY = 60   # 2便が必要になる配車には、このぶん不利な点をつける

def total_score(assign, groups, vehicles, depart_min):
    """移動時間の合計。2便が必要になる車があればペナルティを足す
       （車が足りているのに無駄に2便へ分けないようにするため）"""
    om = ord_map(assign, groups, vehicles, depart_min)
    total = sum(route_minutes(gis, groups) for gis in om.values() if gis)
    for vi, v in enumerate(vehicles):
        seq = [c for gi in om.get(vi, []) for c in groups[gi]]
        if seq and not fits_in_runs(v, seq, 1):
            total += RUN2_PENALTY
    return total


# ── 手順2　貪欲法で割り当てる ──
def greedy(groups, vehicles):
    load = [(0, 0, 0)] * len(vehicles)
    held = [[] for _ in vehicles]        # その車に乗せると決めた方（便を分ける前）
    last = [None] * len(vehicles)
    assign, unassigned = [-1] * len(groups), []
    runs = runs_allowed()

    # 介護は車いす・歩行器の方を先に割り当てる（後回しにすると乗れる車が埋まる）
    order = sorted(range(len(groups)),
                   key=lambda gi: (0 if any(c['mob'] for c in groups[gi]) else 1, gi)) \
            if CONFIG['mode'] == '介護' else list(range(len(groups)))

    for gi in order:
        g = groups[gi]
        gt = to_m(g[0]['target'])
        gt = gt if gt is not None else 99 * 60
        best, best_sc = -1, float('inf')
        for vi, v in enumerate(vehicles):
            if not can_fit(v, load[vi], g): continue
            tdiff = 0 if last[vi] is None else abs(gt - last[vi])
            penalty = 10000 if (last[vi] is not None and tdiff > 30) else 0
            sc = penalty + load[vi][0]
            if sc < best_sc: best_sc, best = sc, vi
        if best < 0 and runs > 1:
            # 1便には入らない → 2便まで使えば収まる車を探す（いちばん空いている車へ）
            for vi, v in enumerate(vehicles):
                if not fits_in_runs(v, held[vi] + g, runs): continue
                if best < 0 or load[vi][0] < load[best][0]: best = vi
        if best < 0:
            # 2便を使っても入らない → 定員を超えさせず未割当にする
            reasons = sorted({why_not(v, g) for v in vehicles}) or ['車両なし']
            unassigned.append((g, '全車とも' + '・'.join(reasons)))
            continue
        assign[gi] = best
        load[best] = add_load(load[best], g)
        held[best] = held[best] + g
        last[best] = gt
    return assign, unassigned


# ── 手順4　組み直して改善する（送迎ナビと同じシャッフル反復）──
def is_valid(assign, groups, vehicles):
    runs = runs_allowed()
    seats = [[] for _ in vehicles]
    for gi, vi in enumerate(assign):
        if vi < 0: continue
        if vi >= len(vehicles): return False
        seats[vi] = seats[vi] + groups[gi]
    for vi, v in enumerate(vehicles):
        if seats[vi] and not fits_in_runs(v, seats[vi], runs): return False
    # 同じ車の中で、隣り合うお迎え時刻の差が30分を超えないか
    # （時刻の指定がある組どうしだけで比べる。指定なしを0分扱いすると全部はじかれる）
    for vi in range(len(vehicles)):
        ts = sorted(t for t in (to_m(groups[gi][0]['target'])
                                for gi, v in enumerate(assign) if v == vi)
                    if t is not None)
        for i in range(1, len(ts)):
            if ts[i] - ts[i-1] > 30: return False
    return True

def improve(assign, groups, vehicles, depart_min, iters=4000):
    rnd = random.Random(CONFIG['seed'])
    best = list(assign)
    best_sc = total_score(best, groups, vehicles, depart_min)
    live = [gi for gi, vi in enumerate(best) if vi >= 0]
    if len(live) < 2: return best, best_sc, 0
    improved = 0
    for _ in range(iters):
        trial = list(best)
        if rnd.random() < 0.5:
            a, b = rnd.sample(live, 2)
            trial[a], trial[b] = trial[b], trial[a]
        else:
            gi = rnd.choice(live)
            trial[gi] = rnd.randrange(len(vehicles))
        if not is_valid(trial, groups, vehicles): continue
        sc = total_score(trial, groups, vehicles, depart_min)
        if sc < best_sc:
            best, best_sc = trial, sc
            improved += 1
    return best, best_sc, improved


def 逆算する_か():
    """出発時刻を逆算するかどうか。既定では放デイのときだけ逆算する"""
    a = CONFIG.get('auto_depart')
    return (CONFIG['mode'] == '放デイ') if a is None else bool(a)

def depart_for(seq, default_min):
    """最初のお宅の指定時刻に間に合う出発時刻を逆算する。
       指定時刻が無ければ、設定された一斉出発時刻をそのまま使う"""
    if not seq or not 逆算する_か(): return default_min
    tg = to_m(seq[0]['target'])
    if tg is None: return default_min
    # ここは「何分前に出ればよいか」の下調べなので、走行区間としては数えない
    keep = dict(LEG_STATS)
    travel = legmin(CONFIG['fac_pos'], seq[0]['pos'],
                    CONFIG['facility'], seq[0].get('addr', ''))
    LEG_STATS.update(keep)
    return max(0, tg - travel)


# ── 手順5　時刻を計算する ──
def build_schedule(seq, depart_min):
    """seq=乗る順の利用者リスト → ([行], 帰着時刻)

    同じ場所で続けて乗る方は1回の停車でまとめて乗せる。
    （2人いても停車は1回。乗降時間を人数分かけない）
    """
    rows, t = [], depart_min
    prev, prev_a = CONFIG['fac_pos'], CONFIG['facility']
    i = 0
    while i < len(seq):
        # 場所と指定時刻が同じで続いている方をひとまとめにする
        key = (seq[i]['pos'], seq[i]['target'])
        j = i
        while j + 1 < len(seq) and (seq[j+1]['pos'], seq[j+1]['target']) == key:
            j += 1
        chunk = seq[i:j+1]

        travel = legmin(prev, chunk[0]['pos'], prev_a, chunk[0].get('addr', ''))
        t += travel
        arrive, wait = t, 0
        tg = to_m(chunk[0]['target'])
        if tg is not None and tg > arrive:
            wait = tg - arrive          # 早く着いたので指定時刻まで待つ
            arrive = tg
        t = arrive + CONFIG['stop']     # 停車1回ぶんの乗降時間
        late = (arrive - tg) if (tg is not None and arrive > tg) else 0
        for k, c in enumerate(chunk):
            rows.append({'c': c, 'arrive': arrive, 'depart': t,
                         'wait': wait if k == 0 else 0, 'late': late,
                         'travel': travel if k == 0 else 0,
                         'same': k > 0})
        prev, prev_a = chunk[0]['pos'], chunk[0].get('addr', '')
        i = j + 1
    back = t + (legmin(prev, CONFIG['fac_pos'], prev_a, CONFIG['facility']) if seq else 0)
    return rows, back


# ── 手順6　2便を使うか判断する ──
def split_run2(seq, v, depart_min):
    """戻り値 (1便, 2便, 理由)。分けないなら2便は空"""
    if not CONFIG['use_run2'] or CONFIG['mode'] != '介護':
        return seq, [], ''

    # ① 1便に乗り切らないぶんは必ず2便へ
    fit1 = fit_count(v, seq)
    if fit1 < len(seq):
        rest = seq[fit1:]
        fit2 = fit_count(v, rest)
        return seq[:fit1], rest[:fit2], '1便に乗り切らないため'

    # ② 6軒以上あるときだけ、分けたほうが早いかを見る
    stops = len({c['addr'] for c in seq})
    if stops < RUN2_MIN_STOPS:
        return seq, [], ''

    base_rows, _ = build_schedule(seq, depart_min)
    base_avg  = sum(r['arrive'] for r in base_rows) / len(base_rows)
    base_last = max(r['arrive'] for r in base_rows)

    best = None
    for cut in range(1, len(seq)):
        a, b = seq[:cut], seq[cut:]
        if fit_count(v, a) < len(a) or fit_count(v, b) < len(b): continue
        ra, back = build_schedule(a, depart_min)
        rb, _    = build_schedule(b, back + CONFIG['turn'])
        rows = ra + rb
        avg  = sum(r['arrive'] for r in rows) / len(rows)
        last = max(r['arrive'] for r in rows)
        gain = base_avg - avg
        loss = last - base_last
        if gain >= RUN2_REQ_GAIN and loss < RUN2_MAX_LOSS:
            if best is None or gain > best[0]:
                best = (gain, a, b)
    if best:
        return best[1], best[2], '分けたほうが平均で%d分早いため' % round(best[0])
    return seq, [], ''


# ══════════════════════════════════════════════════════════
# 実行
# ══════════════════════════════════════════════════════════

def run():
    vehicles = [v for v in VEHICLES if v['name'] not in OFF_VEHICLES]
    users    = [c for c in USERS    if c['name'] not in OFF_USERS]
    if not vehicles: print('走れる車がありません'); return
    if not users:    print('送迎する方がいません'); return

    # 実測表があるのに事業所の住所が噛み合っていないと、黙って精度が落ちる。
    # 走る前に気づけるよう、ここで確かめる。
    warn_cfg = []
    if REAL:
        keys = set()
        for a, b in REAL: keys.add(a); keys.add(b)
        if CONFIG['facility'] not in keys:
            warn_cfg.append(
                "CONFIG['facility'] が実測表にありません（いまは「%s」）。\n"
                "　　実測表に出てくる住所のどれかと一字一句そろえてください。\n"
                "　　候補: %s" % (CONFIG['facility'], '／'.join(sorted(keys)[:5])))
        miss = [c['name'] for c in users if c.get('addr') and c['addr'] not in keys]
        if miss:
            warn_cfg.append('実測表に住所が無い方: ' + '、'.join(miss[:5]) +
                            '（その区間は直線距離で見積もります）')

    depart_min = to_m(CONFIG['depart']) or 0
    groups = make_groups(users)

    assign, unassigned = greedy(groups, vehicles)
    assign, score, improved = improve(assign, groups, vehicles, depart_min)
    om = ord_map(assign, groups, vehicles, depart_min)

    # ここから先が「実際に走るルート」。最適化中の試算は数えないように戻す
    LEG_STATS['real'] = LEG_STATS['est'] = 0


    print('［配車ロジック %s］' % LOGIC_VERSION)
    for w in warn_cfg:
        print('⚠ 設定を確認してください: ' + w)
    if warn_cfg: print()

    print('【%s　%s】' % (CONFIG.get('facility_name') or CONFIG['facility'], CONFIG['trip']))
    if 逆算する_か():
        print('出発時刻 各車とも最初のお迎え時刻から逆算 ／ 乗降 %d分' % CONFIG['stop'])
    else:
        print('一斉出発 %s ／ 乗降 %d分' % (CONFIG['depart'], CONFIG['stop']))
    if not REAL:
        print('（移動時間は直線距離 × %.1f で見積もり）' % CONFIG['factor'])
    print()

    warn = []
    for vi, v in enumerate(vehicles):
        gis = om[vi]
        if not gis: continue
        seq = [c for gi in gis for c in groups[gi]]
        run1, run2, reason = split_run2(seq, v, depart_min)

        dep1 = depart_for(run1, depart_min)   # 放デイは最初のお迎え時刻から逆算
        for ri, part in enumerate([run1, run2]):
            if not part: continue
            dep = dep1
            if ri == 1:
                _, back1 = build_schedule(run1, dep1)
                dep = back1 + CONFIG['turn']
            rows, back = build_schedule(part, dep)
            # 帰りの内訳（最後のお宅を出た時刻＋移動時間）を出しておく
            if rows:
                last_r  = rows[-1]
                keep    = dict(LEG_STATS)          # 表示のための再計算は区間として数えない
                back_mv = legmin(last_r['c']['pos'], CONFIG['fac_pos'],
                                 last_r['c'].get('addr', ''), CONFIG['facility'])
                LEG_STATS.update(keep)
                back_note = '［帰り＝最後のお宅を出た %s ＋ 移動%d分 ＝ %s］' % (
                    to_hm(last_r['depart']), back_mv, to_hm(last_r['depart'] + back_mv))
            else:
                back_note = ''
            label = '%s（定員%d名）' % (v['name'], v['cap'])
            if run2: label += '　%d便' % (ri + 1)
            print('■ %s' % label)
            print('　事業所出発 %s → 帰着 %s（%d分）' % (to_hm(dep), to_hm(back), back - dep))
            if back_note: print('　' + back_note)
            if ri == 1 and reason: print('　※ %s' % reason)
            print('| # | 氏名 | 住所 | 到着 | 出発 | 備考 |')
            print('|---|------|------|------|------|------|')
            for i, r in enumerate(rows, 1):
                c, note = r['c'], []
                if c['mob'] == 'wc':     note.append('車いす')
                if c['mob'] == 'walker': note.append('歩行器')
                if c['target']:          note.append('指定%s' % c['target'])
                if r['wait']:            note.append('待機%d分' % r['wait'])
                if r['late']:            note.append('⚠%d分遅れ' % r['late'])
                if r.get('same'):        note.append('同じ住所')
                if c.get('note'):        note.append(c['note'])
                print('| %d | %s | %s | %s | %s | %s |' %
                      (i, c['name'], c['addr'], to_hm(r['arrive']), to_hm(r['depart']), '、'.join(note)))
            for r in rows:
                if r['late']:
                    warn.append('%s が指定%s に %d分 遅れます'
                                % (r['c']['name'], r['c']['target'], r['late']))
            load = add_load((0, 0, 0), part)
            if load[0] > cap_at(v, load[1]):
                warn.append('%s が定員を超えています' % v['name'])
            print()

        boarded = {id(c) for c in run1} | {id(c) for c in run2}
        dropped = [c for c in seq if id(c) not in boarded]
        for c in dropped:
            unassigned.append(([c], '2便でも乗り切らない'))

    if unassigned:
        print('⚠ 未割当')
        for g, why in unassigned:
            for c in g:
                print('　%s（%s／%s）' % (c['name'], c['addr'], why))
        print()

    print('── 要点 ──')
    print('移動時間の合計 %d分（往復・%d回の組み直しで短縮）' % (score, improved))
    tot = LEG_STATS['real'] + LEG_STATS['est']
    if REAL and tot and LEG_STATS['real'] == 0:
        print('⚠ 実測表が渡されているのに、1区間も使えていません。')
        print('　 住所の書き方が実測表と合っているか確認してください（全部見積もりになっています）')
    elif REAL and tot:
        print('実際に走る %d区間のうち %d区間（%d%%）がGoogleマップの実測値です'
              % (tot, LEG_STATS['real'], round(LEG_STATS['real'] / tot * 100)))
        if LEG_STATS['est']:
            print('　残り %d区間は直線距離からの見積もりです' % LEG_STATS['est'])
    elif not REAL:
        print('実測表が入っていないため、すべて直線距離からの見積もりです')
    if warn:
        print('── 注意 ──')
        for w in set(warn): print('　' + w)
    if REAL and LEG_STATS['real'] > 0:
        print('※ 時刻はGoogleマップの実測値をもとに計算しています。当日の道路状況で差が出ます。')
    else:
        print('※ 時刻は座標からの直線距離をもとにした概算です。実際の道路状況とは差が出ます。')

def calibrate():
    """実測データから factor（直線1kmあたりの分数）を求める"""
    if not CALIBRATION:
        print('CALIBRATION に「座標・座標・実際の分」を3区間以上入れてください')
        return
    print('| 直線km | 実際の分 | 1kmあたり |')
    print('|--------|----------|-----------|')
    rates = []
    for a, b, real in CALIBRATION:
        km = haversine_km(a, b)
        if km <= 0.05:
            print('| %.2f | %d | （近すぎるので除外） |' % (km, real)); continue
        rate = real / km
        rates.append(rate)
        print('| %.2f | %d | %.1f |' % (km, real, rate))
    if not rates:
        print('使える区間がありません'); return
    avg = sum(rates) / len(rates)
    print()
    print('おすすめの factor = %.1f' % avg)
    print('（CONFIG の factor をこの値にしてください）')

# 係数を合わせたいときは、次の行の # を外して calibrate() を実行する
# calibrate()

run()
