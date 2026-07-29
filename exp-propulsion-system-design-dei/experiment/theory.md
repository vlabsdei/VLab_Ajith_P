<h1>Theoretical Background: Multirotor Propulsion Systems</h1>

<p>A multirotor's propulsion system turns electrical energy stored in a battery into aerodynamic thrust. To design a drone that is both efficient and safe you have to keep track of four things that push and pull on each other at once: aerodynamics, the motor's electrical circuit, heat, and battery chemistry.</p>

<p>Before we get into the physics, the animation below shows an exploded view of a complete propulsion unit. It pulls apart the carbon-fibre frame, the BLDC motor, the propeller, the battery, and the avionics stack, so you can see what each part is before we start analysing it.</p>

<p align="center">
  <video controls playsinline preload="metadata" width="100%" style="max-width: 860px; border-radius: 8px;">
    <source src="./videos/propulsion_final.mp4" type="video/mp4">
    Your browser does not support the HTML5 video tag. You can
    <a href="./videos/propulsion_final.mp4">download the video</a> instead.
  </video>
</p>

<blockquote>
<p><strong>A note on real parts.</strong> The worked examples below use each
component's clean catalog number (KV = 2300, R<sub>motor</sub> = 0.095
&Omega;, and so on) so the arithmetic is easy to follow. The simulator does
something different. It nudges every part's key specs by a small seeded
manufacturing tolerance (motor KV &plusmn;8%, winding resistance &plusmn;10%,
propeller pitch &plusmn;0.30", battery capacity &plusmn;5%, cell resistance
&plusmn;20%, ESC R<sub>dson</sub> &plusmn;10%). The tolerance is fixed for a
given part ID but changes from build to build, so a "2300 KV" motor might
actually read 2130.8 KV. That is on purpose. No real motor matches its
datasheet, and every formula in this chapter works just as well on the
as-built numbers as on the nominal ones.</p>
</blockquote>

<hr>

<h2>1. Aerodynamic Force Balance &amp; Hover State</h2>

<p>For a multirotor to hold a stationary hover, the vertical forces on it have to cancel. The thrust from all <i>N</i><sub>motors</sub> propellers together has to carry the weight of the drone:</p>

<p align="center">&Sigma; <i>F</i><sub><i>y</i></sub> = <i>N</i><sub>motors</sub> &middot; <i>T</i> - <i>M</i><sub>total</sub> &middot; <i>g</i> = 0</p>

<p align="center"><b><i>T</i><sub>required</sub> = <sup>(<i>M</i><sub>total</sub> &middot; <i>g</i>)</sup> &frasl; <sub><i>N</i><sub>motors</sub></sub></b></p>

<p>Where:</p>
<ul>
<li><i>T</i><sub>required</sub> is the static thrust each motor-propeller unit has to make [N].</li>
<li><i>M</i><sub>total</sub> is the total All-Up Mass (AUM) of the quadcopter: frame, electronics, battery, propulsion units, and any payload [kg].</li>
<li><i>g</i> is the acceleration due to gravity (9.80665 m/s<sup>2</sup>).</li>
<li><i>N</i><sub>motors</sub> is the number of motors (4 for a standard quadcopter).</li>
</ul>

<h3>Worked Example: Hover Thrust</h3>

<p>Take the 5-inch build we use throughout this chapter: a 250 mm carbon-fibre frame (<code>cf_250</code>, 68.2 g), four 2204-2300KV motors (25.0 g each), four 5045 propellers (3.1 g each), a 4S 2200 mAh LiPo (<code>4s_2200</code>, 162.0 g), four 30 A ESCs (<code>esc_30a_blheli32</code>, 9.5 g each), an F4 flight controller (6.2 g) and an ELRS receiver (3.5 g). Add the masses up and you get an All-Up Mass of <i>M</i><sub>total</sub> = 390.3 g &asymp; 0.390 kg. Put that into the hover balance:</p>

