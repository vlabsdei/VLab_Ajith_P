"""
Generator for: exp-flight-performance-dei/experiment/images/payload_twr_curve.png

Accuracy basis (theory.md Sections 2 & 5 + db.json payload/twr + main.js Calc):
  TWR as payload is added (theory.md S2, Calc.twr):
        TWR(payload) = N * T_max / (m_empty + payload)
  Minimum safe TWR for controllable flight (theory.md S5, db.json payload):
        TWR_min = 2.0
  Maximum take-off mass & payload (theory.md S5, Calc.maxTakeoffMassG / maxPayloadG):
        m_max   = N * T_max / TWR_min = 4 x 620 / 2.0 = 1240 g
        payload = m_max - m_empty     = 1240 - 500     = 740 g
  Reference 5" build: N = 4, T_max = 620 g (2204_2300), m_empty = 500 g.
        payload 0    -> TWR = 2480/500  = 4.96  (starting point)
        payload 740  -> TWR = 2480/1240 = 2.00  (safety floor crossing)
  The TWR-vs-payload curve is COMPUTED with numpy from N*T_max/(m_empty+payload).

Run:  python payload_twr_curve.py
"""
import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

OUT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(OUT_DIR, "payload_twr_curve.png")

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
N = 4                          # motor_count
T_MAX = 620.0                  # g/motor (2204_2300)
M_EMPTY = 500.0                # g (empty reference build)
TOTAL_THRUST = N * T_MAX       # 2480 g
TWR_MIN = 2.0                  # minimum safe TWR (db.json payload.twr_min_safe)
PAYLOAD_MAX = 2000.0           # g (db.json config.payload_slider_max_g)

M_MAX = N * T_MAX / TWR_MIN          # 1240 g max take-off mass
MAX_PAYLOAD = M_MAX - M_EMPTY        # 740 g
TWR_START = TOTAL_THRUST / M_EMPTY   # 4.96 at payload 0
PAYLOAD_AT_1 = TOTAL_THRUST / 1.0 - M_EMPTY   # 1980 g where TWR = 1

# ---- COMPUTE the TWR-vs-payload curve with numpy ----
payload = np.linspace(0.0, PAYLOAD_MAX, 1001)
twr = TOTAL_THRUST / (M_EMPTY + payload)

fig, ax = plt.subplots(figsize=(11.4, 7.2))

# usable / unsafe payload bands
ax.axvspan(0.0, MAX_PAYLOAD, color=SUCCESS, alpha=0.08, zorder=0)
ax.axvspan(MAX_PAYLOAD, PAYLOAD_MAX, color=DANGER, alpha=0.07, zorder=0)
ax.text(MAX_PAYLOAD / 2.0, 0.55, "usable payload\n(TWR >= 2.0)", ha="center",
        va="bottom", fontsize=9.5, color="#065f46")
ax.text((MAX_PAYLOAD + PAYLOAD_MAX) / 2.0, 0.55,
        "unsafe\n(TWR < 2.0)", ha="center", va="bottom", fontsize=9.5,
        color="#b91c1c")

# TWR(payload) curve (COMPUTED)
ax.plot(payload, twr, color=DARK, lw=2.8, zorder=5,
        label=r"$TWR = \dfrac{N\,T_{max}}{m_{empty}+\mathrm{payload}}=\dfrac{2480}{500+p}$")

# minimum-safe-TWR line
ax.axhline(TWR_MIN, color=DANGER, lw=1.8, ls="--", zorder=3,
           label=r"minimum safe $TWR = 2.0$")
# lift-off floor (TWR = 1) for context
ax.axhline(1.0, color=TXT3, lw=1.1, ls=":", zorder=2)
ax.text(PAYLOAD_MAX - 20, 1.0 + 0.06, "TWR = 1  (lift-off floor)", ha="right",
        va="bottom", fontsize=8.6, color=TXT3)

# starting-point marker (payload 0 -> TWR 4.96)
ax.plot([0.0], [TWR_START], "o", ms=11, mfc=SUCCESS, mec="#065f46", mew=1.7,
        zorder=7)
ax.annotate(f"payload 0 g\nTWR = {TWR_START:.2f}", (0.0, TWR_START),
            textcoords="offset points", xytext=(34, 14), fontsize=9.6,
            fontweight="bold", color="#065f46",
            arrowprops=dict(arrowstyle="->", color=SUCCESS, lw=1.4))

# max-payload crossing marker (740 g -> TWR 2.0)
ax.plot([MAX_PAYLOAD], [TWR_MIN], "o", ms=12, mfc=ACCENT, mec=DARK, mew=1.8,
        zorder=7)
ax.axvline(MAX_PAYLOAD, color=DARK, lw=1.4, ls="-.", alpha=0.6, zorder=3)
ax.annotate(f"max payload {MAX_PAYLOAD:.0f} g\n"
            r"$= N T_{max}/2.0 - m_{empty}$",
            (MAX_PAYLOAD, TWR_MIN), textcoords="offset points",
            xytext=(40, 60), fontsize=10, fontweight="bold", color="#9a6a00",
            arrowprops=dict(arrowstyle="->", color=DARK, lw=1.4))

ax.annotate(f"{MAX_PAYLOAD:.0f} g", (MAX_PAYLOAD, 0), textcoords="offset points",
            xytext=(0, -26), ha="center", fontsize=9.5, fontweight="bold",
            color=DARK, arrowprops=dict(arrowstyle="->", color=DARK, lw=1.2))

ax.set_title("Thrust-to-Weight Ratio vs Added Payload",
             fontweight="bold")
ax.set_xlabel("Payload  (g)")
ax.set_ylabel("Thrust-to-weight ratio  $TWR$")
ax.set_xlim(0, PAYLOAD_MAX)
ax.set_ylim(0, 5.4)
ax.grid(True, alpha=0.35)
ax.legend(loc="upper right", fontsize=9.6, framealpha=0.96)

# formula / constants box
ax.text(0.985, 0.62,
        (r"$m_{max}=\dfrac{N\,T_{max}}{TWR_{min}}=\dfrac{4\times620}{2.0}=1240$ g"
         + "\n"
         + r"payload$_{max}=m_{max}-m_{empty}=1240-500=\mathbf{740}$ g"),
        transform=ax.transAxes, ha="right", va="bottom", fontsize=9.2,
        bbox=dict(boxstyle="round", fc=SURF2, ec="#cbd5e1", pad=0.5))

fig.tight_layout()
fig.savefig(OUT, dpi=150, bbox_inches="tight", facecolor=BG)
print("WROTE", OUT)
print(f"  N={N}, T_max={T_MAX} g, m_empty={M_EMPTY} g, TWR_min={TWR_MIN}")
print(f"  start TWR = {TWR_START:.4f} ; m_max = {M_MAX:.0f} g ; max payload = {MAX_PAYLOAD:.0f} g")
print(f"  TWR=1 reached at payload = {PAYLOAD_AT_1:.0f} g")
assert abs(M_MAX - 1240.0) < 1e-9
assert abs(MAX_PAYLOAD - 740.0) < 1e-9
assert abs(TWR_START - 4.96) < 1e-9
# sanity: curve hits 2.0 exactly at 740 g
assert abs(TOTAL_THRUST / (M_EMPTY + MAX_PAYLOAD) - TWR_MIN) < 1e-9
print("  VERIFIED: TWR 4.96 at 0 g, crosses 2.0 at 740 g (m_max 1240 g)")
