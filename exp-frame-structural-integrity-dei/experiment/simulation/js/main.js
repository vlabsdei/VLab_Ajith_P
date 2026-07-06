// ============================================================================
// Bundled prelude (constants -> catalog -> vlab-store -> validation -> vlab-ui -> vlab-lab)
// Consolidated from js/vendor/ into this single file per the one-js-file-per-experiment rule.
// ============================================================================

// ---- vendor/constants.js ----
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

// ---- vendor/catalog.js ----
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

// ---- vendor/vlab-store.js ----
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
      // paramHistory[field]: stack of prior values this shared component field
      // held before being overridden from a different experiment; paramOwner[field]:
      // which experiment set the CURRENT value. Only touched by setComponentValidated
      // / revertComponent — plain setComponents() never records history.
      paramHistory: {}, paramOwner: {},
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

    reset: function () { return save(emptyBuild()); },

    // ── validated override / revert history for fields shared across
    // experiments (currently frameId, batteryId — selectable from more than
    // one experiment's own UI) ──────────────────────────────────────────────
    /**
     * Attempt to write `value` into components[field]. `validateFn(candidateBuild)`
     * must return {ok:boolean, reason?:string} — called with a full clone of the
     * build with the change already applied, so it can run the real cross-exp
     * checks before anything is committed. Rejected writes leave the store
     * untouched. Accepted writes that actually change the value push the OLD
     * value onto paramHistory[field] and record `byExp` as the new owner.
     */
    setComponentValidated: function (field, value, byExp, validateFn) {
      const b = load();
      const prevValue = b.components[field];
      if (prevValue === value) return { ok: true, changed: false };
      const candidate = JSON.parse(JSON.stringify(b));
      candidate.components[field] = value;
      const verdict = validateFn ? validateFn(candidate) : { ok: true };
      if (!verdict.ok) return { ok: false, changed: false, reason: verdict.reason || 'Invalid selection.' };
      b.paramHistory = b.paramHistory || {};
      b.paramHistory[field] = b.paramHistory[field] || [];
      b.paramHistory[field].push({ value: prevValue, setBy: (b.paramOwner || {})[field] || null, ts: Date.now() });
      b.paramOwner = b.paramOwner || {};
      b.paramOwner[field] = byExp;
      b.components[field] = value;
      refreshStale(b);
      save(b);
      return { ok: true, changed: true };
    },

    /** Prior values for a shared field, most-recently-overwritten first. */
    getHistory: function (field) {
      const b = load();
      const h = (b.paramHistory && b.paramHistory[field]) || [];
      return h.slice().reverse();
    },

    /** Which experiment last set this shared field's current value (or null). */
    getOwner: function (field) {
      const b = load();
      return (b.paramOwner && b.paramOwner[field]) || null;
    },

    /**
     * Pop the most recent history entry for `field` and restore it as the
     * current value, still gated by `validateFn` (a prior value can become
     * invalid again if something ELSE changed in the meantime).
     */
    revertComponent: function (field, byExp, validateFn) {
      const b = load();
      const h = (b.paramHistory && b.paramHistory[field]) || [];
      if (!h.length) return { ok: false, reason: 'No previous value to revert to.' };
      const prev = h[h.length - 1];
      const candidate = JSON.parse(JSON.stringify(b));
      candidate.components[field] = prev.value;
      const verdict = validateFn ? validateFn(candidate) : { ok: true };
      if (!verdict.ok) return { ok: false, reason: verdict.reason || 'Reverting would break the current build.' };
      h.pop();
      b.paramOwner = b.paramOwner || {};
      b.paramOwner[field] = prev.setBy;
      b.components[field] = prev.value;
      refreshStale(b);
      save(b);
      return { ok: true, value: prev.value };
    }
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

// ---- vendor/validation.js ----
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

  const FIELD_LABELS = { frameId: 'Frame', batteryId: 'Battery' };
  const EXP_LABELS = { exp1: 'Experiment 1 (Propulsion System Design)', exp2: 'Experiment 2 (Frame & Structural Integrity)' };

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
   * authoritative source (e.g. Exp 2 picking its own frame/battery for CG
   * balancing), because validateCandidate checks against the LAST-FINALIZED
   * exp1/exp2 outputs, which were computed for the OLD value — for a field's
   * own owner this is stale by definition (the owner is about to recompute
   * fresh outputs for the NEW value right after this write, via its own
   * pipeline) and would otherwise cause spurious self-rejections. A
   * genuinely downstream experiment overriding a field it doesn't own must
   * still go through `trySet`, since it has no way to recompute the owner's
   * physics itself and the stale-but-fixed check is the best it can do.
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
          root.Instructor.show('<strong>Cannot revert:</strong> ' + (result.reason || 'unknown reason') + ' Section to revisit: fix the conflict first.');
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

// ---- vendor/vlab-ui.js ----
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

// ---- vendor/vlab-lab.js ----
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

// ============================================================================
// End bundled prelude — experiment-specific code below
// ============================================================================

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
}

/* Diagonal arm vectors for X quadcopter configuration */
const ARM_DIRECTIONS = [
  new THREE.Vector3( 1, 0, -1).normalize(), // Front-Right
  new THREE.Vector3(-1, 0, -1).normalize(), // Front-Left
  new THREE.Vector3( 1, 0,  1).normalize(), // Rear-Right
  new THREE.Vector3(-1, 0,  1).normalize()  // Rear-Left
];

const PROP_SIGNS = [1, -1, -1, 1];

function getPayloadBaseOffset(id, frame) {
  const bw = frame ? frame.body_size_mm[0] : 88;
  const bz = frame ? frame.body_size_mm[2] : 88;
  switch (id) {
    case 'gimbal_2axis':
    case 'gimbal_3axis':
      return { x: 0, y: bw * 0.22 };
    case 'camera_gopro':
      return { x: 0, y: bw * 0.32 };
    case 'camera_fpv_nano':
      return { x: 0, y: bw * 0.42 };
    case 'gps_m8n':
    case 'gps_m9n_compass':
      return { x: -bw * 0.2, y: -bz * 0.2 };
    case 'lidar_tfmini':
    case 'lidar_garmin':
      return { x: 0, y: 0 };
    case 'telemetry_915':
      return { x: bw * 0.4, y: 0 };
    case 'fpv_vtx':
      return { x: 0, y: -bz * 0.38 };
    default:
      return { x: 0, y: 0 };
  }
}

// ═══════════════════════════════════════════════════════════════════
// 1. PHYSICS & ENGINEERING CALCULATION IIFE
// ═══════════════════════════════════════════════════════════════════
const Calc = (function () {
  'use strict';

  const G_ACC = 9.80665; // standard gravitational acceleration m/s^2

  // Baseline avionics/hardware masses NOT covered by a selectable catalog
  // part in this experiment (FC/RX/GPS/PDB are shown as a fixed "Avionics
  // Stack" lump, and motor/ESC unit mass fall back to this when no real
  // selection is present yet). Was previously only present in db/db.json's
  // `fixed_weights` key and absent from VLAB_CATALOG — merged onto whatever
  // catalog loadCatalog() returns so both sources behave identically.
  const FIXED_WEIGHTS_G = Object.freeze({
    flight_controller_g: 15,
    receiver_g: 5,
    gps_module_g: 25,
    power_distribution_g: 20,
    motor_each_g: 35,
    esc_each_g: 15
  });

  return {
    g: G_ACC,

    solveCenterOfGravity: function (components) {
      let weightedSumX = 0;
      let weightedSumY = 0;
      let totalMass = 0;

      components.forEach(function (comp) {
        weightedSumX += comp.mass_g * comp.x_mm;
        weightedSumY += comp.mass_g * comp.y_mm;
        totalMass += comp.mass_g;
      });

      const x_cg = totalMass > 0 ? weightedSumX / totalMass : 0;
      const y_cg = totalMass > 0 ? weightedSumY / totalMass : 0;
      const offset = Math.sqrt(x_cg * x_cg + y_cg * y_cg);

      return {
        x_cg: x_cg,
        y_cg: y_cg,
        total_mass_g: totalMass,
        offset_mm: offset,
        sum_mx: weightedSumX,
        sum_my: weightedSumY
      };
    },

    solveHollowInertia: function (b_mm, h_mm, t_mm) {
      const b_out = b_mm / 1000;
      const h_out = h_mm / 1000;
      const b_in = (b_mm - 2.0 * t_mm) / 1000;
      const h_in = (h_mm - 2.0 * t_mm) / 1000;
      return (b_out * Math.pow(h_out, 3) - b_in * Math.pow(h_in, 3)) / 12.0;
    },

    solveBendingMoment: function (forceTip_n, armLength_mm) {
      const l = armLength_mm / 1000;
      return forceTip_n * l;
    },

    solveBendingMomentAtX: function (forceTip_n, x_mm, armLength_mm) {
      const x = x_mm / 1000;
      const L = armLength_mm / 1000;
      if (x > L) return 0;
      return forceTip_n * (L - x);
    },

    solveShearForce: function (forceTip_n) {
      return -forceTip_n;
    },

    solveBendingStress: function (moment_nm, h_mm, inertia_m4) {
      if (inertia_m4 === 0) return 0;
      const c = (h_mm / 2.0) / 1000;
      const stressPascal = (moment_nm * c) / inertia_m4;
      return stressPascal / 1e6; // to MPa
    },

    solveSafetyFactor: function (yieldStrength_mpa, appliedStress_mpa) {
      if (appliedStress_mpa <= 0) return 99.0;
      return yieldStrength_mpa / appliedStress_mpa;
    },

    solveDeflectionAtX: function (forceTip_n, x_mm, armLength_mm, youngsModulus_gpa, inertia_m4) {
      const x = x_mm / 1000;
      const L = armLength_mm / 1000;
      const E = youngsModulus_gpa * 1e9;
      const I = inertia_m4;

      if (x > L || E * I === 0) return 0;
      return (forceTip_n * x * x * (3.0 * L - x)) / (6.0 * E * I);
    },

    solveTipForce: function (motorMass_g, propMass_g, T_max_n) {
      const gravityForce = ((motorMass_g + propMass_g) / 1000) * G_ACC;
      return {
        gravity_n: gravityForce,
        thrust_n: T_max_n,
        total_n: gravityForce + T_max_n,
        gravity_pct: gravityForce / (gravityForce + T_max_n) * 100,
        thrust_pct: T_max_n / (gravityForce + T_max_n) * 100
      };
    },

    solvePerMotorThrust: function (totalMass_g, x_cg, y_cg, armLen_mm) {
      const T_hover = (totalMass_g / 1000) * G_ACC;
      const d = armLen_mm * Math.cos(Math.PI / 4);
      const w_FR = 0.25 * (1 + x_cg / d + y_cg / d);
      const w_FL = 0.25 * (1 - x_cg / d + y_cg / d);
      const w_RR = 0.25 * (1 + x_cg / d - y_cg / d);
      const w_RL = 0.25 * (1 - x_cg / d - y_cg / d);
      return {
        FR: w_FR * T_hover,
        FL: w_FL * T_hover,
        RR: w_RR * T_hover,
        RL: w_RL * T_hover,
        shares: { FR: w_FR, FL: w_FL, RR: w_RR, RL: w_RL },
        max_thrust_n: Math.max(w_FR, w_FL, w_RR, w_RL) * T_hover,
        imbalance_pct: (Math.max(w_FR, w_FL, w_RR, w_RL) - 0.25) / 0.25 * 100
      };
    },

    solveSectionModulus: function (inertia_m4, h_mm) {
      if (h_mm === 0) return 0;
      return inertia_m4 / (h_mm / 2.0 / 1000);
    },

    solveStrainEnergy: function (F, L_mm, E_gpa, I) {
      const L = L_mm / 1000;
      const E = E_gpa * 1e9;
      if (E * I === 0) return 0;
      return (F * F * L * L * L) / (6 * E * I);
    },

    // ── Real-world structural additions (spec §3.2) ─────────────────────────
    // Dynamic safety factor: the static tip force is optimistic. A maneuver /
    // vibration load factor n_dyn (1.0-3.0, default 1.5) amplifies the applied
    // stress: SF_dyn = sigma_yield / (n_dyn * sigma_static).
    solveDynamicSafetyFactor: function (yieldStrength_mpa, appliedStress_mpa, nDyn) {
      const n = (nDyn && nDyn > 0) ? nDyn : 1.5;
      const s = appliedStress_mpa * n;
      if (s <= 0) return 99.0;
      return yieldStrength_mpa / s;
    },

    // First cantilever bending mode [Hz]:
    //   f_n = (beta1^2 / 2*pi) * sqrt(E*I / (m' * L^4))
    // with m' the linear mass density of the hollow tube (rho * area) and
    // beta1 = 1.875 (fixed-free fundamental). Real long arms land ~80-120 Hz.
    solveFirstBendingMode: function (armLength_mm, b_mm, h_mm, t_mm, youngsModulus_gpa, density_kg_m3) {
      const L = armLength_mm / 1000;
      const E = youngsModulus_gpa * 1e9;
      const b_out = b_mm / 1000, h_out = h_mm / 1000;
      const b_in = (b_mm - 2 * t_mm) / 1000, h_in = (h_mm - 2 * t_mm) / 1000;
      const I = (b_out * Math.pow(h_out, 3) - b_in * Math.pow(h_in, 3)) / 12.0;
      const A = (b_mm * h_mm - (b_mm - 2 * t_mm) * (h_mm - 2 * t_mm)) / 1e6; // m^2
      const mLin = (density_kg_m3 || 1600) * A; // kg/m
      if (mLin <= 0 || L <= 0 || E * I <= 0) return 0;
      const beta1 = 1.875104069;
      return (beta1 * beta1 / (2 * Math.PI)) * Math.sqrt((E * I) / (mLin * Math.pow(L, 4)));
    },

    // Rotor blade-pass frequency [Hz] — resonance flag if it lands near f_n.
    rotorPassFrequency: function (rpm, blades) {
      return (rpm / 60.0) * (blades || 2);
    },

    // Single source of truth for catalog data: the bundled VLAB_CATALOG
    // (identical data to shared/catalog.json, inlined into this file's
    // prelude). db/db.json is kept only as an offline fallback if the
    // global is unavailable — it must never be treated as a second,
    // independently-maintained catalog (it had already drifted: missing
    // frontal_area_m2/recommended_prop_in on frames and shear_strength_mpa
    // on materials).
    loadCatalog: function () {
      const withFixedWeights = function (db) {
        if (!db.fixed_weights) db.fixed_weights = FIXED_WEIGHTS_G;
        return db;
      };
      if (typeof window !== 'undefined' && window.VLAB_CATALOG) {
        return Promise.resolve(withFixedWeights(JSON.parse(JSON.stringify(window.VLAB_CATALOG))));
      }
      return fetch('db/db.json').then(function (res) {
        if (!res.ok) throw new Error('DB load error: ' + res.status);
        return res.json();
      }).then(withFixedWeights);
    },

    // As-manufactured material yield strength: real layups/extrusions vary
    // part-to-part. Seeded by material id so the same build is reproducible
    // but different builds (or different materials) draw a different
    // deviate — same seeded-tolerance principle as exp1's manufacture_db().
    materialYieldSeeded: function (material) {
      if (!material || typeof material.yield_strength_mpa !== 'number') return material ? material.yield_strength_mpa : 0;
      const C = window.VLAB_CONST;
      if (!C) return material.yield_strength_mpa;
      return +C.applyTol(material.yield_strength_mpa, C.TOL.material_yield, material.id + ':yield').toFixed(2);
    }
  };
})();
window.Calc = Calc;

// ═══════════════════════════════════════════════════════════════════
// Instructor / Buddy Guidance System — text guidance with an optional
// browser text-to-speech read-aloud toggle, plus a graceful-degrading
// video slot for stage-specific clips. Clips are expected under
// simulation/videos/<name>.mp4 (none exist yet — generate them later
// with the names passed to loadVideo() below; the slot HEAD-checks the
// path and stays hidden until a file is actually there, so nothing
// breaks in the meantime). Scoped to THIS experiment only — never
// references or links to another experiment's page.
// ═══════════════════════════════════════════════════════════════════
// Shipped UI sound-effects (audio/sfx/*.mp3, synthesized by
// voice_gen/gen_sfx.py). These carry the moment-to-moment interaction
// feedback so the instructor VOICE can stay quiet — it now only speaks at
// tab intro, fault, and completion (see the Instructor module below).
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
    else { if (_g && _g.ctx.state === 'suspended') { try { _g.ctx.resume(); } catch (e) {} } if (motorOn) motor(true); }
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

  // "Quiet Instructor" audio model: the natural-voice (Emma neural TTS) clips
  // are pre-recorded offline via voice_gen/gen_frame.py and the voice now
  // speaks ONLY at three moments —
  //   1. tab/page intro  (what this module is + what to do here) — first entry
  //   2. a fault / failure                                       — error/warn
  //   3. a task completion                                       — success
  // Everything else (component prompts, live CG/stress readouts,
  // selection-blocked notices) is on-screen text only via show(); there is no
  // robotic speechSynthesis fallback. Sound effects (SFX above) cover the
  // interaction feedback.
  const CLIPS = {
    intro_cg: 'audio/voice/intro_cg.mp3',
    intro_stress: 'audio/voice/intro_stress.mp3',
    fault_cg_severe: 'audio/voice/fault_cg_severe.mp3',
    fault_stress_yield: 'audio/voice/fault_stress_yield.mp3',
    warn_stress_low_sf: 'audio/voice/warn_stress_low_sf.mp3',
    done_cg_balanced: 'audio/voice/done_cg_balanced.mp3',
    done_stress_passed: 'audio/voice/done_stress_passed.mp3'
  };

  // Fault / completion banners are set through say() with distinctive leading
  // text, so we match that text to the right clip id + paired SFX kind.
  // Anything not matched here stays silent (text only). First match wins;
  // tags are stripped before matching. Perfect and Stable balance both count
  // as "balanced enough to fly" → the same completion clip.
  const EVENT_CLIPS = [
    [/^Severe Unbalance/i, 'fault_cg_severe', 'error'],
    [/^Yield Failure/i, 'fault_stress_yield', 'error'],
    [/Safety Factor dropped below 2\.0/i, 'warn_stress_low_sf', 'warn'],
    [/^Perfect Balance/i, 'done_cg_balanced', 'success'],
    [/^Stable Balance/i, 'done_cg_balanced', 'success'],
    [/^Passed/i, 'done_stress_passed', 'success']
  ];

  const synth = (typeof window !== 'undefined' && window.speechSynthesis) ? window.speechSynthesis : null;
  // On by default. The pre-recorded mp3 clips are the primary voice and work in
  // every browser (plain <audio>), independent of speechSynthesis.
  let ttsEnabled = true;
  // User-adjustable narrator volume (0-1), separate from the SFX "Effects"
  // slider — persisted so it survives a reload.
  function readVol(key, fallback) {
    try { const v = parseFloat(localStorage.getItem(key)); return (isFinite(v) && v >= 0 && v <= 1) ? v : fallback; } catch (e) { return fallback; }
  }
  let narratorVol = readVol('vlab:instructor:volume', 1.0);
  let lastVideoSrc = null;
  let cachedVoice = null;
  let voicesReady = false;
  let speakQueueToken = 0; // bumped on every say() so stale chained utterances/clips stop themselves
  let audioEl = null;
  // When a clip can't autoplay yet (no user gesture), we DON'T fall back to the
  // robotic voice — that clashes with the real clip once it unlocks. Instead we
  // stash the pending clip and play it on the first user gesture.
  let pendingClip = null;      // src of the clip waiting for an unlock gesture
  let pendingClipToken = -1;   // token that clip belonged to (stale if superseded)
  let unlockListening = false; // true while the one-shot gesture listeners are armed

  // Ranked by how natural they sound (OS/browser "Natural"/"Online"/neural
  // voices first, then any non-local — usually cloud/higher-quality — English
  // voice, then whatever's left). getVoices() is often empty until the async
  // 'voiceschanged' event fires, so we re-resolve lazily rather than once.
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
    synth.addEventListener('voiceschanged', function () { voicesReady = true; cachedVoice = null; });
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

  // Stops whatever is currently speaking — a pre-recorded clip, a chained
  // speechSynthesis run, or both — so a fresh say() never overlaps stale
  // audio. Bumping the token also halts an in-flight speak() chain because
  // its speakNext() re-checks it before every utterance.
  function stopAll() {
    speakQueueToken++;
    pendingClip = null; pendingClipToken = -1; // drop any clip still waiting on a gesture
    if (synth) synth.cancel();
    if (audioEl) { audioEl.pause(); audioEl.currentTime = 0; }
    setSpeakingIndicator(false);
  }

  // Fired once, on the first real user gesture, to satisfy the browser's
  // autoplay policy. If a clip was waiting (and hasn't been superseded by a
  // newer say()), play it now — this is what makes the very first guidance
  // clip come through instead of being silently dropped.
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

  // Arms (or re-targets) the one-shot gesture unlock for `clip`. The listener
  // is registered once; later blocked clips just overwrite the pending target
  // so the gesture always plays the CURRENT clip, never a stale one.
  function armAudioUnlock(clip, token) {
    pendingClip = clip; pendingClipToken = token;
    if (unlockListening) return;
    unlockListening = true;
    window.addEventListener('pointerdown', onFirstGesture, true);
    window.addEventListener('keydown', onFirstGesture, true);
    window.addEventListener('touchstart', onFirstGesture, true);
  }

  // Matches fault/completion banner `text` to its clip id + SFX kind. Tags are
  // stripped first so inline <strong> etc. never blocks a match. Returns
  // {id, clip, kind} or null (→ silent, text only).
  function resolveEvent(text) {
    const plain = String(text).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    for (let i = 0; i < EVENT_CLIPS.length; i++) {
      if (EVENT_CLIPS[i][0].test(plain)) return { id: EVENT_CLIPS[i][1], clip: CLIPS[EVENT_CLIPS[i][1]], kind: EVENT_CLIPS[i][2] };
    }
    return null;
  }

  // Plays a pre-recorded Emma clip by path. If autoplay is blocked before the
  // first gesture, the clip is deferred to that gesture rather than dropped.
  function playClip(clip) {
    if (!clip) return;
    const myToken = speakQueueToken;
    const a = getAudioEl();
    a.src = clip;
    a.play().catch(function () {
      if (myToken !== speakQueueToken) return; // superseded by a newer clip
      armAudioUnlock(clip, myToken);           // autoplay blocked → defer to gesture
    });
  }

  // Updates the on-screen bubble text ONLY — never speaks. This is the default
  // path for all live status / selection / readout guidance.
  function show(text) {
    const el = document.getElementById('liveCommentaryText');
    if (el) el.innerHTML = text;
    const dot = document.getElementById('vlInstructorDot');
    const bubble = document.getElementById('vlInstructorBubble');
    if (dot) dot.hidden = !(bubble && bubble.hidden); // only badge when collapsed
  }

  // Shows `text` and, if it is a recognized fault/completion banner, plays the
  // matching Emma clip + paired sound effect. Non-event text is silent and
  // never interrupts a playing intro. The CG drag re-sends the same banner
  // (with a live offset number) continuously, so we dedupe on the matched
  // EVENT id — a clip fires ONCE when the condition first appears.
  let _lastEventId = null;
  function say(text) {
    show(text);
    if (!ttsEnabled) return;
    const ev = resolveEvent(text);
    if (!ev) { _lastEventId = null; return; } // non-event → silent; allow same event to replay later
    if (ev.id === _lastEventId) return;       // same ongoing condition → don't re-trigger
    _lastEventId = ev.id;
    stopAll();
    if (ev.kind === 'error') SFX.error();
    else if (ev.kind === 'warn') SFX.warn();
    else if (ev.kind === 'success') SFX.success();
    playClip(ev.clip);
  }

  // Tab/page intro voice. Plays the "what is this module + what to do" clip the
  // FIRST time a module is entered this session; revisits are silent but still
  // set it as the current intro so the ▶ replay button can re-play it.
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
    if (window.SFX) window.SFX.setEnabled(ttsEnabled); // one mute for voice + effects
    const btn = document.getElementById('instructorTtsToggle');
    if (btn) {
      btn.innerHTML = ttsEnabled ? '&#128266;' : '&#128264;';
      btn.classList.toggle('active', ttsEnabled);
      btn.title = ttsEnabled ? 'Audio on — click to mute voice & sound effects' : 'Audio muted — click to enable';
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
    if (!btn) return; // clips play via <audio>, so the toggle is useful even without speechSynthesis
    btn.style.display = 'flex';
    setTts(ttsEnabled); // reflect the default-on state in the button immediately
    btn.addEventListener('click', function () { setTts(!ttsEnabled); });
  }

  // Floating avatar <-> bubble toggle. Starts expanded so the very first
  // guidance message is seen without a click; afterwards the student can
  // minimize it to a small avatar that still narrates and re-badges itself
  // when new guidance arrives.
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

    // ── Drag-to-reposition, from the avatar (collapsed) or the bubble header
    // (expanded) — the whole FAB (avatar + bubble + settings) moves as one
    // unit, and the position is remembered across reloads.
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

  // Adds a small ▶ "replay this tab's intro" control to the instructor bubble
  // (created here so no HTML edit is needed). Re-plays the current module intro.
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

  // Loads a stage/module intro video into `containerId` only if it actually
  // exists (HEAD request — more reliable than <video onerror>, which browsers
  // don't consistently fire for a 404). Autoplays muted (browsers allow
  // muted autoplay without a gesture) with an unmute control, and narrates
  // over it via `say`; silently leaves the slot hidden when the file is
  // missing so nothing breaks before real footage is dropped in.
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

