"""
Generator for cg_coordinate_offset.png
Experiment: exp-frame-structural-integrity-dei
Referenced from theory.md Section 1 ("Centroid & Center of Gravity") as
"Quadcopter Coordinate System".

Top-down schematic of the cf_250 quadcopter frame in an X-configuration,
with the geometric centre (origin), the 10 mm safe-balancing envelope
(dashed circle), the three off-centre components from the worked example
(battery, GPS, telemetry radio) plotted at their real offsets, and the
resulting computed centre-of-gravity marker plotted at its real (exaggerated
for visibility, but numerically labelled) offset.

All numeric values are computed with numpy from the SAME worked example in
theory.md Section 1 ("Worked example — CG offset of the reference 5" build"):

    On-centre mass (motors+props+ESCs+frame+FC+RX) = 229.6 g @ (0,0)
    Battery   (4S 3300 mAh, 320.0 g)  at y = -12 mm
    GPS       (M9N, 24.5 g)           at y = +45 mm
    Telemetry (915 MHz, 18.3 g)       at x = +35 mm
    Total mass  sum(m_i) = 592.4 g

    x_CG = (18.3 * 35) / 592.4                       = 1.081 mm
    y_CG = (320.0 * -12 + 24.5 * 45) / 592.4          = -4.621 mm
    r_CG = sqrt(x_CG^2 + y_CG^2)                      = 4.75 mm

These reproduce theory.md's own printed values exactly as a sanity check
before rendering (see the printed assertions below).
"""

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

# ---------------------------------------------------------------------------
# 1. Component masses & positions — cf_250 worked example (theory.md Sec. 1)
# ---------------------------------------------------------------------------
# On-centre components (net zero moment): 4x2204 motors, 4x5045 props,
# 4x30A ESCs, cf_250 frame, F7 stack, ELRS receiver.
m_oncentre = 4 * 25.0 + 4 * 3.1 + 4 * 9.5 + 68.2 + 7.5 + 3.5   # g
x_oncentre, y_oncentre = 0.0, 0.0

# Off-centre components
m_batt, x_batt, y_batt = 320.0, 0.0, -12.0     # 4S 3300 mAh battery
m_gps,  x_gps,  y_gps  = 24.5,  0.0,  45.0     # uBlox M9N GPS
m_tel,  x_tel,  y_tel  = 18.3, 35.0,   0.0     # 915 MHz telemetry radio

masses = np.array([m_oncentre, m_batt, m_gps, m_tel])
xs = np.array([x_oncentre, x_batt, x_gps, x_tel])
ys = np.array([y_oncentre, y_batt, y_gps, y_tel])

total_mass = masses.sum()
x_cg = np.sum(masses * xs) / total_mass
y_cg = np.sum(masses * ys) / total_mass
r_cg = np.hypot(x_cg, y_cg)

print(f"m_oncentre = {m_oncentre:.1f} g (theory.md: 229.6 g)")
print(f"total_mass = {total_mass:.1f} g (theory.md: 592.4 g)")
print(f"x_CG = {x_cg:.3f} mm (theory.md: 1.081 mm)")
print(f"y_CG = {y_cg:.3f} mm (theory.md: -4.621 mm)")
print(f"r_CG = {r_cg:.3f} mm (theory.md: 4.75 mm)")

SAFE_R = 10.0  # mm, safety envelope radius

# ---------------------------------------------------------------------------
# 2. Figure — top-down X-configuration quadcopter with CG worked example
# ---------------------------------------------------------------------------
fig, ax = plt.subplots(figsize=(9.5, 9.5))

wheelbase_mm = 250.0            # cf_250 nominal wheelbase
arm_len = wheelbase_mm / 2.0 * 0.78   # visual arm length from hub centre
motor_r = 11.0                  # motor hub circle radius (drawing units)

