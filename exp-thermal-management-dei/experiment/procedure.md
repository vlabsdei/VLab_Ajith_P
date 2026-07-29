<h1>Lab Procedure: Motor &amp; ESC Thermal Management</h1>

<p>Heat is the limit almost every drone actually runs into first. This experiment takes the propulsion build you have already assembled, puts it on a thermal bench, and measures what it does with the heat it makes. Four sub-experiments across three modules, all on one page.</p>

<table>
<thead><tr><th>Module</th><th>Sub-experiment</th><th>Reports</th></tr></thead>
<tbody>
<tr><td>Module 1 &middot; Steady-State Heat</td><td>Steady-State Temp Sweep</td><td>settled temperature, &deg;C</td></tr>
<tr><td>Module 1 &middot; Steady-State Heat</td><td>Thermal Time Constant</td><td>&tau;, in s</td></tr>
<tr><td>Module 2 &middot; ESC Survivability</td><td>ESC Thermal Check</td><td>ESC temperature, &deg;C</td></tr>
<tr><td>Module 3 &middot; Active Cooling</td><td>Rotor-Wash Cooling</td><td>cooled temperature, &deg;C</td></tr>
</tbody>
</table>

<h3>The instruments</h3>

<p>The telemetry strip on the viewport carries thrust, RPM, current, heat power, <strong>case temperature</strong>, <strong>winding temperature</strong>, ESC temperature and the effective thermal resistance R<sub>th</sub>. Case and winding are separate numbers on purpose &mdash; a sensor can only reach the case, and the winding hotspot is always hotter than what the sensor tells you.</p>

<p>Two buttons on the viewport are worth finding early: the <strong>thermal camera</strong> renders the scene in false colour, and the <strong>probe</strong> switches between reading the winding and reading the housing. Below the viewport, <strong>Ambient T</strong> and <strong>Cooling airflow</strong> sit alongside the throttle, and the <strong>Calculations</strong> card carries the full thermal derivation with your build's numbers in it.</p>

<hr>

<h2>Module 1 &middot; Steady-State Temp Sweep</h2>

<h3>Objective</h3>
<p>Establish that the steady temperature rise goes with the <em>square</em> of motor current, by measuring it rather than being told it.</p>

<p><img src="./images/steadystate_temp_sweep.png" alt="Steady-state winding and case temperature rising with the square of motor current"></p>

<ol>
<li>Check the inherited build in the left panel &mdash; motor mass and cold winding resistance, propeller, ESC, pack. Motor mass matters more than it looks: a lighter motor has less surface area, so a higher thermal resistance, so it runs hotter for the same current.</li>

<li>Leave ambient at 25 &deg;C for the first pass and press <strong>&#9654; Run Sim</strong>.</li>

<li>Set a throttle and <em>wait</em>. The phase word reads SETTLING… while the case is still climbing. Once it settles, the bench logs that operating point on its own &mdash; there is no record button &mdash; and the phase switches to LOGGED n PTS &mdash; SWEEP THROTTLE.</li>

<li>Move to a new throttle and wait again. Each distinct setting adds a point, and the measured T<sub>ss</sub> against I&sup2; locus builds up as you go. A throttle you have already logged is refreshed in place rather than duplicated.</li>

<li>The run passes once you have at least <strong>five points</strong> and the linear fit of temperature against I&sup2; reaches R&sup2; &ge; 0.98. The verdict quotes the point count, the slope in &deg;C/A&sup2;, and the fit quality.</li>
</ol>

<p>That slope is the physical result. Rise above ambient is P<sub>loss</sub>&middot;R<sub>th</sub> and P<sub>loss</sub> is I&sup2;R, so halving the current quarters the heat &mdash; which is why backing a motor off slightly does so much more for its temperature than it does for its thrust.</p>

<p>If the winding climbs past its runaway threshold the phase reads OVERHEATING &mdash; DE-RATE OR COOL and no point is logged, because a cooking winding has no steady state to record. Fit an oversized propeller and hold full throttle if you want to see it.</p>

<hr>

<h2>Module 1 &middot; Thermal Time Constant</h2>

<h3>Objective</h3>
<p>Read &tau; off the heating curve, and find out what &tau; actually depends on.</p>

