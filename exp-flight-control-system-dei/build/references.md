# Academic References

The PID control law, second-order step-response metrics, Ziegler–Nichols ultimate-cycle tuning, and complementary-filter sensor-fusion models implemented in this experiment are derived from the following control-systems and unmanned-aircraft literature:

1. **K. Ogata**, *Modern Control Engineering*, 5th ed. Upper Saddle River, NJ: Pearson, 2010.  
   *(Source for the PID controller, the second-order prototype response, the overshoot / rise-time / settling-time formulas, and steady-state error analysis used in Sub-Calculations A and the disturbance section.)*

2. **N. S. Nise**, *Control Systems Engineering*, 7th ed. Hoboken, NJ: John Wiley & Sons, 2015.  
   *(Provides the time-domain specifications, the damping-ratio / natural-frequency mapping, and the Routh–Hurwitz stability criterion that fixes the ultimate gain.)*

3. **J. G. Ziegler and N. B. Nichols**, "Optimum Settings for Automatic Controllers," *Transactions of the ASME*, vol. 64, pp. 759–768, 1942.  
   *(The original ultimate-cycle tuning rules — Kp = 0.6 Ku, Ti = 0.5 Pu, Td = 0.125 Pu — implemented in the auto-tune sub-calculation.)*

4. **G. F. Franklin, J. D. Powell, and A. Emami-Naeini**, *Feedback Control of Dynamic Systems*, 7th ed. Upper Saddle River, NJ: Pearson, 2015.  
   *(Covers cascaded angle/rate loop architecture, derivative-on-measurement, and the digital implementation of PID used in the simulation.)*

5. **B. D. Tyreus and W. L. Luyben**, "Tuning PI Controllers for Integrator/Dead-Time Processes," *Industrial & Engineering Chemistry Research*, vol. 31, no. 11, pp. 2625–2628, 1992.  
   *(Basis for the robust Tyreus–Luyben retuning that lowers the aggressive classic Z-N overshoot below the comfort target.)*

6. **R. W. Beard and T. W. McLain**, *Small Unmanned Aircraft: Theory and Practice*. Princeton, NJ: Princeton University Press, 2012.  
   *(Supplies the multirotor rigid-body attitude dynamics, the moment-of-inertia model, and the cascaded attitude-control structure carried over from the Experiment-2 airframe.)*

7. **W. T. Higgins**, "A Comparison of Complementary and Kalman Filtering," *IEEE Transactions on Aerospace and Electronic Systems*, vol. AES-11, no. 3, pp. 321–325, 1975.  
   *(Derives the complementary filter, its high-pass/low-pass split, and its relationship to the optimal Kalman filter — the foundation of the sensor-fusion sub-calculation.)*
