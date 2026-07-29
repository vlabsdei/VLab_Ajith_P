<h1>Lab Procedure: PID Tuning, Ziegler&ndash;Nichols, Sensor Fusion &amp; the Full System</h1>

<p>Four tabs on one page: PID Tuning, Ziegler&ndash;Nichols, Sensor Fusion, and Full System. Everything is computed live from the airframe and IMU you pick, and the session saves itself, so you can close the page mid-tune and come back to it. The airframe, the commanded roll angle and the propeller blade count are shared across all four tabs; each tab's own controls appear in the left panel only while that tab is active.</p>

<p>One thing to know up front: this experiment is self-contained. It does not read saved values from any other experiment, and it does not write into one. The mass, arm length and moment of inertia all come from the components you select here.</p>

<hr>

<h2>Before anything else: the airframe</h2>

<h3>Objective</h3>
<p>Fix the roll-axis moment of inertia <i>J</i>, because it sets the entire closed-loop response.</p>

<ol>
<li>The page opens on <strong>1 &middot; PID Tuning</strong>. Use the <strong>Airframe</strong> selector in the left panel &mdash; Micro 4&Prime;, X-Quad 5&Prime;, FPV 6&Prime;, Freestyle 7&Prime;, or the 10&Prime; Cine-Lifter.</li>
<li>The <strong>Moment of Inertia</strong> readout updates immediately from the chassis and the rest of the build (motor, battery, ESC, controller, receiver, attachments), using <i>J</i> = <i>m L</i><sup>2</sup>/2.</li>
<li>To reproduce the worked numbers below, stay on the default <strong>X-Quad 5&Prime;</strong>: <i>m</i> = 0.529 kg, geometric arm 145 mm, <i>J</i> = 0.00313 kg&middot;m<sup>2</sup>.</li>
</ol>

<hr>

<h2>How to watch a run</h2>

<p>Two tools carry most of the explanation in this experiment, and they are worth understanding before you start turning knobs.</p>

<h3>The narrated run</h3>

<p>Every tab's <strong>&#9654; Run</strong> button plays the result as a narrated, shot-by-shot film rather than a three-second twitch. The playback is chaptered, and each chapter re-times a window of simulation time onto a window of wall time &mdash; so the 40 ms in which the mixer splits the motor thrusts stretches to about five seconds of slow motion, while the settle tail runs at speed. The camera moves per chapter (wide, front, close on the left motor pair, hero), and the caption strip states what is happening <em>and the number it is happening at</em>, recomputed from your build.</p>

<ul>
<li>The transport bar gives you play/pause, previous and next chapter, a scrubbable timeline with a tick per chapter, speeds of <strong>0.5&times; / 1&times; / 2&times; / 4&times;</strong>, and <strong>Skip &#9656;</strong> straight to the verdict. A full PID run is about 28 s at 1&times;.</li>
<li>Drag inside the viewport at any time and the director hands the camera back to you for the rest of the run.</li>
<li>If you only want the numbers, turn the <strong>Narrated slow-motion run</strong> switch off in the left panel.</li>
</ul>

<h3>In-scene annotations</h3>

<p>With <strong>In-scene thrust / torque annotations</strong> on (the default), the 3-D view draws the controller's actual output onto the airframe:</p>

<ul>
<li>a column above each motor whose height is that motor's live thrust, with a grey tick at the hover trim &mdash; green above trim, blue below, and <strong>red</strong> when the motor hits 0 N or its ceiling;</li>
<li>a grey blade at the commanded angle and a gold blade at the true angle, with the orange wedge between them being the live error;</li>
<li>a torque arc around the roll axis, sized against <i>&tau;</i><sub>max</sub>, which turns red on saturation.</li>
</ul>

<p>This is the answer to "what does a PID gain physically <em>do</em>". It is a number that ends up as newtons of thrust on one side of the aircraft.</p>

<h3>The derivation window</h3>

