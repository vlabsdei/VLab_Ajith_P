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

/* Diagonal arm vectors for X quadcopter configuration */
const ARM_DIRECTIONS = [
  new THREE.Vector3( 1, 0, -1).normalize(), // Front-Right
  new THREE.Vector3(-1, 0, -1).normalize(), // Front-Left
  new THREE.Vector3( 1, 0,  1).normalize(), // Rear-Right
  new THREE.Vector3(-1, 0,  1).normalize()  // Rear-Left
];

const PROP_SIGNS = [1, -1, -1, 1];

function getPayloadBaseOffset(id, frame) {
  const bw = frame ? frame.body_size_mm[0] : 88;
  const bz = frame ? frame.body_size_mm[2] : 88;
  switch (id) {
    case 'gimbal_2axis':
    case 'gimbal_3axis':
      return { x: 0, y: bw * 0.22 };
    case 'camera_gopro':
      return { x: 0, y: bw * 0.32 };
    case 'camera_fpv_nano':
      return { x: 0, y: bw * 0.42 };
    case 'gps_m8n':
    case 'gps_m9n_compass':
      return { x: -bw * 0.2, y: -bz * 0.2 };
    case 'lidar_tfmini':
    case 'lidar_garmin':
      return { x: 0, y: 0 };
    case 'telemetry_915':
      return { x: bw * 0.4, y: 0 };
    case 'fpv_vtx':
      return { x: 0, y: -bz * 0.38 };
    default:
      return { x: 0, y: 0 };
  }
}

// ═══════════════════════════════════════════════════════════════════
// 1. PHYSICS & ENGINEERING CALCULATION IIFE
// ═══════════════════════════════════════════════════════════════════
const Calc = (function () {
  'use strict';

  const G_ACC = 9.80665; // standard gravitational acceleration m/s^2

  return {
    g: G_ACC,

    solveCenterOfGravity: function (components) {
      let weightedSumX = 0;
      let weightedSumY = 0;
      let totalMass = 0;

      components.forEach(function (comp) {
        weightedSumX += comp.mass_g * comp.x_mm;
        weightedSumY += comp.mass_g * comp.y_mm;
        totalMass += comp.mass_g;
      });

      const x_cg = totalMass > 0 ? weightedSumX / totalMass : 0;
      const y_cg = totalMass > 0 ? weightedSumY / totalMass : 0;
      const offset = Math.sqrt(x_cg * x_cg + y_cg * y_cg);

      return {
        x_cg: x_cg,
        y_cg: y_cg,
        total_mass_g: totalMass,
        offset_mm: offset,
        sum_mx: weightedSumX,
        sum_my: weightedSumY
      };
    },

    solveHollowInertia: function (b_mm, h_mm, t_mm) {
      const b_out = b_mm / 1000;
      const h_out = h_mm / 1000;
      const b_in = (b_mm - 2.0 * t_mm) / 1000;
      const h_in = (h_mm - 2.0 * t_mm) / 1000;
      return (b_out * Math.pow(h_out, 3) - b_in * Math.pow(h_in, 3)) / 12.0;
    },

    solveBendingMoment: function (forceTip_n, armLength_mm) {
      const l = armLength_mm / 1000;
      return forceTip_n * l;
    },

    solveBendingMomentAtX: function (forceTip_n, x_mm, armLength_mm) {
      const x = x_mm / 1000;
      const L = armLength_mm / 1000;
      if (x > L) return 0;
      return forceTip_n * (L - x);
    },

    solveShearForce: function (forceTip_n) {
      return -forceTip_n;
    },

    solveBendingStress: function (moment_nm, h_mm, inertia_m4) {
      if (inertia_m4 === 0) return 0;
      const c = (h_mm / 2.0) / 1000;
      const stressPascal = (moment_nm * c) / inertia_m4;
      return stressPascal / 1e6; // to MPa
    },

    solveSafetyFactor: function (yieldStrength_mpa, appliedStress_mpa) {
      if (appliedStress_mpa <= 0) return 99.0;
      return yieldStrength_mpa / appliedStress_mpa;
    },

    solveDeflectionAtX: function (forceTip_n, x_mm, armLength_mm, youngsModulus_gpa, inertia_m4) {
      const x = x_mm / 1000;
      const L = armLength_mm / 1000;
      const E = youngsModulus_gpa * 1e9;
      const I = inertia_m4;

      if (x > L || E * I === 0) return 0;
      return (forceTip_n * x * x * (3.0 * L - x)) / (6.0 * E * I);
    },

    solveTipForce: function (motorMass_g, propMass_g, T_max_n) {
      const gravityForce = ((motorMass_g + propMass_g) / 1000) * G_ACC;
      return {
        gravity_n: gravityForce,
        thrust_n: T_max_n,
        total_n: gravityForce + T_max_n,
        gravity_pct: gravityForce / (gravityForce + T_max_n) * 100,
        thrust_pct: T_max_n / (gravityForce + T_max_n) * 100
      };
    },

    solvePerMotorThrust: function (totalMass_g, x_cg, y_cg, armLen_mm) {
      const T_hover = (totalMass_g / 1000) * G_ACC;
      const d = armLen_mm * Math.cos(Math.PI / 4);
      const w_FR = 0.25 * (1 + x_cg / d + y_cg / d);
      const w_FL = 0.25 * (1 - x_cg / d + y_cg / d);
      const w_RR = 0.25 * (1 + x_cg / d - y_cg / d);
      const w_RL = 0.25 * (1 - x_cg / d - y_cg / d);
      return {
        FR: w_FR * T_hover,
        FL: w_FL * T_hover,
        RR: w_RR * T_hover,
        RL: w_RL * T_hover,
        shares: { FR: w_FR, FL: w_FL, RR: w_RR, RL: w_RL },
        max_thrust_n: Math.max(w_FR, w_FL, w_RR, w_RL) * T_hover,
        imbalance_pct: (Math.max(w_FR, w_FL, w_RR, w_RL) - 0.25) / 0.25 * 100
      };
    },

    solveSectionModulus: function (inertia_m4, h_mm) {
      if (h_mm === 0) return 0;
      return inertia_m4 / (h_mm / 2.0 / 1000);
    },

    solveStrainEnergy: function (F, L_mm, E_gpa, I) {
      const L = L_mm / 1000;
      const E = E_gpa * 1e9;
      if (E * I === 0) return 0;
      return (F * F * L * L * L) / (6 * E * I);
    }
  };
})();
window.Calc = Calc;