// Progressive guidance for Module 1 (CG balance page): what to pick next.
function moduleTip1() {
  const sel = (typeof state !== 'undefined' && state.selections) ? state.selections : {};
  if (!sel.frame) return 'GUIDE: Start by picking a frame — its wheelbase and arm profile set the geometry everything else balances around.';
  if (!sel.battery) return 'GUIDE: Now pick a battery. Heavier packs shift the CG more, so placement will matter once it\'s on the deck.';
  if (!sel.payloads || !sel.payloads.length) return 'GUIDE: Add a payload (camera, FC, etc.) to complete the build mass.';
  return 'GUIDE: All components selected. Drag the battery/payload markers on the 3D view to balance the Center of Gravity, then check the banner below for any cross-experiment conflicts before locking the design.';
}

// Progressive guidance for Module 2 (stress test page): what to pick next.
function moduleTip2() {
  const sel = (window.VLAB_MOD2 && window.VLAB_MOD2.getActiveSelection) ? window.VLAB_MOD2.getActiveSelection() : {};
  if (!sel || !sel.material) return 'GUIDE: Select an arm material to begin — each material has a different yield strength and stiffness.';
  return 'GUIDE: Material and length selected — ' + sel.material.label + ' @ ' + sel.length + ' mm. Click "Run Stress Test" to see the arm deflect under simulated thrust load and check its safety factor.';
}

// ═══════════════════════════════════════════════════════════════════
// 2. SHARED HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════
function buildSharedTileGrid(container, items, options) {
  const parent = typeof container === 'string' ? document.getElementById(container) : container;
  if (!parent) return;
  const { isMulti, selectedIds, name, idPrefix, specF, onSelect } = options || {};
  const selSet = new Set(Array.isArray(selectedIds) ? selectedIds : (selectedIds ? [selectedIds] : []));

  parent.innerHTML = items.map(item => {
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

  parent.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('change', () => {
      const item = items.find(i => i.id === inp.value);
      if (onSelect && item) onSelect(item, inp.checked);
      if (!isMulti) {
        parent.querySelectorAll('.component-tile').forEach(t => t.classList.remove('selected'));
        inp.closest('.component-tile').classList.add('selected');
      } else {
        inp.closest('.component-tile').classList.toggle('selected', inp.checked);
      }
    });
  });
}

function initBase3DScene(canvas, wrapper, options) {
  const scn = new THREE.Scene();
  scn.background = new THREE.Color(options.bgColor || 0xf3f4f6);
  const parent = (typeof wrapper === 'string' ? document.getElementById(wrapper) : wrapper) || canvas.parentElement || canvas;
  const w = parent.clientWidth || 300, h = parent.clientHeight || 180;

  const cam = new THREE.PerspectiveCamera(options.fov || 45, w / h, 0.01, 100);
  if (options.camPos) cam.position.set(options.camPos.x, options.camPos.y, options.camPos.z);

  const rndr = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: !!options.alpha });
  rndr.setSize(w, h, false);
  rndr.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  if (options.enableShadows) {
    rndr.shadowMap.enabled = true;
    rndr.shadowMap.type = THREE.PCFSoftShadowMap;
    rndr.outputEncoding = THREE.sRGBEncoding;
    rndr.toneMapping = THREE.ACESFilmicToneMapping;
    rndr.toneMappingExposure = 1.0;
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
  sun.position.set(options.sunPos?.x || 1.5, options.sunPos?.y || 3.0, options.sunPos?.z || 1.5);
  if (options.enableShadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.bias = options.sunBias !== undefined ? options.sunBias : -0.0001;
  }
  scn.add(sun);

  const resize = () => {
    const width = parent.clientWidth, height = parent.clientHeight;
    if (width === 0 || height === 0) return;
    rndr.setSize(width, height, false);
    cam.aspect = width / height;
    cam.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 100));

  return { scn, rndr, cam, ctrls, handleResize: resize };
}

// ═══════════════════════════════════════════════════════════════════
// 3. THREE.JS SCENE COORDINATOR IIFE
// ═══════════════════════════════════════════════════════════════════
const Scene = (function () {
  'use strict';
  let _base = null;
  let _activeTab = 1;
  let _clock = null;
  let _animFrameId = null;

  function init(tabNum) {
    const canvas = document.getElementById('droneCanvas');
    const wrapper = document.getElementById('canvasWrapper');
    if (!canvas || !wrapper) return;

    _activeTab = tabNum;
    
    const wheelbase = (state.selections.frame) ? state.selections.frame.wheelbase_mm : 450;
    const H_stand = 0.06 + (wheelbase / 1000) * 0.2;
    const camPos = (tabNum === 2) ? { x: 0.42, y: 0.22, z: 0.32 } : { x: 0.50, y: H_stand + 0.25, z: 0.65 };
    const targetPos = (tabNum === 2) ? { x: 0.12, y: 0.04, z: 0 } : { x: 0, y: H_stand, z: 0 };

    _base = initBase3DScene(canvas, wrapper, {
      bgColor: 0xf3f4f6,
      fov: 45,
      camPos: camPos,
      enableShadows: true,
      ctrls: {
        minDist: 0.15,
        maxDist: 5.0,
        target: targetPos
      }
    });

    // Ground Plane
    const groundGeo = new THREE.PlaneGeometry(10, 10);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.9 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.001;
    ground.receiveShadow = true;
    _base.scn.add(ground);

    // Grid
    const grid = new THREE.GridHelper(8, 40, 0xcbd5e1, 0xe5e7eb);
    _base.scn.add(grid);

    _clock = new THREE.Clock();

    if (_animFrameId) cancelAnimationFrame(_animFrameId);
    _startLoop();
  }

  function _startLoop() {
    function tick() {
      _animFrameId = requestAnimationFrame(tick);
      const delta = _clock.getDelta();
      _base.ctrls.update();

      // Animate structures
      DroneModel.tick(delta, _activeTab);

      if (_activeTab === 1) {
        // Heatmap Caching / Performance Optimizations
        const cg = state.calculations;
        const frameId = state.selections.frame ? state.selections.frame.id : null;
        const batPosStr = JSON.stringify(state.selections.battery_pos);
        
        const needsRedraw = 
          window._lastHeatmapCgX !== cg.x_cg || 
          window._lastHeatmapCgY !== cg.y_cg ||
          window._lastHeatmapFrame !== frameId ||
          window._lastHeatmapBatPos !== batPosStr;
          
        if (needsRedraw) {
          Module1.drawHeatmap(cg.x_cg, cg.y_cg);
          window._lastHeatmapCgX = cg.x_cg;
          window._lastHeatmapCgY = cg.y_cg;
          window._lastHeatmapFrame = frameId;
          window._lastHeatmapBatPos = batPosStr;
        }
        Module1.drawVibrationGraph();
      }

      _base.rndr.render(_base.scn, _base.cam);
    }
    tick();
  }

  function resize() {
    if (_base && _base.handleResize) _base.handleResize();
  }

  function setTab(tabNum) {
    _activeTab = tabNum;
    if (_base) {
      const wheelbase = (state.selections.frame) ? state.selections.frame.wheelbase_mm : 450;
      const H_stand = 0.06 + (wheelbase / 1000) * 0.2;
      if (tabNum === 2) {
        _base.cam.position.set(0.42, 0.22, 0.32);
        _base.ctrls.target.set(0.12, 0.04, 0);
      } else {
        _base.cam.position.set(0.50, H_stand + 0.25, 0.65);
        _base.ctrls.target.set(0, H_stand, 0);
      }
      _base.ctrls.update();
    }
  }

  return {
    init,
    resize,
    setTab,
    getScene: () => _base ? _base.scn : null,
    getCamera: () => _base ? _base.cam : null,
    getRenderer: () => _base ? _base.rndr : null,
    getControls: () => _base ? _base.ctrls : null,
    getActiveTab: () => _activeTab
  };
})();
window.Scene = Scene;

