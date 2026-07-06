<h1>Lab Procedure: PID Tuning, Ziegler&ndash;Nichols, Sensor Fusion &amp; the Full System</h1>

<p>This document outlines the step-by-step workflow for <strong>Experiment 5: Flight Control System</strong>, a single page with <strong>four tabs</strong>: PID Tuning, Ziegler&ndash;Nichols, Sensor Fusion, and Full System. Every value you see is computed live from the selected airframe and IMU, and your full session is saved automatically — reloading the page resumes exactly where you left off. The airframe, commanded roll angle and propeller blade count are shared across all four tabs; each tab's own controls appear in the left panel only while that tab is active.</p>

<hr>

<h2>Stage 1: Configure the Airframe</h2>

<h3>Objective</h3>
<p>Fix the roll-axis moment of inertia <i>J</i> from the physical build, since it sets the entire closed-loop response.</p>

<h3>Step-by-Step Procedure</h3>
<ol>
<li><strong>Launch the Simulator:</strong> Open the virtual lab page. It loads the <strong>1 &middot; PID Tuning</strong> tab by default.</li>
<li><strong>Select an Airframe:</strong> In the left-hand panel use the <strong>Airframe</strong> selector (3&Prime; Toothpick, 5&Prime; Freestyle, 7&Prime; Cinematic, 10&Prime; Heavy-Lift). The <strong>Moment of Inertia</strong> readout updates immediately using <i>J</i> = <i>m L</i><sup>2</sup>/2. This selection is shared by all four tabs.</li>
<li><strong>Note the Inheritance Badge:</strong> If you completed Experiment 2, the take-off mass and arm length are inherited automatically and the panel shows <em>"J inherited from Experiment 2"</em>. Otherwise the airframe preset value is used.</li>
<li><strong>Confirm the Reference Build:</strong> Select <strong>5&Prime; Freestyle</strong> to reproduce the worked examples (<i>J</i> = 0.003 kg&middot;m<sup>2</sup>).</li>
</ol>

<hr>

<h2>Stage 2: PID Step-Response Tuning (Tab 1 &middot; PID Tuning)</h2>

<h3>Objective</h3>
<p>Relate the PID gains to the closed-loop natural frequency and damping, and read the four step-response metrics directly.</p>

<p><img src="./images/step_response_metrics.png" alt="PID step response showing overshoot, rise and settling time"></p>

<h3>Step-by-Step Procedure</h3>
<ol>
<li><strong>Stay on the 1 &middot; PID Tuning tab.</strong> The centre <strong>attitude view</strong> shows the drone rolling toward the commanded angle; the <strong>response plot</strong> below traces roll angle versus time with the setpoint, overshoot peak, and the &plusmn;2% settling band marked. The plot and drone are driven by a <strong>real closed-loop PID simulation</strong> on the 1/(<i>J s</i><sup>2</sup>) plant, so every gain — including K<sub>i</sub> — visibly reshapes the curve.</li>
<li><strong>Set the gains.</strong> Drag the <strong>K<sub>p</sub></strong>, <strong>K<sub>i</sub></strong> and <strong>K<sub>d</sub></strong> sliders (start at K<sub>p</sub> = 0.6, K<sub>i</sub> = 0, K<sub>d</sub> = 0.04). Click <strong>Apply Step</strong> to command a new attitude and watch the response. Below the metrics, the <strong>PID Term Contributions</strong> panel breaks the corrective torque into its live <strong>P / I / D</strong> shares (in N&middot;m) so you can see <em>which</em> gain is doing the work at each instant: P sets the speed of the attack, D damps the ring-down, and I climbs only to erase a standing offset.</li>
<li><strong>Read the metrics.</strong> The right column reports <strong>&omega;<sub>n</sub></strong>, <strong>damping &zeta;</strong>, <strong>overshoot %</strong>, <strong>rise time</strong>, <strong>peak time</strong> and <strong>settling time</strong>. Confirm K<sub>p</sub> = 0.6 / K<sub>d</sub> = 0.04 gives &omega;<sub>n</sub> &asymp; 14.1 rad/s, &zeta; &asymp; 0.47, overshoot &asymp; 18.6%, settling &asymp; 0.60 s.</li>
<li><strong>Explore the K<sub>p</sub>&ndash;overshoot trade-off.</strong> Sweep K<sub>p</sub> across 0.2 &rarr; 1.0 (keep K<sub>d</sub> = 0.04). Watch overshoot climb 1.2% &rarr; 29% and cross the <strong>25% comfort limit</strong> near K<sub>p</sub> = 0.8, while the <strong>settling time stays fixed at 0.60 s</strong> — proving it is set by K<sub>d</sub>/(2<i>J</i>), not K<sub>p</sub>.</li>
<li><strong>Expose steady-state error.</strong> Enable the <strong>Disturbance torque</strong> switch (the CG-offset couple <i>&tau;</i><sub>d</sub> = <i>m g d</i> inherited from Experiment 2). The drone now settles <em>short</em> of the target, and the response plot draws a red <strong>droop line</strong> at the held angle. Read <strong>e<sub>ss</sub></strong>: about 1.67&deg; at K<sub>p</sub> = 0.6, shrinking as K<sub>p</sub> rises. In the <strong>PID Term Contributions</strong> panel, the <strong>P term alone</strong> is now holding a standing torque against the disturbance — but proportional action needs a non-zero error to produce that torque, which is exactly why the droop remains.</li>
<li><strong>Null it with integral action.</strong> Raise <strong>K<sub>i</sub></strong> above zero and re-apply the step. Watch the steady-state error walk to <strong>0&deg;</strong> and the droop line vanish. In the term panel the <strong>load hands off from P to I</strong>: as the integrator winds in, the I share climbs to carry the full counter-torque the disturbance demands while the P share falls toward zero — proportional action no longer needs a standing error, so the drone holds the commanded attitude exactly.</li>
</ol>

