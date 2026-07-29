<h1>Lab Procedure: ESC Anatomy, Commissioning, Protocol Latency &amp; Thermal Sizing</h1>

<p>Four sub-experiments, two modules, one page. You start by taking the board apart, then you wire it up on a bench supply and commission it for real, and only after that do you get to characterise it. Module 2 stays locked until the commissioning is signed off, which is the same order a technician would work in.</p>

<table>
<thead><tr><th>Module</th><th>Sub-experiment</th><th>Reports</th></tr></thead>
<tbody>
<tr><td>Module 1 &middot; The ESC Board</td><td>Anatomy</td><td>components inspected</td></tr>
<tr><td>Module 1 &middot; The ESC Board</td><td>Commission</td><td>pulse-to-throttle map, % error</td></tr>
<tr><td>Module 2 &middot; Characterisation</td><td>Protocol &amp; Latency</td><td>&tau;, in ms</td></tr>
<tr><td>Module 2 &middot; Characterisation</td><td>Thermal &amp; Heatsink</td><td>junction temperature, &deg;C</td></tr>
</tbody>
</table>

<p>The usual three columns: inputs on the left, the 3D bench with its tabs in the middle, outputs on the right. The <strong>Diagnostics Log</strong> under the viewport catches wiring, current and thermal problems before they let you run, and the floating <strong>Lab Instructor</strong> keeps pace with the stage you are on.</p>

<hr>

<h2>Module 1 &middot; Anatomy</h2>

<h3>Objective</h3>
<p>Know what the board is made of before you power it. Every part on it exists for a reason, and the reasons are the syllabus.</p>

<p><img src="./images/esc_block_diagram.png" alt="ESC bench and signal block diagram"></p>

<ol>
<li>Pick an ESC platform from the tiles: 20 A, 30 A or 40 A single boards, or a 4-in-1 stack at 45 A or 60 A. The datasheet card fills in with its firmware, continuous and burst current, MOSFET count, R<sub>DS(on)</sub>, thermal resistance, board size and mass.</li>
<li>Left-drag to orbit and scroll to zoom. Then drag the <strong>Teardown</strong> slider and pull the board apart layer by layer.</li>
<li>Click each part &mdash; in the 3D view or in the teardown list &mdash; and read its entry in the <strong>Component Datasheet</strong>: what it is, what it does, and the design note that goes with it. There are nine: the FR4 substrate and solder mask, the power MOSFETs, the MCU and gate driver, the bulk electrolytic capacitor, the SMD passives, the signal connector, the battery power pads, the three phase pads, and the mounting grommets.</li>
<li>The datasheet tag counts you down (<em>7 / 9 viewed</em>). Inspect all nine and the stage signs itself off.</li>
</ol>

<p>Nothing runs in this stage. It is pure anatomy, and it is the only stage where nothing can go wrong.</p>

<hr>

<h2>Module 1 &middot; Commission</h2>

<h3>Objective</h3>
<p>Wire the circuit yourself, store the throttle endpoints, arm the ESC, and measure how far the real pulse-to-throttle response sits from the ideal straight line.</p>

<h3>About the supply</h3>

<p>The power source is a programmable bench DC supply, not a battery. You set its <strong>voltage</strong> (0&ndash;30 V) and its <strong>current limit</strong> on the left, and the front panel reads back what it is actually delivering. In <strong>CV</strong> the bus holds your set voltage. Ask for more current than the limit allows and it folds into <strong>CC</strong> &mdash; the display turns amber, the LED flips, and the bus voltage sags. That is exactly what real bench equipment does, and it matters in a moment.</p>

<ol>
<li>Set the <strong>Motor load</strong> and <strong>Propeller</strong> &mdash; the mechanical load the ESC has to drive &mdash; then dial in the supply voltage and current limit.</li>

<li>Wire the power side. Click the supply's red (+) binding post, then the ESC's red power pad; repeat for black (&minus;). There is no hint telling you which pad is which, because there is no hint on a real bench either.

<blockquote><p>Cross the polarity and the ESC dies instantly. A hobby ESC has no reverse-voltage protection and you replace the board. <em>Unless</em> you set a low current limit first &mdash; then the supply catches it in CC and the board survives. That is the entire reason a technician current-limits the bench before first power-up, and it is worth doing both ways.</p></blockquote>
</li>

<li>Wire the three phase leads, one ESC pad to one motor terminal, A/B/C. All three have to be connected one-to-one before the ESC can commutate; leave one off or double one up and the rotor just buzzes. Swap any two of the three and the motor runs backwards once it spins &mdash; the classic three-phase rule, and here it is computed from the wiring parity rather than scripted.</li>

<li>Click <strong>Store endpoints</strong>. The ESC records the 1000&ndash;2000 µs band and snaps the stick to idle.</li>

