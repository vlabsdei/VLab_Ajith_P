#!/usr/bin/env python3
"""
Generates thermal_model_diagram.png for the propulsion experiment
(exp-propulsion-system-design-dei), referenced from theory.md Section 4
("Dynamic Thermal & Convective Cooling Kinetics") and its "ESC Power
Dissipation" subsection.

Draws two equivalent lumped-capacitance thermal RC circuits side by side:
  1. Motor winding: P_loss (current heat-flux source) -> C_th = M_motor*Cp
     -> R_th = 1/(h*A_motor) -> T_ambient reference.
  2. ESC MOSFETs: P_loss,esc -> C_th,esc = M_esc*Cp,esc -> R_th,esc (manufacturer
     rating, °C/W) -> T_ambient reference — a second, independent, much
     smaller heat path.

All annotated numbers are COMPUTED here from the same governing equations and
constants as simulation/js/main.js (motor_thermal_step / esc_power_loss_w /
esc_thermal_step) and theory.md Section 3-4's worked example (2204 motor,
esc_30a, I = 7.02 A hover current), so the figure and the prose agree exactly.

Motor thermal model (theory.md Sec. 4 / main.js motor_thermal_step):
  P_loss   = I^2 * R_motor(T)
  A_motor  = pi*D_bell*H_bell + 2*pi*(D_bell/2)^2      (bell cylinder + 2 end caps)
  v_i      = sqrt(T_thrust / (2*rho*A_disk))            (induced/wash velocity)
  h        = 25.0 + 22.0 * v_i                          (W/m^2K)
  R_th     = 1 / (h * A_motor)                          (K/W)
  C_th     = M_motor * Cp,   Cp = 385 J/(kg*K)

ESC thermal model (theory.md "ESC Power Dissipation" / main.js esc_power_loss_w,
esc_thermal_step):
  P_loss,esc = I^2 * R_dson                              (below rated current)
  R_th,esc   = manufacturer catalog r_th_c_per_w          (deg C/W)
  C_th,esc   = M_esc * Cp,esc,  Cp,esc = 800 J/(kg*K)
"""

import math
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, Circle, Rectangle
import matplotlib.patheffects as pe

# ----------------------------------------------------------------------------
# 1. Compute worked-example numbers directly from the governing equations
#    (mirrors theory.md Section 3-4 worked example: 2204 motor, esc_30a ESC,
#    both carrying the I = 7.02 A hover current from Section 3).
# ----------------------------------------------------------------------------

T_AMBIENT_C = 25.0

# --- Motor (2204-2300KV) ---
I_hover = 7.02                       # A, hover current (Sec. 3 worked example)
R_motor_25C = 0.0969                 # ohm, R_motor(25 C) (Sec. 3 worked example)
P_loss_motor = I_hover**2 * R_motor_25C

D_bell_mm, H_bell_mm = 27.0, 20.0    # 2204 catalog bell geometry
D_bell, H_bell = D_bell_mm / 1000.0, H_bell_mm / 1000.0
A_motor = math.pi * D_bell * H_bell + 2.0 * math.pi * (D_bell / 2.0) ** 2

rho = 1.225                          # kg/m^3, sea level
D_prop = 0.127                       # m, 5045 prop diameter
A_disk = math.pi * D_prop**2 / 4.0
T_thrust = 0.981                     # N, thrust at 12,000 RPM (Sec. 2 worked example)
v_i = math.sqrt(T_thrust / (2.0 * rho * A_disk))

H_STILL, H_FORCED_PER_MS = 25.0, 22.0
h_conv = H_STILL + H_FORCED_PER_MS * v_i
hA_motor = h_conv * A_motor
R_th_motor = 1.0 / hA_motor

M_motor_kg = 0.025                   # 25.0 g, 2204 catalog mass
Cp_motor = 385.0
C_th_motor = M_motor_kg * Cp_motor
tau_motor = C_th_motor / hA_motor

dT_ss_motor = P_loss_motor / hA_motor
T_ss_motor = T_AMBIENT_C + dT_ss_motor

# --- ESC (esc_30a) ---
R_dson_esc = 0.0030                  # ohm, esc_30a catalog rds_on_ohm
P_loss_esc = I_hover**2 * R_dson_esc

