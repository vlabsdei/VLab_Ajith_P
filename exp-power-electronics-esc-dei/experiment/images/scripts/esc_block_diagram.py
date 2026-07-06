"""
Generator for: exp-power-electronics-esc-dei/experiment/images/esc_block_diagram.png

Accuracy basis (theory.md Section 5 + procedure Stage 2 + simulation/js/main.js):
  ESC signal + power topology (block / schematic):
    Flight Controller --PWM signal--> ESC
    Inside ESC: signal input -> MCU / gate-driver -> three-phase MOSFET bridge
                (6 MOSFETs = 3 half-bridges, high-side + low-side per phase)
    Battery (LiPo) --DC bus--> ESC power rails (DC+, DC-)
    ESC --3 phase wires (A, B, C)--> BLDC motor
  Conduction-loss point (theory.md S5, Calc.escDissipation):
        P_ESC = I^2 * R_DS(on)        (R_DS(on) ~ 3 mOhm for a 30 A ESC, db.json esc_30a)
  This is a schematic: no computed curves, but the bridge topology (3 legs, 6
  MOSFETs, DC rails, phase taps) and signal/power flow are drawn exactly as the
  ESCModel 3D build and the theory describe.

Run:  python esc_block_diagram.py
"""
import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patheffects as pe
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch, Circle, Rectangle

OUT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(OUT_DIR, "esc_block_diagram.png")

# ---- house palette (simulation/css/main.css :root) ----
BG, ACCENT, DARK = "#ffffff", "#ffbf00", "#111827"
TXT2, TXT3, GRID = "#374151", "#6b7280", "#e5e7eb"
SURF, SURF2 = "#f9fafb", "#f3f4f6"
SUCCESS, WARNING, DANGER, BLUE = "#10b981", "#f59e0b", "#ef4444", "#2563eb"
GREEN_SIG = "#22c55e"

plt.rcParams.update({
    "figure.dpi": 150, "savefig.dpi": 150,
    "font.family": "sans-serif",
    "font.sans-serif": ["Inter", "Segoe UI", "DejaVu Sans", "Arial"],
    "font.size": 11, "text.color": DARK,
    "axes.facecolor": BG, "figure.facecolor": BG,
})

fig, ax = plt.subplots(figsize=(14.2, 8.0))
ax.set_xlim(0, 16)
ax.set_ylim(0, 9)
ax.set_aspect("equal")
ax.axis("off")
HALO = [pe.withStroke(linewidth=4.5, foreground=BG)]


def block(x0, y0, x1, y1, title, sub=None, fc=SURF, ec=DARK, lw=1.8,
          fs=11.5, tcol=DARK, ty=None):
    ax.add_patch(FancyBboxPatch((x0, y0), x1 - x0, y1 - y0,
                 boxstyle="round,pad=0.02,rounding_size=0.14",
                 fc=fc, ec=ec, lw=lw, zorder=3))
    cx = (x0 + x1) / 2
    cy = (y0 + y1) / 2 if ty is None else ty
    ax.text(cx, cy, title, ha="center", va="center", fontsize=fs,
            fontweight="bold", color=tcol, zorder=5)
    if sub:
        ax.text(cx, cy - 0.42, sub, ha="center", va="center", fontsize=8.6,
                color=TXT3, zorder=5)
    return cx, cy


def wire(pts, color, lw=2.0, halo=False, z=4, ls="-"):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    ax.plot(xs, ys, color=color, lw=lw, ls=ls, solid_capstyle="round",
            solid_joinstyle="round", zorder=z,
            path_effects=HALO if halo else None)


def arrow(p0, p1, color=DARK, lw=2.0, ms=20, z=6):
    ax.add_patch(FancyArrowPatch(p0, p1, arrowstyle="-|>", mutation_scale=ms,
                 lw=lw, color=color, zorder=z, shrinkA=0, shrinkB=0))


def node_dot(x, y, color=DARK, r=0.055):
    ax.add_patch(Circle((x, y), r, fc=color, ec=color, zorder=8))


# ===================================================================
# 1. Flight Controller (top-left) and Battery (bottom-left)
# ===================================================================
fc_cx, fc_cy = block(0.5, 6.7, 3.05, 8.35, "Flight\nController", "(autopilot MCU)",
                     fc="#eef2f7", ec=DARK, ty=7.72)