<li>Click <strong>Arm ESC</strong>. It will refuse until the power wiring is right, the endpoints are stored, and no calibration fault is active. Once armed the HUD reads ARMED.</li>

<li>Press <strong>&#9654; Run Sim</strong> to sweep the pulse across the full range. The motor spins live while the PWM oscilloscope plots the dashed blue <strong>Expected</strong> line against the amber <strong>Obtained</strong> curve. The gap includes this unit's own dead-band, which is seeded somewhere around 35&ndash;65 µs rather than a tidy 50. You can also drag the <strong>Pulse</strong> slider by hand at any point.</li>

<li>Try the faults. Pick one from <strong>Fault Injection</strong>, re-store the endpoints, and see what it does: <em>inverted endpoints</em> makes idle read near full throttle, <em>minimum too high</em> kills the bottom third of the stick, <em>noisy jitter</em> scatters the points. A stored fault blocks arming, the same way a real ESC refuses a bad calibration.</li>

<li>The verdict chip reports the map's RMS error against the ideal. Sign both Module 1 tabs off and Module 2 unlocks.</li>
</ol>

<p><img src="./images/pwm_signal_diagram.png" alt="PWM pulse-width signal timing"></p>

<hr>

<h2>Module 2 &middot; Protocol &amp; Latency</h2>

<h3>Objective</h3>
<p>See command latency as a visible delay rather than a number in a table, and stop confusing it with resolution.</p>

<ol>
<li>Open the tab. The live graph shows a blue command &mdash; your stick stepping up and down &mdash; and an amber ESC response trailing it by the protocol's latency &tau;.</li>
<li>Step through the <strong>Command protocol</strong> selector and run each one: Standard PWM 50 Hz, Fast PWM at 400 and 500 Hz, OneShot125, DShot300 and DShot600. Watch the amber trace chase the blue. At 50 Hz it lags about 20 ms. At 400 Hz that drops to roughly 2.5 ms. DShot lands almost on top of the command, in the tens of microseconds.</li>
<li>Now look at the <strong>Resolution</strong> chip while you do it. It stays at 1000 steps for every analog rate, because resolution comes from the timer tick, not the refresh rate. Faster PWM does not buy you finer control, only sooner control. DShot jumps to 2000 levels with no calibration and no dead-band at all, because it is sending a digital value instead of a pulse width.</li>
<li>The stage only signs off on a protocol under 5 ms. Standard PWM at 50 Hz is the deliberate "too slow" case &mdash; pick 400 Hz, OneShot or DShot to pass.</li>
</ol>

<p><img src="./images/resolution_latency_diagram.png" alt="Resolution and latency across ESC protocols"></p>

<hr>

<h2>Module 2 &middot; Thermal &amp; Heatsink</h2>

<h3>Objective</h3>
<p>Work out the conduction loss, find the current at which the junction reaches 80 &deg;C, and size the cooling to match.</p>

<p><img src="./images/esc_power_dissipation.png" alt="ESC power dissipation and junction temperature"></p>

<ol>
<li>Set the sustained load with the <strong>Hover</strong> and <strong>Full load</strong> presets &mdash; both seeded from the live motor operating point &mdash; and set the ambient temperature.</li>
<li>The Calculations chips update live: phase current, conduction loss <i>P</i> = <i>I</i><sup>2</sup>&middot;<i>R</i>(<i>T</i>), total loss including switching and capacitor terms, and junction temperature <i>T</i> = <i>T</i><sub>amb</sub> + <i>P</i>&middot;<i>R</i><sub>th</sub>. The MOSFETs on the 3D board glow with the junction temperature as it climbs.</li>
<li>Press <strong>&#9654; Run Sim</strong> and watch the temperature settle at 30&times; fast-forward. The run reports the current at which the junction would hit 80 &deg;C.</li>
<li>Read the verdict: <strong>Passive OK</strong> below that current, <strong>Heatsink required</strong> above it. On a 30 A board with R<sub>DS(on)</sub> near 3 m&Omega;, 25 A costs about 1.9 W and passes; 30 A costs about 2.7 W and does not.</li>
<li>Turn on <strong>Hot R(T)</strong>. Now R<sub>DS(on)</sub> climbs with temperature and the solver has to find a self-consistent hot operating point &mdash; higher resistance makes more heat, which raises the resistance again. Sometimes it does not converge, and the instructor calls that thermal runaway.</li>
<li>Turn on <strong>Heatsink</strong> and re-run. R<sub>th</sub> drops, the safe threshold current rises, and the hotspot falls back under the limit.</li>
</ol>

<p>With all four stages signed off, the reward component &mdash; a clamp-on heatsink &mdash; unlocks in the Outputs panel and the experiment is complete.</p>
