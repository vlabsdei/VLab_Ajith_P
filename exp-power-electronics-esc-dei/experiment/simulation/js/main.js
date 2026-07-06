// ═══════════════════════════════════════════════════════════════════
// Consolidated single-file bundle for Experiment 04 (Power Electronics — ESC).
// One JS file per the lab's coordinator rule (see redesign/README.md §2).
// Order: shared runtime prelude (constants→catalog→store→validation→ui→lab)
// → 3D hardware models (EscBoardModel, EscHwModels) → experiment code.
// ═══════════════════════════════════════════════════════════════════

// ── vendor/constants.js ──────────────────────────────────────────────
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

// ── vendor/catalog.js ────────────────────────────────────────────────
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

// ── vendor/vlab-store.js ─────────────────────────────────────────────
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

// ── vendor/validation.js ─────────────────────────────────────────────
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

// ── vendor/vlab-ui.js ────────────────────────────────────────────────
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

// ── vendor/vlab-lab.js ───────────────────────────────────────────────
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

// ── esc_board_model.js ───────────────────────────────────────────────
// ============================================================================
// esc_board_model.js — hyper-detailed 4-in-1 / single ESC board + outrunner
// motor, built from THREE.js primitives with PBR materials.
//
// Realism comes from: a procedural studio environment map (soft-box reflections),
// layered solder-mask / roughness CanvasTextures, ENIG-gold castellated pads,
// aluminium electrolytic cans, fine QFN leads, silicone wiring, a clamp-on
// finned heatsink, a live MOSFET heat-map (emissive) and overheat smoke.
//
// The motor mirrors Experiment 3's procedural outrunner (bell taper + vents +
// copper coils + stator core + shaft + c-clip).
//
// API (attached to window.EscBoardModel):
//   makeStudioEnv(renderer)  -> envTexture   (assign to scene.environment)
//   build(esc, motor)        -> {
//       group, dims, fets, heatsink, motorGroup,
//       tick(dt, overheating), setTemperature(tC, amb, hot),
//       setHeatsink(on), setRpm(rpm), setExploded(t), dispose()
//   }
// All geometry is in metres (a 4-in-1 board ~0.05 m square).
// ============================================================================
window.EscBoardModel = (function () {
  'use strict';
  const THREE = window.THREE;

  function mat(color, roughness, metalness, extra) {
    const m = new THREE.MeshStandardMaterial(Object.assign({ color: color, roughness: roughness, metalness: metalness }, extra || {}));
    if (m.envMapIntensity !== undefined && (!extra || extra.envMapIntensity === undefined)) m.envMapIntensity = 1.15;
    return m;
  }
  function roundedRect(w, d, r) {
    const s = new THREE.Shape(), x = -w / 2, y = -d / 2;
    r = Math.min(r, Math.min(w, d) / 2);
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
    s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }
  function tube(pts, radius, color, rough) {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'catmullrom', 0.5);
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(48, pts.length * 16), radius, 18, false),
      mat(color, rough === undefined ? 0.5 : rough, 0.02, { envMapIntensity: 0.8 }));
    m.castShadow = true; m.receiveShadow = true; return m;
  }
  function seeded(i) { const x = Math.sin(i * 127.1 + 7.13) * 43758.5453; return x - Math.floor(x); }

  // Perceptual heat ramp: cool board → deep red → orange → white-hot.
  function heatColor(t, amb, hot) {
    const n = Math.max(0, Math.min(1, (t - amb) / (hot - amb)));
    const stops = [[0.05, 0.06, 0.08], [0.55, 0.07, 0.04], [0.98, 0.34, 0.05], [1.0, 0.7, 0.18], [1.0, 0.97, 0.85]];
    const s = n * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(s)), f = s - i;
    const a = stops[i], b = stops[i + 1];
    return { col: new THREE.Color(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f), n: n };
  }

  // ── procedural studio environment map (soft-box reflections) ────────────────
  function makeStudioEnv(renderer) {
    const c = document.createElement('canvas'); c.width = 2048; c.height = 1024;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 1024);
    g.addColorStop(0.00, '#252c36'); g.addColorStop(0.34, '#5a6675');
    g.addColorStop(0.49, '#dfe6ee'); g.addColorStop(0.52, '#c3ccd7');
    g.addColorStop(0.80, '#333b45'); g.addColorStop(1.00, '#171b21');
    x.fillStyle = g; x.fillRect(0, 0, 2048, 1024);
    function box(cx, cy, w, h, a, blur, col) {
      x.save(); x.globalAlpha = a; x.fillStyle = col || '#ffffff';
      x.filter = 'blur(' + (blur || 20) + 'px)'; x.fillRect(cx - w / 2, cy - h / 2, w, h); x.restore();
    }
    box(600, 300, 500, 280, 0.98, 26, '#ffffff');
    box(1480, 250, 400, 210, 0.70, 30, '#eaf1ff');
    box(1024, 120, 320, 130, 0.55, 34, '#fff2df');
    box(300, 520, 220, 46, 0.55, 18, '#ffffff');
    box(1740, 520, 220, 46, 0.50, 18, '#e9f0ff');
    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const pm = new THREE.PMREMGenerator(renderer); pm.compileEquirectangularShader();
    const rt = pm.fromEquirectangular(tex); tex.dispose(); pm.dispose();
    return rt.texture;
  }

  // ── PCB albedo + roughness textures (black solder mask, traces, silkscreen) ──
  function pcbTextures(esc) {
    const N = 1024;
    const alb = document.createElement('canvas'); alb.width = alb.height = N;
    const rgh = document.createElement('canvas'); rgh.width = rgh.height = N;
    const a = alb.getContext('2d'), r = rgh.getContext('2d');
    a.fillStyle = '#0f1a16'; a.fillRect(0, 0, N, N);                 // dark green-black mask
    r.fillStyle = '#8c8c8c'; r.fillRect(0, 0, N, N);
    // copper pour zones (slightly lighter, rougher)
    a.fillStyle = '#12241d';
    [[54, 54, 916, 250], [54, 720, 916, 250]].forEach(([X, Y, W, H]) => a.fillRect(X, Y, W, H));
    r.fillStyle = '#4c4c4c';
    [[54, 54, 916, 250], [54, 720, 916, 250]].forEach(([X, Y, W, H]) => r.fillRect(X, Y, W, H));
    // fanned signal traces
    a.strokeStyle = '#1c3a2f'; a.lineWidth = 2;
    for (let i = 0; i < 64; i++) { a.beginPath(); const y = 70 + i * 13; a.moveTo(120, y); a.lineTo(904, y + (i % 6) * 4 - 10); a.stroke(); }
    // ground grid vias
    a.fillStyle = '#0b1512';
    for (let gx = 90; gx < N - 60; gx += 46) for (let gy = 90; gy < N - 60; gy += 46) { a.beginPath(); a.arc(gx, gy, 3, 0, Math.PI * 2); a.fill(); }
    // silkscreen
    a.textAlign = 'center'; a.fillStyle = '#e7eef4';
    a.font = 'bold 74px Arial'; a.fillText(esc.firmware || 'BLHeli_32', N / 2, N / 2 - 14);
    a.font = '38px Arial'; a.fillText(String(esc.label || 'ESC').replace(/\s*\(x4\)/, ''), N / 2, N / 2 + 40);
    a.font = '25px Arial'; a.fillStyle = '#9bd6bd';
    a.fillText('2-6S  ·  ' + (esc.mosfet_count || 24) + ' MOSFET  ·  vLab', N / 2, N / 2 + 82);
    a.textAlign = 'left'; a.fillStyle = '#dfe8ef'; a.font = 'bold 28px Arial';
    [['M1', 78, 118], ['M2', 78, 470], ['M3', 78, 560], ['M4', 78, 912],
     ['S', 876, 120], ['V+', 862, 470], ['V-', 862, 560], ['G', 884, 912]].forEach(([t, X, Y]) => a.fillText(t, X, Y));
    r.fillStyle = '#d6d6d6'; r.textAlign = 'center'; r.font = 'bold 74px Arial';
    r.fillText(esc.firmware || 'BLHeli_32', N / 2, N / 2 - 14);
    const albTex = new THREE.CanvasTexture(alb); albTex.anisotropy = 8;
    const rghTex = new THREE.CanvasTexture(rgh); rghTex.anisotropy = 8;
    return { map: albTex, roughnessMap: rghTex };
  }

  // ── discrete part builders ──────────────────────────────────────────────────
  function buildMosfet() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.0044, 0.0015, 0.0036), mat(0x20262e, 0.42, 0.28, { emissive: 0x000000 }));
    body.position.y = 0.00075; body.castShadow = true; g.add(body);
    const tab = new THREE.Mesh(new THREE.BoxGeometry(0.0044, 0.0004, 0.0009), mat(0xc7cdd4, 0.3, 0.9));
    tab.position.set(0, 0.0002, 0.0022); g.add(tab);
    const padMat = mat(0xc7cdd4, 0.3, 0.9);
    [-1, 1].forEach((s) => { const p = new THREE.Mesh(new THREE.BoxGeometry(0.0012, 0.0003, 0.0008), padMat); p.position.set(s * 0.0013, 0.00015, -0.002); g.add(p); });
    g.userData.body = body; return g;
  }
  function buildQFN(s, dot) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.2, s), mat(0x15191f, 0.4, 0.28));
    body.position.y = s * 0.1; body.castShadow = true; g.add(body);
    if (dot !== false) { const d = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.07, s * 0.07, 0.0002, 12), mat(0x2b3038, 0.5, 0.2)); d.position.set(-s * 0.33, s * 0.2 + 0.0001, -s * 0.33); g.add(d); }
    const leadMat = mat(0xcdd3da, 0.3, 0.92), per = 11, span = s * 0.82, step = span / (per - 1);
    for (let i = 0; i < per; i++) {
      const off = -span / 2 + i * step;
      [[off, s / 2 + s * 0.03, 0], [off, -s / 2 - s * 0.03, 0], [s / 2 + s * 0.03, off, 1], [-s / 2 - s * 0.03, off, 1]].forEach((L) => {
        const l = new THREE.Mesh(new THREE.BoxGeometry(s * 0.035, s * 0.05, s * 0.085), leadMat);
        l.position.set(L[0], s * 0.04, L[1]); if (L[2]) l.rotation.y = Math.PI / 2; g.add(l);
      });
    }
    return g;
  }
  function buildCap(r, h) {
    const g = new THREE.Group();
    const can = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 48), mat(0x1a1f26, 0.3, 0.8));
    can.position.y = h / 2; can.castShadow = true; g.add(can);
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
    const cx = cv.getContext('2d'); cx.fillStyle = '#12161c'; cx.fillRect(0, 0, 256, 128);
    cx.fillStyle = '#cfd6df'; cx.font = 'bold 26px Arial'; cx.textAlign = 'center';
    cx.fillText('470µF', 128, 44); cx.font = '18px Arial'; cx.fillText('35V', 128, 74);
    cx.strokeStyle = '#7a828c'; cx.lineWidth = 6; cx.beginPath(); cx.moveTo(40, 100); cx.lineTo(216, 100); cx.stroke();
    const tex = new THREE.CanvasTexture(cv);
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.01, r * 1.01, h * 0.86, 48, 1, true), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.48, metalness: 0.2 }));
    sleeve.position.y = h / 2; g.add(sleeve);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.97, r * 0.97, 0.0003, 48), mat(0xbcc3cb, 0.28, 0.88));
    top.position.y = h + 0.00015; g.add(top);
    const vent = mat(0x5c636c, 0.5, 0.5);
    [0, Math.PI / 3, -Math.PI / 3].forEach((an) => { const v = new THREE.Mesh(new THREE.BoxGeometry(r * 1.7, 0.0003, 0.0003), vent); v.position.y = h + 0.0003; v.rotation.y = an; g.add(v); });
    return g;
  }
  function buildJST(n) {
    const g = new THREE.Group();
    const housing = new THREE.Mesh(new THREE.BoxGeometry(n * 0.0011 + 0.001, 0.002, 0.0028), mat(0xf0f2f4, 0.6, 0.05));
    housing.position.y = 0.001; housing.castShadow = true; g.add(housing);
    const pinMat = mat(0xd9b24a, 0.3, 0.9);
    for (let i = 0; i < n; i++) { const pin = new THREE.Mesh(new THREE.BoxGeometry(0.0004, 0.0006, 0.0004), pinMat); pin.position.set(-((n - 1) * 0.0011) / 2 + i * 0.0011, 0.0021, 0.0012); g.add(pin); }
    return g;
  }
  function buildScrew(r) {
    const g = new THREE.Group();
    const standoff = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.3, r * 1.3, 0.004, 6), mat(0x0d1013, 0.5, 0.35));
    standoff.position.y = -0.002; g.add(standoff);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.0012, 18), mat(0x707880, 0.32, 0.92));
    head.position.y = 0.0006; g.add(head);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(r * 1.5, 0.0004, 0.0003), mat(0x2b2f35, 0.5, 0.6));
    slot.position.y = 0.0012; g.add(slot); const slot2 = slot.clone(); slot2.rotation.y = Math.PI / 2; g.add(slot2);
    return g;
  }
  // gold bullet connector oriented along +Z (drone-standard)
  function buildBullet(bootColor, r) {
    const g = new THREE.Group(); const br = (r || 0.0016) * 1.16;
    const boot = new THREE.Mesh(new THREE.CylinderGeometry(br, br * 0.92, 0.006, 22), mat(bootColor, 0.55, 0.05, { envMapIntensity: 0.7 }));
    boot.rotation.x = Math.PI / 2; boot.position.z = 0.0016; boot.castShadow = true; g.add(boot);
    const gold = mat(0xd9a441, 0.22, 0.96, { envMapIntensity: 1.5 });
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(br * 0.7, br * 0.7, 0.0062, 22), gold);
    barrel.rotation.x = Math.PI / 2; barrel.position.z = 0.0072; g.add(barrel);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(br * 0.7, 18, 12), gold);
    tip.position.z = 0.0102; tip.scale.set(1, 1, 0.72); g.add(tip);
    return g;
  }
  // a full lead: silicone wire + bullet auto-oriented onto the wire's end tangent
  function buildLead(pts, radius, wireColor, bootColor) {
    const g = new THREE.Group();
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'catmullrom', 0.5);
    const wire = new THREE.Mesh(new THREE.TubeGeometry(curve, 110, radius, 18, false), mat(wireColor, 0.5, 0.02, { envMapIntensity: 0.8 }));
    wire.castShadow = true; g.add(wire);
    const conn = buildBullet(bootColor === undefined ? wireColor : bootColor, radius);
    conn.position.copy(curve.getPoint(1));
    conn.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), curve.getTangent(1).normalize());
    g.add(conn); return g;
  }

  // integrated crude bell (hidden once the detailed EscHwModels outrunner mounts)
  function buildMotor(motor) {
    const g = new THREE.Group();
    const bellR = 0.016, bellH = 0.013, spin = new THREE.Group(); g.add(spin);
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(bellR, bellR * 0.88, bellH, 48), mat(0x8f9bab, 0.34, 0.85));
    bell.position.y = 0.004 + bellH / 2; bell.castShadow = true; spin.add(bell);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(bellR * 0.6, bellR * 0.6, 0.0008, 40), mat(0xc2410c, 0.4, 0.6));
    cap.position.y = 0.004 + bellH + 0.0004; spin.add(cap);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(bellR * 0.94, bellR * 0.98, 0.004, 40), mat(0x1f2937, 0.45, 0.5));
    base.position.y = 0.002; g.add(base);
    g.userData.spin = spin; g.userData.rpm = 0; return g;
  }

  function build(esc, motor) {
    const board = esc.board_mm || [50, 50, 7];
    const L = board[0] / 1000, W = board[1] / 1000, T = 0.0022;
    const U = Math.max(L, W), hx = L / 2, hz = W / 2;
    const is4 = esc.quantity === 1;
    const root = new THREE.Group();

    const explodeParts = [], labelDefs = [];
    const reg = (obj, off) => { explodeParts.push({ obj: obj, rest: obj.position.clone(), off: new THREE.Vector3(off[0], off[1], off[2]) }); return obj; };
    const label = (name, obj, y) => { labelDefs.push({ name: name, obj: obj, y: y || 0 }); return obj; };
    const anchorOn = (parent, x, y, z) => { const a = new THREE.Object3D(); a.position.set(x, y, z); parent.add(a); return a; };

    // ── FR4 substrate (reference layer — stays put) ──
    const sub = new THREE.Mesh(new THREE.ExtrudeGeometry(roundedRect(L, W, Math.min(L, W) * 0.07), { depth: T, bevelEnabled: false }), mat(0x0d1713, 0.6, 0.05));
    sub.rotation.x = -Math.PI / 2; sub.castShadow = true; sub.receiveShadow = true; root.add(sub);
    label('FR4 Substrate (PCB)', anchorOn(root, -hx * 0.62, T, hz * 0.55), 0);

    // ── solder mask + silkscreen (own explode layer) ──
    const tex = pcbTextures(esc);
    const maskTop = new THREE.Mesh(new THREE.PlaneGeometry(L, W), new THREE.MeshStandardMaterial({ map: tex.map, roughnessMap: tex.roughnessMap, roughness: 1, metalness: 0, envMapIntensity: 0.7 }));
    maskTop.rotation.x = -Math.PI / 2; maskTop.position.y = T + 0.00012; maskTop.receiveShadow = true; root.add(maskTop);
    reg(maskTop, [0, U * 0.14, 0]); label('Solder Mask & Silkscreen', maskTop, 0.001);

    // ── gold castellated edge pads ──
    const padMat = mat(0xd7b24e, 0.3, 0.95);
    const rows = is4 ? 7 : 4; let padAnchor = null;
    for (let i = 0; i < rows; i++) {
      const z = -hz * 0.78 + (i / (rows - 1)) * (W * 0.78);
      [-1, 1].forEach((sgn) => {
        const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0016, T + 0.0004, 12, 1, false, 0, Math.PI), padMat);
        pad.rotation.x = -Math.PI / 2; pad.rotation.z = sgn > 0 ? 0 : Math.PI;
        pad.position.set(sgn * hx, (T + 0.0004) / 2, z); root.add(pad);
        if (sgn > 0 && i === rows - 1) padAnchor = pad;
      });
    }
    if (padAnchor) label('Castellated I/O Pads', padAnchor, 0.001);

    // ── MOSFET banks (fan out along their own axis) ──
    const fets = [];
    const banks = is4
      ? [{ cx: 0, cz: -hz * 0.62, n: 6, ax: 'x', off: [0, U * 0.34, -U * 0.18] },
         { cx: 0, cz: hz * 0.62, n: 6, ax: 'x', off: [0, U * 0.34, U * 0.18] },
         { cx: -hx * 0.62, cz: 0, n: 6, ax: 'z', off: [-U * 0.18, U * 0.34, 0] },
         { cx: hx * 0.62, cz: 0, n: 6, ax: 'z', off: [U * 0.18, U * 0.34, 0] }]
      : [{ cx: 0, cz: -hz * 0.5, n: 3, ax: 'x', off: [0, U * 0.34, -U * 0.18] },
         { cx: 0, cz: hz * 0.5, n: 3, ax: 'x', off: [0, U * 0.34, U * 0.18] }];
    let fetAnchor = null;
    banks.forEach((b, bi) => {
      const bg = new THREE.Group(); bg.position.set(b.cx, 0, b.cz); root.add(bg);
      for (let i = 0; i < b.n; i++) {
        const m = buildMosfet(); const t = (i - (b.n - 1) / 2) * 0.0062;
        if (b.ax === 'x') m.position.set(t, T + 0.00015, 0); else { m.position.set(0, T + 0.00015, t); m.rotation.y = Math.PI / 2; }
        bg.add(m); fets.push(m.userData.body);
      }
      reg(bg, b.off); if (bi === 0) fetAnchor = bg;
    });
    if (fetAnchor) label('Power MOSFETs (×' + (esc.mosfet_count || (is4 ? 24 : 6)) + ')', anchorOn(fetAnchor, 0, T + 0.002, 0), 0);

    // ── central MCU + gate driver ──
    const mcu = buildQFN(is4 ? 0.0094 : 0.0072); mcu.position.set(0, T + 0.00012, 0); root.add(mcu);
    reg(mcu, [0, U * 0.5, 0]); label('MCU / Gate Driver (QFN)', anchorOn(mcu, 0, 0.002, 0), 0);
    if (is4) [[-hx * 0.34, hz * 0.32], [hx * 0.34, -hz * 0.32]].forEach((p) => { const d = buildQFN(0.0042, false); d.position.set(p[0], T + 0.00012, p[1]); root.add(d); reg(d, [p[0] * 0.2, U * 0.42, p[1] * 0.2]); });

    // ── electrolytic capacitors ──
    const capH = is4 ? 0.012 : 0.009, capR = 0.0033, capN = is4 ? 3 : 1; let capAnchor = null;
    for (let i = 0; i < capN; i++) {
      const cap = buildCap(capR, capH); const cx = (i - (capN - 1) / 2) * (capR * 2.3);
      cap.position.set(cx, T + 0.00012, -hz * 0.85); root.add(cap);
      reg(cap, [cx * 0.3, U * 0.62 + i * U * 0.05, -U * 0.06]); if (i === capN - 1) capAnchor = cap;
    }
    if (capAnchor) label(capN > 1 ? 'Electrolytic Capacitors' : 'Electrolytic Capacitor', anchorOn(capAnchor, 0, capH, 0), 0);

    // ── tiny SMD passives (deterministic scatter) ──
    const smdGroup = new THREE.Group(); root.add(smdGroup);
    const smdMat = mat(0x23262b, 0.45, 0.2), smdTan = mat(0x6b5a3a, 0.55, 0.15); let smdAnchor = null;
    for (let i = 0; i < (is4 ? 44 : 18); i++) {
      const sx = (seeded(i) - 0.5) * L * 0.82, sz = (seeded(i + 99) - 0.5) * W * 0.82;
      if (Math.abs(sx) < L * 0.12 && Math.abs(sz) < W * 0.12) continue;
      const smd = new THREE.Mesh(new THREE.BoxGeometry(0.0013, 0.0006, 0.0008), seeded(i + 7) > 0.7 ? smdTan : smdMat);
      smd.position.set(sx, T + 0.0003, sz); smd.rotation.y = seeded(i + 3) > 0.5 ? Math.PI / 2 : 0; smdGroup.add(smd);
      if (sx > L * 0.2 && sz > W * 0.2) smdAnchor = smd;
    }
    if (!smdAnchor) smdAnchor = smdGroup.children[0] || null;
    reg(smdGroup, [0, U * 0.22, 0]); if (smdAnchor) label('SMD Passives (R / C)', smdAnchor, 0.0015);

    // ── white JST signal connector + rainbow ribbon ──
    const connGroup = new THREE.Group(); root.add(connGroup);
    const jst = buildJST(6); jst.position.set(hx * 0.55, T + 0.00012, hz * 0.85); connGroup.add(jst);
    [0x2b6cb0, 0x38a169, 0xe53e3e, 0xd69e2e, 0xffffff, 0x805ad5].forEach((col, i) => {
      const z0 = hz * 0.85 + 0.0007;
      connGroup.add(tube([[hx * 0.55 - 0.003 + i * 0.0011, T + 0.0016, z0], [hx * 0.55 - 0.003 + i * 0.0011, T + 0.004, z0 + 0.006], [hx * 0.4 + i * 0.0011, T + 0.002, z0 + 0.018]], 0.0004, col, 0.7));
    });
    reg(connGroup, [U * 0.12, U * 0.28, U * 0.16]); label('Signal Connector (JST)', anchorOn(jst, 0, 0.002, 0), 0);

    // ── power-input leads red(+)/black(−) → gold bullets (hidden when the
    //    student hand-wires the bare pads on the mapping stage) ──
    const leadsGroup = new THREE.Group(); root.add(leadsGroup);
    const powR = 0.0026;
    const escInPosTerm = [-0.003, T + 0.0028, hz * 0.68];
    const escInNegTerm = [0.003, T + 0.0028, hz * 0.68];
    leadsGroup.add(buildLead([[-0.003, T + 0.0009, hz * 0.68], [-0.003, 0.004, hz + 0.005], [-0.0033, 0.0046, hz + 0.015], [-0.0034, 0.0035, hz + 0.025], [-0.0035, 0.0024, hz + 0.033]], powR, 0xcf2b27));
    leadsGroup.add(buildLead([[0.003, T + 0.0009, hz * 0.68], [0.003, 0.004, hz + 0.005], [0.0033, 0.0046, hz + 0.015], [0.0034, 0.0035, hz + 0.025], [0.0035, 0.0024, hz + 0.033]], powR, 0x141414));
    [-0.003, 0.003].forEach((x) => { const pad = new THREE.Mesh(new THREE.CylinderGeometry(powR * 0.95, powR * 0.95, T + 0.0006, 18), padMat); pad.position.set(x, (T + 0.0006) / 2, hz * 0.68); pad.castShadow = true; leadsGroup.add(pad); });
    const relief = new THREE.Mesh(new THREE.BoxGeometry(0.011, 0.0024, 0.0042), mat(0x14181e, 0.6, 0.05));
    relief.position.set(0, 0.0026, hz + 0.0015); relief.castShadow = true; leadsGroup.add(relief);
    reg(leadsGroup, [0, U * 0.22, U * 0.24]); label('Power Leads · bullet connectors', anchorOn(leadsGroup, 0, 0.007, hz + 0.02), 0);

    // ── corner screws / standoffs ──
    const screwGroup = new THREE.Group(); root.add(screwGroup); let screwAnchor = null;
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => { const s = buildScrew(0.0018); s.position.set(sx * (hx - 0.0032), T + 0.0002, sz * (hz - 0.0032)); screwGroup.add(s); if (sx > 0 && sz > 0) screwAnchor = s; });
    reg(screwGroup, [0, -U * 0.3, 0]); if (screwAnchor) label('Mounting Screws', screwAnchor, 0.001);

    // ── clamp-on heatsink (hidden until fitted) ──
    const heatsink = new THREE.Group();
    const hsW = L * 0.66, hsD = W * 0.66, hsBaseThick = 0.0018, hsBaseY = T + 0.0028;
    const hsBase = new THREE.Mesh(new THREE.BoxGeometry(hsW, hsBaseThick, hsD), mat(0x8d97a3, 0.4, 0.8));
    hsBase.position.set(0, hsBaseY, 0); hsBase.castShadow = true; heatsink.add(hsBase);
    const finN = 9, hsFinH = 0.007, hsFinY = hsBaseY + hsBaseThick / 2 + hsFinH / 2;
    for (let i = 0; i < finN; i++) { const fin = new THREE.Mesh(new THREE.BoxGeometry(hsW * 0.94, hsFinH, 0.0007), mat(0x9aa4af, 0.36, 0.82)); fin.position.set(0, hsFinY, -hsD / 2 + (i + 0.5) * (hsD / finN)); fin.castShadow = true; heatsink.add(fin); }
    heatsink.visible = false; root.add(heatsink);
    reg(heatsink, [0, U * 0.86, 0]); label('Clamp-on Heatsink', anchorOn(heatsink, 0, hsFinY + hsFinH / 2 + 0.001, 0), 0);

    // ── integrated crude motor (hidden once the detailed outrunner mounts) ──
    const motorAssembly = new THREE.Group(); root.add(motorAssembly);
    const motorGroup = buildMotor(motor || { kv: 2300 });
    motorGroup.position.set(-hx - 0.05, 0, 0); motorAssembly.add(motorGroup);
    label('Brushless Motor', anchorOn(motorGroup, 0, 0.02, 0), 0);
    const mx = motorGroup.position.x;
    const phaseLeadsGroup = new THREE.Group(); motorAssembly.add(phaseLeadsGroup);
    [0xcf2b27, 0x141414, 0xd7b24e].forEach((col, i) => {
      const z = (i - 1) * 0.005;
      phaseLeadsGroup.add(buildLead([[-hx, T + 0.0012, z], [-hx - 0.015, 0.0078, z * 0.9], [-hx - 0.03, 0.0082, z * 0.55], [-hx - 0.042, 0.006, z * 0.25], [mx + 0.004, 0.005, 0]], 0.0022, col));
    });
    const escPhaseLocal = [[-hx - 0.002, T + 0.0015, -0.006], [-hx - 0.002, T + 0.0015, 0], [-hx - 0.002, T + 0.0015, 0.006]];

    // ── overheat smoke + reverse-polarity / short destruction ──
    const smoke = []; let spawn = 0, damaged = false, damageSmokeT = 0;
    const _wp = new THREE.Vector3();
    function setDamaged(on) {
      damaged = !!on; damageSmokeT = damaged ? 1.4 : 0;
      fets.forEach((b) => { b.material.color.setHex(damaged ? 0x090909 : 0x20262e); b.material.emissive.setHex(0x000000); b.material.emissiveIntensity = 0; });
    }
    function tick(dt, over) {
      const rpm = motorGroup.userData.rpm;
      if (rpm > 0) motorGroup.userData.spin.rotation.y += dt * Math.min(6, rpm / 2500) * Math.PI * 2;
      if (damaged && damageSmokeT > 0) { damageSmokeT -= dt; over = true; }
      if (over) {
        spawn += dt;
        if (spawn >= 0.05) {
          spawn = 0;
          const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.003, 6, 6), new THREE.MeshBasicMaterial({ color: 0x4b5563, transparent: true, opacity: 0.4, depthWrite: false }));
          const f = fets[Math.floor(Math.random() * fets.length)]; f.getWorldPosition(_wp);
          mesh.position.set(_wp.x, T + 0.005, _wp.z); root.add(mesh);
          smoke.push({ mesh: mesh, v: new THREE.Vector3((Math.random() - 0.5) * 0.01, 0.05 + Math.random() * 0.05, (Math.random() - 0.5) * 0.01), age: 0, max: 1 + Math.random() * 0.6 });
        }
      }
      for (let i = smoke.length - 1; i >= 0; i--) {
        const p = smoke[i]; p.age += dt;
        if (p.age >= p.max) { root.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); smoke.splice(i, 1); }
        else { const t = p.age / p.max; p.mesh.position.addScaledVector(p.v, dt); p.mesh.scale.setScalar(1 + t * 4); p.mesh.material.opacity = 0.4 * (1 - t); }
      }
    }
    function setTemperature(tC, amb, hot) {
      if (damaged) return;
      const a = amb === undefined ? 25 : amb, hi = hot === undefined ? 100 : hot;
      fets.forEach((b, i) => { const local = a + (tC - a) * (0.9 + 0.06 * Math.sin(i * 1.7)); const hc = heatColor(local, a, hi); b.material.emissive.copy(hc.col); b.material.emissiveIntensity = 0.1 + hc.n * 1.3; });
    }
    function setHeatsink(on) { heatsink.visible = !!on; }
    function setMotorVisible(on) { motorAssembly.visible = !!on; }
    function setRpm(rpm) { motorGroup.userData.rpm = rpm || 0; }
    function setLeadsVisible(on) { leadsGroup.visible = !!on; phaseLeadsGroup.visible = !!on; }
    function setExploded(t) { const k = Math.max(0, Math.min(1, t || 0)); explodeParts.forEach((p) => p.obj.position.set(p.rest.x + p.off.x * k, p.rest.y + p.off.y * k, p.rest.z + p.off.z * k)); }
    const _av = new THREE.Vector3();
    function labelAnchors() {
      const out = [];
      for (let i = 0; i < labelDefs.length; i++) {
        const ld = labelDefs[i]; let p = ld.obj, vis = true;
        while (p) { if (p.visible === false) { vis = false; break; } p = p.parent; }
        if (!vis) continue;
        ld.obj.getWorldPosition(_av); out.push({ name: ld.name, x: _av.x, y: _av.y + ld.y, z: _av.z });
      }
      return out;
    }
    function dispose() {
      root.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); if (m.roughnessMap) m.roughnessMap.dispose(); m.dispose(); }); });
    }
    setTemperature(25, 25, 100);
    return {
      group: root, fets: fets, heatsink: heatsink, motorGroup: motorGroup, motorAssembly: motorAssembly, dims: { L: L, W: W, T: T },
      name: String(esc.label || 'ESC').replace(/\s*\(x4\)/, ''),
      terminals: {
        esc_in_pos: { x: escInPosTerm[0], y: escInPosTerm[1], z: escInPosTerm[2] },
        esc_in_neg: { x: escInNegTerm[0], y: escInNegTerm[1], z: escInNegTerm[2] },
        esc_A: { x: escPhaseLocal[0][0], y: escPhaseLocal[0][1], z: escPhaseLocal[0][2] },
        esc_B: { x: escPhaseLocal[1][0], y: escPhaseLocal[1][1], z: escPhaseLocal[1][2] },
        esc_C: { x: escPhaseLocal[2][0], y: escPhaseLocal[2][1], z: escPhaseLocal[2][2] }
      },
      tick: tick, setTemperature: setTemperature, setHeatsink: setHeatsink, setMotorVisible: setMotorVisible,
      setRpm: setRpm, setExploded: setExploded, setLeadsVisible: setLeadsVisible, setDamaged: setDamaged,
      labelAnchors: labelAnchors, dispose: dispose
    };
  }

  return { build: build, buildMotor: buildMotor, makeStudioEnv: makeStudioEnv };
})();

