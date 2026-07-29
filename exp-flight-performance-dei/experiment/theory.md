# Theory: Flight Performance - Thrust-to-Weight, Hover Throttle & Payload

Every flying decision a multirotor can make comes down to one budget: **how much thrust it can produce against how much it weighs**. That single ratio decides whether the craft can take off at all, how much authority it keeps for manoeuvres, how much cargo it can carry, and how long it can stay up. This experiment turns the propulsion chosen in the propulsion system design experiment and the airframe weighed in the frame structural integrity experiment into the aircraft's **performance envelope**: its thrust-to-weight ratio, hover throttle, control margin, maximum payload, and hover efficiency.

Before we get into the physics, the animation below walks through the full flight-performance story: the lift budget and the thrust-to-weight ratio, then the hover throttle and the control margin left for manoeuvres, and finally the maximum payload and the momentum-theory hover efficiency that together fix the performance envelope.

<p align="center">
  <video controls playsinline preload="metadata" width="100%" style="max-width: 860px; border-radius: 8px;">
    <source src="./videos/flight_performance_exp6_final.mp4" type="video/mp4">
    Your browser does not support the HTML5 video tag. You can
    <a href="./videos/flight_performance_exp6_final.mp4">download the video</a> instead.
  </video>
</p>

---

## **1. The Lift Budget**

A hovering quadcopter is a simple force balance. Four motors each pull air downward and get pushed upward in reaction; gravity pulls the whole mass down. For the craft to leave the ground the **total static thrust has to beat the weight**:

<p align="center"><i>F</i><sub>thrust</sub> = <i>N</i> &middot; <i>T</i><sub>max</sub> &nbsp;&nbsp;&gt;&nbsp;&nbsp; <i>W</i> = <i>m</i> &middot; <i>g</i></p>

where <i>N</i> is the number of motors (4 for a quad), <i>T</i><sub>max</sub> is the maximum thrust of one motor, <i>m</i> is the total mass and <i>g</i> = 9.807 m/s<sup>2</sup>. The thrust comes from the propulsion package designed in the **Propulsion System Design** experiment; the mass comes from the airframe built and weighed in the **Frame Structural Integrity** experiment. This experiment brings them together.

![Free-body lift diagram: four motor thrusts versus weight and payload](./images/twr_lift_diagram.png)

Because thrust ratings and weights are both quoted in **grams-force** in the hobby, it is handy to keep both in grams: the gravitational constant then cancels in every ratio below, and you are left with clean dimensionless numbers.

---

## **2. Thrust-to-Weight Ratio (TWR)**

The single most important performance number is the **thrust-to-weight ratio**, the total available thrust divided by weight:

<p align="center"><i>TWR</i> = <i>N</i> &middot; <i>T</i><sub>max</sub> / <i>m</i><sub>total</sub></p>

It answers a plain question: how many times its own weight can the craft push? A TWR of 1 can barely hover at full throttle, with no margin; a TWR of 2 can accelerate straight up at 1 <i>g</i>; a TWR of 4 feels sharp and aerobatic.

| TWR | Class | Feel |
| :---: | :--- | :--- |
| &lt; 1.0 | cannot lift off | dead weight |
| 1.0 – 1.5 | underpowered | sluggish, marginal |
| 1.5 – 2.0 | stable / cinematic | smooth, limited authority |
| 2.0 – 3.0 | sport | responsive |
| 3.0 – 5.0 | freestyle | agile, aerobatic |
| &gt; 5.0 | racing / extreme | explosive |

> **Worked example: TWR of the reference 5&Prime; build.**
> The 2204 motor produces <i>T</i><sub>max</sub> = 620 g of thrust each, on a 4-motor quad whose empty mass (from the frame experiment) is <i>m</i> = 500 g:
> <p align="center"><i>TWR</i> = (4 &times; 620) / 500 = 2480 / 500 = <b>4.96</b></p>
> A ratio of 4.96 puts the craft firmly in the **freestyle** class: agile, with thrust to spare. Pick a different motor in the propulsion experiment or a heavier frame in the frame experiment and this number moves directly.

---

## **3. Hover Throttle & the Quadratic Thrust Curve**

To hover, the four motors together have to produce exactly the weight, so **each motor carries a quarter of it**:

<p align="center"><i>T</i><sub>hover</sub> = <i>m</i><sub>total</sub> &middot; <i>g</i> / <i>N</i></p>