<p align="center"><i>T</i><sub>required</sub> = <sup>(0.390 kg &middot; 9.80665 m&frasl;s<sup>2</sup>)</sup> &frasl; <sub>4</sub> &asymp; 0.957 N</p>

<p>So each motor-propeller unit has to make about 0.957 N (&asymp; 97.6 gf) of static thrust to hold a hover, which is a quarter of the 3.83 N total weight.</p>

<p><img src="./images/forces_aerodynamics.png" alt="Forces and Aerodynamics"></p>

<hr>

<h2>2. Propeller Aerodynamics (Blade Element Momentum Theory)</h2>

<p>Aerodynamic thrust (<i>T</i>) and drag torque (<i>Q</i>) come from the propeller blades cutting through the air and setting up a pressure difference. From dimensional analysis and Blade Element Momentum Theory (BEMT), we write the performance as:</p>

<p align="center"><i>T</i> = <i>C</i><sub><i>t</i></sub> &middot; &rho; &middot; <i>n</i><sup>2</sup> &middot; <i>D</i><sup>4</sup></p>

<p align="center"><i>Q</i> = <i>C</i><sub><i>q</i></sub> &middot; &rho; &middot; <i>n</i><sup>2</sup> &middot; <i>D</i><sup>5</sup></p>

<p>Where:</p>
<ul>
<li>&rho; is the ambient air density [kg/m<sup>3</sup>], found from altitude (<i>H</i>) with the International Standard Atmosphere (ISA) model:
  <p align="center">&rho; = &rho;<sub>0</sub> &middot; (1 - 0.0000225577 &middot; <i>H</i>)<sup>4.25588</sup></p>
  (with sea-level density &rho;<sub>0</sub> = 1.225 kg/m<sup>3</sup>).</li>
<li><i>n</i> is the rotational speed of the propeller in revolutions per second [rps] (<i>n</i> = RPM / 60).</li>
<li><i>D</i> is the propeller diameter [m].</li>
<li><i>C</i><sub><i>t</i></sub> and <i>C</i><sub><i>q</i></sub> are the non-dimensional thrust and torque coefficients.</li>
</ul>

<p>The velocity vectors, angles, and resulting incremental aerodynamic forces on a 2D airfoil cross-section of the blade look like this:</p>

<p><img src="./images/blade_forces_bemt.png" alt="Blade Section Aerodynamics (BEMT)"></p>

<h3>Static Pitch Approximations</h3>
<p>When the prop is static, the coefficients depend mostly on its pitch-to-diameter ratio (<i>P</i>/<i>D</i>):</p>

<p align="center"><i>C</i><sub><i>t</i>_static</sub> &asymp; 0.115 &middot; (<sup><i>P</i></sup> &frasl; <sub><i>D</i></sub>)</p>

<p align="center"><i>C</i><sub><i>q</i>_static</sub> &asymp; <i>C</i><sub><i>t</i>_static</sub> &middot; (0.045 &middot; <i>Re</i><sub>factor</sub> + 0.11 &middot; (<sup><i>P</i></sup> &frasl; <sub><i>D</i></sub>))</p>

<h3>Low Reynolds Number Correction</h3>
<p>Small drone propellers run in a low Reynolds number regime (<i>Re</i> &lt; 150,000), where viscous shear dominates and pushes up the profile drag coefficient. We correct for this with a 1/4-power law:</p>

<p align="center"><i>Re</i><sub>factor</sub> = (<sup>150,000</sup> &frasl; <sub><i>Re</i></sub>)<sup>0.25</sup></p>

<p>Where <i>Re</i> = <sup>(&rho; &middot; <i>v</i><sub>tip</sub> &middot; <i>c</i><sub>mean</sub>)</sup> &frasl; <sub>&mu;</sub>, with <i>v</i><sub>tip</sub> = &pi; &middot; <i>n</i> &middot; <i>D</i> the blade tip speed, <i>c</i><sub>mean</sub> the mean blade chord, and <i>&mu;</i> the air dynamic viscosity.</p>

