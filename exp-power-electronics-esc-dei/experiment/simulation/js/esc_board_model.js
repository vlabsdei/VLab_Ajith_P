// ============================================================================
// esc_board_model.js — hyper-detailed 4-in-1 / single ESC board + outrunner
// motor, built from THREE.js primitives with PBR materials.
//
// Realism comes from: a procedural studio environment map (soft-box reflections),
// layered solder-mask / roughness CanvasTextures, ENIG-gold castellated pads,
// aluminium electrolytic cans, fine QFN leads, silicone wiring, a clamp-on
// finned heatsink, a live MOSFET heat-map (emissive) and overheat smoke.
//
// The motor mirrors Experiment 3's procedural outrunner (bell taper + vents +
// copper coils + stator core + shaft + c-clip).
//
// API (attached to window.EscBoardModel):
//   makeStudioEnv(renderer)  -> envTexture   (assign to scene.environment)
//   build(esc, motor)        -> {
//       group, dims, fets, heatsink, motorGroup,
//       tick(dt, overheating), setTemperature(tC, amb, hot),
//       setHeatsink(on), setRpm(rpm), setExploded(t), dispose()
//   }
// All geometry is in metres (a 4-in-1 board ~0.05 m square).
// ============================================================================
window.EscBoardModel = (function () {
  'use strict';
  const THREE = window.THREE;

  function mat(color, roughness, metalness, extra) {
    const m = new THREE.MeshStandardMaterial(Object.assign({ color, roughness, metalness }, extra || {}));
    if (m.envMapIntensity !== undefined) m.envMapIntensity = 1.0;
    return m;
  }
  function roundedRectShape(w, d, r) {
    const s = new THREE.Shape(), x = -w / 2, y = -d / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
    s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }
  // Perceptual heat ramp: black-PCB → deep red → orange → yellow-white.
  function heatColor(t, amb, hot) {
    const n = Math.max(0, Math.min(1, (t - amb) / (hot - amb)));
    const stops = [[0.03, 0.03, 0.04], [0.55, 0.06, 0.03], [0.95, 0.30, 0.04], [1.0, 0.65, 0.12], [1.0, 0.96, 0.82]];
    const s = n * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(s)), f = s - i;
    const a = stops[i], b = stops[i + 1];
    return { col: new THREE.Color(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f), n };
  }

  // ── Procedural studio environment map (soft-box reflections) via PMREM ──
  function makeStudioEnv(renderer) {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
    const x = c.getContext('2d');
    const grad = x.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0.0, '#3a4453'); grad.addColorStop(0.45, '#aeb8c4');
    grad.addColorStop(0.5, '#e9eef4'); grad.addColorStop(0.55, '#cfd6df'); grad.addColorStop(1.0, '#2c333d');
    x.fillStyle = grad; x.fillRect(0, 0, 1024, 512);
    function box(cx, cy, w, h, a) { x.save(); x.globalAlpha = a; x.fillStyle = '#ffffff'; x.filter = 'blur(8px)'; x.fillRect(cx - w / 2, cy - h / 2, w, h); x.restore(); }
    box(250, 150, 220, 120, 0.95); box(760, 130, 180, 90, 0.8); box(520, 80, 120, 60, 0.6);
    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const rt = pmrem.fromEquirectangular(tex);
    tex.dispose();
    return rt.texture;
  }

  // ── PCB albedo + roughness textures (black solder mask, traces, silkscreen) ──
  function pcbTextures(esc) {
    const N = 1024;
    const alb = document.createElement('canvas'); alb.width = alb.height = N;
    const rgh = document.createElement('canvas'); rgh.width = rgh.height = N;
    const a = alb.getContext('2d'), r = rgh.getContext('2d');
    a.fillStyle = '#1c2733'; a.fillRect(0, 0, N, N);
    r.fillStyle = '#8f8f8f'; r.fillRect(0, 0, N, N);
    a.fillStyle = '#2a3744';
    [[60, 60, 904, 250], [60, 714, 904, 250]].forEach(([X, Y, W, H]) => a.fillRect(X, Y, W, H));
    a.strokeStyle = '#36434f'; a.lineWidth = 2;
    for (let i = 0; i < 60; i++) { a.beginPath(); const y = 80 + i * 14; a.moveTo(120, y); a.lineTo(904, y + (i % 5) * 4 - 8); a.stroke(); }
    a.strokeStyle = '#28323d'; a.lineWidth = 1;
    for (let k = 0; k < N; k += 10) { a.beginPath(); a.moveTo(k, 0); a.lineTo(k, N); a.stroke(); }
    a.fillStyle = '#e9eef4'; a.textAlign = 'center';
    a.font = 'bold 70px Arial';
    a.fillText((esc.firmware || 'BLHeli_32'), N / 2, N / 2 - 16);
    a.font = '40px Arial';
    a.fillText(String(esc.label).replace(/\s*\(x4\)/, ''), N / 2, N / 2 + 40);
    a.font = '26px Arial'; a.fillStyle = '#aab6c4';
    a.fillText('2-6S  ·  ' + (esc.mosfet_count || 24) + ' MOSFET  ·  www.vlab.io', N / 2, N / 2 + 84);
    a.strokeStyle = '#cdd6e0'; a.lineWidth = 2; a.textAlign = 'left';
    a.font = 'bold 30px Arial'; a.fillStyle = '#e9eef4';
    const labels = [['A1', 80, 120], ['A2', 80, 470], ['B1', 80, 560], ['B2', 80, 910],
    ['C1', 870, 120], ['C2', 870, 470], ['M3', 870, 560], ['M4', 870, 910]];
    labels.forEach(([t, X, Y]) => a.fillText(t, X, Y));
    r.fillStyle = '#4a4a4a';
    [[60, 60, 904, 250], [60, 714, 904, 250]].forEach(([X, Y, W, H]) => r.fillRect(X, Y, W, H));
    r.fillStyle = '#d8d8d8';
    r.font = 'bold 70px Arial'; r.textAlign = 'center';
    r.fillText((esc.firmware || 'BLHeli_32'), N / 2, N / 2 - 16);
    const albTex = new THREE.CanvasTexture(alb); albTex.anisotropy = 8;
    const rghTex = new THREE.CanvasTexture(rgh); rghTex.anisotropy = 8;
    return { map: albTex, roughnessMap: rghTex };
  }

  function buildElectrolyticCap(r, h) {
    const g = new THREE.Group();
    const can = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 28), mat(0x1b1e24, 0.32, 0.82));
    can.position.y = h / 2; can.castShadow = true; g.add(can);
    const sc = document.createElement('canvas'); sc.width = 256; sc.height = 128;
    const sx = sc.getContext('2d');
    sx.fillStyle = '#15171c'; sx.fillRect(0, 0, 256, 128);
    sx.fillStyle = '#cfd6df'; sx.font = 'bold 22px Arial'; sx.textAlign = 'center';
    sx.fillText('470uF', 128, 40); sx.font = '16px Arial'; sx.fillText('35V (M)', 128, 66); sx.fillText('VENT', 128, 92);
    const sleeveTex = new THREE.CanvasTexture(sc);
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.005, r * 1.005, h * 0.86, 28, 1, true),
      new THREE.MeshStandardMaterial({ map: sleeveTex, roughness: 0.5, metalness: 0.2 }));
    sleeve.position.y = h / 2; g.add(sleeve);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.98, r * 0.98, 0.0003, 28), mat(0xb9c0c8, 0.28, 0.9));
    top.position.y = h + 0.00015; g.add(top);
    const ventMat = mat(0x6b7280, 0.5, 0.5);
    [0, Math.PI / 3, -Math.PI / 3].forEach((ang) => {
      const v = new THREE.Mesh(new THREE.BoxGeometry(r * 1.8, 0.0003, 0.0003), ventMat);
      v.position.y = h + 0.0003; v.rotation.y = ang; g.add(v);
    });
    return g;
  }

  function buildQFN(s, pins) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.18, s), mat(0x1b212a, 0.42, 0.25));
    body.position.y = s * 0.09; body.castShadow = true; g.add(body);
    const dot = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.06, s * 0.06, 0.0002, 12), mat(0x2a2d34, 0.5, 0.2));
    dot.position.set(-s * 0.32, s * 0.18 + 0.0001, -s * 0.32); g.add(dot);
    const leadMat = mat(0xcdd3da, 0.3, 0.92);
    const per = pins || 12, span = s * 0.8, step = span / (per - 1);
    for (let i = 0; i < per; i++) {
      const off = -span / 2 + i * step;
      const mkLead = (x, z, rot) => { const l = new THREE.Mesh(new THREE.BoxGeometry(s * 0.04, s * 0.05, s * 0.09), leadMat); l.position.set(x, s * 0.04, z); if (rot) l.rotation.y = Math.PI / 2; g.add(l); };
      mkLead(off, s / 2 + s * 0.035, 0); mkLead(off, -s / 2 - s * 0.035, 0);
      mkLead(s / 2 + s * 0.035, off, 1); mkLead(-s / 2 - s * 0.035, off, 1);
    }
    return g;
  }

  function buildMosfet() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.0042, 0.0014, 0.0034), mat(0x232b34, 0.4, 0.25, { emissive: 0x000000 }));
    body.position.y = 0.0007; body.castShadow = true; g.add(body);
    const padMat = mat(0xc9cfd6, 0.32, 0.9);
    [-1, 1].forEach((s) => { const p = new THREE.Mesh(new THREE.BoxGeometry(0.0042, 0.0003, 0.0008), padMat); p.position.set(0, 0.00015, s * 0.0019); g.add(p); });
    g.userData.body = body;
    return g;
  }

  function buildJST(pinN) {
    const g = new THREE.Group();
    const housing = new THREE.Mesh(new THREE.BoxGeometry(pinN * 0.0011 + 0.0008, 0.0018, 0.0026), mat(0xeef0f2, 0.6, 0.05));
    housing.position.y = 0.0009; housing.castShadow = true; g.add(housing);
    const pinMat = mat(0xd9b24a, 0.3, 0.9);
    for (let i = 0; i < pinN; i++) {
      const pin = new THREE.Mesh(new THREE.BoxGeometry(0.0004, 0.0006, 0.0004), pinMat);
      pin.position.set(-((pinN - 1) * 0.0011) / 2 + i * 0.0011, 0.0019, 0.0011); g.add(pin);
    }
    return g;
  }

  function buildWireTube(pts, radius, color, rough) {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    const geo = new THREE.TubeGeometry(curve, 40, radius, 10, false);
    const m = new THREE.Mesh(geo, mat(color, rough === undefined ? 0.78 : rough, 0.0));
    m.castShadow = true;
    return m;
  }

  function buildScrew(r) {
    const g = new THREE.Group();
    const standoff = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.4, r * 1.4, 0.004, 6), mat(0x0c0e12, 0.5, 0.3));
    standoff.position.y = -0.002; g.add(standoff);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.0012, 18), mat(0x6b7178, 0.35, 0.9));
    head.position.y = 0.0006; g.add(head);
    const cross1 = new THREE.Mesh(new THREE.BoxGeometry(r * 1.6, 0.0004, 0.0003), mat(0x2a2e34, 0.5, 0.6));
    cross1.position.y = 0.0012; g.add(cross1);
    const cross2 = cross1.clone(); cross2.rotation.y = Math.PI / 2; g.add(cross2);
    return g;
  }

  function seeded(i) { const x = Math.sin(i * 127.1) * 43758.5453; return x - Math.floor(x); }

  function build(esc, motor) {
    const board = esc.board_mm || [50, 50, 7];
    const L = board[0] / 1000, W = board[1] / 1000, T = 0.0022;
    const U = Math.max(L, W);                 // explode unit, scales with board size
    const is4 = esc.quantity === 1;           // true => single 4-in-1 board
    const root = new THREE.Group();
    const hx = L / 2, hz = W / 2;

    // ── explode + label registries ─────────────────────────────────────────
    // explodeParts: things that fan out (rest + off*k).  labelDefs: professional callouts.
    const explodeParts = [];                  // { obj, rest:Vec3, off:Vec3 }
    const labelDefs = [];                      // { name, obj, y }
    const reg = (obj, off) => { explodeParts.push({ obj, rest: obj.position.clone(), off: new THREE.Vector3(off[0], off[1], off[2]) }); return obj; };
    const label = (name, obj, y) => { labelDefs.push({ name, obj, y: y || 0 }); return obj; };
    // invisible world-anchor so tube/odd-origin parts get a leader line at the right spot
    const anchorOn = (parent, x, y, z) => { const a = new THREE.Object3D(); a.position.set(x, y, z); parent.add(a); return a; };

    // ── FR4 substrate (the reference layer — stays put) ──
    const shape = roundedRectShape(L, W, Math.min(L, W) * 0.06);
    const sub = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: T, bevelEnabled: false }), mat(0x1c2733, 0.55, 0.04));
    sub.rotation.x = -Math.PI / 2; sub.castShadow = true; sub.receiveShadow = true; root.add(sub);
    label('FR4 Substrate (PCB)', anchorOn(root, -hx * 0.6, T, hz * 0.55), 0);

    // ── solder mask + silkscreen (lifts off as its own layer) ──
    const tex = pcbTextures(esc);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(L, W),
      new THREE.MeshStandardMaterial({ map: tex.map, roughnessMap: tex.roughnessMap, roughness: 1, metalness: 0.0, envMapIntensity: 0.7 }));
    top.rotation.x = -Math.PI / 2; top.position.y = T + 0.00012; top.receiveShadow = true; root.add(top);
    reg(top, [0, U * 0.14, 0]);
    label('Solder Mask & Silkscreen', top, 0.001);

    // ── gold castellated edge pads (stay on board, labelled) ──
    const padMat = mat(0xd7b24e, 0.32, 0.95);
    const rows = is4 ? 7 : 4;
    let padAnchor = null;
    for (let i = 0; i < rows; i++) {
      const z = -hz * 0.78 + (i / (rows - 1)) * (W * 0.78);
      [-1, 1].forEach((sgn) => {
        const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0016, T + 0.0004, 12, 1, false, 0, Math.PI), padMat);
        pad.rotation.x = -Math.PI / 2; pad.rotation.z = sgn > 0 ? 0 : Math.PI;
        pad.position.set(sgn * hx, (T + 0.0004) / 2, z); root.add(pad);
        if (sgn > 0 && i === rows - 1) padAnchor = pad;
      });
    }
    if (padAnchor) label('Castellated I/O Pads', padAnchor, 0.001);

    // ── MOSFET banks near the edges (each bank fans outward in its own axis) ──
    const fets = [];
    const banks = is4
      ? [{ cx: 0, cz: -hz * 0.62, n: 6, ax: 'x', off: [0, U * 0.34, -U * 0.18] },
      { cx: 0, cz: hz * 0.62, n: 6, ax: 'x', off: [0, U * 0.34, U * 0.18] },
      { cx: -hx * 0.62, cz: 0, n: 6, ax: 'z', off: [-U * 0.18, U * 0.34, 0] },
      { cx: hx * 0.62, cz: 0, n: 6, ax: 'z', off: [U * 0.18, U * 0.34, 0] }]
      : [{ cx: 0, cz: -hz * 0.5, n: 3, ax: 'x', off: [0, U * 0.34, -U * 0.18] },
      { cx: 0, cz: hz * 0.5, n: 3, ax: 'x', off: [0, U * 0.34, U * 0.18] }];
    let fetAnchor = null;
    banks.forEach((b, bi) => {
      const bg = new THREE.Group(); bg.position.set(b.cx, 0, b.cz); root.add(bg);
      for (let i = 0; i < b.n; i++) {
        const m = buildMosfet();
        const t = (i - (b.n - 1) / 2) * 0.006;
        if (b.ax === 'x') m.position.set(t, T + 0.00015, 0);
        else { m.position.set(0, T + 0.00015, t); m.rotation.y = Math.PI / 2; }
        bg.add(m); fets.push(m.userData.body);
      }
      reg(bg, b.off);
      if (bi === 0) fetAnchor = bg;
    });
    if (fetAnchor) label('Power MOSFETs (\u00d7' + (esc.mosfet_count || (is4 ? 24 : 6)) + ')', anchorOn(fetAnchor, 0, T + 0.002, 0), 0);

    // ── central MCU + gate-driver ICs ──
    const mcu = buildQFN(is4 ? 0.0092 : 0.007, 14); mcu.position.set(0, T + 0.00012, 0); root.add(mcu);
    reg(mcu, [0, U * 0.50, 0]);
    label('MCU / Gate Driver (QFN)', anchorOn(mcu, 0, 0.002, 0), 0);
    if (is4) {
      [[-hx * 0.34, hz * 0.32], [hx * 0.34, -hz * 0.32]].forEach((p) => {
        const d = buildQFN(0.004, 6); d.position.set(p[0], T + 0.00012, p[1]); root.add(d);
        reg(d, [p[0] * 0.2, U * 0.42, p[1] * 0.2]);
      });
    }

    // ── electrolytic capacitors ──
    const capH = is4 ? 0.012 : 0.009, capR = 0.0033;
    const capN = is4 ? 3 : 1;
    let capAnchor = null;
    for (let i = 0; i < capN; i++) {
      const cap = buildElectrolyticCap(capR, capH);
      const cx = (i - (capN - 1) / 2) * (capR * 2.3);
      cap.position.set(cx, T + 0.00012, -hz * 0.86); root.add(cap);
      reg(cap, [cx * 0.3, U * 0.62 + i * U * 0.05, -U * 0.06]);
      if (i === capN - 1) capAnchor = cap;
    }
    if (capAnchor) label(capN > 1 ? 'Electrolytic Capacitors' : 'Electrolytic Capacitor', anchorOn(capAnchor, 0, capH, 0), 0);

    // ── tiny SMD passives (deterministic scatter, grouped) ──
    const smdGroup = new THREE.Group(); root.add(smdGroup);
    const smdMat = mat(0x202326, 0.45, 0.2), smdTan = mat(0x6b5a3a, 0.55, 0.15);
    let smdAnchorMesh = null;
    for (let i = 0; i < (is4 ? 46 : 18); i++) {
      const sx = (seeded(i) - 0.5) * L * 0.82, sz = (seeded(i + 99) - 0.5) * W * 0.82;
      if (Math.abs(sx) < L * 0.12 && Math.abs(sz) < W * 0.12) continue;
      const smd = new THREE.Mesh(new THREE.BoxGeometry(0.0013, 0.0006, 0.0008), seeded(i + 7) > 0.7 ? smdTan : smdMat);
      smd.position.set(sx, T + 0.0003, sz); smd.rotation.y = seeded(i + 3) > 0.5 ? Math.PI / 2 : 0; smdGroup.add(smd);
      if (sx > L * 0.2 && sz > W * 0.2) smdAnchorMesh = smd;
    }
    if (!smdAnchorMesh) smdAnchorMesh = smdGroup.children[0] || null;
    reg(smdGroup, [0, U * 0.22, 0]);
    if (smdAnchorMesh) label('SMD Passives (R / C)', smdAnchorMesh, 0.0015);

    // ── white JST signal connector + rainbow ribbon (grouped) ──
    const connGroup = new THREE.Group(); root.add(connGroup);
    const jst = buildJST(6); jst.position.set(hx * 0.55, T + 0.00012, hz * 0.86); connGroup.add(jst);
    const ribbonCols = [0x2b6cb0, 0x38a169, 0xe53e3e, 0xd69e2e, 0xffffff, 0x805ad5];
    ribbonCols.forEach((col, i) => {
      const z = hz * 0.86 + 0.0006;
      const strand = buildWireTube([[hx * 0.55 - 0.003 + i * 0.0011, T + 0.0016, z],
      [hx * 0.55 - 0.003 + i * 0.0011, T + 0.004, z + 0.006],
      [hx * 0.4 + i * 0.0011, T + 0.002, z + 0.018]], 0.0004, col, 0.7);
      connGroup.add(strand);
    });
    reg(connGroup, [U * 0.12, U * 0.28, U * 0.16]);
    label('Signal Connector (JST)', anchorOn(jst, 0, 0.002, 0), 0);

    // ── thick silicone battery leads (red/black) + solder tabs (grouped) ──
    const leadsGroup = new THREE.Group(); root.add(leadsGroup);
    leadsGroup.add(buildWireTube([[-0.004, T + 0.001, hz], [-0.004, 0.004, hz + 0.01], [0.004, 0.006, hz + 0.02], [0.012, 0.003, hz + 0.028]], 0.0015, 0xcf2b27));
    leadsGroup.add(buildWireTube([[0.004, T + 0.001, hz], [0.004, 0.004, hz + 0.012], [-0.006, 0.006, hz + 0.022], [-0.014, 0.003, hz + 0.03]], 0.0015, 0x141414));
    [[-0.004], [0.004]].forEach(([x]) => { const tab = new THREE.Mesh(new THREE.CylinderGeometry(0.0018, 0.0018, T + 0.0006, 16), padMat); tab.position.set(x, (T + 0.0006) / 2, hz * 0.9); leadsGroup.add(tab); });
    reg(leadsGroup, [0, U * 0.20, U * 0.16]);
    label('Battery Leads (silicone)', anchorOn(leadsGroup, 0, 0.006, hz + 0.02), 0);

    // ── corner screws / standoffs (drop below the board) ──
    const screwGroup = new THREE.Group(); root.add(screwGroup);
    let screwAnchor = null;
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
      const s = buildScrew(0.0018); s.position.set(sx * (hx - 0.0032), T + 0.0002, sz * (hz - 0.0032)); screwGroup.add(s);
      if (sx > 0 && sz > 0) screwAnchor = s;
    });
    reg(screwGroup, [0, -U * 0.30, 0]);
    if (screwAnchor) label('Mounting Screws', screwAnchor, 0.001);

    // ── clamp-on heatsink (hidden until fitted; labelled only when visible) ──
    // Footprint is sized to cover the central FET / MCU cluster while clearing
    // the tall electrolytic caps and the JST + ribbon at the board edges. The
    // base sits a thermal-pad's gap above the parts it cools — so it reads as
    // clamped on, with no float and no clipping into neighbouring components.
    const heatsink = new THREE.Group();
    const hsW = L * 0.66, hsD = W * 0.66;
    const hsBaseThick = 0.0018;
    const hsBaseY = T + 0.0028;                              // base centre → bottom rests just over the MCU/FET tops
    const hsBase = new THREE.Mesh(new THREE.BoxGeometry(hsW, hsBaseThick, hsD), mat(0xb7c0ca, 0.32, 0.92));
    hsBase.position.set(0, hsBaseY, 0); hsBase.castShadow = true; heatsink.add(hsBase);
    const finN = 9, hsFinH = 0.007;
    const hsFinY = hsBaseY + hsBaseThick / 2 + hsFinH / 2;   // fins rooted on the base top face
    for (let i = 0; i < finN; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(hsW * 0.94, hsFinH, 0.0007), mat(0xc6ced6, 0.28, 0.93));
      fin.position.set(0, hsFinY, -hsD / 2 + (i + 0.5) * (hsD / finN)); fin.castShadow = true; heatsink.add(fin);
    }
    heatsink.visible = false; root.add(heatsink);
    reg(heatsink, [0, U * 0.86, 0]);
    label('Clamp-on Heatsink', anchorOn(heatsink, 0, hsFinY + hsFinH / 2 + 0.001, 0), 0);

    // ── motor wired to one edge (Exp3-style outrunner; sits off to -X) ──
    // Bundled with its phase leads into one assembly so the whole thing can be
    // hidden for the exploded teardown (Tab 1) and shown on the live-spin tabs.
    const motorAssembly = new THREE.Group(); root.add(motorAssembly);
    const motorGroup = buildMotor(motor || { kv: 2300 });
    motorGroup.position.set(-hx - 0.05, 0, 0); motorAssembly.add(motorGroup);
    label('Brushless Motor', anchorOn(motorGroup, 0, 0.02, 0), 0);
    [0xcf2b27, 0x141414, 0xd7b24e].forEach((col, i) => {
      const z = (i - 1) * 0.005;
      motorAssembly.add(buildWireTube([[-hx, T + 0.0012, z], [-hx - 0.02, 0.008, z], [-hx - 0.04, 0.006, z * 0.4], [motorGroup.position.x, 0.005, 0]], 0.0013, col));
    });

    // ── overheat smoke ──
    const smoke = []; let spawn = 0;
    const _wp = new THREE.Vector3();
    function tick(dt, over) {
      // Visual spin rate is capped & eased so the bell turns perceptibly without strobing.
      const rpm = motorGroup.userData.rpm;
      if (rpm > 0) {
        const revPerSec = Math.min(6, rpm / 2500);
        motorGroup.userData.spin.rotation.y += dt * revPerSec * Math.PI * 2;
      }
      if (over) {
        spawn += dt;
        if (spawn >= 0.05) {
          spawn = 0;
          const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.003, 6, 6), new THREE.MeshBasicMaterial({ color: 0x4b5563, transparent: true, opacity: 0.4, depthWrite: false }));
          const f = fets[Math.floor(Math.random() * fets.length)];
          f.getWorldPosition(_wp);                       // bank is now nested in a group → use world pos
          mesh.position.set(_wp.x, T + 0.005, _wp.z); root.add(mesh);
          smoke.push({ mesh, v: new THREE.Vector3((Math.random() - 0.5) * 0.01, 0.05 + Math.random() * 0.05, (Math.random() - 0.5) * 0.01), age: 0, max: 1 + Math.random() * 0.6 });
        }
      }
      for (let i = smoke.length - 1; i >= 0; i--) {
        const p = smoke[i]; p.age += dt;
        if (p.age >= p.max) { root.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); smoke.splice(i, 1); }
        else { const t = p.age / p.max; p.mesh.position.addScaledVector(p.v, dt); p.mesh.scale.setScalar(1 + t * 4); p.mesh.material.opacity = 0.4 * (1 - t); }
      }
    }
    function setTemperature(tC, amb, hot) {
      const a = amb === undefined ? 25 : amb, hi = hot === undefined ? 100 : hot;
      fets.forEach((b, i) => { const local = a + (tC - a) * (0.9 + 0.06 * Math.sin(i * 1.7)); const hc = heatColor(local, a, hi); b.material.emissive.copy(hc.col); b.material.emissiveIntensity = 0.12 + hc.n * 1.3; });
    }
    function setHeatsink(on) { heatsink.visible = !!on; }
    function setMotorVisible(on) { motorAssembly.visible = !!on; }
    function setRpm(rpm) { motorGroup.userData.rpm = rpm || 0; }
    // Fan every registered part out from its rest position to rest+off (all axes).
    function setExploded(t) {
      const k = Math.max(0, Math.min(1, t || 0));
      explodeParts.forEach((p) => {
        p.obj.position.set(p.rest.x + p.off.x * k, p.rest.y + p.off.y * k, p.rest.z + p.off.z * k);
      });
    }
    // Live world positions of each labelled part (skips parts hidden anywhere up the chain).
    const _av = new THREE.Vector3();
    function labelAnchors() {
      const out = [];
      for (let i = 0; i < labelDefs.length; i++) {
        const ld = labelDefs[i];
        let p = ld.obj, vis = true;
        while (p) { if (p.visible === false) { vis = false; break; } p = p.parent; }
        if (!vis) continue;
        ld.obj.getWorldPosition(_av);
        out.push({ name: ld.name, x: _av.x, y: _av.y + ld.y, z: _av.z });
      }
      return out;
    }
    function dispose() {
      root.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); if (m.roughnessMap) m.roughnessMap.dispose(); m.dispose(); }); }
      });
    }
    setTemperature(25, 25, 100);
    return {
      group: root, fets, heatsink, motorGroup, motorAssembly, dims: { L, W, T },
      name: String(esc.label || 'ESC').replace(/\s*\(x4\)/, ''),
      tick, setTemperature, setHeatsink, setMotorVisible, setRpm, setExploded, labelAnchors, dispose
    };
  }

  function buildMotor(motor) {
    const g = new THREE.Group();
    const bellR = 0.016, bellH = 0.013;
    const spin = new THREE.Group(); g.add(spin);
    // Bell — light anodized aluminium so it reads clearly and catches env-map highlights.
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(bellR, bellR * 0.86, bellH, 32), mat(0x9aa7b4, 0.34, 0.85));
    bell.position.y = 0.004 + bellH / 2; bell.castShadow = true; spin.add(bell);
    // High-contrast pinwheel top cap so rotation is unmistakable from above.
    const topY = 0.004 + bellH + 0.0003;
    const wedgeN = 6;
    for (let i = 0; i < wedgeN; i++) {
      const wedge = new THREE.Mesh(
        new THREE.CircleGeometry(bellR * 0.82, 28, (i / wedgeN) * Math.PI * 2, (Math.PI * 2) / wedgeN),
        mat(i % 2 ? 0xef4444 : 0xf8fafc, 0.5, 0.05));
      wedge.rotation.x = -Math.PI / 2; wedge.position.y = topY; wedge.userData.noEnv = true; spin.add(wedge);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(bellR * 0.16, bellR * 0.16, 0.0018, 16), mat(0x111827, 0.4, 0.6));
    hub.position.y = topY + 0.0007; spin.add(hub);
    // Bright vertical reference stripe on the bell side (rotation visible from the side too).
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.0007, bellH * 0.86, 0.0018), mat(0xfbbf24, 0.45, 0.2));
    stripe.position.set(0, 0.004 + bellH / 2, bellR * 0.99); spin.add(stripe);
    // Bell vents.
    const holeMat = mat(0x0f172a, 0.85, 0.1);
    for (let h = 0; h < 8; h++) { const aa = (h / 8) * Math.PI * 2; const hole = new THREE.Mesh(new THREE.CylinderGeometry(bellR * 0.13, bellR * 0.13, 0.0016, 12), holeMat); hole.position.set(Math.cos(aa) * bellR * 0.6, 0.004 + bellH - 0.0007, Math.sin(aa) * bellR * 0.6); spin.add(hole); }
    // Stator base + brighter copper windings + steel core.
    const base = new THREE.Mesh(new THREE.CylinderGeometry(bellR * 0.92, bellR * 0.97, 0.004, 28), mat(0x1f2937, 0.45, 0.5)); base.position.y = 0.002; g.add(base);
    const coilMat = mat(0xd97706, 0.32, 0.85);
    for (let c = 0; c < 12; c++) { const aa = (c / 12) * Math.PI * 2; const coil = new THREE.Mesh(new THREE.CylinderGeometry(bellR * 0.12, bellR * 0.12, bellH * 0.5, 8), coilMat); coil.position.set(Math.cos(aa) * bellR * 0.52, 0.004 + bellH * 0.25, Math.sin(aa) * bellR * 0.52); g.add(coil); }
    const core = new THREE.Mesh(new THREE.CylinderGeometry(bellR * 0.4, bellR * 0.4, bellH * 0.55, 16), mat(0x64748b, 0.5, 0.8)); core.position.y = 0.004 + bellH * 0.25; g.add(core);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0016, bellH * 1.7, 12), mat(0xe2e8f0, 0.18, 0.95)); shaft.position.y = 0.004 + bellH * 0.85; spin.add(shaft);
    const clip = new THREE.Mesh(new THREE.TorusGeometry(0.0022, 0.0006, 8, 16), mat(0xe2e8f0, 0.2, 0.9)); clip.position.y = 0.004 + bellH + 0.0014; clip.rotation.x = Math.PI / 2; spin.add(clip);
    g.userData.spin = spin; g.userData.rpm = 0;
    return g;
  }

  return { build, buildMotor, makeStudioEnv };
})();