But thrust is **not** linear in throttle. A propeller's thrust grows with the square of its rotational speed, and RPM is roughly proportional to throttle, so:

<p align="center"><i>T</i> &prop; RPM<sup>2</sup> &prop; throttle<sup>2</sup></p>

Invert this quadratic and you get the throttle needed to reach the hover thrust:

<p align="center">hover throttle = &radic;(<i>T</i><sub>hover</sub> / <i>T</i><sub>max</sub>) = &radic;(1 / <i>TWR</i>)</p>

> **Worked example: hover throttle of the reference build.**
> Each motor has to lift 500/4 = 125 g of the 500 g craft, out of its 620 g maximum:
> <p align="center">hover throttle = &radic;(125 / 620) = &radic;(1 / 4.96) = <b>0.449, so 44.9 %</b></p>
> The reference quad hovers at just under half throttle, close to ideal.

![Quadratic thrust curve with the hover operating point](./images/hover_throttle_curve.png)

Hovering near **50 %** throttle is the sweet spot: it leaves symmetric authority to climb (push toward 100 %) and to descend (ease toward 0 %). A craft that has to hover at 80 % is dangerously close to its ceiling; one that hovers at 20 % throws away most of its control resolution down low.

---

## **4. Control Margin**

The throttle headroom left above hover is the **control margin**, the thrust reserve the pilot and the stabilisation loop of the flight-control experiment draw on for every climb, snap and gust rejection:

<p align="center">control margin = (1 &minus; hover throttle) &times; 100 %</p>

> **Worked example.** With a 44.9 % hover throttle the reference build keeps a **55.1 % control margin**, over half its thrust range free for manoeuvres and disturbance rejection. Add payload (Section 5) and the hover throttle climbs while this margin shrinks: the craft turns sluggish well before it actually runs out of thrust.

This ties straight back to the flight-control experiment: a healthy control margin is what lets the PID loop apply the corrective torques it computed. Saturate the motors at hover and the controller has nothing left to give.

---

## **5. Maximum Payload**

How much cargo can the craft carry? Not up to TWR = 1, since that leaves zero control authority. A safe limit holds a **minimum thrust-to-weight ratio** (typically 2.0) for controllable flight. Set <i>TWR</i> = <i>TWR</i><sub>min</sub>, solve for mass to get the maximum take-off mass, and subtract the empty mass to get the payload:

<p align="center"><i>m</i><sub>max</sub> = <i>N</i> &middot; <i>T</i><sub>max</sub> / <i>TWR</i><sub>min</sub> &nbsp;&nbsp;&nbsp; payload = <i>m</i><sub>max</sub> &minus; <i>m</i><sub>empty</sub></p>

> **Worked example: payload of the reference build (TWR<sub>min</sub> = 2.0).**
> <p align="center"><i>m</i><sub>max</sub> = (4 &times; 620) / 2.0 = <b>1240 g</b></p>
> <p align="center">payload = 1240 &minus; 500 = <b>740 g</b></p>
> The reference quad can carry about 740 g of camera, battery or cargo before its thrust-to-weight ratio drops to the 2.0 safety floor. You can load it further, but that leaves too little authority to fly safely.

![Thrust-to-weight ratio falling as payload is added](./images/payload_twr_curve.png)

Adding payload raises <i>m</i><sub>total</sub>, which lowers TWR, which raises the hover throttle and eats into the control margin. It is one chain of cause and effect, and the simulation lets you sweep it with the payload slider.

---

## **6. Hover Efficiency**

Endurance comes down to how much **lift you get per watt**. The ideal power to hover follows from **momentum (actuator-disk) theory**: a rotor of disk area <i>A</i> accelerating air to make thrust <i>T</i> needs at least

<p align="center"><i>P</i><sub>ideal</sub> = <i>T</i><sup>3/2</sup> / &radic;(2 <i>&rho; A</i>)</p>

where <i>&rho;</i> = 1.225 kg/m<sup>3</sup> is the air density and <i>A</i> = <i>N</i> &middot; &pi;(<i>D</i>/2)<sup>2</sup> is the total disk area of all rotors. Real rotors fall short of this ideal by the **figure of merit** (FoM &asymp; 0.7), and efficiency is the lift produced per watt:

<p align="center"><i>P</i><sub>hover</sub> = <i>P</i><sub>ideal</sub> / FoM &nbsp;&nbsp;&nbsp; efficiency = <i>m</i><sub>total</sub> / <i>P</i><sub>hover</sub> &nbsp;[g/W]</p>