// ═══════════════════════════════════════════════════════════════════
// 2. SHARED HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════
function buildSharedTileGrid(container, items, options) {
  const parent = typeof container === 'string' ? document.getElementById(container) : container;
  if (!parent) return;
  const { isMulti, selectedIds, name, idPrefix, specF, onSelect } = options || {};
  const selSet = new Set(Array.isArray(selectedIds) ? selectedIds : (selectedIds ? [selectedIds] : []));

  parent.innerHTML = items.map(item => {
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

  parent.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('change', () => {
      const item = items.find(i => i.id === inp.value);
      if (onSelect && item) onSelect(item, inp.checked);
      if (!isMulti) {
        parent.querySelectorAll('.component-tile').forEach(t => t.classList.remove('selected'));
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

  scn.add(new THREE.AmbientLight(0xffffff, options.ambientIntensity || 0.65));
  const sun = new THREE.DirectionalLight(0xffffff, options.sunIntensity || 0.95);
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

// ═══════════════════════════════════════════════════════════════════
// 3. THREE.JS SCENE COORDINATOR IIFE
// ═══════════════════════════════════════════════════════════════════
const Scene = (function () {
  'use strict';
  let _base = null;
  let _activeTab = 1;
  let _clock = null;
  let _animFrameId = null;

  function init(tabNum) {
    const canvas = document.getElementById('droneCanvas');
    const wrapper = document.getElementById('canvasWrapper');
    if (!canvas || !wrapper) return;

    _activeTab = tabNum;
    
    const wheelbase = (state.selections.frame) ? state.selections.frame.wheelbase_mm : 450;
    const H_stand = 0.06 + (wheelbase / 1000) * 0.2;
    const camPos = (tabNum === 2) ? { x: 0.42, y: 0.22, z: 0.32 } : { x: 0.50, y: H_stand + 0.25, z: 0.65 };
    const targetPos = (tabNum === 2) ? { x: 0.12, y: 0.04, z: 0 } : { x: 0, y: H_stand, z: 0 };

    _base = initBase3DScene(canvas, wrapper, {
      bgColor: 0xf3f4f6,
      fov: 45,
      camPos: camPos,
      enableShadows: true,
      ctrls: {
        minDist: 0.15,
        maxDist: 5.0,
        target: targetPos
      }
    });

    // Ground Plane
    const groundGeo = new THREE.PlaneGeometry(10, 10);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.9 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.001;
    ground.receiveShadow = true;
    _base.scn.add(ground);

    // Grid
    const grid = new THREE.GridHelper(8, 40, 0xcbd5e1, 0xe5e7eb);
    _base.scn.add(grid);

    _clock = new THREE.Clock();

    if (_animFrameId) cancelAnimationFrame(_animFrameId);
    _startLoop();
  }

  function _startLoop() {
    function tick() {
      _animFrameId = requestAnimationFrame(tick);
      const delta = _clock.getDelta();
      _base.ctrls.update();

      // Animate structures
      DroneModel.tick(delta, _activeTab);

      if (_activeTab === 1) {
        // Heatmap Caching / Performance Optimizations
        const cg = state.calculations;
        const frameId = state.selections.frame ? state.selections.frame.id : null;
        const batPosStr = JSON.stringify(state.selections.battery_pos);
        
        const needsRedraw = 
          window._lastHeatmapCgX !== cg.x_cg || 
          window._lastHeatmapCgY !== cg.y_cg ||
          window._lastHeatmapFrame !== frameId ||
          window._lastHeatmapBatPos !== batPosStr;
          
        if (needsRedraw) {
          Module1.drawHeatmap(cg.x_cg, cg.y_cg);
          window._lastHeatmapCgX = cg.x_cg;
          window._lastHeatmapCgY = cg.y_cg;
          window._lastHeatmapFrame = frameId;
          window._lastHeatmapBatPos = batPosStr;
        }
        Module1.drawVibrationGraph();
      }

      _base.rndr.render(_base.scn, _base.cam);
    }
    tick();
  }

  function resize() {
    if (_base && _base.handleResize) _base.handleResize();
  }

  function setTab(tabNum) {
    _activeTab = tabNum;
    if (_base) {
      const wheelbase = (state.selections.frame) ? state.selections.frame.wheelbase_mm : 450;
      const H_stand = 0.06 + (wheelbase / 1000) * 0.2;
      if (tabNum === 2) {
        _base.cam.position.set(0.42, 0.22, 0.32);
        _base.ctrls.target.set(0.12, 0.04, 0);
      } else {
        _base.cam.position.set(0.50, H_stand + 0.25, 0.65);
        _base.ctrls.target.set(0, H_stand, 0);
      }
      _base.ctrls.update();
    }
  }

  return {
    init,
    resize,
    setTab,
    getScene: () => _base ? _base.scn : null,
    getCamera: () => _base ? _base.cam : null,
    getRenderer: () => _base ? _base.rndr : null,
    getControls: () => _base ? _base.ctrls : null,
    getActiveTab: () => _activeTab
  };
})();
window.Scene = Scene;

// ═══════════════════════════════════════════════════════════════════
// 4. 3D DRONE MODEL BUILDER & DEFLECTOR IIFE
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

  let _lcdCnvs = null;
  let _lcdCtx = null;
  let _lcdTxtr = null;

  let _smokeParts = [];
  let _isBurning = false;
  let _spawnTmr = 0.0;

  // Exp2-specific scene variables (balancing scene)
  let chasisModel = null;   // GLB chassis model (null = use procedural geometry)
  let droneGroup = null;
  let balancingStand = null;
  let batteryMesh = null;
  let payloadMesh = null;
  let cgIndicator = null;
  let boundaryRing = null;

  // Exp2-specific scene variables (cantilever scene)
  let cantileverGroup = null;
  let beamMesh = null;
  let clampMesh = null;
  let testMotorMesh = null;
  let debrisParticles = [];
  let activeMaterial = null;
  let activeLength_mm = 250;
  let isBroken = false;
  let breakProgress = 0.0;
  let deflectionForce = 0;
  let targetForce = 0;

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

  // Alias used by exp2-specific scene functions
  // Note: exp2 passes opacity as 4th numeric arg; createMat expects an object for 'extra'
  function createMaterial(color, roughness, metalness, opacityOrExtra) {
    const extra = (typeof opacityOrExtra === 'number')
      ? { opacity: opacityOrExtra, transparent: true }
      : (opacityOrExtra || {});
    return new THREE.MeshStandardMaterial(Object.assign({
      color: color,
      roughness: roughness,
      metalness: metalness
    }, extra));
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

  function clearAllDroneGrp() {
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

  function updateFromSelections(sel) {
    ensureGroup();
    if (!_droneGrp) return;
    clearAllDroneGrp();

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
        const bellR = (motor.bell_diameter_mm / 2) / 1000;
        const bellH = motor.bell_height_mm / 1000;
        const bellGeo = new THREE.CylinderGeometry(bellR, bellR * 0.82, bellH, 20);
        const bellMat = createMat(0x1e293b, 0.3, 0.7);
        const bellMesh = new THREE.Mesh(bellGeo, bellMat);
        bellMesh.position.y = motorY + bellH / 2;
        bellMesh.castShadow = true;
        _droneGrp.add(bellMesh);

        const shaftGeo = new THREE.CylinderGeometry(0.0015, 0.0015, bellH * 1.5, 8);
        const shaftMat = createMat(0xe2e8f0, 0.15, 0.95);
        const shaftMesh = new THREE.Mesh(shaftGeo, shaftMat);
        shaftMesh.position.y = motorY + bellH * 0.75;
        _droneGrp.add(shaftMesh);

        const cClipGeo = new THREE.TorusGeometry(0.002, 0.0006, 4, 8);
        const cClipMesh = new THREE.Mesh(cClipGeo, shaftMat);
        cClipMesh.position.y = motorY + bellH + 0.001;
        cClipMesh.rotation.x = Math.PI / 2;
        _droneGrp.add(cClipMesh);

        const numHoles = 4;
        const holeGeo = new THREE.CylinderGeometry(bellR * 0.2, bellR * 0.2, 0.0006, 8);
        const holeMat = createMat(0x0f172a, 0.9, 0.0);
        for (let h = 0; h < numHoles; h++) {
          const angle = (h / numHoles) * Math.PI * 2;
          const holeMesh = new THREE.Mesh(holeGeo, holeMat);
          holeMesh.position.set(Math.cos(angle) * (bellR * 0.5), motorY + bellH + 0.0002, Math.sin(angle) * (bellR * 0.5));
          _droneGrp.add(holeMesh);
        }

        const numCoils = 12;
        const coilGeo = new THREE.CylinderGeometry(bellR * 0.12, bellR * 0.12, bellH * 0.5, 6);
        const coilMat = createMat(0xb45309, 0.2, 0.8);
        for (let c = 0; c < numCoils; c++) {
          const angle = (c / numCoils) * Math.PI * 2;
          const coilMesh = new THREE.Mesh(coilGeo, coilMat);
          coilMesh.position.set(Math.cos(angle) * (bellR * 0.52), motorY + bellH * 0.25, Math.sin(angle) * (bellR * 0.52));
          _droneGrp.add(coilMesh);
        }

        const statorCore = new THREE.Mesh(
          new THREE.CylinderGeometry(bellR * 0.4, bellR * 0.4, bellH * 0.55, 8),
          createMat(0x475569, 0.5, 0.8)
        );
        statorCore.position.y = motorY + bellH * 0.25;
        _droneGrp.add(statorCore);

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
  function rebuildScene(sel, tabNum) {
    const sc = Scene.getScene();
    if (!sc) return;

    clearAll(sc);

    if (tabNum === 1) {
      buildBalancingScene(sel, sc);
    } else if (tabNum === 2) {
      buildCantileverScene(sel, sc);
    }
  }

  function clearAll(sc) {
    if (droneGroup) { sc.remove(droneGroup); dispose(droneGroup); droneGroup = null; }
    if (balancingStand) { sc.remove(balancingStand); dispose(balancingStand); balancingStand = null; }
    if (cantileverGroup) { sc.remove(cantileverGroup); dispose(cantileverGroup); cantileverGroup = null; }
    batteryMesh = null;
    payloadMesh = null;
    cgIndicator = null;
    boundaryRing = null;
    beamMesh = null;
    clampMesh = null;
    testMotorMesh = null;
    debrisParticles = [];
  }

  function dispose(obj) {
    obj.traverse(function (child) {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
        else child.material.dispose();
      }
    });
  }

  function buildBalancingScene(sel, sc) {
    const frame = sel.frame;
    if (!frame) return;

    // Resolve a visual motor and propeller from the db based on frame wheelbase.
    // These are used for 3D rendering only — no physics impact.
    const db = window._exp2DB || {};
    const wheelbaseMm = frame.wheelbase_mm;
    let visualMotor = sel.motor || null;
    let visualProp = sel.propeller || null;
    if (!visualMotor && db.motors && db.motors.length) {
      // Pick motor whose recommended prop matches the wheelbase range
      const motorMap = { 250: '1806_2300', 330: '2207_1600', 450: '2212_920', 550: '2808_1200', 680: '3508_700', 850: '4008_380' };
      const mId = motorMap[wheelbaseMm] || db.motors[Math.floor(db.motors.length / 2)].id;
      visualMotor = db.motors.find(m => m.id === mId) || db.motors[0];
    }
    if (!visualProp && db.propellers && db.propellers.length) {
      const propMap = { 250: '5045_2b', 330: '7045_2b', 450: '1045_2b', 550: '1245_2b', 680: '1445_2b', 850: '1655_2b' };
      const pId = propMap[wheelbaseMm] || db.propellers[Math.floor(db.propellers.length / 2)].id;
      visualProp = db.propellers.find(p => p.id === pId) || db.propellers[0];
    }

    const wheelbase = frame.wheelbase_mm;
    const bw = frame.body_size_mm[0] / 1000;
    const bh = frame.body_size_mm[1] / 1000;
    const bz = frame.body_size_mm[2] / 1000;
    const plateThickness = 0.002;

    const H_stand = 0.06 + (wheelbase / 1000) * 0.2; // stand height

    droneGroup = new THREE.Group();
    droneGroup.position.set(0, H_stand, 0);
    sc.add(droneGroup);

    balancingStand = new THREE.Group();
    sc.add(balancingStand);

    const baseGeo = new THREE.CylinderGeometry(0.08, 0.09, 0.008, 24);
    const baseMesh = new THREE.Mesh(baseGeo, createMaterial(0x1e293b, 0.6, 0.2));
    baseMesh.position.y = 0.004;
    baseMesh.receiveShadow = true;
    balancingStand.add(baseMesh);

    const rodGeo = new THREE.CylinderGeometry(0.001, 0.008, H_stand, 16);
    const rodMesh = new THREE.Mesh(rodGeo, createMaterial(0x64748b, 0.45, 0.6));
    rodMesh.position.y = H_stand / 2;
    rodMesh.castShadow = true;
    balancingStand.add(rodMesh);

    const ballGeo = new THREE.SphereGeometry(0.002, 8, 8);
    const ballMesh = new THREE.Mesh(ballGeo, createMaterial(0xe2e8f0, 0.15, 0.95));
    ballMesh.position.y = H_stand;
    balancingStand.add(ballMesh);

    const frameMat = createMaterial(hexToInt(frame.color_hex), frame.roughness, frame.metalness);

    if (chasisModel) {
      const chasisInstance = chasisModel.clone();
      
      const box = new THREE.Box3().setFromObject(chasisInstance);
      const size = new THREE.Vector3();
      box.getSize(size);
      
      const modelWheelbase = Math.max(size.x, size.z) || 1.0;
      const targetWheelbase = wheelbase / 1000;
      const scale = targetWheelbase / modelWheelbase;
      
      chasisInstance.scale.set(scale, scale, scale);
      
      const center = new THREE.Vector3();
      box.getCenter(center);
      chasisInstance.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
      
      chasisInstance.traverse(c => {
        if (c.isMesh) {
          c.castShadow = true;
          c.receiveShadow = true;
          if (c.material) {
            c.material = frameMat;
          }
        }
      });
      droneGroup.add(chasisInstance);
    } else {
      // Bottom plate � rounded extrusion to match exp1
      const extrudeSettings = {
        steps: 1,
        depth: plateThickness,
        bevelEnabled: true,
        bevelThickness: 0.0005,
        bevelSize: 0.0005,
        bevelOffset: 0,
        bevelSegments: 2
      };
      const bottomPlateShape = createRoundedRectShape(bw, bz, Math.min(bw, bz) * 0.12);
      const bottomPlateGeo = new THREE.ExtrudeGeometry(bottomPlateShape, extrudeSettings);
      const bottomPlate = new THREE.Mesh(bottomPlateGeo, frameMat);
      bottomPlate.rotation.x = -Math.PI / 2;
      bottomPlate.position.y = -0.001;
      bottomPlate.receiveShadow = true;
      bottomPlate.castShadow = true;
      droneGroup.add(bottomPlate);

      // Top plate � rounded extrusion to match exp1
      const topPlateShape = createRoundedRectShape(bw * 0.95, bz * 0.95, Math.min(bw, bz) * 0.12);
      const topPlateGeo = new THREE.ExtrudeGeometry(topPlateShape, extrudeSettings);
      const topPlate = new THREE.Mesh(topPlateGeo, frameMat);
      topPlate.rotation.x = -Math.PI / 2;
      topPlate.position.y = bh - 0.001;
      topPlate.receiveShadow = true;
      topPlate.castShadow = true;
      droneGroup.add(topPlate);

      // Standoff pillars
      const standoffR = 0.0025;
      const standoffMat = createMaterial(0xd1d5db, 0.3, 0.9);
      const cornerOffsets = [
        [-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]
      ];
      cornerOffsets.forEach(off => {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(standoffR, standoffR, bh - 0.002, 8), standoffMat);
        pillar.position.set(bw * off[0], bh / 2, bz * off[1]);
        pillar.castShadow = true;
        droneGroup.add(pillar);
      });
    }

    // 4 Arms
    const motorRadius = wheelbase / 2000;
    const armR = (frame.arm_tube_od_mm / 2) / 1000;
    const armMat = new THREE.MeshStandardMaterial({
      color: 0x333333,
      map: getCarbonFiberTexture(),
      roughness: 0.2,
      metalness: 0.8
    });
    const up = new THREE.Vector3(0, 1, 0);

    ARM_DIRECTIONS.forEach((dir, i) => {
      const tipPos = new THREE.Vector3(dir.x * motorRadius, bh * 0.45, dir.z * motorRadius);

      if (!chasisModel) {
        const armGeo = new THREE.CylinderGeometry(armR, armR, motorRadius, 12);
        const armMesh = new THREE.Mesh(armGeo, armMat);
        armMesh.position.copy(dir.clone().multiplyScalar(motorRadius / 2));
        armMesh.position.y = bh * 0.45;
        const norm = new THREE.Vector3(dir.x, 0, dir.z).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(up, norm);
        armMesh.setRotationFromQuaternion(q);
        armMesh.castShadow = true;
        droneGroup.add(armMesh);

        // Arm tip mount ring
        const mountGeo = new THREE.CylinderGeometry(armR * 2.1, armR * 2.1, 0.003, 12);
        const mountMesh = new THREE.Mesh(mountGeo, frameMat);
        mountMesh.position.copy(tipPos);
        droneGroup.add(mountMesh);

        // Mount screws
        const screwGeo = new THREE.CylinderGeometry(0.0008, 0.0008, 0.0006, 6);
        const screwMat = createMaterial(0x64748b, 0.2, 0.9);
        const screwDist = armR * 1.5;
        [[-screwDist,-screwDist],[-screwDist,screwDist],[screwDist,-screwDist],[screwDist,screwDist]].forEach(soff => {
          const screw = new THREE.Mesh(screwGeo, screwMat);
          screw.position.set(tipPos.x + soff[0], tipPos.y + 0.0016, tipPos.z + soff[1]);
          droneGroup.add(screw);
        });

        // Landing legs
        const legHeight = 0.12;
        const legGeo = new THREE.CylinderGeometry(0.003, 0.002, legHeight, 6);
        const legMesh = new THREE.Mesh(legGeo, frameMat);
        legMesh.position.copy(tipPos);
        legMesh.position.y -= legHeight / 2 + 0.002;
        const qLeg = new THREE.Quaternion().setFromUnitVectors(up, new THREE.Vector3(0, -1, 0));
        legMesh.setRotationFromQuaternion(qLeg);
        legMesh.castShadow = true;
        droneGroup.add(legMesh);
      }

      // Motors & Propellers (identical detail to exp1)
      const motor = visualMotor;
      const prop = visualProp;
      if (motor) {
        const bellR = (motor.bell_diameter_mm / 2) / 1000;
        const bellH = motor.bell_height_mm / 1000;
        const motorY = tipPos.y + 0.0015;

        // Bell
        const bellGeo = new THREE.CylinderGeometry(bellR, bellR * 0.85, bellH, 16);
        const bellMat = createMaterial(0x1f2937, 0.3, 0.7);
        const bellMesh = new THREE.Mesh(bellGeo, bellMat);
        bellMesh.position.copy(tipPos);
        bellMesh.position.y = motorY + bellH / 2;
        bellMesh.castShadow = true;
        droneGroup.add(bellMesh);

        // Shaft
        const shaftGeo = new THREE.CylinderGeometry(0.0015, 0.0015, bellH * 1.5, 8);
        const shaftMat = createMaterial(0xe2e8f0, 0.15, 0.95);
        const shaftMesh = new THREE.Mesh(shaftGeo, shaftMat);
        shaftMesh.position.copy(tipPos);
        shaftMesh.position.y = motorY + bellH * 0.75;
        droneGroup.add(shaftMesh);

        // C-clip
        const cClipGeo = new THREE.TorusGeometry(0.002, 0.0006, 4, 8);
        const cClipMesh = new THREE.Mesh(cClipGeo, shaftMat);
        cClipMesh.position.copy(tipPos);
        cClipMesh.position.y = motorY + bellH + 0.001;
        cClipMesh.rotation.x = Math.PI / 2;
        droneGroup.add(cClipMesh);

        // Bell holes
        const holeGeo = new THREE.CylinderGeometry(bellR * 0.2, bellR * 0.2, 0.0006, 8);
        const holeMat = createMaterial(0x0f172a, 0.9, 0.0);
        for (let h = 0; h < 4; h++) {
          const angle = (h / 4) * Math.PI * 2;
          const holeMesh = new THREE.Mesh(holeGeo, holeMat);
          holeMesh.position.set(tipPos.x + Math.cos(angle) * (bellR * 0.5), motorY + bellH + 0.0002, tipPos.z + Math.sin(angle) * (bellR * 0.5));
          droneGroup.add(holeMesh);
        }

        // Copper coils (12)
        const coilGeo = new THREE.CylinderGeometry(bellR * 0.12, bellR * 0.12, bellH * 0.5, 6);
        const coilMat = createMaterial(0xb45309, 0.2, 0.8);
        for (let c = 0; c < 12; c++) {
          const angle = (c / 12) * Math.PI * 2;
          const coilMesh = new THREE.Mesh(coilGeo, coilMat);
          coilMesh.position.set(tipPos.x + Math.cos(angle) * (bellR * 0.52), motorY + bellH * 0.25, tipPos.z + Math.sin(angle) * (bellR * 0.52));
          droneGroup.add(coilMesh);
        }

        // Stator core
        const statorCore = new THREE.Mesh(
          new THREE.CylinderGeometry(bellR * 0.4, bellR * 0.4, bellH * 0.55, 8),
          createMaterial(0x475569, 0.5, 0.8)
        );
        statorCore.position.copy(tipPos);
        statorCore.position.y = motorY + bellH * 0.25;
        droneGroup.add(statorCore);

        if (prop) {
          const propR = prop.diameter_m / 2;
          const propChord = 0.016 + prop.diameter_m * 0.04;
          const hubH = 0.012;
          const propY = motorY + bellH + hubH / 2;

          const propGroup = new THREE.Group();
          propGroup.name = "propeller_" + i;
          propGroup.position.set(tipPos.x, propY, tipPos.z);
          droneGroup.add(propGroup);

          const hubGeo = new THREE.CylinderGeometry(0.006, 0.006, hubH, 10);
          const hubMesh = new THREE.Mesh(hubGeo, createMaterial(0x111827, 0.5, 0.1));
          propGroup.add(hubMesh);

          // Prop nut
          const nutGeo = new THREE.CylinderGeometry(0.0035, 0.0045, 0.005, 8);
          const nutMat = createMaterial(0xd1d5db, 0.2, 0.9);
          const nutMesh = new THREE.Mesh(nutGeo, nutMat);
          nutMesh.position.y = hubH / 2 + 0.0025;
          propGroup.add(nutMesh);

          const blade1 = createBlade(propR, propChord, PROP_SIGNS[i]);
          const blade2 = createBlade(propR, propChord, PROP_SIGNS[i]);
          blade2.rotation.y = Math.PI;
          propGroup.add(blade1);
          propGroup.add(blade2);

          // Blur disc
          const discGeo = new THREE.CircleGeometry(propR * 1.02, 32);
          const discMat = new THREE.MeshBasicMaterial({ color: 0x111827, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false });
          const discMesh = new THREE.Mesh(discGeo, discMat);
          discMesh.rotation.x = -Math.PI / 2;
          propGroup.add(discMesh);
          _blurDscs.push(discMat);
        }
      }
    });

    // Battery Mesh
    const bat = sel.battery;
    if (bat) {
      buildBatteryMesh(bat, droneGroup, frame);
    }

    // Payload Mesh
    const payloads = sel.payloads;
    if (payloads && payloads.length > 0) {
      buildPayloadMesh(payloads, droneGroup, frame);
    }

    // ESC � key may come from exp1 handoff as 'esc'
    const esc = sel.esc;
    if (esc) {
      if (esc.quantity === 1) {
        const escGeo = new THREE.BoxGeometry(0.032, 0.003, 0.032);
        const escMesh = new THREE.Mesh(escGeo, createMat(0x14532d, 0.7, 0.1));
        escMesh.position.set(0, 0.008, 0);
        droneGroup.add(escMesh);
        const spacerGeo = new THREE.CylinderGeometry(0.001, 0.001, 0.006, 6);
        const spacerMat = createMat(0xf59e0b, 0.5, 0.2);
        [[-0.012, -0.012], [0.012, -0.012], [-0.012, 0.012], [0.012, 0.012]].forEach(pt => {
          const spacer = new THREE.Mesh(spacerGeo, spacerMat);
          spacer.position.set(pt[0], 0.0125, pt[1]);
          droneGroup.add(spacer);
        });
      } else {
        const motorRadius2 = wheelbase / 2000;
        ARM_DIRECTIONS.forEach(dir => {
          const escPos = dir.clone().multiplyScalar(motorRadius2 * 0.45);
          const escMesh = new THREE.Mesh(
            new THREE.BoxGeometry(0.014, 0.003, 0.024),
            createMat(0x111827, 0.85, 0.0)
          );
          escMesh.position.set(escPos.x, bh * 0.45 + 0.004, escPos.z);
          escMesh.rotation.y = Math.atan2(dir.x, dir.z);
          droneGroup.add(escMesh);
        });
      }
    }

    // Flight Controller � handle both 'fc' and 'flight_controller' keys (exp1 handoff uses flight_controller)
    const fc = sel.fc || sel.flight_controller;
    if (fc) {
      const fcY = esc && esc.quantity === 1 ? 0.018 : 0.010;
      const fcMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.030, 0.003, 0.030),
        createMat(0x14532d, 0.7, 0.1)
      );
      fcMesh.position.set(0, fcY, 0);
      droneGroup.add(fcMesh);
    }

    // Receiver & antennas � handle both 'rx' and 'receiver' keys (exp1 handoff uses receiver)
    const rx = sel.rx || sel.receiver;
    if (rx) {
      const rxMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.018, 0.004, 0.013),
        createMat(0x1f2937, 0.8, 0.05)
      );
      rxMesh.position.set(0, 0.003, bz * 0.32);
      droneGroup.add(rxMesh);

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
      droneGroup.add(antLGroup);

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
      droneGroup.add(antRGroup);
    }

    // CoG Indicator crosshair
    const cgIndGroup = new THREE.Group();
    cgIndicator = new THREE.Mesh(new THREE.SphereGeometry(0.006, 12, 12), createMaterial(0x10b981, 0.2, 0.8));
    cgIndGroup.add(cgIndicator);

    const axisX = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.001, 0.001), createMaterial(0x10b981, 0.2, 0.8));
    const axisZ = new THREE.Mesh(new THREE.BoxGeometry(0.001, 0.001, 0.04), createMaterial(0x10b981, 0.2, 0.8));
    cgIndGroup.add(axisX);
    cgIndGroup.add(axisZ);

    cgIndGroup.position.set(0, bh + 0.006, 0);
    droneGroup.add(cgIndGroup);
    cgIndicator = cgIndGroup;

    // 10mm Safety Circle
    const ringGeo = new THREE.RingGeometry(0.0098, 0.0102, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x10b981, side: THREE.DoubleSide });
    boundaryRing = new THREE.Mesh(ringGeo, ringMat);
    boundaryRing.rotation.x = Math.PI / 2;
    boundaryRing.position.set(0, bh + 0.004, 0);
    droneGroup.add(boundaryRing);
  }

  function buildBatteryMesh(bat, parentGroup, frame) {
    const bh = frame ? frame.body_size_mm[1] / 1000 : 0.026;

    const capacity = bat.capacity_mah;
    const normVal = Math.min(Math.max((capacity - 800) / 3400, 0), 1);
    const batW = 0.068 + normVal * 0.076;
    const batH = 0.026 + normVal * 0.016;
    const batD = 0.020 + normVal * 0.018;

    const cellColors = { 3: 0x6e2a14, 4: 0x1f2937, 6: 0x1e1b4b };
    const battColor = cellColors[bat.cells] || 0x22252a;

    const batGeo = new THREE.BoxGeometry(batW, batH, batD);
    const batMat = createMaterial(battColor, 0.8, 0.05);
    batteryMesh = new THREE.Mesh(batGeo, batMat);

    const battY = -batH / 2 - 0.003;
    batteryMesh.position.set(
      state.selections.battery_pos.x / 1000,
      battY,
      -state.selections.battery_pos.y / 1000
    );
    batteryMesh.castShadow = true;
    batteryMesh.receiveShadow = true;
    parentGroup.add(batteryMesh);

    // XT60 connector
    const xt60Geo = new THREE.BoxGeometry(0.008, 0.006, 0.012);
    const xt60Mat = createMat(0xeab308, 0.4, 0.1);
    const xt60Mesh = new THREE.Mesh(xt60Geo, xt60Mat);
    xt60Mesh.position.set(
      state.selections.battery_pos.x / 1000,
      battY,
      -state.selections.battery_pos.y / 1000 + batD / 2 + 0.004
    );
    parentGroup.add(xt60Mesh);

    // Red & black power wires
    const wireGeo = new THREE.CylinderGeometry(0.001, 0.001, 0.016, 6);
    const wireRed = new THREE.Mesh(wireGeo, createMat(0xef4444, 0.7, 0.0));
    wireRed.position.set(
      state.selections.battery_pos.x / 1000 - 0.002,
      battY + 0.002,
      -state.selections.battery_pos.y / 1000 + batD / 2 + 0.009
    );
    wireRed.rotation.x = Math.PI / 2;
    parentGroup.add(wireRed);

    const wireBlack = new THREE.Mesh(wireGeo, createMat(0x1e293b, 0.7, 0.0));
    wireBlack.position.set(
      state.selections.battery_pos.x / 1000 + 0.002,
      battY + 0.002,
      -state.selections.battery_pos.y / 1000 + batD / 2 + 0.009
    );
    wireBlack.rotation.x = Math.PI / 2;
    parentGroup.add(wireBlack);

    // Anti-slip pad
    const padGeo = new THREE.BoxGeometry(batW * 0.9, 0.002, batD * 0.9);
    const padMesh = new THREE.Mesh(padGeo, createMat(0x111827, 0.9, 0.0));
    padMesh.position.set(
      state.selections.battery_pos.x / 1000,
      -0.001,
      -state.selections.battery_pos.y / 1000
    );
    parentGroup.add(padMesh);

    // Battery straps
    const strapOffsets = [
      state.selections.battery_pos.x / 1000 - batW * 0.25,
      state.selections.battery_pos.x / 1000 + batW * 0.25
    ];
    strapOffsets.forEach(function (xOff) {
      const strapGeo = new THREE.BoxGeometry(batD * 1.05, batH + bh + 0.006, 0.008);
      const strapMesh = new THREE.Mesh(strapGeo, createMat(0x111827, 0.9, 0.0));
      strapMesh.position.set(xOff, (bh - batH) / 2, -state.selections.battery_pos.y / 1000);
      strapMesh.rotation.y = Math.PI / 2;
      parentGroup.add(strapMesh);
    });
  }

  function buildPayloadMesh(payloads, parentGroup, frame) {
    payloadMesh = new THREE.Group();
    payloads.forEach(p => { _addPayloadToGroup(p, frame, payloadMesh); });
    parentGroup.add(payloadMesh);
  }

  // Detailed payload renderer � identical detail to exp1's addPayload()
  function _addPayloadToGroup(p, frame, targetGroup) {
    const bw = frame ? frame.body_size_mm[0] / 1000 : 0.088;
    const bz = frame ? frame.body_size_mm[2] / 1000 : 0.088;

    switch (p.id) {
      case 'gimbal_2axis':
      case 'gimbal_3axis': {
        const g = new THREE.Group();
        const ballGeoP = new THREE.SphereGeometry(0.003, 8, 8);
        const ballMatP = createMat(0x2563eb, 0.9, 0.0);
        [[-0.015, -0.015], [0.015, -0.015], [-0.015, 0.015], [0.015, 0.015]].forEach(off => {
          const ball = new THREE.Mesh(ballGeoP, ballMatP);
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
        targetGroup.add(g);
        break;
      }

      case 'camera_gopro': {
        const g = new THREE.Group();
        const mountGeo = new THREE.BoxGeometry(0.036, 0.028, 0.024);
        const mount = new THREE.Mesh(mountGeo, createMat(0x2563eb, 0.8, 0.0));
        mount.position.y = frame ? frame.body_size_mm[1] / 1000 + 0.014 : 0.036;
        mount.position.z = -bw * 0.32;
        mount.rotation.x = -0.15;
        g.add(mount);
        const cam = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.024, 0.018), createMat(0x111827, 0.6, 0.1));
        cam.position.copy(mount.position);
        cam.rotation.x = mount.rotation.x;
        g.add(cam);
        const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.004, 12), createMat(0x1e3a8a, 0.1, 0.8));
        lens.rotation.x = Math.PI / 2;
        lens.position.copy(cam.position).add(new THREE.Vector3(0.007, 0, -0.010));
        g.add(lens);
        targetGroup.add(g);
        break;
      }

      case 'camera_fpv_nano': {
        const g = new THREE.Group();
        const sideMat = createMat(0x9ca3af, 0.4, 0.6);
        const left = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.015, 0.012), sideMat);
        left.position.x = -0.008;
        const right = left.clone();
        right.position.x = 0.008;
        g.add(left);
        g.add(right);
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.012), createMat(0x111827, 0.6, 0.1)));
        const lensN = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.005, 10), createMat(0x1e293b, 0.1, 0.9));
        lensN.rotation.x = Math.PI / 2;
        lensN.position.z = -0.0085;
        g.add(lensN);
        g.position.set(0, (frame ? frame.body_size_mm[1] / 1000 : 0.026) / 2, -bw * 0.42);
        g.rotation.x = 0.25;
        targetGroup.add(g);
        break;
      }

      case 'gps_m8n':
      case 'gps_m9n_compass': {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.006, 16), createMat(0x1f2937, 0.6, 0.1)));
        const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.012, 8), createMat(0xd1d5db, 0.3, 0.7));
        ant.position.y = 0.009;
        g.add(ant);
        g.position.set(-bw * 0.2, (frame ? frame.body_size_mm[1] / 1000 : 0.026) + 0.006, bz * 0.2);
        targetGroup.add(g);
        break;
      }

      case 'lidar_tfmini': {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.012, 0.010), createMat(0x374151, 0.5, 0.3)));
        const emR = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.004, 10), createMat(0x1e3a8a, 0.1, 0.8));
        emR.rotation.x = Math.PI / 2;
        emR.position.set(-0.004, 0, -0.006);
        g.add(emR);
        const rcvR = emR.clone();
        rcvR.position.set(0.004, 0, -0.006);
        g.add(rcvR);
        g.position.set(0, -0.008, 0);
        targetGroup.add(g);
        break;
      }

      case 'lidar_garmin': {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.014, 16), createMat(0x1f2937, 0.7, 0.1)));
        g.position.set(0, -0.008, 0);
        targetGroup.add(g);
        break;
      }

      case 'telemetry_915': {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.008, 0.014), createMat(0x2563eb, 0.7, 0.1)));
        const whip = new THREE.Mesh(new THREE.CylinderGeometry(0.0006, 0.0006, 0.070, 5), createMat(0x111827, 0.9, 0.0));
        whip.position.set(0.010, 0.035, 0);
        whip.rotation.z = -0.15;
        g.add(whip);
        g.position.set(bw * 0.4, (frame ? frame.body_size_mm[1] / 1000 : 0.026) / 2, 0);
        g.rotation.y = Math.PI / 2;
        targetGroup.add(g);
        break;
      }

      case 'fpv_vtx': {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.020, 0.008, 0.016), createMat(0x374151, 0.5, 0.7)));
        const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.0008, 0.0008, 0.050, 6), createMat(0x111827, 0.9, 0.0));
        antenna.position.set(0, 0.025, 0.006);
        antenna.rotation.x = 0.2;
        g.add(antenna);
        g.position.set(0, frame ? frame.body_size_mm[1] / 1000 + 0.005 : 0.031, bz * 0.38);
        targetGroup.add(g);
        break;
      }

      default:
        break;
    }
  }

  function buildCantileverScene(sel, sc) {
    cantileverGroup = new THREE.Group();
    cantileverGroup.position.set(-0.10, 0, 0);
    sc.add(cantileverGroup);

    activeMaterial = sel.material;
    activeLength_mm = sel.frame ? sel.frame.arm_length_mm : 250;
    isBroken = false;
    breakProgress = 0.0;
    deflectionForce = 0;
    targetForce = 0;
    debrisParticles = [];

    const L_m = activeLength_mm / 1000;

    // Base clamp
    const cW = 0.05, cH = 0.06, cD = 0.04;
    clampMesh = new THREE.Mesh(new THREE.BoxGeometry(cW, cH, cD), createMaterial(0x475569, 0.4, 0.5));
    clampMesh.position.set(-cW / 2, cH / 2, 0);
    clampMesh.castShadow = true;
    clampMesh.receiveShadow = true;
    cantileverGroup.add(clampMesh);

    // Hollow Rectangular Tube with Profile Scaling
    const profile = state.selections.frame?.arm_profile || { b_mm: 15, h_mm: 8, t_mm: 1.5 };
    const bW = L_m;
    const bH = profile.h_mm / 1000; 
    const bD = profile.b_mm / 1000; 
    const segX = 48; 
    const beamGeo = new THREE.BoxGeometry(bW, bH, bD, segX, 1, 1);

    let matColor = 0x1c1c1e; // Carbon Fibre graphite
    if (activeMaterial && activeMaterial.id === 'aluminium') matColor = 0xa8a8a8; // Silver
    else if (activeMaterial && activeMaterial.id === 'nylon') matColor = 0xe8dcc8; // Off-white

    const colorAttr = [];
    const col = new THREE.Color(matColor);
    const posAttr = beamGeo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      colorAttr.push(col.r, col.g, col.b);
    }
    beamGeo.setAttribute('color', new THREE.Float32BufferAttribute(colorAttr, 3));

    const beamMat = new THREE.MeshStandardMaterial({
      roughness: activeMaterial && activeMaterial.id === 'aluminium' ? 0.4 : (activeMaterial && activeMaterial.id === 'nylon' ? 0.6 : 0.35),
      metalness: activeMaterial && activeMaterial.id === 'aluminium' ? 0.7 : 0.05,
      vertexColors: true,
      side: THREE.DoubleSide
    });
    beamMesh = new THREE.Mesh(beamGeo, beamMat);
    beamMesh.position.set(bW / 2, 0, 0);
    beamMesh.castShadow = true;
    beamMesh.receiveShadow = true;
    cantileverGroup.add(beamMesh);

    beamMesh.geometry.userData = {
      originalPositions: posAttr.clone(),
      length: bW,
      width: bD,
      height: bH,
      matColor: matColor
    };

    // Motor & Arrow
    testMotorMesh = new THREE.Group();
    testMotorMesh.position.set(L_m, 0, 0);
    cantileverGroup.add(testMotorMesh);

    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.012, 16), createMaterial(0x1e293b, 0.35, 0.7));
    bell.position.y = 0.006 + bH / 2;
    bell.castShadow = true;
    testMotorMesh.add(bell);

    const motorBase = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.004, 12), createMaterial(0x0f172a, 0.5, 0.2));
    motorBase.position.y = 0.002 + bH / 2;
    testMotorMesh.add(motorBase);

    // Arrow (Shaft + Head)
    const arrowMat = createMaterial(0x38bdf8, 0.2, 0.8, 0.65);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 0.04, 6), arrowMat);
    shaft.position.y = 0.035;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.004, 0.010, 8), arrowMat);
    head.position.y = 0.055;
    testMotorMesh.add(shaft);
    testMotorMesh.add(head);
  }

  function applyCantileverLoad(force) {
    targetForce = force;
  }

  function triggerArmBreak() {
    isBroken = true;
    breakProgress = 0.0;

    debrisParticles = [];
    const mat = activeMaterial || { id: 'carbon_fibre' };
    let matColor = 0x1c1c1e;
    if (mat.id === 'aluminium') matColor = 0xa8a8a8;
    else if (mat.id === 'nylon') matColor = 0xe8dcc8;

    for (let i = 0; i < 12; i++) {
      const particle = new THREE.Mesh(
        new THREE.BoxGeometry(0.002, 0.0015, 0.0015),
        new THREE.MeshStandardMaterial({ color: matColor, roughness: 0.5, metalness: 0.3 })
      );
      particle.position.set(0, 0, (Math.random() - 0.5) * 0.015);
      particle.velocity = new THREE.Vector3(
        (Math.random() - 0.3) * 0.15,
        Math.random() * 0.08 + 0.02,
        (Math.random() - 0.5) * 0.1
      );
      cantileverGroup.add(particle);
      debrisParticles.push(particle);
    }
  }

  function updateComponentPlacements(sel) {
    if (!droneGroup) return;
    if (batteryMesh && sel.battery && sel.battery_pos) {
      batteryMesh.position.x = sel.battery_pos.x / 1000;
      batteryMesh.position.z = -sel.battery_pos.y / 1000;
    }
    if (payloadMesh && sel.payloads && sel.payload_pos) {
      payloadMesh.position.x = sel.payload_pos.x / 1000;
      payloadMesh.position.z = -sel.payload_pos.y / 1000;
    }
  }

  function updateCGFeedback(cg) {
    if (!cgIndicator || !droneGroup) return;
    
    cgIndicator.position.x = cg.x_cg / 1000;
    cgIndicator.position.z = -cg.y_cg / 1000;

    const isSafe = (cg.offset_mm < 10.0);
    cgIndicator.children[0].material.color.setHex(isSafe ? 0x10b981 : 0xef4444);

    if (!state.isFlying) {
      if (cg.offset_mm < 0.001) {
        droneGroup.rotation.set(0, 0, 0);
      } else {
        const pivotHeight = 15;
        const tiltAngle = Math.atan(cg.offset_mm / pivotHeight);
        const dir = Math.atan2(-cg.y_cg, cg.x_cg);
        droneGroup.rotation.z = -Math.cos(dir) * tiltAngle;
        droneGroup.rotation.x = Math.sin(dir) * tiltAngle;
        droneGroup.rotation.y = 0;
      }
    }
  }

  function tick(delta, tabNum) {
    if (tabNum === 1 && droneGroup) {
      if (state.isFlying) {
        state.flightTime += delta;

        const cg = state.calculations;
        const wheelbase = state.selections.frame ? state.selections.frame.wheelbase_mm : 450;
        const shares = Calc.solvePerMotorThrust(cg.total_mass_g, cg.x_cg, cg.y_cg, wheelbase);
        const baseRPM = 45;

        droneGroup.traverse(function (child) {
          if (child.name && child.name.startsWith("propeller_")) {
            const motorIdx = parseInt(child.name.split('_')[1]);
            const shareVal = [shares.FR, shares.FL, shares.RR, shares.RL][motorIdx];
            child.rotation.y += delta * baseRPM * (shareVal / 0.25);
          }
        });

        const isBalanced = cg.offset_mm < 5.0;

        if (isBalanced) {
          const H_stand = 0.06 + (wheelbase / 1000) * 0.2;
          const targetY = H_stand + 0.15;
          droneGroup.position.y += (targetY - droneGroup.position.y) * delta * 1.5;

          const driftScale = cg.offset_mm / 5.0;
          const driftX = Math.sin(state.flightTime * 4) * (0.001 + driftScale * 0.003);
          const driftZ = Math.cos(state.flightTime * 3.5) * (0.001 + driftScale * 0.003);
          
          droneGroup.position.x = driftX;
          droneGroup.position.z = driftZ;
          
          const compensationTilt = Math.min(cg.offset_mm * 0.005, 0.05);
          const dirX = cg.offset_mm > 0 ? cg.x_cg / cg.offset_mm : 0;
          const dirY = cg.offset_mm > 0 ? cg.y_cg / cg.offset_mm : 0;
          
          droneGroup.rotation.z = -dirX * compensationTilt + Math.sin(state.flightTime * 5) * 0.002;
          droneGroup.rotation.x = -dirY * compensationTilt + Math.cos(state.flightTime * 4.5) * 0.002;
          droneGroup.rotation.y = 0;

          const elStatus = document.getElementById('flightStatusText');
          if (elStatus) {
            const pctFR = (shares.shares.FR * 100).toFixed(1);
            const pctFL = (shares.shares.FL * 100).toFixed(1);
            const pctRR = (shares.shares.RR * 100).toFixed(1);
            const pctRL = (shares.shares.RL * 100).toFixed(1);
            elStatus.textContent = `Stable Hover. FR: ${pctFR}% | FL: ${pctFL}% | RR: ${pctRR}% | RL: ${pctRL}%`;
            elStatus.style.color = 'var(--success)';
          }
        } else {
          const H_stand = 0.06 + (wheelbase / 1000) * 0.2;

          if (state.flightTime < 3.2) {
            const targetY = H_stand + 0.12;
            droneGroup.position.y += (targetY - droneGroup.position.y) * delta * 1.5;

            const driftRate = cg.offset_mm * 0.025;
            const dirX = cg.x_cg / cg.offset_mm;
            const dirY = cg.y_cg / cg.offset_mm;

            state.flightPos.x += dirX * driftRate * delta * (1.0 + state.flightTime * 1.2);
            state.flightPos.z -= dirY * driftRate * delta * (1.0 + state.flightTime * 1.2);

            droneGroup.position.x = state.flightPos.x;
            droneGroup.position.z = state.flightPos.z;

            const maxTilt = 0.45;
            const tiltAmt = Math.min(cg.offset_mm * 0.018 * (1.0 + state.flightTime * 1.8), maxTilt);
            droneGroup.rotation.z = -dirX * tiltAmt;
            droneGroup.rotation.x = -dirY * tiltAmt;
            droneGroup.rotation.y = Math.sin(state.flightTime * 3) * 0.05;

            const elStatus = document.getElementById('flightStatusText');
            if (elStatus) {
              elStatus.textContent = `IMU Unstable Drift! X: ${(droneGroup.position.x*1000).toFixed(1)}mm, Z: ${(droneGroup.position.z*1000).toFixed(1)}mm`;
              elStatus.style.color = 'var(--warning)';
            }
          } else {
            if (!state.angularVel) state.angularVel = new THREE.Vector3(0, 0, 0);
            if (state.fallVelocity === undefined) state.fallVelocity = 0;

            state.angularVel.x += cg.y_cg * 0.05 * delta;
            state.angularVel.z -= cg.x_cg * 0.05 * delta;
            droneGroup.rotation.x += state.angularVel.x * delta;
            droneGroup.rotation.z += state.angularVel.z * delta;

            const groundY = 0.02;
            if (droneGroup.position.y > groundY) {
              state.fallVelocity += 9.81 * delta;
              droneGroup.position.y -= state.fallVelocity * delta;
            } else {
              droneGroup.position.y = groundY;
              state.fallVelocity = -state.fallVelocity * 0.3; 
              state.angularVel.multiplyScalar(0.5); 
            }

            droneGroup.traverse(function (child) {
              if (child.name && child.name.startsWith("propeller_")) {
                child.rotation.y += delta * 3.0; 
              }
            });

            const elStatus = document.getElementById('flightStatusText');
            if (elStatus) {
              elStatus.textContent = `CRASH DETECTED! Severe CoG mismatch. Align components.`;
              elStatus.style.color = 'var(--danger)';
            }
          }
        }
      } else {
        const wheelbase = state.selections.frame ? state.selections.frame.wheelbase_mm : 450;
        const H_stand = 0.06 + (wheelbase / 1000) * 0.2;
        droneGroup.position.set(0, H_stand, 0);

        const cg = state.calculations;
        if (cg.offset_mm < 0.001) {
          droneGroup.rotation.set(0, 0, 0);
        } else {
          const pivotHeight = 15;
          const tiltAngle = Math.atan(cg.offset_mm / pivotHeight);
          const dir = Math.atan2(-cg.y_cg, cg.x_cg);
          droneGroup.rotation.z = -Math.cos(dir) * tiltAngle;
          droneGroup.rotation.x = Math.sin(dir) * tiltAngle;
          droneGroup.rotation.y = 0;
        }
      }
    }

    if (tabNum === 2 && cantileverGroup && beamMesh && testMotorMesh && activeMaterial) {
      const speed = isBroken ? 6.0 : 4.0;
      deflectionForce += (targetForce - deflectionForce) * Math.min(delta * speed, 1.0);

      const E = activeMaterial.youngs_modulus_gpa;
      const yieldStrength = activeMaterial.yield_strength_mpa;
      const L = activeLength_mm;
      
      const profile = state.selections.frame?.arm_profile || { b_mm: 15, h_mm: 8, t_mm: 1.5 };
      const b = profile.b_mm, h = profile.h_mm, t = profile.t_mm;
      const I = Calc.solveHollowInertia(b, h, t);

      const posAttr = beamMesh.geometry.attributes.position;
      const origPos = beamMesh.geometry.userData.originalPositions;
      const colorAttr = beamMesh.geometry.attributes.color;
      const L_m = beamMesh.geometry.userData.length;
      const bH = beamMesh.geometry.userData.height;
      const matColor = beamMesh.geometry.userData.matColor;

      if (isBroken) {
        breakProgress += delta * 1.8;
        const p = Math.min(breakProgress, 1.0);
        
        beamMesh.position.y = -p * 0.07;
        beamMesh.position.x = L_m / 2 + p * 0.015;
        beamMesh.rotation.z = -p * 0.5;

        testMotorMesh.position.y = -p * 0.07 - Math.sin(p * 0.5) * 0.01;
        testMotorMesh.position.x = L_m + p * 0.015;
        testMotorMesh.rotation.z = -p * 0.5;

        if (debrisParticles) {
          debrisParticles.forEach(particle => {
            particle.velocity.y -= 9.81 * delta;
            particle.position.x += particle.velocity.x * delta;
            particle.position.y += particle.velocity.y * delta;
            particle.position.z += particle.velocity.z * delta;
          });
        }

        for (let i = 0; i < posAttr.count; i++) posAttr.setY(i, origPos.getY(i));
        posAttr.needsUpdate = true;
        return;
      }

      const appliedStress = Calc.solveBendingStress(Calc.solveBendingMoment(deflectionForce, L), h, I);

      for (let i = 0; i < posAttr.count; i++) {
        const ox = origPos.getX(i);
        const globalX_mm = (ox + L_m / 2) * 1000;
        const dy = -Calc.solveDeflectionAtX(deflectionForce, globalX_mm, L, E, I);
        posAttr.setY(i, origPos.getY(i) + dy);

        const M_atX = Calc.solveBendingMomentAtX(deflectionForce, globalX_mm, L);
        const stress_atX = Calc.solveBendingStress(M_atX, h, I);
        const ratio = Math.min(stress_atX / yieldStrength, 1.2);

        const startColor = new THREE.Color(matColor);
        const midColor = new THREE.Color(0xffbf00); 
        const endColor = new THREE.Color(0xef4444); 
        const rColor = new THREE.Color();
        if (ratio < 0.5) {
          rColor.lerpColors(startColor, midColor, ratio * 2.0);
        } else {
          rColor.lerpColors(midColor, endColor, (ratio - 0.5) * 2.0);
        }
        colorAttr.setXYZ(i, rColor.r, rColor.g, rColor.b);
      }

      posAttr.needsUpdate = true;
      colorAttr.needsUpdate = true;

      const maxDef = -Calc.solveDeflectionAtX(deflectionForce, L, L, E, I);
      testMotorMesh.position.y = maxDef;
      const slope = -(deflectionForce * (L/1000) * (L/1000)) / (2.0 * (E * 1e9) * I);
      testMotorMesh.rotation.z = slope;

      const shaft = testMotorMesh.children[2];
      const head = testMotorMesh.children[3];
      if (shaft && head) {
        const forceRatio = Math.min(deflectionForce / 10.0, 1.0);
        shaft.scale.y = 0.5 + forceRatio * 1.5;
        shaft.position.y = (0.04 * shaft.scale.y) / 2 + bH / 2 + 0.012;
        head.position.y = bH / 2 + 0.012 + 0.04 * shaft.scale.y;
      }
    }
  }

  return {
    updateFromSelections: updateFromSelections,
    animateProps: animateProps,
    setSimRPM: setSimRPM,
    getDroneGroup: function () { return _droneGrp; },
    updateThrustStandDisplay: updateBenchHUD,
    setBurnState: setBurnState,
    rebuildScene: rebuildScene,
    updateComponentPlacements: updateComponentPlacements,
    updateCGFeedback: updateCGFeedback,
    applyCantileverLoad: applyCantileverLoad,
    triggerArmBreak: triggerArmBreak,
    tick: tick,
    batteryMesh: function () { return batteryMesh; },
    payloadMesh: function () { return payloadMesh; }
  };
})();
window.DroneModel = DroneModel;

