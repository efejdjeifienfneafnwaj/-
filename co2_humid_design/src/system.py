# -*- coding: utf-8 -*-
"""System-level model of the humidified-CO2 supply / fast-flow-switching rig."""
import math
from physics import *

# ----------------------------------------------------------------- flow units
def nlpm_to_mol_s(q_nlpm, ref="DIN1343_0C"):
    """Normal volume flow -> molar flow.  By the DIN 1343 convention
    the 'normal volume' is defined through the IDEAL gas law, so it is a pure
    proxy for amount of substance: n_dot = q / V_m,ref with V_m,ref = R T_ref/p_ref."""
    return q_nlpm * 1e-3 / 60.0 / molar_volume_ref(ref)

def mol_s_to_nlpm(n_dot, ref="DIN1343_0C"):
    return n_dot * molar_volume_ref(ref) * 60.0 * 1e3

def actual_volume_flow(n_dot, st):
    """m3/s at the real (T, p, Z) of the state."""
    return n_dot * st.Z * R_U * st.T / st.p

# ------------------------------------------------- humidity-chain requirements
def required_saturator_T(xv_target, p_sat_line, eta_sat=0.90, gas="CO2"):
    """Saturator temperature giving the target water mole fraction at the
    saturator's own line pressure, for a saturator of efficiency eta_sat
    (eta_sat = RH at the saturator outlet)."""
    ps_needed = xv_target * p_sat_line / eta_sat
    T = T_dew(ps_needed)                       # first guess, f = 1
    for _ in range(12):                        # fixed point on f(p,T)
        f = enhancement_factor(p_sat_line, T, gas)
        T = T_dew(ps_needed / f)
    return T

def required_chiller_T(xv_target, p_chill, gas="CO2"):
    """Dew-point (condensation) control: gas leaves the chiller saturated."""
    return required_saturator_T(xv_target, p_chill, eta_sat=1.0, gas=gas)

def required_wet_fraction(xv_target, st_wet):
    """Two-flow (wet/dry blending): fraction of the total molar flow that must
    pass through the saturator, the rest bypassing it dry."""
    return xv_target / st_wet.xv if st_wet.xv > 0 else float("nan")

# ---------------------------------------------------------- expansion / heating
def jt_expansion(st, p2):
    """Isenthalpic throttle from st.p to p2 using the local mu_JT (K/Pa).
    Uses the average of the end-point coefficients (2-point trapezoid)."""
    mu1 = mu_JT_co2(st.T, st.p)
    T2 = st.T + mu1 * (p2 - st.p)
    for _ in range(4):
        mu = 0.5*(mu_JT_co2(st.T, st.p) + mu_JT_co2(T2, p2))
        T2 = st.T + mu * (p2 - st.p)
    return HumidState(T2, p2, st.xv, st.gas, st.use_f)

def sensible_power(n_dot, st, T_from, T_to):
    """Heater duty [W] to move the humid stream from T_from to T_to at st.p."""
    Tm = 0.5*(T_from + T_to)
    cp = (1-st.xv)*cp_co2(Tm, st.p) + st.xv*cp_h2o_molar(Tm)
    return n_dot * cp * (T_to - T_from)

def h_vap_water(T):
    """Enthalpy of vaporisation of water [J/kg]. Watson-type fit to IAPWS-95,
    273-373 K; 2453.5 kJ/kg at 20 degC."""
    tr = 1.0 - T/TC_W
    return 2.5009e6 * (tr/ (1.0 - 273.15/TC_W))**0.354 * 1.0 if False else \
           1e3*(2500.93 - 2.3666*(T-273.15) - 1.6e-3*(T-273.15)**2)

def humidification_load(n_dot, st_target, st_source):
    """Water that must be evaporated: (kg/s, g/h, latent W)."""
    dn_w = n_dot * max(st_target.xv - st_source.xv, 0.0)
    m_dot = dn_w * M_H2O
    return m_dot, m_dot*3.6e6, m_dot*h_vap_water(st_target.T)

# ---------------------------------------------- ISO 9300 critical-flow nozzle
def critical_flow_function_ideal(gamma):
    """C* for a perfect gas (ISO 9300:2022, 5.2)."""
    return math.sqrt(gamma * (2.0/(gamma+1.0))**((gamma+1.0)/(gamma-1.0)))

def critical_pressure_ratio(gamma):
    """p*/p0 at the throat; choking requires p_back/p0 below this for a plain
    orifice.  A toroidal-throat CFVN with its diffuser recovers to ~0.85."""
    return (2.0/(gamma+1.0))**(gamma/(gamma-1.0))

def cd_iso9300_toroidal(Re):
    """Discharge coefficient, toroidal-throat CFVN, ISO 9300:2022 Eq. (7);
    valid 2.1e4 <= Re <= 1e7, u(Cd) = 0.22 %."""
    return 0.9959 - 2.720*Re**-0.5

