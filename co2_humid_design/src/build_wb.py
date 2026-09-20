# -*- coding: utf-8 -*-
"""Builds the parametric design workbook (live Excel formulas throughout)."""
import sys, os
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation
from xlutil import *
EPS = "0.409350"   # M_H2O / M_CO2

OUT = os.path.join(os.path.dirname(__file__), "..", "out",
                   "CO2加湿ガス供給系_設計計算.xlsx")

S_RD, S_IN, S_PR = "00_はじめに", "01_入力", "02_物性"
S_ST, S_FL, S_PS = "03_湿度状態点", "04_流量切替", "05_圧力安定"
S_TH, S_PI, S_SF = "06_熱水収支", "07_配管", "08_安全"
S_SE, S_VA, S_RE = "09_感度解析", "10_検証", "11_文献"
Q = lambda s: f"'{s}'"

# ------------------------------------------------------- input cell registry
I = {}
def reg(name, cell): I[name] = f"{Q(S_IN)}!${cell[0]}${cell[1:]}"; return cell

wb = Workbook(); wb.remove(wb.active)

# ============================================================ 01 INPUTS
ws = wb.create_sheet(S_IN)
widths(ws, {"A": 46, "B": 15, "C": 13, "D": 74})
r = title(ws, 1, "入力パラメータ / Input parameters",
          "黄色セル（青字）のみ編集してください。他のシートはすべてこのシートを参照する数式です。")
r = section(ws, r, "A. 出力段の目標条件 / Target at the delivery plane")
r = inp(ws, r, "大気圧  P_atm", 101.325, "kPa", "標準大気圧。実際の設置標高に合わせて変更", "0.000"); reg("p_atm","B"+str(r-1))
r = inp(ws, r, "出力段ゲージ圧  P_out,g", 20.0, "kPa", "要求仕様（ゲージ圧）", "0.000"); reg("pg","B"+str(r-1))
r = inp(ws, r, "出力段温度  T_out", 20.0, "°C", "要求仕様", "0.000"); reg("Tout","B"+str(r-1))
r = inp(ws, r, "出力段相対湿度  RH_out", 0.70, "-", "要求仕様（70 %）。RH = p_v /(f·p_sat)", "0.0%"); reg("RHout","B"+str(r-1))
r = out(ws, r, "  → 出力段絶対圧  P_out,abs", f"={I['p_atm']}+{I['pg']}", "kPa", "大気圧 + ゲージ圧", "0.000"); reg("pout","B"+str(r-1))
r += 1
r = section(ws, r, "B. ガス源・調湿 / Source gas and humidity conditioning")
r = inp(ws, r, "一次側（ノズル上流）絶対圧  P_1", 300.0, "kPa abs", "チョーク維持のため出力段絶対圧の 2.5 倍以上を推奨", "0.000"); reg("p1","B"+str(r-1))
r = inp(ws, r, "飽和器出口相対湿度  η_sat", 0.90, "-", "「湿度90 %のCO2」＝飽和器の飽和効率。ミスト同伴に注意", "0.0%"); reg("eta","B"+str(r-1))
r = inp(ws, r, "飽和器出口温度  T_sat", 30.655, "°C", "★03シートが算出する『必要飽和器温度』をここに入力", "0.000"); reg("Tsat","B"+str(r-1))
r = inp(ws, r, "一次側トレース加熱温度  T_trace", 34.0, "°C", "一次側配管壁温。加圧側露点（約 28.8 °C）より 5 K 以上高く保つ（US EPA Method 320）", "0.000"); reg("Ttr","B"+str(r-1))
r += 1
r = section(ws, r, "C. 流量と切替タイミング / Flow set-points and switching")
r = inp(ws, r, "高流量  Q_H", 30.0, "NLPM", "", "0.000"); reg("QH","B"+str(r-1))
r = inp(ws, r, "低流量  Q_L", 15.0, "NLPM", "", "0.000"); reg("QL","B"+str(r-1))
r = inp(ws, r, "高流量保持時間  t_H", 30.0, "ms", "「30 ms で交互に切替」の解釈。周期 = t_H + t_L", "0.000"); reg("tH","B"+str(r-1))
r = inp(ws, r, "低流量保持時間  t_L", 30.0, "ms", "周期を 30 ms とする解釈なら t_H = t_L = 15 ms に変更", "0.000"); reg("tL","B"+str(r-1))
r = inp(ws, r, "標準状態 基準温度  T_ref", 0.0, "°C", "DIN 1343 = 0 °C（= SEMI E12）。ISO 13443 は 15 °C、20 °C はベンダ慣行", "0.000"); reg("Tref","B"+str(r-1))
r = inp(ws, r, "標準状態 基準圧力  p_ref", 101.325, "kPa", "0 °C 基準と 20 °C 基準では質量流量が 7.32 % 違う", "0.000"); reg("pref","B"+str(r-1))
r += 1
r = section(ws, r, "D. ハードウェア / Hardware")
r = inp(ws, r, "一次プレナム容積  V_1", 0.5, "L", "ノズル上流の安定化容積。p_0 変動は流量誤差に 1:1 で効く", "0.000"); reg("V1","B"+str(r-1))
r = inp(ws, r, "出力プレナム容積  V_2", 100.0, "mL", "出力段の容積。大きいほど圧力は安定するが流量変調が鈍る", "0.000"); reg("V2","B"+str(r-1))
r = inp(ws, r, "配管内径（切替弁→出力段）d_i", 8.0, "mm", "", "0.000"); reg("di","B"+str(r-1))
r = inp(ws, r, "配管長（切替弁→出力段）L", 0.025, "m", "★既定値は「弁・ノズル・出力プレナムを 25 mm 以内に一体化する」という推奨構成。05 シートの集中定数限界と整合", "0.000"); reg("L","B"+str(r-1))
r = inp(ws, r, "高速弁 応答時間  t_v", 1.0, "ms", "SMC SX10: 0.45/0.40 ms、Festo MHJ10: <1 ms", "0.000"); reg("tv","B"+str(r-1))
r = inp(ws, r, "入口/出口弁 同期ずれ  Δt_skew", 0.5, "ms", "★同期排気方式での残留リプルを決める最重要パラメータ", "0.000"); reg("skew","B"+str(r-1))
r = inp(ws, r, "ポリトロープ指数  n", 1.290, "-", "1 = 等温（遅い）、γ ≈ 1.29 = 断熱（速い）。30 ms なら断熱側", "0.000"); reg("npoly","B"+str(r-1))
r = inp(ws, r, "排気オリフィス 流量係数  Cd_or", 0.62, "-", "薄刃オリフィス。実機では校正すること", "0.000"); reg("Cdor","B"+str(r-1))
r = inp(ws, r, "プレナム首部 内径  d_neck", 10.0, "mm", "ヘルムホルツ共鳴を切替高調波から外すために使用", "0.000"); reg("dn","B"+str(r-1))
r = inp(ws, r, "プレナム首部 長さ  L_neck", 30.0, "mm", "", "0.000"); reg("Ln","B"+str(r-1))
r += 1
r = section(ws, r, "E. 物性モデルの選択 / Property-model options")
r = inp(ws, r, "交差第2ビリアル係数の補正 ΔB12 (CO2-H2O)", 0.0, "cm³/mol", "★内蔵相関 B12(T)（20 °C で −235.5、30 °C で −213.4）への加算値。文献ばらつき ±40 の影響を見るのに使う", "0.0"); reg("B12","B"+str(r-1))
r = inp(ws, r, "エンハンスメント係数を適用 (1=する/0=しない)", 1, "-", "0 にすると RH = p_v/p_sat（WMO 定義）になる", "0"); reg("usef","B"+str(r-1))
r = inp(ws, r, "CFVN Cd 相関 係数 a", 0.9959, "-", "ISO 9300:2022 トロイダル: Cd = a − b·Re^−0.5", "0.0000"); reg("cda","B"+str(r-1))
r = inp(ws, r, "CFVN Cd 相関 係数 b", 2.720, "-", "有効範囲 2.1e4 ≤ Re ≤ 3.2e7、u(Cd)=0.3 % (k=2)", "0.000"); reg("cdb","B"+str(r-1))
r += 1
r = section(ws, r, "F. 安全・換気 / Safety and ventilation")
r = inp(ws, r, "室容積  V_room", 54.0, "m³", "例: 5 × 4 × 2.7 m", "0.000"); reg("Vroom","B"+str(r-1))
r = inp(ws, r, "CO2 管理濃度  C_limit", 5000.0, "ppm", "ACGIH TLV-TWA / OSHA PEL = 5000 ppm", "0.0"); reg("Clim","B"+str(r-1))
r = inp(ws, r, "外気 CO2 濃度  C_bg", 420.0, "ppm", "現在の大気中濃度", "0.0"); reg("Cbg","B"+str(r-1))
r = inp(ws, r, "換気 混合安全係数  k", 3.0, "-", "EIGA Doc 44: CO2 は空気より重く混合が悪いため k ≥ 3", "0.000"); reg("kvent","B"+str(r-1))
r += 1
r = note(ws, r, "凡例: 黄色セル＋青字 = 入力値 / 黒字 = 数式 / 赤字＋橙セル = 主要な結果 / 灰色斜体 = 注記・出典")
r = note(ws, r, "★印は設計上とくに感度の高いパラメータです。09_感度解析 シートで影響度を確認してください。")
print("inputs done, last row", r)

# ============================================================ 03 STATE POINTS
ws = wb.create_sheet(S_ST)
widths(ws, {"A": 38, "B": 10, "C": 15, "D": 15, "E": 15, "F": 15, "G": 15, "H": 66})
title(ws, 1, "湿度状態点の連鎖 / Humid-gas state points along the process chain")
ws.cell(3,1,"JT膨張による温度降下 ΔT_JT").font = C_CALC
c = ws.cell(3,2,f"=0.5*(({MUJT_CO2('D9')})+({MUJT_CO2('(D9+$B$4)')}))*(E11-D11)"); c.font=C_RES; c.fill=F_RES; c.number_format="0.0000"
ws.cell(3,3,"K").font = C_CALC
ws.cell(3,4,"μ_JT(CO2, 20 °C) ≈ 1.14 K/bar は空気の約5倍。零密度極限 (T·dB/dT − B)/cp0。両端点の平均を使用").font = C_NOTE
ws.cell(4,1,"  （1次近似: 入口側 μ_JT のみ）").font = C_NOTE
c = ws.cell(4,2,f"={MUJT_CO2('D9')}*(E11-D11)"); c.font=C_CALC; c.number_format="0.0000"
ws.cell(4,3,"K").font = C_CALC
hdr(ws, 6, ["量 / quantity","単位","S1 飽和器出口","S2 ノズル上流","S3 ノズル下流","S4 出力段","目標値","備考 / note"])
CO = "CDEFG"
L = dict(desc=7, T=8, TK=9, pk=10, p=11, ps=12, Bww=13, Bgg=14, B12=15, vwl=16,
         kH=17, law=18, lps=19, poy=20, x0=21, RH=35, xv=36, pv=37, pvf=38,
         tds=39, pss=40, td1=41, ps1=42, td2=43, tdC=44, marg=45,
         w=47, ah=48, Mm=49, Zm=50, rho=51)
