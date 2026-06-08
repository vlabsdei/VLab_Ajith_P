// main.js — Application entry coordinator.
// Manages global simulation state, wires events, and handles the analysis pipeline.

(function () {
  'use strict';

  // Master App State 
  window.VLAB = {
    db: null,
    state: {
      selections: {
        frame:             null,
        motor:             null,
        propeller:         null,
        battery:           null,
        esc:               null,
        flight_controller: null,
        receiver:          null,
        payloads:          []
      },
      altitude_m: 0,
      rho:        1.225,
      mass_budget: null,
      computed: {
        T_required:       null,
        T_aero:           null,
        op_point:         null,
        flight_time:      null,
        margin:           null
      }
    },
    currentTab: 1
  };

  // Telemetry Chart variables 
  let flightChartInstance = null;
  let chartTimeData = [];
  let chartAltData = [];
  let chartThrustData = [];
  let lastChartUpdateTime = -999.0;

  const standState = {
    T_motor: 25.0,
    T_esc: 25.0,
    burnTimer: 0.0,
    cutPower: false,
    throttlePct: 0.0
  };

  window.VLAB.resetStand = function () {
    standState.T_motor = 25.0;
    standState.T_esc = 25.0;
    standState.burnTimer = 0.0;
    standState.cutPower = false;
    standState.throttlePct = 0.0;
    if (window.DroneModel) {
      window.DroneModel.setBurnState(false);
    }
    const aeroSlider = document.getElementById('aeroThrottleSlider');
    if (aeroSlider) {
      aeroSlider.value = 0;
      const valText = document.getElementById('aeroThrottleValue');
      if (valText) valText.textContent = '0%';
    }
  };

  window.VLAB.tickStand = function (dt) {
    if (VLAB.currentTab !== 2) return;
    
    const sel = VLAB.state.selections;
    if (!sel.motor || !sel.propeller || !sel.battery || !sel.esc) return;

    dt = Math.min(dt, 0.03); // Cap dt

    const throttleVal = standState.throttlePct / 100.0;
    const nominalV = sel.battery.voltage_nominal_v;
    const propD = sel.propeller.diameter_m;
    const rho = VLAB.state.rho;

    // If burnt out, applied voltage is 0
    const appliedV = standState.cutPower ? 0.0 : throttleVal * nominalV;

    // Solve operating point
    const op = Calc.solveOperatingPoint(sel.motor, appliedV, propD, rho);
    const current_a = op ? op.current_a : 0.0;
    const power_elec_w = op ? op.power_elec_w : 0.0;
    const rpm = op ? op.rpm : 0.0;
    const thrust_n = op ? op.thrust_n : 0.0;
    const reqThrust = VLAB.state.computed.T_required || 0.0;

    // Thermal model
    const P_loss_motor = op ? Math.max(0, op.power_elec_w - op.power_mech_w) : 0.0;
    
    // Motor constants
    const m_motor_g = sel.motor.mass_g || 50.0;
    const m_motor = m_motor_g / 1000.0;
    const c_copper = 385.0;
    const h_motor_A = 0.18; // Lower convection on stand due to static airflow
    const T_amb = 25.0;

    const dT_motor = (P_loss_motor - h_motor_A * (standState.T_motor - T_amb)) / (m_motor * c_copper);
    standState.T_motor += dT_motor * dt;

    // ESC constants
    const esc_limit = sel.esc.current_a || 30.0;
    const R_DSon = 0.004;
    const C_th_esc = 2.5;
    const h_esc = 0.08; // Lower convection on stand

    let P_loss_esc = current_a * current_a * R_DSon;
    if (current_a > esc_limit) {
      const overcurrent_ratio = current_a / esc_limit;
      P_loss_esc *= (overcurrent_ratio * overcurrent_ratio);
    }

    const dT_esc = (P_loss_esc - h_esc * (standState.T_esc - T_amb)) / C_th_esc;
    standState.T_esc += dT_esc * dt;

    standState.T_motor = Math.min(250.0, Math.max(25.0, standState.T_motor));
    standState.T_esc = Math.min(180.0, Math.max(25.0, standState.T_esc));

    // Overheat detection
    const isOverheat = standState.T_motor > 150.0 || standState.T_esc > 110.0;
    if (isOverheat && !standState.cutPower) {
      if (window.DroneModel) {
        window.DroneModel.setBurnState(true);
      }
      standState.burnTimer += dt;
      if (standState.burnTimer >= 3.0) {
        standState.cutPower = true;
      }
    }

    // Update 3D display & HUD elements
    let statusText = 'OK';
    if (standState.cutPower) {
      statusText = 'BURN!';
    } else if (isOverheat) {
      statusText = 'OVERHEAT!';
    } else if (!op) {
      statusText = 'STALL';
    }

    if (window.DroneModel) {
      window.DroneModel.setSimRPM(standState.cutPower ? 0 : rpm);
      window.DroneModel.updateThrustStandDisplay(thrust_n, reqThrust, standState.cutPower ? 0 : rpm, statusText);
    }

    // Update HUD overlay text
    const standThrust = document.getElementById('standHudMeasured');
    const standReq = document.getElementById('standHudRequired');
    const standRPM = document.getElementById('standHudRPM');
    const standCurrent = document.getElementById('standHudCurrent');
    const standStatus = document.getElementById('standHudStatus');

    if (standThrust) standThrust.textContent = standState.cutPower ? 'BURNED / 0.0 N' : (!op ? 'STALL / 0.0 N' : thrust_n.toFixed(4) + ' N');
    if (standReq) standReq.textContent = reqThrust.toFixed(4) + ' N';
    if (standRPM) standRPM.textContent = (standState.cutPower ? 0 : Math.round(rpm)) + ' RPM';
    if (standCurrent) standCurrent.textContent = (standState.cutPower ? 0.0 : current_a).toFixed(1) + ' A';
    
    if (standStatus) {
      if (standState.cutPower) {
        standStatus.textContent = 'SYSTEM BURNT!';
        standStatus.style.color = '#ef4444';
        if (window.updateLiveCommentary) window.updateLiveCommentary('ESC BURNT OUT! The motor drew more current than the Electronic Speed Controller could safely handle, resulting in catastrophic failure.');
      } else if (isOverheat) {
        const temp = Math.max(standState.T_motor, standState.T_esc);
        standStatus.textContent = `OVERHEAT: ${Math.round(temp)}°C`;
        standStatus.style.color = '#ef4444';
        if (window.updateLiveCommentary) window.updateLiveCommentary('WARNING: The motor has exceeded safe operating temperatures! The copper windings and magnets are at extreme risk of permanent damage.');
      } else if (!op) {
        standStatus.textContent = 'MOTOR STALL!';
        standStatus.style.color = '#ef4444';
        if (window.updateLiveCommentary) window.updateLiveCommentary('MOTOR STALL: The propeller is too heavy or large for this motor to spin at the requested voltage.');
      } else if (current_a > sel.motor.max_current_a || current_a > esc_limit) {
        standStatus.textContent = 'WARN: OVERCURRENT';
        standStatus.style.color = '#f59e0b';
        if (window.updateLiveCommentary) window.updateLiveCommentary(`OVERCURRENT: Drawing ${current_a.toFixed(1)} Amps, which exceeds the rated limits. Prolonged operation will cause overheating.`);
      } else {
        const maxTemp = Math.max(standState.T_motor, standState.T_esc);
        standStatus.textContent = `${Math.round(maxTemp)}°C / OK`;
        standStatus.style.color = '#10b981';
        if (window.updateLiveCommentary) {
          if (standState.throttlePct <= 0) {
            window.updateLiveCommentary('GUIDE: Adjust the Thrust Stand Throttle slider below. Notice how increasing throttle applies more voltage to the motor, making the propeller spin faster to generate Aerodynamic Thrust.');
          } else {
            window.updateLiveCommentary(`OBSERVE: At ${standState.throttlePct.toFixed(0)}% throttle, the motor draws ${current_a.toFixed(1)} Amps to spin the propeller. This generates ${thrust_n.toFixed(2)} Newtons of thrust. Watch the System Temp - if it gets too hot, lower the throttle!`);
          }
        }
      }
    }

    // Update right panel display and calculations (only the live math equation)
    const calcB_eval = document.getElementById('calcB_eval');
    if (op) {
      if (calcB_eval) {
        const rps = rpm / 60.0;
        calcB_eval.innerHTML =
          'T_aero = ' + Calc.Ct.toFixed(5) + ' &times; ' + rho.toFixed(4) + ' kg/m&sup3; &times; (' +
          rps.toFixed(1) + ' rps)&sup2; &times; (' + propD.toFixed(4) + ' m)<sup>4</sup> = ' + thrust_n.toFixed(4) + ' N';
      }
    } else {
      if (calcB_eval) calcB_eval.innerHTML = standState.cutPower ? 'ESC Burnt Out!' : 'Motor Stalled';
    }
  };

  document.addEventListener('DOMContentLoaded', function () {
    
    // Check if Module 1 was completed previously to show Resume button
    if (localStorage.getItem('vlabModule1')) {
      const resumeBtn = document.getElementById('resumeModule2Container');
      if (resumeBtn) resumeBtn.style.display = 'block';
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

    // Load hardware database 
    fetch('db/db.json')
      .then(function (response) {
        if (!response.ok) {
          throw new Error('Database load failed: ' + response.status);
        }
        return response.json();
      })
      .then(function (db) {
        VLAB.db = db;
        UI.buildFromDB(db);
        Scene.init();
        Scene.resize();
        _switchTab(1); // Set tab 1 active initially
      })
      .catch(function (error) {
        console.error('[VLAB] Initialisation error:', error);
        _showViewportError('Critical component database load error. Please check local server connectivity.');
      });

    // Window resize handler 
    window.addEventListener('resize', function () {
      Scene.resize();
    });

    // Tab Switch Bindings 
    document.getElementById('tabAssembleBtn').addEventListener('click', function () {
      _switchTab(1);
    });

    document.getElementById('tabAeroBtn').addEventListener('click', function (e) {
      const computed = VLAB.state.computed;
      if (!computed || !computed.margin) {
        e.preventDefault();
        _showInlineWarning('Assemble and finalize your drone first!');
        return;
      }
      _switchTab(2);
    });

    document.getElementById('tabHoverBtn').addEventListener('click', function (e) {
      const computed = VLAB.state.computed;
      if (!computed || !computed.margin) {
        e.preventDefault();
        _showInlineWarning('Assemble and finalize your drone first!');
        return;
      }
      _switchTab(3);
    });

    // Finalize Assembly click 
    document.getElementById('btnFinalizeAssembly').addEventListener('click', function () {
      _executeAerodynamicPipeline();

      // Save data for Module 2 handoff in a compressed schema to minimize localStorage footprint
      const compactState = {
        fId: VLAB.state.selections.frame ? VLAB.state.selections.frame.id : null,
        mId: VLAB.state.selections.motor ? VLAB.state.selections.motor.id : null,
        pId: VLAB.state.selections.propeller ? VLAB.state.selections.propeller.id : null,
        bId: VLAB.state.selections.battery ? VLAB.state.selections.battery.id : null,
        eId: VLAB.state.selections.esc ? VLAB.state.selections.esc.id : null,
        fcId: VLAB.state.selections.flight_controller ? VLAB.state.selections.flight_controller.id : null,
        rId: VLAB.state.selections.receiver ? VLAB.state.selections.receiver.id : null,
        pldIds: (VLAB.state.selections.payloads || []).map(p => p.id),
        T_req: VLAB.state.computed.T_required,
        alt: VLAB.state.altitude_m,
        rho: VLAB.state.rho
      };
      localStorage.setItem('vlabModule1', JSON.stringify(compactState));

      // Enable the test tabs
      document.getElementById('tabAeroBtn').disabled = false;
      document.getElementById('tabHoverBtn').disabled = false;

      // Automatically collapse the system parameters to save space
      const configSections = document.getElementById('configSections');
      const configPanelChevron = document.getElementById('configPanelChevron');
      if (configSections && configPanelChevron) {
        configSections.style.display = 'none';
        configPanelChevron.style.transform = 'rotate(-180deg)';
      }

      // Switch to Tab 2
      _switchTab(2);
    });

    // Tab 2: Aerodynamic Test slider 
    const aeroSlider = document.getElementById('aeroThrottleSlider');
    const aeroValText = document.getElementById('aeroThrottleValue');
    if (aeroSlider) {
      aeroSlider.addEventListener('input', function () {
        const val = parseInt(aeroSlider.value, 10);
        if (aeroValText) aeroValText.textContent = val + '%';
        _updateAeroBenchTest(val);
      });
    }

    // Tab 3: Play/Pause button 
    document.getElementById('btnPlay').addEventListener('click', function () {
      if (FlightSim.isRunning()) {
        FlightSim.stop();
        const isManualMode = document.getElementById('btnModeManual').classList.contains('active');
        this.textContent = isManualMode ? 'Resume Flight' : 'Resume Hover';
      } else {
        const config = _assembleSimulationConfig();
        if (!config) return;
        const isManualMode = document.getElementById('btnModeManual').classList.contains('active');
        FlightSim.start(config, isManualMode ? 'manual' : 'auto');
        this.textContent = 'Pause';
      }
    });

    // Tab 3: Reset button 
    document.getElementById('btnReset').addEventListener('click', function () {
      FlightSim.reset();
      const isManualMode = document.getElementById('btnModeManual').classList.contains('active');
      document.getElementById('btnPlay').textContent = isManualMode ? 'Start Flight' : 'Start Hover';
      resetFlightTelemetryChart();
      
      // Reset manual throttle slider and text to 0
      const hoverSlider = document.getElementById('hoverThrottleSlider');
      if (hoverSlider) {
        hoverSlider.value = 0;
        document.getElementById('hoverThrottleValue').textContent = '0%';
        FlightSim.setManualThrottle(0);
      }
    });

    // Tab 3: Flight Mode Selection buttons 
    const btnAuto = document.getElementById('btnModeAuto');
    const btnManual = document.getElementById('btnModeManual');
    const manualControls = document.getElementById('manualFlightControls');
    const playBtn = document.getElementById('btnPlay');

    if (btnAuto && btnManual) {
      btnAuto.addEventListener('click', function () {
        if (FlightSim.isRunning()) return; // Prevent changing mode while running
        btnAuto.classList.add('active');
        btnManual.classList.remove('active');
        if (manualControls) manualControls.style.display = 'none';
        playBtn.textContent = 'Start Hover';
        FlightSim.reset();
      });

      btnManual.addEventListener('click', function () {
        if (FlightSim.isRunning()) return; // Prevent changing mode while running
        btnManual.classList.add('active');
        btnAuto.classList.remove('active');
        if (manualControls) manualControls.style.display = 'flex';
        playBtn.textContent = 'Start Flight';
        FlightSim.reset();
        _updateManualHoverGuide();
      });
    }

    // Tab 3: Manual Throttle slider 
    const hoverSlider = document.getElementById('hoverThrottleSlider');
    const hoverValText = document.getElementById('hoverThrottleValue');
    if (hoverSlider) {
      hoverSlider.addEventListener('input', function () {
        const val = parseInt(hoverSlider.value, 10);
        if (hoverValText) hoverValText.textContent = val + '%';
        FlightSim.setManualThrottle(val);
      });
    }

  });

  // Run the aerospace mathematical analysis pipeline.
  function _executeAerodynamicPipeline() {
    const sel = VLAB.state.selections;

    if (!sel.frame || !sel.motor || !sel.propeller || !sel.battery ||
        !sel.esc || !sel.flight_controller || !sel.receiver) {
      return;
    }

    /* 1. Compile Mass Budget */
    const budget = Calc.massBudget(sel);
    VLAB.state.mass_budget = budget;
    UI.showMassBudget(budget);

    const mass_kg = budget.total_kg;
    const rho = VLAB.state.rho;
    const propD = sel.propeller.diameter_m;
    const nominalV = sel.battery.voltage_nominal_v;

    /* 2. Solve Required Hover Thrust */
    const T_req = Calc.requiredHoverThrust(mass_kg);
    VLAB.state.computed.T_required = T_req;

    /* 3. Determine Motor Operating Point under Load */
    const op = Calc.solveOperatingPoint(sel.motor, nominalV, propD, rho);
    VLAB.state.computed.op_point = op;

    if (!op) {
      _showInlineWarning('Operational mismatch: Motor will stall under this propeller load at nominal voltage.');
      return;
    }

    /* 4. Determine Actual Max Aerodynamic Thrust */
    const n_rps = op.rpm / 60.0;
    const T_aero = Calc.aerodynamicThrust(n_rps, propD, rho);
    VLAB.state.computed.T_aero = T_aero;

    /* 5. Check Propulsion Authority Margin */
    const margin = Calc.propulsionMargin(T_req, T_aero);
    VLAB.state.computed.margin = margin;

    /* 6. Solve Usable Flight Time */
    const flightTime = Calc.hoverFlightTime(sel.battery, sel.motor, T_req, propD, rho);
    VLAB.state.computed.flight_time = flightTime;

    /* Set RPM feedback to visual model */
    if (window.DroneModel) {
      window.DroneModel.setSimRPM(op.rpm * 0.1); // Idle spin visual on bench
      window.DroneModel.updateThrustStandDisplay(0.0, T_req, 0.0, 'READY');
    }

    /* Update Viewport results and sweep chart */
    UI.showCalcResults({
      mass_kg:      mass_kg,
      rho:          rho,
      T_required_n: T_req,
      T_aero_n:     T_aero,
      op_point:     op,
      margin:       margin,
      flight_time:  flightTime,
      sel:          sel
    });

    const sweepDiameters = [0.1270, 0.1778, 0.2540, 0.3302, 0.4064]; // 5 to 16 inch sweep
    const targetRPM = op ? op.rpm : 6000;
    const sweepData = Calc.thrustSweep(targetRPM, rho, sweepDiameters);
    UI.showThrustChart(sweepData, T_req, targetRPM);
  }

  function _updateAeroBenchTest(throttleValPct) {
    standState.throttlePct = throttleValPct;
  }

  // Package state variables for the physics clock.
  function _assembleSimulationConfig() {
    const computed = VLAB.state.computed;
    const sel = VLAB.state.selections;

    if (!computed.T_required || !sel.battery || !sel.propeller) {
      return null;
    }

    const energyTotalJ = (sel.battery.capacity_mah / 1000.0) * sel.battery.voltage_nominal_v * 3600.0;

    return {
      motor:       sel.motor,
      propeller:   sel.propeller,
      battery:     sel.battery,
      esc:         sel.esc,
      frame:       sel.frame,
      rho:         VLAB.state.rho,
      M_kg:        VLAB.state.mass_budget.total_kg,
      T_hover_n:   computed.T_required,
      hover_rpm:   computed.op_point ? computed.op_point.rpm : 1000.0,
      E_total_j:   energyTotalJ,
      V_batt:      sel.battery.voltage_nominal_v
    };
  }

  function _updateManualHoverGuide() {
    const sel = VLAB.state.selections;
    const computed = VLAB.state.computed;
    if (!sel.motor || !sel.battery || !sel.propeller || !computed.T_required) return;

    const u_hover = Calc.solveHoverThrottle(
      sel.motor,
      sel.battery.voltage_nominal_v,
      sel.propeller.diameter_m,
      VLAB.state.rho,
      computed.T_required
    );
    const pct = Math.round(u_hover * 100);
    const guide = document.getElementById('hoverThrottleGuide');
    if (guide) {
      guide.textContent = '(Hover: ' + pct + '%)';
    }
  }

  // Handles Tab Swaps.
  function _switchTab(tabNum) {
    VLAB.currentTab = tabNum;
    Scene.setTab(tabNum);

    // Toggle active class on all tab buttons
    document.getElementById('tabAssembleBtn').classList.toggle('active', tabNum === 1);
    document.getElementById('tabAeroBtn').classList.toggle('active', tabNum === 2);
    document.getElementById('tabHoverBtn').classList.toggle('active', tabNum === 3);

    document.getElementById('tabAssembleBtn').setAttribute('aria-selected', tabNum === 1 ? 'true' : 'false');
    document.getElementById('tabAeroBtn').setAttribute('aria-selected', tabNum === 2 ? 'true' : 'false');
    document.getElementById('tabHoverBtn').setAttribute('aria-selected', tabNum === 3 ? 'true' : 'false');

    const simControls = document.getElementById('simControls');
    const simHud = document.getElementById('simHud');
    const aeroControls = document.getElementById('aeroControls');
    const standHud = document.getElementById('standHudOverlay');
    const assembleChecklist = document.getElementById('assembleChecklistSection');
    const resultsSection = document.getElementById('resultsSection');
    const commentaryPanel = document.getElementById('liveCommentaryPanel');

    // Reset controls state
    if (aeroControls) aeroControls.style.display = 'none';
    if (standHud) standHud.style.display = 'none';
    if (simControls) simControls.style.display = 'none';
    if (simHud) simHud.style.display = 'none';
    if (commentaryPanel) commentaryPanel.style.display = 'none';

    // Stop flight sim when leaving Tab 3
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
      _updateAeroBenchTest(0);
    } else if (tabNum === 3) {
      if (assembleChecklist) assembleChecklist.style.display = 'none';
      if (resultsSection) resultsSection.style.display = 'block';
      if (simControls) simControls.style.display = 'flex';
      if (simHud) simHud.style.display = 'block';
      if (commentaryPanel) commentaryPanel.style.display = 'flex';

      // Setup flight chart
      document.getElementById('flightChartContainer').style.display = 'block';
      document.getElementById('thrustChartContainer').style.display = 'none';
      initFlightTelemetryChart();

      // Setup default button labels
      const isManualMode = document.getElementById('btnModeManual').classList.contains('active');
      document.getElementById('btnPlay').textContent = isManualMode ? 'Start Flight' : 'Start Hover';
      
      // Update manual hover guide
      _updateManualHoverGuide();

      FlightSim.reset();

      // Reset manual throttle slider and text to 0
      const hoverSlider = document.getElementById('hoverThrottleSlider');
      if (hoverSlider) {
        hoverSlider.value = 0;
        document.getElementById('hoverThrottleValue').textContent = '0%';
        FlightSim.setManualThrottle(0);
      }
    }

    // Force resize to fix viewport aspect ratio after layout changes
    if (window.Scene && window.Scene.resize) {
      window.Scene.resize();
    }
  }

  function _showViewportError(msg) {
    const wrapper = document.getElementById('canvasWrapper');
    if (!wrapper) return;
    wrapper.innerHTML =
      '<div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); padding: 20px; text-align: center; max-width: 280px; background: white; border: 1px solid var(--border); border-radius: var(--radius);">' +
        '<p style="color: #ef4444; font-weight: 600; margin-bottom: 4px;">Initialisation Error</p>' +
        '<p style="color: #6b7280; font-size: 0.75rem; line-height: 1.5;">' + msg + '</p>' +
      '</div>';
  }

  function _showInlineWarning(msg) {
    const existing = document.getElementById('inlineWarningBanner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.id = 'inlineWarningBanner';
    banner.style.cssText =
      'margin: 10px 0; padding: 8px 10px; background: #fef3c7; border: 1px solid #f59e0b; ' +
      'border-radius: 4px; font-size: 0.72rem; color: #b45309; line-height: 1.4;';
    banner.textContent = msg;

    const finalizeBtn = document.getElementById('btnFinalizeAssembly');
    if (finalizeBtn) {
      finalizeBtn.parentNode.insertBefore(banner, finalizeBtn.nextSibling);
    }

    setTimeout(function () {
      banner.remove();
    }, 4000);
  }

  // Flight Telemetry Chart functions 
  function initFlightTelemetryChart() {
    const canvas = document.getElementById('flightChart');
    if (!canvas) return;

    if (flightChartInstance) {
      flightChartInstance.destroy();
      flightChartInstance = null;
    }

    chartTimeData = [];
    chartAltData = [];
    chartThrustData = [];
    lastChartUpdateTime = -999.0;

    flightChartInstance = new Chart(canvas, {
      type: 'line',
      data: {
        labels: chartTimeData,
        datasets: [
          {
            label: 'Altitude (m)',
            data: chartAltData,
            borderColor: '#2563eb',
            backgroundColor: 'rgba(37, 99, 235, 0.05)',
            borderWidth: 2,
            pointRadius: 0,
            yAxisID: 'y'
          },
          {
            label: 'Total Thrust (N)',
            data: chartThrustData,
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
            title: { display: true, text: 'Sim Time (s)', font: { family: 'Inter', size: 9 } },
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
    if (!flightChartInstance) return;
    
    // Throttle chart updates to every 1 second of simulation time
    if (time - lastChartUpdateTime < 1.0) return;
    lastChartUpdateTime = time;

    chartTimeData.push(Math.round(time));
    chartAltData.push(alt);
    chartThrustData.push(thrust);

    // Limit removed as requested: telemetry graphs now show from the start plot.
    // if (chartTimeData.length > 60) {
    //   chartTimeData.shift();
    //   chartAltData.shift();
    //   chartThrustData.shift();
    // }

    flightChartInstance.update('none'); // Update without animation for performance
  };

  function resetFlightTelemetryChart() {
    initFlightTelemetryChart();
  }

})();

  window.updateLiveCommentary = function (text) {
    const el = document.getElementById('liveCommentaryText');
    if (el) el.textContent = text;
  };
