// module2.js — Main application logic for Module 2
// Handles KV Matching (Sub-Calc C) and Efficiency Profiling (Sub-Calc D)

window.VLAB_MOD2 = {
  data: null,
  db: null,
  currentTab: 1,
  targetHoverRPM: 0,
  maxRPM: 0,
  motorParams: { kv: 0, rm_ohm: 0 },
  battParams: { v: 0 },
  propParams: { diam_m: 0 }
};

document.addEventListener('DOMContentLoaded', function() {
  _init();
});

function _init() {
  const rawData = localStorage.getItem('vlabModule1');
  if (!rawData) {
    document.getElementById('interactiveConfigList').innerHTML = `
      <div style="color:var(--danger); padding:15px; font-weight:600;">
        WARNING: No configuration found. Please complete Module 1 first.
      </div>
    `;
    setTimeout(() => { window.location.href = 'index.html'; }, 3000);
    return;
  }

  VLAB_MOD2.data = JSON.parse(rawData);

  // Fetch DB to build tile grids
  fetch('db/db.json')
    .then(r => r.json())
    .then(db => {
      VLAB_MOD2.db = db;
      _reconstructData();
      _buildTileGrids();
      _continueInit();
    })
    .catch(err => {
      console.error("Failed to load db.json for Module 2", err);
      document.getElementById('interactiveConfigList').innerHTML = `<div style="color:var(--danger); padding:15px; font-weight:600;">Error loading database.</div>`;
    });
}

function _reconstructData() {
  const compact = VLAB_MOD2.data;
  if (!compact || compact.selections) return; // Already in full format (e.g. legacy data)

  const db = VLAB_MOD2.db;

  // Find components by ID in the database
  const motor = db.motors.find(m => m.id === compact.mId) || null;
  const propeller = db.propellers.find(p => p.id === compact.pId) || null;
  const battery = db.batteries.find(b => b.id === compact.bId) || null;
  const frame = db.frames.find(f => f.id === compact.fId) || null;
  const esc = db.escs.find(e => e.id === compact.eId) || null;
  const flight_controller = db.flight_controllers.find(fc => fc.id === compact.fcId) || null;
  const receiver = db.receivers.find(r => r.id === compact.rId) || null;
  
  const payloads = (compact.pldIds || []).map(id => {
    return db.payloads.find(p => p.id === id);
  }).filter(Boolean);

  // Re-assemble verbose selections structure expected by the rest of the application
  VLAB_MOD2.data = {
    selections: {
      frame,
      motor,
      propeller,
      battery,
      esc,
      flight_controller,
      receiver,
      payloads
    },
    computed: {
      T_required: compact.T_req
    },
    altitude_m: compact.alt,
    rho: compact.rho
  };
}

function _buildTileGrids() {
  const sel = VLAB_MOD2.data.selections;

  Mod2UI.buildTileGrid('motorTilesContainer', VLAB_MOD2.db.motors, sel.motor.id, 
    (m) => `${m.kv}KV | Rm: ${m.rm_ohm}Ω | I0: ${m.i0_a}A`,
    (m) => {
      VLAB_MOD2.data.selections.motor = m;
      _recalculateParams();
    }
  );

  Mod2UI.buildTileGrid('propTilesContainer', VLAB_MOD2.db.propellers, sel.propeller.id,
    (p) => `${p.diameter_in}" | 2-Blade | ${p.mass_g_each}g`,
    (p) => {
      VLAB_MOD2.data.selections.propeller = p;
      _recalculateParams();
    }
  );

  Mod2UI.buildTileGrid('battTilesContainer', VLAB_MOD2.db.batteries, sel.battery.id,
    (b) => `${b.cells}S | ${b.voltage_nominal_v}V | ${b.capacity_mah}mAh`,
    (b) => {
      VLAB_MOD2.data.selections.battery = b;
      _recalculateParams();
    }
  );
}

function _continueInit() {
  const sel = VLAB_MOD2.data.selections;

  // Init Scene
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

  document.getElementById('tabRpmBtn').addEventListener('click', () => _switchTab(1));
  document.getElementById('tabEffBtn').addEventListener('click', () => _switchTab(2));

  const throttleSlider = document.getElementById('throttleSlider');
  if (throttleSlider) {
    throttleSlider.addEventListener('input', _handleRpmThrottleChange);
  }

  const btnRunSweep = document.getElementById('btnRunSweep');
  if (btnRunSweep) {
    btnRunSweep.addEventListener('click', _runEfficiencySweep);
  }
  
  _recalculateParams();
}

