<h1>Lab Procedure: GPS &amp; Barometric Navigation Characterization</h1>

<p>This document walks through the workflow for <strong>Navigation &amp; Positioning</strong>. The experiment spans three modules: <strong>Module 1: GPS Constellation</strong> (Constellation Geometry &amp; Accuracy), <strong>Module 2: Barometric Altimetry</strong> (ISA Altitude Profiling), and <strong>Module 3: Nav Synthesis</strong> (Error Budget Synthesis). Module 1's check has to pass before Modules 2 and 3 unlock; until then their tabs show a lock icon and are disabled.</p>

<hr>

<h2>Stage 1: Constellation Geometry &amp; Accuracy (Module 1)</h2>

<h3>Objective</h3>
<p>Build a GPS satellite constellation, drive its Horizontal/Vertical/Position Dilution of Precision (HDOP/VDOP/PDOP) into an acceptable range by controlling satellite count and sky geometry, and turn that geometry into a Circular Error Probable (CEP) distance using the receiver's ranging error. A single run grades both halves: the geometry solve and the metres of scatter it produces.</p>

<h3>Step-by-Step Procedure</h3>
<ol>
<li><strong>Launch the simulator.</strong> Open the virtual lab page. It loads by default into <strong>Module 1 &middot; GPS Accuracy</strong>, experiment <strong>Constellation Geometry &amp; Accuracy</strong>.</li>
<li><strong>Read the Constellation card.</strong> In the left-hand Input Parameters column, find the <strong>Constellation &middot; GPS sky</strong> card. It shows a live <code>HDOP</code> badge and a mini readout of <code>VDOP</code>, <code>PDOP</code>, and <code>CEP</code> that updates as you change the geometry.</li>
<li><strong>Adjust satellite count.</strong> Drag the <strong>Satellites</strong> slider (range 4&ndash;12). Below 4 satellites the Diagnostics Log reports a blocking error ("No GPS fix - only <i>N</i> satellites in view; a 3-D + clock solution needs at least 4.") and the <strong>Run Sim</strong> button is disabled.</li>
<li><strong>Try the geometry presets.</strong> Click through the four preset buttons: <strong>Spread</strong> (good geometry), <strong>Clustered</strong> (one tight sky cone), <strong>Wall</strong> (spread azimuth but all high-elevation), and <strong>Line</strong> (near-collinear). Watch the HDOP badge react: Spread gives the lowest HDOP, Clustered and Line drive it up sharply, and Wall keeps HDOP deceptively low while VDOP balloons.</li>
<li><strong>Open the sky-plot editor.</strong> Click <strong>Edit sky-plot (drag satellites)</strong>. A modal opens with a polar sky-plot (elevation 90&deg; at the centre, the horizon at the rim, azimuth 0&deg;/N pointing up, clockwise). Drag any numbered satellite dot to a new position; HDOP/VDOP/PDOP/GDOP and CEP in the side readout update live as you drag. Releasing a dragged satellite detaches the constellation from its named preset (shown as "custom").</li>
<li><strong>Select a ranging scenario.</strong> In the <strong>Sensor &amp; Atmosphere</strong> card, use the <strong>Ranging (UERE)</strong> segmented control to pick <strong>Open-sky</strong> (UERE = 3.0 m) or <strong>Urban</strong> (UERE = 7.5 m, multipath). CEP = HDOP &times; UERE, so the card's CEP readout updates right away.</li>
<li><strong>Run the check.</strong> Once the Constellation card shows HDOP under 2 (and VDOP is not flagged), click <strong>Run Sim</strong>. The run plots roughly 50 individual GPS fixes scattered around true position, each drawn from a Rayleigh radial distribution whose median radius equals the current CEP. The telemetry strip's <code>phase</code> field settles to <code>FIX LOCKED</code>, or to <code>GEOMETRY POOR</code> / <code>MULTIPATH</code> / <code>DEGRADED</code> / <code>NO FIX</code>.</li>
<li><strong>Read the verdict.</strong> After the run, a toast reports one of: <code>"GPS LOCK - HDOP &lt;value&gt;, CEP &lt;value&gt; m within spec"</code> (pass, HDOP &lt; 2 <em>and</em> CEP &lt; 4 m), <code>"Good HDOP but VDOP &lt;value&gt; - 2D DOP hides vertical dilution"</code> (fail, the Wall trap), <code>"Poor geometry - HDOP &lt;value&gt;, fix wanders"</code> (fail, HDOP &gt; 4), <code>"Multipath - HDOP &lt;value&gt; but CEP &lt;value&gt; m, position unreliable"</code> (fail, urban ranging), <code>"Accuracy out of spec - HDOP &lt;value&gt;, CEP &lt;value&gt; m"</code> (fail, CEP &ge; 4 m), <code>"Marginal geometry - HDOP &lt;value&gt;, accuracy degraded"</code> (fail, HDOP 2&ndash;4), or <code>"No fix - insufficient/degenerate geometry"</code> (fail, singular or &lt;4 satellites). Only a PASS here unlocks Modules 2 and 3.</li>
<li><strong>Compare scenarios.</strong> Re-run with the other UERE setting and note how the fix cloud visibly balloons outward under the urban scenario for the same constellation geometry.</li>
</ol>

