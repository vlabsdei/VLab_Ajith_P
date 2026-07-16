#!/usr/bin/env python3
"""
Generates range_payload_envelope.png for the Mission Performance capstone,
referenced from theory.md Section 6 ("Range and the Range-Payload Envelope").

Range(V) = (E_batt*eta_total - E_hover) / P_cruise(V) * V
with the dry airframe mass held fixed across all three packs (theory.md's
modelling note: packs compared on usable energy only). Cruise V = 10 m/s,
60 s hover reserve, eta_total = 0.55.

Reproduces theory.md's worked example on the 4S/1500 curve:
  200 g payload -> P_cruise ~ 42.8 W, Range ~ 9.5 km
  400 g payload -> P_cruise ~ 62.9 W, Range ~ 6.2 km
(a ~1/3 cut for a doubled payload — the signature non-linearity).
"""
import numpy as np
from _physics import (apply_style, plt, thrust, pCruise, pHover, DRY_G,
                      ETA_TOTAL, GRID, TEAL, AMBER, SLATE, DANGER, GREEN,
                      INK, MUTED)

apply_style()

V_CRUISE = 10.0
T_HOVER_RESERVE = 60.0   # s (takeoff + landing)

# (label, cells, capacity_Ah, color)
packs = [
    ("3S / 2200 mAh", 3, 2.2, SLATE),
    ("4S / 1500 mAh", 4, 1.5, AMBER),
    ("6S / 5000 mAh", 6, 5.0, GREEN),
]

payload = np.linspace(0, 600, 300)   # g


def range_m(cells, cap_ah, payload_g):
    mass_g = DRY_G + payload_g
    T = thrust(mass_g)
    e_batt_wh = cells * 3.7 * cap_ah
    e_hover_wh = pHover(T) * T_HOVER_RESERVE / 3600.0
    usable_j = (e_batt_wh * ETA_TOTAL - e_hover_wh) * 3600.0
    if usable_j <= 0:
        return 0.0
    return usable_j / pCruise(V_CRUISE, T) * V_CRUISE


fig, ax = plt.subplots(figsize=(10.6, 6.7))

for lbl, cells, cap, col in packs:
    r_km = np.array([range_m(cells, cap, p) for p in payload]) / 1000.0
    ax.plot(payload, r_km, color=col, lw=3.0, label=lbl, zorder=5)

# annotate the theory.md worked points on the 4S/1500 curve
for pg, txt, dy in [(200, "200 g → 9.5 km", 1.4), (400, "400 g → 6.2 km", 1.4)]:
    rk = range_m(4, 1.5, pg) / 1000.0
    ax.plot([pg], [rk], "o", ms=10, mfc=DANGER, mec="#5a1414", mew=1.4, zorder=8)
    ax.annotate(txt, xy=(pg, rk), xytext=(pg + 26, rk + dy),
                fontsize=10.5, fontweight="bold", color=DANGER,
                arrowprops=dict(arrowstyle="->", color=DANGER, lw=1.4))

ax.set_title("Range–Payload Envelope — Three Battery Packs\n"
             "(dry airframe 529 g fixed; cruise V = 10 m/s, 60 s hover reserve, η = 0.55)",
             fontsize=13, fontweight="bold", pad=12)
ax.set_xlabel("Payload  (g)")
ax.set_ylabel("Range  (km)")
ax.set_xlim(0, 600)
ax.set_ylim(0, None)
ax.grid(True, alpha=0.35, color=GRID)
ax.legend(loc="upper right", fontsize=11, framealpha=0.95, title="battery pack")

ax.text(0.015, 0.03,
        (r"$Range=\dfrac{E_{batt}\,\eta_{total}-E_{hover}}{P_{cruise}(V)}\cdot V$" "\n"
         r"induced power $\propto T^{1.5..2}$  $\Rightarrow$  range falls" "\n"
         r"faster than $1/\mathrm{payload}$"),
        transform=ax.transAxes, ha="left", va="bottom", fontsize=9.4,
        bbox=dict(boxstyle="round,pad=0.5", fc="#fbfaf5", ec=AMBER, lw=1.2))

fig.tight_layout()
out = "/Users/ajith/Desktop/vlgen/exp-mission-performance-dei/experiment/images/range_payload_envelope.png"
fig.savefig(out, dpi=150, bbox_inches="tight", facecolor="#ffffff")
print("Saved:", out)