// ═══════════════════════════════════════════════════════════════════
// 4. 3D DRONE MODEL BUILDER & DEFLECTOR IIFE
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
  let _motorSpinGrps = [];
  let _blurDscs = [];
  let _rotRPM = 0;
  let _propDiamM = 0.127;   // last-built propeller diameter (5" default) — sets the SFX pitch's size term

  let _lcdCnvs = null;
  let _lcdCtx = null;
  let _lcdTxtr = null;

  let _smokeParts = [];
  let _isBurning = false;
  let _spawnTmr = 0.0;

  // Exp2-specific scene variables (balancing scene)
  let chasisModel = null;   // GLB chassis model (null = use procedural geometry)
  let droneGroup = null;
  let balancingStand = null;
  let batteryMesh = null;
  let payloadMesh = null;
  let cgIndicator = null;
  let boundaryRing = null;

  // Exp2-specific scene variables (cantilever scene)
  let cantileverGroup = null;
  let beamMesh = null;
  let clampMesh = null;
  let testMotorMesh = null;
  let debrisParticles = [];
  let activeMaterial = null;
  let activeLength_mm = 250;
  let isBroken = false;
  let breakProgress = 0.0;
  let deflectionForce = 0;
  let targetForce = 0;

  let _carbonTxtr = null;
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

  function initLCD() {
    if (_lcdTxtr) return;
    _lcdCnvs = document.createElement('canvas');
    _lcdCnvs.width = 256;
    _lcdCnvs.height = 128;
    _lcdCtx = _lcdCnvs.getContext('2d');
    _lcdTxtr = new THREE.CanvasTexture(_lcdCnvs);
    updateBenchHUD(0, 0, 0, 'READY');
  }

  function updateBenchHUD(measuredThrust, targetThrust, rpm, status) {
    if (!_lcdCtx) return;
    
    _lcdCtx.fillStyle = '#0f172a';
    _lcdCtx.fillRect(0, 0, 256, 128);
    
    _lcdCtx.strokeStyle = '#0284c7';
    _lcdCtx.lineWidth = 6;
    _lcdCtx.strokeRect(3, 3, 250, 122);
    
    _lcdCtx.fillStyle = '#38bdf8';
    _lcdCtx.font = 'bold 15px sans-serif';
    _lcdCtx.fillText('AEROSIM RECORDER', 16, 24);
    
    _lcdCtx.fillStyle = (status === 'BURN!') ? '#ef4444' : (status === 'STALL') ? '#f59e0b' : '#34d399';
    _lcdCtx.font = '22px monospace';
    _lcdCtx.fillText('MEASURED: ' + measuredThrust.toFixed(3) + ' N', 16, 56);
    
    _lcdCtx.fillStyle = '#94a3b8';
    _lcdCtx.font = '16px monospace';
    _lcdCtx.fillText('HOVER REQ: ' + targetThrust.toFixed(3) + ' N', 16, 82);
    
    _lcdCtx.fillStyle = '#f1f5f9';
    _lcdCtx.font = '15px monospace';
    _lcdCtx.fillText('RPM: ' + Math.round(rpm) + ' | ' + status, 16, 108);
    
    _lcdTxtr.needsUpdate = true;
  }

  function updateSmoke(dt) {
    if (_isBurning && _droneGrp) {
      _spawnTmr += dt;
      if (_spawnTmr >= 0.04) {
        _spawnTmr = 0.0;
        
        const activeTab = window.Scene ? window.Scene.getActiveTab() : 1;
        if (activeTab === 3) {
          const frame = (window.VLAB && window.VLAB.state) ? window.VLAB.state.selections.frame : 
                        (window.VLAB_MOD2 && window.VLAB_MOD2.data) ? window.VLAB_MOD2.data.selections.frame : null;
          const bh = frame ? frame.body_size_mm[1] / 1000 : 0.026;
          const motorRadius = frame ? frame.wheelbase_mm / 2000 : 0.225;
          
          _armDirs.forEach(function (dir) {
            const tipPos = dir.clone().multiplyScalar(motorRadius);
            tipPos.y = bh * 0.45 + 0.015;
            const globalPos = tipPos.clone().add(_droneGrp.position);
            spawnParticle(globalPos);
          });
        } else if (activeTab === 2) {
          spawnParticle(new THREE.Vector3(0, 0.144, 0));
        }
      }
    }
    
    const sc = window.Scene ? window.Scene.getScene() : null;
    if (sc) {
      for (let i = _smokeParts.length - 1; i >= 0; i--) {
        const p = _smokeParts[i];
        p.age += dt;
        if (p.age >= p.maxAge) {
          sc.remove(p.mesh);
          p.mesh.geometry.dispose();
          p.mesh.material.dispose();
          _smokeParts.splice(i, 1);
        } else {
          const t = p.age / p.maxAge;
          p.mesh.position.addScaledVector(p.velocity, dt);
          p.mesh.scale.setScalar(p.startScale * (1.0 + t * 4.0));
          p.mesh.material.opacity = p.startOpacity * (1.0 - t);
        }
      }
    }
  }

  function spawnParticle(pos) {
    const sc = window.Scene ? window.Scene.getScene() : null;
    if (!sc) return;
    const geo = new THREE.SphereGeometry(0.008, 6, 6);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x4b5563,
      transparent: true,
      opacity: 0.35,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    sc.add(mesh);
    
    _smokeParts.push({
      mesh: mesh,
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 0.04,
        0.15 + Math.random() * 0.10,
        (Math.random() - 0.5) * 0.04
      ),
      age: 0.0,
      maxAge: 0.8 + Math.random() * 0.5,
      startScale: 0.5 + Math.random() * 0.4,
      startOpacity: 0.35
    });
  }

  function setBurnState(burn) {
    _isBurning = burn;
    if (!burn) {
      const sc = window.Scene ? window.Scene.getScene() : null;
      if (sc) {
        _smokeParts.forEach(p => {
          sc.remove(p.mesh);
          p.mesh.geometry.dispose();
          p.mesh.material.dispose();
        });
      }
      _smokeParts = [];
    }
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

  // Alias used by exp2-specific scene functions
  // Note: exp2 passes opacity as 4th numeric arg; createMat expects an object for 'extra'
  function createMaterial(color, roughness, metalness, opacityOrExtra) {
    const extra = (typeof opacityOrExtra === 'number')
      ? { opacity: opacityOrExtra, transparent: true }
      : (opacityOrExtra || {});
    return new THREE.MeshStandardMaterial(Object.assign({
      color: color,
      roughness: roughness,
      metalness: metalness
    }, extra));
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
      _droneGrp.position.set(0, 0.10, 0);
      window.Scene.getScene().add(_droneGrp);
    }
  }

  function clearAllDroneGrp() {
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

  // ── High-poly "hero" BLDC outrunner motor model — ported verbatim (geometry
  // + materials) from exp-power-electronics-esc-dei's simulation/js/esc_hw_models.js
  // (window.EscHwModels.buildMotor), same as the port already done for
  // exp-propulsion-system-design-dei, inlined here per the one-js-file rule.
  // Replaces the old flat-mesh motor (bell/coils/stator all static, only the
  // propeller spun) with a static base (mount plate, bearing boss, 12
  // laminated-stack copper-wound teeth) + a `spin` sub-group (anodised bell,
  // top cap+vents, hub+screws, shaft, circlip, prop nut) that actually
  // rotates with the shaft. Local frame: y=0 is the mount face, the bell
  // extends +Y — matching this file's existing motorY convention exactly
  // (bell bottom sits 4mm above the group origin, i.e. position the returned
  // group at `motorY - 0.004` to reproduce the old mesh's placement).
  function buildMotorMesh(motor, accent) {
    motor = motor || {};
    const bellR = (motor.bell_diameter_mm || 28) / 2 / 1000;
    const bellH = (motor.bell_height_mm || 21) / 1000;
    accent = accent !== undefined ? accent : 0xc2410c;
    const root = new THREE.Group();

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

    const ring = new THREE.Mesh(new THREE.CylinderGeometry(bellR * 1.005, bellR * 1.005, bellH * 0.09, 64, 1, true),
      createMat(accent, 0.36, 0.7, { emissive: accent, emissiveIntensity: 0.18 }));
    ring.position.y = bellBottom + bellH * 0.14; spin.add(ring);

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

  // Airfoil cross-section (NACA-4-like thickness/camber blend), used to loft
  // the propeller blade surface — ported verbatim from
  // EscHwModels.airfoilContour (esc_hw_models.js).
  function _propAirfoilContour(chord, thick, camber, S) {
    const pts = [];
    function yt(s) { return 5 * thick * (0.2969 * Math.sqrt(s) - 0.1260 * s - 0.3516 * s * s + 0.2843 * s * s * s - 0.1015 * s * s * s * s); }
    function yc(s) { return camber * 4 * s * (1 - s); }
    for (let i = 0; i <= S; i++) { const s = i / S; pts.push([(0.5 - s) * chord, yc(s) + yt(s) / 2]); }
    for (let i = S - 1; i >= 1; i--) { const s = i / S; pts.push([(0.5 - s) * chord, yc(s) - yt(s) / 2]); }
    return pts;
  }

  // One smooth blade: a single lofted surface swept root→tip with
  // interpolated chord/thickness and true geometric twist
  // φ(r) = atan(pitch / 2πr) — ported verbatim from EscHwModels.buildBlade.
  // Replaces the old boxy 8-segment extruded-airfoil blade.
  function _buildPropBlade(radius, hubR, baseChord, dirSign, bladeMat, tipMat, pitch_m) {
    const NST = 26, S = 14, M = 2 * S;
    const verts = [], idx = [];
    for (let j = 0; j <= NST; j++) {
      const t = j / NST;
      const r = hubR + (radius - hubR) * t;
      let chord = baseChord * (0.55 + 0.60 * Math.sin(Math.PI * Math.pow(Math.min(t, 0.999), 0.7)) - 0.32 * t);
      if (t > 0.9) chord *= Math.max(0.12, 1 - (t - 0.9) / 0.1 * 0.9);
      chord = Math.max(chord, baseChord * 0.1);
      const thick = (0.11 * baseChord) * (1 - t) + 0.015 * baseChord * t;
      const camber = (0.06 * chord) * (1 - t) + 0.012 * chord * t;
      const phi = Math.atan2(pitch_m, 2 * Math.PI * Math.max(r, 1e-4)) * dirSign;
      const cs = Math.cos(phi), sn = Math.sin(phi);
      const c2d = _propAirfoilContour(chord, thick, camber, S);
      for (let k = 0; k < M; k++) {
        const zc = c2d[k][0], yc2 = c2d[k][1];
        verts.push(r, yc2 * cs - zc * sn, yc2 * sn + zc * cs);
      }
    }
    for (let j = 0; j < NST; j++) {
      const a = j * M, b = (j + 1) * M;
      for (let k = 0; k < M; k++) { const k2 = (k + 1) % M; idx.push(a + k, a + k2, b + k, a + k2, b + k2, b + k); }
    }
    const lastStart = NST * M;
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < M; k++) { cx += verts[(lastStart + k) * 3]; cy += verts[(lastStart + k) * 3 + 1]; cz += verts[(lastStart + k) * 3 + 2]; }
    const cIdx = verts.length / 3;
    verts.push(cx / M, cy / M, cz / M);
    for (let k = 0; k < M; k++) { const k2 = (k + 1) % M; idx.push(lastStart + k, cIdx, lastStart + k2); }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geom.setIndex(idx);
    const band = 3;
    const mainCount = (NST - band) * M * 6;
    geom.addGroup(0, mainCount, 0);
    geom.addGroup(mainCount, band * M * 6 + M * 3, 1);
    geom.computeVertexNormals();
    const mesh = new THREE.Mesh(geom, [bladeMat, tipMat]);
    mesh.castShadow = true;
    const blade = new THREE.Group(); blade.add(mesh);
    return blade;
  }

  // High-poly "hero" propeller model — ported from
  // exp-power-electronics-esc-dei's simulation/js/esc_hw_models.js
  // (window.EscHwModels.buildPropeller), inlined per the one-js-file rule.
  // Replaces the old boxy segmented-extrusion blades with a single smooth
  // lofted airfoil surface per blade, true geometric twist computed from the
  // selection's actual pitch/diameter ratio. Local frame: y=0 is the hub
  // center — position the group at `motorY + bellH*1.5 + dims.hubH/2` (same
  // clearance formula used in exp-propulsion-system-design-dei) so the hub
  // rests at the motor's prop-nut level, clear of the top-cap/vent/screw
  // cluster instead of buried inside it.
  function buildPropellerMesh(prop, dirSign) {
    prop = prop || {};
    const D = prop.diameter_m || 0.1270;
    _propDiamM = D;   // remember for the SFX pitch's size term (setSimRPM)
    const R = D / 2;
    const blades = Math.max(2, Math.min(4, prop.blades || 2));
    const pdRatio = (typeof prop.pitch_diameter_ratio === 'number') ? prop.pitch_diameter_ratio
      : (prop.pitch_in && prop.diameter_in ? prop.pitch_in / prop.diameter_in : 0.9);
    const pitch_m = pdRatio * D;
    const root = new THREE.Group();
    const spin = new THREE.Group(); root.add(spin);

    const bladeMat = createMat(0x161a20, 0.28, 0.14, { side: THREE.DoubleSide });
    const tipMat = createMat(0xef4444, 0.26, 0.1, { emissive: 0x5c1414, emissiveIntensity: 0.3, side: THREE.DoubleSide });

    const hubR = R * 0.1;
    const baseChord = R * 0.17;

    const hub = new THREE.Mesh(new THREE.CylinderGeometry(hubR, hubR * 1.12, R * 0.09, 36), bladeMat);
    hub.castShadow = true; spin.add(hub);
    const bore = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.032, R * 0.032, R * 0.1, 24), createMat(0x05070a, 0.7, 0.3));
    spin.add(bore);
    const washer = new THREE.Mesh(new THREE.CylinderGeometry(hubR * 0.72, hubR * 0.72, R * 0.02, 30), createMat(0x2a2f36, 0.4, 0.7));
    washer.position.y = R * 0.05; spin.add(washer);

    for (let b = 0; b < blades; b++) {
      const blade = _buildPropBlade(R, hubR * 0.9, baseChord, dirSign, bladeMat, tipMat, pitch_m);
      blade.rotation.y = b * (Math.PI * 2 / blades);
      spin.add(blade);
    }

    return { group: root, spin: spin, dims: { R: R, blades: blades, pitch_m: pitch_m, hubH: R * 0.09 } };
  }

  function updateFromSelections(sel) {
    ensureGroup();
    if (!_droneGrp) return;
    clearAllDroneGrp();

    const activeTab = window.Scene ? window.Scene.getActiveTab() : 1;

    const frame = sel.frame;
    const motor = sel.motor;
    const prop = sel.propeller;
    const batt = sel.battery;
    const esc = sel.esc;
    const fc = sel.flight_controller;
    const rx = sel.receiver;
    const payloads = sel.payloads || [];

    if (activeTab === 2) {
      _droneGrp.position.set(0, 0, 0);

      const baseGeo = new THREE.BoxGeometry(0.12, 0.008, 0.09);
      const baseMat = createMat(0x1e293b, 0.6, 0.3);
      const baseMesh = new THREE.Mesh(baseGeo, baseMat);
      baseMesh.position.y = 0.004;
      baseMesh.receiveShadow = true;
      _droneGrp.add(baseMesh);

      const standHeight = 0.12;
      const standGeo = new THREE.BoxGeometry(0.016, standHeight, 0.024);
      const standMat = createMat(0x94a3b8, 0.45, 0.75);
      const standMesh = new THREE.Mesh(standGeo, standMat);
      standMesh.position.y = standHeight / 2 + 0.008;
      standMesh.castShadow = true;
      standMesh.receiveShadow = true;
      _droneGrp.add(standMesh);

      const loadCellGeo = new THREE.BoxGeometry(0.012, 0.016, 0.028);
      const loadCellMat = createMat(0xd1d5db, 0.2, 0.9);
      const loadCellMesh = new THREE.Mesh(loadCellGeo, loadCellMat);
      loadCellMesh.position.set(0, standHeight + 0.008, 0);
      _droneGrp.add(loadCellMesh);

      const gaugeMat = createMat(0xef4444, 0.5, 0.0);
      const gaugeL = new THREE.Mesh(new THREE.PlaneGeometry(0.001, 0.008), gaugeMat);
      gaugeL.position.set(-0.0061, standHeight + 0.008, 0);
      gaugeL.rotation.y = -Math.PI / 2;
      _droneGrp.add(gaugeL);

      const gaugeR = new THREE.Mesh(new THREE.PlaneGeometry(0.001, 0.008), gaugeMat);
      gaugeR.position.set(0.0061, standHeight + 0.008, 0);
      gaugeR.rotation.y = Math.PI / 2;
      _droneGrp.add(gaugeR);

      const escH = 0.025;
      const escW = 0.006;
      const escD = 0.016;
      const escBoxGeo = new THREE.BoxGeometry(escW, escH, escD);
      const escBoxMat = createMat(0x0f172a, 0.6, 0.85);
      const escBox = new THREE.Mesh(escBoxGeo, escBoxMat);
      escBox.position.set(0.011, standHeight * 0.45, 0);
      _droneGrp.add(escBox);

      const finGeo = new THREE.BoxGeometry(0.002, escH, 0.0015);
      const finMat = createMat(0x334155, 0.4, 0.9);
      for (let f = -3; f <= 3; f++) {
        const fin = new THREE.Mesh(finGeo, finMat);
        fin.position.set(0.011 + 0.003, standHeight * 0.45, f * 0.002);
        _droneGrp.add(fin);
      }

      const wireMatRed = createMat(0xef4444, 0.7, 0.0);
      const wireMatBlack = createMat(0x1e293b, 0.7, 0.0);
      const wireMatBlue = createMat(0x3b82f6, 0.7, 0.0);

      const pwrCableR = new THREE.Mesh(new THREE.CylinderGeometry(0.001, 0.001, standHeight * 0.45, 6), wireMatRed);
      pwrCableR.position.set(0.008, standHeight * 0.225, 0.004);
      _droneGrp.add(pwrCableR);

      const pwrCableB = new THREE.Mesh(new THREE.CylinderGeometry(0.001, 0.001, standHeight * 0.45, 6), wireMatBlack);
      pwrCableB.position.set(0.008, standHeight * 0.225, -0.004);
      _droneGrp.add(pwrCableB);

      const motorCable1 = new THREE.Mesh(new THREE.CylinderGeometry(0.0008, 0.0008, standHeight * 0.55, 6), wireMatRed);
      motorCable1.position.set(0.008, standHeight * 0.725, 0.004);
      _droneGrp.add(motorCable1);

      const motorCable2 = new THREE.Mesh(new THREE.CylinderGeometry(0.0008, 0.0008, standHeight * 0.55, 6), wireMatBlack);
      motorCable2.position.set(0.008, standHeight * 0.725, 0);
      _droneGrp.add(motorCable2);

      const motorCable3 = new THREE.Mesh(new THREE.CylinderGeometry(0.0008, 0.0008, standHeight * 0.55, 6), wireMatBlue);
      motorCable3.position.set(0.008, standHeight * 0.725, -0.004);
      _droneGrp.add(motorCable3);

      const lcdGroup = new THREE.Group();
      lcdGroup.position.set(0.008, 0.075, 0.011);
      lcdGroup.rotation.x = -0.15;
      lcdGroup.rotation.y = Math.atan2(0.25, 0.35);

      const lcdFrameGeo = new THREE.BoxGeometry(0.052, 0.034, 0.008);
      const lcdFrameMat = createMat(0x0f172a, 0.8, 0.15);
      const lcdFrame = new THREE.Mesh(lcdFrameGeo, lcdFrameMat);
      lcdFrame.position.set(0, 0, 0);
      lcdFrame.castShadow = true;
      lcdGroup.add(lcdFrame);

      initLCD();
      const lcdScreenGeo = new THREE.PlaneGeometry(0.046, 0.028);
      const lcdScreenMat = new THREE.MeshBasicMaterial({
        map: _lcdTxtr,
        side: THREE.DoubleSide
      });
      const lcdScreen = new THREE.Mesh(lcdScreenGeo, lcdScreenMat);
      lcdScreen.position.set(0, 0, 0.0041);
      lcdGroup.add(lcdScreen);

      _droneGrp.add(lcdGroup);

      const mountGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.006, 12);
      const mountMat = createMat(0x334155, 0.5, 0.5);
      const mountMesh = new THREE.Mesh(mountGeo, mountMat);
      mountMesh.position.y = standHeight + 0.016 + 0.003;
      _droneGrp.add(mountMesh);

      if (motor) {
        const motorY = standHeight + 0.016 + 0.006;
        const bellH = motor.bell_height_mm / 1000;
        const heroMotor = buildMotorMesh(motor);
        heroMotor.group.position.set(0, motorY - 0.004, 0);
        heroMotor.group.castShadow = true;
        _droneGrp.add(heroMotor.group);
        _motorSpinGrps.push(heroMotor.spin);

        if (prop) {
          const propR = prop.diameter_m / 2;
          const heroProp = buildPropellerMesh(prop, 1);
          const propY = motorY + bellH * 1.5 + heroProp.dims.hubH / 2;

          heroProp.group.position.set(0, propY, 0);
          heroProp.group.castShadow = true;
          _droneGrp.add(heroProp.group);
          _propGrps.push(heroProp.spin);

          const discGeo = new THREE.CircleGeometry(propR * 1.03, 32);
          const discMat = new THREE.MeshBasicMaterial({
            color: 0x1f2937,
            transparent: true,
            opacity: 0.0,
            side: THREE.DoubleSide,
            depthWrite: false
          });
          const discMesh = new THREE.Mesh(discGeo, discMat);
          discMesh.rotation.x = -Math.PI / 2;
          heroProp.group.add(discMesh);
          _blurDscs.push(discMat);
        }
      }
      return;
    }

    _droneGrp.position.set(0, 0.10, 0);

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

        const heroMotor = buildMotorMesh(motor);
        heroMotor.group.position.set(tipPos.x, motorY - 0.004, tipPos.z);
        heroMotor.group.castShadow = true;
        _droneGrp.add(heroMotor.group);
        _motorSpinGrps.push(heroMotor.spin);

        if (prop) {
          const propR = prop.diameter_m / 2;
          const dirSign = _propSigns[i];
          const heroProp = buildPropellerMesh(prop, dirSign);
          const propY = motorY + bellH * 1.5 + heroProp.dims.hubH / 2;

          heroProp.group.position.set(tipPos.x, propY, tipPos.z);
          heroProp.group.castShadow = true;
          _droneGrp.add(heroProp.group);
          _propGrps.push(heroProp.spin);

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
          heroProp.group.add(discMesh);
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
    updateSmoke(delta);

    if (!_propGrps.length) return;
    // VISUAL spin rate, capped sub-aliasing: real prop RPM (3k–18k = 50–300
    // rev/s) advances several revolutions per 60 fps frame → aliases to a
    // frozen/jittery blade. Map to a monotonic, ~proportional, capped (~8
    // rev/s) visual rate with a small idle floor so rotors always read alive;
    // the motion-blur disc below still conveys the true high-RPM blur.
    const rpmEff = Math.max(_rotRPM, 700);
    const omega = Math.min(8, rpmEff / 2500) * 2.0 * Math.PI;

    _propGrps.forEach(function (pg, i) {
      const activeTab = window.Scene ? window.Scene.getActiveTab() : 1;
      const sign = activeTab === 1 ? 1 : _propSigns[i];
      pg.rotation.y += sign * omega * delta;
    });

    // Motor bell spins on the same shaft as its propeller — same sign/omega,
    // same index pairing (both arrays are pushed together per motor).
    _motorSpinGrps.forEach(function (sg, i) {
      const activeTab = window.Scene ? window.Scene.getActiveTab() : 1;
      const sign = activeTab === 1 ? 1 : _propSigns[i];
      sg.rotation.y += sign * omega * delta;
    });

    const bladeOpa = _rotRPM > 800
      ? Math.max(0.0, 0.9 - (_rotRPM - 800) / 4000)
      : 0.9;
    const discOpa = _rotRPM > 1200
      ? Math.min(0.24, (_rotRPM - 1200) / 10000)
      : 0.0;

    _propGrps.forEach(function (pg) {
      pg.children.forEach(function (child) {
        if (child.children.length > 0) {
          child.children.forEach(function (sub) {
            if (sub.geometry && sub.geometry.type === 'BoxGeometry') {
              sub.material.opacity = bladeOpa;
              sub.material.transparent = bladeOpa < 0.9;
            }
          });
        }
      });
    });

    _blurDscs.forEach(function (discMat) {
      discMat.opacity = discOpa;
    });
  }

  function setSimRPM(rpm) {
    _rotRPM = Math.max(0, rpm);
    // Drive the motor buzz + propeller whoosh pitch/volume off the SAME live RPM
    // that animates the visual spin, plus a size term (bigger prop -> deeper
    // pitch) — single funnel point so every setSimRPM() caller gets dynamic
    // audio for free.
    if (window.SFX && window.SFX.motorRate) {
      const rpmFrac = Math.max(0, Math.min(1.3, _rotRPM / 18000));
      const sizeFactor = Math.max(0.65, Math.min(1.3, 0.145 / Math.max(0.06, _propDiamM)));
      window.SFX.motorRate(rpmFrac, sizeFactor);
    }
  }
  function rebuildScene(sel, tabNum) {
    const sc = Scene.getScene();
    if (!sc) return;

    clearAll(sc);

    if (tabNum === 1) {
      buildBalancingScene(sel, sc);
    } else if (tabNum === 2) {
      buildCantileverScene(sel, sc);
    }
  }

  function clearAll(sc) {
    if (droneGroup) { sc.remove(droneGroup); dispose(droneGroup); droneGroup = null; }
    if (balancingStand) { sc.remove(balancingStand); dispose(balancingStand); balancingStand = null; }
    if (cantileverGroup) { sc.remove(cantileverGroup); dispose(cantileverGroup); cantileverGroup = null; }
    batteryMesh = null;
    payloadMesh = null;
    cgIndicator = null;
    boundaryRing = null;
    beamMesh = null;
    clampMesh = null;
    testMotorMesh = null;
    debrisParticles = [];
  }

  function dispose(obj) {
    obj.traverse(function (child) {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
        else child.material.dispose();
      }
    });
  }

  function buildBalancingScene(sel, sc) {
    const frame = sel.frame;
    if (!frame) return;

    // Resolve a visual motor and propeller from the db based on frame wheelbase.
    // These are used for 3D rendering only — no physics impact.
    const db = window._exp2DB || {};
    const wheelbaseMm = frame.wheelbase_mm;
    let visualMotor = sel.motor || null;
    let visualProp = sel.propeller || null;
    if (!visualMotor && db.motors && db.motors.length) {
      // Pick motor whose recommended prop matches the wheelbase range
      const motorMap = { 250: '1806_2300', 330: '2207_1600', 450: '2212_920', 550: '2808_1200', 680: '3508_700', 850: '4008_380' };
      const mId = motorMap[wheelbaseMm] || db.motors[Math.floor(db.motors.length / 2)].id;
      visualMotor = db.motors.find(m => m.id === mId) || db.motors[0];
    }
    if (!visualProp && db.propellers && db.propellers.length) {
      const propMap = { 250: '5045_2b', 330: '7045_2b', 450: '1045_2b', 550: '1245_2b', 680: '1445_2b', 850: '1655_2b' };
      const pId = propMap[wheelbaseMm] || db.propellers[Math.floor(db.propellers.length / 2)].id;
      visualProp = db.propellers.find(p => p.id === pId) || db.propellers[0];
    }

    const wheelbase = frame.wheelbase_mm;
    const bw = frame.body_size_mm[0] / 1000;
    const bh = frame.body_size_mm[1] / 1000;
    const bz = frame.body_size_mm[2] / 1000;
    const plateThickness = 0.002;

    const H_stand = 0.06 + (wheelbase / 1000) * 0.2; // stand height

    droneGroup = new THREE.Group();
    droneGroup.position.set(0, H_stand, 0);
    sc.add(droneGroup);

    balancingStand = new THREE.Group();
    sc.add(balancingStand);

    const baseGeo = new THREE.CylinderGeometry(0.08, 0.09, 0.008, 24);
    const baseMesh = new THREE.Mesh(baseGeo, createMaterial(0x1e293b, 0.6, 0.2));
    baseMesh.position.y = 0.004;
    baseMesh.receiveShadow = true;
    balancingStand.add(baseMesh);

    const rodGeo = new THREE.CylinderGeometry(0.001, 0.008, H_stand, 16);
    const rodMesh = new THREE.Mesh(rodGeo, createMaterial(0x64748b, 0.45, 0.6));
    rodMesh.position.y = H_stand / 2;
    rodMesh.castShadow = true;
    balancingStand.add(rodMesh);

    const ballGeo = new THREE.SphereGeometry(0.002, 8, 8);
    const ballMesh = new THREE.Mesh(ballGeo, createMaterial(0xe2e8f0, 0.15, 0.95));
    ballMesh.position.y = H_stand;
    balancingStand.add(ballMesh);

    const frameMat = createMaterial(hexToInt(frame.color_hex), frame.roughness, frame.metalness);

    if (chasisModel) {
      const chasisInstance = chasisModel.clone();
      
      const box = new THREE.Box3().setFromObject(chasisInstance);
      const size = new THREE.Vector3();
      box.getSize(size);
      
      const modelWheelbase = Math.max(size.x, size.z) || 1.0;
      const targetWheelbase = wheelbase / 1000;
      const scale = targetWheelbase / modelWheelbase;
      
      chasisInstance.scale.set(scale, scale, scale);
      
      const center = new THREE.Vector3();
      box.getCenter(center);
      chasisInstance.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
      
      chasisInstance.traverse(c => {
        if (c.isMesh) {
          c.castShadow = true;
          c.receiveShadow = true;
          if (c.material) {
            c.material = frameMat;
          }
        }
      });
      droneGroup.add(chasisInstance);
    } else {
      // Bottom plate � rounded extrusion to match exp1
      const extrudeSettings = {
        steps: 1,
        depth: plateThickness,
        bevelEnabled: true,
        bevelThickness: 0.0005,
        bevelSize: 0.0005,
        bevelOffset: 0,
        bevelSegments: 2
      };
      const bottomPlateShape = createRoundedRectShape(bw, bz, Math.min(bw, bz) * 0.12);
      const bottomPlateGeo = new THREE.ExtrudeGeometry(bottomPlateShape, extrudeSettings);
      const bottomPlate = new THREE.Mesh(bottomPlateGeo, frameMat);
      bottomPlate.rotation.x = -Math.PI / 2;
      bottomPlate.position.y = -0.001;
      bottomPlate.receiveShadow = true;
      bottomPlate.castShadow = true;
      droneGroup.add(bottomPlate);

      // Top plate � rounded extrusion to match exp1
      const topPlateShape = createRoundedRectShape(bw * 0.95, bz * 0.95, Math.min(bw, bz) * 0.12);
      const topPlateGeo = new THREE.ExtrudeGeometry(topPlateShape, extrudeSettings);
      const topPlate = new THREE.Mesh(topPlateGeo, frameMat);
      topPlate.rotation.x = -Math.PI / 2;
      topPlate.position.y = bh - 0.001;
      topPlate.receiveShadow = true;
      topPlate.castShadow = true;
      droneGroup.add(topPlate);

      // Standoff pillars
      const standoffR = 0.0025;
      const standoffMat = createMaterial(0xd1d5db, 0.3, 0.9);
      const cornerOffsets = [
        [-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]
      ];
      cornerOffsets.forEach(off => {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(standoffR, standoffR, bh - 0.002, 8), standoffMat);
        pillar.position.set(bw * off[0], bh / 2, bz * off[1]);
        pillar.castShadow = true;
        droneGroup.add(pillar);
      });
    }

    // 4 Arms
    const motorRadius = wheelbase / 2000;
    const armR = (frame.arm_tube_od_mm / 2) / 1000;
    const armMat = new THREE.MeshStandardMaterial({
      color: 0x333333,
      map: getCarbonFiberTexture(),
      roughness: 0.2,
      metalness: 0.8
    });
    const up = new THREE.Vector3(0, 1, 0);

    ARM_DIRECTIONS.forEach((dir, i) => {
      const tipPos = new THREE.Vector3(dir.x * motorRadius, bh * 0.45, dir.z * motorRadius);

      if (!chasisModel) {
        const armGeo = new THREE.CylinderGeometry(armR, armR, motorRadius, 12);
        const armMesh = new THREE.Mesh(armGeo, armMat);
        armMesh.position.copy(dir.clone().multiplyScalar(motorRadius / 2));
        armMesh.position.y = bh * 0.45;
        const norm = new THREE.Vector3(dir.x, 0, dir.z).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(up, norm);
        armMesh.setRotationFromQuaternion(q);
        armMesh.castShadow = true;
        droneGroup.add(armMesh);

        // Arm tip mount ring
        const mountGeo = new THREE.CylinderGeometry(armR * 2.1, armR * 2.1, 0.003, 12);
        const mountMesh = new THREE.Mesh(mountGeo, frameMat);
        mountMesh.position.copy(tipPos);
        droneGroup.add(mountMesh);

        // Mount screws
        const screwGeo = new THREE.CylinderGeometry(0.0008, 0.0008, 0.0006, 6);
        const screwMat = createMaterial(0x64748b, 0.2, 0.9);
        const screwDist = armR * 1.5;
        [[-screwDist,-screwDist],[-screwDist,screwDist],[screwDist,-screwDist],[screwDist,screwDist]].forEach(soff => {
          const screw = new THREE.Mesh(screwGeo, screwMat);
          screw.position.set(tipPos.x + soff[0], tipPos.y + 0.0016, tipPos.z + soff[1]);
          droneGroup.add(screw);
        });

        // Landing legs
        const legHeight = 0.12;
        const legGeo = new THREE.CylinderGeometry(0.003, 0.002, legHeight, 6);
        const legMesh = new THREE.Mesh(legGeo, frameMat);
        legMesh.position.copy(tipPos);
        legMesh.position.y -= legHeight / 2 + 0.002;
        const qLeg = new THREE.Quaternion().setFromUnitVectors(up, new THREE.Vector3(0, -1, 0));
        legMesh.setRotationFromQuaternion(qLeg);
        legMesh.castShadow = true;
        droneGroup.add(legMesh);
      }

      // Motors & Propellers (identical detail to exp1)
      const motor = visualMotor;
      const prop = visualProp;
      if (motor) {
        const bellH = motor.bell_height_mm / 1000;
        const motorY = tipPos.y + 0.0015;

        const heroMotor = buildMotorMesh(motor);
        heroMotor.group.position.set(tipPos.x, motorY - 0.004, tipPos.z);
        heroMotor.group.castShadow = true;
        heroMotor.group.name = "motor_" + i;
        droneGroup.add(heroMotor.group);
        // No shared _motorSpinGrps push here: this view's props are spun
        // individually by tick()'s name-based traverse (proportional to each
        // motor's live thrust share), not the shared idle-spin animateProps().

        if (prop) {
          const propR = prop.diameter_m / 2;
          const heroProp = buildPropellerMesh(prop, PROP_SIGNS[i]);
          const propY = motorY + bellH * 1.5 + heroProp.dims.hubH / 2;

          heroProp.group.name = "propeller_" + i;
          heroProp.group.position.set(tipPos.x, propY, tipPos.z);
          heroProp.group.castShadow = true;
          droneGroup.add(heroProp.group);

          // Blur disc
          const discGeo = new THREE.CircleGeometry(propR * 1.02, 32);
          const discMat = new THREE.MeshBasicMaterial({ color: 0x111827, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false });
          const discMesh = new THREE.Mesh(discGeo, discMat);
          discMesh.rotation.x = -Math.PI / 2;
          heroProp.group.add(discMesh);
          _blurDscs.push(discMat);
        }
      }
    });

    // Battery Mesh
    const bat = sel.battery;
    if (bat) {
      buildBatteryMesh(bat, droneGroup, frame);
    }

    // Payload Mesh
    const payloads = sel.payloads;
    if (payloads && payloads.length > 0) {
      buildPayloadMesh(payloads, droneGroup, frame);
    }

    // ESC � key may come from exp1 handoff as 'esc'
    const esc = sel.esc;
    if (esc) {
      if (esc.quantity === 1) {
        const escGeo = new THREE.BoxGeometry(0.032, 0.003, 0.032);
        const escMesh = new THREE.Mesh(escGeo, createMat(0x14532d, 0.7, 0.1));
        escMesh.position.set(0, 0.008, 0);
        droneGroup.add(escMesh);
        const spacerGeo = new THREE.CylinderGeometry(0.001, 0.001, 0.006, 6);
        const spacerMat = createMat(0xf59e0b, 0.5, 0.2);
        [[-0.012, -0.012], [0.012, -0.012], [-0.012, 0.012], [0.012, 0.012]].forEach(pt => {
          const spacer = new THREE.Mesh(spacerGeo, spacerMat);
          spacer.position.set(pt[0], 0.0125, pt[1]);
          droneGroup.add(spacer);
        });
      } else {
        const motorRadius2 = wheelbase / 2000;
        ARM_DIRECTIONS.forEach(dir => {
          const escPos = dir.clone().multiplyScalar(motorRadius2 * 0.45);
          const escMesh = new THREE.Mesh(
            new THREE.BoxGeometry(0.014, 0.003, 0.024),
            createMat(0x111827, 0.85, 0.0)
          );
          escMesh.position.set(escPos.x, bh * 0.45 + 0.004, escPos.z);
          escMesh.rotation.y = Math.atan2(dir.x, dir.z);
          droneGroup.add(escMesh);
        });
      }
    }

    // Flight Controller � handle both 'fc' and 'flight_controller' keys (exp1 handoff uses flight_controller)
    const fc = sel.fc || sel.flight_controller;
    if (fc) {
      const fcY = esc && esc.quantity === 1 ? 0.018 : 0.010;
      const fcMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.030, 0.003, 0.030),
        createMat(0x14532d, 0.7, 0.1)
      );
      fcMesh.position.set(0, fcY, 0);
      droneGroup.add(fcMesh);
    }

    // Receiver & antennas � handle both 'rx' and 'receiver' keys (exp1 handoff uses receiver)
    const rx = sel.rx || sel.receiver;
    if (rx) {
      const rxMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.018, 0.004, 0.013),
        createMat(0x1f2937, 0.8, 0.05)
      );
      rxMesh.position.set(0, 0.003, bz * 0.32);
      droneGroup.add(rxMesh);

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
      droneGroup.add(antLGroup);

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
      droneGroup.add(antRGroup);
    }

    // CoG Indicator crosshair
    const cgIndGroup = new THREE.Group();
    cgIndicator = new THREE.Mesh(new THREE.SphereGeometry(0.006, 12, 12), createMaterial(0x10b981, 0.2, 0.8));
    cgIndGroup.add(cgIndicator);

    const axisX = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.001, 0.001), createMaterial(0x10b981, 0.2, 0.8));
    const axisZ = new THREE.Mesh(new THREE.BoxGeometry(0.001, 0.001, 0.04), createMaterial(0x10b981, 0.2, 0.8));
    cgIndGroup.add(axisX);
    cgIndGroup.add(axisZ);

    cgIndGroup.position.set(0, bh + 0.006, 0);
    droneGroup.add(cgIndGroup);
    cgIndicator = cgIndGroup;

    // 10mm Safety Circle
    const ringGeo = new THREE.RingGeometry(0.0098, 0.0102, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x10b981, side: THREE.DoubleSide });
    boundaryRing = new THREE.Mesh(ringGeo, ringMat);
    boundaryRing.rotation.x = Math.PI / 2;
    boundaryRing.position.set(0, bh + 0.004, 0);
    droneGroup.add(boundaryRing);
  }

  function buildBatteryMesh(bat, parentGroup, frame) {
    const bh = frame ? frame.body_size_mm[1] / 1000 : 0.026;

    const capacity = bat.capacity_mah;
    const normVal = Math.min(Math.max((capacity - 800) / 3400, 0), 1);
    const batW = 0.068 + normVal * 0.076;
    const batH = 0.026 + normVal * 0.016;
    const batD = 0.020 + normVal * 0.018;

    const cellColors = { 3: 0x6e2a14, 4: 0x1f2937, 6: 0x1e1b4b };
    const battColor = cellColors[bat.cells] || 0x22252a;

    const batGeo = new THREE.BoxGeometry(batW, batH, batD);
    const batMat = createMaterial(battColor, 0.8, 0.05);
    batteryMesh = new THREE.Mesh(batGeo, batMat);

    const battY = -batH / 2 - 0.003;
    batteryMesh.position.set(
      state.selections.battery_pos.x / 1000,
      battY,
      -state.selections.battery_pos.y / 1000
    );
    batteryMesh.castShadow = true;
    batteryMesh.receiveShadow = true;
    parentGroup.add(batteryMesh);

    // XT60 connector
    const xt60Geo = new THREE.BoxGeometry(0.008, 0.006, 0.012);
    const xt60Mat = createMat(0xeab308, 0.4, 0.1);
    const xt60Mesh = new THREE.Mesh(xt60Geo, xt60Mat);
    xt60Mesh.position.set(
      state.selections.battery_pos.x / 1000,
      battY,
      -state.selections.battery_pos.y / 1000 + batD / 2 + 0.004
    );
    parentGroup.add(xt60Mesh);

    // Red & black power wires
    const wireGeo = new THREE.CylinderGeometry(0.001, 0.001, 0.016, 6);
    const wireRed = new THREE.Mesh(wireGeo, createMat(0xef4444, 0.7, 0.0));
    wireRed.position.set(
      state.selections.battery_pos.x / 1000 - 0.002,
      battY + 0.002,
      -state.selections.battery_pos.y / 1000 + batD / 2 + 0.009
    );
    wireRed.rotation.x = Math.PI / 2;
    parentGroup.add(wireRed);

    const wireBlack = new THREE.Mesh(wireGeo, createMat(0x1e293b, 0.7, 0.0));
    wireBlack.position.set(
      state.selections.battery_pos.x / 1000 + 0.002,
      battY + 0.002,
      -state.selections.battery_pos.y / 1000 + batD / 2 + 0.009
    );
    wireBlack.rotation.x = Math.PI / 2;
    parentGroup.add(wireBlack);

    // Anti-slip pad
    const padGeo = new THREE.BoxGeometry(batW * 0.9, 0.002, batD * 0.9);
    const padMesh = new THREE.Mesh(padGeo, createMat(0x111827, 0.9, 0.0));
    padMesh.position.set(
      state.selections.battery_pos.x / 1000,
      -0.001,
      -state.selections.battery_pos.y / 1000
    );
    parentGroup.add(padMesh);

    // Battery straps
    const strapOffsets = [
      state.selections.battery_pos.x / 1000 - batW * 0.25,
      state.selections.battery_pos.x / 1000 + batW * 0.25
    ];
    strapOffsets.forEach(function (xOff) {
      const strapGeo = new THREE.BoxGeometry(batD * 1.05, batH + bh + 0.006, 0.008);
      const strapMesh = new THREE.Mesh(strapGeo, createMat(0x111827, 0.9, 0.0));
      strapMesh.position.set(xOff, (bh - batH) / 2, -state.selections.battery_pos.y / 1000);
      strapMesh.rotation.y = Math.PI / 2;
      parentGroup.add(strapMesh);
    });
  }

  function buildPayloadMesh(payloads, parentGroup, frame) {
    payloadMesh = new THREE.Group();
    payloads.forEach(p => { _addPayloadToGroup(p, frame, payloadMesh); });
    parentGroup.add(payloadMesh);
  }

  // Detailed payload renderer � identical detail to exp1's addPayload()
  function _addPayloadToGroup(p, frame, targetGroup) {
    const bw = frame ? frame.body_size_mm[0] / 1000 : 0.088;
    const bz = frame ? frame.body_size_mm[2] / 1000 : 0.088;

    switch (p.id) {
      case 'gimbal_2axis':
      case 'gimbal_3axis': {
        const g = new THREE.Group();
        const ballGeoP = new THREE.SphereGeometry(0.003, 8, 8);
        const ballMatP = createMat(0x2563eb, 0.9, 0.0);
        [[-0.015, -0.015], [0.015, -0.015], [-0.015, 0.015], [0.015, 0.015]].forEach(off => {
          const ball = new THREE.Mesh(ballGeoP, ballMatP);
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
        targetGroup.add(g);
        break;
      }

      case 'camera_gopro': {
        const g = new THREE.Group();
        const mountGeo = new THREE.BoxGeometry(0.036, 0.028, 0.024);
        const mount = new THREE.Mesh(mountGeo, createMat(0x2563eb, 0.8, 0.0));
        mount.position.y = frame ? frame.body_size_mm[1] / 1000 + 0.014 : 0.036;
        mount.position.z = -bw * 0.32;
        mount.rotation.x = -0.15;
        g.add(mount);
        const cam = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.024, 0.018), createMat(0x111827, 0.6, 0.1));
        cam.position.copy(mount.position);
        cam.rotation.x = mount.rotation.x;
        g.add(cam);
        const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.004, 12), createMat(0x1e3a8a, 0.1, 0.8));
        lens.rotation.x = Math.PI / 2;
        lens.position.copy(cam.position).add(new THREE.Vector3(0.007, 0, -0.010));
        g.add(lens);
        targetGroup.add(g);
        break;
      }

      case 'camera_fpv_nano': {
        const g = new THREE.Group();
        const sideMat = createMat(0x9ca3af, 0.4, 0.6);
        const left = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.015, 0.012), sideMat);
        left.position.x = -0.008;
        const right = left.clone();
        right.position.x = 0.008;
        g.add(left);
        g.add(right);
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.012), createMat(0x111827, 0.6, 0.1)));
        const lensN = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.005, 10), createMat(0x1e293b, 0.1, 0.9));
        lensN.rotation.x = Math.PI / 2;
        lensN.position.z = -0.0085;
        g.add(lensN);
        g.position.set(0, (frame ? frame.body_size_mm[1] / 1000 : 0.026) / 2, -bw * 0.42);
        g.rotation.x = 0.25;
        targetGroup.add(g);
        break;
      }

      case 'gps_m8n':
      case 'gps_m9n_compass': {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.006, 16), createMat(0x1f2937, 0.6, 0.1)));
        const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.012, 8), createMat(0xd1d5db, 0.3, 0.7));
        ant.position.y = 0.009;
        g.add(ant);
        g.position.set(-bw * 0.2, (frame ? frame.body_size_mm[1] / 1000 : 0.026) + 0.006, bz * 0.2);
        targetGroup.add(g);
        break;
      }

      case 'lidar_tfmini': {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.012, 0.010), createMat(0x374151, 0.5, 0.3)));
        const emR = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.004, 10), createMat(0x1e3a8a, 0.1, 0.8));
        emR.rotation.x = Math.PI / 2;
        emR.position.set(-0.004, 0, -0.006);
        g.add(emR);
        const rcvR = emR.clone();
        rcvR.position.set(0.004, 0, -0.006);
        g.add(rcvR);
        g.position.set(0, -0.008, 0);
        targetGroup.add(g);
        break;
      }

      case 'lidar_garmin': {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.014, 16), createMat(0x1f2937, 0.7, 0.1)));
        g.position.set(0, -0.008, 0);
        targetGroup.add(g);
        break;
      }

      case 'telemetry_915': {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.008, 0.014), createMat(0x2563eb, 0.7, 0.1)));
        const whip = new THREE.Mesh(new THREE.CylinderGeometry(0.0006, 0.0006, 0.070, 5), createMat(0x111827, 0.9, 0.0));
        whip.position.set(0.010, 0.035, 0);
        whip.rotation.z = -0.15;
        g.add(whip);
        g.position.set(bw * 0.4, (frame ? frame.body_size_mm[1] / 1000 : 0.026) / 2, 0);
        g.rotation.y = Math.PI / 2;
        targetGroup.add(g);
        break;
      }

      case 'fpv_vtx': {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.020, 0.008, 0.016), createMat(0x374151, 0.5, 0.7)));
        const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.0008, 0.0008, 0.050, 6), createMat(0x111827, 0.9, 0.0));
        antenna.position.set(0, 0.025, 0.006);
        antenna.rotation.x = 0.2;
        g.add(antenna);
        g.position.set(0, frame ? frame.body_size_mm[1] / 1000 + 0.005 : 0.031, bz * 0.38);
        targetGroup.add(g);
        break;
      }

      default:
        break;
    }
  }

  function buildCantileverScene(sel, sc) {
    cantileverGroup = new THREE.Group();
    cantileverGroup.position.set(-0.10, 0, 0);
    sc.add(cantileverGroup);

    activeMaterial = sel.material;
    activeLength_mm = sel.frame ? sel.frame.arm_length_mm : 250;
    isBroken = false;
    breakProgress = 0.0;
    deflectionForce = 0;
    targetForce = 0;
    debrisParticles = [];

    const L_m = activeLength_mm / 1000;

    // Base clamp
    const cW = 0.05, cH = 0.06, cD = 0.04;
    clampMesh = new THREE.Mesh(new THREE.BoxGeometry(cW, cH, cD), createMaterial(0x475569, 0.4, 0.5));
    clampMesh.position.set(-cW / 2, cH / 2, 0);
    clampMesh.castShadow = true;
    clampMesh.receiveShadow = true;
    cantileverGroup.add(clampMesh);

    // Hollow Rectangular Tube with Profile Scaling
    const profile = state.selections.frame?.arm_profile || { b_mm: 15, h_mm: 8, t_mm: 1.5 };
    const bW = L_m;
    const bH = profile.h_mm / 1000; 
    const bD = profile.b_mm / 1000; 
    const segX = 48; 
    const beamGeo = new THREE.BoxGeometry(bW, bH, bD, segX, 1, 1);

    let matColor = 0x1c1c1e; // Carbon Fibre graphite
    if (activeMaterial && activeMaterial.id === 'aluminium') matColor = 0xa8a8a8; // Silver
    else if (activeMaterial && activeMaterial.id === 'nylon') matColor = 0xe8dcc8; // Off-white

    const colorAttr = [];
    const col = new THREE.Color(matColor);
    const posAttr = beamGeo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      colorAttr.push(col.r, col.g, col.b);
    }
    beamGeo.setAttribute('color', new THREE.Float32BufferAttribute(colorAttr, 3));

    const beamMat = new THREE.MeshStandardMaterial({
      roughness: activeMaterial && activeMaterial.id === 'aluminium' ? 0.4 : (activeMaterial && activeMaterial.id === 'nylon' ? 0.6 : 0.35),
      metalness: activeMaterial && activeMaterial.id === 'aluminium' ? 0.7 : 0.05,
      vertexColors: true,
      side: THREE.DoubleSide
    });
    beamMesh = new THREE.Mesh(beamGeo, beamMat);
    beamMesh.position.set(bW / 2, 0, 0);
    beamMesh.castShadow = true;
    beamMesh.receiveShadow = true;
    cantileverGroup.add(beamMesh);

    beamMesh.geometry.userData = {
      originalPositions: posAttr.clone(),
      length: bW,
      width: bD,
      height: bH,
      matColor: matColor
    };

    // Motor & Arrow
    testMotorMesh = new THREE.Group();
    testMotorMesh.position.set(L_m, 0, 0);
    cantileverGroup.add(testMotorMesh);

    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.012, 16), createMaterial(0x1e293b, 0.35, 0.7));
    bell.position.y = 0.006 + bH / 2;
    bell.castShadow = true;
    testMotorMesh.add(bell);

    const motorBase = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.004, 12), createMaterial(0x0f172a, 0.5, 0.2));
    motorBase.position.y = 0.002 + bH / 2;
    testMotorMesh.add(motorBase);

    // Arrow (Shaft + Head)
    const arrowMat = createMaterial(0x38bdf8, 0.2, 0.8, 0.65);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 0.04, 6), arrowMat);
    shaft.position.y = 0.035;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.004, 0.010, 8), arrowMat);
    head.position.y = 0.055;
    testMotorMesh.add(shaft);
    testMotorMesh.add(head);
  }

  function applyCantileverLoad(force) {
    targetForce = force;
  }

  function triggerArmBreak() {
    isBroken = true;
    breakProgress = 0.0;

    debrisParticles = [];
    const mat = activeMaterial || { id: 'carbon_fibre' };
    let matColor = 0x1c1c1e;
    if (mat.id === 'aluminium') matColor = 0xa8a8a8;
    else if (mat.id === 'nylon') matColor = 0xe8dcc8;

    for (let i = 0; i < 12; i++) {
      const particle = new THREE.Mesh(
        new THREE.BoxGeometry(0.002, 0.0015, 0.0015),
        new THREE.MeshStandardMaterial({ color: matColor, roughness: 0.5, metalness: 0.3 })
      );
      particle.position.set(0, 0, (Math.random() - 0.5) * 0.015);
      particle.velocity = new THREE.Vector3(
        (Math.random() - 0.3) * 0.15,
        Math.random() * 0.08 + 0.02,
        (Math.random() - 0.5) * 0.1
      );
      cantileverGroup.add(particle);
      debrisParticles.push(particle);
    }
  }

  function updateComponentPlacements(sel) {
    if (!droneGroup) return;
    if (batteryMesh && sel.battery && sel.battery_pos) {
      batteryMesh.position.x = sel.battery_pos.x / 1000;
      batteryMesh.position.z = -sel.battery_pos.y / 1000;
    }
    if (payloadMesh && sel.payloads && sel.payload_pos) {
      payloadMesh.position.x = sel.payload_pos.x / 1000;
      payloadMesh.position.z = -sel.payload_pos.y / 1000;
    }
  }

  function updateCGFeedback(cg) {
    if (!cgIndicator || !droneGroup) return;
    
    cgIndicator.position.x = cg.x_cg / 1000;
    cgIndicator.position.z = -cg.y_cg / 1000;

    const isSafe = (cg.offset_mm < 10.0);
    cgIndicator.children[0].material.color.setHex(isSafe ? 0x10b981 : 0xef4444);

    if (!state.isFlying) {
      if (cg.offset_mm < 0.001) {
        droneGroup.rotation.set(0, 0, 0);
      } else {
        const pivotHeight = 15;
        const tiltAngle = Math.atan(cg.offset_mm / pivotHeight);
        const dir = Math.atan2(-cg.y_cg, cg.x_cg);
        droneGroup.rotation.z = -Math.cos(dir) * tiltAngle;
        droneGroup.rotation.x = Math.sin(dir) * tiltAngle;
        droneGroup.rotation.y = 0;
      }
    }
  }

  function tick(delta, tabNum) {
    if (tabNum === 1 && droneGroup) {
      if (state.isFlying) {
        state.flightTime += delta;

        const cg = state.calculations;
        const wheelbase = state.selections.frame ? state.selections.frame.wheelbase_mm : 450;
        const shares = Calc.solvePerMotorThrust(cg.total_mass_g, cg.x_cg, cg.y_cg, wheelbase);
        const baseRPM = 45;

        droneGroup.traverse(function (child) {
          if (child.name && child.name.startsWith("propeller_")) {
            const motorIdx = parseInt(child.name.split('_')[1]);
            const shareVal = [shares.FR, shares.FL, shares.RR, shares.RL][motorIdx];
            child.rotation.y += delta * baseRPM * (shareVal / 0.25);
          }
        });

        const isBalanced = cg.offset_mm < 5.0;

        if (isBalanced) {
          const H_stand = 0.06 + (wheelbase / 1000) * 0.2;
          const targetY = H_stand + 0.15;
          droneGroup.position.y += (targetY - droneGroup.position.y) * delta * 1.5;

          const driftScale = cg.offset_mm / 5.0;
          const driftX = Math.sin(state.flightTime * 4) * (0.001 + driftScale * 0.003);
          const driftZ = Math.cos(state.flightTime * 3.5) * (0.001 + driftScale * 0.003);
          
          droneGroup.position.x = driftX;
          droneGroup.position.z = driftZ;
          
          const compensationTilt = Math.min(cg.offset_mm * 0.005, 0.05);
          const dirX = cg.offset_mm > 0 ? cg.x_cg / cg.offset_mm : 0;
          const dirY = cg.offset_mm > 0 ? cg.y_cg / cg.offset_mm : 0;
          
          droneGroup.rotation.z = -dirX * compensationTilt + Math.sin(state.flightTime * 5) * 0.002;
          droneGroup.rotation.x = -dirY * compensationTilt + Math.cos(state.flightTime * 4.5) * 0.002;
          droneGroup.rotation.y = 0;

          const elStatus = document.getElementById('flightStatusText');
          if (elStatus) {
            const pctFR = (shares.shares.FR * 100).toFixed(1);
            const pctFL = (shares.shares.FL * 100).toFixed(1);
            const pctRR = (shares.shares.RR * 100).toFixed(1);
            const pctRL = (shares.shares.RL * 100).toFixed(1);
            elStatus.textContent = `Stable Hover. FR: ${pctFR}% | FL: ${pctFL}% | RR: ${pctRR}% | RL: ${pctRL}%`;
            elStatus.style.color = 'var(--success)';
          }
        } else {
          const H_stand = 0.06 + (wheelbase / 1000) * 0.2;

          if (state.flightTime < 3.2) {
            const targetY = H_stand + 0.12;
            droneGroup.position.y += (targetY - droneGroup.position.y) * delta * 1.5;

            const driftRate = cg.offset_mm * 0.025;
            const dirX = cg.x_cg / cg.offset_mm;
            const dirY = cg.y_cg / cg.offset_mm;

            state.flightPos.x += dirX * driftRate * delta * (1.0 + state.flightTime * 1.2);
            state.flightPos.z -= dirY * driftRate * delta * (1.0 + state.flightTime * 1.2);

            droneGroup.position.x = state.flightPos.x;
            droneGroup.position.z = state.flightPos.z;

            const maxTilt = 0.45;
            const tiltAmt = Math.min(cg.offset_mm * 0.018 * (1.0 + state.flightTime * 1.8), maxTilt);
            droneGroup.rotation.z = -dirX * tiltAmt;
            droneGroup.rotation.x = -dirY * tiltAmt;
            droneGroup.rotation.y = Math.sin(state.flightTime * 3) * 0.05;

            const elStatus = document.getElementById('flightStatusText');
            if (elStatus) {
              elStatus.textContent = `IMU Unstable Drift! X: ${(droneGroup.position.x*1000).toFixed(1)}mm, Z: ${(droneGroup.position.z*1000).toFixed(1)}mm`;
              elStatus.style.color = 'var(--warning)';
            }
          } else {
            if (!state.angularVel) state.angularVel = new THREE.Vector3(0, 0, 0);
            if (state.fallVelocity === undefined) state.fallVelocity = 0;

            state.angularVel.x += cg.y_cg * 0.05 * delta;
            state.angularVel.z -= cg.x_cg * 0.05 * delta;
            droneGroup.rotation.x += state.angularVel.x * delta;
            droneGroup.rotation.z += state.angularVel.z * delta;

            const groundY = 0.02;
            if (droneGroup.position.y > groundY) {
              state.fallVelocity += Calc.g * delta;
              droneGroup.position.y -= state.fallVelocity * delta;
            } else {
              droneGroup.position.y = groundY;
              state.fallVelocity = -state.fallVelocity * 0.3; 
              state.angularVel.multiplyScalar(0.5); 
            }

            droneGroup.traverse(function (child) {
              if (child.name && child.name.startsWith("propeller_")) {
                child.rotation.y += delta * 3.0; 
              }
            });

            const elStatus = document.getElementById('flightStatusText');
            if (elStatus) {
              elStatus.textContent = `CRASH DETECTED! Severe CoG mismatch. Align components.`;
              elStatus.style.color = 'var(--danger)';
            }
          }
        }
      } else {
        const wheelbase = state.selections.frame ? state.selections.frame.wheelbase_mm : 450;
        const H_stand = 0.06 + (wheelbase / 1000) * 0.2;
        droneGroup.position.set(0, H_stand, 0);

        const cg = state.calculations;
        if (cg.offset_mm < 0.001) {
          droneGroup.rotation.set(0, 0, 0);
        } else {
          const pivotHeight = 15;
          const tiltAngle = Math.atan(cg.offset_mm / pivotHeight);
          const dir = Math.atan2(-cg.y_cg, cg.x_cg);
          droneGroup.rotation.z = -Math.cos(dir) * tiltAngle;
          droneGroup.rotation.x = Math.sin(dir) * tiltAngle;
          droneGroup.rotation.y = 0;
        }
      }
    }

    if (tabNum === 2 && cantileverGroup && beamMesh && testMotorMesh && activeMaterial) {
      const speed = isBroken ? 6.0 : 4.0;
      deflectionForce += (targetForce - deflectionForce) * Math.min(delta * speed, 1.0);

      const E = activeMaterial.youngs_modulus_gpa;
      const yieldStrength = Calc.materialYieldSeeded(activeMaterial);
      const L = activeLength_mm;
      
      const profile = state.selections.frame?.arm_profile || { b_mm: 15, h_mm: 8, t_mm: 1.5 };
      const b = profile.b_mm, h = profile.h_mm, t = profile.t_mm;
      const I = Calc.solveHollowInertia(b, h, t);

      const posAttr = beamMesh.geometry.attributes.position;
      const origPos = beamMesh.geometry.userData.originalPositions;
      const colorAttr = beamMesh.geometry.attributes.color;
      const L_m = beamMesh.geometry.userData.length;
      const bH = beamMesh.geometry.userData.height;
      const matColor = beamMesh.geometry.userData.matColor;

      if (isBroken) {
        breakProgress += delta * 1.8;
        const p = Math.min(breakProgress, 1.0);
        
        beamMesh.position.y = -p * 0.07;
        beamMesh.position.x = L_m / 2 + p * 0.015;
        beamMesh.rotation.z = -p * 0.5;

        testMotorMesh.position.y = -p * 0.07 - Math.sin(p * 0.5) * 0.01;
        testMotorMesh.position.x = L_m + p * 0.015;
        testMotorMesh.rotation.z = -p * 0.5;

        if (debrisParticles) {
          debrisParticles.forEach(particle => {
            particle.velocity.y -= Calc.g * delta;
            particle.position.x += particle.velocity.x * delta;
            particle.position.y += particle.velocity.y * delta;
            particle.position.z += particle.velocity.z * delta;
          });
        }

        for (let i = 0; i < posAttr.count; i++) posAttr.setY(i, origPos.getY(i));
        posAttr.needsUpdate = true;
        return;
      }

      const appliedStress = Calc.solveBendingStress(Calc.solveBendingMoment(deflectionForce, L), h, I);

      for (let i = 0; i < posAttr.count; i++) {
        const ox = origPos.getX(i);
        const globalX_mm = (ox + L_m / 2) * 1000;
        const dy = -Calc.solveDeflectionAtX(deflectionForce, globalX_mm, L, E, I);
        posAttr.setY(i, origPos.getY(i) + dy);

        const M_atX = Calc.solveBendingMomentAtX(deflectionForce, globalX_mm, L);
        const stress_atX = Calc.solveBendingStress(M_atX, h, I);
        const ratio = Math.min(stress_atX / yieldStrength, 1.2);

        const startColor = new THREE.Color(matColor);
        const midColor = new THREE.Color(0xffbf00); 
        const endColor = new THREE.Color(0xef4444); 
        const rColor = new THREE.Color();
        if (ratio < 0.5) {
          rColor.lerpColors(startColor, midColor, ratio * 2.0);
        } else {
          rColor.lerpColors(midColor, endColor, (ratio - 0.5) * 2.0);
        }
        colorAttr.setXYZ(i, rColor.r, rColor.g, rColor.b);
      }

      posAttr.needsUpdate = true;
      colorAttr.needsUpdate = true;

      const maxDef = -Calc.solveDeflectionAtX(deflectionForce, L, L, E, I);
      testMotorMesh.position.y = maxDef;
      const slope = -(deflectionForce * (L/1000) * (L/1000)) / (2.0 * (E * 1e9) * I);
      testMotorMesh.rotation.z = slope;

      const shaft = testMotorMesh.children[2];
      const head = testMotorMesh.children[3];
      if (shaft && head) {
        const forceRatio = Math.min(deflectionForce / 10.0, 1.0);
        shaft.scale.y = 0.5 + forceRatio * 1.5;
        shaft.position.y = (0.04 * shaft.scale.y) / 2 + bH / 2 + 0.012;
        head.position.y = bH / 2 + 0.012 + 0.04 * shaft.scale.y;
      }
    }
  }

  return {
    updateFromSelections: updateFromSelections,
    animateProps: animateProps,
    setSimRPM: setSimRPM,
    getDroneGroup: function () { return _droneGrp; },
    updateThrustStandDisplay: updateBenchHUD,
    setBurnState: setBurnState,
    rebuildScene: rebuildScene,
    updateComponentPlacements: updateComponentPlacements,
    updateCGFeedback: updateCGFeedback,
    applyCantileverLoad: applyCantileverLoad,
    triggerArmBreak: triggerArmBreak,
    tick: tick,
    batteryMesh: function () { return batteryMesh; },
    payloadMesh: function () { return payloadMesh; }
  };
})();
window.DroneModel = DroneModel;

