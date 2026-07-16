#!/usr/bin/env python3
"""
Generates cep_rayleigh_diagram.png for the navigation experiment
(exp-navigation-&-positioning-dei), referenced from theory.md Section 2
("Horizontal Accuracy: CEP & the Rayleigh Distribution").

Scatters simulated GPS fixes around the true position: East/North error
components are independent zero-mean Gaussians with 1-sigma = sigma, so the
radial error |fix| is Rayleigh-distributed. Overlays the CEP circle (the
radius containing 50% of fixes) for both the open-sky and urban-multipath
UERE scenarios, mirroring simulation/js/main.js's navSimStep "cep" branch
(Rayleigh sampling: r = sigma*sqrt(-2*ln(u)), sigma = CEP/sqrt(ln4)) and
cepFromHdop(hdop, uere) = hdop * uere.

All numbers are computed here from the exact same constants as main.js:
  HDOP           = 1.0143  (8-satellite "spread" preset, see
                             constellation_geometry_diagram.py / theory.md Sec.1)
  UERE nominal   = 3.0 m,  UERE urban = 7.5 m           (NAV.uere in main.js)
  CEP            = HDOP * UERE
  sigma          = CEP / sqrt(ln 4)                      (Rayleigh median relation)
"""

import math
import random
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Circle

random.seed(7)

HDOP = 1.0143255908670024          # from constellation_geometry_diagram.py (8-sat spread)
UERE = {"nominal": 3.0, "urban": 7.5}
SQRT_LN4 = math.sqrt(math.log(4))  # ~1.1774

def cep_from_hdop(hdop, uere):
    return hdop * uere

def rayleigh_sample(sigma):
    u = max(random.random(), 1e-6)
    return sigma * math.sqrt(-2.0 * math.log(u))

N_FIXES = 60

fig, axes = plt.subplots(1, 2, figsize=(14, 7.2))

for ax, scenario, color in [(axes[0], "nominal", "#2f6fce"), (axes[1], "urban", "#c0392b")]:
    uere = UERE[scenario]
    cep = cep_from_hdop(HDOP, uere)
    sigma = cep / SQRT_LN4

    # sample fixes: radius Rayleigh-distributed, angle uniform
    xs, ys, inside = [], [], 0
    for _ in range(N_FIXES):
        r = rayleigh_sample(sigma)
        theta = random.uniform(0, 2 * math.pi)
        x, y = r * math.cos(theta), r * math.sin(theta)
        xs.append(x); ys.append(y)
        if r <= cep:
            inside += 1

    lim = max(cep * 2.6, max((abs(v) for v in xs + ys), default=1.0) * 1.1)
    ax.set_xlim(-lim, lim)
    ax.set_ylim(-lim, lim)
    ax.set_aspect("equal")
    ax.set_title(("Open-sky (UERE = %.1f m)" if scenario == "nominal" else "Urban multipath (UERE = %.1f m)") % uere,
                 fontsize=13.5, fontweight="bold", color=color, pad=10)

    # CEP circle (50% containment)
    ax.add_patch(Circle((0, 0), cep, facecolor=color, alpha=0.08, edgecolor=color, lw=2.2, zorder=2))
    ax.plot([], [], color=color, lw=2.2, label="CEP = %.2f m (50%% radius)" % cep)

    # fix scatter
    ax.scatter(xs, ys, s=26, color=color, alpha=0.65, edgecolor="white", linewidth=0.5, zorder=3)
    ax.scatter([0], [0], marker="+", s=140, color="#1a1a1a", linewidth=2, zorder=4, label="true position")

    ax.axhline(0, color="#d8d8d8", lw=0.8, zorder=0)
    ax.axvline(0, color="#d8d8d8", lw=0.8, zorder=0)
    ax.set_xlabel("East error (m)", fontsize=10.5)
    ax.set_ylabel("North error (m)", fontsize=10.5)
    ax.legend(loc="upper right", fontsize=9, framealpha=0.9)

    pct_inside = 100.0 * inside / N_FIXES
    stat_txt = (
        r"$\sigma$ (per-axis) = %.2f m" "\n"
        r"CEP $= \sigma\sqrt{\ln 4}$ = %.2f m" "\n"
        "%d/%d sampled fixes (%.0f%%) inside CEP circle" % (sigma, cep, inside, N_FIXES, pct_inside)
    )
    ax.text(0.02, 0.02, stat_txt, transform=ax.transAxes, ha="left", va="bottom",
            fontsize=9.3, family="monospace",
            bbox=dict(boxstyle="round,pad=0.4", facecolor="#fffdf5", edgecolor=color, lw=1.1))

fig.suptitle("Horizontal Fix Scatter — Rayleigh-Distributed GPS Error and the CEP Radius\n"
             "(same HDOP = %.2f, two ranging-error scenarios)" % HDOP,
             fontsize=15, fontweight="bold", y=1.03)
fig.tight_layout(rect=[0, 0, 1, 0.95])

out_path = "/Users/ajith/Desktop/vlgen/exp-navigation-&-positioning-dei/experiment/images/cep_rayleigh_diagram.png"
fig.savefig(out_path, dpi=150, bbox_inches="tight")
print("Saved:", out_path)
print("nominal CEP=%.3f sigma=%.3f | urban CEP=%.3f sigma=%.3f" % (
    cep_from_hdop(HDOP, UERE["nominal"]), cep_from_hdop(HDOP, UERE["nominal"]) / SQRT_LN4,
    cep_from_hdop(HDOP, UERE["urban"]), cep_from_hdop(HDOP, UERE["urban"]) / SQRT_LN4))
