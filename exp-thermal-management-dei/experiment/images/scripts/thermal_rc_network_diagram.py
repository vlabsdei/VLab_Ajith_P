#!/usr/bin/env python3
"""
Generates thermal_rc_network_diagram.png for the thermal-management experiment
(exp-thermal-management-dei), referenced from theory.md Section 1 ("Lumped-
Capacitance Thermal Model & the Two-Node RC Analogy").

Draws the two-node thermal RC network the simulator actually solves (see
simulation/js/main.js: twoNodeSteady / twoNodeTau / thermalCalc):

  P_heat (I^2*R_m(T), heat-flux source at the winding) -> C_w (fast winding
  node) -> R_wh (winding-to-housing conduction, fixed 5 C/W) -> C_h (slow
  housing node) -> R_th_eff (housing-to-ambient convection, airflow-
  dependent) -> T_ambient (ground reference).

All annotated numbers are computed here from the same constants and formulas
as main.js, for the Module 1 worked-example build used throughout theory.md:
  Motor:    2310, 2400 KV, 33 g, R_m,20C = 0.06 ohm
  Propeller: 3" tri-blade
  ESC:      Cyclone 35A (Rds_on = 0.0028 ohm, R_th,ESC = 18 C/W)
  Battery:  4S 1500 mAh
run at full throttle (duty = 1.0), T_ambient = 25 C, static hover, no
cooling-airflow slider, no drag-dropped cooling parts.

Reference constants (from main.js):
  MOTOR_MASS_REF_G = 39      R_th,cw base    = 8 * (39 / mass_g)   [C/W]
  Cp,copper = 385 J/(kg.K)   C_th,jc base    = (mass_g/1000) * 385 [J/C]
  THERM_C_CAL = 0.845        C_th,total      = C_th,jc * 0.845
  THERM_CW_FRAC = 0.30       C_w = 0.30*C_th,total, C_h = 0.70*C_th,total
  R_wh = 5 C/W (fixed winding->housing hotspot resistance)
  ALPHA_CU = 0.00393 /C (copper resistance temperature coefficient)
"""

import math
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, Circle, Rectangle

# ---------------------------------------------------------------------------
# 1. Recompute the worked-example numbers directly from main.js's formulas.
# ---------------------------------------------------------------------------
ALPHA_CU = 0.00393
T_AMB = 25.0
MOTOR_MASS_REF_G = 39.0
THERM_CW_FRAC = 0.30
THERM_C_CAL = 0.845
R_WH = 5.0

mass_g = 33.0                 # 2310 motor
rm20 = 0.06                   # ohm
r_th_cw_base = 8.0 * (MOTOR_MASS_REF_G / mass_g)
c_th_jc_base = (mass_g / 1000.0) * 385.0
c_th_total = c_th_jc_base * THERM_C_CAL
Cw = THERM_CW_FRAC * c_th_total
Ch = (1 - THERM_CW_FRAC) * c_th_total

# static hover, no cooling airflow -> frac = 0.03 (see coolingRth in main.js)
r_th_eff = r_th_cw_base * (1 - 0.03)

I = 7.532                     # A, full-throttle current (from thermalCalc)
Twind_est = 85.70             # C, converged winding temp (from thermalCalc)
Rm_hot = rm20 * (1 + ALPHA_CU * (Twind_est - 20))
P_heat = I * I * Rm_hot

Tss = T_AMB + P_heat * r_th_eff
Twind = Tss + P_heat * R_WH

r_th_esc = 18.0                # Cyclone 35A catalog r_th_c_per_w
rds_on = 0.0028
Tesc = T_AMB + I * I * rds_on * r_th_esc

print("r_th_eff=%.3f C/W  C_w=%.3f J/C  C_h=%.3f J/C  P_heat=%.3f W" % (r_th_eff, Cw, Ch, P_heat))
print("T_ss(case)=%.2f C  T_wind=%.2f C  T_esc=%.2f C" % (Tss, Twind, Tesc))

# ---------------------------------------------------------------------------
# 2. Draw the two-node RC network.
# ---------------------------------------------------------------------------
FS_LABEL = 12.5
FS_ANNOT = 10.5
FS_TITLE = 15
WIRE = "#2b2b2b"
ACCENT_W = "#c0392b"    # winding node (hot)
ACCENT_H = "#c65d3b"    # housing node (warm)
GND_COLOR = "#1a5276"

