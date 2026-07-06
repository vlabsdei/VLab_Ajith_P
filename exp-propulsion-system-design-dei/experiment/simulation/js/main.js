/* ==========================================================================
 * Drone Technology Virtual Lab — Experiment 01 (Propulsion) — SINGLE BUNDLE
 * Coordinator rule: exactly ONE js file per experiment. The shared runtime
 * (constants, catalog, store, validation, ui, lab kit) is inlined below as a
 * fenced PRELUDE, followed by the experiment-specific code. Regenerate with
 * shared/build if the shared prelude changes — do not hand-edit the prelude.
 * ========================================================================== */

/* ===== SHARED PRELUDE 1/6: constants.js ===== */
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

/* ===== SHARED PRELUDE 2/6: catalog.js ===== */
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

/* ===== SHARED PRELUDE 3/6: vlab-store.js ===== */
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

/* ===== SHARED PRELUDE 4/6: validation.js ===== */
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

/* ===== SHARED PRELUDE 6/6: vlab-lab.js ===== */
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

/* ===== EXPERIMENT 01 — PROPULSION (was js/main.js) ===== */
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

const Calc = (function () {
  'use strict';

  const G_ACC = 9.80665; // standard gravitational acceleration m/s^2
  const N_MOTORS = 4; // quadcopter design
  const CT_COEFF = 0.10926; // legacy reference thrust coefficient (display only)
  const CQ_COEFF = 0.01065; // legacy reference torque coefficient (display only)
  const FOM_VAL = 0.655; // hovering Figure of Merit

  // --- Physical constants for the theory.md coefficient model (§2, §3) ---
  const MU_AIR = 1.81e-5; // air dynamic viscosity µ [Pa·s]
  const RHO_SL = 1.225; // sea-level air density ρ0 [kg/m^3]
  const R_ESC_PHASE = 0.0025; // per-phase ESC MOSFET resistance [Ω] (2–3 mΩ)
  // Defaults used when a caller has no battery/propeller context (e.g. a bare
  // operating-point probe). They keep the solver well-posed without changing
  // any context-aware call site.
  const DEFAULT_PD = 0.9; // pitch-to-diameter ratio
  const DEFAULT_CELLS = 4; // battery cell count S
  const DEFAULT_CAP_MAH = 1500; // battery capacity C_mah

  // Density altitude formula based on temperature lapse rate
  function get_air_density(h) {
    return 1.22500 * Math.pow(1.0 - 2.25577e-5 * h, 4.25588);
  }

  function get_disk_area(D) {
    return Math.PI * 0.25 * D * D;
  }

  function get_hover_thrust_req(m_kg) {
    return (m_kg * G_ACC) / N_MOTORS;
  }

  // ---------------------------------------------------------------------------
  // Centralized physics helpers (single source of truth, per theory.md). The
  // flight sim, static slider, and efficiency sweep all consume these so the
  // physics cannot drift apart again.
  // ---------------------------------------------------------------------------

  // theory.md §5 — per-cell LiPo open-circuit voltage as a function of SoC.
  function ocv_per_cell(soc) {
    return 3.5 + 0.7 * soc + 0.1 * soc * soc * soc;
  }

  // theory.md §3 — battery internal resistance scales with cell count S and
  // capacity C_mah (nominal, full-charge baseline — used where SoC is not
  // being tracked, e.g. the static circuit worked example).
  function battery_internal_r(cells, capacity_mah) {
    return cells * 0.012 * (1500.0 / capacity_mah);
  }

  // theory.md §5 — near-depletion cell resistance growth. As SoC drops below
  // ~30%, slowed LiPo chemical reaction rates swell the effective internal
  // resistance; this is what makes the terminal voltage sag accelerate hard
  // right before a pack dies, on top of the OCV(SoC) droop from ocv_per_cell.
  function battery_internal_r_soc(cells, capacity_mah, soc) {
    const soc_c = Math.max(0.0, Math.min(1.0, (typeof soc === 'number') ? soc : 1.0));
    const r_nominal_cell = 0.012 * (1500.0 / capacity_mah);
    const r_eff_cell = r_nominal_cell * (1.0 + 0.25 * Math.exp(5.0 * (0.3 - soc_c)));
    return cells * r_eff_cell;
  }

  // theory.md §3 — motor winding resistance with temperature dependence
  // Rw(T) = Rw0 * (1 + 0.00393 * (T - 20)).
  function motor_resistance_temp(rm0_ohm, tempC) {
    return rm0_ohm * (1.0 + 0.00393 * (tempC - 20.0));
  }

  // theory.md §3 — total effective circuit resistance
  // R_m_eff = R_motor(T) + R_esc + 4 * R_batt.
  // R_batt uses the SoC-aware near-depletion swell (theory.md §5) whenever the
  // caller tracks a live SoC (opts.soc); otherwise it falls back to the flat
  // nominal figure (static/nominal-voltage callers that don't track SoC).
  // `opts.includeBatteryR` (default true) lets a caller that has already
  // sagged its applied voltage externally by the pack's own IR drop (e.g. to
  // display a real "terminal voltage" in a circuit diagram) opt OUT of the
  // battery term here — otherwise the drop gets subtracted twice: once from
  // the pre-sagged V, once again from this resistance.
  function effective_resistance(opts) {
    opts = opts || {};
    const rm0 = opts.rm0_ohm;
    const tempC = (opts.tempC !== undefined) ? opts.tempC : 25.0;
    const R_esc = (opts.R_esc !== undefined) ? opts.R_esc : R_ESC_PHASE;
    let R_batt4 = 0.0;
    if (opts.includeBatteryR !== false) {
      const cells = (opts.cells !== undefined) ? opts.cells : DEFAULT_CELLS;
      const cap = (opts.capacity_mah !== undefined) ? opts.capacity_mah : DEFAULT_CAP_MAH;
      const R_batt = (opts.soc !== undefined) ? battery_internal_r_soc(cells, cap, opts.soc) : battery_internal_r(cells, cap);
      R_batt4 = 4.0 * R_batt;
    }
    return motor_resistance_temp(rm0, tempC) + R_esc + R_batt4;
  }

  // Representative mean blade chord [m] (≈10% of diameter) used when a caller
  // does not supply a measured chord.
  function prop_mean_chord(D) {
    return 0.1 * D;
  }

  // Derive the pitch-to-diameter ratio of a propeller selection. Prefers an
  // explicit field; otherwise parses the trailing pitch digits of the prop id
  // (e.g. "5045" → 5.0" × 4.5" → P/D = 0.9).
  function prop_pd(prop) {
    if (!prop) return DEFAULT_PD;
    if (typeof prop.pitch_diameter_ratio === 'number') return prop.pitch_diameter_ratio;
    if (typeof prop.pitch_in === 'number' && prop.diameter_in) {
      return prop.pitch_in / prop.diameter_in;
    }
    if (prop.id && prop.diameter_in) {
      const code = parseInt(String(prop.id), 10);
      if (!isNaN(code)) {
        const pitch_in = (code % 100) / 10.0;
        if (pitch_in > 0) return pitch_in / prop.diameter_in;
      }
    }
    return DEFAULT_PD;
  }

  // theory.md §2 — static + low-Reynolds + induced-inflow coefficient model.
  function prop_coefficients(opts) {
    const pd = opts.pitch_diameter_ratio;
    const n = opts.n_rps;
    const D = opts.D;
    const rho = (opts.rho !== undefined) ? opts.rho : RHO_SL;
    const c_mean = (opts.c_mean !== undefined) ? opts.c_mean : prop_mean_chord(D);
    const mu = (opts.mu !== undefined) ? opts.mu : MU_AIR;

    const Ct_static = 0.115 * pd;
    const v_tip = Math.PI * n * D;
    const Re = (rho * v_tip * c_mean) / mu;
    const Re_factor = Math.pow(150000.0 / Re, 0.25);
    const Cq_static = Ct_static * (0.045 * Re_factor + 0.11 * pd);
    const J_i = Math.sqrt((2.0 * Ct_static) / Math.PI);
    const Ct_eff = Ct_static * (1.0 - J_i);
    const Cq_eff = Cq_static * (1.0 + 1.5 * J_i * J_i);

    return {
      ct: Ct_eff,
      cq: Cq_eff,
      Ct_static: Ct_static,
      Cq_static: Cq_static,
      Re: Re,
      Re_factor: Re_factor,
      J_i: J_i
    };
  }

  function get_aero_thrust(n_rps, D, rho, pd, c_mean) {
    if (n_rps <= 0) return 0.0;
    const ct = prop_coefficients({
      pitch_diameter_ratio: (pd !== undefined) ? pd : DEFAULT_PD,
      n_rps: n_rps,
      D: D,
      rho: rho,
      c_mean: (c_mean !== undefined) ? c_mean : prop_mean_chord(D),
      mu: MU_AIR
    }).ct;
    return ct * rho * n_rps * n_rps * Math.pow(D, 4);
  }

  function get_prop_torque(n_rps, D, rho, pd, c_mean) {
    if (n_rps <= 0) return 0.0;
    const cq = prop_coefficients({
      pitch_diameter_ratio: (pd !== undefined) ? pd : DEFAULT_PD,
      n_rps: n_rps,
      D: D,
      rho: rho,
      c_mean: (c_mean !== undefined) ? c_mean : prop_mean_chord(D),
      mu: MU_AIR
    }).cq;
    return cq * rho * n_rps * n_rps * Math.pow(D, 5);
  }

  function get_req_rps(t_target, D, rho, pd, c_mean) {
    // Ct_eff is independent of speed, so any positive probe speed yields it.
    const ct = prop_coefficients({
      pitch_diameter_ratio: (pd !== undefined) ? pd : DEFAULT_PD,
      n_rps: 1.0,
      D: D,
      rho: rho,
      c_mean: (c_mean !== undefined) ? c_mean : prop_mean_chord(D),
      mu: MU_AIR
    }).ct;
    return Math.sqrt(t_target / (ct * rho * Math.pow(D, 4)));
  }

  // Solves the steady-state operating point of the actuator circuit.
  // Optional ctx = { cells, capacity_mah, R_esc, pd, c_mean } supplies the
  // battery/ESC/propeller context for the effective resistance and the
  // theory.md coefficient model; sensible defaults apply when omitted.
  function calc_motor_point(motor, V, D, rho, tMotor, ctx) {
    const kv = motor.kv;
    const temp = (tMotor !== undefined) ? tMotor : 25.0;
    ctx = ctx || {};
    const pd = (ctx.pd !== undefined) ? ctx.pd : DEFAULT_PD;
    const c_mean = (ctx.c_mean !== undefined) ? ctx.c_mean : prop_mean_chord(D);

    // Total effective circuit resistance (theory.md §3): motor winding (temp
    // dependent) + ESC + 4 * battery internal resistance.
    const rm = effective_resistance({
      rm0_ohm: motor.rm_ohm,
      tempC: temp,
      R_esc: (ctx.R_esc !== undefined) ? ctx.R_esc : R_ESC_PHASE,
      cells: ctx.cells,
      capacity_mah: ctx.capacity_mah,
      soc: ctx.soc,
      includeBatteryR: ctx.includeBatteryR
    });
    const i0 = motor.i0_a;

    const ke = 30.0 / (kv * Math.PI); // back-EMF constant
    const d5 = Math.pow(D, 5);

    // The torque coefficient depends weakly on speed (via Reynolds number), so
    // we evaluate it at an estimated operating speed and refine. Solve the
    // quadratic a * w^2 + b * w + c = 0 each pass.
    let w = V / ke; // no-load upper bound as the initial estimate
    const b = ke;
    const c = i0 * rm - V;
    for (let it = 0; it < 3; it++) {
      const n_est = Math.max(w / (2.0 * Math.PI), 1e-3);
      const cq = prop_coefficients({
        pitch_diameter_ratio: pd,
        n_rps: n_est,
        D: D,
        rho: rho,
        c_mean: c_mean,
        mu: MU_AIR
      }).cq;
      const a = (cq * rho * d5 * rm) / (4.0 * Math.PI * Math.PI * ke);
      const disc = b * b - 4.0 * a * c;
      if (disc < 0) return null; // Stall condition
      w = (-b + Math.sqrt(disc)) / (2.0 * a);
    }

    const rpm = w * 30.0 / Math.PI;
    const i_mech = (V - ke * w) / rm;
    const i_total = Math.max(0, i_mech);

    const n = w / (2.0 * Math.PI);
    const t_val = get_aero_thrust(n, D, rho, pd, c_mean);
    const q_val = get_prop_torque(n, D, rho, pd, c_mean);
    const p_mech = q_val * w;
    const p_elec = V * i_total;

    const eff = p_elec > 0 ? (p_mech / p_elec) * 100.0 : 0.0;

    return {
      omega: w,
      rpm: Math.max(0, rpm),
      curr: i_total,
      thrust: Math.max(0, t_val),
      torque: Math.max(0, q_val),
      p_mech: Math.max(0, p_mech),
      p_elec: Math.max(0, p_elec),
      eff: Math.max(0, Math.min(100, eff)),
      v_drop: i_total * rm
    };
  }


  function get_thrust_sweep(rpm, rho, diameters) {
    const n = rpm / 60.0;
    return diameters.map(function (d) {
      return {
        diameter_m: d,
        diameter_in: d / 0.0254,
        thrust_n: get_aero_thrust(n, d, rho)
      };
    });
  }

  function get_mass_budget(sel) {
    const rows = [];
    let tot = 0.0;

    function add(label, qty, unit_g) {
      const r_tot = qty * unit_g;
      rows.push({ label: label, quantity: qty, unit_g: unit_g, total_g: r_tot });
      tot += r_tot;
    }

    if (sel.frame) add('Frame / Chassis', 1, sel.frame.mass_g);
    if (sel.motor) add('Motor (×4)', N_MOTORS, sel.motor.mass_g);
    if (sel.propeller) add('Propeller (×4)', N_MOTORS, sel.propeller.mass_g_each);
    if (sel.battery) add('Battery Pack', 1, sel.battery.mass_g);
    if (sel.esc) add('ESC System', sel.esc.quantity, sel.esc.mass_g_each);
    if (sel.flight_controller) add('Flight Controller', 1, sel.flight_controller.mass_g);
    if (sel.receiver) add('Receiver', 1, sel.receiver.mass_g);
    if (sel.payloads && sel.payloads.length > 0) {
      sel.payloads.forEach(function (p) {
        add('Payload: ' + p.label, 1, p.mass_g);
      });
    }

    return {
      total_g: +tot.toFixed(1),
      total_kg: +(tot / 1000.0).toFixed(4),
      breakdown: rows
    };
  }

  function est_hover_time(battery, motor, T_motor, propeller, rho, esc) {
    const V = battery.voltage_nominal_v;
    const mah = battery.capacity_mah;
    const D = propeller.diameter_m;

    // Use the SELECTED battery's context (cells + capacity) for the internal
    // resistance so the loaded operating point reflects the actual pack, not
    // the 4S/1500 default. (spec §2.3 bug-fix)
    // Also use the SELECTED propeller's real pitch/diameter ratio (not
    // DEFAULT_PD) so the flight-time estimate matches the prop actually built.
    const ctx = {
      cells: battery.cells,
      capacity_mah: battery.capacity_mah,
      R_esc: (esc && typeof esc.rds_on_ohm === 'number') ? esc.rds_on_ohm : undefined,
      pd: prop_pd(propeller)
    };

    const u = solve_hover_throttle(motor, V, D, rho, T_motor, 25.0, ctx);
    const op = calc_motor_point(motor, u * V, D, rho, 25.0, ctx);

    let p_each = 0, i_each = 0;

    if (op) {
      p_each = op.p_elec;
      i_each = p_each / V;
    } else {
      const area = get_disk_area(D);
      const vi = Math.sqrt(Math.max(T_motor, 0.001) / (2.0 * rho * area));
      p_each = (T_motor * vi) / FOM_VAL;
      i_each = p_each / V;
    }

    const i_tot = i_each * N_MOTORS;
    const p_tot = p_each * N_MOTORS;

    const e_usable = (mah / 1000.0) * V * 0.80; // 20% safety reserve remaining
    const t_sec = (e_usable / Math.max(p_tot, 0.001)) * 3600.0;

    return {
      flight_time_s: +t_sec.toFixed(1),
      current_each_a: +i_each.toFixed(2),
      current_total_a: +i_tot.toFixed(2),
      power_total_w: +p_tot.toFixed(1),
      usable_capacity_wh: +e_usable.toFixed(3)
    };
  }

  function get_prop_margin(T_req, T_max) {
    const ratio = T_max / Math.max(T_req, 1e-9);
    const pct = (ratio - 1.0) * 100.0;
    let rating;
    if (ratio >= 2.0) rating = 'EXCELLENT';
    else if (ratio >= 1.5) rating = 'GOOD';
    else if (ratio >= 1.3) rating = 'MARGINAL';
    else rating = 'FAIL';

    return {
      margin_ratio: +ratio.toFixed(3),
      margin_pct: +pct.toFixed(1),
      pass: ratio >= 1.30,
      rating: rating
    };
  }

  // ── Motor thermal model (Newton's-law-of-cooling, forced convection) ──────
  // Single source of truth for all three call sites (flight sim, bench stand,
  // module-2 efficiency sweep) that previously duplicated a hardcoded
  // A_motor=0.006 m^2 for EVERY motor regardless of physical size — a 19g 1806
  // and a 210g 5010 were assigned identical cooling surface, so the model's
  // equilibrium temperature for larger/higher-power motors ran into the
  // hundreds-to-thousands of degrees even at normal hover throttle. Surface
  // area is now derived from the catalog's real bell_diameter_mm/bell_height_mm
  // (cylinder side + two end caps). h0/k_forced are calibrated so a
  // catalog-recommended motor+prop pairing settles 50-135 C at hover (safe,
  // matches typical small-BLDC thermal-camera data with propwash) while a
  // genuinely mismatched/overloaded pairing still legitimately overheats.
  const MOTOR_SPECIFIC_HEAT_J_PER_KGK = 385.0; // copper-dominated thermal mass
  const H_STILL_W_M2K = 25.0;      // natural convection + radiation baseline
  const H_FORCED_W_M2K_PER_MS = 22.0; // forced-convection gain per m/s propwash
  const DEFAULT_MOTOR_BELL_D_MM = 25.0, DEFAULT_MOTOR_BELL_H_MM = 20.0;

  function motor_convective_area_m2(motor) {
    const D = ((motor && motor.bell_diameter_mm) || DEFAULT_MOTOR_BELL_D_MM) / 1000.0;
    const H = ((motor && motor.bell_height_mm) || DEFAULT_MOTOR_BELL_H_MM) / 1000.0;
    return Math.PI * D * H + 2.0 * Math.PI * (D / 2.0) * (D / 2.0); // side + 2 end caps
  }

  function induced_velocity_ms(thrust_n, rho, diameter_m) {
    const area = Math.PI * 0.25 * diameter_m * diameter_m;
    return Math.sqrt(Math.max(0.1, thrust_n) / (2.0 * rho * Math.max(1e-6, area)));
  }

  // Motor convective cooling coefficient h*A (W/K) at the current thrust/airflow.
  function motor_cooling_w_per_k(motor, thrust_n, rho, diameter_m) {
    const v = induced_velocity_ms(thrust_n, rho, diameter_m);
    const h = H_STILL_W_M2K + H_FORCED_W_M2K_PER_MS * v;
    return h * motor_convective_area_m2(motor);
  }

  // One Euler thermal step for the motor winding/case temperature. Returns the
  // new temperature (deg C), clamped to [25, 250].
  function motor_thermal_step(tMotorC, p_loss_w, motor, thrust_n, rho, diameter_m, dt_s) {
    const m_motor_kg = ((motor && motor.mass_g) ? motor.mass_g : 50.0) / 1000.0;
    const coolWperK = motor_cooling_w_per_k(motor, thrust_n, rho, diameter_m);
    const qOut = coolWperK * (tMotorC - 25.0);
    const dT = (p_loss_w - qOut) / (m_motor_kg * MOTOR_SPECIFIC_HEAT_J_PER_KGK);
    return Math.min(250.0, Math.max(25.0, tMotorC + dT * dt_s));
  }

  function solve_hover_throttle(motor, V_batt, D, rho, T_req, tMotor, ctx) {
    let low = 0.0, high = 1.0, throttle = 0.5;
    for (let i = 0; i < 12; i++) {
      throttle = (low + high) / 2.0;
      const op = calc_motor_point(motor, throttle * V_batt, D, rho, tMotor, ctx);
      if (!op || op.thrust < T_req) {
        low = throttle;
      } else {
        high = throttle;
      }
    }
    return Math.min(Math.max(throttle, 0.0), 1.0);
  }

  // Real-world "as-manufactured" part draw. Perturbs nominal catalog specs by their
  // seeded tolerance (constants.js §TOL) so a build behaves like real hardware rather
  // than textbook-round numbers. Deterministic per part id (reproducible across
  // reloads), idempotent, and a safe no-op if the shared constants are unavailable.
  function manufacture_db(db) {
    const C = (typeof window !== 'undefined') ? window.VLAB_CONST : null;
    if (!db || db.__manufactured || !C || typeof C.applyTol !== 'function') return db;
    const T = C.TOL || {};
    (db.motors || []).forEach(function (m) {
      if (typeof m.kv === 'number')     m.kv     = +C.applyTol(m.kv,     T.motor_kv || 0.08, m.id + ':kv').toFixed(1);
      if (typeof m.rm_ohm === 'number') m.rm_ohm = +C.applyTol(m.rm_ohm, T.motor_rm || 0.10, m.id + ':rm').toFixed(4);
      if (typeof m.i0_a === 'number')   m.i0_a   = +C.applyTol(m.i0_a,   T.motor_i0 || 0.15, m.id + ':i0').toFixed(3);
    });
    (db.propellers || []).forEach(function (p) {
      if (typeof p.mass_g_each === 'number') p.mass_g_each = +C.applyTol(p.mass_g_each, T.prop_mass || 0.05, p.id + ':mass').toFixed(2);
      if (typeof p.pitch_in === 'number')    p.pitch_in    = +(p.pitch_in + (T.prop_pitch_in || 0.30) * C.partDeviate(p.id + ':pitch')).toFixed(2);
    });
    (db.batteries || []).forEach(function (b) {
      if (typeof b.capacity_mah === 'number') b.capacity_mah = Math.round(C.applyTol(b.capacity_mah, T.batt_capacity || 0.05, b.id + ':cap'));
      if (typeof b.cell_ir_mohm === 'number') b.cell_ir_mohm = +C.applyTol(b.cell_ir_mohm, T.batt_ir || 0.20, b.id + ':ir').toFixed(2);
    });
    (db.escs || []).forEach(function (e) {
      if (typeof e.rds_on_ohm === 'number') e.rds_on_ohm = +C.applyTol(e.rds_on_ohm, T.esc_rdson || 0.10, e.id + ':rdson').toFixed(5);
    });
    db.__manufactured = true;
    return db;
  }

  // Single source of truth for catalog data: the bundled VLAB_CATALOG (identical
  // data to shared/catalog.json, inlined at the top of this file). db/db.json is
  // kept only as an offline fallback if the global is unavailable for some reason
  // — it must never be treated as a second, independently-maintained catalog (it
  // had drifted out of sync with VLAB_CATALOG: stale recommended_prop_in typing,
  // missing arm_profile/frontal_area_m2/pitch fields).
  function load_catalog_async() {
    if (typeof window !== 'undefined' && window.VLAB_CATALOG) {
      return Promise.resolve(JSON.parse(JSON.stringify(window.VLAB_CATALOG)));
    }
    return fetch('db/db.json').then(function (res) {
      if (!res.ok) throw new Error('DB load error: ' + res.status);
      return res.json();
    });
  }

  // ── ESC thermal model — same real-part-data principle as the motor model ──
  // Previously every ESC (20A to 60A, rds_on 0.0016-0.0035 ohm) was modeled with
  // a single hardcoded R=0.004 ohm and a fixed cooling constant, so the chosen
  // ESC never actually affected its own temperature. Now driven by the selected
  // part's real catalog rds_on_ohm (I^2R loss) and r_th_c_per_w (thermal
  // resistance -> cooling coefficient = 1/r_th), with the same overcurrent
  // penalty behaviour as before.
  const ESC_SPECIFIC_HEAT_J_PER_KGK = 800.0; // PCB + copper + silicon composite
  const ESC_R_DSON_DEFAULT_OHM = 0.0025;
  const ESC_RTH_DEFAULT_C_PER_W = 15.0;

  function esc_power_loss_w(current_a, esc, esc_limit_a) {
    const r = (esc && typeof esc.rds_on_ohm === 'number') ? esc.rds_on_ohm : ESC_R_DSON_DEFAULT_OHM;
    let p = current_a * current_a * r;
    const limit = esc_limit_a || (esc && esc.current_a) || 30.0;
    if (current_a > limit) {
      const over_ratio = current_a / limit;
      p *= (over_ratio * over_ratio);
    }
    return p;
  }

  function esc_cooling_w_per_k(esc) {
    const rth = (esc && typeof esc.r_th_c_per_w === 'number') ? esc.r_th_c_per_w : ESC_RTH_DEFAULT_C_PER_W;
    return 1.0 / Math.max(0.1, rth);
  }

  // One Euler thermal step for the ESC temperature (deg C, clamped [25,180]).
  function esc_thermal_step(tEscC, current_a, esc, dt_s, esc_limit_a) {
    const p_loss = esc_power_loss_w(current_a, esc, esc_limit_a);
    const coolWperK = esc_cooling_w_per_k(esc);
    const massKg = ((esc && esc.mass_g_each) ? esc.mass_g_each : 10.0) / 1000.0;
    const qOut = coolWperK * (tEscC - 25.0);
    const dT = (p_loss - qOut) / (massKg * ESC_SPECIFIC_HEAT_J_PER_KGK);
    return Math.min(180.0, Math.max(25.0, tEscC + dT * dt_s));
  }

  return {
    g: G_ACC,
    N_MOTORS: N_MOTORS,
    Ct: CT_COEFF,
    Cq: CQ_COEFF,
    FOM: FOM_VAL,
    airDensity: get_air_density,
    diskArea: get_disk_area,
    requiredHoverThrust: get_hover_thrust_req,
    aerodynamicThrust: get_aero_thrust,
    propellerTorque: get_prop_torque,
    requiredRPS: get_req_rps,
    solveOperatingPoint: calc_motor_point,
    thrustSweep: get_thrust_sweep,
    massBudget: get_mass_budget,
    hoverFlightTime: est_hover_time,
    propulsionMargin: get_prop_margin,
    solveHoverThrottle: solve_hover_throttle,
    // Centralized theory.md physics helpers (single source of truth).
    ocvPerCell: ocv_per_cell,
    batteryInternalR: battery_internal_r,
    batteryInternalRSoc: battery_internal_r_soc,
    motorResistanceTemp: motor_resistance_temp,
    effectiveResistance: effective_resistance,
    propCoefficients: prop_coefficients,
    pitchDiameterRatio: prop_pd,
    meanChord: prop_mean_chord,
    manufactureDb: manufacture_db,
    loadCatalog: load_catalog_async,
    motorConvectiveArea: motor_convective_area_m2,
    motorCoolingWperK: motor_cooling_w_per_k,
    motorThermalStep: motor_thermal_step,
    escPowerLossW: esc_power_loss_w,
    escCoolingWperK: esc_cooling_w_per_k,
    escThermalStep: esc_thermal_step
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
  // are pre-recorded offline via voice_gen/gen_propulsion.py and the voice now
  // speaks ONLY at three moments —
  //   1. tab/page intro  (what this module is + what to do here) — first entry
  //   2. a fault / failure                                       — error/warn
  //   3. a task completion                                       — success
  // Everything else (component prompts, dynamic thrust/current banners,
  // selection-blocked notices) is on-screen text only via show(); there is no
  // robotic speechSynthesis fallback. Sound effects (SFX above) cover the
  // interaction feedback.
  const CLIPS = {
    intro_assembly: 'audio/voice/intro_assembly.mp3',
    intro_bench: 'audio/voice/intro_bench.mp3',
    intro_hover: 'audio/voice/intro_hover.mp3',
    intro_kv: 'audio/voice/intro_kv_profiling.mp3',
    fault_critical: 'audio/voice/fault_critical.mp3',
    fault_motor_stall: 'audio/voice/fault_motor_stall.mp3',
    fault_thrust_deficit: 'audio/voice/fault_thrust_deficit.mp3',
    fault_esc_burnt: 'audio/voice/fault_esc_burnt.mp3',
    fault_overcurrent: 'audio/voice/fault_overcurrent.mp3',
    fault_actuator_stall: 'audio/voice/fault_actuator_stall.mp3',
    fault_winding_overheat: 'audio/voice/fault_winding_overheat.mp3',
    done_landed_safely: 'audio/voice/done_landed_safely.mp3',
    done_hover_reached: 'audio/voice/done_hover_reached.mp3',
    done_profiling_complete: 'audio/voice/done_profiling_complete.mp3'
  };

  // Fault / completion banners are set through show()/updateLiveCommentary with
  // distinctive leading text, so we match that text to the right clip + paired
  // SFX kind. Anything not matched here stays silent (text only). First match
  // wins; tags are stripped before matching.
  const EVENT_CLIPS = [
    [/^CRITICAL FAILURE/i, 'fault_critical', 'error'],
    [/^MOTOR STALL/i, 'fault_motor_stall', 'error'],
    [/^THRUST DEFICIT/i, 'fault_thrust_deficit', 'error'],
    [/^ESC BURNT OUT/i, 'fault_esc_burnt', 'error'],
    [/^OVERCURRENT/i, 'fault_overcurrent', 'error'],
    [/ACTUATOR STALL/i, 'fault_actuator_stall', 'error'],
    [/Winding temperature has exceeded/i, 'fault_winding_overheat', 'warn'],
    [/^Landed Safely/i, 'done_landed_safely', 'success'],
    [/Target hover RPM reached/i, 'done_hover_reached', 'success'],
    [/Actuator profiling complete/i, 'done_profiling_complete', 'success']
  ];

  const synth = (typeof window !== 'undefined' && window.speechSynthesis) ? window.speechSynthesis : null;
  // On by default. The pre-recorded mp3 clips are the primary voice and work in
  // every browser (plain <audio>), independent of speechSynthesis — so guidance
  // is enabled even where speechSynthesis is missing; that engine is only the
  // fallback reader for the dynamic, number-interpolated messages.
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

  // Fallback for text with no pre-recorded clip (dynamic, number-interpolated
  // messages). Speaks one sentence at a time (chained utterances) rather than
  // one long run-on string — short natural pauses between sentences read far
  // less robotic than a single monotone utterance covering a whole paragraph.
  function speak(text) {
    if (!synth) return;
    const myToken = speakQueueToken;
    const clean = String(text).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    const sentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
    const voice = pickVoice();
    let i = 0;
    setSpeakingIndicator(true);
    function speakNext() {
      if (myToken !== speakQueueToken || i >= sentences.length) { setSpeakingIndicator(false); return; }
      const u = new SpeechSynthesisUtterance(sentences[i]);
      if (voice) u.voice = voice;
      u.rate = 0.98;
      u.pitch = 1.04;
      u.volume = narratorVol;
      u.onend = function () { i++; speakNext(); };
      u.onerror = function () { i++; speakNext(); };
      synth.speak(u);
    }
    speakNext();
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
  // path for all live status / selection / dynamic guidance.
  function show(text) {
    const el = document.getElementById('liveCommentaryText');
    if (el) el.innerHTML = text;
    const dot = document.getElementById('vlInstructorDot');
    const bubble = document.getElementById('vlInstructorBubble');
    if (dot) dot.hidden = !(bubble && bubble.hidden); // only badge when collapsed
  }

  // Shows `text` and, if it is a recognized fault/completion banner, plays the
  // matching Emma clip + paired sound effect. Non-event text is silent and
  // never interrupts a playing intro. The flight-sim tick re-sends the same
  // banner (often with a live number) every frame, so we dedupe on the matched
  // EVENT id — a clip fires ONCE when the condition first appears, not every
  // frame, even though the interpolated number keeps changing.
  let _lastEventId = null;
  function say(text) {
    show(text);
    if (!ttsEnabled) return;
    const ev = resolveEvent(text);
    if (!ev) { _lastEventId = null; return; } // non-event → silent; allow same event to replay later
    if (ev.id === _lastEventId) return;       // same ongoing condition → don't re-trigger
    _lastEventId = ev.id;
    stopAll();                                // a real fault/completion interrupts whatever is speaking
    if (ev.kind === 'error') SFX.error();
    else if (ev.kind === 'warn') SFX.warn();
    else if (ev.kind === 'success') SFX.success();
    // a terminal event (crash/landing/completion) ends the run — kill the whir
    if (ev.kind === 'error' || ev.kind === 'success') SFX.motor(false);
    playClip(ev.clip);
  }

  // Tab/page intro voice. Plays the "what is this module + what to do" clip the
  // FIRST time a tab is entered this session; revisits are silent but still set
  // it as the current intro so the ▶ replay button can re-play it on demand.
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
  // clips) and to the speechSynthesis fallback's per-utterance volume.
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
  // (created here so no HTML edit is needed, and it appears identically on
  // every page). Re-plays the current tab/page intro clip on click.
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

// Progressive, state-aware assembly guidance — top-level (not nested in the
// UI or Module-1-Orchestrator IIFEs) so both the tile-selection handler and
// the tab-switch handler can call it. Walks the student through picking a
// coherent, physically-compatible build one field at a time; once every
// field is filled it points them at the live compatibility banner instead
// of repeating a generic "all done" message every time.
function assemblyTip() {
  const sel = (window.VLAB && window.VLAB.state) ? window.VLAB.state.selections : {};
  if (!sel || !sel.frame) return 'GUIDE: Start by picking a frame size — it sets your propeller clearance and overall weight class.';
  if (!sel.motor) return 'GUIDE: Now pick a motor. Higher KV motors spin faster (better for small/light props); lower KV motors produce more torque for larger props.';
  if (!sel.propeller) return 'GUIDE: Choose a propeller sized for your frame — a prop too large for the frame will visibly overlap and can\'t be locked.';
  if (!sel.battery) return 'GUIDE: Pick a battery. More cells (S) means higher voltage and more RPM headroom; more capacity (mAh) means longer flight time but more pack weight.';
  if (!sel.esc) return 'GUIDE: Pick an ESC rated above your motor\'s expected current draw — an undersized ESC will overheat under load.';
  if (!sel.flight_controller || !sel.receiver) return 'GUIDE: Add a flight controller and receiver to complete the avionics stack.';
  return 'GUIDE: All components selected. Check the compatibility banner below the checklist for any warnings before locking your assembly.';
}

// Spoken the moment the student switches to the Bench Test tab — sets up
// what this module simulates and what to do first, same role as
// assemblyTip() but for the aerodynamic bench.
function benchTestTip() {
  return 'GUIDE: This bench spins your locked motor and propeller up through the full throttle range, measuring static thrust, current draw and winding temperature. Slide the throttle up and watch for stall, overcurrent or overheat warnings.';
}

// Spoken the moment the student switches to the Hover Flight tab.
function hoverFlightTip() {
  return 'GUIDE: This is the full hovering flight simulation — rigid-body dynamics with your locked build. Choose Manual or Auto-Hover mode, then start the simulation to see if your thrust-to-weight ratio can actually keep the vehicle airborne.';
}

const Scene = (function () {
  'use strict';

  let _rndr, _scn, _cam, _ctrls, _clk;
  let _frameId = null;
  let _tabIdx = 1;
  let _handleResizeFn = null;

  function init() {
    const canvas = document.getElementById('droneCanvas');
    const wrap = document.getElementById('canvasWrapper');

    const base = initBase3DScene(canvas, wrap, {
      bgColor: 0xf3f4f6,
      fov: 45,
      camPos: { x: 0.25, y: 0.18, z: 0.35 },
      enableShadows: true,
      ctrls: { minDist: 0.12, maxDist: 5.0, maxPolar: Math.PI * 0.88, target: { x: 0, y: 0.10, z: 0 } },
      ambientIntensity: 0.60,
      sunIntensity: 1.0,
      sunPos: { x: 1.5, y: 3.0, z: 1.5 }
    });
    _scn = base.scn;
    _rndr = base.rndr;
    _cam = base.cam;
    _ctrls = base.ctrls;
    _handleResizeFn = base.handleResize;

    // Subtle rim light to make geometry pop
    const rimLight = new THREE.DirectionalLight(0xdbeafe, 0.45);
    rimLight.position.set(-1.5, 1.0, -1.5);
    _scn.add(rimLight);

    const hemi = new THREE.HemisphereLight(0xdbeafe, 0xe5e7eb, 0.3);
    _scn.add(hemi);

    const groundGeo = new THREE.PlaneGeometry(10, 10);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0xe5e7eb,
      roughness: 0.9,
      metalness: 0.0
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.001;
    ground.receiveShadow = true;
    _scn.add(ground);

    const grid = new THREE.GridHelper(8, 40, 0xcbd5e1, 0xe5e7eb);
    grid.position.y = 0;
    _scn.add(grid);

    _clk = new THREE.Clock();

    doResize();
    startLoop();
  }

  function startLoop() {
    if (_frameId) return;
    function loop() {
      _frameId = requestAnimationFrame(loop);
      const dt = _clk.getDelta();
      
      _ctrls.update();

      if (window.DroneModel) {
        window.DroneModel.animateProps(dt);
      }

      if (window.VLAB && window.VLAB.tickStand && _tabIdx === 2) {
        window.VLAB.tickStand(dt);
      }

      if (window.FlightSim && window.FlightSim.isRunning()) {
        window.FlightSim.tick(dt);
      }

      _rndr.render(_scn, _cam);
    }
    loop();
  }

  function doResize() {
    if (_handleResizeFn) _handleResizeFn();
  }

  function setTabIdx(n) {
    _tabIdx = n;
    _ctrls.enabled = true;

    if (n === 2) {
      _cam.position.set(0.30, 0.20, 0.40);
      _ctrls.target.set(-0.04, 0.08, 0);
    } else {
      _cam.position.set(0.70, 0.45, 0.90);
      _ctrls.target.set(0, 0.10, 0);
    }
    _ctrls.update();

    if (window.DroneModel && window.VLAB && window.VLAB.state) {
      window.DroneModel.updateFromSelections(window.VLAB.state.selections);
    }
  }

  return {
    init: init,
    resize: doResize,
    setTab: setTabIdx,
    getRenderer: function () { return _rndr; },
    getScene: function () { return _scn; },
    getCamera: function () { return _cam; },
    getControls: function () { return _ctrls; },
    getActiveTab: function () { return _tabIdx; }
  };
})();
window.Scene = Scene;

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

  function alignAlongDir(mesh, direction) {
    const up = new THREE.Vector3(0, 1, 0);
    const norm = direction.clone().normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(up, norm);
    mesh.setRotationFromQuaternion(q);
  }

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

  // Airfoil cross-section (NACA-4-like thickness/camber blend), used to loft
  // the propeller blade surface — ported verbatim from
  // EscHwModels.airfoilContour (esc_hw_models.js).
  function _propAirfoilContour(chord, thick, camber, S) {
    const pts = [];
    function yt(s) { return 5 * thick * (0.2969 * Math.sqrt(s) - 0.1260 * s - 0.3516 * s * s + 0.2843 * s * s * s - 0.1015 * s * s * s * s); }
    function yc(s) { return camber * 4 * s * (1 - s); }
    for (let i = 0; i <= S; i++) { const s = i / S; pts.push([(0.5 - s) * chord, yc(s) + yt(s) / 2]); }       // upper  LE→TE
    for (let i = S - 1; i >= 1; i--) { const s = i / S; pts.push([(0.5 - s) * chord, yc(s) - yt(s) / 2]); }   // lower  TE→LE
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

  // High-poly "hero" propeller model — ported from
  // exp-power-electronics-esc-dei's simulation/js/esc_hw_models.js
  // (window.EscHwModels.buildPropeller), inlined here per the one-js-file
  // rule. Replaces the old boxy segmented-extrusion blades with a single
  // smooth lofted airfoil surface per blade, true geometric twist computed
  // from the selection's actual pitch/diameter ratio (Calc.pitchDiameterRatio
  // — same value the physics model itself uses), plus a turned hub/bore/
  // washer. Local frame: y=0 is the hub center, matching this file's existing
  // propGroup convention exactly (hub bottom face rests on the motor bell
  // top) — no placement changes needed at call sites.
  function buildPropellerMesh(prop, dirSign) {
    prop = prop || {};
    const D = prop.diameter_m || 0.1270;
    _propDiamM = D;   // remember for the SFX pitch's size term (setSimRPM)
    const R = D / 2;
    const blades = Math.max(2, Math.min(4, prop.blades || 2));
    const pitch_m = Calc.pitchDiameterRatio(prop) * D;
    const root = new THREE.Group();
    const spin = new THREE.Group(); root.add(spin);

    const bladeMat = createMat(0x161a20, 0.28, 0.14, { side: THREE.DoubleSide });
    const tipMat = createMat(0xef4444, 0.26, 0.1, { emissive: 0x5c1414, emissiveIntensity: 0.3, side: THREE.DoubleSide });

    const hubR = R * 0.1;
    const baseChord = R * 0.17;

    // hub: barrel + dark centre bore + top washer
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

  function ensureGroup() {
    if (!window.Scene || !window.Scene.getScene()) return;
    if (!_droneGrp) {
      _droneGrp = new THREE.Group();
      _droneGrp.position.set(0, 0.10, 0);
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

  function updateFromSelections(sel) {
    ensureGroup();
    if (!_droneGrp) return;
    clearAll();

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
          // buildMotorMesh's top cap/vents/hub/screws cluster occupies
          // roughly [bellTop, bellTop+0.42*bellH] and its prop nut sits at
          // bellTop+0.5*bellH — resting the propeller hub bottom at bellH
          // above the bell top (the old formula) buried it inside that
          // cluster. 1.5*bellH lands the hub right at the nut instead, with
          // the shaft (extends to bellTop+1.1*bellH) still poking through.
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
          // buildMotorMesh's top cap/vents/hub/screws cluster occupies
          // roughly [bellTop, bellTop+0.42*bellH] and its prop nut sits at
          // bellTop+0.5*bellH — resting the propeller hub bottom at bellH
          // above the bell top (the old formula) buried it inside that
          // cluster. 1.5*bellH lands the hub right at the nut instead, with
          // the shaft (extends to bellTop+1.1*bellH) still poking through.
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
    // VISUAL spin rate (not the raw physical omega). Real prop RPM (3k–18k) is
    // 50–300 rev/s, which at 60 fps is several revolutions PER FRAME → the
    // blade aliases past Nyquist and looks frozen/jittery (this is why the
    // bench tab appeared "not spinning"). Map RPM to a monotonic, sub-aliasing
    // visual rev/s (≈ proportional over the working band, capped ~8 rev/s) plus
    // a small idle floor so the rotor always reads as alive. The motion-blur
    // disc below still conveys the true high-RPM "blur".
    const rpmEff = Math.max(_rotRPM, 700);
    const visRevPerSec = Math.min(8, rpmEff / 2500);
    const omega = visRevPerSec * 2.0 * Math.PI;

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
    // audio for free (bench stand, quad assembly, hover-sim, thermal cutouts...).
    if (window.SFX && window.SFX.motorRate) {
      const rpmFrac = Math.max(0, Math.min(1.3, _rotRPM / 18000));
      const sizeFactor = Math.max(0.65, Math.min(1.3, 0.145 / Math.max(0.06, _propDiamM)));
      window.SFX.motorRate(rpmFrac, sizeFactor);
    }
  }

  return {
    updateFromSelections: updateFromSelections,
    clearAll: clearAll,
    animateProps: animateProps,
    setSimRPM: setSimRPM,
    getDroneGroup: function () { return _droneGrp; },
    updateThrustStandDisplay: updateBenchHUD,
    setBurnState: setBurnState
  };
})();
window.DroneModel = DroneModel;

const FlightSim = (function () {
  'use strict';

  const MOTORS_COUNT = 4;
  const G_FORCE = 9.80665;
  const TARGET_ALT = 2.00;
  const LAUNCH_ALT = 0.10;
  const AUTO_FF = 60; // speed multiplier in auto mode
  const SHUTDOWN_SOC = 20.0; // auto-descend safety cut-off
  const ALERT_SOC = 25.0;
  const PID_KP = 2.80; // hover proportional gain
  const PID_KD = 1.90; // hover derivative gain

  let _cfg = null;
  let _phase = 'PREFLIGHT';
  let _fMode = 'auto';
  let _yVal = LAUNCH_ALT;
  let _vyVal = 0.0;
  let _tSim = 0.0;
  let _eRem = 0.0;
  let _eTot = 0.0;
  let _tPhase = 0.0;
  let _isAct = false;

  let _isStall = false;
  let _isDeficit = false;
  let _isOver = false;
  let _tBurn = 0.0;
  let _cutPwr = false;
  let _tMotor = 25.0; // start at ambient
  let _tEsc = 25.0;
  let _mThrottle = 0.0;

  function start(cfg, mode) {
    _cfg = cfg;
    _fMode = mode || 'auto';
    _yVal = LAUNCH_ALT;
    _vyVal = 0.0;
    _tSim = 0.0;
    _eRem = cfg.E_total_j;
    _eTot = cfg.E_total_j;
    _tPhase = 0.0;
    _isAct = true;

    _isStall = false;
    _isDeficit = false;
    _isOver = false;
    _tBurn = 0.0;
    _cutPwr = false;
    _tMotor = 25.0;
    _tEsc = 25.0;

    if (window.DroneModel) {
      window.DroneModel.setBurnState(false);
      const drone = window.DroneModel.getDroneGroup();
      if (drone) {
        drone.position.y = LAUNCH_ALT;
      }
    }

    _phase = 'PREFLIGHT';

    const op_max = Calc.solveOperatingPoint(cfg.motor, cfg.V_batt, cfg.propeller.diameter_m, cfg.rho, undefined, {
      cells: cfg.battery.cells,
      capacity_mah: cfg.battery.capacity_mah,
      pd: Calc.pitchDiameterRatio(cfg.propeller),
      R_esc: (cfg.esc && typeof cfg.esc.rds_on_ohm === 'number') ? cfg.esc.rds_on_ohm : undefined
    });
    if (!op_max) {
      _isStall = true;
    } else {
      const max_t = op_max.thrust * MOTORS_COUNT;
      if (max_t < cfg.M_kg * G_FORCE) {
        _isDeficit = true;
      }
    }

    syncHUD();
  }

  function stop() {
    _isAct = false;
  }

  function reset() {
    stop();
    _phase = 'PREFLIGHT';
    _yVal = LAUNCH_ALT;
    _vyVal = 0.0;
    _tSim = 0.0;
    _tPhase = 0.0;
    _eRem = _cfg ? _cfg.E_total_j : 0;
    _eTot = _cfg ? _cfg.E_total_j : 0;
    _tMotor = 25.0;
    _tEsc = 25.0;
    _tBurn = 0.0;
    _cutPwr = false;
    _isStall = false;
    _isDeficit = false;
    _isOver = false;

    const drone = window.DroneModel.getDroneGroup();
    if (drone) {
      drone.position.y = LAUNCH_ALT;
    }
    window.DroneModel.setSimRPM(0);
    window.DroneModel.setBurnState(false);

    if (window.Scene) {
      const cam = window.Scene.getCamera();
      const ctrl = window.Scene.getControls();
      if (cam && ctrl) {
        cam.position.set(0.70, 0.45, 0.90);
        ctrl.target.set(0, 0.10, 0);
        ctrl.update();
      }
    }

    syncHUD();
    hideBadge();
    document.getElementById('btnPlay').textContent = (_fMode === 'manual') ? 'Start Flight' : 'Start Hover';
  }

  function isRunning() {
    return _isAct;
  }

  function setManualThrottle(val) {
    _mThrottle = val;
  }

  function tick(dt) {
    if (!_isAct || !_cfg) return;

    dt = Math.min(dt, 0.03);

    const isManual = (_fMode === 'manual');
    let isStableHover = false;
    if (isManual && _phase === 'MANUAL') {
      const targetAlt = LAUNCH_ALT + (4.0 - LAUNCH_ALT) * (_mThrottle / 100.0);
      if (Math.abs(targetAlt - _yVal) < 0.05 && Math.abs(_vyVal) < 0.05) {
        isStableHover = true;
      }
    }

    let speedMultiplier = 1.0;
    if (!_isOver && !_cutPwr) {
      if (_phase === 'HOVER' || isStableHover) {
        speedMultiplier = AUTO_FF;
      }
    }

    const dt_acc = dt * speedMultiplier;
    const subDt = 0.005;
    const steps = Math.ceil(dt_acc / subDt);
    const dt_step = dt_acc / steps;

    const cells = _cfg.battery.cells;
    const motor = _cfg.motor;
    const propeller = _cfg.propeller;
    const rho = _cfg.rho;
    const M_kg = _cfg.M_kg;
    const frame = _cfg.frame;

    const soc_start = _eTot > 0 ? _eRem / _eTot : 1.0;
    // Per-cell LiPo OCV per theory.md §5 (centralized helper).
    const V_ocv_cell = Calc.ocvPerCell(soc_start);
    const V_oc_start = cells * V_ocv_cell;

    const motorCtx = {
      cells: cells,
      capacity_mah: _cfg.battery.capacity_mah,
      pd: Calc.pitchDiameterRatio(propeller),
      R_esc: (_cfg.esc && typeof _cfg.esc.rds_on_ohm === 'number') ? _cfg.esc.rds_on_ohm : undefined,
      soc: soc_start
    };

    // NOTE: V_oc_start (open-circuit pack voltage) is passed straight into the
    // solver, not a pre-sagged terminal voltage — effective_resistance()
    // already folds 4*R_batt(soc) into the per-motor circuit solve (theory.md
    // §3/§5). Sagging V externally here AND letting effective_resistance
    // subtract R_batt again would double-count the pack's IR drop.
    const op_max = Calc.solveOperatingPoint(motor, V_oc_start, propeller.diameter_m, rho, _tMotor, motorCtx);
    const T_max = op_max ? op_max.thrust : 0.0;

    let thrust = 0.0;

    // RK4 acceleration function declared at function root
    let currentThrust = 0.0;
    function getAcc(y, vy) {
      let actThrust = currentThrust;
      const standoff = Math.max(y - LAUNCH_ALT, propeller.diameter_m * 0.25);
      const geTerm = propeller.diameter_m / (4.0 * standoff);
      if (geTerm < 0.99) {
        const geMul = Math.min(1.0 / (1.0 - geTerm * geTerm), 1.75);
        actThrust *= geMul;
      }
      const area = Math.PI * 0.25 * propeller.diameter_m * propeller.diameter_m;
      const v_ind = Math.sqrt(Math.max(0.1, actThrust) / (2.0 * rho * area));
      const inflow = vy / v_ind;
      const tDamp = Math.max(0.2, 1.0 - 0.45 * inflow);
      actThrust *= tDamp;

      let CdA = 0.007;
      if (frame && frame.body_size_mm && frame.body_size_mm.length >= 3) {
        CdA = (frame.body_size_mm[0] / 1000.0) * (frame.body_size_mm[2] / 1000.0);
      }
      const F_drag = 0.5 * rho * CdA * vy * Math.abs(vy);
      const netForce = actThrust * MOTORS_COUNT - M_kg * G_FORCE - F_drag;
      return netForce / M_kg;
    }

    for (let step = 0; step < steps; step++) {
      if (_cutPwr || _isStall) {
        thrust = 0.0;
      } else if (_phase === 'PREFLIGHT') {
        _tPhase += dt_step;
        thrust = _cfg.T_hover_n * 0.18 * Math.min(_tPhase / 1.5, 1.0);
        if (_tPhase >= 1.5) {
          _tPhase = 0.0;
          _phase = isManual ? 'MANUAL' : 'TAKEOFF';
        }
      } else if (isManual && _phase === 'MANUAL') {
        if (_mThrottle <= 1.0) {
          thrust = _cfg.T_hover_n * 0.18;
        } else {
          const targetAlt = LAUNCH_ALT + (4.0 - LAUNCH_ALT) * (_mThrottle / 100.0);
          const altError = targetAlt - _yVal;
          const ctrlThrust = _cfg.T_hover_n + PID_KP * altError + PID_KD * (-_vyVal);
          thrust = Math.min(Math.max(ctrlThrust, _cfg.T_hover_n * 0.5), _cfg.T_hover_n * 1.5);
        }

        const est_soc = _eTot > 0 ? (_eRem - (op_max ? op_max.p_elec * MOTORS_COUNT : 0.0) * dt_step * step) / _eTot : 1.0;
        if (est_soc * 100.0 <= SHUTDOWN_SOC) {
          _tPhase = 0.0;
          _phase = 'DESCENT';
        }
      } else if (_phase === 'TAKEOFF') {
        _tPhase += dt_step;
        const sig = Math.tanh(2.0 * _tPhase);
        thrust = _cfg.T_hover_n * sig * 1.30;
        
        if (_yVal >= TARGET_ALT - 0.05) {
          _vyVal = 0.0;
          _yVal = TARGET_ALT;
          _tPhase = 0.0;
          _phase = 'HOVER';
        }
      } else if (_phase === 'HOVER') {
        const altError = TARGET_ALT - _yVal;
        const ctrlThrust = _cfg.T_hover_n + PID_KP * altError + PID_KD * (-_vyVal);
        thrust = Math.min(Math.max(ctrlThrust, _cfg.T_hover_n * 0.7), _cfg.T_hover_n * 1.4);

        const est_soc = _eTot > 0 ? (_eRem - (op_max ? op_max.p_elec * MOTORS_COUNT : 0.0) * dt_step * step) / _eTot : 1.0;
        if (est_soc * 100.0 <= SHUTDOWN_SOC) {
          _tPhase = 0.0;
          _phase = 'DESCENT';
        }
      } else if (_phase === 'DESCENT') {
        _tPhase += dt_step;
        const ramp = Math.max(0.0, Math.cos((_tPhase / 5.0) * Math.PI * 0.5));
        thrust = _cfg.T_hover_n * (0.7 + 0.3 * ramp);
      } else if (_phase === 'POSTFLIGHT') {
        _tPhase += dt_step;
        const ramp = Math.max(0.0, 1.0 - (_tPhase / 3.0));
        thrust = _cfg.T_hover_n * 0.18 * ramp;
      }

      thrust = Math.min(thrust, T_max);
      currentThrust = thrust;

      const k1_y = _vyVal;
      const k1_vy = getAcc(_yVal, _vyVal);

      const k2_y = _vyVal + 0.5 * dt_step * k1_vy;
      const k2_vy = getAcc(_yVal + 0.5 * dt_step * k1_y, k2_y);

      const k3_y = _vyVal + 0.5 * dt_step * k2_vy;
      const k3_vy = getAcc(_yVal + 0.5 * dt_step * k2_y, k3_y);

      const k4_y = _vyVal + dt_step * k3_vy;
      const k4_vy = getAcc(_yVal + dt_step * k3_y, k4_y);

      _yVal += (dt_step / 6.0) * (k1_y + 2.0 * k2_y + 2.0 * k3_y + k4_y);
      _vyVal += (dt_step / 6.0) * (k1_vy + 2.0 * k2_vy + 2.0 * k3_vy + k4_vy);
      _vyVal = Math.min(Math.max(_vyVal, -1.0), 1.0);

      if (_yVal <= LAUNCH_ALT) {
        _yVal = LAUNCH_ALT;
        _vyVal = 0.0;
        
        const est_soc = _eTot > 0 ? (_eRem - (op_max ? op_max.p_elec * MOTORS_COUNT : 0.0) * dt_step * step) / _eTot : 1.0;
        const isDead = _cutPwr || _isStall || (est_soc <= 0.001);
        if (_phase === 'DESCENT' || isDead) {
          if (isDead) {
            _phase = _cutPwr ? 'BURNED!' : 'LANDED';
            _isAct = false;
            if (window.DroneModel) {
              window.DroneModel.setSimRPM(0);
            }
            document.getElementById('btnPlay').textContent = (_fMode === 'manual') ? 'Start Flight' : 'Start Hover';
          } else {
            _phase = 'POSTFLIGHT';
            _tPhase = 0.0;
          }
        } else if (_phase === 'POSTFLIGHT' && _tPhase >= 3.0) {
          _phase = 'LANDED';
          _isAct = false;
          if (window.DroneModel) {
            window.DroneModel.setSimRPM(0);
          }
          document.getElementById('btnPlay').textContent = (_fMode === 'manual') ? 'Start Flight' : 'Start Hover';

          // Gate the proceed button on authority ratio pass
          const _margin = window.VLAB && window.VLAB.state && window.VLAB.state.computed && window.VLAB.state.computed.margin;
          const _authorityPass = _margin && _margin.pass === true;

          if (_authorityPass) {
            // Stamp hoverSimDone into vlabModule1 so module 2 can gate the unlock card
            try {
              const _m1Raw = localStorage.getItem('vlabModule1');
              if (_m1Raw) {
                const _m1State = JSON.parse(_m1Raw);
                _m1State.hoverSimDone = true;
                localStorage.setItem('vlabModule1', JSON.stringify(_m1State));
              }
            } catch (e) { /* ignore */ }

            const nextBtn = document.getElementById('nextModuleContainer');
            if (nextBtn) nextBtn.style.display = 'block';
            const failCard = document.getElementById('nextModuleFailCard');
            if (failCard) failCard.style.display = 'none';
          } else {
            // Authority ratio FAIL — show warning, block proceed
            const nextBtn = document.getElementById('nextModuleContainer');
            if (nextBtn) nextBtn.style.display = 'none';
            const failCard = document.getElementById('nextModuleFailCard');
            if (failCard) {
              const ratio = _margin ? _margin.margin_ratio.toFixed(2) : '—';
              const rating = _margin ? _margin.rating : 'FAIL';
              const msgEl = document.getElementById('nextModuleFailMsg');
              if (msgEl) {
                msgEl.textContent = `Authority ratio is ${rating} (${ratio}:1) — minimum 1.30:1 required. Select a larger propeller, higher-KV motor, or higher-cell battery to achieve hover capability.`;
              }
              failCard.style.display = 'block';
            }
          }
        }
      }
      _yVal = Math.min(_yVal, 4.0);

      if (_yVal > LAUNCH_ALT + 0.01 && _phase !== 'LANDED') {
        _tSim += dt_step;
      }
    }

    let finalT = (_cutPwr || _isStall) ? 0.0 : thrust;
    let u = 0.0;
    if (finalT > 0.0) {
      u = Calc.solveHoverThrottle(motor, V_oc_start, propeller.diameter_m, rho, finalT, _tMotor, motorCtx);
    }

    const op = Calc.solveOperatingPoint(motor, u * V_oc_start, propeller.diameter_m, rho, _tMotor, motorCtx);
    const current_a = op ? op.curr : 0.0;
    const power_elec_w = op ? op.p_elec : 0.0;
    const rpm = op ? op.rpm : 0.0;

    const pDraw = power_elec_w * MOTORS_COUNT;
    _eRem = Math.max(0, _eRem - pDraw * dt_acc);

    const p_loss = op ? Math.max(0, op.p_elec - op.p_mech) : 0.0;

    // Motor thermal step — real per-motor convective area from the catalog
    // bell geometry + calibrated forced-convection cooling (see Calc.motorThermalStep).
    _tMotor = Calc.motorThermalStep(_tMotor, p_loss, motor, finalT, rho, propeller.diameter_m, dt_acc);

    // ESC thermal step — real per-part rds_on_ohm + thermal resistance from the
    // catalog (see Calc.escThermalStep); the chosen ESC now actually matters.
    const esc_limit = (_cfg.esc && _cfg.esc.current_a) ? _cfg.esc.current_a : 30.0;
    _tEsc = Calc.escThermalStep(_tEsc, current_a, _cfg.esc, dt_acc, esc_limit);

    _tMotor = Math.min(250.0, Math.max(25.0, _tMotor));
    _tEsc = Math.min(180.0, Math.max(25.0, _tEsc));

    const isOverheat = _tMotor > 150.0 || _tEsc > 110.0;
    if (isOverheat) {
      _isOver = true;
      if (window.DroneModel) {
        window.DroneModel.setBurnState(true);
      }
      _tBurn += dt_acc;
      if (_tBurn >= 3.0) {
        _cutPwr = true;
      }
    }

    const batteryPercentage = _eTot > 0 ? (_eRem / _eTot) * 100.0 : 0.0;

    if (window.DroneModel) {
      const drone = window.DroneModel.getDroneGroup();
      if (drone) {
        drone.position.y = _yVal;
      }
      window.DroneModel.setSimRPM(_cutPwr ? 0 : rpm);
    }

    if (window.Scene && window.Scene.getActiveTab() === 3) {
      const cam = window.Scene.getCamera();
      const ctrl = window.Scene.getControls();
      if (cam && ctrl) {
        const dy = (_yVal + 0.05) - ctrl.target.y;
        ctrl.target.set(0, _yVal + 0.05, 0);
        cam.position.y += dy;
        ctrl.update();
      }
    }

    document.getElementById('hudAlt').textContent = _yVal.toFixed(2) + ' m';
    document.getElementById('hudTime').textContent = formatSeconds(_tSim);
    document.getElementById('hudBattery').textContent = batteryPercentage.toFixed(1) + '%';
    updateBatteryFill(batteryPercentage);
    renderNumbers(pDraw, current_a);

    if (speedMultiplier > 1.0 && !_cutPwr && !_isOver) {
      showBadge();
    } else {
      hideBadge();
    }

    let phaseText = _phase;
    let textType = '';

    if (isManual) {
      phaseText = 'MANUAL';
      if (_yVal > LAUNCH_ALT + 0.01) {
        phaseText = 'FLIGHT';
        textType = 'success';
      }
    } else {
      if (_phase === 'PREFLIGHT') phaseText = 'PRE-FLIGHT';
      else if (_phase === 'TAKEOFF') phaseText = 'TAKEOFF';
      else if (_phase === 'HOVER') {
        phaseText = 'HOVERING';
        textType = 'success';
      }
      else if (_phase === 'DESCENT') {
        phaseText = 'DESCENT';
        textType = 'warning';
      }
      else if (_phase === 'LANDED') {
        phaseText = 'LANDED';
        textType = 'success';
      }
    }

    if (_cutPwr) {
      phaseText = 'BURNED!';
      textType = 'danger';
    } else if (isOverheat) {
      phaseText = 'OVERHEAT!';
      textType = 'danger';
    } else if (_isStall) {
      phaseText = 'STALLED!';
      textType = 'danger';
    } else if (_isDeficit && _yVal <= LAUNCH_ALT + 0.001) {
      phaseText = 'THRUST DEFICIT!';
      textType = 'warning';
    } else if (batteryPercentage <= ALERT_SOC) {
      phaseText = 'LOW BATTERY';
      textType = 'warning';
    }

    setHUDPhaseText(phaseText, textType);

    const controlsNote = document.getElementById('simControlsNote');
    if (controlsNote) {
      if (_cutPwr) {
        controlsNote.textContent = 'CRITICAL: Motors burnt out due to extreme thermal load!';
        controlsNote.style.color = '#ef4444';
      } else if (isOverheat) {
        controlsNote.textContent = `WARNING: Overheat! Motor Temp: ${Math.round(_tMotor)}°C (Max: 150°C). Power cut in ${(3.0 - _tBurn).toFixed(1)}s!`;
        controlsNote.style.color = '#ef4444';
      } else if (_isStall) {
        controlsNote.textContent = 'ERROR: Motor stalled! Underpowered motor for this propeller size.';
        controlsNote.style.color = '#ef4444';
      } else if (_isDeficit) {
        controlsNote.textContent = 'WARNING: Thrust deficit! Maximum thrust is less than total drone mass.';
        controlsNote.style.color = '#f59e0b';
      } else {
        controlsNote.textContent = `Telemetry - Motor: ${Math.round(_tMotor)}°C | ESC: ${Math.round(_tEsc)}°C | Mode: ${_fMode.toUpperCase()}`;
        controlsNote.style.color = 'var(--text-secondary)';
      }
    }

    if (window.updateFlightTelemetryChart) {
      window.updateFlightTelemetryChart(_tSim, _yVal, finalT * MOTORS_COUNT);
    }

    if (window.updateLiveCommentary) {
      if (_cutPwr) {
        window.updateLiveCommentary('CRITICAL FAILURE: Motor windings or ESC permanently damaged due to extreme thermal load.');
      } else if (_isStall) {
        window.updateLiveCommentary('MOTOR STALL: Propeller is too heavy for the selected motor, drawing maximum current without rotating.');
      } else if (_isDeficit && _yVal <= LAUNCH_ALT + 0.001) {
        window.updateLiveCommentary('THRUST DEFICIT: Aerodynamic force produced at max throttle is less than total weight; vehicle cannot take off.');
      } else if (isManual) {
        if (_mThrottle === 0) {
          window.updateLiveCommentary('GUIDE: Ready. Increase the Flight Throttle slider below to apply power.');
        } else if (_yVal <= LAUNCH_ALT + 0.01) {
          window.updateLiveCommentary(`Manual Mode: Motors are at ${Math.round(_mThrottle)}% throttle. Total thrust (${(finalT * MOTORS_COUNT).toFixed(1)} N) is less than weight (${(_cfg.M_kg * 9.80665).toFixed(1)} N).`);
        } else {
          window.updateLiveCommentary(`OBSERVE: Airborne. Total thrust (${(finalT * MOTORS_COUNT).toFixed(1)} N) fights weight (${(_cfg.M_kg * 9.80665).toFixed(1)} N).`);
        }
      } else {
        if (_phase === 'PREFLIGHT') {
          window.updateLiveCommentary('GUIDE: Armed. Click "Start Simulation" to perform automated hover.');
        } else if (_phase === 'TAKEOFF') {
          window.updateLiveCommentary(`Takeoff: Controller commands climb throttle. Thrust (${(finalT * MOTORS_COUNT).toFixed(1)} N) exceeds weight (${(_cfg.M_kg * 9.80665).toFixed(1)} N).`);
        } else if (_phase === 'HOVER') {
          window.updateLiveCommentary(`Hover: PID automatically adjusts throttle to match weight. Battery voltage sag will increase throttle command over time.`);
        } else if (_phase === 'DESCENT') {
          window.updateLiveCommentary(`Battery Warning (${batteryPercentage.toFixed(1)}%): Commencing automated descent.`);
        } else if (_phase === 'LANDED') {
          window.updateLiveCommentary('Landed Safely: Motors stopped. Simulation complete.');
        }
      }
    }
  }

  function syncHUD() {
    document.getElementById('hudTime').textContent = '00:00:00';
    document.getElementById('hudAlt').textContent = _yVal.toFixed(2) + ' m';
    document.getElementById('hudBattery').textContent = '100.0%';
    document.getElementById('hudPower').textContent = '0 W';
    document.getElementById('hudCurrent').textContent = '0.0 A';
    updateBatteryFill(100);
    setHUDPhaseText(_fMode === 'manual' ? 'MANUAL' : 'PRE-FLIGHT', '');
  }

  function renderNumbers(power, current) {
    document.getElementById('hudPower').textContent = power.toFixed(0) + ' W';
    document.getElementById('hudCurrent').textContent = current.toFixed(1) + ' A';
  }

  function setHUDPhaseText(txt, type) {
    const el = document.getElementById('hudPhase');
    if (!el) return;
    el.textContent = txt;
    el.className = 'hud-val hud-phase';
    el.style.color = type === 'danger' ? '#ef4444' :
                     type === 'warning' ? '#f59e0b' :
                     type === 'success' ? '#10b981' : '#2563eb';
  }

  function updateBatteryFill(pct) {
    const fill = document.getElementById('batteryFill');
    if (!fill) return;
    fill.style.width = Math.max(0, pct).toFixed(1) + '%';
    fill.style.background = pct > 40 ? '#10b981' : pct > 25 ? '#f59e0b' : '#ef4444';
  }

  function showBadge() {
    const el = document.getElementById('ffBadge');
    if (el) el.style.display = 'inline-block';
  }

  function hideBadge() {
    const el = document.getElementById('ffBadge');
    if (el) el.style.display = 'none';
  }

  function formatSeconds(sec) {
    const s = Math.floor(sec);
    const hh = String(Math.floor(s / 3600)).padStart(2, '0');
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return hh + ':' + mm + ':' + ss;
  }

  return { start, stop, reset, isRunning, tick, setManualThrottle };
})();
window.FlightSim = FlightSim;

function buildSharedTileGrid(container, items, options) {
  const parent = typeof container === 'string' ? document.getElementById(container) : container;
  if (!parent) return;
  const { isMulti, selectedIds, name, idPrefix, specF, onSelect } = options || {};
  const selSet = new Set(Array.isArray(selectedIds) ? selectedIds : (selectedIds ? [selectedIds] : []));

  parent.innerHTML = items.map(item => {
    const active = selSet.has(item.id);
    const inputId = `${idPrefix}${item.id}`;
    const escName = String(item.label).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return `
      <label class="component-tile ${active ? 'active selected' : ''}" for="${inputId}">
        <input type="${isMulti ? 'checkbox' : 'radio'}" name="${name}" id="${inputId}" value="${item.id}" ${active ? 'checked' : ''}>
        <div class="tile-label">
          <span class="tile-name">${escName}</span>
          <span class="tile-spec">${specF(item)}</span>
        </div>
      </label>
    `;
  }).join('');

  parent.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('change', () => {
      const item = items.find(i => i.id === inp.value);
      if (onSelect && item) onSelect(item, inp.checked);
      if (!isMulti) {
        parent.querySelectorAll('.component-tile').forEach(t => t.classList.remove('active', 'selected'));
        inp.parentElement.classList.add('active', 'selected');
      } else {
        inp.parentElement.classList.toggle('active', inp.checked);
        inp.parentElement.classList.toggle('selected', inp.checked);
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

  scn.add(new THREE.AmbientLight(0xffffff, options.ambientIntensity || 0.6));
  const sun = new THREE.DirectionalLight(0xffffff, options.sunIntensity || 1.0);
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

const UI = (function () {
  'use strict';

  let _chartInst = null;

  function buildGrid(db) {
    _makeSec('Frame / Chassis', db.frames, 'frame', _fmtFrame, false);
    _makeSec('Motor', db.motors, 'motor', _fmtMotor, false);
    _makeSec('Propeller', db.propellers, 'propeller', _fmtProp, false);
    _makeSec('Battery', db.batteries, 'battery', _fmtBatt, false);
    _makeSec('ESC', db.escs, 'esc', _fmtEsc, false);
    _makeSec('Flight Controller', db.flight_controllers, 'flight_controller', _fmtFc, false);
    _makeSec('Receiver', db.receivers, 'receiver', _fmtRx, false);
    _makeSec('Payloads', db.payloads, 'payload', _fmtPayload, true);

    _bindEnvSlider();
    updateChecklist();
  }

  function _makeSec(title, list, cat, specF, isMulti) {
    const parent = document.getElementById('configSections');
    if (!parent) return;

    const g = document.createElement('div');
    g.className = 'config-group';
    g.id = 'group_' + cat;

    const gTitle = document.createElement('div');
    gTitle.className = 'config-group-title';
    gTitle.textContent = title;
    g.appendChild(gTitle);

    const grid = document.createElement('div');
    grid.className = 'tiles-grid';
    g.appendChild(grid);

    buildSharedTileGrid(grid, list, {
      isMulti: isMulti,
      name: 'sel_' + cat,
      idPrefix: 'input_' + cat + '_',
      specF: specF,
      onSelect: function (item, checked) {
        _onSelect(cat, item, isMulti, checked);
      }
    });

    parent.appendChild(g);
  }

  function _fmtFrame(f) { return f.wheelbase_mm + 'mm | ' + f.mass_g + 'g'; }
  function _fmtMotor(m) { return m.kv + 'KV | ' + m.mass_g + 'g'; }
  function _fmtProp(p) { return p.diameter_in + '" | ' + p.mass_g_each + 'g'; }
  function _fmtBatt(b) { return b.cells + 'S | ' + b.capacity_mah + 'mAh | ' + b.mass_g + 'g'; }
  function _fmtEsc(e) { return e.current_a + 'A | ' + (e.quantity === 1 ? 'Stack' : '4x') + ' | ' + (e.mass_g_each * e.quantity).toFixed(0) + 'g'; }
  function _fmtFc(f) { return f.processor + ' | ' + f.mass_g + 'g'; }
  function _fmtRx(r) { return r.protocol + ' | ' + r.mass_g + 'g'; }
  function _fmtPayload(p) { return p.mass_g + 'g'; }

  // frame/battery are shared components fields — also selectable from Exp 2's
  // own UI — so writes to them are gated through VLABOverride, not committed
  // directly like the rest of this experiment's own fields.
  const SHARED_FIELD_MAP = { frame: 'frameId', battery: 'batteryId' };

  // Re-checks the matching tile's radio input (and active/selected classes)
  // after a selection changes WITHOUT a tile click — i.e. a revert — since
  // buildSharedTileGrid's own change-driven sync only runs on click.
  function _syncTileUI(cat, newId) {
    const input = document.getElementById('input_' + cat + '_' + newId);
    if (!input) return;
    input.checked = true;
    const group = document.getElementById('group_' + cat);
    if (group) {
      group.querySelectorAll('.component-tile').forEach(t => t.classList.remove('active', 'selected'));
      const label = input.closest('.component-tile');
      if (label) label.classList.add('active', 'selected');
    }
  }

  function renderOverrideNotices() {
    if (!window.VLABOverride) return;
    const catalog = window.VLAB_CATALOG || {};
    const frameHost = document.getElementById('vlOverrideHostFrame');
    const batteryHost = document.getElementById('vlOverrideHostBattery');
    if (frameHost) {
      window.VLABOverride.mountOverrideNotice(frameHost, 'frameId', 'exp1', function (newId) {
        const found = (catalog.frames || []).find(f => f.id === newId);
        if (found) { window.VLAB.state.selections.frame = found; _syncTileUI('frame', newId); _onSelectionRestored(); }
      });
    }
    if (batteryHost) {
      window.VLABOverride.mountOverrideNotice(batteryHost, 'batteryId', 'exp1', function (newId) {
        const found = (catalog.batteries || []).find(b => b.id === newId);
        if (found) { window.VLAB.state.selections.battery = found; _syncTileUI('battery', newId); _onSelectionRestored(); }
      });
    }
  }

  // Shared refresh path after a revert changes a selection out from under
  // the UI (not via a tile click, so it skips straight to the same
  // recompute/redraw _onSelect would have triggered).
  function _onSelectionRestored() {
    if (window.DroneModel) window.DroneModel.updateFromSelections(window.VLAB.state.selections);
    resetOutputs();
    if (window.VLAB && window.VLAB.refreshLive) window.VLAB.refreshLive();
    updateChecklist();
    renderOverrideNotices();
  }

  function _onSelect(cat, item, isMulti, checked) {
    if (!window.VLAB) return;
    const selections = window.VLAB.state.selections;

    if (isMulti) {
      if (checked) {
        if (!selections.payloads.find(p => p.id === item.id)) {
          selections.payloads.push(item);
        }
      } else {
        window.VLAB.state.selections.payloads = selections.payloads.filter(p => p.id !== item.id);
      }
    } else if (SHARED_FIELD_MAP[cat] && window.VLABOverride) {
      const field = SHARED_FIELD_MAP[cat];
      // exp1 owns frame/battery — use the unvalidated-but-tracked write so its
      // own picks are never rejected against stale pre-recompute numbers; its
      // existing Lock-button gate (which runs AFTER a fresh recompute) is
      // what actually catches a genuinely bad combo.
      const result = window.VLABOverride.trySetOwned(field, item.id, 'exp1');
      if (!result.ok) {
        if (window.SFX) window.SFX.warn();
        if (window.Instructor) window.Instructor.show('<strong>Selection blocked:</strong> ' + result.reason);
        const stillCurrent = selections[cat];
        if (stillCurrent) {
          // deferred: buildSharedTileGrid's own change handler re-highlights
          // the just-clicked (rejected) tile right after this callback
          // returns, so the revert has to happen a tick later to win.
          setTimeout(function () { _syncTileUI(cat, stillCurrent.id); }, 0);
        }
        return; // rejected — local selection state stays on the prior, valid value
      }
      selections[cat] = item;
      renderOverrideNotices();
    } else {
      selections[cat] = item;
    }

    if (window.DroneModel) {
      window.DroneModel.updateFromSelections(selections);
    }

    if (window.SFX) window.SFX.click(); // component selected/changed
    resetOutputs();
    if (window.VLAB && window.VLAB.refreshLive) window.VLAB.refreshLive();
    updateChecklist();
    if (window.VLAB && window.VLAB.currentTab === 1 && window.updateLiveCommentary) {
      window.updateLiveCommentary(assemblyTip());
    }
  }

  function updateChecklist() {
    const sel = window.VLAB && window.VLAB.state.selections;
    const container = document.getElementById('checklistContainer');
    if (!sel || !container) return;

    const fields = [
      { key: 'frame',             label: 'Frame / Chassis',     desc: 'Select frame size' },
      { key: 'motor',             label: 'Brushless Motor',     desc: 'Select motor KV' },
      { key: 'propeller',         label: 'Propeller Size',      desc: 'Select diameter' },
      { key: 'battery',           label: 'LiPo Battery Pack',   desc: 'Select cell count' },
      { key: 'esc',               label: 'ESC Rating',          desc: 'Select ESC rating' },
      { key: 'flight_controller', label: 'Flight Controller',   desc: 'Select processor' },
      { key: 'receiver',          label: 'Radio Receiver (RX)', desc: 'Select protocol' }
    ];

    let overlap = false;
    if (sel.frame && sel.propeller) {
      const wheelbase = sel.frame.wheelbase_mm;
      const diameter = sel.propeller.diameter_m * 1000.0;
      const maxDia = wheelbase / Math.sqrt(2);
      if (diameter > maxDia) overlap = true;
    }

    const isDoneFor = function (f) { return !!sel[f.key] && !(f.key === 'propeller' && overlap); };
    let counts = 0;
    fields.forEach(function (f) { if (isDoneFor(f)) counts++; });

    // Uniform objectives panel (shared VLABLab): the rows auto-tick as each
    // component is chosen, matching Experiments 4-6. Falls back to the local
    // checklist markup when the shared kit is absent (e.g. headless tests).
    if (window.VLABLab) {
      const defs = fields.map(function (f) {
        return {
          id: f.key,
          label: f.label,
          hint: f.desc,
          test: function () { return isDoneFor(f); },
          value: function () { return sel[f.key] ? sel[f.key].label : ''; },
          warn: function () { return f.key === 'propeller' && overlap; }
        };
      });
      window.VLABLab.objectives(container, defs, sel, { title: 'Rotor assembly progress' });
    } else {
      let html = '';
      fields.forEach(function (f) {
        const item = sel[f.key];
        const isDone = isDoneFor(f);
        const icon = isDone ? '<span class="chk-icon done">✓</span>' : '<span class="chk-icon pending"></span>';
        const name = item ? item.label : f.desc;
        html +=
          '<div class="checklist-item">' +
            icon +
            '<span class="checklist-label">' + f.label + '</span>' +
            '<span class="checklist-val">' + name + '</span>' +
          '</div>';
      });
      container.innerHTML = html;
    }

    const overlapCard = document.getElementById('overlapWarningCard');
    if (overlapCard) {
      if (overlap) {
        const wheelbase = sel.frame.wheelbase_mm;
        const propDiaIn = sel.propeller.diameter_in;
        const maxDiaIn = (wheelbase / Math.sqrt(2) / 25.4).toFixed(1);

        overlapCard.style.display = 'block';
        overlapCard.innerHTML = 
          '<strong>Propeller Collision Warning</strong>' +
          'Selected ' + propDiaIn + '" propellers will overlap and collide on a ' + 
          wheelbase + 'mm frame. Max allowed is ' + maxDiaIn + '" to avoid overlap.';
      } else {
        overlapCard.style.display = 'none';
      }
    }

    const btn = document.getElementById('btn_lock_assembly');
    if (btn) {
      // Real-time fault blocking: even with every field picked, don't allow
      // Lock while VLABValidate.check() reports a hard error (ESC undersized,
      // battery can't supply the current, voltage sags below the safe floor,
      // etc). Overlap is already covered above via isDoneFor's propeller check.
      const blocked = (window.VLAB && window.VLAB.hasBlockingViolations) ? window.VLAB.hasBlockingViolations() : false;
      btn.disabled = !(counts === fields.length) || blocked;
    }
  }

  function _bindEnvSlider() {
    const slider = document.getElementById('alt_rng_input');
    const valText = document.getElementById('altitudeValue');
    const densText = document.getElementById('densityValue');
    if (!slider) return;

    function handleInput() {
      const alt = parseInt(slider.value, 10);
      const rho = Calc.airDensity(alt);
      if (window.VLAB) {
        window.VLAB.state.altitude_m = alt;
        window.VLAB.state.rho = rho;
      }
      if (valText) valText.textContent = alt + ' m';
      if (densText) densText.textContent = rho.toFixed(4);

      const pct = (alt / 3000) * 100;
      slider.style.background = 'linear-gradient(to right, #2563eb ' + pct + '%, #e5e7eb ' + pct + '%)';

      if (window.VLAB && window.VLAB.refreshLive) window.VLAB.refreshLive();
      updateChecklist();
    }

    slider.addEventListener('input', handleInput);
    handleInput();
  }

  function renderMassTable(budget) {
    const tbody = document.getElementById('tbl_mass_body');
    if (!tbody) return;
    tbody.innerHTML = '';

    budget.breakdown.forEach(function (row) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + _esc(row.label) + '</td>' +
        '<td>' + row.quantity + '</td>' +
        '<td>' + row.unit_g.toFixed(1) + '</td>' +
        '<td>' + row.total_g.toFixed(1) + '</td>';
      tbody.appendChild(tr);
    });

    const totalCell = document.getElementById('totalMassCell');
    if (totalCell) totalCell.textContent = budget.total_g.toFixed(1) + ' g';

    const div = document.getElementById('massBudget');
    if (div) div.style.display = '';
  }

  function renderOutputs(r) {
    const calcPanel = document.getElementById('calculationsPanel');
    const resultsSec = document.getElementById('resultsSection');

    if (calcPanel) calcPanel.style.display = '';
    if (resultsSec) resultsSec.style.display = '';

    const rps = r.op_point ? r.op_point.rpm / 60.0 : 100;

    document.getElementById('calcA_eval').innerHTML =
      '<i>T</i><sub>req</sub> = (' + r.mass_kg.toFixed(4) + ' kg &times; 9.80665 m/s&sup2;) / 4 = ' + r.T_required_n.toFixed(4) + ' N per motor';

    // Effective BEMT coefficient actually used by the engine (not the legacy constant).
    const _ctEffOut = Calc.propCoefficients({
      pitch_diameter_ratio: Calc.pitchDiameterRatio(r.sel.propeller),
      n_rps: Math.max(rps, 1e-3), D: r.sel.propeller.diameter_m, rho: r.rho
    }).ct;
    document.getElementById('calcB_eval').innerHTML =
      '<i>T</i><sub>aero</sub> = ' + _ctEffOut.toFixed(5) + ' &times; ' + r.rho.toFixed(4) + ' kg/m&sup3; &times; (' +
      rps.toFixed(1) + ' rps)&sup2; &times; (' + r.sel.propeller.diameter_m.toFixed(4) + ' m)<sup>4</sup> = ' + r.T_aero_n.toFixed(4) + ' N';

    document.getElementById('sumMass').textContent = r.mass_kg.toFixed(4) + ' kg';
    document.getElementById('sumReqThrust').textContent = r.T_required_n.toFixed(4) + ' N';
    document.getElementById('sumAeroThrust').textContent = r.T_aero_n.toFixed(4) + ' N';

    const marginCard = document.getElementById('sumMarginCard');
    const marginVal = document.getElementById('sumMarginVal');
    const marginDesc = document.getElementById('sumMarginDesc');

    if (marginCard && marginVal && marginDesc) {
      marginCard.className = 'card-item margin-card';
      const rating = r.margin.rating;
      if (rating === 'EXCELLENT' || rating === 'GOOD') {
        marginCard.classList.add('pass-good');
      } else if (rating === 'MARGINAL') {
        marginCard.classList.add('pass-marginal');
      } else {
        marginCard.classList.add('fail');
      }
      marginVal.textContent = rating + ' (' + r.margin.margin_ratio.toFixed(2) + ':1)';
      marginDesc.textContent = r.margin.margin_pct.toFixed(1) + '% authority margin (Min: 30%)';
    }

    const mins = (r.flight_time.flight_time_s / 60.0).toFixed(1);
    document.getElementById('sumHoverTime').textContent = mins + ' min (' + r.flight_time.flight_time_s.toFixed(0) + ' s)';
  }

  function renderThrustChart(sweepData, T_req, targetRPM) {
    const canvas = document.getElementById('thrustChart');
    if (!canvas) return;

    const desc = document.getElementById('chartDescRPM');
    if (desc && targetRPM) {
      desc.innerHTML = 'Fixed RPM = ' + Math.round(targetRPM) + '. quartic D^4 scale.';
    }

    if (_chartInst) {
      _chartInst.destroy();
      _chartInst = null;
    }

    const labels = sweepData.map(d => d.diameter_in.toFixed(1) + '"');
    const thrusts = sweepData.map(d => d.thrust_n);

    _chartInst = new Chart(canvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Aerodynamic Thrust (N)',
            data: thrusts,
            borderColor: '#2563eb',
            backgroundColor: 'rgba(37, 99, 235, 0.08)',
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: '#2563eb',
            fill: true,
            tension: 0.2
          },
          {
            label: 'Required Thrust (N)',
            data: labels.map(() => T_req),
            borderColor: '#ef4444',
            borderWidth: 1.5,
            borderDash: [4, 3],
            pointRadius: 0,
            fill: false
          }
        ]
      },
      options: {
        plugins: {
          legend: {
            position: 'bottom',
            labels: { boxWidth: 10, padding: 6 }
          }
        },
        scales: {
          x: {
            ticks: { font: { family: 'JetBrains Mono', size: 9 } }
          },
          y: {
            ticks: { font: { family: 'JetBrains Mono', size: 9 } }
          }
        }
      }
    });
  }

  function resetOutputs() {
    const budgetDiv = document.getElementById('massBudget');
    const simControls = document.getElementById('simControls');
    const simHud = document.getElementById('simHud');

    if (budgetDiv) budgetDiv.style.display = 'none';
    if (simControls) simControls.style.display = 'none';
    if (simHud) simHud.style.display = 'none';

    const placeholders = ['calcA_eval', 'calcB_eval', 'sumMass', 'sumReqThrust', 'sumAeroThrust', 'sumHoverTime'];
    placeholders.forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.textContent = '—';
    });

    const marginVal = document.getElementById('sumMarginVal');
    const marginDesc = document.getElementById('sumMarginDesc');
    const marginCard = document.getElementById('sumMarginCard');
    if (marginVal) marginVal.textContent = '—';
    if (marginDesc) marginDesc.innerHTML = '<i>T</i><sub>aero</sub> / <i>T</i><sub>req</sub>';
    if (marginCard) {
      marginCard.className = 'card-item';
    }

    const tab2 = document.getElementById('tab_test');
    const tab3 = document.getElementById('tab_hover');
    if (tab2) tab2.disabled = true;
    if (tab3) tab3.disabled = true;

    if (_chartInst) {
      _chartInst.destroy();
      _chartInst = null;
    }
  }

  function _esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return {
    buildFromDB: buildGrid,
    updateChecklist: updateChecklist,
    showMassBudget: renderMassTable,
    showCalcResults: renderOutputs,
    showThrustChart: renderThrustChart,
    resetResults: resetOutputs,
    renderOverrideNotices: renderOverrideNotices
  };
})();
window.UI = UI;

const Mod2UI = (function() {
  'use strict';

  let _effChart = null;
  let _tachoChart = null;
  let _thrustChart = null;

  function initEffChart() {
    const ctx = document.getElementById('effChart');
    if (!ctx) return;
    
    _effChart = new Chart(ctx, {
      type: 'scatter',
      data: {
        datasets: [{
          label: 'Rotor Efficiency',
          data: [],
          borderColor: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
          backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
          borderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
          showLine: true,
          tension: 0.4,
          yAxisID: 'y'
        },
        {
          label: 'Copper Winding Loss (W)',
          data: [],
          borderColor: getComputedStyle(document.documentElement).getPropertyValue('--danger').trim(),
          backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--danger').trim(),
          borderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
          showLine: true,
          borderDash: [5, 5],
          tension: 0.4,
          yAxisID: 'y1'
        },
        {
          label: 'Hover Point',
          data: [],
          borderColor: '#9ca3af',
          borderWidth: 1.5,
          borderDash: [4, 4],
          pointRadius: 0,
          showLine: true,
          tension: 0,
          yAxisID: 'y'
        }]
      },
      options: {
        scales: {
          x: {
            title: { display: true, text: 'Throttle (%)' },
            min: 30,
            max: 105
          },
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            title: { display: true, text: 'Efficiency (%)' },
            min: 0,
            max: 100
          },
          y1: {
            type: 'linear',
            display: true,
            position: 'right',
            title: { display: true, text: 'Loss (W)' },
            min: 0,
            grid: { drawOnChartArea: false }
          }
        },
        plugins: {
          legend: {
            display: true,
            labels: {
              boxWidth: 12,
              filter: function(item) {
                return item.text !== 'Hover Point';
              }
            }
          },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                if (ctx.dataset.label === 'Hover Point') return '';
                return `${ctx.dataset.label}: ${ctx.raw.y.toFixed(1)}`;
              }
            }
          }
        }
      }
    });
  }

  function initTachoChart() {
    const ctx = document.getElementById('tacho_chart_canvas');
    if (!ctx) return;

    _tachoChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Loaded RPM', 'RPM Lost to Winding Loss', 'Remaining Capacity'],
        datasets: [{
          data: [0, 0, 100],
          backgroundColor: [
            getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
            getComputedStyle(document.documentElement).getPropertyValue('--danger').trim(),
            getComputedStyle(document.documentElement).getPropertyValue('--border-light').trim()
          ],
          borderWidth: 0,
          cutout: '80%',
          circumference: 240,
          rotation: 240
        }]
      },
      options: {
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                return `${ctx.label}: ${Math.round(ctx.raw)} RPM`;
              }
            }
          }
        }
      }
    });
  }

  function initThrustChart() {
    const ctx = document.getElementById('thrustChart');
    if (!ctx) return;
    
    _thrustChart = new Chart(ctx, {
      type: 'scatter',
      data: {
        datasets: [{
          label: 'Thrust (N)',
          data: [],
          borderColor: getComputedStyle(document.documentElement).getPropertyValue('--success').trim(),
          backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--success').trim(),
          borderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
          showLine: true,
          tension: 0.4
        }]
      },
      options: {
        scales: {
          x: {
            title: { display: true, text: 'Current (A)' },
            min: 0
          },
          y: {
            type: 'linear',
            display: true,
            title: { display: true, text: 'Thrust (N)' },
            min: 0
          }
        },
        plugins: {
          legend: { display: true, labels: { boxWidth: 12 } },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                return `${ctx.dataset.label}: ${ctx.raw.y.toFixed(2)} at ${ctx.raw.x.toFixed(1)} A`;
              }
            }
          }
        }
      }
    });
  }

  function updateCharts(dataPoints, hoverThrottlePct) {
    if (_effChart) {
      _effChart.data.datasets[0].data = dataPoints.map(p => ({ x: p.throttle_pct, y: p.efficiency_pct }));
      _effChart.data.datasets[1].data = dataPoints.map(p => ({ x: p.throttle_pct, y: p.power_loss_w }));
      
      if (hoverThrottlePct !== undefined && hoverThrottlePct !== null && hoverThrottlePct >= 0) {
        _effChart.data.datasets[2].data = [
          { x: hoverThrottlePct, y: 0 },
          { x: hoverThrottlePct, y: 100 }
        ];
      } else {
        _effChart.data.datasets[2].data = [];
      }
      _effChart.update();
    }
    if (_thrustChart) {
      _thrustChart.data.datasets[0].data = dataPoints.map(p => ({ x: p.current_a, y: p.thrust_n }));
      _thrustChart.update();
    }
  }

  function renderTable(dataPoints) {
    const tbody = document.getElementById('effTableBody');
    if (!tbody) return;
    
    let html = '';
    dataPoints.forEach(p => {
      html += `
        <tr>
          <td class="mono">${p.throttle_pct.toFixed(0)}%</td>
          <td class="mono">${Math.round(p.rpm || 0)}</td>
          <td class="mono">${p.thrust_n.toFixed(2)}</td>
          <td class="mono">${p.current_a.toFixed(1)}</td>
          <td class="mono">${(p.power_elec_w || p.power_w || 0).toFixed(0)}</td>
          <td class="mono">${(p.power_loss_w || 0).toFixed(0)}</td>
          <td class="mono" style="color:var(--accent); font-weight:600;">${p.efficiency_pct.toFixed(1)}%</td>
        </tr>
      `;
    });
    tbody.innerHTML = html;
  }

  function updateRpm(freeRpm, loadedRpm, maxScaleRpm) {
    if (!_tachoChart) return;
    
    const scale = Math.max(maxScaleRpm, 100);
    const lostRpm = Math.max(0, freeRpm - loadedRpm);
    const remainingScale = Math.max(0, scale - freeRpm);

    _tachoChart.data.datasets[0].data = [loadedRpm, lostRpm, remainingScale];
    _tachoChart.update();

    const lbl = document.getElementById('tachoRpmVal');
    if (lbl) lbl.textContent = Math.round(loadedRpm);
  }

  function updateCircuit(vBatt, vDrop, vBemf) {
    const elBatt = document.getElementById('circVbatt');
    const elDrop = document.getElementById('circVdrop');
    const elBemf = document.getElementById('circVbemf');
    if (elBatt) elBatt.textContent = `${vBatt.toFixed(1)}V`;
    if (elDrop) elDrop.textContent = `-${vDrop.toFixed(1)}V`;
    if (elBemf) elBemf.textContent = `${vBemf.toFixed(1)}V`;

    const resistorContainer = elDrop.parentElement;
    if (vDrop > 1.0) {
      resistorContainer.style.background = 'var(--danger-light)';
      resistorContainer.style.outline = '1px solid var(--danger)';
      resistorContainer.style.borderRadius = '4px';
      resistorContainer.style.padding = '4px';
    } else {
      resistorContainer.style.background = 'transparent';
      resistorContainer.style.outline = 'none';
      resistorContainer.style.padding = '0';
    }
  }

  function updateSankey(pElec, pMech, pLoss) {
    const elElec = document.getElementById('sankeyPelec');
    const elMech = document.getElementById('sankeyPmech');
    const elLoss = document.getElementById('sankeyPloss');
    const barMech = document.getElementById('sankeyBarMech');
    const barLoss = document.getElementById('sankeyBarLoss');

    if (!elElec || !barMech) return;

    elElec.textContent = `${pElec.toFixed(1)} W`;
    elMech.textContent = `${pMech.toFixed(1)} W`;
    elLoss.textContent = `${pLoss.toFixed(1)} W`;

    if (pElec > 0) {
      const mechPct = Math.max(0, Math.min((pMech / pElec) * 100, 100));
      const lossPct = Math.max(0, Math.min((pLoss / pElec) * 100, 100));
      barMech.style.width = `${mechPct}%`;
      barLoss.style.width = `${lossPct}%`;
    } else {
      barMech.style.width = `100%`;
      barLoss.style.width = `0%`;
    }
  }

  let _unlRndr = null, _unlScn = null, _unlCam = null, _unlCtrls = null, _unlClk = null, _unlAnim = null;
  let _propSpin = null;

  function initUnlock() {
    const canvas = document.getElementById('unlockCanvas');
    if (!canvas) return;

    if (_unlAnim) {
      cancelAnimationFrame(_unlAnim);
      _unlAnim = null;
    }

    const base = initBase3DScene(canvas, canvas, {
      bgColor: 0xf3f4f6,
      fov: 40,
      camPos: { x: 0.12, y: 0.10, z: 0.16 },
      alpha: true,
      ctrls: { minDist: 0.08, maxDist: 1.0, target: { x: 0, y: 0.005, z: 0 } },
      ambientIntensity: 0.70,
      sunIntensity: 0.90,
      sunPos: { x: 1.0, y: 2.0, z: 1.0 }
    });
    _unlScn = base.scn;
    _unlRndr = base.rndr;
    _unlCam = base.cam;
    _unlCtrls = base.ctrls;

    const motorMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.3, metalness: 0.8 });
    const copperMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.5, metalness: 0.5 });
    const propMat = new THREE.MeshStandardMaterial({ color: 0x282828, roughness: 0.5, metalness: 0.1 });
    const redMat = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.4, metalness: 0.1 });
    const nutMat = new THREE.MeshStandardMaterial({ color: 0xd1d5db, roughness: 0.2, metalness: 0.9 });

    const itemGroup = new THREE.Group();
    _unlScn.add(itemGroup);

    function createProcedural() {
      while(itemGroup.children.length > 0) { 
        itemGroup.remove(itemGroup.children[0]); 
      }
      
      _propSpin = new THREE.Group();
      _propSpin.position.set(0, 0.011, 0);
      itemGroup.add(_propSpin);

      const stator = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.006, 16), motorMat);
      stator.position.y = -0.012;
      itemGroup.add(stator);

      const coils = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.004, 12), copperMat);
      coils.position.y = -0.008;
      itemGroup.add(coils);

      const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.014, 20), motorMat);
      bell.position.y = -0.009;
      _propSpin.add(bell);

      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.024, 8), nutMat);
      shaft.position.y = -0.005;
      _propSpin.add(shaft);

      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.006, 12), propMat);
      hub.position.y = 0.007;
      _propSpin.add(hub);

      const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.004, 6), nutMat);
      nut.position.y = 0.012;
      _propSpin.add(nut);

      const bladeR = 0.045;
      const steps = 6;
      const stepL = bladeR / steps;

      for (let b = 0; b < 2; b++) {
        const angle = b * Math.PI;
        const bGrp = new THREE.Group();
        bGrp.rotation.y = angle;
        bGrp.position.y = 0.007;
        _propSpin.add(bGrp);

        for (let i = 0; i < steps; i++) {
          const t = i / (steps - 1);
          const segLen = stepL;
          const segW = 0.007 * (1.1 * (1 - t) + 0.4 * t);
          const segT = 0.001 * (1 - t) + 0.0003 * t;
          const twist = (0.28 * (1 - t) + 0.06 * t);

          const segMesh = new THREE.Mesh(new THREE.BoxGeometry(segLen, segT, segW), (i === steps - 1) ? redMat : propMat);
          segMesh.position.x = 0.006 + i * stepL + stepL / 2;
          segMesh.rotation.x = twist;
          bGrp.add(segMesh);
        }
      }
    }

    if (window.GLTFLoader) {
      const loader = new window.GLTFLoader();
      
      const loadL = new Promise((res, rej) => { loader.load('asset/motor_lower.glb', res, undefined, rej); });
      const loadU = new Promise((res, rej) => { loader.load('asset/motor_upper.glb', res, undefined, rej); });
      const loadP = new Promise((res, rej) => { loader.load('asset/propeller.glb', res, undefined, rej); });

      Promise.all([loadL, loadU, loadP]).then(([gLower, gUpper, gProp]) => {
        while (itemGroup.children.length > 0) {
          itemGroup.remove(itemGroup.children[0]);
        }

        _propSpin = new THREE.Group();
        _propSpin.position.set(0, 0, 0);
        itemGroup.add(_propSpin);

        const lowerScene = gLower.scene;
        const upperScene = gUpper.scene;
        const propScene = gProp.scene;

        const boxLower = new THREE.Box3().setFromObject(lowerScene);
        const sizeLower = new THREE.Vector3();
        boxLower.getSize(sizeLower);
        
        const lowerDiameter = Math.max(sizeLower.x, sizeLower.z) || 1.0;
        const assemblyScale = 0.036 / lowerDiameter;

        lowerScene.scale.set(assemblyScale, assemblyScale, assemblyScale);
        const centerLower = new THREE.Vector3();
        boxLower.getCenter(centerLower);
        lowerScene.position.set(-centerLower.x * assemblyScale, -centerLower.y * assemblyScale, -centerLower.z * assemblyScale);
        itemGroup.add(lowerScene);

        const boxUpper = new THREE.Box3().setFromObject(upperScene);
        const centerUpper = new THREE.Vector3();
        boxUpper.getCenter(centerUpper);
        const sizeUpper = new THREE.Vector3();
        boxUpper.getSize(sizeUpper);

        upperScene.scale.set(assemblyScale, assemblyScale, assemblyScale);
        upperScene.position.x = -centerUpper.x * assemblyScale;
        upperScene.position.z = -centerUpper.z * assemblyScale;
        upperScene.position.y = -centerLower.y * assemblyScale;
        _propSpin.add(upperScene);

        const boxProp = new THREE.Box3().setFromObject(propScene);
        const centerProp = new THREE.Vector3();
        boxProp.getCenter(centerProp);
        const sizeProp = new THREE.Vector3();
        boxProp.getSize(sizeProp);

        const propDiameter = Math.max(sizeProp.x, sizeProp.z) || 1.0;
        const propScale = (0.09 / propDiameter) * 1.45;

        propScene.scale.set(propScale, propScale, propScale);
        propScene.position.x = -centerProp.x * propScale;
        propScene.position.z = -centerProp.z * propScale;

        const rotorHeight = sizeUpper.y * assemblyScale;
        const rotorBottomY = upperScene.position.y + boxUpper.min.y * assemblyScale;
        const rotorTransitionY = rotorBottomY + rotorHeight * 0.45;
        const rotorTopY = upperScene.position.y + boxUpper.max.y * assemblyScale;
        const shaftHeight = rotorTopY - rotorTransitionY;

        propScene.position.y = rotorTransitionY + shaftHeight * 0.45 - boxProp.min.y * propScale;
        _propSpin.add(propScene);

        [lowerScene, upperScene, propScene].forEach(scn => {
          scn.traverse(c => {
            if (c.isMesh) {
              c.castShadow = true;
              c.receiveShadow = true;
            }
          });
        });
      }).catch(err => {
        console.error(err);
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

      if (_propSpin) _propSpin.rotation.y += 1.5 * dt;
      if (itemGroup) itemGroup.rotation.y += 0.25 * dt;

      _unlRndr.render(_unlScn, _unlCam);
    }
    render();
  }

  function buildTiles(containerId, items, selectedId, specF, onClick) {
    buildSharedTileGrid(containerId, items, {
      isMulti: false,
      selectedIds: selectedId,
      name: containerId,
      idPrefix: `mod2_${containerId}_`,
      specF: specF,
      onSelect: function (item, checked) {
        if (checked && onClick) {
          onClick(item);
        }
      }
    });
  }

  return {
    initEffChart: initEffChart,
    initTachoChart: initTachoChart,
    initThrustChart: initThrustChart,
    updateEffChart: updateCharts,
    renderEffTable: renderTable,
    updateRpmGauge: updateRpm,
    updateCircuitDiagram: updateCircuit,
    updateSankeyDiagram: updateSankey,
    buildTileGrid: buildTiles,
    initUnlockScene: initUnlock
  };
})();
window.Mod2UI = Mod2UI;

