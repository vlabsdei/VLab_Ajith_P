"""
Generator for: exp-power-electronics-esc-dei/experiment/images/pwm_signal_diagram.png

Accuracy basis (theory.md Sections 1-2 + simulation/js/main.js Calc + db.json calibration):
  - Servo-PWM throttle map (theory.md S1, Calc.throttleFromPulse):
        Throttle% = (PW - PW_min) / (PW_max - PW_min) * 100
  - Arming dead-band gate (theory.md S2, Calc.effectiveThrottle):
        Throttle_eff = 0           for PW <= PW_min + PW_deadband = 1050 us
        Throttle_eff = linear map  for PW > 1050 us
  - Constants (db.json calibration / main.js Calc):
        PW_min      = 1000 us   (0% throttle, armed idle)
        PW_max      = 2000 us   (100% throttle)
        PW_range    = 1000 us
        deadband    = 50 us  -> deadband edge = 1050 us
        neutral     = 1500 us  -> exactly 50% throttle
  TOP panel : three PWM pulse trains (1000 / 1500 / 2000 us) as square waves on a
              common time axis, pulse WIDTH dimensioned, PW_min / PW_max marked.
  BOTTOM    : the COMPUTED throttle-mapping line (numpy) 0 -> 100%, dead-band
              shaded, effective-throttle gate held at 0, 1500 us -> 50% marker.

Run:  python pwm_signal_diagram.py
"""
import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle

# images/ folder is the parent of this scripts/ folder
OUT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(OUT_DIR, "pwm_signal_diagram.png")

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

# ---- governing constants (db.json calibration / main.js Calc) ----
PW_MIN, PW_MAX = 1000.0, 2000.0
PW_RANGE = PW_MAX - PW_MIN            # 1000 us
DEADBAND = 50.0
DB_EDGE = PW_MIN + DEADBAND           # 1050 us
NEUTRAL = 1500.0


def throttle_pct(pw):
    """Raw servo-PWM map (theory.md S1)."""
    return (pw - PW_MIN) / PW_RANGE * 100.0


def effective_throttle(pw):
    """Dead-band-gated effective throttle (theory.md S2 / Calc.effectiveThrottle)."""
    return np.where(pw <= DB_EDGE, 0.0, (pw - PW_MIN) / PW_RANGE * 100.0)


fig, (axT, axB) = plt.subplots(2, 1, figsize=(11, 9.6),
                               gridspec_kw={"height_ratios": [1.0, 1.05]})

# ===================================================================
# TOP PANEL : three PWM pulse trains (square waves), pulse-width dimensioned
# ===================================================================
T0 = 250.0          # common rising edge (us)
TMAX = 2520.0       # time-axis span (us)
AMP = 0.92          # pulse height (drawing units)
ROW_GAP = 1.60

# rows top -> bottom: 0% (1000us), 50% (1500us), 100% (2000us)
rows = [
    (1000.0, "0%",   "armed idle",   TXT3),
    (1500.0, "50%",  "neutral",      ACCENT),
    (2000.0, "100%", "full power",   DARK),
]
ybases = [2 * ROW_GAP, 1 * ROW_GAP, 0.0]

axT.set_xlim(-40, TMAX)
axT.set_ylim(-0.75, 3 * ROW_GAP + AMP + 0.55)

# PW_min / PW_max vertical guide lines (falling edges of 1000 & 2000 us pulses)
for xline, lbl, col in [(T0 + PW_MIN, r"$PW_{min}=1000\ \mu s$", DARK),
                        (T0 + PW_MAX, r"$PW_{max}=2000\ \mu s$", DARK)]:
    axT.axvline(xline, color=col, lw=1.0, ls="--", alpha=0.55, zorder=1)
    axT.text(xline, 3 * ROW_GAP + AMP + 0.30, lbl, ha="center", va="bottom",
             fontsize=9.5, color=col, fontweight="bold")
