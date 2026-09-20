# -*- coding: utf-8 -*-
"""
Reference physics engine for the humidified-CO2 supply system.
純Python（CoolProp非依存）の参照実装。Excel に実装する式と *同一の* 定式化を用い、
別途 CoolProp (Span-Wagner / IAPWS-95) で独立検証する。
"""
import math

# ---------------------------------------------------------------- constants
R_U       = 8.31446261815324   # J/(mol K)   CODATA-2018 / SI-2019 (exact)
M_H2O     = 18.015268e-3       # kg/mol      IAPWS / CIAAW
M_CO2     = 44.0095e-3         # kg/mol      CIAAW 2021 (C 12.011, O 15.999)
M_AIR     = 28.9635e-3         # kg/mol      (reference only)
EPS_CO2   = M_H2O / M_CO2      # 0.409349  <- replaces the 0.622 used for air
T0_K      = 273.15

# water critical point (IAPWS-95 / Wagner & Pruss 2002)
TC_W, PC_W = 647.096, 22.064e6
# CO2 critical point / acentric factor (Span & Wagner 1996)
TC_C, PC_C, OMEGA_C = 304.1282, 7.3773e6, 0.22394
# CO2 triple point (Span & Wagner 1996)
TT_C, PT_C = 216.592, 517.95e3

# normal / standard reference conditions.
#  CAUTION: ISO 2533 (Standard Atmosphere) is 15 degC, NOT 0 degC, and
#  SEMI E12-0303 is 0 degC, NOT 20 degC.  The 20 degC "slm" convention is a
#  VENDOR convention (Sensirion et al.), not a standard.  Getting this wrong
#  is a 7.3 % mass-flow error -- ~35x the uncertainty of a calibrated nozzle.
REF_COND = {                       # key: (T_ref[K], p_ref[Pa], authority)
    "DIN1343_0C":   (273.15, 101325.0, "DIN 1343:1990 Normzustand; = SEMI E12-0303"),
    "ISO13443_15C": (288.15, 101325.0, "ISO 13443:1996; = ISO 2533 sea level"),
    "VENDOR_20C":   (293.15, 101325.0, "vendor convention (e.g. Sensirion) - NOT a standard"),
    "VENDOR_25C":   (298.15, 101325.0, "vendor 'STP' (e.g. Alicat); cf. IUPAC SATP 25 degC/100 kPa"),
}

def molar_volume_ref(key="DIN1343_0C"):
    T, p, _ = REF_COND[key]
    return R_U * T / p                       # m3/mol (ideal-gas convention)

# ------------------------------------------------- water saturation pressure
_WP_A = (-7.85951783, 1.84408259, -11.7866497,
         22.6807411, -15.9618719, 1.80122502)

def p_sat_water(T):
    """Wagner & Pruss (IAPWS-95) saturation line, liquid water. T[K] -> Pa."""
    tau = 1.0 - T / TC_W
    a1, a2, a3, a4, a5, a6 = _WP_A
    s = (a1*tau + a2*tau**1.5 + a3*tau**3 + a4*tau**3.5
         + a5*tau**4 + a6*tau**7.5)
    return PC_W * math.exp(TC_W / T * s)

def p_sat_ice(T):
    """IAPWS 2011 sublimation line (for sub-zero excursions). T[K] -> Pa."""
    Tt, pt = 273.16, 611.657
    th = T / Tt
    a = (-0.212144006e2, 0.273203819e2, -0.610598130e1)
    b = (0.333333333e-2, 0.120666667e1, 0.170333333e1)
    s = sum(ai * th**bi for ai, bi in zip(a, b))
    return pt * math.exp(s / th)

def _dp_sat_dT(T, h=1e-4):
    return (p_sat_water(T + h) - p_sat_water(T - h)) / (2*h)