<p>Each tab's left panel ends with <strong>How this works &mdash; full derivation &rsaquo;</strong>. It opens a live block diagram of that tab's actual loop, the equations with your build's numbers substituted in, a knob-by-knob table of physical consequence and failure mode, and the metric definitions. Read it once per tab before you start tuning.</p>

<hr>

<h2>Tab 1 &middot; PID Tuning</h2>

<h3>Objective</h3>
<p>Connect the gains to the closed-loop natural frequency and damping, and read the four step-response metrics off the plot.</p>

<p><img src="./images/step_response_metrics.png" alt="PID step response showing overshoot, rise and settling time"></p>

<ol>
<li>The centre attitude view shows the drone rolling toward the commanded angle, and the response plot traces roll angle against time with the setpoint, the overshoot peak and the &plusmn;2% settling band marked. Both come from a full closed-loop integration, so every gain &mdash; K<sub>i</sub> included &mdash; visibly reshapes the curve.</li>

<li>Pick what the gains are flying, using the <strong>Plant fidelity</strong> buttons:
  <ul>
  <li><strong>Ideal 1/(<i>J s</i><sup>2</sup>)</strong> is the textbook prototype: perfect rigid body, continuous controller, unlimited torque, no sensor. The analytic &omega;<sub>n</sub> / &zeta; / M<sub>p</sub> formulas hold here to three decimals.</li>
  <li><strong>Real drone</strong> (the default) runs the same gains on a modelled aircraft: the loop is discrete at the IMU's 400 Hz with zero-order hold, the controller sees the complementary-filtered noisy estimate rather than the truth, each motor spools with a 20 ms lag, and the mixer clips at the real thrust envelope with anti-windup on the integrator.</li>
  </ul>
  Run the same gains on both. The gap between them is the whole point of the tab.</li>

<li>Set <strong>K<sub>p</sub></strong>, <strong>K<sub>i</sub></strong> and <strong>K<sub>d</sub></strong> (defaults: 0.6, 0, 0.04). The plot redraws as a preview the moment a gain changes; <strong>&#9654; Run</strong> plays the narrated film of that response. There is no live throttle and no mid-flight adjustment here &mdash; you fix the gains, then you fly them.</li>

<li>Read the chips under the viewport: <strong>&omega;<sub>n</sub></strong>, <strong>damping &zeta;</strong>, <strong>overshoot %</strong>, <strong>settling time</strong>. On the reference build, K<sub>p</sub> = 0.6 with K<sub>d</sub> = 0.04 gives &omega;<sub>n</sub> = 13.85 rad/s and &zeta; = 0.462, which the ideal plant turns into 19.5% overshoot and t<sub>s</sub> = 0.60 s, and the real drone turns into 31.3% overshoot and t<sub>s</sub> = 0.90 s. So the default fails the 30% comfort limit, deliberately. Raise K<sub>d</sub> to 0.05 (16.6%) or 0.06 (5.0%) and re-run to pass.</li>

<li>Use the <strong>Active terms</strong> buttons to fly <strong>P only</strong>, <strong>PI</strong>, <strong>PD</strong> and full <strong>PID</strong> on the same slider values. P alone rings, and with the disturbance armed it droops. PD stops the ringing but keeps the droop. PI kills the droop but rings harder. Only the full PID does both. The <strong>PID Term Contributions</strong> chart splits the corrective torque into its live P / I / D shares in N&middot;m, so you can see which gain is doing the work at each instant.</li>

