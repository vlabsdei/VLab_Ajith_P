"""
Generator for: exp-flight-control-system-dei/experiment/images/closed_loop_full_system.png

Accuracy basis (theory.md Section 8 + simulation/js/main.js Calc.closedLoopFlight):
  This is the ONE diagram that makes attitude ESTIMATION part of the control
  loop explicit (Tabs 1-3 study the plant, the tuning method and the filter in
  isolation; Tab 4 / this figure is what actually flies): the controller never
  sees the true roll angle theta -- it only ever sees the ESTIMATE theta_hat
  that comes out of the sensor + estimator stage, so estimator error is
  control error.

  Sensors (main.js closedLoopFlight):
        gyro_meas  = omega_true + bias + n_gyro        [rad/s]
        accel_meas = theta_true + n_accel               [rad]
  Estimator (opts.estimator, main.js):
        'comp'  (complementary): theta_hat = alpha*(theta_hat + gyro_meas*dt) + (1-alpha)*accel_meas
        'gyro'  (gyro-only):     theta_hat = integral(gyro_meas dt)              -> drifts
        'accel' (accel-only):    theta_hat = accel_meas                          -> noisy
  Controller acts on the ESTIMATE, not the truth (main.js: "e = cmd - thetaHat"):
        u = Kp*(cmd - theta_hat) + Ki*integral(...) + Kd*rate
  Plant (theory.md S1 + S9 drag/wind extension):
        J*theta_ddot = u + tau_drag(theta_dot) + tau_wind(t) + tau_cg
        tau_drag(w) = -b*w - c*w*|w|         (Calc.dragTorque)
  This is a SCHEMATIC (block diagram): correct topology and signal names only,
  no curves -- it exists to make the theta vs theta_hat distinction physically
  legible, which the plain PID loop diagram (pid_control_loop.png) elides by
  labelling the feedback simply "measured theta".

Run:  python closed_loop_full_system.py
"""
import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patheffects as pe
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch, Circle

OUT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(OUT_DIR, "closed_loop_full_system.png")

# ---- house palette (simulation/css/main.css :root) -- identical to pid_control_loop.py ----
BG, ACCENT, DARK = "#ffffff", "#ffbf00", "#111827"
TXT2, TXT3, GRID = "#374151", "#6b7280", "#e5e7eb"
SURF, SURF2 = "#f9fafb", "#f3f4f6"
SUCCESS, WARNING, DANGER, BLUE, PURPLE = "#10b981", "#f59e0b", "#ef4444", "#2563eb", "#7c3aed"

plt.rcParams.update({
    "figure.dpi": 150, "savefig.dpi": 150,
    "font.family": "sans-serif",
    "font.sans-serif": ["Inter", "Segoe UI", "DejaVu Sans", "Arial"],
    "font.size": 11, "text.color": DARK,
    "axes.facecolor": BG, "figure.facecolor": BG,
})

fig, ax = plt.subplots(figsize=(16.1, 9.0))
ax.set_xlim(0, 19.7)
ax.set_ylim(0, 11)
ax.set_aspect("equal")
ax.axis("off")
HALO = [pe.withStroke(linewidth=4.0, foreground=BG)]

Y = 7.35   # main forward-path height (controller -> plant -> true theta)


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


def arrow(p0, p1, color=DARK, lw=2.2, ms=16, z=6, ls="-"):
    ax.add_patch(FancyArrowPatch(p0, p1, arrowstyle="-|>", mutation_scale=ms,
                 lw=lw, color=color, zorder=z, shrinkA=0, shrinkB=0,
                 linestyle=ls))


def node_dot(x, y, color=DARK, r=0.06):
    ax.add_patch(Circle((x, y), r, fc=color, ec=color, zorder=8))


def summing_junction(cx, cy, r=0.32):
    ax.add_patch(Circle((cx, cy), r, fc="#ffffff", ec=DARK, lw=2.0, zorder=5))
    ax.plot([cx - r * 0.62, cx + r * 0.62], [cy, cy], color=DARK, lw=1.1, zorder=6)
    ax.plot([cx, cx], [cy - r * 0.62, cy + r * 0.62], color=DARK, lw=1.1, zorder=6)
    return cx, cy