function _recalculateParams() {
  const sel = VLAB_MOD2.data.selections;
  
  VLAB_MOD2.battParams.v = sel.battery.voltage_nominal_v;
  VLAB_MOD2.motorParams.rm_ohm = sel.motor.rm_ohm;
  VLAB_MOD2.motorParams.kv = sel.motor.kv;
  VLAB_MOD2.propParams.diam_m = sel.propeller.diameter_m;

  VLAB_MOD2.maxRPM = VLAB_MOD2.motorParams.kv * VLAB_MOD2.battParams.v;
  
  const T_req = VLAB_MOD2.data.computed.T_required;
  const rho = VLAB_MOD2.data.rho;
  VLAB_MOD2.targetHoverRPM = Calc.requiredRPS(T_req, VLAB_MOD2.propParams.diam_m, rho) * 60.0;
  
  document.getElementById('sumKV').textContent = VLAB_MOD2.motorParams.kv;
  document.getElementById('sumHoverRPM').textContent = Math.round(VLAB_MOD2.targetHoverRPM);

  // Calculate hover efficiency
  const u_hover = Calc.solveHoverThrottle(sel.motor, VLAB_MOD2.battParams.v, VLAB_MOD2.propParams.diam_m, rho, T_req);
  const op_hover = Calc.solveOperatingPoint(sel.motor, u_hover * VLAB_MOD2.battParams.v, VLAB_MOD2.propParams.diam_m, rho);
  const hoverEffEl = document.getElementById('sumHoverEff');
  if (hoverEffEl) {
    if (op_hover) {
      hoverEffEl.textContent = `${op_hover.efficiency_pct.toFixed(1)}%`;
      const unitEl = hoverEffEl.nextElementSibling;
      if (unitEl) {
        unitEl.textContent = `at ${(u_hover * 100).toFixed(0)}% throttle`;
      }
    } else {
      hoverEffEl.textContent = `—`;
      const unitEl = hoverEffEl.nextElementSibling;
      if (unitEl) unitEl.textContent = `stalled`;
    }
  }
  
  // Re-render drone model entirely because a component might have swapped
  if (window.DroneModel) {
    DroneModel.updateFromSelections(sel);
  }

  if (VLAB_MOD2.currentTab === 1) {
    _handleRpmThrottleChange();
  } else {
    Mod2UI.updateEffChart([]);
    Mod2UI.renderEffTable([]);
    document.getElementById('sweepStatus').textContent = "Components swapped. Run sweep again to profile.";
    document.getElementById('sumPeakEff').textContent = `—`;
    document.getElementById('sumMaxThrust').textContent = `—`;
    document.getElementById('sumMaxCurrent').textContent = `—`;
    DroneModel.setSimRPM(0);
    DroneModel.setBurnState(false);
  }
}

function _switchTab(tabNum) {
  VLAB_MOD2.currentTab = tabNum;
  
  const t1Btn = document.getElementById('tabRpmBtn');
  const t2Btn = document.getElementById('tabEffBtn');
  
  if (tabNum === 1) {
    t1Btn.classList.add('active');
    t1Btn.setAttribute('aria-selected', 'true');
    t2Btn.classList.remove('active');
    t2Btn.setAttribute('aria-selected', 'false');
    
    document.getElementById('rpmControls').style.display = 'flex';
    document.getElementById('effControls').style.display = 'none';
    document.getElementById('calcFlowRpm').style.display = 'flex';
    document.getElementById('calcFlowEff').style.display = 'none';
    document.getElementById('rpmGaugeContainer').style.display = 'block';
    document.getElementById('effChartContainer').style.display = 'none';
    document.getElementById('calcHeaderTitle').textContent = 'Loaded RPM Derivation';

    DroneModel.setBurnState(false);
    _handleRpmThrottleChange();
  } else {
    t2Btn.classList.add('active');
    t2Btn.setAttribute('aria-selected', 'true');
    t1Btn.classList.remove('active');
    t1Btn.setAttribute('aria-selected', 'false');
    
    document.getElementById('rpmControls').style.display = 'none';
    document.getElementById('effControls').style.display = 'flex';
    document.getElementById('calcFlowRpm').style.display = 'none';
    document.getElementById('calcFlowEff').style.display = 'flex';
    document.getElementById('rpmGaugeContainer').style.display = 'none';
    document.getElementById('effChartContainer').style.display = 'block';
    document.getElementById('calcHeaderTitle').textContent = 'Motor Efficiency Derivation';

    _updateStandHUD(0, 0, 0, 0, 0);
    DroneModel.setSimRPM(0);
    DroneModel.setBurnState(false);
    Mod2UI.updateSankeyDiagram(0, 0, 0);
    document.getElementById('calc_eff').innerHTML = `&mdash;`;
    _updateCommentary("Click 'Run Efficiency Sweep' to step through 30% to 100% throttle. If you've paired a large propeller with a high-KV motor, watch out for the 3D smoke—the motor might overheat!");
  }
}

