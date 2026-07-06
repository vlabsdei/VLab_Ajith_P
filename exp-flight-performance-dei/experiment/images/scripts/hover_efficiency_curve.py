"""
Generator for: exp-flight-performance-dei/experiment/images/hover_efficiency_curve.png

Accuracy basis (theory.md Section 6 + db.json efficiency + main.js Calc.efficiencyGperW):
  Momentum / actuator-disk hover power (theory.md S6):
        A        = N * pi * (D/2)^2                      (total disk area)
        P_ideal  = (m*g)^1.5 / sqrt(2 * rho * A)         (m in kg, T = m*g in N)
        P_hover  = P_ideal / FoM
        efficiency = m_total_g / P_hover   [g/W]
  Constants: rho = 1.225 kg/m^3, FoM = 0.70, g = 9.80665, N = 4.
  Three rotor disks compared (db.json prop_diameter_m):
        5"  -> D = 0.127 m   (2204_2300, reference)
        7"  -> D = 0.178 m   (2808_1200)
        10" -> D = 0.254 m   (2212_920)
  Reference point (5" disk, m = 500 g): A = 0.0507 m^2,
        P_hover = 4.903^1.5 / sqrt(2*1.225*0.0507) / 0.70 = 44.0 W
        efficiency = 500 / 44.0 = 11.36 g/W
  NOTE: FoM is held at 0.70 for all three disks to isolate the disk-area effect
        and reproduce the theory.md reference exactly (efficiency ~ 1/sqrt(m),
        and ~ sqrt(A): the 10" disk has 4x the area of the 5", so 2x efficiency).
  All curves are COMPUTED with numpy from the momentum-theory equation above.

Run:  python hover_efficiency_curve.py
"""
import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

OUT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(OUT_DIR, "hover_efficiency_curve.png")

# ---- house palette (simulation/css/main.css :root) ----
BG, ACCENT, DARK = "#ffffff", "#ffbf00", "#111827"
TXT2, TXT3, GRID = "#374151", "#6b7280", "#e5e7eb"
SURF, SURF2 = "#f9fafb", "#f3f4f6"
SUCCESS, WARNING, DANGER, BLUE = "#10b981", "#f59e0b", "#ef4444", "#2563eb"

plt.rcParams.update({
    "figure.dpi": 150, "savefig.dpi": 150,
    "font.family": "sans-serif",
    "font.sans-serif": ["Inter", "Segoe UI", "DejaVu Sans", "Arial"],
    "font.size": 11, "axes.titlesize": 13,
    "axes.edgecolor": "#cbd5e1", "axes.labelcolor": DARK, "text.color": DARK,
    "xtick.color": TXT2, "ytick.color": TXT2,
    "axes.facecolor": BG, "figure.facecolor": BG, "grid.color": GRID,
})

# ---- governing constants (db.json efficiency + constants) ----
N = 4
G = 9.80665          # m/s^2 (db.json constants.g_m_s2)
RHO = 1.225          # kg/m^3 (db.json efficiency.rho_kg_m3)
FOM = 0.70           # figure_of_merit_default (held constant across disks)


def disk_area(D):
    return N * np.pi * (D / 2.0) ** 2


def efficiency_gpw(m_g, D):
    """Hover efficiency [g/W] from momentum theory; mirrors Calc.efficiencyGperW."""
    A = disk_area(D)
    T = (m_g / 1000.0) * G                       # weight in N
    p_ideal = T ** 1.5 / np.sqrt(2.0 * RHO * A)
    p_hover = p_ideal / FOM
    return m_g / p_hover


# three propeller disks (label, diameter m, colour)
DISKS = [
    ('5" disk  (D = 0.127 m)', 0.127, DARK),
    ('7" disk  (D = 0.178 m)', 0.178, BLUE),
    ('10" disk  (D = 0.254 m)', 0.254, ACCENT),
]

