"""
Generator for: exp-flight-control-system-dei/experiment/images/ziegler_nichols_tuning.png

Accuracy basis (theory.md Sections 5-6 + simulation/js/main.js Calc + db.json):
  Rate-loop plant = Type-0 chain of three first-order lags (theory.md S5):
        P(s) = 1 / [(tau_m s + 1)(tau_a s + 1)(tau_s s + 1)]
        tau_m = 0.05 s, tau_a = 0.02 s, tau_s = 0.005 s   (db.json freestyle_5in)
  Ultimate-cycle quantities (theory.md S5, main.js ultimateFreq/Period/Gain):
        wu = sqrt( (tm+ta+ts)/(tm*ta*ts) )            -> 122.47 rad/s
        Pu = 2*pi/wu                                  -> 0.05130 s
        Ku = [ (tm*ta+tm*ts+ta*ts)*(tm+ta+ts)/(tm*ta*ts) - 1 ] / K  -> 19.25
  Z-N tables (theory.md S5-S6, main.js znClassic / znTyreusLuyben):
        classic:        Kp=0.6 Ku,  Ti=0.5 Pu,   Td=0.125 Pu
        tyreus-luyben:  Kp=0.45 Ku, Ti=2.2 Pu,   Td=Pu/6.3
        with Ki = Kp/Ti, Kd = Kp*Td
        => classic  Kp=11.55, Ki=450.3, Kd=0.0741  (overshoot ~68%)
           tyreus   Kp=8.66,  Ki=76.75, Kd=0.0705  (overshoot ~15%)
  Closed-loop step responses are integrated EXACTLY as main.js
  Calc.rateStepResponse: PID with derivative-on-measurement + a 0.004 s
  derivative low-pass, forward-Euler on the three cascaded lags.

Run:  python ziegler_nichols_tuning.py
"""
import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

OUT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(OUT_DIR, "ziegler_nichols_tuning.png")

# ---- house palette ----
BG, ACCENT, DARK = "#ffffff", "#ffbf00", "#111827"
TXT2, TXT3, GRID = "#374151", "#6b7280", "#e5e7eb"
SURF = "#f9fafb"
SUCCESS, WARNING, DANGER, BLUE = "#10b981", "#f59e0b", "#ef4444", "#2563eb"

plt.rcParams.update({
    "figure.dpi": 150, "savefig.dpi": 150,
    "font.family": "sans-serif",
    "font.sans-serif": ["Inter", "Segoe UI", "DejaVu Sans", "Arial"],
    "font.size": 11, "text.color": DARK,
    "axes.facecolor": BG, "figure.facecolor": BG,
    "axes.edgecolor": TXT3, "axes.labelcolor": DARK,
    "xtick.color": TXT2, "ytick.color": TXT2,
})

# ---- rate-loop lags (db.json freestyle_5in) ----
tm, ta, ts = 0.05, 0.02, 0.005

# ---- ultimate-cycle quantities (mirror main.js Calc) ----
wu = np.sqrt((tm + ta + ts) / (tm * ta * ts))
Pu = 2.0 * np.pi / wu
Ku = ((tm * ta + tm * ts + ta * ts) * (tm + ta + ts) / (tm * ta * ts) - 1.0)


def zn_classic(Ku, Pu):
    Kp = 0.6 * Ku; Ti = 0.5 * Pu; Td = 0.125 * Pu
    return Kp, Kp / Ti, Kp * Td


def zn_tyreus(Ku, Pu):
    Kp = 0.45 * Ku; Ti = 2.2 * Pu; Td = Pu / 6.3
    return Kp, Kp / Ti, Kp * Td


Kp_c, Ki_c, Kd_c = zn_classic(Ku, Pu)
Kp_t, Ki_t, Kd_t = zn_tyreus(Ku, Pu)


