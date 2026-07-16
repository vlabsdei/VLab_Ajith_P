#!/usr/bin/env python3
"""
Generates baro_altitude_error_diagram.png for the navigation experiment
(exp-navigation-&-positioning-dei), referenced from theory.md Section 3
("Barometric Altimetry & the ISA Atmosphere Model").

Plots 1-sigma barometric altitude error vs. true altitude (0-3000 m) for the
fine (MS5611-class) and coarse (BMP180-class) sensor grades, plus the
systematic temperature-inversion bias curve, all computed directly from the
same ISA lapse-rate equations and constants as simulation/js/main.js
(pressureAt / dhdP / sigmaP / baroError):
  P(h)      = P0*(1 - L*h/T0)^(1/k),        k = R*L/g
  dh/dP     = (T0*R)/(g*P0) * (P/P0)^(k-1)
  sigma_P(h)= sig0 * (1 + grow*h)
  sigma_alt = dh/dP * sigma_P(h)
  bias(h)   = (h/T0) * K_inv                (temperature-inversion systematic offset)
"""

import math
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

# ISA constants (main.js NAV object)
T0, L, R, g, P0 = 288.15, 0.0065, 287.0, 9.81, 101325.0
K = R * L / g  # isaExp()

GRADES = {
    "fine":   {"name": "MS5611 (fine)",   "sig0": 1.877, "grow": 0.0041, "color": "#2e9e6b"},
    "coarse": {"name": "BMP180 (coarse)", "sig0": 7.20,  "grow": 0.0060, "color": "#c0392b"},
}
INV_K = 6.0
PASS_LIMIT = 3.5  # m, peak-error pass threshold (fine sensor, no inversion)


def pressure_at(h):
    return P0 * (1 - L * h / T0) ** (1.0 / K)


def dhdp(P):
    return (T0 * R) / (g * P0) * (P / P0) ** (K - 1.0)


def sigma_p(grade, h):
    g_ = GRADES[grade]
    return g_["sig0"] * (1 + g_["grow"] * max(0.0, h))


def sigma_alt(grade, h):
    P = pressure_at(h)
    return abs(dhdp(P) * sigma_p(grade, h))


def inversion_bias(h):
    return (h / T0) * INV_K


hs = [i * 25.0 for i in range(0, 121)]  # 0..3000 m

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14.5, 6.8))

# --- Panel 1: sensor-noise error curves ---
for grade, spec in GRADES.items():
    ys = [sigma_alt(grade, h) for h in hs]
    ax1.plot(hs, ys, color=spec["color"], lw=2.4, label=spec["name"])

ax1.axhline(PASS_LIMIT, color="#7c8aa3", lw=1.4, linestyle="--",
            label="pass threshold (peak < %.1f m, fine grade)" % PASS_LIMIT)

for h_mark in (500, 3000):
    for grade, spec in GRADES.items():
        y = sigma_alt(grade, h_mark)
        ax1.plot([h_mark], [y], marker="o", color=spec["color"], ms=6, zorder=5)
        ax1.annotate("%.2f m" % y, (h_mark, y), textcoords="offset points",
                     xytext=(6, 6), fontsize=9, color=spec["color"], fontweight="bold")
    ax1.axvline(h_mark, color="#e5e5e5", lw=1, zorder=0)

ax1.set_xlabel("True altitude h (m)", fontsize=11)
ax1.set_ylabel(r"1$\sigma$ altitude error (m)", fontsize=11)
ax1.set_title("Barometric Noise vs. Altitude — Fine vs. Coarse Sensor", fontsize=13.5, fontweight="bold")
ax1.legend(loc="upper left", fontsize=9.3)
ax1.grid(alpha=0.25)

formula_txt = (
    r"$\dfrac{dh}{dP}=\dfrac{T_0 R}{g P_0}\left(\dfrac{P}{P_0}\right)^{k-1}$" + "   grows as P falls\n"
    r"$\sigma_P(h)=\sigma_0(1+a\,h)$"
)
ax1.text(0.02, 0.02, formula_txt, transform=ax1.transAxes, ha="left", va="bottom",
         fontsize=10, bbox=dict(boxstyle="round,pad=0.4", facecolor="#f7f7f7", edgecolor="#888", lw=1))

# --- Panel 2: temperature-inversion systematic bias ---
bias_ys = [inversion_bias(h) for h in hs]
ax2.plot(hs, bias_ys, color="#8e44ad", lw=2.4, label=r"inversion bias, $K_{inv}=6$")
fine_ys = [sigma_alt("fine", h) for h in hs]
ax2.plot(hs, fine_ys, color=GRADES["fine"]["color"], lw=1.8, linestyle=":",
         label="fine-sensor random noise (for scale)")

for h_mark in (500, 3000):
    y = inversion_bias(h_mark)
    ax2.plot([h_mark], [y], marker="o", color="#8e44ad", ms=6, zorder=5)
    ax2.annotate("%.1f m" % y, (h_mark, y), textcoords="offset points",
                 xytext=(6, 6), fontsize=9.5, color="#8e44ad", fontweight="bold")
    ax2.axvline(h_mark, color="#e5e5e5", lw=1, zorder=0)

ax2.set_xlabel("True altitude h (m)", fontsize=11)
ax2.set_ylabel("Systematic altitude bias (m)", fontsize=11)
ax2.set_title("Temperature-Inversion Bias — Systematic, Not Averaged Out", fontsize=13.5, fontweight="bold")
ax2.legend(loc="upper left", fontsize=9.3)
ax2.grid(alpha=0.25)

bias_formula = r"$\mathrm{bias}(h)=\dfrac{h}{T_0}\,K_{inv}$"
ax2.text(0.02, 0.86, bias_formula, transform=ax2.transAxes, ha="left", va="top",
         fontsize=12, bbox=dict(boxstyle="round,pad=0.4", facecolor="#f7f7f7", edgecolor="#8e44ad", lw=1.2))

fig.suptitle("ISA Barometric Altimetry — Sensor Noise Growth and Temperature-Inversion Bias",
             fontsize=15.5, fontweight="bold", y=1.02)
fig.tight_layout(rect=[0, 0, 1, 0.96])

out_path = "/Users/ajith/Desktop/vlgen/exp-navigation-&-positioning-dei/experiment/images/baro_altitude_error_diagram.png"
fig.savefig(out_path, dpi=150, bbox_inches="tight")
print("Saved:", out_path)
for grade in GRADES:
    print(grade, "500m:", sigma_alt(grade, 500), "3000m:", sigma_alt(grade, 3000))
print("inversion bias 500m:", inversion_bias(500), "3000m:", inversion_bias(3000))
