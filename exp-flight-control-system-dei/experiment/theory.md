<h1>Theory: Flight Control - PID Tuning, Ziegler&ndash;Nichols, Sensor Fusion &amp; the Full System</h1>

<p>A multirotor is <strong>open-loop unstable</strong>. With no active control a quadcopter cannot hold its attitude, because the smallest disturbance torque integrates unchecked into a tumble. Stable flight comes entirely from the <strong>flight-control loop</strong> running on the autopilot. It reads the vehicle's attitude many hundreds of times per second, compares it with the pilot's command, and keeps trimming the four motor thrusts to drive the error to zero.</p>

<p>This experiment builds that loop across <strong>four tabs</strong>. <strong>PID Tuning</strong> builds the controller by hand. <strong>Ziegler&ndash;Nichols</strong> tunes it on its own against the real plant lags, and against real aerodynamic drag and wind. <strong>Sensor Fusion</strong> builds the attitude <i>estimate</i> the controller depends on. <strong>Full System</strong> closes all three into one loop and lets you hunt, combination by combination, for the best flight controller.</p>

<blockquote>
<p><strong>The one idea every tab but the last hides.</strong> Tabs 1&ndash;3 each study one piece of the loop on its own (the plant, the tuning method, the filter) with the <i>true</i> attitude drawn on screen for clarity. A real autopilot never has that luxury: the controller only ever sees the <strong>estimate</strong> <i>&theta;&#770;</i> that the sensor and filter stage hands it. Section 8 makes the aerodynamics honest; Section 9 puts the estimator <i>inside</i> the loop and shows why the choice of estimator is a control decision, not a display option.</p>
</blockquote>

<p>Before we get into the physics, the animation below walks through the full flight-control story: the unstable double-integrator plant and the three PID terms, then the second-order step response and the overshoot-versus-gain trade-off, and finally the Ziegler&ndash;Nichols tuning procedure and the complementary filter that supplies the attitude estimate both loops feed on.</p>

<p align="center">
  <video controls playsinline preload="metadata" width="100%" style="max-width: 860px; border-radius: 8px;">
    <source src="./videos/flight_control_system.mp4" type="video/mp4">
    Your browser does not support the HTML5 video tag. You can
    <a href="./videos/flight_control_system.mp4">download the video</a> instead.
  </video>
</p>

<hr>

<h2>1. The Attitude Control Problem</h2>

<p>Take rotation about a single axis, the <strong>roll</strong> axis. Newton's second law for rotation says the net torque equals the moment of inertia times the angular acceleration:</p>

<p align="center"><i>&tau;</i> = <i>J</i> &middot; <i>&theta;&#776;</i></p>

<p>where <i>J</i> is the roll-axis moment of inertia [kg&middot;m<sup>2</sup>] and <i>&theta;</i> is the roll angle [rad]. Rearranged, the angle is the <strong>double integral</strong> of the applied torque:</p>

<p align="center"><i>&theta;</i>(<i>s</i>) / <i>&tau;</i>(<i>s</i>) = 1 / (<i>J s</i><sup>2</sup>)</p>

<p>This plant, a <strong>double integrator</strong>, is where the instability comes from. It has two poles at the origin, so any constant disturbance torque produces an angle that grows without bound. The controller's job is to build a restoring torque that pulls the two poles into the stable left-half plane.</p>

<p><img src="./images/pid_control_loop.png" alt="PID attitude control loop block diagram"></p>

<p>Real autopilots use a <strong>cascaded</strong> structure: an outer <strong>angle loop</strong> (commanding a desired angular rate from the attitude error) wrapped around an inner <strong>rate loop</strong> (commanding motor torque from the rate error). Sections 2&ndash;4 analyse the angle loop's closed-loop response (<strong>PID Tuning</strong> tab); Sections 5&ndash;6 tune the inner rate loop with Ziegler&ndash;Nichols against real drag and wind (<strong>Ziegler&ndash;Nichols</strong> tab); Section 7 builds the attitude estimate both loops feed on (<strong>Sensor Fusion</strong> tab); Sections 8&ndash;9 put the estimator <i>inside</i> the loop and score every controller-estimator combination against the others (<strong>Full System</strong> tab).</p>

<hr>

<h2>2. The PID Controller &amp; the Second-Order Closed Loop</h2>

<p>The Proportional&ndash;Integral&ndash;Derivative controller builds the corrective torque from three terms of the error <i>e</i> = <i>&theta;</i><sub>cmd</sub> &minus; <i>&theta;</i>:</p>

<p align="center"><i>C</i>(<i>s</i>) = <i>K</i><sub>p</sub> + <i>K</i><sub>i</sub> / <i>s</i> + <i>K</i><sub>d</sub> <i>s</i></p>

<ul>
<li><strong>Proportional</strong> (<i>K</i><sub>p</sub>): torque proportional to the present error, the main restoring spring.</li>
<li><strong>Integral</strong> (<i>K</i><sub>i</sub>): torque proportional to the accumulated past error, which clears steady offsets.</li>
<li><strong>Derivative</strong> (<i>K</i><sub>d</sub>): torque proportional to the rate of change of error, electronic damping that tames overshoot.</li>
</ul>

<p>With proportional and derivative action on the inertia plant, the closed loop becomes the textbook <strong>second-order prototype</strong> <i>s</i><sup>2</sup> + 2<i>&zeta;&omega;</i><sub>n</sub><i>s</i> + <i>&omega;</i><sub>n</sub><sup>2</sup>, where the two design quantities map straight onto the gains:</p>

<p align="center"><i>&omega;</i><sub>n</sub> = &radic;(<i>K</i><sub>p</sub> / <i>J</i>) &nbsp;&nbsp;&nbsp; <i>&zeta;</i> = <i>K</i><sub>d</sub> / (2&radic;(<i>K</i><sub>p</sub> <i>J</i>))</p>

<p><i>&omega;</i><sub>n</sub> is the <strong>natural frequency</strong> (how fast the loop responds) and <i>&zeta;</i> is the <strong>damping ratio</strong> (how oscillatory it is). Raising <i>K</i><sub>p</sub> speeds the loop up but cuts the damping; raising <i>K</i><sub>d</sub> adds damping.</p>

