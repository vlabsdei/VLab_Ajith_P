"""
Generator for: exp-flight-control-system-dei/experiment/images/pid_control_loop.png

Accuracy basis (theory.md Sections 1-2 + simulation/js/main.js Calc):
  - Plant (theory.md S1): tau = J*theta_ddot  =>  theta(s)/tau(s) = 1/(J s^2)
        a DOUBLE INTEGRATOR (two poles at the origin -> open-loop unstable).
  - Controller (theory.md S2, main.js): C(s) = Kp + Ki/s + Kd*s
        * Proportional  Kp     - present error (the restoring spring)
        * Integral      Ki/s   - accumulated error (nulls steady offset)
        * Derivative    Kd*s   - rate of error (electronic damping)
  - Error definition (theory.md S2):  e = theta_cmd - theta   (unity feedback)
  - Disturbance torque (theory.md S4): Td = m*g*d enters at the plant input,
        summed with the controller torque BEFORE the plant.
  This is a SCHEMATIC (block diagram): correct topology, summing-junction signs,
  parallel P/I/D structure, the disturbance injection point, and the unity
  feedback path are drawn exactly as theory.md S1-S4 describe. No curves.

Run:  python pid_control_loop.py
"""
import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patheffects as pe
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch, Circle

OUT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(OUT_DIR, "pid_control_loop.png")

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

fig, ax = plt.subplots(figsize=(14.4, 7.2))
ax.set_xlim(0, 16)
ax.set_ylim(0, 8)
ax.set_aspect("equal")
ax.axis("off")
HALO = [pe.withStroke(linewidth=4.0, foreground=BG)]

Y = 5.6   # main forward-path height


def block(x0, y0, x1, y1, fc=SURF, ec=DARK, lw=1.9, ls="-", z=3, rounding=0.12):
    ax.add_patch(FancyBboxPatch(
        (x0, y0), x1 - x0, y1 - y0,
        boxstyle=f"round,pad=0.02,rounding_size={rounding}",
        fc=fc, ec=ec, lw=lw, ls=ls, zorder=z))


def wire(pts, color=DARK, lw=2.0, halo=False, z=4, ls="-"):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    ax.plot(xs, ys, color=color, lw=lw, ls=ls, solid_capstyle="round",
            solid_joinstyle="round", zorder=z,
            path_effects=HALO if halo else None)


def arrow(p0, p1, color=DARK, lw=2.2, ms=18, z=6, ls="-"):
    ax.add_patch(FancyArrowPatch(p0, p1, arrowstyle="-|>", mutation_scale=ms,
                 lw=lw, color=color, zorder=z, shrinkA=0, shrinkB=0,
                 linestyle=ls))


def node_dot(x, y, color=DARK, r=0.06):
    ax.add_patch(Circle((x, y), r, fc=color, ec=color, zorder=8))


def summing_junction(cx, cy, r=0.36):
    ax.add_patch(Circle((cx, cy), r, fc="#ffffff", ec=DARK, lw=2.0, zorder=5))
    # cross-hair
    ax.plot([cx - r * 0.62, cx + r * 0.62], [cy, cy], color=DARK, lw=1.1, zorder=6)
    ax.plot([cx, cx], [cy - r * 0.62, cy + r * 0.62], color=DARK, lw=1.1, zorder=6)
    return cx, cy


# ===================================================================
# 1. Command input  ->  summing junction S1  (error e = theta_cmd - theta)
# ===================================================================
s1x, s1y = summing_junction(2.35, Y)
arrow((0.45, Y), (s1x - 0.40, Y), color=DARK, lw=2.2)
ax.text(0.45, Y + 0.34, r"$\theta_{cmd}$", ha="left", va="bottom",
        fontsize=14, fontweight="bold", color=DARK)
ax.text(0.45, Y - 0.30, "roll setpoint", ha="left", va="top", fontsize=8.6,
        color=TXT3)
