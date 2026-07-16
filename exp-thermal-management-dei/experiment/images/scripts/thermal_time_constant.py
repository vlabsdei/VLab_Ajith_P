#!/usr/bin/env python3
"""
Generates thermal_time_constant.png for the thermal-management experiment,
referenced from theory.md Section 3 ("The Thermal Time Constant") and
procedure.md Stage 2.

Integrates the two-node case-temperature heating curve (main.js twoNodeTau /
twoNodeSteady) for the reference bench build and marks the 63.2%-of-rise
crossing that defines tau. Reference build: Cw=3.221, Ch=7.515 J/C,
R_wh=5, R_th_eff=9.171 C/W, steady case 64.3 C -> tau ~ 114 s.
"""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

BG, INK, INK2, MUTED, GRID = "#ffffff", "#1e2a29", "#3c4a46", "#8b9a95", "#dde4e1"
TEAL, AMBER, DANGER, GREEN = "#1f3a93", "#c65d3b", "#a83232", "#2e7d5b"
plt.rcParams.update({
    "figure.dpi": 150, "savefig.dpi": 150, "font.family": "sans-serif",
    "font.sans-serif": ["Segoe UI", "DejaVu Sans", "Arial"], "font.size": 11,
    "text.color": INK, "axes.facecolor": BG, "figure.facecolor": BG,
    "axes.edgecolor": MUTED, "axes.labelcolor": INK, "xtick.color": INK2, "ytick.color": INK2,
})

T_AMB = 25.0
Cw, Ch, Rwh, Reff = 3.221, 7.515, 5.0, 9.171
P_HEAT = 4.283
Tss_case = T_AMB + P_HEAT * Reff   # 64.28 C
rise = Tss_case - T_AMB

# integrate two-node ODE at actual heat P_HEAT (winding node source)
dt, tmax = 0.25, 700.0
ts, Tc_curve = [], []
Twn, Thn = T_AMB, T_AMB
t = 0.0
while t <= tmax:
    ts.append(t); Tc_curve.append(Thn)
    dTw = (P_HEAT - (Twn - Thn) / Rwh) / Cw
    dTh = ((Twn - Thn) / Rwh - (Thn - T_AMB) / Reff) / Ch
    Twn += dTw * dt; Thn += dTh * dt
    t += dt
ts, Tc_curve = np.array(ts), np.array(Tc_curve)

target = T_AMB + 0.632 * rise
tau = ts[np.argmax(Tc_curve >= target)]
print(f"Tss_case={Tss_case:.2f} C, target(63.2%)={target:.2f} C, tau={tau:.1f} s")

fig, ax = plt.subplots(figsize=(10.4, 6.6))
ax.plot(ts, Tc_curve, color=AMBER, lw=3.2, zorder=5, label="case temperature  $T_{case}(t)$")
ax.axhline(Tss_case, color=TEAL, lw=1.6, ls="--", zorder=3)
ax.text(tmax * 0.6, Tss_case + 0.8, f"steady state  {Tss_case:.1f} °C", fontsize=10, color=TEAL)
ax.axhline(T_AMB, color=MUTED, lw=1.0, ls="--")
ax.text(8, T_AMB + 0.8, "ambient 25 °C", fontsize=9, color=INK2)

# 63.2% crossing = tau
ax.axhline(target, color=DANGER, lw=1.0, ls=":", zorder=3)
ax.plot([tau, tau], [T_AMB, target], color=DANGER, lw=1.2, ls=":", zorder=3)
ax.plot([tau], [target], "o", ms=12, mfc=DANGER, mec="white", mew=1.5, zorder=8)
ax.annotate(rf"$\tau \approx {tau:.0f}$ s" "\n" r"(63.2% of rise)",
            xy=(tau, target), xytext=(tau + 55, target - 9),
            fontsize=11.5, fontweight="bold", color=DANGER,
            arrowprops=dict(arrowstyle="->", color=DANGER, lw=1.6))

# 3tau, 5tau guides
for k, frac, lbl in [(3, 0.95, "3τ · 95%"), (5, 0.993, "5τ · settled")]:
    xk = k * tau
    if xk <= tmax:
        yk = T_AMB + frac * rise
        ax.plot([xk], [yk], "s", ms=7, mfc=GREEN, mec="white", mew=1.0, zorder=7)
        ax.text(xk, yk - 3.4, lbl, fontsize=8.6, color=GREEN, ha="center")

ax.set_title("Motor Heating Curve & the Thermal Time Constant\n"
             "(reference bench build: 2310 motor, full throttle from ambient)",
             fontsize=13, fontweight="bold", pad=12)
ax.set_xlabel("Time  t  (s)")
ax.set_ylabel("Case temperature (°C)")
ax.set_xlim(0, tmax)
ax.set_ylim(20, Tss_case + 8)
ax.grid(True, alpha=0.35, color=GRID)
ax.legend(loc="lower right", fontsize=10.6, framealpha=0.95)
ax.text(0.015, 0.965,
        r"$T(t)=T_{amb}+P R_{th}(1-e^{-t/\tau})$,  $\tau=R_{th}C_{th}$",
        transform=ax.transAxes, ha="left", va="top", fontsize=9.6,
        bbox=dict(boxstyle="round,pad=0.5", fc="#fbfaf5", ec=AMBER, lw=1.2))

fig.tight_layout()
out = "/Users/ajith/Desktop/vlgen/exp-thermal-management-dei/experiment/images/thermal_time_constant.png"
fig.savefig(out, dpi=150, bbox_inches="tight", facecolor=BG)
print("Saved:", out)
