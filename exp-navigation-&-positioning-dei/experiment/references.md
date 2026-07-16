# Academic References

The dilution-of-precision math, circular-error statistics, and barometric altimetry model implemented in this experiment are derived from the following geodesy, satellite-navigation, and atmospheric-science literature:

1. **E. D. Kaplan and C. J. Hegarty (eds.)**, *Understanding GPS/GNSS: Principles and Applications*, 3rd ed. Boston, MA: Artech House, 2017.
   *(Standard reference for the geometry (design) matrix, the (GᵀG)⁻¹ covariance derivation, and the HDOP/VDOP/PDOP/GDOP definitions used directly in this experiment's constellation-geometry model.)*

2. **P. Misra and P. Enge**, *Global Positioning System: Signals, Measurements, and Performance*, 2nd ed. Lincoln, MA: Ganga-Jamuna Press, 2006.
   *(Covers pseudorange error budgets, User-Equivalent Range Error (UERE), and the propagation of ranging error into position error through dilution of precision.)*

3. **B. W. Parkinson and J. J. Spilker Jr. (eds.)**, *Global Positioning System: Theory and Applications, Volume I*. Washington, DC: American Institute of Aeronautics and Astronautics, 1996.
   *(Chapters on GPS accuracy statistics, including the Rayleigh-distribution treatment of horizontal fix scatter and the Circular Error Probable (CEP) figure of merit used in this experiment's horizontal-accuracy module.)*

4. **P. D. Groves**, *Principles of GNSS, Inertial, and Multisensor Integrated Navigation Systems*, 2nd ed. Boston, MA: Artech House, 2013.
   *(Treats the combination of independent horizontal and vertical error sources into a single navigation error budget, the approach used in this experiment's 3-D error-synthesis module.)*

5. **International Civil Aviation Organization**, *Manual of the ICAO Standard Atmosphere*, Doc 7488, 3rd ed. Montreal, Canada: ICAO, 1993.
   *(Defines the lapse-rate/pressure relationship that this experiment's barometric altimeter model uses to convert sensed pressure into indicated altitude.)*

6. **NOAA, NASA, and USAF**, *U.S. Standard Atmosphere, 1976*, NOAA-S/T 76-1562. Washington, DC: U.S. Government Printing Office, 1976.
   *(Reference temperature, pressure, and lapse-rate constants for the troposphere, and the physical basis for why a barometric sensor drifts when the real atmospheric column departs from the standard profile — e.g. a temperature inversion.)*
