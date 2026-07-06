# Lab Procedure: Aerodynamic Analysis

This document outlines the step-by-step workflow required to complete **Experiment 3: Aerodynamic Analysis — Propeller Blade Airfoil, Drag & Advance Ratio**. The experiment is split across **two module pages**, each with two tabs:

| Page | Tab 1 | Tab 2 |
|------|-------|-------|
| **Module 1 — Blade Airfoil Wind Tunnel** | Propeller Designer (blade geometry) | Airfoil Analysis (Cl–α, drag polar, BEMT) |
| **Module 2 — Wind Tunnel & Cruise Efficiency** | Frame Drag | Advance Ratio & Efficiency |

A floating **Aero Instructor** (bottom-right avatar) narrates the first entry to each tab, calls out faults/observations as they happen, and confirms task completion — click it to expand/collapse, and use the 🔊 icon to mute.

---

## Experiment Overview

| Sub-Calculation | Focus Area | Where |
|-----------------|------------|-------|
| Sub-Calc A | Lift Coefficient vs Angle of Attack | Module 1, Tab 2 |
| Sub-Calc B | Frame Aerodynamic Drag | Module 2, Tab 1 |
| Sub-Calc C | Advance Ratio & Propulsive Efficiency | Module 2, Tab 2 |

If Experiment 1 (Propulsion) has not yet been finalized, a banner reading **"Complete the previous step first"** appears — you can still explore this experiment with default parameters (N=2, Ø10in, NACA 0012), but your results will use placeholders instead of your real drone's inherited propeller.

---

## Stage 1: Propeller Design (Module 1, Tab 1)

### Objective
Design a physical propeller blade (diameter, twist, chord, blade count, material) before analysing its airfoil section.

### Step-by-Step Procedure

1. **Open Module 1** (`index.html`) — the **Propeller Designer** tab is active by default.
2. **Set blade count**: click the 2/3/4-blade buttons.
3. **Adjust geometry sliders**: Diameter, Root/Tip Pitch, Root/Tip Chord — the 3D propeller model updates live, and the pitch-twist and chord-distribution charts on the right redraw as you move each slider.
4. **Pick a blade material** from the material tiles (Glass Nylon / Carbon Nylon / Carbon Fibre) — this sets blade mass, shown in the Geometry Results cards.
5. **Click Run Simulation** to spin the propeller and confirm a valid, manufacturable geometry (tapered chord, washout twist) — the **Module Checklist**'s "Propeller Design" item ticks once this and a valid geometry are both true.

![Airfoil Profiling Interface](./images/airfoil_profiles.png)

---

## Stage 2: Airfoil Profiling (Module 1, Tab 2 — Sub-Calc A)

### Objective
Plot the Lift Coefficient (<i>C<sub>l</sub></i>) against the Angle of Attack (<i>&alpha;</i>) for the three NACA airfoil profiles and record stall characteristics.

### Step-by-Step Procedure

1. **Switch to the Airfoil Analysis tab.** The Aero Instructor introduces the module on first entry.
2. **Select a NACA airfoil profile** from the airfoil tiles: **NACA 0012** (symmetric), **NACA 2412** (2% camber), or **NACA 4412** (4% camber). Each tile shows its zero-lift angle and stall angle.
3. **Sweep the Angle of Attack (AoA) slider** from &minus;5° to 20°:
   * The live AoA diagram shows the airfoil section tilting, with lift/drag vectors and airflow streamlines that visibly **detach past the stall angle**.
   * The Cl–α chart plots **two lines** for the selected profile: the realistic working-model curve (solid) and the thin-airfoil-theory reference `2π(α−α₀)` (dashed) — watch them diverge once you pass stall.
4. **Watch for the stall marker** ("STALL" flag + reading Cl/Cd/L/D) once AoA exceeds the profile's stall angle — the Instructor calls this out the first time it happens.
5. **Vary the RPM slider** at least once (drives the BEMT results table and Figure-of-Merit reading).
6. **Repeat for all three airfoils** — the checklist's "Cl_max & stall angle recorded for all 3 airfoils" objective ticks once you've induced stall at least once on each profile; it also ticks "Observed: 4412 Cl_max > 0012 Cl_max" automatically (a real, seeded comparison — not hardcoded).
7. **Optional — Fault scenario:** select **"Over-cambered blade"** from the Fault Scenario dropdown to force NACA 4412 and see the higher-Cl_max/earlier-stall trade-off immediately.

### Key Observations
* NACA 4412 (heavily cambered) achieves a higher <i>C<sub>l,max</sub></i> (&asymp; 1.6 nominal, seeded ±4% per build) than the symmetric NACA 0012 (&asymp; 1.2), but stalls at a lower angle.
* The realistic curve tracks the dashed thin-airfoil line near <i>&alpha;<sub>0</sub></i> but bends over to peak exactly at the stall angle, then decays — the thin-airfoil line keeps climbing because it has no concept of separation.

![Advance Ratio Diagram](./images/advance_ratio_diagram.png)

---

## Stage 3: Frame Drag (Module 2, Tab 1 — Sub-Calc B)

