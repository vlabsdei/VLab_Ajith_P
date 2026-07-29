<h1>Lab Procedure: GPS &amp; Barometric Navigation Characterization</h1>

<p>Three modules, run in order. You build a satellite constellation and turn its geometry into metres of position error; you profile a barometer against true altitude; then you combine the two into a single 3-D error radius and decide whether an autopilot could safely fly on it. Modules 2 and 3 stay locked until Module 1 passes &mdash; their tabs carry a lock icon and will not open.</p>

<table>
<thead><tr><th>Module</th><th>Sub-experiment</th><th>Reports</th></tr></thead>
<tbody>
<tr><td>Module 1 &middot; GPS Accuracy</td><td>Constellation Geometry &amp; Accuracy</td><td>HDOP and CEP, in m</td></tr>
<tr><td>Module 2 &middot; ISA Altitude</td><td>ISA Altitude Profiling</td><td>barometric error, in m</td></tr>
<tr><td>Module 3 &middot; Nav Synthesis</td><td>Error Budget Synthesis</td><td>3-D error radius, in m</td></tr>
</tbody>
</table>

<hr>

<h2>Module 1 &middot; Constellation Geometry &amp; Accuracy</h2>

<h3>Objective</h3>
<p>Build a satellite geometry good enough to fix position, then turn that geometry into an actual distance on the ground. One run grades both halves.</p>

<p><img src="./images/constellation_geometry_diagram.png" alt="Satellite constellation geometry and dilution of precision"></p>

<ol>
<li>Find the <strong>Constellation &middot; GPS sky</strong> card in the left column. It carries a live HDOP badge and a smaller readout of VDOP, PDOP and CEP that tracks every change you make.</li>

<li>Drag the <strong>Satellites</strong> slider (4 to 12). Below four the Diagnostics Log blocks the run outright &mdash; a 3-D position plus a clock bias is four unknowns, and you cannot solve four unknowns with three ranges.</li>

<li>Work through the four geometry presets and watch the HDOP badge react:
  <ul>
  <li><strong>Spread</strong> &mdash; satellites well distributed, and the lowest HDOP you will get.</li>
  <li><strong>Clustered</strong> &mdash; all in one tight cone of sky, and HDOP climbs sharply.</li>
  <li><strong>Line</strong> &mdash; near-collinear, which is close to degenerate.</li>
  <li><strong>Wall</strong> &mdash; spread in azimuth but all high in elevation. This is the interesting one: HDOP stays deceptively low while VDOP balloons. Good horizontal geometry can hide terrible vertical geometry, and a 2-D DOP number will not tell you.</li>
  </ul>
</li>

<li>Click <strong>Edit sky-plot (drag satellites)</strong> for the polar editor &mdash; elevation 90&deg; at the centre, horizon at the rim, azimuth 0&deg;/north pointing up and running clockwise. Drag any numbered satellite and all four DOP figures plus CEP update as you move it. Once you drag one, the constellation detaches from its preset and shows as "custom".</li>

<li>Pick a ranging scenario in the <strong>Sensor &amp; Atmosphere</strong> card: <strong>Open-sky</strong> at UERE = 3.0 m, or <strong>Urban</strong> at 7.5 m with multipath. CEP = HDOP &times; UERE, so the readout moves the moment you switch.</li>

<li>With HDOP under 2 and VDOP unflagged, press <strong>&#9654; Run Sim</strong>. The run plots around fifty individual fixes scattered about the true position, each drawn from a Rayleigh radial distribution whose median radius is the current CEP. The telemetry phase settles to <code>FIX LOCKED</code>, or to <code>GEOMETRY POOR</code>, <code>MULTIPATH</code>, <code>DEGRADED</code> or <code>NO FIX</code>.</li>
</ol>

<p><img src="./images/cep_rayleigh_diagram.png" alt="Circular error probable and the Rayleigh scatter of GPS fixes"></p>

<h3>Reading the verdict</h3>

<p>Only a pass here unlocks Modules 2 and 3, and it needs both HDOP &lt; 2 <em>and</em> CEP &lt; 4 m. The failures each name their own cause:</p>

