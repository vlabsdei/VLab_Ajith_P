# Theory: Flight Control — PID Tuning, Ziegler–Nichols & Sensor Fusion

A multirotor is **open-loop unstable**: with no active control a quadcopter cannot hold its attitude, because the smallest disturbance torque integrates unchecked into a tumble. Stable flight is therefore created entirely by the **flight-control loop** running on the autopilot — it reads the vehicle's attitude many hundreds of times per second, compares it with the pilot's command, and continuously trims the four motor thrusts to drive the error to zero. This experiment builds that loop from the ground up: the **PID controller** that generates the corrective torque, the **Ziegler–Nichols** procedure that gives a first set of gains automatically, and the **complementary filter** that fuses the gyroscope and accelerometer into the clean attitude estimate the controller depends on.

---

## **1. The Attitude Control Problem**

Consider rotation about a single axis — the **roll** axis. Newton's second law for rotation states that the net torque equals the moment of inertia times the angular acceleration:

<p align="center"><i>&tau;</i> = <i>J</i> &middot; <i>&theta;&#776;</i></p>

where <i>J</i> is the roll-axis moment of inertia [kg&middot;m<sup>2</sup>] and <i>&theta;</i> is the roll angle [rad]. Rearranging, the angle is the **double integral** of the applied torque:

<p align="center"><i>&theta;</i>(<i>s</i>) / <i>&tau;</i>(<i>s</i>) = 1 / (<i>J s</i><sup>2</sup>)</p>

This plant — a **double integrator** — is the root of the instability. It has two poles at the origin, so any constant disturbance torque produces an angle that grows without bound. The controller's job is to manufacture a restoring torque that pulls the two poles into the stable left-half plane.

![PID attitude control loop block diagram](./images/pid_control_loop.png)

Real autopilots use a **cascaded** structure: an outer **angle loop** (commanding a desired angular rate from the attitude error) wrapped around an inner **rate loop** (commanding motor torque from the rate error). Section 2–4 analyse the angle loop's closed-loop response; Section 5–6 tune the inner rate loop with Ziegler–Nichols; Section 7 builds the attitude estimate both loops feed on.

---

## **2. The PID Controller & the Second-Order Closed Loop**

The Proportional–Integral–Derivative controller forms the corrective torque from three terms of the error <i>e</i> = <i>&theta;</i><sub>cmd</sub> &minus; <i>&theta;</i>:

<p align="center"><i>C</i>(<i>s</i>) = <i>K</i><sub>p</sub> + <i>K</i><sub>i</sub> / <i>s</i> + <i>K</i><sub>d</sub> <i>s</i></p>

* **Proportional** (<i>K</i><sub>p</sub>): torque proportional to the present error — the main restoring spring.
* **Integral** (<i>K</i><sub>i</sub>): torque proportional to the accumulated past error — eliminates steady offsets.
* **Derivative** (<i>K</i><sub>d</sub>): torque proportional to the rate of change of error — electronic damping that tames overshoot.

With proportional + derivative action on the inertia plant, the closed loop becomes the textbook **second-order prototype** <i>s</i><sup>2</sup> + 2<i>&zeta;&omega;</i><sub>n</sub><i>s</i> + <i>&omega;</i><sub>n</sub><sup>2</sup>, where the two design quantities map directly onto the gains:

<p align="center"><i>&omega;</i><sub>n</sub> = &radic;(<i>K</i><sub>p</sub> / <i>J</i>) &nbsp;&nbsp;&nbsp; <i>&zeta;</i> = <i>K</i><sub>d</sub> / (2&radic;(<i>K</i><sub>p</sub> <i>J</i>))</p>

<i>&omega;</i><sub>n</sub> is the **natural frequency** (how fast the loop responds) and <i>&zeta;</i> is the **damping ratio** (how oscillatory it is). Raising <i>K</i><sub>p</sub> speeds the loop but reduces damping; raising <i>K</i><sub>d</sub> adds damping.

#### Where does <i>J</i> come from? — the build inherited from Experiment 2

The moment of inertia is not a free parameter; it follows from the airframe you assembled. Modelling an X-quad as its four motors lumped at the arm radius <i>L</i>, each 45&deg; from the roll axis (perpendicular distance <i>L</i>/&radic;2):

<p align="center"><i>J</i> = 4 &middot; (<i>m</i>/4) &middot; (<i>L</i>/&radic;2)<sup>2</sup> = <i>m L</i><sup>2</sup> / 2</p>

