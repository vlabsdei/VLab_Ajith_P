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
    exp5: { components: [], env: [], slices: { exp2: ['total_mass_g', 'arm_length_mm', 'cg_offset_mm'] } },
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

/* ===== SHARED PRELUDE 5/7: vlab-override.js (patched: no cross-experiment navigation, per redesign/README.md #4-5) ===== */
/* ===== SHARED PRELUDE 4.5/6: vlab-override.js ===== */
/* ============================================================================
 * Drone Technology Virtual Lab — Validated Cross-Experiment Parameter Overrides
 *
 * A handful of `components` fields (frameId, batteryId) are selectable from
 * more than one experiment's own UI, since they're a single shared value in
 * VLABStore rather than owned by one experiment. When a "further" experiment
 * changes one of these after an "earlier" experiment already built around it,
 * the write must be validated in real time — reject it if it would break the
 * other experiment's build (e.g. a frame that no longer fits the locked
 * propeller), accept it (and record history) if it doesn't. The earlier
 * experiment can then revert to its previous pick, in sequential order, via
 * the same validated path.
 *
 * Vendored identical into each experiment's simulation/js/ folder.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const Store = root.VLABStore;
  const Validate = root.VLABValidate;

  const FIELD_LABELS = { frameId: 'Frame', batteryId: 'Battery', propId: 'Propeller' };
  const EXP_LABELS = { exp1: 'Experiment 1 (Propulsion System Design)', exp2: 'Experiment 2 (Frame & Structural Integrity)', exp3: 'Experiment 3 (Aerodynamic Analysis)' };

  function fieldLabel(field) { return FIELD_LABELS[field] || field; }
  function expLabel(exp) { return EXP_LABELS[exp] || exp; }

  // Runs the real cross-experiment constraint checks against a candidate
  // build; any error-severity violation blocks the write.
  function validateCandidate(candidate) {
    if (!Validate) return { ok: true };
    const catalog = root.VLAB_CATALOG || {};
    const res = Validate.check(catalog, candidate);
    const err = (res.violations || []).find(function (v) { return v.severity === 'error'; });
    if (err) return { ok: false, reason: err.detail };
    return { ok: true };
  }

  /** Attempt a validated write to a shared field. Returns {ok, changed, reason}. */
  function trySet(field, value, byExp) {
    if (!Store) return { ok: true, changed: false };
    return Store.setComponentValidated(field, value, byExp, validateCandidate);
  }

  /**
   * Commits a write to a shared field WITHOUT running validateCandidate —
   * still records history/ownership so other experiments can see who last
   * touched it and revert. Use this when `byExp` is the field's own
   * authoritative source (e.g. Exp 1 picking its own battery/frame), because
   * validateCandidate checks against the LAST-FINALIZED exp1/exp2 outputs,
   * which were computed for the OLD value — for a field's own owner this is
   * stale by definition (the owner is about to recompute fresh outputs for
   * the NEW value right after this write, via its own pipeline + Lock-button
   * gate) and would otherwise cause spurious self-rejections. A genuinely
   * downstream experiment overriding a field it doesn't own must still go
   * through `trySet`, since it has no way to recompute the owner's physics
   * itself and the stale-but-fixed check is the best it can do.
   */
  function trySetOwned(field, value, byExp) {
    if (!Store) return { ok: true, changed: false };
    return Store.setComponentValidated(field, value, byExp, function () { return { ok: true }; });
  }

  /** Attempt to revert a shared field to its previous value. Returns {ok, value, reason}. */
  function tryRevert(field, byExp) {
    if (!Store) return { ok: false, reason: 'Store unavailable.' };
    return Store.revertComponent(field, byExp, validateCandidate);
  }

  /**
   * Renders (into `host`) a small "changed by Experiment N — revert?" notice
   * for `field` when its current owner is a DIFFERENT experiment than
   * `selfExp` and there's history to revert to. Hides itself otherwise.
   * `onRevert(newValueId)` is called after a successful revert so the caller
   * can refresh its own local selection state.
   */
  function mountOverrideNotice(host, field, selfExp, onRevert) {
    if (!host || !Store) return;
    const owner = Store.getOwner(field);
    const history = Store.getHistory(field);
    if (!owner || owner === selfExp || !history.length) {
      host.innerHTML = '';
      host.style.display = 'none';
      return;
    }
    host.style.display = 'block';
    host.innerHTML =
      '<div class="vl-override-notice">' +
        '<span><strong>' + fieldLabel(field) + '</strong> was last changed by ' + expLabel(owner) + '.</span> ' +
        '<button type="button" class="vl-btn vl-btn--sm" data-vl-revert="' + field + '">Revert to my previous selection</button>' +
      '</div>';
    const btn = host.querySelector('[data-vl-revert]');
    if (btn) {
      btn.addEventListener('click', function () {
        const result = tryRevert(field, selfExp);
        if (result.ok) {
          if (onRevert) onRevert(result.value);
          mountOverrideNotice(host, field, selfExp, onRevert);
        } else if (root.Instructor) {
          root.Instructor.say('<strong>Cannot revert:</strong> ' + (result.reason || 'unknown reason') + ' Section to revisit: fix the conflict first.');
        }
      });
    }
  }

  root.VLABOverride = {
    trySet: trySet,
    trySetOwned: trySetOwned,
    tryRevert: tryRevert,
    mountOverrideNotice: mountOverrideNotice,
    fieldLabel: fieldLabel,
    expLabel: expLabel
  };
}(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this)));


/* ===== SHARED PRELUDE 6/7: vlab-ui.js (patched: no cross-experiment navigation, per redesign/README.md #4-5) ===== */
/* ===== SHARED PRELUDE 5/6: vlab-ui.js ===== */
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
      '.vl-btn--sm{padding:4px 9px;font-size:11.5px}' +
      '.vl-override-notice{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;background:#eef2ff;border:1px solid #c7d2fe;color:#3730a3;border-radius:9px;padding:8px 11px;margin:8px 0;font:500 12.5px Inter,system-ui,sans-serif}' +
      '.vl-override-notice .vl-btn--sm{border-color:#6366f1;color:#3730a3}' +
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

      // Cross-experiment navigation is NOT supported (each experiment is a
      // separately-hosted page) — never render a link/button that jumps to
      // another experiment. Instead, name the section to revisit as plain
      // text so the user knows what to go fix without a broken/unsupported
      // "Open Experiment N" action.
      const sectionName = function (expId) {
        const e = EXP[expId];
        return e ? ('Experiment ' + e.n + ' (' + e.title + ')') : expId;
      };

      // Staleness first: a downstream experiment the user already finished is now
      // invalidated by a change here (data kept, just needs review).
      (res.stale || []).filter((id) => id !== opts.currentExp).forEach((id) => {
        const e = EXP[id]; if (!e) return;
        html.push(alertHtml('stale', sectionName(id) + ' needs review',
          'A change here invalidated your finalized ' + e.title + ' result. Your data is kept — revisit ' + sectionName(id) + ' separately to re-validate it.',
          ''));
      });

      // Validation violations: "change" options act on THIS page (safe, no
      // navigation); "redo" options only ever named ANOTHER experiment to
      // revisit, so fold them into the detail text as plain section names.
      (res.violations || []).forEach((v) => {
        const kind = v.severity === 'error' ? 'error' : 'warn';
        // Only ever name another experiment the student has actually CONDUCTED
        // (finalized) — never surface a not-yet-done future experiment, and
        // never point back at the page you're already on.
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
      // Cross-experiment navigation is NOT supported (separately-hosted
      // pages) — no link/button here, just name the section(s) to visit.
      const names = items.map((it) => EXP[it.id] ? ('Experiment ' + EXP[it.id].n + ' (' + EXP[it.id].title + ')') : it.id).join(', ');
      el.innerHTML =
        '<div class="vl-alert vl-alert--warn vl-gate">' + (ICON.warn || '') +
        '<div class="vl-alert__body"><div class="vl-alert__title">Complete the previous step first</div>' +
        '<div class="vl-alert__detail">This experiment strictly builds on your choices from ' + esc(names) +
        '. Finish and lock ' + (items.length > 1 ? 'those experiments' : 'that experiment') +
        ' (visit ' + (items.length > 1 ? 'them' : 'it') + ' separately) so this one uses your real drone values, not placeholders.</div></div></div>';
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


/* ===== SHARED PRELUDE 7/7: vlab-lab.js ===== */
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
    el.className = (el.className.replace(/\bvlab-verdict\b[^\s]*/g, '').trim() + ' vlab-verdict ' + tone).trim();
    el.innerHTML = '<span>' + esc(cfg.label || '') + '</span>' + (cfg.note ? '<span class="vlab-verdict__note">' + esc(cfg.note) + '</span>' : '');
  }

  return { objectives: objectives, scenario: scenario, verdict: verdict, injectStyles: injectStylesOnce };
}));

/* ===== EXP3 MAIN.JS (module-specific code below) ===== */
// Suppress external platform-injected extension/sandbox warnings
window.addEventListener('unhandledrejection', function (event) {
  if (event.reason && (String(event.reason.message || event.reason).includes('tabs:outgoing.message.ready') || String(event.reason.message || event.reason).includes('No Listener'))) {
    event.preventDefault();
  }
});
window.addEventListener('error', function (event) {
  if (event.message && (event.message.includes('tabs:outgoing.message.ready') || event.message.includes('No Listener'))) {
    event.preventDefault();
  }
});

/* global THREE, Chart */

// Global Chart.js Defaults
if (typeof Chart !== 'undefined') {
  Chart.defaults.font.family = 'Inter';
  Chart.defaults.font.size = 10;
  Chart.defaults.responsive = true;
  Chart.defaults.maintainAspectRatio = false;
  if (Chart.defaults.scale && Chart.defaults.scale.grid) {
    Chart.defaults.scale.grid.color = '#f3f4f6';
  }

  // Register the annotation plugin (loaded via UMD <script> tag) so the reference-line
  // markers — the 75% span line on the pitch-twist chart and the stall-threshold line on
  // the local-AoA chart — actually render. Without this the annotation config is silently
  // ignored. Registering an already-auto-registered plugin is a harmless no-op (deduped by id).
  var _annotationPlugin = window['chartjs-plugin-annotation'];
  if (_annotationPlugin && _annotationPlugin.default) _annotationPlugin = _annotationPlugin.default;
  if (_annotationPlugin) {
    try { Chart.register(_annotationPlugin); } catch (e) { /* already registered */ }
  }
}