def rate_step_response(Kp, Ki, Kd, dt=5e-5, T=0.5, ref=1.0, tauDf=0.004):
    """Mirror main.js Calc.rateStepResponse: PID (derivative-on-measurement
    + first-order derivative low-pass) integrated forward-Euler on the three
    cascaded lags 1/[(tm s+1)(ta s+1)(ts s+1)]."""
    n = int(round(T / dt))
    x1 = x2 = x3 = 0.0
    I = 0.0
    prevMeas = 0.0
    dFilt = 0.0
    peak = 0.0
    tpk = 0.0
    tarr = np.empty(n)
    ys = np.empty(n)
    for i in range(n):
        err = ref - x3
        I += err * dt
        dMeas = (x3 - prevMeas) / dt
        prevMeas = x3
        dFilt += dt * (dMeas - dFilt) / tauDf
        u = Kp * err + Ki * I - Kd * dFilt          # derivative on measurement
        x1 += dt * (u - x1) / tm
        x2 += dt * (x1 - x2) / ta
        x3 += dt * (x2 - x3) / ts
        if x3 > peak:
            peak = x3
            tpk = i * dt
        tarr[i] = i * dt
        ys[i] = x3
    osPct = (peak - ref) / ref * 100.0
    return tarr, ys, osPct, tpk, peak


t_c, y_c, os_c, tp_c, pk_c = rate_step_response(Kp_c, Ki_c, Kd_c)
t_t, y_t, os_t, tp_t, pk_t = rate_step_response(Kp_t, Ki_t, Kd_t)

# ---- LEFT panel: sustained marginal oscillation at the ultimate gain Ku ----
n_per = 6
t_osc = np.linspace(0.0, n_per * Pu, 2000)
y_osc = np.sin(wu * t_osc)            # constant-amplitude (marginal) oscillation

# ---- figure ----
fig, (axL, axR) = plt.subplots(1, 2, figsize=(14.6, 6.4))

# ============================ LEFT ============================
axL.axhline(0, color=TXT3, lw=1.0, ls="--", zorder=1)
axL.plot(t_osc * 1000, y_osc, color=DANGER, lw=2.6, zorder=4,
         label=r"rate output at $K_p=K_u$")
axL.axhline(1.0, color=TXT3, lw=0.9, ls=":", zorder=2)
axL.axhline(-1.0, color=TXT3, lw=0.9, ls=":", zorder=2)
axL.text(n_per * Pu * 1000, 1.02, "constant amplitude", ha="right", va="bottom",
         fontsize=8.6, color=TXT3)

# mark one period Pu between two successive peaks (peaks at wu*t = pi/2 + 2*pi*k)
pk1 = (np.pi / 2) / wu
pk2 = pk1 + Pu
axL.annotate("", xy=(pk2 * 1000, 1.14), xytext=(pk1 * 1000, 1.14),
             arrowprops=dict(arrowstyle="<->", color=DARK, lw=1.8))
axL.text((pk1 + pk2) / 2 * 1000, 1.20,
         rf"$P_u={Pu*1000:.2f}$ ms", ha="center", va="bottom",
         fontsize=11, fontweight="bold", color=DARK)
for pk in (pk1, pk2):
    axL.plot([pk * 1000, pk * 1000], [1.0, 1.13], color=DARK, lw=1.0, ls=":")

axL.text(0.04, 0.06,
         rf"$K_u={Ku:.2f}$" "\n"
         rf"$\omega_u=\sqrt{{(\tau_m+\tau_a+\tau_s)/(\tau_m\tau_a\tau_s)}}={wu:.1f}$ rad/s",
         transform=axL.transAxes, ha="left", va="bottom", fontsize=10.5,
         fontweight="bold", color=DANGER,
         bbox=dict(boxstyle="round,pad=0.5", fc="#fff5f5", ec=DANGER, lw=1.4))

axL.set_title("Sustained Oscillation at the Ultimate Gain $K_u$",
              fontsize=12.5, fontweight="bold")
axL.set_xlabel("Time (ms)")
axL.set_ylabel("Rate output (normalized)")
axL.set_xlim(0, n_per * Pu * 1000)
axL.set_ylim(-1.5, 1.5)
axL.grid(True, alpha=0.3)
axL.legend(loc="lower right", fontsize=9.5)

# ============================ RIGHT ============================
axR.axhline(1.0, color=TXT3, lw=1.4, ls="--", zorder=2)
axR.text(0.498, 1.01, "setpoint = 1.0", ha="right", va="bottom", fontsize=9,
         color=TXT2)
axR.axhline(1.25, color=WARNING, lw=1.0, ls=":", zorder=1)
axR.text(0.498, 1.255, "25% comfort limit", ha="right", va="bottom",
         fontsize=8.4, color="#b45309")

