# Lab Procedure: Thrust-to-Weight, Hover Throttle, Payload & Efficiency

This document outlines the step-by-step workflow for **Experiment 6: Flight Performance**. The experiment lives on a single page with two views: **Experiment** (the build controls and the live 3-D hover bay) and **Analysis** (all four result charts together, so you can watch them move in lockstep as you change the build). Every value is computed live from the inherited build, and your session is saved automatically — reloading the page resumes exactly where you left off.

---

## **Stage 1: Configure the Build & Read TWR**

### **Objective**
Combine the Experiment-1 propulsion and the Experiment-2 mass into the thrust-to-weight ratio that defines the aircraft's class.

![Free-body lift diagram: four motor thrusts versus weight and payload](./images/twr_lift_diagram.png)

### **Step-by-Step Procedure**
1. **Launch the Simulator:** Open the virtual lab page. It loads the **Experiment** view by default, with the live 3-D hover bay in the centre.
2. **Note the inherited build.** The left panel shows the **empty mass** (inherited from Experiment 2 if available, otherwise the airframe typical mass) and the **propulsion** selector seeded with the motor chosen in Experiment 1.
3. **Select a propulsion package.** Use the **Propulsion** selector (1806, 2204, 2207, 2212, 2808, 3508 motor/prop combos). The per-motor maximum thrust and propeller diameter update immediately.
4. **Read the TWR.** The HUD and the Performance Summary cards show **TWR = N &times; T<sub>max</sub> / m<sub>total</sub>** and its class band. Confirm the reference build (2204, 620 g/motor, 500 g empty) gives **TWR = 4.96 (freestyle)**.
5. **Watch the lift visual.** The centre view shows the quad with four thrust arrows scaled by the available thrust against the weight vector, and a traffic-light halo under the airframe — green when the build is comfortably flight-ready.

---

## **Stage 2: Hover Throttle & Control Margin**

### **Objective**
Find the throttle the craft sits at to hover and the manoeuvre headroom that remains.

![Quadratic thrust curve with the hover operating point](./images/hover_throttle_curve.png)

### **Step-by-Step Procedure**
1. **Open the Analysis view.** The **Hover Throttle & Margin** chart plots the **quadratic thrust curve** (thrust &prop; throttle<sup>2</sup>) with the hover operating point marked, right alongside the other three result charts.
2. **Read the hover throttle.** The metric **hover throttle = &radic;(1/TWR)** shows where the craft balances. Confirm the reference build hovers at **44.9 %**.
3. **Read the control margin.** The **control margin = (1 &minus; hover throttle)** reports the reserve above hover — about **55 %** for the reference build. Note the ideal is a hover near 50 %.
4. **Explore the extremes.** Back on the Experiment view, select a high-thrust 6S combo (e.g. 2207) and watch the hover throttle drop toward 30 % (lots of margin, but twitchy); the relationship hover throttle = &radic;(1/TWR) updates live on the Analysis chart.

---

## **Stage 3: Maximum Payload**

### **Objective**
Determine how much cargo the craft can carry before its thrust-to-weight ratio falls to the safe minimum.

![Thrust-to-weight ratio falling as payload is added](./images/payload_twr_curve.png)

### **Step-by-Step Procedure**
1. **Set the safety target.** In the left panel's Loadout group, use the **Minimum safe TWR** selector (1.5 / 2.0 / 2.5). The standard controllable-flight floor is **2.0**.
2. **Read the maximum payload.** The Performance Summary and the derivation **payload = N&middot;T<sub>max</sub>/TWR<sub>min</sub> &minus; m<sub>empty</sub>** update together. Confirm the reference build can carry **740 g** at TWR<sub>min</sub> = 2.0.
3. **Sweep the payload slider.** Drag **Payload** up from 0 g and watch the **TWR fall** on the Analysis view's Payload Envelope chart, the hover throttle climb, and the control margin shrink. The curve crosses the TWR<sub>min</sub> line exactly at the maximum payload — load beyond it and the verdict turns red. The **Load max payload at this TWR** button jumps straight to that limit.

---

## **Stage 4: Hover Efficiency**

### **Objective**
Estimate the lift produced per watt at hover, and see what improves it.

![Hover efficiency versus all-up mass and disk area](./images/hover_efficiency_curve.png)

### **Step-by-Step Procedure**
1. **Read the Hover Efficiency chart** on the Analysis view — efficiency (g/W) against all-up mass for the selected propeller disk.
2. **Read the momentum-theory result.** The fourth derivation panel and the Performance Analysis list show the **disk area** A = N&middot;&pi;(D/2)<sup>2</sup>, the **hover power** P = (m g)<sup>1.5</sup> / (FoM &middot; &radic;(2&rho;A)), and the **efficiency** = m / P. The reference build gives A = 0.0507 m<sup>2</sup> and, at the catalogue's nominal FoM = 0.70, P = 44.0 W / efficiency = **11.36 g/W** (theory.md §6) — but the simulator seeds a build-specific FoM within 0.55–0.75 to model real assembly variance, so your on-screen P and efficiency may land a bit below or above that, and that's expected, not an error.
3. **Improve it two ways.** (a) Select a large-prop combo (10&Prime; or 13&Prime;) and watch efficiency climb toward ~17 g/W — a bigger disk moves more air for less power. (b) Reduce the payload and watch efficiency rise, because power grows as thrust<sup>1.5</sup>.
4. **Compare ideal vs measured.** When Experiment 1's current draw is available, the Performance Analysis list adds a second **"Hover efficiency — measured"** row computed from the real V&middot;I at hover. It sits at or below the momentum-theory "ideal" row — the gap is exactly the electrical and mechanical losses the idealised formula doesn't model. This comparison is the sixth objective; open the Analysis view at least once to clear it.
5. **Verify completion.** The right panel confirms the final TWR, hover throttle, control margin, maximum payload and hover efficiency are saved as all six objectives clear. The full flight-performance envelope of the aircraft assembled across the lab series is now characterised, completing **Experiment 6**.
