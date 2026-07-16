#!/usr/bin/env python3
"""
Generates cruise_power_curve.png for the Mission Performance capstone
(exp-mission-performance-dei), referenced from theory.md Section 3
("The U-Shaped Cruise-Power Curve") and procedure.md Stage 1.

Draws the two component power terms and their sum across the 2-20 m/s
sweep that Power Profiling animates, for the reference build (fpv5
chassis, 5" tri-blade props, 1806 motors, 4S/1500 pack, no payload):

  F_D(V)   = 0.5 * rho * V^2 * Cd * A            (parasitic drag force)
  P_para(V)= F_D(V) * V                          (parasitic power, ~V^3)
  v_h      = sqrt(T / (2*rho*A_disk))             (hover-induced velocity)
  v_i(V)   = sqrt( sqrt((V^2/2)^2 + v_h^4) - V^2/2 )   (forward-flight
             induced velocity, momentum theory, main.js inducedVelocity())
  P_ind(V) = T * v_i(V)
  P_cruise(V) = P_para(V) + P_ind(V)

All constants below (Cd, A, T, A_disk) are taken directly from the same
component spec files simulation/js/main.js reads (chasis/fpv5/spec.json,
propeller/5in_tri/spec.json, motor/1806/spec.json, battery/4s_1500/spec.json,
controller/PiHawk/spec.json, reciever/CM703/spec.json), so the numbers on
this figure match theory.md's worked example exactly.
"""
import math
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

# ---- house palette (simulation/css/main.css --teal / --amber / --ink) ----
BG = "#ffffff"
INK = "#1e2a29"
INK2 = "#3c4a46"
MUTED = "#8b9a95"
GRID = "#dde4e1"
TEAL = "#1f3a93"
AMBER = "#c65d3b"
DANGER = "#a83232"
SLATE = "#4f6d9e"

plt.rcParams.update({
    "figure.dpi": 150, "savefig.dpi": 150,
    "font.family": "sans-serif",
    "font.sans-serif": ["Segoe UI", "DejaVu Sans", "Arial"],
    "font.size": 11, "text.color": INK,
    "axes.facecolor": BG, "figure.facecolor": BG,
    "axes.edgecolor": MUTED, "axes.labelcolor": INK,
    "xtick.color": INK2, "ytick.color": INK2,
})

# ---- reference-build constants (component spec.json files) ----
G = 9.80665
RHO = 1.225

m_chasis, m_prop, m_motor, m_esc = 160.0, 4.5 * 4, 19.0 * 4, 9.8 * 4
m_batt, m_ctrl, m_rx = 178.0, 48.0, 10.0
TOTAL_G = m_chasis + m_prop + m_motor + m_esc + m_batt + m_ctrl + m_rx  # 529.2 g
M_KG = TOTAL_G / 1000.0
T = M_KG * G                                   # level-flight thrust (N)

DIA_IN = 5.0
D = DIA_IN * 0.0254                            # prop diameter, m
A_DISK = 4 * math.pi * (D / 2.0) ** 2          # 4-rotor disk area, m^2

CD = 1.05
A_FRONTAL = 0.0095                             # m^2, fpv5 chassis frontal area

VH2 = T / (2 * RHO * A_DISK)                   # hover-induced velocity squared


def missionDrag(V):
    return 0.5 * RHO * V * V * CD * A_FRONTAL


def inducedVelocity(V):
    half = V * V / 2.0
    return math.sqrt(math.sqrt(half * half + VH2 * VH2) - half)


def pCruise(V):
    return missionDrag(V) * V + T * inducedVelocity(V)


def pInd(V):
    return T * inducedVelocity(V)


def pPara(V):
    return missionDrag(V) * V


# ---- sweep 2-20 m/s (matches the simulator's Power Profiling sweep) ----
V = np.linspace(2.0, 20.0, 400)
Ppara = np.array([pPara(v) for v in V])
Pind = np.array([pInd(v) for v in V])
Pcru = np.array([pCruise(v) for v in V])

# ---- fine search for the interior minimum (matches main.js enduranceSpeed) ----
Vfine = np.linspace(2.0, 20.0, 2401)
Pfine = np.array([pCruise(v) for v in Vfine])
i_min = int(np.argmin(Pfine))
V_endur, P_endur = Vfine[i_min], Pfine[i_min]

print(f"Reference build: mass={TOTAL_G:.1f} g, T={T:.3f} N, A_disk={A_DISK:.4f} m^2, "
      f"v_h={math.sqrt(VH2):.3f} m/s, P_ind(0)={pInd(0):.2f} W")
print(f"Minimum: V_endur={V_endur:.2f} m/s, P_cruise={P_endur:.2f} W")

# ---- plot ----
fig, ax = plt.subplots(figsize=(10.5, 6.6))

ax.plot(V, Ppara, color=SLATE, lw=2.2, ls="--",
        label=r"parasitic power $F_D(V)\cdot V$  ($\propto V^3$)")
ax.plot(V, Pind, color=TEAL, lw=2.2, ls="--",
        label=r"induced power $P_{ind}(V)$  ($\propto 1/V$ at high $V$)")
ax.plot(V, Pcru, color=AMBER, lw=3.2, zorder=5,
        label=r"cruise power $P_{cruise}(V)=F_D(V){\cdot}V+P_{ind}(V)$")

# minimum marker
ax.plot([V_endur], [P_endur], "o", ms=11, mfc=DANGER, mec="#5a1414", mew=1.5, zorder=7)
ax.annotate(rf"minimum  $V\approx{V_endur:.1f}$ m/s, $P\approx{P_endur:.1f}$ W",
            xy=(V_endur, P_endur), xytext=(V_endur + 1.6, P_endur + 9.5),
            fontsize=11.5, fontweight="bold", color=DANGER,
            arrowprops=dict(arrowstyle="->", color=DANGER, lw=1.6))
ax.plot([V_endur, V_endur], [0, P_endur], color=DANGER, lw=1.0, ls=":", zorder=3)

ax.set_title("Cruise Power vs Airspeed — the U-Shaped Power Curve\n"
             "(reference build: fpv5 / 5″ tri-blade / 1806 / 4S-1500, no payload)",
             fontsize=13.5, fontweight="bold", pad=12)
ax.set_xlabel("Airspeed  V  (m/s)")
ax.set_ylabel("Power (W)")
ax.set_xlim(0, 20.6)
ax.set_ylim(0, max(Pcru.max(), Ppara.max()) * 1.18)
ax.grid(True, alpha=0.35, color=GRID)
ax.legend(loc="upper center", fontsize=10.6, framealpha=0.95)

ax.text(0.015, 0.03,
        (r"$F_D(V)=\frac{1}{2}\rho V^2 C_d A$,  $C_d{=}1.05$, $A{=}0.0095\,m^2$" "\n"
         r"$v_i(V)=\sqrt{\sqrt{(V^2/2)^2+v_h^4}-V^2/2}$,  $v_h{=}%.2f$ m/s" "\n"
         r"$T=m{\cdot}g=%.2f$ N  ($m{=}%.0f$ g)" % (math.sqrt(VH2), T, TOTAL_G)),
        transform=ax.transAxes, ha="left", va="bottom", fontsize=9.3,
        bbox=dict(boxstyle="round,pad=0.5", fc="#fbfaf5", ec=AMBER, lw=1.2))

fig.tight_layout()
out_path = "/Users/ajith/Desktop/vlgen/exp-mission-performance-dei/experiment/images/cruise_power_curve.png"
fig.savefig(out_path, dpi=150, bbox_inches="tight", facecolor=BG)
print("Saved:", out_path)