# ===================================================================
# 1. Command  ->  S1 (error against the ESTIMATE, not truth)
# ===================================================================
s1x, s1y = summing_junction(2.35, Y)   # +0.5 vs the tighter first draft -- gives the
                                        # "commanded roll" caption clearance from the
                                        # theta_hat feedback riser (was overlapping it)
arrow((0.35, Y), (s1x - 0.36, Y), color=DARK, lw=2.2)
ax.text(0.35, Y + 0.32, r"$\theta_{cmd}$", ha="left", va="bottom",
        fontsize=13.5, fontweight="bold", color=DARK)
ax.text(0.35, Y - 0.28, "commanded roll", ha="left", va="top", fontsize=8.2, color=TXT3)
ax.text(s1x - 0.48, s1y + 0.28, "+", ha="center", va="center", fontsize=14,
        fontweight="bold", color=SUCCESS)
ax.text(s1x - 0.28, s1y - 0.48, r"$-$", ha="center", va="center", fontsize=15,
        fontweight="bold", color=DANGER)

# ===================================================================
# 2. Controller block (PID acting on e = cmd - theta_hat)
# ===================================================================
cx0, cx1 = 3.25, 6.05
block(cx0, Y - 0.72, cx1, Y + 0.72, fc="#fffdf5", ec=ACCENT, lw=2.4, rounding=0.16)
ax.text((cx0 + cx1) / 2, Y + 0.34, "Controller", ha="center", va="center",
        fontsize=12, fontweight="bold", color=DARK, zorder=6)
ax.text((cx0 + cx1) / 2, Y - 0.02,
        r"$u=K_p e+K_i\!\int\! e+K_d\dot{e}$", ha="center", va="center",
        fontsize=10.6, color=TXT2, zorder=6)
ax.text((cx0 + cx1) / 2, Y - 0.42, "Manual / ZN-Classic / ZN-Tyreus",
        ha="center", va="center", fontsize=7.6, color=TXT3, zorder=6)
arrow((s1x + 0.36, Y), (cx0 - 0.02, Y), color=DARK, lw=2.0)
ax.text((s1x + cx0) / 2, Y + 0.28, r"$e=\theta_{cmd}-\hat\theta$",
        ha="center", va="bottom", fontsize=10, color=DANGER, fontweight="bold")

# ===================================================================
# 3. Disturbance summer S2 -> plant with drag + wind + CG couple
# ===================================================================
s2x, s2y = 7.05, Y
arrow((cx1 + 0.02, Y), (s2x - 0.36, Y), color=DARK, lw=2.2)
# placed high above the arrow (not at its vertical midpoint height) so it
# clears S2's own "+" glyph just below -- the two were overlapping before
ax.text((cx1 + 0.02 + s2x - 0.36) / 2, Y + 0.55, r"$u$", ha="center", va="bottom",
        fontsize=10.5, color=TXT2, fontweight="bold")
summing_junction(s2x, s2y)
ax.text(s2x - 0.46, s2y + 0.28, "+", ha="center", va="center", fontsize=14,
        fontweight="bold", color=SUCCESS)
ax.text(s2x + 0.28, s2y + 0.48, "+", ha="center", va="center", fontsize=14,
        fontweight="bold", color=SUCCESS)
arrow((s2x, 9.05), (s2x, s2y + 0.36), color=DANGER, lw=2.2)
ax.text(s2x + 0.20, 9.55, r"$\tau_{wind}(t)+\tau_{cg}$", ha="left", va="center",
        fontsize=10.5, fontweight="bold", color=DANGER)
ax.text(s2x + 0.20, 9.18, "gust + CG couple", ha="left", va="center",
        fontsize=7.6, color=TXT3)

plx0, plx1 = 8.05, 10.25
ply0, ply1 = Y - 0.95, Y + 0.95
block(plx0, ply0, plx1, ply1, fc="#eef2f7", ec=DARK, lw=2.2)
arrow((s2x + 0.36, Y), (plx0 - 0.02, Y), color=DARK, lw=2.2)
ax.text((plx0 + plx1) / 2, Y + 0.32, r"$\dfrac{1}{Js^{2}}$", ha="center", va="center",
        fontsize=15, fontweight="bold", color=DARK, zorder=6)
