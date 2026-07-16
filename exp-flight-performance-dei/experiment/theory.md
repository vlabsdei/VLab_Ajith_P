# Theory: Flight Performance — Thrust-to-Weight, Hover Throttle & Payload

Every flying decision a multirotor can make is bounded by one budget: **how much thrust it can produce versus how much it weighs**. That single ratio decides whether the craft can take off at all, how much authority it keeps for manoeuvres, how much cargo it can carry, and how long it can stay airborne. This experiment closes the drone-build series by turning the propulsion chosen in Experiment 1 and the airframe weighed in Experiment 2 into the aircraft's **performance envelope**: its thrust-to-weight ratio, hover throttle, control margin, maximum payload, and hover efficiency.

Before working through the underlying physics, the animation below walks through the full flight-performance story — from the lift budget and the thrust-to-weight ratio, through the hover throttle and the control margin left for manoeuvres, to the maximum payload and the momentum-theory hover efficiency that together fix the performance envelope.

<p align="center">
  <video controls playsinline preload="metadata" width="100%" style="max-width: 860px; border-radius: 8px;">
    <source src="./videos/flight_performance.mp4" type="video/mp4">
    Your browser does not support the HTML5 video tag. You can
    <a href="./videos/flight_performance.mp4">download the video</a> instead.
  </video>
</p>

---

## **1. The Lift Budget**

A hovering quadcopter is a simple force balance. Four motors each pull air downward and are pushed upward in reaction; gravity pulls the whole mass down. For the craft to leave the ground the **total static thrust must exceed the weight**:

<p align="center"><i>F</i><sub>thrust</sub> = <i>N</i> &middot; <i>T</i><sub>max</sub> &nbsp;&nbsp;&gt;&nbsp;&nbsp; <i>W</i> = <i>m</i> &middot; <i>g</i></p>

where <i>N</i> is the number of motors (4 for a quad), <i>T</i><sub>max</sub> is the maximum thrust of one motor, <i>m</i> is the total mass and <i>g</i> = 9.807 m/s<sup>2</sup>. The thrust comes from the propulsion package designed in **Experiment 1**; the mass comes from the airframe built and weighed in **Experiment 2**. This experiment combines them.

![Free-body lift diagram: four motor thrusts versus weight and payload](./images/twr_lift_diagram.png)

Because thrust ratings and weights are both quoted in **grams-force** in the hobby, it is convenient to keep both in grams: the gravitational constant then cancels in every ratio below, leaving clean dimensionless numbers.

---

## **2. Thrust-to-Weight Ratio (TWR)**

The single most important performance number is the **thrust-to-weight ratio** — total available thrust divided by weight:

<p align="center"><i>TWR</i> = <i>N</i> &middot; <i>T</i><sub>max</sub> / <i>m</i><sub>total</sub></p>

It answers "how many times its own weight can the craft push?" A TWR of 1 can just barely hover at full throttle (no margin); a TWR of 2 can accelerate upward at 1 <i>g</i>; a TWR of 4 feels sharp and aerobatic.

| TWR | Class | Feel |
| :---: | :--- | :--- |
| &lt; 1.0 | cannot lift off | dead weight |
| 1.0 – 1.5 | underpowered | sluggish, marginal |
| 1.5 – 2.0 | stable / cinematic | smooth, limited authority |
| 2.0 – 3.0 | sport | responsive |
| 3.0 – 5.0 | freestyle | agile, aerobatic |
| &gt; 5.0 | racing / extreme | explosive |

> **Worked example — TWR of the reference 5&Prime; build.**
> The 2204 motor produces <i>T</i><sub>max</sub> = 620 g of thrust each, on a 4-motor quad whose empty mass (from Experiment 2) is <i>m</i> = 500 g:
> <p align="center"><i>TWR</i> = (4 &times; 620) / 500 = 2480 / 500 = <b>4.96</b></p>
> A ratio of 4.96 places the craft firmly in the **freestyle** class — agile, with thrust to spare. Selecting a different motor in Experiment 1 or a heavier frame in Experiment 2 changes this number directly.

---

## **3. Hover Throttle & the Quadratic Thrust Curve**

To hover, the four motors together must produce exactly the weight, so **each motor produces one quarter of it**:

<p align="center"><i>T</i><sub>hover</sub> = <i>m</i><sub>total</sub> &middot; <i>g</i> / <i>N</i></p>

But thrust is **not** linear in throttle. A propeller's thrust grows with the square of its rotational speed, and RPM is roughly proportional to throttle, so:

<p align="center"><i>T</i> &prop; RPM<sup>2</sup> &prop; throttle<sup>2</sup></p>

Inverting this quadratic relationship gives the throttle needed to reach the hover thrust:

<p align="center">hover throttle = &radic;(<i>T</i><sub>hover</sub> / <i>T</i><sub>max</sub>) = &radic;(1 / <i>TWR</i>)</p>

> **Worked example — hover throttle of the reference build.**
> Each motor must lift 500/4 = 125 g of the 500 g craft, out of its 620 g maximum:
> <p align="center">hover throttle = &radic;(125 / 620) = &radic;(1 / 4.96) = <b>0.449 &rarr; 44.9 %</b></p>
> The reference quad hovers at just under half throttle — close to the ideal.

![Quadratic thrust curve with the hover operating point](./images/hover_throttle_curve.png)

Hovering near **50 %** throttle is the sweet spot: it leaves symmetric authority to climb (push toward 100 %) and to descend (ease toward 0 %). A craft that must hover at 80 % is dangerously close to its ceiling; one that hovers at 20 % wastes most of its control resolution down low.

---

## **4. Control Margin**

The throttle headroom left above hover is the **control margin** — the thrust reserve the pilot and the stabilisation loop of Experiment 5 draw on for every climb, snap and gust rejection:

<p align="center">control margin = (1 &minus; hover throttle) &times; 100 %</p>

> **Worked example.** With a 44.9 % hover throttle the reference build keeps a **55.1 % control margin** — over half its thrust range available for manoeuvres and disturbance rejection. As payload is added (Section 5) the hover throttle climbs and this margin shrinks: the craft becomes sluggish well before it actually runs out of thrust.

This links directly back to Experiment 5: a healthy control margin is what lets the PID loop apply the corrective torques it computed. Saturate the motors at hover and the controller has nothing left to give.

---

## **5. Maximum Payload**

How much cargo can the craft carry? Not until TWR reaches 1 — that leaves zero control authority. A safe limit keeps a **minimum thrust-to-weight ratio** (typically 2.0) for controllable flight. Setting <i>TWR</i> = <i>TWR</i><sub>min</sub> and solving for mass gives the maximum take-off mass, and subtracting the empty mass gives the payload:

<p align="center"><i>m</i><sub>max</sub> = <i>N</i> &middot; <i>T</i><sub>max</sub> / <i>TWR</i><sub>min</sub> &nbsp;&nbsp;&nbsp; payload = <i>m</i><sub>max</sub> &minus; <i>m</i><sub>empty</sub></p>

> **Worked example — payload of the reference build (TWR<sub>min</sub> = 2.0).**
> <p align="center"><i>m</i><sub>max</sub> = (4 &times; 620) / 2.0 = <b>1240 g</b></p>
> <p align="center">payload = 1240 &minus; 500 = <b>740 g</b></p>
> The reference quad can carry about 740 g of camera, battery or cargo before its thrust-to-weight ratio falls to the 2.0 safety floor. Loading it further is possible but leaves too little authority to fly safely.

![Thrust-to-weight ratio falling as payload is added](./images/payload_twr_curve.png)

Adding payload raises <i>m</i><sub>total</sub>, which lowers TWR, which raises the hover throttle and erodes the control margin — a single chain of cause and effect the simulation lets you sweep with the payload slider.

---

## **6. Hover Efficiency**

Endurance is set by how much **lift you get per watt**. The ideal power to hover follows from **momentum (actuator-disk) theory**: a rotor of disk area <i>A</i> accelerating air to make thrust <i>T</i> needs at least

<p align="center"><i>P</i><sub>ideal</sub> = <i>T</i><sup>3/2</sup> / &radic;(2 <i>&rho; A</i>)</p>

where <i>&rho;</i> = 1.225 kg/m<sup>3</sup> is the air density and <i>A</i> = <i>N</i> &middot; &pi;(<i>D</i>/2)<sup>2</sup> is the total disk area of all rotors. Real rotors fall short of this ideal by the **figure of merit** (FoM &asymp; 0.7), and efficiency is the lift produced per watt:

<p align="center"><i>P</i><sub>hover</sub> = <i>P</i><sub>ideal</sub> / FoM &nbsp;&nbsp;&nbsp; efficiency = <i>m</i><sub>total</sub> / <i>P</i><sub>hover</sub> &nbsp;[g/W]</p>

> **Worked example — hover efficiency of the reference build.**
> Four 5&Prime; (0.127 m) props give a disk area <i>A</i> = 4 &middot; &pi; &middot; (0.0635)<sup>2</sup> = 0.0507 m<sup>2</sup>. The hover thrust is <i>T</i> = 0.5 &times; 9.807 = 4.90 N:
> <p align="center"><i>P</i><sub>ideal</sub> = 4.90<sup>1.5</sup> / &radic;(2 &times; 1.225 &times; 0.0507) = 10.86 / 0.352 = 30.8 W</p>
> <p align="center"><i>P</i><sub>hover</sub> = 30.8 / 0.70 = <b>44.0 W</b> &nbsp;&nbsp; efficiency = 500 / 44.0 = <b>11.36 g/W</b></p>
> About 11 g/W is typical of an efficient 5&Prime; setup. Two levers improve it: a **larger propeller disk** (the 13&Prime; heavy-lift build reaches ~17 g/W) and a **lighter craft** — because power scales as thrust<sup>3/2</sup>, every gram saved pays back more than linearly.

> **Why the simulator's number may not read exactly 11.36 g/W.** FoM = 0.70 above is the catalogue's nominal spec figure. The live simulator instead seeds a **build-specific FoM within the documented 0.55–0.75 real-rotor band** — deterministic per motor/propeller combination, not random noise — to model the as-assembled variance (balance, tolerance stack-up, prop finish) a real bench test would show even for "the same" spec sheet. A combo that seeds near the low end of that band reads a lower g/W than this worked example; that scatter is the manufacturing-variance lesson Section 6 (and the Modelling Assumptions below) exist to teach, not an error to chase.

![Hover efficiency versus all-up mass and disk area](./images/hover_efficiency_curve.png)

---

## **7. The Performance Envelope**

The five numbers interlock into one picture of the aircraft:

* **TWR** sets the ceiling — agility and the ability to lift.
* **Hover throttle** and **control margin** set the usable authority in the middle of the range.
* **Maximum payload** sets how far you can load it before that authority is gone.
* **Hover efficiency** sets how long it can stay up.

Designing a drone is choosing where on this envelope to sit. A racer trades efficiency and payload for a TWR of 8+. A cinematic lifter accepts a TWR near 2 to carry a heavy camera efficiently on a big slow disk. The propulsion of Experiment 1, the structure of Experiment 2, the power electronics of Experiment 4 and the control loop of Experiment 5 all feed into — and are constrained by — this final budget.

---

## **Modelling Assumptions & Limitations**

1. **Static thrust only.** <i>T</i><sub>max</sub> is the bench (zero-airspeed) figure. In fast forward flight the props unload and available thrust changes, so the in-flight TWR differs from the static value used here.
2. **Quadratic thrust curve is idealised.** Real thrust-vs-throttle curves bend away from a perfect square because of motor resistance, voltage sag and prop stall, so the hover throttle is an estimate (typically accurate to a few percent).
3. **Momentum theory is a lower bound on power.** It ignores profile drag, swirl, tip losses and the ESC/motor electrical losses of Experiment 4; the figure of merit lumps these into one factor, so the g/W figure is an idealised best case. The simulator seeds this factor per build within 0.55–0.75 rather than holding it at the 0.70 spec value (Section 6), so your on-screen efficiency will genuinely vary by motor/propeller choice even at identical mass.
4. **Hover, sea-level conditions.** Efficiency uses &rho; = 1.225 kg/m<sup>3</sup>; at altitude the thinner air lowers thrust and efficiency, as seen in Experiment 3.
5. **Equal, ideal motors.** All four motors are assumed identical and sharing the load evenly; manufacturing spread and a shifted CG (Experiment 2) make one motor work harder, lowering the effective margin.
