<h1>Theoretical Background: Drone Battery Pack Energy Storage &amp; Discharge Behaviour</h1>

<p>A multirotor's propulsion system is only as good as the pack feeding it. The same motor and propeller combination can be perfectly safe on one battery and destroy a cell on another, because a LiPo pack is not a fixed voltage source — it is a chemical cell with a rate-dependent capacity, an internal resistance that swells as it empties, and a hard current ceiling set by its construction. This chapter works through the four things that actually limit a pack in service: how much current it can sustain without venting, how far its terminal voltage sags under that current, how much of its printed capacity is really available at a given discharge rate, and how that capacity converts into minutes of hover time once the pack's own mass is accounted for.</p>

<blockquote>
<p><strong>Note on the build used throughout this chapter.</strong> Every worked example below uses the same coherent build: four 1806-2300KV motors, four 5" tri-blade propellers (4.3" pitch), four Cyclone 35A ESCs, an X-Quad 5" chassis, a PiHawk v2 autopilot and a CM703 receiver — a 671.2 g all-up mass before the battery choice is applied. Only the battery pack changes between examples, which is deliberate: it isolates exactly what a pack's C-rating and internal resistance change about a fixed airframe. All numbers are computed directly from the governing equations below (not hand-rounded), so they match what the simulator's own solver produces for the same build.</p>
</blockquote>

<hr>

<h2>1. Pack Voltage, C-Rating &amp; the Continuous Discharge Limit</h2>

<p>A LiPo cell's printed capacity (in mAh) says how much charge it holds, not how fast it can safely give that charge up. The rate limit is the C-rating, and it comes in two flavours on every pack's label: a continuous rating the cell can sustain indefinitely without damage, and a higher burst rating it can survive only for a few seconds before the electrolyte starts to break down. Both are defined relative to the pack's own capacity:</p>

<p align="center"><i>I</i><sub>cont</sub> = <i>C</i><sub>rating,cont</sub> &middot; <i>Capacity</i><sub>Ah</sub> &nbsp;&nbsp;&nbsp; <i>I</i><sub>burst</sub> = <i>C</i><sub>rating</sub> &middot; <i>Capacity</i><sub>Ah</sub></p>

<p>A 3300 mAh pack rated 15C continuous can sustain 3.3 &times; 15 = 49.5 A forever; a 130C race pack of a third the capacity can burst to over 190 A. The number that matters is whichever current the airframe actually pulls at full throttle — computed the same way Module 1's propulsion solve gets it, from the coupled motor/propeller/pack circuit, not assumed. If the sustained draw is above <i>I</i><sub>cont</sub>, the cells are working harder than their construction allows: internal heating outruns the pack's ability to shed it, the electrolyte gasses off, and the pouch swells. The bench test enforces this with a timer, not an instant cutoff — a current spike is normal during a throttle ramp, but 3 seconds of sustained over-continuous draw is treated as real: <code>"Battery vented — sustained &lt;I&gt; A draw exceeds the &lt;I_cont&gt; A continuous rating (&lt;C&gt;C pack). Cells overheated and swelled."</code></p>

<h3>Worked Example — C-Rating Margin, Two Packs on the Same Airframe</h3>

<p>The 1806/5" build above draws a real full-throttle current of <i>I</i><sub>total</sub> = 116.2 A once the motor/propeller/pack circuit is solved (Section&nbsp;3 shows exactly how). Checking that against the default 4S 3300 mAh pack (15C continuous / 25C burst):</p>

<table>
<thead><tr><th>Quantity</th><th>Substitution</th><th>Result</th></tr></thead>
<tbody>
<tr><td><i>I</i><sub>cont</sub></td><td>15C &middot; 3.30 Ah</td><td>49.5 A</td></tr>
<tr><td><i>I</i><sub>burst</sub></td><td>25C &middot; 3.30 Ah</td><td>82.5 A</td></tr>
<tr><td><i>I</i><sub>total</sub> (actual draw)</td><td>solved 4-motor circuit</td><td>116.2 A</td></tr>
</tbody>
</table>

