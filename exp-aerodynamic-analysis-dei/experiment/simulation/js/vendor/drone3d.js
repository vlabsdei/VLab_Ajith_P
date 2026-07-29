/* ============================================================================
 * VLAB_DRONE3D — shared high-quality procedural quadcopter for the drone labs.
 *
 * A single, reusable three.js drone so every experiment shows the SAME
 * high-poly, physically-plausible 5" FPV quadcopter instead of a bespoke
 * low-poly stand-in. Built from three.js primitives ONLY (no GLB):
 *   · airfoil, twisted, tapered propeller blades (ExtrudeGeometry) — 2/3/4 sel.
 *   · lathe-turned outrunner motor bells with copper stator windings
 *   · beveled carbon-fibre frame plates (rounded-rect ExtrudeGeometry) with a
 *     procedural carbon-weave CanvasTexture, aluminium standoffs & CF arms
 *   · flight-stack (FC + ESC), LiPo pack, FPV camera, whip antenna
 *   · status LEDs (green nose / red tail) and tubular landing gear
 *
 * API (all THREE references are passed in so the module is import-order and
 * headless safe — it only defines functions, it never touches THREE on load):
 *   VLAB_DRONE3D.build(THREE, opts) ->
 *       { root, props[], leds[], rotorCenters[], blades[], setLed(hex) }
 *     · root          : THREE.Group — the whole craft, nose at +Z, X-config,
 *                       body centred at the origin (~0.6 m wheelbase). Bank /
 *                       tilt / bob this group.
 *     · props         : prop THREE.Group[] each with userData.spin = ±1, so a
 *                       caller can `p.rotation.y += rate * p.userData.spin`.
 *     · rotorCenters  : local THREE.Vector3[] of the four prop hubs (for thrust
 *                       vectors / effects).
 *   VLAB_DRONE3D.studio(THREE, scene, renderer, opts) ->
 *       { key, fill, ground, grid } — consistent light-studio setup (matches
 *       the polished experiments): PBR tone-mapping, key+fill+rim lights, a
 *       soft ground disc and a faint reference grid.
 * ==========================================================================*/
