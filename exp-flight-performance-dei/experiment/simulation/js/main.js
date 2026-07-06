/* ==========================================================================
 * Drone Technology Virtual Lab — Experiment 06 (Flight Performance) — SINGLE BUNDLE
 * Coordinator rule: exactly ONE js file per experiment. The shared runtime
 * (constants, catalog, store, validation, ui, lab kit, shared drone3d model) is
 * inlined below as a fenced PRELUDE, followed by the experiment-specific code.
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

/* ===== SHARED PRELUDE 5/7: vlab-ui.js (link-free banner/gate patch applied below) ===== */
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

/* ===== EXPERIMENT 06 CODE ===== */
// Experiment 06: Flight Performance — TWR, hover throttle, payload & efficiency.
// The Calc IIFE is intentionally first so tests can load it without the DOM app.
const Calc = (function () {
  'use strict';

  const G = 9.80665, RHO = 1.225;
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  // ── Sub-Calc A: thrust-to-weight ratio (grams-force, g cancels) ───────────
  function twr(N, TmaxG, mTotalG) { return mTotalG > 0 ? (N * TmaxG) / mTotalG : Infinity; }

  // ── Sub-Calc B: hover throttle & control margin (quadratic thrust curve) ──
  function hoverThrustPerMotorG(mTotalG, N) { return mTotalG / N; }
  function hoverThrottle(TWR) { return TWR > 0 ? Math.sqrt(1 / TWR) : Infinity; }   // sqrt(T_hover/T_max)
  function controlMarginPct(TWR) { return (1 - hoverThrottle(TWR)) * 100; }
  function thrustAtThrottle(TmaxG, throttle) { return TmaxG * throttle * throttle; }  // T ∝ throttle^2

  // ── Sub-Calc C: maximum payload at a minimum safe TWR ─────────────────────
  function maxTakeoffMassG(N, TmaxG, twrMin) { return N * TmaxG / twrMin; }
  function maxPayloadG(N, TmaxG, mEmptyG, twrMin) { return maxTakeoffMassG(N, TmaxG, twrMin) - mEmptyG; }

  // ── Sub-Calc D: hover efficiency (momentum / actuator-disk theory) ────────
  function diskArea(N, Dm) { return N * Math.PI * (Dm / 2) * (Dm / 2); }
  function hoverPowerW(mTotalKg, N, Dm, FoM, rho) {
    const A = diskArea(N, Dm), T = mTotalKg * G;
    const pIdeal = Math.pow(T, 1.5) / Math.sqrt(2 * (rho === undefined ? RHO : rho) * A);
    return pIdeal / FoM;
  }
  function efficiencyGperW(mTotalG, N, Dm, FoM, rho) {
    const P = hoverPowerW(mTotalG / 1000, N, Dm, FoM, rho);
    return P > 0 ? mTotalG / P : 0;
  }

  function classify(TWR, bands) {
    const b = bands || [
      { max: 1.0, label: 'cannot lift off', tone: 'danger' },
      { max: 1.5, label: 'underpowered', tone: 'danger' },
      { max: 2.0, label: 'stable / cinematic', tone: 'warn' },
      { max: 3.0, label: 'sport', tone: 'good' },
      { max: 5.0, label: 'freestyle', tone: 'good' },
      { max: 999, label: 'racing / extreme', tone: 'good' }
    ];
    return b.find((x) => TWR < x.max) || b[b.length - 1];
  }

  // ── Reality checks (redesign overrides) ───────────────────────────────────
  // ISA density — duplicated locally (not read off VLAB_CONST) so Calc stays a
  // pure, dependency-free module the test harness can load standalone.
  function airDensity(h) {
    const hh = Math.max(0, Math.min(11000, h || 0));
    return RHO * Math.pow(1 - 2.25577e-5 * hh, 4.25588);
  }
  // Forward-flight cosine loss: tilted thrust only fights gravity with its
  // vertical component. A hover TWR of 1.5 at 30 deg tilt behaves like 1.3.
  function cosineTWR(TWRval, tiltDeg) { return TWRval * Math.cos((tiltDeg || 0) * Math.PI / 180); }
  // Real (measured) hover efficiency from the actual electrical draw (V*I per
  // motor x N), for comparison against the idealised momentum-theory ceiling
  // efficiencyGperW() already computes. Real electrical/motor losses are NOT
  // in the ideal model, so this is always <= the ideal figure.
  function measuredEfficiencyGperW(mTotalG, vBatt, iPerMotor, N) {
    const P = N * vBatt * iPerMotor;
    return P > 0 ? mTotalG / P : 0;
  }

  return Object.freeze({
    G, RHO, clamp,
    twr, hoverThrustPerMotorG, hoverThrottle, controlMarginPct, thrustAtThrottle,
    maxTakeoffMassG, maxPayloadG, diskArea, hoverPowerW, efficiencyGperW, classify,
    airDensity, cosineTWR, measuredEfficiencyGperW
  });
})();
window.Calc = Calc;

