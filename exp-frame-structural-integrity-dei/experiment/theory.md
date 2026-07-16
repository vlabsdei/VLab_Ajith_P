<h1>Theoretical Derivations — Frame Structural Integrity</h1>

<p>This document details the governing physical principles, centroid math, and beam mechanics equations used to evaluate drone balancing and structural load limits.</p>

<p>Before working through the derivations, the animation below walks through the structural story — locating the center of gravity, treating each arm as a loaded cantilever, and tracing how bending moment, stress, safety factor, and stiffness keep the frame intact.</p>

<p align="center">
  <video controls playsinline preload="metadata" width="100%" style="max-width: 860px; border-radius: 8px;">
    <source src="./videos/frame_structural_integrity.mp4" type="video/mp4">
    Your browser does not support the HTML5 video tag. You can
    <a href="./videos/frame_structural_integrity.mp4">download the video</a> instead.
  </video>
</p>

<hr>

<blockquote>
<p><strong>Note on real-world part variance.</strong> The catalog's material yield strengths are clean
nominal spec-sheet values, but real composite layups and extrusions vary batch-to-batch.
The simulator draws each material's <em>as-manufactured</em> yield strength from a seeded
&plusmn;10% tolerance (deterministic per material, so the same build always gets the same
value, but different sessions see genuine part-to-part variance) — the Safety Factor
Matrix and live stress readouts use this seeded value, not the flat catalog number, so
two students selecting "Carbon Fibre T700" will not see bit-identical safety factors.</p>
</blockquote>

<h2>1. Centroid &amp; Center of Gravity (Sub-Calc A)</h2>
<p>To ensure hover stability, the drone's center of mass must align with its geometric center (origin). In a Cartesian coordinate system, the Center of Gravity (CG) coordinates along the lateral (<i>x</i>) and longitudinal (<i>y</i>) axes are calculated using the centroid equations:</p>

<p align="center"><i>x</i><sub>CG</sub> = <sup>&Sigma;<sub><i>i</i>=1</sub><sup><i>n</i></sup> (<i>m</i><sub><i>i</i></sub> &middot; <i>x</i><sub><i>i</i></sub>)</sup> &frasl; <sub>&Sigma;<sub><i>i</i>=1</sub><sup><i>n</i></sup> <i>m</i><sub><i>i</i></sub></sub></p>

<p align="center"><i>y</i><sub>CG</sub> = <sup>&Sigma;<sub><i>i</i>=1</sub><sup><i>n</i></sup> (<i>m</i><sub><i>i</i></sub> &middot; <i>y</i><sub><i>i</i></sub>)</sup> &frasl; <sub>&Sigma;<sub><i>i</i>=1</sub><sup><i>n</i></sup> <i>m</i><sub><i>i</i></sub></sub></p>

<p>Where:</p>
<ul>
<li><i>m<sub>i</sub></i> is the mass of the individual component (g or kg).</li>
<li><i>x<sub>i</sub></i>, <i>y<sub>i</sub></i> are the coordinates of the component's center of mass relative to the geometric center (mm or m).</li>
</ul>

<p>The total radial offset of the center of gravity (<i>r</i><sub>CG</sub>) from the datum origin is solved using the Euclidean distance:</p>

<p align="center"><i>r</i><sub>CG</sub> = &radic;(<i>x</i><sub>CG</sub><sup>2</sup> + <i>y</i><sub>CG</sub><sup>2</sup>)</p>

<p>To prevent asymmetric motor heating and hover drift, we enforce the safety envelope:</p>
<p align="center"><i>r</i><sub>CG</sub> &le; 10 mm</p>