bat_cx, bat_cy = block(0.5, 0.65, 3.05, 2.35, "Battery (LiPo)", "4S - 14.8 V",
                       fc="#fff7e6", ec="#b45309", tcol="#7a4a06", ty=1.72)

# ===================================================================
# 2. ESC outer enclosure
# ===================================================================
ax.add_patch(FancyBboxPatch((3.95, 0.45), 7.8, 8.05,
             boxstyle="round,pad=0.02,rounding_size=0.18",
             fc="#fcfcfd", ec=DARK, lw=2.4, zorder=2))
ax.text(7.85, 8.18, "Electronic Speed Controller (ESC)", ha="center",
        va="center", fontsize=12.5, fontweight="bold", color=DARK, zorder=5)
ax.text(7.85, 7.83, "30 A BLHeli_32", ha="center", va="center", fontsize=8.8,
        color=TXT3, zorder=5)

# --- signal input pad (left edge, upper) ---
sig_pad = (3.95, 7.35)
node_dot(*sig_pad, color=GREEN_SIG, r=0.07)
ax.text(4.12, 7.62, "signal in", ha="left", va="bottom", fontsize=8.4,
        color=TXT2)

# --- MCU / gate-driver block ---
mcu_x0, mcu_y0, mcu_x1, mcu_y1 = 4.65, 6.35, 6.75, 7.85
block(mcu_x0, mcu_y0, mcu_x1, mcu_y1, "MCU /\ngate driver",
      fc=SURF2, ec=DARK, fs=10.5, ty=7.25)
ax.text((mcu_x0 + mcu_x1) / 2, 6.6, "decode + commutate", ha="center",
        va="center", fontsize=7.8, color=TXT3, zorder=5)

# --- DC bus input pads (left edge, lower) ---
vplus_pad = (3.95, 2.15)
gnd_pad = (3.95, 1.35)
node_dot(*vplus_pad, color=DANGER, r=0.07)
node_dot(*gnd_pad, color=DARK, r=0.07)
ax.text(4.12, 2.32, "V+", ha="left", va="bottom", fontsize=8.6, color=DANGER,
        fontweight="bold")
ax.text(4.12, 1.12, "GND", ha="left", va="top", fontsize=8.6, color=DARK,
        fontweight="bold")

# ===================================================================
# 3. Three-phase MOSFET bridge (3 half-bridges, 6 MOSFETs)
# ===================================================================
bx0, by0, bx1, by1 = 6.9, 1.55, 11.0, 5.55
ax.add_patch(FancyBboxPatch((bx0, by0), bx1 - bx0, by1 - by0,
             boxstyle="round,pad=0.02,rounding_size=0.12",
             fc="#ffffff", ec="#94a3b8", lw=1.6, ls="--", zorder=2))
ax.text((bx0 + bx1) / 2, by1 - 0.02, "3-phase MOSFET bridge", ha="center",
        va="bottom", fontsize=10, fontweight="bold", color=TXT2, zorder=5)
ax.text((bx0 + bx1) / 2, by0 + 0.02, "3 half-bridges  -  6 MOSFETs", ha="center",
        va="top", fontsize=8.2, color=TXT3, zorder=5)

DCP_Y = 5.05          # DC+ rail
DCN_Y = 2.0           # DC- rail
legs_x = [7.6, 8.78, 9.96]
phase_labels = ["A", "B", "C"]
phase_cols = [DANGER, DARK, BLUE]
HS_CY, LS_CY = 4.25, 2.78
MW, MH = 0.66, 0.6     # MOSFET box half-extents -> full 0.66x0.6? use as half
node_y = 3.5
hs_ids = ["Q1", "Q3", "Q5"]
ls_ids = ["Q2", "Q4", "Q6"]

# DC rails
wire([(bx0 + 0.12, DCP_Y), (bx1 - 0.12, DCP_Y)], DANGER, lw=2.6, z=4)
wire([(bx0 + 0.12, DCN_Y), (bx1 - 0.12, DCN_Y)], DARK, lw=2.6, z=4)
ax.text(bx1 - 0.16, DCP_Y + 0.12, "DC+ rail", ha="right", va="bottom",
        fontsize=8.4, color=DANGER, fontweight="bold")
ax.text(bx1 - 0.16, DCN_Y - 0.12, "DC- rail", ha="right", va="top",
        fontsize=8.4, color=DARK, fontweight="bold")


