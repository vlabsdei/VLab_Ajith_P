# Lab Procedure: Drone Propulsion System Design & Characterization

This document outlines the step-by-step workflow required to complete **Experiment 1: Propulsion System Design & Characterization**. The experiment consists of two integrated modules spanning three stages: structural assembly, bench testing, and dynamic flight verification.

---

## **Stage 1: Drone Component Selection & Assembly (Module 1)**

### **Objective**
Configure a quadcopter's propulsion and power train, ensuring physical compatibility (propeller clearance) and weight budgets are met.

### **Step-by-Step Procedure**
1. **Launch the Simulator:** Open the virtual lab page in your browser. By default, the interface loads into **Module 1: Propulsion System Design (Tab 1: Assemble)**.
2. **Select Components:** In the left-hand configuration panel, select components from the drop-down menus:
   * **Frame:** Pick a size (e.g., *210mm*, *250mm*, or *450mm* wheelbase).
   * **Motor:** Pick a motor (e.g., *2207 2400KV* or *2212 920KV*).
   * **Propeller:** Choose a diameter and pitch (e.g., *5x4.5"* or *10x4.5"*).
   * **Battery:** Choose a cells/capacity combination (e.g., *3S 2200mAh* or *4S 1500mAh*).
   * **ESC (Electronic Speed Controller):** Choose a current rating (e.g., *20A* or *30A*).
   * **Flight Controller & Receiver:** Choose standard units.
