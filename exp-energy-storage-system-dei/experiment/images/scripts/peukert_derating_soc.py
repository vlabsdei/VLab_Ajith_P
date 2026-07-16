#!/usr/bin/env python3
"""
Generates peukert_derating_soc.png for the energy-storage experiment,
referenced from theory.md Sections 3-4 ("Peukert-Style Derating" and
"Coulomb Counting & State-of-Charge Estimation").

Left panel: nameplate vs. Peukert-derated effective capacity for four real
catalog packs (peukertFactor(), main.js ~2414-2418) — visualizes why a
low continuous-C pack delivers less than its printed mAh under a real load.

Right panel: for the same four packs, the naive-gauge SoC% at which the
TRUE (Peukert-derated) capacity is actually exhausted — i.e.
naiveSoC_at_true_empty = (1 - peukertFactor) x 100% — plotted against the
rig's 20% auto-cut threshold (SHUTDOWN_SOC, main.js ~2166). Any pack whose
bar crosses the cutoff line empties for real BEFORE the naive gauge's
auto-cut fires, which is exactly the "Cell over-discharged" fault path in
the SoC Discharge Mapping bench test (main.js simStep, metric === "soc",
~2393-2478).

All numbers computed from the ported peukert_factor() in _physics.py.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _physics import BATT_4S3300, BATT_4S1300_LOWC, BATT_4S1500_HIGHC, BATT_6S5000, peukert_factor

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

TEAL = "#178a6f"
RED = "#c0392b"
AMBER = "#b9770e"
GREY = "#7f8c8d"

packs = [
    ("4S 3300 mAh\n15C cont.", BATT_4S3300),
    ("4S 1300 mAh\n12C cont. (low-C)", BATT_4S1300_LOWC),
    ("4S 1500 mAh\n100C cont. (high-C)", BATT_4S1500_HIGHC),
    ("6S 5000 mAh\n22C cont.", BATT_6S5000),
]

labels, nameplate, effective, pf_list, overhang = [], [], [], [], []
for label, batt in packs:
    pf = peukert_factor(batt["c_rating_cont"])
    labels.append(label)
    nameplate.append(batt["cap_mah"])
    effective.append(batt["cap_mah"] * pf)
    pf_list.append(pf)
    overhang.append((1 - pf) * 100)
    print(f"{label.replace(chr(10),' ')}: peukertFactor={pf:.4f} effCap={batt['cap_mah']*pf:.0f}mAh "
          f"naiveSoC_at_true_empty={(1-pf)*100:.2f}%")

SHUTDOWN_SOC_PCT = 20.0

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14.5, 6.6))

x = range(len(labels))
w = 0.34
ax1.bar([i - w / 2 for i in x], nameplate, width=w, color=GREY, alpha=0.55,
         edgecolor=GREY, label="nameplate capacity")
bars_eff = ax1.bar([i + w / 2 for i in x], effective, width=w, color=TEAL,
                     edgecolor=TEAL, label="Peukert-derated effective capacity")
for i, (n, e, pf) in enumerate(zip(nameplate, effective, pf_list)):
    ax1.text(i + w / 2, e + 40, "%.0f%%" % (pf * 100), ha="center", fontsize=10, fontweight="bold",
              color=TEAL if pf > 0.9 else (AMBER if pf > 0.75 else RED))
ax1.set_xticks(list(x))
ax1.set_xticklabels(labels, fontsize=10)
ax1.set_ylabel("Capacity (mAh)", fontsize=11.5)
ax1.set_title("Nameplate vs. Peukert-Derated Capacity\nat this build's representative bench load",
                fontsize=12.8, fontweight="bold")
ax1.legend(fontsize=9.3, loc="upper right")
ax1.grid(axis="y", alpha=0.25)

colors = [RED if oh > SHUTDOWN_SOC_PCT else TEAL for oh in overhang]
bars2 = ax2.bar(x, overhang, color=colors, edgecolor=[c for c in colors])
for i, oh in enumerate(overhang):
    ax2.text(i, oh + 0.6, "%.1f%%" % oh, ha="center", fontsize=10.5, fontweight="bold",
              color=colors[i])
ax2.axhline(SHUTDOWN_SOC_PCT, color=AMBER, ls="--", lw=2.0,
             label="rig auto-cut threshold (naive SoC = 20%)")
ax2.set_xticks(list(x))
ax2.set_xticklabels(labels, fontsize=10)
ax2.set_ylabel("Naive-gauge SoC% at which true capacity is exhausted", fontsize=11)
ax2.set_title("Over-Discharge Risk — Where the Naive Gauge\nReads When the Real Pack Is Actually Empty",
                fontsize=12.8, fontweight="bold")
ax2.legend(fontsize=9.5, loc="upper right")
ax2.grid(axis="y", alpha=0.25)
ax2.set_ylim(0, max(overhang) * 1.3 + 5)

fig.suptitle("Peukert Derating and Its Consequence for Coulomb-Counted State of Charge",
              fontsize=15, fontweight="bold", y=1.02)
fig.tight_layout(rect=[0, 0.0, 1, 0.96])

out_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                          "peukert_derating_soc.png")
fig.savefig(out_path, dpi=150, bbox_inches="tight")
print("Saved:", out_path)
