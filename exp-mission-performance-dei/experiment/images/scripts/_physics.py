#!/usr/bin/env python3
"""
Shared reference-build physics + house plotting style for the Mission
Performance capstone figures (exp-mission-performance-dei).

Every constant matches the same component spec.json files that
simulation/js/main.js reads for the reference build (fpv5 chassis, 5"
tri-blade props, 1806 motors, 4S/1500 pack, PiHawk, CM703), so all four
figures reproduce theory.md's worked examples exactly:
  cruise power min  V ~ 9.4 m/s, P ~ 26.2 W
  hover power       P_ind(0) ~ 33.5 W
  max-range speed   V ~ 13.5 m/s
"""
import math
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

# ---- house palette (simulation/css/main.css) ----
BG = "#ffffff"
INK = "#1e2a29"
INK2 = "#3c4a46"
MUTED = "#8b9a95"
GRID = "#dde4e1"
TEAL = "#1f3a93"
AMBER = "#c65d3b"
DANGER = "#a83232"
SLATE = "#4f6d9e"
GREEN = "#2e7d5b"


def apply_style():
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
DRY_G = m_chasis + m_prop + m_motor + m_esc + m_batt + m_ctrl + m_rx  # 529.2 g

DIA_IN = 5.0
D = DIA_IN * 0.0254
A_DISK = 4 * math.pi * (D / 2.0) ** 2          # 4-rotor disk area, m^2

CD = 1.05
A_FRONTAL = 0.0095                             # m^2, fpv5 chassis frontal area

# electrical-to-aerodynamic efficiency (theory.md Section 5/6)
ETA_TOTAL = 0.55
# 4S/1500 pack usable energy: cells * Vnom * Ah
E_BATT_WH = 4 * 3.7 * 1.5                       # = 22.2 Wh


def thrust(mass_g):
    return (mass_g / 1000.0) * G


def missionDrag(V):
    return 0.5 * RHO * V * V * CD * A_FRONTAL


def inducedVelocity(V, T):
    vh2 = T / (2 * RHO * A_DISK)
    half = V * V / 2.0
    return math.sqrt(math.sqrt(half * half + vh2 * vh2) - half)


def pInd(V, T):
    return T * inducedVelocity(V, T)


def pCruise(V, T):
    return missionDrag(V) * V + pInd(V, T)


def pHover(T):
    # V=0 limit: P_ind(0) = T^1.5 / sqrt(2 rho A_disk)
    return T ** 1.5 / math.sqrt(2 * RHO * A_DISK)
