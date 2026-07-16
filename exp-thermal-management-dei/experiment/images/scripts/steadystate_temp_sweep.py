#!/usr/bin/env python3
"""
Generates steadystate_temp_sweep.png for the thermal-management experiment,
referenced from theory.md Section 2 ("Steady-State Temperature Rise") and
procedure.md Stage 1.

Case and winding steady temperatures vs motor current for the reference
bench build (2310 2400KV, 33 g, R_m,20C=0.060 ohm; static hover, no cooling),
solved with the same temperature-dependent copper resistance as main.js:
  R_m(T) = R_m20*(1+alpha*(T-20)),  P = I^2*R_m,
  T_case = T_amb + P*R_th_eff,  T_wind = T_case + P*R_wh.
Full-throttle point lands at I=7.53 A -> case 64.3 C / winding 85.7 C.
"""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

BG, INK, INK2, MUTED, GRID = "#ffffff", "#1e2a29", "#3c4a46", "#8b9a95", "#dde4e1"
TEAL, AMBER, DANGER, SLATE = "#1f3a93", "#c65d3b", "#a83232", "#4f6d9e"
plt.rcParams.update({
    "figure.dpi": 150, "savefig.dpi": 150, "font.family": "sans-serif",
    "font.sans-serif": ["Segoe UI", "DejaVu Sans", "Arial"], "font.size": 11,
    "text.color": INK, "axes.facecolor": BG, "figure.facecolor": BG,
    "axes.edgecolor": MUTED, "axes.labelcolor": INK, "xtick.color": INK2, "ytick.color": INK2,
})

ALPHA_CU, T_AMB, R_WH = 0.00393, 25.0, 5.0
rm20 = 0.06
r_th_eff = 8.0 * (39.0 / 33.0) * (1 - 0.03)   # 9.171 C/W
I_REF = 7.532
TW_BURNOUT, ESC_LIMIT = 240.0, 80.0


def temps(I):
    Tw = T_AMB + 20
    for _ in range(60):
        Rm = rm20 * (1 + ALPHA_CU * (min(Tw, TW_BURNOUT) - 20))
        P = I * I * Rm
        Tcase = T_AMB + P * r_th_eff
        Tw = Tcase + P * R_WH
    return Tcase, Tw, P


I = np.linspace(0, 10, 300)
Tc = np.array([temps(i)[0] for i in I])
Tw = np.array([temps(i)[1] for i in I])
tc_ref, tw_ref, p_ref = temps(I_REF)
print(f"ref I={I_REF} A -> P={p_ref:.3f} W, case={tc_ref:.2f} C, wind={tw_ref:.2f} C")

fig, ax = plt.subplots(figsize=(10.4, 6.6))
ax.plot(I, Tw, color=DANGER, lw=3.0, label="winding hotspot  $T_{wind}$", zorder=5)
ax.plot(I, Tc, color=TEAL, lw=3.0, label="case (sensor)  $T_{case}$", zorder=5)
ax.fill_between(I, Tc, Tw, color=DANGER, alpha=0.08, zorder=2)

ax.axhline(T_AMB, color=MUTED, lw=1.0, ls="--")
ax.text(0.1, T_AMB + 1.5, "ambient 25 °C", fontsize=9, color=INK2)

# full-throttle operating point
ax.plot([I_REF, I_REF], [0, tw_ref], color=MUTED, lw=1.0, ls=":", zorder=3)
for y, lbl, col in [(tc_ref, f"case {tc_ref:.1f} °C", TEAL), (tw_ref, f"winding {tw_ref:.1f} °C", DANGER)]:
    ax.plot([I_REF], [y], "o", ms=10, mfc=col, mec="white", mew=1.4, zorder=8)
    ax.annotate(lbl, xy=(I_REF, y), xytext=(I_REF - 4.2, y + 4),
                fontsize=10.5, fontweight="bold", color=col)
ax.text(I_REF, 6, "full\nthrottle", ha="center", va="bottom", fontsize=9, color=INK2)

ax.set_title("Steady-State Temperature Rise vs Motor Current\n"
             "(reference bench build: 2310 / 3″ tri-blade, static hover, no cooling)",
             fontsize=13, fontweight="bold", pad=12)
ax.set_xlabel("Motor current  I  (A)")
ax.set_ylabel("Steady temperature (°C)")
ax.set_xlim(0, 10)
ax.set_ylim(0, max(Tw) * 1.12)
ax.grid(True, alpha=0.35, color=GRID)
ax.legend(loc="upper left", fontsize=10.6, framealpha=0.95)
ax.text(0.985, 0.03,
        r"$T_{case}=T_{amb}+I^2R_m(T)\,R_{th,eff}$" "\n"
        r"rise $\propto I^2$  (square law)",
        transform=ax.transAxes, ha="right", va="bottom", fontsize=9.4,
        bbox=dict(boxstyle="round,pad=0.5", fc="#fbfaf5", ec=AMBER, lw=1.2))

fig.tight_layout()
out = "/Users/ajith/Desktop/vlgen/exp-thermal-management-dei/experiment/images/steadystate_temp_sweep.png"
fig.savefig(out, dpi=150, bbox_inches="tight", facecolor=BG)
print("Saved:", out)