R_th_esc = 18.0                      # deg C/W, esc_30a catalog r_th_c_per_w
cond_esc = 1.0 / R_th_esc            # W/K

M_esc_kg = 0.0095                    # 9.5 g, esc_30a catalog mass
Cp_esc = 800.0
C_th_esc = M_esc_kg * Cp_esc
tau_esc = C_th_esc / cond_esc

dT_ss_esc = P_loss_esc / cond_esc
T_ss_esc = T_AMBIENT_C + dT_ss_esc

print("Motor: P_loss=%.3f W  A_motor=%.4e m^2  v_i=%.3f m/s  h=%.2f W/m2K  "
      "hA=%.4f W/K  T_ss=%.2f C  tau=%.2f s" %
      (P_loss_motor, A_motor, v_i, h_conv, hA_motor, T_ss_motor, tau_motor))
print("ESC:   P_loss=%.4f W  1/R_th=%.4f W/K  T_ss=%.2f C  tau=%.2f s" %
      (P_loss_esc, cond_esc, T_ss_esc, tau_esc))

# ----------------------------------------------------------------------------
# 2. Draw two equivalent thermal-RC schematics side by side.
# ----------------------------------------------------------------------------

FS_LABEL = 12
FS_ANNOT = 10.5
FS_TITLE = 14
WIRE = "#2b2b2b"
ACCENT_MOTOR = "#c0392b"
ACCENT_ESC = "#1f618d"
GND_COLOR = "#1a5276"

fig, axes = plt.subplots(1, 2, figsize=(15.5, 7.4))