<h3>Where does <i>J</i> come from? The assembled airframe</h3>

<p>The moment of inertia is not a free parameter; it follows from the airframe you assembled. Model an X-quad as its four motors lumped at the arm radius <i>L</i>, each 45&deg; from the roll axis (perpendicular distance <i>L</i>/&radic;2):</p>

<p align="center"><i>J</i> = 4 &middot; (<i>m</i>/4) &middot; (<i>L</i>/&radic;2)<sup>2</sup> = <i>m L</i><sup>2</sup> / 2</p>

<p>The lumped radius is not quite the geometric arm. A real build carries its battery, flight controller and receiver near the centre, so the <em>radius of gyration</em> is smaller than the arm. The simulator applies the standard correction <i>L</i><sub>eff</sub> = 0.75 &middot; <i>L</i><sub>geom</sub>, and it is <i>L</i><sub>eff</sub> that enters <i>J</i>. (The <em>torque</em> arm is a different quantity and uses the true geometric arm &mdash; see Section 3b.)</p>

<h3>Worked Example: Roll Inertia of the 5&Prime; Reference Airframe</h3>

<p>The reference 5&Prime; build (X-Quad 5&Prime; chassis with its default motor, propeller, battery, ESC, controller and receiver) has an all-up mass <i>m</i> = 0.529 kg and a geometric arm <i>L</i><sub>geom</sub> = 145 mm, so <i>L</i><sub>eff</sub> = 0.75 &times; 145 mm = 0.109 m:</p>

<p align="center"><i>J</i> = (0.529 &times; 0.109<sup>2</sup>) / 2 = (0.529 &times; 0.01183) / 2 = <b>0.00313 kg&middot;m<sup>2</sup></b></p>

<p>Every worked example below uses this <i>J</i> = 0.00313 kg&middot;m<sup>2</sup>, which is exactly the value the simulator prints in the <strong>Roll-Axis Inertia</strong> card for the default build. A heavier or larger airframe raises <i>J</i> sharply. On a 10&Prime; Cine-Lifter build the arm length and the mass both grow together, with proportionally larger motors and battery, so <i>J</i> can end up an order of magnitude or more above the 5&Prime; reference, which slows the loop for the same gains.</p>

<h3>Worked Example: Natural Frequency &amp; Damping at the Default Gains</h3>

<p>With <i>K</i><sub>p</sub> = 0.6 N&middot;m/rad, <i>K</i><sub>d</sub> = 0.04 N&middot;m&middot;s/rad and <i>J</i> = 0.00313 kg&middot;m<sup>2</sup>:</p>

<p align="center"><i>&omega;</i><sub>n</sub> = &radic;(0.6 / 0.00313) = &radic;191.7 = <b>13.85 rad/s</b></p>
<p align="center"><i>&zeta;</i> = 0.04 / (2&radic;(0.6 &times; 0.00313)) = 0.04 / (2 &times; 0.04333) = <b>0.462</b></p>

<p>A damping ratio of 0.46 is moderately underdamped: fast, with a modest overshoot we work out next.</p>

<hr>

<h2>3. Step-Response Metrics</h2>

<p>When the pilot commands a step change in attitude, the closed-loop response is judged by four numbers, each a closed-form function of <i>&omega;</i><sub>n</sub> and <i>&zeta;</i>:</p>

<table>
<thead>
<tr><th>Metric</th><th>Formula</th><th>Meaning</th></tr>
</thead>
<tbody>
<tr><td>Peak overshoot</td><td><i>M</i><sub>p</sub> = 100 &middot; <i>e</i><sup>&minus;&pi;&zeta;/&radic;(1&minus;&zeta;<sup>2</sup>)</sup> %</td><td>how far past the target it swings</td></tr>
<tr><td>Peak time</td><td><i>t</i><sub>p</sub> = &pi; / (<i>&omega;</i><sub>n</sub>&radic;(1&minus;&zeta;<sup>2</sup>))</td><td>when the first peak occurs</td></tr>
<tr><td>Rise time</td><td><i>t</i><sub>r</sub> = (&pi; &minus; cos<sup>&minus;1</sup><i>&zeta;</i>) / (<i>&omega;</i><sub>n</sub>&radic;(1&minus;&zeta;<sup>2</sup>))</td><td>0 to 100% of the first rise</td></tr>
<tr><td>Settling time (2%)</td><td><i>t</i><sub>s</sub> = 4 / (<i>&zeta;&omega;</i><sub>n</sub>)</td><td>when it stays within &plusmn;2%</td></tr>
</tbody>
</table>

<h3>Worked Example: Metrics at <i>K</i><sub>p</sub> = 0.6, <i>K</i><sub>d</sub> = 0.04</h3>

<p>Using <i>&omega;</i><sub>n</sub> = 13.85 rad/s and <i>&zeta;</i> = 0.462:</p>

<p align="center"><i>M</i><sub>p</sub> = 100 <i>e</i><sup>&minus;&pi;&times;0.462/&radic;(1&minus;0.462<sup>2</sup>)</sup> = 100 <i>e</i><sup>&minus;1.635</sup> = <b>19.50 %</b></p>
<p align="center"><i>t</i><sub>p</sub> = &pi; / (13.85 &times; 0.887) = <b>0.256 s</b> &nbsp;&nbsp; <i>t</i><sub>r</sub> = <b>0.167 s</b> &nbsp;&nbsp; <i>t</i><sub>s</sub> = 4 / (0.462 &times; 13.85) = <b>0.626 s</b></p>

<p>These are the numbers the simulator reports with <strong>Plant fidelity</strong> set to <strong>Ideal 1/(<i>J s</i><sup>2</sup>)</strong>. Switch it to <strong>Real drone</strong> and the same gains produce <b>31.3 %</b> overshoot instead of 19.5 % &mdash; Section 3b explains where the missing 12 points come from.</p>

<p><img src="./images/step_response_metrics.png" alt="PID step response showing overshoot, rise and settling time"></p>