# + sign (command) on the upper-left of S1, - sign (feedback) on the lower side
ax.text(s1x - 0.52, s1y + 0.30, "+", ha="center", va="center", fontsize=15,
        fontweight="bold", color=SUCCESS)
ax.text(s1x - 0.30, s1y - 0.52, r"$-$", ha="center", va="center", fontsize=16,
        fontweight="bold", color=DANGER)

# ===================================================================
# 2. PID controller block  C(s) = Kp + Ki/s + Kd s  (parallel P / I / D)
# ===================================================================
px0, px1 = 3.55, 9.05
py0, py1 = 2.95, 8.05
block(px0, py0, px1, py1, fc="#fffdf5", ec=ACCENT, lw=2.6, rounding=0.18, z=2)
ax.text((px0 + px1) / 2, py1 - 0.30, "PID Controller", ha="center", va="center",
        fontsize=13, fontweight="bold", color=DARK, zorder=5)
ax.text((px0 + px1) / 2, py1 - 0.74,
        r"$C(s)=K_p+\dfrac{K_i}{s}+K_d\,s$", ha="center", va="center",
        fontsize=12.5, color=TXT2, zorder=5)

# error arrow S1 -> PID
arrow((s1x + 0.40, Y), (px0 - 0.02, Y), color=DARK, lw=2.2)
ax.text((s1x + 0.40 + px0) / 2, Y + 0.30, r"$e=\theta_{cmd}-\theta$",
        ha="center", va="bottom", fontsize=11, color=DARK, fontweight="bold")

# internal split node + three parallel term blocks
split_x = 4.05
node_dot(split_x, Y, color=DARK, r=0.07)
term_x0, term_x1 = 4.85, 7.15
P_y, I_y, D_y = 6.85, 5.55, 4.25
term_defs = [
    (P_y, r"$K_p$", "Proportional", "present error", SUCCESS),
    (I_y, r"$K_i\,/\,s$", "Integral", "accumulated error", BLUE),
    (D_y, r"$K_d\,s$", "Derivative", "rate of error", "#7c3aed"),
]
isum_x = 7.95   # internal summer collecting the three terms
summing_junction(isum_x, Y, r=0.30)
for ty, gain, name, role, col in term_defs:
    block(term_x0, ty - 0.46, term_x1, ty + 0.46, fc=SURF2, ec=col, lw=1.9)
    ax.text((term_x0 + term_x1) / 2, ty + 0.14, gain, ha="center", va="center",
            fontsize=13.5, fontweight="bold", color=DARK, zorder=6)
    ax.text((term_x0 + term_x1) / 2, ty - 0.24, name + " - " + role,
            ha="center", va="center", fontsize=7.8, color=col, zorder=6)
    # split -> term
    wire([(split_x, Y), (split_x, ty), (term_x0 - 0.02, ty)], DARK, lw=1.7)
    # term -> internal summer
    wire([(term_x1 + 0.02, ty), (isum_x, ty), (isum_x, Y)], DARK, lw=1.7)
    ax.text(isum_x - 0.46, ty + 0.0, "+", ha="center", va="center",
            fontsize=12, fontweight="bold", color=SUCCESS, zorder=7)
node_dot(split_x, Y, color=DARK, r=0.07)

# ===================================================================
# 3. Controller torque -> disturbance summing junction S2 -> plant
# ===================================================================
s2x, s2y = 10.55, Y
arrow((isum_x + 0.30, Y), (s2x - 0.40, Y), color=DARK, lw=2.4)
ax.text((isum_x + 0.30 + s2x) / 2, Y + 0.30, r"$u$ (torque)", ha="center",
        va="bottom", fontsize=10.5, color=TXT2, fontweight="bold")
summing_junction(s2x, s2y)
ax.text(s2x - 0.50, s2y + 0.30, "+", ha="center", va="center", fontsize=15,
        fontweight="bold", color=SUCCESS)