fig, ax = plt.subplots(figsize=(13.5, 6.6))
ax.set_xlim(0, 13)
ax.set_ylim(0, 9)
ax.axis("off")
ax.set_title("Two-Node Thermal RC Network — Motor Winding → Housing → Ambient",
              fontsize=FS_TITLE, fontweight="bold", pad=16)

y_top = 6.4
y_bot = 2.2
x_src = 1.3
x_cw = 3.4
x_rwh_l = 4.6
x_rwh_r = 6.4
x_ch = 7.6
x_rth_l = 8.8
x_rth_r = 10.6
x_gnd = 11.7

# top rail
ax.plot([x_src, x_gnd], [y_top, y_top], color=WIRE, lw=2, zorder=1)
# bottom rail (ambient reference)
ax.plot([x_src, x_gnd], [y_bot, y_bot], color=GND_COLOR, lw=2.2, zorder=1)

# --- current source P_heat (I^2 Rm) ---
src_r = 0.55
src_cy = (y_top + y_bot) / 2.0
ax.plot([x_src, x_src], [y_bot, src_cy - src_r], color=WIRE, lw=2)
ax.plot([x_src, x_src], [src_cy + src_r, y_top], color=WIRE, lw=2)
circ = Circle((x_src, src_cy), src_r, facecolor="white", edgecolor=ACCENT_W, lw=2.4, zorder=3)
ax.add_patch(circ)
arr = FancyArrowPatch((x_src, src_cy - src_r + 0.1), (x_src, src_cy + src_r - 0.1),
                       arrowstyle="-|>", mutation_scale=15, color=ACCENT_W, lw=2, zorder=4)
ax.add_patch(arr)
ax.text(x_src, y_bot - 0.55, "$P_{heat}=I^2R_m(T_w)$\n≈ %.2f W" % P_heat,
        ha="center", va="top", fontsize=FS_LABEL - 1, color=ACCENT_W, fontweight="bold")

# --- C_w: winding node (fast) ---
cap_gap = 0.15
plate_w = 0.7
ax.plot([x_cw, x_cw], [y_bot, src_cy - cap_gap], color=WIRE, lw=2)
ax.plot([x_cw, x_cw], [src_cy + cap_gap, y_top], color=WIRE, lw=2)
ax.plot([x_cw - plate_w / 2, x_cw + plate_w / 2], [src_cy - cap_gap, src_cy - cap_gap], color=WIRE, lw=3)
ax.plot([x_cw - plate_w / 2, x_cw + plate_w / 2], [src_cy + cap_gap, src_cy + cap_gap], color=WIRE, lw=3)
ax.text(x_cw, y_top + 0.3, "node $T_w$\n(winding)", ha="center", va="bottom",
        fontsize=FS_ANNOT - 0.5, style="italic", color="#555555")
ax.text(x_cw, y_bot - 0.55, "$C_w = 0.30\\,C_{th}$\n≈ %.2f J/°C" % Cw,
        ha="center", va="top", fontsize=FS_LABEL - 1, fontweight="bold")

# --- R_wh: winding -> housing conduction ---
res_h = 0.55
ax.plot([x_cw, x_rwh_l], [y_top, y_top], color=WIRE, lw=2)
rect1 = Rectangle((x_rwh_l, y_top - res_h / 2), x_rwh_r - x_rwh_l, res_h,
                   facecolor="white", edgecolor=WIRE, lw=2, zorder=3)
ax.add_patch(rect1)
ax.text((x_rwh_l + x_rwh_r) / 2, y_top, "$R_{wh}$", ha="center", va="center",
        fontsize=FS_LABEL, fontweight="bold")
ax.text((x_rwh_l + x_rwh_r) / 2, y_top + res_h / 2 + 0.3, "5.0 °C/W (fixed)",
        ha="center", va="bottom", fontsize=FS_ANNOT, color="#333333")
ax.plot([x_rwh_r, x_ch], [y_top, y_top], color=WIRE, lw=2)

# --- C_h: housing node (slow) ---
ax.plot([x_ch, x_ch], [y_bot, src_cy - cap_gap], color=WIRE, lw=2)
ax.plot([x_ch, x_ch], [src_cy + cap_gap, y_top], color=WIRE, lw=2)
ax.plot([x_ch - plate_w / 2, x_ch + plate_w / 2], [src_cy - cap_gap, src_cy - cap_gap], color=WIRE, lw=3)
ax.plot([x_ch - plate_w / 2, x_ch + plate_w / 2], [src_cy + cap_gap, src_cy + cap_gap], color=WIRE, lw=3)
ax.text(x_ch, y_top + 0.3, "node $T_h$\n(housing / case\nsensor reading)", ha="center", va="bottom",
        fontsize=FS_ANNOT - 0.5, style="italic", color="#555555")