<h3>The <i>K</i><sub>p</sub>-Overshoot Trade-Off</h3>

<p>Hold <i>K</i><sub>d</sub> = 0.04 fixed and sweep <i>K</i><sub>p</sub>, and you see the central tuning tension: more proportional gain is faster but rings harder.</p>

<table>
<thead>
<tr><th><i>K</i><sub>p</sub></th><th><i>&omega;</i><sub>n</sub> (rad/s)</th><th><i>&zeta;</i></th><th>Overshoot</th><th>Settling <i>t</i><sub>s</sub></th></tr>
</thead>
<tbody>
<tr><td>0.2</td><td>8.00</td><td>0.799</td><td>1.53 %</td><td>0.626 s</td></tr>
<tr><td>0.4</td><td>11.31</td><td>0.565</td><td>11.62 %</td><td>0.626 s</td></tr>
<tr><td>0.6</td><td>13.85</td><td>0.462</td><td>19.50 %</td><td>0.626 s</td></tr>
<tr><td>0.8</td><td>15.99</td><td>0.400</td><td>25.41 %</td><td>0.626 s</td></tr>
<tr><td>1.0</td><td>17.88</td><td>0.358</td><td>30.04 %</td><td>0.626 s</td></tr>
</tbody>
</table>

<p>Overshoot climbs past the <strong>25% comfort limit</strong> near <i>K</i><sub>p</sub> = 0.8. There is a subtle result worth noticing: the <strong>settling time stays at 0.626 s</strong> across the whole sweep, because the decay rate <i>&zeta;&omega;</i><sub>n</sub> = <i>K</i><sub>d</sub>/(2<i>J</i>) = 0.04/(2&times;0.00313) = 6.39 s<sup>&minus;1</sup> depends only on <i>K</i><sub>d</sub> and <i>J</i>, not on <i>K</i><sub>p</sub>. To settle faster you have to raise the derivative gain, not the proportional gain.</p>

<p>The simulator's <strong>Gain sweep</strong> chart draws exactly this table as five overlaid step responses, and the <strong>s-plane pole map</strong> shows the same fact geometrically: raising <i>K</i><sub>p</sub> slides the pole pair straight <em>up and down</em> at a fixed real part &minus;<i>K</i><sub>d</sub>/(2<i>J</i>), so it rings faster without decaying any sooner.</p>

<hr>

<h2>3b. From Gain to Grams of Thrust: the Mixer, and Why the Real Machine Overshoots More</h2>

<p>Sections 2 and 3 treat the controller output as a torque you can simply <em>have</em>. A multirotor has no torque actuator. It has four propellers, and the only way to make a roll torque is to run one lateral pair harder than the other. Every gain you set is, at the end of the chain, a number of newtons on one side of the airframe.</p>

<h3>The Mixer</h3>

<p>On an X-quad each motor sits a perpendicular distance <i>a</i> = <i>L</i><sub>geom</sub>/&radic;2 from the roll axis. Let <i>T</i><sub>h</sub> be the hover thrust per motor and <i>&delta;</i> the roll trim the mixer adds to the left pair and subtracts from the right:</p>

<p align="center"><i>T</i><sub>left</sub> = <i>T</i><sub>h</sub> + <i>&delta;</i>, &nbsp;&nbsp; <i>T</i><sub>right</sub> = <i>T</i><sub>h</sub> &minus; <i>&delta;</i> &nbsp;&nbsp;&rArr;&nbsp;&nbsp; <i>&tau;</i> = (<i>T</i><sub>left</sub> &minus; <i>T</i><sub>right</sub>) &middot; 2<i>a</i> = 4<i>&delta;a</i></p>

<p>A propeller cannot push backwards and cannot exceed its wide-open thrust, so <i>&delta;</i> is bounded by whichever headroom runs out first:</p>

<p align="center"><i>&delta;</i><sub>max</sub> = min(<i>T</i><sub>h</sub>, <i>T</i><sub>max</sub> &minus; <i>T</i><sub>h</sub>) &nbsp;&nbsp;&nbsp; <i>&tau;</i><sub>max</sub> = 4 <i>&delta;</i><sub>max</sub> <i>a</i></p>

<h3>Worked Example: Control Authority of the 5&Prime; Reference Build</h3>

<p>With <i>m</i> = 0.529 kg, <i>L</i><sub>geom</sub> = 145 mm and the default 1806/2450 KV motor on a 5&Prime; tri-blade at 4S:</p>

<p align="center"><i>a</i> = 0.145/&radic;2 = <b>0.103 m</b> &nbsp;&nbsp; <i>T</i><sub>h</sub> = <i>mg</i>/4 = <b>1.30 N</b> &nbsp;&nbsp; <i>T</i><sub>max</sub> = <b>5.12 N</b> per motor</p>
<p align="center"><i>&delta;</i><sub>max</sub> = min(1.30, 3.82) = 1.30 N &nbsp;&nbsp;&rArr;&nbsp;&nbsp; <i>&tau;</i><sub>max</sub> = 4 &times; 1.30 &times; 0.103 = <b>0.532 N&middot;m</b></p>

<p>Note which term binds: on a build with this much thrust-to-weight the limit is <em>hover thrust</em>, not the motor ceiling &mdash; the down-going pair reaches zero thrust before the up-going pair reaches full throttle. Roll authority is therefore roughly proportional to weight and arm length, and a proportional demand <i>K</i><sub>p</sub>&middot;<i>e</i> = 1.5 &times; 45&deg; = 1.18 N&middot;m simply cannot be delivered by this airframe: the mixer clips, the loop runs open for as long as the clip lasts, and no amount of further gain helps.</p>

<h3>The Four Effects the Ideal Model Leaves Out</h3>

<p>With <strong>Plant fidelity</strong> set to <strong>Real drone</strong>, the simulator adds each of the following to the same closed loop:</p>