<h3>Induced Inflow Correction</h3>
<p>As the propeller spins it pushes air down through the disk at velocity <i>v<sub>i</sub></i>, which lowers the blades' effective angle of attack. We work out the induced advance ratio (<i>J<sub>i</sub></i>) and adjust the coefficients:</p>

<p align="center"><i>J</i><sub><i>i</i></sub> = &radic;(<sup>(2 &middot; <i>C</i><sub><i>t</i>_static</sub>)</sup> &frasl; <sub>&pi;</sub>)</p>

<p align="center"><i>C</i><sub><i>t</i>_eff</sub> = <i>C</i><sub><i>t</i>_static</sub> &middot; (1 - <i>J</i><sub><i>i</i></sub>)</p>

<p align="center"><i>C</i><sub><i>q</i>_eff</sub> = <i>C</i><sub><i>q</i>_static</sub> &middot; (1 + 1.5 &middot; <i>J</i><sub><i>i</i></sub><sup>2</sup>)</p>

<h3>Worked Example: Static Thrust &amp; Torque Coefficients</h3>

<p>Take one 5045 propeller (<i>D</i> = 0.127 m, <i>P</i>/<i>D</i> = 0.9, mean chord <i>c</i><sub>mean</sub> &asymp; 0.1<i>D</i> = 0.0127 m) spinning at <i>n</i><sub>rpm</sub> = 12,000 RPM (<i>n</i> = 200 rps) in sea-level air (&rho; = 1.225 kg/m<sup>3</sup>, &mu; = 1.81 &times; 10<sup>-5</sup> Pa&middot;s). Working through the coefficient model of this section:</p>

<table>
<thead>
<tr><th>Quantity</th><th>Substitution</th><th>Result</th></tr>
</thead>
<tbody>
<tr><td><i>C</i><sub><i>t</i>_static</sub></td><td>0.115 &middot; 0.9</td><td>0.1035</td></tr>
<tr><td><i>v</i><sub>tip</sub> = &pi; &middot; <i>n</i> &middot; <i>D</i></td><td>&pi; &middot; 200 &middot; 0.127</td><td>79.8 m/s</td></tr>
<tr><td><i>Re</i></td><td>(1.225 &middot; 79.8 &middot; 0.0127) &frasl; (1.81 &times; 10<sup>-5</sup>)</td><td>6.86 &times; 10<sup>4</sup></td></tr>
<tr><td><i>Re</i><sub>factor</sub></td><td>(150,000 &frasl; 68,590)<sup>0.25</sup></td><td>1.216</td></tr>
<tr><td><i>C</i><sub><i>q</i>_static</sub></td><td>0.1035 &middot; (0.045 &middot; 1.216 + 0.11 &middot; 0.9)</td><td>0.01591</td></tr>
<tr><td><i>J</i><sub><i>i</i></sub></td><td>&radic;(2 &middot; 0.1035 &frasl; &pi;)</td><td>0.2567</td></tr>
<tr><td><i>C</i><sub><i>t</i>_eff</sub></td><td>0.1035 &middot; (1 &minus; 0.2567)</td><td>0.07693</td></tr>
<tr><td><i>C</i><sub><i>q</i>_eff</sub></td><td>0.01591 &middot; (1 + 1.5 &middot; 0.2567<sup>2</sup>)</td><td>0.01748</td></tr>
</tbody>
</table>

<p>Now feed the effective coefficients into the BEMT relations:</p>

<p align="center"><i>T</i> = 0.07693 &middot; 1.225 &middot; 200<sup>2</sup> &middot; 0.127<sup>4</sup> &asymp; 0.981 N</p>

<p align="center"><i>Q</i> = 0.01748 &middot; 1.225 &middot; 200<sup>2</sup> &middot; 0.127<sup>5</sup> &asymp; 0.0283 N&middot;m</p>

<p>At 12,000 RPM one 5045 makes about 0.981 N, a hair over the 0.957 N per-motor hover requirement from Section 1. In other words this motor-prop pair reaches hover at a modest throttle and still has a little thrust in reserve.</p>