(function (root) {
  'use strict';

  // ── procedural carbon-fibre weave (2×2 twill) as a CanvasTexture ──────────
  function carbonTexture(THREE) {
    const size = 128;
    const cv = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
    if (!cv) return null;
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#151515'; ctx.fillRect(0, 0, size, size);
    const n = 8, ts = size / n;
    ctx.fillStyle = '#262626';
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if ((i + j) % 2 === 0) ctx.fillRect(i * ts, j * ts, ts, ts);
      }
    }
    ctx.strokeStyle = 'rgba(10,10,10,0.55)'; ctx.lineWidth = 1;
    for (let k = 0; k <= size; k += 4) {
      ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, k); ctx.lineTo(size, k); ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 3);
    return tex;
  }

  function std(THREE, color, roughness, metalness, extra) {
    return new THREE.MeshStandardMaterial(Object.assign({
      color: color, roughness: roughness, metalness: metalness
    }, extra || {}));
  }

  function roundedRectShape(THREE, w, d, r) {
    const s = new THREE.Shape();
    const x = -w / 2, y = -d / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y);
    s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + d - r);
    s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
    s.lineTo(x + r, y + d);
    s.quadraticCurveTo(x, y + d, x, y + d - r);
    s.lineTo(x, y + r);
    s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }

  // cambered airfoil cross-section (leading edge at +x)
  function airfoilShape(THREE, chord, thickness) {
    const s = new THREE.Shape();
    s.moveTo(chord * 0.5, 0);
    s.quadraticCurveTo(0, thickness * 1.6, -chord * 0.5, 0);
    s.quadraticCurveTo(0, -thickness * 0.25, chord * 0.5, 0);
    return s;
  }

  // one twisted, tapered blade grown from root (x≈0) to tip along +x
  function buildBlade(THREE, radius, baseChord, dirSign, bodyMat, tipMat) {
    const blade = new THREE.Group();
    const steps = 8, startR = 0.006;
    const stepL = (radius - startR) / steps;
    for (let i = 0; i < steps; i++) {
      const segStart = startR + i * stepL;
      const t = i / (steps - 1);
      const chord = baseChord * (1.15 * (1 - t) + 0.4 * t);
      const thick = 0.0032 * (1 - t) + 0.0006 * t;
      const pitch = (0.34 * (1 - t) + 0.07 * t) * dirSign;
      const geo = new THREE.ExtrudeGeometry(
        airfoilShape(THREE, chord, thick),
        { steps: 1, depth: stepL * 1.06, bevelEnabled: false }
      );
      const mesh = new THREE.Mesh(geo, (i === steps - 1) ? tipMat : bodyMat);
      mesh.rotation.y = -Math.PI / 2;   // lay the extrusion along +x
      mesh.rotation.x = pitch;          // geometric wash-out twist
      mesh.position.x = segStart;
      mesh.castShadow = true;
      blade.add(mesh);
    }
    return blade;
  }

  // hub + N airfoil blades; returns a group meant to spin about local +Y
  function buildProp(THREE, mats, propR, propChord, blades, spinDir) {
    const prop = new THREE.Group();
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.009, 0.015, 18), mats.hub);
    hub.castShadow = true; prop.add(hub);
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.006, 6), mats.alu);
    nut.position.y = 0.0105; prop.add(nut);
    for (let b = 0; b < blades; b++) {
      const blade = buildBlade(THREE, propR, propChord, spinDir, mats.blade, mats.bladeTip);
      blade.rotation.y = b * (Math.PI * 2 / blades);
      prop.add(blade);
    }
    // faint disc that reads as motion blur once it is spinning fast
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(propR * 1.02, 40),
      new THREE.MeshBasicMaterial({ color: 0x9aa3b2, transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false })
    );
    disc.rotation.x = -Math.PI / 2; disc.position.y = 0.006; prop.add(disc);
    prop.userData.spin = spinDir;
    return prop;
  }

  // lathe-turned outrunner bell + copper windings + stator + shaft
  function buildMotor(THREE, mats, motorR, motorH) {
    const g = new THREE.Group();

    const stator = new THREE.Mesh(
      new THREE.CylinderGeometry(motorR * 0.6, motorR * 0.6, motorH * 0.62, 18),
      mats.stator
    );
    stator.position.y = motorH * 0.33; g.add(stator);

    const coilGeo = new THREE.CylinderGeometry(motorR * 0.14, motorR * 0.14, motorH * 0.52, 8);
    for (let c = 0; c < 12; c++) {
      const a = (c / 12) * Math.PI * 2;
      const coil = new THREE.Mesh(coilGeo, mats.copper);
      coil.position.set(Math.cos(a) * motorR * 0.5, motorH * 0.31, Math.sin(a) * motorR * 0.5);
      g.add(coil);
    }

    const pts = [
      new THREE.Vector2(motorR * 0.98, 0.0),
      new THREE.Vector2(motorR, motorH * 0.16),
      new THREE.Vector2(motorR, motorH * 0.82),
      new THREE.Vector2(motorR * 0.93, motorH * 0.93),
      new THREE.Vector2(motorR * 0.5, motorH),
      new THREE.Vector2(motorR * 0.16, motorH + 0.0035),
      new THREE.Vector2(0.0018, motorH + 0.0045)
    ];
    const bell = new THREE.Mesh(new THREE.LatheGeometry(pts, 30), mats.bell);
    bell.castShadow = true; g.add(bell);

    // top vent holes (dark dots) for the anodised-bell look
    const ventGeo = new THREE.CylinderGeometry(motorR * 0.13, motorR * 0.13, 0.0008, 10);
    for (let h = 0; h < 5; h++) {
      const a = (h / 5) * Math.PI * 2;
      const vent = new THREE.Mesh(ventGeo, mats.vent);
      vent.position.set(Math.cos(a) * motorR * 0.42, motorH + 0.0038, Math.sin(a) * motorR * 0.42);
      g.add(vent);
    }

    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0017, 0.0017, motorH * 1.4, 10), mats.alu);
    shaft.position.y = motorH * 0.72; g.add(shaft);

    return g;
  }

  function build(THREE, opts) {
    opts = opts || {};
    if (!THREE) return { root: null, props: [], leds: [], rotorCenters: [], blades: [] };

    const blades = Math.max(2, Math.min(4, opts.blades || 2));
    const armReach = opts.armReach || 0.30;
    const propR = opts.propR || 0.12;
    const propChord = opts.propChord || (0.02 + propR * 0.16);
    const motorR = opts.motorR || 0.027;
    const motorH = opts.motorH || 0.028;
    const accent = (opts.accent !== undefined) ? opts.accent : 0x12b886;
    const propColor = (opts.propColor !== undefined) ? opts.propColor : 0x20242c;

    const carbon = carbonTexture(THREE);
    const mats = {
      carbon: new THREE.MeshStandardMaterial({ color: 0x3a3f47, map: carbon || null, roughness: 0.42, metalness: 0.72 }),
      frame: std(THREE, 0x23272e, 0.5, 0.55),
      alu: std(THREE, 0xd1d5db, 0.28, 0.9),
      bell: std(THREE, 0x2a2f38, 0.32, 0.82, { emissive: accent, emissiveIntensity: 0.04 }),
      stator: std(THREE, 0x596273, 0.5, 0.8),
      copper: std(THREE, 0xc06a2c, 0.34, 0.7, { emissive: 0x5c2f12, emissiveIntensity: 0.25 }),
      vent: std(THREE, 0x11141a, 0.7, 0.4),
      hub: std(THREE, 0x14171d, 0.5, 0.35),
      blade: std(THREE, propColor, 0.38, 0.12),
      bladeTip: new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.25, metalness: 0.1, emissive: 0x7f1d1d, emissiveIntensity: 0.35 }),
      pcb: std(THREE, 0x0e5c3a, 0.6, 0.25),
      pcbDark: std(THREE, 0x111827, 0.55, 0.4),
      lipo: std(THREE, 0x1f2937, 0.45, 0.2),
      lipoBand: std(THREE, accent, 0.4, 0.2, { emissive: accent, emissiveIntensity: 0.12 }),
      cam: std(THREE, 0x0b0e13, 0.5, 0.4),
      lens: std(THREE, 0x2dd4ff, 0.1, 0.6, { emissive: 0x0b6b7a, emissiveIntensity: 0.5 }),
      antenna: std(THREE, 0x111827, 0.6, 0.3),
      antTip: std(THREE, 0xf59e0b, 0.4, 0.2, { emissive: 0x7c530a, emissiveIntensity: 0.4 })
    };

    const rootGrp = new THREE.Group();
    const props = [];
    const leds = [];
    const rotorCenters = [];

    // ── frame: bevelled carbon top & bottom decks + aluminium standoffs ─────
    const bodyW = 0.11, bodyD = 0.15, deckGap = 0.026;
    const extrude = { steps: 1, depth: 0.003, bevelEnabled: true, bevelThickness: 0.0007, bevelSize: 0.0007, bevelOffset: 0, bevelSegments: 2 };

    const bottom = new THREE.Mesh(new THREE.ExtrudeGeometry(roundedRectShape(THREE, bodyW, bodyD, 0.02), extrude), mats.carbon);
    bottom.rotation.x = -Math.PI / 2; bottom.position.y = 0; bottom.castShadow = true; bottom.receiveShadow = true;
    rootGrp.add(bottom);

    const top = new THREE.Mesh(new THREE.ExtrudeGeometry(roundedRectShape(THREE, bodyW * 0.9, bodyD * 0.82, 0.018), extrude), mats.carbon);
    top.rotation.x = -Math.PI / 2; top.position.y = deckGap; top.castShadow = true;
    rootGrp.add(top);

    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach((s) => {
      const so = new THREE.Mesh(new THREE.CylinderGeometry(0.0028, 0.0028, deckGap, 10), mats.alu);
      so.position.set(s[0] * bodyW * 0.36, deckGap / 2, s[1] * bodyD * 0.34); so.castShadow = true;
      rootGrp.add(so);
    });

    // ── flight-stack between the decks: FC over 4-in-1 ESC ──────────────────
    const esc = new THREE.Mesh(new THREE.BoxGeometry(bodyW * 0.62, 0.006, bodyD * 0.4), mats.pcbDark);
    esc.position.y = deckGap * 0.34; rootGrp.add(esc);
    const fc = new THREE.Mesh(new THREE.BoxGeometry(bodyW * 0.5, 0.005, bodyD * 0.34), mats.pcb);
    fc.position.y = deckGap * 0.66; rootGrp.add(fc);

    // ── LiPo pack strapped on top ───────────────────────────────────────────
    const lipo = new THREE.Mesh(new THREE.BoxGeometry(bodyW * 0.58, 0.024, bodyD * 0.66), mats.lipo);
    lipo.position.set(0, deckGap + 0.014, -0.006); lipo.castShadow = true; rootGrp.add(lipo);
    [-0.2, 0.2].forEach((f) => {
      const band = new THREE.Mesh(new THREE.BoxGeometry(bodyW * 0.6, 0.026, 0.004), mats.lipoBand);
      band.position.set(0, deckGap + 0.014, -0.006 + f * bodyD * 0.3); rootGrp.add(band);
    });

    // ── FPV camera + accent nose cone at +Z ─────────────────────────────────
    const camGrp = new THREE.Group(); camGrp.position.set(0, deckGap * 0.6, bodyD * 0.46);
    const camBox = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.018), mats.cam); camGrp.add(camBox);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.007, 0.008, 16), mats.lens);
    lens.rotation.x = Math.PI / 2; lens.position.z = 0.012; camGrp.add(lens);
    rootGrp.add(camGrp);

    const noseMat = std(THREE, accent, 0.35, 0.4, { emissive: accent, emissiveIntensity: 0.35 });
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.05, 18), noseMat);
    nose.rotation.x = Math.PI / 2; nose.position.set(0, 0.006, bodyD * 0.6); rootGrp.add(nose);
    leds.push(noseMat);

    // ── whip antenna at the tail ────────────────────────────────────────────
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 0.07, 8), mats.antenna);
    ant.position.set(0.03, deckGap + 0.03, -bodyD * 0.5); ant.rotation.z = -0.3; rootGrp.add(ant);
    const antTip = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.012, 10), mats.antTip);
    antTip.position.set(0.041, deckGap + 0.065, -bodyD * 0.5); antTip.rotation.z = -0.3; rootGrp.add(antTip);

    // ── arms + motors + props + status LEDs + landing legs at each corner ───
    const diag = Math.SQRT1_2;                 // 45° X-configuration
    const corners = [
      { x: 1, z: 1, spin: -1, led: 0x22c55e },  // front-right  (green)
      { x: -1, z: 1, spin: 1, led: 0x22c55e },  // front-left   (green)
      { x: 1, z: -1, spin: 1, led: 0xef4444 },  // rear-right   (red)
      { x: -1, z: -1, spin: -1, led: 0xef4444 } // rear-left    (red)
    ];

    corners.forEach((c) => {
      const mx = c.x * armReach * diag, mz = c.z * armReach * diag;

      // tapered carbon arm from the deck edge to the motor mount
      const armLen = Math.hypot(mx, mz) - 0.03;
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.009, armLen, 12), mats.carbon);
      arm.position.set(mx * 0.5, deckGap * 0.4, mz * 0.5);
      arm.rotation.x = Math.PI / 2;
      arm.rotation.z = -Math.atan2(mx, mz);      // aim from centre to motor
      arm.castShadow = true; rootGrp.add(arm);

      // motor mount pad
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(motorR * 1.05, motorR * 1.15, 0.004, 16), mats.frame);
      pad.position.set(mx, deckGap * 0.4 + 0.002, mz); rootGrp.add(pad);

      // motor
      const motor = buildMotor(THREE, mats, motorR, motorH);
      motor.position.set(mx, deckGap * 0.4 + 0.004, mz); rootGrp.add(motor);

      // prop on the bell
      const prop = buildProp(THREE, mats, propR, propChord, blades, c.spin);
      prop.position.set(mx, deckGap * 0.4 + 0.004 + motorH + 0.009, mz);
      rootGrp.add(prop);
      props.push(prop);
      rotorCenters.push(prop.position.clone());

      // status LED under the arm tip
      const ledMat = std(THREE, c.led, 0.4, 0.2, { emissive: c.led, emissiveIntensity: 0.85 });
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.006, 12, 10), ledMat);
      led.position.set(mx * 0.94, deckGap * 0.4 - 0.006, mz * 0.94); rootGrp.add(led);
      leds.push(ledMat);

      // tubular landing leg
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.06, 8), mats.frame);
      leg.position.set(mx * 0.66, -0.026, mz * 0.66);
      leg.rotation.x = c.z * 0.28; leg.rotation.z = -c.x * 0.28; leg.castShadow = true;
      rootGrp.add(leg);
    });

    // small skids joining the front/rear leg pairs
    [1, -1].forEach((zside) => {
      const skid = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, armReach * diag * 1.5, 8), mats.frame);
      skid.position.set(0, -0.052, zside * armReach * diag * 0.66);
      skid.rotation.z = Math.PI / 2; rootGrp.add(skid);
    });

    function setLed(hex) {
      leds.forEach((m) => { if (m && m.emissive) { m.color.setHex(hex); m.emissive.setHex(hex); } });
    }

    rootGrp.userData.props = props;
    return { root: rootGrp, props: props, leds: leds, rotorCenters: rotorCenters, setLed: setLed };
  }

  // consistent light-studio: PBR tone-mapping, key/fill/rim lights, ground+grid
  function studio(THREE, scene, renderer, opts) {
    opts = opts || {};
    if (!THREE || !scene) return {};
    const groundY = (opts.groundY !== undefined) ? opts.groundY : -0.42;

    if (opts.bg !== null) scene.background = new THREE.Color(opts.bg !== undefined ? opts.bg : 0xeef2f7);

    if (renderer) {
      renderer.shadowMap.enabled = true;
      if (THREE.PCFSoftShadowMap !== undefined) renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      if ('outputEncoding' in renderer && THREE.sRGBEncoding !== undefined) renderer.outputEncoding = THREE.sRGBEncoding;
      if (THREE.ACESFilmicToneMapping !== undefined) { renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.04; }
    }

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.15);
    key.position.set(1.8, 3.0, 1.8); key.castShadow = true;
    if (key.shadow) {
      key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0002;
      if (key.shadow.camera) {
        key.shadow.camera.near = 0.5; key.shadow.camera.far = 10;
        key.shadow.camera.left = -2; key.shadow.camera.right = 2;
        key.shadow.camera.top = 2; key.shadow.camera.bottom = -2;
      }
    }
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xdbeafe, 0.42); fill.position.set(-1.8, 1.1, -1.4); scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.32); rim.position.set(0, 1.4, -2.4); scene.add(rim);

    let ground = null, grid = null;
    if (opts.ground !== false) {
      ground = new THREE.Mesh(
        new THREE.CircleGeometry(opts.groundR || 3.4, 64),
        new THREE.MeshStandardMaterial({ color: (opts.groundColor !== undefined) ? opts.groundColor : 0xe7ebf1, roughness: 0.96, metalness: 0 })
      );
      ground.rotation.x = -Math.PI / 2; ground.position.y = groundY; ground.receiveShadow = true; scene.add(ground);
    }
    if (opts.grid !== false) {
      grid = new THREE.GridHelper(opts.gridSize || 6, opts.gridDiv || 30, 0xb8c0cc, 0xd3d9e2);
      grid.position.y = groundY + 0.002; scene.add(grid);
    }
    return { key: key, fill: fill, rim: rim, ground: ground, grid: grid };
  }

  root.VLAB_DRONE3D = { build: build, studio: studio, version: 1 };
}(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this)));
