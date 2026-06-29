# Lab Procedure: PID Tuning, Ziegler–Nichols & Sensor Fusion

This document outlines the step-by-step workflow for **Experiment 5: Flight Control System**. The experiment is split into two modules across four stages: PID step-response tuning and Ziegler–Nichols auto-tuning (Module 1), then complementary-filter sensor fusion (Module 2). Every value you see is computed live from the selected airframe and IMU, and your full session is saved automatically — reloading the page resumes exactly where you left off.

---

## **Stage 1: Configure the Airframe (Module 1)**

### **Objective**
Fix the roll-axis moment of inertia <i>J</i> from the physical build, since it sets the entire closed-loop response.

### **Step-by-Step Procedure**
1. **Launch the Simulator:** Open the virtual lab page. It loads **Module 1 (PID Step Response)** by default.
2. **Select an Airframe:** In the left-hand panel use the **Airframe** selector (3&Prime; Toothpick, 5&Prime; Freestyle, 7&Prime; Cinematic, 10&Prime; Heavy-Lift). The **Moment of Inertia** readout updates immediately using <i>J</i> = <i>m L</i><sup>2</sup>/2.
3. **Note the Inheritance Badge:** If you completed Experiment 2, the take-off mass and arm length are inherited automatically and the panel shows *"J inherited from Experiment 2"*. Otherwise the airframe preset value is used.
4. **Confirm the Reference Build:** Select **5&Prime; Freestyle** to reproduce the worked examples (<i>J</i> = 0.003 kg&middot;m<sup>2</sup>).

---

## **Stage 2: PID Step-Response Tuning (Module 1)**

### **Objective**
Relate the PID gains to the closed-loop natural frequency and damping, and read the four step-response metrics directly.

![PID step response showing overshoot, rise and settling time](./images/step_response_metrics.png)

### **Step-by-Step Procedure**
1. **Stay on the PID Step Response tab.** The centre **attitude view** shows the drone rolling toward the commanded angle; the **response plot** below traces roll angle versus time with the setpoint, overshoot peak, and the &plusmn;2% settling band marked.
2. **Set the gains.** Drag the **K<sub>p</sub>**, **K<sub>i</sub>** and **K<sub>d</sub>** sliders (start at K<sub>p</sub> = 0.6, K<sub>i</sub> = 0, K<sub>d</sub> = 0.04). Click **Apply Step** to command a new attitude and watch the response.
3. **Read the metrics.** The right column reports **&omega;<sub>n</sub>**, **damping &zeta;**, **overshoot %**, **rise time**, **peak time** and **settling time**. Confirm K<sub>p</sub> = 0.6 / K<sub>d</sub> = 0.04 gives &omega;<sub>n</sub> &asymp; 14.1 rad/s, &zeta; &asymp; 0.47, overshoot &asymp; 18.6%, settling &asymp; 0.60 s.
4. **Explore the K<sub>p</sub>–overshoot trade-off.** Sweep K<sub>p</sub> across 0.2 &rarr; 1.0 (keep K<sub>d</sub> = 0.04). Watch overshoot climb 1.2% &rarr; 29% and cross the **25% comfort limit** near K<sub>p</sub> = 0.8, while the **settling time stays fixed at 0.60 s** — proving it is set by K<sub>d</sub>/(2<i>J</i>), not K<sub>p</sub>.
5. **Expose steady-state error.** Enable the **Disturbance torque** switch (the CG-offset couple <i>&tau;</i><sub>d</sub> = <i>m g d</i> inherited from Experiment 2). The drone now settles *short* of the target. Read **e<sub>ss</sub>**: about 1.67&deg; at K<sub>p</sub> = 0.6, shrinking as K<sub>p</sub> rises.
6. **Null it with integral action.** Raise **K<sub>i</sub>** above zero and re-apply the step. Watch the steady-state error walk to **0&deg;** — the integrator manufacturing the exact counter-torque the disturbance demands.

---

## **Stage 3: Ziegler–Nichols Auto-Tuning (Module 1)**

### **Objective**
Find the gains automatically from the ultimate gain and period, then refine the aggressive classic result into a robust tune.

![Ziegler–Nichols sustained oscillation and the classic vs Tyreus–Luyben step responses](./images/ziegler_nichols_tuning.png)

### **Step-by-Step Procedure**
1. **Switch to the Ziegler–Nichols tab.** The plot now shows the inner **rate-loop** response under pure proportional control.
2. **Find the stability limit.** Drag the **Proportional gain** slider upward. The response goes from damped, to a **sustained constant-amplitude oscillation**, to divergence. Stop at the sustained-oscillation point — the readout latches the **ultimate gain K<sub>u</sub>** and **period P<sub>u</sub>**. For the 5&Prime; airframe, expect K<sub>u</sub> &asymp; 19.25 and P<sub>u</sub> &asymp; 0.051 s.
3. **Apply the classic table.** Click **Auto-tune (Classic Z-N)**. The computed gains appear (K<sub>p</sub> &asymp; 11.55, K<sub>i</sub> &asymp; 450, K<sub>d</sub> &asymp; 0.074) and the step response is drawn. Note the **large ~68% overshoot** — fast but aggressive — with **zero steady-state error** from the integral term.
4. **Refine for robustness.** Switch the **Tuning method** to **Tyreus–Luyben**. The gains change (K<sub>p</sub> &asymp; 8.66, K<sub>i</sub> &asymp; 77, K<sub>d</sub> &asymp; 0.071) and the overshoot drops to about **15%**, under the 25% target, still with zero steady-state error. Compare the two step curves overlaid on the plot.
5. **Draw the conclusion.** Read the commentary: Ziegler–Nichols delivers a *starting point* in one experiment; a robustness retune trades a little rise speed for a calm, flyable response.

---

## **Stage 4: Sensor Fusion — Complementary Filter (Module 2)**

### **Objective**
Fuse a drifting gyro and a noisy accelerometer into a clean attitude estimate, and find the blend coefficient that minimises the combined error.

![Complementary filter fusing drifting gyro and noisy accelerometer into a clean estimate](./images/complementary_filter.png)

### **Step-by-Step Procedure**
1. **Open Module 2 (Sensor Fusion).** Click **Continue to Sensor Fusion** (or open `index1.html`); your airframe selection is carried over.
2. **Select an IMU.** Use the **IMU** selector (MPU-6000, ICM-20602, BMI270, MPU-9250). Its gyro bias, accelerometer noise and sample rate populate the model. Start with the reference **MPU-6000**.
3. **Watch the three traces.** The plot overlays the **true angle**, the **gyro-only estimate** (smooth but slowly drifting away), the **accelerometer angle** (correct on average but noisy), and the **fused estimate**.
4. **Sweep the blend coefficient.** Drag the **Alpha (&alpha;)** slider through 0.90, 0.95, 0.98, 0.99. Read the live **time constant &tau;<sub>f</sub>**, **drift**, **noise RMS** and **total error**. Confirm the total error is **minimised at &alpha; = 0.98** (&asymp; 0.25&deg;) for the reference IMU.
5. **See unbounded drift.** Set &alpha; = 1.0 (pure gyro). The fused trace detaches and **drifts ~18&deg; over 30 s** — the failure the accelerometer reference prevents.
6. **Verify completion.** The right panel confirms the chosen gains, the optimal &alpha;, and the final attitude-estimate error are saved. Your tuned flight-control configuration is now stored for the remaining experiments, completing **Experiment 5**.