(function () {
  'use strict';

  const fallbackDb = {
    config: { motor_count: 4, payload_slider_max_g: 2000 },
    propulsion: [
      { id: '1806_2300', label: '1806 2300KV + 5"', prop_diameter_m: 0.127, max_thrust_g: 480, fom: 0.68, typical_frame_mass_g: 450 },
      { id: '2204_2300', label: '2204 2300KV + 5"', prop_diameter_m: 0.127, max_thrust_g: 620, fom: 0.70, typical_frame_mass_g: 500, default: true },
      { id: '2207_1600', label: '2207 1600KV + 5"', prop_diameter_m: 0.127, max_thrust_g: 1150, fom: 0.72, typical_frame_mass_g: 560 },
      { id: '2212_920', label: '2212 920KV + 10"', prop_diameter_m: 0.254, max_thrust_g: 1050, fom: 0.70, typical_frame_mass_g: 800 },
      { id: '2808_1200', label: '2808 1200KV + 7"', prop_diameter_m: 0.178, max_thrust_g: 1600, fom: 0.71, typical_frame_mass_g: 700 },
      { id: '3508_700', label: '3508 700KV + 13"', prop_diameter_m: 0.330, max_thrust_g: 2100, fom: 0.72, typical_frame_mass_g: 1500 },
      { id: '4008_380', label: '4008 380KV + 15"', prop_diameter_m: 0.381, max_thrust_g: 2850, fom: 0.73, typical_frame_mass_g: 1900 },
      { id: '5010_280', label: '5010 280KV + 16"', prop_diameter_m: 0.406, max_thrust_g: 3600, fom: 0.74, typical_frame_mass_g: 2400 }
    ],
    twr: { bands: [
      { max: 1.0, label: 'cannot lift off', tone: 'danger' },
      { max: 1.5, label: 'underpowered', tone: 'danger' },
      { max: 2.0, label: 'stable / cinematic', tone: 'warn' },
      { max: 3.0, label: 'sport', tone: 'good' },
      { max: 5.0, label: 'freestyle', tone: 'good' },
      { max: 999, label: 'racing / extreme', tone: 'good' }
    ] },
    payload: { twr_min_safe: 2.0 },
    efficiency: { rho_kg_m3: 1.225, figure_of_merit_default: 0.70 },
    constants: { g_m_s2: 9.80665 }
  };

  // Single source of truth: the bundled VLAB_CATALOG is preferred over db/db.json —
  // same pattern as exp1/2/4/5's Calc.loadCatalog(), fixes the dual-catalog-source-
  // drift bug class. The performance-envelope-only blocks below (motor+prop combo
  // table, TWR bands, payload/efficiency defaults, constants) live ONLY in this
  // experiment's db.json/fallbackDb, never in the shared catalog, so they're
  // merged on afterward regardless of which source won.
  function loadCatalog() {
    function withLocal(db) {
      db.config = db.config || fallbackDb.config;
      db.propulsion = db.propulsion || fallbackDb.propulsion;
      db.twr = db.twr || fallbackDb.twr;
      db.payload = db.payload || fallbackDb.payload;
      db.efficiency = db.efficiency || fallbackDb.efficiency;
      db.constants = db.constants || fallbackDb.constants;
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

  // Shared viewport preference so the SAME drone (same prop blade count) shows
  // consistently across both Module pages and the other experiments.
  const readBlades = () => { try { const v = parseInt(localStorage.getItem('vlab:viz:blades'), 10); return (v === 3 || v === 4) ? v : 2; } catch (e) { return 2; } };
  const writeBlades = (n) => { try { localStorage.setItem('vlab:viz:blades', String(n)); } catch (e) { /* storage unavailable */ } };

  const LS = {
    session: 'vlabExp6_session',
    twr: 'vlabExp6_twr', hoverThrottle: 'vlabExp6_hoverThrottle', controlMargin: 'vlabExp6_controlMargin',
    maxPayload: 'vlabExp6_maxPayload', efficiency: 'vlabExp6_hoverEfficiency'
  };

  const state = {
    view: 'experiment',        // 'experiment' (build + 3-D bay) | 'analysis' (2x2 chart grid)
    db: fallbackDb,
    scenario: 'none',          // injected design challenge (session-only, never persisted)
    tiltDeg: 0,                // 'tilt30' scenario overlay — forward-flight cosine loss (session-only)
    scenarioAltitudeM: 0,      // 'thin_air' scenario overlay, ADDED on top of the real env.altitude_m (session-only)
    viewedAnalysis: false,
    combo: null,
    emptyG: 500,
    payloadG: 0,
    twrMin: 2.0,
    propBlades: 2,             // user-selectable propeller blade count (2/3/4) for the 3-D model
    inheritedMass: false, comboUserSet: false,
    fullCurrent_A: null, hoverCurrent_A: null,   // inherited from Exp 1 (measured-efficiency comparison)
    battVoltage: null,                            // inherited from the shared battery selection
    _lastTone: null, _lastHoverPast70: false, _lastPractical: null,   // transition trackers for the Instructor
    phase: 0, lastTime: null, anim: 0
  };

  let viz = null;              // 3-D viewport handle (null in tests: THREE stripped)

  function N() { return state.db.config.motor_count || 4; }
  // ISA density at the current altitude: the REAL shared env.altitude_m (e.g.
  // set upstream in Exp 1) as the baseline, plus the session-only 'thin_air'
  // scenario overlay for a local "what if we flew this at 3000 m" preview —
  // the overlay is NEVER written back to the shared store (matches the
  // existing session-only scenario convention), so it can't falsely flip
  // Exp 1 stale for a hypothetical toggle.
  function currentAltitudeM() {
    let envAlt = 0;
    try { if (window.VLABStore) envAlt = window.VLABStore.get().env.altitude_m || 0; } catch (e) { /* store optional */ }
    return envAlt + (state.scenarioAltitudeM || 0);
  }
  function rho() {
    if (window.Calc && Calc.airDensity) return Calc.airDensity(currentAltitudeM());
    return state.db.efficiency.rho_kg_m3 || 1.225;
  }
  function totalMassG() { return state.emptyG + state.payloadG; }
  // Deterministic per-build figure-of-merit within the documented real-rotor
  // band (VLAB_CONST.REAL.figure_of_merit_range = [0.55, 0.75]) instead of the
  // catalog's flat nominal — real assembly/balance variance shifts FoM inside
  // that band, seeded by the combo id so it's stable for a given motor choice.
  function seededFoM(comboId, nominal) {
    try {
      if (window.VLAB_CONST && VLAB_CONST.partDeviate && VLAB_CONST.REAL) {
        const rng = VLAB_CONST.REAL.figure_of_merit_range;
        const u = (VLAB_CONST.partDeviate(String(comboId) + ':fom') + 1) / 2;   // 0..1
        return rng[0] + (rng[1] - rng[0]) * u;
      }
    } catch (e) { /* constants optional */ }
    return nominal;
  }

  // ── connections to upstream experiments ────────────────────────────────────
  function inheritFromExp1() {
    let motorId = null, tmaxN = null, propId = null;
    try {
      if (window.VLABStore) {
        const b = window.VLABStore.get();
        motorId = b.components.motorId; propId = b.components.propId;
        const e1 = window.VLABStore.upstream('exp1');
        if (e1 && typeof e1.T_max_per_motor_N === 'number') tmaxN = e1.T_max_per_motor_N;
        if (e1 && typeof e1.fullCurrent_A === 'number') state.fullCurrent_A = e1.fullCurrent_A;
        if (e1 && typeof e1.hoverCurrent_A === 'number') state.hoverCurrent_A = e1.hoverCurrent_A;
      }
    } catch (e) { /* store optional */ }
    const m1 = readJSON('vlabModule1');
    if (!motorId && m1) motorId = m1.mId;
    if (motorId) {
      const c = byId(state.db.propulsion, motorId);
      if (c && c.id === motorId) { state.combo = c; state.inheritedCombo = true; }
    }
    // Override the combo's STATIC datasheet thrust with Exp 1's ACTUAL BEMT max
    // thrust (T[N] -> grams-force) and the real selected prop diameter, so TWR /
    // payload / efficiency reflect the drone the user actually designed.
    if (state.combo && (tmaxN || propId)) {
      const ov = Object.assign({}, state.combo);
      if (tmaxN) { ov.max_thrust_g = +(tmaxN / Calc.G * 1000).toFixed(1); ov._thrustFromExp1 = true; }
      if (propId && window.VLAB_CATALOG) {
        const p = (window.VLAB_CATALOG.propellers || []).find((x) => x.id === propId);
        if (p && p.diameter_m) ov.prop_diameter_m = p.diameter_m;
      }
      state.combo = ov;
    }
  }
  function inheritFromExp2() {
    let m2 = null;
    try { if (window.VLABStore) m2 = window.VLABStore.upstream('exp2'); } catch (e) { /* store optional */ }
    if (!m2) m2 = readJSON('vlabModule2_final');
    if (!m2) return;
    const massG = (typeof m2.total_mass_g === 'number') ? m2.total_mass_g : m2.mass_g;
    if (typeof massG === 'number' && massG > 0) { state.emptyG = massG; state.inheritedMass = true; }
  }
  // Bus voltage for the measured-efficiency comparison (real V*I vs the ideal
  // momentum-theory prediction) — from the shared battery selection, never a
  // hard-coded voltage. Falls back to a labelled 4S nominal only if no battery
  // has been chosen anywhere in the build yet.
  function inheritBatteryVoltage() {
    try {
      if (window.VLABStore && window.VLAB_CATALOG) {
        const bId = window.VLABStore.get().components.batteryId;
        const b = (window.VLAB_CATALOG.batteries || []).find((x) => x.id === bId);
        if (b && typeof b.voltage_nominal_v === 'number') { state.battVoltage = b.voltage_nominal_v; return; }
      }
    } catch (e) { /* store optional */ }
    state.battVoltage = 14.8; // 4S nominal fallback — no battery selected upstream yet
  }

  function restoreSession() {
    const s = readJSON(LS.session);
    if (!s || typeof s !== 'object') return;
    if (s.comboUserSet) {
      const c = byId(state.db.propulsion, s.comboId);
      if (c && c.id === s.comboId) { state.combo = c; state.comboUserSet = true; if (!state.inheritedMass) state.emptyG = c.typical_frame_mass_g; }
    }
    state.payloadG = clampNum(s.payloadG, 0, state.db.config.payload_slider_max_g || 2000, state.payloadG);
    state.twrMin = clampNum(s.twrMin, 1.5, 2.5, state.twrMin);
  }

  let _lastPersist = '', _lastPersistAt = -1e9;
  function persist() {
    try {
      if (!state.combo) return;
      const payload = { comboId: state.combo.id, comboUserSet: state.comboUserSet, payloadG: Math.round(state.payloadG), twrMin: state.twrMin };
      const str = JSON.stringify(payload);
      const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      if (str === _lastPersist || now - _lastPersistAt < 350) return;
      _lastPersist = str; _lastPersistAt = now;
      localStorage.setItem(LS.session, str);
      const c = state.combo, m = totalMassG(), t = Calc.twr(N(), c.max_thrust_g, m);
      const fomSeeded = seededFoM(c.id, c.fom);
      const rhoNow = rho();
      const tEff = Calc.cosineTWR(t, state.tiltDeg);
      const payloadTheoretical = Math.max(0, Calc.maxPayloadG(N(), c.max_thrust_g, state.emptyG, 1.0));
      const payloadPractical = Math.max(0, Calc.maxPayloadG(N(), c.max_thrust_g, state.emptyG, 1.5));
      const effIdeal = Calc.efficiencyGperW(m, N(), c.prop_diameter_m, fomSeeded, rhoNow);
      const fullPowerW = (state.battVoltage && state.fullCurrent_A) ? N() * state.battVoltage * state.fullCurrent_A : null;
      const effMeasured = (state.battVoltage && state.hoverCurrent_A)
        ? Calc.measuredEfficiencyGperW(m, state.battVoltage, state.hoverCurrent_A, N()) : null;

      localStorage.setItem(LS.twr, t.toFixed(3));
      localStorage.setItem(LS.hoverThrottle, (Calc.hoverThrottle(t) * 100).toFixed(1));
      localStorage.setItem(LS.controlMargin, Calc.controlMarginPct(t).toFixed(1));
      localStorage.setItem(LS.maxPayload, Calc.maxPayloadG(N(), c.max_thrust_g, state.emptyG, state.twrMin).toFixed(0));
      localStorage.setItem(LS.efficiency, effIdeal.toFixed(2));

      // Publish the final flight-performance verdict to the unified store (Exp 6 slice).
      // This is the last link of the chain — the completed drone's real capability,
      // computed from Exp 1's thrust and Exp 2's mass.
      if (window.VLABStore) {
        const cls = Calc.classify(t, state.db.twr && state.db.twr.bands);
        window.VLABStore.finalize('exp6', {
          motorId: state.combo.id,
          twr: +t.toFixed(3),
          hover_throttle_pct: +(Calc.hoverThrottle(t) * 100).toFixed(1),
          control_margin_pct: +Calc.controlMarginPct(t).toFixed(1),
          max_payload_g: +Calc.maxPayloadG(N(), c.max_thrust_g, state.emptyG, state.twrMin).toFixed(0),
          efficiency_g_per_w: +effIdeal.toFixed(2),
          total_mass_g: Math.round(m),
          max_thrust_per_motor_g: +c.max_thrust_g.toFixed(1),
          thrust_from_exp1: !!c._thrustFromExp1,
          classification: cls ? cls.label : null,
          // ── redesign additions ──
          payload_theoretical_g: +payloadTheoretical.toFixed(0),
          payload_practical_g: +payloadPractical.toFixed(0),
          hover_current_A: (typeof state.hoverCurrent_A === 'number') ? +state.hoverCurrent_A.toFixed(2) : null,
          full_power_W: (fullPowerW != null) ? +fullPowerW.toFixed(1) : null,
          efficiency_measured_g_per_w: (effMeasured != null) ? +effMeasured.toFixed(2) : null,
          twr_effective_30deg: +Calc.cosineTWR(t, 30).toFixed(3),
          altitude_m: currentAltitudeM()
        });
      }
      // Refresh the "Your Drone Build" summary panel and the live violation banner.
      if (window.__vlabSummaryRefresh) { try { window.__vlabSummaryRefresh(); } catch (e) { /* optional */ } }
      if (window.__vlabBannerRefresh) { try { window.__vlabBannerRefresh(); } catch (e) { /* optional */ } }
    } catch (e) { /* storage unavailable */ }
  }

  // ── boot ────────────────────────────────────────────────────────────────────
  function appInit() {
    if (!$('benchCanvas')) return;
    loadCatalog().then((db) => { state.db = db; boot(); }).catch(() => boot());
  }

  function boot() {
    state.combo = state.db.propulsion.find((c) => c.default) || state.db.propulsion[1] || state.db.propulsion[0];
    state.emptyG = state.combo.typical_frame_mass_g;
    state.twrMin = (state.db.payload && state.db.payload.twr_min_safe) || 2.0;

    inheritFromExp1();       // motor/prop combo + fullCurrent_A/hoverCurrent_A from Experiment 1
    inheritFromExp2();       // empty mass from Experiment 2 (authoritative when present)
    inheritBatteryVoltage(); // bus voltage for the measured-vs-ideal efficiency comparison
    restoreSession();        // a saved Exp6 session (refresh / re-login) overrides
    state.propBlades = readBlades();   // shared drone blade-count preference (2/3/4)

    hydrateControls();
    bindControls();
    initScene3D();
    resizeCanvases();
    primeTransitionState();   // seed the _last* trackers so the FIRST updateAll() doesn't fire a spurious transition-announce
    updateAll();
    announceModuleIntro();    // the one true "what is this module" message, spoken once on load
    if (window.SFX) { window.SFX.start(); window.SFX.motor(state.view === 'experiment'); }
    requestAnimationFrame(loop);
  }

  // Silently seeds announceTransitions()'s trackers to the CURRENT state so
  // the first updateAll() call (which always finds tone/mode "changed" from
  // their initial null) doesn't speak a spurious transition before the module
  // intro has had a chance to play.
  function primeTransitionState() {
    const d = compute();
    state._lastTone = toneFor(d);
    state._lastHoverPast70 = d.canHover && d.hovPct >= 70;
    state._lastPractical = state.payloadG >= d.payloadPractical && d.payloadPractical > 0;
  }

  // Spoken once per page load — explains the module's purpose, distinct from
  // the live numeric readouts. Names the missing upstream experiments in plain
  // text only (no cross-experiment navigation) when Exp 1/2 aren't ready yet.
  function announceModuleIntro() {
    if (typeof window === 'undefined' || !window.Instructor) return;
    let ready = true;
    try { if (window.VLABStore) ready = window.VLABStore.readyFor('exp6').ready; } catch (e) { /* store optional */ }
    window.Instructor.say(ready
      ? 'GUIDE: Everything you designed so far is theory until this number. The mass budget below is your actual build — check its thrust-to-weight ratio before anything else.'
      : 'GUIDE: This experiment judges your build, so it needs one to judge. Finalize the propulsion and structures experiments first — their thrust and mass feed every number here.');
  }

  function hydrateControls() {
    const ps = $('propulsionSelect');
    if (ps) ps.innerHTML = state.db.propulsion.map((c) => `<option value="${esc(c.id)}"${c.id === state.combo.id ? ' selected' : ''}>${esc(c.label)}</option>`).join('');
    setVal('payloadSlider', state.payloadG); setText('payloadOut', Math.round(state.payloadG) + ' g');
    const tm = $('twrTargetSelect'); if (tm) tm.value = Number(state.twrMin).toFixed(1);
    const pmax = state.db.config.payload_slider_max_g || 2000;
    const pslider = $('payloadSlider'); if (pslider) pslider.max = String(pmax);
    syncBladeButtons();
    syncView();
  }

  function bindControls() {
    on('propulsionSelect', 'change', (e) => {
      if (window.SFX) window.SFX.click();
      const c = byId(state.db.propulsion, e.target.value);
      state.combo = c; state.comboUserSet = true;
      if (!state.inheritedMass) state.emptyG = c.typical_frame_mass_g;
      updateAll();
    });
    on('payloadSlider', 'input', (e) => { state.payloadG = +e.target.value; setText('payloadOut', Math.round(state.payloadG) + ' g'); updateAll(); });
    on('payloadSlider', 'change', () => { if (window.SFX) window.SFX.click(); });
    on('twrTargetSelect', 'change', (e) => {
      if (window.SFX) window.SFX.click();
      state.twrMin = parseFloat(e.target.value);
      updateAll();
    });
    on('resetBtn', 'click', () => {
      if (window.SFX) window.SFX.click();
      state.payloadG = 0; setVal('payloadSlider', 0); setText('payloadOut', '0 g'); updateAll();
    });
    on('maxPayloadBtn', 'click', () => {
      if (window.SFX) window.SFX.click();
      const c = state.combo; const mp = Math.max(0, Calc.maxPayloadG(N(), c.max_thrust_g, state.emptyG, state.twrMin));
      state.payloadG = Math.min(mp, state.db.config.payload_slider_max_g || 2000);
      setVal('payloadSlider', state.payloadG); setText('payloadOut', Math.round(state.payloadG) + ' g'); updateAll();
    });
    document.querySelectorAll('.vp-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.view !== state.view && window.SFX) window.SFX.click();
        state.view = btn.dataset.view; syncView(); updateAll();
      });
    });
    document.querySelectorAll('.blade-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const n = Math.max(2, Math.min(4, parseInt(btn.dataset.blades, 10) || 2));
        if (n === state.propBlades) return;
        if (window.SFX) window.SFX.click();
        state.propBlades = n; writeBlades(n); syncBladeButtons(); rebuildQuad();
      });
    });
    window.addEventListener('resize', resizeCanvases);
  }

  // toggle the Experiment / Analysis view panels; the Analysis chart grid is
  // announced once (reusing the module-2 intro clip) the first time it's opened.
  function syncView() {
    document.querySelectorAll('.vp-tab').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
    const ev = $('experimentView'), av = $('analysisView');
    if (ev) ev.classList.toggle('active', state.view === 'experiment');
    if (av) av.classList.toggle('active', state.view === 'analysis');
    // the prop-spin whir only makes sense while the 3-D hover bench is on screen
    if (window.SFX) window.SFX.motor(state.view === 'experiment');
    if (state.view === 'analysis' && !state.viewedAnalysis) {
      state.viewedAnalysis = true;
      if (window.Instructor) window.Instructor.say('GUIDE: Sweep the payload and watch the hover throttle climb — not in a straight line, but curving upward, because thrust grows with the square of throttle.');
    }
    resizeCanvases();
    // draw immediately on switch so the grid isn't blank for a frame while
    // the rAF loop (which now only redraws charts on the active view) catches up
    if (state.view === 'analysis') drawAllCharts(compute());
  }

  // headline result cards — titles are static in HTML now. items: [[value, cls?], ...] x4; 4th drives the margin verdict.
  function setCards(items) {
    items.forEach((it, i) => setText('cardV' + (i + 1), it[0]));
    const v = $('card4');
    if (v && items[3]) v.className = 'summary-card margin-card ' + (items[3][1] || '');
  }

  // ── derived values ──────────────────────────────────────────────────────────
  function compute() {
    const c = state.combo, m = totalMassG(), n = N();
    const fom = seededFoM(c.id, c.fom);
    const rhoNow = rho();
    const TWR = Calc.twr(n, c.max_thrust_g, m);
    const TWR_eff = Calc.cosineTWR(TWR, state.tiltDeg);            // forward-tilt cosine loss overlay
    const band = Calc.classify(TWR, state.db.twr && state.db.twr.bands);
    const bandEff = Calc.classify(TWR_eff, state.db.twr && state.db.twr.bands);
    const hov = Calc.hoverThrottle(TWR);
    const effIdeal = Calc.efficiencyGperW(m, n, c.prop_diameter_m, fom, rhoNow);
    const effMeasured = (state.battVoltage && state.hoverCurrent_A)
      ? Calc.measuredEfficiencyGperW(m, state.battVoltage, state.hoverCurrent_A, n) : null;
    return {
      c: c, m: m, n: n, TWR: TWR, TWR_eff: TWR_eff, band: band, bandEff: bandEff,
      hovThrottle: hov, hovPct: Math.min(hov, 1.5) * 100, canHover: hov <= 1,
      margin: Calc.controlMarginPct(TWR),
      hoverPerMotor: Calc.hoverThrustPerMotorG(m, n),
      maxPayload: Calc.maxPayloadG(n, c.max_thrust_g, state.emptyG, state.twrMin),
      payloadTheoretical: Math.max(0, Calc.maxPayloadG(n, c.max_thrust_g, state.emptyG, 1.0)),
      payloadPractical: Math.max(0, Calc.maxPayloadG(n, c.max_thrust_g, state.emptyG, 1.5)),
      maxTakeoff: Calc.maxTakeoffMassG(n, c.max_thrust_g, state.twrMin),
      A: Calc.diskArea(n, c.prop_diameter_m),
      fom: fom,
      Phover: Calc.hoverPowerW(m / 1000, n, c.prop_diameter_m, fom, rhoNow),
      eff: effIdeal,
      effMeasured: effMeasured,
      altitudeM: currentAltitudeM(),
      tiltDeg: state.tiltDeg
    };
  }

  function rows(list) { return list.map((r) => `<div class="metric"><span>${esc(r[0])}</span><strong>${r[1]}</strong></div>`).join(''); }
  function probes(list) { return list.map((r) => `<div class="probe ${r[2] || ''}"><span>${esc(r[0])}</span><strong>${r[1]}</strong></div>`).join(''); }
  function toneCls(tone) { return tone === 'danger' ? 'hot' : tone === 'warn' ? 'warm' : 'cool'; }

  function updateAll() {
    const d = compute();

    setText('benchHud', [
      ['TWR', d.TWR.toFixed(2)],
      ['Class', d.band.label],
      ['Hover', d.canHover ? d.hovPct.toFixed(0) + ' %' : '>100 %'],
      ['Payload', Math.round(state.payloadG) + ' g']
    ].map((r) => `<div><span>${r[0]}</span><strong>${r[1]}</strong></div>`).join(''));

    setText('metricList', rows([
      ['Propulsion', esc(d.c.label) + (d.c._thrustFromExp1 ? ' (Exp 1)' : ' (datasheet default)')],
      ['Empty mass', state.emptyG.toFixed(0) + ' g' + (state.inheritedMass ? ' (Exp 2)' : ' (typical default)')],
      ['Payload', Math.round(state.payloadG) + ' g'],
      ['All-up mass', d.m.toFixed(0) + ' g'],
      ['Max thrust (x' + d.n + ')', (d.n * d.c.max_thrust_g) + ' g'],
      ['Thrust-to-weight', d.TWR.toFixed(2)],
      ['Hover throttle', d.canHover ? d.hovPct.toFixed(1) + ' %' : 'cannot hover']
    ]));

    const probeRows = [
      ['Class', d.band.label, toneCls(d.band.tone)],
      ['Hover thrust / motor', d.hoverPerMotor.toFixed(0) + ' g', ''],
      ['Control margin', d.margin.toFixed(1) + ' %', d.margin > 30 ? 'cool' : d.margin > 0 ? 'warm' : 'hot'],
      ['Thrust headroom', (d.n * d.c.max_thrust_g - d.m).toFixed(0) + ' g', '']
    ];
    if (state.tiltDeg) probeRows.push(['TWR at ' + state.tiltDeg + '° tilt (cosine loss)', d.TWR_eff.toFixed(2), d.bandEff.tone === 'danger' ? 'hot' : d.bandEff.tone === 'warn' ? 'warm' : 'cool']);
    if (state.scenarioAltitudeM) probeRows.push(['Altitude (session preview)', Math.round(d.altitudeM) + ' m', 'warm']);
    probeRows.push(
      ['Min safe TWR', state.twrMin.toFixed(1), ''],
      ['Max take-off mass', d.maxTakeoff.toFixed(0) + ' g', ''],
      ['Max payload', Math.max(0, d.maxPayload).toFixed(0) + ' g', d.maxPayload > 0 ? 'cool' : 'hot'],
      ['Theoretical vs practical', d.payloadTheoretical.toFixed(0) + ' g / ' + d.payloadPractical.toFixed(0) + ' g', ''],
      ['Disk area', d.A.toFixed(4) + ' m2', ''],
      ['Figure of merit (seeded)', d.fom.toFixed(2), ''],
      ['Hover power (ideal)', d.Phover.toFixed(1) + ' W', ''],
      ['Hover efficiency — ideal', d.eff.toFixed(2) + ' g/W', 'cool']
    );
    if (d.effMeasured != null) probeRows.push(['Hover efficiency — measured', d.effMeasured.toFixed(2) + ' g/W (Exp 1 current)', 'warm']);
    setText('probeList', probes(probeRows));

    setText('eqA', `TWR = N&middot;T<sub>max</sub>/m = ${d.n}&times;${d.c.max_thrust_g}/${d.m.toFixed(0)} = <b>${d.TWR.toFixed(2)}</b> (${d.band.label})`);
    setText('eqB', d.canHover
      ? `hover = &radic;(1/TWR) = <b>${d.hovPct.toFixed(1)}%</b>; control margin = <b>${d.margin.toFixed(1)}%</b>`
      : `TWR &le; 1: the craft <b>cannot hover</b> at this mass.`);
    setText('eqC', `max payload = N&middot;T<sub>max</sub>/${state.twrMin.toFixed(1)} &minus; ${state.emptyG.toFixed(0)} = <b>${Math.max(0, d.maxPayload).toFixed(0)} g</b>`);
    setText('eqD', `P = (m g)<sup>1.5</sup>/(FoM&radic;(2&rho;A)) = <b>${d.Phover.toFixed(1)} W</b> &rarr; eff = <b>${d.eff.toFixed(2)} g/W</b>`);

    const verdictCls = d.band.tone === 'danger' ? 'fail' : d.band.tone === 'warn' ? 'warn' : 'pass';
    setCards([
      [d.TWR.toFixed(2)],
      [d.canHover ? d.hovPct.toFixed(0) + ' %' : '>100%'],
      [Math.max(0, d.maxPayload).toFixed(0) + ' g'],
      [d.canHover ? 'FLIES' : 'CANNOT LIFT', d.canHover ? verdictCls : 'fail']
    ]);

    renderObjectives(d);
    renderScenario();
    const tone = renderVerdict(d);

    setMessage(messageFor(d));
    announceTransitions(d, tone);
    persist();
  }

  function messageFor(d) {
    if (!d.canHover) return `At ${d.m.toFixed(0)} g the thrust-to-weight ratio is only ${d.TWR.toFixed(2)} — below 1, the craft cannot leave the ground. Reduce payload or fit stronger motors.`;
    const authority = d.margin > 40 ? 'plenty of authority' : d.margin > 20 ? 'adequate authority' : 'authority getting tight';
    return `TWR ${d.TWR.toFixed(2)} (${d.band.label}). Hovers at ${d.hovPct.toFixed(1)}% throttle with a ${d.margin.toFixed(0)}% control margin — ${authority}. Carries up to ${Math.max(0, d.maxPayload).toFixed(0)} g at TWR ${state.twrMin.toFixed(1)}, and ${d.eff.toFixed(2)} g/W at hover.`;
  }

  function checklist(items) {
    return items.map((it) => {
      const done = it[1], warn = it[3];
      const cls = done ? 'done' : (warn ? 'warn' : 'pending');
      const mark = done ? '\u2713' : (warn ? '!' : '');
      return `<div class="checklist-item"><span class="chk-icon ${cls}">${mark}</span><span class="checklist-label">${esc(it[0])}</span><span class="checklist-val">${esc(it[2] || '')}</span></div>`;
    }).join('');
  }
  // Always-current on-screen bubble text (no audio) — Instructor.say() (audio +
  // text together) is reserved for discrete transitions, see announceTransitions().
  function setMessage(t) {
    setText('labMessage', t);
    const el = document.getElementById('liveCommentaryText');
    if (el) el.innerHTML = t;
  }

  // ── Traffic-light verdict (the go/no-go for this whole lab series) ─────────
  // Uses the tilt/altitude-EFFECTIVE TWR when a scenario overlay is active, so
  // the verdict genuinely reacts to the injected fault, not just the nominal
  // hover number.
  function toneFor(d) {
    const scenarioActive = !!(state.tiltDeg || state.scenarioAltitudeM);
    const activeBand = scenarioActive ? d.bandEff : d.band;
    return activeBand.tone === 'danger' ? 'fail' : activeBand.tone === 'warn' ? 'warn' : 'pass';
  }
  function renderVerdict(d) {
    const scenarioActive = !!(state.tiltDeg || state.scenarioAltitudeM);
    const activeTWR = scenarioActive ? d.TWR_eff : d.TWR;
    const activeBand = scenarioActive ? d.bandEff : d.band;
    const tone = toneFor(d);
    const label = (tone === 'fail' ? 'NOT CLEARED' : tone === 'warn' ? 'CLEARED WITH CAUTION' : 'CLEARED FOR FLIGHT TEST') + ' — TWR ' + activeTWR.toFixed(2);
    let note = activeBand.label;
    if (state.tiltDeg) note += ' · ' + state.tiltDeg + '° tilt applied';
    if (state.scenarioAltitudeM) note += ' · ' + Math.round(d.altitudeM) + ' m altitude';
    if (typeof window !== 'undefined' && window.VLABLab) window.VLABLab.verdict('verdictHost', { label: label, tone: tone, note: note });
    return tone;
  }

  // ── Discrete Instructor narration triggers ──────────────────────────────────
  // Instructor.say() is reserved for meaningful state transitions (tone flips,
  // threshold crossings, mode/scenario changes) — NOT fired on every slider
  // tick, so dragging the payload slider doesn't spam/restart audio.
  function announceTransitions(d, tone) {
    if (typeof window === 'undefined' || !window.Instructor) return;
    if (tone !== state._lastTone) { state._lastTone = tone; window.Instructor.say(messageFor(d)); return; }
    const past70 = d.canHover && d.hovPct >= 70;
    if (past70 !== state._lastHoverPast70) {
      state._lastHoverPast70 = past70;
      if (past70) window.Instructor.say('OBSERVE: Past seventy percent hover throttle now — the curve is steepening and real control authority is compressing faster than the numbers suggest.');
      return;
    }
    const atPractical = state.payloadG >= d.payloadPractical && d.payloadPractical > 0;
    if (atPractical !== state._lastPractical) {
      state._lastPractical = atPractical;
      if (atPractical) window.Instructor.say('OBSERVE: Practical payload limit reached. Roughly forty percent of the theoretical maximum is reserved — not wasted — as the control margin that keeps this a drone and not a projectile.');
    }
  }

  // ── Uniform fault scenarios (design challenges): inject a bad condition, then resolve it
  //    with the real controls (shed payload / fit stronger motors). Replaces "record readings". ──
  const SCENARIOS = [
    { id: 'none', label: 'Balanced build', desc: 'Your inherited drone at the current payload.' },
    { id: 'overload', label: 'Over the safe TWR limit', desc: 'A heavy payload drags thrust-to-weight below the safe minimum. Shed payload (or fit stronger motors) to recover.', fault: true },
    { id: 'nolift', label: 'Cannot lift off (TWR < 1)', desc: 'All-up weight exceeds total thrust. Reduce payload or choose stronger propulsion to get airborne.', fault: true },
    { id: 'thin_air', label: 'High-altitude test (3000 m)', desc: 'Thinner air lowers both available thrust and hover efficiency — the whole envelope re-rates even though nothing about the drone itself changed. Session preview only, not saved to your build.', fault: true },
    { id: 'tilt30', label: '30° forward tilt (cosine loss)', desc: 'Aggressive forward flight tilts the thrust vector — only its vertical component still fights gravity, eroding the margin you had at a stationary hover.', fault: true }
  ];
  function clearOverlays() { state.tiltDeg = 0; state.scenarioAltitudeM = 0; }
  function applyScenario(id) {
    if (window.SFX) window.SFX.click();
    state.scenario = id;
    clearOverlays();
    const c = state.combo, thrust = N() * c.max_thrust_g, pMax = state.db.config.payload_slider_max_g || 2000;
    if (id === 'overload') state.payloadG = Calc.clamp(Math.round(thrust / (state.twrMin * 0.8) - state.emptyG), 0, pMax);
    else if (id === 'nolift') state.payloadG = Calc.clamp(Math.round(thrust / 0.85 - state.emptyG), 0, pMax);
    else if (id === 'thin_air') state.scenarioAltitudeM = 3000;
    else if (id === 'tilt30') state.tiltDeg = 30;
    else state.payloadG = 0;
    setVal('payloadSlider', state.payloadG); setText('payloadOut', Math.round(state.payloadG) + ' g');
    if (window.Instructor) {
      const s = SCENARIOS.find((x) => x.id === id);
      if (s) window.Instructor.say((s.fault ? 'CAUTION: ' : 'GUIDE: ') + s.desc);
    }
    updateAll();
  }
  function renderScenario() {
    if (typeof window === 'undefined' || !window.VLABLab) return;
    window.VLABLab.scenario('scenarioHost', { title: 'Design challenge', current: state.scenario, options: SCENARIOS, onSelect: applyScenario });
  }

  // ── Uniform auto-ticking objectives (VLABLab) — replaces the "log >= 3 readings" checklist.
  //    Each row ticks the instant the real engineering condition is met. ──
  function objectiveDefs(d) {
    return [
      { id: 'lift', label: 'Establish lift (TWR > 1)', hint: 'Total thrust must beat all-up weight or the craft never leaves the ground.', test: () => d.canHover, warn: () => !d.canHover, value: () => 'TWR ' + d.TWR.toFixed(2) },
      { id: 'auth', label: 'Hover authority \u2265 30% margin', hint: 'Under ~30% control margin the quad has little left for manoeuvres or wind.', test: () => d.canHover && d.margin >= 30, warn: () => d.canHover && d.margin > 0 && d.margin < 30, value: () => d.canHover ? d.margin.toFixed(0) + '%' : '\u2014' },
      { id: 'class', label: 'Not underpowered', hint: 'Aim for at least the stable / cinematic band.', test: () => d.band.tone !== 'danger', warn: () => d.band.tone === 'warn', value: () => d.band.label },
      { id: 'safe', label: 'Payload holds safe TWR', hint: 'Keep thrust-to-weight at or above the chosen minimum with payload aboard.', test: () => d.TWR >= state.twrMin, warn: () => d.TWR >= 1 && d.TWR < state.twrMin, value: () => 'TWR ' + d.TWR.toFixed(2) + ' / ' + state.twrMin.toFixed(1) },
      { id: 'practical', label: 'Practical payload ~60% of theoretical', hint: 'The safe (TWR>=1.5) payload is deliberately less than the TWR=1.0 theoretical limit — that gap is the mandatory control reserve.', test: () => d.payloadTheoretical > 0 && (d.payloadPractical / d.payloadTheoretical) >= 0.45 && (d.payloadPractical / d.payloadTheoretical) <= 0.75, value: () => d.payloadTheoretical > 0 ? Math.round(100 * d.payloadPractical / d.payloadTheoretical) + '%' : '—' },
      { id: 'eff', label: 'Hover efficiency evaluated (ideal vs measured)', hint: 'Open the Analysis tab to compare the momentum-theory ideal against the real efficiency from Exp 1’s measured current.', test: () => state.viewedAnalysis, value: () => d.eff.toFixed(1) + (d.effMeasured != null ? ' / ' + d.effMeasured.toFixed(1) : '') + ' g/W' }
    ];
  }
  function renderObjectives(d) {
    if (typeof window !== 'undefined' && window.VLABLab) {
      const res = window.VLABLab.objectives('checklist', objectiveDefs(d), state, { title: 'Flight Performance objectives' });
      if (res && res.allDone) showUnlockCard();
    }
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

  // ── canvases ──────────────────────────────────────────────────────────────────
  const SCOPE_IDS = ['scopeTwr', 'scopeHover', 'scopePayload', 'scopeEfficiency'];

  function resizeCanvases() {
    // each 2-D analysis chart keeps a device-pixel backing store for crisp curves
    SCOPE_IDS.forEach((id) => {
      const sc = $(id);
      if (!sc) return;
      const rect = sc.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(320, Math.round((rect.width || 480) * dpr)), h = Math.max(160, Math.round((rect.height || 220) * dpr));
      if (sc.width !== w || sc.height !== h) { sc.width = w; sc.height = h; }
    });
    // 3-D hover-bench viewport follows its wrapper's CSS box
    if (viz && viz.renderer) {
      const host = viz.canvas.parentElement || viz.canvas;
      const w = Math.max(2, host.clientWidth || 600), h = Math.max(2, host.clientHeight || 360);
      viz.renderer.setSize(w, h, false);
      viz.camera.aspect = w / h; viz.camera.updateProjectionMatrix();
    }
  }

  function loop(now) {
    if (state.lastTime === null) state.lastTime = now;
    let dt = (now - state.lastTime) / 1000; state.lastTime = now;
    if (dt > 0.05) dt = 0.05; if (dt < 0) dt = 0;
    state.phase = now / 1000; state.anim += dt;
    // one compute() snapshot shared by the 3-D scene and the charts — both
    // used to call compute() independently every frame (2x the work for the
    // same numbers); charts only redraw while the Analysis tab is visible.
    const d = compute();
    updateScene3D(dt, d);
    if (state.view === 'analysis') drawAllCharts(d);
    requestAnimationFrame(loop);
  }

  function ff() { try { return getComputedStyle(document.body).fontFamily || 'Inter, sans-serif'; } catch (e) { return 'Inter, sans-serif'; } }
  function line(ctx, x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }

  // ── 3-D flight-performance viewport (three.js) ─────────────────────────────
  // A light-studio hover bench: the shared high-quality quadcopter with live
  // thrust vectors (one per rotor, length proportional to hover throttle,
  // colour by control authority), an all-up weight vector, and a payload crate
  // that appears once mass is added. Every THREE reference is guarded, so the
  // test harness (which strips the CDN <script> tags) skips the whole 3-D path.
  const VZ = { bg: 0xeef2f7, accent: 0x12b886, thrustGood: 0x22c55e, thrustWarn: 0xf59e0b, thrustBad: 0xef4444, weight: 0xef4444, payload: 0x475569, strap: 0x64748b };
  const DRONE_SCALE = 1.4;

  function disposeObject3D(obj) {
    if (!obj || !obj.traverse) return;
    obj.traverse((n) => {
      if (n.geometry && n.geometry.dispose) n.geometry.dispose();
      if (n.material) { const m = n.material; (Array.isArray(m) ? m : [m]).forEach((x) => { if (x && x.dispose) x.dispose(); }); }
    });
  }

  // Real catalog-driven sizing for the shared VLAB_DRONE3D hero model — reads
  // the ACTUAL upstream Exp1 motor/propeller + Exp2 frame choice (the same
  // shared components inheritFromExp1()/inheritFromExp2() already use for
  // mass/thrust) instead of the model's generic 5" defaults, so the on-screen
  // craft's proportions visually match the drone the student actually designed.
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

  function buildDrone() {
    const built = VLAB_DRONE3D.build(THREE, _droneOpts());
    built.root.scale.setScalar(DRONE_SCALE);
    return built;
  }

  function initScene3D() {
    const canvas = $('benchCanvas');
    if (!canvas || typeof THREE === 'undefined' || !window.VLAB_DRONE3D) return;   // tests strip THREE -> headless-safe
    const host = canvas.parentElement || canvas;
    const w = Math.max(2, host.clientWidth || 600), h = Math.max(2, host.clientHeight || 360);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, w / h, 0.01, 100);
    camera.position.set(1.35, 0.72, 2.05);

    const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setSize(w, h, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    VLAB_DRONE3D.studio(THREE, scene, renderer, { bg: VZ.bg, groundY: -0.7, groundR: 3.4, gridSize: 6, gridDiv: 30 });

    // rig group holds the drone + force vectors + payload so they bob together
    const rig = new THREE.Group(); rig.position.y = 0.2; scene.add(rig);
    const built = buildDrone(); rig.add(built.root);

    const up = new THREE.Vector3(0, 1, 0), down = new THREE.Vector3(0, -1, 0);
    const thrust = (built.rotorCenters || []).map((c) => {
      const a = new THREE.ArrowHelper(up, new THREE.Vector3(c.x * DRONE_SCALE, c.y * DRONE_SCALE + 0.02, c.z * DRONE_SCALE), 0.3, VZ.thrustGood, 0.09, 0.06);
      rig.add(a); return a;
    });
    const weight = new THREE.ArrowHelper(down, new THREE.Vector3(0, -0.02, 0), 0.4, VZ.weight, 0.1, 0.07);
    rig.add(weight);

    // payload crate (hidden until loaded), slung under the CG by two straps
    const payload = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshStandardMaterial({ color: VZ.payload, roughness: 0.72, metalness: 0.2 }));
    payload.castShadow = true; payload.visible = false; rig.add(payload);
    const straps = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: VZ.strap }));
    straps.visible = false; rig.add(straps);

    // TWR traffic-light halo — a soft glowing ring on the ground beneath the
    // craft, colour-coded to the go/no-go verdict (PDF §6.8's "TWR traffic-
    // light indicator... on the drone 3D model"). Sits in SCENE space (not the
    // bobbing rig) so it reads as a landing-pad marker, not a floating disc.
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.34, 0.44, 48),
      new THREE.MeshBasicMaterial({ color: VZ.thrustGood, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })
    );
    halo.rotation.x = -Math.PI / 2; halo.position.y = -0.695; scene.add(halo);

    let controls = null;
    if (THREE.OrbitControls) {
      controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true; controls.dampingFactor = 0.08;
      controls.minDistance = 1.2; controls.maxDistance = 5.0;
      controls.maxPolarAngle = Math.PI * 0.56; controls.enablePan = false;
      controls.target.set(0, 0.05, 0); controls.update();
    }

    viz = { canvas: canvas, scene: scene, camera: camera, renderer: renderer, controls: controls, rig: rig, drone: built, props: built.props, thrust: thrust, weight: weight, payload: payload, straps: straps, halo: halo };
  }

  // swap the live model when the blade count changes, re-anchoring the thrust vectors
  function rebuildQuad() {
    if (!viz || !viz.rig) return;
    if (viz.drone && viz.drone.root) { viz.rig.remove(viz.drone.root); disposeObject3D(viz.drone.root); }
    const built = buildDrone(); viz.rig.add(built.root);
    viz.drone = built; viz.props = built.props;
    viz._lastLedTone = null;   // force the next updateScene3D() to re-tint the freshly rebuilt LEDs
    (viz.thrust || []).forEach((a, i) => {
      const c = (built.rotorCenters && built.rotorCenters[i]) || (built.rotorCenters && built.rotorCenters[0]);
      if (c) a.position.set(c.x * DRONE_SCALE, c.y * DRONE_SCALE + 0.02, c.z * DRONE_SCALE);
    });
  }

  // reflect the active propeller blade count on the segmented selector
  function syncBladeButtons() {
    document.querySelectorAll('.blade-btn').forEach((b) => b.classList.toggle('active', +b.dataset.blades === state.propBlades));
  }

  // ── 3-D viewport update: props spin with throttle; thrust vs weight vectors ─
  function updateScene3D(dt, d) {
    if (!viz) return;                                  // tests / no-WebGL: nothing to draw
    const D = (typeof dt === 'number' && isFinite(dt)) ? Math.min(0.05, Math.max(0, dt)) : 0.016;

    // props spin faster with more throttle; a craft that cannot hover still churns
    const tf = Calc.clamp(d.canHover ? d.hovThrottle : 1, 0.2, 1.2);
    const rate = (8 + tf * 42) * D;
    (viz.props || []).forEach((p) => { p.rotation.y += rate * (p.userData.spin || 1); });
    // Drive the motor buzz + propeller whoosh pitch/volume off the same
    // throttle fraction that sets the visual spin rate, plus a size term from
    // the selected combo's propeller diameter (bigger prop -> deeper pitch).
    if (window.SFX && window.SFX.motorRate) {
      const sizeFactor = Calc.clamp(0.145 / Math.max(0.06, (d.c && d.c.prop_diameter_m) || 0.127), 0.65, 1.3);
      window.SFX.motorRate(tf, sizeFactor);
    }

    // gentle hover bob when it can fly; sag toward the ground when it cannot
    const targetY = d.canHover ? (0.2 + Math.sin(state.anim * 2.0) * 0.02) : 0.03;
    viz.rig.position.y += (targetY - viz.rig.position.y) * (1 - Math.exp(-D * 4));

    // thrust vectors — length by throttle, colour by control authority
    const tCol = !d.canHover ? VZ.thrustBad : d.margin > 40 ? VZ.thrustGood : d.margin > 15 ? VZ.thrustWarn : VZ.thrustBad;
    const tLen = 0.16 + 0.5 * tf;
    (viz.thrust || []).forEach((a) => { a.setLength(tLen, Math.min(0.12, tLen * 0.28), Math.min(0.08, tLen * 0.2)); a.setColor(tCol); });

    // weight vector — length by all-up mass (normalised against max take-off mass)
    const wRef = Math.max(d.maxTakeoff, d.m, 1);
    const wLen = 0.18 + 0.5 * Calc.clamp(d.m / wRef, 0.1, 1);

    // payload crate appears when loaded, sized by the cube-root of the grams
    const hasPayload = state.payloadG > 0;
    viz.payload.visible = hasPayload; viz.straps.visible = hasPayload;
    if (hasPayload) {
      const s = Calc.clamp(0.12 + Math.cbrt(state.payloadG) * 0.02, 0.12, 0.5);
      viz.payload.scale.setScalar(s / 0.2);            // base BoxGeometry edge is 0.2
      const cy = -0.1 - s * 0.5;
      viz.payload.position.set(0, cy, 0);
      viz.weight.position.set(0, cy - s * 0.5, 0);     // weight acts from the crate bottom
      const half = 0.12, top = -0.05, cty = cy + s * 0.5;
      const pts = new Float32Array([-half, top, 0, 0, cty, 0, half, top, 0, 0, cty, 0]);
      viz.straps.geometry.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      viz.straps.geometry.attributes.position.needsUpdate = true;
    } else {
      viz.weight.position.set(0, -0.02, 0);
    }
    viz.weight.setLength(wLen, Math.min(0.11, wLen * 0.26), Math.min(0.08, wLen * 0.18));

    // TWR traffic-light halo + matching status LEDs — GREEN/AMBER/RED verdict,
    // pulsing when RED so a failed go/no-go is impossible to miss.
    const tone = toneFor(d);
    const haloColor = tone === 'fail' ? VZ.thrustBad : tone === 'warn' ? VZ.thrustWarn : VZ.thrustGood;
    if (viz.halo) {
      const pulse = tone === 'fail' ? (0.35 + 0.3 * Math.sin(state.anim * 6.0)) : 0.55;
      if (viz._lastHaloTone !== tone) { viz.halo.material.color.setHex(haloColor); viz._lastHaloTone = tone; }
      viz.halo.material.opacity = pulse;
    }
    if (viz.drone && viz.drone.setLed && viz._lastLedTone !== tone) { viz.drone.setLed(haloColor); viz._lastLedTone = tone; }

    // Forward-tilt scenario ('tilt30') visibly banks the whole rig; a low
    // control margin adds a small random gust jitter — both make the abstract
    // cosine-loss/authority-compression numbers physically legible.
    const targetTilt = (state.tiltDeg || 0) * Math.PI / 180;
    viz.rig.rotation.z += (targetTilt - viz.rig.rotation.z) * (1 - Math.exp(-D * 3));
    const marginFrac = Calc.clamp((d.canHover ? d.margin : 0) / 100, 0, 1);
    const gustAmp = (1 - marginFrac) * 0.05;                 // up to ~3 deg of jitter when margin -> 0
    viz.rig.rotation.x = Math.sin(state.anim * 9.0) * gustAmp * 0.5;
    viz.rig.rotation.y = Math.sin(state.anim * 5.5 + 1.7) * gustAmp;

    if (viz.controls) viz.controls.update();
    viz.renderer.render(viz.scene, viz.camera);
  }

  function drawGridBg(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(148,163,184,0.16)'; ctx.lineWidth = 1;
    for (let x = 0; x <= w; x += w / 10) line(ctx, x, 0, x, h);
    for (let yy = 0; yy <= h; yy += h / 5) line(ctx, 0, yy, w, yy);
  }

  // Analysis view: all four charts render every frame off the SAME computed
  // snapshot, so dragging the payload slider moves every curve in lockstep.
  const CHARTS = [['scopeTwr', drawTwrGauge], ['scopeHover', drawHoverCurve], ['scopePayload', drawPayloadCurve], ['scopeEfficiency', drawEfficiencyCurve]];
  function drawAllCharts(d) {
    CHARTS.forEach((pair) => {
      const cv = $(pair[0]); if (!cv) return; const ctx = cv.getContext('2d'); if (!ctx) return;
      const w = cv.width, h = cv.height;
      drawGridBg(ctx, w, h);
      pair[1](ctx, w, h, d);
    });
  }

  function scopeText(ctx, w, h, t) { ctx.fillStyle = '#cbd5e1'; ctx.font = `600 ${Math.max(10, w * 0.013)}px ${ff()}`; ctx.fillText(t, w * 0.04, h * 0.95); }

  function drawTwrGauge(ctx, w, h, d) {
    const x0 = w * 0.08, x1 = w * 0.92, yb = h * 0.5, bh = h * 0.18, tmax = 8;
    const segs = [[0, 1, '#ef4444'], [1, 1.5, '#f59e0b'], [1.5, 2, '#eab308'], [2, 3, '#84cc16'], [3, 5, '#22c55e'], [5, tmax, '#06b6d4']];
    segs.forEach((s) => {
      const a = x0 + (x1 - x0) * Math.min(s[0], tmax) / tmax, b = x0 + (x1 - x0) * Math.min(s[1], tmax) / tmax;
      ctx.fillStyle = s[2]; ctx.fillRect(a, yb - bh / 2, b - a, bh);
    });
    // marker
    const mx = x0 + (x1 - x0) * Math.min(d.TWR, tmax) / tmax;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; line(ctx, mx, yb - bh / 2 - 10, mx, yb + bh / 2 + 10);
    ctx.fillStyle = '#fff'; ctx.font = `800 ${Math.max(13, w * 0.02)}px ${ff()}`; ctx.textAlign = 'center';
    ctx.fillText('TWR ' + d.TWR.toFixed(2), mx, yb - bh / 2 - 16); ctx.textAlign = 'left';
    ctx.fillStyle = '#94a3b8'; ctx.font = `${Math.max(9, w * 0.011)}px ${ff()}`;
    [0, 1, 2, 3, 5, 8].forEach((t) => { const tx = x0 + (x1 - x0) * t / tmax; ctx.fillText(String(t), tx - 3, yb + bh / 2 + 24); });
    scopeText(ctx, w, h, `${d.band.label}  |  thrust ${(d.n * d.c.max_thrust_g)} g / weight ${d.m.toFixed(0)} g`);
  }

  function drawHoverCurve(ctx, w, h, d) {
    const x0 = w * 0.1, x1 = w * 0.92, yb = h * 0.82, yt = h * 0.1;
    const Tmax = d.c.max_thrust_g;
    ctx.strokeStyle = '#ffbf00'; ctx.lineWidth = Math.max(2, w * 0.003); ctx.beginPath();
    for (let i = 0; i <= 100; i++) { const thr = i / 100; const T = Calc.thrustAtThrottle(Tmax, thr); const x = x0 + (x1 - x0) * thr; const yv = yb - (yb - yt) * T / Tmax; if (i === 0) ctx.moveTo(x, yv); else ctx.lineTo(x, yv); }
    ctx.stroke();
    // hover thrust line + operating point
    const Th = d.hoverPerMotor; const yH = yb - (yb - yt) * Math.min(Th / Tmax, 1);
    ctx.strokeStyle = 'rgba(16,185,129,0.6)'; ctx.setLineDash([5, 4]); line(ctx, x0, yH, x1, yH); ctx.setLineDash([]);
    if (d.canHover) {
      const xh = x0 + (x1 - x0) * d.hovThrottle;
      ctx.strokeStyle = 'rgba(255,255,255,0.4)'; line(ctx, xh, yt, xh, yb);
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(xh, yH, 5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#94a3b8'; ctx.font = `${Math.max(9, w * 0.011)}px ${ff()}`;
    ctx.fillText('0%', x0, yb + 14); ctx.fillText('100%', x1 - 20, yb + 14); ctx.fillText('throttle', (x0 + x1) / 2 - 18, yb + 14);
    scopeText(ctx, w, h, `T ∝ throttle²  |  hover ${d.canHover ? d.hovPct.toFixed(1) + '%' : '>100%'}  margin ${d.margin.toFixed(0)}%`);
  }

  function drawPayloadCurve(ctx, w, h, d) {
    const x0 = w * 0.1, x1 = w * 0.92, yb = h * 0.82, yt = h * 0.1;
    const pmax = state.db.config.payload_slider_max_g || 2000, twrTop = 8;
    ctx.strokeStyle = '#ffbf00'; ctx.lineWidth = Math.max(2, w * 0.003); ctx.beginPath();
    for (let i = 0; i <= 100; i++) { const pl = pmax * i / 100; const t = Calc.twr(d.n, d.c.max_thrust_g, state.emptyG + pl); const x = x0 + (x1 - x0) * i / 100; const yv = yb - (yb - yt) * Math.min(t, twrTop) / twrTop; if (i === 0) ctx.moveTo(x, yv); else ctx.lineTo(x, yv); }
    ctx.stroke();
    // TWR_min line
    const yMin = yb - (yb - yt) * state.twrMin / twrTop;
    ctx.strokeStyle = 'rgba(239,68,68,0.7)'; ctx.setLineDash([6, 4]); line(ctx, x0, yMin, x1, yMin); ctx.setLineDash([]);
    ctx.fillStyle = '#fca5a5'; ctx.font = `${Math.max(9, w * 0.011)}px ${ff()}`; ctx.fillText('TWR min ' + state.twrMin.toFixed(1), x0 + 4, yMin - 4);
    // current payload marker
    const xp = x0 + (x1 - x0) * Math.min(state.payloadG / pmax, 1); const yc = yb - (yb - yt) * Math.min(d.TWR, twrTop) / twrTop;
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; line(ctx, xp, yt, xp, yb);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(xp, yc, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#94a3b8'; ctx.fillText('0 g', x0, yb + 14); ctx.fillText(pmax + ' g payload', x1 - 60, yb + 14);
    scopeText(ctx, w, h, `max payload @ TWR ${state.twrMin.toFixed(1)} = ${Math.max(0, d.maxPayload).toFixed(0)} g  |  now ${Math.round(state.payloadG)} g`);
  }

  function drawEfficiencyCurve(ctx, w, h, d) {
    const x0 = w * 0.1, x1 = w * 0.92, yb = h * 0.82, yt = h * 0.1;
    const mLo = state.emptyG, mHi = state.emptyG + (state.db.config.payload_slider_max_g || 2000);
    const rhoNow = rho();   // altitude is constant across this mass sweep — hoist out of the loop
    let effMax = 0; const pts = [];
    for (let i = 0; i <= 100; i++) { const m = mLo + (mHi - mLo) * i / 100; const e = Calc.efficiencyGperW(m, d.n, d.c.prop_diameter_m, d.c.fom, rhoNow); pts.push([m, e]); if (e > effMax) effMax = e; }
    effMax *= 1.1;
    ctx.strokeStyle = '#ffbf00'; ctx.lineWidth = Math.max(2, w * 0.003); ctx.beginPath();
    pts.forEach((p, i) => { const x = x0 + (x1 - x0) * (p[0] - mLo) / (mHi - mLo); const yv = yb - (yb - yt) * p[1] / effMax; if (i === 0) ctx.moveTo(x, yv); else ctx.lineTo(x, yv); });
    ctx.stroke();
    const xm = x0 + (x1 - x0) * (d.m - mLo) / (mHi - mLo); const ym = yb - (yb - yt) * d.eff / effMax;
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; line(ctx, xm, yt, xm, yb);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(xm, ym, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#94a3b8'; ctx.font = `${Math.max(9, w * 0.011)}px ${ff()}`;
    ctx.fillText(mLo.toFixed(0) + ' g', x0, yb + 14); ctx.fillText(mHi.toFixed(0) + ' g', x1 - 40, yb + 14); ctx.fillText('all-up mass', (x0 + x1) / 2 - 24, yb + 14);
    scopeText(ctx, w, h, `efficiency ${d.eff.toFixed(2)} g/W @ ${d.m.toFixed(0)} g  |  P_hover ${d.Phover.toFixed(1)} W  disk ${d.A.toFixed(3)} m²`);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', appInit); else appInit();
})();

// ═══════════════════════════════════════════════════════════════════
// Instructor / Buddy Guidance System — text guidance with an optional
// browser text-to-speech read-aloud toggle, plus a graceful-degrading
// video slot for stage-specific clips. Clips are expected under
// simulation/videos/<name>.mp4 (none exist yet — generate them later
// with the names passed to loadVideo() below; the slot HEAD-checks the
// path and stays hidden until a file is actually there, so nothing
// breaks in the meantime). Scoped to THIS experiment only — never
// references or links to another experiment's page. Structure ported
// verbatim from the verified Exp 1 implementation (see redesign/README.md §1).
// ═══════════════════════════════════════════════════════════════════
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

  // Pre-recorded natural-voice (Microsoft Edge "Emma" neural TTS) clips for
  // every FIXED guidance string in this experiment — generated offline via
  // edge-tts, not the browser's robotic speechSynthesis. Keyed by the EXACT
  // text passed to say() so lookup is a simple exact match; only messages
  // with live-interpolated numbers (which can't be pre-recorded) fall
  // through to the DYNAMIC_CLIPS template matcher below.
  const VOICE_CLIPS = {
    'GUIDE: Everything you designed so far is theory until this number. The mass budget below is your actual build — check its thrust-to-weight ratio before anything else.': 'audio/voice/m1_intro_ready.mp3',
    'GUIDE: This experiment judges your build, so it needs one to judge. Finalize the propulsion and structures experiments first — their thrust and mass feed every number here.': 'audio/voice/m1_intro_missing.mp3',
    'GUIDE: Sweep the payload and watch the hover throttle climb — not in a straight line, but curving upward, because thrust grows with the square of throttle.': 'audio/voice/m2_intro.mp3',
    'OBSERVE: Past seventy percent hover throttle now — the curve is steepening and real control authority is compressing faster than the numbers suggest.': 'audio/voice/hover_steep.mp3',
    'OBSERVE: Practical payload limit reached. Roughly forty percent of the theoretical maximum is reserved — not wasted — as the control margin that keeps this a drone and not a projectile.': 'audio/voice/practical_reached.mp3',
    'That component belongs to a different experiment\'s build — this page only judges the finished drone. Revisit the section named above to change it.': 'audio/voice/banner_onchange.mp3',
    'GUIDE: Your inherited drone at the current payload.': 'audio/voice/scenario_none.mp3',
    'CAUTION: A heavy payload drags thrust-to-weight below the safe minimum. Shed payload (or fit stronger motors) to recover.': 'audio/voice/scenario_overload.mp3',
    'CAUTION: All-up weight exceeds total thrust. Reduce payload or choose stronger propulsion to get airborne.': 'audio/voice/scenario_nolift.mp3',
    'CAUTION: Thinner air lowers both available thrust and hover efficiency — the whole envelope re-rates even though nothing about the drone itself changed. Session preview only, not saved to your build.': 'audio/voice/scenario_thin_air.mp3',
    'CAUTION: Aggressive forward flight tilts the thrust vector — only its vertical component still fights gravity, eroding the margin you had at a stationary hover.': 'audio/voice/scenario_tilt30.mp3'
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

  // say() also carries dynamic status lines that have NO voice clip (shown on
  // screen but silent by design). The ▶ Replay button must re-speak the last
  // line that was ACTUALLY spoken — so we remember `lastClipText` (the most
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

  // Re-speaks (and re-displays) the most recent guidance line on demand —
  // the same ▶ replay control every other experiment's instructor carries.
  function replayIntro() { if (lastClipText) say(lastClipText); }

  // Adds the ▶ "replay" control inside .vl-instructor-body so the bubble's
  // bounded scroll area contains it (identical to Exp 5's implementation).
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


/* ── Strict guided-build gate ────────────────────────────────────────────────
 * Exp 6 (flight performance) is the final step: it needs Exp 1's thrust AND
 * Exp 2's mass to compute TWR / hover / payload. Gate until BOTH are finalized.
 * ---------------------------------------------------------------------------*/
(function () {
  if (typeof window === 'undefined' || !window.VLABUi) return;
  function mount() {
    try { if (window.VLABUi.autoGate) window.VLABUi.autoGate('exp6'); } catch (e) { /* gate optional */ }
    try {
      if (window.VLABUi.autoBuildSummary) {
        const bs = window.VLABUi.autoBuildSummary();
        window.__vlabSummaryRefresh = bs && bs.refresh;   // Exp 6 persist() calls this on every change
      }
    } catch (e) { /* summary optional */ }
    // Cross-cutting violation banner (prop/frame fit, ESC/battery sizing, TWR
    // floor) — Exp 6 owns none of these fields itself, so a "change" click
    // just points the student at the experiment that does.
    try {
      const host = document.getElementById('vlBannerHost');
      if (host && window.VLABUi.mountBanner) {
        const b = window.VLABUi.mountBanner(host, {
          catalog: window.VLAB_CATALOG || {}, currentExp: 'exp6',
          onChange: function () {
            if (window.Instructor) window.Instructor.say('That component belongs to a different experiment\'s build — this page only judges the finished drone. Revisit the section named above to change it.');
          }
        });
        window.__vlabBannerRefresh = b && b.refresh;   // Exp 6 persist() calls this on every change
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
    var host = document.getElementById('experimentView');
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
