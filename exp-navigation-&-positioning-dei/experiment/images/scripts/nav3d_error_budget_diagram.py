#!/usr/bin/env python3
"""
Generates nav3d_error_budget_diagram.png for the navigation experiment
(exp-navigation-&-positioning-dei), referenced from theory.md Section 4
("Combined 3-D Position Error Budget").

Draws the root-sum-square combination of the horizontal CEP (Section 2) and
the vertical barometric error (Section 3) as a right-triangle construction —
CEP and h_err as the two legs, Total as the hypotenuse — for both a safe
and an unsafe configuration, plus a side-view error-ellipsoid sketch (a
horizontal disc of radius CEP and a vertical extent of h_err) against the
5 m safety threshold, mirroring simulation/js/main.js's nav3dRadius() /
navSimStep "nav3d" branch.

All numbers are computed here from the exact same values used in the other
three diagram scripts / theory.md's worked examples:
  Total = sqrt(CEP^2 + h_err^2)
  safe   case: CEP = 3.043 m (open-sky, 8-sat spread), h_err = 2.799 m (fine @3000m)
  unsafe case: CEP = 7.607 m (urban multipath, same geometry), h_err = 15.339 m (coarse @3000m)
"""

import math
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Circle, FancyArrowPatch, Ellipse

SAFE_LIMIT = 5.0

cases = [
    {"label": "Safe configuration", "cep": 3.042976772601007, "herr": 2.7991677206192884,
     "color": "#2e9e6b", "sub": "open-sky UERE · fine baro @ 3000 m"},
    {"label": "Unsafe configuration", "cep": 7.6074419315025175, "herr": 15.339072675590895,
     "color": "#c0392b", "sub": "urban multipath · coarse baro @ 3000 m"},
]
for c in cases:
    c["total"] = math.sqrt(c["cep"] ** 2 + c["herr"] ** 2)

fig, axes = plt.subplots(2, 2, figsize=(13, 11))

for col, c in enumerate(cases):
    ax_tri = axes[0][col]
    ax_ell = axes[1][col]
    color = c["color"]

    # --- Right-triangle RSS construction ---
    ax_tri.set_xlim(-1, max(c["cep"], c["herr"]) * 1.35 + 1)
    ax_tri.set_ylim(-1, max(c["cep"], c["herr"]) * 1.35 + 1)
    ax_tri.set_aspect("equal")
    ax_tri.set_title(c["label"] + "\n" + c["sub"], fontsize=12.5, fontweight="bold", color=color)

    ax_tri.plot([0, c["cep"]], [0, 0], color="#2f6fce", lw=3, solid_capstyle="round")
    ax_tri.plot([c["cep"], c["cep"]], [0, c["herr"]], color="#8e44ad", lw=3, solid_capstyle="round")
    ax_tri.plot([0, c["cep"]], [0, c["herr"]], color=color, lw=3.2, solid_capstyle="round")

    ax_tri.text(c["cep"] / 2, -0.55, "CEP = %.2f m" % c["cep"], ha="center", va="top",
                fontsize=10.5, color="#2f6fce", fontweight="bold")
    ax_tri.text(c["cep"] + 0.25, c["herr"] / 2, "h_err = %.2f m" % c["herr"], ha="left", va="center",
                fontsize=10.5, color="#8e44ad", fontweight="bold", rotation=90)
    mx, my = c["cep"] / 2, c["herr"] / 2
    ax_tri.text(mx - 0.3, my + 0.5, "Total = %.2f m" % c["total"], ha="center", va="bottom",
                fontsize=11.5, color=color, fontweight="bold", rotation=math.degrees(
                    math.atan2(c["herr"], c["cep"])) * 0.55)

    ax_tri.plot(0, 0, marker="o", color="#1a1a1a", ms=6, zorder=5)
    ax_tri.text(-0.15, 0.15, "true\nposition", ha="right", va="bottom", fontsize=8, color="#555")
    ax_tri.axis("off")

    # --- Error-ellipsoid side sketch vs 5 m threshold ---
    lim = max(c["total"], SAFE_LIMIT) * 1.3
    ax_ell.set_xlim(-lim, lim)
    ax_ell.set_ylim(-lim, lim)
    ax_ell.set_aspect("equal")
    ax_ell.axis("off")

    # safety threshold ring
    ax_ell.add_patch(Circle((0, 0), SAFE_LIMIT, facecolor="none", edgecolor="#7c8aa3",
                             lw=1.6, linestyle="--", zorder=1))
    ax_ell.text(0, SAFE_LIMIT + 0.25, "5 m safety threshold", ha="center", va="bottom",
                fontsize=9, color="#7c8aa3")

    # error ellipse: horizontal semi-axis = CEP, vertical semi-axis = h_err
    ax_ell.add_patch(Ellipse((0, 0), width=2 * c["cep"], height=2 * c["herr"],
                              facecolor=color, alpha=0.18, edgecolor=color, lw=2.2, zorder=2))
    # total-radius circle
    ax_ell.add_patch(Circle((0, 0), c["total"], facecolor="none", edgecolor=color,
                             lw=2.4, zorder=3))
    ax_ell.plot(0, 0, marker="+", color="#1a1a1a", ms=14, mew=2, zorder=4)

    verdict = "SAFE — under threshold" if c["total"] < SAFE_LIMIT else "UNSAFE — exceeds threshold"
    ax_ell.text(0, -lim + 0.3, "Total = %.2f m — %s" % (c["total"], verdict),
                ha="center", va="bottom", fontsize=10.8, color=color, fontweight="bold")

fig.suptitle(r"Combined 3-D Navigation Error Budget:  $Total=\sqrt{CEP^2+h_{err}^2}$" + "\n"
             "Root-sum-square of horizontal (GPS) and vertical (barometric) error terms",
             fontsize=15, fontweight="bold", y=1.01)
fig.tight_layout(rect=[0, 0, 1, 0.94])

out_path = "/Users/ajith/Desktop/vlgen/exp-navigation-&-positioning-dei/experiment/images/nav3d_error_budget_diagram.png"
fig.savefig(out_path, dpi=150, bbox_inches="tight")
print("Saved:", out_path)
for c in cases:
    print(c["label"], "Total=%.3f" % c["total"])