// ═══════════════════════════════════════════════════════════════════
// 5. MODULE 1 UI IIFE
// ═══════════════════════════════════════════════════════════════════
const UI = (function () {
  'use strict';

  function buildSelectionGrids(db, state, handleSelection) {
    buildSharedTileGrid('frameTilesContainer', db.frames, {
      isMulti: false,
      selectedIds: state.selections.frame ? state.selections.frame.id : null,
      name: 'frame',
      idPrefix: 'frame_',
      specF: (item) => `${item.wheelbase_mm}mm | ${item.mass_g}g`,
      onSelect: (item) => handleSelection('frame', item.id)
    });

    buildSharedTileGrid('batteryTilesContainer', db.batteries, {
      isMulti: false,
      selectedIds: state.selections.battery ? state.selections.battery.id : null,
      name: 'battery',
      idPrefix: 'battery_',
      specF: (item) => `${item.cells}S | ${item.capacity_mah}mAh | ${item.mass_g}g`,
      onSelect: (item) => handleSelection('battery', item.id)
    });

    buildSharedTileGrid('payloadTilesContainer', db.payloads, {
      isMulti: true,
      selectedIds: state.selections.payloads ? state.selections.payloads.map(p => p.id) : [],
      name: 'payloads',
      idPrefix: 'payload_',
      specF: (item) => `${item.mass_g}g`,
      onSelect: (item, checked) => handleSelection('payloads', item.id, checked)
    });
  }

  function refreshPlacementSliders(selections) {
    const frame = selections.frame;
    const halfW = frame ? frame.body_size_mm[0] / 2 : 44;
    const halfL = frame ? frame.body_size_mm[2] / 2 : 44;

    const batXLim = Math.max(0, halfW - 10);
    const batYLim = Math.max(0, halfL - 15);
    const payXLim = Math.max(0, halfW - 8);
    const payYLim = Math.max(0, halfL - 8);

    const sliders = [
      { id: 'batX', val: selections.battery_pos.x, lim: batXLim },
      { id: 'batY', val: selections.battery_pos.y, lim: batYLim },
      { id: 'payloadX', val: selections.payload_pos.x, lim: payXLim },
      { id: 'payloadY', val: selections.payload_pos.y, lim: payYLim }
    ];

    sliders.forEach(function (s) {
      const el = document.getElementById(s.id);
      if (el) {
        el.min = -s.lim;
        el.max = s.lim;
        
        let val = selections[s.id.startsWith('bat') ? 'battery_pos' : 'payload_pos'][s.id.endsWith('X') ? 'x' : 'y'];
        if (val < -s.lim) val = -s.lim;
        if (val > s.lim) val = s.lim;
        selections[s.id.startsWith('bat') ? 'battery_pos' : 'payload_pos'][s.id.endsWith('X') ? 'x' : 'y'] = val;
        el.value = val;

        const valLbl = document.getElementById(s.id + 'Val');
        if (valLbl) valLbl.textContent = Math.round(val) + ' mm';
      }
    });
  }

  function updateChecklist(selections, cgOffset) {
    const frameOk = selections.frame !== null;
    const battOk = selections.battery !== null;
    const payOk = selections.payloads && selections.payloads.length > 0;
    const cgOk = cgOffset < 5.0 && frameOk && battOk && payOk;

    const setCheck = function (id, ok, valText) {
      const item = document.getElementById(id);
      if (!item) return;
      const icon = item.querySelector('.chk-icon');
      const val = item.querySelector('.checklist-val');
      
      if (icon) {
        icon.className = 'chk-icon ' + (ok ? 'done' : 'pending');
        icon.innerHTML = ok ? '✓' : '';
      }
      if (val) val.textContent = valText;
    };

    setCheck('chkFrame', frameOk, frameOk ? selections.frame.label.split(' — ')[0] : 'Pending');
    setCheck('chkBattery', battOk, battOk ? selections.battery.label.split(' — ')[0] : 'Pending');
    setCheck('chkPayload', payOk, payOk ? (selections.payloads.length > 1 ? `${selections.payloads.length} Selected` : selections.payloads[0].label.split(' ')[0]) : 'Pending');
    setCheck('chkBalance', cgOk, cgOk ? (cgOffset < 0.001 ? `Perfect (${cgOffset.toFixed(5)} mm)` : `Balanced (${cgOffset.toFixed(5)} mm)`) : (frameOk && battOk && payOk ? `Offset: ${cgOffset.toFixed(5)} mm` : 'Pending'));

    const btn = document.getElementById('btnNextModule');
    if (btn) {
      if (cgOk) {
        btn.removeAttribute('disabled');
        btn.textContent = 'Lock Design & Proceed';
      } else {
        btn.setAttribute('disabled', 'true');
        btn.textContent = 'Frame Unbalanced';
      }
    }
  }

  return {
    buildSelectionGrids,
    refreshPlacementSliders,
    updateChecklist
  };
})();
window.UI = UI;