// ═══════════════════════════════════════════════════════════════════
// 5. MODULE 1 UI IIFE
// ═══════════════════════════════════════════════════════════════════
const UI = (function () {
  'use strict';

  function buildSelectionGrids(db, state, handleSelection) {
    buildSharedTileGrid('frameTilesContainer', db.frames, {
      isMulti: false,
      selectedIds: state.selections.frame ? state.selections.frame.id : null,
      name: 'frame',
      idPrefix: 'frame_',
      specF: (item) => `${item.wheelbase_mm}mm | ${item.mass_g}g`,
      onSelect: (item) => handleSelection('frame', item.id)
    });

    buildSharedTileGrid('batteryTilesContainer', db.batteries, {
      isMulti: false,
      selectedIds: state.selections.battery ? state.selections.battery.id : null,
      name: 'battery',
      idPrefix: 'battery_',
      specF: (item) => `${item.cells}S | ${item.capacity_mah}mAh | ${item.mass_g}g`,
      onSelect: (item) => handleSelection('battery', item.id)
    });

    buildSharedTileGrid('payloadTilesContainer', db.payloads, {
      isMulti: true,
      selectedIds: state.selections.payloads ? state.selections.payloads.map(p => p.id) : [],
      name: 'payloads',
      idPrefix: 'payload_',
      specF: (item) => `${item.mass_g}g`,
      onSelect: (item, checked) => handleSelection('payloads', item.id, checked)
    });
  }

  function refreshPlacementSliders(selections) {
    const frame = selections.frame;
    const halfW = frame ? frame.body_size_mm[0] / 2 : 44;
    const halfL = frame ? frame.body_size_mm[2] / 2 : 44;

    const batXLim = Math.max(0, halfW - 10);
    const batYLim = Math.max(0, halfL - 15);
    const payXLim = Math.max(0, halfW - 8);
    const payYLim = Math.max(0, halfL - 8);

    const sliders = [
      { id: 'batX', val: selections.battery_pos.x, lim: batXLim },
      { id: 'batY', val: selections.battery_pos.y, lim: batYLim },
      { id: 'payloadX', val: selections.payload_pos.x, lim: payXLim },
      { id: 'payloadY', val: selections.payload_pos.y, lim: payYLim }
    ];

    sliders.forEach(function (s) {
      const el = document.getElementById(s.id);
      if (el) {
        el.min = -s.lim;
        el.max = s.lim;
        
        let val = selections[s.id.startsWith('bat') ? 'battery_pos' : 'payload_pos'][s.id.endsWith('X') ? 'x' : 'y'];
        if (val < -s.lim) val = -s.lim;
        if (val > s.lim) val = s.lim;
        selections[s.id.startsWith('bat') ? 'battery_pos' : 'payload_pos'][s.id.endsWith('X') ? 'x' : 'y'] = val;
        el.value = val;

        const valLbl = document.getElementById(s.id + 'Val');
        if (valLbl) valLbl.textContent = Math.round(val) + ' mm';
      }
    });
  }

  function updateChecklist(selections, cgOffset) {
    const frameOk = selections.frame !== null;
    const battOk = selections.battery !== null;
    const payOk = selections.payloads && selections.payloads.length > 0;
    // Single lab-wide balance threshold from the shared constants: pass < 10 mm,
    // ideal < 5 mm (spec §3.3). Falls back if the shared runtime isn't present.
    const _L = (window.VLAB_CONST && window.VLAB_CONST.LIMITS) ? window.VLAB_CONST.LIMITS : null;
    const passMm = _L ? _L.cg_offset_pass_mm : 10.0;
    const idealMm = _L ? _L.cg_offset_ideal_mm : 5.0;
    const cgOk = cgOffset < passMm && frameOk && battOk && payOk;

    const frameVal = frameOk ? selections.frame.label.split(' — ')[0] : 'Pending';
    const battVal = battOk ? selections.battery.label.split(' — ')[0] : 'Pending';
    const payVal = payOk ? (selections.payloads.length > 1 ? `${selections.payloads.length} Selected` : selections.payloads[0].label.split(' ')[0]) : 'Pending';
    const balVal = cgOk ? (cgOffset < 0.001 ? `Perfect (${cgOffset.toFixed(3)} mm)` : (cgOffset < idealMm ? `Ideal (${cgOffset.toFixed(3)} mm)` : `Balanced (${cgOffset.toFixed(3)} mm)`)) : (frameOk && battOk && payOk ? `Offset: ${cgOffset.toFixed(3)} mm (limit ${passMm} mm)` : 'Pending');

    // Uniform objectives panel (shared VLABLab), matching Experiments 4-6. The
    // unbalanced CG surfaces as an amber "warn" until it is brought within the
    // limit. Falls back to toggling the static checklist items when the shared
    // kit is absent (e.g. headless tests).
    const container = document.getElementById('checklistContainer');
    if (window.VLABLab && container) {
      window.VLABLab.objectives(container, [
        { id: 'frame',   label: 'Select Airframe Frame', test: function () { return frameOk; }, value: function () { return frameOk ? frameVal : ''; } },
        { id: 'battery', label: 'Select Battery Pack',   test: function () { return battOk; },  value: function () { return battOk ? battVal : ''; } },
        { id: 'payload', label: 'Select Sensors/Payload', test: function () { return payOk; },  value: function () { return payOk ? payVal : ''; } },
        { id: 'balance', label: 'Aero Balance (r_CG < ' + passMm + ' mm)', test: function () { return cgOk; }, value: function () { return (frameOk && battOk && payOk) ? balVal : ''; }, warn: function () { return frameOk && battOk && payOk && !cgOk; } }
      ], selections, { title: 'Assembly & balancing' });
    } else {
      const setCheck = function (id, ok, valText) {
        const item = document.getElementById(id);
        if (!item) return;
        const icon = item.querySelector('.chk-icon');
        const val = item.querySelector('.checklist-val');
        if (icon) {
          icon.className = 'chk-icon ' + (ok ? 'done' : 'pending');
          icon.innerHTML = ok ? '✓' : '';
        }
        if (val) val.textContent = valText;
      };
      setCheck('chkFrame', frameOk, frameVal);
      setCheck('chkBattery', battOk, battVal);
      setCheck('chkPayload', payOk, payVal);
      setCheck('chkBalance', cgOk, balVal);
    }

    const btn = document.getElementById('btnNextModule');
    if (btn) {
      // Real-time fault blocking: even a balanced CG shouldn't proceed while
      // VLABValidate.check() reports a hard error against exp1's already-
      // selected motor/prop/ESC (frame doesn't fit the prop, TWR too low,
      // battery can't supply the current, voltage sags below the floor).
      const blocked = (window.VLAB && window.VLAB.hasBlockingViolations) ? window.VLAB.hasBlockingViolations() : false;
      if (cgOk && !blocked) {
        btn.removeAttribute('disabled');
        btn.textContent = 'Lock Design & Proceed';
      } else {
        btn.setAttribute('disabled', 'true');
        btn.textContent = blocked && cgOk ? 'Resolve Build Conflict' : 'Frame Unbalanced';
      }
    }
  }

  return {
    buildSelectionGrids,
    refreshPlacementSliders,
    updateChecklist
  };
})();
window.UI = UI;

