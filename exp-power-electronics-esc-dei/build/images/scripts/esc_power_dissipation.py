"""
Generator for: exp-power-electronics-esc-dei/experiment/images/esc_power_dissipation.png

Accuracy basis (theory.md Sections 5-6 + procedure Stage 4 + db.json esc_30a/thermal):
  - ESC conduction loss (theory.md S5, Calc.escDissipation):
        P_ESC = I^2 * R_ESC          R_ESC = 0.003 ohm  (db.json esc_30a rds_on_ohm)
  - Heatsink rule (theory.md S5, Calc.heatsinkRequired):  P_ESC > 2 W -> heatsink
  - Temperature coefficient (theory.md S6, Calc.resistanceAtTemp):
        R(T) = R25 * (1 + alpha*(T - 25)),  alpha = 0.006 /degC (silicon MOSFET Rds(on))
        R(80) = 0.003 * (1 + 0.006*55) = 0.003 * 1.33 = 0.00399 ohm (+33%)
  Worked points (theory.md S5/S6 tables):
        I = 25 A -> 25^2 * 0.003          = 1.875 W   (passive cooling OK)
        I = 30 A -> 30^2 * 0.003          = 2.700 W   (heatsink required)
        I = 30 A (hot 80C) -> 30^2 * R(80) = 3.591 W   (static model under-predicts)
  Main curve + second "hot @ 80C" dashed curve, both COMPUTED with numpy.

Run:  python esc_power_dissipation.py
"""
import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

OUT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(OUT_DIR, "esc_power_dissipation.png")

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

# ---- governing constants (db.json esc_30a + thermal) ----
R25 = 0.003                # ohm   30 A BLHeli_32 rds_on_ohm
ALPHA = 0.006              # /degC silicon MOSFET Rds(on) tempco (~1.45x at 100C)
T_HOT = 80.0               # degC  in-flight MOSFET temperature
T_REF = 25.0
THRESH = 2.0               # W     heatsink threshold
R_HOT = R25 * (1 + ALPHA * (T_HOT - T_REF))     # 0.00399 ohm
HOT_FACTOR = R_HOT / R25 - 1                     # +0.33 (33%)

# ---- COMPUTE the curves with numpy ----
I = np.linspace(0, 60, 601)
P_cold = I**2 * R25
P_hot = I**2 * R_HOT

# crossing of the cold curve through the 2 W threshold
I_cross = np.sqrt(THRESH / R25)                  # 25.82 A

fig, ax = plt.subplots(figsize=(11.4, 7.2))

# shaded "heatsink required" zone above the threshold
ax.axhspan(THRESH, 11.2, color=DANGER, alpha=0.07, zorder=0)
ax.text(2.0, THRESH + 0.18, "heatsink / active-cooling zone  (P > 2 W)",
        ha="left", va="bottom", fontsize=9, color="#b91c1c")

# threshold line
ax.axhline(THRESH, color=WARNING, lw=1.8, ls="--", zorder=3,
           label=f"2 W heatsink threshold")

# cold (rated, 25C) conduction-loss curve
ax.plot(I, P_cold, color=DARK, lw=2.8, zorder=5,
        label=r"$P_{ESC}=I^{2}R_{ESC}$,  $R_{ESC}=3\,m\Omega$ (25$^\circ$C)")
# hot (80C) curve from the temperature coefficient
ax.plot(I, P_hot, color=DANGER, lw=2.2, ls="--", zorder=5,
        label=r"hot @ 80$^\circ$C:  $R(T)=R_{25}[1+\alpha(T-25)]$ (+33%)")

# threshold crossing marker
ax.plot([I_cross], [THRESH], "o", ms=7, mfc=BG, mec=WARNING, mew=1.8, zorder=6)
ax.annotate(f"crosses 2 W\nat I = {I_cross:.1f} A", (I_cross, THRESH),
            textcoords="offset points", xytext=(-78, 18), fontsize=8.6,
            color="#9a6a00",
            arrowprops=dict(arrowstyle="->", color=WARNING, lw=1.3))