# common rising edge guide
axT.axvline(T0, color=TXT3, lw=1.0, ls=":", alpha=0.7, zorder=1)
axT.text(T0, -0.62, "common\nrising edge", ha="center", va="bottom",
         fontsize=8, color=TXT3)

for (pw, tpct, sub, col), yb in zip(rows, ybases):
    hi = yb + AMP
    # perfect square pulse: low -> rising edge -> high plateau -> falling edge -> low
    xs = [-40, T0, T0, T0 + pw, T0 + pw, TMAX]
    ys = [yb, yb, hi, hi, yb, yb]
    axT.plot(xs, ys, color=DARK, lw=2.3, solid_capstyle="round", zorder=4)
    axT.fill_between([T0, T0 + pw], yb, hi, color=ACCENT, alpha=0.16, zorder=2)
    # throttle label on the left
    axT.text(-20, yb + AMP / 2, f"{tpct}\nthrottle", ha="left", va="center",
             fontsize=10.5, fontweight="bold", color=col)
    axT.text(-20, yb - 0.20, sub, ha="left", va="center", fontsize=8, color=TXT3)
    # pulse-width dimension arrow (inside the high plateau) + label above
    ymid = yb + AMP * 0.52
    axT.annotate("", xy=(T0 + pw, ymid), xytext=(T0, ymid),
                 arrowprops=dict(arrowstyle="<|-|>", color=DANGER, lw=1.7,
                                 shrinkA=0, shrinkB=0))
    axT.text(T0 + pw / 2, hi + 0.10, fr"$PW={pw:.0f}\ \mu s$", ha="center",
             va="bottom", fontsize=10, color=DANGER, fontweight="bold")

axT.set_title("Servo-PWM throttle pulses: pulse WIDTH encodes throttle "
              "(not frequency or voltage)", fontweight="bold")
axT.set_xlabel(r"time within refresh frame  ($\mu s$)")
axT.set_yticks([])
axT.set_xticks(np.arange(0, 2501, 500))
axT.grid(True, axis="x", alpha=0.4)
for s in ("left", "right", "top"):
    axT.spines[s].set_visible(False)

# ===================================================================
# BOTTOM PANEL : COMPUTED throttle-mapping line + dead-band gate
# ===================================================================
pw = np.linspace(PW_MIN, PW_MAX, 1001)          # us
thr = throttle_pct(pw)                          # raw linear map (computed)
eff = effective_throttle(pw)                    # dead-band-gated (computed)

# dead-band shaded band
axB.axvspan(PW_MIN, DB_EDGE, color=WARNING, alpha=0.16, zorder=1)
axB.text((PW_MIN + DB_EDGE) / 2, 92, "dead-band\n(1000-1050 $\\mu s$)\n$\\to$ 0%",
         ha="center", va="top", fontsize=9, color="#9a6a00", fontweight="bold")

# raw linear throttle map (the hero straight line)
axB.plot(pw, thr, color=DARK, lw=2.6, zorder=4,
         label=r"raw map  $Throttle\% = \dfrac{PW-1000}{1000}\times100$")
# effective throttle (gated to 0 inside the dead-band)
db_mask = pw <= DB_EDGE
axB.plot(pw[db_mask], eff[db_mask], color=DANGER, lw=4.0, solid_capstyle="round",
         zorder=6, label="effective throttle (dead-band gate) = 0")
# the gate step at 1050 us
axB.plot([DB_EDGE, DB_EDGE], [0, throttle_pct(DB_EDGE)], color=DANGER, lw=1.4,
         ls=":", zorder=5)

# worked-example points (theory.md S1 table)
pw_pts = np.array([1000, 1250, 1500, 1750, 2000.0])
thr_pts = throttle_pct(pw_pts)
axB.plot(pw_pts, thr_pts, "o", ms=7, mfc=BG, mec=DARK, mew=1.6, zorder=7)
for x, y in zip(pw_pts, thr_pts):
    axB.annotate(f"{y:.0f}%", (x, y), textcoords="offset points",
                 xytext=(-12, 8), fontsize=8.5, color=TXT2)