// ═══════════════════════════════════════════════════════════════════
// 1. CALC IIFE — Pure Physics Engine
// ═══════════════════════════════════════════════════════════════════
const Calc = (function () {
  'use strict';

  const RHO_SL      = 1.225;
  const MU_AIR      = 1.81e-5;
  const TWO_PI      = 2 * Math.PI;
  const DEG_TO_RAD  = Math.PI / 180;
  const AR_EFF      = 6.0;
  const OSWALD_E    = 0.85;
  const K_PROFILE   = 0.013;   // 2-D profile-drag curvature (form drag rise with lift).
                               // NOT finite-wing induced drag — BEMT already models 3-D
                               // losses via the Prandtl tip factor + induced inflow.
  const BEMT_STATIONS = 12;
  const BEMT_MAX_ITER = 50;
  const BEMT_TOL      = 1e-6;
  // Reynolds penalty (override C6 §3.1): a small-prop section at tip Re ~50k
  // makes less lift and more drag than the 2-D reference polar measured at
  // Re_ref. Cl scales by min(1,(Re/Re_ref)^0.25); profile drag rises inversely.
  const RE_REF      = (window.VLAB_CONST && window.VLAB_CONST.REAL.reynolds_ref) || 150000;
  const RE_EXP      = (window.VLAB_CONST && window.VLAB_CONST.REAL.reynolds_exp) || 0.25;

  function airDensity(h_m) {
    const h = Math.max(0, Math.min(11000, h_m));
    return 1.225 * Math.pow(1.0 - 2.25577e-5 * h, 4.25588);
  }

  // Single catalog source (store rule §4.2): prefer the bundled window.VLAB_CATALOG
  // (deep-cloned so downstream seeding never mutates the shared global), fall back
  // to fetching db/db.json only if the global is unavailable. Returns a Promise so
  // it drops into the existing fetch().then() boot chains unchanged. Airfoils are
  // manufactured (seeded ±tol) here so every live calc uses as-built sections while
  // the deep clone preserves the untouched nominal for spec-sheet labels.
  function loadCatalog() {
    if (window.VLAB_CATALOG) {
      var cat = JSON.parse(JSON.stringify(window.VLAB_CATALOG));
      if (Array.isArray(cat.naca_airfoils)) cat.naca_airfoils = cat.naca_airfoils.map(manufactureAirfoil);
      return Promise.resolve(cat);
    }
    return fetch('db/db.json').then(function (r) { return r.json(); }).then(function (data) {
      if (data && Array.isArray(data.naca_airfoils)) data.naca_airfoils = data.naca_airfoils.map(manufactureAirfoil);
      return data;
    });
  }

  // Reynolds lift-degradation factor in (0,1]. Re>=Re_ref → 1 (no bonus above
  // reference); low Re → <1. Guards non-finite/zero Re (returns 1, i.e. no data).
  function reynoldsPenalty(Re) {
    if (!isFinite(Re) || Re <= 0) return 1;
    return Math.min(1, Math.pow(Re / RE_REF, RE_EXP));
  }

  // Seeded "as-manufactured" airfoil: surface-finish / build-quality spread
  // perturbs cl_max ±4% and cd0 ±6%, deterministic per profile id (§3.1). The
  // nominal catalog value stays for spec-sheet labels; every LIVE calc uses this.
  function manufactureAirfoil(airfoil) {
    if (!airfoil) return airfoil;
    var C = window.VLAB_CONST;
    if (!C || !C.applyTol) return airfoil;
    var id = airfoil.id || airfoil.name || 'airfoil';
    return Object.assign({}, airfoil, {
      cl_max: C.applyTol(airfoil.cl_max, 0.04, id + ':clmax'),
      cd0:    C.applyTol(airfoil.cd0,    0.06, id + ':cd0'),
      _nominal_cl_max: airfoil.cl_max,
      _nominal_cd0:    airfoil.cd0,
      _manufactured:   true
    });
  }

  // PDF's thin-airfoil reference line Cl = 2π·(α − α₀) (override C6 — the
  // pre-stall theory that keeps climbing because it can't see separation). α in
  // rad inside; returns uncapped Cl so the divergence past stall is visible.
  function airfoilClThin(alpha_deg, airfoil) {
    var a0 = airfoil.alpha_0_deg || 0;
    return TWO_PI * (alpha_deg - a0) * DEG_TO_RAD;
  }

  // airfoilCl(alpha_deg, airfoil, Re?) — section lift. When Re is supplied the
  // whole curve is scaled by the Reynolds penalty (low-Re props lose lift).
  function airfoilCl(alpha_deg, airfoil, Re) {
    const a0     = airfoil.alpha_0_deg;
    const aStall = airfoil.stall_angle_deg;
    const clMax  = airfoil.cl_max;
    const aStallNeg = a0 - (aStall - a0);          // symmetric negative stall angle
    const span   = (aStall - a0);                  // attached half-range (deg)
    const kRe    = (Re === undefined) ? 1 : reynoldsPenalty(Re);

    if (alpha_deg > aStall) {
      const dd = alpha_deg - aStall;               // degrees past positive stall
      return kRe * clMax * Math.max(0.70, 1 - 0.035 * dd);
    } else if (alpha_deg < aStallNeg) {
      const dn = aStallNeg - alpha_deg;            // degrees past negative stall
      return -kRe * clMax * Math.max(0.70, 1 - 0.035 * dn);
    }
    // Attached region — sine lift curve: near-physical (~2π/rad) slope at the zero-lift
    // angle while reaching cl_max EXACTLY at the stall angle (so the stall flag aligns
    // with the true lift peak). t = -1 at negative stall, +1 at positive stall.
    const t = span > 1e-6 ? (alpha_deg - a0) / span : 0;
    return kRe * clMax * Math.sin((Math.PI / 2) * t);
  }

  // airfoilCd(cl, alpha_deg, airfoil, Re?) — section drag. Low Re thickens the
  // profile-drag bucket (viscous), so cd0 is divided by the Reynolds penalty.
  function airfoilCd(cl, alpha_deg, airfoil, Re) {
    const kRe = (Re === undefined) ? 1 : reynoldsPenalty(Re);
    const cd0_eff = airfoil.cd0 / Math.max(0.5, kRe);    // viscous drag grows at low Re
    const cd_polar = cd0_eff + K_PROFILE * cl * cl;      // 2-D profile drag bucket
    const aStallNeg = airfoil.alpha_0_deg - (airfoil.stall_angle_deg - airfoil.alpha_0_deg);
    // Separation drag rises sharply once the section stalls (either sign)
    if (alpha_deg >= airfoil.stall_angle_deg) {
      const da = (alpha_deg - airfoil.stall_angle_deg) * DEG_TO_RAD;
      return cd_polar + 0.03 + 1.10 * Math.sin(da) * Math.sin(da);
    } else if (alpha_deg <= aStallNeg) {
      const dn = (aStallNeg - alpha_deg) * DEG_TO_RAD;
      return cd_polar + 0.03 + 1.10 * Math.sin(dn) * Math.sin(dn);
    }
    return cd_polar;
  }

  function liftToDrag(alpha_deg, airfoil) {
    const cl = airfoilCl(alpha_deg, airfoil);
    const cd = airfoilCd(cl, alpha_deg, airfoil);
    return cd > 0 ? cl / cd : 0;
  }

  // ── Finite-wing (3-D) airfoil model — used by the Module-1 airfoil analysis ──
  // The Module-1 view analyses a real wing made from the section, so the 2-D
  // section slope must be reduced by downwash (Prandtl lifting-line):
  //   a_3D = a_2D / (1 + a_2D / (pi * e * AR)),  Cl = a_3D * (alpha - alpha_0)
  // and induced drag Cd_i = Cl^2 / (pi * e * AR) is added to the profile drag.
  // This makes the previously-dead cl_alpha_per_rad / ar_eff / oswald_e live.
  function airfoilClFiniteWing(alpha_deg, airfoil) {
    const a0     = airfoil.alpha_0_deg;
    const aStall = airfoil.stall_angle_deg;
    const clMax  = airfoil.cl_max;
    const a2d    = airfoil.cl_alpha_per_rad || TWO_PI;      // 2-D slope [1/rad]
    const AR     = airfoil.ar_eff || AR_EFF;
    const e      = airfoil.oswald_e || OSWALD_E;
    const a3d    = a2d / (1 + a2d / (Math.PI * e * AR));    // finite-wing slope [1/rad]
    const aStallNeg = a0 - (aStall - a0);
    // Peak (finite-wing) lift at the stall angle — lower than the 2-D section
    // cl_max because the reduced 3-D slope hasn't reached it yet; post-stall
    // decays continuously from this value (no jump at the stall angle).
    const clStall = Math.min(clMax, a3d * (aStall - a0) * DEG_TO_RAD);
    if (alpha_deg > aStall) { const dd = alpha_deg - aStall; return clStall * Math.max(0.70, 1 - 0.035 * dd); }
    if (alpha_deg < aStallNeg) { const dn = aStallNeg - alpha_deg; return -clStall * Math.max(0.70, 1 - 0.035 * dn); }
    const cl = a3d * (alpha_deg - a0) * DEG_TO_RAD;          // linear attached region
    return Math.max(-clStall, Math.min(clStall, cl));        // clamp to finite-wing peak
  }

  function airfoilCdFiniteWing(alpha_deg, airfoil) {
    const cl  = airfoilClFiniteWing(alpha_deg, airfoil);
    const AR  = airfoil.ar_eff || AR_EFF;
    const e   = airfoil.oswald_e || OSWALD_E;
    const cd  = airfoilCd(cl, alpha_deg, airfoil);           // profile + separation bucket
    const cdi = (cl * cl) / (Math.PI * e * AR);              // induced drag
    return cd + cdi;
  }

  function liftToDragFiniteWing(alpha_deg, airfoil) {
    const cl = airfoilClFiniteWing(alpha_deg, airfoil);
    const cd = airfoilCdFiniteWing(alpha_deg, airfoil);
    return cd > 0 ? cl / cd : 0;
  }

  function buildPropDef(params) {
    const D_m      = params.D_in * 0.0254;
    const R_m      = D_m / 2;
    const c_mean_m = ((params.c_root_mm + params.c_tip_mm) / 2) / 1000;
    const sigma    = (params.N * c_mean_m) / (Math.PI * R_m);
    const theta_75_deg = params.theta_root_deg + (params.theta_tip_deg - params.theta_root_deg) * 0.75;
    const pitchRatio   = Math.tan(theta_75_deg * DEG_TO_RAD) * Math.PI;
    const AR       = R_m / c_mean_m;
    const t_mean_m = 0.12 * c_mean_m;
    const V_blade  = (Math.PI / 4) * c_mean_m * t_mean_m * R_m;
    const mass_g   = params.N * params.material.density_kg_m3 * V_blade * 1000;

    const stations = Array.from({ length: BEMT_STATIONS }, function(_, i) {
      const t      = i / (BEMT_STATIONS - 1);
      const r_frac = 0.15 + t * 0.85;
      return {
        r_frac: r_frac,
        r_m:    r_frac * R_m,
        chord_m: ((params.c_root_mm + (params.c_tip_mm - params.c_root_mm) * t) / 1000),
        theta_rad: (params.theta_root_deg + (params.theta_tip_deg - params.theta_root_deg) * t) * DEG_TO_RAD
      };
    });

    return Object.assign({}, params, { D_m, R_m, c_mean_m, sigma, pitchRatio, AR, t_mean_m, V_blade, mass_g, stations });
  }

  function runBEMT(propDef, rpm, V_mps, rho) {
    if (rpm <= 0 || !propDef) return null;
    const omega = rpm * TWO_PI / 60;
    const n     = rpm / 60;
    const A     = Math.PI * propDef.R_m * propDef.R_m;
    if (A <= 0) return null;
    const airfoil = propDef.airfoil;
    const dr      = propDef.R_m * (0.85 / (BEMT_STATIONS - 1));

    var T_total = 0, Q_total = 0;
    var elementData = [];

    // Proper BEMT: solve the LOCAL induced velocity v_i per annulus by coupling the
    // blade-element thrust with annular momentum theory (Prandtl tip-loss F included).
    //   BET:       dT = ½ρ·Vrel²·N·c·(Cl·cosφ − Cd·sinφ)
    //   Momentum:  dT = 4π·r·ρ·(V + v_i)·v_i·F
    propDef.stations.forEach(function(st) {
      var U_t = omega * st.r_m;
      var Vrel, phi, alpha_deg, cl, cd;

      // g(v) = v_new(v) - v, the BET/momentum-theory residual for this station's
      // induced velocity. g(0) > 0 (attached flow gives a positive induced-velocity
      // demand) and g(60) < 0 (very high assumed v collapses dT_BET to ~0, so
      // v_new -> 0 while v itself is 60) — a guaranteed sign change, so BISECTION
      // (not the old naive 50/50 fixed-point relaxation) finds a consistent root
      // every time. The old relaxation could fail to converge in BEMT_MAX_ITER
      // steps right where dT_BET crosses zero (alpha flips sign each pass), which
      // produced a non-physical jagged/discontinuous T(V) sweep — verified via a
      // reproducible test case (10in NACA0012 default prop, RPM 8000, V=13 m/s:
      // tip station alpha snapped to -14° vs ~0° at V=12/14 m/s neighbors).
      function vNewOf(v_i) {
        var U_a = V_mps + v_i;
        var vr = Math.sqrt(U_t * U_t + U_a * U_a);
        if (vr < 1e-6) return { v_new: 0, phi: 0, vrel: vr };
        var ph = Math.atan2(U_a, U_t);
        var sinPhi = Math.sin(ph);
        var a_deg = (st.theta_rad - ph) / DEG_TO_RAD;
        var c_l = airfoilCl(a_deg, airfoil);
        var c_d = airfoilCd(c_l, a_deg, airfoil);
        var f_exp = Math.max(0, (propDef.N / 2) * (1 - st.r_frac) / (st.r_frac * Math.abs(sinPhi) + 1e-9));
        var F = (2 / Math.PI) * Math.acos(Math.min(1.0, Math.exp(-f_exp)));
        var dT_BET = 0.5 * rho * vr * vr * propDef.N * st.chord_m * (c_l * Math.cos(ph) - c_d * sinPhi);
        var K = 4 * Math.PI * st.r_m * rho * Math.max(F, 1e-3);
        var vn;
        if (V_mps < 0.05) {
          vn = Math.sqrt(Math.max(0, dT_BET) / Math.max(K, 1e-9));          // hover
        } else {
          var disc = (K * V_mps) * (K * V_mps) + 4 * K * Math.max(0, dT_BET);  // climb
          vn = (-K * V_mps + Math.sqrt(Math.max(0, disc))) / (2 * K);
        }
        return { v_new: Math.max(0, Math.min(60, vn)), phi: ph, vrel: vr };
      }

      var lo = 0, hi = 60;
      var gLo = vNewOf(lo).v_new - lo;
      var gHi = vNewOf(hi).v_new - hi;
      var v_i;
      if (gLo <= 0) {
        v_i = 0;                          // no induced-velocity demand at all (deep negative AoA)
      } else if (gHi >= 0) {
        v_i = hi;                         // saturates the bracket (extreme edge case)
      } else {
        for (var iter = 0; iter < BEMT_MAX_ITER; iter++) {
          var mid = 0.5 * (lo + hi);
          var gMid = vNewOf(mid).v_new - mid;
          if (Math.abs(gMid) < BEMT_TOL || (hi - lo) < BEMT_TOL) { lo = hi = mid; break; }
          if ((gMid > 0) === (gLo > 0)) { lo = mid; gLo = gMid; } else { hi = mid; }
        }
        v_i = 0.5 * (lo + hi);
      }

      var U_a_f = V_mps + v_i;
      Vrel = Math.sqrt(U_t * U_t + U_a_f * U_a_f);
      phi   = Math.atan2(U_a_f, U_t);
      alpha_deg = (st.theta_rad - phi) / DEG_TO_RAD;
      var Re_i = rho * Vrel * st.chord_m / MU_AIR;
      // Final pass applies the local Reynolds penalty — small-prop stations run
      // at Re well below the 2-D reference, degrading section Cl and raising Cd.
      cl = airfoilCl(alpha_deg, airfoil, Re_i);
      cd = airfoilCd(cl, alpha_deg, airfoil, Re_i);

      var dT = 0.5 * rho * Vrel * Vrel * propDef.N * st.chord_m * (cl * Math.cos(phi) - cd * Math.sin(phi)) * dr;
      var dQ = 0.5 * rho * Vrel * Vrel * propDef.N * st.chord_m * (cl * Math.sin(phi) + cd * Math.cos(phi)) * st.r_m * dr;

      T_total += dT;
      Q_total += dQ;
      elementData.push({
        r_frac: st.r_frac, alpha_deg: alpha_deg, cl: cl, cd: cd, Re: Re_i,
        stalled: alpha_deg >= airfoil.stall_angle_deg, dT: dT, dQ: dQ,
        V_rel: Vrel, phi_deg: phi / DEG_TO_RAD
      });
    });

    T_total = Math.max(0, T_total);
    Q_total = Math.max(0, Q_total);
    var Ct  = T_total / (rho * n * n * Math.pow(propDef.D_m, 4));
    var Cq  = Q_total / (rho * n * n * Math.pow(propDef.D_m, 5));
    var J   = n > 0 ? V_mps / (n * propDef.D_m) : 0;
    var eta = (V_mps > 0.1 && Q_total > 0)
      ? Math.min(100, Math.max(0, (T_total * V_mps) / (TWO_PI * n * Q_total) * 100))
      : 0;
    var v_h      = Math.sqrt(Math.max(0, T_total) / (2 * rho * A));
    var P_ideal  = Math.pow(T_total, 1.5) / Math.sqrt(2 * rho * A);
    var P_actual = omega * Q_total;
    var FoM      = P_actual > 0 ? Math.min(1.0, P_ideal / P_actual) : 0;

    return { T: T_total, Q: Q_total, Ct: Ct, Cq: Cq, J: J, eta: eta, FoM: FoM, elementData: elementData, v_h: v_h };
  }

  // ── Module 2 additions (additive, pure) ──
  // Frame aerodynamic drag + advance-ratio / propulsive-efficiency helpers.
  // Reuse the existing MU_AIR, TWO_PI constants and the existing runBEMT above.

  function dynamicPressure(rho, V) {
    if (!isFinite(rho) || !isFinite(V) || rho <= 0) return 0;
    return 0.5 * rho * V * V;
  }

  function dragForce(rho, V, Cd, A) {
    if (!isFinite(rho) || !isFinite(V) || !isFinite(Cd) || !isFinite(A)) return 0;
    if (rho <= 0 || A <= 0 || Cd <= 0) return 0;
    return dynamicPressure(rho, V) * Cd * A;   // D = q · Cd · A
  }

  // Rotor-downwash interference band (override C2 second reality check, §3.2):
  // clean-tunnel drag underestimates real forward-flight drag by 15-30% because
  // the rotor wash scrubs the frame. Seeded per frame id so it's a fixed part of
  // the build, not random noise. Returns the extra fraction in [0.15, 0.30].
  function washFactor(seedKey) {
    var C = window.VLAB_CONST;
    var band = (C && C.REAL && C.REAL.rotor_airframe_drag_extra) || [0.15, 0.30];
    var lo = band[0], hi = band[1];
    var u = (C && C.partDeviate) ? (C.partDeviate((seedKey || 'frame') + ':wash') * 0.5 + 0.5) : 0.5;
    return lo + (hi - lo) * u;   // deterministic value inside the band
  }

  // Effective (flight) drag = clean-body drag × (1 + k_wash) when wash is on.
  function dragForceEffective(rho, V, Cd, A, kWash, washOn) {
    var Fd = dragForce(rho, V, Cd, A);
    return washOn ? Fd * (1 + (kWash || 0)) : Fd;
  }

  // Ordinary least-squares y = m·x + b, plus R². Guards <2 points / zero variance.
  function linRegress(xs, ys) {
    var n = xs.length;
    if (n < 2) return { slope: 0, intercept: 0, r2: 0 };
    var sx = 0, sy = 0;
    for (var i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
    var mx = sx / n, my = sy / n;
    var sxx = 0, sxy = 0, syy = 0;
    for (var j = 0; j < n; j++) {
      var dx = xs[j] - mx, dy = ys[j] - my;
      sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    }
    var slope = sxx > 1e-12 ? sxy / sxx : 0;
    var intercept = my - slope * mx;
    var r2 = (sxx > 1e-12 && syy > 1e-12) ? (sxy * sxy) / (sxx * syy) : 0;
    return { slope: slope, intercept: intercept, r2: r2 };
  }

  // §3.2 override C2: sweep 0-15 m/s in 5 steps, fit F_D against V² (NOT V) —
  // straight line, slope = 0.5*rho*Cd*A, R²>0.999. Returns the swept points too
  // so the chart can plot F_D vs V² directly alongside the fitted line.
  function dragRegression(rho, Cd, A, kWash, washOn, steps) {
    var nSteps = steps || 5;
    var pts = [];
    for (var i = 0; i < nSteps; i++) {
      var V = 15 * i / (nSteps - 1);
      var D = dragForceEffective(rho, V, Cd, A, kWash, washOn);
      pts.push({ V: V, V2: V * V, D: D });
    }
    var fit = linRegress(pts.map(function (p) { return p.V2; }), pts.map(function (p) { return p.D; }));
    return { points: pts, slope: fit.slope, intercept: fit.intercept, r2: fit.r2 };
  }

  function reynoldsLength(rho, V, L) {
    if (!isFinite(rho) || !isFinite(V) || !isFinite(L)) return 0;
    if (rho <= 0 || L <= 0 || V <= 0) return 0;
    return rho * V * L / MU_AIR;               // Re = ρ·V·L / μ
  }

  function efficiencySweep(propDef, rpm, rho, Vmax, steps) {
    var out = [];
    if (!propDef || rpm <= 0 || rho <= 0) return out;
    var nSteps = (steps && steps > 1) ? steps : 26;
    var vMax   = (Vmax && Vmax > 0) ? Vmax : 25;
    var n      = rpm / 60;
    var D      = propDef.D_m;
    for (var i = 0; i < nSteps; i++) {
      var V = vMax * i / (nSteps - 1);
      var r = runBEMT(propDef, rpm, V, rho);
      if (!r) { out.push({ V: V, J: 0, eta: 0, T: 0, Q: 0, P: 0, Ct: 0, Cq: 0, FoM: 0 }); continue; }
      var J   = (n > 0 && D > 0) ? V / (n * D) : 0;
      var P   = TWO_PI * n * r.Q;                                    // shaft power
      var eta = (V > 0.1 && r.Q > 0)
        ? Math.min(100, Math.max(0, (r.T * V) / (TWO_PI * n * r.Q) * 100))
        : 0;
      out.push({ V: V, J: J, eta: eta, T: r.T, Q: r.Q, P: P, Ct: r.Ct, Cq: r.Cq, FoM: r.FoM });
    }
    return out;
  }

  function peakEfficiency(sweep) {
    var best = { eta: 0, J: 0, V: 0, idx: -1 };
    (sweep || []).forEach(function(s, i) {
      if (s.eta > best.eta) { best = { eta: s.eta, J: s.J, V: s.V, idx: i }; }
    });
    return best;   // { eta:0, idx:-1 } when no positive η
  }

  function findTrimSpeed(sweep, rho, Cd, A, nMotors) {
    var N = nMotors || 4;
    if (!sweep || sweep.length < 2) return { Vtrim: 0, status: 'thrust_limited' };
    function f(s) { return N * s.T - dragForce(rho, s.V, Cd, A); }
    var f0 = f(sweep[0]);
    // If thrust already below drag at the very first non-zero speed → thrust-limited
    for (var i = 1; i < sweep.length; i++) {
      var fa = f(sweep[i - 1]);
      var fb = f(sweep[i]);
      if ((fa >= 0 && fb < 0) || (fa <= 0 && fb > 0)) {
        var Va = sweep[i - 1].V, Vb = sweep[i].V;
        var t  = Math.abs(fb - fa) > 1e-9 ? fa / (fa - fb) : 0;   // fa + t(fb-fa)=0
        return { Vtrim: Va + t * (Vb - Va), status: 'ok' };
      }
    }
    // No crossing: positive everywhere → thrust exceeds drag past Vmax; negative → thrust-limited
    var last = f(sweep[sweep.length - 1]);
    return last > 0 ? { Vtrim: sweep[sweep.length - 1].V, status: 'exceeds' }
                    : { Vtrim: 0, status: 'thrust_limited' };
  }

  // trimPitch(D, W) — quasi-static nose-down forward-flight pitch (radians).
  // Steady-flight force balance: 4T·sinθ = D (horizontal) and 4T·cosθ = W (vertical)
  // ⟹ θ = atan(D / W). Guards non-finite inputs and W ≤ 0 / D ≤ 0 → 0.
  // The caller clamps the displayed angle (e.g. 0–35°).
  function trimPitch(D, W) {
    if (!isFinite(D) || !isFinite(W) || W <= 0 || D <= 0) return 0;
    return Math.atan(D / W);                 // radians
  }

  return Object.freeze({
    airDensity: airDensity,
    loadCatalog: loadCatalog,
    reynoldsPenalty: reynoldsPenalty,
    manufactureAirfoil: manufactureAirfoil,
    airfoilCl: airfoilCl,
    airfoilCd: airfoilCd,
    airfoilClThin: airfoilClThin,
    liftToDrag: liftToDrag,
    airfoilClFiniteWing: airfoilClFiniteWing,
    airfoilCdFiniteWing: airfoilCdFiniteWing,
    liftToDragFiniteWing: liftToDragFiniteWing,
    buildPropDef: buildPropDef,
    runBEMT: runBEMT,
    // ── Module 2 additions ──
    dynamicPressure: dynamicPressure,
    dragForce: dragForce,
    dragForceEffective: dragForceEffective,
    washFactor: washFactor,
    linRegress: linRegress,
    dragRegression: dragRegression,
    reynoldsLength: reynoldsLength,
    efficiencySweep: efficiencySweep,
    peakEfficiency: peakEfficiency,
    findTrimSpeed: findTrimSpeed,
    trimPitch: trimPitch,
    RE_REF: RE_REF
  });
})();
window.Calc = Calc;

// ═══════════════════════════════════════════════════════════════
// Shipped UI sound-effects (audio/sfx/*.mp3, synthesized by
// voice_gen/gen_sfx.py). These carry the moment-to-moment interaction
// feedback so the instructor VOICE can stay quiet — it now only speaks at
// tab intro, fault, and completion.
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
    if (g.ctx.state === 'suspended') g.ctx.resume().catch(function () {});
    const t = g.ctx.currentTime;
    if (on && enabled) {
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
    g.buzzGain.gain.setTargetAtTime(0.08 + 0.22 * f, t, 0.08);

    const bladeHz = 9 + f * 85;   // blade-pass modulation rate scales with rpm
    g.lfo.frequency.setTargetAtTime(bladeHz, t, 0.05);
    g.lfoGain.gain.setTargetAtTime(0.05 + 0.15 * f, t, 0.08);
    g.whooshFilter.frequency.setTargetAtTime((900 + f * 1800) * sz, t, 0.08);
    g.whooshGain.gain.setTargetAtTime(0.03 + 0.15 * f, t, 0.08);
  }
  function setEnabled(v) {
    enabled = !!v;
    if (!enabled) {
      Object.keys(pool).forEach(function (k) { try { pool[k].pause(); } catch (e) {} });
      if (_g) { const t = _g.ctx.currentTime; _g.buzzGain.gain.setTargetAtTime(0, t, 0.1); _g.whooshGain.gain.setTargetAtTime(0, t, 0.1); }
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


// ═══════════════════════════════════════════════════════════════════
// Instructor — floating buddy agent (ported verbatim from Exp1's verified
// implementation, per redesign/README.md §1). Pre-recorded Emma-neural clips
// (voice_gen/gen_aero.py) speak ONLY at tab intros, faults/reality-checks, and
// task completions; every other status update is on-screen text only via
// show(); no robotic speechSynthesis fallback for messages with no clip.
// ═══════════════════════════════════════════════════════════════════
const Instructor = (function () {
  'use strict';

  const CLIPS = {
    intro_m1_airfoil: 'audio/voice/m1_pick_airfoil.mp3',   // Module 1 Tab 2 (Airfoil Analysis) first entry
    intro_m2_tunnel:  'audio/voice/m2_tunnel_intro.mp3',   // Module 2 Tab 1 (Frame Drag) first entry
    intro_m2_cruise:  'audio/voice/m2_cruise_intro.mp3',   // Module 2 Tab 2 (Advance Ratio & Efficiency) first entry
    event_sweep_alpha:    'audio/voice/m1_sweep_alpha.mp3',
    event_stall_observed: 'audio/voice/m1_stall_observed.mp3',
    event_all_profiled:   'audio/voice/m1_all_profiled.mp3',
    event_regression:     'audio/voice/m2_regression.mp3',
    event_wash_on:        'audio/voice/m2_wash_on.mp3',
    event_peak_eta:       'audio/voice/m2_peak_eta.mp3',
    event_verdict_pass:   'audio/voice/verdict_pass.mp3'
  };

  // Matches a say() banner's text to its clip id + paired SFX kind. First
  // match wins; anything unmatched stays silent (text only, no fallback TTS).
  const EVENT_CLIPS = [
    [/^GUIDE: Sweep the angle of attack slowly/i, 'event_sweep_alpha', 'info'],
    [/^OBSERVE: The blade has stalled/i, 'event_stall_observed', 'warn'],
    [/^GUIDE: All three airfoils profiled/i, 'event_all_profiled', 'success'],
    [/^OBSERVE: Drag grows with the square of speed/i, 'event_regression', 'success'],
    [/^REALITY CHECK: In real forward flight/i, 'event_wash_on', 'info'],
    [/^OBSERVE: Peak propulsive efficiency found/i, 'event_peak_eta', 'success'],
    [/^GUIDE: Aerodynamic characterisation complete/i, 'event_verdict_pass', 'success']
  ];

  const synth = (typeof window !== 'undefined' && window.speechSynthesis) ? window.speechSynthesis : null;
  let ttsEnabled = true;
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

  function resolveEvent(text) {
    const plain = String(text).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    for (let i = 0; i < EVENT_CLIPS.length; i++) {
      if (EVENT_CLIPS[i][0].test(plain)) return { id: EVENT_CLIPS[i][1], clip: CLIPS[EVENT_CLIPS[i][1]], kind: EVENT_CLIPS[i][2] };
    }
    return null;
  }

  function playClip(clip) {
    if (!clip) return;
    const myToken = speakQueueToken;
    const a = getAudioEl();
    a.src = clip;
    a.play().catch(function () {
      if (myToken !== speakQueueToken) return;
      armAudioUnlock(clip, myToken);
    });
  }

  function show(text) {
    const el = document.getElementById('liveCommentaryText');
    if (el) el.innerHTML = text;
    const dot = document.getElementById('vlInstructorDot');
    const bubble = document.getElementById('vlInstructorBubble');
    if (dot) dot.hidden = !(bubble && bubble.hidden);
  }

  // say(text): always updates the on-screen bubble; plays the matching Emma
  // clip + paired SFX only for recognized/new events (deduped by event id so a
  // repeatedly-rendered dynamic banner doesn't replay the same clip every frame).
  let _lastEventId = null;
  function say(text) {
    show(text);
    if (!ttsEnabled) return;
    const ev = resolveEvent(text);
    if (!ev) { _lastEventId = null; return; }
    if (ev.id === _lastEventId) return;
    _lastEventId = ev.id;
    stopAll();
    if (window.SFX) {
      if (ev.kind === 'warn') SFX.warn();
      else if (ev.kind === 'success') SFX.success();
    }
    playClip(ev.clip);
  }

  const visitedIntros = {};
  let currentIntroId = null;
  function enterTab(introId) {
    if (!CLIPS[introId]) return;
    currentIntroId = introId;
    if (visitedIntros[introId]) return;
    visitedIntros[introId] = true;
    stopAll();
    if (ttsEnabled) playClip(CLIPS[introId]);
  }
  function replayIntro() {
    if (!currentIntroId) return;
    stopAll();
    if (ttsEnabled) playClip(CLIPS[currentIntroId]);
  }

  function setTts(enabled) {
    ttsEnabled = !!enabled;
    if (!ttsEnabled) stopAll();
    if (window.SFX) window.SFX.setEnabled(ttsEnabled);
    const btn = document.getElementById('instructorTtsToggle');
    if (btn) {
      btn.innerHTML = ttsEnabled ? '&#128266;' : '&#128264;';
      btn.classList.toggle('active', ttsEnabled);
      btn.title = ttsEnabled ? 'Audio on — click to mute voice & sound effects' : 'Audio muted — click to enable';
    }
    return ttsEnabled;
  }

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

  function ensureReplayButton(bubble) {
    if (!bubble || document.getElementById('instructorReplayBtn')) return;
    const btn = document.createElement('button');
    btn.id = 'instructorReplayBtn';
    btn.type = 'button';
    btn.title = 'Replay this tab\'s intro';
    btn.setAttribute('aria-label', 'Replay this tab\'s intro');
    btn.innerHTML = '&#9654; Replay intro';
    btn.style.cssText = 'margin-top:8px;display:inline-flex;align-items:center;gap:6px;' +
      'font-size:11px;line-height:1;padding:5px 9px;border:1px solid rgba(0,0,0,0.15);' +
      'border-radius:999px;background:#f1f5f9;color:#334155;cursor:pointer;';
    btn.addEventListener('click', function (e) { e.stopPropagation(); replayIntro(); });
    bubble.appendChild(btn);
  }

  function mountFloating() {
    const fab = document.getElementById('vlInstructorFab');
    const avatar = document.getElementById('vlInstructorAvatar');
    const bubble = document.getElementById('vlInstructorBubble');
    const minimizeBtn = document.getElementById('vlInstructorMinimize');
    const dot = document.getElementById('vlInstructorDot');
    if (!avatar || !bubble) return;
    let dragMoved = false;
    function setOpen(open) {
      bubble.hidden = !open;
      if (open && dot) dot.hidden = true;
    }
    avatar.addEventListener('click', function () { if (!dragMoved) setOpen(bubble.hidden); });
    if (minimizeBtn) minimizeBtn.addEventListener('click', function (e) { e.stopPropagation(); setOpen(false); });
    setOpen(true);
    ensureReplayButton(bubble);

    // ── Volume settings (Effects / Narrator), tucked in the bubble ─────────
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
    show: show,
    say: say,
    enterTab: enterTab,
    replayIntro: replayIntro,
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

// Progressive, state-aware guidance — top level (not nested in either module
// orchestrator IIFE) so both the tile-selection handler and the tab-switch
// handler can call it, mirroring Exp1's assemblyTip()/benchTestTip() pattern.
function airfoilTip(state) {
  if (!state || !state.airfoil) return 'GUIDE: Pick a NACA airfoil profile to begin. The four digits encode camber and thickness — camber boosts lift but trades away stall margin.';
  if (!state.aoaChanged) return 'GUIDE: Sweep the angle of attack slowly. Watch the lift curve climb linearly, then break — that break is the stall.';
  if (state.stallObserved) return 'OBSERVE: The blade has stalled. Flow has separated from the upper surface, lift collapses and drag spikes — the thin-airfoil line keeps climbing because the theory doesn\'t know about separation.';
  return 'GUIDE: Try a different NACA profile and compare Cl-max and stall angle in the chart.';
}
function tunnelTip(state) {
  if (!state) return 'GUIDE: This wind tunnel pushes your frame through 0 to 15 metres per second. Record the drag force at each step — then check which axis makes the plot a straight line.';
  if (state.washOn) return 'REALITY CHECK: In real forward flight the rotor downwash scrubs the frame, adding fifteen to thirty percent drag the clean tunnel never sees.';
  return 'GUIDE: This wind tunnel pushes your frame through 0 to 15 metres per second. Record the drag force at each step — then check which axis makes the plot a straight line.';
}
function cruiseTip(state) {
  if (state && state.peakObserved) return 'OBSERVE: Peak propulsive efficiency found. Faster than this, the advancing blade approaches stall; slower, you waste power hovering forward. This is your design cruise speed.';
  return 'GUIDE: Now sweep forward speed and watch propulsive efficiency. It is zero in a hover — thrust does no forward work — and peaks at one specific advance ratio.';
}

// ═══════════════════════════════════════════════════════════════════
// 2. SHARED HELPER FUNCTIONS (verbatim from exp2)
// ═══════════════════════════════════════════════════════════════════
function buildSharedTileGrid(container, items, options) {
  const parent = typeof container === 'string' ? document.getElementById(container) : container;
  if (!parent) return;
  const { isMulti, selectedIds, name, idPrefix, specF, onSelect } = options || {};
  const selSet = new Set(Array.isArray(selectedIds) ? selectedIds : (selectedIds ? [selectedIds] : []));

  parent.innerHTML = items.map(function(item) {
    const active = selSet.has(item.id);
    const inputId = `${idPrefix}${item.id}`;
    const escName = String(item.label || item.id).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const specText = specF ? specF(item) : '';
    return `
      <div class="component-tile ${active ? 'selected' : ''}">
        <input type="${isMulti ? 'checkbox' : 'radio'}" name="${name}" id="${inputId}" value="${item.id}" ${active ? 'checked' : ''}>
        <div class="tile-label">
          <div class="tile-name">${escName}</div>
          ${specText ? `<div class="tile-spec">${specText}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');

  parent.querySelectorAll('input').forEach(function(inp) {
    inp.addEventListener('change', function() {
      const item = items.find(function(i) { return i.id === inp.value; });
      if (onSelect && item) onSelect(item, inp.checked);
      if (!isMulti) {
        parent.querySelectorAll('.component-tile').forEach(function(t) { t.classList.remove('selected'); });
        inp.closest('.component-tile').classList.add('selected');
      } else {
        inp.closest('.component-tile').classList.toggle('selected', inp.checked);
      }
    });
  });
}

// ── Unlock-reward 3D card (shown once, on full experiment completion) ─────
// Loads the unlocked component from asset/models/<file>.glb — drop your file
// there and set UNLOCK_MODEL. Until then a procedural placeholder shows, so the
// sim never breaks. Same pattern as exp1/exp2.
var UNLOCK_MODEL = 'asset/models/reward.glb';   // ← set to your unlocked component's .glb
var _unlAnim = null, _unlScn = null, _unlRndr = null, _unlCam = null, _unlCtrls = null, _unlGroup = null, _unlClk = null, _unlShown = false;
function showUnlockCard() {
  var card = document.getElementById('nextModuleContainer');
  if (!card || _unlShown) return;
  _unlShown = true;
  card.style.display = 'block';
  setTimeout(initUnlockScene, 80);
  try { card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {}
}
function initUnlockScene() {
  try {
    var canvas = document.getElementById('unlockCanvas');
    if (!canvas || !window.THREE) return;
    var THREE = window.THREE;
    if (_unlAnim) { cancelAnimationFrame(_unlAnim); _unlAnim = null; }
    var base = initBase3DScene(canvas, canvas.parentElement, {
      bgColor: 0x0f172a, fov: 40, alpha: true, enableShadows: true,
      camPos: { x: 0.16, y: 0.12, z: 0.22 },
      ctrls: { minDist: 0.08, maxDist: 2.0, target: { x: 0, y: 0.01, z: 0 } },
      ambientIntensity: 0.75, sunIntensity: 1.0, sunPos: { x: 1.0, y: 2.0, z: 1.0 }
    });
    if (!base) return;
    _unlScn = base.scn; _unlRndr = base.rndr; _unlCam = base.cam; _unlCtrls = base.ctrls;
    if (base.handleResize) base.handleResize();
    _unlGroup = new THREE.Group(); _unlScn.add(_unlGroup);
    var clearGroup = function () { while (_unlGroup.children.length) _unlGroup.remove(_unlGroup.children[0]); };
    var createProcedural = function () {
      clearGroup();
      var bodyMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.35, metalness: 0.7 });
      var accentMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.5, metalness: 0.3 });
      var body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.01, 0.09), bodyMat); _unlGroup.add(body);
      [[0.05, 0.05], [-0.05, 0.05], [0.05, -0.05], [-0.05, -0.05]].forEach(function (p) {
        var mount = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.008, 16), accentMat);
        mount.position.set(p[0], 0.006, p[1]); _unlGroup.add(mount);
      });
    };
    if (window.GLTFLoader) {
      var loader = new window.GLTFLoader();
      if (window.DRACOLoader) { var d = new window.DRACOLoader(); d.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/'); loader.setDRACOLoader(d); }
      loader.load(UNLOCK_MODEL, function (gltf) {
        clearGroup();
        var model = gltf.scene;
        var box = new THREE.Box3().setFromObject(model), size = new THREE.Vector3(); box.getSize(size);
        var maxDim = Math.max(size.x, size.y, size.z) || 1.0, s = 0.16 / maxDim; model.scale.setScalar(s);
        var c = new THREE.Vector3(); box.getCenter(c); model.position.set(-c.x * s, -c.y * s, -c.z * s);
        model.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        _unlGroup.add(model);
      }, undefined, function () { createProcedural(); });
    } else { createProcedural(); }
    _unlClk = new THREE.Clock();
    (function render() {
      _unlAnim = requestAnimationFrame(render);
      var dt = _unlClk.getDelta();
      if (_unlCtrls) _unlCtrls.update();
      if (_unlGroup) _unlGroup.rotation.y += 0.3 * dt;
      _unlRndr.render(_unlScn, _unlCam);
    })();
  } catch (e) { /* unlock card is cosmetic — never break the app */ }
}

function initBase3DScene(canvas, wrapper, options) {
  const scn = new THREE.Scene();

  // ── STUDIO GRADIENT BACKDROP ──
  // Replace the flat background with a soft vertical gradient (light cool slate at top →
  // brighter near-white at bottom) baked into a 2×256 CanvasTexture, so BOTH modules read
  // as a premium studio set instead of a flat fill. Falls back to a solid colour when a
  // 2-D canvas context is unavailable (keeps the scene safe — never black/washed-out).
  (function () {
    var solidFallback = new THREE.Color(options.bgColor !== undefined ? options.bgColor : 0xf3f4f6);
    var topHex = '#dbe3ec';   // light cool slate
    var botHex = '#f4f7fb';   // brighter near-white
    if (options.bgColor !== undefined) {
      // Derive the gradient around the requested colour but bias LIGHTER so the small
      // scene never reads muddy or washed-out.
      var bc = new THREE.Color(options.bgColor);
      topHex = '#' + bc.clone().lerp(new THREE.Color(0xffffff), 0.35).getHexString();
      botHex = '#' + bc.clone().lerp(new THREE.Color(0xffffff), 0.72).getHexString();
    }
    var tex = null;
    try {
      var bgCanvas = document.createElement('canvas');
      bgCanvas.width = 2; bgCanvas.height = 256;
      var bgCtx = bgCanvas.getContext('2d');
      if (bgCtx) {
        var grad = bgCtx.createLinearGradient(0, 0, 0, 256);
        grad.addColorStop(0, topHex);   // top
        grad.addColorStop(1, botHex);   // bottom
        bgCtx.fillStyle = grad;
        bgCtx.fillRect(0, 0, 2, 256);
        tex = new THREE.CanvasTexture(bgCanvas);
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        if (THREE.sRGBEncoding !== undefined) tex.encoding = THREE.sRGBEncoding;
        tex.needsUpdate = true;
      }
    } catch (e) { tex = null; }
    scn.background = tex || solidFallback;
  })();

  const parent = (typeof wrapper === 'string' ? document.getElementById(wrapper) : wrapper) || canvas.parentElement || canvas;
  const w = parent.clientWidth || 300, h = parent.clientHeight || 180;

  const cam = new THREE.PerspectiveCamera(options.fov || 45, w / h, 0.01, 100);
  if (options.camPos) cam.position.set(options.camPos.x, options.camPos.y, options.camPos.z);

  const rndr = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: !!options.alpha });
  rndr.setSize(w, h, false);
  rndr.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  if (options.enableShadows) {
    rndr.shadowMap.enabled = true;
    rndr.shadowMap.type = THREE.PCFSoftShadowMap;
    rndr.outputEncoding = THREE.sRGBEncoding;
    rndr.toneMapping = THREE.ACESFilmicToneMapping;
    rndr.toneMappingExposure = 1.08;
  }

  const ctrls = new THREE.OrbitControls(cam, rndr.domElement);
  ctrls.enableDamping = true;
  ctrls.dampingFactor = 0.08;
  if (options.ctrls) {
    if (options.ctrls.minDist !== undefined) ctrls.minDistance = options.ctrls.minDist;
    if (options.ctrls.maxDist !== undefined) ctrls.maxDistance = options.ctrls.maxDist;
    if (options.ctrls.maxPolar !== undefined) ctrls.maxPolarAngle = options.ctrls.maxPolar;
    if (options.ctrls.target) ctrls.target.set(options.ctrls.target.x, options.ctrls.target.y, options.ctrls.target.z);
  }
  ctrls.update();

  scn.add(new THREE.AmbientLight(0xffffff, options.ambientIntensity || 0.65));
  const sun = new THREE.DirectionalLight(0xffffff, options.sunIntensity || 0.95);
  sun.position.set(options.sunPos ? options.sunPos.x : 1.5, options.sunPos ? options.sunPos.y : 3.0, options.sunPos ? options.sunPos.z : 1.5);
  if (options.enableShadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.radius = 4;
    sun.shadow.bias = options.sunBias !== undefined ? options.sunBias : -0.0001;
    // Tighten the shadow frustum around the small (sub-metre) scene so the 2k map is spent
    // where it matters — crisp, soft contact shadows instead of a coarse, sparse map.
    if (sun.shadow.camera && sun.shadow.camera.isOrthographicCamera) {
      sun.shadow.camera.left   = -0.7;
      sun.shadow.camera.right  =  0.7;
      sun.shadow.camera.top    =  0.7;
      sun.shadow.camera.bottom = -0.7;
      sun.shadow.camera.near   =  0.05;
      sun.shadow.camera.far    =  6;
      sun.shadow.camera.updateProjectionMatrix();
    }
  }
  scn.add(sun);

  const resize = function() {
    const width = parent.clientWidth, height = parent.clientHeight;
    if (width === 0 || height === 0) return;
    rndr.setSize(width, height, false);
    cam.aspect = width / height;
    cam.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', function() { setTimeout(resize, 100); });

  return { scn: scn, rndr: rndr, cam: cam, ctrls: ctrls, handleResize: resize };
}

// ═══════════════════════════════════════════════════════════════════
// 3. SCENE IIFE — Three.js Render Loop
// ═══════════════════════════════════════════════════════════════════
const Scene = (function () {
  'use strict';
  var _base       = null;
  var _clock      = null;
  var _activeTab  = 1;
  var _animFrameId = null;
  var _auxTick    = null;   // Module 2 aux per-frame hook; null on Module 1 (no-op)
  var _grid       = null;   // Module 2: ground-grid ref (promoted from init() for cruise-scroll)
  var _ground     = null;   // Module 2: ground-plane ref (promoted from init())
  var _cruiseV    = 0;      // Module 2: forward cruise speed (m/s); 0 ⇒ inert (Tab 1 / Module 1)
  var SCROLL_SCALE = 0.32;  // Module 2: cruise-scroll visual scale so motion reads naturally
  var _flightActive = false; // Module 2: Tab-2 flight gate — drives the chase-cam + endless-ground follow

  function setAuxTick(fn) { _auxTick = (typeof fn === 'function') ? fn : null; }
  function setCruiseSpeed(V) {
    _cruiseV = (isFinite(V) && V > 0) ? V : 0;
    if (_grid && _grid.material) {
      _grid.material.opacity = _cruiseV > 0 ? 0.32 : 0.25;   // stream reads clearly while flying
      if (_cruiseV === 0) _grid.position.x = 0;              // reset streaming offset off Tab 2
    }
  }
  // Module 2: gate the Tab-2 forward-flight chase-camera + endless-ground follow (see _startLoop).
  // When off, reset the grid/ground scroll so Tab 1 / Module 1 render unchanged.
  function setFlightActive(b) {
    _flightActive = !!b;
    if (_grid && _grid.material) _grid.material.opacity = _flightActive ? 0.42 : 0.25;
    // Note: do NOT reset grid/ground X here — on Stop the drone stays parked off-origin and the
    // floor must remain under it. The Tab-1 path (setTab(1)) resets grid/ground + recenters the drone.
  }

  function init() {
    var canvas  = document.getElementById('mainCanvas');
    var wrapper = document.getElementById('canvasWrapper');
    if (!canvas || !wrapper) return;

    _base = initBase3DScene(canvas, wrapper, {
      bgColor: 0xcbd2db,
      fov: 45,
      enableShadows: true,
      ambientIntensity: 0.60,
      sunIntensity: 1.05,
      sunPos: { x: 1.5, y: 3.0, z: 1.5 },
      camPos: { x: 0.0, y: 0.12, z: 0.35 },
      ctrls: {
        minDist: 0.05,
        maxDist: 3.0,
        maxPolar: Math.PI * 0.88,
        target: { x: 0, y: 0, z: 0 }
      }
    });

    var rimLight = new THREE.DirectionalLight(0xdbeafe, 0.50);
    rimLight.position.set(-1.5, 1.0, -1.5);
    _base.scn.add(rimLight);

    // Cool fill from the opposite side of the key — lifts the shadowed side with a soft
    // sky-blue bounce without casting its own shadow, completing the 3-point studio rig.
    // Kept gentle (0.35) so contrast stays readable rather than flat.
    var fillLight = new THREE.DirectionalLight(0xbcd4ff, 0.35);
    fillLight.position.set(-2.0, 1.5, -1.5);
    _base.scn.add(fillLight);

    var hemi = new THREE.HemisphereLight(0xdbeafe, 0xe5e7eb, 0.3);
    _base.scn.add(hemi);

    // ── Neutral studio-gray, ~78% transparent ground plane + grid (lab test-stand floor) ──
    var groundMat = new THREE.MeshStandardMaterial({
      color: 0xb8c2cf, roughness: 0.95, metalness: 0.0,
      transparent: true, opacity: 0.22, side: THREE.DoubleSide
    });
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.30;
    ground.receiveShadow = true;
    _base.scn.add(ground);

    var grid = new THREE.GridHelper(4, 40, 0x94a3b8, 0xcbd5e1);
    grid.position.y = -0.299;
    grid.material.transparent = true;
    grid.material.opacity = 0.25;
    _base.scn.add(grid);

    // Module 2: promote grid/ground to module scope for the cruise-scroll (design §3.3).
    // Additive — no behavioural change while _cruiseV === 0 (Tab 1 / Module 1).
    _grid = grid; _ground = ground;

    _clock = new THREE.Clock();
    if (_animFrameId) cancelAnimationFrame(_animFrameId);
    _startLoop();
  }

  function _startLoop() {
    function tick() {
      _animFrameId = requestAnimationFrame(tick);
      var dt = _clock.getDelta();
      _base.ctrls.update();
      if (window.PropModel) PropModel.tick(dt, _activeTab);
      if (_auxTick) _auxTick(dt, _activeTab);          // Module 2 aux hook; null on Module 1
      // Module 2 flight: camera follows the drone (slight lag = dynamic) over an ENDLESS floor.
      if (_flightActive && _activeTab === 2 && window.DroneModel && DroneModel.getDroneGroup) {
        var dg = DroneModel.getDroneGroup();
        if (dg) {
          var droneX = dg.position.x;
          var step = (droneX - _base.ctrls.target.x) * Math.min(1, dt * 4.0);
          _base.ctrls.target.x += step;     // ease target toward the drone
          _base.cam.position.x  += step;     // move camera by the same delta → orbit preserved
          var cellF = 4 / 40;
          if (_grid)   _grid.position.x   = Math.round(droneX / cellF) * cellF;  // endless grid
          if (_ground) _ground.position.x = droneX;                              // floor under craft
        }
      }
      _base.rndr.render(_base.scn, _base.cam);
    }
    tick();
  }

  function setTab(n) {
    _activeTab = n;
    if (!_base) return;
    if (n === 1) {
      _base.cam.position.set(0.0, 0.12, 0.35);
      _base.ctrls.target.set(0, 0, 0);
      _flightActive = false;
      if (_grid) _grid.position.x = 0;
      if (_ground) _ground.position.x = 0;
    } else {
      _base.cam.position.set(0.12, 0.18, 0.30);
      _base.ctrls.target.set(0, 0.02, 0);
    }
    _base.ctrls.update();
  }

  function resize() {
    if (_base && _base.handleResize) _base.handleResize();
  }

  return {
    init: init,
    setTab: setTab,
    resize: resize,
    getScene:    function() { return _base ? _base.scn  : null; },
    getCamera:   function() { return _base ? _base.cam  : null; },
    getActiveTab: function() { return _activeTab; },
    setAuxTick: setAuxTick,
    setCruiseSpeed: setCruiseSpeed,
    setFlightActive: setFlightActive
  };
})();
window.Scene = Scene;

// ═══════════════════════════════════════════════════════════════════
// 4. PROPMODEL IIFE — Procedural 3D Propeller
// ═══════════════════════════════════════════════════════════════════
const PropModel = (function () {
  'use strict';
  var _propGrp    = null;
  var _bladeGrps  = [];
  var _bladeData  = [];     // [N] { geo, S, P } for lofted blades (vertex-colour stall overlay)
  var _hub        = null;
  var _inflowCone = null;
  var _idleAngle  = 0;
  var _airflow    = null;   // THREE.Points downwash particle system
  var _afVel      = [];     // per-particle fall speed multiplier
  var _airflowR   = 0.13;   // radial spread (set per propDef)
  var _flowSpeed  = 0.5;    // current downward flow speed (scene units/s)
  var _running    = false;  // simulation run/stop state
  var _swirlRate  = 2.0;    // slipstream swirl rate (rad/s), tied to spin
  var _afAngle    = [];     // per-particle azimuth
  var _afRf       = [];     // per-particle radial fraction (0..1)

  function _hexToInt(hex) {
    return parseInt(String(hex).replace('#', ''), 16);
  }

  // Real NACA 4-digit cross-section (accurate thickness + camber line).
  // Returns a closed THREE.Shape in the chord(X)–thickness(Y) plane, centred on the chord.
  // NACA 4-digit outline for a unit chord — closed loop of [x,y] (fractions of chord).
  function _airfoilOutline(camberPct) {
    var tc = 0.12, m = camberPct / 100, p = 0.40, N = 16;
    var upper = [], lower = [];
    for (var k = 0; k <= N; k++) {
      // cosine spacing → denser points at LE/TE for a smooth rounded leading edge
      var x = 0.5 * (1 - Math.cos(Math.PI * k / N));
      var yt = 5 * tc * (0.2969 * Math.sqrt(x) - 0.1260 * x - 0.3516 * x * x
                         + 0.2843 * x * x * x - 0.1015 * x * x * x * x);
      var yc, dyc;
      if (m === 0) { yc = 0; dyc = 0; }
      else if (x < p) {
        yc  = (m / (p * p)) * (2 * p * x - x * x);
        dyc = (2 * m / (p * p)) * (p - x);
      } else {
        yc  = (m / ((1 - p) * (1 - p))) * ((1 - 2 * p) + 2 * p * x - x * x);
        dyc = (2 * m / ((1 - p) * (1 - p))) * (p - x);
      }
      var th = Math.atan(dyc);
      upper.push([(x - yt * Math.sin(th)) - 0.5, yc + yt * Math.cos(th)]);
      lower.push([(x + yt * Math.sin(th)) - 0.5, yc - yt * Math.cos(th)]);
    }
    var pts = [];
    for (var i = 0; i <= N; i++) pts.push(upper[i]);       // LE → TE (upper)
    for (var j = N - 1; j >= 1; j--) pts.push(lower[j]);   // TE → LE (lower)
    return pts;                                            // closed loop, length 2N
  }

  function _disposeMesh(mesh) {
    if (!mesh) return;
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) {
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach(function(m) { m.dispose(); });
      } else {
        mesh.material.dispose();
      }
    }
  }

  function _clearGroup(grp) {
    if (!grp) return;
    while (grp.children.length > 0) {
      var child = grp.children[0];
      grp.remove(child);
      if (child.isGroup || child.children) {
        _clearGroup(child);
      }
      _disposeMesh(child);
    }
  }

  // Build ONE continuous lofted blade surface (smooth, non-boxy) with per-vertex colours.
  function _buildBlade(propDef, bladeIndex, hubR) {
    var camber = propDef.airfoil ? propDef.airfoil.camber : 0;
    // Amplify camber for on-screen distinction between NACA 0012 / 2412 / 4412 (visual only).
    var outline = _airfoilOutline(camber * 2.4);
    var P = outline.length;
    var S = 48;                                          // spanwise stations
    var startR  = Math.max(0.006, (hubR || 0.01) * 0.85); // root anchored INTO the hub
    var spanLen = propDef.R_m - startR;
    var base    = new THREE.Color(_hexToInt(propDef.material.color_hex || '#f1f5f9'));

    var positions = [], colors = [], indices = [];

    for (var k = 0; k <= S; k++) {
      var t = k / S;
      var r = startR + t * spanLen;
      var taper = (propDef.c_root_mm + (propDef.c_tip_mm - propDef.c_root_mm) * t) / 1000;
      var fair  = t < 0.15 ? (0.70 + 0.30 * (t / 0.15)) : 1.0;                       // root fairing
      var tipRound = t > 0.88 ? Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.88) / 0.12, 2))) : 1.0; // rounded tip
      var chord = taper * fair * Math.max(0.14, tipRound);
      var theta = (propDef.theta_root_deg + (propDef.theta_tip_deg - propDef.theta_root_deg) * t) * (Math.PI / 180);
      var sweep = t * t * propDef.R_m * 0.05;
      var ct = Math.cos(theta), st = Math.sin(theta);

      for (var iP = 0; iP < P; iP++) {
        var c = outline[iP][0] * chord;        // chordwise (→ world Z)
        var h = outline[iP][1] * chord;        // thickness (→ world Y)
        var y = h * ct - c * st;               // pitch twist about span (X)
        var z = h * st + c * ct + sweep;
        positions.push(r, y, z);
        colors.push(base.r, base.g, base.b);
      }
    }

    // Skin faces between consecutive rings
    for (var kk = 0; kk < S; kk++) {
      for (var ip = 0; ip < P; ip++) {
        var a  = kk * P + ip;
        var b  = kk * P + ((ip + 1) % P);
        var cN = (kk + 1) * P + ((ip + 1) % P);
        var d  = (kk + 1) * P + ip;
        indices.push(a, b, d, b, cN, d);
      }
    }

    // ── Cap the root (ring 0) and tip (ring S) so the blade is a closed solid ──
    function _ringCentroid(ringStart) {
      var cx = 0, cy = 0, cz = 0;
      for (var q = 0; q < P; q++) {
        cx += positions[(ringStart + q) * 3];
        cy += positions[(ringStart + q) * 3 + 1];
        cz += positions[(ringStart + q) * 3 + 2];
      }
      return [cx / P, cy / P, cz / P];
    }
    var rootC = _ringCentroid(0);
    var rootCi = positions.length / 3;
    positions.push(rootC[0], rootC[1], rootC[2]);
    colors.push(base.r, base.g, base.b);
    for (var ir = 0; ir < P; ir++) {
      indices.push(rootCi, ir, (ir + 1) % P);          // root fan
    }
    var tipStart = S * P;
    var tipC = _ringCentroid(tipStart);
    var tipCi = positions.length / 3;
    positions.push(tipC[0], tipC[1], tipC[2]);
    colors.push(base.r, base.g, base.b);
    for (var it = 0; it < P; it++) {
      indices.push(tipCi, tipStart + ((it + 1) % P), tipStart + it); // tip fan
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    var mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.34, metalness: 0.12, side: THREE.DoubleSide
    });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;

    _bladeData[bladeIndex] = { geo: geo, S: S, P: P };

    var grp = new THREE.Group();
    grp.add(mesh);
    return grp;
  }

  // Animated slipstream: helical, contracting downwash through the rotor disk.
  function _buildAirflow(propDef) {
    var scn = window.Scene ? window.Scene.getScene() : null;
    if (_airflow) {
      if (_airflow.geometry) _airflow.geometry.dispose();
      if (_airflow.material) _airflow.material.dispose();
      if (scn) scn.remove(_airflow);
    }
    _airflowR = propDef.R_m * 1.05;
    var diskR = propDef.R_m;
    var top = diskR * 1.6, bot = -diskR * 1.8;
    var COUNT = 260;
    var positions = new Float32Array(COUNT * 3);
    _afAngle = [];
    _afRf = [];
    _afVel = [];
    for (var i = 0; i < COUNT; i++) {
      var rf  = 0.12 + Math.sqrt(Math.random()) * 0.88;   // radial fraction (denser toward rim)
      var ang = Math.random() * Math.PI * 2;
      var y   = top - Math.random() * (top - bot);
      _afAngle.push(ang);
      _afRf.push(rf);
      _afVel.push(0.92 + Math.random() * 0.16);           // near-uniform (laminar, not rainy)
      var rfac = y >= 0 ? (1.0 + 0.15 * (y / top)) : (0.75 + 0.25 * Math.exp(y / (0.45 * diskR)));
      var r = rf * diskR * rfac;
      positions[i * 3]     = Math.cos(ang) * r;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = Math.sin(ang) * r;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    var mat = new THREE.PointsMaterial({
      color: 0x0ea5e9, size: 0.009, transparent: true, opacity: 0.6,
      depthWrite: false, sizeAttenuation: true
    });
    _airflow = new THREE.Points(geo, mat);
    _airflow.userData.diskR = diskR;
    _airflow.userData.top = top;
    _airflow.userData.bot = bot;
    _airflow.visible = false;
    if (scn) scn.add(_airflow);
  }

  function _tickAirflow(dt) {
    if (!_airflow) return;
    _airflow.visible = _running;
    if (!_running) return;

    // Tilt the whole slipstream with angle of attack: at α=0 the inflow is axial
    // (top→bottom); as α increases the oncoming air arrives more from the side.
    var tab = window.Scene ? window.Scene.getActiveTab() : 1;
    var alpha = (tab === 2 && window.VLAB && window.VLAB.state) ? (window.VLAB.state.alpha_deg || 0) : 0;
    // smooth toward target tilt (amplified ~2× for on-screen clarity)
    var targetTilt = -(alpha * Math.PI / 180) * 2.0;
    _airflow.rotation.z += (targetTilt - _airflow.rotation.z) * Math.min(1, dt * 6);

    var pos   = _airflow.geometry.attributes.position.array;
    var diskR = _airflow.userData.diskR;
    var top   = _airflow.userData.top;
    var bot   = _airflow.userData.bot;
    for (var i = 0; i < _afVel.length; i++) {
      var y = pos[i * 3 + 1] - _flowSpeed * _afVel[i] * dt;
      var below = y < 0;
      // Swirl grows below the disk (induced rotation of the slipstream)
      var swirl = below ? _swirlRate * (1 - Math.exp(y / (0.5 * diskR))) : _swirlRate * 0.04;
      _afAngle[i] += swirl * dt;
      if (y < bot) { y = top; }
      // Slipstream contraction: intake wide above, contracts to ~0.75R below disk
      var rfac = below ? (0.75 + 0.25 * Math.exp(y / (0.45 * diskR))) : (1.0 + 0.15 * (y / top));
      var r = _afRf[i] * diskR * rfac;
      pos[i * 3]     = Math.cos(_afAngle[i]) * r;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = Math.sin(_afAngle[i]) * r;
    }
    _airflow.geometry.attributes.position.needsUpdate = true;
  }

  function setFlowSpeed(v_h) {
    // Map induced velocity (m/s) to a visible scene-units/s fall rate.
    _flowSpeed = Math.max(0.25, Math.min(2.5, v_h * 0.12));
  }

  function setRunning(b) {
    _running = !!b;
    if (_airflow) _airflow.visible = _running;
    // When stopping, do not reset the angle — let the gentle idle spin resume
    // smoothly from wherever the prop currently is (no snap back to 0).
  }

  function isRunning() { return _running; }

  function build(propDef) {
    var scn = window.Scene ? window.Scene.getScene() : null;
    if (!scn) return;

    if (_propGrp) {
      _clearGroup(_propGrp);
      scn.remove(_propGrp);
    }

    _propGrp   = new THREE.Group();
    _bladeGrps = [];
    _bladeData = [];

    // Hub assembly: central barrel + spinner nose cone + base cap (realistic prop hub)
    var hubGrp = new THREE.Group();
    var hubMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.35, metalness: 0.7 });
    var hubR   = Math.max(0.009, propDef.c_root_mm / 1000 * 0.32, propDef.R_m * 0.05);

    var barrel = new THREE.Mesh(new THREE.CylinderGeometry(hubR, hubR, 0.018, 24), hubMat);
    barrel.castShadow = true;
    hubGrp.add(barrel);

    var spinner = new THREE.Mesh(new THREE.SphereGeometry(hubR * 1.02, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), hubMat);
    spinner.position.y = 0.009;
    spinner.scale.y = 1.4;
    spinner.castShadow = true;
    hubGrp.add(spinner);

    var baseCap = new THREE.Mesh(new THREE.CylinderGeometry(hubR * 0.7, hubR * 0.9, 0.006, 24),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5, metalness: 0.6 }));
    baseCap.position.y = -0.011;
    hubGrp.add(baseCap);

    _hub = hubGrp;
    _propGrp.add(hubGrp);

    var TWO_PI = 2 * Math.PI;
    for (var i = 0; i < propDef.N; i++) {
      var bladeGrp = _buildBlade(propDef, i, hubR);
      bladeGrp.rotation.y = i * (TWO_PI / propDef.N);
      _propGrp.add(bladeGrp);
      _bladeGrps.push(bladeGrp);
    }

    var coneMat = new THREE.MeshBasicMaterial({
      color: 0x3b82f6,
      transparent: true,
      opacity: 0.08,
      side: THREE.BackSide
    });
    var coneGeo = new THREE.ConeGeometry(propDef.R_m, propDef.R_m * 1.5, 32, 1, true);
    _inflowCone = new THREE.Mesh(coneGeo, coneMat);
    _inflowCone.position.set(0, -propDef.R_m * 0.75, 0);
    _inflowCone.visible = false;
    _propGrp.add(_inflowCone);

    _buildAirflow(propDef);

    scn.add(_propGrp);
    // Preserve spin angle across rebuilds so changing sliders doesn't visually jump.
    _propGrp.rotation.y = _idleAngle;
  }

  function tick(dt, activeTab) {
    if (!_propGrp) return;
    if (_running) {
      // Visual spin proportional to RPM. True ω = rpm·2π/60 (e.g. 5000 rpm ≈ 524 rad/s) is an
      // unrenderable blur, so we use a fixed proportional scale: faster slider → faster spin.
      var rpm = (window.VLAB && window.VLAB.state) ? (window.VLAB.state.rpm || 0) : 5000;
      var displayOmega = rpm * 0.004;          // 1000→4, 5000→20, 15000→60 rad/s
      _idleAngle += displayOmega * dt;
      _propGrp.rotation.y = _idleAngle;
      _swirlRate = displayOmega * 0.4;
    } else {
      // Idle "showroom" spin: keep the prop gently alive even when not running.
      // Slow enough to inspect blade geometry, fast enough to look animated.
      var idleOmega = 0.45;                    // rad/s
      _idleAngle += idleOmega * dt;
      _propGrp.rotation.y = _idleAngle;
    }
    _tickAirflow(dt);
  }

  function updateStallOverlay(elementData, airfoil) {
    if (!elementData || !elementData.length) return;
    var nEl = elementData.length;
    var RED = new THREE.Color(0xef4444), AMBER = new THREE.Color(0xf59e0b), BLUE = new THREE.Color(0x3b82f6);
    _bladeData.forEach(function(bd) {
      if (!bd || !bd.geo) return;
      var colAttr = bd.geo.attributes.color;
      var arr = colAttr.array;
      for (var k = 0; k <= bd.S; k++) {
        var frac = bd.S > 0 ? k / bd.S : 0;
        var idx  = Math.min(nEl - 1, Math.round(frac * (nEl - 1)));
        var el   = elementData[idx];
        var col  = el.stalled ? RED : (el.alpha_deg > airfoil.stall_angle_deg * 0.80 ? AMBER : BLUE);
        for (var iP = 0; iP < bd.P; iP++) {
          var vi = (k * bd.P + iP) * 3;
          arr[vi] = col.r; arr[vi + 1] = col.g; arr[vi + 2] = col.b;
        }
      }
      colAttr.needsUpdate = true;
    });
  }

  function setInflowConeScale(v_h) {
    if (!_inflowCone) return;
    var scale = Math.max(0.1, Math.min(3.0, v_h / 5.0));
    _inflowCone.scale.setScalar(scale);
    _inflowCone.visible = _running && (window.Scene ? window.Scene.getActiveTab() === 2 : false);
    setFlowSpeed(v_h);
  }

  return {
    build: build,
    tick: tick,
    updateStallOverlay: updateStallOverlay,
    setInflowConeScale: setInflowConeScale,
    setFlowSpeed: setFlowSpeed,
    setRunning: setRunning,
    isRunning: isRunning,
    updateFromState: function(state) { build(Calc.buildPropDef(state)); }
  };
})();
window.PropModel = PropModel;

