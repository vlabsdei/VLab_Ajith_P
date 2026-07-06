<h1>Theoretical Background: ESC Power Electronics &amp; PWM Control</h1>

<p>The Electronic Speed Controller (ESC) is the power-electronic bridge between the flight controller's small digital command signal and the high-current three-phase power that spins a brushless DC (BLDC) motor. This experiment treats the ESC as both a <strong>signal-processing device</strong> (how a throttle command is encoded, quantised and refreshed) and a <strong>power-conversion device</strong> (how much of the battery energy it turns into waste heat). Getting either wrong is a direct cause of failed arming, sluggish control, or in-flight thermal failure. The experiment follows the ESC from the inside out: a <strong>component explorer</strong> (the board's anatomy), a <strong>calibrate-and-commission</strong> stage that maps the real pulse&rarr;throttle response against the ideal (Expected vs Obtained), a <strong>protocol-and-latency</strong> stage that makes command delay visible, and a <strong>thermal sweep</strong> that sizes the cooling.</p>

<p>Before working through the underlying physics, the animation below walks through the full ESC story — from the board's anatomy and the servo-PWM throttle pulse, through the arming dead-band, the resolution-versus-latency distinction and the DShot digital protocol, to the <i>I</i><sup>2</sup><i>R</i> conduction loss and the thermal limit that decides whether a heatsink is needed.</p>

<p align="center">
  <video controls playsinline preload="metadata" width="100%" style="max-width: 860px; border-radius: 8px;">
    <source src="./videos/power_electronics_esc.mp4" type="video/mp4">
    Your browser does not support the HTML5 video tag. You can
    <a href="./videos/power_electronics_esc.mp4">download the video</a> instead.
  </video>
</p>

<hr>

<h2>1. The Servo-PWM Throttle Signal (Sub-Calc A)</h2>

<p>Classic ESCs accept a <strong>pulse-width-modulated (PWM)</strong> servo signal. Every refresh period the flight controller raises the signal line high for a short interval; the <strong>width</strong> of that high pulse — not its frequency or voltage — encodes the throttle command. By the long-standing RC convention:</p>

<ul>
<li>A <strong>1000 &micro;s</strong> (1.0 ms) pulse = <strong>0% throttle</strong> (motor idle / armed).</li>
<li>A <strong>2000 &micro;s</strong> (2.0 ms) pulse = <strong>100% throttle</strong> (full power).</li>
</ul>

<p>The linear map from pulse width (<i>PW</i>) to throttle command is therefore:</p>

<p align="center"><b>Throttle% = <sup>(<i>PW</i> - <i>PW</i><sub>min</sub>)</sup> &frasl; <sub>(<i>PW</i><sub>max</sub> - <i>PW</i><sub>min</sub>)</sub> &times; 100</b></p>

<p>Where:</p>
<ul>
<li><i>PW</i> is the measured pulse width [&micro;s].</li>
<li><i>PW</i><sub>min</sub> = 1000 &micro;s and <i>PW</i><sub>max</sub> = 2000 &micro;s are the calibrated throttle endpoints.</li>
<li><i>PW</i><sub>range</sub> = <i>PW</i><sub>max</sub> &minus; <i>PW</i><sub>min</sub> = 1000 &micro;s is the active control band.</li>
</ul>