<p>116.2 A is more than double the 49.5 A continuous rating and still above the 82.5 A burst ceiling — this pack vents on this airframe. The fix isn't more capacity, it's more C-rating: swap in the 4S 1500 mAh high-C pack (100C continuous / 130C burst) and the same motors now draw 133.9 A against a 150 A continuous limit — 10.7% headroom, a clean pass, off a pack with <em>less</em> than half the mAh. Capacity and discharge capability are independent specs, and a bigger-mAh, lower-C pack can be the more dangerous choice on a hard-pulling airframe. Figure 1 lays out all four catalog packs against this exact build.</p>

<p><img src="./images/crate_safety_margins.png" alt="C-Rating safety margins across four catalog battery packs"></p>

<hr>

<h2>2. Internal Resistance &amp; Voltage Sag Under Load</h2>

<p>Every real cell has some internal resistance, and every amp drawn through it costs voltage. The open-circuit voltage a cell would show with no load follows a curve set by lithium-cobalt electrochemistry — steep near full charge and near empty, flat through the middle:</p>

<p align="center"><i>V</i><sub>oc,cell</sub> = 3.50 + 0.70 &middot; <i>SoC</i> + 0.10 &middot; <i>SoC</i><sup>3</sup></p>

<p>Under load, the terminal voltage the ESC actually sees is lower than this by the ohmic drop across the pack's internal resistance:</p>

<p align="center"><i>V</i><sub>terminal</sub> = <i>N</i><sub>cells</sub> &middot; (<i>V</i><sub>oc,cell</sub> &minus; <i>I</i> &middot; <i>R</i><sub>cell,eff</sub>)</p>

<p>with the pack resistance built from each cell's catalog <code>cell_ir_mohm</code> rating, plus a swell term that grows sharply as the cell empties (chemical reaction rates slow near depletion, so the effective resistance is worse at low SoC than at full charge):</p>

<p align="center"><i>R</i><sub>pack</sub> = <i>N</i><sub>cells</sub> &middot; <i>R</i><sub>cell,eff</sub> &nbsp;&nbsp;&nbsp; <i>R</i><sub>cell,eff</sub> = <i>R</i><sub>cell,nominal</sub> &middot; (1 + 0.25 &middot; <i>e</i><sup>5&middot;(0.3&minus;<i>SoC</i>)</sup>)</p>

<p>A cell's <code>cell_ir_mohm</code> spec is not incidental — it's the same physical property that sets the C-rating. A high-C race pack uses thicker current collectors and lower-resistance electrolyte specifically to keep this number small; a budget storage pack trades that away for cheaper construction and higher capacity per cell, which is why its <code>cell_ir_mohm</code> reads several times higher. The bench test calls a sustained sag below 3.30 V/cell for 1.5 s an ESC brownout (RPM collapses as available voltage falls below what the motor needs to keep spinning against load), and requires at least 3.50 V/cell at full draw to pass cleanly.</p>

<h3>Worked Example — Sag on a Healthy Pack vs. a High-Resistance One</h3>

<p>The default 4S 3300 mAh pack carries 6.5 m&Omega;/cell. At full SoC the swell term is negligible, so <i>R</i><sub>cell,eff</sub> &asymp; 6.5 &middot; 1.0075 &asymp; 6.55 m&Omega;, giving <i>R</i><sub>pack</sub> = 4 &middot; 6.55 m&Omega; &asymp; 26.2 m&Omega;. At the same 116.2 A full-throttle draw from Section 1:</p>

<table>
<thead><tr><th>Quantity</th><th>Substitution</th><th>Result</th></tr></thead>
<tbody>
<tr><td><i>V</i><sub>oc</sub> (pack, SoC=1)</td><td>4 &middot; (3.50+0.70+0.10)</td><td>17.20 V</td></tr>
<tr><td><i>I</i> &middot; <i>R</i><sub>pack</sub></td><td>116.2 &middot; 0.0262</td><td>3.04 V</td></tr>
<tr><td><i>V</i><sub>terminal</sub></td><td>17.20 &minus; 3.04</td><td>14.16 V</td></tr>
<tr><td>per-cell</td><td>14.16 / 4</td><td>3.541 V/cell</td></tr>
</tbody>
</table>