> **Worked example — roll inertia of the 5&Prime; reference airframe.**
> Taking the take-off mass <i>m</i> = 0.5 kg and arm length <i>L</i> = 110 mm = 0.110 m inherited from Experiment 2:
> <p align="center"><i>J</i> = (0.5 &times; 0.110<sup>2</sup>) / 2 = (0.5 &times; 0.0121) / 2 = <b>0.00303 kg&middot;m<sup>2</sup></b> &asymp; 0.003 kg&middot;m<sup>2</sup></p>
> Every worked example below uses this <i>J</i> = 0.003 kg&middot;m<sup>2</sup>. A heavier or larger airframe raises <i>J</i> (the 10&Prime; heavy-lift preset is ~16&times; larger), which slows the loop for the same gains.

> **Worked example — natural frequency and damping at the default gains.**
> With <i>K</i><sub>p</sub> = 0.6 N&middot;m/rad, <i>K</i><sub>d</sub> = 0.04 N&middot;m&middot;s/rad and <i>J</i> = 0.003 kg&middot;m<sup>2</sup>:
> <p align="center"><i>&omega;</i><sub>n</sub> = &radic;(0.6 / 0.003) = &radic;200 = <b>14.14 rad/s</b></p>
> <p align="center"><i>&zeta;</i> = 0.04 / (2&radic;(0.6 &times; 0.003)) = 0.04 / (2 &times; 0.04243) = <b>0.471</b></p>
> A damping ratio of 0.47 is moderately underdamped — fast, with a modest overshoot we quantify next.

---

## **3. Step-Response Metrics**

When the pilot commands a step change in attitude, the closed-loop response is judged by four numbers, each a closed-form function of <i>&omega;</i><sub>n</sub> and <i>&zeta;</i>:

| Metric | Formula | Meaning |
| :--- | :--- | :--- |
| Peak overshoot | <i>M</i><sub>p</sub> = 100 &middot; <i>e</i><sup>&minus;&pi;&zeta;/&radic;(1&minus;&zeta;<sup>2</sup>)</sup> % | how far past the target it swings |
| Peak time | <i>t</i><sub>p</sub> = &pi; / (<i>&omega;</i><sub>n</sub>&radic;(1&minus;&zeta;<sup>2</sup>)) | when the first peak occurs |
| Rise time | <i>t</i><sub>r</sub> = (&pi; &minus; cos<sup>&minus;1</sup><i>&zeta;</i>) / (<i>&omega;</i><sub>n</sub>&radic;(1&minus;&zeta;<sup>2</sup>)) | 0&rarr;100% of the first rise |
| Settling time (2%) | <i>t</i><sub>s</sub> = 4 / (<i>&zeta;&omega;</i><sub>n</sub>) | when it stays within &plusmn;2% |

> **Worked example — metrics at <i>K</i><sub>p</sub> = 0.6, <i>K</i><sub>d</sub> = 0.04.**
> Using <i>&omega;</i><sub>n</sub> = 14.14 rad/s and <i>&zeta;</i> = 0.471:
> <p align="center"><i>M</i><sub>p</sub> = 100 <i>e</i><sup>&minus;&pi;&times;0.471/&radic;(1&minus;0.471<sup>2</sup>)</sup> = 100 <i>e</i><sup>&minus;1.680</sup> = <b>18.65 %</b></p>
> <p align="center"><i>t</i><sub>p</sub> = &pi; / (14.14 &times; 0.882) = <b>0.252 s</b> &nbsp;&nbsp; <i>t</i><sub>r</sub> = <b>0.165 s</b> &nbsp;&nbsp; <i>t</i><sub>s</sub> = 4 / (0.471 &times; 14.14) = <b>0.60 s</b></p>

![PID step response showing overshoot, rise and settling time](./images/step_response_metrics.png)

#### The <i>K</i><sub>p</sub>-overshoot trade-off

Holding <i>K</i><sub>d</sub> = 0.04 fixed and sweeping <i>K</i><sub>p</sub> reveals the central tuning tension — more proportional gain is faster but rings harder:

| <i>K</i><sub>p</sub> | <i>&omega;</i><sub>n</sub> (rad/s) | <i>&zeta;</i> | Overshoot | Settling <i>t</i><sub>s</sub> |
| :---: | :---: | :---: | :---: | :---: |
| 0.2 | 8.16 | 0.816 | 1.18 % | 0.60 s |
| 0.4 | 11.55 | 0.577 | 10.85 % | 0.60 s |
| 0.6 | 14.14 | 0.471 | 18.65 % | 0.60 s |
| 0.8 | 16.33 | 0.408 | 24.54 % | 0.60 s |
| 1.0 | 18.26 | 0.365 | 29.16 % | 0.60 s |