function _handleRpmThrottleChange() {
  if (VLAB_MOD2.currentTab !== 1 || !VLAB_MOD2.data) return;
  
  const slider = document.getElementById('throttleSlider');
  const valText = document.getElementById('throttleValue');
  const thrPct = parseInt(slider.value, 10);
  valText.textContent = `${thrPct}%`;
  
  const V_batt = VLAB_MOD2.battParams.v;
  const V_applied = (thrPct / 100.0) * V_batt;
  const D = VLAB_MOD2.propParams.diam_m;
  const rho = VLAB_MOD2.data.rho;
  const motor = VLAB_MOD2.data.selections.motor;

  const freeSpinEl = document.getElementById('valFreeSpin');
  const loadedEl = document.getElementById('valLoaded');
  const lostEl = document.getElementById('valLost');
  
  if (thrPct === 0) {
    _updateStandHUD(0, 0, 0, 0, 0);
    DroneModel.setSimRPM(0);
    Mod2UI.updateRpmGauge(0, 0, VLAB_MOD2.maxRPM, VLAB_MOD2.targetHoverRPM);
    Mod2UI.updateCircuitDiagram(0, 0, 0);
    document.getElementById('calc_nloaded').innerHTML = `n_loaded = &mdash;`;

    if (freeSpinEl) freeSpinEl.textContent = '0 RPM';
    if (loadedEl) loadedEl.textContent = '0 RPM';
    if (lostEl) lostEl.textContent = '0 RPM (0.0%)';
    
    _updateCommentary("Slide the throttle to apply voltage. Observe the Equivalent Motor Circuit below: the internal resistance (Rm) acts like a resistor, converting some of the battery's voltage directly into waste heat.");
    return;
  }
  
  const op = Calc.solveOperatingPoint(motor, V_applied, D, rho);
  const freeRpm = motor.kv * V_applied;
  
  if (!op) {
    _updateStandHUD(thrPct, V_applied, motor.max_current_a, 0, 0);
    DroneModel.setSimRPM(0);
    Mod2UI.updateRpmGauge(freeRpm, 0, VLAB_MOD2.maxRPM, VLAB_MOD2.targetHoverRPM);
    Mod2UI.updateCircuitDiagram(V_applied, V_applied, 0);

    if (freeSpinEl) freeSpinEl.textContent = `${Math.round(freeRpm).toLocaleString()} RPM`;
    if (loadedEl) loadedEl.textContent = '0 RPM';
    if (lostEl) lostEl.textContent = `${Math.round(freeRpm).toLocaleString()} RPM (100.0%)`;
    
    _updateCommentary(`WARNING: MOTOR STALLED. The propeller is too heavy for this motor. 100% of the applied ${V_applied.toFixed(1)}V is being dumped into the resistor as heat because the motor cannot overcome the aerodynamic drag.`);
    return;
  }
  
  _updateStandHUD(thrPct, V_applied, op.current_a, op.rpm, op.thrust_n);
  DroneModel.setSimRPM(op.rpm);
  Mod2UI.updateRpmGauge(freeRpm, op.rpm, VLAB_MOD2.maxRPM, VLAB_MOD2.targetHoverRPM);
  
  const v_bemf = V_applied - op.voltage_drop_v;
  Mod2UI.updateCircuitDiagram(V_applied, op.voltage_drop_v, v_bemf);
  
  document.getElementById('calc_nloaded').innerHTML = `n_loaded = ${motor.kv} &times; ${v_bemf.toFixed(2)}V = <strong>${Math.round(op.rpm)} RPM</strong>`;

  const lostRpm = Math.max(0, freeRpm - op.rpm);
  const lostPct = freeRpm > 0 ? (lostRpm / freeRpm) * 100 : 0;
  if (freeSpinEl) freeSpinEl.textContent = `${Math.round(freeRpm).toLocaleString()} RPM`;
  if (loadedEl) loadedEl.textContent = `${Math.round(op.rpm).toLocaleString()} RPM`;
  if (lostEl) lostEl.textContent = `${Math.round(lostRpm).toLocaleString()} RPM (${lostPct.toFixed(1)}%)`;
  
  if (op.rpm >= VLAB_MOD2.targetHoverRPM) {
     _updateCommentary(`SUCCESS: Hover RPM reached. The motor is pulling ${op.current_a.toFixed(1)} Amps. This current flows through the copper windings, causing a ${op.voltage_drop_v.toFixed(1)}V drop. That's why your Virtual Tachometer shows the Loaded RPM is lower than the Free-Spin RPM.`);
  } else {
     _updateCommentary(`Applying ${V_applied.toFixed(1)}V. The motor is fighting aerodynamic drag. It only spins using the remaining Back-EMF voltage (${v_bemf.toFixed(1)}V) after the resistor steals its share.`);
  }
}

