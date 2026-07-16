#!/usr/bin/env python3
"""
Generates constellation_geometry_diagram.png for the navigation experiment
(exp-navigation-&-positioning-dei), referenced from theory.md Section 1
("GPS Constellation Geometry & Dilution of Precision").

Draws a polar sky-plot (elevation 90 deg at centre, horizon at rim, azimuth
0 deg / N pointing up, clockwise) of the simulator's default 8-satellite
"spread" preset, mirroring the sky-plot editor UI in
simulation/js/main.js (openSkyEditor / makePreset("spread", 8)).

All DOP numbers annotated are COMPUTED here from the exact same equations
as simulation/js/main.js (losVec / geometryMatrix / normalMatrix /
mat4Inverse / dopSolve), so the figure and theory.md Section 1's worked
example agree exactly:
  e        = [cos(el)sin(az), cos(el)cos(az), sin(el)]        (LOS unit vector, ENU)
  row_i    = [-e_E, -e_N, -e_U, 1]                              (geometry matrix row)
  Q        = (G^T G)^-1
  HDOP=sqrt(Q00+Q11)  VDOP=sqrt(Q22)  PDOP=sqrt(Q00+Q11+Q22)  GDOP=sqrt(Q00+Q11+Q22+Q33)
"""

import math
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Circle

D2R = math.pi / 180.0
R2D = 180.0 / math.pi

# ----------------------------------------------------------------------------
# 1. Reproduce main.js's makePreset("spread", 8) and the DOP solve exactly.
# ----------------------------------------------------------------------------

def make_preset_spread(n=8):
    sats = []
    for i in range(n):
        el = 32 + (i % 3) * 13 + (4 if i % 2 else -3)
        az = i * (360.0 / n) + (7 if i % 2 else -6)
        sats.append((az * D2R, el * D2R))
    return sats


def los_vec(az, el):
    return [math.cos(el) * math.sin(az), math.cos(el) * math.cos(az), math.sin(el)]


def geometry_matrix(sats):
    G = []
    for az, el in sats:
        e = los_vec(az, el)
        G.append([-e[0], -e[1], -e[2], 1.0])
    return G


def normal_matrix(Gm):
    M = [[0.0] * 4 for _ in range(4)]
    for i in range(4):
        for j in range(4):
            M[i][j] = sum(row[i] * row[j] for row in Gm)
    return M


def mat4_inverse(m):
    n = 4
    A = [row[:] for row in m]
    I = [[1.0 if i == j else 0.0 for j in range(4)] for i in range(4)]
    for col in range(n):
        piv = col
        for r in range(col + 1, n):
            if abs(A[r][col]) > abs(A[piv][col]):
                piv = r
        if abs(A[piv][col]) < 1e-9:
            return None
        if piv != col:
            A[piv], A[col] = A[col], A[piv]
            I[piv], I[col] = I[col], I[piv]
        pv = A[col][col]
        for j in range(n):
            A[col][j] /= pv
            I[col][j] /= pv
        for r in range(n):
            if r == col:
                continue
            f = A[r][col]
            if not f:
                continue
            for j in range(n):
                A[r][j] -= f * A[col][j]
                I[r][j] -= f * I[col][j]
    return I


def dop_solve(sats):
    if len(sats) < 4:
        return None
    Q = mat4_inverse(normal_matrix(geometry_matrix(sats)))
    if Q is None:
        return None
    q0, q1, q2, q3 = Q[0][0], Q[1][1], Q[2][2], Q[3][3]
    if not (q0 >= 0 and q1 >= 0 and q2 >= 0 and q3 >= 0):
        return None
    return {
        "hdop": math.sqrt(q0 + q1),
        "vdop": math.sqrt(q2),
        "pdop": math.sqrt(q0 + q1 + q2),
        "gdop": math.sqrt(q0 + q1 + q2 + q3),
    }


sats = make_preset_spread(8)
dop = dop_solve(sats)
UERE_NOMINAL = 3.0
cep = dop["hdop"] * UERE_NOMINAL

print("HDOP=%.4f VDOP=%.4f PDOP=%.4f GDOP=%.4f CEP(nominal)=%.3f m" %
      (dop["hdop"], dop["vdop"], dop["pdop"], dop["gdop"], cep))

# ----------------------------------------------------------------------------
# 2. Draw the sky-plot: elevation rings, azimuth spokes, satellites, LOS rays.
# ----------------------------------------------------------------------------

def sky_xy(az, el):
    """Polar sky-plot projection matching the sim's skyToXY: elevation 90 deg
    at centre (r=0), horizon (el=0) at the rim (r=1); az measured clockwise
    from North (up)."""
    r = 1.0 - (el * R2D) / 90.0
    x = r * math.sin(az)
    y = r * math.cos(az)
    return x, y


fig, (ax_sky, ax_info) = plt.subplots(1, 2, figsize=(14, 7.2),
                                       gridspec_kw={"width_ratios": [1.05, 0.85]})

# --- Sky-plot panel ---
ax_sky.set_xlim(-1.25, 1.25)
ax_sky.set_ylim(-1.25, 1.25)
ax_sky.set_aspect("equal")
ax_sky.axis("off")
ax_sky.set_title("Sky-plot — 8-satellite \"Spread\" preset", fontsize=14, fontweight="bold", pad=12)