Overshoot climbs past the **25% comfort limit** near <i>K</i><sub>p</sub> = 0.8. A subtle but important result: the **settling time is constant at 0.60 s** across the whole sweep, because the decay rate <i>&zeta;&omega;</i><sub>n</sub> = <i>K</i><sub>d</sub>/(2<i>J</i>) = 0.04/(2&times;0.003) = 6.67 s<sup>&minus;1</sup> depends only on <i>K</i><sub>d</sub> and <i>J</i>, not on <i>K</i><sub>p</sub>. To settle faster you must raise the derivative gain, not the proportional gain.

---

## **4. Steady-State Error & the Role of Integral Action**

A perfectly trimmed quad still tilts under a **constant disturbance torque** — an off-centre payload, a shifted battery, or a steady crosswind. A horizontal centre-of-gravity offset <i>d</i> under gravity creates the couple:

<p align="center"><i>&tau;</i><sub>d</sub> = <i>m</i> &middot; <i>g</i> &middot; <i>d</i></p>

With proportional control alone, the loop can only hold a counter-torque by accepting a permanent angle error — the **steady-state error**:

<p align="center"><i>e</i><sub>ss</sub> = <i>&tau;</i><sub>d</sub> / <i>K</i><sub>p</sub></p>

> **Worked example — droop from the Experiment-2 CG offset.**
> The CG offset measured in Experiment 2 is <i>d</i> = 3.57 mm, so on the 0.5 kg airframe:
> <p align="center"><i>&tau;</i><sub>d</sub> = 0.5 &times; 9.807 &times; 0.00357 = <b>0.0175 N&middot;m</b></p>
> The resulting steady tilt shrinks as <i>K</i><sub>p</sub> rises:
>
> | <i>K</i><sub>p</sub> | <i>e</i><sub>ss</sub> (rad) | <i>e</i><sub>ss</sub> (deg) |
> | :---: | :---: | :---: |
> | 0.2 | 0.0875 | 5.01&deg; |
> | 0.6 | 0.0292 | 1.67&deg; |
> | 1.0 | 0.0175 | 1.00&deg; |
>
> Higher <i>K</i><sub>p</sub> reduces the droop but, from Section 3, worsens overshoot — you cannot win on both with proportional gain alone.

The escape is the **integral term**. Because <i>K</i><sub>i</sub>/<i>s</i> keeps accumulating as long as any error remains, it injects an ever-growing counter-torque until the error is driven to **exactly zero**. Adding even a small <i>K</i><sub>i</sub> nulls the steady-state tilt while <i>K</i><sub>p</sub> and <i>K</i><sub>d</sub> set the transient — the reason every real attitude loop is a full PID, not just PD.

---

## **5. Ziegler–Nichols Auto-Tuning**

Choosing three gains by hand is tedious. The **Ziegler–Nichols ultimate-cycle method** finds a starting set from a single experiment: raise the proportional gain until the loop **oscillates with constant amplitude**; record that gain as the **ultimate gain** <i>K</i><sub>u</sub> and the oscillation period as the **ultimate period** <i>P</i><sub>u</sub>; then read the gains from a table.

#### Why the method needs the real plant lags

A pure inertia plant 1/(<i>J s</i><sup>2</sup>) under proportional control has its poles sitting **exactly on the imaginary axis at every gain** — it oscillates at *all* <i>K</i><sub>p</sub>, so <i>K</i><sub>u</sub> is undefined. The ultimate-gain method only works because the real inner rate loop carries additional **first-order lags**: the rotational/mechanical lag <i>&tau;</i><sub>m</sub>, the motor + ESC actuator lag <i>&tau;</i><sub>a</sub>, and the gyro/filter lag <i>&tau;</i><sub>s</sub>. The rate-loop plant is therefore a Type-0 chain:

<p align="center"><i>P</i>(<i>s</i>) = 1 / [(<i>&tau;</i><sub>m</sub><i>s</i> + 1)(<i>&tau;</i><sub>a</sub><i>s</i> + 1)(<i>&tau;</i><sub>s</sub><i>s</i> + 1)]</p>

Routh's criterion on this third-order loop gives closed-form crossing conditions:

<p align="center"><i>&omega;</i><sub>u</sub> = &radic;[ (<i>&tau;</i><sub>m</sub>+<i>&tau;</i><sub>a</sub>+<i>&tau;</i><sub>s</sub>) / (<i>&tau;</i><sub>m</sub><i>&tau;</i><sub>a</sub><i>&tau;</i><sub>s</sub>) ] &nbsp;&nbsp;&nbsp; <i>P</i><sub>u</sub> = 2&pi; / <i>&omega;</i><sub>u</sub></p>
<p align="center"><i>K</i><sub>u</sub> = [ (<i>&tau;</i><sub>m</sub><i>&tau;</i><sub>a</sub> + <i>&tau;</i><sub>m</sub><i>&tau;</i><sub>s</sub> + <i>&tau;</i><sub>a</sub><i>&tau;</i><sub>s</sub>)(<i>&tau;</i><sub>m</sub>+<i>&tau;</i><sub>a</sub>+<i>&tau;</i><sub>s</sub>) / (<i>&tau;</i><sub>m</sub><i>&tau;</i><sub>a</sub><i>&tau;</i><sub>s</sub>) &minus; 1 ] / <i>K</i></p>

> **Worked example — ultimate gain and period (5&Prime; airframe).**
> With <i>&tau;</i><sub>m</sub> = 0.05 s, <i>&tau;</i><sub>a</sub> = 0.02 s, <i>&tau;</i><sub>s</sub> = 0.005 s and unit DC gain:
> <p align="center"><i>&omega;</i><sub>u</sub> = &radic;(0.075 / 5&times;10<sup>&minus;6</sup>) = &radic;15000 = <b>122.5 rad/s</b> &rarr; <i>P</i><sub>u</sub> = 2&pi;/122.5 = <b>0.0513 s</b></p>
> <p align="center"><i>K</i><sub>u</sub> = (0.00135 &times; 0.075 / 5&times;10<sup>&minus;6</sup>) &minus; 1 = 20.25 &minus; 1 = <b>19.25</b></p>

The **classic Ziegler–Nichols PID table** then prescribes:

<p align="center"><i>K</i><sub>p</sub> = 0.6 <i>K</i><sub>u</sub> &nbsp;&nbsp; <i>T</i><sub>i</sub> = 0.5 <i>P</i><sub>u</sub> &nbsp;&nbsp; <i>T</i><sub>d</sub> = 0.125 <i>P</i><sub>u</sub></p>

with <i>K</i><sub>i</sub> = <i>K</i><sub>p</sub>/<i>T</i><sub>i</sub> and <i>K</i><sub>d</sub> = <i>K</i><sub>p</sub><i>T</i><sub>d</sub>.

> **Worked example — classic Z-N gains.**
> <p align="center"><i>K</i><sub>p</sub> = 0.6 &times; 19.25 = <b>11.55</b> &nbsp;&nbsp; <i>K</i><sub>i</sub> = 11.55 / (0.5&times;0.0513) = <b>450.3</b> &nbsp;&nbsp; <i>K</i><sub>d</sub> = 11.55 &times; (0.125&times;0.0513) = <b>0.0741</b></p>

---

## **6. Refining the Tune — Classic vs Robust**

Ziegler–Nichols is fast, but it is **deliberately aggressive**: the classic table targets a *quarter-amplitude decay*, which on this plant produces a large first overshoot.

> **Observed in the simulation — classic Z-N step response.** Applying <i>K</i><sub>p</sub> = 11.55, <i>K</i><sub>i</sub> = 450.3, <i>K</i><sub>d</sub> = 0.074 to the rate loop gives roughly **68% overshoot** with zero steady-state error — fast, but far past the 25% comfort limit. (Note: a widely repeated claim that classic Z-N yields ~20% overshoot is incorrect for this kind of plant; the honest simulated value is reported here.)

The practical workflow is to treat Z-N as a *starting point* and then **detune for robustness**. The classic table's overshoot comes mostly from its very high integral gain (<i>T</i><sub>i</sub> = 0.5<i>P</i><sub>u</sub>). The **Tyreus–Luyben** table raises <i>T</i><sub>i</sub> and lowers <i>K</i><sub>p</sub>:

<p align="center"><i>K</i><sub>p</sub> = 0.45 <i>K</i><sub>u</sub> &nbsp;&nbsp; <i>T</i><sub>i</sub> = 2.2 <i>P</i><sub>u</sub> &nbsp;&nbsp; <i>T</i><sub>d</sub> = <i>P</i><sub>u</sub> / 6.3</p>

> **Worked example — Tyreus–Luyben gains and response.**
> <p align="center"><i>K</i><sub>p</sub> = 0.45 &times; 19.25 = <b>8.66</b> &nbsp;&nbsp; <i>K</i><sub>i</sub> = 8.66 / (2.2&times;0.0513) = <b>76.8</b> &nbsp;&nbsp; <i>K</i><sub>d</sub> = 8.66 &times; (0.0513/6.3) = <b>0.0705</b></p>
> The integral gain drops from 450 to 77 — a much gentler integrator. The simulated step now overshoots about **15%** (under the 25% target) while keeping zero steady-state error. The cost is a slightly slower rise; the benefit is a calm, robust loop.

