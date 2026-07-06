/* ==========================================================================
 * Experiment 05 — Flight Control System (PID · Ziegler–Nichols · Sensor Fusion
 * · Full System). SINGLE consolidated bundle: shared cross-experiment runtime
 * preludes (constants, catalog, store, validation, ui, lab kit, shared drone
 * model) followed by the experiment code. One <script> per page.
 * ========================================================================== */

/* ===== SHARED PRELUDE 1/7: constants.js ===== */
/* ============================================================================
 * Drone Technology Virtual Lab — Canonical Constants & Real-World Error Model
 * Single source of truth for every experiment. Mirrors shared/PHYSICS_AND_ERROR_MODEL.md.
 * Vendored (copied identical) into each experiment's simulation/js/ folder.
 *
 * Loads as a browser global (window.VLAB_CONST) and as an ES/CommonJS module
 * so the vitest suite can import it headlessly.
 * ==========================================================================*/
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;     // node / vitest
  root.VLAB_CONST = api;                                                       // browser global
}(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  // ── 1. Global physical constants (§1 of the spec) ─────────────────────────
  const PHYS = Object.freeze({
    g: 9.80665,            // m/s^2  standard gravity — use everywhere, never 9.81
    rho_SL: 1.225,         // kg/m^3 ISA sea-level density
    T_SL: 288.15,          // K
    P_SL: 101325,          // Pa
    L_lapse: 0.0065,       // K/m
    R_air: 287.05,         // J/(kg*K)
    mu_air: 1.81e-5,       // Pa*s
    cp_air: 1005,          // J/(kg*K)
    DEG_PER_RAD: 57.29577951308232,
    alpha_cu: 0.00393      // 1/K copper resistance temperature coefficient
  });

  // ISA density vs altitude [m] -> kg/m^3
  function airDensity(h) {
    const hh = Math.max(0, Math.min(11000, h || 0));
    return PHYS.rho_SL * Math.pow(1 - 2.25577e-5 * hh, 4.25588);
  }

  // ── 2. Real-world error / tolerance parameters (§0 of the spec) ───────────
  // Each tolerance is a fractional half-width: actual = nominal * (1 + tol*u),
  // u in [-1,+1] drawn ONCE per part from a seeded PRNG (reproducible per build).
  const TOL = Object.freeze({
    motor_kv: 0.08,            // ±8%  hobby BLDC Kv bin spread
    motor_rm: 0.10,            // ±10% winding resistance part tolerance
    motor_i0: 0.15,            // ±15% no-load current
    prop_mass: 0.05,           // ±5%  propeller mass
    prop_pitch_in: 0.30,       // ±0.30 inch effective-pitch variance (absolute, see note)
    batt_capacity: 0.05,       // ±5%  pack capacity
    batt_ir: 0.20,             // ±20% cell internal resistance
    material_yield: 0.10,      // ±10% layup/material yield strength
    esc_rdson: 0.10            // ±10% MOSFET Rds(on)
  });

  // Operating-point non-idealities and reference values.
  const REAL = Object.freeze({
    // Motor
    motor_eta_peak_throttle: [0.70, 0.80],   // peak efficiency band (frac of rated current)
    iron_loss_exp: 1.3,                       // P_iron ∝ f^1.3
    // ESC / MOSFET
    mosfet_rdson_tempco: 0.006,               // +0.6%/°C (hobby logic-level FET)
    esc_thermal_limit_C: 80,
    esc_heatsink_threshold_W: 2.0,
    // Propeller / aero
    reynolds_ref: 150000,                     // Re reference for (Re_ref/Re)^0.25 penalty
    reynolds_exp: 0.25,
    prop_eff_range: [0.28, 0.65],             // measured small-prop efficiency span
    rotor_airframe_drag_extra: [0.15, 0.30],  // +15-30% real frame drag in rotor wash
    // Battery (LiPo)
    cell_ir_mohm_healthy: [1, 8],
    cell_ir_mohm_degraded: 15,
    cell_ir_mohm_unsafe: 25,
    c_rating_effective_frac: 0.55,            // sustained ≈ 0.5-0.6 × label
    cell_vmin_v: 3.5,
    cell_vmax_v: 4.2,
    cell_vsag_punch_v: 3.3,
    usable_capacity_frac: 0.80,               // 80% rule (before Peukert)
    // Structure
    dynamic_load_factor_default: 1.5,         // static->dynamic maneuver factor
    dynamic_load_factor_range: [1.0, 3.0],
    arm_bending_mode_hz: [80, 120],           // typical long-arm 1st bending mode
    // Hover / rotor
    figure_of_merit_range: [0.55, 0.75],
    // Thermal
    motor_thermal_limit_C: 80,
    winding_to_housing_offset_C: 25           // windings run hotter than the measured case
  });

  // ── 3. Sensor (IMU/GPS) reference error model (§7, Exp8) ──────────────────
  const SENSOR = Object.freeze({
    // Allan-variance terms by IMU grade (representative, deg & deg/s units)
    imu_grades: {
      hobby:     { arw_dps_rthz: 0.03,  bias_instab_dps: 6.0,  accel_vrw: 0.30 }, // MPU-6000 class
      midrange:  { arw_dps_rthz: 0.012, bias_instab_dps: 2.0,  accel_vrw: 0.15 }, // ICM-class
      precision: { arw_dps_rthz: 0.004, bias_instab_dps: 0.5,  accel_vrw: 0.05 }  // ADIS-class
    },
    gps_uere_m: 3.0,                 // user-equivalent range error (civilian)
    gps_typical_cep_m: 5.0,          // good-geometry horizontal CEP
    gps_lowcost_95pct_m: 10.0,
    baro_vmin_alt_err_m: 0.5,        // at low altitude
    complementary_alpha_set: [0.90, 0.95, 0.98, 0.99]
  });

  // ── 4. Cross-experiment validity thresholds (§9 constraint graph) ─────────
  const LIMITS = Object.freeze({
    twr_min_fly: 1.0,
    twr_min_safe: 1.5,
    twr_min_default: 2.0,
    cg_offset_pass_mm: 10.0,
    cg_offset_ideal_mm: 5.0,
    sf_min: 2.0,
    overshoot_max_pct: 25,
    esc_temp_max_C: 80,
    motor_temp_max_C: 80,
    cell_vmin_v: 3.5,
    cep_max_m: 5.0,
    baro_err_max_m: 2.0
  });

  // ── 5. Seeded PRNG (mulberry32) + helpers for reproducible "part draws" ────
  function hashString(str) {                 // FNV-1a -> uint32 seed
    let h = 2166136261 >>> 0;
    const s = String(str);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Deterministic signed unit deviate in [-1,+1] for a given part+field key.
  function partDeviate(key) { return mulberry32(hashString(key))() * 2 - 1; }
  // Apply a fractional tolerance to a nominal value, seeded by key.
  function applyTol(nominal, tol, key) { return nominal * (1 + tol * partDeviate(key)); }

  return Object.freeze({
    VERSION: '1.0.0',
    PHYS, TOL, REAL, SENSOR, LIMITS,
    airDensity, hashString, mulberry32, partDeviate, applyTol
  });
}));

/* ===== SHARED PRELUDE 2/7: catalog.js ===== */
/* AUTO-GENERATED from shared/catalog.json by shared/vendor.mjs — do not edit. */
(function (root) {
  var CATALOG = {
  "meta": {
    "version": "1.0.0",
    "title": "Drone Technology Virtual Lab — Unified Component Catalog",
    "note": "Single deduplicated catalog shared by all experiments. Replaces the six divergent db.json files. IDs are canonical and consistent lab-wide. Masses in grams, electrical in SI, dimensions in mm unless noted. Real-world fields (tolerances handled in constants.js) added: motor k_fe iron-loss coeff; battery c_rating + cell_ir_mohm; esc rds_on_ohm + r_th_c_per_w; frame arm_profile + frontal_area_m2 + recommended_prop_in; propeller ct/cq/optimal_j/pitch.",
    "configuration": "Quadcopter — 4 rotors (N=4)"
  },

  "frames": [
    { "id": "cf_250", "label": "Carbon Fibre T700 — 250 mm", "material": "carbon_fibre", "wheelbase_mm": 250, "arm_length_mm": 105, "mass_g": 68.2, "color_hex": "#1c1c1e", "roughness": 0.35, "metalness": 0.05, "arm_tube_od_mm": 10, "arm_profile": { "b_mm": 10.0, "h_mm": 6.0, "t_mm": 1.0 }, "body_size_mm": [60, 20, 60], "frontal_area_m2": 0.0085, "recommended_prop_in": [5, 6], "description": "High-modulus T700 layup. Best for 5-inch propellers." },
    { "id": "cf_330", "label": "Carbon Fibre T700 — 330 mm", "material": "carbon_fibre", "wheelbase_mm": 330, "arm_length_mm": 142, "mass_g": 94.1, "color_hex": "#1c1c1e", "roughness": 0.35, "metalness": 0.05, "arm_tube_od_mm": 12, "arm_profile": { "b_mm": 12.0, "h_mm": 7.0, "t_mm": 1.2 }, "body_size_mm": [72, 22, 72], "frontal_area_m2": 0.0112, "recommended_prop_in": [6, 7], "description": "Mid-size T700 H-frame. 6-7 inch props." },
    { "id": "cf_450", "label": "Carbon Fibre T700 — 450 mm", "material": "carbon_fibre", "wheelbase_mm": 450, "arm_length_mm": 196, "mass_g": 138.5, "color_hex": "#1c1c1e", "roughness": 0.35, "metalness": 0.05, "arm_tube_od_mm": 16, "arm_profile": { "b_mm": 15.0, "h_mm": 8.0, "t_mm": 1.5 }, "body_size_mm": [88, 26, 88], "frontal_area_m2": 0.0152, "recommended_prop_in": [9, 10], "description": "Standard 450-class. 9-10 inch props." },
    { "id": "cf_550", "label": "Carbon Fibre T700 — 550 mm", "material": "carbon_fibre", "wheelbase_mm": 550, "arm_length_mm": 240, "mass_g": 210.0, "color_hex": "#1c1c1e", "roughness": 0.35, "metalness": 0.05, "arm_tube_od_mm": 16, "arm_profile": { "b_mm": 16.0, "h_mm": 10.0, "t_mm": 1.5 }, "body_size_mm": [100, 28, 100], "frontal_area_m2": 0.0198, "recommended_prop_in": [11, 12], "description": "Heavy-duty 550-class. 11-12 inch props." },
    { "id": "cf_680", "label": "Carbon Fibre T700 — 680 mm", "material": "carbon_fibre", "wheelbase_mm": 680, "arm_length_mm": 300, "mass_g": 320.0, "color_hex": "#1c1c1e", "roughness": 0.35, "metalness": 0.05, "arm_tube_od_mm": 20, "arm_profile": { "b_mm": 18.0, "h_mm": 12.0, "t_mm": 2.0 }, "body_size_mm": [120, 32, 120], "frontal_area_m2": 0.0265, "recommended_prop_in": [13, 14], "description": "Cinematography heavy lifter. 13-14 inch props." },
    { "id": "cf_850", "label": "Carbon Fibre T700 — 850 mm", "material": "carbon_fibre", "wheelbase_mm": 850, "arm_length_mm": 380, "mass_g": 490.0, "color_hex": "#1c1c1e", "roughness": 0.35, "metalness": 0.05, "arm_tube_od_mm": 22, "arm_profile": { "b_mm": 20.0, "h_mm": 14.0, "t_mm": 2.0 }, "body_size_mm": [140, 35, 140], "frontal_area_m2": 0.0350, "recommended_prop_in": [15, 17], "description": "Industrial mapping platform. 15-17 inch props." }
  ],

  "motors": [
    { "id": "1806_2300", "label": "1806 — 2300 KV", "stator_size": "1806", "kv": 2300, "mass_g": 19.2, "rm_ohm": 0.118, "i0_a": 0.25, "k_fe": 0.00024, "max_current_a": 20, "max_power_w": 210, "bell_diameter_mm": 20, "bell_height_mm": 18, "recommended_prop_in": [5, 6] },
    { "id": "2204_2300", "label": "2204 — 2300 KV", "stator_size": "2204", "kv": 2300, "mass_g": 25.0, "rm_ohm": 0.095, "i0_a": 0.30, "k_fe": 0.00028, "max_current_a": 25, "max_power_w": 350, "bell_diameter_mm": 27.0, "bell_height_mm": 20, "recommended_prop_in": [5, 6] },
    { "id": "2207_1600", "label": "2207 — 1600 KV", "stator_size": "2207", "kv": 1600, "mass_g": 34.0, "rm_ohm": 0.075, "i0_a": 0.40, "k_fe": 0.00032, "max_current_a": 35, "max_power_w": 580, "bell_diameter_mm": 28.0, "bell_height_mm": 21, "recommended_prop_in": [6, 7] },
    { "id": "2212_920", "label": "2212 — 920 KV", "stator_size": "2212", "kv": 920, "mass_g": 52.0, "rm_ohm": 0.142, "i0_a": 0.35, "k_fe": 0.00040, "max_current_a": 22, "max_power_w": 230, "bell_diameter_mm": 27.7, "bell_height_mm": 26, "recommended_prop_in": [9, 10] },
    { "id": "2808_1200", "label": "2808 — 1200 KV", "stator_size": "2808", "kv": 1200, "mass_g": 78.0, "rm_ohm": 0.082, "i0_a": 0.50, "k_fe": 0.00052, "max_current_a": 40, "max_power_w": 850, "bell_diameter_mm": 35, "bell_height_mm": 24, "recommended_prop_in": [9, 11] },
    { "id": "3508_700", "label": "3508 — 700 KV", "stator_size": "3508", "kv": 700, "mass_g": 115.0, "rm_ohm": 0.065, "i0_a": 0.45, "k_fe": 0.00064, "max_current_a": 28, "max_power_w": 600, "bell_diameter_mm": 42, "bell_height_mm": 26, "recommended_prop_in": [11, 13] },
    { "id": "4008_380", "label": "4008 — 380 KV", "stator_size": "4008", "kv": 380, "mass_g": 148.0, "rm_ohm": 0.052, "i0_a": 0.38, "k_fe": 0.00072, "max_current_a": 30, "max_power_w": 720, "bell_diameter_mm": 46, "bell_height_mm": 30, "recommended_prop_in": [13, 16] },
    { "id": "5010_280", "label": "5010 — 280 KV", "stator_size": "5010", "kv": 280, "mass_g": 210.0, "rm_ohm": 0.038, "i0_a": 0.55, "k_fe": 0.00088, "max_current_a": 35, "max_power_w": 950, "bell_diameter_mm": 58, "bell_height_mm": 32, "recommended_prop_in": [15, 17] }
  ],

  "propellers": [
    { "id": "5045_2b", "label": "5\" Prop (5x4.5)", "diameter_in": 5, "diameter_m": 0.1270, "blades": 2, "pitch_in": 4.5, "pitch_diameter_ratio": 0.9, "mass_g_each": 3.1, "material": "glass_nylon", "ct": 0.109, "cq": 0.01223, "optimal_j": 0.55, "peak_efficiency_percent": 62 },
    { "id": "6045_2b", "label": "6\" Prop (6x4.5)", "diameter_in": 6, "diameter_m": 0.1524, "blades": 2, "pitch_in": 4.5, "pitch_diameter_ratio": 0.75, "mass_g_each": 4.5, "material": "glass_nylon", "ct": 0.112, "cq": 0.01236, "optimal_j": 0.52, "peak_efficiency_percent": 60 },
    { "id": "7045_2b", "label": "7\" Prop (7x4.5)", "diameter_in": 7, "diameter_m": 0.1778, "blades": 2, "pitch_in": 4.5, "pitch_diameter_ratio": 0.643, "mass_g_each": 6.2, "material": "carbon_nylon", "ct": 0.110, "cq": 0.01183, "optimal_j": 0.50, "peak_efficiency_percent": 58 },
    { "id": "9045_2b", "label": "9\" Prop (9x4.5)", "diameter_in": 9, "diameter_m": 0.2286, "blades": 2, "pitch_in": 4.5, "pitch_diameter_ratio": 0.5, "mass_g_each": 11.2, "material": "carbon_nylon", "ct": 0.115, "cq": 0.01220, "optimal_j": 0.48, "peak_efficiency_percent": 56 },
    { "id": "1045_2b", "label": "10\" Prop (10x4.5)", "diameter_in": 10, "diameter_m": 0.2540, "blades": 2, "pitch_in": 4.5, "pitch_diameter_ratio": 0.45, "mass_g_each": 16.1, "material": "carbon_nylon", "ct": 0.116, "cq": 0.01222, "optimal_j": 0.47, "peak_efficiency_percent": 55 },
    { "id": "1245_2b", "label": "12\" Prop (12x4.5)", "diameter_in": 12, "diameter_m": 0.3048, "blades": 2, "pitch_in": 4.5, "pitch_diameter_ratio": 0.375, "mass_g_each": 26.5, "material": "carbon_fibre", "ct": 0.118, "cq": 0.01207, "optimal_j": 0.45, "peak_efficiency_percent": 54 },
    { "id": "1445_2b", "label": "14\" Prop (14x4.5)", "diameter_in": 14, "diameter_m": 0.3556, "blades": 2, "pitch_in": 4.5, "pitch_diameter_ratio": 0.321, "mass_g_each": 42.0, "material": "carbon_fibre", "ct": 0.120, "cq": 0.01236, "optimal_j": 0.44, "peak_efficiency_percent": 52 },
    { "id": "1655_2b", "label": "16\" Prop (16x5.5)", "diameter_in": 16, "diameter_m": 0.4064, "blades": 2, "pitch_in": 5.5, "pitch_diameter_ratio": 0.344, "mass_g_each": 64.3, "material": "carbon_fibre", "ct": 0.122, "cq": 0.01236, "optimal_j": 0.42, "peak_efficiency_percent": 50 }
  ],

  "batteries": [
    { "id": "3s_1500", "label": "3S LiPo — 1500 mAh", "cells": 3, "voltage_nominal_v": 11.1, "capacity_mah": 1500, "mass_g": 134.0, "c_rating": 75, "cell_ir_mohm": 4.5 },
    { "id": "3s_2200", "label": "3S LiPo — 2200 mAh", "cells": 3, "voltage_nominal_v": 11.1, "capacity_mah": 2200, "mass_g": 188.0, "c_rating": 45, "cell_ir_mohm": 5.5 },
    { "id": "4s_1500", "label": "4S LiPo — 1500 mAh", "cells": 4, "voltage_nominal_v": 14.8, "capacity_mah": 1500, "mass_g": 178.0, "c_rating": 95, "cell_ir_mohm": 4.0 },
    { "id": "4s_3300", "label": "4S LiPo — 3300 mAh", "cells": 4, "voltage_nominal_v": 14.8, "capacity_mah": 3300, "mass_g": 320.0, "c_rating": 35, "cell_ir_mohm": 6.5 },
    { "id": "6s_4000", "label": "6S LiPo — 4000 mAh", "cells": 6, "voltage_nominal_v": 22.2, "capacity_mah": 4000, "mass_g": 508.0, "c_rating": 30, "cell_ir_mohm": 7.0 },
    { "id": "6s_5000", "label": "6S LiPo — 5000 mAh", "cells": 6, "voltage_nominal_v": 22.2, "capacity_mah": 5000, "mass_g": 620.0, "c_rating": 30, "cell_ir_mohm": 6.0 },
    { "id": "6s_8000", "label": "6S LiPo — 8000 mAh", "cells": 6, "voltage_nominal_v": 22.2, "capacity_mah": 8000, "mass_g": 920.0, "c_rating": 25, "cell_ir_mohm": 5.5 },
    { "id": "8s_16000", "label": "8S LiPo — 16000 mAh", "cells": 8, "voltage_nominal_v": 29.6, "capacity_mah": 16000, "mass_g": 1850.0, "c_rating": 20, "cell_ir_mohm": 5.0 }
  ],

  "escs": [
    { "id": "esc_20a", "label": "20A BLHeli_S (x4)", "current_a": 20, "burst_current_a": 25, "rds_on_ohm": 0.0035, "mass_g_each": 8.1, "quantity": 4, "firmware": "BLHeli_S", "mosfet_count": 6, "r_th_c_per_w": 22, "board_mm": [25, 13, 4], "supported_protocols": ["pwm_50", "pwm_400", "pwm_500", "oneshot125", "dshot300"] },
    { "id": "esc_30a", "label": "30A BLHeli_32 (x4)", "current_a": 30, "burst_current_a": 40, "rds_on_ohm": 0.0030, "mass_g_each": 9.5, "quantity": 4, "firmware": "BLHeli_32", "mosfet_count": 6, "r_th_c_per_w": 18, "board_mm": [27, 14, 4], "supported_protocols": ["pwm_50", "pwm_400", "pwm_500", "oneshot125", "dshot300", "dshot600"] },
    { "id": "esc_40a", "label": "40A BLHeli_32 (x4)", "current_a": 40, "burst_current_a": 55, "rds_on_ohm": 0.0022, "mass_g_each": 11.2, "quantity": 4, "firmware": "BLHeli_32", "mosfet_count": 6, "r_th_c_per_w": 15, "board_mm": [30, 15, 5], "supported_protocols": ["pwm_50", "pwm_400", "pwm_500", "oneshot125", "dshot300", "dshot600"] },
    { "id": "esc_4in1_45a", "label": "4-in-1 45A Stack", "current_a": 45, "burst_current_a": 60, "rds_on_ohm": 0.0020, "mass_g_each": 22.4, "quantity": 1, "firmware": "BLHeli_32", "mosfet_count": 24, "r_th_c_per_w": 12, "board_mm": [46, 46, 6], "supported_protocols": ["pwm_400", "pwm_500", "oneshot125", "dshot300", "dshot600"] },
    { "id": "esc_4in1_60a", "label": "4-in-1 60A Stack", "current_a": 60, "burst_current_a": 80, "rds_on_ohm": 0.0016, "mass_g_each": 25.5, "quantity": 1, "firmware": "BLHeli_32", "mosfet_count": 24, "r_th_c_per_w": 10, "board_mm": [50, 50, 7], "supported_protocols": ["pwm_400", "pwm_500", "oneshot125", "dshot300", "dshot600"] }
  ],

  "flight_controllers": [
    { "id": "fc_f4", "label": "Betaflight F4 Stack", "processor": "STM32F405", "mass_g": 6.2 },
    { "id": "fc_f7", "label": "Betaflight F7 Stack", "processor": "STM32F722", "mass_g": 7.5 },
    { "id": "fc_pixhawk4_mini", "label": "Pixhawk 4 Mini", "processor": "STM32F765", "mass_g": 37.2 },
    { "id": "fc_pixhawk6c", "label": "Pixhawk 6C Standard", "processor": "STM32H743", "mass_g": 48.0 },
    { "id": "fc_pixracer", "label": "Pixracer R15", "processor": "STM32F427", "mass_g": 10.5 },
    { "id": "fc_cube_orange", "label": "Cube Orange Standard", "processor": "STM32H753", "mass_g": 73.0 }
  ],

  "receivers": [
    { "id": "rx_elrs_ep1", "label": "ExpressLRS RX (2.4G)", "protocol": "ELRS", "mass_g": 3.5 },
    { "id": "rx_elrs_ep2", "label": "ExpressLRS RX (915M)", "protocol": "ELRS", "mass_g": 4.2 },
    { "id": "rx_tbs_crossfire", "label": "TBS Crossfire Nano", "protocol": "CRSF", "mass_g": 7.6 },
    { "id": "rx_frsky_rxsr", "label": "FrSky R-XSR SBUS", "protocol": "SBUS", "mass_g": 1.5 },
    { "id": "rx_flysky_ia6b", "label": "Flysky iA6B iBUS", "protocol": "iBUS", "mass_g": 14.9 },
    { "id": "rx_spektrum_spm4650", "label": "Spektrum SRXL2", "protocol": "SRXL2", "mass_g": 1.4 },
    { "id": "rx_futaba_r3008sb", "label": "Futaba R3008SB S.Bus", "protocol": "S.BUS", "mass_g": 10.1 }
  ],

  "payloads": [
    { "id": "gimbal_2axis", "label": "2-Axis Brushless Gimbal", "mass_g": 178.0, "width_mm": 60, "height_mm": 50 },
    { "id": "gimbal_3axis", "label": "3-Axis Brushless Gimbal", "mass_g": 220.0, "width_mm": 65, "height_mm": 60 },
    { "id": "camera_gopro", "label": "GoPro Action Camera", "mass_g": 126.0, "width_mm": 55, "height_mm": 40 },
    { "id": "camera_fpv_nano", "label": "FPV Nano Camera", "mass_g": 8.5, "width_mm": 20, "height_mm": 20 },
    { "id": "gps_m8n", "label": "GPS Module (uBlox M8N)", "mass_g": 16.2, "width_mm": 35, "height_mm": 12 },
    { "id": "gps_m9n_compass", "label": "GPS Module (uBlox M9N)", "mass_g": 24.5, "width_mm": 40, "height_mm": 15 },
    { "id": "lidar_tfmini", "label": "Benewake TFmini Lidar", "mass_g": 4.7, "width_mm": 25, "height_mm": 15 },
    { "id": "lidar_garmin", "label": "Garmin LidarLite v3", "mass_g": 22.0, "width_mm": 45, "height_mm": 20 },
    { "id": "telemetry_915", "label": "Telemetry Radio (915MHz)", "mass_g": 18.3, "width_mm": 30, "height_mm": 10 },
    { "id": "fpv_vtx", "label": "FPV Video Transmitter", "mass_g": 12.0, "width_mm": 28, "height_mm": 8 }
  ],

  "materials": [
    { "id": "carbon_fibre", "label": "Carbon Fibre T700", "yield_strength_mpa": 600, "youngs_modulus_gpa": 70, "density_kg_m3": 1600, "poisson_ratio": 0.3, "shear_strength_mpa": 90, "description": "Quasi-isotropic T700 layup. E=70 GPa is a conservative layup value (unidirectional fibre direction reaches ~230 GPa). Weak in torsion without +/-45 plies." },
    { "id": "aluminium", "label": "Aluminium 6061-T6", "yield_strength_mpa": 270, "youngs_modulus_gpa": 69, "density_kg_m3": 2700, "poisson_ratio": 0.33, "shear_strength_mpa": 207, "description": "Lightweight robust metallic alloy; ductile, visible fatigue." },
    { "id": "nylon", "label": "Nylon (PA66)", "yield_strength_mpa": 50, "youngs_modulus_gpa": 3, "density_kg_m3": 1140, "poisson_ratio": 0.4, "shear_strength_mpa": 35, "description": "Flexible structural polymer." }
  ],

  "blade_materials": [
    { "id": "glass_nylon", "label": "Glass Nylon", "density_kg_m3": 1200, "color_hex": "#f1f5f9" },
    { "id": "carbon_nylon", "label": "Carbon Nylon", "density_kg_m3": 1350, "color_hex": "#374151" },
    { "id": "carbon_fibre", "label": "Carbon Fibre", "density_kg_m3": 1550, "color_hex": "#1c1c1e" }
  ],

  "naca_airfoils": [
    { "id": "naca_0012", "name": "NACA 0012", "description": "Symmetric, 12% thickness", "camber": 0, "thickness_percent": 12, "alpha_0_deg": 0, "cl_max": 1.2, "stall_angle_deg": 15, "color_hex": "#f59e0b", "reference": "NACA TR-824", "cd0": 0.0120, "cl_alpha_per_rad": 6.283, "ar_eff": 6.0, "oswald_e": 0.85 },
    { "id": "naca_2412", "name": "NACA 2412", "description": "2% camber, 12% thickness", "camber": 2, "thickness_percent": 12, "alpha_0_deg": -2.0, "cl_max": 1.4, "stall_angle_deg": 14, "color_hex": "#10b981", "reference": "NACA TR-824", "cd0": 0.0125, "cl_alpha_per_rad": 6.283, "ar_eff": 6.0, "oswald_e": 0.85 },
    { "id": "naca_4412", "name": "NACA 4412", "description": "4% camber, 12% thickness", "camber": 4, "thickness_percent": 12, "alpha_0_deg": -4.0, "cl_max": 1.6, "stall_angle_deg": 13, "color_hex": "#d99e00", "reference": "NACA TR-824", "cd0": 0.0130, "cl_alpha_per_rad": 6.283, "ar_eff": 6.0, "oswald_e": 0.85 }
  ],

  "drag_coefficients": {
    "x_frame": { "id": "x_frame_standard", "label": "Standard X-Frame", "cd": 1.05, "reference": "NASA TN-D-8236", "frontal_area_factor": 1.0 },
    "h_frame": { "id": "h_frame_standard", "label": "H-Frame Configuration", "cd": 1.12, "reference": "NASA TN-D-8236", "frontal_area_factor": 1.05 }
  },

  "imu_presets": [
    { "id": "mpu6000", "label": "MPU-6000 (hobby)", "grade": "hobby", "gyro_bias_dps": 0.6, "accel_noise_deg": 1.8, "sample_rate_hz": 400, "dt_s": 0.0025, "default": true },
    { "id": "icm20602", "label": "ICM-20602 (low-noise)", "grade": "midrange", "gyro_bias_dps": 0.4, "accel_noise_deg": 1.4, "sample_rate_hz": 1000, "dt_s": 0.001 },
    { "id": "bmi270", "label": "BMI270 (modern)", "grade": "midrange", "gyro_bias_dps": 0.3, "accel_noise_deg": 1.2, "sample_rate_hz": 800, "dt_s": 0.00125 },
    { "id": "adis16505", "label": "ADIS16505 (precision)", "grade": "precision", "gyro_bias_dps": 0.05, "accel_noise_deg": 0.4, "sample_rate_hz": 2000, "dt_s": 0.0005 }
  ]
};
  if (typeof module === "object" && module.exports) module.exports = CATALOG;
  root.VLAB_CATALOG = CATALOG;
}(typeof self !== "undefined" ? self : (typeof globalThis !== "undefined" ? globalThis : this)));

/* ===== SHARED PRELUDE 3/7: vlab-store.js ===== */
/* ============================================================================
 * Drone Technology Virtual Lab — Unified Build Store (single source of truth)
 *
 * One localStorage object — 'vlab:build:v1' — is the digital twin of the drone.
 * Each experiment writes ONLY its own expN slice (+ component/env selections);
 * finalizing one experiment NEVER overwrites another's data. Downstream slices
 * carry an upstreamHash; when an upstream value changes, the downstream slice is
 * flagged `stale` (NOT deleted) so the user is prompted to redo or change.
 *
 * Vendored identical into each experiment's simulation/js/ folder.
 * ==========================================================================*/