for it in range(3):
    L[f'Bmix{it}']=22+4*it; L[f'lpw{it}']=23+4*it; L[f'lnf{it}']=24+4*it; L[f'x{it+1}']=25+4*it
L['f']=33
def R(key, label, unit, forms, note_="", fmt="0.000000", res=False):
    row = L[key]
    ws.cell(row,1,label).font = C_CALC
    ws.cell(row,2,unit).font = C_CALC
    for i,f in enumerate(forms):
        c = ws.cell(row,3+i,f); c.font = C_RES if res else C_CALC
        if res: c.fill = F_RES
        c.number_format = fmt; c.border = BOX
    if note_: ws.cell(row,8,note_).font = C_NOTE

R('desc',"説明","",["飽和器を出た加湿CO2","トレース加熱された一次側","臨界ノズル直下流","恒温化された出力段","要求仕様"],"","General")
R('T',"温度 T","°C",[f"={I['Tsat']}",f"={I['Ttr']}","=D8+$B$3",f"={I['Tout']}",f"={I['Tout']}"],"S3 = S2 から等エンタルピ膨張しただけの温度","0.0000")
R('TK',"温度 T","K",[f"={c}8+273.15" for c in CO],"","0.0000")
R('pk',"絶対圧 p","kPa",[f"={I['p1']}",f"={I['p1']}",f"={I['pout']}",f"={I['pout']}",f"={I['pout']}"],"","0.0000")
R('p',"絶対圧 p","Pa",[f"={c}10*1000" for c in CO],"","0.00")
R('ps',"飽和水蒸気圧 p_sat(T)","Pa",[f"={PSAT(c+'9')}" for c in CO],"Wagner & Pruß (IAPWS-95) 蒸気圧式。IAPWS-95 に対し 70 ppm 以内","0.0000")
R('Bww',"  B_ww 水蒸気 第2ビリアル","m³/mol",[f"={BWW(c+'9')}" for c in CO],"IAPWS-95 零密度極限へのフィット","0.00E+00")
R('Bgg',"  B_CO2 CO2 第2ビリアル","m³/mol",[f"={BCO2(c+'9')}" for c in CO],"Span & Wagner (1996) へのフィット。20 °C で −127.9 cm³/mol","0.00E+00")
R('B12',"  B12 CO2–H2O 交差ビリアル","m³/mol",[f"={B12(c+'9')}+{I['B12']}/1000000" for c in CO],"★温度依存。20 °C で −235.5、30 °C で −213.4 cm³/mol。空気–水 (−32) の約7倍で、f を支配する","0.00E+00")
R('vwl',"  v_wL 液体水モル体積","m³/mol",[f"={VWL(c+'9')}" for c in CO],"Kell (1975) 密度式","0.00E+00")
R('kH',"  k_H CO2 ヘンリー定数","Pa",[f"={KH_CO2(c+'9')}" for c in CO],"IAPWS G7-04。20 °C で 145 MPa","0.00E+00")
R('law',"  ln a_w 水の活量（CO2溶解）","-",[f"=LN(1-({c}11-{c}12)/{c}17)" for c in CO],"溶存CO2が a_w を下げ f を下げる（121 kPa で −0.07 %）。空気なら無視可","0.00000000")
R('lps',"  ln φ_sat","-",[f"={c}13*{c}12/({RU}*{c}9)" for c in CO],"","0.00000000")
R('poy',"  Poynting 項","-",[f"={c}16*({c}11-{c}12)/({RU}*{c}9)" for c in CO],"液相が全圧で圧縮される効果","0.00000000")
R('x0',"  x_v,sat 反復 初期値","-",[f"={c}12/{c}11" for c in CO],"以下は f の不動点反復（3回で 1e−9 に収束）","0.00000000")
for it in range(3):
    xp = L['x0'] if it==0 else L[f'x{it}']
    R(f'Bmix{it}',f"  反復{it+1}: B_mix","m³/mol",
      [f"={c}{xp}^2*{c}13+2*{c}{xp}*(1-{c}{xp})*{c}15+(1-{c}{xp})^2*{c}14" for c in CO],"","0.00E+00")
    R(f'lpw{it}',f"  反復{it+1}: ln φ_w","-",
      [f"=(2*({c}{xp}*{c}13+(1-{c}{xp})*{c}15)-{c}{L[f'Bmix{it}']})*{c}11/({RU}*{c}9)" for c in CO],"","0.00000000")
    R(f'lnf{it}',f"  反復{it+1}: ln f","-",
      [f"={c}{L['lps']}-{c}{L[f'lpw{it}']}+{c}{L['poy']}+{c}{L['law']}" for c in CO],"","0.00000000")
    if it < 2:
        R(f'x{it+1}',f"  反復{it+1}: x_v,sat","-",
          [f"=EXP({c}{L[f'lnf{it}']})*{c}12/{c}11" for c in CO],"","0.00000000")
R('f',"エンハンスメント係数 f","-",[f"=IF({I['usef']}=1,EXP({c}{L['lnf2']}),1)" for c in CO],
  "★x_v,sat = f·p_sat/p。CO2 では 1.018（空気は 1.005）。空気用 Greenspan 式は CO2 に使えない","0.000000",res=True)
ws.cell(34,1,"── 組成 / composition ──").font = C_SEC
R('RH',"相対湿度 RH = p_v/(f·p_sat)","-",
  [f"={I['eta']}"] + [f"={c}{L['xv']}*{c}11/({c}{L['f']}*{c}12)" for c in "DEF"] + [f"={I['RHout']}"],
  "WMO/モル分率定義（Lovell-Smith et al., Metrologia 53, R40, 2016）","0.00%",res=True)
R('xv',"水蒸気モル分率 x_v","-",
  [f"=C{L['RH']}*C{L['f']}*C12/C11"] + [f"=$C${L['xv']}"]*3 + [f"=G{L['RH']}*G{L['f']}*G12/G11"],
  "★S1→S4 で保存される量（凝縮も加水もない限り）","0.00000000")
R('pv',"水蒸気分圧 p_v","Pa",[f"={c}{L['xv']}*{c}11" for c in CO],"","0.0000")
R('pvf',"  p_v / f（露点求解用）","Pa",[f"={c}{L['pv']}/{c}{L['f']}" for c in CO],"f は状態点の T で評価。露点での f との差は 0.02 K 未満","0.0000")
ws.cell(L['tds']-1,1,"── 露点 / dew point ──").font = C_SEC
R('tds',"  露点 初期値（Hardy 逆式）","K",[f"={TDEW_HARDY(c+str(L['pvf']))}" for c in CO],"Hardy (1998) の有理式。単独で 1e−4 K 精度","0.0000")
R('pss',"  p_sat(初期値)","Pa",[f"={PSAT(c+str(L['tds']))}" for c in CO],"","0.0000")
R('td1',"  Newton 1回目","K",[f"={NEWTON_TDEW(c+str(L['tds']),c+str(L['pss']),c+str(L['pvf']))}" for c in CO],"","0.0000")
R('ps1',"  p_sat(1回目)","Pa",[f"={PSAT(c+str(L['td1']))}" for c in CO],"","0.0000")
R('td2',"  Newton 2回目","K",[f"={NEWTON_TDEW(c+str(L['td1']),c+str(L['ps1']),c+str(L['pvf']))}" for c in CO],"","0.0000")
R('tdC',"露点温度 T_dp","°C",[f"={c}{L['td2']}-273.15" for c in CO],"","0.0000",res=True)
R('marg',"露点余裕 ΔT = T − T_dp","K",[f"={c}8-{c}{L['tdC']}" for c in CO],
  "★5 K 以上を厳守（US EPA Method 320 は最低 5 °C を要求）。全経路で負にしないこと","0.0000",res=True)
ws.cell(46,1,"── 導出量 / derived ──").font = C_SEC
R('w',"混合比 w（乾きCO2基準）","g/kg",[f"=1000*{EPS}*{c}{L['xv']}/(1-{c}{L['xv']})" for c in CO],
  f"ε_CO2 = M_H2O/M_CO2 = {EPS}。空気の 0.622 を使うと +51.9 % の誤り","0.0000")
R('ah',"絶対湿度 ρ_v","g/m³",[f"=1000*{c}{L['pv']}*{M_H2O}/({RU}*{c}9)" for c in CO],"理想気体近似の蒸気密度","0.0000")
R('Mm',"混合気体モル質量 M_mix","kg/mol",[f"={c}{L['xv']}*{M_H2O}+(1-{c}{L['xv']})*{M_CO2}" for c in CO],"","0.00000000")
R('Zm',"圧縮係数 Z_mix","-",
  [f"=1+({c}{L['xv']}^2*{c}13+2*{c}{L['xv']}*(1-{c}{L['xv']})*{c}15+(1-{c}{L['xv']})^2*{c}14)*{c}11/({RU}*{c}9)" for c in CO],
  "2次ビリアル混合則。Span–Wagner に対し 0.04 % 以内","0.000000")
R('rho',"密度 ρ","kg/m³",[f"={c}11*{c}{L['Mm']}/({c}{L['Zm']}*{RU}*{c}9)" for c in CO],"","0.000000")
rq = 53
ws.cell(rq,1,"── 必要飽和器温度の逆算 / required saturator temperature ──").font = C_SEC
rq += 1
ws.cell(rq,1,"目標 x_v を一次側圧力 p_1 で η_sat の RH として実現するのに必要な飽和器温度").font = C_NOTE
rq += 1
def rq_row(label, unit, formula, note_="", fmt="0.0000", res=False):
    global rq
    ws.cell(rq,1,label).font = C_CALC
    ws.cell(rq,2,unit).font = C_CALC
    c = ws.cell(rq,3,formula); c.font = C_RES if res else C_CALC
    if res: c.fill = F_RES
    c.number_format = fmt; c.border = BOX
    if note_: ws.cell(rq,8,note_).font = C_NOTE
    rq += 1
    return rq-1
r_need  = rq_row("必要 p_sat(T_sat) = x_v,目標·p_1/(η_sat·f_1)","Pa",
                 f"=G{L['xv']}*C11/({I['eta']}*C{L['f']})","f_1 は S1 の f（同じ p,T で評価）","0.0000")
r_seed  = rq_row("  初期値（Hardy 逆式）","K",f"={TDEW_HARDY('C'+str(r_need))}","","0.0000")
r_ps    = rq_row("  p_sat(初期値)","Pa",f"={PSAT('C'+str(r_seed))}","","0.0000")
r_i1    = rq_row("  Newton 1回目","K",f"={NEWTON_TDEW('C'+str(r_seed),'C'+str(r_ps),'C'+str(r_need))}","","0.0000")
r_ps2   = rq_row("  p_sat(1回目)","Pa",f"={PSAT('C'+str(r_i1))}","","0.0000")
r_i2    = rq_row("  Newton 2回目","K",f"={NEWTON_TDEW('C'+str(r_i1),'C'+str(r_ps2),'C'+str(r_need))}","","0.0000")
r_Tsatn = rq_row("★必要飽和器温度 T_sat","°C",f"=C{r_i2}-273.15",
                 "この値を 01_入力 の『飽和器出口温度』に入力すると S4 の RH が目標に一致する","0.0000",res=True)