3. **Verify 3D Assembly:** Watch the central 3D viewport update in real-time as components are added. Use your mouse to click and drag to orbit, scroll to zoom, and right-click to pan around the drone.
4. **Audit the Assembly Checklist:** Observe the **Assembly Progress** card in the right-hand column:
   * Ensure all mandatory items (Frame, Motor, Propeller, Battery, ESC) show a green checkmark.
   * **Propeller Clearance Check:** If you choose a small frame (e.g., 210mm) and couple it with large propellers (e.g., 10"), the interface will trigger a red warning: **"Propellers Overlap! Collision detected."** You cannot proceed until this is resolved.
5. **Finalize Configuration:** Once a compatible configuration is assembled with all checkmarks green, click **Finalize Assembly & Go to Test**. This locks the selections and saves the configuration in the application cache.

---

## **Stage 2: Aerodynamic Bench Testing (Module 1)**

### **Objective**
Evaluate the static performance of a single motor-propeller assembly on a load-cell thrust stand under variable throttle loads.

![Thrust Stand Schematic](./images/thrust_stand_schematic.png)

### **Step-by-Step Procedure**
1. **Navigate to Tab 2 (Aero Test):** The 3D viewport will transition to show a single motor and propeller mounted to a vertical aluminum test stand equipped with an electronic load-cell force sensor.
2. **Adjust Throttle Slider:** Locate the **Thrust Stand Throttle** slider in the middle-bottom panel. Slowly drag the slider from 40% to 100%:
   * Dragging the slider increases the effective voltage applied to the motor windings:
     <p align="center"><i>V</i><sub>eff</sub> = Throttle &times; <i>V</i><sub>battery</sub></p>
   * Observe the propeller spin-up in the 3D viewport.
3. **Read Virtual LCD Screen:** Look at the digital LCD screen mounted on the 3D test stand in the viewport. It displays:
   * **Thrust (N)**: Measured vertical force.
   * **RPM**: Loaded rotation speed.
   * **Temp (°C)**: Motor temperature.
4. **Identify Failure Modes:**
   * **Motor Stall:** If you pair a small motor (low torque) with a large propeller at low voltage, the motor will stall. The LCD will read `STALL` and the propeller will not rotate.
   * **Thermal Runaway (Overheating):** Drag the throttle to 100% and observe the motor temperature card. If the propeller is too heavy for the motor winding resistance, the temperature will climb rapidly. If it exceeds 150&deg;C (insulation breakdown), the system triggers a thermal warning (`OVERHEAT!`).
5. **Examine Curve Plots:** In the right column, verify that the **Thrust Profile** graph displays a quartic (<i>D</i><sup>4</sup>) relation between propeller diameter and thrust.

---

## **Stage 3: Hovering Flight Simulation (Module 1)**

### **Objective**
Test the fully assembled drone in a closed-loop flight environment to verify if the thrust-to-weight ratio is sufficient for stable hover.

### **Step-by-Step Procedure**
1. **Navigate to Tab 3 (Hover Test):** The viewport loads the quadcopter resting on a landing pad. The left column displays the **Mass Distribution** table detailing the mass contribution of each selected component and the payload.
2. **Initiate Flight:** Click the **Start Hover** button. The autopilot will automatically ramp up throttle to achieve a target altitude of 1.5 m.
3. **Monitor Telemetry HUD:** Follow the live HUD overlay at the top of the 3D viewport:
   * **Flight Time (s)**: Dynamic timer.
   * **Altitude (m)**: Real-time altitude above ground.
   * **Battery (V)**: Tracks cell voltage, displaying sag under load.
   * **Current (A)**: Real-time current draw from the ESC.
4. **Observe Flight Failure States:**
   * **Thrust Deficit:** If the drone's total weight exceeds its maximum thrust capacity (<i>T</i><sub>max</sub> &lt; <i>M</i><sub>total</sub> &middot; <i>g</i>), the propellers spin to 100% throttle but the drone remains on the ground. The HUD phase shows `THRUST DEFICIT`.
   * **ESC/Motor Thermal Burn:** If the current draw is too high, the motor temperature rises. Once it hits 150&deg;C, thick grey smoke will billow from the motor pods. After 3 seconds of sustained overheat, the motor insulation burns out, the drone loses lift, and crashes to the ground showing `CRASHED!`.
5. **Reset and Redesign:** Click **Reset** to return the drone to the pad, adjust selections, and repeat the simulation.

---

## **Stage 4: Motor Efficiency Profiling (Module 2)**

### **Objective**
Map the complete operating envelope of the BLDC motor to analyze electrical loss profiles, copper losses (<i>I</i><sup>2</sup><i>R</i>), and find the peak efficiency operating throttle.

### **Step-by-Step Procedure**
1. **Proceed to Module 2:** Once Module 1 is successfully completed, click the **Next Module 2** button at the bottom of the page. The app loads `index1.html` and retrieves your finalized configuration from the cache.
2. **Review Initial Parameters:** Verify your selected motor, battery, and propeller details are loaded.
3. **Run Profile Sweep:** Under the **Efficiency Sweep** tab, click **Run Profile Sweep**:
   * The simulator will automatically execute a granular 8-point throttle sweep (30% to 100%).
   * Watch the 3D motor and propeller assembly spin up and accelerate at each step.
4. **Analyze Data Outputs:**
   * **Charts:** Study the **Motor Efficiency (%)** and **Thrust Profile (N)** curves. Locate the dashed vertical line representing the **Hover Point** to see if your drone operates near peak efficiency during hover.
   * **Power Flow (Sankey):** Review the Sankey diagram showing how electrical power input (<i>P</i><sub>in</sub>) is divided into mechanical shaft power (<i>P</i><sub>mech</sub>) and copper heat loss (<i>P</i><sub>loss</sub>).
   * **Circuit Diagram:** Check the voltage distribution showing the battery terminal voltage drops and the Back-EMF (<i>V</i><sub>bemf</sub>).
   * **Data Sheet Table:** Review the populated multi-column table displaying exact numbers for Throttle, RPM, Thrust, Current, <i>P</i><sub>in</sub>, <i>P</i><sub>loss</sub>, and Efficiency.
5. **Verify Completion:** Upon sweep completion, review the 3D viewport showing the fully assembled motor stator, rotor bell, and propeller rotating together, confirming the completion of **Experiment 1**.
