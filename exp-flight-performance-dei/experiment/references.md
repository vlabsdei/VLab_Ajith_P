# Academic References

The thrust-to-weight, hover-throttle, payload, and momentum-theory efficiency models implemented in this experiment are derived from the following rotorcraft, propulsion, and multicopter-design literature:

1. **Quan Quan**, *Introduction to Multicopter Design and Control*. Singapore: Springer, 2017.  
   *(Primary reference for multirotor thrust-to-weight sizing, hover-throttle estimation from the propeller thrust curve, payload limits, and the full performance-envelope methodology used across all four sub-calculations.)*

2. **J. G. Leishman**, *Principles of Helicopter Aerodynamics*, 2nd ed. Cambridge, UK: Cambridge University Press, 2006.  
   *(Source of momentum (actuator-disk) theory, induced hover power P = T^1.5 / sqrt(2 rho A), and the figure of merit used in the hover-efficiency sub-calculation.)*

3. **W. Johnson**, *Helicopter Theory*. New York, NY: Dover Publications, 1994.  
   *(Detailed treatment of actuator-disk induced power, disk loading, and ideal vs real rotor power that underpins the efficiency model.)*

4. **R. W. Beard and T. W. McLain**, *Small Unmanned Aircraft: Theory and Practice*. Princeton, NJ: Princeton University Press, 2012.  
   *(Provides the multirotor thrust model, the T proportional to RPM^2 relationship, and the link between motor command and produced thrust carried over from Experiment 1.)*

5. **J. B. Brandt and M. S. Selig**, "Propeller Performance Data at Low Reynolds Numbers," in *49th AIAA Aerospace Sciences Meeting*, AIAA 2011-1255, Orlando, FL, 2011.  
   *(Experimental small-propeller thrust and power coefficient data validating the quadratic thrust-vs-RPM curve used for hover-throttle estimation.)*

6. **M. Hassanalian and A. Abdelkefi**, "Classifications, applications, and design challenges of drones: A review," *Progress in Aerospace Sciences*, vol. 91, pp. 99–131, 2017.  
   *(Reference for drone classification by thrust-to-weight ratio and mission, and for payload-fraction trends across multirotor scales.)*