<table>
<thead>
<tr><th>Effect</th><th>Model</th><th>What it does to the response</th></tr>
</thead>
<tbody>
<tr><td>Discrete control</td><td>controller runs at the IMU rate (400 Hz) with zero-order hold between ticks</td><td>adds an average half-sample of delay &mdash; pure phase lag, which eats damping</td></tr>
<tr><td>Imperfect sensing</td><td>the controller reads the complementary estimate <i>&theta;&#770;</i> of Section 7, not <i>&theta;</i>: gyro bias, accelerometer noise <i>&sigma;</i> and the blend <i>&alpha;</i> all apply</td><td>the loop tracks its <em>belief</em>; the gap between belief and truth becomes real attitude error</td></tr>
<tr><td>Actuator lag</td><td>each motor's thrust follows its command with a first-order lag <i>&tau;</i><sub>a</sub> = 20 ms</td><td>more phase lag; the derivative term's braking torque arrives late, exactly when it is least useful</td></tr>
<tr><td>Mixer saturation</td><td><i>T</i> clipped to [0, <i>T</i><sub>max</sub>], with conditional-integration anti-windup while clipped</td><td>caps the achievable torque; large commands become open-loop coasting</td></tr>
</tbody>
</table>

<h3>Worked Example: Same Gains, Two Plants</h3>

<p>Reference build, <i>K</i><sub>p</sub> = 0.6, <i>K</i><sub>i</sub> = 0, <i>K</i><sub>d</sub> = 0.04, 20&deg; step:</p>

<table>
<thead>
<tr><th>Plant</th><th>Peak</th><th>Overshoot</th><th>Settling <i>t</i><sub>s</sub></th></tr>
</thead>
<tbody>
<tr><td>Ideal 1/(<i>J s</i><sup>2</sup>)</td><td>23.9&deg;</td><td>19.5 %</td><td>0.60 s</td></tr>
<tr><td>Real drone</td><td>26.3&deg;</td><td>31.3 %</td><td>0.90 s</td></tr>
</tbody>
</table>

<p>Nothing about the gains changed; only the honesty of the plant did. The lesson is not that the second-order formulas are wrong &mdash; they are the right way to <em>reason</em> about the loop &mdash; but that they are an optimistic bound. A tune that is exactly at the overshoot limit on paper is over it in the air, which is why real tuning ends on the aircraft and not in the algebra.</p>

<hr>

<h2>4. Steady-State Error &amp; the Role of Integral Action</h2>

<p>A perfectly trimmed quad still tilts under a <strong>constant disturbance torque</strong>: an off-centre payload, a shifted battery, or a steady crosswind. A horizontal centre-of-gravity offset <i>d</i> under gravity creates the couple:</p>

<p align="center"><i>&tau;</i><sub>d</sub> = <i>m</i> &middot; <i>g</i> &middot; <i>d</i></p>

<p>With proportional control alone, the loop can only hold a counter-torque by accepting a permanent angle error, the <strong>steady-state error</strong>:</p>

<p align="center"><i>e</i><sub>ss</sub> = <i>&tau;</i><sub>d</sub> / <i>K</i><sub>p</sub></p>

<h3>Worked Example: Droop from an Assumed CG Offset</h3>

<p>The <strong>Disturbance torque</strong> switch in the simulator applies a fixed reference CG offset of <i>d</i> = 3.57 mm, which stands in for a slightly off-centre battery or payload, so on the 0.529 kg airframe:</p>

<p align="center"><i>&tau;</i><sub>d</sub> = 0.529 &times; 9.807 &times; 0.00357 = <b>0.0185 N&middot;m</b></p>

<p>The resulting steady tilt shrinks as <i>K</i><sub>p</sub> rises:</p>

<table>
<thead>
<tr><th><i>K</i><sub>p</sub></th><th><i>e</i><sub>ss</sub> (rad)</th><th><i>e</i><sub>ss</sub> (deg)</th></tr>
</thead>
<tbody>
<tr><td>0.2</td><td>0.0926</td><td>5.31&deg;</td></tr>
<tr><td>0.6</td><td>0.0309</td><td>1.77&deg;</td></tr>
<tr><td>1.0</td><td>0.0185</td><td>1.06&deg;</td></tr>
</tbody>
</table>

<p>The simulator reports 1.83&deg; rather than 1.77&deg; at <i>K</i><sub>p</sub> = 0.6 on the <strong>Real drone</strong> plant, because the controller is holding the counter-torque against its own noisy estimate of the angle rather than against the truth. Switch to the <strong>Ideal</strong> plant and the measured droop matches <i>&tau;</i><sub>d</sub>/<i>K</i><sub>p</sub> exactly.</p>

<p>Higher <i>K</i><sub>p</sub> cuts the droop but, from Section 3, worsens the overshoot. You cannot win on both with proportional gain alone.</p>

<p>The way out is the <strong>integral term</strong>. Because <i>K</i><sub>i</sub>/<i>s</i> keeps accumulating as long as any error remains, it feeds in an ever-growing counter-torque until the error is driven to <strong>zero</strong>. Add even a small <i>K</i><sub>i</sub> and the steady-state tilt disappears, while <i>K</i><sub>p</sub> and <i>K</i><sub>d</sub> set the transient. That is why every real attitude loop is a full PID, not just PD.</p>

<hr>

<h2>5. Ziegler&ndash;Nichols Auto-Tuning</h2>

<p>Choosing three gains by hand is tedious. The <strong>Ziegler&ndash;Nichols ultimate-cycle method</strong> finds a starting set from a single experiment: raise the proportional gain until the loop <strong>oscillates with constant amplitude</strong>; record that gain as the <strong>ultimate gain</strong> <i>K</i><sub>u</sub> and the oscillation period as the <strong>ultimate period</strong> <i>P</i><sub>u</sub>; then read the gains off a table.</p>

<h3>Why the Method Needs the Real Plant Lags</h3>

<p>A pure inertia plant 1/(<i>J s</i><sup>2</sup>) under proportional control has its poles sitting <strong>exactly on the imaginary axis at every gain</strong>. It oscillates at all <i>K</i><sub>p</sub>, so <i>K</i><sub>u</sub> is undefined. The ultimate-gain method only works because the real inner rate loop carries extra <strong>first-order lags</strong>: the rotational/mechanical lag <i>&tau;</i><sub>m</sub>, the motor and ESC actuator lag <i>&tau;</i><sub>a</sub>, and the gyro/filter lag <i>&tau;</i><sub>s</sub>. So the rate-loop plant is a Type-0 chain:</p>