// ── esc_hw_models.js (ground-up rebuild) ────────────────────────────────────
// High-poly drivetrain hardware for the ESC bench: LiPo pack, bench DC supply,
// brushless outrunner and twisted propeller. Rewritten from scratch; same
// public API (window.EscHwModels) so the experiment's wiring/terminals hold.
window.EscHwModels = (function () {
  'use strict';
  const THREE = window.THREE;

  function mat(color, roughness, metalness, extra) {
    const m = new THREE.MeshStandardMaterial(Object.assign({ color: color, roughness: roughness, metalness: metalness }, extra || {}));
    if (m.envMapIntensity !== undefined && (!extra || extra.envMapIntensity === undefined)) m.envMapIntensity = 1.15;
    return m;
  }
  function roundedRectShape(w, d, r) {
    const s = new THREE.Shape(), x = -w / 2, y = -d / 2; r = Math.min(r, Math.min(w, d) / 2);
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
    s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }
  function tube(pts, radius, color, rough) {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(24, pts.length * 12), radius, 16, false), mat(color, rough === undefined ? 0.6 : rough, 0.05));
    m.castShadow = true; return m;
  }

  function makeStudioEnv(renderer) {
    const W = 2048, H = 1024, c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0.00, '#eef2f8'); g.addColorStop(0.32, '#c3ccd7'); g.addColorStop(0.5, '#98a4b1');
    g.addColorStop(0.53, '#7a8695'); g.addColorStop(0.8, '#373f49'); g.addColorStop(1.0, '#1c222a');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    function box(cx, cy, w, h, a, col) { x.save(); x.globalAlpha = a; x.fillStyle = col || '#fff'; x.filter = 'blur(' + Math.round(Math.min(w, h) * 0.2) + 'px)'; x.fillRect(cx - w / 2, cy - h / 2, w, h); x.restore(); }
    box(W * 0.3, H * 0.22, 560, 260, 0.98, '#ffffff'); box(W * 0.72, H * 0.18, 420, 190, 0.85, '#eef4ff');
    box(W * 0.52, H * 0.09, 300, 120, 0.7, '#fff4e6'); box(W * 0.07, H * 0.34, 220, 440, 0.5, '#ffffff');
    box(W * 0.94, H * 0.4, 200, 460, 0.45, '#e8eeff');
    const tex = new THREE.CanvasTexture(c); tex.mapping = THREE.EquirectangularReflectionMapping;
    const pm = new THREE.PMREMGenerator(renderer); pm.compileEquirectangularShader();
    const rt = pm.fromEquirectangular(tex); tex.dispose(); pm.dispose(); return rt.texture;
  }

  // ── XT60 male plug (mating axis +Z) ──
  function buildXT60Male() {
    const g = new THREE.Group(), wX = 0.0084, hY = 0.0084, ch = 0.0026, d = 0.0075;
    const shp = new THREE.Shape();
    shp.moveTo(-wX / 2, -hY / 2); shp.lineTo(wX / 2 - ch, -hY / 2); shp.lineTo(wX / 2, -hY / 2 + ch);
    shp.lineTo(wX / 2, hY / 2); shp.lineTo(-wX / 2, hY / 2); shp.closePath();
    const body = new THREE.Mesh(new THREE.ExtrudeGeometry(shp, { depth: d, bevelEnabled: true, bevelThickness: 0.0004, bevelSize: 0.0004, bevelSegments: 2, steps: 1 }), mat(0xf2c200, 0.5, 0.05));
    body.castShadow = true; g.add(body);
    const pinMat = mat(0xd9a441, 0.24, 0.96);
    [-1, 1].forEach((s) => { const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.0017, 0.0017, d * 1.7, 22), pinMat); pin.rotation.x = Math.PI / 2; pin.position.set(s * 0.0022, 0, d + 0.0009); g.add(pin); });
    return g;
  }

  // ── BATTERY — LiPo pouch pack ──
  function lipoLabel(batt) {
    const S = batt.cells || 4, cap = batt.capacity_mah || 1500, cr = batt.c_rating || 75;
    const V = (batt.voltage_nominal_v || S * 3.7).toFixed(1);
    const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 384; const g = cv.getContext('2d');
    const bg = g.createLinearGradient(0, 0, 1024, 384); bg.addColorStop(0, '#0a0e14'); bg.addColorStop(0.55, '#131a25'); bg.addColorStop(1, '#0a0e14');
    g.fillStyle = bg; g.fillRect(0, 0, 1024, 384);
    g.fillStyle = '#12b886'; g.fillRect(0, 0, 1024, 44);
    g.fillStyle = '#04140f'; g.font = 'bold 30px Arial'; g.textBaseline = 'middle'; g.fillText('vLab  POWER  SYSTEMS', 22, 23);
    g.save(); g.beginPath(); g.rect(760, 0, 264, 44); g.clip();
    for (let i = -20; i < 60; i++) { g.fillStyle = (i % 2) ? '#0a0e14' : '#f2c200'; g.beginPath(); g.moveTo(760 + i * 22, 0); g.lineTo(760 + i * 22 + 22, 0); g.lineTo(760 + i * 22 - 20, 44); g.lineTo(760 + i * 22 - 42, 44); g.closePath(); g.fill(); }
    g.restore();
    g.fillStyle = '#e9eef4'; g.font = 'bold 150px Arial'; g.textBaseline = 'alphabetic'; g.fillText(V + 'V', 40, 214);
    g.fillStyle = '#9fb0c3'; g.font = 'bold 46px Arial'; g.fillText(S + 'S1P  LiPo', 46, 272);
    g.fillStyle = '#12b886'; g.font = 'bold 92px Arial'; g.textAlign = 'right'; g.fillText(cap + ' mAh', 992, 200);
    g.fillStyle = '#ef4444'; g.strokeStyle = '#fff'; g.lineWidth = 4; g.fillRect(742, 236, 250, 88); g.strokeRect(742, 236, 250, 88);
    g.fillStyle = '#fff'; g.font = 'bold 62px Arial'; g.textAlign = 'center'; g.fillText(cr + 'C', 867, 300);
    g.textAlign = 'left'; g.fillStyle = '#7f8ea3'; g.font = '25px Arial'; g.fillText('CONT ' + cr + 'C  ·  BURST ' + (cr * 2) + 'C', 46, 340);
    const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 8; return tex;
  }
  function buildBattery(batt) {
    batt = batt || {}; const S = batt.cells || 4, cap = batt.capacity_mah || 1500;
    const L = 0.048 + (cap / 1500) * 0.026, H = 0.011 + S * 0.0072, D = 0.03 + Math.min(S, 4) * 0.0015;
    const root = new THREE.Group();
    const bevel = Math.min(H, D) * 0.16;
    const body = new THREE.Mesh(new THREE.ExtrudeGeometry(roundedRectShape(L, D, D * 0.14), { depth: H, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, steps: 1 }), mat(0x11151c, 0.34, 0.12, { envMapIntensity: 0.8 }));
    body.rotation.x = -Math.PI / 2; body.position.y = bevel; body.castShadow = true; body.receiveShadow = true; root.add(body);
    const topY = bevel + H;
    const seamMat = mat(0x05070a, 0.6, 0.05);
    for (let i = 1; i < S; i++) { const zx = -L / 2 + (i / S) * L; [-1, 1].forEach((sgn) => { const seam = new THREE.Mesh(new THREE.BoxGeometry(0.0006, H * 0.82, 0.0016), seamMat); seam.position.set(zx, topY / 2 + bevel * 0.2, sgn * (D / 2 + bevel * 0.55)); root.add(seam); }); }
    const label = new THREE.Mesh(new THREE.PlaneGeometry(L * 0.9, D * 0.82), new THREE.MeshStandardMaterial({ map: lipoLabel(batt), roughness: 0.5, metalness: 0.05, envMapIntensity: 0.6 }));
    label.rotation.x = -Math.PI / 2; label.position.set(0, topY + 0.0004, 0); root.add(label);
    const tape = mat(0xb9c2cf, 0.55, 0.08);
    [-0.24, 0.24].forEach((f) => { const band = new THREE.Mesh(new THREE.ExtrudeGeometry(roundedRectShape(0.006, D + bevel * 2 + 0.0006, 0.002), { depth: H + bevel * 1.6, bevelEnabled: false, steps: 1 }), tape); band.rotation.x = -Math.PI / 2; band.position.set(f * L, bevel * 0.2, 0); root.add(band); });
    const leadRoot = new THREE.Group(); root.add(leadRoot);
    const ex = L / 2 + bevel * 0.4, ey = topY - H * 0.22;
    const battPos = [ex + 0.03, ey - 0.004, 0.004], battNeg = [ex + 0.03, ey - 0.004, -0.004];
    leadRoot.add(tube([[ex, ey, 0.006], [ex + 0.014, ey + 0.004, 0.006], battPos], 0.0026, 0xcf2b27));
    leadRoot.add(tube([[ex, ey, -0.006], [ex + 0.014, ey + 0.004, -0.006], battNeg], 0.0026, 0x141414));
    const xt = buildXT60Male(); xt.rotation.y = Math.PI / 2; xt.position.set(ex + 0.03, ey - 0.004, 0); leadRoot.add(xt);
    const balCols = [0x141414, 0xcf2b27, 0xe6a100, 0xd97706, 0x2b6cb0, 0x38a169, 0x805ad5, 0xffffff, 0x9ca3af];
    const bY = topY - H * 0.62;
    const housing = new THREE.Mesh(new THREE.BoxGeometry((S + 1) * 0.0015 + 0.001, 0.004, 0.006), mat(0xf3f5f7, 0.62, 0.03));
    housing.position.set(ex + 0.028, bY, 0.004); leadRoot.add(housing);
    for (let i = 0; i <= S; i++) { const zo = (i - S / 2) * 0.0015; leadRoot.add(tube([[ex, bY, zo], [ex + 0.012, bY + 0.002, zo * 0.8 + 0.004], [ex + 0.024, bY, zo * 0.6 + 0.004]], 0.0005, balCols[i % balCols.length], 0.6)); }
    let plug = 1;
    function setLeadPlugged(t) { plug = Math.max(0, Math.min(1, t)); leadRoot.position.x = (1 - plug) * 0.01; }
    return { group: root, dims: { L: L, H: topY, D: D }, setLeadPlugged: setLeadPlugged, terminals: { batt_pos: { x: battPos[0], y: battPos[1], z: battPos[2] }, batt_neg: { x: battNeg[0], y: battNeg[1], z: battNeg[2] } } };
  }

  // ── MOTOR — brushless outrunner ──
  function buildMotor(motor) {
    motor = motor || {};
    const bellR = (motor.bell_diameter_mm || 28) / 2 / 1000, bellH = (motor.bell_height_mm || 21) / 1000;
    const accent = motor.accent !== undefined ? motor.accent : 0xc2410c;
    const root = new THREE.Group();
    const mountMat = mat(0x2b3038, 0.44, 0.72);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(bellR * 0.5, bellR * 0.55, 0.0022, 40), mountMat); plate.position.y = 0.0011; plate.receiveShadow = true; root.add(plate);
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; const arm = new THREE.Mesh(new THREE.BoxGeometry(bellR * 1.7, 0.0022, 0.004), mountMat); arm.position.y = 0.0011; arm.rotation.y = a; root.add(arm); const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.0011, 0.0011, 0.003, 12), mat(0x0a0c10, 0.6, 0.3)); hole.position.set(Math.cos(a) * bellR * 0.8, 0.0011, Math.sin(a) * bellR * 0.8); root.add(hole); }
    const boss = new THREE.Mesh(new THREE.CylinderGeometry(bellR * 0.2, bellR * 0.22, 0.006, 28), mat(0x3a4048, 0.4, 0.78)); boss.position.y = 0.004; root.add(boss);
    // laminated stator + copper teeth
    const statorBottom = 0.0055, statorH = bellH * 0.5, statorR = bellR * 0.66, lamN = Math.max(8, Math.round(statorH / 0.0006));
    const lamA = mat(0x8a94a3, 0.42, 0.85), lamB = mat(0x727d8c, 0.5, 0.8);
    for (let i = 0; i < lamN; i++) { const disc = new THREE.Mesh(new THREE.CylinderGeometry(statorR, statorR, statorH / lamN * 0.96, 40), (i % 2) ? lamA : lamB); disc.position.y = statorBottom + (i + 0.5) * (statorH / lamN); root.add(disc); }
    const copper = mat(0xb5641e, 0.34, 0.72, { emissive: 0x3a1c08, emissiveIntensity: 0.25 }), enamel = mat(0xd08a3a, 0.3, 0.5);
    for (let t = 0; t < 12; t++) {
      const a = (t / 12) * Math.PI * 2, wg = new THREE.Group();
      wg.position.set(Math.cos(a) * statorR * 1.02, statorBottom + statorH / 2, Math.sin(a) * statorR * 1.02); wg.rotation.y = -a;
      for (let r = 0; r < 5; r++) { const ring = new THREE.Mesh(new THREE.TorusGeometry(statorH * 0.24, 0.0007, 8, 18), (r % 2) ? copper : enamel); ring.rotation.y = Math.PI / 2; ring.position.y = (r - 2) * (statorH * 0.34 / 5); wg.add(ring); }
      root.add(wg);
    }
    // spinning bell
    const spin = new THREE.Group(); root.add(spin);
    const bellBottom = 0.004, bellTop = bellBottom + bellH;
    const prof = [new THREE.Vector2(bellR * 0.995, bellBottom), new THREE.Vector2(bellR, bellBottom + 0.0006), new THREE.Vector2(bellR, bellTop - bellH * 0.18), new THREE.Vector2(bellR * 0.92, bellTop - bellH * 0.06), new THREE.Vector2(bellR * 0.62, bellTop), new THREE.Vector2(bellR * 0.2, bellTop + 0.0006), new THREE.Vector2(bellR * 0.09, bellTop + 0.0006)];
    const bell = new THREE.Mesh(new THREE.LatheGeometry(prof, 56), mat(0x1f242b, 0.33, 0.86, { emissive: accent, emissiveIntensity: 0.05 })); bell.castShadow = true; spin.add(bell);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(bellR * 1.005, bellR * 1.005, bellH * 0.09, 56, 1, true), mat(accent, 0.36, 0.7, { emissive: accent, emissiveIntensity: 0.18 })); ring.position.y = bellBottom + bellH * 0.14; spin.add(ring);
    const topCap = new THREE.Mesh(new THREE.CylinderGeometry(bellR * 0.62, bellR * 0.62, 0.0006, 44), mat(accent, 0.38, 0.66, { emissive: accent, emissiveIntensity: 0.12 })); topCap.position.y = bellTop + 0.0004; spin.add(topCap);
    const ventMat = mat(0x05070a, 0.8, 0.1);
    for (let h = 0; h < 6; h++) { const a = (h / 6) * Math.PI * 2; const vent = new THREE.Mesh(new THREE.CylinderGeometry(bellR * 0.1, bellR * 0.1, 0.0016, 18), ventMat); vent.position.set(Math.cos(a) * bellR * 0.4, bellTop + 0.0002, Math.sin(a) * bellR * 0.4); spin.add(vent); }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(bellR * 0.24, bellR * 0.26, 0.004, 26), mat(0x2a2f36, 0.4, 0.8)); hub.position.y = bellTop + 0.002; spin.add(hub);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, bellH * 1.5, 26), mat(0xdfe5ec, 0.2, 0.95)); shaft.position.y = bellTop + bellH * 0.35; spin.add(shaft);
    const clip = new THREE.Mesh(new THREE.TorusGeometry(0.0028, 0.0006, 8, 18), mat(0xc7ccd3, 0.24, 0.9)); clip.rotation.x = Math.PI / 2; clip.position.y = bellTop + bellH * 0.72; spin.add(clip);
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.0042, 0.0042, 0.004, 6), mat(accent, 0.34, 0.72, { emissive: accent, emissiveIntensity: 0.12 })); nut.position.y = bellTop + bellH * 0.5; spin.add(nut);
    // phase leads with bullets
    const phaseLeadsGroup = new THREE.Group(); root.add(phaseLeadsGroup);
    const phaseCols = [0xcf2b27, 0x141414, 0xd7b24e], phaseIds = ['mot_U', 'mot_V', 'mot_W'], terminals = {};
    phaseCols.forEach((col, i) => {
      const a = (i - 1) * 0.5, ox = Math.cos(a + Math.PI) * bellR * 0.5, oz = Math.sin(a + Math.PI) * bellR * 0.5;
      phaseLeadsGroup.add(tube([[ox, 0.001, oz], [ox * 1.8 - 0.004, -0.006, oz * 1.8], [ox * 2.4 - 0.012, -0.014, oz * 2.2]], 0.0021, col, 0.6));
      const bullet = new THREE.Mesh(new THREE.CylinderGeometry(0.0026, 0.0026, 0.007, 16), mat(0xd9a441, 0.28, 0.95)); bullet.position.set(ox * 2.4 - 0.014, -0.016, oz * 2.2); bullet.rotation.z = Math.PI / 2.2; phaseLeadsGroup.add(bullet);
      terminals[phaseIds[i]] = { x: ox, y: 0.001, z: oz };
    });
    spin.userData.rpm = 0;
    function setRpm(rpm) { spin.userData.rpm = rpm || 0; }
    function tick(dt) { const rpm = spin.userData.rpm || 0; if (rpm !== 0) spin.rotation.y += dt * Math.min(8, Math.abs(rpm) / 2200) * Math.PI * 2 * Math.sign(rpm); }
    function setLeadsVisible(on) { phaseLeadsGroup.visible = !!on; }
    return { group: root, spin: spin, dims: { bellR: bellR, bellH: bellH, top: bellTop }, terminals: terminals, setRpm: setRpm, tick: tick, setLeadsVisible: setLeadsVisible };
  }

  // ── PROPELLER — twisted, tapered, cambered blades ──
  function airfoil(chord, thick, camber, S) {
    const pts = [];
    function yt(s) { return 5 * thick * (0.2969 * Math.sqrt(s) - 0.126 * s - 0.3516 * s * s + 0.2843 * s * s * s - 0.1015 * s * s * s * s); }
    function yc(s) { return camber * 4 * s * (1 - s); }
    for (let i = 0; i <= S; i++) { const s = i / S; pts.push([(0.5 - s) * chord, yc(s) + yt(s) / 2]); }
    for (let i = S - 1; i >= 1; i--) { const s = i / S; pts.push([(0.5 - s) * chord, yc(s) - yt(s) / 2]); }
    return pts;
  }
  function buildBlade(radius, hubR, baseChord, dirSign, bladeMat, tipMat, pitch_m) {
    const NST = 24, S = 12, M = 2 * S, verts = [], idx = [];
    for (let j = 0; j <= NST; j++) {
      const t = j / NST, r = hubR + (radius - hubR) * t;
      let chord = baseChord * (0.55 + 0.6 * Math.sin(Math.PI * Math.pow(Math.min(t, 0.999), 0.7)) - 0.32 * t);
      if (t > 0.9) chord *= Math.max(0.12, 1 - (t - 0.9) / 0.1 * 0.9);
      chord = Math.max(chord, baseChord * 0.1);
      const thick = 0.11 * baseChord * (1 - t) + 0.015 * baseChord * t, camber = 0.06 * chord * (1 - t) + 0.012 * chord * t;
      const phi = Math.atan2(pitch_m, 2 * Math.PI * Math.max(r, 1e-4)) * dirSign, cs = Math.cos(phi), sn = Math.sin(phi);
      const c2d = airfoil(chord, thick, camber, S);
      for (let k = 0; k < M; k++) { const zc = c2d[k][0], yc2 = c2d[k][1]; verts.push(r, yc2 * cs - zc * sn, yc2 * sn + zc * cs); }
    }
    for (let j = 0; j < NST; j++) { const a = j * M, b = (j + 1) * M; for (let k = 0; k < M; k++) { const k2 = (k + 1) % M; idx.push(a + k, a + k2, b + k, a + k2, b + k2, b + k); } }
    const lastStart = NST * M; let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < M; k++) { cx += verts[(lastStart + k) * 3]; cy += verts[(lastStart + k) * 3 + 1]; cz += verts[(lastStart + k) * 3 + 2]; }
    const cIdx = verts.length / 3; verts.push(cx / M, cy / M, cz / M);
    for (let k = 0; k < M; k++) { const k2 = (k + 1) % M; idx.push(lastStart + k, cIdx, lastStart + k2); }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); geom.setIndex(idx);
    const band = 3, mainCount = (NST - band) * M * 6;
    geom.addGroup(0, mainCount, 0); geom.addGroup(mainCount, band * M * 6 + M * 3, 1); geom.computeVertexNormals();
    const mesh = new THREE.Mesh(geom, [bladeMat, tipMat]); mesh.castShadow = true;
    const blade = new THREE.Group(); blade.add(mesh); return blade;
  }
  function buildPropeller(prop, opts) {
    prop = prop || {}; opts = opts || {};
    const R = (prop.diameter_m || 0.1524) / 2, blades = Math.max(2, Math.min(4, prop.blades || 2));
    const pitch_m = (prop.pitch_in || 4.5) * 0.0254, dirSign = opts.spinDir === -1 ? -1 : 1;
    const hubR = R * 0.1, baseChord = R * 0.17, root = new THREE.Group(), spin = new THREE.Group(); root.add(spin);
    const bladeMat = mat(opts.color !== undefined ? opts.color : 0x161a20, 0.28, 0.14, { envMapIntensity: 1.15, side: THREE.DoubleSide });
    const tipMat = mat(0xef4444, 0.26, 0.1, { emissive: 0x5c1414, emissiveIntensity: 0.3, side: THREE.DoubleSide });
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(hubR, hubR * 1.12, R * 0.09, 32), bladeMat); hub.castShadow = true; spin.add(hub);
    const bore = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.032, R * 0.032, R * 0.1, 22), mat(0x05070a, 0.7, 0.3)); spin.add(bore);
    const washer = new THREE.Mesh(new THREE.CylinderGeometry(hubR * 0.72, hubR * 0.72, R * 0.02, 26), mat(0x2a2f36, 0.4, 0.7)); washer.position.y = R * 0.05; spin.add(washer);
    for (let b = 0; b < blades; b++) { const bl = buildBlade(R, hubR * 0.9, baseChord, dirSign, bladeMat, tipMat, pitch_m); bl.rotation.y = b * (Math.PI * 2 / blades); spin.add(bl); }
    const disc = new THREE.Mesh(new THREE.CircleGeometry(R * 1.01, 48), new THREE.MeshBasicMaterial({ color: 0x9aa3b2, transparent: true, opacity: 0.04, side: THREE.DoubleSide, depthWrite: false })); disc.rotation.x = -Math.PI / 2; disc.position.y = R * 0.01; spin.add(disc);
    spin.userData.rpm = 0;
    function setRpm(rpm) { spin.userData.rpm = rpm || 0; }
    function tick(dt) { const rpm = spin.userData.rpm || 0; if (rpm > 0) spin.rotation.y += dt * Math.min(9, rpm / 2000) * Math.PI * 2 * dirSign; }
    return { group: root, spin: spin, dims: { R: R, blades: blades, pitch_m: pitch_m }, setRpm: setRpm, tick: tick };
  }

  // ── BENCH DC POWER SUPPLY — lit 7-seg V/A display + knobs + posts ──
  const SEG = { '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgecd', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', ' ': '' };
  function segBar(ctx, x, y, len, th, horiz) {
    const h = th / 2; ctx.beginPath();
    if (horiz) { ctx.moveTo(x - len / 2 + h, y - h); ctx.lineTo(x + len / 2 - h, y - h); ctx.lineTo(x + len / 2, y); ctx.lineTo(x + len / 2 - h, y + h); ctx.lineTo(x - len / 2 + h, y + h); ctx.lineTo(x - len / 2, y); }
    else { ctx.moveTo(x - h, y - len / 2 + h); ctx.lineTo(x - h, y + len / 2 - h); ctx.lineTo(x, y + len / 2); ctx.lineTo(x + h, y + len / 2 - h); ctx.lineTo(x + h, y - len / 2 + h); ctx.lineTo(x, y - len / 2); }
    ctx.closePath(); ctx.fill();
  }
  function segDigit(ctx, x0, y0, dw, dh, ch, onCol, offCol) {
    const t = dw * 0.17, lenH = dw - t * 1.8, lenV = dh / 2 - t * 1.6, cx = x0 + dw / 2, on = SEG[ch] !== undefined ? SEG[ch] : '';
    function s(name, px, py, len, horiz) { const lit = on.indexOf(name) >= 0; ctx.fillStyle = lit ? onCol : offCol; ctx.shadowColor = lit ? onCol : 'rgba(0,0,0,0)'; ctx.shadowBlur = lit ? t * 1.5 : 0; segBar(ctx, px, py, len, t, horiz); }
    s('a', cx, y0 + t, lenH, true); s('g', cx, y0 + dh / 2, lenH, true); s('d', cx, y0 + dh - t, lenH, true);
    s('f', x0 + t, y0 + dh * 0.27, lenV, false); s('b', x0 + dw - t, y0 + dh * 0.27, lenV, false);
    s('e', x0 + t, y0 + dh * 0.73, lenV, false); s('c', x0 + dw - t, y0 + dh * 0.73, lenV, false);
    ctx.shadowBlur = 0;
  }
  function segReadout(ctx, str, x, y, dw, dh, gap, onCol, offCol) {
    let cx = x;
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (ch === '.') { const r = dw * 0.1; ctx.fillStyle = onCol; ctx.shadowColor = onCol; ctx.shadowBlur = r * 2; ctx.beginPath(); ctx.arc(cx + gap * 0.4, y + dh - r * 1.2, r, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0; cx += gap * 1.2; continue; }
      segDigit(ctx, cx, y, dw, dh, ch, onCol, offCol); cx += dw + gap;
    }
    return cx;
  }
  function drawDc(canvas, st) {
    const W = canvas.width, H = canvas.height, g = canvas.getContext('2d');
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#0a120e'); bg.addColorStop(0.5, '#0c1713'); bg.addColorStop(1, '#070b09');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillStyle = '#2fbf86'; g.font = 'bold ' + Math.round(H * 0.085) + 'px Consolas, monospace'; g.fillText('vLab  DC POWER', W * 0.03, H * 0.085);
    const stat = st.on ? '#37e58f' : '#274a3b'; g.fillStyle = stat; g.shadowColor = stat; g.shadowBlur = st.on ? 20 : 0; g.beginPath(); g.arc(W * 0.8, H * 0.083, H * 0.028, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0;
    g.fillStyle = st.on ? '#bfead9' : '#3f6255'; g.font = 'bold ' + Math.round(H * 0.055) + 'px Consolas, monospace'; g.fillText('OUTPUT', W * 0.83, H * 0.086);
    const green = '#3dfca0', greenOff = 'rgba(34,80,58,0.6)', amber = '#ffb43a', amberOff = 'rgba(110,64,18,0.55)', dw = H * 0.17, dh = H * 0.32, gap = H * 0.05;
    segReadout(g, st.volts.toFixed(2), W * 0.05, H * 0.22, dw, dh, gap, green, greenOff);
    g.fillStyle = green; g.shadowColor = green; g.shadowBlur = 12; g.font = 'bold ' + Math.round(H * 0.13) + 'px Consolas, monospace'; g.fillText('V', W * 0.82, H * 0.22 + dh / 2); g.shadowBlur = 0;
    g.fillStyle = (st.mode === 'CV') ? green : greenOff; g.font = 'bold ' + Math.round(H * 0.055) + 'px Consolas, monospace'; g.fillText('CV', W * 0.92, H * 0.24);
    segReadout(g, st.amps.toFixed(2), W * 0.05, H * 0.6, dw, dh, gap, amber, amberOff);
    g.fillStyle = amber; g.shadowColor = amber; g.shadowBlur = 12; g.font = 'bold ' + Math.round(H * 0.13) + 'px Consolas, monospace'; g.fillText('A', W * 0.82, H * 0.6 + dh / 2); g.shadowBlur = 0;
    g.fillStyle = (st.mode === 'CC') ? amber : amberOff; g.font = 'bold ' + Math.round(H * 0.055) + 'px Consolas, monospace'; g.fillText('CC', W * 0.92, H * 0.62);
    const vg = g.createRadialGradient(W * 0.5, H * 0.5, H * 0.15, W * 0.5, H * 0.5, W * 0.62); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.5)'); g.fillStyle = vg; g.fillRect(0, 0, W, H);
  }
  function brushedMetal() {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 512; const c = cv.getContext('2d');
    c.fillStyle = '#c6cad0'; c.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 1400; i++) { const y = Math.random() * 512, a = 0.02 + Math.random() * 0.05; c.strokeStyle = (Math.random() > 0.5 ? 'rgba(255,255,255,' : 'rgba(88,94,102,') + a + ')'; c.beginPath(); c.moveTo(0, y); c.lineTo(512, y + (Math.random() - 0.5) * 1.5); c.stroke(); }
    const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return new THREE.MeshStandardMaterial({ map: tex, color: 0xffffff, roughness: 0.32, metalness: 0.86, envMapIntensity: 1.3 });
  }
  function buildDcSupply(opts) {
    opts = opts || {}; const W = 0.11, H = 0.066, D = 0.09, root = new THREE.Group();
    const caseMat = mat(0x2f353c, 0.48, 0.68, { envMapIntensity: 1.25 }), panelMat = brushedMetal(), darkMat = mat(0x0f1216, 0.55, 0.4);
    const knobMat = mat(0x191c21, 0.4, 0.55, { envMapIntensity: 1.15 }), knobCap = mat(0x0b0d10, 0.32, 0.5);
    const bevel = Math.min(H, D) * 0.06;
    const body = new THREE.Mesh(new THREE.ExtrudeGeometry(roundedRectShape(W, H, H * 0.06), { depth: D, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, steps: 1 }), caseMat);
    body.position.set(0, H / 2, -D / 2); body.castShadow = true; body.receiveShadow = true; root.add(body);
    const frontZ = D / 2 + bevel, panelZ = frontZ + 0.0015;
    const panel = new THREE.Mesh(new THREE.ExtrudeGeometry(roundedRectShape(W * 0.95, H * 0.88, H * 0.05), { depth: 0.0016, bevelEnabled: true, bevelThickness: 0.0005, bevelSize: 0.0005, bevelSegments: 2, steps: 1 }), panelMat);
    panel.position.set(0, H / 2, frontZ - 0.0004); root.add(panel);
    const dCx = -W * 0.06, dCy = H * 0.64, dispW = W * 0.62, dispH = H * 0.4;
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(dispW * 1.14, dispH * 1.28, 0.005), darkMat); bezel.position.set(dCx, dCy, panelZ + 0.0006); root.add(bezel);
    const dcv = document.createElement('canvas'); dcv.width = 1024; dcv.height = 400; const dispTex = new THREE.CanvasTexture(dcv); dispTex.anisotropy = 8;
    const disp = new THREE.Mesh(new THREE.PlaneGeometry(dispW, dispH), new THREE.MeshStandardMaterial({ map: dispTex, emissive: 0xffffff, emissiveMap: dispTex, emissiveIntensity: 1.25, roughness: 0.3, metalness: 0 })); disp.position.set(dCx, dCy, panelZ + 0.0034); root.add(disp);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(dispW * 1.1, dispH * 1.22), new THREE.MeshStandardMaterial({ color: 0x0a0d0c, roughness: 0.07, metalness: 0, transparent: true, opacity: 0.16, envMapIntensity: 1.5 })); glass.position.set(dCx, dCy, panelZ + 0.0052); root.add(glass);
    function buildKnob(x, y, r, ringCol) {
      const kg = new THREE.Group(); kg.position.set(x, y, panelZ);
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.28, r * 1.32, 0.0016, 36), mat(ringCol, 0.4, 0.2, { emissive: ringCol, emissiveIntensity: 0.35 })); ring.rotation.x = Math.PI / 2; ring.position.z = -0.0006; kg.add(ring);
      const skirt = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.04, 0.007, 36), knobMat); skirt.rotation.x = Math.PI / 2; skirt.position.z = 0.0035; kg.add(skirt);
      for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; const n = new THREE.Mesh(new THREE.BoxGeometry(0.0011, 0.007, 0.0011), knobCap); n.position.set(Math.cos(a) * r, Math.sin(a) * r, 0.0035); n.rotation.z = a; kg.add(n); }
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r * 0.8, 0.006, 32), knobCap); cap.rotation.x = Math.PI / 2; cap.position.z = 0.0075; kg.add(cap);
      const ptr = new THREE.Mesh(new THREE.BoxGeometry(r * 0.12, r * 0.72, 0.0012), mat(0xe9eef4, 0.4, 0.1, { emissive: 0x555b62, emissiveIntensity: 0.2 })); ptr.position.set(0, r * 0.42, 0.011); kg.add(ptr);
      root.add(kg); return kg;
    }
    const vKnob = buildKnob(W * 0.14, H * 0.26, H * 0.11, 0x27e08a), iKnob = buildKnob(W * 0.34, H * 0.26, H * 0.11, 0xffb43a);
    function post(x, y, col) {
      const pg = new THREE.Group(); pg.position.set(x, y, panelZ);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(H * 0.048, H * 0.052, 0.005, 22), mat(col, 0.42, 0.12)); base.rotation.x = Math.PI / 2; pg.add(base);
      const stud = new THREE.Mesh(new THREE.CylinderGeometry(H * 0.02, H * 0.02, 0.011, 16), mat(0xd9a441, 0.28, 0.95)); stud.rotation.x = Math.PI / 2; stud.position.z = 0.007; pg.add(stud);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(H * 0.044, H * 0.05, 0.006, 22), mat(col, 0.35, 0.14)); cap.rotation.x = Math.PI / 2; cap.position.z = 0.012; pg.add(cap);
      root.add(pg); return pg;
    }
    post(-W * 0.34, H * 0.24, 0xcf2b27); post(-W * 0.22, H * 0.24, 0x141414); post(-W * 0.1, H * 0.24, 0x1f8a3b);
    const rock = new THREE.Group(); rock.position.set(W * 0.4, H * 0.62, panelZ);
    rock.add(new THREE.Mesh(new THREE.BoxGeometry(H * 0.1, H * 0.15, 0.006), darkMat));
    const rtop = new THREE.Mesh(new THREE.BoxGeometry(H * 0.082, H * 0.07, 0.006), mat(0x1f8a3b, 0.4, 0.1, { emissive: 0x0c3a1c, emissiveIntensity: 0.5 })); rtop.position.set(0, H * 0.03, 0.004); rtop.rotation.x = -0.35; rock.add(rtop); root.add(rock);
    for (let i = 0; i < 6; i++) { const v = new THREE.Mesh(new THREE.BoxGeometry(W * 0.5, 0.0016, 0.005), darkMat); v.position.set(0, H - 0.0006, -D * 0.18 + i * 0.011); root.add(v); }
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach((s) => { const f = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.006, 0.004, 14), mat(0x090b0d, 0.85, 0.05)); f.position.set(s[0] * W * 0.4, 0.001, s[1] * D * 0.38); root.add(f); });
    const leadRoot = new THREE.Group(); root.add(leadRoot);
    function lead(x0, col) {
      const p0 = [x0, H * 0.24, panelZ + 0.012], p1 = [x0 - 0.015, H * 0.15, panelZ + 0.035], p2 = [x0 - 0.024, H * 0.06, panelZ + 0.07], p3 = [x0 - 0.028, H * 0.02, panelZ + 0.1];
      leadRoot.add(tube([p0, p1, p2, p3], 0.0026, col, 0.5));
      const plug = new THREE.Mesh(new THREE.CylinderGeometry(0.0038, 0.0038, 0.013, 16), mat(col, 0.4, 0.12)); plug.position.set(p3[0], p3[1], p3[2] + 0.005); plug.rotation.x = Math.PI / 2; leadRoot.add(plug);
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.0021, 0.0021, 0.011, 12), mat(0xd0d4da, 0.3, 0.92)); tip.position.set(p3[0], p3[1], p3[2] + 0.015); tip.rotation.x = Math.PI / 2; leadRoot.add(tip);
    }
    lead(-W * 0.34, 0xcf2b27); lead(-W * 0.22, 0x141414);
    const st = { volts: opts.volts !== undefined ? opts.volts : 16, amps: opts.amps !== undefined ? opts.amps : 0, mode: opts.mode || 'CV', on: opts.on !== undefined ? opts.on : true };
    function redraw() { drawDc(dcv, st); dispTex.needsUpdate = true; }
    function setVoltage(v) { st.volts = Math.max(0, v); vKnob.rotation.z = -(v / 24) * Math.PI * 1.4; redraw(); }
    function setCurrent(a) { st.amps = Math.max(0, a); iKnob.rotation.z = -(a / 40) * Math.PI * 1.4; redraw(); }
    function setMode(m) { st.mode = m; redraw(); }
    function setOutputOn(b) { st.on = !!b; redraw(); }
    setVoltage(st.volts); setCurrent(st.amps);
    return { group: root, dims: { W: W, H: H, D: D }, frontZ: frontZ, setVoltage: setVoltage, setCurrent: setCurrent, setMode: setMode, setOutputOn: setOutputOn, dispTex: dispTex, vKnob: vKnob, iKnob: iKnob };
  }

  return { makeStudioEnv: makeStudioEnv, buildBattery: buildBattery, buildDcSupply: buildDcSupply, buildMotor: buildMotor, buildPropeller: buildPropeller, buildXT60Male: buildXT60Male };
})();