// ==========================================
// 7. Module 1 Orchestrator (Assembly & Flight Simulator Page)
// ==========================================
(function () {
  'use strict';

  let _fltChart = null;
  let _chartT = [];
  let _chartA = [];
  let _chartTh = [];
  let _lastUpT = -999.0;

  const _benchState = {
    T_motor: 25.0,
    T_esc: 25.0,
    burnTimer: 0.0,
    cutPower: false,
    throttlePct: 0.0
  };

  const VLAB = {
    db: null,
    state: {
      selections: {
        frame: null,
        motor: null,
        propeller: null,
        battery: null,
        esc: null,
        flight_controller: null,
        receiver: null,
        payloads: []
      },
      altitude_m: 0,
      rho: 1.225,
      mass_budget: null,
      computed: {
        T_required: null,
        T_aero: null,
        op_point: null,
        flight_time: null,
        margin: null
      }
    },
    currentTab: 1,

    resetStand: function () {
      _benchState.T_motor = 25.0;
      _benchState.T_esc = 25.0;
      _benchState.burnTimer = 0.0;
      _benchState.cutPower = false;
      _benchState.throttlePct = 0.0;
      if (window.DroneModel) {
        window.DroneModel.setBurnState(false);
      }
      const slider = document.getElementById('aeroThrottleSlider');
      if (slider) {
        slider.value = 0;
        const text = document.getElementById('aeroThrottleValue');
        if (text) text.textContent = '0%';
      }
    },

    tickStand: function (dt) {
      if (window.VLAB.currentTab !== 2) return;
      
      const sel = window.VLAB.state.selections;
      if (!sel.motor || !sel.propeller || !sel.battery || !sel.esc) return;

      dt = Math.min(dt, 0.03);

      const throttleVal = _benchState.throttlePct / 100.0;
      const nominalV = sel.battery.voltage_nominal_v;
      const propD = sel.propeller.diameter_m;
      const rho = window.VLAB.state.rho;

      const appliedV = _benchState.cutPower ? 0.0 : throttleVal * nominalV;
      const benchMotorCtx = {
        cells: sel.battery.cells,
        capacity_mah: sel.battery.capacity_mah,
        R_esc: (typeof sel.esc.rds_on_ohm === 'number') ? sel.esc.rds_on_ohm : undefined,
        pd: Calc.pitchDiameterRatio(sel.propeller)
      };

      // Pass the live bench temperature so winding resistance rises with heat,
      // same thermal-runaway feedback the flight sim already models.
      const op = Calc.solveOperatingPoint(sel.motor, appliedV, propD, rho, _benchState.T_motor, benchMotorCtx);
      const curr = op ? op.curr : 0.0;
      const rpm = op ? op.rpm : 0.0;
      const thrust_n = op ? op.thrust : 0.0;
      const reqThrust = window.VLAB.state.computed.T_required || 0.0;

      const p_loss = op ? Math.max(0, op.p_elec - op.p_mech) : 0.0;

      // Same real-geometry cooling model as the flight sim (see Calc.motorThermalStep).
      _benchState.T_motor = Calc.motorThermalStep(_benchState.T_motor, p_loss, sel.motor, thrust_n, rho, propD, dt);

      // Same real-part cooling model as the flight sim (see Calc.escThermalStep).
      const esc_limit = sel.esc.current_a || 30.0;
      _benchState.T_esc = Calc.escThermalStep(_benchState.T_esc, curr, sel.esc, dt, esc_limit);

      _benchState.T_motor = Math.min(250.0, Math.max(25.0, _benchState.T_motor));
      _benchState.T_esc = Math.min(180.0, Math.max(25.0, _benchState.T_esc));

      const isOverheat = _benchState.T_motor > 150.0 || _benchState.T_esc > 110.0;
      if (isOverheat && !_benchState.cutPower) {
        if (window.DroneModel) {
          window.DroneModel.setBurnState(true);
        }
        _benchState.burnTimer += dt;
        if (_benchState.burnTimer >= 3.0) {
          _benchState.cutPower = true;
        }
      }

      let statusText = 'OK';
      if (_benchState.cutPower) {
        statusText = 'BURN!';
      } else if (isOverheat) {
        statusText = 'OVERHEAT!';
      } else if (!op) {
        statusText = 'STALL';
      }

      if (window.DroneModel) {
        window.DroneModel.setSimRPM(_benchState.cutPower ? 0 : rpm);
        window.DroneModel.updateThrustStandDisplay(thrust_n, reqThrust, _benchState.cutPower ? 0 : rpm, statusText);
      }

      const standThrust = document.getElementById('standHudMeasured');
      const standReq = document.getElementById('standHudRequired');
      const standRPM = document.getElementById('standHudRPM');
      const standCurrent = document.getElementById('standHudCurrent');
      const standStatus = document.getElementById('standHudStatus');

      if (standThrust) standThrust.textContent = _benchState.cutPower ? 'BURNED / 0.0 N' : (!op ? 'STALL / 0.0 N' : thrust_n.toFixed(4) + ' N');
      if (standReq) standReq.textContent = reqThrust.toFixed(4) + ' N';
      if (standRPM) standRPM.textContent = (_benchState.cutPower ? 0 : Math.round(rpm)) + ' RPM';
      if (standCurrent) standCurrent.textContent = (_benchState.cutPower ? 0.0 : curr).toFixed(1) + ' A';
      
      if (standStatus) {
        if (_benchState.cutPower) {
          standStatus.textContent = 'SYSTEM BURNT!';
          standStatus.style.color = '#ef4444';
          if (window.updateLiveCommentary) window.updateLiveCommentary('ESC BURNT OUT: Actuator drew current exceeding controller safe limits.');
        } else if (isOverheat) {
          const temp = Math.max(_benchState.T_motor, _benchState.T_esc);
          standStatus.textContent = `OVERHEAT: ${Math.round(temp)}°C`;
          standStatus.style.color = '#ef4444';
          if (window.updateLiveCommentary) window.updateLiveCommentary('WARNING: Winding temperature has exceeded safe thresholds.');
        } else if (!op) {
          standStatus.textContent = 'MOTOR STALL!';
          standStatus.style.color = '#ef4444';
          if (window.updateLiveCommentary) window.updateLiveCommentary('STALL: Propeller size is mismatched to this motor bell.');
        } else if (curr > sel.motor.max_current_a || curr > esc_limit) {
          standStatus.textContent = 'WARN: OVERCURRENT';
          standStatus.style.color = '#f59e0b';
          if (window.updateLiveCommentary) window.updateLiveCommentary(`OVERCURRENT: Winding current is ${curr.toFixed(1)}A. Continuous run will trigger thermal shutdown.`);
        } else {
          const maxTemp = Math.max(_benchState.T_motor, _benchState.T_esc);
          standStatus.textContent = `${Math.round(maxTemp)}°C / OK`;
          standStatus.style.color = '#10b981';
          if (window.updateLiveCommentary) {
            if (_benchState.throttlePct <= 0) {
              window.updateLiveCommentary('GUIDE: Modulate the throttle slider below to apply voltage to the motor.');
            } else {
              window.updateLiveCommentary(`RUNNING: System drawing ${curr.toFixed(1)}A at ${_benchState.throttlePct.toFixed(0)}% throttle. Monitoring thermal limits...`);
            }
          }
        }
      }

      const calcB_eval = document.getElementById('calcB_eval');
      if (op) {
        if (calcB_eval) {
          const rps = rpm / 60.0;
          // Print the ACTUAL effective coefficient the engine used (BEMT Ct_eff),
          // not the legacy display constant, so the arithmetic matches the answer.
          const _ctEff = Calc.propCoefficients({
            pitch_diameter_ratio: Calc.pitchDiameterRatio(sel.propeller),
            n_rps: Math.max(rps, 1e-3), D: propD, rho: rho
          }).ct;
          calcB_eval.innerHTML =
            'T_aero = ' + _ctEff.toFixed(5) + ' &times; ' + rho.toFixed(4) + ' kg/m&sup3; &times; (' +
            rps.toFixed(1) + ' rps)&sup2; &times; (' + propD.toFixed(4) + ' m)<sup>4</sup> = ' + thrust_n.toFixed(4) + ' N';
        }
      } else {
        if (calcB_eval) calcB_eval.innerHTML = _benchState.cutPower ? 'ESC Burnt Out!' : 'Motor Stalled';
      }
    },

    init: function () {
      const stored = localStorage.getItem('vlabModule1');
      if (stored) {
        // Migration: if hoverSimDone field missing (old session), treat as done
        try {
          const _s = JSON.parse(stored);
          if (_s.hoverSimDone === undefined) {
            _s.hoverSimDone = true;
            localStorage.setItem('vlabModule1', JSON.stringify(_s));
          }
        } catch(e) {}

        // Only restore the proceed button if hover sim was completed with a passing authority ratio
        try {
          const _storedState = JSON.parse(localStorage.getItem('vlabModule1'));
          if (_storedState.hoverSimDone === true) {
            const nextBtn = document.getElementById('nextModuleContainer');
            if (nextBtn) nextBtn.style.display = 'block';
          }
        } catch (e) { /* ignore */ }
        const configSections = document.getElementById('configSections');
        const configPanelChevron = document.getElementById('configPanelChevron');
        if (configSections && configPanelChevron) {
          configSections.style.display = 'none';
          configPanelChevron.style.transform = 'rotate(-180deg)';
        }
      }

      const configPanelTitle = document.getElementById('configPanelTitle');
      const configSections = document.getElementById('configSections');
      const configPanelChevron = document.getElementById('configPanelChevron');
      if (configPanelTitle && configSections && configPanelChevron) {
        configPanelTitle.addEventListener('click', function() {
          if (configSections.style.display === 'none') {
            configSections.style.display = 'flex';
            configPanelChevron.style.transform = 'rotate(0deg)';
          } else {
            configSections.style.display = 'none';
            configPanelChevron.style.transform = 'rotate(-180deg)';
          }
        });
      }

      Calc.loadCatalog()
        .then(function (db) {
          Calc.manufactureDb(db);
          window.VLAB.db = db;
          UI.buildFromDB(db);
          Scene.init();
          Scene.resize();
          _toggleTab(1);

          const raw = localStorage.getItem('vlabModule1');
          if (raw) {
            setTimeout(function () {
              try {
                const state = JSON.parse(raw);
                // frame/battery are shared fields — Exp 2 may have validly
                // overridden them since this page last saved its own local
                // snapshot. VLABStore is the source of truth for those two;
                // everything else stays exp1's own remembered selection.
                const sharedComponents = (window.VLABStore ? window.VLABStore.get().components : null) || {};
                const mappings = [
                  { cat: 'frame', id: sharedComponents.frameId || state.fId },
                  { cat: 'motor', id: state.mId },
                  { cat: 'propeller', id: state.pId },
                  { cat: 'battery', id: sharedComponents.batteryId || state.bId },
                  { cat: 'esc', id: state.eId },
                  { cat: 'flight_controller', id: state.fcId },
                  { cat: 'receiver', id: state.rId }
                ];

                mappings.forEach(function (m) {
                  if (m.id) {
                    const el = document.getElementById('input_' + m.cat + '_' + m.id);
                    if (el) {
                      el.checked = true;
                      el.dispatchEvent(new Event('change'));
                    }
                  }
                });

                if (Array.isArray(state.pldIds)) {
                  state.pldIds.forEach(function (id) {
                    const el = document.getElementById('input_payload_' + id);
                    if (el) {
                      el.checked = true;
                      el.dispatchEvent(new Event('change'));
                    }
                  });
                }

                if (typeof state.alt === 'number') {
                  window.VLAB.state.altitude_m = state.alt;
                  const altInput = document.getElementById('alt_rng_input');
                  if (altInput) {
                    altInput.value = state.alt;
                    const altVal = document.getElementById('altitudeValue');
                    if (altVal) altVal.textContent = state.alt + ' m';
                    const densVal = document.getElementById('densityValue');
                    if (densVal && typeof state.rho === 'number') {
                      window.VLAB.state.rho = state.rho;
                      densVal.textContent = state.rho.toFixed(4);
                    }
                  }
                }

                Scene.resize();
                _runAnalysisPipeline();
                UI.updateChecklist();
                if (window.UI && window.UI.renderOverrideNotices) window.UI.renderOverrideNotices();

                document.getElementById('tab_test').disabled = false;
                document.getElementById('tab_hover').disabled = false;
              } catch (e) {
                console.error('Failed to restore saved config:', e);
              }
            }, 150);
          }
        })
        .catch(function (err) {
          console.error(err);
        });

      window.addEventListener('resize', function () {
        Scene.resize();
      });

      document.getElementById('tab_build').addEventListener('click', function () {
        _toggleTab(1);
      });

      document.getElementById('tab_test').addEventListener('click', function (e) {
        const comp = window.VLAB.state.computed;
        if (!comp || !comp.margin) {
          e.preventDefault();
          return;
        }
        _toggleTab(2);
      });

      document.getElementById('tab_hover').addEventListener('click', function (e) {
        const comp = window.VLAB.state.computed;
        if (!comp || !comp.margin) {
          e.preventDefault();
          return;
        }
        _toggleTab(3);
      });

      document.getElementById('btn_lock_assembly').addEventListener('click', function () {
        if (window.SFX) window.SFX.lock(); // build locked / confirmed
        _runAnalysisPipeline();

        // Preserve hoverSimDone from existing stored state — only reset it if
        // the component selections have actually changed from what was locked before.
        let _prevHoverSimDone = false;
        try {
          const _prevRaw = localStorage.getItem('vlabModule1');
          if (_prevRaw) {
            const _prev = JSON.parse(_prevRaw);
            const _sameSelections = (
              _prev.fId  === (window.VLAB.state.selections.frame             ? window.VLAB.state.selections.frame.id             : null) &&
              _prev.mId  === (window.VLAB.state.selections.motor             ? window.VLAB.state.selections.motor.id             : null) &&
              _prev.pId  === (window.VLAB.state.selections.propeller         ? window.VLAB.state.selections.propeller.id         : null) &&
              _prev.bId  === (window.VLAB.state.selections.battery           ? window.VLAB.state.selections.battery.id           : null) &&
              _prev.eId  === (window.VLAB.state.selections.esc               ? window.VLAB.state.selections.esc.id               : null) &&
              _prev.fcId === (window.VLAB.state.selections.flight_controller ? window.VLAB.state.selections.flight_controller.id : null) &&
              _prev.rId  === (window.VLAB.state.selections.receiver          ? window.VLAB.state.selections.receiver.id          : null)
            );
            if (_sameSelections) _prevHoverSimDone = !!_prev.hoverSimDone;
          }
        } catch (e) { /* ignore */ }

        const compactState = {
          fId: window.VLAB.state.selections.frame ? window.VLAB.state.selections.frame.id : null,
          mId: window.VLAB.state.selections.motor ? window.VLAB.state.selections.motor.id : null,
          pId: window.VLAB.state.selections.propeller ? window.VLAB.state.selections.propeller.id : null,
          bId: window.VLAB.state.selections.battery ? window.VLAB.state.selections.battery.id : null,
          eId: window.VLAB.state.selections.esc ? window.VLAB.state.selections.esc.id : null,
          fcId: window.VLAB.state.selections.flight_controller ? window.VLAB.state.selections.flight_controller.id : null,
          rId: window.VLAB.state.selections.receiver ? window.VLAB.state.selections.receiver.id : null,
          pldIds: (window.VLAB.state.selections.payloads || []).map(p => p.id),
          T_req: window.VLAB.state.computed.T_required,
          alt: window.VLAB.state.altitude_m,
          rho: window.VLAB.state.rho,
          isLocked: true,
          hoverSimDone: _prevHoverSimDone
        };
        localStorage.setItem('vlabModule1', JSON.stringify(compactState));

        // Mirror the locked design into the unified cross-experiment store.
        // Same publish used by every live selection change (_syncSharedStore)
        // — Lock just guarantees a final, definitely-up-to-date write before
        // navigating away.
        _syncSharedStore();

        // Restore or hide proceed/fail cards based on preserved hover state
        const _nxt = document.getElementById('nextModuleContainer');
        const _fail = document.getElementById('nextModuleFailCard');
        if (_prevHoverSimDone) {
          if (_nxt) _nxt.style.display = 'block';
          if (_fail) _fail.style.display = 'none';
        } else {
          if (_nxt) _nxt.style.display = 'none';
          if (_fail) _fail.style.display = 'none';
        }

        document.getElementById('tab_test').disabled = false;
        document.getElementById('tab_hover').disabled = false;

        const configSections = document.getElementById('configSections');
        const configPanelChevron = document.getElementById('configPanelChevron');
        if (configSections && configPanelChevron) {
          configSections.style.display = 'none';
          configPanelChevron.style.transform = 'rotate(-180deg)';
        }

        _toggleTab(2);
      });

      const aeroSlider = document.getElementById('aeroThrottleSlider');
      const aeroValText = document.getElementById('aeroThrottleValue');
      if (aeroSlider) {
        aeroSlider.addEventListener('input', function () {
          const val = parseInt(aeroSlider.value, 10);
          if (aeroValText) aeroValText.textContent = val + '%';
          _setAeroBenchThrottle(val);
          if (window.SFX) window.SFX.motor(val > 0); // bench motor whir tracks throttle
        });
      }

      document.getElementById('btnPlay').addEventListener('click', function () {
        if (FlightSim.isRunning()) {
          FlightSim.stop();
          if (window.SFX) window.SFX.motor(false);
          const manual = document.getElementById('btnModeManual').classList.contains('active');
          this.textContent = manual ? 'Resume Flight' : 'Resume Hover';
        } else {
          const cfg = _buildSimConfig();
          if (!cfg) return;
          const manual = document.getElementById('btnModeManual').classList.contains('active');
          FlightSim.start(cfg, manual ? 'manual' : 'auto');
          if (window.SFX) { window.SFX.start(); window.SFX.motor(true); }
          this.textContent = 'Pause';
        }
      });

      document.getElementById('btnReset').addEventListener('click', function () {
        FlightSim.reset();
        if (window.SFX) window.SFX.motor(false);
        const manual = document.getElementById('btnModeManual').classList.contains('active');
        document.getElementById('btnPlay').textContent = manual ? 'Start Flight' : 'Start Hover';
        resetChart();
        
        const hoverSlider = document.getElementById('hoverThrottleSlider');
        if (hoverSlider) {
          hoverSlider.value = 0;
          document.getElementById('hoverThrottleValue').textContent = '0%';
          FlightSim.setManualThrottle(0);
        }
      });

      const btnAuto = document.getElementById('btnModeAuto');
      const btnManual = document.getElementById('btnModeManual');
      const manualControls = document.getElementById('manualFlightControls');
      const playBtn = document.getElementById('btnPlay');

      if (btnAuto && btnManual) {
        btnAuto.addEventListener('click', function () {
          if (FlightSim.isRunning()) return;
          btnAuto.classList.add('active');
          btnManual.classList.remove('active');
          if (manualControls) manualControls.style.display = 'none';
          playBtn.textContent = 'Start Hover';
          FlightSim.reset();
        });

        btnManual.addEventListener('click', function () {
          if (FlightSim.isRunning()) return;
          btnManual.classList.add('active');
          btnAuto.classList.remove('active');
          if (manualControls) manualControls.style.display = 'flex';
          playBtn.textContent = 'Start Flight';
          FlightSim.reset();
          _updateHoverMarker();
        });
      }

      const hoverSlider = document.getElementById('hoverThrottleSlider');
      const hoverValText = document.getElementById('hoverThrottleValue');
      if (hoverSlider) {
        hoverSlider.addEventListener('input', function () {
          const val = parseInt(hoverSlider.value, 10);
          if (hoverValText) hoverValText.textContent = val + '%';
          FlightSim.setManualThrottle(val);
        });
      }
    },

    // Exposed so the UI IIFE (a separate closure — _onSelect/_bindEnvSlider)
    // can trigger a live recompute + shared-store sync on every selection
    // change, not just at Lock Assembly. Re-runs the same pipeline Lock
    // uses; no-ops until all 7 fields are picked (see _runAnalysisPipeline's
    // own guard).
    refreshLive: function () { _runAnalysisPipeline(); },
    hasBlockingViolations: function () { return _hasBlockingViolations(); }
  };
  window.VLAB = VLAB;

  // ── Live cross-experiment sync (spec: "the local storage is the vital
  // organ of the lab") ────────────────────────────────────────────────────
  // Every selection change (not just Lock Assembly) mirrors into the shared
  // VLABStore — components AND the exp1 output slice (thrust/current) — so
  // downstream experiments and VLABValidate always see the CURRENT live
  // state, not just whatever was true the last time Lock was clicked.
  let _bannerCtl = null;
  let _lastViolations = [];

  // Publish exp1's canonical outputs (thrust/current/rpm/etc) to the shared
  // store. Was previously inlined only in the Lock Assembly click handler;
  // now also called on every live selection change so C2-C5 validation
  // (ESC/battery/TWR) and downstream experiments react in real time, not
  // just after an explicit Lock.
  function _publishExp1ToStore() {
    if (!window.VLABStore) return;
    const _sel = window.VLAB.state.selections;
    window.VLABStore.setComponents({
      frameId: _sel.frame ? _sel.frame.id : null,
      motorId: _sel.motor ? _sel.motor.id : null,
      propId: _sel.propeller ? _sel.propeller.id : null,
      batteryId: _sel.battery ? _sel.battery.id : null,
      escId: _sel.esc ? _sel.esc.id : null,
      fcId: _sel.flight_controller ? _sel.flight_controller.id : null,
      rxId: _sel.receiver ? _sel.receiver.id : null,
      payloadIds: (_sel.payloads || []).map(function (p) { return p.id; }),
      propBlades: (_sel.propeller && _sel.propeller.blades) ? _sel.propeller.blades : 2
    });
    window.VLABStore.setEnv({ altitude_m: window.VLAB.state.altitude_m });

    if (!(_sel.motor && _sel.propeller && _sel.battery)) return;
    try {
      const _motor = _sel.motor, _prop = _sel.propeller, _batt = _sel.battery;
      const _D = _prop.diameter_m, _rho = window.VLAB.state.rho || 1.225;
      const _esc = _sel.esc;
      const _ctx = {
        cells: _batt.cells,
        capacity_mah: _batt.capacity_mah,
        R_esc: (_esc && typeof _esc.rds_on_ohm === 'number') ? _esc.rds_on_ohm : undefined,
        pd: Calc.pitchDiameterRatio(_prop)
      };
      const _Vnom = _batt.voltage_nominal_v;
      const _opFull = Calc.solveOperatingPoint(_motor, _Vnom, _D, _rho, 25.0, _ctx);
      const _Tmax = _opFull ? _opFull.thrust : 0;
      const _iFull = _opFull ? _opFull.curr : 0;
      const _rpmFull = _opFull ? _opFull.rpm : 0;
      const _Thover = window.VLAB.state.computed.T_required || 0;
      let _iHover = 0, _rpmHover = 0, _uHover = 0;
      if (_Thover > 0) {
        _uHover = Calc.solveHoverThrottle(_motor, _Vnom, _D, _rho, _Thover, 25.0, _ctx);
        const _opH = Calc.solveOperatingPoint(_motor, _uHover * _Vnom, _D, _rho, 25.0, _ctx);
        if (_opH) { _iHover = _opH.curr; _rpmHover = _opH.rpm; }
      }
      const _coeff = Calc.propCoefficients({
        pitch_diameter_ratio: Calc.pitchDiameterRatio(_prop),
        n_rps: Math.max(_rpmFull / 60, 1), D: _D, rho: _rho
      });
      window.VLABStore.finalize('exp1', {
        T_max_per_motor_N: +_Tmax.toFixed(4),
        T_hover_per_motor_N: +(_Thover).toFixed(4),
        hoverCurrent_A: +_iHover.toFixed(3),
        fullCurrent_A: +_iFull.toFixed(3),
        loadedRpm_hover: Math.round(_rpmHover),
        loadedRpm_full: Math.round(_rpmFull),
        motorRm_ohm_25C: _motor.rm_ohm,
        kv_actual: _motor.kv,
        propDefHash: (window.VLAB_CONST && window.VLAB_CONST.hashString)
          ? window.VLAB_CONST.hashString(JSON.stringify({ id: _prop.id, blades: _prop.blades, d: _prop.diameter_m, pitch: _prop.pitch_in }))
          : 0,
        Ct_eff: +_coeff.ct.toFixed(5),
        Cq_eff: +_coeff.cq.toFixed(6),
        hoverThrottle_pct: +(_uHover * 100).toFixed(1),
        totalMass_g: window.VLAB.state.mass_budget ? window.VLAB.state.mass_budget.total_g : null
      });
    } catch (e) { /* shared store is optional; never block the lab */ }
  }

  function _syncSharedStore() {
    if (!window.VLABStore) return;
    _publishExp1ToStore();

    if (!window.VLABUi || !window.VLABValidate) return;
    const catalog = window.VLAB_CATALOG || {};
    const host = document.getElementById('vlBannerHost');
    if (!host) return;

    if (!_bannerCtl) {
      _bannerCtl = window.VLABUi.mountBanner(host, {
        catalog: catalog,
        currentExp: 'exp1',
        onChange: function () { host.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
      });
    }
    const res = _bannerCtl.refresh();
    _lastViolations = (res && res.violations) || [];
    if (window.UI && window.UI.renderOverrideNotices) window.UI.renderOverrideNotices();
  }

  function _hasBlockingViolations() {
    return _lastViolations.some(function (v) { return v.severity === 'error'; });
  }

  function _runAnalysisPipeline() {
    const sel = window.VLAB.state.selections;
    if (!sel.frame || !sel.motor || !sel.propeller || !sel.battery ||
        !sel.esc || !sel.flight_controller || !sel.receiver) {
      return;
    }

    const budget = Calc.massBudget(sel);
    window.VLAB.state.mass_budget = budget;
    UI.showMassBudget(budget);

    const mass_kg = budget.total_kg;
    const rho = window.VLAB.state.rho;
    const propD = sel.propeller.diameter_m;
    const nominalV = sel.battery.voltage_nominal_v;

    const T_req = Calc.requiredHoverThrust(mass_kg);
    window.VLAB.state.computed.T_required = T_req;

    const ctx = {
      cells: sel.battery.cells,
      capacity_mah: sel.battery.capacity_mah,
      R_esc: (typeof sel.esc.rds_on_ohm === 'number') ? sel.esc.rds_on_ohm : undefined,
      pd: Calc.pitchDiameterRatio(sel.propeller)
    };
    const op = Calc.solveOperatingPoint(sel.motor, nominalV, propD, rho, undefined, ctx);
    window.VLAB.state.computed.op_point = op;

    if (!op) return;

    const n_rps = op.rpm / 60.0;
    const T_aero = Calc.aerodynamicThrust(n_rps, propD, rho, ctx.pd);
    window.VLAB.state.computed.T_aero = T_aero;

    const margin = Calc.propulsionMargin(T_req, T_aero);
    window.VLAB.state.computed.margin = margin;

    const flightTime = Calc.hoverFlightTime(sel.battery, sel.motor, T_req, sel.propeller, rho, sel.esc);
    window.VLAB.state.computed.flight_time = flightTime;

    // Live cross-experiment validation fields (spec: real-time fault
    // blocking). These mirror exactly what gets written into
    // VLABStore.finalize('exp1', ...) at Lock time, computed here BEFORE
    // lock too so VLABValidate.check() can gate the Lock button live.
    window.VLAB.state.computed.T_max_per_motor_N = T_aero;
    window.VLAB.state.computed.fullCurrent_A = op.curr;
    if (T_req > 0) {
      const uHover = Calc.solveHoverThrottle(sel.motor, nominalV, propD, rho, T_req, undefined, ctx);
      const opHover = Calc.solveOperatingPoint(sel.motor, uHover * nominalV, propD, rho, undefined, ctx);
      window.VLAB.state.computed.hoverCurrent_A = opHover ? opHover.curr : undefined;
    } else {
      window.VLAB.state.computed.hoverCurrent_A = undefined;
    }

    _syncSharedStore();

    if (window.DroneModel) {
      const activeTab = window.Scene ? window.Scene.getActiveTab() : 1;
      if (activeTab === 1) {
        window.DroneModel.setSimRPM(0);
      } else {
        window.DroneModel.setSimRPM(op.rpm * 0.1);
      }
      window.DroneModel.updateThrustStandDisplay(0.0, T_req, 0.0, 'READY');
    }

    UI.showCalcResults({
      mass_kg: mass_kg,
      rho: rho,
      T_required_n: T_req,
      T_aero_n: T_aero,
      op_point: op,
      margin: margin,
      flight_time: flightTime,
      sel: sel
    });

    const sweepDiameters = [0.1270, 0.1778, 0.2540, 0.3302, 0.4064];
    const targetRPM = op ? op.rpm : 6000;
    const sweepData = Calc.thrustSweep(targetRPM, rho, sweepDiameters);
    UI.showThrustChart(sweepData, T_req, targetRPM);
  }

  function _setAeroBenchThrottle(val) {
    _benchState.throttlePct = val;
  }

  function _buildSimConfig() {
    const comp = window.VLAB.state.computed;
    const sel = window.VLAB.state.selections;

    if (!comp.T_required || !sel.battery || !sel.propeller) {
      return null;
    }

    const energyTotalJ = (sel.battery.capacity_mah / 1000.0) * sel.battery.voltage_nominal_v * 3600.0;

    return {
      motor: sel.motor,
      propeller: sel.propeller,
      battery: sel.battery,
      esc: sel.esc,
      frame: sel.frame,
      rho: window.VLAB.state.rho,
      M_kg: window.VLAB.state.mass_budget.total_kg,
      T_hover_n: comp.T_required,
      hover_rpm: comp.op_point ? comp.op_point.rpm : 1000.0,
      E_total_j: energyTotalJ,
      V_batt: sel.battery.voltage_nominal_v
    };
  }

  function _updateHoverMarker() {
    const sel = window.VLAB.state.selections;
    const comp = window.VLAB.state.computed;
    if (!sel.motor || !sel.battery || !sel.propeller || !comp.T_required) return;

    const u = Calc.solveHoverThrottle(
      sel.motor,
      sel.battery.voltage_nominal_v,
      sel.propeller.diameter_m,
      window.VLAB.state.rho,
      comp.T_required,
      undefined,
      {
        cells: sel.battery.cells,
        capacity_mah: sel.battery.capacity_mah,
        R_esc: (sel.esc && typeof sel.esc.rds_on_ohm === 'number') ? sel.esc.rds_on_ohm : undefined
      }
    );
    const pct = Math.round(u * 100);
    const guide = document.getElementById('hoverThrottleGuide');
    if (guide) {
      guide.textContent = '(Hover: ' + pct + '%)';
    }
  }

  function _toggleTab(tabNum) {
    window.VLAB.currentTab = tabNum;
    Scene.setTab(tabNum);

    // Voice intro on first entry to each tab (revisits silent; ▶ replay button
    // re-plays the current tab's intro on demand).
    if (window.Instructor) {
      window.Instructor.enterTab(tabNum === 1 ? 'intro_assembly' : tabNum === 2 ? 'intro_bench' : 'intro_hover');
    }
    if (window.SFX) window.SFX.motor(false); // stop any motor whir when leaving a running tab

    document.getElementById('tab_build').classList.toggle('active', tabNum === 1);
    document.getElementById('tab_test').classList.toggle('active', tabNum === 2);
    document.getElementById('tab_hover').classList.toggle('active', tabNum === 3);

    document.getElementById('tab_build').setAttribute('aria-selected', tabNum === 1 ? 'true' : 'false');
    document.getElementById('tab_test').setAttribute('aria-selected', tabNum === 2 ? 'true' : 'false');
    document.getElementById('tab_hover').setAttribute('aria-selected', tabNum === 3 ? 'true' : 'false');

    const simControls = document.getElementById('simControls');
    const simHud = document.getElementById('simHud');
    const aeroControls = document.getElementById('aeroControls');
    const standHud = document.getElementById('standHudOverlay');
    const assembleChecklist = document.getElementById('assembleChecklistSection');
    const resultsSection = document.getElementById('resultsSection');

    if (aeroControls) aeroControls.style.display = 'none';
    if (standHud) standHud.style.display = 'none';
    if (simControls) simControls.style.display = 'none';
    if (simHud) simHud.style.display = 'none';

    if (tabNum !== 3) {
      FlightSim.stop();
    }

    if (tabNum === 1) {
      if (assembleChecklist) assembleChecklist.style.display = 'block';
      if (resultsSection) resultsSection.style.display = 'none';
      if (window.DroneModel) {
        window.DroneModel.setSimRPM(0);
      }
      if (window.VLAB.resetStand) window.VLAB.resetStand();
      if (window.Instructor) {
        window.Instructor.loadVideo('instructorVideoSlot', 'videos/assembly_intro.mp4');
        window.updateLiveCommentary(assemblyTip());
      }
    } else if (tabNum === 2) {
      if (assembleChecklist) assembleChecklist.style.display = 'none';
      if (resultsSection) resultsSection.style.display = 'block';
      if (aeroControls) aeroControls.style.display = 'flex';
      if (standHud) standHud.style.display = 'block';

      document.getElementById('flightChartContainer').style.display = 'none';
      document.getElementById('thrustChartContainer').style.display = 'block';

      if (window.VLAB.resetStand) window.VLAB.resetStand();
      _setAeroBenchThrottle(0);
      if (window.Instructor) {
        window.Instructor.loadVideo('instructorVideoSlot', 'videos/bench_test_intro.mp4');
        window.updateLiveCommentary(benchTestTip());
      }
    } else if (tabNum === 3) {
      if (assembleChecklist) assembleChecklist.style.display = 'none';
      if (resultsSection) resultsSection.style.display = 'block';
      if (simControls) simControls.style.display = 'flex';
      if (simHud) simHud.style.display = 'block';

      document.getElementById('flightChartContainer').style.display = 'block';
      document.getElementById('thrustChartContainer').style.display = 'none';
      initChart();
      if (window.Instructor) {
        window.Instructor.loadVideo('instructorVideoSlot', 'videos/hover_flight_intro.mp4');
        window.updateLiveCommentary(hoverFlightTip());
      }

      const manual = document.getElementById('btnModeManual').classList.contains('active');
      document.getElementById('btnPlay').textContent = manual ? 'Start Flight' : 'Start Hover';
      
      _updateHoverMarker();
      FlightSim.reset();

      const hoverSlider = document.getElementById('hoverThrottleSlider');
      if (hoverSlider) {
        hoverSlider.value = 0;
        document.getElementById('hoverThrottleValue').textContent = '0%';
        FlightSim.setManualThrottle(0);
      }
    }

    if (window.Scene && window.Scene.resize) {
      window.Scene.resize();
    }
  }

  function initChart() {
    const canvas = document.getElementById('flightChart');
    if (!canvas) return;

    if (_fltChart) {
      _fltChart.destroy();
      _fltChart = null;
    }

    _chartT = [];
    _chartA = [];
    _chartTh = [];
    _lastUpT = -999.0;

    _fltChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: _chartT,
        datasets: [
          {
            label: 'Altitude (m)',
            data: _chartA,
            borderColor: '#2563eb',
            backgroundColor: 'rgba(37, 99, 235, 0.05)',
            borderWidth: 2,
            pointRadius: 0,
            yAxisID: 'y'
          },
          {
            label: 'Total Thrust (N)',
            data: _chartTh,
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.05)',
            borderWidth: 2,
            pointRadius: 0,
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        plugins: {
          legend: {
            position: 'bottom',
            labels: { boxWidth: 10, padding: 6 }
          }
        },
        scales: {
          x: {
            title: { display: true, text: 'Time (s)', font: { size: 9 } },
            ticks: { font: { family: 'JetBrains Mono', size: 8 } }
          },
          y: {
            title: { display: true, text: 'Altitude (m)', font: { size: 9 } },
            ticks: { font: { family: 'JetBrains Mono', size: 8 } },
            min: 0,
            max: 5
          },
          y1: {
            title: { display: true, text: 'Thrust (N)', font: { size: 9 } },
            position: 'right',
            grid: { drawOnChartArea: false },
            ticks: { font: { family: 'JetBrains Mono', size: 8 } },
            min: 0
          }
        }
      }
    });
  }

  window.updateFlightTelemetryChart = function (time, alt, thrust) {
    if (!_fltChart) return;
    
    if (time - _lastUpT < 1.0) return;
    _lastUpT = time;

    _chartT.push(Math.round(time));
    _chartA.push(alt);
    _chartTh.push(thrust);

    _fltChart.update('none');
  };

  function resetChart() {
    initChart();
  }

  window.updateLiveCommentary = function (text) {
    if (window.Instructor) window.Instructor.say(text);
    else { const el = document.getElementById('liveCommentaryText'); if (el) el.textContent = text; }
  };
})();

