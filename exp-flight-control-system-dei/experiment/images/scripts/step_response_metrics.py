"""
Generator for: exp-flight-control-system-dei/experiment/images/step_response_metrics.png

Accuracy basis (theory.md Sections 2-3 + simulation/js/main.js Calc):
  Closed loop with PD on 1/(J s^2) is the 2nd-order prototype
        s^2 + 2*zeta*wn*s + wn^2,
  with (theory.md S2, main.js naturalFreq / dampingRatio):
        wn   = sqrt(Kp / J)
        zeta = Kd / (2*sqrt(Kp*J))
  Analytic unit-step response (main.js Calc.secondOrderStep, underdamped):
        wd  = wn*sqrt(1 - zeta^2)
        phi = acos(zeta)
        y(t) = 1 - e^{-zeta*wn*t}/sqrt(1-zeta^2) * sin(wd*t + phi)
  Step-response metrics (theory.md S3 table, main.js):
        Mp = 100*e^{-pi*zeta/sqrt(1-zeta^2)} %      (peak overshoot)
        tp = pi/(wn*sqrt(1-zeta^2))                 (peak time)
        tr = (pi - acos(zeta))/(wn*sqrt(1-zeta^2))  (0-100% rise time)
        ts = 4/(zeta*wn)                            (2% settling time)

  Reference gains (db.json pid.defaults, theory.md worked examples):
        Kp = 0.6, Kd = 0.04, J = 0.003 kg.m^2
        => wn = 14.142 rad/s, zeta = 0.4714,
           Mp = 18.65 %, tp = 0.252 s, tr = 0.165 s, ts = 0.60 s

Run:  python step_response_metrics.py
"""
import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

OUT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(OUT_DIR, "step_response_metrics.png")

# ---- house palette ----
BG, ACCENT, DARK = "#ffffff", "#ffbf00", "#111827"
TXT2, TXT3, GRID = "#374151", "#6b7280", "#e5e7eb"
SURF = "#f9fafb"
SUCCESS, WARNING, DANGER, BLUE = "#10b981", "#f59e0b", "#ef4444", "#2563eb"

plt.rcParams.update({
    "figure.dpi": 150, "savefig.dpi": 150,
    "font.family": "sans-serif",
    "font.sans-serif": ["Inter", "Segoe UI", "DejaVu Sans", "Arial"],
    "font.size": 11, "text.color": DARK,
    "axes.facecolor": BG, "figure.facecolor": BG,
    "axes.edgecolor": TXT3, "axes.labelcolor": DARK,
    "xtick.color": TXT2, "ytick.color": TXT2,
})

# ---- reference gains / inertia (db.json pid.defaults, theory.md) ----
Kp, Kd, J = 0.6, 0.04, 0.003

# ---- COMPUTE the prototype 2nd-order quantities (mirror main.js Calc) ----
wn = np.sqrt(Kp / J)
zeta = Kd / (2.0 * np.sqrt(Kp * J))
wd = wn * np.sqrt(1.0 - zeta**2)
phi = np.arccos(zeta)

Mp = 100.0 * np.exp(-np.pi * zeta / np.sqrt(1.0 - zeta**2))   # %
tp = np.pi / wd
tr = (np.pi - np.arccos(zeta)) / wd
ts = 4.0 / (zeta * wn)


def step_response(t):
    """Analytic underdamped unit-step response (main.js Calc.secondOrderStep)."""
    y = 1.0 - np.exp(-zeta * wn * t) / np.sqrt(1.0 - zeta**2) * np.sin(wd * t + phi)
    return np.where(t <= 0.0, 0.0, y)


# ---- compute the curve ----
t = np.linspace(0.0, 1.2, 2400)
y = step_response(t)

y_peak = step_response(np.array([tp]))[0]      # = 1 + Mp/100
y_tr = step_response(np.array([tr]))[0]        # crosses 1.0 at the rise time

# ---- plot ----
fig, ax = plt.subplots(figsize=(11.4, 6.6))

# +/-2% settling band around the setpoint
ax.axhspan(0.98, 1.02, color=SUCCESS, alpha=0.13, zorder=0)
ax.text(1.19, 1.012, r"$\pm 2\%$ band", ha="right", va="bottom", fontsize=8.6,
        color="#0b7a52")

# setpoint
ax.axhline(1.0, color=TXT3, lw=1.4, ls="--", zorder=2)
ax.text(0.012, 1.005, "setpoint = 1.0", ha="left", va="bottom", fontsize=9.2,
        color=TXT2)

# the computed response
ax.plot(t, y, color=ACCENT, lw=3.0, zorder=5,
        label=r"$y(t)=1-\dfrac{e^{-\zeta\omega_n t}}{\sqrt{1-\zeta^2}}\,"
              r"\sin(\omega_d t+\phi)$")

# --- peak overshoot Mp ---
ax.plot([tp], [y_peak], "o", ms=10, mfc=DANGER, mec="#7f1d1d", mew=1.4, zorder=7)
ax.annotate(rf"peak overshoot  $M_p={Mp:.2f}\%$",
            xy=(tp, y_peak), xytext=(tp + 0.12, y_peak + 0.045),
            fontsize=11, fontweight="bold", color=DANGER,
            arrowprops=dict(arrowstyle="->", color=DANGER, lw=1.6))
