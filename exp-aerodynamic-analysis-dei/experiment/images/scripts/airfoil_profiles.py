"""
Generator for images/airfoil_profiles.png (Experiment 3 - Aerodynamic Analysis).

Reproduces the Module-1 "Airfoil Analysis" Cl-alpha chart exactly as computed by
simulation/js/main.js's Calc IIFE:

  - airfoilClFiniteWing(alpha_deg, airfoil)  -- the SOLID working-model curve
    plotted live for all three NACA sections (Prandtl lifting-line reduction
    of the 2-D sine-based post-stall model).
  - airfoilClThin(alpha_deg, airfoil) = 2*pi*(alpha - alpha0)  -- the DASHED
    thin-airfoil-theory reference line, overlaid only for the selected
    profile in the sim; we draw it for NACA 2412 (theory.md section 1's
    worked example uses 2412) to match the "two-line overlay" description.

Catalog constants pulled from main.js (ground truth, NOT theory.md prose):
  naca_airfoils (lines ~250-253 of main.js):
    naca_0012: alpha_0_deg=0,   stall_angle_deg=15, cl_max=1.2, cl_alpha_per_rad=6.283, ar_eff=6.0, oswald_e=0.85
    naca_2412: alpha_0_deg=-2,  stall_angle_deg=14, cl_max=1.4, cl_alpha_per_rad=6.283, ar_eff=6.0, oswald_e=0.85
    naca_4412: alpha_0_deg=-4,  stall_angle_deg=13, cl_max=1.6, cl_alpha_per_rad=6.283, ar_eff=6.0, oswald_e=0.85

Global constants (main.js lines ~1384-1399):
    TWO_PI = 2*pi, DEG_TO_RAD = pi/180, AR_EFF = 6.0, OSWALD_E = 0.85

NOTE: airfoilClFiniteWing clamps the attached-region curve to a PEAK value
(clStall) computed from the finite-wing (3-D) lift slope, not the raw 2-D
cl_max from the catalog:
    a3d   = a2d / (1 + a2d / (pi * e * AR))
    clStall = min(cl_max, a3d * (alpha_stall - alpha_0) * DEG_TO_RAD)
This is systematically LOWER than the nominal 2-D cl_max (e.g. NACA 0012's
computed peak is ~1.18, not the spec-sheet 1.2) because the finite wing's
lift-curve slope hasn't reached the 2-D cl_max by the time stall angle is
reached. The nominal catalog cl_max values are annotated separately as the
"spec-sheet" numbers referenced by theory.md / procedure.md, while the solid
curves and stall markers show the actual plotted (finite-wing) values.
"""
import numpy as np
import matplotlib.pyplot as plt

# ---- constants copied verbatim from main.js -------------------------------
TWO_PI = 2 * np.pi
DEG2RAD = np.pi / 180.0
AR_EFF = 6.0
OSWALD_E = 0.85

AIRFOILS = {
    "NACA 0012": dict(alpha_0_deg=0.0, stall_angle_deg=15.0, cl_max=1.2,
                       cl_alpha_per_rad=6.283, ar_eff=6.0, oswald_e=0.85,
                       color="#f59e0b"),
    "NACA 2412": dict(alpha_0_deg=-2.0, stall_angle_deg=14.0, cl_max=1.4,
                       cl_alpha_per_rad=6.283, ar_eff=6.0, oswald_e=0.85,
                       color="#10b981"),
    "NACA 4412": dict(alpha_0_deg=-4.0, stall_angle_deg=13.0, cl_max=1.6,
                       cl_alpha_per_rad=6.283, ar_eff=6.0, oswald_e=0.85,
                       color="#d99e00"),
}


def airfoil_cl_finite_wing(alpha_deg, af):
    """Exact port of main.js airfoilClFiniteWing()."""
    a0 = af["alpha_0_deg"]
    a_stall = af["stall_angle_deg"]
    cl_max = af["cl_max"]
    a2d = af.get("cl_alpha_per_rad", TWO_PI)
    AR = af.get("ar_eff", AR_EFF)
    e = af.get("oswald_e", OSWALD_E)
    a3d = a2d / (1 + a2d / (np.pi * e * AR))
    a_stall_neg = a0 - (a_stall - a0)
    cl_stall = min(cl_max, a3d * (a_stall - a0) * DEG2RAD)

    alpha_deg = np.atleast_1d(alpha_deg).astype(float)
    cl = np.empty_like(alpha_deg)

    above = alpha_deg > a_stall
    below = alpha_deg < a_stall_neg
    mid = ~above & ~below

    dd = alpha_deg[above] - a_stall
    cl[above] = cl_stall * np.maximum(0.70, 1 - 0.035 * dd)

    dn = a_stall_neg - alpha_deg[below]
    cl[below] = -cl_stall * np.maximum(0.70, 1 - 0.035 * dn)

    lin = a3d * (alpha_deg[mid] - a0) * DEG2RAD
    cl[mid] = np.clip(lin, -cl_stall, cl_stall)

    return cl, cl_stall


