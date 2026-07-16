# Theory: Mission Performance — Cruise Power, Endurance, Energy Budget & Range-Payload

Every experiment in this series has built toward one question: **can this drone actually do a mission?** Experiment 1 chose the propulsion, Experiment 2 weighed the airframe, later experiments characterised the battery, the control loop and the thermal limits — but none of them answered how far the finished aircraft can fly, how long it can stay up, or how much it can carry while doing either. This capstone experiment closes that gap by building a single **mission-performance model**: the cruise-power curve as a function of airspeed, the energy a mission actually costs in Watt-hours, and the range-payload envelope that a delivery, mapping or inspection mission is ultimately judged against.

Before working through the physics, the animation below (once populated) walks through the full mission story — from the U-shaped power curve, through the energy budget of a real flight profile, to the range-payload trade-off that closes the loop back to the battery chosen in Experiment 1.

<p align="center">
  <video controls playsinline preload="metadata" width="100%" style="max-width: 860px; border-radius: 8px;">
    <source src="./videos/mission_performance.mp4" type="video/mp4">
    Your browser does not support the HTML5 video tag. You can
    <a href="./videos/mission_performance.mp4">download the video</a> instead.
  </video>
</p>

---

## **1. Two Ways to Spend Power in Forward Flight**

A hovering rotor spends power only to accelerate air downward — the **induced power** of momentum theory. The moment the craft moves forward it also has to punch through the air with its own body, paying a second, independent power bill — **parasitic power**. Cruise power is the sum of both:

<p align="center"><i>P</i><sub>cruise</sub>(<i>V</i>) = <i>F</i><sub>D</sub>(<i>V</i>) &middot; <i>V</i> + <i>P</i><sub>ind</sub>(<i>V</i>)</p>

The parasitic drag itself grows with the square of airspeed (standard bluff-body aerodynamic drag),

<p align="center"><i>F</i><sub>D</sub>(<i>V</i>) = &frac12; &middot; &rho; &middot; <i>V</i><sup>2</sup> &middot; <i>C</i><sub>d</sub> &middot; <i>A</i></p>

so the parasitic **power** term <i>F</i><sub>D</sub>&middot;<i>V</i> grows with the **cube** of airspeed — it is negligible at walking pace and dominant at speed. Here <i>&rho;</i> is the local air density (from the same ISA model used since Experiment 3), <i>C</i><sub>d</sub> and <i>A</i> are the airframe's drag coefficient and frontal area (read from the chassis, e.g. <i>C</i><sub>d</sub> = 1.05, <i>A</i> = 0.0095 m<sup>2</sup> for the reference 5&Prime; chassis — a bluff, undressed quad body), and thrust is simply the level-flight weight, <i>T</i> = <i>m</i>&middot;<i>g</i>.

---

## **2. Induced Power Falls With Airspeed**

Momentum theory in forward flight shows the opposite trend for induced power. At hover, a rotor of total disk area <i>A</i><sub>disk</sub> = <i>N</i>&middot;&pi;(<i>D</i>/2)<sup>2</sup> must accelerate air to a hover-induced velocity

<p align="center"><i>v</i><sub>h</sub> = &radic;(<i>T</i> / (2 &middot; &rho; &middot; <i>A</i><sub>disk</sub>))</p>

But once the craft is moving forward at <i>V</i>, the rotor is already sweeping through fresh air at speed <i>V</i>, so it needs to accelerate that air by *less* to make the same thrust. The induced velocity in forward flight, <i>v</i><sub>i</sub>(<i>V</i>), solves the classic momentum-theory closure

<p align="center"><i>v</i><sub>i</sub>(<i>V</i>) = &radic;( &radic;((<i>V</i><sup>2</sup>/2)<sup>2</sup> + <i>v</i><sub>h</sub><sup>4</sup>) &minus; <i>V</i><sup>2</sup>/2 )</p>

