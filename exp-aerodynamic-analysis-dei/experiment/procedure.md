# Lab Procedure: Aerodynamic Analysis

This document outlines the step-by-step workflow required to complete **Experiment 3: Aerodynamic Analysis — Propeller Blade Airfoil, Drag & Advance Ratio**. The experiment consists of three sub-calculations that together characterise the complete aerodynamic state of the drone.

---

## Experiment Overview

The three sub-calculations in this experiment are:

| Sub-Calculation | Focus Area | Student Task |
|-----------------|------------|--------------|
| Sub-Calc A | Lift Coefficient vs Angle of Attack | Plot $C_l$ vs $\alpha$ for NACA airfoils |
| Sub-Calc B | Frame Aerodynamic Drag | Measure $F_D$ at varying wind speeds |
| Sub-Calc C | Advance Ratio & Propulsive Efficiency | Compute $J$ and $\eta_{prop}$ for cruise optimization |

---

## Stage 1: Airfoil Profiling (Sub-Calc A)

### Objective
Plot the Lift Coefficient ($C_l$) against the Angle of Attack ($\alpha$) for distinct NACA airfoil profiles to determine stall characteristics.

### Step-by-Step Procedure

1. **Launch the Simulator**: Open the virtual lab page in your browser. Navigate to **Module 1: Airfoil Profiling**.

2. **Select Airfoil Profile**: In the left-hand configuration panel, choose a NACA airfoil profile from the dropdown:
   * **NACA 0012**: Symmetric airfoil (0% camber)
   * **NACA 2412**: 2% camber at 40% chord
   * **NACA 4412**: 4% camber at 40% chord

3. **Sweep Angle of Attack**: Use the **Angle of Attack ($\alpha$)** slider to sweep through angles from $-5°$ to $20°$:
   * Observe the 2D airfoil cross-section rotating in the 3D viewport
   * Watch the pressure distribution visualization on the upper and lower surfaces

4. **Record Lift Coefficient**: For each angle setting, record the displayed Lift Coefficient ($C_l$) value in the data table:
   * Note the linear region where $C_l$ increases proportionally with $\alpha$
   * Identify the stall angle where $C_l$ reaches maximum and then drops

5. **Plot $C_l$ vs $\alpha$ Curve**: The right panel displays the real-time plot of Lift Coefficient vs Angle of Attack:
   * Observe the slope (should be approximately $2\pi$ per radian in the linear region)
   * Note the zero-lift angle ($\alpha_0$) where the curve crosses the x-axis

6. **Compare Airfoils**: Repeat steps 2-5 for all three NACA profiles and record:
   * **$C_{l\_max}$**: Maximum lift coefficient
   * **Stall angle**: Angle of attack at which stall occurs

7. **Key Observations**:
   * NACA 4412 (heavily cambered) achieves $C_{l\_max} \approx 1.6$
   * NACA 0012 (symmetric) achieves $C_{l\_max} \approx 1.2$
   * Cambered airfoils stall at lower angles of attack

![Airfoil Profiling Interface](./images/airfoil_profiles.png)

---

## Stage 2: Drag Measurement (Sub-Calc B)

### Objective
Measure the aerodynamic drag force ($F_D$) acting on the bluff body of the drone frame across varying wind speeds.

### Step-by-Step Procedure

1. **Navigate to Module 2**: Click on **Module 2: Drag Measurement** tab.

2. **Review Setup**: The 3D viewport shows the drone frame positioned in a virtual wind tunnel:
   * The frame is an X-configuration quadcopter body
   * Frontal area ($A_{frontal}$) is displayed in the status panel
   * Drag coefficient ($C_d = 1.05$) is pre-configured for X-frame bluff body

3. **Set Wind Speed**: Use the **Wind Speed ($V$)** slider to vary the airspeed from $0$ to $15$ m/s in 5 steps matching the DB `wind_speed_steps`:
   * Step 1: $V = 0$ m/s
   * Step 2: $V = 3.75$ m/s
   * Step 3: $V = 7.5$ m/s
   * Step 4: $V = 11.25$ m/s
   * Step 5: $V = 15$ m/s

4. **Record Drag Force**: For each wind speed, observe and record:
   * **Drag Force ($F_D$)**: Displayed on the virtual force gauge
   * **Velocity Squared ($V^2$)**: Calculated and displayed in the data table

5. **Analyze the Relationship**: The right panel shows two plots:
   * **$F_D$ vs $V$**: Shows quadratic (parabolic) relationship
   * **$F_D$ vs $V^2$**: Shows linear relationship