function _runEfficiencySweep() {
  if (!VLAB_MOD2.data) return;
  const V_batt = VLAB_MOD2.battParams.v;
  const D = VLAB_MOD2.propParams.diam_m;
  const rho = VLAB_MOD2.data.rho;
  const motor = VLAB_MOD2.data.selections.motor;
  
  const btn = document.getElementById('btnRunSweep');
  const status = document.getElementById('sweepStatus');
  
  btn.disabled = true;
  status.textContent = "Profiling...";
  DroneModel.setBurnState(false);
  
  const throttles = [30, 40, 50, 60, 70, 80, 90, 100];
  let step = 0;
  const dataPoints = [];
  
  function runStep() {
    if (step >= throttles.length) {
      btn.disabled = false;
      status.textContent = "Sweep complete.";
      DroneModel.setSimRPM(0);
      _updateStandHUD(0, 0, 0, 0, 0);
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
      
      // Pass hover throttle to show the annotation line
      const T_req = VLAB_MOD2.data.computed.T_required;
      const u_hover = Calc.solveHoverThrottle(motor, V_batt, D, rho, T_req);
      Mod2UI.updateEffChart(dataPoints, u_hover * 100);

      // Keep smoke burning if the final step was bad
      if (dataPoints.length > 0 && dataPoints[dataPoints.length-1].efficiency_pct < 45) {
        DroneModel.setBurnState(true);
      }
      
      _updateCommentary(`Sweep complete. You've generated a full Motor Profile. Notice the shape: Efficiency peaks at ${peakThr}% throttle, but then Plummets. Look at the Power Flow diagram: as current increases, Waste Heat (I²R) grows quadratically and dominates the system.`);
      
      document.getElementById('nextModuleContainer').style.display = 'block';
      if (Mod2UI.initUnlockScene) {
        Mod2UI.initUnlockScene();
      }
      return;
    }
    
    const thrPct = throttles[step];
    const V_applied = (thrPct / 100.0) * V_batt;
    const op = Calc.solveOperatingPoint(motor, V_applied, D, rho);
    
    if (op) {
      const p_copper = op.current_a * op.current_a * motor.rm_ohm;
      dataPoints.push({
        throttle_pct: thrPct,
        rpm: op.rpm,
        efficiency_pct: op.efficiency_pct,
        thrust_n: op.thrust_n,
        current_a: op.current_a,
        power_elec_w: op.power_elec_w,
        power_loss_w: p_copper
      });
      
      _updateStandHUD(thrPct, V_applied, op.current_a, op.rpm, op.thrust_n);
      DroneModel.setSimRPM(op.rpm);
      Mod2UI.updateSankeyDiagram(op.power_elec_w, op.power_mech_w, p_copper);
      
      document.getElementById('calc_eff').innerHTML = `&eta;_m = ${op.power_mech_w.toFixed(1)}W / ${op.power_elec_w.toFixed(1)}W = <strong>${op.efficiency_pct.toFixed(1)}%</strong>`;
      
      // Trigger Smoke effect if efficiency drops critically low (thermal runaway)
      if (op.efficiency_pct < 45) {
        DroneModel.setBurnState(true);
      } else {
        DroneModel.setBurnState(false);
      }
      
    } else {
       // Stalled completely
       DroneModel.setBurnState(true); 
    }
    
    Mod2UI.updateEffChart(dataPoints);
    Mod2UI.renderEffTable(dataPoints);
    
    step++;
    setTimeout(runStep, 800);
  }
  
  runStep();
}

function _updateStandHUD(throttlePct, voltage, current, rpm, thrust) {
  document.getElementById('hudThrottle').textContent = throttlePct + '%';
  document.getElementById('hudVoltage').textContent = voltage.toFixed(1) + ' V';
  document.getElementById('hudCurrent').textContent = current.toFixed(1) + ' A';
  document.getElementById('hudRPM').textContent = Math.round(rpm);
  document.getElementById('hudThrust').textContent = thrust.toFixed(2) + ' N';
}

function _updateCommentary(text) {
  const panel = document.getElementById('liveCommentaryText');
  if (panel) {
    panel.innerHTML = text;
  }
}
