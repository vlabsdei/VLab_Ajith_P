<h1>Lab Procedure: Drone Propulsion System Design &amp; Characterization</h1>

<p>This document outlines the step-by-step workflow required to complete <strong>Experiment 1: Propulsion System Design &amp; Characterization</strong>. The experiment consists of two integrated modules spanning three stages: structural assembly, bench testing, and dynamic flight verification.</p>

<hr>

<h2>Stage 1: Drone Component Selection &amp; Assembly (Module 1)</h2>

<h3>Objective</h3>
<p>Configure a quadcopter's propulsion and power train, ensuring physical compatibility (propeller clearance) and weight budgets are met.</p>

<h3>Step-by-Step Procedure</h3>
<ol>
<li><strong>Launch the Simulator:</strong> Open the virtual lab page in your browser. By default, the interface loads into <strong>Module 1: Propulsion System Design (Tab 1: Assemble)</strong>.</li>
<li><strong>Select Components:</strong> In the left-hand configuration panel, select components from the drop-down menus:
  <ul>
  <li><strong>Frame:</strong> Pick a size (e.g., <em>210mm</em>, <em>250mm</em>, or <em>450mm</em> wheelbase).</li>
  <li><strong>Motor:</strong> Pick a motor (e.g., <em>2207 2400KV</em> or <em>2212 920KV</em>).</li>
  <li><strong>Propeller:</strong> Choose a diameter and pitch (e.g., <em>5x4.5"</em> or <em>10x4.5"</em>).</li>
  <li><strong>Battery:</strong> Choose a cells/capacity combination (e.g., <em>3S 2200mAh</em> or <em>4S 1500mAh</em>).</li>
  <li><strong>ESC (Electronic Speed Controller):</strong> Choose a current rating (e.g., <em>20A</em> or <em>30A</em>).</li>
  <li><strong>Flight Controller &amp; Receiver:</strong> Choose standard units.</li>
  </ul>