<p>3.541 V/cell clears the 3.50 V/cell pass floor, but only by 0.041 V — this pack is marginal even though it isn't the one flagged for a C-rating fault. Now swap in the 4S 1300 mAh low-C pack (24 m&Omega;/cell — nearly 4&times; the resistance): its own full-throttle draw is lower (79.4 A, since the higher resistance itself throttles the achievable current) but <i>R</i><sub>pack</sub> works out to 96.7 m&Omega;, and the loaded terminal voltage collapses to the solver's 2.8 V/cell floor — deep past the 3.30 V/cell brownout line before the throttle ramp even finishes. Figure 2 plots the real nonlinear sag curve for both packs against the brownout and pass thresholds.</p>

<p><img src="./images/battery_circuit_and_sag.png" alt="Battery pack equivalent circuit and voltage sag curve"></p>

<hr>

<h2>3. Peukert-Style Derating: Why a Pack Delivers Less Than Its Nameplate mAh</h2>

<p>A cell's printed capacity is measured at a slow, gentle discharge rate — the kind a capacity tester uses, not the kind a quadcopter's motors demand. Draw a cell harder and its usable capacity actually shrinks: this is the practical, empirical form of Peukert's law, and it hits low-C packs hardest because the same high internal resistance that limits their safe current also means more of the battery's stored energy is lost to internal heating before it ever reaches the motor. The model here scales a derating factor directly off the pack's own continuous C-rating — a genuinely low-C pack is also a high-IR pack, so it is penalised twice, once on safe current and once on real deliverable capacity:</p>

<p align="center"><i>peukertFactor</i>(<i>C</i><sub>rating,cont</sub>) =</p>
<ul>
<li>1.00, for <i>C</i><sub>rating,cont</sub> &ge; 30C — a race-grade pack tracks its nameplate almost exactly</li>
<li>0.90 &rarr; 1.00 (linear), for 20C &le; <i>C</i><sub>rating,cont</sub> &lt; 30C</li>
<li>0.72 &rarr; 0.90 (linear), for 12C &le; <i>C</i><sub>rating,cont</sub> &lt; 20C</li>
<li>0.70, for <i>C</i><sub>rating,cont</sub> &lt; 12C — a genuinely undersized pack</li>
</ul>

<p align="center"><i>Capacity</i><sub>effective</sub> = <i>Capacity</i><sub>nameplate</sub> &middot; <i>peukertFactor</i></p>

<p>This is the gap between what the label says and what a coulomb counter watching real cell voltage will actually measure before the pack is empty.</p>

<h3>Worked Example — Effective Capacity Across the Catalog</h3>

<table>
<thead><tr><th>Pack</th><th>C<sub>rating,cont</sub></th><th>peukertFactor</th><th>Nameplate</th><th>Effective</th></tr></thead>
<tbody>
<tr><td>4S 3300 mAh (default)</td><td>15C</td><td>0.7875</td><td>3300 mAh</td><td>2599 mAh (&minus;21.3%)</td></tr>
<tr><td>4S 1300 mAh (low-C)</td><td>12C</td><td>0.7200</td><td>1300 mAh</td><td>936 mAh (&minus;28.0%)</td></tr>
<tr><td>4S 1500 mAh (high-C)</td><td>100C</td><td>1.0000</td><td>1500 mAh</td><td>1500 mAh (&minus;0.0%)</td></tr>
<tr><td>6S 5000 mAh</td><td>22C</td><td>0.9200</td><td>5000 mAh</td><td>4600 mAh (&minus;8.0%)</td></tr>
</tbody>
</table>

<p>The default pack — the one that already fails its C-rating check on this airframe — also only delivers about 2.6 Ah of its printed 3.3 Ah once real bench-load current is drawn from it. This effective-capacity number is what actually governs both the state-of-charge estimate in the next section and the endurance number in the last one; the nameplate figure printed on the wrapper is optimistic by construction. Figure 3 (left panel) shows all four packs' nameplate-vs-effective bars.</p>

<p><img src="./images/peukert_derating_soc.png" alt="Peukert-derated effective capacity and over-discharge risk across battery packs"></p>

<hr>

<h2>4. Coulomb Counting &amp; State-of-Charge Estimation</h2>

