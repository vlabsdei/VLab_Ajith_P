# Theoretical Background: Aerodynamic Analysis

This experiment covers the full aerodynamic picture of the drone. Previous experiments treated thrust as a simple vector; this module breaks down exactly how that thrust is made by the propeller blade, how the drone's body fights forward motion, and how efficiently the propeller turns rotational power into forward thrust.

Before we get into the physics, the animation below walks through the full aerodynamic story: a single blade section acting as a wing, then lift, drag, and stall, and finally the spinning propeller and the efficiency it delivers.

<p align="center">
  <video controls playsinline preload="metadata" width="100%" style="max-width: 860px; border-radius: 8px;">
    <source src="./videos/aerodynamic_analysis_final.mp4" type="video/mp4">
    Your browser does not support the HTML5 video tag. You can
    <a href="./videos/aerodynamic_analysis_final.mp4">download the video</a> instead.
  </video>
</p>

---

## 1. Lift Coefficient vs Angle of Attack (Sub-Calc A)

The lift an airfoil makes is described by the Lift Coefficient (<i>C</i><sub>l</sub>), a dimensionless number for the lifting ability of the blade section. Classical **thin-airfoil theory** predicts a lift curve that stays linear in the Angle of Attack (<i>&alpha;</i>) forever:

<p align="center"><b><i>C</i><sub>l</sub> = 2&pi;(<i>&alpha;</i> &minus; <i>&alpha;</i><sub>0</sub>)</b></p>

Where <i>&alpha;</i><sub>0</sub> is the zero-lift angle of attack (NACA TR-824). This line is plotted in the simulator as a **dashed reference** on the Cl&ndash;&alpha; chart. It is the textbook prediction, not the working model, because it has no concept of flow separation and keeps climbing forever.

> **Override: the sim's working model.** The simulator instead uses a **realistic attached-flow + post-stall** model. In the attached region (between the negative and positive stall angles) <i>C</i><sub>l</sub> follows a smooth curve that closely tracks the thin-airfoil slope near <i>&alpha;</i> = <i>&alpha;</i><sub>0</sub> but bends over to reach <i>C</i><sub>l,max</sub> **exactly at the stall angle** (so the stall marker always lines up with the true lift peak). Past stall, <i>C</i><sub>l</sub> decays gradually rather than dropping to zero, because real separated flow still makes some lift. This is why the realistic curve and the dashed thin-airfoil line visibly diverge once <i>&alpha;</i> nears and passes the stall angle, exactly the "low-Reynolds dilemma" the reality check below describes.

> **Manufacturing tolerance (seeded).** Each airfoil's catalog <i>C</i><sub>l,max</sub> and <i>C</i><sub>d0</sub> are nominal spec-sheet values. The simulator perturbs them &plusmn;4% and &plusmn;6% respectively, seeded deterministically per airfoil (the same "as-manufactured, not nominal" convention as every other experiment in this lab). Surface finish and moulding tolerance shift a real blade's polar slightly from the catalog number every time you load the page, but reproducibly for a given profile.

> **Worked example: lift coefficient of a NACA 2412 section at <i>&alpha;</i> = 5&deg;, thin-airfoil reference value.** Using the zero-lift angle <i>&alpha;</i><sub>0</sub> = &minus;2.0&deg; from the NACA airfoil table below:
> <p align="center"><i>C</i><sub>l</sub> = 2&pi;(<i>&alpha;</i> &minus; <i>&alpha;</i><sub>0</sub>) = 2&pi;(5&deg; &minus; (&minus;2&deg;)) = 2&pi; &times; 0.1222 rad = <b>0.768</b></p>
> This sits well below the section's <i>C</i><sub>l,max</sub> &asymp; 1.4 (stall at 14&deg;), so the flow stays fully attached here and the thin-airfoil reference line and the sim's working model agree closely in this range. They only diverge near and past stall.

### NACA Airfoil Profiles

