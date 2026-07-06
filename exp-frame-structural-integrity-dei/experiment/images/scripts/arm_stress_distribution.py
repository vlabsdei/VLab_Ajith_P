"""
Generator for arm_stress_distribution.png
Experiment: exp-frame-structural-integrity-dei
Referenced from theory.md Section 3 ("Flexural Bending Stress").

Left panel:  hollow rectangular cross-section of the cf_250 arm, dimensioned
             (width b, height h, wall thickness t) with the neutral axis shown.
Right panel: linear flexural stress distribution sigma(y) = M*y/I across the
             section height, with tension above the neutral axis and
             compression below, and sigma_max = M*c/I annotated.

All numeric values are computed with numpy from the SAME cf_250 worked
example used in theory.md Section 3 (and cross-checked against Section 2's
tip-force/root-moment worked example):

    b = 10 mm, h = 6 mm, t = 1 mm   -> inner void (b-2t) x (h-2t) = 8 mm x 4 mm
    M_max = 0.921 N*m               (Section 2 worked example, cf_250 arm)
    I = (b*h^3 - (b-2t)*(h-2t)^3) / 12 = 1.373e-10 m^4
    c = h/2
    sigma_max = M_max * c / I = 20.1 MPa

These reproduce theory.md's own printed values (I = 1.373e-10 m^4,
sigma_max = 20.1 MPa) as a sanity check before rendering.
"""

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

# ---------------------------------------------------------------------------
# 1. Governing values — cf_250 arm, matching theory.md Section 3 worked example
# ---------------------------------------------------------------------------
b_mm, h_mm, t_mm = 10.0, 6.0, 1.0                # outer width, height, wall thickness (mm)
b, h, t = b_mm * 1e-3, h_mm * 1e-3, t_mm * 1e-3  # convert to metres

b_i_mm, h_i_mm = b_mm - 2 * t_mm, h_mm - 2 * t_mm   # inner void: 8 mm x 4 mm
b_i, h_i = b_i_mm * 1e-3, h_i_mm * 1e-3

M_max = 0.921          # N*m, root moment (Section 2 worked example, cf_250 arm)
c = h / 2.0            # outer fibre distance from neutral axis

I_outer = b * h ** 3 / 12.0
I_inner = b_i * h_i ** 3 / 12.0
I = I_outer - I_inner   # hollow rectangular second moment of area

sigma_max = M_max * c / I   # Pa

print(f"b={b_mm} mm, h={h_mm} mm, t={t_mm} mm, inner void {b_i_mm}x{h_i_mm} mm")
print(f"I = {I:.4e} m^4  (theory.md: 1.373e-10 m^4)")
print(f"c = {c*1e3:.3f} mm")
print(f"sigma_max = {sigma_max:.4e} Pa = {sigma_max/1e6:.2f} MPa  (theory.md: 20.1 MPa)")

# ---------------------------------------------------------------------------
# 2. Stress distribution sigma(y) = M*y/I, computed with numpy
# ---------------------------------------------------------------------------
y = np.linspace(-c, c, 200)
sigma = M_max * y / I
sigma_MPa = sigma / 1e6
sigma_max_MPa = sigma_max / 1e6

# ---------------------------------------------------------------------------
# 3. Figure — two panels, same layout/style as the original diagram
# ---------------------------------------------------------------------------
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13, 7.2))

# ---- Panel 1: Hollow Arm Profile (cross-section) --------------------------
ax1.set_title("Hollow Arm Profile", fontsize=17, fontweight="bold", pad=18)

# geometry in mm for a clean, readable cross-section drawing
outer_w, outer_h = b_mm, h_mm
inner_w, inner_h = b_i_mm, h_i_mm

ox0, oy0 = -outer_w / 2.0, -outer_h / 2.0
ix0, iy0 = -inner_w / 2.0, -inner_h / 2.0

# outer rectangle (wall) filled slate-blue, inner void filled white
outer_rect = plt.Rectangle((ox0, oy0), outer_w, outer_h,
                            facecolor="#7c8db5", edgecolor="#3a4a6b", linewidth=2, zorder=1)
inner_rect = plt.Rectangle((ix0, iy0), inner_w, inner_h,
                            facecolor="white", edgecolor="#3a4a6b", linewidth=1.6, zorder=2)
ax1.add_patch(outer_rect)
ax1.add_patch(inner_rect)

# neutral axis (dash-dot) through centroid, spanning beyond the section
na_span = outer_w * 1.55
ax1.plot([-na_span / 2, na_span / 2], [0, 0], color="#555555",
          linestyle="-.", linewidth=1.4, zorder=3)
ax1.text(na_span / 2 - 0.3, 0.35, "Neutral Axis", fontsize=12, color="#333333",
          ha="right", va="bottom")

# wall-thickness callout (top-left corner of the wall)
ax1.annotate("", xy=(ox0, oy0 + outer_h), xytext=(ix0, iy0 + inner_h),
             arrowprops=dict(arrowstyle="<->", color="#c0392b", lw=1.6))