(function (root, factory) {
  const C = root.VLAB_CONST || ((typeof require === 'function') ? require('./constants.js') : null);
  const api = factory(C);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.VLABStore = api;
}(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (C) {
  'use strict';

  const KEY = 'vlab:build:v1';
  const hash = (C && C.hashString) ? C.hashString : function (s) {       // fallback hasher
    let h = 2166136261 >>> 0; s = String(s);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  };

  // Dependency graph: which upstream values each experiment consumes.
  // Used to compute the upstreamHash and detect staleness.
  const DEPS = {
    exp1: { components: ['frameId', 'motorId', 'propId', 'batteryId', 'escId', 'propBlades'], env: ['altitude_m'], slices: [] },
    exp2: { components: ['frameId', 'motorId', 'propId', 'batteryId', 'payloadIds'], env: [], slices: { exp1: ['T_max_per_motor_N'] } },
    exp3: { components: ['frameId', 'propId', 'propBlades'], env: ['altitude_m'], slices: { exp1: ['kv_actual', 'propDefHash'] } },
    exp4: { components: ['motorId', 'escId'], env: [], slices: { exp1: ['fullCurrent_A', 'hoverCurrent_A'] } },
    exp5: { components: [], env: [], slices: { exp2: ['total_mass_g', 'arm_length_mm', 'cg_offset_mm'], exp4: ['pwm_deadband_us', 'calibrated'] } },
    exp6: { components: ['motorId', 'propId', 'propBlades'], env: ['altitude_m'], slices: { exp1: ['T_max_per_motor_N', 'fullCurrent_A'], exp2: ['total_mass_g'] } }
  };

  function emptyBuild() {
    return {
      schemaVersion: 1,
      components: {
        frameId: null, motorId: null, propId: null, batteryId: null,
        escId: null, fcId: null, rxId: null, payloadIds: [],
        propBlades: 2
      },
      env: { altitude_m: 0 },
      exp1: null, exp2: null, exp3: null, exp4: null, exp5: null, exp6: null,
      meta: { createdAt: Date.now(), lastModified: Date.now() }
    };
  }

  function safeParse(raw) { try { return JSON.parse(raw); } catch (e) { return null; } }

  // ── load / save ───────────────────────────────────────────────────────────
  function load() {
    if (typeof localStorage === 'undefined') return emptyBuild();
    let b = safeParse(localStorage.getItem(KEY));
    if (!b || b.schemaVersion !== 1) {
      b = emptyBuild();
      migrateLegacy(b);                 // pull any pre-existing per-experiment keys
      save(b);
    }
    return b;
  }
  function save(b) {
    if (!b) return;
    b.meta = b.meta || {};
    b.meta.lastModified = Date.now();
    if (typeof localStorage !== 'undefined') {
      try { localStorage.setItem(KEY, JSON.stringify(b)); } catch (e) { /* quota */ }
    }
    return b;
  }

  // ── fingerprint of the upstream inputs an experiment depends on ────────────
  function upstreamFingerprint(b, expId) {
    const dep = DEPS[expId]; if (!dep) return 0;
    const parts = [];
    (dep.components || []).forEach((k) => parts.push(k + '=' + JSON.stringify(b.components[k])));
    (dep.env || []).forEach((k) => parts.push('env.' + k + '=' + JSON.stringify(b.env[k])));
    const sl = dep.slices || {};
    Object.keys(sl).forEach((up) => {
      const slice = b[up] || {};
      sl[up].forEach((f) => parts.push(up + '.' + f + '=' + JSON.stringify(slice[f])));
    });
    return hash(parts.join('|'));
  }

  // ── public API ─────────────────────────────────────────────────────────────
  const API = {
    KEY: KEY,
    DEPS: DEPS,
    get: load,
    save: save,

    /** Merge component selections (frame/motor/...); marks affected downstream stale. */
    setComponents: function (patch) {
      const b = load();
      Object.assign(b.components, patch || {});
      refreshStale(b);
      return save(b);
    },

    setEnv: function (patch) {
      const b = load();
      Object.assign(b.env, patch || {});
      refreshStale(b);
      return save(b);
    },

    /** Finalize an experiment: store its outputs + the upstream fingerprint it was built against. */
    finalize: function (expId, outputs) {
      const b = load();
      b[expId] = Object.assign({}, outputs, {
        status: 'finalized',
        finalizedAt: Date.now(),
        upstreamHash: upstreamFingerprint(b, expId),
        stale: false
      });
      refreshStale(b);
      return save(b);
    },

    /** Read the finalized outputs of an upstream experiment (or null). */
    upstream: function (expId) { const b = load(); return b[expId] || null; },

    /** True if an experiment's stored result no longer matches current upstream. */
    isStale: function (expId) {
      const b = load(); const slice = b[expId];
      if (!slice || slice.status !== 'finalized') return false;
      return slice.upstreamHash !== upstreamFingerprint(b, expId);
    },

    /** List every finalized-but-now-stale experiment (for the redo banner). */
    staleExperiments: function () {
      const b = load();
      return Object.keys(DEPS).filter((id) => {
        const s = b[id];
        return s && s.status === 'finalized' && s.upstreamHash !== upstreamFingerprint(b, id);
      });
    },

    /** Is the experiment finalized at all (regardless of staleness)? */
    isFinalized: function (expId) { const s = load()[expId]; return !!(s && s.status === 'finalized'); },

    // ── strict guided-build dependency chain ──────────────────────────────
    /** Direct upstream experiments this one strictly depends on (from DEPS). */
    prerequisites: function (expId) {
      const dep = DEPS[expId];
      if (!dep || !dep.slices || Array.isArray(dep.slices)) return [];
      return Object.keys(dep.slices);
    },

    /** Prerequisite experiments that are not yet finalized. */
    missingPrerequisites: function (expId) {
      const b = load();
      return API.prerequisites(expId).filter((id) => !(b[id] && b[id].status === 'finalized'));
    },

    /** Prerequisites that are finalized but now stale (upstream changed since). */
    stalePrerequisites: function (expId) {
      const b = load();
      return API.prerequisites(expId).filter((id) => {
        const s = b[id];
        return s && s.status === 'finalized' && s.upstreamHash !== upstreamFingerprint(b, id);
      });
    },

    /** Strict readiness: EVERY prerequisite must be finalized AND not stale. */
    readyFor: function (expId) {
      const missing = API.missingPrerequisites(expId);
      const stale = API.stalePrerequisites(expId);
      return { ready: missing.length === 0 && stale.length === 0, missing: missing, stale: stale };
    },

    /** The whole drone build so far — the digital twin for the final view. */
    buildSummary: function () {
      const b = load();
      const ids = Object.keys(DEPS);
      const done = ids.filter((id) => b[id] && b[id].status === 'finalized');
      return {
        components: Object.assign({}, b.components),
        env: Object.assign({}, b.env),
        experiments: { exp1: b.exp1, exp2: b.exp2, exp3: b.exp3, exp4: b.exp4, exp5: b.exp5, exp6: b.exp6 },
        finalized: done,
        stale: API.staleExperiments(),
        complete: done.length === ids.length
      };
    },

    reset: function () { return save(emptyBuild()); }
  };

  // Recompute and persist the `stale` flag on every finalized slice.
  function refreshStale(b) {
    Object.keys(DEPS).forEach((id) => {
      const s = b[id];
      if (s && s.status === 'finalized') s.stale = (s.upstreamHash !== upstreamFingerprint(b, id));
    });
  }

  // ── one-time migration of the legacy fragmented keys ───────────────────────
  function migrateLegacy(b) {
    if (typeof localStorage === 'undefined') return;
    const m1 = safeParse(localStorage.getItem('vlabModule1'));
    if (m1) {
      if (m1.fId) b.components.frameId = m1.fId;
      if (m1.mId) b.components.motorId = m1.mId;
      if (m1.pId) b.components.propId = m1.pId;
      if (m1.bId) b.components.batteryId = m1.bId;
      if (m1.eId) b.components.escId = m1.eId;
      if (m1.fcId) b.components.fcId = m1.fcId;
      if (m1.rId) b.components.rxId = m1.rId;
      if (Array.isArray(m1.pldIds)) b.components.payloadIds = m1.pldIds;
      if (typeof m1.alt === 'number') b.env.altitude_m = m1.alt;
      if (typeof m1.T_req === 'number') {
        b.exp1 = { status: 'finalized', finalizedAt: Date.now(), T_hover_per_motor_N: m1.T_req, stale: false, upstreamHash: 0, _migrated: true };
      }
    }
    const m2 = safeParse(localStorage.getItem('vlabModule2_final'));
    if (m2) {
      b.exp2 = {
        status: 'finalized', finalizedAt: Date.now(), _migrated: true, stale: false, upstreamHash: 0,
        total_mass_g: m2.mass_g, arm_length_mm: m2.arm_length_mm, arm_material: m2.arm_material,
        yield_mpa: m2.yield_strength_mpa, cg_offset_mm: m2.cg_offset_mm
      };
    }
    const e5 = safeParse(localStorage.getItem('vlabExp5_session'));
    if (e5) {
      b.exp5 = {
        status: 'finalized', finalizedAt: Date.now(), _migrated: true, stale: false, upstreamHash: 0,
        Kp: e5.Kp, Ki: e5.Ki, Kd: e5.Kd, alpha: e5.alpha
      };
    }
    const e6 = safeParse(localStorage.getItem('vlabExp6_session'));
    if (e6) { b.exp6 = { status: 'finalized', finalizedAt: Date.now(), _migrated: true, stale: false, upstreamHash: 0 }; }
    // After migrating, recompute fingerprints so freshly imported slices aren't falsely stale.
    Object.keys(DEPS).forEach((id) => { if (b[id]) b[id].upstreamHash = upstreamFingerprint(b, id); });
  }

  API._upstreamFingerprint = upstreamFingerprint;   // exposed for tests
  API._emptyBuild = emptyBuild;
  return API;
}));

/* ===== SHARED PRELUDE 4/7: validation.js ===== */
/* ============================================================================
 * Drone Technology Virtual Lab — Cross-Experiment Validation / Redo Engine
 *
 * Evaluates the §9 constraint graph against the unified build. Each constraint
 * that can't be satisfied returns BOTH resolution paths the user asked for:
 *   (a) redo an upstream experiment, or (b) change the current selection.
 * Constraints degrade to `pending` (not `violation`) when an upstream value
 * hasn't been finalized yet, so the user is guided rather than blocked.
 *
 * Also surfaces staleness from the store (downstream results invalidated by an
 * upstream change — flagged, never deleted).
 *
 * Vendored identical into each experiment's simulation/js/ folder.
 * ==========================================================================*/
(function (root, factory) {
  const C = root.VLAB_CONST || ((typeof require === 'function') ? require('./constants.js') : null);
  const S = root.VLABStore || ((typeof require === 'function') ? require('./vlab-store.js') : null);
  const api = factory(C, S);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.VLABValidate = api;
}(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (C, Store) {
  'use strict';

  const L = C.LIMITS, REAL = C.REAL, PHYS = C.PHYS;
  const byId = (list, id) => (list || []).find((x) => x && x.id === id) || null;

  // Helper builders for the two resolution paths the UI renders as buttons.
  const redo = (exp, label) => ({ kind: 'redo', exp: exp, label: label });
  const change = (field, label) => ({ kind: 'change', field: field, label: label });

  /**
   * @param {object} catalog  the shared catalog.json
   * @param {object} [build]  optional build override (defaults to Store.get())
   * @returns {{ok:boolean, violations:Array, pending:Array, stale:Array}}
   */
  function check(catalog, build) {
    const b = build || Store.get();
    const c = b.components;
    const violations = [], pending = [];

    const frame = byId(catalog.frames, c.frameId);
    const motor = byId(catalog.motors, c.motorId);
    const prop = byId(catalog.propellers, c.propId);
    const battery = byId(catalog.batteries, c.batteryId);
    const esc = byId(catalog.escs, c.escId);
    const exp1 = b.exp1, exp2 = b.exp2;

    // ── C1: prop diameter must fit the frame's recommended range ──────────────
    if (frame && prop && Array.isArray(frame.recommended_prop_in)) {
      const [lo, hi] = frame.recommended_prop_in;
      if (prop.diameter_in < lo || prop.diameter_in > hi) {
        violations.push({
          id: 'prop_fits_frame', severity: 'error',
          title: 'Propeller does not fit the frame',
          detail: 'The ' + prop.diameter_in + '" propeller is outside the ' + frame.label +
                  ' recommended range (' + lo + '-' + hi + '").',
          options: [redo('exp2', 'Redo Frame (Exp 2) with a larger/smaller frame'),
                    change('propId', 'Pick a propeller in the ' + lo + '-' + hi + '" range')]
        });
      }
    }

    // ── C3: ESC continuous current must cover the motor full-throttle current ─
    if (esc) {
      if (exp1 && typeof exp1.fullCurrent_A === 'number') {
        if (esc.current_a < exp1.fullCurrent_A) {
          violations.push({
            id: 'esc_current', severity: 'error',
            title: 'ESC undersized for the motor',
            detail: 'Motor pulls ' + exp1.fullCurrent_A.toFixed(1) + ' A at full throttle but the ' +
                    esc.label + ' is rated ' + esc.current_a + ' A continuous.',
            options: [redo('exp1', 'Redo Propulsion (Exp 1) with a lower-current motor'),
                      change('escId', 'Pick an ESC rated > ' + Math.ceil(exp1.fullCurrent_A) + ' A')]
          });
        }
      } else if (motor && esc.current_a < motor.max_current_a) {
        violations.push({
          id: 'esc_current_nominal', severity: 'warn',
          title: 'ESC may be undersized',
          detail: 'Motor max current is ' + motor.max_current_a + ' A; ESC is rated ' + esc.current_a + ' A. Finalize Exp 1 to confirm the real draw.',
          options: [change('escId', 'Pick an ESC rated > ' + motor.max_current_a + ' A')]
        });
      }
    }

    // ── C4: battery current capability vs motor draw ─────────────────────────
    // Real LiPo packs have a burst (label) C-rating and a much lower SUSTAINED
    // capability (~0.5-0.6x label, per Mooch/uavmodel testing). We error only when
    // even the label rating can't cover full-throttle draw (genuinely undersized),
    // and warn when the realistic de-rated capacity is marginal at sustained WOT.
    if (battery && exp1 && typeof exp1.fullCurrent_A === 'number') {
      const capAh = battery.capacity_mah / 1000;
      const iMaxLabel = (battery.c_rating || 0) * capAh;
      const iMaxEff = iMaxLabel * REAL.c_rating_effective_frac;
      const draw = 4 * exp1.fullCurrent_A;
      if (iMaxLabel < draw) {
        violations.push({
          id: 'battery_c', severity: 'error',
          title: 'Battery cannot supply the current',
          detail: '4 motors draw ' + draw.toFixed(0) + ' A at full throttle; the ' + battery.label +
                  ' is only rated ' + iMaxLabel.toFixed(0) + ' A (label C-rating).',
          options: [redo('exp1', 'Redo Propulsion (Exp 1) with lower-current motors'),
                    change('batteryId', 'Pick a higher-C / higher-capacity pack')]
        });
      } else if (iMaxEff < draw) {
        violations.push({
          id: 'battery_c_marginal', severity: 'warn',
          title: 'Battery marginal at sustained full throttle',
          detail: 'Full-throttle draw ' + draw.toFixed(0) + ' A exceeds the realistic sustained capability ~' +
                  iMaxEff.toFixed(0) + ' A (label C-rating is a burst figure). Expect heavy voltage sag.',
          options: [change('batteryId', 'Pick a higher-C / higher-capacity pack for sustained WOT')]
        });
      }

      // ── C5: loaded voltage must stay above the per-cell floor at hover ──────
      if (typeof exp1.hoverCurrent_A === 'number') {
        const rInt = (battery.cell_ir_mohm / 1000) * battery.cells;
        const vLoaded = battery.voltage_nominal_v - 4 * exp1.hoverCurrent_A * rInt;
        const vMin = L.cell_vmin_v * battery.cells;
        if (vLoaded < vMin) {
          violations.push({
            id: 'voltage_sag', severity: 'error',
            title: 'Battery sags below the safe floor at hover',
            detail: 'Loaded voltage ' + vLoaded.toFixed(1) + ' V is below the ' + vMin.toFixed(1) +
                    ' V (' + L.cell_vmin_v + ' V/cell) limit.',
            options: [change('batteryId', 'Pick a pack with lower internal resistance / more capacity'),
                      redo('exp1', 'Redo Propulsion (Exp 1) to lower the hover current')]
          });
        }
      }
    }

    // ── C2: thrust-to-weight ratio must clear the safe floor ──────────────────
    if (exp1 && typeof exp1.T_max_per_motor_N === 'number') {
      // total mass: prefer the finalized Exp 2 build, else estimate from catalog parts
      let massG = (exp2 && typeof exp2.total_mass_g === 'number') ? exp2.total_mass_g : estimateMassG(catalog, c);
      if (massG > 0) {
        const twr = (4 * exp1.T_max_per_motor_N) / (massG / 1000 * PHYS.g);
        if (twr < L.twr_min_safe) {
          violations.push({
            id: 'twr_floor', severity: twr < L.twr_min_fly ? 'error' : 'warn',
            title: twr < L.twr_min_fly ? 'Cannot lift off (TWR < 1)' : 'Underpowered (TWR < 1.5)',
            detail: 'Thrust-to-weight ratio is ' + twr.toFixed(2) + ' (need >= ' + L.twr_min_safe + ' for controllable flight).',
            options: [redo('exp1', 'Redo Propulsion (Exp 1) for more thrust'),
                      redo('exp2', 'Redo Frame (Exp 2) to shed mass / payload')]
          });
        }
      }
    } else {
      pending.push({ id: 'twr_floor', detail: 'Finalize Propulsion (Exp 1) to evaluate thrust-to-weight.' });
    }

    const stale = Store.staleExperiments();

    return { ok: violations.length === 0, violations: violations, pending: pending, stale: stale };
  }

  // Rough empty-mass estimate from catalog parts when Exp 2 isn't finalized yet.
  function estimateMassG(catalog, c) {
    let m = 0;
    const add = (list, id, qty) => { const x = byId(list, id); if (x) m += (x.mass_g || x.mass_g_each || 0) * (qty || 1); };
    add(catalog.frames, c.frameId, 1);
    add(catalog.motors, c.motorId, 4);
    add(catalog.propellers, c.propId, 4);
    add(catalog.batteries, c.batteryId, 1);
    const esc = byId(catalog.escs, c.escId); if (esc) m += (esc.mass_g_each || 0) * (esc.quantity || 1);
    (c.payloadIds || []).forEach((pid) => add(catalog.payloads, pid, 1));
    return m;
  }

  return { check: check, estimateMassG: estimateMassG };
}));

/* ===== SHARED PRELUDE 5/7: vlab-ui.js ===== */
/* ============================================================================
 * Drone Technology Virtual Lab — Shared UI Kit (header + cross-experiment banner)
 *
 * Renders the experiment header (which every experiment currently hides) and the
 * live validation / redo banner that turns VLABValidate violations + VLABStore
 * staleness into actionable "Redo Exp N" / "Change selection" buttons.
 *
 * window.VLABUi. Vendored into each experiment's simulation/js/vendor/.
 * ==========================================================================*/
(function (root, factory) {
  const Store = root.VLABStore || ((typeof require === 'function') ? require('../vlab-store.js') : null);
  const Validate = root.VLABValidate || ((typeof require === 'function') ? require('../validation.js') : null);
  const api = factory(Store, Validate);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.VLABUi = api;
}(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (Store, Validate) {
  'use strict';

  // Canonical experiment metadata (id -> label + sibling path for "redo" links).
  const EXP = {
    exp1: { n: 1, slug: 'exp-propulsion-system-design-dei', title: 'Propulsion System Design' },
    exp2: { n: 2, slug: 'exp-frame-structural-integrity-dei', title: 'Frame Structural Integrity' },
    exp3: { n: 3, slug: 'exp-aerodynamic-analysis-dei', title: 'Aerodynamic Analysis' },
    exp4: { n: 4, slug: 'exp-power-electronics-esc-dei', title: 'Power Electronics (ESC)' },
    exp5: { n: 5, slug: 'exp-flight-control-system-dei', title: 'Flight Control System' },
    exp6: { n: 6, slug: 'exp-flight-performance-dei', title: 'Flight Performance' }
  };

  const ICON = {
    error: '<svg class="vl-alert__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="16.5" x2="12" y2="16.5"/></svg>',
    warn: '<svg class="vl-alert__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l9 16H3z"/><line x1="12" y1="9" x2="12" y2="14"/><line x1="12" y1="17" x2="12" y2="17"/></svg>',
    stale: '<svg class="vl-alert__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 3 21 9 15 9"/></svg>'
  };

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const elFrom = (target) => (typeof target === 'string' ? document.getElementById(target) : target);

  // Self-contained scoped styles so the gate/banner/summary render correctly in
  // every experiment WITHOUT pulling in the full tokens.css theme (which could
  // disturb each experiment's own approved layout). Injected once.
  function injectStylesOnce() {
    if (typeof document === 'undefined' || document.getElementById('vlab-ui-inline')) return;
    const css =
      '.vl-banner:empty{display:none}' +
      '.vl-alert{display:flex;gap:10px;align-items:flex-start;border-radius:10px;padding:11px 13px;margin:8px 0;font-family:Inter,system-ui,sans-serif;font-size:13px;line-height:1.4;border:1px solid}' +
      '.vl-alert__icon{width:20px;height:20px;flex:0 0 20px;margin-top:1px}' +
      '.vl-alert__title{font-weight:700;margin-bottom:2px}' +
      '.vl-alert__detail{opacity:.9}' +
      '.vl-alert__actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:9px}' +
      '.vl-alert--error{background:#fef2f2;border-color:#fecaca;color:#991b1b}' +
      '.vl-alert--warn{background:#fffbeb;border-color:#fde68a;color:#92400e}' +
      '.vl-alert--stale{background:#eff6ff;border-color:#bfdbfe;color:#1e40af}' +
      '.vl-btn{display:inline-block;font:600 12px Inter,system-ui,sans-serif;padding:6px 11px;border-radius:7px;border:1px solid currentColor;background:rgba(255,255,255,.6);color:inherit;cursor:pointer;text-decoration:none;white-space:nowrap}' +
      '.vl-btn:hover{background:#fff}' +
      '.vl-btn--redo{background:#f5a300;border-color:#f5a300;color:#1a1400}' +
      '.vl-btn--redo:hover{background:#e59600}' +
      '.vl-sum{font-family:Inter,system-ui,sans-serif;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;background:#fff}' +
      '.vl-sum__head{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:11px 14px;background:#0f172a;color:#fff;font-size:13px}' +
      '.vl-sum__head span{opacity:.75;font-size:12px}' +
      '.vl-sum__grid{display:grid;grid-template-columns:1fr 1fr;gap:0}' +
      '.vl-sum__col{padding:10px 14px}' +
      '.vl-sum__col:first-child{border-right:1px solid #eef1f5}' +
      '.vl-sum__col h5{margin:2px 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#64748b}' +
      '.vl-sum__row{display:flex;justify-content:space-between;gap:10px;font-size:12.5px;padding:3px 0;border-bottom:1px dashed #f1f5f9}' +
      '.vl-sum__k{color:#475569}.vl-sum__v{font-weight:600;font-family:"JetBrains Mono",monospace;color:#0f172a;text-align:right}' +
      '.vl-sum__status{padding:9px 14px;font-size:12.5px;font-weight:600}' +
      '.vl-sum__status.is-ok{background:#ecfdf5;color:#065f46}.vl-sum__status.is-warn{background:#fffbeb;color:#92400e}.vl-sum__status.is-error{background:#fef2f2;color:#991b1b}' +
      '@media(max-width:640px){.vl-sum__grid{grid-template-columns:1fr}.vl-sum__col:first-child{border-right:0;border-bottom:1px solid #eef1f5}}' +
      '@keyframes vlFieldFlash{0%,100%{box-shadow:none}30%,70%{box-shadow:0 0 0 3px rgba(217,119,6,.55)}}' +
      '.vl-field-flash{animation:vlFieldFlash 1.3s ease-in-out 2}';
    const st = document.createElement('style');
    st.id = 'vlab-ui-inline';
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  // Default "redo" navigation: hop to a sibling experiment folder. Overridable.
  function defaultRedoUrl(expId) {
    // Cross-experiment navigation buttons are intentionally disabled: each
    // experiment page must stand alone (banner text still names the
    // prerequisite, the user opens it separately).
    return null;
  }

  // ── Same-page "change" targeting ────────────────────────────────────────
  // A conflict banner's "change" button must DO something, not just exist.
  // Every experiment builds its component pickers from the same shared
  // conventions (a #group_<cat> / #<cat>Tiles container, or a #<cat>Select
  // element, or a heading that names the part), so this resolves the field
  // generically instead of requiring per-experiment wiring. Returns the
  // element to scroll to + flash, or null if this field isn't editable on
  // the CURRENT page (e.g. it's inherited read-only here).
  const FIELD_HINTS = {
    frameId: { cat: 'frame', keyword: 'frame' },
    motorId: { cat: 'motor', keyword: 'motor' },
    propId: { cat: 'propeller', keyword: 'propeller' },
    batteryId: { cat: 'battery', keyword: 'battery' },
    escId: { cat: 'esc', keyword: 'esc' }
  };
  function resolveFieldTarget(field) {
    const hint = FIELD_HINTS[field];
    if (!hint || typeof document === 'undefined') return null;
    let el = document.getElementById('group_' + hint.cat) ||
      document.getElementById(hint.cat + 'Tiles') ||
      document.getElementById(hint.cat + 'Select');
    if (el && el.tagName === 'SELECT') el = el.closest('.config-group') || el.closest('.panel-section') || el.parentElement;
    if (!el) {
      const heads = document.querySelectorAll('.config-group-title, .panel-title, .field-label');
      for (let i = 0; i < heads.length; i++) {
        if (heads[i].textContent.toLowerCase().indexOf(hint.keyword) >= 0) {
          el = heads[i].closest('.config-group') || heads[i].parentElement || heads[i];
          break;
        }
      }
    }
    return el;
  }
  // Scrolls to + flashes the real picker for `field` on THIS page. If none
  // exists here (the field is only editable on another experiment's page),
  // flashes the alert box itself instead — the instruction text already
  // names the fix, so the button still does something visible rather than
  // silently failing.
  function focusChangeField(field, btn) {
    const target = resolveFieldTarget(field);
    const flashEl = target || (btn && btn.closest ? btn.closest('.vl-alert') : null);
    if (!flashEl) return false;
    try { flashEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
    flashEl.classList.add('vl-field-flash');
    setTimeout(() => flashEl.classList.remove('vl-field-flash'), 1500);
    return !!target;
  }

  function renderHeader(target, opts) {
    const el = elFrom(target); if (!el) return;
    opts = opts || {};
    el.classList.add('vl-header');
    el.innerHTML =
      (opts.badge ? '<span class="vl-header__badge">' + esc(opts.badge) + '</span>' : '') +
      '<div><div class="vl-header__title">' + esc(opts.title || '') + '</div>' +
      (opts.sub ? '<div class="vl-header__sub">' + esc(opts.sub) + '</div>' : '') + '</div>' +
      '<span class="vl-header__spacer"></span>' +
      '<span class="vl-buildchip" id="vlBuildChip"><span class="vl-buildchip__dot"></span><span id="vlBuildChipText">build</span></span>';
  }

  function updateBuildChip(catalog) {
    const chip = document.getElementById('vlBuildChip');
    const txt = document.getElementById('vlBuildChipText');
    if (!chip || !txt || !Store) return;
    const b = Store.get();
    const motor = (catalog.motors || []).find((m) => m.id === b.components.motorId);
    const frame = (catalog.frames || []).find((f) => f.id === b.components.frameId);
    const stale = Store.staleExperiments ? Store.staleExperiments() : [];
    let res = { violations: [] };
    try { res = Validate ? Validate.check(catalog, b) : res; } catch (e) { /* noop */ }
    const hasError = res.violations.some((v) => v.severity === 'error');
    chip.classList.toggle('vl-buildchip--error', hasError);
    chip.classList.toggle('vl-buildchip--stale', !hasError && stale.length > 0);
    const parts = [];
    if (frame) parts.push(frame.label.split(' — ')[1] || frame.label);
    if (motor) parts.push(motor.label);
    txt.textContent = parts.length ? parts.join(' · ') : 'no build yet';
  }

  /**
   * Mount the validation/redo banner.
   * @param target  element or id of an empty container
   * @param opts    { catalog, currentExp, onChange(field), redoUrl(expId)? }
   * @returns { refresh } so the experiment can re-render after a selection change.
   */
  function mountBanner(target, opts) {
    const el = elFrom(target); if (!el) return { refresh: function () {} };
    opts = opts || {};
    el.classList.add('vl-banner');
    injectStylesOnce();
    const redoUrl = opts.redoUrl || defaultRedoUrl;

    function alertHtml(kind, title, detail, actions) {
      return '<div class="vl-alert vl-alert--' + kind + '">' + (ICON[kind] || '') +
        '<div class="vl-alert__body"><div class="vl-alert__title">' + esc(title) + '</div>' +
        '<div class="vl-alert__detail">' + esc(detail) + '</div>' +
        (actions ? '<div class="vl-alert__actions">' + actions + '</div>' : '') + '</div></div>';
    }

    function refresh() {
      if (!Validate || !Store) { el.innerHTML = ''; return { violations: [], stale: [] }; }
      const b = Store.get();
      let res; try { res = Validate.check(opts.catalog, b); } catch (e) { el.innerHTML = ''; return { violations: [], stale: [] }; }
      const html = [];

      // Staleness first: a downstream experiment the user already finished is now
      // invalidated by a change here (data kept, just needs review).
      (res.stale || []).filter((id) => id !== opts.currentExp).forEach((id) => {
        const e = EXP[id]; if (!e) return;
        const url = redoUrl(id);
        html.push(alertHtml('stale', 'Experiment ' + e.n + ' (' + e.title + ') needs review',
          'A change here invalidated your finalized ' + e.title + ' result. Your data is kept — re-open it to re-validate.',
          url ? '<a class="vl-btn vl-btn--redo" href="' + esc(url) + '">Open Experiment ' + e.n + ' &rarr;</a>' : ''));
      });

      // Validation violations: change-options act on THIS page; redo-options only
      // ever named ANOTHER experiment to revisit. Fold those into the detail as
      // plain section names — but ONLY for an experiment the student has actually
      // CONDUCTED (finalized), never a not-yet-done future one, and never self.
      const sectionName = function (expId) { const e = EXP[expId]; return e ? ('Experiment ' + e.n + ' (' + e.title + ')') : expId; };
      (res.violations || []).forEach((v) => {
        const kind = v.severity === 'error' ? 'error' : 'warn';
        const revisitSections = (v.options || [])
          .filter((o) => o.kind === 'redo' && o.exp !== opts.currentExp && Store.isFinalized && Store.isFinalized(o.exp))
          .map((o) => sectionName(o.exp));
        const detailFull = v.detail + (revisitSections.length ? ' Section to revisit: ' + revisitSections.join(', ') + '.' : '');
        const actions = (v.options || []).filter((o) => o.kind !== 'redo').map((o) =>
          '<button class="vl-btn" type="button" data-vl-change="' + esc(o.field || '') + '">' + esc(o.label) + '</button>'
        ).join('');
        html.push(alertHtml(kind, v.title, detailFull, actions));
      });

      el.innerHTML = html.join('');

      // wire "change" buttons: always scroll to + flash the real picker on
      // THIS page first (shared default so this works even when the caller
      // passes no onChange at all), then also run any caller-specific extra
      // behaviour on top.
      el.querySelectorAll('[data-vl-change]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const field = btn.getAttribute('data-vl-change');
          focusChangeField(field, btn);
          if (opts.onChange) opts.onChange(field);
        });
      });
      if (opts.onRedo) {
        el.querySelectorAll('[data-vl-redo]').forEach((btn) => {
          btn.addEventListener('click', () => opts.onRedo(btn.getAttribute('data-vl-redo')));
        });
      }
      updateBuildChip(opts.catalog);
      return res;
    }

    refresh();
    return { refresh: refresh };
  }

  /**
   * Mount the STRICT prerequisite gate for an experiment.
   * When the experiment's upstream prerequisites aren't finalized (or went
   * stale), it renders a "complete the previous step first" block with links to
   * the required experiment(s) and returns ready=false so the caller can also
   * disable its own proceed/finalize button. When ready, it clears itself.
   * @param target element or id of a container
   * @param opts   { expId, redoUrl(expId)?, onReady(), onBlocked({missing,stale}) }
   * @returns { ready, refresh }
   */
  function mountGate(target, opts) {
    const el = elFrom(target);
    opts = opts || {};
    const expId = opts.expId;
    const redoUrl = opts.redoUrl || defaultRedoUrl;
    if (!el || !Store || !expId || typeof Store.readyFor !== 'function') {
      return { ready: true, refresh: function () { return true; } };
    }
    el.classList.add('vl-banner');
    injectStylesOnce();

    function refresh() {
      const r = Store.readyFor(expId);
      if (r.ready) { el.innerHTML = ''; if (opts.onReady) opts.onReady(); return true; }
      const items = r.missing.map((id) => ({ id: id, stale: false }))
        .concat(r.stale.map((id) => ({ id: id, stale: true })));
      const links = items.map((it) => {
        const e = EXP[it.id]; if (!e) return '';
        const url = redoUrl(it.id);
        const label = (it.stale ? 'Re-validate' : 'Go to') + ' Experiment ' + e.n + ': ' + esc(e.title);
        return url ? '<a class="vl-btn vl-btn--redo" href="' + esc(url) + '">' + label + ' &rarr;</a>' : '';
      }).join('');
      const names = items.map((it) => EXP[it.id] ? ('Experiment ' + EXP[it.id].n + ' (' + EXP[it.id].title + ')') : it.id).join(', ');
      el.innerHTML =
        '<div class="vl-alert vl-alert--warn vl-gate">' + (ICON.warn || '') +
        '<div class="vl-alert__body"><div class="vl-alert__title">Complete the previous step first</div>' +
        '<div class="vl-alert__detail">This experiment strictly builds on your choices from ' + esc(names) +
        '. Finish and lock ' + (items.length > 1 ? 'those experiments' : 'that experiment') +
        ' so this one uses your real drone values, not placeholders.</div>' +
        '<div class="vl-alert__actions">' + links + '</div></div></div>';
      if (opts.onBlocked) opts.onBlocked(r);
      return false;
    }
    const ready = refresh();
    return { ready: ready, refresh: refresh };
  }

  /**
   * Human-readable summary of the inherited (upstream) build, so a downstream
   * experiment can show the locked selections it received. Returns an object of
   * { key: {label, value} } plus finalized upstream outputs.
   */
  function inheritedSummary(catalog) {
    if (!Store) return {};
    catalog = catalog || root.VLAB_CATALOG || {};
    const b = Store.get();
    const c = b.components;
    const nameOf = (coll, id) => { const x = (catalog[coll] || []).find((o) => o.id === id); return x ? (x.label || x.name || id) : id; };
    const out = { components: {}, env: {}, exp1: b.exp1 || null, exp2: b.exp2 || null };
    if (c.frameId) out.components.frame = nameOf('frames', c.frameId);
    if (c.motorId) out.components.motor = nameOf('motors', c.motorId);
    if (c.propId) out.components.propeller = nameOf('propellers', c.propId);
    if (c.propBlades) out.components.blades = c.propBlades + '-blade';
    if (c.batteryId) out.components.battery = nameOf('batteries', c.batteryId);
    if (c.escId) out.components.esc = nameOf('escs', c.escId);
    out.env.altitude_m = b.env.altitude_m;
    return out;
  }

  /**
   * Render the final "best drone" build summary — the digital twin of every
   * user choice + each experiment's key outputs + overall validation status.
   */
  function renderBuildSummary(target, catalog) {
    const el = elFrom(target); if (!el || !Store) return;
    injectStylesOnce();
    catalog = catalog || root.VLAB_CATALOG || {};
    const s = Store.buildSummary();
    const c = s.components;
    const nameOf = (coll, id) => { const x = (catalog[coll] || []).find((o) => o.id === id); return x ? (x.label || x.name || id) : (id || '—'); };
    let res = { violations: [] };
    try { res = Validate ? Validate.check(catalog, Store.get()) : res; } catch (e) { /* noop */ }
    const errs = res.violations.filter((v) => v.severity === 'error').length;
    const warns = res.violations.filter((v) => v.severity !== 'error').length;

    const comp = [
      ['Frame', nameOf('frames', c.frameId)], ['Motor (×4)', nameOf('motors', c.motorId)],
      ['Propeller (×4)', (c.propBlades ? c.propBlades + '-blade ' : '') + nameOf('propellers', c.propId)],
      ['Battery', nameOf('batteries', c.batteryId)], ['ESC', nameOf('escs', c.escId)]
    ];
    const num = (v, u, d) => (typeof v === 'number' ? v.toFixed(d == null ? 2 : d) + (u || '') : '—');
    const e = s.experiments;
    const outs = [
      ['Max thrust / motor', e.exp1 ? num(e.exp1.T_max_per_motor_N, ' N') : '—'],
      ['Hover throttle', e.exp1 ? num(e.exp1.hoverThrottle_pct, ' %', 1) : '—'],
      ['Total mass', e.exp2 ? num(e.exp2.total_mass_g, ' g', 0) : '—'],
      ['Safety factor (dyn)', e.exp2 ? num(e.exp2.SF_dynamic_min, '', 2) : '—'],
      ['Peak prop efficiency', e.exp3 ? num(e.exp3.eta_prop_peak, '', 2) : '—'],
      ['ESC steady temp', e.exp4 ? num(e.exp4.T_steady_c, ' °C', 0) : '—'],
      ['Overshoot', e.exp5 ? num(e.exp5.overshoot_pct, ' %', 1) : '—'],
      ['Thrust-to-weight', e.exp6 ? num(e.exp6.twr, '', 2) : '—']
    ];
    const chip = (label, val, done) =>
      '<div class="vl-sum__row"><span class="vl-sum__k">' + esc(label) + '</span><span class="vl-sum__v">' + esc(val) + '</span></div>';
    el.innerHTML =
      '<div class="vl-sum">' +
      '<div class="vl-sum__head"><b>Your Drone Build</b> <span>' + s.finalized.length + ' / 6 experiments locked' +
      (s.complete ? ' — complete' : '') + '</span></div>' +
      '<div class="vl-sum__grid"><div class="vl-sum__col"><h5>Components</h5>' + comp.map((r) => chip(r[0], r[1])).join('') + '</div>' +
      '<div class="vl-sum__col"><h5>Performance</h5>' + outs.map((r) => chip(r[0], r[1])).join('') + '</div></div>' +
      '<div class="vl-sum__status ' + (errs ? 'is-error' : (warns || s.stale.length ? 'is-warn' : 'is-ok')) + '">' +
      (errs ? (errs + ' blocking issue' + (errs > 1 ? 's' : '') + ' — resolve before building')
            : (s.stale.length ? (s.stale.length + ' experiment(s) need re-validation')
            : (warns ? (warns + ' advisory warning' + (warns > 1 ? 's' : '')) : 'All checks passed — ready to build'))) +
      '</div></div>';
    return s;
  }

  /**
   * Convenience: create (or reuse) a gate container at the top of the page and
   * mount the strict prerequisite gate on it. Non-intrusive — the container is a
   * normal-flow block that stays empty (display:none) until prerequisites are
   * missing. Returns { ready, refresh }.
   */
  function autoGate(expId, opts) {
    opts = opts || {};
    if (typeof document === 'undefined') return { ready: true, refresh: function () { return true; } };
    let host = document.getElementById('vlabGateHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'vlabGateHost';
      host.style.margin = '10px';
      const anchor = document.querySelector('[data-vl-gate]') || document.querySelector('main.workspace') ||
        document.querySelector('main') || document.querySelector('.workspace') || document.body;
      anchor.insertBefore(host, anchor.firstChild);
    }
    return mountGate(host, Object.assign({ expId: expId }, opts));
  }

  /**
   * Convenience: mount the final "Your Drone Build" summary panel at the bottom
   * of the page (appended to the workspace). Returns { refresh, host } so the
   * host experiment can re-render it whenever the build changes.
   */
  function autoBuildSummary(opts) {
    opts = opts || {};
    if (typeof document === 'undefined') return { refresh: function () {} };
    let host = document.getElementById('vlabBuildSummaryHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'vlabBuildSummaryHost';
      host.style.margin = '14px';
      const anchor = (opts.anchor && elFrom(opts.anchor)) || document.querySelector('main.workspace') ||
        document.querySelector('main') || document.querySelector('.workspace') || document.body;
      anchor.appendChild(host);
    }
    const catalog = opts.catalog || root.VLAB_CATALOG || {};
    function refresh() { try { renderBuildSummary(host, catalog); } catch (e) { /* summary optional */ } }
    refresh();
    return { refresh: refresh, host: host };
  }

  return {
    EXP: EXP,
    renderHeader: renderHeader,
    mountBanner: mountBanner,
    mountGate: mountGate,
    autoGate: autoGate,
    autoBuildSummary: autoBuildSummary,
    inheritedSummary: inheritedSummary,
    renderBuildSummary: renderBuildSummary,
    updateBuildChip: updateBuildChip,
    defaultRedoUrl: defaultRedoUrl
  };
}));

