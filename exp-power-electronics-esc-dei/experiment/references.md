# Academic References

The pulse-width modulation models, control-resolution relationships, MOSFET conduction-loss equations, and thermal-coefficient data implemented in this experiment are derived from the following power-electronics, embedded-systems, and electrical-machines literature:

1. **N. Mohan, T. M. Undeland, and W. P. Robbins**, *Power Electronics: Converters, Applications, and Design*, 3rd ed. Hoboken, NJ: John Wiley & Sons, 2003.  
   *(Provides the switching-converter foundations, MOSFET conduction loss P = I<sup>2</sup>R<sub>DS(on)</sub>, and duty-cycle/PWM theory used in the resolution and dissipation sub-calculations.)*

2. **M. H. Rashid**, *Power Electronics: Circuits, Devices, and Applications*, 4th ed. Harlow, UK: Pearson Education, 2014.  
   *(Covers PWM generation, switching frequency selection, and the trade-off between switching loss and conduction loss in power MOSFET stages.)*

3. **J. G. Kassakian, M. F. Schlecht, and G. C. Verghese**, *Principles of Power Electronics*, 2nd ed. Cambridge, UK: Cambridge University Press, 2023.  
   *(Details gate-drive timing, dead-time/dead-band insertion, and converter control resolution as a function of timer clock and modulation frequency.)*

4. **D. C. Hanselman**, *Brushless Permanent Magnet Motor Design*, 2nd ed. Madison, WI: Magna Physics Publishing, 2006.  
   *(Supplies the BLDC commutation and back-EMF relationships that link the ESC phase current to the motor operating point carried forward from Experiment 1.)*

5. **Texas Instruments**, "Calculating Power Dissipation for a H-Bridge or Half-Bridge Driver," Application Report SLVA504A, Texas Instruments Inc., Dallas, TX, 2011.  
   *(Practical reference for MOSFET conduction-loss estimation, the positive temperature coefficient of R<sub>DS(on)</sub>, and junction-to-ambient thermal-resistance heatsinking decisions.)*

6. **IEEE Standard 1459-2010**, *IEEE Standard Definitions for the Measurement of Electric Power Quantities Under Sinusoidal, Nonsinusoidal, Balanced, or Unbalanced Conditions*, IEEE, New York, NY, 2010.  
   *(Reference for RMS current and average power definitions underlying the I<sup>2</sup>R dissipation computation.)*