# sky disc
ax_sky.add_patch(Circle((0, 0), 1.0, facecolor="#f4f7fb", edgecolor="#c8d2e0", lw=1.4, zorder=0))

# elevation rings at 0/30/60 deg
for el_deg in [0, 30, 60]:
    rr = 1.0 - el_deg / 90.0
    ax_sky.add_patch(Circle((0, 0), rr, facecolor="none", edgecolor="#a7b4c8", lw=0.9, zorder=1))
    if el_deg > 0:
        ax_sky.text(0, rr + 0.03, "%d°" % el_deg, ha="center", va="bottom",
                    fontsize=8.5, color="#7c8aa3")

# azimuth spokes every 30 deg + N/E/S/W labels
for a in range(0, 360, 30):
    x, y = sky_xy(a * D2R, 0)
    ax_sky.plot([0, x], [0, y], color="#e7edf4", lw=1, zorder=1)
for lab, a in [("N", 0), ("E", 90), ("S", 180), ("W", 270)]:
    x, y = sky_xy(a * D2R, -0.06)
    ax_sky.text(x * 1.14, y * 1.14, lab, ha="center", va="center",
                fontsize=11.5, color="#556077", fontweight="bold")

# LOS rays + satellites
for i, (az, el) in enumerate(sats):
    x, y = sky_xy(az, el)
    ax_sky.plot([0, x], [0, y], color="#1f3a93", lw=1.1, alpha=0.35, zorder=2)
    ax_sky.add_patch(Circle((x, y), 0.052, facecolor="#2f6fce", edgecolor="white", lw=1.6, zorder=4))
    ax_sky.text(x, y, str(i + 1), ha="center", va="center", fontsize=8.5,
                color="white", fontweight="bold", zorder=5)

# receiver at centre
ax_sky.add_patch(Circle((0, 0), 0.035, facecolor="#2e9e6b", edgecolor="white", lw=1.2, zorder=5))
ax_sky.text(0, -1.16, "receiver at centre · elevation 90° = zenith · horizon at rim",
            ha="center", va="top", fontsize=9, color="#7c8aa3", style="italic")

# --- Info / DOP panel ---
ax_info.axis("off")
ax_info.set_xlim(0, 1)
ax_info.set_ylim(0, 1)
ax_info.set_title("Geometry Matrix → DOP", fontsize=14, fontweight="bold", pad=12)

table_txt = "Sat   Az(°)   El(°)    e_E      e_N      e_U\n" + "─" * 46 + "\n"
for i, (az, el) in enumerate(sats):
    e = los_vec(az, el)
    table_txt += "%2d   %6.1f   %5.1f   %6.3f  %6.3f  %6.3f\n" % (
        i + 1, az * R2D, el * R2D, e[0], e[1], e[2])

ax_info.text(0.02, 0.97, table_txt, ha="left", va="top", fontsize=9.3,
             family="monospace", transform=ax_info.transAxes)

formula_txt = (
    r"$Q=(G^{T}G)^{-1}$" + "\n"
    r"$HDOP=\sqrt{Q_{00}+Q_{11}}$" + "     "
    r"$VDOP=\sqrt{Q_{22}}$" + "\n"
    r"$PDOP=\sqrt{Q_{00}+Q_{11}+Q_{22}}$" + "\n"
    r"$GDOP=\sqrt{Q_{00}+Q_{11}+Q_{22}+Q_{33}}$"
)
ax_info.text(0.02, 0.52, formula_txt, ha="left", va="top", fontsize=10.5,
             transform=ax_info.transAxes,
             bbox=dict(boxstyle="round,pad=0.4", facecolor="#f7f7f7", edgecolor="#1f3a93", lw=1.2))

result_txt = (
    "HDOP = %.2f   (pass: < 2.0)\n"
    "VDOP = %.2f   (warn: > 8.0)\n"
    "PDOP = %.2f\n"
    "GDOP = %.2f\n\n"
    "CEP = HDOP × UERE = %.2f × %.1f m = %.2f m\n"
    "(open-sky UERE, pass: CEP < 4 m)" % (
        dop["hdop"], dop["vdop"], dop["pdop"], dop["gdop"], dop["hdop"], UERE_NOMINAL, cep)
)
ax_info.text(0.02, 0.03, result_txt, ha="left", va="bottom", fontsize=11,
             family="monospace", transform=ax_info.transAxes, color="#1a6b3c", fontweight="bold",
             bbox=dict(boxstyle="round,pad=0.45", facecolor="#eefaf1", edgecolor="#2e9e6b", lw=1.3))

fig.suptitle("GPS Constellation Geometry — Sky-plot, Design Matrix, and Dilution of Precision",
             fontsize=15.5, fontweight="bold", y=1.01)
fig.tight_layout(rect=[0, 0, 1, 0.97])

out_path = "/Users/ajith/Desktop/vlgen/exp-navigation-&-positioning-dei/experiment/images/constellation_geometry_diagram.png"
fig.savefig(out_path, dpi=150, bbox_inches="tight")
print("Saved:", out_path)
