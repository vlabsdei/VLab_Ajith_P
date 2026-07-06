"""
Generator for: exp-power-electronics-esc-dei/experiment/images/resolution_latency_diagram.png

Accuracy basis (theory.md Section 3 + procedure Stage 3 + db.json pwm_protocols):
  - Command resolution (theory.md S3, Calc.commandSteps / percentPerStep):
        N_steps = PW_range / t_tick = 1000 us / 1 us = 1000 steps  (0.1% per step)
    Depends ONLY on the timer tick + pulse band -> identical at every refresh rate.
  - Refresh latency (theory.md S3, Calc.refreshLatencyMs):
        tau = 1 / f         ->  50 Hz : 20 ms      400 Hz : 2.5 ms   (8x better)
  - Frame period (Calc.periodUs):  T = 1e6 / f  ->  20000 us  vs  2500 us
  - Pulse duty (Calc.dutyPct):     PW / T
        50 Hz : 1000-2000 us in 20000 us  ->  5-10 %  (db.json pwm_50)
        400 Hz: 1000-2000 us in  2500 us  -> 40-80 %  (db.json pwm_400)
  Both rows show the SAME 1500 us (50%) command pulse on a common 20 ms axis:
  same resolution (1000 steps), different latency (8x). All waveforms COMPUTED
  with numpy.

Run:  python resolution_latency_diagram.py
"""
import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch

OUT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(OUT_DIR, "resolution_latency_diagram.png")

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

# ---- governing constants (db.json pwm_protocols + calibration) ----
PW_RANGE, TICK = 1000.0, 1.0
N_STEPS = PW_RANGE / TICK               # 1000 steps
PCT_PER_STEP = 100.0 / N_STEPS          # 0.1 %
PW_DISP = 1500.0                        # representative 50% command pulse
AXIS_US = 20000.0                       # common 20 ms time window

cases = [
    dict(f=50,  period=20000.0, base=5.15, color=TXT3,   name="50 Hz  (legacy servo PWM)"),
    dict(f=400, period=2500.0,  base=1.75, color=DARK,   name="400 Hz  (Oneshot / fast PWM)"),
]
AMP = 1.15

t = np.arange(0.0, AXIS_US + 1.0, 1.0)  # 1 us grid -> crisp square edges

fig, ax = plt.subplots(figsize=(13.2, 7.6))
ax.set_xlim(-900, AXIS_US + 900)
ax.set_ylim(0, 7.7)


def duty(period):
    return PW_DISP / period * 100.0


for c in cases:
    base, period, col = c["base"], c["period"], c["color"]
    mask = (t % period) < PW_DISP                  # COMPUTED square wave
    yhi = base + AMP * mask
    ax.fill_between(t, base, yhi, color=ACCENT, alpha=0.85, lw=0, zorder=3)
    ax.plot(t, yhi, color=col, lw=1.6, zorder=4)
    ax.plot([-900, AXIS_US + 900], [base, base], color=col, lw=1.0, alpha=0.4,
            zorder=2)

    # frame-boundary dashed lines
    edges = np.arange(0, AXIS_US + 1, period)
    for e in edges:
        ax.plot([e, e], [base, base + AMP + 0.12], color="#cbd5e1", lw=0.9,
                ls="--", zorder=2)

    # row label
    ax.text(-850, base + AMP / 2, c["name"], ha="left", va="center",
            fontsize=10.5, fontweight="bold", color=col, rotation=90)

    # resolution band: the 1000-2000 us pulse band in the first frame
    ax.fill_between([1000, 2000], base, base + AMP, color=BLUE, alpha=0.12,
                    zorder=2)
    ax.plot([1000, 1000], [base, base + AMP], color=BLUE, lw=0.8, ls=":",
            zorder=3)
    ax.plot([2000, 2000], [base, base + AMP], color=BLUE, lw=0.8, ls=":",
            zorder=3)

    # number of frames + duty annotation
    nframes = int(round(AXIS_US / period))
    ax.text(AXIS_US, base + AMP + 0.16,
            f"{nframes} frame{'s' if nframes > 1 else ''} in 20 ms   |   "
            f"duty {duty(period):.1f}%  (range {1000/period*100:.0f}-{2000/period*100:.0f}%)",
            ha="right", va="bottom", fontsize=8.8, color=TXT2)