/* ===== SHARED PRELUDE 6/7: vlab-lab.js ===== */
/* ============================================================================
 * Drone Technology Virtual Lab — Shared Interaction Kit (window.VLABLab)
 *
 * ONE uniform interaction model for all six experiments. It replaces the old
 * "record N readings -> unlock" worksheet mechanic with:
 *
 *   1. objectives(host, defs, ctx) — a live objectives list whose rows AUTO-TICK
 *      the instant the real engineering condition (def.test(ctx)) is satisfied.
 *      Returns { done, total, allDone } so the caller can auto-unlock a stage.
 *
 *   2. scenario(host, cfg) — a uniform "inject a real-world fault" selector so
 *      every experiment presents component/design faults the same way.
 *
 *   3. verdict(host, cfg) — the uniform pass / warn / fail status chip.
 *
 * The panels carry their own scoped styles (injected once, hard-coded to the
 * shared light-academic palette) so they render IDENTICALLY in every experiment
 * without depending on — or disturbing — each experiment's own main.css. This is
 * the same self-contained philosophy used by shared/ui/vlab-ui.js.
 *
 * Vendored into each experiment's simulation/js/vendor/ by shared/vendor.mjs and
 * loaded via <script src="js/vendor/vlab-lab.js">. Guarded everywhere: safe to
 * call with a missing host, and a no-op in the headless test harness (no DOM).
 * ==========================================================================*/
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.VLABLab = api;
}(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const elFrom = (t) => (typeof t === 'string' ? (typeof document !== 'undefined' ? document.getElementById(t) : null) : t);

  // ── one-time scoped styles (light-academic palette, hard-coded so they match
  //    everywhere regardless of whether tokens.css is present) ──────────────────
  function injectStylesOnce() {
    if (typeof document === 'undefined' || document.getElementById('vlab-lab-inline')) return;
    const css =
      '.vlab-obj{font-family:Inter,system-ui,sans-serif;display:flex;flex-direction:column;gap:5px}' +
      '.vlab-obj__head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:1px}' +
      '.vlab-obj__title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b}' +
      '.vlab-obj__prog{font:600 11px "JetBrains Mono",ui-monospace,monospace;color:#334155;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:999px;padding:2px 9px}' +
      '.vlab-obj__prog.is-all{color:#065f46;background:#ecfdf5;border-color:#a7f3d0}' +
      '.vlab-obj__item{display:flex;gap:9px;align-items:flex-start;padding:7px 9px;border-radius:8px;border:1px solid transparent;transition:background 140ms,border-color 140ms}' +
      '.vlab-obj__item.is-current{background:#fff7e6;border-color:#f3e2a8}' +
      '.vlab-obj__icon{width:16px;height:16px;border-radius:50%;flex:0 0 16px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;margin-top:1px;background:#e2e8f0;color:#64748b}' +
      '.vlab-obj__item.is-done .vlab-obj__icon{background:#dcfce7;color:#15803d}' +
      '.vlab-obj__item.is-current .vlab-obj__icon{background:#f5a300;color:#1a1407}' +
      '.vlab-obj__item.is-warn .vlab-obj__icon{background:#fef3c7;color:#b45309}' +
      '.vlab-obj__body{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}' +
      '.vlab-obj__label{font-size:12.5px;font-weight:600;color:#0f172a;line-height:1.3}' +
      '.vlab-obj__item.is-done .vlab-obj__label{color:#334155}' +
      '.vlab-obj__hint{font-size:11px;color:#64748b;line-height:1.35}' +
      '.vlab-obj__val{font:600 11px "JetBrains Mono",ui-monospace,monospace;color:#475569;white-space:nowrap;flex:0 0 auto;margin-top:1px}' +
      '.vlab-obj__item.is-done .vlab-obj__val{color:#15803d}' +
      '.vlab-obj__item.is-warn .vlab-obj__val{color:#b45309}' +
      '.vlab-scn{font-family:Inter,system-ui,sans-serif;display:flex;flex-direction:column;gap:6px}' +
      '.vlab-scn__label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b}' +
      '.vlab-scn__select{font:inherit;font-size:13px;padding:8px 10px;border-radius:8px;border:1px solid #e2e8f0;background:#fff;color:#0f172a;cursor:pointer;width:100%}' +
      '.vlab-scn__select:focus{outline:none;border-color:#f5a300;box-shadow:0 0 0 3px rgba(245,163,0,.22)}' +
      '.vlab-scn__desc{font-size:11.5px;line-height:1.4;color:#64748b}' +
      '.vlab-scn__desc.is-fault{color:#b45309;font-weight:600}' +
      '.vlab-scn__desc.is-clear{color:#15803d;font-weight:600}' +
      '.vlab-verdict{font-family:Inter,system-ui,sans-serif;display:flex;justify-content:space-between;align-items:center;gap:10px;font-weight:700;font-size:13px;border-radius:8px;padding:9px 12px;border:1px solid}' +
      '.vlab-verdict__note{font-weight:500;font-size:11.5px;opacity:.85}' +
      '.vlab-verdict.pass{background:#ecfdf5;color:#065f46;border-color:#a7f3d0}' +
      '.vlab-verdict.warn{background:#fffbeb;color:#92400e;border-color:#fde68a}' +
      '.vlab-verdict.fail{background:#fef2f2;color:#991b1b;border-color:#fecaca}';
    const st = document.createElement('style');
    st.id = 'vlab-lab-inline';
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  /**
   * Render a live objectives list. Each objective AUTO-TICKS when its test()
   * returns truthy — there is no "record" button and nothing to log.
   *
   * @param host  element or element id to render into
   * @param defs  [{ id, label, hint?, test(ctx)->bool, value?(ctx)->string,
   *                 warn?(ctx)->bool, optional?:bool }]
   * @param ctx   arbitrary context object passed straight to test/value/warn
   *              (typically the experiment's `state` or a computed snapshot)
   * @param opts  { title? }  (defaults to "Objectives")
   * @returns { done, total, allDone, results }  allDone ignores `optional` items
   */
  function objectives(host, defs, ctx, opts) {
    const el = elFrom(host);
    defs = defs || [];
    opts = opts || {};
    const results = {};
    let done = 0, required = 0, requiredDone = 0;
    const evald = defs.map((d) => {
      let ok = false, warn = false;
      try { ok = !!d.test(ctx); } catch (e) { ok = false; }
      if (!ok && typeof d.warn === 'function') { try { warn = !!d.warn(ctx); } catch (e) { warn = false; } }
      results[d.id] = ok;
      if (ok) done++;
      if (!d.optional) { required++; if (ok) requiredDone++; }
      return { def: d, ok: ok, warn: warn };
    });
    const allDone = required > 0 && requiredDone === required;
    // The "current" objective = first required one still open (drives the amber highlight).
    let currentIdx = -1;
    for (let i = 0; i < evald.length; i++) { if (!evald[i].ok && !evald[i].def.optional) { currentIdx = i; break; } }

    if (el) {
      injectStylesOnce();
      let val;
      const rows = evald.map((r, i) => {
        const cls = r.ok ? 'is-done' : (i === currentIdx ? 'is-current' : (r.warn ? 'is-warn' : ''));
        const mark = r.ok ? '\u2713' : (i === currentIdx ? '\u25B6' : (r.warn ? '!' : ''));
        try { val = r.def.value ? r.def.value(ctx) : ''; } catch (e) { val = ''; }
        const hint = r.def.hint ? '<span class="vlab-obj__hint">' + esc(r.def.hint) + '</span>' : '';
        const valHtml = val ? '<span class="vlab-obj__val">' + esc(String(val)) + '</span>' : '';
        return '<div class="vlab-obj__item ' + cls + '"><span class="vlab-obj__icon">' + mark + '</span>' +
          '<span class="vlab-obj__body"><span class="vlab-obj__label">' + esc(r.def.label) + '</span>' + hint + '</span>' +
          valHtml + '</div>';
      }).join('');
      el.innerHTML =
        '<div class="vlab-obj"><div class="vlab-obj__head"><span class="vlab-obj__title">' + esc(opts.title || 'Objectives') + '</span>' +
        '<span class="vlab-obj__prog' + (allDone ? ' is-all' : '') + '">' + requiredDone + ' / ' + required + (allDone ? ' \u2713' : '') + '</span></div>' +
        rows + '</div>';
    }
    return { done: done, total: defs.length, allDone: allDone, results: results };
  }

  /**
   * Uniform "inject a real-world fault / scenario" selector.
   * @param host element or id
   * @param cfg  { title?, current, options:[{id,label,desc?,fault?:bool}], onSelect(id) }
   * @returns { value }  the currently selected id
   */
  function scenario(host, cfg) {
    const el = elFrom(host);
    cfg = cfg || {};
    const options = cfg.options || [];
    if (el) {
      injectStylesOnce();
      const cur = options.find((o) => o.id === cfg.current) || options[0] || {};
      const optsHtml = options.map((o) => '<option value="' + esc(o.id) + '"' + (o.id === cfg.current ? ' selected' : '') + '>' + esc(o.label) + '</option>').join('');
      const descCls = cur.fault ? ' is-fault' : (cur.id && cur.id !== 'none' ? '' : ' is-clear');
      el.innerHTML =
        '<div class="vlab-scn"><span class="vlab-scn__label">' + esc(cfg.title || 'Fault scenario') + '</span>' +
        '<select class="vlab-scn__select">' + optsHtml + '</select>' +
        '<span class="vlab-scn__desc' + descCls + '">' + esc(cur.desc || '') + '</span></div>';
      const sel = el.querySelector('.vlab-scn__select');
      if (sel && typeof cfg.onSelect === 'function') sel.addEventListener('change', (e) => cfg.onSelect(e.target.value));
    }
    return { value: cfg.current };
  }

  /**
   * Uniform pass / warn / fail verdict chip.
   * @param host element or id
   * @param cfg  { label, tone:'pass'|'warn'|'fail', note? }
   */
  function verdict(host, cfg) {
    const el = elFrom(host);
    cfg = cfg || {};
    if (!el) return;
    injectStylesOnce();
    const tone = (cfg.tone === 'fail' || cfg.tone === 'warn') ? cfg.tone : 'pass';
    // Strip any tone/marker tokens THIS function added on a previous call before
    // re-adding fresh ones — a plain substring regex leaves stale tone classes
    // stacked across repeated tone transitions (e.g. "pass pass vlab-verdict warn").
    el.className = el.className.split(/\s+/).filter(function (c) { return c && c !== 'vlab-verdict' && c !== 'pass' && c !== 'warn' && c !== 'fail'; }).concat(['vlab-verdict', tone]).join(' ');
    el.innerHTML = '<span>' + esc(cfg.label || '') + '</span>' + (cfg.note ? '<span class="vlab-verdict__note">' + esc(cfg.note) + '</span>' : '');
  }

  return { objectives: objectives, scenario: scenario, verdict: verdict, injectStyles: injectStylesOnce };
}));

/* ===== SHARED PRELUDE 7/7: drone3d.js ===== */
/* ============================================================================
 * VLAB_DRONE3D — shared high-quality procedural quadcopter for the drone labs.
 *
 * A single, reusable three.js drone so every experiment shows the SAME
 * high-poly, physically-plausible 5" FPV quadcopter instead of a bespoke
 * low-poly stand-in. Built from three.js primitives ONLY (no GLB):
 *   · airfoil, twisted, tapered propeller blades (ExtrudeGeometry) — 2/3/4 sel.
 *   · lathe-turned outrunner motor bells with copper stator windings
 *   · beveled carbon-fibre frame plates (rounded-rect ExtrudeGeometry) with a
 *     procedural carbon-weave CanvasTexture, aluminium standoffs & CF arms
 *   · flight-stack (FC + ESC), LiPo pack, FPV camera, whip antenna
 *   · status LEDs (green nose / red tail) and tubular landing gear
 *
 * API (all THREE references are passed in so the module is import-order and
 * headless safe — it only defines functions, it never touches THREE on load):
 *   VLAB_DRONE3D.build(THREE, opts) ->
 *       { root, props[], leds[], rotorCenters[], blades[], setLed(hex) }
 *     · root          : THREE.Group — the whole craft, nose at +Z, X-config,
 *                       body centred at the origin (~0.6 m wheelbase). Bank /
 *                       tilt / bob this group.
 *     · props         : prop THREE.Group[] each with userData.spin = ±1, so a
 *                       caller can `p.rotation.y += rate * p.userData.spin`.
 *     · rotorCenters  : local THREE.Vector3[] of the four prop hubs (for thrust
 *                       vectors / effects).
 *   VLAB_DRONE3D.studio(THREE, scene, renderer, opts) ->
 *       { key, fill, ground, grid } — consistent light-studio setup (matches
 *       the polished experiments): PBR tone-mapping, key+fill+rim lights, a
 *       soft ground disc and a faint reference grid.
 * ==========================================================================*/
(function (root) {
  'use strict';

  // ── procedural carbon-fibre weave (2×2 twill) as a CanvasTexture ──────────
  function carbonTexture(THREE) {
    const size = 128;
    const cv = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
    if (!cv) return null;
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#151515'; ctx.fillRect(0, 0, size, size);
    const n = 8, ts = size / n;
    ctx.fillStyle = '#262626';
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if ((i + j) % 2 === 0) ctx.fillRect(i * ts, j * ts, ts, ts);
      }
    }
    ctx.strokeStyle = 'rgba(10,10,10,0.55)'; ctx.lineWidth = 1;
    for (let k = 0; k <= size; k += 4) {
      ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, k); ctx.lineTo(size, k); ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 3);
    return tex;
  }

  function std(THREE, color, roughness, metalness, extra) {
    return new THREE.MeshStandardMaterial(Object.assign({
      color: color, roughness: roughness, metalness: metalness
    }, extra || {}));
  }

  function roundedRectShape(THREE, w, d, r) {
    const s = new THREE.Shape();
    const x = -w / 2, y = -d / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y);
    s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + d - r);
    s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
    s.lineTo(x + r, y + d);
    s.quadraticCurveTo(x, y + d, x, y + d - r);
    s.lineTo(x, y + r);
    s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }

  // Cambered airfoil cross-section contour (2-D points, chordwise x thickness y) —
  // same NACA-style thickness/camber distribution as exp1/2/4's hero propeller
  // (_propAirfoilContour), ported verbatim so the blade surface reads identically
  // across every experiment.
  function _propAirfoilContour(chord, thick, camber, S) {
    const pts = [];
    function yt(s) { return 5 * thick * (0.2969 * Math.sqrt(s) - 0.1260 * s - 0.3516 * s * s + 0.2843 * s * s * s - 0.1015 * s * s * s * s); }
    function yc(s) { return camber * 4 * s * (1 - s); }
    for (let i = 0; i <= S; i++) { const s = i / S; pts.push([(0.5 - s) * chord, yc(s) + yt(s) / 2]); }       // upper  LE→TE
    for (let i = S - 1; i >= 1; i--) { const s = i / S; pts.push([(0.5 - s) * chord, yc(s) - yt(s) / 2]); }   // lower  TE→LE
    return pts;
  }

  // One smooth blade: a single lofted surface swept root→tip with interpolated
  // chord/thickness and true geometric twist φ(r) = atan(pitch / 2πr) — ported
  // verbatim from exp1/2/4's hero propeller (_buildPropBlade), replacing this
  // file's old boxy 8-segment extruded-airfoil blade so every experiment renders
  // the SAME smooth propeller.
  function _buildPropBlade(radius, hubR, baseChord, dirSign, bladeMat, tipMat, pitch_m) {
    const NST = 26, S = 14, M = 2 * S;
    const verts = [], idx = [];
    for (let j = 0; j <= NST; j++) {
      const t = j / NST;
      const r = hubR + (radius - hubR) * t;
      let chord = baseChord * (0.55 + 0.60 * Math.sin(Math.PI * Math.pow(Math.min(t, 0.999), 0.7)) - 0.32 * t);
      if (t > 0.9) chord *= Math.max(0.12, 1 - (t - 0.9) / 0.1 * 0.9);   // pinch the tip round
      chord = Math.max(chord, baseChord * 0.1);
      const thick = (0.11 * baseChord) * (1 - t) + 0.015 * baseChord * t;
      const camber = (0.06 * chord) * (1 - t) + 0.012 * chord * t;
      const phi = Math.atan2(pitch_m, 2 * Math.PI * Math.max(r, 1e-4)) * dirSign;
      const cs = Math.cos(phi), sn = Math.sin(phi);
      const c2d = _propAirfoilContour(chord, thick, camber, S);
      for (let k = 0; k < M; k++) {
        const zc = c2d[k][0], yc2 = c2d[k][1];                 // chordwise→z, thickness→y
        verts.push(r, yc2 * cs - zc * sn, yc2 * sn + zc * cs);  // twist about span (+x)
      }
    }
    for (let j = 0; j < NST; j++) {
      const a = j * M, b = (j + 1) * M;
      for (let k = 0; k < M; k++) { const k2 = (k + 1) % M; idx.push(a + k, a + k2, b + k, a + k2, b + k2, b + k); }
    }
    // tip cap: fan the last ring to its centroid
    const lastStart = NST * M;
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < M; k++) { cx += verts[(lastStart + k) * 3]; cy += verts[(lastStart + k) * 3 + 1]; cz += verts[(lastStart + k) * 3 + 2]; }
    const cIdx = verts.length / 3;
    verts.push(cx / M, cy / M, cz / M);
    for (let k = 0; k < M; k++) { const k2 = (k + 1) % M; idx.push(lastStart + k, cIdx, lastStart + k2); }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geom.setIndex(idx);
    const band = 3;                                            // outer stations → red tip material
    const mainCount = (NST - band) * M * 6;
    geom.addGroup(0, mainCount, 0);
    geom.addGroup(mainCount, band * M * 6 + M * 3, 1);
    geom.computeVertexNormals();
    const mesh = new THREE.Mesh(geom, [bladeMat, tipMat]);
    mesh.castShadow = true;
    const blade = new THREE.Group(); blade.add(mesh);
    return blade;
  }

  // hub + N airfoil blades; returns a group meant to spin about local +Y
  // Exp 1's hero propeller — ported verbatim (hub barrel + dark centre bore +
  // top washer + N lofted airfoil blades with red tips, P/D = 0.45 like Exp 1's
  // stock two-blade props), plus the faint motion-blur disc.
  function buildPropellerMesh(THREE, propR, blades, dirSign) {
    const R = propR;
    const pitch_m = 0.45 * (R * 2);
    const root = new THREE.Group();

    const bladeMat = std(THREE, 0x161a20, 0.28, 0.14, { side: THREE.DoubleSide });
    const tipMat = std(THREE, 0xef4444, 0.26, 0.1, { emissive: 0x5c1414, emissiveIntensity: 0.3, side: THREE.DoubleSide });

    const hubR = R * 0.1;
    const baseChord = R * 0.17;

    const hub = new THREE.Mesh(new THREE.CylinderGeometry(hubR, hubR * 1.12, R * 0.09, 36), bladeMat);
    hub.castShadow = true; root.add(hub);
    const bore = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.032, R * 0.032, R * 0.1, 24), std(THREE, 0x05070a, 0.7, 0.3));
    root.add(bore);
    const washer = new THREE.Mesh(new THREE.CylinderGeometry(hubR * 0.72, hubR * 0.72, R * 0.02, 30), std(THREE, 0x2a2f36, 0.4, 0.7));
    washer.position.y = R * 0.05; root.add(washer);

    for (let b = 0; b < blades; b++) {
      const blade = _buildPropBlade(R, hubR * 0.9, baseChord, dirSign, bladeMat, tipMat, pitch_m);
      blade.rotation.y = b * (Math.PI * 2 / blades);
      root.add(blade);
    }

    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(R * 1.02, 40),
      new THREE.MeshBasicMaterial({ color: 0x9aa3b2, transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false })
    );
    disc.rotation.x = -Math.PI / 2; disc.position.y = 0.006; root.add(disc);

    root.userData.spin = dirSign;
    return root;
  }

  // lathe-turned outrunner bell + copper windings + stator + shaft
  // Exp 1's high-poly "hero" BLDC outrunner — ported with its exact geometry
  // and Exp 1's function name so every experiment uses the same builder:
  // mounting cross + bearing boss, laminated stator stack, 12 copper-wound
  // teeth, anodised lathe bell with accent ring, vented top cap, hub screws,
  // steel shaft, circlip and anodised prop nut. Local frame: y = 0 is the
  // mount face; the bell starts 4 mm up, so place the group 4 mm below the
  // motor seat (Exp 1's motorY - 0.004 convention).
  function buildMotorMesh(THREE, motorR, motorH, accent) {
    const bellR = motorR, bellH = motorH;
    accent = (accent !== undefined) ? accent : 0xc2410c;
    const root = new THREE.Group();

    // static base: mounting cross + bearing boss
    const baseY = 0.0;
    const mountMat = std(THREE, 0x2b3038, 0.44, 0.72);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(bellR * 0.5, bellR * 0.55, 0.0022, 40), mountMat);
    plate.position.y = baseY + 0.0011; plate.receiveShadow = true; root.add(plate);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(bellR * 1.7, 0.0022, 0.004), mountMat);
      arm.position.set(0, baseY + 0.0011, 0); arm.rotation.y = a; root.add(arm);
      const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.0011, 0.0011, 0.003, 12), std(THREE, 0x0a0c10, 0.6, 0.3));
      hole.position.set(Math.cos(a) * bellR * 0.8, baseY + 0.0011, Math.sin(a) * bellR * 0.8); root.add(hole);
    }
    const boss = new THREE.Mesh(new THREE.CylinderGeometry(bellR * 0.2, bellR * 0.22, 0.006, 28), std(THREE, 0x3a4048, 0.4, 0.78));
    boss.position.y = baseY + 0.004; root.add(boss);

    // laminated stator stack (thin alternating discs)
    const statorBottom = baseY + 0.0055;
    const statorH = bellH * 0.5;
    const statorR = bellR * 0.66;
    const lamN = Math.max(8, Math.round(statorH / 0.0006));
    const lamA = std(THREE, 0x8a94a3, 0.42, 0.85), lamB = std(THREE, 0x727d8c, 0.5, 0.8);
    for (let i = 0; i < lamN; i++) {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(statorR, statorR, statorH / lamN * 0.96, 44),
        (i % 2) ? lamA : lamB);
      disc.position.y = statorBottom + (i + 0.5) * (statorH / lamN); root.add(disc);
    }

    // 12 copper-wound teeth around the stator
    const teeth = 12;
    const copper = std(THREE, 0xb5641e, 0.34, 0.72, { emissive: 0x3a1c08, emissiveIntensity: 0.25 });
    const enamel = std(THREE, 0xd08a3a, 0.3, 0.5);
    for (let t = 0; t < teeth; t++) {
      const a = (t / teeth) * Math.PI * 2;
      const windGroup = new THREE.Group();
      windGroup.position.set(Math.cos(a) * statorR * 1.02, statorBottom + statorH / 2, Math.sin(a) * statorR * 1.02);
      windGroup.rotation.y = -a;
      const rings = 5;
      for (let r = 0; r < rings; r++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(statorH * 0.24, 0.0007, 10, 20),
          (r % 2) ? copper : enamel);
        ring.rotation.y = Math.PI / 2;
        ring.position.y = (r - (rings - 1) / 2) * (statorH * 0.34 / rings);
        windGroup.add(ring);
      }
      root.add(windGroup);
    }

    // spinning assembly (Exp 1's `spin` sub-group): anodised bell + top cap +
    // hub + shaft + prop nut all rotate with the shaft.
    const spin = new THREE.Group(); root.add(spin);
    const bellBottom = baseY + 0.004;
    const bellTop = bellBottom + bellH;
    const p = [];
    p.push(new THREE.Vector2(bellR * 0.995, bellBottom));
    p.push(new THREE.Vector2(bellR, bellBottom + 0.0006));
    p.push(new THREE.Vector2(bellR, bellTop - bellH * 0.18));
    p.push(new THREE.Vector2(bellR * 0.92, bellTop - bellH * 0.06));
    p.push(new THREE.Vector2(bellR * 0.62, bellTop));
    p.push(new THREE.Vector2(bellR * 0.2, bellTop + 0.0006));
    p.push(new THREE.Vector2(bellR * 0.09, bellTop + 0.0006));
    const bellMat = std(THREE, 0x1f242b, 0.33, 0.86, { emissive: accent, emissiveIntensity: 0.05 });
    const bell = new THREE.Mesh(new THREE.LatheGeometry(p, 64), bellMat);
    bell.castShadow = true; spin.add(bell);

    const ring = new THREE.Mesh(new THREE.CylinderGeometry(bellR * 1.005, bellR * 1.005, bellH * 0.09, 64, 1, true),
      std(THREE, accent, 0.36, 0.7, { emissive: accent, emissiveIntensity: 0.18 }));
    ring.position.y = bellBottom + bellH * 0.14; spin.add(ring);

    const topCap = new THREE.Mesh(new THREE.CylinderGeometry(bellR * 0.62, bellR * 0.62, 0.0006, 48),
      std(THREE, accent, 0.38, 0.66, { emissive: accent, emissiveIntensity: 0.12 }));
    topCap.position.y = bellTop + 0.0004; spin.add(topCap);
    const ventMat = std(THREE, 0x05070a, 0.8, 0.1);
    for (let h = 0; h < 6; h++) {
      const a = (h / 6) * Math.PI * 2;
      const vent = new THREE.Mesh(new THREE.CylinderGeometry(bellR * 0.1, bellR * 0.1, 0.0016, 20), ventMat);
      vent.position.set(Math.cos(a) * bellR * 0.4, bellTop + 0.0002, Math.sin(a) * bellR * 0.4); spin.add(vent);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(bellR * 0.24, bellR * 0.26, 0.004, 28),
      std(THREE, 0x2a2f36, 0.4, 0.8)); hub.position.y = bellTop + 0.002; spin.add(hub);
    for (let s = 0; s < 3; s++) {
      const a = (s / 3) * Math.PI * 2;
      const scr = new THREE.Mesh(new THREE.CylinderGeometry(0.0009, 0.0009, 0.0016, 6),
        std(THREE, 0xced5dd, 0.34, 0.9));
      scr.position.set(Math.cos(a) * bellR * 0.16, bellTop + 0.0036, Math.sin(a) * bellR * 0.16); spin.add(scr);
    }

    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, bellH * 1.5, 28),
      std(THREE, 0xdfe5ec, 0.2, 0.95));
    shaft.position.y = bellTop + bellH * 0.35; spin.add(shaft);
    const clip = new THREE.Mesh(new THREE.TorusGeometry(0.0028, 0.0006, 8, 20), std(THREE, 0xc7ccd3, 0.24, 0.9));
    clip.rotation.x = Math.PI / 2; clip.position.y = bellTop + bellH * 0.72; spin.add(clip);
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.0042, 0.0042, 0.004, 6),
      std(THREE, accent, 0.34, 0.72, { emissive: accent, emissiveIntensity: 0.12 }));
    nut.position.y = bellTop + bellH * 0.5; spin.add(nut);

    return { group: root, spin: spin };
  }

  function build(THREE, opts) {
    opts = opts || {};
    if (!THREE) return { root: null, props: [], leds: [], rotorCenters: [], blades: [] };

    // Defaults reproduce Exp 1's 450 mm carbon build (cf_450 frame, 2212-class
    // motor, 10" two-blade prop) so the standalone view IS Exp 1's drone; a
    // locked build from the store overrides the dimensions with the real ones.
    const blades = Math.max(2, Math.min(4, opts.blades || 2));
    const armReach = opts.armReach || 0.225;                 // wheelbase / 2
    const propR = opts.propR || 0.127;
    const motorR = opts.motorR || 0.01385;                   // bell radius
    const motorH = opts.motorH || 0.026;                     // bell height
    const accent = 0xc2410c;                                 // Exp 1's anodised orange, uniform everywhere
    const bw = opts.bodyW || 0.088, bz = opts.bodyD || 0.088, bh = 0.026;
    const armR = Math.max(0.005, Math.min(0.012, 0.008 * (armReach / 0.225)));

    const rootGrp = new THREE.Group();
    const props = [];
    const leds = [];
    const rotorCenters = [];

    // ── Exp 1's materials, verbatim ─────────────────────────────────────────
    const frameMat = std(THREE, 0x1c1c1e, 0.35, 0.05);       // T700 carbon plates & legs
    const armMat = new THREE.MeshStandardMaterial({ color: 0x333333, map: carbonTexture(THREE) || null, roughness: 0.2, metalness: 0.8 });
    const standoffMat = std(THREE, 0xd1d5db, 0.3, 0.9);

    // ── rounded twin decks + four standoffs (Exp 1's plate shapes/bevels) ───
    const extrude = { steps: 1, depth: 0.002, bevelEnabled: true, bevelThickness: 0.0005, bevelSize: 0.0005, bevelOffset: 0, bevelSegments: 2 };
    const bottom = new THREE.Mesh(new THREE.ExtrudeGeometry(roundedRectShape(THREE, bw, bz, Math.min(bw, bz) * 0.12), extrude), frameMat);
    bottom.rotation.x = -Math.PI / 2; bottom.position.y = -0.001; bottom.receiveShadow = true; bottom.castShadow = true;
    rootGrp.add(bottom);
    const top = new THREE.Mesh(new THREE.ExtrudeGeometry(roundedRectShape(THREE, bw * 0.95, bz * 0.95, Math.min(bw, bz) * 0.12), extrude), frameMat);
    top.rotation.x = -Math.PI / 2; top.position.y = bh - 0.001; top.castShadow = true;
    rootGrp.add(top);
    [[-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]].forEach((off) => {
      const so = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, bh - 0.002, 8), standoffMat);
      so.position.set(bw * off[0], bh / 2, bz * off[1]); so.castShadow = true;
      rootGrp.add(so);
    });

    // ── Exp 1's flight stack: 4-in-1 ESC + amber spacers + FC ───────────────
    const escB = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.003, 0.032), std(THREE, 0x14532d, 0.7, 0.1));
    escB.position.set(0, 0.008, 0); rootGrp.add(escB);
    const spacerMat = std(THREE, 0xf59e0b, 0.5, 0.2);
    [[-0.012, -0.012], [0.012, -0.012], [-0.012, 0.012], [0.012, 0.012]].forEach((pt) => {
      const spacer = new THREE.Mesh(new THREE.CylinderGeometry(0.001, 0.001, 0.006, 6), spacerMat);
      spacer.position.set(pt[0], 0.0125, pt[1]); rootGrp.add(spacer);
    });
    const fcB = new THREE.Mesh(new THREE.BoxGeometry(0.030, 0.003, 0.030), std(THREE, 0x14532d, 0.7, 0.1));
    fcB.position.set(0, 0.018, 0); rootGrp.add(fcB);

    // ── Exp 1's LiPo slung under the bottom deck ────────────────────────────
    const mah = opts.batteryMah || 2200;
    const normVal = Math.min(Math.max((mah - 800) / 3400, 0), 1);
    const battW = 0.068 + normVal * 0.076;
    const battH = 0.026 + normVal * 0.016;
    const battD = 0.020 + normVal * 0.018;
    const cellColors = { 3: 0x6e2a14, 4: 0x1f2937, 6: 0x1e1b4b };
    const battMesh = new THREE.Mesh(new THREE.BoxGeometry(battW, battH, battD),
      std(THREE, cellColors[opts.cells || 3] || 0x22252a, 0.8, 0.05));
    const battY = -battH / 2 - 0.003;
    battMesh.position.set(0, battY, 0); battMesh.castShadow = true; rootGrp.add(battMesh);
    const xt60 = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.006, 0.012), std(THREE, 0xeab308, 0.4, 0.1));
    xt60.position.set(0, battY, battD / 2 + 0.004); rootGrp.add(xt60);
    const wireGeo = new THREE.CylinderGeometry(0.001, 0.001, 0.016, 6);
    const wireRed = new THREE.Mesh(wireGeo, std(THREE, 0xef4444, 0.7, 0.0));
    wireRed.position.set(-0.002, battY + 0.002, battD / 2 + 0.009); wireRed.rotation.x = Math.PI / 2; rootGrp.add(wireRed);
    const wireBlack = new THREE.Mesh(wireGeo, std(THREE, 0x1e293b, 0.7, 0.0));
    wireBlack.position.set(0.002, battY + 0.002, battD / 2 + 0.009); wireBlack.rotation.x = Math.PI / 2; rootGrp.add(wireBlack);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(battW * 0.9, 0.002, battD * 0.9), std(THREE, 0x111827, 0.9, 0.0));
    pad.position.set(0, -0.001, 0); rootGrp.add(pad);
    const strapMat = std(THREE, 0x111827, 0.9, 0.0);
    [-battW * 0.25, battW * 0.25].forEach((zOff) => {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(battD * 1.05, battH + bh + 0.006, 0.008), strapMat);
      strap.position.set(zOff, (bh - battH) / 2, 0); strap.rotation.y = Math.PI / 2; rootGrp.add(strap);
    });

    // ── Exp 1's receiver + dual whip antennas (tail, -Z, so heading reads) ──
    const rx = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.004, 0.013), std(THREE, 0x1f2937, 0.8, 0.05));
    rx.position.set(0, 0.003, -bz * 0.32); rootGrp.add(rx);
    const antMat = std(THREE, 0x111827, 0.9, 0.0);
    const antTipMat = std(THREE, 0xd1d5db, 0.4, 0.8);
    [-0.006, 0.006].forEach((xOff, ai) => {
      const antGroup = new THREE.Group();
      antGroup.position.set(xOff, bh, -bz * 0.32);
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.0008, 0.0008, 0.035, 6), antMat);
      tube.position.y = 0.0175; antGroup.add(tube);
      const active = new THREE.Mesh(new THREE.CylinderGeometry(0.0005, 0.0005, 0.015, 6), antTipMat);
      active.position.y = 0.035 + 0.0075; antGroup.add(active);
      antGroup.rotation.z = ai ? -0.6 : 0.6;
      antGroup.rotation.x = -0.3;
      rootGrp.add(antGroup);
    });

    // ── Exp 1's arms, mounts, screws, legs, hero motors and props ──────────
    const diag = Math.SQRT1_2;
    const up = new THREE.Vector3(0, 1, 0);
    const corners = [
      { x: 1, z: 1, spin: 1, led: 0x22c55e },   // front-right  (green)
      { x: -1, z: 1, spin: -1, led: 0x22c55e }, // front-left   (green)
      { x: 1, z: -1, spin: -1, led: 0xef4444 }, // rear-right   (red)
      { x: -1, z: -1, spin: 1, led: 0xef4444 }  // rear-left    (red)
    ];

    corners.forEach((c) => {
      const dir = new THREE.Vector3(c.x * diag, 0, c.z * diag);
      const mx = dir.x * armReach, mz = dir.z * armReach;
      const tipY = bh * 0.45;

      const arm = new THREE.Mesh(new THREE.CylinderGeometry(armR, armR, armReach, 12), armMat);
      arm.position.set(mx / 2, tipY, mz / 2);
      arm.quaternion.setFromUnitVectors(up, dir);
      arm.castShadow = true; rootGrp.add(arm);

      const mount = new THREE.Mesh(new THREE.CylinderGeometry(armR * 2.1, armR * 2.1, 0.003, 12), frameMat);
      mount.position.set(mx, tipY, mz); rootGrp.add(mount);

      const screwGeo = new THREE.CylinderGeometry(0.0008, 0.0008, 0.0006, 6);
      const screwMat = std(THREE, 0x64748b, 0.2, 0.9);
      const sd = armR * 1.5;
      [[-sd, -sd], [-sd, sd], [sd, -sd], [sd, sd]].forEach((soff) => {
        const screw = new THREE.Mesh(screwGeo, screwMat);
        screw.position.set(mx + soff[0], tipY + 0.0016, mz + soff[1]); rootGrp.add(screw);
      });

      const legHeight = 0.12;                                // Exp 1's fixed leg drop
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.002, legHeight, 6), frameMat);
      leg.position.set(mx, tipY - legHeight / 2 - 0.002, mz); leg.castShadow = true; rootGrp.add(leg);

      const motorY = tipY + 0.0015;
      const heroMotor = buildMotorMesh(THREE, motorR, motorH, accent);
      heroMotor.group.position.set(mx, motorY - 0.004, mz); rootGrp.add(heroMotor.group);
      heroMotor.spin.userData.spin = c.spin;
      props.push(heroMotor.spin);                            // bell spins with the prop, like Exp 1

      const prop = buildPropellerMesh(THREE, propR, blades, c.spin);
      prop.position.set(mx, motorY + motorH * 1.5 + propR * 0.045, mz);   // hub rests on the prop nut
      rootGrp.add(prop);
      props.push(prop);
      rotorCenters.push(prop.position.clone());

      const ledMat = std(THREE, c.led, 0.4, 0.2, { emissive: c.led, emissiveIntensity: 0.85 });
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.004, 12, 10), ledMat);
      led.position.set(mx * 0.9, tipY - 0.006, mz * 0.9); rootGrp.add(led);
      leds.push(ledMat);
    });

    function setLed(hex) {
      leds.forEach((m) => { if (m && m.emissive) { m.color.setHex(hex); m.emissive.setHex(hex); } });
    }

    rootGrp.userData.props = props;
    return { root: rootGrp, props: props, leds: leds, rotorCenters: rotorCenters, setLed: setLed };
  }

  // consistent light-studio: PBR tone-mapping, key/fill/rim lights, ground+grid
  function studio(THREE, scene, renderer, opts) {
    opts = opts || {};
    if (!THREE || !scene) return {};
    const groundY = (opts.groundY !== undefined) ? opts.groundY : -0.42;

    if (opts.bg !== null) scene.background = new THREE.Color(opts.bg !== undefined ? opts.bg : 0xeef2f7);

    if (renderer) {
      renderer.shadowMap.enabled = true;
      if (THREE.PCFSoftShadowMap !== undefined) renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      if ('outputEncoding' in renderer && THREE.sRGBEncoding !== undefined) renderer.outputEncoding = THREE.sRGBEncoding;
      if (THREE.ACESFilmicToneMapping !== undefined) { renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.04; }
    }

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.15);
    key.position.set(1.8, 3.0, 1.8); key.castShadow = true;
    if (key.shadow) {
      key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0002;
      if (key.shadow.camera) {
        key.shadow.camera.near = 0.5; key.shadow.camera.far = 10;
        key.shadow.camera.left = -2; key.shadow.camera.right = 2;
        key.shadow.camera.top = 2; key.shadow.camera.bottom = -2;
      }
    }
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xdbeafe, 0.42); fill.position.set(-1.8, 1.1, -1.4); scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.32); rim.position.set(0, 1.4, -2.4); scene.add(rim);
    scene.add(new THREE.HemisphereLight(0xdbeafe, 0xe5e7eb, 0.3));   // Exp 1's hemisphere fill

    let ground = null, grid = null;
    if (opts.ground !== false) {
      ground = new THREE.Mesh(
        new THREE.CircleGeometry(opts.groundR || 3.4, 64),
        new THREE.MeshStandardMaterial({ color: (opts.groundColor !== undefined) ? opts.groundColor : 0xe7ebf1, roughness: 0.96, metalness: 0 })
      );
      ground.rotation.x = -Math.PI / 2; ground.position.y = groundY; ground.receiveShadow = true; scene.add(ground);
    }
    if (opts.grid !== false) {
      grid = new THREE.GridHelper(opts.gridSize || 6, opts.gridDiv || 30, 0xb8c0cc, 0xd3d9e2);
      grid.position.y = groundY + 0.002; scene.add(grid);
    }
    return { key: key, fill: fill, rim: rim, ground: ground, grid: grid };
  }

  root.VLAB_DRONE3D = { build: build, studio: studio, version: 1 };
}(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this)));

