<h1>Lab Procedure: Motor &amp; ESC Thermal Management</h1>

<p>This document outlines the step-by-step workflow for <strong>Experiment&nbsp;10: Thermal Management</strong>. The experiment inherits the propulsion build assembled in earlier experiments and characterises its heat behaviour across four bench sub-experiments, grouped into three modules: <strong>Module&nbsp;1</strong> (Steady-State Temp Sweep + Thermal Time Constant), <strong>Module&nbsp;2</strong> (ESC Thermal Check), and <strong>Module&nbsp;3</strong> (Rotor-Wash Cooling). Every temperature is computed live from the same motor/propeller/pack solve used throughout the lab, and your session is saved automatically — reloading the page resumes where you left off.</p>

<hr>

<h2>Stage 1: Steady-State Temperature Sweep (Module 1)</h2>

<h3>Objective</h3>
<p>Measure how the motor's steady winding and case temperatures rise with sustained current, and confirm the square-law dependence on load.</p>

<p><img src="./images/steadystate_temp_sweep.png" alt="Steady-state winding and case temperature rising with the square of motor current"></p>

<h3>Step-by-Step Procedure</h3>
<ol>
<li><strong>Launch the Simulator:</strong> Open the virtual lab page. It loads into <strong>Module&nbsp;1 &rarr; Steady-State Temp Sweep</strong>, showing the inherited motor mounted on the thermal bench with a live temperature readout.</li>
<li><strong>Confirm the inherited build.</strong> The left panel lists the motor (mass, <i>R</i><sub>m,20&deg;C</sub>), propeller, ESC and pack carried over from the propulsion experiment. Note the motor mass — a lighter motor has a higher thermal resistance and runs hotter.</li>
<li><strong>Set the ambient and throttle.</strong> Leave ambient at <i>T</i><sub>amb</sub> = 25&nbsp;&deg;C. Drag the <strong>Throttle</strong> slider up in steps and let each point settle.</li>
<li><strong>Read the two temperatures.</strong> The telemetry card reports both the <strong>case</strong> temperature (what a sensor measures) and the derived <strong>winding hotspot</strong>, which always reads hotter. Confirm the reference bench build settles near <strong>64&nbsp;&deg;C case / 86&nbsp;&deg;C winding</strong> at full throttle.</li>
<li><strong>Verify the square law.</strong> On the output chart, observe that the steady temperature <em>rise</em> above ambient scales with the <strong>square of current</strong> — halving throttle drops the rise far more than half.</li>
<li><strong>Push to runaway (optional).</strong> Select an oversized propeller for the motor and hold full throttle: if the winding fixed point climbs past <strong>240&nbsp;&deg;C</strong>, the readout flags <code>THERMAL RUNAWAY</code> and the motor burns out.</li>
</ol>

<hr>

<h2>Stage 2: Thermal Time Constant (Module 1)</h2>

<h3>Objective</h3>
<p>Extract the motor's thermal time constant <i>&tau;</i> from its heating curve using the 63.2%-of-rise crossing.</p>

<p><img src="./images/thermal_time_constant.png" alt="Motor heating curve with the 63.2 percent time-constant crossing marked"></p>

<h3>Step-by-Step Procedure</h3>
<ol>
<li><strong>Switch to the Thermal Time Constant tab.</strong> The viewport shows the motor starting from ambient; the output chart is a live heating curve of case temperature versus time.</li>
<li><strong>Start the heating run.</strong> Click <strong>Run</strong> to apply a constant load step. Watch the case temperature climb along the rising-exponential curve toward its steady value.</li>
<li><strong>Place the &tau; cursor.</strong> Drag the on-chart cursor to the point where the curve has risen <strong>63.2%</strong> of the way from ambient to its final steady temperature. Read the time at that crossing — that is <i>&tau;</i>.</li>
<li><strong>Confirm against the model.</strong> Check your read against <i>&tau;</i> &asymp; <i>R</i><sub>th</sub>&middot;<i>C</i><sub>th</sub>. The reference bench motor gives <i>&tau;</i> &asymp; <strong>114&nbsp;s</strong> (a first-order <i>R</i><sub>th</sub><i>C</i><sub>th</sub> product of ~104&nbsp;s); readings within the &plusmn;15% cursor tolerance pass.</li>
<li><strong>Explore mass effects.</strong> Note that a heavier motor (larger <i>C</i><sub>th</sub>) stretches <i>&tau;</i>, letting it absorb longer bursts before nearing its steady temperature.</li>
</ol>