def mosfet(cx, cy, qid, role):
    """Compact labelled MOSFET box with a small N-channel glyph."""
    hw, hh = 0.34, 0.32
    ax.add_patch(FancyBboxPatch((cx - hw, cy - hh), 2 * hw, 2 * hh,
                 boxstyle="round,pad=0.01,rounding_size=0.05",
                 fc=SURF2, ec=DARK, lw=1.4, zorder=6))
    # tiny glyph: gate bar + channel + body-diode hint
    gx = cx - 0.13
    ax.plot([gx, gx], [cy - 0.16, cy + 0.16], color=DARK, lw=1.6, zorder=7)   # gate bar
    ax.plot([cx - 0.24, gx], [cy, cy], color=DARK, lw=1.2, zorder=7)          # gate lead
    chx = cx + 0.02
    ax.plot([chx, chx], [cy - 0.18, cy + 0.18], color=DARK, lw=2.4, zorder=7)  # channel
    ax.plot([chx, cx + 0.2], [cy + 0.18, cy + 0.18], color=DARK, lw=1.2, zorder=7)
    ax.plot([chx, cx + 0.2], [cy - 0.18, cy - 0.18], color=DARK, lw=1.2, zorder=7)
    ax.text(cx + 0.34, cy, qid, ha="left", va="center", fontsize=7.0,
            color=TXT2, zorder=7)
    ax.text(cx - 0.30, cy + 0.34, role, ha="left", va="bottom", fontsize=6.6,
            color=TXT3, zorder=7)


for xleg, plab, pcol, hsid, lsid in zip(legs_x, phase_labels, phase_cols,
                                        hs_ids, ls_ids):
    # connectors: DC+ -> HS -> node -> LS -> DC-
    wire([(xleg, DCP_Y), (xleg, HS_CY + 0.32)], DARK, lw=1.8, z=4)
    mosfet(xleg, HS_CY, hsid, "HS")
    wire([(xleg, HS_CY - 0.32), (xleg, node_y)], DARK, lw=1.8, z=4)
    mosfet(xleg, LS_CY, lsid, "LS")
    wire([(xleg, node_y), (xleg, LS_CY + 0.32)], DARK, lw=1.8, z=4)
    wire([(xleg, LS_CY - 0.32), (xleg, DCN_Y)], DARK, lw=1.8, z=4)
    node_dot(xleg, node_y, color=pcol, r=0.06)
    ax.text(xleg, node_y - 0.20, plab, ha="center", va="top", fontsize=8.6,
            color=pcol, fontweight="bold")

# ===================================================================
# 4. BLDC motor (right)
# ===================================================================
mot_c = (13.9, 3.5)
ax.add_patch(Circle(mot_c, 1.28, fc="#eef2f7", ec=DARK, lw=2.2, zorder=3))
ax.text(mot_c[0], mot_c[1] + 0.18, "BLDC", ha="center", va="center",
        fontsize=12.5, fontweight="bold", color=DARK, zorder=5)
ax.text(mot_c[0], mot_c[1] - 0.26, r"motor  $3\sim$", ha="center", va="center",
        fontsize=10, color=TXT2, zorder=5)
# three winding hints
for k in range(3):
    ang = np.pi / 2 + k * 2 * np.pi / 3
    ax.plot([mot_c[0], mot_c[0] + 0.7 * np.cos(ang)],
            [mot_c[1], mot_c[1] + 0.7 * np.sin(ang)], color=TXT3, lw=1.4,
            zorder=4)
# motor terminals (left arc), monotonic with bridge phase lanes
mot_terms = [(12.78, 4.18), (12.66, 3.5), (12.78, 2.82)]
for (tx, ty_), pcol, plab in zip(mot_terms, phase_cols, phase_labels):
    node_dot(tx, ty_, color=pcol, r=0.06)

# ===================================================================
# 5. Phase output wires  (node -> lane -> motor terminal), with white halo
# ===================================================================
lanes = [3.82, 3.5, 3.18]      # monotonic, sit in the HS/LS gap
for xleg, lane, (tx, ty_), pcol in zip(legs_x, lanes, mot_terms, phase_cols):
    wire([(xleg, node_y), (xleg, lane), (12.2, lane), (tx, ty_)],
         pcol, lw=2.4, halo=True, z=7)
ax.text(12.05, 4.35, "phase A / B / C", ha="center", va="bottom", fontsize=8.6,
        color=TXT2)
# phase current annotation on phase A lane
ax.text(11.35, 3.97, r"$I$", ha="center", va="bottom", fontsize=11,
        color=DANGER, fontweight="bold")