<li>Open <strong>Charts &rarr; Motor mixing</strong> to watch torque become thrust. It plots the left-pair and right-pair thrusts against the hover trim, the motor ceiling and zero. On the reference build the trim sits at 1.30 N and the ceiling is 8.92 N &mdash; but the roll authority works out at only <i>&tau;</i><sub>max</sub> = 0.532 N&middot;m, and that is the interesting part. The limit is not the top of the envelope. To roll, one pair pushes up and the other pulls down, and the pair coming down runs out first when it reaches <strong>0 N</strong>. So <i>&tau;</i><sub>max</sub> = 4&middot;<i>a</i>&middot;<i>T</i><sub>hover</sub>, set by the hover trim and the arm, with the 8.92 N ceiling never coming into it. Now push K<sub>p</sub> to 1.5 with a 45&deg; command: the demand reaches 1.18 N&middot;m, the footnote's <em>"mixer clipped &hellip;% of the run"</em> stops reading zero (about 15% here), the in-scene columns go red, and the response degrades in a way no gain change can rescue. That is a propulsion limit, not a software one.</li>

<li>Sweep K<sub>p</sub> from 0.2 to 1.0 with K<sub>d</sub> held at 0.04. On the ideal plant, overshoot climbs from 1.5% to 30.0% and crosses the 25% comfort line near K<sub>p</sub> = 0.8 &mdash; while the settling time sits unchanged at 0.626 s, because it is set by K<sub>d</sub>/(2<i>J</i>), not by K<sub>p</sub>. The <strong>Gain sweep</strong> chart draws all five responses at once, and the <strong>s-plane pole map</strong> shows the same fact geometrically: the pole pair slides up and down at a fixed real part.</li>

<li>Turn on the <strong>Disturbance torque</strong> switch. This is a fixed CG-offset couple, <i>&tau;</i><sub>d</sub> = <i>m g d</i> with <i>d</i> = 3.57 mm &mdash; an off-centre payload or a shifted battery. The drone now settles short of the target and the plot draws a red droop line at the held angle. Read <strong>e<sub>ss</sub></strong>: 1.83&deg; at K<sub>p</sub> = 0.6 on the real plant, 1.77&deg; on the ideal one, which is exactly <i>&tau;</i><sub>d</sub>/K<sub>p</sub>. In the term chart, the P term alone is now holding a standing torque against the disturbance, and proportional action needs a non-zero error to produce that torque. That is why the droop stays.</li>

<li>Raise <strong>K<sub>i</sub></strong> above zero and re-run. The steady-state error walks to 0&deg; and the droop line vanishes. In the term chart the load hands off from P to I: as the integrator winds in, the I share climbs to carry the full counter-torque, and the P share falls toward zero. Proportional action no longer needs a standing error, so the aircraft holds the commanded attitude.</li>
</ol>

<hr>

<h2>Tab 2 &middot; Ziegler&ndash;Nichols</h2>

<h3>Objective</h3>
<p>Get gains automatically from the ultimate gain and period, refine the aggressive result into something you would actually fly, then see what real air resistance does to both.</p>

<p><img src="./images/ziegler_nichols_tuning.png" alt="Ziegler-Nichols sustained oscillation and the classic vs Tyreus-Luyben step responses"></p>

<ol>
<li>The plot now shows the inner rate-loop response under pure proportional control.</li>

<li>Drag the <strong>Proportional sweep gain</strong> up. The response goes damped, then into a sustained constant-amplitude oscillation, then diverges. Stop at the sustained oscillation: the readout latches the ultimate gain <strong>K<sub>u</sub></strong> and period <strong>P<sub>u</sub></strong>. On the 5&Prime; airframe, expect K<sub>u</sub> &asymp; 19.25 and P<sub>u</sub> &asymp; 0.051 s.</li>

<li>With <strong>Classic Z-N</strong> selected, click <strong>Auto-tune (apply table)</strong>. You get K<sub>p</sub> &asymp; 11.55, K<sub>i</sub> &asymp; 450, K<sub>d</sub> &asymp; 0.074, and a step response with about 68% overshoot &mdash; fast, aggressive, and zero steady-state error thanks to the integral term.</li>