def airfoil_cl_thin(alpha_deg, af):
    """Exact port of main.js airfoilClThin() = 2*pi*(alpha - alpha0)."""
    a0 = af["alpha_0_deg"]
    return TWO_PI * (np.asarray(alpha_deg, dtype=float) - a0) * DEG2RAD


# ---- compute -----------------------------------------------------------
alpha = np.linspace(-5, 20, 400)

fig, ax = plt.subplots(figsize=(9, 6.2))

stall_pts = {}
for name, af in AIRFOILS.items():
    cl, cl_stall = airfoil_cl_finite_wing(alpha, af)
    ax.plot(alpha, cl, color=af["color"], lw=2.4, label=f"{name} (finite-wing, live model)")
    # stall marker: value AT the catalog stall angle (equals cl_stall by construction)
    a_stall = af["stall_angle_deg"]
    cl_at_stall, _ = airfoil_cl_finite_wing(np.array([a_stall]), af)
    stall_pts[name] = (a_stall, cl_at_stall[0], cl_stall)
    ax.plot(a_stall, cl_at_stall[0], marker="o", ms=8, color=af["color"],
            markeredgecolor="black", markeredgewidth=1.0, zorder=5)
    ax.annotate(f"STALL {a_stall:.0f}°\nCl={cl_at_stall[0]:.2f}",
                xy=(a_stall, cl_at_stall[0]),
                xytext=(a_stall + 1.0, cl_at_stall[0] + (0.12 if name != "NACA 0012" else -0.22)),
                fontsize=8.5, color=af["color"], fontweight="bold",
                arrowprops=dict(arrowstyle="-", color=af["color"], lw=0.8))

# thin-airfoil dashed reference line, NACA 2412 only (theory.md sec.1 worked example)
af2412 = AIRFOILS["NACA 2412"]
cl_thin = airfoil_cl_thin(alpha, af2412)
ax.plot(alpha, cl_thin, "--", color="#334155", lw=1.8,
        label=r"Thin-airfoil ref. (NACA 2412): $C_l=2\pi(\alpha-\alpha_0)$")

# worked-example point: alpha=5deg, NACA 2412, thin-airfoil value = 0.768
alpha_ex = 5.0
cl_ex_thin = float(airfoil_cl_thin(np.array([alpha_ex]), af2412)[0])
cl_ex_live, _ = airfoil_cl_finite_wing(np.array([alpha_ex]), af2412)
ax.plot(alpha_ex, cl_ex_thin, marker="x", ms=10, mew=2.2, color="#334155", zorder=6)
ax.annotate(f"Worked ex.: α=5°\nthin Cl={cl_ex_thin:.3f}",
            xy=(alpha_ex, cl_ex_thin), xytext=(alpha_ex - 4.6, cl_ex_thin - 0.55),
            fontsize=8.5, color="#334155",
            arrowprops=dict(arrowstyle="->", color="#334155", lw=1.0))

assert abs(cl_ex_thin - 0.768) < 0.01, cl_ex_thin

ax.axhline(0, color="black", lw=0.6)
ax.axvline(0, color="black", lw=0.6)
ax.set_xlabel(r"Angle of Attack, $\alpha$ (deg)", fontsize=11)
ax.set_ylabel(r"Lift Coefficient, $C_l$", fontsize=11)
ax.set_title("Airfoil $C_l$-$\\alpha$ Curves — NACA 0012 / 2412 / 4412\n"
              "(finite-wing working model, live BEMT solve) vs. thin-airfoil reference",
              fontsize=12)
ax.set_xlim(-5, 20)
ax.set_ylim(-1.0, 1.8)
ax.grid(True, alpha=0.3)
ax.legend(loc="upper left", fontsize=8.5, framealpha=0.9)

txt = (
    "Nominal spec-sheet $C_{l,max}$ (catalog, main.js):\n"
    "  NACA 4412 ≈ 1.6  (stall 13°)\n"
    "  NACA 2412 ≈ 1.4  (stall 14°)\n"
    "  NACA 0012 ≈ 1.2  (stall 15°)\n"
    "Trade-off: 4412 > 2412 > 0012 in $C_{l,max}$,\n"
    "but stalls at a lower angle of attack.\n"
    "(Plotted finite-wing peaks are slightly\n"
    "lower — Prandtl lifting-line reduction.)"
)
ax.text(0.98, 0.03, txt, transform=ax.transAxes, fontsize=8.2,
        va="bottom", ha="right",
        bbox=dict(boxstyle="round", facecolor="white", edgecolor="#94a3b8", alpha=0.95))

fig.tight_layout()
out_path = "/Users/ajith/Desktop/vlgen/exp-aerodynamic-analysis-dei/experiment/images/airfoil_profiles.png"
fig.savefig(out_path, dpi=150, bbox_inches="tight")
print("Saved:", out_path)
print("Stall points (finite-wing, plotted):", stall_pts)
print("Worked example thin-Cl at alpha=5, NACA2412:", cl_ex_thin, " (expect ~0.768)")