# ===================================================================
# 6. Signal & power flow arrows
# ===================================================================
# FC -> ESC signal input (PWM)
arrow((fc_cx + 1.55, 7.5), (sig_pad[0] - 0.02, 7.4), color=GREEN_SIG, lw=2.4)
ax.text(3.5, 7.95, "PWM signal", ha="center", va="bottom", fontsize=9.2,
        color="#15803d", fontweight="bold")
ax.text(3.5, 6.95, "1-2 ms pulse\n50-400 Hz", ha="center", va="top",
        fontsize=7.8, color=TXT3)
# tiny PWM glyph on the signal arrow
gx0 = 3.18
gpw = [(gx0, 7.5), (gx0 + 0.08, 7.5), (gx0 + 0.08, 7.66), (gx0 + 0.2, 7.66),
       (gx0 + 0.2, 7.5), (gx0 + 0.28, 7.5)]
wire(gpw, "#15803d", lw=1.4, z=7)

# signal pad -> MCU
arrow((sig_pad[0] + 0.12, 7.4), (mcu_x0 - 0.02, 7.2), color=DARK, lw=1.8, ms=16)

# MCU -> bridge (gate drive)
arrow((mcu_cx_x := (mcu_x0 + mcu_x1) / 2, mcu_y0 - 0.02),
      (8.0, by1 + 0.18), color=ACCENT, lw=2.6, ms=20)
ax.text(6.0, 5.95, "gate drive (6x)", ha="left", va="center", fontsize=8.8,
        color="#9a7d00", fontweight="bold")

# Battery -> ESC DC bus (thick), then split into V+ / GND rails
arrow((bat_cx + 1.55, 1.7), (vplus_pad[0] - 0.02, 1.78), color="#7a4a06",
      lw=2.6, ms=20)
ax.text(3.5, 2.62, "DC bus", ha="center", va="bottom", fontsize=9.2,
        color="#7a4a06", fontweight="bold")
ax.text(3.5, 0.95, r"$V_{batt},\ I_{dc}$", ha="center", va="top", fontsize=8.2,
        color=TXT3)
# V+ pad -> DC+ rail (red polyline up and over)
wire([vplus_pad, (6.5, 2.15), (6.5, DCP_Y), (bx0 + 0.12, DCP_Y)], DANGER,
     lw=2.4, z=4)
# GND pad -> DC- rail (dark polyline)
wire([gnd_pad, (6.7, 1.35), (6.7, DCN_Y), (bx0 + 0.12, DCN_Y)], DARK,
     lw=2.4, z=4)

# ===================================================================
# 7. Conduction-loss callout  P = I^2 * R_DS(on)
# ===================================================================
ax.add_patch(FancyBboxPatch((8.7, 6.05), 3.05, 1.15,
             boxstyle="round,pad=0.04,rounding_size=0.1",
             fc="#fffbeb", ec=ACCENT, lw=2.0, zorder=9))
ax.text(10.22, 6.78, r"$P_{ESC} = I^{2} \cdot R_{DS(on)}$", ha="center",
        va="center", fontsize=12.5, fontweight="bold", color=DARK, zorder=10)
ax.text(10.22, 6.32, r"conduction loss   ($R_{DS(on)}\approx 3\,m\Omega$)",
        ha="center", va="center", fontsize=8.4, color=TXT2, zorder=10)
# leader from callout to a high-side MOSFET
ax.add_patch(FancyArrowPatch((9.4, 6.05), (legs_x[2], HS_CY + 0.34),
             arrowstyle="-|>", mutation_scale=15, lw=1.6, color="#9a7d00",
             ls="--", zorder=9, shrinkA=2, shrinkB=2))

ax.set_title("ESC Signal + Power Block Diagram  (FC -> ESC -> BLDC motor)",
             fontsize=14.5, fontweight="bold", pad=10)
fig.tight_layout()
fig.savefig(OUT, dpi=150, bbox_inches="tight", facecolor=BG)
print("WROTE", OUT)
print("  topology: FC --PWM--> ESC[signal->MCU/gate-driver->3-phase bridge"
      " (6 MOSFETs)] ; Battery --DC bus--> rails ; ESC --A/B/C--> BLDC motor")
print("  conduction-loss label: P_ESC = I^2 * R_DS(on), R_DS(on) ~ 3 mOhm (esc_30a)")