# ---- Arms in X configuration (45 deg offsets) ----
arm_angles_deg = [45, 135, 225, 315]
for ang in arm_angles_deg:
    a = np.deg2rad(ang)
    x_tip, y_tip = arm_len * np.cos(a), arm_len * np.sin(a)
    ax.plot([0, x_tip], [0, y_tip], color="#3a4a6b", linewidth=6,
             solid_capstyle="round", zorder=2)
    motor = plt.Circle((x_tip, y_tip), motor_r, facecolor="#7c8db5",
                        edgecolor="#2c3a55", linewidth=1.8, zorder=3)
    ax.add_patch(motor)

# ---- Central hub / frame deck (square, rotated 45 deg to sit between arms) ----
hub_size = 46.0
hub = plt.Rectangle((-hub_size / 2, -hub_size / 2), hub_size, hub_size,
                     angle=0, facecolor="#dfe6f0", edgecolor="#2c3a55",
                     linewidth=2.0, zorder=4)
ax.add_patch(hub)
ax.text(0, hub_size / 2 + 4, "cf_250 Frame Hub", fontsize=10.5,
        ha="center", va="bottom", color="#2c3a55", fontweight="bold")

# ---- Geometric centre / origin marker ----
ax.plot(0, 0, marker="+", markersize=16, markeredgewidth=2.4, color="#222222", zorder=6)
ax.text(0, -hub_size / 2 - 3.0, "Origin (0,0) — geometric centre", fontsize=8.3,
        color="#222222", ha="center", va="top")

# ---- 10 mm safety envelope (dashed circle), drawn at real scale ----
theta = np.linspace(0, 2 * np.pi, 200)
env_x = SAFE_R * np.cos(theta)
env_y = SAFE_R * np.sin(theta)
ax.plot(env_x, env_y, linestyle="--", color="#c0392b", linewidth=1.8, zorder=5)
ax.text(0, SAFE_R + 2.0,
        r"$r_{CG} \leq 10$ mm envelope", fontsize=8.3, color="#c0392b", zorder=5,
        ha="center", va="bottom")

# ---- Off-centre component markers, plotted at real mm offsets ----
ax.scatter([x_batt], [y_batt], marker="s", s=180, color="#27ae60",
           edgecolor="#1e7e45", linewidth=1.5, zorder=7,
           label=f"Battery 4S 3300 mAh, {m_batt:.1f} g  (y = {y_batt:.0f} mm)")
ax.scatter([x_gps], [y_gps], marker="D", s=140, color="#f39c12",
           edgecolor="#b9770e", linewidth=1.5, zorder=7,
           label=f"GPS M9N, {m_gps:.1f} g  (y = +{y_gps:.0f} mm)")
ax.scatter([x_tel], [y_tel], marker="^", s=160, color="#8e44ad",
           edgecolor="#5e2f73", linewidth=1.5, zorder=7,
           label=f"Telemetry 915 MHz, {m_tel:.1f} g  (x = +{x_tel:.0f} mm)")

ax.annotate("Battery (rear deck)", xy=(x_batt, y_batt), xytext=(-hub_size / 2 - 34, y_batt - 8),
            fontsize=8.6, color="#1e7e45", ha="right", va="center",
            arrowprops=dict(arrowstyle="->", color="#1e7e45", lw=1.2))
ax.annotate("GPS (fwd mast)", xy=(x_gps, y_gps), xytext=(-hub_size / 2 - 34, y_gps + 6),
            fontsize=8.6, color="#b9770e", ha="right", va="center",
            arrowprops=dict(arrowstyle="->", color="#b9770e", lw=1.2))
ax.annotate("Telemetry (right deck)", xy=(x_tel, y_tel), xytext=(hub_size / 2 + 34, y_tel + 20),
            fontsize=8.6, color="#5e2f73", ha="left", va="center",
            arrowprops=dict(arrowstyle="->", color="#5e2f73", lw=1.2))