<p><strong>Calibration</strong> is the one-time procedure of teaching the ESC exactly which pulse widths correspond to 0% and 100%, so that every ESC on the aircraft responds identically to the same stick position. An un-calibrated or mis-calibrated ESC is the root cause of the two classic failures: <i>"a motor refuses to arm"</i> (its <i>PW</i><sub>min</sub> is set above the controller's idle pulse) and <i>"a motor spins up to full power the instant the battery is plugged in"</i> (its endpoints are inverted or unset).</p>

<p><img src="./images/pwm_signal_diagram.png" alt="ESC PWM Signal and Throttle Mapping"></p>

<h3>Worked Example — Throttle-to-PWM Mapping</h3>

<p>A flight controller running standard servo PWM emits the five calibration pulses 1000, 1250, 1500, 1750 and 2000 &micro;s into a freshly calibrated 30 A ESC (<i>PW</i><sub>min</sub> = 1000 &micro;s, <i>PW</i><sub>max</sub> = 2000 &micro;s). Applying the mapping formula at each point:</p>

<table>
<thead>
<tr><th>Pulse Width <i>PW</i> (&micro;s)</th><th>Substitution</th><th>Throttle%</th></tr>
</thead>
<tbody>
<tr><td>1000</td><td>(1000 &minus; 1000) / 1000 &times; 100</td><td><b>0%</b></td></tr>
<tr><td>1250</td><td>(1250 &minus; 1000) / 1000 &times; 100</td><td><b>25%</b></td></tr>
<tr><td>1500</td><td>(1500 &minus; 1000) / 1000 &times; 100</td><td><b>50%</b></td></tr>
<tr><td>1750</td><td>(1750 &minus; 1000) / 1000 &times; 100</td><td><b>75%</b></td></tr>
<tr><td>2000</td><td>(2000 &minus; 1000) / 1000 &times; 100</td><td><b>100%</b></td></tr>
</tbody>
</table>

<p>The neutral 1500 &micro;s pulse maps to exactly <b>50%</b> throttle, confirming the calibration is symmetric. The inverse relation, <i>PW</i> = <i>PW</i><sub>min</sub> + (Throttle%/100) &middot; <i>PW</i><sub>range</sub>, lets the controller convert a desired throttle back to a pulse — e.g. a 75% command becomes a 1750 &micro;s pulse. This linear, monotone map is the contract every ESC on the aircraft must honour after calibration.</p>

<hr>

<h2>2. The Arming Dead-Band &amp; Real Calibration Errors (Sub-Calc A)</h2>

<p>A real ESC does not begin spinning the motor the instant the pulse rises above 1000 &micro;s. A small <strong>dead-band</strong> is enforced at the bottom of the throttle range so that signal jitter, electrical noise, or a transmitter trim a few microseconds off-zero cannot creep the propeller while the aircraft is armed on the ground. By convention the dead-band spans the first ~50 &micro;s:</p>

<p align="center">Throttle<sub>effective</sub> = 0 &nbsp; for &nbsp; <i>PW</i> &le; (<i>PW</i><sub>min</sub> + <i>PW</i><sub>deadband</sub>) = 1050 &micro;s</p>

<p align="center">Throttle<sub>effective</sub> = <sup>(<i>PW</i> - <i>PW</i><sub>min</sub>)</sup> &frasl; <sub><i>PW</i><sub>range</sub></sub> &times; 100 &nbsp; for &nbsp; <i>PW</i> &gt; 1050 &micro;s</p>

<p>The raw <i>linear</i> mapping of Section 1 still applies above the dead-band; the dead-band is a separate safety gate that forces the lowest 5% of the commanded range to a guaranteed zero-spin idle.</p>

<blockquote>
<p><strong>As-manufactured variance.</strong> The 50 &micro;s figure above is the textbook nominal. A real ESC's arm point scatters unit-to-unit with firmware and component tolerance — the simulator seeds each ESC's dead-band deterministically in the &asymp;35&ndash;65 &micro;s range (&plusmn;30% of nominal) from its part ID, so the exact edge you find by stepping the pulse is a property of <i>that</i> physical board, not a constant you can look up. An <strong>uncalibrated</strong> unit (endpoints never stored) shifts the whole arm window a further +80 &micro;s up the stick — precisely the "why a technician always re-verifies dead-band after a firmware flash" lesson.</p>
</blockquote>

<h3>Worked Example — Dead-Band Verification</h3>

<p>The same ESC is now probed with pulses inside and just above the dead-band:</p>

<table>
<thead>
<tr><th>Pulse Width <i>PW</i> (&micro;s)</th><th>Raw map (Section 1)</th><th>Dead-band gate</th><th>Effective Throttle%</th></tr>
</thead>
<tbody>
<tr><td>1000</td><td>0%</td><td>&le; 1050 &rarr; 0</td><td><b>0%</b> (armed, still)</td></tr>
<tr><td>1025</td><td>2.5%</td><td>&le; 1050 &rarr; 0</td><td><b>0%</b> (still)</td></tr>
<tr><td>1050</td><td>5.0%</td><td>&le; 1050 &rarr; 0</td><td><b>0%</b> (dead-band edge)</td></tr>
<tr><td>1100</td><td>10.0%</td><td>&gt; 1050 &rarr; pass</td><td><b>10%</b> (motor spins)</td></tr>
</tbody>
</table>

<p>Every pulse from 1000 &micro;s up to and including 1050 &micro;s yields <b>0% effective throttle</b> — the rotor stays stationary. The motor only begins to turn once the pulse clears the 1050 &micro;s dead-band edge. This 50 &micro;s guard band is exactly what prevents an armed, idling quadcopter from creeping its propellers, and verifying it is a mandatory pre-flight safety check.</p>

<h3>Expected vs Obtained — Why the Real Curve Deviates</h3>

<p>A calibration is only trustworthy once you have <i>seen</i> how the <strong>real</strong> ESC response compares with the <strong>ideal</strong> linear map. Plotting both — the assumed straight line (<strong>Expected</strong>) and the measured pulse&rarr;throttle points (<strong>Obtained</strong>) — exposes the real-world departures the calibrate-and-commission stage lets you reproduce:</p>

<ul>
<li><strong>Dead-band (always present).</strong> As derived above, the first ~50 &micro;s above idle map to a flat 0%. On the Expected-vs-Obtained chart this is the segment where the Obtained curve hugs zero while the ideal line has already lifted off — the dominant deviation near idle, and a <i>correct</i> one.</li>
<li><strong>Inverted endpoints.</strong> If the endpoints are stored backwards (<i>PW</i><sub>min</sub> = 2000 &micro;s, <i>PW</i><sub>max</sub> = 1000 &micro;s — the stick held the wrong way during the teach-in), the map runs backwards: a 1000 &micro;s idle pulse now reads <strong>100%</strong>. The Obtained curve slopes opposite to the ideal — the classic "motor spins to full the instant the battery is plugged in" hazard.</li>
<li><strong>Minimum endpoint too high.</strong> If the stored minimum sits above the receiver's idle (e.g. <i>PW</i><sub>min</sub> = 1300 &micro;s), every pulse below ~1350 &micro;s is dead and the live stick is compressed into 1300–2000 &micro;s. The Obtained curve stays flat far longer, then ramps steeply — lost low-end resolution, and a motor that may never idle cleanly.</li>
<li><strong>Receiver jitter / capture quantisation.</strong> A real RC link wobbles the pulse by a few microseconds and the ESC quantises it to its capture resolution, so repeated samples of the same command scatter by a fraction of a percent. The Obtained points sit <i>near</i> — not exactly on — the true curve; that scatter is the precision floor of an analog PWM link.</li>
</ul>

<p>A correctly calibrated, jitter-free channel collapses the Obtained curve back onto the Expected line everywhere except the intentional idle dead-band. Quantifying the <strong>RMS</strong> and <strong>worst-case</strong> error between the two curves is the deliverable Module 1 hands to the flight-control loops of Experiment 5.</p>

<hr>

<h2>3. Control Resolution vs Refresh Frequency (Sub-Calc B)</h2>

<p>Two completely different quantities are often confused when discussing PWM signals: how <i>finely</i> the throttle can be commanded (<strong>resolution</strong>) and how <i>often</i> a new command is delivered (<strong>refresh rate / latency</strong>). The experiment's central pedagogical goal is to separate them.</p>

<h3>Command Resolution (set by the timer tick)</h3>
<p>The pulse width is generated by a hardware timer counting at a fixed clock. With a 1 MHz timer the smallest representable change in pulse width is one <strong>tick</strong> = 1 &micro;s. The number of distinct throttle commands across the active band is therefore:</p>

<p align="center"><b><i>N</i><sub>steps</sub> = <sup><i>PW</i><sub>range</sub></sup> &frasl; <sub><i>t</i><sub>tick</sub></sub> = <sup>1000 &micro;s</sup> &frasl; <sub>1 &micro;s</sub> = 1000 steps</b></p>

<p align="center">Resolution = <sup>100%</sup> &frasl; <sub><i>N</i><sub>steps</sub></sub> = 0.1% per step</p>

<p>Crucially, <i>N</i><sub>steps</sub> depends <strong>only</strong> on the timer tick and the pulse band — <strong>not</strong> on the refresh frequency.</p>

<h3>Refresh Latency (set by the frequency)</h3>
<p>The refresh frequency <i>f</i> determines how often a fresh pulse (a fresh command) reaches the ESC. The worst-case command latency is one refresh period:</p>

<p align="center"><b>&tau;<sub>latency</sub> = <sup>1</sup> &frasl; <sub><i>f</i></sub></b></p>

<p>The fraction of each frame occupied by the pulse — the <strong>duty</strong> the ESC sees — is <i>PW</i>/<i>T</i><sub>period</sub>, which <i>does</i> change with frequency.</p>

<h3>The Misconception this Corrects</h3>
<p>A widespread belief in drone forums is that <i>"a higher PWM frequency gives finer throttle control."</i> This is <strong>false</strong>. Raising the frequency from 50 Hz to 400 Hz does <strong>not</strong> add a single extra throttle step — both still resolve 1000 microsecond steps (0.1%). What it changes is <strong>latency</strong>: the controller can correct the motor eight times more often. Higher frequency buys <i>responsiveness</i>, not <i>resolution</i>.</p>

<p>The simulator makes this latency tangible rather than abstract: it draws a <strong>blue command</strong> trace (your stick) and an <strong>amber ESC-response</strong> trace that trails it by exactly &tau;<sub>latency</sub>. At 50 Hz the amber response visibly lags the blue command by a full 20 ms; at 400 Hz the gap shrinks to 2.5 ms; with DShot it is effectively instantaneous. A control loop can only react after the response has caught up, so a flight-ready channel must keep that lag small — the protocol stage will not sign off on the 20 ms (50 Hz) link.</p>

<p><img src="./images/resolution_latency_diagram.png" alt="Resolution vs Latency at 50 Hz and 400 Hz"></p>

<h3>Worked Example — 50 Hz vs 400 Hz</h3>

<table>
<thead>
<tr><th>Quantity</th><th>50 Hz (legacy)</th><th>400 Hz (fast PWM)</th></tr>
</thead>
<tbody>
<tr><td>Refresh period <i>T</i> = 1/<i>f</i></td><td>20 000 &micro;s (20 ms)</td><td>2 500 &micro;s (2.5 ms)</td></tr>
<tr><td>Command latency &tau;</td><td><b>20 ms</b></td><td><b>2.5 ms</b></td></tr>
<tr><td>Timer tick</td><td>1 &micro;s</td><td>1 &micro;s</td></tr>
<tr><td>Steps <i>N</i><sub>steps</sub> = 1000&micro;s / 1&micro;s</td><td><b>1000 (0.1%/step)</b></td><td><b>1000 (0.1%/step)</b></td></tr>
<tr><td>Pulse duty (1000–2000&micro;s)</td><td>5% – 10%</td><td>40% – 80%</td></tr>
</tbody>
</table>

<p>Moving from 50 Hz to 400 Hz cuts the command latency by a factor of <b>20 ms / 2.5 ms = 8&times;</b> while the throttle resolution is <strong>identical</strong> (1000 steps, 0.1% each). The only visible change to the signal itself is the duty cycle: at 50 Hz the active pulse fills just 5–10% of the long frame, whereas at 400 Hz it fills 40–80% of the short frame. The 8&times; latency reduction is the real flight benefit — faster disturbance rejection by the control loops of Experiment 5 — and it has nothing to do with resolution.</p>

<hr>

<h2>4. Digital Protocols — Decoupling Resolution from Refresh</h2>

<p>Analog PWM hits a wall at ~500 Hz, where the 2000 &micro;s maximum pulse completely fills the 2000 &micro;s frame (100% duty), leaving no idle gap. Modern <strong>digital</strong> protocols such as <strong>DShot</strong> sidestep this entirely: instead of an analog pulse width, they transmit a 16-bit frame containing an <strong>11-bit throttle word</strong> (2048 codes, 2000 usable) plus a checksum, clocked at a fixed bitrate.</p>

<p align="center">Frame time = <sup>frame bits</sup> &frasl; <sub>bitrate</sub></p>

<p>For <strong>DShot600</strong> (600 kbit/s, 16-bit frame): frame time = 16 / 600000 = <b>26.7 &micro;s</b>, giving ~2000 throttle levels delivered every 26.7 &micro;s. DShot therefore offers both higher resolution (2000 vs 1000 levels) <strong>and</strong> far lower latency than analog PWM, and because the throttle is a digital integer it needs <strong>no endpoint calibration and no dead-band</strong> — the values 0 and 2047 are exact by definition. This is why digital protocols have largely replaced analog PWM on performance multirotors, and it cleanly illustrates that resolution and refresh are independent design axes.</p>

<hr>

<h2>5. ESC Conduction Power Dissipation (Sub-Calc C)</h2>

<p>As a power-conversion device, the ESC switches the battery current through three pairs of power MOSFETs to commutate the motor. Even a "perfect" switch has a small on-state resistance <i>R</i><sub>DS(on)</sub>; the phase current flowing through it dissipates <strong>conduction loss</strong> as heat, following Joule's law:</p>

<p align="center"><b><i>P</i><sub>ESC</sub> = <i>I</i><sup>2</sup> &middot; <i>R</i><sub>ESC</sub></b></p>

<p>Where:</p>
<ul>
<li><i>I</i> is the motor phase current [A] — carried forward from the Experiment 1 motor operating point.</li>
<li><i>R</i><sub>ESC</sub> is the effective conduction resistance of the ESC's active MOSFETs [&Omega;] (≈ 3 m&Omega; for a typical 30 A ESC).</li>
</ul>

<p>The quadratic <i>I</i><sup>2</sup> dependence is the key insight: doubling the current <strong>quadruples</strong> the heat. A practical design rule flags whether passive cooling is enough or a <strong>heatsink</strong> is required:</p>

<p align="center"><i>P</i><sub>ESC</sub> &gt; 2 W &nbsp; &rarr; &nbsp; heatsink / active cooling required</p>

<h3>Worked Example — Dissipation &amp; Heatsink Decision</h3>

<p>A 30 A BLHeli_32 ESC (<i>R</i><sub>ESC</sub> = 0.003 &Omega;) is evaluated at two motor currents taken from the Experiment 1 sweep:</p>

<table>
<thead>
<tr><th>Phase Current <i>I</i> (A)</th><th>Substitution</th><th><i>P</i><sub>ESC</sub> (W)</th><th>Verdict (2 W rule)</th></tr>
</thead>
<tbody>
<tr><td>25</td><td>25<sup>2</sup> &times; 0.003 = 625 &times; 0.003</td><td><b>1.875 W</b></td><td>Below threshold &rarr; passive cooling OK</td></tr>
<tr><td>30</td><td>30<sup>2</sup> &times; 0.003 = 900 &times; 0.003</td><td><b>2.700 W</b></td><td>Above threshold &rarr; <strong>heatsink needed</strong></td></tr>
</tbody>
</table>

<p>At 25 A the ESC sheds 1.875 W — comfortably under the 2 W threshold, so rotor-wash convection is sufficient. Raising the current only 20% to 30 A pushes dissipation to 2.7 W (a 44% jump, because loss scales with <i>I</i><sup>2</sup>), crossing the threshold and requiring a heatsink. This single calculation decides a real hardware purchase, and its quadratic steepness is exactly why over-propping a motor — which spikes current — is so dangerous for the ESC.</p>

<blockquote>
<p><strong>A second, smaller heat source: switching loss.</strong> Every time the MOSFET bridge switches on or off it briefly passes through its linear region, burning energy independent of the conduction path: <i>P</i><sub>sw</sub> &asymp; &frac12;&middot;<i>V</i><sub>bus</sub>&middot;<i>I</i>&middot;(<i>t</i><sub>on</sub>+<i>t</i><sub>off</sub>)&middot;<i>f</i><sub>carrier</sub>, with <i>t</i><sub>on</sub>+<i>t</i><sub>off</sub> &asymp; 100 ns typical for a logic-level hobby-ESC FET and a 24 kHz (BLHeli) to 48 kHz (BLHeli_32 digital) carrier. At typical hover/cruise currents this is a small fraction of the conduction loss above, but it is what a <i>higher</i> command-protocol carrier frequency (Section 4) genuinely costs in heat — the simulator's total ESC dissipation always reports conduction <strong>plus</strong> switching.</p>
</blockquote>

<p><img src="./images/esc_power_dissipation.png" alt="ESC Conduction Loss vs Phase Current and the 2 W Heatsink Threshold"></p>

<hr>

<h2>6. Temperature Coefficient &amp; Thermal-Runaway Risk</h2>

<p>The conduction model of Section 5 uses a <strong>fixed</strong> <i>R</i><sub>ESC</sub>, but the silicon MOSFET channel that carries the phase current has a <strong>positive temperature coefficient of resistance</strong>: it gets <i>more</i> resistive as it heats. A power MOSFET's <i>R</i><sub>DS(on)</sub> typically climbs to ~1.45&times; its 25 &deg;C value by 100 &deg;C (datasheet-typical for the logic-level FETs used in hobby ESCs), i.e. &alpha; &asymp; 0.006 /&deg;C — well above annealed copper's 0.00393 /&deg;C, because the loss is dominated by the silicon channel, not the board's copper traces:</p>

<p align="center"><i>R</i><sub>ESC</sub>(<i>T</i>) = <i>R</i><sub>ESC,25</sub> &middot; [1 + &alpha; &middot; (<i>T</i> - 25&deg;C)]</p>

<p>This creates a positive feedback loop: higher current &rarr; more heat &rarr; higher resistance &rarr; <i>even more</i> heat at the same current. Worked at the 80 &deg;C the MOSFETs may reach in flight:</p>

<p align="center"><i>R</i><sub>ESC</sub>(80&deg;C) = 0.003 &middot; [1 + 0.006 &middot; (80 - 25)] = 0.003 &middot; 1.33 &asymp; 0.00399 &Omega;</p>

<p>The resistance is <strong>~33% higher</strong> when hot, so at 30 A the <i>real</i> dissipation is <i>P</i> = 30<sup>2</sup> &middot; 0.00399 &asymp; <b>3.59 W</b>, not the 2.7 W the cold model predicts. The static <i>I</i><sup>2</sup><i>R</i> calculation therefore <i>under-estimates</i> hot-running loss — a limitation that must be disclosed, and the reason the full transient thermal model is developed in Experiment 9.</p>

<blockquote>
<p><strong>Simple steady-state temperature estimate.</strong> Treating the ESC as a lumped body with junction-to-ambient thermal resistance <i>R</i><sub>th</sub>, the equilibrium temperature is <i>T</i><sub>ESC</sub> = <i>T</i><sub>ambient</sub> + <i>P</i><sub>ESC</sub> &middot; <i>R</i><sub>th</sub>. For a bare 30 A ESC (<i>R</i><sub>th</sub> &asymp; 18 &deg;C/W) at 30 A: <i>T</i><sub>ESC</sub> &asymp; 25 + 2.7 &middot; 18 &asymp; 73.6 &deg;C. Bonding a heatsink that drops <i>R</i><sub>th</sub> to ~9 &deg;C/W brings this down to <i>T</i><sub>ESC</sub> &asymp; 25 + 2.7 &middot; 9 &asymp; 49.3 &deg;C — safely clear of the 80 &deg;C limit.</p>
</blockquote>

<h3>The Self-Consistent Hot Operating Point</h3>
<p>The simple steady-state estimate above assumes the power dissipation is fixed at the cold value (2.7 W). In reality, because the temperature rise increases the resistance, which in turn increases the power dissipation, we must solve a system of coupled equations self-consistently:</p>
<ol>
<li><i>P</i><sub>ESC</sub> = <i>I</i><sup>2</sup> &middot; <i>R</i><sub>ESC</sub>(<i>T</i>)</li>
<li><i>R</i><sub>ESC</sub>(<i>T</i>) = <i>R</i><sub>ESC,25</sub> &middot; [1 + &alpha; &middot; (<i>T</i> &minus; 25 &deg;C)]</li>
<li><i>T</i> = <i>T</i><sub>amb</sub> + <i>P</i><sub>ESC</sub> &middot; <i>R</i><sub>th</sub></li>
</ol>

<p>Substituting (1) and (2) into (3) yields a linear equation for the equilibrium temperature <i>T</i>. Solving for <i>T</i> gives the closed-form analytical solution:</p>
<p align="center"><b><i>T</i> = <sup>(<i>T</i><sub>amb</sub> + <i>K</i> &minus; 25 &middot; <i>K</i> &middot; &alpha;)</sup> &frasl; <sub>(1 &minus; <i>K</i> &middot; &alpha;)</sub></b></p>

<p>Where <i>K</i> = <i>I</i><sup>2</sup> &middot; <i>R</i><sub>ESC,25</sub> &middot; <i>R</i><sub>th</sub>. For a 30 A phase current, a 3.0 m&Omega; ESC, and ambient temperature of 25 &deg;C:</p>
<ul>
<li><strong>Bare ESC</strong> (<i>R</i><sub>th</sub> = 18 &deg;C/W): <i>K</i> = 48.6. The self-consistent operating temperature converges to <b>93.6 &deg;C</b> (with a hot resistance of <b>4.23 m&Omega;</b> and power loss of <b>3.81 W</b>), far exceeding the cold estimate of 73.6 &deg;C and crossing the 80 &deg;C thermal limit.</li>
<li><strong>Heatsinked ESC</strong> (<i>R</i><sub>th</sub> = 9 &deg;C/W): <i>K</i> = 24.3. The operating temperature converges to <b>53.4 &deg;C</b> (with a hot resistance of <b>3.51 m&Omega;</b> and power loss of <b>3.16 W</b>), remaining safely below the 80 &deg;C thermal limit.</li>
</ul>

<hr>

<h2>7. Building the Real Circuit — Free-Form Wiring &amp; Hardware Faults</h2>

<p>Every calculation above assumes the ESC is already correctly wired to its battery and motor. Before any of that arithmetic matters, a technician has to build the physical circuit — and a real ESC has <strong>no forgiveness</strong> for getting it wrong. Module 1's commissioning bench models this literally: the battery and ESC arrive with bare terminal pads, and the student drags wires between them in the 3D view exactly as they would in a workshop, with the same consequences.</p>

<h3>Power wiring: two wires, two failure modes</h3>

<p>The ESC's power input has a positive and a negative pad; the battery has a positive and a negative terminal. There is exactly one correct pairing:</p>

<p align="center">battery(+) &harr; ESC-input(+) &nbsp;&nbsp;and&nbsp;&nbsp; battery(&minus;) &harr; ESC-input(&minus;)</p>

<ul>
<li><strong>Reversed polarity</strong> (either wire crossed) drives current backward through the MOSFET bridge's body diodes with no series impedance to limit it. Hobby ESCs carry <strong>no reverse-voltage protection</strong> — this is not a fault the firmware catches, it is silicon damage in the first instant of contact. The board is destroyed: MOSFETs scorch, a smoke puff fires once, and no amount of re-wiring recovers it — only selecting a replacement ESC clears the fault.</li>
<li><strong>A direct short</strong> (bridging the battery's own two terminals, or the ESC input's own two pads) is electrically identical in consequence: unlimited current with nothing to oppose it, and the same instant destruction.</li>
</ul>

<h3>Phase wiring: three wires, a permutation problem</h3>

<p>The ESC drives the motor's three phase windings from three output pads; the motor has three phase terminals. Unlike the power pair, there is no unique "correct" wiring here — a BLDC motor commutates correctly under <strong>any</strong> consistent one-to-one mapping, but the <i>direction</i> it spins depends on which mapping you chose:</p>

<ul>
<li><strong>Complete and consistent</strong> (all three ESC pads wired to three distinct motor terminals) &rarr; the motor commutates and spins. Whether it spins the way you expect depends on the permutation:
  <ul>
  <li>The <strong>canonical</strong> mapping (A&rarr;U, B&rarr;V, C&rarr;W) and any <strong>cyclic rotation</strong> of it (A&rarr;V,B&rarr;W,C&rarr;U or A&rarr;W,B&rarr;U,C&rarr;V) all spin <strong>forward</strong> — cycling all three phases together does not reverse rotation.</li>
  <li>Swapping <strong>any two</strong> of the three wires (holding the third fixed) reverses two of the three phase currents' relative timing and spins the motor <strong>backward</strong>. This is the century-old three-phase-motor rule "swap any two leads to reverse rotation," and it is exactly why, on a real quad where every arm must spin the <i>correct</i> direction for yaw authority, technicians double-check phase wiring after every re-solder.</li>
  </ul>
</li>
<li><strong>Incomplete</strong> (fewer than three wires, or one motor terminal never wired) or <strong>degenerate</strong> (two ESC pads wired to the same motor terminal, or two ESC pads wired directly to each other) — the ESC cannot resolve a valid three-phase pattern and <strong>will not commutate</strong>: the rotor sits still and buzzes rather than turning, the classic "motor won't spin, ESC beeps" bench symptom.</li>
</ul>

<p>Formally, label the three ESC pads A, B, C and the three motor terminals by index 0, 1, 2 (canonically U=0, V=1, W=2). Any complete wiring is a permutation &pi; of {0,1,2}. Every permutation of three elements is either an <strong>even</strong> permutation (the identity, or one of the two 3-cycles — 3 total) or an <strong>odd</strong> permutation (one of the three transpositions that swap exactly two elements and fix the third — 3 total):</p>

<p align="center">rotation direction = forward if &pi; is even, reversed if &pi; is odd</p>

<p>The simulator computes this parity directly from the wires the student actually drew (by counting inversions in the resulting index sequence), so "which two did I swap?" is answered by the physics, not a lookup table.</p>

<h3>Why this belongs before the PWM calculations</h3>

<p>Every worked example in Sections 1–6 implicitly assumes a wired, undamaged ESC driving a correctly connected motor. In the real build sequence that assumption is earned, not given — this section's three failure modes (reverse-polarity destruction, dead short, and reversed rotation) are the first things a new technician gets wrong, and the reason experienced builders wire power <i>last</i>, double-check polarity with a meter before ever spinning a prop, and always bench-test rotation direction unloaded before mounting a propeller.</p>

<hr>

<h2>8. Cross-Experiment Relationships</h2>

<p>This experiment sits at the electrical crossroads of the build and both consumes and produces values used elsewhere:</p>

<ul>
<li><strong>Motor current (from Experiment 1):</strong> The phase current <i>I</i> driving Sub-Calc C is the motor operating-point current computed by the Experiment 1 propulsion engine (≈ 7.2 A per motor at hover, rising toward the 23–32 A full-throttle figures for the larger motors), read live from the shared build store — never typed in. Selecting a higher-KV motor or over-propping raises this current and directly increases ESC dissipation here.</li>
<li><strong>Dead-band values (to Experiment 5):</strong> The verified arming dead-band — the calibrated idle endpoint plus this unit's own arm offset, <code>pwm_deadband_us</code> — is stored for the Flight Control System experiment, where the PID loops assume a calibrated, jitter-free throttle channel.</li>
<li><strong>ESC thermal flag (to Experiment 9):</strong> Whether <i>P</i><sub>ESC</sub> crosses the 2 W heatsink threshold (<code>heatsinkRequired</code>) is forwarded to the Thermal Management experiment, which develops the full transient temperature-rise model that this static calculation only approximates.</li>
</ul>

<p>The full characterisation — conduction resistance, hover/full dissipation, the calibrated dead-band, the cold-vs-hot thermal state, and whether the map was ever actually calibrated (<code>calibrated</code>) — is written to the shared cross-experiment build store (<code>VLABStore.finalize('exp4', &hellip;)</code>), not ad-hoc local-storage keys, so every downstream experiment reads the same, always-current values.</p>

<hr>

<h2>Summary of Key Formulas</h2>

<table>
<thead>
<tr><th>Parameter</th><th>Formula</th><th>Units</th></tr>
</thead>
<tbody>
<tr><td>Throttle from pulse width</td><td>Throttle% = (<i>PW</i> &minus; <i>PW</i><sub>min</sub>) / <i>PW</i><sub>range</sub> &times; 100</td><td>%</td></tr>
<tr><td>Dead-band gate</td><td>Throttle<sub>eff</sub> = 0 for <i>PW</i> &le; 1050 &micro;s</td><td>%</td></tr>
<tr><td>Command resolution</td><td><i>N</i><sub>steps</sub> = <i>PW</i><sub>range</sub> / <i>t</i><sub>tick</sub></td><td>steps</td></tr>
<tr><td>Refresh latency</td><td>&tau; = 1 / <i>f</i></td><td>s</td></tr>
<tr><td>Digital frame time</td><td><i>t</i><sub>frame</sub> = frame bits / bitrate</td><td>s</td></tr>
<tr><td>ESC conduction loss</td><td><i>P</i><sub>ESC</sub> = <i>I</i><sup>2</sup> &middot; <i>R</i><sub>ESC</sub></td><td>W</td></tr>
<tr><td>Resistance vs temperature</td><td><i>R</i>(<i>T</i>) = <i>R</i><sub>25</sub> &middot; [1 + &alpha;(<i>T</i> &minus; 25)]</td><td>&Omega;</td></tr>
<tr><td>ESC steady-state temperature</td><td><i>T</i><sub>ESC</sub> = <i>T</i><sub>amb</sub> + <i>P</i><sub>ESC</sub> &middot; <i>R</i><sub>th</sub></td><td>&deg;C</td></tr>
</tbody>
</table>
