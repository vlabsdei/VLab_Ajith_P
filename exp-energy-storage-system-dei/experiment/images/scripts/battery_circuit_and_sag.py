#!/usr/bin/env python3
"""
Generates battery_circuit_and_sag.png for the energy-storage experiment,
referenced from theory.md Sections 1-2 ("Pack Voltage, C-Rating & the
Continuous Discharge Limit" and "Internal Resistance & Voltage Sag Under
Load").

Left panel: the pack's equivalent circuit (open-circuit source V_oc in
series with the lumped internal resistance R_pack), annotated with the
default-build worked-example numbers at full throttle (1806 motor + 5"
tri-blade prop + 4S 3300 mAh pack).

Right panel: the real nonlinear terminal-voltage-vs-current sag curve
(sagCalc's throttle sweep, main.js ~402-415) for two packs — the default
4S 3300 mAh (15C continuous) and the undersized 4S 1300 mAh low-C pack
(12C continuous, 24 m-ohm/cell) — against the 3.30 V/cell brownout trip
and 3.50 V/cell pass floor used by the "Voltage Sag Under Load" bench test
(main.js simStep, metric === "sag", ~2358-2391).

All numbers are computed here from the exact ported formulas in _physics.py
(cellOCV, cellIR, solveQuad) — not hand-rounded.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _physics import (BATT_4S3300, BATT_4S1300_LOWC, cell_ocv, cell_ir,
                       params_with_battery, solve_quad)

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, Circle, Rectangle

# ----------------------------------------------------------------------------
# 1. Compute worked-example numbers (default 4S 3300 mAh pack, full throttle)
# ----------------------------------------------------------------------------
p_default = params_with_battery(BATT_4S3300)
p_lowc = params_with_battery(BATT_4S1300_LOWC)

full_default = solve_quad(1.0, 1.0, p_default)
full_lowc = solve_quad(1.0, 1.0, p_lowc)

Voc_pack = cell_ocv(1.0) * p_default["cells"]
Rpack_default = p_default["cells"] * cell_ir(p_default, 1.0)
I_default = full_default["Itot"]
Vdrop_default = I_default * Rpack_default
Vterm_default = full_default["V"]
vCell_default = Vterm_default / p_default["cells"]

print("Default pack: Voc=%.2fV Rpack=%.2fmOhm I=%.2fA Vdrop=%.2fV Vterm=%.2fV vCell=%.3fV" %
      (Voc_pack, Rpack_default * 1000, I_default, Vdrop_default, Vterm_default, vCell_default))

# ----------------------------------------------------------------------------
# 2. Nonlinear sag sweep (mirrors sagCalc, main.js ~402-415) for both packs
# ----------------------------------------------------------------------------
def sag_sweep(p):
    ii, vv = [], []
    d = 0.05
    while d <= 1.0001:
        r = solve_quad(round(d, 2), 1.0, p)
        ii.append(r["Itot"])
        vv.append(r["V"])
        d += 0.05
    return ii, vv

i_default, v_default = sag_sweep(p_default)
i_lowc, v_lowc = sag_sweep(p_lowc)

BROWNOUT_VCELL = 3.30
PASS_VCELL = 3.50

# ----------------------------------------------------------------------------
# 3. Draw
# ----------------------------------------------------------------------------
TEAL = "#178a6f"
RED = "#c0392b"
AMBER = "#b9770e"
WIRE = "#2b2b2b"

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(15.5, 6.8))

# ---- Left: equivalent circuit schematic ----
ax1.set_xlim(0, 10)
ax1.set_ylim(0, 10)
ax1.axis("off")
ax1.set_title("Pack Equivalent Circuit Under Load\n(4S 3300 mAh, full throttle)",
               fontsize=14, fontweight="bold", pad=14)

y_top, y_bot = 7.4, 2.6
x_src, x_res_l, x_res_r, x_load = 1.6, 3.8, 6.0, 8.4

# top rail
ax1.plot([x_src, x_load], [y_top, y_top], color=WIRE, lw=2)
# bottom rail
ax1.plot([x_src, x_load], [y_bot, y_bot], color=WIRE, lw=2)

# voltage source (V_oc), drawn as two parallel plates (battery symbol)
src_cy = (y_top + y_bot) / 2
for i, (h, lw) in enumerate([(0.55, 3.4), (0.30, 2.0)]):
    yy = src_cy + (0.28 if i == 0 else -0.28)
    ax1.plot([x_src - h / 2, x_src + h / 2], [yy, yy], color=WIRE, lw=lw)
ax1.plot([x_src, x_src], [y_top, src_cy + 0.28], color=WIRE, lw=2)
ax1.plot([x_src, x_src], [src_cy - 0.28, y_bot], color=WIRE, lw=2)
ax1.text(x_src, y_bot - 0.55, r"$V_{oc}=N_{cells}\cdot V_{oc,cell}$" + "\n%.2f V" % Voc_pack,
          ha="center", va="top", fontsize=11.5, color=TEAL, fontweight="bold")

# internal resistance R_pack (box resistor, series)
res_h = 0.6
ax1.plot([x_src, x_res_l], [y_top, y_top], color=WIRE, lw=2)
rect = Rectangle((x_res_l, y_top - res_h / 2), x_res_r - x_res_l, res_h,
                  facecolor="white", edgecolor=WIRE, lw=2.2)
ax1.add_patch(rect)
ax1.text((x_res_l + x_res_r) / 2, y_top, r"$R_{pack}$", ha="center", va="center",
          fontsize=12, fontweight="bold")
ax1.text((x_res_l + x_res_r) / 2, y_top + res_h / 2 + 0.3,
          "%.2f m$\\Omega$" % (Rpack_default * 1000), ha="center", va="bottom",
          fontsize=11.5, color="#333333", fontweight="bold")
ax1.plot([x_res_r, x_load], [y_top, y_top], color=WIRE, lw=2)

# current arrow
arr = FancyArrowPatch((x_res_r + 0.15, y_top + 0.55), (x_res_r + 1.1, y_top + 0.55),
                       arrowstyle="-|>", mutation_scale=18, color=RED, lw=2.2)
ax1.add_patch(arr)
ax1.text(x_res_r + 0.6, y_top + 0.85, "I = %.1f A" % I_default, ha="center", fontsize=12,
          color=RED, fontweight="bold")

# load (motor+ESC stack) box on the right
load_w, load_h = 1.3, y_top - y_bot
ax1.add_patch(Rectangle((x_load, y_bot), load_w, load_h, facecolor="#eef6f3",
                          edgecolor=WIRE, lw=2))
ax1.text(x_load + load_w / 2, (y_top + y_bot) / 2, "4× motor\n+ ESC\n(load)",
          ha="center", va="center", fontsize=10.5)
ax1.plot([x_load + load_w, x_load + load_w], [y_top, y_bot], color=WIRE, lw=0)

# terminal voltage annotation
ax1.text(x_load + load_w / 2, y_bot - 0.55,
          r"$V_{terminal}$" + " = %.2f V\n(%.3f V/cell)" % (Vterm_default, vCell_default),
          ha="center", va="top", fontsize=11.5, color="#333333", fontweight="bold")

# node dots
for xx, yy in [(x_src, y_top), (x_src, y_bot), (x_load, y_top), (x_load, y_bot)]:
    ax1.add_patch(Circle((xx, yy), 0.045, facecolor=WIRE, zorder=5))

eq_text = (r"$V_{terminal}=V_{oc}-I\cdot R_{pack}$" + "\n"
           "%.2f = %.2f − %.1f×%.4f" % (Vterm_default, Voc_pack, I_default, Rpack_default))
ax1.text(5.0, 0.9, eq_text, ha="center", va="center", fontsize=11.5,
          bbox=dict(boxstyle="round,pad=0.4", facecolor="#f7f7f7", edgecolor=TEAL, lw=1.3))

# ---- Right: nonlinear sag curve, both packs, vs brownout/pass thresholds ----
ax2.set_title("Loaded Pack Voltage vs. Draw Current\n(4S packs, throttle 5%→100%)",
               fontsize=14, fontweight="bold", pad=14)
ax2.plot(i_default, v_default, color=TEAL, lw=2.4, marker="o", ms=3.5,
          label="4S 3300 mAh (default, 6.5 mΩ/cell)")
ax2.plot(i_lowc, v_lowc, color=RED, lw=2.4, marker="o", ms=3.5,
          label="4S 1300 mAh low-C (24 mΩ/cell)")

cells = 4
ax2.axhline(BROWNOUT_VCELL * cells, color=AMBER, ls="--", lw=1.8,
             label="brownout trip — %.2f V/cell (%.1f V pack)" % (BROWNOUT_VCELL, BROWNOUT_VCELL * cells))
ax2.axhline(PASS_VCELL * cells, color="#555555", ls=":", lw=1.8,
             label="pass floor — %.2f V/cell (%.1f V pack)" % (PASS_VCELL, PASS_VCELL * cells))

ax2.scatter([I_default], [Vterm_default], color=TEAL, s=90, zorder=5, edgecolor="white", lw=1.2)
ax2.annotate("full throttle\n%.1f A" % I_default, (I_default, Vterm_default),
              textcoords="offset points", xytext=(10, 12), fontsize=9.5, color=TEAL, fontweight="bold")

ax2.set_xlabel("Total pack current, I (A)", fontsize=11.5)
ax2.set_ylabel("Loaded pack terminal voltage (V)", fontsize=11.5)
ax2.grid(alpha=0.25)
ax2.legend(fontsize=9.3, loc="lower left")
ax2.set_ylim(bottom=8)

fig.suptitle("Battery Pack Under Electrical Load — Internal Resistance & Voltage Sag",
              fontsize=15.5, fontweight="bold", y=1.01)
fig.tight_layout(rect=[0, 0.0, 1, 0.97])

out_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                          "battery_circuit_and_sag.png")
fig.savefig(out_path, dpi=150, bbox_inches="tight")
print("Saved:", out_path)