<p align="center"><i>P</i>(<i>s</i>) = 1 / [(<i>&tau;</i><sub>m</sub><i>s</i> + 1)(<i>&tau;</i><sub>a</sub><i>s</i> + 1)(<i>&tau;</i><sub>s</sub><i>s</i> + 1)]</p>

<p>Routh's criterion on this third-order loop gives closed-form crossing conditions:</p>

<p align="center"><i>&omega;</i><sub>u</sub> = &radic;[ (<i>&tau;</i><sub>m</sub>+<i>&tau;</i><sub>a</sub>+<i>&tau;</i><sub>s</sub>) / (<i>&tau;</i><sub>m</sub><i>&tau;</i><sub>a</sub><i>&tau;</i><sub>s</sub>) ] &nbsp;&nbsp;&nbsp; <i>P</i><sub>u</sub> = 2&pi; / <i>&omega;</i><sub>u</sub></p>
<p align="center"><i>K</i><sub>u</sub> = [ (<i>&tau;</i><sub>m</sub><i>&tau;</i><sub>a</sub> + <i>&tau;</i><sub>m</sub><i>&tau;</i><sub>s</sub> + <i>&tau;</i><sub>a</sub><i>&tau;</i><sub>s</sub>)(<i>&tau;</i><sub>m</sub>+<i>&tau;</i><sub>a</sub>+<i>&tau;</i><sub>s</sub>) / (<i>&tau;</i><sub>m</sub><i>&tau;</i><sub>a</sub><i>&tau;</i><sub>s</sub>) &minus; 1 ] / <i>K</i></p>

<h3>Worked Example: Ultimate Gain &amp; Period (5&Prime; Airframe)</h3>

<p>With <i>&tau;</i><sub>m</sub> = 0.05 s, <i>&tau;</i><sub>a</sub> = 0.02 s, <i>&tau;</i><sub>s</sub> = 0.005 s and unit DC gain (i.e. the air-resistance slider at 0% &mdash; Section 8 shows how drag moves both numbers):</p>

<p align="center"><i>&omega;</i><sub>u</sub> = &radic;(0.075 / 5&times;10<sup>&minus;6</sup>) = &radic;15000 = <b>122.5 rad/s</b>, so <i>P</i><sub>u</sub> = 2&pi;/122.5 = <b>0.0513 s</b></p>
<p align="center"><i>K</i><sub>u</sub> = (0.00135 &times; 0.075 / 5&times;10<sup>&minus;6</sup>) &minus; 1 = 20.25 &minus; 1 = <b>19.25</b></p>

<p>The <strong>classic Ziegler&ndash;Nichols PID table</strong> then gives:</p>

<p align="center"><i>K</i><sub>p</sub> = 0.6 <i>K</i><sub>u</sub> &nbsp;&nbsp; <i>T</i><sub>i</sub> = 0.5 <i>P</i><sub>u</sub> &nbsp;&nbsp; <i>T</i><sub>d</sub> = 0.125 <i>P</i><sub>u</sub></p>

<p>with <i>K</i><sub>i</sub> = <i>K</i><sub>p</sub>/<i>T</i><sub>i</sub> and <i>K</i><sub>d</sub> = <i>K</i><sub>p</sub><i>T</i><sub>d</sub>.</p>

<h3>Worked Example: Classic Z-N Gains</h3>

<p align="center"><i>K</i><sub>p</sub> = 0.6 &times; 19.25 = <b>11.55</b> &nbsp;&nbsp; <i>K</i><sub>i</sub> = 11.55 / (0.5&times;0.0513) = <b>450.3</b> &nbsp;&nbsp; <i>K</i><sub>d</sub> = 11.55 &times; (0.125&times;0.0513) = <b>0.0741</b></p>

<hr>

<h2>6. Refining the Tune: Classic vs Robust</h2>

<p>Ziegler&ndash;Nichols is fast, but it is <strong>deliberately aggressive</strong>. The classic table aims for a <i>quarter-amplitude decay</i>, which on this plant produces a big first overshoot.</p>

<blockquote>
<p><strong>Observed in the simulation: classic Z-N step response.</strong> Applying <i>K</i><sub>p</sub> = 11.55, <i>K</i><sub>i</sub> = 450.3, <i>K</i><sub>d</sub> = 0.074 to the rate loop gives roughly <strong>68% overshoot</strong> with zero steady-state error: fast, but far past the 25% comfort limit. (A widely repeated claim that classic Z-N yields about 20% overshoot is wrong for this kind of plant; the honest simulated value is the one reported here.)</p>
</blockquote>

<p>The practical workflow is to treat Z-N as a <i>starting point</i> and then <strong>detune for robustness</strong>. The classic table's overshoot comes mostly from its very high integral gain (<i>T</i><sub>i</sub> = 0.5<i>P</i><sub>u</sub>). The <strong>Tyreus&ndash;Luyben</strong> table raises <i>T</i><sub>i</sub> and lowers <i>K</i><sub>p</sub>:</p>

<p align="center"><i>K</i><sub>p</sub> = 0.45 <i>K</i><sub>u</sub> &nbsp;&nbsp; <i>T</i><sub>i</sub> = 2.2 <i>P</i><sub>u</sub> &nbsp;&nbsp; <i>T</i><sub>d</sub> = <i>P</i><sub>u</sub> / 6.3</p>

<h3>Worked Example: Tyreus&ndash;Luyben Gains &amp; Response</h3>

<p align="center"><i>K</i><sub>p</sub> = 0.45 &times; 19.25 = <b>8.66</b> &nbsp;&nbsp; <i>K</i><sub>i</sub> = 8.66 / (2.2&times;0.0513) = <b>76.8</b> &nbsp;&nbsp; <i>K</i><sub>d</sub> = 8.66 &times; (0.0513/6.3) = <b>0.0705</b></p>

<p>The integral gain drops from 450 to 77, a much gentler integrator. The simulated step now overshoots about <strong>16%</strong> (under the 25% target) while keeping zero steady-state error. The cost is a slightly slower rise; the payoff is a calm, robust loop.</p>

