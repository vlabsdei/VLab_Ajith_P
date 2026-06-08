// flight_sim.js — Physics-based hover simulation engine.
// Models vertical dynamics (takeoff, hover, descent, ground effect, drag),
// battery voltage sag, depletion, and motor/ESC thermal limits.

window.FlightSim = (function () {
  'use strict';

  const N_MOTORS            = 4;
  const g                   = 9.80665;
  const TARGET_ALTITUDE     = 2.00;    // m
  const GROUND_STANDOFF     = 0.10;    // m (landing gear height)
  const FF_FACTOR           = 60;      // Time fast-forward multiplier for auto hover duration
  const SAFE_BATTERY_PCT    = 20.0;    // Trigger landing below this threshold
  const WARNING_BATTERY_PCT = 25.0;    // Yellow visual state trigger
  const KP                  = 2.80;    // altitude PD — proportional
  const KD                  = 1.90;    // altitude PD — derivative

  let config = null;
  let flightPhase = 'PREFLIGHT'; // 'PREFLIGHT', 'TAKEOFF', 'HOVER', 'DESCENT', 'LANDED', 'MANUAL'
  let flightMode = 'auto'; // 'auto' or 'manual'
  let y = GROUND_STANDOFF;
  let vy = 0.0;
  let simTime = 0.0;
  let energyRemaining = 0.0;
  let energyTotal = 0.0;
  let phaseDuration = 0.0;
  let active = false;

  // Failure state trackers
  let hasStalled = false;
  let hasThrustDeficit = false;
  let hasOvercurrent = false;
  let burnTimer = 0.0;
  let cutPower = false;
  let T_motor = 25.0; // °C
  let T_esc = 25.0;   // °C
  let I_total_last = 0.0;

  // Input state
  let manualThrottle = 0.0; // [0, 100]

  function start(cfg, mode) {
    config = cfg;
    flightMode = mode || 'auto';
    y = GROUND_STANDOFF;
    vy = 0.0;
    simTime = 0.0;
    energyRemaining = cfg.E_total_j;
    energyTotal = cfg.E_total_j;
    phaseDuration = 0.0;
    active = true;

    // Reset failure states
    hasStalled = false;
    hasThrustDeficit = false;
    hasOvercurrent = false;
    burnTimer = 0.0;
    cutPower = false;
    T_motor = 25.0;
    T_esc = 25.0;
    I_total_last = 0.0;

    if (window.DroneModel) {
      window.DroneModel.setBurnState(false);
      const drone = window.DroneModel.getDroneGroup();
      if (drone) {
        drone.position.y = GROUND_STANDOFF;
      }
    }

    flightPhase = 'PREFLIGHT';

    // Solve operating point at max throttle to check for initial stall or thrust deficit
    const op_max = Calc.solveOperatingPoint(cfg.motor, cfg.V_batt, cfg.propeller.diameter_m, cfg.rho);
    if (!op_max) {
      hasStalled = true;
    } else {
      const max_thrust = op_max.thrust_n * N_MOTORS;
      if (max_thrust < cfg.M_kg * g) {
        hasThrustDeficit = true;
      }
    }

    syncHUD();
  }

  function stop() {
    active = false;
  }

  function reset() {
    stop();
    flightPhase = 'PREFLIGHT';
    y = GROUND_STANDOFF;
    vy = 0.0;
    simTime = 0.0;
    phaseDuration = 0.0;
    energyRemaining = config ? config.E_total_j : 0;
    energyTotal = config ? config.E_total_j : 0;
    T_motor = 25.0;
    T_esc = 25.0;
    burnTimer = 0.0;
    cutPower = false;
    hasStalled = false;
    hasThrustDeficit = false;
    hasOvercurrent = false;
    I_total_last = 0.0;

    const drone = window.DroneModel.getDroneGroup();
    if (drone) {
      drone.position.y = GROUND_STANDOFF;
    }
    window.DroneModel.setSimRPM(0);
    window.DroneModel.setBurnState(false);

    /* Reset camera target and position to defaults in Tab 3 */
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
    hideTimeBadge();
    document.getElementById('btnPlay').textContent = (flightMode === 'manual') ? 'Start Flight' : 'Start Hover';
  }

  function isRunning() {
    return active;
  }

  function setManualThrottle(val) {
    manualThrottle = val;
  }

  function tick(dt) {
    if (!active || !config) return;

    dt = Math.min(dt, 0.03); // Cap step size to avoid numerical instability

    const isManual = (flightMode === 'manual');

    // Determine if manual mode is in a stable hover
    let isStableHover = false;
    if (isManual && flightPhase === 'MANUAL') {
      const targetAltitude = GROUND_STANDOFF + (4.0 - GROUND_STANDOFF) * (manualThrottle / 100.0);
      if (Math.abs(targetAltitude - y) < 0.05 && Math.abs(vy) < 0.05) {
        isStableHover = true;
      }
    }

    // Speed multiplier: 1x during overheat/burn, preflight, takeoff, descent
    // 60x during stable hover (both auto and manual)
    let speedMultiplier = 1.0;
    if (!hasOvercurrent && !cutPower) {
      if (flightPhase === 'HOVER' || isStableHover) {
        speedMultiplier = FF_FACTOR;
      }
    }

    const dt_accelerated = dt * speedMultiplier;

    // Run physics sub-stepping loop to ensure integration stability
    const subStepDt = 0.005; // 5ms steps
    const steps = Math.ceil(dt_accelerated / subStepDt);
    const dt_step = dt_accelerated / steps;

    const cells = config.battery.cells;
    const motor = config.motor;
    const propeller = config.propeller;
    const rho = config.rho;
    const M_kg = config.M_kg;
    const frame = config.frame;

    // Solve open-circuit voltage and internal resistance once per frame for the sub-stepping loop
    const soc_start = energyTotal > 0 ? energyRemaining / energyTotal : 1.0;
    const V_oc_start = cells * (3.5 + 0.7 * soc_start);
    const R_batt = cells * 0.008;
    const V_batt_current = Math.max(cells * 3.0, V_oc_start - I_total_last * R_batt);

    // Pre-calculate max thrust at current voltage to represent physical limit in sub-steps
    const op_max = Calc.solveOperatingPoint(motor, V_batt_current, propeller.diameter_m, rho);
    const T_max = op_max ? op_max.thrust_n : 0.0;

    let thrust = 0.0;

    for (let step = 0; step < steps; step++) {
      // Determine target thrust per motor
      if (cutPower || hasStalled) {
        thrust = 0.0;
      } else if (flightPhase === 'PREFLIGHT') {
        phaseDuration += dt_step;
        // Rotor spinup thrust
        thrust = config.T_hover_n * 0.18 * Math.min(phaseDuration / 1.5, 1.0);
        if (phaseDuration >= 1.5) {
          phaseDuration = 0.0;
          flightPhase = isManual ? 'MANUAL' : 'TAKEOFF';
        }
      } else if (isManual && flightPhase === 'MANUAL') {
        if (manualThrottle <= 1.0) {
          thrust = config.T_hover_n * 0.18; // Keep propellers spinning (idle thrust)
        } else {
          // Command target altitude: from 0.1m (at 0%) to 4.0m (at 100%)
          const targetAltitude = GROUND_STANDOFF + (4.0 - GROUND_STANDOFF) * (manualThrottle / 100.0);
          const altError = targetAltitude - y;
          const ctrlThrust = config.T_hover_n + KP * altError + KD * (-vy);
          thrust = Math.min(Math.max(ctrlThrust, config.T_hover_n * 0.5), config.T_hover_n * 1.5);
        }

        // Apply identical safe battery limit as Auto mode
        const est_soc = energyTotal > 0 ? (energyRemaining - (op_max ? op_max.power_elec_w * N_MOTORS : 0.0) * dt_step * step) / energyTotal : 1.0;
        if (est_soc * 100.0 <= SAFE_BATTERY_PCT) {
          phaseDuration = 0.0;
          flightPhase = 'DESCENT';
        }
      } else if (flightPhase === 'TAKEOFF') {
        phaseDuration += dt_step;
        const thrustSigmoid = Math.tanh(2.0 * phaseDuration);
        thrust = config.T_hover_n * thrustSigmoid * 1.30; // 30% climb authority
        
        if (y >= TARGET_ALTITUDE - 0.05) {
          vy = 0.0;
          y = TARGET_ALTITUDE;
          phaseDuration = 0.0;
          flightPhase = 'HOVER';
        }
      } else if (flightPhase === 'HOVER') {
        const altError = TARGET_ALTITUDE - y;
        const ctrlThrust = config.T_hover_n + KP * altError + KD * (-vy);
        thrust = Math.min(Math.max(ctrlThrust, config.T_hover_n * 0.7), config.T_hover_n * 1.4);

        const est_soc = energyTotal > 0 ? (energyRemaining - (op_max ? op_max.power_elec_w * N_MOTORS : 0.0) * dt_step * step) / energyTotal : 1.0;
        if (est_soc * 100.0 <= SAFE_BATTERY_PCT) {
          phaseDuration = 0.0;
          flightPhase = 'DESCENT';
        }
      } else if (flightPhase === 'DESCENT') {
        phaseDuration += dt_step;
        const rampDown = Math.max(0.0, Math.cos((phaseDuration / 5.0) * Math.PI * 0.5));
        thrust = config.T_hover_n * (0.7 + 0.3 * rampDown);
      } else if (flightPhase === 'POSTFLIGHT') {
        phaseDuration += dt_step;
        // Gradual spindown over 3 seconds
        const rampDown = Math.max(0.0, 1.0 - (phaseDuration / 3.0));
        thrust = config.T_hover_n * 0.18 * rampDown;
      }

      // Clamp thrust to physical max thrust of the motor
      thrust = Math.min(thrust, T_max);

      // Physics: apply forces
      let actualThrust = thrust;

      // Cheeseman & Bennett ground effect model
      const standoffDist = Math.max(y - GROUND_STANDOFF, propeller.diameter_m * 0.25);
      const geTerm = propeller.diameter_m / (4.0 * standoffDist);
      if (geTerm < 0.99) {
        const geMultiplier = Math.min(1.0 / (1.0 - geTerm * geTerm), 1.75);
        actualThrust *= geMultiplier;
      }

      // Rotor inflow velocity damping (aerodynamic lift reduction in climb)
      const diskArea = Math.PI * 0.25 * propeller.diameter_m * propeller.diameter_m;
      const v_induced = Math.sqrt(Math.max(0.1, actualThrust) / (2.0 * rho * diskArea));
      const inflowRatio = vy / v_induced;
      const thrustDamping = Math.max(0.2, 1.0 - 0.45 * inflowRatio);
      actualThrust *= thrustDamping;

      // Body Drag opposing motion
      let CdA = 0.007; // default fallback for 450mm frame
      if (frame && frame.body_size_mm && frame.body_size_mm.length >= 3) {
        const w = frame.body_size_mm[0] / 1000.0;
        const l = frame.body_size_mm[2] / 1000.0;
        CdA = w * l; // C_d = 1.0, Area = w * l
      }
      const F_drag = 0.5 * rho * CdA * vy * Math.abs(vy);
      const netForce = actualThrust * N_MOTORS - M_kg * g - F_drag;
      const acceleration = netForce / M_kg;

      vy += acceleration * dt_step;
      vy = Math.min(Math.max(vy, -1.0), 1.0); // Keep velocity in bounds (realistic vertical speed limit)
      y += vy * dt_step;

      // Ground constraint
      if (y <= GROUND_STANDOFF) {
        y = GROUND_STANDOFF;
        vy = 0.0;
        
        const est_soc = energyTotal > 0 ? (energyRemaining - (op_max ? op_max.power_elec_w * N_MOTORS : 0.0) * dt_step * step) / energyTotal : 1.0;
        const isDead = cutPower || hasStalled || (est_soc <= 0.001);
        if (flightPhase === 'DESCENT' || isDead) {
          if (isDead) {
            flightPhase = cutPower ? 'BURNED!' : 'LANDED';
            active = false;
            if (window.DroneModel) {
              window.DroneModel.setSimRPM(0);
            }
            document.getElementById('btnPlay').textContent = (flightMode === 'manual') ? 'Start Flight' : 'Start Hover';
          } else {
            flightPhase = 'POSTFLIGHT';
            phaseDuration = 0.0;
          }
        } else if (flightPhase === 'POSTFLIGHT' && phaseDuration >= 3.0) {
          flightPhase = 'LANDED';
          active = false;
          if (window.DroneModel) {
            window.DroneModel.setSimRPM(0);
          }
          document.getElementById('btnPlay').textContent = (flightMode === 'manual') ? 'Start Flight' : 'Start Hover';
          
          const nextBtn = document.getElementById('nextModuleContainer');
          if (nextBtn) nextBtn.style.display = 'block';
        }
      }
      y = Math.min(y, 4.0); // 4m ceiling

      // Update simulation timer if airborne
      if (y > GROUND_STANDOFF + 0.01 && flightPhase !== 'LANDED') {
        simTime += dt_step;
      }
    }

    // Solve the actual motor operating point EXACTLY ONCE at the end of the frame
    // to accurately update power, current, RPM, and motor heating.
    let finalThrust = (cutPower || hasStalled) ? 0.0 : thrust;
    let u = 0.0;
    if (finalThrust > 0.0) {
      u = Calc.solveHoverThrottle(motor, V_batt_current, propeller.diameter_m, rho, finalThrust);
    }

    const op = Calc.solveOperatingPoint(motor, u * V_batt_current, propeller.diameter_m, rho);
    const current_a = op ? op.current_a : 0.0;
    const power_elec_w = op ? op.power_elec_w : 0.0;
    const rpm = op ? op.rpm : 0.0;

    // Deplete battery energy for the whole frame
    const powerDraw = power_elec_w * N_MOTORS;
    energyRemaining = Math.max(0, energyRemaining - powerDraw * dt_accelerated);
    I_total_last = current_a * N_MOTORS;

    // Thermal model updated once per frame using physical constants
    const P_loss_motor = op ? Math.max(0, op.power_elec_w - op.power_mech_w) : 0.0;
    
    // Motor constants
    const m_motor_g = (config.motor && config.motor.mass_g) ? config.motor.mass_g : 50.0;
    const m_motor = m_motor_g / 1000.0; // convert to kg
    const c_copper = 385.0; // J/(kg·°C) - specific heat of copper
    const h_motor_A = 0.25; // W/°C - convection coefficient * area
    const T_amb = 25.0; // Ambient temperature
    
    // Motor thermal rate of change: dT/dt = (P_loss - h_motor_A * (T_motor - T_amb)) / (m_motor * c_copper)
    const dT_motor = (P_loss_motor - h_motor_A * (T_motor - T_amb)) / (m_motor * c_copper);
    T_motor += dT_motor * dt_accelerated;
    
    // ESC constants
    const esc_limit = (config.esc && config.esc.current_a) ? config.esc.current_a : 30.0;
    const R_DSon = 0.004; // ohms
    const C_th_esc = 2.5; // J/°C - thermal capacitance
    const h_esc = 0.12; // W/°C - passive cooling
    
    let P_loss_esc = current_a * current_a * R_DSon;
    // Accelerate ESC heating by overcurrent ratio squared when limit is exceeded
    if (current_a > esc_limit) {
      const overcurrent_ratio = current_a / esc_limit;
      P_loss_esc *= (overcurrent_ratio * overcurrent_ratio);
    }
    
    // ESC thermal rate of change: dT/dt = (P_loss - h_esc * (T_esc - T_amb)) / C_th_esc
    const dT_esc = (P_loss_esc - h_esc * (T_esc - T_amb)) / C_th_esc;
    T_esc += dT_esc * dt_accelerated;

    T_motor = Math.min(250.0, Math.max(25.0, T_motor));
    T_esc = Math.min(180.0, Math.max(25.0, T_esc));

    const isOverheat = T_motor > 150.0 || T_esc > 110.0;
    if (isOverheat) {
      hasOvercurrent = true;
      if (window.DroneModel) {
        window.DroneModel.setBurnState(true);
      }
      burnTimer += dt_accelerated;
      if (burnTimer >= 3.0) {
        cutPower = true;
      }
    }

    // Solve final values to display on HUD
    const powerTotal = powerDraw;
    const currentEach = current_a;
    const batteryPercentage = energyTotal > 0 ? (energyRemaining / energyTotal) * 100.0 : 0.0;

    // Visual model rotation & height
    if (window.DroneModel) {
      const drone = window.DroneModel.getDroneGroup();
      if (drone) {
        drone.position.y = y;
      }
      window.DroneModel.setSimRPM(cutPower ? 0 : rpm);
    }

    // Camera tracking in Tab 3
    if (window.Scene && window.Scene.getActiveTab() === 3) {
      const cam = window.Scene.getCamera();
      const ctrl = window.Scene.getControls();
      if (cam && ctrl) {
        const targetY = y + 0.05;
        const dy = targetY - ctrl.target.y;
        ctrl.target.set(0, targetY, 0);
        cam.position.y += dy;
        ctrl.update();
      }
    }

    // HUD Text formatting
    document.getElementById('hudAlt').textContent = y.toFixed(2) + ' m';
    document.getElementById('hudTime').textContent = formatSeconds(simTime);
    document.getElementById('hudBattery').textContent = batteryPercentage.toFixed(1) + '%';
    updateBatteryFill(batteryPercentage);
    renderHUDNumbers(powerTotal, currentEach);

    // Visual badges
    if (speedMultiplier > 1.0 && !cutPower && !hasOvercurrent) {
      showTimeBadge();
    } else {
      hideTimeBadge();
    }

    // Determine status and phase text
    let phaseText = flightPhase;
    let textType = '';

    if (flightMode === 'manual') {
      phaseText = 'MANUAL';
      if (y > GROUND_STANDOFF + 0.01) {
        phaseText = 'FLIGHT';
        textType = 'success';
      }
    } else {
      if (flightPhase === 'PREFLIGHT') phaseText = 'PRE-FLIGHT';
      else if (flightPhase === 'TAKEOFF') phaseText = 'TAKEOFF';
      else if (flightPhase === 'HOVER') {
        phaseText = 'HOVERING';
        textType = 'success';
      }
      else if (flightPhase === 'DESCENT') {
        phaseText = 'DESCENT';
        textType = 'warning';
      }
      else if (flightPhase === 'LANDED') {
        phaseText = 'LANDED';
        textType = 'success';
      }
    }

    // Overrides for failures
    const isOvercurrent = op ? (op.current_a > config.motor.max_current_a) : false;

    if (cutPower) {
      phaseText = 'BURNED!';
      textType = 'danger';
    } else if (isOverheat) {
      phaseText = 'OVERHEAT!';
      textType = 'danger';
    } else if (hasStalled) {
      phaseText = 'STALLED!';
      textType = 'danger';
    } else if (hasThrustDeficit && y <= GROUND_STANDOFF + 0.001) {
      phaseText = 'THRUST DEFICIT!';
      textType = 'warning';
    } else if (batteryPercentage <= WARNING_BATTERY_PCT) {
      phaseText = 'LOW BATTERY';
      textType = 'warning';
    }

    setHUDPhaseText(phaseText, textType);

    const controlsNote = document.getElementById('simControlsNote');
    if (controlsNote) {
      if (cutPower) {
        controlsNote.textContent = 'CRITICAL: Motors burnt out due to extreme thermal load!';
        controlsNote.style.color = '#ef4444';
      } else if (isOverheat) {
        controlsNote.textContent = `WARNING: Overheat! Motor Temp: ${Math.round(T_motor)}°C (Max: 150°C). Power cut in ${(3.0 - burnTimer).toFixed(1)}s!`;
        controlsNote.style.color = '#ef4444';
      } else if (hasStalled) {
        controlsNote.textContent = 'ERROR: Motor stalled! Underpowered motor for this propeller size.';
        controlsNote.style.color = '#ef4444';
      } else if (hasThrustDeficit) {
        controlsNote.textContent = 'WARNING: Thrust deficit! Maximum thrust is less than total drone mass.';
        controlsNote.style.color = '#f59e0b';
      } else {
        const motorTemp = Math.round(T_motor);
        controlsNote.textContent = `Telemetry - Motor: ${motorTemp}°C | ESC: ${Math.round(T_esc)}°C | Mode: ${flightMode.toUpperCase()}`;
        controlsNote.style.color = 'var(--text-secondary)';
      }
    }

    // Call chart update
    if (window.updateFlightTelemetryChart) {
      window.updateFlightTelemetryChart(simTime, y, finalThrust * N_MOTORS);
    }

    // Live Educational Commentary Updates
    if (window.updateLiveCommentary) {
      if (cutPower) {
        window.updateLiveCommentary('CRITICAL FAILURE: The motor drew excessive current, generating extreme heat. The Electronic Speed Controller (ESC) or motor windings have permanently burnt out.');
      } else if (hasStalled) {
        window.updateLiveCommentary('MOTOR STALL: The motor is trying to spin a propeller that is too heavy, drawing maximum current without rotating. This converts all electrical energy into dangerous heat.');
      } else if (hasThrustDeficit && y <= GROUND_STANDOFF + 0.001) {
        window.updateLiveCommentary('THRUST DEFICIT: The motors are at 100% throttle, but the total aerodynamic thrust produced is less than the weight of the drone. It cannot lift off the ground.');
      } else if (flightMode === 'manual') {
        if (manualThrottle === 0) {
          window.updateLiveCommentary('GUIDE: Ready for takeoff. Increase the Flight Throttle slider below to apply power. Watch the thrust value increase as the motors spin up.');
        } else if (y <= GROUND_STANDOFF + 0.01) {
          window.updateLiveCommentary(`Manual Mode: Motors are at ${Math.round(manualThrottle)}% throttle. The total thrust (${(finalThrust * N_MOTORS).toFixed(1)} N) is currently LESS than the drone's weight (${(config.M_kg * 9.81).toFixed(1)} N), so it remains on the ground.`);
        } else {
          window.updateLiveCommentary(`OBSERVE: You are flying! The total aerodynamic thrust (${(finalThrust * N_MOTORS).toFixed(1)} N) is fighting against the drone's weight (${(config.M_kg * 9.81).toFixed(1)} N). If thrust is higher than weight, the drone climbs. If lower, it descends.`);
        }
      } else {
        // Auto mode phases
        if (flightPhase === 'PREFLIGHT') {
          window.updateLiveCommentary('GUIDE: The drone is armed and ready. Click the "Start Hover" button to let the Flight Controller (PID loop) attempt an automated takeoff and hover test.');
        } else if (flightPhase === 'TAKEOFF') {
          window.updateLiveCommentary(`Takeoff Phase: The flight controller commands maximum safe throttle. Total thrust (${(finalThrust * N_MOTORS).toFixed(1)} N) exceeds the weight of the drone (${(config.M_kg * 9.81).toFixed(1)} N), causing upward acceleration.`);
        } else if (flightPhase === 'HOVER') {
          window.updateLiveCommentary(`OBSERVE: The drone is hovering! The PID loop is automatically adjusting the throttle to perfectly match the drone's weight. Notice the Battery Level dropping. As Voltage drops, the controller must feed higher throttle percentages to maintain the same Thrust.`);
        } else if (flightPhase === 'DESCENT') {
          window.updateLiveCommentary(`Battery Critical (${batteryPercentage.toFixed(1)}%): Safety protocols activated. The flight controller deliberately lowers thrust just below the drone's weight, allowing gravity to pull it down safely.`);
        } else if (flightPhase === 'LANDED') {
          window.updateLiveCommentary('Landed Safely: Motors spun down. The battery was depleted, but the auto-descent prevented a crash. Test complete.');
        }
      }
    }
  }

  function syncHUD() {
    document.getElementById('hudTime').textContent = '00:00:00';
    document.getElementById('hudAlt').textContent = y.toFixed(2) + ' m';
    document.getElementById('hudBattery').textContent = '100.0%';
    document.getElementById('hudPower').textContent = '0 W';
    document.getElementById('hudCurrent').textContent = '0.0 A';
    updateBatteryFill(100);
    setHUDPhaseText(flightMode === 'manual' ? 'MANUAL' : 'PRE-FLIGHT', '');
  }

  function renderHUDNumbers(power, current) {
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

  function showTimeBadge() {
    const el = document.getElementById('ffBadge');
    if (el) el.style.display = 'inline-block';
  }

  function hideTimeBadge() {
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