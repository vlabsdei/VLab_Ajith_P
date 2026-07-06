"""
Generator for images/advance_ratio_diagram.png (Experiment 3).

Velocity triangles for a blade element at two forward speeds (low-J near
hover, higher-J cruise) showing how forward speed V changes the resultant
relative wind V_rel and the inflow angle phi = atan2(V, U_t) — exactly the
angle used inside Calc.runBEMT's per-station solve in main.js. Reference
build: 5045-class propeller (D=0.127 m) at n=200 RPS (12,000 RPM), matching
theory.md section 3's worked example (J=0.472 at V=12 m/s).
"""
import numpy as np
import matplotlib.pyplot as plt

D = 0.127       # m, 5045 prop diameter
n = 200.0       # RPS (12,000 RPM)
U_t = np.pi * n * D  # blade tip speed, m/s

cases = [
    {"V": 0.0, "label": "Hover (J = 0)", "color": "#2563eb"},
    {"V": 12.0, "label": "Cruise (J = 0.472)", "color": "#dc2626"},
]

fig, axes = plt.subplots(1, 2, figsize=(10, 5))

for ax, case in zip(axes, cases):
    V = case["V"]
    V_rel = np.hypot(U_t, V)
    phi = np.degrees(np.arctan2(V, U_t))
    J = V / (n * D) if V > 0 else 0.0

    # U_t horizontal (blade rotation direction), V vertical (axial/forward), V_rel resultant
    ax.annotate("", xy=(U_t, 0), xytext=(0, 0),
                arrowprops=dict(arrowstyle="->", color="#111827", lw=2.2))
    ax.text(U_t / 2, -6, r"$U_t=\pi nD$" + f" = {U_t:.1f} m/s", ha="center", fontsize=9)

    ax.annotate("", xy=(U_t, V), xytext=(U_t, 0),
                arrowprops=dict(arrowstyle="->", color="#2563eb", lw=2.2))
    ax.text(U_t + 2, V / 2 if V > 0 else 4, f"$V$ = {V:.0f} m/s", color="#2563eb", fontsize=9)

    ax.annotate("", xy=(U_t, V), xytext=(0, 0),
                arrowprops=dict(arrowstyle="->", color=case["color"], lw=2.6))
    ax.text(U_t * 0.42, V * 0.55 + 5, r"$V_{rel}$" + f" = {V_rel:.1f} m/s",
            color=case["color"], fontsize=9.5, fontweight="bold")

    # angle arc for phi
    arc_r = 14
    theta = np.linspace(0, np.radians(phi) if phi > 0.01 else 0.001, 30)
    ax.plot(arc_r * np.cos(theta), arc_r * np.sin(theta), color="#6b7280", lw=1.3)
    ax.text(arc_r + 3, 3 if phi < 5 else arc_r * np.sin(np.radians(phi)) / 2,
            r"$\phi$" + f" = {phi:.1f}°", color="#374151", fontsize=9)

    ax.set_xlim(-10, U_t + 20)
    ax.set_ylim(-15, max(U_t * 0.55, V + 15))
    ax.set_aspect("equal")
    ax.set_title(case["label"], fontsize=11)
    ax.set_xlabel("Tangential direction (m/s)")
    ax.set_ylabel("Axial direction (m/s)")
    ax.grid(alpha=0.25)

fig.suptitle(r"Velocity Triangle — $\phi=\mathrm{atan2}(V,\,U_t)$,  $J=V/(nD)$" +
             f"   (5045 prop, D={D} m, n={n:.0f} RPS)", fontsize=11.5)
fig.tight_layout(rect=[0, 0, 1, 0.94])

out_path = "/Users/ajith/Desktop/vlgen/exp-aerodynamic-analysis-dei/experiment/images/advance_ratio_diagram.png"
fig.savefig(out_path, dpi=150, bbox_inches="tight")
print("Saved:", out_path)
J_check = 12.0 / (n * D)
print("J at V=12 m/s:", J_check, "(expect ~0.472)")
assert abs(J_check - 0.472) < 0.01