# --- worked point 1: 25 A -> 1.875 W (passive OK) ---
P25 = 25.0**2 * R25
ax.plot([25], [P25], "o", ms=11, mfc=SUCCESS, mec="#065f46", mew=1.7, zorder=7)
ax.annotate(f"25 A -> {P25:.3f} W\npassive cooling OK", (25, P25),
            xytext=(25 - 1.5, P25 - 1.15), ha="right", fontsize=9.5,
            fontweight="bold", color="#065f46",
            arrowprops=dict(arrowstyle="->", color=SUCCESS, lw=1.5))

# --- worked point 2: 30 A -> 2.7 W (heatsink required) ---
P30 = 30.0**2 * R25
ax.plot([30], [P30], "o", ms=11, mfc=DANGER, mec="#7f1d1d", mew=1.7, zorder=7)
ax.annotate(f"30 A -> {P30:.3f} W\nheatsink required", (30, P30),
            xytext=(33.0, P30 - 0.95), ha="left", fontsize=9.5,
            fontweight="bold", color="#7f1d1d",
            arrowprops=dict(arrowstyle="->", color=DANGER, lw=1.5))

# --- worked point 3: 30 A hot -> ~3.28 W ---
P30h = 30.0**2 * R_HOT
ax.plot([30], [P30h], "D", ms=9, mfc=BG, mec=DANGER, mew=1.8, zorder=7)
# vertical connector showing the hot penalty at 30 A
ax.annotate("", xy=(30, P30h), xytext=(30, P30),
            arrowprops=dict(arrowstyle="-|>", color=DANGER, lw=1.5))
ax.annotate(f"30 A hot @ 80$^\\circ$C\n-> {P30h:.2f} W  (+{HOT_FACTOR*100:.1f}%)",
            (30, P30h), xytext=(31.5, P30h + 0.95), ha="left", fontsize=9.2,
            color=DANGER,
            arrowprops=dict(arrowstyle="->", color=DANGER, lw=1.3))

# accent highlight band marking the 25-30 A decision window (used sparingly)
ax.axvspan(25, 30, color=ACCENT, alpha=0.10, zorder=1)
ax.text(27.5, 0.4, "decision\nwindow", ha="center", va="bottom", fontsize=8,
        color="#9a7d00")

ax.set_title("ESC Conduction Power Dissipation & Heatsink Decision (Sub-Calc C)",
             fontweight="bold")
ax.set_xlabel("Phase current  $I$  (A)")
ax.set_ylabel(r"ESC dissipation  $P_{ESC}$  (W)")
ax.set_xlim(0, 60)
ax.set_ylim(0, 11.2)
ax.grid(True, alpha=0.35)
ax.legend(loc="upper left", fontsize=9.3, framealpha=0.96)

# formula / constants box
ax.text(0.985, 0.045,
        (r"$P_{ESC}=I^{2}R_{ESC}$   ($R_{ESC}=0.003\,\Omega$)" + "\n"
         + r"$R(80^\circ C)=0.003\,[1+0.006\cdot55]=0.00399\,\Omega$" + "\n"
         + r"quadratic in $I$: doubling $I$ quadruples heat"),
        transform=ax.transAxes, ha="right", va="bottom", fontsize=9,
        bbox=dict(boxstyle="round", fc=SURF2, ec="#cbd5e1", pad=0.5))

fig.tight_layout()
fig.savefig(OUT, dpi=150, bbox_inches="tight", facecolor=BG)
print("WROTE", OUT)
print(f"  R25 = {R25} ohm ;  R(80C) = {R_HOT:.6f} ohm  (+{HOT_FACTOR*100:.2f}%)")
print(f"  25 A -> {P25:.4f} W (passive OK) ;  30 A -> {P30:.4f} W (heatsink)")
print(f"  30 A hot@80C -> {P30h:.4f} W ;  threshold crossing at I = {I_cross:.2f} A")
assert abs(P25 - 1.875) < 1e-9 and abs(P30 - 2.7) < 1e-9
assert abs(P30h - 3.591) < 1e-3
print("  VERIFIED: 25A->1.875W, 30A->2.7W, hot@80C 30A->3.591W")