<hr>

<h2>3. Equivalent Electrical Circuit &amp; Back-EMF</h2>

<p>The brushless DC (BLDC) motor is an electromechanical transducer. At steady state we model the electrical loop as an equivalent series circuit: the battery open-circuit voltage (<i>V</i><sub>oc</sub>), the various resistances, and the motor's Back-Electromotive Force (<i>V</i><sub>bemf</sub>).</p>

<p><img src="./images/propulsion_circuit_diagram.png" alt="Propulsion Circuit Diagram"></p>

<h3>Total Effective Resistance</h3>
<p>The winding resistance (<i>R</i><sub><i>m</i></sub>) picks up two more terms: the battery's internal resistance (<i>R</i><sub>batt</sub>) and the ESC MOSFET resistance (<i>R</i><sub>esc</sub>):</p>

<p align="center"><i>R</i><sub><i>m</i>_eff</sub> = <i>R</i><sub>motor</sub> + <i>R</i><sub>esc</sub> + <i>R</i><sub>batt</sub> &nbsp;&nbsp;,&nbsp;&nbsp; <i>R</i><sub>batt</sub> = <i>S</i> &middot; <i>R</i><sub>cell</sub></p>

<ul>
<li><strong>ESC Resistance:</strong> The MOSFET on-resistance <i>R</i><sub>dson</sub> of the catalog ESCs runs from 1.6 m&Omega; (60 A 4-in-1 stack) to 3.5 m&Omega; (20 A BLHeli_S). Lower-resistance parts usually carry a higher current rating.</li>
<li><strong>Battery Resistance:</strong> Each cell contributes a resistance that falls as capacity rises, and the <i>S</i> cells sit in series, so the pack resistance is the per-cell value multiplied by the cell count:
  <p align="center"><i>R</i><sub>cell</sub> &asymp; 0.012 &middot; (<sup>1500</sup> &frasl; <sub><i>C</i><sub>mah</sub></sub>) &Omega; &nbsp;&nbsp;,&nbsp;&nbsp; <i>R</i><sub>batt</sub> = <i>S</i> &middot; <i>R</i><sub>cell</sub></p>
  Take care not to apply the cell count twice: <i>S</i> enters once, here, and the pack resistance then goes into <i>R</i><sub><i>m</i>_eff</sub> as a single term.
</li>
</ul>

<h3>Back-EMF &amp; Applied Voltage</h3>
<p>When the motor spins at speed <i>n</i><sub>rpm</sub>, it makes a counter-voltage that fights the applied voltage:</p>

<p align="center"><i>V</i><sub>bemf</sub> = <sup><i>n</i><sub>rpm</sub></sup> &frasl; <sub><i>KV</i></sub></p>

<p>Where <i>KV</i> is the motor velocity constant [RPM/V].
The effective voltage the ESC's switching MOSFETs put on the windings at throttle <i>u</i> &isin; [0, 1] is:</p>

<p align="center"><i>V</i><sub>applied</sub> = <i>u</i> &middot; <i>V</i><sub>battery_terminal</sub></p>

<h3>Steady-State Current &amp; Torque</h3>
<p>The loop current (<i>I</i>) is driven by the gap between the applied voltage and the Back-EMF:</p>

<p align="center"><i>I</i> = <sup>(<i>V</i><sub>applied</sub> - <i>V</i><sub>bemf</sub>)</sup> &frasl; <sub><i>R</i><sub><i>m</i>_eff</sub></sub></p>

<p>The motor makes torque (<i>Q</i><sub><i>m</i></sub>) in proportion to this current, and that torque has to cover the aerodynamic torque (<i>Q</i>) plus winding friction losses:</p>

<p align="center"><i>Q</i><sub><i>m</i></sub> = <i>K</i><sub><i>t</i></sub> &middot; (<i>I</i> - <i>I</i><sub>0</sub>)</p>

