# Lab Procedure: Battery Pack Energy Storage & Discharge Behaviour

You are on a battery bench, not a flight line. The airframe stays fixed for the whole experiment and only the pack changes, which is the point — it isolates what the C-rating and the internal resistance actually do. Three sub-experiments across two modules, all on one page.

| Module | Sub-experiment | Reports |
|---|---|---|
| Module 1 · Pack Under Load | Pack Under Load — C-Rating & Sag | Peak draw (A) and volts per cell |
| Module 2 · Energy & Endurance | Endurance & Diminishing Returns | Hover time (min) |
| Module 2 · Energy & Endurance | SoC Discharge Mapping | State of charge (%) |

A **Procedure** card sits beside the viewport and lists the physical bench steps for whichever sub-experiment is active, ticking them off as the run reaches them. It is worth reading before you press Run — it tells you what the instruments in the 3D scene are actually doing.

The telemetry strip carries pack voltage, volts per cell, state of charge and C-rate headroom alongside the usual thrust and current readouts.

---

## Module 1 · Pack Under Load

### Objective

Find out whether the pack can supply the current this airframe demands, and how far its terminal voltage falls while doing it.

![C-rating safety margins across four catalog battery packs](./images/crate_safety_margins.png)

The bench steps, in order: pack on the ESD mat with the XT60 into the analyzer, analyzer output into the load bank with Kelvin sense clipped to the pack terminals, zero the shunt and record open-circuit voltage, then ramp the load from 0 to 100% of four-motor demand over eight seconds.

1. Read the pack's specs on the left: capacity in mAh, continuous C-rating, burst C-rating. Work the limits out yourself — I_cont = C_cont × Capacity_Ah is the number that matters, and it is usually smaller than people expect.

2. Compare that against the draw the solver reports. This is the real four-motor current for the build in front of you, not a rule of thumb.

3. Press **▶ Run Sim**. A spike during the ramp is normal and does not fail anything; the fault timer only trips after three seconds of sustained draw above I_cont.

4. Watch the volts-per-cell readout while the load comes on. Terminal voltage is V_terminal = N_cells·(V_oc − I·R_cell,eff), and R_cell,eff grows as the pack empties, so the sag gets worse as the run goes on.

![Battery pack equivalent circuit and voltage sag curve](./images/battery_circuit_and_sag.png)

### The two ways to fail

The build starts on a **4S 5200 mAh** pack rated 30C continuous. It draws about 80 A against a 156 A limit and holds 3.74 V/cell, so it passes both checks — and it weighs 480 g to do it. That is your baseline, not the interesting case.

Now fit the **4S 1300 mAh (low-C)** pack, 12C continuous with 24 mΩ cells. It fails both checks at once. The draw is around 56 A against a 15.6 A continuous limit, so it vents. And the terminal voltage collapses to about 3.02 V/cell, well under the 3.30 V brownout floor, so the ESC lets go too. Those are not two coincidences: the high cell resistance is what caps the C-rating *and* what causes the sag.

Then fit the **4S 1500 mAh (high-C)** pack, 100C continuous with 3.2 mΩ cells. It pulls *more* current than the 5200 — about 91 A, because the stiffer pack holds its voltage up and the motors take advantage — and it still passes, at 4.01 V/cell, on less than a third of the capacity and 175 g instead of 480 g.

That is the lesson of the module. Capacity and discharge capability are separate specifications, and the mAh printed on the label tells you nothing about whether the pack can survive the airframe. Try the **4S 3300 mAh** (25C) too — about 81 A against an 82.5 A limit is a pass by a hair, and a pack that thin on margin is one warm day from venting.

---

## Module 2 · Endurance & Diminishing Returns

### Objective

Turn the pack's real, derated capacity into minutes of hover — and find out why buying a bigger pack stops helping.

![Peukert-derated effective capacity and over-discharge risk across battery packs](./images/peukert_derating_soc.png)

The bench steps here are a flight: fit the pack, check all-up weight and thrust-to-weight, arm and confirm hover current, climb to the commanded altitude, hold the hover until the SoC cut-off, land, and read the flight time against capacity.

1. Start with the derating. Effective capacity is the nameplate figure multiplied by a Peukert factor set by the pack's own continuous C-rating, so a low-C pack is penalised twice over — once on safe current, once on the capacity it can actually deliver. Anything at 30C or above keeps its full nameplate; the 25C 3300 mAh pack keeps about 95% of it; the 12C 1300 mAh pack keeps only 72%, losing more than a quarter of what the label promises. A high-C pack tracks its nameplate almost exactly, which is a second reason the good pack keeps winning.

2. Run the hover and let it fly to the cut-off. The simulator fast-forwards once the hover is stable, so a multi-minute endurance fits into a short run.

3. Now step the capacity up and re-run. Endurance rises, but not proportionally, because the pack's own mass rises with it and that mass has to be carried.

4. Keep going until the curve visibly bends over. Past that point the extra cells are mostly lifting themselves.

5. The readout warns you when a mission would need the pack drawn below its safe minimum SoC to finish. That is not a pass with a caveat, it is a plan that damages the pack.

Push the capacity far enough and the build stops hovering altogether — the verdict says so directly. Bigger is not always better is not a slogan here; it is a thrust-to-weight ratio dropping below one.

---

## Module 2 · SoC Discharge Mapping

### Objective

Run a naive fuel gauge and an honest one side by side, and measure the gap between them.

The bench steps: pack onto the rig with the balance lead in the port, set the constant-current bench load, discharge while logging cell voltage against coulombs out, and watch the 20% gauge cut-off arm.

1. Two coulomb counters run from the same current draw. The **naive** one integrates against the pack's *nameplate* capacity; the **true** one integrates against the Peukert-derated *effective* capacity.

2. Watch them separate. The naive gauge reads optimistically high, and the error grows as the pack empties, because it is counting down from a capacity that was never there.

3. Compare the voltage-based readings too. A linear map from cell voltage to percentage looks reasonable at the ends and is badly wrong through the middle, where the OCV curve is nearly flat. The true OCV-inverted value shows how flat.

4. Let the run reach the cut-off. If the auto-cut fires, the verdict tells you where it stopped. If the pack goes genuinely empty, it reports the resting cell voltage — that is an over-discharged cell, and it does not come back.

The gap between the two gauges is the safety margin a cheap fuel gauge quietly eats. It is also why a pack can brown out an ESC while the display still claims charge remaining.

---

Pass all three and the reward pack unlocks under **Components Unlocked**.
