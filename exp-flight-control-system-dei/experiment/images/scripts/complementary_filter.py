"""
Generator for: exp-flight-control-system-dei/experiment/images/complementary_filter.png

Accuracy basis (theory.md Section 7 + simulation/js/main.js Calc + db.json):
  Complementary filter (theory.md S7, main.js Calc.complementaryStep):
        theta_est = alpha*(theta_prev + omega_gyro*dt) + (1-alpha)*theta_accel
  Error model vs the blend coefficient alpha (theory.md S7, main.js):
        tau_f      = alpha*dt/(1-alpha)
        drift      = gyro_bias * tau_f          = bias*alpha*dt/(1-alpha)
        noise_rms  = accel_noise * sqrt((1-alpha)/(1+alpha))
        total      = drift + noise_rms
  Reference IMU (db.json imu_presets[mpu6000], theory.md worked example):
        gyro_bias = 0.6 deg/s, accel_noise sigma = 1.8 deg, dt = 0.0025 s (400 Hz)
        => optimum over {0.90,0.95,0.98,0.99} at alpha = 0.98, total ~ 0.254 deg
  Time-series signals mirror main.js stepFusion:
        true  = 15*sin(2*pi*0.2*t)        [deg]
        gyro-only integrates (trueRate + bias)  -> drifts by bias*t
        accel = true + N(0, sigma^2)             -> noisy, no drift
        fused = complementary filter, alpha = 0.98

Run:  python complementary_filter.py
"""
import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patheffects as pe

OUT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(OUT_DIR, "complementary_filter.png")

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
HALO = [pe.withStroke(linewidth=3.6, foreground="#5c4600")]

# ---- reference IMU (db.json imu_presets[mpu6000]) ----
BIAS = 0.6       # deg/s   gyro bias
SIGMA = 1.8      # deg     accelerometer angle noise
DT = 0.0025      # s       400 Hz estimator rate
ALPHA = 0.98     # default / optimal blend coefficient

# =====================================================================
# TOP panel: time-series sensor fusion (mirror main.js stepFusion)
# =====================================================================
T_END = 8.0
t = np.arange(0.0, T_END, DT)
f0, AMP = 0.2, 15.0                                   # 0.2 Hz, 15 deg amplitude
true_ang = AMP * np.sin(2 * np.pi * f0 * t)
true_rate = AMP * 2 * np.pi * f0 * np.cos(2 * np.pi * f0 * t)
meas_rate = true_rate + BIAS                          # gyro = true rate + bias

rng = np.random.default_rng(42)
accel_ang = true_ang + rng.normal(0.0, SIGMA, size=t.size)   # noisy, drift-free

# integrate gyro-only (drifts) and run the complementary filter
gyro_only = np.empty_like(t)
fused = np.empty_like(t)
g = 0.0
fz = 0.0
for i in range(t.size):
    g += meas_rate[i] * DT                            # pure integration -> drifts
    fz = ALPHA * (fz + meas_rate[i] * DT) + (1 - ALPHA) * accel_ang[i]
    gyro_only[i] = g
    fused[i] = fz

fig, (axT, axB) = plt.subplots(2, 1, figsize=(12.2, 10.2),
                               gridspec_kw={"height_ratios": [1.18, 1.0]})

axT.axhline(0, color=GRID, lw=1.0, zorder=0)
axT.plot(t, accel_ang, color=BLUE, lw=0.7, alpha=0.35, zorder=2,
         label=r"accelerometer  $\theta_{accel}$  (noisy, $\sigma=1.8\degree$)")
axT.plot(t, gyro_only, color=DANGER, lw=1.9, ls="--", zorder=4,
         label=r"gyro-only $\int(\omega+bias)\,dt$  (drifts $0.6\degree$/s)")
axT.plot(t, true_ang, color=DARK, lw=2.5, zorder=5, label=r"true angle  $\theta$")
axT.plot(t, fused, color=ACCENT, lw=3.0, zorder=6, path_effects=HALO,
         label=r"complementary filter  $\theta_{est}$  ($\alpha=0.98$)")

# annotate the growing gyro drift gap at the end
drift_end = gyro_only[-1] - true_ang[-1]
axT.annotate(rf"gyro drift $\approx{drift_end:.1f}\degree$ at $t={T_END:.0f}$ s",
             xy=(t[-1], gyro_only[-1]), xytext=(t[-1] - 2.6, gyro_only[-1] + 4.5),
             fontsize=10, fontweight="bold", color=DANGER, ha="center",
             arrowprops=dict(arrowstyle="->", color=DANGER, lw=1.5))

axT.set_title("Sensor Fusion: Drifting Gyro + Noisy Accelerometer "
              r"$\rightarrow$ Clean Fused Estimate",
              fontsize=13, fontweight="bold")
