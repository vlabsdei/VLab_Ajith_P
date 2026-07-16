# Lab Procedure: Cruise Power, Endurance, Energy Budget & Range-Payload

This document outlines the step-by-step workflow for the **Mission Performance** capstone. The experiment lives on a single page with two modules, each holding two sub-experiments: **Module 1 — Power & Speed** (Power Profiling, Endurance Speed) and **Module 2 — Mission & Range** (Mission Energy, Range-Payload). Every value is computed live from the assembled build, and your session is saved automatically — reloading the page resumes exactly where you left off, with only your progress (not a run history) kept.

---

## **Stage 1: Power Profiling — Build the U-Curve**

### **Objective**
Sweep airspeed across the flight envelope and watch parasitic drag and induced power trade off into the U-shaped cruise-power curve.

![Cruise power vs airspeed: the U-shaped power curve with its minimum marked](./images/cruise_power_curve.png)

### **Step-by-Step Procedure**
1. **Launch the Simulator.** Open the virtual lab page. It loads with the assembled quad in the centre view and Module 1 · Power Profiling active.
2. **Confirm the build.** The left panel shows the inherited component catalogue (chassis, propeller, motor, ESC, battery, controller, receiver, attachments) plus the two new mission cards: **Payload** (0–2000 g) and **Cruise Airspeed** (5/10/15 m/s presets, or a free 2–20 m/s slider).
3. **Set density altitude and payload.** Leave payload at 0 g for the first run and note the Diagnostics Log clears with no build errors.
4. **Run the sweep.** Press Run. The telemetry cursor sweeps airspeed from 2 to 20 m/s while Thrust, Drag, Induced Power and Cruise Power update live, and the live graph draws a growing U-curve.
5. **Confirm the minimum.** The run passes once a finite minimum is found in the sweep — for the reference build (fpv5 / 5&Prime; / 1806 / 4S-1500, no payload) the minimum sits near **V &asymp; 9.5 m/s, P<sub>cruise</sub> &asymp; 26 W**, comfortably inside the 6–13 m/s band typical of small multirotors.

---

## **Stage 2: Endurance Speed — Reading the Bottom of the Curve**

### **Objective**
Locate the exact minimum-power speed (maximum endurance) and contrast it with the maximum-range speed on the same curve.

![Endurance speed and max-range speed marked on the same power curve](./images/endurance_vs_range_speed.png)

### **Step-by-Step Procedure**
1. **Switch to Module 1 · Endurance Speed.** The simulator computes the full U-curve in one pass and animates a cursor sweeping to its minimum, dropping a marker at <i>V</i><sub>endur</sub>.
2. **Read the endurance speed.** The telemetry and calc chips report <i>V</i><sub>endur</sub> and the minimum power there — for the reference build, **&asymp; 9.5 m/s at &asymp; 26 W**.
3. **Read the max-range speed alongside it.** The same view marks <i>V</i><sub>range</sub> — the speed that minimises power **per unit distance** rather than per unit time. It is always faster than <i>V</i><sub>endur</sub>; for the reference build it sits near **&asymp; 13.5 m/s**.
4. **Compare the two.** Note that flying at <i>V</i><sub>endur</sub> maximises total flight time (best for loiter/surveillance), while flying at <i>V</i><sub>range</sub> maximises distance covered (best for point-to-point delivery) — the same aircraft, two different optimum speeds depending on the mission.
5. **Sweep the build.** Change propeller size or battery and re-run; watch both speeds and the power curve itself shift with disk area and mass.

---

## **Stage 3: Mission Energy — Budgeting a Real Flight**

### **Objective**
Break a mission into hover and cruise phases and confirm the battery holds enough Watt-hours to complete it.

![Stacked mission-phase energy: hover and cruise segments accumulating to the total Watt-hour budget](./images/mission_energy_phases.png)

### **Step-by-Step Procedure**
1. **Switch to Module 2 · Mission Energy.** Open the **Calculations** card ("full derivation ›") — while this sub-experiment is active it shows an editable **Mission phase durations** block (takeoff hover, cruise-out, hover-on-station, cruise-back, landing hover) above the numbered derivation steps. Edit any duration there; the cruise-out and cruise-back legs auto-recompute from distance / airspeed whenever you move the Cruise Airspeed slider.
2. **Run the budget.** The simulator accumulates energy phase by phase and animates a stacked phase-energy chart on the live graph; telemetry shows the running Watt-hour total.
3. **Read the verdict.** The mission **PASSes** if the battery's usable energy (capacity &times; voltage, discounted by system efficiency &eta;<sub>total</sub>) exceeds the total mission energy; otherwise a FAIL diagnostic flags the shortfall.
4. **Confirm the reference numbers.** A 500 m out-and-back hop at 10 m/s with 30/60/30 s hover phases costs the reference build **&asymp; 1.85 Wh** against a 4S/1500 pack's **22.2 Wh** rated energy — a wide margin.
5. **Stress the budget.** Lengthen the cruise distance, add payload, or switch to a smaller pack and re-run; watch the margin shrink until the verdict flips to FAIL.

---

## **Stage 4: Range-Payload — Mapping the Envelope**

### **Objective**
Sweep payload across several battery packs and map the range-payload envelope that fixes the mission's operating limits.

![Range vs payload for three battery packs, showing the falling envelope](./images/range_payload_envelope.png)

### **Step-by-Step Procedure**
1. **Switch to Module 2 · Range-Payload.** The simulator sweeps payload from 0 g to its maximum across three representative battery packs (e.g. 3S/2200, 4S/1500, 6S/5000) and plots three live range-payload curves.
2. **Read the Charts card.** The static analysis chart shows the final three-curve envelope with a legend identifying each pack.
3. **Confirm the payload penalty.** At 10 m/s cruise on the 4S/1500 pack, doubling payload from 200 g to 400 g cuts range from **&asymp; 9.5 km to &asymp; 6.2 km** — a drop of roughly a third, because induced power grows super-linearly with weight (exactly <i>T</i><sup>1.5</sup> at hover, steeper still in forward flight), not linearly.
4. **Compare packs.** Note how a larger pack simply raises the whole curve (more usable Watt-hours buys more range at every payload) — the simulator compares the three packs purely on rated energy and does not add the extra physical mass a bigger real pack would carry, so treat the envelope as an energy-only comparison rather than a full weight trade-off.
5. **Verify completion.** The right panel confirms all four sub-experiments are done (`4 / 4`) and unlocks the capstone reward — **Payload Bay + Mission Spec** — finalising the drone's mission envelope: optimal speed, endurance speed, and range-payload limits, completing the Mission Performance experiment.