<blockquote>
<p><strong>Worked example — CG offset of the reference 5&Prime; build (cf_250 frame, 2204 motor, 5045 prop, 4S 3300 mAh battery).</strong>
The four 2204 motors (25.0 g each), four 5045 props (3.1 g each), four 30 A ESCs (9.5 g each), the cf_250 frame (68.2 g), the F7 stack (7.5 g) and the ELRS receiver (3.5 g) all sit on the geometric centre, contributing 229.6 g with zero net moment. Three off-centre items break the symmetry: the 4S 3300 mAh battery (320.0 g) mounted 12 mm rear (<i>y</i> = &minus;12 mm), the M9N GPS (24.5 g) 45 mm forward (<i>y</i> = +45 mm), and the 915 MHz telemetry radio (18.3 g) 35 mm to the right (<i>x</i> = +35 mm). The total mass is &Sigma;<i>m<sub>i</sub></i> = 592.4 g.</p>
<p align="center"><i>x</i><sub>CG</sub> = <sup>(18.3 &middot; 35)</sup> &frasl; <sub>592.4</sub> = <sup>640.5</sup> &frasl; <sub>592.4</sub> = <b>1.081 mm</b></p>
<p align="center"><i>y</i><sub>CG</sub> = <sup>(320.0 &middot; (&minus;12) + 24.5 &middot; 45)</sup> &frasl; <sub>592.4</sub> = <sup>&minus;2737.5</sup> &frasl; <sub>592.4</sub> = <b>&minus;4.621 mm</b></p>
<p align="center"><i>r</i><sub>CG</sub> = &radic;(1.081<sup>2</sup> + 4.621<sup>2</sup>) = &radic;22.53 = <b>4.75 mm</b></p>
<p>The center of gravity lies 4.75 mm from the geometric centre — comfortably inside the <i>r</i><sub>CG</sub> &le; 10 mm envelope — so the build is balanced and the flight controller will not need to bias motor thrust to stay level.</p>
</blockquote>

<p>The top-down coordinate offset and balancing layout is represented in the diagram below:</p>

<p><img src="./images/cg_coordinate_offset.png" alt="Quadcopter Coordinate System"></p>

<hr>

<h2>2. Cantilever Beam Bending Moment (Sub-Calc B)</h2>
<p>Each of the four arms of the quadcopter acts as a cantilever beam—fixed at the central hub plate (root clamp) and free at the outer motor end (tip load). Under hover or full-throttle conditions, the forces acting on the arm tip (<i>F</i><sub>tip</sub>) are composed of:</p>
<ol>
<li><strong>Gravitational Weight:</strong> The combined mass of the motor (<i>M</i><sub>motor</sub>) and propeller (<i>M</i><sub>prop</sub>).</li>
<li><strong>Aerodynamic Thrust:</strong> The upward reaction force (<i>T</i><sub>max</sub>) generated by the propeller.</li>
</ol>

<p align="center"><i>F</i><sub>tip</sub> = (<i>M</i><sub>motor</sub> + <i>M</i><sub>prop</sub>) &middot; <i>g</i> + <i>T</i><sub>max</sub></p>

<p>Where <i>g</i> = 9.80665 m/s<sup>2</sup> is the acceleration due to gravity.</p>

<p>The bending moment <i>M</i>(<i>x</i>) at any distance <i>x</i> from the root clamp is the product of the force and the remaining span length:</p>

<p align="center"><i>M</i>(<i>x</i>) = -<i>F</i><sub>tip</sub> &middot; (<i>L</i> - <i>x</i>)</p>

<p>The maximum bending moment occurs at the clamped root (<i>x</i> = 0):</p>

<p align="center"><i>M</i><sub>max</sub> = -<i>F</i><sub>tip</sub> &middot; <i>L</i></p>

<blockquote>
<p><strong>Worked example — tip force and root moment of one cf_250 arm.</strong>
Each arm carries a 2204 motor (<i>M</i><sub>motor</sub> = 25.0 g) and a 5045 prop (<i>M</i><sub>prop</sub> = 3.1 g) and develops the simulator's full-throttle thrust <i>T</i><sub>max</sub> = 8.5 N over a span <i>L</i> = 105 mm = 0.105 m:</p>
<p align="center"><i>F</i><sub>tip</sub> = (0.0250 + 0.0031) &middot; 9.80665 + 8.5 = 0.276 + 8.5 = <b>8.78 N</b></p>
<p align="center"><i>M</i><sub>max</sub> = &minus;8.78 &middot; 0.105 = <b>&minus;0.921 N&middot;m</b></p>
<p>Aerodynamic thrust dominates the load: gravity contributes only 0.276 N (about 3%) of the 8.78 N tip force. The clamped root therefore experiences a hogging moment of magnitude 0.921 N&middot;m, which Section 3 converts into fibre stress.</p>
</blockquote>