<li>Click <strong>Tyreus&ndash;Luyben</strong>. The gains drop to K<sub>p</sub> &asymp; 8.66, K<sub>i</sub> &asymp; 77, K<sub>d</sub> &asymp; 0.071 and the overshoot falls to about 16%, under the 25% target, still with zero steady-state error. The two step curves overlay on the plot for comparison.</li>

<li>Now drag the <strong>Air resistance</strong> slider from 0% through 30% to 70%. Aerodynamic damping acts on the body, so it speeds the mechanical pole up and lowers the plant's DC gain &mdash; and K<sub>u</sub> itself moves, climbing 19.25 &rarr; 21.24 &rarr; 24.02 while P<sub>u</sub> falls 51.3 &rarr; 49.1 &rarr; 46.6 ms. Because the Z-N table is always a fixed fraction of K<sub>u</sub>, the retuned gains rise with it (Classic K<sub>p</sub> 11.55 &rarr; 12.75 &rarr; 14.41) and the overshoot barely moves (68% &rarr; 67% &rarr; 66%). Z-N holds you at a constant distance from instability by construction, so a draggier airframe is allowed hotter gains, not a calmer response.</li>

<li>To see drag as damping instead, hold the gains fixed. The clearest place is the <strong>PID Tuning</strong> tab, which has its own air-resistance slider and no auto-retune: at K<sub>p</sub> = 0.6 and K<sub>d</sub> = 0.04, the damping ratio climbs &zeta; = 0.462 &rarr; 0.685 &rarr; 0.982 and overshoot collapses 19.5% &rarr; 5.2% &rarr; 0% across the same three settings. Drag is free damping the controller never had to supply &mdash; and it is why the same tune feels livelier at 3000 m, where &rho; has dropped.</li>

<li>Raise the <strong>Wind-gust torque</strong> slider. A slowly oscillating disturbance pushes the rate loop off target, and the response wobbles around the setpoint instead of holding flat. Only integral action can null the offset in steady state, and both Z-N tables already have it.</li>

<li>Open <strong>Charts &rarr; Stability margin</strong>. It sweeps K<sub>p</sub> from 0.1&thinsp;K<sub>u</sub> to 1.25&thinsp;K<sub>u</sub>, plots the resulting P-only overshoot and settling time, and marks K<sub>u</sub> along with wherever the selected method parks you (Classic at 0.60&thinsp;K<sub>u</sub>, Tyreus&ndash;Luyben at 0.45&thinsp;K<sub>u</sub>). Everything right of 1.0 is an aircraft you cannot fly. The horizontal distance to that line is your gain margin.</li>
</ol>

<p>Read the commentary at the end. Ziegler&ndash;Nichols gives you a starting point from a single experiment, and nothing more. A robustness retune and real air resistance both fight overshoot &mdash; one on paper, one in physics.</p>

<hr>

<h2>Tab 3 &middot; Sensor Fusion</h2>

<h3>Objective</h3>
<p>Fuse a drifting gyro and a noisy accelerometer into a usable attitude estimate, and find the blend that minimises the combined error.</p>

<p><img src="./images/complementary_filter.png" alt="Complementary filter fusing drifting gyro and noisy accelerometer into a clean estimate"></p>

<ol>
<li>Your airframe selection carries over on its own.</li>

<li>Choose an <strong>IMU</strong>: MPU-6000, ICM-20602, BMI270 or MPU-9250. Its gyro bias, accelerometer noise and sample rate populate the model. Start with the reference MPU-6000.</li>

<li>Watch the twin drones. The solid one holds the true commanded attitude; the translucent ghost shows the fused estimate &theta;&#770; banking alongside it. The scope overlays the true angle, the gyro-only estimate (smooth, slowly drifting away), the accelerometer angle (right on average, noisy in every sample), and the fused result.</li>

<li>Sweep the <strong>Blend coefficient &alpha;</strong> through 0.90, 0.95, 0.98, 0.99 and read the time constant &tau;<sub>f</sub>, drift, noise RMS and total error. For the reference IMU the total error bottoms out at &alpha; = 0.98, around 0.25&deg;.</li>