// ═══════════════════════════════════════════════════════════════════
// 4b. DRONEMODEL IIFE (ported, full-drone path only) — window.DroneModel
//     Ported from exp-propulsion-system-design-dei js/main.js. Thrust-stand
//     bench variant, smoke particles, and LCD/HUD code are intentionally
//     EXCLUDED — Module 2 only renders the free-flight full quad drone.
// ═══════════════════════════════════════════════════════════════════
const DroneModel = (function () {
  'use strict';

  const THREE = window.THREE;

  const _armDirs = [
    new THREE.Vector3( 1, 0, -1).normalize(),
    new THREE.Vector3(-1, 0, -1).normalize(),
    new THREE.Vector3( 1, 0,  1).normalize(),
    new THREE.Vector3(-1, 0,  1).normalize()
  ];

  const _propSigns = [1, -1, -1, 1];

  let _droneGrp = null;
  let _propGrps = [];
  let _motorSpinGrps = [];   // hero-motor bell spin groups (bell turns on the same shaft as its prop)
  let _blurDscs = [];
  let _rotRPM = 0;
  var _t = 0;            // module-local animation clock (s) for idle hover bob/sway (Module 2 visual polish)

  // ── Module 2: forward flight (Tab 2 only) ──
  // Continuous forward travel along −X with NO reset/recycle (camera follows; ground is endless).
  // Actual speed eases toward a commanded target; lean eases toward a target. NO hover bob/sway.
  // resetFlight() recenters the craft for Tab 1.
  var _fwdSpeed  = 0;      // eased actual forward speed (m/s)
  var _fwdTarget = 0;      // commanded forward speed (m/s); _fwdSpeed eases toward it
  var _fwdX      = 0;      // unbounded along-track offset (−X); NO recycle
  var _leanZ     = 0;      // target forward-flight lean (rad), applied about Z
  var _leanApplied = 0;    // eased lean actually applied (smooth)
  var FWD_SCALE  = 0.02;   // m/s → scene-units/s (brisk but smooth at full throttle)

  // ── Module 2: student-designed propeller (serialized propDef from Module 1) ──
  // When set (via setDesignedProp), updateFromSelections lofts THIS design onto the inherited
  // motors instead of the catalog 2-blade fallback. VLAB2 calls setDesignedProp with the
  // inherited/designed propDef BEFORE updateFromSelections. null ⇒ byte-for-byte the original
  // catalog blade, so Module 1 (which uses PropModel, never DroneModel) is unaffected.
  var _designedProp = null;
  function setDesignedProp(pd) { _designedProp = (pd && pd.D_m) ? pd : null; }

  let _carbonTxtr = null;
  // ── High-poly "hero" BLDC outrunner motor model — ported verbatim (geometry
  // + materials) from exp-power-electronics-esc-dei's simulation/js/esc_hw_models.js
  // (window.EscHwModels.buildMotor), inlined here per the one-js-file rule.
  // Unlike the old flat-mesh motor (bell/coils/stator all static, only the
  // propeller spun), this correctly separates the static stator/base — mount
  // plate, bearing boss, 12 laminated-stack teeth with copper windings — from
  // the `spin` sub-group (anodised bell, top cap + vents, hub + retaining
  // screws, shaft, circlip, prop nut) that actually rotates with the shaft.
  // Local frame: y=0 is the mount face, the bell extends +Y, matching this
  // file's existing motorY convention exactly (bell bottom sits 4mm above the
  // group origin, i.e. position the returned group at `motorY - 0.004` to
  // reproduce the old mesh's placement).
  function buildMotorMesh(motor, accent) {
    motor = motor || {};
    const bellR = (motor.bell_diameter_mm || 28) / 2 / 1000;
    const bellH = (motor.bell_height_mm || 21) / 1000;
    accent = accent !== undefined ? accent : 0xc2410c;
    const root = new THREE.Group();

    // static base: mounting cross + bearing boss
    const baseY = 0.0;
    const mountMat = createMat(0x2b3038, 0.44, 0.72);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(bellR * 0.5, bellR * 0.55, 0.0022, 40), mountMat);
    plate.position.y = baseY + 0.0011; plate.receiveShadow = true; root.add(plate);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(bellR * 1.7, 0.0022, 0.004), mountMat);
      arm.position.set(0, baseY + 0.0011, 0); arm.rotation.y = a; root.add(arm);
      const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.0011, 0.0011, 0.003, 12), createMat(0x0a0c10, 0.6, 0.3));
      hole.position.set(Math.cos(a) * bellR * 0.8, baseY + 0.0011, Math.sin(a) * bellR * 0.8); root.add(hole);
    }
    const boss = new THREE.Mesh(new THREE.CylinderGeometry(bellR * 0.2, bellR * 0.22, 0.006, 28), createMat(0x3a4048, 0.4, 0.78));
    boss.position.y = baseY + 0.004; root.add(boss);

    // laminated stator stack (thin alternating discs)
    const statorBottom = baseY + 0.0055;
    const statorH = bellH * 0.5;
    const statorR = bellR * 0.66;
    const lamN = Math.max(8, Math.round(statorH / 0.0006));
    const lamA = createMat(0x8a94a3, 0.42, 0.85), lamB = createMat(0x727d8c, 0.5, 0.8);
    for (let i = 0; i < lamN; i++) {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(statorR, statorR, statorH / lamN * 0.96, 44),
        (i % 2) ? lamA : lamB);
      disc.position.y = statorBottom + (i + 0.5) * (statorH / lamN); root.add(disc);
    }

    // 12 copper-wound teeth around the stator
    const teeth = 12;
    const copper = createMat(0xb5641e, 0.34, 0.72, { emissive: 0x3a1c08, emissiveIntensity: 0.25 });
    const enamel = createMat(0xd08a3a, 0.3, 0.5);
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

    // spinning assembly: anodised bell + top + hub + shaft + prop nut
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
    const bellMat = createMat(0x1f242b, 0.33, 0.86, { emissive: accent, emissiveIntensity: 0.05 });
    const bell = new THREE.Mesh(new THREE.LatheGeometry(p, 64), bellMat);
    bell.castShadow = true; spin.add(bell);

    // anodised accent ring near the bottom rim
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(bellR * 1.005, bellR * 1.005, bellH * 0.09, 64, 1, true),
      createMat(accent, 0.36, 0.7, { emissive: accent, emissiveIntensity: 0.18 }));
    ring.position.y = bellBottom + bellH * 0.14; spin.add(ring);

    // top cap: spokes + vent holes + centre hub with screws
    const topCap = new THREE.Mesh(new THREE.CylinderGeometry(bellR * 0.62, bellR * 0.62, 0.0006, 48),
      createMat(accent, 0.38, 0.66, { emissive: accent, emissiveIntensity: 0.12 }));
    topCap.position.y = bellTop + 0.0004; spin.add(topCap);
    const ventMat = createMat(0x05070a, 0.8, 0.1);
    for (let h = 0; h < 6; h++) {
      const a = (h / 6) * Math.PI * 2;
      const vent = new THREE.Mesh(new THREE.CylinderGeometry(bellR * 0.1, bellR * 0.1, 0.0016, 20),
        ventMat);
      vent.position.set(Math.cos(a) * bellR * 0.4, bellTop + 0.0002, Math.sin(a) * bellR * 0.4); spin.add(vent);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(bellR * 0.24, bellR * 0.26, 0.004, 28),
      createMat(0x2a2f36, 0.4, 0.8)); hub.position.y = bellTop + 0.002; spin.add(hub);
    for (let s = 0; s < 3; s++) {
      const a = (s / 3) * Math.PI * 2;
      const scr = new THREE.Mesh(new THREE.CylinderGeometry(0.0009, 0.0009, 0.0016, 6),
        createMat(0xced5dd, 0.34, 0.9));
      scr.position.set(Math.cos(a) * bellR * 0.16, bellTop + 0.0036, Math.sin(a) * bellR * 0.16); spin.add(scr);
    }

    // steel shaft + circlip + anodised prop nut
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, bellH * 1.5, 28),
      createMat(0xdfe5ec, 0.2, 0.95));
    shaft.position.y = bellTop + bellH * 0.35; spin.add(shaft);
    const clip = new THREE.Mesh(new THREE.TorusGeometry(0.0028, 0.0006, 8, 20), createMat(0xc7ccd3, 0.24, 0.9));
    clip.rotation.x = Math.PI / 2; clip.position.y = bellTop + bellH * 0.72; spin.add(clip);
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.0042, 0.0042, 0.004, 6),
      createMat(accent, 0.34, 0.72, { emissive: accent, emissiveIntensity: 0.12 }));
    nut.position.y = bellTop + bellH * 0.5; spin.add(nut);

    return { group: root, spin: spin, dims: { bellR: bellR, bellH: bellH, top: bellTop } };
  }

  function getCarbonFiberTexture() {
    if (_carbonTxtr) return _carbonTxtr;
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#151515';
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = '#262626';
    const numTiles = 8;
    const tileSize = size / numTiles;
    for (let i = 0; i < numTiles; i++) {
      for (let j = 0; j < numTiles; j++) {
        if ((i + j) % 2 === 0) {
          ctx.fillRect(i * tileSize, j * tileSize, tileSize, tileSize);
        }
      }
    }

    ctx.strokeStyle = '#1e1e1e';
    ctx.lineWidth = 1;
    for (let k = 0; k < size; k += 4) {
      ctx.beginPath();
      ctx.moveTo(k, 0); ctx.lineTo(k, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, k); ctx.lineTo(size, k);
      ctx.stroke();
    }

    _carbonTxtr = new THREE.CanvasTexture(canvas);
    _carbonTxtr.wrapS = THREE.RepeatWrapping;
    _carbonTxtr.wrapT = THREE.RepeatWrapping;
    _carbonTxtr.repeat.set(2, 8);
    return _carbonTxtr;
  }

  function createRoundedRectShape(w, d, radius) {
    const shape = new THREE.Shape();
    const x = -w/2;
    const y = -d/2;
    shape.moveTo(x + radius, y);
    shape.lineTo(x + w - radius, y);
    shape.quadraticCurveTo(x + w, y, x + w, y + radius);
    shape.lineTo(x + w, y + d - radius);
    shape.quadraticCurveTo(x + w, y + d, x + w - radius, y + d);
    shape.lineTo(x + radius, y + d);
    shape.quadraticCurveTo(x, y + d, x, y + d - radius);
    shape.lineTo(x, y + radius);
    shape.quadraticCurveTo(x, y, x + radius, y);
    return shape;
  }

  function createAirfoilShape(chord, thickness) {
    const shape = new THREE.Shape();
    shape.moveTo(chord * 0.5, 0);
    shape.quadraticCurveTo(0, thickness * 1.5, -chord * 0.5, 0);
    shape.quadraticCurveTo(0, -thickness * 0.2, chord * 0.5, 0);
    return shape;
  }

  function hexToInt(hexStr) {
    return parseInt(hexStr.replace('#', ''), 16);
  }

  function createMat(color, roughness, metalness, extra) {
    return new THREE.MeshStandardMaterial(Object.assign({
      color: color,
      roughness: roughness,
      metalness: metalness
    }, extra || {}));
  }

  function alignAlongDir(mesh, direction) {
    const up = new THREE.Vector3(0, 1, 0);
    const norm = direction.clone().normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(up, norm);
    mesh.setRotationFromQuaternion(q);
  }

  function ensureGroup() {
    if (!window.Scene || !window.Scene.getScene()) return;
    if (!_droneGrp) {
      _droneGrp = new THREE.Group();
      _droneGrp.position.set(0, 0.02, 0);   // centred on the aero Scene camera target (~y=0); was 0.10 (off-frame, top-clipped)
      window.Scene.getScene().add(_droneGrp);
    }
  }

  function clearAll() {
    if (!_droneGrp) return;
    while (_droneGrp.children.length > 0) {
      const child = _droneGrp.children[0];
      _droneGrp.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    }
    _propGrps = [];
    _motorSpinGrps = [];
    _blurDscs = [];
  }

  function createBlade(radius, baseChord, directionSign) {
    const blade = new THREE.Group();
    const steps = 8;
    const startR = 0.008;
    const stepL = (radius - startR) / steps;

    for (let i = 0; i < steps; i++) {
      const segStart = startR + i * stepL;
      const segL = stepL * 1.05;

      const t = i / (steps - 1);
      const segmentChord = baseChord * (1.15 * (1 - t) + 0.35 * t);
      const segmentThickness = 0.0035 * (1 - t) + 0.0006 * t;
      const pitchAngle = (0.35 * (1 - t) + 0.06 * t) * directionSign;

      const airfoil = createAirfoilShape(segmentChord, segmentThickness);
      const extrudeSettings = {
        steps: 1,
        depth: segL,
        bevelEnabled: false
      };
      const segGeo = new THREE.ExtrudeGeometry(airfoil, extrudeSettings);

      const isTip = (i === steps - 1);
      const segMat = isTip
        ? new THREE.MeshPhysicalMaterial({
            color: 0xef4444,
            roughness: 0.1,
            transmission: 0.7,
            thickness: 0.002,
            transparent: true,
            opacity: 0.85
          })
        : createMat(0x282828, 0.4, 0.1);

      const segMesh = new THREE.Mesh(segGeo, segMat);

      segMesh.rotation.y = -Math.PI / 2;
      segMesh.rotation.x = pitchAngle;
      segMesh.position.x = segStart;
      segMesh.castShadow = true;
      blade.add(segMesh);
    }

    return blade;
  }

  // ── Module 2: designed-blade loft (mirrors Module-1 PropModel._airfoilOutline / _buildBlade) ──
  // NACA 4-digit outline for a unit chord — closed loop of [x, y] fractions of chord. This is the
  // SAME outline math as PropModel._airfoilOutline so the designed prop reads identically to the
  // blade rendered in Module 1 (separate IIFE scopes ⇒ the math is replicated, not shared).
  function _airfoilOutline(camberPct) {
    var tc = 0.12, m = camberPct / 100, p = 0.40, N = 16;
    var upper = [], lower = [];
    for (var k = 0; k <= N; k++) {
      var x = 0.5 * (1 - Math.cos(Math.PI * k / N));   // cosine spacing → smooth rounded LE
      var yt = 5 * tc * (0.2969 * Math.sqrt(x) - 0.1260 * x - 0.3516 * x * x
                         + 0.2843 * x * x * x - 0.1015 * x * x * x * x);
      var yc, dyc;
      if (m === 0) { yc = 0; dyc = 0; }
      else if (x < p) {
        yc  = (m / (p * p)) * (2 * p * x - x * x);
        dyc = (2 * m / (p * p)) * (p - x);
      } else {
        yc  = (m / ((1 - p) * (1 - p))) * ((1 - 2 * p) + 2 * p * x - x * x);
        dyc = (2 * m / ((1 - p) * (1 - p))) * (p - x);
      }
      var th = Math.atan(dyc);
      upper.push([(x - yt * Math.sin(th)) - 0.5, yc + yt * Math.cos(th)]);
      lower.push([(x + yt * Math.sin(th)) - 0.5, yc - yt * Math.cos(th)]);
    }
    var pts = [];
    for (var i = 0; i <= N; i++) pts.push(upper[i]);       // LE → TE (upper)
    for (var j = N - 1; j >= 1; j--) pts.push(lower[j]);   // TE → LE (lower)
    return pts;                                            // closed loop, length 2N
  }

  // Loft ONE designed blade shaped like the Module-1 design, sized to the visual radius.
  //   SHAPE  (taper ratio, twist distribution, camber, thickness) ← the student's propDef.
  //   LENGTH (spanwise extent)                                    ← R_m_visual (fits the airframe).
  // The design chords are scaled by (R_m_visual / propDef.R_m) so the blade is a faithful scaled
  // copy of the Module-1 blade (preserves taper RATIO + aspect ratio; keeps proportions sane even
  // when the visual radius differs from the designed radius). directionSign flips the twist so
  // CW/CCW props mirror correctly. Returns a THREE.Group containing a single closed-solid blade
  // mesh extending along +X (radial), so updateFromSelections can space N copies by 2π/N about Y.
  function buildDesignedBlade(propDef, R_m_visual, directionSign) {
    var grp = new THREE.Group();
    if (!propDef) return grp;
    var dir = (directionSign < 0) ? -1 : 1;
    var camber = (propDef.airfoil && isFinite(propDef.airfoil.camber)) ? propDef.airfoil.camber : 0;
    // Amplify camber for on-screen distinction between NACA 0012 / 2412 / 4412 (visual only) — matches Module 1.
    var outline = _airfoilOutline(camber * 2.4);
    var P = outline.length;
    var S = 14;                                              // spanwise stations (12–16 per design §4.2)
    var Rvis    = (isFinite(R_m_visual) && R_m_visual > 0) ? R_m_visual : 0.12;
    var startR  = 0.006;                                     // root anchored INTO the DroneModel hub (hubR ≈ 0.006)
    var spanLen = Math.max(0.02, Rvis - startR);
    var Rdes    = (propDef.R_m && propDef.R_m > 0) ? propDef.R_m : Rvis;
    var cScale  = Rvis / Rdes;                               // scale design chords to the visual span
    var cr      = (propDef.c_root_mm / 1000) * cScale;       // mm → m, scaled
    var ct      = (propDef.c_tip_mm  / 1000) * cScale;
    var thRoot  = (propDef.theta_root_deg || 0) * (Math.PI / 180);
    var thTip   = (propDef.theta_tip_deg  || 0) * (Math.PI / 180);

    var positions = [], indices = [];
    for (var k = 0; k <= S; k++) {
      var t = k / S;
      var r = startR + t * spanLen;
      var taper    = cr + (ct - cr) * t;                                                    // chord taper from design
      var fair     = t < 0.15 ? (0.70 + 0.30 * (t / 0.15)) : 1.0;                           // root fairing
      var tipRound = t > 0.88 ? Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.88) / 0.12, 2))) : 1.0; // rounded tip
      var chord = taper * fair * Math.max(0.14, tipRound);
      var theta = (thRoot + (thTip - thRoot) * t) * dir;                                    // twist; sign per prop direction
      var sweep = t * t * Rvis * 0.05;
      var cT = Math.cos(theta), sT = Math.sin(theta);
      for (var iP = 0; iP < P; iP++) {
        var cc = outline[iP][0] * chord;     // chordwise (→ world Z)
        var hh = outline[iP][1] * chord;     // thickness (→ world Y)
        var y = hh * cT - cc * sT;           // pitch twist about span (X)
        var z = hh * sT + cc * cT + sweep;
        positions.push(r, y, z);
      }
    }

    // Skin faces between consecutive rings
    for (var kk = 0; kk < S; kk++) {
      for (var ip = 0; ip < P; ip++) {
        var a  = kk * P + ip;
        var b  = kk * P + ((ip + 1) % P);
        var cN = (kk + 1) * P + ((ip + 1) % P);
        var d  = (kk + 1) * P + ip;
        indices.push(a, b, d, b, cN, d);
      }
    }

    // Cap the root (ring 0) and tip (ring S) so the blade is a closed solid (mirrors Module-1 _buildBlade).
    function _ringCentroid(ringStart) {
      var cx = 0, cy = 0, cz = 0;
      for (var q = 0; q < P; q++) {
        cx += positions[(ringStart + q) * 3];
        cy += positions[(ringStart + q) * 3 + 1];
        cz += positions[(ringStart + q) * 3 + 2];
      }
      return [cx / P, cy / P, cz / P];
    }
    var rootC = _ringCentroid(0);
    var rootCi = positions.length / 3;
    positions.push(rootC[0], rootC[1], rootC[2]);
    for (var ir = 0; ir < P; ir++) indices.push(rootCi, ir, (ir + 1) % P);          // root fan
    var tipStart = S * P;
    var tipC = _ringCentroid(tipStart);
    var tipCi = positions.length / 3;
    positions.push(tipC[0], tipC[1], tipC[2]);
    for (var it = 0; it < P; it++) indices.push(tipCi, tipStart + ((it + 1) % P), tipStart + it); // tip fan

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    // Solid prop-like material (dark, slight metalness) — not the Module-1 stall-overlay vertex colours.
    var mat = new THREE.MeshStandardMaterial({
      color: 0x1f2937, roughness: 0.35, metalness: 0.25, side: THREE.DoubleSide
    });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    grp.add(mesh);
    return grp;
  }

  function updateFromSelections(sel) {
    ensureGroup();
    if (!_droneGrp) return;
    clearAll();

    const frame = sel.frame;
    const motor = sel.motor;
    const prop = sel.propeller;
    const batt = sel.battery;
    const esc = sel.esc;
    const fc = sel.flight_controller;
    const rx = sel.receiver;
    const payloads = sel.payloads || [];

    _droneGrp.position.set(0, 0.02, 0);   // keep in sync with ensureGroup(); centred on camera target (was 0.10)

    if (!frame) return;

    const bw = frame.body_size_mm[0] / 1000;
    const bh = frame.body_size_mm[1] / 1000;
    const bz = frame.body_size_mm[2] / 1000;

    const frameMat = createMat(hexToInt(frame.color_hex), frame.roughness, frame.metalness);

    const plateShape = createRoundedRectShape(bw, bz, Math.min(bw, bz) * 0.12);
    const extrudeSettings = {
      steps: 1,
      depth: 0.002,
      bevelEnabled: true,
      bevelThickness: 0.0005,
      bevelSize: 0.0005,
      bevelOffset: 0,
      bevelSegments: 2
    };

    const bottomPlateGeo = new THREE.ExtrudeGeometry(plateShape, extrudeSettings);
    const bottomPlate = new THREE.Mesh(bottomPlateGeo, frameMat);
    bottomPlate.rotation.x = -Math.PI / 2;
    bottomPlate.position.y = -0.001;
    bottomPlate.receiveShadow = true;
    bottomPlate.castShadow = true;
    _droneGrp.add(bottomPlate);

    const topPlateShape = createRoundedRectShape(bw * 0.95, bz * 0.95, Math.min(bw, bz) * 0.12);
    const topPlateGeo = new THREE.ExtrudeGeometry(topPlateShape, extrudeSettings);
    const topPlate = new THREE.Mesh(topPlateGeo, frameMat);
    topPlate.rotation.x = -Math.PI / 2;
    topPlate.position.y = bh - 0.001;
    topPlate.castShadow = true;
    _droneGrp.add(topPlate);

    const standoffR = 0.0025;
    const standoffMat = createMat(0xd1d5db, 0.3, 0.9);
    const cornerOffsets = [
      [-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]
    ];
    cornerOffsets.forEach(function (off) {
      const standoffGeo = new THREE.CylinderGeometry(standoffR, standoffR, bh - 0.002, 8);
      const standoffMesh = new THREE.Mesh(standoffGeo, standoffMat);
      standoffMesh.position.set(bw * off[0], bh / 2, bz * off[1]);
      standoffMesh.castShadow = true;
      _droneGrp.add(standoffMesh);
    });

    const motorRadius = frame.wheelbase_mm / 2000;
    const armR = (frame.arm_tube_od_mm / 2) / 1000;

    const carbonTex = getCarbonFiberTexture();
    const armMat = new THREE.MeshStandardMaterial({
      color: 0x333333,
      map: carbonTex,
      roughness: 0.2,
      metalness: 0.8
    });

    _armDirs.forEach(function (dir, i) {
      const armGeo = new THREE.CylinderGeometry(armR, armR, motorRadius, 12);
      const armMesh = new THREE.Mesh(armGeo, armMat);
      armMesh.position.copy(dir.clone().multiplyScalar(motorRadius / 2));
      armMesh.position.y = bh * 0.45;
      alignAlongDir(armMesh, new THREE.Vector3(dir.x, 0, dir.z));
      armMesh.castShadow = true;
      _droneGrp.add(armMesh);

      const tipPos = new THREE.Vector3(dir.x * motorRadius, bh * 0.45, dir.z * motorRadius);
      const mountGeo = new THREE.CylinderGeometry(armR * 2.1, armR * 2.1, 0.003, 12);
      const mountMesh = new THREE.Mesh(mountGeo, frameMat);
      mountMesh.position.copy(tipPos);
      _droneGrp.add(mountMesh);

      const screwGeo = new THREE.CylinderGeometry(0.0008, 0.0008, 0.0006, 6);
      const screwMat = createMat(0x64748b, 0.2, 0.9);
      const screwDist = armR * 1.5;
      const screwOffsets = [
        [-screwDist, -screwDist],
        [-screwDist, screwDist],
        [screwDist, -screwDist],
        [screwDist, screwDist]
      ];
      screwOffsets.forEach(function (soff) {
        const screw = new THREE.Mesh(screwGeo, screwMat);
        screw.position.set(tipPos.x + soff[0], tipPos.y + 0.0016, tipPos.z + soff[1]);
        _droneGrp.add(screw);
      });

      const legHeight = 0.12;
      const legGeo = new THREE.CylinderGeometry(0.003, 0.002, legHeight, 6);
      const legMesh = new THREE.Mesh(legGeo, frameMat);
      legMesh.position.copy(tipPos);
      legMesh.position.y -= legHeight / 2 + 0.002;
      alignAlongDir(legMesh, new THREE.Vector3(0, -1, 0));
      legMesh.castShadow = true;
      _droneGrp.add(legMesh);

      if (motor) {
        const bellH = motor.bell_height_mm / 1000;
        const motorY = tipPos.y + 0.0015;

        // Exp 1's high-poly "hero" BLDC outrunner (mount cross, laminated
        // stator, copper windings, anodised bell + top-cap cluster) replaces
        // the old flat-mesh bell so every experiment shows the same motor.
        const heroMotor = buildMotorMesh(motor);
        heroMotor.group.position.set(tipPos.x, motorY - 0.004, tipPos.z);
        heroMotor.group.castShadow = true;
        _droneGrp.add(heroMotor.group);
        _motorSpinGrps.push(heroMotor.spin);   // bell turns with its prop (was previously static)

        if (prop) {
          const propR = prop.diameter_m / 2;
          const propChord = 0.016 + prop.diameter_m * 0.04;
          const hubH = 0.012;
          const propY = motorY + bellH * 1.5 + hubH / 2;   // hub rests at the hero motor's prop nut, like Exp 1

          const propGroup = new THREE.Group();
          propGroup.position.set(tipPos.x, propY, tipPos.z);
          _droneGrp.add(propGroup);
          _propGrps.push(propGroup);

          const hubGeo = new THREE.CylinderGeometry(0.006, 0.006, hubH, 10);
          const hubMat = createMat(0x111827, 0.5, 0.1);
          const hubMesh = new THREE.Mesh(hubGeo, hubMat);
          propGroup.add(hubMesh);

          const nutGeo = new THREE.CylinderGeometry(0.0035, 0.0045, 0.005, 8);
          const nutMat = createMat(0xd1d5db, 0.2, 0.9);
          const nutMesh = new THREE.Mesh(nutGeo, nutMat);
          nutMesh.position.y = hubH / 2 + 0.0025;
          propGroup.add(nutMesh);

          const dirSign = _propSigns[i];
          if (_designedProp) {
            // Render the propeller the student DESIGNED in Module 1: N blades lofted from the
            // designed propDef (taper/twist/camber/thickness), sized to the visual radius propR
            // so it still fits the airframe. Blades are spaced evenly by 2π/N about the hub axis.
            var Nb = Math.max(2, Math.round(_designedProp.N) || 2);
            for (var bIdx = 0; bIdx < Nb; bIdx++) {
              var dBlade = buildDesignedBlade(_designedProp, propR, dirSign);
              dBlade.rotation.y = bIdx * (2 * Math.PI / Nb);
              propGroup.add(dBlade);
            }
          } else {
            // Fallback (no designed propDef): the original catalog 2-blade prop — byte-for-byte
            // unchanged, so Module 1 and any other consumer are unaffected.
            const b1 = createBlade(propR, propChord, dirSign);
            const b2 = createBlade(propR, propChord, dirSign);
            b2.rotation.y = Math.PI;

            propGroup.add(b1);
            propGroup.add(b2);
          }

          const discGeo = new THREE.CircleGeometry(propR * 1.02, 32);
          const discMat = new THREE.MeshBasicMaterial({
            color: 0x111827,
            transparent: true,
            opacity: 0.0,
            side: THREE.DoubleSide,
            depthWrite: false
          });
          const discMesh = new THREE.Mesh(discGeo, discMat);
          discMesh.rotation.x = -Math.PI / 2;
          propGroup.add(discMesh);
          _blurDscs.push(discMat);
        }
      }
    });

    if (batt) {
      const capacity = batt.capacity_mah;
      const normVal = Math.min(Math.max((capacity - 800) / 3400, 0), 1);
      const battW = 0.068 + normVal * 0.076;
      const battH = 0.026 + normVal * 0.016;
      const battD = 0.020 + normVal * 0.018;

      const cellColors = { 3: 0x6e2a14, 4: 0x1f2937, 6: 0x1e1b4b };
      const battColor = cellColors[batt.cells] || 0x22252a;

      const battGeo = new THREE.BoxGeometry(battW, battH, battD);
      const battMat = createMat(battColor, 0.8, 0.05);
      const battMesh = new THREE.Mesh(battGeo, battMat);

      const battY = -battH / 2 - 0.003;
      battMesh.position.set(0, battY, 0);
      battMesh.castShadow = true;
      _droneGrp.add(battMesh);

      const xt60Geo = new THREE.BoxGeometry(0.008, 0.006, 0.012);
      const xt60Mat = createMat(0xeab308, 0.4, 0.1);
      const xt60Mesh = new THREE.Mesh(xt60Geo, xt60Mat);
      xt60Mesh.position.set(0, battY, battD / 2 + 0.004);
      _droneGrp.add(xt60Mesh);

      const wireGeo = new THREE.CylinderGeometry(0.001, 0.001, 0.016, 6);
      const wireMatRed = createMat(0xef4444, 0.7, 0.0);
      const wireRed = new THREE.Mesh(wireGeo, wireMatRed);
      wireRed.position.set(-0.002, battY + 0.002, battD / 2 + 0.009);
      wireRed.rotation.x = Math.PI / 2;
      _droneGrp.add(wireRed);

      const wireMatBlack = createMat(0x1e293b, 0.7, 0.0);
      const wireBlack = new THREE.Mesh(wireGeo, wireMatBlack);
      wireBlack.position.set(0.002, battY + 0.002, battD / 2 + 0.009);
      wireBlack.rotation.x = Math.PI / 2;
      _droneGrp.add(wireBlack);

      const padGeo = new THREE.BoxGeometry(battW * 0.9, 0.002, battD * 0.9);
      const padMat = createMat(0x111827, 0.9, 0.0);
      const padMesh = new THREE.Mesh(padGeo, padMat);
      padMesh.position.set(0, -0.001, 0);
      _droneGrp.add(padMesh);

      const strapWidth = 0.008;
      const strapMat = createMat(0x111827, 0.9, 0.0);
      const strapOffsets = [-battW * 0.25, battW * 0.25];

      strapOffsets.forEach(function (zOff) {
        const strapGeo = new THREE.BoxGeometry(battD * 1.05, battH + bh + 0.006, strapWidth);
        const strapMesh = new THREE.Mesh(strapGeo, strapMat);
        strapMesh.position.set(zOff, (bh - battH) / 2, 0);
        strapMesh.rotation.y = Math.PI / 2;
        _droneGrp.add(strapMesh);
      });
    }

    if (esc) {
      if (esc.quantity === 1) {
        const escGeo = new THREE.BoxGeometry(0.032, 0.003, 0.032);
        const escMat = createMat(0x14532d, 0.7, 0.1);
        const escMesh = new THREE.Mesh(escGeo, escMat);
        escMesh.position.set(0, 0.008, 0);
        _droneGrp.add(escMesh);

        const spacerGeo = new THREE.CylinderGeometry(0.001, 0.001, 0.006, 6);
        const spacerMat = createMat(0xf59e0b, 0.5, 0.2);
        const stackCorners = [[-0.012, -0.012], [0.012, -0.012], [-0.012, 0.012], [0.012, 0.012]];
        stackCorners.forEach(function (pt) {
          const spacer = new THREE.Mesh(spacerGeo, spacerMat);
          spacer.position.set(pt[0], 0.0125, pt[1]);
          _droneGrp.add(spacer);
        });
      } else {
        _armDirs.forEach(function (dir) {
          const escPos = dir.clone().multiplyScalar(motorRadius * 0.45);
          const escGeo = new THREE.BoxGeometry(0.014, 0.003, 0.024);
          const escMat = createMat(0x111827, 0.85, 0.0);
          const escMesh = new THREE.Mesh(escGeo, escMat);
          escMesh.position.set(escPos.x, bh * 0.45 + 0.004, escPos.z);
          escMesh.rotation.y = Math.atan2(dir.x, dir.z);
          _droneGrp.add(escMesh);
        });
      }
    }

    if (fc) {
      const fcY = esc && esc.quantity === 1 ? 0.018 : 0.010;
      const fcGeo = new THREE.BoxGeometry(0.030, 0.003, 0.030);
      const fcMat = createMat(0x14532d, 0.7, 0.1);
      const fcMesh = new THREE.Mesh(fcGeo, fcMat);
      fcMesh.position.set(0, fcY, 0);
      _droneGrp.add(fcMesh);
    }

    if (rx) {
      const rxGeo = new THREE.BoxGeometry(0.018, 0.004, 0.013);
      const rxMat = createMat(0x1f2937, 0.8, 0.05);
      const rxMesh = new THREE.Mesh(rxGeo, rxMat);
      rxMesh.position.set(0, 0.003, bz * 0.32);
      _droneGrp.add(rxMesh);

      const antMat = createMat(0x111827, 0.9, 0.0);
      const tipMat = createMat(0xd1d5db, 0.4, 0.8);

      const antLGroup = new THREE.Group();
      antLGroup.position.set(-0.006, bh, bz * 0.32);
      const tubeL = new THREE.Mesh(new THREE.CylinderGeometry(0.0008, 0.0008, 0.035, 6), antMat);
      tubeL.position.y = 0.0175;
      antLGroup.add(tubeL);
      const activeL = new THREE.Mesh(new THREE.CylinderGeometry(0.0005, 0.0005, 0.015, 6), tipMat);
      activeL.position.y = 0.035 + 0.0075;
      antLGroup.add(activeL);
      antLGroup.rotation.z = 0.6;
      antLGroup.rotation.x = 0.3;
      _droneGrp.add(antLGroup);

      const antRGroup = new THREE.Group();
      antRGroup.position.set(0.006, bh, bz * 0.32);
      const tubeR = new THREE.Mesh(new THREE.CylinderGeometry(0.0008, 0.0008, 0.035, 6), antMat);
      tubeR.position.y = 0.0175;
      antRGroup.add(tubeR);
      const activeR = new THREE.Mesh(new THREE.CylinderGeometry(0.0005, 0.0005, 0.015, 6), tipMat);
      activeR.position.y = 0.035 + 0.0075;
      antRGroup.add(activeR);
      antRGroup.rotation.z = -0.6;
      antRGroup.rotation.x = 0.3;
      _droneGrp.add(antRGroup);
    }

    payloads.forEach(function (p) {
      addPayload(p, frame);
    });
  }

  function addPayload(p, frame) {
    const bw = frame ? frame.body_size_mm[0] / 1000 : 0.088;
    const bz = frame ? frame.body_size_mm[2] / 1000 : 0.088;

    switch (p.id) {
      case 'gimbal_2axis':
      case 'gimbal_3axis': {
        const g = new THREE.Group();
        const ballGeo = new THREE.SphereGeometry(0.003, 8, 8);
        const ballMat = createMat(0x2563eb, 0.9, 0.0);
        const ballOffsets = [[-0.015, -0.015], [0.015, -0.015], [-0.015, 0.015], [0.015, 0.015]];
        ballOffsets.forEach(function (off) {
          const ball = new THREE.Mesh(ballGeo, ballMat);
          ball.position.set(off[0], -0.0015, off[1]);
          g.add(ball);
        });

        const base = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.002, 0.035), createMat(0x1f2937, 0.6, 0.3));
        base.position.y = -0.004;
        g.add(base);

        if (p.id === 'gimbal_2axis') {
          const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.024, 8), createMat(0x4b5563, 0.5, 0.5));
          roll.rotation.z = Math.PI / 2;
          roll.position.set(0, -0.015, 0);
          g.add(roll);
        } else {
          const yaw = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.015, 10), createMat(0x1f2937, 0.5, 0.8));
          yaw.position.set(0, -0.012, 0);
          g.add(yaw);
        }

        g.position.set(0, -0.002, -bw * 0.22);
        _droneGrp.add(g);
        break;
      }

      case 'camera_gopro': {
        const g = new THREE.Group();
        const mountGeo = new THREE.BoxGeometry(0.036, 0.028, 0.024);
        const mountMat = createMat(0x2563eb, 0.8, 0.0);
        const mount = new THREE.Mesh(mountGeo, mountMat);
        mount.position.y = frame ? frame.body_size_mm[1] / 1000 + 0.014 : 0.036;
        mount.position.z = -bw * 0.32;
        mount.rotation.x = -0.15;
        g.add(mount);

        const camGeo = new THREE.BoxGeometry(0.032, 0.024, 0.018);
        const camMat = createMat(0x111827, 0.6, 0.1);
        const cam = new THREE.Mesh(camGeo, camMat);
        cam.position.copy(mount.position);
        cam.rotation.x = mount.rotation.x;
        g.add(cam);

        const lensGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.004, 12);
        const lensMat = createMat(0x1e3a8a, 0.1, 0.8);
        const lens = new THREE.Mesh(lensGeo, lensMat);
        lens.rotation.x = Math.PI / 2;
        lens.position.copy(cam.position).add(new THREE.Vector3(0.007, 0, -0.010));
        g.add(lens);

        _droneGrp.add(g);
        break;
      }

      case 'camera_fpv_nano': {
        const g = new THREE.Group();
        const sideGeo = new THREE.BoxGeometry(0.002, 0.015, 0.012);
        const sideMat = createMat(0x9ca3af, 0.4, 0.6);
        const left = new THREE.Mesh(sideGeo, sideMat);
        left.position.x = -0.008;
        const right = left.clone();
        right.position.x = 0.008;
        g.add(left);
        g.add(right);

        const coreGeo = new THREE.BoxGeometry(0.012, 0.012, 0.012);
        const coreMat = createMat(0x111827, 0.6, 0.1);
        const core = new THREE.Mesh(coreGeo, coreMat);
        g.add(core);

        const lensGeo = new THREE.CylinderGeometry(0.0035, 0.0035, 0.005, 10);
        const lensMat = createMat(0x1e293b, 0.1, 0.9);
        const lens = new THREE.Mesh(lensGeo, lensMat);
        lens.rotation.x = Math.PI / 2;
        lens.position.z = -0.0085;
        g.add(lens);

        g.position.set(0, (frame ? frame.body_size_mm[1] / 1000 : 0.026) / 2, -bw * 0.42);
        g.rotation.x = 0.25;
        _droneGrp.add(g);
        break;
      }

      case 'gps_m8n':
      case 'gps_m9n_compass': {
        const g = new THREE.Group();
        const heightGPS = 0.06;
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, heightGPS, 6), createMat(0x111827, 0.8, 0.2));
        mast.position.y = heightGPS / 2;
        g.add(mast);

        const r = p.id === 'gps_m9n_compass' ? 0.025 : 0.020;
        const dome = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.006, 20), createMat(0xf3f4f6, 0.7, 0.05));
        dome.position.y = heightGPS + 0.003;
        g.add(dome);

        g.position.set(-bw * 0.2, frame ? frame.body_size_mm[1] / 1000 : 0.026, bz * 0.2);
        _droneGrp.add(g);
        break;
      }

      case 'lidar_tfmini': {
        const g = new THREE.Group();
        const tf = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.016, 0.010), createMat(0x111827, 0.8, 0.0));
        g.add(tf);
        g.position.set(0, -0.003, 0);
        g.rotation.x = Math.PI / 2;
        _droneGrp.add(g);
        break;
      }

      case 'lidar_garmin': {
        const g = new THREE.Group();
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.014, 16), createMat(0x1f2937, 0.7, 0.1));
        g.add(base);
        g.position.set(0, -0.008, 0);
        _droneGrp.add(g);
        break;
      }

      case 'telemetry_915': {
        const g = new THREE.Group();
        const TelemBox = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.008, 0.014), createMat(0x2563eb, 0.7, 0.1));
        g.add(TelemBox);
        const whip = new THREE.Mesh(new THREE.CylinderGeometry(0.0006, 0.0006, 0.070, 5), createMat(0x111827, 0.9, 0.0));
        whip.position.set(0.010, 0.035, 0); whip.rotation.z = -0.15;
        g.add(whip);
        g.position.set(bw * 0.4, (frame ? frame.body_size_mm[1] / 1000 : 0.026) / 2, 0);
        g.rotation.y = Math.PI / 2;
        _droneGrp.add(g);
        break;
      }

      case 'fpv_vtx': {
        const g = new THREE.Group();
        const bodyBox = new THREE.Mesh(new THREE.BoxGeometry(0.020, 0.008, 0.016), createMat(0x374151, 0.5, 0.7));
        g.add(bodyBox);
        const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.0008, 0.0008, 0.050, 6), createMat(0x111827, 0.9, 0.0));
        antenna.position.set(0, 0.025, 0.006);
        antenna.rotation.x = 0.2;
        g.add(antenna);
        g.position.set(0, frame ? frame.body_size_mm[1] / 1000 + 0.005 : 0.031, bz * 0.38);
        _droneGrp.add(g);
        break;
      }

      default:
        break;
    }
  }

  function animateProps(delta) {
    var dt = isFinite(delta) ? delta : 0;
    _t += dt;

    // Ease the actual speed toward the commanded target (smooth accel/decel; spring-stop).
    _fwdSpeed += (_fwdTarget - _fwdSpeed) * Math.min(1, dt * 2.0);
    // Forward travel along −X, UNBOUNDED — no reset/recycle (camera follows; ground is endless).
    _fwdX -= _fwdSpeed * dt * FWD_SCALE;
    // Ease the applied lean toward the target so attitude changes are smooth.
    _leanApplied += (_leanZ - _leanApplied) * Math.min(1, dt * 3.0);

    if (_droneGrp) {
      _droneGrp.position.x = _fwdX;     // forward travel
      _droneGrp.position.y = 0.02;      // steady — NO hover bob
      _droneGrp.rotation.z = _leanApplied;  // lean INTO −X travel (no sway)
      _droneGrp.rotation.x = 0;
    }

    if (!_propGrps.length) return;

    // Always-on lazy spin: floor the effective RPM so the rotors ALWAYS turn (alive on Tab 1
    // and at idle/stopped), then ramp the real spin speed above that with _rotRPM.
    // VISUAL rev/s is capped sub-aliasing (real 3k–18k RPM = 50–300 rev/s would
    // alias to a frozen blade at 60 fps); monotonic & ~proportional over the
    // working band, with the motion-blur disc conveying the true blur.
    var rpmEff = Math.max(_rotRPM, 700);
    var omega  = Math.min(8, rpmEff / 2500) * 2.0 * Math.PI;

    _propGrps.forEach(function (pg, i) {
      var activeTab = window.Scene ? window.Scene.getActiveTab() : 1;
      var sign = activeTab === 1 ? 1 : _propSigns[i];   // keep per-arm CW/CCW signs on Tab 2
      pg.rotation.y += sign * omega * dt;
    });

    // Motor bells spin on the same shaft as their propeller — same omega/sign.
    _motorSpinGrps.forEach(function (sg, i) {
      var activeTab = window.Scene ? window.Scene.getActiveTab() : 1;
      var sign = activeTab === 1 ? 1 : _propSigns[i];
      sg.rotation.y += sign * omega * dt;
    });

    // Motion-blur read: as RPM climbs, fade the spinning blades slightly AND ramp the
    // translucent disc so the rotor reads as a blurred disc rather than discrete blades.
    var discOpa  = Math.max(0, Math.min(0.30, (rpmEff - 1200) / 14000));
    var bladeOpa = rpmEff > 1500 ? Math.max(0.55, 1 - (rpmEff - 1500) / 16000) : 1;
    var fadeBlades = bladeOpa < 1;

    // Fade only the BLADE meshes. Blades live inside child GROUPS of each propGroup
    // (catalog b1/b2 segment groups → ExtrudeGeometry, or designed dBlade groups →
    // BufferGeometry); the hub/nut/disc are direct mesh children (no children) and are
    // left untouched. Traverse handles both blade builds + any nesting. Guard materials.
    _propGrps.forEach(function (pg) {
      pg.children.forEach(function (child) {
        if (!child.children || child.children.length === 0) return;   // skip hub/nut/disc meshes
        child.traverse(function (node) {
          if (!node.isMesh || !node.material) return;
          var mats = Array.isArray(node.material) ? node.material : [node.material];
          mats.forEach(function (m) {
            if (!m) return;
            m.transparent = fadeBlades;
            m.opacity = bladeOpa;
          });
        });
      });
    });

    _blurDscs.forEach(function (discMat) {
      if (discMat) discMat.opacity = discOpa;
    });
  }

  function setSimRPM(rpm) {
    _rotRPM = Math.max(0, rpm);
  }

  // Module 2: apply the forward-flight nose-down body lean by STORING its magnitude, which is
  // applied about the longitudinal (Z) axis in animateProps (combined with the roll-sway) so the
  // craft tips INTO its forward (−X) travel. Clamp to 0–35°; ROTATION ONLY — the centred y≈0.02
  // framing is preserved (no translation). On Tab 1 the caller resets this to 0 (stationary drone).
  function setPitch(angleRad) {
    if (!_droneGrp) return;
    var a = isFinite(angleRad) ? Math.max(0, Math.min(angleRad, 35 * Math.PI / 180)) : 0;
    _leanZ = a;                 // lean magnitude; applied about Z in animateProps so it tips INTO the −X travel
    _droneGrp.rotation.x = 0;   // clear the old (perpendicular) X-axis tilt
  }

  // Module 2: command the Tab-2 forward-flight TARGET speed (m/s); _fwdSpeed eases toward it so the
  // craft accelerates/decelerates smoothly. Releasing the throttle → target 0 → drone eases to a
  // stop IN PLACE (resetFlight recenters for Tab 1). Guards non-finite / ≤0 → 0.
  function setForwardSpeed(V) { _fwdTarget = (isFinite(V) && V > 0) ? V : 0; }

  // Module 2: recenter the drone for Tab 1 — clears forward travel, speed, lean and pose.
  function resetFlight() {
    _fwdTarget = 0; _fwdSpeed = 0; _fwdX = 0; _leanZ = 0; _leanApplied = 0;
    if (_droneGrp) { _droneGrp.position.x = 0; _droneGrp.position.y = 0.02; _droneGrp.rotation.x = 0; _droneGrp.rotation.z = 0; }
  }

  return {
    updateFromSelections: updateFromSelections,
    clearAll: clearAll,
    animateProps: animateProps,
    setSimRPM: setSimRPM,
    getDroneGroup: function () { return _droneGrp; },
    setDesignedProp: setDesignedProp,
    setPitch: setPitch,
    setForwardSpeed: setForwardSpeed,
    resetFlight: resetFlight
  };
})();
window.DroneModel = DroneModel;

