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

  return Object.freeze({
    DEG, clamp,
    rollInertia, naturalFreq, dampingRatio, overshootPct, peakTime, settlingTime, riseTime,
    disturbanceError, secondOrderStep,
    ultimateFreq, ultimatePeriod, ultimateGain, znClassic, znTyreusLuyben, rateStepResponse,
    filterTimeConstant, driftError, noiseRMS, fusionTotal, complementaryStep, optimalAlpha
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

  const $ = (id) => document.getElementById(id);
  const on = (id, evt, fn) => { const el = $(id); if (el) el.addEventListener(evt, fn); };
  const setText = (id, t) => { const el = $(id); if (el) el.innerHTML = t; };
  const setVal = (id, v) => { const el = $(id); if (el) el.value = v; };
  const byId = (list, id) => list.find((x) => x.id === id) || list[0];
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const readJSON = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const clampNum = (v, lo, hi, fb) => { const n = parseFloat(v); return isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fb; };

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
    done: { pidstep: false, ziegler: false, fusion: false },
    airframe: null, imu: null,
    Kp: 0.6, Ki: 0.0, Kd: 0.04,
    tuning: 'manual',          // manual | classic | tyreus
    znGain: 8.0,               // swept proportional gain for the Z-N ultimate test
    alpha: 0.98,
    disturbance: false,
    noise: true,
    Td: 0.0175,
    inheritedJ: false, inheritedTd: false, airframeUserSet: false,
    // animation
    phase: 0, lastTime: null, playT: 0,
    znResp: null,              // cached rate-loop step response (ziegler mode)
    // fusion live sim
    fuse: { t: 0, gyroAngle: 0, fused: 0, hist: [] }
  };

  // ── connections to upstream experiments ────────────────────────────────────
  function inheritFromExp2() {
    const m2 = readJSON('vlabModule2_final');
    if (!m2) return;
    if (typeof m2.mass_g === 'number' && typeof m2.arm_length_mm === 'number' && state.airframe) {
      const J = Calc.rollInertia(m2.mass_g / 1000, m2.arm_length_mm / 1000);
      if (isFinite(J) && J > 0) {
        state.airframe = Object.assign({}, state.airframe, { J_roll_kgm2: J, mass_g: m2.mass_g, arm_length_mm: m2.arm_length_mm, _inherited: true });
        state.inheritedJ = true;
      }
    }
    if (typeof m2.cg_offset_mm === 'number') {
      const m = (m2.mass_g ? m2.mass_g / 1000 : 0.5);
      state.Td = m * state.db.constants.g_m_s2 * (m2.cg_offset_mm / 1000);
      state.inheritedTd = true;
    }
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
    if (['manual', 'classic', 'tyreus'].indexOf(s.tuning) >= 0) state.tuning = s.tuning;
    if (typeof s.disturbance === 'boolean') state.disturbance = s.disturbance;
    if (typeof s.noise === 'boolean') state.noise = s.noise;
    if (s.done && typeof s.done === 'object') {
      state.done.pidstep = !!s.done.pidstep;
      state.done.ziegler = !!s.done.ziegler;
      state.done.fusion = !!s.done.fusion;
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
        done: { pidstep: !!state.done.pidstep, ziegler: !!state.done.ziegler, fusion: !!state.done.fusion }
      };
      const str = JSON.stringify(payload);
      const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      if (str === _lastPersist || now - _lastPersistAt < 350) return;
      _lastPersist = str; _lastPersistAt = now;
      localStorage.setItem(LS.session, str);
      // computed handoff for downstream / refresh
      const J = state.airframe.J_roll_kgm2;
      const wn = Calc.naturalFreq(state.Kp, J), zeta = Calc.dampingRatio(state.Kp, state.Kd, J);
      localStorage.setItem(LS.Kp, state.Kp.toFixed(3));
      localStorage.setItem(LS.Ki, state.Ki.toFixed(3));
      localStorage.setItem(LS.Kd, state.Kd.toFixed(4));
      localStorage.setItem(LS.overshoot, Calc.overshootPct(zeta).toFixed(2));
      localStorage.setItem(LS.settling, Calc.settlingTime(wn, zeta).toFixed(3));
      localStorage.setItem(LS.alpha, state.alpha.toFixed(3));
      const im = state.imu;
      localStorage.setItem(LS.attitudeError, Calc.fusionTotal(im.gyro_bias_dps, im.accel_noise_deg, state.alpha, im.dt_s).toFixed(3));
    } catch (e) { /* storage unavailable */ }
  }

  // ── boot ────────────────────────────────────────────────────────────────────
  function appInit() {
    if (!$('benchCanvas')) return;
    fetch('db/db.json').then((r) => r.ok ? r.json() : fallbackDb).then((db) => { state.db = db; boot(); }).catch(() => boot());
  }

  function boot() {
    state.airframe = state.db.airframes.find((a) => a.default) || state.db.airframes[1] || state.db.airframes[0];
    state.imu = state.db.imu_presets.find((p) => p.default) || state.db.imu_presets[0];
    const pd = state.db.pid && state.db.pid.defaults; if (pd) { state.Kp = pd.Kp; state.Ki = pd.Ki; state.Kd = pd.Kd; }
    if (state.db.disturbance) state.Td = state.db.disturbance.torque_nm_default;

    inheritFromExp2();     // J + disturbance torque from the Experiment-2 build
    restoreSession();      // a saved Exp5 session (refresh / re-login) overrides

    hydrateControls();
    bindControls();
    initScene3D();
    resizeCanvases();
    recompute();
    updateAll();
    requestAnimationFrame(loop);
  }

  function hydrateControls() {
    const af = $('airframeSelect');
    if (af) af.innerHTML = state.db.airframes.map((a) => `<option value="${esc(a.id)}"${a.id === state.airframe.id ? ' selected' : ''}>${esc(a.label)}</option>`).join('');
    const iu = $('imuSelect');
    if (iu) iu.innerHTML = state.db.imu_presets.map((p) => `<option value="${esc(p.id)}"${p.id === state.imu.id ? ' selected' : ''}>${esc(p.label)}</option>`).join('');
    const tu = $('tuningSelect'); if (tu) tu.value = state.tuning;
    setVal('kpSlider', state.Kp); setText('kpOut', state.Kp.toFixed(2));
    setVal('kiSlider', state.Ki); setText('kiOut', state.Ki.toFixed(2));
    setVal('kdSlider', state.Kd); setText('kdOut', state.Kd.toFixed(3));
    setVal('alphaSlider', state.alpha); setText('alphaOut', state.alpha.toFixed(3));
    setVal('znSlider', state.znGain); setText('znOut', state.znGain.toFixed(1));
    const dt = $('disturbanceToggle'); if (dt) dt.checked = state.disturbance;
    const nt = $('noiseToggle'); if (nt) nt.checked = state.noise;
    syncTabs();
  }

  function bindControls() {
    on('airframeSelect', 'change', (e) => {
      const a = byId(state.db.airframes, e.target.value);
      state.airframe = a; state.inheritedJ = false; state.airframeUserSet = true; recompute(); updateAll();
    });
    on('imuSelect', 'change', (e) => { state.imu = byId(state.db.imu_presets, e.target.value); recompute(); updateAll(); });
    on('tuningSelect', 'change', (e) => { state.tuning = e.target.value; recompute(); updateAll(); });
    on('kpSlider', 'input', (e) => { state.Kp = +e.target.value; setText('kpOut', state.Kp.toFixed(2)); recompute(); updateAll(); });
    on('kiSlider', 'input', (e) => { state.Ki = +e.target.value; setText('kiOut', state.Ki.toFixed(2)); recompute(); updateAll(); });
    on('kdSlider', 'input', (e) => { state.Kd = +e.target.value; setText('kdOut', state.Kd.toFixed(3)); recompute(); updateAll(); });
    on('alphaSlider', 'input', (e) => { state.alpha = +e.target.value; setText('alphaOut', state.alpha.toFixed(3)); updateAll(); });
    on('znSlider', 'input', (e) => { state.znGain = +e.target.value; setText('znOut', state.znGain.toFixed(1)); state.tuning = 'manual'; const tu = $('tuningSelect'); if (tu) tu.value = 'manual'; recompute(); updateAll(); });
    on('disturbanceToggle', 'change', (e) => { state.disturbance = e.target.checked; updateAll(); });
    on('noiseToggle', 'change', (e) => { state.noise = e.target.checked; updateAll(); });
    on('stepBtn', 'click', () => { state.playT = 0; state.fuse.t = 0; updateAll(); });
    on('autotuneBtn', 'click', () => { state.tuning = (state.tuning === 'classic') ? 'tyreus' : 'classic'; const tu = $('tuningSelect'); if (tu) tu.value = state.tuning; recompute(); updateAll(); });
    on('resetBtn', 'click', () => {
      const pd = state.db.pid.defaults; state.Kp = pd.Kp; state.Ki = pd.Ki; state.Kd = pd.Kd;
      state.tuning = 'manual'; state.alpha = state.db.complementary_filter.alpha_default || 0.98;
      state.fuse = { t: 0, gyroAngle: 0, fused: 0, hist: [] }; state.playT = 0;
      hydrateControls(); recompute(); updateAll();
    });
    document.querySelectorAll('.vp-tab').forEach((btn) => {
      btn.addEventListener('click', () => { state.mode = btn.dataset.mode; state.playT = 0; syncTabs(); recompute(); updateAll(); });
    });
    window.addEventListener('resize', resizeCanvases);
  }

  function syncTabs() {
    document.querySelectorAll('.vp-tab').forEach((b) => b.classList.toggle('active', b.dataset.mode === state.mode));
    const titles = {
      pidstep: ['Roll Angle Step Response', 'theta(t) — second-order roll loop'],
      ziegler: ['Rate-Loop Tuning Response', 'omega(t) — three-lag inner loop'],
      fusion: ['Attitude Estimate Fusion', 'theta-hat(t) — fused vs gyro vs accel']
    };
    const t = titles[state.mode] || titles.pidstep;
    setText('primaryChartTitle', t[0]); setText('primaryChartTag', t[1]);
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
    return { Kp: state.znGain, Ki: 0, Kd: 0, Ti: Infinity, Td: 0 };   // manual proportional sweep
  }
  function recompute() {
    if (state.mode !== 'ziegler') { state.znResp = null; return; }
    const l = lags(), g = effectiveRateGains();
    const zn = znValues();
    const T = Math.max(0.4, 12 * zn.Pu);
    state.znResp = Calc.rateStepResponse(g.Kp, g.Ki, g.Kd, l.tm, l.ta, l.ts, { dt: Math.min(5e-5, zn.Pu / 200), T: T });
    state.znResp._T = T;
  }

  // ── per-mode DOM update ─────────────────────────────────────────────────────
  function rows(list) { return list.map((r) => `<div class="metric"><span>${esc(r[0])}</span><strong>${r[1]}</strong></div>`).join(''); }
  function probes(list) { return list.map((r) => `<div class="probe ${r[2] || ''}"><span>${esc(r[0])}</span><strong>${r[1]}</strong></div>`).join(''); }

  function updateAll() {
    if (state.mode === 'fusion') updateFusion();
    else if (state.mode === 'ziegler') updateZiegler();
    else updatePid();
    syncProceed();
    persist();
  }

  function updatePid() {
    const J = state.airframe.J_roll_kgm2;
    const wn = Calc.naturalFreq(state.Kp, J), zeta = Calc.dampingRatio(state.Kp, state.Kd, J);
    const os = Calc.overshootPct(zeta), tr = Calc.riseTime(wn, zeta), tp = Calc.peakTime(wn, zeta), ts = Calc.settlingTime(wn, zeta);
    const Td = state.disturbance ? state.Td : 0;
    const essRad = state.Ki > 0 ? 0 : Calc.disturbanceError(Td, state.Kp);
    const essDeg = isFinite(essRad) ? essRad * Calc.DEG : 0;
    const over = os > (state.db.targets.overshoot_max_pct || 25);

    setText('benchHud', [
      ['Setpoint', (state.db.pid.setpoint_deg || 20).toFixed(0) + ' deg'],
      ['Damping z', zeta.toFixed(3)],
      ['Overshoot', os.toFixed(1) + ' %'],
      ['Settling', ts.toFixed(2) + ' s']
    ].map((r) => `<div><span>${r[0]}</span><strong>${r[1]}</strong></div>`).join(''));

    setText('metricList', rows([
      ['Moment of inertia J', J.toFixed(5) + ' kg.m2'],
      ['Natural freq wn', wn.toFixed(2) + ' rad/s'],
      ['Damping ratio z', zeta.toFixed(3)],
      ['Overshoot Mp', os.toFixed(2) + ' %'],
      ['Rise time tr', isFinite(tr) ? tr.toFixed(3) + ' s' : '--'],
      ['Settling ts (2%)', isFinite(ts) ? ts.toFixed(3) + ' s' : '--']
    ]));
    setText('probeList', probes([
      ['Peak time tp', isFinite(tp) ? tp.toFixed(3) + ' s' : '--', ''],
      ['Disturbance Td', state.disturbance ? state.Td.toFixed(4) + ' N.m' : 'off', ''],
      ['Steady-state err', essDeg.toFixed(2) + ' deg', state.Ki > 0 ? 'cool' : (essDeg > 2 ? 'warm' : '')],
      ['Integral action', state.Ki > 0 ? 'ON -> e_ss 0' : 'OFF', state.Ki > 0 ? 'cool' : '']
    ]));
    setText('eqA', `wn = sqrt(Kp/J) = sqrt(${state.Kp.toFixed(2)}/${J.toFixed(4)}) = <b>${wn.toFixed(2)}</b> rad/s`);
    setText('eqB', `z = Kd / (2 sqrt(Kp J)) = <b>${zeta.toFixed(3)}</b> &rarr; overshoot <b>${os.toFixed(1)}%</b>, settling <b>${isFinite(ts) ? ts.toFixed(2) : '--'} s</b>`);
    setText('eqC', state.disturbance
      ? `e_ss = Td/Kp = ${state.Td.toFixed(4)}/${state.Kp.toFixed(2)} = <b>${essDeg.toFixed(2)} deg</b>${state.Ki > 0 ? ' &rarr; <b>0</b> with integral' : ''}`
      : `Enable the disturbance torque to expose steady-state error e_ss = Td/Kp.`);

    setCards([
      ['Overshoot Mp', os.toFixed(1) + ' %'],
      ['Settling t_s', isFinite(ts) ? ts.toFixed(2) + ' s' : '--'],
      ['Damping z', zeta.toFixed(2)],
      ['Stability', over ? 'OVER 25%' : 'WITHIN 25%', over ? 'fail' : 'pass']
    ]);

    if (!over && state.disturbance && state.Ki > 0) state.done.pidstep = true;
    setText('checklist', checklist([
      ['Inertia set from the build', true, state.inheritedJ ? 'J inherited from Exp 2' : 'preset airframe'],
      ['Overshoot under 25% target', !over, os.toFixed(1) + '%'],
      ['Disturbance error examined', state.disturbance, state.disturbance ? essDeg.toFixed(2) + ' deg' : ''],
      ['Zero steady-state error (integral)', state.disturbance && state.Ki > 0, state.Ki > 0 ? 'OK' : '']
    ]));
    setMessage(over
      ? `Overshoot ${os.toFixed(1)}% exceeds the 25% comfort limit. Lower Kp or raise Kd.`
      : (state.disturbance && state.Ki === 0
        ? `Proportional control leaves ${essDeg.toFixed(2)}\u00B0 of steady tilt. Add integral gain to null it.`
        : `wn=${wn.toFixed(1)} rad/s, z=${zeta.toFixed(2)}: overshoot ${os.toFixed(1)}%, settling ${isFinite(ts) ? ts.toFixed(2) : '--'} s.`));
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

    if (state.tuning !== 'manual') state.done.ziegler = true;
    setText('checklist', checklist([
      ['Ultimate gain & period found', true, 'Ku=' + zn.Ku.toFixed(1)],
      ['Sustained oscillation reached', nearKu || state.tuning !== 'manual', nearKu ? 'at Ku' : ''],
      ['Classic Z-N gains applied', state.tuning === 'classic', state.tuning === 'classic' ? r.osPct.toFixed(0) + '% OS' : ''],
      ['Refined under 25% (Tyreus-Luyben)', state.tuning === 'tyreus' && r.osPct < 25, state.tuning === 'tyreus' ? r.osPct.toFixed(0) + '% OS' : '']
    ]));
    setMessage(nearKu
      ? `Sustained oscillation: Ku = ${zn.Ku.toFixed(2)}, Pu = ${(zn.Pu * 1000).toFixed(1)} ms. Click Auto-tune to apply the table.`
      : (state.tuning === 'classic'
        ? `Classic Z-N is fast but aggressive: ~${r.osPct.toFixed(0)}% overshoot, zero steady-state error. Switch to Tyreus-Luyben to tame it.`
        : (state.tuning === 'tyreus'
          ? `Tyreus-Luyben: ~${r.osPct.toFixed(0)}% overshoot (under 25%) with zero steady-state error - the robust tune.`
          : `Raise the proportional gain toward Ku to find the stability limit.`)));
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

    if (Math.abs(state.alpha - opt.alpha) < 0.005) state.done.fusion = true;
    setText('checklist', checklist([
      ['IMU model selected', true, im.label.split(' ')[0]],
      ['Drift vs noise trade-off seen', true, ''],
      ['Optimal alpha identified', Math.abs(state.alpha - opt.alpha) < 0.005, 'a=' + opt.alpha.toFixed(2)],
      ['Unbounded pure-gyro drift seen', state.alpha >= 0.999, state.alpha >= 0.999 ? pureGyro.toFixed(0) + ' deg' : '']
    ]));
    setMessage(state.alpha >= 0.999
      ? `Pure gyro integration: the estimate drifts ${pureGyro.toFixed(0)}\u00B0 in 30 s and never recovers.`
      : (Math.abs(state.alpha - opt.alpha) < 0.005
        ? `Optimal blend: alpha=${opt.alpha.toFixed(2)} minimises total error at ${opt.total.toFixed(2)}\u00B0.`
        : `alpha=${state.alpha.toFixed(2)}: tau=${tau.toFixed(2)}s, drift ${drift.toFixed(2)}\u00B0, noise ${noise.toFixed(2)}\u00B0. Optimum is ${opt.alpha.toFixed(2)}.`));
  }

  function checklist(items) {
    return items.map((it) => {
      const done = it[1], warn = it[3];
      const cls = done ? 'done' : (warn ? 'warn' : 'pending');
      const mark = done ? '\u2713' : (warn ? '!' : '');
      return `<div class="checklist-item"><span class="chk-icon ${cls}">${mark}</span><span class="checklist-label">${esc(it[0])}</span><span class="checklist-val">${esc(it[2] || '')}</span></div>`;
    }).join('');
  }
  function setMessage(t) { setText('labMessage', t); }

  // ── module completion gate (replaces the old "log >= N readings" worksheet) ──
  // Module 1 unlocks Module 2 once both inner stages are explored: a tune that
  // holds overshoot in target while nulling the disturbance (pidstep) and a
  // Ziegler–Nichols auto-tune applied (ziegler). The flags latch in state.done.
  function syncProceed() {
    const btn = $('btnNextModule');
    if (!btn) return;                       // Module 2 page has no proceed gate
    const unlocked = state.done.pidstep && state.done.ziegler;
    btn.classList.toggle('is-locked', !unlocked);
    btn.setAttribute('aria-disabled', unlocked ? 'false' : 'true');
    btn.textContent = unlocked
      ? 'Continue to Module 2 \u00B7 Sensor Fusion \u2192'
      : 'Complete the objectives to continue \u2192';
    const hint = $('nextHint');
    if (hint) hint.style.display = unlocked ? 'none' : 'block';
  }

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
    const trueAng = 15 * Math.sin(2 * Math.PI * 0.2 * f.t);
    const trueRate = 15 * 2 * Math.PI * 0.2 * Math.cos(2 * Math.PI * 0.2 * f.t);
    const measRate = trueRate + im.gyro_bias_dps;                       // gyro: true + constant bias
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

  // dark X-frame quad with accent props, a nose marker, and landing gear
  function buildQuad() {
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

    let controls = null;
    if (THREE.OrbitControls) {
      controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true; controls.dampingFactor = 0.08;
      controls.minDistance = 1.0; controls.maxDistance = 4.6;
      controls.maxPolarAngle = Math.PI * 0.52; controls.enablePan = false;
      controls.target.set(0, 0.02, 0); controls.update();
    }

    viz = { canvas: canvas, scene: scene, camera: camera, renderer: renderer, controls: controls, quad: built.quad, props: built.props, targetRef: targetRef, spinPhase: 0 };
  }
  // ── attitude extraction (same physics as the response chart) ──────────────
  // Live roll angle, its target, and the tracking error in degrees, per mode.
  function computeAttitude() {
    let rollDeg = 0, setp = 0;
    if (state.mode === 'fusion') {
      rollDeg = state.fuse.fused;
      setp = state.fuse.hist.length ? state.fuse.hist[state.fuse.hist.length - 1].tru : 0;
    } else if (state.mode === 'pidstep') {
      const J = state.airframe.J_roll_kgm2, wn = Calc.naturalFreq(state.Kp, J), zeta = Calc.dampingRatio(state.Kp, state.Kd, J);
      const SP = state.db.pid.setpoint_deg || 20;
      const T = Math.max(2, 6 * Calc.settlingTime(wn, zeta)); const tt = state.playT % T;
      let y = Calc.secondOrderStep(wn, zeta, tt);
      if (state.disturbance && state.Ki === 0) { const ess = Calc.disturbanceError(state.Td, state.Kp) * Calc.DEG; y = y - (ess / SP) * (1 - Math.exp(-tt * zeta * wn)); }
      rollDeg = SP * y; setp = SP;
    } else { // ziegler: tilt follows the rate-response integral proxy
      const r = state.znResp; const T = (r && r._T) || 0.6; const tt = state.playT % T;
      if (r && r.samples.length) { const idx = Math.min(r.samples.length - 1, Math.floor(tt / T * r.samples.length)); rollDeg = 20 * r.samples[idx].y; }
      setp = 20;
    }
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
  }

  // ── 3-D viewport update — drives the quad's bank from the controlled roll ──
  function updateScene3D(dt) {
    const att = computeAttitude();
    updateAttitudeOverlay(att);
    if (!viz) return;                                  // tests / no-WebGL: overlay only

    const d = (typeof dt === 'number' && isFinite(dt)) ? Math.min(0.05, Math.max(0, dt)) : 0.016;
    const ease = 1 - Math.exp(-d * 9);

    // ease the airframe toward the commanded bank (roll about the heading axis, +Z)
    const targetRoll = -att.rollDeg * Math.PI / 180;
    viz.quad.rotation.z += (targetRoll - viz.quad.rotation.z) * ease;

    // gentle altitude bob so the model feels alive
    viz.quad.position.y = 0.02 + Math.sin((state.phase || 0) * 1.6) * 0.012;

    // tilt the translucent reference ring to the target attitude
    viz.targetRef.rotation.z += ((-att.setp * Math.PI / 180) - viz.targetRef.rotation.z) * ease;

    // spin the props; harder correction -> faster spin (counter-rotating pairs)
    const effort = Math.min(1, Math.abs(att.err) / 15);
    const rate = (10 + effort * 40) * d;
    viz.spinPhase += rate;
    viz.props.forEach((p) => { p.rotation.y += rate * (p.userData.spin || 1); });

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
    else drawPidScope(ctx, w, h);
  }

  function drawPidScope(ctx, w, h) {
    const J = state.airframe.J_roll_kgm2, wn = Calc.naturalFreq(state.Kp, J), zeta = Calc.dampingRatio(state.Kp, state.Kd, J);
    const T = Math.max(2, 6 * Calc.settlingTime(wn, zeta));
    const top = h * 0.12, bot = h * 0.9, base = bot, ymax = 1.5;
    const yOf = (v) => base - (bot - top) * (v / ymax);
    // setpoint + 2% band
    ctx.strokeStyle = 'rgba(16,185,129,0.7)'; ctx.setLineDash([5, 4]); line(ctx, 0, yOf(1), w, yOf(1)); ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(148,163,184,0.25)'; line(ctx, 0, yOf(1.02), w, yOf(1.02)); line(ctx, 0, yOf(0.98), w, yOf(0.98));
    // response curve
    ctx.strokeStyle = '#ffbf00'; ctx.lineWidth = Math.max(2, w * 0.003); ctx.beginPath();
    for (let px = 0; px <= w; px++) { const t = px / w * T; const y = Calc.secondOrderStep(wn, zeta, t); if (px === 0) ctx.moveTo(px, yOf(y)); else ctx.lineTo(px, yOf(y)); }
    ctx.stroke();
    // playhead
    const phx = (state.playT % T) / T * w;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; line(ctx, phx, top, phx, bot);
    scopeText(ctx, w, h, `Kp=${state.Kp.toFixed(2)} Ki=${state.Ki.toFixed(2)} Kd=${state.Kd.toFixed(3)}  |  overshoot ${Calc.overshootPct(zeta).toFixed(1)}%  settling ${Calc.settlingTime(wn, zeta).toFixed(2)}s`);
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
    const phx = (state.playT % T) / T * w;
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; line(ctx, phx, top, phx, bot);
    scopeText(ctx, w, h, `${state.tuning === 'manual' ? 'P-only sweep' : state.tuning}  |  overshoot ${resp.osPct.toFixed(0)}%  settling ${resp.settlingTime.toFixed(3)}s  e_ss ${Math.abs(resp.essPct) < 0.5 ? '0' : resp.essPct.toFixed(0)}%`);
  }

  function drawFusionScope(ctx, w, h) {
    const f = state.fuse; if (f.hist.length < 2) return;
    const top = h * 0.08, bot = h * 0.92, mid = (top + bot) / 2, span = 26; // +/-26 deg
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