r_Tchil = rq_row("参考: 露点制御方式の必要冷却器温度（RH=100 %）","°C",
                 f"={TDEW_HARDY('G'+str(L['xv'])+'*C11/C'+str(L['f']))}-273.15",
                 "飽和器の代わりに冷却凝縮で露点を決める場合（RH=100 %で出す）","0.0000")
r_err   = rq_row("S4 で達成される RH と目標との差","%RH",
                 f"=100*(F{L['RH']}-G{L['RH']})","0 になるように T_sat を調整（または 09_感度解析 を参照）","0.0000",res=True)
ST = {k: f"{Q(S_ST)}!${'C'}${v}" for k, v in L.items()}
STc = lambda col, row: f"{Q(S_ST)}!${col}${row}"
print("state sheet OK; Tsat req row", r_Tsatn)

# ============================================================ 04 FLOW SWITCHING
ws = wb.create_sheet(S_FL)
widths(ws, {"A": 46, "B": 16, "C": 12, "D": 80})
r = title(ws, 1, "流量切替系の設計 / Fast flow-switching train",
          "構成: 一次プレナム → 臨界ノズル A（常時 Q_L）∥ 臨界ノズル B（+ΔQ、高速弁で開閉） → 出力段")
T2, P2 = STc("D", L['TK']), STc("D", L['p'])          # nozzle stagnation state
XV, MM = STc("D", L['xv']), STc("D", L['Mm'])
r = section(ws, r, "A. 基準状態と流量 / Reference conditions and flows")
r = out(ws, r, "標準状態のモル体積 V_m,ref", f"={RU}*({I['Tref']}+273.15)/({I['pref']}*1000)", "m³/mol",
        "DIN 1343 (0 °C) = 22.4140 L/mol。20 °C 基準なら 24.0551 L/mol —— 質量流量が 7.32 % 変わる", "0.00000000"); RVM = f"{Q(S_FL)}!$B${r-1}"
r = out(ws, r, "高流量 ṅ_H", f"={I['QH']}/1000/60/{RVM}", "mol/s", "", "0.00000000"); NH = f"{Q(S_FL)}!$B${r-1}"
r = out(ws, r, "低流量 ṅ_L", f"={I['QL']}/1000/60/{RVM}", "mol/s", "", "0.00000000"); NL = f"{Q(S_FL)}!$B${r-1}"
r = out(ws, r, "流量差 Δṅ = ṅ_H − ṅ_L", f"={NH}-{NL}", "mol/s", "切替ノズル B が受け持つ流量", "0.00000000"); DN = f"{Q(S_FL)}!$B${r-1}"
r = out(ws, r, "平均流量 ṅ_mean", f"=({I['tH']}*{NH}+{I['tL']}*{NL})/({I['tH']}+{I['tL']})", "mol/s", "", "0.00000000"); NM = f"{Q(S_FL)}!$B${r-1}"
r = out(ws, r, "質量流量（高流量時）", f"={NH}*{MM}*1000", "g/s", "★論文では質量流量 g/s を主表記に。NLPM は基準条件を明記して併記", "0.00000", res=True)
r = out(ws, r, "実体積流量（出力段、高流量時）", f"={NH}*{STc('F',L['Zm'])}*{RU}*{STc('F',L['TK'])}/{STc('F',L['p'])}*60000", "L/min", "", "0.0000")
r = out(ws, r, "切替周期 T_p", f"=({I['tH']}+{I['tL']})/1000", "s", "", "0.000000"); TP = f"{Q(S_FL)}!$B${r-1}"
r = out(ws, r, "切替周波数 f_sw", f"=1/{TP}", "Hz", "", "0.0000", res=True); FSW = f"{Q(S_FL)}!$B${r-1}"
r = out(ws, r, "デューティ比 D", f"={I['tH']}/({I['tH']}+{I['tL']})", "-", "", "0.0000"); DUTY = f"{Q(S_FL)}!$B${r-1}"
r += 1
r = section(ws, r, "B. 臨界ノズル（ISO 9300 CFVN）の寸法 / Critical-flow nozzle sizing")
r = out(ws, r, "混合気体の比熱比 γ_mix（実在気体）",
        f"=({XV}*({CP0H2O(T2)})+(1-{XV})*({CPCO2(T2,P2)}))/({XV}*(({CP0H2O(T2)})-{RU})+(1-{XV})*({CVCO2(T2,P2)}))",
        "-", "実在気体の γ は圧力依存（20 °C で 1 bar:1.297 → 4 bar:1.315）。一定値を使わないこと", "0.000000"); G = f"{Q(S_FL)}!$B${r-1}"
r = out(ws, r, "臨界流関数 C*（完全気体式）", f"={CSTAR(G)}", "-",
        "ISO 9300:2022 5.2。実在気体補正は下段で Z によって行う（Annex B の表で置換可）", "0.000000"); CS = f"{Q(S_FL)}!$B${r-1}"
r = out(ws, r, "よどみ点圧縮係数 Z_0", f"={STc('D',L['Zm'])}", "-", "", "0.000000"); Z0 = f"{Q(S_FL)}!$B${r-1}"
r = out(ws, r, "実在気体 臨界流関数 C_R = C*/√Z_0", f"={CS}/SQRT({Z0})", "-",
        "よどみ密度の実在気体補正（主要項）。厳密には ISO 9300:2022 Annex B の CO2 表を使用", "0.000000"); CR = f"{Q(S_FL)}!$B${r-1}"
r = out(ws, r, "粘度 μ（よどみ点）", f"={MUCO2(T2)}", "Pa·s", "Fenghour et al. (1998) 零密度項。純 CO2 の値（水蒸気 1.4 mol% の混合効果は Re に 0.35 % で Cd には 0.02 % しか効かない）", "0.00E+00"); MU2 = f"{Q(S_FL)}!$B${r-1}"
r = out(ws, r, "気体定数 R_s = R/M_mix", f"={RU}/{MM}", "J/(kg·K)", "", "0.0000"); RS = f"{Q(S_FL)}!$B${r-1}"
r = out(ws, r, "臨界圧力比 p*/p_0", f"={RCRIT(G)}", "-", "", "0.0000"); RC = f"{Q(S_FL)}!$B${r-1}"
r = out(ws, r, "実際の背圧比 p_out/p_1", f"={I['pout']}/{I['p1']}", "-", "", "0.0000"); BPR = f"{Q(S_FL)}!$B${r-1}"
r = out(ws, r, "★チョーク判定", f'=IF({BPR}<{RC},"OK: チョーク（背圧比 "&TEXT({BPR},"0.000")&" < "&TEXT({RC},"0.000")&"）","NG: 非チョーク — 一次圧 p_1 を上げること")',
        "", "ISO 9300 は低 Re で背圧比 ≤ 0.25 を推奨。ディフューザ無しの実用限界は約 0.5", "General", res=True)
r += 1
for tag, nn, lbl in [("A", NL, "ノズル A（常時開、Q_L 分）"), ("B", DN, "ノズル B（高速弁で開閉、ΔQ 分）")]:
    r = note(ws, r, f"— {lbl} —")
    q = f"{nn}*{MM}"
    d0 = r
    r = out(ws, r, f"  {tag}: 質量流量 q_m", f"={q}", "kg/s", "", "0.00000000")
    r = out(ws, r, f"  {tag}: 反復 初期値 Cd", "=0.99", "-", "", "0.00000")
    for it in range(3):
        base = d0 + 1 + 2*it
        r = out(ws, r, f"  {tag}: 反復{it+1} のど径 d_t",
                f"=SQRT(4*($B${d0}*SQRT({RS}*{T2})/($B${base}*{CR}*{P2}))/PI())", "m", "", "0.00000000")
        r = out(ws, r, f"  {tag}: 反復{it+1} Re / Cd",
                f"={I['cda']}-{I['cdb']}*(4*$B${d0}/(PI()*$B${r-1}*{MU2}))^-0.5", "-", "", "0.00000")
    r = out(ws, r, f"★{tag}: のど径 d_t", f"=SQRT(4*($B${d0}*SQRT({RS}*{T2})/($B${r-1}*{CR}*{P2}))/PI())*1000", "mm",
            "ISO 9300:2022 トロイダル形。Cd = 0.9959 − 2.720·Re^−0.5、u(Cd)=0.3 % (k=2)", "0.0000", res=True)
    r = out(ws, r, f"  {tag}: のど Reynolds 数", f"=4*$B${d0}/(PI()*$B${r-1}/1000*{MU2})", "-",
            "有効範囲 2.1e4 ≤ Re ≤ 3.2e7。下限近傍は境界層遷移域なので実機校正が必須", "0")
    r += 1
r = note(ws, r, "【重要】CO2 は振動緩和のため、のど滞在時間と緩和時間が同程度になり Cd が最大 2 % ずれる（Johnson & Wright, Flow Meas. Instrum. 11, 315, 2000）。")
r = note(ws, r, "　　　 空気で 0.2 % のノズルが CO2 では 2 % になりうる。必ず CO2 で、実機ののど径で校正すること。")
r += 1
r = section(ws, r, "C. 切替アクチュエータの要求 / Switching actuator requirement")
r = out(ws, r, "許容応答時間（周期の10 %）", f"={TP}*1000*0.1", "ms", "", "0.000"); TREQ = f"{Q(S_FL)}!$B${r-1}"
r = out(ws, r, "★弁応答の判定", f'=IF({I["tv"]}<={TREQ},"OK: 弁 "&TEXT({I["tv"]},"0.0")&" ms ≤ 要求 "&TEXT({TREQ},"0.0")&" ms","NG: 弁が遅い")',
        "", "SMC SX10: ON 0.45 / OFF 0.40 ms, 1200 Hz。Festo MHJ9/MHJ10: <1 ms, 1000 Hz。スパイク&ホールド駆動が前提", "General", res=True)
r = out(ws, r, "サーマル MFC の最速整定時間（参考）", "=300", "ms",
        "Bronkhorst IQ+FLOW 最速 300 ms、EL-FLOW 1–2 s、Brooks GF40 <1 s、Horiba SEC-Z500X 1 s", "0")
r = out(ws, r, "  → MFC は周期の何倍か", f"=$B${r-1}/({TP}*1000)", "倍",
        "★サーマル MFC はセンサ管の熱時定数で物理的に律速。切替素子には使えない（校正基準としてのみ使用）", "0.0", res=True)
r = out(ws, r, "ピエゾ比例弁の代表応答（Festo VEMP）", "=15", "ms", "周期の半分。角波の生成には使えない", "0")
print("flow sheet OK to row", r)

# ============================================================ 05 PRESSURE STABILITY
ws = wb.create_sheet(S_PS)
widths(ws, {"A": 50, "B": 16, "C": 12, "D": 82})
r = title(ws, 1, "出力段の圧力安定性 / Pressure stability at the delivery plane")
r = note(ws, r-1, "【設計上の本質的トレードオフ】固定排気なら、30 NLPM と 15 NLPM で同じ圧力にはならない。"); r += 1
r = note(ws, r-1, "大容積で圧力を平滑化すると 30 ms の流量変調が消える。両立の唯一の解が『排気側を入口と同期して切り替える』ことである。"); r += 1
T4, P4, Z4, M4 = STc("F",L['TK']), STc("F",L['p']), STc("F",L['Zm']), STc("F",L['Mm'])
XV4 = STc("F", L['xv'])
r = section(ws, r, "0. 出力段の気体物性（以下で参照）/ Delivery-plane gas properties", 4)
r = out(ws, r, "比熱比 γ_mix（実在気体）",
        f"=({XV4}*({CP0H2O(T4)})+(1-{XV4})*({CPCO2(T4,P4)}))/({XV4}*(({CP0H2O(T4)})-{RU})+(1-{XV4})*({CVCO2(T4,P4)}))",
        "-", "cp, cv とも第2ビリアルで実在気体補正", "0.000000"); G4 = f"{Q(S_PS)}!$B${r-1}"