<p><img src="./images/ziegler_nichols_tuning.png" alt="Ziegler&ndash;Nichols sustained oscillation and the classic vs Tyreus&ndash;Luyben step responses"></p>

<hr>

<h2>7. Sensor Fusion: the Complementary Filter</h2>

<p>Both control loops need a clean attitude measurement, but neither inertial sensor gives one on its own:</p>

<ul>
<li>The <strong>gyroscope</strong> measures angular <i>rate</i>; integrate it and you get a smooth, low-noise angle that <strong>drifts</strong>, because the small constant bias piles up without bound.</li>
<li>The <strong>accelerometer</strong> measures the gravity direction, which gives an absolute tilt that <strong>does not drift</strong> but is <strong>buried in vibration noise</strong>.</li>
</ul>

<p>The <strong>complementary filter</strong> fuses them: a high-pass on the gyro path and a low-pass on the accel path that sum to unity.</p>

<p align="center"><i>&theta;</i><sub>est</sub> = <i>&alpha;</i> &middot; (<i>&theta;</i><sub>est,prev</sub> + <i>&omega;</i><sub>gyro</sub> &middot; &Delta;<i>t</i>) + (1 &minus; <i>&alpha;</i>) &middot; <i>&theta;</i><sub>accel</sub></p>

<p>The single blending coefficient <i>&alpha;</i> sets the crossover <strong>time constant</strong>, and through it the two competing error sources:</p>

<p align="center"><i>&tau;</i><sub>f</sub> = <i>&alpha;</i> &middot; &Delta;<i>t</i> / (1 &minus; <i>&alpha;</i>)</p>
<p align="center">drift = bias &middot; <i>&tau;</i><sub>f</sub> &nbsp;&nbsp;&nbsp; noise<sub>rms</sub> = <i>&sigma;</i><sub>accel</sub> &middot; &radic;[(1 &minus; <i>&alpha;</i>) / (1 + <i>&alpha;</i>)]</p>

<p>A <strong>higher</strong> <i>&alpha;</i> trusts the gyro longer (more drift, less noise); a <strong>lower</strong> <i>&alpha;</i> trusts the accelerometer more (less drift, more noise). The best <i>&alpha;</i> is the one that minimises the <i>combined</i> error.</p>

<h3>Worked Example: Choosing <i>&alpha;</i> for the Reference IMU</h3>

<p>With a gyro bias of 0.6&deg;/s, accelerometer angle noise <i>&sigma;</i> = 1.8&deg;, and the estimator at &Delta;<i>t</i> = 2.5 ms (400 Hz):</p>

<table>
<thead>
<tr><th><i>&alpha;</i></th><th><i>&tau;</i><sub>f</sub> (s)</th><th>drift (&deg;)</th><th>noise (&deg;)</th><th>total (&deg;)</th></tr>
</thead>
<tbody>
<tr><td>0.90</td><td>0.0225</td><td>0.014</td><td>0.413</td><td>0.426</td></tr>
<tr><td>0.95</td><td>0.0475</td><td>0.029</td><td>0.288</td><td>0.317</td></tr>
<tr><td><b>0.98</b></td><td><b>0.1225</b></td><td><b>0.074</b></td><td><b>0.181</b></td><td><b>0.254</b></td></tr>
<tr><td>0.99</td><td>0.2475</td><td>0.149</td><td>0.128</td><td>0.276</td></tr>
</tbody>
</table>

<p>The total error is smallest at <strong><i>&alpha;</i> = 0.98</strong>. For contrast, <i>pure</i> gyro integration (<i>&alpha;</i> = 1) drifts by 0.6&deg;/s &times; 30 s = <strong>18&deg;</strong> after just half a minute, the unbounded error the accelerometer reference exists to stop.</p>

<p><img src="./images/complementary_filter.png" alt="Complementary filter fusing drifting gyro and noisy accelerometer into a clean estimate"></p>

<hr>

<h2>8. Air Resistance &amp; Wind: Real Aerodynamic Damping</h2>

<p>Every rotation through air meets a resisting torque. The <strong>Ziegler&ndash;Nichols</strong> tab lets you dial in an "air resistance" percentage and a wind-gust torque, both acting on the <i>same</i> rate-loop plant as Section 5. They are not a separate toy but the physical damping and disturbance a real airframe actually feels.</p>

<p align="center"><i>&tau;</i><sub>drag</sub>(<i>&omega;</i>) = &minus;<i>b&omega;</i> &minus; <i>c&omega;</i>|<i>&omega;</i>|</p>

<p>The <strong>linear</strong> term (coefficient <i>b</i>) dominates at the modest rates an attitude step involves and folds straight into the loop's damping; the <strong>quadratic</strong> term (coefficient <i>c</i>) only matters at high angular rate (aggressive manoeuvres) and rides along for completeness. Both scale with air density and with the cube of the airframe's arm length (bigger blades, bigger disc area, more drag):</p>

<p align="center"><i>b</i> = 0.0667 &middot; (air% / 100) &middot; (<i>L</i>/0.11)<sup>3</sup> &middot; (&rho;/1.225)</p>

<p>Because the linear drag term opposes rotation exactly like the derivative gain does, it folds straight into the loop's <strong>effective damping</strong>:</p>

<p align="center"><i>&zeta;</i><sub>eff</sub> = (<i>K</i><sub>d</sub> + <i>b</i>) / (2&radic;(<i>K</i><sub>p</sub> <i>J</i>))</p>

<h3>Worked Example: Air Resistance Calms the PID Loop (5&Prime; Reference, <i>K</i><sub>p</sub>=0.6, <i>K</i><sub>d</sub>=0.04, <i>J</i>=0.00313)</h3>

<p>The <strong>Air resistance</strong> slider appears on the PID tab as well as the Z-N tab, and it acts on both plants &mdash; drag is physics, not fidelity:</p>