The NACA 4-digit airfoil designation describes the geometry:
* **First digit**: maximum camber as percentage of chord (0 = symmetric)
* **Second digit**: location of maximum camber from the leading edge (tenths of chord)
* **Third & fourth digits**: maximum thickness as percentage of chord

| Airfoil | Camber (%) | Camber Position | Thickness (%) | <i>&alpha;</i><sub>0</sub> (deg) |
|---------|------------|-----------------|---------------|------------------|
| NACA 0012 | 0 | N/A | 12 | 0.0 |
| NACA 2412 | 2 | 40% | 12 | -2.0 |
| NACA 4412 | 4 | 40% | 12 | -4.0 |

### Stall Characteristics

As the angle of attack rises, the lift coefficient rises linearly until the flow separates from the upper surface. This separation causes:
* **Stall**: a sudden loss of lift
* **Cl_max**: the maximum lift coefficient before stall
* **Stall angle**: the angle of attack at which Cl_max occurs

The heavily cambered NACA 4412 reaches a higher <i>C</i><sub>l,max</sub> &asymp; 1.6 than the symmetric NACA 0012 (<i>C</i><sub>l,max</sub> &asymp; 1.2), but it stalls at a lower angle of attack.

> **Low-Re Stall Note:** The stall angles listed (e.g. NACA 0012 at 15&deg;) are based on high-Reynolds-number wind tunnel data (<i>Re</i> &gt; 1&times;10<sup>6</sup>). Drone propeller tips typically run at <i>Re</i> = 50,000&ndash;200,000, where stall usually comes earlier at 12&ndash;14&deg;. The curves in this experiment are high-Re educational approximations; see Section 5 for low-Reynolds number considerations.

![Airfoil Profiles Comparison](./images/airfoil_profiles.png)

---

## 2. Aerodynamic Drag (Sub-Calc B)

The aerodynamic drag force fighting the drone's forward motion comes from the drag equation:

<p align="center"><b><i>F</i><sub>D</sub> = 0.5 &middot; <i>&rho;</i> &middot; <i>V</i><sup>2</sup> &middot; <i>C</i><sub>d</sub> &middot; <i>A</i><sub>frontal</sub></b></p>

Where:
* <i>F</i><sub>D</sub> is the drag force fighting the drone's motion, in Newtons (N).
* <i>&rho;</i> (rho) is the air density (1.225 kg/m<sup>3</sup> at sea level).
* <i>V</i> is the wind speed or forward airspeed, in metres per second (m/s).
* <i>C</i><sub>d</sub> is the drag coefficient. For a standard X-frame bluff body, this is taken as **1.05**, based on NASA TN-D-8236. **Note:** this value is for the clean airframe body. In actual forward flight, rotor downwash turbulence and interference typically add 20&ndash;30% more drag to the total system, which this body-only model does not capture.
* <i>A</i><sub>frontal</sub> is the frontal cross-sectional area of the drone.

> **Worked example: frame drag of the 250 mm build at top wind speed.** For the cf_250 frame (<i>A</i><sub>frontal</sub> = 0.0085 m<sup>2</sup>), the X-frame drag coefficient <i>C</i><sub>d</sub> = 1.05, sea-level <i>&rho;</i> = 1.225 kg/m<sup>3</sup> and the maximum tunnel speed <i>V</i> = 15 m/s:
> <p align="center"><i>F</i><sub>D</sub> = 0.5 &middot; <i>&rho;</i> &middot; <i>V</i><sup>2</sup> &middot; <i>C</i><sub>d</sub> &middot; <i>A</i> = 0.5 &middot; 1.225 &middot; 15<sup>2</sup> &middot; 1.05 &middot; 0.0085 = <b>1.23 N</b></p>
> That is roughly 125 g-force of drag, modest at 15 m/s, but because <i>F</i><sub>D</sub> &prop; <i>V</i><sup>2</sup> it quadruples if the airspeed doubles.