/* ===== EXPERIMENT CODE: exp5 flight-control app ===== */
// Experiment 05: Flight Control — PID tuning, Ziegler–Nichols & sensor fusion.
// The Calc IIFE is intentionally first so tests can load it without the DOM app.
const Calc = (function () {
  'use strict';

  const DEG = 180 / Math.PI;
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  // ── Sub-Calc A: angle-loop PD on the inertia plant 1/(J s^2) ──────────────
  function rollInertia(massKg, armM) { return massKg * armM * armM / 2; }      // X-quad lumped mass
  function naturalFreq(Kp, J) { return Math.sqrt(Kp / J); }
  function dampingRatio(Kp, Kd, J) { return Kd / (2 * Math.sqrt(Kp * J)); }
  function overshootPct(zeta) {
    if (zeta <= 0 || zeta >= 1) return 0;
    return 100 * Math.exp(-Math.PI * zeta / Math.sqrt(1 - zeta * zeta));
  }
  function peakTime(wn, zeta) {
    if (zeta >= 1 || zeta <= 0) return Infinity;
    return Math.PI / (wn * Math.sqrt(1 - zeta * zeta));
  }
  function settlingTime(wn, zeta) { return (zeta * wn > 0) ? 4 / (zeta * wn) : Infinity; } // 2%
  function riseTime(wn, zeta) {
    if (zeta >= 1 || zeta <= 0) return Infinity;
    return (Math.PI - Math.acos(zeta)) / (wn * Math.sqrt(1 - zeta * zeta));            // 0-100%
  }
  function disturbanceError(Td, Kp) { return Kp > 0 ? Td / Kp : Infinity; }            // rad (P/PD)
  // analytic unit-step response of the prototype 2nd-order system
  function secondOrderStep(wn, zeta, t) {
    if (t <= 0) return 0;
    if (zeta >= 1) {                                   // overdamped / critical (zeta=1 limit)
      return 1 - Math.exp(-wn * t) * (1 + wn * t);
    }
    const wd = wn * Math.sqrt(1 - zeta * zeta), phi = Math.acos(zeta);
    return 1 - Math.exp(-zeta * wn * t) / Math.sqrt(1 - zeta * zeta) * Math.sin(wd * t + phi);
  }

  // Full closed-loop PID on the rigid-body inertia plant 1/(J s^2), integrated as
  // the real flight controller runs it: derivative-on-measurement with a first-order
  // low-pass, an integrator with conditional anti-windup, and motor-torque saturation,
  // plus an optional constant disturbance torque (the CG-offset couple). This is the
  // step response the drone and the scope actually play, so EVERY gain — including Ki —
  // shapes the motion. At Ki = 0 with no disturbance it collapses onto the analytic
  // second-order prototype above (derivative-on-measurement adds no numerator zero), so
  // the headline numbers stay consistent with the textbook formulas.
  //   opts: theta0Deg (start angle), cmdDeg (commanded angle), Td (disturbance torque
  //   magnitude N·m), distDir (+1/-1 direction), dFilter (derivative LPF tau s),
  //   uMax (motor saturation N·m), dt, T.
  // Returns the angle trace in degrees plus the per-sample P/I/D torque contributions
  // and the step metrics (overshoot %, peak/settling time, steady-state error in deg).
  function angleStepResponse(Kp, Ki, Kd, J, opts) {
    const o = opts || {};
    const DEGl = 180 / Math.PI;
    const theta0 = (o.theta0Deg || 0) / DEGl;                 // rad
    const cmd = ((o.cmdDeg === undefined ? 1 : o.cmdDeg)) / DEGl;
    const Td = o.Td || 0;
    const distDir = (o.distDir === undefined) ? -1 : o.distDir;
    const tauDf = (o.dFilter === undefined) ? 0.001 : o.dFilter;     // derivative LPF (gyro), light & stable
    const uMax = (o.uMax === undefined) ? 1.0 : o.uMax;       // motor torque ceiling
    const Kpe = Math.max(Kp, 1e-6);
    const wn = Math.sqrt(Kpe / J), zeta = Kd / (2 * Math.sqrt(Kpe * J));
    const tSettle = (zeta > 0 && isFinite(zeta)) ? 4 / (zeta * wn) : 2;
    const T = o.T || Math.min(8, Math.max(1.2, 6 * tSettle));
    const dt = o.dt || Math.min(2.5e-4, T / 4000);
    const N = Math.max(1, Math.round(T / dt));
    const stride = Math.max(1, Math.round(N / 600));
    const step = cmd - theta0, tauD = distDir * Td;

    let theta = theta0, omega = 0, I = 0, dFilt = 0;
    let peakVal = theta0, tp = 0;
    const ys = [], samples = [];
    for (let i = 0; i < N; i++) {
      const e = cmd - theta;
      I += e * dt;
      // Derivative on measurement using the GYRO RATE (as real flight controllers do:
      // the gyro measures angular rate directly), with a light first-order low-pass.
      dFilt += dt * (omega - dFilt) / tauDf;
      const pTerm = Kp * e, dTerm = -Kd * dFilt;
      let iTerm = Ki * I;
      let u = pTerm + iTerm + dTerm;
      if (u > uMax) { u = uMax; if (e > 0) I -= e * dt; iTerm = Ki * I; }       // anti-windup
      else if (u < -uMax) { u = -uMax; if (e < 0) I -= e * dt; iTerm = Ki * I; }
      const accel = (u + tauD) / J;                                   // J*theta'' = u + disturbance
      omega += accel * dt;                                            // semi-implicit (symplectic) Euler
      theta += omega * dt;
      if ((step >= 0 && theta > peakVal) || (step < 0 && theta < peakVal)) { peakVal = theta; tp = i * dt; }
      ys.push(theta);
      if (i % stride === 0) samples.push({ t: i * dt, deg: theta * DEGl, p: pTerm, i: iTerm, d: dTerm });
    }
    const finalTheta = ys[ys.length - 1];
    // overshoot is measured from the achieved steady value (textbook Mp), so toggling
    // the disturbance shifts where it settles without distorting the overshoot metric.
    const overEx = (step >= 0) ? (peakVal - finalTheta) : (finalTheta - peakVal);
    const denom = Math.abs(finalTheta - theta0);
    const osPct = (denom > 1e-9) ? Math.max(0, overEx / denom) * 100 : 0;
    let tsSettle = T; const band = 0.02 * Math.abs(step);             // 2% about the achieved steady value
    if (band > 0) { for (let i = ys.length - 1; i >= 0; i--) { if (Math.abs(ys[i] - finalTheta) > band) { tsSettle = (i + 1) * dt; break; } } }
    return {
      samples: samples, _T: T,
      cmdDeg: cmd * DEGl, theta0Deg: theta0 * DEGl, finalDeg: finalTheta * DEGl,
      osPct: osPct, peakTime: tp, settlingTime: tsSettle, essDeg: (cmd - finalTheta) * DEGl
    };
  }

  // ── Sub-Calc B: Ziegler–Nichols on the Type-0 three-lag rate loop ─────────
  function ultimateFreq(tm, ta, ts) { return Math.sqrt((tm + ta + ts) / (tm * ta * ts)); }
  function ultimatePeriod(tm, ta, ts) { return 2 * Math.PI / ultimateFreq(tm, ta, ts); }
  function ultimateGain(tm, ta, ts, K) {
    const k = (K === undefined) ? 1 : K;
    return ((tm * ta + tm * ts + ta * ts) * (tm + ta + ts) / (tm * ta * ts) - 1) / k;
  }
  function znClassic(Ku, Pu) {
    const Kp = 0.6 * Ku, Ti = 0.5 * Pu, Td = 0.125 * Pu;
    return { Kp: Kp, Ti: Ti, Td: Td, Ki: Kp / Ti, Kd: Kp * Td };
  }
  function znTyreusLuyben(Ku, Pu) {
    const Kp = 0.45 * Ku, Ti = 2.2 * Pu, Td = Pu / 6.3;
    return { Kp: Kp, Ti: Ti, Td: Td, Ki: Kp / Ti, Kd: Kp * Td };
  }
  // Simulate the rate loop (PID on three cascaded lags), realistic FC PID:
  // derivative-on-measurement + first-order derivative low-pass. Returns samples + metrics.
  function rateStepResponse(Kp, Ki, Kd, tm, ta, ts, opts) {
    const o = opts || {};
    const dt = o.dt || 0.0001, T = o.T || 1.0, ref = (o.ref === undefined) ? 1 : o.ref;
    const tauDf = (o.dFilter === undefined) ? 0.004 : o.dFilter;
    const stride = o.stride || Math.max(1, Math.round((T / dt) / 600));
    let x1 = 0, x2 = 0, x3 = 0, I = 0, prevMeas = 0, dFilt = 0;
    const N = Math.round(T / dt); let peak = 0, tp = 0; const ys = [], samples = [];
    for (let i = 0; i < N; i++) {
      const err = ref - x3;
      I += err * dt;
      const dMeas = (x3 - prevMeas) / dt; prevMeas = x3;
      dFilt += dt * (dMeas - dFilt) / tauDf;
      const u = Kp * err + Ki * I - Kd * dFilt;        // derivative on measurement
      x1 += dt * (u - x1) / tm;
      x2 += dt * (x1 - x2) / ta;
      x3 += dt * (x2 - x3) / ts;
      if (x3 > peak) { peak = x3; tp = i * dt; }
      ys.push(x3);
      if (i % stride === 0) samples.push({ t: i * dt, y: x3 });
    }
    let tsSettle = T;
    for (let i = N - 1; i >= 0; i--) { if (Math.abs(ys[i] - ref) > 0.02 * Math.abs(ref)) { tsSettle = (i + 1) * dt; break; } }
    const final = ys[N - 1];
    return {
      samples: samples, osPct: ref !== 0 ? (peak - ref) / ref * 100 : 0,
      peakTime: tp, settlingTime: tsSettle, final: final,
      essPct: ref !== 0 ? (ref - final) / ref * 100 : 0
    };
  }

  // ── Air resistance: rotational aerodynamic drag about the roll axis ────────
  // Real quads feel two passive aero torques opposing rotation: a linear
  // viscous term (dominant at the low rates of an attitude step) and a
  // quadratic form-drag term (grows with ω², matters only in violent motion).
  // Both scale with air DENSITY, so altitude and a user "air resistance" knob
  // both act through the same physical channel. b [N·m·s/rad], c [N·m·s²/rad²].
  //   τ_drag(ω) = −b·ω − c·ω·|ω|
  function dragTorque(omega, b, c) {
    const bb = b || 0, cc = c || 0;
    return -(bb * omega) - (cc * omega * Math.abs(omega));
  }
  // Effective damping ratio once linear drag is folded into the derivative term:
  // the plant sees (Kd + b) as its total rate feedback, so ζ rises with air.
  function dampingRatioDrag(Kp, Kd, b, J) {
    const Kpe = Math.max(Kp, 1e-9);
    return (Kd + (b || 0)) / (2 * Math.sqrt(Kpe * J));
  }
  // A steady wind-gust disturbance torque: a constant bias plus a sinusoidal
  // gust. Deterministic (no RNG) so a given (amp,freq) always flies the same.
  function windTorque(amp, freq, t) {
    if (!amp) return 0;
    return amp * (0.6 + 0.4 * Math.sin(2 * Math.PI * (freq || 0.8) * t));
  }

  // ── Sub-Calc C: complementary filter ──────────────────────────────────────
  function filterTimeConstant(alpha, dt) { return alpha < 1 ? alpha * dt / (1 - alpha) : Infinity; }
  function driftError(biasDegPerSec, alpha, dt) { return biasDegPerSec * filterTimeConstant(alpha, dt); }
  function noiseRMS(sigmaDeg, alpha) { return sigmaDeg * Math.sqrt((1 - alpha) / (1 + alpha)); }
  function fusionTotal(biasDegPerSec, sigmaDeg, alpha, dt) {
    return driftError(biasDegPerSec, alpha, dt) + noiseRMS(sigmaDeg, alpha);
  }
  function complementaryStep(prevAngle, gyroRate, accelAngle, alpha, dt) {
    return alpha * (prevAngle + gyroRate * dt) + (1 - alpha) * accelAngle;
  }
  function optimalAlpha(biasDegPerSec, sigmaDeg, dt, alphaList) {
    let best = null;
    for (const a of alphaList) {
      const t = fusionTotal(biasDegPerSec, sigmaDeg, a, dt);
      if (best === null || t < best.total) best = { alpha: a, total: t };
    }
    return best;
  }

  // ── The whole flight-control system in ONE closed loop ─────────────────────
  // This is the physically-honest architecture the separate PID / fusion tabs
  // only approximate: the controller cannot see the true attitude, only the
  // ESTIMATE from the sensor pipeline, so estimator error feeds straight back
  // into the control. Any combination of {controller gains} × {estimator} ×
  // {air resistance, wind, IMU} can be flown and scored here.
  //
  //   Plant   : J·θ̈ = u + τ_drag(θ̇) + τ_wind(t) + τ_cg
  //   Sensors : gyro = θ̇ + bias + n_g ; accel = θ + n_a (deterministic noise)
  //   Estimator (opts.estimator):
  //       'comp'  → complementary filter blend α        (the real fusion)
  //       'gyro'  → integrate gyro only  (α = 1, drifts) (accelerometer ignored)
  //       'accel' → accelerometer angle only (noisy, no gyro)
  //   Controller: PID on (cmd − θ̂), derivative on the gyro rate w/ LPF, anti-
  //       windup, torque saturation — commands u.
  // Returns the true + estimated + command traces and a full metric set.
  function closedLoopFlight(g, plant, opts) {
    const o = opts || {};
    const DEGl = 180 / Math.PI;
    const J = plant.J, tm = plant.tm, ta = plant.ta, ts = plant.ts;
    const b = plant.b || 0, c = plant.c || 0;
    const windAmp = plant.windAmp || 0, windFreq = plant.windFreq || 0.8;
    const tauCg = plant.tauCg || 0;
    const bias = (o.gyroBiasDps || 0) / DEGl;            // rad/s
    const sigmaA = (o.accelNoiseDeg || 0) / DEGl;         // rad
    const est = o.estimator || 'comp';
    const alpha = (o.alpha === undefined) ? 0.98 : o.alpha;
    const dtImu = o.dtImu || 0.0025;
    const cmd = (o.cmdDeg === undefined ? 20 : o.cmdDeg) / DEGl;
    const uMax = (o.uMax === undefined) ? 1.0 : o.uMax;
    const tauDf = (o.dFilter === undefined) ? 0.004 : o.dFilter;
    const deadband = o.deadbandRad || 0;                  // actuation offset (uncalibrated ESC)

    // integrate the plant on a fine step; run the estimator at the IMU rate
    const T = o.T || 4.0;
    const dt = o.dt || Math.min(2.5e-4, T / 6000);
    const N = Math.max(1, Math.round(T / dt));
    const stride = Math.max(1, Math.round(N / 700));

    let theta = 0, omega = 0, I = 0, dFilt = 0;
    let thetaHat = 0, gyroInt = 0, imuAccum = dtImu;
    let peak = 0, satCount = 0, effortSum = 0;
    const trueS = [], estS = [], samples = [];
    // deterministic pseudo-noise: hashed sine sum (no RNG, replayable)
    function noise(seed, k) {
      return Math.sin(seed * 12.9898 + k * 78.233) * 0.5
           + Math.sin(seed * 3.7412 + k * 21.113) * 0.3
           + Math.sin(seed * 6.1971 + k * 45.077) * 0.2;
    }
    let measRate = 0, accelAng = 0;
    for (let i = 0; i < N; i++) {
      const t = i * dt;
      // ── sensor pipeline (updated at the IMU rate) ──
      imuAccum += dt;
      if (imuAccum >= dtImu) {
        imuAccum -= dtImu;
        measRate = omega + bias;                            // gyro: true rate + constant bias
        accelAng = theta + sigmaA * noise(i * dt * 97.13, 2.0);
        gyroInt += measRate * dtImu;
        if (est === 'comp') thetaHat = alpha * (thetaHat + measRate * dtImu) + (1 - alpha) * accelAng;
        else if (est === 'gyro') thetaHat = gyroInt;
        else /* accel */ thetaHat = accelAng;
      }
      // ── controller: PID on the ESTIMATE (this is the key coupling) ──
      const e = cmd - thetaHat;
      I += e * dt;
      dFilt += dt * (measRate - dFilt) / tauDf;           // derivative on the (noisy) gyro rate
      let u = g.Kp * e + g.Ki * I - g.Kd * dFilt;
      if (u > uMax) { u = uMax; if (e > 0) I -= e * dt; }
      else if (u < -uMax) { u = -uMax; if (e < 0) I -= e * dt; }
      if (u > uMax || u < -uMax) satCount++;
      if (deadband) u += (u >= 0 ? deadband : -deadband); // uncalibrated-ESC actuation offset
      effortSum += Math.abs(u) * dt;
      // ── plant: rigid body + aero drag + wind + CG couple ──
      const tau = u + dragTorque(omega, b, c) + windTorque(windAmp, windFreq, t) + tauCg;
      omega += (tau / J) * dt;
      theta += omega * dt;
      if (theta > peak) peak = theta;
      if (i % stride === 0) samples.push({ t: t, tru: theta * DEGl, est: thetaHat * DEGl, cmd: cmd * DEGl });
    }
    // ── metrics (over the settled tail) ──
    const nTail = Math.max(1, Math.round(0.25 * samples.length));
    let sseTrue = 0, sseEst = 0, maxTrue = 0;
    for (let k = samples.length - nTail; k < samples.length; k++) {
      const s = samples[k];
      sseTrue += (s.tru - cmd * DEGl) * (s.tru - cmd * DEGl);
      sseEst += (s.tru - s.est) * (s.tru - s.est);
    }
    for (const s of samples) if (Math.abs(s.tru) > maxTrue) maxTrue = Math.abs(s.tru);
    const rmsTrackDeg = Math.sqrt(sseTrue / nTail);      // true attitude vs command (what actually matters)
    const rmsEstErrDeg = Math.sqrt(sseEst / nTail);      // estimator error (true vs estimate)
    const cmdDeg = cmd * DEGl;
    const finalTrue = samples.length ? samples[samples.length - 1].tru : 0;
    const overshootPct = (cmdDeg !== 0) ? Math.max(0, (peak * DEGl - cmdDeg) / Math.abs(cmdDeg)) * 100 : 0;
    // settling: last time |true−cmd| leaves a 2° band
    let settleT = T;
    for (let k = samples.length - 1; k >= 0; k--) { if (Math.abs(samples[k].tru - cmdDeg) > 2) { settleT = samples[k].t; break; } }
    const diverged = !isFinite(finalTrue) || Math.abs(finalTrue) > 120 || maxTrue > 160;
    return {
      samples: samples, _T: T, cmdDeg: cmdDeg, finalTrueDeg: finalTrue,
      rmsTrackDeg: rmsTrackDeg, rmsEstErrDeg: rmsEstErrDeg,
      overshootPct: overshootPct, settlingTime: settleT,
      satFraction: satCount / N, controlEffort: effortSum, diverged: diverged
    };
  }

  // Score a flown result 0–100: reward tight tracking, punish overshoot,
  // slow settling, estimator error, actuator saturation and divergence.
  function scoreFlight(r) {
    if (!r || r.diverged) return 0;
    const track = Math.max(0, 40 - r.rmsTrackDeg * 8);        // 40 pts: true attitude holds the command
    const est = Math.max(0, 20 - r.rmsEstErrDeg * 6);         // 20 pts: the estimate is honest
    const os = Math.max(0, 20 - Math.max(0, r.overshootPct - 10) * 0.6); // 20 pts: overshoot ≤ ~10%
    const settle = Math.max(0, 15 - Math.max(0, r.settlingTime - 1.0) * 8); // 15 pts: settles ≤ 1 s
    const effort = Math.max(0, 5 - r.satFraction * 25);       // 5 pts: doesn't slam the actuators
    return Math.round(Math.min(100, track + est + os + settle + effort));
  }

  return Object.freeze({
    DEG, clamp,
    rollInertia, naturalFreq, dampingRatio, overshootPct, peakTime, settlingTime, riseTime,
    disturbanceError, secondOrderStep, angleStepResponse,
    ultimateFreq, ultimatePeriod, ultimateGain, znClassic, znTyreusLuyben, rateStepResponse,
    dragTorque, dampingRatioDrag, windTorque,
    filterTimeConstant, driftError, noiseRMS, fusionTotal, complementaryStep, optimalAlpha,
    closedLoopFlight, scoreFlight
  });
})();
window.Calc = Calc;