// ═══════════════════════════════════════════════════════════════════
// 6. MODULE 2 UI IIFE
// ═══════════════════════════════════════════════════════════════════
const Mod2UI = (function () {
  'use strict';

  function buildControlTiles(db, activeSelection, onSelectMaterial, onSelectLength) {
    buildSharedTileGrid('matTilesContainer', db.materials, {
      isMulti: false,
      selectedIds: activeSelection.material ? activeSelection.material.id : null,
      name: 'material',
      idPrefix: 'mat_',
      specF: (item) => `&sigma;_y: ${item.yield_strength_mpa} MPa`,
      onSelect: (item) => onSelectMaterial(item)
    });

    const lengths = [
      { id: '150', label: '150 mm', spec: 'Medium' },
      { id: '250', label: '250 mm', spec: 'Standard' },
      { id: '350', label: '350 mm', spec: 'Cinematography' }
    ];
    buildSharedTileGrid('lenTilesContainer', lengths, {
      isMulti: false,
      selectedIds: String(activeSelection.length),
      name: 'length',
      idPrefix: 'len_',
      specF: (item) => item.spec,
      onSelect: (item) => onSelectLength(parseInt(item.id))
    });
  }

  // ── Unlock card 3D scene (chassis.glb) ────────────────────────────
  let _unlAnim = null;
  let _unlScn = null;
  let _unlRndr = null;
  let _unlCam = null;
  let _unlCtrls = null;
  let _chassisGroup = null;
  let _unlClk = null;

  function initUnlock() {
    const canvas = document.getElementById('unlockCanvas');
    if (!canvas) return;

    if (_unlAnim) {
      cancelAnimationFrame(_unlAnim);
      _unlAnim = null;
    }

    // Pass the wrapper div so initBase3DScene measures the correct clientWidth/Height.
    const base = initBase3DScene(canvas, canvas.parentElement, {
      bgColor: 0xf3f4f6,
      fov: 40,
      camPos: { x: 0.20, y: 0.15, z: 0.28 },
      alpha: true,
      ctrls: { minDist: 0.10, maxDist: 2.0, target: { x: 0, y: 0.01, z: 0 } },
      ambientIntensity: 0.70,
      sunIntensity: 0.90,
      sunPos: { x: 1.0, y: 2.0, z: 1.0 }
    });
    _unlScn = base.scn;
    _unlRndr = base.rndr;
    _unlCam = base.cam;
    _unlCtrls = base.ctrls;

    // Force correct size now that the wrapper has rendered dimensions.
    if (base.handleResize) base.handleResize();

    _chassisGroup = new THREE.Group();
    _unlScn.add(_chassisGroup);

    // Fallback procedural chassis shape (box frame silhouette).
    function createProcedural() {
      while (_chassisGroup.children.length > 0) {
        _chassisGroup.remove(_chassisGroup.children[0]);
      }
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.35, metalness: 0.75 });
      const accentMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.5, metalness: 0.3 });

      // Central body plate.
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.012, 0.10), bodyMat);
      _chassisGroup.add(body);

      // Four arms.
      const armLen = 0.09;
      const armGeo = new THREE.BoxGeometry(armLen, 0.008, 0.012);
      const armOffsets = [
        { x:  (0.10 / 2 + armLen / 2), z:  (0.10 / 2 + armLen / 2), ry:  Math.PI / 4 },
        { x: -(0.10 / 2 + armLen / 2), z:  (0.10 / 2 + armLen / 2), ry: -Math.PI / 4 },
        { x:  (0.10 / 2 + armLen / 2), z: -(0.10 / 2 + armLen / 2), ry: -Math.PI / 4 },
        { x: -(0.10 / 2 + armLen / 2), z: -(0.10 / 2 + armLen / 2), ry:  Math.PI / 4 }
      ];
      armOffsets.forEach(a => {
        const arm = new THREE.Mesh(armGeo, bodyMat);
        arm.position.set(a.x * 0.6, 0, a.z * 0.6);
        arm.rotation.y = a.ry;
        _chassisGroup.add(arm);

        // Motor mount disc at tip.
        const mount = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.008, 16), accentMat);
        mount.position.set(a.x, 0, a.z);
        _chassisGroup.add(mount);
      });

      // Landing legs.
      const legMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.6, metalness: 0.4 });
      [[-0.055, -0.055], [0.055, -0.055], [-0.055, 0.055], [0.055, 0.055]].forEach(([x, z]) => {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.025, 8), legMat);
        leg.position.set(x, -0.018, z);
        _chassisGroup.add(leg);
      });
    }

    if (window.GLTFLoader) {
      const loader = new window.GLTFLoader();

      // chasis.glb uses Draco mesh compression — attach a DRACOLoader to decode it.
      if (window.DRACOLoader) {
        const draco = new window.DRACOLoader();
        draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
        loader.setDRACOLoader(draco);
      }

      loader.load('asset/chasis.glb', function (gltf) {
        while (_chassisGroup.children.length > 0) {
          _chassisGroup.remove(_chassisGroup.children[0]);
        }

        const model = gltf.scene;

        // Auto-scale to a consistent display size (~0.18 m wide).
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z) || 1.0;
        const scale = 0.18 / maxDim;
        model.scale.set(scale, scale, scale);

        // Centre the model.
        const center = new THREE.Vector3();
        box.getCenter(center);
        model.position.set(-center.x * scale, -center.y * scale, -center.z * scale);

        model.traverse(c => {
          if (c.isMesh) {
            c.castShadow = true;
            c.receiveShadow = true;
          }
        });

        _chassisGroup.add(model);
      }, undefined, function (err) {
        console.warn('chasis.glb load failed, using procedural fallback', err);
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
      if (_chassisGroup) _chassisGroup.rotation.y += 0.30 * dt;
      _unlRndr.render(_unlScn, _unlCam);
    }
    render();
  }

  return {
    buildControlTiles,
    initUnlockScene: initUnlock
  };
})();
window.Mod2UI = Mod2UI;