<p>A coulomb counter tracks state of charge by integrating current over time and comparing the charge removed against a reference capacity: <i>SoC</i>(<i>t</i>) = <i>SoC</i>(0) &minus; &int; <i>I</i> <i>dt</i> / <i>Capacity</i><sub>ref</sub>. The catch is which capacity gets used as the reference. A cheap fuel-gauge circuit — like the rig's own automatic cutoff — counts against the printed nameplate figure, because that's the only number it has. A true accounting instead needs the Peukert-derated effective capacity from Section 3. Running both counters in parallel from the same current draw exposes the gap directly:</p>

<p align="center"><i>SoC</i><sub>naive</sub> = <i>SoC</i><sub>naive</sub> &minus; <sup>&Delta;<i>Ah</i></sup>&frasl;<sub><i>Capacity</i><sub>nameplate</sub></sub> &nbsp;&nbsp;&nbsp; <i>SoC</i><sub>true</sub> = <i>SoC</i><sub>true</sub> &minus; <sup>&Delta;<i>Ah</i></sup>&frasl;<sub><i>Capacity</i><sub>effective</sub></sub></p>

<p>A second, independent way to read SoC is straight off loaded cell voltage. A naive rig reads it linearly across the nominal voltage window; the true relationship has to invert the nonlinear OCV curve from Section 2, which is far flatter through the middle of the discharge than at the ends:</p>

<p align="center"><i>SoC</i><sub>naive,V</sub> = <sup>(<i>V</i><sub>cell</sub> &minus; 3.5)</sup>&frasl;<sub>(4.2 &minus; 3.5)</sub> &middot; 100%</p>

<table>
<thead><tr><th><i>V</i><sub>cell</sub></th><th>naive (linear) SoC%</th><th>true (OCV-inverted) SoC%</th></tr></thead>
<tbody>
<tr><td>4.20 V</td><td>100.0%</td><td>89.7%</td></tr>
<tr><td>4.00 V</td><td>71.4%</td><td>67.1%</td></tr>
<tr><td>3.80 V</td><td>42.9%</td><td>41.8%</td></tr>
<tr><td>3.70 V</td><td>28.6%</td><td>28.3%</td></tr>
<tr><td>3.50 V</td><td>0.0%</td><td>0.0%</td></tr>
</tbody>
</table>

<p>The two tracks agree at the extremes and diverge most in the middle, exactly where the OCV curve is flattest and a small voltage error maps to a large SoC error. The discharge rig itself watches only the naive nameplate-referenced count and cuts the run automatically once it reads 20% — a sensible, conservative rule for a pack whose effective capacity roughly matches its nameplate. It fails for a pack that doesn't.</p>

<h3>Worked Example — Over-Discharge on the Low-C Pack</h3>

<p>The true pack empties (<i>SoC</i><sub>true</sub> &rarr; 0) once drawn charge equals the <em>effective</em> capacity, which happens at a naive reading of exactly (1 &minus; <i>peukertFactor</i>) &times; 100%. For the low-C 4S 1300 mAh pack, that's 1 &minus; 0.72 = 28% — the real cells are empty while the rig's own gauge still claims 28% remaining, eight full points above the 20% auto-cut. Working the actual cell voltage at that moment, at the representative 6C bench load (<i>I</i><sub>load</sub> = 7.8 A) and the swollen near-empty resistance (48.3 m&Omega;/cell):</p>

<table>
<thead><tr><th>Quantity</th><th>Substitution</th><th>Result</th></tr></thead>
<tbody>
<tr><td><i>V</i><sub>oc</sub> (pack, SoC&asymp;0)</td><td>4 &middot; 3.514</td><td>14.06 V</td></tr>
<tr><td><i>I</i><sub>load</sub> &middot; <i>R</i><sub>pack</sub></td><td>7.8 &middot; 0.1933</td><td>1.51 V</td></tr>
<tr><td><i>V</i><sub>pack,loaded</sub></td><td>14.06 &minus; 1.51</td><td>12.55 V</td></tr>
<tr><td>per-cell</td><td>12.55 / 4</td><td>3.14 V/cell</td></tr>
</tbody>
</table>