<p>Where <i>K</i><sub><i>t</i></sub> = <sup>60</sup> &frasl; <sub>(2&pi; &middot; <i>KV</i>)</sub> is the motor torque constant [N·m/A], and <i>I</i><sub>0</sub> is the no-load current.</p>

<h3>Worked Example: Circuit Operating Point</h3>

<p>Take the 2204-2300KV motor (<i>KV</i> = 2300 RPM/V, <i>R</i><sub>motor</sub> = 0.095 &Omega; at 20&deg;C, <i>I</i><sub>0</sub> = 0.30 A) on the 4S 2200 mAh pack through a 30 A ESC (<code>esc_30a</code>, <i>R</i><sub>esc</sub> = 0.0030 &Omega;). Start by building the effective resistance. The winding resistance itself climbs with temperature:</p>

<p align="center"><i>R</i><sub><i>motor</i></sub>(<i>T</i>) = <i>R</i><sub><i>motor</i>,20&deg;C</sub> &middot; (1 + 0.00393 &middot; (<i>T</i> &minus; 20))</p>

<p>using copper's temperature coefficient of resistance (0.00393 /&deg;C). With a still-cool winding at <i>T</i> &asymp; 25&deg;C, <i>R</i><sub>motor</sub>(25) = 0.095 &middot; (1 + 0.00393 &middot; 5) &asymp; 0.0969 &Omega;. This is the loop behind thermal runaway: the winding heats up, its resistance rises, current rises for the same applied voltage, and copper loss rises again. Each cell contributes <i>R</i><sub>cell</sub> = 0.012 &middot; (1500 &frasl; 2200) &asymp; 0.00818 &Omega;, and the four cells in series give a pack resistance <i>R</i><sub>batt</sub> = 4 &middot; 0.00818 &asymp; 0.0327 &Omega;, so:</p>

<p align="center"><i>R</i><sub><i>m</i>_eff</sub> = 0.0969 + 0.0030 + 0.0327 &asymp; 0.1326 &Omega;</p>

<p>At the hover speed <i>n</i><sub>rpm</sub> = 12,000 RPM the back-EMF is:</p>

<p align="center"><i>V</i><sub>bemf</sub> = <sup>12,000</sup> &frasl; <sub>2300</sub> &asymp; 5.22 V</p>

<p>With an applied voltage <i>V</i><sub>applied</sub> &asymp; 6.15 V (throttle <i>u</i> &asymp; 0.42 of the 14.8 V terminal), the loop current is:</p>

<p align="center"><i>I</i> = <sup>(6.15 &minus; 5.22)</sup> &frasl; <sub>0.1326</sub> &asymp; 7.02 A</p>

<p>With <i>K</i><sub><i>t</i></sub> = <sup>60</sup> &frasl; <sub>(2&pi; &middot; 2300)</sub> &asymp; 0.00415 N&middot;m/A, the motor torque is <i>Q</i><sub><i>m</i></sub> = 0.00415 &middot; (7.02 &minus; 0.30) &asymp; 0.0279 N&middot;m. That is close to the aerodynamic torque <i>Q</i> &asymp; 0.0283 N&middot;m from Section 2. The simulator's iterative solver nudges the RPM by a fraction of a percent to close the gap to zero; a hand calculation at a round 12,000 RPM lands within about 1.4% of the true balance point. The 7.02 A draw sits well under the motor's 25 A limit, so this hover point is a safe place to operate.</p>

<hr>

<h2>4. Dynamic Thermal &amp; Convective Cooling Kinetics</h2>

<p>Current through the windings makes heat through resistive (Joule) losses. We track how fast the motor's temperature changes (<i>dT</i>/<i>dt</i>) with a first-order lumped-capacitance thermal model:</p>

<p align="center"><sup><i>dT</i></sup> &frasl; <sub><i>dt</i></sub> = <sup>(<i>P</i><sub>loss</sub> &minus; (<i>T</i> &minus; <i>T</i><sub>ambient</sub>) &middot; <i>h</i> &middot; <i>A</i><sub>motor</sub>)</sup> &frasl; <sub>(<i>M</i><sub>motor</sub> &middot; <i>C</i><sub><i>p</i></sub>)</sub></p>