### Quadratic Drag Relationship

The drag equation shows that drag force scales with the **square of velocity**. This means:
* Doubling speed quadruples drag
* Power needed to overcome drag scales with <i>V</i><sup>3</sup>

Plot <i>F</i><sub>D</sub> against <i>V</i><sup>2</sup> and you get a perfectly linear regression with slope equal to 0.5 &middot; <i>&rho;</i> &middot; <i>C</i><sub>d</sub> &middot; <i>A</i>.

![Drag Force Setup](./images/drag_setup.png)

---

## 3. Advance Ratio (Sub-Calc C)

The Advance Ratio (<i>J</i>) is a dimensionless parameter relating forward speed to propeller tip speed:

<p align="center"><b><i>J</i> = <sup><i>V</i></sup> &frasl; <sub>(<i>n</i> &middot; <i>D</i>)</sub></b></p>

Where:
* <i>J</i> is the Advance Ratio, a dimensionless parameter.
* <i>V</i> is the forward airspeed (m/s).
* <i>n</i> is the propeller rotational speed in revolutions per second (RPS).
* <i>D</i> is the propeller diameter in metres.

> **Worked example: advance ratio of the 5045 prop at 12,000 RPM.** Taking <i>n</i> = 200 RPS (12,000 RPM) for the 5045 prop (<i>D</i> = 0.127 m) at a forward speed <i>V</i> = 12 m/s:
> <p align="center"><i>J</i> = <sup><i>V</i></sup> &frasl; <sub>(<i>n</i> &middot; <i>D</i>)</sub> = <sup>12</sup> &frasl; <sub>(200 &times; 0.127)</sub> = <b>0.472</b></p>
> This is just below the propeller's optimal <i>J</i> &asymp; 0.55; reaching the peak-efficiency point at this RPM needs <i>V</i> = 0.55 &times; 200 &times; 0.127 &asymp; 13.97 m/s.

### Physical Interpretation

* **J = 0 (Hover)**: the propeller runs in static conditions with no forward motion.
* **J > 0 (Forward Flight)**: the propeller advances through the air, which lowers the effective angle of attack.
* **High J**: the propeller may windmill or reverse its thrust.
* **Optimal J**: at the advance ratio where propulsive efficiency peaks, the effective blade angle of attack is at its most efficient point on the blade section's lift-to-drag polar, so the blade runs closest to its design Cl/Cd maximum.

The advance ratio bridges static hover performance and forward cruise efficiency.

![Advance Ratio Diagram](./images/advance_ratio_diagram.png)

---

## 4. Propulsive Efficiency (Sub-Calc C)

Propulsive efficiency (<i>&eta;</i><sub>prop</sub>) measures how well the propeller turns rotational power into forward thrust:

<p align="center"><b><i>&eta;</i><sub>prop</sub> = <sup>(<i>T</i> &middot; <i>V</i>)</sup> &frasl; <sub>(2&pi; &middot; <i>n</i> &middot; <i>Q</i>)</sub></b></p>

Where:
* <i>&eta;</i><sub>prop</sub> is the propulsive efficiency, as a percentage (%).
* <i>T</i> is the thrust (N).
* <i>V</i> is the forward airspeed (m/s).
* <i>n</i> is the rotational speed (RPS).
* <i>Q</i> is the propeller torque (N&middot;m), from the torque coefficient.

### Torque Calculation

The propeller torque is:

<p align="center"><b><i>Q</i> = <i>C</i><sub>q</sub> &middot; <i>&rho;</i> &middot; <i>n</i><sup>2</sup> &middot; <i>D</i><sup>5</sup></b></p>