<ul>
<li><strong>GPS LOCK</strong> &mdash; both conditions met.</li>
<li><strong>Good HDOP but VDOP &hellip;</strong> &mdash; the Wall trap. Horizontal geometry passed, vertical did not.</li>
<li><strong>Poor geometry</strong> (HDOP &gt; 4) or <strong>Marginal geometry</strong> (HDOP 2&ndash;4) &mdash; the fix wanders.</li>
<li><strong>Multipath</strong> &mdash; HDOP is fine, but urban ranging error alone pushes CEP out of spec.</li>
<li><strong>Accuracy out of spec</strong> &mdash; CEP &ge; 4 m for some other combination of the two.</li>
<li><strong>No fix</strong> &mdash; singular geometry, or fewer than four satellites.</li>
</ul>

<p>Re-run the same constellation with the other UERE setting and watch the fix cloud balloon. Identical geometry, worse environment &mdash; that is the multipath term doing all of it.</p>

<hr>

<h2>Module 2 &middot; ISA Altitude Profiling</h2>

<h3>Objective</h3>
<p>Profile a barometric altimeter's error against true altitude, for two sensor grades, with and without a temperature inversion.</p>

<p><img src="./images/baro_altitude_error_diagram.png" alt="Barometric altitude error growing with height"></p>

<ol>
<li>Pick a sensor grade in the <strong>Sensor &amp; Atmosphere</strong> card: <strong>Fine</strong> (MS5611-class) or <strong>Coarse</strong> (BMP180-class). The badge shows the 1&sigma; altitude error at whatever the True Altitude slider is currently set to.</li>

<li>Optionally tick <strong>Temperature inversion (systematic bias)</strong>. This injects a height-proportional bias, standing in for a warm layer of air near the ground that the sensor's ISA model does not know about.</li>

<li>Press <strong>&#9654; Run Sim</strong>. This run ignores the True Altitude slider &mdash; it sweeps altitude from 0 to 3000 m over the run window and plots sensed-minus-true error against true altitude live. The phase reads <code>SWEEPING</code>, or <code>COARSE SCATTER</code> / <code>INVERSION BIAS</code> when those faults are active.</li>

<li>A pass needs the fine sensor, no inversion, and a peak error under 3.5 m. The verdict quotes the error at 500 m and again at 3000 m so you can see how it grows.</li>

<li>Re-run every combination and compare the curve shapes. The fine sensor's error grows gently and smoothly with height, which is the pressure-sensitivity term on its own. The inversion produces something quite different: a steep, systematic climb. Random noise and a systematic bias look nothing alike on this plot, and that is the point of running all four.</li>
</ol>

<hr>

<h2>Module 3 &middot; Error Budget Synthesis</h2>

<h3>Objective</h3>
<p>Combine the horizontal and vertical errors into one number, and decide whether it is safe to fly near an obstacle.</p>

<p><img src="./images/nav3d_error_budget_diagram.png" alt="Horizontal CEP and vertical barometric error combined into a 3-D error radius"></p>

<ol>
<li>This module has no new controls. It reads the constellation, the ranging scenario, the sensor grade and the True Altitude slider exactly as you left them in Modules 1 and 2, and the telemetry updates live if you change any of them.</li>

<li>Press <strong>&#9654; Run Sim</strong>. Two error markers grow in the 3-D viewport toward their steady size &mdash; a horizontal disc sized to CEP, and a vertical extent sized to the barometric error. The phase reads <code>SAFE ENVELOPE</code> or <code>UNSAFE &mdash; DRIFTING</code>.</li>

<li>The verdict passes under a 5 m combined radius and fails at or above it, in which case it says the fix drifts toward the obstacle.</li>

<li>Open the <strong>Calculations</strong> card for the full chain: the HDOP and CEP computation, the ISA altitude error, and the final Total = &radic;(CEP&sup2; + h_err&sup2;), with your current numbers in place.</li>
</ol>

<p>That root-sum-square is worth sitting with. Two errors that each look acceptable on their own combine into one that is not, and a budget like this is the only way to see it coming. A pass here completes the lab and unlocks the GPS module under <strong>Components Unlocked</strong>.</p>