<p>Where:</p>
<ul>
<li><i>P</i><sub>loss</sub> = <i>I</i><sup>2</sup> &middot; <i>R</i><sub>motor</sub>(<i>T</i>) is the electrical copper loss [W] (we ignore iron core losses to keep it simple), using the temperature-dependent winding resistance from Section 3.</li>
<li><i>T</i> is the current winding/case temperature [°C], and <i>T</i><sub>ambient</sub> is the air temperature (25&deg;C).</li>
<li><i>M</i><sub>motor</sub> is the physical mass of the selected motor [kg] (catalog <code>mass_g</code>), and <i>C</i><sub><i>p</i></sub> = <strong>385 J/(kg&middot;K)</strong> is the specific heat used for the motor's copper-dominated thermal mass (stator windings plus core, not a solid aluminium billet).</li>
<li><i>A</i><sub>motor</sub> is the real convective surface area of the selected motor's bell, modelled as a cylinder side plus two end caps from the catalog's <code>bell_diameter_mm</code>/<code>bell_height_mm</code> (it falls back to a generic 25&times;20 mm bell if a motor omits them):
  <p align="center"><i>A</i><sub>motor</sub> = &pi; &middot; <i>D</i><sub>bell</sub> &middot; <i>H</i><sub>bell</sub> + 2&middot;&pi;&middot;(<sup><i>D</i><sub>bell</sub></sup>&frasl;<sub>2</sub>)<sup>2</sup></p>
</li>
<li><i>h</i> is the convective heat-transfer coefficient [W/(m<sup>2</sup>&middot;K)], a still-air baseline plus a term set by the propeller's own induced (wash) velocity <i>v<sub>i</sub></i> through the disk:
  <p align="center"><i>h</i> = 25.0 + 22.0 &middot; <i>v<sub>i</sub></i> &nbsp; , &nbsp; <i>v<sub>i</sub></i> = &radic;(<sup><i>T</i><sub>thrust</sub></sup> &frasl; <sub>(2&rho;<i>A</i><sub>disk</sub>)</sub>)</p>
  with <i>T</i><sub>thrust</sub> the propeller's current thrust [N] and <i>A</i><sub>disk</sub> = &pi;<i>D</i><sup>2</sup>&frasl;4 the propeller disk area. A bigger or faster-spinning prop cools its own motor.</li>
</ul>

<p>A real motor's surface area grows with its physical size (a 5010 is a far bigger heatsink than a 2204). Using each motor's real bell geometry, rather than one fixed area for every motor, is what makes a bad pairing (a tiny motor forced to push a huge propeller) run hot while a good match stays cool.</p>

<h3>Worked Example: Steady-State Winding Temperature</h3>

<p>Carry on from the hover operating point (<i>I</i> = 7.02 A, <i>R</i><sub>motor</sub>(25&deg;C) = 0.0969 &Omega; from Section 3). The copper loss is:</p>

<p align="center"><i>P</i><sub>loss</sub> = 7.02<sup>2</sup> &middot; 0.0969 &asymp; 4.78 W</p>

<p>The 2204 motor's bell is <i>D</i><sub>bell</sub> = 27 mm, <i>H</i><sub>bell</sub> = 20 mm, which gives a convective area <i>A</i><sub>motor</sub> = &pi;&middot;0.027&middot;0.020 + 2&middot;&pi;&middot;0.0135<sup>2</sup> &asymp; 2.84 &times; 10<sup>&minus;3</sup> m<sup>2</sup>. The induced wash speed through the propeller disk (<i>A</i><sub>disk</sub> = &pi;&middot;0.127<sup>2</sup>&frasl;4 &asymp; 0.01267 m<sup>2</sup>) at <i>T</i><sub>thrust</sub> = 0.981 N is <i>v<sub>i</sub></i> = &radic;(0.981 &frasl; (2&middot;1.225&middot;0.01267)) &asymp; 5.62 m/s, so:</p>