> **Worked example: the momentum-theory floor.**
> Four 5&Prime; (0.127 m) props give a disk area <i>A</i> = 4 &middot; &pi; &middot; (0.0635)<sup>2</sup> = 0.0507 m<sup>2</sup>. For a 529 g craft the hover thrust is <i>T</i> = 0.529 &times; 9.807 = 5.19 N:
> <p align="center"><i>P</i><sub>ideal</sub> = 5.19<sup>1.5</sup> / &radic;(2 &times; 1.225 &times; 0.0507) = 11.82 / 0.352 = 33.6 W</p>
> <p align="center"><i>P</i><sub>hover</sub> = 33.6 / 0.70 = <b>48.0 W</b> &nbsp;&nbsp; ideal efficiency = 529 / 48.0 = <b>11.0 g/W</b></p>
> Because power scales as thrust<sup>3/2</sup>, every gram saved pays back more than linearly, and a larger disk lowers <i>P</i><sub>ideal</sub> for the same thrust.

> **What the simulator actually displays, and why it is a much smaller number.** The **Thrust eff.** chip is *not* this momentum-theory hover figure. It reports grams-force per watt at **full throttle** &mdash; maximum thrust divided by the electrical power drawn to produce it &mdash; and the Calculations card labels it `g/W @ full`. That is an electrical measurement of the whole motor-and-propeller package, so it includes copper loss, ESC loss, profile drag, swirl and tip losses, none of which appear above. On the reference build the chip reads about **2.65 g/W** against this section's 11.0 g/W ideal.
>
> The gap is a factor of four, not a tolerance. Do not try to reconcile them: they are different quantities measured at different operating points. The momentum-theory figure is a thermodynamic floor on hover power; the chip is what the hardware really achieves flat out. Sweeping the propeller selector moves the chip from 2.65 g/W on the 5&Prime; through 3.62 g/W at 10&Prime; to 4.00 g/W at 16&Prime;, so the disk-area trend this section predicts does show up on screen &mdash; just at realistic magnitudes and with diminishing returns. Payload does not move the chip at all, because full-throttle thrust and full-throttle power are both properties of the propulsion package rather than of what it is asked to lift.

![Hover efficiency versus all-up mass and disk area](./images/hover_efficiency_curve.png)

---

## **7. The Performance Envelope**

The five numbers interlock into one picture of the aircraft:

* **TWR** sets the ceiling: agility and the ability to lift.
* **Hover throttle** and **control margin** set the usable authority in the middle of the range.
* **Maximum payload** sets how far you can load it before that authority is gone.
* **Hover efficiency** sets how long it can stay up.

Designing a drone is choosing where on this envelope to sit. A racer trades efficiency and payload for a TWR of 8 or more. A cinematic lifter accepts a TWR near 2 to carry a heavy camera efficiently on a big slow disk. The propulsion of the propulsion experiment, the structure of the frame experiment, the power electronics of the ESC experiment and the control loop of the flight-control experiment all feed into this budget, and are all limited by it.

---

## **Modelling Assumptions & Limitations**

1. **Static thrust only.** <i>T</i><sub>max</sub> is the bench (zero-airspeed) figure. In fast forward flight the props unload and the available thrust changes, so the in-flight TWR differs from the static value used here.
2. **Quadratic thrust curve is idealised.** Real thrust-vs-throttle curves bend away from a perfect square because of motor resistance, voltage sag and prop stall, so the hover throttle is an estimate (usually good to a few percent).
3. **Momentum theory is a lower bound on power.** It ignores profile drag, swirl, tip losses and the ESC/motor electrical losses studied in the power-electronics experiment; the figure of merit lumps these into one factor, so the g/W figure in Section 6 is an idealised best case rather than anything a bench would measure. The simulator's on-screen **Thrust eff.** chip is a separate, electrically measured full-throttle figure and reads roughly four times lower — see Section 6 for why the two must not be compared directly.
4. **Hover, sea-level conditions.** Efficiency uses &rho; = 1.225 kg/m<sup>3</sup>; at altitude the thinner air lowers thrust and efficiency, as seen in the aerodynamic-analysis experiment.
5. **Equal, ideal motors.** All four motors are assumed identical and sharing the load evenly; manufacturing spread and a shifted CG (from the frame experiment) make one motor work harder, which lowers the effective margin.
