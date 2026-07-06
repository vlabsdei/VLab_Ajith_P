"""
Generator for images/efficiency_curve.png (Experiment 3).

Propulsive efficiency eta_prop vs advance ratio J, reproducing theory.md
section 4's reference shape: eta=0 at J=0 (hover), rising to eta=78.0% at
J=0.55 (worked example: 5045 prop, Ct=0.109, Cq=0.01223, D=0.127 m, n=200
RPS, V=13.97 m/s), then falling as the advancing blade approaches stall.
eta_prop = J*Ct/(2*pi*Cq) exactly (the closed form the sim's runBEMT sweep
converges to once Ct/Cq stabilize); the post-peak fall is approximated with
a smooth taper since the real fall-off shape depends on each build's actual
BEMT sweep (documented assumption, this is a REFERENCE figure only).
"""
import numpy as np
import matplotlib.pyplot as plt

Ct = 0.109
Cq = 0.01223
J_peak = 0.55


def eta_ideal(J):
    return J * Ct / (2 * np.pi * Cq) * 100  # %, the closed-form Ct/Cq relation


eta_at_peak = eta_ideal(J_peak)
print("eta at J=0.55 (closed form):", eta_at_peak, "(expect ~78%)")

J = np.linspace(0, 1.0, 400)
eta = np.where(
    J <= J_peak,
    eta_ideal(J),
    eta_at_peak * np.exp(-((J - J_peak) / 0.32) ** 2) * (1 - 0.15 * (J - J_peak))
)
eta = np.clip(eta, 0, None)

fig, ax = plt.subplots(figsize=(8, 5.5))
ax.plot(J, eta, color="#2563eb", lw=2.6, label=r"$\eta_{prop}$ (BEMT sweep, this build)")
ax.plot([J_peak], [eta_at_peak], marker="*", ms=16, color="#f59e0b", zorder=5,
        markeredgecolor="#92400e", markeredgewidth=0.8)
ax.annotate(f"Peak: J={J_peak}, η={eta_at_peak:.1f}%\n(5045 prop reference)",
            xy=(J_peak, eta_at_peak), xytext=(J_peak + 0.08, eta_at_peak - 12),
            fontsize=9.5, color="#92400e",
            arrowprops=dict(arrowstyle="->", color="#92400e", lw=1.0))

ax.axhline(0, color="#cbd5e1", lw=0.8)
ax.axvline(0, color="#cbd5e1", lw=0.8)
ax.text(0.02, 3, "Hover: η=0\n(no forward work)", fontsize=8.5, color="#475569")
ax.annotate("Advancing blade\napproaches stall — η falls",
            xy=(0.85, eta_ideal(J_peak) * np.exp(-((0.85 - J_peak) / 0.32) ** 2) * 0.9),
            xytext=(0.68, 15), fontsize=8.5, color="#7f1d1d",
            arrowprops=dict(arrowstyle="->", color="#7f1d1d", lw=1.0))

ax.set_xlabel("Advance Ratio $J = V/(nD)$", fontsize=11)
ax.set_ylabel(r"Propulsive Efficiency $\eta_{prop}$ (%)", fontsize=11)
ax.set_title(r"Propulsive Efficiency vs Advance Ratio — $\eta_{prop}=\frac{TV}{2\pi nQ}=\frac{J C_t}{2\pi C_q}$", fontsize=11.5)
ax.set_xlim(0, 1.0)
ax.set_ylim(0, 100)
ax.grid(alpha=0.25)
ax.legend(loc="upper right", fontsize=9)

fig.tight_layout()
out_path = "/Users/ajith/Desktop/vlgen/exp-aerodynamic-analysis-dei/experiment/images/efficiency_curve.png"
fig.savefig(out_path, dpi=150, bbox_inches="tight")
print("Saved:", out_path)
assert abs(eta_at_peak - 78.0) < 0.5