// ═══════════════════════════════════════════════════════════════════
// 6. MODULE 2 UI IIFE
// ═══════════════════════════════════════════════════════════════════
const Mod2UI = (function () {
  'use strict';

  function buildControlTiles(db, activeSelection, onSelectMaterial, onSelectLength) {
    buildSharedTileGrid('matTilesContainer', db.materials, {
      isMulti: false,
      selectedIds: activeSelection.material ? activeSelection.material.id : null,
      name: 'material',
      idPrefix: 'mat_',
      specF: (item) => `&sigma;_y: ${item.yield_strength_mpa} MPa`,
      onSelect: (item) => onSelectMaterial(item)
    });

    const lengths = [
      { id: '150', label: '150 mm', spec: 'Medium' },
      { id: '250', label: '250 mm', spec: 'Standard' },
      { id: '350', label: '350 mm', spec: 'Cinematography' }
    ];
    buildSharedTileGrid('lenTilesContainer', lengths, {
      isMulti: false,
      selectedIds: String(activeSelection.length),
      name: 'length',
      idPrefix: 'len_',
      specF: (item) => item.spec,
      onSelect: (item) => onSelectLength(parseInt(item.id))
    });
  }

  // ── Unlock card 3D scene (chassis.glb) ────────────────────────────
  let _unlAnim = null;
  let _unlScn = null;
  let _unlRndr = null;
  let _unlCam = null;
  let _unlCtrls = null;
  let _chassisGroup = null;
  let _unlClk = null;

  function initUnlock() {
    const canvas = document.getElementById('unlockCanvas');
    if (!canvas) return;

    if (_unlAnim) {
      cancelAnimationFrame(_unlAnim);
      _unlAnim = null;
    }

    // Pass the wrapper div so initBase3DScene measures the correct clientWidth/Height.
    const base = initBase3DScene(canvas, canvas.parentElement, {
      bgColor: 0xf3f4f6,
      fov: 40,
      camPos: { x: 0.20, y: 0.15, z: 0.28 },
      alpha: true,
      ctrls: { minDist: 0.10, maxDist: 2.0, target: { x: 0, y: 0.01, z: 0 } },
      ambientIntensity: 0.70,
      sunIntensity: 0.90,
      sunPos: { x: 1.0, y: 2.0, z: 1.0 }
    });
    _unlScn = base.scn;
    _unlRndr = base.rndr;
    _unlCam = base.cam;
    _unlCtrls = base.ctrls;

    // Force correct size now that the wrapper has rendered dimensions.
    if (base.handleResize) base.handleResize();

    _chassisGroup = new THREE.Group();
    _unlScn.add(_chassisGroup);

    // Fallback procedural chassis shape (box frame silhouette).
    function createProcedural() {
      while (_chassisGroup.children.length > 0) {
        _chassisGroup.remove(_chassisGroup.children[0]);
      }
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.35, metalness: 0.75 });
      const accentMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.5, metalness: 0.3 });

      // Central body plate.
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.012, 0.10), bodyMat);
      _chassisGroup.add(body);

      // Four arms.
      const armLen = 0.09;
      const armGeo = new THREE.BoxGeometry(armLen, 0.008, 0.012);
      const armOffsets = [
        { x:  (0.10 / 2 + armLen / 2), z:  (0.10 / 2 + armLen / 2), ry:  Math.PI / 4 },
        { x: -(0.10 / 2 + armLen / 2), z:  (0.10 / 2 + armLen / 2), ry: -Math.PI / 4 },
        { x:  (0.10 / 2 + armLen / 2), z: -(0.10 / 2 + armLen / 2), ry: -Math.PI / 4 },
        { x: -(0.10 / 2 + armLen / 2), z: -(0.10 / 2 + armLen / 2), ry:  Math.PI / 4 }
      ];
      armOffsets.forEach(a => {
        const arm = new THREE.Mesh(armGeo, bodyMat);
        arm.position.set(a.x * 0.6, 0, a.z * 0.6);
        arm.rotation.y = a.ry;
        _chassisGroup.add(arm);

        // Motor mount disc at tip.
        const mount = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.008, 16), accentMat);
        mount.position.set(a.x, 0, a.z);
        _chassisGroup.add(mount);
      });

      // Landing legs.
      const legMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.6, metalness: 0.4 });
      [[-0.055, -0.055], [0.055, -0.055], [-0.055, 0.055], [0.055, 0.055]].forEach(([x, z]) => {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.025, 8), legMat);
        leg.position.set(x, -0.018, z);
        _chassisGroup.add(leg);
      });
    }

    if (window.GLTFLoader) {
      const loader = new window.GLTFLoader();

      // chasis.glb uses Draco mesh compression — attach a DRACOLoader to decode it.
      if (window.DRACOLoader) {
        const draco = new window.DRACOLoader();
        draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
        loader.setDRACOLoader(draco);
      }

      loader.load('asset/chasis.glb', function (gltf) {
        while (_chassisGroup.children.length > 0) {
          _chassisGroup.remove(_chassisGroup.children[0]);
        }

        const model = gltf.scene;

        // Auto-scale to a consistent display size (~0.18 m wide).
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z) || 1.0;
        const scale = 0.18 / maxDim;
        model.scale.set(scale, scale, scale);

        // Centre the model.
        const center = new THREE.Vector3();
        box.getCenter(center);
        model.position.set(-center.x * scale, -center.y * scale, -center.z * scale);

        model.traverse(c => {
          if (c.isMesh) {
            c.castShadow = true;
            c.receiveShadow = true;
          }
        });

        _chassisGroup.add(model);
      }, undefined, function (err) {
        console.warn('chasis.glb load failed, using procedural fallback', err);
        createProcedural();
      });
    } else {
      createProcedural();
    }

    _unlClk = new THREE.Clock();

    function render() {
      _unlAnim = requestAnimationFrame(render);
      const dt = _unlClk.getDelta();
      _unlCtrls.update();
      if (_chassisGroup) _chassisGroup.rotation.y += 0.30 * dt;
      _unlRndr.render(_unlScn, _unlCam);
    }
    render();
  }

  return {
    buildControlTiles,
    initUnlockScene: initUnlock
  };
})();
window.Mod2UI = Mod2UI;