ax.text((plx0 + plx1) / 2, Y - 0.14, r"$+\ \tau_{drag}(\dot\theta)$", ha="center",
        va="center", fontsize=9.2, color=TXT2, zorder=6)
ax.text((plx0 + plx1) / 2, Y - 0.44, r"$-b\dot\theta-c\dot\theta|\dot\theta|$",
        ha="center", va="center", fontsize=8.0, color=TXT3, zorder=6)
ax.text((plx0 + plx1) / 2, ply0 - 0.22, "rigid-body plant + aero drag", ha="center",
        va="center", fontsize=8.0, color=TXT3)

# ===================================================================
# 4. TRUE output theta (black, top path) + a tap point OUTSIDE the
#    downstream boxes' horizontal span so the branch line never crosses them
# ===================================================================
tap_x = plx1 + 0.60          # strictly left of every box below
out_x = 11.65
arrow((plx1 + 0.02, Y), (out_x, Y), color=DARK, lw=2.6)
node_dot(tap_x, Y, color=DARK, r=0.07)
ax.text(out_x, Y + 0.32, r"$\theta$  (true roll)", ha="left", va="bottom",
        fontsize=12.5, fontweight="bold", color=DARK)
ax.text(out_x, Y - 0.28, "what the drone actually does", ha="left", va="top",
        fontsize=7.8, color=TXT3)

# ===================================================================
# 5. SENSOR + ESTIMATOR STAGE -- the block the plain PID diagram omits.
#    theta feeds two noisy/biased sensors; the estimator fuses them into
#    theta_hat, which closes the loop back to S1 -- NOT theta itself.
#    All boxes sit strictly to the RIGHT of tap_x so the vertical bus never
#    crosses a box interior.
# ===================================================================
gx0, gx1, gy = 12.2, 15.0, 3.55     # gyroscope box
ax0b, ax1b, ay = 12.2, 15.0, 1.85   # accelerometer box (same x-span, lower)

# vertical bus from the theta tap down to the gyro row, continuing to the
# accel row -- a single trunk that peels off into each sensor in turn
wire([(tap_x, Y - 0.03), (tap_x, gy)], DARK, lw=1.8, halo=True)
wire([(tap_x, gy), (tap_x, ay)], DARK, lw=1.8, halo=True)
arrow((tap_x, gy), (gx0 - 0.02, gy), color=DARK, lw=1.7)
arrow((tap_x, ay), (ax0b - 0.02, ay), color=DARK, lw=1.7)

block(gx0, gy - 0.5, gx1, gy + 0.5, fc=SURF2, ec=BLUE, lw=1.9)
ax.text((gx0 + gx1) / 2, gy + 0.16, "Gyroscope", ha="center", va="center",
        fontsize=10.5, fontweight="bold", color=BLUE, zorder=6)
ax.text((gx0 + gx1) / 2, gy - 0.20, r"$\omega_{meas}=\dot\theta+bias+n_{gyro}$",
        ha="center", va="center", fontsize=8.6, color=TXT2, zorder=6)

block(ax0b, ay - 0.5, ax1b, ay + 0.5, fc=SURF2, ec="#94a3b8", lw=1.9)
ax.text((ax0b + ax1b) / 2, ay + 0.16, "Accelerometer", ha="center", va="center",
        fontsize=10.5, fontweight="bold", color="#64748b", zorder=6)
ax.text((ax0b + ax1b) / 2, ay - 0.20, r"$\theta_{accel}=\theta+n_{accel}$",
        ha="center", va="center", fontsize=8.6, color=TXT2, zorder=6)

# estimator block (the star of this figure) -- three selectable modes.
# Kept in the gap between the sensor column and the estimator column so no
# connector ever needs to backtrack leftward.
ex0, ex1 = 15.5, 19.1
ey0, ey1 = 1.35, 4.05
stub_x = gx1 + 0.25                  # sits inside the gx1-ex0 gap