### Objective
Measure the aerodynamic drag force (<i>F<sub>D</sub></i>) on the drone frame across forward speeds, and confirm it varies with the **square** of velocity, not velocity itself.

### Step-by-Step Procedure

1. **Open Module 2** (`index2.html`) — the **Frame Drag** tab is active by default; the Aero Instructor introduces the wind tunnel.
2. **Pick a frame** from the Frame Preset tiles — this sets frontal area (<i>A<sub>frontal</sub></i>) and reference length directly from the catalog (never hand-typed). If the frame is too small for the inherited propeller, the pick is rejected with an on-screen explanation and the tile reverts.
3. **Adjust Frontal Area, Drag Coefficient, Forward Speed and Altitude** sliders — the drag-derivation panel, force gauge, and animated 2D flow diagram update live.
4. **Toggle "Rotor-wash drag (real forward flight)"** under Flight Reality: with it off you see the clean-tunnel drag; with it on, an extra 15–30% (seeded per frame, shown as "Wash extra (k)") is added, and both the clean **and** effective drag values are shown side by side.
5. **Check the F_D vs V² Regression readout**: slope (should equal 0.5·ρ·Cd·A) and R² (target > 0.999) — confirming that plotting drag against **V²**, not V, gives the straight line.
6. **Optional — Fault scenario:** select **"High-altitude test (3000 m)"** to see thinner air lower both drag and available thrust simultaneously.

### Key Observations
* Drag force scales quadratically with velocity — doubling speed quadruples drag.
* The rotor-wash toggle demonstrates an important caveat directly: clean-body drag underestimates real flight drag.

![Drag Measurement Setup](./images/drag_setup.png)

---

## Stage 4: Advance Ratio & Cruise Efficiency (Module 2, Tab 2 — Sub-Calc C)

### Objective
Compute the Advance Ratio (<i>J</i>) and propulsive efficiency (<i>&eta;<sub>prop</sub></i>) across forward speeds, using the actual inherited propeller (not a fixed catalog value), and find the trim (cruise) speed.

### Step-by-Step Procedure

1. **Switch to the Advance Ratio & Efficiency tab.** The forward-speed sweep runs **automatically** across the full range (0 → V<sub>max</sub>) — there is no manual speed slider here.
2. **Review the Forward-Flight Derivation panel**: n (RPS), Advance Ratio J, Efficiency η, Shaft Power P, Trim speed, and forward-flight pitch angle θ, all computed from the actual BEMT solve of your inherited propeller.
3. **Use the joystick / Start Simulation** to fly the drone forward and watch the 3D model pitch nose-down as it accelerates, matching the derivation panel's θ.
4. **Read the Thrust & Power vs Forward Speed chart**: thrust falls and shaft power varies smoothly with speed (a genuinely smooth BEMT sweep — no manual data entry).
5. **Read the η–J chart**: the peak-efficiency point is marked with a star; the checklist's "Peak η_prop identified" objective ticks once that peak lands within J = 0.45–0.70.
6. **Locate the trim speed**: where available thrust (4×T) crosses frame drag on the Thrust-vs-Drag chart — the checklist's "Trim speed found" objective ticks here.
7. **Review the verdict panel** below the checklist: PASS when the cruise envelope closes (trim found, peak η ≥ 45%, effective drag finite); WARN if trim only holds with rotor-wash off; FAIL (naming Experiment 1 as the section to revisit) if available thrust never crosses drag at all.

### Key Observations
* Propulsive efficiency is zero at hover (no forward motion) and climbs to one clean peak before falling as the advancing blade approaches stall.
* Flying faster or slower than the peak-efficiency speed wastes power.

![Propulsive Efficiency Curve](./images/efficiency_curve.png)

---

## Summary: Expected Results

| Parameter | Expected Value |
|-----------|----------------|
| NACA 4412 <i>C<sub>l,max</sub></i> | &approx; 1.6 (seeded ±4%) |
| NACA 0012 <i>C<sub>l,max</sub></i> | &approx; 1.2 (seeded ±4%) |
| <i>F<sub>D</sub></i> vs <i>V</i><sup>2</sup> regression | <i>R</i><sup>2</sup> &gt; 0.999 |
| Peak <i>&eta;<sub>prop</sub></i> advance ratio | <i>J</i> &asymp; 0.45–0.70 (propeller-dependent) |
| Rotor-wash extra drag | 15–30% (seeded per frame) |

---

## Component Unlocked

Upon completing both modules (Module Checklist fully ticked on each page, "Finish Experiment" enabled):

1. **Propeller Blade Profile**: the 3D model reflects the selected NACA section.
2. **Store values for the downstream experiments**: `frame_drag_N` (clean), `frame_drag_eff_N` (wash-corrected), `eta_prop_peak`, `J_best`, `Vtrim_mps`, `optimal_speed_ms`, `airfoilId`, `cl_max_measured`, and `stall_angle_deg` are written to the shared cross-experiment store, where the flight-performance experiment (Experiment 6) reads them for its final mission budget. If Experiment 1 is later re-finalized with a different propeller, this experiment is flagged stale and the on-page banner names Experiment 1 as the section to revisit.