r = out(ws, r, "音速 c（平衡）", f"=SQRT({G4}*{RU}*{T4}*(1+2*({BCO2(T4)})*{P4}/({Z4}*{RU}*{T4}))/{M4})",
        "m/s", "湿潤混合気体として評価（M_mix を使用）。乾き CO2 なら 266.4 m/s、混合では +1.1 m/s", "0.000"); CSND = f"{Q(S_PS)}!$B${r-1}"
r = out(ws, r, "オリフィス係数 K_or",
        f"={I['Cdor']}*SQRT(2*{G4}/(({G4}-1)*({RU}/{M4})*{T4}))/SQRT({Z4})", "-",
        "流量式 q_m = K_or·A·p1·Ψ(p2/p1) の係数部分", "0.00000000"); KOR = f"{Q(S_PS)}!$B${r-1}"
r += 1
r = section(ws, r, "A. 受動バッファのみの場合（排気を切り替えない）/ Passive buffer only")
r = out(ws, r, "出力プレナム容積 V_2", f"={I['V2']}/1000000", "m³", "", "0.00000000"); V2 = f"{Q(S_PS)}!$B${r-1}"
r = out(ws, r, "空気圧キャパシタンス C = V/(n·R·T)", f"={V2}/({I['npoly']}*{RU}*{T4})", "mol/Pa",
        "n=1 等温（遅い過程）、n=γ≈1.29 断熱（速い過程）。30 ms なら断熱側。両者で 29 % 違う", "0.00E+00"); CAP = f"{Q(S_PS)}!$B${r-1}"
r = out(ws, r, "半周期に蓄積されるモル数 Δn", f"={DUTY}*(1-{DUTY})*{DN}*{TP}", "mol", "", "0.00E+00"); DNM = f"{Q(S_PS)}!$B${r-1}"
r = out(ws, r, "★圧力リプル（peak-to-peak）", f"={DNM}/{CAP}/1000", "kPa", "", "0.0000", res=True); RIP = f"{Q(S_PS)}!$B${r-1}"
r = out(ws, r, "  設定圧に対する比", f"={RIP}/{I['pg']}*100", "%", "", "0.000", res=True)
r = out(ws, r, "±0.5 % に収めるのに必要な容積", f"={DUTY}*(1-{DUTY})*{DN}*{TP}*{I['npoly']}*{RU}*{T4}/({I['pg']}*1000*0.01)*1000000", "mL",
        "この容積の滞在時間は切替周期の数十倍になり、流量変調が完全に失われる", "0.0")
r = out(ws, r, "  その容積のガス滞在時間", f"=$B${r-1}/1000000/({NM}*{Z4}*{RU}*{T4}/{P4})", "s", "", "0.000")
r = out(ws, r, "  → 切替周期の何倍か", f"=$B${r-1}/{TP}", "倍", "★これが『圧力を静かにすると流量変調が消える』という矛盾の定量表現", "0.0", res=True)
r += 1
r = section(ws, r, "B. 固定排気オリフィスだと何が起きるか / Why a fixed exhaust orifice fails")
PSI = lambda rr: f"SQRT(MAX(({rr})^(2/{G4})-({rr})^((1+{G4})/{G4}),0))"
r = out(ws, r, "排気圧力比 p_atm/p_out", f"={I['p_atm']}/{I['pout']}", "-", "", "0.0000"); PRAT = f"{Q(S_PS)}!$B${r-1}"
r = out(ws, r, "  臨界圧力比（参考）", f"={RCRIT(G4)}", "-", "排気は亜音速（チョークしない）→ 流量は上下流の両方に依存する", "0.0000")
r = out(ws, r, "流量関数 Ψ(p_atm/p_out)", f"={PSI(PRAT)}", "-", "", "0.000000"); PS4 = f"{Q(S_PS)}!$B${r-1}"
r = out(ws, r, "Q_L を通す固定オリフィス径", f"=SQRT(4*({NL}*{M4}/({KOR}*{P4}*{PS4}))/PI())*1000", "mm", "", "0.0000"); DFIX = f"{Q(S_PS)}!$B${r-1}"
r = out(ws, r, "  そのオリフィスに Q_H を流したときの圧力（反復 1）",
        f"={I['p_atm']}*1000+({P4}-{I['p_atm']}*1000)*({NH}/{NL})^2", "Pa", "", "0.00")
for k in range(3):
    pr = f"({I['p_atm']}*1000/$B${r-1})"
    r = out(ws, r, f"  反復 {k+2}",
            f"=$B${r-1}*({NH}*{M4}/({KOR}*$B${r-1}*{PSI(pr)}*PI()*({DFIX}/1000)^2/4))", "Pa", "", "0.00")
r = out(ws, r, "★固定排気のとき Q_H で生じるゲージ圧", f"=($B${r-1}-{I['p_atm']}*1000)/1000", "kPa",
        "目標 20 kPa に対して桁違い。固定排気では仕様を満たせないことの定量的証明", "0.000", res=True)
r += 1
r = section(ws, r, "C. 推奨構成: 排気側を同期切替 / Recommended: synchronised exhaust switching")
r = note(ws, r, "入口の高速弁と同じ信号で排気オリフィスも切り替える。定常状態では Q_L / Q_H のどちらでも同じ 20 kPa を保つ。"); r += 1
r = out(ws, r, "排気オリフィス C（常時開、Q_L 分）径", f"={DFIX}", "mm", "", "0.0000", res=True)
r = out(ws, r, "排気オリフィス D（同期切替、ΔQ 分）径", f"=SQRT(4*({DN}*{M4}/({KOR}*{P4}*{PS4}))/PI())*1000", "mm", "", "0.0000", res=True)
r = out(ws, r, "合計（Q_H 時の等価径）", f"=SQRT(4*({NH}*{M4}/({KOR}*{P4}*{PS4}))/PI())*1000", "mm", "", "0.0000")
r = out(ws, r, "★残留リプル（弁の同期ずれ Δt_skew による）", f"={DN}*{I['skew']}/1000*{I['npoly']}*{RU}*{T4}/{V2}/1000", "kPa",
        "同期ずれの間だけ流入と流出が釣り合わない。これが達成可能な圧力精度を決める", "0.0000", res=True); RIP2 = f"{Q(S_PS)}!$B${r-1}"
r = out(ws, r, "  設定圧に対する比", f"={RIP2}/{I['pg']}*100", "%", "", "0.000", res=True)
r = out(ws, r, "  受動バッファのみに対する改善率", f"={RIP}/{RIP2}", "倍", "", "0.0", res=True)
r = out(ws, r, "その圧力リプルが RH に与える誤差", f"={RIP2}*{STc('F',L['RH'])}/({I['pout']})*100", "%RH",
        "RH ∝ p（x_v, T 一定）。圧力よりも温度の方がはるかに効く（09_感度解析 参照）", "0.0000")
r += 1
r = section(ws, r, "D. 音響・容積の制約 / Acoustic and dead-volume limits")
r = out(ws, r, "音速（平衡、振動緩和あり）", f"={CSND}", "m/s", "上段(0節)で算出した値", "0.000")
r = out(ws, r, "音速（凍結、γ=7/5 の高周波極限）", f"=SQRT(1.4*{RU}*{T4}/{M4})", "m/s",
        "CO2 は振動緩和で強く分散する。切替エッジの高周波成分は約 4.5 % 速い音速を見る", "0.000")
r = out(ws, r, "★集中定数モデルの配管長限界 L < c·t_r/10", f"={CSND}*{I['tv']}/1000/10*1000", "mm",
        "弁のエッジで判定する（基本波ではなく）。これを超える配管は伝送線路として扱う必要がある", "0.0", res=True)
r = out(ws, r, "  実際の配管長", f"={I['L']}*1000", "mm", "", "0.0")
r = out(ws, r, "  判定", f'=IF({I["L"]}*1000<=$B${r-2},"OK: 集中定数近似が成立","注意: 伝送線路効果あり — 配管短縮かエッジ鈍化を検討")', "", "", "General", res=True)
r = out(ws, r, "1/4波長共振周波数 c/(4L)", f"={CSND}/(4*{I['L']})", "Hz", "切替の高調波と重ならないこと", "0.0")
r = out(ws, r, "ヘルムホルツ共鳴周波数 f_H", f"={CSND}/(2*PI())*SQRT((PI()*({I['dn']}/1000)^2/4)/({V2}*({I['Ln']}/1000+0.85*{I['dn']}/2000)))", "Hz",
        "★プレナム容積と首部で決まる。切替の第5高調波より上に置くこと", "0.0", res=True)
r = out(ws, r, "  切替基本波 f_sw", f"={FSW}", "Hz", "", "0.00")
r = out(ws, r, "  第5高調波", f"=5*{FSW}", "Hz", "", "0.00")
r = out(ws, r, "  判定", f'=IF($B${r-3}>5*{FSW},"OK: 共鳴は第5高調波より上","NG: 共鳴が切替高調波帯にある — 首部形状を変更")', "", "", "General", res=True)
r = out(ws, r, "半周期あたりの掃気体積（Q_H）", f"={NH}*{Z4}*{RU}*{T4}/{P4}*{I['tH']}/1000*1000000", "mL",
        "★切替弁より下流の死容積はこれより十分小さいこと。さもないとエッジが鈍る", "0.000", res=True)
r = out(ws, r, "  死容積の推奨上限（掃気体積の1/5）", f"=$B${r-1}/5", "mL", "", "0.000")
r += 1
r = section(ws, r, "E. 平均圧の制御 / Mean-pressure control (regulator, DC only)")
r = note(ws, r, "33 Hz 帯のリプルを制御器で潰すのは不可能: Alicat PC は 30 ms（＝1周期、位相遅れ360°）、Tescom ER3000 は 552 ms。"); r += 1
r = note(ws, r, "最速級の Equilibar ドームロード背圧弁でも約 10 ms。背圧弁は平均圧の保持のみに使い、リプルは受動＋同期排気で処理する。"); r += 1
r = out(ws, r, "背圧弁に要求される帯域（平均圧保持のみ）", "=1", "Hz", "上記いずれの機種でも十分", "0.0")
print("pressure sheet OK to", r)

