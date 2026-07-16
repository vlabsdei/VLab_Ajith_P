<h1>Experiment Procedure — Frame Structural Integrity</h1>

<p>This guide outlines the step-by-step procedure for balancing the drone's center of gravity and conducting cantilever beam stress tests to evaluate the structural integrity of the airframe.</p>

<hr>

<h2>1. Custom Technical Diagram: Arm Loading</h2>
<p>The mechanical setup of the structural test bench is represented below:</p>

<p><img src="./images/forces_bending_moment.png" alt="Cantilever Arm Bending Setup"></p>

<hr>

<h2>2. Step-by-Step Procedure</h2>

<h3>Stage 1: Airframe Mass Balancing (Module 1)</h3>
<ol>
<li><strong>Load the Simulation</strong>: Open <code>index.html</code> in your web browser. You will see the 3D balancing deck displaying the drone sitting on a central pivot ball joint.</li>
<li><strong>Select Hardware Size</strong>:
  <ul>
  <li>Under the <strong>1. Select Frame</strong> section in the left panel, choose a wheelbase (e.g., 450 mm). This defines the deck dimensions and the length of the diagonal arms.</li>
  <li>Select a <strong>Battery Pack</strong> (e.g., LiPo 4S 3300 mAh) and a <strong>Payload</strong> (e.g., Action Camera with Gimbal) from the option tiles.</li>
  </ul>
</li>
<li><strong>Locate Initial CG</strong>:
  <ul>
  <li>Observe the <strong>Precision Calculations</strong> panel in the right column (Total Mass, X/Y Moment, CoG X/Y Coordinate, Net CoG Offset) to see the contribution of each component to the total mass.</li>
  <li>Observe the <strong>CoG Envelope Scatter</strong> plot in the right panel. The dashed circle represents the 10 mm safe balancing boundary. Note that the target CG dot is outside this circle, causing the 3D model of the drone in the viewport to tilt.</li>
  </ul>
</li>
<li><strong>Coordinate Placement</strong>:
  <ul>
  <li>Use your mouse to click and drag the battery mesh (top deck) and the selected payload mesh (bottom deck) along the airframe in the 3D viewport.</li>
  <li>Alternatively, adjust the <strong>Battery X</strong>, <strong>Battery Y</strong>, <strong>Payload X</strong>, and <strong>Payload Y</strong> sliders in the left panel to move the components along the axes independently.</li>
  </ul>
</li>
<li><strong>Test a rigging fault (optional)</strong>: Under <strong>Fault Injection</strong>, select "Battery slammed to one corner" to see the CG envelope blow out on purpose, then switch back to "None" to return to your own placement.</li>
<li><strong>Lock the Balance Point</strong>:
  <ul>
  <li>Adjust the coordinates until the <strong>Aero Balance (r_CG &lt; 10 mm)</strong> checklist item turns green (meaning the offset magnitude is less than 10 mm) and the <strong>Structural verdict</strong> chip below the checklist reads "CG BALANCED".</li>
  <li>Once balanced, the drone model will sit perfectly horizontal on the pivot ball joint, and the <strong>Lock Design &amp; Proceed</strong> button will unlock. Click it to navigate to <code>index1.html</code>.</li>
  </ul>
</li>
</ol>

<hr>

<h3>Stage 2: Cantilever Arm Stress Sweeps (Module 2)</h3>
<ol>
<li><strong>Load Module 2</strong>: Verify the active hardware selections (Motor, Propeller, Battery) are loaded from your Experiment 1 completion state in the left panel status badge.</li>
<li><strong>Setup Test Profile</strong>:
  <ul>
  <li>In the left panel, select <strong>Carbon Fibre T700</strong> under the materials section, and select the <strong>150 mm</strong> arm length.</li>
  </ul>
</li>
<li><strong>Conduct the Stress Sweep</strong>:
  <ul>
  <li>Click the <strong>Run Stress Test</strong> button under the 3D viewport.</li>
  <li>Watch the simulation load force increase from 0 to 100%. Note that the 3D arm deforms (flexes) downwards and changes color (from green to yellow/red) representing the concentration of flexural stress near the root clamp.</li>
  <li>Once the sweep completes, record the <strong>Safety Factor (SF)</strong> and the maximum bending stress.</li>
  </ul>
</li>
<li><strong>Populate the 3x3 Safety Matrix</strong>:
  <ul>
  <li>Click another cell in the <strong>Safety Factor Matrix</strong> (in the right panel) to switch parameters, or select them from the left panel.</li>
  <li>Repeat the stress sweep for all <strong>9 combinations</strong> (3 materials: Carbon Fibre, Aluminium, Nylon &times; 3 lengths: 150 mm, 250 mm, 350 mm).</li>
  <li>Note the structural behavior: Nylon arms will yield and <strong>snap</strong> (<i>SF</i> &lt; 1.0) when tested at longer lengths.</li>
  </ul>
</li>
<li><strong>Try the structural fault scenarios</strong>: Under <strong>Structural Fault Scenario</strong>, select "Nylon @ 350 mm, full thrust" to auto-select the worst-case material/length combo, or "Dynamic load &times;2.0 (maneuvering)" to see the <strong>Structural verdict</strong> chip report a static AND a dynamic safety factor side-by-side (SF_static vs. SF_dynamic) — the dynamic figure is always the more conservative one and is what actually governs go/no-go for real flight.</li>
<li><strong>Verify Design and Lock</strong>:
  <ul>
  <li>Observe the <strong>Bending Stress vs. Yield strength</strong> bar chart to compare the applied stress against the limits of the materials side-by-side.</li>
  <li>Once all 9 matrix cells are populated, a <strong>Chassis Unlocked</strong> card appears automatically at the bottom of the page — no button click needed — confirming your optimal frame construction parameters were saved.</li>
  </ul>
</li>
</ol>
