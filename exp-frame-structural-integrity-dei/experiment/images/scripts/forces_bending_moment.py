"""
Generator for forces_bending_moment.png
Experiment: exp-frame-structural-integrity-dei
Referenced from procedure.md ("Custom Technical Diagram: Arm Loading" ->
"Cantilever Arm Bending Setup") and conceptually illustrates theory.md
Section 2 ("Cantilever Beam Bending Moment").

Top panel:    free-body diagram of one cf_250 arm as a cantilever beam —
              clamped at the root (hub), free at the tip, with the tip
              force F_tip drawn downward (net hover/full-throttle load
              direction taken as the reaction the arm must resist) and the
              root reaction moment M_root annotated.
Bottom panel: shear force diagram (SFD) and bending moment diagram (BMD)
              plotted over the REAL arm span x in [0, L], computed with
              numpy from the governing formulas — not placeholder axes.

All numeric values are computed with numpy from the SAME cf_250 worked
example used in theory.md Section 2 ("Worked example — tip force and root
moment of one cf_250 arm"):

    M_motor = 25.0 g,  M_prop = 3.1 g,  T_max = 8.5 N,  L = 105 mm = 0.105 m
    g = 9.80665 m/s^2

    F_tip = (M_motor + M_prop) * g + T_max = 8.78 N
    V(x)  = -F_tip                                (constant along the span)
    M(x)  = -F_tip * (L - x)
    M_max = M(0) = -F_tip * L = -0.921 N*m

These reproduce theory.md's own printed values (F_tip = 8.78 N,
M_max = -0.921 N*m) as a sanity check before rendering. The diagram also
serves procedure.md as a general structural-test-bench setup schematic
(clamped root, cantilever arm, tip load, SFD/BMD read-out) — not solely a
one-off worked example — so axis titles and layout read as a generic test
setup with the worked numbers annotated on top.
"""

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

# ---------------------------------------------------------------------------
# 1. Governing values — cf_250 arm, matching theory.md Section 2 worked example
# ---------------------------------------------------------------------------
g = 9.80665                      # m/s^2
M_motor_g, M_prop_g = 25.0, 3.1  # grams (2204 motor, 5045 prop)
M_motor, M_prop = M_motor_g * 1e-3, M_prop_g * 1e-3  # kg
T_max = 8.5                      # N, simulator full-throttle thrust
L = 0.105                        # m, cf_250 arm span (105 mm)

gravity_force = (M_motor + M_prop) * g
F_tip = gravity_force + T_max
M_max = -F_tip * L
M_root = F_tip * L               # magnitude of the root reaction moment

print(f"gravity_force = {gravity_force:.4f} N (theory.md: 0.276 N)")
print(f"F_tip = {F_tip:.4f} N (theory.md: 8.78 N)")
print(f"M_max = {M_max:.4f} N*m (theory.md: -0.921 N*m)")
print(f"M_root (magnitude) = {M_root:.4f} N*m")

# ---------------------------------------------------------------------------
# 2. SFD / BMD computed with numpy over the REAL span x in [0, L]
# ---------------------------------------------------------------------------
x = np.linspace(0.0, L, 300)
V = -F_tip * np.ones_like(x)         # V(x) = -F_tip, constant along span
M = -F_tip * (L - x)                 # M(x) = -F_tip * (L - x)

# ---------------------------------------------------------------------------
# 3. Figure — free-body diagram (top) + SFD/BMD (bottom), real numbers
# ---------------------------------------------------------------------------
fig, (ax_fbd, ax_sfd, ax_bmd) = plt.subplots(
    3, 1, figsize=(10, 10.2), gridspec_kw={"height_ratios": [0.85, 0.85, 0.85]}
)

# ==== Panel 1: Free-body diagram =============================================
ax_fbd.set_title("Cantilever Arm Free-Body Diagram (cf_250, one arm)",
                  fontsize=15, fontweight="bold", pad=14)

arm_y = 0.0
root_x, tip_x = 0.0, L

# clamped root — hatched wall block
wall_w, wall_h = 0.012, 0.05
wall = plt.Rectangle((root_x - wall_w, arm_y - wall_h / 2), wall_w, wall_h,
                      facecolor="#c9c9c9", edgecolor="#333333", hatch="////",
                      linewidth=1.4, zorder=3)
ax_fbd.add_patch(wall)
ax_fbd.text(root_x - wall_w / 2, arm_y - wall_h / 2 - 0.012, "Root clamp\n(hub plate)",
            fontsize=9.5, ha="center", va="top", color="#333333")

# arm beam (root -> tip)
ax_fbd.plot([root_x, tip_x], [arm_y, arm_y], color="#3a4a6b", linewidth=8,
            solid_capstyle="butt", zorder=2)

# motor + prop lump at the tip
motor_r = 0.008
motor = plt.Circle((tip_x, arm_y), motor_r, facecolor="#7c8db5",
                    edgecolor="#2c3a55", linewidth=1.8, zorder=4)
ax_fbd.add_patch(motor)
ax_fbd.text(tip_x, arm_y + motor_r + 0.008, "2204 Motor + 5045 Prop\n"
            f"({M_motor_g:.1f} g + {M_prop_g:.1f} g)", fontsize=9,
            ha="center", va="bottom", color="#2c3a55")

# F_tip arrow — downward, reaction load the arm resists at the tip
arrow_len = 0.035
ax_fbd.annotate("", xy=(tip_x, arm_y - motor_r - arrow_len),
                 xytext=(tip_x, arm_y - motor_r),
                 arrowprops=dict(arrowstyle="-|>", color="#c0392b", lw=2.8,
                                  mutation_scale=22), zorder=5)