// ═══════════════════════════════════════════════════════════════════
// 4c. AEROFLOW IIFE (new, Module 2 only) — window.AeroFlow
//     Oncoming-airflow particle stream flowing past the whole drone.
//     Driven by the Scene aux-tick hook alongside DroneModel.animateProps.
// ═══════════════════════════════════════════════════════════════════
const AeroFlow = (function () {
  'use strict';

  var _flow    = null;     // THREE.Points — oncoming stream
  var _plane   = null;     // THREE.Mesh — translucent frontal-area panel (normal to flow)
  var _data    = [];       // per-particle base Y/Z offsets + phase
  var _speed   = 0;        // current V (m/s) drives particle velocity + tilt
  var _rho     = 1.225;    // current ρ → mist particle count + opacity
  var _area    = 0.0152;   // current A → plane size + mist Y/Z footprint
  var _mode    = 'drag';   // 'drag' (Tab 1) | 'flight' (Tab 2)
  var _vmax    = 30;       // Tab 1 V scale (m/s)
  var _running = false;

  var _xMin = -0.6;        // upstream start (negative X)
  var _xMax = 0.6;         // downstream recycle boundary
  var _yCtr = 0.02;        // mist/plane centre height (matches centred drone group)
  var _footHalf = 0.12;    // current mist Y/Z half-extent (~√A·2)

  // Soft round mist sprite — a 64×64 white→transparent radial-gradient alpha texture, built
  // ONCE and cached module-locally so every rebuild reuses it (Material.dispose() never frees
  // a texture, so the cached sprite safely survives stream rebuilds). Turns the square point
  // sprites into soft glowing puffs that read as drifting mist instead of hard dots.
  var _spriteTex = null;
  function _getSpriteTexture() {
    if (_spriteTex) return _spriteTex;
    var THREE = window.THREE;
    if (!THREE || typeof document === 'undefined') return null;
    var size = 64;
    var canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    var ctx = canvas.getContext('2d');
    var g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0.0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.65)');
    g.addColorStop(1.0, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    _spriteTex = new THREE.CanvasTexture(canvas);
    return _spriteTex;
  }

  // Resize the frontal-area panel in place so its visible face is √A × √A (W×H = A).
  // PlaneGeometry's face spans LOCAL X,Y (its normal is local Z). After rotation.y = π/2
  // the local Z normal points along the flow (+X); local X→world Z and local Y→world Y,
  // so scaling local X and Y by √A yields a √A(Z) × √A(Y) square standing normal to the
  // flow. (Scaling local Z would only stretch the zero-thickness normal — no visible effect,
  // which is why the literal (1,√A,√A) tuple cannot produce a √A square here.)
  function _applyPlaneSize() {
    if (!_plane) return;
    var s = Math.sqrt((isFinite(_area) && _area > 0) ? _area : 0.0152) * 2.0;  // visual gain → frontal area visibly evident
    _plane.scale.set(s, s, 1);
  }

  // Map air density ρ → mist visibility: denser/whiter near sea level, sparse/faint at
  // altitude. Drives both PointsMaterial opacity and the visible particle draw-count.
  function _applyDensity() {
    if (!_flow) return;
    var f = Math.max(0, Math.min(1, (_rho - 0.85) / (1.225 - 0.85)));
    // Raised floors (additive soft sprites read fainter than hard dots) so the stream is always
    // visibly flowing while running, then strengthens/whitens with ρ toward sea level.
    _flow.material.opacity = 0.40 + 0.40 * f;
    var n = Math.max(1, Math.round(_data.length * (0.55 + 0.45 * f)));
    _flow.geometry.setDrawRange(0, n);
  }

  function build(frontalArea_m2) {
    var THREE = window.THREE;
    var scn = window.Scene ? window.Scene.getScene() : null;
    if (!THREE || !scn) return;

    // dispose previous stream
    if (_flow) {
      scn.remove(_flow);
      if (_flow.geometry) _flow.geometry.dispose();
      if (_flow.material) _flow.material.dispose();
      _flow = null;
    }
    // dispose previous frontal-area plane (mesh + child edge outline)
    if (_plane) {
      scn.remove(_plane);
      _plane.traverse(function (o) {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      _plane = null;
    }
    _data = [];

    _area     = (isFinite(frontalArea_m2) && frontalArea_m2 > 0) ? frontalArea_m2 : 0.0152;
    _footHalf = Math.max(0.12, Math.sqrt(_area) * 2.0);   // Y/Z half-extent of mist footprint
    var N     = 460;                                      // denser field so it reads as continuous mist

    var positions = new Float32Array(N * 3);
    for (var i = 0; i < N; i++) {
      var x = _xMin + Math.random() * (_xMax - _xMin);
      var y = _yCtr + (Math.random() * 2 - 1) * _footHalf;
      var z = (Math.random() * 2 - 1) * _footHalf;
      positions[i * 3]     = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      // sz: per-particle scale 0.6..1.4 (drives shimmer drift amplitude — PointsMaterial can't
      // vary per-point size, so the variation rides on the vertical drift below in tick()).
      _data.push({
        y0: y, z0: z,
        phase: Math.random() * Math.PI * 2,
        sz: 0.6 + Math.random() * 0.8,
        drift: Math.random() * Math.PI * 2
      });
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    var mat = new THREE.PointsMaterial({
      color: 0x9cd8ff,                       // light glowing blue (moving-air mist)
      size: 0.014,                           // larger puffs so the sprite reads as mist
      map: _getSpriteTexture(),              // soft round radial-gradient sprite (cached, built once)
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      blending: THREE.AdditiveBlending,      // glowy, additive — light builds where puffs overlap
      sizeAttenuation: true
    });
    _flow = new THREE.Points(geo, mat);
    _flow.visible = _running && _speed > 0.05;
    scn.add(_flow);
    _applyDensity();    // initial opacity + visible particle count for the current ρ

    // ── Frontal-area plane: translucent panel normal to the flow, sized W×H = A ──
    var planeGeo = new THREE.PlaneGeometry(1, 1);
    var planeMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.30,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    _plane = new THREE.Mesh(planeGeo, planeMat);
    // edge outline so the panel reads as a framed plane (child → inherits scale + rotation)
    var edgeMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.85 });
    var edge = new THREE.LineSegments(new THREE.EdgesGeometry(planeGeo), edgeMat);
    _plane.add(edge);
    _plane.rotation.y = Math.PI / 2;          // face ±X (normal to the +X flow): Y–Z plane
    _plane.position.set(-0.04, _yCtr, 0);     // slightly upstream, at the centred drone height
    _applyPlaneSize();                        // scale to √A × √A
    _plane.visible = _running;
    scn.add(_plane);
  }

  function tick(dt, activeTab) {
    if (!_flow) return;

    if (!_running || _speed <= 0.05) {
      _flow.visible = false;
      return;
    }
    _flow.visible = true;
    // Module 2: keep the mist + frontal-area plane centred on the (moving) drone so the air stays
    // around the craft. On Tab 1 the drone is centred at x=0, so _dxF=0 and behaviour is unchanged.
    var _dxF = (window.DroneModel && DroneModel.getDroneGroup && DroneModel.getDroneGroup()) ? DroneModel.getDroneGroup().position.x : 0;
    _flow.position.x = _dxF;
    if (_plane) _plane.position.x = _dxF - 0.04;
    if (_flow.material) _flow.material.opacity = (_mode === 'flight') ? 0.6 : _flow.material.opacity;

    var pos = _flow.geometry.attributes.position;
    var arr = pos.array;
    var v   = (_mode === 'flight')
      ? Math.min(Math.max(_speed * 0.14, 0), 4.0)          // Tab 2: relative wind clearly streaks past
      : Math.min(Math.max(_speed * 0.05, 0), 1.6);         // Tab 1: gentle oncoming flow (unchanged)
    var span = _xMax - _xMin;

    var bodyR = Math.max(0.05, _footHalf * 0.55);   // effective body footprint the flow bends around
    var sig   = 0.10;                               // along-flow spread of the deflection bump

    for (var i = 0; i < _data.length; i++) {
      var ix = i * 3;
      arr[ix] += v * dt;                          // advance toward / over the drone (+X)
      if (arr[ix] > _xMax) {
        arr[ix] = _xMin + ((arr[ix] - _xMax) % span);   // recycle to the upstream start
      }
      _data[i].phase += dt * 2.0;

      var x  = arr[ix];
      var dy = _data[i].y0 - _yCtr;               // radial offset from the flow axis
      var dz = _data[i].z0;
      var r  = Math.sqrt(dy * dy + dz * dz);
      var ang = Math.atan2(dy, dz);               // dy = r·sin(ang), dz = r·cos(ang)

      // (a) Deflection: push particles radially OUTWARD as they pass the body (x≈0) so the
      //     streamlines bend around the frontal-area panel / airframe.
      var bump = Math.exp(-(x * x) / (2 * sig * sig));     // peaks alongside the body
      var rOut = r + bodyR * 0.6 * bump;
      var ny = _yCtr + rOut * Math.sin(ang);
      var nz = rOut * Math.cos(ang);

      // (b) Wake: mild downstream turbulence behind the body (x > 0).
      if (x > 0) {
        var wake = Math.min(1, x / Math.max(1e-3, _xMax));
        ny += Math.sin(_data[i].phase * 1.7 + x * 8.0) * 0.012 * wake;
        nz += Math.cos(_data[i].phase * 1.3 + x * 9.0) * 0.012 * wake;
      }

      // per-particle vertical drift (amplitude scaled by sz) so the field shimmers like moving air
      var sz = _data[i].sz || 1;
      arr[ix + 1] = ny + Math.sin(_data[i].phase) * 0.004
                       + Math.sin(_data[i].phase * 0.6 + _data[i].drift) * 0.006 * sz;
      arr[ix + 2] = nz;
    }
    pos.needsUpdate = true;

    // Smoothed group Z-tilt ∝ speed/vmax (dynamic-pressure / forward-flight cue).
    // In 'flight' mode (Tab 2) bias the tilt stronger so it reads as forward-flight inflow
    // aligned with the operating J / nose-down attitude. On Tab 2 _speed is the
    // representative forward airspeed, so the tilt scales with the operating point.
    var k = (_mode === 'flight') ? 0.45 : 0.30;
    var tiltTarget = -(_speed / _vmax) * k;
    _flow.rotation.z += (tiltTarget - _flow.rotation.z) * Math.min(1, dt * 3.0);
  }

  function setSpeed(V) {
    _speed = (isFinite(V) && V > 0) ? V : 0;
  }

  // Store A and resize the panel + mist footprint live (no full rebuild).
  function setFrontalArea(A) {
    if (!(isFinite(A) && A > 0)) return;
    var newHalf = Math.max(0.12, Math.sqrt(A) * 2.0);
    var ratio   = (_footHalf > 1e-6) ? (newHalf / _footHalf) : 1;
    _area     = A;
    _footHalf = newHalf;
    _applyPlaneSize();                      // grow/shrink the visible √A × √A panel
    // rescale each particle's base offset about the centre so the mist footprint tracks √A
    for (var i = 0; i < _data.length; i++) {
      _data[i].y0 = _yCtr + (_data[i].y0 - _yCtr) * ratio;
      _data[i].z0 = _data[i].z0 * ratio;
    }
  }

  // Store ρ and map it to mist particle count + opacity (denser/whiter near sea level).
  function setDensity(rho) {
    _rho = (isFinite(rho) && rho > 0) ? rho : 1.225;
    _applyDensity();
  }

  // 'drag' (Tab 1, oncoming flow past a stationary drone) |
  // 'flight' (Tab 2, forward-flight inflow tilted with the operating point).
  function setMode(m) {
    _mode = (m === 'flight') ? 'flight' : 'drag';
    if (_plane) _plane.visible = _running && _mode === 'drag';
  }

  function setRunning(b) {
    _running = !!b;
    if (_flow)  _flow.visible  = _running && _speed > 0.05;
    if (_plane) _plane.visible = _running && _mode === 'drag';
  }

  return {
    build: build,
    tick: tick,
    setSpeed: setSpeed,
    setRunning: setRunning,
    setDensity: setDensity,
    setFrontalArea: setFrontalArea,
    setMode: setMode
  };
})();
window.AeroFlow = AeroFlow;

// ═══════════════════════════════════════════════════════════════════
// 4b. UI2 IIFE (Module 2) — DOM & Chart.js Management (window.UI2)
//     All Module 2 DOM reads/writes + Chart.js lifecycle. Zero physics.
//     Named UI2 to avoid colliding with Module 1's UI. Additive only.
// ═══════════════════════════════════════════════════════════════════
const UI2 = (function () {
  'use strict';

  // ── Chart instances (Module 2) ──
  var _dragSpeedChart   = null;   // Tab 1 centre — D vs V (quadratic)
  var _etaJChart        = null;   // Tab 2 right  — η vs J (peak star)
  var _thrustPowerChart = null;   // Tab 2 right  — T & P vs V (dual axis, V_trim marker)
  var _secondaryChart   = null;   // Tab 2 centre — J vs V
  var _ctCqChart        = null;   // Tab 2 right  — Ct & Cq vs J (dual axis)
  var _dragThrustChart  = null;   // Tab 2 right  — 4·T(V) vs D_frame(V), trim crossing

  // ── DOM helpers (all access null-guarded) ──
  function _el(id) { return document.getElementById(id); }
  function _setText(id, val) { var el = _el(id); if (el) el.textContent = val; }
  function _toggleHidden(id, hide) { var el = _el(id); if (el) el.classList.toggle('hidden', !!hide); }
  function _num(v) { return typeof v === 'number' && isFinite(v); }
  function _hasChart() { return typeof Chart !== 'undefined'; }

  var DASH = '\u2014';   // em dash — shown for non-finite values

  // ─────────────────────────────────────────────────────────────────
  // Shared chart-styling helpers (VISUAL ONLY — no data / axis-meaning /
  // annotation-logic changes). Applied consistently across all six Module-2
  // Chart.js renderers below so they share one premium look.
  //   PALETTE        — shared colour roles.
  //   _rgba          — hex → rgba(…,alpha).
  //   _grad          — vertical area-fill CanvasGradient (≈28% alpha top → 0%
  //                    bottom); falls back to a flat translucent fill when the
  //                    canvas / chartArea isn't paint-ready yet.
  //   _areaFill      — scriptable backgroundColor so the gradient re-resolves
  //                    against the real chartArea after the first paint.
  //   _merge         — small deep-merge (objects only; arrays/fns replaced).
  //   _axis          — polished per-scale defaults (grid / ticks / title).
  //   _lineDs        — polished line/area dataset defaults.
  //   _baseChartOpts — shared base options, deep-merged with per-chart `extra`.
  // ─────────────────────────────────────────────────────────────────
  var PALETTE = {
    primary: '#2563eb',   // blue   — drag, thrust, Ct
    amber:   '#f59e0b',   // amber  — power, Cq
    emerald: '#10b981',   // green  — efficiency, available thrust
    danger:  '#ef4444',   // red    — frame drag, V_trim marker
    violet:  '#8b5cf6'    // violet — advance ratio
  };

  function _rgba(hex, a) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (!isFinite(n)) return 'rgba(100,116,139,' + a + ')';
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  // Vertical fill gradient for a hex line colour. `area` is the Chart.js
  // chartArea when available; without it (first paint) we fall back to the full
  // canvas height, and to a flat translucent rgba fill if nothing is ready.
  function _grad(ctx, hexColor, area) {
    if (!ctx || typeof ctx.createLinearGradient !== 'function') return _rgba(hexColor, 0.12);
    var top = area ? area.top : 0;
    var bot = area ? area.bottom : (ctx.canvas ? ctx.canvas.height : 0);
    if (!(bot > top)) return _rgba(hexColor, 0.12);          // not ready → translucent fallback
    var g = ctx.createLinearGradient(0, top, 0, bot);
    g.addColorStop(0, _rgba(hexColor, 0.28));
    g.addColorStop(1, _rgba(hexColor, 0.0));
    return g;
  }

  // Scriptable backgroundColor: re-resolves the gradient with the real
  // chartArea each paint (graceful translucent fallback before it exists).
  function _areaFill(hexColor) {
    return function (c) {
      var chart = c && c.chart;
      if (!chart) return _rgba(hexColor, 0.12);
      return _grad(chart.ctx, hexColor, chart.chartArea);
    };
  }

  function _isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

  // Deep-merge plain objects (arrays / functions / scalars replace, not merge).
  function _merge(base, extra) {
    if (!_isObj(extra)) return (extra === undefined ? base : extra);
    var out = _isObj(base) ? Object.assign({}, base) : {};
    Object.keys(extra).forEach(function (k) {
      out[k] = (_isObj(out[k]) && _isObj(extra[k])) ? _merge(out[k], extra[k]) : extra[k];
    });
    return out;
  }

  // Polished per-axis defaults; `extra` (type / min / max / position / title.text …)
  // is deep-merged over these. `border.display:false` realises the requested
  // `grid.drawBorder:false` look on Chart.js v4 (where it lives on `border`).
  function _axis(extra) {
    return _merge({
      grid:   { color: 'rgba(148,163,184,0.16)', drawBorder: false },
      border: { display: false },
      ticks:  { color: '#64748b', font: { size: 9, family: 'JetBrains Mono' } },
      title:  { color: '#475569', font: { size: 10, weight: '600' } }
    }, extra || {});
  }

  // Polished line/area dataset; `color` drives line + hover-point + (when
  // `fill:true` is supplied in `extra`) the gradient backgroundColor.
  function _lineDs(color, extra) {
    return _merge({
      borderColor: color,
      backgroundColor: color,
      pointBackgroundColor: color,
      borderWidth: 2.5,
      tension: 0.4,
      pointRadius: 0,
      pointHoverRadius: 5,
      pointHoverBorderWidth: 2,
      fill: false,
      clip: false
    }, extra || {});
  }

  // Shared base chart options; `extra` (scales / plugins overrides) deep-merged over.
  function _baseChartOpts(extra) {
    return _merge({
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 650, easing: 'easeOutQuart' },
      resizeDelay: 120,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { usePointStyle: true, boxWidth: 8, boxHeight: 8, font: { size: 10 }, color: '#475569' } },
        tooltip: {
          backgroundColor: 'rgba(15,23,42,0.92)', padding: 8, cornerRadius: 6,
          titleColor: '#e2e8f0', bodyColor: '#e2e8f0',
          borderColor: 'rgba(148,163,184,0.3)', borderWidth: 1,
          displayColors: true, usePointStyle: true
        }
      }
    }, extra || {});
  }

  // ─────────────────────────────────────────────────────────────────
  // Tab switching — toggle tab buttons + show/hide section groups.
  // Charts for the now-hidden tab are destroyed; the caller's
  // _computeAndRender() recreates the visible tab's charts with live data.
  // ─────────────────────────────────────────────────────────────────
  function switchTab(n) {
    var isTab1 = (n === 1);
    if (window.SFX) window.SFX.click();

    document.querySelectorAll('.vp-tab').forEach(function (btn) {
      var isActive = parseInt(btn.dataset.tab, 10) === n;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    // Left control groups
    _toggleHidden('frameDragGroup', !isTab1);
    _toggleHidden('advRatioGroup',   isTab1);

    // Centre chart sections
    _toggleHidden('dragSpeedSection', !isTab1);
    _toggleHidden('secondarySection',  isTab1);
    _toggleHidden('etaHeroSection', isTab1);   // η-J hero — shown on Tab 2, hidden on Tab 1

    // Centre animated 2D diagram sections (show frame-flow on Tab 1, velocity-triangle on Tab 2)
    _toggleHidden('frameFlowSection', !isTab1);
    _toggleHidden('velTriSection',     isTab1);

    // Right panel sections
    _toggleHidden('frameDragCards',   !isTab1);
    _toggleHidden('advChartsSection',  isTab1);
    _toggleHidden('advResultsSection', isTab1);

    // HUD overlay (Tab 2 only)
    _toggleHidden('analysisHud', isTab1);

    // Destroy the now-hidden tab's charts (hidden canvases keep stale instances).
    if (isTab1) {
      if (_etaJChart)        { _etaJChart.destroy();        _etaJChart = null; }
      if (_thrustPowerChart) { _thrustPowerChart.destroy(); _thrustPowerChart = null; }
      if (_secondaryChart)   { _secondaryChart.destroy();   _secondaryChart = null; }
      if (_ctCqChart)        { _ctCqChart.destroy();        _ctCqChart = null; }
      if (_dragThrustChart)  { _dragThrustChart.destroy();  _dragThrustChart = null; }
    } else if (_dragSpeedChart) {
      _dragSpeedChart.destroy(); _dragSpeedChart = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Tab 1 chart — Parasite Drag D vs Forward Speed V (quadratic curve)
  // ─────────────────────────────────────────────────────────────────
  function renderDragSpeedChart(rho, Cd, A, currentV, Vmax) {
    if (_dragSpeedChart) { _dragSpeedChart.destroy(); _dragSpeedChart = null; }
    var canvas = _el('dragSpeedChart');
    if (!canvas || !_hasChart()) return;

    var vMax = (_num(Vmax) && Vmax > 0) ? Vmax : 30;
    var N = 31, pts = [];
    for (var i = 0; i < N; i++) {
      var V = vMax * i / (N - 1);
      pts.push({ x: V, y: Calc.dragForce(rho, V, Cd, A) });
    }
    var cv = _num(currentV) ? currentV : 0;
    var dCur = Calc.dragForce(rho, cv, Cd, A);

    var annotations = {
      vLine: {
        type: 'line',
        scaleID: 'x',
        value: cv,
        borderColor: PALETTE.primary,
        borderWidth: 1.5,
        borderDash: [5, 4],
        label: { content: 'V = ' + cv.toFixed(1) + ' m/s', display: true, position: 'start', color: PALETTE.primary, font: { size: 9 } }
      }
    };
    if (_num(dCur)) {
      annotations.vPoint = {
        type: 'point',
        xValue: cv, yValue: dCur,
        radius: 5,
        backgroundColor: PALETTE.primary,
        borderColor: '#ffffff',
        borderWidth: 2
      };
    }

    _dragSpeedChart = new Chart(canvas, {
      type: 'line',
      data: {
        datasets: [_lineDs(PALETTE.primary, {
          label: 'Parasite Drag D (N)',
          data: pts,
          fill: true,
          backgroundColor: _areaFill(PALETTE.primary)
        })]
      },
      options: _baseChartOpts({
        plugins: {
          legend: { display: false },
          annotation: { annotations: annotations }
        },
        scales: {
          x: _axis({ type: 'linear', min: 0, max: vMax, title: { display: true, text: 'Forward Speed V (m/s)' } }),
          y: _axis({ min: 0, title: { display: true, text: 'Parasite Drag D (N)' } })
        }
      })
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // Tab 2 chart — Propulsive Efficiency η vs Advance Ratio J (peak star)
  // ─────────────────────────────────────────────────────────────────
  function renderEtaJChart(sweep, peak) {
    if (_etaJChart) { _etaJChart.destroy(); _etaJChart = null; }
    var canvas = _el('etaJChart');
    if (!canvas || !_hasChart()) return;

    var pts = (sweep || []).map(function (s) { return { x: s.J, y: s.eta }; });

    var annotations = {};
    if (peak && peak.idx >= 0 && _num(peak.J) && _num(peak.eta)) {
      annotations.peakStar = {
        type: 'point',
        xValue: peak.J, yValue: peak.eta,
        radius: 7,
        pointStyle: 'star',
        backgroundColor: PALETTE.emerald,
        borderColor: '#ffffff',
        borderWidth: 2
      };
      annotations.peakLabel = {
        type: 'label',
        xValue: peak.J, yValue: peak.eta,
        content: ['peak \u03B7 ' + peak.eta.toFixed(1) + '%'],
        yAdjust: -16,
        color: '#047857',
        font: { size: 9, weight: 'bold' },
        backgroundColor: 'rgba(255,255,255,0.82)'
      };
    }

    _etaJChart = new Chart(canvas, {
      type: 'line',
      data: {
        datasets: [_lineDs(PALETTE.emerald, {
          label: 'Propulsive Efficiency \u03B7 (%)',
          data: pts,
          fill: true,
          backgroundColor: _areaFill(PALETTE.emerald)
        })]
      },
      options: _baseChartOpts({
        plugins: {
          legend: { display: false },
          annotation: { annotations: annotations }
        },
        scales: {
          x: _axis({ type: 'linear', min: 0, title: { display: true, text: 'Advance Ratio J' } }),
          y: _axis({ min: 0, max: 100, title: { display: true, text: 'Propulsive Efficiency \u03B7 (%)' } })
        }
      })
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // Tab 2 chart — Thrust T & Shaft Power P vs Forward Speed V (dual axis)
  // ─────────────────────────────────────────────────────────────────
  function renderThrustPowerChart(sweep, trim) {
    if (_thrustPowerChart) { _thrustPowerChart.destroy(); _thrustPowerChart = null; }
    var canvas = _el('thrustPowerChart');
    if (!canvas || !_hasChart()) return;

    var tData = (sweep || []).map(function (s) { return { x: s.V, y: s.T }; });
    var pData = (sweep || []).map(function (s) { return { x: s.V, y: s.P }; });

    var annotations = {};
    if (trim && trim.status === 'ok' && _num(trim.Vtrim)) {
      annotations.vtrim = {
        type: 'line',
        scaleID: 'x',
        value: trim.Vtrim,
        borderColor: PALETTE.danger,
        borderWidth: 1.5,
        borderDash: [5, 4],
        label: { content: 'V_trim ' + trim.Vtrim.toFixed(2) + ' m/s', display: true, position: 'end', rotation: -90, color: PALETTE.danger, font: { size: 9 } }
      };
    }

    _thrustPowerChart = new Chart(canvas, {
      type: 'line',
      data: {
        datasets: [
          _lineDs(PALETTE.primary, { label: 'Thrust T (N)',       data: tData, yAxisID: 'yT', fill: false }),
          _lineDs(PALETTE.amber,   { label: 'Shaft Power P (W)',  data: pData, yAxisID: 'yP', fill: false })
        ]
      },
      options: _baseChartOpts({
        plugins: {
          legend: { position: 'top' },
          annotation: { annotations: annotations }
        },
        scales: {
          x:  _axis({ type: 'linear', min: 0, title: { display: true, text: 'Forward Speed V (m/s)' } }),
          yT: _axis({ type: 'linear', position: 'left',  title: { display: true, text: 'Thrust T (N)' } }),
          yP: _axis({ type: 'linear', position: 'right', title: { display: true, text: 'Shaft Power P (W)' }, grid: { drawOnChartArea: false } })
        }
      })
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // Tab 2 centre chart — Advance Ratio J vs Forward Speed V
  // ─────────────────────────────────────────────────────────────────
  function renderSecondaryChart(sweep) {
    if (_secondaryChart) { _secondaryChart.destroy(); _secondaryChart = null; }
    var canvas = _el('secondaryChart');
    if (!canvas || !_hasChart()) return;

    var pts = (sweep || []).map(function (s) { return { x: s.V, y: s.J }; });

    _secondaryChart = new Chart(canvas, {
      type: 'line',
      data: {
        datasets: [_lineDs(PALETTE.violet, {
          label: 'Advance Ratio J',
          data: pts,
          fill: true,
          backgroundColor: _areaFill(PALETTE.violet)
        })]
      },
      options: _baseChartOpts({
        plugins: { legend: { display: false } },
        scales: {
          x: _axis({ type: 'linear', min: 0, title: { display: true, text: 'Forward Speed V (m/s)' } }),
          y: _axis({ min: 0, title: { display: true, text: 'Advance Ratio J' } })
        }
      })
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // Tab 2 chart — Thrust Coeff Ct & Torque Coeff Cq vs Advance Ratio J
  //               (dual axis: Ct on the left, Cq on the right)
  // ─────────────────────────────────────────────────────────────────
  function renderCtCqChart(sweep) {
    if (_ctCqChart) { _ctCqChart.destroy(); _ctCqChart = null; }
    var canvas = _el('ctCqChart');
    if (!canvas || !_hasChart()) return;
    if (!sweep || !sweep.length) return;

    var ctData = sweep.map(function (s) { return { x: s.J, y: s.Ct }; });
    var cqData = sweep.map(function (s) { return { x: s.J, y: s.Cq }; });

    _ctCqChart = new Chart(canvas, {
      type: 'line',
      data: {
        datasets: [
          _lineDs(PALETTE.primary, { label: 'Thrust Coeff Ct', data: ctData, yAxisID: 'yCt', fill: false }),
          _lineDs(PALETTE.amber,   { label: 'Torque Coeff Cq', data: cqData, yAxisID: 'yCq', fill: false })
        ]
      },
      options: _baseChartOpts({
        plugins: { legend: { position: 'top' } },
        scales: {
          x:   _axis({ type: 'linear', min: 0, title: { display: true, text: 'Advance Ratio J' } }),
          yCt: _axis({ type: 'linear', position: 'left',  title: { display: true, text: 'Ct' } }),
          yCq: _axis({ type: 'linear', position: 'right', title: { display: true, text: 'Cq' }, grid: { drawOnChartArea: false } })
        }
      })
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // Tab 2 chart — Available Thrust 4·T(V) vs Frame Drag D_frame(V)
  //               (force balance; trim crossing marked at V_trim)
  // ─────────────────────────────────────────────────────────────────
  function renderDragThrustChart(sweep, rho, Cd, A, trim) {
    if (_dragThrustChart) { _dragThrustChart.destroy(); _dragThrustChart = null; }
    var canvas = _el('dragThrustChart');
    if (!canvas || !_hasChart()) return;
    if (!sweep || !sweep.length) return;

    var thrustData = sweep.map(function (s) { return { x: s.V, y: 4 * s.T }; });
    var dragData   = sweep.map(function (s) { return { x: s.V, y: Calc.dragForce(rho, s.V, Cd, A) }; });

    var annotations = {};
    if (trim && trim.status === 'ok' && _num(trim.Vtrim)) {
      annotations.vtrim = {
        type: 'line',
        scaleID: 'x',
        value: trim.Vtrim,
        borderColor: PALETTE.danger,
        borderWidth: 1.5,
        borderDash: [5, 4],
        label: { content: 'V_trim ' + trim.Vtrim.toFixed(2) + ' m/s', display: true, position: 'end', rotation: -90, color: PALETTE.danger, font: { size: 9 } }
      };
    }

    _dragThrustChart = new Chart(canvas, {
      type: 'line',
      data: {
        datasets: [
          _lineDs(PALETTE.emerald, { label: 'Available Thrust 4\u00B7T (N)', data: thrustData, fill: false }),
          _lineDs(PALETTE.danger,  { label: 'Frame Drag D (N)',            data: dragData,   fill: false })
        ]
      },
      options: _baseChartOpts({
        plugins: {
          legend: { position: 'top' },
          annotation: { annotations: annotations }
        },
        scales: {
          x: _axis({ type: 'linear', min: 0, title: { display: true, text: 'Forward Speed V (m/s)' } }),
          y: _axis({ min: 0, title: { display: true, text: 'Force (N)' } })
        }
      })
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // Tab 1 result cards (non-finite → em dash)
  // ─────────────────────────────────────────────────────────────────
  function updateFrameCards(q, D, CdA, Re) {
    _setText('valQ',       _num(q)   ? q.toFixed(2)   + ' Pa'       : DASH);
    _setText('valDrag',    _num(D)   ? D.toFixed(3)   + ' N'        : DASH);
    _setText('valCdA',     _num(CdA) ? CdA.toFixed(5) + ' m\u00B2'  : DASH);
    _setText('valReFrame', _num(Re)  ? Math.round(Re).toLocaleString('en-US') : DASH);
  }

  // ─────────────────────────────────────────────────────────────────
  // Tab 2 result cards (evaluated at the representative operating point)
  // ─────────────────────────────────────────────────────────────────
  function _vtrimText(trim) {
    if (!trim) return DASH;
    if (trim.status === 'ok')             return _num(trim.Vtrim) ? trim.Vtrim.toFixed(2) + ' m/s' : DASH;
    if (trim.status === 'exceeds')        return '> 25 m/s';
    if (trim.status === 'thrust_limited') return '~0 m/s (thrust-limited)';
    return DASH;
  }

  function updateAdvCards(op, trim) {
    if (!op) op = {};
    _setText('bemtThrust', _num(op.T)   ? op.T.toFixed(3)   + ' N'         : DASH);
    _setText('bemtTorque', _num(op.Q)   ? op.Q.toFixed(4)   + ' N\u00B7m'  : DASH);
    _setText('bemtEta',    _num(op.eta) ? op.eta.toFixed(1) + '%'          : DASH);
    _setText('bemtJ',      _num(op.J)   ? op.J.toFixed(3)                  : DASH);
    _setText('bemtFOM',    _num(op.FoM) ? op.FoM.toFixed(3)               : DASH);
    _setText('valVtrim',   _vtrimText(trim));
  }

  // ─────────────────────────────────────────────────────────────────
  // Tab 2 HUD overlay
  // ─────────────────────────────────────────────────────────────────
  function updateHud(J, eta, rpm, trimText, pitchDeg, V) {
    _setText('hudJ',     _num(J)   ? J.toFixed(3)   : DASH);
    _setText('hudEta',   _num(eta) ? eta.toFixed(1) : DASH);
    _setText('hudRpm',   _num(rpm) ? Math.round(rpm).toLocaleString('en-US') : DASH);
    _setText('hudVtrim', (trimText === undefined || trimText === null) ? DASH : trimText);
    // Extended (design §5.7): nose-down pitch + representative speed.
    // pitchDeg/V undefined or non-finite → em dash (backward compatible — extra args optional).
    _setText('hudPitch', _num(pitchDeg) ? pitchDeg.toFixed(1) + '\u00B0'   : DASH);
    _setText('hudV',     _num(V)        ? V.toFixed(1)        + ' m/s'     : DASH);
  }

  // ─────────────────────────────────────────────────────────────────
  // Inherited-propeller summary card (Tab 2 left)
  // ─────────────────────────────────────────────────────────────────
  function updateSummaryCard(propDef) {
    if (!propDef) {
      _setText('summN', DASH); _setText('summD', DASH);
      _setText('summAirfoil', DASH); _setText('summMaterial', DASH);
      return;
    }
    _setText('summN', (propDef.N != null) ? String(propDef.N) : DASH);
    _setText('summD', (propDef.D_in != null) ? propDef.D_in + ' in' : DASH);
    _setText('summAirfoil',  (propDef.airfoil  && propDef.airfoil.name)   ? propDef.airfoil.name   : DASH);
    _setText('summMaterial', (propDef.material && propDef.material.label) ? propDef.material.label : DASH);
  }

  // ─────────────────────────────────────────────────────────────────
  // Misc helpers — checklist / commentary / handoff / buttons / density
  // ─────────────────────────────────────────────────────────────────
  function setChecklistItem(id, done, valText) {
    var item = _el(id);
    if (!item) return;
    var icon  = item.querySelector('.chk-icon');
    var valEl = item.querySelector('.checklist-val');
    if (icon) {
      icon.classList.toggle('pending', !done);
      icon.classList.toggle('done',    done);
      icon.textContent = done ? '\u2713' : '';   // ✓ tick mark when complete
    }
    if (valEl && valText !== undefined) valEl.textContent = valText;
  }

  function setCommentary(text) {
    if (window.Instructor) { window.Instructor.say(text); return; }
    var el = _el('liveCommentaryText');
    if (el) el.innerHTML = text;
  }

  function renderHandoffBadge(text, isFallback) {
    var badge = _el('handoffBadge');
    if (!badge) return;
    badge.classList.toggle('fallback', !!isFallback);
    if (isFallback && (!text || !text.length)) {
      badge.textContent = 'Standalone session \u2014 using default propeller (N=2, \u00D810in, NACA 0012).';
    } else {
      badge.textContent = text || '';
    }
  }

  function setRunButtonEnabled(e)    { var b = _el('btnRunSweep'); if (b) b.disabled = !e; }
  function setFinishButtonEnabled(e) { var b = _el('btnFinish');   if (b) b.disabled = !e; }

  function setDensity(rho) {
    var txt = _num(rho) ? (rho.toFixed(4) + ' kg/m\u00B3') : DASH;
    _setText('densityValue', txt);
    _setText('densityValueAdv', txt);
  }

  // ═════════════════════════════════════════════════════════════════
  // Animated 2D centre diagrams — mirror Module 1's drawAoaDiagram RAF
  // pattern: a public entry stores the latest state and starts ONE
  // requestAnimationFrame loop; the loop early-returns while its canvas
  // is hidden (cv.offsetParent === null) and scrolls a phase so the
  // dashes animate. _arrow2 draws vectors (UI2 has no shared helper).
  // Each diagram owns its own _…State / _…Phase / _…Last / _…RAF locals.
  // ═════════════════════════════════════════════════════════════════

  // Shared vector helper (UI2-local; mirrors Module 1's UI._arrow).
  function _arrow2(ctx, x1, y1, x2, y2, col, w) {
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = w || 1.5;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    var ang = Math.atan2(y2 - y1, x2 - x1), hl = 6;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - hl * Math.cos(ang - 0.4), y2 - hl * Math.sin(ang - 0.4));
    ctx.lineTo(x2 - hl * Math.cos(ang + 0.4), y2 - hl * Math.sin(ang + 0.4));
    ctx.closePath(); ctx.fill();
  }

  // Rounded-rect path helper (UI2-local) — builds (does not fill/stroke) a rounded
  // rectangle path. Used by the side-view drag diagram for the body + motor pods.
  function _rrPath(ctx, x, y, w, h, rad) {
    var r = Math.max(0, Math.min(rad, Math.min(w, h) / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y,     x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x,     y + h, r);
    ctx.arcTo(x,     y + h, x,     y,     r);
    ctx.arcTo(x,     y,     x + w, y,     r);
    ctx.closePath();
  }

  // ── Tab 1 — animated side-view frame-flow diagram (#frameFlowDiagram) ──
  var _dragState = null, _dragPhase = 0, _dragLast = 0, _dragRAF = null;
  var _DRAG_VMAX = 30;   // Tab 1 forward-speed scale (m/s)

  // Public entry: store latest state, ensure the single RAF loop is running.
  function drawDragDiagram(rho, V, Cd, A, D, q, CdA, Re, Deff, washOn) {
    _dragState = { rho: rho, V: V, Cd: Cd, A: A, D: D, q: q, CdA: CdA, Re: Re, Deff: Deff, washOn: washOn };
    if (!_dragRAF) {
      _dragLast = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      _dragRAF = requestAnimationFrame(_dragLoop);
    }
  }

  function _dragLoop(t) {
    _dragRAF = requestAnimationFrame(_dragLoop);
    var dt = Math.min(0.05, (t - _dragLast) / 1000); _dragLast = t;
    var cv = _el('frameFlowDiagram');
    if (!cv || !cv.getContext || !_dragState) return;
    if (cv.offsetParent === null) return;          // hidden (not on Tab 1) → skip drawing
    _dragPhase += dt;                              // seconds; scrolls the streamline dashes
    _renderDrag(cv, _dragState, _dragPhase);
  }

  function _renderDrag(cv, st, phase) {
    var ctx = cv.getContext('2d');
    var W = cv.width, H = cv.height;

    // ── inputs (contract unchanged): V, rho, D, q, CdA, Re — plus st.A for the area cue ──
    var V    = _num(st.V)   ? Math.max(0, st.V) : 0;
    var rho  = _num(st.rho) ? st.rho : 1.225;
    var D    = _num(st.D)   ? st.D   : 0;
    var Deff = _num(st.Deff) ? st.Deff : D;   // wash-corrected effective drag (falls back to clean D)
    var area = _num(st.A)   ? st.A   : (_num(st.CdA) ? st.CdA / 1.1 : 0);   // frontal area (m²)

    // normalised visual cues
    var vN   = Math.max(0, Math.min(1, V / _DRAG_VMAX));
    var rhoN = Math.max(0, Math.min(1, (rho - 0.85) / (1.30 - 0.85)));      // dense → sparse air
    var nLines = 7 + Math.round(rhoN * 3);                                  // ~7..10 lines (count ∝ ρ)
    var baseAlpha = 0.30 + rhoN * 0.50;                                     // 0.30..0.80 (opacity ∝ ρ)

    // ── soft vertical background gradient (cool top → near-white bottom) ──
    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#eef3f9');
    bg.addColorStop(1, '#f8fafc');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // ── drone geometry (compact, centred side view) ──
    var cx = W * 0.50, cy = H * 0.56;
    var bodyW = Math.min(88, W * 0.31), bodyH = Math.min(24, H * 0.15);
    var bx = cx - bodyW / 2, by = cy - bodyH / 2;
    var armUp = Math.min(20, H * 0.17);
    var bodyHalf = bodyW * 0.62;

    // ── frontal-area cue: faint translucent vertical band just upstream; height ∝ √A ──
    var bandH = Math.max(16, Math.min(H * 0.80, Math.sqrt(Math.max(0, area)) * 360));
    var bandCx = bx - 22;
    ctx.fillStyle = 'rgba(56,189,248,0.12)';
    ctx.fillRect(bandCx - 5, cy - bandH / 2, 10, bandH);
    ctx.strokeStyle = 'rgba(56,189,248,0.42)'; ctx.lineWidth = 1;
    ctx.strokeRect(bandCx - 5, cy - bandH / 2, 10, bandH);
    ctx.fillStyle = 'rgba(2,132,199,0.80)'; ctx.font = '9px JetBrains Mono';
    ctx.fillText('A', bandCx - 3, cy - bandH / 2 - 3);

    // ── streamlines: smooth CONTINUOUS curves bending around the body ──
    // Gaussian bump near the body (larger deflection for lines closer in); downstream wake
    // wobble that grows with V; a travelling phase term scrolls the flow (speed ∝ V).
    var sigma = bodyH * 1.8, twoSig2 = 2 * sigma * sigma;
    var flowPh = phase * V * 0.15;                   // travelling-flow phase (∝ V ⇒ still at V≈0)
    ctx.lineCap = 'round';
    for (var li = 0; li < nLines; li++) {
      var y0 = 14 + li * (H - 30) / (nLines - 1);
      var dy0 = y0 - cy;
      var near = Math.exp(-(dy0 * dy0) / twoSig2);   // proximity to the body (0..1)
      var above = y0 <= cy;
      var defl = (4 + vN * 20) * near;               // bend amplitude grows with V & proximity
      var aLine = Math.min(0.85, baseAlpha * (0.55 + 0.5 * near));
      ctx.strokeStyle = 'rgba(14,165,233,' + aLine.toFixed(3) + ')';
      ctx.lineWidth = 1.2 + near * 0.8;
      ctx.beginPath();
      var startedLine = false;
      for (var x = -4; x <= W + 4; x += 5) {
        var d = (x - cx) / bodyHalf;
        var bump = Math.exp(-d * d);                 // Gaussian bump around the body
        var y = y0 + (above ? -defl : defl) * bump;
        if (x > cx) {                                // downstream wake wobble (grows with V)
          var tw = Math.min(1, (x - cx) / (W * 0.45));
          y += Math.sin(x * 0.11 - flowPh * 7 + li * 0.8) * (vN * 7) * tw * (0.45 + near);
        }
        y += Math.sin(x * 0.05 - flowPh * 5 + li) * (vN * 1.4);   // gentle flow shimmer
        if (!startedLine) { ctx.moveTo(x, y); startedLine = true; } else { ctx.lineTo(x, y); }
      }
      ctx.stroke();

      // small direction arrowhead on 3 representative streamlines (only while moving)
      if (vN > 0.03 && (li === 1 || li === (nLines >> 1) || li === nLines - 2)) {
        var span = W + 20;
        var xd = -10 + ((phase * (15 + V * 34) + li * 47) % span);
        var dd = (xd - cx) / bodyHalf;
        var yd = y0 + (above ? -defl : defl) * Math.exp(-dd * dd);
        if (xd > cx) {
          var twd = Math.min(1, (xd - cx) / (W * 0.45));
          yd += Math.sin(xd * 0.11 - flowPh * 7 + li * 0.8) * (vN * 7) * twd * (0.45 + near);
        }
        yd += Math.sin(xd * 0.05 - flowPh * 5 + li) * (vN * 1.4);
        var ah = 4 + vN * 2.5;
        ctx.fillStyle = 'rgba(14,165,233,' + Math.min(0.95, aLine + 0.25).toFixed(3) + ')';
        ctx.beginPath();
        ctx.moveTo(xd + ah, yd);
        ctx.lineTo(xd - ah, yd - ah * 0.62);
        ctx.lineTo(xd - ah, yd + ah * 0.62);
        ctx.closePath(); ctx.fill();
      }
    }

    // ── landing skids (drawn first so the body covers the strut roots) ──
    var skidY = by + bodyH + Math.min(16, H * 0.12);
    ctx.strokeStyle = '#64748b'; ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(cx - bodyW * 0.26, by + bodyH); ctx.lineTo(cx - bodyW * 0.32, skidY);   // front strut
    ctx.moveTo(cx + bodyW * 0.26, by + bodyH); ctx.lineTo(cx + bodyW * 0.32, skidY);   // rear strut
    ctx.moveTo(cx - bodyW * 0.46, skidY);      ctx.lineTo(cx - bodyW * 0.16, skidY);   // front skid rail
    ctx.moveTo(cx + bodyW * 0.16, skidY);      ctx.lineTo(cx + bodyW * 0.46, skidY);   // rear skid rail
    ctx.stroke();

    // ── two angled arms rising to motor pods (front-top + rear-top) ──
    var frontTipX = bx - bodyW * 0.04, frontTipY = by - armUp;
    var rearTipX  = bx + bodyW * 1.04, rearTipY  = by - armUp;
    ctx.strokeStyle = '#475569'; ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(bx + bodyW * 0.24, by + bodyH * 0.30); ctx.lineTo(frontTipX, frontTipY);
    ctx.moveTo(bx + bodyW * 0.76, by + bodyH * 0.30); ctx.lineTo(rearTipX,  rearTipY);
    ctx.stroke();

    // ── fuselage body: rounded-rect, vertical slate gradient + top highlight + thin outline ──
    var bodyGrad = ctx.createLinearGradient(0, by, 0, by + bodyH);
    bodyGrad.addColorStop(0, '#334155');
    bodyGrad.addColorStop(1, '#1e293b');
    _rrPath(ctx, bx, by, bodyW, bodyH, bodyH * 0.5);
    ctx.fillStyle = bodyGrad; ctx.fill();
    ctx.save();                                       // clip the soft top highlight to the body
    _rrPath(ctx, bx, by, bodyW, bodyH, bodyH * 0.5);
    ctx.clip();
    var hi = ctx.createLinearGradient(0, by, 0, by + bodyH * 0.55);
    hi.addColorStop(0, 'rgba(255,255,255,0.24)');
    hi.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hi; ctx.fillRect(bx, by, bodyW, bodyH * 0.55);
    ctx.restore();
    _rrPath(ctx, bx, by, bodyW, bodyH, bodyH * 0.5);
    ctx.strokeStyle = 'rgba(15,23,42,0.9)'; ctx.lineWidth = 1; ctx.stroke();

    // ── motor pods (short rounded rects) at each arm tip ──
    var podW = 13, podH = 7;
    ctx.fillStyle = '#1e293b';
    _rrPath(ctx, frontTipX - podW / 2, frontTipY - podH / 2, podW, podH, 3); ctx.fill();
    _rrPath(ctx, rearTipX  - podW / 2, rearTipY  - podH / 2, podW, podH, 3); ctx.fill();

    // ── thin prop discs (flat translucent ellipses) on top of each pod ──
    var discRx = 22, discRy = 3.2, discY = podH / 2 + 2;
    ctx.fillStyle = 'rgba(148,197,255,0.32)';
    ctx.strokeStyle = 'rgba(59,130,246,0.55)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(frontTipX, frontTipY - discY, discRx, discRy, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(rearTipX,  rearTipY  - discY, discRx, discRy, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();

    // ── V arrow (cyan, entering from the left; length ∝ V; hidden when air is still) ──
    var flowLen = vN * 80;
    if (flowLen > 3) {
      _arrow2(ctx, 8, cy, 8 + flowLen, cy, '#0ea5e9', 2.3);
      ctx.fillStyle = '#0369a1'; ctx.font = '10px JetBrains Mono';
      ctx.fillText('V', 10, cy - 7);
    }

    // ── Drag arrow(s): effective (bold red, length ∝ F_D,eff) is the primary
    // arrow. When rotor-wash is ON and genuinely adds drag, also draw the
    // clean-body arrow (thin, dashed, lighter) UNDER it so the wash-induced
    // gap between "textbook" and "flight-realistic" drag is visible directly
    // on the diagram, not just in the numeric readouts (override C2 §3.2). ──
    var dragLenEff = Math.max(0, Math.min(70, Deff * 6));
    var dragLenClean = Math.max(0, Math.min(70, D * 6));
    if (st.washOn && dragLenEff > dragLenClean + 1) {
      ctx.save();
      ctx.setLineDash([3, 3]);
      _arrow2(ctx, cx, cy + 10, cx + dragLenClean, cy + 10, 'rgba(220,38,38,0.45)', 1.6);
      ctx.restore();
      ctx.fillStyle = 'rgba(220,38,38,0.65)'; ctx.font = '9px JetBrains Mono';
      ctx.fillText('clean', cx + dragLenClean + 3, cy + 13);
    }
    if (dragLenEff > 2) {
      _arrow2(ctx, cx, cy, cx + dragLenEff, cy, '#dc2626', 2.4);
      ctx.fillStyle = '#dc2626'; ctx.font = '10px JetBrains Mono';
      ctx.fillText(st.washOn ? 'Drag (eff.)' : 'Drag', cx + dragLenEff + 3, cy - 7);
    }

    // ── title + bottom readouts (mono; non-finite → em dash) ──
    ctx.fillStyle = '#0f172a'; ctx.font = 'bold 11px Inter';
    ctx.fillText('Frame Drag \u2014 side view', 6, 14);
    ctx.font = '10px JetBrains Mono'; ctx.fillStyle = '#374151';
    var reTxt = _num(st.Re) ? Math.round(st.Re).toLocaleString('en-US') : DASH;
    ctx.fillText('V ' + (_num(st.V) ? st.V.toFixed(1) : DASH) + ' m/s   q ' + (_num(st.q) ? st.q.toFixed(1) : DASH) + ' Pa', 6, H - 20);
    ctx.fillText('Cd\u00B7A ' + (_num(st.CdA) ? st.CdA.toFixed(5) : DASH) + ' m\u00B2   D ' + (_num(st.D) ? st.D.toFixed(3) : DASH) + ' N   Re ' + reTxt, 6, H - 6);
  }

  // ── Tab 2 — animated forward-flight velocity triangle (#velocityTriangleDiagram) ──
  var _advState = null, _advPhase = 0, _advLast = 0, _advRAF = null;

  // Public entry: store latest state, ensure the single RAF loop is running.
  function drawAdvDiagram(V, Ut, Vrel, phiRad, J, rpm) {
    _advState = { V: V, Ut: Ut, Vrel: Vrel, phiRad: phiRad, J: J, rpm: rpm };
    if (!_advRAF) {
      _advLast = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      _advRAF = requestAnimationFrame(_advLoop);
    }
  }

  function _advLoop(t) {
    _advRAF = requestAnimationFrame(_advLoop);
    var dt = Math.min(0.05, (t - _advLast) / 1000); _advLast = t;
    var cv = _el('velocityTriangleDiagram');
    if (!cv || !cv.getContext || !_advState) return;
    if (cv.offsetParent === null) return;          // hidden (not on Tab 2) → skip drawing
    _advPhase += dt;                               // seconds; streaks the flow along the resultant
    _renderAdv(cv, _advState, _advPhase);
  }

  function _renderAdv(cv, st, phase) {
    var ctx = cv.getContext('2d');
    var W = cv.width, H = cv.height;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#f8fafc'; ctx.fillRect(0, 0, W, H);

    var V   = _num(st.V)  ? Math.max(0, st.V)  : 0;
    var Ut  = _num(st.Ut) ? Math.max(0, st.Ut) : 0;
    var phi = _num(st.phiRad) ? st.phiRad : Math.atan2(V, Math.max(1e-6, Ut));

    // ONE shared scale (px per m/s) so both legs are geometrically truthful
    var maxArrowPx = Math.min(W * 0.62, H * 0.62);
    var scale = maxArrowPx / Math.max(Ut, V, 1e-3);

    // common origin near lower-left, leaving margins for the labels
    var ox = W * 0.20, oy = H * 0.74;
    var utPx = Ut * scale;                  // horizontal leg = tangential speed U_t
    var vPx  = V  * scale;                  // vertical leg   = forward speed V (same scale)
    var ax = ox + utPx, ay = oy;            // tip of U_t
    var bx = ax,        by = oy - vPx;      // tip of V → endpoint of the resultant

    // φ arc at the origin, between the horizontal (U_t) and the resultant (V_rel)
    if (utPx > 6) {
      ctx.strokeStyle = '#9333ea'; ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(ox, oy, Math.min(30, utPx * 0.4), -phi, 0);
      ctx.stroke();
      ctx.fillStyle = '#9333ea'; ctx.font = '10px JetBrains Mono';
      ctx.fillText('\u03C6 ' + (phi * 180 / Math.PI).toFixed(1) + '\u00B0', ox + Math.min(34, utPx * 0.45), oy - 6);
    }

    // animated flow ticks streaking along the resultant direction (phase-scrolled)
    var rlen = Math.sqrt((bx - ox) * (bx - ox) + (by - oy) * (by - oy));
    if (rlen > 8) {
      var ux = (bx - ox) / rlen, uy = (by - oy) / rlen;
      var spacing = 16, seg = 7;
      var off = (phase * (40 + V * 6)) % spacing;
      ctx.strokeStyle = 'rgba(234,88,12,0.50)'; ctx.lineWidth = 1.4;
      for (var s = off; s < rlen; s += spacing) {
        var e = Math.min(rlen, s + seg);
        ctx.beginPath();
        ctx.moveTo(ox + ux * s, oy + uy * s);
        ctx.lineTo(ox + ux * e, oy + uy * e);
        ctx.stroke();
      }
    }

    // triangle legs (drawn over the streaks)
    _arrow2(ctx, ox, oy, ax, ay, '#3b82f6', 2.4);   // U_t — tangential (horizontal)
    _arrow2(ctx, ax, ay, bx, by, '#16a34a', 2.4);   // V   — forward speed (vertical)
    _arrow2(ctx, ox, oy, bx, by, '#ea580c', 2.6);   // V_rel — resultant relative wind (hypotenuse)

    // vector labels
    ctx.font = '10px JetBrains Mono';
    ctx.fillStyle = '#1d4ed8'; ctx.fillText('U_t',   ox + utPx * 0.5 - 8, oy + 14);
    ctx.fillStyle = '#15803d'; ctx.fillText('V',      ax + 5,              oy - vPx * 0.5);
    ctx.fillStyle = '#c2410c'; ctx.fillText('V_rel',  ox + (bx - ox) * 0.5 - 24, oy - vPx * 0.5 - 6);

    // title (left) + J / RPM (right)
    ctx.fillStyle = '#111827'; ctx.font = 'bold 11px Inter';
    ctx.fillText('Velocity Triangle', 6, 14);
    ctx.font = '10px JetBrains Mono'; ctx.fillStyle = '#374151';
    ctx.textAlign = 'right';
    ctx.fillText('J ' + (_num(st.J) ? st.J.toFixed(3) : DASH) + '   RPM ' + (_num(st.rpm) ? Math.round(st.rpm).toLocaleString('en-US') : DASH), W - 6, 14);
    ctx.textAlign = 'left';

    // corner readouts (non-finite → em dash)
    ctx.fillText('U_t ' + (_num(st.Ut) ? st.Ut.toFixed(1) : DASH) + ' m/s   V ' + (_num(st.V) ? st.V.toFixed(1) : DASH) + ' m/s', 6, H - 20);
    ctx.fillText('\u03C6 ' + (_num(st.phiRad) ? (st.phiRad * 180 / Math.PI).toFixed(1) : DASH) + '\u00B0   V_rel ' + (_num(st.Vrel) ? st.Vrel.toFixed(1) : DASH) + ' m/s', 6, H - 6);
  }

  // ─────────────────────────────────────────────────────────────────
  // Derivation panels + area readout (design §5.6, §5.8) — DOM only.
  // Print the governing equations WITH substituted numbers into the
  // value spans; any non-finite substitution renders as the em dash.
  // Uses the existing _setText / _num / DASH helpers.
  // ─────────────────────────────────────────────────────────────────

  // Tab 1 — frame-drag derivation (#frameDerivBox value spans, §2.7)
  function renderDragDerivation(rho, V, Cd, A, L, q, CdA, D, Re) {
    function f(v, d) { return _num(v) ? v.toFixed(d) : DASH; }
    var reTxt = _num(Re) ? Math.round(Re).toLocaleString('en-US') : DASH;

    // q = ½·ρ·V²
    _setText('drgEvalQ',
      '\u00BD\u00B7\u03C1\u00B7V\u00B2 = \u00BD\u00B7' + f(rho, 3) + '\u00B7' + f(V, 1) + '\u00B2 = ' + f(q, 2) + ' Pa');
    // Cd·A
    _setText('drgEvalCdA',
      'Cd\u00B7A = ' + f(Cd, 2) + '\u00B7' + f(A, 4) + ' = ' + f(CdA, 5) + ' m\u00B2');
    // D = q·Cd·A
    _setText('drgEvalD',
      'q\u00B7Cd\u00B7A = ' + f(q, 2) + '\u00B7' + f(CdA, 5) + ' = ' + f(D, 3) + ' N');
    // Re = ρVL/μ (compact; integer with locale grouping)
    _setText('drgEvalRe',
      '\u03C1VL/\u03BC = ' + reTxt);
  }

  // Rotor-wash readout + F_D-vs-V² regression readout (override C2, §3.2).
  function renderWashAndRegression(washOn, washK, Deff, slope, r2) {
    function f(v, d) { return _num(v) ? v.toFixed(d) : DASH; }
    _setText('washKVal', washOn ? ('+' + (washK * 100).toFixed(0) + '% (flight-realistic)') : 'off (clean tunnel)');
    _setText('drgEvalDEff', f(Deff, 3) + ' N');
    _setText('regSlopeVal', f(slope, 4) + ' N per (m/s)\u00B2');
    _setText('regR2Val', f(r2, 5));
  }

  // Tab 2 — cruise derivation (#cruiseDerivBox value spans, §3.9)
  function renderAdvDerivation(rpm, n, J, eta, P, Vtrim, pitchDeg, trimStatus) {
    function f(v, d) { return _num(v) ? v.toFixed(d) : DASH; }
    var rpmTxt = _num(rpm) ? String(Math.round(rpm)) : DASH;

    // n = RPM/60
    _setText('advEvalN',   'RPM/60 = ' + rpmTxt + '/60 = ' + f(n, 1) + ' rev/s');
    // J = V/(n·D)
    _setText('advEvalJ',   'V/(n\u00B7D) = ' + f(J, 3));
    // η = (T·V)/(2π·n·Q)
    _setText('advEvalEta', '(T\u00B7V)/(2\u03C0\u00B7n\u00B7Q) = ' + f(eta, 1) + ' %');
    // P = 2π·n·Q
    _setText('advEvalP',   '2\u03C0\u00B7n\u00B7Q = ' + f(P, 1) + ' W');
    // V_trim — text depends on the force-balance status
    var vtrimTxt;
    if (trimStatus === 'ok')                  vtrimTxt = '4T=\u00BD\u03C1CdA\u00B7V\u00B2 \u2192 ' + f(Vtrim, 2) + ' m/s';
    else if (trimStatus === 'exceeds')        vtrimTxt = '> Vmax (no crossing)';
    else if (trimStatus === 'thrust_limited') vtrimTxt = '~0 m/s (thrust-limited)';
    else                                      vtrimTxt = DASH;
    _setText('advEvalVtrim', vtrimTxt);
    // θ_pitch = atan(D/W)
    _setText('advEvalPitch', 'atan(D/W) = ' + f(pitchDeg, 1) + '\u00B0');
  }

  // Frontal-area readout (#areaWxH, §2.2/§2.5) — the plane's W×H = √A × √A
  function setAreaReadout(A) {
    var side = (_num(A) && A >= 0) ? Math.sqrt(A) : NaN;
    _setText('areaWxH', _num(side) ? (side.toFixed(3) + ' \u00D7 ' + side.toFixed(3) + ' m') : DASH);
  }

  return {
    switchTab: switchTab,
    renderDragSpeedChart: renderDragSpeedChart,
    renderEtaJChart: renderEtaJChart,
    renderThrustPowerChart: renderThrustPowerChart,
    renderSecondaryChart: renderSecondaryChart,
    renderCtCqChart: renderCtCqChart,
    renderDragThrustChart: renderDragThrustChart,
    updateFrameCards: updateFrameCards,
    updateAdvCards: updateAdvCards,
    updateHud: updateHud,
    updateSummaryCard: updateSummaryCard,
    setChecklistItem: setChecklistItem,
    setCommentary: setCommentary,
    renderHandoffBadge: renderHandoffBadge,
    setRunButtonEnabled: setRunButtonEnabled,
    setFinishButtonEnabled: setFinishButtonEnabled,
    setDensity: setDensity,
    renderDragDerivation: renderDragDerivation,
    renderWashAndRegression: renderWashAndRegression,
    renderAdvDerivation: renderAdvDerivation,
    setAreaReadout: setAreaReadout,
    drawDragDiagram: drawDragDiagram,
    drawAdvDiagram: drawAdvDiagram
  };
})();
window.UI2 = UI2;

// ═══════════════════════════════════════════════════════════════════
// 4d. VLAB2 IIFE (Module 2) — State, DB, Handoff, Orchestration
//     window.VLAB2. State owner + DB loader + Module-1 handoff loader +
//     event binder + per-tab orchestrator. Named VLAB2 to avoid colliding
//     with Module 1's VLAB. Additive only; the DOMContentLoaded router
//     calls VLAB2.init() on index2.html (detected via #frameDragGroup).
// ═══════════════════════════════════════════════════════════════════
const VLAB2 = (function () {
  'use strict';

  var _completionFired = false;
  var _persistTimer = null;        // debounce handle for _persistM2 (vlabExp3M2 writes)
  var RPM_MIN = 3000, RPM_MAX = 14000;   // throttle 0..1 → derived RPM range (Tab 2 flight)
  var _springRAF = null;                 // rAF handle for the throttle spring-return-to-0
  var _chartTimer = null;                // debounce handle for the heavy Tab-2 chart re-render
  var _knobDX = 0, _knobDY = 0, _dragging = false; var JOY_MAXR = 26;   // joystick knob offset + drag state

  var state = {
    db: null,

    // Inherited / fallback propeller (BEMT physics — kept SEPARATE from the visual sel)
    propDef: null,
    inherited: false,        // true when loaded from Module 1

    // Tab 1 — frame drag
    framePreset: null,       // selected entry from db.frames
    area_m2: 0.0152,
    cd: 1.05,                // default from drag_coefficients (x_frame 1.05); user-editable
    V_mps: 8,
    refLength_m: 0.45,       // = selected frame wheelbase_mm / 1000
    washOn: false,           // rotor-downwash reality toggle (override C2 §3.2)
    washK: 0.20,             // seeded per-frame extra-drag fraction, re-seeded on frame select

    // Visual drone — component selection consumed by DroneModel.updateFromSelections
    sel: null,               // { frame, motor, propeller, battery, esc, flight_controller, receiver, payloads:[] }
    inheritedBuild: false,   // true when vlabModule1 supplied the airframe build  [NEW §6.1]

    // Shared
    altitude: 0,
    rho: 1.225,

    // Weight model (inherited airframe) + forward-flight pitch  [NEW §6.1 / §6.5]
    mass_kg: 0,              // estimated airframe mass (kg)
    weight_N: 0,             // W = M·g (g = 9.80665), floored ≥ 1 N
    pitch_rad: 0,            // forward-flight pitch (radians)
    pitch_deg: 0,            // forward-flight pitch (degrees, display)

    // Tab 2 — efficiency
    rpm: 5000,               // DERIVED from throttle when the sim runs (RPM_MIN..RPM_MAX)
    throttle: 0,             // self-centering throttle position (0..1)   [NEW]
    simRunning: false,       // Start/Stop Simulation gate                [NEW]
    tab2Flown: false,        // joystick commanded forward speed > 0       [NEW]
    cmdV: 0,                 // commanded forward speed = throttle·Vmax   [NEW]
    Vmax: 25,
    sweepSteps: 26,
    sweep: [],
    peak: { eta: 0, J: 0, V: 0, idx: -1 },
    trim: { Vtrim: 0, status: 'thrust_limited' },

    activeTab: 1,

    // Completion tracking
    speedChanged: false,     // Tab 1 speed slider moved
    rpmChanged: false,       // Tab 2 RPM moved from 5000
    peakObserved: false,     // sweep produced eta_max > 0
    peakEtaAnnounced: false, // one-time OBSERVE narration fired
    regression: null,        // last Calc.dragRegression() result
    regressionShown: false,  // one-time OBSERVE narration fired (R² > 0.99)
    validBemt: false,        // eta > 0 at some J
    tab1Done: false,
    tab2Done: false,
    allDone: false
  };

  // ── small helpers ──
  // find-or-first: returns the matching entry, falling back to arr[0] (used for defaults)
  function _byId(arr, id) {
    if (!arr || !arr.length) return null;
    var found = id ? arr.find(function (x) { return x.id === id; }) : null;
    return found || arr[0];
  }
  // strict find: returns the matching entry or null (used for optional id mapping)
  function _findStrict(arr, id) {
    if (!arr || !id) return null;
    return arr.find(function (x) { return x.id === id; }) || null;
  }

  function _propDiameterM() {
    var dv = (state.sel && state.sel.propeller && isFinite(state.sel.propeller.diameter_m)) ? state.sel.propeller.diameter_m : 0;
    var dd = (state.propDef && isFinite(state.propDef.D_m)) ? state.propDef.D_m : 0;
    return Math.max(dv, dd) || 0.254;
  }
  // X-quad: adjacent motors sit wheelbase/√2 apart; rotors clash if prop diameter exceeds that.
  function _frameClashes(frame) {
    if (!frame || !isFinite(frame.wheelbase_mm)) return false;
    return (_propDiameterM() * 1000) > (frame.wheelbase_mm / Math.SQRT2);
  }
  function _reselectFrameTile(frame) {
    var cont = document.getElementById('frameAeroTilesContainer');
    if (!cont) return;
    cont.querySelectorAll('.component-tile').forEach(function (t) { t.classList.remove('selected'); });
    cont.querySelectorAll('input').forEach(function (i) { i.checked = false; });
    if (frame) {
      var input = document.getElementById('fa_' + frame.id);
      if (input) { input.checked = true; var tile = input.closest('.component-tile'); if (tile) tile.classList.add('selected'); }
    }
  }

  // ───────────────────────────────────────────────────────────────
  // §6.2 Initialization flow
  // ───────────────────────────────────────────────────────────────
  function init() {
    Scene.init();
    // Drive the ported drone's prop spin AND the oncoming-airflow stream each frame.
    Scene.setAuxTick(function (dt, tab) {
      DroneModel.animateProps(dt);
      AeroFlow.tick(dt, tab);
    });

    Calc.loadCatalog()
      .then(function (data) {
        state.db = data;
        // §6.2 init flow — inheritance-FIRST (Cd/V/RPM/Vmax defaults live in the state initializer).
        _loadInheritedBuild();      // §1A.2 vlabModule1 → state.sel + framePreset/area_m2/refLength_m
        _populateFrames();          // frame tiles; the inherited frame is pre-selected (selectedIds)
        _loadHandoff();             // §6.4 designed/fallback BEMT propDef + altitude precedence + badge + summary
        _estimateWeight();          // §6.5 airframe mass from inherited component masses → W = M·g
        _restoreM2();               // §1A.4 overlay last Module-2 session (clamped) onto controls, if present
        _syncFrameSliders();        // reflect the final area_m2 onto #areaSlider (covers the no-restore case)
        _bindEvents();
        DroneModel.setDesignedProp(state.propDef);    // loft the student-designed blade (null ⇒ catalog fallback)
        DroneModel.updateFromSelections(state.sel);   // build the full procedural drone on the inherited airframe
        AeroFlow.build(state.area_m2);                // mist + accurate frontal-area plane
        AeroFlow.setDensity(state.rho);               // ρ → mist count/opacity
        AeroFlow.setMode('drag');                     // Tab 1: pure oncoming flow past a stationary drone
        UI2.setAreaReadout(state.area_m2);            // frontal-area plane W×H readout (once on load)
        _computeAndRender();
        _syncSharedStore2();
      })
      .catch(function (err) {
        console.error('DB load error:', err);
        var banner = document.getElementById('errorBanner');
        if (banner) banner.classList.remove('hidden');
        UI2.setRunButtonEnabled(false);
        UI2.setFinishButtonEnabled(false);
      });
  }

  // ───────────────────────────────────────────────────────────────
  // §6.3 Handoff — reconstruct the inherited Module 1 propeller (BEMT)
  // ───────────────────────────────────────────────────────────────
  function _loadHandoff() {
    var inheritedText = '';
    var isFallback = true;
    try {
      var raw = localStorage.getItem('vlabExp3M1_propDef');
      if (raw) {
        var pd = JSON.parse(raw);
        // Rebuild derived fields if missing (e.g., only primitive params were stored)
        if (pd && (!pd.stations || !pd.R_m)) {
          pd = Calc.buildPropDef(_coerceParams(pd));
        }
        if (pd && pd.D_m) {
          state.propDef = pd;
          state.inherited = true;
          isFallback = false;
          inheritedText = 'Inherited from Module 1: N=' + pd.N + ', \u00D8' + pd.D_in +
            'in, ' + (pd.airfoil ? pd.airfoil.name : '\u2014') +
            ', ' + (pd.material ? pd.material.label : '\u2014');
        }
      }
    } catch (e) { /* fall through to default */ }

    if (!state.propDef) _buildDefaultProp();   // §6.4

    // §1A.5 altitude/density continuity precedence:
    //   vlabExp3M2.altitude_m → vlabExp3M1_propConfig.altitude_m → vlabModule1.alt → 0
    _seedAltitude();

    // reflect altitude slider + density readout
    var as = document.getElementById('altSlider');
    if (as) {
      as.value = state.altitude;
      var av = document.getElementById('altVal');
      if (av) av.textContent = state.altitude + ' m';
    }
    UI2.setDensity(state.rho);

    UI2.renderHandoffBadge(isFallback ? '' : inheritedText, isFallback);
    UI2.updateSummaryCard(state.propDef);
  }

  // §6.4 fallback BEMT propeller (sourced from the fetched DB so polar fields exist)
  function _buildDefaultProp() {
    var af  = state.db.naca_airfoils[0];     // NACA 0012
    var mat = state.db.blade_materials[0];   // Glass Nylon
    state.propDef = Calc.buildPropDef({
      N: 2, D_in: 10, theta_root_deg: 28, theta_tip_deg: 8,
      c_root_mm: 30, c_tip_mm: 12, airfoil: af, material: mat
    });
    state.inherited = false;
  }

  // Map a stored propDef onto the buildPropDef param shape, re-sourcing airfoil/material
  // from the DB by id when the stored polar/material fields are missing.
  function _coerceParams(pd) {
    pd = pd || {};
    var db = state.db;
    var af  = pd.airfoil;
    var mat = pd.material;
    if (!af || af.cd0 === undefined || af.cl_max === undefined) {
      af = _byId(db.naca_airfoils, af && af.id);
    }
    if (!mat || mat.density_kg_m3 === undefined) {
      mat = _byId(db.blade_materials, mat && mat.id);
    }
    return {
      N:              pd.N != null ? pd.N : 2,
      D_in:           pd.D_in != null ? pd.D_in : 10,
      theta_root_deg: pd.theta_root_deg != null ? pd.theta_root_deg : 28,
      theta_tip_deg:  pd.theta_tip_deg != null ? pd.theta_tip_deg : 8,
      c_root_mm:      pd.c_root_mm != null ? pd.c_root_mm : 30,
      c_tip_mm:       pd.c_tip_mm != null ? pd.c_tip_mm : 12,
      airfoil:        af,
      material:       mat
    };
  }

  // ───────────────────────────────────────────────────────────────
  // §1A.2 / §6.3  Inherited airframe build (inheritance-FIRST).
  // Builds state.sel from the CANONICAL vlabModule1 ids
  //   fId→frames, mId→motors, pId→propellers, bId→batteries, eId→escs,
  //   fcId→flight_controllers, rId→receivers, pldIds[]→payloads
  // (confirmed against the propulsion writer's compactState). Representative
  // defaults are a FALLBACK ONLY — used when vlabModule1 is absent/unparseable
  // or a given id is missing. This is the SINGLE inheritance path; it replaces
  // the prior _buildDefaultSelection, which mis-read rxId/payloadIds.
  // state.sel.frame is the source of truth for the visual drone frame + A/L.
  // ───────────────────────────────────────────────────────────────
  function _loadInheritedBuild() {
    var db = state.db;
    var strict = function (arr, id) { return _findStrict(arr, id); };   // id → entry or null

    // Representative fallbacks (used only when an inherited id is absent/unknown).
    var sel = {
      frame:             db.frames[0],
      motor:             _byId(db.motors, '2212_920'),
      propeller:         _byId(db.propellers, '1045_2b'),
      battery:           _byId(db.batteries, '4s_1500'),
      esc:               _byId(db.escs, 'esc_4in1_45a'),
      flight_controller: _byId(db.flight_controllers, 'fc_f7'),
      receiver:          _byId(db.receivers, 'rx_elrs_ep1'),
      payloads:          []
    };

    try {
      var m1 = JSON.parse(localStorage.getItem('vlabModule1'));
      if (m1 && typeof m1 === 'object') {
        sel.frame             = strict(db.frames,             m1.fId)  || sel.frame;   // INHERITED FIRST
        sel.motor             = strict(db.motors,             m1.mId)  || sel.motor;
        sel.propeller         = strict(db.propellers,         m1.pId)  || sel.propeller;   // catalog/visual prop
        sel.battery           = strict(db.batteries,          m1.bId)  || sel.battery;
        sel.esc               = strict(db.escs,               m1.eId)  || sel.esc;
        sel.flight_controller = strict(db.flight_controllers, m1.fcId) || sel.flight_controller;
        sel.receiver          = strict(db.receivers,          m1.rId)  || sel.receiver;   // canonical rId
        if (Array.isArray(m1.pldIds)) {                                                    // canonical pldIds
          sel.payloads = m1.pldIds
            .map(function (id) { return strict(db.payloads, id); })
            .filter(Boolean);
        }
        state.inheritedBuild = true;
      }
    } catch (e) { /* fallbacks already in place */ }

    state.sel         = sel;
    state.framePreset = sel.frame;                  // frame drives the visual drone + frontal area / ref length
    state.area_m2     = sel.frame.frontal_area_m2;
    state.refLength_m = sel.frame.wheelbase_mm / 1000;
    state.washK       = Calc.washFactor(sel.frame.id);
  }

  // ───────────────────────────────────────────────────────────────
  // §6.5  _estimateWeight() — airframe mass from inherited component masses → weight.
  // Each term is null-guarded (missing/non-numeric mass ⇒ 0). weight_N is floored
  // at 1 N so the forward-flight pitch model (θ = atan(D/W)) never divides by ~0.
  // ───────────────────────────────────────────────────────────────
  function _estimateWeight() {
    var sel = state.sel || {};
    var g = function (obj, key) {
      var v = obj ? obj[key] : 0;
      return (typeof v === 'number' && isFinite(v)) ? v : 0;
    };
    var escMass = g(sel.esc, 'mass_g_each') * g(sel.esc, 'quantity');
    var payloadMass = Array.isArray(sel.payloads)
      ? sel.payloads.reduce(function (sum, p) { return sum + g(p, 'mass_g'); }, 0)
      : 0;

    var M = g(sel.frame, 'mass_g')
          + 4 * g(sel.motor, 'mass_g')
          + g(sel.battery, 'mass_g')
          + escMass
          + g(sel.flight_controller, 'mass_g')
          + g(sel.receiver, 'mass_g')
          + 4 * g(sel.propeller, 'mass_g_each')
          + payloadMass;

    state.mass_kg  = M / 1000;
    state.weight_N = Math.max(1, state.mass_kg * 9.80665);   // g = 9.80665; floor 1 N
  }

  // ───────────────────────────────────────────────────────────────
  // §1A.5  _seedAltitude() — altitude/density continuity precedence:
  //   vlabExp3M2.altitude_m → vlabExp3M1_propConfig.altitude_m → vlabModule1.alt → 0
  // Clamps to [0, 3000] m and drives ρ via Calc.airDensity. Each source read is
  // wrapped in try/catch so a missing/corrupt key falls through to the next.
  // ───────────────────────────────────────────────────────────────
  function _seedAltitude() {
    var readNum = function (key, field) {
      try {
        var o = JSON.parse(localStorage.getItem(key));
        if (o && typeof o[field] === 'number' && isFinite(o[field])) return o[field];
      } catch (e) {}
      return null;
    };
    var h = readNum('vlabExp3M2', 'altitude_m');
    if (h === null) h = readNum('vlabExp3M1_propConfig', 'altitude_m');
    if (h === null) h = readNum('vlabModule1', 'alt');
    if (h === null) h = 0;
    state.altitude = Math.max(0, Math.min(3000, h));
    state.rho      = Calc.airDensity(state.altitude);
  }

  // ───────────────────────────────────────────────────────────────
  // §1A.4 / §6.6  Module-2 session persistence (vlabExp3M2).
  // _persistM2(): debounced (~250 ms) try/catch write of the current controls +
  //   latest computed outputs. q/D/CdA/Re are derived purely from the current
  //   state controls; etaMax/Jbest/Vtrim/pitch_deg come off state and may be 0
  //   until computed. Never throws if localStorage is unavailable.
  // ───────────────────────────────────────────────────────────────
  function _persistM2() {
    if (_persistTimer) clearTimeout(_persistTimer);
    _persistTimer = setTimeout(function () {
      _persistTimer = null;
      try {
        var q   = Calc.dynamicPressure(state.rho, state.V_mps);
        var D   = Calc.dragForce(state.rho, state.V_mps, state.cd, state.area_m2);
        var Deff = Calc.dragForceEffective(state.rho, state.V_mps, state.cd, state.area_m2, state.washK, state.washOn);
        var CdA = state.cd * state.area_m2;
        var Re  = Calc.reynoldsLength(state.rho, state.V_mps, state.refLength_m);
        var af  = (state.propDef && state.propDef.airfoil) ? state.propDef.airfoil : null;
        var payload = {
          frameId:    state.framePreset ? state.framePreset.id : null,
          area_m2:    state.area_m2,
          cd:         state.cd,
          V_mps:      state.V_mps,
          altitude_m: state.altitude,
          rpm:        state.rpm,
          q:          q,
          D:          D,
          CdA:        CdA,
          Re:         Re,
          etaMax:     state.peak ? state.peak.eta : 0,
          Jbest:      state.peak ? state.peak.J : 0,
          Vtrim:      state.trim ? state.trim.Vtrim : 0,
          pitch_deg:  state.pitch_deg
        };
        localStorage.setItem('vlabExp3M2', JSON.stringify(payload));

        // Mirror the aerodynamic results into the unified cross-experiment store
        // (Exp 3 slice). Exp 3 inherits its prop/frame from Exp 1, so this slice
        // records the aero characterisation of the user's actual drone.
        if (window.VLABStore) {
          window.VLABStore.finalize('exp3', {
            frameId:        payload.frameId,
            eta_prop_peak:  state.peak ? +(state.peak.eta / 100).toFixed(3) : 0,   // fraction 0..1
            eta_prop_peak_pct: state.peak ? +state.peak.eta.toFixed(1) : 0,
            J_best:         state.peak ? +state.peak.J.toFixed(3) : 0,
            Vtrim_mps:      state.trim ? +state.trim.Vtrim.toFixed(2) : 0,
            frame_drag_N:   +D.toFixed(3),
            frame_drag_eff_N: +Deff.toFixed(3),
            optimal_speed_ms: (state.peak && state.peak.idx >= 0) ? +state.peak.V.toFixed(2) : 0,
            airfoilId:      af ? (af.id || null) : null,
            cl_max_measured: af ? +af.cl_max.toFixed(3) : null,
            stall_angle_deg: af ? af.stall_angle_deg : null,
            frontal_area_m2: state.area_m2,
            cd:             state.cd,
            Re:             Math.round(Re),
            V_mps:          state.V_mps
          });
        }
      } catch (e) { /* localStorage unavailable — ignore */ }
    }, 250);
  }

  // _restoreM2(): overlay a prior Module-2 session (vlabExp3M2) onto state, each
  // control CLAMPED to its slider range, then reflect onto sliders/value-spans +
  // the frame tile. try/catch — never throws if localStorage is unavailable.
  function _restoreM2() {
    var s;
    try {
      s = JSON.parse(localStorage.getItem('vlabExp3M2'));
    } catch (e) { return; }
    if (!s || typeof s !== 'object') return;

    var clamp = function (v, lo, hi, fallback) {
      var n = parseFloat(v);
      if (!isFinite(n)) return fallback;
      return Math.max(lo, Math.min(hi, n));
    };

    // Frame selection — only when the stored frame still exists in the DB.
    if (s.frameId) {
      var f = _findStrict(state.db.frames, s.frameId);
      if (f) {
        state.framePreset = f;
        if (state.sel) state.sel.frame = f;
        state.area_m2     = f.frontal_area_m2;
        state.refLength_m = f.wheelbase_mm / 1000;
        state.washK       = Calc.washFactor(f.id);
      }
    }

    // Controls — overlay CLAMPED to each slider's range.
    state.area_m2  = clamp(s.area_m2,    0.004, 0.040, state.area_m2);
    state.cd       = clamp(s.cd,         0.60,  1.30,  state.cd);
    state.V_mps    = clamp(s.V_mps,      0,     30,    state.V_mps);
    state.altitude = clamp(s.altitude_m, 0,     3000,  state.altitude);
    state.rpm      = clamp(s.rpm,        1000,  15000, state.rpm);
    state.rho      = Calc.airDensity(state.altitude);

    // Reflect onto sliders / value-spans / density readout.
    var setVal = function (id, v) { var el = document.getElementById(id); if (el) el.value = v; };
    var setTxt = function (id, t) { var el = document.getElementById(id); if (el) el.textContent = t; };
    setVal('areaSlider',  state.area_m2);   setTxt('areaVal',  state.area_m2.toFixed(4) + ' m\u00B2');
    setVal('cdSlider',    state.cd);        setTxt('cdVal',    state.cd.toFixed(2));
    setVal('speedSlider', state.V_mps);     setTxt('speedVal', state.V_mps.toFixed(1) + ' m/s');
    setVal('altSlider',   state.altitude);  setTxt('altVal',   state.altitude + ' m');
    setVal('rpmSlider',   state.rpm);       setTxt('rpmVal',   String(state.rpm));
    if (UI2 && UI2.setDensity) UI2.setDensity(state.rho);

    // Frame tile selection (mirror buildSharedTileGrid's radio + .selected pattern).
    if (state.framePreset) {
      var input = document.getElementById('fa_' + state.framePreset.id);
      if (input) {
        input.checked = true;
        var cont = document.getElementById('frameAeroTilesContainer');
        if (cont) {
          cont.querySelectorAll('.component-tile').forEach(function (t) { t.classList.remove('selected'); });
          var tile = input.closest('.component-tile');
          if (tile) tile.classList.add('selected');
        }
      }
    }
  }

  // ───────────────────────────────────────────────────────────────
  // §6.5 Frame tiles (from real db.frames — NOT a frame_aero array)
  // ───────────────────────────────────────────────────────────────
  function _populateFrames() {
    buildSharedTileGrid('frameAeroTilesContainer', state.db.frames, {
      name: 'frameAero', idPrefix: 'fa_',
      selectedIds: (state.framePreset && state.framePreset.id) || state.db.frames[0].id,
      specF: function (f) { return 'WB=' + f.wheelbase_mm + ' mm | A=' + f.frontal_area_m2 + ' m\u00B2'; },
      onSelect: function (f) {
        if (_frameClashes(f)) {
          var spacing = (f.wheelbase_mm / Math.SQRT2).toFixed(0);
          var pd = (_propDiameterM() * 1000).toFixed(0);
          UI2.setCommentary('\u26A0 ' + (f.label || 'That frame') + ' is too small for the \u00D8' + pd + ' mm propeller \u2014 the rotors would clash (adjacent spacing \u2248 ' + spacing + ' mm). Choose a larger wheelbase.');
          setTimeout(function () { _reselectFrameTile(state.framePreset); }, 0);   // revert AFTER buildSharedTileGrid re-selects the clicked tile
          return;
        }
        // Validated cross-experiment override: exp3 is a downstream experiment
        // overriding a frameId owned by exp1/exp2 \u2014 reject if it would break
        // an already-finalized upstream build (store rule \u00A74.6).
        if (window.VLABOverride) {
          var result = window.VLABOverride.trySet('frameId', f.id, 'exp3');
          if (!result.ok) {
            UI2.setCommentary('<strong>Selection blocked:</strong> ' + (result.reason || 'conflicts with an earlier experiment.'));
            setTimeout(function () { _reselectFrameTile(state.framePreset); }, 0);
            return;
          }
        }
        state.framePreset = f;
        state.area_m2     = f.frontal_area_m2;
        state.refLength_m = f.wheelbase_mm / 1000;
        state.washK       = Calc.washFactor(f.id);
        if (state.sel) state.sel.frame = f;          // visual drone uses the same frame
        _syncFrameSliders();
        DroneModel.updateFromSelections(state.sel);  // rebuild the full procedural drone
        AeroFlow.build(state.area_m2);
        _computeAndRender();
        _syncSharedStore2();
      }
    });
  }

  // Live cross-experiment sync + banner refresh (store rule \u00A74.1). Called after
  // any change that affects the shared build (frame pick, staleness-relevant).
  var _bannerCtl2 = null;
  function _syncSharedStore2() {
    if (window.VLABUi) {
      if (!_bannerCtl2) {
        _bannerCtl2 = window.VLABUi.mountBanner('vlBannerHost', {
          catalog: window.VLAB_CATALOG || (state.db || {}),
          currentExp: 'exp3',
          onChange: function (field) {
            if (field === 'frameId') UI2.setCommentary('Pick a different frame in the FRAME PRESET tiles above to resolve this.');
          }
        });
      } else {
        _bannerCtl2.refresh();
      }
    }
  }

  // Push the current frontal area into the area slider + readout.
  function _syncFrameSliders() {
    var as = document.getElementById('areaSlider');
    if (as) as.value = state.area_m2;
    var av = document.getElementById('areaVal');
    if (av) av.textContent = state.area_m2.toFixed(4) + ' m\u00B2';
  }

  // §6.6 defaults
  function _selectDefaults() {
    state.framePreset = state.db.frames[0];
    state.area_m2     = state.framePreset.frontal_area_m2;     // A from the first frame
    state.refLength_m = state.framePreset.wheelbase_mm / 1000; // L from its wheelbase
    state.cd          = 1.05;     // frames carry no cd; default stays user-editable
    state.V_mps       = 8;
    state.rpm         = 5000;
    state.Vmax        = 25;

    var firstTile = document.querySelector('#frameAeroTilesContainer .component-tile');
    if (firstTile) firstTile.classList.add('selected');
    _syncFrameSliders();           // reflect the default frame's area on load

    UI2.setRunButtonEnabled(true);
  }

  // ───────────────────────────────────────────────────────────────
  // §6.7 Event binding
  // ───────────────────────────────────────────────────────────────
  function _bindEvents() {
    // Frontal area
    var areaSlider = document.getElementById('areaSlider');
    if (areaSlider) {
      areaSlider.addEventListener('input', function () {
        state.area_m2 = parseFloat(this.value);
        var v = document.getElementById('areaVal');
        if (v) v.textContent = state.area_m2.toFixed(4) + ' m\u00B2';
        AeroFlow.setFrontalArea(state.area_m2);   // resize the frontal-area plane live (visibly evident)
        UI2.setAreaReadout(state.area_m2);         // update the #areaWxH W×H readout
        _computeAndRender();
        _persistM2();
      });
    }

    // Drag coefficient
    var cdSlider = document.getElementById('cdSlider');
    if (cdSlider) {
      cdSlider.addEventListener('input', function () {
        state.cd = parseFloat(this.value);
        var v = document.getElementById('cdVal');
        if (v) v.textContent = state.cd.toFixed(2);
        _computeAndRender();
        _persistM2();
      });
    }

    // Forward speed
    var speedSlider = document.getElementById('speedSlider');
    if (speedSlider) {
      speedSlider.addEventListener('input', function () {
        state.V_mps = parseFloat(this.value);
        state.speedChanged = true;
        var v = document.getElementById('speedVal');
        if (v) v.textContent = state.V_mps.toFixed(1) + ' m/s';
        AeroFlow.setSpeed(state.V_mps);
        _computeAndRender();
        _persistM2();
      });
    }

    // Altitude → air density
    var altSlider = document.getElementById('altSlider');
    if (altSlider) {
      altSlider.addEventListener('input', function () {
        state.altitude = parseInt(this.value, 10);
        var v = document.getElementById('altVal');
        if (v) v.textContent = state.altitude + ' m';
        state.rho = Calc.airDensity(state.altitude);
        UI2.setDensity(state.rho);
        AeroFlow.setDensity(state.rho);   // ρ → mist particle count + opacity
        _computeAndRender();
        _persistM2();
      });
    }

    // Rotor-wash reality toggle (override C2 second reality check, §3.2)
    var washToggle = document.getElementById('washToggle');
    if (washToggle) {
      washToggle.addEventListener('change', function () {
        state.washOn = !!this.checked;
        if (state.washOn && window.Instructor) window.Instructor.say(tunnelTip(state));
        _computeAndRender();
        _persistM2();
      });
    }

    // Start / Stop the flight simulation (Tab 2)
    var startBtn = document.getElementById('btnStartSim');
    if (startBtn) {
      startBtn.addEventListener('click', function () {
        state.simRunning = !state.simRunning;
        this.textContent = state.simRunning ? 'Stop Simulation' : 'Start Simulation';
        var joy = document.getElementById('flightJoystick');
        if (joy) joy.classList.toggle('disabled', !state.simRunning);
        if (!state.simRunning) { if (_springRAF) { cancelAnimationFrame(_springRAF); _springRAF = null; } _joyReset(); }
        Scene.setFlightActive(state.simRunning && state.activeTab === 2);
        _liveFlightUpdate();
      });
    }
    // Joystick (Tab 2) — drag forward to fly; springs back to centre on release
    var joyBase = document.getElementById('joystickBase');
    if (joyBase) {
      var _onMove = function (e) {
        var r = joyBase.getBoundingClientRect();
        _joyTo(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
      };
      joyBase.addEventListener('pointerdown', function (e) {
        if (!state.simRunning) return;
        _dragging = true;
        if (_springRAF) { cancelAnimationFrame(_springRAF); _springRAF = null; }
        try { joyBase.setPointerCapture(e.pointerId); } catch (err) {}
        _onMove(e); e.preventDefault();
      });
      joyBase.addEventListener('pointermove', function (e) { if (_dragging) { _onMove(e); e.preventDefault(); } });
      var _release = function () { if (_dragging) { _dragging = false; _joySpringToCenter(); } };
      joyBase.addEventListener('pointerup', _release);
      joyBase.addEventListener('pointercancel', _release);
      joyBase.addEventListener('lostpointercapture', _release);
    }

    // Tab buttons
    document.querySelectorAll('.vp-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _switchTab(parseInt(this.dataset.tab, 10));
      });
    });

    // "Finish Experiment" — only meaningful once the completion gate is satisfied
    var finishBtn = document.getElementById('btnFinish');
    if (finishBtn) {
      finishBtn.addEventListener('click', function () {
        if (!state.allDone) return;
        UI2.setCommentary('Module 2 complete \u2014 you explored frame parasite drag and the inherited propeller\u2019s forward-flight efficiency. Well done!');
      });
    }

    // Config panel collapse (mirror Module 1 VLAB)
    var panelTitle = document.getElementById('configPanelTitle');
    var configSections = document.getElementById('configSections');
    var chevron = document.getElementById('configPanelChevron');
    if (panelTitle && configSections) {
      panelTitle.addEventListener('click', function () {
        var isHidden = configSections.classList.toggle('hidden');
        if (chevron) chevron.style.transform = isHidden ? 'rotate(-90deg)' : 'rotate(0deg)';
      });
    }
  }

  // ───────────────────────────────────────────────────────────────
  // §6.8 Tab switching
  // ───────────────────────────────────────────────────────────────
  function _switchTab(n) {
    state.activeTab = n;
    if (window.Instructor) window.Instructor.enterTab(n === 2 ? 'intro_m2_cruise' : 'intro_m2_tunnel');
    var fc = document.getElementById('flightControls');
    if (n === 2) {
      if (fc) fc.classList.remove('hidden');
      var joy2 = document.getElementById('flightJoystick'); if (joy2) joy2.classList.toggle('disabled', !state.simRunning);
      AeroFlow.setMode('flight');
      Scene.setFlightActive(state.simRunning);
    } else {
      if (fc) fc.classList.add('hidden');
      state.simRunning = false;
      var sb = document.getElementById('btnStartSim'); if (sb) sb.textContent = 'Start Simulation';
      var joy = document.getElementById('flightJoystick'); if (joy) joy.classList.add('disabled');
      if (_springRAF) { cancelAnimationFrame(_springRAF); _springRAF = null; }
      _joyReset();
      state.throttle = 0; state.cmdV = 0; state.rpm = RPM_MIN;
      DroneModel.setForwardSpeed(0); DroneModel.setPitch(0); DroneModel.setSimRPM(0);
      if (DroneModel.resetFlight) DroneModel.resetFlight();
      Scene.setFlightActive(false);
      AeroFlow.setMode('drag');
    }
    AeroFlow.setRunning(true);
    Scene.setTab(n);
    UI2.switchTab(n);
    _computeAndRender();
  }

  // ───────────────────────────────────────────────────────────────
  // §6.9a Tab-2 throttle-driven flight helpers (self-centering throttle → speed + derived RPM)
  // ───────────────────────────────────────────────────────────────
  // Set throttle (0..1) → commanded speed + derived RPM; light live update + debounced charts.
  function _setThrottle(t01) {
    state.throttle = Math.max(0, Math.min(1, isFinite(t01) ? t01 : 0));
    state.cmdV = state.throttle * state.Vmax;
    state.rpm  = Math.round(RPM_MIN + state.throttle * (RPM_MAX - RPM_MIN));
    if (state.cmdV > 0) state.tab2Flown = true;
    var ro = document.getElementById('throttleReadout');
    if (ro) ro.textContent = state.cmdV.toFixed(1) + ' m/s';
    _liveFlightUpdate();
    _scheduleChartUpdate();
  }

  // Position the knob (clamped within JOY_MAXR) and derive throttle from the FORWARD (up) component.
  function _joyTo(dx, dy) {
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d > JOY_MAXR) { dx = dx / d * JOY_MAXR; dy = dy / d * JOY_MAXR; }
    _knobDX = dx; _knobDY = dy;
    var knob = document.getElementById('joystickKnob');
    if (knob) knob.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';
    _setThrottle(Math.max(0, -dy) / JOY_MAXR);   // up = forward; down = 0
  }
  // Spring the knob back to centre (and throttle to 0) on release.
  function _joySpringToCenter() {
    if (_springRAF) cancelAnimationFrame(_springRAF);
    var stepFn = function () {
      _knobDX *= 0.70; _knobDY *= 0.70;
      if (Math.abs(_knobDX) < 0.5 && Math.abs(_knobDY) < 0.5) { _joyReset(); _springRAF = null; return; }
      var knob = document.getElementById('joystickKnob');
      if (knob) knob.style.transform = 'translate(' + _knobDX.toFixed(1) + 'px,' + _knobDY.toFixed(1) + 'px)';
      _setThrottle(Math.max(0, -_knobDY) / JOY_MAXR);
      _springRAF = requestAnimationFrame(stepFn);
    };
    _springRAF = requestAnimationFrame(stepFn);
  }
  // Snap the knob to centre + throttle 0 (used on Stop / Tab-1).
  function _joyReset() {
    _knobDX = 0; _knobDY = 0;
    var knob = document.getElementById('joystickKnob');
    if (knob) knob.style.transform = 'translate(0px,0px)';
    _setThrottle(0);
  }

  // Display operating point for the live readouts (HUD / velocity triangle / derivation):
  //   • While actively flying (sim running + throttle pushed) → the LIVE commanded point.
  //   • Otherwise → the current sweep's PEAK point (falls back to mid-sweep), so the analysis
  //     never collapses to 0 when the drone is stopped.
  function _displayOpPoint() {
    var rpm = Math.max(1, state.rpm || RPM_MIN);
    if (state.simRunning && state.cmdV > 0.05) {
      var r = Calc.runBEMT(state.propDef, rpm, state.cmdV, state.rho) || { T:0, Q:0, J:0, eta:0, FoM:0 };
      return { V: state.cmdV, rpm: rpm, J: r.J, eta: r.eta, T: r.T, Q: r.Q, FoM: r.FoM, P: 2 * Math.PI * (rpm / 60) * (r.Q || 0) };
    }
    var sw = state.sweep || [];
    var pk = (state.peak && state.peak.idx >= 0 && sw[state.peak.idx]) ? sw[state.peak.idx]
           : (sw.length ? sw[Math.floor(sw.length / 2)] : null);
    if (pk) return { V: pk.V, rpm: rpm, J: pk.J, eta: pk.eta, T: pk.T, Q: pk.Q, FoM: pk.FoM, P: pk.P };
    return { V: 0, rpm: rpm, J: 0, eta: 0, T: 0, Q: 0, FoM: 0, P: 0 };
  }

  // LIGHT per-change update: PHYSICAL drone follows the LIVE throttle (stops on release);
  // the analysis readouts (HUD / velocity triangle / derivation) follow the display op point.
  function _liveFlightUpdate() {
    if (state.activeTab !== 2 || !state.propDef) return;

    // PHYSICAL drone — driven by the LIVE throttle (stops/centres when the joystick is released).
    var liveV   = state.simRunning ? state.cmdV : 0;
    var liveRpm = state.simRunning ? state.rpm  : 0;
    DroneModel.setSimRPM(liveRpm);
    DroneModel.setForwardSpeed(liveV);
    var pitchLive = Math.min(Calc.trimPitch(Calc.dragForce(state.rho, liveV, state.cd, state.area_m2), state.weight_N), 35 * Math.PI / 180);
    DroneModel.setPitch(Math.min(pitchLive * 1.3, 16 * Math.PI / 180));
    AeroFlow.setMode('flight'); AeroFlow.setSpeed(liveV); AeroFlow.setRunning(true);
    Scene.setFlightActive(state.simRunning);

    // ANALYSIS readouts — display operating point (live while flying, else sweep peak ⇒ never 0).
    var op = _displayOpPoint();
    state.pitch_rad = Math.min(Calc.trimPitch(Calc.dragForce(state.rho, op.V, state.cd, state.area_m2), state.weight_N), 35 * Math.PI / 180);
    state.pitch_deg = state.pitch_rad * 180 / Math.PI;
    var n = op.rpm / 60;
    UI2.updateHud(op.J, op.eta, op.rpm, _trimText(), state.pitch_deg, op.V);
    UI2.renderAdvDerivation(op.rpm, n, op.J, op.eta, op.P, state.trim.Vtrim, state.pitch_deg, state.trim.status);
    var Ut = Math.PI * n * state.propDef.D_m, Vrel = Math.sqrt(op.V * op.V + Ut * Ut), phi = Math.atan2(op.V, Ut);
    UI2.drawAdvDiagram(op.V, Ut, Vrel, phi, op.J, op.rpm);
    _checkCompletion();
  }

  // Debounced HEAVY update: recompute the sweep + re-render the five Tab-2 charts.
  function _scheduleChartUpdate() {
    if (_chartTimer) clearTimeout(_chartTimer);
    _chartTimer = setTimeout(function () { _chartTimer = null; _renderTab2Charts(); }, 140);
  }
  function _renderTab2Charts() {
    if (state.activeTab !== 2 || !state.propDef) return;
    state.sweep = Calc.efficiencySweep(state.propDef, Math.max(1, state.rpm), state.rho, state.Vmax, state.sweepSteps);
    state.peak  = Calc.peakEfficiency(state.sweep);
    state.trim  = Calc.findTrimSpeed(state.sweep, state.rho, state.cd, state.area_m2, 4);
    state.peakObserved = state.peak.eta > 0;
    state.validBemt    = state.sweep.some(function (s) { return s.eta > 0; });
    // Performance-Results cards = STABLE sweep summary (peak operating point + trim) — these no
    // longer collapse to 0 when the drone is stopped (they reflect the propeller's best point).
    var pk = (state.peak && state.peak.idx >= 0 && state.sweep[state.peak.idx])
           ? state.sweep[state.peak.idx] : { T:0, Q:0, eta:0, J:0, FoM:0, P:0 };
    UI2.updateAdvCards({ V: pk.V, J: state.peak.J, eta: state.peak.eta, T: pk.T, Q: pk.Q, P: pk.P, FoM: pk.FoM }, state.trim);
    UI2.renderEtaJChart(state.sweep, state.peak);
    UI2.renderThrustPowerChart(state.sweep, state.trim);
    UI2.renderSecondaryChart(state.sweep);
    UI2.renderCtCqChart(state.sweep);
    UI2.renderDragThrustChart(state.sweep, state.rho, state.cd, state.area_m2, state.trim);
    UI2.setCommentary(_commentaryTab2());
  }

  // ───────────────────────────────────────────────────────────────
  // §6.9 Compute + render the active tab
  // ───────────────────────────────────────────────────────────────
  function _computeAndRender() {
    if (!state.propDef) return;

    if (state.activeTab === 1) {
      var q   = Calc.dynamicPressure(state.rho, state.V_mps);
      var D   = Calc.dragForce(state.rho, state.V_mps, state.cd, state.area_m2);
      var CdA = state.cd * state.area_m2;
      var Re  = Calc.reynoldsLength(state.rho, state.V_mps, state.refLength_m);
      var Deff = Calc.dragForceEffective(state.rho, state.V_mps, state.cd, state.area_m2, state.washK, state.washOn);

      // Air helper — speed, density (count/opacity) and frontal-area plane size.
      AeroFlow.setSpeed(state.V_mps);
      AeroFlow.setDensity(state.rho);
      AeroFlow.setFrontalArea(state.area_m2);
      AeroFlow.setRunning(true);

      // Cards + Drag-vs-Speed chart + animated side-view flow diagram + live derivation + area readout.
      UI2.updateFrameCards(q, D, CdA, Re);
      UI2.renderDragSpeedChart(state.rho, state.cd, state.area_m2, state.V_mps, 30);
      UI2.drawDragDiagram(state.rho, state.V_mps, state.cd, state.area_m2, D, q, CdA, Re, Deff, state.washOn);
      UI2.renderDragDerivation(state.rho, state.V_mps, state.cd, state.area_m2, state.refLength_m, q, CdA, D, Re);
      UI2.setAreaReadout(state.area_m2);

      // Rotor-wash effective drag + F_D-vs-V² regression (override C2, §3.2).
      state.regression = Calc.dragRegression(state.rho, state.cd, state.area_m2, state.washK, state.washOn, 5);
      state.regressionShown = state.regression.r2 > 0.99;
      UI2.renderWashAndRegression(state.washOn, state.washK, Deff, state.regression.slope, state.regression.r2);

      UI2.setCommentary(_commentaryTab1(q, D, CdA, Re));
      _checkCompletion();
      _persistM2();
    } else {
      // Tab 2 — live throttle-driven flight + analysis charts.
      _renderTab2Charts();
      _liveFlightUpdate();
      UI2.setRunButtonEnabled(!!state.propDef);
      // Bug fix: _persistM2() was previously only called from the Tab-1 branch,
      // so eta_prop_peak/J_best/Vtrim_mps/optimal_speed_ms in the finalized
      // exp3 store slice stayed at their zero defaults until the user happened
      // to revisit Tab 1 — the cruise-efficiency sweep computed here never got
      // written. Persist as soon as the sweep produces fresh peak/trim data.
      _checkCompletion();
      _persistM2();
    }

    UI2.setRunButtonEnabled(!!state.propDef);
  }

  // ───────────────────────────────────────────────────────────────
  // §6.10 Completion gate
  // ───────────────────────────────────────────────────────────────
  function _checkCompletion() {
    state.tab1Done = state.speedChanged;                                                       // §2.9
    state.tab2Done = state.tab2Flown && state.peakObserved && state.validBemt;                  // §3.11
    state.allDone  = state.tab1Done && state.tab2Done;

    var dragVal = state.tab1Done ? ('Cd\u00B7A=' + (state.cd * state.area_m2).toFixed(5) + ' m\u00B2, D=' +
        Calc.dragForce(state.rho, state.V_mps, state.cd, state.area_m2).toFixed(3) + ' N @ ' + state.V_mps + ' m/s') : '';
    var advVal = state.tab2Done ? ('\u03B7_max=' + state.peak.eta.toFixed(1) + '% @ J=' + state.peak.J.toFixed(3)) : '';

    // Uniform objectives panel (shared VLABLab), matching Experiments 4-6; falls
    // back to the per-item checklist toggles when the kit is absent (tests).
    var container = document.getElementById('checklistContainer');
    if (window.VLABLab && container) {
      window.VLABLab.objectives(container, [
        { id: 'chkFrameDrag', label: 'Frame Drag', test: function () { return state.tab1Done; }, value: function () { return dragVal; } },
        { id: 'chkAdvRatio', label: 'Advance Ratio & Efficiency', test: function () { return state.tab2Done; }, value: function () { return advVal; } },
        {
          id: 'chkRegression', label: 'F_D–V² regression R² > 0.999',
          test: function () { return !!(state.regression && state.regression.r2 > 0.999); },
          value: function () { return state.regression ? ('R²=' + state.regression.r2.toFixed(4)) : ''; }
        },
        {
          id: 'chkPeakEta', label: 'Peak η_prop identified (J within 0.45–0.70)',
          test: function () { return !!(state.peakObserved && state.peak && state.peak.J >= 0.45 && state.peak.J <= 0.70); },
          value: function () { return (state.peakObserved && state.peak) ? ('J=' + state.peak.J.toFixed(3)) : ''; }
        },
        {
          id: 'chkTrim', label: 'Trim speed found (thrust = drag)',
          test: function () { return !!(state.trim && state.trim.status === 'ok'); },
          value: function () { return (state.trim && state.trim.status === 'ok') ? (state.trim.Vtrim.toFixed(1) + ' m/s') : ''; }
        }
      ], state, { title: 'Module checklist' });
    } else {
      if (state.tab1Done) UI2.setChecklistItem('chkFrameDrag', true, dragVal);
      if (state.tab2Done) UI2.setChecklistItem('chkAdvRatio', true, advVal);
    }

    // Fault scenarios (§5 #2 high-altitude, #3 rotor-wash) — a uniform selector
    // that drives the same state the manual controls do, so switching back to
    // "No fault" restores the pre-scenario altitude/wash exactly.
    if (window.VLABLab && document.getElementById('scenarioHost')) {
      window.VLABLab.scenario('scenarioHost', {
        title: 'Fault scenario',
        current: state.activeScenario || 'none',
        options: [
          { id: 'none', label: 'No fault (normal)', desc: 'Manual controls drive altitude and wash.' },
          { id: 'high_altitude', label: 'High-altitude test (3000 m)', desc: 'Thinner air: lower drag AND lower thrust — the trim point moves.', fault: true },
          { id: 'rotor_wash', label: 'Rotor-wash drag (flight-realistic)', desc: 'Adds the 15–30% real-flight drag gap the clean tunnel never sees.', fault: true }
        ],
        onSelect: function (id) {
          state.activeScenario = id;
          if (id === 'high_altitude') {
            state._preScenarioAlt = state._preScenarioAlt != null ? state._preScenarioAlt : state.altitude;
            state.altitude = 3000;
            state.rho = Calc.airDensity(3000);
          } else if (id === 'rotor_wash') {
            state.washOn = true;
            var wt = document.getElementById('washToggle'); if (wt) wt.checked = true;
          } else {
            if (state._preScenarioAlt != null) { state.altitude = state._preScenarioAlt; state.rho = Calc.airDensity(state.altitude); state._preScenarioAlt = null; }
          }
          var as = document.getElementById('altSlider'); if (as) as.value = state.altitude;
          var av = document.getElementById('altVal'); if (av) av.textContent = state.altitude + ' m';
          UI2.setDensity(state.rho);
          _computeAndRender();
        }
      });
    }

    // Verdict (§5): PASS when the cruise envelope closes; WARN when trim only
    // exists with wash off; FAIL when available thrust never crosses drag.
    if (window.VLABLab && document.getElementById('verdictHost')) {
      var trimOk = !!(state.trim && state.trim.status === 'ok');
      var etaOk  = !!(state.peakObserved && state.peak && state.peak.eta >= 45);
      var dEffOk = isFinite(Calc.dragForceEffective(state.rho, state.V_mps, state.cd, state.area_m2, state.washK, state.washOn));
      if (trimOk && etaOk && dEffOk) {
        window.VLABLab.verdict('verdictHost', { tone: 'pass', label: 'Cruise envelope closes', note: 'V_trim=' + state.trim.Vtrim.toFixed(1) + ' m/s, η_peak=' + state.peak.eta.toFixed(0) + '%' });
        if (!state.verdictPassAnnounced) {
          state.verdictPassAnnounced = true;
          if (window.Instructor) window.Instructor.say('GUIDE: Aerodynamic characterisation complete. Your frame drag and cruise envelope are stored for the mission-planning experiment.');
        }
      } else if (trimOk && !state.washOn) {
        window.VLABLab.verdict('verdictHost', { tone: 'warn', label: 'Trim exists only with wash off', note: 'Toggle rotor-wash on to confirm the margin holds in real flight.' });
      } else if (!trimOk && state.trim && state.trim.status !== 'exceeds') {
        window.VLABLab.verdict('verdictHost', { tone: 'fail', label: 'Available thrust never crosses drag', note: 'Under-propped build — Section to revisit: Experiment 1 (Propulsion System Design).' });
      } else {
        window.VLABLab.verdict('verdictHost', { tone: 'warn', label: 'Cruise envelope in progress', note: 'Run the forward-speed sweep to find trim and peak efficiency.' });
      }
    }

    UI2.setFinishButtonEnabled(state.allDone);
    var fh = document.getElementById('finishHint'); if (fh) fh.classList.toggle('hidden', state.allDone);
    if (state.allDone && !_completionFired) {
      _completionFired = true;
      try { localStorage.setItem('vlabExp3M2_complete', 'true'); } catch (e) {}
      _persistM2();   // §6.11 — final vlabExp3M2 snapshot on the rising edge of completion
      showUnlockCard();
    }
  }

  // ───────────────────────────────────────────────────────────────
  // §6.11 Commentary helpers (requirements §2.8 / §3.10)
  // ───────────────────────────────────────────────────────────────
  function _commentaryTab1(q, D, CdA, Re) {
    if (state.washOn) {
      return 'REALITY CHECK: In real forward flight the rotor downwash scrubs the frame, adding fifteen to thirty percent drag the clean tunnel never sees.';
    }
    if (state.regressionShown) {
      return 'OBSERVE: Drag grows with the square of speed. Plotted against velocity squared it is a clean straight line whose slope is half rho C-d A \u2014 your frame\u2019s aerodynamic signature.';
    }
    if (state.V_mps < 0.5) {
      return 'At hover there is no parasite drag \u2014 the airframe only fights gravity, not the wind.';
    }
    if (CdA > 0.02) {
      return 'This is a draggy airframe. A large flat-plate area will cost cruise efficiency and range.';
    }
    if (Re > 2.0e5) {
      return 'High Reynolds number \u2014 flow over the frame is firmly turbulent, typical of fast forward flight.';
    }
    return 'Increase forward speed and watch drag grow with the square of velocity. Frame shape (Cd) and frontal area both matter.';
  }

  function _commentaryTab2() {
    var t = state.trim || {};
    var pitchCue = (isFinite(state.pitch_deg) && state.pitch_deg > 0.05)
      ? ' To hold this condition the drone pitches nose-down about ' + state.pitch_deg.toFixed(1) +
        '\u00B0 so the tilted thrust both supports weight and overcomes drag.'
      : '';
    if (t.status === 'thrust_limited') {
      return 'At this RPM the rotors cannot overcome frame drag within the speed sweep. Increase RPM to reach a cruise condition.';
    }
    if (t.status === 'ok' && isFinite(t.Vtrim)) {
      return 'At about ' + t.Vtrim.toFixed(1) + ' m/s the four rotors\u2019 thrust just balances frame drag \u2014 that is the steady cruise speed for this airframe.' + pitchCue;
    }
    if (state.peakObserved && state.peak && state.peak.idx >= 0) {
      if (!state.peakEtaAnnounced) {
        state.peakEtaAnnounced = true;
        return 'OBSERVE: Peak propulsive efficiency found. Faster than this, the advancing blade approaches stall; slower, you waste power hovering forward. This is your design cruise speed.';
      }
      return 'Peak propulsive efficiency is near J = ' + state.peak.J.toFixed(3) +
        '. Below this J the prop wastes energy in swirl; above it the blades begin to stall.' + pitchCue;
    }
    return 'Sweep is automatic. Watch the \u03B7-vs-J curve and find the advance ratio where propulsive efficiency peaks.';
  }

  function _trimText() {
    var t = state.trim || {};
    if (t.status === 'ok')             return isFinite(t.Vtrim) ? t.Vtrim.toFixed(2) + ' m/s' : '\u2014';
    if (t.status === 'exceeds')        return '> ' + state.Vmax + ' m/s';
    if (t.status === 'thrust_limited') return '~0 m/s (thrust-limited)';
    return '\u2014';
  }

  return { init: init, state: state };
})();
window.VLAB2 = VLAB2;

// ═══════════════════════════════════════════════════════════════════
// 5. UI IIFE — All DOM & Chart.js Management
// ═══════════════════════════════════════════════════════════════════
const UI = (function () {
  'use strict';

  var _pitchTwistChart = null;
  var _chordDistChart  = null;
  var _clAlphaChart    = null;
  var _dragPolarChart  = null;
  var _efficiencyChart = null;
  var _localAoaChart   = null;
  var _thrustDistChart = null;

  // Airfoil series colours — palette-aligned (primary blue / emerald / amber) so the
  // three airfoil charts read consistently with the rest of the premium look.
  var AIRFOIL_COLORS = ['#2563eb', '#10b981', '#f59e0b'];

  // ─────────────────────────────────────────────────────────────────
  // Shared chart-styling helpers (VISUAL ONLY — no data / axis-meaning /
  // annotation-logic changes). Module 1's UI IIFE can't reach UI2's private
  // helpers, so these are local replicas (named with an `_m1` / `M1` prefix to
  // avoid any collision) giving Module 1's seven Chart.js renderers the same
  // premium look as Module 2.
  //   M1PALETTE   — shared colour roles.
  //   _m1Rgba     — hex → rgba(…,alpha).
  //   _m1Grad     — vertical area-fill gradient (≈28% alpha top → 0% bottom);
  //                 flat translucent fallback before the chartArea exists.
  //   _m1AreaFill — scriptable backgroundColor that re-resolves the gradient
  //                 against the real chartArea after the first paint.
  //   _m1Merge    — small deep-merge (objects only; arrays / fns replace).
  //   _m1Axis     — polished per-scale defaults (grid / ticks / title).
  //   _m1Line     — polished line/area dataset defaults.
  //   _m1Base     — shared base options, deep-merged with per-chart `extra`.
  // ─────────────────────────────────────────────────────────────────
  var M1PALETTE = {
    primary: '#2563eb',   // blue    — pitch θ, dT, primary series
    amber:   '#f59e0b',   // amber   — dQ, amber series / 75% ref line
    emerald: '#10b981',   // emerald — chord, emerald series
    danger:  '#ef4444',   // red     — stall threshold
    violet:  '#8b5cf6'    // violet  — spare role
  };

  function _m1Rgba(hex, a) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (!isFinite(n)) return 'rgba(100,116,139,' + a + ')';
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  // Vertical fill gradient for a hex line colour. `area` is the Chart.js
  // chartArea when available; before first paint we fall back to the full canvas
  // height, and to a flat translucent rgba fill if nothing is ready yet.
  function _m1Grad(ctx, hexColor, area) {
    if (!ctx || typeof ctx.createLinearGradient !== 'function') return _m1Rgba(hexColor, 0.12);
    var top = area ? area.top : 0;
    var bot = area ? area.bottom : (ctx.canvas ? ctx.canvas.height : 0);
    if (!(bot > top)) return _m1Rgba(hexColor, 0.12);          // not ready → translucent fallback
    var g = ctx.createLinearGradient(0, top, 0, bot);
    g.addColorStop(0, _m1Rgba(hexColor, 0.28));
    g.addColorStop(1, _m1Rgba(hexColor, 0.0));
    return g;
  }

  // Scriptable backgroundColor: re-resolves the gradient with the real chartArea
  // each paint (graceful translucent fallback before it exists).
  function _m1AreaFill(hexColor) {
    return function (c) {
      var chart = c && c.chart;
      if (!chart) return _m1Rgba(hexColor, 0.12);
      return _m1Grad(chart.ctx, hexColor, chart.chartArea);
    };
  }

  function _m1IsObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

  // Deep-merge plain objects (arrays / functions / scalars replace, not merge).
  function _m1Merge(base, extra) {
    if (!_m1IsObj(extra)) return (extra === undefined ? base : extra);
    var out = _m1IsObj(base) ? Object.assign({}, base) : {};
    Object.keys(extra).forEach(function (k) {
      out[k] = (_m1IsObj(out[k]) && _m1IsObj(extra[k])) ? _m1Merge(out[k], extra[k]) : extra[k];
    });
    return out;
  }

  // Polished per-axis defaults; `extra` (type / min / max / position / title /
  // a special grid.color callback …) is deep-merged over these. `border.display:false`
  // realises the borderless look on Chart.js v4 (where it lives on `border`).
  function _m1Axis(extra) {
    return _m1Merge({
      grid:   { color: 'rgba(148,163,184,0.16)', drawBorder: false },
      border: { display: false },
      ticks:  { color: '#64748b', font: { size: 9, family: 'JetBrains Mono' } },
      title:  { color: '#475569', font: { size: 10, weight: '600' } }
    }, extra || {});
  }

  // Polished line/area dataset; `color` drives the line + hover-point colour (and,
  // when `fill:true` is supplied via `extra`, the gradient backgroundColor).
  function _m1Line(color, extra) {
    return _m1Merge({
      borderColor: color,
      backgroundColor: color,
      pointBackgroundColor: color,
      borderWidth: 2.5,
      tension: 0.38,
      pointRadius: 0,
      pointHoverRadius: 5,
      pointHoverBorderWidth: 2,
      fill: false,
      clip: false
    }, extra || {});
  }

  // Shared base chart options; `extra` (scales / plugins overrides) deep-merged over.
  function _m1Base(extra) {
    return _m1Merge({
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 650, easing: 'easeOutQuart' },
      resizeDelay: 120,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { usePointStyle: true, boxWidth: 8, boxHeight: 8, font: { size: 10 }, color: '#475569' } },
        tooltip: {
          backgroundColor: 'rgba(15,23,42,0.92)', padding: 8, cornerRadius: 6,
          titleColor: '#e2e8f0', bodyColor: '#e2e8f0',
          borderColor: 'rgba(148,163,184,0.3)', borderWidth: 1,
          displayColors: true, usePointStyle: true
        }
      }
    }, extra || {});
  }

  function _el(id) { return document.getElementById(id); }

  function _setText(id, val) {
    var el = _el(id);
    if (el) el.textContent = val;
  }

  function switchTab(n) {
    if (window.SFX) window.SFX.click();
    document.querySelectorAll('.vp-tab').forEach(function(btn) {
      var isActive = parseInt(btn.dataset.tab) === n;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    // Left panel groups
    var pg = _el('propGeomGroup');
    var t2 = _el('tab2ControlGroup');
    if (n === 1) {
      if (pg) pg.classList.remove('hidden');
      if (t2) t2.classList.add('hidden');
    } else {
      if (pg) pg.classList.add('hidden');
      if (t2) t2.classList.remove('hidden');
    }

    // Centre panel sections
    var pts = _el('pitchTwistSection');
    var bes = _el('bladeElementSection');
    if (n === 1) {
      if (pts) pts.classList.remove('hidden');
      if (bes) bes.classList.add('hidden');
    } else {
      if (pts) pts.classList.add('hidden');
      if (bes) bes.classList.remove('hidden');
    }

    // Right panel sections
    var psc = _el('propSummaryCards');
    var cds = _el('chordDistSection');
    var acs = _el('airfoilChartsSection');
    var brs = _el('bemtResultsSection');
    var hud = _el('analysisHud');
    if (n === 1) {
      if (psc) psc.classList.remove('hidden');
      if (cds) cds.classList.remove('hidden');
      if (acs) acs.classList.add('hidden');
      if (brs) brs.classList.add('hidden');
      if (hud) hud.classList.add('hidden');
    } else {
      if (psc) psc.classList.add('hidden');
      if (cds) cds.classList.add('hidden');
      if (acs) acs.classList.remove('hidden');
      if (brs) brs.classList.remove('hidden');
      if (hud) hud.classList.remove('hidden');
    }

    // "Proceed to Module 2" — revealed + enabled on Tab 2 (Airfoil Analysis).
    // Clicking hands off the current propeller geometry (Module 2 reads
    // vlabExp3M1_propDef, falling back to a default prop if absent) and then
    // navigates to Module 2. onclick is idempotent across tab switches.
    var nextBtn = _el('btnNextModule');
    if (nextBtn) {
      nextBtn.classList.toggle('hidden', n === 1);
      if (n === 2) {
        nextBtn.disabled = false;
        nextBtn.onclick = function () {
          try {
            var st = (window.VLAB && window.VLAB.state) || null;
            if (st) {
              localStorage.setItem('vlabExp3M1_propDef', JSON.stringify({
                N: st.N, D_in: st.D_in,
                theta_root_deg: st.theta_root_deg, theta_tip_deg: st.theta_tip_deg,
                c_root_mm: st.c_root_mm, c_tip_mm: st.c_tip_mm,
                airfoil: st.airfoil, material: st.material
              }));
            }
          } catch (e) { /* localStorage unavailable — proceed regardless */ }
          window.location.href = 'index2.html';
        };
      }
    }
  }

  function renderPitchTwistChart(propDef) {
    if (_pitchTwistChart) { _pitchTwistChart.destroy(); _pitchTwistChart = null; }
    var canvas = _el('pitchTwistChart');
    if (!canvas) return;

    var labels = [], data = [];
    for (var i = 0; i <= 10; i++) {
      var t = i / 10;
      labels.push(t.toFixed(2));
      data.push(propDef.theta_root_deg + (propDef.theta_tip_deg - propDef.theta_root_deg) * t);
    }

    _pitchTwistChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [_m1Line(M1PALETTE.primary, {
          label: 'Pitch θ (°)',
          data: data,
          fill: true,
          backgroundColor: _m1AreaFill(M1PALETTE.primary)
        })]
      },
      options: _m1Base({
        plugins: {
          legend: { display: false },
          annotation: {
            annotations: {
              ref75: {
                type: 'line',
                // x-axis is categorical (11 labels: '0.00'..'1.00' = indices 0..10).
                // r/R = 0.75 is NOT one of those labels, so a string '0.75' resolves to
                // index -1 and never draws. Use the fractional category index (0.75 * 10).
                xMin: 7.5, xMax: 7.5,
                borderColor: M1PALETTE.amber,
                borderWidth: 2,
                borderDash: [4, 4],
                label: { content: '75%', display: true, position: 'end', color: M1PALETTE.amber, font: { size: 9 } }
              }
            }
          }
        },
        scales: {
          x: _m1Axis({ title: { display: true, text: 'Span Station r/R' } }),
          y: _m1Axis({ title: { display: true, text: 'Pitch Angle θ (°)' } })
        }
      })
    });
  }

  function renderChordDistChart(propDef) {
    if (_chordDistChart) { _chordDistChart.destroy(); _chordDistChart = null; }
    var canvas = _el('chordDistChart');
    if (!canvas) return;

    var labels = [], data = [];
    for (var i = 0; i <= 10; i++) {
      var t = i / 10;
      labels.push(t.toFixed(2));
      data.push(propDef.c_root_mm + (propDef.c_tip_mm - propDef.c_root_mm) * t);
    }

    _chordDistChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [_m1Line(M1PALETTE.emerald, {
          label: 'Chord (mm)',
          data: data,
          fill: true,
          backgroundColor: _m1AreaFill(M1PALETTE.emerald)
        })]
      },
      options: _m1Base({
        plugins: { legend: { display: false } },
        scales: {
          x: _m1Axis({ title: { display: true, text: 'Span Station r/R' } }),
          y: _m1Axis({ title: { display: true, text: 'Chord (mm)' } })
        }
      })
    });
  }

  function renderClAlphaChart(airfoils, selectedId, currentAlpha) {
    if (_clAlphaChart) { _clAlphaChart.destroy(); _clAlphaChart = null; }
    var canvas = _el('clAlphaChart');
    if (!canvas) return;

    var labels = [];
    for (var a = -5; a <= 20; a += 0.5) labels.push(a.toFixed(1));

    var datasets = airfoils.map(function(af, idx) {
      var isSelected = af.id === selectedId;
      var color = AIRFOIL_COLORS[idx % AIRFOIL_COLORS.length];
      var data = labels.map(function(lbl) { return Calc.airfoilClFiniteWing(parseFloat(lbl), af); });
      return _m1Line(color, {
        label: af.name,
        data: data,
        // selected-airfoil emphasis: thicker + fully opaque; others thinner + translucent
        borderColor: isSelected ? color : _m1Rgba(color, 0.55),
        borderWidth: isSelected ? 3 : 1.5,
        fill: false
      });
    });

    // Override C6: overlay the PDF's thin-airfoil line Cl = 2π(α−α₀) for the
    // selected profile (dashed) so the divergence past stall is visible — the
    // realistic curve breaks at stall while thin-airfoil theory keeps climbing.
    var selAf = null;
    for (var si = 0; si < airfoils.length; si++) { if (airfoils[si].id === selectedId) { selAf = airfoils[si]; break; } }
    if (selAf) {
      datasets.push(_m1Line('#64748b', {
        label: 'Thin-airfoil theory 2π(α−α₀)',
        data: labels.map(function(lbl) { return Calc.airfoilClThin(parseFloat(lbl), selAf); }),
        borderColor: '#94a3b8',
        borderWidth: 1.5,
        borderDash: [6, 4],
        fill: false,
        pointRadius: 0
      }));
    }

    _clAlphaChart = new Chart(canvas, {
      type: 'line',
      data: { labels: labels, datasets: datasets },
      options: _m1Base({
        plugins: {
          legend: { position: 'top' }
        },
        scales: {
          x: _m1Axis({ title: { display: true, text: 'α (°)' } }),
          y: _m1Axis({
            title: { display: true, text: 'Cl' },
            min: -1.0, max: 2.0,
            grid: {
              // Preserve the Cl = 0 axis highlight; fall back to the polished grid tint elsewhere.
              color: function(ctx) {
                if (ctx.tick && Math.abs(ctx.tick.value) < 0.001) return '#94a3b8';
                return 'rgba(148,163,184,0.16)';
              }
            }
          })
        }
      })
    });
  }

  function renderDragPolarChart(airfoils, selectedId, currentCl) {
    if (_dragPolarChart) { _dragPolarChart.destroy(); _dragPolarChart = null; }
    var canvas = _el('dragPolarChart');
    if (!canvas) return;

    var labels = [];
    for (var c = -1; c <= 2; c += 0.075) labels.push(c.toFixed(3));

    var datasets = airfoils.map(function(af, idx) {
      var isSelected = af.id === selectedId;
      var color = AIRFOIL_COLORS[idx % AIRFOIL_COLORS.length];
      var data = labels.map(function(lbl) {
        var cl = parseFloat(lbl);
        return Calc.airfoilCd(cl, 0, af);
      });
      var ds = _m1Line(color, {
        label: af.name,
        data: data,
        borderColor: isSelected ? color : _m1Rgba(color, 0.55),
        borderWidth: isSelected ? 3 : 1.5,
        fill: false
      });
      if (isSelected) {
        var dotIdx = labels.findIndex(function(l) { return Math.abs(parseFloat(l) - currentCl) < 0.04; });
        if (dotIdx < 0) dotIdx = 0;
        var ptRadii = labels.map(function(_, i) { return i === dotIdx ? 5 : 0; });
        ds.pointRadius = ptRadii;
        ds.pointBackgroundColor = color;
      }
      return ds;
    });

    _dragPolarChart = new Chart(canvas, {
      type: 'line',
      data: { labels: labels, datasets: datasets },
      options: _m1Base({
        plugins: { legend: { position: 'top' } },
        scales: {
          x: _m1Axis({ title: { display: true, text: 'Cl' } }),
          y: _m1Axis({ title: { display: true, text: 'Cd' }, min: 0, max: 0.12 })
        }
      })
    });
  }

  function renderEfficiencyChart(airfoils, selectedId, currentAlpha) {
    if (_efficiencyChart) { _efficiencyChart.destroy(); _efficiencyChart = null; }
    var canvas = _el('efficiencyChart');
    if (!canvas) return;

    var labels = [];
    for (var a = -5; a <= 20; a += 0.5) labels.push(a.toFixed(1));

    var datasets = airfoils.map(function(af, idx) {
      var isSelected = af.id === selectedId;
      var color = AIRFOIL_COLORS[idx % AIRFOIL_COLORS.length];
      var ldValues = labels.map(function(lbl) { return Calc.liftToDragFiniteWing(parseFloat(lbl), af); });
      var ds = _m1Line(color, {
        label: af.name,
        data: ldValues,
        borderColor: isSelected ? color : _m1Rgba(color, 0.55),
        borderWidth: isSelected ? 3 : 1.5,
        fill: false
      });
      if (isSelected) {
        var maxLd = -Infinity, maxIdx = 0;
        ldValues.forEach(function(v, i) { if (v > maxLd) { maxLd = v; maxIdx = i; } });
        var ptRadii = ldValues.map(function(_, i) { return i === maxIdx ? 6 : 0; });
        ds.pointRadius = ptRadii;
        ds.pointStyle = ldValues.map(function(_, i) { return i === maxIdx ? 'star' : 'circle'; });
        ds.pointBackgroundColor = color;
      }
      return ds;
    });

    _efficiencyChart = new Chart(canvas, {
      type: 'line',
      data: { labels: labels, datasets: datasets },
      options: _m1Base({
        plugins: { legend: { position: 'top' } },
        scales: {
          x: _m1Axis({ title: { display: true, text: 'α (°)' } }),
          y: _m1Axis({ title: { display: true, text: 'L/D' }, min: -20, max: 120 })
        }
      })
    });
  }

  function renderLocalAoaChart(elementData, stallAngle) {
    if (_localAoaChart) { _localAoaChart.destroy(); _localAoaChart = null; }
    var canvas = _el('localAoaChart');
    if (!canvas) return;

    var labels = elementData.map(function(el) { return el.r_frac.toFixed(2); });
    var data   = elementData.map(function(el) { return el.alpha_deg; });
    var bgColors = elementData.map(function(el) {
      if (el.stalled) return 'rgba(239,68,68,0.8)';
      if (el.alpha_deg > stallAngle * 0.80) return 'rgba(245,158,11,0.8)';
      return 'rgba(34,197,94,0.8)';
    });

    _localAoaChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Local AoA (°)',
          data: data,
          backgroundColor: bgColors,
          borderColor: bgColors.map(function(c) { return c.replace('0.8', '1'); }),
          borderWidth: 1,
          borderRadius: 3,
          borderSkipped: false
        }]
      },
      options: _m1Base({
        plugins: {
          legend: { display: false },
          annotation: {
            annotations: {
              stallLine: {
                type: 'line',
                yMin: stallAngle, yMax: stallAngle,
                borderColor: M1PALETTE.danger,
                borderWidth: 2,
                borderDash: [4, 4],
                label: { content: 'Stall ' + stallAngle + '°', display: true, position: 'end', color: M1PALETTE.danger, font: { size: 9 } }
              }
            }
          }
        },
        scales: {
          x: _m1Axis({ title: { display: true, text: 'r/R' } }),
          y: _m1Axis({ title: { display: true, text: 'α local (°)' } })
        }
      })
    });
  }

  function renderThrustDistChart(elementData) {
    if (_thrustDistChart) { _thrustDistChart.destroy(); _thrustDistChart = null; }
    var canvas = _el('thrustDistChart');
    if (!canvas) return;

    var labels = elementData.map(function(el) { return el.r_frac.toFixed(2); });

    _thrustDistChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          _m1Line(M1PALETTE.primary, {
            label: 'dT (N)',
            data: elementData.map(function(el) { return el.dT; }),
            yAxisID: 'yT',
            fill: false
          }),
          _m1Line(M1PALETTE.amber, {
            label: 'dQ (N·m)',
            data: elementData.map(function(el) { return el.dQ; }),
            yAxisID: 'yQ',
            fill: false
          })
        ]
      },
      options: _m1Base({
        plugins: { legend: { position: 'top' } },
        scales: {
          x:  _m1Axis({ title: { display: true, text: 'r/R' } }),
          yT: _m1Axis({ type: 'linear', position: 'left',  title: { display: true, text: 'dT (N)' } }),
          yQ: _m1Axis({ type: 'linear', position: 'right', title: { display: true, text: 'dQ (N·m)' }, grid: { drawOnChartArea: false } })
        }
      })
    });
  }

  function updateHud(cl, cd, ld, meanRe, anyStalled) {
    _setText('hudCl', isNaN(cl) ? '—' : cl.toFixed(3));
    _setText('hudCd', isNaN(cd) ? '—' : cd.toFixed(5));
    _setText('hudLd', isNaN(ld) ? '—' : ld.toFixed(1));
    _setText('hudRe', isNaN(meanRe) ? '—' : Math.round(meanRe).toLocaleString('en-US', { maximumFractionDigits: 0 }));
    var stallEl = _el('hudStall');
    if (stallEl) {
      stallEl.textContent = anyStalled ? 'STALL' : 'CLEAN';
      stallEl.classList.toggle('hud-stall-warn', !!anyStalled);
      stallEl.classList.toggle('hud-stall-clean', !anyStalled);
    }
  }

  function updateGeomCards(propDef) {
    _setText('valSolidity',    isNaN(propDef.sigma)      ? '—' : propDef.sigma.toFixed(4));
    _setText('valPitchRatio',  isNaN(propDef.pitchRatio) ? '—' : propDef.pitchRatio.toFixed(3));
    _setText('valAspectRatio', isNaN(propDef.AR)         ? '—' : propDef.AR.toFixed(2));
    _setText('valMeanChord',   isNaN(propDef.c_mean_m)   ? '—' : (propDef.c_mean_m * 1000).toFixed(1) + ' mm');
    _setText('valEstMass',     isNaN(propDef.mass_g)     ? '—' : propDef.mass_g.toFixed(2) + ' g');

    // Also update derivation box in left panel
    _setText('derivMeanChord',  isNaN(propDef.c_mean_m)   ? '—' : (propDef.c_mean_m * 1000).toFixed(1) + ' mm');
    _setText('derivSolidity',   isNaN(propDef.sigma)      ? '—' : propDef.sigma.toFixed(4));
    _setText('derivPitchRatio', isNaN(propDef.pitchRatio) ? '—' : propDef.pitchRatio.toFixed(3));
    _setText('derivAR',         isNaN(propDef.AR)         ? '—' : propDef.AR.toFixed(2));
    _setText('derivMass',       isNaN(propDef.mass_g)     ? '—' : propDef.mass_g.toFixed(2) + ' g');
  }

  function updateBemtCards(result) {
    if (!result) {
      ['bemtThrust','bemtTorque','bemtCt','bemtCq','bemtEta','bemtJ','bemtFOM'].forEach(function(id) {
        _setText(id, '—');
      });
      return;
    }
    _setText('bemtThrust', isNaN(result.T)   ? '—' : result.T.toFixed(3) + ' N');
    _setText('bemtTorque', isNaN(result.Q)   ? '—' : result.Q.toFixed(4) + ' N·m');
    _setText('bemtCt',     isNaN(result.Ct)  ? '—' : result.Ct.toFixed(5));
    _setText('bemtCq',     isNaN(result.Cq)  ? '—' : result.Cq.toFixed(5));
    _setText('bemtEta',    isNaN(result.eta) ? '—' : result.eta.toFixed(1) + '%');
    _setText('bemtJ',      isNaN(result.J)   ? '—' : result.J.toFixed(3));
    _setText('bemtFOM',    isNaN(result.FoM) ? '—' : result.FoM.toFixed(3));
  }

  function updateDerivPanel(el75, propDef, result) {
    if (!el75 || !propDef || !result) return;
    _setText('calcVrel',       isNaN(el75.V_rel)      ? '—' : el75.V_rel.toFixed(3) + ' m/s');
    _setText('calcPhi',        isNaN(el75.phi_deg)    ? '—' : el75.phi_deg.toFixed(2) + '°');
    _setText('calcAlphaLocal', isNaN(el75.alpha_deg)  ? '—' : el75.alpha_deg.toFixed(2) + '°');
    _setText('calcClLocal',    isNaN(el75.cl)         ? '—' : el75.cl.toFixed(4));
    _setText('calcDT',         isNaN(el75.dT)         ? '—' : el75.dT.toFixed(4) + ' N');
    _setText('calcCtEval',     isNaN(result.Ct)       ? '—' : 'Ct = T/(ρn²D⁴) = ' + result.Ct.toFixed(5));
  }

  function setChecklistItem(id, done, valText) {
    var item = _el(id);
    if (!item) return;
    var icon  = item.querySelector('.chk-icon');
    var valEl = item.querySelector('.checklist-val');
    if (icon) {
      icon.classList.toggle('pending', !done);
      icon.classList.toggle('done',    done);
      icon.textContent = done ? '\u2713' : '';   // ✓ tick mark when complete
    }
    if (valEl && valText !== undefined) valEl.textContent = valText;
  }

  function setCommentary(text) {
    if (window.Instructor) { window.Instructor.say(text); return; }
    var el = _el('liveCommentaryText');
    if (el) el.innerHTML = text;
  }

  // ── Live AoA diagram: airfoil section tilted to current α, with flow + lift/drag vectors ──
  function _afY(x, m, p, tc, surface) {
    var yt = 5 * tc * (0.2969 * Math.sqrt(x) - 0.1260 * x - 0.3516 * x * x
                       + 0.2843 * x * x * x - 0.1015 * x * x * x * x);
    var yc, dyc;
    if (m === 0) { yc = 0; dyc = 0; }
    else if (x < p) { yc = (m / (p * p)) * (2 * p * x - x * x); dyc = (2 * m / (p * p)) * (p - x); }
    else { yc = (m / ((1 - p) * (1 - p))) * ((1 - 2 * p) + 2 * p * x - x * x); dyc = (2 * m / ((1 - p) * (1 - p))) * (p - x); }
    var th = Math.atan(dyc);
    return surface === 'u'
      ? [x - yt * Math.sin(th), yc + yt * Math.cos(th)]
      : [x + yt * Math.sin(th), yc - yt * Math.cos(th)];
  }

  function _arrow(ctx, x1, y1, x2, y2, col, w) {
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = w || 1.5;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    var ang = Math.atan2(y2 - y1, x2 - x1), hl = 6;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - hl * Math.cos(ang - 0.4), y2 - hl * Math.sin(ang - 0.4));
    ctx.lineTo(x2 - hl * Math.cos(ang + 0.4), y2 - hl * Math.sin(ang + 0.4));
    ctx.closePath(); ctx.fill();
  }

  // ── Live animated AoA diagram: flowing streamlines around the tilted airfoil section ──
  var _aoaState = null, _aoaPhase = 0, _aoaLast = 0, _aoaRAF = null;

  // Public entry: store latest state and ensure the animation loop is running.
  function drawAoaDiagram(alpha, airfoil, cl, cd, stalled) {
    _aoaState = { alpha: alpha, airfoil: airfoil, cl: cl, cd: cd, stalled: stalled };
    if (!_aoaRAF) {
      _aoaLast = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      _aoaRAF = requestAnimationFrame(_aoaLoop);
    }
  }

  function _aoaLoop(t) {
    _aoaRAF = requestAnimationFrame(_aoaLoop);
    var dt = Math.min(0.05, (t - _aoaLast) / 1000); _aoaLast = t;
    var cv = _el('aoaDiagram');
    if (!cv || !cv.getContext || !_aoaState) return;
    if (cv.offsetParent === null) return;          // hidden (not on Tab 2) → skip drawing
    _aoaPhase += dt;                               // seconds, used to scroll the flow
    _renderAoa(cv, _aoaState, _aoaPhase);
  }

  function _renderAoa(cv, st, phase) {
    var alpha = st.alpha, airfoil = st.airfoil, cl = st.cl, cd = st.cd, stalled = st.stalled;
    var ctx = cv.getContext('2d');
    var W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#f8fafc'; ctx.fillRect(0, 0, W, H);

    var cx = W * 0.50, cy = H * 0.52, chordPx = Math.min(150, W * 0.55);
    var m = (airfoil.camber || 0) / 100, p = 0.40, tc = 0.12;
    var clp = Math.max(0, cl);

    // Build airfoil outline transformed by AoA (quarter-chord pivot)
    var N = 22, up = [], lo = [];
    for (var k = 0; k <= N; k++) {
      var xx = 0.5 * (1 - Math.cos(Math.PI * k / N));
      up.push(_afY(xx, m, p, tc, 'u'));
      lo.push(_afY(xx, m, p, tc, 'l'));
    }
    var a = -alpha * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    function tx(px, py) {
      var X = (px - 0.25) * chordPx, Y = -py * chordPx;
      return [cx + (X * ca - Y * sa), cy + (X * sa + Y * ca)];
    }

    // ── Animated streamlines (flow left → right, bending around the section) ──
    var nLines = 9;
    var dash = 9, gap = 7, period = dash + gap;
    var scroll = (phase * 90) % period;            // px/s scroll speed
    for (var li = 0; li < nLines; li++) {
      var y0 = 12 + li * (H - 24) / (nLines - 1);
      var above = y0 < cy;
      ctx.strokeStyle = stalled ? 'rgba(220,38,38,0.55)' : 'rgba(14,165,233,0.7)';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([dash, gap]);
      ctx.lineDashOffset = -scroll;                // animate the dashes flowing
      ctx.beginPath();
      var started = false;
      for (var x = 0; x <= W; x += 4) {
        // deflection bump near the airfoil; upper side deflects more (suction)
        var d = (x - cx) / (chordPx * 0.75);
        var bump = Math.exp(-d * d);
        var amp = (6 + clp * 9) * bump * (above ? 1.0 : 0.55);
        var y = y0 + (above ? -amp : amp);
        // turbulent separation behind a stalled upper surface
        if (stalled && above && x > cx) {
          var tw = Math.min(1, (x - cx) / (chordPx * 0.6));
          y += Math.sin(x * 0.35 - phase * 7 + li) * 5 * tw;
        }
        if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;

    // ── Airfoil section on top ──
    ctx.beginPath();
    var q0 = tx(up[0][0], up[0][1]); ctx.moveTo(q0[0], q0[1]);
    for (var i = 1; i <= N; i++) { var pu = tx(up[i][0], up[i][1]); ctx.lineTo(pu[0], pu[1]); }
    for (var j = N; j >= 0; j--) { var pl = tx(lo[j][0], lo[j][1]); ctx.lineTo(pl[0], pl[1]); }
    ctx.closePath();
    ctx.fillStyle = stalled ? 'rgba(239,68,68,0.9)' : 'rgba(37,99,235,0.9)';
    ctx.fill();
    ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 1; ctx.stroke();

    // ── Lift & drag vectors ──
    var Lpx = clp * 34;
    if (Lpx > 2) { _arrow(ctx, cx, cy, cx, cy - Lpx, '#16a34a', 2); ctx.fillStyle = '#16a34a'; ctx.font = '10px Inter'; ctx.fillText('Lift', cx + 4, cy - Lpx + 4); }
    var Dpx = Math.min(60, cd * 420);
    if (Dpx > 2) { _arrow(ctx, cx, cy, cx + Dpx, cy, '#ea580c', 2); ctx.fillStyle = '#ea580c'; ctx.font = '10px Inter'; ctx.fillText('Drag', cx + Dpx - 4, cy + 14); }

    // ── Readouts ──
    if (stalled) { ctx.fillStyle = '#dc2626'; ctx.font = 'bold 11px Inter'; ctx.fillText('STALL', W - 50, 16); }
    ctx.fillStyle = '#111827'; ctx.font = 'bold 11px Inter';
    ctx.fillText('\u03B1 = ' + alpha.toFixed(1) + '\u00B0', 6, 14);
    ctx.font = '10px JetBrains Mono';
    ctx.fillStyle = '#374151';
    ctx.fillText('Cl ' + cl.toFixed(2) + '   Cd ' + cd.toFixed(3) + '   L/D ' + (cd > 0 ? (cl / cd).toFixed(1) : '0'), 6, H - 6);
  }

  return {
    switchTab: switchTab,
    renderPitchTwistChart: renderPitchTwistChart,
    renderChordDistChart:  renderChordDistChart,
    renderClAlphaChart:    renderClAlphaChart,
    renderDragPolarChart:  renderDragPolarChart,
    renderEfficiencyChart: renderEfficiencyChart,
    renderLocalAoaChart:   renderLocalAoaChart,
    renderThrustDistChart: renderThrustDistChart,
    updateHud:         updateHud,
    updateGeomCards:   updateGeomCards,
    updateBemtCards:   updateBemtCards,
    updateDerivPanel:  updateDerivPanel,
    setChecklistItem:  setChecklistItem,
    setCommentary:     setCommentary,
    drawAoaDiagram:    drawAoaDiagram,
    setRunButtonEnabled:  function(e) { var b = document.getElementById('btnRunAnalysis');  if (b) b.disabled = !e; },
    setNextButtonEnabled: function(e) { var b = document.getElementById('btnNextModule');   if (b) b.disabled = !e; }
  };
})();
window.UI = UI;

// ═══════════════════════════════════════════════════════════════════
// 6. VLAB IIFE — State Owner, DB Loader, Event Orchestrator
// ═══════════════════════════════════════════════════════════════════
const VLAB = (function () {
  'use strict';

  var _completionFired = false;

  var state = {
    db: null,

    // Tab 1 — Propeller geometry
    N: 2,
    D_in: 10,
    theta_root_deg: 28,
    theta_tip_deg: 8,
    c_root_mm: 30,
    c_tip_mm: 12,
    airfoil: null,
    material: null,
    propDef: null,

    // Tab 2 — Analysis controls
    alpha_deg: 4,
    rpm: 5000,
    altitude: 0,
    rho: 1.225,
    V_mps: 0,
    bemtResult: null,

    activeTab: 1,

    // Completion tracking
    stallObserved: false,
    rpmChanged: false,
    fomObserved: false,
    simRun: false,        // Run Simulation clicked at least once
    aoaChanged: false,    // AoA slider moved
    profiledAirfoils: {}, // {airfoilId: true} once stalled at least once while selected
    tab1Done: false,
    tab2Done: false,
    allDone: false
  };

  function init() {
    Scene.init();
    Calc.loadCatalog()
      .then(function(data) {
        state.db = data;
        _populateTiles();
        _selectDefaults();
        _loadHandoff();
        _bindEvents();
        _computeAndRender();
        if (window.VLABUi) window.VLABUi.mountBanner('vlBannerHost', { catalog: window.VLAB_CATALOG || state.db, currentExp: 'exp3' });
      })
      .catch(function(err) {
        console.error('DB load error:', err);
        var banner = document.getElementById('errorBanner');
        if (banner) banner.classList.remove('hidden');
        UI.setRunButtonEnabled(false);
      });
  }

  function _populateTiles() {
    buildSharedTileGrid('airfoilTilesContainer', state.db.naca_airfoils, {
      name: 'airfoil',
      idPrefix: 'af_',
      selectedIds: state.db.naca_airfoils[0].id,
      specF: function(af) { return '\u03B1\u2080=' + af.alpha_0_deg + '\u00B0 | Stall ' + af.stall_angle_deg + '\u00B0'; },
      onSelect: function(af) { state.airfoil = af; _computeAndRender(); }
    });
    buildSharedTileGrid('materialTilesContainer', state.db.blade_materials, {
      name: 'material',
      idPrefix: 'mat_',
      selectedIds: state.db.blade_materials[0].id,
      specF: function(m) { return m.density_kg_m3 + ' kg/m\u00B3'; },
      onSelect: function(m) { state.material = m; _computeAndRender(); }
    });
  }

  function _selectDefaults() {
    state.airfoil  = state.db.naca_airfoils[0];
    state.material = state.db.blade_materials[0];
    state.N            = 2;
    state.D_in         = 10;
    state.theta_root_deg = 28;
    state.theta_tip_deg  = 8;
    state.c_root_mm      = 30;
    state.c_tip_mm       = 12;

    // Mark first tiles as selected
    var firstAf  = document.querySelector('#airfoilTilesContainer .component-tile');
    var firstMat = document.querySelector('#materialTilesContainer .component-tile');
    if (firstAf)  firstAf.classList.add('selected');
    if (firstMat) firstMat.classList.add('selected');

    UI.setRunButtonEnabled(true);
  }

  // Read handoff data from the previous experiments (Propulsion → Frame → here) and
  // seed altitude + propeller diameter so the chain is continuous.
  function _loadHandoff() {
    var inherited = [];
    try {
      var m1 = JSON.parse(localStorage.getItem('vlabModule1'));
      if (m1) {
        if (typeof m1.alt === 'number') {
          state.altitude = Math.max(0, Math.min(3000, m1.alt));
          inherited.push('altitude ' + state.altitude + ' m');
        }
        if (m1.pId && state.db.propellers) {
          var prop = state.db.propellers.find(function(p) { return p.id === m1.pId; });
          if (prop && prop.diameter_in) {
            state.D_in = Math.max(5, Math.min(17, prop.diameter_in));
            inherited.push('Ø ' + state.D_in + 'in (' + (prop.label || prop.id) + ')');
          }
        }
      }
    } catch (e) {}
    try {
      var m2 = JSON.parse(localStorage.getItem('vlabModule2_final'));
      if (m2 && typeof m2.mass_g === 'number') {
        state.inheritedMassG = m2.mass_g;
        inherited.push('frame ' + Math.round(m2.mass_g) + ' g');
      }
    } catch (e) {}

    // Reflect inherited values into the sliders + density readout
    var ds = document.getElementById('diamSlider');
    if (ds) { ds.value = state.D_in; var dv = document.getElementById('diamVal'); if (dv) dv.textContent = state.D_in.toFixed(2) + ' in'; }
    var as = document.getElementById('altSlider');
    if (as) { as.value = state.altitude; var av = document.getElementById('altVal'); if (av) av.textContent = state.altitude + ' m'; }
    state.rho = Calc.airDensity(state.altitude);
    var dn = document.getElementById('densityValue');
    if (dn) dn.textContent = state.rho.toFixed(4) + ' kg/m\u00B3';

    _renderHandoffBadge(inherited);
  }

  function _renderHandoffBadge(inherited) {
    var badge = document.getElementById('handoffBadge');
    if (!badge) return;
    if (inherited && inherited.length) {
      badge.classList.remove('fallback');
      badge.innerHTML = '<strong>Inherited from previous experiments:</strong> ' + inherited.join(' &middot; ');
    } else {
      badge.classList.add('fallback');
      badge.textContent = 'Standalone session — using default propeller parameters.';
    }
  }

  function _bindEvents() {
    // Diameter slider
    var diamSlider = document.getElementById('diamSlider');
    if (diamSlider) {
      diamSlider.addEventListener('input', function() {
        state.D_in = parseFloat(this.value);
        var v = document.getElementById('diamVal');
        if (v) v.textContent = state.D_in.toFixed(2) + ' in';
        _computeAndRender();
      });
    }

    // Root pitch slider
    var rootPitchSlider = document.getElementById('rootPitchSlider');
    if (rootPitchSlider) {
      rootPitchSlider.addEventListener('input', function() {
        state.theta_root_deg = parseFloat(this.value);
        var v = document.getElementById('rootPitchVal');
        if (v) v.textContent = state.theta_root_deg.toFixed(2) + '\u00B0';
        _computeAndRender();
      });
    }

    // Tip pitch slider
    var tipPitchSlider = document.getElementById('tipPitchSlider');
    if (tipPitchSlider) {
      tipPitchSlider.addEventListener('input', function() {
        state.theta_tip_deg = parseFloat(this.value);
        var v = document.getElementById('tipPitchVal');
        if (v) v.textContent = state.theta_tip_deg.toFixed(2) + '\u00B0';
        _computeAndRender();
      });
    }

    // Root chord slider
    var rootChordSlider = document.getElementById('rootChordSlider');
    if (rootChordSlider) {
      rootChordSlider.addEventListener('input', function() {
        state.c_root_mm = parseFloat(this.value);
        var v = document.getElementById('rootChordVal');
        if (v) v.textContent = state.c_root_mm.toFixed(2) + ' mm';
        _computeAndRender();
      });
    }

    // Tip chord slider
    var tipChordSlider = document.getElementById('tipChordSlider');
    if (tipChordSlider) {
      tipChordSlider.addEventListener('input', function() {
        state.c_tip_mm = parseFloat(this.value);
        var v = document.getElementById('tipChordVal');
        if (v) v.textContent = state.c_tip_mm.toFixed(2) + ' mm';
        _computeAndRender();
      });
    }

    // AoA slider
    var aoaSlider = document.getElementById('aoaSlider');
    if (aoaSlider) {
      aoaSlider.addEventListener('input', function() {
        state.alpha_deg = parseFloat(this.value);
        state.aoaChanged = true;
        var v = document.getElementById('aoaVal');
        if (v) v.textContent = state.alpha_deg + '\u00B0';
        _computeAndRender();
      });
    }

    // RPM slider
    var rpmSlider = document.getElementById('rpmSlider');
    if (rpmSlider) {
      rpmSlider.addEventListener('input', function() {
        state.rpm = parseInt(this.value);
        state.rpmChanged = true;
        var v = document.getElementById('rpmVal');
        if (v) v.textContent = state.rpm;
        _computeAndRender();
      });
    }

    // Altitude slider
    var altSlider = document.getElementById('altSlider');
    if (altSlider) {
      altSlider.addEventListener('input', function() {
        state.altitude = parseInt(this.value);
        var v = document.getElementById('altVal');
        if (v) v.textContent = state.altitude + ' m';
        var rho = Calc.airDensity(state.altitude);
        state.rho = rho;
        var dv = document.getElementById('densityValue');
        if (dv) dv.textContent = rho.toFixed(4) + ' kg/m\u00B3';
        _computeAndRender();
      });
    }

    // Blade count buttons
    document.querySelectorAll('.blade-count-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        state.N = parseInt(this.dataset.n);
        document.querySelectorAll('.blade-count-btn').forEach(function(b) {
          b.classList.toggle('active', parseInt(b.dataset.n) === state.N);
          b.setAttribute('aria-pressed', parseInt(b.dataset.n) === state.N ? 'true' : 'false');
        });
        _computeAndRender();
      });
    });

    // Tab buttons
    document.querySelectorAll('.vp-tab').forEach(function(btn) {
      btn.addEventListener('click', function() {
        _switchTab(parseInt(this.dataset.tab));
      });
    });

    // Run Simulation button — starts spin + airflow
    var runBtn = document.getElementById('btnRunAnalysis');
    if (runBtn) {
      runBtn.addEventListener('click', function() {
        PropModel.setRunning(true);
        state.simRun = true;
        var note = document.getElementById('simNote');
        if (note) note.textContent = 'Simulation running — propeller spinning, airflow active.';
        _computeAndRender();
      });
    }

    // Reset button — stops simulation
    var resetBtn = document.getElementById('btnResetSim');
    if (resetBtn) {
      resetBtn.addEventListener('click', function() {
        PropModel.setRunning(false);
        var note = document.getElementById('simNote');
        if (note) note.textContent = 'Simulation stopped. Click Run Simulation to restart.';
      });
    }

    // Config panel collapse
    var panelTitle = document.getElementById('configPanelTitle');
    var configSections = document.getElementById('configSections');
    var chevron = document.getElementById('configPanelChevron');
    if (panelTitle && configSections) {
      panelTitle.addEventListener('click', function() {
        var isHidden = configSections.classList.toggle('hidden');
        if (chevron) chevron.style.transform = isHidden ? 'rotate(-90deg)' : 'rotate(0deg)';
      });
    }
  }

  function _switchTab(n) {
    state.activeTab = n;
    Scene.setTab(n);
    UI.switchTab(n);

    if (n === 2 && window.Instructor) window.Instructor.enterTab('intro_m1_airfoil');

    // Update propeller summary card when switching to Tab 2
    if (n === 2 && state.propDef) {
      var summN = document.getElementById('summN');
      var summD = document.getElementById('summD');
      var summAirfoil = document.getElementById('summAirfoil');
      var summMaterial = document.getElementById('summMaterial');
      if (summN) summN.textContent = state.N;
      if (summD) summD.textContent = state.D_in + ' in';
      if (summAirfoil && state.airfoil)  summAirfoil.textContent  = state.airfoil.name;
      if (summMaterial && state.material) summMaterial.textContent = state.material.label;
    }

    _computeAndRender();
  }

  function _computeAndRender() {
    if (!state.airfoil || !state.material) return;

    state.propDef = Calc.buildPropDef(state);
    _saveConfig();

    if (state.activeTab === 1) {
      PropModel.build(state.propDef);
      UI.renderPitchTwistChart(state.propDef);
      UI.renderChordDistChart(state.propDef);
      UI.updateGeomCards(state.propDef);
      UI.setCommentary(_commentaryTab1());
      _updateChecklist();
    } else {
      // Tab 2
      state.rho = Calc.airDensity(state.altitude);
      state.bemtResult = Calc.runBEMT(state.propDef, state.rpm, state.V_mps, state.rho);

      if (state.bemtResult) {
        PropModel.updateStallOverlay(state.bemtResult.elementData, state.airfoil);
        var v_h = state.bemtResult.v_h || 0;
        PropModel.setInflowConeScale(v_h);
      }

      var cl      = Calc.airfoilClFiniteWing(state.alpha_deg, state.airfoil);
      var cd      = Calc.airfoilCdFiniteWing(state.alpha_deg, state.airfoil);
      var ld      = cd > 0 ? cl / cd : 0;
      var meanRe  = state.bemtResult
        ? state.bemtResult.elementData.reduce(function(s, e) { return s + e.Re; }, 0) / state.bemtResult.elementData.length
        : 0;
      var anyStalled = state.bemtResult
        ? state.bemtResult.elementData.some(function(e) { return e.stalled; })
        : false;
      var alphaStalled = state.alpha_deg >= state.airfoil.stall_angle_deg;

      UI.updateHud(cl, cd, ld, meanRe, alphaStalled);
      UI.updateBemtCards(state.bemtResult || { T:0, Q:0, Ct:0, Cq:0, J:0, eta:0, FoM:0 });
      UI.drawAoaDiagram(state.alpha_deg, state.airfoil, cl, cd, alphaStalled);

      if (state.db && state.db.naca_airfoils) {
        UI.renderClAlphaChart(state.db.naca_airfoils, state.airfoil.id, state.alpha_deg);
        UI.renderDragPolarChart(state.db.naca_airfoils, state.airfoil.id, cl);
        UI.renderEfficiencyChart(state.db.naca_airfoils, state.airfoil.id, state.alpha_deg);
      }

      if (state.bemtResult) {
        UI.renderLocalAoaChart(state.bemtResult.elementData, state.airfoil.stall_angle_deg);
        UI.renderThrustDistChart(state.bemtResult.elementData);
        // The derivation panel is labelled "75% span". Stations map as r/R = 0.15 + (i/11)*0.85,
        // so r/R = 0.75 lands between stations; index 8 (r/R ≈ 0.768) is the closest, whereas the
        // previous index 9 was r/R ≈ 0.845 (~84.5% span) — inconsistent with the 75% label.
        var el75 = state.bemtResult.elementData[8] || state.bemtResult.elementData[state.bemtResult.elementData.length - 1];
        UI.updateDerivPanel(el75, state.propDef, state.bemtResult);
        if (state.bemtResult.FoM > 0) state.fomObserved = true;
      }
      // "Induce stall" = drive the section past its stall angle with the AoA slider.
      if (alphaStalled) {
        state.stallObserved = true;
        state.profiledAirfoils[state.airfoil.id] = true;
      }

      UI.setCommentary(_commentaryTab2(alphaStalled, state.bemtResult));
      _updateChecklist();
    }

    UI.setRunButtonEnabled(!!(state.airfoil && state.material));
  }

  // A propeller is "valid" if it has sensible, manufacturable geometry:
  // tapered chord (root ≥ tip), washout twist (root ≥ tip), and in-range diameter/blades.
  function _isPropValid() {
    return state.c_root_mm >= state.c_tip_mm
        && state.theta_root_deg >= state.theta_tip_deg
        && state.D_in >= 5 && state.D_in <= 17
        && state.N >= 2 && state.N <= 4;
  }

  // Persist the propeller configuration the user has built (kept current on every change).
  function _saveConfig() {
    if (!state.propDef) return;
    var cfg = {
      N: state.N,
      diameter_in: state.D_in,
      root_pitch_deg: state.theta_root_deg,
      tip_pitch_deg:  state.theta_tip_deg,
      root_chord_mm:  state.c_root_mm,
      tip_chord_mm:   state.c_tip_mm,
      airfoil_id:     state.airfoil ? state.airfoil.id : null,
      airfoil_name:   state.airfoil ? state.airfoil.name : null,
      material_id:    state.material ? state.material.id : null,
      material_label: state.material ? state.material.label : null,
      solidity:    +state.propDef.sigma.toFixed(4),
      pitch_ratio: +state.propDef.pitchRatio.toFixed(3),
      aspect_ratio:+state.propDef.AR.toFixed(2),
      mean_chord_mm:+(state.propDef.c_mean_m * 1000).toFixed(2),
      mass_g:      +state.propDef.mass_g.toFixed(2),
      rpm:         state.rpm,
      altitude_m:  state.altitude,
      valid:       _isPropValid(),
      complete:    state.allDone === true
    };
    try { localStorage.setItem('vlabExp3M1_propConfig', JSON.stringify(cfg)); } catch (e) {}
  }

  function _updateChecklist() {
    var propValid    = _isPropValid();
    var designDone   = propValid && state.simRun;
    var analysisDone = state.aoaChanged && state.rpmChanged && state.stallObserved;

    var designVal = designDone ? ('Valid \u2713 N=' + state.N + ', D=' + state.D_in + 'in')
                               : (!propValid ? 'Invalid geometry' : 'Click Run Simulation');
    var pend = [];
    if (!state.aoaChanged)   pend.push('vary AoA');
    if (!state.rpmChanged)   pend.push('vary RPM');
    if (!state.stallObserved) pend.push('induce stall');
    var analysisVal = analysisDone ? ('Analysed \u2713 Cl_max=' + state.airfoil.cl_max)
                                   : ('To do: ' + pend.join(', '));

    var allProfiled = state.db && state.db.naca_airfoils && state.db.naca_airfoils.length > 0 &&
      state.db.naca_airfoils.every(function (af) { return !!state.profiledAirfoils[af.id]; });
    var _findAf = function (id) { return (state.db && state.db.naca_airfoils) ? state.db.naca_airfoils.find(function (a) { return a.id === id; }) : null; };
    var af0012 = _findAf('naca_0012');
    var af4412 = _findAf('naca_4412');
    var camberOk = af0012 && af4412 && af4412.cl_max > af0012.cl_max;

    // Uniform objectives panel (shared VLABLab), matching Experiments 4-6; falls
    // back to the per-item checklist toggles when the kit is absent (tests).
    var container = document.getElementById('checklistContainer');
    if (window.VLABLab && container) {
      window.VLABLab.objectives(container, [
        { id: 'chkPropDesign', label: 'Propeller Design', test: function () { return designDone; },
          value: function () { return designVal; }, warn: function () { return state.simRun && !propValid; } },
        { id: 'chkAirfoilAnalysis', label: 'Airfoil Analysis', test: function () { return analysisDone; },
          value: function () { return analysisVal; } },
        {
          id: 'chkAllProfiled', label: 'Cl_max & stall angle recorded for all 3 airfoils',
          test: function () { return allProfiled; },
          value: function () { return Object.keys(state.profiledAirfoils).length + '/3'; }
        },
        {
          id: 'chkCamber', label: 'Observed: 4412 Cl_max > 0012 Cl_max',
          test: function () { return !!camberOk; },
          value: function () { return camberOk ? (af4412.cl_max.toFixed(2) + ' > ' + af0012.cl_max.toFixed(2)) : ''; }
        }
      ], state, { title: 'Module checklist' });
    } else {
      UI.setChecklistItem('chkPropDesign', designDone, designVal);
      UI.setChecklistItem('chkAirfoilAnalysis', analysisDone, analysisVal);
    }

    // Fault scenario (§5 #1 over-cambered blade) — forces the highest-camber
    // profile so the student sees higher Cl_max with visibly earlier stall.
    if (window.VLABLab && document.getElementById('scenarioHost')) {
      window.VLABLab.scenario('scenarioHost', {
        title: 'Fault scenario',
        current: state.activeScenario || 'none',
        options: [
          { id: 'none', label: 'No fault (normal)', desc: 'Pick any profile freely.' },
          { id: 'over_cambered', label: 'Over-cambered blade', desc: 'Forces NACA 4412 — higher Cl_max, visibly earlier stall.', fault: true }
        ],
        onSelect: function (id) {
          state.activeScenario = id;
          if (id === 'over_cambered' && state.db) {
            var af = (state.db.naca_airfoils || []).find(function (a) { return a.id === 'naca_4412'; });
            if (af) {
              state.airfoil = af;
              var input = document.getElementById('af_' + af.id);
              if (input) { input.checked = true; var tile = input.closest('.component-tile'); if (tile) { document.querySelectorAll('#airfoilTilesContainer .component-tile').forEach(function (t) { t.classList.remove('selected'); }); tile.classList.add('selected'); } }
            }
          }
          _computeAndRender();
        }
      });
    }

    state.allDone = designDone && analysisDone;
    UI.setNextButtonEnabled(state.allDone);

    if (state.allDone && !_completionFired) {
      _completionFired = true;
      localStorage.setItem('vlabExp3M1_complete', 'true');
      localStorage.setItem('vlabExp3M1_propDef', JSON.stringify(state.propDef));
      _saveConfig();   // re-save with complete:true
    }
  }

  function _commentaryTab1() {
    if (!state.propDef) return 'Configure your propeller geometry. Higher twist angle at the root improves hover efficiency.';
    if (state.N >= 3) {
      return 'More blades increase solidity and smooth torque delivery but add weight and drag.';
    }
    if (state.propDef.sigma > 0.15) {
      return 'High solidity propeller \u2014 good for heavy-lift but less efficient at cruise.';
    }
    if (state.propDef.pitchRatio > 1.2) {
      return 'High pitch ratio favours cruise speed over static thrust.';
    }
    if (state.c_root_mm / state.c_tip_mm > 3.5) {
      return 'Aggressive taper may cause tip stall at low RPM. Consider reducing taper.';
    }
    return 'Configure your propeller geometry. Higher twist angle at the root improves hover efficiency.';
  }

  function _commentaryTab2(anyStalled, result) {
    var allProfiled = state.db && state.db.naca_airfoils && state.db.naca_airfoils.length > 0 &&
      state.db.naca_airfoils.every(function(af) { return !!state.profiledAirfoils[af.id]; });
    if (allProfiled) {
      return 'GUIDE: All three airfoils profiled. Compare their Cl-max and stall angles in the checklist, then proceed to the wind tunnel module.';
    }
    if (!state.aoaChanged) {
      return 'GUIDE: Sweep the angle of attack slowly. Watch the lift curve climb linearly, then break — that break is the stall.';
    }
    if (anyStalled) {
      return 'OBSERVE: The blade has stalled. Flow has separated from the upper surface, lift collapses and drag spikes — the thin-airfoil line keeps climbing because the theory doesn’t know about separation.';
    }
    if (result && result.FoM < 0.5) {
      return 'Figure of Merit below 0.5 \u2014 the propeller hover efficiency is poor. Try increasing RPM or chord.';
    }
    var ld = Calc.liftToDrag(state.alpha_deg, state.airfoil);
    if (ld < 10) {
      return 'This angle of attack is far from optimal. The Cl/Cd curve peaks near \u03B1 = 4\u20136\u00B0 for cambered airfoils.';
    }
    if (result && result.J > 0.8) {
      return 'High advance ratio \u2014 the propeller is in efficient cruise regime.';
    }
    return 'Adjust RPM and AoA to explore how the blade sections respond. Watch for stall at the inner span.';
  }

  return {
    init: init,
    state: state
  };
})();
window.VLAB = VLAB;