block(ex0, ey0, ex1, ey1, fc="#fff7ed", ec=WARNING, lw=2.6, rounding=0.16, z=2)
ax.text((ex0 + ex1) / 2, ey1 - 0.32, "Attitude Estimator", ha="center", va="center",
        fontsize=12, fontweight="bold", color=DARK, zorder=6)
modes = [
    (ey1 - 0.78, r"comp: $\hat\theta=\alpha(\hat\theta+\omega_{meas}\Delta t)+(1-\alpha)\theta_{accel}$", SUCCESS, "selected — bounded error"),
    (ey1 - 1.28, r"gyro: $\hat\theta=\int \omega_{meas}\,dt$", DANGER, "drifts without bound"),
    (ey1 - 1.78, r"accel: $\hat\theta=\theta_{accel}$", "#64748b", "noisy, no smoothing"),
]
for my, formula, col, note in modes:
    ax.text(ex0 + 0.18, my, formula, ha="left", va="center", fontsize=8.4,
            color=DARK, zorder=6)
    ax.text(ex0 + 0.18, my - 0.24, note, ha="left", va="center", fontsize=7.2,
            color=col, fontstyle="italic", zorder=6)

# gyro -> estimator (enters near the "comp"/"gyro" rows, from open gap space)
wire([(gx1 + 0.02, gy), (stub_x, gy), (stub_x, gy - 0.35)], BLUE, lw=1.7)
arrow((stub_x, gy - 0.35), (ex0 - 0.02, gy - 0.35), color=BLUE, lw=1.7)
# accel -> estimator (enters near the "accel" row)
wire([(ax1b + 0.02, ay), (stub_x, ay), (stub_x, ay + 0.35)], "#94a3b8", lw=1.7)
arrow((stub_x, ay + 0.35), (ex0 - 0.02, ay + 0.35), color="#94a3b8", lw=1.7)

# ===================================================================
# 6. theta_hat feedback: exits the BOTTOM edge of the estimator box (never
#    cuts through its interior) and climbs back to S1's minus input.
# ===================================================================
hat_x = (ex0 + ex1) / 2
node_dot(hat_x, ey0, color=ACCENT, r=0.08)
fb_y = 0.55
wire([(hat_x, ey0), (hat_x, fb_y), (s1x, fb_y), (s1x, s1y - 0.36)],
     ACCENT, lw=2.6, halo=True)
arrow((s1x, fb_y + 0.5), (s1x, s1y - 0.36), color=ACCENT, lw=2.4)
ax.text((hat_x + s1x) / 2, fb_y - 0.30,
        r"feedback is $\hat\theta$ (the ESTIMATE) -- never the true $\theta$ above",
        ha="center", va="top", fontsize=10, color="#b98a00", fontweight="bold")
ax.text(hat_x + 0.18, ey0 - 0.06, r"$\hat\theta$", ha="left", va="top",
        fontsize=13, fontweight="bold", color="#b98a00")

# ===================================================================
# 7. Footer callouts
# ===================================================================
ax.text(0.2, 10.35,
        "The controller (left) never touches the true roll angle $\\theta$ (top path, black). "
        "It closes the loop on $\\hat\\theta$ (bottom path, amber) -- whatever the sensor + "
        "estimator stage hands back. Swap the estimator and the SAME gains fly a different drone.",
        ha="left", va="center", fontsize=10.2, color=TXT2,
        bbox=dict(boxstyle="round,pad=0.55", fc=SURF, ec=GRID, lw=1.2))

ax.set_title("Full-System Closed Loop  —  the Controller Flies the ESTIMATE, Not the Truth",
             fontsize=14.5, fontweight="bold", pad=6)
fig.tight_layout()
fig.savefig(OUT, dpi=150, bbox_inches="tight", facecolor=BG)
print("WROTE", OUT)
print("  topology: theta_cmd -> [S1] -e=cmd-theta_hat-> Controller -u-> [S2 + wind/cg] "
      "-> 1/(Js^2)+drag -> THETA (true, black, top) -> {gyro, accel} -> Estimator "
      "{comp|gyro|accel} -> THETA_HAT (amber) -> feedback to S1")