<p>3.14 V/cell is already well past the 3.5 V/cell over-discharge floor while the naive readout is still comfortably above its own 20% cutoff — precisely the fault the rig is built to catch: <code>"Cell over-discharged — true SoC hit the 3.5 V/cell floor while the naive nameplate readout still showed 28% remaining (Peukert-derated pack, 12C). Cell puffed — permanent damage."</code> The default 4S 3300 mAh pack sits right at the edge of this same failure (1 &minus; 0.7875 = 21.25%, just over the 20% cutoff — a 1.25-point margin), while the high-C 4S 1500 mAh pack never has the problem at all (0% overhang: true and naive tracks coincide, so the auto-cut always fires first). Figure 3's right panel plots this overhang against the cutoff line for all four packs.</p>

<hr>

<h2>5. Endurance &amp; the Hover Flight Energy Budget</h2>

<p>Flight endurance is not simply nameplate capacity divided by hover current — a bigger battery is also a heavier one, and a heavier airframe needs more thrust to hover, which pulls more current, which eats into the very capacity gain the bigger pack was supposed to provide. The nominal energy budget uses a flat 3.7 V/cell reference regardless of chemistry curve detail (a standard bookkeeping simplification, not the loaded voltage from Section 2):</p>

<p align="center"><i>E</i><sub>total</sub> = <i>Capacity</i><sub>Ah</sub> &middot; <i>N</i><sub>cells</sub> &middot; 3.7 V &middot; 3600 s/h &nbsp; [J]</p>

<p>Endurance itself is derived from the pack's usable 80% depth of discharge (LiPo packs are not run to true zero — 20% is reserved as the same safety floor the SoC rig enforces) divided by the true hover current, not an assumed one. The hover current comes from re-solving the exact same coupled motor/propeller/pack circuit from Section 1, bisecting throttle until thrust matches the new, heavier all-up weight:</p>

<p align="center"><i>T</i><sub>flight</sub> = <sup>(<i>Capacity</i><sub>Ah</sub> &middot; 0.80)</sup>&frasl;<sub><i>I</i><sub>hover</sub></sub> &middot; 60 &nbsp; [min]</p>

<p>Because a bigger pack is heavier, <i>I</i><sub>hover</sub> itself rises with capacity — this is what makes the capacity-to-endurance curve sub-linear instead of a straight proportional line, and it's also what can eliminate hover altogether if pushed too far (thrust-to-weight below 1.0 is a flat "cannot hover" fault, no matter how much energy the pack holds).</p>

<h3>Worked Example — Diminishing Returns on the 1806/5" Airframe</h3>

<p>Scaling the default 4S 3300 mAh pack's own mass density (320 g / 3300 mAh &asymp; 0.097 g/mAh) up to 1.5&times; and 2&times; its capacity, and re-solving hover for each:</p>

<table>
<thead><tr><th>Capacity</th><th>Pack mass</th><th>All-up mass</th><th><i>I</i><sub>hover</sub></th><th>Endurance</th></tr></thead>
<tbody>
<tr><td>3300 mAh (1&times;)</td><td>320 g</td><td>671 g</td><td>30.33 A</td><td>5.22 min</td></tr>
<tr><td>4950 mAh (1.5&times;)</td><td>480 g</td><td>831 g</td><td>36.71 A</td><td>6.47 min</td></tr>
<tr><td>6600 mAh (2&times;)</td><td>640 g</td><td>991 g</td><td>43.05 A</td><td>7.36 min</td></tr>
</tbody>
</table>

<p>Doubling capacity moves endurance from 5.22 to 7.36 minutes — a 1.41&times; gain, not 2&times;. A naive straight-line projection off the first point would have predicted 10.44 minutes at 6600 mAh; the real number falls almost 30% short of that because the extra 320 g of battery raised the hover throttle point and, with it, the current every one of those extra milliamp-hours has to be spent against. Past some capacity the added mass stops paying for itself at all — this is the physical reason "bigger battery" is not a universal upgrade on a fixed airframe. Figure 4 plots the real curve against the naive linear projection.</p>

<p><img src="./images/endurance_diminishing_returns.png" alt="Endurance vs battery capacity showing sub-linear diminishing returns"></p>