# overshoot bracket from 1.0 up to peak
ax.annotate("", xy=(tp, y_peak), xytext=(tp, 1.0),
            arrowprops=dict(arrowstyle="<->", color=DANGER, lw=1.3))
ax.text(tp - 0.018, (1.0 + y_peak) / 2, rf"{Mp:.1f}%", ha="right", va="center",
        fontsize=9.2, color=DANGER)

# --- peak time tp (vertical drop) ---
ax.plot([tp, tp], [0, y_peak], color=DANGER, lw=1.0, ls=":", zorder=3)
ax.annotate(rf"$t_p={tp:.3f}$ s", xy=(tp, 0.0), xytext=(tp + 0.02, 0.10),
            fontsize=10, color=DANGER, ha="left", va="bottom")

# --- rise time tr (0 -> 100%) ---
ax.plot([tr], [y_tr], "o", ms=8, mfc=BLUE, mec="#1e3a8a", mew=1.3, zorder=7)
ax.plot([tr, tr], [0, y_tr], color=BLUE, lw=1.0, ls=":", zorder=3)
ax.annotate(rf"rise time  $t_r={tr:.3f}$ s",
            xy=(tr, y_tr), xytext=(tr - 0.02, 0.46),
            fontsize=10.5, fontweight="bold", color=BLUE, ha="right",
            arrowprops=dict(arrowstyle="->", color=BLUE, lw=1.5))

# --- settling time ts (2%) ---
y_ts = step_response(np.array([ts]))[0]
ax.plot([ts], [y_ts], "o", ms=9, mfc=SUCCESS, mec="#065f46", mew=1.3, zorder=7)
ax.plot([ts, ts], [0, 1.0], color=SUCCESS, lw=1.0, ls=":", zorder=3)
ax.annotate(rf"settling time  $t_s={ts:.2f}$ s  (within $\pm2\%$)",
            xy=(ts, y_ts), xytext=(ts + 0.03, 0.62),
            fontsize=10.5, fontweight="bold", color="#0b7a52", ha="left",
            arrowprops=dict(arrowstyle="->", color=SUCCESS, lw=1.5))

ax.set_title("PID Step Response - Overshoot, Rise & Settling "
             f"($K_p={Kp}$, $K_d={Kd}$, $J={J}$ kg$\\cdot$m$^2$)",
             fontsize=13.5, fontweight="bold", pad=10)
ax.set_xlabel("Time (s)")
ax.set_ylabel("Roll angle (normalized)")
ax.set_xlim(0, 1.2)
ax.set_ylim(0, 1.35)
ax.grid(True, alpha=0.3)
ax.legend(loc="lower right", fontsize=11, framealpha=0.95)

# governing-formula / computed-metrics box
ax.text(0.40, 0.235,
        (r"$\omega_n=\sqrt{K_p/J}=%.3f$ rad/s,   $\zeta=K_d/(2\sqrt{K_p J})=%.4f$"
         "\n"
         r"$\omega_d=\omega_n\sqrt{1-\zeta^2}=%.3f$ rad/s,   "
         r"$\phi=\cos^{-1}\zeta=%.3f$ rad" "\n"
         r"$M_p=100\,e^{-\pi\zeta/\sqrt{1-\zeta^2}}=%.2f\%%$,   "
         r"$t_p=\pi/\omega_d=%.3f$ s" "\n"
         r"$t_r=(\pi-\cos^{-1}\zeta)/\omega_d=%.3f$ s,   "
         r"$t_s=4/(\zeta\omega_n)=%.2f$ s")
        % (wn, zeta, wd, phi, Mp, tp, tr, ts),
        transform=ax.transAxes, ha="left", va="bottom", fontsize=9.4,
        bbox=dict(boxstyle="round,pad=0.5", fc="#fffdf5", ec=ACCENT, lw=1.4))

fig.tight_layout()
fig.savefig(OUT, dpi=150, bbox_inches="tight", facecolor=BG)
print("WROTE", OUT)
print(f"  wn   = {wn:.4f} rad/s   (target 14.142)")
print(f"  zeta = {zeta:.4f}       (target 0.4714)")
print(f"  Mp   = {Mp:.2f} %       (target 18.65)")
print(f"  tp   = {tp:.3f} s        (target 0.252)")
print(f"  tr   = {tr:.3f} s        (target 0.165)")
print(f"  ts   = {ts:.2f} s         (target 0.60)")

# numeric verification against the documented worked-example values
assert abs(wn - 14.142) < 0.01, "wn off target"
assert abs(zeta - 0.4714) < 0.001, "zeta off target"
assert abs(Mp - 18.65) < 0.05, "Mp off target"
assert abs(tp - 0.252) < 0.002, "tp off target"
assert abs(tr - 0.165) < 0.002, "tr off target"
assert abs(ts - 0.60) < 0.01, "ts off target"
print("  ALL METRICS VERIFIED against theory.md worked example.")
