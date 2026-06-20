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

  function airDensity(h_m) {
    const h = Math.max(0, Math.min(11000, h_m));
    return 1.225 * Math.pow(1.0 - 2.25577e-5 * h, 4.25588);
  }

  function airfoilCl(alpha_deg, airfoil) {
    const a0     = airfoil.alpha_0_deg;
    const aStall = airfoil.stall_angle_deg;
    const clMax  = airfoil.cl_max;
    const aStallNeg = a0 - (aStall - a0);          // symmetric negative stall angle
    const span   = (aStall - a0);                  // attached half-range (deg)

    if (alpha_deg > aStall) {
      const dd = alpha_deg - aStall;               // degrees past positive stall
      return clMax * Math.max(0.70, 1 - 0.035 * dd);
    } else if (alpha_deg < aStallNeg) {
      const dn = aStallNeg - alpha_deg;            // degrees past negative stall
      return -clMax * Math.max(0.70, 1 - 0.035 * dn);
    }
    // Attached region — sine lift curve: near-physical (~2π/rad) slope at the zero-lift
    // angle while reaching cl_max EXACTLY at the stall angle (so the stall flag aligns
    // with the true lift peak). t = -1 at negative stall, +1 at positive stall.
    const t = span > 1e-6 ? (alpha_deg - a0) / span : 0;
    return clMax * Math.sin((Math.PI / 2) * t);
  }

  function airfoilCd(cl, alpha_deg, airfoil) {
    const cd_polar = airfoil.cd0 + K_PROFILE * cl * cl;   // 2-D profile drag bucket
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
      var v_i = 2.0;
      var Vrel, phi, alpha_deg, cl, cd, F, sinPhi;

      for (var iter = 0; iter < BEMT_MAX_ITER; iter++) {
        var U_a = V_mps + v_i;
        Vrel = Math.sqrt(U_t * U_t + U_a * U_a);
        if (Vrel < 1e-6) break;
        phi = Math.atan2(U_a, U_t);
        sinPhi = Math.sin(phi);
        alpha_deg = (st.theta_rad - phi) / DEG_TO_RAD;
        cl = airfoilCl(alpha_deg, airfoil);
        cd = airfoilCd(cl, alpha_deg, airfoil);

        var f_exp = Math.max(0, (propDef.N / 2) * (1 - st.r_frac) / (st.r_frac * Math.abs(sinPhi) + 1e-9));
        F = (2 / Math.PI) * Math.acos(Math.min(1.0, Math.exp(-f_exp)));

        var dT_BET = 0.5 * rho * Vrel * Vrel * propDef.N * st.chord_m * (cl * Math.cos(phi) - cd * sinPhi);
        var K = 4 * Math.PI * st.r_m * rho * Math.max(F, 1e-3);
        var v_new;
        if (V_mps < 0.05) {
          v_new = Math.sqrt(Math.max(0, dT_BET) / Math.max(K, 1e-9));          // hover
        } else {
          var disc = (K * V_mps) * (K * V_mps) + 4 * K * Math.max(0, dT_BET);  // climb
          v_new = (-K * V_mps + Math.sqrt(Math.max(0, disc))) / (2 * K);
        }
        v_new = Math.max(0, Math.min(60, v_new));
        if (Math.abs(v_new - v_i) < BEMT_TOL) { v_i = v_new; break; }
        v_i = 0.5 * v_i + 0.5 * v_new;     // under-relax
      }

      var U_a_f = V_mps + v_i;
      Vrel = Math.sqrt(U_t * U_t + U_a_f * U_a_f);
      phi   = Math.atan2(U_a_f, U_t);
      alpha_deg = (st.theta_rad - phi) / DEG_TO_RAD;
      cl = airfoilCl(alpha_deg, airfoil);
      cd = airfoilCd(cl, alpha_deg, airfoil);
      var Re_i = rho * Vrel * st.chord_m / MU_AIR;

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
    airfoilCl: airfoilCl,
    airfoilCd: airfoilCd,
    liftToDrag: liftToDrag,
    buildPropDef: buildPropDef,
    runBEMT: runBEMT,
    // ── Module 2 additions ──
    dynamicPressure: dynamicPressure,
    dragForce: dragForce,
    reynoldsLength: reynoldsLength,
    efficiencySweep: efficiencySweep,
    peakEfficiency: peakEfficiency,
    findTrimSpeed: findTrimSpeed,
    trimPitch: trimPitch
  });
})();
window.Calc = Calc;

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