# neutral 1500 us -> 50% highlight (accent, used sparingly)
axB.plot([NEUTRAL], [50.0], "o", ms=13, mfc=ACCENT, mec="#9a7d00", mew=1.7,
         zorder=8)
axB.annotate(r"neutral 1500 $\mu s$  $\to$  50%",
             xy=(NEUTRAL, 50.0), xytext=(1545, 33),
             fontsize=10.5, fontweight="bold", color="#7a6200",
             arrowprops=dict(arrowstyle="->", color="#9a7d00", lw=1.6))
axB.plot([PW_MIN, NEUTRAL], [50, 50], color="#9a7d00", lw=0.8, ls=":")
axB.plot([NEUTRAL, NEUTRAL], [0, 50], color="#9a7d00", lw=0.8, ls=":")

# dead-band edge + first spinning point (1100 us -> 10%, theory.md S2 table)
axB.plot([DB_EDGE], [0], "s", ms=7, mfc=DANGER, mec="#7f1d1d", mew=1.2, zorder=8)
axB.annotate("1050 $\\mu s$ edge\n(motor still)", (DB_EDGE, 0),
             textcoords="offset points", xytext=(10, 14), fontsize=8.2,
             color="#7f1d1d")
axB.plot([1100], [throttle_pct(1100)], "^", ms=8, mfc=SUCCESS, mec="#065f46",
         mew=1.2, zorder=8)
axB.annotate("1100 $\\mu s$\n$\\to$ 10% (spins)", (1100, 10),
             textcoords="offset points", xytext=(8, -30), fontsize=8.2,
             color="#065f46")

axB.set_title("Pulse-width -> throttle mapping with arming dead-band",
              fontweight="bold")
axB.set_xlabel(r"Pulse width  $PW$  ($\mu s$)")
axB.set_ylabel("Throttle command (%)")
axB.set_xlim(PW_MIN - 8, PW_MAX + 8)
axB.set_ylim(-4, 104)
axB.set_xticks(np.arange(1000, 2001, 100))
axB.grid(True, alpha=0.4)
axB.legend(loc="upper left", fontsize=9.2, framealpha=0.95)

# formula / constants box
axB.text(0.985, 0.06,
         (r"$PW_{min}=1000\ \mu s,\ PW_{max}=2000\ \mu s$" + "\n"
          + r"$PW_{range}=1000\ \mu s,\ deadband=50\ \mu s$" + "\n"
          + r"slope $=0.1\%$ per $\mu s$"),
         transform=axB.transAxes, ha="right", va="bottom", fontsize=9,
         bbox=dict(boxstyle="round", fc=SURF2, ec="#cbd5e1", pad=0.5))

fig.suptitle("Servo-PWM Throttle Signal & Throttle Mapping (Sub-Calc A)",
             fontsize=14.5, fontweight="bold")
fig.tight_layout(rect=[0, 0, 1, 0.965])
fig.savefig(OUT, dpi=150, bbox_inches="tight", facecolor=BG)
print("WROTE", OUT)
print(f"  1000 us -> {throttle_pct(1000):.0f}% ,  1500 us -> {throttle_pct(1500):.0f}% ,"
      f"  2000 us -> {throttle_pct(2000):.0f}%")
print(f"  dead-band edge {DB_EDGE:.0f} us: raw={throttle_pct(DB_EDGE):.1f}%, "
      f"effective={float(effective_throttle(np.array([DB_EDGE]))[0]):.1f}%")
print(f"  1100 us -> effective {float(effective_throttle(np.array([1100.0]))[0]):.0f}%")
assert throttle_pct(1500) == 50.0, "neutral must map to 50%"
assert float(effective_throttle(np.array([DB_EDGE]))[0]) == 0.0, "deadband edge must gate to 0"
print("  VERIFIED: 1500us->50%, deadband<=1050us->0%")