6. **Verify Linear Regression**: Check the regression statistics:
   * The $F_D$ vs $V^2$ plot should yield $R^2 > 0.999$
   * Slope should equal $0.5 \cdot \rho \cdot C_d \cdot A_{frontal}$

7. **Key Observations**:
   * Drag force scales quadratically with velocity
   * Doubling speed quadruples drag force
   * Power required to overcome drag scales with $V^3$

![Drag Measurement Setup](./images/drag_setup.png)

---

## Stage 3: Cruise Dynamics (Sub-Calc C)

### Objective
Compute the Advance Ratio ($J$) to understand how the propeller behaves when moving through incoming air rather than stationary air.

### Step-by-Step Procedure

1. **Navigate to Module 3**: Click on **Module 3: Cruise Dynamics** tab.

2. **Review Propeller Parameters**: The left panel displays:
   * Propeller diameter ($D$): e.g., 5 inches (0.127 m)
   * Propeller pitch: e.g., 4.5 inches
   * Rotational speed ($n$): Configurable in RPS

3. **Set Forward Airspeed**: Input 5 different forward airspeed values matching the DB `forward_speed_steps`:
   * $V$ = 2 m/s, 5 m/s, 8 m/s, 12 m/s, 15 m/s
   * These represent realistic cruise speeds the drone might achieve at different throttle settings.

4. **Calculate Advance Ratio**: For each forward speed, the system computes:
   $$J = \frac{V}{n \cdot D}$$

5. **Observe Propeller Behavior**: The 3D viewport shows:
   * Propeller rotating at the set RPM
   * Incoming airflow visualization
   * Effective angle of attack changes

6. **Record Results**: Fill in the data table with:
   * Forward airspeed ($V$)
   * Advance Ratio ($J$)
   * Effective angle of attack

![Advance Ratio Diagram](./images/advance_ratio_diagram.png)

---

## Stage 4: Efficiency Optimization (Sub-Calc C)

### Objective
Calculate propulsive efficiency ($\eta_{prop}$) across the tested forward speeds and identify the peak efficiency operating point.

### Step-by-Step Procedure

1. **Continue in Module 3**: Stay in the Cruise Dynamics module.

2. **Run Efficiency Sweep**: Click the **Run Efficiency Sweep** button:
   * The simulator calculates thrust, torque, and efficiency at each forward speed
   * Watch the efficiency curve build in real-time

3. **Analyze Efficiency Curve**: The right panel displays the **Propulsive Efficiency vs Advance Ratio** plot:
   * At $J = 0$ (hover): $\eta_{prop} = 0$
   * Efficiency rises with increasing $J$
   * Peak efficiency occurs at optimal $J$
   * Efficiency drops beyond peak due to blade stall

4. **Identify Peak Efficiency**: Locate the maximum efficiency point:
   * For a standard 5045 propeller, peak $\eta_{prop}$ occurs at $J \approx 0.55$
   * Record the corresponding forward airspeed

5. **Review Power Flow**: Examine the **Sankey diagram** showing the power flow: input shaft power ($P_{in} = 2\pi \cdot n \cdot Q$) is split into useful thrust power ($P_{out} = T \cdot V$) representing forward propulsion, and aerodynamic losses (profile drag, induced drag, tip losses). Efficiency is $\eta_{prop} = P_{out} / P_{in}$.

6. **Key Observations**:
   * Propulsive efficiency is zero at hover (no forward motion)
   * Peak efficiency defines optimal cruise speed
   * Flying faster or slower than optimal reduces efficiency

![Propulsive Efficiency Curve](./images/efficiency_curve.png)

---

## Summary: Expected Results

| Parameter | Expected Value |
|-----------|----------------|
| NACA 4412 $C_{l\_max}$ | $\approx 1.6$ |
| NACA 0012 $C_{l\_max}$ | $\approx 1.2$ |
| $F_D$ vs $V^2$ regression | $R^2 > 0.999$ |
| Peak $\eta_{prop}$ advance ratio | $J = 0.55$ (5045 propeller) |

---

## Component Unlocked

Upon successful aerodynamic validation:

1. **Propeller Blade Profile**: The 3D model visually updates to reflect the selected NACA section.

2. **Drag Value Storage**: The calculated aerodynamic drag value ($F_D$) at 15 m/s (Step 5 of Sub-Calc B) is permanently stored as `vlabExp3_dragForce` in browser local storage and will be pulled directly into **Experiment 7** (mission range calculation) as the required cruise drag input.