function initBase3DScene(canvas, wrapper, options) {
  const scn = new THREE.Scene();
  scn.background = new THREE.Color(options.bgColor || 0xf3f4f6);
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
  sun.position.set(options.sunPos ? options.sunPos.x : 1.5, options.sunPos ? options.sunPos.y : 3.0, options.sunPos ? options.sunPos.z : 1.5);
  if (options.enableShadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.bias = options.sunBias !== undefined ? options.sunBias : -0.0001;
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
  var SCROLL_SCALE = 0.15;  // Module 2: cruise-scroll visual scale so motion reads naturally

  function setAuxTick(fn) { _auxTick = (typeof fn === 'function') ? fn : null; }
  function setCruiseSpeed(V) { _cruiseV = (isFinite(V) && V > 0) ? V : 0; }

  function init() {
    var canvas  = document.getElementById('mainCanvas');
    var wrapper = document.getElementById('canvasWrapper');
    if (!canvas || !wrapper) return;

    _base = initBase3DScene(canvas, wrapper, {
      bgColor: 0xcbd2db,
      fov: 45,
      enableShadows: true,
      ambientIntensity: 0.60,
      sunIntensity: 1.0,
      sunPos: { x: 1.5, y: 3.0, z: 1.5 },
      camPos: { x: 0.0, y: 0.12, z: 0.35 },
      ctrls: {
        minDist: 0.05,
        maxDist: 3.0,
        maxPolar: Math.PI * 0.88,
        target: { x: 0, y: 0, z: 0 }
      }
    });

    var rimLight = new THREE.DirectionalLight(0xdbeafe, 0.45);
    rimLight.position.set(-1.5, 1.0, -1.5);
    _base.scn.add(rimLight);

    var hemi = new THREE.HemisphereLight(0xdbeafe, 0xe5e7eb, 0.3);
    _base.scn.add(hemi);

    // ── Light-green, 75% transparent ground plane + grid (lab test-stand floor) ──
    var groundMat = new THREE.MeshStandardMaterial({
      color: 0x86efac, roughness: 0.95, metalness: 0.0,
      transparent: true, opacity: 0.25, side: THREE.DoubleSide
    });
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.30;
    ground.receiveShadow = true;
    _base.scn.add(ground);

    var grid = new THREE.GridHelper(4, 40, 0x22c55e, 0x4ade80);
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
      // Module 2: cruise-scroll the ground grid on Tab 2 so the floor streams past the
      // centred drone (recycle by one cell size). Inert on Tab 1 / Module 1 (_cruiseV === 0).
      if (_grid && _cruiseV > 0 && _activeTab === 2) {
        var cell = 4 / 40;                             // GridHelper(4, 40) → 0.1 units/cell
        _grid.position.z = (_grid.position.z + _cruiseV * dt * SCROLL_SCALE) % cell;
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
    setCruiseSpeed: setCruiseSpeed
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
    if (!_running) {
      _idleAngle = 0;
      if (_propGrp) _propGrp.rotation.y = 0;
    }
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
  let _blurDscs = [];
  let _rotRPM = 0;

  // ── Module 2: student-designed propeller (serialized propDef from Module 1) ──
  // When set (via setDesignedProp), updateFromSelections lofts THIS design onto the inherited
  // motors instead of the catalog 2-blade fallback. VLAB2 calls setDesignedProp with the
  // inherited/designed propDef BEFORE updateFromSelections. null ⇒ byte-for-byte the original
  // catalog blade, so Module 1 (which uses PropModel, never DroneModel) is unaffected.
  var _designedProp = null;
  function setDesignedProp(pd) { _designedProp = (pd && pd.D_m) ? pd : null; }

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
        const bellR = (motor.bell_diameter_mm / 2) / 1000;
        const bellH = motor.bell_height_mm / 1000;
        const motorY = tipPos.y + 0.0015;

        const bellGeo = new THREE.CylinderGeometry(bellR, bellR * 0.85, bellH, 16);
        const bellMat = createMat(0x1f2937, 0.3, 0.7);
        const bellMesh = new THREE.Mesh(bellGeo, bellMat);
        bellMesh.position.copy(tipPos);
        bellMesh.position.y = motorY + bellH / 2;
        bellMesh.castShadow = true;
        _droneGrp.add(bellMesh);

        const shaftGeo = new THREE.CylinderGeometry(0.0015, 0.0015, bellH * 1.5, 8);
        const shaftMat = createMat(0xe2e8f0, 0.15, 0.95);
        const shaftMesh = new THREE.Mesh(shaftGeo, shaftMat);
        shaftMesh.position.copy(tipPos);
        shaftMesh.position.y = motorY + bellH * 0.75;
        _droneGrp.add(shaftMesh);

        const cClipGeo = new THREE.TorusGeometry(0.002, 0.0006, 4, 8);
        const cClipMesh = new THREE.Mesh(cClipGeo, shaftMat);
        cClipMesh.position.copy(tipPos);
        cClipMesh.position.y = motorY + bellH + 0.001;
        cClipMesh.rotation.x = Math.PI / 2;
        _droneGrp.add(cClipMesh);

        const numHoles = 4;
        const holeGeo = new THREE.CylinderGeometry(bellR * 0.2, bellR * 0.2, 0.0006, 8);
        const holeMat = createMat(0x0f172a, 0.9, 0.0);
        for (let h = 0; h < numHoles; h++) {
          const angle = (h / numHoles) * Math.PI * 2;
          const holeMesh = new THREE.Mesh(holeGeo, holeMat);
          holeMesh.position.set(tipPos.x + Math.cos(angle) * (bellR * 0.5), motorY + bellH + 0.0002, tipPos.z + Math.sin(angle) * (bellR * 0.5));
          _droneGrp.add(holeMesh);
        }

        const numCoils = 12;
        const coilGeo = new THREE.CylinderGeometry(bellR * 0.12, bellR * 0.12, bellH * 0.5, 6);
        const coilMat = createMat(0xb45309, 0.2, 0.8);
        for (let c = 0; c < numCoils; c++) {
          const angle = (c / numCoils) * Math.PI * 2;
          const coilMesh = new THREE.Mesh(coilGeo, coilMat);
          coilMesh.position.set(tipPos.x + Math.cos(angle) * (bellR * 0.52), motorY + bellH * 0.25, tipPos.z + Math.sin(angle) * (bellR * 0.52));
          _droneGrp.add(coilMesh);
        }

        const statorCore = new THREE.Mesh(
          new THREE.CylinderGeometry(bellR * 0.4, bellR * 0.4, bellH * 0.55, 8),
          createMat(0x475569, 0.5, 0.8)
        );
        statorCore.position.copy(tipPos);
        statorCore.position.y = motorY + bellH * 0.25;
        _droneGrp.add(statorCore);

        if (prop) {
          const propR = prop.diameter_m / 2;
          const propChord = 0.016 + prop.diameter_m * 0.04;
          const hubH = 0.012;
          const propY = motorY + bellH + hubH / 2;

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
    if (!_propGrps.length) return;
    const omega = (_rotRPM * 2.0 * Math.PI) / 60.0;

    _propGrps.forEach(function (pg, i) {
      const activeTab = window.Scene ? window.Scene.getActiveTab() : 1;
      const sign = activeTab === 1 ? 1 : _propSigns[i];
      pg.rotation.y += sign * omega * delta;
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
  }

  // Module 2: apply the forward-flight nose-down body pitch by rotating the whole drone group
  // about the transverse (X) axis. Clamp to 0–35°; ROTATION ONLY — the centred y≈0.02 framing
  // is preserved (no translation). On Tab 1 the caller resets this to 0 (stationary drone).
  function setPitch(angleRad) {
    if (!_droneGrp) return;
    var a = isFinite(angleRad) ? Math.max(0, Math.min(angleRad, 35 * Math.PI / 180)) : 0;
    _droneGrp.rotation.x = -a;   // nose-down
  }

  return {
    updateFromSelections: updateFromSelections,
    clearAll: clearAll,
    animateProps: animateProps,
    setSimRPM: setSimRPM,
    getDroneGroup: function () { return _droneGrp; },
    setDesignedProp: setDesignedProp,
    setPitch: setPitch
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

  // Resize the frontal-area panel in place so its visible face is √A × √A (W×H = A).
  // PlaneGeometry's face spans LOCAL X,Y (its normal is local Z). After rotation.y = π/2
  // the local Z normal points along the flow (+X); local X→world Z and local Y→world Y,
  // so scaling local X and Y by √A yields a √A(Z) × √A(Y) square standing normal to the
  // flow. (Scaling local Z would only stretch the zero-thickness normal — no visible effect,
  // which is why the literal (1,√A,√A) tuple cannot produce a √A square here.)
  function _applyPlaneSize() {
    if (!_plane) return;
    var s = Math.sqrt((isFinite(_area) && _area > 0) ? _area : 0.0152);
    _plane.scale.set(s, s, 1);
  }

  // Map air density ρ → mist visibility: denser/whiter near sea level, sparse/faint at
  // altitude. Drives both PointsMaterial opacity and the visible particle draw-count.
  function _applyDensity() {
    if (!_flow) return;
    var f = Math.max(0, Math.min(1, (_rho - 0.85) / (1.225 - 0.85)));
    _flow.material.opacity = 0.25 + 0.45 * f;
    var n = Math.max(1, Math.round(_data.length * (0.35 + 0.65 * f)));
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
    var N     = 220;

    var positions = new Float32Array(N * 3);
    for (var i = 0; i < N; i++) {
      var x = _xMin + Math.random() * (_xMax - _xMin);
      var y = _yCtr + (Math.random() * 2 - 1) * _footHalf;
      var z = (Math.random() * 2 - 1) * _footHalf;
      positions[i * 3]     = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      _data.push({ y0: y, z0: z, phase: Math.random() * Math.PI * 2 });
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    var mat = new THREE.PointsMaterial({
      color: 0x0ea5e9,
      size: 0.008,
      transparent: true,
      opacity: 0.6,
      depthWrite: false
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
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    _plane = new THREE.Mesh(planeGeo, planeMat);
    // edge outline so the panel reads as a framed plane (child → inherits scale + rotation)
    var edgeMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.55 });
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

    var pos = _flow.geometry.attributes.position;
    var arr = pos.array;
    var v   = Math.min(Math.max(_speed * 0.04, 0), 1.4);   // units/s
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

      arr[ix + 1] = ny + Math.sin(_data[i].phase) * 0.004;   // + subtle bob
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
  }

  function setRunning(b) {
    _running = !!b;
    if (_flow)  _flow.visible  = _running && _speed > 0.05;
    if (_plane) _plane.visible = _running;
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
  // Tab switching — toggle tab buttons + show/hide section groups.
  // Charts for the now-hidden tab are destroyed; the caller's
  // _computeAndRender() recreates the visible tab's charts with live data.
  // ─────────────────────────────────────────────────────────────────
  function switchTab(n) {
    var isTab1 = (n === 1);

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
        borderColor: '#f59e0b',
        borderWidth: 2,
        borderDash: [4, 4],
        label: { content: 'V = ' + cv.toFixed(1) + ' m/s', display: true, position: 'start', color: '#f59e0b', font: { size: 9 } }
      }
    };
    if (_num(dCur)) {
      annotations.vPoint = {
        type: 'point',
        xValue: cv, yValue: dCur,
        radius: 4,
        backgroundColor: '#f59e0b',
        borderColor: '#ffffff',
        borderWidth: 1
      };
    }

    _dragSpeedChart = new Chart(canvas, {
      type: 'line',
      data: {
        datasets: [{
          label: 'Parasite Drag D (N)',
          data: pts,
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,0.08)',
          borderWidth: 2,
          pointRadius: 0,
          fill: true,
          tension: 0.2
        }]
      },
      options: {
        plugins: {
          legend: { display: false },
          annotation: { annotations: annotations }
        },
        scales: {
          x: { type: 'linear', min: 0, max: vMax, title: { display: true, text: 'Forward Speed V (m/s)', font: { size: 9 } }, grid: { color: '#f3f4f6' } },
          y: { min: 0, title: { display: true, text: 'Parasite Drag D (N)', font: { size: 9 } }, grid: { color: '#f3f4f6' } }
        }
      }
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
        radius: 6,
        pointStyle: 'star',
        backgroundColor: '#f59e0b',
        borderColor: '#b45309',
        borderWidth: 2
      };
      annotations.peakLabel = {
        type: 'label',
        xValue: peak.J, yValue: peak.eta,
        content: ['\u03B7_max ' + peak.eta.toFixed(1) + '%'],
        yAdjust: -14,
        color: '#b45309',
        font: { size: 9, weight: 'bold' },
        backgroundColor: 'rgba(255,255,255,0.75)'
      };
    }

    _etaJChart = new Chart(canvas, {
      type: 'line',
      data: {
        datasets: [{
          label: 'Propulsive Efficiency \u03B7 (%)',
          data: pts,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16,185,129,0.08)',
          borderWidth: 2,
          pointRadius: 0,
          fill: true,
          tension: 0.3
        }]
      },
      options: {
        plugins: {
          legend: { display: false },
          annotation: { annotations: annotations }
        },
        scales: {
          x: { type: 'linear', min: 0, title: { display: true, text: 'Advance Ratio J', font: { size: 9 } }, grid: { color: '#f3f4f6' } },
          y: { min: 0, max: 100, title: { display: true, text: 'Propulsive Efficiency \u03B7 (%)', font: { size: 9 } }, grid: { color: '#f3f4f6' } }
        }
      }
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
        borderColor: '#16a34a',
        borderWidth: 2,
        borderDash: [5, 4],
        label: { content: 'V_trim ' + trim.Vtrim.toFixed(2) + ' m/s', display: true, position: 'start', color: '#16a34a', font: { size: 9 } }
      };
    }

    _thrustPowerChart = new Chart(canvas, {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Thrust T (N)',
            data: tData,
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59,130,246,0.08)',
            borderWidth: 2,
            pointRadius: 0,
            yAxisID: 'yT',
            fill: false,
            tension: 0.2
          },
          {
            label: 'Shaft Power P (W)',
            data: pData,
            borderColor: '#f97316',
            backgroundColor: 'rgba(249,115,22,0.08)',
            borderWidth: 2,
            pointRadius: 0,
            yAxisID: 'yP',
            fill: false,
            tension: 0.2
          }
        ]
      },
      options: {
        plugins: {
          legend: { position: 'top', labels: { font: { size: 9 } } },
          annotation: { annotations: annotations }
        },
        scales: {
          x:  { type: 'linear', min: 0, title: { display: true, text: 'Forward Speed V (m/s)', font: { size: 9 } }, grid: { color: '#f3f4f6' } },
          yT: { type: 'linear', position: 'left',  title: { display: true, text: 'Thrust T (N)', font: { size: 9 } }, grid: { color: '#f3f4f6' } },
          yP: { type: 'linear', position: 'right', title: { display: true, text: 'Shaft Power P (W)', font: { size: 9 } }, grid: { drawOnChartArea: false } }
        }
      }
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
        datasets: [{
          label: 'Advance Ratio J',
          data: pts,
          borderColor: '#8b5cf6',
          backgroundColor: 'rgba(139,92,246,0.08)',
          borderWidth: 2,
          pointRadius: 0,
          fill: true,
          tension: 0.3
        }]
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          x: { type: 'linear', min: 0, title: { display: true, text: 'Forward Speed V (m/s)', font: { size: 9 } }, grid: { color: '#f3f4f6' } },
          y: { min: 0, title: { display: true, text: 'Advance Ratio J', font: { size: 9 } }, grid: { color: '#f3f4f6' } }
        }
      }
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
          {
            label: 'Thrust Coeff Ct',
            data: ctData,
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59,130,246,0.08)',
            borderWidth: 2,
            pointRadius: 0,
            yAxisID: 'yCt',
            fill: false,
            tension: 0.2
          },
          {
            label: 'Torque Coeff Cq',
            data: cqData,
            borderColor: '#f97316',
            backgroundColor: 'rgba(249,115,22,0.08)',
            borderWidth: 2,
            pointRadius: 0,
            yAxisID: 'yCq',
            fill: false,
            tension: 0.2
          }
        ]
      },
      options: {
        plugins: {
          legend: { position: 'top', labels: { font: { size: 9 } } }
        },
        scales: {
          x:   { type: 'linear', min: 0, title: { display: true, text: 'Advance Ratio J', font: { size: 9 } }, grid: { color: '#f3f4f6' } },
          yCt: { type: 'linear', position: 'left',  title: { display: true, text: 'Ct', font: { size: 9 } }, grid: { color: '#f3f4f6' } },
          yCq: { type: 'linear', position: 'right', title: { display: true, text: 'Cq', font: { size: 9 } }, grid: { drawOnChartArea: false } }
        }
      }
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
        borderColor: '#16a34a',
        borderWidth: 2,
        borderDash: [5, 4],
        label: { content: 'V_trim ' + trim.Vtrim.toFixed(2) + ' m/s', display: true, position: 'start', color: '#16a34a', font: { size: 9 } }
      };
    }

    _dragThrustChart = new Chart(canvas, {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Available Thrust 4\u00B7T (N)',
            data: thrustData,
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59,130,246,0.08)',
            borderWidth: 2,
            pointRadius: 0,
            fill: false,
            tension: 0.2
          },
          {
            label: 'Frame Drag D (N)',
            data: dragData,
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239,68,68,0.08)',
            borderWidth: 2,
            pointRadius: 0,
            fill: false,
            tension: 0.2
          }
        ]
      },
      options: {
        plugins: {
          legend: { position: 'top', labels: { font: { size: 9 } } },
          annotation: { annotations: annotations }
        },
        scales: {
          x: { type: 'linear', min: 0, title: { display: true, text: 'Forward Speed V (m/s)', font: { size: 9 } }, grid: { color: '#f3f4f6' } },
          y: { min: 0, title: { display: true, text: 'Force (N)', font: { size: 9 } }, grid: { color: '#f3f4f6' } }
        }
      }
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

  // ── Tab 1 — animated side-view frame-flow diagram (#frameFlowDiagram) ──
  var _dragState = null, _dragPhase = 0, _dragLast = 0, _dragRAF = null;
  var _DRAG_VMAX = 30;   // Tab 1 forward-speed scale (m/s)

  // Public entry: store latest state, ensure the single RAF loop is running.
  function drawDragDiagram(rho, V, Cd, A, D, q, CdA, Re) {
    _dragState = { rho: rho, V: V, Cd: Cd, A: A, D: D, q: q, CdA: CdA, Re: Re };
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
    var V   = _num(st.V)   ? Math.max(0, st.V)   : 0;
    var rho = _num(st.rho) ? st.rho : 1.225;
    var D   = _num(st.D)   ? st.D   : 0;

    // light background, repainted every frame
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#f8fafc'; ctx.fillRect(0, 0, W, H);

    // normalised visual cues
    var vN   = Math.max(0, Math.min(1, V / _DRAG_VMAX));
    var rhoN = Math.max(0, Math.min(1, (rho - 0.85) / (1.30 - 0.85)));  // sea-level dense → high-alt sparse
    var nLines = 7 + Math.round(rhoN * 2);                              // 7..9 streamlines (count ∝ ρ)
    var baseAlpha = 0.30 + rhoN * 0.50;                                 // denser air → bolder lines (opacity ∝ ρ)

    // airframe silhouette (side view): rounded body + stub arm + landing legs
    var cx = W * 0.50, cy = H * 0.54;
    var bodyW = Math.min(96, W * 0.26), bodyH = Math.min(40, H * 0.24);
    var bx = cx - bodyW / 2, by = cy - bodyH / 2, r = Math.min(10, bodyH / 2);

    // streamlines (drawn first, behind the body); scroll speed ∝ V (still at V≈0)
    var dash = 9, gap = 7, period = dash + gap;
    var scroll = (phase * (V * 14)) % period;
    var sigma  = bodyH * 0.9;
    for (var li = 0; li < nLines; li++) {
      var y0 = 12 + li * (H - 24) / (nLines - 1);
      var above = y0 <= cy;
      var dy0 = y0 - cy;
      var near = Math.exp(-(dy0 * dy0) / (2 * sigma * sigma));   // lines near the body deflect most
      var ampMax = (3 + vN * 22) * near;                         // deflection amplitude grows with V
      ctx.strokeStyle = 'rgba(14,165,233,' + baseAlpha.toFixed(3) + ')';
      ctx.lineWidth = 1.3;
      ctx.setLineDash([dash, gap]);
      ctx.lineDashOffset = -scroll;
      ctx.beginPath();
      var started = false;
      for (var x = 0; x <= W; x += 4) {
        var d = (x - cx) / (bodyW * 0.85);
        var bump = Math.exp(-d * d);                             // bulge around the body
        var y = y0 + (above ? -ampMax : ampMax) * bump;
        if (x > cx + bodyW * 0.35) {                             // wavy turbulent wake downstream
          var tw = Math.min(1, (x - (cx + bodyW * 0.35)) / (W * 0.4));
          y += Math.sin(x * 0.30 - phase * (4 + V * 0.5) + li) * (vN * 9) * tw * near;
        }
        if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
      }
      ctx.stroke();
    }
    ctx.setLineDash([]); ctx.lineDashOffset = 0;

    // landing legs + motor stub arm (drawn under/around the body)
    var legLen = Math.min(18, H * 0.16), armUp = Math.min(10, H * 0.10);
    ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - bodyW * 0.30, by + bodyH); ctx.lineTo(cx - bodyW * 0.42, by + bodyH + legLen);
    ctx.moveTo(cx + bodyW * 0.30, by + bodyH); ctx.lineTo(cx + bodyW * 0.42, by + bodyH + legLen);
    ctx.stroke();
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx + bodyW * 0.20, by); ctx.lineTo(cx + bodyW * 0.62, by - armUp);
    ctx.stroke();

    // rounded body box
    ctx.beginPath();
    ctx.moveTo(bx + r, by);
    ctx.arcTo(bx + bodyW, by,          bx + bodyW, by + bodyH, r);
    ctx.arcTo(bx + bodyW, by + bodyH,  bx,         by + bodyH, r);
    ctx.arcTo(bx,         by + bodyH,  bx,         by,         r);
    ctx.arcTo(bx,         by,          bx + bodyW, by,         r);
    ctx.closePath();
    ctx.fillStyle = 'rgba(37,99,235,0.92)'; ctx.fill();
    ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 1; ctx.stroke();

    // blue flow arrow on the left (length ∝ V); hidden when air is still
    var flowLen = vN * 84;
    if (flowLen > 3) {
      _arrow2(ctx, 8, cy, 8 + flowLen, cy, '#0ea5e9', 2.2);
      ctx.fillStyle = '#0369a1'; ctx.font = '10px JetBrains Mono';
      ctx.fillText('V', 12, cy - 6);
    }

    // red drag arrow on the body (length ∝ D, clamped), pointing downstream (+x)
    var dragLen = Math.max(0, Math.min(70, D * 6));
    if (dragLen > 2) {
      _arrow2(ctx, cx, cy, cx + dragLen, cy, '#dc2626', 2.4);
      ctx.fillStyle = '#dc2626'; ctx.font = '10px JetBrains Mono';
      ctx.fillText('Drag', cx + dragLen + 2, cy - 6);
    }

    // title + corner readouts (mono; non-finite → em dash)
    ctx.fillStyle = '#111827'; ctx.font = 'bold 11px Inter';
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
    rpm: 5000,
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

    fetch('db/db.json')
      .then(function (r) { return r.json(); })
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
      battery:           _byId(db.batteries, '4s_2200'),
      esc:               _byId(db.escs, 'esc_4in1_30a'),
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
        var CdA = state.cd * state.area_m2;
        var Re  = Calc.reynoldsLength(state.rho, state.V_mps, state.refLength_m);
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
        state.framePreset = f;
        state.area_m2     = f.frontal_area_m2;
        state.refLength_m = f.wheelbase_mm / 1000;
        if (state.sel) state.sel.frame = f;          // visual drone uses the same frame
        _syncFrameSliders();
        DroneModel.updateFromSelections(state.sel);  // rebuild the full procedural drone
        AeroFlow.build(state.area_m2);
        _computeAndRender();
      }
    });
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

    // RPM (Tab 2)
    var rpmSlider = document.getElementById('rpmSlider');
    if (rpmSlider) {
      rpmSlider.addEventListener('input', function () {
        state.rpm = parseInt(this.value, 10);
        state.rpmChanged = (state.rpm !== 5000);
        var v = document.getElementById('rpmVal');
        if (v) v.textContent = state.rpm;
        _computeAndRender();
        _persistM2();
      });
    }

    // Tab buttons
    document.querySelectorAll('.vp-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _switchTab(parseInt(this.dataset.tab, 10));
      });
    });

    // Explicit "Run Sweep"
    var runBtn = document.getElementById('btnRunSweep');
    if (runBtn) {
      runBtn.addEventListener('click', function () { _computeAndRender(); });
    }

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
    if (n === 2) {
      DroneModel.setSimRPM(state.rpm);   // four props spin at the analysis RPM
      AeroFlow.setMode('flight');         // forward-flight inflow (tilts with the operating point)
    } else {
      DroneModel.setSimRPM(0);            // Tab 1: props stationary
      DroneModel.setPitch(0);             // Tab 1: level attitude
      Scene.setCruiseSpeed(0);            // Tab 1: no world scroll
      AeroFlow.setMode('drag');           // Tab 1: pure oncoming flow
    }
    AeroFlow.setRunning(true);            // airflow active on both tabs
    Scene.setTab(n);
    UI2.switchTab(n);
    _computeAndRender();
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

      // Air helper — speed, density (count/opacity) and frontal-area plane size.
      AeroFlow.setSpeed(state.V_mps);
      AeroFlow.setDensity(state.rho);
      AeroFlow.setFrontalArea(state.area_m2);
      AeroFlow.setRunning(true);

      // Cards + Drag-vs-Speed chart + animated side-view flow diagram + live derivation + area readout.
      UI2.updateFrameCards(q, D, CdA, Re);
      UI2.renderDragSpeedChart(state.rho, state.cd, state.area_m2, state.V_mps, 30);
      UI2.drawDragDiagram(state.rho, state.V_mps, state.cd, state.area_m2, D, q, CdA, Re);
      UI2.renderDragDerivation(state.rho, state.V_mps, state.cd, state.area_m2, state.refLength_m, q, CdA, D, Re);
      UI2.setAreaReadout(state.area_m2);
      UI2.setCommentary(_commentaryTab1(q, D, CdA, Re));
      _checkCompletion();
      _persistM2();
    } else {
      // Tab 2 — automatic forward-speed efficiency sweep
      state.sweep = Calc.efficiencySweep(state.propDef, state.rpm, state.rho, state.Vmax, state.sweepSteps);
      state.peak  = Calc.peakEfficiency(state.sweep);
      state.trim  = Calc.findTrimSpeed(state.sweep, state.rho, state.cd, state.area_m2, 4);

      state.peakObserved = state.peak.eta > 0;
      state.validBemt    = state.sweep.some(function (s) { return s.eta > 0; });

      // Representative operating point: peak sample if found, else mid-sweep.
      var op = state.peak.idx >= 0
        ? state.sweep[state.peak.idx]
        : (state.sweep[Math.floor(state.sweep.length / 2)] || { V: 0, J: 0, eta: 0, T: 0, Q: 0, P: 0, FoM: 0 });

      // §3.5 forward-flight pitch — quasi-static weight-support balance θ = atan(D/W) at the
      // representative speed (peak V if found, else V_trim when finite/ok, else op.V), clamped 0–35°.
      var Vrep = state.peak.idx >= 0
        ? state.peak.V
        : ((state.trim.status === 'ok' && isFinite(state.trim.Vtrim)) ? state.trim.Vtrim : op.V);
      var Drep = Calc.dragForce(state.rho, Vrep, state.cd, state.area_m2);
      state.pitch_rad = Math.min(Calc.trimPitch(Drep, state.weight_N), 35 * Math.PI / 180);
      state.pitch_deg = state.pitch_rad * 180 / Math.PI;

      // 3D — props at the analysis RPM, hold the nose-down pitch, scroll the world past the
      // centred drone, and align the relative-wind inflow with the operating point.
      DroneModel.setSimRPM(state.rpm);
      DroneModel.setPitch(state.pitch_rad);
      Scene.setCruiseSpeed(op.V);
      AeroFlow.setMode('flight');
      AeroFlow.setSpeed(op.V);
      AeroFlow.setDensity(state.rho);
      AeroFlow.setRunning(true);

      // Full Tab 2 chart suite.
      UI2.renderEtaJChart(state.sweep, state.peak);
      UI2.renderThrustPowerChart(state.sweep, state.trim);
      UI2.renderSecondaryChart(state.sweep);
      UI2.renderCtCqChart(state.sweep);
      UI2.renderDragThrustChart(state.sweep, state.rho, state.cd, state.area_m2, state.trim);

      // 2D velocity triangle + cruise derivation (U_t = π·n·D, V_rel, φ = atan2(V, U_t)).
      var n    = state.rpm / 60;
      var D_m  = state.propDef.D_m;
      var Ut   = Math.PI * n * D_m;
      var Vrel = Math.sqrt(op.V * op.V + Ut * Ut);
      var phi  = Math.atan2(op.V, Ut);
      UI2.drawAdvDiagram(op.V, Ut, Vrel, phi, op.J, state.rpm);
      UI2.renderAdvDerivation(state.rpm, n, op.J, op.eta, op.P, state.trim.Vtrim, state.pitch_deg, state.trim.status);

      // Cards + HUD (HUD now carries θ_pitch and the representative V).
      UI2.updateAdvCards(op, state.trim);
      UI2.updateHud(op.J, op.eta, state.rpm, _trimText(), state.pitch_deg, op.V);
      UI2.setCommentary(_commentaryTab2());
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
    state.tab2Done = (state.rpmChanged || state.speedChanged) && state.peakObserved && state.validBemt;  // §3.11
    state.allDone  = state.tab2Done;

    if (state.tab1Done) {
      UI2.setChecklistItem('chkFrameDrag', true,
        'Cd\u00B7A=' + (state.cd * state.area_m2).toFixed(5) + ' m\u00B2, D=' +
        Calc.dragForce(state.rho, state.V_mps, state.cd, state.area_m2).toFixed(3) +
        ' N @ ' + state.V_mps + ' m/s');
    }
    if (state.tab2Done) {
      UI2.setChecklistItem('chkAdvRatio', true,
        '\u03B7_max=' + state.peak.eta.toFixed(1) + '% @ J=' + state.peak.J.toFixed(3));
    }

    UI2.setFinishButtonEnabled(state.allDone);
    if (state.allDone && !_completionFired) {
      _completionFired = true;
      try { localStorage.setItem('vlabExp3M2_complete', 'true'); } catch (e) {}
      _persistM2();   // §6.11 — final vlabExp3M2 snapshot on the rising edge of completion
    }
  }

  // ───────────────────────────────────────────────────────────────
  // §6.11 Commentary helpers (requirements §2.8 / §3.10)
  // ───────────────────────────────────────────────────────────────
  function _commentaryTab1(q, D, CdA, Re) {
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

  var AIRFOIL_COLORS = ['#3b82f6', '#10b981', '#f59e0b'];

  function _el(id) { return document.getElementById(id); }

  function _setText(id, val) {
    var el = _el(id);
    if (el) el.textContent = val;
  }

  function switchTab(n) {
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

    // "Proceed to Module 2" only relevant on Tab 2 (Airfoil Analysis)
    var nextBtn = _el('btnNextModule');
    if (nextBtn) nextBtn.classList.toggle('hidden', n === 1);
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
        datasets: [{
          label: 'Pitch θ (°)',
          data: data,
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,0.08)',
          borderWidth: 2,
          pointRadius: 3,
          fill: true,
          tension: 0.3
        }]
      },
      options: {
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
                borderColor: '#f59e0b',
                borderWidth: 2,
                borderDash: [4, 4],
                label: { content: '75%', display: true, position: 'end', color: '#f59e0b', font: { size: 9 } }
              }
            }
          }
        },
        scales: {
          x: { title: { display: true, text: 'Span Station r/R', font: { size: 9 } }, grid: { color: '#f3f4f6' } },
          y: { title: { display: true, text: 'Pitch Angle θ (°)', font: { size: 9 } }, grid: { color: '#f3f4f6' } }
        }
      }
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
        datasets: [{
          label: 'Chord (mm)',
          data: data,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16,185,129,0.08)',
          borderWidth: 2,
          pointRadius: 3,
          fill: true,
          tension: 0.3
        }]
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          x: { title: { display: true, text: 'Span Station r/R', font: { size: 9 } }, grid: { color: '#f3f4f6' } },
          y: { title: { display: true, text: 'Chord (mm)', font: { size: 9 } }, grid: { color: '#f3f4f6' } }
        }
      }
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
      var data = labels.map(function(lbl) { return Calc.airfoilCl(parseFloat(lbl), af); });
      return {
        label: af.name,
        data: data,
        borderColor: AIRFOIL_COLORS[idx % AIRFOIL_COLORS.length],
        borderWidth: isSelected ? 3 : 1.5,
        pointRadius: 0,
        tension: 0.3,
        fill: false
      };
    });

    _clAlphaChart = new Chart(canvas, {
      type: 'line',
      data: { labels: labels, datasets: datasets },
      options: {
        plugins: {
          legend: { position: 'top', labels: { font: { size: 9 } } }
        },
        scales: {
          x: { title: { display: true, text: 'α (°)', font: { size: 9 } }, grid: { color: '#f3f4f6' } },
          y: {
            title: { display: true, text: 'Cl', font: { size: 9 } },
            min: -1.0, max: 2.0,
            grid: {
              color: function(ctx) {
                if (ctx.tick && Math.abs(ctx.tick.value) < 0.001) return '#94a3b8';
                return '#f3f4f6';
              }
            }
          }
        }
      }
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
      var data = labels.map(function(lbl) {
        var cl = parseFloat(lbl);
        return Calc.airfoilCd(cl, 0, af);
      });
      var ds = {
        label: af.name,
        data: data,
        borderColor: AIRFOIL_COLORS[idx % AIRFOIL_COLORS.length],
        borderWidth: isSelected ? 3 : 1.5,
        pointRadius: 0,
        tension: 0.3,
        fill: false
      };
      if (isSelected) {
        var dotIdx = labels.findIndex(function(l) { return Math.abs(parseFloat(l) - currentCl) < 0.04; });
        if (dotIdx < 0) dotIdx = 0;
        var ptRadii = labels.map(function(_, i) { return i === dotIdx ? 5 : 0; });
        ds.pointRadius = ptRadii;
        ds.pointBackgroundColor = AIRFOIL_COLORS[idx % AIRFOIL_COLORS.length];
      }
      return ds;
    });

    _dragPolarChart = new Chart(canvas, {
      type: 'line',
      data: { labels: labels, datasets: datasets },
      options: {
        plugins: { legend: { position: 'top', labels: { font: { size: 9 } } } },
        scales: {
          x: { title: { display: true, text: 'Cl', font: { size: 9 } }, grid: { color: '#f3f4f6' } },
          y: { title: { display: true, text: 'Cd', font: { size: 9 } }, min: 0, max: 0.12, grid: { color: '#f3f4f6' } }
        }
      }
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
      var ldValues = labels.map(function(lbl) { return Calc.liftToDrag(parseFloat(lbl), af); });
      var ds = {
        label: af.name,
        data: ldValues,
        borderColor: AIRFOIL_COLORS[idx % AIRFOIL_COLORS.length],
        borderWidth: isSelected ? 3 : 1.5,
        pointRadius: 0,
        tension: 0.3,
        fill: false
      };
      if (isSelected) {
        var maxLd = -Infinity, maxIdx = 0;
        ldValues.forEach(function(v, i) { if (v > maxLd) { maxLd = v; maxIdx = i; } });
        var ptRadii = ldValues.map(function(_, i) { return i === maxIdx ? 6 : 0; });
        ds.pointRadius = ptRadii;
        ds.pointStyle = ldValues.map(function(_, i) { return i === maxIdx ? 'star' : 'circle'; });
        ds.pointBackgroundColor = AIRFOIL_COLORS[idx % AIRFOIL_COLORS.length];
      }
      return ds;
    });

    _efficiencyChart = new Chart(canvas, {
      type: 'line',
      data: { labels: labels, datasets: datasets },
      options: {
        plugins: { legend: { position: 'top', labels: { font: { size: 9 } } } },
        scales: {
          x: { title: { display: true, text: 'α (°)', font: { size: 9 } }, grid: { color: '#f3f4f6' } },
          y: { title: { display: true, text: 'L/D', font: { size: 9 } }, min: -20, max: 120, grid: { color: '#f3f4f6' } }
        }
      }
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
          borderWidth: 1
        }]
      },
      options: {
        plugins: {
          legend: { display: false },
          annotation: {
            annotations: {
              stallLine: {
                type: 'line',
                yMin: stallAngle, yMax: stallAngle,
                borderColor: '#ef4444',
                borderWidth: 2,
                borderDash: [4, 4],
                label: { content: 'Stall ' + stallAngle + '°', display: true, position: 'end', color: '#ef4444', font: { size: 9 } }
              }
            }
          }
        },
        scales: {
          x: { title: { display: true, text: 'r/R', font: { size: 9 } }, grid: { color: '#f3f4f6' } },
          y: { title: { display: true, text: 'α local (°)', font: { size: 9 } }, grid: { color: '#f3f4f6' } }
        }
      }
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
          {
            label: 'dT (N)',
            data: elementData.map(function(el) { return el.dT; }),
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59,130,246,0.08)',
            borderWidth: 2,
            pointRadius: 2,
            yAxisID: 'yT',
            fill: false,
            tension: 0.3
          },
          {
            label: 'dQ (N·m)',
            data: elementData.map(function(el) { return el.dQ; }),
            borderColor: '#f97316',
            backgroundColor: 'rgba(249,115,22,0.08)',
            borderWidth: 2,
            pointRadius: 2,
            yAxisID: 'yQ',
            fill: false,
            tension: 0.3
          }
        ]
      },
      options: {
        plugins: { legend: { position: 'top', labels: { font: { size: 9 } } } },
        scales: {
          x:  { title: { display: true, text: 'r/R', font: { size: 9 } }, grid: { color: '#f3f4f6' } },
          yT: { type: 'linear', position: 'left',  title: { display: true, text: 'dT (N)', font: { size: 9 } }, grid: { color: '#f3f4f6' } },
          yQ: { type: 'linear', position: 'right', title: { display: true, text: 'dQ (N·m)', font: { size: 9 } }, grid: { drawOnChartArea: false } }
        }
      }
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
    tab1Done: false,
    tab2Done: false,
    allDone: false
  };

  function init() {
    Scene.init();
    fetch('db/db.json')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        state.db = data;
        _populateTiles();
        _selectDefaults();
        _loadHandoff();
        _bindEvents();
        _computeAndRender();
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

      var cl      = Calc.airfoilCl(state.alpha_deg, state.airfoil);
      var cd      = Calc.airfoilCd(cl, state.alpha_deg, state.airfoil);
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
      if (alphaStalled) state.stallObserved = true;

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

    UI.setChecklistItem('chkPropDesign', designDone,
      designDone ? ('Valid \u2713 N=' + state.N + ', D=' + state.D_in + 'in')
                 : (!propValid ? 'Invalid geometry' : 'Click Run Simulation'));

    var pend = [];
    if (!state.aoaChanged)   pend.push('vary AoA');
    if (!state.rpmChanged)   pend.push('vary RPM');
    if (!state.stallObserved) pend.push('induce stall');
    UI.setChecklistItem('chkAirfoilAnalysis', analysisDone,
      analysisDone ? ('Analysed \u2713 Cl_max=' + state.airfoil.cl_max)
                   : ('To do: ' + pend.join(', ')));

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
    if (anyStalled) {
      return 'One or more blade elements have stalled! The inner blade sections are often the first to stall due to lower local velocity.';
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
  if (document.getElementById('frameDragGroup')) {        // index2.html (Module 2)
    if (window.VLAB2) VLAB2.init();
  } else if (document.getElementById('propGeomGroup')) {  // index.html (Module 1)
    if (window.VLAB) VLAB.init();
  }
});
