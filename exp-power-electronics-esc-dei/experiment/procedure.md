<h1>Lab Procedure: ESC Anatomy, Commission, Protocol Latency &amp; Thermal Sizing</h1>

<p>This document outlines the step-by-step workflow for <strong>Experiment 4: Power Electronics — ESC Anatomy, Commissioning, Protocol Latency &amp; Thermal Sizing</strong>. The experiment runs as a single research-grade bench across <strong>two modules and four stages</strong>. Module 1 covers the ESC's anatomy and its live commissioning on a bench <strong>DC power supply</strong>; Module 2 covers signal-protocol latency and thermal sizing.</p>

<p>The lab uses the standard three-column layout: <strong>Input Parameters</strong> (left), the <strong>3D bench viewport</strong> with module and stage tabs, live telemetry and the run row (centre), and <strong>Outputs</strong> — live graph, analysis charts and the unlocked-component reward (right). A floating <strong>Lab Instructor</strong> guides each step, and the <strong>Diagnostics Log</strong> flags any wiring, current or thermal fault before it lets you run.</p>

<blockquote>
<p><strong>Module 2 unlocks only after Module 1 · Commission is signed off.</strong> Inspecting the board (Tab 1) and commissioning it on the supply (Tab 2) are the gate to the characterisation module.</p>
</blockquote>

<hr>

<h2>Stage 1: Anatomy — The ESC Board (Module 1 &middot; Tab 1)</h2>

<h3>Objective</h3>
<p>Learn what an ESC is <em>made of</em> before commissioning it — identify every component on the board and the role it plays in turning a small throttle command into high-current three-phase motor power. Both a <strong>single</strong> arm-ESC and a <strong>4-in-1 stack</strong> are procedurally modelled to full board detail.</p>

<p><img src="./images/esc_block_diagram.png" alt="ESC Bench &amp; Signal Block Diagram"></p>

<h3>Step-by-Step Procedure</h3>
<ol>
<li><strong>Launch the simulator.</strong> It opens on <strong>Module 1 &middot; Anatomy</strong>, showing the ESC as a procedural 3D board (no live experiment here — this stage is pure anatomy).</li>
<li><strong>Pick an ESC platform</strong> from the ESC tile / option library (20 A / 30 A / 40 A single boards, or 4-in-1 45 A / 60 A stacks). The datasheet card lists its firmware, continuous / burst current, MOSFET count, conduction resistance <i>R</i><sub>DS(on)</sub>, thermal resistance, board size and mass.</li>
<li><strong>Move around the board.</strong> Left-drag to orbit, scroll to zoom. Drag the <strong>Teardown</strong> slider to pull the board apart layer by layer.</li>
<li><strong>Inspect every component.</strong> Click each part in the 3D view, or each entry in the <strong>Teardown</strong> list. For each part the <strong>Component Datasheet</strong> explains what it is, its role, and a design note. The components are: FR4 substrate + solder-mask, power MOSFETs, MCU / gate-driver, bulk electrolytic capacitor, SMD passives, signal connector, battery/supply power pads, three phase pads, and mounting grommets.</li>
<li><strong>Complete the tab.</strong> The datasheet tag counts your progress (e.g. <em>7 / 9 viewed</em>). Once every component has been inspected the stage is signed off.</li>
</ol>

<hr>

<h2>Stage 2: Commission — Wire the Bench, Then Map It (Module 1 &middot; Tab 2)</h2>

<h3>Objective</h3>
<p>Build the real circuit by hand — wire the bench <strong>DC supply</strong> to the ESC and the ESC to the motor in the 3D view — then store the throttle endpoints, arm the ESC, and map the <em>real</em> pulse&rarr;throttle response against the <em>ideal</em> straight line.</p>

<h3>The bench DC supply</h3>
<p>The power source is a <strong>stiff programmable DC supply</strong>, not a battery. Set its <strong>voltage</strong> (0–30 V) and <strong>current limit</strong> on the left; the front-panel displays read back the live output. In <strong>CV</strong> the bus holds your set voltage; if the load demands more than the current limit the supply folds into <strong>CC</strong> (the display turns amber and the LED flips) and the bus voltage sags — exactly like a real bench supply.</p>