# ---- COMPUTE efficiency vs all-up mass with numpy ----
mass = np.linspace(500.0, 2500.0, 1001)

fig, ax = plt.subplots(figsize=(11.4, 7.2))

for lab, D, col in DISKS:
    eff = efficiency_gpw(mass, D)
    ax.plot(mass, eff, color=col, lw=2.8, zorder=5, label=lab)

# reference point: 5" disk, 500 g -> 11.36 g/W
m_ref, D_ref = 500.0, 0.127
eff_ref = efficiency_gpw(m_ref, D_ref)
A_ref = disk_area(D_ref)
P_ref = m_ref / eff_ref
ax.plot([m_ref], [eff_ref], "o", ms=12, mfc=ACCENT, mec=DARK, mew=1.8,
        zorder=8)
ax.annotate(f"reference 5\" build\n{eff_ref:.2f} g/W   "
            f"($P_{{hover}}$ = {P_ref:.1f} W)", (m_ref, eff_ref),
            textcoords="offset points", xytext=(46, -6), fontsize=9.8,
            fontweight="bold", color="#9a6a00",
            arrowprops=dict(arrowstyle="->", color=DARK, lw=1.4))

# direction-of-improvement annotations
ax.annotate("larger disk -> more efficient", (0.5, 0.86),
            xycoords="axes fraction", ha="center", fontsize=9.4,
            color=TXT2)
ax.annotate("", xy=(0.5, 0.93), xytext=(0.5, 0.7),
            xycoords="axes fraction",
            arrowprops=dict(arrowstyle="-|>", color=TXT3, lw=1.8))
ax.text(0.965, 0.52, "efficiency falls\nas mass rises\n(P ~ thrust$^{1.5}$)",
        transform=ax.transAxes, ha="right", va="center", fontsize=9.0,
        color=TXT2)

ax.set_title("Hover Efficiency vs All-Up Mass (Momentum Theory) by Prop Size",
             fontweight="bold")
ax.set_xlabel("All-up mass  $m_{total}$  (g)")
ax.set_ylabel("Hover efficiency  (g/W)")
ax.set_xlim(500, 2500)
ax.set_ylim(0, 24)
ax.grid(True, alpha=0.35)
ax.legend(loc="upper right", title="propeller disk", fontsize=9.6,
          title_fontsize=9.8, framealpha=0.96)

# formula / constants box
ax.text(0.022, 0.045,
        (r"$A = N\pi(D/2)^{2}$,   $P_{hover}=\dfrac{(m g)^{1.5}}{FoM\,\sqrt{2\rho A}}$"
         + "\n"
         + r"efficiency $= m_{total}/P_{hover}$   [g/W]" + "\n"
         + r"$FoM=0.70$,  $\rho=1.225$ kg/m$^3$,  $N=4$"),
        transform=ax.transAxes, ha="left", va="bottom", fontsize=9.2,
        bbox=dict(boxstyle="round", fc=SURF2, ec="#cbd5e1", pad=0.5))

fig.tight_layout()
fig.savefig(OUT, dpi=150, bbox_inches="tight", facecolor=BG)
print("WROTE", OUT)
for lab, D, _ in DISKS:
    print(f"  {lab:28s} A={disk_area(D):.4f} m^2 ; eff@500g={efficiency_gpw(500.0, D):.2f} g/W")
print(f"  reference: A={A_ref:.4f} m^2 ; P_hover={P_ref:.2f} W ; eff={eff_ref:.2f} g/W")
assert abs(A_ref - 0.050671) < 1e-5
assert abs(P_ref - 44.0) < 0.15
assert abs(eff_ref - 11.36) < 0.02
# 10" disk has exactly 4x the area of the 5" -> exactly 2x efficiency at equal mass
assert abs(efficiency_gpw(500.0, 0.254) / eff_ref - 2.0) < 1e-6
print("  VERIFIED: 5\" 500g -> 11.36 g/W (P=44.0 W); 10\" disk = 2x efficiency")