// ═══════════════════════════════════════════════════════════════════
// 7. MODULE 1 ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════
const Module1 = (function () {
  'use strict';

  let cgChart = null;
  let activeFault = 'none';
  let _bannerCtl = null;
  let _lastViolations = [];

  // ── Live cross-experiment sync (spec: "the local storage is the vital
  // organ of the lab") ────────────────────────────────────────────────────
  // Mirrors this page's own selections (frame/battery/payloads — motor/
  // prop/ESC are exp1's) into the shared store on every change, not just
  // at Lock & Proceed, and re-runs VLABValidate.check() so cross-experiment
  // violations (prop doesn't fit this frame, mass makes TWR too low,
  // battery can't supply exp1's full-throttle current) are visible and can
  // gate the Lock button live.
  function _syncSharedStore() {
    if (!window.VLABStore) return;
    window.VLABStore.setComponents({
      frameId: state.selections.frame ? state.selections.frame.id : null,
      batteryId: state.selections.battery ? state.selections.battery.id : null,
      payloadIds: (state.selections.payloads || []).map(function (p) { return p.id; })
    });

    if (!window.VLABUi || !window.VLABValidate) return;
    const catalog = window.VLAB_CATALOG || {};
    const host = document.getElementById('vlBannerHost');
    if (!host) return;
    if (!_bannerCtl) {
      _bannerCtl = window.VLABUi.mountBanner(host, {
        catalog: catalog,
        currentExp: 'exp2',
        onChange: function () { host.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
      });
    }
    const res = _bannerCtl.refresh();
    _lastViolations = (res && res.violations) || [];
    renderOverrideNotices();
  }

  function _hasBlockingViolations() {
    return _lastViolations.some(function (v) { return v.severity === 'error'; });
  }

  // ── Fault injection (VLABLab.scenario) ──────────────────────────────────
  const FAULT_OPTIONS = [
    { id: 'none', label: 'None (design as configured)', desc: 'Battery and payload sit at your chosen coordinates.' },
    { id: 'battery_corner', label: 'Battery slammed to one corner', desc: 'Worst-case rigging error: battery pinned to the extreme rear-right corner of the deck.', fault: true }
  ];

  function renderFaultScenario() {
    const host = document.getElementById('cgFaultScenario');
    if (!window.VLABLab || !host) return;
    window.VLABLab.scenario(host, {
      title: 'Rigging fault scenario',
      current: activeFault,
      options: FAULT_OPTIONS,
      onSelect: function (id) {
        activeFault = id;
        refresh();
      }
    });
  }

  // ── Structural/balance verdict (VLABLab.verdict) ────────────────────────
  function renderVerdict(cg, passMm) {
    const host = document.getElementById('cgVerdict');
    if (!window.VLABLab || !host) return;
    const hasParts = !!(state.selections.frame && state.selections.battery && state.selections.payloads && state.selections.payloads.length);
    let tone = 'warn', label = 'Select all components', note = '';
    if (hasParts) {
      if (cg.offset_mm < passMm) {
        tone = 'pass'; label = 'CG BALANCED'; note = 'r_CG = ' + cg.offset_mm.toFixed(2) + ' mm (< ' + passMm + ' mm limit)';
      } else {
        tone = 'fail'; label = 'CG OUT OF ENVELOPE'; note = 'r_CG = ' + cg.offset_mm.toFixed(2) + ' mm exceeds the ' + passMm + ' mm limit — autopilot will bias motor thrust to stay level';
      }
    }
    window.VLABLab.verdict(host, { label: label, tone: tone, note: note });
  }

  function init() {
    Calc.loadCatalog()
      .then(function (data) {
        database = data;
        window._exp2DB = data; // expose for DroneModel visual motor/prop resolver
        
        loadContinuationData();

        const cgHandoff = localStorage.getItem('vlabModule2_cg');
        if (!cgHandoff) {
          randomizeOffsets();
        }

        Scene.init(1);
        UI.buildSelectionGrids(database, state, handleSelection);
        bindListeners();
        setup3DDrag();
        refresh();
      })
      .catch(err => console.error('Database failed to load:', err));
  }

  function randomizeOffsets() {
    const frame = state.selections.frame;
    const halfW = frame ? frame.body_size_mm[0] / 2 : 44;
    const halfL = frame ? frame.body_size_mm[2] / 2 : 44;

    const batXLim = Math.max(0, halfW - 10);
    const batYLim = Math.max(0, halfL - 15);
    const payXLim = Math.max(0, halfW - 8);
    const payYLim = Math.max(0, halfL - 8);

    const randSign = () => Math.random() < 0.5 ? -1 : 1;
    const randVal = (limit) => randSign() * (0.4 + Math.random() * 0.4) * limit;

    state.selections.battery_pos = { x: randVal(batXLim), y: randVal(batYLim) };
    state.selections.payload_pos = { x: randVal(payXLim), y: randVal(payYLim) };
  }

  function bindListeners() {
    const bx = document.getElementById('batX');
    const by = document.getElementById('batY');
    const px = document.getElementById('payloadX');
    const py = document.getElementById('payloadY');
    const btn = document.getElementById('btnNextModule');
    const btnTest = document.getElementById('btnTestFlight');

    const onSlide = function (e, key, labelId) {
      state.selections[key.split('.')[0]][key.split('.')[1]] = parseFloat(e.target.value);
      const lbl = document.getElementById(labelId);
      if (lbl) lbl.textContent = Math.round(e.target.value) + ' mm';
      refresh();
    };

    if (bx) bx.addEventListener('input', e => onSlide(e, 'battery_pos.x', 'batXVal'));
    if (by) by.addEventListener('input', e => onSlide(e, 'battery_pos.y', 'batYVal'));
    if (px) px.addEventListener('input', e => onSlide(e, 'payload_pos.x', 'payloadXVal'));
    if (py) py.addEventListener('input', e => onSlide(e, 'payload_pos.y', 'payloadYVal'));

    if (btn) {
      btn.addEventListener('click', function () {
        if (!btn.hasAttribute('disabled')) {
          const handoff = {
            frame_id: state.selections.frame.id,
            battery_id: state.selections.battery.id,
            payload_ids: state.selections.payloads ? state.selections.payloads.map(p => p.id) : [],
            battery_pos: state.selections.battery_pos,
            payload_pos: state.selections.payload_pos,
            total_mass_g: state.calculations.total_mass_g,
            cg_offset_mm: state.calculations.offset_mm
          };
          
          const oldHandoffRaw = localStorage.getItem('vlabModule2_cg');
          let shouldClear = false;
          if (oldHandoffRaw) {
            try {
              const oldH = JSON.parse(oldHandoffRaw);
              if (oldH.frame_id !== handoff.frame_id ||
                  oldH.battery_id !== handoff.battery_id ||
                  JSON.stringify(oldH.payload_ids) !== JSON.stringify(handoff.payload_ids) ||
                  !oldH.battery_pos || oldH.battery_pos.x !== handoff.battery_pos.x || oldH.battery_pos.y !== handoff.battery_pos.y ||
                  !oldH.payload_pos || oldH.payload_pos.x !== handoff.payload_pos.x || oldH.payload_pos.y !== handoff.payload_pos.y) {
                shouldClear = true;
              }
            } catch (e) {
              shouldClear = true;
            }
          }
          if (shouldClear) {
            localStorage.removeItem('vlabModule2_matrix');
            localStorage.removeItem('vlabModule2_final');
          }

          localStorage.setItem('vlabModule2_cg', JSON.stringify(handoff));

          // Mirror the frame/battery/payload selections into the unified store.
          try {
            if (window.VLABStore) {
              window.VLABStore.setComponents({
                frameId: state.selections.frame ? state.selections.frame.id : null,
                batteryId: state.selections.battery ? state.selections.battery.id : null,
                payloadIds: (state.selections.payloads || []).map(function (p) { return p.id; })
              });
            }
          } catch (e) { /* shared store optional */ }

          window.location.href = 'index1.html';
        }
      });
    }

    if (btnTest) {
      btnTest.addEventListener('click', function () {
        if (state.isFlying) {
          state.isFlying = false;
          btnTest.textContent = "Start Flight Test";
          btnTest.style.backgroundColor = "var(--accent)";
          const elStatus = document.getElementById('flightStatusText');
          if (elStatus) {
            elStatus.textContent = "System Idle. Ready for flight test.";
            elStatus.style.color = "var(--text-secondary)";
          }
          state.flightTime = 0;
          state.flightPos.set(0, 0, 0);
        } else {
          state.isFlying = true;
          state.flightTime = 0;
          state.flightPos.set(0, 0, 0);
          state.angularVel = new THREE.Vector3(0, 0, 0);
          state.fallVelocity = 0;
          btnTest.textContent = "Stop Flight Test";
          btnTest.style.backgroundColor = "var(--danger)";
          const elStatus = document.getElementById('flightStatusText');
          if (elStatus) {
            elStatus.textContent = "Arming motors... Takeoff!";
            elStatus.style.color = "var(--text-secondary)";
          }
        }
      });
    }

    const titleEl = document.getElementById('configPanelTitle');
    const sectionsEl = document.getElementById('configSections');
    const chevronEl = document.getElementById('configPanelChevron');
    if (titleEl && sectionsEl && chevronEl) {
      titleEl.addEventListener('click', function () {
        const isCollapsed = sectionsEl.style.display === 'none';
        sectionsEl.style.display = isCollapsed ? 'flex' : 'none';
        chevronEl.style.transform = isCollapsed ? 'rotate(0deg)' : 'rotate(-90deg)';
      });
    }
  }

  // frame/battery are shared components fields — also selectable from Exp 1's
  // own UI — so writes to them are gated through VLABOverride, not committed
  // directly like the rest of this experiment's own fields.
  function _syncTileUI(cat, newId) {
    const idPrefix = cat === 'frame' ? 'frame_' : 'battery_';
    const containerId = cat === 'frame' ? 'frameTilesContainer' : 'batteryTilesContainer';
    const input = document.getElementById(idPrefix + newId);
    if (!input) return;
    input.checked = true;
    const container = document.getElementById(containerId);
    if (container) {
      container.querySelectorAll('.component-tile').forEach(t => t.classList.remove('active', 'selected'));
      const label = input.closest('.component-tile');
      if (label) label.classList.add('active', 'selected');
    }
  }

  function renderOverrideNotices() {
    if (!window.VLABOverride) return;
    const frameHost = document.getElementById('vlOverrideHostFrame');
    const batteryHost = document.getElementById('vlOverrideHostBattery');
    if (frameHost) {
      window.VLABOverride.mountOverrideNotice(frameHost, 'frameId', 'exp2', function (newId) {
        const found = database.frames.find(f => f.id === newId);
        if (found) {
          state.selections.frame = found;
          UI.refreshPlacementSliders(state.selections);
          syncPlacements();
          _syncTileUI('frame', newId);
          refresh();
        }
      });
    }
    if (batteryHost) {
      window.VLABOverride.mountOverrideNotice(batteryHost, 'batteryId', 'exp2', function (newId) {
        const found = database.batteries.find(b => b.id === newId);
        if (found) {
          state.selections.battery = found;
          _syncTileUI('battery', newId);
          refresh();
        }
      });
    }
  }

  function handleSelection(category, selectedId, checked) {
    if (category === 'frame' || category === 'battery') {
      const field = category === 'frame' ? 'frameId' : 'batteryId';
      // exp2 owns frame/battery here too — use the unvalidated-but-tracked
      // write so its own picks are never rejected against stale
      // pre-recompute numbers (e.g. TWR using the OLD total_mass_g).
      const result = window.VLABOverride ? window.VLABOverride.trySetOwned(field, selectedId, 'exp2') : { ok: true };
      if (!result.ok) {
        if (window.SFX) window.SFX.warn();
        if (window.Instructor) window.Instructor.show('<strong>Selection blocked:</strong> ' + result.reason);
        const currentSel = category === 'frame' ? state.selections.frame : state.selections.battery;
        if (currentSel) {
          // deferred: buildSharedTileGrid's own change handler re-highlights
          // the just-clicked (rejected) tile right after this callback
          // returns, so the revert has to happen a tick later to win.
          setTimeout(function () { _syncTileUI(category, currentSel.id); }, 0);
        }
        return;
      }
      if (category === 'frame') {
        state.selections.frame = database.frames.find(f => f.id === selectedId);
        UI.refreshPlacementSliders(state.selections);
        randomizeOffsets();
        syncPlacements();
        Scene.setTab(1);
      } else {
        state.selections.battery = database.batteries.find(b => b.id === selectedId);
      }
      renderOverrideNotices();
    } else if (category === 'payloads') {
      const pObj = database.payloads.find(p => p.id === selectedId);
      if (checked) {
        if (!state.selections.payloads.some(item => item.id === selectedId)) {
          state.selections.payloads.push(pObj);
        }
      } else {
        state.selections.payloads = state.selections.payloads.filter(item => item.id !== selectedId);
      }
    }
    if (window.SFX) window.SFX.click(); // component selected/changed
    refresh();
  }

  function syncPlacements() {
    const bx = document.getElementById('batX'), by = document.getElementById('batY');
    const px = document.getElementById('payloadX'), py = document.getElementById('payloadY');
    if (bx) state.selections.battery_pos.x = parseFloat(bx.value);
    if (by) state.selections.battery_pos.y = parseFloat(by.value);
    if (px) state.selections.payload_pos.x = parseFloat(px.value);
    if (py) state.selections.payload_pos.y = parseFloat(py.value);
  }

  let savedBatteryPos = null;

  function refresh() {
    if (!database) return;

    // Fault injection: "battery slammed to one corner" pins the battery to
    // the worst-case rear-right deck corner (same limit geometry as
    // randomizeOffsets()) so students can see the CG envelope blow out. The
    // user's real slider position is preserved and restored when cleared.
    const frameForLimits = state.selections.frame;
    if (activeFault === 'battery_corner') {
      if (!savedBatteryPos) savedBatteryPos = Object.assign({}, state.selections.battery_pos);
      const halfW = frameForLimits ? frameForLimits.body_size_mm[0] / 2 : 44;
      const halfL = frameForLimits ? frameForLimits.body_size_mm[2] / 2 : 44;
      state.selections.battery_pos = { x: Math.max(0, halfW - 10), y: -Math.max(0, halfL - 15) };
    } else if (savedBatteryPos) {
      state.selections.battery_pos = savedBatteryPos;
      savedBatteryPos = null;
    }

    UI.refreshPlacementSliders(state.selections);

    const frame = state.selections.frame;
    const battery = state.selections.battery;
    const payloads = state.selections.payloads;
    const fixed = database.fixed_weights;
    const armLen = frame ? frame.wheelbase_mm / 2 : 225;

    const components = [];
    components.push({ name: 'Airframe Center Deck', mass_g: frame ? frame.mass_g : 100, x_mm: 0, y_mm: 0 });

    const electronicsMass = fixed.flight_controller_g + fixed.receiver_g + fixed.gps_module_g + fixed.power_distribution_g;
    components.push({ name: 'Avionics Stack', mass_g: electronicsMass, x_mm: 0, y_mm: 0 });

    const rad = Math.PI / 4;
    const mx = armLen * Math.cos(rad);
    const my = armLen * Math.sin(rad);
    
    const motorMass = state.selections.motor ? state.selections.motor.mass_g : (fixed ? fixed.motor_each_g : 35);
    const propMass = state.selections.propeller ? (state.selections.propeller.mass_g_each || 15) : 15;

    // Motors ×4
    components.push({ name: 'Motor FR', mass_g: motorMass, x_mm: mx, y_mm: my });
    components.push({ name: 'Motor FL', mass_g: motorMass, x_mm: -mx, y_mm: my });
    components.push({ name: 'Motor RR', mass_g: motorMass, x_mm: mx, y_mm: -my });
    components.push({ name: 'Motor RL', mass_g: motorMass, x_mm: -mx, y_mm: -my });

    // Propellers ×4
    components.push({ name: 'Propeller FR', mass_g: propMass, x_mm: mx, y_mm: my });
    components.push({ name: 'Propeller FL', mass_g: propMass, x_mm: -mx, y_mm: my });
    components.push({ name: 'Propeller RR', mass_g: propMass, x_mm: mx, y_mm: -my });
    components.push({ name: 'Propeller RL', mass_g: propMass, x_mm: -mx, y_mm: -my });

    // ESCs ×4
    components.push({ name: 'ESC FR', mass_g: fixed.esc_each_g, x_mm: mx*0.5, y_mm: my*0.5 });
    components.push({ name: 'ESC FL', mass_g: fixed.esc_each_g, x_mm: -mx*0.5, y_mm: my*0.5 });
    components.push({ name: 'ESC RR', mass_g: fixed.esc_each_g, x_mm: mx*0.5, y_mm: -my*0.5 });
    components.push({ name: 'ESC RL', mass_g: fixed.esc_each_g, x_mm: -mx*0.5, y_mm: -my*0.5 });

    // Arms tubes
    const armTubeMass = Math.round((armLen * 2 / 450) * 18);
    components.push({ name: 'Arm FR', mass_g: armTubeMass, x_mm: mx*0.5, y_mm: my*0.5 });
    components.push({ name: 'Arm FL', mass_g: armTubeMass, x_mm: -mx*0.5, y_mm: my*0.5 });
    components.push({ name: 'Arm RR', mass_g: armTubeMass, x_mm: mx*0.5, y_mm: -my*0.5 });
    components.push({ name: 'Arm RL', mass_g: armTubeMass, x_mm: -mx*0.5, y_mm: -my*0.5 });

    if (battery) components.push({ name: 'Battery', mass_g: battery.mass_g, x_mm: state.selections.battery_pos.x, y_mm: state.selections.battery_pos.y });
    if (payloads && payloads.length > 0) {
      payloads.forEach(function (p) {
        const base = getPayloadBaseOffset(p.id, frame);
        components.push({
          name: p.label,
          mass_g: p.mass_g,
          x_mm: base.x + state.selections.payload_pos.x,
          y_mm: base.y + state.selections.payload_pos.y
        });
      });
    }

    const cg = Calc.solveCenterOfGravity(components);
    state.calculations = cg;

    DroneModel.rebuildScene(state.selections, 1);
    DroneModel.updateCGFeedback(cg);

    UI.updateChecklist(state.selections, cg.offset_mm);
    drawEnvelopePlot(cg.x_cg, cg.y_cg);

    const _passMm = (window.VLAB_CONST && window.VLAB_CONST.LIMITS) ? window.VLAB_CONST.LIMITS.cg_offset_pass_mm : 10.0;
    renderFaultScenario();
    renderVerdict(cg, _passMm);
    _syncSharedStore();

    const totalMassLabel = document.getElementById('calcTotalMassVal');
    if (totalMassLabel) totalMassLabel.textContent = cg.total_mass_g.toFixed(5) + " g";
    const totalMassFormula = document.getElementById('calcTotalMassFormula');
    if (totalMassFormula) {
      let formulaText = `<i>m</i><sub>frame</sub>(${frame ? frame.mass_g.toFixed(1) : 100}) + <i>m</i><sub>bat</sub>(${battery ? battery.mass_g.toFixed(1) : 0})`;
      if (payloads && payloads.length > 0) {
        const payloadMass = payloads.reduce((sum, p) => sum + p.mass_g, 0);
        formulaText += ` + <i>m</i><sub>payloads</sub>(${payloadMass.toFixed(1)})`;
      }
      formulaText += ` + <i>m</i><sub>fixed</sub>(${(electronicsMass + motorMass*4 + propMass*4 + fixed.esc_each_g*4 + armTubeMass*4).toFixed(1)})`;
      totalMassFormula.innerHTML = formulaText;
    }

    const momentXLabel = document.getElementById('calcMomentXVal');
    if (momentXLabel) momentXLabel.textContent = cg.sum_mx.toFixed(5) + " g·mm";
    const momentXFormula = document.getElementById('calcMomentXFormula');
    if (momentXFormula) {
      let formulaText = `&Sigma;(<i>m</i>&middot;<i>x</i>) = <i>m</i><sub>bat</sub>(${battery ? battery.mass_g.toFixed(1) : 0})&times;(${state.selections.battery_pos.x.toFixed(2)})`;
      if (payloads && payloads.length > 0) {
        payloads.forEach(function (p) {
          const base = getPayloadBaseOffset(p.id, frame);
          const px_mm = base.x + state.selections.payload_pos.x;
          formulaText += ` + <i>m</i><sub>${p.id.split('_')[0]}</sub>(${p.mass_g.toFixed(1)})&times;(${px_mm.toFixed(2)})`;
        });
      }
      momentXFormula.innerHTML = formulaText;
    }

    const momentYLabel = document.getElementById('calcMomentYVal');
    if (momentYLabel) momentYLabel.textContent = cg.sum_my.toFixed(5) + " g·mm";
    const momentYFormula = document.getElementById('calcMomentYFormula');
    if (momentYFormula) {
      let formulaText = `&Sigma;(<i>m</i>&middot;<i>y</i>) = <i>m</i><sub>bat</sub>(${battery ? battery.mass_g.toFixed(1) : 0})&times;(${state.selections.battery_pos.y.toFixed(2)})`;
      if (payloads && payloads.length > 0) {
        payloads.forEach(function (p) {
          const base = getPayloadBaseOffset(p.id, frame);
          const py_mm = base.y + state.selections.payload_pos.y;
          formulaText += ` + <i>m</i><sub>${p.id.split('_')[0]}</sub>(${p.mass_g.toFixed(1)})&times;(${py_mm.toFixed(2)})`;
        });
      }
      momentYFormula.innerHTML = formulaText;
    }

    const cgXLabel = document.getElementById('calcCgXVal');
    if (cgXLabel) cgXLabel.textContent = cg.x_cg.toFixed(5) + " mm";

    const cgYLabel = document.getElementById('calcCgYVal');
    if (cgYLabel) cgYLabel.textContent = cg.y_cg.toFixed(5) + " mm";

    const cgRLabel = document.getElementById('calcCgRVal');
    if (cgRLabel) cgRLabel.textContent = cg.offset_mm.toFixed(5) + " mm";

    const optimalCogReadout = document.getElementById('optimalCogReadout');
    if (optimalCogReadout) {
      if (cg.offset_mm < 5.0) {
        const statusSuffix = cg.offset_mm < 0.001 ? "(LOCKED - PERFECT)" : "(LOCKED - STABLE)";
        optimalCogReadout.textContent = `x: ${cg.x_cg.toFixed(5)} mm | y: ${cg.y_cg.toFixed(5)} mm ${statusSuffix}`;
        optimalCogReadout.style.backgroundColor = 'var(--success-light)';
        optimalCogReadout.style.color = '#065f46';
        optimalCogReadout.style.borderColor = '#a7f3d0';
      } else {
        optimalCogReadout.textContent = `x: ${cg.x_cg.toFixed(5)} mm | y: ${cg.y_cg.toFixed(5)} mm`;
        optimalCogReadout.style.backgroundColor = 'var(--surface-2)';
        optimalCogReadout.style.color = 'var(--text-secondary)';
        optimalCogReadout.style.borderColor = 'var(--border)';
      }
    }

    if (!(frame && battery && payloads && payloads.length)) {
      Instructor.show(moduleTip1());
    } else if (cg.offset_mm < 0.001) {
      Instructor.say(`<strong>Perfect Balance!</strong> Center of Gravity offset is under the extreme precision limit (current: <strong>${cg.offset_mm.toFixed(5)} mm</strong>). Click <strong>Start Flight Test</strong> to hover perfectly.`);
    } else if (cg.offset_mm < 5.0) {
      Instructor.say(`<strong>Stable Balance!</strong> Center of Gravity offset is <strong>${cg.offset_mm.toFixed(5)} mm</strong> (within the 5.0 mm FC compensation threshold). The flight controller can stabilize this safely. Click <strong>Start Flight Test</strong>.`);
    } else if (cg.offset_mm < 10.0) {
      Instructor.say(`<strong>Semi-balanced:</strong> Center of Gravity offset is <strong>${cg.offset_mm.toFixed(5)} mm</strong>. This exceeds the 5.0 mm safe hover limit. The drone will experience drift and instability during flight.`);
    } else {
      Instructor.say(`<strong>Severe Unbalance!</strong> Center of Gravity offset is <strong>${cg.offset_mm.toFixed(5)} mm</strong>. The drone will tilt severely and crash on takeoff. Adjust battery/payload sliders to center it.`);
    }
  }

  function drawHeatmap(x_cg, y_cg) {
    const canvas = document.getElementById('droneHeatmapCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width = canvas.clientWidth * window.devicePixelRatio;
    const h = canvas.height = canvas.clientHeight * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    const cw = w / window.devicePixelRatio;
    const ch = h / window.devicePixelRatio;

    const centerX = cw / 2;
    const centerY = ch / 2;
    const radius = Math.min(cw, ch) * 0.45;

    const frame = state.selections.frame;
    const battery = state.selections.battery;
    const payloads = state.selections.payloads;
    const armLen = frame ? frame.wheelbase_mm / 2 : 225;
    const d = armLen * Math.cos(Math.PI / 4);

    // Weight shares
    const w_FR = 0.25 * (1 + x_cg/d + y_cg/d);
    const w_FL = 0.25 * (1 - x_cg/d + y_cg/d);
    const w_RR = 0.25 * (1 + x_cg/d - y_cg/d);
    const w_RL = 0.25 * (1 - x_cg/d - y_cg/d);

    const isSafe = Math.sqrt(x_cg * x_cg + y_cg * y_cg) < 5.0;

    const getColorForDensity = (d) => {
      let r, g, b;
      if (d < 0.3) {
        const t = d / 0.3;
        r = Math.round(15 + t * (16 - 15));
        g = Math.round(94 + t * (185 - 94));
        b = Math.round(162 + t * (129 - 162));
      } else if (d < 0.6) {
        const t = (d - 0.3) / 0.3;
        r = Math.round(16 + t * (234 - 16));
        g = Math.round(185 + t * (179 - 185));
        b = Math.round(129 + t * (8 - 129));
      } else {
        const t = Math.min((d - 0.6) / 0.4, 1.0);
        r = Math.round(234 + t * (239 - 234));
        g = Math.round(179 + t * (68 - 179));
        b = Math.round(8 + t * (68 - 8));
      }
      return `rgb(${r},${g},${b})`;
    };

    const scaleFactor = frame ? 0.70 + (frame.wheelbase_mm - 250) / (850 - 250) * 0.20 : 0.85;
    const armLenPx = radius * scaleFactor;
    
    const motorFR = { x: centerX + armLenPx * Math.cos(Math.PI/4), y: centerY - armLenPx * Math.sin(Math.PI/4) };
    const motorFL = { x: centerX - armLenPx * Math.cos(Math.PI/4), y: centerY - armLenPx * Math.sin(Math.PI/4) };
    const motorRR = { x: centerX + armLenPx * Math.cos(Math.PI/4), y: centerY + armLenPx * Math.sin(Math.PI/4) };
    const motorRL = { x: centerX - armLenPx * Math.cos(Math.PI/4), y: centerY + armLenPx * Math.sin(Math.PI/4) };

    const batX = centerX + (state.selections.battery_pos.x / armLen) * armLenPx * 0.9;
    const batY = centerY - (state.selections.battery_pos.y / armLen) * armLenPx * 0.9;

    if (!window._offscreenCanvas) {
      window._offscreenCanvas = document.createElement('canvas');
    }
    const offCanvas = window._offscreenCanvas;
    const offW = 96;
    const offH = 96;
    offCanvas.width = offW;
    offCanvas.height = offH;
    const offCtx = offCanvas.getContext('2d');

    const offCenterX = offW / 2;
    const offCenterY = offH / 2;
    
    const scaleOff = offW / cw;
    
    const offFR = { x: offCenterX + armLenPx * scaleOff * Math.cos(Math.PI/4), y: offCenterY - armLenPx * scaleOff * Math.sin(Math.PI/4) };
    const offFL = { x: offCenterX - armLenPx * scaleOff * Math.cos(Math.PI/4), y: offCenterY - armLenPx * scaleOff * Math.sin(Math.PI/4) };
    const offRR = { x: offCenterX + armLenPx * scaleOff * Math.cos(Math.PI/4), y: offCenterY + armLenPx * scaleOff * Math.sin(Math.PI/4) };
    const offRL = { x: offCenterX - armLenPx * scaleOff * Math.cos(Math.PI/4), y: offCenterY + armLenPx * scaleOff * Math.sin(Math.PI/4) };

    const offBatX = offCenterX + ((state.selections.battery_pos.x / armLen) * armLenPx * 0.9) * scaleOff;
    const offBatY = offCenterY - ((state.selections.battery_pos.y / armLen) * armLenPx * 0.9) * scaleOff;

    for (let gy = 0; gy < offH; gy++) {
      for (let gx = 0; gx < offW; gx++) {
        const d_deck = Math.pow(gx - offCenterX, 2) + Math.pow(gy - offCenterY, 2);
        const d_fr = Math.pow(gx - offFR.x, 2) + Math.pow(gy - offFR.y, 2);
        const d_fl = Math.pow(gx - offFL.x, 2) + Math.pow(gy - offFL.y, 2);
        const d_rr = Math.pow(gx - offRR.x, 2) + Math.pow(gy - offRR.y, 2);
        const d_rl = Math.pow(gx - offRL.x, 2) + Math.pow(gy - offRL.y, 2);

        let density = 0.02; // blue background
        
        density += 0.08 * Math.exp(-d_deck / (2 * (18 * scaleOff) * (18 * scaleOff)));
        
        if (battery) {
          const d_bat = Math.pow(gx - offBatX, 2) + Math.pow(gy - offBatY, 2);
          density += 0.12 * Math.exp(-d_bat / (2 * (12 * scaleOff) * (12 * scaleOff)));
        }
        
        if (payloads && payloads.length > 0) {
          payloads.forEach(p => {
            const base = getPayloadBaseOffset(p.id, frame);
            const px_mm = base.x + state.selections.payload_pos.x;
            const py_mm = base.y + state.selections.payload_pos.y;
            const pX = offCenterX + (((px_mm / armLen) * armLenPx * 0.9) * scaleOff);
            const pY = offCenterY - (((py_mm / armLen) * armLenPx * 0.9) * scaleOff);
            const d_pay = Math.pow(gx - pX, 2) + Math.pow(gy - pY, 2);
            density += 0.10 * Math.exp(-d_pay / (2 * (10 * scaleOff) * (10 * scaleOff)));
          });
        }

        const armWidthSq = 2 * (14 * scaleOff) * (14 * scaleOff);
        const getDistanceToSegmentSq = (x0, y0, x1, y1) => {
          const dx = x1 - x0;
          const dy = y1 - y0;
          const lenSq = dx * dx + dy * dy;
          if (lenSq === 0) return Math.pow(gx - x0, 2) + Math.pow(gy - y0, 2);
          let t = ((gx - x0) * dx + (gy - y0) * dy) / lenSq;
          t = Math.max(0, Math.min(1, t));
          return Math.pow(gx - (x0 + t * dx), 2) + Math.pow(gy - (y0 + t * dy), 2);
        };

        const d_arm_fr = getDistanceToSegmentSq(offCenterX, offCenterY, offFR.x, offFR.y);
        const d_arm_fl = getDistanceToSegmentSq(offCenterX, offCenterY, offFL.x, offFL.y);
        const d_arm_rr = getDistanceToSegmentSq(offCenterX, offCenterY, offRR.x, offRR.y);
        const d_arm_rl = getDistanceToSegmentSq(offCenterX, offCenterY, offRL.x, offRL.y);

        const getQuadrantLoad = (d_arm, d_motor, w_quad) => {
          let peak = 0.45 + (w_quad - 0.25) * 6.5;
          peak = Math.min(Math.max(peak, 0.05), 0.96);
          const armDensity = peak * Math.exp(-d_arm / armWidthSq);
          const motorDensity = peak * Math.exp(-d_motor / (2 * (16 * scaleOff) * (16 * scaleOff)));
          return Math.max(armDensity, motorDensity);
        };

        const arm_fr_val = getQuadrantLoad(d_arm_fr, d_fr, w_FR);
        const arm_fl_val = getQuadrantLoad(d_arm_fl, d_fl, w_FL);
        const arm_rr_val = getQuadrantLoad(d_arm_rr, d_rr, w_RR);
        const arm_rl_val = getQuadrantLoad(d_arm_rl, d_rl, w_RL);

        density += Math.max(arm_fr_val, arm_fl_val, arm_rr_val, arm_rl_val);

        const d_norm = Math.min(Math.max(density, 0.0), 1.0);
        offCtx.fillStyle = getColorForDensity(d_norm);
        offCtx.fillRect(gx, gy, 1, 1);
      }
    }

    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(offCanvas, 0, 0, cw, ch);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 0.6;
    const gridSpace = 16;
    for (let x = 0; x < cw; x += gridSpace) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ch); ctx.stroke();
    }
    for (let y = 0; y < ch; y += gridSpace) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cw, y); ctx.stroke();
    }

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.4;
    const deckW = (frame ? frame.body_size_mm[0] : 88) * 0.38 * (radius / 100);
    const deckH = (frame ? frame.body_size_mm[2] : 88) * 0.38 * (radius / 100);

    ctx.beginPath();
    ctx.moveTo(centerX - deckW * 0.35, centerY - deckH * 0.5);
    ctx.lineTo(centerX + deckW * 0.35, centerY - deckH * 0.5);
    ctx.lineTo(centerX + deckW * 0.5, centerY - deckH * 0.3);
    ctx.lineTo(centerX + deckW * 0.5, centerY + deckH * 0.3);
    ctx.lineTo(centerX + deckW * 0.35, centerY + deckH * 0.5);
    ctx.lineTo(centerX - deckW * 0.35, centerY + deckH * 0.5);
    ctx.lineTo(centerX - deckW * 0.5, centerY + deckH * 0.3);
    ctx.lineTo(centerX - deckW * 0.5, centerY - deckH * 0.3);
    ctx.closePath();
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1.6;
    ctx.strokeRect(centerX - deckW * 0.22, centerY - deckH * 0.35, deckW * 0.44, deckH * 0.7);

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.6;
    const standoffOffsets = [
      [-deckW * 0.4, -deckH * 0.42], [deckW * 0.4, -deckH * 0.42],
      [-deckW * 0.4, deckH * 0.42], [deckW * 0.4, deckH * 0.42]
    ];
    standoffOffsets.forEach(off => {
      ctx.beginPath();
      ctx.arc(centerX + off[0], centerY + off[1], 1.8, 0, Math.PI * 2);
      ctx.stroke();
    });

    const armR = frame ? (frame.arm_tube_od_mm / 2) * 0.3 * (radius / 100) : 3;
    const shares = [
      { label: 'FR', val: w_FR, x: motorFR.x, y: motorFR.y },
      { label: 'FL', val: w_FL, x: motorFL.x, y: motorFL.y },
      { label: 'RR', val: w_RR, x: motorRR.x, y: motorRR.y },
      { label: 'RL', val: w_RL, x: motorRL.x, y: motorRL.y }
    ];

    shares.forEach(s => {
      const angle = Math.atan2(s.y - centerY, s.x - centerX);
      const perp = angle + Math.PI / 2;
      const armWidthOuter = armR * 1.5;
      const armWidthInner = armR * 0.8;

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(centerX + deckW * 0.35 * Math.cos(angle) + armWidthOuter * Math.cos(perp), centerY + deckH * 0.35 * Math.sin(angle) + armWidthOuter * Math.sin(perp));
      ctx.lineTo(s.x - 9 * Math.cos(angle) + armWidthInner * Math.cos(perp), s.y - 9 * Math.sin(angle) + armWidthInner * Math.sin(perp));
      ctx.lineTo(s.x - 9 * Math.cos(angle) - armWidthInner * Math.cos(perp), s.y - 9 * Math.sin(angle) - armWidthInner * Math.sin(perp));
      ctx.lineTo(centerX + deckW * 0.35 * Math.cos(angle) - armWidthOuter * Math.cos(perp), centerY + deckH * 0.35 * Math.sin(angle) - armWidthOuter * Math.sin(perp));
      ctx.stroke();

      for (let j = 0.35; j <= 0.75; j += 0.2) {
        const hx = centerX + (s.x - centerX) * j;
        const hy = centerY + (s.y - centerY) * j;
        ctx.beginPath();
        ctx.arc(hx, hy, armR * 0.5, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, armR * 2.2, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1.2;
      for (let c = 0; c < 4; c++) {
        const cAngle = (c * Math.PI) / 2;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x + armR * 1.5 * Math.cos(cAngle), s.y + armR * 1.5 * Math.sin(cAngle));
        ctx.stroke();
      }

      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
      ctx.lineWidth = 1.2;
      
      const prop = state.selections.propeller;
      const propRadiusPx = prop ? (prop.diameter_m * 180 * (radius / 100)) : (armLenPx * 0.45);
      const rotVal = Date.now() * 0.0016 * (s.x > centerX ? 1 : -1);
      ctx.rotate(rotVal);

      for (let b = 0; b < 2; b++) {
        const bAngle = b * Math.PI;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(
          propRadiusPx * 0.4 * Math.cos(bAngle + 0.1), propRadiusPx * 0.4 * Math.sin(bAngle + 0.1),
          propRadiusPx * 0.8 * Math.cos(bAngle + 0.05), propRadiusPx * 0.8 * Math.sin(bAngle + 0.05),
          propRadiusPx * Math.cos(bAngle), propRadiusPx * Math.sin(bAngle)
        );
        ctx.bezierCurveTo(
          propRadiusPx * 0.8 * Math.cos(bAngle - 0.05), propRadiusPx * 0.8 * Math.sin(bAngle - 0.05),
          propRadiusPx * 0.4 * Math.cos(bAngle - 0.1), propRadiusPx * 0.4 * Math.sin(bAngle - 0.1),
          0, 0
        );
        ctx.stroke();
      }
      ctx.restore();
    });

    if (battery) {
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(batX - 10, batY - 14, 20, 28);
      ctx.fillStyle = 'rgba(239, 68, 68, 0.2)';
      ctx.fillRect(batX - 10, batY - 14, 20, 28);
      
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 7px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('BAT', batX, batY + 2.5);
    }

    if (payloads && payloads.length > 0) {
      payloads.forEach(p => {
        const base = getPayloadBaseOffset(p.id, frame);
        const px_mm = base.x + state.selections.payload_pos.x;
        const py_mm = base.y + state.selections.payload_pos.y;
        
        const pX = centerX + (px_mm / armLen) * armLenPx * 0.9;
        const pY = centerY - (py_mm / armLen) * armLenPx * 0.9;

        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(pX, pY, 9, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(56, 189, 248, 0.2)';
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 7px sans-serif';
        ctx.textAlign = 'center';

        let abbr = 'PLD';
        if (p.id.includes('gopro')) abbr = 'GPR';
        else if (p.id.includes('fpv_nano')) abbr = 'CAM';
        else if (p.id.includes('gimbal')) abbr = 'GMB';
        else if (p.id.includes('gps')) abbr = 'GPS';
        else if (p.id.includes('vtx')) abbr = 'VTX';
        else if (p.id.includes('telemetry')) abbr = 'TEL';
        else if (p.id.includes('lidar')) abbr = 'LDR';

        ctx.fillText(abbr, pX, pY + 2.5);
      });
    }

    shares.forEach(s => {
      const pct = Math.max(0, s.val * 100);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      
      ctx.fillText(`${pct.toFixed(2)}%`, s.x, s.y + (s.y > centerY ? 18 : -10));
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.fillText(s.label, s.x, s.y + (s.y > centerY ? 28 : -20));
    });

    const cgX = centerX + (x_cg / armLen) * armLenPx * 0.9;
    const cgY = centerY - (y_cg / armLen) * armLenPx * 0.9;
    
    ctx.strokeStyle = isSafe ? '#10b981' : '#ef4444';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cgX - 10, cgY); ctx.lineTo(cgX + 10, cgY);
    ctx.moveTo(cgX, cgY - 10); ctx.lineTo(cgX, cgY + 10);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cgX, cgY, 4, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawVibrationGraph() {
    const canvas = document.getElementById('vibrationCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width = canvas.clientWidth * window.devicePixelRatio;
    const h = canvas.height = canvas.clientHeight * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    const cw = w / window.devicePixelRatio;
    const ch = h / window.devicePixelRatio;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cw, ch);

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.06)';
    ctx.lineWidth = 0.8;
    
    ctx.beginPath();
    ctx.moveTo(0, ch / 2 - 40);
    ctx.lineTo(cw, ch / 2 - 40);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, ch / 2 + 40);
    ctx.lineTo(cw, ch / 2 + 40);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, ch / 2);
    ctx.lineTo(cw, ch / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#9ca3af';
    ctx.font = '8px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('+150°/s', 6, ch / 2 - 42);
    ctx.fillText('0°/s', 6, ch / 2 - 4);
    ctx.fillText('-150°/s', 6, ch / 2 + 38);

    if (!state.rollVibrationPoints) {
      state.rollVibrationPoints = Array(120).fill(0);
    }
    if (!state.pitchVibrationPoints) {
      state.pitchVibrationPoints = Array(120).fill(0);
    }

    let rollVal = 0;
    let pitchVal = 0;

    if (state.isFlying) {
      const cg = state.calculations;
      const t = Date.now() * 0.001;
      
      let motorAmp = 1.2;
      if (cg.offset_mm >= 5.0) {
        const timeFactor = Math.min(state.flightTime, 3.2);
        motorAmp = 2.0 + (cg.offset_mm / 10.0) * 3.0 * (1.0 + timeFactor * 0.5);
      } else if (cg.offset_mm > 0.001) {
        motorAmp = 1.2 + (cg.offset_mm / 5.0) * 1.0;
      }

      const motorRoll = Math.sin(t * 55) * motorAmp + (Math.random() - 0.5) * motorAmp * 0.5;
      const motorPitch = Math.cos(t * 60) * motorAmp + (Math.random() - 0.5) * motorAmp * 0.5;

      const wobbleFreqRoll = 4.0;
      const wobbleFreqPitch = 3.6;
      const wobbleAmpRoll = cg.x_cg * 0.8;
      const wobbleAmpPitch = cg.y_cg * 0.8;

      const wobbleRoll = Math.sin(t * wobbleFreqRoll) * wobbleAmpRoll;
      const wobblePitch = Math.cos(t * wobbleFreqPitch) * wobbleAmpPitch;

      let biasRoll = cg.x_cg * 0.6;
      let biasPitch = -cg.y_cg * 0.6;

      if (cg.offset_mm >= 5.0) {
        const timeFactor = Math.min(state.flightTime, 3.2);
        const crashScale = 1.0 + timeFactor * 1.5;
        rollVal = biasRoll * crashScale + wobbleRoll * crashScale + motorRoll * (1.0 + timeFactor * 0.4);
        pitchVal = biasPitch * crashScale + wobblePitch * crashScale + motorPitch * (1.0 + timeFactor * 0.4);
      } else {
        rollVal = biasRoll + wobbleRoll + motorRoll;
        pitchVal = biasPitch + wobblePitch + motorPitch;
      }
    }

    state.rollVibrationPoints.shift();
    state.rollVibrationPoints.push(rollVal);

    state.pitchVibrationPoints.shift();
    state.pitchVibrationPoints.push(pitchVal);

    const step = cw / (state.rollVibrationPoints.length - 1);

    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < state.rollVibrationPoints.length; i++) {
      const x = i * step;
      const y = ch / 2 - state.rollVibrationPoints[i] * 4;
      const clampedY = Math.max(4, Math.min(ch - 4, y));
      if (i === 0) ctx.moveTo(x, clampedY);
      else ctx.lineTo(x, clampedY);
    }
    ctx.stroke();

    ctx.strokeStyle = '#f97316';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < state.pitchVibrationPoints.length; i++) {
      const x = i * step;
      const y = ch / 2 - state.pitchVibrationPoints[i] * 4;
      const clampedY = Math.max(4, Math.min(ch - 4, y));
      if (i === 0) ctx.moveTo(x, clampedY);
      else ctx.lineTo(x, clampedY);
    }
    ctx.stroke();

    // Setup status string
    let statusStr = "IMU GYRO: STANDBY";
    if (state.isFlying) {
      statusStr = state.calculations.offset_mm < 5.0 ? (state.calculations.offset_mm < 0.001 ? "IMU GYRO: PERFECT HOVER" : "IMU GYRO: COMPENSATED HOVER") : "IMU GYRO: UNSTABLE SHAKE";
    }

    // Measure text to decide layout dynamically
    ctx.font = 'bold 9px monospace';
    const statusWidth = ctx.measureText(statusStr).width;

    // Draw status string
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'left';
    ctx.fillText(statusStr, 8, 14);

    ctx.font = 'bold 8px sans-serif';
    if (cw - 220 > statusWidth + 15) {
      // Inline horizontal layout if canvas is wide enough
      ctx.fillStyle = '#f97316';
      ctx.fillRect(cw - 210, 7, 8, 8);
      ctx.fillStyle = '#374151';
      ctx.fillText('Pitch Rate (Gyro Y)', cw - 198, 14);

      ctx.fillStyle = '#06b6d4';
      ctx.fillRect(cw - 105, 7, 8, 8);
      ctx.fillStyle = '#374151';
      ctx.fillText('Roll Rate (Gyro X)', cw - 93, 14);
    } else {
      // Stacked vertical layout to guarantee zero overlap on narrow layouts
      ctx.fillStyle = '#f97316';
      ctx.fillRect(cw - 110, 18, 8, 8);
      ctx.fillStyle = '#374151';
      ctx.fillText('Pitch Rate (Gyro Y)', cw - 98, 25);

      ctx.fillStyle = '#06b6d4';
      ctx.fillRect(cw - 110, 29, 8, 8);
      ctx.fillStyle = '#374151';
      ctx.fillText('Roll Rate (Gyro X)', cw - 98, 36);
    }
  }

  function setup3DDrag() {
    const canvas = document.getElementById('droneCanvas');
    if (!canvas) return;

    let activeDrag = null;
    let dragPlane = new THREE.Plane();
    let dragOffset = new THREE.Vector3();
    let raycaster = new THREE.Raycaster();
    let mouse = new THREE.Vector2();
    let dragPlaneNormal = new THREE.Vector3(0, 1, 0);
    let isDragging = false;

    canvas.addEventListener('pointerdown', function (event) {
      if (!Scene.getRenderer() || state.isFlying) return;
      const rect = Scene.getRenderer().domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, Scene.getCamera());
      const sc = Scene.getScene();
      const intersects = raycaster.intersectObjects(sc.children, true);

      let hitObj = null;
      let hitName = null;

      for (let i = 0; i < intersects.length; i++) {
        let obj = intersects[i].object;
        while (obj && obj !== sc) {
          if (obj === DroneModel.batteryMesh()) { hitObj = DroneModel.batteryMesh(); hitName = 'battery'; break; }
          else if (obj === DroneModel.payloadMesh() || (DroneModel.payloadMesh() && DroneModel.payloadMesh().getObjectById(obj.id))) {
            hitObj = DroneModel.payloadMesh();
            hitName = 'payload';
            break;
          }
          obj = obj.parent;
        }
        if (hitName) break;
      }

      if (hitObj) {
        activeDrag = hitName;
        isDragging = true;
        Scene.getControls().enabled = false;

        dragPlane.setFromNormalAndCoplanarPoint(dragPlaneNormal, hitObj.position);
        let intersectPoint = new THREE.Vector3();
        raycaster.ray.intersectPlane(dragPlane, intersectPoint);
        dragOffset.copy(hitObj.position).sub(intersectPoint);
      }
    }, false);

    canvas.addEventListener('pointermove', function (event) {
      if (!isDragging || !activeDrag || state.isFlying) return;

      const rect = Scene.getRenderer().domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, Scene.getCamera());
      let intersectPoint = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(dragPlane, intersectPoint)) {
        const targetPos = intersectPoint.add(dragOffset);
        let x_mm = targetPos.x * 1000;
        let y_mm = -targetPos.z * 1000;

        const frame = state.selections.frame;
        const halfW = frame ? frame.body_size_mm[0] / 2 : 44;
        const halfL = frame ? frame.body_size_mm[2] / 2 : 44;

        if (activeDrag === 'battery') {
          const cx = Math.max(-halfW + 10, Math.min(halfW - 10, x_mm));
          const cy = Math.max(-halfL + 15, Math.min(halfL - 15, y_mm));
          state.selections.battery_pos = { x: cx, y: cy };
          updateSliderInput('batX', cx, 'batXVal');
          updateSliderInput('batY', cy, 'batYVal');
        } else if (activeDrag === 'payload') {
          const cx = Math.max(-halfW + 8, Math.min(halfW - 8, x_mm));
          const cy = Math.max(-halfL + 8, Math.min(halfL - 8, y_mm));
          state.selections.payload_pos = { x: cx, y: cy };
          updateSliderInput('payloadX', cx, 'payloadXVal');
          updateSliderInput('payloadY', cy, 'payloadYVal');
        }
        refresh();
      }
    }, false);

    window.addEventListener('pointerup', function () {
      if (isDragging) {
        isDragging = false;
        activeDrag = null;
        Scene.getControls().enabled = true;
      }
    }, false);
  }

  function updateSliderInput(sliderId, val, labelId) {
    const s = document.getElementById(sliderId);
    const l = document.getElementById(labelId);
    if (s) s.value = val;
    if (l) l.textContent = Math.round(val) + ' mm';
  }

  function drawEnvelopePlot(x_cg, y_cg) {
    const ctx = document.getElementById('cgEnvelopeCanvas');
    if (!ctx) return;

    const circleData = [];
    const steps = 40;
    for (let i = 0; i <= steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      circleData.push({ x: Math.cos(angle) * 10, y: Math.sin(angle) * 10 });
    }

    const isSafe = Math.sqrt(x_cg * x_cg + y_cg * y_cg) < 10.0;
    const cgDotColor = isSafe ? '#10b981' : '#ef4444';

    if (cgChart) {
      cgChart.data.datasets[1].data = [{ x: x_cg, y: y_cg }];
      cgChart.data.datasets[1].pointBackgroundColor = cgDotColor;
      cgChart.data.datasets[1].pointBorderColor = cgDotColor;
      cgChart.update('none');
    } else {
      cgChart = new Chart(ctx, {
        type: 'scatter',
        data: {
          datasets: [
            {
              label: '10mm Safe Boundary',
              data: circleData,
              showLine: true,
              fill: true,
              backgroundColor: 'rgba(16, 185, 129, 0.05)',
              borderColor: 'rgba(16, 185, 129, 0.45)',
              borderWidth: 1.5,
              borderDash: [4, 4],
              pointRadius: 0
            },
            {
              label: 'Center of Gravity',
              data: [{ x: x_cg, y: y_cg }],
              pointBackgroundColor: cgDotColor,
              pointBorderColor: cgDotColor,
              pointRadius: 6,
              borderWidth: 2
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { min: -30, max: 30, title: { display: true, text: 'X (mm)', font: { size: 10 } }, grid: { color: '#f3f4f6' } },
            y: { min: -30, max: 30, title: { display: true, text: 'Y (mm)', font: { size: 10 } }, grid: { color: '#f3f4f6' } }
          }
        }
      });
    }
  }

  return {
    init,
    refresh,
    drawHeatmap,
    drawVibrationGraph,
    setup3DDrag,
    drawEnvelopePlot,
    hasBlockingViolations: _hasBlockingViolations,
    renderOverrideNotices: renderOverrideNotices
  };
})();
window.VLAB = Module1;

