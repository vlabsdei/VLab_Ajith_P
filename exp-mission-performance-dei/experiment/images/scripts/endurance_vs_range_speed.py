#!/usr/bin/env python3
"""
Generates endurance_vs_range_speed.png for the Mission Performance capstone,
referenced from theory.md Section 4 ("Maximum Endurance vs Maximum Range").

Same cruise-power curve as cruise_power_curve.png, now marking the TWO
distinct optimal speeds:
  V_endur : minimum of P_cruise(V)          -> longest airborne time
  V_range : minimum of P_cruise(V)/V        -> most distance per Wh,
            geometrically the tangent-from-origin point.
For the reference build these land near 9.4 m/s and 13.5 m/s (theory.md).
"""
import numpy as np
from _physics import (apply_style, plt, thrust, pCruise, DRY_G,
                      INK2, GRID, TEAL, AMBER, DANGER, GREEN, MUTED)

apply_style()
T = thrust(DRY_G)

V = np.linspace(2.0, 20.0, 400)
Pcru = np.array([pCruise(v, T) for v in V])

Vfine = np.linspace(2.0, 20.0, 3601)
Pfine = np.array([pCruise(v, T) for v in Vfine])
i_end = int(np.argmin(Pfine))
V_end, P_end = Vfine[i_end], Pfine[i_end]

PoverV = Pfine / Vfine
i_rng = int(np.argmin(PoverV))
V_rng, P_rng = Vfine[i_rng], Pfine[i_rng]

print(f"V_endur={V_end:.2f} m/s (P={P_end:.2f} W), "
      f"V_range={V_rng:.2f} m/s (P={P_rng:.2f} W)")

fig, ax = plt.subplots(figsize=(10.5, 6.6))
ax.plot(V, Pcru, color=AMBER, lw=3.2, zorder=5, label=r"cruise power $P_{cruise}(V)$")

# tangent-from-origin construction for max range
xs = np.linspace(0, V_rng * 1.02, 50)
ax.plot(xs, (P_rng / V_rng) * xs, color=GREEN, lw=1.6, ls="--", zorder=3,
        label=r"tangent from origin  (min $P/V$)")

# endurance point
ax.plot([V_end], [P_end], "o", ms=12, mfc=DANGER, mec="#5a1414", mew=1.5, zorder=7)
ax.plot([V_end, V_end], [0, P_end], color=DANGER, lw=1.0, ls=":", zorder=3)
ax.annotate(rf"max endurance" "\n" rf"$V\approx{V_end:.1f}$ m/s",
            xy=(V_end, P_end), xytext=(V_end - 3.9, P_end + 8.5),
            fontsize=11.5, fontweight="bold", color=DANGER, ha="center",
            arrowprops=dict(arrowstyle="->", color=DANGER, lw=1.6))

# range point
ax.plot([V_rng], [P_rng], "s", ms=12, mfc=GREEN, mec="#194d36", mew=1.5, zorder=7)
ax.plot([V_rng, V_rng], [0, P_rng], color=GREEN, lw=1.0, ls=":", zorder=3)
ax.annotate(rf"max range" "\n" rf"$V\approx{V_rng:.1f}$ m/s",
            xy=(V_rng, P_rng), xytext=(V_rng + 3.6, P_rng + 8.5),
            fontsize=11.5, fontweight="bold", color=GREEN, ha="center",
            arrowprops=dict(arrowstyle="->", color=GREEN, lw=1.6))

ax.set_title("Maximum Endurance vs Maximum Range Speed\n"
             "(reference build: fpv5 / 5″ tri-blade / 1806 / 4S-1500, no payload)",
             fontsize=13.5, fontweight="bold", pad=12)
ax.set_xlabel("Airspeed  V  (m/s)")
ax.set_ylabel("Power (W)")
ax.set_xlim(0, 20.6)
ax.set_ylim(0, Pcru.max() * 1.18)
ax.grid(True, alpha=0.35, color=GRID)
ax.legend(loc="upper center", fontsize=10.6, framealpha=0.95)

ax.text(0.015, 0.03,
        (r"$V_{endur}$: min $P_{cruise}(V)$  $\Rightarrow$  longest time aloft" "\n"
         r"$V_{range}$: min $P_{cruise}(V)/V$  $\Rightarrow$  most distance / Wh" "\n"
         r"always $V_{range} > V_{endur}$ (asymmetric curve)"),
        transform=ax.transAxes, ha="left", va="bottom", fontsize=9.3,
        bbox=dict(boxstyle="round,pad=0.5", fc="#fbfaf5", ec=AMBER, lw=1.2))

fig.tight_layout()
out = "/Users/ajith/Desktop/vlgen/exp-mission-performance-dei/experiment/images/endurance_vs_range_speed.png"
fig.savefig(out, dpi=150, bbox_inches="tight", facecolor="#ffffff")
print("Saved:", out)
