"""
Generator for: exp-flight-performance-dei/experiment/images/twr_lift_diagram.png

Accuracy basis (theory.md Section 1-2 + db.json twr + simulation/js/main.js Calc.twr):
  Hover force balance (theory.md S1):
        F_thrust = N * T_max   >   W = m * g
  Thrust-to-weight ratio (theory.md S2, Calc.twr; grams-force, g cancels):
        TWR = N * T_max / m_total
  Reference 5" build (db.json 2204_2300, default ; empty mass from Exp 2):
        N = 4 motors ,  T_max = 620 g/motor ,  m = 500 g (empty)
        total thrust = 4 x 620          = 2480 g
        TWR = 2480 / 500                = 4.96   -> "freestyle" class
        2480 g > 500 g  =>  thrust exceeds weight  =>  the craft LIFTS
  This is a free-body / schematic figure (no computed curve): an X-frame quad
  (two arms, four motors) with four upward thrust vectors (T_max each) versus a
  single downward weight vector (W = m g) and an optional hanging payload box.

Run:  python twr_lift_diagram.py
"""
import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patheffects as pe
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch, Circle, Ellipse

OUT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(OUT_DIR, "twr_lift_diagram.png")

# ---- house palette (simulation/css/main.css :root) ----
BG, ACCENT, DARK = "#ffffff", "#ffbf00", "#111827"
TXT2, TXT3, GRID = "#374151", "#6b7280", "#e5e7eb"
SURF, SURF2 = "#f9fafb", "#f3f4f6"
SUCCESS, WARNING, DANGER, BLUE = "#10b981", "#f59e0b", "#ef4444", "#2563eb"

plt.rcParams.update({
    "figure.dpi": 150, "savefig.dpi": 150,
    "font.family": "sans-serif",
    "font.sans-serif": ["Inter", "Segoe UI", "DejaVu Sans", "Arial"],
    "font.size": 11, "text.color": DARK,
    "axes.facecolor": BG, "figure.facecolor": BG,
})

# ---- governing constants (db.json + theory.md worked example) ----
N = 4                      # motor_count (quad)
T_MAX = 620.0              # g/motor   (2204_2300 max_thrust_g, default combo)
M_EMPTY = 500.0            # g         (empty mass inherited from Experiment 2)
TOTAL_THRUST = N * T_MAX   # 2480 g
TWR = TOTAL_THRUST / M_EMPTY   # 4.96

fig, ax = plt.subplots(figsize=(13.2, 8.2))
ax.set_xlim(0, 14)
ax.set_ylim(0, 9)
ax.set_aspect("equal")
ax.axis("off")
HALO = [pe.withStroke(linewidth=4.0, foreground=BG)]


def varrow(x, y0, y1, color, lw=3.0, ms=22, z=6):
    ax.add_patch(FancyArrowPatch((x, y0), (x, y1), arrowstyle="-|>",
                 mutation_scale=ms, lw=lw, color=color, zorder=z,
                 shrinkA=0, shrinkB=0))


def line(p0, p1, color, lw=2.0, z=4, ls="-"):
    ax.plot([p0[0], p1[0]], [p0[1], p1[1]], color=color, lw=lw, ls=ls,
            solid_capstyle="round", zorder=z)


# ===================================================================
# 1. Quad airframe: X-frame (two crossed arms, four motors)
#    Front pair drawn lower & wider, back pair higher & inboard so the
#    four thrust columns sit at four distinct x -> no arrow overlap.
# ===================================================================
FL = np.array([2.0, 4.0]);  FR = np.array([8.0, 4.0])     # front-left / front-right
BL = np.array([3.35, 5.25]); BR = np.array([6.65, 5.25])  # back-left / back-right
MOTORS = [("FL", FL), ("FR", FR), ("BL", BL), ("BR", BR)]


def seg_intersect(p1, p2, p3, p4):
    """Intersection of segment p1p2 and p3p4 (the two X arms)."""
    a = np.array([[p2[0] - p1[0], -(p4[0] - p3[0])],
                  [p2[1] - p1[1], -(p4[1] - p3[1])]])
    b = np.array([p3[0] - p1[0], p3[1] - p1[1]])
    t = np.linalg.solve(a, b)
    return p1 + t[0] * (p2 - p1)