> **Override: Ct/Cq are derived live, not fixed constants.** The catalog's <i>C</i><sub>t</sub> &asymp; 0.109 / <i>C</i><sub>q</sub> &asymp; 0.0122 for the 5045 propeller are **static-hover reference points**, not the working model. The simulator instead runs a full Blade-Element/Momentum-Theory (BEMT) solve every frame, coupling each blade station's lift/drag (including the Reynolds penalty above) to the local induced velocity via annular momentum theory with Prandtl tip-loss, and integrates the true <i>C</i><sub>t</sub>(<i>J</i>)/<i>C</i><sub>q</sub>(<i>J</i>) for the actual inherited propeller at the actual forward speed. The fixed catalog values below are only used to sanity-check the worked numbers against the static reference case (<i>J</i> = 0).

> **Worked example: thrust, torque and efficiency at the optimal advance ratio (static-reference Ct/Cq).** Running the 5045 prop (<i>C</i><sub>t</sub> = 0.109, <i>C</i><sub>q</sub> = 0.01223, <i>D</i> = 0.127 m) at <i>n</i> = 200 RPS, with <i>V</i> = 13.97 m/s so that <i>J</i> = 0.55:
> <p align="center"><i>T</i> = <i>C</i><sub>t</sub> &middot; <i>&rho;</i> &middot; <i>n</i><sup>2</sup> &middot; <i>D</i><sup>4</sup> = 0.109 &middot; 1.225 &middot; 200<sup>2</sup> &middot; 0.127<sup>4</sup> = <b>1.39 N</b></p>
> <p align="center"><i>Q</i> = <i>C</i><sub>q</sub> &middot; <i>&rho;</i> &middot; <i>n</i><sup>2</sup> &middot; <i>D</i><sup>5</sup> = 0.01223 &middot; 1.225 &middot; 200<sup>2</sup> &middot; 0.127<sup>5</sup> = <b>0.0198 N&middot;m</b></p>
> <p align="center"><i>&eta;</i><sub>prop</sub> = <sup>(<i>T</i> &middot; <i>V</i>)</sup> &frasl; <sub>(2&pi; &middot; <i>n</i> &middot; <i>Q</i>)</sub> = <sup>(1.39 &times; 13.97)</sup> &frasl; <sub>(2&pi; &times; 200 &times; 0.0198)</sub> = <b>0.780 = 78.0%</b></p>
> The result lands right on the calibrated peak of &asymp; 78% for the 5045 at <i>J</i> &asymp; 0.55: the propeller is running at its most efficient cruise point.

### Efficiency Curve Characteristics

* **At Hover (V = 0)**: <i>&eta;</i><sub>prop</sub> = 0 (no useful work is done)
* **Peak Efficiency**: at the optimal advance ratio (<i>J</i> &asymp; 0.55 for the 5045 propeller)
* **Beyond Peak**: efficiency drops as the advancing blade stalls

![Propulsive Efficiency Curve](./images/efficiency_curve.png)

---

## 5. Low Reynolds Number Considerations

Small drone propellers run in a low Reynolds number regime (<i>Re</i> &lt; 200,000) where viscous effects dominate. The Reynolds number is:

<p align="center"><b><i>Re</i> = <sup>(<i>&rho;</i> &middot; <i>v</i><sub>tip</sub> &middot; <i>c</i><sub>mean</sub>)</sup> &frasl; <sub><i>&mu;</i></sub></b></p>

Where:
* <i>v</i><sub>tip</sub> = &pi; &middot; <i>n</i> &middot; <i>D</i> is the blade tip speed
* <i>c</i><sub>mean</sub> is the mean blade chord
* <i>&mu;</i> is the air dynamic viscosity