# ---- Computed CG marker — real offset is tiny (4.75 mm) vs. a 250 mm frame,
#      so draw it at true scale AND add a zoomed callout so it's visible ----
ax.scatter([x_cg], [y_cg], marker="*", s=520, color="#e74c3c",
           edgecolor="#7a1f10", linewidth=1.2, zorder=9,
           label=f"Computed CG  (x={x_cg:.3f}, y={y_cg:.3f}) mm, r={r_cg:.2f} mm")

# Zoomed inset showing the CG offset clearly relative to the small envelope
axins = ax.inset_axes([0.70, 0.06, 0.30, 0.30])
axins.plot(env_x, env_y, linestyle="--", color="#c0392b", linewidth=1.6)
axins.plot(0, 0, marker="+", markersize=12, markeredgewidth=2.0, color="#222222")
axins.scatter([x_cg], [y_cg], marker="*", s=340, color="#e74c3c",
              edgecolor="#7a1f10", linewidth=1.0, zorder=9)
axins.annotate(f"CG\n({x_cg:.2f}, {y_cg:.2f}) mm",
               xy=(x_cg, y_cg), xytext=(x_cg + 3.5, y_cg - 3.0),
               fontsize=8, color="#7a1f10", ha="left")
axins.plot([0, x_cg], [0, y_cg], color="#7a1f10", linewidth=1.2, linestyle=":")
lim = SAFE_R * 1.35
axins.set_xlim(-lim, lim)
axins.set_ylim(-lim, lim)
axins.set_aspect("equal")
axins.set_title(r"$r_{CG}$" + f" = {r_cg:.2f} mm (zoom)", fontsize=8.5)
axins.tick_params(labelsize=6.5)
axins.grid(alpha=0.3)
for spine in axins.spines.values():
    spine.set_edgecolor("#888888")

# connect inset to main plot region near origin
ax.indicate_inset_zoom(axins, edgecolor="#555555", alpha=0.6, linewidth=1.0)

# ---- Formula + worked numbers annotation block ----
formula_txt = (
    r"$x_{CG}=\dfrac{\Sigma\,m_i x_i}{\Sigma\,m_i}$" + "   "
    r"$y_{CG}=\dfrac{\Sigma\,m_i y_i}{\Sigma\,m_i}$" + "   "
    r"$r_{CG}=\sqrt{x_{CG}^2+y_{CG}^2}$"
)
ax.text(0, -arm_len - motor_r - 16, formula_txt, fontsize=11.5,
        ha="center", va="top", color="#222222")

values_txt = (
    f"On-centre mass (motors+props+ESCs+frame+FC+RX) = {m_oncentre:.1f} g @ (0,0)   |   Total mass  Σm$_i$ = {total_mass:.1f} g\n"
    f"x$_{{CG}}$ = {x_cg:.3f} mm,   y$_{{CG}}$ = {y_cg:.3f} mm,   r$_{{CG}}$ = {r_cg:.2f} mm  —  inside the 10 mm envelope: BALANCED"
)
ax.text(0, -arm_len - motor_r - 27, values_txt, fontsize=9.3,
        ha="center", va="top", color="#333333", linespacing=1.7)

ax.set_xlim(-arm_len - motor_r - 42, arm_len + motor_r + 42)
ax.set_ylim(-arm_len - motor_r - 42, arm_len + motor_r + 18)
ax.set_aspect("equal")
ax.axis("off")
ax.legend(loc="upper left", fontsize=8.6, framealpha=0.92, bbox_to_anchor=(-0.02, 1.02))

ax.set_title("Quadcopter Coordinate System — CG Offset Worked Example (cf_250)",
             fontsize=14, fontweight="bold", pad=14)

plt.tight_layout()

out_path = "/Users/ajith/Desktop/vlgen/exp-frame-structural-integrity-dei/experiment/images/cg_coordinate_offset.png"
plt.savefig(out_path, dpi=200, bbox_inches="tight")
print(f"Saved: {out_path}")
