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
  // ── Lumped-capacitance thermal mass (real time constant, not a tuned guess) ──
  // Heat capacity C_th [J/°C] = mass [kg] × specific heat cp [J/(kg·K)]. The board is
  // a mix of FR4, copper pour and silicon; cp ≈ 800 J/(kg·K) is representative.
  function thermalCapacitance(massG, cpJperKgK) {
    const cp = cpJperKgK === undefined ? 800 : cpJperKgK;
    return (massG / 1000) * cp;
  }
  // First-order thermal time constant τ = R_th · C_th [s] (≈ minutes for a real ESC).
  function thermalTimeConstant(rThCPerW, cThJperC) { return rThCPerW * cThJperC; }

  return Object.freeze({
    PW_MIN_US, PW_MAX_US, PW_RANGE_US, DEADBAND_US, TIMER_TICK_US,
    MOSFET_TEMPCO, T_REF_C, HEATSINK_W, T_LIMIT_C,
    clamp,
    throttleFromPulse, effectiveThrottle, pulseFromThrottle,
    commandSteps, percentPerStep, refreshLatencyMs, periodUs, dutyPct, digitalFrameTimeUs,
    escDissipation, resistanceAtTemp, escSteadyTemp, heatsinkRequired, hotOperatingPoint,
    ocvPerCell, packVoltage, loadedRpm, thermalCapacitance, thermalTimeConstant
  });
})();
window.Calc = Calc;

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
      { id: '1806_2300', label: '1806 - 2300 KV', kv: 2300, rm_ohm: 0.090, i0_a: 0.6, max_current_a: 18.5, hover_current_a: 4.2, full_current_a: 18.5 },
      { id: '2204_2300', label: '2204 - 2300 KV', kv: 2300, rm_ohm: 0.095, i0_a: 0.8, max_current_a: 23.0, hover_current_a: 7.2, full_current_a: 23.0 },
      { id: '2207_1600', label: '2207 - 1600 KV', kv: 1600, rm_ohm: 0.060, i0_a: 1.0, max_current_a: 32.0, hover_current_a: 9.5, full_current_a: 32.0 },
      { id: '2212_920', label: '2212 - 920 KV', kv: 920, rm_ohm: 0.110, i0_a: 0.5, max_current_a: 20.0, hover_current_a: 8.0, full_current_a: 20.0 },
      { id: '2808_1200', label: '2808 - 1200 KV', kv: 1200, rm_ohm: 0.045, i0_a: 1.2, max_current_a: 38.0, hover_current_a: 12.5, full_current_a: 38.0 },
      { id: '3508_700', label: '3508 - 700 KV', kv: 700, rm_ohm: 0.085, i0_a: 0.7, max_current_a: 26.0, hover_current_a: 10.0, full_current_a: 26.0 }
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
    selectedPart: null,
    phase: 0,
    sweep: false,
    recordings: [],
    calibComplete: false,
    exploreComplete: false,
    db: fallbackDb,
    currentTempC: 25.0,
    lastTime: null,
    thermalShutdown: false,
    sweepData: null,
    prevSweep: null,
    heatThreshold: null,
    // session-only UI flags so the run-sheet steps auto-advance (never persisted)
    guide: { deadband: false, swept: false, at1500: false, fault: false, protocols: [], fullLoad: false, heat: false, recorded: {}, pwLo: null, pwHi: null, sweptThermal: false, viewedParts: [] }
  };

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

  // Connect to Experiment 1 (propulsion): inherit the user's actual motor (and ESC, if it
  // exists in this bench's catalogue). Only adjusts defaults — a saved Exp4 session overrides.
  function inheritFromExp1() {
    const m1 = readJSON('vlabModule1');
    if (!m1) return;
    if (m1.mId) { const m = byId(state.db.motors, m1.mId); if (m && m.id === m1.mId) { state.motor = m; state.currentA = m.hover_current_a || state.currentA; state.inheritedFromExp1 = true; } }
    if (m1.eId) { const e = byId(state.db.escs, m1.eId); if (e && e.id === m1.eId) state.esc = e; }
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
    if (['none', 'inverted', 'highmin', 'jitter'].indexOf(s.fault) >= 0) state.fault = s.fault;
    if (typeof s.hotModel === 'boolean') state.hotModel = s.hotModel;
    if (typeof s.heatsink === 'boolean') state.heatsink = s.heatsink;
    if (typeof s.calibrated === 'boolean') state.calibrated = s.calibrated;
    if (typeof s.armed === 'boolean') state.armed = s.armed;
    if (typeof s.calibComplete === 'boolean') state.calibComplete = s.calibComplete;
    if (typeof s.exploreComplete === 'boolean') state.exploreComplete = s.exploreComplete;
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
        calibComplete: state.calibComplete, exploreComplete: state.exploreComplete
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
    } catch (e) { /* storage unavailable — ignore */ }
  }

  // ── boot ─────────────────────────────────────────────────────────────────────
  function appInit() {
    if (!$('benchCanvas')) return;
    fetch('db/db.json')
      .then((r) => r.ok ? r.json() : fallbackDb)
      .then((db) => { state.db = db && db.escs ? db : fallbackDb; boot(); })
      .catch(() => boot());
  }

  function boot() {
    state.esc = byId(state.db.escs, 'esc_30a');
    state.motor = byId(state.db.motors, '2204_2300');
    state.protocol = byId(state.db.pwm_protocols, 'pwm_50');
    state.battery = byId(state.db.batteries, 'lipo_4s_1500');

    inheritFromExp1();    // pull the user's real motor / ESC choice from Experiment 1

    if (state.mode === 'thermal') {
      state.pulseUs = 1500;
      state.currentA = state.motor.full_current_a || 23;
      state.armed = true;
    }

    restoreSession();     // a saved Exp4 session (refresh / re-login) overrides the defaults
    if (state.mode === 'calibration') state.exploded = true;   // Tab 1 = exploded split view by default

    state.currentTempC = ambientC();
    state.lastTime = null;
    state.thermalShutdown = false;

    hydrateControls();
    bindControls();
    buildEscTiles();
    setup3D();
    resizeCanvases();
    updateAll();
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(loop);
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
    setVal('faultSelect', state.fault);
    setChecked('hotModelToggle', state.hotModel);
    setChecked('heatsinkToggle', state.heatsink);
    setChecked('explodeToggle', state.exploded);
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
    on('protocolSelect', 'change', (e) => { state.protocol = byId(state.db.pwm_protocols, e.target.value); updateAll(); });
    on('batterySelect', 'change', (e) => { state.battery = byId(state.db.batteries, e.target.value); updateAll(); });
    on('pulseSlider', 'input', (e) => { state.pulseUs = +e.target.value; updateAll(); });
    on('currentSlider', 'input', (e) => { state.currentA = +e.target.value; updateAll(); });
    on('socSlider', 'input', (e) => { state.soc = (+e.target.value) / 100; updateAll(); });
    on('ambientSlider', 'input', (e) => { state.ambientC = +e.target.value; updateAll(); });
    on('faultSelect', 'change', (e) => { state.fault = e.target.value; updateAll(); });
    on('hotModelToggle', 'change', (e) => { state.hotModel = e.target.checked; updateAll(); });
    on('heatsinkToggle', 'change', (e) => { state.heatsink = e.target.checked; if (view && view.model) view.model.setHeatsink(state.heatsink); updateAll(); });
    on('explodeToggle', 'change', (e) => { state.exploded = e.target.checked; updateAll(); });
    on('explodeBtn', 'click', () => { state.exploded = !state.exploded; setChecked('explodeToggle', state.exploded); updateAll(); });
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
    on('sweepBtn', 'click', onSweep);
    on('recordBtn', 'click', recordReading);
    document.querySelectorAll('.vp-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.mode;
        if (pageModes.indexOf(target) >= 0) {
          state.mode = target;
          if (target === 'calibration') { state.exploded = true; setChecked('explodeToggle', true); }
          syncTabs(); frameCamera(); updateAll();
        }
        else { window.location.href = (PAGE1_MODES.indexOf(target) >= 0 ? 'index.html' : 'index1.html') + '?mode=' + target; }
      });
    });
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
    if (state.armed) { state.armed = false; updateAll(); setNote('ESC disarmed — motor output is cut.'); return; }
    // A bad calibration or an unsafe temperature still blocks arming (the teaching checks).
    if (!state.calibrated) { setMessage('Arming refused: the stored endpoints are invalid (calibration fault). Fix the endpoint condition and store endpoints again.'); return; }
    if (state.currentTempC >= 80) { setMessage('Arming refused: ESC temperature is too hot (above 80 C). Allow the unit to cool.'); return; }
    // Real ESCs only arm at idle, so arming snaps the stick to idle (and stops any running
    // sweep) instead of refusing — the button always works when the calibration is valid.
    state.sweep = false;
    state.pulseUs = 1000; setVal('pulseSlider', 1000);
    state.armed = true;
    updateAll();
    setNote('ESC armed at idle — raise the pulse or run the sweep to drive the motor.');
  }

  function onSweep() {
    if (state.mode === 'thermal') { runThermalSweep(); }
    else {
      state.sweep = !state.sweep;
      // Starting a sweep in mapping mode begins a fresh calibration run — clear old points.
      if (state.sweep && state.mode === 'mapping') state.recordings = state.recordings.filter((r) => !r.mapPoint);
      updateAll();
    }
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
      createSplitLayer();
      frameCamera();
    } catch (e) { view = null; }
  }

  function buildBoard3D() {
    if (!view || !window.EscBoardModel) return;
    if (splitLayer) { splitLayer.labels.innerHTML = ''; splitLayer.chips = {}; splitLayer.svg.innerHTML = ''; }
    try {
      if (view.model) { view.scn.remove(view.model.group); if (view.model.dispose) view.model.dispose(); }
      view.model = window.EscBoardModel.build(state.esc, state.motor);
      view.model.setHeatsink(state.heatsink);
      view.scn.add(view.model.group);
    } catch (e) { /* keep the old model if rebuild fails */ }
  }

  function render3D(dt) {
    if (!view || !view.model) return;
    const op = thermalPoint();
    const rpm = state.armed && !state.thermalShutdown ? currentRpm() : 0;
    view.model.setRpm(rpm);
    view.model.setTemperature(op.T_c, ambientC(), 100);
    view.model.setHeatsink(state.heatsink);
    // Tab 1 is the bare-board teardown — hide the motor + its leads there; show them
    // on the live-spin tabs (mapping / thermal) where the bell actually turns.
    if (view.model.setMotorVisible) view.model.setMotorVisible(state.mode !== 'calibration');
    // Ease the explode factor toward its target so the split view assembles/expands smoothly.
    const tgt = state.exploded ? 1 : 0;
    view.explodeT = (view.explodeT === undefined) ? tgt : view.explodeT + (tgt - view.explodeT) * Math.min(1, dt * 4.5);
    if (Math.abs(view.explodeT - tgt) < 0.0015) view.explodeT = tgt;
    view.model.setExploded(view.explodeT);
    view.model.tick(dt, op.T_c > 90);
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
    const pos = cal ? { x: 0.048, y: 0.078, z: 0.128 } : { x: 0.085, y: 0.07, z: 0.11 };
    const tgt = cal ? { x: 0, y: 0.016, z: 0 } : { x: -0.012, y: 0.006, z: 0 };
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

  function endpoints() {
    if (state.fault === 'inverted') return { min: 2000, max: 1000 };
    if (state.fault === 'highmin') return { min: 1300, max: 2000 };
    return { min: 1000, max: 2000 };
  }

  function rawThrottle() {
    const ep = endpoints();
    return Calc.throttleFromPulse(state.pulseUs, ep.min, ep.max);
  }

  function effectiveThrottle() {
    const ep = endpoints();
    if (!state.armed || state.thermalShutdown) return 0;
    const jitter = state.fault === 'jitter' ? Math.sin(state.phase * 5.1) * 14 : 0;
    return Calc.effectiveThrottle(state.pulseUs + jitter, Calc.DEADBAND_US, ep.min, ep.max);
  }

  // Battery pack terminal voltage — genuinely computed from cell count + state-of-charge.
  function busVoltage() { return Calc.packVoltage(state.battery ? state.battery.cells : 4, state.soc); }

  // Loaded rotor speed via real back-EMF: the PWM duty averages the bus onto the motor,
  // then RPM = kv·(V_applied − I·R_total). No fixed 11.1 V and no 0.9 fudge factor.
  function currentRpm() {
    const throttle = effectiveThrottle();
    const vApplied = (throttle / 100) * busVoltage();
    const iActive = state.armed && !state.thermalShutdown ? state.currentA : 0;
    const rTotal = (state.motor.rm_ohm || 0) + (state.esc.rds_on_ohm || 0);
    return Calc.loadedRpm(state.motor.kv || 1800, vApplied, iActive, rTotal);
  }

  // Instantaneous conduction loss at the live junction temperature (hot model = R climbs with T).
  function thermalPoint() {
    const r25 = state.esc.rds_on_ohm;
    const rActive = state.hotModel ? Calc.resistanceAtTemp(r25, state.currentTempC) : r25;
    const iActive = state.armed && !state.thermalShutdown ? state.currentA : 0;
    const pActive = Calc.escDissipation(iActive, rActive);
    return { P_w: pActive, R_ohm: rActive, T_c: state.currentTempC };
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
    const iActive = state.armed && !state.thermalShutdown ? state.currentA : 0;
    const pActive = Calc.escDissipation(iActive, rActive);
    const massG = (state.esc.mass_g_each || 9.5) + (state.heatsink ? (th.heatsink_mass_g || 12) : 0);
    const cTh = Calc.thermalCapacitance(massG, th.cp_j_per_kg_k || 800);
    const ff = th.sim_fast_forward || 30;
    const dTdt = (pActive - (state.currentTempC - amb) / rTh) / cTh;   // °C / s
    state.currentTempC += dTdt * dt * ff;
    if (state.currentTempC < amb) state.currentTempC = amb;
    if (state.currentTempC >= 100 && !state.thermalShutdown) {
      state.thermalShutdown = true; state.armed = false; state.sweep = false;
    }
  }

  function loop(now) {
    if (state.lastTime === null) state.lastTime = now;
    let dt = (now - state.lastTime) / 1000; state.lastTime = now;
    if (!isFinite(dt) || dt < 0) dt = 0;
    if (dt > 0.1) dt = 0.1;
    state.phase = now / 1000;

    if (state.sweep && (state.mode === 'calibration' || state.mode === 'mapping')) {
      state.pulseUs = 1000 + (Math.sin(state.phase * 0.85) * 0.5 + 0.5) * 1000;
      setVal('pulseSlider', state.pulseUs);
    }
    integrateThermal(dt);
    updateAll();
    render3D(dt);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(loop);
  }

  // ── master update (HUD + metrics + derivations + tables + charts + persistence) ──
  function updateAll() {
    const p = state.protocol;
    const op = thermalPoint();
    const throttle = effectiveThrottle();
    const vBus = busVoltage();
    const rpm = state.armed && !state.thermalShutdown ? Math.round(currentRpm()) : 0;
    const steps = p ? (p.throttle_levels || Calc.commandSteps(1000, 1)) : 1000;
    const latency = protocolLatency();
    const iActive = state.armed && !state.thermalShutdown ? state.currentA : 0;
    const verdict = op.T_c > Calc.T_LIMIT_C ? 'OVER LIMIT' : (Calc.heatsinkRequired(Calc.escDissipation(iActive, state.esc.rds_on_ohm)) ? 'HEATSINK REQ' : 'PASSIVE OK');

    setText('pulseOut', `${state.pulseUs.toFixed(0)} µs`);
    setText('currentOut', `${state.currentA.toFixed(1)} A`);
    setText('socOut', `${Math.round(state.soc * 100)}%`);
    setText('ambientOut', `${state.ambientC.toFixed(0)} °C`);

    setText('hudState', state.thermalShutdown ? 'SHUTDOWN' : (state.armed ? 'ARMED' : 'DISARMED'));
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
    setText('metricPower', `${op.P_w.toFixed(3)} W`);
    setText('metricVerdict', verdict);
    const vEl = $('metricVerdict');
    const vCard = vEl ? vEl.closest('.summary-card') : null;
    if (vCard) vCard.className = 'summary-card wide margin-card ' + (verdict === 'OVER LIMIT' ? 'fail' : (verdict === 'HEATSINK REQ' ? 'warn' : 'pass'));

    setText('armBtn', state.thermalShutdown ? 'Reset Thermal Fault' : (state.armed ? 'Disarm ESC' : 'Arm ESC'));
    setText('sweepBtn', state.mode === 'thermal' ? 'Run thermal sweep' : (state.sweep ? 'Stop sweep' : 'Run 0-100% sweep'));

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
    if (iActive === 0) {
      setText('eqPower', `0 A phase current → 0.000 W`);
      setText('eqTemp', `cooling to ambient · now ${op.T_c.toFixed(1)} °C`);
    } else {
      setText('eqPower', `${state.currentA.toFixed(1)}² × ${op.R_ohm.toFixed(5)} Ω = ${op.P_w.toFixed(3)} W`);
      let steadyT, steadyP;
      if (state.hotModel) { const hop = Calc.hotOperatingPoint(iActive, r25, rTh, amb); steadyT = hop.T_c; steadyP = hop.P_w; }
      else { steadyP = Calc.escDissipation(iActive, r25); steadyT = Calc.escSteadyTemp(steadyP, rTh, amb); }
      setText('eqTemp', `${amb} + ${steadyP.toFixed(3)} × ${rTh} = ${steadyT.toFixed(1)} °C · now ${op.T_c.toFixed(1)}`);
    }

    updateMessage(op, verdict);
    renderProbes(op);
    renderChecklist(op);
    renderDecision(op, verdict);
    renderCalProgress();
    renderMapTable();
    renderTeardown();
    renderComponentExplorer();
    renderTimingDetail();
    trackGuide(op);
    renderSteps(op, verdict);
    renderChart(op);
    // Tab 1 (explorer) is complete once every present component has been inspected at least once.
    const parts = presentComponents();
    if (!state.exploreComplete && parts.length && parts.every((k) => state.guide.viewedParts.indexOf(k) >= 0)) state.exploreComplete = true;
    // Reveal the two-graph result once 5+ points are recorded and the sweep is stopped
    // ("Stop sweep"); latch the Tab 2 completion so it stays set afterwards.
    const mapDone = state.mode === 'mapping' && !state.sweep && state.recordings.filter((r) => r.mapPoint).length >= 5;
    if (mapDone) state.calibComplete = true;
    renderCalibResult(mapDone);
    updateModule2Gate();
    maybePersist();
  }

  function updateMessage(op, verdict) {
    if (state.mode === 'calibration') {
      if (state.selectedPart && COMPONENTS[state.selectedPart]) {
        const c = COMPONENTS[state.selectedPart];
        setMessage(c.name + ' — ' + c.role);
      } else if (state.exploreComplete && !state.calibComplete) {
        setMessage('Every component inspected. Now open Tab 2 · Calibrate & Commission to store endpoints, sweep and record — finishing both tabs reveals the Module 2 button.');
      } else {
        setMessage('Inspect the ESC anatomy: click every component callout (or a part in the list on the left) to read what it does. The datasheet tag tracks how many are left.');
      }
      return;
    }
    if (state.mode === 'mapping') {
      const pts = state.recordings.filter((r) => r.mapPoint).length;
      if (state.fault === 'inverted') setMessage('Endpoints inverted: the obtained curve runs backwards — idle stick commands full throttle. Compare it to the dashed ideal line.');
      else if (state.fault === 'highmin') setMessage('Minimum endpoint set too high: the obtained curve stays flat past idle, so the bottom of the stick is dead. Note the gap from the ideal line.');
      else if (state.fault === 'jitter') setMessage('Noisy receiver: your recorded points scatter around the real curve — that random spread is the precision limit of a real PWM link.');
      else if (pts < 5) setMessage('Run the sweep, then click "Record point" at ' + (5 - pts) + ' more pulse width' + (5 - pts > 1 ? 's' : '') + '. Your points (obtained) are plotted against the dashed ideal line so the real dead-band and precision error become visible.');
      else setMessage('5 points logged. Dashed = the ideal you assumed; the solid line + dots = the real ESC. The gap (mostly the dead-band near idle) is exactly why an ESC must be calibrated and armed at idle.');
      return;
    }
    if (state.mode === 'timing') {
      const latency = protocolLatency();
      const t = latency < 1 ? `${(latency * 1000).toFixed(0)} µs` : `${latency.toFixed(1)} ms`;
      if (latency > LATENCY_OK_MS) setMessage(`This link reacts only every ${t}: watch the amber ESC response lag the blue command. That delay is fine for a servo but far too slow for a quad — switch to 400 Hz or DShot to sign off this stage.`);
      else setMessage(`Command-to-response latency is ${t} — fast enough for stable flight control. The amber response now tracks the blue command tightly. Record your choice to finish the stage.`);
      return;
    }
    if (state.thermalShutdown) setMessage('CRITICAL THERMAL SHUTDOWN: ESC temperature crossed 100 C. Let the unit cool below 80 C to reset.');
    else if (state.fault === 'inverted') setMessage('Danger condition: the endpoint order is inverted, so idle input maps toward full command.');
    else if (state.fault === 'highmin') setMessage('Endpoint minimum is above receiver idle; the ESC will fail arming validation.');
    else if (!state.calibrated) setMessage('Endpoint storage failed because the injected condition is not a valid calibration state.');
    else if (!state.armed) {
      if (state.currentTempC >= 80) setMessage('Arming interlock: ESC is too hot. Wait for it to cool below 80 C.');
      else setMessage('Valid endpoints are stored. Arm at idle to enable motor output.');
    }
    else if (verdict === 'OVER LIMIT') setMessage('Thermal limit exceeded. Reduce current, select a lower RDS(on) ESC, or fit the heatsink.');
    else if (op.P_w > Calc.HEATSINK_W && !state.heatsink) setMessage('Dissipation is above the 2 W cooling threshold; the MOSFET hotspot is concentrating heat.');
    else setMessage('Bench stable. Sweep pulse width or current to study control response and thermal margin.');
  }

  function setMessage(text) { setText('labMessage', text); }
  function setNote(text) { setText('simNote', text); }

  // ── run sheet (per-stage guided steps — "how to conduct this stage") ──
  function trackGuide(op) {
    const g = state.guide;
    if (state.armed && !state.thermalShutdown && state.pulseUs > 1000 && state.pulseUs <= 1055) g.deadband = true;
    g.pwLo = g.pwLo === null ? state.pulseUs : Math.min(g.pwLo, state.pulseUs);
    g.pwHi = g.pwHi === null ? state.pulseUs : Math.max(g.pwHi, state.pulseUs);
    if (g.pwHi - g.pwLo >= 350) g.swept = true;
    if (Math.abs(state.pulseUs - 1500) <= 6) g.at1500 = true;
    if (state.fault !== 'none') g.fault = true;
    if (state.protocol && g.protocols.indexOf(state.protocol.id) < 0) g.protocols.push(state.protocol.id);
    const full = state.motor && state.motor.full_current_a ? state.motor.full_current_a : null;
    if (full !== null && Math.abs(state.currentA - full) <= 0.8) g.fullLoad = true;
    if (state.armed && !state.thermalShutdown && op.T_c > ambientC() + 8) g.heat = true;
  }

  function renderSteps(op, verdict) {
    const el = $('stepGuide');
    if (!el) return;
    const g = state.guide;
    const recorded = (m) => (g.recorded[m] || 0) >= 1;
    let title = '', steps = [];
    if (state.mode === 'calibration') {
      title = 'Stage 1 — ESC Breakout & Calibration';
      steps = [
        { label: 'Pick an ESC platform', hint: 'Choose a tile in "ESC breakout" and inspect the 3D board + teardown spec.', done: !!state.esc },
        { label: 'Store the throttle endpoints', hint: 'Click "Store endpoints" to teach the ESC its 1000–2000 µs range.', done: state.calibrated && state.fault === 'none' },
        { label: 'Arm the ESC at idle', hint: 'With the pulse at idle, click "Arm ESC" — the motor must stay still.', done: state.armed && rawThrottle() <= 5 && !state.thermalShutdown },
        { label: 'Check the dead-band', hint: 'Drag Pulse up to ~1050 µs; throttle must stay 0% so the prop can\'t creep.', done: g.deadband }
      ];
    } else if (state.mode === 'mapping') {
      const pts = state.recordings.filter((r) => r.mapPoint).length;
      title = 'Stage 2 — Calibrate & Commission';
      steps = [
        { label: 'Store endpoints & arm at idle', hint: 'Click "Store endpoints", then "Arm ESC" with the pulse at idle.', done: state.calibrated && state.fault === 'none' && state.armed },
        { label: 'Run the 0-100% sweep', hint: 'Click "Run 0-100% sweep" (or drag Pulse) to drive the channel — this starts a fresh calibration run.', done: g.swept },
        { label: 'Record 5 points across the sweep', hint: 'Stop at 5 different pulse widths and click "Record point" — your dots build the obtained curve.', done: pts >= 5 },
        { label: 'Compare obtained vs expected', hint: 'Read the error box: the gap from the dashed ideal line is the real dead-band + receiver precision.', done: pts >= 5 }
      ];
    } else if (state.mode === 'timing') {
      const latency = protocolLatency();
      title = 'Stage 3 — Protocol & Latency';
      steps = [
        { label: 'Watch the 50 Hz lag', hint: 'Select "Standard PWM — 50 Hz": the amber ESC response trails the blue command by ~20 ms.', done: g.protocols.indexOf('pwm_50') >= 0 },
        { label: 'Speed up to 400 Hz', hint: 'Pick "Fast PWM — 400 Hz": the lag collapses to ~2.5 ms — resolution stays 1000 steps.', done: g.protocols.indexOf('pwm_400') >= 0 },
        { label: 'Try a DShot protocol', hint: 'Pick DShot300/600: the response snaps almost on top of the command — digital, no calibration.', done: g.protocols.some((id) => id.indexOf('dshot') === 0) },
        { label: 'Lock in a flight-ready protocol', hint: 'Record a reading and settle on a protocol under 5 ms latency — 50 Hz is too slow to sign off this stage.', done: recorded('timing') && latency <= LATENCY_OK_MS }
      ];
    } else {
      title = 'Stage 4 — Power & Thermal Sweep';
      steps = [
        { label: 'Set the load current', hint: 'Click "Full load" or drag Phase current to the motor\'s maximum.', done: g.fullLoad },
        { label: 'Run the thermal sweep', hint: 'Click "Run thermal sweep": the board heats and the P–I / T–I curves plot.', done: g.sweptThermal },
        { label: 'Read the 80 °C threshold', hint: 'Find where the T–I curve crosses 80 °C — that is the passive current limit.', done: g.sweptThermal && state.heatThreshold != null },
        { label: 'Fit a heatsink & re-run', hint: 'Toggle "Clamp-on heatsink" and run the sweep again — the threshold current rises.', done: state.heatsink && g.sweptThermal, optional: true }
      ];
    }
    let current = steps.findIndex((s) => !s.done && !s.optional);
    if (current < 0) current = steps.findIndex((s) => !s.done);
    const doneCount = steps.filter((s) => s.done).length;
    const rows = steps.map((s, i) => {
      const status = s.done ? 'done' : (i === current ? 'current' : 'todo');
      const mark = s.done ? '✓' : (i === current ? '▶' : '');
      const opt = s.optional ? ' optional' : '';
      return `<div class="run-step ${status}${opt}"><span class="run-step-num">${i + 1}</span>`
        + `<div class="run-step-body"><span class="run-step-label">${esc(s.label)}</span>`
        + `<span class="run-step-hint">${esc(s.hint)}</span></div>`
        + `<span class="run-step-mark">${mark}</span></div>`;
    }).join('');
    el.innerHTML = `<div class="run-sheet-head"><span class="run-sheet-title">${esc(title)}</span>`
      + `<span class="run-sheet-prog">${doneCount} / ${steps.length} done</span></div>`
      + `<div class="run-step-list">${rows}</div>`;
  }

  // ── ESC teardown / breakout spec card ──
  function renderTeardown() {
    const el = $('teardownSpec');
    if (!el) return;
    const e = state.esc;
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
    setText('dsCount', state.exploreComplete ? `all ${keys.length} viewed ✓` : `${viewed} / ${keys.length} viewed`);

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
  function renderTimingDetail() {
    const el = $('timingDetail');
    if (!el) return;
    const p = state.protocol;
    if (!p) { el.innerHTML = ''; return; }
    const latency = protocolLatency();
    const rows = [
      ['Protocol', p.label.replace(/\s*\(.*\)/, '')],
      ['Signal type', p.type === 'digital' ? 'Digital (DShot)' : 'Analog (PWM)'],
      p.type === 'digital' ? ['Bitrate', `${(p.bitrate_bps / 1000).toFixed(0)} kbit/s`] : ['Refresh rate', `${p.refresh_hz} Hz`],
      ['Command latency', latency < 1 ? `${(latency * 1000).toFixed(1)} µs` : `${latency.toFixed(2)} ms`],
      ['Resolution', `${(p.throttle_levels || 1000).toLocaleString()} steps`],
      ['Endpoint calibration', p.type === 'digital' ? 'Not required' : 'Required (1000–2000 µs)'],
      ['Frame size', p.type === 'digital' ? `${p.frame_bits} bits` : '—']
    ];
    el.innerHTML = rows.map(([k, v]) => `<div class="spec-row"><span class="spec-k">${esc(k)}</span><span class="spec-v">${esc(v)}</span></div>`).join('');
  }

  function renderProbes(op) {
    const list = $('probeList');
    if (!list) return;
    const amb = ambientC();
    list.innerHTML = heatProbes.map((pr) => {
      const t = amb + (op.T_c - amb) * pr.gain;
      const cls = t > Calc.T_LIMIT_C ? 'hot' : (t > 60 ? 'warm' : 'cool');
      return `<div class="probe ${cls}"><span>${esc(pr.id)}</span><strong>${t.toFixed(1)} °C</strong></div>`;
    }).join('');
  }

  // Deterministic [-1,1] pseudo-noise so a recorded point's scatter stays put once logged.
  function seededUnit(x) { const s = Math.sin(x * 127.1) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; }
  // Real RC links jitter by a few µs and the ESC quantises the pulse to its capture
  // resolution; together they add a small, repeatable precision error to each sample.
  function receiverJitterPct(idx) {
    const steps = (state.protocol && state.protocol.throttle_levels) ? state.protocol.throttle_levels : 1000;
    const quant = 100 / steps;                                  // one capture step, in %
    const jitterUs = state.fault === 'jitter' ? 14 : 4;         // RC-link timing jitter (µs)
    return seededUnit(idx * 12.9898 + 3.7) * (jitterUs / 10)    // µs → % on a 1000 µs span
      + seededUnit(idx * 7.231 + 1.1) * quant * 0.5;            // ± half a capture step
  }

  function recordReading() {
    // Stage 2 (mapping) logs a calibration point: ideal (assumed-linear) vs measured
    // (real ESC: dead-band + stored-endpoint fault + receiver precision).
    if (state.mode === 'mapping') {
      const ep = endpoints();
      const pw = state.pulseUs;
      const ideal = Calc.throttleFromPulse(pw, 1000, 2000);
      const real = (pw <= ep.min + Calc.DEADBAND_US && ep.min < ep.max) ? 0 : Calc.throttleFromPulse(pw, ep.min, ep.max);
      const idx = state.recordings.length;
      const measured = Calc.clamp(real + receiverJitterPct(idx), 0, 100);
      const error = measured - ideal;
      const cells = [`${pw.toFixed(0)} µs`, `${ideal.toFixed(1)}%`, `${measured.toFixed(1)}%`, `${error >= 0 ? '+' : ''}${error.toFixed(1)}%`];
      state.recordings.push({ cells: cells, mapPoint: true, pulse: pw, ideal: ideal, measured: measured, error: error, warn: Math.abs(error) > 4 });
      if (state.recordings.length > 12) state.recordings.shift();
      state.guide.recorded[state.mode] = (state.guide.recorded[state.mode] || 0) + 1;
      renderDataTable();
      updateAll();
      return;
    }
    const op = thermalPoint();
    const throttle = effectiveThrottle();
    const latency = protocolLatency();
    const verdict = op.T_c > Calc.T_LIMIT_C ? 'OVER LIMIT' : (Calc.heatsinkRequired(op.P_w) ? 'HEATSINK REQ' : 'PASSIVE OK');
    let cells;
    if (state.mode === 'timing') {
      cells = [esc(state.protocol.label.replace(/\s*\(.*\)/, '')), `${steps_(state.protocol)} steps`, latency < 1 ? `${(latency * 1000).toFixed(1)} µs` : `${latency.toFixed(2)} ms`, `${throttle.toFixed(0)}%`, state.protocol.type];
    } else {
      cells = [`${state.currentA.toFixed(1)} A`, `${op.R_ohm.toFixed(5)} Ω`, `${op.P_w.toFixed(3)}`, `${op.T_c.toFixed(1)} °C`, verdict];
    }
    state.recordings.push({ cells: cells, over: op.T_c > Calc.T_LIMIT_C, warn: op.T_c > 60 && op.T_c <= Calc.T_LIMIT_C });
    if (state.recordings.length > 12) state.recordings.shift();
    state.guide.recorded[state.mode] = (state.guide.recorded[state.mode] || 0) + 1;
    renderDataTable();
    updateAll();
  }
  function steps_(p) { return p ? (p.throttle_levels || 1000) : 1000; }

  function renderDataTable() {
    const body = $('dataTableBody');
    setText('dataCount', `${state.recordings.length} logged`);
    if (!body) return;
    if (!state.recordings.length) {
      body.innerHTML = `<tr class="data-empty"><td colspan="5">No readings recorded yet.</td></tr>`;
      return;
    }
    body.innerHTML = state.recordings.map((r) => {
      const cls = r.over ? ' class="row-hot"' : (r.warn ? ' class="row-warn"' : '');
      return `<tr${cls}>${r.cells.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`;
    }).join('');
  }

  function renderChecklist(op) {
    const el = $('checklist');
    if (!el) return;
    const iActive = state.armed && !state.thermalShutdown ? state.currentA : 0;
    const pCold = Calc.escDissipation(iActive, state.esc.rds_on_ohm);
    const isMap = state.mode === 'mapping';
    const ptCount = isMap ? state.recordings.filter((r) => r.mapPoint).length : state.recordings.length;
    const items = [];
    if (isMap) {
      const parts = presentComponents();
      const viewed = parts.filter((k) => state.guide.viewedParts.indexOf(k) >= 0).length;
      items.push({ label: 'Components inspected (Tab 1)', ok: state.exploreComplete, warn: !state.exploreComplete && viewed > 0, val: `${viewed}/${parts.length}` });
    }
    items.push(
      { label: 'Endpoints stored', ok: state.calibrated && state.fault === 'none', val: state.calibrated ? '1000–2000 µs' : 'invalid' },
      { label: 'Armed at idle', ok: state.armed && !state.thermalShutdown, val: state.armed ? 'armed' : 'disarmed' },
      { label: 'Dissipation under 2 W', ok: pCold <= Calc.HEATSINK_W, warn: pCold > Calc.HEATSINK_W, val: `${pCold.toFixed(2)} W` },
      { label: 'Hotspot under 80 °C', ok: op.T_c <= Calc.T_LIMIT_C, warn: op.T_c > Calc.T_LIMIT_C, val: `${op.T_c.toFixed(0)} °C` },
      { label: isMap ? 'Calibration points (≥ 5)' : 'Readings logged (≥ 3)', ok: ptCount >= (isMap ? 5 : 3), val: `${ptCount}` }
    );
    el.innerHTML = items.map((it) => {
      const state_ = it.ok ? 'done' : (it.warn ? 'warn' : 'pending');
      const icon = it.ok ? '✓' : (it.warn ? '!' : '');
      return `<div class="checklist-item"><span class="chk-icon ${state_}">${icon}</span>`
        + `<span class="checklist-label">${esc(it.label)}</span><span class="checklist-val">${esc(it.val)}</span></div>`;
    }).join('');
  }

  function renderDecision(op, verdict) {
    const card = $('decisionCard');
    if (!card) return;
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

  function renderCalProgress() {
    const el = $('calProgress');
    if (!el) return;
    const ep = endpoints();
    const okMin = ep.min === 1000, okMax = ep.max === 2000;
    el.innerHTML = `<div class="spec-row"><span class="spec-k">Stored minimum</span><span class="spec-v">${ep.min} µs ${okMin ? '✓' : '✗'}</span></div>`
      + `<div class="spec-row"><span class="spec-k">Stored maximum</span><span class="spec-v">${ep.max} µs ${okMax ? '✓' : '✗'}</span></div>`
      + `<div class="spec-row"><span class="spec-k">Dead-band</span><span class="spec-v">${Calc.DEADBAND_US} µs</span></div>`
      + `<div class="spec-row"><span class="spec-k">Arming state</span><span class="spec-v">${state.armed ? 'ARMED' : 'DISARMED'}</span></div>`;
  }

  function renderMapTable() {
    const body = $('mapTableBody');
    if (!body) return;
    const ep = endpoints();
    const rows = [1000, 1100, 1250, 1500, 1750, 1900, 2000].map((pw) => {
      const raw = Calc.throttleFromPulse(pw, ep.min, ep.max);
      const eff = pw <= ep.min + Calc.DEADBAND_US && ep.min < ep.max ? 0 : raw;
      const here = Math.abs(pw - state.pulseUs) < 26;
      return `<tr${here ? ' class="row-warn"' : ''}><td>${pw} µs</td><td>${raw.toFixed(1)}%</td><td>${eff.toFixed(1)}%</td></tr>`;
    }).join('');
    body.innerHTML = rows;
  }

  // ── Thermal sweep experiment: step the current, compute the P–I / T–I curves, find the
  //    80 °C passive threshold, fill the data table, and drive the live bench so it heats up.
  function runThermalSweep() {
    const rTh = thermalRth();
    const r25 = state.esc.rds_on_ohm;
    const amb = ambientC();
    const iMax = state.esc.burst_current_a || state.esc.current_a || 60;
    const N = 12;
    const data = [];
    for (let k = 0; k <= N; k++) {
      const I = iMax * k / N;
      let P, T, R;
      if (state.hotModel && I > 0) { const hop = Calc.hotOperatingPoint(I, r25, rTh, amb); P = hop.P_w; T = hop.T_c; R = hop.R_ohm; }
      else { R = r25; P = Calc.escDissipation(I, r25); T = Calc.escSteadyTemp(P, rTh, amb); }
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

    state.recordings = data.filter((d, idx) => d.i > 0 && idx % 2 === 0).map((d) => {
      const verdict = d.t > Calc.T_LIMIT_C ? 'OVER LIMIT' : (Calc.heatsinkRequired(d.p) ? 'HEATSINK REQ' : 'PASSIVE OK');
      return { cells: [`${d.i.toFixed(1)} A`, `${d.r.toFixed(5)} Ω`, `${d.p.toFixed(3)}`, `${d.t.toFixed(1)} °C`, verdict], over: d.t > Calc.T_LIMIT_C, warn: d.t > 65 && d.t <= Calc.T_LIMIT_C };
    });
    state.guide.sweptThermal = true;
    state.guide.recorded['thermal'] = (state.guide.recorded['thermal'] || 0) + 1;

    // Drive the live bench so the 3D board visibly climbs toward the limit.
    state.currentA = Math.min(iMax, 78);
    setVal('currentSlider', Math.min(state.currentA, 80));
    state.armed = true; state.thermalShutdown = false;
    renderDataTable();
    setNote('Thermal time is fast-forwarded ×' + ((state.db.thermal || fallbackDb.thermal).sim_fast_forward || 30) + ' so the multi-minute heat-up is watchable.');
    updateAll();
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
      mapping: ['Calibration: Expected vs Obtained', 'Your recorded points (real ESC) plotted against the ideal pulse → throttle line.'],
      timing: ['Protocol Latency', 'Command latency and resolution per protocol.'],
      thermal: ['Thermal Sweep — P–I & T–I', 'Dissipation and hotspot vs phase current, with the 2 W / 80 °C limits.']
    };
    if (chartTitle && titles[state.mode]) chartTitle.textContent = titles[state.mode][0];
    if (chartDesc && titles[state.mode]) chartDesc.textContent = titles[state.mode][1];

    const blurbs = {
      calibration: ['Stage 1 — explore the anatomy of the ESC. Spin the exploded board and click any component to learn what it is and what it does.', 'Click a component callout or the list to inspect it · drag to orbit · scroll to zoom.'],
      mapping: ['Stage 2 — calibrate the throttle channel, then sweep and record 5 points to compare your real ESC curve against the ideal.', 'Sweep, then record 5 points at different pulse widths to plot expected vs obtained.'],
      timing: ['Stage 3 — choose a signal protocol and compare command latency against step resolution.', 'Pick a protocol; compare latency and step resolution.'],
      thermal: ['Stage 4 — load the ESC to its phase current and run a thermal sweep to size the cooling.', 'Run the thermal sweep, then read where T–I crosses 80 °C.']
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
    else if (state.mode === 'thermal') drawSweepChart(ctx, w, h, op);
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
    // axis labels (bright + sized for legibility)
    ctx.fillStyle = '#cbd5e1'; ctx.font = `${fs}px ${ff()}`; ctx.textAlign = 'center';
    [1000, 1250, 1500, 1750, 2000].forEach((pw) => ctx.fillText(pw, xOf(pw), bottom + fs * 1.5));
    ctx.textAlign = 'right';
    [0, 25, 50, 75, 100].forEach((t) => ctx.fillText(t + '%', left - fs * 0.4, yOf(t) + fs * 0.35));
    ctx.textAlign = 'left';

    // dead-band region (only meaningful when endpoints aren't inverted)
    if (ep.min < ep.max) {
      ctx.fillStyle = 'rgba(239,68,68,0.10)';
      ctx.fillRect(left, top, xOf(ep.min + Calc.DEADBAND_US) - left, bottom - top);
    }

    // Expected (ideal) — straight dashed line, 1000 µs → 0 %, 2000 µs → 100 %
    ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = Math.max(1.6, w * 0.003); ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(xOf(1000), yOf(0)); ctx.lineTo(xOf(2000), yOf(100)); ctx.stroke();
    ctx.setLineDash([]);

    // Obtained — the student's recorded points (real ESC), sorted by pulse
    const pts = state.recordings.filter((r) => r.mapPoint).slice().sort((a, b) => a.pulse - b.pulse);
    // per-point error connectors (vertical dotted line up/down to the ideal line)
    ctx.setLineDash([2, 3]); ctx.strokeStyle = 'rgba(248,113,113,0.55)'; ctx.lineWidth = 1;
    pts.forEach((p) => line(ctx, xOf(p.pulse), yOf(p.measured), xOf(p.pulse), yOf(p.ideal)));
    ctx.setLineDash([]);
    // obtained curve through the points
    if (pts.length >= 2) {
      ctx.strokeStyle = '#ffbf00'; ctx.lineWidth = Math.max(2, w * 0.004); ctx.beginPath();
      pts.forEach((p, i) => { const px = xOf(p.pulse), py = yOf(p.measured); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
      ctx.stroke();
    }
    // markers + error stats
    let sumSq = 0, maxErr = 0;
    pts.forEach((p) => {
      const px = xOf(p.pulse), py = yOf(p.measured);
      ctx.fillStyle = '#fbbf24'; ctx.beginPath(); ctx.arc(px, py, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#78350f'; ctx.lineWidth = 1.2; ctx.stroke();
      sumSq += p.error * p.error; if (Math.abs(p.error) > Math.abs(maxErr)) maxErr = p.error;
    });

    // live position marker — where the current pulse sits on the real map (independent of arming)
    const liveEff = (state.pulseUs <= ep.min + Calc.DEADBAND_US && ep.min < ep.max) ? 0 : Calc.throttleFromPulse(state.pulseUs, ep.min, ep.max);
    ctx.fillStyle = 'rgba(52,211,153,0.95)'; ctx.beginPath(); ctx.arc(xOf(state.pulseUs), yOf(liveEff), 4, 0, Math.PI * 2); ctx.fill();

    // legend + status now live in crisp HTML (see #chartLegend / #chartStatus)
    const n = pts.length;
    let msg;
    if (n < 5) msg = `Record ${5 - n} more point${5 - n > 1 ? 's' : ''} at different pulse widths — your dots build the obtained curve.`;
    else { const rms = Math.sqrt(sumSq / n); msg = `${n} points logged · obtained vs ideal: RMS error ${rms.toFixed(1)}%, worst ${maxErr >= 0 ? '+' : ''}${maxErr.toFixed(1)}%.`; }
    setText('chartStatus', msg);
  }

  // ── Completion result: two clean, separate panels (Expected | Calibrated) ──
  // Revealed once the student has recorded 5+ points and stopped the sweep. Text
  // annotations live in HTML (#calibResultStatus) so they stay crisp.
  function renderCalibResult(show) {
    const sec = $('calibResults');
    if (!sec) return;
    sec.hidden = !show;
    if (!show) return;
    const pts = state.recordings.filter((r) => r.mapPoint).slice().sort((a, b) => a.pulse - b.pulse);
    drawCalPanel($('expectedCanvas'), 'expected', pts);
    drawCalPanel($('calibratedCanvas'), 'calibrated', pts);
    let sumSq = 0, maxErr = 0;
    pts.forEach((p) => { sumSq += p.error * p.error; if (Math.abs(p.error) > Math.abs(maxErr)) maxErr = p.error; });
    const rms = pts.length ? Math.sqrt(sumSq / pts.length) : 0;
    setText('calibResultTag', `${pts.length} points`);
    setText('calibResultStatus',
      `Left is the ideal map you assumed; right is your real ESC built from ${pts.length} recorded points — RMS error ${rms.toFixed(1)}%, worst ${maxErr >= 0 ? '+' : ''}${maxErr.toFixed(1)}%. The flat gap near idle is the dead-band, which is exactly why an ESC must be calibrated and armed at idle.`);
  }

  // Draw one calibration result panel (DPR-aware; sizes itself from layout each call).
  function drawCalPanel(c, kind, pts) {
    if (!c || !c.getContext) return;
    const rect = c.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(280, Math.round((rect.width || 380) * dpr));
    const H = Math.max(150, Math.round((rect.height || 180) * dpr));
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const w = c.width, h = c.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, w, h);

    const left = w * 0.15, right = w * 0.96, bottom = h * 0.80, top = h * 0.10;
    const ep = endpoints();
    const xOf = (pw) => left + (right - left) * Calc.clamp((pw - 1000) / 1000, 0, 1);
    const yOf = (t) => bottom - (bottom - top) * Calc.clamp(t / 100, 0, 1);
    const fs = Math.max(12, w * 0.026);

    // gridlines + axes
    ctx.strokeStyle = 'rgba(148,163,184,0.13)'; ctx.lineWidth = 1;
    [25, 50, 75, 100].forEach((t) => line(ctx, left, yOf(t), right, yOf(t)));
    ctx.strokeStyle = 'rgba(148,163,184,0.55)';
    line(ctx, left, bottom, right, bottom); line(ctx, left, top, left, bottom);
    // axis labels (bright + sized)
    ctx.fillStyle = '#cbd5e1'; ctx.font = `${fs}px ${ff()}`; ctx.textAlign = 'center';
    [1000, 1500, 2000].forEach((pw) => ctx.fillText(pw, xOf(pw), bottom + fs * 1.5));
    ctx.textAlign = 'right';
    [0, 50, 100].forEach((t) => ctx.fillText(t + '%', left - fs * 0.4, yOf(t) + fs * 0.35));
    ctx.textAlign = 'left';

    if (kind === 'expected') {
      ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = Math.max(2.4, w * 0.006);
      ctx.beginPath(); ctx.moveTo(xOf(1000), yOf(0)); ctx.lineTo(xOf(2000), yOf(100)); ctx.stroke();
    } else {
      // faint ideal reference for direct comparison
      ctx.strokeStyle = 'rgba(96,165,250,0.5)'; ctx.lineWidth = Math.max(1.4, w * 0.003); ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.moveTo(xOf(1000), yOf(0)); ctx.lineTo(xOf(2000), yOf(100)); ctx.stroke(); ctx.setLineDash([]);
      // dead-band shading
      if (ep.min < ep.max) { ctx.fillStyle = 'rgba(239,68,68,0.10)'; ctx.fillRect(left, top, xOf(ep.min + Calc.DEADBAND_US) - left, bottom - top); }
      // obtained curve through the recorded points
      if (pts.length >= 2) {
        ctx.strokeStyle = '#ffbf00'; ctx.lineWidth = Math.max(2.4, w * 0.006); ctx.beginPath();
        pts.forEach((p, i) => { const px = xOf(p.pulse), py = yOf(p.measured); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.stroke();
      }
      // recorded markers
      pts.forEach((p) => {
        ctx.fillStyle = '#fbbf24'; ctx.beginPath(); ctx.arc(xOf(p.pulse), yOf(p.measured), Math.max(3.5, w * 0.008), 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#78350f'; ctx.lineWidth = 1.2; ctx.stroke();
      });
    }
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

  // Stage 3 latency demo: an animated "command vs ESC response" scope so the lag is
  // something you SEE, not just a number. The amber ESC-response trace trails the blue
  // command by the protocol's latency; on the fixed 50 ms window the 50 Hz lag is a wide
  // visible gap while a DShot frame sits almost on top of the command.
  function drawTimingChart(ctx, w, h) {
    const p = state.protocol;
    const latency = protocolLatency();                  // ms
    const windowMs = 50;                                // fixed window → protocols compare to scale
    const left = w * 0.075, right = w * 0.965;
    const pxPerMs = (right - left) / windowMs;
    const fs = Math.max(13, w * 0.017);

    const cmdHi = h * 0.20, cmdLo = h * 0.40;           // command band (upper)
    const respHi = h * 0.58, respLo = h * 0.78;         // response band (lower)

    const tNow = (state.phase || 0) * 1000;             // ms, animated by the rAF loop
    const xAt = (t) => right - (tNow - t) * pxPerMs;

    // command square wave: the pilot's stick steps between two throttle levels
    const half = 13;                                    // ms per half-cycle
    const cmd = (t) => (Math.floor(t / half) % 2 === 0) ? 1 : 0;
    const resp = (t) => cmd(t - latency);               // pure transport delay = protocol latency

    // time gridlines + axis labels (every 10 ms back from "now")
    ctx.strokeStyle = 'rgba(148,163,184,0.12)'; ctx.lineWidth = 1;
    ctx.fillStyle = '#94a3b8'; ctx.font = `${fs * 0.78}px ${ff()}`; ctx.textAlign = 'center';
    for (let ms = 0; ms <= windowMs; ms += 10) {
      const x = right - ms * pxPerMs;
      line(ctx, x, h * 0.12, x, h * 0.84);
      ctx.fillText(ms === 0 ? 'now' : `-${ms}ms`, x, h * 0.93);
    }

    // square-wave trace sampled per pixel
    function drawTrace(fn, hi, lo, color) {
      ctx.strokeStyle = color; ctx.lineWidth = Math.max(2.2, w * 0.0042); ctx.beginPath();
      let first = true;
      for (let x = left; x <= right; x += 1) {
        const t = tNow - (right - x) / pxPerMs;
        const y = fn(t) ? hi : lo;
        if (first) { ctx.moveTo(x, y); first = false; } else { ctx.lineTo(x, y); }
      }
      ctx.stroke();
    }
    drawTrace(cmd, cmdHi, cmdLo, '#60a5fa');
    drawTrace(resp, respHi, respLo, '#ffbf00');

    // Δt bracket anchored mid-window so it stays readable as the trace scrolls
    const refEdge = Math.floor((tNow - windowMs * 0.5) / half) * half;
    const xCmd = xAt(refEdge), xResp = xAt(refEdge + latency);
    if (xCmd >= left && xResp <= right) {
      ctx.strokeStyle = 'rgba(226,232,240,0.65)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
      line(ctx, xCmd, cmdHi - 4, xCmd, respLo + 4);
      line(ctx, xResp, cmdHi - 4, xResp, respLo + 4);
      ctx.setLineDash([]);
      const yMid = h * 0.49;
      ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1.5; line(ctx, xCmd, yMid, xResp, yMid);
      ctx.fillStyle = '#e2e8f0'; ctx.font = `700 ${fs}px ${ff()}`; ctx.textAlign = 'left';
      const lbl = latency < 1 ? `Δt = ${(latency * 1000).toFixed(0)} µs` : `Δt = ${latency.toFixed(1)} ms`;
      const lx = Math.min(xResp + 8, right - fs * 7);
      ctx.fillText(lbl, Math.max(left, lx), yMid - fs * 0.5);
    }

    // readable headline caption lives in HTML (#chartDesc), not on the canvas
    const t = latency < 1 ? `${(latency * 1000).toFixed(0)} µs` : `${latency.toFixed(1)} ms`;
    const name = p ? p.label.replace(/\s*\(.*\)/, '') : '';
    setText('chartDesc', latency <= LATENCY_OK_MS
      ? `${name}: the ESC acts on each new command after ${t} — fast enough for stable flight control.`
      : `${name}: the ESC only reacts every ${t}. Watch the amber response lag the blue command — fine for a servo, far too slow for a quad.`);
  }

  function drawSweepChart(ctx, w, h, op) {
    const left = w * 0.13, right = w * 0.88, bottom = h * 0.78, top = h * 0.12;
    const sd = state.sweepData;
    const iMax = state.esc.burst_current_a || state.esc.current_a || 60;
    const tMax = 110;
    let pMax = Calc.escDissipation(iMax, state.esc.rds_on_ohm);
    if (sd) sd.data.forEach((d) => { if (d.p > pMax) pMax = d.p; });
    pMax = Math.max(pMax, 2.5) * 1.1;
    const xOf = (i) => left + (right - left) * Calc.clamp(i / iMax, 0, 1);
    const yT = (t) => bottom - (bottom - top) * Calc.clamp(t / tMax, 0, 1);
    const yP = (p) => bottom - (bottom - top) * Calc.clamp(p / pMax, 0, 1);

    ctx.strokeStyle = 'rgba(148,163,184,0.5)'; ctx.lineWidth = 1;
    line(ctx, left, bottom, right, bottom); line(ctx, left, top, left, bottom);
    ctx.strokeStyle = 'rgba(148,163,184,0.25)'; line(ctx, right, top, right, bottom);

    // limit lines
    ctx.strokeStyle = 'rgba(239,68,68,0.8)'; ctx.setLineDash([7, 6]); line(ctx, left, yT(Calc.T_LIMIT_C), right, yT(Calc.T_LIMIT_C));
    ctx.strokeStyle = 'rgba(245,158,11,0.7)'; line(ctx, left, yP(Calc.HEATSINK_W), right, yP(Calc.HEATSINK_W)); ctx.setLineDash([]);

    // previous-ESC comparison curve (faded)
    if (state.prevSweep && state.prevSweep.data) {
      ctx.strokeStyle = 'rgba(125,211,252,0.45)'; ctx.lineWidth = Math.max(1.5, w * 0.0025); ctx.beginPath();
      state.prevSweep.data.forEach((d, idx) => { const x = xOf(d.i), y = yT(d.t); idx ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
    }

    if (sd) {
      ctx.strokeStyle = '#f87171'; ctx.lineWidth = Math.max(2, w * 0.004); ctx.beginPath();
      sd.data.forEach((d, idx) => { const x = xOf(d.i), y = yT(d.t); idx ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
      ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = Math.max(2, w * 0.004); ctx.beginPath();
      sd.data.forEach((d, idx) => { const x = xOf(d.i), y = yP(d.p); idx ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
      if (sd.threshold) {
        const xt = xOf(sd.threshold);
        ctx.strokeStyle = 'rgba(239,68,68,0.6)'; ctx.setLineDash([4, 4]); line(ctx, xt, top, xt, bottom); ctx.setLineDash([]);
        ctx.fillStyle = '#fecaca'; ctx.font = `700 ${Math.max(10, w * 0.016)}px ${ff()}`; ctx.fillText(`${sd.threshold.toFixed(1)} A`, xt + 4, top + 12);
      }
    }
    // live operating point
    const iActive = state.armed && !state.thermalShutdown ? state.currentA : 0;
    ctx.fillStyle = tempColor(op.T_c); ctx.beginPath(); ctx.arc(xOf(iActive), yT(op.T_c), 6, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = '#fca5a5'; ctx.font = `700 ${Math.max(9, w * 0.014)}px ${ff()}`; ctx.textAlign = 'left'; ctx.fillText('T (°C)', left, top - 3);
    ctx.fillStyle = '#fcd34d'; ctx.textAlign = 'right'; ctx.fillText('P (W)', right, top - 3); ctx.textAlign = 'left';
    const msg = sd
      ? (sd.threshold ? `${sd.label}: passive OK to ~${sd.threshold.toFixed(0)} A, heatsink needed above` : `${sd.label}: under 80 °C across the full range`)
      : 'Click "Run thermal sweep" to plot P–I and T–I against the 2 W / 80 °C limits';
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

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', appInit);
  else appInit();
})();