> **Worked example: blade-tip Reynolds number.** With <i>n</i> = 200 RPS, <i>D</i> = 0.127 m, mean blade chord <i>c</i><sub>mean</sub> = 0.012 m and <i>&mu;</i> = 1.81&times;10<sup>&minus;5</sup> Pa&middot;s:
> <p align="center"><i>v</i><sub>tip</sub> = &pi; &middot; <i>n</i> &middot; <i>D</i> = &pi; &times; 200 &times; 0.127 = <b>79.8 m/s</b></p>
> <p align="center"><i>Re</i> = <sup>(<i>&rho;</i> &middot; <i>v</i><sub>tip</sub> &middot; <i>c</i><sub>mean</sub>)</sup> &frasl; <sub><i>&mu;</i></sub> = <sup>(1.225 &times; 79.8 &times; 0.012)</sup> &frasl; <sub>1.81&times;10<sup>&minus;5</sup></sub> = <b>6.5&times;10<sup>4</sup></b></p>
> At <i>Re</i> &asymp; 65,000 the blade sits firmly in the low-Reynolds regime (<i>Re</i> &lt; 200,000), so viscous effects matter and the high-Re lift curves should be read as educational approximations.

### Reality Check: Low-Reynolds Dilemma, now a real, implemented penalty

Thin airfoil theory breaks down near stall angles (<i>&alpha;</i> &gt; 12&deg;) and at low Reynolds numbers. At <i>Re</i> = 50,000 (typical propeller tip conditions), a symmetric airfoil might actually beat a cambered one, and the high-Re curves overstate real performance. **This is no longer just a caveat: the simulator applies it as a real penalty** on every BEMT solve:

<p align="center"><b><i>k</i><sub>Re</sub> = min(1, (<i>Re</i> / <i>Re</i><sub>ref</sub>)<sup>0.25</sup>),&nbsp;&nbsp; <i>Re</i><sub>ref</sub> = 150,000</b></p>

Each blade station's local <i>C</i><sub>l</sub> is multiplied by <i>k</i><sub>Re</sub> (and <i>C</i><sub>d0</sub> is divided by <i>k</i><sub>Re</sub>, so drag rises as Re falls) using that station's own instantaneous Reynolds number. A fast-spinning tip at <i>Re</i> &gt; 150,000 sees no penalty (<i>k</i><sub>Re</sub> = 1), while a slower inboard station at <i>Re</i> = 50,000 loses roughly <i>k</i><sub>Re</sub> = (50,000/150,000)<sup>0.25</sup> &asymp; 0.76, about 24% of its 2-D lift.

---

## 6. Rotor-Airframe Interference: the wash toggle

The drag calculation in Sub-Calc B treats the drone as a clean body in a wind tunnel. In actual forward flight the rotors blast a turbulent downwash that scrubs the frame, so the real cruise drag is higher than the clean-body prediction. The simulator's Module 2 "Rotor-wash drag" toggle makes this concrete rather than just describing it:

<p align="center"><b><i>F</i><sub>D,eff</sub> = <i>F</i><sub>D</sub> &middot; (1 + <i>k</i><sub>wash</sub>),&nbsp;&nbsp; <i>k</i><sub>wash</sub> &isin; [0.15, 0.30]</b></p>

<i>k</i><sub>wash</sub> is seeded per frame (deterministic, the same convention as every other manufacturing tolerance in this lab), so a given airframe always shows the same wash penalty. With the toggle off you see the textbook clean-tunnel <i>F</i><sub>D</sub>; switch it on and the 15&ndash;30% real-flight interference is multiplied in, with the drag-derivation panel showing both the clean and effective values side by side, so the gap between the two is visible rather than just asserted.

---

## 7. Cruise Power Budget

The total power for forward cruise combines the propulsive power and the aerodynamic drag power:

<p align="center"><b><i>P</i><sub>cruise</sub> = <sup>(<i>T</i> &middot; <i>V</i>)</sup> &frasl; <sub><i>&eta;</i><sub>prop</sub></sub> + <i>F</i><sub>D</sub> &middot; <i>V</i></b></p>

Where <i>F</i><sub>D</sub> is the drag force from Sub-Calc B. The minimum total power cruise speed is where d<i>P</i><sub>cruise</sub>/d<i>V</i> = 0, which sits at a lower airspeed than the minimum drag speed. This cruise power budget feeds straight into the mission-performance experiment, where range and endurance follow from it.