def draw_thermal_rc(ax, title, accent, P_loss, C_th, R_th, T_ss, dT_ss, tau,
                     T_amb, source_label, cap_label, res_label,
                     extra_lines):
    """Draws one equivalent thermal RC circuit: current source (P_loss) in
    parallel with C_th, feeding through R_th to a T_ambient reference node
    (ground symbol), matching the topology described in theory.md Sec. 4:
    'P_loss acts as a current heat flux source, C_th ... represents the
    thermal capacitance (storing heat), and R_th ... represents the thermal
    resistance of convective cooling'."""

    ax.set_xlim(0, 10)
    ax.set_ylim(0, 10)
    ax.axis("off")
    ax.set_title(title, fontsize=FS_TITLE, fontweight="bold", pad=14)

    y_top = 7.6
    y_bot = 2.6
    x_src = 1.6
    x_cap = 4.4
    x_res_l = 6.0
    x_res_r = 8.3
    x_gnd = 9.3

    # Top rail (heat-flow bus, node at temperature T)
    ax.plot([x_src, x_gnd], [y_top, y_top], color=WIRE, lw=2, zorder=1)
    # Bottom rail (ambient reference, 0-potential)
    ax.plot([x_src, x_res_r], [y_bot, y_bot], color=WIRE, lw=2, zorder=1)
    ax.plot([x_res_r, x_res_r], [y_bot, y_top], color=WIRE, lw=0, zorder=1)  # placeholder

    # --- Current source (P_loss), drawn as a circle with an upward arrow ---
    src_r = 0.62
    src_cy = (y_top + y_bot) / 2.0
    ax.plot([x_src, x_src], [y_bot, src_cy - src_r], color=WIRE, lw=2)
    ax.plot([x_src, x_src], [src_cy + src_r, y_top], color=WIRE, lw=2)
    circ = Circle((x_src, src_cy), src_r, facecolor="white", edgecolor=accent, lw=2.4, zorder=3)
    ax.add_patch(circ)
    arr = FancyArrowPatch((x_src, src_cy - src_r + 0.12), (x_src, src_cy + src_r - 0.12),
                           arrowstyle="-|>", mutation_scale=16, color=accent, lw=2.2, zorder=4)
    ax.add_patch(arr)
    ax.text(x_src, src_cy, "", ha="center", va="center")
    ax.text(x_src, y_bot - 0.65, source_label, ha="center", va="top",
            fontsize=FS_LABEL, color=accent, fontweight="bold")
    ax.text(x_src, src_cy + src_r + 0.35, r"$P_{loss}$", ha="center", va="bottom", fontsize=FS_LABEL)

    # --- Thermal capacitance C_th (parallel branch, capacitor symbol) ---
    cap_gap = 0.16
    cap_cy = (y_top + y_bot) / 2.0
    ax.plot([x_cap, x_cap], [y_bot, cap_cy - cap_gap], color=WIRE, lw=2)
    ax.plot([x_cap, x_cap], [cap_cy + cap_gap, y_top], color=WIRE, lw=2)
    plate_w = 0.85
    ax.plot([x_cap - plate_w / 2, x_cap + plate_w / 2], [cap_cy - cap_gap, cap_cy - cap_gap],
            color=WIRE, lw=3)
    ax.plot([x_cap - plate_w / 2, x_cap + plate_w / 2], [cap_cy + cap_gap, cap_cy + cap_gap],
            color=WIRE, lw=3)
    ax.text(x_cap, y_bot - 0.65, cap_label, ha="center", va="top",
            fontsize=FS_LABEL, color="#333333", fontweight="bold")
    ax.text(x_cap + 0.75, cap_cy, r"$C_{th}$" + "\n(stores heat)", ha="left", va="center",
            fontsize=FS_ANNOT - 0.5)

    # --- Thermal resistance R_th (series, resistor box) ---
    res_h = 0.62
    res_w = x_res_r - x_res_l
    ax.plot([x_cap, x_res_l], [y_top, y_top], color=WIRE, lw=2)
    rect = Rectangle((x_res_l, y_top - res_h / 2), res_w, res_h,
                      facecolor="white", edgecolor=WIRE, lw=2.2, zorder=3)
    ax.add_patch(rect)
    ax.text((x_res_l + x_res_r) / 2, y_top, r"$R_{th}$", ha="center", va="center",
            fontsize=FS_LABEL, fontweight="bold")
    ax.text((x_res_l + x_res_r) / 2, y_top + res_h / 2 + 0.32, res_label,
            ha="center", va="bottom", fontsize=FS_LABEL, color="#333333", fontweight="bold")
    ax.plot([x_res_r, x_gnd], [y_top, y_top], color=WIRE, lw=2)

    # Right vertical wire down to ambient rail + ground symbol
    ax.plot([x_gnd, x_gnd], [y_top, y_bot], color=WIRE, lw=2)
    ax.plot([x_cap, x_cap], [y_bot, y_bot], color=WIRE, lw=0)
    # connect bottom rail across to right side (ambient / ground bus)
    ax.plot([x_src, x_gnd], [y_bot, y_bot], color=GND_COLOR, lw=2.4, zorder=2)

    # Ground / ambient-temperature symbol at bottom right
    gx, gy = x_gnd, y_bot
    for i, w in enumerate([0.5, 0.32, 0.16]):
        yy = gy - 0.22 - 0.18 * i
        ax.plot([gx - w / 2, gx + w / 2], [yy, yy], color=GND_COLOR, lw=2.2)
    ax.text(gx, gy - 0.95, r"$T_{ambient}$" + "\n(25°C)", ha="center", va="top",
            fontsize=FS_LABEL, color=GND_COLOR, fontweight="bold")

    # Node dots
    for (xx, yy) in [(x_src, y_top), (x_cap, y_top), (x_src, y_bot), (x_gnd, y_top), (x_gnd, y_bot)]:
        ax.add_patch(Circle((xx, yy), 0.045, facecolor=WIRE, edgecolor=WIRE, zorder=5))

    # Node-T label
    ax.text((x_src + x_cap) / 2, y_top + 0.35, "node T\n(winding/case temp.)",
            ha="center", va="bottom", fontsize=FS_ANNOT - 1, color="#555555", style="italic")

    # Governing ODE + worked numbers box
    ode_text = (r"$\dfrac{dT}{dt}=\dfrac{P_{loss}-(T-T_{amb})/R_{th}}{C_{th}}$")
    ax.text(5.0, 1.55, ode_text, ha="center", va="center", fontsize=FS_LABEL + 1,
            bbox=dict(boxstyle="round,pad=0.35", facecolor="#f7f7f7", edgecolor=accent, lw=1.3))

    box_lines = "\n".join(extra_lines)
    ax.text(0.05, -0.35, box_lines, transform=ax.transAxes, ha="left", va="top",
            fontsize=FS_ANNOT, family="monospace",
            bbox=dict(boxstyle="round,pad=0.5", facecolor="#fffdf5", edgecolor=accent, lw=1.2))