// ── main.js (experiment code: Calc / SFX / Instructor / app / gate) ──
// Experiment 04: ESC power-electronics simulation.
// The Calc IIFE is intentionally first so tests can load it without the DOM app.
const Calc = (function () {
  'use strict';

  const PW_MIN_US = 1000;
  const PW_MAX_US = 2000;
  const PW_RANGE_US = PW_MAX_US - PW_MIN_US;
  const DEADBAND_US = 50;
  const TIMER_TICK_US = 1.0;
  // Silicon power-MOSFET Rds(on) temperature coefficient. The ESC conduction loss lives in
  // the MOSFET channel, whose on-resistance climbs ~1.45x by 100 C (datasheet-typical for the
  // logic-level FETs used in hobby ESCs) — roughly +0.6 %/C, well above annealed copper's
  // +0.393 %/C. Using the MOSFET value captures the real self-heating / thermal-runaway tendency.
  const MOSFET_TEMPCO = 0.006;
  const T_REF_C = 25;
  const HEATSINK_W = 2.0;
  const T_LIMIT_C = 80;
  // MOSFET switching (dynamic) loss parameters. The ESC's motor-PWM carrier — BLHeli's default
  // 24 kHz, BLHeli_32 up to 48 kHz — switches the FETs; every transition crosses the linear
  // region and burns energy. t_on+t_off ≈ 100 ns is datasheet-typical for the logic-level FET +
  // gate-driver in a hobby ESC. These set the switching-loss term the timing stage trades for latency.
  const F_PWM_CARRIER_HZ = 24000;
  const T_SWITCH_S = 100e-9;

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function throttleFromPulse(pw, pwMin, pwMax) {
    const lo = pwMin === undefined ? PW_MIN_US : pwMin;
    const hi = pwMax === undefined ? PW_MAX_US : pwMax;
    return clamp((pw - lo) / (hi - lo) * 100, 0, 100);
  }
  function effectiveThrottle(pw, deadbandUs, pwMin, pwMax) {
    const lo = pwMin === undefined ? PW_MIN_US : pwMin;
    const hi = pwMax === undefined ? PW_MAX_US : pwMax;
    const db = deadbandUs === undefined ? DEADBAND_US : deadbandUs;
    if (pw <= lo + db) return 0;
    return clamp((pw - lo) / (hi - lo) * 100, 0, 100);
  }
  function pulseFromThrottle(t, pwMin, pwMax) {
    const lo = pwMin === undefined ? PW_MIN_US : pwMin;
    const hi = pwMax === undefined ? PW_MAX_US : pwMax;
    return lo + clamp(t, 0, 100) / 100 * (hi - lo);
  }
  function commandSteps(pwRangeUs, tickUs) {
    const range = pwRangeUs === undefined ? PW_RANGE_US : pwRangeUs;
    const tick = tickUs === undefined ? TIMER_TICK_US : tickUs;
    return range / tick;
  }
  function percentPerStep(steps) { return steps > 0 ? 100 / steps : 0; }
  function refreshLatencyMs(freqHz) { return freqHz > 0 ? 1000 / freqHz : Infinity; }
  function periodUs(freqHz) { return freqHz > 0 ? 1e6 / freqHz : Infinity; }
  function dutyPct(pulseUs, freqHz) {
    const T = periodUs(freqHz);
    return isFinite(T) && T > 0 ? clamp(pulseUs / T * 100, 0, 100) : 0;
  }
  function digitalFrameTimeUs(bitrateBps, frameBits) {
    return bitrateBps > 0 ? (frameBits / bitrateBps) * 1e6 : Infinity;
  }
  function escDissipation(currentA, rEscOhm) { return currentA * currentA * rEscOhm; }
  // Dynamic switching loss in the MOSFET bridge: P_sw ≈ 0.5·V_bus·I·(t_on+t_off)·f_carrier.
  // It scales with the carrier frequency and (to first order) is independent of junction
  // temperature — the real heat cost a higher PWM/protocol rate pays for finer, lower-latency
  // control. Zero unless bus voltage, current and frequency are all positive.
  function switchingLoss(vBus, currentA, freqHz, tSwitchS) {
    const f = freqHz === undefined ? F_PWM_CARRIER_HZ : freqHz;
    const tsw = tSwitchS === undefined ? T_SWITCH_S : tSwitchS;
    if (!(vBus > 0) || !(currentA > 0) || !(f > 0)) return 0;
    return 0.5 * vBus * currentA * tsw * f;
  }
  // Total ESC dissipation = conduction (I²·R, R may be the hot value) + switching (dynamic).
  function escTotalLoss(currentA, rEscOhm, vBus, freqHz, tSwitchS) {
    return escDissipation(currentA, rEscOhm) + switchingLoss(vBus, currentA, freqHz, tSwitchS);
  }
  function resistanceAtTemp(r25, tempC) { return r25 * (1 + MOSFET_TEMPCO * (tempC - T_REF_C)); }
  function escSteadyTemp(powerW, rThCPerW, ambientC) {
    const amb = ambientC === undefined ? T_REF_C : ambientC;
    return amb + powerW * rThCPerW;
  }
  function heatsinkRequired(powerW) { return powerW > HEATSINK_W; }
  function hotOperatingPoint(currentA, r25, rThCPerW, ambientC) {
    const amb = ambientC === undefined ? T_REF_C : ambientC;
    let T = amb, R = r25, P = currentA * currentA * r25;
    for (let i = 0; i < 60; i++) {
      R = resistanceAtTemp(r25, T);
      P = currentA * currentA * R;
      const nextT = amb + P * rThCPerW;
      if (Math.abs(nextT - T) < 1e-4) { T = nextT; break; }
      T = 0.5 * T + 0.5 * nextT;
    }
    return { T_c: T, R_ohm: R, P_w: P };
  }

  // As hotOperatingPoint, but carrying an additive temperature-independent loss (e.g. the
  // switching loss above): solves the self-heating fixed point T = amb + (I²·R(T) + P_add)·Rth.
  // Returns the conduction/switching split so the UI can show where the heat comes from.
  function hotOperatingPointEx(currentA, r25, rThCPerW, ambientC, pAddW) {
    const amb = ambientC === undefined ? T_REF_C : ambientC;
    const pAdd = pAddW > 0 ? pAddW : 0;
    let T = amb, R = r25, Pc = currentA * currentA * r25;
    for (let i = 0; i < 80; i++) {
      R = resistanceAtTemp(r25, T);
      Pc = currentA * currentA * R;
      const nextT = amb + (Pc + pAdd) * rThCPerW;
      if (Math.abs(nextT - T) < 1e-4) { T = nextT; break; }
      T = 0.5 * T + 0.5 * nextT;
    }
    return { T_c: T, R_ohm: R, P_cond_w: Pc, P_switch_w: pAdd, P_w: Pc + pAdd };
  }

  // ── Drivetrain voltage & loaded speed (genuine back-EMF, shared with Exp 1's model) ──
  // Per-cell LiPo open-circuit voltage vs state-of-charge (3.5 V empty → 4.3 V full).
  function ocvPerCell(soc) {
    const s = clamp(soc === undefined ? 1 : soc, 0, 1);
    return 3.5 + 0.7 * s + 0.1 * s * s * s;
  }
  // Battery pack terminal voltage for a cell count S and state-of-charge.
  function packVoltage(cells, soc) { return cells * ocvPerCell(soc); }
  // Loaded motor speed from back-EMF: RPM = kv · (V_applied − I·R_total). Below stall
  // (V_applied ≤ I·R_total) the rotor cannot turn, so the result clamps to zero.
  function loadedRpm(kv, vApplied, currentA, rTotalOhm) {
    const vBemf = vApplied - currentA * (rTotalOhm || 0);
    return vBemf > 0 ? kv * vBemf : 0;
  }
  // Prop-load phase current. A fixed-pitch prop is an aerodynamic torque load: shaft torque
  // (and therefore motor/ESC current) climbs steeply with throttle, not linearly. Empirically
  // I(throttle) ≈ I0 + (I_full − I0)·(throttle/100)^1.5 — the 1.5 exponent captures the torque
  // rise so a loaded motor draws its full rated current only near full stick, and idles near I0
  // at low throttle. This loaded current is what P_ESC = I²·R is evaluated at, so heat tracks
  // the real operating point instead of a free-floating slider. (throttle 0 → I0, 100 → I_full.)
  function loadedCurrent(throttlePct, iFull, i0) {
    const t = clamp((throttlePct === undefined ? 0 : throttlePct) / 100, 0, 1);
    const hi = iFull > 0 ? iFull : 0;
    const lo = i0 > 0 ? i0 : 0;
    return lo + (hi - lo) * Math.pow(t, 1.5);
  }
  // ── Lumped-capacitance thermal mass (real time constant, not a tuned guess) ──
  // Heat capacity C_th [J/°C] = mass [kg] × specific heat cp [J/(kg·K)]. The board is
  // a mix of FR4, copper pour and silicon; cp ≈ 800 J/(kg·K) is representative.
  function thermalCapacitance(massG, cpJperKgK) {
    const cp = cpJperKgK === undefined ? 800 : cpJperKgK;
    return (massG / 1000) * cp;
  }
  // First-order thermal time constant τ = R_th · C_th [s] (≈ minutes for a real ESC).
  function thermalTimeConstant(rThCPerW, cThJperC) { return rThCPerW * cThJperC; }

  // ── Single-source catalog (shared VLAB_CATALOG) + exp-4-local blocks ─────────
  // The shared catalog owns the physical parts (escs / motors / batteries) so a
  // given ESC is the SAME as-manufactured unit in every experiment. The three
  // blocks below are exp-4-specific bench data (calibration band, thermal model,
  // signal protocols) that no other experiment needs — merged onto whatever
  // loadCatalog() returns so a VLAB_CATALOG build and the db.json fallback behave
  // identically. Kept here (not in the DOM app) so headless tests see them too.
  const LOCAL_BLOCKS = {
    calibration: { pulse_min_us: 1000, pulse_max_us: 2000, deadband_us: 50, timer_tick_us: 1 },
    thermal: {
      ambient_c: 25, limit_c: 80, heatsink_threshold_w: 2, mosfet_rdson_tempco_per_c: 0.006,
      r_th_bare_c_per_w: 18, r_th_heatsink_c_per_w: 9, cp_j_per_kg_k: 800, heatsink_mass_g: 12, sim_fast_forward: 30
    },
    pwm_protocols: [
      { id: 'pwm_50', label: 'Standard PWM - 50 Hz', type: 'analog', refresh_hz: 50, pulse_min_us: 1000, pulse_max_us: 2000, throttle_levels: 1000 },
      { id: 'pwm_400', label: 'Oneshot / Fast PWM - 400 Hz', type: 'analog', refresh_hz: 400, pulse_min_us: 1000, pulse_max_us: 2000, throttle_levels: 1000 },
      { id: 'pwm_500', label: 'Fast PWM - 500 Hz', type: 'analog', refresh_hz: 500, pulse_min_us: 1000, pulse_max_us: 2000, throttle_levels: 1000 },
      { id: 'oneshot125', label: 'OneShot125', type: 'analog', refresh_hz: 4000, pulse_min_us: 125, pulse_max_us: 250, throttle_levels: 1000 },
      { id: 'dshot300', label: 'DShot300 (digital)', type: 'digital', bitrate_bps: 300000, frame_bits: 16, throttle_levels: 2000, refresh_hz: 18000 },
      { id: 'dshot600', label: 'DShot600 (digital)', type: 'digital', bitrate_bps: 600000, frame_bits: 16, throttle_levels: 2000, refresh_hz: 37000 }
    ]
  };

  // The seeded, per-ESC arm dead-band. A real ESC's "the motor starts to move"
  // point is not exactly 50 µs above idle — unit-to-unit it scatters ±30 % from
  // component + firmware spread. Deterministic per ESC id (same physical unit
  // every reload) so the student calibrates a real window (≈35–65 µs), not a
  // textbook constant. Falls back to the nominal if the shared constants are
  // absent (headless).
  function deadbandForEsc(esc) {
    if (esc && typeof esc.deadband_us === 'number') return esc.deadband_us;
    const C = (typeof window !== 'undefined') ? window.VLAB_CONST : null;
    if (esc && esc.id && C && typeof C.applyTol === 'function') {
      return Math.round(C.applyTol(DEADBAND_US, 0.30, esc.id + ':deadband'));
    }
    return DEADBAND_US;
  }

  // Real-world "as-manufactured" part draw: perturb nominal catalog specs by the
  // seeded tolerance (constants.js §TOL). Same seed keys as every other
  // experiment (a part is the same physical unit lab-wide), idempotent, safe
  // no-op without VLAB_CONST. Also bakes the seeded arm dead-band onto each ESC.
  function manufactureDb(db) {
    const C = (typeof window !== 'undefined') ? window.VLAB_CONST : null;
    if (!db || db.__manufactured) return db;
    const T = (C && C.TOL) || {};
    const tol = (C && typeof C.applyTol === 'function');
    (db.motors || []).forEach(function (m) {
      if (tol && typeof m.kv === 'number')     m.kv     = +C.applyTol(m.kv,     T.motor_kv || 0.08, m.id + ':kv').toFixed(1);
      if (tol && typeof m.rm_ohm === 'number') m.rm_ohm = +C.applyTol(m.rm_ohm, T.motor_rm || 0.10, m.id + ':rm').toFixed(4);
      if (tol && typeof m.i0_a === 'number')   m.i0_a   = +C.applyTol(m.i0_a,   T.motor_i0 || 0.15, m.id + ':i0').toFixed(3);
      // Datasheet current fallbacks for standalone runs (Exp 1's solved current
      // overrides these live). Shared catalog carries max_current_a only.
      if (typeof m.full_current_a !== 'number') m.full_current_a = m.max_current_a || m.hover_current_a || 20;
      if (typeof m.hover_current_a !== 'number') m.hover_current_a = +(m.full_current_a * 0.4).toFixed(1);
    });
    (db.batteries || []).forEach(function (b) {
      if (tol && typeof b.capacity_mah === 'number') b.capacity_mah = Math.round(C.applyTol(b.capacity_mah, T.batt_capacity || 0.05, b.id + ':cap'));
      if (tol && typeof b.cell_ir_mohm === 'number') b.cell_ir_mohm = +C.applyTol(b.cell_ir_mohm, T.batt_ir || 0.20, b.id + ':ir').toFixed(2);
    });
    (db.escs || []).forEach(function (e) {
      if (tol && typeof e.rds_on_ohm === 'number') e.rds_on_ohm = +C.applyTol(e.rds_on_ohm, T.esc_rdson || 0.10, e.id + ':rdson').toFixed(5);
      e.deadband_us = deadbandForEsc(e);   // bake the seeded arm dead-band
    });
    db.__manufactured = true;
    return db;
  }

  // Single source of truth: the bundled VLAB_CATALOG (identical data to
  // shared/catalog.json). db/db.json is only an offline fallback if the global
  // is missing — never a second, independently-maintained catalog. The three
  // exp-4-local bench blocks are merged on afterward so both paths behave the same.
  function loadCatalog() {
    function withLocal(db) {
      if (!db.calibration) db.calibration = JSON.parse(JSON.stringify(LOCAL_BLOCKS.calibration));
      if (!db.thermal) db.thermal = JSON.parse(JSON.stringify(LOCAL_BLOCKS.thermal));
      if (!db.pwm_protocols) db.pwm_protocols = JSON.parse(JSON.stringify(LOCAL_BLOCKS.pwm_protocols));
      return db;
    }
    if (typeof window !== 'undefined' && window.VLAB_CATALOG) {
      return Promise.resolve(withLocal(JSON.parse(JSON.stringify(window.VLAB_CATALOG))));
    }
    return fetch('db/db.json').then(function (res) {
      if (!res.ok) throw new Error('DB load error: ' + res.status);
      return res.json();
    }).then(withLocal);
  }

  return Object.freeze({
    PW_MIN_US, PW_MAX_US, PW_RANGE_US, DEADBAND_US, TIMER_TICK_US,
    MOSFET_TEMPCO, T_REF_C, HEATSINK_W, T_LIMIT_C, F_PWM_CARRIER_HZ, T_SWITCH_S,
    clamp,
    throttleFromPulse, effectiveThrottle, pulseFromThrottle,
    commandSteps, percentPerStep, refreshLatencyMs, periodUs, dutyPct, digitalFrameTimeUs,
    escDissipation, switchingLoss, escTotalLoss, resistanceAtTemp, escSteadyTemp, heatsinkRequired,
    hotOperatingPoint, hotOperatingPointEx,
    ocvPerCell, packVoltage, loadedRpm, thermalCapacitance, thermalTimeConstant,
    loadedCurrent,
    deadbandForEsc, manufactureDb, loadCatalog
  });
})();
window.Calc = Calc;