(function () {
  'use strict';

  const fallbackDb = {
    airframes: [
      { id: 'toothpick_3in', label: '3" Toothpick', mass_g: 180, arm_length_mm: 66, J_roll_kgm2: 0.000392, tau_m_s: 0.028, tau_a_s: 0.012, tau_s_s: 0.004 },
      { id: 'freestyle_5in', label: '5" Freestyle (reference)', mass_g: 500, arm_length_mm: 110, J_roll_kgm2: 0.003, tau_m_s: 0.05, tau_a_s: 0.02, tau_s_s: 0.005, default: true },
      { id: 'cinematic_7in', label: '7" Cinematic', mass_g: 900, arm_length_mm: 160, J_roll_kgm2: 0.01152, tau_m_s: 0.08, tau_a_s: 0.03, tau_s_s: 0.006 },
      { id: 'heavylift_10in', label: '10" Heavy-Lift', mass_g: 1800, arm_length_mm: 230, J_roll_kgm2: 0.04761, tau_m_s: 0.12, tau_a_s: 0.045, tau_s_s: 0.008 }
    ],
    imu_presets: [
      { id: 'mpu6000', label: 'MPU-6000 (reference)', gyro_bias_dps: 0.6, accel_noise_deg: 1.8, sample_rate_hz: 400, dt_s: 0.0025, default: true },
      { id: 'icm20602', label: 'ICM-20602 (low-noise)', gyro_bias_dps: 0.4, accel_noise_deg: 1.4, sample_rate_hz: 1000, dt_s: 0.001 },
      { id: 'bmi270', label: 'BMI270 (modern)', gyro_bias_dps: 0.3, accel_noise_deg: 1.2, sample_rate_hz: 800, dt_s: 0.00125 },
      { id: 'mpu9250', label: 'MPU-9250 (legacy)', gyro_bias_dps: 0.8, accel_noise_deg: 2.0, sample_rate_hz: 500, dt_s: 0.002 }
    ],
    pid: { defaults: { Kp: 0.6, Ki: 0.0, Kd: 0.04 }, derivative_filter_tau_s: 0.004, setpoint_deg: 20 },
    ziegler_nichols: { tables: { classic: {}, tyreus_luyben: {} } },
    complementary_filter: { alpha_test_set: [0.90, 0.95, 0.98, 0.99], alpha_default: 0.98 },
    disturbance: { torque_nm_default: 0.0175, cg_offset_mm_default: 3.57 },
    targets: { overshoot_max_pct: 25, ess_target_deg: 0 },
    constants: { g_m_s2: 9.80665 }
  };

  // Single source of truth: the bundled VLAB_CATALOG (shared motors/props/frames/
  // materials/imu_presets) is preferred over db/db.json — same pattern as exp1/2/4's
  // Calc.loadCatalog(), fixes the dual-catalog-source-drift bug class. The
  // control-loop-only blocks below (airframe J/tau, PID/ZN tables, complementary
  // filter, disturbance, targets, constants) live ONLY in this experiment's
  // db.json/fallbackDb, never in the shared catalog, so they're merged on
  // afterward regardless of which source won.
  function loadCatalog() {
    function withLocal(db) {
      db.airframes = db.airframes || fallbackDb.airframes;
      db.inertia_model = db.inertia_model || fallbackDb.inertia_model;
      db.plant = db.plant || fallbackDb.plant;
      db.pid = db.pid || fallbackDb.pid;
      db.ziegler_nichols = db.ziegler_nichols || fallbackDb.ziegler_nichols;
      db.complementary_filter = db.complementary_filter || fallbackDb.complementary_filter;
      db.disturbance = db.disturbance || fallbackDb.disturbance;
      db.targets = db.targets || fallbackDb.targets;
      db.constants = db.constants || fallbackDb.constants;
      if (!db.imu_presets) db.imu_presets = fallbackDb.imu_presets;
      return db;
    }
    if (typeof window !== 'undefined' && window.VLAB_CATALOG) {
      return Promise.resolve(withLocal(JSON.parse(JSON.stringify(window.VLAB_CATALOG))));
    }
    return fetch('db/db.json').then((r) => {
      if (!r.ok) throw new Error('DB load error: ' + r.status);
      return r.json();
    }).then(withLocal);
  }

  const $ = (id) => document.getElementById(id);
  const on = (id, evt, fn) => { const el = $(id); if (el) el.addEventListener(evt, fn); };
  const setText = (id, t) => { const el = $(id); if (el) el.innerHTML = t; };
  const setVal = (id, v) => { const el = $(id); if (el) el.value = v; };
  const byId = (list, id) => list.find((x) => x.id === id) || list[0];
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const readJSON = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const clampNum = (v, lo, hi, fb) => { const n = parseFloat(v); return isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fb; };

  // Shared viewport preference so the SAME drone (with the same prop blade count)
  // is shown consistently across both Module pages and the other experiments.
  const readBlades = () => { try { const v = parseInt(localStorage.getItem('vlab:viz:blades'), 10); return (v === 3 || v === 4) ? v : 2; } catch (e) { return 2; } };
  const writeBlades = (n) => { try { localStorage.setItem('vlab:viz:blades', String(n)); } catch (e) { /* storage unavailable */ } };

  const LS = {
    session: 'vlabExp5_session',
    Kp: 'vlabExp5_Kp', Ki: 'vlabExp5_Ki', Kd: 'vlabExp5_Kd',
    overshoot: 'vlabExp5_overshoot', settling: 'vlabExp5_settlingTime',
    alpha: 'vlabExp5_alpha', attitudeError: 'vlabExp5_attitudeError'
  };

  let initialMode = (document.body && document.body.dataset.start) ? document.body.dataset.start : 'pidstep';

  const state = {
    mode: initialMode,
    db: fallbackDb,
    done: { pidstep: false, ziegler: false, fusion: false, combined: false },
    scenario: 'none',          // injected fault scenario (session-only, never persisted)
    airframe: null, imu: null,
    Kp: 0.6, Ki: 0.0, Kd: 0.04,
    tuning: 'manual',          // manual | classic | tyreus
    znGain: 8.0,               // swept proportional gain for the Z-N ultimate test
    alpha: 0.98,
    disturbance: false,
    noise: true,
    Td: 0.0175,
    setpoint: 20,              // user-commanded roll angle (deg) — set via the Roll Command slider
    propBlades: 2,             // user-selectable propeller blade count (2/3/4) for the 3-D model
    // air resistance & wind (real plant physics — Tabs 2 & 4)
    airPct: 30,                // 0..100 "air resistance" knob -> drag coefficients
    windAmp: 0,                // wind-gust torque amplitude (N·m)
    // Tab 4 (Full System) selection
    controller: 'manual',      // manual | classic | tyreus  (which gain source flies)
    estimator: 'comp',         // comp | gyro | accel        (which attitude estimate feeds the loop)
    combinedResp: null,        // cached closed-loop flight (combined mode)
    leaderboard: [],           // scored [{name, ctrl, est, score, diverged}] all 9 combos
    bestCombo: null,
    deadbandUs: 0, escCalibrated: true,   // from Exp 4 (uncalibrated -> actuation offset fault)
    inheritedJ: false, inheritedTd: false, airframeUserSet: false,
    // animation
    phase: 0, lastTime: null, playT: 0,
    respT0: 0, rollFrom: 0, lastRoll: 0,   // step transient: from rollFrom (at respT0) toward setpoint
    znResp: null,              // cached rate-loop step response (ziegler mode)
    pidResp: null,             // cached angle-loop PID step response (pidstep mode)
    _pidSample: null,          // current pidstep sample {p,i,d} for the live PID-term panel
    _clSample: null,           // current combined-mode {tru,est} for the 3-D true/ghost pair
    // fusion live sim
    fuse: { t: 0, trueAng: 0, gyroAngle: 0, fused: 0, hist: [] }
  };

  // ── air-resistance model: map the 0..100 knob onto physical drag coeffs ─────
  // b (linear, N·m·s/rad) and c (quadratic, N·m·s²/rad²) scale with the knob and
  // with the airframe size (bigger disc area & arm -> more aero damping). The
  // reference 5" build at 30% lands near b≈0.02 — enough to visibly calm the ring
  // without swamping the gains. Real ISA density (via the shared constants) sets
  // the ceiling so altitude and this knob act through one physical channel.
  function dragCoeffs() {
    const a = state.airframe || {};
    const arm = (a.arm_length_mm ? a.arm_length_mm / 1000 : 0.11);
    const rho = (window.VLAB_CONST && window.VLAB_CONST.airDensity) ? window.VLAB_CONST.airDensity(0) : 1.225;
    const size = Math.pow(arm / 0.11, 3);                 // ∝ arm³ (blade area × moment arm)
    const k = state.airPct / 100;
    const b = 0.0667 * k * size * (rho / 1.225);          // 30% on the 5" ref -> b≈0.02
    const c = 0.30 * b;                                   // quadratic term ~30% of linear at unit rate
    return { b: b, c: c };
  }

  // ── connections to upstream experiments ────────────────────────────────────
  function inheritFromExp2() {
    // Prefer the unified store's finalized Exp 2 slice (canonical); fall back to
    // the legacy vlabModule2_final key. Exp 2 stores mass as total_mass_g.
    let m2 = null;
    try { if (window.VLABStore) m2 = window.VLABStore.upstream('exp2'); } catch (e) { /* store optional */ }
    if (!m2) m2 = readJSON('vlabModule2_final');
    if (!m2) return;
    const massG = (typeof m2.total_mass_g === 'number') ? m2.total_mass_g : m2.mass_g;
    if (typeof massG === 'number' && typeof m2.arm_length_mm === 'number' && state.airframe) {
      const J = Calc.rollInertia(massG / 1000, m2.arm_length_mm / 1000);
      if (isFinite(J) && J > 0) {
        state.airframe = Object.assign({}, state.airframe, { J_roll_kgm2: J, mass_g: massG, arm_length_mm: m2.arm_length_mm, _inherited: true });
        state.inheritedJ = true;
      }
    }
    if (typeof m2.cg_offset_mm === 'number') {
      const m = (massG ? massG / 1000 : 0.5);
      state.Td = m * state.db.constants.g_m_s2 * (m2.cg_offset_mm / 1000);
      state.inheritedTd = true;
    }
  }

  // Exp 4 programs the ESC dead-band into the flight controller here (PDF §5.8).
  // A calibrated ESC just echoes the number; an UNCALIBRATED one leaves an
  // actuation offset the integral term must trim out (the Full-System fault).
  function inheritFromExp4() {
    let e4 = null;
    try { if (window.VLABStore) e4 = window.VLABStore.upstream('exp4'); } catch (e) { /* store optional */ }
    if (!e4) return;
    if (typeof e4.pwm_deadband_us === 'number') state.deadbandUs = e4.pwm_deadband_us;
    if (typeof e4.calibrated === 'boolean') state.escCalibrated = e4.calibrated;
  }

  function restoreSession() {
    const s = readJSON(LS.session);
    if (!s || typeof s !== 'object') return;
    // Only override the Exp2-inherited inertia if the user EXPLICITLY picked an airframe;
    // otherwise keep the freshly inherited airframe so a refresh tracks the latest Exp2 build.
    if (s.airframeUserSet) {
      const a = byId(state.db.airframes, s.airframeId);
      if (a && a.id === s.airframeId) { state.airframe = a; state.inheritedJ = false; state.airframeUserSet = true; }
    }
    const im = byId(state.db.imu_presets, s.imuId); if (im && im.id === s.imuId) state.imu = im;
    state.Kp = clampNum(s.Kp, 0, 2, state.Kp);
    state.Ki = clampNum(s.Ki, 0, 1, state.Ki);
    state.Kd = clampNum(s.Kd, 0, 0.12, state.Kd);
    state.alpha = clampNum(s.alpha, 0.5, 0.999, state.alpha);
    state.znGain = clampNum(s.znGain, 0, 60, state.znGain);
    state.setpoint = clampNum(s.setpoint, -45, 45, state.setpoint);
    if (['manual', 'classic', 'tyreus'].indexOf(s.tuning) >= 0) state.tuning = s.tuning;
    if (typeof s.disturbance === 'boolean') state.disturbance = s.disturbance;
    if (typeof s.noise === 'boolean') state.noise = s.noise;
    state.airPct = clampNum(s.airPct, 0, 100, state.airPct);
    state.windAmp = clampNum(s.windAmp, 0, 0.05, state.windAmp);
    if (['manual', 'classic', 'tyreus'].indexOf(s.controller) >= 0) state.controller = s.controller;
    if (['comp', 'gyro', 'accel'].indexOf(s.estimator) >= 0) state.estimator = s.estimator;
    if (s.done && typeof s.done === 'object') {
      state.done.pidstep = !!s.done.pidstep;
      state.done.ziegler = !!s.done.ziegler;
      state.done.fusion = !!s.done.fusion;
      state.done.combined = !!s.done.combined;
    }
  }

  let _lastPersist = '', _lastPersistAt = -1e9;
  function persist() {
    try {
      const payload = {
        airframeId: state.airframe && state.airframe.id, imuId: state.imu && state.imu.id,
        airframeUserSet: state.airframeUserSet,
        Kp: +state.Kp.toFixed(3), Ki: +state.Ki.toFixed(3), Kd: +state.Kd.toFixed(4),
        tuning: state.tuning, znGain: +state.znGain.toFixed(2), alpha: +state.alpha.toFixed(3),
        disturbance: state.disturbance, noise: state.noise,
        setpoint: +state.setpoint.toFixed(1),
        airPct: state.airPct, windAmp: +state.windAmp.toFixed(3),
        controller: state.controller, estimator: state.estimator,
        done: { pidstep: !!state.done.pidstep, ziegler: !!state.done.ziegler, fusion: !!state.done.fusion, combined: !!state.done.combined }
      };
      const str = JSON.stringify(payload);
      const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      if (str === _lastPersist || now - _lastPersistAt < 350) return;
      _lastPersist = str; _lastPersistAt = now;
      localStorage.setItem(LS.session, str);
      // Computed handoff for downstream / refresh. The headline PD metrics use the
      // closed-form 2nd-order prototype (which the Ki=0 / no-disturbance simulated
      // scope collapses onto), so the persisted numbers match the textbook formulas.
      const J = state.airframe.J_roll_kgm2;
      const wn = Calc.naturalFreq(state.Kp, J), zeta = Calc.dampingRatio(state.Kp, state.Kd, J);
      const osPct = Calc.overshootPct(zeta), tSettle = Calc.settlingTime(wn, zeta);
      const tRise = Calc.riseTime(wn, zeta);
      const zn = znValues();
      const essDeg = state.disturbance ? Math.abs(Calc.disturbanceError(state.Td, state.Kp) * Calc.DEG) : 0;
      const im = state.imu;
      const attErr = Calc.fusionTotal(im.gyro_bias_dps, im.accel_noise_deg, state.alpha, im.dt_s);
      localStorage.setItem(LS.Kp, state.Kp.toFixed(3));
      localStorage.setItem(LS.Ki, state.Ki.toFixed(3));
      localStorage.setItem(LS.Kd, state.Kd.toFixed(4));
      localStorage.setItem(LS.overshoot, osPct.toFixed(2));
      localStorage.setItem(LS.settling, tSettle.toFixed(3));
      localStorage.setItem(LS.alpha, state.alpha.toFixed(3));
      localStorage.setItem(LS.attitudeError, attErr.toFixed(3));

      // Publish the flight-control tuning result to the unified store (Exp 5 slice).
      if (window.VLABStore) {
        window.VLABStore.finalize('exp5', {
          Kp: +state.Kp.toFixed(3), Ki: +state.Ki.toFixed(3), Kd: +state.Kd.toFixed(4),
          tuning: state.tuning, alpha: +state.alpha.toFixed(3),
          overshoot_pct: +osPct.toFixed(2),
          settling_time_s: +tSettle.toFixed(3),
          attitude_error_deg: +attErr.toFixed(3),
          J_roll_kgm2: J,
          Ku: +zn.Ku.toFixed(3), Pu: +zn.Pu.toFixed(5),           // discovered ultimate point (audit trail for Exp 11)
          rise_time_s: isFinite(tRise) ? +tRise.toFixed(3) : null, // complete the §5.5 metric set
          ess_deg: +essDeg.toFixed(3),
          imu_preset_id: im.id,                                    // which IMU the α was tuned for
          deadband_applied_us: state.deadbandUs || 0               // echo of the Exp 4 value programmed in
        });
      }
    } catch (e) { /* storage unavailable */ }
  }

  // ── boot ────────────────────────────────────────────────────────────────────
  function appInit() {
    if (!$('benchCanvas')) return;
    loadCatalog().then((db) => { state.db = db; boot(); }).catch(() => boot());
  }

  function boot() {
    state.airframe = state.db.airframes.find((a) => a.default) || state.db.airframes[1] || state.db.airframes[0];
    state.imu = state.db.imu_presets.find((p) => p.default) || state.db.imu_presets[0];
    const pd = state.db.pid && state.db.pid.defaults; if (pd) { state.Kp = pd.Kp; state.Ki = pd.Ki; state.Kd = pd.Kd; }
    if (state.db.pid && typeof state.db.pid.setpoint_deg === 'number') state.setpoint = state.db.pid.setpoint_deg;
    if (state.db.disturbance) state.Td = state.db.disturbance.torque_nm_default;

    inheritFromExp2();     // J + disturbance torque from the Experiment-2 build
    inheritFromExp4();     // ESC dead-band + calibration state programmed into the FC
    restoreSession();      // a saved Exp5 session (refresh / re-login) overrides
    state.propBlades = readBlades();   // shared drone blade-count preference (2/3/4)

    if (document.body) document.body.dataset.mode = state.mode;   // initial .cfg-<mode> visibility
    hydrateControls();
    bindControls();
    initScene3D();
    resizeCanvases();
    recompute();
    updateAll();
    announceTab();
    requestAnimationFrame(loop);
  }

  function hydrateControls() {
    const af = $('airframeSelect');
    if (af) af.innerHTML = state.db.airframes.map((a) => `<option value="${esc(a.id)}"${a.id === state.airframe.id ? ' selected' : ''}>${esc(a.label)}</option>`).join('');
    const iu = $('imuSelect');
    if (iu) iu.innerHTML = state.db.imu_presets.map((p) => `<option value="${esc(p.id)}"${p.id === state.imu.id ? ' selected' : ''}>${esc(p.label)}</option>`).join('');
    const tu = $('tuningSelect'); if (tu) tu.value = state.tuning;
    setVal('rollSlider', state.setpoint); setText('rollOut', state.setpoint.toFixed(0) + '\u00B0');
    setVal('kpSlider', state.Kp); setText('kpOut', state.Kp.toFixed(2));
    setVal('kiSlider', state.Ki); setText('kiOut', state.Ki.toFixed(2));
    setVal('kdSlider', state.Kd); setText('kdOut', state.Kd.toFixed(3));
    setVal('alphaSlider', state.alpha); setText('alphaOut', state.alpha.toFixed(3));
    setVal('znSlider', state.znGain); setText('znOut', state.znGain.toFixed(1));
    setVal('airSlider', state.airPct); setText('airOut', state.airPct.toFixed(0) + '%');
    setVal('windSlider', state.windAmp); setText('windOut', state.windAmp.toFixed(3) + ' N·m');
    const dt = $('disturbanceToggle'); if (dt) dt.checked = state.disturbance;
    const nt = $('noiseToggle'); if (nt) nt.checked = state.noise;
    syncBladeButtons();
    syncSegButtons();
    syncAirframeSource();
    syncTabs();
  }

  // reflect Tab-4 controller/estimator choice on the segmented selectors
  function syncSegButtons() {
    document.querySelectorAll('#controllerSeg .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.controller === state.controller));
    document.querySelectorAll('#estimatorSeg .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.estimator === state.estimator));
  }

  // note under the airframe select: where J came from (Exp 2 inherited vs preset)
  function syncAirframeSource() {
    const a = state.airframe; if (!a) return;
    setText('airframeSource', state.inheritedJ
      ? `J = ${a.J_roll_kgm2.toFixed(5)} kg·m² — inherited from Exp 2 (mass ${a.mass_g} g, arm ${a.arm_length_mm} mm).`
      : `J = ${a.J_roll_kgm2.toFixed(5)} kg·m² — preset airframe (not inherited).`);
  }

  // reflect the active propeller blade count on the segmented selector
  function syncBladeButtons() {
    document.querySelectorAll('.blade-btn').forEach((b) => b.classList.toggle('active', +b.dataset.blades === state.propBlades));
  }

  // Re-baseline the roll transient: the response now plays out from the drone's
  // current angle (rollFrom) at the current time (respT0) toward the commanded
  // setpoint. fromZero=true forces a clean step from level (the "Apply Step" demo).
  function restartResponse(fromZero) {
    state.rollFrom = fromZero ? 0 : state.lastRoll;
    state.respT0 = state.playT;
  }

  function bindControls() {
    on('airframeSelect', 'change', (e) => {
      const a = byId(state.db.airframes, e.target.value);
      state.airframe = a; state.inheritedJ = false; state.airframeUserSet = true; recompute(); updateAll();
    });
    on('imuSelect', 'change', (e) => { state.imu = byId(state.db.imu_presets, e.target.value); recompute(); updateAll(); });
    on('tuningSelect', 'change', (e) => { state.tuning = e.target.value; restartResponse(false); recompute(); updateAll(); });
    on('rollSlider', 'input', (e) => { state.setpoint = +e.target.value; setText('rollOut', state.setpoint.toFixed(0) + '\u00B0'); recompute(); updateAll(); });
    on('kpSlider', 'input', (e) => { state.Kp = +e.target.value; setText('kpOut', state.Kp.toFixed(2)); recompute(); updateAll(); });
    on('kiSlider', 'input', (e) => { state.Ki = +e.target.value; setText('kiOut', state.Ki.toFixed(2)); recompute(); updateAll(); });
    on('kdSlider', 'input', (e) => { state.Kd = +e.target.value; setText('kdOut', state.Kd.toFixed(3)); recompute(); updateAll(); });
    on('alphaSlider', 'input', (e) => { state.alpha = Math.min(0.999, +e.target.value); setText('alphaOut', state.alpha.toFixed(3)); updateAll(); });
    on('znSlider', 'input', (e) => { const ku = znValues().Ku; let v = +e.target.value; if (ku > 0 && v > ku) { v = ku; setVal('znSlider', v); } state.znGain = v; setText('znOut', state.znGain.toFixed(1)); state.tuning = 'manual'; const tu = $('tuningSelect'); if (tu) tu.value = 'manual'; restartResponse(false); recompute(); updateAll(); });
    on('disturbanceToggle', 'change', (e) => { state.disturbance = e.target.checked; recompute(); updateAll(); });
    on('noiseToggle', 'change', (e) => { state.noise = e.target.checked; updateAll(); });
    on('airSlider', 'input', (e) => { state.airPct = +e.target.value; setText('airOut', state.airPct.toFixed(0) + '%'); restartResponse(false); recompute(); updateAll(); });
    on('windSlider', 'input', (e) => { state.windAmp = +e.target.value; setText('windOut', state.windAmp.toFixed(3) + ' N·m'); restartResponse(false); recompute(); updateAll(); });
    document.querySelectorAll('#controllerSeg .seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => { state.controller = btn.dataset.controller; syncSegButtons(); if (window.SFX) window.SFX.click(); restartResponse(true); recompute(); updateAll(); });
    });
    document.querySelectorAll('#estimatorSeg .seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => { state.estimator = btn.dataset.estimator; syncSegButtons(); if (window.SFX) window.SFX.click(); restartResponse(true); recompute(); updateAll(); });
    });
    on('stepBtn', 'click', () => { if (window.SFX) { window.SFX.start(); window.SFX.motor(true); } restartResponse(true); state.fuse = { t: 0, trueAng: 0, gyroAngle: 0, fused: 0, hist: [] }; updateAll(); });
    on('autotuneBtn', 'click', () => { if (window.SFX) { window.SFX.start(); window.SFX.motor(true); } state.tuning = (state.tuning === 'classic') ? 'tyreus' : 'classic'; const tu = $('tuningSelect'); if (tu) tu.value = state.tuning; restartResponse(false); recompute(); updateAll(); });
    on('resetBtn', 'click', () => {
      if (window.SFX) window.SFX.motor(false);
      const pd = state.db.pid.defaults; state.Kp = pd.Kp; state.Ki = pd.Ki; state.Kd = pd.Kd;
      state.tuning = 'manual'; state.alpha = state.db.complementary_filter.alpha_default || 0.98;
      state.setpoint = (state.db.pid && state.db.pid.setpoint_deg) || 20;
      state.fuse = { t: 0, trueAng: 0, gyroAngle: 0, fused: 0, hist: [] };
      restartResponse(true);
      hydrateControls(); recompute(); updateAll();
    });
    document.querySelectorAll('.vp-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.mode === state.mode) return;
        state.mode = btn.dataset.mode; state.playT = 0;
        state.fuse = { t: 0, trueAng: 0, gyroAngle: 0, fused: 0, hist: [] };
        if (window.SFX) { window.SFX.click(); window.SFX.start(); window.SFX.motor(true); }
        restartResponse(true); syncTabs(); recompute(); updateAll();
        announceTab();
      });
    });
    document.querySelectorAll('.blade-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const n = Math.max(2, Math.min(4, parseInt(btn.dataset.blades, 10) || 2));
        if (n === state.propBlades) return;
        state.propBlades = n; writeBlades(n); syncBladeButtons(); rebuildQuad();
      });
    });
    window.addEventListener('resize', resizeCanvases);
  }

  function syncTabs() {
    document.querySelectorAll('.vp-tab').forEach((b) => b.classList.toggle('active', b.dataset.mode === state.mode));
    if (document.body) document.body.dataset.mode = state.mode;   // drives .cfg-<mode> visibility
    const titles = {
      pidstep: ['Roll Angle Step Response', 'theta(t) — second-order roll loop'],
      ziegler: ['Rate-Loop Tuning Response', 'omega(t) — three-lag inner loop, air-damped'],
      fusion: ['Attitude Estimate Fusion', 'theta-hat(t) — fused vs gyro vs accel'],
      combined: ['Closed-Loop Flight', 'true vs estimated attitude — controller flies the estimate']
    };
    const t = titles[state.mode] || titles.pidstep;
    setText('primaryChartTitle', t[0]); setText('primaryChartTag', t[1]);
    const notes = {
      pidstep: 'Apply a step and read the overshoot and settling time from the live response.',
      ziegler: 'Set the target, air resistance and wind, then auto-tune — Z-N sizes the gains from the plant itself.',
      fusion: 'Sweep the blend coefficient and watch the fused estimate track the true attitude past drift and noise.',
      combined: 'Pick a controller and an estimator, fly the closed loop, and read the leaderboard for the best system.'
    };
    setText('simControlsNote', notes[state.mode] || notes.pidstep);
    const headers = { combined: 'Flight Result', fusion: 'Fusion Summary', ziegler: 'Tuning Summary' };
    setText('summaryHeader', headers[state.mode] || 'Response Summary');
    setText('analysisHeader', state.mode === 'combined' ? 'System Analysis' : 'Loop Analysis');
    syncCalcLabels();
  }

  // mode-aware worksheet labels for the three numbered derivation steps
  function syncCalcLabels() {
    const sets = {
      pidstep: [
        ['Natural Frequency & Damping', 'Second-order roll loop on the 1/(J s²) inertia plant.', 'wn = sqrt(Kp / J)   ·   z = Kd / (2 sqrt(Kp J))'],
        ['Transient Metrics', 'Overshoot and 2% settling time follow from the damping ratio.', 'Mp = exp(-pi z / sqrt(1 - z²)),  ts = 4 / (z wn)'],
        ['Disturbance Rejection', 'Steady tilt under a CG-offset torque; integral action nulls it.', 'e_ss = Td / Kp']
      ],
      ziegler: [
        ['Ultimate Gain', 'Proportional gain at which the three-lag rate loop sustains oscillation.', 'Ku = [(tm.ta + tm.ts + ta.ts)(tm+ta+ts)/(tm.ta.ts) - 1]'],
        ['Ultimate Period', 'Period of the marginal oscillation at the stability limit Ku.', 'Pu = 2 pi / sqrt((tm+ta+ts)/(tm.ta.ts))'],
        ['Tuned PID Gains', 'The Z-N / Tyreus-Luyben table maps (Ku, Pu) onto the gains.', 'Kp = 0.6 Ku,  Ti = 0.5 Pu,  Td = 0.125 Pu']
      ],
      fusion: [
        ['Filter Time Constant', 'Crossover set by the blend coefficient a and the sample period dt.', 'tau_f = a . dt / (1 - a)'],
        ['Drift vs Noise', 'Gyro bias integrates to drift; accelerometer noise leaks through.', 'drift = bias . tau_f,  noise = s sqrt((1-a)/(1+a))'],
        ['Total Error & Optimum', 'Sum of both error sources; minimised at the optimal blend a*.', 'total = drift + noise  ->  min at a*']
      ],
      combined: [
        ['Closed-Loop Plant', 'One loop: rigid body + aero drag + wind, with the CG couple.', 'J.theta.. = u + tau_drag(theta.) + tau_wind(t) + tau_cg'],
        ['Controller on the Estimate', 'The PID never sees truth — it acts on the fused/sensed attitude.', 'u = Kp.e + Ki.integral(e) + Kd.rate,  e = cmd - theta_hat'],
        ['System Score', 'Tracking, overshoot, settling, estimator error & saturation combined.', 'score = f(track RMS, OS, ts, est err, sat)  -> best combo']
      ]
    };
    const set = sets[state.mode] || sets.pidstep;
    set.forEach((s, i) => { setText('calcTitle' + (i + 1), esc(s[0])); setText('calcDesc' + (i + 1), esc(s[1])); setText('calcForm' + (i + 1), esc(s[2])); });
  }

  // headline result cards (mode-aware). items: [[title, value, cls?], ...] up to 4; 4th drives the margin verdict.
  function setCards(items) {
    items.forEach((it, i) => { setText('cardT' + (i + 1), esc(it[0])); setText('cardV' + (i + 1), it[1]); });
    const v = $('card4');
    if (v && items[3]) v.className = 'summary-card margin-card ' + (items[3][2] || '');
  }

  // ── effective gains & recompute caches ──────────────────────────────────────
  function lags() { const a = state.airframe; return { tm: a.tau_m_s, ta: a.tau_a_s, ts: a.tau_s_s }; }
  function znValues() {
    const l = lags();
    const Ku = Calc.ultimateGain(l.tm, l.ta, l.ts), Pu = Calc.ultimatePeriod(l.tm, l.ta, l.ts), wu = Calc.ultimateFreq(l.tm, l.ta, l.ts);
    return { Ku: Ku, Pu: Pu, wu: wu };
  }
  function effectiveRateGains() {
    const zn = znValues();
    if (state.tuning === 'classic') return Calc.znClassic(zn.Ku, zn.Pu);
    if (state.tuning === 'tyreus') return Calc.znTyreusLuyben(zn.Ku, zn.Pu);
    return { Kp: Math.min(state.znGain, zn.Ku), Ki: 0, Kd: 0, Ti: Infinity, Td: 0 };   // manual proportional sweep, capped at Ku (beyond Ku the loop is unstable)
  }
  // the effective angle-loop PID gains that FLY on the combined tab, per the
  // chosen controller. ZN gains are computed on the rate loop then scaled into
  // the angle-loop range so all three controllers are comparable on one plant.
  function angleGainsFor(controller) {
    if (controller === 'classic') return { Kp: 1.35, Ki: 0.55, Kd: 0.058 };   // fast/aggressive analogue of classic Z-N
    if (controller === 'tyreus') return { Kp: 0.95, Ki: 0.26, Kd: 0.070 };    // robust analogue of Tyreus–Luyben
    return { Kp: state.Kp, Ki: state.Ki, Kd: state.Kd };                       // manual: the Tab-1 gains
  }
  // assemble the closed-loop plant + sensor options for the combined tab
  function combinedPlant() {
    const a = state.airframe, d = dragCoeffs();
    const tauCg = state.disturbance ? (state.setpoint >= 0 ? -1 : 1) * state.Td : 0;
    return { J: a.J_roll_kgm2, tm: a.tau_m_s, ta: a.tau_a_s, ts: a.tau_s_s, b: d.b, c: d.c, windAmp: state.windAmp, windFreq: 0.8, tauCg: tauCg };
  }
  function combinedOpts(estimator, controller) {
    const im = state.imu;
    return {
      estimator: estimator, alpha: state.alpha, cmdDeg: state.setpoint,
      gyroBiasDps: im.gyro_bias_dps, accelNoiseDeg: state.noise ? im.accel_noise_deg : 0,
      dtImu: im.dt_s, T: 4.0,
      deadbandRad: (!state.escCalibrated && state.deadbandUs) ? (state.deadbandUs / 1000 * 0.02) : 0
    };
  }
  function recompute() {
    state.znResp = null; state.pidResp = null; state.combinedResp = null;
    if (state.mode === 'ziegler') {
      const l = lags(), g = effectiveRateGains();
      const zn = znValues();
      const T = Math.max(0.4, 12 * zn.Pu);
      // fold linear aero drag into the rate loop's derivative feedback so air
      // resistance visibly damps the sweep (higher air -> calmer oscillation)
      const g2 = { Kp: g.Kp, Ki: g.Ki, Kd: g.Kd + dragCoeffs().b };
      state.znResp = Calc.rateStepResponse(g2.Kp, g2.Ki, g2.Kd, l.tm, l.ta, l.ts, { dt: Math.min(5e-5, zn.Pu / 200), T: T });
      state.znResp._T = T;
    } else if (state.mode === 'pidstep') {
      // the real closed-loop PID step the drone & scope fly — every gain (incl. Ki) shapes it
      state.pidResp = Calc.angleStepResponse(state.Kp, state.Ki, state.Kd, state.airframe.J_roll_kgm2, {
        theta0Deg: 0, cmdDeg: state.setpoint,
        Td: state.disturbance ? state.Td : 0,
        distDir: state.setpoint >= 0 ? -1 : 1            // CG couple droops the held attitude toward level
      });
    } else if (state.mode === 'combined') {
      const g = angleGainsFor(state.controller);
      state.combinedResp = Calc.closedLoopFlight(g, combinedPlant(), combinedOpts(state.estimator, state.controller));
      computeLeaderboard();
    }
  }

  // Fly every controller × estimator combination against the current conditions
  // and rank them. This is Tab 4's "all combinations" — the winner is the best
  // flight control system for this airframe, air resistance and IMU.
  function computeLeaderboard() {
    const plant = combinedPlant();
    const ctrls = [['manual', 'Manual PID'], ['classic', 'ZN-Classic'], ['tyreus', 'ZN-Tyreus']];
    const ests = [['comp', 'Complementary α'], ['gyro', 'Gyro-only'], ['accel', 'Accel-only']];
    const rows = [];
    ctrls.forEach((c) => ests.forEach((e) => {
      const r = Calc.closedLoopFlight(angleGainsFor(c[0]), plant, combinedOpts(e[0], c[0]));
      rows.push({ ctrl: c[0], est: e[0], name: c[1] + ' × ' + e[1], score: Calc.scoreFlight(r), diverged: r.diverged, track: r.rmsTrackDeg });
    }));
    rows.sort((a, b) => b.score - a.score);
    state.leaderboard = rows;
    state.bestCombo = rows[0];
  }

  // ── per-mode DOM update ─────────────────────────────────────────────────────
  function rows(list) { return list.map((r) => `<div class="metric"><span>${esc(r[0])}</span><strong>${r[1]}</strong></div>`).join(''); }
  function probes(list) { return list.map((r) => `<div class="probe ${r[2] || ''}"><span>${esc(r[0])}</span><strong>${r[1]}</strong></div>`).join(''); }

  function updateAll() {
    if (state.mode === 'fusion') updateFusion();
    else if (state.mode === 'ziegler') updateZiegler();
    else if (state.mode === 'combined') updateCombined();
    else updatePid();
    renderScenario();
    persist();
  }

  function updatePid() {
    const J = state.airframe.J_roll_kgm2;
    const wn = Calc.naturalFreq(state.Kp, J), zeta = Calc.dampingRatio(state.Kp, state.Kd, J);
    const osA = Calc.overshootPct(zeta), tr = Calc.riseTime(wn, zeta), tsA = Calc.settlingTime(wn, zeta);   // analytic PD backbone
    // the response the drone & scope actually fly — full PID incl. integral + disturbance
    const r = state.pidResp || Calc.angleStepResponse(state.Kp, state.Ki, state.Kd, J, {
      cmdDeg: state.setpoint, Td: state.disturbance ? state.Td : 0, distDir: state.setpoint >= 0 ? -1 : 1
    });
    const os = r.osPct, ts = r.settlingTime, tp = r.peakTime, essDeg = r.essDeg, essMag = Math.abs(essDeg);
    const essOpen = Calc.disturbanceError(state.disturbance ? state.Td : 0, state.Kp) * Calc.DEG;   // PD-only droop
    const over = os > (state.db.targets.overshoot_max_pct || 25);
    const nulled = state.disturbance && state.Ki > 0 && essMag < 0.5;

    setText('benchHud', [
      ['Setpoint', state.setpoint.toFixed(0) + ' deg'],
      ['Damping z', zeta.toFixed(3)],
      ['Overshoot', os.toFixed(1) + ' %'],
      ['Settling', isFinite(ts) ? ts.toFixed(2) + ' s' : '--']
    ].map((rw) => `<div><span>${rw[0]}</span><strong>${rw[1]}</strong></div>`).join(''));

    setText('metricList', rows([
      ['Moment of inertia J', J.toFixed(5) + ' kg.m2'],
      ['Natural freq wn', wn.toFixed(2) + ' rad/s'],
      ['Damping ratio z', zeta.toFixed(3)],
      ['Overshoot Mp', os.toFixed(2) + ' %'],
      ['Rise time tr', isFinite(tr) ? tr.toFixed(3) + ' s' : '--'],
      ['Settling ts (2%)', isFinite(ts) ? ts.toFixed(3) + ' s' : '--']
    ]));
    setText('probeList', probes([
      ['Peak time tp', (isFinite(tp) && tp > 0) ? tp.toFixed(3) + ' s' : '--', ''],
      ['Disturbance Td', state.disturbance ? state.Td.toFixed(4) + ' N.m' : 'off', ''],
      ['Steady-state err', essMag.toFixed(2) + ' deg', nulled ? 'cool' : (essMag > 2 ? 'warm' : '')],
      ['Integral action', state.Ki > 0 ? 'ON -> nulls e_ss' : 'OFF', state.Ki > 0 ? 'cool' : '']
    ]));
    setText('eqA', `wn = sqrt(Kp/J) = sqrt(${state.Kp.toFixed(2)}/${J.toFixed(4)}) = <b>${wn.toFixed(2)}</b> rad/s`);
    setText('eqB', `z = Kd/(2 sqrt(Kp J)) = <b>${zeta.toFixed(3)}</b> &rarr; PD overshoot <b>${osA.toFixed(1)}%</b>, settling <b>${isFinite(tsA) ? tsA.toFixed(2) : '--'} s</b>`);
    setText('eqC', state.disturbance
      ? `e_ss = Td/Kp = ${state.Td.toFixed(4)}/${state.Kp.toFixed(2)} = <b>${Math.abs(essOpen).toFixed(2)} deg</b>${state.Ki > 0 ? ` &rarr; integral drives it to <b>${essMag.toFixed(2)} deg</b>` : ''}`
      : `Enable the disturbance torque to expose steady-state error e_ss = Td/Kp.`);

    setCards([
      ['Overshoot Mp', os.toFixed(1) + ' %'],
      ['Settling t_s', isFinite(ts) ? ts.toFixed(2) + ' s' : '--'],
      ['Damping z', zeta.toFixed(2)],
      ['Stability', over ? 'OVER 25%' : 'WITHIN 25%', over ? 'fail' : 'pass']
    ]);

    sayOnce('kp_trap', over && state.Ki === 0, 'OBSERVE: There is the proportional trap — chasing zero steady-state error with gain alone buys you violent overshoot. No single knob fixes both.');
    if (!over && state.disturbance && state.Ki > 0) state.done.pidstep = true;
    renderChecklist('Stage 1 \u00B7 PID tuning', [
      ['Inertia set from the build', true, state.inheritedJ ? 'J inherited from Exp 2' : 'preset airframe'],
      ['Overshoot under 25% target', !over, os.toFixed(1) + '%'],
      ['Disturbance error examined', state.disturbance, state.disturbance ? essMag.toFixed(2) + ' deg' : ''],
      ['Zero steady-state error (integral)', nulled, state.Ki > 0 ? essMag.toFixed(2) + ' deg' : '']
    ]);
    setMessage(pidMessage({ os: os, osA: osA, ts: ts, zeta: zeta, wn: wn, essMag: essMag, essOpen: Math.abs(essOpen), over: over, nulled: nulled }));
  }

  // instructor commentary that explains the EFFECT of the current gains on flight
  function pidMessage(m) {
    if (m.over) return `Overshoot is ${m.os.toFixed(0)}% — past the 25% comfort limit, so the drone rings hard before it holds. Lower Kp (less spring) or raise Kd (more damping) to settle it.`;
    if (state.disturbance && state.Ki === 0) return `Proportional + derivative alone leave a steady ${m.essOpen.toFixed(2)}\u00B0 tilt under the CG-offset torque (e_ss = Td/Kp). Add integral gain Ki and watch it wind the error to zero.`;
    if (state.disturbance && state.Ki > 0 && m.nulled) return `Integral action has manufactured the exact counter-torque: the ${m.essOpen.toFixed(2)}\u00B0 droop is gone (now ${m.essMag.toFixed(2)}\u00B0) and the drone holds the commanded attitude. Overshoot sits at ${m.os.toFixed(0)}%.`;
    if (state.disturbance && state.Ki > 0) return `Integral is winding the ${m.essOpen.toFixed(2)}\u00B0 droop down (now ${m.essMag.toFixed(2)}\u00B0). A larger Ki nulls it faster but adds overshoot.`;
    if (state.Ki > 0) return `Kp sets speed (wn=${m.wn.toFixed(1)} rad/s), Kd sets damping (z=${m.zeta.toFixed(2)}). Adding Ki raises overshoot to ${m.os.toFixed(0)}% (vs ${m.osA.toFixed(0)}% for PD) — keep it small unless you need to cancel a steady offset.`;
    return `Kp is the restoring spring (wn=${m.wn.toFixed(1)} rad/s), Kd is the damping (z=${m.zeta.toFixed(2)}): overshoot ${m.os.toFixed(0)}%, settling ${isFinite(m.ts) ? m.ts.toFixed(2) : '--'} s. Raise Kp for speed, Kd to tame the ring.`;
  }

  function updateZiegler() {
    const zn = znValues(); const g = effectiveRateGains();
    const r = state.znResp || Calc.rateStepResponse(g.Kp, g.Ki, g.Kd, lags().tm, lags().ta, lags().ts, { dt: 1e-4, T: 1 });
    const nearKu = state.tuning === 'manual' && Math.abs(state.znGain - zn.Ku) / zn.Ku < 0.06;
    const methodName = state.tuning === 'classic' ? 'Classic Z-N' : state.tuning === 'tyreus' ? 'Tyreus-Luyben' : 'Manual P-sweep';

    setText('benchHud', [
      ['Ultimate Ku', zn.Ku.toFixed(2)],
      ['Period Pu', (zn.Pu * 1000).toFixed(1) + ' ms'],
      ['Method', methodName],
      ['Overshoot', r.osPct.toFixed(0) + ' %']
    ].map((rw) => `<div><span>${rw[0]}</span><strong>${rw[1]}</strong></div>`).join(''));

    setText('metricList', rows([
      ['Ultimate gain Ku', zn.Ku.toFixed(2)],
      ['Ultimate freq wu', zn.wu.toFixed(1) + ' rad/s'],
      ['Ultimate period Pu', (zn.Pu * 1000).toFixed(2) + ' ms'],
      ['Tuned Kp', g.Kp.toFixed(2)],
      ['Tuned Ki', g.Ki.toFixed(1)],
      ['Tuned Kd', g.Kd.toFixed(4)]
    ]));
    setText('probeList', probes([
      ['Sweep gain', state.znGain.toFixed(1) + (nearKu ? ' (~Ku!)' : ''), nearKu ? 'warm' : ''],
      ['Overshoot', r.osPct.toFixed(1) + ' %', r.osPct > 25 ? 'hot' : 'cool'],
      ['Settling (2%)', r.settlingTime.toFixed(3) + ' s', ''],
      ['Steady-state err', Math.abs(r.essPct) < 0.5 ? '0 % (integral)' : r.essPct.toFixed(1) + ' %', Math.abs(r.essPct) < 0.5 ? 'cool' : 'warm']
    ]));
    setText('eqA', `Ku = [(tm.ta+tm.ts+ta.ts)(tm+ta+ts)/(tm.ta.ts) - 1] = <b>${zn.Ku.toFixed(2)}</b>`);
    setText('eqB', `Pu = 2&pi;/&radic;((tm+ta+ts)/(tm.ta.ts)) = <b>${(zn.Pu * 1000).toFixed(1)} ms</b>`);
    setText('eqC', state.tuning === 'manual'
      ? `Raise the proportional gain to Ku &asymp; ${zn.Ku.toFixed(1)} for sustained oscillation, then auto-tune.`
      : `${methodName}: Kp=<b>${g.Kp.toFixed(2)}</b>, Ki=<b>${g.Ki.toFixed(0)}</b>, Kd=<b>${g.Kd.toFixed(4)}</b> &rarr; overshoot <b>${r.osPct.toFixed(0)}%</b>`);

    setCards([
      ['Ultimate Ku', zn.Ku.toFixed(1)],
      ['Period Pu', (zn.Pu * 1000).toFixed(0) + ' ms'],
      ['Overshoot', r.osPct.toFixed(0) + ' %'],
      ['Tune', r.osPct < 25 ? 'ROBUST' : 'AGGRESSIVE', r.osPct < 25 ? 'pass' : 'warn']
    ]);

    sayOnce('ku_found', nearKu, 'OBSERVE: Sustained oscillation \u2014 the loop\u2019s phase lag has reached one hundred eighty degrees exactly where its gain is one. Note that this only exists because real motors and sensors lag; a perfect textbook drone would ring at every gain.');
    sayOnce('zn_applied', state.tuning !== 'manual', 'GUIDE: Ziegler-Nichols gains applied. Watch the step: about twenty percent overshoot, settled in roughly a second, zero steady-state error. An eighty-year-old recipe, still taming aircraft.');
    if (state.tuning !== 'manual') state.done.ziegler = true;
    renderChecklist('Stage 2 \u00B7 Ziegler\u2013Nichols', [
      ['Ultimate gain & period found', true, 'Ku=' + zn.Ku.toFixed(1)],
      ['Sustained oscillation reached', nearKu || state.tuning !== 'manual', nearKu ? 'at Ku' : ''],
      ['Classic Z-N gains applied', state.tuning === 'classic', state.tuning === 'classic' ? r.osPct.toFixed(0) + '% OS' : ''],
      ['Refined under 25% (Tyreus-Luyben)', state.tuning === 'tyreus' && r.osPct < 25, state.tuning === 'tyreus' ? r.osPct.toFixed(0) + '% OS' : '']
    ]);
    setMessage(nearKu
      ? `Sustained oscillation found: this is the ultimate gain Ku = ${zn.Ku.toFixed(2)}, oscillating with period Pu = ${(zn.Pu * 1000).toFixed(1)} ms. Click Auto-tune to read the PID gains from the table.`
      : (state.tuning === 'classic'
        ? `Classic Z-N is fast but aggressive: ~${r.osPct.toFixed(0)}% overshoot, zero steady-state error. Switch to Tyreus-Luyben to tame it.`
        : (state.tuning === 'tyreus'
          ? `Tyreus-Luyben: ~${r.osPct.toFixed(0)}% overshoot (under 25%) with zero steady-state error - the robust tune.`
          : (state.znGain > zn.Ku * 1.06
            ? `Past the stability limit (sweep gain ${state.znGain.toFixed(1)} > Ku ${zn.Ku.toFixed(1)}): the rate loop diverges. Lower the gain to the sustained-oscillation point.`
            : `Below the limit (sweep gain ${state.znGain.toFixed(1)} < Ku ${zn.Ku.toFixed(1)}): the loop still damps out. Raise the gain until the oscillation just sustains \u2014 that point is Ku.`))));
  }

  function updateFusion() {
    const im = state.imu, dt = im.dt_s;
    const tau = Calc.filterTimeConstant(state.alpha, dt);
    const drift = Calc.driftError(im.gyro_bias_dps, state.alpha, dt);
    const noise = Calc.noiseRMS(im.accel_noise_deg, state.alpha);
    const total = drift + noise;
    const set = state.db.complementary_filter.alpha_test_set || [0.90, 0.95, 0.98, 0.99];
    const opt = Calc.optimalAlpha(im.gyro_bias_dps, im.accel_noise_deg, dt, set);
    const pureGyro = im.gyro_bias_dps * 30;

    setText('benchHud', [
      ['IMU', im.label.split(' ')[0]],
      ['Alpha', state.alpha.toFixed(3)],
      ['Total err', total.toFixed(3) + ' deg'],
      ['Optimal a', opt.alpha.toFixed(2)]
    ].map((r) => `<div><span>${r[0]}</span><strong>${r[1]}</strong></div>`).join(''));

    setText('metricList', rows([
      ['Gyro bias', im.gyro_bias_dps.toFixed(2) + ' deg/s'],
      ['Accel noise s', im.accel_noise_deg.toFixed(2) + ' deg'],
      ['Filter tau_f', isFinite(tau) ? tau.toFixed(3) + ' s' : 'inf'],
      ['Drift error', drift.toFixed(3) + ' deg'],
      ['Noise RMS', noise.toFixed(3) + ' deg'],
      ['Total error', total.toFixed(3) + ' deg']
    ]));
    setText('probeList', probes([
      ['Optimal alpha', opt.alpha.toFixed(2), 'cool'],
      ['Min total error', opt.total.toFixed(3) + ' deg', 'cool'],
      ['At alpha = 1 (gyro only)', pureGyro.toFixed(0) + ' deg / 30s', 'hot'],
      ['Sample rate', im.sample_rate_hz + ' Hz', '']
    ]));
    setText('eqA', `tau_f = a.dt/(1-a) = ${state.alpha.toFixed(3)}&times;${dt}/(1-${state.alpha.toFixed(3)}) = <b>${isFinite(tau) ? tau.toFixed(3) : 'inf'} s</b>`);
    setText('eqB', `drift = bias.tau_f = <b>${drift.toFixed(3)} deg</b>; noise = s&radic;((1-a)/(1+a)) = <b>${noise.toFixed(3)} deg</b>`);
    setText('eqC', `total = drift + noise = <b>${total.toFixed(3)} deg</b>; minimum at a = <b>${opt.alpha.toFixed(2)}</b>`);

    setCards([
      ['Optimal a', opt.alpha.toFixed(2)],
      ['Total Error', total.toFixed(2) + ' deg'],
      ['Filter tau', isFinite(tau) ? tau.toFixed(3) + ' s' : 'inf'],
      ['Blend', Math.abs(state.alpha - opt.alpha) < 0.005 ? 'OPTIMAL' : 'ADJUST', Math.abs(state.alpha - opt.alpha) < 0.005 ? 'pass' : 'warn']
    ]);

    sayOnce('pure_gyro', state.alpha >= 0.999, 'WARNING: Pure gyro integration. It looks perfectly clean — and it is quietly walking away from the truth. Come back in thirty seconds and see how far.');
    sayOnce('fuse_opt', Math.abs(state.alpha - opt.alpha) < 0.005, 'OBSERVE: There is the compromise point — the alpha that minimises drift plus noise together. Neither error can be zeroed alone; engineering is choosing where to lose.');
    if (Math.abs(state.alpha - opt.alpha) < 0.005) state.done.fusion = true;
    renderChecklist('Sensor fusion', [
      ['IMU model selected', true, im.label.split(' ')[0]],
      ['Drift vs noise trade-off seen', true, ''],
      ['Optimal alpha identified', Math.abs(state.alpha - opt.alpha) < 0.005, 'a=' + opt.alpha.toFixed(2)],
      ['Unbounded pure-gyro drift seen', state.alpha >= 0.999, state.alpha >= 0.999 ? pureGyro.toFixed(0) + ' deg' : '']
    ]);
    setMessage(state.alpha >= 0.999
      ? `Pure gyro integration (alpha = 1): the estimate drifts ${pureGyro.toFixed(0)}\u00B0 in 30 s and never recovers \u2014 the PID loop would chase that phantom tilt and slowly roll the drone over.`
      : (Math.abs(state.alpha - opt.alpha) < 0.005
        ? `Optimal blend: alpha=${opt.alpha.toFixed(2)} trims total error to ${opt.total.toFixed(2)}\u00B0. This is the clean attitude the PID loop in Module 1 actually flies on.`
        : `alpha=${state.alpha.toFixed(2)}: tau=${tau.toFixed(2)}s, drift ${drift.toFixed(2)}\u00B0, noise ${noise.toFixed(2)}\u00B0. Higher alpha trusts the gyro (more drift); lower trusts the accel (more noise). Optimum is ${opt.alpha.toFixed(2)}.`));
  }

  // ── Tab 4: Full flight-control system (closed loop) ────────────────────────
  function ctrlLabel(id) { return id === 'classic' ? 'ZN-Classic' : id === 'tyreus' ? 'ZN-Tyreus' : 'Manual PID'; }
  function estLabel(id) { return id === 'gyro' ? 'Gyro-only' : id === 'accel' ? 'Accel-only' : 'Complementary α'; }

  function updateCombined() {
    const r = state.combinedResp || Calc.closedLoopFlight(angleGainsFor(state.controller), combinedPlant(), combinedOpts(state.estimator, state.controller));
    const score = Calc.scoreFlight(r);
    const best = state.bestCombo;
    const isBest = best && best.ctrl === state.controller && best.est === state.estimator;
    const d = dragCoeffs();

    setText('benchHud', [
      ['System', ctrlLabel(state.controller).split(' ')[0] + '/' + (state.estimator)],
      ['Track RMS', r.rmsTrackDeg.toFixed(2) + ' deg'],
      ['Score', r.diverged ? 'CRASH' : score + '/100'],
      ['Best', best ? best.score + '/100' : '--']
    ].map((rw) => `<div><span>${rw[0]}</span><strong>${rw[1]}</strong></div>`).join(''));

    setText('metricList', rows([
      ['Controller', ctrlLabel(state.controller)],
      ['Estimator', estLabel(state.estimator)],
      ['Tracking RMS (true vs cmd)', r.rmsTrackDeg.toFixed(2) + ' deg'],
      ['Estimator error (true vs est)', r.rmsEstErrDeg.toFixed(2) + ' deg'],
      ['Overshoot', r.overshootPct.toFixed(1) + ' %'],
      ['Settling (2 deg band)', r.settlingTime.toFixed(2) + ' s'],
      ['Air-drag b', d.b.toFixed(4) + ' N·m·s']
    ]));
    setText('probeList', probes([
      ['System score', r.diverged ? 'CRASH' : score + ' / 100', r.diverged ? 'hot' : (score >= 80 ? 'cool' : 'warm')],
      ['Actuator saturation', (r.satFraction * 100).toFixed(0) + ' % of run', r.satFraction > 0.2 ? 'warm' : ''],
      ['Wind gust', state.windAmp > 0 ? state.windAmp.toFixed(3) + ' N·m' : 'calm', state.windAmp > 0 ? 'warm' : ''],
      ['Best system', best ? best.name : '--', 'cool']
    ]));
    setText('eqA', `Plant: J&theta;&#776; = u + &tau;<sub>drag</sub>(&theta;&#775;) + &tau;<sub>wind</sub>(t)${state.disturbance ? ' + &tau;<sub>cg</sub>' : ''}, J=<b>${state.airframe.J_roll_kgm2.toFixed(4)}</b>`);
    setText('eqB', `u acts on the ESTIMATE: e = cmd &minus; &theta;&#770; &rarr; ${estLabel(state.estimator)} gives est-error <b>${r.rmsEstErrDeg.toFixed(2)}&deg;</b>`);
    setText('eqC', r.diverged
      ? `This combination <b>diverges</b> — the drone rolls past recovery. Try the complementary estimator or a gentler controller.`
      : `Tracking RMS <b>${r.rmsTrackDeg.toFixed(2)}&deg;</b>, overshoot <b>${r.overshootPct.toFixed(0)}%</b> &rarr; score <b>${score}/100</b>${isBest ? ' — this is the best system.' : ''}`);

    setCards([
      ['Score', r.diverged ? '0' : String(score)],
      ['Track RMS', r.rmsTrackDeg.toFixed(2) + '&deg;'],
      ['Est err', r.rmsEstErrDeg.toFixed(2) + '&deg;'],
      ['System', isBest ? 'BEST' : (r.diverged ? 'CRASH' : (score >= 80 ? 'STABLE' : 'WEAK')), isBest ? 'pass' : (r.diverged ? 'fail' : (score >= 80 ? 'pass' : 'warn'))]
    ]);

    renderLeaderboard();

    sayOnce('verdict_pass', isBest && score >= 80, 'GUIDE: Flight controller programmed. These exact gains and this exact filter will fly your integrated flight test — they are stored, and they are yours.');
    if (isBest && score >= 80) state.done.combined = true;
    renderChecklist('Stage 4 · Full system', [
      ['Flew a closed-loop combination', true, ctrlLabel(state.controller).split(' ')[0] + '×' + state.estimator],
      ['Tried the gyro-only estimator', state._triedGyro || state.estimator === 'gyro', 'sees drift'],
      ['Found a stable system (score ≥ 80)', score >= 80 && !r.diverged, score + '/100'],
      ['Selected the leaderboard best', isBest, isBest ? best.name : '']
    ]);
    if (state.estimator === 'gyro') state._triedGyro = true;
    if (score >= 80 && !r.diverged) showUnlockCard();   // stable flight controller found → unlock reward

    renderVerdict(r, score, isBest);
    setMessage(combinedMessage(r, score, isBest, best));
  }

  function renderLeaderboard() {
    const host = $('leaderboard'); if (!host) return;
    const best = state.bestCombo;
    host.innerHTML = state.leaderboard.map((row, i) => {
      const cur = row.ctrl === state.controller && row.est === state.estimator;
      const isBest = best && row.ctrl === best.ctrl && row.est === best.est;
      const cls = 'lb-row' + (isBest ? ' lb-best' : '') + (cur ? ' lb-current' : '') + (row.diverged ? ' lb-crash' : '');
      const parts = row.name.split(' × ');
      return `<div class="${cls}" data-ctrl="${esc(row.ctrl)}" data-est="${esc(row.est)}" role="button" tabindex="0">` +
        `<span class="lb-rank">${i + 1}</span>` +
        `<span class="lb-name">${esc(parts[0])} <small>× ${esc(parts[1] || '')}</small></span>` +
        `<span class="lb-score">${row.diverged ? 'CRASH' : row.score}</span>` +
        `<span class="lb-bar"><span style="width:${row.diverged ? 0 : row.score}%"></span></span>` +
        `</div>`;
    }).join('');
    host.querySelectorAll('.lb-row').forEach((el) => {
      const pick = () => {
        state.controller = el.dataset.ctrl; state.estimator = el.dataset.est;
        syncSegButtons(); if (window.SFX) { window.SFX.click(); window.SFX.start(); window.SFX.motor(true); }
        restartResponse(true); recompute(); updateAll();
      };
      el.addEventListener('click', pick);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    });
  }

  function renderVerdict(r, score, isBest) {
    if (typeof window === 'undefined' || !window.VLABLab) return;
    let tone = 'warn', label = 'Off the optimum', note = 'A stable combination, but not the leaderboard best.';
    if (r.diverged) { tone = 'fail'; label = 'System unstable'; note = 'This combination crashes — these gains would fly the Exp 11 test into the ground.'; }
    else if (isBest && score >= 80) { tone = 'pass'; label = 'Best flight control system'; note = 'Tightest tracking of every combination — programmed into the flight controller.'; }
    else if (score >= 80) { tone = 'warn'; label = 'Stable, not optimal'; note = 'Flies well; the leaderboard has a tighter system — try the highlighted row.'; }
    window.VLABLab.verdict('verdictHost', { tone: tone, label: label, note: note });
  }

  function combinedMessage(r, score, isBest, best) {
    if (r.diverged) return `${ctrlLabel(state.controller)} on the ${estLabel(state.estimator).toLowerCase()} estimate diverges — the controller is chasing an attitude it can't trust and rolls the drone over. Switch the estimator to the complementary filter.`;
    if (state.estimator === 'gyro') return `Gyro-only estimation looks clean but the bias integrates: tracking RMS is ${r.rmsTrackDeg.toFixed(2)}° because the controller slowly follows the drifting estimate. A real system fuses the accelerometer back in.`;
    if (isBest) return `This is the best system on the board: ${ctrlLabel(state.controller)} flying the complementary estimate holds the target to ${r.rmsTrackDeg.toFixed(2)}° (score ${score}). This exact combination is what gets programmed into the flight controller.`;
    return `${ctrlLabel(state.controller)} × ${estLabel(state.estimator)} scores ${score}/100. The leaderboard leader is ${best ? best.name : '—'} at ${best ? best.score : '--'} — click it to fly it and compare.`;
  }

  function checklist(items) {
    return items.map((it) => {
      const done = it[1], warn = it[3];
      const cls = done ? 'done' : (warn ? 'warn' : 'pending');
      const mark = done ? '\u2713' : (warn ? '!' : '');
      return `<div class="checklist-item"><span class="chk-icon ${cls}">${mark}</span><span class="checklist-label">${esc(it[0])}</span><span class="checklist-val">${esc(it[2] || '')}</span></div>`;
    }).join('');
  }

  // ── Unlock-reward 3D card (shown once, on full experiment completion) ─────
  // Loads the unlocked component from asset/models/<file>.glb — drop your file
  // there and set UNLOCK_MODEL. Until then a procedural placeholder shows, so
  // the sim never breaks. Self-contained scene (no shared 3D helper here).
  const UNLOCK_MODEL = 'asset/models/reward.glb';   // ← set to your unlocked component's .glb
  let _unlAnim = null, _unlRndr = null, _unlScn = null, _unlCam = null, _unlCtrls = null, _unlGroup = null, _unlClk = null, _unlShown = false;
  function showUnlockCard() {
    const card = document.getElementById('nextModuleContainer');
    if (!card || _unlShown) return;
    _unlShown = true;
    card.style.display = 'block';
    setTimeout(initUnlockScene, 80);
    try { card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {}
  }
  function initUnlockScene() {
    try {
      const canvas = document.getElementById('unlockCanvas');
      if (!canvas || !window.THREE) return;
      const THREE = window.THREE;
      if (_unlAnim) { cancelAnimationFrame(_unlAnim); _unlAnim = null; }
      const wrap = canvas.parentElement || canvas;
      const w = wrap.clientWidth || 300, h = wrap.clientHeight || 180;
      _unlRndr = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
      _unlRndr.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      _unlRndr.setSize(w, h, false);
      _unlScn = new THREE.Scene();
      _unlCam = new THREE.PerspectiveCamera(40, w / h, 0.01, 100);
      _unlCam.position.set(0.16, 0.12, 0.22);
      if (THREE.OrbitControls) { _unlCtrls = new THREE.OrbitControls(_unlCam, canvas); _unlCtrls.enablePan = false; _unlCtrls.minDistance = 0.08; _unlCtrls.maxDistance = 2.0; _unlCtrls.target.set(0, 0.01, 0); _unlCtrls.update(); }
      _unlScn.add(new THREE.AmbientLight(0xffffff, 0.8));
      const sun = new THREE.DirectionalLight(0xffffff, 1.0); sun.position.set(1, 2, 1); _unlScn.add(sun);
      _unlGroup = new THREE.Group(); _unlScn.add(_unlGroup);
      const clearGroup = function () { while (_unlGroup.children.length) _unlGroup.remove(_unlGroup.children[0]); };
      const createProcedural = function () {
        clearGroup();
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.35, metalness: 0.7 });
        const accentMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.5, metalness: 0.3 });
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.01, 0.09), bodyMat); _unlGroup.add(body);
        [[0.05, 0.05], [-0.05, 0.05], [0.05, -0.05], [-0.05, -0.05]].forEach(function (p) {
          const mount = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.008, 16), accentMat);
          mount.position.set(p[0], 0.006, p[1]); _unlGroup.add(mount);
        });
      };
      if (window.GLTFLoader) {
        const loader = new window.GLTFLoader();
        if (window.DRACOLoader) { const dl = new window.DRACOLoader(); dl.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/'); loader.setDRACOLoader(dl); }
        loader.load(UNLOCK_MODEL, function (gltf) {
          clearGroup();
          const model = gltf.scene;
          const box = new THREE.Box3().setFromObject(model), size = new THREE.Vector3(); box.getSize(size);
          const maxDim = Math.max(size.x, size.y, size.z) || 1.0, s = 0.16 / maxDim; model.scale.setScalar(s);
          const c = new THREE.Vector3(); box.getCenter(c); model.position.set(-c.x * s, -c.y * s, -c.z * s);
          _unlGroup.add(model);
        }, undefined, function () { createProcedural(); });
      } else { createProcedural(); }
      window.addEventListener('resize', function () {
        if (!_unlRndr) return; const ww = wrap.clientWidth || w, hh = wrap.clientHeight || h;
        _unlCam.aspect = ww / hh; _unlCam.updateProjectionMatrix(); _unlRndr.setSize(ww, hh, false);
      });
      _unlClk = new THREE.Clock();
      (function render() {
        _unlAnim = requestAnimationFrame(render);
        const dt = _unlClk.getDelta();
        if (_unlCtrls) _unlCtrls.update();
        if (_unlGroup) _unlGroup.rotation.y += 0.3 * dt;
        _unlRndr.render(_unlScn, _unlCam);
      })();
    } catch (e) { /* unlock card is cosmetic — never break the app */ }
  }

  // Route the existing [label, ok, val, warn?] items through the shared uniform
  // objectives panel (VLABLab); fall back to the local checklist markup in tests.
  function renderChecklist(title, items) {
    if (typeof window !== 'undefined' && window.VLABLab) {
      const defs = items.map((it, i) => ({
        id: 'o' + i, label: it[0], value: () => it[2] || '',
        test: () => !!it[1], warn: () => !!it[3]
      }));
      window.VLABLab.objectives('checklist', defs, state, { title: title });
    } else {
      setText('checklist', checklist(items));
    }
  }

  // ── Uniform fault scenarios (mode-aware): inject a real control fault, resolve
  //    it with the gains / blend, and the objectives auto-tick. ──
  const SCENARIOS = {
    pidstep: [
      { id: 'none', label: 'Calm air \u2014 tune freely', desc: 'Hold the commanded roll with a clean, well-damped response.' },
      { id: 'oscillation', label: 'Over-aggressive gains (oscillation)', desc: 'Kp is cranked up with no damping \u2014 the roll rings and oscillates. Cut Kp or raise Kd to hold overshoot under 25 %.', fault: true },
      { id: 'disturbance', label: 'Wind-gust / CG-offset droop', desc: 'A steady disturbance torque droops the held attitude. Add integral gain Ki to null the steady-state error.', fault: true }
    ],
    ziegler: [
      { id: 'none', label: 'Manual gain sweep', desc: 'Sweep the proportional gain toward the stability limit Ku.' },
      { id: 'unstable', label: 'Past the stability limit', desc: 'The sweep gain exceeds Ku and the rate loop diverges. Back it down to the sustained-oscillation point, then auto-tune.', fault: true }
    ],
    fusion: [
      { id: 'none', label: 'Balanced blend', desc: 'Blend gyro + accelerometer for the lowest attitude error.' },
      { id: 'drift', label: 'Gyro-only drift', desc: 'alpha = 1 trusts only the gyro \u2014 bias integrates into runaway drift. Lower alpha toward the optimum to bound it.', fault: true },
      { id: 'noise', label: 'Noisy accelerometer', desc: 'Accelerometer noise leaks through at low alpha. Find the optimal blend that minimises total error.', fault: true }
    ],
    combined: [
      { id: 'none', label: 'Calm conditions', desc: 'Fly any controller \u00d7 estimator combination and read the leaderboard.' },
      { id: 'gusty', label: 'Gusty wind', desc: 'A wind-gust torque pushes the drone off target \u2014 only integral action and a trustworthy estimate hold it.', fault: true },
      { id: 'badest', label: 'Gyro-only estimator', desc: 'Force the pure-gyro estimate: the controller flies a drifting attitude and the score collapses. Switch to the complementary filter.', fault: true },
      { id: 'uncal_esc', label: 'Uncalibrated ESC (from Exp 4)', desc: 'An actuation offset from an uncalibrated ESC biases every motor command \u2014 integral action must trim it out.', fault: true }
    ]
  };
  function applyScenario(id) {
    state.scenario = id;
    if (state.mode === 'pidstep') {
      if (id === 'oscillation') { state.Kp = 1.8; state.Kd = 0.0; state.Ki = 0.0; state.disturbance = false; }
      else if (id === 'disturbance') { state.disturbance = true; }
      else { state.disturbance = false; }
    } else if (state.mode === 'ziegler') {
      if (id === 'unstable') { state.tuning = 'manual'; state.znGain = znValues().Ku * 1.25; }
    } else if (state.mode === 'fusion') {
      if (id === 'drift') { state.alpha = 0.999; }
      else if (id === 'noise') { state.noise = true; }
    } else if (state.mode === 'combined') {
      if (id === 'gusty') { state.windAmp = 0.03; }
      else if (id === 'badest') { state.estimator = 'gyro'; }
      else if (id === 'uncal_esc') { state.escCalibrated = false; if (!state.deadbandUs) state.deadbandUs = 40; }
      else { state.windAmp = 0; }
    }
    if (window.SFX) { const o = (SCENARIOS[state.mode] || []).find((x) => x.id === id); if (o && o.fault) window.SFX.warn(); }
    hydrateControls(); restartResponse(false); recompute(); updateAll();
  }
  function renderScenario() {
    if (typeof window === 'undefined' || !window.VLABLab) return;
    const opts = SCENARIOS[state.mode] || SCENARIOS.pidstep;
    if (!opts.some((o) => o.id === state.scenario)) state.scenario = 'none';
    window.VLABLab.scenario('scenarioHost', { title: 'Fault scenario', current: state.scenario, options: opts, onSelect: applyScenario });
  }

  // On-screen instructor text is the live commentary bubble; it updates on every
  // interaction but stays SILENT (no audio) per the Quiet-Instructor model.
  // Audio is reserved for tab loads, faults and completions via announceTab()/
  // the fault-scenario handler, which pass VOICE_CLIPS-keyed strings to say().
  function setMessage(t) {
    const el = $('liveCommentaryText'); if (el) el.innerHTML = t;
    const dot = $('vlInstructorDot'); const bubble = $('vlInstructorBubble');
    if (dot && bubble) dot.hidden = !bubble.hidden;
  }

  // Fixed voice guidance spoken once per tab load (VOICE_CLIPS keys — verbatim
  // from redesign §6). Routed through Instructor.say() so the audio plays and
  // the on-screen bubble updates together.
  const TAB_INTRO = {
    pidstep: 'GUIDE: Your plant is the real airframe from the structures experiment — its inertia sets how hard this tune will be. Start by pushing only the proportional gain and watch the trade-off appear.',
    ziegler: 'GUIDE: Now let the method tune for you. Ziegler and Nichols size the gains from the plant itself — set the target and the air resistance, then apply the table.',
    fusion: 'GUIDE: Two imperfect sensors, one truth. The gyroscope is smooth but drifts; the accelerometer is honest on average but shakes. The filter coefficient alpha decides whom to trust.',
    combined: 'GUIDE: This is the whole flight control system. Pick a controller and an estimator, fly the closed loop, and let the leaderboard show you which combination flies the tightest.'
  };
  function announceTab() {
    const t = TAB_INTRO[state.mode];
    if (t && window.Instructor) window.Instructor.say(t);
    else setMessage(t || '');
  }

  // Fire a FIXED voice clip once per rising edge of a condition (faults /
  // completions). The on-screen bubble still updates continuously & silently via
  // setMessage(); this is only for the reserved spoken moments.
  const _saidEdges = {};
  function sayOnce(key, condition, text) {
    if (condition && !_saidEdges[key]) { _saidEdges[key] = true; if (window.Instructor) window.Instructor.say(text); }
    else if (!condition) { _saidEdges[key] = false; }
  }

  // live P/I/D torque-contribution bars (Module 1 only; no-op if the panel is absent).
  // Shows how much of the corrective torque each gain is supplying at the current instant.
  function renderPidTerms(sample) {
    const host = $('pidTerms');
    if (!host) return;
    const p = sample ? sample.p : 0, iT = sample ? sample.i : 0, dT = sample ? sample.d : 0;
    const mag = Math.abs(p) + Math.abs(iT) + Math.abs(dT) || 1;
    const defs = [
      ['P', 'present error \u00d7 Kp \u2014 the restoring spring; sets the response speed', p, '#ffbf00'],
      ['I', 'accumulated error \u00d7 Ki \u2014 climbs until a steady offset is nulled', iT, '#10b981'],
      ['D', 'rate \u00d7 Kd (on the gyro) \u2014 electronic damping that tames overshoot', dT, '#60a5fa']
    ];
    host.innerHTML = defs.map((d) => {
      const pct = Math.abs(d[2]) / mag * 100;
      return '<div class="pid-term">' +
        `<div class="pid-term-top"><span class="pid-term-tag" style="color:${d[3]}">${d[0]}</span>` +
        `<span class="pid-term-role">${esc(d[1])}</span>` +
        `<strong class="pid-term-val">${d[2] >= 0 ? '+' : '\u2212'}${Math.abs(d[2]).toFixed(4)}</strong></div>` +
        `<div class="pid-term-track"><div class="pid-term-bar" style="width:${pct.toFixed(1)}%;background:${d[3]}"></div></div>` +
        '</div>';
    }).join('');
  }

  // ── module completion gate (replaces the old "log >= N readings" worksheet) ──
  // Module 1 unlocks Module 2 once both inner stages are explored: a tune that
  // holds overshoot in target while nulling the disturbance (pidstep) and a
  // Ziegler–Nichols auto-tune applied (ziegler). The flags latch in state.done.
  // (removed) the old Module-1 \u2192 Module-2 proceed gate: the four stages are now
  // tabs on one page, so there is no cross-page link to gate. Objectives +
  // verdict carry completion signalling instead.

  // ── canvases + animation ─────────────────────────────────────────────────────
  let viz = null;                       // 3-D viewport handle (null in tests: THREE stripped)
  function resizeCanvases() {
    // 2-D oscilloscope keeps a device-pixel backing store for crisp curves
    const sc = $('scopeCanvas');
    if (sc) {
      const rect = sc.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(320, Math.round((rect.width || 600) * dpr)), h = Math.max(160, Math.round((rect.height || 300) * dpr));
      if (sc.width !== w || sc.height !== h) { sc.width = w; sc.height = h; }
    }
    // 3-D drone viewport follows its wrapper's CSS box
    if (viz && viz.renderer) {
      const host = viz.canvas.parentElement || viz.canvas;
      const w = Math.max(2, host.clientWidth || 600), h = Math.max(2, host.clientHeight || 360);
      viz.renderer.setSize(w, h, false);
      viz.camera.aspect = w / h;
      viz.camera.updateProjectionMatrix();
    }
  }

  function gauss() { return ((Math.random() + Math.random() + Math.random() + Math.random() + Math.random() + Math.random()) - 3) / 1.2247; }

  function loop(now) {
    if (state.lastTime === null) state.lastTime = now;
    let dt = (now - state.lastTime) / 1000; state.lastTime = now;
    if (dt > 0.05) dt = 0.05; if (dt < 0) dt = 0;
    state.phase = now / 1000;

    if (state.mode === 'fusion') stepFusion(dt);
    else state.playT += dt;

    updateScene3D(dt);
    drawScope();
    requestAnimationFrame(loop);
  }

  function stepFusion(dt) {
    const im = state.imu, f = state.fuse;
    f.t += dt;
    // the commanded attitude (Roll Command slider) is the true angle, approached
    // smoothly so the gyro sees a real rate while slewing and only bias while held.
    const k = 1 - Math.exp(-dt / 0.45);                                 // ~0.45 s attitude slew
    const prevTrue = f.trueAng;
    const trueAng = prevTrue + (state.setpoint - prevTrue) * k;
    const trueRate = dt > 0 ? (trueAng - prevTrue) / dt : 0;            // deg/s
    f.trueAng = trueAng;
    const measRate = trueRate + im.gyro_bias_dps;                       // gyro: true rate + constant bias
    const accelAng = trueAng + (state.noise ? gauss() * im.accel_noise_deg : 0);  // accel: true + noise
    f.gyroAngle += measRate * dt;                                       // pure integration (drifts)
    f.fused = Calc.complementaryStep(f.fused, measRate, accelAng, state.alpha, dt);
    f.hist.push({ t: f.t, tru: trueAng, gyro: f.gyroAngle, acc: accelAng, fus: f.fused });
    if (f.hist.length > 900) f.hist.shift();
  }

  // ── 3-D drone viewport (three.js) ─────────────────────────────────────────
  // Light-studio scene matching the polished experiments: a real quadcopter that
  // banks with the controlled roll angle. Every THREE reference is guarded so the
  // test harness (which strips the CDN <script> tags) simply skips the 3-D path.
  const VZ = {
    bg: 0xeef2f7,
    frame: 0x2b3242, frameDark: 0x1c212c, plate: 0x3a4252,
    accent: 0x12b886, accentDim: 0x0c8f6a, motor: 0x4b5563, motorCap: 0x9aa3b2,
    nose: 0x12b886, skid: 0x374151, target: 0x10b981
  };

  function mkMat(color, opts) {
    const o = opts || {};
    return new THREE.MeshStandardMaterial({
      color: color,
      metalness: o.metalness !== undefined ? o.metalness : 0.45,
      roughness: o.roughness !== undefined ? o.roughness : 0.55,
      transparent: !!o.transparent,
      opacity: o.opacity !== undefined ? o.opacity : 1,
      emissive: o.emissive !== undefined ? o.emissive : 0x000000,
      emissiveIntensity: o.emissiveIntensity !== undefined ? o.emissiveIntensity : 1
    });
  }

  // a motor + 2-blade propeller assembly; returns the spinning prop group
  function buildRotor(parent, x, z, spinDir) {
    const g = new THREE.Group(); g.position.set(x, 0.028, z); parent.add(g);
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.05, 24), mkMat(VZ.motor, { metalness: 0.7, roughness: 0.35 }));
    motor.position.y = 0.025; motor.castShadow = true; g.add(motor);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.012, 24), mkMat(VZ.motorCap, { metalness: 0.8, roughness: 0.3 }));
    cap.position.y = 0.056; g.add(cap);

    const prop = new THREE.Group(); prop.position.y = 0.066; g.add(prop);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.016, 16), mkMat(VZ.frameDark, { metalness: 0.3, roughness: 0.6 }));
    prop.add(hub);
    const bladeMat = mkMat(VZ.accent, { metalness: 0.2, roughness: 0.5, emissive: VZ.accentDim, emissiveIntensity: 0.25 });
    for (let i = 0; i < 2; i++) {
      const sub = new THREE.Group();
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.006, 0.032), bladeMat);
      blade.position.x = 0.1; blade.castShadow = true; sub.add(blade);
      sub.rotation.y = i * Math.PI; prop.add(sub);
    }
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.12, 32), mkMat(VZ.accent, { transparent: true, opacity: 0.05, roughness: 0.9, metalness: 0 }));
    disc.rotation.x = -Math.PI / 2; disc.position.y = 0.004; prop.add(disc);

    prop.userData.spin = spinDir;
    return prop;
  }

  // Real catalog-driven sizing for the shared VLAB_DRONE3D hero model — reads
  // the ACTUAL upstream Exp1 motor/propeller + Exp2 frame choice (the same
  // shared components this experiment already inherits J/mass from) instead
  // of the model's generic 5" defaults, so the on-screen craft's proportions
  // visually match the drone the student actually designed.
  function _droneOpts() {
    const opts = { blades: state.propBlades, accent: VZ.accent };
    try {
      if (window.VLABStore) {
        const c = window.VLABStore.get().components || {};
        const cat = window.VLAB_CATALOG || {};
        const frame = (cat.frames || []).find((f) => f.id === c.frameId);
        const motor = (cat.motors || []).find((m) => m.id === c.motorId);
        const prop = (cat.propellers || []).find((p) => p.id === c.propId);
        if (frame && frame.wheelbase_mm) opts.armReach = Math.max(0.15, Math.min(0.5, frame.wheelbase_mm / 2000));
        if (frame && frame.body_size_mm) {
          opts.bodyW = Math.max(0.06, Math.min(0.2, frame.body_size_mm[0] / 1000));
          opts.bodyD = Math.max(0.06, Math.min(0.24, frame.body_size_mm[2] / 1000));
        }
        if (motor && motor.bell_diameter_mm) opts.motorR = motor.bell_diameter_mm / 2000;
        if (motor && motor.bell_height_mm) opts.motorH = motor.bell_height_mm / 1000;
        if (prop && prop.diameter_m) opts.propR = prop.diameter_m / 2;
      }
    } catch (e) { /* store/catalog optional */ }
    return opts;
  }

  // dark X-frame quad with accent props, a nose marker, and landing gear.
  // Prefer the shared high-quality procedural quadcopter (window.VLAB_DRONE3D) so
  // every experiment shows the SAME craft; fall back to the local low-poly build
  // only if that module didn't load (or the test harness stripped it).
  function buildQuad() {
    if (typeof VLAB_DRONE3D !== 'undefined' && VLAB_DRONE3D && VLAB_DRONE3D.build) {
      const built = VLAB_DRONE3D.build(THREE, _droneOpts());
      if (built && built.root) {
        built.root.scale.setScalar(1.4);                 // fill the attitude reference ring
        const props = (built.props && built.props.length) ? built.props : (built.root.userData.props || []);
        return { quad: built.root, props: props };
      }
    }
    return buildQuadLocal();
  }

  // dispose a THREE subtree's geometries/materials before dropping it (rebuilds)
  function disposeObject3D(obj) {
    if (!obj || !obj.traverse) return;
    obj.traverse((n) => {
      if (n.geometry && n.geometry.dispose) n.geometry.dispose();
      if (n.material) { const m = n.material; (Array.isArray(m) ? m : [m]).forEach((x) => { if (x && x.dispose) x.dispose(); }); }
    });
  }

  // swap the live model when the user changes the blade count, preserving pose
  function rebuildQuad() {
    if (!viz || !viz.scene) return;
    const rotZ = viz.quad ? viz.quad.rotation.z : 0;
    const posY = viz.quad ? viz.quad.position.y : 0.02;
    if (viz.quad) { viz.scene.remove(viz.quad); disposeObject3D(viz.quad); }
    const built = buildQuad();
    built.quad.rotation.z = rotZ; built.quad.position.y = posY;
    viz.scene.add(built.quad);
    viz.quad = built.quad; viz.props = built.props;
    // rebuild the translucent estimate ghost to match the new blade count
    if (viz.ghost) { viz.scene.remove(viz.ghost); disposeObject3D(viz.ghost); viz.ghost = null; }
    try {
      const gb = buildQuad();
      gb.quad.traverse((n) => {
        if (n.material) { const ms = Array.isArray(n.material) ? n.material : [n.material]; ms.forEach((m) => { if (m) { m.transparent = true; m.opacity = 0.22; m.depthWrite = false; } }); }
        if (n.castShadow !== undefined) n.castShadow = false;
      });
      gb.quad.rotation.z = rotZ; gb.quad.visible = false;
      viz.scene.add(gb.quad); viz.ghost = gb.quad;
    } catch (e) { viz.ghost = null; }
  }

  // low-poly fallback build (kept so the sim still renders if the shared module is absent)
  function buildQuadLocal() {
    const quad = new THREE.Group();
    const props = [];
    const a = 0.34;                                   // arm reach (X-config)

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.052, 0.26), mkMat(VZ.frame, { metalness: 0.5, roughness: 0.5 }));
    body.castShadow = true; body.receiveShadow = true; quad.add(body);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.012, 0.22), mkMat(VZ.plate, { metalness: 0.6, roughness: 0.4 }));
    plate.position.y = 0.032; quad.add(plate);
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.05, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2), mkMat(VZ.frameDark, { metalness: 0.4, roughness: 0.45 }));
    canopy.position.set(0, 0.03, 0.02); canopy.scale.set(1, 0.7, 1.3); quad.add(canopy);
    // nose cone (accent) at +Z so the heading is legible
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.08, 20), mkMat(VZ.nose, { metalness: 0.3, roughness: 0.4, emissive: VZ.accentDim, emissiveIntensity: 0.3 }));
    nose.rotation.x = Math.PI / 2; nose.position.set(0, 0.012, 0.16); quad.add(nose);

    const corners = [[a, a, 1], [-a, a, -1], [a, -a, -1], [-a, -a, 1]];   // [x, z, spinDir]
    const armMat = mkMat(VZ.frameDark, { metalness: 0.55, roughness: 0.45 });
    corners.forEach((c) => {
      const dx = c[0], dz = c[1], len = Math.hypot(dx, dz);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.022, len), armMat);
      arm.position.set(dx / 2, 0, dz / 2);
      arm.rotation.y = Math.atan2(dx, dz);
      arm.castShadow = true; quad.add(arm);
      props.push(buildRotor(quad, dx, dz, c[2]));
    });

    const legMat = mkMat(VZ.skid, { metalness: 0.3, roughness: 0.7 });
    [[0.07, 0.1], [-0.07, 0.1], [0.07, -0.1], [-0.07, -0.1]].forEach((p) => {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.1, 10), legMat);
      leg.position.set(p[0], -0.075, p[1]); quad.add(leg);
    });
    [0.1, -0.1].forEach((z) => {
      const skid = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.01, 0.018), legMat);
      skid.position.set(0, -0.123, z); skid.castShadow = true; quad.add(skid);
    });

    quad.userData.props = props;
    return { quad: quad, props: props };
  }

  function initScene3D() {
    const canvas = $('benchCanvas');
    if (!canvas || typeof THREE === 'undefined') return;     // tests strip THREE -> stay headless-safe
    const host = canvas.parentElement || canvas;
    const w = Math.max(2, host.clientWidth || 600), h = Math.max(2, host.clientHeight || 360);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(VZ.bg);

    const camera = new THREE.PerspectiveCamera(42, w / h, 0.01, 100);
    camera.position.set(0.92, 0.66, 1.5);

    const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setSize(w, h, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if ('outputEncoding' in renderer && THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
    if (THREE.ACESFilmicToneMapping) { renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; }

    scene.add(new THREE.AmbientLight(0xffffff, 0.66));
    const key = new THREE.DirectionalLight(0xffffff, 1.05);
    key.position.set(1.6, 2.6, 1.4); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0002;
    key.shadow.camera.near = 0.5; key.shadow.camera.far = 8;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xdbeafe, 0.4);
    fill.position.set(-1.6, 1.0, -1.2); scene.add(fill);

    const ground = new THREE.Mesh(new THREE.CircleGeometry(3.2, 64), new THREE.MeshStandardMaterial({ color: 0xe5e9f0, roughness: 0.96, metalness: 0 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.62; ground.receiveShadow = true; scene.add(ground);
    const grid = new THREE.GridHelper(6, 30, 0xb8c0cc, 0xd3d9e2);
    grid.position.y = -0.6; scene.add(grid);

    // translucent target-attitude reference ring
    const targetRef = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.006, 8, 64), new THREE.MeshBasicMaterial({ color: VZ.target, transparent: true, opacity: 0.5 }));
    targetRef.rotation.x = Math.PI / 2; scene.add(targetRef);

    const built = buildQuad();
    scene.add(built.quad);

    // translucent "estimate ghost": a second craft showing the attitude the
    // controller THINKS it has (θ̂). On the Full-System tab it separates from the
    // solid true drone exactly when the estimator lies (gyro drift / accel noise).
    let ghost = null;
    try {
      const gb = buildQuad();
      gb.quad.traverse((n) => {
        if (n.material) { const ms = Array.isArray(n.material) ? n.material : [n.material]; ms.forEach((m) => { if (m) { m.transparent = true; m.opacity = 0.22; m.depthWrite = false; } }); }
        if (n.castShadow !== undefined) n.castShadow = false;
      });
      gb.quad.visible = false;
      scene.add(gb.quad);
      ghost = gb.quad;
    } catch (e) { ghost = null; }

    let controls = null;
    if (THREE.OrbitControls) {
      controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true; controls.dampingFactor = 0.08;
      controls.minDistance = 1.0; controls.maxDistance = 4.6;
      controls.maxPolarAngle = Math.PI * 0.52; controls.enablePan = false;
      controls.target.set(0, 0.02, 0); controls.update();
    }

    viz = { canvas: canvas, scene: scene, camera: camera, renderer: renderer, controls: controls, quad: built.quad, props: built.props, ghost: ghost, targetRef: targetRef, spinPhase: 0 };
  }
  // ── attitude extraction (same physics as the response chart) ──────────────
  // Live roll angle, its target, and the tracking error in degrees, per mode.
  // The response plays from rollFrom (the angle when the command/gains last changed)
  // toward the commanded setpoint and then HOLDS there — no auto-looping.
  function computeAttitude() {
    let rollDeg = 0, setp = 0, estDeg = null;
    if (state.mode === 'combined') {
      const r = state.combinedResp; const T = (r && r._T) || 4; const tt = Math.max(0, state.playT - state.respT0);
      let s = null;
      if (r && r.samples.length) {
        const idx = (tt >= T) ? r.samples.length - 1 : Math.min(r.samples.length - 1, Math.floor(tt / T * r.samples.length));
        s = r.samples[idx];
      }
      state._clSample = s;
      rollDeg = s ? s.tru : state.setpoint;
      estDeg = s ? s.est : state.setpoint;
      setp = state.setpoint;
      state.lastRoll = rollDeg;
      return { rollDeg: rollDeg, setp: setp, err: setp - rollDeg, estDeg: estDeg };
    }
    if (state.mode === 'fusion') {
      rollDeg = state.fuse.trueAng;                     // solid craft = TRUE attitude
      estDeg = state.fuse.fused;                        // translucent ghost = fused ESTIMATE
      setp = state.fuse.trueAng;
    } else if (state.mode === 'pidstep') {
      const r = state.pidResp;
      const tt = Math.max(0, state.playT - state.respT0);
      let s = null;
      if (r && r.samples.length) {
        const idx = (tt >= r._T) ? r.samples.length - 1 : Math.min(r.samples.length - 1, Math.floor(tt / r._T * r.samples.length));
        s = r.samples[idx];
      }
      state._pidSample = s;
      rollDeg = s ? s.deg : state.setpoint;
      setp = state.setpoint;
    } else { // ziegler: rate-loop response shape scaled from the current roll to the command
      const r = state.znResp; const T = (r && r._T) || 0.6; const tt = Math.max(0, state.playT - state.respT0);
      let y = 1;
      if (r && r.samples.length) { const idx = Math.min(r.samples.length - 1, Math.floor(tt / T * r.samples.length)); y = r.samples[idx].y; }
      rollDeg = state.rollFrom + (state.setpoint - state.rollFrom) * y;
      setp = state.setpoint;
    }
    state.lastRoll = rollDeg;
    return { rollDeg: rollDeg, setp: setp, err: setp - rollDeg };
  }

  // top-left overlay: live roll / target / error / status, refreshed each frame
  function updateAttitudeOverlay(att) {
    const onTgt = Math.abs(att.err) < 1.5;
    const cls = onTgt ? 'good' : 'warn';
    setText('benchAttitude',
      '<div class="att-title">Roll Attitude</div>' +
      `<div class="att-row"><span>Roll</span><strong class="${cls}">${att.rollDeg.toFixed(1)}&deg;</strong></div>` +
      `<div class="att-row"><span>Target</span><strong>${att.setp.toFixed(1)}&deg;</strong></div>` +
      `<div class="att-row"><span>Error</span><strong class="${cls}">${att.err.toFixed(1)}&deg;</strong></div>` +
      `<div class="att-row"><span>Status</span><strong class="${cls}">${onTgt ? 'ON TARGET' : 'CORRECTING'}</strong></div>`
    );
    // the motor whir (started by Apply Step / auto-tune / tab-switch / leaderboard
    // pick) settles quiet once the attitude actually holds the target
    if (onTgt && !state._motorSettled) { state._motorSettled = true; if (window.SFX) window.SFX.motor(false); }
    else if (!onTgt) { state._motorSettled = false; }
  }

  // ── 3-D viewport update — drives the quad's bank from the controlled roll ──
  function updateScene3D(dt) {
    const att = computeAttitude();
    updateAttitudeOverlay(att);
    if (state.mode === 'pidstep') renderPidTerms(state._pidSample);
    if (!viz) return;                                  // tests / no-WebGL: overlay only

    const d = (typeof dt === 'number' && isFinite(dt)) ? Math.min(0.05, Math.max(0, dt)) : 0.016;
    const ease = 1 - Math.exp(-d * 9);

    // ease the airframe toward the commanded bank (roll about the heading axis, +Z)
    const targetRoll = -att.rollDeg * Math.PI / 180;
    viz.quad.rotation.z += (targetRoll - viz.quad.rotation.z) * ease;

    // gentle altitude bob so the model feels alive
    const bob = 0.02 + Math.sin((state.phase || 0) * 1.6) * 0.012;
    viz.quad.position.y = bob;

    // estimate ghost (Fusion + Full-System tabs): show θ̂ as a translucent craft
    // so the gap between what the drone IS and what it THINKS is visible.
    if (viz.ghost) {
      const showGhost = (state.mode === 'combined' || state.mode === 'fusion') && att.estDeg !== null && att.estDeg !== undefined;
      viz.ghost.visible = showGhost;
      if (showGhost) {
        const gRoll = -att.estDeg * Math.PI / 180;
        viz.ghost.rotation.z += (gRoll - viz.ghost.rotation.z) * ease;
        viz.ghost.position.y = bob + 0.001;
      }
    }

    // tilt the translucent reference ring to the target attitude
    viz.targetRef.rotation.z += ((-att.setp * Math.PI / 180) - viz.targetRef.rotation.z) * ease;

    // spin the props; harder correction -> faster spin (counter-rotating pairs)
    const effort = Math.min(1, Math.abs(att.err) / 15);
    const rate = (10 + effort * 40) * d;
    viz.spinPhase += rate;
    viz.props.forEach((p) => { p.rotation.y += rate * (p.userData.spin || 1); });
    // Drive the motor buzz + propeller whoosh pitch/volume off the same
    // correction-effort signal that sets the visual spin rate — a real quad
    // never stops spinning at hover, so use a baseline + effort-scaled fraction.
    if (window.SFX && window.SFX.motorRate) window.SFX.motorRate(0.45 + 0.55 * effort, 1);

    if (viz.controls) viz.controls.update();
    viz.renderer.render(viz.scene, viz.camera);
  }

  function drawScope() {
    const cv = $('scopeCanvas'); if (!cv) return; const ctx = cv.getContext('2d'); if (!ctx) return;
    const w = cv.width, h = cv.height; ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(148,163,184,0.16)'; ctx.lineWidth = 1;
    for (let x = 0; x <= w; x += w / 10) line(ctx, x, 0, x, h);
    for (let y = 0; y <= h; y += h / 5) line(ctx, 0, y, w, y);
    if (state.mode === 'fusion') drawFusionScope(ctx, w, h);
    else if (state.mode === 'ziegler') drawResponseScope(ctx, w, h, state.znResp, '#ffbf00', 1.0);
    else if (state.mode === 'combined') drawCombinedScope(ctx, w, h);
    else drawPidScope(ctx, w, h);
  }

  // Full-System scope: true attitude (solid amber) vs estimated attitude (blue)
  // vs command (dashed green). The gap between amber and blue IS the estimator
  // error the controller is fighting.
  function drawCombinedScope(ctx, w, h) {
    const r = state.combinedResp; if (!r || !r.samples.length) return;
    const cmd = r.cmdDeg;
    let lo = Math.min(0, cmd), hi = Math.max(0, cmd);
    for (const s of r.samples) { lo = Math.min(lo, s.tru, s.est); hi = Math.max(hi, s.tru, s.est); }
    const pad = Math.max(2, (hi - lo) * 0.12); lo -= pad; hi += pad;
    const top = h * 0.1, bot = h * 0.9, span = (hi - lo) || 1, T = r._T;
    const yOf = (v) => bot - (bot - top) * ((v - lo) / span);
    const xOf = (t) => t / T * w;
    // command
    ctx.strokeStyle = 'rgba(16,185,129,0.75)'; ctx.setLineDash([5, 4]); line(ctx, 0, yOf(cmd), w, yOf(cmd)); ctx.setLineDash([]);
    // estimated attitude (what the controller acts on)
    ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 1.6; ctx.beginPath();
    r.samples.forEach((s, i) => { const px = xOf(s.t), py = yOf(s.est); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
    ctx.stroke();
    // true attitude (what the drone actually does)
    ctx.strokeStyle = '#ffbf00'; ctx.lineWidth = Math.max(2, w * 0.003); ctx.beginPath();
    r.samples.forEach((s, i) => { const px = xOf(s.t), py = yOf(s.tru); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
    ctx.stroke();
    // playhead
    const phx = Math.min(1, Math.max(0, (state.playT - state.respT0) / T)) * w;
    ctx.strokeStyle = 'rgba(255,255,255,0.32)'; line(ctx, phx, top, phx, bot);
    ctx.fillStyle = '#ffbf00'; ctx.font = `600 ${Math.max(10, w * 0.013)}px ${ff()}`; ctx.fillText('true', w * 0.04, top + 12);
    ctx.fillStyle = '#60a5fa'; ctx.fillText('estimate', w * 0.14, top + 12);
    ctx.fillStyle = 'rgba(16,185,129,0.9)'; ctx.fillText('command', w * 0.30, top + 12);
    scopeText(ctx, w, h, `${ctrlLabel(state.controller)} × ${estLabel(state.estimator)}  |  track ${r.rmsTrackDeg.toFixed(2)}°  est-err ${r.rmsEstErrDeg.toFixed(2)}°  score ${r.diverged ? 'CRASH' : Calc.scoreFlight(r)}`);
  }

  function drawPidScope(ctx, w, h) {
    const r = state.pidResp;
    if (!r || !r.samples.length) return;
    const T = r._T, cmd = r.cmdDeg, final = r.finalDeg, start = r.theta0Deg;
    let lo = Math.min(0, cmd, final, start), hi = Math.max(0, cmd, final, start);
    for (const s of r.samples) { if (s.deg < lo) lo = s.deg; if (s.deg > hi) hi = s.deg; }
    const pad = Math.max(2, (hi - lo) * 0.12); lo -= pad; hi += pad;
    const top = h * 0.1, bot = h * 0.9, span = (hi - lo) || 1;
    const yOf = (v) => bot - (bot - top) * ((v - lo) / span);
    const xOf = (t) => t / T * w;
    // commanded attitude
    ctx.strokeStyle = 'rgba(16,185,129,0.75)'; ctx.setLineDash([5, 4]); line(ctx, 0, yOf(cmd), w, yOf(cmd)); ctx.setLineDash([]);
    // +/-2% settling band about the achieved steady value
    const band = 0.02 * Math.abs(cmd - start);
    if (band > 0) { ctx.strokeStyle = 'rgba(148,163,184,0.22)'; line(ctx, 0, yOf(final + band), w, yOf(final + band)); line(ctx, 0, yOf(final - band), w, yOf(final - band)); }
    // drooped steady line under a constant disturbance (PD can't reach the command)
    if (state.disturbance && Math.abs(final - cmd) > 0.05) { ctx.strokeStyle = 'rgba(239,68,68,0.55)'; ctx.setLineDash([2, 3]); line(ctx, 0, yOf(final), w, yOf(final)); ctx.setLineDash([]); }
    // response curve
    ctx.strokeStyle = '#ffbf00'; ctx.lineWidth = Math.max(2, w * 0.003); ctx.beginPath();
    r.samples.forEach((s, i) => { const px = xOf(s.t), py = yOf(s.deg); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
    ctx.stroke();
    // playhead
    const phx = Math.min(1, Math.max(0, (state.playT - state.respT0) / T)) * w;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; line(ctx, phx, top, phx, bot);
    scopeText(ctx, w, h, `Kp=${state.Kp.toFixed(2)} Ki=${state.Ki.toFixed(2)} Kd=${state.Kd.toFixed(3)}  |  OS ${r.osPct.toFixed(0)}%  ts ${r.settlingTime.toFixed(2)}s  e_ss ${Math.abs(r.essDeg).toFixed(2)}\u00B0`);
  }

  function drawResponseScope(ctx, w, h, resp, color) {
    if (!resp || !resp.samples.length) return;
    const T = resp._T || resp.samples[resp.samples.length - 1].t;
    const top = h * 0.1, bot = h * 0.9, base = bot, ymax = 2.0;
    const yOf = (v) => base - (bot - top) * (v / ymax);
    ctx.strokeStyle = 'rgba(16,185,129,0.7)'; ctx.setLineDash([5, 4]); line(ctx, 0, yOf(1), w, yOf(1)); ctx.setLineDash([]);
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(2, w * 0.003); ctx.beginPath();
    resp.samples.forEach((s, i) => { const px = s.t / T * w; const py = yOf(s.y); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
    ctx.stroke();
    const phx = Math.min(1, Math.max(0, (state.playT - state.respT0) / T)) * w;
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; line(ctx, phx, top, phx, bot);
    scopeText(ctx, w, h, `${state.tuning === 'manual' ? 'P-only sweep' : state.tuning}  |  overshoot ${resp.osPct.toFixed(0)}%  settling ${resp.settlingTime.toFixed(3)}s  e_ss ${Math.abs(resp.essPct) < 0.5 ? '0' : resp.essPct.toFixed(0)}%`);
  }

  function drawFusionScope(ctx, w, h) {
    const f = state.fuse; if (f.hist.length < 2) return;
    let span = 26;                                                      // +/-deg, auto-grown to fit the command
    for (let i = 0; i < f.hist.length; i++) { const p = f.hist[i]; span = Math.max(span, Math.abs(p.tru) + 8, Math.abs(p.fus) + 8); }
    span = Math.min(span, 90);
    const top = h * 0.08, bot = h * 0.92, mid = (top + bot) / 2;
    const yOf = (v) => mid - (bot - top) / 2 * (v / span);
    const t0 = f.hist[0].t, t1 = f.hist[f.hist.length - 1].t, dur = Math.max(0.5, t1 - t0);
    const xOf = (t) => (t - t0) / dur * w;
    const series = [['acc', 'rgba(148,163,184,0.5)', 1], ['gyro', '#60a5fa', 1.5], ['tru', 'rgba(255,255,255,0.55)', 1.5], ['fus', '#ffbf00', 2.2]];
    series.forEach((s) => {
      ctx.strokeStyle = s[1]; ctx.lineWidth = s[2]; ctx.beginPath();
      f.hist.forEach((p, i) => { const px = xOf(p.t), py = yOf(p[s[0]]); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
      ctx.stroke();
    });
    ctx.fillStyle = '#e2e8f0'; ctx.font = `600 ${Math.max(10, w * 0.013)}px ${ff()}`;
    ctx.fillText('true', w * 0.04, top + 12); ctx.fillStyle = '#60a5fa'; ctx.fillText('gyro (drift)', w * 0.16, top + 12);
    ctx.fillStyle = 'rgba(148,163,184,0.9)'; ctx.fillText('accel (noise)', w * 0.34, top + 12); ctx.fillStyle = '#ffbf00'; ctx.fillText('fused', w * 0.56, top + 12);
    scopeText(ctx, w, h, `alpha=${state.alpha.toFixed(3)}  |  drift ${Calc.driftError(state.imu.gyro_bias_dps, state.alpha, state.imu.dt_s).toFixed(3)} deg  noise ${Calc.noiseRMS(state.imu.accel_noise_deg, state.alpha).toFixed(3)} deg`);
  }

  function scopeText(ctx, w, h, t) { ctx.fillStyle = '#cbd5e1'; ctx.font = `600 ${Math.max(10, w * 0.013)}px ${ff()}`; ctx.fillText(t, w * 0.04, h * 0.97); }
  function ff() { try { return getComputedStyle(document.body).fontFamily || 'Inter, sans-serif'; } catch (e) { return 'Inter, sans-serif'; } }
  function line(ctx, x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', appInit); else appInit();
})();


/* ═══ Instructor + SFX (ported from Exp 1/6, Quiet-Instructor model) ═══ */
const SFX = (function () {
  'use strict';
  let enabled = true;            // gated together with the instructor voice
  let motorOn = false;
  const pool = {};
  const BASE = 'audio/sfx/';
  // User-adjustable effects volume (0-1), separate from the Instructor's
  // narration volume — persisted so it survives a reload. Applied both to the
  // one-shot UI cues below and, via the synthesis graph's master gain, to the
  // live motor buzz + propeller whoosh.
  function readVol(key, fallback) {
    try { const v = parseFloat(localStorage.getItem(key)); return (isFinite(v) && v >= 0 && v <= 1) ? v : fallback; } catch (e) { return fallback; }
  }
  let masterVol = readVol('vlab:sfx:volume', 0.8);
  function el(name, loop) {
    let a = pool[name];
    if (!a) { a = new Audio(BASE + name + '.mp3'); a.preload = 'auto'; if (loop) a.loop = true; pool[name] = a; }
    return a;
  }
  function one(name, vol) {
    if (!enabled) return;
    try { const a = el(name, false); a.currentTime = 0; a.volume = (vol == null ? 0.6 : vol) * masterVol; a.play().catch(function () {}); } catch (e) {}
  }
  // ── Real-time synthesized motor buzz + propeller whoosh (Web Audio API) ──
  // The simulation's motor/propeller sound is GENERATED live every frame from
  // the actual RPM/throttle + propeller-size signals — never a looping
  // recording. Pre-recorded audio is reserved for the Instructor's spoken
  // guidance only (the `one()`/`el()` mp3 helpers above). Built lazily (first
  // motor(true) call, so it lands on a real user gesture) and left running for
  // the page's lifetime; motor(on) only ramps gain, it never restarts nodes.
  let _g = null;
  function _graph() {
    if (_g) return _g;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC();

    // Motor buzz: fundamental + fifth-overtone oscillator through a lowpass.
    const oscA = ctx.createOscillator(); oscA.type = 'sawtooth'; oscA.frequency.value = 90;
    const oscB = ctx.createOscillator(); oscB.type = 'square'; oscB.frequency.value = 135;
    const buzzFilter = ctx.createBiquadFilter(); buzzFilter.type = 'lowpass'; buzzFilter.Q.value = 0.7; buzzFilter.frequency.value = 600;
    const buzzGain = ctx.createGain(); buzzGain.gain.value = 0;
    oscA.connect(buzzFilter); oscB.connect(buzzFilter); buzzFilter.connect(buzzGain);

    // Propeller whoosh: filtered noise, amplitude-modulated at a blade-pass rate.
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource(); noise.buffer = noiseBuf; noise.loop = true;
    const whooshFilter = ctx.createBiquadFilter(); whooshFilter.type = 'bandpass'; whooshFilter.Q.value = 0.9; whooshFilter.frequency.value = 1200;
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 10;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0;
    const whooshGain = ctx.createGain(); whooshGain.gain.value = 0;
    noise.connect(whooshFilter); whooshFilter.connect(whooshGain);
    lfo.connect(lfoGain); lfoGain.connect(whooshGain.gain);

    const master = ctx.createGain(); master.gain.value = masterVol;
    buzzGain.connect(master); whooshGain.connect(master); master.connect(ctx.destination);

    oscA.start(); oscB.start(); noise.start(); lfo.start();
    _g = { ctx: ctx, oscA: oscA, oscB: oscB, buzzFilter: buzzFilter, buzzGain: buzzGain, noise: noise, whooshFilter: whooshFilter, lfo: lfo, lfoGain: lfoGain, whooshGain: whooshGain, master: master };
    return _g;
  }
  function motor(on) {
    motorOn = !!on;
    const g = _graph();
    if (!g) return;
    const t = g.ctx.currentTime;
    if (on && enabled) {
      if (g.ctx.state === 'suspended') g.ctx.resume().catch(function () {});
      g.buzzGain.gain.setTargetAtTime(0.16, t, 0.15);
      g.whooshGain.gain.setTargetAtTime(0.10, t, 0.15);
    } else {
      g.buzzGain.gain.setTargetAtTime(0, t, 0.25);
      g.whooshGain.gain.setTargetAtTime(0, t, 0.25);
    }
  }
  // Live synthesis parameters — called every frame with a normalized
  // RPM/throttle fraction (0-1, may run a bit over 1 at full throttle) and a
  // propeller-size factor (>1 = smaller/higher-pitched, <1 = bigger/deeper).
  // A no-op unless motor(true) is already active. This (not a static
  // playbackRate tweak on a fixed clip) is what makes the tone, the blade-pass
  // "whoop" rate, and the volume all genuinely track the live simulation.
  function motorRate(rpmFrac, sizeFactor) {
    if (!motorOn || !enabled || !_g) return;
    const f = Math.max(0, Math.min(1.3, rpmFrac == null ? 1 : rpmFrac));
    const sz = Math.max(0.5, Math.min(1.6, sizeFactor == null ? 1 : sizeFactor));
    const g = _g, t = g.ctx.currentTime;
    const buzzHz = (75 + f * 340) * sz;   // sz<1 = bigger/deeper prop-motor, sz>1 = smaller/higher-pitched
    g.oscA.frequency.setTargetAtTime(buzzHz, t, 0.05);
    g.oscB.frequency.setTargetAtTime(buzzHz * 1.5, t, 0.05);
    g.buzzFilter.frequency.setTargetAtTime(500 + f * 3200, t, 0.08);
    g.buzzGain.gain.setTargetAtTime(0.30 * f, t, 0.08);   // no floor: f=0 (stopped) → silent

    const bladeHz = 9 + f * 85;   // blade-pass modulation rate scales with rpm
    g.lfo.frequency.setTargetAtTime(bladeHz, t, 0.05);
    g.lfoGain.gain.setTargetAtTime(0.20 * f, t, 0.08);
    g.whooshFilter.frequency.setTargetAtTime((900 + f * 1800) * sz, t, 0.08);
    g.whooshGain.gain.setTargetAtTime(0.18 * f, t, 0.08);   // no floor: matches sim exactly
  }
  function setEnabled(v) {
    enabled = !!v;
    if (!enabled) {
      Object.keys(pool).forEach(function (k) { try { pool[k].pause(); } catch (e) {} });
      if (_g) { const t = _g.ctx.currentTime; _g.buzzGain.gain.cancelScheduledValues(t); _g.whooshGain.gain.cancelScheduledValues(t); _g.buzzGain.gain.setValueAtTime(0, t); _g.whooshGain.gain.setValueAtTime(0, t); try { _g.ctx.suspend(); } catch (e) {} }
    }
    else if (motorOn) { motor(true); }
  }
  // User-facing "Effects" volume slider (0-1) — scales one-shot UI cues AND,
  // via the synthesis graph's single master GainNode, the live motor/prop
  // sound, without touching any of motorRate()'s per-frame formulas.
  function setVolume(v) {
    masterVol = Math.max(0, Math.min(1, v == null ? 1 : v));
    try { localStorage.setItem('vlab:sfx:volume', String(masterVol)); } catch (e) {}
    if (_g) { _g.master.gain.setTargetAtTime(masterVol, _g.ctx.currentTime, 0.05); }
  }
  function getVolume() { return masterVol; }
  return {
    click: function () { one('click', 0.5); },
    lock: function () { one('lock', 0.7); },
    start: function () { one('start', 0.6); },
    success: function () { one('success', 0.7); },
    error: function () { one('error', 0.65); },
    warn: function () { one('warn', 0.6); },
    motor: motor,
    motorRate: motorRate,
    setEnabled: setEnabled,
    setVolume: setVolume,
    getVolume: getVolume
  };
})();
window.SFX = SFX;

const Instructor = (function () {
  'use strict';

  // Pre-recorded natural-voice (Microsoft Edge "Emma" neural TTS) clips for the
  // FIXED guidance strings in Exp 5. Keyed by the EXACT text passed to say().
  // Generated offline via voice_gen/gen_control.py. Quiet-Instructor model:
  // audio only on tab loads, faults and completions — everything else is the
  // silent on-screen bubble.
  const VOICE_CLIPS = {
    'GUIDE: Your plant is the real airframe from the structures experiment — its inertia sets how hard this tune will be. Start by pushing only the proportional gain and watch the trade-off appear.': 'audio/voice/m1_intro.mp3',
    'OBSERVE: There is the proportional trap — chasing zero steady-state error with gain alone buys you violent overshoot. No single knob fixes both.': 'audio/voice/m1_kp_trap.mp3',
    'GUIDE: Now let the method tune for you. Ziegler and Nichols size the gains from the plant itself — set the target and the air resistance, then apply the table.': 'audio/voice/m2_zn_intro.mp3',
    'OBSERVE: Sustained oscillation — the loop’s phase lag has reached one hundred eighty degrees exactly where its gain is one. Note that this only exists because real motors and sensors lag; a perfect textbook drone would ring at every gain.': 'audio/voice/m2_ku_found.mp3',
    'GUIDE: Ziegler-Nichols gains applied. Watch the step: about twenty percent overshoot, settled in roughly a second, zero steady-state error. An eighty-year-old recipe, still taming aircraft.': 'audio/voice/m2_zn_applied.mp3',
    'GUIDE: Two imperfect sensors, one truth. The gyroscope is smooth but drifts; the accelerometer is honest on average but shakes. The filter coefficient alpha decides whom to trust.': 'audio/voice/m3_intro.mp3',
    'WARNING: Pure gyro integration. It looks perfectly clean — and it is quietly walking away from the truth. Come back in thirty seconds and see how far.': 'audio/voice/m3_pure_gyro.mp3',
    'OBSERVE: There is the compromise point — the alpha that minimises drift plus noise together. Neither error can be zeroed alone; engineering is choosing where to lose.': 'audio/voice/m3_optimum.mp3',
    'GUIDE: This is the whole flight control system. Pick a controller and an estimator, fly the closed loop, and let the leaderboard show you which combination flies the tightest.': 'audio/voice/m4_intro.mp3',
    'GUIDE: Flight controller programmed. These exact gains and this exact filter will fly your integrated flight test — they are stored, and they are yours.': 'audio/voice/verdict_pass.mp3'
  };

  const synth = (typeof window !== 'undefined' && window.speechSynthesis) ? window.speechSynthesis : null;
  let ttsEnabled = true;
  // User-adjustable narrator volume (0-1), separate from the SFX "Effects"
  // slider — persisted so it survives a reload.
  function readVol(key, fallback) {
    try { const v = parseFloat(localStorage.getItem(key)); return (isFinite(v) && v >= 0 && v <= 1) ? v : fallback; } catch (e) { return fallback; }
  }
  let narratorVol = readVol('vlab:instructor:volume', 1.0);
  let lastVideoSrc = null;
  let cachedVoice = null;
  let speakQueueToken = 0;
  let audioEl = null;
  let pendingClip = null;
  let pendingClipToken = -1;
  let unlockListening = false;

  function pickVoice() {
    if (!synth) return null;
    const voices = synth.getVoices() || [];
    if (!voices.length) return null;
    if (cachedVoice && voices.indexOf(cachedVoice) !== -1) return cachedVoice;
    const byExactName = ['Google US English', 'Samantha', 'Microsoft Aria Online (Natural) - English (United States)', 'Microsoft Jenny Online (Natural) - English (United States)', 'Microsoft Guy Online (Natural) - English (United States)'];
    for (let i = 0; i < byExactName.length; i++) {
      const v = voices.find(function (v) { return v.name === byExactName[i]; });
      if (v) { cachedVoice = v; return v; }
    }
    const natural = voices.find(function (v) { return /natural|neural|online/i.test(v.name) && /^en/i.test(v.lang); });
    if (natural) { cachedVoice = natural; return natural; }
    const remoteEn = voices.find(function (v) { return /^en/i.test(v.lang) && v.localService === false; });
    if (remoteEn) { cachedVoice = remoteEn; return remoteEn; }
    const anyEn = voices.find(function (v) { return /^en/i.test(v.lang); });
    cachedVoice = anyEn || voices[0];
    return cachedVoice;
  }

  if (synth && typeof synth.addEventListener === 'function') {
    synth.addEventListener('voiceschanged', function () { cachedVoice = null; });
  }

  function setSpeakingIndicator(active) {
    const avatar = document.getElementById('vlInstructorAvatar');
    if (avatar) avatar.classList.toggle('speaking', !!active);
  }

  function getAudioEl() {
    if (!audioEl) {
      audioEl = new Audio();
      audioEl.volume = narratorVol;
      audioEl.addEventListener('play', function () { setSpeakingIndicator(true); });
      audioEl.addEventListener('ended', function () { setSpeakingIndicator(false); });
      audioEl.addEventListener('pause', function () { setSpeakingIndicator(false); });
    }
    return audioEl;
  }

  function stopAll() {
    speakQueueToken++;
    pendingClip = null; pendingClipToken = -1;
    if (synth) synth.cancel();
    if (audioEl) { audioEl.pause(); audioEl.currentTime = 0; }
    setSpeakingIndicator(false);
  }

  function onFirstGesture() {
    window.removeEventListener('pointerdown', onFirstGesture, true);
    window.removeEventListener('keydown', onFirstGesture, true);
    window.removeEventListener('touchstart', onFirstGesture, true);
    unlockListening = false;
    const clip = pendingClip, token = pendingClipToken;
    pendingClip = null; pendingClipToken = -1;
    if (clip && token === speakQueueToken && ttsEnabled) {
      const a = getAudioEl();
      a.src = clip;
      a.play().catch(function () {});
    }
  }

  function armAudioUnlock(clip, token) {
    pendingClip = clip; pendingClipToken = token;
    if (unlockListening) return;
    unlockListening = true;
    window.addEventListener('pointerdown', onFirstGesture, true);
    window.addEventListener('keydown', onFirstGesture, true);
    window.addEventListener('touchstart', onFirstGesture, true);
  }

  function resolveClip(text) {
    if (VOICE_CLIPS[text]) return VOICE_CLIPS[text];
    const plain = String(text).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (VOICE_CLIPS[plain]) return VOICE_CLIPS[plain];
    return null;
  }

  function speakClipOrFallback(text) {
    const myToken = speakQueueToken;
    const clip = resolveClip(text);
    if (!clip) return; // no Emma clip → silent, never robotic
    const a = getAudioEl();
    a.src = clip;
    a.play().catch(function () {
      if (myToken !== speakQueueToken) return;
      armAudioUnlock(clip, myToken);
    });
  }

  // say() also carries dynamic status lines that have NO voice clip (they show
  // on-screen but stay silent by design). The ▶ Replay button must re-speak the
  // last line that was ACTUALLY spoken — so we remember `lastClipText` (the most
  // recent message that resolved to a clip), never a silent status update.
  let lastSaidText = null;
  let lastClipText = null;
  function say(text) {
    lastSaidText = text;
    const el = document.getElementById('liveCommentaryText');
    if (el) el.innerHTML = text;
    const dot = document.getElementById('vlInstructorDot');
    const bubble = document.getElementById('vlInstructorBubble');
    if (dot) dot.hidden = !(bubble && bubble.hidden);
    stopAll();
    const clip = resolveClip(text);
    if (clip) lastClipText = text; // remembered for Replay even while muted
    if (ttsEnabled && clip) {
      const plain = String(text).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      if (window.SFX) {
        if (/^(CAUTION|WARNING|That component)/i.test(plain)) {
          window.SFX.warn();
        } else if (/^OBSERVE: Practical/i.test(plain)) {
          window.SFX.success();
        }
      }
      speakClipOrFallback(text);
    }
  }
  function replayIntro() { if (lastClipText) say(lastClipText); }

  function setTts(enabled) {
    ttsEnabled = !!enabled;
    if (!ttsEnabled) stopAll();
    if (window.SFX) window.SFX.setEnabled(ttsEnabled); // one mute for voice + effects
    const btn = document.getElementById('instructorTtsToggle');
    if (btn) {
      btn.innerHTML = ttsEnabled ? '&#128266;' : '&#128264;';
      btn.classList.toggle('active', ttsEnabled);
      btn.title = ttsEnabled ? 'Voice guidance on — click to mute' : 'Voice guidance muted — click to enable';
    }
    return ttsEnabled;
  }

  // User-facing "Narrator" volume slider (0-1) — separate from SFX's
  // "Effects" slider. Applied to the persistent <audio> element (pre-recorded
  // clips); this experiment has no speechSynthesis fallback to also update.
  function setVolume(v) {
    narratorVol = Math.max(0, Math.min(1, v == null ? 1 : v));
    try { localStorage.setItem('vlab:instructor:volume', String(narratorVol)); } catch (e) {}
    getAudioEl().volume = narratorVol;
  }
  function getVolume() { return narratorVol; }

  function initTtsToggle() {
    const btn = document.getElementById('instructorTtsToggle');
    if (!btn) return;
    btn.style.display = 'flex';
    setTts(ttsEnabled);
    btn.addEventListener('click', function () { setTts(!ttsEnabled); });
  }

  function mountFloating() {
    const fab = document.getElementById('vlInstructorFab');
    const avatar = document.getElementById('vlInstructorAvatar');
    const bubble = document.getElementById('vlInstructorBubble');
    const minimizeBtn = document.getElementById('vlInstructorMinimize');
    const dot = document.getElementById('vlInstructorDot');
    if (!avatar || !bubble) return;
    let dragMoved = false;   // true once a pointerdown-drag has actually moved — suppresses the click-to-toggle
    function setOpen(open) {
      bubble.hidden = !open;
      if (open && dot) dot.hidden = true;
    }
    avatar.addEventListener('click', function () { if (!dragMoved) setOpen(bubble.hidden); });
    if (minimizeBtn) minimizeBtn.addEventListener('click', function (e) { e.stopPropagation(); setOpen(false); });
    setOpen(true);
    ensureReplayButton(bubble);

    const settingsBtn = document.getElementById('instructorSettingsToggle');
    const settingsPanel = document.getElementById('vlInstructorSettings');
    const sfxSlider = document.getElementById('vlSfxVolume');
    const narratorSlider = document.getElementById('vlInstructorVolume');
    if (settingsBtn && settingsPanel) {
      settingsBtn.addEventListener('click', function (e) { e.stopPropagation(); settingsPanel.hidden = !settingsPanel.hidden; });
    }
    if (sfxSlider) {
      sfxSlider.value = String(window.SFX ? window.SFX.getVolume() : 0.8);
      sfxSlider.addEventListener('input', function () { if (window.SFX) window.SFX.setVolume(parseFloat(sfxSlider.value)); });
      sfxSlider.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    }
    if (narratorSlider) {
      narratorSlider.value = String(getVolume());
      narratorSlider.addEventListener('input', function () { setVolume(parseFloat(narratorSlider.value)); });
      narratorSlider.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    }

    if (fab) {
      let dragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;
      function clampPos(left, top) {
        const r = fab.getBoundingClientRect();
        const maxLeft = window.innerWidth - r.width - 4;
        const maxTop = window.innerHeight - r.height - 4;
        return { left: Math.max(4, Math.min(Math.max(4, maxLeft), left)), top: Math.max(4, Math.min(Math.max(4, maxTop), top)) };
      }
      // Apply a clamped left/top position as right/bottom offsets: the FAB is
      // anchored to the avatar's bottom-right corner, so opening, minimizing
      // or resizing the bubble grows upward/leftward and never displaces the
      // avatar from where the user parked it.
      function applyAnchored(pos) {
        const r = fab.getBoundingClientRect();
        fab.style.right = Math.max(4, Math.round(window.innerWidth - pos.left - r.width)) + 'px';
        fab.style.bottom = Math.max(4, Math.round(window.innerHeight - pos.top - r.height)) + 'px';
        fab.style.left = 'auto'; fab.style.top = 'auto';
      }
      function onPointerMove(e) {
        if (!dragging) return;
        const dx = e.clientX - startX, dy = e.clientY - startY;
        if (!dragMoved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) dragMoved = true;
        if (!dragMoved) return;
        const pos = clampPos(startLeft + dx, startTop + dy);
        applyAnchored(pos);
      }
      function onPointerUp() {
        dragging = false;
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        if (dragMoved) {
          try { localStorage.setItem('vlab:instructor:pos', JSON.stringify({ right: parseFloat(fab.style.right) || 22, bottom: parseFloat(fab.style.bottom) || 22 })); } catch (e) {}
        }
      }
      function onPointerDown(e) {
        dragging = true; dragMoved = false;
        const r = fab.getBoundingClientRect();
        startX = e.clientX; startY = e.clientY; startLeft = r.left; startTop = r.top;
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
      }
      avatar.addEventListener('pointerdown', onPointerDown);
      const head = fab.querySelector('.vl-instructor-head');
      if (head) head.addEventListener('pointerdown', onPointerDown);

      try {
        const saved = JSON.parse(localStorage.getItem('vlab:instructor:pos'));
        if (saved && isFinite(saved.right) && isFinite(saved.bottom)) {
          fab.style.right = Math.min(Math.max(4, saved.right), window.innerWidth - 60) + 'px';
          fab.style.bottom = Math.min(Math.max(4, saved.bottom), window.innerHeight - 60) + 'px';
          fab.style.left = 'auto'; fab.style.top = 'auto';
        }
      } catch (e) {}
    }
  }

  // Adds a small ▶ "replay last guidance" control inside the scrollable
  // .vl-instructor-body (not appended as a bare sibling, which would grow the
  // bubble's total height unboundedly beyond its bounded scroll area).
  function ensureReplayButton(bubble) {
    if (!bubble || document.getElementById('instructorReplayBtn')) return;
    const body = bubble.querySelector('.vl-instructor-body') || bubble;
    const btn = document.createElement('button');
    btn.id = 'instructorReplayBtn'; btn.type = 'button';
    btn.title = 'Replay the last guidance'; btn.setAttribute('aria-label', 'Replay the last guidance');
    btn.innerHTML = '&#9654; Replay intro';
    btn.style.cssText = 'margin-top:8px;display:inline-flex;align-items:center;gap:6px;font-size:11px;line-height:1;padding:5px 9px;border:1px solid rgba(0,0,0,0.15);border-radius:999px;background:#f1f5f9;color:#334155;cursor:pointer;';
    btn.addEventListener('click', function (e) { e.stopPropagation(); e.preventDefault(); replayIntro(); });
    body.appendChild(btn);
  }

  function loadVideo(containerId, src, opts) {
    const container = document.getElementById(containerId);
    if (!container || !src) return;
    const caption = (opts && opts.caption) || '';
    if (lastVideoSrc === src && container.style.display !== 'none') return;
    fetch(src, { method: 'HEAD' }).then(function (res) {
      if (!res.ok) throw new Error('missing');
      container.innerHTML =
        '<video autoplay muted loop playsinline preload="metadata" style="width:100%; display:block;">' +
        '<source src="' + src + '" type="video/mp4"></video>';
      container.style.display = 'block';
      lastVideoSrc = src;
      if (caption) say(caption);
    }).catch(function () {
      container.style.display = 'none';
      container.innerHTML = '';
      lastVideoSrc = null;
      if (caption) say(caption);
    });
  }

  return {
    say: say,
    setTts: setTts,
    initTtsToggle: initTtsToggle,
    mountFloating: mountFloating,
    loadVideo: loadVideo,
    isTtsAvailable: function () { return !!synth; },
    setVolume: setVolume,
    getVolume: getVolume
  };
})();
window.Instructor = Instructor;


/* ── Strict guided-build gate ────────────────────────────────────────────────
 * Exp 5 (flight control) derives the roll inertia J from Exp 2's mass + arm
 * length. Gate until Exp 2 (frame structural integrity) is finalized.
 * ---------------------------------------------------------------------------*/
(function () {
  if (typeof window === 'undefined') return;
  function mount() {
    try { if (window.VLABUi && window.VLABUi.autoGate) window.VLABUi.autoGate('exp5'); } catch (e) { /* gate optional */ }
    // Cross-experiment staleness banner: if Exp 2 re-finalizes (different mass /
    // geometry → different J → the gains no longer fit), flag Exp 5 for a retune.
    try {
      const host = document.getElementById('vlBannerHost');
      if (host && window.VLABUi && window.VLABUi.mountBanner) {
        const b = window.VLABUi.mountBanner(host, {
          catalog: window.VLAB_CATALOG || {}, currentExp: 'exp5',
          onChange: function () {
            if (window.Instructor) window.Instructor.say('Section to revisit: Experiment 5 — the airframe changed upstream, so retune for the new inertia.');
          }
        });
        window.__vlabBannerRefresh = b && b.refresh;
      }
    } catch (e) { /* banner optional */ }
    if (window.Instructor) { window.Instructor.mountFloating(); window.Instructor.initTtsToggle(); }
  }
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', mount);
  else mount();
})();


// ── Mobile viewport pinning ──────────────────────────────────────────────
// On phones (the same breakpoint where the columns stack) the 3D viewport
// (tab bar + canvas) is hoisted to the top of the page and made sticky, so
// the live simulation stays visible while the user scrolls the inputs and
// result panels beneath it. Fully reversible on rotate/resize back to desktop.
(function () {
  if (typeof document === 'undefined') return;
  function init() {
    var main = document.querySelector('main.workspace');
    var tabs = document.querySelector('.viewport-tabs');
    var host = document.querySelector('.canvas-wrapper');
    if (!main || !host) return;
    var moved = tabs ? [tabs, host] : [host];
    var home = moved.map(function (el) { return { el: el, parent: el.parentElement, next: el.nextSibling }; });
    var pin = document.createElement('div');
    pin.className = 'vl-mobile-pin';
    var mq = window.matchMedia('(max-width: 1080px)');
    function apply() {
      if (mq.matches && !pin.parentElement) {
        moved.forEach(function (el) { pin.appendChild(el); });
        main.insertBefore(pin, main.firstChild);
      } else if (!mq.matches && pin.parentElement) {
        for (var i = home.length - 1; i >= 0; i--) home[i].parent.insertBefore(home[i].el, home[i].next);
        pin.remove();
      } else { return; }
      window.dispatchEvent(new Event('resize'));
    }
    if (mq.addEventListener) mq.addEventListener('change', apply); else mq.addListener(apply);
    apply();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
