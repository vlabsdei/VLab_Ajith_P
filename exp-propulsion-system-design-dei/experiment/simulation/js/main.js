/* global THREE, Chart */

const Calc = (function () {
  'use strict';

  const G_ACC = 9.80665; // standard gravitational acceleration m/s^2
  const N_MOTORS = 4; // quadcopter design
  const CT_COEFF = 0.10926; // propeller thrust coefficient (Ct)
  const CQ_COEFF = 0.01065; // propeller torque coefficient (Cq)
  const FOM_VAL = 0.655; // hovering Figure of Merit

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

  function get_aero_thrust(n_rps, D, rho) {
    return CT_COEFF * rho * n_rps * n_rps * Math.pow(D, 4);
  }

  function get_prop_torque(n_rps, D, rho) {
    return CQ_COEFF * rho * n_rps * n_rps * Math.pow(D, 5);
  }

  function get_req_rps(t_target, D, rho) {
    return Math.sqrt(t_target / (CT_COEFF * rho * Math.pow(D, 4)));
  }

  // Solves the steady-state operating point of the actuator circuit
  function calc_motor_point(motor, V, D, rho) {
    const kv = motor.kv;
    const rm = motor.rm_ohm;
    const i0 = motor.i0_a;

    const ke = 30.0 / (kv * Math.PI); // back-EMF constant
    const d5 = Math.pow(D, 5);
    
    // solve quadratic: a * w^2 + b * w + c = 0
    const a = (CQ_COEFF * rho * d5 * rm) / (4.0 * Math.PI * Math.PI * ke);
    const b = ke;
    const c = i0 * rm - V;

    const disc = b * b - 4.0 * a * c;
    if (disc < 0) return null; // Stall condition

    const w = (-b + Math.sqrt(disc)) / (2.0 * a);
    const rpm = w * 30.0 / Math.PI;
    const i_mech = (V - ke * w) / rm;
    const i_total = Math.max(0, i_mech);

    const n = w / (2.0 * Math.PI);
    const t_val = get_aero_thrust(n, D, rho);
    const q_val = get_prop_torque(n, D, rho);
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

  function get_eff_profile(motor, V_batt, D, rho) {
    return [0.40, 0.60, 0.80, 1.00].map(function (k) {
      const op = calc_motor_point(motor, k * V_batt, D, rho);
      if (!op) {
        return { throttle_pct: k * 100, efficiency_pct: 0, thrust_n: 0, current_a: 0, power_w: 0 };
      }
      return {
        throttle_pct: k * 100,
        efficiency_pct: op.eff,
        thrust_n: op.thrust,
        current_a: op.curr,
        power_w: op.p_elec
      };
    });
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

  function est_hover_time(battery, motor, T_motor, D, rho) {
    const V = battery.voltage_nominal_v;
    const mah = battery.capacity_mah;

    const u = solve_hover_throttle(motor, V, D, rho, T_motor);
    const op = calc_motor_point(motor, u * V, D, rho);

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

  function solve_hover_throttle(motor, V_batt, D, rho, T_req) {
    let low = 0.0, high = 1.0, throttle = 0.5;
    for (let i = 0; i < 12; i++) {
      throttle = (low + high) / 2.0;
      const op = calc_motor_point(motor, throttle * V_batt, D, rho);
      if (!op || op.thrust < T_req) {
        low = throttle;
      } else {
        high = throttle;
      }
    }
    return Math.min(Math.max(throttle, 0.0), 1.0);
  }

  function fmt(val, dec, unit) {
    return val.toFixed(dec) + (unit ? ' ' + unit : '');
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
    efficiencyProfile: get_eff_profile,
    thrustSweep: get_thrust_sweep,
    massBudget: get_mass_budget,
    hoverFlightTime: est_hover_time,
    propulsionMargin: get_prop_margin,
    solveHoverThrottle: solve_hover_throttle,
    fmt: fmt
  };
})();
window.Calc = Calc;

const Scene = (function () {
  'use strict';

  let _rndr, _scn, _cam, _ctrls, _clk;
  let _frameId = null;
  let _tabIdx = 1;

  function init() {
    const canvas = document.getElementById('droneCanvas');
    const wrap = document.getElementById('canvasWrapper');

    _scn = new THREE.Scene();
    _scn.background = new THREE.Color(0xf3f4f6); // Light gray grid backing

    _rndr = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
    _rndr.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    _rndr.shadowMap.enabled = true;
    _rndr.shadowMap.type = THREE.PCFSoftShadowMap;
    _rndr.outputEncoding = THREE.sRGBEncoding;
    _rndr.toneMapping = THREE.ACESFilmicToneMapping;
    _rndr.toneMappingExposure = 1.0;

    const w = wrap.clientWidth || 600;
    const h = wrap.clientHeight || 260;
    _cam = new THREE.PerspectiveCamera(45, w / h, 0.01, 100);
    _cam.position.set(0.25, 0.18, 0.35);

    _ctrls = new THREE.OrbitControls(_cam, _rndr.domElement);
    _ctrls.enableDamping = true;
    _ctrls.dampingFactor = 0.08;
    _ctrls.minDistance = 0.12;
    _ctrls.maxDistance = 5.0;
    _ctrls.maxPolarAngle = Math.PI * 0.88;
    _ctrls.target.set(0, 0.10, 0);
    _ctrls.update();

    const ambient = new THREE.AmbientLight(0xffffff, 0.60);
    _scn.add(ambient);

    const sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(1.5, 3.0, 1.5);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 1024;
    sun.shadow.mapSize.height = 1024;
    sun.shadow.camera.near = 0.1;
    sun.shadow.camera.far = 10;
    sun.shadow.camera.left = -1.0;
    sun.shadow.camera.right = 1.0;
    sun.shadow.camera.top = 1.0;
    sun.shadow.camera.bottom = -1.0;
    sun.shadow.bias = -0.0002;
    _scn.add(sun);

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

    window.addEventListener('orientationchange', function () {
      setTimeout(doResize, 100);
    });
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
    const wrap = document.getElementById('canvasWrapper');
    if (!wrap || !_rndr) return;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (w === 0 || h === 0) return;
    _rndr.setSize(w, h, false);
    _cam.aspect = w / h;
    _cam.updateProjectionMatrix();
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
  let _blurDscs = [];
  let _rotRPM = 0;

  let _lcdCnvs = null;
  let _lcdCtx = null;
  let _lcdTxtr = null;

  let _smokeParts = [];
  let _isBurning = false;
  let _spawnTmr = 0.0;

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
    _blurDscs = [];
  }

  function createBlade(radius, baseChord, directionSign) {
    const blade = new THREE.Group();
    const steps = 6;
    const startR = 0.006;
    const stepL = (radius - startR) / steps;

    for (let i = 0; i < steps; i++) {
      const segStart = startR + i * stepL;
      const segEnd = segStart + stepL;
      const segMid = (segStart + segEnd) / 2.0;
      const segL = stepL * 1.05;

      const t = i / (steps - 1);
      const segmentChord = baseChord * (1.1 * (1 - t) + 0.4 * t);
      const segmentThickness = 0.003 * (1 - t) + 0.0006 * t;
      const pitchAngle = (0.32 * (1 - t) + 0.08 * t) * directionSign;

      const segGeo = new THREE.BoxGeometry(segL, segmentThickness, segmentChord);
      const isTip = (i === steps - 1);
      const segMat = isTip 
        ? createMat(0xef4444, 0.4, 0.1)
        : createMat(0x282828, 0.45, 0.1);
        
      const segMesh = new THREE.Mesh(segGeo, segMat);
      segMesh.position.x = segMid;
      segMesh.rotation.x = pitchAngle;
      segMesh.castShadow = true;

      blade.add(segMesh);
    }

    return blade;
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
      mountMesh.position.y = standHeight + 0.011;
      _droneGrp.add(mountMesh);

      if (motor) {
        const motorY = standHeight + 0.014;
        const bellR = (motor.bell_diameter_mm / 2) / 1000;
        const bellH = motor.bell_height_mm / 1000;
        const bellGeo = new THREE.CylinderGeometry(bellR, bellR * 0.82, bellH, 20);
        const bellMat = createMat(0x1e293b, 0.3, 0.7);
        const bellMesh = new THREE.Mesh(bellGeo, bellMat);
        bellMesh.position.y = motorY + bellH / 2;
        bellMesh.castShadow = true;
        _droneGrp.add(bellMesh);

        const statorGeo = new THREE.CylinderGeometry(bellR * 0.55, bellR * 0.55, bellH * 0.6, 12);
        const statorMat = createMat(0xd97706, 0.5, 0.4);
        const statorMesh = new THREE.Mesh(statorGeo, statorMat);
        statorMesh.position.y = motorY + bellH * 0.3;
        _droneGrp.add(statorMesh);

        if (prop) {
          const propR = prop.diameter_m / 2;
          const propChord = 0.016 + prop.diameter_m * 0.04;
          const hubH = 0.012;
          const propY = motorY + bellH + hubH / 2;

          const propGroup = new THREE.Group();
          propGroup.position.set(0, propY, 0);
          _droneGrp.add(propGroup);
          _propGrps.push(propGroup);

          const hubGeo = new THREE.CylinderGeometry(0.006, 0.006, hubH, 12);
          const hubMat = createMat(0x1f2937, 0.5, 0.1);
          const hubMesh = new THREE.Mesh(hubGeo, hubMat);
          propGroup.add(hubMesh);

          const nutGeo = new THREE.CylinderGeometry(0.004, 0.004, 0.006, 6);
          const nutMat = createMat(0xd1d5db, 0.2, 0.9);
          const nutMesh = new THREE.Mesh(nutGeo, nutMat);
          nutMesh.position.y = hubH / 2 + 0.006 / 2;
          propGroup.add(nutMesh);

          const b1 = createBlade(propR, propChord, 1);
          const b2 = createBlade(propR, propChord, 1);
          b2.rotation.y = Math.PI;
          propGroup.add(b1);
          propGroup.add(b2);

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
          propGroup.add(discMesh);
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

    const bottomPlateGeo = new THREE.BoxGeometry(bw, 0.002, bz);
    const bottomPlate = new THREE.Mesh(bottomPlateGeo, frameMat);
    bottomPlate.position.y = 0;
    bottomPlate.receiveShadow = true;
    bottomPlate.castShadow = true;
    _droneGrp.add(bottomPlate);

    const topPlateGeo = new THREE.BoxGeometry(bw * 0.95, 0.002, bz * 0.95);
    const topPlate = new THREE.Mesh(topPlateGeo, frameMat);
    topPlate.position.y = bh;
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
    const armMat = createMat(hexToInt(frame.color_hex), frame.roughness + 0.1, frame.metalness);

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

        const statorGeo = new THREE.CylinderGeometry(bellR * 0.55, bellR * 0.55, bellH * 0.5, 10);
        const statorMat = createMat(0xd97706, 0.5, 0.4);
        const statorMesh = new THREE.Mesh(statorGeo, statorMat);
        statorMesh.position.copy(tipPos);
        statorMesh.position.y = motorY + bellH * 0.25;
        _droneGrp.add(statorMesh);

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
          const b1 = createBlade(propR, propChord, dirSign);
          const b2 = createBlade(propR, propChord, dirSign);
          b2.rotation.y = Math.PI;

          propGroup.add(b1);
          propGroup.add(b2);

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

      const antGeo = new THREE.CylinderGeometry(0.0006, 0.0006, 0.045, 4);
      const antMat = createMat(0x111827, 0.9, 0.0);
      const antMesh = new THREE.Mesh(antGeo, antMat);
      antMesh.position.set(-0.004, 0.0225, bz * 0.34);
      antMesh.rotation.x = 0.25;
      antMesh.rotation.z = -0.15;
      _droneGrp.add(antMesh);
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
  let _iLast = 0.0;
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
    _iLast = 0.0;

    if (window.DroneModel) {
      window.DroneModel.setBurnState(false);
      const drone = window.DroneModel.getDroneGroup();
      if (drone) {
        drone.position.y = LAUNCH_ALT;
      }
    }

    _phase = 'PREFLIGHT';

    const op_max = Calc.solveOperatingPoint(cfg.motor, cfg.V_batt, cfg.propeller.diameter_m, cfg.rho);
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
    _iLast = 0.0;

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
    const V_oc_start = cells * (3.5 + 0.7 * soc_start);
    const R_batt = cells * 0.008;
    const V_batt_curr = Math.max(cells * 3.0, V_oc_start - _iLast * R_batt);

    const op_max = Calc.solveOperatingPoint(motor, V_batt_curr, propeller.diameter_m, rho);
    const T_max = op_max ? op_max.thrust : 0.0;

    let thrust = 0.0;

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
      let actualThrust = thrust;

      // Ground effect calculation
      const standoff = Math.max(_yVal - LAUNCH_ALT, propeller.diameter_m * 0.25);
      const geTerm = propeller.diameter_m / (4.0 * standoff);
      if (geTerm < 0.99) {
        const geMul = Math.min(1.0 / (1.0 - geTerm * geTerm), 1.75);
        actualThrust *= geMul;
      }

      // Induced velocity aerodynamic damping
      const area = Math.PI * 0.25 * propeller.diameter_m * propeller.diameter_m;
      const v_ind = Math.sqrt(Math.max(0.1, actualThrust) / (2.0 * rho * area));
      const inflow = _vyVal / v_ind;
      const tDamp = Math.max(0.2, 1.0 - 0.45 * inflow);
      actualThrust *= tDamp;

      let CdA = 0.007;
      if (frame && frame.body_size_mm && frame.body_size_mm.length >= 3) {
        CdA = (frame.body_size_mm[0] / 1000.0) * (frame.body_size_mm[2] / 1000.0);
      }
      const F_drag = 0.5 * rho * CdA * _vyVal * Math.abs(_vyVal);
      const netForce = actualThrust * MOTORS_COUNT - M_kg * G_FORCE - F_drag;
      const acc = netForce / M_kg;

      _vyVal += acc * dt_step;
      _vyVal = Math.min(Math.max(_vyVal, -1.0), 1.0);
      _yVal += _vyVal * dt_step;

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
          
          const nextBtn = document.getElementById('nextModuleContainer');
          if (nextBtn) nextBtn.style.display = 'block';
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
      u = Calc.solveHoverThrottle(motor, V_batt_curr, propeller.diameter_m, rho, finalT);
    }

    const op = Calc.solveOperatingPoint(motor, u * V_batt_curr, propeller.diameter_m, rho);
    const current_a = op ? op.curr : 0.0;
    const power_elec_w = op ? op.p_elec : 0.0;
    const rpm = op ? op.rpm : 0.0;

    const pDraw = power_elec_w * MOTORS_COUNT;
    _eRem = Math.max(0, _eRem - pDraw * dt_acc);
    _iLast = current_a * MOTORS_COUNT;

    const p_loss = op ? Math.max(0, op.p_elec - op.p_mech) : 0.0;
    const m_motor = ((_cfg.motor && _cfg.motor.mass_g) ? _cfg.motor.mass_g : 50.0) / 1000.0;
    
    // First-order thermal mass equation
    const dT_m = (p_loss - 0.25 * (_tMotor - 25.0)) / (m_motor * 385.0);
    _tMotor += dT_m * dt_acc;
    
    const esc_limit = (_cfg.esc && _cfg.esc.current_a) ? _cfg.esc.current_a : 30.0;
    let p_loss_esc = current_a * current_a * 0.004;
    if (current_a > esc_limit) {
      const over_ratio = current_a / esc_limit;
      p_loss_esc *= (over_ratio * over_ratio);
    }
    
    const dT_e = (p_loss_esc - 0.12 * (_tEsc - 25.0)) / 2.5;
    _tEsc += dT_e * dt_acc;

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
          window.updateLiveCommentary(`Manual Mode: Motors are at ${Math.round(_mThrottle)}% throttle. Total thrust (${(finalT * MOTORS_COUNT).toFixed(1)} N) is less than weight (${(_cfg.M_kg * 9.81).toFixed(1)} N).`);
        } else {
          window.updateLiveCommentary(`OBSERVE: Airborne. Total thrust (${(finalT * MOTORS_COUNT).toFixed(1)} N) fights weight (${(_cfg.M_kg * 9.81).toFixed(1)} N).`);
        }
      } else {
        if (_phase === 'PREFLIGHT') {
          window.updateLiveCommentary('GUIDE: Armed. Click "Start Simulation" to perform automated hover.');
        } else if (_phase === 'TAKEOFF') {
          window.updateLiveCommentary(`Takeoff: Controller commands climb throttle. Thrust (${(finalT * MOTORS_COUNT).toFixed(1)} N) exceeds weight (${(_cfg.M_kg * 9.81).toFixed(1)} N).`);
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

    list.forEach(function (item) {
      const card = document.createElement('label');
      card.className = 'component-tile';
      card.htmlFor = 'input_' + cat + '_' + item.id;

      const inp = document.createElement('input');
      inp.type = isMulti ? 'checkbox' : 'radio';
      inp.name = 'sel_' + cat;
      inp.id = 'input_' + cat + '_' + item.id;
      inp.value = item.id;

      const cardLbl = document.createElement('div');
      cardLbl.className = 'tile-label';
      cardLbl.innerHTML =
        '<span class="tile-name">' + _esc(item.label) + '</span>' +
        '<span class="tile-spec">' + specF(item) + '</span>';

      card.appendChild(inp);
      card.appendChild(cardLbl);
      grid.appendChild(card);

      inp.addEventListener('change', function () {
        _onSelect(cat, item, isMulti, inp.checked);
      });
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
    } else {
      selections[cat] = item;
    }

    const inputs = document.getElementsByName('sel_' + cat);
    inputs.forEach(function (inp) {
      const tile = inp.parentNode;
      if (inp.checked) {
        tile.classList.add('active');
        tile.classList.add('selected');
      } else {
        tile.classList.remove('active');
        tile.classList.remove('selected');
      }
    });

    if (window.DroneModel) {
      window.DroneModel.updateFromSelections(selections);
    }

    resetOutputs();
    updateChecklist();
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

    let counts = 0;
    let html = '';

    let overlap = false;
    if (sel.frame && sel.propeller) {
      const wheelbase = sel.frame.wheelbase_mm;
      const diameter = sel.propeller.diameter_m * 1000.0;
      const maxDia = wheelbase / Math.sqrt(2);
      if (diameter > maxDia) overlap = true;
    }

    fields.forEach(function (f) {
      const item = sel[f.key];
      const isDone = !!item && !(f.key === 'propeller' && overlap);
      if (isDone) counts++;

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
      btn.disabled = !(counts === fields.length);
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
      'T_req = (' + r.mass_kg.toFixed(4) + ' kg &times; 9.80665 m/s&sup2;) / 4 = ' + r.T_required_n.toFixed(4) + ' N per motor';

    document.getElementById('calcB_eval').innerHTML =
      'T_aero = ' + Calc.Ct.toFixed(5) + ' &times; ' + r.rho.toFixed(4) + ' kg/m&sup3; &times; (' +
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
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { font: { family: 'Inter', size: 10 }, boxWidth: 10, padding: 6 }
          }
        },
        scales: {
          x: {
            grid: { color: '#f3f4f6' },
            ticks: { font: { family: 'JetBrains Mono', size: 9 } }
          },
          y: {
            grid: { color: '#f3f4f6' },
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
    if (marginDesc) marginDesc.textContent = 'T_aero / T_req';
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
    resetResults: resetOutputs
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
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            title: { display: true, text: 'Throttle (%)' },
            min: 30,
            max: 105,
            grid: { color: '#f3f4f6' }
          },
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            title: { display: true, text: 'Efficiency (%)' },
            min: 0,
            max: 100,
            grid: { color: '#f3f4f6' }
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
              font: { size: 10 },
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
        responsive: true,
        maintainAspectRatio: false,
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
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            title: { display: true, text: 'Current (A)' },
            min: 0,
            grid: { color: '#f3f4f6' }
          },
          y: {
            type: 'linear',
            display: true,
            title: { display: true, text: 'Thrust (N)' },
            min: 0,
            grid: { color: '#f3f4f6' }
          }
        },
        plugins: {
          legend: { display: true, labels: { boxWidth: 12, font: { size: 10 } } },
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

    const w = canvas.clientWidth || 300;
    const h = canvas.clientHeight || 180;

    _unlScn = new THREE.Scene();
    _unlScn.background = new THREE.Color(0xf3f4f6);

    _unlCam = new THREE.PerspectiveCamera(40, w / h, 0.01, 10);
    _unlCam.position.set(0.12, 0.10, 0.16);

    _unlRndr = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    _unlRndr.setSize(w, h, false);
    _unlRndr.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    _unlCtrls = new THREE.OrbitControls(_unlCam, _unlRndr.domElement);
    _unlCtrls.enableDamping = true;
    _unlCtrls.dampingFactor = 0.08;
    _unlCtrls.minDistance = 0.08;
    _unlCtrls.maxDistance = 1.0;
    _unlCtrls.target.set(0, 0.005, 0);
    _unlCtrls.update();

    const ambient = new THREE.AmbientLight(0xffffff, 0.70);
    _unlScn.add(ambient);

    const sun = new THREE.DirectionalLight(0xffffff, 0.90);
    sun.position.set(1.0, 2.0, 1.0);
    _unlScn.add(sun);

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

    window.addEventListener('resize', resizeUnlock);
  }

  function resizeUnlock() {
    const canvas = document.getElementById('unlockCanvas');
    if (!canvas || !_unlRndr || !_unlCam) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    _unlRndr.setSize(w, h, false);
    _unlCam.aspect = w / h;
    _unlCam.updateProjectionMatrix();
  }

  function buildTiles(containerId, items, selectedId, specF, onClick) {
    const container = document.getElementById(containerId);
    if (!container) return;

    let html = '';
    items.forEach(item => {
      const active = item.id === selectedId;
      const idStr = `mod2_${containerId}_${item.id}`;
      html += `
        <label class="component-tile ${active ? 'active selected' : ''}" for="${idStr}">
          <input type="radio" name="${containerId}" id="${idStr}" value="${item.id}" ${active ? 'checked' : ''} style="display:none;">
          <div class="tile-label">
            <span class="tile-name">${item.label}</span>
            <span class="tile-spec">${specF(item)}</span>
          </div>
        </label>
      `;
    });
    
    container.innerHTML = html;

    const inputs = container.querySelectorAll('input[type="radio"]');
    inputs.forEach(input => {
      input.addEventListener('change', (e) => {
        container.querySelectorAll('.component-tile').forEach(t => t.classList.remove('active', 'selected'));
        if (e.target.checked) {
          e.target.parentElement.classList.add('active', 'selected');
        }
        const selItem = items.find(i => i.id === e.target.value);
        if (onClick && selItem) onClick(selItem);
      });
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

      const op = Calc.solveOperatingPoint(sel.motor, appliedV, propD, rho);
      const curr = op ? op.curr : 0.0;
      const rpm = op ? op.rpm : 0.0;
      const thrust_n = op ? op.thrust : 0.0;
      const reqThrust = window.VLAB.state.computed.T_required || 0.0;

      const p_loss = op ? Math.max(0, op.p_elec - op.p_mech) : 0.0;
      const m_motor = (sel.motor.mass_g || 50.0) / 1000.0;
      
      const dT_m = (p_loss - 0.18 * (_benchState.T_motor - 25.0)) / (m_motor * 385.0);
      _benchState.T_motor += dT_m * dt;

      const esc_limit = sel.esc.current_a || 30.0;
      let p_loss_esc = curr * curr * 0.004;
      if (curr > esc_limit) {
        const ratio = curr / esc_limit;
        p_loss_esc *= (ratio * ratio);
      }

      const dT_e = (p_loss_esc - 0.08 * (_benchState.T_esc - 25.0)) / 2.5;
      _benchState.T_esc += dT_e * dt;

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
          calcB_eval.innerHTML =
            'T_aero = ' + Calc.Ct.toFixed(5) + ' &times; ' + rho.toFixed(4) + ' kg/m&sup3; &times; (' +
            rps.toFixed(1) + ' rps)&sup2; &times; (' + propD.toFixed(4) + ' m)<sup>4</sup> = ' + thrust_n.toFixed(4) + ' N';
        }
      } else {
        if (calcB_eval) calcB_eval.innerHTML = _benchState.cutPower ? 'ESC Burnt Out!' : 'Motor Stalled';
      }
    },

    init: function () {
      if (localStorage.getItem('vlabModule1')) {
        const nextBtn = document.getElementById('nextModuleContainer');
        if (nextBtn) nextBtn.style.display = 'block';
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

      fetch('db/db.json')
        .then(function (res) {
          if (!res.ok) throw new Error('DB load error: ' + res.status);
          return res.json();
        })
        .then(function (db) {
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
                const mappings = [
                  { cat: 'frame', id: state.fId },
                  { cat: 'motor', id: state.mId },
                  { cat: 'propeller', id: state.pId },
                  { cat: 'battery', id: state.bId },
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
                UI.updateChecklist();
                _runAnalysisPipeline();

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
        _runAnalysisPipeline();

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
          rho: window.VLAB.state.rho
        };
        localStorage.setItem('vlabModule1', JSON.stringify(compactState));

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
        });
      }

      document.getElementById('btnPlay').addEventListener('click', function () {
        if (FlightSim.isRunning()) {
          FlightSim.stop();
          const manual = document.getElementById('btnModeManual').classList.contains('active');
          this.textContent = manual ? 'Resume Flight' : 'Resume Hover';
        } else {
          const cfg = _buildSimConfig();
          if (!cfg) return;
          const manual = document.getElementById('btnModeManual').classList.contains('active');
          FlightSim.start(cfg, manual ? 'manual' : 'auto');
          this.textContent = 'Pause';
        }
      });

      document.getElementById('btnReset').addEventListener('click', function () {
        FlightSim.reset();
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
    }
  };
  window.VLAB = VLAB;

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

    const op = Calc.solveOperatingPoint(sel.motor, nominalV, propD, rho);
    window.VLAB.state.computed.op_point = op;

    if (!op) return;

    const n_rps = op.rpm / 60.0;
    const T_aero = Calc.aerodynamicThrust(n_rps, propD, rho);
    window.VLAB.state.computed.T_aero = T_aero;

    const margin = Calc.propulsionMargin(T_req, T_aero);
    window.VLAB.state.computed.margin = margin;

    const flightTime = Calc.hoverFlightTime(sel.battery, sel.motor, T_req, propD, rho);
    window.VLAB.state.computed.flight_time = flightTime;

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
      comp.T_required
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
    const commentaryPanel = document.getElementById('liveCommentaryPanel');

    if (aeroControls) aeroControls.style.display = 'none';
    if (standHud) standHud.style.display = 'none';
    if (simControls) simControls.style.display = 'none';
    if (simHud) simHud.style.display = 'none';
    if (commentaryPanel) commentaryPanel.style.display = 'none';

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
    } else if (tabNum === 2) {
      if (assembleChecklist) assembleChecklist.style.display = 'none';
      if (resultsSection) resultsSection.style.display = 'block';
      if (aeroControls) aeroControls.style.display = 'flex';
      if (standHud) standHud.style.display = 'block';
      if (commentaryPanel) commentaryPanel.style.display = 'flex';
      
      document.getElementById('flightChartContainer').style.display = 'none';
      document.getElementById('thrustChartContainer').style.display = 'block';

      if (window.VLAB.resetStand) window.VLAB.resetStand();
      _setAeroBenchThrottle(0);
    } else if (tabNum === 3) {
      if (assembleChecklist) assembleChecklist.style.display = 'none';
      if (resultsSection) resultsSection.style.display = 'block';
      if (simControls) simControls.style.display = 'flex';
      if (simHud) simHud.style.display = 'block';
      if (commentaryPanel) commentaryPanel.style.display = 'flex';

      document.getElementById('flightChartContainer').style.display = 'block';
      document.getElementById('thrustChartContainer').style.display = 'none';
      initChart();

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
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { font: { family: 'Inter', size: 10 }, boxWidth: 10, padding: 6 }
          }
        },
        scales: {
          x: {
            title: { display: true, text: 'Time (s)', font: { family: 'Inter', size: 9 } },
            grid: { color: '#f3f4f6' },
            ticks: { font: { family: 'JetBrains Mono', size: 8 } }
          },
          y: {
            title: { display: true, text: 'Altitude (m)', font: { family: 'Inter', size: 9 } },
            grid: { color: '#f3f4f6' },
            ticks: { font: { family: 'JetBrains Mono', size: 8 } },
            min: 0,
            max: 5
          },
          y1: {
            title: { display: true, text: 'Thrust (N)', font: { family: 'Inter', size: 9 } },
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
    const el = document.getElementById('liveCommentaryText');
    if (el) el.textContent = text;
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
    }
  };
  window.VLAB_MOD2 = VLAB_MOD2;

  function _startM2() {
    const raw = localStorage.getItem('vlabModule1');
    if (!raw) {
      document.getElementById('cfg_list_m2').innerHTML = `
        <div style="color:var(--danger); padding:15px; font-weight:600;">
          WARNING: Configuration data missing. Returning to Assembly.
        </div>
      `;
      setTimeout(() => { window.location.href = 'index.html'; }, 3000);
      return;
    }

    window.VLAB_MOD2.data = JSON.parse(raw);

    fetch('db/db.json')
      .then(r => r.json())
      .then(db => {
        window.VLAB_MOD2.db = db;
        _reconstructState();
        _buildM2Grids();
        _continueSetup();
      })
      .catch(err => {
        console.error(err);
        document.getElementById('cfg_list_m2').innerHTML = `<div style="color:var(--danger); padding:15px; font-weight:600;">Database error.</div>`;
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

  function _buildM2Grids() {
    const sel = window.VLAB_MOD2.data.selections;

    Mod2UI.buildTileGrid('m_tiles_wrap', window.VLAB_MOD2.db.motors, sel.motor.id, 
      (m) => `${m.kv}KV | Rm: ${m.rm_ohm}Ω | I0: ${m.i0_a}A`,
      (m) => {
        window.VLAB_MOD2.data.selections.motor = m;
        _recalcM2();
      }
    );

    Mod2UI.buildTileGrid('p_tiles_wrap', window.VLAB_MOD2.db.propellers, sel.propeller.id,
      (p) => `${p.diameter_in}" | 2-Blade | ${p.mass_g_each}g`,
      (p) => {
        window.VLAB_MOD2.data.selections.propeller = p;
        _recalcM2();
      }
    );

    Mod2UI.buildTileGrid('b_tiles_wrap', window.VLAB_MOD2.db.batteries, sel.battery.id,
      (b) => `${b.cells}S | ${b.voltage_nominal_v}V | ${b.capacity_mah}mAh`,
      (b) => {
        window.VLAB_MOD2.data.selections.battery = b;
        _recalcM2();
      }
    );
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
    
    _recalcM2();
  }

  function _recalcM2() {
    const sel = window.VLAB_MOD2.data.selections;
    
    window.VLAB_MOD2.battParams.v = sel.battery.voltage_nominal_v;
    window.VLAB_MOD2.motorParams.rm_ohm = sel.motor.rm_ohm;
    window.VLAB_MOD2.motorParams.kv = sel.motor.kv;
    window.VLAB_MOD2.propParams.diam_m = sel.propeller.diameter_m;

    window.VLAB_MOD2.maxRPM = window.VLAB_MOD2.motorParams.kv * window.VLAB_MOD2.battParams.v;
    
    const T_req = window.VLAB_MOD2.data.computed.T_required;
    const rho = window.VLAB_MOD2.data.rho;
    window.VLAB_MOD2.targetHoverRPM = Calc.requiredRPS(T_req, window.VLAB_MOD2.propParams.diam_m, rho) * 60.0;
    
    document.getElementById('sumKV').textContent = window.VLAB_MOD2.motorParams.kv;
    document.getElementById('sumHoverRPM').textContent = Math.round(window.VLAB_MOD2.targetHoverRPM);

    const u_hover = Calc.solveHoverThrottle(sel.motor, window.VLAB_MOD2.battParams.v, window.VLAB_MOD2.propParams.diam_m, rho, T_req);
    const op_hover = Calc.solveOperatingPoint(sel.motor, u_hover * window.VLAB_MOD2.battParams.v, window.VLAB_MOD2.propParams.diam_m, rho);
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
    
    const V_batt = window.VLAB_MOD2.battParams.v;
    const V_applied = (pct / 100.0) * V_batt;
    const D = window.VLAB_MOD2.propParams.diam_m;
    const rho = window.VLAB_MOD2.data.rho;
    const motor = window.VLAB_MOD2.data.selections.motor;

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
    
    const op = Calc.solveOperatingPoint(motor, V_applied, D, rho);
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
    
    const btn = document.getElementById('btn_profile_sweep');
    const status = document.getElementById('sweepStatus');
    
    btn.disabled = true;
    status.textContent = "Profiling system...";
    DroneModel.setBurnState(false);
    
    const steps = [30, 40, 50, 60, 70, 80, 90, 100];
    let idx = 0;
    const dataPoints = [];
    
    function processStep() {
      if (idx >= steps.length) {
        btn.disabled = false;
        status.textContent = "Analysis complete.";
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
        const u_hover = Calc.solveHoverThrottle(motor, V_batt, D, rho, T_req);
        Mod2UI.updateEffChart(dataPoints, u_hover * 100);

        if (dataPoints.length > 0 && dataPoints[dataPoints.length-1].efficiency_pct < 45) {
          DroneModel.setBurnState(true);
        }
        
        _showMsg(`Actuator profiling complete. Peak efficiency reached at ${peakThr}% throttle. Copper winding loss dominates high throttle range.`);
        
        document.getElementById('nextModuleContainer').style.display = 'block';
        if (Mod2UI.initUnlockScene) {
          Mod2UI.initUnlockScene();
        }
        return;
      }
      
      const thrPct = steps[idx];
      const V_applied = (thrPct / 100.0) * V_batt;
      const op = Calc.solveOperatingPoint(motor, V_applied, D, rho);
      
      if (op) {
        const p_copper = op.curr * op.curr * motor.rm_ohm;
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
        
        if (op.eff < 45) {
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
  if (document.getElementById('tbl_mass_body')) {
    if (window.VLAB && typeof window.VLAB.init === 'function') {
      window.VLAB.init();
    }
  } else if (document.getElementById('cfg_list_m2')) {
    if (window.VLAB_MOD2 && typeof window.VLAB_MOD2.init === 'function') {
      window.VLAB_MOD2.init();
    }
  }
});