// ═══════════════════════════════════════════════════════════════════
// 7. DOM Content Loaded Router
// ═══════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  if (window.Instructor) {
    window.Instructor.mountFloating();
    window.Instructor.initTtsToggle();
  }
  if (document.getElementById('frameDragGroup')) {        // index2.html (Module 2)
    if (window.VLAB2) VLAB2.init();
  } else if (document.getElementById('propGeomGroup')) {  // index.html (Module 1)
    if (window.VLAB) VLAB.init();
  }
});


/* ── Strict guided-build gate ────────────────────────────────────────────────
 * Exp 3 (aerodynamics) inherits its propeller + frame from Exp 1 (propulsion).
 * Until Exp 1 is finalized, show the prerequisite gate so the user completes the
 * upstream step first and this experiment analyses the real drone, not defaults.
 * ---------------------------------------------------------------------------*/
(function () {
  if (typeof window === 'undefined' || !window.VLABUi || !window.VLABUi.autoGate) return;
  function mount() { try { window.VLABUi.autoGate('exp3'); } catch (e) { /* gate optional */ } }
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
    var host = document.getElementById('canvasWrapper');
    if (!main || !host) return;
    var moved = tabs ? [tabs, host] : [host];
    var home = moved.map(function (el) { return { el: el, parent: el.parentElement, next: el.nextSibling }; });
    var pin = document.createElement('div');
    pin.className = 'vl-mobile-pin';
    var mq = window.matchMedia('(orientation: portrait), (max-width: 760px)');
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