<p>Where <i>L</i> is the total arm span length (meters). The shear force <i>V</i>(<i>x</i>) remains constant along the entire span:</p>
<p align="center"><i>V</i>(<i>x</i>) = -<i>F</i><sub>tip</sub></p>

<hr>

<h2>3. Flexural Bending Stress (Sub-Calc C)</h2>
<p>The applied bending moment creates tensile stress on the upper fibers of the arm and compression stress on the lower fibers. The normal bending stress (&sigma;) at any vertical distance <i>y</i> from the horizontal Neutral Axis is solved using the flexure formula:</p>

<p align="center">&sigma;(<i>y</i>) = <sup>(<i>M</i> &middot; <i>y</i>)</sup> &frasl; <sub><i>I</i></sub></p>

<p>The maximum bending stress (&sigma;<sub>max</sub>) occurs at the outermost boundary fibers (<i>y</i> = &plusmn;<i>c</i>, where <i>c</i> = <i>h</i>/2):</p>

<p align="center">&sigma;<sub>max</sub> = <sup>(<i>M</i><sub>max</sub> &middot; <i>c</i>)</sup> &frasl; <sub><i>I</i></sub> = <sup>(<i>M</i><sub>max</sub> &middot; <i>h</i>)</sup> &frasl; <sub>2 <i>I</i></sub></p>

<p>The cross-section and flexural stress distribution profiles are illustrated below:</p>

<p><img src="./images/arm_stress_distribution.png" alt="Arm Profile Stress Distribution"></p>

<h3>Hollow Rectangular Area Moment of Inertia (<i>I</i>)</h3>
<p>Quadcopter arms are typically manufactured as hollow tubes to save weight while maintaining stiffness. For a hollow rectangular cross-section of width <i>b</i>, height <i>h</i>, and wall thickness <i>t</i>, the area moment of inertia is derived by subtracting the void area from the outer rectangular envelope:</p>

<p align="center"><i>I</i> = <i>I</i><sub>outer</sub> - <i>I</i><sub>inner</sub> = <sup>(<i>b</i> &middot; <i>h</i><sup>3</sup>)</sup> &frasl; <sub>12</sub> - <sup>((<i>b</i> - 2<i>t</i>) &middot; (<i>h</i> - 2<i>t</i>)<sup>3</sup>)</sup> &frasl; <sub>12</sub></p>

<blockquote>
<p><strong>Worked example — second moment of area and root stress of the cf_250 arm.</strong>
The cf_250 arm tube has outer width <i>b</i> = 10 mm, height <i>h</i> = 6 mm and wall thickness <i>t</i> = 1 mm, so the inner void measures (<i>b</i> &minus; 2<i>t</i>) = 8 mm by (<i>h</i> &minus; 2<i>t</i>) = 4 mm (all converted to metres):</p>
<p align="center"><i>I</i> = <sup>(0.010 &middot; 0.006<sup>3</sup>)</sup> &frasl; <sub>12</sub> &minus; <sup>(0.008 &middot; 0.004<sup>3</sup>)</sup> &frasl; <sub>12</sub> = <sup>(2.16 &times; 10<sup>&minus;9</sup> &minus; 5.12 &times; 10<sup>&minus;10</sup>)</sup> &frasl; <sub>12</sub> = <b>1.373 &times; 10<sup>&minus;10</sup> m<sup>4</sup></b></p>
<p>Carrying the root moment |<i>M</i><sub>max</sub>| = 0.921 N&middot;m from Section 2 to the outermost fibre (<i>c</i> = <i>h</i>/2 = 0.003 m):</p>
<p align="center">&sigma;<sub>max</sub> = <sup>(0.921 &middot; 0.003)</sup> &frasl; <sub>1.373 &times; 10<sup>&minus;10</sup></sub> = 2.01 &times; 10<sup>7</sup> Pa = <b>20.1 MPa</b></p>
<p>The outer fibres carry 20.1 MPa — tension on the top surface, compression on the bottom — which is far below the T700 carbon yield of 600 MPa, confirming the hollow section is stiff enough for this load.</p>
</blockquote>