# ---- latency dimension arrows (one frame period each) ----
# 50 Hz: full 20 ms
y50 = cases[0]["base"] - 0.34
ax.annotate("", xy=(20000, y50), xytext=(0, y50),
            arrowprops=dict(arrowstyle="<|-|>", color=DANGER, lw=2.0))
ax.text(10000, y50 - 0.06, r"latency $\tau = 1/f = 20$ ms", ha="center",
        va="top", fontsize=10, color=DANGER, fontweight="bold")
# 400 Hz: 2.5 ms
y400 = cases[1]["base"] - 0.34
ax.annotate("", xy=(2500, y400), xytext=(0, y400),
            arrowprops=dict(arrowstyle="<|-|>", color=DANGER, lw=2.0))
ax.text(2750, y400 - 0.02, r"$\tau = 1/f = 2.5$ ms", ha="left", va="top",
        fontsize=10, color=DANGER, fontweight="bold")

# ---- "8x" latency-improvement callout placed cleanly in the gap between rows ----
gap_y = (cases[0]["base"] + cases[1]["base"] + AMP) / 2  # midway between rows
ax.text(13600, gap_y, "8x lower latency\n(20 ms -> 2.5 ms)", ha="center",
        va="center", fontsize=11, color="#15803d", fontweight="bold",
        bbox=dict(boxstyle="round", fc="#ecfdf5", ec="#86efac", pad=0.5))

# ---- resolution banner (identical for both) ----
ax.add_patch(FancyBboxPatch((400, 6.75), 19200, 0.78,
             boxstyle="round,pad=0.02,rounding_size=0.06",
             fc="#eff6ff", ec=BLUE, lw=1.6, zorder=5,
             transform=ax.transData))
ax.text(10000, 7.14,
        r"Resolution $N_{steps} = PW_{range}/t_{tick} = 1000\,\mu s / 1\,\mu s = "
        r"1000$ steps  =  0.1% per step   -   IDENTICAL at every refresh rate",
        ha="center", va="center", fontsize=10.5, fontweight="bold", color=DARK,
        zorder=6)

# blue tag on each row: same 1000 steps
for c in cases:
    ax.text(1500, c["base"] + AMP + 0.0, "1000-2000 $\\mu s$\n1000 steps",
            ha="center", va="bottom", fontsize=7.4, color=BLUE, zorder=6)

# representative command note
ax.text(10000, 0.34,
        r"Both rows carry the SAME 1500 $\mu s$ (50%) command pulse "
        r"(accent) - identical resolution, only the refresh latency differs.",
        ha="center", va="center", fontsize=9.2, color=TXT2)

# x-axis in ms
ax.set_xticks(np.arange(0, 20001, 2500))
ax.set_xticklabels([f"{x/1000:g}" for x in np.arange(0, 20001, 2500)])
ax.set_xlabel("time (ms)  -  common 20 ms window")
ax.set_yticks([])
ax.grid(True, axis="x", alpha=0.35)
for s in ("left", "right", "top"):
    ax.spines[s].set_visible(False)

ax.set_title("Control Resolution vs Refresh Latency: 50 Hz vs 400 Hz (Sub-Calc B)",
             fontsize=14, fontweight="bold", pad=12)
fig.tight_layout()
fig.savefig(OUT, dpi=150, bbox_inches="tight", facecolor=BG)
print("WROTE", OUT)
print(f"  N_steps = {N_STEPS:.0f} (0.1%/step) IDENTICAL for both")
print(f"  latency 50 Hz = {1000/50:.1f} ms ;  400 Hz = {1000/400:.1f} ms ;  ratio = {(1000/50)/(1000/400):.0f}x")
print(f"  duty 50 Hz @1500us = {duty(20000):.1f}% (range 5-10%) ;  400 Hz = {duty(2500):.1f}% (range 40-80%)")
assert N_STEPS == 1000.0
assert (1000/50) / (1000/400) == 8.0
print("  VERIFIED: 1000 steps both; latency 20ms vs 2.5ms = 8x")