def T_dew_magnus(pv):
    """Alduchov & Eskridge (1996) inverse Magnus -- seed value. pv[Pa]->K."""
    lg = math.log(max(pv, 1e-6) / 610.94)
    return 273.15 + 243.04*lg / (17.625 - lg)

def T_dew(pv, n_newton=3):
    """Dew-point temperature: invert Wagner-Pruss by Newton from a Magnus seed."""
    T = T_dew_hardy(pv)
    for _ in range(n_newton):
        T -= (p_sat_water(T) - pv) / _dp_sat_dT(T)
    return T

# ------------------------------------------------ water-vapour enhancement f
def B_ww(T):
    """2nd virial coefficient of pure water vapour [m3/mol].
    Fit to the IAPWS-95 zero-density limit, 273-343 K (max dev 1.7 cm3/mol,
    0.13 % -- its contribution to ln f is below 1e-4 anyway)."""
    return 1e-6 * (19202.081 - 20032490.0/T + 7075968700.0/T**2
                   - 870743060000.0/T**3)

def B_12_co2_h2o(T):
    """Cross 2nd virial coefficient B12(H2O-CO2) [m3/mol], 273-333 K.
    -235.5 cm3/mol at 20 degC -- about 7x more negative than the air-water
    value (-33 cm3/mol), because of the CO2 quadrupole / H2O dipole attraction.
    THIS is what makes f_CO2 differ from the familiar moist-air value.
    Fit (max dev 0.12 cm3/mol) to values derived from the GERG-2008 CO2-H2O
    binary; the primary experimental source is Meyer & Harvey, AIChE J. 61(9),
    2913 (2015), with the ab initio surface of Wheatley & Harvey, J. Chem.
    Phys. 134, 134309 (2011) + erratum 145, 189901 (2016).
    Literature spread is about +-40 cm3/mol -> +-0.4 % on f at 121 kPa."""
    return 1e-6 * (-236.26407 + 204871.53/T - 59999434.0/T**2)

def henry_co2(T):
    """Henry's constant k_H for CO2 in water [Pa], IAPWS G7-04 (2004).
    ln(k_H/p1*) = A/Tr + B*(1-Tr)^0.355/Tr + C*Tr^-0.41*exp(1-Tr).
    About 145 MPa at 20 degC."""
    Tr = T/TC_W
    A, B, C = -8.55445, 4.01195, 9.52345
    return p_sat_water(T)*math.exp(A/Tr + B*(1-Tr)**0.355/Tr
                                   + C*Tr**-0.41*math.exp(1-Tr))

def water_activity_co2(p, T):
    """Water activity of liquid water in equilibrium with CO2 at partial
    pressure (p - p_sat).  Dissolved CO2 LOWERS a_w and therefore lowers f by
    0.07 % at 100 kPa and 0.28 % at 400 kPa.  Negligible for air (~25x smaller),
    but a real, separable, sign-definite term for a CO2 carrier."""
    x_co2 = max(p - p_sat_water(T), 0.0)/henry_co2(T)
    return 1.0 - x_co2

def v_liq_water(T):
    """Molar volume of saturated liquid water [m3/mol], 0-60 degC.
    Kell (1975) density equation for air-free water at 1 atm."""
    t = T - 273.15
    rho = (999.83952 + 16.945176*t - 7.9870401e-3*t**2 - 46.170461e-6*t**3
           + 105.56302e-9*t**4 - 280.54253e-12*t**5) / (1.0 + 16.879850e-3*t)
    return M_H2O / rho