# --- Panel 1: Motor thermal RC (2204 @ hover) ---
motor_lines = [
    "Worked example — 2204-2300KV @ hover (I = 7.02 A):",
    r"P_loss = I^2 R_motor(25°C) = 7.02^2 x 0.0969 ≈ %.2f W" % P_loss_motor,
    r"A_motor = πD_bellH_bell + 2π(D_bell/2)^2 (27x20mm) ≈ %.2e m^2" % A_motor,
    r"v_i = √(T_thrust/2ρA_disk) ≈ %.2f m/s   h = 25+22v_i ≈ %.1f W/m^2K" % (v_i, h_conv),
    r"R_th = 1/(hA_motor) ≈ %.3f K/W   (hA ≈ %.3f W/K)" % (R_th_motor, hA_motor),
    r"C_th = M_motor Cp = 0.025 kg x 385 J/kgK = %.1f J/K   τ = C_th R_th ≈ %.1f s" % (C_th_motor, tau_motor),
    r"T_ss = T_amb + P_loss/(hA) = 25 + %.1f ≈ %.1f °C" % (dT_ss_motor, T_ss_motor),
]
draw_thermal_rc(axes[0], "Motor Winding — Thermal RC Model (2204-2300KV)",
                 ACCENT_MOTOR, P_loss_motor, C_th_motor, R_th_motor, T_ss_motor,
                 dT_ss_motor, tau_motor, T_AMBIENT_C,
                 source_label=r"$P_{loss}=I^2R_{motor}(T)$" + "\n≈ %.2f W" % P_loss_motor,
                 cap_label=r"$C_{th}=M_{motor}C_p$",
                 res_label=r"$R_{th}=1/(hA_{motor})$",
                 extra_lines=motor_lines)

# --- Panel 2: ESC thermal RC (esc_30a @ hover) — second, independent, smaller path ---
esc_lines = [
    "Worked example — esc_30a @ hover (same I = 7.02 A):",
    r"P_loss,esc = I^2 R_dson = 7.02^2 x 0.0030 ≈ %.3f W" % P_loss_esc,
    r"R_th,esc = catalog rating = 18 °C/W   (1/R_th ≈ %.4f W/K)" % cond_esc,
    r"C_th,esc = M_esc Cp,esc = 0.0095 kg x 800 J/kgK = %.1f J/K   τ ≈ %.1f s" % (C_th_esc, tau_esc),
    r"T_ss,esc = T_amb + P_loss,esc/(1/R_th) = 25 + %.2f ≈ %.1f °C" % (dT_ss_esc, T_ss_esc),
    "",
    "Independent path: %.3f W (ESC) << %.2f W (motor)." % (P_loss_esc, P_loss_motor),
    "Undersized ESC + high current -> separate overheat mode.",
]
draw_thermal_rc(axes[1], "ESC MOSFETs — Thermal RC Model (esc_30a)",
                 ACCENT_ESC, P_loss_esc, C_th_esc, R_th_esc, T_ss_esc,
                 dT_ss_esc, tau_esc, T_AMBIENT_C,
                 source_label=r"$P_{loss,esc}=I^2R_{dson}$" + "\n≈ %.3f W" % P_loss_esc,
                 cap_label=r"$C_{th,esc}=M_{esc}C_{p,esc}$",
                 res_label=r"$R_{th,esc}$ (catalog, °C/W)",
                 extra_lines=esc_lines)

fig.suptitle("Equivalent Thermal RC Circuits — Motor Winding vs. ESC MOSFETs (Two Independent Heat Paths)",
             fontsize=15, fontweight="bold", y=1.015)

fig.tight_layout(rect=[0, 0.02, 1, 0.98])

out_path = "/Users/ajith/Desktop/vlgen/exp-propulsion-system-design-dei/experiment/images/thermal_model_diagram.png"
fig.savefig(out_path, dpi=150, bbox_inches="tight")
print("Saved:", out_path)