<h3>Step-by-Step Procedure</h3>
<ol>
<li><strong>Open Module 1 &middot; Commission.</strong> Set the <strong>Motor load</strong> and <strong>Propeller</strong> (the mechanical load the ESC must drive), and dial in the <strong>supply voltage</strong> and <strong>current limit</strong>.</li>
<li><strong>Wire the power circuit.</strong> Click the supply's <strong>red (+)</strong> binding post, then the ESC's <strong>red power pad</strong>; repeat for the <strong>black (&minus;)</strong> post and pad. There is no hint for which pad is which — the wiring is as free-form as a real bench. <strong>Cross the polarity</strong> and the ESC is destroyed instantly (a hobby ESC has no reverse-voltage protection) and must be replaced — <em>unless</em> you set a low current limit first, in which case the supply catches it in CC and the board survives (the reason a technician current-limits the bench before first power-up).</li>
<li><strong>Wire the three phase leads.</strong> Connect each of the ESC's three phase pads (A / B / C) to the motor's three terminals. All three must be connected one-to-one before the ESC can commutate — a missing or doubled-up lead means the rotor just buzzes. Swap any <strong>two</strong> of the three and the motor spins in reverse once running (the classic three-phase rule, computed from the wiring parity).</li>
<li><strong>Store the endpoints.</strong> Click <strong>Store endpoints</strong> — the ESC records the 1000–2000 µs band and snaps the stick to idle.</li>
<li><strong>Arm at idle.</strong> Click <strong>Arm ESC</strong>. Arming is refused until the power wiring is correct, the endpoints are stored, and no calibration fault is active; once armed the HUD reads <strong>ARMED</strong>.</li>
<li><strong>Run the sweep.</strong> Click <strong>Run Sim</strong> to sweep the pulse across the full 1000–2000 µs range. The motor spins live and the <strong>PWM oscilloscope</strong> plots the dashed-blue <strong>Expected</strong> line against the amber <strong>Obtained</strong> curve — including this unit's own dead-band (seeded ~35–65 µs, not a fixed 50 µs) and any injected fault. You can also drag the <strong>Pulse</strong> slider by hand at any time.</li>
<li><strong>Try the fault scenarios.</strong> Use <strong>Fault Injection</strong> and re-store endpoints: <em>Inverted endpoints</em> (idle reads ~100%), <em>Minimum too high</em> (the low third of the stick is dead), <em>Noisy jitter</em> (points scatter). A stored fault blocks arming, exactly as a real ESC refuses a bad calibration.</li>
<li><strong>Sign off.</strong> The verdict chip reports the map RMS error against the ideal. With both Module 1 tabs complete, Module 2 unlocks.</li>
</ol>

<hr>

<h2>Stage 3: Protocol &amp; Latency (Module 2 &middot; Tab 1)</h2>

<h3>Objective</h3>
<p><em>See</em> command latency as a real, visible delay; separate latency from resolution; and choose a flight-ready signal protocol.</p>

<h3>Step-by-Step Procedure</h3>
<ol>
<li><strong>Open Module 2 &middot; Protocol &amp; Latency.</strong> The live graph shows a <strong>blue command</strong> (your stick stepping up and down) and an <strong>amber ESC response</strong> that trails it by the protocol's latency &tau;.</li>
<li><strong>Step through the protocols.</strong> Use the <strong>Command protocol</strong> selector — <em>Standard PWM 50 Hz</em>, <em>Fast PWM 400 / 500 Hz</em>, <em>OneShot125</em>, <em>DShot300 / 600</em> — and run it. Watch the amber response chase the blue command: <strong>50 Hz</strong> lags ~<strong>20 ms</strong>; <strong>400 Hz</strong> shrinks to ~<strong>2.5 ms</strong>; <strong>DShot</strong> snaps almost on top of the command (tens of microseconds).</li>
<li><strong>Separate resolution from latency.</strong> The <strong>Resolution</strong> chip stays at <strong>1000 steps</strong> for every analog rate — resolution is set by the timer tick, not the refresh rate. DShot jumps to <strong>2000 levels</strong> with no calibration and no dead-band.</li>
<li><strong>Lock in a flight-ready protocol.</strong> The stage signs off only on a protocol with latency <strong>under 5 ms</strong> — <em>Standard PWM 50 Hz is the deliberate "too slow" fault</em>. Choose 400 Hz, OneShot or DShot to pass.</li>
</ol>

<hr>

<h2>Stage 4: Thermal &amp; Heatsink Sizing (Module 2 &middot; Tab 2)</h2>

<h3>Objective</h3>
<p>Compute the ESC's conduction loss, run a thermal sweep to find the current at which the junction reaches 80 &deg;C, and size the cooling.</p>

<h3>Step-by-Step Procedure</h3>
<ol>
<li><strong>Open Module 2 &middot; Thermal &amp; Heatsink.</strong> Choose the sustained load with the <strong>Hover / Full load</strong> presets (seeded from the live motor operating point) and set the <strong>Ambient temp</strong>.</li>
<li><strong>Read the live derivations.</strong> The Calculations chips update live: <strong>Phase current</strong>, <strong>Conduction loss</strong> <i>P</i> = <i>I</i><sup>2</sup>&middot;<i>R</i>(<i>T</i>), <strong>total loss</strong> (+ switching + capacitor), and <strong>junction temperature</strong> <i>T</i> = <i>T</i><sub>amb</sub> + <i>P</i>&middot;<i>R</i><sub>th</sub>. The MOSFETs on the 3D board glow with the junction temperature.</li>
<li><strong>Run the sweep.</strong> Click <strong>Run Sim</strong> to watch the junction temperature climb to equilibrium (30&times; fast-forward). The <strong>80 &deg;C passive-current threshold</strong> is found and reported.</li>
<li><strong>Read the verdict.</strong> <strong>Passive OK</strong> below the limit, <strong>Heatsink required</strong> above it. For a 30 A ESC (<i>R</i> &asymp; 3 m&Omega;): at <strong>25 A</strong> &rarr; 1.9 W (passive OK); at <strong>30 A</strong> &rarr; 2.7 W (heatsink).</li>
<li><strong>Enable the hot-resistance model.</strong> Toggle <strong>Hot R(T)</strong> to let <i>R</i><sub>DS(on)</sub> climb with temperature and solve the self-consistent hot operating point. If it diverges the instructor calls out <strong>thermal runaway</strong>.</li>
<li><strong>Fit the heatsink and re-run.</strong> Toggle <strong>Heatsink</strong> to drop <i>R</i><sub>th</sub>: the safe threshold current rises and the hotspot falls back under the limit.</li>
<li><strong>Sign off.</strong> With all four stages signed off, the reward component (a clamp-on heatsink) unlocks in the Outputs panel, completing Experiment 4.</li>
</ol>