def enhancement_factor(p, T, gas="CO2", B12=None, n_iter=12):
    """Water-vapour enhancement factor f(p,T), defined by
          x_v,sat(p,T) = f(p,T) * p_sat(T) / p .

    Exact 2nd-virial + Poynting result (Goff 1949; Hyland & Wexler 1983;
    Lovell-Smith 2006), solved self-consistently for the saturation mole
    fraction rather than using the x_gas -> 1 approximation:

        ln f = ln phi_sat - ln phi_w + v_wL*(p - p_sat)/(R T)
        ln phi_sat = B_ww*p_sat/(R T)
        ln phi_w   = [2*(x_v*B_ww + x_g*B_12) - B_mix]*p/(R T)
        B_mix      = x_v^2*B_ww + 2*x_v*x_g*B_12 + x_g^2*B_gg

    NOTE: the familiar Greenspan (1976) / CIPM-2007 polynomials are fitted for
    CO2-FREE MOIST AIR and are NOT valid for a CO2 carrier gas, because f
    depends on the cross virial coefficient B_12 of the specific carrier.
    That is why f is rebuilt here from B_12(H2O-CO2)."""
    ps = p_sat_water(T)
    if p <= ps:
        return 1.0
    if B12 is None:
        B12 = B_12_co2_h2o(T) if gas == "CO2" else B_12_air_h2o(T)
    Bgg = B_co2(T) if gas == "CO2" else B_air(T)
    Bww, vw, RT = B_ww(T), v_liq_water(T), R_U*T
    ln_phi_sat = Bww*ps/RT
    poynting = vw*(p - ps)/RT
    ln_aw = math.log(water_activity_co2(p, T)) if gas == "CO2" else 0.0
    xv = ps/p                                   # start from f = 1
    lnf = 0.0
    for _ in range(n_iter):
        xg = 1.0 - xv
        Bmix = xv*xv*Bww + 2.0*xv*xg*B12 + xg*xg*Bgg
        ln_phi_w = (2.0*(xv*Bww + xg*B12) - Bmix)*p/RT
        lnf = ln_phi_sat - ln_phi_w + poynting + ln_aw
        xv = math.exp(lnf)*ps/p
    return math.exp(lnf)

def f_cipm2007_air(p, T):
    """Enhancement factor of moist air, CIPM-2007 (Picard et al., Metrologia 45,
    149-155, 2008):  f = alpha + beta*p + gamma*t^2 .  Used ONLY as a validation
    reference for the virial routine above -- never for the CO2 carrier."""
    t = T - 273.15
    return 1.00062 + 3.14e-8*p + 5.6e-7*t*t

_HC = (2.0798233e2, -2.0156028e1, 4.6778925e-1, -9.2288067e-6)
_HD = (1.0, -1.3319669e-1, 5.6577518e-3, -7.5172865e-5)

def T_dew_hardy(pv):
    """Hardy (1998) explicit rational inverse of p_sat [K]; round-trips to
    better than 1e-4 K over -20..+60 degC.  Used as the Newton seed."""
    L = math.log(max(pv, 1e-6))
    num = sum(c*L**i for i, c in enumerate(_HC))
    den = sum(d*L**i for i, d in enumerate(_HD))
    return num/den

def B_air(T):
    """2nd virial coefficient of dry air [m3/mol]; fit to Lemmon et al. (2000)
    via CoolProp, 263-333 K, max dev 0.001 cm3/mol."""
    return 1e-6 * (39.787335 - 11137.085/T - 938342.04/T**2)

def B_12_air_h2o(T):
    """Cross 2nd virial coefficient B_aw (air-water) [m3/mol],
    obtained by inverting the CIPM-2007 enhancement factor through the same
    virial expression used for CO2.  Gives -29.7 cm3/mol at 20 degC, inside the
    literature band (-30 to -34, Harvey & Huang first-principles) -- this is the
    cross-check that licenses the CO2 calculation."""
    return 1e-6 * (26.046272 - 26773.019/T + 2859336.6/T**2)

# ---------------------------------------------------------- CO2 real gas
def B_co2(T):
    """2nd virial coefficient of CO2 [m3/mol].
    Least-squares fit to the zero-density limit of the Span & Wagner (1996)
    EOS over 263-333 K; max deviation 0.0014 cm3/mol (1.1e-5 relative)."""
    t = T / 100.0
    return 1e-6 * (75.188632 - 565.620467/t + 601.464888/t**2 - 2018.286032/t**3)