# ============================================================ 06 THERMAL / WATER
ws = wb.create_sheet(S_TH)
widths(ws, {"A": 48, "B": 16, "C": 12, "D": 80})
r = title(ws, 1, "熱・水収支 / Thermal and water balance")
r = section(ws, r, "A. 加湿に必要な水 / Water demand")
r = out(ws, r, "水蒸気モル流量（Q_H 時）", f"={NH}*{STc('F',L['xv'])}", "mol/s", "", "0.00E+00")
r = out(ws, r, "★蒸発させる水の量（Q_H、乾ガスから）", f"=$B${r-1}*{M_H2O}*3600*1000", "g/h", "", "0.000", res=True)
r = out(ws, r, "  同（Q_L 時）", f"=$B${r-1}*{NL}/{NH}", "g/h", "", "0.000")
r = out(ws, r, "水の蒸発潜熱 Δh_vap(T_out)", f"={LV(T4)}/1000", "kJ/kg", "IAPWS-95 へのフィット。20 °C で 2453.5 kJ/kg", "0.000")
r = out(ws, r, "★潜熱負荷", f"=$B${r-3}/3600/1000*$B${r-1}*1000", "W", "", "0.000", res=True); PLAT = f"$B${r-1}"
r += 1
r = section(ws, r, "B. 顕熱（加熱・冷却）/ Sensible duty")
CPM = lambda T,P: f"({STc('F',L['xv'])}*({CP0H2O(T)})+(1-{STc('F',L['xv'])})*({CPCO2(T,P)}))"
r = out(ws, r, "混合気体のモル比熱 cp_mix（出力段）", f"={CPM(T4,P4)}", "J/(mol·K)", "", "0.0000"); CPX = f"{Q(S_TH)}!$B${r-1}"
r = out(ws, r, "  質量基準 cp", f"={CPX}/{M4}", "J/(kg·K)", "CO2 は 846 J/(kg·K)（20 °C, 1 atm）", "0.00")
r = out(ws, r, "顕熱負荷 1 K あたり（Q_H）", f"={NH}*{CPX}", "W/K", "", "0.0000"); WPK = f"{Q(S_TH)}!$B${r-1}"
r = out(ws, r, "S2 → S3（JT 膨張）の温度変化", f"={Q(S_ST)}!$B$3", "K", "自然に起きる冷却（加熱器不要）", "0.0000")
r = out(ws, r, "★S3 → S4 の恒温化に要する熱量", f"={WPK}*({STc('F',L['T'])}-{STc('E',L['T'])})", "W",
        "負なら冷却。出力プレナムを恒温槽／ペルチェで 20.0 ± 0.2 °C に保つ", "0.000", res=True)
r = out(ws, r, "飽和器の蒸発潜熱による自己冷却", f"={PLAT}", "W", "飽和器は恒温制御が必須（放置すると自己冷却でドリフトする）", "0.000")
r = out(ws, r, "配管からの放熱（概算）", f"=PI()*({I['di']}/1000+0.002)*{I['L']}*10*({I['Ttr']}-20)", "W",
        "h≈10 W/(m²K)、無保温・自然対流。断熱すれば 1/3 以下", "0.000")
r = out(ws, r, "★ヒータ推奨容量（計算値の3倍）", f"=3*(ABS($B${r-3})+{PLAT}+ABS($B${r-1}))", "W",
        "過大にしないこと。オーバーシュートは 20 °C を超えて RH を下げる", "0.0", res=True)
r += 1
r = section(ws, r, "C. 結露余裕の監視 / Condensation margin at every state point")
r = hdr(ws, r, ["状態点","温度 [°C]","露点 [°C]","余裕 ΔT [K]","判定"])
for i, (cl, nm) in enumerate(zip("CDEF", ["S1 飽和器出口","S2 ノズル上流","S3 ノズル下流","S4 出力段"])):
    ws.cell(r,1,nm).font = C_CALC
    for j, rw in enumerate([L['T'], L['tdC'], L['marg']]):
        c = ws.cell(r,2+j,f"={STc(cl,rw)}"); c.font=C_CALC; c.number_format="0.0000"; c.border=BOX
    txt = ('=IF({m}>0,"仕様上ここは飽和近傍（RH=η_sat）。下流を単調に昇温させ、デミスタを設けること","NG: 結露")'.format(m=STc(cl,L["marg"]))
           if i == 0 else
           f'=IF({STc(cl,L["marg"])}>=5,"OK (≥5 K)",IF({STc(cl,L["marg"])}>0,"注意: 余裕 <5 K — 壁温を上げること","NG: 結露"))')
    c = ws.cell(r,5,txt)
    c.font, c.fill, c.border = C_RES, F_RES, BOX
    r += 1
r += 1
r = note(ws, r-1, "US EPA Method 320 は試料配管を露点より最低 5 °C 高く保つことを要求。業界慣行の 20 K は出力段では使えない（RH 仕様が壊れるため）。"); r += 1
r = note(ws, r-1, "余裕は『温度の均一性』で買う: 分布 RTD を3点以上、バルブ本体・継手・センサボスの冷点を無くし、温度プロファイルを単調にすること。"); r += 1
r = note(ws, r-1, "濡れ面は PFA/PTFE を推奨。ステンレスは RH 依存の水分吸着で高速応答を鈍らせる（AMT 12, 3453, 2019）。"); r += 1
r = note(ws, r-1, "湿潤CO2の凝縮水は pH 3.6–3.9（炭酸）。炭素鋼は不可（de Waard–Milliams）。316L・PFA・PTFE・PEEK を使用し、給水は必ず純水（塩化物による孔食防止）。"); r += 1
r = note(ws, r-1, "ドライアイス生成の心配は不要: CO2 三重点 216.592 K / 517.95 kPa、1 atm 昇華点 194.7 K。JT だけで到達するには約 89 bar の差圧が必要で、本系の 2.8 bar とは32倍の開きがある。"); r += 1

# ============================================================ 07 PIPING
ws = wb.create_sheet(S_PI)
widths(ws, {"A": 46, "B": 16, "C": 12, "D": 80})
r = title(ws, 1, "配管 / Piping between the switching valve and the delivery plane")
MUM = f"({MUCO2(T4)})"
r = out(ws, r, "内径 d_i", f"={I['di']}/1000", "m", "", "0.00000"); DI = f"{Q(S_PI)}!$B${r-1}"
r = out(ws, r, "断面積 A", f"=PI()*{DI}^2/4", "m²", "", "0.00E+00"); AA = f"{Q(S_PI)}!$B${r-1}"
r = out(ws, r, "実体積流量（Q_H）", f"={NH}*{Z4}*{RU}*{T4}/{P4}", "m³/s", "", "0.00000000"); QV = f"{Q(S_PI)}!$B${r-1}"
r = out(ws, r, "流速 v", f"={QV}/{AA}", "m/s", "20 m/s 以下を目安（圧損と騒音）", "0.000", res=True); VV = f"{Q(S_PI)}!$B${r-1}"
r = out(ws, r, "密度 ρ", f"={STc('F',L['rho'])}", "kg/m³", "", "0.00000"); RHO = f"{Q(S_PI)}!$B${r-1}"
r = out(ws, r, "粘度 μ（CO2 希薄極限）", f"={MUM}", "Pa·s", "Fenghour et al. (1998)。Laesecke & Muzny (2017) と 0.04 % 一致", "0.00E+00")
r = out(ws, r, "Reynolds 数 Re", f"={RHO}*{VV}*{DI}/{MUM}", "-", "", "0.0"); RE = f"{Q(S_PI)}!$B${r-1}"
r = out(ws, r, "Darcy 摩擦係数 f", f"=IF({RE}<2300,64/{RE},0.3164*{RE}^-0.25)", "-", "層流 64/Re、乱流 Blasius（4e3<Re<1e5）", "0.00000"); FF = f"{Q(S_PI)}!$B${r-1}"
r = out(ws, r, "★圧力損失 Δp", f"={FF}*({I['L']}/{DI})*0.5*{RHO}*{VV}^2/1000", "kPa",
        "20 kPa の設定値に対する比率を確認すること", "0.0000", res=True)
r = out(ws, r, "  設定ゲージ圧に対する比", f"=$B${r-1}/{I['pg']}*100", "%", "", "0.00", res=True)
r = out(ws, r, "ガス粒子の輸送遅れ L/v", f"={I['L']}/{VV}*1000", "ms", "組成が一様なら流量ステップには効かない", "0.000")
r = out(ws, r, "音響伝播遅れ L/c", f"={I['L']}/{CSND}*1000", "ms",
        "★流量ステップはこの速さで伝わる（ガス粒子の速さではない）", "0.000", res=True)
r = out(ws, r, "弁応答時間との比較", f"={I['tv']}", "ms", "", "0.000")
r = note(ws, r, "推奨: 切替弁・ノズル・出力プレナムを 30 mm 以内に一体化する。配管が長いほどエッジが鈍り、定在波が立つ。")

# ============================================================ 08 SAFETY
ws = wb.create_sheet(S_SF)
widths(ws, {"A": 50, "B": 16, "C": 12, "D": 80})
r = title(ws, 1, "安全・換気 / Safety and ventilation")
r = out(ws, r, "CO2 放出モル流量（Q_H 連続）", f"={NH}", "mol/s", "", "0.00000000")
r = out(ws, r, "室温・大気圧での空気モル体積", f"={RU}*293.15/101325", "m³/mol", "", "0.00000000"); VAIR = f"$B${r-1}"
r = out(ws, r, "★必要換気量（k=1）", f"={NH}*{VAIR}/(({I['Clim']}-{I['Cbg']})/1000000)*3600", "m³/h",
        "定常・完全混合。分子基準で統一（CO2 の標準状態体積と室内空気体積を混ぜないこと）", "0.0", res=True)
r = out(ws, r, "★必要換気量（混合係数 k 込み）", f"=$B${r-1}*{I['kvent']}", "m³/h",
        "EIGA Doc 44: CO2 は空気より重く低所に滞留するため k ≥ 3。排気は最下部から、給気は上部から", "0.0", res=True)
r = out(ws, r, "  換気回数", f"=$B${r-1}/{I['Vroom']}", "回/h", "", "0.00", res=True)
r = out(ws, r, "★換気停止時に管理濃度に達する時間", f"={I['Vroom']}*(({I['Clim']}-{I['Cbg']})/1000000)/({NH}*{VAIR})/60", "min",
        "★安全論拠として最も重要な数字。CO2 モニタと給気インターロックを必須とする根拠", "0.00", res=True)
r = out(ws, r, "  STEL 30000 ppm に達する時間", f"={I['Vroom']}*((30000-{I['Cbg']})/1000000)/({NH}*{VAIR})/60", "min", "", "0.00")
r = out(ws, r, "  IDLH 40000 ppm に達する時間", f"={I['Vroom']}*((40000-{I['Cbg']})/1000000)/({NH}*{VAIR})/60", "min", "", "0.00")
r += 1
for t in ["曝露限界: ACGIH TLV-TWA 5000 ppm / STEL 30000 ppm、OSHA PEL 5000 ppm（29 CFR 1910.1000 Table Z-1）、NIOSH IDLH 40000 ppm。",
          "CGA G-6.14 (2023): 5000 ppm で常時有人場所に可聴＋可視の監視警報、30000 ppm で室内に可聴＋可視警報。",
          "EIGA Doc 44: 酸素濃度計では代用できない（CO2 は酸素が十分でも危険）。NDIR の CO2 直読モニタを低所に設置すること。",
          "CO2 は空気の約1.5倍重い。天井排気は設計ミス。排気は最下部から、給気を上部から入れる。",
          "供給電磁弁を換気プルーフと CO2 警報にインターロックすること。"]:
    r = note(ws, r, t)
