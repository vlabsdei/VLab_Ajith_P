#!/usr/bin/env python3
"""
Generates cooling_rth_reduction.png for the thermal-management experiment,
referenced from theory.md Section 5 ("Cooling: Rotor-Wash, Forced Convection
& Cooling Parts") and procedure.md Stage 4.

Shows how the effective thermal resistance R_th_eff (and the steady case
temperature it drives) falls with cooling airflow and bolt-on parts, using
the same reductions as main.js (coolingRth + COOLING_PART_FRAC):
  hover   airflow: 3% -> 10%      forward airflow: 15% -> 25%
  heatsink -30%,  fan -20%,  pad -15%  (multiplicative)
Baseline reference build: R_th_eff = 9.171 C/W, P_cu = 4.283 W.
"""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

BG, INK, INK2, MUTED, GRID = "#ffffff", "#1e2a29", "#3c4a46", "#8b9a95", "#dde4e1"
TEAL, AMBER, DANGER, GREEN, SLATE = "#1f3a93", "#c65d3b", "#a83232", "#2e7d5b", "#4f6d9e"
plt.rcParams.update({
    "figure.dpi": 150, "savefig.dpi": 150, "font.family": "sans-serif",
    "font.sans-serif": ["Segoe UI", "DejaVu Sans", "Arial"], "font.size": 11,
    "text.color": INK, "axes.facecolor": BG, "figure.facecolor": BG,
    "axes.edgecolor": MUTED, "axes.labelcolor": INK, "xtick.color": INK2, "ytick.color": INK2,
})

T_AMB, P_CU, R_BASE = 25.0, 4.283, 9.171


def case_temp(rth):
    return T_AMB + P_CU * rth


# scenarios: (label, R_th_eff, color)
scen = [
    ("baseline\nstill air", R_BASE, MUTED),
    ("hover +\nairflow (−10%)", R_BASE * 0.90, SLATE),
    ("forward +\nairflow (−25%)", R_BASE * 0.75, TEAL),
    ("forward +\n+ heatsink", R_BASE * 0.75 * 0.70, GREEN),
    ("forward +\nsink+fan+pad", R_BASE * 0.75 * 0.70 * 0.80 * 0.85, DANGER),
]
labels = [s[0] for s in scen]
rths = [s[1] for s in scen]
cols = [s[2] for s in scen]
temps = [case_temp(r) for r in rths]
for lbl, r, tC in zip(labels, rths, temps):
    print(f"{lbl.replace(chr(10),' '):30s} R_th={r:5.2f} C/W  case={tC:5.1f} C")

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12.6, 6.3))
x = np.arange(len(scen))

# left: R_th bars
b1 = ax1.bar(x, rths, color=cols, edgecolor="white", width=0.7, zorder=3)
for b, r in zip(b1, rths):
    ax1.text(b.get_x() + b.get_width() / 2, r + 0.12, f"{r:.2f}", ha="center",
             va="bottom", fontsize=10, fontweight="bold", color=INK)
ax1.set_ylabel("Effective thermal resistance  $R_{th,eff}$  (°C/W)")
ax1.set_title("Cooling lowers $R_{th,eff}$", fontsize=12.5, fontweight="bold", pad=10)
ax1.set_xticks(x); ax1.set_xticklabels(labels, fontsize=8.8)
ax1.set_ylim(0, R_BASE * 1.18)
ax1.grid(True, axis="y", alpha=0.35, color=GRID)

# right: resulting case temperature
b2 = ax2.bar(x, temps, color=cols, edgecolor="white", width=0.7, zorder=3)
for b, tC in zip(b2, temps):
    ax2.text(b.get_x() + b.get_width() / 2, tC + 0.7, f"{tC:.1f}", ha="center",
             va="bottom", fontsize=10, fontweight="bold", color=INK)
ax2.axhline(T_AMB, color=MUTED, lw=1.0, ls="--")
ax2.text(0.05, T_AMB + 1.0, "ambient 25 °C", fontsize=9, color=INK2)
ax2.set_ylabel("Steady case temperature (°C)")
ax2.set_title("...which lowers steady temperature", fontsize=12.5, fontweight="bold", pad=10)
ax2.set_xticks(x); ax2.set_xticklabels(labels, fontsize=8.8)
ax2.set_ylim(0, max(temps) * 1.15)
ax2.grid(True, axis="y", alpha=0.35, color=GRID)

fig.suptitle("Rotor-Wash & Cooling-Part Reduction of Thermal Resistance\n"
             "(reference bench build, $P_{cu}$ = 4.28 W held fixed)",
             fontsize=13.5, fontweight="bold", y=1.0)
fig.tight_layout(rect=[0, 0, 1, 0.95])
out = "/Users/ajith/Desktop/vlgen/exp-thermal-management-dei/experiment/images/cooling_rth_reduction.png"
fig.savefig(out, dpi=150, bbox_inches="tight", facecolor=BG)
print("Saved:", out)
