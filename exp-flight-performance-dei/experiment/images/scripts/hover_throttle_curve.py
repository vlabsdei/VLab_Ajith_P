"""
Generator for: exp-flight-performance-dei/experiment/images/hover_throttle_curve.png

Accuracy basis (theory.md Sections 3-4 + db.json hover + simulation/js/main.js Calc):
  Quadratic propeller thrust curve (theory.md S3, Calc.thrustAtThrottle):
        T(throttle) = T_max * throttle^2        (T ~ RPM^2 ~ throttle^2)
  Hover thrust per motor (theory.md S3, Calc.hoverThrustPerMotorG):
        T_hover = m_total * g / N = 500 / 4 = 125 g   (grams-force)
  Hover throttle (theory.md S3, Calc.hoverThrottle):
        hover throttle = sqrt(T_hover / T_max) = sqrt(1 / TWR)
                       = sqrt(125 / 620) = 0.4490 -> 44.9 %
  Control margin (theory.md S4, Calc.controlMarginPct):
        control margin = (1 - hover throttle) x 100 = 55.1 %
  Reference 5" build: T_max = 620 g (2204_2300), m = 500 g, N = 4, TWR = 4.96.
  The thrust curve is COMPUTED with numpy from T = T_max * throttle^2.

Run:  python hover_throttle_curve.py
"""
import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

OUT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(OUT_DIR, "hover_throttle_curve.png")

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

# ---- governing constants (db.json + theory.md worked example) ----
N = 4                        # motor_count
T_MAX = 620.0                # g/motor (2204_2300)
M_TOTAL = 500.0              # g (empty reference build)
TWR = N * T_MAX / M_TOTAL    # 4.96
T_HOVER = M_TOTAL / N        # 125 g per motor
HOVER_THR = np.sqrt(T_HOVER / T_MAX)   # = sqrt(1/TWR) = 0.44901
HOVER_PCT = HOVER_THR * 100.0          # 44.90 %
MARGIN_PCT = (1.0 - HOVER_THR) * 100.0  # 55.10 %

# ---- COMPUTE the quadratic thrust curve with numpy ----
thr_pct = np.linspace(0.0, 100.0, 1001)
T = T_MAX * (thr_pct / 100.0) ** 2     # T = T_max * throttle^2

fig, ax = plt.subplots(figsize=(11.4, 7.2))

# control-margin band (throttle above hover -> reserve for manoeuvres);
# placed in the open upper-right of the shaded band, clear of the bottom-
# right formula box, the T_max label and the hover-point annotation
ax.axvspan(HOVER_PCT, 100.0, color=ACCENT, alpha=0.12, zorder=0)
ax.text(78.0, 480.0,
        f"control margin\n{MARGIN_PCT:.1f} %", ha="center", va="center",
        fontsize=10, fontweight="bold", color="#9a7d00")

# ideal ~50% sweet-spot reference (subtle)
ax.axvline(50.0, color=TXT3, lw=1.2, ls=":", zorder=1)
ax.text(50.3, 600.0, "ideal ~50%", ha="left", va="top", fontsize=8.6,
        color=TXT3, rotation=90)

# quadratic thrust curve (COMPUTED)
ax.plot(thr_pct, T, color=DARK, lw=2.8, zorder=5,
        label=r"$T(\mathrm{throttle}) = T_{max}\,\mathrm{throttle}^{2}$,  $T_{max}=620$ g")

# T_max reference at full throttle (placed clear of the upper-left legend
# box and the "ideal ~50%" line, over open plot area to the right of both)
ax.axhline(T_MAX, color=TXT3, lw=1.0, ls=(0, (2, 3)), zorder=2)
ax.text(60.0, T_MAX - 8, r"$T_{max}=620$ g (full throttle)", ha="left",
        va="top", fontsize=8.8, color=TXT3)

# hover thrust line (T_hover = 125 g)
ax.axhline(T_HOVER, color=SUCCESS, lw=1.8, ls="--", zorder=3,
           label=r"$T_{hover}=m\,g/N = 500/4 = 125$ g")

# hover throttle vertical line
ax.axvline(HOVER_PCT, color=DARK, lw=1.6, ls="-.", alpha=0.7, zorder=3)

# operating point
ax.plot([HOVER_PCT], [T_HOVER], "o", ms=12, mfc=ACCENT, mec=DARK, mew=1.8,
        zorder=7)
ax.annotate(f"hover @ {HOVER_PCT:.1f}% throttle\n"
            r"$\sqrt{1/TWR}=\sqrt{125/620}$",
            (HOVER_PCT, T_HOVER), textcoords="offset points",
            xytext=(20, 70), fontsize=10, fontweight="bold", color="#9a6a00",
            arrowprops=dict(arrowstyle="->", color=DARK, lw=1.4))

# hover-throttle tick callout on the x-axis
ax.annotate(f"{HOVER_PCT:.1f}%", (HOVER_PCT, 0), textcoords="offset points",
            xytext=(0, -26), ha="center", fontsize=9.5, fontweight="bold",
            color=DARK,
            arrowprops=dict(arrowstyle="->", color=DARK, lw=1.2))

ax.set_title("Quadratic Propeller Thrust Curve & Hover Operating Point",
             fontweight="bold")
ax.set_xlabel("Throttle  (%)")
ax.set_ylabel("Thrust per motor  $T$  (g)")
ax.set_xlim(0, 100)
ax.set_ylim(0, 660)
ax.grid(True, alpha=0.35)
ax.legend(loc="upper left", fontsize=9.4, framealpha=0.96)

# formula / constants box
ax.text(0.985, 0.045,
        (r"$T \propto \mathrm{RPM}^{2} \propto \mathrm{throttle}^{2}$" + "\n"
         + r"hover throttle $=\sqrt{T_{hover}/T_{max}}=\sqrt{1/TWR}$" + "\n"
         + r"$=\sqrt{125/620}=\mathbf{44.9\%}$,  margin $=\mathbf{55.1\%}$"),
        transform=ax.transAxes, ha="right", va="bottom", fontsize=9.2,
        bbox=dict(boxstyle="round", fc=SURF2, ec="#cbd5e1", pad=0.5))

fig.tight_layout()
fig.savefig(OUT, dpi=150, bbox_inches="tight", facecolor=BG)
print("WROTE", OUT)
print(f"  T_max={T_MAX} g, T_hover={T_HOVER} g, TWR={TWR:.4f}")
print(f"  hover throttle = {HOVER_PCT:.2f} % ; control margin = {MARGIN_PCT:.2f} %")
assert abs(T_HOVER - 125.0) < 1e-9
assert abs(HOVER_PCT - 44.9013) < 1e-3
assert abs(MARGIN_PCT - 55.0987) < 1e-3
# sanity: curve passes through the operating point
assert abs(T_MAX * HOVER_THR ** 2 - T_HOVER) < 1e-9
print("  VERIFIED: hover 44.9% throttle, 55.1% margin, T(hover)=125 g")