<p align="center"><i>h</i> = 25.0 + 22.0 &middot; 5.62 &asymp; 148.7 W/(m<sup>2</sup>&middot;K)</p>

<p align="center"><i>h</i> &middot; <i>A</i><sub>motor</sub> &asymp; 148.7 &middot; 2.84 &times; 10<sup>&minus;3</sup> &asymp; 0.423 W/K</p>

<p>At thermal equilibrium (<i>dT</i>/<i>dt</i> = 0) the steady temperature rise above ambient is <i>P</i><sub>loss</sub> &frasl; (<i>hA</i>) = 4.78 &frasl; 0.423 &asymp; 11.3 &deg;C, so the winding settles near 25 + 11.3 &asymp; 36.3 &deg;C, well under the 150 &deg;C insulation limit. That matches how cool a well-matched 2204 runs at hover. The thermal time constant <i>&tau;</i> = <i>M</i><sub>motor</sub>&middot;<i>C</i><sub><i>p</i></sub> &frasl; (<i>hA</i>) = 0.025 &middot; 385 &frasl; 0.423 &asymp; 22.8 s tells you how quickly the winding reaches this equilibrium after a throttle change.</p>

<p>If the motor temperature goes past 150&deg;C, the wire insulation melts, and you get short circuits, motor burnout, and eventually a crash. The scenario that actually reaches that limit in the simulator is an <strong>undersized motor on an oversized propeller</strong>: high aerodynamic drag torque demands sustained high current, and the small motor has too little surface area to shed the heat. A properly matched pairing, like the one above, never gets close.</p>

<p>You can picture this heat flow with an equivalent thermal RC circuit, where <i>P</i><sub>loss</sub> is a heat-flux source, <i>C</i><sub>th</sub> = <i>M</i><sub>motor</sub>&middot;<i>C</i><sub><i>p</i></sub> is the thermal capacitance (storing heat), and <i>R</i><sub>th</sub> = 1 &frasl; (<i>hA</i>) is the thermal resistance of the convective cooling:</p>

<p><img src="./images/thermal_model_diagram.png" alt="Thermal Equivalent RC Model"></p>

<h3>ESC Power Dissipation</h3>

<p>The ESC's own switching MOSFETs dump conduction loss on their own, separate from the motor, using the same lumped-capacitance form with the ESC's real catalog ratings: <i>R</i><sub>dson</sub> (from Section 3) for loss and a manufacturer-style thermal resistance <i>R</i><sub><i>th</i></sub> [°C/W] for cooling (a bigger ESC board with more copper pour has a lower <i>R</i><sub><i>th</i></sub> and sheds heat faster):</p>

<p align="center"><i>P</i><sub>loss,esc</sub> = <i>I</i><sup>2</sup> &middot; <i>R</i><sub>dson</sub> &nbsp; (&times; (<i>I</i>&frasl;<i>I</i><sub>rated</sub>)<sup>2</sup> extra penalty above the rated current) &nbsp;,&nbsp; <sup><i>dT</i></sup>&frasl;<sub><i>dt</i></sub> = <sup>(<i>P</i><sub>loss,esc</sub> &minus; (<i>T</i> &minus; <i>T</i><sub>ambient</sub>) &frasl; <i>R</i><sub><i>th</i></sub>)</sup> &frasl; <sub>(<i>M</i><sub>esc</sub> &middot; <i>C</i><sub><i>p</i>,esc</sub>)</sub></p>