![Ziegler–Nichols sustained oscillation and the classic vs Tyreus–Luyben step responses](./images/ziegler_nichols_tuning.png)

---

## **7. Sensor Fusion — the Complementary Filter**

Both control loops depend on a clean attitude measurement, but neither inertial sensor gives one alone:

* The **gyroscope** measures angular *rate*; integrating it gives a smooth, low-noise angle that **drifts** because the small constant bias accumulates without bound.
* The **accelerometer** measures the gravity direction, giving an absolute tilt that **does not drift** but is **buried in vibration noise**.

The **complementary filter** fuses them — a high-pass on the gyro path and a low-pass on the accel path that sum to unity:

<p align="center"><i>&theta;</i><sub>est</sub> = <i>&alpha;</i> &middot; (<i>&theta;</i><sub>est,prev</sub> + <i>&omega;</i><sub>gyro</sub> &middot; &Delta;<i>t</i>) + (1 &minus; <i>&alpha;</i>) &middot; <i>&theta;</i><sub>accel</sub></p>

The single blending coefficient <i>&alpha;</i> sets the crossover **time constant**, and through it the two competing error sources:

<p align="center"><i>&tau;</i><sub>f</sub> = <i>&alpha;</i> &middot; &Delta;<i>t</i> / (1 &minus; <i>&alpha;</i>)</p>
<p align="center">drift = bias &middot; <i>&tau;</i><sub>f</sub> &nbsp;&nbsp;&nbsp; noise<sub>rms</sub> = <i>&sigma;</i><sub>accel</sub> &middot; &radic;[(1 &minus; <i>&alpha;</i>) / (1 + <i>&alpha;</i>)]</p>

A **higher** <i>&alpha;</i> trusts the gyro longer (more drift, less noise); a **lower** <i>&alpha;</i> trusts the accelerometer more (less drift, more noise). The best <i>&alpha;</i> minimises the *combined* error.

> **Worked example — choosing <i>&alpha;</i> for the reference IMU.**
> With a gyro bias of 0.6&deg;/s, accelerometer angle noise <i>&sigma;</i> = 1.8&deg;, and the estimator at &Delta;<i>t</i> = 2.5 ms (400 Hz):
>
> | <i>&alpha;</i> | <i>&tau;</i><sub>f</sub> (s) | drift (&deg;) | noise (&deg;) | total (&deg;) |
> | :---: | :---: | :---: | :---: | :---: |
> | 0.90 | 0.0225 | 0.014 | 0.413 | 0.426 |
> | 0.95 | 0.0475 | 0.029 | 0.288 | 0.317 |
> | **0.98** | **0.1225** | **0.074** | **0.181** | **0.254** |
> | 0.99 | 0.2475 | 0.149 | 0.128 | 0.276 |
>
> The total error is smallest at **<i>&alpha;</i> = 0.98**. For contrast, *pure* gyro integration (<i>&alpha;</i> = 1) drifts by 0.6&deg;/s &times; 30 s = **18&deg;** after just half a minute — the unbounded error the accelerometer reference exists to stop.

![Complementary filter fusing drifting gyro and noisy accelerometer into a clean estimate](./images/complementary_filter.png)

---

## **Modelling Assumptions & Limitations**

1. **Lumped inertia is an upper bound.** <i>J</i> = <i>m L</i><sup>2</sup>/2 assumes all mass sits at the motor positions. Real builds carry the battery and stack near the centre, so the true inertia is somewhat lower and the loop is a little faster than predicted.
2. **The prototype 2nd-order model is idealised.** The metric formulas of Section 3 neglect the zero introduced by the PD term and the extra phase lag of the actuator, both of which add a little real-world overshoot beyond the table values.
3. **Classic Ziegler–Nichols is intentionally aggressive.** It targets quarter-amplitude decay, not a gentle response — hence the ~68% overshoot. It is a *starting point* to be refined (Section 6), not a final tune.
4. **The complementary filter assumes a constant gyro bias.** Real bias wanders slowly with temperature, so a fixed <i>&alpha;</i> is itself a compromise; production systems re-estimate the bias online (a Kalman filter generalises exactly this fusion).
5. **Single-axis analysis.** Roll, pitch and yaw are treated independently here; a real airframe has small cross-axis coupling that a full controller accounts for.