<hr>

<h2>Stage 2: ISA Altitude Profiling (Module 2)</h2>

<h3>Objective</h3>
<p>Profile a barometric altimeter's error against true altitude across a 0&ndash;3000 m sweep, for two sensor grades and with an optional temperature-inversion fault injected.</p>

<h3>Step-by-Step Procedure</h3>
<ol>
<li><strong>Unlock and enter Module 2.</strong> Once Stage 1's Constellation Geometry check has passed, the <strong>Module 2 &middot; ISA Altitude</strong> tab unlocks. Click it to open the <strong>ISA Altitude Profiling</strong> experiment.</li>
<li><strong>Choose a sensor grade.</strong> In the <strong>Sensor &amp; Atmosphere</strong> card, use the <strong>Barometer</strong> segmented control to select <strong>Fine</strong> (MS5611-class) or <strong>Coarse</strong> (BMP180-class). The card's badge shows the current 1&sigma; altitude error (<code>&plusmn;X m</code>) at the True Altitude slider's current setting.</li>
<li><strong>Toggle the temperature-inversion fault.</strong> Check the <strong>Temperature inversion (systematic bias)</strong> checkbox to inject a height-proportional altitude bias, standing in for a warm near-ground air layer the sensor's ISA model does not account for.</li>
<li><strong>Run the sweep.</strong> Click <strong>Run Sim</strong>. Unlike the other experiments, this run ignores the True Altitude slider and automatically sweeps true altitude from 0 m to 3000 m over the run window, plotting sensed-minus-true altitude error against true altitude live. The telemetry <code>phase</code> field reads <code>SWEEPING</code>, or <code>COARSE SCATTER</code> / <code>INVERSION BIAS</code> if those faults are active.</li>
<li><strong>Read the verdict.</strong> The toast reports <code>"ISA profile good - X.X m @500 m rising to X.X m @3000 m"</code> (pass, fine sensor, no inversion, peak error under 3.5 m), <code>"Coarse barometer - &plusmn;X.X m altitude noise"</code> (fail), <code>"Temperature inversion - altitude biased by &plusmn;X.X m"</code> (fail), or <code>"Altitude error high - X.X m peak, exceeds ISA prediction"</code> (fail).</li>
<li><strong>Compare the curve shape.</strong> Re-run with each combination of sensor grade and inversion toggle and compare the plotted error-vs-altitude curves: the fine sensor's error grows gently and smoothly with height (from the pressure-sensitivity term alone), while the inversion fault produces a much steeper, systematic climb.</li>
</ol>

<hr>

<h2>Stage 3: Error Budget Synthesis (Module 3)</h2>

<h3>Objective</h3>
<p>Combine the horizontal CEP from Module 1 and the vertical altitude error from Module 2 into a single 3-D navigation error radius, and decide whether the resulting fix is safe for autonomous flight near an obstacle.</p>

<h3>Step-by-Step Procedure</h3>
<ol>
<li><strong>Enter Module 3.</strong> Click the <strong>Module 3 &middot; Nav Synthesis</strong> tab to open <strong>Error Budget Synthesis</strong>.</li>
<li><strong>Confirm your inputs.</strong> This module reads the constellation, ranging scenario, sensor grade, and True Altitude slider exactly as you set them in Modules 1 and 2; there are no new controls. Adjust any of them and the telemetry updates live.</li>
<li><strong>Run the synthesis.</strong> Click <strong>Run Sim</strong>. The 3D viewport grows two overlapping error markers toward their steady-state size, a horizontal disc sized to CEP and a vertical extent sized to the barometric error, while the telemetry <code>phase</code> field reads <code>SAFE ENVELOPE</code> or <code>UNSAFE - DRIFTING</code>.</li>
<li><strong>Read the verdict.</strong> The toast reports <code>"Safe for autonomous - X.X m 3D error"</code> (pass, combined radius under 5 m) or <code>"Unsafe - X.X m 3D error, drifts toward obstacle"</code> (fail, 5 m or more).</li>
<li><strong>Inspect the full derivation.</strong> Click the <strong>Calculations</strong> card to open the detailed breakdown modal, which shows the exact HDOP/CEP computation, the ISA altitude-error computation, and the final <code>Total = &radic;(CEP&sup2; + h_err&sup2;)</code> step with your current numbers substituted in.</li>
<li><strong>Complete the lab.</strong> A pass here (with Stages 1&ndash;3 already passed) completes the experiment and unlocks the GPS Module reward, shown in the <strong>Components Unlocked</strong> panel on the right.</li>
</ol>