// ═══════════════════════════════════════════════════════════════════
// 7. MODULE 1 ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════
const Module1 = (function () {
  'use strict';
  
  let cgChart = null;

  function init() {
    fetch('db/db.json')
      .then(res => res.json())
      .then(function (data) {
        database = data;
        window._exp2DB = data; // expose for DroneModel visual motor/prop resolver
        
        loadContinuationData();

        const cgHandoff = localStorage.getItem('vlabModule2_cg');
        if (!cgHandoff) {
          randomizeOffsets();
        }

        Scene.init(1);
        UI.buildSelectionGrids(database, state, handleSelection);
        bindListeners();
        setup3DDrag();
        refresh();
      })
      .catch(err => console.error('Database failed to load:', err));
  }

  function randomizeOffsets() {
    const frame = state.selections.frame;
    const halfW = frame ? frame.body_size_mm[0] / 2 : 44;
    const halfL = frame ? frame.body_size_mm[2] / 2 : 44;

    const batXLim = Math.max(0, halfW - 10);
    const batYLim = Math.max(0, halfL - 15);
    const payXLim = Math.max(0, halfW - 8);
    const payYLim = Math.max(0, halfL - 8);

    const randSign = () => Math.random() < 0.5 ? -1 : 1;
    const randVal = (limit) => randSign() * (0.4 + Math.random() * 0.4) * limit;

    state.selections.battery_pos = { x: randVal(batXLim), y: randVal(batYLim) };
    state.selections.payload_pos = { x: randVal(payXLim), y: randVal(payYLim) };
  }

  function bindListeners() {
    const bx = document.getElementById('batX');
    const by = document.getElementById('batY');
    const px = document.getElementById('payloadX');
    const py = document.getElementById('payloadY');
    const btn = document.getElementById('btnNextModule');
    const btnTest = document.getElementById('btnTestFlight');

    const onSlide = function (e, key, labelId) {
      state.selections[key.split('.')[0]][key.split('.')[1]] = parseFloat(e.target.value);
      const lbl = document.getElementById(labelId);
      if (lbl) lbl.textContent = Math.round(e.target.value) + ' mm';
      refresh();
    };

    if (bx) bx.addEventListener('input', e => onSlide(e, 'battery_pos.x', 'batXVal'));
    if (by) by.addEventListener('input', e => onSlide(e, 'battery_pos.y', 'batYVal'));
    if (px) px.addEventListener('input', e => onSlide(e, 'payload_pos.x', 'payloadXVal'));
    if (py) py.addEventListener('input', e => onSlide(e, 'payload_pos.y', 'payloadYVal'));

    if (btn) {
      btn.addEventListener('click', function () {
        if (!btn.hasAttribute('disabled')) {
          const handoff = {
            frame_id: state.selections.frame.id,
            battery_id: state.selections.battery.id,
            payload_ids: state.selections.payloads ? state.selections.payloads.map(p => p.id) : [],
            battery_pos: state.selections.battery_pos,
            payload_pos: state.selections.payload_pos,
            total_mass_g: state.calculations.total_mass_g,
            cg_offset_mm: state.calculations.offset_mm
          };
          
          const oldHandoffRaw = localStorage.getItem('vlabModule2_cg');
          let shouldClear = false;
          if (oldHandoffRaw) {
            try {
              const oldH = JSON.parse(oldHandoffRaw);
              if (oldH.frame_id !== handoff.frame_id ||
                  oldH.battery_id !== handoff.battery_id ||
                  JSON.stringify(oldH.payload_ids) !== JSON.stringify(handoff.payload_ids) ||
                  !oldH.battery_pos || oldH.battery_pos.x !== handoff.battery_pos.x || oldH.battery_pos.y !== handoff.battery_pos.y ||
                  !oldH.payload_pos || oldH.payload_pos.x !== handoff.payload_pos.x || oldH.payload_pos.y !== handoff.payload_pos.y) {
                shouldClear = true;
              }
            } catch (e) {
              shouldClear = true;
            }
          }
          if (shouldClear) {
            localStorage.removeItem('vlabModule2_matrix');
            localStorage.removeItem('vlabModule2_final');
          }

          localStorage.setItem('vlabModule2_cg', JSON.stringify(handoff));
          window.location.href = 'index1.html';
        }
      });
    }

    if (btnTest) {
      btnTest.addEventListener('click', function () {
        if (state.isFlying) {
          state.isFlying = false;
          btnTest.textContent = "Start Flight Test";
          btnTest.style.backgroundColor = "var(--accent)";
          const elStatus = document.getElementById('flightStatusText');
          if (elStatus) {
            elStatus.textContent = "System Idle. Ready for flight test.";
            elStatus.style.color = "var(--text-secondary)";
          }
          state.flightTime = 0;
          state.flightPos.set(0, 0, 0);
        } else {
          state.isFlying = true;
          state.flightTime = 0;
          state.flightPos.set(0, 0, 0);
          state.angularVel = new THREE.Vector3(0, 0, 0);
          state.fallVelocity = 0;
          btnTest.textContent = "Stop Flight Test";
          btnTest.style.backgroundColor = "var(--danger)";
          const elStatus = document.getElementById('flightStatusText');
          if (elStatus) {
            elStatus.textContent = "Arming motors... Takeoff!";
            elStatus.style.color = "var(--text-secondary)";
          }
        }
      });
    }

    const titleEl = document.getElementById('configPanelTitle');
    const sectionsEl = document.getElementById('configSections');
    const chevronEl = document.getElementById('configPanelChevron');
    if (titleEl && sectionsEl && chevronEl) {
      titleEl.addEventListener('click', function () {
        const isCollapsed = sectionsEl.style.display === 'none';
        sectionsEl.style.display = isCollapsed ? 'flex' : 'none';
        chevronEl.style.transform = isCollapsed ? 'rotate(0deg)' : 'rotate(-90deg)';
      });
    }
  }

  function handleSelection(category, selectedId, checked) {
    if (category === 'frame') {
      state.selections.frame = database.frames.find(f => f.id === selectedId);
      UI.refreshPlacementSliders(state.selections);
      randomizeOffsets();
      syncPlacements();
      Scene.setTab(1);
    } else if (category === 'battery') {
      state.selections.battery = database.batteries.find(b => b.id === selectedId);
    } else if (category === 'payloads') {
      const pObj = database.payloads.find(p => p.id === selectedId);
      if (checked) {
        if (!state.selections.payloads.some(item => item.id === selectedId)) {
          state.selections.payloads.push(pObj);
        }
      } else {
        state.selections.payloads = state.selections.payloads.filter(item => item.id !== selectedId);
      }
    }
    refresh();
  }

  function syncPlacements() {
    const bx = document.getElementById('batX'), by = document.getElementById('batY');
    const px = document.getElementById('payloadX'), py = document.getElementById('payloadY');
    if (bx) state.selections.battery_pos.x = parseFloat(bx.value);
    if (by) state.selections.battery_pos.y = parseFloat(by.value);
    if (px) state.selections.payload_pos.x = parseFloat(px.value);
    if (py) state.selections.payload_pos.y = parseFloat(py.value);
  }

  function refresh() {
    if (!database) return;
    UI.refreshPlacementSliders(state.selections);

    const frame = state.selections.frame;
    const battery = state.selections.battery;
    const payloads = state.selections.payloads;
    const fixed = database.fixed_weights;
    const armLen = frame ? frame.wheelbase_mm / 2 : 225;

    const components = [];
    components.push({ name: 'Airframe Center Deck', mass_g: frame ? frame.mass_g : 100, x_mm: 0, y_mm: 0 });

    const electronicsMass = fixed.flight_controller_g + fixed.receiver_g + fixed.gps_module_g + fixed.power_distribution_g;
    components.push({ name: 'Avionics Stack', mass_g: electronicsMass, x_mm: 0, y_mm: 0 });

    const rad = Math.PI / 4;
    const mx = armLen * Math.cos(rad);
    const my = armLen * Math.sin(rad);
    
    const motorMass = state.selections.motor ? state.selections.motor.mass_g : (fixed ? fixed.motor_each_g : 35);
    const propMass = state.selections.propeller ? (state.selections.propeller.mass_g_each || 15) : 15;

    // Motors ×4
    components.push({ name: 'Motor FR', mass_g: motorMass, x_mm: mx, y_mm: my });
    components.push({ name: 'Motor FL', mass_g: motorMass, x_mm: -mx, y_mm: my });
    components.push({ name: 'Motor RR', mass_g: motorMass, x_mm: mx, y_mm: -my });
    components.push({ name: 'Motor RL', mass_g: motorMass, x_mm: -mx, y_mm: -my });

    // Propellers ×4
    components.push({ name: 'Propeller FR', mass_g: propMass, x_mm: mx, y_mm: my });
    components.push({ name: 'Propeller FL', mass_g: propMass, x_mm: -mx, y_mm: my });
    components.push({ name: 'Propeller RR', mass_g: propMass, x_mm: mx, y_mm: -my });
    components.push({ name: 'Propeller RL', mass_g: propMass, x_mm: -mx, y_mm: -my });

    // ESCs ×4
    components.push({ name: 'ESC FR', mass_g: fixed.esc_each_g, x_mm: mx*0.5, y_mm: my*0.5 });
    components.push({ name: 'ESC FL', mass_g: fixed.esc_each_g, x_mm: -mx*0.5, y_mm: my*0.5 });
    components.push({ name: 'ESC RR', mass_g: fixed.esc_each_g, x_mm: mx*0.5, y_mm: -my*0.5 });
    components.push({ name: 'ESC RL', mass_g: fixed.esc_each_g, x_mm: -mx*0.5, y_mm: -my*0.5 });

    // Arms tubes
    const armTubeMass = Math.round((armLen * 2 / 450) * 18);
    components.push({ name: 'Arm FR', mass_g: armTubeMass, x_mm: mx*0.5, y_mm: my*0.5 });
    components.push({ name: 'Arm FL', mass_g: armTubeMass, x_mm: -mx*0.5, y_mm: my*0.5 });
    components.push({ name: 'Arm RR', mass_g: armTubeMass, x_mm: mx*0.5, y_mm: -my*0.5 });
    components.push({ name: 'Arm RL', mass_g: armTubeMass, x_mm: -mx*0.5, y_mm: -my*0.5 });

    if (battery) components.push({ name: 'Battery', mass_g: battery.mass_g, x_mm: state.selections.battery_pos.x, y_mm: state.selections.battery_pos.y });
    if (payloads && payloads.length > 0) {
      payloads.forEach(function (p) {
        const base = getPayloadBaseOffset(p.id, frame);
        components.push({
          name: p.label,
          mass_g: p.mass_g,
          x_mm: base.x + state.selections.payload_pos.x,
          y_mm: base.y + state.selections.payload_pos.y
        });
      });
    }

    const cg = Calc.solveCenterOfGravity(components);
    state.calculations = cg;

    DroneModel.rebuildScene(state.selections, 1);
    DroneModel.updateCGFeedback(cg);

    UI.updateChecklist(state.selections, cg.offset_mm);
    drawEnvelopePlot(cg.x_cg, cg.y_cg);

    const totalMassLabel = document.getElementById('calcTotalMassVal');
    if (totalMassLabel) totalMassLabel.textContent = cg.total_mass_g.toFixed(5) + " g";
    const totalMassFormula = document.getElementById('calcTotalMassFormula');
    if (totalMassFormula) {
      let formulaText = `<i>m</i><sub>frame</sub>(${frame ? frame.mass_g.toFixed(1) : 100}) + <i>m</i><sub>bat</sub>(${battery ? battery.mass_g.toFixed(1) : 0})`;
      if (payloads && payloads.length > 0) {
        const payloadMass = payloads.reduce((sum, p) => sum + p.mass_g, 0);
        formulaText += ` + <i>m</i><sub>payloads</sub>(${payloadMass.toFixed(1)})`;
      }
      formulaText += ` + <i>m</i><sub>fixed</sub>(${(electronicsMass + motorMass*4 + propMass*4 + fixed.esc_each_g*4 + armTubeMass*4).toFixed(1)})`;
      totalMassFormula.innerHTML = formulaText;
    }

    const momentXLabel = document.getElementById('calcMomentXVal');
    if (momentXLabel) momentXLabel.textContent = cg.sum_mx.toFixed(5) + " g·mm";
    const momentXFormula = document.getElementById('calcMomentXFormula');
    if (momentXFormula) {
      let formulaText = `&Sigma;(<i>m</i>&middot;<i>x</i>) = <i>m</i><sub>bat</sub>(${battery ? battery.mass_g.toFixed(1) : 0})&times;(${state.selections.battery_pos.x.toFixed(2)})`;
      if (payloads && payloads.length > 0) {
        payloads.forEach(function (p) {
          const base = getPayloadBaseOffset(p.id, frame);
          const px_mm = base.x + state.selections.payload_pos.x;
          formulaText += ` + <i>m</i><sub>${p.id.split('_')[0]}</sub>(${p.mass_g.toFixed(1)})&times;(${px_mm.toFixed(2)})`;
        });
      }
      momentXFormula.innerHTML = formulaText;
    }

    const momentYLabel = document.getElementById('calcMomentYVal');
    if (momentYLabel) momentYLabel.textContent = cg.sum_my.toFixed(5) + " g·mm";
    const momentYFormula = document.getElementById('calcMomentYFormula');
    if (momentYFormula) {
      let formulaText = `&Sigma;(<i>m</i>&middot;<i>y</i>) = <i>m</i><sub>bat</sub>(${battery ? battery.mass_g.toFixed(1) : 0})&times;(${state.selections.battery_pos.y.toFixed(2)})`;
      if (payloads && payloads.length > 0) {
        payloads.forEach(function (p) {
          const base = getPayloadBaseOffset(p.id, frame);
          const py_mm = base.y + state.selections.payload_pos.y;
          formulaText += ` + <i>m</i><sub>${p.id.split('_')[0]}</sub>(${p.mass_g.toFixed(1)})&times;(${py_mm.toFixed(2)})`;
        });
      }
      momentYFormula.innerHTML = formulaText;
    }

    const cgXLabel = document.getElementById('calcCgXVal');
    if (cgXLabel) cgXLabel.textContent = cg.x_cg.toFixed(5) + " mm";

    const cgYLabel = document.getElementById('calcCgYVal');
    if (cgYLabel) cgYLabel.textContent = cg.y_cg.toFixed(5) + " mm";

    const cgRLabel = document.getElementById('calcCgRVal');
    if (cgRLabel) cgRLabel.textContent = cg.offset_mm.toFixed(5) + " mm";

    const optimalCogReadout = document.getElementById('optimalCogReadout');
    if (optimalCogReadout) {
      if (cg.offset_mm < 5.0) {
        const statusSuffix = cg.offset_mm < 0.001 ? "(LOCKED - PERFECT)" : "(LOCKED - STABLE)";
        optimalCogReadout.textContent = `x: ${cg.x_cg.toFixed(5)} mm | y: ${cg.y_cg.toFixed(5)} mm ${statusSuffix}`;
        optimalCogReadout.style.backgroundColor = 'var(--success-light)';
        optimalCogReadout.style.color = '#065f46';
        optimalCogReadout.style.borderColor = '#a7f3d0';
      } else {
        optimalCogReadout.textContent = `x: ${cg.x_cg.toFixed(5)} mm | y: ${cg.y_cg.toFixed(5)} mm`;
        optimalCogReadout.style.backgroundColor = 'var(--surface-2)';
        optimalCogReadout.style.color = 'var(--text-secondary)';
        optimalCogReadout.style.borderColor = 'var(--border)';
      }
    }

    const commentary = document.getElementById('liveCommentaryText');
    if (commentary) {
      if (cg.offset_mm < 0.001) {
        commentary.innerHTML = `<strong>Perfect Balance!</strong> Center of Gravity offset is under the extreme precision limit (current: <strong>${cg.offset_mm.toFixed(5)} mm</strong>). Click <strong>Start Flight Test</strong> to hover perfectly.`;
      } else if (cg.offset_mm < 5.0) {
        commentary.innerHTML = `<strong>Stable Balance!</strong> Center of Gravity offset is <strong>${cg.offset_mm.toFixed(5)} mm</strong> (within the 5.0 mm FC compensation threshold). The flight controller can stabilize this safely. Click <strong>Start Flight Test</strong>.`;
      } else if (cg.offset_mm < 10.0) {
        commentary.innerHTML = `<strong>Semi-balanced:</strong> Center of Gravity offset is <strong>${cg.offset_mm.toFixed(5)} mm</strong>. This exceeds the 5.0 mm safe hover limit. The drone will experience drift and instability during flight.`;
      } else {
        commentary.innerHTML = `<strong>Severe Unbalance!</strong> Center of Gravity offset is <strong>${cg.offset_mm.toFixed(5)} mm</strong>. The drone will tilt severely and crash on takeoff. Adjust battery/payload sliders to center it.`;
      }
    }
  }

  function drawHeatmap(x_cg, y_cg) {
    const canvas = document.getElementById('droneHeatmapCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width = canvas.clientWidth * window.devicePixelRatio;
    const h = canvas.height = canvas.clientHeight * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    const cw = w / window.devicePixelRatio;
    const ch = h / window.devicePixelRatio;

    const centerX = cw / 2;
    const centerY = ch / 2;
    const radius = Math.min(cw, ch) * 0.45;

    const frame = state.selections.frame;
    const battery = state.selections.battery;
    const payloads = state.selections.payloads;
    const armLen = frame ? frame.wheelbase_mm / 2 : 225;
    const d = armLen * Math.cos(Math.PI / 4);

    // Weight shares
    const w_FR = 0.25 * (1 + x_cg/d + y_cg/d);
    const w_FL = 0.25 * (1 - x_cg/d + y_cg/d);
    const w_RR = 0.25 * (1 + x_cg/d - y_cg/d);
    const w_RL = 0.25 * (1 - x_cg/d - y_cg/d);

    const isSafe = Math.sqrt(x_cg * x_cg + y_cg * y_cg) < 5.0;

    const getColorForDensity = (d) => {
      let r, g, b;
      if (d < 0.3) {
        const t = d / 0.3;
        r = Math.round(15 + t * (16 - 15));
        g = Math.round(94 + t * (185 - 94));
        b = Math.round(162 + t * (129 - 162));
      } else if (d < 0.6) {
        const t = (d - 0.3) / 0.3;
        r = Math.round(16 + t * (234 - 16));
        g = Math.round(185 + t * (179 - 185));
        b = Math.round(129 + t * (8 - 129));
      } else {
        const t = Math.min((d - 0.6) / 0.4, 1.0);
        r = Math.round(234 + t * (239 - 234));
        g = Math.round(179 + t * (68 - 179));
        b = Math.round(8 + t * (68 - 8));
      }
      return `rgb(${r},${g},${b})`;
    };

    const scaleFactor = frame ? 0.70 + (frame.wheelbase_mm - 250) / (850 - 250) * 0.20 : 0.85;
    const armLenPx = radius * scaleFactor;
    
    const motorFR = { x: centerX + armLenPx * Math.cos(Math.PI/4), y: centerY - armLenPx * Math.sin(Math.PI/4) };
    const motorFL = { x: centerX - armLenPx * Math.cos(Math.PI/4), y: centerY - armLenPx * Math.sin(Math.PI/4) };
    const motorRR = { x: centerX + armLenPx * Math.cos(Math.PI/4), y: centerY + armLenPx * Math.sin(Math.PI/4) };
    const motorRL = { x: centerX - armLenPx * Math.cos(Math.PI/4), y: centerY + armLenPx * Math.sin(Math.PI/4) };

    const batX = centerX + (state.selections.battery_pos.x / armLen) * armLenPx * 0.9;
    const batY = centerY - (state.selections.battery_pos.y / armLen) * armLenPx * 0.9;

    if (!window._offscreenCanvas) {
      window._offscreenCanvas = document.createElement('canvas');
    }
    const offCanvas = window._offscreenCanvas;
    const offW = 96;
    const offH = 96;
    offCanvas.width = offW;
    offCanvas.height = offH;
    const offCtx = offCanvas.getContext('2d');

    const offCenterX = offW / 2;
    const offCenterY = offH / 2;
    
    const scaleOff = offW / cw;
    
    const offFR = { x: offCenterX + armLenPx * scaleOff * Math.cos(Math.PI/4), y: offCenterY - armLenPx * scaleOff * Math.sin(Math.PI/4) };
    const offFL = { x: offCenterX - armLenPx * scaleOff * Math.cos(Math.PI/4), y: offCenterY - armLenPx * scaleOff * Math.sin(Math.PI/4) };
    const offRR = { x: offCenterX + armLenPx * scaleOff * Math.cos(Math.PI/4), y: offCenterY + armLenPx * scaleOff * Math.sin(Math.PI/4) };
    const offRL = { x: offCenterX - armLenPx * scaleOff * Math.cos(Math.PI/4), y: offCenterY + armLenPx * scaleOff * Math.sin(Math.PI/4) };

    const offBatX = offCenterX + ((state.selections.battery_pos.x / armLen) * armLenPx * 0.9) * scaleOff;
    const offBatY = offCenterY - ((state.selections.battery_pos.y / armLen) * armLenPx * 0.9) * scaleOff;

    for (let gy = 0; gy < offH; gy++) {
      for (let gx = 0; gx < offW; gx++) {
        const d_deck = Math.pow(gx - offCenterX, 2) + Math.pow(gy - offCenterY, 2);
        const d_fr = Math.pow(gx - offFR.x, 2) + Math.pow(gy - offFR.y, 2);
        const d_fl = Math.pow(gx - offFL.x, 2) + Math.pow(gy - offFL.y, 2);
        const d_rr = Math.pow(gx - offRR.x, 2) + Math.pow(gy - offRR.y, 2);
        const d_rl = Math.pow(gx - offRL.x, 2) + Math.pow(gy - offRL.y, 2);

        let density = 0.02; // blue background
        
        density += 0.08 * Math.exp(-d_deck / (2 * (18 * scaleOff) * (18 * scaleOff)));
        
        if (battery) {
          const d_bat = Math.pow(gx - offBatX, 2) + Math.pow(gy - offBatY, 2);
          density += 0.12 * Math.exp(-d_bat / (2 * (12 * scaleOff) * (12 * scaleOff)));
        }
        
        if (payloads && payloads.length > 0) {
          payloads.forEach(p => {
            const base = getPayloadBaseOffset(p.id, frame);
            const px_mm = base.x + state.selections.payload_pos.x;
            const py_mm = base.y + state.selections.payload_pos.y;
            const pX = offCenterX + (((px_mm / armLen) * armLenPx * 0.9) * scaleOff);
            const pY = offCenterY - (((py_mm / armLen) * armLenPx * 0.9) * scaleOff);
            const d_pay = Math.pow(gx - pX, 2) + Math.pow(gy - pY, 2);
            density += 0.10 * Math.exp(-d_pay / (2 * (10 * scaleOff) * (10 * scaleOff)));
          });
        }

        const armWidthSq = 2 * (14 * scaleOff) * (14 * scaleOff);
        const getDistanceToSegmentSq = (x0, y0, x1, y1) => {
          const dx = x1 - x0;
          const dy = y1 - y0;
          const lenSq = dx * dx + dy * dy;
          if (lenSq === 0) return Math.pow(gx - x0, 2) + Math.pow(gy - y0, 2);
          let t = ((gx - x0) * dx + (gy - y0) * dy) / lenSq;
          t = Math.max(0, Math.min(1, t));
          return Math.pow(gx - (x0 + t * dx), 2) + Math.pow(gy - (y0 + t * dy), 2);
        };

        const d_arm_fr = getDistanceToSegmentSq(offCenterX, offCenterY, offFR.x, offFR.y);
        const d_arm_fl = getDistanceToSegmentSq(offCenterX, offCenterY, offFL.x, offFL.y);
        const d_arm_rr = getDistanceToSegmentSq(offCenterX, offCenterY, offRR.x, offRR.y);
        const d_arm_rl = getDistanceToSegmentSq(offCenterX, offCenterY, offRL.x, offRL.y);

        const getQuadrantLoad = (d_arm, d_motor, w_quad) => {
          let peak = 0.45 + (w_quad - 0.25) * 6.5;
          peak = Math.min(Math.max(peak, 0.05), 0.96);
          const armDensity = peak * Math.exp(-d_arm / armWidthSq);
          const motorDensity = peak * Math.exp(-d_motor / (2 * (16 * scaleOff) * (16 * scaleOff)));
          return Math.max(armDensity, motorDensity);
        };

        const arm_fr_val = getQuadrantLoad(d_arm_fr, d_fr, w_FR);
        const arm_fl_val = getQuadrantLoad(d_arm_fl, d_fl, w_FL);
        const arm_rr_val = getQuadrantLoad(d_arm_rr, d_rr, w_RR);
        const arm_rl_val = getQuadrantLoad(d_arm_rl, d_rl, w_RL);

        density += Math.max(arm_fr_val, arm_fl_val, arm_rr_val, arm_rl_val);

        const d_norm = Math.min(Math.max(density, 0.0), 1.0);
        offCtx.fillStyle = getColorForDensity(d_norm);
        offCtx.fillRect(gx, gy, 1, 1);
      }
    }

    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(offCanvas, 0, 0, cw, ch);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 0.6;
    const gridSpace = 16;
    for (let x = 0; x < cw; x += gridSpace) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ch); ctx.stroke();
    }
    for (let y = 0; y < ch; y += gridSpace) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cw, y); ctx.stroke();
    }

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.4;
    const deckW = (frame ? frame.body_size_mm[0] : 88) * 0.38 * (radius / 100);
    const deckH = (frame ? frame.body_size_mm[2] : 88) * 0.38 * (radius / 100);

    ctx.beginPath();
    ctx.moveTo(centerX - deckW * 0.35, centerY - deckH * 0.5);
    ctx.lineTo(centerX + deckW * 0.35, centerY - deckH * 0.5);
    ctx.lineTo(centerX + deckW * 0.5, centerY - deckH * 0.3);
    ctx.lineTo(centerX + deckW * 0.5, centerY + deckH * 0.3);
    ctx.lineTo(centerX + deckW * 0.35, centerY + deckH * 0.5);
    ctx.lineTo(centerX - deckW * 0.35, centerY + deckH * 0.5);
    ctx.lineTo(centerX - deckW * 0.5, centerY + deckH * 0.3);
    ctx.lineTo(centerX - deckW * 0.5, centerY - deckH * 0.3);
    ctx.closePath();
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1.6;
    ctx.strokeRect(centerX - deckW * 0.22, centerY - deckH * 0.35, deckW * 0.44, deckH * 0.7);

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.6;
    const standoffOffsets = [
      [-deckW * 0.4, -deckH * 0.42], [deckW * 0.4, -deckH * 0.42],
      [-deckW * 0.4, deckH * 0.42], [deckW * 0.4, deckH * 0.42]
    ];
    standoffOffsets.forEach(off => {
      ctx.beginPath();
      ctx.arc(centerX + off[0], centerY + off[1], 1.8, 0, Math.PI * 2);
      ctx.stroke();
    });

    const armR = frame ? (frame.arm_tube_od_mm / 2) * 0.3 * (radius / 100) : 3;
    const shares = [
      { label: 'FR', val: w_FR, x: motorFR.x, y: motorFR.y },
      { label: 'FL', val: w_FL, x: motorFL.x, y: motorFL.y },
      { label: 'RR', val: w_RR, x: motorRR.x, y: motorRR.y },
      { label: 'RL', val: w_RL, x: motorRL.x, y: motorRL.y }
    ];

    shares.forEach(s => {
      const angle = Math.atan2(s.y - centerY, s.x - centerX);
      const perp = angle + Math.PI / 2;
      const armWidthOuter = armR * 1.5;
      const armWidthInner = armR * 0.8;

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(centerX + deckW * 0.35 * Math.cos(angle) + armWidthOuter * Math.cos(perp), centerY + deckH * 0.35 * Math.sin(angle) + armWidthOuter * Math.sin(perp));
      ctx.lineTo(s.x - 9 * Math.cos(angle) + armWidthInner * Math.cos(perp), s.y - 9 * Math.sin(angle) + armWidthInner * Math.sin(perp));
      ctx.lineTo(s.x - 9 * Math.cos(angle) - armWidthInner * Math.cos(perp), s.y - 9 * Math.sin(angle) - armWidthInner * Math.sin(perp));
      ctx.lineTo(centerX + deckW * 0.35 * Math.cos(angle) - armWidthOuter * Math.cos(perp), centerY + deckH * 0.35 * Math.sin(angle) - armWidthOuter * Math.sin(perp));
      ctx.stroke();

      for (let j = 0.35; j <= 0.75; j += 0.2) {
        const hx = centerX + (s.x - centerX) * j;
        const hy = centerY + (s.y - centerY) * j;
        ctx.beginPath();
        ctx.arc(hx, hy, armR * 0.5, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, armR * 2.2, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1.2;
      for (let c = 0; c < 4; c++) {
        const cAngle = (c * Math.PI) / 2;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x + armR * 1.5 * Math.cos(cAngle), s.y + armR * 1.5 * Math.sin(cAngle));
        ctx.stroke();
      }

      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
      ctx.lineWidth = 1.2;
      
      const prop = state.selections.propeller;
      const propRadiusPx = prop ? (prop.diameter_m * 180 * (radius / 100)) : (armLenPx * 0.45);
      const rotVal = Date.now() * 0.0016 * (s.x > centerX ? 1 : -1);
      ctx.rotate(rotVal);

      for (let b = 0; b < 2; b++) {
        const bAngle = b * Math.PI;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(
          propRadiusPx * 0.4 * Math.cos(bAngle + 0.1), propRadiusPx * 0.4 * Math.sin(bAngle + 0.1),
          propRadiusPx * 0.8 * Math.cos(bAngle + 0.05), propRadiusPx * 0.8 * Math.sin(bAngle + 0.05),
          propRadiusPx * Math.cos(bAngle), propRadiusPx * Math.sin(bAngle)
        );
        ctx.bezierCurveTo(
          propRadiusPx * 0.8 * Math.cos(bAngle - 0.05), propRadiusPx * 0.8 * Math.sin(bAngle - 0.05),
          propRadiusPx * 0.4 * Math.cos(bAngle - 0.1), propRadiusPx * 0.4 * Math.sin(bAngle - 0.1),
          0, 0
        );
        ctx.stroke();
      }
      ctx.restore();
    });

    if (battery) {
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(batX - 10, batY - 14, 20, 28);
      ctx.fillStyle = 'rgba(239, 68, 68, 0.2)';
      ctx.fillRect(batX - 10, batY - 14, 20, 28);
      
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 7px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('BAT', batX, batY + 2.5);
    }

    if (payloads && payloads.length > 0) {
      payloads.forEach(p => {
        const base = getPayloadBaseOffset(p.id, frame);
        const px_mm = base.x + state.selections.payload_pos.x;
        const py_mm = base.y + state.selections.payload_pos.y;
        
        const pX = centerX + (px_mm / armLen) * armLenPx * 0.9;
        const pY = centerY - (py_mm / armLen) * armLenPx * 0.9;

        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(pX, pY, 9, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(56, 189, 248, 0.2)';
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 7px sans-serif';
        ctx.textAlign = 'center';

        let abbr = 'PLD';
        if (p.id.includes('gopro')) abbr = 'GPR';
        else if (p.id.includes('fpv_nano')) abbr = 'CAM';
        else if (p.id.includes('gimbal')) abbr = 'GMB';
        else if (p.id.includes('gps')) abbr = 'GPS';
        else if (p.id.includes('vtx')) abbr = 'VTX';
        else if (p.id.includes('telemetry')) abbr = 'TEL';
        else if (p.id.includes('lidar')) abbr = 'LDR';

        ctx.fillText(abbr, pX, pY + 2.5);
      });
    }

    shares.forEach(s => {
      const pct = Math.max(0, s.val * 100);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      
      ctx.fillText(`${pct.toFixed(2)}%`, s.x, s.y + (s.y > centerY ? 18 : -10));
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.fillText(s.label, s.x, s.y + (s.y > centerY ? 28 : -20));
    });

    const cgX = centerX + (x_cg / armLen) * armLenPx * 0.9;
    const cgY = centerY - (y_cg / armLen) * armLenPx * 0.9;
    
    ctx.strokeStyle = isSafe ? '#10b981' : '#ef4444';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cgX - 10, cgY); ctx.lineTo(cgX + 10, cgY);
    ctx.moveTo(cgX, cgY - 10); ctx.lineTo(cgX, cgY + 10);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cgX, cgY, 4, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawVibrationGraph() {
    const canvas = document.getElementById('vibrationCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width = canvas.clientWidth * window.devicePixelRatio;
    const h = canvas.height = canvas.clientHeight * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    const cw = w / window.devicePixelRatio;
    const ch = h / window.devicePixelRatio;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cw, ch);

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.06)';
    ctx.lineWidth = 0.8;
    
    ctx.beginPath();
    ctx.moveTo(0, ch / 2 - 40);
    ctx.lineTo(cw, ch / 2 - 40);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, ch / 2 + 40);
    ctx.lineTo(cw, ch / 2 + 40);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, ch / 2);
    ctx.lineTo(cw, ch / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#9ca3af';
    ctx.font = '8px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('+150°/s', 6, ch / 2 - 42);
    ctx.fillText('0°/s', 6, ch / 2 - 4);
    ctx.fillText('-150°/s', 6, ch / 2 + 38);

    if (!state.rollVibrationPoints) {
      state.rollVibrationPoints = Array(120).fill(0);
    }
    if (!state.pitchVibrationPoints) {
      state.pitchVibrationPoints = Array(120).fill(0);
    }

    let rollVal = 0;
    let pitchVal = 0;

    if (state.isFlying) {
      const cg = state.calculations;
      const t = Date.now() * 0.001;
      
      let motorAmp = 1.2;
      if (cg.offset_mm >= 5.0) {
        const timeFactor = Math.min(state.flightTime, 3.2);
        motorAmp = 2.0 + (cg.offset_mm / 10.0) * 3.0 * (1.0 + timeFactor * 0.5);
      } else if (cg.offset_mm > 0.001) {
        motorAmp = 1.2 + (cg.offset_mm / 5.0) * 1.0;
      }

      const motorRoll = Math.sin(t * 55) * motorAmp + (Math.random() - 0.5) * motorAmp * 0.5;
      const motorPitch = Math.cos(t * 60) * motorAmp + (Math.random() - 0.5) * motorAmp * 0.5;

      const wobbleFreqRoll = 4.0;
      const wobbleFreqPitch = 3.6;
      const wobbleAmpRoll = cg.x_cg * 0.8;
      const wobbleAmpPitch = cg.y_cg * 0.8;

      const wobbleRoll = Math.sin(t * wobbleFreqRoll) * wobbleAmpRoll;
      const wobblePitch = Math.cos(t * wobbleFreqPitch) * wobbleAmpPitch;

      let biasRoll = cg.x_cg * 0.6;
      let biasPitch = -cg.y_cg * 0.6;

      if (cg.offset_mm >= 5.0) {
        const timeFactor = Math.min(state.flightTime, 3.2);
        const crashScale = 1.0 + timeFactor * 1.5;
        rollVal = biasRoll * crashScale + wobbleRoll * crashScale + motorRoll * (1.0 + timeFactor * 0.4);
        pitchVal = biasPitch * crashScale + wobblePitch * crashScale + motorPitch * (1.0 + timeFactor * 0.4);
      } else {
        rollVal = biasRoll + wobbleRoll + motorRoll;
        pitchVal = biasPitch + wobblePitch + motorPitch;
      }
    }

    state.rollVibrationPoints.shift();
    state.rollVibrationPoints.push(rollVal);

    state.pitchVibrationPoints.shift();
    state.pitchVibrationPoints.push(pitchVal);

    const step = cw / (state.rollVibrationPoints.length - 1);

    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < state.rollVibrationPoints.length; i++) {
      const x = i * step;
      const y = ch / 2 - state.rollVibrationPoints[i] * 4;
      const clampedY = Math.max(4, Math.min(ch - 4, y));
      if (i === 0) ctx.moveTo(x, clampedY);
      else ctx.lineTo(x, clampedY);
    }
    ctx.stroke();

    ctx.strokeStyle = '#f97316';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < state.pitchVibrationPoints.length; i++) {
      const x = i * step;
      const y = ch / 2 - state.pitchVibrationPoints[i] * 4;
      const clampedY = Math.max(4, Math.min(ch - 4, y));
      if (i === 0) ctx.moveTo(x, clampedY);
      else ctx.lineTo(x, clampedY);
    }
    ctx.stroke();

    // Setup status string
    let statusStr = "IMU GYRO: STANDBY";
    if (state.isFlying) {
      statusStr = state.calculations.offset_mm < 5.0 ? (state.calculations.offset_mm < 0.001 ? "IMU GYRO: PERFECT HOVER" : "IMU GYRO: COMPENSATED HOVER") : "IMU GYRO: UNSTABLE SHAKE";
    }

    // Measure text to decide layout dynamically
    ctx.font = 'bold 9px monospace';
    const statusWidth = ctx.measureText(statusStr).width;

    // Draw status string
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'left';
    ctx.fillText(statusStr, 8, 14);

    ctx.font = 'bold 8px sans-serif';
    if (cw - 220 > statusWidth + 15) {
      // Inline horizontal layout if canvas is wide enough
      ctx.fillStyle = '#f97316';
      ctx.fillRect(cw - 210, 7, 8, 8);
      ctx.fillStyle = '#374151';
      ctx.fillText('Pitch Rate (Gyro Y)', cw - 198, 14);

      ctx.fillStyle = '#06b6d4';
      ctx.fillRect(cw - 105, 7, 8, 8);
      ctx.fillStyle = '#374151';
      ctx.fillText('Roll Rate (Gyro X)', cw - 93, 14);
    } else {
      // Stacked vertical layout to guarantee zero overlap on narrow layouts
      ctx.fillStyle = '#f97316';
      ctx.fillRect(cw - 110, 18, 8, 8);
      ctx.fillStyle = '#374151';
      ctx.fillText('Pitch Rate (Gyro Y)', cw - 98, 25);

      ctx.fillStyle = '#06b6d4';
      ctx.fillRect(cw - 110, 29, 8, 8);
      ctx.fillStyle = '#374151';
      ctx.fillText('Roll Rate (Gyro X)', cw - 98, 36);
    }
  }

  function setup3DDrag() {
    const canvas = document.getElementById('droneCanvas');
    if (!canvas) return;

    let activeDrag = null;
    let dragPlane = new THREE.Plane();
    let dragOffset = new THREE.Vector3();
    let raycaster = new THREE.Raycaster();
    let mouse = new THREE.Vector2();
    let dragPlaneNormal = new THREE.Vector3(0, 1, 0);
    let isDragging = false;

    canvas.addEventListener('pointerdown', function (event) {
      if (!Scene.getRenderer() || state.isFlying) return;
      const rect = Scene.getRenderer().domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, Scene.getCamera());
      const sc = Scene.getScene();
      const intersects = raycaster.intersectObjects(sc.children, true);

      let hitObj = null;
      let hitName = null;

      for (let i = 0; i < intersects.length; i++) {
        let obj = intersects[i].object;
        while (obj && obj !== sc) {
          if (obj === DroneModel.batteryMesh()) { hitObj = DroneModel.batteryMesh(); hitName = 'battery'; break; }
          else if (obj === DroneModel.payloadMesh() || (DroneModel.payloadMesh() && DroneModel.payloadMesh().getObjectById(obj.id))) {
            hitObj = DroneModel.payloadMesh();
            hitName = 'payload';
            break;
          }
          obj = obj.parent;
        }
        if (hitName) break;
      }

      if (hitObj) {
        activeDrag = hitName;
        isDragging = true;
        Scene.getControls().enabled = false;

        dragPlane.setFromNormalAndCoplanarPoint(dragPlaneNormal, hitObj.position);
        let intersectPoint = new THREE.Vector3();
        raycaster.ray.intersectPlane(dragPlane, intersectPoint);
        dragOffset.copy(hitObj.position).sub(intersectPoint);
      }
    }, false);

    canvas.addEventListener('pointermove', function (event) {
      if (!isDragging || !activeDrag || state.isFlying) return;

      const rect = Scene.getRenderer().domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, Scene.getCamera());
      let intersectPoint = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(dragPlane, intersectPoint)) {
        const targetPos = intersectPoint.add(dragOffset);
        let x_mm = targetPos.x * 1000;
        let y_mm = -targetPos.z * 1000;

        const frame = state.selections.frame;
        const halfW = frame ? frame.body_size_mm[0] / 2 : 44;
        const halfL = frame ? frame.body_size_mm[2] / 2 : 44;

        if (activeDrag === 'battery') {
          const cx = Math.max(-halfW + 10, Math.min(halfW - 10, x_mm));
          const cy = Math.max(-halfL + 15, Math.min(halfL - 15, y_mm));
          state.selections.battery_pos = { x: cx, y: cy };
          updateSliderInput('batX', cx, 'batXVal');
          updateSliderInput('batY', cy, 'batYVal');
        } else if (activeDrag === 'payload') {
          const cx = Math.max(-halfW + 8, Math.min(halfW - 8, x_mm));
          const cy = Math.max(-halfL + 8, Math.min(halfL - 8, y_mm));
          state.selections.payload_pos = { x: cx, y: cy };
          updateSliderInput('payloadX', cx, 'payloadXVal');
          updateSliderInput('payloadY', cy, 'payloadYVal');
        }
        refresh();
      }
    }, false);

    window.addEventListener('pointerup', function () {
      if (isDragging) {
        isDragging = false;
        activeDrag = null;
        Scene.getControls().enabled = true;
      }
    }, false);
  }

  function updateSliderInput(sliderId, val, labelId) {
    const s = document.getElementById(sliderId);
    const l = document.getElementById(labelId);
    if (s) s.value = val;
    if (l) l.textContent = Math.round(val) + ' mm';
  }

  function drawEnvelopePlot(x_cg, y_cg) {
    const ctx = document.getElementById('cgEnvelopeCanvas');
    if (!ctx) return;

    const circleData = [];
    const steps = 40;
    for (let i = 0; i <= steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      circleData.push({ x: Math.cos(angle) * 10, y: Math.sin(angle) * 10 });
    }

    const isSafe = Math.sqrt(x_cg * x_cg + y_cg * y_cg) < 10.0;
    const cgDotColor = isSafe ? '#10b981' : '#ef4444';

    if (cgChart) {
      cgChart.data.datasets[1].data = [{ x: x_cg, y: y_cg }];
      cgChart.data.datasets[1].pointBackgroundColor = cgDotColor;
      cgChart.data.datasets[1].pointBorderColor = cgDotColor;
      cgChart.update('none');
    } else {
      cgChart = new Chart(ctx, {
        type: 'scatter',
        data: {
          datasets: [
            {
              label: '10mm Safe Boundary',
              data: circleData,
              showLine: true,
              fill: true,
              backgroundColor: 'rgba(16, 185, 129, 0.05)',
              borderColor: 'rgba(16, 185, 129, 0.45)',
              borderWidth: 1.5,
              borderDash: [4, 4],
              pointRadius: 0
            },
            {
              label: 'Center of Gravity',
              data: [{ x: x_cg, y: y_cg }],
              pointBackgroundColor: cgDotColor,
              pointBorderColor: cgDotColor,
              pointRadius: 6,
              borderWidth: 2
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { min: -30, max: 30, title: { display: true, text: 'X (mm)', font: { size: 10 } }, grid: { color: '#f3f4f6' } },
            y: { min: -30, max: 30, title: { display: true, text: 'Y (mm)', font: { size: 10 } }, grid: { color: '#f3f4f6' } }
          }
        }
      });
    }
  }

  return {
    init,
    refresh,
    drawHeatmap,
    drawVibrationGraph,
    setup3DDrag,
    drawEnvelopePlot
  };
})();
window.VLAB = Module1;