and the induced power is <i>P</i><sub>ind</sub>(<i>V</i>) = <i>T</i>&middot;<i>v</i><sub>i</sub>(<i>V</i>). At <i>V</i> = 0 this reduces exactly to the familiar hover figure <i>P</i><sub>ind</sub>(0) = <i>T</i><sup>1.5</sup> / &radic;(2&middot;&rho;&middot;<i>A</i><sub>disk</sub>); as <i>V</i> grows, <i>v</i><sub>i</sub> — and therefore induced power — steadily **falls**, asymptotically as 1/<i>V</i>. This is the same effect a helicopter pilot feels as "translational lift."

---

## **3. The U-Shaped Cruise-Power Curve**

Put the two terms together and a clear picture emerges: parasitic power **rises** with the cube of speed while induced power **falls** with speed. Their sum is a curve shaped like a U — high at both very low and very high speed, with a single minimum somewhere in between.

![Cruise power vs airspeed: the U-shaped power curve with its minimum marked](./images/cruise_power_curve.png)

> **Worked example — the reference build (fpv5 chassis, 5&Prime; tri-blade props, 1806 motors, 4S/1500 pack, no payload).**
> Total mass from the Mass Budget ≈ 529 g, so <i>T</i> = 0.529 &times; 9.807 = **5.19 N**. Four 5&Prime; (0.127 m) props give a disk area <i>A</i><sub>disk</sub> = 4&middot;&pi;&middot;(0.0635)<sup>2</sup> = **0.0507 m<sup>2</sup>**, so the hover-induced velocity is <i>v</i><sub>h</sub> = &radic;(5.19/(2&times;1.225&times;0.0507)) = **6.47 m/s** and hover power <i>P</i><sub>ind</sub>(0) = 5.19 &times; 6.47 &asymp; **33.5 W**. With <i>C</i><sub>d</sub> = 1.05 and <i>A</i> = 0.0095 m<sup>2</sup>, sweeping airspeed gives:
>
> | <i>V</i> (m/s) | <i>F</i><sub>D</sub>&middot;<i>V</i> (W) | <i>P</i><sub>ind</sub> (W) | <i>P</i><sub>cruise</sub> (W) |
> | :---: | :---: | :---: | :---: |
> | 0 | 0.0 | 33.5 | 33.5 |
> | 8 | 3.1 | 23.6 | 26.7 |
> | **9.5** | **5.2** | **21.0** | **&asymp;26.2 (minimum)** |
> | 12 | 10.6 | 17.4 | 28.0 |
> | 15 | 20.6 | 14.2 | 34.8 |
>
> The minimum sits at **V &asymp; 9.5 m/s**, right in the 6–13 m/s band typical of small multirotors — comfortably inside the 2–20 m/s sweep the simulator runs.

---

## **4. Maximum Endurance vs Maximum Range**

The bottom of the U-curve is not the only speed worth knowing — it turns out to answer a different question than the one most missions actually ask.

- **Maximum-endurance speed**, <i>V</i><sub>endur</sub>, is simply where <i>P</i><sub>cruise</sub>(<i>V</i>) is smallest. Flying here burns the fewest Watts per second, so it keeps the craft airborne the **longest total time** — the right speed for a loiter or watch-and-wait mission.
- **Maximum-range speed**, <i>V</i><sub>range</sub>, is the speed that covers the **most distance per Watt-hour**, which means minimising power *per unit speed*, <i>P</i><sub>cruise</sub>(<i>V</i>)/<i>V</i> — geometrically, the point where a line from the origin is tangent to the power curve.

Because the power curve is not symmetric, these two speeds are never the same, and <i>V</i><sub>range</sub> is always **faster** than <i>V</i><sub>endur</sub>: it pays to fly a bit quicker than the absolute minimum-power point, trading a little extra power for a lot more ground covered per unit time.

> **Worked example (continued).** Sweeping <i>P</i><sub>cruise</sub>(<i>V</i>)/<i>V</i> over the same build shows its minimum near **V &asymp; 13.5 m/s** (<i>P</i><sub>cruise</sub> &asymp; 30.7 W there) — noticeably faster than the 9.5 m/s endurance speed. A loiter/surveillance mission should fly at 9.5 m/s; a point-to-point delivery should fly nearer 13.5 m/s.

![Endurance speed and max-range speed marked on the same power curve](./images/endurance_vs_range_speed.png)

---

## **5. The Mission Energy Budget**