<p><img src="./images/thermal_time_constant.png" alt="Motor heating curve with the 63.2 percent time-constant crossing marked"></p>

<ol>
<li>Switch tabs. The motor starts from ambient and the live chart traces case temperature against time.</li>

<li>Run at a modest throttle and let the curve develop. Then drag the on-chart cursor to the point where the temperature has risen <strong>63.2%</strong> of the way from ambient to its final value. The time at that crossing is &tau;.</li>

<li>Your read has to land within &plusmn;15% of the analytic &tau; for that throttle. The phase strip shows the true value while you are dragging, so this is a reading exercise, not a guessing game.</li>

<li>Now do it again at a much higher throttle &mdash; the module needs one read at or below about 65% and one at or above 85%.</li>

<li>The verdict compares the two. The settled temperature <em>rise</em> changes by a large factor between the two throttles; &tau; moves only slightly. That is the lesson: &tau; is set by the thermal path and the mass of metal (R<sub>th</sub>&middot;C<sub>th</sub>), not by how hard you drive the motor.</li>
</ol>

<p>The small movement in &tau; is real, not noise. At higher throttle the motor sits in more of its own downwash, which lowers R<sub>th</sub> and shortens &tau; a little. A heavier motor has more thermal mass, a longer &tau;, and can therefore absorb longer bursts before it gets anywhere near its steady temperature.</p>

<hr>

<h2>Module 2 &middot; ESC Thermal Check</h2>

<h3>Objective</h3>
<p>Confirm the ESC survives the current the motor in front of it actually pulls.</p>

<ol>
<li>Open Module 2. The viewport shows the ESC board with its own live temperature.</li>

<li>Run it and take the throttle to <strong>100%</strong>. The phase reads SET THROTTLE TO 100% until you do, then HEATING… while it climbs.</li>

<li>Let it settle. The conduction loss is I&sup2;R<sub>DS(on)</sub> with a quadratic penalty term that takes over as current approaches the board's rating, and the resulting temperature follows from it.</li>

<li>A pass needs the board to settle below <strong>80 &deg;C</strong> and hold there. The verdict reports the settled temperature and how much margin is left.</li>

<li>A fail needs the board to sit above 80 &deg;C for three sustained seconds. The board sparks, and the verdict names the temperature.</li>
</ol>

<p>Worth noticing: a well-chosen motor can still fail this stage. The ESC has to be rated, or cooled, for the current the motor actually draws &mdash; not for the current you hoped it would draw.</p>

<hr>

<h2>Module 3 &middot; Rotor-Wash Cooling</h2>

<h3>Objective</h3>
<p>Bring a hot motor back under its limit using airflow, and work out how much airflow that takes.</p>

<p><img src="./images/cooling_rth_reduction.png" alt="Effective thermal resistance falling with rotor-wash airflow and bolt-on cooling parts"></p>

<ol>
<li>Open Module 3 and take the throttle above 90% &mdash; the check will not evaluate below that.</li>

<li>Start in <strong>hover</strong> airflow mode. The note under the control says it plainly: the exhaust recirculates. Watch the temperature settle somewhere above the 80 &deg;C safe ceiling and the phase read RECIRCULATING &mdash; TRY FORWARD.</li>

<li>Switch to <strong>forward flight</strong>. Now the aircraft is sweeping clean air rather than re-breathing its own downwash, R<sub>th,eff</sub> drops considerably further, and the temperature falls with it.</li>

<li>Drag the <strong>Cooling airflow</strong> slider from still air to full wash and watch R<sub>th,eff</sub> and the settled temperature track it down together.</li>

<li>Fit cooling parts from the tray onto the motor or the ESC if you still need more: a heatsink is worth about &minus;30% on R<sub>th</sub>, a ducted fan about &minus;20%, a thermal pad about &minus;15%. They stack multiplicatively on top of whatever the airflow is already doing.</li>

<li>The verdict passes once the motor settles under 80 &deg;C at high throttle, and quotes the airflow Q required to hold it there, in litres per second. That number is what a real cooling design has to deliver.</li>
</ol>

<p>Clear all four and the reward component unlocks under <strong>Components Unlocked</strong>.</p>