def nozzle_throat_diameter(n_dot, st0, Cd=None, n_iter=25):
    """Throat diameter [m] of an ISO 9300 CFVN passing n_dot [mol/s] from the
    stagnation state st0.  q_m = Cd * A * C_R * p0 / sqrt(R_s T0), with the
    real-gas correction C_R = C*/sqrt(Z0) (leading-order stagnation-density term)."""
    M = st0.M_mix
    Rs = R_U / M
    g = gamma_mix(st0)
    Cstar = critical_flow_function_ideal(g) / math.sqrt(st0.Z)
    q_m = n_dot * M
    cd = Cd if Cd else 0.99
    d = 1e-3
    for _ in range(n_iter):
        A = q_m * math.sqrt(Rs*st0.T) / (cd * Cstar * st0.p)
        d = math.sqrt(4.0*A/math.pi)
        if Cd is None:
            Re = 4.0*q_m/(math.pi*d*mu_mix(st0.T, st0.xv))
            cd = cd_iso9300_toroidal(Re)
    Re = 4.0*q_m/(math.pi*d*mu_mix(st0.T, st0.xv))
    return d, cd, Re, Cstar, g

def gamma_mix(st):
    """Mixture isentropic exponent, mole-fraction weighted cp/cv."""
    cp = (1-st.xv)*cp_co2(st.T, st.p) + st.xv*cp_h2o_molar(st.T)
    cv = (1-st.xv)*cv_co2(st.T, st.p) + st.xv*(cp_h2o_molar(st.T) - R_U)
    return cp/cv

def nozzle_flow(d, st0, Cd=None):
    """Forward calculation: molar flow through a CFVN of throat diameter d."""
    M, Rs = st0.M_mix, R_U/st0.M_mix
    Cstar = critical_flow_function_ideal(gamma_mix(st0)) / math.sqrt(st0.Z)
    A = math.pi*d*d/4.0
    cd = Cd if Cd else 0.99
    for _ in range(20):
        q_m = cd * A * Cstar * st0.p / math.sqrt(Rs*st0.T)
        if Cd is None:
            cd = cd_iso9300_toroidal(4.0*q_m/(math.pi*d*mu_mix(st0.T, st0.xv)))
    return q_m / M

# ------------------------------------------------------ pneumatic plenum / ripple
def pneumatic_capacitance(V, T, n_poly=1.0):
    """Molar pneumatic capacitance C = dn/dp = V/(n R T)  [mol/Pa].
    n_poly = 1 isothermal (slow, high wall-area), n_poly = gamma adiabatic
    (fast, small-amplitude ripple)."""
    return V / (n_poly * R_U * T)

def ripple_peak_to_peak(dn_dot, t_period, duty, V, T, n_poly=1.0):
    """Peak-to-peak pressure ripple in a plenum of volume V when the demand is a
    square wave of amplitude dn_dot [mol/s] at duty 'duty' and period t_period,
    and the upstream source supplies only the cycle-mean flow (worst case:
    regulator bandwidth far below the switching frequency).
        dn_stored = duty*(1-duty)*dn_dot*t_period ;  dp = dn_stored / C ."""
    dn = duty*(1.0-duty)*dn_dot*t_period
    return dn / pneumatic_capacitance(V, T, n_poly)

def volume_for_ripple(dn_dot, t_period, duty, dp_target, T, n_poly=1.0):
    return duty*(1.0-duty)*dn_dot*t_period*n_poly*R_U*T/dp_target

def regulator_attenuation(f_sw, f_bw):
    """First-order disturbance rejection of a pressure regulator of closed-loop
    bandwidth f_bw against a disturbance at f_sw: |S| = 1/sqrt(1+(f_bw/f_sw)^2)."""
    return 1.0/math.sqrt(1.0 + (f_bw/f_sw)**2)

def plenum_time_constant(V, T, n_dot0, dp0, n_poly=1.0):
    """RC time constant of a plenum discharging through a fixed restriction that
    passes n_dot0 at pressure drop dp0 (square-root law -> R = 2 dp0/n_dot0)."""
    return pneumatic_capacitance(V, T, n_poly) * 2.0*dp0/n_dot0

# ----------------------------------------------------------------- piping
def pipe_hydraulics(n_dot, st, d_i, L):
    """Velocity, Re, Darcy friction factor, pressure drop, transport and
    acoustic delays in a smooth tube."""
    A = math.pi*d_i**2/4.0
    Q = actual_volume_flow(n_dot, st)
    v = Q/A
    rho = st.rho
    mu = mu_mix(st.T, st.xv)
    Re = rho*v*d_i/mu
    if Re < 2300:
        f = 64.0/max(Re, 1e-9)
    else:
        f = 0.3164*Re**-0.25                     # Blasius, 4e3 < Re < 1e5
    dp = f*(L/d_i)*0.5*rho*v*v
    c = speed_of_sound_co2(st.T, st.p)
    return dict(v=v, Re=Re, f=f, dp=dp, rho=rho, c=c,
                t_transport=L/v, t_acoustic=L/c, f_quarter_wave=c/(4.0*L))

# ----------------------------------------------------------------- sensitivity
def dRH_dT(st):
    """d(RH)/dT at constant x_v and p  [1/K].  RH = x_v p /(f p_sat(T))."""
    h = 1e-3
    return (st.at(T=st.T+h).RH - st.at(T=st.T-h).RH)/(2*h)