axT.set_xlabel("Time (s)")
axT.set_ylabel("Roll angle (deg)")
axT.set_xlim(0, T_END)
axT.set_ylim(-22, 26)
axT.grid(True, alpha=0.3)
axT.legend(loc="upper left", fontsize=9.4, ncol=2, framealpha=0.95)
axT.text(0.985, 0.04,
         r"$\theta_{est}=\alpha(\theta_{est}+\omega_{gyro}\Delta t)+(1-\alpha)\theta_{accel}$",
         transform=axT.transAxes, ha="right", va="bottom", fontsize=10.5,
         bbox=dict(boxstyle="round,pad=0.45", fc="#fffdf5", ec=ACCENT, lw=1.4))

# =====================================================================
# BOTTOM panel: drift / noise trade-off vs alpha (COMPUTED curves)
# =====================================================================
def tau_f(a):
    return a * DT / (1 - a)


def drift(a):
    return BIAS * tau_f(a)


def noise_rms(a):
    return SIGMA * np.sqrt((1 - a) / (1 + a))


def total(a):
    return drift(a) + noise_rms(a)


a = np.linspace(0.85, 0.995, 1500)
d_curve = drift(a)
n_curve = noise_rms(a)
tot_curve = total(a)

a_set = np.array([0.90, 0.95, 0.98, 0.99])      # db.json alpha_test_set
tot_set = total(a_set)
i_opt = int(np.argmin(tot_set))                 # optimum among the test set
a_opt, tot_opt = a_set[i_opt], tot_set[i_opt]

axB.plot(a, d_curve, color=DANGER, lw=2.2, ls="--", zorder=3,
         label=r"drift $= bias\cdot\dfrac{\alpha\,\Delta t}{1-\alpha}$")
axB.plot(a, n_curve, color=BLUE, lw=2.2, ls="-.", zorder=3,
         label=r"noise$_{rms}=\sigma\sqrt{\dfrac{1-\alpha}{1+\alpha}}$")
axB.plot(a, tot_curve, color=DARK, lw=3.0, zorder=5,
         label=r"total $=$ drift $+$ noise")

# the four discrete test-set points on the total curve
axB.plot(a_set, tot_set, "o", ms=8, mfc=ACCENT, mec=DARK, mew=1.4, zorder=7)
for av, tv in zip(a_set, tot_set):
    axB.annotate(rf"$\alpha={av:.2f}$" "\n" rf"{tv:.3f}$\degree$",
                 xy=(av, tv), xytext=(av, tv + 0.055), fontsize=8.6,
                 ha="center", va="bottom", color=TXT2)

# mark the optimum (alpha = 0.98)
axB.plot([a_opt], [tot_opt], "*", ms=22, mfc=SUCCESS, mec="#065f46", mew=1.4,
         zorder=8)
axB.axvline(a_opt, color=SUCCESS, lw=1.0, ls=":", zorder=2)
axB.annotate(rf"minimum total error" "\n" rf"$\alpha={a_opt:.2f}$, "
             rf"total $={tot_opt:.3f}\degree$",
             xy=(a_opt, tot_opt), xytext=(0.918, 0.12),
             textcoords="axes fraction", fontsize=10.5, fontweight="bold",
             color="#0b7a52", ha="center",
             arrowprops=dict(arrowstyle="->", color=SUCCESS, lw=1.6))

axB.set_title("Drift vs Noise Trade-off: Choosing the Blend Coefficient "
              r"$\alpha$  (MPU-6000, 400 Hz)",
              fontsize=13, fontweight="bold")
axB.set_xlabel(r"Blend coefficient  $\alpha$")
axB.set_ylabel("Attitude error (deg)")
axB.set_xlim(0.85, 0.995)
axB.set_ylim(0, 0.62)
axB.grid(True, alpha=0.3)
axB.legend(loc="upper center", fontsize=10, framealpha=0.95, ncol=3)

fig.tight_layout()
fig.savefig(OUT, dpi=150, bbox_inches="tight", facecolor=BG)
print("WROTE", OUT)
print(f"  time-series: gyro drift at t={T_END:.0f}s = {drift_end:.2f} deg "
      f"(= bias*t = {BIAS*T_END:.2f})")
for av, tv in zip(a_set, tot_set):
    print(f"  alpha={av:.2f}: tau_f={tau_f(av):.4f}s, drift={drift(av):.4f}, "
          f"noise={noise_rms(av):.4f}, total={tv:.4f} deg")
print(f"  optimum (test set): alpha={a_opt:.2f}, total={tot_opt:.4f} deg")

# verification against theory.md worked-example table
assert abs(tau_f(0.98) - 0.1225) < 1e-4
assert abs(drift(0.98) - 0.0735) < 1e-3
assert abs(noise_rms(0.98) - 0.1809) < 1e-3
assert abs(tot_opt - 0.2544) < 2e-3 and abs(a_opt - 0.98) < 1e-9
print("  FUSION ERROR TABLE VERIFIED against theory.md (optimum alpha=0.98, "
      f"total={tot_opt:.4f} deg).")