ax_fbd.text(tip_x + 0.008, arm_y - motor_r - arrow_len / 2,
            r"$F_{tip}$" + f" = {F_tip:.2f} N", fontsize=13, color="#c0392b",
            fontweight="bold", ha="left", va="center")

# span dimension line (below the arm)
dim_y = arm_y - wall_h / 2 - 0.028
ax_fbd.annotate("", xy=(root_x, dim_y), xytext=(tip_x, dim_y),
                 arrowprops=dict(arrowstyle="<->", color="#222222", lw=1.5))
ax_fbd.text((root_x + tip_x) / 2, dim_y - 0.006, f"L = {L*1e3:.0f} mm = {L:.3f} m",
            fontsize=11.5, ha="center", va="top", color="#222222")

# root moment annotation (curved arrow at the clamp indicating the hogging moment)
theta_arc = np.linspace(np.deg2rad(200), np.deg2rad(340), 60)
arc_r = 0.020
arc_x = root_x - wall_w / 2 + arc_r * np.cos(theta_arc)
arc_y = arm_y + motor_r + 0.014 + arc_r * np.sin(theta_arc)
ax_fbd.plot(arc_x, arc_y, color="#8e44ad", linewidth=2.2, zorder=5)
ax_fbd.annotate("", xy=(arc_x[-1], arc_y[-1]), xytext=(arc_x[-4], arc_y[-4]),
                 arrowprops=dict(arrowstyle="-|>", color="#8e44ad", lw=2.2,
                                  mutation_scale=16), zorder=5)
ax_fbd.text(root_x - wall_w / 2, arm_y + motor_r + 0.014 + arc_r + 0.006,
            r"$M_{root}=F_{tip}\cdot L$" + f" = {M_root:.3f} N·m",
            fontsize=11.5, color="#8e44ad", fontweight="bold", ha="center", va="bottom")

ax_fbd.set_xlim(-0.045, L + 0.035)
ax_fbd.set_ylim(-0.1, 0.055)
ax_fbd.set_aspect("equal")
ax_fbd.axis("off")

# ==== Panel 2: Shear Force Diagram ===========================================
x_mm = x * 1e3
ax_sfd.set_title("Shear Force Diagram (SFD)", fontsize=13, fontweight="bold")
ax_sfd.plot(x_mm, V, color="#2980b9", linewidth=2.6)
ax_sfd.fill_between(x_mm, V, 0, color="#2980b9", alpha=0.15)
ax_sfd.axhline(0, color="black", linewidth=1.0)
ax_sfd.axvline(0, color="#888888", linewidth=0.8, linestyle=":")
ax_sfd.axvline(L * 1e3, color="#888888", linewidth=0.8, linestyle=":")
ax_sfd.text(L * 1e3 * 0.5, V[0] * 1.15, r"$V(x) = -F_{tip}$" + f" = {-F_tip:.2f} N (constant)",
            fontsize=10.5, color="#2980b9", ha="center", va="top")
ax_sfd.set_xlabel("x — distance from root clamp (mm)", fontsize=10.5)
ax_sfd.set_ylabel("Shear V (N)", fontsize=10.5)
ax_sfd.set_xlim(0, L * 1e3)
ax_sfd.set_ylim(V[0] * 1.5, abs(V[0]) * 0.5)
ax_sfd.grid(alpha=0.3)

# ==== Panel 3: Bending Moment Diagram ========================================
ax_bmd.set_title("Bending Moment Diagram (BMD)", fontsize=13, fontweight="bold")
ax_bmd.plot(x_mm, M, color="#c0392b", linewidth=2.6)
ax_bmd.fill_between(x_mm, M, 0, color="#c0392b", alpha=0.15)
ax_bmd.axhline(0, color="black", linewidth=1.0)
ax_bmd.axvline(0, color="#888888", linewidth=0.8, linestyle=":")
ax_bmd.axvline(L * 1e3, color="#888888", linewidth=0.8, linestyle=":")
ax_bmd.plot([0], [M_max], marker="o", color="#c0392b", markersize=7, zorder=5)
ax_bmd.annotate(r"$M_{max}=-F_{tip}\cdot L$" + f" = {M_max:.3f} N·m\n(at root, x = 0)",
                xy=(0, M_max), xytext=(L * 1e3 * 0.28, M_max * 0.55),
                fontsize=10.5, color="#c0392b",
                arrowprops=dict(arrowstyle="->", color="#c0392b", lw=1.3))
ax_bmd.set_xlabel("x — distance from root clamp (mm)", fontsize=10.5)
ax_bmd.set_ylabel("Moment M (N·m)", fontsize=10.5)
ax_bmd.set_xlim(0, L * 1e3)
ax_bmd.set_ylim(M_max * 1.35, abs(M_max) * 0.25)
ax_bmd.grid(alpha=0.3)

fig.suptitle("cf_250 Arm — Cantilever Loading, Shear & Bending Moment "
             r"($T_{max}$" + f" = {T_max:.1f} N, span L = {L*1e3:.0f} mm)",
             fontsize=12.5, y=0.005, color="#555555")

plt.tight_layout(rect=[0, 0.02, 1, 1])

out_path = "/Users/ajith/Desktop/vlgen/exp-frame-structural-integrity-dei/experiment/images/forces_bending_moment.png"
plt.savefig(out_path, dpi=200, bbox_inches="tight")
print(f"Saved: {out_path}")
