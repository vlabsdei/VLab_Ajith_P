<h1>Lab Procedure: Integrated Drone Build &mdash; Spec-to-Flight Verification</h1>

<p>No new physics here. Everything you need you have already learned somewhere in the series &mdash; the job now is to build one aircraft that satisfies all of it at the same time. The page is a single build bench: mission brief and components on the left, the assembled drone in the middle, and the verification panel on the right.</p>

<blockquote>
<p>The mission is a <strong>Cinematic Payload Lifter</strong>: carry a stabilised camera payload and stay airborne long enough to get the shot, without going over the airframe's weight limit.</p>
</blockquote>

<hr>

<h2>Step 1 &middot; Read the mission brief</h2>

<p>The brief sits at the top of the <strong>Build Bench</strong> column, above the component tiles. Read all of it before you touch anything, because every number in it is a constraint you will be measured against.</p>

<table>
<thead><tr><th>Requirement</th><th>Value</th></tr></thead>
<tbody>
<tr><td>Maximum all-up weight</td><td>3600 g</td></tr>
<tr><td>Minimum flight time</td><td>1.2 min</td></tr>
<tr><td>Required payload</td><td>200 g</td></tr>
<tr><td>Environment</td><td>300 m density altitude</td></tr>
<tr><td>Positioning</td><td>required</td></tr>
</tbody>
</table>

<p>Underneath the requirements is a checkbox: <strong>load the required 200 g payload</strong>. Tick it. An unloaded build will pass most of the metrics and then fail the payload check outright, which is the point &mdash; a drone that only flies empty has not met this mission.</p>

<hr>

<h2>Step 2 &middot; Build the aircraft</h2>

<ol>
<li>Work down the component tiles: chassis, propeller, motor, ESC, battery, flight controller, receiver, attachments. The 3D model rebuilds as you go and the mass budget follows it.</li>

<li>Set the <strong>Density Altitude</strong> slider to 300 m to match the brief. Thinner air costs you thrust, and it is easier to discover that now than at the verify step.</li>

<li>Keep the <strong>Mission Verify</strong> panel on the right in view while you choose. Six metrics track live, each with a bar against its limit:
  <ul>
  <li>all-up weight against the 3600 g ceiling</li>
  <li>thrust-to-weight against the floor</li>
  <li>hover throttle, which wants headroom above it</li>
  <li>flight time against the 1.2 min requirement</li>
  <li>ESC temperature against its 80 &deg;C limit</li>
  <li>hover efficiency, where higher simply means longer</li>
  </ul>
</li>

<li>Clear the <strong>Diagnostics Log</strong> under the viewport. Propeller-versus-frame clearance, cell count against the motor and ESC ratings, phase current against what the parts are rated for &mdash; it catches all of them, and a blocking error will stop the run.</li>

<li>Use the viewport if you want to sanity-check the build under load. The bench runs exactly as it does in the propulsion experiment, so you can watch thrust, current and temperature before committing to a verification. Its Modules 2 and 3 carry padlocks until the Assembly Check passes, but nothing in the mission depends on them &mdash; the verification is driven entirely from the right-hand panel.</li>
</ol>

<hr>

<h2>Step 3 &middot; Verify</h2>

<p>Press <strong>Verify Build &#10003;</strong>. Ten constraints are evaluated, and each one is tied to the experiment whose concept it tests.</p>

<h3>Mission-critical &mdash; these decide pass or fail</h3>

<table>
<thead><tr><th>Check</th><th>Concept behind it</th></tr></thead>
<tbody>
<tr><td>All-up weight &le; 3600 g</td><td>Frame Structural Integrity</td></tr>
<tr><td>Loaded TWR &ge; 1.0</td><td>Flight Performance</td></tr>
<tr><td>Lifts the 200 g payload</td><td>TWR &middot; Hover &middot; Efficiency</td></tr>
<tr><td>Flight time &ge; 1.2 min</td><td>Energy Storage System</td></tr>
<tr><td>Flight controller fitted</td><td>Flight Control System</td></tr>
<tr><td>GPS and receiver fitted</td><td>Navigation &amp; Positioning</td></tr>
</tbody>
</table>

<h3>Advisory &mdash; shown in amber, and they do not block the mission</h3>

<table>
<thead><tr><th>Check</th><th>Concept behind it</th></tr></thead>
<tbody>
<tr><td>Propeller matches frame and motor</td><td>Propulsion System Design</td></tr>
<tr><td>ESC rated for the phase current</td><td>Power Electronics (ESC)</td></tr>
<tr><td>ESC temperature &le; 80 &deg;C</td><td>Thermal Management</td></tr>
<tr><td>Hover efficiency &ge; 1.5 g/W</td><td>Aerodynamic Analysis</td></tr>
</tbody>
</table>

<hr>

<h2>Step 4 &middot; Read the diagnosis</h2>

<p>If every mission-critical check passes, the build is accepted and the verdict reports the aircraft's weight, thrust-to-weight and flight time. Any advisory failures are still listed &mdash; the drone flies and the mission is met, but those are the places it could be better.</p>

<p>If a mission-critical check fails, the verdict says the build is rejected and the diagnosis panel lists <strong>only the names of the experiments</strong> whose concept you have not applied correctly. No hint, no link, no suggested component. That is deliberate. The information you need is in the experiment being named, and going back to understand it is the exercise.</p>

<p>Change the build, verify again, and repeat until the mission clears. There is nothing to unlock at the end &mdash; the verified aircraft is the deliverable.</p>
