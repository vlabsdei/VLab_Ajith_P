#!/usr/bin/env python3
"""
Generates mission_energy_phases.png for the Mission Performance capstone,
referenced from theory.md Section 5 ("The Mission Energy Budget").

Stacked per-phase energy for the worked-example 500 m out-and-back hop at
V = 10 m/s:
  takeoff hover 30 s, cruise out 50 s, on-station hover 60 s,
  cruise back 50 s, landing hover 30 s.
  P_hover ~ 33.6 W, P_cruise(10) ~ 26.3 W  ->  E_total ~ 1.85 Wh,
against the 4S/1500 pack's 22.2 Wh (theory.md Section 5).
"""
import numpy as np
from _physics import (apply_style, plt, thrust, pCruise, pHover, DRY_G,
                      E_BATT_WH, ETA_TOTAL, GRID, TEAL, AMBER, SLATE,
                      DANGER, GREEN, INK, MUTED)

apply_style()
T = thrust(DRY_G)
Phover = pHover(T)
Pcru10 = pCruise(10.0, T)
print(f"P_hover={Phover:.2f} W, P_cruise(10)={Pcru10:.2f} W")

# phases: (label, power W, duration s, is_hover)
phases = [
    ("Takeoff\nhover", Phover, 30, True),
    ("Cruise out\n500 m", Pcru10, 50, False),
    ("On-station\nhover", Phover, 60, True),
    ("Cruise back\n500 m", Pcru10, 50, False),
    ("Landing\nhover", Phover, 30, True),
]

wh = [p * t / 3600.0 for (_, p, t, _) in phases]
E_total = sum(wh)
print(f"E_total = {E_total:.3f} Wh")

fig, (ax, axb) = plt.subplots(1, 2, figsize=(12.5, 6.4),
                              gridspec_kw={"width_ratios": [1.7, 1]})

# ---- left: per-phase bars (hover vs cruise colored) ----
x = np.arange(len(phases))
colors = [AMBER if h else TEAL for (_, _, _, h) in phases]
bars = ax.bar(x, wh, color=colors, edgecolor="white", width=0.72, zorder=3)
for b, e, (_, p, t, _) in zip(bars, wh, phases):
    ax.text(b.get_x() + b.get_width() / 2, e + 0.006,
            f"{e:.3f} Wh\n{p:.1f} W · {t}s", ha="center", va="bottom",
            fontsize=9.2, color=INK)
ax.set_xticks(x)
ax.set_xticklabels([lbl for (lbl, _, _, _) in phases], fontsize=9.6)
ax.set_ylabel("Phase energy (Wh)")
ax.set_ylim(0, max(wh) * 1.32)
ax.set_title("Per-Phase Energy — 500 m out-and-back at V = 10 m/s",
             fontsize=12.5, fontweight="bold", pad=10)
ax.grid(True, axis="y", alpha=0.35, color=GRID)
from matplotlib.patches import Patch
ax.legend(handles=[Patch(fc=AMBER, label="hover phase"),
                   Patch(fc=TEAL, label="cruise phase")],
          loc="upper right", fontsize=9.8, framealpha=0.95)

# ---- right: cumulative stack vs pack budget ----
cum = 0.0
axb.set_title("Mission total vs pack", fontsize=12.5, fontweight="bold", pad=10)
for (lbl, p, t, h), e in zip(phases, wh):
    axb.bar(0, e, bottom=cum, width=0.55, color=(AMBER if h else TEAL),
            edgecolor="white", zorder=3)
    cum += e
axb.text(0, E_total + 0.6, f"mission\n{E_total:.2f} Wh", ha="center",
         va="bottom", fontsize=10.5, fontweight="bold", color=INK)

usable = E_BATT_WH * ETA_TOTAL
axb.bar(1, E_BATT_WH, width=0.55, color="#eef1ef", edgecolor=MUTED, zorder=2)
axb.bar(1, usable, width=0.55, color=GREEN, alpha=0.55, edgecolor=GREEN, zorder=3)
axb.text(1, E_BATT_WH + 0.6, f"4S/1500 pack\n{E_BATT_WH:.1f} Wh", ha="center",
         va="bottom", fontsize=10, fontweight="bold", color=INK)
axb.text(1, usable / 2, f"usable\n×η={ETA_TOTAL:.2f}\n{usable:.1f} Wh",
         ha="center", va="center", fontsize=8.6, color="#0f3d2a")
axb.axhline(0, color=MUTED, lw=0.8)
axb.set_xticks([0, 1])
axb.set_xticklabels(["mission", "battery"])
axb.set_ylabel("Energy (Wh)")
axb.set_ylim(0, E_BATT_WH * 1.22)
axb.grid(True, axis="y", alpha=0.35, color=GRID)
axb.text(0.5, usable, "  PASS  ", ha="center", va="center", fontsize=10,
         fontweight="bold", color="white",
         bbox=dict(boxstyle="round,pad=0.35", fc=GREEN, ec="none"))

fig.suptitle("Mission Energy Budget — Stacked Phase Accounting",
             fontsize=14, fontweight="bold", y=0.99)
fig.tight_layout(rect=[0, 0, 1, 0.96])
out = "/Users/ajith/Desktop/vlgen/exp-mission-performance-dei/experiment/images/mission_energy_phases.png"
fig.savefig(out, dpi=150, bbox_inches="tight", facecolor="#ffffff")
print("Saved:", out)