// ═══════════════════════════════════════════════════════════════════
// 8. MODULE 2 ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════
const Module2 = (function () {
  'use strict';

  let matrix = {};
  let activeSelection = { length: 250, material: null };
  let isTesting = false;
  let stressChart = null;
  let sfdChart = null;
  let bmdChart = null;

  function init() {
    fetch('db/db.json')
      .then(res => res.json())
      .then(function (data) {
        database = data;

        const cgHandoff = localStorage.getItem('vlabModule2_cg');
        if (cgHandoff) {
          const hData = JSON.parse(cgHandoff);
          state.selections.frame = database.frames.find(f => f.id === hData.frame_id);
          state.selections.battery = database.batteries.find(b => b.id === hData.battery_id);
          if (hData.payload_ids && Array.isArray(hData.payload_ids) && database.payloads) {
            state.selections.payloads = database.payloads.filter(p => hData.payload_ids.includes(p.id));
          } else {
            const pObj = database.payloads.find(p => p.id === hData.payload_id);
            state.selections.payloads = pObj ? [pObj] : [database.payloads[0]];
          }
          state.selections.battery_pos = hData.battery_pos;
          state.selections.payload_pos = hData.payload_pos;
          state.calculations.offset_mm = hData.cg_offset_mm || hData.cg_offset_mm === 0 ? hData.cg_offset_mm : 0;
          state.calculations.total_mass_g = hData.total_mass_g || 780;
          
          if (hData.material_id && database.materials) {
            activeSelection.material = database.materials.find(m => m.id === hData.material_id) || database.materials[0];
          } else {
            activeSelection.material = database.materials[0];
          }
          if (typeof hData.arm_length_mm === 'number') {
            activeSelection.length = hData.arm_length_mm;
          } else {
            activeSelection.length = state.selections.frame ? state.selections.frame.arm_length_mm : 250;
          }
        } else {
          state.selections.frame = database.frames[2] || database.frames[0];
          state.selections.battery = database.batteries[2] || database.batteries[0];
          state.selections.payloads = [database.payloads[0]];
          state.calculations.total_mass_g = 780;
          activeSelection.material = database.materials[0];
          activeSelection.length = state.selections.frame ? state.selections.frame.arm_length_mm : 250;
        }

        const savedMatrix = localStorage.getItem('vlabModule2_matrix');
        if (savedMatrix) {
          try {
            matrix = JSON.parse(savedMatrix);
          } catch (e) {
            console.warn('Failed to parse vlabModule2_matrix:', e);
            matrix = {};
          }
        } else {
          matrix = {};
        }

        loadContinuationData();

        Scene.init(2);
        Mod2UI.buildControlTiles(database, activeSelection, onSelectMaterial, onSelectLength);
        bindListeners();
        drawEmptyMatrix();
        checkMatrixCompletion();
        refresh();
      })
      .catch(err => console.error('Module 2 failed to load database:', err));
  }

  function onSelectMaterial(item) {
    activeSelection.material = database.materials.find(x => x.id === item.id);
    saveStateToLocalStorage();
    refresh();
  }

  function onSelectLength(length) {
    activeSelection.length = length;
    saveStateToLocalStorage();
    refresh();
  }

  function saveStateToLocalStorage() {
    const cgData = {
      frame_id: state.selections.frame ? state.selections.frame.id : 'cf_450',
      battery_id: state.selections.battery ? state.selections.battery.id : 'bat_3s_2200',
      payload_ids: state.selections.payloads ? state.selections.payloads.map(p => p.id) : [],
      battery_pos: state.selections.battery_pos,
      payload_pos: state.selections.payload_pos,
      cg_offset_mm: state.calculations.offset_mm,
      total_mass_g: state.calculations.total_mass_g,
      material_id: activeSelection.material ? activeSelection.material.id : 'carbon_fibre',
      arm_length_mm: activeSelection.length
    };
    localStorage.setItem('vlabModule2_cg', JSON.stringify(cgData));
  }

  function bindListeners() {
    const btnTest = document.getElementById('btnStartTest');
    if (btnTest) {
      btnTest.addEventListener('click', function () {
        if (isTesting) return;
        runStressSweepAnimation();
      });
    }

    const titleEl = document.getElementById('configPanelTitle');
    const sectionsEl = document.getElementById('configSections');
    const chevronEl = document.getElementById('configPanelChevron');
    if (titleEl && sectionsEl && chevronEl) {
      titleEl.addEventListener('click', function () {
        const isCollapsed = sectionsEl.style.display === 'none';
        sectionsEl.style.display = isCollapsed ? 'flex' : 'none';
        chevronEl.style.transform = isCollapsed ? 'rotate(0deg)' : 'rotate(-90deg)';
      });
    }

    window.addEventListener('resize', () => Scene.resize());
  }

  function drawEmptyMatrix() {
    const container = document.getElementById('safetyMatrixContainer');
    if (!container) return;

    container.innerHTML = `
      <div class="matrix-header" style="font-size:0.6rem;">Material</div>
      <div class="matrix-header">150mm</div>
      <div class="matrix-header">250mm</div>
      <div class="matrix-header">350mm</div>
    `;

    database.materials.forEach(function (mat) {
      const rowLabel = document.createElement('div');
      rowLabel.className = 'matrix-label';
      rowLabel.textContent = mat.label.split(' ')[0];
      container.appendChild(rowLabel);

      [150, 250, 350].forEach(function (len) {
        const cell = document.createElement('div');
        const savedVal = matrix[`${mat.id}_${len}`];
        if (savedVal !== undefined) {
          if (savedVal === 0) {
            cell.className = 'matrix-cell fail';
            cell.textContent = 'FAIL';
          } else {
            cell.className = `matrix-cell ${savedVal >= 2.0 ? 'safe' : 'marginal'}`;
            cell.textContent = savedVal.toFixed(2);
          }
        } else {
          cell.className = 'matrix-cell empty';
          cell.textContent = '--';
        }
        cell.id = `cell_${mat.id}_${len}`;
        
        cell.addEventListener('click', function () {
          if (isTesting) return;
          
          activeSelection.length = len;
          activeSelection.material = mat;
          saveStateToLocalStorage();
          syncSelectionTiles();
          refresh();
        });
        container.appendChild(cell);
      });
    });
  }

  function syncSelectionTiles() {
    const matInputs = document.querySelectorAll('input[name="material"]');
    matInputs.forEach(input => {
      const isSel = input.value === activeSelection.material.id;
      input.checked = isSel;
      input.closest('.component-tile').classList.toggle('selected', isSel);
    });

    const lenInputs = document.querySelectorAll('input[name="length"]');
    lenInputs.forEach(input => {
      const isSel = parseInt(input.value) === activeSelection.length;
      input.checked = isSel;
      input.closest('.component-tile').classList.toggle('selected', isSel);
    });
  }

  function refresh() {
    const mat = activeSelection.material;
    const len = activeSelection.length;

    const proxySelections = {
      material: mat,
      frame: { arm_length_mm: len }
    };
    DroneModel.rebuildScene(proxySelections, 2);

    document.querySelectorAll('.matrix-cell').forEach(c => c.classList.remove('selected'));
    const activeCell = document.getElementById(`cell_${mat.id}_${len}`);
    if (activeCell) activeCell.classList.add('selected');

    const profile = state.selections.frame?.arm_profile || { b_mm: 15, h_mm: 8, t_mm: 1.5 };
    const b = profile.b_mm, h = profile.h_mm, t = profile.t_mm;
    const I = Calc.solveHollowInertia(b, h, t);

    const wEl = document.getElementById('armProfileW');
    const hEl = document.getElementById('armProfileH');
    const tEl = document.getElementById('armProfileT');
    if (wEl) wEl.innerHTML = `<strong>Width (b):</strong> ${b.toFixed(1)} mm`;
    if (hEl) hEl.innerHTML = `<strong>Height (h):</strong> ${h.toFixed(1)} mm`;
    if (tEl) tEl.innerHTML = `<strong>Wall Thickness (t):</strong> ${t.toFixed(1)} mm`;

    const I_sci = I.toExponential(4);
    document.getElementById('formulaInertia').innerHTML = `<i>I</i> = (<i>b</i>&times;<i>h</i><sup>3</sup> - (<i>b</i>-2<i>t</i>)&times;(<i>h</i>-2<i>t</i>)<sup>3</sup>) / 12 = ${I_sci} m<sup>4</sup>`;

    const savedVal = matrix[`${mat.id}_${len}`];
    const statusBadge = document.getElementById('hudStressStatus');

    if (savedVal !== undefined) {
      const motorMass = state.selections.motor ? state.selections.motor.mass_g : 35;
      const propMass = state.selections.propeller ? (state.selections.propeller.mass_g_each || 15) : 15;
      const T_max = state.selections.T_max !== undefined ? state.selections.T_max : 8.5;
      const forceData = Calc.solveTipForce(motorMass, propMass, T_max);
      const F_tip_limit = forceData.total_n;

      const M = Calc.solveBendingMoment(F_tip_limit, len);
      const stress = Calc.solveBendingStress(M, h, I);
      const sf = Calc.solveSafetyFactor(mat.yield_strength_mpa, stress);

      document.getElementById('hudStressMat').textContent = mat.label.split(' ')[0];
      document.getElementById('hudStressLen').textContent = len + ' mm';

      if (savedVal === 0 || stress >= mat.yield_strength_mpa) {
        document.getElementById('hudStressVal').textContent = stress.toFixed(2) + ' MPa';
        document.getElementById('hudSafetyFactor').textContent = 'FAIL';
        updateCalculationsPanel(F_tip_limit, M, stress, sf);
        drawBarChart(stress);
        updateSFDBMDDiagrams(F_tip_limit, len, b, h, t);
        DroneModel.applyCantileverLoad(F_tip_limit);
        
        if (statusBadge) {
          statusBadge.textContent = 'YIELD FAILURE!';
          statusBadge.style.color = 'var(--danger)';
        }
      } else {
        document.getElementById('hudStressVal').textContent = stress.toFixed(2) + ' MPa';
        document.getElementById('hudSafetyFactor').textContent = sf >= 90 ? '∞' : sf.toFixed(2);
        updateCalculationsPanel(F_tip_limit, M, stress, sf);
        drawBarChart(stress);
        updateSFDBMDDiagrams(F_tip_limit, len, b, h, t);
        DroneModel.applyCantileverLoad(F_tip_limit);
        
        if (statusBadge) {
          statusBadge.textContent = sf >= 2.0 ? 'SAFE (SF > 2)' : 'MARGINAL (SF < 2)';
          statusBadge.style.color = sf >= 2.0 ? 'var(--success)' : 'var(--warning)';
        }
      }
    } else {
      updateCalculationsPanel(0, 0, 0, 99);
      drawBarChart(0);
      updateSFDBMDDiagrams(0, len, b, h, t);
      DroneModel.applyCantileverLoad(0);

      document.getElementById('hudStressMat').textContent = mat.label.split(' ')[0];
      document.getElementById('hudStressLen').textContent = len + ' mm';
      document.getElementById('hudStressVal').textContent = '0.00 MPa';
      document.getElementById('hudSafetyFactor').textContent = '--';
      
      if (statusBadge) {
        statusBadge.textContent = 'READY TO TEST';
        statusBadge.style.color = 'var(--text-secondary)';
      }
    }
  }

  function updateCalculationsPanel(force, moment, stress, sf) {
    document.getElementById('formulaMoment').innerHTML = `<i>M</i> = <i>F</i> &times; <i>L</i> = ${force.toFixed(1)}N &times; ${(activeSelection.length/1000).toFixed(3)}m = ${moment.toFixed(4)} N&middot;m`;
    
    const profile = state.selections.frame?.arm_profile || { b_mm: 15, h_mm: 8, t_mm: 1.5 };
    const c = (profile.h_mm / 2.0) / 1000;
    document.getElementById('formulaStress').innerHTML = `&sigma; = (<i>M</i> &times; <i>c</i>) / <i>I</i> = (${moment.toFixed(4)} &times; ${c.toFixed(4)}) / <i>I</i> = ${stress.toFixed(2)} MPa`;
    
    const sfText = sf >= 90 ? '∞' : sf.toFixed(2);
    document.getElementById('formulaSafety').innerHTML = `<i>SF</i> = &sigma;<sub>yield</sub> / &sigma;<sub>applied</sub> = ${activeSelection.material.yield_strength_mpa} / ${stress.toFixed(2)} = ${sfText}`;
  }

  function runStressSweepAnimation() {
    const self = this;
    if (isTesting) return;
    isTesting = true;

    const btnTest = document.getElementById('btnStartTest');
    if (btnTest) btnTest.setAttribute('disabled', 'true');

    const commentary = document.getElementById('liveCommentaryText');
    if (commentary) {
      commentary.innerHTML = '<strong>Starting cantilever stress test...</strong> Watch the beam deflect as force ramps from 0 to maximum thrust.';
    }

    const motorMass = state.selections.motor ? state.selections.motor.mass_g : 35;
    const propMass = state.selections.propeller ? (state.selections.propeller.mass_g_each || 15) : 15;
    const T_max = state.selections.T_max !== undefined ? state.selections.T_max : 8.5;

    const forceData = Calc.solveTipForce(motorMass, propMass, T_max);
    const F_tip_limit = forceData.total_n;

    const mat = activeSelection.material;
    const len = activeSelection.length;
    
    const profile = state.selections.frame?.arm_profile || { b_mm: 15, h_mm: 8, t_mm: 1.5 };
    const b = profile.b_mm, h = profile.h_mm, t = profile.t_mm;
    const I = Calc.solveHollowInertia(b, h, t);

    let elapsed = 0;
    const duration = 2.0; 
    let failed = false;
    let lastTime = performance.now();

    function animate(now) {
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      elapsed += dt;
      const progress = Math.min(elapsed / duration, 1.0);
      const currentForce = F_tip_limit * progress;

      const M = Calc.solveBendingMoment(currentForce, len);
      const stress = Calc.solveBendingStress(M, h, I);
      const sf = Calc.solveSafetyFactor(mat.yield_strength_mpa, stress);

      DroneModel.applyCantileverLoad(currentForce);

      document.getElementById('hudStressVal').textContent = stress.toFixed(2) + ' MPa';
      document.getElementById('hudSafetyFactor').textContent = sf >= 90 ? '∞' : sf.toFixed(2);
      updateCalculationsPanel(currentForce, M, stress, sf);
      drawBarChart(stress);
      updateSFDBMDDiagrams(currentForce, len, b, h, t);

      if (sf < 2.0 && sf >= 1.0 && commentary) {
        commentary.innerHTML = '<strong>Warning:</strong> Safety Factor dropped below 2.0 — this arm length is marginal for ' + mat.label + '.';
      }

      if (stress >= mat.yield_strength_mpa) {
        failed = true;
        handleFailure(mat, len);
        if (commentary) {
          commentary.innerHTML = '<strong>Yield Failure!</strong> The applied bending stress exceeded ' + mat.label + "'s yield strength of " + mat.yield_strength_mpa + ' MPa. The arm fractured at the root clamp.';
        }
        return;
      }

      if (progress < 1.0) {
        requestAnimationFrame(animate);
      } else {
        handleSuccess(mat, len, sf);
        if (commentary) {
          commentary.innerHTML = '<strong>Passed!</strong> Safety Factor = ' + sf.toFixed(2) + '. The arm withstood full thrust load with adequate margin.';
        }
      }
    }
    requestAnimationFrame(animate);
  }

  function handleSuccess(mat, len, sf) {
    isTesting = false;
    const btnTest = document.getElementById('btnStartTest');
    if (btnTest) btnTest.removeAttribute('disabled');

    const cell = document.getElementById(`cell_${mat.id}_${len}`);
    if (cell) {
      cell.className = `matrix-cell ${sf >= 2.0 ? 'safe' : 'marginal'}`;
      cell.textContent = sf.toFixed(2);
    }

    const statusBadge = document.getElementById('hudStressStatus');
    if (statusBadge) {
      statusBadge.textContent = sf >= 2.0 ? 'SAFE (SF > 2)' : 'MARGINAL (SF < 2)';
      statusBadge.style.color = sf >= 2.0 ? 'var(--success)' : 'var(--warning)';
    }

    matrix[`${mat.id}_${len}`] = sf;
    localStorage.setItem('vlabModule2_matrix', JSON.stringify(matrix));
    checkMatrixCompletion();
  }

  function handleFailure(mat, len) {
    isTesting = false;
    const btnTest = document.getElementById('btnStartTest');
    if (btnTest) btnTest.removeAttribute('disabled');

    DroneModel.triggerArmBreak();

    const cell = document.getElementById(`cell_${mat.id}_${len}`);
    if (cell) {
      cell.className = 'matrix-cell fail';
      cell.textContent = 'FAIL';
    }

    const statusBadge = document.getElementById('hudStressStatus');
    if (statusBadge) {
      statusBadge.textContent = 'YIELD FAILURE!';
      statusBadge.style.color = 'var(--danger)';
    }

    matrix[`${mat.id}_${len}`] = 0;
    localStorage.setItem('vlabModule2_matrix', JSON.stringify(matrix));
    checkMatrixCompletion();
  }

  function checkMatrixCompletion() {
    const materialsList = database.materials;
    const lengthsList = [150, 250, 350];
    
    let completedCells = 0;
    let totalCells = materialsList.length * lengthsList.length;

    materialsList.forEach(m => {
      lengthsList.forEach(l => {
        if (matrix[`${m.id}_${l}`] !== undefined) completedCells++;
      });
    });

    if (completedCells >= totalCells) {
      saveFinalConfigurationAndProceed();
    }
  }

  function saveFinalConfigurationAndProceed() {
    // Guard: only persist config when frame selection is available.
    if (state.selections.frame) {
      const frameConfig = {
        wheelbase_mm: state.selections.frame.wheelbase_mm,
        arm_length_mm: activeSelection.length,
        arm_material: activeSelection.material ? activeSelection.material.id : null,
        yield_strength_mpa: activeSelection.material ? activeSelection.material.yield_strength_mpa : null,
        mass_g: state.calculations.total_mass_g,
        cg_offset_mm: state.calculations.offset_mm
      };
      localStorage.setItem('vlabModule2_final', JSON.stringify(frameConfig));
    }

    // Show the unlock card (auto-triggered — no button needed).
    const card = document.getElementById('nextModuleContainer');
    if (card && card.style.display === 'none') {
      card.style.display = 'block';
      // Use setTimeout to guarantee a full layout pass before WebGL reads canvas dimensions.
      setTimeout(function () {
        if (Mod2UI && Mod2UI.initUnlockScene) {
          Mod2UI.initUnlockScene();
        }
      }, 80);
      // Scroll the card into view.
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function drawBarChart(appliedStress) {
    const ctx = document.getElementById('stressBarCanvas');
    if (!ctx) return;

    const carbonYield = 600;
    const alYield = 270;
    const nylonYield = 50;

    const dataApplied = [appliedStress, appliedStress, appliedStress];
    const dataYield = [carbonYield, alYield, nylonYield];

    if (stressChart) {
      stressChart.data.datasets[0].data = dataApplied;
      stressChart.update('none');
    } else {
      stressChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: ['Carbon', 'Aluminium', 'Nylon'],
          datasets: [
            {
              label: 'Applied Bending Stress',
              data: dataApplied,
              backgroundColor: '#38bdf8',
              borderColor: '#0284c7',
              borderWidth: 1.5,
              barPercentage: 0.55
            },
            {
              label: 'Yield Strength',
              data: dataYield,
              backgroundColor: ['rgba(31,41,55,0.12)', 'rgba(148,163,184,0.12)', 'rgba(244,63,94,0.12)'],
              borderColor: ['#1f2937', '#94a3b8', '#f43f5e'],
              borderWidth: 1.5,
              barPercentage: 0.55
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: {
            legend: { display: false },
            tooltip: { enabled: true }
          },
          scales: {
            y: {
              min: 0,
              max: 650,
              title: { display: true, text: 'Stress / Strength (MPa)', font: { size: 10 } },
              grid: { color: '#f3f4f6' }
            },
            x: {
              grid: { display: false }
            }
          }
        }
      });
    }
  }

  function updateSFDBMDDiagrams(force, length_mm, b, h, t) {
    const sfdCtx = document.getElementById('sfdCanvas');
    const bmdCtx = document.getElementById('bmdCanvas');
    if (!sfdCtx || !bmdCtx) return;

    const points = 10;
    const xData = [];
    const sfdData = [];
    const bmdData = [];

    for (let i = 0; i <= points; i++) {
      const x_mm = (i / points) * length_mm;
      xData.push((x_mm / 1000).toFixed(2));
      
      // V = -F_tip (constant)
      sfdData.push(-force);
      
      // M(x) = F_tip * (L - x)
      const M = Calc.solveBendingMomentAtX(force, x_mm, length_mm);
      bmdData.push(M);
    }

    // Update SFD Chart
    if (sfdChart) {
      sfdChart.data.datasets[0].data = sfdData;
      sfdChart.update('none');
    } else {
      sfdChart = new Chart(sfdCtx, {
        type: 'line',
        data: {
          labels: xData,
          datasets: [{
            label: 'Shear Force (N)',
            data: sfdData,
            borderColor: '#f43f5e',
            borderWidth: 2,
            fill: false,
            pointRadius: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { 
              suggestedMin: -15, 
              suggestedMax: 0, 
              title: { display: true, text: 'V (N)', font: { size: 9 } },
              grid: { color: '#f3f4f6' }
            },
            x: { 
              title: { display: true, text: 'Position (m)', font: { size: 9 } },
              grid: { display: false }
            }
          }
        }
      });
    }

    // Update BMD Chart
    if (bmdChart) {
      bmdChart.data.datasets[0].data = bmdData;
      bmdChart.update('none');
    } else {
      bmdChart = new Chart(bmdCtx, {
        type: 'line',
        data: {
          labels: xData,
          datasets: [{
            label: 'Bending Moment (N·m)',
            data: bmdData,
            borderColor: '#0284c7',
            borderWidth: 2,
            fill: false,
            pointRadius: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { 
              suggestedMin: 0, 
              suggestedMax: 5, 
              title: { display: true, text: 'M (N·m)', font: { size: 9 } },
              grid: { color: '#f3f4f6' }
            },
            x: { 
              title: { display: true, text: 'Position (m)', font: { size: 9 } },
              grid: { display: false }
            }
          }
        }
      });
    }
  }

  return {
    init,
    refresh,
    updateCalculationsPanel,
    runStressSweepAnimation,
    handleSuccess,
    handleFailure,
    checkMatrixCompletion,
    saveFinalConfigurationAndProceed,
    drawBarChart,
    updateSFDBMDDiagrams
  };
})();
window.VLAB_MOD2 = Module2;

// ═══════════════════════════════════════════════════════════════════
// 9. GLOBAL STATE & continuation data loader
// ═══════════════════════════════════════════════════════════════════
const state = {
  selections: {
    frame: null,
    battery: null,
    payloads: [],
    motor: null,
    propeller: null,
    esc: null,
    fc: null,
    rx: null,
    T_max: 8.5,
    battery_pos: { x: 0, y: 0 },
    payload_pos: { x: 0, y: 0 }
  },
  calculations: {
    x_cg: 0,
    y_cg: 0,
    offset_mm: 0,
    total_mass_g: 0,
    sum_mx: 0,
    sum_my: 0
  },
  isFlying: false,
  flightTime: 0,
  flightPos: new THREE.Vector3(0, 0, 0),
  rollVibrationPoints: null,
  pitchVibrationPoints: null
};

let database = null;

function loadContinuationData() {
  // Try to parse from query parameters first (Live Server cross-port fallback)
  const urlParams = new URLSearchParams(window.location.search);
  const paramState = urlParams.get('state') || urlParams.get('handoff');
  if (paramState) {
    try {
      const decoded = decodeURIComponent(paramState);
      JSON.parse(decoded); // Validate JSON
      localStorage.setItem('vlabModule1', decoded);
      console.log('Successfully loaded handoff data from URL parameter');
    } catch (err) {
      console.warn('Failed to parse handoff state from URL query parameter:', err);
    }
  }

  const exp1Handoff = localStorage.getItem('vlabModule1');
  const badgeContainer = document.getElementById('handoffStatusContainer');
  
  let usingCustom = false;
  let motorName = 'Default 2212';
  let propName = 'Default 9045';

  if (exp1Handoff) {
    try {
      const exp1 = JSON.parse(exp1Handoff);
      
      // Frame
      const frameId = exp1.fId || exp1.frame_id;
      if (frameId && database.frames) {
        state.selections.frame = database.frames.find(f => f.id === frameId);
      }
      
      // Motor
      const motorId = exp1.mId || exp1.motor_id;
      if (motorId && database.motors) {
        state.selections.motor = database.motors.find(m => m.id === motorId);
        if (state.selections.motor) motorName = state.selections.motor.label || state.selections.motor.id;
      }
      
      // Propeller
      const propellerId = exp1.pId || exp1.propeller_id;
      if (propellerId && database.propellers) {
        state.selections.propeller = database.propellers.find(p => p.id === propellerId);
        if (state.selections.propeller) propName = state.selections.propeller.label || state.selections.propeller.id;
      }
      
      // Battery
      const batteryId = exp1.bId || exp1.battery_id;
      if (batteryId && database.batteries) {
        state.selections.battery = database.batteries.find(b => b.id === batteryId);
      }
      
      // Payloads
      if (exp1.pldIds && Array.isArray(exp1.pldIds) && database.payloads) {
        state.selections.payloads = database.payloads.filter(p => exp1.pldIds.includes(p.id));
      } else if (exp1.payload_id && database.payloads) {
        const pObj = database.payloads.find(p => p.id === exp1.payload_id);
        if (pObj) state.selections.payloads = [pObj];
      }
      
      // ESC
      const escId = exp1.eId || exp1.esc_id;
      if (escId && database.escs) {
        state.selections.esc = database.escs.find(e => e.id === escId);
      }
      
      // FC
      const fcId = exp1.fcId || exp1.fc_id;
      if (fcId && database.flight_controllers) {
        state.selections.fc = database.flight_controllers.find(f => f.id === fcId);
      }
      
      // RX
      const rxId = exp1.rId || exp1.rx_id;
      if (rxId && database.receivers) {
        state.selections.rx = database.receivers.find(r => r.id === rxId);
      }
      
      // Thrust Max � handle all key variants from exp1
      if (exp1.T_max_n !== undefined) {
        state.selections.T_max = exp1.T_max_n;
      } else if (exp1.max_thrust_n !== undefined) {
        state.selections.T_max = exp1.max_thrust_n;
      } else if (exp1.T_req !== undefined) {
        state.selections.T_max = exp1.T_req;
      }

      usingCustom = true;
    } catch (e) {
      console.warn('Failed to parse Experiment 1 selections. Using defaults.');
    }
  }

  // Retrieve Module 1 Balancing data if we are back-navigated
  const cgHandoff = localStorage.getItem('vlabModule2_cg');
  if (cgHandoff) {
    try {
      const hData = JSON.parse(cgHandoff);
      if (hData.frame_id && database.frames) {
        state.selections.frame = database.frames.find(f => f.id === hData.frame_id);
      }
      if (hData.battery_id && database.batteries) {
        state.selections.battery = database.batteries.find(b => b.id === hData.battery_id);
      }
      if (hData.payload_ids && database.payloads) {
        state.selections.payloads = database.payloads.filter(p => hData.payload_ids.includes(p.id));
      }
      if (hData.battery_pos) state.selections.battery_pos = hData.battery_pos;
      if (hData.payload_pos) state.selections.payload_pos = hData.payload_pos;
    } catch (e) {
      console.warn('Failed to parse vlabModule2_cg');
    }
  }

  if (!state.selections.motor && database.motors) {
    state.selections.motor = database.motors[3] || { id: '2212_920', mass_g: 52 };
  }
  if (!state.selections.propeller && database.propellers) {
    state.selections.propeller = database.propellers[3] || { id: '9045_2b', mass_g: 11.2 };
  }
  if (!state.selections.frame && database.frames) {
    state.selections.frame = database.frames[2] || database.frames[0];
  }
  if (!state.selections.battery && database.batteries) {
    state.selections.battery = database.batteries[1] || database.batteries[0];
  }
  if ((!state.selections.payloads || state.selections.payloads.length === 0) && database.payloads) {
    state.selections.payloads = [database.payloads[0]];
  }
  if (!state.selections.esc && database.escs) {
    state.selections.esc = database.escs[4] || { id: 'esc_4in1_30a', quantity: 1 };
  }
  if (!state.selections.fc && database.flight_controllers) {
    state.selections.fc = database.flight_controllers[1] || { id: 'fc_f7' };
  }
  if (!state.selections.rx && database.receivers) {
    state.selections.rx = database.receivers[0] || { id: 'rx_elrs_ep1' };
  }

  if (badgeContainer) {
    if (usingCustom) {
      badgeContainer.className = 'handoff-status-badge';
      badgeContainer.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
          <polyline points="22 4 12 14.01 9 11.01"></polyline>
        </svg>
        <span>Active setup: <strong>${motorName}</strong> + <strong>${propName}</strong> (T_max = ${state.selections.T_max.toFixed(2)}N) loaded from Exp 1.</span>
      `;
    } else {
      badgeContainer.className = 'handoff-status-badge fallback';
      badgeContainer.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="16" x2="12" y2="12"></line>
          <line x1="12" y1="8" x2="12.01" y2="8"></line>
        </svg>
        <span>Using default hardware: <strong>${motorName}</strong> + <strong>${propName}</strong> (No Exp 1 data found).</span>
      `;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// 10. DOMContentLoaded Router
// ═══════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function () {
  window.Calc = Calc;
  window.Scene = Scene;
  window.DroneModel = DroneModel;
  window.UI = UI;
  window.Mod2UI = Mod2UI;

  if (document.getElementById('safetyMatrixContainer')) {
    window.VLAB_MOD2 = Module2;
    Module2.init();
  } else {
    window.VLAB = Module1;
    Module1.init();
  }
});
