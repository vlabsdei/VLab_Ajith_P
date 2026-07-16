#!/usr/bin/env python3
"""
Generates crate_safety_margins.png for the energy-storage experiment,
referenced from theory.md Section 1 ("Pack Voltage, C-Rating & the
Continuous Discharge Limit").

Compares, for four real catalog battery packs under the SAME 1806 motor /
5" tri-blade propeller build, the pack's continuous discharge rating
(I_cont = C_rating_cont x Capacity_Ah), its burst rating
(I_burst = C_rating x Capacity_Ah), and the REAL full-throttle 4-motor
current draw the simulator's electrical solver produces for that exact
build (solveQuad, main.js ~297-308) — i.e. exactly the comparison the
"C-Rating Safety Check" bench test performs (main.js simStep,
metric === "crate", ~2308-2356).

All numbers computed here via the ported solver in _physics.py.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _physics import (BATT_4S3300, BATT_4S1300_LOWC, BATT_4S1500_HIGHC, BATT_6S5000,
                       params_with_battery, solve_quad)

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

TEAL = "#178a6f"
RED = "#c0392b"
AMBER = "#b9770e"
GREY = "#7f8c8d"

packs = [
    ("4S 3300 mAh\n(default, 15C cont.)", BATT_4S3300),
    ("4S 1300 mAh\n(low-C, 12C cont.)", BATT_4S1300_LOWC),
    ("4S 1500 mAh\n(high-C, 100C cont.)", BATT_4S1500_HIGHC),
    ("6S 5000 mAh\n(22C cont.)", BATT_6S5000),
]

rows = []
for label, batt in packs:
    p = params_with_battery(batt)
    full = solve_quad(1.0, 1.0, p)
    capAh = p["cap"] / 1000
    contA = capAh * p["cRatingCont"]
    burstA = capAh * p["cRating"]
    drawA = full["Itot"]
    rows.append(dict(label=label, contA=contA, burstA=burstA, drawA=drawA,
                       pass_=drawA <= contA))
    print("%-30s contA=%.1f burstA=%.1f drawA=%.1f pass=%s" %
          (label.replace(chr(10), " "), contA, burstA, drawA, drawA <= contA))

fig, ax = plt.subplots(figsize=(11.5, 7.0))

n = len(rows)
y = list(range(n))
bar_h = 0.24

for i, r in enumerate(rows):
    yb = y[i]
    ax.barh(yb + bar_h, r["burstA"], height=bar_h, color="#d7dbdd", edgecolor=GREY,
             label="burst rating (I_burst = C_rating × Ah)" if i == 0 else None)
    ax.barh(yb, r["contA"], height=bar_h, color=AMBER, alpha=0.55, edgecolor=AMBER,
             label="continuous rating (I_cont = C_rating,cont × Ah)" if i == 0 else None)
    draw_color = RED if not r["pass_"] else TEAL
    ax.barh(yb - bar_h, r["drawA"], height=bar_h, color=draw_color, edgecolor=draw_color,
             label="actual full-throttle draw (solveQuad)" if i == 0 else None)
    verdict = "FAIL — exceeds continuous rating" if not r["pass_"] else "PASS — within continuous rating"
    ax.text(max(r["burstA"], r["drawA"]) + 4, yb, verdict, va="center", fontsize=10,
             color=draw_color, fontweight="bold")

ax.set_yticks(y)
ax.set_yticklabels([r["label"] for r in rows], fontsize=11)
ax.set_xlabel("Current (A)", fontsize=12)
ax.set_title("C-Rating Safety Check — Continuous / Burst Rating vs. Real Full-Throttle Draw\n"
              "(1806 motor + 5\" tri-blade propeller, 4 catalog packs)", fontsize=13.5, fontweight="bold")
ax.grid(axis="x", alpha=0.25)
ax.legend(loc="lower right", fontsize=9.5, framealpha=0.9)
ax.set_xlim(0, max(r["drawA"] for r in rows) * 1.35)

fig.tight_layout()
out_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                          "crate_safety_margins.png")
fig.savefig(out_path, dpi=150, bbox_inches="tight")
print("Saved:", out_path)