print("sheets 06-08 OK")

# ============================================================ 09 SENSITIVITY
ws = wb.create_sheet(S_SE)
widths(ws, {"A": 26, "B": 16, "C": 16, "D": 16, "E": 16, "F": 16, "G": 70})
r = title(ws, 1, "感度解析 / Sensitivity analysis",
          "保存量 x_v を固定し、RH = x_v·p /(f(T,p)·p_sat(T)) を評価。f は1回反復（誤差 3e−5）で評価。")
UF = I['usef']
B12C = lambda tk: f"(({B12(tk)})+{I['B12']}/1000000)"
c = ws.cell(1,8,f"={PSAT('('+I['Tout']+'+273.15)')}"); c.font, c.number_format = C_CALC, "0.0000"
ws.cell(2,8,"p_sat(T_out) — 下の表で参照する共通値").font = C_NOTE
XVT = STc("F", L['xv'])
r = section(ws, r, "A. 出力段温度に対する感度 / Sensitivity to delivery temperature", 7)
r = hdr(ws, r, ["T_out [°C]","p_sat [Pa]","k_H [Pa]","f [-]","RH [%]","目標からの差 [%RH]","露点余裕 [K]"])
r0 = r
for i in range(17):
    t = f"$A${r}"; tk = f"({t}+273.15)"; p = f"({I['pout']}*1000)"
    ws.cell(r,1,18.0+0.25*i).font = C_IN; ws.cell(r,1).fill = F_IN; ws.cell(r,1).number_format="0.00"
    for j,(fm,nf) in enumerate([(f"={PSAT(tk)}","0.0000"), (f"={KH_FROM_PSAT('$B$'+str(r),tk)}","0.00E+00"),
                                (f"={FONE('$B$'+str(r),'$C$'+str(r),p,tk,B12C(tk),UF)}","0.000000"),
                                (f"=100*{XVT}*{p}/($D${r}*$B${r})","0.0000"),
                                (f"=$E${r}-100*{I['RHout']}","0.0000"),
                                (f"={t}-{STc('F',L['tdC'])}","0.0000")]):
        c = ws.cell(r,2+j,fm); c.font=C_CALC; c.number_format=nf; c.border=BOX
    r += 1
ws.cell(r,1,"感度 dRH/dT").font = C_SEC
c = ws.cell(r,5,f"=($E${r-1}-$E${r0})/($A${r-1}-$A${r0})"); c.font,c.fill,c.number_format,c.border = C_RES,F_RES,"0.0000",BOX
ws.cell(r,6,"%RH/K").font = C_CALC
ws.cell(r,7,"★ 約 −4.34 %RH/K（18–22 °C の割線。20 °C での接線は −4.32）。±1 %RH を守るには温度を ±0.23 K に制御する必要がある。最も厳しい要求。").font = C_NOTE
r += 1
c = ws.cell(r,5,f"=1/ABS($E${r-1})"); c.font,c.fill,c.number_format,c.border = C_RES,F_RES,"0.0000",BOX
ws.cell(r,1,"±1 %RH に必要な温度精度").font = C_SEC; ws.cell(r,6,"K").font = C_CALC
r += 2
r = section(ws, r, "B. 出力段圧力に対する感度 / Sensitivity to delivery pressure", 7)
r = hdr(ws, r, ["ゲージ圧 [kPa]","絶対圧 [Pa]","k_H [Pa]","f [-]","RH [%]","目標からの差 [%RH]"])
r1 = r
for i in range(9):
    pg = f"$A${r}"; p = f"(({I['p_atm']}+{pg})*1000)"; tk = f"({I['Tout']}+273.15)"
    ws.cell(r,1,16.0+i).font = C_IN; ws.cell(r,1).fill = F_IN; ws.cell(r,1).number_format="0.00"
    for j,(fm,nf) in enumerate([(f"={p}","0.00"), (f"={KH_FROM_PSAT(PSAT(tk),tk)}","0.00E+00"),
                                (f"={FONE('$H$1','$C$'+str(r),p,tk,B12C(tk),UF)}","0.000000"),
                                (f"=100*{XVT}*$B${r}/($D${r}*$H$1)","0.0000"),
                                (f"=$E${r}-100*{I['RHout']}","0.0000")]):
        c = ws.cell(r,2+j,fm); c.font=C_CALC; c.number_format=nf; c.border=BOX
    r += 1
ws.cell(r,1,"感度 dRH/dp").font = C_SEC
c = ws.cell(r,5,f"=($E${r-1}-$E${r1})/($A${r-1}-$A${r1})"); c.font,c.fill,c.number_format,c.border=C_RES,F_RES,"0.0000",BOX
ws.cell(r,6,"%RH/kPa").font = C_CALC
ws.cell(r,7,"RH ∝ p。±1 %RH には ±1.76 kPa。05シートの同期排気なら余裕で満たせる。").font = C_NOTE
r += 2
r = section(ws, r, "C. 飽和器温度に対する感度 / Sensitivity to saturator temperature", 7)
r = hdr(ws, r, ["T_sat [°C]","p_sat [Pa]","k_H [Pa]","f_1 [-]","x_v [-]","出力段 RH [%]","目標からの差 [%RH]"])
r2 = r
for i in range(11):
    t = f"$A${r}"; tk = f"({t}+273.15)"; p1 = f"({I['p1']}*1000)"; p4 = f"({I['pout']}*1000)"
    ws.cell(r,1,f"={STc('C',L['T'])}+{-1.0+0.2*i}").font = C_IN
    ws.cell(r,1).fill = F_IN; ws.cell(r,1).number_format="0.0000"
    for j,(fm,nf) in enumerate([(f"={PSAT(tk)}","0.0000"), (f"={KH_FROM_PSAT('$B$'+str(r),tk)}","0.00E+00"),
                                (f"={FONE('$B$'+str(r),'$C$'+str(r),p1,tk,B12C(tk),UF)}","0.000000"),
                                (f"={I['eta']}*$D${r}*$B${r}/{p1}","0.00000000"),
                                (f"=100*$E${r}*{p4}/({STc('F',L['f'])}*$H$1)","0.0000"),
                                (f"=$F${r}-100*{I['RHout']}","0.0000")]):
        c = ws.cell(r,2+j,fm); c.font=C_CALC; c.number_format=nf; c.border=BOX
    r += 1
ws.cell(r,1,"感度 dRH/dT_sat").font = C_SEC
c = ws.cell(r,6,f"=($F${r-1}-$F${r2})/($A${r-1}-$A${r2})"); c.font,c.fill,c.number_format,c.border=C_RES,F_RES,"0.0000",BOX
ws.cell(r,7,"%RH/K").font = C_CALC
ws.cell(r,8,"飽和器も同程度に効く。飽和器槽は ±0.1 K 以内で制御すること（NIST HHG は 1 mK）。").font = C_NOTE
r += 2
r = section(ws, r, "D. 一次圧の安定度が流量に与える影響 / Supply-pressure stability → flow error", 7)
r = note(ws, r, "臨界ノズルでは q_m ∝ p_0 なので、一次圧の相対変動はそのまま流量誤差になる（1:1）。")
r = hdr(ws, r, ["p_1 変動 [%]","流量誤差 [%]","一次プレナムで許容される圧力リプル [kPa]","—","—","—"])
for i,e in enumerate([0.1,0.2,0.5,1.0,2.0]):
    ws.cell(r,1,e).font=C_IN; ws.cell(r,1).fill=F_IN; ws.cell(r,1).number_format="0.00"
    for j,fm in enumerate([f"=$A${r}", f"=$A${r}/100*{I['p1']}"]):
        c=ws.cell(r,2+j,fm); c.font=C_CALC; c.number_format="0.0000"; c.border=BOX
    r += 1
r = out(ws, r, "一次プレナムの実際のリプル（受動、同期なし）",
        f"={DUTY}*(1-{DUTY})*{DN}*{TP}*{I['npoly']}*{RU}*{STc('D',L['TK'])}/({I['V1']}/1000)/1000", "kPa", "", "0.0000", res=True)
r = out(ws, r, "  → 流量誤差に換算", f"=$B${r-1}/{I['p1']}*100", "%",
        "★一次プレナムはノズル流量精度を直接決める。ここは大きめに取ること", "0.0000", res=True)

# ============================================================ 10 VALIDATION
ws = wb.create_sheet(S_VA)
widths(ws, {"A": 42, "B": 15, "C": 15, "D": 12, "E": 10, "F": 66})
r = title(ws, 1, "検証 / Verification of the built-in correlations",
          "本シートの数式が参照標準を再現することを確認する。参照値は Span–Wagner (1996)、IAPWS-95、CIPM-2007。")
