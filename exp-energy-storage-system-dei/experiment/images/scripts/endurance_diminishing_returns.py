#!/usr/bin/env python3
"""
Generates endurance_diminishing_returns.png for the energy-storage
experiment, referenced from theory.md Section 5 ("Endurance & the Hover
Flight Energy Budget").

Reproduces enduranceForCapacity() (main.js ~423-440): for a hypothetical
pack capacity, re-derives the added pack mass (scaled from the selected
battery's real g/mAh density), re-solves the hover throttle point with the
REAL assembled-drone hover physics (solveQuad bisection against the new
all-up weight), and computes endurance from the true hover current — NOT
a naive linear (capacity / fixed current) ratio. Plotted against that
naive linear reference line, the gap is the sub-linear "diminishing
returns" the experiment's instructor narration calls out: a bigger battery
adds thrust-robbing mass, so doubling capacity does not double flight time.

Base pack: 4S 3300 mAh (default), 1806 motor + 5" tri-blade propeller,
mass model from the real fpv5/1806/5in_tri/CM703/PiHawk catalog masses.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _physics import BATT_4S3300, params_with_battery, solve_quad, G

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

TEAL = "#178a6f"
RED = "#c0392b"
GREY = "#7f8c8d"

BASE_CAP_MAH = float(BATT_4S3300["cap_mah"])       # 3300
BATT_MASS_G = 320.0                                 # 4S 3300 mAh catalog mass_g
TOTAL_MASS_G = 671.2                                # fpv5+1806x4+5in_tri x4+4S3300+Cyclone35Ax4+PiHawk+CM703
MASS_PER_MAH = BATT_MASS_G / BASE_CAP_MAH

p = params_with_battery(BATT_4S3300)


def endurance_for_capacity(cap_mah):
    mass_g = MASS_PER_MAH * cap_mah
    mkg = max(TOTAL_MASS_G - BATT_MASS_G + mass_g, 1) / 1000
    W = mkg * G
    full = solve_quad(1.0, 1.0, p)
    if full["Ttot"] <= W:
        return dict(cap=cap_mah, mkg=mkg, deficit=True, endur=0, hoverI=0)
    lo, hi = 0.0, 1.0
    for _ in range(24):
        mid = (lo + hi) / 2
        if solve_quad(mid, 1.0, p)["Ttot"] > W:
            hi = mid
        else:
            lo = mid
    hoverD = (lo + hi) / 2
    hover = solve_quad(hoverD, 0.6, p)
    hoverI = hover["Itot"]
    endur = (cap_mah / 1000 * 0.80 / hoverI) * 60 if hoverI > 0 else 0
    return dict(cap=cap_mah, mkg=mkg, deficit=False, endur=endur, hoverI=hoverI, W=W)


caps = [BASE_CAP_MAH, BASE_CAP_MAH * 1.5, BASE_CAP_MAH * 2.0]
rows = [endurance_for_capacity(c) for c in caps]
for r in rows:
    print(r)

# denser sweep for a smooth curve
caps_dense = [BASE_CAP_MAH * (1 + 1.0 * i / 60) for i in range(61)]
rows_dense = [endurance_for_capacity(c) for c in caps_dense]

# naive linear reference: same (capacity/current) ratio as the base point, extended
base_endur = rows[0]["endur"]
naive = [base_endur * (c / BASE_CAP_MAH) for c in caps_dense]

fig, ax = plt.subplots(figsize=(10.5, 7.0))

ax.plot([r["cap"] for r in rows_dense], [r["endur"] for r in rows_dense], color=TEAL, lw=2.6,
         label="real endurance (true hover-current re-solve)")
ax.plot(caps_dense, naive, color=GREY, lw=2.0, ls="--",
         label="naive linear scaling (capacity ÷ fixed current)")

for i, r in enumerate(rows):
    ax.scatter([r["cap"]], [r["endur"]], color=TEAL, s=90, zorder=5, edgecolor="white", lw=1.2)
    offset = (10, 14) if i == 0 else (8, -32)
    va = "bottom" if i == 0 else "top"
    ax.annotate("%.0f mAh\n%.2f min\n(%.0f g AUW)" % (r["cap"], r["endur"], r["mkg"] * 1000),
                 (r["cap"], r["endur"]), textcoords="offset points", xytext=offset, va=va,
                 fontsize=9.3, color=TEAL, fontweight="bold")

gain_mult = rows[2]["endur"] / rows[0]["endur"] if rows[0]["endur"] > 0 else 0
ax.text(0.97, 0.04,
         "2× capacity (%.0f→%.0f mAh) → %.2fx endurance (%.2f→%.2f min),\nnot 2x — "
         "added battery mass raises hover thrust demand and current draw."
         % (rows[0]["cap"], rows[2]["cap"], gain_mult, rows[0]["endur"], rows[2]["endur"]),
         transform=ax.transAxes, fontsize=10, va="bottom", ha="right",
         bbox=dict(boxstyle="round,pad=0.5", facecolor="#f7f7f7", edgecolor=TEAL, lw=1.2))

ax.set_xlabel("Battery capacity (mAh)", fontsize=12)
ax.set_ylabel("Hover endurance (minutes)", fontsize=12)
ax.set_title("Endurance vs. Battery Capacity — Diminishing Returns\n"
              "(1806 motor + 5\" tri-blade prop, 4S chemistry, mass scaled from real 3300 mAh pack density)",
              fontsize=13, fontweight="bold")
ax.grid(alpha=0.25)
ax.legend(fontsize=10, loc="upper left")

fig.tight_layout()
out_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                          "endurance_diminishing_returns.png")
fig.savefig(out_path, dpi=150, bbox_inches="tight")
print("Saved:", out_path)