HUB = seg_intersect(FL, BR, FR, BL)   # arms FL-BR and FR-BL cross at the hub

# two arms (the X)
line(FL, BR, DARK, lw=7, z=3)
line(FR, BL, DARK, lw=7, z=3)

# motor nacelles + rotor disks + upward thrust vectors
THRUST_LEN = 1.75
for name, p in MOTORS:
    # rotor disk (perspective ellipse) and motor hub
    ax.add_patch(Ellipse((p[0], p[1] + 0.12), 1.18, 0.34, fc="#dbe3ee",
                 ec=DARK, lw=1.6, zorder=4, alpha=0.95))
    ax.add_patch(Circle((p[0], p[1]), 0.17, fc="#1f2937", ec=DARK, lw=1.4,
                 zorder=5))
    # thrust vector (accent), all equal length = equal T_max
    y0 = p[1] + 0.18
    varrow(p[0], y0, y0 + THRUST_LEN, ACCENT, lw=4.5, ms=26, z=6)
    ax.text(p[0], y0 + THRUST_LEN + 0.10, r"$T_{max}$", ha="center",
            va="bottom", fontsize=12, fontweight="bold", color="#9a7d00",
            path_effects=HALO)
    ax.text(p[0], y0 + THRUST_LEN + 0.52, "620 g", ha="center", va="bottom",
            fontsize=9.5, color=TXT2, path_effects=HALO)

# central body
ax.add_patch(FancyBboxPatch((HUB[0] - 0.55, HUB[1] - 0.34), 1.1, 0.68,
             boxstyle="round,pad=0.02,rounding_size=0.1", fc="#374151",
             ec=DARK, lw=1.6, zorder=5))
ax.text(HUB[0], HUB[1], "FC", ha="center", va="center", fontsize=9,
        fontweight="bold", color="#ffffff", zorder=6)

# NOTE: the total-thrust sum (2480 g) is already stated in the green status
# banner directly above and the right-hand formula panel, so no third label
# is drawn here -- the gap between the motor arrows and the banner is too
# tight for another line of text without the two overlapping.

# ===================================================================
# 2. Weight vector (down) at the CG + optional payload box hanging below
# ===================================================================
wy0 = HUB[1] - 0.34
varrow(HUB[0], wy0, wy0 - 1.55, DANGER, lw=4.5, ms=26, z=6)
ax.text(HUB[0] + 0.28, wy0 - 0.85, r"$W = m\,g$", ha="left", va="center",
        fontsize=12.5, fontweight="bold", color=DANGER, path_effects=HALO)
ax.text(HUB[0] + 0.28, wy0 - 1.28, "500 g (empty)", ha="left", va="center",
        fontsize=9.5, color="#b91c1c", path_effects=HALO)

# CG marker
ax.add_patch(Circle((HUB[0], wy0 - 0.02), 0.07, fc=DANGER, ec="#7f1d1d",
             lw=1.2, zorder=7))

# optional payload box (dashed = optional), hung from the CG by a tether
pbox_cy = wy0 - 2.45
line((HUB[0], wy0 - 1.55), (HUB[0], pbox_cy + 0.36), TXT3, lw=1.5, z=4,
     ls=(0, (4, 3)))
ax.add_patch(FancyBboxPatch((HUB[0] - 0.62, pbox_cy - 0.36), 1.24, 0.72,
             boxstyle="round,pad=0.02,rounding_size=0.06", fc=SURF2,
             ec=TXT3, lw=1.6, ls="--", zorder=5))
ax.text(HUB[0], pbox_cy + 0.08, "payload", ha="center", va="center",
        fontsize=9.5, fontweight="bold", color=TXT2, zorder=6)
ax.text(HUB[0], pbox_cy - 0.16, "(optional)", ha="center", va="center",
        fontsize=8, color=TXT3, zorder=6)