def dRH_dp(st):
    h = 1.0
    return (st.at(p=st.p+h).RH - st.at(p=st.p-h).RH)/(2*h)

def dRH_dTsat(st, p_sat_line, eta_sat=0.90):
    """Sensitivity of the delivered RH to the saturator temperature."""
    h = 1e-3
    def rh(Ts):
        xv = eta_sat*enhancement_factor(p_sat_line, Ts, st.gas)*p_sat_water(Ts)/p_sat_line
        return HumidState(st.T, st.p, xv, st.gas, st.use_f).RH
    return (rh(st.T_dew+h) - rh(st.T_dew-h))/(2*h) if False else \
           (rh(required_saturator_T(st.xv, p_sat_line, eta_sat)+h)
            - rh(required_saturator_T(st.xv, p_sat_line, eta_sat)-h))/(2*h)

# ----------------------------------------------------------------- ventilation
def ventilation_requirement(n_dot, limit_ppm=5000.0, ambient_ppm=420.0):
    """Fresh-air flow [m3/s at 20 degC, 1 atm] to hold a room below limit_ppm
    for a continuous CO2 release of n_dot [mol/s] (steady, well-mixed)."""
    v_air = R_U*293.15/101325.0                       # m3/mol of air
    return n_dot*v_air/((limit_ppm - ambient_ppm)*1e-6)


# ------------------------------------------- sub-sonic exhaust / metering orifice
def orifice_mass_flow(d, st1, p2, Cd=0.62):
    """Compressible flow through a thin-plate / sharp-edged orifice, both
    sub-critical and choked (ISO 6358 / standard compressible-orifice equation).
    Returns mass flow [kg/s]."""
    g = gamma_mix(st1)
    Rs = R_U/st1.M_mix
    A = math.pi*d*d/4.0
    r = max(p2/st1.p, critical_pressure_ratio(g))    # clip at choking
    psi = math.sqrt(max(r**(2.0/g) - r**((g+1.0)/g), 0.0))
    return Cd*A*st1.p*math.sqrt(2.0*g/((g-1.0)*Rs*st1.T))*psi/math.sqrt(st1.Z)

def orifice_diameter_for_flow(n_dot, st1, p2, Cd=0.62):
    """Invert the orifice equation for the diameter passing n_dot [mol/s]."""
    q_target = n_dot*st1.M_mix
    d = 1e-3
    for _ in range(60):
        q = orifice_mass_flow(d, st1, p2, Cd)
        d *= math.sqrt(q_target/q) if q > 0 else 2.0
    return d

def orifice_pressure_for_flow(n_dot, d, T, xv, p2, Cd=0.62, p_hi=1.0e6):
    """Upstream pressure needed to pass n_dot through a fixed orifice d (bisection)."""
    q_t = n_dot*(xv*M_H2O + (1-xv)*M_CO2)
    lo, hi = p2*1.0000001, p_hi
    for _ in range(200):
        mid = 0.5*(lo+hi)
        q = orifice_mass_flow(d, HumidState(T, mid, xv), p2, Cd)
        if q < q_t: lo = mid
        else:       hi = mid
    return 0.5*(lo+hi)

# ------------------------------------------------------- synchronised switching
def ripple_from_timing_skew(dn_dot, dt_skew, V, T, n_poly=1.0):
    """Residual plenum pressure excursion when the inlet and the synchronised
    outlet valve do not switch at exactly the same instant.
    This is the ripple that REMAINS after synchronised exhaust switching, and it
    replaces the (much larger) accumulation ripple of an unsynchronised design."""
    return dn_dot*abs(dt_skew)*n_poly*R_U*T/V

# ------------------------------------------------------------------- acoustics
def helmholtz_frequency(V, d_neck, L_neck, c, flanged_ends=1):
    """Helmholtz resonance of a plenum V with a neck (d_neck, L_neck) [Hz].
    End correction 0.85*(d/2) per flanged end (Rayleigh)."""
    A = math.pi*d_neck**2/4.0
    L_eff = L_neck + flanged_ends*0.85*(d_neck/2.0)
    return c/(2.0*math.pi)*math.sqrt(A/(V*L_eff))

def lumped_length_limit(c, t_rise, factor=10.0):
    """Maximum tube length for which a lumped (RC) model is defensible,
    judged on the switching EDGE rather than on the fundamental: L < c*t_r/10."""
    return c*t_rise/factor

def frozen_speed_of_sound_co2(T):
    """High-frequency ('frozen' vibration) sound speed in CO2: gamma -> 7/5,
    because the vibrational modes cannot follow.  About 4 % above the
    equilibrium value -- the same relaxation physics that perturbs C_d.
    Johnson & Wright, Flow Meas. Instrum. 11 (2000) 315-327."""
    return math.sqrt(1.4*R_U*T/M_CO2)

def swept_volume_per_half_cycle(n_dot, st, t_half):
    """Actual gas volume delivered in one half cycle -- every mL of dead volume
    downstream of the switching valve costs a fraction of this in edge smearing."""
    return actual_volume_flow(n_dot, st)*t_half
