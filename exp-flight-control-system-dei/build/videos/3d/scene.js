/* =============================================================================
   Flight Control System — 3D explainer scene (Experiment 5)
   Deterministic, capture-driven Three.js scene.
   All motion is a pure function of the global time `t` (seconds) set via
   window.__setTime(t), so frames render identically every run.
   ============================================================================= */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Timeline configuration
  // ---------------------------------------------------------------------------
  const FPS = 30;
  const DURATION = 60;                 // seconds
  const TOTAL_FRAMES = FPS * DURATION; // 1800
  const W = 1920, H = 1080;

  // Segments (start times in seconds). End = next start (last ends at DURATION).
  const SEG = [
    { id: 'intro',    start: 0.0,  title: 'Flight Control System',      sub: 'PID Tuning  ·  Ziegler–Nichols  ·  Sensor Fusion' },
    { id: 'problem',  start: 5.5,  title: 'An Unstable Plant',          sub: 'Why a quadcopter cannot hold attitude on its own' },
    { id: 'pid',      start: 12.0, title: 'The PID Controller',         sub: 'Proportional · Integral · Derivative torque' },
    { id: 'response', start: 20.0, title: 'Second-Order Response',      sub: 'Natural frequency, damping & overshoot' },
    { id: 'tradeoff', start: 28.0, title: 'The Kp Trade-off',           sub: 'Faster response rings harder' },
    { id: 'integral', start: 35.0, title: 'Steady-State Error',         sub: 'Integral action nulls the droop' },
    { id: 'zn',       start: 42.0, title: 'Ziegler–Nichols Tuning',     sub: 'Push to the stability edge, then read the table' },
    { id: 'fusion',   start: 49.5, title: 'Sensor Fusion',              sub: 'Complementary filter: gyro + accelerometer' },
    { id: 'outro',    start: 56.0, title: 'Stable Flight, By Design',   sub: 'Estimate · Control · Tune' }
  ];
  function segAt(t) {
    let i = 0;
    for (let k = 0; k < SEG.length; k++) { if (t >= SEG[k].start) i = k; }
    const s = SEG[i];
    const end = (i + 1 < SEG.length) ? SEG[i + 1].start : DURATION;
    return { i, s, start: s.start, end, dur: end - s.start, local: t - s.start };
  }

  // Real values from theory.md / db.json (the 5" reference airframe).
  const VAL = {
    J: 0.003, m: 0.5, L: 0.110,
    Kp: 0.6, Kd: 0.04,
    wn: 14.14, zeta: 0.471, Mp: 18.65, tp: 0.252, tr: 0.165, ts: 0.60,
    Td: 0.0175, d_mm: 3.57,
    Ku: 19.25, Pu: 0.0513, wu: 122.5,
    zn_Kp: 11.55, zn_Ki: 450.3, zn_Kd: 0.074, zn_OS: 68,
    tl_Kp: 8.66, tl_Ki: 76.8, tl_Kd: 0.0705, tl_OS: 15,
    alpha: 0.98, tau_f: 0.1225, drift: 0.0735, noise: 0.1809, total: 0.2544,
    gyroBias: 0.6, accelNoise: 1.8, dt_ms: 2.5
  };
  // Kp sweep table (Kp, wn, zeta, overshoot%)
  const KPSWEEP = [
    { Kp: 0.2, wn: 8.16,  z: 0.816, os: 1.18 },
    { Kp: 0.4, wn: 11.55, z: 0.577, os: 10.85 },
    { Kp: 0.6, wn: 14.14, z: 0.471, os: 18.65 },
    { Kp: 0.8, wn: 16.33, z: 0.408, os: 24.54 },
    { Kp: 1.0, wn: 18.26, z: 0.365, os: 29.16 }
  ];

  // ---------------------------------------------------------------------------
  // Color palette
  // ---------------------------------------------------------------------------
  const COL = {
    bg0: '#05070d', bg1: '#0b1020',
    white: '#eaf2ff', muted: '#94a6c4', dim: '#5d6f8e',
    cyan: '#38e1ff', blue: '#4a9eff', amber: '#ffb454',
    green: '#46e6a0', pink: '#ff5d73', violet: '#b48cff',
    panelFill: 'rgba(10,16,28,0.74)', panelStroke: 'rgba(120,160,220,0.28)',
    grid: 'rgba(120,160,220,0.16)'
  };

  // ---------------------------------------------------------------------------
  // Math helpers
  // ---------------------------------------------------------------------------
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, u) => a + (b - a) * u;
  function smooth(u) { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); }
  function ease(u) { u = clamp(u, 0, 1); return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; }
  // Deterministic hash noise in [-1,1]
  function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return 2 * (s - Math.floor(s)) - 1; }
  // Smooth deterministic noise (value noise) over a continuous coordinate
  function vnoise(x) {
    const i = Math.floor(x), f = x - i;
    const a = hash(i), b = hash(i + 1);
    return lerp(a, b, smooth(f));
  }
  // Unit step response of a 2nd-order system (y in 0..~1+overshoot)
  function stepResp(tau, wn, z) {
    if (tau <= 0) return 0;
    if (z >= 1) { // overdamped/critically — simple approximation
      return 1 - Math.exp(-wn * tau) * (1 + wn * tau);
    }
    const wd = wn * Math.sqrt(1 - z * z);
    const phi = Math.acos(z);
    return 1 - (Math.exp(-z * wn * tau) / Math.sqrt(1 - z * z)) * Math.sin(wd * tau + phi);
  }

  // ---------------------------------------------------------------------------
  // Three.js scene setup
  // ---------------------------------------------------------------------------
  const canvas = document.getElementById('webgl');
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, alpha: false, preserveDrawingBuffer: true
  });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if ('outputEncoding' in renderer) renderer.outputEncoding = THREE.sRGBEncoding;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COL.bg0);
  scene.fog = new THREE.FogExp2(0x05070d, 0.085);

  const camera = new THREE.PerspectiveCamera(38, W / H, 0.1, 100);
  camera.position.set(0.9, 0.9, 3.2);
  camera.lookAt(0.7, 0, 0);

  // ---- Lights -------------------------------------------------------------
  const hemi = new THREE.HemisphereLight(0x9fc4ff, 0x0a0e18, 0.65);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 1.15);
  key.position.set(3.5, 6, 4.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1; key.shadow.camera.far = 20;
  key.shadow.camera.left = -4; key.shadow.camera.right = 4;
  key.shadow.camera.top = 4; key.shadow.camera.bottom = -4;
  key.shadow.bias = -0.0004;
  scene.add(key);
  const rimC = new THREE.DirectionalLight(0x38e1ff, 0.5); rimC.position.set(-5, 2, -3); scene.add(rimC);
  const rimA = new THREE.DirectionalLight(0xffb454, 0.35); rimA.position.set(4, 1, -4); scene.add(rimA);
  const fill = new THREE.PointLight(0x4a9eff, 0.5, 20); fill.position.set(-2, 1.5, 3); scene.add(fill);

  // ---- Ground + grid ------------------------------------------------------
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x070b14, roughness: 0.92, metalness: 0.1 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), groundMat);
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.85; ground.receiveShadow = true;
  scene.add(ground);
  const grid = new THREE.GridHelper(60, 120, 0x1d3050, 0x12203a);
  grid.position.y = -0.849;
  if (grid.material) { grid.material.transparent = true; grid.material.opacity = 0.5; }
  scene.add(grid);

  // ---------------------------------------------------------------------------
  // Quadcopter model (X configuration)
  // ---------------------------------------------------------------------------
  const droneRoot = new THREE.Group();   // holds attitude (roll)
  scene.add(droneRoot);
  const drone = new THREE.Group();
  droneRoot.add(drone);

  const matCarbon = new THREE.MeshStandardMaterial({ color: 0x161b25, roughness: 0.5, metalness: 0.55 });
  const matArm = new THREE.MeshStandardMaterial({ color: 0x222936, roughness: 0.55, metalness: 0.5 });
  const matBell = new THREE.MeshStandardMaterial({ color: 0xaeb8c8, roughness: 0.32, metalness: 0.85 });
  const matStator = new THREE.MeshStandardMaterial({ color: 0x2d3442, roughness: 0.6, metalness: 0.6 });

  // central body
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.24), matCarbon);
  body.castShadow = true; body.receiveShadow = true; drone.add(body);
  const topPlate = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.02, 0.20),
    new THREE.MeshStandardMaterial({ color: 0x0e1320, roughness: 0.35, metalness: 0.7 }));
  topPlate.position.y = 0.05; topPlate.castShadow = true; drone.add(topPlate);
  // flight-controller "stack" cube with cyan glow
  const fcGlow = new THREE.MeshStandardMaterial({ color: 0x0b3550, emissive: 0x12a6d8, emissiveIntensity: 0.9, roughness: 0.4, metalness: 0.3 });
  const fc = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.12), fcGlow);
  fc.position.y = 0.075; drone.add(fc);

  // arms + motors + props
  const ARM_LEN = 0.30, ARM_ANG = [45, 135, 225, 315];
  const props = [];        // {pivot, dir, glow}
  const motorThrust = [];  // sprite glow per motor
  function makeProp(color) {
    const g = new THREE.Group();
    const bladeGeo = new THREE.BoxGeometry(0.30, 0.006, 0.032);
    const bladeMat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.2, transparent: true, opacity: 0.95 });
    const b1 = new THREE.Mesh(bladeGeo, bladeMat); b1.castShadow = true;
    const b2 = new THREE.Mesh(bladeGeo, bladeMat); b2.rotation.y = Math.PI / 2; b2.castShadow = true;
    g.add(b1); g.add(b2);
    // translucent spin disc
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.155, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.07, side: THREE.DoubleSide })
    );
    disc.rotation.x = -Math.PI / 2; disc.position.y = 0.004; g.add(disc);
    return g;
  }
  const propColors = [0x38e1ff, 0x4a9eff, 0xffb454, 0xff8a5d];
  ARM_ANG.forEach((deg, idx) => {
    const a = deg * D2R;
    const dx = Math.cos(a) * ARM_LEN, dz = Math.sin(a) * ARM_LEN;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(ARM_LEN + 0.06, 0.026, 0.05), matArm);
    arm.position.set(dx / 2, 0.0, dz / 2);
    arm.rotation.y = -a;
    arm.castShadow = true; arm.receiveShadow = true; drone.add(arm);

    const stator = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.045, 24), matStator);
    stator.position.set(dx, 0.02, dz); stator.castShadow = true; drone.add(stator);
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.03, 24), matBell);
    bell.position.set(dx, 0.05, dz); bell.castShadow = true; drone.add(bell);

    const pivot = new THREE.Group();
    pivot.position.set(dx, 0.075, dz);
    const prop = makeProp(propColors[idx]);
    pivot.add(prop); drone.add(pivot);
    props.push({ pivot, dir: (idx % 2 === 0 ? 1 : -1) });

    // thrust glow sprite under/over motor
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({
      color: propColors[idx], transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending
    }));
    spr.scale.set(0.5, 0.5, 0.5); spr.position.set(dx, 0.12, dz);
    drone.add(spr); motorThrust.push(spr);

    // arm-tip LED
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 12),
      new THREE.MeshStandardMaterial({ color: propColors[idx], emissive: propColors[idx], emissiveIntensity: 1.2, roughness: 0.4 }));
    led.position.set(dx, 0.0, dz); drone.add(led);
  });

  // soft contact shadow blob (fake) under the drone
  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.55, 48),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }));
  blob.rotation.x = -Math.PI / 2; blob.position.y = -0.845; scene.add(blob);

  // ---------------------------------------------------------------------------
  // Camera keyframes (pure function of t)
  // ---------------------------------------------------------------------------
  const CAMKEYS = [
    { t: 0.0,  pos: [0.95, 0.95, 3.15], tgt: [0.62, 0.02, 0] },
    { t: 5.5,  pos: [0.25, 0.62, 3.45], tgt: [0.80, 0.04, 0] },
    { t: 12.0, pos: [0.35, 0.55, 3.40], tgt: [0.82, 0.03, 0] },
    { t: 20.0, pos: [0.30, 0.52, 3.42], tgt: [0.82, 0.03, 0] },
    { t: 35.0, pos: [0.22, 0.66, 3.40], tgt: [0.82, 0.02, 0] },
    { t: 49.5, pos: [0.30, 0.55, 3.45], tgt: [0.80, 0.04, 0] },
    { t: 56.0, pos: [0.65, 0.85, 3.18], tgt: [0.55, 0.05, 0] },
    { t: 60.0, pos: [1.0,  0.95, 3.10], tgt: [0.5,  0.05, 0] }
  ];
  function camAt(t) {
    let k0 = CAMKEYS[0], k1 = CAMKEYS[CAMKEYS.length - 1];
    for (let i = 0; i < CAMKEYS.length - 1; i++) {
      if (t >= CAMKEYS[i].t && t <= CAMKEYS[i + 1].t) { k0 = CAMKEYS[i]; k1 = CAMKEYS[i + 1]; break; }
    }
    const u = k1.t === k0.t ? 0 : smooth((t - k0.t) / (k1.t - k0.t));
    const pos = [0, 1, 2].map(j => lerp(k0.pos[j], k1.pos[j], u));
    const tgt = [0, 1, 2].map(j => lerp(k0.tgt[j], k1.tgt[j], u));
    // gentle continuous drift so it never feels frozen
    pos[0] += Math.sin(t * 0.32) * 0.05;
    pos[1] += Math.sin(t * 0.27 + 1.0) * 0.03;
    return { pos, tgt };
  }

  // ---------------------------------------------------------------------------
  // Drone attitude (roll) + control effort as a function of t
  // Returns { roll(rad), effort(-1..1) } where effort drives motor glow.
  // ---------------------------------------------------------------------------
  function attitudeAt(t) {
    const { s, local, dur } = segAt(t);
    let roll = 0, effort = 0, bob = 0;
    switch (s.id) {
      case 'intro': {
        roll = Math.sin(t * 0.8) * 3 * D2R;
        bob = Math.sin(t * 1.4) * 0.012;
        effort = 0.25 + 0.1 * Math.sin(t * 2.0);
        break;
      }
      case 'problem': {
        // open-loop unstable: disturbance integrates into a growing tumble
        const u = local / dur;
        roll = (u * u) * 40 * D2R;               // monotonic divergent tilt
        bob = -u * 0.05;
        effort = 0;                               // no control
        break;
      }
      case 'pid': {
        // a disturbance hits, PID drives it back to level (damped)
        const tl = local;
        const dist = 22 * D2R;
        const y = stepResp(Math.max(0, tl - 0.6), 11, 0.5); // recovery
        roll = (tl < 0.6 ? dist * (tl / 0.6) : dist * (1 - y));
        effort = clamp(-roll / (10 * D2R), -1, 1);
        bob = 0;
        break;
      }
      case 'response': {
        // step command to +20deg, underdamped (Kp0.6)
        const tl = clamp((local - 0.6) , 0, 99);
        const y = stepResp(tl, VAL.wn, VAL.zeta);
        roll = 20 * D2R * y;
        effort = clamp((20 * D2R - roll) / (8 * D2R), -1, 1) + 0.3;
        break;
      }
      case 'tradeoff': {
        // cycle through three Kp values showing more ring
        const phase = (local / dur) * 3;
        const which = Math.min(2, Math.floor(phase));
        const cfgs = [KPSWEEP[0], KPSWEEP[2], KPSWEEP[4]];
        const c = cfgs[which];
        const tl = clamp((phase - which) * (dur / 3) - 0.2, 0, 99);
        roll = 18 * D2R * stepResp(tl, c.wn, c.z);
        effort = 0.3;
        break;
      }
      case 'integral': {
        // P-only droops to a steady tilt, then integral nulls it
        const half = dur * 0.45;
        if (local < half) {
          roll = 7 * D2R * ease(local / 1.0);     // droop under disturbance
        } else {
          const u = (local - half) / (dur - half);
          roll = 7 * D2R * (1 - ease(u));          // integral pulls back to level
        }
        effort = clamp(roll / (7 * D2R), -1, 1);
        break;
      }
      case 'zn': {
        // sustained constant-amplitude oscillation at the stability edge
        const env = smooth(local / 1.2);
        roll = env * 12 * D2R * Math.sin(local * 2 * Math.PI / 1.05);
        effort = roll / (12 * D2R);
        break;
      }
      case 'fusion': {
        // gentle true maneuver the estimator must track
        roll = 9 * D2R * Math.sin(local * 0.9) * smooth(local / 1.0);
        effort = 0.2 * Math.sin(local * 0.9);
        bob = Math.sin(local * 1.2) * 0.01;
        break;
      }
      case 'outro': {
        roll = Math.sin(t * 0.7) * 2 * D2R;
        bob = Math.sin(t * 1.3) * 0.012;
        effort = 0.25;
        break;
      }
    }
    return { roll, effort, bob };
  }

  // ---------------------------------------------------------------------------
  // 2D overlay engine
  // ---------------------------------------------------------------------------
  const ov = document.getElementById('overlay');
  const ctx = ov.getContext('2d');
  const FONT = "'Segoe UI', 'Arial', sans-serif";
  function font(weight, size) { return `${weight} ${size}px ${FONT}`; }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function text(str, x, y, f, color, align, alpha) {
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.font = f; ctx.fillStyle = color; ctx.textAlign = align || 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(str, x, y);
    ctx.globalAlpha = 1;
  }
  function chip(x, y, label, color, a) {
    ctx.font = font(600, 24);
    const w = ctx.measureText(label).width + 36;
    ctx.globalAlpha = (a == null ? 1 : a) * 0.16;
    ctx.fillStyle = color; roundRect(x, y - 26, w, 38, 19); ctx.fill();
    ctx.globalAlpha = (a == null ? 1 : a);
    ctx.strokeStyle = color; ctx.lineWidth = 1.4; roundRect(x, y - 26, w, 38, 19); ctx.stroke();
    text(label, x + 18, y, font(600, 24), color, 'left', a);
    ctx.globalAlpha = 1;
    return w;
  }

  // Title (top-left) + caption (bottom) bands with fade per segment
  function drawTitleAndCaption(t) {
    const { s, local, dur } = segAt(t);
    const fin = smooth(local / 0.55);
    const fout = 1 - smooth((local - (dur - 0.45)) / 0.45);
    const a = clamp(Math.min(fin, fout), 0, 1);

    // top gradient band
    let g = ctx.createLinearGradient(0, 0, 0, 230);
    g.addColorStop(0, 'rgba(3,5,11,0.92)'); g.addColorStop(1, 'rgba(3,5,11,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, 230);

    // accent tick
    ctx.globalAlpha = a; ctx.fillStyle = COL.cyan;
    roundRect(90, 60, 8, 64, 4); ctx.fill(); ctx.globalAlpha = 1;

    text(s.title, 120, 108, font(700, 54), COL.white, 'left', a);
    text(s.sub, 122, 152, font(400, 27), COL.muted, 'left', a);

    // progress dots
    const dotY = 150, dotX0 = W - 90 - SEG.length * 26;
    for (let i = 0; i < SEG.length; i++) {
      const cur = SEG[i].id === s.id;
      ctx.globalAlpha = cur ? 1 : 0.4;
      ctx.fillStyle = cur ? COL.cyan : COL.dim;
      ctx.beginPath(); ctx.arc(dotX0 + i * 26, dotY, cur ? 6 : 4, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // bottom caption band
    const cap = CAPTION[s.id] ? CAPTION[s.id](local, dur) : '';
    if (cap) {
      let gb = ctx.createLinearGradient(0, H - 200, 0, H);
      gb.addColorStop(0, 'rgba(3,5,11,0)'); gb.addColorStop(1, 'rgba(3,5,11,0.94)');
      ctx.fillStyle = gb; ctx.fillRect(0, H - 200, W, 200);
      text(cap, W / 2, H - 70, font(400, 30), COL.white, 'center', a);
    }
  }

  // Right-hand panel geometry
  const PX = 1148, PY = 206, PW = 700, PH = 668;
  function drawPanelFrame(a, heading, headColor) {
    ctx.globalAlpha = a;
    ctx.fillStyle = COL.panelFill; roundRect(PX, PY, PW, PH, 18); ctx.fill();
    ctx.strokeStyle = COL.panelStroke; ctx.lineWidth = 1.5; roundRect(PX, PY, PW, PH, 18); ctx.stroke();
    // heading
    ctx.fillStyle = headColor || COL.cyan; roundRect(PX + 28, PY + 34, 7, 30, 3); ctx.fill();
    text(heading, PX + 48, PY + 58, font(700, 28), COL.white, 'left', a);
    ctx.strokeStyle = 'rgba(120,160,220,0.18)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PX + 28, PY + 80); ctx.lineTo(PX + PW - 28, PY + 80); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // generic plot inside panel
  function plotBox() { return { x: PX + 70, y: PY + 120, w: PW - 130, h: 300 }; }
  function drawAxes(box, xlabel, ylabel, a) {
    ctx.globalAlpha = a;
    ctx.strokeStyle = 'rgba(150,180,225,0.35)'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(box.x, box.y); ctx.lineTo(box.x, box.y + box.h); ctx.lineTo(box.x + box.w, box.y + box.h);
    ctx.stroke();
    text(xlabel, box.x + box.w, box.y + box.h + 30, font(500, 19), COL.muted, 'right', a);
    ctx.save();
    ctx.translate(box.x - 44, box.y); ctx.rotate(-Math.PI / 2);
    text(ylabel, 0, 0, font(500, 19), COL.muted, 'right', a); ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------------
  // Captions per segment (sync with narration cadence)
  // ---------------------------------------------------------------------------
  const CAPTION = {
    intro:    () => 'Building stable flight from PID control, auto-tuning, and sensor fusion.',
    problem:  (l) => l < 3.2 ? 'With no control, a tiny disturbance torque integrates into a tumble.'
                              : 'The plant is a double integrator:  θ / τ = 1 / (J s²).',
    pid:      (l) => l < 4   ? 'P reacts to the present error, I to the past, D to the rate of change.'
                              : 'Together they synthesize the restoring torque that levels the craft.',
    response: (l) => l < 4   ? 'PD action makes a clean second-order loop:  ωn = √(Kp/J),  ζ = Kd / 2√(Kp·J).'
                              : 'Here ζ = 0.47 gives 18.65% overshoot and a 0.60 s settling time.',
    tradeoff: (l) => l < 4   ? 'Raising Kp speeds the loop but lowers damping — overshoot climbs.'
                              : 'Past Kp = 0.8 it breaks the 25% comfort limit; settling stays 0.60 s.',
    integral: (l) => l < 3.4 ? 'A CG offset torque (Td = 0.0175 N·m) makes P-only control droop.'
                              : 'Integral action accumulates until the steady-state error is exactly zero.',
    zn:       (l) => l < 3.8 ? 'Raise the gain until the loop oscillates: that is Ku and period Pu.'
                              : 'The Z-N table reads gains straight off Ku = 19.25 and Pu = 0.051 s.',
    fusion:   (l) => l < 3.6 ? 'The gyro is smooth but drifts; the accelerometer is absolute but noisy.'
                              : 'A complementary filter (α = 0.98) blends them into a clean estimate.',
    outro:    () => 'Estimate the attitude, control it with PID, and tune for a calm, robust loop.'
  };

  // ---------------------------------------------------------------------------
  // Per-segment panel renderers
  // ---------------------------------------------------------------------------
  function panel_problem(t, a) {
    drawPanelFrame(a, 'Open-Loop Plant', COL.pink);
    const cx = PX + 40, y0 = PY + 130;
    text('Newton (rotation):', cx, y0, font(400, 23), COL.muted, 'left', a);
    text('τ = J · θ̈', cx + 18, y0 + 48, font(700, 38), COL.white, 'left', a);
    text('Transfer function:', cx, y0 + 110, font(400, 23), COL.muted, 'left', a);
    text('θ(s) / τ(s) = 1 / (J s²)', cx + 18, y0 + 158, font(700, 38), COL.cyan, 'left', a);
    text('Two poles at the origin → any constant', cx, y0 + 222, font(400, 23), COL.muted, 'left', a);
    text('torque grows without bound.', cx, y0 + 254, font(400, 23), COL.muted, 'left', a);
    // J box
    ctx.globalAlpha = a; ctx.strokeStyle = COL.panelStroke; roundRect(cx, y0 + 290, PW - 80, 120, 12); ctx.stroke(); ctx.globalAlpha = 1;
    text('Roll inertia (from the build):', cx + 24, y0 + 330, font(400, 22), COL.muted, 'left', a);
    text('J = m·L² / 2 = 0.5 · 0.110² / 2', cx + 24, y0 + 372, font(600, 28), COL.white, 'left', a);
    text('≈ 0.003 kg·m²', cx + 360, y0 + 372, font(700, 28), COL.amber, 'left', a);
  }

  function panel_pid(t, a) {
    drawPanelFrame(a, 'C(s) = Kp + Ki / s + Kd · s', COL.blue);
    const local = segAt(t).local;
    const terms = [
      { k: 'P', name: 'Proportional', val: 'Kp = 0.6', col: COL.cyan, desc: 'present error — the restoring spring' },
      { k: 'I', name: 'Integral', val: 'Ki (accumulates)', col: COL.green, desc: 'past error — removes steady offset' },
      { k: 'D', name: 'Derivative', val: 'Kd = 0.04', col: COL.amber, desc: 'rate of error — electronic damping' }
    ];
    const y0 = PY + 116, rh = 158;
    terms.forEach((tm, i) => {
      const yy = y0 + i * rh;
      const on = local > 0.6 + i * 1.4;
      const aa = a * (on ? 1 : 0.28);
      ctx.globalAlpha = aa * 0.14; ctx.fillStyle = tm.col; roundRect(PX + 36, yy, PW - 72, rh - 22, 12); ctx.fill();
      ctx.globalAlpha = aa; ctx.strokeStyle = tm.col; ctx.lineWidth = 1.4; roundRect(PX + 36, yy, PW - 72, rh - 22, 12); ctx.stroke();
      // big letter
      ctx.globalAlpha = aa; ctx.fillStyle = tm.col; ctx.beginPath(); ctx.arc(PX + 84, yy + (rh - 22) / 2, 30, 0, 7); ctx.fill();
      text(tm.k, PX + 84, yy + (rh - 22) / 2 + 12, font(700, 34), '#06121f', 'center', aa);
      text(tm.name, PX + 134, yy + 46, font(700, 27), COL.white, 'left', aa);
      text(tm.desc, PX + 134, yy + 80, font(400, 21), COL.muted, 'left', aa);
      text(tm.val, PX + 134, yy + 112, font(600, 23), tm.col, 'left', aa);
      ctx.globalAlpha = 1;
    });
  }

  function drawStepCurve(box, wn, z, color, a, lw, tMax, dash) {
    ctx.globalAlpha = a; ctx.strokeStyle = color; ctx.lineWidth = lw || 2.5;
    if (dash) ctx.setLineDash(dash); else ctx.setLineDash([]);
    ctx.beginPath();
    const N = 240;
    for (let i = 0; i <= N; i++) {
      const tau = (i / N) * tMax;
      const y = stepResp(tau, wn, z);
      const px = box.x + (tau / tMax) * box.w;
      const py = box.y + box.h - clamp(y / 1.45, 0, 1) * box.h;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
  }

  function panel_response(t, a) {
    drawPanelFrame(a, 'Unit Step Response', COL.cyan);
    const box = plotBox(); const tMax = 1.0;
    // setpoint line (target = 1.0)
    const yT = box.y + box.h - (1.0 / 1.45) * box.h;
    ctx.globalAlpha = a; ctx.strokeStyle = 'rgba(150,180,225,0.4)'; ctx.setLineDash([6, 6]); ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(box.x, yT); ctx.lineTo(box.x + box.w, yT); ctx.stroke(); ctx.setLineDash([]);
    text('command', box.x + box.w, yT - 8, font(500, 17), COL.muted, 'right', a); ctx.globalAlpha = 1;
    drawAxes(box, 'time  (s)', 'roll', a);
    // animate playhead reveal
    const reveal = clamp((segAt(t).local - 0.6) / 3.2, 0, 1);
    ctx.save();
    ctx.beginPath(); ctx.rect(box.x, box.y - 20, box.w * reveal, box.h + 40); ctx.clip();
    drawStepCurve(box, VAL.wn, VAL.zeta, COL.cyan, a, 3.0, tMax);
    ctx.restore();
    // metrics
    const my = PY + 470;
    text('ωn = √(Kp/J) = 14.14 rad/s', PX + 48, my, font(600, 24), COL.white, 'left', a);
    text('ζ  = Kd / 2√(Kp·J) = 0.471', PX + 48, my + 40, font(600, 24), COL.white, 'left', a);
    chip(PX + 48, my + 92, 'overshoot  18.65%', COL.amber, a);
    chip(PX + 330, my + 92, 'settling  0.60 s', COL.green, a);
    chip(PX + 48, my + 146, 'peak  0.252 s', COL.blue, a);
    chip(PX + 280, my + 146, 'rise  0.165 s', COL.cyan, a);
  }

  function panel_tradeoff(t, a) {
    drawPanelFrame(a, 'Kp Sweep  (Kd = 0.04 fixed)', COL.amber);
    const box = plotBox(); const tMax = 1.0;
    const yT = box.y + box.h - (1.0 / 1.45) * box.h;
    // 25% overshoot limit
    const yL = box.y + box.h - (1.25 / 1.45) * box.h;
    ctx.globalAlpha = a; ctx.strokeStyle = COL.pink; ctx.setLineDash([5, 5]); ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(box.x, yL); ctx.lineTo(box.x + box.w, yL); ctx.stroke();
    text('25% limit', box.x + box.w, yL - 8, font(600, 17), COL.pink, 'right', a);
    ctx.strokeStyle = 'rgba(150,180,225,0.4)'; ctx.beginPath(); ctx.moveTo(box.x, yT); ctx.lineTo(box.x + box.w, yT); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    drawAxes(box, 'time  (s)', 'roll', a);
    const cols = [COL.green, COL.cyan, COL.blue, COL.amber, COL.pink];
    // reveal curves progressively
    const nShown = clamp(Math.floor((segAt(t).local / segAt(t).dur) * 5) + 1, 1, 5);
    KPSWEEP.forEach((c, i) => {
      if (i < nShown) drawStepCurve(box, c.wn, c.z, cols[i], a * (i === nShown - 1 ? 1 : 0.8), i === 2 ? 3.2 : 2.2, tMax);
    });
    // legend
    let ly = PY + 470;
    text('Kp', PX + 48, ly, font(600, 22), COL.muted, 'left', a);
    text('overshoot', PX + 250, ly, font(600, 22), COL.muted, 'left', a);
    KPSWEEP.forEach((c, i) => {
      const yy = ly + 34 + i * 32;
      ctx.globalAlpha = a; ctx.fillStyle = cols[i]; roundRect(PX + 48, yy - 16, 26, 8, 4); ctx.fill(); ctx.globalAlpha = 1;
      text(c.Kp.toFixed(1), PX + 90, yy, font(600, 21), COL.white, 'left', a);
      text(c.os.toFixed(2) + ' %', PX + 250, yy, font(600, 21), c.os > 25 ? COL.pink : COL.green, 'left', a);
    });
  }

  function panel_integral(t, a) {
    drawPanelFrame(a, 'Steady-State Error', COL.green);
    const cx = PX + 44, y0 = PY + 128;
    text('Disturbance torque (CG offset d):', cx, y0, font(400, 22), COL.muted, 'left', a);
    text('Td = m·g·d = 0.5 · 9.807 · 0.00357', cx + 8, y0 + 44, font(600, 25), COL.white, 'left', a);
    text('= 0.0175 N·m', cx + 8, y0 + 80, font(700, 27), COL.amber, 'left', a);
    text('P-only error:   ess = Td / Kp', cx, y0 + 140, font(600, 25), COL.white, 'left', a);
    // mini table
    const rows = [['Kp', 'ess (deg)'], ['0.2', '5.01°'], ['0.6', '1.67°'], ['1.0', '1.00°']];
    const tx = cx, ty = y0 + 178, rw = PW - 88, rhh = 42;
    rows.forEach((r, i) => {
      ctx.globalAlpha = a * (i === 0 ? 0.9 : 1);
      if (i === 0) { ctx.fillStyle = 'rgba(70,230,160,0.14)'; roundRect(tx, ty + i * rhh, rw, rhh, 6); ctx.fill(); }
      ctx.globalAlpha = 1;
      text(r[0], tx + 26, ty + i * rhh + 28, font(i === 0 ? 700 : 500, 22), i === 0 ? COL.green : COL.white, 'left', a);
      text(r[1], tx + rw - 40, ty + i * rhh + 28, font(i === 0 ? 700 : 500, 22), i === 0 ? COL.green : COL.white, 'right', a);
      if (i > 0) { ctx.globalAlpha = a * 0.5; ctx.strokeStyle = 'rgba(120,160,220,0.18)'; ctx.beginPath(); ctx.moveTo(tx, ty + i * rhh); ctx.lineTo(tx + rw, ty + i * rhh); ctx.stroke(); ctx.globalAlpha = 1; }
    });
    // integral nulls it banner
    const on = segAt(t).local > segAt(t).dur * 0.45;
    const aa = a * (on ? 1 : 0.25);
    ctx.globalAlpha = aa * 0.16; ctx.fillStyle = COL.green; roundRect(cx, ty + 4 * rhh + 16, rw, 64, 10); ctx.fill();
    ctx.globalAlpha = aa; ctx.strokeStyle = COL.green; ctx.lineWidth = 1.4; roundRect(cx, ty + 4 * rhh + 16, rw, 64, 10); ctx.stroke(); ctx.globalAlpha = 1;
    text('+ Integral term  →  ess driven to 0', cx + 24, ty + 4 * rhh + 56, font(700, 24), COL.green, 'left', aa);
  }

  function panel_zn(t, a) {
    drawPanelFrame(a, 'Ultimate-Cycle Method', COL.violet);
    const box = { x: PX + 70, y: PY + 116, w: PW - 130, h: 196 };
    // axis midline
    ctx.globalAlpha = a; ctx.strokeStyle = 'rgba(150,180,225,0.3)'; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(box.x, box.y + box.h / 2); ctx.lineTo(box.x + box.w, box.y + box.h / 2); ctx.stroke();
    ctx.globalAlpha = 1;
    // sustained oscillation (constant amplitude)
    const local = segAt(t).local;
    const reveal = clamp(local / 3.0, 0, 1);
    ctx.save(); ctx.beginPath(); ctx.rect(box.x, box.y, box.w * reveal, box.h); ctx.clip();
    ctx.globalAlpha = a; ctx.strokeStyle = COL.violet; ctx.lineWidth = 2.6; ctx.beginPath();
    const N = 300, cycles = 5;
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const px = box.x + u * box.w;
      const py = box.y + box.h / 2 - Math.sin(u * cycles * 2 * Math.PI) * (box.h / 2 - 12);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke(); ctx.restore(); ctx.globalAlpha = 1;
    // Pu marker
    text('Pu', box.x + box.w / cycles * 0.5, box.y + 16, font(600, 18), COL.violet, 'center', a * reveal);
    // values
    const vy = PY + 350;
    text('Ku = 19.25', PX + 48, vy, font(700, 26), COL.white, 'left', a);
    text('Pu = 0.0513 s', PX + 250, vy, font(700, 26), COL.white, 'left', a);
    text('Classic Z-N PID:  Kp = 0.6 Ku,  Ti = 0.5 Pu,  Td = 0.125 Pu', PX + 48, vy + 44, font(400, 21), COL.muted, 'left', a);
    chip(PX + 48, vy + 96, 'Kp = 11.55', COL.cyan, a);
    chip(PX + 250, vy + 96, 'Ki = 450', COL.amber, a);
    chip(PX + 430, vy + 96, 'Kd = 0.074', COL.green, a);
    // classic vs robust overshoot
    text('Classic ≈ 68% overshoot  →  Tyreus–Luyben ≈ 15%', PX + 48, vy + 150, font(600, 22), COL.white, 'left', a);
    // two small bars
    const bx = PX + 48, by = vy + 170, bw = PW - 110;
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(255,93,115,0.85)'; roundRect(bx, by, bw * (68 / 80), 22, 6); ctx.fill();
    ctx.fillStyle = 'rgba(70,230,160,0.9)'; roundRect(bx, by + 30, bw * (15 / 80), 22, 6); ctx.fill();
    text('68%', bx + bw * (68 / 80) + 10, by + 19, font(600, 18), COL.pink, 'left', a);
    text('15%', bx + bw * (15 / 80) + 10, by + 49, font(600, 18), COL.green, 'left', a);
    ctx.globalAlpha = 1;
  }

  function panel_fusion(t, a) {
    drawPanelFrame(a, 'Complementary Filter', COL.cyan);
    const box = { x: PX + 70, y: PY + 116, w: PW - 130, h: 250 };
    drawAxes(box, 'time', 'angle', a);
    const mid = box.y + box.h * 0.62;
    // true angle (reference)
    const local = segAt(t).local;
    const reveal = clamp(local / 4.0, 0, 1);
    const N = 260;
    function trueAng(u) { return Math.sin(u * 3.0) * 0.42 + 0.1; } // normalized
    ctx.save(); ctx.beginPath(); ctx.rect(box.x, box.y - 10, box.w * reveal, box.h + 20); ctx.clip();
    // accel (noisy) scatter line
    ctx.globalAlpha = a * 0.55; ctx.strokeStyle = COL.amber; ctx.lineWidth = 1.3; ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const u = i / N; const px = box.x + u * box.w;
      const val = trueAng(u) + vnoise(u * 60) * 0.16;
      const py = mid - val * (box.h * 0.5);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    // gyro (smooth but drifting)
    ctx.globalAlpha = a * 0.75; ctx.strokeStyle = COL.pink; ctx.lineWidth = 1.8; ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const u = i / N; const px = box.x + u * box.w;
      const val = trueAng(u) + u * 0.32; // drift ramp
      const py = mid - val * (box.h * 0.5);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    // fused (clean) — tracks true
    ctx.globalAlpha = a; ctx.strokeStyle = COL.cyan; ctx.lineWidth = 3.0; ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const u = i / N; const px = box.x + u * box.w;
      const val = trueAng(u) + vnoise(u * 60) * 0.012 + u * 0.012;
      const py = mid - val * (box.h * 0.5);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke(); ctx.restore(); ctx.globalAlpha = 1;
    // legend
    const ly = PY + 396;
    function leg(x, c, lab) { ctx.globalAlpha = a; ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, ly); ctx.lineTo(x + 30, ly); ctx.stroke(); ctx.globalAlpha = 1; text(lab, x + 38, ly + 6, font(500, 20), COL.muted, 'left', a); }
    leg(PX + 48, COL.pink, 'gyro (drifts)');
    leg(PX + 250, COL.amber, 'accel (noisy)');
    leg(PX + 470, COL.cyan, 'fused');
    // formula + numbers
    text('θ = α(θ + ω·Δt) + (1−α)·θaccel', PX + 48, ly + 56, font(600, 24), COL.white, 'left', a);
    chip(PX + 48, ly + 104, 'α = 0.98', COL.cyan, a);
    chip(PX + 210, ly + 104, 'drift 0.07°', COL.pink, a);
    chip(PX + 400, ly + 104, 'noise 0.18°', COL.amber, a);
    text('total error ≈ 0.254°   (vs pure-gyro drift 18° in 30 s)', PX + 48, ly + 152, font(500, 21), COL.green, 'left', a);
  }

  function panel_intro(t, a) {
    // centered hero tags under the title region (no right panel)
    const y = 980;
  }
  function panel_outro(t, a) {
    drawPanelFrame(a, 'What You Built', COL.cyan);
    const items = [
      ['Sensor fusion', 'Complementary filter → clean attitude (α = 0.98)', COL.cyan],
      ['PID control', 'Kp + Ki/s + Kd·s → restoring torque', COL.blue],
      ['Second-order tuning', 'ωn, ζ set overshoot & settling', COL.amber],
      ['Ziegler–Nichols', 'Ku = 19.25, Pu = 0.051 s → starting gains', COL.violet],
      ['Refine for robustness', 'Tyreus–Luyben: 68% → 15% overshoot', COL.green]
    ];
    const y0 = PY + 120, rh = 104;
    items.forEach((it, i) => {
      const yy = y0 + i * rh;
      const on = segAt(t).local > 0.4 + i * 0.5;
      const aa = a * (on ? 1 : 0.25);
      ctx.globalAlpha = aa; ctx.fillStyle = it[2]; ctx.beginPath(); ctx.arc(PX + 60, yy + 22, 9, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
      text(it[0], PX + 88, yy + 18, font(700, 25), COL.white, 'left', aa);
      text(it[1], PX + 88, yy + 50, font(400, 21), COL.muted, 'left', aa);
    });
  }

  const PANEL = {
    problem: panel_problem, pid: panel_pid, response: panel_response,
    tradeoff: panel_tradeoff, integral: panel_integral, zn: panel_zn,
    fusion: panel_fusion, intro: panel_intro, outro: panel_outro
  };

  // intro/outro big hero tags
  function drawHeroTags(t, a) {
    const tags = ['PID Control', 'Ziegler–Nichols', 'Sensor Fusion'];
    const cols = [COL.cyan, COL.violet, COL.amber];
    ctx.font = font(600, 30);
    let totalW = 0; const gap = 28;
    const widths = tags.map(s => ctx.measureText(s).width + 52);
    totalW = widths.reduce((p, c) => p + c, 0) + gap * (tags.length - 1);
    let x = W / 2 - totalW / 2; const y = 900;
    tags.forEach((s, i) => {
      const on = segAt(t).local > 1.2 + i * 0.5;
      const aa = a * (on ? 1 : 0);
      ctx.globalAlpha = aa * 0.16; ctx.fillStyle = cols[i]; roundRect(x, y - 34, widths[i], 52, 26); ctx.fill();
      ctx.globalAlpha = aa; ctx.strokeStyle = cols[i]; ctx.lineWidth = 1.6; roundRect(x, y - 34, widths[i], 52, 26); ctx.stroke();
      text(s, x + 26, y, font(600, 30), cols[i], 'left', aa);
      x += widths[i] + gap;
    });
    ctx.globalAlpha = 1;
  }

  function drawOverlay(t) {
    ctx.clearRect(0, 0, W, H);
    const { s, local, dur } = segAt(t);
    const fin = smooth(local / 0.5);
    const fout = 1 - smooth((local - (dur - 0.4)) / 0.4);
    const a = clamp(Math.min(fin, fout), 0, 1);
    // right panel (skip for intro)
    if (PANEL[s.id]) PANEL[s.id](t, a);
    if (s.id === 'intro' || s.id === 'outro') drawHeroTags(t, a);
    drawTitleAndCaption(t);
  }

  // ---------------------------------------------------------------------------
  // Master render for a given time
  // ---------------------------------------------------------------------------
  function render(t) {
    t = clamp(t, 0, DURATION - 1e-4);
    // camera
    const c = camAt(t);
    camera.position.set(c.pos[0], c.pos[1], c.pos[2]);
    camera.lookAt(c.tgt[0], c.tgt[1], c.tgt[2]);
    // drone attitude
    const att = attitudeAt(t);
    droneRoot.rotation.z = att.roll;
    droneRoot.position.y = att.bob || 0;
    blob.position.x = 0; blob.material.opacity = 0.34 - Math.abs(att.roll) * 0.15;
    // spin props (speed modulated a touch by effort)
    props.forEach((p, i) => {
      const base = 14 + i * 0.7;
      const eff = 1 + (att.effort || 0) * (i < 2 ? 0.5 : -0.5);
      p.pivot.rotation.y = p.dir * t * base * eff;
    });
    // motor thrust glow from control effort (more on the lifting side)
    motorThrust.forEach((spr, i) => {
      const side = (i === 0 || i === 3) ? 1 : -1; // crude left/right grouping
      const e = clamp(0.18 + side * (att.effort || 0) * 0.5, 0, 0.8);
      spr.material.opacity = e;
      const sc = 0.35 + e * 0.5; spr.scale.set(sc, sc, sc);
    });
    // fc glow pulse
    fc.material.emissiveIntensity = 0.7 + 0.3 * Math.sin(t * 4);

    renderer.render(scene, camera);
    drawOverlay(t);
  }

  // ---------------------------------------------------------------------------
  // Capture hooks
  // ---------------------------------------------------------------------------
  window.__FPS = FPS;
  window.__DURATION = DURATION;
  window.__TOTAL_FRAMES = TOTAL_FRAMES;
  window.__CAPTURE = false;
  window.__setTime = function (t) { render(t); };
  window.__ready = false;

  // initial render + readiness
  render(0);
  window.__ready = true;

  // live preview loop (only when NOT capturing)
  let _start = null;
  function preview(ts) {
    if (window.__CAPTURE) return;          // capture.js drives frames itself
    if (_start == null) _start = ts;
    const t = ((ts - _start) / 1000) % DURATION;
    render(t);
    requestAnimationFrame(preview);
  }
  requestAnimationFrame(preview);
})();
