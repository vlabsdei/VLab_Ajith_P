# Lab Procedure: Battery Pack Energy Storage & Discharge Behaviour

This document outlines the step-by-step workflow for **Experiment 2: Energy Storage System**. The experiment inherits the propulsion build from Experiment 1 and characterises the battery pack feeding it across four bench sub-experiments, grouped into two modules: **Module 1** (C-Rating Safety Check + Voltage Sag Under Load) and **Module 2** (Endurance & Diminishing Returns + SoC Discharge Mapping). Only the battery pack changes between runs — the airframe is held fixed so that each pack's C-rating and internal resistance are isolated. Every value is computed live from the same motor/propeller/pack solve used throughout the lab, and your session saves automatically.

---

## **Stage 1: C-Rating Safety Check (Module 1)**

### **Objective**
Confirm the pack can sustain the airframe's real full-throttle current draw without exceeding its continuous discharge rating.

![C-Rating safety margins across four catalog battery packs](./images/crate_safety_margins.png)

### **Step-by-Step Procedure**
1. **Launch the Simulator:** Open the virtual lab page. It loads into **Module 1 → C-Rating Safety Check**, with the inherited build and the default pack selected.
2. **Note the pack specs.** The left panel shows the selected pack's capacity (mAh), continuous C-rating and burst C-rating. Compute the limits: **I_cont = C_cont · Capacity_Ah** and **I_burst = C_burst · Capacity_Ah**.
3. **Read the actual draw.** The solver reports the real full-throttle current **I_total** pulled by the four-motor circuit — not an assumed value. Compare it against I_cont.
4. **Run the discharge test.** Click **Run**. A current spike during the throttle ramp is normal; the timer only flags a fault after **3 seconds of sustained draw above I_cont**.
5. **Read the verdict.** Confirm the default 4S 3300 mAh (15C) pack **vents** on this airframe (116.2 A draw vs 49.5 A continuous): `Battery vented — sustained draw exceeds continuous rating`.
6. **Fix by C-rating, not capacity.** Swap in the 4S 1500 mAh high-C pack (100C): the same motors now draw 133.9 A against a 150 A limit — a clean pass off a pack with *less* than half the mAh. Confirm capacity and discharge capability are independent specs.

---

## **Stage 2: Voltage Sag Under Load (Module 1)**

### **Objective**
Trace the terminal-voltage drop under full load back to the pack's internal resistance, and check it clears the brownout floor.

![Battery pack equivalent circuit and voltage sag curve](./images/battery_circuit_and_sag.png)

### **Step-by-Step Procedure**
1. **Switch to the Voltage Sag tab.** The viewport shows the pack's equivalent circuit: open-circuit voltage source in series with the pack resistance R_pack.
2. **Read the open-circuit voltage.** The OCV follows the nonlinear cell curve **V_oc = 3.50 + 0.70·SoC + 0.10·SoC³** per cell — steep near full and empty, flat through the middle.
3. **Apply full load.** Run the test and watch the terminal voltage sag: **V_terminal = N_cells·(V_oc − I·R_cell,eff)**, where R_cell,eff grows sharply as the pack empties (the low-SoC swell term).
4. **Read the per-cell voltage.** Confirm the default 3300 mAh pack (6.5 mΩ/cell) sags to **3.541 V/cell** at 116.2 A — clearing the 3.50 V/cell pass floor by only 0.041 V (marginal).
5. **Trigger a brownout.** Swap in the 4S 1300 mAh low-C pack (24 mΩ/cell): terminal voltage collapses to the 2.8 V/cell floor, deep past the **3.30 V/cell brownout line**, and the readout reports `ESC BROWNOUT` after 1.5 s sustained.
6. **Connect cause to spec.** Note that the high-C pack's low `cell_ir_mohm` is the *same* physical property that sets its C-rating — a good pack wins both checks at once.

---

## **Stage 3: Endurance & Diminishing Returns (Module 2)**

### **Objective**
Convert the pack's Peukert-derated real capacity into hover endurance, and see why a bigger pack does not buy proportionally more flight time.

![Peukert-derated effective capacity and over-discharge risk across battery packs](./images/peukert_derating_soc.png)

### **Step-by-Step Procedure**
1. **Proceed to Module 2 → Endurance & Diminishing Returns.** The panel shows nameplate vs effective capacity for the selected pack.
2. **Read the Peukert derating.** The effective capacity is **Capacity_eff = Capacity_nameplate · peukertFactor(C_cont)** — a low-C pack is penalised twice (once on safe current, once on deliverable capacity). Confirm the default 15C pack delivers only **~2599 mAh of its 3300 mAh** nameplate (−21%).
3. **Sweep pack capacity.** Increase capacity and watch hover endurance rise — but note the pack's own mass rises with it, so the endurance gain flattens.
4. **Read the diminishing-returns curve.** Confirm the endurance-vs-capacity curve bends over: past a point, added cells mostly carry their own weight rather than extending flight time.
5. **Check over-discharge risk.** Verify the readout warns when a pack would be drawn below its safe minimum SoC to complete the mission.

---

## **Stage 4: SoC Discharge Mapping (Module 2)**

### **Objective**
Compare a naive fuel gauge against a true coulomb counter and OCV-inverted reading, exposing the state-of-charge error.

### **Step-by-Step Procedure**
1. **Switch to the SoC Discharge Mapping tab.** Two SoC estimators run in parallel from the same current draw.
2. **Run the discharge.** The **naive** counter integrates against the *nameplate* capacity (**SoC_naive −= ΔAh / Capacity_nameplate**); the **true** counter integrates against the Peukert-derated *effective* capacity.
3. **Watch the two diverge.** Confirm the naive gauge reads optimistically high as the pack empties, because it is counting against a capacity the pack cannot actually deliver.
4. **Read SoC from voltage.** Compare the naive linear voltage reading **SoC_naive,V = (V_cell − 3.5)/(4.2 − 3.5)·100%** against the true OCV-inverted value — the true curve is far flatter through the middle of the discharge.
5. **Interpret the gap.** Note that the gap between the two is exactly the safety margin a cheap fuel gauge silently eats, and the reason a pack can hit brownout while its gauge still reads charge remaining.
6. **Complete the experiment.** Once all four sub-experiments pass, the reward model unlocks under **Components Unlocked**, confirming completion of **Experiment 2**.