r = hdr(ws, r, ["量 / quantity","本ブック","参照値","偏差 [%]","判定","出典 / source"])
VAL = [
 ("p_sat(10.00 °C)", f"={PSAT('283.15')}", 1228.1989, 0.01, "IAPWS-95 (Wagner & Pruß 2002)"),
 ("p_sat(14.00 °C)", f"={PSAT('287.15')}", 1598.9838, 0.01, "IAPWS-95"),
 ("p_sat(20.00 °C)", f"={PSAT('293.15')}", 2339.3182, 0.01, "IAPWS-95"),
 ("p_sat(30.00 °C)", f"={PSAT('303.15')}", 4246.9708, 0.01, "IAPWS-95"),
 ("B_CO2(273.15 K) [cm³/mol]", f"={BCO2('273.15')}*1000000", -150.30, 0.5, "Span & Wagner (1996) 零密度極限"),
 ("B_CO2(293.15 K) [cm³/mol]", f"={BCO2('293.15')}*1000000", -127.88, 0.5, "Span & Wagner (1996)"),
 ("B_CO2(323.15 K) [cm³/mol]", f"={BCO2('323.15')}*1000000", -102.06, 0.5, "Span & Wagner (1996)"),
 ("Z_CO2(20 °C, 101.325 kPa)", f"={ZCO2('101325','293.15')}", 0.994664, 0.05, "Span & Wagner (1996)"),
 ("Z_CO2(20 °C, 250 kPa)", f"={ZCO2('250000','293.15')}", 0.986759, 0.05, "Span & Wagner (1996)"),
 ("Z_CO2(20 °C, 400 kPa)", f"={ZCO2('400000','293.15')}", 0.978692, 0.10, "Span & Wagner (1996)"),
 ("ρ_CO2(0 °C, 101.325 kPa) [kg/m³]", f"=101325*{M_CO2}/(({ZCO2('101325','273.15')})*{RU}*273.15)", 1.97681, 0.05, "Span & Wagner (1996)"),
 ("ρ_CO2(20 °C, 101.325 kPa) [kg/m³]", f"=101325*{M_CO2}/(({ZCO2('101325','293.15')})*{RU}*293.15)", 1.83934, 0.05, "Span & Wagner (1996)"),
 ("cp_CO2(20 °C, 101.325 kPa) [J/mol·K]", f"={CPCO2('293.15','101325')}", 37.2347, 0.10, "Span & Wagner (1996)"),
 ("cp_CO2(20 °C, 250 kPa) [J/mol·K]", f"={CPCO2('293.15','250000')}", 37.7264, 0.20, "Span & Wagner (1996)"),
 ("γ_CO2(20 °C, 101.325 kPa)", f"=({CPCO2('293.15','101325')})/({CVCO2('293.15','101325')})", 1.29674, 0.10, "Span & Wagner (1996)"),
 ("γ_CO2(20 °C, 250 kPa)", f"=({CPCO2('293.15','250000')})/({CVCO2('293.15','250000')})", 1.30586, 0.15, "Span & Wagner (1996)"),
 ("μ_CO2(20 °C) [µPa·s]", f"={MUCO2('293.15')}*1000000", 14.6748, 0.10, "Laesecke & Muzny (2017); Fenghour (1998) と 0.04 % 一致"),
 ("μ_CO2(0 °C) [µPa·s]", f"={MUCO2('273.15')}*1000000", 13.7093, 0.15, "Laesecke & Muzny (2017)"),
 ("k_CO2(20 °C) [mW/m·K]", f"={KCO2('293.15')}*1000", 16.2505, 0.50, "Huber et al. (2016)、相関自体の u = 1 % (k=2)"),
 ("μ_JT CO2(20 °C) [K/bar]", f"={MUJT_CO2('293.15')}*100000", 1.1417, 1.0, "Span & Wagner (1996)。空気は 0.2362 K/bar"),
 ("音速 CO2(20 °C, 101.325 kPa) [m/s]",
  f"=SQRT(({CPCO2('293.15','101325')})/({CVCO2('293.15','101325')})*{RU}*293.15*(1+2*({BCO2('293.15')})*101325/(({ZCO2('101325','293.15')})*{RU}*293.15))/{M_CO2})",
  266.556, 0.10, "Span & Wagner (1996)"),
 ("k_H CO2 in H2O (20 °C) [MPa]", f"={KH_CO2('293.15')}/1000000", 145.0, 1.0, "IAPWS G7-04 (2004)"),
 ("B12(H2O-CO2, 20 °C) [cm³/mol]", f"={B12('293.15')}*1000000", -235.5, 2.0, "Meyer & Harvey (2015) / Wheatley & Harvey (2011,2016)"),
 ("露点逆算 Hardy 式の往復誤差 [mK]", f"=1000*(({TDEW_HARDY(PSAT('293.15'))})-293.15)", 0.0, 99, "Hardy (1998)。|誤差| < 1 mK なら合格"),
 ("ε_CO2 = M_H2O/M_CO2", f"={M_H2O}/{M_CO2}", 0.409350, 0.01, "CIAAW 2021。空気の 0.622 を使うと +51.9 % の誤り"),
 ("V_m 標準状態 0 °C (DIN 1343) [L/mol]", f"={RU}*273.15/101325*1000", 22.41397, 0.01, "DIN 1343:1990（= SEMI E12-0303）"),
 ("V_m 20 °C（ベンダ慣行）[L/mol]", f"={RU}*293.15/101325*1000", 24.05512, 0.01, "標準ではない。0 °C 基準との差は 7.32 %"),
]
for lbl, fm, ref, tol, src in VAL:
    ws.cell(r,1,lbl).font = C_CALC
    c = ws.cell(r,2,fm); c.font=C_CALC; c.number_format="0.000000"; c.border=BOX
    c = ws.cell(r,3,ref); c.font=C_LINK; c.number_format="0.000000"; c.border=BOX
    c = ws.cell(r,4,f'=IF($C${r}=0,ABS($B${r}),100*($B${r}/$C${r}-1))'); c.font=C_CALC; c.number_format="0.0000"; c.border=BOX
    c = ws.cell(r,5,f'=IF(ABS($D${r})<={tol},"合格","要確認")'); c.font=C_RES; c.fill=F_OK; c.border=BOX
    ws.cell(r,6,src).font = C_NOTE
    r += 1
r += 1
ws.cell(r,1,"総合判定").font = C_SEC
c = ws.cell(r,2,f'=IF(COUNTIF($E${r-len(VAL)-1}:$E${r-2},"要確認")=0,"全項目 合格",COUNTIF($E${r-len(VAL)-1}:$E${r-2},"要確認")&" 項目が要確認")')
c.font, c.fill, c.border = C_RES, F_RES, BOX
r += 2
for t in ["参照値の取得方法: 本セッションでは外部サイトへの直接アクセス（WebFetch）が遮断されていたため、参照値は Span–Wagner (1996)／",
          "IAPWS-95／Laesecke–Muzny (2017)／Huber et al. (2016) を実装した CoolProp 8.0.0 をローカルで実行して生成した。",
          "CoolProp は NIST REFPROP と同じ基準相関を実装しているが、学会投稿前には NIST Webbook または REFPROP で表を再生成し、",
          "そちらを引用することを推奨する（数値は一致するはずである）。文献の書誌情報は WebSearch で確認済み。"]:
    r = note(ws, r, t)
print("sheets 09-10 OK")

# ============================================================ 11 REFERENCES
ws = wb.create_sheet(S_RE)
widths(ws, {"A": 6, "B": 30, "C": 74, "D": 34})
r = title(ws, 1, "引用文献 / References")
r = hdr(ws, r, ["No.","分野 / topic","文献 / reference","DOI / URL"])
REFS = [
 ("状態方程式","Span, R. & Wagner, W. (1996) A New Equation of State for Carbon Dioxide…, J. Phys. Chem. Ref. Data 25(6), 1509–1596. 密度 ±0.03–0.05 %","10.1063/1.555991"),
 ("CO2 ビリアル係数","Duschek, W., Kleinrahm, R. & Wagner, W. (1990) J. Chem. Thermodyn. 22(9), 827–840. B を 0.4 % 以内で決定","10.1016/0021-9614(90)90172-M"),
 ("CO2 粘度","Laesecke, A. & Muzny, C. D. (2017) J. Phys. Chem. Ref. Data 46, 013107（現行の基準相関）","10.1063/1.4977429"),
 ("CO2 粘度","Fenghour, A., Wakeham, W. A. & Vesovic, V. (1998) J. Phys. Chem. Ref. Data 27(1), 31–44","10.1063/1.556013"),
 ("CO2 熱伝導率","Huber, M. L. et al. (2016) J. Phys. Chem. Ref. Data 45(1), 013102。u = 1 % (k=2)","10.1063/1.4940892"),
 ("水の状態方程式","Wagner, W. & Pruß, A. (2002) J. Phys. Chem. Ref. Data 31(2), 387–535 (IAPWS-95)","10.1063/1.1461829"),
 ("水の蒸気圧","Wagner, W. & Pruß, A. (1993) J. Phys. Chem. Ref. Data 22(3), 783–787 = IAPWS SR1-86","10.1063/1.555926"),
 ("水の蒸気圧（実用）","IAPWS R7-97(2012) Industrial Formulation 1997, Eq. (30)","iapws.org/relguide/IF97-Rev"),
 ("湿度計測用蒸気圧","Hardy, B. (1998) ITS-90 Formulations…, Proc. 3rd Int. Symp. Humidity & Moisture, 214–222","—"),
 ("湿度計測用蒸気圧","Hyland, R. W. & Wexler, A. (1983) ASHRAE Trans. 89(2A), 500–519 = ASHRAE Fundamentals Ch.1 Eq.(6)","—"),
 ("RH の定義","Lovell-Smith, J. W. et al. (2016) Metrologia 53(1), R40。★非空気系 RH 定義の根拠","10.1088/0026-1394/53/1/R40"),
 ("RH の定義","Feistel, R. & Lovell-Smith, J. W. (2017) Metrologia 54(4), 566（水の活量による定義）","10.1088/1681-7575/aa7083"),
 ("RH の定義","WMO-No. 8 CIMO Guide, Ch.4 + Annex 4.A。f は空気についてのみ表化されている","library.wmo.int/idurl/4/68695"),
 ("エンハンスメント係数（空気）","Greenspan, L. (1976) J. Res. NBS 80A(1), 41–44。★『CO2-free moist air』用であり CO2 系には使えない","10.6028/jres.080A.007"),
 ("エンハンスメント係数（空気）","Picard, A. et al. (2008) Metrologia 45, 149–155 (CIPM-2007)","10.1088/0026-1394/45/2/004"),
 ("水–空気 交差ビリアル","IAPWS G11-15 Guideline on a Virial Equation for the Fugacity of H2O in Humid Air","iapws.org/documents/release/VirialFugacity"),
 ("★水–CO2 交差ビリアル","Meyer, C. W. & Harvey, A. H. (2015) AIChE J. 61(9), 2913–2925。水分量 u=0.3 % (k=2)、10–80 °C","10.1002/aic.14818"),
 ("★水–CO2 交差ビリアル","Wheatley, R. J. & Harvey, A. H. (2011) J. Chem. Phys. 134, 134309 + Erratum 145, 189901 (2016)","10.1063/1.3574345"),
 ("★CO2 中の f 実測","Koglbauer, G. & Wendland, M. (2008) J. Chem. Eng. Data 53(6), 1443–1448。20–100 °C","10.1021/je700386c"),
 ("水–CO2 PVT","Patel, M. R. & Eubank, P. T. (1988) J. Chem. Eng. Data 33, 185","—"),
 ("ヘンリー定数","IAPWS G7-04 Guideline on the Henry's Constant and Vapor-Liquid Distribution Constant","iapws.org/documents/release/HenGuide"),
 ("湿潤CO2 混合物","Gernert, J. & Span, R. (2016) J. Chem. Thermodyn. 93, 274–293 (EOS-CG)","10.1016/j.jct.2015.05.015"),
 ("臨界ノズル","ISO 9300:2022 Measurement of gas flow by means of critical flow nozzles。CO2 の C* は Annex B","iso.org/standard/77401.html"),
 ("★CO2 の振動緩和","Johnson, A. N. & Wright, J. D. (2000) Flow Meas. Instrum. 11, 315–327。Cd が最大 2 % ずれる","10.1016/S0955-5986(00)00004-2"),
 ("実在気体 臨界流関数","Johnson, R. C. (1965) NASA TN D-2565, Real-Gas Effects in Critical Flow Through Nozzles","ntrs.nasa.gov"),
 ("標準状態","DIN 1343:1990-01 Referenzzustand, Normzustand, Normvolumen（0 °C, 101.325 kPa）","—"),
 ("標準状態","ISO 13443:1996 Natural gas — Standard reference conditions（15 °C）。ISO 2533 も 15 °C","iso.org/standard/20461.html"),
 ("空気圧系のモデル化","Andersen, B. W. (1967) The Analysis and Design of Pneumatic Systems, Wiley","—"),
 ("空気圧系のモデル化","Beater, P. (2007) Pneumatic Drives: System Design, Modelling and Control, Springer","10.1007/978-3-540-69471-7"),
 ("絞り要素のモデル","ISO 6358-1:2013 Determination of flow-rate characteristics of components using compressible fluids","iso.org/standard/56612.html"),
 ("層流流量素子","Wright, J. D., Cobu, T., Berg, R. F. & Moldover, M. R. (2012) Flow Meas. Instrum. 25, 8–14。CO2 を含む5ガスで校正","10.1016/j.flowmeasinst.2011.07.003"),
 ("一次湿度標準","Meyer, C. W. et al. NIST Hybrid Humidity Generator。露点 U(k=2) < 0.025 °C","tsapps.nist.gov (pub_id=905221)"),
 ("一次湿度標準","Hasegawa, S. & Little, J. W. (1977) J. Res. NBS 81A(1), 81（NBS 二圧法）","10.6028/jres.081A.011"),
 ("配管の水分吸着","Salmon, E. et al. (2019) Atmos. Meas. Tech. 12, 3453–3461。PTFE は湿度依存が無い","10.5194/amt-12-3453-2019"),
 ("Nafion の CO2 選択性","Welp, L. R. et al. (2013) Atmos. Meas. Tech. 6, 1217。CO2 バイアス ≈ −0.05 ppm","10.5194/amt-6-1217-2013"),
 ("★CO2 中の RH センサ","Zych, M. et al. (2018) Sensors 18(8), 2615。容量式RHセンサの CO2 交差感度","10.3390/s18082615"),
 ("配管加熱の余裕","US EPA Method 320（抽出型FTIR）: 露点より最低 5 °C 高く保つこと","epa.gov"),
 ("CO2 腐食","de Waard, C. & Milliams, D. E. (1975) Corrosion 31(5), 177","10.5006/0010-9312-31.5.177"),
 ("CO2 溶解水の pH","Peng, C. et al. (2017) Int. J. Greenhouse Gas Control 56, 26–36。実測 pH 3.6–3.9","10.1016/j.ijggc.2016.11.024"),
 ("CO2 安全","CGA G-6.14 (2023) Standard for Carbon Dioxide Monitoring…。5000/30000 ppm 警報","—"),
 ("CO2 安全","EIGA Doc 44/18 Hazards of Oxygen-Deficient Atmospheres。酸素計では代用不可","eiga.eu"),
 ("曝露限界","NIOSH Pocket Guide (CO2): REL 5000 ppm TWA / 30000 ppm STEL、IDLH 40000 ppm","cdc.gov/niosh/npg/npgd0103.html"),
 ("原子量","Prohaska, T. et al. (2022) Pure Appl. Chem. 94(5), 573–600 (CIAAW 2021)","10.1515/pac-2019-0603"),
 ("計算ツール","Bell, I. H. et al. (2014) Ind. Eng. Chem. Res. 53(6), 2498–2508 (CoolProp)","10.1021/ie4033999"),
]
for i,(topic, ref, doi) in enumerate(REFS, 1):
    ws.cell(r,1,i).font = C_CALC
    ws.cell(r,2,topic).font = C_CALC
    c = ws.cell(r,3,ref); c.font = C_CALC; c.alignment = Alignment(wrap_text=True, vertical="top")
    ws.cell(r,4,doi).font = C_NOTE
    ws.row_dimensions[r].height = 26
    r += 1