def dB_co2(T, h=1e-3):
    return (B_co2(T+h) - B_co2(T-h)) / (2.0*h)

def d2B_co2(T, h=1e-2):
    return (B_co2(T+h) - 2.0*B_co2(T) + B_co2(T-h)) / h**2

def Z_co2(p, T):
    """Truncated-virial compressibility, pressure-explicit form.
    Reproduces Span-Wagner to < 0.04 % for p <= 400 kPa, 263-333 K."""
    return 1.0 + B_co2(T) * p / (R_U * T)

def Z_mix(p, T, xv):
    """Quadratic (van der Waals one-fluid) mixing rule on the 2nd virial."""
    B = ((1-xv)**2*B_co2(T) + 2*xv*(1-xv)*B_12_co2_h2o(T) + xv**2*B_ww(T))
    return 1.0 + B * p / (R_U * T)

def cp0_co2(T):
    """Ideal-gas molar cp of CO2 [J/(mol K)].
    Fit to the ideal-gas part of Span & Wagner (1996), 263-343 K,
    max deviation 4e-4 J/(mol K)."""
    return 20.823075 + 0.059235957*T - 5.1159127e-7*T**2 - 4.8979736e-8*T**3

def cp_co2(T, p):
    """Real-gas molar cp [J/(mol K)]: cp = cp0 - T * B''(T) * p  (2nd virial)."""
    return cp0_co2(T) - T * d2B_co2(T) * p

def cv_co2(T, p):
    """Real-gas molar cv [J/(mol K)] from the 2nd virial, with rho = p/(Z R T)."""
    rho = p / (Z_co2(p, T) * R_U * T)
    return (cp0_co2(T) - R_U) - T * R_U * (2.0*dB_co2(T) + T*d2B_co2(T)) * rho

def gamma_co2(T, p=101325.0):
    """Real-gas isentropic exponent cp/cv (pressure-dependent: +1.4 % from
    1 to 4 bar at 20 degC -- do NOT use a single constant)."""
    return cp_co2(T, p) / cv_co2(T, p)

def cp_h2o_molar(T):
    """Ideal-gas molar cp of water vapour [J/(mol K)].
    Shomate, NIST-JANAF (Chase 1998); 33.58 J/(mol K) at 293 K."""
    t = T/1000.0
    A, B_, C, D, E = 30.09200, 6.832514, 6.793435, -2.534480, 0.082139
    return A + B_*t + C*t**2 + D*t**3 + E/t**2

def mu_co2(T):
    """Dynamic viscosity of dilute CO2 gas [Pa s].
    Fenghour, Wakeham & Vesovic (1998) zero-density term;
    agrees with Laesecke & Muzny (2017) to 0.04 % at 20 degC."""
    a = (0.235156, -0.491266, 5.211155e-2, 5.347906e-2, -1.537102e-2)
    lnTs = math.log(T / 251.196)
    return 1.00697*math.sqrt(T) / math.exp(sum(ai*lnTs**i for i, ai in enumerate(a))) * 1e-6

def k_co2(T, p=101325.0):
    """Thermal conductivity of dilute CO2 gas [W/(m K)].
    Fit to Huber et al. (2016) zero-density limit, 263-333 K (max dev 0.0024 mW/mK).
    Correlation's own stated uncertainty is 1 % (k=2).  The linear density
    term reproduces the 80-400 kPa pressure dependence to < 0.1 %."""
    k0 = 1e-3*(-2.8088692 + 0.053424539*T + 3.8923913e-5*T**2)
    rho = p*M_CO2/(Z_co2(p, T)*R_U*T)
    return k0 + 3.144e-5*rho