<table>
<thead>
<tr><th>Air resistance</th><th><i>b</i> (N&middot;m&middot;s/rad)</th><th><i>&zeta;</i><sub>eff</sub></th><th><i>M</i><sub>p</sub> analytic</th><th>Overshoot, ideal plant</th><th>Overshoot, real drone</th></tr>
</thead>
<tbody>
<tr><td>0% (vacuum)</td><td>0</td><td>0.462</td><td>19.50%</td><td>19.45%</td><td>31.3%</td></tr>
<tr><td>30%</td><td>0.0193</td><td>0.685</td><td>5.23%</td><td>5.17%</td><td>8.4%</td></tr>
<tr><td>70%</td><td>0.0451</td><td>0.982</td><td>0.00%</td><td>0.00%</td><td>0.0%</td></tr>
</tbody>
</table>

<p>The same electronic gains fly a visibly calmer drone as air resistance rises. Drag is <i>free</i> damping the controller does not have to supply. Two things are worth reading out of this table beyond the headline. First, the <strong>ideal-plant column reproduces the analytic <i>M</i><sub>p</sub> to within 0.05 percentage points</strong>, which is a useful check that the simulator's integrator and the closed-form theory agree. Second, the <strong>real-drone column is consistently worse</strong> (Section 3b), and the gap narrows as damping rises &mdash; a well-damped loop is far less sensitive to the phase lag that discretisation and actuator dynamics add.</p>

<h3>Drag Also Moves the Ultimate Gain</h3>

<p>Aerodynamic damping acts on the <em>body</em>, so in the rate loop of Section 5 it enters the mechanical stage rather than the controller output: <i>J&omega;&#775;</i> = <i>&tau;</i> &minus; <i>b&omega;</i>. That both speeds the mechanical pole up and lowers the stage's DC gain by the same factor <i>d</i>:</p>

<p align="center"><i>&tau;</i><sub>m,eff</sub> = <i>&tau;</i><sub>m</sub>/(1+<i>d</i>) &nbsp;&nbsp;&nbsp; <i>K</i><sub>plant</sub> = 1/(1+<i>d</i>) &nbsp;&nbsp;&nbsp; <i>d</i> = 0.9 &middot; (air% / 100)</p>

<p>Both effects push the ultimate gain up:</p>

<table>
<thead>
<tr><th>Air resistance</th><th><i>K</i><sub>u</sub></th><th><i>P</i><sub>u</sub></th><th>Classic <i>K</i><sub>p</sub> = 0.6<i>K</i><sub>u</sub></th><th>Overshoot after retuning</th></tr>
</thead>
<tbody>
<tr><td>0%</td><td>19.25</td><td>51.3 ms</td><td>11.55</td><td>68%</td></tr>
<tr><td>30%</td><td>21.24</td><td>49.1 ms</td><td>12.74</td><td>67%</td></tr>
<tr><td>70%</td><td>24.02</td><td>46.6 ms</td><td>14.41</td><td>66%</td></tr>
</tbody>
</table>

<p>Notice what Ziegler&ndash;Nichols does with the extra margin: because the table is always a fixed fraction of <i>K</i><sub>u</sub>, it <strong>spends the drag on gain rather than on calm</strong> and the overshoot barely moves. Z-N holds you at a constant distance from instability by construction; a draggier airframe simply gets to fly with hotter gains at that same distance.</p>

<h3>Worked Example: Drag Tames the Aggressive Classic Z-N Tune &mdash; If You Hold the Gains</h3>

<p>To see drag as damping instead of as licence for more gain, note the tune at 0% air (<i>K</i><sub>p</sub>=11.55, <i>K</i><sub>i</sub>=450.3, <i>K</i><sub>d</sub>=0.0741) and fly <em>those fixed gains</em> into thicker air:</p>

<table>
<thead>
<tr><th>Air resistance</th><th><i>d</i></th><th>Overshoot</th><th>Settling</th></tr>
</thead>
<tbody>
<tr><td>0%</td><td>0</td><td>68%</td><td>0.183 s</td></tr>
<tr><td>30%</td><td>0.27</td><td>62%</td><td>0.155 s</td></tr>
<tr><td>70%</td><td>0.63</td><td>55%</td><td>0.128 s</td></tr>
<tr><td>90%</td><td>0.81</td><td>52%</td><td>0.125 s</td></tr>
</tbody>
</table>

<p>Real air resistance is doing part of the job the Tyreus&ndash;Luyben retune (Section 6) does on paper. Both cut overshoot, one by physics, one by re-gaining. The Z-N tab re-derives <i>K</i><sub>u</sub> live from the current air setting, so on screen you will see the previous table's behaviour; this one is the controlled comparison that isolates the damping.</p>

<p>A <strong>wind gust</strong> is modelled as a torque disturbance riding on top of the CG-offset couple from Section 4:</p>

<p align="center"><i>&tau;</i><sub>wind</sub>(<i>t</i>) = <i>A</i> &middot; (0.6 + 0.4 sin(2&pi; &middot; 0.8<i>t</i>))</p>

<p>a steady push (0.6<i>A</i>) with a slower 0.8 Hz gust on top (up to 1.0<i>A</i>): enough disturbance that only integral action (Section 4) can null it in steady state. Proportional and derivative action alone leave a wandering residual error that tracks the gust.</p>

<hr>

<h2>9. The Full System: Closing the Loop on the ESTIMATE, Not the Truth</h2>

<p>Sections 2&ndash;7 each isolated one stage of the flight controller and, for clarity, let you <i>see</i> the true attitude directly. A real autopilot cannot do that: the only signal the controller has is whatever the sensor-and-estimator stage hands it. The <strong>Full System</strong> tab takes off the training wheel and closes the actual loop:</p>

<p align="center"><i>e</i> = <i>&theta;</i><sub>cmd</sub> &minus; <i>&theta;&#770;</i> &nbsp;&nbsp;&nbsp; (never <i>&theta;</i><sub>cmd</sub> &minus; <i>&theta;</i>)</p>

<p><img src="./images/closed_loop_full_system.png" alt="Full-system closed loop showing the controller acting on the attitude estimate, not the true angle"></p>

<p>Three estimator modes are available, matching the extremes and the middle ground of Section 7:</p>