// ═══════════════════════════════════════════════════════════════════
// Shipped UI sound-effects (audio/sfx/*.mp3). Carry moment-to-moment
// interaction feedback (click/lock/success/error/warn) so the instructor
// VOICE can stay quiet — it speaks only at tab intro, fault, and completion.
// Verbatim pattern from Experiment 1's SFX module (see redesign/README.md §1).
// ═══════════════════════════════════════════════════════════════════
const SFX = (function () {
  'use strict';
  let enabled = true;
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
  // Looped bench-motor buzz + propeller whoosh — same asset/behaviour as
  // exp1/2/5/6's SFX.motor(), gated on the same motorDriven() predicate that
  // already drives the visual spin. Both loops always start/stop together.
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

// ═══════════════════════════════════════════════════════════════════
// Instructor / Buddy Guidance System — "Power Bench Instructor". Verbatim
// architecture from Experiment 1 (redesign/README.md §1): a floating buddy
// agent (never a tab / inline panel), pre-recorded Emma-neural clips as the
// primary voice, "Quiet Instructor" model — speaks only at tab intro, a
// fault/failure, or a task completion. Every other status/selection/dynamic
// readout is on-screen text only via show(). No robotic speechSynthesis
// fallback for messages without a clip — silence, since the text is already
// visible. Clips live in this experiment's own audio/voice/ folder.
// ═══════════════════════════════════════════════════════════════════
const Instructor = (function () {
  'use strict';

  const CLIPS = {
    m1_intro: 'audio/voice/m1_intro.mp3',
    m1_armed: 'audio/voice/m1_armed.mp3',
    m1_map_done: 'audio/voice/m1_map_done.mp3',
    m2_intro: 'audio/voice/m2_intro.mp3',
    m2_resolution: 'audio/voice/m2_resolution.mp3',
    m2_thermal_intro: 'audio/voice/m2_thermal_intro.mp3',
    m2_heatsink: 'audio/voice/m2_heatsink.mp3',
    m2_runaway: 'audio/voice/m2_runaway.mp3',
    verdict_pass: 'audio/voice/verdict_pass.mp3',
    // Free-form wiring faults — the real-hardware consequences of a bad drag-wire circuit.
    fault_reverse_polarity: 'audio/voice/fault_reverse_polarity.mp3',
    fault_short_circuit: 'audio/voice/fault_short_circuit.mp3',
    fault_reversed_rotation: 'audio/voice/fault_reversed_rotation.mp3'
  };

  // Fault/completion/observation banners are matched by their exact leading
  // text (tags stripped first). First match wins; anything unmatched stays
  // silent (text only) — see say() below.
  const EVENT_CLIPS = [
    [/^CRITICAL FAILURE: reverse battery polarity/i, 'fault_reverse_polarity', 'error'],
    [/^CRITICAL FAILURE: dead short/i, 'fault_short_circuit', 'error'],
    [/^OBSERVE: rotation is reversed/i, 'fault_reversed_rotation', 'warn'],
    [/^OBSERVE: The motor just armed/i, 'm1_armed', 'success'],
    [/^GUIDE: Throttle map complete/i, 'm1_map_done', 'success'],
    [/^OBSERVE: One thousand steps at both frequencies/i, 'm2_resolution', 'success'],
    [/^WARNING: Dissipation has crossed two watts/i, 'm2_heatsink', 'warn'],
    [/^CRITICAL: Thermal runaway/i, 'm2_runaway', 'error'],
    [/^GUIDE: ESC commissioning complete/i, 'verdict_pass', 'success']
  ];

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
  let pendingClip = null, pendingClipToken = -1, unlockListening = false;

  function pickVoice() {
    if (!synth) return null;
    const voices = synth.getVoices() || [];
    if (!voices.length) return null;
    if (cachedVoice && voices.indexOf(cachedVoice) !== -1) return cachedVoice;
    const natural = voices.find(function (v) { return /natural|neural|online/i.test(v.name) && /^en/i.test(v.lang); });
    if (natural) { cachedVoice = natural; return natural; }
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
    if (clip && token === speakQueueToken && ttsEnabled) { const a = getAudioEl(); a.src = clip; a.play().catch(function () {}); }
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
    a.play().catch(function () { if (myToken !== speakQueueToken) return; armAudioUnlock(clip, myToken); });
  }
  function show(text) {
    const el = document.getElementById('liveCommentaryText');
    if (el) el.innerHTML = text;
    const dot = document.getElementById('vlInstructorDot');
    const bubble = document.getElementById('vlInstructorBubble');
    if (dot) dot.hidden = !(bubble && bubble.hidden);
  }
  let _lastEventId = null;
  function say(text) {
    show(text);
    if (!ttsEnabled) return;
    const ev = resolveEvent(text);
    if (!ev) { _lastEventId = null; return; }
    if (ev.id === _lastEventId) return;
    _lastEventId = ev.id;
    stopAll();
    if (ev.kind === 'error' && window.SFX) SFX.error();
    else if (ev.kind === 'warn' && window.SFX) SFX.warn();
    else if (ev.kind === 'success' && window.SFX) SFX.success();
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
  function replayIntro() { if (!currentIntroId) return; stopAll(); if (ttsEnabled) playClip(CLIPS[currentIntroId]); }
  function setTts(v) {
    ttsEnabled = !!v;
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
    function setOpen(open) { bubble.hidden = !open; if (open && dot) dot.hidden = true; }
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
  function ensureReplayButton(bubble) {
    if (!bubble || document.getElementById('instructorReplayBtn')) return;
    // Anchored inside the scrollable .vl-instructor-body (not appended as a
    // bare sibling after it) so it always sits right under the guidance text,
    // within the bubble's bounded height, instead of growing the bubble's
    // total height unboundedly.
    const body = bubble.querySelector('.vl-instructor-body') || bubble;
    const btn = document.createElement('button');
    btn.id = 'instructorReplayBtn'; btn.type = 'button';
    btn.title = 'Replay this tab\'s intro'; btn.setAttribute('aria-label', 'Replay this tab\'s intro');
    btn.innerHTML = '&#9654; Replay intro';
    btn.style.cssText = 'margin-top:8px;display:inline-flex;align-items:center;gap:6px;font-size:11px;line-height:1;padding:5px 9px;border:1px solid rgba(0,0,0,0.15);border-radius:999px;background:#f1f5f9;color:#334155;cursor:pointer;';
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      replayIntro();
    });
    body.appendChild(btn);
  }
  function loadVideo(containerId, src, opts) {
    const container = document.getElementById(containerId);
    if (!container || !src) return;
    const caption = (opts && opts.caption) || '';
    if (lastVideoSrc === src && container.style.display !== 'none') return;
    fetch(src, { method: 'HEAD' }).then(function (res) {
      if (!res.ok) throw new Error('missing');
      container.innerHTML = '<video autoplay muted loop playsinline preload="metadata" style="width:100%; display:block;"><source src="' + src + '" type="video/mp4"></video>';
      container.style.display = 'block'; lastVideoSrc = src;
      if (caption) say(caption);
    }).catch(function () { container.style.display = 'none'; container.innerHTML = ''; lastVideoSrc = null; if (caption) say(caption); });
  }

  return {
    show: show, say: say, enterTab: enterTab, replayIntro: replayIntro,
    setTts: setTts, initTtsToggle: initTtsToggle, mountFloating: mountFloating,
    loadVideo: loadVideo, isTtsAvailable: function () { return !!synth; },
    setVolume: setVolume, getVolume: getVolume
  };
})();
window.Instructor = Instructor;

(function () {
  'use strict';

  // ── Embedded fallback database (mirrors db/db.json; used only if the fetch fails) ──
  const fallbackDb = {
    calibration: { pulse_min_us: 1000, pulse_max_us: 2000, deadband_us: 50, timer_tick_us: 1 },
    thermal: {
      ambient_c: 25, limit_c: 80, heatsink_threshold_w: 2, mosfet_rdson_tempco_per_c: 0.006,
      r_th_bare_c_per_w: 18, r_th_heatsink_c_per_w: 9, cp_j_per_kg_k: 800, heatsink_mass_g: 12, sim_fast_forward: 30
    },
    pwm_protocols: [
      { id: 'pwm_50', label: 'Standard PWM - 50 Hz', type: 'analog', refresh_hz: 50, pulse_min_us: 1000, pulse_max_us: 2000, throttle_levels: 1000 },
      { id: 'pwm_400', label: 'Oneshot / Fast PWM - 400 Hz', type: 'analog', refresh_hz: 400, pulse_min_us: 1000, pulse_max_us: 2000, throttle_levels: 1000 },
      { id: 'pwm_500', label: 'Fast PWM - 500 Hz', type: 'analog', refresh_hz: 500, pulse_min_us: 1000, pulse_max_us: 2000, throttle_levels: 1000 },
      { id: 'oneshot125', label: 'OneShot125', type: 'analog', refresh_hz: 4000, pulse_min_us: 125, pulse_max_us: 250, throttle_levels: 1000 },
      { id: 'dshot300', label: 'DShot300 (digital)', type: 'digital', bitrate_bps: 300000, frame_bits: 16, throttle_levels: 2000, refresh_hz: 18000 },
      { id: 'dshot600', label: 'DShot600 (digital)', type: 'digital', bitrate_bps: 600000, frame_bits: 16, throttle_levels: 2000, refresh_hz: 37000 }
    ],
    escs: [
      { id: 'esc_20a', label: '20A BLHeli_S (x4)', current_a: 20, burst_current_a: 25, rds_on_ohm: 0.0035, firmware: 'BLHeli_S', r_th_c_per_w: 22, mass_g_each: 6, mosfet_count: 6, quantity: 4, board_mm: [25, 13, 4], supported_protocols: ['pwm_50', 'pwm_400', 'pwm_500', 'oneshot125', 'dshot300'] },
      { id: 'esc_30a', label: '30A BLHeli_32 (x4)', current_a: 30, burst_current_a: 40, rds_on_ohm: 0.0030, firmware: 'BLHeli_32', r_th_c_per_w: 18, mass_g_each: 8, mosfet_count: 6, quantity: 4, board_mm: [27, 14, 4], supported_protocols: ['pwm_50', 'pwm_400', 'pwm_500', 'oneshot125', 'dshot300', 'dshot600'] },
      { id: 'esc_40a', label: '40A BLHeli_32 (x4)', current_a: 40, burst_current_a: 55, rds_on_ohm: 0.0022, firmware: 'BLHeli_32', r_th_c_per_w: 15, mass_g_each: 11, mosfet_count: 6, quantity: 4, board_mm: [30, 15, 5], supported_protocols: ['pwm_400', 'pwm_500', 'oneshot125', 'dshot300', 'dshot600'] },
      { id: 'esc_4in1_45a', label: '4-in-1 45A Stack', current_a: 45, burst_current_a: 60, rds_on_ohm: 0.0020, firmware: 'BLHeli_32', r_th_c_per_w: 12, mass_g_each: 9.5, mosfet_count: 24, quantity: 1, board_mm: [46, 46, 6], supported_protocols: ['pwm_400', 'pwm_500', 'oneshot125', 'dshot300', 'dshot600'] },
      { id: 'esc_4in1_60a', label: '4-in-1 60A Stack', current_a: 60, burst_current_a: 80, rds_on_ohm: 0.0016, firmware: 'BLHeli_32', r_th_c_per_w: 10, mass_g_each: 12, mosfet_count: 24, quantity: 1, board_mm: [50, 50, 7], supported_protocols: ['pwm_400', 'pwm_500', 'oneshot125', 'dshot300', 'dshot600'] }
    ],
    motors: [
      { id: '1806_2300', label: '1806 - 2300 KV', kv: 2300, rm_ohm: 0.118, i0_a: 0.25, max_current_a: 18.5, hover_current_a: 4.2, full_current_a: 18.5 },
      { id: '2204_2300', label: '2204 - 2300 KV', kv: 2300, rm_ohm: 0.095, i0_a: 0.30, max_current_a: 23.0, hover_current_a: 7.2, full_current_a: 23.0 },
      { id: '2207_1600', label: '2207 - 1600 KV', kv: 1600, rm_ohm: 0.075, i0_a: 0.40, max_current_a: 32.0, hover_current_a: 9.5, full_current_a: 32.0 },
      { id: '2212_920', label: '2212 - 920 KV', kv: 920, rm_ohm: 0.142, i0_a: 0.35, max_current_a: 20.0, hover_current_a: 8.0, full_current_a: 20.0 },
      { id: '2808_1200', label: '2808 - 1200 KV', kv: 1200, rm_ohm: 0.082, i0_a: 0.50, max_current_a: 38.0, hover_current_a: 12.5, full_current_a: 38.0 },
      { id: '3508_700', label: '3508 - 700 KV', kv: 700, rm_ohm: 0.065, i0_a: 0.45, max_current_a: 26.0, hover_current_a: 10.0, full_current_a: 26.0 }
    ],
    batteries: [
      { id: 'lipo_3s_1500', label: '3S LiPo - 1500 mAh', cells: 3, capacity_mah: 1500, voltage_nominal_v: 11.1, c_rating: 75, mass_g: 135 },
      { id: 'lipo_4s_1500', label: '4S LiPo - 1500 mAh', cells: 4, capacity_mah: 1500, voltage_nominal_v: 14.8, c_rating: 95, mass_g: 190 },
      { id: 'lipo_4s_3000', label: '4S LiPo - 3000 mAh', cells: 4, capacity_mah: 3000, voltage_nominal_v: 14.8, c_rating: 35, mass_g: 320 },
      { id: 'lipo_6s_1300', label: '6S LiPo - 1300 mAh', cells: 6, capacity_mah: 1300, voltage_nominal_v: 22.2, c_rating: 120, mass_g: 245 },
      { id: 'lipo_6s_5000', label: '6S LiPo - 5000 mAh', cells: 6, capacity_mah: 5000, voltage_nominal_v: 22.2, c_rating: 25, mass_g: 720 }
    ]
  };

  // ── tiny DOM helpers (all null-safe so the app boots even with a partial DOM / no WebGL) ──
  const $ = (id) => document.getElementById(id);
  const on = (id, evt, fn) => { const el = $(id); if (el) el.addEventListener(evt, fn); };
  const setVal = (id, v) => { const el = $(id); if (el) el.value = v; };
  const setChecked = (id, v) => { const el = $(id); if (el) el.checked = v; };
  const setText = (id, t) => { const el = $(id); if (el) el.textContent = t; };
  function ff() { try { return getComputedStyle(document.body).fontFamily || 'sans-serif'; } catch (e) { return 'sans-serif'; } }

  // The four stages live on two pages: Module 1 = calibration + mapping (index.html),
  // Module 2 = timing + thermal (index1.html). data-start picks the page; ?mode= picks the tab.
  const PAGE1_MODES = ['calibration', 'mapping'];
  const PAGE2_MODES = ['timing', 'thermal'];
  const startAttr = (document.body && document.body.dataset.start) ? document.body.dataset.start : 'calibration';
  const onPage1 = PAGE1_MODES.indexOf(startAttr) >= 0;
  const pageModes = onPage1 ? PAGE1_MODES : PAGE2_MODES;
  let initialMode = startAttr;
  try {
    const queryMode = new URLSearchParams(window.location.search).get('mode');
    if (queryMode && pageModes.indexOf(queryMode) >= 0) initialMode = queryMode;
  } catch (e) { /* no URL in this environment */ }

  // ms — above this, command-to-response lag is unacceptable for flight control (50 Hz = fault).
  const LATENCY_OK_MS = 5;

  const state = {
    mode: initialMode,
    calibrated: true,
    armed: false,
    pulseUs: 1000,
    currentA: 7.2,
    soc: 0.85,
    ambientC: 25,
    fault: 'none',
    hotModel: true,
    heatsink: false,
    exploded: false,
    explodeAmt: 1,
    spinView: false,
    selectedPart: null,
    phase: 0,
    capFitted: true,
    calibComplete: false,
    exploreComplete: false,
    db: fallbackDb,
    currentTempC: 25.0,
    lastTime: null,
    thermalShutdown: false,
    desynced: false,
    sweepData: null,
    prevSweep: null,
    heatThreshold: null,
    // session-only UI flags so the run-sheet steps auto-advance (never persisted)
    guide: { deadband: false, swept: false, at1500: false, fault: false, protocols: [], fullLoad: false, heat: false, recorded: {}, pwLo: null, pwHi: null, sweptThermal: false, viewedParts: [] },
    // Interactive latency oscilloscope (timing stage): a controllable, slowed playhead so the
    // command→response lag is something the student watches and measures, not a blur.
    scope: { playing: false, sweep: 0, speedPct: 22, cmdPct: 35, race: false, oneShot: false },   // starts PAUSED — the student presses Play
    // Live "Run simulation" toggle (mapping / thermal): energises the motor + advances the
    // thermal model in real time. The student drives the pulse / current DIRECTLY — there is
    // no scripted slider animation. RPM + heat only build when the circuit is complete + armed.
    running: false,
    // Drag-to-connect circuit state (3D scene). The ESC only powers up when the battery/DC
    // supply is wired to its power input, and the motor only spins when the phase leads are
    // wired ESC→motor AND the ESC is armed/powered. `damaged` latches true (and stays true
    // until the ESC is replaced) on a reverse-polarity or short-circuit wiring fault — no
    // reverse-voltage protection on a real hobby ESC. `reversed` flips true when the phase
    // mapping is an odd permutation of the canonical A→U,B→V,C→W (swap any two wires and a
    // real BLDC spins the other way).
    circuit: { power: false, phase: false, damaged: false, reversed: false },
    // Free-form drag-to-wire state (Module 1 commissioning bench, 3D). `connections` is the
    // list of committed {a,b} terminal-id pairs the student has actually wired; `dragFrom` /
    // `dragPoint` drive the live rubber-band while a wire is mid-drag.
    wiring: { connections: [], dragFrom: null, dragPoint: null }
  };

  // Set true while a native <select> popup is open/focused. The rAF loop skips the per-frame
  // panel rebuild (updateAll) while it is true, so a freshly-opened dropdown is not torn down
  // underneath the user mid-interaction (the "unselectable Fault Injection dropdown" bug). The
  // thermal + 3D render keep running every frame; onSelect still calls updateAll() on change.
  let _formBusy = false;

  // MOSFET junction / component probe points (right-panel readout). Gains relative to the hotspot.
  const heatProbes = [
    { id: 'Q1 high-side', gain: 1.05 },
    { id: 'Q2 high-side', gain: 1.00 },
    { id: 'Q3 high-side', gain: 1.08 },
    { id: 'Q4 low-side', gain: 0.96 },
    { id: 'Q5 low-side', gain: 1.03 },
    { id: 'Q6 low-side', gain: 0.98 },
    { id: 'Bulk capacitor', gain: 0.38 },
    { id: 'MCU package', gain: 0.30 }
  ];

  // ── Component explorer (Tab 1): the "anatomy of an ESC" datasheet content ─────
  // Each entry is keyed by a stable key; compKey() maps the 3D callout's display
  // name (which may carry a live count, e.g. "Power MOSFETs (×24)") to that key.
  const COMPONENTS = {
    fr4: {
      name: 'FR4 Substrate', cat: 'Structure', sub: 'Glass-epoxy circuit board',
      what: 'A rigid, flame-retardant laminate of woven glass cloth set in epoxy resin. Every other part mounts to it, and the etched copper layers that carry current are bonded to its faces.',
      role: 'It is the mechanical backbone and the electrical insulator between copper layers — carrying the heavy power pour and the fine signal traces side by side.',
      note: 'ESCs use 2 oz (70 µm) or thicker copper pours so a trace can carry tens of amps without overheating.'
    },
    soldermask: {
      name: 'Solder Mask & Silkscreen', cat: 'Structure', sub: 'Protective coat + printed labels',
      what: 'The coloured lacquer covering the copper, plus the white printed text that marks parts, pads and polarity.',
      role: 'The mask prevents solder bridges and oxidation; the silkscreen guides assembly and identifies pads, test points and pin 1.',
      note: 'Mask openings define exactly where solder is allowed to flow during reflow — that is why bare boards look black or green.'
    },
    pads: {
      name: 'Castellated I/O Pads', cat: 'Interconnect', sub: 'Plated half-via edge pads',
      what: 'Gold-plated half-holes spaced along the board edge.',
      role: 'They let the ESC be soldered straight onto a flight-controller stack or to motor and battery wires, with no bulky connectors.',
      note: 'ENIG gold-over-nickel plating resists oxidation, so the soldered joints stay reliable for years.'
    },
    mosfets: {
      name: 'Power MOSFETs', cat: 'Power stage', sub: 'The switching transistors',
      what: 'Logic-level N-channel power transistors arranged as three half-bridges (six FETs) per motor.',
      role: 'These are the muscle of the ESC: they PWM-switch the battery onto the motor windings. Their on-resistance sets the conduction loss.',
      note: 'Lower R_DS(on) means less I²R heat — the dominant loss you measure in the Thermal stage.', refTab: 'thermal'
    },
    mcu: {
      name: 'MCU / Gate Driver', cat: 'Control', sub: 'Brains + bridge driver',
      what: 'A microcontroller running the ESC firmware, paired with a gate-driver stage that boosts its logic outputs.',
      role: 'It reads the throttle command, runs the sensorless commutation algorithm, and drives the six MOSFET gates with the correct timing and dead-time.',
      note: 'The firmware senses rotor position from the floating phase\u2019s back-EMF, so no Hall sensors are needed.'
    },
    caps: {
      name: 'Electrolytic Capacitor', cat: 'Power stage', sub: 'Bus voltage smoothing',
      what: 'Aluminium electrolytic capacitor(s) bridged across the battery input.',
      role: 'They absorb switching ripple current and suppress the voltage spikes caused by battery-lead inductance, so the MOSFETs see a clean, stable bus.',
      note: 'Skipping the cap, or using long leads, invites spikes that can destroy the MOSFETs — the low-ESR cap is cheap insurance.'
    },
    smd: {
      name: 'SMD Passives', cat: 'Passives', sub: 'Resistors & ceramic capacitors',
      what: 'Tiny surface-mount resistors and ceramic capacitors clustered around the ICs.',
      role: 'Gate resistors, current-sense dividers, supply decoupling and pull-ups that condition the signals and stabilise the MCU rails.',
      note: 'The ceramic caps beside the MCU keep its supply quiet during the fast MOSFET switching transients.'
    },
    connector: {
      name: 'Signal Connector', cat: 'Interconnect', sub: 'Throttle & telemetry input',
      what: 'A small keyed JST connector (or solder pads) carrying the throttle signal, ground and optional telemetry.',
      role: 'It brings in the PWM / DShot command and returns telemetry such as RPM and current on smart ESCs.',
      note: 'This is the wire whose pulse width you calibrate to the 1000–2000 µs band in the next stage.', refTab: 'mapping'
    },
    leads: {
      name: 'Battery Leads', cat: 'Interconnect', sub: 'High-current power input',
      what: 'Thick silicone-insulated copper wires — red positive, black negative.',
      role: 'They carry the full pack current onto the board; silicone insulation stays flexible and tolerates the heat.',
      note: 'High strand-count silicone wire survives vibration and heat far better than cheap PVC hookup wire.'
    },
    screws: {
      name: 'Mounting Screws', cat: 'Mechanical', sub: 'Stack mounting hardware',
      what: 'M3 screws and standoffs at the four board corners.',
      role: 'They clamp the ESC into the drone\u2019s mounting stack, ideally through soft anti-vibration grommets.',
      note: 'Silicone grommets in the holes stop gyro-corrupting vibration from reaching the flight controller.'
    },
    heatsink: {
      name: 'Clamp-on Heatsink', cat: 'Thermal', sub: 'Bolt-on aluminium cooler',
      what: 'A finned aluminium block clamped over the MOSFET banks.',
      role: 'It lowers the thermal resistance to ambient, so the same dissipation produces a lower hotspot temperature — raising the safe current limit.',
      note: 'You quantify exactly how much extra current it buys in the Thermal stage.', refTab: 'thermal'
    },
    motor: {
      name: 'Brushless Motor', cat: 'Load', sub: 'The three-phase load',
      what: 'An outrunner brushless DC motor wired to the three ESC phases.',
      role: 'It converts the switched electrical power into shaft torque; its kv and winding resistance set the loaded RPM.',
      note: 'Shown on the live tabs, where the bell spins with throttle.', refTab: 'mapping'
    }
  };
  const REF_LABEL = {
    mapping: 'Put to work in the Calibrate & Commission stage →',
    thermal: 'Explored in the Thermal stage (Module 2) →',
    timing: 'Explored in the Protocol stage (Module 2) →'
  };

  // Map a 3D callout's display name to a stable component key (tolerant of live counts).
  function compKey(name) {
    if (!name) return null;
    const n = String(name).toLowerCase();
    if (n.indexOf('fr4') >= 0 || n.indexOf('substrate') >= 0) return 'fr4';
    if (n.indexOf('mask') >= 0 || n.indexOf('silkscreen') >= 0) return 'soldermask';
    if (n.indexOf('castellated') >= 0 || n.indexOf('pads') >= 0) return 'pads';
    if (n.indexOf('mosfet') >= 0) return 'mosfets';
    if (n.indexOf('mcu') >= 0 || n.indexOf('gate driver') >= 0) return 'mcu';
    if (n.indexOf('capacitor') >= 0) return 'caps';
    if (n.indexOf('smd') >= 0 || n.indexOf('passive') >= 0) return 'smd';
    if (n.indexOf('connector') >= 0 || n.indexOf('jst') >= 0) return 'connector';
    if (n.indexOf('lead') >= 0) return 'leads';
    if (n.indexOf('screw') >= 0 || n.indexOf('mounting') >= 0) return 'screws';
    if (n.indexOf('heatsink') >= 0) return 'heatsink';
    if (n.indexOf('motor') >= 0) return 'motor';
    return null;
  }

  // The ordered set of components present on the current board (heatsink only when fitted).
  function presentComponents() {
    const keys = ['fr4', 'soldermask', 'pads', 'mosfets', 'mcu', 'caps', 'smd', 'connector', 'leads', 'screws'];
    if (state.heatsink) keys.push('heatsink');
    return keys;
  }

  // Live, ESC-specific spec rows for a component (the "datasheet" facts).
  function specsFor(key) {
    const e = state.esc, th = (state.db && state.db.thermal) || fallbackDb.thermal;
    const is4 = e.quantity === 1;
    switch (key) {
      case 'fr4': return [['Board size', e.board_mm ? `${e.board_mm[0]} × ${e.board_mm[1]} mm` : '—'],
        ['Stack height', e.board_mm ? `${e.board_mm[2]} mm` : '—'], ['Laminate', 'FR4 glass-epoxy'],
        ['Copper pour', '2 oz (70 µm)'], ['Mass', `${(e.mass_g_each * (e.quantity || 1)).toFixed(1)} g`]];
      case 'soldermask': return [['Coating', 'LPI solder mask'], ['Silkscreen', e.firmware || '—'],
        ['Finish', 'Matte'], ['Job', 'Insulate + protect copper']];
      case 'pads': return [['Style', 'Castellated half-vias'], ['Finish', 'ENIG (gold)'],
        ['Carries', 'Motor · power · signal']];
      case 'mosfets': return [['Count', `${e.mosfet_count}${is4 ? ' (4 ESCs)' : ' / ESC'}`],
        ['R_DS(on)', `${(e.rds_on_ohm * 1000).toFixed(2)} mΩ`], ['Continuous', `${e.current_a} A`],
        ['Burst', `${e.burst_current_a || '—'} A`], ['Bridge', '3 half-bridges / motor']];
      case 'mcu': return [['Firmware', e.firmware || '—'], ['Package', 'QFN'],
        ['Commutation', 'Sensorless back-EMF'], ['Protocols', `${(e.supported_protocols || []).length} supported`]];
      case 'caps': return [['Type', 'Low-ESR aluminium'], ['Typical', '470 µF / 35 V'],
        ['Count', is4 ? '3 bulk' : '1 / ESC'], ['Job', 'Smooth bus, kill spikes']];
      case 'smd': return [['Package', '0402 / 0603'], ['Roles', 'Decouple · sense · bias'],
        ['Count', is4 ? '40+' : '~18']];
      case 'connector': return [['Type', 'JST-SH / pads'], ['Signals', 'Throttle + GND + telem'],
        ['Logic', '3.3 V'], ['Calibrate', '1000–2000 µs']];
      case 'leads': return [['Gauge', is4 ? '12–14 AWG' : '16–18 AWG'], ['Insulation', 'Silicone, high-strand'],
        ['Polarity', 'Red + / Black −'], ['Carries', `up to ${e.burst_current_a || e.current_a} A`]];
      case 'screws': return [['Size', 'M3'], ['Pattern', is4 ? '30.5 mm stack' : 'Direct mount'],
        ['Hardware', 'Steel + nylon grommet']];
      case 'heatsink': return [['Material', '6063 aluminium'], ['R_th bare', `${e.r_th_c_per_w} °C/W`],
        ['R_th + sink', `${th.r_th_heatsink_c_per_w} °C/W`], ['Added mass', `+${th.heatsink_mass_g} g`]];
      default: return [];
    }
  }

  // ── localStorage keys ───────────────────────────────────────────────────────
  const LS = {
    session: 'vlabExp4_session',
    esc: 'vlabExp4_esc', motor: 'vlabExp4_motor', protocol: 'vlabExp4_protocol',
    dissipation: 'vlabExp4_escDissipation', heatsink: 'vlabExp4_heatsinkRequired'
  };

  function readJSON(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } }
  function clampNum(v, lo, hi, fb) { const n = parseFloat(v); return isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fb; }
  function byId(list, id) { return (list || []).find((item) => item.id === id) || (list || [])[0]; }
  function esc(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Connect to Experiment 1 (propulsion): inherit the user's actual motor + ESC AND the
  // real computed full-throttle current the ESC must survive (from Exp 1's BEMT operating
  // point via the shared store), not a static datasheet number. A saved Exp4 session overrides.
  function inheritFromExp1() {
    let motorId = null, escId = null, fullI = null, hoverI = null;
    try {
      if (window.VLABStore) {
        const b = window.VLABStore.get();
        motorId = b.components.motorId; escId = b.components.escId;
        const e1 = window.VLABStore.upstream('exp1');
        if (e1 && typeof e1.fullCurrent_A === 'number') fullI = e1.fullCurrent_A;
        if (e1 && typeof e1.hoverCurrent_A === 'number') hoverI = e1.hoverCurrent_A;
      }
    } catch (e) { /* store optional */ }
    const m1 = readJSON('vlabModule1');
    if (!motorId && m1) motorId = m1.mId;
    if (!escId && m1) escId = m1.eId;
    if (motorId) { const m = byId(state.db.motors, motorId); if (m && m.id === motorId) { state.motor = m; state.inheritedFromExp1 = true; } }
    if (escId) { const e = byId(state.db.escs, escId); if (e && e.id === escId) state.esc = e; }
    // Exp 1's actual full-throttle current is THE value the ESC thermal test must use.
    state._exp1FullCurrent = (typeof fullI === 'number' && fullI > 0) ? fullI : null;
    state._exp1HoverCurrent = (typeof hoverI === 'number' && hoverI > 0) ? hoverI : null;
    if (state._exp1FullCurrent) state.currentA = state._exp1FullCurrent;
    else if (state.motor && state.motor.full_current_a) state.currentA = state.motor.full_current_a;
    else if (state.motor && state.motor.hover_current_a) state.currentA = state.motor.hover_current_a;
  }

  // Restore the user's last Exp4 session so a refresh / re-login resumes exactly where they
  // left off. Every field is validated and clamped to its control range.
  function restoreSession() {
    const s = readJSON(LS.session);
    if (!s || typeof s !== 'object') return;
    const e = byId(state.db.escs, s.escId); if (e && e.id === s.escId) state.esc = e;
    const m = byId(state.db.motors, s.motorId); if (m && m.id === s.motorId) state.motor = m;
    const p = byId(state.db.pwm_protocols, s.protocolId); if (p && p.id === s.protocolId) state.protocol = p;
    const b = byId(state.db.batteries, s.batteryId); if (b && b.id === s.batteryId) state.battery = b;
    state.pulseUs = clampNum(s.pulseUs, 900, 2100, state.pulseUs);
    state.currentA = clampNum(s.currentA, 2, 80, state.currentA);
    state.soc = clampNum(s.soc, 0, 1, state.soc);
    state.ambientC = clampNum(s.ambientC, 0, 45, state.ambientC);
    if (['none', 'inverted', 'highmin', 'jitter', 'desync', 'ripple'].indexOf(s.fault) >= 0) state.fault = s.fault;
    if (typeof s.hotModel === 'boolean') state.hotModel = s.hotModel;
    if (typeof s.heatsink === 'boolean') state.heatsink = s.heatsink;
    if (typeof s.capFitted === 'boolean') state.capFitted = s.capFitted;
    if (typeof s.calibrated === 'boolean') state.calibrated = s.calibrated;
    if (typeof s.armed === 'boolean') state.armed = s.armed;
    if (typeof s.calibComplete === 'boolean') state.calibComplete = s.calibComplete;
    if (typeof s.exploreComplete === 'boolean') state.exploreComplete = s.exploreComplete;
    if (Array.isArray(s.wiringConnections)) {
      state.wiring.connections = s.wiringConnections.filter((c) => c && typeof c.a === 'string' && typeof c.b === 'string');
    }
    if (typeof s.circuitDamaged === 'boolean') state.circuit.damaged = s.circuitDamaged;
  }

  // Persist the bench state + computed handoff outputs. Change-detected + throttled so the
  // animation loop (which calls updateAll every frame) only writes when something changes.
  let _lastPersistStr = '', _lastPersistAt = -1e9;
  function maybePersist() {
    try {
      if (!state.esc || !state.motor || !state.protocol) return;
      const payload = {
        escId: state.esc.id, motorId: state.motor.id, protocolId: state.protocol.id,
        batteryId: state.battery ? state.battery.id : null,
        pulseUs: +state.pulseUs.toFixed(1), currentA: +state.currentA.toFixed(2),
        soc: +state.soc.toFixed(3), ambientC: +state.ambientC.toFixed(1), fault: state.fault,
        hotModel: state.hotModel, heatsink: state.heatsink, calibrated: state.calibrated, armed: state.armed,
        capFitted: state.capFitted,
        calibComplete: state.calibComplete, exploreComplete: state.exploreComplete,
        wiringConnections: state.wiring.connections, circuitDamaged: state.circuit.damaged
      };
      const str = JSON.stringify(payload);
      const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      if (str === _lastPersistStr || now - _lastPersistAt < 400) return;
      _lastPersistStr = str; _lastPersistAt = now;
      localStorage.setItem(LS.session, str);
      localStorage.setItem(LS.esc, JSON.stringify(state.esc));
      localStorage.setItem(LS.motor, JSON.stringify(state.motor));
      localStorage.setItem(LS.protocol, JSON.stringify(state.protocol));
      const pCold = Calc.escDissipation(state.currentA, state.esc.rds_on_ohm);  // I^2 R at 25 C — the heatsink-decision value
      localStorage.setItem(LS.dissipation, pCold.toFixed(3));
      localStorage.setItem(LS.heatsink, Calc.heatsinkRequired(pCold) ? 'true' : 'false');

      // Publish the ESC characterisation to the unified cross-experiment store
      // (Exp 4 slice). Uses the self-heating hot operating point at the inherited
      // Exp-1 current so downstream views / validation see the real thermal state.
      if (window.VLABStore) {
        const rTh = state.esc.r_th_c_per_w || (state.db && state.db.thermal && state.db.thermal.r_th_c_per_w) || 6.0;
        const hot = Calc.hotOperatingPoint(state.currentA, state.esc.rds_on_ohm, rTh, state.ambientC);
        // Hover / full currents inherited from Exp 1's solved operating point (datasheet fallback).
        const fullI = state._exp1FullCurrent || (state.motor && state.motor.full_current_a) || state.currentA;
        const hoverI = state._exp1HoverCurrent || (state.motor && state.motor.hover_current_a) || fullI * 0.35;
        const vBus = busVoltageClean(), fCar = carrierHz(), rds = state.esc.rds_on_ohm;
        const pFullCond = Calc.escDissipation(fullI, rds);   // I²R at full — the canonical 2 W heatsink test
        const pFullTot = pFullCond + Calc.switchingLoss(vBus, fullI, fCar);
        const pHoverTot = Calc.escDissipation(hoverI, rds) + Calc.switchingLoss(vBus, hoverI, fCar);
        window.VLABStore.finalize('exp4', {
          // ── canonical handoff (PHYSICS_AND_ERROR_MODEL §5.4) ──
          esc_R_dson_ohm: rds,
          escDissipation_hover_W: +pHoverTot.toFixed(3),
          escDissipation_full_W: +pFullTot.toFixed(3),
          heatsinkRequired: pFullCond > Calc.HEATSINK_W,
          protocolId: state.protocol.id,
          pwmResolutionSteps: state.protocol.throttle_levels || Calc.commandSteps(1000, 1),
          latency_ms: +protocolLatency().toFixed(3),
          // Calibrated throttle band handed to the flight-controller experiment:
          // the stored idle endpoint plus this unit's real arm dead-band (the pulse
          // below which the motor must NOT move), and whether endpoints were stored.
          pwm_deadband_us: [Calc.PW_MIN_US, Calc.PW_MIN_US + escDeadband()],
          calibrated: !!state.calibrated,
          // ── digital-twin extras (live operating point + thermal state) ──
          escId: state.esc.id, motorId: state.motor.id,
          currentA: +state.currentA.toFixed(2),
          fullCurrent_A: +(+fullI).toFixed(2),
          dissipation_cold_W: +pCold.toFixed(3),
          dissipation_hot_W: +hot.P_w.toFixed(3),
          T_steady_c: +hot.T_c.toFixed(1),
          over_limit: hot.T_c > Calc.T_LIMIT_C,
          carrier_khz: +(fCar / 1000).toFixed(0)
        });
      }
    } catch (e) { /* storage unavailable — ignore */ }
  }

  // ── Cross-experiment staleness banner + upstream-current handoff badge ────────
  // The banner (VLABUi.mountBanner) surfaces, at the top of both pages, any
  // downstream experiment this bench's changes have invalidated and any build
  // violations — refreshed live as the ESC / motor / battery selection changes.
  // Per the lab's navigation rule it is TEXT-ONLY: no cross-experiment links
  // (redoUrl → null), just "Experiment N needs review". The badge tells the
  // student whether the thermal current is the REAL value solved in Experiment 1
  // (inherited via the shared store) or a datasheet fallback.
  let _bannerCtl = null, _lastBannerAt = -1e9, _lastBadgeSig = '';
  function syncBanner() {
    try {
      const host = $('vlBannerHost');
      if (host && window.VLABUi && window.VLABUi.mountBanner && window.VLABValidate) {
        if (!_bannerCtl) {
          _bannerCtl = window.VLABUi.mountBanner(host, {
            catalog: (window.VLAB_CATALOG || state.db || {}),
            currentExp: 'exp4',
            redoUrl: function () { return null; }   // text-only — no cross-experiment nav links
          });
        }
        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        if (now - _lastBannerAt > 600) { _lastBannerAt = now; _bannerCtl.refresh(); }
      }
      // Upstream-current handoff badge (real Exp-1 solved current vs datasheet).
      const badge = $('upstreamBadge');
      if (badge) {
        const real = state._exp1FullCurrent;
        const sig = real ? ('r' + real.toFixed(1)) : ('d' + (state.currentA || 0).toFixed(1));
        if (sig !== _lastBadgeSig) {
          _lastBadgeSig = sig;
          if (real) {
            badge.className = 'upstream-badge live';
            badge.innerHTML = `<span class="ub-dot"></span>Full-throttle current <strong>${real.toFixed(1)} A</strong> inherited from Experiment 1`;
          } else {
            badge.className = 'upstream-badge fallback';
            badge.innerHTML = `<span class="ub-dot"></span>Using datasheet current — finalize Experiment 1 for the real solved value`;
          }
        }
      }
    } catch (e) { /* banner optional */ }
  }

  // Publish this bench's validated ESC / battery choice to the shared store so any
  // downstream experiment sees the same physical parts. Guarded — a no-op on the
  // older runtime that predates VLABOverride.
  function pushValidatedComponents() {
    try {
      if (!window.VLABOverride || !window.VLABOverride.trySet) return;
      if (state.esc) window.VLABOverride.trySet('escId', state.esc.id, 'exp4');
      if (state.battery) window.VLABOverride.trySet('batteryId', state.battery.id, 'exp4');
    } catch (e) { /* override optional */ }
  }

  // ── boot ─────────────────────────────────────────────────────────────────────
  function appInit() {
    if (!$('benchCanvas')) return;
    // Single-source catalog: VLAB_CATALOG (shared) first, db/db.json fallback,
    // embedded fallbackDb last — then draw the as-manufactured (seeded-tolerance)
    // part values so the bench behaves like real hardware, not textbook numbers.
    Calc.loadCatalog()
      .then((db) => { state.db = (db && db.escs) ? Calc.manufactureDb(db) : Calc.manufactureDb(fallbackDb); boot(); })
      .catch(() => { state.db = Calc.manufactureDb(fallbackDb); boot(); })
      .catch((e) => { console.error('EXP4 boot failed:', e && (e.stack || e.message) || e); });
  }

  function boot() {
    // Prefer a canonical default, but fall back to the first available part so a
    // shared-catalog build (battery ids like "4s_1500") and the legacy db.json
    // fallback ("lipo_4s_1500") both boot cleanly.
    const pick = (list, id) => byId(list, id) || (list && list[0]) || null;
    state.esc = pick(state.db.escs, 'esc_30a');
    state.motor = pick(state.db.motors, '2204_2300');
    state.protocol = pick(state.db.pwm_protocols, 'pwm_50');
    state.battery = pick(state.db.batteries, 'lipo_4s_1500') || pick(state.db.batteries, '4s_1500');

    inheritFromExp1();    // pull the user's real motor / ESC choice from Experiment 1

    if (state.mode === 'thermal') {
      state.pulseUs = 1500;
      state.currentA = state._exp1FullCurrent || state.motor.full_current_a || 23;
      state.armed = true;
    }
    // Module 2 (protocol/thermal) opens on an already-commissioned drone — the
    // free-form wiring puzzle is Module 1's lesson, not repeated here.
    if (!onPage1) { state.circuit.power = true; state.circuit.phase = true; }

    restoreSession();     // a saved Exp4 session (refresh / re-login) overrides the defaults
    if (!onPage1) { state.circuit.power = true; state.circuit.phase = true; state.circuit.damaged = false; state.armed = true; }   // Module 2 is always a commissioned bench
    state.exploded = (state.mode === 'calibration');   // teardown belongs to Tab 1 only — never restore it mid-explode elsewhere

    state.currentTempC = ambientC();
    state.lastTime = null;
    state.thermalShutdown = false;

    hydrateControls();
    bindControls();
    buildEscTiles();
    setup3D();
    resizeCanvases();
    updateAll();
    // Start the render/physics loop BEFORE the optional instructor intro: the
    // loop is the app's heartbeat (HUD, thermal model, 3D spin) and must never
    // be held hostage by a failure in the voice/intro path.
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(loop);
    try {
      if (window.Instructor) {
        if (onPage1) {
          window.Instructor.show('GUIDE: Pick an ESC and raise the pulse width from 1000 microseconds. Note exactly where the motor first responds — that edge is your dead-band boundary.');
          window.Instructor.enterTab('m1_intro');
        } else {
          window.Instructor.show('GUIDE: Toggle the update frequency between 50 and 400 hertz and watch two numbers: the step count and the latency bar. Only one of them will move.');
          window.Instructor.enterTab('m2_intro');
          if (state.mode === 'thermal') {   // deep-linked straight into the thermal tab
            window.Instructor.show('GUIDE: Now hold full throttle. The controller is dissipating real heat — watch the cold textbook estimate and the hot equilibrium diverge as the silicon warms up.');
            window.Instructor.enterTab('m2_thermal_intro');
          }
        }
      }
    } catch (e) { console.error('Instructor intro failed (non-fatal):', e); }
  }

  function hydrateControls() {
    fillSelect($('escSelect'), state.db.escs, state.esc.id);
    fillSelect($('motorSelect'), state.db.motors, state.motor.id);
    fillSelect($('protocolSelect'), state.db.pwm_protocols, state.protocol.id);
    if (state.db.batteries && state.battery) fillSelect($('batterySelect'), state.db.batteries, state.battery.id);
    setVal('pulseSlider', state.pulseUs);
    setVal('currentSlider', state.currentA);
    setVal('socSlider', Math.round(state.soc * 100));
    setVal('ambientSlider', state.ambientC);
    setChecked('hotModelToggle', state.hotModel);
    setChecked('heatsinkToggle', state.heatsink);
    setChecked('capToggle', state.capFitted);
    setChecked('explodeToggle', state.exploded);
    setVal('explodeSlider', Math.round(state.explodeAmt * 100));
    setText('explodeOut', Math.round(state.explodeAmt * 100) + '%');
    setChecked('spinViewToggle', state.spinView);
    setVal('cmdThrottleSlider', state.scope.cmdPct);
    setText('cmdThrottleOut', state.scope.cmdPct + '%');
    setVal('scopeSpeed', state.scope.speedPct);
    setChecked('scopeRace', state.scope.race);
    setText('scopePlayBtn', state.scope.playing ? '⏸ Pause' : '▶ Play');
    renderScenario();
    setVal('faultSelect', state.fault);
    syncTabs();
  }

  function fillSelect(select, items, selectedId) {
    if (!select) return;
    select.innerHTML = items.map((item) => `<option value="${esc(item.id)}"${item.id === selectedId ? ' selected' : ''}>${esc(item.label)}</option>`).join('');
  }

  function bindControls() {
    on('escSelect', 'change', (e) => selectEsc(e.target.value));
    on('motorSelect', 'change', (e) => {
      state.motor = byId(state.db.motors, e.target.value);
      state.currentA = state.motor.hover_current_a || state.currentA;
      setVal('currentSlider', state.currentA);
      buildBoard3D();
      updateAll();
    });
    on('protocolSelect', 'change', (e) => { state.protocol = byId(state.db.pwm_protocols, e.target.value); state.scope.sweep = 0; updateAll(); });
    on('cmdThrottleSlider', 'input', (e) => { state.scope.cmdPct = +e.target.value; setText('cmdThrottleOut', e.target.value + '%'); updateAll(); });
    on('scopePlayBtn', 'click', () => { state.scope.playing = !state.scope.playing; state.scope.oneShot = false; setText('scopePlayBtn', state.scope.playing ? '⏸ Pause' : '▶ Play'); });
    on('scopeStepBtn', 'click', () => { state.scope.sweep = 0; state.scope.playing = true; state.scope.oneShot = true; setText('scopePlayBtn', '⏸ Pause'); });
    on('scopeSpeed', 'input', (e) => { state.scope.speedPct = +e.target.value; });
    on('scopeRace', 'change', (e) => { state.scope.race = e.target.checked; state.scope.sweep = 0; });
    on('batterySelect', 'change', (e) => { state.battery = byId(state.db.batteries, e.target.value); pushValidatedComponents(); updateAll(); });
    on('pulseSlider', 'input', (e) => { state.pulseUs = +e.target.value; updateAll(); });
    on('currentSlider', 'input', (e) => { state.currentA = +e.target.value; updateAll(); });
    on('socSlider', 'input', (e) => { state.soc = (+e.target.value) / 100; updateAll(); });
    on('ambientSlider', 'input', (e) => { state.ambientC = +e.target.value; updateAll(); });
    on('capToggle', 'change', (e) => { state.capFitted = e.target.checked; updateAll(); });
    on('hotModelToggle', 'change', (e) => { state.hotModel = e.target.checked; updateAll(); });
    on('heatsinkToggle', 'change', (e) => { state.heatsink = e.target.checked; if (view && view.model) view.model.setHeatsink(state.heatsink); updateAll(); });
    on('explodeToggle', 'change', (e) => {
      state.exploded = e.target.checked;
      if (state.exploded && state.explodeAmt < 0.05) { state.explodeAmt = 1; setVal('explodeSlider', 100); setText('explodeOut', '100%'); }
      updateAll();
    });
    on('explodeBtn', 'click', () => {
      state.exploded = !state.exploded;
      if (state.exploded && state.explodeAmt < 0.05) { state.explodeAmt = 1; setVal('explodeSlider', 100); setText('explodeOut', '100%'); }
      setChecked('explodeToggle', state.exploded); updateAll();
    });
    on('explodeSlider', 'input', (e) => {
      state.explodeAmt = (+e.target.value) / 100;
      state.exploded = state.explodeAmt > 0.001;
      setChecked('explodeToggle', state.exploded);
      setText('explodeOut', e.target.value + '%');
      updateAll();
    });
    on('spinViewToggle', 'change', (e) => { state.spinView = e.target.checked; });
    on('resetViewBtn', 'click', () => { state.selectedPart = null; if (view) view.focusActive = false; frameCamera(); updateAll(); });
    const compList = $('componentList');
    if (compList) compList.addEventListener('click', (ev) => {
      const btn = ev.target && ev.target.closest ? ev.target.closest('.component-item') : null;
      if (btn && btn.dataset.key) selectComponent(btn.dataset.key);
    });
    on('hoverPreset', 'click', () => { state.currentA = state.motor.hover_current_a || 8; setVal('currentSlider', state.currentA); updateAll(); });
    on('fullPreset', 'click', () => { state.currentA = state.motor.full_current_a || 25; setVal('currentSlider', state.currentA); state.guide.fullLoad = true; updateAll(); });
    on('calibrateBtn', 'click', () => { state.calibrated = state.fault === 'none'; state.pulseUs = 1000; setVal('pulseSlider', 1000); updateAll(); });
    on('armBtn', 'click', onArm);
    on('sweepBtn', 'click', onRunToggle);
    document.querySelectorAll('.vp-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.mode;
        if (pageModes.indexOf(target) >= 0) {
          state.mode = target;
          if (target === 'calibration') { state.exploded = true; setChecked('explodeToggle', true); }
          else { state.exploded = false; setChecked('explodeToggle', false); }   // teardown is the Explorer's view only
          if (target === 'thermal' && window.Instructor) {
            window.Instructor.show('GUIDE: Now hold full throttle. The controller is dissipating real heat — watch the cold textbook estimate and the hot equilibrium diverge as the silicon warms up.');
            window.Instructor.enterTab('m2_thermal_intro');
          }
          syncTabs(); frameCamera(); updateAll();
        }
        else { window.location.href = (PAGE1_MODES.indexOf(target) >= 0 ? 'index.html' : 'index1.html') + '?mode=' + target; }
      });
    });
    // Pause the per-frame panel rebuild while any native <select> popup is open, so the freshly
    // opened dropdown is not destroyed underneath the pointer before a new option can be picked.
    // (A native popup is dismissed by DOM churn elsewhere on the page — e.g. the thermal probe
    // list / HUD re-rendering every frame — so we simply hold updateAll() until the select blurs.)
    document.addEventListener('focusin', (e) => { if (e.target && e.target.tagName === 'SELECT') _formBusy = true; });
    document.addEventListener('focusout', (e) => { if (e.target && e.target.tagName === 'SELECT') _formBusy = false; });
    window.addEventListener('resize', resizeCanvases);
  }

  // The ESC "breakout" gallery — tile selection of the ESC platforms (syncs the hidden select).
  function buildEscTiles() {
    const el = $('escTiles');
    if (!el) return;
    el.innerHTML = state.db.escs.map((e) => {
      const active = state.esc && e.id === state.esc.id;
      const kind = e.quantity === 1 ? '4-in-1' : '4× single';
      return `<button type="button" class="esc-tile${active ? ' active' : ''}" data-esc="${esc(e.id)}" aria-pressed="${active}">`
        + `<span class="esc-tile-name">${esc(e.label.replace(/\s*\(x4\)/, ''))}</span>`
        + `<span class="esc-tile-spec">${e.current_a} A · ${(e.rds_on_ohm * 1000).toFixed(1)} mΩ · ${kind}</span>`
        + `</button>`;
    }).join('');
    el.querySelectorAll('.esc-tile').forEach((b) => b.addEventListener('click', () => selectEsc(b.dataset.esc)));
  }

  function selectEsc(id) {
    state.esc = byId(state.db.escs, id);
    setVal('escSelect', state.esc.id);
    if (state.sweepData && state.sweepData.escId !== state.esc.id) { /* keep for comparison until re-run */ }
    // A new ESC is a different physical unit — a fresh commission. Drop the arm +
    // any prior wiring/damage so the student wires and calibrates THIS board.
    state.armed = false; state.running = false;
    if (state.circuit) { state.circuit.damaged = false; }
    pushValidatedComponents();
    buildEscTiles();
    buildBoard3D();
    updateAll();
  }

  function onArm() {
    if (state.thermalShutdown) {
      if (state.currentTempC >= 80) { setMessage('Cannot reset fault: ESC temperature is still too hot (above 80 C).'); return; }
      state.thermalShutdown = false; updateAll(); return;
    }
    // Disarming is always allowed (safety) — motor output can be cut at any throttle.
    if (state.armed) { state.armed = false; state.running = false; updateAll(); setNote('ESC disarmed — motor output is cut.'); return; }
    // A destroyed ESC (reverse polarity / short) never arms again — it must be replaced.
    if (state.circuit.damaged) { setMessage('Arming refused: this ESC is destroyed (reverse-polarity or short-circuit damage). Select a replacement ESC from the breakout gallery.'); return; }
    // The ESC has no power until its input leads are wired to the battery in the 3D view.
    if (!state.circuit.power) { setMessage('Arming refused: the ESC has no power. Drag wires from the battery terminals to the ESC power-input pads in the 3D view first.'); return; }
    // A bad calibration or an unsafe temperature still blocks arming (the teaching checks).
    if (!state.calibrated) { setMessage('Arming refused: the stored endpoints are invalid (calibration fault). Fix the endpoint condition and store endpoints again.'); return; }
    if (state.currentTempC >= 80) { setMessage('Arming refused: ESC temperature is too hot (above 80 C). Allow the unit to cool.'); return; }
    // Real ESCs only arm at idle, so arming snaps the stick to idle instead of refusing —
    // the button always works when the calibration is valid and the ESC is powered.
    state.pulseUs = 1000; setVal('pulseSlider', 1000);
    state.armed = true;
    updateAll();
    setNote('ESC armed at idle — raise the pulse/throttle, then press Run simulation to drive the motor.');
  }

  // "Run simulation" — a LIVE running toggle, NOT a scripted slider animation. While running the
  // ESC is energised and the thermal model advances in real time; the student drives the pulse /
  // throttle / current DIRECTLY and the 3D motor (bell + prop) and every instrument respond
  // immediately. Requires a complete circuit (power + phase wired) and a valid calibration. On the
  // thermal stage it also seeds the P–I / T–I reference curve + passive-current threshold and
  // starts a fresh live temperature-vs-time trace.
  function onRunToggle() {
    if (state.running) { state.running = false; setNote('Simulation stopped — motor spinning down; ESC still armed.'); updateAll(); return; }
    if (state.circuit.damaged) { setMessage('This ESC is destroyed — select a replacement before running.'); return; }
    if (!state.circuit.power) { setMessage('Drag wires from the battery to the ESC power-input pads in the 3D view before running.'); return; }
    if (!state.circuit.phase) { setMessage('Drag all three phase wires from the ESC to the motor in the 3D view before running.'); return; }
    if (state.thermalShutdown) {
      if (state.currentTempC >= 80) { setMessage('ESC is in thermal shutdown — let it cool below 80 °C before re-running.'); return; }
      state.thermalShutdown = false;
    }
    if (!state.calibrated && state.mode !== 'thermal') { setMessage('Store valid endpoints before running the simulation.'); return; }
    state.armed = true;
    state.running = true;
    if (state.mode === 'thermal') { computeThermalCurves(); state.guide.sweptThermal = true; state.thermalSeries = []; }
    setNote(state.mode === 'thermal'
      ? 'Live thermal run — the junction climbs from the loaded I²R heat. Toggle the heatsink to bend the curve, or push the current to find 80 °C.'
      : 'Simulation running — drag the pulse / throttle and watch the motor RPM and instruments respond live.');
    updateAll();
  }

  // ── 3D bench (guarded: no-ops when THREE / the board model / WebGL are unavailable) ──
  let view = null;
  let splitLayer = null;   // professional exploded-view callout overlay (Tab 1)
  let _focusDir = null;    // reused vector for the gentle component-focus camera ease

  function initBase3DScene(canvas, wrapper, options) {
    const THREE = window.THREE;
    const scn = new THREE.Scene();
    scn.background = new THREE.Color(options.bgColor || 0xe9eef4);
    const w = (wrapper && wrapper.clientWidth) || 800, h = (wrapper && wrapper.clientHeight) || 360;
    const cam = new THREE.PerspectiveCamera(options.fov || 40, w / h, 0.01, 10);
    const cp = options.camPos || { x: 0.09, y: 0.07, z: 0.11 };
    cam.position.set(cp.x, cp.y, cp.z);

    const rndr = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
    rndr.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    rndr.setSize(w, h, false);
    if (options.enableShadows) { rndr.shadowMap.enabled = true; rndr.shadowMap.type = THREE.PCFSoftShadowMap; }
    if (rndr.outputColorSpace !== undefined && THREE.SRGBColorSpace) rndr.outputColorSpace = THREE.SRGBColorSpace;
    else if ('outputEncoding' in rndr && THREE.sRGBEncoding !== undefined) rndr.outputEncoding = THREE.sRGBEncoding;  // three r147 API (this build) — without it the PBR metals render dark
    // Filmic tone map + slight exposure lift so the studio-lit PBR metals match the approved
    // model preview (which uses the same ACES curve) instead of clipping to flat white/black.
    if (THREE.ACESFilmicToneMapping !== undefined) { rndr.toneMapping = THREE.ACESFilmicToneMapping; rndr.toneMappingExposure = 1.05; }
    if ('physicallyCorrectLights' in rndr) rndr.physicallyCorrectLights = true;

    const amb = new THREE.AmbientLight(0xffffff, options.ambientIntensity || 0.5);
    scn.add(amb);
    const sun = new THREE.DirectionalLight(0xffffff, options.sunIntensity || 1.05);
    const sp = options.sunPos || { x: 0.12, y: 0.22, z: 0.12 };
    sun.position.set(sp.x, sp.y, sp.z);
    if (options.enableShadows) {
      sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
      sun.shadow.camera.near = 0.01; sun.shadow.camera.far = 1;
      sun.shadow.camera.left = -0.1; sun.shadow.camera.right = 0.1;
      sun.shadow.camera.top = 0.1; sun.shadow.camera.bottom = -0.1;
      if (options.sunBias !== undefined) sun.shadow.bias = options.sunBias;
    }
    scn.add(sun);
    scn.add(new THREE.HemisphereLight(0xeaf1fb, 0xb8c0cc, 0.55));

    let ctrls = null;
    if (THREE.OrbitControls) {
      ctrls = new THREE.OrbitControls(cam, canvas);
      ctrls.enableDamping = true; ctrls.dampingFactor = 0.12;
      ctrls.enablePan = true;                 // drag with right mouse / two fingers to move around
      ctrls.screenSpacePanning = true;        // pan in the screen plane (natural up close)
      ctrls.rotateSpeed = 0.9;
      ctrls.zoomSpeed = 1.0;
      ctrls.panSpeed = 0.8;
      const co = options.ctrls || {};
      ctrls.minDistance = co.minDist || 0.02; // zoom right in…
      ctrls.maxDistance = co.maxDist || 2.0;  // …and far back out
      // Full orbit (top-down through to underneath) unless a stage explicitly clamps it.
      ctrls.minPolarAngle = co.minPolar !== undefined ? co.minPolar : 0;
      ctrls.maxPolarAngle = co.maxPolar !== undefined ? co.maxPolar : Math.PI;
      if (co.target) ctrls.target.set(co.target.x, co.target.y, co.target.z);
      // Any manual interaction cancels the component auto-focus ease so the user is never fought.
      ctrls.addEventListener('start', () => { if (view) view.focusActive = false; });
      ctrls.update();
    }

    function handleResize() {
      const ww = (wrapper && wrapper.clientWidth) || 800, hh = (wrapper && wrapper.clientHeight) || 360;
      cam.aspect = ww / hh; cam.updateProjectionMatrix(); rndr.setSize(ww, hh, false);
    }
    window.addEventListener('resize', handleResize);
    return { scn: scn, rndr: rndr, cam: cam, ctrls: ctrls, sun: sun, handleResize: handleResize };
  }

  function setup3D() {
    const canvas = $('benchCanvas');
    if (!canvas || !window.THREE || !window.EscBoardModel) return;
    try {
      const THREE = window.THREE;
      const wrap = canvas.parentElement;
      const base = initBase3DScene(canvas, wrap, {
        bgColor: 0xe9eef4, fov: 40, enableShadows: true,
        camPos: { x: 0.085, y: 0.07, z: 0.11 },
        ambientIntensity: 0.82, sunIntensity: 1.3, sunPos: { x: 0.1, y: 0.24, z: 0.12 }, sunBias: -0.00015,
        ctrls: { minDist: 0.02, maxDist: 2.0, target: { x: -0.012, y: 0.006, z: 0 } }
      });
      view = base;
      try { const env = window.EscBoardModel.makeStudioEnv(base.rndr); base.scn.environment = env; view.env = env; } catch (e) { /* env optional */ }
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xcfd6df, roughness: 0.96, metalness: 0.0 }));
      ground.rotation.x = -Math.PI / 2; ground.position.y = -0.0006; ground.receiveShadow = true; base.scn.add(ground);
      buildBoard3D();
      buildDcSupply3D();
      buildBattery3D();
      buildBatteryTerminals();
      initWiring();
      createSplitLayer();
      frameCamera();
      evaluateCircuit();   // re-derive power/phase from a restored session's wiring, if any
    } catch (e) { view = null; }
  }

  function buildBoard3D() {
    if (!view || !window.EscBoardModel) return;
    if (splitLayer) { splitLayer.labels.innerHTML = ''; splitLayer.chips = {}; splitLayer.svg.innerHTML = ''; }
    try {
      if (view.model) { view.scn.remove(view.model.group); if (view.model.dispose) view.model.dispose(); }
      view.prop = null;   // the old prop/motor were parented to the old assembly and disposed with it
      view.motor = null;
      view.model = window.EscBoardModel.build(state.esc, state.motor);
      view.model.setHeatsink(state.heatsink);
      view.scn.add(view.model.group);
      mountMotorAndProp();
      buildEscMotorTerminals();
    } catch (e) { /* keep the old model if rebuild fails */ }
  }

  // Bench prop spec — matches the drone's actual propeller from the shared build (Exp 1/3)
  // when present, else a sensible 6" 2-blade default.
  function pickPropSpec() {
    try {
      const b = window.VLABStore && window.VLABStore.get();
      const pid = b && b.components && b.components.propId;
      const cat = window.VLAB_CATALOG && window.VLAB_CATALOG.propellers;
      if (pid && cat) { const p = cat.find((x) => x.id === pid); if (p) return p; }
    } catch (e) { /* fall through to default */ }
    return { diameter_m: 0.1524, blades: 2, pitch_in: 4.5 };
  }

  // Mount the approved high-poly propeller on the board motor's shaft. Parented to the motor
  // group so it inherits the motor's position and auto-hides on the teardown tab; scaled to
  // bench proportions and spun from the live loaded RPM in render3D.
  function motorVizSpec() {
    const m = state.motor || {};
    const spec = { kv: m.kv || 2300, accent: 0xc2410c };
    // The first four digits of a motor designation are its stator ØD + height in mm
    // (e.g. "2207" → 22 mm Ø, 7 mm tall). The bell wraps the stator with a wall and a
    // closed can, so it runs a few mm larger — this feeds EscHwModels.buildMotor so the
    // outrunner on the bench is sized from the actually-selected motor.
    const code = String(m.label || m.id || '').match(/(\d{2})(\d{2})/);
    if (code) {
      spec.bell_diameter_mm = (+code[1]) + 6;
      spec.bell_height_mm = (+code[2]) + 12;
    }
    return spec;
  }

  // Mount the APPROVED high-poly outrunner (EscHwModels) + twisted propeller on the bench in
  // place of the board model's crude built-in bell. The crude bell is hidden (its phase-lead
  // wires stay, so the board still looks wired to the motor); the outrunner rides a short
  // thrust-stand pedestal so its own phase leads clear the deck, and the propeller bolts onto
  // the spinning bell so it turns with it. The whole assembly is parented into the board's
  // motorAssembly, so setMotorVisible() keeps auto-hiding it on the bare-board teardown tab.
  function mountMotorAndProp() {
    if (!view || !view.model || !window.EscHwModels || !window.EscHwModels.buildMotor) return;
    try {
      const THREE = window.THREE;
      if (view.model.motorGroup) view.model.motorGroup.visible = false;   // retire the crude bell
      const dimsL = (view.model.dims && view.model.dims.L) ? view.model.dims.L : 0.05;
      const mountX = -dimsL / 2 - 0.05;                        // same spot the crude motor used
      const lift = 0.018;                                      // pedestal height (leads clear the deck)

      const asm = new THREE.Group();
      asm.position.set(mountX, 0, 0);
      // The outrunner's phase pigtails exit on its local -X side; the board
      // sits at +X of the mount, so face the pigtails toward the ESC — the
      // motor's three phase wires must run INTO the board's phase leads, not
      // point away from the circuit.
      asm.rotation.y = Math.PI;

      // thrust-stand mount block the motor bolts down onto
      const ped = new THREE.Mesh(
        new THREE.BoxGeometry(0.019, lift, 0.019),
        new THREE.MeshStandardMaterial({ color: 0x2a2f37, roughness: 0.46, metalness: 0.7, envMapIntensity: 1.1 }));
      ped.position.y = lift / 2; ped.castShadow = true; ped.receiveShadow = true; asm.add(ped);

      const motor = window.EscHwModels.buildMotor(motorVizSpec());
      motor.group.position.y = lift;
      asm.add(motor.group);

      if (window.EscHwModels.buildPropeller) {
        const prop = window.EscHwModels.buildPropeller(pickPropSpec(), { color: 0x14181f });
        const targetR = 0.05;                                  // bench-scale prop radius
        const s = (prop.dims && prop.dims.R) ? targetR / prop.dims.R : 0.6;
        prop.group.scale.setScalar(s);
        const top = (motor.dims && motor.dims.top) ? motor.dims.top : 0.02;
        prop.group.position.y = top + 0.004;                   // just above the bell / prop-nut
        motor.spin.add(prop.group);                            // bolted to the bell → spins with it
        view.prop = prop;
      }

      view.model.motorAssembly.add(asm);
      view.motor = motor;
    } catch (e) { view.motor = null; view.prop = null; }
  }

  // The controllable bench DC supply that powers the ESC — built once, kept across ESC swaps.
  // Its lit V/A display is driven from the live bus voltage + phase current (updateDcSupply).
  function buildDcSupply3D() {
    if (!view || !window.EscHwModels || !window.EscHwModels.buildDcSupply) return;
    try {
      const dc = window.EscHwModels.buildDcSupply({ volts: busVoltageClean(), amps: 0, mode: 'CV', on: false });
      dc.group.scale.setScalar(0.42);                          // shrink the bench instrument to board scale
      dc.group.position.set(0.006, 0, -0.062);                 // behind the board, front panel toward the camera
      view.scn.add(dc.group);
      view.dc = dc;
    } catch (e) { view.dc = null; }
  }

  // Push the live operating point onto the DC-supply display — throttled to the shown precision
  // so the 7-seg canvas only redraws when a digit would actually change (no per-frame churn).
  let _dcSig = '';
  function updateDcSupply() {
    if (!view || !view.dc) return;
    const v = busVoltageClean();
    const iActive = state.armed && !state.thermalShutdown ? state.currentA : 0;
    const on = state.armed && !state.thermalShutdown;
    const mode = iActive > 0.05 ? 'CC' : 'CV';
    const sig = v.toFixed(1) + '|' + iActive.toFixed(1) + '|' + mode + '|' + on;
    if (sig === _dcSig) return;
    _dcSig = sig;
    view.dc.setVoltage(v); view.dc.setCurrent(iActive); view.dc.setMode(mode); view.dc.setOutputOn(on);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Free-form 3D drag-to-wire commissioning bench (Module 1 · mapping stage).
  // The student builds the real circuit by dragging wires between pickable
  // terminal posts — battery → ESC power input, ESC phase pads → motor. There
  // is no "correct slot" highlighting: any two terminals can be bridged, and
  // the electrical consequence (armed / destroyed / spins backward / won't
  // commutate) is derived exactly as a real BLDC/ESC would behave. See
  // evaluateCircuit() for the electrical model.
  // ═══════════════════════════════════════════════════════════════════════
  const POWER_TERMS = ['batt_pos', 'batt_neg', 'esc_in_pos', 'esc_in_neg'];
  const ESC_PHASE_TERMS = ['esc_A', 'esc_B', 'esc_C'];
  const MOTOR_PHASE_TERMS = ['mot_U', 'mot_V', 'mot_W'];

  function terminalKind(id) {
    if (id === 'batt_pos' || id === 'esc_in_pos') return 'pos';
    if (id === 'batt_neg' || id === 'esc_in_neg') return 'neg';
    return 'phase';
  }
  function wireColorFor(id) {
    const k = terminalKind(id);
    return k === 'pos' ? 0xcf2b27 : k === 'neg' ? 0x141414 : 0xd7b24e;
  }

  // Build a single pickable terminal: a small gold-tipped post (visible) plus a
  // larger invisible pick-sphere (forgiving raycast target — the visible knob
  // alone is too small to reliably hit).
  function makeTerminalMarker(id, color) {
    const THREE = window.THREE;
    const g = new THREE.Group();
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.0017, 16, 12),
      new THREE.MeshStandardMaterial({ color: color, roughness: 0.25, metalness: 0.85, emissive: color, emissiveIntensity: 0.22 }));
    g.add(knob);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.0006, 0.0006, 0.0034, 10),
      new THREE.MeshStandardMaterial({ color: 0x8a929c, roughness: 0.4, metalness: 0.7 }));
    post.position.y = -0.0017; g.add(post);
    const pick = new THREE.Mesh(new THREE.SphereGeometry(0.0062, 10, 8), new THREE.MeshBasicMaterial({ visible: false }));
    g.add(pick);
    g.userData.pickRole = 'terminal'; g.userData.termId = id;
    pick.userData.pickRole = 'terminal'; pick.userData.termId = id;
    return { group: g, knob: knob, pick: pick };
  }

  // Build the battery on the bench (Module 1 only — the wiring lesson's power
  // source). Kept across ESC/motor swaps like the DC supply; only its live
  // display would need updating on a battery-part change (not modelled here,
  // matching the existing DC-supply pattern).
  function buildBattery3D() {
    if (!view || !window.EscHwModels || !window.EscHwModels.buildBattery) return;
    try {
      const batt = window.EscHwModels.buildBattery(state.battery || {});
      batt.group.scale.setScalar(0.34);                       // bench-scale: the pack sits beside the board, it doesn't dwarf it
      // The pack powers the bench on BOTH modules (the HUD's bus voltage reads
      // the pack terminal), so it lives on every bench: parked past the +Z
      // board edge, rotated so its XT60 + discharge leads face the ESC's red/
      // black power pigtails — the power path reads battery → XT60 → ESC.
      batt.group.position.set(0.002, 0, 0.047);
      batt.group.rotation.y = Math.PI / 2;
      view.scn.add(batt.group);
      view.battery = batt;
    } catch (e) { view.battery = null; }
  }

  // Drop + fully dispose any previously-built markers for the given terminal
  // ids. Needed because buildBoard3D() rebuilds the ESC + motor groups on every
  // part swap — without this, re-running the terminal builder would pile up
  // duplicate pickable markers each time (the battery group, by contrast, is
  // built once and never rebuilt, so its terminals are built exactly once).
  function disposeTerminalSet(ids) {
    if (!view || !view.terminals) return;
    ids.forEach((id) => {
      const m = view.terminals[id];
      if (!m) return;
      m.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      if (m.group.parent) m.group.parent.remove(m.group);
      delete view.terminals[id];
    });
  }

  // (Re)build the ESC- and motor-side pickable terminals from the live model
  // geometry's local anchor points, parented to each part's own group so they
  // inherit its explode/position/rotation for free. Called whenever the board
  // (ESC swap) or motor is rebuilt.
  function buildEscMotorTerminals() {
    if (!view || onPage1 !== true) return;
    view.terminals = view.terminals || {};
    disposeTerminalSet(['esc_in_pos', 'esc_in_neg', 'esc_A', 'esc_B', 'esc_C', 'mot_U', 'mot_V', 'mot_W']);
    // Lead visibility is NOT set here — it's driven every frame in render3D()
    // from the live state.mode, so the calibration/explorer tab still shows
    // the fully-assembled anatomy and only the mapping tab bares the pads.
    if (view.model && view.model.terminals) {
      Object.keys(view.model.terminals).forEach((id) => {
        const t = view.model.terminals[id];
        const marker = makeTerminalMarker(id, wireColorFor(id));
        marker.group.position.set(t.x, t.y, t.z);
        view.model.group.add(marker.group);
        view.terminals[id] = marker;
      });
    }
    if (view.motor && view.motor.terminals) {
      Object.keys(view.motor.terminals).forEach((id) => {
        const t = view.motor.terminals[id];
        const marker = makeTerminalMarker(id, wireColorFor(id));
        marker.group.position.set(t.x, t.y, t.z);
        view.motor.group.add(marker.group);
        view.terminals[id] = marker;
      });
    }
  }

  // Battery terminals — built exactly once, right after buildBattery3D().
  function buildBatteryTerminals() {
    if (!view || onPage1 !== true || !view.battery || !view.battery.terminals) return;
    view.terminals = view.terminals || {};
    disposeTerminalSet(['batt_pos', 'batt_neg']);
    Object.keys(view.battery.terminals).forEach((id) => {
      const t = view.battery.terminals[id];
      const marker = makeTerminalMarker(id, wireColorFor(id));
      marker.group.position.set(t.x, t.y, t.z);
      view.battery.group.add(marker.group);
      view.terminals[id] = marker;
    });
  }

  function terminalWorldPos(id) {
    const t = view && view.terminals && view.terminals[id];
    if (!t) return null;
    const v = new window.THREE.Vector3();
    t.group.getWorldPosition(v);
    return v;
  }

  // A gentle-sag tube between two world points — used for both the live
  // rubber-band (while dragging) and every committed wire (rebuilt each frame
  // from live terminal world positions, so wires track camera-independent
  // motion like the explode animation for free).
  function makeWireTube(p1, p2, color, radius) {
    const THREE = window.THREE;
    const mid = p1.clone().lerp(p2, 0.5); mid.y += 0.006 + p1.distanceTo(p2) * 0.06;
    const curve = new THREE.CatmullRomCurve3([p1, mid, p2]);
    const geo = new THREE.TubeGeometry(curve, 20, radius || 0.0011, 8, false);
    const mat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.5, metalness: 0.0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    return mesh;
  }

  function rebuildCommittedWires() {
    if (!view) return;
    (view.wireMeshes || []).forEach((w) => { if (w.mesh) { view.scn.remove(w.mesh); w.mesh.geometry.dispose(); w.mesh.material.dispose(); } });
    view.wireMeshes = state.wiring.connections.map((c, i) => {
      const p1 = terminalWorldPos(c.a), p2 = terminalWorldPos(c.b);
      if (!p1 || !p2) return { mesh: null, a: c.a, b: c.b };
      const mesh = makeWireTube(p1, p2, wireColorFor(c.a));
      mesh.userData.pickRole = 'wire'; mesh.userData.wireIndex = i;
      view.scn.add(mesh);
      return { mesh: mesh, a: c.a, b: c.b };
    });
  }

  function updateRubberBand() {
    if (!view) return;
    const p1 = terminalWorldPos(state.wiring.dragFrom), p2 = state.wiring.dragPoint;
    if (!p1 || !p2) return;
    if (view.rubberBand) { view.scn.remove(view.rubberBand); view.rubberBand.geometry.dispose(); view.rubberBand.material.dispose(); }
    view.rubberBand = makeWireTube(p1, p2, 0xe2e8f0, 0.0009);
    view.rubberBand.material.transparent = true; view.rubberBand.material.opacity = 0.85;
    view.scn.add(view.rubberBand);
  }
  function clearRubberBand() {
    if (view && view.rubberBand) { view.scn.remove(view.rubberBand); view.rubberBand.geometry.dispose(); view.rubberBand.material.dispose(); view.rubberBand = null; }
  }

  function highlightTerminal(hoverId) {
    if (!view || !view.terminals) return;
    Object.keys(view.terminals).forEach((id) => {
      const m = view.terminals[id];
      m.knob.material.emissiveIntensity = (id === hoverId) ? 0.9 : 0.22;
      m.knob.scale.setScalar(id === hoverId ? 1.5 : 1);
    });
  }

  function hasConnection(a, b) {
    return state.wiring.connections.some((c) => (c.a === a && c.b === b) || (c.a === b && c.b === a));
  }

  // ── Real-hardware electrical interpretation of the wiring graph ───────────
  function powerState() {
    const conns = state.wiring.connections.filter((c) => POWER_TERMS.indexOf(c.a) >= 0 && POWER_TERMS.indexOf(c.b) >= 0);
    const wired = (a, b) => conns.some((c) => (c.a === a && c.b === b) || (c.a === b && c.b === a));
    return {
      shortDirect: wired('batt_pos', 'batt_neg') || wired('esc_in_pos', 'esc_in_neg'),
      correct: wired('batt_pos', 'esc_in_pos') && wired('batt_neg', 'esc_in_neg'),
      reversed: wired('batt_pos', 'esc_in_neg') || wired('batt_neg', 'esc_in_pos')
    };
  }
  // Phase mapping esc pad -> motor terminal, and its permutation parity vs the
  // canonical A->U, B->V, C->W wiring. Swapping any TWO phase wires is an odd
  // permutation and reverses rotation — the real "any two, not all three"
  // BLDC rule; cycling all three (an even permutation) still spins forward.
  function phaseState() {
    const conns = state.wiring.connections.filter((c) =>
      (ESC_PHASE_TERMS.indexOf(c.a) >= 0 && MOTOR_PHASE_TERMS.indexOf(c.b) >= 0) ||
      (ESC_PHASE_TERMS.indexOf(c.b) >= 0 && MOTOR_PHASE_TERMS.indexOf(c.a) >= 0));
    const shorted = state.wiring.connections.some((c) => ESC_PHASE_TERMS.indexOf(c.a) >= 0 && ESC_PHASE_TERMS.indexOf(c.b) >= 0);
    const map = {}; let duplicateEsc = false, duplicateMotor = false;
    const usedMotor = {};
    conns.forEach((c) => {
      const escPad = ESC_PHASE_TERMS.indexOf(c.a) >= 0 ? c.a : c.b;
      const motTerm = ESC_PHASE_TERMS.indexOf(c.a) >= 0 ? c.b : c.a;
      if (map[escPad] !== undefined) duplicateEsc = true;
      if (usedMotor[motTerm]) duplicateMotor = true;
      usedMotor[motTerm] = true;
      map[escPad] = motTerm;
    });
    const complete = !shorted && !duplicateEsc && !duplicateMotor && Object.keys(map).length === 3;
    let reversed = false;
    if (complete) {
      const idxOf = { mot_U: 0, mot_V: 1, mot_W: 2 };
      const perm = ESC_PHASE_TERMS.map((k) => idxOf[map[k]]);
      let inversions = 0;
      for (let i = 0; i < perm.length; i++) for (let j = i + 1; j < perm.length; j++) if (perm[i] > perm[j]) inversions++;
      reversed = (inversions % 2) === 1;
    }
    return { complete: complete, reversed: reversed, shorted: shorted, duplicate: duplicateEsc || duplicateMotor };
  }

  function onEscDestroyed(kind) {
    state.circuit.damaged = true; state.circuit.power = false;
    state.armed = false; state.running = false;
    if (view && view.model && view.model.setDamaged) view.model.setDamaged(true);
    SFX.error();
    const msg = kind === 'short'
      ? 'CRITICAL FAILURE: dead short across the power rails. The bulk capacitor and MOSFETs failed instantly — select a replacement ESC.'
      : 'CRITICAL FAILURE: reverse battery polarity. This ESC has no reverse-voltage protection — current drove straight through the MOSFET body diodes and destroyed the board. Select a replacement ESC.';
    setMessage(msg);
    if (window.Instructor) window.Instructor.say(msg);
  }

  // Re-derive circuit.power / circuit.phase / circuit.reversed / circuit.damaged
  // from the current wiring graph. Called after every commit/removal and once
  // on boot (so a restored session's wiring takes effect immediately).
  function evaluateCircuit() {
    if (onPage1 !== true) return;   // Module 2 defaults power=phase=true at boot; not wiring-driven
    if (!state.circuit.damaged) {
      const ps = powerState();
      if (ps.shortDirect) { onEscDestroyed('short'); }
      else if (ps.reversed) { onEscDestroyed('reverse'); }
      else { state.circuit.power = ps.correct; }
    } else {
      state.circuit.power = false;
    }
    const phs = phaseState();
    state.circuit.phase = phs.complete;
    state.circuit.reversed = phs.complete && phs.reversed;
    if (phs.complete && phs.reversed && !state._warnedReversed) {
      state._warnedReversed = true;
      const msg = 'OBSERVE: rotation is reversed. Exactly two phase wires are swapped relative to the canonical mapping — on a real quad a reversed motor fights the others and flips the craft on takeoff.';
      setNote(msg);
      if (window.Instructor) window.Instructor.say(msg);
    } else if (!(phs.complete && phs.reversed)) {
      state._warnedReversed = false;
    }
  }

  // ── Pointer interaction: raycast-drag terminals into committed wires ──────
  let wiringRay = null, wiringMouse = null;
  function pointerNdc(e, canvas) {
    const r = canvas.getBoundingClientRect();
    wiringMouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }
  function raycastTerminal(e, canvas) {
    if (!view || !view.terminals) return null;
    pointerNdc(e, canvas);
    wiringRay.setFromCamera(wiringMouse, view.cam);
    const ids = Object.keys(view.terminals);
    const objs = ids.map((id) => view.terminals[id].pick);
    const hits = wiringRay.intersectObjects(objs, false);
    return hits.length ? hits[0].object.userData.termId : null;
  }
  function raycastWire(e, canvas) {
    if (!view || !view.wireMeshes) return null;
    pointerNdc(e, canvas);
    wiringRay.setFromCamera(wiringMouse, view.cam);
    const objs = view.wireMeshes.map((w) => w.mesh).filter(Boolean);
    const hits = wiringRay.intersectObjects(objs, false);
    return hits.length ? hits[0].object.userData.wireIndex : null;
  }
  function onWireDown(e) {
    if (state.mode !== 'mapping' || !view || !view.terminals) return;
    const canvas = $('benchCanvas');
    const hitTerm = raycastTerminal(e, canvas);
    if (hitTerm) {
      state.wiring.dragFrom = hitTerm;
      state.wiring.dragPoint = terminalWorldPos(hitTerm);
      if (view.ctrls) view.ctrls.enabled = false;
      e.preventDefault();
      return;
    }
    const wireIdx = raycastWire(e, canvas);
    if (wireIdx != null) {
      state.wiring.connections.splice(wireIdx, 1);
      rebuildCommittedWires();
      evaluateCircuit();
      SFX.click();
      updateAll();
    }
  }
  function onWireMove(e) {
    if (!view) return;
    const canvas = $('benchCanvas');
    if (!canvas) return;
    if (state.wiring.dragFrom) {
      pointerNdc(e, canvas);
      wiringRay.setFromCamera(wiringMouse, view.cam);
      const srcPos = terminalWorldPos(state.wiring.dragFrom);
      if (srcPos) {
        const camDir = new window.THREE.Vector3(); view.cam.getWorldDirection(camDir);
        const plane = new window.THREE.Plane().setFromNormalAndCoplanarPoint(camDir, srcPos);
        const pt = new window.THREE.Vector3();
        if (wiringRay.ray.intersectPlane(plane, pt)) { state.wiring.dragPoint = pt; updateRubberBand(); }
      }
      const hoverId = raycastTerminal(e, canvas);
      highlightTerminal(hoverId);
    } else if (state.mode === 'mapping') {
      highlightTerminal(raycastTerminal(e, canvas));
    }
  }
  function onWireUp(e) {
    if (!state.wiring.dragFrom || !view) return;
    const canvas = $('benchCanvas');
    const from = state.wiring.dragFrom;
    const to = raycastTerminal(e, canvas);
    state.wiring.dragFrom = null; state.wiring.dragPoint = null;
    clearRubberBand();
    highlightTerminal(null);
    if (view.ctrls) view.ctrls.enabled = true;
    if (to && to !== from && !hasConnection(from, to)) {
      state.wiring.connections.push({ a: from, b: to });
      SFX.lock();
      rebuildCommittedWires();
      evaluateCircuit();
      updateAll();
    }
  }
  function initWiring() {
    if (onPage1 !== true || !window.THREE) return;
    const canvas = $('benchCanvas');
    if (!canvas) return;
    wiringRay = new window.THREE.Raycaster();
    wiringMouse = new window.THREE.Vector2();
    canvas.addEventListener('pointerdown', onWireDown);
    canvas.addEventListener('pointermove', onWireMove);
    window.addEventListener('pointerup', onWireUp);
  }

  function render3D(dt) {
    if (!view || !view.model) return;
    const op = thermalPoint();
    const rpm = state.armed && !state.thermalShutdown ? currentRpm() : 0;
    view.model.setRpm(rpm);
    // Drive the motor buzz + propeller whoosh pitch/volume off the same live RPM
    // that animates the visual spin (no per-build propeller selection in this
    // experiment, so no size term — same rpm reference used by every ESC/motor
    // combo's free-run KV*V ceiling).
    if (window.SFX && window.SFX.motorRate) {
      const maxRpm = Math.max(4000, (state.motor && state.motor.kv || 1800) * busVoltage());
      window.SFX.motorRate(Calc.clamp(rpm / maxRpm, 0, 1.3), 1);
    }
    view.model.setTemperature(op.T_c, ambientC(), 100);
    view.model.setHeatsink(state.heatsink);
    // Tab 1 is the bare-board teardown — hide the motor + its leads there; show them
    // on the live-spin tabs (mapping / thermal) where the bell actually turns.
    if (view.model.setMotorVisible) view.model.setMotorVisible(state.mode !== 'calibration');
    // Ease the explode factor toward its target so the split view assembles/expands smoothly.
    // The target is the student-set spread (Teardown Controls slider), not just on/off.
    const tgt = state.exploded ? state.explodeAmt : 0;
    view.explodeT = (view.explodeT === undefined) ? tgt : view.explodeT + (tgt - view.explodeT) * Math.min(1, dt * 4.5);
    if (Math.abs(view.explodeT - tgt) < 0.0015) view.explodeT = tgt;
    view.model.setExploded(view.explodeT);
    // Slow inspection turntable (teardown tab only) — spins the whole board so the student can
    // read every callout hands-free; eases back upright when switched off or on another tab.
    if (state.mode === 'calibration' && state.spinView) { view.model.group.rotation.y += dt * 0.5; }
    else if (view.model.group.rotation.y) {
      view.model.group.rotation.y *= Math.max(0, 1 - dt * 4);
      if (Math.abs(view.model.group.rotation.y) < 0.002) view.model.group.rotation.y = 0;
    }
    view.model.tick(dt, op.T_c > 90);
    // Drive the approved outrunner (its propeller is bolted to the bell, so it spins with it).
    // The whole assembly lives in the board's motorAssembly, so setMotorVisible() already
    // auto-hides it on the bare-board teardown tab. A reversed phase mapping (two swapped
    // wires) spins it backward — the real BLDC consequence, not a cosmetic flag.
    const signedRpm = state.circuit.reversed ? -rpm : rpm;
    if (view.motor) { view.motor.setRpm(signedRpm); view.motor.tick(dt); }
    // The battery IS the power source for Module 1's commissioning bench (the
    // wiring lesson); the bench DC supply is Module 2's sustained-load source.
    // Showing both at once reads as two redundant batteries sitting there —
    // exactly one power source is visible on any given tab.
    if (view.dc) view.dc.group.visible = !onPage1;
    if (view.battery) view.battery.group.visible = state.mode === 'mapping';
    if (view.terminals) {
      const showTerms = state.mode === 'mapping';
      Object.keys(view.terminals).forEach((id) => { view.terminals[id].group.visible = showTerms; });
    }
    // Power/phase leads are pre-wired everywhere EXCEPT the mapping stage,
    // where the student wires them by hand — driven every frame (not a
    // one-time build-time call) so the calibration/explorer tab still shows
    // the fully-assembled anatomy for inspection.
    if (view.model && view.model.setLeadsVisible) view.model.setLeadsVisible(state.mode !== 'mapping');
    if (view.motor && view.motor.setLeadsVisible) view.motor.setLeadsVisible(state.mode !== 'mapping');
    if (state.mode === 'mapping') rebuildCommittedWires();
    else if (view.wireMeshes && view.wireMeshes.length) {
      view.wireMeshes.forEach((w) => { if (w.mesh) { view.scn.remove(w.mesh); w.mesh.geometry.dispose(); w.mesh.material.dispose(); } });
      view.wireMeshes = [];
    }
    // Tab 1 explorer: gently recenter + zoom the camera onto a selected component.
    if (state.mode === 'calibration' && view.focusActive && view.ctrls && view.focusTarget) {
      const THREE = window.THREE;
      view.focusBlend = Math.min(1, (view.focusBlend || 0) + dt * 2.2);
      const tg = view.ctrls.target, ft = view.focusTarget, f = 0.12;
      tg.set(tg.x + (ft.x - tg.x) * f, tg.y + (ft.y - tg.y) * f, tg.z + (ft.z - tg.z) * f);
      if (!_focusDir) _focusDir = new THREE.Vector3();
      _focusDir.subVectors(view.cam.position, tg);
      const curDist = _focusDir.length() || 0.15;
      _focusDir.setLength(curDist + (0.10 - curDist) * 0.08);
      view.cam.position.copy(tg).add(_focusDir);
      if (view.focusBlend >= 1) view.focusActive = false;
    }
    if (view.ctrls) view.ctrls.update();
    view.rndr.render(view.scn, view.cam);
    updateSplitLabels();
  }

  // ── Frame the camera per stage (Tab 1 pulls back for the exploded teardown) ──
  function frameCamera() {
    if (!view || !view.cam) return;
    view.focusActive = false;
    const cal = state.mode === 'calibration';
    // Non-explorer stages pull back and aim slightly +Z so the whole power
    // path — battery pack, XT60, ESC, phase leads, motor — fits one frame.
    const pos = cal ? { x: 0.048, y: 0.078, z: 0.128 } : { x: 0.098, y: 0.085, z: 0.135 };
    const tgt = cal ? { x: 0, y: 0.016, z: 0 } : { x: -0.010, y: 0.004, z: 0.012 };
    view.cam.position.set(pos.x, pos.y, pos.z);
    if (view.ctrls) { view.ctrls.target.set(tgt.x, tgt.y, tgt.z); view.ctrls.update(); }
  }

  // ── Component selection (Tab 1 explorer) ──────────────────────────────────────
  function selectComponent(key) {
    state.selectedPart = (key && COMPONENTS[key]) ? key : null;
    if (state.selectedPart && state.guide.viewedParts.indexOf(state.selectedPart) < 0) state.guide.viewedParts.push(state.selectedPart);
    focusOnComponent(state.selectedPart);
    updateAll();
  }
  // Aim the gentle camera ease at the selected part's live (exploded) world position.
  function focusOnComponent(key) {
    if (!view) return;
    if (!key || !view.model || !view.model.labelAnchors) { view.focusActive = false; return; }
    const anchors = view.model.labelAnchors();
    let hit = null;
    for (let i = 0; i < anchors.length; i++) { if (compKey(anchors[i].name) === key) { hit = anchors[i]; break; } }
    if (!hit) { view.focusActive = false; return; }
    view.focusTarget = { x: hit.x, y: hit.y, z: hit.z };
    view.focusActive = true; view.focusBlend = 0;
  }

  // ── Professional exploded-view callouts: project each labelled part to screen,
  //    stack the labels along the left/right margins, and draw leader lines + dots. ──
  function createSplitLayer() {
    const wrap = document.querySelector('.canvas-wrapper');
    if (!wrap || wrap.querySelector('.split-overlay')) return;
    const overlay = document.createElement('div'); overlay.className = 'split-overlay';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'split-svg');
    const labels = document.createElement('div'); labels.className = 'split-labels';
    const title = document.createElement('div'); title.className = 'split-title';
    overlay.appendChild(svg); overlay.appendChild(labels); overlay.appendChild(title);
    wrap.appendChild(overlay);
    splitLayer = { wrap, overlay, svg, labels, title, chips: {} };
  }

  let _projV = null;
  function updateSplitLabels() {
    if (!splitLayer) return;
    const active = state.mode === 'calibration' && view && view.model && view.model.labelAnchors;
    if (!active) { splitLayer.overlay.style.display = 'none'; return; }
    const wrap = splitLayer.wrap, W = wrap.clientWidth, H = wrap.clientHeight;
    if (!W || !H) { splitLayer.overlay.style.display = 'none'; return; }
    splitLayer.overlay.style.display = 'block';
    splitLayer.title.textContent = 'EXPLODED VIEW · ' + (view.model.name || 'ESC');
    if (!_projV) _projV = new window.THREE.Vector3();
    const cam = view.cam, anchors = view.model.labelAnchors(), ent = [];
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      _projV.set(a.x, a.y, a.z).project(cam);
      if (_projV.z > 1 || _projV.z < -1) continue;             // behind camera / clipped
      ent.push({ name: a.name, sx: (_projV.x * 0.5 + 0.5) * W, sy: (-_projV.y * 0.5 + 0.5) * H });
    }
    const seen = {};
    const left = ent.filter((e) => e.sx < W * 0.5).sort((p, q) => p.sy - q.sy);
    const right = ent.filter((e) => e.sx >= W * 0.5).sort((p, q) => p.sy - q.sy);
    const place = (list, side) => {
      const n = list.length; if (!n) return;
      const pad = 16, usable = Math.max(1, H - pad * 2);
      list.forEach((e, i) => {
        const slotY = n === 1 ? H * 0.5 : pad + usable * (i / (n - 1));
        let chip = splitLayer.chips[e.name];
        if (!chip) {
          chip = document.createElement('div'); chip.className = 'split-callout'; chip.textContent = e.name;
          chip.dataset.key = compKey(e.name) || '';
          chip.addEventListener('click', () => { if (chip.dataset.key) selectComponent(chip.dataset.key); });
          splitLayer.labels.appendChild(chip); splitLayer.chips[e.name] = chip;
        }
        chip.style.display = 'block'; chip.style.top = slotY + 'px';
        if (side === 'L') { chip.style.left = pad + 'px'; chip.style.right = 'auto'; } else { chip.style.right = pad + 'px'; chip.style.left = 'auto'; }
        e.side = side; seen[e.name] = true;
      });
    };
    place(left, 'L'); place(right, 'R');
    Object.keys(splitLayer.chips).forEach((n) => {
      const ch = splitLayer.chips[n];
      if (!seen[n]) ch.style.display = 'none';
      ch.classList.toggle('active', !!state.selectedPart && ch.dataset.key === state.selectedPart);
    });
    const wr = wrap.getBoundingClientRect();
    let svg = '';
    ent.forEach((e) => {
      const chip = splitLayer.chips[e.name]; if (!chip) return;
      const r = chip.getBoundingClientRect();
      const innerX = e.side === 'L' ? (r.right - wr.left) : (r.left - wr.left);
      const innerY = (r.top - wr.top) + r.height / 2;
      const sel = !!state.selectedPart && compKey(e.name) === state.selectedPart;
      svg += '<line x1="' + innerX.toFixed(1) + '" y1="' + innerY.toFixed(1) + '" x2="' + e.sx.toFixed(1) + '" y2="' + e.sy.toFixed(1) + '" class="split-line' + (sel ? ' sel' : '') + '"/>';
      if (sel) svg += '<circle cx="' + e.sx.toFixed(1) + '" cy="' + e.sy.toFixed(1) + '" r="9" class="split-ring"/>';
      svg += '<circle cx="' + e.sx.toFixed(1) + '" cy="' + e.sy.toFixed(1) + '" r="' + (sel ? 4.6 : 3.2) + '" class="split-dot' + (sel ? ' sel' : '') + '"/>';
    });
    splitLayer.svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    splitLayer.svg.innerHTML = svg;
  }

  // ── physics ──────────────────────────────────────────────────────────────────
  function ambientC() { return state.ambientC; }

  // ── circuit gating (drag-to-connect, Tab 3D) ─────────────────────────────────
  // power  : battery / bench-supply leads wired to the ESC power input → ESC can arm.
  // phase  : ESC phase leads wired to the motor → torque can reach the rotor.
  function circuitComplete() { return !!(state.circuit.power && state.circuit.phase); }
  // ESC is energised: powered + armed + not in thermal shutdown (steady-state analysis valid).
  function escPowered() { return !!(state.circuit.power && state.armed && !state.thermalShutdown); }
  // Motor is actually being driven: full circuit + armed + the live drive toggle.
  // On mapping/thermal that toggle is the "Run simulation" button; on the
  // Protocol & Latency stage it is the scope demo's Play state — the bench
  // motor tracks the commanded throttle while the demo runs, and stops with it.
  // Phase current only flows (and heat only builds) when this is true.
  function motorDriven() {
    const live = state.mode === 'timing' ? !!(state.scope && state.scope.playing) : state.running;
    return circuitComplete() && state.armed && live && !state.thermalShutdown;
  }

  // The phase current the ESC actually carries at the live operating point. On the thermal stage
  // the student sets it directly with the current slider (the chosen loaded operating point);
  // on every other stage it follows the prop-load model from the LIVE throttle
  // (I ≈ I0 + (I_full − I0)·throttle^1.5), so pushing the stick draws more current and makes more
  // heat — the genuine loaded coupling (see Calc.loadedCurrent).
  function phaseCurrentA() {
    if (state.mode === 'thermal') return state.currentA;
    const full = (state.motor && state.motor.full_current_a) || state.currentA;
    const i0 = (state.motor && state.motor.i0_a) || 0.5;
    return Calc.loadedCurrent(effectiveThrottle(), full, i0);
  }

  function endpoints() {
    if (state.fault === 'inverted') return { min: 2000, max: 1000 };
    if (state.fault === 'highmin') return { min: 1300, max: 2000 };
    return { min: 1000, max: 2000 };
  }

  // The live arm dead-band, in µs. Real ESCs scatter unit-to-unit (seeded per ESC
  // id, ≈35–65 µs — Calc.deadbandForEsc), so the "motor just starts to move" point
  // the student discovers by stepping is NOT the textbook 50 µs. An UNCALIBRATED
  // unit (endpoints never stored for this board) sits well up the stick: the factory
  // window is offset +80 µs until the student stores endpoints, so idle creep and a
  // dead low-stick are real, teachable faults rather than abstractions.
  function escDeadband() {
    const base = (state.esc && typeof state.esc.deadband_us === 'number') ? state.esc.deadband_us : Calc.DEADBAND_US;
    return base + (state.calibrated ? 0 : 80);
  }

  function rawThrottle() {
    const ep = endpoints();
    return Calc.throttleFromPulse(state.pulseUs, ep.min, ep.max);
  }

  function effectiveThrottle() {
    const ep = endpoints();
    if (!state.armed || state.thermalShutdown) return 0;
    const jitter = state.fault === 'jitter' ? Math.sin(state.phase * 5.1) * 14 : 0;
    // Protocol & Latency drives the motor from the SAME command the scope
    // plots (the Command throttle slider), so what the student sees on the
    // trace is what the bench motor does.
    const pw = (state.mode === 'timing' && state.scope)
      ? Calc.pulseFromThrottle(state.scope.cmdPct, ep.min, ep.max)
      : state.pulseUs;
    return Calc.effectiveThrottle(pw + jitter, escDeadband(), ep.min, ep.max);
  }

  // Battery pack terminal voltage — genuinely computed from cell count + state-of-charge.
  // Bus-ripple fault (bulk capacitor removed / long battery leads) superimposes switching
  // ripple + lead-inductance spikes on the rail; fitting the low-ESR cap cleans it up.
  function rippleActive() { return state.fault === 'ripple' && !state.capFitted; }
  function busVoltage() {
    const v = Calc.packVoltage(state.battery ? state.battery.cells : 4, state.soc);
    if (!rippleActive()) return v;
    const load = state.armed && !state.thermalShutdown ? Calc.clamp(state.currentA / 80, 0, 1) : 0.08;
    return v + Math.sin(state.phase * 23.5) * (0.6 + 2.6 * load);
  }
  // Clean (un-rippled) DC-bus voltage the MOSFETs switch — used for the switching-loss maths so
  // the power readout stays steady even while the ripple-fault animation wobbles the shown bus.
  function busVoltageClean() { return Calc.packVoltage(state.battery ? state.battery.cells : 4, state.soc); }
  // ESC motor-PWM carrier frequency. Modern ESCs run a higher carrier on digital (DShot) links
  // for smoother, lower-latency control — at the cost of extra switching loss; legacy analog PWM
  // keeps the classic ~24 kHz carrier. This is what makes the timing stage's latency-vs-heat real.
  function carrierHz() {
    const p = state.protocol;
    if (p && p.type === 'digital') return 48000;
    return Calc.F_PWM_CARRIER_HZ;
  }

  // ESC desync: analog-PWM firmware loses sensorless commutation lock under a hard throttle
  // step (aggressive timing / high-kv). A digital protocol (DShot) closes the loop and holds
  // sync, so switching to DShot — or backing off throttle — resolves it.
  function desyncActive() {
    if (state.fault !== 'desync' || !state.armed || state.thermalShutdown) return false;
    if (state.protocol && state.protocol.type === 'digital') return false;
    return effectiveThrottle() > 65;
  }

  // Loaded rotor speed via real back-EMF: the PWM duty averages the bus onto the motor,
  // then RPM = kv·(V_applied − I·R_total). The rotor only turns when the circuit is complete,
  // the ESC is armed and the live simulation is running (motorDriven); otherwise it is stopped.
  function currentRpm() {
    if (!motorDriven() || desyncActive()) return 0;   // no circuit / not running / lost commutation → stalled
    const iActive = phaseCurrentA();
    const rTotal = (state.motor.rm_ohm || 0) + (state.esc.rds_on_ohm || 0);
    // The thermal stage has NO throttle stick — the student sets the loaded phase
    // current directly. Driving vApplied off effectiveThrottle() there collapses
    // to ~0 V, so the bell was frozen while heat built. Run the motor at the full
    // bus for the operating point the current slider defines, so it visibly spins
    // (loadedRpm still subtracts the I·R drop, so heavier load reads slightly slower).
    const vApplied = state.mode === 'thermal'
      ? busVoltage()
      : (effectiveThrottle() / 100) * busVoltage();
    return Calc.loadedRpm(state.motor.kv || 1800, vApplied, iActive, rTotal);
  }

  // Instantaneous conduction loss at the live junction temperature (hot model = R climbs with T),
  // plus the (temperature-independent) switching loss at the current carrier — total ESC heat.
  // Phase current only flows while the motor is being driven (complete circuit + armed + running),
  // so a stopped / unplugged bench dissipates nothing and cools toward ambient.
  function thermalPoint() {
    const r25 = state.esc.rds_on_ohm;
    const rActive = state.hotModel ? Calc.resistanceAtTemp(r25, state.currentTempC) : r25;
    const iActive = motorDriven() ? phaseCurrentA() : 0;
    const pCond = Calc.escDissipation(iActive, rActive);
    const pSwitch = Calc.switchingLoss(busVoltageClean(), iActive, carrierHz());
    return { P_w: pCond + pSwitch, P_cond_w: pCond, P_switch_w: pSwitch, R_ohm: rActive, T_c: state.currentTempC, I_a: iActive };
  }

  function protocolLatency() {
    const p = state.protocol;
    if (!p) return 0;
    return p.type === 'digital' ? Calc.digitalFrameTimeUs(p.bitrate_bps, p.frame_bits) / 1000 : Calc.refreshLatencyMs(p.refresh_hz);
  }

  function thermalRth() {
    const th = state.db.thermal || fallbackDb.thermal;
    return state.heatsink ? th.r_th_heatsink_c_per_w : (state.esc.r_th_c_per_w || th.r_th_bare_c_per_w);
  }

  // Real first-order lumped-capacitance integration:  C_th dT/dt = P_in − (T − T_amb)/R_th.
  // C_th = mass·cp and τ = R_th·C_th (~minutes), so we fast-forward time to keep it watchable.
  function integrateThermal(dt) {
    const th = state.db.thermal || fallbackDb.thermal;
    const rTh = thermalRth();
    const r25 = state.esc.rds_on_ohm;
    const amb = ambientC();
    const rActive = state.hotModel ? Calc.resistanceAtTemp(r25, state.currentTempC) : r25;
    // Heat only flows when the motor is actually being driven (complete circuit + armed + running);
    // the loaded phase current climbs with throttle (prop-load model), so more stick → more I²R.
    const iActive = motorDriven() ? phaseCurrentA() : 0;
    const pCond = Calc.escDissipation(iActive, rActive);
    const pSwitch = Calc.switchingLoss(busVoltageClean(), iActive, carrierHz());
    const pActive = pCond + pSwitch;   // total heat into the board = conduction + switching
    const massG = (state.esc.mass_g_each || 9.5) + (state.heatsink ? (th.heatsink_mass_g || 12) : 0);
    const cTh = Calc.thermalCapacitance(massG, th.cp_j_per_kg_k || 800);
    const ff = th.sim_fast_forward || 30;
    const dTdt = (pActive - (state.currentTempC - amb) / rTh) / cTh;   // °C / s
    state.currentTempC += dTdt * dt * ff;
    if (state.currentTempC < amb) state.currentTempC = amb;
    if (state.currentTempC >= 100 && !state.thermalShutdown) {
      state.thermalShutdown = true; state.armed = false; state.running = false;
    }
    // Live temperature-vs-time / I²R-vs-time trace for the thermal-stage chart (only while running).
    if (state.running && state.mode === 'thermal') {
      if (!state.thermalSeries) state.thermalSeries = [];
      const s = state.thermalSeries;
      const tPrev = s.length ? s[s.length - 1].t : 0;
      s.push({ t: tPrev + dt * ff, T: state.currentTempC, P: pActive, I: iActive });
      if (s.length > 900) s.shift();
    }
  }

  function loop(now) {
    if (state.lastTime === null) state.lastTime = now;
    let dt = (now - state.lastTime) / 1000; state.lastTime = now;
    if (!isFinite(dt) || dt < 0) dt = 0;
    if (dt > 0.1) dt = 0.1;
    state.phase = now / 1000;

    // Protocol & Latency has no Run/Arm control of its own, so after a thermal
    // cutout the bench recovers the way real BLHeli firmware does: once the
    // junction cools below 75 °C the ESC re-arms itself and the demo can spin
    // the motor again. (The Thermal stage keeps its deliberate manual restart.)
    if (state.mode === 'timing' && state.thermalShutdown && state.currentTempC < 75) {
      state.thermalShutdown = false; state.armed = true;
    }
    // Advance the latency-scope playhead across its window at a student-controlled (slow) speed,
    // so a 20 ms lag unfolds over seconds instead of flashing past in real time.
    if (state.mode === 'timing' && state.scope) {
      const sc = state.scope;
      if (sc.playing) {
        const crossSec = 12 - (sc.speedPct / 100) * 10.3;      // ~12 s (slow) … ~1.7 s (fast) per sweep
        sc.sweep += dt / Math.max(0.3, crossSec);
        if (sc.sweep >= 1) {
          if (sc.oneShot) { sc.sweep = 1; sc.playing = false; setText('scopePlayBtn', '▶ Play'); }
          else sc.sweep -= 1;
        }
      }
    }
    integrateThermal(dt);
    // Pause the panel rebuild only while a native <select> popup is open (see _formBusy), so a
    // freshly-opened dropdown is not torn down under the pointer. The 3D scene keeps ticking.
    if (!_formBusy) updateAll();
    if (window.SFX) window.SFX.motor(motorDriven());
    render3D(dt);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(loop);
  }

  // ── master update (HUD + metrics + derivations + tables + charts + persistence) ──
  function updateAll() {
    const p = state.protocol;
    const op = thermalPoint();                                   // LIVE point (P live-gated, T = junction temp)
    // Steady-state operating current for the ANALYSIS (verdict / derivations / decision): the
    // loaded phase current whenever the ESC is armed & powered, shown even before "Run" so the
    // student can predict the outcome. The live transient temperature still only climbs while running.
    const iOperating = escPowered() ? phaseCurrentA() : 0;
    const rOp = state.hotModel ? Calc.resistanceAtTemp(state.esc.rds_on_ohm, state.currentTempC) : state.esc.rds_on_ohm;
    const pSwOp = Calc.switchingLoss(busVoltageClean(), iOperating, carrierHz());
    const pCondOp = Calc.escDissipation(iOperating, rOp);
    const pOperating = pCondOp + pSwOp;
    const throttle = effectiveThrottle();
    state.desynced = desyncActive();
    const vBus = busVoltage();
    const rpm = Math.round(currentRpm());
    const steps = p ? (p.throttle_levels || Calc.commandSteps(1000, 1)) : 1000;
    const latency = protocolLatency();
    const verdict = op.T_c > Calc.T_LIMIT_C ? 'OVER LIMIT' : (Calc.heatsinkRequired(Calc.escDissipation(iOperating, state.esc.rds_on_ohm)) ? 'HEATSINK REQ' : 'PASSIVE OK');

    setText('pulseOut', `${state.pulseUs.toFixed(0)} µs`);
    setText('currentOut', `${state.currentA.toFixed(1)} A`);
    setText('socOut', `${Math.round(state.soc * 100)}%`);
    setText('ambientOut', `${state.ambientC.toFixed(0)} °C`);

    setText('hudState', state.thermalShutdown ? 'SHUTDOWN' : (state.desynced ? 'DESYNC' : (state.running ? 'RUNNING' : (state.armed ? 'ARMED' : 'DISARMED'))));
    setText('hudThrottle', `${throttle.toFixed(1)}%`);
    setText('hudRpm', rpm.toLocaleString());
    setText('hudTemp', `${op.T_c.toFixed(1)} °C`);
    setText('hudVolts', `${vBus.toFixed(1)} V`);

    setText('metricPulse', `${state.pulseUs.toFixed(0)} µs`);
    setText('metricThrottle', `${throttle.toFixed(1)}%`);
    setText('metricVolts', `${vBus.toFixed(1)} V`);
    setText('metricRpm', rpm.toLocaleString());
    setText('metricLatency', latency < 1 ? `${(latency * 1000).toFixed(1)} µs` : `${latency.toFixed(2)} ms`);
    setText('metricResolution', `${steps.toLocaleString()} steps`);
    setText('metricPower', `${pOperating.toFixed(3)} W`);
    setText('metricVerdict', verdict);
    const vEl = $('metricVerdict');
    const vCard = vEl ? vEl.closest('.summary-card') : null;
    if (vCard) vCard.className = 'summary-card wide margin-card ' + (verdict === 'OVER LIMIT' ? 'fail' : (verdict === 'HEATSINK REQ' ? 'warn' : 'pass'));

    setText('armBtn', state.thermalShutdown ? 'Reset Thermal Fault' : (state.armed ? 'Disarm ESC' : 'Arm ESC'));
    setText('sweepBtn', state.running ? 'Stop simulation' : 'Run simulation');

    // derivations
    const ep = endpoints();
    const ocv = Calc.ocvPerCell(state.soc);
    const cells = state.battery ? state.battery.cells : 4;
    setText('eqRpm', `${cells}S × ${ocv.toFixed(2)} V = ${vBus.toFixed(1)} V · ${throttle.toFixed(0)}% → ${(throttle / 100 * vBus).toFixed(1)} V → kv(V−I·R) = ${rpm.toLocaleString()} rpm`);
    setText('eqMap', `(${state.pulseUs.toFixed(0)} − ${ep.min}) / ${Math.abs(ep.max - ep.min)} × 100 = ${rawThrottle().toFixed(1)}% raw → ${throttle.toFixed(1)}% eff`);
    if (p) {
      const latStr = latency < 1 ? `${(latency * 1000).toFixed(1)} µs` : `${latency.toFixed(2)} ms`;
      const lhs = p.type === 'digital' ? `${p.frame_bits} bits / ${(p.bitrate_bps / 1000).toFixed(0)} kbit·s⁻¹` : `1000 / ${p.refresh_hz} Hz`;
      setText('eqLatency', `${lhs} = ${latStr} · ${(p.throttle_levels || 1000).toLocaleString()} steps`);
    }

    const r25 = state.esc.rds_on_ohm;
    const rTh = thermalRth();
    const amb = ambientC();
    if (iOperating === 0) {
      setText('eqPower', `0 A phase current → 0.000 W`);
      setText('eqTemp', `cooling to ambient · now ${op.T_c.toFixed(1)} °C`);
    } else {
      setText('eqPower', `${iOperating.toFixed(1)}² × ${rOp.toFixed(5)} Ω = ${pCondOp.toFixed(3)} W cond + ${pSwOp.toFixed(3)} W sw @ ${(carrierHz() / 1000).toFixed(0)} kHz = ${pOperating.toFixed(3)} W`);
      let steadyT, steadyP;
      if (state.hotModel) { const hop = Calc.hotOperatingPointEx(iOperating, r25, rTh, amb, pSwOp); steadyT = hop.T_c; steadyP = hop.P_w; }
      else { steadyP = Calc.escDissipation(iOperating, r25) + pSwOp; steadyT = Calc.escSteadyTemp(steadyP, rTh, amb); }
      setText('eqTemp', `${amb} + ${steadyP.toFixed(3)} × ${rTh} = ${steadyT.toFixed(1)} °C · now ${op.T_c.toFixed(1)}`);
    }

    updateMessage(op, verdict);
    renderProbes(op);
    renderDecision(op, verdict);
    renderVerdict(op);
    renderCalProgress();
    renderMapTable();
    renderTeardown();
    renderComponentExplorer();
    renderTimingDetail();
    trackGuide(op);
    if (state.mode === 'thermal') computeThermalCurves();   // keep the P–I/T–I reference + 80 °C threshold live (heatsink/ambient changes re-bend it)
    renderChart(op);
    renderScenario();
    renderObjectives(op, verdict);
    updateModule2Gate();
    updateDcSupply();
    maybePersist();
    syncBanner();
  }

  function updateMessage(op, verdict) {
    if (state.mode === 'calibration') {
      if (state.selectedPart && COMPONENTS[state.selectedPart]) {
        const c = COMPONENTS[state.selectedPart];
        setMessage(c.name + ' — ' + c.role);
      } else if (state.exploreComplete) {
        setMessage('Power stage inspected. Open Tab 2 · Calibrate & Commission to diagnose the throttle channel and clear any injected fault — finishing both tabs reveals the Module 2 button.');
      } else {
        setMessage('Inspect the ESC anatomy: click the MOSFETs, the bulk capacitor and the MCU / gate driver — the three parts behind every fault in this lab.');
      }
      return;
    }
    if (state.mode === 'mapping') {
      if (state.fault === 'inverted') setMessage('Endpoints inverted: the obtained curve runs backwards — idle stick commands full throttle. Clear the fault, then re-store endpoints.');
      else if (state.fault === 'highmin') setMessage('Minimum endpoint too high: the obtained curve stays flat past idle, so the bottom of the stick is dead. Clear the fault, then re-store endpoints.');
      else if (state.fault === 'jitter') setMessage('Noisy receiver: the obtained curve jitters around the ideal — that spread is the precision limit of a real PWM link. Clear it for a clean channel.');
      else if (!state.calibrated) setMessage('Clear any fault, then click "Store endpoints" to teach the ESC a clean 1000–2000 µs band.');
      else if (!state.guide.swept) setMessage('Healthy endpoints stored. Arm at idle, then drag the pulse across the full 0–100 % range — the solid obtained curve should overlay the dashed ideal apart from the dead-band.');
      else setMessage('Calibrated channel: the obtained curve overlays the ideal apart from the dead-band near idle — exactly why an ESC is calibrated and armed at idle. Objectives met.');
      return;
    }
    if (state.mode === 'timing') {
      const latency = protocolLatency();
      const t = latency < 1 ? `${(latency * 1000).toFixed(0)} µs` : `${latency.toFixed(1)} ms`;
      const digital = state.protocol && state.protocol.type === 'digital';
      if (state.fault === 'desync' && !digital) setMessage('Desync fault: this analog link loses commutation lock under throttle and the rotor stalls. Switch to a DShot (digital) protocol to close the loop and hold sync.');
      else if (latency > LATENCY_OK_MS) setMessage(`This link reacts only every ${t}: the amber ESC response lags the blue command. Fine for a servo, far too slow for a quad — switch to 400 Hz or DShot.`);
      else setMessage(`Command-to-response latency is ${t} — fast enough for stable flight control and the response tracks the command tightly. Objectives met for this stage.`);
      return;
    }
    if (state.thermalShutdown) setMessage('CRITICAL THERMAL SHUTDOWN: ESC temperature crossed 100 C. Let the unit cool below 80 C to reset.');
    else if (rippleActive()) setMessage('Bus ripple fault: the bulk capacitor is missing, so switching ripple and lead-inductance spikes stress the MOSFETs. Fit the low-ESR bulk capacitor to clean the DC bus.');
    else if (!state.armed) {
      if (state.currentTempC >= 80) setMessage('Arming interlock: ESC is too hot. Wait for it to cool below 80 C.');
      else setMessage('Press Run simulation to energise the ESC under load — the junction temperature climbs in real time toward the 2 W / 80 °C limits.');
    }
    else if (op.T_c > 150) setMessage('CRITICAL: Thermal runaway. Rising temperature raises resistance, which makes more heat, which raises temperature — the loop only breaks when something burns. This is why static heat models are dangerous.');
    else if (verdict === 'OVER LIMIT') setMessage('Thermal limit exceeded. Reduce current, select a lower RDS(on) ESC, or fit the heatsink.');
    else if (op.P_w > Calc.HEATSINK_W && !state.heatsink) setMessage('WARNING: Dissipation has crossed two watts. Without a heatsink this controller will cook its MOSFETs — add cooling or size up the ESC.');
    else setMessage('Bench stable and within thermal limits. Push the phase current to find the 80 °C threshold; the objective clears when the hotspot stays under 80 °C.');
  }

  // Every status / fault / verdict string routes through the floating
  // Instructor: the bubble always shows the text, and a matching fault or
  // completion additionally speaks its Emma clip (Instructor.say / EVENT_CLIPS).
  function setMessage(text) { if (window.Instructor) window.Instructor.say(text); }
  function setNote(text) { setText('simNote', text); }

  // ── run sheet (per-stage guided steps — "how to conduct this stage") ──
  function trackGuide(op) {
    const g = state.guide;
    const wasDeadband = g.deadband, wasSwept = g.swept;
    if (state.armed && !state.thermalShutdown && state.pulseUs > 1000 && state.pulseUs <= 1055) g.deadband = true;
    g.pwLo = g.pwLo === null ? state.pulseUs : Math.min(g.pwLo, state.pulseUs);
    g.pwHi = g.pwHi === null ? state.pulseUs : Math.max(g.pwHi, state.pulseUs);
    if (g.pwHi - g.pwLo >= 350) g.swept = true;
    if (Math.abs(state.pulseUs - 1500) <= 6) g.at1500 = true;
    if (state.fault !== 'none') g.fault = true;
    const hadPwm50 = g.protocols.indexOf('pwm_50') >= 0, hadPwm400 = g.protocols.indexOf('pwm_400') >= 0;
    if (state.protocol && g.protocols.indexOf(state.protocol.id) < 0) g.protocols.push(state.protocol.id);
    const full = state.motor && state.motor.full_current_a ? state.motor.full_current_a : null;
    if (full !== null && Math.abs(state.currentA - full) <= 0.8) g.fullLoad = true;
    if (state.armed && !state.thermalShutdown && op.T_c > ambientC() + 8) g.heat = true;

    // ── One-time fixed-guidance triggers (redesign §6) ──
    if (!wasDeadband && g.deadband) {
      setMessage('OBSERVE: The motor just armed. Everything below this pulse width is the safety dead-band — electrical noise in that window can never spin a motor on the bench or in your hands.');
    }
    const mapHealthy = state.calibrated && state.fault !== 'inverted' && state.fault !== 'highmin';
    if (!wasSwept && g.swept && mapHealthy) {
      setMessage('GUIDE: Throttle map complete. Your flight controller now knows this ESC\'s true zero and full-power points. Proceed to the protocol and thermal module.');
    }
    if (!(hadPwm50 && hadPwm400) && g.protocols.indexOf('pwm_50') >= 0 && g.protocols.indexOf('pwm_400') >= 0) {
      setMessage('OBSERVE: One thousand steps at both frequencies — resolution is set by the timer, not the refresh rate. What 400 hertz buys is an eight-times faster command pipeline.');
    }
  }

  // ── ESC teardown / breakout spec card (event-driven: rebuilds only when the ESC changes) ──
  let _teardownSig = '';
  function renderTeardown() {
    const el = $('teardownSpec');
    if (!el) return;
    const e = state.esc;
    if (e.id === _teardownSig) return;
    _teardownSig = e.id;
    const protos = (e.supported_protocols || []).map((id) => { const pp = byId(state.db.pwm_protocols, id); return pp ? pp.label.replace(/\s*[-(].*$/, '').trim() : id; });
    const rows = [
      ['Topology', e.quantity === 1 ? '4-in-1 stack (shared pour)' : '4× individual ESC'],
      ['Firmware', e.firmware],
      ['Continuous / burst', `${e.current_a} A / ${e.burst_current_a || '—'} A`],
      ['MOSFETs', `${e.mosfet_count}${e.quantity === 1 ? ' on 1 board' : ' / ESC'}`],
      ['R<sub>DS(on)</sub> per phase', `${(e.rds_on_ohm * 1000).toFixed(2)} mΩ`],
      ['R<sub>th</sub> to ambient', `${e.r_th_c_per_w} °C/W`],
      ['Board size', e.board_mm ? `${e.board_mm[0]} × ${e.board_mm[1]} mm` : '—'],
      ['Mass', `${(e.mass_g_each * (e.quantity || 1)).toFixed(1)} g`],
      ['Protocols', protos.join(', ')]
    ];
    el.innerHTML = rows.map(([k, v]) => `<div class="spec-row"><span class="spec-k">${k}</span><span class="spec-v">${v}</span></div>`).join('');
  }

  // ── Component explorer (Tab 1): left navigator list + right datasheet panel ──
  // Signature-gated so the per-frame updateAll() only rebuilds the DOM when the ESC,
  // heatsink fitment, or the selected component actually changes (no 60 Hz flicker).
  let _explorerSig = '';
  function renderComponentExplorer() {
    const listEl = $('componentList'), dsEl = $('componentDatasheet');
    if (!listEl && !dsEl) return;
    if (state.mode !== 'calibration') return;   // panels are hidden off-stage anyway
    const keys = presentComponents();
    if (state.selectedPart && keys.indexOf(state.selectedPart) < 0) state.selectedPart = null;
    const sig = state.esc.id + '|' + state.heatsink + '|' + (state.selectedPart || '') + '|' + keys.join(',');
    if (sig === _explorerSig) return;
    _explorerSig = sig;

    if (listEl) {
      listEl.innerHTML = keys.map((k) => {
        const c = COMPONENTS[k]; const active = k === state.selectedPart;
        return `<button type="button" class="component-item${active ? ' active' : ''}" data-key="${k}" aria-pressed="${active}">`
          + `<span class="ci-name">${esc(c.name)}</span><span class="ci-cat">${esc(c.cat)}</span></button>`;
      }).join('');
    }
    const viewed = keys.filter((k) => state.guide.viewedParts.indexOf(k) >= 0).length;
    setText('dsCount', `${viewed} / ${keys.length} inspected`);

    if (!dsEl) return;
    if (!state.selectedPart) {
      const e = state.esc, topo = e.quantity === 1 ? '4-in-1 stack' : '4× single ESC';
      dsEl.innerHTML = `<div class="ds-empty"><div class="ds-board">${esc(String(e.label).replace(/\s*\(x4\)/, ''))}</div>`
        + `<p class="ds-board-sub">${esc(topo)} · ${esc(e.firmware)} · ${e.mosfet_count} MOSFETs</p>`
        + `<p class="ds-hint">Select a component on the left, or click a callout in the 3D view, to read what each part is, what it does, and how its rating shapes the calibration and thermal stages.</p></div>`;
      return;
    }
    const c = COMPONENTS[state.selectedPart];
    const specs = specsFor(state.selectedPart)
      .map(([k, v]) => `<div class="spec-row"><span class="spec-k">${esc(k)}</span><span class="spec-v">${esc(String(v))}</span></div>`).join('');
    const ref = c.refTab ? `<p class="ds-ref">${esc(REF_LABEL[c.refTab] || '')}</p>` : '';
    dsEl.innerHTML = `<div class="ds-head"><div class="ds-titles"><h3 class="ds-name">${esc(c.name)}</h3>`
      + `<span class="ds-sub">${esc(c.sub)}</span></div><span class="ds-cat">${esc(c.cat)}</span></div>`
      + `<p class="ds-what">${esc(c.what)}</p>`
      + `<div class="ds-section-title">Function</div><p class="ds-role">${esc(c.role)}</p>`
      + `<div class="ds-section-title">Key facts</div><div class="ds-specs">${specs}</div>`
      + `<div class="ds-note"><strong>Why it matters.</strong> ${esc(c.note)}</div>${ref}`;
  }
  let _timingSig = '';
  // Always-visible 50 Hz vs 400 Hz comparison — the stage's whole point in one
  // glance: resolution is IDENTICAL (timer-limited), only latency changes.
  // Computed directly from Calc, independent of which protocol happens to be
  // selected right now, so the comparison never depends on the student having
  // already visited both rates.
  function resolutionLatencyCompareHtml() {
    const steps50 = Calc.commandSteps(1000, 1), steps400 = Calc.commandSteps(1000, 1);
    const lat50 = Calc.refreshLatencyMs(50), lat400 = Calc.refreshLatencyMs(400);
    return `<div class="rl-compare">
      <div class="rl-compare-title">Resolution vs Latency — the whole lesson at a glance</div>
      <table class="rl-compare-table">
        <thead><tr><th></th><th>50 Hz</th><th>400 Hz</th></tr></thead>
        <tbody>
          <tr><td>Steps (resolution)</td><td>${steps50.toLocaleString()}</td><td>${steps400.toLocaleString()}</td></tr>
          <tr><td>Latency</td><td>${lat50.toFixed(1)} ms</td><td>${lat400.toFixed(1)} ms</td></tr>
        </tbody>
      </table>
      <p class="rl-compare-note">Same 1000 steps at both rates — resolution is set by the timer tick, not the refresh rate. Latency is ${(lat50 / lat400).toFixed(0)}× faster at 400 Hz — that's what a higher rate actually buys you.</p>
    </div>`;
  }

  function renderTimingDetail() {
    const el = $('timingDetail');
    if (!el) return;
    const p = state.protocol;
    if (!p) { el.innerHTML = resolutionLatencyCompareHtml(); _timingSig = ''; return; }
    const sig = p.id + '|' + state.currentA.toFixed(1) + '|' + busVoltageClean().toFixed(1) + '|' + carrierHz();
    if (sig === _timingSig) return;
    _timingSig = sig;
    const latency = protocolLatency();
    const rows = [
      ['Protocol', p.label.replace(/\s*\(.*\)/, '')],
      ['Signal type', p.type === 'digital' ? 'Digital (DShot)' : 'Analog (PWM)'],
      p.type === 'digital' ? ['Bitrate', `${(p.bitrate_bps / 1000).toFixed(0)} kbit/s`] : ['Refresh rate', `${p.refresh_hz} Hz`],
      ['Command latency', latency < 1 ? `${(latency * 1000).toFixed(1)} µs` : `${latency.toFixed(2)} ms`],
      ['Resolution', `${(p.throttle_levels || 1000).toLocaleString()} steps`],
      ['Endpoint calibration', p.type === 'digital' ? 'Not required' : 'Required (1000–2000 µs)'],
      ['Frame size', p.type === 'digital' ? `${p.frame_bits} bits` : '—'],
      ['Motor-PWM carrier', `${(carrierHz() / 1000).toFixed(0)} kHz`],
      ['Switching loss @ load', `${Calc.switchingLoss(busVoltageClean(), state.currentA, carrierHz()).toFixed(2)} W`]
    ];
    el.innerHTML = resolutionLatencyCompareHtml()
      + rows.map(([k, v]) => `<div class="spec-row"><span class="spec-k">${esc(k)}</span><span class="spec-v">${esc(v)}</span></div>`).join('');
  }

  let _probeSig = '';
  function renderProbes(op) {
    const list = $('probeList');
    if (!list) return;
    const amb = ambientC();
    // Quantise to the displayed precision so the probe list rebuilds only when a shown value
    // would actually change — stops the 60 Hz innerHTML churn while the board sits at steady temp.
    const sig = op.T_c.toFixed(1) + '|' + amb.toFixed(1);
    if (sig === _probeSig) return;
    _probeSig = sig;
    list.innerHTML = heatProbes.map((pr) => {
      const t = amb + (op.T_c - amb) * pr.gain;
      const cls = t > Calc.T_LIMIT_C ? 'hot' : (t > 60 ? 'warm' : 'cool');
      return `<div class="probe ${cls}"><span>${esc(pr.id)}</span><strong>${t.toFixed(1)} °C</strong></div>`;
    }).join('');
  }

  // ── Uniform fault scenarios: injected per page, DIAGNOSED and then FIXED with the real
  //    controls (clear the fault + re-store endpoints, switch to DShot, fit the cap, add a
  //    heatsink…). Replaces the passive "record readings" worksheet. ──────────────────────
  const SCENARIOS_M1 = [
    { id: 'none', label: 'Healthy ESC (no fault)', desc: 'Endpoints calibrated to a clean 1000–2000 µs band.' },
    { id: 'inverted', label: 'Inverted endpoints', desc: 'Min/max stored backwards — idle stick commands full throttle. Clear it and re-store endpoints.', fault: true },
    { id: 'highmin', label: 'Minimum endpoint too high', desc: 'The bottom of the stick is dead past idle. Clear it and re-store endpoints.', fault: true },
    { id: 'jitter', label: 'Noisy receiver jitter', desc: 'RC-link timing noise scatters the throttle around the real curve. Clear it for a clean link.', fault: true }
  ];
  const SCENARIOS_M2 = [
    { id: 'none', label: 'Healthy ESC (no fault)', desc: 'Clean DC bus and digital-ready commutation.' },
    { id: 'desync', label: 'ESC desync under throttle', desc: 'Analog PWM loses commutation lock past ~65 % — the rotor stalls. Switch to a DShot protocol to hold sync.', fault: true },
    { id: 'ripple', label: 'Bus ripple / voltage spikes', desc: 'Bulk capacitor missing / long battery leads. Fit the low-ESR bulk capacitor to clean the bus.', fault: true }
  ];
  function pageScenarios() { return onPage1 ? SCENARIOS_M1 : SCENARIOS_M2; }

  // Signature-gated so the per-frame updateAll() only rebuilds #scenarioHost when the fault
  // set or the current selection actually changes. Rebuilding the <select>'s innerHTML every
  // animation frame would tear the element down mid-interaction, so the native dropdown could
  // never stay open long enough to pick a different option (the "unselectable dropdown" bug).
  let _scenarioSig = '';
  function renderScenario() {
    if (typeof window === 'undefined' || !window.VLABLab) return;
    const cat = pageScenarios();
    if (!cat.some((o) => o.id === state.fault)) state.fault = 'none';   // faults are page-local
    const sig = (onPage1 ? 'm1' : 'm2') + '|' + state.fault;
    if (sig === _scenarioSig) return;
    _scenarioSig = sig;
    window.VLABLab.scenario('scenarioHost', {
      title: 'Fault scenario',
      current: state.fault,
      options: cat,
      onSelect: (id) => { state.fault = id; setVal('faultSelect', id); updateAll(); }
    });
  }

  function stageTitle() {
    return ({ calibration: 'Stage 1 · Explorer', mapping: 'Stage 2 · Commission', timing: 'Stage 3 · Protocol', thermal: 'Stage 4 · Thermal' })[state.mode] || 'Stage';
  }

  // ── Uniform auto-ticking objectives (VLABLab). Each row ticks the instant the real
  //    engineering condition is met — nothing to record, nothing to log. ────────────────
  function objectiveDefs(op) {
    const lat = protocolLatency();
    const mapHealthy = state.calibrated && state.fault !== 'inverted' && state.fault !== 'highmin';
    const digital = state.protocol && state.protocol.type === 'digital';
    if (state.mode === 'calibration') {
      const seen = (k) => state.guide.viewedParts.indexOf(k) >= 0;
      return [
        { id: 'mos', label: 'Inspect the power MOSFETs', hint: 'Their R\u2092\u2099 sets the conduction loss you size in the thermal stage.', test: () => seen('mosfets'), value: () => seen('mosfets') ? 'read' : '' },
        { id: 'cap', label: 'Inspect the bulk capacitor', hint: 'The low-ESR cap kills the bus ripple/spikes that destroy FETs.', test: () => seen('caps'), value: () => seen('caps') ? 'read' : '' },
        { id: 'mcu', label: 'Inspect the MCU / gate driver', hint: 'Runs the sensorless commutation that can lose sync (desync).', test: () => seen('mcu'), value: () => seen('mcu') ? 'read' : '' }
      ];
    }
    if (state.mode === 'mapping') {
      const wired = () => state.circuit.power && state.circuit.phase && !state.circuit.damaged;
      return [
        { id: 'wire', label: 'Wire the commissioning circuit', hint: 'Drag wires: battery to ESC power input, then all three ESC phase pads to the motor.', test: wired, value: () => state.circuit.damaged ? 'destroyed' : (wired() ? 'wired' : 'incomplete'), warn: () => state.circuit.damaged },
        { id: 'ep', label: 'Store valid endpoints', hint: 'Clear any calibration fault, then "Store endpoints" for a clean 1000\u20132000 µs band.', test: () => mapHealthy, value: () => mapHealthy ? '1000\u20132000 µs' : 'invalid' },
        { id: 'arm', label: 'Arm at idle, no creep', hint: 'Arm with the stick down — the dead-band must hold the motor at 0 %.', test: () => state.armed && !state.thermalShutdown, value: () => state.armed ? 'armed' : 'disarmed' },
        { id: 'swept', label: 'Sweep the full 0\u2013100 % range', hint: 'Run the sweep (or drag the pulse) across the whole band.', test: () => state.guide.swept, value: () => state.guide.swept ? 'done' : '' },
        { id: 'track', label: 'Throttle map tracks the ideal', hint: 'With healthy endpoints the solid curve overlays the dashed ideal (bar the dead-band).', test: () => mapHealthy && state.guide.swept, value: () => mapHealthy ? 'on ideal' : 'off ideal' }
      ];
    }
    if (state.mode === 'timing') {
      const bothFreqs = state.guide.protocols.indexOf('pwm_50') >= 0 && state.guide.protocols.indexOf('pwm_400') >= 0;
      return [
        { id: 'lat', label: 'Flight-ready latency (\u2264 5 ms)', hint: '50 Hz PWM lags ~20 ms — pick 400 Hz or a DShot protocol.', test: () => lat <= LATENCY_OK_MS, value: () => lat < 1 ? (lat * 1000).toFixed(0) + ' µs' : lat.toFixed(1) + ' ms' },
        { id: 'resolution', label: 'Resolution unchanged 50\u2194400 Hz', hint: 'Select both 50 Hz and 400 Hz — the step counter must stay at 1000 either way; only latency moves.', test: () => bothFreqs, value: () => bothFreqs ? '1000 steps, both' : 'compare both' },
        { id: 'sync', label: 'Desync-proof commutation', hint: 'A desync-prone ESC is fixed by a digital DShot link that closes the loop.', test: () => state.fault !== 'desync' || digital, value: () => (state.fault === 'desync' && !digital) ? 'desync risk' : (digital ? 'DShot' : 'ok'), warn: () => state.fault === 'desync' && !digital }
      ];
    }
    // thermal
    const realCurrent = !!state._exp1FullCurrent;
    const fullI = state._exp1FullCurrent || (state.motor && state.motor.full_current_a) || 0;
    const pFullCold = Calc.escDissipation(fullI, state.esc.rds_on_ohm);
    const heatsinkOk = !Calc.heatsinkRequired(pFullCold) || state.heatsink;
    return [
      { id: 'sweep', label: 'Run the thermal sweep', hint: 'Sweep phase current to plot P\u2013I / T\u2013I and find the 80 °C limit.', test: () => state.guide.sweptThermal, value: () => state.guide.sweptThermal ? 'done' : '' },
      { id: 'temp', label: 'Hotspot < 80 °C at load', hint: 'If it crosses 80 °C: fit the heatsink, drop R\u2092\u2099, or cut current.', test: () => op.T_c <= Calc.T_LIMIT_C, warn: () => op.T_c > Calc.T_LIMIT_C, value: () => op.T_c.toFixed(0) + ' °C' },
      { id: 'realI', label: 'P_ESC from the real Exp 1 current', hint: 'Finalize Experiment 1 so the full-throttle current here is solved, not a datasheet default.', test: () => realCurrent, value: () => realCurrent ? fullI.toFixed(1) + ' A (Exp 1)' : 'datasheet default' },
      { id: 'heatsink', label: 'Heatsink decision vs the 2 W line', hint: `Cold I²R at full throttle is ${pFullCold.toFixed(2)} W — fit the heatsink if that crosses 2 W.`, test: () => heatsinkOk, warn: () => !heatsinkOk, value: () => pFullCold.toFixed(2) + ' W' + (state.heatsink ? ' + heatsink' : '') },
      { id: 'bus', label: 'Clean DC bus (bulk cap fitted)', hint: 'A ripple fault stresses the FETs — fit the low-ESR bulk capacitor.', test: () => !rippleActive(), warn: () => rippleActive(), value: () => state.capFitted ? 'cap fitted' : 'ripple' }
    ];
  }

  function renderObjectives(op) {
    const defs = objectiveDefs(op);
    let res;
    if (typeof window !== 'undefined' && window.VLABLab) {
      res = window.VLABLab.objectives('checklist', defs, state, { title: stageTitle() + ' objectives' });
    } else {
      const requiredDone = defs.filter((d) => { try { return !!d.test(state); } catch (e) { return false; } }).length;
      res = { allDone: requiredDone === defs.length };
    }
    // Latch per-stage completion so the Module 2 gate stays unlocked afterwards.
    if (res.allDone) {
      if (state.mode === 'calibration') state.exploreComplete = true;
      else if (state.mode === 'mapping') state.calibComplete = true;
      // Final sign-off: the thermal stage is the lab's last objective set — its
      // completion is the overall "commissioning complete" verdict.
      else if (state.mode === 'thermal' && !state._verdictAnnounced) {
        state._verdictAnnounced = true;
        setMessage('GUIDE: ESC commissioning complete. Four calibrated controllers are mounted on your arms, and the dead-band map is stored for the flight controller experiment.');
        showUnlockCard();
      }
    }
    return res;
  }

  let _decisionSig = '';
  // Uniform PASS/WARN/FAIL sign-off chip (VLABLab.verdict), one per stage.
  // PASS: commissioned/calibrated map + thermal equilibrium below 80 °C.
  // WARN: heatsink required (and applied) / link too slow for flight.
  // FAIL: destroyed ESC, uncalibrated map, desync risk, or thermal runaway —
  // always names the fix, never links to another page.
  function stageVerdict(op) {
    if (state.mode === 'calibration') {
      return state.exploreComplete
        ? { tone: 'pass', label: 'Explorer complete', note: 'All three fault-critical parts inspected.' }
        : { tone: 'warn', label: 'Explorer in progress', note: 'Inspect the MOSFETs, bulk capacitor and MCU before moving on.' };
    }
    if (state.mode === 'mapping') {
      if (state.circuit.damaged) return { tone: 'fail', label: 'ESC destroyed', note: 'Select a replacement ESC — reverse-polarity / short-circuit wiring has no recovery.' };
      if (!state.circuit.power || !state.circuit.phase) return { tone: 'warn', label: 'Circuit incomplete', note: 'Finish wiring the battery and all three phase leads in the 3D view.' };
      const mapHealthy = state.calibrated && state.fault !== 'inverted' && state.fault !== 'highmin';
      if (!mapHealthy) return { tone: 'fail', label: 'Uncalibrated map', note: 'Clear the fault, then re-store endpoints for a clean 1000–2000 µs band.' };
      return { tone: 'pass', label: 'Commissioned', note: 'Wired, calibrated, and the throttle map tracks the ideal.' };
    }
    if (state.mode === 'timing') {
      const lat = protocolLatency();
      const digital = state.protocol && state.protocol.type === 'digital';
      if (state.fault === 'desync' && !digital) return { tone: 'fail', label: 'Desync risk', note: 'Switch to a DShot (digital) protocol to hold commutation sync.' };
      return lat <= LATENCY_OK_MS
        ? { tone: 'pass', label: 'Flight-ready latency', note: '' }
        : { tone: 'warn', label: 'Latency too slow for flight', note: 'Pick 400 Hz or a digital protocol.' };
    }
    // thermal
    if (op.T_c > 150) return { tone: 'fail', label: 'Thermal runaway', note: 'Cut current, drop a lower-RDS(on) ESC, or add cooling — the static model hides this.' };
    if (op.T_c > Calc.T_LIMIT_C) return { tone: 'fail', label: 'Over thermal limit', note: 'Reduce current, choose a lower-RDS(on) ESC, or fit the heatsink.' };
    if (op.P_w > Calc.HEATSINK_W && !state.heatsink) return { tone: 'warn', label: 'Heatsink required', note: 'Dissipation exceeds the 2 W passive limit — fit the heatsink.' };
    // A clean PASS is only true once this dissipation is computed from Exp 1's
    // real full-throttle current — on a datasheet default it's a provisional
    // result, never the final "commissioning complete" sign-off (matches the
    // 'realI' objective, which already withholds the unlock card for this).
    if (!state._exp1FullCurrent) return { tone: 'warn', label: 'Provisional pass — datasheet current', note: 'Finalize Experiment 1 so this verdict uses your real full-throttle current, not a placeholder.' };
    return { tone: 'pass', label: 'Thermal equilibrium OK', note: state.heatsink ? 'Below 80 °C with the heatsink fitted.' : 'Below 80 °C — no heatsink required.' };
  }
  let _verdictSig = '';
  function renderVerdict(op) {
    if (typeof window === 'undefined' || !window.VLABLab || !$('verdictHost')) return;
    const v = stageVerdict(op);
    const sig = state.mode + '|' + v.tone + '|' + v.label;
    if (sig === _verdictSig) return;
    _verdictSig = sig;
    window.VLABLab.verdict('verdictHost', { label: v.label, tone: v.tone, note: v.note });
  }

  function renderDecision(op, verdict) {
    const card = $('decisionCard');
    if (!card) return;
    const sig = verdict + '|' + state.heatsink + '|' + (state.heatThreshold != null ? state.heatThreshold.toFixed(1) : '') + '|' + state.mode;
    if (sig === _decisionSig) return;
    _decisionSig = sig;
    const valEl = $('decisionVal'), noteEl = $('decisionNote');
    let cls = 'pass', note = '';
    if (verdict === 'OVER LIMIT') { cls = 'fail'; note = 'Hotspot above 80 °C — reduce current, drop RDS(on), or add cooling.'; }
    else if (verdict === 'HEATSINK REQ') { cls = 'warn'; note = state.heatsink ? 'Above 2 W but the clamp-on heatsink keeps it in range.' : 'Above the 2 W passive limit — fit a heatsink.'; }
    else { cls = 'pass'; note = 'Within the 2 W passive limit — no heatsink required.'; }
    if (state.heatThreshold != null && state.mode === 'thermal') {
      note += ` Passive limit ≈ ${state.heatThreshold.toFixed(1)} A for this ESC${state.heatsink ? ' (with heatsink)' : ''}.`;
    }
    card.className = 'summary-card wide margin-card ' + cls;
    if (valEl) valEl.textContent = verdict;
    if (noteEl) noteEl.textContent = note;
  }

  let _calSig = '';
  function renderCalProgress() {
    const el = $('calProgress');
    if (!el) return;
    const ep = endpoints();
    const db = escDeadband();
    const sig = ep.min + '|' + ep.max + '|' + state.armed + '|' + db + '|' + state.calibrated;
    if (sig === _calSig) return;
    _calSig = sig;
    const okMin = ep.min === 1000, okMax = ep.max === 2000;
    el.innerHTML = `<div class="spec-row"><span class="spec-k">Stored minimum</span><span class="spec-v">${ep.min} µs ${okMin ? '✓' : '✗'}</span></div>`
      + `<div class="spec-row"><span class="spec-k">Stored maximum</span><span class="spec-v">${ep.max} µs ${okMax ? '✓' : '✗'}</span></div>`
      + `<div class="spec-row"><span class="spec-k">Arm dead-band <span style="opacity:.7">(this unit)</span></span><span class="spec-v">${db} µs ${state.calibrated ? '✓' : '<span style="color:var(--danger,#dc2626)">uncal +80</span>'}</span></div>`
      + `<div class="spec-row"><span class="spec-k">Arming state</span><span class="spec-v">${state.armed ? 'ARMED' : 'DISARMED'}</span></div>`;
  }

  let _mapSig = '';
  function renderMapTable() {
    const body = $('mapTableBody');
    if (!body) return;
    const ep = endpoints();
    // Bucket the live pulse to 25 µs so the table rebuilds only when the highlighted row moves.
    const sig = ep.min + '|' + ep.max + '|' + Math.round(state.pulseUs / 25);
    if (sig === _mapSig) return;
    _mapSig = sig;
    const rows = [1000, 1100, 1250, 1500, 1750, 1900, 2000].map((pw) => {
      const raw = Calc.throttleFromPulse(pw, ep.min, ep.max);
      const eff = pw <= ep.min + escDeadband() && ep.min < ep.max ? 0 : raw;
      const here = Math.abs(pw - state.pulseUs) < 26;
      return `<tr${here ? ' class="row-warn"' : ''}><td>${pw} µs</td><td>${raw.toFixed(1)}%</td><td>${eff.toFixed(1)}%</td></tr>`;
    }).join('');
    body.innerHTML = rows;
  }

  // ── Thermal reference curves: compute the P–I / T–I curves + the 80 °C passive-current
  //    threshold for the current ESC + cooling choice. Pure analysis — it does NOT move the
  //    current slider (the student sets the loaded operating point directly) and does not arm the
  //    ESC; the live junction temperature is integrated separately while the simulation runs. ──
  function computeThermalCurves() {
    const rTh = thermalRth();
    const r25 = state.esc.rds_on_ohm;
    const amb = ambientC();
    const vBus = busVoltageClean();
    const fCar = carrierHz();
    const iMax = state.esc.burst_current_a || state.esc.current_a || 60;
    const N = 12;
    const data = [];
    for (let k = 0; k <= N; k++) {
      const I = iMax * k / N;
      let P, T, R;
      const pSw = Calc.switchingLoss(vBus, I, fCar);
      if (state.hotModel && I > 0) { const hop = Calc.hotOperatingPointEx(I, r25, rTh, amb, pSw); P = hop.P_w; T = hop.T_c; R = hop.R_ohm; }
      else { R = r25; P = Calc.escDissipation(I, r25) + pSw; T = Calc.escSteadyTemp(P, rTh, amb); }
      data.push({ i: I, p: Math.min(P, 9999), t: Math.min(T, 260), r: R });
    }
    let thr = null;
    for (let k = 1; k < data.length; k++) {
      if (data[k - 1].t <= Calc.T_LIMIT_C && data[k].t > Calc.T_LIMIT_C) {
        const a = data[k - 1], b = data[k];
        thr = a.i + (Calc.T_LIMIT_C - a.t) / (b.t - a.t) * (b.i - a.i);
        break;
      }
    }
    if (state.sweepData && state.sweepData.escId !== state.esc.id) state.prevSweep = state.sweepData;
    state.sweepData = { escId: state.esc.id, label: state.esc.label.replace(/\s*\(x4\)/, ''), data: data, threshold: thr, heatsink: state.heatsink };
    state.heatThreshold = thr;
  }

  function syncTabs() {
    document.querySelectorAll('.vp-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === state.mode);
    });
    document.querySelectorAll('[data-stage]').forEach((el) => {
      el.hidden = el.dataset.stage !== state.mode;
    });
    // Multi-stage gating: an element is shown only on the stages listed in data-stages.
    document.querySelectorAll('[data-stages]').forEach((el) => {
      el.hidden = el.dataset.stages.split(/\s+/).indexOf(state.mode) < 0;
    });
    const chartTitle = $('chartTitle'), chartDesc = $('chartDesc');
    const titles = {
      calibration: ['PWM Oscilloscope', 'Receiver pulse train into the ESC input capture.'],
      mapping: ['Calibration: Expected vs Obtained', 'The real ESC map (dead-band + stored endpoints) plotted live against the ideal pulse → throttle line.'],
      timing: ['Protocol Latency', 'Command latency and resolution per protocol.'],
      thermal: ['Thermal Run — T(t) & P(t)', 'Junction temperature and I²R dissipation climbing in real time under the loaded current, against the 2 W / 80 °C limits.']
    };
    if (chartTitle && titles[state.mode]) chartTitle.textContent = titles[state.mode][0];
    if (chartDesc && titles[state.mode]) chartDesc.textContent = titles[state.mode][1];

    const blurbs = {
      calibration: ['Stage 1 — explore the anatomy of the ESC. Spin the exploded board and click any component to learn what it is and what it does.', 'Click a component callout or the list to inspect it · drag to orbit · scroll to zoom.'],
      mapping: ['Stage 2 — calibrate the throttle channel and diagnose any injected fault; the obtained curve overlays the ideal once healthy.', 'Sweep the full range and clear any fault so the obtained curve tracks the ideal.'],
      timing: ['Stage 3 — choose a signal protocol and compare command latency against step resolution.', 'Pick a protocol; compare latency and step resolution.'],
      thermal: ['Stage 4 — load the ESC and press Run simulation; the junction temperature climbs in real time from the loaded I²R heat.', 'Set the phase current / heatsink, run, and read where T(t) settles against the 80 °C limit.']
    };
    if (blurbs[state.mode]) { setText('stageBlurb', blurbs[state.mode][0]); setText('simNote', blurbs[state.mode][1]); }

    const head = $('dataHead');
    if (head) {
      let cols;
      if (state.mode === 'timing') cols = ['Protocol', 'Steps', 'Latency', 'Throttle', 'Type'];
      else if (state.mode === 'mapping') cols = ['Pulse', 'Ideal %', 'Measured %', 'Error'];
      else cols = ['Current', 'R(T)', 'P (W)', 'T_eq', 'Verdict'];
      head.innerHTML = cols.map((c) => `<th>${c}</th>`).join('');
    }

    // Tab 1 is the exploded "split view": hide the bench HUD and show the callout overlay.
    const cwrap = document.querySelector('.canvas-wrapper');
    if (cwrap) cwrap.classList.toggle('split-mode', state.mode === 'calibration');
  }

  function resizeCanvases() {
    const canvas = $('scopeCanvas');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(320, Math.round((rect.width || 820) * dpr));
    const h = Math.max(150, Math.round((rect.height || 168) * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }

  // ── 2D charts on #scopeCanvas (dark scope look) ──
  function renderChart(op) {
    const c = $('scopeCanvas');
    if (!c || !c.getContext) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const w = c.width, h = c.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, w, h);
    drawGrid(ctx, w, h);
    if (state.mode === 'timing') drawTimingChart(ctx, w, h);
    else if (state.mode === 'thermal') drawThermalLive(ctx, w, h, op);
    else if (state.mode === 'mapping') drawMappingChart(ctx, w, h);
    else drawScope(ctx, w, h);
  }

  function drawGrid(ctx, w, h) {
    ctx.strokeStyle = 'rgba(148,163,184,0.12)'; ctx.lineWidth = 1;
    for (let x = 0; x <= w; x += w / 12) line(ctx, x, 0, x, h);
    for (let y = 0; y <= h; y += h / 6) line(ctx, 0, y, w, y);
  }

  function drawScope(ctx, w, h) {
    const ep = endpoints();
    const period = w / 3.2;
    const pulseFrac = Calc.clamp((state.pulseUs - 1000) / 1000, 0, 1);
    const high = h * 0.28, low = h * 0.74;
    ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = Math.max(2, w * 0.004);
    ctx.beginPath();
    let x = w * 0.02; ctx.moveTo(x, low);
    for (let i = 0; i < 4; i++) {
      const pw = (0.05 + pulseFrac * 0.35) * period;
      ctx.lineTo(x, low); ctx.lineTo(x, high); ctx.lineTo(x + pw, high); ctx.lineTo(x + pw, low);
      x += period; ctx.lineTo(x, low);
    }
    ctx.stroke();
    chartText(ctx, `pulse ${state.pulseUs.toFixed(0)} µs · ${rawThrottle().toFixed(0)}% raw · endpoints ${ep.min}/${ep.max} µs`, w, h);
  }

  function drawMappingChart(ctx, w, h) {
    const left = w * 0.14, right = w * 0.96, bottom = h * 0.80, top = h * 0.14;
    const ep = endpoints();
    const xOf = (pw) => left + (right - left) * Calc.clamp((pw - 1000) / 1000, 0, 1);
    const yOf = (t) => bottom - (bottom - top) * Calc.clamp(t / 100, 0, 1);
    const fs = Math.max(13, w * 0.018);

    // gridlines + axes
    ctx.strokeStyle = 'rgba(148,163,184,0.13)'; ctx.lineWidth = 1;
    [25, 50, 75, 100].forEach((t) => line(ctx, left, yOf(t), right, yOf(t)));
    ctx.strokeStyle = 'rgba(148,163,184,0.55)';
    line(ctx, left, bottom, right, bottom); line(ctx, left, top, left, bottom);
    ctx.fillStyle = '#cbd5e1'; ctx.font = `${fs}px ${ff()}`; ctx.textAlign = 'center';
    [1000, 1250, 1500, 1750, 2000].forEach((pw) => ctx.fillText(pw, xOf(pw), bottom + fs * 1.5));
    ctx.textAlign = 'right';
    [0, 25, 50, 75, 100].forEach((t) => ctx.fillText(t + '%', left - fs * 0.4, yOf(t) + fs * 0.35));
    ctx.textAlign = 'left';

    // dead-band shading (only meaningful when endpoints aren't inverted)
    if (ep.min < ep.max) {
      ctx.fillStyle = 'rgba(239,68,68,0.10)';
      ctx.fillRect(left, top, xOf(ep.min + escDeadband()) - left, bottom - top);
    }

    // Expected (ideal) — dashed 1000 µs → 0 %, 2000 µs → 100 %
    ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = Math.max(1.6, w * 0.003); ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(xOf(1000), yOf(0)); ctx.lineTo(xOf(2000), yOf(100)); ctx.stroke();
    ctx.setLineDash([]);

    // Obtained — the REAL ESC map, computed LIVE from the stored endpoints + dead-band
    // (a continuous curve, nothing to record). The gap from the ideal IS the fault.
    const realAt = (pw) => {
      if (ep.min < ep.max && pw <= ep.min + escDeadband()) return 0;    // dead-band near idle
      let t = Calc.throttleFromPulse(pw, ep.min, ep.max);
      if (state.fault === 'jitter') t += Math.sin(pw * 0.07 + state.phase * 4) * 3.5;   // receiver jitter band
      return Calc.clamp(t, 0, 100);
    };
    ctx.strokeStyle = '#ffbf00'; ctx.lineWidth = Math.max(2.2, w * 0.004); ctx.beginPath();
    let sumSq = 0, maxErr = 0, nSamp = 0;
    for (let pw = 1000; pw <= 2000; pw += 20) {
      const t = realAt(pw), px = xOf(pw), py = yOf(t);
      (pw === 1000) ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      const err = t - Calc.throttleFromPulse(pw, 1000, 2000);
      sumSq += err * err; if (Math.abs(err) > Math.abs(maxErr)) maxErr = err; nSamp++;
    }
    ctx.stroke();

    // live position marker — where the current pulse sits on the real map
    const liveEff = realAt(state.pulseUs);
    ctx.fillStyle = 'rgba(52,211,153,0.95)'; ctx.beginPath(); ctx.arc(xOf(state.pulseUs), yOf(liveEff), 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#065f46'; ctx.lineWidth = 1.2; ctx.stroke();

    const rms = nSamp ? Math.sqrt(sumSq / nSamp) : 0;
    const healthy = state.fault !== 'inverted' && state.fault !== 'highmin' && state.fault !== 'jitter';
    setText('chartStatus', healthy
      ? `Obtained curve tracks the ideal · RMS error ${rms.toFixed(1)}% (the flat dead-band near idle is expected).`
      : `Fault active · obtained vs ideal RMS error ${rms.toFixed(1)}%, worst ${maxErr >= 0 ? '+' : ''}${maxErr.toFixed(1)}%. Clear the fault to bring the curve onto the ideal.`);
  }

  // The "Continue to Module 2" button stays hidden until BOTH Module 1 tabs are complete —
  // Tab 1 (every component inspected) and Tab 2 (5 points recorded + sweep stopped) — then it appears.
  function updateModule2Gate() {
    const unlocked = !!state.exploreComplete && !!state.calibComplete;
    ['toModule2Map', 'toModule2Explore'].forEach((id) => {
      const a = $(id);
      if (a) a.hidden = !unlocked;
    });
  }

  // ── Interactive latency oscilloscope helpers ─────────────────────────────────
  function niceStep(windowMs) { if (windowMs <= 8) return 1; if (windowMs <= 22) return 2; if (windowMs <= 60) return 10; return 20; }
  // Draw a 0/1 square-wave: full waveform faint (so the pattern/period reads), then the
  // portion the playhead has "drawn" so far in solid colour — an oscilloscope pen you can watch.
  function drawRevealed(ctx, fn, hi, lo, color, left, right, headX, pxPerMs) {
    ctx.strokeStyle = 'rgba(148,163,184,0.16)'; ctx.lineWidth = 1.4; ctx.beginPath();
    let first = true;
    for (let x = left; x <= right; x += 1) { const y = fn((x - left) / pxPerMs) ? hi : lo; first ? (ctx.moveTo(x, y), first = false) : ctx.lineTo(x, y); }
    ctx.stroke();
    const end = Math.min(headX, right);
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(2.4, (right - left) * 0.003); ctx.beginPath(); first = true;
    for (let x = left; x <= end; x += 1) { const y = fn((x - left) / pxPerMs) ? hi : lo; first ? (ctx.moveTo(x, y), first = false) : ctx.lineTo(x, y); }
    ctx.stroke();
  }
  function bracket(ctx, x1, x2, y, label, color, fs) {
    ctx.strokeStyle = color; ctx.lineWidth = 1.4;
    line(ctx, x1, y - fs * 0.7, x1, y + fs * 0.7); line(ctx, x2, y - fs * 0.7, x2, y + fs * 0.7); line(ctx, x1, y, x2, y);
    ctx.fillStyle = color; ctx.font = `700 ${fs}px ${ff()}`; ctx.textAlign = 'center';
    ctx.fillText(label, (x1 + x2) / 2, y - fs * 0.55);
    ctx.textAlign = 'left';
  }

  // Stage 3 latency scope: a student-driven oscilloscope. A slow playhead (Play/Pause/Speed)
  // reveals the pilot's COMMAND pulse train and the ESC RESPONSE trailing it by exactly the
  // protocol latency — so the lag is watched and measured, not blurred past. "Race vs 50 Hz"
  // switches to a single-step view comparing the selected protocol against the 50 Hz baseline.
  function drawTimingChart(ctx, w, h) {
    const p = state.protocol;
    const sc = state.scope;
    const fs = Math.max(12, w * 0.016);
    const left = w * 0.075, right = w * 0.955;
    const latency = protocolLatency();                       // ms, selected protocol
    const lat50 = Calc.refreshLatencyMs(50);                 // 20 ms baseline
    const isDigital = p && p.type === 'digital';
    const periodMs = p ? (isDigital
      ? Math.max(Calc.digitalFrameTimeUs(p.bitrate_bps, p.frame_bits) / 1000, 0.03)
      : Calc.periodUs(p.refresh_hz) / 1000) : 20;

    const windowMs = sc.race ? Math.max(latency, lat50) * 1.55 : Math.max(periodMs * 2.6, 6);
    const pxPerMs = (right - left) / windowMs;
    const xAt = (ms) => left + ms * pxPerMs;
    const headX = left + Calc.clamp(sc.sweep, 0, 1) * (right - left);

    const cmdHi = h * 0.20, cmdLo = h * 0.42;
    const rHi = h * 0.60, rLo = h * 0.82;

    // time axis
    ctx.strokeStyle = 'rgba(148,163,184,0.12)'; ctx.fillStyle = '#94a3b8';
    ctx.font = `${fs * 0.78}px ${ff()}`; ctx.textAlign = 'center';
    const step = niceStep(windowMs);
    for (let ms = 0; ms <= windowMs + 1e-6; ms += step) { const x = xAt(ms); line(ctx, x, h * 0.12, x, h * 0.86); ctx.fillText((step < 1 ? ms.toFixed(1) : ms.toFixed(0)) + ' ms', x, h * 0.955); }

    // band labels
    ctx.textAlign = 'left'; ctx.font = `700 ${fs * 0.85}px ${ff()}`;
    ctx.fillStyle = '#60a5fa'; ctx.fillText('COMMAND · your stick', left, cmdHi - fs * 0.55);
    ctx.fillStyle = '#fbbf24'; ctx.fillText('ESC RESPONSE · delayed by latency', left, rHi - fs * 0.55);

    // playhead
    ctx.strokeStyle = 'rgba(226,232,240,0.55)'; ctx.setLineDash([3, 4]); line(ctx, headX, h * 0.12, headX, h * 0.86); ctx.setLineDash([]);

    if (sc.race) {
      const t0 = windowMs * 0.12;
      const stepAt = (edge) => (ms) => (ms >= edge ? 1 : 0);
      drawRevealed(ctx, stepAt(t0), cmdHi, cmdLo, '#60a5fa', left, right, headX, pxPerMs);
      if (p && p.refresh_hz !== 50) drawRevealed(ctx, stepAt(t0 + lat50), rHi, rLo, 'rgba(148,163,184,0.55)', left, right, headX, pxPerMs);
      drawRevealed(ctx, stepAt(t0 + latency), rHi, rLo, '#fbbf24', left, right, headX, pxPerMs);
      bracket(ctx, xAt(t0), xAt(t0 + latency), (cmdLo + rHi) / 2, latency < 1 ? `${(latency * 1000).toFixed(0)} µs` : `${latency.toFixed(1)} ms`, '#fbbf24', fs);
      if (p && p.refresh_hz !== 50) bracket(ctx, xAt(t0), xAt(t0 + lat50), rLo + fs * 1.6, `50 Hz · 20 ms`, 'rgba(148,163,184,0.85)', fs);
      const nm = p ? p.label.replace(/\s*\(.*\)/, '') : '';
      setText('chartDesc', `Step race: you flick the stick, then ${nm} reacts after ${latency < 1 ? (latency * 1000).toFixed(0) + ' µs' : latency.toFixed(1) + ' ms'}${p && p.refresh_hz !== 50 ? ` — vs a full 20 ms at 50 Hz. That grey gap is the lag a pilot fights.` : '.'}`);
      setText('chartStatus', 'Press "Send step" to re-fire a single command edge; drag Speed to slow the sweep.');
    } else {
      const pulseMs = 1 + sc.cmdPct / 100;                    // 1000–2000 µs active pulse
      const cmd = (ms) => { const ph = ((ms % periodMs) + periodMs) % periodMs; return ph < pulseMs ? 1 : 0; };
      const resp = (ms) => cmd(ms - latency);
      drawRevealed(ctx, cmd, cmdHi, cmdLo, '#60a5fa', left, right, headX, pxPerMs);
      drawRevealed(ctx, resp, rHi, rLo, '#fbbf24', left, right, headX, pxPerMs);
      bracket(ctx, xAt(0), xAt(latency), (cmdLo + rHi) / 2, latency < 1 ? `Δt ${(latency * 1000).toFixed(0)} µs` : `Δt ${latency.toFixed(1)} ms`, '#e2e8f0', fs);
      const steps = p ? (p.throttle_levels || 1000) : 1000;
      const duty = periodMs > 0 ? (pulseMs / periodMs * 100) : 0;
      setText('chartDesc', `${p ? p.label.replace(/\s*\(.*\)/, '') : ''}: a new command every ${periodMs < 1 ? periodMs.toFixed(2) : periodMs.toFixed(1)} ms; the ESC acts after ${latency < 1 ? (latency * 1000).toFixed(0) + ' µs' : latency.toFixed(1) + ' ms'}.`);
      setText('chartStatus', `Period ${periodMs < 1 ? periodMs.toFixed(2) : periodMs.toFixed(1)} ms · pulse ${pulseMs.toFixed(2)} ms (${duty.toFixed(0)}% duty) · ${steps.toLocaleString()} steps · latency ${latency < 1 ? (latency * 1000).toFixed(0) + ' µs' : latency.toFixed(1) + ' ms'}.`);
    }
  }

  // Live thermal chart (Stage 4): junction temperature T(t) [red] and ESC dissipation P(t) [amber]
  // plotted against fast-forwarded time as the board heats up under the live loaded current. The
  // 80 °C trip line and 2 W passive-cooling line are drawn for reference, plus the steady-state
  // target T∞ so the student sees where the exponential is heading. Toggling the heatsink lowers
  // R_th → both the P(t)/T(t) slopes and the T∞ line visibly drop. Updates every frame while running.
  function drawThermalLive(ctx, w, h, op) {
    const left = w * 0.115, right = w * 0.9, bottom = h * 0.8, top = h * 0.14;
    const amb = ambientC();
    const tMax = 110;                                        // °C full-scale (trip at 100)
    const series = state.thermalSeries || [];
    let pMax = 2.5;
    if (state.sweepData) state.sweepData.data.forEach((d) => { if (d.p > pMax) pMax = d.p; });
    series.forEach((s) => { if (s.P > pMax) pMax = s.P; });
    pMax *= 1.1;
    const tWindow = series.length ? Math.max(series[series.length - 1].t, 8) : 60;
    const xOf = (t) => left + (right - left) * Calc.clamp(t / tWindow, 0, 1);
    const yT = (t) => bottom - (bottom - top) * Calc.clamp(t / tMax, 0, 1);
    const yP = (pp) => bottom - (bottom - top) * Calc.clamp(pp / pMax, 0, 1);
    const fs = Math.max(10, w * 0.015);

    // axes
    ctx.strokeStyle = 'rgba(148,163,184,0.5)'; ctx.lineWidth = 1;
    line(ctx, left, bottom, right, bottom); line(ctx, left, top, left, bottom);
    ctx.strokeStyle = 'rgba(148,163,184,0.25)'; line(ctx, right, top, right, bottom);

    // 80 °C trip line + 2 W passive line
    ctx.strokeStyle = 'rgba(239,68,68,0.8)'; ctx.setLineDash([7, 6]); line(ctx, left, yT(Calc.T_LIMIT_C), right, yT(Calc.T_LIMIT_C));
    ctx.fillStyle = '#fecaca'; ctx.font = `${fs * 0.85}px ${ff()}`; ctx.textAlign = 'left'; ctx.fillText('80 °C trip', left + 5, yT(Calc.T_LIMIT_C) - 3);
    ctx.strokeStyle = 'rgba(245,158,11,0.7)'; line(ctx, left, yP(Calc.HEATSINK_W), right, yP(Calc.HEATSINK_W)); ctx.setLineDash([]);
    ctx.fillStyle = '#fcd34d'; ctx.textAlign = 'right'; ctx.fillText('2 W', right - 5, yP(Calc.HEATSINK_W) - 3);

    // ambient baseline
    ctx.strokeStyle = 'rgba(96,165,250,0.35)'; ctx.setLineDash([2, 4]); line(ctx, left, yT(amb), right, yT(amb)); ctx.setLineDash([]);

    // steady-state target temperature (faint dashed) for the current operating point
    const iOp = escPowered() ? phaseCurrentA() : 0;
    if (iOp > 0) {
      const pSw = Calc.switchingLoss(busVoltageClean(), iOp, carrierHz());
      const tInf = state.hotModel
        ? Calc.hotOperatingPointEx(iOp, state.esc.rds_on_ohm, thermalRth(), amb, pSw).T_c
        : Calc.escSteadyTemp(Calc.escDissipation(iOp, state.esc.rds_on_ohm) + pSw, thermalRth(), amb);
      ctx.strokeStyle = 'rgba(248,113,113,0.45)'; ctx.setLineDash([4, 4]); line(ctx, left, yT(tInf), right, yT(tInf)); ctx.setLineDash([]);
      ctx.fillStyle = '#fca5a5'; ctx.textAlign = 'left'; ctx.fillText(`T∞ ≈ ${tInf.toFixed(0)} °C`, left + 5, yT(tInf) + (tInf > 90 ? fs * 1.4 : -3));
    }

    // live traces
    if (series.length > 1) {
      ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = Math.max(1.6, w * 0.0028); ctx.beginPath();
      series.forEach((s, i) => { const x = xOf(s.t), y = yP(s.P); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
      ctx.strokeStyle = '#f87171'; ctx.lineWidth = Math.max(2, w * 0.0038); ctx.beginPath();
      series.forEach((s, i) => { const x = xOf(s.t), y = yT(s.T); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
      const last = series[series.length - 1];
      ctx.fillStyle = tempColor(last.T); ctx.beginPath(); ctx.arc(xOf(last.t), yT(last.T), 5.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(15,23,42,0.9)'; ctx.lineWidth = 1.3; ctx.stroke();
    }

    // axis labels
    ctx.fillStyle = '#fca5a5'; ctx.font = `700 ${fs}px ${ff()}`; ctx.textAlign = 'left'; ctx.fillText('T (°C)', left, top - 4);
    ctx.fillStyle = '#fcd34d'; ctx.textAlign = 'right'; ctx.fillText('P (W)', right, top - 4); ctx.textAlign = 'left';
    ctx.fillStyle = '#94a3b8'; ctx.font = `${fs * 0.8}px ${ff()}`; ctx.textAlign = 'center'; ctx.fillText('time (s, ×fast-forward)', (left + right) / 2, bottom + fs * 1.7);

    const thr = state.heatThreshold;
    let msg;
    if (state.thermalShutdown) msg = 'THERMAL SHUTDOWN — junction hit 100 °C. Add cooling or cut current, then reset the fault.';
    else if (!series.length) msg = 'Press "Run simulation" to energise the ESC and watch the junction temperature climb in real time.';
    else msg = (thr ? `Passive-safe to ≈ ${thr.toFixed(0)} A${state.heatsink ? ' with heatsink' : ''}` : 'Stays under 80 °C at this load') + ` · now ${op.T_c.toFixed(1)} °C`;
    chartText(ctx, msg, w, h);
  }

  function tempColor(t) {
    if (t > Calc.T_LIMIT_C) return '#f87171';
    if (t > 60) return '#fbbf24';
    return '#34d399';
  }

  function chartText(ctx, text, w, h) {
    ctx.fillStyle = 'rgba(226,232,240,0.85)';
    ctx.font = `${Math.max(9, w * 0.014)}px ${ff()}`;
    ctx.textAlign = 'left';
    ctx.fillText(text, w * 0.04, h * 0.95);
  }

  function line(ctx, x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }

  // ── Unlock-reward 3D card (shown once, on full experiment completion) ─────
  // Loads the unlocked component from asset/models/<file>.glb. Drop your file
  // there and set UNLOCK_MODEL below; until then a procedural placeholder shows,
  // so the sim never breaks. Same pattern as exp1/exp2.
  const UNLOCK_MODEL = 'asset/models/reward.glb';   // ← set to your unlocked component's .glb
  let _unlAnim = null, _unlScn = null, _unlRndr = null, _unlCam = null, _unlCtrls = null, _unlGroup = null, _unlClk = null, _unlShown = false;
  function showUnlockCard() {
    const card = document.getElementById('nextModuleContainer');
    if (!card || _unlShown) return;
    _unlShown = true;
    card.style.display = 'block';
    setTimeout(initUnlock, 80);                        // let layout settle before WebGL reads canvas size
    try { card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {}
  }
  function initUnlock() {
    try {
      const canvas = document.getElementById('unlockCanvas');
      if (!canvas || !window.THREE) return;
      const THREE = window.THREE;
      if (_unlAnim) { cancelAnimationFrame(_unlAnim); _unlAnim = null; }
      const base = initBase3DScene(canvas, canvas.parentElement, {
        bgColor: 0x0f172a, fov: 40, alpha: true, enableShadows: true,
        camPos: { x: 0.16, y: 0.12, z: 0.22 },
        ctrls: { minDist: 0.08, maxDist: 2.0, target: { x: 0, y: 0.01, z: 0 } },
        ambientIntensity: 0.75, sunIntensity: 1.0, sunPos: { x: 1.0, y: 2.0, z: 1.0 }
      });
      if (!base) return;
      _unlScn = base.scn; _unlRndr = base.rndr; _unlCam = base.cam; _unlCtrls = base.ctrls;
      if (base.handleResize) base.handleResize();
      _unlGroup = new THREE.Group(); _unlScn.add(_unlGroup);

      const clearGroup = function () { while (_unlGroup.children.length) _unlGroup.remove(_unlGroup.children[0]); };
      const createProcedural = function () {
        clearGroup();
        const boardMat = new THREE.MeshStandardMaterial({ color: 0x0b3d2e, roughness: 0.5, metalness: 0.25 });
        const metalMat = new THREE.MeshStandardMaterial({ color: 0x9aa4b2, roughness: 0.35, metalness: 0.85 });
        const accentMat = new THREE.MeshStandardMaterial({ color: 0xc2410c, roughness: 0.4, metalness: 0.4 });
        const board = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.008, 0.07), boardMat); _unlGroup.add(board);
        for (let i = 0; i < 6; i++) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.006, 0.012), metalMat); f.position.set(-0.04 + (i % 3) * 0.03, 0.007, i < 3 ? -0.018 : 0.018); _unlGroup.add(f); }
        const can = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.018, 32), accentMat); can.position.set(0.055, 0.013, 0); _unlGroup.add(can);
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.03, 12), metalMat); shaft.position.set(0.055, 0.028, 0); _unlGroup.add(shaft);
      };
      if (window.GLTFLoader) {
        const loader = new window.GLTFLoader();
        if (window.DRACOLoader) { const d = new window.DRACOLoader(); d.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/'); loader.setDRACOLoader(d); }
        loader.load(UNLOCK_MODEL, function (gltf) {
          clearGroup();
          const model = gltf.scene;
          const box = new THREE.Box3().setFromObject(model), size = new THREE.Vector3(); box.getSize(size);
          const maxDim = Math.max(size.x, size.y, size.z) || 1.0, s = 0.16 / maxDim; model.scale.setScalar(s);
          const c = new THREE.Vector3(); box.getCenter(c); model.position.set(-c.x * s, -c.y * s, -c.z * s);
          model.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
          _unlGroup.add(model);
        }, undefined, function () { createProcedural(); });   // missing/failed .glb → placeholder
      } else { createProcedural(); }

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

  function mountInstructor() {
    if (!window.Instructor) return;
    window.Instructor.mountFloating();
    window.Instructor.initTtsToggle();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', appInit);
    document.addEventListener('DOMContentLoaded', mountInstructor);
  } else { appInit(); mountInstructor(); }
})();


/* ── Strict guided-build gate ────────────────────────────────────────────────
 * Exp 4 (ESC power electronics) inherits the user's motor + ESC and the real
 * full-throttle current from Exp 1 (propulsion). Gate until Exp 1 is finalized.
 * ---------------------------------------------------------------------------*/
(function () {
  if (typeof window === 'undefined' || !window.VLABUi || !window.VLABUi.autoGate) return;
  function mount() { try { window.VLABUi.autoGate('exp4'); } catch (e) { /* gate optional */ } }
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