A real flight is not one constant airspeed — it is a sequence of **phases**: hover to take off, cruise out, hover on-station, cruise back, hover to land. Each phase draws power at its own rate for its own duration, and the total energy is simply the sum:

<p align="center"><i>E</i><sub>total</sub> = (<i>P</i><sub>hover</sub>&middot;<i>t</i><sub>hover</sub> + <i>P</i><sub>cruise</sub>&middot;<i>t</i><sub>cruise</sub>) / 3600 &nbsp;&nbsp;[Wh]</p>

with <i>P</i><sub>hover</sub> = <i>P</i><sub>cruise</sub>(0) = <i>P</i><sub>ind</sub>(0), and phase durations from the mission plan: <i>t</i><sub>cruise</sub> = distance / <i>V</i> for each cruise leg.

> **Worked example — a 500 m delivery hop, out and back, at V = 10 m/s.**
> Phases: 30 s takeoff hover, 500 m cruise out (t = 500/10 = 50 s), 60 s hover-on-station, 500 m cruise back (50 s), 30 s landing hover. Total hover time = 120 s, total cruise time = 100 s.
> At <i>V</i> = 10 m/s the reference build draws <i>P</i><sub>cruise</sub> &asymp; 26.3 W in cruise and <i>P</i><sub>hover</sub> &asymp; 33.6 W in hover, so
> <p align="center"><i>E</i><sub>total</sub> = (33.6 &times; 120 + 26.3 &times; 100) / 3600 &asymp; <b>1.85 Wh</b></p>
> Against a 4S/1500 pack (<i>E</i><sub>batt</sub> = 14.8 V &times; 1.5 Ah = **22.2 Wh**), even after the &eta;<sub>total</sub> &asymp; 0.55 electrical-to-aerodynamic efficiency factor this short hop uses only a small fraction of the pack — the mission comfortably **PASSes** the energy check. Longer cruise legs, higher payload or a smaller pack quickly close that margin, which is exactly what this sub-experiment lets you explore.

![Stacked mission-phase energy: hover and cruise segments accumulating to the total Watt-hour budget](./images/mission_energy_phases.png)

---

## **6. Range and the Range-Payload Envelope**

Once the energy per unit time (power) and the usable pack energy are both known, converting to a distance is direct. The usable aerodynamic energy is the battery's rated energy, discounted by the electrical-to-aerodynamic efficiency &eta;<sub>total</sub>, minus a reserve held back for the hover phases (takeoff and landing):

<p align="center"><i>E</i><sub>batt</sub> = cells &middot; <i>V</i><sub>nom</sub> &middot; capacity<sub>mAh</sub> / 1000 &nbsp;&nbsp; <i>E</i><sub>hover</sub> = <i>P</i><sub>hover</sub> &middot; <i>t</i><sub>hoverReserve</sub> / 3600</p>
<p align="center"><i>Range</i> = (<i>E</i><sub>batt</sub>&middot;&eta;<sub>total</sub> &minus; <i>E</i><sub>hover</sub>) / <i>P</i><sub>cruise</sub>(<i>V</i>) &middot; <i>V</i> &nbsp;&nbsp;[m]</p>

This single formula is the design tool a UAV mission brief is actually built around: for a given battery and cruise speed, how far can the craft go?

### **The payload penalty: why doubling payload does not just halve range**

Adding payload raises total mass <i>m</i>, which raises thrust <i>T</i> = <i>m</i>&middot;<i>g</i>, which raises induced power. But induced power does not scale linearly with weight. At hover this is exact — <i>P</i><sub>ind</sub>(0) &prop; <i>T</i><sup>1.5</sup>, straight from the momentum-theory formula in Section 2 — and in forward flight the same disproportionate penalty persists, if anything a little steeper, because the induced-velocity term in Section 2 pushes toward a <i>T</i><sup>2</sup> dependence as speed rises well above the hover-induced velocity. Either way, every extra gram of payload costs more power than the gram before it, drawn from a fixed pool of battery energy. The result is a range-payload curve that falls faster than a simple inverse relationship would suggest.