<table>
<thead>
<tr><th>Estimator</th><th>Formula</th><th>Behaviour in the loop</th></tr>
</thead>
<tbody>
<tr><td><strong>Complementary</strong> (<i>&alpha;</i>)</td><td><i>&theta;&#770;</i> = <i>&alpha;</i>(<i>&theta;&#770;</i> + <i>&omega;</i><sub>meas</sub>&Delta;<i>t</i>) + (1&minus;<i>&alpha;</i>)<i>&theta;</i><sub>accel</sub></td><td>Bounded error: the controller tracks the true attitude closely</td></tr>
<tr><td><strong>Gyro-only</strong> (<i>&alpha;</i>=1)</td><td><i>&theta;&#770;</i> = &int;<i>&omega;</i><sub>meas</sub> <i>dt</i></td><td>Drifts without bound: the controller slowly chases a phantom tilt</td></tr>
<tr><td><strong>Accelerometer-only</strong></td><td><i>&theta;&#770;</i> = <i>&theta;</i><sub>accel</sub></td><td>No drift, but every noise sample perturbs the command directly</td></tr>
</tbody>
</table>

<p>Three controllers (Manual, ZN-Classic, ZN-Tyreus) can be paired with any of the three estimators, for <strong>nine flight-control systems in total</strong>. Each one is flown against the same commanded attitude, air resistance, wind and IMU, and scored on:</p>

<p align="center">tracking RMS (true <i>&theta;</i> vs command) &nbsp;+&nbsp; estimator RMS (true <i>&theta;</i> vs <i>&theta;&#770;</i>) &nbsp;+&nbsp; overshoot &nbsp;+&nbsp; settling time &nbsp;+&nbsp; actuator saturation</p>

<h3>Worked Example: The Same Manual PID Gains, Three Estimators (Reference Build, MPU-6000, 20&deg; Command)</h3>

<table>
<thead>
<tr><th>Estimator</th><th>Tracking RMS</th><th>Estimator RMS</th><th>Overshoot</th><th>Settling</th><th>Score</th></tr>
</thead>
<tbody>
<tr><td>Complementary (<i>&alpha;</i>=0.98)</td><td>0.23&deg;</td><td>0.24&deg;</td><td>11.0%</td><td>0.35 s</td><td><b>97</b></td></tr>
<tr><td>Accelerometer-only</td><td>0.44&deg;</td><td>1.81&deg;</td><td>10.2%</td><td>0.29 s</td><td>91</td></tr>
<tr><td>Gyro-only</td><td>1.45&deg;</td><td>1.60&deg;</td><td>9.0%</td><td>4.00 s (never settles)</td><td>63</td></tr>
</tbody>
</table>

<p><strong>The gains never changed.</strong> Only the estimator did, and the same electronics that fly cleanly on the complementary filter chase a drifting phantom on gyro-only: the tracking error grows more than sixfold and the &plusmn;2&deg; settling band never closes, running out the full 4 s window. This is the sentence in Section 1 made concrete: <i>the controller does not fly the drone, it flies whatever the sensors and the filter tell it the drone is doing.</i></p>

<p>Read the two RMS columns against each other rather than in isolation. The accelerometer-only row is the instructive one: its tracking error is only twice the complementary figure, yet its estimator error is over seven times worse. The loop is closing tightly on a belief that is badly wrong, which is precisely the failure a tracking-error-only metric cannot see.</p>

<p>Across the full 3&times;3 matrix on this build, every complementary-filter combination scores in the high 90s and every gyro-only combination collapses to the 60s or below regardless of which controller drives it. The estimator choice dominates the controller choice. That is the leaderboard's central lesson: tuning gains you cannot trust perfectly is worse than modest gains you can.</p>

<p>The <strong>Uncalibrated ESC</strong> switch on this tab programs the same kind of fault the Power Electronics (ESC) experiment studies directly, a fixed actuation offset the command path has to trim through, into this loop. Turn it on and you can watch the integral term work harder, because the dead-band the flight controller assumes no longer matches the ESC's true response.</p>

<hr>

<h2>Modelling Assumptions &amp; Limitations</h2>

<ol>
<li><strong>Lumped inertia is an upper bound.</strong> <i>J</i> = <i>m L</i><sup>2</sup>/2 assumes all mass sits at the motor positions. Real builds carry the battery and stack near the centre, so the true inertia is a bit lower and the loop is a little faster than predicted.</li>
<li><strong>The prototype 2nd-order model is idealised.</strong> The metric formulas of Section 3 ignore the zero the PD term introduces, the half-sample delay of a discrete controller, the actuator lag and the mixer's thrust limits. Section 3b quantifies the gap: on the reference build the same gains overshoot 19.5 % on the ideal plant and 31.3 % on the modelled aircraft. Both plants are available in the simulator so the difference can be measured rather than assumed.</li>
<li><strong>Classic Ziegler&ndash;Nichols is deliberately aggressive.</strong> It aims for quarter-amplitude decay, not a gentle response, hence the roughly 68% overshoot. It is a <i>starting point</i> to be refined (Section 6), not a final tune.</li>
<li><strong>The complementary filter assumes a constant gyro bias.</strong> Real bias wanders slowly with temperature, so a fixed <i>&alpha;</i> is itself a compromise; production systems re-estimate the bias online (a Kalman filter generalises exactly this fusion).</li>
<li><strong>Single-axis analysis.</strong> Roll, pitch and yaw are treated independently here; a real airframe has small cross-axis coupling that a full controller accounts for.</li>
<li><strong>The drag model (Section 8) is a lumped rotational damping, not full aerodynamics.</strong> Real blade-element aerodynamics depend on advance ratio and blade pitch; the linear-plus-quadratic torque law here captures the right <i>qualitative</i> behaviour (drag rises with air resistance and with rate) without claiming CFD-level accuracy.</li>
<li><strong>The Full-System leaderboard (Section 9) compares estimator architectures, not IMU hardware.</strong> All nine combinations share one IMU's noise/bias figures at a time; switching the IMU preset re-ranks the same nine systems rather than adding a fourth axis to the matrix.</li>
</ol>