<hr>

<h2>4. Safety Factor &amp; Structural Deflection (Sub-Calc D)</h2>
<p>To determine if the selected arm material will yield under load, the maximum applied stress is compared to the material's yield strength (&sigma;<sub>yield</sub>). The Safety Factor (<i>SF</i>) is defined as:</p>

<p align="center"><i>SF</i> = <sup>&sigma;<sub>yield</sub></sup> &frasl; <sub>&sigma;<sub>applied</sub></sub></p>

<ul>
<li><i>SF</i> &ge; 2.0 (Safe): Strong structural headroom.</li>
<li>1.0 &le; <i>SF</i> &lt; 2.0 (Marginal): High risk of structural fatigue or permanent deformation under dynamic flight loads.</li>
<li><i>SF</i> &lt; 1.0 (Fail): The applied stress exceeds the yield point, causing immediate mechanical failure (yielding/fracture).</li>
</ul>

<blockquote>
<p><strong>Worked example — safety factor of the carbon-fibre arm.</strong>
Comparing the T700 carbon yield strength &sigma;<sub>yield</sub> = 600 MPa with the applied root stress &sigma;<sub>applied</sub> = 20.1 MPa from Section 3:</p>
<p align="center"><i>SF</i> = <sup>600</sup> &frasl; <sub>20.1</sub> = <b>29.9</b></p>
<p>With <i>SF</i> = 29.9 &ge; 2.0 the arm sits firmly in the Safe band with large structural headroom — the carbon arm could withstand roughly 30&times; this thrust load before reaching its yield point.</p>
</blockquote>

<h3>Dynamic Safety Factor &amp; First Bending Mode</h3>
<p>The static safety factor above assumes the tip force is perfectly steady. Real flight is not: aggressive maneuvers, prop-wash turbulence, and hard landings spike the instantaneous load to <i>n</i><sub>dyn</sub> &times; the static value, with <i>n</i><sub>dyn</sub> typically 1.0&ndash;3.0 (default 1.5). The simulator reports a dynamic safety factor alongside the static one so a design that looks comfortably safe under steady hover load is not mistaken for safe under real maneuvering load:</p>

<p align="center"><i>SF</i><sub>dyn</sub> = <sup>&sigma;<sub>yield</sub></sup> &frasl; <sub>(<i>n</i><sub>dyn</sub> &middot; &sigma;<sub>applied</sub>)</sub></p>

<blockquote>
<p><strong>Worked example — dynamic safety factor at the default 1.5&times; load factor.</strong>
Using &sigma;<sub>applied</sub> = 20.1 MPa from Section 3 and &sigma;<sub>yield</sub> = 600 MPa:</p>
<p align="center"><i>SF</i><sub>dyn</sub> = <sup>600</sup> &frasl; <sub>(1.5 &middot; 20.1)</sub> = <sup>600</sup> &frasl; <sub>30.15</sub> = <b>19.90</b></p>
<p>Still comfortably safe here because the static margin (SF = 29.9) is so large — but for a marginal static design (SF close to 2.0), the same 1.5&times; factor can push the dynamic SF below 1.0, which is exactly the caveat the "Dynamic load" fault scenario demonstrates.</p>
</blockquote>

<p>The arm's lowest natural bending frequency (first cantilever mode) also matters: if a motor's rotor-pass frequency lands near it, resonance amplifies vibration and fatigues the arm far faster than the static/dynamic stress numbers alone would suggest. For a uniform cantilever beam (fixed-free), the first mode frequency is:</p>

<p align="center"><i>f</i><sub>n</sub> = <sup>&beta;<sub>1</sub><sup>2</sup></sup> &frasl; <sub>2&pi;</sub> &middot; &radic;(<sup>(<i>E</i>&middot;<i>I</i>)</sup> &frasl; <sub>(<i>m</i>&prime; &middot; <i>L</i><sup>4</sup>)</sub>)</p>

<p>Where <i>&beta;</i><sub>1</sub> = 1.875104 is the fixed-free fundamental eigenvalue and <i>m</i>&prime; = &rho;&middot;<i>A</i> is the arm's mass per unit length (&rho; = material density, <i>A</i> = hollow cross-section area from Section 3).</p>