> **Worked example — doubling payload on the 4S/1500 pack, cruising at V = 10 m/s.**
> At 200 g payload the build draws <i>P</i><sub>cruise</sub> &asymp; 42.8 W and returns **Range &asymp; 9.5 km**. Doubling the payload to 400 g raises thrust enough that <i>P</i><sub>cruise</sub> climbs to &asymp; 62.9 W — the induced-power share of that jump behaves like <i>T</i><sup>1.8</sup> here, steeper than the pure hover exponent — while the battery's usable energy is unchanged — **Range falls to &asymp; 6.2 km**, a cut of roughly **a third**, even though the payload only doubled. This is the signature non-linearity of the range-payload envelope.

Mapping this across several battery packs (e.g. 3S/2200, 4S/1500, 6S/5000) at once produces the **range-payload envelope**: a family of falling curves, one per pack, that together define the operating region the mission planner must choose within. Here the packs are compared purely on usable energy — the simulator holds the airframe's dry mass fixed across all three curves rather than re-deriving it for each pack's physical weight, so what the chart shows is the direct effect of Watt-hours on range: more capacity simply buys a higher curve, not a real weight trade-off between packs (see the modelling note below).

![Range vs payload for three battery packs, showing the falling envelope](./images/range_payload_envelope.png)

---

## **7. The Mission Envelope, Closed**

The four sub-experiments of this capstone are one story told from four angles:

* **Power Profiling** builds the U-curve that every other number in this experiment is read from.
* **Endurance Speed** finds the bottom of that curve — the slowest way to burn the fewest Watts.
* **Mission Energy** turns power, over a realistic phase profile, into the Watt-hour cost of an actual mission.
* **Range-Payload** turns that energy budget, run backwards across a sweep of payload and pack size, into the distance-versus-cargo trade a real UAV operator has to accept.

Together they close the loop that began with Experiment 1's propulsion choice and Experiment 2's airframe mass: the same build, flown at the right speed, now has a fully quantified mission envelope.

---

## **Modelling Assumptions & Limitations**

1. **Profile power is not modelled.** Momentum (actuator-disk) theory captures only the induced power needed to generate thrust; it omits the **profile power** spent overcoming the rotor blades' own drag as they spin. At hover this profile term typically adds another **10–15%** on top of the induced power computed here, so the true hover power draw of a real build runs somewhat higher than the idealised <i>P</i><sub>ind</sub>(0) figure in Section 3.
2. **Flat-earth mission profile.** The energy-budget and range models treat every mission as level hover and level cruise segments with no vertical motion. Real missions climb out and descend back, which costs additional potential energy and additional induced power while climbing; this is typically an **8–12% energy penalty** relative to the flat-earth estimate for short urban hops, and grows for missions with substantial altitude change.
3. **Constant system efficiency.** &eta;<sub>total</sub> &asymp; 0.55 is held fixed across throttle setting, airspeed and battery state of charge. In reality motor and ESC efficiency vary with load and cell voltage sags as the pack depletes, so the true usable energy fraction drifts over the course of a real flight rather than staying constant.
4. **Rigid-body drag model.** Parasitic drag uses a single constant <i>C</i><sub>d</sub> and frontal area <i>A</i>; it ignores angle-of-attack changes with airspeed, propeller-wash interference on the airframe, and any payload pod or gimbal added to the frontal silhouette.
5. **No wind.** All ranges and endurance figures are still-air numbers. A headwind on the outbound leg (and tailwind on return, or vice-versa) is not symmetric in energy cost and will change both range and optimum cruise speed.
6. **Sea-level-referenced comparisons unless the altitude slider is moved.** Air density &rho; still follows the ISA model from Experiment 3 — thinner air at altitude lowers both parasitic drag and available thrust, shifting the whole power curve and, with it, every speed and range figure in this experiment.
7. **Reference-pack comparisons don't re-weigh the airframe.** The range-payload envelope swaps in each reference pack's rated energy (Watt-hours) but keeps the rest of the build — including whichever battery is actually selected in Input Parameters — at its current physical mass. A real 6S/5000 pack is heavier than a 4S/1500 one, which would cost a little extra induced power; the envelope isolates the energy-capacity effect only and does not model that added weight.