axR.plot(t_c, y_c, color=DANGER, lw=2.6, zorder=5,
         label=f"Classic Z-N  ($K_p$={Kp_c:.2f}, $K_i$={Ki_c:.0f}, "
               f"$K_d$={Kd_c:.4f})")
axR.plot(t_t, y_t, color=SUCCESS, lw=2.6, zorder=5,
         label=f"Tyreus-Luyben  ($K_p$={Kp_t:.2f}, $K_i$={Ki_t:.1f}, "
               f"$K_d$={Kd_t:.4f})")

# overshoot peak markers + labels
axR.plot([tp_c], [pk_c], "o", ms=8, mfc=DANGER, mec="#7f1d1d", mew=1.3, zorder=7)
axR.annotate(rf"overshoot $\approx{os_c:.0f}\%$", xy=(tp_c, pk_c),
             xytext=(tp_c + 0.05, pk_c + 0.02), fontsize=10.5,
             fontweight="bold", color=DANGER,
             arrowprops=dict(arrowstyle="->", color=DANGER, lw=1.5))
axR.plot([tp_t], [pk_t], "o", ms=8, mfc=SUCCESS, mec="#065f46", mew=1.3, zorder=7)
axR.annotate(rf"overshoot $\approx{os_t:.0f}\%$", xy=(tp_t, pk_t),
             xytext=(tp_t + 0.06, pk_t + 0.06), fontsize=10.5,
             fontweight="bold", color="#0b7a52",
             arrowprops=dict(arrowstyle="->", color=SUCCESS, lw=1.5))

axR.set_title("Closed-Loop Rate Step: Classic vs Tyreus-Luyben",
              fontsize=12.5, fontweight="bold")
axR.set_xlabel("Time (s)")
axR.set_ylabel("Rate (normalized)")
axR.set_xlim(0, 0.5)
axR.set_ylim(0, max(pk_c * 1.12, 1.8))
axR.grid(True, alpha=0.3)
axR.legend(loc="upper right", fontsize=9.2, framealpha=0.95)
axR.text(0.02, 0.04,
         r"$P(s)=\dfrac{1}{(\tau_m s+1)(\tau_a s+1)(\tau_s s+1)}$"
         "\n"
         r"PID: derivative-on-measurement, $\tau_{df}=0.004$ s",
         transform=axR.transAxes, ha="left", va="bottom", fontsize=9.2,
         bbox=dict(boxstyle="round,pad=0.45", fc=SURF, ec=GRID, lw=1.2))

fig.suptitle("Ziegler-Nichols Auto-Tuning of the Inner Rate Loop "
             f"($\\tau_m$={tm}s, $\\tau_a$={ta}s, $\\tau_s$={ts}s)",
             fontsize=14, fontweight="bold")
fig.tight_layout(rect=[0, 0, 1, 0.96])
fig.savefig(OUT, dpi=150, bbox_inches="tight", facecolor=BG)
print("WROTE", OUT)
print(f"  wu = {wu:.3f} rad/s, Pu = {Pu*1000:.3f} ms, Ku = {Ku:.3f}")
print(f"  classic : Kp={Kp_c:.3f}, Ki={Ki_c:.2f}, Kd={Kd_c:.5f}  -> overshoot {os_c:.1f}%")
print(f"  tyreus  : Kp={Kp_t:.3f}, Ki={Ki_t:.2f}, Kd={Kd_t:.5f}  -> overshoot {os_t:.1f}%")

# verification against documented values (theory.md / db.json)
assert abs(Ku - 19.25) < 0.01, "Ku off target"
assert abs(Pu - 0.051302) < 1e-4, "Pu off target"
assert abs(Kp_c - 11.55) < 0.02 and abs(Ki_c - 450.3) < 1.0 and abs(Kd_c - 0.0741) < 0.001
assert abs(Kp_t - 8.66) < 0.02 and abs(Ki_t - 76.75) < 0.5 and abs(Kd_t - 0.0705) < 0.001
assert 60 < os_c < 75, "classic overshoot out of expected ~68% range"
assert 10 < os_t < 20, "tyreus overshoot out of expected ~15% range"
print("  GAINS + OVERSHOOTS VERIFIED against theory.md / db.json.")