</li>
<li><strong>Verify 3D Assembly:</strong> Watch the central 3D viewport update in real-time as components are added. Use your mouse to click and drag to orbit, scroll to zoom, and right-click to pan around the drone.</li>
<li><strong>Audit the Assembly Checklist:</strong> Observe the <strong>Assembly Progress</strong> card in the right-hand column:
  <ul>
  <li>Ensure all mandatory items (Frame, Motor, Propeller, Battery, ESC) show a green checkmark.</li>
  <li><strong>Propeller Clearance Check:</strong> If you choose a small frame (e.g., 210mm) and couple it with large propellers (e.g., 10"), the interface will trigger a red warning: <strong>"Propellers Overlap! Collision detected."</strong> You cannot proceed until this is resolved.</li>
  </ul>
</li>
<li><strong>Finalize Configuration:</strong> Once a compatible configuration is assembled with all checkmarks green, click <strong>Finalize Assembly &amp; Go to Test</strong>. This locks the selections and saves the configuration in the application cache.</li>
</ol>

<hr>

<h2>Stage 2: Aerodynamic Bench Testing (Module 1)</h2>

<h3>Objective</h3>
<p>Evaluate the static performance of a single motor-propeller assembly on a load-cell thrust stand under variable throttle loads.</p>

<p><img src="./images/thrust_stand_schematic.png" alt="Thrust Stand Schematic"></p>

<h3>Step-by-Step Procedure</h3>
<ol>
<li><strong>Navigate to Tab 2 (Aero Test):</strong> The 3D viewport will transition to show a single motor and propeller mounted to a vertical aluminum test stand equipped with an electronic load-cell force sensor.</li>
<li><strong>Adjust Throttle Slider:</strong> Locate the <strong>Thrust Stand Throttle</strong> slider in the middle-bottom panel. Slowly drag the slider from 40% to 100%:
  <ul>
  <li>Dragging the slider increases the effective voltage applied to the motor windings:
    <p align="center"><i>V</i><sub>eff</sub> = Throttle &times; <i>V</i><sub>battery</sub></p>
  </li>
  <li>Observe the propeller spin-up in the 3D viewport.</li>
  </ul>
</li>
<li><strong>Read Virtual LCD Screen:</strong> Look at the digital LCD screen mounted on the 3D test stand in the viewport. It displays:
  <ul>
  <li><strong>Thrust (N)</strong>: Measured vertical force.</li>
  <li><strong>RPM</strong>: Loaded rotation speed.</li>
  <li><strong>Temp (°C)</strong>: Motor temperature.</li>
  </ul>
</li>
<li><strong>Identify Failure Modes:</strong>
  <ul>
  <li><strong>Motor Stall:</strong> If you pair a small motor (low torque) with a large propeller at low voltage, the motor will stall. The LCD will read <code>STALL</code> and the propeller will not rotate.</li>
  <li><strong>Thermal Runaway (Overheating):</strong> Drag the throttle to 100% and observe the motor temperature card. If the propeller is too heavy for the motor winding resistance, the temperature will climb rapidly. If it exceeds 150&deg;C (insulation breakdown), the system triggers a thermal warning (<code>OVERHEAT!</code>).</li>
  </ul>
</li>
<li><strong>Examine Curve Plots:</strong> In the right column, verify that the <strong>Thrust Profile</strong> graph displays a quartic (<i>D</i><sup>4</sup>) relation between propeller diameter and thrust.</li>
</ol>

<hr>

<h2>Stage 3: Hovering Flight Simulation (Module 1)</h2>

<h3>Objective</h3>
<p>Test the fully assembled drone in a closed-loop flight environment to verify if the thrust-to-weight ratio is sufficient for stable hover.</p>

<h3>Step-by-Step Procedure</h3>
<ol>
<li><strong>Navigate to Tab 3 (Hover Test):</strong> The viewport loads the quadcopter resting on a landing pad. The left column displays the <strong>Mass Distribution</strong> table detailing the mass contribution of each selected component and the payload.</li>
<li><strong>Initiate Flight:</strong> Click the <strong>Start Hover</strong> button. The autopilot will automatically ramp up throttle to achieve a target altitude of 2.0 m.</li>
<li><strong>Monitor Telemetry HUD:</strong> Follow the live HUD overlay at the top of the 3D viewport:
  <ul>
  <li><strong>Time Elapsed (s)</strong>: Dynamic timer.</li>
  <li><strong>Z-Position (m)</strong>: Real-time altitude above ground.</li>
  <li><strong>Energy Level (%)</strong>: Tracks remaining pack capacity as it's consumed under load.</li>
  <li><strong>Active Power (W) / Phase Current (A)</strong>: Real-time electrical draw from the ESC.</li>
  </ul>
</li>
<li><strong>Observe Flight Failure States:</strong>
  <ul>
  <li><strong>Thrust Deficit:</strong> If the drone's total weight exceeds its maximum thrust capacity (<i>T</i><sub>max</sub> &lt; <i>M</i><sub>total</sub> &middot; <i>g</i>), the propellers spin to 100% throttle but the drone remains on the ground. The HUD phase shows <code>THRUST DEFICIT</code>.</li>
  <li><strong>ESC/Motor Thermal Burn:</strong> If the current draw is too high, the motor temperature rises. Once it hits 150&deg;C, thick grey smoke will billow from the motor pods. After 3 seconds of sustained overheat, the motor insulation burns out, power is cut, and the drone falls, showing <code>BURNED!</code>.</li>
  </ul>
</li>
<li><strong>Reset and Redesign:</strong> Click <strong>Reset</strong> to return the drone to the pad, adjust selections, and repeat the simulation.</li>
</ol>

<hr>

<h2>Stage 4: Motor Efficiency Profiling (Module 2)</h2>

<h3>Objective</h3>
<p>Map the complete operating envelope of the BLDC motor to analyze electrical loss profiles, copper losses (<i>I</i><sup>2</sup><i>R</i>), and find the peak efficiency operating throttle.</p>

<h3>Step-by-Step Procedure</h3>
<ol>
<li><strong>Proceed to Module 2:</strong> Once Module 1 is successfully completed, click the <strong>Next Module 2</strong> button at the bottom of the page. The app loads <code>index1.html</code> and retrieves your finalized configuration from the cache.</li>
<li><strong>Review Initial Parameters:</strong> Verify your selected motor, battery, and propeller details are loaded.</li>
<li><strong>Run Profile Sweep:</strong> Under the <strong>Efficiency Sweep</strong> tab, click <strong>Run Profile Sweep</strong>:
  <ul>
  <li>The simulator will automatically execute a granular 8-point throttle sweep (30% to 100%).</li>
  <li>Watch the 3D motor and propeller assembly spin up and accelerate at each step.</li>
  </ul>
</li>
<li><strong>Analyze Data Outputs:</strong>
  <ul>
  <li><strong>Charts:</strong> Study the <strong>Motor Efficiency (%)</strong> and <strong>Thrust Profile (N)</strong> curves. Locate the dashed vertical line representing the <strong>Hover Point</strong> to see if your drone operates near peak efficiency during hover.</li>
  <li><strong>Power Flow (Sankey):</strong> Review the Sankey diagram showing how electrical power input (<i>P</i><sub>in</sub>) is divided into mechanical shaft power (<i>P</i><sub>mech</sub>) and copper heat loss (<i>P</i><sub>loss</sub>).</li>
  <li><strong>Circuit Diagram:</strong> Check the voltage distribution showing the battery terminal voltage drops and the Back-EMF (<i>V</i><sub>bemf</sub>).</li>
  <li><strong>Data Sheet Table:</strong> Review the populated multi-column table displaying exact numbers for Throttle, RPM, Thrust, Current, <i>P</i><sub>in</sub>, <i>P</i><sub>loss</sub>, and Efficiency.</li>
  </ul>
</li>
<li><strong>Verify Completion:</strong> Upon sweep completion, review the 3D viewport showing the fully assembled motor stator, rotor bell, and propeller rotating together, confirming the completion of <strong>Experiment 1</strong>.</li>
</ol>