<blockquote>
<p><strong>Worked example — first bending mode of the cf_250 arm.</strong>
Cross-section area <i>A</i> = (10&times;6 &minus; 8&times;4) mm&sup2; = 28 mm&sup2; = 2.8&times;10<sup>&minus;5</sup> m&sup2;; carbon fibre density &rho; = 1600 kg/m&sup3; gives <i>m</i>&prime; = 1600 &times; 2.8&times;10<sup>&minus;5</sup> = 0.0448 kg/m. With <i>E</i>&middot;<i>I</i> = 70&times;10<sup>9</sup> &times; 1.373&times;10<sup>&minus;10</sup> = 9.611 N&middot;m&sup2; and <i>L</i> = 0.105 m:</p>
<p align="center"><i>f</i><sub>n</sub> = <sup>1.875104<sup>2</sup></sup> &frasl; <sub>2&pi;</sub> &middot; &radic;(<sup>9.611</sup> &frasl; <sub>(0.0448 &middot; 0.105<sup>4</sup>)</sub>) &asymp; <b>743.5 Hz</b></p>
<p>This short, stiff 105 mm arm sits far above any rotor-pass frequency the motor could produce, so resonance is not a concern here. Because <i>f</i><sub>n</sub> &prop; 1/<i>L</i><sup>2</sup>, longer arms (300&ndash;850 mm class) drop to the 80&ndash;120 Hz range typical of real multi-rotor frames — close enough to rotor-pass frequencies at some throttle settings that resonance becomes a genuine design concern, which is why both numbers (not just static stress) are reported.</p>
</blockquote>

<h3>Elastic Deflection Profile</h3>
<p>The vertical deflection shape of the arm (<i>y</i>(<i>x</i>)) as a function of distance <i>x</i> from the clamp is modeled using the Euler-Bernoulli beam deflection equation:</p>

<p align="center"><i>y</i>(<i>x</i>) = (<sup>(<i>F</i><sub>tip</sub> &middot; <i>x</i><sup>2</sup>)</sup> &frasl; <sub>(6 <i>E I</i>)</sub>) &middot; (3<i>L</i> - <i>x</i>)</p>

<blockquote>
<p><strong>Worked example — tip deflection of the loaded cf_250 arm.</strong>
Evaluated at the free tip (<i>x</i> = <i>L</i> = 0.105 m) the expression reduces to <i>y</i>(<i>L</i>) = <i>F</i><sub>tip</sub> &middot; <i>L</i><sup>3</sup> &frasl; (3<i>EI</i>). Using <i>F</i><sub>tip</sub> = 8.78 N, carbon fibre <i>E</i> = 70 GPa = 70 &times; 10<sup>9</sup> Pa and <i>I</i> = 1.373 &times; 10<sup>&minus;10</sup> m<sup>4</sup>:</p>
<p align="center"><i>y</i>(<i>L</i>) = <sup>(8.78 &middot; 0.105<sup>3</sup>)</sup> &frasl; <sub>(3 &middot; 70 &times; 10<sup>9</sup> &middot; 1.373 &times; 10<sup>&minus;10</sup>)</sub> = <b>3.52 &times; 10<sup>&minus;4</sup> m &asymp; 0.35 mm</b></p>
<p>The rigid carbon arm deflects only 0.35 mm at full thrust. Since deflection scales as 1&frasl;<i>E</i>, the same load on a Nylon arm (<i>E</i> = 3.0 GPa) would bend about 23&times; further (&asymp; 8 mm), illustrating why Young's modulus governs flight-frame rigidity.</p>
</blockquote>

<p>Where:</p>
<ul>
<li><i>E</i> is the material's Young's Modulus (GPa), representing stiffness.</li>
<li><i>I</i> is the area moment of inertia (m<sup>4</sup>).</li>
<li><i>x</i> is the position along the span (0 &le; <i>x</i> &le; <i>L</i>).</li>
</ul>

<p>This equation explains why Nylon (low Young's Modulus <i>E</i> = 3.0 GPa) experiences extreme deflection and yielding compared to Carbon Fibre (<i>E</i> = 70.0 GPa), which remains highly rigid under equivalent loads.</p>