<p>with <i>C</i><sub><i>p</i>,esc</sub> = 800 J/(kg&middot;K) for the PCB, copper and silicon together. For the <code>esc_30a</code> (<i>R</i><sub>dson</sub> = 0.0030 &Omega;, <i>R</i><sub><i>th</i></sub> = 18 &deg;C/W, mass 9.5 g) carrying the same <i>I</i> = 7.02 A hover current: <i>P</i><sub>loss,esc</sub> = 7.02<sup>2</sup> &middot; 0.0030 &asymp; 0.148 W, cooling conductance 1&frasl;18 &asymp; 0.0556 W/K, so the steady-state rise is 0.148 &frasl; 0.0556 &asymp; 2.66 &deg;C. The ESC settles near 27.7 &deg;C, cooler than the motor, because the I&sup2;R loss through a milliohm-scale <i>R</i><sub>dson</sub> is small next to the motor's roughly 100 milliohm winding. Draw more than the ESC's rated <code>current_a</code> and the extra (<i>I</i>&frasl;<i>I</i><sub>rated</sub>)<sup>2</sup> penalty kicks in on <i>P</i><sub>loss,esc</sub>, so an undersized ESC with a high-current motor is a second overheat path on top of the motor's own thermal limit.</p>

<hr>

<h2>5. Battery Voltage Sag &amp; Discharge Dynamics</h2>

<p>As a Lithium Polymer (LiPo) battery discharges, its open-circuit voltage (<i>V</i><sub>oc</sub>) drops with the State of Charge (<i>SoC</i> &isin; [0, 1]):</p>

<p align="center"><i>V</i><sub>oc_cell</sub> = 3.5 + 0.7 &middot; <i>SoC</i> + 0.1 &middot; <i>SoC</i><sup>3</sup></p>

<p>Under heavy current, the terminal voltage sags below the open-circuit voltage because of the cell's internal resistance:</p>

<p align="center"><i>V</i><sub>terminal</sub> = <i>N</i><sub>cells</sub> &middot; (<i>V</i><sub>oc_cell</sub> - <i>I</i> &middot; <i>R</i><sub>cell_eff</sub>)</p>

<p>Near empty (<i>SoC</i> &lt; 0.30), the chemical reactions slow down and the cell's internal resistance climbs sharply:</p>

<p align="center"><i>R</i><sub>cell_eff</sub> = <i>R</i><sub>cell_nominal</sub> &middot; (1.0 + 0.25 &middot; <i>e</i><sup>5.0 &middot; (0.3 - <i>SoC</i>)</sup>)</p>

<p>This sag pulls down <i>V</i><sub>applied</sub>, which drops the RPM and thrust. That is what a draining pack does to a drone in flight.</p>

<h3>Worked Example: Voltage Sag at Hover</h3>

<p>At half charge (<i>SoC</i> = 0.5) the per-cell open-circuit voltage of the 4S 2200 mAh pack is <i>V</i><sub>oc_cell</sub> = 3.5 + 0.7 &middot; 0.5 + 0.1 &middot; 0.5<sup>3</sup> &asymp; 3.863 V. The per-cell nominal resistance is <i>R</i><sub>cell_nominal</sub> = 0.012 &middot; (1500 &frasl; 2200) &asymp; 0.00818 &Omega;. Since <i>SoC</i> &gt; 0.30 the cell resistance is still close to nominal:</p>

<p align="center"><i>R</i><sub>cell_eff</sub> = 0.00818 &middot; (1 + 0.25 &middot; <i>e</i><sup>5.0 &middot; (0.3 &minus; 0.5)</sup>) &asymp; 0.00893 &Omega;</p>

<p>Drawing the hover current <i>I</i> = 7.02 A from Section 3:</p>

<p align="center"><i>V</i><sub>terminal</sub> = 4 &middot; (3.863 &minus; 7.02 &middot; 0.00893) &asymp; 15.2 V</p>

<p>Near empty (<i>SoC</i> = 0.2) the same current meets a swollen resistance <i>R</i><sub>cell_eff</sub> &asymp; 0.01155 &Omega; and a lower <i>V</i><sub>oc_cell</sub> &asymp; 3.641 V, which drops the terminal voltage to about 14.2 V. That roughly 1 V of sag pulls down <i>V</i><sub>applied</sub> directly, so the drone has to run more throttle to hold the same RPM and thrust as the pack empties.</p>
