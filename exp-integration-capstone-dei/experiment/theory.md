<h1>Theoretical Background: Integrated Drone Build & System-Level Verification</h1>

<p>Every previous experiment isolated <em>one</em> subsystem: a propeller, an arm, an airfoil, an ESC, a control loop, a payload budget. A real aircraft only flies when <strong>all</strong> of those subsystems agree with each other at the same operating point. This capstone treats the drone as a single coupled system, where a change to any one component ripples through mass, thrust, current, heat, stability and endurance. The task is not to optimise one number but to find a <strong>self-consistent build</strong> that clears every mission constraint at once.</p>

<h2>1. The Mission Specification</h2>
<p>A mission is defined by three hard requirements the finished aircraft has to meet:</p>
<ul>
<li><strong>Maximum all-up weight</strong> <i>m</i><sub>max</sub> [g]: the total mass of the assembled, loaded aircraft may not go over this.</li>
<li><strong>Minimum flight time</strong> <i>t</i><sub>min</sub> [min]: hover endurance on the chosen battery has to be at least this long.</li>
<li><strong>Required payload</strong> <i>m</i><sub>pay</sub> [g]: the aircraft has to lift this extra mass and still keep a safe thrust-to-weight margin.</li>
</ul>
<p>On top of that, the build has to be <strong>electrically and mechanically valid</strong>: parts have to be compatible, nothing may exceed its current, power or thermal rating, and the aircraft needs enough control authority to actually fly.</p>

<h2>2. The Coupled System Model</h2>
<p>Nothing here is new. The verification chain is the same set of relations derived earlier in the series, evaluated together at one operating point:</p>

<p align="center"><b><i>m</i><sub>total</sub> = <i>m</i><sub>frame</sub> + 4(<i>m</i><sub>motor</sub> + <i>m</i><sub>ESC</sub> + <i>m</i><sub>prop</sub>) + <i>m</i><sub>battery</sub> + <i>m</i><sub>FC</sub> + <i>m</i><sub>rx</sub> + Σ<i>m</i><sub>attach</sub> + <i>m</i><sub>pay</sub></b></p>

<p align="center"><b>TWR = 4 · <i>T</i><sub>max</sub> / (<i>m</i><sub>total</sub> · g)</b> &nbsp;&nbsp;(Flight Performance - has to stay above the mission floor with the payload aboard)</p>

<p align="center"><b>hover throttle = √(1 / TWR)</b> &nbsp;&nbsp;(Flight Performance - quadratic thrust curve)</p>

<p align="center"><b><i>I</i><sub>hover</sub> = <i>P</i><sub>hover</sub> / <i>V</i><sub>batt</sub></b> ,&nbsp;&nbsp; <b><i>t</i><sub>flight</sub> = (0.8 · <i>C</i><sub>batt</sub> / <i>I</i><sub>total</sub>) · 60</b> &nbsp;&nbsp;(Energy Storage - usable capacity over draw)</p>

<p align="center"><b><i>P</i><sub>ESC</sub> = <i>I</i><sup>2</sup> · <i>R</i><sub>DS(on)</sub></b> ,&nbsp;&nbsp; <b><i>T</i><sub>ESC</sub> = <i>T</i><sub>amb</sub> + <i>P</i><sub>ESC</sub> · <i>R</i><sub>th</sub></b> &nbsp;&nbsp;(Power Electronics and Thermal Management - conduction loss and the heat it makes)</p>

<p align="center"><b><i>P</i><sub>hover,ideal</sub> = <i>T</i><sup>1.5</sup> / √(2 · ρ · A)</b> ,&nbsp;&nbsp; <b>efficiency = <i>m</i><sub>total</sub> / <i>P</i><sub>hover</sub> [g/W]</b> &nbsp;&nbsp;(Aerodynamic Analysis - momentum theory)</p>

<p>The build passes only when the resulting <i>m</i><sub>total</sub>, <i>t</i><sub>flight</sub> and payload-loaded TWR all satisfy the mission at once, and no component exceeds its rating along the way.</p>

<h2>3. The Diagnostic Principle</h2>
<p>Every failure mode here traces back to one physical relation, so a rejected build points straight at the concept behind it. The simulator checks every constraint and names the experiment that teaches each one it fails. It deliberately stops there. You are told <em>what</em> is wrong, never <em>how</em> to fix it, because working that out from the named experiment is the exercise.</p>

<table>
<thead><tr><th>Observed failure in the build</th><th>Root concept not understood</th><th>Revisit experiment</th></tr></thead>
<tbody>
<tr><td>Propeller too large / small for the frame; motor–prop mismatch; wrong KV for the cells</td><td>Thrust &amp; motor matching</td><td>Propulsion System Design</td></tr>
<tr><td>All-up mass over budget; frame too weak for arm load / CG off</td><td>Mass budget, material &amp; arm stress</td><td>Frame Structural Integrity</td></tr>
<tr><td>Poor hover efficiency (low g/W); high drag eroding endurance</td><td>Airfoil, drag &amp; propulsive efficiency</td><td>Aerodynamic Analysis</td></tr>
<tr><td>ESC undersized for phase current; ESC over-temperature</td><td>ESC current rating &amp; conduction loss</td><td>Power Electronics (ESC)</td></tr>
<tr><td>No flight controller; unstable / no control authority</td><td>Attitude control &amp; tuning</td><td>Flight Control System</td></tr>
<tr><td>Loaded TWR under the mission floor; hover throttle too high; payload not liftable</td><td>Thrust-to-weight &amp; control margin</td><td>Flight Performance</td></tr>
<tr><td>Payload budget exceeded; wrong lift-vs-mass trade</td><td>Hover throttle, payload &amp; efficiency</td><td>TWR · Hover · Efficiency</td></tr>
<tr><td>Flight time below the minimum; battery cells incompatible</td><td>Capacity, C-rating &amp; usable energy</td><td>Energy Storage System</td></tr>
<tr><td>ESC / motor running past thermal limit at cruise</td><td>Steady-state temperature &amp; cooling</td><td>Thermal Management</td></tr>
<tr><td>No receiver / GPS when the mission needs positioning</td><td>Link &amp; positioning hardware</td><td>Navigation &amp; Positioning</td></tr>
</tbody>
</table>

<h2>4. Why Integration Is the Real Skill</h2>
<p>It is entirely possible to pass every isolated experiment and still fail here, because the couplings do not forgive. A bigger motor lifts more, but it draws more current, which heats the ESC and empties the battery sooner, which cuts flight time. A bigger battery buys endurance and costs mass, which drops TWR and pushes hover throttle up. Designing a drone means finding the one point where all of that balances at once &mdash; and clearing this capstone is how you know the ten separate concepts have turned into a single working model.</p>