// ═══════════════════════════════════════════════════════════════════
// 8. MODULE 2 ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════
const Module2 = (function () {
  'use strict';

  let matrix = {};
  let activeSelection = { length: 250, material: null };
  let isTesting = false;
  let stressChart = null;
  let sfdChart = null;
  let bmdChart = null;
  let activeFault2 = 'none';
  let dynamicLoadActive = false; // true while the 'dynamic_x2' fault is selected
  let _bannerCtl2 = null;

  // Cross-experiment staleness/violation banner. This page doesn't choose
  // any shared `components` itself (material/length are exp2-internal, not
  // part of the DEPS.components schema) so it only needs to surface the
  // existing store state — e.g. if exp1 is re-locked with a different motor
  // after this page already ran its stress sweep, the "Experiment 2 needs
  // review" staleness card should appear here.
  function _syncSharedStore2() {
    if (!window.VLABStore || !window.VLABUi || !window.VLABValidate) return;
    const catalog = window.VLAB_CATALOG || {};
    const host = document.getElementById('vlBannerHost');
    if (!host) return;
    if (!_bannerCtl2) {
      _bannerCtl2 = window.VLABUi.mountBanner(host, { catalog: catalog, currentExp: 'exp2' });
    }
    _bannerCtl2.refresh();
  }

  // ── Fault injection (VLABLab.scenario) ──────────────────────────────────
  const FAULT_OPTIONS_2 = [
    { id: 'none', label: 'None (static full-throttle load)', desc: 'Baseline: static tip force at full-throttle thrust, no maneuver margin.' },
    { id: 'nylon_350', label: 'Nylon @ 350 mm, full thrust', desc: 'Worst-case combo: the weakest material at the longest lever arm — high-thrust setups snap outright (SF < 1); weaker ones are still only marginal.', fault: true },
    { id: 'dynamic_x2', label: 'Dynamic load ×2.0 (maneuvering)', desc: 'Applies a 2.0× maneuver/vibration load factor on top of the static case — real flight loads spike 1.5-3× static (theory.md §4).', fault: true }
  ];

  function renderFaultScenario2() {
    const host = document.getElementById('stressFaultScenario');
    if (!window.VLABLab || !host) return;
    window.VLABLab.scenario(host, {
      title: 'Structural fault scenario',
      current: activeFault2,
      options: FAULT_OPTIONS_2,
      onSelect: function (id) {
        activeFault2 = id;
        dynamicLoadActive = (id === 'dynamic_x2');
        if (id === 'nylon_350' && database) {
          const nylon = (database.materials || []).find(function (m) { return m.id === 'nylon'; });
          if (nylon) activeSelection.material = nylon;
          activeSelection.length = 350;
          syncSelectionTiles();
        }
        refresh();
      }
    });
  }

  // ── Structural verdict (VLABLab.verdict) — surfaces the dynamic safety
  // factor (already computed by Calc.solveDynamicSafetyFactor for the
  // VLABStore.finalize slice, but previously never shown to the user) next
  // to the static one, making the "static load is optimistic" caveat from
  // theory.md §4 directly visible instead of implicit.
  function renderVerdict2(stress, matYield) {
    const host = document.getElementById('stressVerdict');
    if (!window.VLABLab || !host || !activeSelection.material) return;
    const nDyn = dynamicLoadActive ? 2.0 : ((window.VLAB_CONST && window.VLAB_CONST.REAL) ? window.VLAB_CONST.REAL.dynamic_load_factor_default : 1.5);
    const sfStatic = Calc.solveSafetyFactor(matYield, stress);
    const sfDyn = Calc.solveDynamicSafetyFactor(matYield, stress, nDyn);
    let tone = 'pass', label = 'STRUCTURALLY SAFE';
    if (sfDyn < 1.0) { tone = 'fail'; label = 'FAILS UNDER DYNAMIC LOAD'; }
    else if (sfDyn < 2.0 || sfStatic < 2.0) { tone = 'warn'; label = 'MARGINAL'; }
    const fmt = function (v) { return v >= 90 ? '∞' : v.toFixed(2); };
    const note = 'SF_static=' + fmt(sfStatic) + '  ·  SF_dynamic(' + nDyn.toFixed(1) + '×)=' + fmt(sfDyn);
    window.VLABLab.verdict(host, { label: label, tone: tone, note: note });
  }

  // Matrix cache key MUST include the frame id: the arm cross-section (b/h/t)
  // comes from the selected frame's arm_profile, so a cached safety factor for
  // one frame is invalid for another at the same material+length. Omitting the
  // frame id let cells cross-contaminate between frames. (spec §3.3 fix)
  function matrixKey(matId, len) {
    const fid = state.selections.frame ? state.selections.frame.id : 'none';
    return fid + '_' + matId + '_' + len;
  }

  function init() {
    Calc.loadCatalog()
      .then(function (data) {
        database = data;

        const cgHandoff = localStorage.getItem('vlabModule2_cg');
        if (cgHandoff) {
          const hData = JSON.parse(cgHandoff);
          state.selections.frame = database.frames.find(f => f.id === hData.frame_id);
          state.selections.battery = database.batteries.find(b => b.id === hData.battery_id);
          if (hData.payload_ids && Array.isArray(hData.payload_ids) && database.payloads) {
            state.selections.payloads = database.payloads.filter(p => hData.payload_ids.includes(p.id));
          } else {
            const pObj = database.payloads.find(p => p.id === hData.payload_id);
            state.selections.payloads = pObj ? [pObj] : [database.payloads[0]];
          }
          state.selections.battery_pos = hData.battery_pos;
          state.selections.payload_pos = hData.payload_pos;
          state.calculations.offset_mm = hData.cg_offset_mm || hData.cg_offset_mm === 0 ? hData.cg_offset_mm : 0;
          state.calculations.total_mass_g = hData.total_mass_g || 780;
          
          if (hData.material_id && database.materials) {
            activeSelection.material = database.materials.find(m => m.id === hData.material_id) || database.materials[0];
          } else {
            activeSelection.material = database.materials[0];
          }
          if (typeof hData.arm_length_mm === 'number') {
            activeSelection.length = hData.arm_length_mm;
          } else {
            activeSelection.length = state.selections.frame ? state.selections.frame.arm_length_mm : 250;
          }
        } else {
          state.selections.frame = database.frames[2] || database.frames[0];
          state.selections.battery = database.batteries[2] || database.batteries[0];
          state.selections.payloads = [database.payloads[0]];
          state.calculations.total_mass_g = 780;
          activeSelection.material = database.materials[0];
          activeSelection.length = state.selections.frame ? state.selections.frame.arm_length_mm : 250;
        }

        const savedMatrix = localStorage.getItem('vlabModule2_matrix');
        if (savedMatrix) {
          try {
            matrix = JSON.parse(savedMatrix);
          } catch (e) {
            console.warn('Failed to parse vlabModule2_matrix:', e);
            matrix = {};
          }
        } else {
          matrix = {};
        }

        loadContinuationData();

        Scene.init(2);
        Mod2UI.buildControlTiles(database, activeSelection, onSelectMaterial, onSelectLength);
        bindListeners();
        drawEmptyMatrix();
        checkMatrixCompletion();
        refresh();
      })
      .catch(err => console.error('Module 2 failed to load database:', err));
  }

  function onSelectMaterial(item) {
    if (window.SFX) window.SFX.click();
    activeSelection.material = database.materials.find(x => x.id === item.id);
    saveStateToLocalStorage();
    refresh();
    Instructor.show(moduleTip2());
  }

  function onSelectLength(length) {
    if (window.SFX) window.SFX.click();
    activeSelection.length = length;
    saveStateToLocalStorage();
    refresh();
    Instructor.show(moduleTip2());
  }

  function saveStateToLocalStorage() {
    const cgData = {
      frame_id: state.selections.frame ? state.selections.frame.id : 'cf_450',
      battery_id: state.selections.battery ? state.selections.battery.id : 'bat_3s_2200',
      payload_ids: state.selections.payloads ? state.selections.payloads.map(p => p.id) : [],
      battery_pos: state.selections.battery_pos,
      payload_pos: state.selections.payload_pos,
      cg_offset_mm: state.calculations.offset_mm,
      total_mass_g: state.calculations.total_mass_g,
      material_id: activeSelection.material ? activeSelection.material.id : 'carbon_fibre',
      arm_length_mm: activeSelection.length
    };
    localStorage.setItem('vlabModule2_cg', JSON.stringify(cgData));
  }

  function bindListeners() {
    const btnTest = document.getElementById('btnStartTest');
    if (btnTest) {
      btnTest.addEventListener('click', function () {
        if (isTesting) return;
        runStressSweepAnimation();
      });
    }

    const titleEl = document.getElementById('configPanelTitle');
    const sectionsEl = document.getElementById('configSections');
    const chevronEl = document.getElementById('configPanelChevron');
    if (titleEl && sectionsEl && chevronEl) {
      titleEl.addEventListener('click', function () {
        const isCollapsed = sectionsEl.style.display === 'none';
        sectionsEl.style.display = isCollapsed ? 'flex' : 'none';
        chevronEl.style.transform = isCollapsed ? 'rotate(0deg)' : 'rotate(-90deg)';
      });
    }

    window.addEventListener('resize', () => Scene.resize());
  }

  function drawEmptyMatrix() {
    const container = document.getElementById('safetyMatrixContainer');
    if (!container) return;

    container.innerHTML = `
      <div class="matrix-header" style="font-size:0.6rem;">Material</div>
      <div class="matrix-header">150mm</div>
      <div class="matrix-header">250mm</div>
      <div class="matrix-header">350mm</div>
    `;

    database.materials.forEach(function (mat) {
      const rowLabel = document.createElement('div');
      rowLabel.className = 'matrix-label';
      rowLabel.textContent = mat.label.split(' ')[0];
      container.appendChild(rowLabel);

      [150, 250, 350].forEach(function (len) {
        const cell = document.createElement('div');
        const savedVal = matrix[matrixKey(mat.id, len)];
        if (savedVal !== undefined) {
          if (savedVal === 0) {
            cell.className = 'matrix-cell fail';
            cell.textContent = 'FAIL';
          } else {
            cell.className = `matrix-cell ${savedVal >= 2.0 ? 'safe' : 'marginal'}`;
            cell.textContent = savedVal.toFixed(2);
          }
        } else {
          cell.className = 'matrix-cell empty';
          cell.textContent = '--';
        }
        cell.id = `cell_${mat.id}_${len}`;
        
        cell.addEventListener('click', function () {
          if (isTesting) return;
          
          activeSelection.length = len;
          activeSelection.material = mat;
          saveStateToLocalStorage();
          syncSelectionTiles();
          refresh();
        });
        container.appendChild(cell);
      });
    });
  }

  function syncSelectionTiles() {
    const matInputs = document.querySelectorAll('input[name="material"]');
    matInputs.forEach(input => {
      const isSel = input.value === activeSelection.material.id;
      input.checked = isSel;
      input.closest('.component-tile').classList.toggle('selected', isSel);
    });

    const lenInputs = document.querySelectorAll('input[name="length"]');
    lenInputs.forEach(input => {
      const isSel = parseInt(input.value) === activeSelection.length;
      input.checked = isSel;
      input.closest('.component-tile').classList.toggle('selected', isSel);
    });
  }

  function refresh() {
    const mat = activeSelection.material;
    const len = activeSelection.length;

    renderFaultScenario2();
    _syncSharedStore2();

    const proxySelections = {
      material: mat,
      frame: { arm_length_mm: len }
    };
    DroneModel.rebuildScene(proxySelections, 2);

    document.querySelectorAll('.matrix-cell').forEach(c => c.classList.remove('selected'));
    const activeCell = document.getElementById(`cell_${mat.id}_${len}`);
    if (activeCell) activeCell.classList.add('selected');

    const profile = state.selections.frame?.arm_profile || { b_mm: 15, h_mm: 8, t_mm: 1.5 };
    const b = profile.b_mm, h = profile.h_mm, t = profile.t_mm;
    const I = Calc.solveHollowInertia(b, h, t);

    const wEl = document.getElementById('armProfileW');
    const hEl = document.getElementById('armProfileH');
    const tEl = document.getElementById('armProfileT');
    if (wEl) wEl.innerHTML = `<strong>Width (b):</strong> ${b.toFixed(1)} mm`;
    if (hEl) hEl.innerHTML = `<strong>Height (h):</strong> ${h.toFixed(1)} mm`;
    if (tEl) tEl.innerHTML = `<strong>Wall Thickness (t):</strong> ${t.toFixed(1)} mm`;

    const I_sci = I.toExponential(4);
    document.getElementById('formulaInertia').innerHTML = `<i>I</i> = (<i>b</i>&times;<i>h</i><sup>3</sup> - (<i>b</i>-2<i>t</i>)&times;(<i>h</i>-2<i>t</i>)<sup>3</sup>) / 12 = ${I_sci} m<sup>4</sup>`;

    const savedVal = matrix[`${mat.id}_${len}`];
    const statusBadge = document.getElementById('hudStressStatus');

    if (savedVal !== undefined) {
      const motorMass = state.selections.motor ? state.selections.motor.mass_g : 35;
      const propMass = state.selections.propeller ? (state.selections.propeller.mass_g_each || 15) : 15;
      const T_max = resolveTMax();
      const forceData = Calc.solveTipForce(motorMass, propMass, T_max);
      const F_tip_limit = forceData.total_n;

      const M = Calc.solveBendingMoment(F_tip_limit, len);
      const stress = Calc.solveBendingStress(M, h, I);
      const matYield = Calc.materialYieldSeeded(mat);
      const sf = Calc.solveSafetyFactor(matYield, stress);

      document.getElementById('hudStressMat').textContent = mat.label.split(' ')[0];
      document.getElementById('hudStressLen').textContent = len + ' mm';

      if (savedVal === 0 || stress >= matYield) {
        document.getElementById('hudStressVal').textContent = stress.toFixed(2) + ' MPa';
        document.getElementById('hudSafetyFactor').textContent = 'FAIL';
        updateCalculationsPanel(F_tip_limit, M, stress, sf);
        drawBarChart(stress);
        updateSFDBMDDiagrams(F_tip_limit, len, b, h, t);
        DroneModel.applyCantileverLoad(F_tip_limit);
        
        if (statusBadge) {
          statusBadge.textContent = 'YIELD FAILURE!';
          statusBadge.style.color = 'var(--danger)';
        }
      } else {
        document.getElementById('hudStressVal').textContent = stress.toFixed(2) + ' MPa';
        document.getElementById('hudSafetyFactor').textContent = sf >= 90 ? '∞' : sf.toFixed(2);
        updateCalculationsPanel(F_tip_limit, M, stress, sf);
        drawBarChart(stress);
        updateSFDBMDDiagrams(F_tip_limit, len, b, h, t);
        DroneModel.applyCantileverLoad(F_tip_limit);
        
        if (statusBadge) {
          statusBadge.textContent = sf >= 2.0 ? 'SAFE (SF > 2)' : 'MARGINAL (SF < 2)';
          statusBadge.style.color = sf >= 2.0 ? 'var(--success)' : 'var(--warning)';
        }
      }
      renderVerdict2(stress, matYield);
    } else {
      updateCalculationsPanel(0, 0, 0, 99);
      drawBarChart(0);
      updateSFDBMDDiagrams(0, len, b, h, t);
      DroneModel.applyCantileverLoad(0);

      document.getElementById('hudStressMat').textContent = mat.label.split(' ')[0];
      document.getElementById('hudStressLen').textContent = len + ' mm';
      document.getElementById('hudStressVal').textContent = '0.00 MPa';
      document.getElementById('hudSafetyFactor').textContent = '--';

      if (statusBadge) {
        statusBadge.textContent = 'READY TO TEST';
        statusBadge.style.color = 'var(--text-secondary)';
      }
      const vhost = document.getElementById('stressVerdict');
      if (window.VLABLab && vhost) {
        window.VLABLab.verdict(vhost, { label: 'NOT YET TESTED', tone: 'warn', note: 'Run the stress test to compute static + dynamic safety factors.' });
      }
    }
  }

  function updateCalculationsPanel(force, moment, stress, sf) {
    document.getElementById('formulaMoment').innerHTML = `<i>M</i> = <i>F</i> &times; <i>L</i> = ${force.toFixed(1)}N &times; ${(activeSelection.length/1000).toFixed(3)}m = ${moment.toFixed(4)} N&middot;m`;
    
    const profile = state.selections.frame?.arm_profile || { b_mm: 15, h_mm: 8, t_mm: 1.5 };
    const c = (profile.h_mm / 2.0) / 1000;
    document.getElementById('formulaStress').innerHTML = `&sigma; = (<i>M</i> &times; <i>c</i>) / <i>I</i> = (${moment.toFixed(4)} &times; ${c.toFixed(4)}) / <i>I</i> = ${stress.toFixed(2)} MPa`;
    
    const sfText = sf >= 90 ? '∞' : sf.toFixed(2);
    const matYield = Calc.materialYieldSeeded(activeSelection.material);
    document.getElementById('formulaSafety').innerHTML = `<i>SF</i> = &sigma;<sub>yield</sub> / &sigma;<sub>applied</sub> = ${matYield} / ${stress.toFixed(2)} = ${sfText}`;
  }

  function runStressSweepAnimation() {
    const self = this;
    if (isTesting) return;
    isTesting = true;

    const btnTest = document.getElementById('btnStartTest');
    if (btnTest) btnTest.setAttribute('disabled', 'true');

    if (window.SFX) { window.SFX.start(); window.SFX.motor(true); } // load ramp whir
    Instructor.show('<strong>Starting cantilever stress test...</strong> Watch the beam deflect as force ramps from 0 to maximum thrust.');

    const motorMass = state.selections.motor ? state.selections.motor.mass_g : 35;
    const propMass = state.selections.propeller ? (state.selections.propeller.mass_g_each || 15) : 15;
    const T_max = resolveTMax();

    const forceData = Calc.solveTipForce(motorMass, propMass, T_max);
    const F_tip_limit = forceData.total_n;

    const mat = activeSelection.material;
    const len = activeSelection.length;
    
    const profile = state.selections.frame?.arm_profile || { b_mm: 15, h_mm: 8, t_mm: 1.5 };
    const b = profile.b_mm, h = profile.h_mm, t = profile.t_mm;
    const I = Calc.solveHollowInertia(b, h, t);

    let elapsed = 0;
    const duration = 2.0; 
    let failed = false;
    let lastTime = performance.now();

    function animate(now) {
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      elapsed += dt;
      const progress = Math.min(elapsed / duration, 1.0);
      const currentForce = F_tip_limit * progress;

      const M = Calc.solveBendingMoment(currentForce, len);
      const stress = Calc.solveBendingStress(M, h, I);
      const matYield = Calc.materialYieldSeeded(mat);
      const sf = Calc.solveSafetyFactor(matYield, stress);

      DroneModel.applyCantileverLoad(currentForce);

      document.getElementById('hudStressVal').textContent = stress.toFixed(2) + ' MPa';
      document.getElementById('hudSafetyFactor').textContent = sf >= 90 ? '∞' : sf.toFixed(2);
      updateCalculationsPanel(currentForce, M, stress, sf);
      drawBarChart(stress);
      updateSFDBMDDiagrams(currentForce, len, b, h, t);
      renderVerdict2(stress, matYield);

      if (sf < 2.0 && sf >= 1.0) {
        Instructor.say('<strong>Warning:</strong> Safety Factor dropped below 2.0 — this arm length is marginal for ' + mat.label + '.');
      }

      if (stress >= matYield) {
        failed = true;
        handleFailure(mat, len);
        Instructor.say('<strong>Yield Failure!</strong> The applied bending stress exceeded ' + mat.label + "'s yield strength of " + matYield.toFixed(1) + ' MPa. The arm fractured at the root clamp.');
        return;
      }

      if (progress < 1.0) {
        requestAnimationFrame(animate);
      } else {
        handleSuccess(mat, len, sf);
        Instructor.say('<strong>Passed!</strong> Safety Factor = ' + sf.toFixed(2) + '. The arm withstood full thrust load with adequate margin.');
      }
    }
    requestAnimationFrame(animate);
  }

  function handleSuccess(mat, len, sf) {
    isTesting = false;
    if (window.SFX) window.SFX.motor(false);
    const btnTest = document.getElementById('btnStartTest');
    if (btnTest) btnTest.removeAttribute('disabled');

    const cell = document.getElementById(`cell_${mat.id}_${len}`);
    if (cell) {
      cell.className = `matrix-cell ${sf >= 2.0 ? 'safe' : 'marginal'}`;
      cell.textContent = sf.toFixed(2);
    }

    const statusBadge = document.getElementById('hudStressStatus');
    if (statusBadge) {
      statusBadge.textContent = sf >= 2.0 ? 'SAFE (SF > 2)' : 'MARGINAL (SF < 2)';
      statusBadge.style.color = sf >= 2.0 ? 'var(--success)' : 'var(--warning)';
    }

    matrix[matrixKey(mat.id, len)] = sf;
    localStorage.setItem('vlabModule2_matrix', JSON.stringify(matrix));
    checkMatrixCompletion();
  }

  function handleFailure(mat, len) {
    isTesting = false;
    if (window.SFX) window.SFX.motor(false);
    const btnTest = document.getElementById('btnStartTest');
    if (btnTest) btnTest.removeAttribute('disabled');

    DroneModel.triggerArmBreak();

    const cell = document.getElementById(`cell_${mat.id}_${len}`);
    if (cell) {
      cell.className = 'matrix-cell fail';
      cell.textContent = 'FAIL';
    }

    const statusBadge = document.getElementById('hudStressStatus');
    if (statusBadge) {
      statusBadge.textContent = 'YIELD FAILURE!';
      statusBadge.style.color = 'var(--danger)';
    }

    matrix[matrixKey(mat.id, len)] = 0;
    localStorage.setItem('vlabModule2_matrix', JSON.stringify(matrix));
    checkMatrixCompletion();
  }

  function checkMatrixCompletion() {
    const materialsList = database.materials;
    const lengthsList = [150, 250, 350];
    
    let completedCells = 0;
    let totalCells = materialsList.length * lengthsList.length;

    materialsList.forEach(m => {
      lengthsList.forEach(l => {
        if (matrix[matrixKey(m.id, l)] !== undefined) completedCells++;
      });
    });

    if (completedCells >= totalCells) {
      saveFinalConfigurationAndProceed();
    }
  }

  function saveFinalConfigurationAndProceed() {
    // Guard: only persist config when frame selection is available.
    if (state.selections.frame) {
      const frameConfig = {
        wheelbase_mm: state.selections.frame.wheelbase_mm,
        arm_length_mm: activeSelection.length,
        arm_material: activeSelection.material ? activeSelection.material.id : null,
        yield_strength_mpa: activeSelection.material ? Calc.materialYieldSeeded(activeSelection.material) : null,
        mass_g: state.calculations.total_mass_g,
        cg_offset_mm: state.calculations.offset_mm
      };
      localStorage.setItem('vlabModule2_final', JSON.stringify(frameConfig));

      // ── Publish canonical structural outputs to the unified store ──────────
      // Computed with the frame's REAL arm length + cross-section (not the
      // synthetic length grid), plus dynamic safety factor and first bending
      // mode, so Exp 5 (inertia/mass) and the validation engine consume them.
      try {
        if (window.VLABStore) {
          const _frame = state.selections.frame;
          const _mat = activeSelection.material;
          const _profile = (_frame && _frame.arm_profile) || { b_mm: 15, h_mm: 8, t_mm: 1.5 };
          const _armLen = (_frame && _frame.arm_length_mm) || activeSelection.length;
          const _I = Calc.solveHollowInertia(_profile.b_mm, _profile.h_mm, _profile.t_mm);
          const _motorMass = state.selections.motor ? state.selections.motor.mass_g : 35;
          const _propMass = state.selections.propeller ? (state.selections.propeller.mass_g_each || 15) : 15;
          const _Tmax = resolveTMax();
          const _Ftip = Calc.solveTipForce(_motorMass, _propMass, _Tmax).total_n;
          const _M = Calc.solveBendingMoment(_Ftip, _armLen);
          const _stress = Calc.solveBendingStress(_M, _profile.h_mm, _I);
          const _yield = _mat ? Calc.materialYieldSeeded(_mat) : 600;
          const _E = _mat ? _mat.youngs_modulus_gpa : 70;
          const _rho = _mat ? _mat.density_kg_m3 : 1600;
          const _nDyn = window.VLAB_CONST ? window.VLAB_CONST.REAL.dynamic_load_factor_default : 1.5;
          const _sfStatic = Calc.solveSafetyFactor(_yield, _stress);
          const _sfDyn = Calc.solveDynamicSafetyFactor(_yield, _stress, _nDyn);
          const _fMode = Calc.solveFirstBendingMode(_armLen, _profile.b_mm, _profile.h_mm, _profile.t_mm, _E, _rho);
          window.VLABStore.setComponents({
            frameId: _frame ? _frame.id : null,
            batteryId: state.selections.battery ? state.selections.battery.id : null,
            payloadIds: (state.selections.payloads || []).map(function (p) { return p.id; })
          });
          window.VLABStore.finalize('exp2', {
            total_mass_g: state.calculations.total_mass_g,
            arm_length_mm: _armLen,
            arm_material: _mat ? _mat.id : null,
            yield_mpa: _yield,
            cg_offset_mm: state.calculations.offset_mm,
            SF_static_min: +_sfStatic.toFixed(2),
            SF_dynamic_min: +_sfDyn.toFixed(2),
            first_mode_hz: +_fMode.toFixed(1),
            applied_stress_mpa: +_stress.toFixed(2),
            dynamic_load_factor: _nDyn
          });
        }
      } catch (e) { /* shared store optional */ }
    }

    // Show the unlock card (auto-triggered — no button needed).
    const card = document.getElementById('nextModuleContainer');
    if (card && card.style.display === 'none') {
      card.style.display = 'block';
      // Use setTimeout to guarantee a full layout pass before WebGL reads canvas dimensions.
      setTimeout(function () {
        if (Mod2UI && Mod2UI.initUnlockScene) {
          Mod2UI.initUnlockScene();
        }
      }, 80);
      // Scroll the card into view.
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function drawBarChart(appliedStress) {
    const ctx = document.getElementById('stressBarCanvas');
    if (!ctx) return;

    const carbonYield = 600;
    const alYield = 270;
    const nylonYield = 50;

    const dataApplied = [appliedStress, appliedStress, appliedStress];
    const dataYield = [carbonYield, alYield, nylonYield];

    if (stressChart) {
      stressChart.data.datasets[0].data = dataApplied;
      stressChart.update('none');
    } else {
      stressChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: ['Carbon', 'Aluminium', 'Nylon'],
          datasets: [
            {
              label: 'Applied Bending Stress',
              data: dataApplied,
              backgroundColor: '#38bdf8',
              borderColor: '#0284c7',
              borderWidth: 1.5,
              barPercentage: 0.55
            },
            {
              label: 'Yield Strength',
              data: dataYield,
              backgroundColor: ['rgba(31,41,55,0.12)', 'rgba(148,163,184,0.12)', 'rgba(244,63,94,0.12)'],
              borderColor: ['#1f2937', '#94a3b8', '#f43f5e'],
              borderWidth: 1.5,
              barPercentage: 0.55
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: {
            legend: { display: false },
            tooltip: { enabled: true }
          },
          scales: {
            y: {
              min: 0,
              max: 650,
              title: { display: true, text: 'Stress / Strength (MPa)', font: { size: 10 } },
              grid: { color: '#f3f4f6' }
            },
            x: {
              grid: { display: false }
            }
          }
        }
      });
    }
  }

  function updateSFDBMDDiagrams(force, length_mm, b, h, t) {
    const sfdCtx = document.getElementById('sfdCanvas');
    const bmdCtx = document.getElementById('bmdCanvas');
    if (!sfdCtx || !bmdCtx) return;

    const points = 10;
    const xData = [];
    const sfdData = [];
    const bmdData = [];

    for (let i = 0; i <= points; i++) {
      const x_mm = (i / points) * length_mm;
      xData.push((x_mm / 1000).toFixed(2));
      
      // V = -F_tip (constant)
      sfdData.push(-force);
      
      // M(x) = F_tip * (L - x)
      const M = Calc.solveBendingMomentAtX(force, x_mm, length_mm);
      bmdData.push(M);
    }

    // Update SFD Chart
    if (sfdChart) {
      sfdChart.data.datasets[0].data = sfdData;
      sfdChart.update('none');
    } else {
      sfdChart = new Chart(sfdCtx, {
        type: 'line',
        data: {
          labels: xData,
          datasets: [{
            label: 'Shear Force (N)',
            data: sfdData,
            borderColor: '#f43f5e',
            borderWidth: 2,
            fill: false,
            pointRadius: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { 
              suggestedMin: -15, 
              suggestedMax: 0, 
              title: { display: true, text: 'V (N)', font: { size: 9 } },
              grid: { color: '#f3f4f6' }
            },
            x: { 
              title: { display: true, text: 'Position (m)', font: { size: 9 } },
              grid: { display: false }
            }
          }
        }
      });
    }

    // Update BMD Chart
    if (bmdChart) {
      bmdChart.data.datasets[0].data = bmdData;
      bmdChart.update('none');
    } else {
      bmdChart = new Chart(bmdCtx, {
        type: 'line',
        data: {
          labels: xData,
          datasets: [{
            label: 'Bending Moment (N·m)',
            data: bmdData,
            borderColor: '#0284c7',
            borderWidth: 2,
            fill: false,
            pointRadius: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { 
              suggestedMin: 0, 
              suggestedMax: 5, 
              title: { display: true, text: 'M (N·m)', font: { size: 9 } },
              grid: { color: '#f3f4f6' }
            },
            x: { 
              title: { display: true, text: 'Position (m)', font: { size: 9 } },
              grid: { display: false }
            }
          }
        }
      });
    }
  }

  return {
    init,
    refresh,
    updateCalculationsPanel,
    runStressSweepAnimation,
    handleSuccess,
    handleFailure,
    checkMatrixCompletion,
    saveFinalConfigurationAndProceed,
    drawBarChart,
    updateSFDBMDDiagrams,
    getActiveSelection: () => activeSelection
  };
})();
window.VLAB_MOD2 = Module2;

// ═══════════════════════════════════════════════════════════════════
// 9. GLOBAL STATE & continuation data loader
// ═══════════════════════════════════════════════════════════════════
const state = {
  selections: {
    frame: null,
    battery: null,
    payloads: [],
    motor: null,
    propeller: null,
    esc: null,
    fc: null,
    rx: null,
    T_max: 8.5,
    battery_pos: { x: 0, y: 0 },
    payload_pos: { x: 0, y: 0 }
  },
  calculations: {
    x_cg: 0,
    y_cg: 0,
    offset_mm: 0,
    total_mass_g: 0,
    sum_mx: 0,
    sum_my: 0
  },
  isFlying: false,
  flightTime: 0,
  flightPos: new THREE.Vector3(0, 0, 0),
  rollVibrationPoints: null,
  pitchVibrationPoints: null
};

let database = null;

// Canonical per-motor thrust for the worst-case beam load: theory.md §2
// requires the FULL-THROTTLE thrust T_max (not the hover-required thrust),
// and the canonical source is Exp 1's finalized `T_max_per_motor_N` in the
// shared store. `state.selections.T_max` is only a same-tab handoff cache
// (populated below by loadContinuationData() from the legacy vlabModule1
// key, which itself may carry `T_req` — hover thrust, not max thrust — when
// no richer key is present) and must never be preferred over the live store
// value. Every T_max consumer (Module2's refresh(), stress-sweep animation,
// final VLABStore.finalize save, and the handoff status badge) MUST go
// through this single top-level resolver so they can never silently
// disagree — top-level (not nested in Module1/Module2) because both modules
// and loadContinuationData() all need it.
function resolveTMax() {
  try {
    const e1 = window.VLABStore ? window.VLABStore.upstream('exp1') : null;
    if (e1 && typeof e1.T_max_per_motor_N === 'number') return e1.T_max_per_motor_N;
  } catch (e) { /* fall through */ }
  return state.selections.T_max !== undefined ? state.selections.T_max : 8.5;
}

function loadContinuationData() {
  // Try to parse from query parameters first (Live Server cross-port fallback)
  const urlParams = new URLSearchParams(window.location.search);
  const paramState = urlParams.get('state') || urlParams.get('handoff');
  if (paramState) {
    try {
      const decoded = decodeURIComponent(paramState);
      JSON.parse(decoded); // Validate JSON
      localStorage.setItem('vlabModule1', decoded);
      console.log('Successfully loaded handoff data from URL parameter');
    } catch (err) {
      console.warn('Failed to parse handoff state from URL query parameter:', err);
    }
  }

  const exp1Handoff = localStorage.getItem('vlabModule1');
  const badgeContainer = document.getElementById('handoffStatusContainer');

  let usingCustom = false;
  let motorName = 'Default 2212';
  let propName = 'Default 9045';

  // Merge sources: the legacy same-tab handoff blob is the base (kept for
  // backward compat with older saves), then the canonical VLABStore
  // components (populated by Exp 1's own VLABStore.setComponents/finalize)
  // OVERRIDE it field-by-field when present, so exp2 always reflects Exp 1's
  // real finalized build rather than a possibly-stale/legacy-only cache.
  let exp1Merged = null;
  if (exp1Handoff) {
    try { exp1Merged = JSON.parse(exp1Handoff); } catch (e) { exp1Merged = null; }
  }
  try {
    if (window.VLABStore) {
      const b = window.VLABStore.get();
      const c = b.components || {};
      if (c.frameId || c.motorId || c.propId || c.batteryId) {
        exp1Merged = exp1Merged || {};
        if (c.frameId) exp1Merged.fId = c.frameId;
        if (c.motorId) exp1Merged.mId = c.motorId;
        if (c.propId) exp1Merged.pId = c.propId;
        if (c.batteryId) exp1Merged.bId = c.batteryId;
        if (c.escId) exp1Merged.eId = c.escId;
        if (c.fcId) exp1Merged.fcId = c.fcId;
        if (c.rxId) exp1Merged.rId = c.rxId;
        if (c.payloadIds && c.payloadIds.length) exp1Merged.pldIds = c.payloadIds;
      }
      if (b.exp1 && typeof b.exp1.T_max_per_motor_N === 'number') {
        exp1Merged = exp1Merged || {};
        exp1Merged.T_max_n = b.exp1.T_max_per_motor_N;
      }
    }
  } catch (e) { /* VLABStore optional */ }

  if (exp1Merged) {
    try {
      const exp1 = exp1Merged;

      // Frame
      const frameId = exp1.fId || exp1.frame_id;
      if (frameId && database.frames) {
        state.selections.frame = database.frames.find(f => f.id === frameId);
      }
      
      // Motor
      const motorId = exp1.mId || exp1.motor_id;
      if (motorId && database.motors) {
        state.selections.motor = database.motors.find(m => m.id === motorId);
        if (state.selections.motor) motorName = state.selections.motor.label || state.selections.motor.id;
      }
      
      // Propeller
      const propellerId = exp1.pId || exp1.propeller_id;
      if (propellerId && database.propellers) {
        state.selections.propeller = database.propellers.find(p => p.id === propellerId);
        if (state.selections.propeller) propName = state.selections.propeller.label || state.selections.propeller.id;
      }
      
      // Battery
      const batteryId = exp1.bId || exp1.battery_id;
      if (batteryId && database.batteries) {
        state.selections.battery = database.batteries.find(b => b.id === batteryId);
      }
      
      // Payloads
      if (exp1.pldIds && Array.isArray(exp1.pldIds) && database.payloads) {
        state.selections.payloads = database.payloads.filter(p => exp1.pldIds.includes(p.id));
      } else if (exp1.payload_id && database.payloads) {
        const pObj = database.payloads.find(p => p.id === exp1.payload_id);
        if (pObj) state.selections.payloads = [pObj];
      }
      
      // ESC
      const escId = exp1.eId || exp1.esc_id;
      if (escId && database.escs) {
        state.selections.esc = database.escs.find(e => e.id === escId);
      }
      
      // FC
      const fcId = exp1.fcId || exp1.fc_id;
      if (fcId && database.flight_controllers) {
        state.selections.fc = database.flight_controllers.find(f => f.id === fcId);
      }
      
      // RX
      const rxId = exp1.rId || exp1.rx_id;
      if (rxId && database.receivers) {
        state.selections.rx = database.receivers.find(r => r.id === rxId);
      }
      
      // Thrust Max � handle all key variants from exp1
      if (exp1.T_max_n !== undefined) {
        state.selections.T_max = exp1.T_max_n;
      } else if (exp1.max_thrust_n !== undefined) {
        state.selections.T_max = exp1.max_thrust_n;
      } else if (exp1.T_req !== undefined) {
        state.selections.T_max = exp1.T_req;
      }

      usingCustom = true;
    } catch (e) {
      console.warn('Failed to parse Experiment 1 selections. Using defaults.');
    }
  }

  // Retrieve Module 1 Balancing data if we are back-navigated
  const cgHandoff = localStorage.getItem('vlabModule2_cg');
  if (cgHandoff) {
    try {
      const hData = JSON.parse(cgHandoff);
      if (hData.frame_id && database.frames) {
        state.selections.frame = database.frames.find(f => f.id === hData.frame_id);
      }
      if (hData.battery_id && database.batteries) {
        state.selections.battery = database.batteries.find(b => b.id === hData.battery_id);
      }
      if (hData.payload_ids && database.payloads) {
        state.selections.payloads = database.payloads.filter(p => hData.payload_ids.includes(p.id));
      }
      if (hData.battery_pos) state.selections.battery_pos = hData.battery_pos;
      if (hData.payload_pos) state.selections.payload_pos = hData.payload_pos;
    } catch (e) {
      console.warn('Failed to parse vlabModule2_cg');
    }
  }

  // VLABStore is the single source of truth for fields shared across
  // experiments (frame/battery are selectable from more than one
  // experiment's own UI) — it must win over this page's own remembered
  // back-navigation snapshot above, so a valid override made from Exp 1 (or
  // from this page on a prior visit) is what actually loads, not a stale
  // locally-cached pick.
  try {
    if (window.VLABStore) {
      const sharedC = window.VLABStore.get().components || {};
      if (sharedC.frameId && database.frames) {
        const f = database.frames.find(x => x.id === sharedC.frameId);
        if (f) state.selections.frame = f;
      }
      if (sharedC.batteryId && database.batteries) {
        const b = database.batteries.find(x => x.id === sharedC.batteryId);
        if (b) state.selections.battery = b;
      }
    }
  } catch (e) { /* VLABStore optional */ }

  if (!state.selections.motor && database.motors) {
    state.selections.motor = database.motors[3] || { id: '2212_920', mass_g: 52 };
  }
  if (!state.selections.propeller && database.propellers) {
    state.selections.propeller = database.propellers[3] || { id: '9045_2b', mass_g: 11.2 };
  }
  if (!state.selections.frame && database.frames) {
    state.selections.frame = database.frames[2] || database.frames[0];
  }
  if (!state.selections.battery && database.batteries) {
    state.selections.battery = database.batteries[1] || database.batteries[0];
  }
  if ((!state.selections.payloads || state.selections.payloads.length === 0) && database.payloads) {
    state.selections.payloads = [database.payloads[0]];
  }
  if (!state.selections.esc && database.escs) {
    state.selections.esc = database.escs[4] || { id: 'esc_4in1_30a', quantity: 1 };
  }
  if (!state.selections.fc && database.flight_controllers) {
    state.selections.fc = database.flight_controllers[1] || { id: 'fc_f7' };
  }
  if (!state.selections.rx && database.receivers) {
    state.selections.rx = database.receivers[0] || { id: 'rx_elrs_ep1' };
  }

  if (badgeContainer) {
    if (usingCustom) {
      badgeContainer.className = 'handoff-status-badge';
      badgeContainer.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
          <polyline points="22 4 12 14.01 9 11.01"></polyline>
        </svg>
        <span>Active setup: <strong>${motorName}</strong> + <strong>${propName}</strong> (T_max = ${resolveTMax().toFixed(2)}N) loaded from Exp 1.</span>
      `;
    } else {
      badgeContainer.className = 'handoff-status-badge fallback';
      badgeContainer.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="16" x2="12" y2="12"></line>
          <line x1="12" y1="8" x2="12.01" y2="8"></line>
        </svg>
        <span>Using default hardware: <strong>${motorName}</strong> + <strong>${propName}</strong> (No Exp 1 data found).</span>
      `;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// 10. DOMContentLoaded Router
// ═══════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function () {
  window.Calc = Calc;
  window.Scene = Scene;
  window.DroneModel = DroneModel;
  window.UI = UI;
  window.Mod2UI = Mod2UI;

  if (window.Instructor) { window.Instructor.mountFloating(); window.Instructor.initTtsToggle(); }

  if (document.getElementById('safetyMatrixContainer')) {
    window.VLAB_MOD2 = Module2;
    Module2.init();
    if (window.Instructor) {
      window.Instructor.loadVideo('instructorVideoSlot', 'videos/stress_test_intro.mp4');
      window.Instructor.show(moduleTip2());   // on-screen guidance (silent)
      window.Instructor.enterTab('intro_stress'); // page intro voice
    }
  } else {
    window.VLAB = Module1;
    Module1.init();
    if (window.Instructor) {
      window.Instructor.loadVideo('instructorVideoSlot', 'videos/frame_balance_intro.mp4');
      window.Instructor.show(moduleTip1());   // on-screen guidance (silent)
      window.Instructor.enterTab('intro_cg'); // page intro voice
    }
  }
});


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
    var mq = window.matchMedia('(max-width: 1000px)');
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
