"""
Generator for images/drag_setup.png (Experiment 3 - Aerodynamic Analysis).

Left: schematic of the X-frame quadcopter bluff body in the wind tunnel —
frontal-area cross-section highlighted, oncoming wind vector V, drag force
vector F_D. Right: F_D vs V computed from Calc.dragForce (main.js) for the
cf_250 reference frame (Cd=1.05, A_frontal=0.0085 m^2, rho=1.225 kg/m^3 sea
level), reproducing theory.md section 2's worked example: F_D = 1.23 N at
V = 15 m/s.
"""
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches

RHO = 1.225
CD = 1.05
A_FRONTAL = 0.0085  # cf_250, main.js VLAB_CATALOG.frames[0]


def drag_force(rho, V, Cd, A):
    return 0.5 * rho * V * V * Cd * A


fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 5), gridspec_kw={"width_ratios": [1, 1.3]})

# ---- Left: schematic ------------------------------------------------------
ax1.set_xlim(-3, 3)
ax1.set_ylim(-2.2, 2.2)
ax1.set_aspect("equal")
ax1.axis("off")
ax1.set_title("X-Frame Bluff Body — Wind Tunnel Setup", fontsize=11)

# Frame arms (X configuration)
arm_len = 1.4
for ang in [45, 135, 225, 315]:
    dx = arm_len * np.cos(np.radians(ang))
    dy = arm_len * np.sin(np.radians(ang))
    ax1.plot([0, dx], [0, dy], color="#1c1c1e", lw=6, solid_capstyle="round", zorder=2)
    motor = plt.Circle((dx, dy), 0.18, color="#374151", zorder=3)
    ax1.add_patch(motor)
# Central body
body = mpatches.FancyBboxPatch((-0.35, -0.35), 0.7, 0.7, boxstyle="round,pad=0.02",
                                linewidth=1.5, edgecolor="#1c1c1e", facecolor="#94a3b8", zorder=4)
ax1.add_patch(body)

# Frontal area cross-section (projected silhouette, highlighted)
ax1.add_patch(mpatches.Rectangle((-1.5, -0.15), 3.0, 0.30, facecolor="#fca5a5",
                                  edgecolor="#ef4444", alpha=0.55, zorder=1,
                                  label="Frontal area $A_{frontal}$"))

# Incoming wind arrows (from the left)
for y in [1.1, 0.55, 0, -0.55, -1.1]:
    ax1.annotate("", xy=(-1.7, y), xytext=(-2.9, y),
                 arrowprops=dict(arrowstyle="->", color="#2563eb", lw=1.6))
ax1.text(-2.9, 1.5, "Wind $V$", color="#2563eb", fontsize=10, fontweight="bold")

# Drag force vector (opposing motion, pointing downstream / +x)
ax1.annotate("", xy=(2.3, 0), xytext=(0.4, 0),
             arrowprops=dict(arrowstyle="->", color="#dc2626", lw=2.4))
ax1.text(1.1, 0.18, r"$F_D$", color="#dc2626", fontsize=13, fontweight="bold")

ax1.legend(loc="lower center", fontsize=8.5, framealpha=0.9)

# ---- Right: computed F_D vs V ---------------------------------------------
V = np.linspace(0, 15, 200)
Fd = drag_force(RHO, V, CD, A_FRONTAL)

ax2.plot(V, Fd, color="#dc2626", lw=2.4,
         label=r"$F_D=0.5\rho V^2 C_d A$" + f"  (cf_250: A={A_FRONTAL} m²,  Cd={CD})")

V_ex = 15.0
Fd_ex = drag_force(RHO, V_ex, CD, A_FRONTAL)
ax2.plot([V_ex], [Fd_ex], marker="o", ms=9, color="#dc2626", zorder=5)
ax2.annotate(f"Worked example:\nV={V_ex:.0f} m/s → $F_D$={Fd_ex:.2f} N",
             xy=(V_ex, Fd_ex), xytext=(V_ex - 8.5, Fd_ex - 0.15),
             fontsize=9, color="#7f1d1d",
             arrowprops=dict(arrowstyle="->", color="#7f1d1d", lw=1.0))
assert abs(Fd_ex - 1.23) < 0.01, Fd_ex

ax2.set_xlabel("Forward Speed $V$ (m/s)", fontsize=11)
ax2.set_ylabel("Drag Force $F_D$ (N)", fontsize=11)
ax2.set_title("Frame Drag vs Forward Speed (quadratic)", fontsize=11)
ax2.grid(True, alpha=0.3)
ax2.set_xlim(0, 15)
ax2.set_ylim(0, 1.4)
ax2.legend(loc="upper left", fontsize=8.5)

fig.tight_layout()
out_path = "/Users/ajith/Desktop/vlgen/exp-aerodynamic-analysis-dei/experiment/images/drag_setup.png"
fig.savefig(out_path, dpi=150, bbox_inches="tight")
print("Saved:", out_path)
print("F_D at 15 m/s:", Fd_ex, "(expect ~1.23 N)")