// ==========================================
// 8. Module 2 Orchestrator (KV Matching & Power Profiling Page)
// ==========================================
(function () {
  'use strict';

  const VLAB_MOD2 = {
    data: null,
    db: null,
    currentTab: 1,
    targetHoverRPM: 0,
    maxRPM: 0,
    motorParams: { kv: 0, rm_ohm: 0 },
    battParams: { v: 0 },
    propParams: { diam_m: 0 },

    init: function () {
      _startM2();
      if (window.Instructor) window.Instructor.enterTab('intro_kv'); // page intro voice
      const configPanelTitle = document.getElementById('configPanelTitle');
      const configSections = document.getElementById('configSections');
      const configPanelChevron = document.getElementById('configPanelChevron');
      if (configPanelTitle && configSections && configPanelChevron) {
        configPanelTitle.addEventListener('click', function() {
          if (configSections.style.display === 'none') {
            configSections.style.display = 'flex';
            configPanelChevron.style.transform = 'rotate(0deg)';
          } else {
            configSections.style.display = 'none';
            configPanelChevron.style.transform = 'rotate(-180deg)';
          }
        });
      }
    }
  };
  window.VLAB_MOD2 = VLAB_MOD2;

  let _tMotorMod2 = 25.0;
  let _eRemMod2 = 0.0;
  let _eTotMod2 = 0.0;
  let _isInitializingM2 = true;

  function _fmtFrame(f) { return f ? f.wheelbase_mm + 'mm | ' + f.mass_g + 'g' : ''; }
  function _fmtEsc(e) { return e ? e.current_a + 'A | ' + (e.quantity === 1 ? 'Stack' : '4x') + ' | ' + (e.mass_g_each * e.quantity).toFixed(0) + 'g' : ''; }
  function _fmtFc(f) { return f ? f.processor + ' | ' + f.mass_g + 'g' : ''; }
  function _fmtRx(r) { return r ? r.protocol + ' | ' + r.mass_g + 'g' : ''; }
  function _fmtPayload(p) { return p ? p.mass_g + 'g' : ''; }

  function _startM2() {
    const raw = localStorage.getItem('vlabModule1');
    if (!raw) {
      document.getElementById('configSections').innerHTML = `
        <div style="color:var(--danger); padding:15px; font-weight:600;">
          WARNING: Configuration data missing. Returning to Assembly.
        </div>
      `;
      setTimeout(() => { window.location.href = 'index.html'; }, 3000);
      return;
    }

    // Migration: if vlabModule1 exists but has no hoverSimDone field,
    // treat it as done (user completed hover sim before this field was added).
    // Also, if vlabModule2Sweep exists alongside it, the experiments were
    // both completed — honour that state.
    try {
      const _migState = JSON.parse(raw);
      if (_migState.hoverSimDone === undefined) {
        _migState.hoverSimDone = true; // assume done for existing sessions
        localStorage.setItem('vlabModule1', JSON.stringify(_migState));
      }
    } catch(e) {}

    window.VLAB_MOD2.data = JSON.parse(localStorage.getItem('vlabModule1'));

    Calc.loadCatalog()
      .then(db => {
        Calc.manufactureDb(db);
        window.VLAB_MOD2.db = db;
        _reconstructState();
        _buildM2Grids();
        _continueSetup();
      })
      .catch(err => {
        console.error(err);
        document.getElementById('configSections').innerHTML = `<div style="color:var(--danger); padding:15px; font-weight:600;">Database error.</div>`;
      });
  }

  function _reconstructState() {
    const comp = window.VLAB_MOD2.data;
    if (!comp || comp.selections) return;

    const db = window.VLAB_MOD2.db;
    const motor = db.motors.find(m => m.id === comp.mId) || null;
    const propeller = db.propellers.find(p => p.id === comp.pId) || null;
    const battery = db.batteries.find(b => b.id === comp.bId) || null;
    const frame = db.frames.find(f => f.id === comp.fId) || null;
    const esc = db.escs.find(e => e.id === comp.eId) || null;
    const flight_controller = db.flight_controllers.find(fc => fc.id === comp.fcId) || null;
    const receiver = db.receivers.find(r => r.id === comp.rId) || null;
    const payloads = (comp.pldIds || []).map(id => db.payloads.find(p => p.id === id)).filter(Boolean);

    window.VLAB_MOD2.data = {
      selections: { frame, motor, propeller, battery, esc, flight_controller, receiver, payloads },
      computed: { T_required: comp.T_req },
      altitude_m: comp.alt,
      rho: comp.rho
    };
  }

  function _makeSecM2(title, list, cat, specF, isMulti, isLocked, selectedId, onSelectCallback) {
    const parent = document.getElementById('configSections');
    if (!parent) return;

    const g = document.createElement('div');
    g.className = 'config-group';
    g.id = 'group_m2_' + cat;

    const gTitle = document.createElement('div');
    gTitle.className = 'config-group-title';
    gTitle.style.display = 'flex';
    gTitle.style.justifyContent = 'space-between';
    gTitle.style.alignItems = 'center';
    
    if (isLocked) {
      gTitle.innerHTML = `<span>${title}</span><span style="font-size:0.6rem; color:var(--text-tertiary); text-transform:none; font-weight:500;">[Locked]</span>`;
      g.style.opacity = '0.75';
    } else {
      gTitle.textContent = title;
    }
    g.appendChild(gTitle);

    const grid = document.createElement('div');
    grid.className = 'tiles-grid';
    g.appendChild(grid);

    if (!list || list.length === 0) {
      grid.innerHTML = `<div style="font-size:0.7rem; color:var(--text-tertiary); font-style:italic; padding: 4px 6px;">None Selected</div>`;
    } else {
      let selIds = [];
      if (isLocked) {
        selIds = list.map(x => x.id);
      } else {
        selIds = selectedId ? [selectedId] : [];
      }

      buildSharedTileGrid(grid, list, {
        isMulti: isMulti,
        name: 'sel_m2_' + cat,
        idPrefix: 'input_m2_' + cat + '_',
        selectedIds: selIds,
        specF: specF,
        onSelect: isLocked ? null : function (item, checked) {
          if (checked && onSelectCallback) {
            onSelectCallback(item);
          }
        }
      });

      if (isLocked) {
        grid.querySelectorAll('input').forEach(inp => {
          inp.disabled = true;
        });
        grid.querySelectorAll('.component-tile').forEach(tile => {
          tile.style.cursor = 'not-allowed';
          tile.style.pointerEvents = 'none';
          tile.classList.add('selected', 'active');
        });
      }
    }

    parent.appendChild(g);
  }

  function _buildM2Grids() {
    const sel = window.VLAB_MOD2.data.selections;
    const db = window.VLAB_MOD2.db;
    
    const parent = document.getElementById('configSections');
    if (!parent) return;
    parent.innerHTML = ''; // Clear

    // 1. Frame / Chassis (Locked)
    _makeSecM2('Frame / Chassis', [sel.frame], 'frame', _fmtFrame, false, true);

    // 2. Motor (Swappable)
    _makeSecM2('Motor', db.motors, 'motor', (m) => `${m.kv}KV | Rm: ${m.rm_ohm}Ω | I0: ${m.i0_a}A`, false, false, sel.motor.id, (m) => {
      window.VLAB_MOD2.data.selections.motor = m;
      _recalcM2();
    });

    // 3. Propeller (Swappable)
    _makeSecM2('Propeller', db.propellers, 'propeller', (p) => `${p.diameter_in}" | 2-Blade | ${p.mass_g_each}g`, false, false, sel.propeller.id, (p) => {
      window.VLAB_MOD2.data.selections.propeller = p;
      _recalcM2();
    });

    // 4. Battery (Swappable)
    _makeSecM2('Battery', db.batteries, 'battery', (b) => `${b.cells}S | ${b.voltage_nominal_v}V | ${b.capacity_mah}mAh`, false, false, sel.battery.id, (b) => {
      window.VLAB_MOD2.data.selections.battery = b;
      _recalcM2();
    });

    // 5. ESC (Locked)
    _makeSecM2('ESC', [sel.esc], 'esc', _fmtEsc, false, true);

    // 6. Flight Controller (Locked)
    _makeSecM2('Flight Controller', [sel.flight_controller], 'flight_controller', _fmtFc, false, true);

    // 7. Receiver (Locked)
    _makeSecM2('Receiver', [sel.receiver], 'receiver', _fmtRx, false, true);

    // 8. Payloads (Locked)
    _makeSecM2('Payloads', sel.payloads || [], 'payload', _fmtPayload, true, true);
  }

  function _setM2TilesEnabled(enabled) {
    ['motor', 'propeller', 'battery'].forEach(cat => {
      const g = document.getElementById('group_m2_' + cat);
      if (!g) return;
      g.querySelectorAll('input').forEach(inp => { inp.disabled = !enabled; });
      g.style.opacity = enabled ? '' : '0.5';
      g.style.pointerEvents = enabled ? '' : 'none';
    });
  }

  function _bindEnvSliderM2() {
    const slider = document.getElementById('alt_rng_input');
    const valText = document.getElementById('altitudeValue');
    const densText = document.getElementById('densityValue');
    if (!slider) return;

    // Set initial value from window.VLAB_MOD2.data
    const initAlt = window.VLAB_MOD2.data.altitude_m !== undefined ? window.VLAB_MOD2.data.altitude_m : 0;
    slider.value = initAlt;

    function handleInput() {
      const alt = parseInt(slider.value, 10);
      const rho = Calc.airDensity(alt);
      window.VLAB_MOD2.data.altitude_m = alt;
      window.VLAB_MOD2.data.rho = rho;
      
      if (valText) valText.textContent = alt + ' m';
      if (densText) densText.textContent = rho.toFixed(4);

      const pct = (alt / 3000) * 100;
      slider.style.background = 'linear-gradient(to right, #2563eb ' + pct + '%, #e5e7eb ' + pct + '%)';
      
      _recalcM2();
    }

    slider.addEventListener('input', handleInput);
    handleInput();
  }

  function _continueSetup() {
    const sel = window.VLAB_MOD2.data.selections;

    Scene.init();
    if (window.DroneModel) {
      DroneModel.updateFromSelections(sel);
      Scene.setTab(2);
      window.addEventListener('resize', Scene.resize);
      Scene.resize();
    }

    Mod2UI.initEffChart();
    Mod2UI.initTachoChart();
    Mod2UI.initThrustChart();

    document.getElementById('btn_tab_rpm').addEventListener('click', () => _tabToggle(1));
    document.getElementById('btn_tab_eff').addEventListener('click', () => _tabToggle(2));

    const slider = document.getElementById('throttleSlider');
    if (slider) {
      slider.addEventListener('input', _onThrottleInput);
    }

    const sweepBtn = document.getElementById('btn_profile_sweep');
    if (sweepBtn) {
      sweepBtn.addEventListener('click', _triggerSweep);
    }

    _bindEnvSliderM2();
    
    _recalcM2();
    _isInitializingM2 = false;

    // Restore sweep state from local storage if completed
    const sweepRaw = localStorage.getItem('vlabModule2Sweep');
    if (sweepRaw) {
      try {
        const sweepData = JSON.parse(sweepRaw);
        // Only show the unlock card if module 1 hover sim was also completed
        const _m1RestoreRaw = localStorage.getItem('vlabModule1');
        let _hoverSimDone = false;
        try { _hoverSimDone = _m1RestoreRaw ? JSON.parse(_m1RestoreRaw).hoverSimDone === true : false; } catch(e) {}

        if (sweepData && sweepData.isDone && sweepData.dataPoints) {
          const dataPoints = sweepData.dataPoints;
          const nextContainer = document.getElementById('nextModuleContainer');
          if (nextContainer && _hoverSimDone) {
            nextContainer.style.display = 'block';
          }

          let peakEff = 0;
          let peakThr = 0;
          let maxThrust = 0;
          let maxCurrent = 0;
          dataPoints.forEach(p => {
            if (p.efficiency_pct > peakEff) {
              peakEff = p.efficiency_pct;
              peakThr = p.throttle_pct;
            }
            if (p.thrust_n > maxThrust) maxThrust = p.thrust_n;
            if (p.current_a > maxCurrent) maxCurrent = p.current_a;
          });
          document.getElementById('sumPeakEff').textContent = `${peakEff.toFixed(1)}%`;
          document.getElementById('sumPeakEffDesc').textContent = `at ${peakThr}% throttle`;
          document.getElementById('sumMaxThrust').textContent = maxThrust.toFixed(2);
          document.getElementById('sumMaxCurrent').textContent = maxCurrent.toFixed(1);

          const V_batt = window.VLAB_MOD2.battParams.v;
          const D = window.VLAB_MOD2.propParams.diam_m;
          const rho = window.VLAB_MOD2.data.rho;
          const T_req = window.VLAB_MOD2.data.computed.T_required;
          const u_hover = Calc.solveHoverThrottle(sel.motor, V_batt, D, rho, T_req, _tMotorMod2, {
            cells: sel.battery.cells,
            capacity_mah: sel.battery.capacity_mah,
            R_esc: (sel.esc && typeof sel.esc.rds_on_ohm === 'number') ? sel.esc.rds_on_ohm : undefined
          });

          Mod2UI.updateEffChart(dataPoints, u_hover * 100);
          Mod2UI.renderEffTable(dataPoints);

          if (dataPoints.length > 0 && dataPoints[dataPoints.length - 1].efficiency_pct < 45) {
            DroneModel.setBurnState(true);
          }

          _showMsg(`Actuator profiling complete. Peak efficiency reached at ${peakThr}% throttle. Copper winding loss dominates high throttle range.`);

          if (_hoverSimDone && Mod2UI.initUnlockScene) {
            // Defer so the container is visible and canvas has dimensions before WebGL init
            requestAnimationFrame(function() { Mod2UI.initUnlockScene(); });
          }
        }
      } catch (e) {
        console.error("Error restoring sweep data:", e);
      }
    }
  }

  function _recalcM2() {
    const sel = window.VLAB_MOD2.data.selections;
    
    _tMotorMod2 = 25.0;
    _eTotMod2 = (sel.battery && sel.battery.capacity_mah) ? (sel.battery.capacity_mah / 1000.0) * sel.battery.voltage_nominal_v * 3600.0 : 0.0;
    _eRemMod2 = _eTotMod2;

    window.VLAB_MOD2.battParams.v = sel.battery.voltage_nominal_v;
    window.VLAB_MOD2.motorParams.rm_ohm = sel.motor.rm_ohm;
    window.VLAB_MOD2.motorParams.kv = sel.motor.kv;
    window.VLAB_MOD2.propParams.diam_m = sel.propeller.diameter_m;

    window.VLAB_MOD2.maxRPM = window.VLAB_MOD2.motorParams.kv * window.VLAB_MOD2.battParams.v;
    
    // Recalculate mass budget and update table
    const budget = Calc.massBudget(sel);
    if (window.UI && typeof window.UI.showMassBudget === 'function') {
      window.UI.showMassBudget(budget);
    }

    // Recalculate required hover thrust per motor based on the updated mass
    const totalMassKg = budget.total_g / 1000.0;
    const T_req = (totalMassKg * 9.80665) / 4.0;
    window.VLAB_MOD2.data.computed.T_required = T_req;

    const rho = window.VLAB_MOD2.data.rho;
    const m2Pd = Calc.pitchDiameterRatio(sel.propeller);
    window.VLAB_MOD2.targetHoverRPM = Calc.requiredRPS(T_req, window.VLAB_MOD2.propParams.diam_m, rho, m2Pd) * 60.0;

    document.getElementById('sumKV').textContent = window.VLAB_MOD2.motorParams.kv;
    document.getElementById('sumHoverRPM').textContent = Math.round(window.VLAB_MOD2.targetHoverRPM);

    const m2Ctx = {
      cells: sel.battery.cells,
      capacity_mah: sel.battery.capacity_mah,
      R_esc: (sel.esc && typeof sel.esc.rds_on_ohm === 'number') ? sel.esc.rds_on_ohm : undefined,
      pd: m2Pd
    };
    const u_hover = Calc.solveHoverThrottle(sel.motor, window.VLAB_MOD2.battParams.v, window.VLAB_MOD2.propParams.diam_m, rho, T_req, undefined, m2Ctx);
    const op_hover = Calc.solveOperatingPoint(sel.motor, u_hover * window.VLAB_MOD2.battParams.v, window.VLAB_MOD2.propParams.diam_m, rho, undefined, m2Ctx);
    const hoverEffEl = document.getElementById('sumHoverEff');
    
    if (hoverEffEl) {
      if (op_hover) {
        hoverEffEl.textContent = `${op_hover.eff.toFixed(1)}%`;
        const nextEl = hoverEffEl.nextElementSibling;
        if (nextEl) nextEl.textContent = `at ${(u_hover * 100).toFixed(0)}% throttle`;
      } else {
        hoverEffEl.textContent = `—`;
        const nextEl = hoverEffEl.nextElementSibling;
        if (nextEl) nextEl.textContent = `stalled`;
      }
    }
    
    if (window.DroneModel) {
      DroneModel.updateFromSelections(sel);
    }

    // Sync updated choices back to local storage record vlabModule1
    // Preserve hoverSimDone from whatever is currently stored
    let _existingHoverDone = false;
    try {
      const _existingRaw = localStorage.getItem('vlabModule1');
      if (_existingRaw) _existingHoverDone = !!JSON.parse(_existingRaw).hoverSimDone;
    } catch(e) {}

    const compactState = {
      fId: sel.frame ? sel.frame.id : null,
      mId: sel.motor ? sel.motor.id : null,
      pId: sel.propeller ? sel.propeller.id : null,
      bId: sel.battery ? sel.battery.id : null,
      eId: sel.esc ? sel.esc.id : null,
      fcId: sel.flight_controller ? sel.flight_controller.id : null,
      rId: sel.receiver ? sel.receiver.id : null,
      pldIds: (sel.payloads || []).map(p => p.id),
      T_req: T_req,
      alt: window.VLAB_MOD2.data.altitude_m,
      rho: rho,
      hoverSimDone: _existingHoverDone
    };
    localStorage.setItem('vlabModule1', JSON.stringify(compactState));

    if (!_isInitializingM2) {
      localStorage.removeItem('vlabModule2Sweep');
    }

    if (window.VLAB_MOD2.currentTab === 1) {
      _onThrottleInput();
    } else {
      Mod2UI.updateEffChart([]);
      Mod2UI.renderEffTable([]);
      document.getElementById('sweepStatus').textContent = "Components Swapped. Re-run sweep.";
      document.getElementById('sumPeakEff').textContent = `—`;
      document.getElementById('sumMaxThrust').textContent = `—`;
      document.getElementById('sumMaxCurrent').textContent = `—`;
      DroneModel.setSimRPM(0);
      DroneModel.setBurnState(false);
    }
  }

  function _tabToggle(n) {
    window.VLAB_MOD2.currentTab = n;
    
    const t1 = document.getElementById('btn_tab_rpm');
    const t2 = document.getElementById('btn_tab_eff');
    
    if (n === 1) {
      t1.classList.add('active');
      t1.setAttribute('aria-selected', 'true');
      t2.classList.remove('active');
      t2.setAttribute('aria-selected', 'false');
      
      document.getElementById('ctrl_rpm').style.display = 'flex';
      document.getElementById('ctrl_eff').style.display = 'none';
      document.getElementById('calcFlowRpm').style.display = 'flex';
      document.getElementById('calcFlowEff').style.display = 'none';
      document.getElementById('rpmGaugeContainer').style.display = 'block';
      document.getElementById('effChartContainer').style.display = 'none';
      document.getElementById('calcHeaderTitle').textContent = 'Loaded RPM Equations';

      DroneModel.setBurnState(false);
      _onThrottleInput();
    } else {
      t2.classList.add('active');
      t2.setAttribute('aria-selected', 'true');
      t1.classList.remove('active');
      t1.setAttribute('aria-selected', 'false');
      
      document.getElementById('ctrl_rpm').style.display = 'none';
      document.getElementById('ctrl_eff').style.display = 'flex';
      document.getElementById('calcFlowRpm').style.display = 'none';
      document.getElementById('calcFlowEff').style.display = 'flex';
      document.getElementById('rpmGaugeContainer').style.display = 'none';
      document.getElementById('effChartContainer').style.display = 'block';
      document.getElementById('calcHeaderTitle').textContent = 'Actuator Efficiency Equations';

      _renderHUD(0, 0, 0, 0, 0);
      DroneModel.setSimRPM(0);
      DroneModel.setBurnState(false);
      Mod2UI.updateSankeyDiagram(0, 0, 0);
      document.getElementById('calc_eff').innerHTML = `&mdash;`;
      _showMsg("Click 'Run Efficiency Sweep' to step through 30% to 100% throttle. High torque loads may trigger thermal overheat warnings.");
    }
  }

  function _onThrottleInput() {
    if (window.VLAB_MOD2.currentTab !== 1 || !window.VLAB_MOD2.data) return;
    
    const slider = document.getElementById('throttleSlider');
    const txtVal = document.getElementById('throttleValue');
    const pct = parseInt(slider.value, 10);
    txtVal.textContent = `${pct}%`;
    
    const D = window.VLAB_MOD2.propParams.diam_m;
    const rho = window.VLAB_MOD2.data.rho;
    const motor = window.VLAB_MOD2.data.selections.motor;
    const batt = window.VLAB_MOD2.data.selections.battery;

    const freeSpinEl = document.getElementById('valFreeSpin');
    const loadedEl = document.getElementById('valLoaded');
    const lostEl = document.getElementById('valLost');
    
    if (pct === 0) {
      _renderHUD(0, 0, 0, 0, 0);
      DroneModel.setSimRPM(0);
      Mod2UI.updateRpmGauge(0, 0, window.VLAB_MOD2.maxRPM, window.VLAB_MOD2.targetHoverRPM);
      Mod2UI.updateCircuitDiagram(0, 0, 0);
      document.getElementById('calc_nloaded').innerHTML = `n_loaded = &mdash;`;

      if (freeSpinEl) freeSpinEl.textContent = '0 RPM';
      if (loadedEl) loadedEl.textContent = '0 RPM';
      if (lostEl) lostEl.textContent = '0 RPM (0.0%)';
      
      _showMsg("Adjust input throttle to apply active voltage.");
      return;
    }

    const esc = window.VLAB_MOD2.data.selections.esc;
    const cells = batt ? batt.cells : 4;
    const capacity_mah = batt ? batt.capacity_mah : 1500;
    const soc = 0.95; // Assume 95% charge for static slider input
    const V_cell_ocv = Calc.ocvPerCell(soc);
    const V_ocv = cells * V_cell_ocv;
    const R_int = Calc.batteryInternalRSoc(cells, capacity_mah, soc);
    const propSel = window.VLAB_MOD2.data.selections.propeller;
    const motorCtx = {
      cells: cells,
      capacity_mah: capacity_mah,
      pd: Calc.pitchDiameterRatio(propSel),
      R_esc: (esc && typeof esc.rds_on_ohm === 'number') ? esc.rds_on_ohm : undefined
    };

    let V_applied = (pct / 100.0) * V_ocv;
    let op = Calc.solveOperatingPoint(motor, V_applied, D, rho, _tMotorMod2, motorCtx);
    if (op) {
      const I_total = op.curr * 4;
      V_applied = Math.max(cells * 3.0, (pct / 100.0) * (V_ocv - I_total * R_int));
      // V_applied is now the pack's own terminal voltage (already reflects the
      // battery's IR drop via R_int above) — tell the solver not to subtract
      // battery resistance again internally (see effective_resistance()).
      op = Calc.solveOperatingPoint(motor, V_applied, D, rho, _tMotorMod2,
        Object.assign({}, motorCtx, { includeBatteryR: false }));
    }
    
    const freeRpm = motor.kv * V_applied;
    
    if (!op) {
      _renderHUD(pct, V_applied, motor.max_current_a, 0, 0);
      DroneModel.setSimRPM(0);
      Mod2UI.updateRpmGauge(freeRpm, 0, window.VLAB_MOD2.maxRPM, window.VLAB_MOD2.targetHoverRPM);
      Mod2UI.updateCircuitDiagram(V_applied, V_applied, 0);

      if (freeSpinEl) freeSpinEl.textContent = `${Math.round(freeRpm).toLocaleString()} RPM`;
      if (loadedEl) loadedEl.textContent = '0 RPM';
      if (lostEl) lostEl.textContent = `${Math.round(freeRpm).toLocaleString()} RPM (100.0%)`;
      
      _showMsg(`WARNING: ACTUATOR STALLED. Propeller load exceeds motor magnetic authority.`);
      return;
    }
    
    _renderHUD(pct, V_applied, op.curr, op.rpm, op.thrust);
    DroneModel.setSimRPM(op.rpm);
    Mod2UI.updateRpmGauge(freeRpm, op.rpm, window.VLAB_MOD2.maxRPM, window.VLAB_MOD2.targetHoverRPM);
    
    const v_bemf = V_applied - op.v_drop;
    Mod2UI.updateCircuitDiagram(V_applied, op.v_drop, v_bemf);
    
    document.getElementById('calc_nloaded').innerHTML = `n_loaded = ${motor.kv} &times; ${v_bemf.toFixed(2)}V = <strong>${Math.round(op.rpm)} RPM</strong>`;

    const lostRpm = Math.max(0, freeRpm - op.rpm);
    const lostPct = freeRpm > 0 ? (lostRpm / freeRpm) * 100 : 0;
    if (freeSpinEl) freeSpinEl.textContent = `${Math.round(freeRpm).toLocaleString()} RPM`;
    if (loadedEl) loadedEl.textContent = `${Math.round(op.rpm).toLocaleString()} RPM`;
    if (lostEl) lostEl.textContent = `${Math.round(lostRpm).toLocaleString()} RPM (${lostPct.toFixed(1)}%)`;
    
    if (op.rpm >= window.VLAB_MOD2.targetHoverRPM) {
       _showMsg(`SUCCESS: Target hover RPM reached. Phase current is ${op.curr.toFixed(1)}A. Winding drop is ${op.v_drop.toFixed(1)}V.`);
    } else {
       _showMsg(`Motor speed increases with back-EMF voltage (${v_bemf.toFixed(1)}V) after winding drop subtraction.`);
    }
  }

  function _triggerSweep() {
    if (!window.VLAB_MOD2.data) return;
    const V_batt = window.VLAB_MOD2.battParams.v;
    const D = window.VLAB_MOD2.propParams.diam_m;
    const rho = window.VLAB_MOD2.data.rho;
    const motor = window.VLAB_MOD2.data.selections.motor;
    const batt = window.VLAB_MOD2.data.selections.battery;
    const propSel = window.VLAB_MOD2.data.selections.propeller;
    const escSel = window.VLAB_MOD2.data.selections.esc;
    const sweepMotorCtx = {
      cells: batt ? batt.cells : 4,
      capacity_mah: batt ? batt.capacity_mah : 1500,
      pd: Calc.pitchDiameterRatio(propSel),
      R_esc: (escSel && typeof escSel.rds_on_ohm === 'number') ? escSel.rds_on_ohm : undefined
    };
    
    const btn = document.getElementById('btn_profile_sweep');
    const status = document.getElementById('sweepStatus');
    
    btn.disabled = true;
    _setM2TilesEnabled(false);
    status.textContent = "Profiling system...";
    DroneModel.setBurnState(false);
    if (window.SFX) { window.SFX.start(); window.SFX.motor(true); }

    // Reset thermal and state variables at start of sweep
    _tMotorMod2 = 25.0;
    _eRemMod2 = _eTotMod2;
    
    const steps = [30, 40, 50, 60, 70, 80, 90, 100];
    let idx = 0;
    const dataPoints = [];
    
    function processStep() {
      if (idx >= steps.length) {
        btn.disabled = false;
        _setM2TilesEnabled(true);
        status.textContent = "Analysis complete.";
        if (window.SFX) window.SFX.motor(false);
        DroneModel.setSimRPM(0);
        _renderHUD(0, 0, 0, 0, 0);
        Mod2UI.updateSankeyDiagram(0, 0, 0);
        
        let peakEff = 0;
        let peakThr = 0;
        let maxThrust = 0;
        let maxCurrent = 0;
        dataPoints.forEach(p => {
          if (p.efficiency_pct > peakEff) {
            peakEff = p.efficiency_pct;
            peakThr = p.throttle_pct;
          }
          if (p.thrust_n > maxThrust) maxThrust = p.thrust_n;
          if (p.current_a > maxCurrent) maxCurrent = p.current_a;
        });
        document.getElementById('sumPeakEff').textContent = `${peakEff.toFixed(1)}%`;
        document.getElementById('sumPeakEffDesc').textContent = `at ${peakThr}% throttle`;
        document.getElementById('sumMaxThrust').textContent = maxThrust.toFixed(2);
        document.getElementById('sumMaxCurrent').textContent = maxCurrent.toFixed(1);
        
        const T_req = window.VLAB_MOD2.data.computed.T_required;
        const u_hover = Calc.solveHoverThrottle(motor, V_batt, D, rho, T_req, _tMotorMod2, sweepMotorCtx);
        Mod2UI.updateEffChart(dataPoints, u_hover * 100);

        if (dataPoints.length > 0 && dataPoints[dataPoints.length-1].efficiency_pct < 45) {
          DroneModel.setBurnState(true);
        }
        
        _showMsg(`Actuator profiling complete. Peak efficiency reached at ${peakThr}% throttle. Copper winding loss dominates high throttle range.`);
        
        localStorage.setItem('vlabModule2Sweep', JSON.stringify({ isDone: true, dataPoints: dataPoints }));

        // Only show the unlock card if module 1 hover sim was also completed
        const _m1Check = localStorage.getItem('vlabModule1');
        let _hoverDone = false;
        try { _hoverDone = _m1Check ? JSON.parse(_m1Check).hoverSimDone === true : false; } catch(e) {}

        const nextContainer = document.getElementById('nextModuleContainer');
        if (nextContainer && _hoverDone) {
          nextContainer.style.display = 'block';
        }
        if (_hoverDone && Mod2UI.initUnlockScene) {
          // Defer so the container is visible and canvas has dimensions before WebGL init
          requestAnimationFrame(function() { Mod2UI.initUnlockScene(); });
        }
        return;
      }
      
      const thrPct = steps[idx];
      
      // Calculate voltage sag for this step
      const cells = batt ? batt.cells : 4;
      const soc = _eTotMod2 > 0 ? _eRemMod2 / _eTotMod2 : 1.0;
      // Per-cell LiPo OCV per theory.md §5 (centralized helper).
      const V_cell_ocv = Calc.ocvPerCell(soc);
      const V_ocv = cells * V_cell_ocv;
      // Battery internal resistance scales with capacity and SoC per theory.md §3/§5.
      const R_int = Calc.batteryInternalRSoc(cells, sweepMotorCtx.capacity_mah, soc);

      let V_applied = (thrPct / 100.0) * V_ocv;
      let op = Calc.solveOperatingPoint(motor, V_applied, D, rho, _tMotorMod2, sweepMotorCtx);
      if (op) {
        const I_total = op.curr * 4;
        V_applied = Math.max(cells * 3.0, (thrPct / 100.0) * (V_ocv - I_total * R_int));
        // V_applied already reflects the battery's own IR drop (R_int above) —
        // don't let the solver subtract battery resistance a second time.
        op = Calc.solveOperatingPoint(motor, V_applied, D, rho, _tMotorMod2,
          Object.assign({}, sweepMotorCtx, { includeBatteryR: false }));
      }
      
      if (op) {
        const rm_temp = motor.rm_ohm * (1.0 + 0.00393 * (_tMotorMod2 - 20.0));
        const p_copper = op.curr * op.curr * rm_temp;
        
        _eRemMod2 = Math.max(0, _eRemMod2 - op.p_elec * 4 * 0.8);

        const p_loss = Math.max(0, op.p_elec - op.p_mech);
        // Same real-geometry cooling model as the flight sim (see Calc.motorThermalStep).
        _tMotorMod2 = Calc.motorThermalStep(_tMotorMod2, p_loss, motor, op.thrust, rho, D, 0.8);

        dataPoints.push({
          throttle_pct: thrPct,
          rpm: op.rpm,
          efficiency_pct: op.eff,
          thrust_n: op.thrust,
          current_a: op.curr,
          power_elec_w: op.p_elec,
          power_loss_w: p_copper
        });
        
        _renderHUD(thrPct, V_applied, op.curr, op.rpm, op.thrust);
        DroneModel.setSimRPM(op.rpm);
        Mod2UI.updateSankeyDiagram(op.p_elec, op.p_mech, p_copper);
        
        document.getElementById('calc_eff').innerHTML = `&eta;_m = ${op.p_mech.toFixed(1)}W / ${op.p_elec.toFixed(1)}W = <strong>${op.eff.toFixed(1)}%</strong>`;
        
        if (op.eff < 45 || _tMotorMod2 > 150.0) {
          DroneModel.setBurnState(true);
        } else {
          DroneModel.setBurnState(false);
        }
      } else {
         DroneModel.setBurnState(true); 
      }
      
      Mod2UI.updateEffChart(dataPoints);
      Mod2UI.renderEffTable(dataPoints);
      
      idx++;
      setTimeout(processStep, 800);
    }
    
    processStep();
  }

  function _renderHUD(throttlePct, voltage, current, rpm, thrust) {
    document.getElementById('hudThrottle').textContent = throttlePct + '%';
    document.getElementById('hudVoltage').textContent = voltage.toFixed(1) + ' V';
    document.getElementById('hudCurrent').textContent = current.toFixed(1) + ' A';
    document.getElementById('hudRPM').textContent = Math.round(rpm);
    document.getElementById('hudThrust').textContent = thrust.toFixed(2) + ' N';
  }

  function _showMsg(text) {
    // Route through the shared Instructor voice path so Module 2 speaks its
    // guidance (pre-recorded clip where available, else live TTS) exactly like
    // Module 1 — not just silent on-screen text.
    if (window.updateLiveCommentary) { window.updateLiveCommentary(text); return; }
    const panel = document.getElementById('liveCommentaryText');
    if (panel) {
      panel.innerHTML = text;
    }
  }
})();

// ==========================================
// 9. DomContentLoaded Router (Conditional Initializer)
// ==========================================
document.addEventListener('DOMContentLoaded', function () {
  'use strict';
  if (window.Instructor) { window.Instructor.mountFloating(); window.Instructor.initTtsToggle(); }
  if (document.getElementById('btn_lock_assembly')) {
    if (window.VLAB && typeof window.VLAB.init === 'function') {
      window.VLAB.init();
    }
  } else if (window.VLAB_MOD2 && typeof window.VLAB_MOD2.init === 'function') {
    window.VLAB_MOD2.init();
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
    var mq = window.matchMedia('(max-width: 1024px)');
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