<li>Open <strong>Charts &rarr; Frequency view</strong>. The gyro path is a high-pass and the accelerometer path a low-pass, and they sum to exactly one at every frequency, crossing at 1/(2&pi;&tau;<sub>f</sub>) &mdash; about 1.3 Hz at &alpha; = 0.98. Above the crossover the estimate <em>is</em> the gyro; below it, gravity quietly drags the estimate back onto truth. That is what stops the drift.</li>

<li>Push &alpha; to its maximum of 0.999, which is effectively pure gyro. The ghost drone peels away from the solid one and keeps peeling &mdash; roughly 18&deg; over 30 s for the MPU-6000's 0.6&deg;/s bias. The <strong>Estimate error over time</strong> chart shows it against three other &alpha; values: every bounded curve stays flat, and the pure-gyro one just walks off.</li>

<li>The right panel confirms the chosen IMU, the best &alpha;, and the final attitude-estimate error. That estimate is what the next tab actually flies on.</li>
</ol>

<hr>

<h2>Tab 4 &middot; Full System</h2>

<h3>Objective</h3>
<p>Close the loop for real, with the controller acting on the estimate rather than the truth, and hunt for the best combination.</p>

<p><img src="./images/closed_loop_full_system.png" alt="Full-system closed loop showing the controller acting on the attitude estimate, not the true angle"></p>

<ol>
<li>The config panel gains a <strong>Controller</strong> picker (Manual PID / ZN-Classic / ZN-Tyreus) and an <strong>Estimator</strong> picker (Complementary &alpha; / Gyro-only / Accel-only), alongside the shared IMU, air-resistance and wind controls.</li>

<li>Fly the default pair &mdash; Manual PID with the complementary filter &mdash; and read the <strong>Score</strong>, <strong>Tracking RMS</strong> (true angle against command) and <strong>Estimator RMS</strong> (true angle against estimate). On the reference build this scores in the high 90s.</li>

<li>Now click <strong>Gyro-only</strong>. The same gains are chasing a drifting attitude: tracking RMS jumps from about 0.22&deg; to about 1.45&deg;, the response never settles inside the 2&deg; band for the full 4 s window, and the score falls from 97 to 63. Nothing about the gains changed. Only what they could see.</li>

<li>Open <strong>Charts &rarr; Estimator error vs tracking error</strong>. The controller drives tracking error to zero by definition, because that is the only quantity it can perceive through its estimate. The estimator error &mdash; belief against truth &mdash; is invisible to it, and lands on the airframe regardless. With a gyro-only estimator the second curve walks off while the first stays flat: a perfectly behaved control loop flying a lie.</li>

<li>Read the leaderboard. All nine controller-and-estimator combinations are ranked live as a horizontal bar chart, with your current selection in gold and anything under 65 in red. It is read-only &mdash; change the combination with the pickers above it.</li>

<li>Look at the pattern rather than the winner. All three complementary-filter rows score 97 whatever the controller; all three gyro-only rows sit at 63 whatever the controller; the accelerometer-only rows land at 91&ndash;92. The estimator choice dominates the controller choice, and the leaderboard makes that a sortable fact instead of an assertion.</li>

<li>Stress it. Raise air resistance and wind-gust torque, switch IMU, or turn on <strong>Uncalibrated ESC</strong>, and watch the ranking move. The ESC switch programs a fixed actuation offset into the loop &mdash; the same dead-band mismatch the power-electronics experiment studies directly &mdash; and you can see the integral term working harder to trim it out.</li>

<li>Pick the pair that tops the leaderboard and confirm the verdict reads <strong>"Best flight control system."</strong> That run, with its score, tracking RMS and estimator RMS, completes the experiment and unlocks the flight controller and IMU in the Outputs panel.</li>
</ol>