> **Worked example: cruise power budget of the reference quad.** At the <i>J</i> = 0.55 cruise point (<i>V</i> = 13.97 m/s, <i>&eta;</i><sub>prop</sub> = 0.78): each of the 4 props delivers <i>T</i> = 1.39 N (total thrust 4<i>T</i> = 5.56 N), and the cf_250 airframe drag at this speed is <i>F</i><sub>D</sub> = 0.5 &middot; 1.225 &middot; 13.97<sup>2</sup> &middot; 1.05 &middot; 0.0085 = 1.07 N:
> <p align="center"><i>P</i><sub>cruise</sub> = <sup>((4<i>T</i>) &middot; <i>V</i>)</sup> &frasl; <sub><i>&eta;</i><sub>prop</sub></sub> + <i>F</i><sub>D</sub> &middot; <i>V</i> = <sup>(5.56 &times; 13.97)</sup> &frasl; <sub>0.78</sub> + 1.07 &times; 13.97 = 99.5 + 14.9 = <b>114 W</b></p>
> About 114 W of shaft power sustains this cruise (99.5 W of propeller shaft power plus a 14.9 W parasitic-drag allowance), the value carried forward into the mission-performance experiment's range and endurance budget.

---

## 8. Cross-Experiment Relationships

This experiment completes the aerodynamic characterisation of the drone alongside the propulsion and frame experiments:

* **Thrust coefficients (Ct):** the Ct values used in Sub-Calc C (propulsive efficiency) are the same physical propeller aerodynamic coefficients used in the propulsion experiment's engine. The values stay consistent across all three experiments through the shared component database.
* **Frontal area (A_frontal):** the frontal area used for the drag calculation in Sub-Calc B is a structural property of the frame selected in the frame structural-integrity experiment. Pick a larger frame and the drag force calculated here goes up directly.
* **Drag output to the mission-performance experiment:** both the clean-body drag <i>F</i><sub>D</sub> (`frame_drag_N`) and the wash-corrected effective drag <i>F</i><sub>D,eff</sub> (`frame_drag_eff_N`) are written to the shared cross-experiment store on finalize, alongside the peak-efficiency cruise speed (`optimal_speed_ms`) and the characterised airfoil's identity (`airfoilId`, `cl_max_measured`, `stall_angle_deg`). The mission-performance experiment reads the effective (flight-realistic) figure, not the clean-tunnel one.
* **Staleness:** if the propulsion experiment is re-finalized with a different propeller after this experiment's results are locked in, the shared store flags this experiment stale (its cruise-efficiency numbers were characterised for the OLD propeller) and the on-page banner names the propulsion experiment as the section to revisit.

---

## Summary of Key Formulas

| Parameter | Formula | Units |
|-----------|---------|-------|
| Lift Coefficient | <i>C</i><sub>l</sub> = 2&pi;(<i>&alpha;</i> &minus; <i>&alpha;</i><sub>0</sub>) | Dimensionless |
| Drag Force | <i>F</i><sub>D</sub> = 0.5 &middot; <i>&rho;</i> &middot; <i>V</i><sup>2</sup> &middot; <i>C</i><sub>d</sub> &middot; <i>A</i> | N |
| Advance Ratio | <i>J</i> = <i>V</i> / (<i>n</i> &middot; <i>D</i>) | Dimensionless |
| Propulsive Efficiency | <i>&eta;</i><sub>prop</sub> = (<i>T</i> &middot; <i>V</i>) / (2&pi; &middot; <i>n</i> &middot; <i>Q</i>) | % |
| Propeller Torque | <i>Q</i> = <i>C</i><sub>q</sub> &middot; <i>&rho;</i> &middot; <i>n</i><sup>2</sup> &middot; <i>D</i><sup>5</sup> | N&middot;m |