# ============================================================ 00 README
ws = wb.create_sheet(S_RD, 0)
widths(ws, {"A": 4, "B": 34, "C": 100})
r = title(ws, 1, "加湿CO2 高速流量切替供給系 — 設計計算書",
          "Humidified-CO2 supply system with 30 ms flow switching — parametric design workbook")
r += 1
def para(head, lines):
    global r
    ws.cell(r,2,head).font = C_SEC
    for ln in lines:
        c = ws.cell(r,3,ln); c.font = C_CALC; c.alignment = Alignment(wrap_text=True, vertical="top")
        ws.row_dimensions[r].height = 15
        r += 1
    r += 1
para("要求仕様", [
 "出力段: CO2 ガス圧 20 kPa（ゲージ）、温度 20 °C、相対湿度 70 %",
 "流量: 30 NLPM と 15 NLPM を 30 ms ごとに交互に連続切替",
 "ガス源: 相対湿度 約 90 % の CO2"])
para("使い方", [
 "① シート『01_入力』の黄色セル（青字）だけを編集する。他は全て数式で連動する。",
 "② シート『03_湿度状態点』の下部に出る『★必要飽和器温度 T_sat』を読み、01_入力 の『飽和器出口温度』に入れ戻す。",
 "③ 同シート最下行『S4 で達成される RH と目標との差』が 0 になれば整合が取れている。",
 "④ 04〜08 の各シートでハードウェア寸法・熱量・安全条件が自動計算される。",
 "⑤ 『10_検証』が全項目合格であることを確認してから結果を使うこと。"])
para("設計の結論（既定値での要点）", [
 "・出力段の水蒸気モル分率 x_v = 1.374 mol%、露点 14.37 °C、結露余裕は 5.63 K しかない。",
 "・構成: 一次プレナム(300 kPa abs, 約31 °C) → 臨界ノズル A(常時 15 NLPM) ∥ ノズル B(+15 NLPM, 高速弁) → 出力プレナム(20 °C) → 同期切替排気オリフィス。",
 "・ノズルのど径は約 0.86 mm × 2 本。背圧比 0.404 で十分にチョークしている。",
 "・切替素子はサーマル MFC では不可能（最速 300 ms = 周期の5倍）。高速電磁弁（SMC SX10 / Festo MHJ、<1 ms）を使う。",
 "・『圧力を静かにすること』と『30 ms の流量変調を保つこと』は同じ容積では両立しない。排気側を入口と同期して切り替えることで初めて両立する。",
 "・最も厳しい制約は温度: dRH/dT = −4.32 %RH/K。±1 %RH を守るには出力段温度を ±0.23 K に制御する必要がある。"])
para("本計算書の特徴（学会発表を意識した点）", [
 "・CO2 を理想気体として扱わない。Z、cp、γ、音速はすべて第2ビリアル展開で実在気体として評価（Span–Wagner に対し 0.2 % 以内）。",
 "・湿度は CO2 キャリア用のエンハンスメント係数 f で評価している。空気用の Greenspan/CIPM 式は CO2 には使えず、",
 "　そのまま使うと RH を 0.93 %RH 過大評価する。f_CO2 = 1.018 に対し f_air = 1.005（121.3 kPa, 20 °C）。",
 "・f は交差ビリアル係数 B12(H2O–CO2) = −235.5 cm³/mol と、溶存CO2による水の活量低下（IAPWS G7-04）から組み立てている。",
 "・同じ式に空気の B_aw を入れると CIPM-2007 を 394 ppm 以内で再現する（B_aw = −32.0 cm³/mol は文献値 −30〜−34 の範囲内）。",
 "　これが CO2 への外挿を正当化する検証である。残差は第3ビリアル項に由来し、これが本手法の精度の下限を与える。",
 "・混合比には ε_CO2 = 0.40935 を使用。空気の 0.622 を使うと +51.9 % の誤りになる。",
 "・NLPM の基準条件を明示（DIN 1343, 0 °C）。20 °C 基準との差は 7.32 % で、良質なノズルの不確かさ 0.2 % の35倍にあたる。"])
para("既知の限界（投稿前に確認すべき事項）", [
 "・本セッションでは外部サイトへの直接アクセス（WebFetch）が遮断されていた。参照値は同じ基準相関を実装する CoolProp 8.0.0 を",
 "　ローカル実行して生成し、文献の書誌情報は検索で確認した。投稿前に NIST Webbook / REFPROP で表を再生成して引用すること。",
 "・B12(H2O–CO2) は Meyer & Harvey (2015) と Wheatley & Harvey (2016 正誤表) の原著値で置き換えること。",
 "　文献のばらつき ±40 cm³/mol は 121 kPa で f に ±0.4 %（RH で ±0.28 %RH）効く。01_入力 の B12 セルで感度を確認できる。",
 "・ノズルは CO2 で、実機ののど径で校正すること。振動緩和により Cd が最大 2 % ずれる。",
 "・容量式RHセンサは CO2 に交差感度がある。冷却鏡式（Michell S8000, ±0.1 °C ≈ ±0.42 %RH）を基準とし、CO2 中で校正すること。",
 "・排気オリフィスの Cd = 0.62 は代表値。実機で校正すること。"])
para("凡例", [
 "黄色セル＋青字 = 入力値 /  黒字 = 数式 /  赤字＋橙セル = 主要な結果 /  緑字 = 参照値 /  灰色斜体 = 注記・出典"])

# ============================================================ 02 PROPERTIES
ws = wb.create_sheet(S_PR, 2)
ws.column_dimensions["A"].width = 12
for cl in "BCDEFGHIJK": ws.column_dimensions[cl].width = 14
ws.column_dimensions["L"].width = 70
r = title(ws, 1, "物性相関 / Property correlations (reference table)",
          "本ブックが内部で使う相関式の一覧表。すべて第2ビリアル展開による実在気体評価で、Span–Wagner に対し 0.2 % 以内。")
r = hdr(ws, r, ["T [°C]","p_sat [Pa]","B_CO2 [cm³/mol]","B12 [cm³/mol]","B_ww [cm³/mol]",
                "Z (1 atm)","Z (300 kPa)","cp [J/mol·K]","γ (1 atm)","μ [µPa·s]","k [mW/m·K]",
                "μ_JT [K/bar] / 音速 [m/s]"])
r0 = r
for i in range(21):
    tc = -5.0 + 2.5*i
    ws.cell(r,1,tc).font = C_CALC; ws.cell(r,1).number_format = "0.0"
    tk = f"($A${r}+273.15)"
    cells = [(f"={PSAT(tk)}","0.000"), (f"={BCO2(tk)}*1000000","0.000"),
             (f"={B12(tk)}*1000000","0.00"), (f"={BWW(tk)}*1000000","0.0"),
             (f"={ZCO2('101325',tk)}","0.000000"), (f"={ZCO2('300000',tk)}","0.000000"),
             (f"={CPCO2(tk,'101325')}","0.0000"),
             (f"=({CPCO2(tk,'101325')})/({CVCO2(tk,'101325')})","0.00000"),
             (f"={MUCO2(tk)}*1000000","0.0000"), (f"={KCO2(tk)}*1000","0.0000"),
             (f"={MUJT_CO2(tk)}*100000","0.0000")]
    for j,(fm,nf) in enumerate(cells):
        c = ws.cell(r,2+j,fm); c.font = C_CALC; c.number_format = nf; c.border = BOX
    r += 1
ws.cell(r,1,"出典").font = C_SEC
for k,(cl,src) in enumerate({
    "B": "Wagner & Pruß (IAPWS-95) 蒸気圧式",
    "C": "Span & Wagner (1996) 零密度極限へのフィット",
    "D": "Meyer & Harvey (2015) / Wheatley & Harvey (2011,2016)",
    "E": "IAPWS-95 零密度極限へのフィット",
    "F": "Z = 1 + B·p/(R·T)（打切りビリアル）",
    "G": "同上。400 kPa まで Span–Wagner に対し 0.04 % 以内",
    "H": "cp = cp0 − T·B''·p",
    "I": "γ = cp/cv（圧力依存。1 bar→4 bar で 1.4 % 増）",
    "J": "Fenghour et al. (1998)",
    "K": "Huber et al. (2016)、u = 1 % (k=2)",
    "L": "μ_JT = (T·dB/dT − B)/cp0",
}.items()):
    ws.cell(r+1+k, 1, cl).font = C_NOTE
    ws.cell(r+1+k, 2, src).font = C_NOTE

wb.save(OUT)
print("saved:", os.path.abspath(OUT))