ax1.text(ox0 - 0.15, oy0 + outer_h + 1.7,
          f"Thickness\nt = {t_mm:g} mm", fontsize=12, color="#c0392b",
          ha="left", va="bottom", fontweight="bold")

# width dimension line (below the section)
dim_y = oy0 - 1.6
ax1.annotate("", xy=(ox0, dim_y), xytext=(ox0 + outer_w, dim_y),
             arrowprops=dict(arrowstyle="<->", color="#222222", lw=1.5))
ax1.text(0, dim_y - 0.55, f"Width b = {b_mm:g} mm", fontsize=13,
          ha="center", va="top", color="#222222")

# height dimension line (right of the section)
dim_x = ox0 + outer_w + 1.6
ax1.annotate("", xy=(dim_x, oy0), xytext=(dim_x, oy0 + outer_h),
             arrowprops=dict(arrowstyle="<->", color="#222222", lw=1.5))
ax1.text(dim_x + 0.35, 0, f"Height\nh = {h_mm:g} mm", fontsize=13,
          ha="left", va="center", color="#222222")

ax1.set_xlim(-9.5, 9.5)
ax1.set_ylim(-8.5, 8.5)
ax1.set_aspect("equal")
ax1.axis("off")

# ---- Panel 2: Stress Profile Along Height ----------------------------------
ax2.set_title("Stress Profile Along Height", fontsize=17, fontweight="bold", pad=18)

y_mm = y * 1e3  # plot height axis in mm for readability, matching c = h/2

ax2.plot(sigma_MPa, y_mm, color="#1f77b4", linewidth=3, zorder=3)
ax2.axhline(0, color="black", linewidth=1.4, zorder=2)
ax2.axvline(0, color="black", linewidth=1.0, zorder=1)

# dashed guide lines at extreme fibres
ax2.plot([0, sigma_max_MPa], [c * 1e3, c * 1e3], color="#1f77b4", linestyle="--", linewidth=1.3)
ax2.plot([0, -sigma_max_MPa], [-c * 1e3, -c * 1e3], color="#1f77b4", linestyle="--", linewidth=1.3)

# tension arrows (upper half, pointing right / away from N.A.)
for frac in (0.35, 0.65, 0.95):
    yy = frac * c * 1e3
    xx = frac * sigma_max_MPa
    ax2.annotate("", xy=(xx, yy), xytext=(0.15, yy),
                 arrowprops=dict(arrowstyle="->", color="#5dade2", lw=1.8))

# compression arrows (lower half, pointing left / toward N.A.)
for frac in (0.35, 0.65, 0.95):
    yy = -frac * c * 1e3
    xx = -frac * sigma_max_MPa
    ax2.annotate("", xy=(0.15, yy), xytext=(xx, yy),
                 arrowprops=dict(arrowstyle="<-", color="#e74c3c", lw=1.8))

# c = h/2 dimension line (left side)
c_dim_x = -sigma_max_MPa * 1.55
ax2.annotate("", xy=(c_dim_x, 0), xytext=(c_dim_x, c * 1e3),
             arrowprops=dict(arrowstyle="<->", color="#222222", lw=1.4))
ax2.text(c_dim_x - 1.5, c * 1e3 / 2, r"$c=\dfrac{h}{2}$", fontsize=15,
          ha="center", va="center", color="#222222")

# neutral axis label
ax2.text(c_dim_x + 2.3, -0.02 * abs(y_mm).max(), "N.A. (y=0)", fontsize=12,
          ha="left", va="top", color="#333333")

# tension / compression labels
ax2.text(sigma_max_MPa * 0.02, c * 1e3 * 1.12, "TENSION (+)", fontsize=14,
          fontweight="bold", color="#1f77b4", ha="left", va="bottom")
ax2.text(-sigma_max_MPa * 0.02, -c * 1e3 * 1.12, "COMPRESSION (-)", fontsize=14,
          fontweight="bold", color="#e74c3c", ha="right", va="top")

# sigma_max formula + value annotation at the top of the tension line
ax2.text(sigma_max_MPa * 1.03, c * 1e3, r"$\sigma_{max}=\dfrac{M \cdot c}{I}$" + f" = {sigma_max_MPa:.1f} MPa",
          fontsize=13, color="#1f77b4", ha="left", va="center")

ax2.set_xlim(-sigma_max_MPa * 1.9, sigma_max_MPa * 1.9)
ax2.set_ylim(-c * 1e3 * 1.55, c * 1e3 * 1.55)
ax2.axis("off")

fig.suptitle("cf_250 Arm — Flexural Bending Stress Distribution "
             r"($M_{max}$" + f" = {M_max:.3f} N·m)",
             fontsize=13, y=0.02, color="#555555")

plt.tight_layout(rect=[0, 0.03, 1, 1])

out_path = "/Users/ajith/Desktop/vlgen/exp-frame-structural-integrity-dei/experiment/images/arm_stress_distribution.png"
plt.savefig(out_path, dpi=200, bbox_inches="tight")
print(f"Saved: {out_path}")