<hr>

<h2>Stage 3: Ziegler&ndash;Nichols Auto-Tuning (Tab 2 &middot; Ziegler&ndash;Nichols)</h2>

<h3>Objective</h3>
<p>Find the gains automatically from the ultimate gain and period, refine the aggressive classic result into a robust tune, then see how real air resistance and wind change both.</p>

<p><img src="./images/ziegler_nichols_tuning.png" alt="Ziegler&ndash;Nichols sustained oscillation and the classic vs Tyreus&ndash;Luyben step responses"></p>

<h3>Step-by-Step Procedure</h3>
<ol>
<li><strong>Switch to the 2 &middot; Ziegler&ndash;Nichols tab.</strong> The plot now shows the inner <strong>rate-loop</strong> response under pure proportional control.</li>
<li><strong>Find the stability limit.</strong> Drag the <strong>Proportional sweep gain</strong> slider upward. The response goes from damped, to a <strong>sustained constant-amplitude oscillation</strong>, to divergence. Stop at the sustained-oscillation point — the readout latches the <strong>ultimate gain K<sub>u</sub></strong> and <strong>period P<sub>u</sub></strong>. For the 5&Prime; airframe, expect K<sub>u</sub> &asymp; 19.25 and P<sub>u</sub> &asymp; 0.051 s.</li>
<li><strong>Apply the classic table.</strong> Click <strong>Auto-tune (Classic Z-N)</strong>. The computed gains appear (K<sub>p</sub> &asymp; 11.55, K<sub>i</sub> &asymp; 450, K<sub>d</sub> &asymp; 0.074) and the step response is drawn. Note the <strong>large ~68% overshoot</strong> — fast but aggressive — with <strong>zero steady-state error</strong> from the integral term.</li>
<li><strong>Refine for robustness.</strong> Switch the <strong>Tuning method</strong> to <strong>Tyreus&ndash;Luyben</strong>. The gains change (K<sub>p</sub> &asymp; 8.66, K<sub>i</sub> &asymp; 77, K<sub>d</sub> &asymp; 0.071) and the overshoot drops to about <strong>15%</strong>, under the 25% target, still with zero steady-state error. Compare the two step curves overlaid on the plot.</li>
<li><strong>Dial in air resistance.</strong> With the classic Z-N gains still applied, drag the <strong>Air resistance</strong> slider from 0% up through 30% to 70%. Watch overshoot fall from <strong>68% &rarr; 57% &rarr; 45%</strong> as real aerodynamic drag adds damping the electronics never had to supply — drag is <em>free</em> damping. The settling time shortens too (0.184 s &rarr; 0.122 s &rarr; 0.109 s).</li>
<li><strong>Add a wind gust.</strong> Raise the <strong>Wind-gust torque</strong> slider. A slowly oscillating disturbance now pushes the rate loop off its target; watch the response wobble around the setpoint instead of holding it flat — only integral action (already present in both Z-N tables) can null the offset in steady state.</li>
<li><strong>Draw the conclusion.</strong> Read the commentary: Ziegler&ndash;Nichols delivers a <em>starting point</em> in one experiment; a robustness retune and real air resistance both fight overshoot, one on paper and one in physics.</li>
</ol>

<hr>

<h2>Stage 4: Sensor Fusion — Complementary Filter (Tab 3 &middot; Sensor Fusion)</h2>

<h3>Objective</h3>
<p>Fuse a drifting gyro and a noisy accelerometer into a clean attitude estimate, and find the blend coefficient that minimises the combined error.</p>

<p><img src="./images/complementary_filter.png" alt="Complementary filter fusing drifting gyro and noisy accelerometer into a clean estimate"></p>