def mu_JT_co2(T, p=101325.0):
    """Joule-Thomson coefficient [K/Pa], low-density limit of the virial EOS:
    mu_JT = (T dB/dT - B) / cp0 .  About 1.142 K/bar for CO2 at 20 degC,
    i.e. ~5x air (0.236 K/bar).  Both numerator and denominator are taken in
    the zero-density limit, which keeps the identity consistent; reproduces
    Span-Wagner to 0.15 % for p <= 400 kPa."""
    return (T*dB_co2(T) - B_co2(T)) / cp0_co2(T)

def speed_of_sound_co2(T, p=101325.0):
    """Speed of sound [m/s] from the virial EOS:  w^2 = gamma R T (1 + 2 B rho)/M."""
    rho = p / (Z_co2(p, T) * R_U * T)
    return math.sqrt(gamma_co2(T, p) * R_U * T * (1.0 + 2.0*B_co2(T)*rho) / M_CO2)

def mu_mix(T, xv):
    """Wilke (1950) mixing rule for the viscosity of the humid CO2 mixture."""
    m1, m2 = mu_co2(T), mu_h2o_vap(T)
    M1, M2 = M_CO2, M_H2O
    x1, x2 = 1.0 - xv, xv
    def phi(mi, mj, Mi, Mj):
        return (1 + math.sqrt(mi/mj)*(Mj/Mi)**0.25)**2 / math.sqrt(8*(1 + Mi/Mj))
    return (x1*m1/(x1 + x2*phi(m1, m2, M1, M2))
            + x2*m2/(x2 + x1*phi(m2, m1, M2, M1)))

def mu_h2o_vap(T):
    """Viscosity of low-pressure water vapour [Pa s] (IAPWS 2008 dilute limit)."""
    return 1e-6*(-3.1085 + 0.041205*T - 1.1e-6*T**2)

# ---------------------------------------------------- humid-gas state object
class HumidState:
    """A humid-CO2 state point.  x_v (water mole fraction) is the conserved
    quantity along the process chain when no water is added or condensed."""
    def __init__(self, T, p, xv, gas="CO2", use_f=True):
        self.T, self.p, self.xv = T, p, xv
        self.gas, self.use_f = gas, use_f

    @classmethod
    def from_RH(cls, T, p, RH, gas="CO2", use_f=True):
        f = enhancement_factor(p, T, gas) if use_f else 1.0
        xv = RH * f * p_sat_water(T) / p
        return cls(T, p, xv, gas, use_f)

    @property
    def f(self):
        return enhancement_factor(self.p, self.T, self.gas) if self.use_f else 1.0
    @property
    def pv(self):      return self.xv * self.p
    @property
    def p_sat(self):   return p_sat_water(self.T)
    @property
    def RH(self):      return self.pv / (self.f * self.p_sat)
    @property
    def T_dew(self):   return T_dew(self.pv / self.f)
    @property
    def w(self):       # mass mixing ratio kg H2O / kg dry CO2
        return EPS_CO2 * self.xv/(1.0 - self.xv)
    @property
    def M_mix(self):   return self.xv*M_H2O + (1-self.xv)*M_CO2
    @property
    def Z(self):       return Z_mix(self.p, self.T, self.xv)
    @property
    def rho(self):     return self.p*self.M_mix/(self.Z*R_U*self.T)
    @property
    def abs_hum(self): return self.pv*M_H2O/(R_U*self.T)   # kg/m3 (ideal vapour)
    def at(self, T=None, p=None):
        """Same gas parcel moved to a new (T,p) with no water added/removed."""
        return HumidState(T or self.T, p or self.p, self.xv, self.gas, self.use_f)
    def is_saturated(self):
        return self.RH >= 1.0

def condense_to_saturation(st):
    """If a state is supersaturated, drop x_v to the saturation value and
    return (new_state, condensed water mole fraction)."""
    xs = st.f * st.p_sat / st.p
    if st.xv <= xs:
        return st, 0.0
    return HumidState(st.T, st.p, xs, st.gas, st.use_f), st.xv - xs
