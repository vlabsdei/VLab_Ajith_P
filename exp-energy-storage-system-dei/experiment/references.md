# Academic References

The C-rating and discharge-limit model, internal-resistance voltage-sag model, Peukert-style capacity derating, and coulomb-counting state-of-charge estimation implemented in this experiment are derived from the following battery-engineering and electrochemistry literature:

1. **D. Linden and T. B. Reddy (eds.)**, *Handbook of Batteries*, 4th ed. New York, NY: McGraw-Hill, 2011.  
   *(Standard reference for cell capacity, C-rate discharge behaviour, and the rate-dependence of usable capacity underlying the continuous/burst discharge-limit model.)*

2. **G. L. Plett**, *Battery Management Systems, Volume I: Battery Modeling*. Norwood, MA: Artech House, 2015.  
   *(Source for the equivalent-circuit cell model, internal-resistance/terminal-voltage relationship, coulomb-counting, and open-circuit-voltage-to-state-of-charge inversion used in Sections 2 and 4.)*

3. **D. Doerffel and S. A. Sharkh**, "A critical review of using the Peukert equation for determining the remaining capacity of lead-acid and lithium-ion batteries," *Journal of Power Sources*, vol. 155, no. 2, pp. 395–400, 2006.  
   *(Basis for the practical, empirical Peukert-style derating that shrinks a pack's usable capacity as discharge rate rises, used in Section 3.)*

4. **M. Chen and G. A. Rincón-Mora**, "Accurate Electrical Battery Model Capable of Predicting Runtime and I-V Performance," *IEEE Transactions on Energy Conversion*, vol. 21, no. 2, pp. 504–511, 2006.  
   *(Provides the nonlinear open-circuit-voltage curve, the internal-resistance voltage-sag model, and the runtime/state-of-charge prediction that underpin Sections 2 and 4.)*

5. **L. W. Traub**, "Range and Endurance Estimates for Battery-Powered Aircraft," *Journal of Aircraft*, vol. 48, no. 2, pp. 703–707, 2011.  
   *(Derives how effective pack capacity and pack mass convert into hover/endurance time for electric aircraft, used in the endurance section.)*