<h3>Step-by-Step Procedure</h3>
<ol>
<li><strong>Switch to the 3 &middot; Sensor Fusion tab.</strong> Your airframe selection carries over automatically.</li>
<li><strong>Select an IMU.</strong> Use the <strong>IMU</strong> selector (MPU-6000, ICM-20602, BMI270, MPU-9250). Its gyro bias, accelerometer noise and sample rate populate the model. Start with the reference <strong>MPU-6000</strong>.</li>
<li><strong>Watch the twin drones.</strong> The solid drone in the 3-D view holds the <strong>true</strong> commanded attitude; a translucent <strong>ghost drone</strong> shows the fused <strong>estimate</strong> &theta;&#770; banking alongside it. The scope plot overlays the same <strong>true angle</strong>, the <strong>gyro-only estimate</strong> (smooth but slowly drifting away), the <strong>accelerometer angle</strong> (correct on average but noisy), and the <strong>fused estimate</strong>.</li>
<li><strong>Sweep the blend coefficient.</strong> Drag the <strong>Blend coefficient &alpha;</strong> slider through 0.90, 0.95, 0.98, 0.99. Read the live <strong>time constant &tau;<sub>f</sub></strong>, <strong>drift</strong>, <strong>noise RMS</strong> and <strong>total error</strong>. Confirm the total error is <strong>minimised at &alpha; = 0.98</strong> (&asymp; 0.25&deg;) for the reference IMU.</li>
<li><strong>See unbounded drift.</strong> Set &alpha; = 1.0 (pure gyro). The ghost drone visibly <strong>peels away</strong> from the solid true-attitude drone and keeps peeling — a drift of ~18&deg; over 30 s — the failure the accelerometer reference prevents.</li>
<li><strong>Verify completion.</strong> The right panel confirms the chosen IMU, the optimal &alpha;, and the final attitude-estimate error. This is the estimate the next tab actually flies on.</li>
</ol>

<hr>

<h2>Stage 5: The Full System — Hunting the Best Flight Controller (Tab 4 &middot; Full System)</h2>

<h3>Objective</h3>
<p>Close the loop for real: the controller acts on the <strong>estimate</strong>, not the truth. Fly every controller &times; estimator combination and use the live leaderboard to find the best flight-control system for the current build and conditions.</p>

<p><img src="./images/closed_loop_full_system.png" alt="Full-system closed loop showing the controller acting on the attitude estimate, not the true angle"></p>

<h3>Step-by-Step Procedure</h3>
<ol>
<li><strong>Switch to the 4 &middot; Full System tab.</strong> The config panel now shows a <strong>Controller</strong> picker (Manual PID / ZN-Classic / ZN-Tyreus) and an <strong>Estimator</strong> picker (Complementary &alpha; / Gyro-only / Accel-only), plus the shared IMU, air-resistance and wind controls.</li>
<li><strong>Fly the default combination.</strong> With Manual PID + Complementary &alpha; selected, read the <strong>Score</strong>, <strong>Tracking RMS</strong> (true angle vs command) and <strong>Estimator RMS</strong> (true angle vs estimate) in the results panel. On the reference build this scores in the high 90s.</li>
<li><strong>Force a bad estimator.</strong> Click the <strong>Gyro-only</strong> button. The same gains now chase a drifting attitude: tracking RMS jumps from ~0.2&deg; to ~1.8&deg;, the response never settles within the 2&deg; band, and the score collapses into the 50s — the <strong>gains never changed</strong>, only what they could see.</li>
<li><strong>Read the leaderboard.</strong> The right panel lists all <strong>nine controller &times; estimator combinations</strong>, ranked live by score, with the current selection and the leaderboard leader both highlighted. Click any row to fly that combination immediately.</li>
<li><strong>Confirm the pattern.</strong> Every complementary-filter row scores in the high 90s regardless of controller; every gyro-only row collapses to the 50s regardless of controller. The estimator choice dominates the controller choice — the leaderboard makes this a visible, sortable fact rather than an assertion.</li>
<li><strong>Stress it.</strong> Raise <strong>air resistance</strong> and <strong>wind-gust torque</strong>, or switch to a different <strong>IMU</strong> preset, and watch the leaderboard re-rank live. If Experiment 4 finalized with an uncalibrated ESC, an actuation-offset fault is programmed into this loop automatically — the integral term visibly works harder to trim it out.</li>
<li><strong>Lock in the best system.</strong> Select the leaderboard's top row and confirm the verdict reads <strong>"Best flight control system."</strong> Your chosen controller, estimator, gains and blend coefficient — along with the discovered K<sub>u</sub>/P<sub>u</sub>, rise time, steady-state error, IMU preset and any ESC dead-band — are saved to the unified store, completing <strong>Experiment 5</strong> and handing a real, stress-tested flight-control configuration to the remaining experiments.</li>
</ol>