<hr>

<h2>Stage 3: ESC Thermal Check (Module 2)</h2>

<h3>Objective</h3>
<p>Compute the ESC's MOSFET conduction loss and confirm the board stays under its 80&nbsp;&deg;C over-temperature limit.</p>

<h3>Step-by-Step Procedure</h3>
<ol>
<li><strong>Proceed to Module 2 &rarr; ESC Thermal Check.</strong> The viewport shows the ESC board with its live junction/case temperature.</li>
<li><strong>Run the load.</strong> Apply full throttle and let the ESC temperature settle. The readout shows the conduction loss <i>P</i><sub>esc</sub> = <i>I</i><sup>2</sup><i>R</i><sub>DS(on)</sub>&middot;[1 + (<i>I</i>/<i>I</i><sub>limit</sub>)<sup>2</sup>] and the resulting <i>T</i><sub>esc</sub>.</li>
<li><strong>Check survivability.</strong> Confirm <i>T</i><sub>esc</sub> stays below the hard <strong>80&nbsp;&deg;C</strong> limit — the reference bench build settles at a safe <strong>~28&nbsp;&deg;C</strong>. A green <code>ESC OK</code> indicates a pass.</li>
<li><strong>Force a failure (optional).</strong> Select a hard-pulling high-cell build that drives the ESC current toward its rating: the quadratic over-current penalty term dominates, <i>T</i><sub>esc</sub> exceeds 80&nbsp;&deg;C, and the check reports <code>ESC OVER-TEMP</code>.</li>
<li><strong>Interpret the result.</strong> Note that a correctly-sized motor can still fail this stage if the ESC behind it is undersized — the ESC must be rated (or cooled) for the current the motor actually pulls.</li>
</ol>

<hr>

<h2>Stage 4: Rotor-Wash &amp; Forced-Convection Cooling (Module 3)</h2>

<h3>Objective</h3>
<p>Quantify how cooling airflow and bolt-on cooling parts lower the effective thermal resistance and, with it, the steady operating temperature.</p>

<p><img src="./images/cooling_rth_reduction.png" alt="Effective thermal resistance falling with rotor-wash airflow and bolt-on cooling parts"></p>

<h3>Step-by-Step Procedure</h3>
<ol>
<li><strong>Proceed to Module 3 &rarr; Rotor-Wash Cooling.</strong> The viewport shows the motor/ESC with a cooling-airflow control and a drag-drop tray of cooling parts.</li>
<li><strong>Sweep the cooling airflow.</strong> Drag the <strong>Cooling Airflow</strong> (coolFactor) slider from 0 to 1. Watch <i>R</i><sub>th,eff</sub> and the steady temperature fall.</li>
<li><strong>Toggle the flight regime.</strong> Switch between <strong>Hover</strong> and <strong>Forward Flight</strong>. Confirm forward flight cuts <i>R</i><sub>th</sub> by <strong>15&ndash;25%</strong> versus only <strong>3&ndash;10%</strong> in hover — the craft cools far better when it sweeps clean air rather than recirculating its own exhaust.</li>
<li><strong>Fit cooling parts.</strong> Drag a <strong>Heatsink</strong> (&minus;30%), <strong>Ducted Fan</strong> (&minus;20%), or <strong>Thermal Pad</strong> (&minus;15%) onto the motor or ESC. They stack multiplicatively on top of the airflow reduction.</li>
<li><strong>Verify the combined effect.</strong> With forward flight + full airflow + a heatsink, confirm <i>R</i><sub>th,eff</sub> drops from 9.17 to about <strong>4.81&nbsp;&deg;C/W</strong> and the case steady temperature falls from ~64&nbsp;&deg;C toward ~46&nbsp;&deg;C.</li>
<li><strong>Complete the experiment.</strong> Once all four sub-experiments show a pass, the reward model unlocks under <strong>Components Unlocked</strong>, confirming completion of <strong>Experiment&nbsp;10</strong>.</li>
</ol>