ax.text(HUB[0], pbox_cy - 0.62, r"adds to $m$  $\Rightarrow$  TWR $\downarrow$ (Sec. 5)",
        ha="center", va="top", fontsize=8.4, color=TXT3)

# ===================================================================
# 3. Status banner: thrust vs weight -> lifts
# ===================================================================
ax.add_patch(FancyBboxPatch((0.45, 8.16), 8.7, 0.66,
             boxstyle="round,pad=0.02,rounding_size=0.12", fc="#ecfdf5",
             ec=SUCCESS, lw=2.0, zorder=8))
ax.text(4.8, 8.49,
        "THRUST 2480 g   >   WEIGHT 500 g      =>      the craft LIFTS",
        ha="center", va="center", fontsize=12.5, fontweight="bold",
        color="#065f46", zorder=9)

# ===================================================================
# 4. Right-hand annotation panel: the TWR computation
# ===================================================================
px0, py0, px1, py1 = 9.7, 2.35, 13.75, 7.55
ax.add_patch(FancyBboxPatch((px0, py0), px1 - px0, py1 - py0,
             boxstyle="round,pad=0.03,rounding_size=0.12", fc=SURF,
             ec="#cbd5e1", lw=1.8, zorder=8))
pcx = (px0 + px1) / 2
ax.text(pcx, py1 - 0.32, "Hover Force Balance", ha="center", va="center",
        fontsize=12.5, fontweight="bold", color=DARK, zorder=9)
ax.plot([px0 + 0.3, px1 - 0.3], [py1 - 0.62, py1 - 0.62], color="#cbd5e1",
        lw=1.2, zorder=9)

ax.text(pcx, py1 - 1.06, r"$F_{thrust} = N\cdot T_{max} > W = m\,g$",
        ha="center", va="center", fontsize=12, color=TXT2, zorder=9)

# the headline TWR equation (accent box)
ax.add_patch(FancyBboxPatch((px0 + 0.35, 4.62), (px1 - px0) - 0.7, 1.5,
             boxstyle="round,pad=0.03,rounding_size=0.1", fc="#fffbeb",
             ec=ACCENT, lw=2.0, zorder=9))
ax.text(pcx, 5.74, r"$TWR = \dfrac{N\cdot T_{max}}{m_{total}}$", ha="center",
        va="center", fontsize=14, fontweight="bold", color=DARK, zorder=10)
ax.text(pcx, 5.0, r"$= \dfrac{4\times620}{500} = \dfrac{2480}{500}$",
        ha="center", va="center", fontsize=12.5, color=TXT2, zorder=10)

ax.text(pcx, 4.18, r"$TWR = \mathbf{4.96}$", ha="center", va="center",
        fontsize=16, fontweight="bold", color="#065f46", zorder=9)

# quick facts
facts = [
    (r"motors $N$", "4"),
    (r"thrust/motor $T_{max}$", "620 g"),
    (r"total thrust $N\,T_{max}$", "2480 g"),
    (r"empty mass $m$", "500 g"),
    (r"class (TWR 4.96)", "freestyle"),
]
fy = 3.66
for lab, val in facts:
    ax.text(px0 + 0.35, fy, lab, ha="left", va="center", fontsize=9.4,
            color=TXT3, zorder=9)
    ax.text(px1 - 0.35, fy, val, ha="right", va="center", fontsize=9.6,
            fontweight="bold", color=DARK, zorder=9)
    fy -= 0.31

ax.set_title("Quadcopter Hover Free-Body Diagram  —  Thrust-to-Weight Ratio",
             fontsize=14.5, fontweight="bold", pad=12)

fig.tight_layout()
fig.savefig(OUT, dpi=150, bbox_inches="tight", facecolor=BG)
print("WROTE", OUT)
print(f"  N={N}, T_max={T_MAX} g, m_empty={M_EMPTY} g")
print(f"  total thrust = {TOTAL_THRUST:.0f} g ;  TWR = {TWR:.4f}")
assert abs(TOTAL_THRUST - 2480.0) < 1e-9
assert abs(TWR - 4.96) < 1e-9
print("  VERIFIED: total thrust 2480 g, TWR = 4.96 (thrust > weight -> lifts)")