ax.text(s2x + 0.30, s2y + 0.52, "+", ha="center", va="center", fontsize=15,
        fontweight="bold", color=SUCCESS)

# disturbance torque entering from the top
arrow((s2x, 7.7), (s2x, s2y + 0.40), color=DANGER, lw=2.4)
ax.text(s2x + 0.22, 7.55, r"$T_d=m\,g\,d$", ha="left", va="center",
        fontsize=12, fontweight="bold", color=DANGER)
ax.text(s2x + 0.22, 7.12, "disturbance torque", ha="left", va="center",
        fontsize=8.6, color=DANGER)
ax.text(s2x + 0.22, 6.80, "(CG offset / wind)", ha="left", va="center",
        fontsize=8.0, color=TXT3)

# plant block
plx0, plx1 = 11.95, 14.35
ply0, ply1 = 4.55, 6.65
block(plx0, ply0, plx1, ply1, fc="#eef2f7", ec=DARK, lw=2.2)
arrow((s2x + 0.40, Y), (plx0 - 0.02, Y), color=DARK, lw=2.4)
ax.text((plx0 + plx1) / 2, Y + 0.42, r"$\dfrac{1}{J\,s^{2}}$", ha="center",
        va="center", fontsize=17, fontweight="bold", color=DARK, zorder=6)
ax.text((plx0 + plx1) / 2, ply0 + 0.34, "plant: rigid-body", ha="center",
        va="center", fontsize=8.4, color=TXT2, zorder=6)
ax.text((plx0 + plx1) / 2, ply0 + 0.06, "(double integrator)", ha="center",
        va="center", fontsize=7.8, color=TXT3, zorder=6)

# ===================================================================
# 4. Output  theta  +  unity feedback path
# ===================================================================
out_x = 15.55
take_x = 14.95     # feedback take-off node
arrow((plx1 + 0.02, Y), (out_x, Y), color=DARK, lw=2.4)
node_dot(take_x, Y, color=DARK, r=0.07)
ax.text(out_x, Y + 0.34, r"$\theta$", ha="right", va="bottom", fontsize=15,
        fontweight="bold", color=DARK)
ax.text(out_x, Y - 0.30, "roll angle", ha="right", va="top", fontsize=8.6,
        color=TXT3)

# feedback: take-off -> down -> left -> up into S1 (minus input)
fb_y = 1.85
wire([(take_x, Y), (take_x, fb_y), (s1x, fb_y), (s1x, s1y - 0.40)],
     DANGER, lw=2.2, halo=True)
arrow((s1x, fb_y + 0.55), (s1x, s1y - 0.40), color=DANGER, lw=2.2)
ax.text((take_x + s1x) / 2, fb_y - 0.05, "unity feedback   "
        r"(measured $\theta$ from the attitude estimate)",
        ha="center", va="top", fontsize=9.6, color=DANGER)

# ===================================================================
# 5. Footer note: the control objective
# ===================================================================
ax.text(0.2, 0.45,
        "Open-loop plant $1/(J s^2)$ has two poles at the origin (unstable); the "
        "PID feedback manufactures a restoring torque that pulls the closed-loop "
        "poles into the stable left-half plane.",
        ha="left", va="center", fontsize=9.6, color=TXT2,
        bbox=dict(boxstyle="round,pad=0.5", fc=SURF, ec=GRID, lw=1.2))

ax.set_title("Cascaded Attitude Control Loop  -  PID on the Roll-Axis Inertia Plant",
             fontsize=14.5, fontweight="bold", pad=8)
fig.tight_layout()
fig.savefig(OUT, dpi=150, bbox_inches="tight", facecolor=BG)
print("WROTE", OUT)
print("  topology: theta_cmd -> [S1 +/-] -e-> PID(Kp, Ki/s, Kd s) -u-> "
      "[S2 + Td] -> 1/(J s^2) -> theta ; unity feedback (-) to S1")