ax.text(x_ch, y_bot - 0.55, "$C_h = 0.70\\,C_{th}$\n≈ %.2f J/°C" % Ch,
        ha="center", va="top", fontsize=FS_LABEL - 1, fontweight="bold")

# --- R_th_eff: housing -> ambient convection (airflow-reduced) ---
ax.plot([x_ch, x_rth_l], [y_top, y_top], color=WIRE, lw=2)
rect2 = Rectangle((x_rth_l, y_top - res_h / 2), x_rth_r - x_rth_l, res_h,
                   facecolor="white", edgecolor=ACCENT_H, lw=2.2, zorder=3)
ax.add_patch(rect2)
ax.text((x_rth_l + x_rth_r) / 2, y_top, "$R_{th,eff}$", ha="center", va="center",
        fontsize=FS_LABEL, fontweight="bold", color=ACCENT_H)
ax.text((x_rth_l + x_rth_r) / 2, y_top + res_h / 2 + 0.3, "≈ %.2f °C/W\n(static, no airflow)" % r_th_eff,
        ha="center", va="bottom", fontsize=FS_ANNOT, color="#333333")
ax.plot([x_rth_r, x_gnd], [y_top, y_top], color=WIRE, lw=2)

# ground symbol
gx, gy = x_gnd, y_top
ax.plot([gx, gx], [y_top, y_bot], color=WIRE, lw=2)
for i, w in enumerate([0.5, 0.32, 0.16]):
    yy = y_bot - 0.22 - 0.18 * i
    ax.plot([gx - w / 2, gx + w / 2], [yy, yy], color=GND_COLOR, lw=2.2)
ax.text(gx, y_bot - 1.0, "$T_{ambient}$\n(25 °C)", ha="center", va="top",
        fontsize=FS_LABEL, color=GND_COLOR, fontweight="bold")

# node dots
for (xx, yy) in [(x_src, y_top), (x_cw, y_top), (x_ch, y_top), (x_gnd, y_top),
                  (x_src, y_bot), (x_gnd, y_bot)]:
    ax.add_patch(Circle((xx, yy), 0.05, facecolor=WIRE, edgecolor=WIRE, zorder=5))

# governing equations + worked numbers box
eqn = (r"$\dfrac{dT_w}{dt}=\dfrac{P_{heat}-(T_w-T_h)/R_{wh}}{C_w}\ \ ,\ \ "
       r"\dfrac{dT_h}{dt}=\dfrac{(T_w-T_h)/R_{wh}-(T_h-T_{amb})/R_{th,eff}}{C_h}$")
ax.text(6.5, 0.9, eqn, ha="center", va="center", fontsize=FS_LABEL,
        bbox=dict(boxstyle="round,pad=0.4", facecolor="#f7f7f7", edgecolor=ACCENT_W, lw=1.3))

lines = [
    "Worked example — 2310 motor + 3\" tri prop + Cyclone 35A ESC + 4S 1500 mAh, full throttle, static, no cooling parts:",
    "I ≈ %.2f A    R_m(T_w) ≈ %.4f Ω    P_heat = I²R_m ≈ %.2f W" % (I, Rm_hot, P_heat),
    "T_h (case, steady state) = T_amb + P_heat·R_th,eff = 25 + %.2f×%.2f ≈ %.1f °C" % (P_heat, r_th_eff, Tss),
    "T_w (winding hotspot) = T_h + P_heat·R_wh = %.1f + %.2f×5 ≈ %.1f °C" % (Tss, P_heat, Twind),
    "ESC (independent path): T_esc = T_amb + I²·R_ds,on·R_th,ESC = 25 + %.2f²×0.0028×18 ≈ %.1f °C" % (I, Tesc),
]
ax.text(0.01, -0.14, "\n".join(lines), transform=ax.transAxes, ha="left", va="top",
        fontsize=FS_ANNOT, family="monospace",
        bbox=dict(boxstyle="round,pad=0.5", facecolor="#fffdf5", edgecolor="#8b9a95", lw=1.2))

fig.tight_layout(rect=[0, 0.12, 1, 1])

out_path = "/Users/ajith/Desktop/vlgen/exp-thermal-management-dei/experiment/images/thermal_rc_network_diagram.png"
fig.savefig(out_path, dpi=150, bbox_inches="tight")
print("Saved:", out_path)
