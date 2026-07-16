/* ================================================================
   Drone Structural Lab — single bundled script (main.js)
   Sections: [1] BLUEPRINT (heatmap + top-view)  [2] CANTILEVER
   (Module 2 physics + 3D + charts)  [3] CORE (catalog, assembly,
   CoG, sliders, run loop, wiring).  Consolidated into ONE file.
   ================================================================ */

/* ========================= [1] BLUEPRINT ========================= */
/*
 * js/blueprint.js — window.BLUEPRINT
 * ---------------------------------------------------------------------------
 * Two pure canvas-2D renderers for the Drone Structural Lab (Module 1). Both
 * draw the SAME proper quad-drone geometry (central frame plate, four tapered
 * arm tubes, motors, swept propeller blades) via one shared routine
 * (`drawDroneBody`) so the shapes are identical:
 *   - drawHeatmap  : the drone heat-coloured by each arm's load share, with
 *                    glow pools behind — "weight spread across the arms".
 *   - drawTopView  : the drone as a cyan drafting/blueprint line sketch, with
 *                    the placed components, CoG, tolerance ring and scale bar.
 *
 * Driven ONLY by the `model` object (BUILD_SPEC.md §2); never touches the DOM
 * (besides its canvas) or three.js.
 *
 * COORDINATE MAPPING (BUILD_SPEC §1):
 *   model:  x_mm = right(+)/left(-),  y_mm = forward/nose(+)/aft(-),  origin =
 *           frame centre.  canvas: +x right, +y DOWN.
 *       px = cx + x_mm*scale ;  py = cy - y_mm*scale   (nose/forward is UP)
 *   Arm indexing (X-config): 0=FR 1=FL 2=RL 3=RR. Positions always come from
 *   `arm.tip_mm`, never assumed angles.
 *
 * Both entry points are defensive: on missing/malformed model they draw an
 * "ASSEMBLING…" placeholder instead of throwing.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- palette
  const FIELD_BG = '#0f172a';
  const GRID_LINE = 'rgba(148, 163, 184, 0.08)';
  const CYAN = '#38bdf8';
  const CYAN_DIM = 'rgba(56, 189, 248, 0.45)';
  const RUST = '#c65d3b';
  const PAPER = '#f4f6f5';
  const MUTED = 'rgba(244, 246, 245, 0.55)';
  const GREEN = [22, 163, 74];    // #16a34a
  const AMBER = [245, 158, 11];   // #f59e0b
  const RED = [239, 68, 68];      // #ef4444

  // ------------------------------------------------------------ small utils
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function mix(c1, c2, t) { return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]; }
  function rgb(c, a) { a = (a === undefined) ? 1 : a; return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`; }

  // loadShare (0..1 of AUW) -> heat colour. An exactly-equal 25% share sits near
  // amber; well below is green, a disproportionate arm goes red.
  function loadColor(share, alpha) {
    const s = clamp(Number(share) || 0, 0, 1);
    const LO = 0.12, MID = 0.25, HI = 0.42;
    let c;
    if (s <= MID) c = mix(GREEN, AMBER, clamp((s - LO) / (MID - LO), 0, 1));
    else c = mix(AMBER, RED, clamp((s - MID) / (HI - MID), 0, 1));
    return rgb(c, alpha === undefined ? 1 : alpha);
  }
  function loadHeat01(share) {
    const s = clamp(Number(share) || 0, 0, 1);
    return clamp((s - 0.12) / (0.42 - 0.12), 0, 1);
  }

  // HiDPI canvas prep. Measures the CSS box, clamps + caps dpr so a flex canvas
  // whose backing store feeds its own layout width can't run away.
  function setupCanvas(canvas, bg) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const host = canvas.parentElement || canvas;
    let cw = canvas.clientWidth || host.clientWidth || 400;
    let ch = canvas.clientHeight || host.clientHeight || 300;
    cw = Math.max(40, Math.min(cw, 2000));
    ch = Math.max(40, Math.min(ch, 2000));
    const bw = Math.round(cw * dpr), bh = Math.round(ch * dpr);
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.fillStyle = bg || FIELD_BG;
    ctx.fillRect(0, 0, cw, ch);
    return { ctx, w: cw, h: ch, cx: cw / 2, cy: ch / 2 };
  }

  function drawGrid(ctx, w, h, spacing) {
    ctx.save();
    ctx.strokeStyle = GRID_LINE;
    ctx.lineWidth = 1;
    for (let x = 0; x <= w; x += spacing) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); ctx.stroke(); }
    for (let y = 0; y <= h; y += spacing) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); ctx.stroke(); }
    ctx.restore();
  }

  function placeholder(canvas, label) {
    const { ctx, w, h } = setupCanvas(canvas);
    drawGrid(ctx, w, h, 24);
    ctx.save();
    ctx.fillStyle = MUTED;
    ctx.font = '600 13px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label || 'ASSEMBLING…', w / 2, h / 2);
    ctx.restore();
  }

  function title(ctx, text, subtext) {
    ctx.save();
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillStyle = PAPER;
    ctx.font = '700 13px "IBM Plex Sans", sans-serif';
    ctx.fillText(text, 12, 10);
    if (subtext) {
      ctx.fillStyle = MUTED;
      ctx.font = '400 10px "IBM Plex Sans", sans-serif';
      ctx.fillText(subtext, 12, 27);
    }
    ctx.restore();
  }

  function niceScaleLength(scalePxPerMm) {
    const candidates = [5, 10, 20, 25, 50, 100, 150, 200, 250, 300, 500, 1000];
    let best = candidates[0];
    for (let i = 0; i < candidates.length; i++) {
      const px = candidates[i] * scalePxPerMm;
      best = candidates[i];
      if (px >= 40 && px <= 150) return candidates[i];
      if (px > 150) return candidates[Math.max(0, i - 1)] || candidates[0];
    }
    return best;
  }

  // Rounded-rect path (fallback for canvases without ctx.roundRect).
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function modelReady(model) {
    return !!(model && model.frame && Array.isArray(model.arms) && model.arms.length >= 4);
  }

  function shortLabel(p) {
    if (!p) return '';
    const key = (p.key || '').toLowerCase();
    const map = { battery: 'BAT', controller: 'FC', reciever: 'RX', receiver: 'RX', attachments: 'PLD', motor: 'MOT', propeller: 'PROP', esc: 'ESC', chasis: 'FRM' };
    return map[key] || (p.id ? String(p.id).slice(0, 4).toUpperCase() : (key ? key.slice(0, 3).toUpperCase() : '?'));
  }
  function isPlacementPart(p) {
    if (!p) return false;
    const key = (p.key || '').toLowerCase();
    return key === 'battery' || key === 'controller' || key === 'reciever' || key === 'receiver' || key === 'attachments';
  }

  // ==========================================================================
  // Shared drone geometry — one source of truth for both visuals.
  // ==========================================================================
  // Compute the on-screen layout (px scale + centre + part sizes) that fits the
  // whole drone (incl. prop discs) inside the drawing band [pad.top..h-pad.bottom].
  function droneLayout(model, w, h, pad) {
    const arms = model.arms.slice(0, 4);
    const frame = model.frame || {};
    const parts = Array.isArray(model.parts) ? model.parts : [];
    const prop = model.prop || {};
    const propDiaMm = prop.diameter_in ? prop.diameter_in * 25.4 : 127;
    const propRadiusMm = propDiaMm / 2;
    const blades = clamp(prop.blades || (/tri/i.test(prop.id || '') ? 3 : 2), 2, 4);

    let motorDiaMm = 0;
    const mp = parts.find(p => p && p.key === 'motor' && p.size_mm);
    if (mp) motorDiaMm = Math.max(mp.size_mm[0] || 0, mp.size_mm[2] || 0);
    if (!motorDiaMm) motorDiaMm = clamp(propDiaMm * 0.2, 15, 45);
    const motorRadiusMm = motorDiaMm / 2;
    const armWidthMm = clamp((frame.armProfile && frame.armProfile.b_mm) || 12, 6, 26);

    const footprintW = (frame.size_mm && frame.size_mm[0]) || 120;
    const footprintD = (frame.size_mm && frame.size_mm[2]) || 120;

    let maxExtent = Math.max(footprintW / 2, footprintD / 2, 40);
    arms.forEach(a => {
      if (a && a.tip_mm) maxExtent = Math.max(maxExtent, Math.abs(a.tip_mm[0]) + propRadiusMm, Math.abs(a.tip_mm[1]) + propRadiusMm);
    });
    if (pad.includeParts) {
      parts.forEach(p => {
        if (!p || !isPlacementPart(p)) return;
        const hw = (p.size_mm && p.size_mm[0] ? p.size_mm[0] : 10) / 2;
        const hd = (p.size_mm && p.size_mm[2] ? p.size_mm[2] : 10) / 2;
        maxExtent = Math.max(maxExtent, Math.abs(p.x_mm || 0) + hw, Math.abs(p.y_mm || 0) + hd);
      });
    }
    maxExtent *= (pad.margin || 1.12);

    const availW = w - pad.side * 2;
    const availH = h - pad.top - pad.bottom;
    const scale = Math.max(0.03, Math.min(availW, availH) / (2 * maxExtent));
    const centerX = w / 2;
    const centerY = pad.top + availH / 2;
    const toPx = (x, y) => ({ x: centerX + x * scale, y: centerY - y * scale });

    // Central frame plate = a SMALL hub well inside the innermost motor, so the
    // arms read as long tubes. `frame.size_mm` is the whole frame bounding box
    // (tip-to-tip), NOT the core plate, so we never use it for the body.
    let reachX = Infinity, reachY = Infinity;
    arms.forEach(a => {
      if (a && a.tip_mm) { reachX = Math.min(reachX, Math.abs(a.tip_mm[0])); reachY = Math.min(reachY, Math.abs(a.tip_mm[1])); }
    });
    if (!isFinite(reachX)) reachX = footprintW / 2;
    if (!isFinite(reachY)) reachY = footprintD / 2;
    const plateHalfWmm = clamp(reachX * 0.34, 14, 55);
    const plateHalfDmm = clamp(reachY * 0.34, 14, 55);

    return {
      arms, frame, parts, prop, blades, scale, centerX, centerY, toPx,
      propRadiusMm, motorRadiusMm, footprintW, footprintD, armWidthMm,
      bodyHalfW: plateHalfWmm * scale,
      bodyHalfD: plateHalfDmm * scale,
      armWpx: Math.max(3, armWidthMm * scale),
      motorRpx: Math.max(6, motorRadiusMm * scale),
      propRpx: Math.max(Math.max(6, motorRadiusMm * scale) * 1.35, propRadiusMm * scale),
    };
  }

  // A propeller: `blades` swept airfoil blades from the hub out to R. `cw` flips
  // the sweep so CW/CCW rotors read differently.
  function drawPropeller(ctx, x, y, R, hubR, blades, cw, fill, stroke) {
    fill = fill || 'rgba(56,189,248,0.12)';
    stroke = stroke || 'rgba(56,189,248,0.72)';
    const dir = cw ? 1 : -1;
    const inner = Math.max(hubR * 0.85, R * 0.12);
    ctx.save();
    ctx.translate(x, y);
    for (let b = 0; b < blades; b++) {
      ctx.save();
      ctx.rotate((b / blades) * Math.PI * 2);
      ctx.beginPath();
      ctx.moveTo(inner, 0);
      ctx.quadraticCurveTo(R * 0.55, dir * R * 0.19, R * 0.99, dir * R * 0.02);
      ctx.quadraticCurveTo(R * 0.99, 0, R * 0.9, -dir * R * 0.02);
      ctx.quadraticCurveTo(R * 0.5, -dir * R * 0.05, inner, 0);
      ctx.closePath();
      ctx.fillStyle = fill; ctx.fill();
      ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(0, 0, inner * 0.85, 0, Math.PI * 2);
    ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
  }

  // Draw the drone geometry (arms → body → motors → props) using per-arm colours
  // supplied by `style` callbacks, so the heatmap and blueprint share one shape.
  function drawDroneBody(ctx, L, style) {
    const { arms, toPx, centerX, centerY, bodyHalfW, bodyHalfD, armWpx, motorRpx, propRpx, blades } = L;
    // arms run from the hub centre out to each motor (they cross under the plate),
    // so they read as full-length tubes rather than stubs off a big box.
    const armStartR = Math.min(bodyHalfW, bodyHalfD) * 0.25;
    const capR = armWpx * 0.55;   // rounded motor-end pad radius

    // -- arms: tapered carbon tubes, hub → motor, with a rounded end cap --
    arms.forEach(arm => {
      if (!arm || !arm.tip_mm) return;
      const tip = toPx(arm.tip_mm[0], arm.tip_mm[1]);
      const ang = Math.atan2(tip.y - centerY, tip.x - centerX);
      const perp = ang + Math.PI / 2;
      const sx = centerX + Math.cos(ang) * armStartR, sy = centerY + Math.sin(ang) * armStartR;
      const wR = armWpx * 0.55, wT = armWpx * 0.42;
      ctx.beginPath();
      ctx.moveTo(sx + Math.cos(perp) * wR, sy + Math.sin(perp) * wR);
      ctx.lineTo(tip.x + Math.cos(perp) * wT, tip.y + Math.sin(perp) * wT);
      ctx.lineTo(tip.x - Math.cos(perp) * wT, tip.y - Math.sin(perp) * wT);
      ctx.lineTo(sx - Math.cos(perp) * wR, sy - Math.sin(perp) * wR);
      ctx.closePath();
      ctx.fillStyle = style.armFill(arm); ctx.fill();
      ctx.strokeStyle = style.armStroke(arm); ctx.lineWidth = 1.4; ctx.stroke();
      // rounded motor-mount pad at the arm tip
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, capR, 0, Math.PI * 2);
      ctx.fillStyle = style.armFill(arm); ctx.fill();
      ctx.strokeStyle = style.armStroke(arm); ctx.lineWidth = 1.4; ctx.stroke();
    });

    // -- central frame plate: outer plate + inner plate line + FC stack + bolts --
    ctx.save();
    const rad = Math.min(9, Math.min(bodyHalfW, bodyHalfD) * 0.32);
    roundRect(ctx, centerX - bodyHalfW, centerY - bodyHalfD, bodyHalfW * 2, bodyHalfD * 2, rad);
    ctx.fillStyle = style.bodyFill; ctx.fill();
    ctx.strokeStyle = style.bodyStroke; ctx.lineWidth = 1.7; ctx.stroke();
    // inner plate outline (a stacked-frame look)
    const inset = Math.min(bodyHalfW, bodyHalfD) * 0.24;
    roundRect(ctx, centerX - bodyHalfW + inset, centerY - bodyHalfD + inset, (bodyHalfW - inset) * 2, (bodyHalfD - inset) * 2, Math.max(2, rad - inset));
    ctx.strokeStyle = style.stackStroke; ctx.lineWidth = 1; ctx.stroke();
    // FC stack mounting holes (30.5×30.5 square pattern)
    const s = Math.min(bodyHalfW, bodyHalfD) * 0.5;
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(q => {
      ctx.beginPath();
      ctx.arc(centerX + q[0] * s, centerY + q[1] * s, Math.max(1.3, s * 0.16), 0, Math.PI * 2);
      ctx.strokeStyle = style.stackStroke; ctx.lineWidth = 1; ctx.stroke();
    });
    ctx.restore();

    // -- motors: bell + stator ring + hub --
    arms.forEach(arm => {
      if (!arm || !arm.tip_mm) return;
      const tip = toPx(arm.tip_mm[0], arm.tip_mm[1]);
      ctx.save();
      ctx.beginPath(); ctx.arc(tip.x, tip.y, motorRpx, 0, Math.PI * 2);
      ctx.fillStyle = style.motorFill(arm); ctx.fill();
      ctx.strokeStyle = style.motorStroke(arm); ctx.lineWidth = 1.5; ctx.stroke();
      ctx.beginPath(); ctx.arc(tip.x, tip.y, motorRpx * 0.6, 0, Math.PI * 2);
      ctx.strokeStyle = style.motorInner(arm); ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath(); ctx.arc(tip.x, tip.y, Math.max(1.4, motorRpx * 0.16), 0, Math.PI * 2);
      ctx.fillStyle = style.hub(arm); ctx.fill();
      ctx.restore();
    });

    // -- propellers: swept blades, CW/CCW alternating per arm --
    arms.forEach((arm, i) => {
      if (!arm || !arm.tip_mm) return;
      const tip = toPx(arm.tip_mm[0], arm.tip_mm[1]);
      const cw = ((arm.index != null ? arm.index : i) % 2) === 0;
      drawPropeller(ctx, tip.x, tip.y, propRpx, motorRpx, blades, cw, style.propFill(arm), style.propStroke(arm));
    });
  }

  // CoG crosshair + tolerance ring (shared).
  function drawCog(ctx, L, model, ringColor) {
    const cog = model.cog || { x_mm: 0, y_mm: 0, r_mm: 0 };
    const p = L.toPx(cog.x_mm || 0, cog.y_mm || 0);
    const tolMm = model.tolerance_mm || 10;
    const tolPx = tolMm * L.scale;
    const balanced = (model.balanced !== undefined) ? model.balanced : ((cog.r_mm || 0) <= tolMm);
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(L.centerX, L.centerY, tolPx, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = balanced ? '#22c55e' : '#ef4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x - 11, p.y); ctx.lineTo(p.x + 11, p.y);
    ctx.moveTo(p.x, p.y - 11); ctx.lineTo(p.x, p.y + 11);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = balanced ? '#22c55e' : '#ef4444'; ctx.fill();
    ctx.restore();
  }

  // ==========================================================================
  // 1) drawHeatmap — the drone, arms/motors/props heat-coloured by load share.
  // ==========================================================================
  function drawHeatmap(canvas, model) {
    try {
      if (!canvas) return;
      if (!modelReady(model) || !model.cog) { placeholder(canvas); return; }
      const { ctx, w, h } = setupCanvas(canvas);
      drawGrid(ctx, w, h, 20);

      const L = droneLayout(model, w, h, { top: 48, bottom: 52, side: 30, margin: 1.14, includeParts: false });

      // -- heat pools (radial glow) behind the drone --
      L.arms.forEach(arm => {
        if (!arm || !arm.tip_mm) return;
        const t = L.toPx(arm.tip_mm[0], arm.tip_mm[1]);
        const poolR = L.propRpx * (0.85 + loadHeat01(arm.loadShare) * 0.7);
        const g = ctx.createRadialGradient(t.x, t.y, 0, t.x, t.y, poolR);
        g.addColorStop(0, loadColor(arm.loadShare, 0.5));
        g.addColorStop(0.55, loadColor(arm.loadShare, 0.2));
        g.addColorStop(1, 'rgba(15,23,42,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(t.x, t.y, poolR, 0, Math.PI * 2); ctx.fill();
      });

      // -- the drone, heat-coloured --
      const heatStyle = {
        stack: false,
        bodyFill: 'rgba(226,232,240,0.10)',
        bodyStroke: 'rgba(244,246,245,0.65)',
        stackStroke: 'rgba(244,246,245,0.4)',
        armFill: a => loadColor(a.loadShare, 0.80),
        armStroke: () => 'rgba(15,23,42,0.55)',
        motorFill: a => loadColor(a.loadShare, 0.95),
        motorStroke: () => 'rgba(244,246,245,0.9)',
        motorInner: () => 'rgba(15,23,42,0.5)',
        hub: () => 'rgba(15,23,42,0.85)',
        propFill: a => loadColor(a.loadShare, 0.22),
        propStroke: a => loadColor(a.loadShare, 0.85),
      };
      drawDroneBody(ctx, L, heatStyle);

      // -- per-arm labels: share % + force --
      const armLabels = ['FR', 'FL', 'RL', 'RR'];
      L.arms.forEach((arm, i) => {
        if (!arm || !arm.tip_mm) return;
        const t = L.toPx(arm.tip_mm[0], arm.tip_mm[1]);
        const dir = t.y >= L.centerY ? 1 : -1;
        const ly = t.y + dir * (L.propRpx + 12);
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(244,246,245,0.45)';
        ctx.font = '600 9px "IBM Plex Sans", sans-serif';
        ctx.fillText(armLabels[arm.index != null ? arm.index : i], t.x, ly - dir * 12);
        ctx.fillStyle = '#f4f6f5';
        ctx.font = '700 11px "IBM Plex Mono", monospace';
        ctx.fillText((arm.loadShare != null ? (arm.loadShare * 100).toFixed(1) : '--') + '%', t.x, ly + dir * 2);
        ctx.fillStyle = 'rgba(244,246,245,0.6)';
        ctx.font = '500 9px "IBM Plex Mono", monospace';
        ctx.fillText((arm.loadForce_N != null ? arm.loadForce_N.toFixed(2) + ' N' : ''), t.x, ly + dir * 14);
      });

      // -- CoG crosshair + tolerance ring --
      drawCog(ctx, L, model, 'rgba(244,246,245,0.35)');

      // -- colour-scale legend --
      const legW = Math.min(180, w - 68), legX = w / 2 - legW / 2, legY = h - 30, legH = 8;
      const lg = ctx.createLinearGradient(legX, 0, legX + legW, 0);
      lg.addColorStop(0, rgb(GREEN, 1)); lg.addColorStop(0.5, rgb(AMBER, 1)); lg.addColorStop(1, rgb(RED, 1));
      ctx.fillStyle = lg; ctx.fillRect(legX, legY, legW, legH);
      ctx.strokeStyle = 'rgba(244,246,245,0.4)'; ctx.lineWidth = 1; ctx.strokeRect(legX, legY, legW, legH);
      ctx.fillStyle = MUTED; ctx.font = '500 9px "IBM Plex Mono", monospace';
      ctx.textAlign = 'left'; ctx.fillText('LOW', legX, legY + legH + 11);
      ctx.textAlign = 'right'; ctx.fillText('HIGH', legX + legW, legY + legH + 11);
      ctx.textAlign = 'center'; ctx.fillText('ARM LOAD SHARE', legX + legW / 2, legY - 7);

      title(ctx, 'LOAD DISTRIBUTION', 'weight spread across arms');
    } catch (err) {
      try { placeholder(canvas, 'HEATMAP UNAVAILABLE'); } catch (e2) { /* noop */ }
      if (window.console) console.warn('[BLUEPRINT] drawHeatmap failed:', err);
    }
  }

  // ==========================================================================
  // 2) drawTopView — the drone as a cyan blueprint + placed components.
  // ==========================================================================
  function drawTopView(canvas, model) {
    try {
      if (!canvas) return;
      if (!modelReady(model)) { placeholder(canvas); return; }
      const { ctx, w, h } = setupCanvas(canvas);
      drawGrid(ctx, w, h, 24);

      const L = droneLayout(model, w, h, { top: 44, bottom: 40, side: 22, margin: 1.16, includeParts: true });
      const parts = L.parts;

      // -- mm scale bar (bottom-left) --
      const barLenMm = niceScaleLength(L.scale), barPx = barLenMm * L.scale, barX0 = 22, barY = h - 16;
      ctx.save();
      ctx.strokeStyle = CYAN; ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(barX0, barY); ctx.lineTo(barX0 + barPx, barY);
      ctx.moveTo(barX0, barY - 4); ctx.lineTo(barX0, barY + 4);
      ctx.moveTo(barX0 + barPx, barY - 4); ctx.lineTo(barX0 + barPx, barY + 4);
      ctx.stroke();
      ctx.fillStyle = CYAN_DIM; ctx.font = '500 9px "IBM Plex Mono", monospace';
      ctx.textAlign = 'left'; ctx.fillText(barLenMm + ' mm', barX0, barY - 8);
      ctx.restore();

      // -- axis labels --
      ctx.save();
      ctx.fillStyle = CYAN_DIM; ctx.font = '600 10px "IBM Plex Mono", monospace';
      ctx.textAlign = 'right'; ctx.fillText('+X (right)', w - 22, h - 26);
      ctx.textAlign = 'left'; ctx.fillText('+Y (nose)', 24, 46);
      ctx.restore();

      // -- faint swept-area discs behind each rotor --
      L.arms.forEach(arm => {
        if (!arm || !arm.tip_mm) return;
        const t = L.toPx(arm.tip_mm[0], arm.tip_mm[1]);
        ctx.save();
        ctx.setLineDash([2, 4]); ctx.strokeStyle = 'rgba(56,189,248,0.16)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(t.x, t.y, L.propRpx, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      });

      // -- the drone, cyan blueprint style --
      const blueStyle = {
        stack: true,
        bodyFill: 'rgba(56,189,248,0.05)',
        bodyStroke: CYAN,
        stackStroke: 'rgba(56,189,248,0.5)',
        armFill: () => 'rgba(56,189,248,0.06)',
        armStroke: () => 'rgba(56,189,248,0.72)',
        motorFill: () => 'rgba(15,23,42,0.9)',
        motorStroke: () => CYAN,
        motorInner: () => 'rgba(56,189,248,0.5)',
        hub: () => CYAN,
        propFill: () => 'rgba(56,189,248,0.12)',
        propStroke: () => 'rgba(56,189,248,0.72)',
      };
      drawDroneBody(ctx, L, blueStyle);

      // -- arm labels --
      const armLabels = ['FR', 'FL', 'RL', 'RR'];
      L.arms.forEach((arm, i) => {
        if (!arm || !arm.tip_mm) return;
        const t = L.toPx(arm.tip_mm[0], arm.tip_mm[1]);
        const dir = t.y >= L.centerY ? 1 : -1;
        ctx.textAlign = 'center'; ctx.fillStyle = CYAN_DIM;
        ctx.font = '600 9px "IBM Plex Mono", monospace';
        ctx.fillText(armLabels[arm.index != null ? arm.index : i], t.x, t.y + dir * (L.propRpx + 11));
      });

      // -- nose marker (front, +Y) --
      ctx.save();
      ctx.fillStyle = 'rgba(56,189,248,0.7)';
      const noseY = L.centerY - L.bodyHalfD - 7;
      ctx.beginPath();
      ctx.moveTo(L.centerX, noseY - 6);
      ctx.lineTo(L.centerX - 5, noseY + 3);
      ctx.lineTo(L.centerX + 5, noseY + 3);
      ctx.closePath(); ctx.fill();
      ctx.restore();

      // -- placed components (battery / FC / receiver / payload) --
      parts.forEach(p => {
        if (!p || !isPlacementPart(p)) return;
        const hw = ((p.size_mm && p.size_mm[0]) || 14) / 2 * L.scale;
        const hd = ((p.size_mm && p.size_mm[2]) || 14) / 2 * L.scale;
        const pt = L.toPx(p.x_mm || 0, p.y_mm || 0);
        const mv = !!p.movable;
        ctx.save();
        roundRect(ctx, pt.x - hw, pt.y - hd, hw * 2, hd * 2, 3);
        ctx.fillStyle = mv ? 'rgba(198,93,59,0.32)' : 'rgba(79,109,158,0.22)'; ctx.fill();
        ctx.strokeStyle = mv ? RUST : 'rgba(79,109,158,0.95)'; ctx.lineWidth = mv ? 1.7 : 1;
        roundRect(ctx, pt.x - hw, pt.y - hd, hw * 2, hd * 2, 3); ctx.stroke();
        if (hw > 9 && hd > 5) {
          ctx.fillStyle = mv ? '#f4f6f5' : 'rgba(226,232,240,0.85)';
          ctx.font = '700 8px "IBM Plex Mono", monospace';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(shortLabel(p), pt.x, pt.y);
        }
        ctx.restore();
      });

      // -- CoG crosshair + tolerance ring --
      drawCog(ctx, L, model, 'rgba(56,189,248,0.5)');

      title(ctx, 'TOP-VIEW BLUEPRINT', 'component placement');
    } catch (err) {
      try { placeholder(canvas, 'BLUEPRINT UNAVAILABLE'); } catch (e2) { /* noop */ }
      if (window.console) console.warn('[BLUEPRINT] drawTopView failed:', err);
    }
  }

  window.BLUEPRINT = { drawHeatmap, drawTopView };
})();

/* ========================= [2] CANTILEVER ======================== */
/*
 * js/cantilever.js — window.CANTILEVER
 * ---------------------------------------------------------------------------
 * Module 2 — "Cantilever Arm Stress". One arm of the quad is modelled as a
 * fixed-free (clamped-at-root) beam carrying the motor+prop assembly at its
 * free tip. This file is fully self-contained: `solve()` is pure physics (no
 * DOM/THREE), `build()`/`step()` render + animate a three.js rig into a group
 * main.js owns, and `drawCharts()` paints the SFD/BMD/stress-bar canvases with
 * plain canvas-2D (no chart library). Everything here is driven ONLY by the
 * `model` object described in BUILD_SPEC.md §2 — never the DOM, never the
 * live three.js scene graph beyond the `group` handed to `build()`.
 *
 * PHYSICS (Euler–Bernoulli cantilever beam, small-deflection, static):
 *   Tip load        F [N]   = per-motor max thrust (model.tipForce_N) +
 *                              dead weight of the motor+prop (m·g). Both act
 *                              to bend the arm, so the worst case sums them.
 *   Section         hollow rectangular tube, outer b(width, Z) × h(height, Y),
 *                   uniform wall thickness t. Second moment of area (about the
 *                   bending axis, i.e. using the height dimension):
 *                     I = (b·h³ − (b−2t)·(h−2t)³) / 12         [m⁴]
 *   Bending moment  M(x) = F·(L−x)                              [N·m]
 *                   (x measured from the root, L = arm length; M is max at
 *                   the root x=0, zero at the free tip x=L)
 *   Section modulus Z = I / (h/2)                                [m³]
 *   Bending stress  σ(x) = M(x)·c / I,  c = h/2                  [Pa] → MPa
 *   Safety factor   SF = σ_yield / σ_applied(root)
 *   Tip deflection  δ(x) = F·x²·(3L−x) / (6·E·I)                 [m] → mm
 *   1st bending mode (fixed-free, beta1=1.875):
 *                   f1 = (beta1²/2π)·√(E·I / (m'·L⁴)),  m' = ρ·A_wall [kg/m]
 *   Units: all geometry in mm at the model boundary, converted to SI (m) for
 *   every calculation; stress is reported in MPa, forces in N, moments in N·m.
 *
 * Ported + cleaned from `_old_backup/main.js.old`'s `Calc` module (lines
 * ~1546-1720, validated formulas) and its `buildCantileverScene` /
 * `applyCantileverLoad` three.js rig (lines ~4301-4666).
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- palette
  // Aerospace tokens shared across the lab (BUILD_SPEC §7).
  var NAVY = '#1f3a93';
  var STEEL = '#4f6d9e';
  var RUST = '#c65d3b';
  var INK = '#1e2a29';
  var DANGER = '#a83232';
  var SUCCESS = '#1f8a5b';
  var FIELD_BG = '#0f172a';
  var PAPER = '#f4f6f5';
  var MUTED = 'rgba(244, 246, 245, 0.55)';
  var GRID_LINE = 'rgba(148, 163, 184, 0.10)';

  var G = 9.80665; // standard gravity, m/s^2 — canonical across the lab

  // Deflection is sub-millimetre to a few mm on real arms and would be
  // invisible on screen at true scale; the 3D rig exaggerates the visual
  // deflection curve by this factor. All returned/reported numbers
  // (deflection_mm, HUD telemetry) remain physically correct/unscaled.
  var DEFLECT_EXAGGERATION = 10;

  // ------------------------------------------------------------- small utils
  function num(v, fallback) {
    return (typeof v === 'number' && isFinite(v)) ? v : fallback;
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ===========================================================================
  // 1. PURE PHYSICS (no DOM, no THREE) — mirrors the old `Calc` module
  // ===========================================================================

  function hollowInertia_m4(b_mm, h_mm, t_mm) {
    var bO = b_mm / 1000, hO = h_mm / 1000;
    var bI = Math.max(0, b_mm - 2 * t_mm) / 1000;
    var hI = Math.max(0, h_mm - 2 * t_mm) / 1000;
    return (bO * Math.pow(hO, 3) - bI * Math.pow(hI, 3)) / 12;
  }

  function bendingMomentAtX_Nm(F_N, x_mm, L_mm) {
    var x = x_mm / 1000, L = L_mm / 1000;
    if (x > L) return 0;
    return F_N * (L - x);
  }

  function bendingMoment_Nm(F_N, L_mm) {
    return bendingMomentAtX_Nm(F_N, 0, L_mm);
  }

  function bendingStress_MPa(M_Nm, h_mm, I_m4) {
    if (!I_m4 || I_m4 <= 0) return 0;
    var c = (h_mm / 2) / 1000;
    return (M_Nm * c / I_m4) / 1e6;
  }

  function sectionModulus_m3(I_m4, h_mm) {
    if (!h_mm || h_mm <= 0) return 0;
    return I_m4 / ((h_mm / 2) / 1000);
  }

  function safetyFactor(yield_mpa, stress_mpa) {
    if (!stress_mpa || stress_mpa <= 0) return 99;
    return yield_mpa / stress_mpa;
  }

  function deflectionAtX_m(F_N, x_mm, L_mm, E_gpa, I_m4) {
    var x = x_mm / 1000, L = L_mm / 1000;
    var E = E_gpa * 1e9;
    if (x > L || !I_m4 || E * I_m4 <= 0) return 0;
    return (F_N * x * x * (3 * L - x)) / (6 * E * I_m4);
  }

  function firstBendingModeHz(L_mm, b_mm, h_mm, t_mm, E_gpa, density_kg_m3) {
    var L = L_mm / 1000;
    var E = E_gpa * 1e9;
    var I = hollowInertia_m4(b_mm, h_mm, t_mm);
    var A_m2 = (b_mm * h_mm - Math.max(0, b_mm - 2 * t_mm) * Math.max(0, h_mm - 2 * t_mm)) / 1e6;
    var mLin = (density_kg_m3 || 1600) * A_m2; // kg/m
    if (mLin <= 0 || L <= 0 || E * I <= 0) return 0;
    var beta1 = 1.875104069;
    return (beta1 * beta1 / (2 * Math.PI)) * Math.sqrt((E * I) / (mLin * Math.pow(L, 4)));
  }

  // Arm cross-section fallback per BUILD_SPEC §5, in case main.js hasn't
  // synthesised `model.frame.armProfile` yet (defensive duplicate).
  function synthesizeProfile(wheelbase_mm) {
    var w = num(wheelbase_mm, 250);
    if (w <= 160) return { b_mm: 8, h_mm: 5, t_mm: 1 };
    if (w <= 260) return { b_mm: 10, h_mm: 6, t_mm: 1 };
    if (w <= 330) return { b_mm: 12, h_mm: 7, t_mm: 1.2 };
    if (w <= 460) return { b_mm: 15, h_mm: 8, t_mm: 1.5 };
    return { b_mm: 18, h_mm: 12, t_mm: 2 };
  }

  var DEFAULT_MATERIAL = { id: 'carbon_t700', label: 'Carbon Fibre T700', yield_mpa: 600, youngs_gpa: 70, density_kg_m3: 1600 };

  // Resolve every physics input from `model`, defaulting anything missing so
  // this module never throws on a partial/undefined model.
  function resolveInputs(model) {
    var frame = (model && model.frame) || {};
    var armLen_mm = num(frame.arm_length_mm, 250);
    var profile = frame.armProfile || synthesizeProfile(frame.wheelbase_mm);
    var b_mm = num(profile.b_mm, 15);
    var h_mm = num(profile.h_mm, 8);
    var t_mm = num(profile.t_mm, 1.5);
    var mat = frame.material || DEFAULT_MATERIAL;
    var yield_mpa = num(mat.yield_mpa, DEFAULT_MATERIAL.yield_mpa);
    var youngs_gpa = num(mat.youngs_gpa, DEFAULT_MATERIAL.youngs_gpa);
    var density_kg_m3 = num(mat.density_kg_m3, DEFAULT_MATERIAL.density_kg_m3);

    var motor = (model && model.motor) || {};
    var prop = (model && model.prop) || {};
    var motorMass_g = num(motor.mass_g, 35);
    var propMass_g = num(prop.mass_g, 15);
    var weight_N = ((motorMass_g + propMass_g) / 1000) * G;
    var thrust_N = num(model && model.tipForce_N, 10);
    var force_N = weight_N + thrust_N;

    return {
      armLen_mm: armLen_mm, b_mm: b_mm, h_mm: h_mm, t_mm: t_mm,
      yield_mpa: yield_mpa, youngs_gpa: youngs_gpa, density_kg_m3: density_kg_m3,
      materialId: mat.id, materialLabel: mat.label,
      motorMass_g: motorMass_g, propMass_g: propMass_g,
      weight_N: weight_N, thrust_N: thrust_N, force_N: force_N
    };
  }

  function safeFallbackSolve() {
    return {
      force_N: 0, armLen_mm: 250, inertia_m4: 0, sectionModulus: 0,
      moment_max_Nm: 0, stress_mpa: 0, yield_mpa: DEFAULT_MATERIAL.yield_mpa,
      safetyFactor: 99, deflection_mm: 0, firstBendingMode_hz: 0,
      sfd: { x_mm: [0, 250], V_N: [0, 0] }, bmd: { x_mm: [0, 250], M_Nm: [0, 0] },
      verdict: 'PASS', pass: true,
      profile: { b_mm: 15, h_mm: 8, t_mm: 1.5 }, material: DEFAULT_MATERIAL,
      forceBreakdown: { thrust_N: 0, weight_N: 0 }
    };
  }

  // Pure physics from the model. No DOM, no THREE.
  function solve(model) {
    try {
      var r = resolveInputs(model);
      var I = hollowInertia_m4(r.b_mm, r.h_mm, r.t_mm);
      var sectionModulus = sectionModulus_m3(I, r.h_mm);
      var moment_max_Nm = bendingMoment_Nm(r.force_N, r.armLen_mm);
      var stress_mpa = bendingStress_MPa(moment_max_Nm, r.h_mm, I);
      var sf = safetyFactor(r.yield_mpa, stress_mpa);
      var deflection_mm = deflectionAtX_m(r.force_N, r.armLen_mm, r.armLen_mm, r.youngs_gpa, I) * 1000;
      var fbm = firstBendingModeHz(r.armLen_mm, r.b_mm, r.h_mm, r.t_mm, r.youngs_gpa, r.density_kg_m3);

      var N = 24;
      var x_mm = [], V_N = [], M_Nm = [];
      for (var i = 0; i <= N; i++) {
        var x = (i / N) * r.armLen_mm;
        x_mm.push(x);
        V_N.push(-r.force_N); // constant shear along a beam with a single tip load
        M_Nm.push(bendingMomentAtX_Nm(r.force_N, x, r.armLen_mm));
      }

      var verdict = sf >= 2 ? 'PASS' : (sf >= 1 ? 'MARGINAL' : 'FAIL');

      return {
        force_N: r.force_N, armLen_mm: r.armLen_mm,
        inertia_m4: I, sectionModulus: sectionModulus,
        moment_max_Nm: moment_max_Nm, stress_mpa: stress_mpa, yield_mpa: r.yield_mpa,
        safetyFactor: sf, deflection_mm: deflection_mm, firstBendingMode_hz: fbm,
        sfd: { x_mm: x_mm, V_N: V_N }, bmd: { x_mm: x_mm, M_Nm: M_Nm },
        verdict: verdict, pass: verdict !== 'FAIL',
        // extras (additive, non-breaking) — handy for the HUD/formula readouts
        profile: { b_mm: r.b_mm, h_mm: r.h_mm, t_mm: r.t_mm },
        material: { id: r.materialId, label: r.materialLabel, yield_mpa: r.yield_mpa, youngs_gpa: r.youngs_gpa, density_kg_m3: r.density_kg_m3 },
        forceBreakdown: { thrust_N: r.thrust_N, weight_N: r.weight_N }
      };
    } catch (e) {
      console.warn('[CANTILEVER] solve() failed, returning safe fallback:', e);
      return safeFallbackSolve();
    }
  }

  // ===========================================================================
  // 2. THREE.JS RIG — build() / step()
  // ===========================================================================

  var STATE = null; // { THREE, group, root, model, solved, r, beamMesh, tipGroup, arrowGroup, ... }

  function disposeObject3D(obj) {
    if (!obj) return;
    obj.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach(function (m) { m.dispose(); });
        else o.material.dispose();
      }
    });
  }

  function disposeRoot() {
    if (STATE && STATE.root && STATE.group) {
      STATE.group.remove(STATE.root);
      disposeObject3D(STATE.root);
    }
  }

  function materialColorHex(materialId) {
    if (materialId === 'aluminium' || materialId === 'aluminum' || materialId === 'aluminium_6061') return 0xa8a8a8;
    if (materialId === 'nylon' || materialId === 'nylon_pa66') return 0xe8dcc8;
    return 0x1c1c1e; // carbon fibre graphite (default)
  }

  // stress ratio (0..1+) -> THREE.Color, green(success) -> rust(marginal/amber) -> red(danger)
  function stressColor(THREE, ratio) {
    var rt = clamp(ratio, 0, 1.2);
    var start = new THREE.Color(SUCCESS);
    var mid = new THREE.Color(RUST);
    var end = new THREE.Color(DANGER);
    var c = new THREE.Color();
    if (rt < 0.5) c.lerpColors(start, mid, rt * 2.0);
    else c.lerpColors(mid, end, Math.min((rt - 0.5) * 2.0, 1.0));
    return c;
  }

  // Build/refresh the three.js cantilever into the shared viewport group.
  // main.js clears/owns `group` + the camera + lights; we only add meshes.
  function build(opts) {
    opts = opts || {};
    var THREE = opts.THREE, group = opts.group, model = opts.model;
    if (!THREE || !group) return;

    try {
      disposeRoot();

      var root = new THREE.Group();
      root.name = 'cantileverRig';
      group.add(root);

      var r = resolveInputs(model);
      var solved = solve(model);

      var L_m = r.armLen_mm / 1000;
      var h_m = r.h_mm / 1000;
      var b_m = r.b_mm / 1000;
      var matHex = materialColorHex(r.materialId);

      // -------------------------------------------------------------- ground
      var groundMat = new THREE.MeshStandardMaterial({ color: 0x1e2530, roughness: 0.9, metalness: 0.05 });
      var ground = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.01, 0.14), groundMat);
      ground.position.set(-0.03, -0.065, 0);
      root.add(ground);

      // -------------------------------------------------------------- clamp
      var clampMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.4, metalness: 0.5 });
      var cW = 0.05, cH = Math.max(0.06, h_m * 2.2), cD = Math.max(0.04, b_m * 2.0);
      var clamp3d = new THREE.Mesh(new THREE.BoxGeometry(cW, cH, cD), clampMat);
      clamp3d.position.set(-cW / 2, cH / 2 - 0.06, 0);
      root.add(clamp3d);

      // two bolt heads on top of the clamp for detail
      var boltMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5, metalness: 0.6 });
      [-cD * 0.28, cD * 0.28].forEach(function (bz) {
        var bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.01, 8), boltMat);
        bolt.position.set(-cW / 2, cH - 0.06, bz);
        root.add(bolt);
      });

      // support post from ground to clamp
      var post = new THREE.Mesh(new THREE.BoxGeometry(0.012, cH, 0.012), clampMat);
      post.position.set(-cW / 2, (cH - 0.06 - 0.065) / 2 - 0.0325, cD * 0.35);
      root.add(post);

      // -------------------------------------------------------------- beam
      var segX = 64;
      var beamGeo = new THREE.BoxGeometry(L_m, h_m, b_m, segX, 1, 1);
      var posAttr = beamGeo.attributes.position;
      var baseColor = new THREE.Color(matHex);
      var colorArr = [];
      for (var i = 0; i < posAttr.count; i++) colorArr.push(baseColor.r, baseColor.g, baseColor.b);
      beamGeo.setAttribute('color', new THREE.Float32BufferAttribute(colorArr, 3));

      var beamMat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: r.materialId === 'aluminium' ? 0.4 : (r.materialId === 'nylon' ? 0.6 : 0.35),
        metalness: r.materialId === 'aluminium' ? 0.7 : 0.05,
        side: THREE.DoubleSide
      });
      var beamMesh = new THREE.Mesh(beamGeo, beamMat);
      beamMesh.position.set(L_m / 2 - cW / 2, 0, 0);
      root.add(beamMesh);
      beamMesh.geometry.userData = {
        originalPositions: posAttr.clone(),
        length_m: L_m, height_m: h_m, baseColorHex: matHex
      };

      // -------------------------------------------------------------- tip (motor+prop dummy)
      var tipGroup = new THREE.Group();
      tipGroup.position.set(L_m - cW / 2, 0, 0);
      root.add(tipGroup);

      var bellMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.35, metalness: 0.7 });
      var bell = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.012, 16), bellMat);
      bell.position.y = 0.006 + h_m / 2;
      tipGroup.add(bell);

      var baseMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5, metalness: 0.2 });
      var motorBase = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.004, 12), baseMat);
      motorBase.position.y = 0.002 + h_m / 2;
      tipGroup.add(motorBase);

      // two simple crossed prop blades
      var bladeMat = new THREE.MeshStandardMaterial({ color: 0x1f3a93, roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide });
      var bladeGeo = new THREE.BoxGeometry(0.05, 0.001, 0.008);
      var blade1 = new THREE.Mesh(bladeGeo, bladeMat);
      blade1.position.y = 0.014 + h_m / 2;
      tipGroup.add(blade1);
      var blade2 = new THREE.Mesh(bladeGeo, bladeMat);
      blade2.position.y = 0.014 + h_m / 2;
      blade2.rotation.y = Math.PI / 2;
      tipGroup.add(blade2);

      // -------------------------------------------------------------- load arrow (downward)
      var arrowGroup = new THREE.Group();
      arrowGroup.position.set(0, 0.09 + h_m / 2, 0);
      tipGroup.add(arrowGroup);

      var arrowMat = new THREE.MeshStandardMaterial({ color: 0xc65d3b, roughness: 0.3, metalness: 0.2, transparent: true, opacity: 0.85 });
      var shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0018, 0.0018, 0.05, 8), arrowMat);
      shaft.position.y = 0.025;
      arrowGroup.add(shaft);
      var head = new THREE.Mesh(new THREE.ConeGeometry(0.005, 0.012, 8), arrowMat);
      head.position.y = -0.006;
      head.rotation.z = Math.PI; // point downward, toward the tip
      arrowGroup.add(head);
      arrowGroup.visible = false; // shown once load > 0 via step()

      STATE = {
        THREE: THREE, group: group, root: root, model: model,
        r: r, solved: solved,
        beamMesh: beamMesh, tipGroup: tipGroup, arrowGroup: arrowGroup,
        arrowMat: arrowMat, L_m: L_m, h_m: h_m
      };
    } catch (e) {
      console.warn('[CANTILEVER] build() failed:', e);
    }
  }

  // Animate the loaded bending during a run: t 0..1 ramps thrust 0->100%.
  function step(t) {
    var tt = clamp(num(t, 0), 0, 1);

    if (!STATE || !STATE.solved) {
      return { load_pct: tt * 100, stress_mpa: 0, sf: 99, deflection_mm: 0 };
    }

    var s = STATE.solved, r = STATE.r;
    var F = s.force_N * tt;
    var M = bendingMoment_Nm(F, s.armLen_mm);
    var stress_mpa = bendingStress_MPa(M, r.h_mm, s.inertia_m4);
    var sf = safetyFactor(s.yield_mpa, stress_mpa);
    var deflection_mm = deflectionAtX_m(F, s.armLen_mm, s.armLen_mm, r.youngs_gpa, s.inertia_m4) * 1000;

    try {
      var THREE = STATE.THREE;
      var beamMesh = STATE.beamMesh;
      if (beamMesh) {
        var posAttr = beamMesh.geometry.attributes.position;
        var origPos = beamMesh.geometry.userData.originalPositions;
        var colorAttr = beamMesh.geometry.attributes.color;
        var L_m = beamMesh.geometry.userData.length_m;
        var baseHex = beamMesh.geometry.userData.baseColorHex;
        var baseColor = new THREE.Color(baseHex);

        for (var i = 0; i < posAttr.count; i++) {
          var ox = origPos.getX(i);
          var globalX_mm = (ox + L_m / 2) * 1000;
          var dy_m = -deflectionAtX_m(F, globalX_mm, s.armLen_mm, r.youngs_gpa, s.inertia_m4);
          posAttr.setY(i, origPos.getY(i) + dy_m * DEFLECT_EXAGGERATION);

          var M_atX = bendingMomentAtX_Nm(F, globalX_mm, s.armLen_mm);
          var stress_atX = bendingStress_MPa(M_atX, r.h_mm, s.inertia_m4);
          var ratio = tt <= 0.001 ? 0 : (stress_atX / s.yield_mpa);
          var col = tt <= 0.001 ? baseColor : stressColor(THREE, ratio);
          colorAttr.setXYZ(i, col.r, col.g, col.b);
        }
        posAttr.needsUpdate = true;
        colorAttr.needsUpdate = true;
      }

      if (STATE.tipGroup) {
        var maxDef_m = -deflectionAtX_m(F, s.armLen_mm, s.armLen_mm, r.youngs_gpa, s.inertia_m4);
        STATE.tipGroup.position.y = maxDef_m * DEFLECT_EXAGGERATION;
        var L = s.armLen_mm / 1000;
        var E = r.youngs_gpa * 1e9;
        var slope = (E * s.inertia_m4 > 0) ? -(F * L * L) / (2 * E * s.inertia_m4) : 0;
        STATE.tipGroup.rotation.z = slope * DEFLECT_EXAGGERATION;
      }

      if (STATE.arrowGroup) {
        STATE.arrowGroup.visible = tt > 0.001;
        var scaleY = 0.3 + tt * 1.0;
        STATE.arrowGroup.scale.y = scaleY;
        if (STATE.arrowMat) {
          var arrowCol = stressColor(STATE.THREE, tt <= 0.001 ? 0 : (stress_mpa / s.yield_mpa));
          STATE.arrowMat.color.copy(arrowCol);
        }
      }
    } catch (e) {
      console.warn('[CANTILEVER] step() render update failed:', e);
    }

    return { load_pct: tt * 100, stress_mpa: stress_mpa, sf: sf, deflection_mm: deflection_mm };
  }

  // ===========================================================================
  // 3. CHARTS — pure canvas-2D (no Chart.js)
  // ===========================================================================

  function setupCanvas(canvas, bg) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Clamp + measure the parent box: a flex canvas whose backing store drives
    // its own layout width otherwise runs away over repeated redraws.
    var host = canvas.parentElement || canvas;
    var cw = canvas.clientWidth || host.clientWidth || 400;
    var ch = canvas.clientHeight || host.clientHeight || 220;
    cw = Math.max(40, Math.min(cw, 2000));
    ch = Math.max(40, Math.min(ch, 2000));
    var bw = Math.round(cw * dpr), bh = Math.round(ch * dpr);
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    var ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.fillStyle = bg || FIELD_BG;
    ctx.fillRect(0, 0, cw, ch);
    return { ctx: ctx, w: cw, h: ch };
  }

  function drawGrid(ctx, w, h, spacing) {
    ctx.save();
    ctx.strokeStyle = GRID_LINE;
    ctx.lineWidth = 1;
    for (var x = 0; x <= w; x += spacing) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); ctx.stroke(); }
    for (var y = 0; y <= h; y += spacing) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); ctx.stroke(); }
    ctx.restore();
  }

  function chartTitle(ctx, w, text, subtext) {
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = PAPER;
    ctx.font = '600 12px "IBM Plex Sans", sans-serif';
    ctx.fillText(text, 10, 8);
    if (subtext) {
      ctx.fillStyle = MUTED;
      ctx.font = '400 10px "IBM Plex Mono", monospace';
      ctx.fillText(subtext, 10, 24);
    }
    ctx.restore();
  }

  function verdictColor(verdict) {
    if (verdict === 'PASS') return SUCCESS;
    if (verdict === 'MARGINAL') return RUST;
    return DANGER;
  }

  // Shear Force Diagram: constant magnitude along the arm (single tip load),
  // drawn as a stepped line from root to tip.
  function drawSFD(canvas, solved) {
    var setup = setupCanvas(canvas);
    var ctx = setup.ctx, w = setup.w, h = setup.h;
    drawGrid(ctx, w, h, 24);
    chartTitle(ctx, w, 'Shear Force Diagram', 'V(x) = -F (constant)');

    var padL = 34, padR = 14, padT = 40, padB = 26;
    var plotW = Math.max(10, w - padL - padR);
    var plotH = Math.max(10, h - padT - padB);
    var x_mm = solved.sfd.x_mm, V_N = solved.sfd.V_N;
    var Vmax = Math.max(1, Math.abs(V_N[0] || 0)) * 1.25;
    var L = x_mm[x_mm.length - 1] || 1;

    function px(x) { return padL + (x / L) * plotW; }
    function py(v) { return padT + plotH / 2 - (v / Vmax) * (plotH / 2); }

    // zero line
    ctx.save();
    ctx.strokeStyle = 'rgba(244,246,245,0.25)';
    ctx.beginPath(); ctx.moveTo(padL, py(0)); ctx.lineTo(padL + plotW, py(0)); ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = STEEL;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (var i = 0; i < x_mm.length; i++) {
      var xp = px(x_mm[i]), yp = py(V_N[i]);
      if (i === 0) ctx.moveTo(xp, yp); else ctx.lineTo(xp, yp);
    }
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = MUTED;
    ctx.font = '400 9px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('root', padL, padT + plotH + 6);
    ctx.textAlign = 'right';
    ctx.fillText('tip (' + (L / 1000).toFixed(2) + ' m)', padL + plotW, padT + plotH + 6);
    ctx.textAlign = 'right';
    ctx.fillText((V_N[0] || 0).toFixed(1) + ' N', padL - 4, py(V_N[0] || 0) + 3);
    ctx.restore();
  }

  // Bending Moment Diagram: linear, max at root, zero at tip.
  function drawBMD(canvas, solved) {
    var setup = setupCanvas(canvas);
    var ctx = setup.ctx, w = setup.w, h = setup.h;
    drawGrid(ctx, w, h, 24);
    chartTitle(ctx, w, 'Bending Moment Diagram', 'M(x) = F·(L−x)');

    var padL = 40, padR = 14, padT = 40, padB = 26;
    var plotW = Math.max(10, w - padL - padR);
    var plotH = Math.max(10, h - padT - padB);
    var x_mm = solved.bmd.x_mm, M_Nm = solved.bmd.M_Nm;
    var L = x_mm[x_mm.length - 1] || 1;
    var Mmax = Math.max(0.001, M_Nm[0] || 0) * 1.15;

    function px(x) { return padL + (x / L) * plotW; }
    function py(m) { return padT + plotH - (m / Mmax) * plotH; }

    // filled area under curve
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(px(0), py(0));
    for (var i = 0; i < x_mm.length; i++) ctx.lineTo(px(x_mm[i]), py(M_Nm[i]));
    ctx.lineTo(px(L), py(0));
    ctx.closePath();
    ctx.fillStyle = 'rgba(31, 58, 147, 0.35)';
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = NAVY;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (var j = 0; j < x_mm.length; j++) {
      var xp = px(x_mm[j]), yp = py(M_Nm[j]);
      if (j === 0) ctx.moveTo(xp, yp); else ctx.lineTo(xp, yp);
    }
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = MUTED;
    ctx.font = '400 9px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('root (M_max = ' + (M_Nm[0] || 0).toFixed(3) + ' N·m)', padL, padT + plotH + 6);
    ctx.textAlign = 'right';
    ctx.fillText('tip (M=0)', padL + plotW, padT + plotH + 6);
    ctx.restore();
  }

  // Applied bending stress bar vs material yield line, coloured by verdict.
  function drawStressBar(canvas, solved) {
    var setup = setupCanvas(canvas);
    var ctx = setup.ctx, w = setup.w, h = setup.h;
    drawGrid(ctx, w, h, 24);
    chartTitle(ctx, w, 'Root Stress vs. Yield', (solved.material && solved.material.label) || '');

    var padL = 44, padR = 14, padT = 40, padB = 30;
    var plotW = Math.max(10, w - padL - padR);
    var plotH = Math.max(10, h - padT - padB);
    var yieldMpa = solved.yield_mpa || 1;
    var stressMpa = solved.stress_mpa || 0;
    var axisMax = Math.max(yieldMpa, stressMpa) * 1.2 || 1;

    function py(v) { return padT + plotH - (v / axisMax) * plotH; }

    // axis line
    ctx.save();
    ctx.strokeStyle = 'rgba(244,246,245,0.25)';
    ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, padT + plotH); ctx.lineTo(padL + plotW, padT + plotH); ctx.stroke();
    ctx.restore();

    var barW = Math.min(64, plotW * 0.28);
    var stressX = padL + plotW * 0.32 - barW / 2;
    var yieldX = padL + plotW * 0.68 - barW / 2;
    var color = verdictColor(solved.verdict);

    // yield strength bar (reference, dimmer)
    var yieldTop = py(yieldMpa);
    ctx.save();
    ctx.fillStyle = 'rgba(79, 109, 158, 0.35)';
    ctx.strokeStyle = STEEL;
    ctx.lineWidth = 1.5;
    ctx.fillRect(yieldX, yieldTop, barW, (padT + plotH) - yieldTop);
    ctx.strokeRect(yieldX, yieldTop, barW, (padT + plotH) - yieldTop);
    ctx.restore();

    // applied stress bar (coloured by verdict)
    var stressTop = py(stressMpa);
    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(stressX, stressTop, barW, (padT + plotH) - stressTop);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(stressX, stressTop, barW, (padT + plotH) - stressTop);
    ctx.restore();

    // dashed yield threshold line across full width
    ctx.save();
    ctx.strokeStyle = STEEL;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, yieldTop); ctx.lineTo(padL + plotW, yieldTop); ctx.stroke();
    ctx.restore();

    // labels
    ctx.save();
    ctx.font = '600 10px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = PAPER;
    ctx.fillText(stressMpa.toFixed(1) + ' MPa', stressX + barW / 2, stressTop - 6);
    ctx.fillText(yieldMpa.toFixed(0) + ' MPa', yieldX + barW / 2, yieldTop - 6);
    ctx.font = '400 10px "IBM Plex Sans", sans-serif';
    ctx.fillStyle = MUTED;
    ctx.fillText('Applied σ', stressX + barW / 2, padT + plotH + 14);
    ctx.fillText('Yield σ', yieldX + barW / 2, padT + plotH + 14);
    ctx.restore();

    // verdict + SF chip
    ctx.save();
    ctx.font = '700 11px "IBM Plex Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = color;
    var sfText = solved.safetyFactor >= 90 ? '∞' : solved.safetyFactor.toFixed(2);
    ctx.fillText(solved.verdict + '  (SF ' + sfText + ')', w - 10, 12);
    ctx.restore();
  }

  function placeholder(canvas, label) {
    if (!canvas) return;
    var setup = setupCanvas(canvas);
    drawGrid(setup.ctx, setup.w, setup.h, 24);
    setup.ctx.save();
    setup.ctx.fillStyle = MUTED;
    setup.ctx.font = '600 12px "IBM Plex Mono", monospace';
    setup.ctx.textAlign = 'center';
    setup.ctx.textBaseline = 'middle';
    setup.ctx.fillText(label || 'NO DATA', setup.w / 2, setup.h / 2);
    setup.ctx.restore();
  }

  // Draw the three M2 charts into the given canvases (2D). main.js supplies them.
  function drawCharts(opts) {
    opts = opts || {};
    var sfdCanvas = opts.sfdCanvas, bmdCanvas = opts.bmdCanvas, stressBarCanvas = opts.stressBarCanvas, model = opts.model;
    var solved;
    try {
      solved = solve(model);
    } catch (e) {
      console.warn('[CANTILEVER] drawCharts() solve failed:', e);
      solved = safeFallbackSolve();
    }
    try { if (sfdCanvas) drawSFD(sfdCanvas, solved); } catch (e) { console.warn('[CANTILEVER] drawSFD failed:', e); if (sfdCanvas) placeholder(sfdCanvas, 'SFD ERROR'); }
    try { if (bmdCanvas) drawBMD(bmdCanvas, solved); } catch (e) { console.warn('[CANTILEVER] drawBMD failed:', e); if (bmdCanvas) placeholder(bmdCanvas, 'BMD ERROR'); }
    try { if (stressBarCanvas) drawStressBar(stressBarCanvas, solved); } catch (e) { console.warn('[CANTILEVER] drawStressBar failed:', e); if (stressBarCanvas) placeholder(stressBarCanvas, 'CHART ERROR'); }
  }

  // ===========================================================================
  // 4. PUBLIC API
  // ===========================================================================

  window.CANTILEVER = {
    build: build,
    solve: solve,
    step: step,
    drawCharts: drawCharts
  };
})();

/* ============================ [3] CORE =========================== */
/* ════════════════════════════════════════════════════════════════
   DRONE STRUCTURAL LAB — main.js  (CORE SPINE)
   Fork of the reference Drone Technology Lab main.js, retargeted to two
   structural modules per BUILD_SPEC.md:

   MODULES
     M1 Assembly & CoG Balancing — full drone assembled at authored mounts;
                                    slide movable components to balance CoG.
     M2 Cantilever Arm Stress    — one arm modelled as a cantilever beam
                                    (window.CANTILEVER) carrying the motor
                                    + prop tip load; bending/stress/SF.

   This file owns: catalog loading, state/persistence, the mass budget, the
   GLB assembly engine (ported ~intact from js/main_ref.js), the CoG + per-arm
   load physics, placement sliders, frame-material picker, module switching,
   the run loop and diagnostics, and exposes `window.LAB` (BUILD_SPEC §2) for
   js/blueprint.js + js/cantilever.js to consume.

   Sections
     1  Catalog loader          8  Viewport / scenes + assembly
     2  State + persistence     8b UI rendering
     3  Utilities + mass        9  2D charts
     4  Structural model (LAB)  10 Floating windows
     5  Diagnostics / log       11 Simulation runner
     6  3D models + sizing      12 Procedural audio engine
     7  Preview engine          13 Instructor
                                14 Wiring + boot
   ════════════════════════════════════════════════════════════════ */

/* ════════════ 1 · CATALOG LOADER ════════════ */
let DRONE_DB = null;

function bootProgress(txt, frac){
  const s = document.getElementById("bootSub"), f = document.getElementById("bootFill");
  if(s && txt) s.textContent = txt;
  if(f && frac != null) f.style.width = Math.round(frac*100) + "%";
}

async function loadCatalog(){
  bootProgress("loading component catalog…", .1);
  // no-store: the catalog JSON (manifest/spec/mounts) is tiny and edited often;
  // always fetch fresh so spec changes take effect without a hard reload. The
  // heavy GLB meshes load separately (GLTFLoader) and stay cached.
  const manifest = await (await fetch("assets/manifest.json", {cache:"no-store"})).json();
  // parallel fetch of every spec.json across all categories
  const jobs = [];
  manifest.categories.forEach(c=>{
    const dir = "assets/" + c.key;
    c.options.forEach(id=>{
      jobs.push((async ()=>{
        const base = dir + "/" + id;
        try{
          const spec = await (await fetch(base + "/spec.json", {cache:"no-store"})).json();
          let files = [];
          if(spec.model){
            const arr = Array.isArray(spec.model) ? spec.model : [spec.model];
            files = arr.map(f => f.includes("/") ? f : base + "/" + f);
          }
          // optional authored mount transforms (DARUKA mounts.json) — enables
          // exact, data-driven component placement instead of heuristic seating
          let mounts = null;
          if(spec.mounts){
            try{
              const mp = spec.mounts.includes("/") ? spec.mounts : base + "/" + spec.mounts;
              mounts = await (await fetch(mp, {cache:"no-store"})).json();
            }catch(e){ console.warn("mounts.json missing/invalid for", base); }
          }
          return { c, opt: {
            id, name: spec.name || id, catKey: c.key,
            mass: spec.mass_g || 0, qty: spec.qty || 1,
            size: spec.size_mm || null, view: spec.view || null,
            specs: Object.entries(spec.specs || {}),
            phys: spec.physics || {}, files, mounts,
            fallback: { kind: c.fallback || "none", color: 0x5a6672, s: 1 }
          }};
        }catch(e){ console.warn("spec.json missing/invalid for", base); return { c, opt: null }; }
      })());
    });
  });
  const results = await Promise.all(jobs);
  bootProgress("indexing components…", .6);
  const byCat = {};
  results.forEach(r=>{ if(!r.opt) return; (byCat[r.c.key] = byCat[r.c.key] || []).push(r.opt); });
  const categories = manifest.categories.map(c=>{
    // preserve manifest option order
    const order = c.options;
    const opts = (byCat[c.key] || []).sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id));
    return { key:c.key, label:c.label, multi:!!c.multi, options:opts };
  });
  DRONE_DB = {
    categories,
    defaults: manifest.defaults || {},
    modules: manifest.modules,
    instructor: manifest.instructor,
    placement: manifest.placement || { movable: [], fixed: [], ranges: {} },
    reward: {
      name: manifest.reward.name, desc: manifest.reward.desc,
      files: manifest.reward.model ? [manifest.reward.model] : [],
      fallback: { kind: manifest.reward.fallback || "lidar", color: 0x845b23, s: 1 }
    }
  };
}

/* ════════════ 2 · STATE + PERSISTENCE ════════════ */
const LS_KEY = "dsl-v1";
const state = {
  sel:{}, module:"m1", exp:{},
  place:{},              // { key: {x_mm,y_mm} } — placement slider offsets (BUILD_SPEC §2/§D)
  material:"carbon_t700", // selected frame material id (BUILD_SPEC §5)
  done:{}, history:[], voiceVol:80, sfxVol:60, instrStep:0,
  simRunning:false, instrOpen:true
};
function loadState(){
  let s = {};
  try{ s = JSON.parse(localStorage.getItem(LS_KEY)) || {}; }catch(e){}
  state.sel = Object.assign({}, DRONE_DB.defaults, s.sel || {});
  DRONE_DB.categories.forEach(c=>{
    if(c.multi){
      const v = state.sel[c.key];
      state.sel[c.key] = (Array.isArray(v)?v:(v?[v]:[])).filter(id=>c.options.some(o=>o.id===id));
    }else if(!c.options.some(o=>o.id===state.sel[c.key])){
      state.sel[c.key] = c.options[0] && c.options[0].id;
    }
  });
  state.module = DRONE_DB.modules.some(m=>m.id===s.module) ? s.module : DRONE_DB.modules[0].id;
  DRONE_DB.modules.forEach(m=>{
    const saved = s.exp && s.exp[m.id];
    state.exp[m.id] = m.experiments.some(e=>e.id===saved) ? saved : m.experiments[0].id;
  });
  state.place = (s.place && typeof s.place === "object") ? s.place : {};
  state.material = MATERIALS.some(m=>m.id===s.material) ? s.material : MATERIALS[0].id;
  state.done = s.done || {};
  state.history = Array.isArray(s.history) ? s.history : [];
  state.voiceVol = s.voiceVol != null ? s.voiceVol : 80;
  state.sfxVol = s.sfxVol != null ? s.sfxVol : 60;
  state.instrStep = Math.min(s.instrStep || 0, DRONE_DB.instructor.length - 1);
  state.instrOpen = s.instrOpen !== false;
}
function saveState(){
  try{
    localStorage.setItem(LS_KEY, JSON.stringify({
      sel:state.sel, module:state.module, exp:state.exp,
      place:state.place, material:state.material,
      done:state.done, history:state.history.slice(-24),
      voiceVol:state.voiceVol, sfxVol:state.sfxVol,
      instrStep:state.instrStep, instrOpen:state.instrOpen
    }));
  }catch(e){}
}

/* ════════════ 3 · UTILITIES + MASS BUDGET ════════════ */
const $ = id => document.getElementById(id);
function el(tag, cls, html){
  const n = document.createElement(tag);
  if(cls) n.className = cls;
  if(html != null) n.innerHTML = html;
  return n;
}
function txt(s){ return String(s).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
const cat = key => DRONE_DB.categories.find(c=>c.key===key);
const selArr = key => { const v = state.sel[key]; return Array.isArray(v)?v:(v?[v]:[]); };
const selOpts = key => { const c = cat(key); return c ? c.options.filter(o=>selArr(key).includes(o.id)) : []; };
const opt = key => {
  const c = cat(key); if(!c) return null;
  if(c.multi) return selOpts(key)[0] || null;
  return c.options.find(o=>o.id===state.sel[key]) || c.options[0];
};
function fmtMass(g){ return g >= 1000 ? (g/1000).toFixed(2)+" kg" : (g<10 && g>0 ? g.toFixed(1) : Math.round(g))+" g"; }
function massRows(){
  const rows = DRONE_DB.categories.map(c=>{
    if(c.multi){
      const opts = selOpts(c.key);
      return { key:c.key, label:c.label,
        name: opts.length ? opts.map(o=>o.name).join(" + ") : "None",
        qty: opts.length, mass: opts.reduce((a,o)=>a+o.mass*o.qty,0) };
    }
    const o = opt(c.key);
    return { key:c.key, label:c.label, name:o?o.name:"—", qty:o?o.qty:0, mass:o?o.mass*o.qty:0 };
  });
  const total = rows.reduce((a,r)=>a+r.mass,0) || 1;
  rows.forEach(r=>r.frac = r.mass/total);
  return { rows, total };
}
function configCode(){
  const s = JSON.stringify(state.sel);
  let h = 0; for(let i=0;i<s.length;i++) h = (h*31 + s.charCodeAt(i)) >>> 0;
  return "CFG-" + (h % 10000).toString().padStart(4,"0");
}
const allExperiments = () => DRONE_DB.modules.flatMap(m=>m.experiments.map(e=>({mod:m, exp:e, key:m.id+":"+e.id})));
const allDone = () => allExperiments().every(x=>state.done[x.key]);
const doneCount = () => allExperiments().filter(x=>state.done[x.key]).length;
function currentExp(){
  const m = DRONE_DB.modules.find(m=>m.id===state.module);
  return { mod:m, exp:m.experiments.find(e=>e.id===state.exp[m.id]) || m.experiments[0] };
}

/* ════════════ 4 · STRUCTURAL MODEL — window.LAB (BUILD_SPEC §2/§3/§5) ════════════
   Everything cantilever.js / blueprint.js consume comes from getModel() below —
   they never read the DOM or the three.js scene. Positions are derived from the
   chassis's authored mounts.json, rotated by the SAME up-axis quaternion the GLB
   assembly (buildDroneFromMounts, §6) uses, so the viewport/blueprint/heatmap/CoG
   always agree (BUILD_SPEC §1 coordinate conventions). */
const G = 9.80665;                 // standard gravity, m/s² — canonical across the lab
const TOLERANCE_MM = 10;           // CoG pass threshold (BUILD_SPEC §3)

/* A 4-in-1 ESC is a single board that stacks under the flight controller and
   drives all four motors — versus four single ESCs on the arms. It is detected
   by an explicit flag, a single-unit qty (qty 1 = one board), or its name. */
function escIs4in1(o){
  if(!o) return false;
  if(o.phys && o.phys.form_factor === "4in1") return true;
  if((o.qty || 4) <= 1) return true;
  return /4.?in.?1/i.test((o.id || "") + " " + (o.name || ""));
}

/* ── Frame materials (BUILD_SPEC §5) — ids match cantilever.js's materialColorHex ── */
const MATERIALS = [
  { id:"carbon_t700",    label:"Carbon Fibre T700", yield_mpa:600, youngs_gpa:70, density_kg_m3:1600 },
  { id:"aluminium_6061", label:"Aluminium 6061-T6",  yield_mpa:270, youngs_gpa:69, density_kg_m3:2700 },
  { id:"nylon_pa66",     label:"Nylon PA66",         yield_mpa:50,  youngs_gpa:3,  density_kg_m3:1140 }
];
const materialById = id => MATERIALS.find(m=>m.id===id) || MATERIALS[0];

/* Hollow-rect arm cross-section synthesised from wheelbase (BUILD_SPEC §5) —
   reference chassis spec.json has no cross-section, so we derive one that scales
   sensibly with frame size. */
function synthArmProfile(wheelbase_mm){
  const w = wheelbase_mm || 250;
  if(w <= 160) return { b_mm:8,  h_mm:5,  t_mm:1 };
  if(w <= 260) return { b_mm:10, h_mm:6,  t_mm:1 };
  if(w <= 330) return { b_mm:12, h_mm:7,  t_mm:1.2 };
  if(w <= 460) return { b_mm:15, h_mm:8,  t_mm:1.5 };
  return { b_mm:18, h_mm:12, t_mm:2 };
}

/* ── up-axis derivation + rotation — SAME logic buildDroneFromMounts (§6) uses,
   hoisted to module scope so getModel() can independently map mounts.json → mm
   without touching the three.js scene. up-axis: spec.physics.native_up →
   dominant motor-mount normal axis → "z" default (every current chassis ships
   Z-up authored mounts). */
function deriveUpAxis(ch){
  if(!ch) return "z";
  if(ch.phys && ch.phys.native_up) return ch.phys.native_up;
  const mounts = (ch.mounts && ch.mounts.mounts) || [];
  const mo = mounts.filter(m => m.type === "motor" && Array.isArray(m.normal));
  if(mo.length){
    const s = [0,0,0]; mo.forEach(m => { for(let i=0;i<3;i++) s[i] += Math.abs(m.normal[i]||0); });
    const ax = s.indexOf(Math.max.apply(null, s));
    return ax === 1 ? "y" : ax === 2 ? "z" : "x";
  }
  return "z";
}
function upQuat(up){
  const q = new THREE.Quaternion();
  if(up === "z") q.setFromEuler(new THREE.Euler(-Math.PI/2, 0, 0));    // Z-up → Y-up
  else if(up === "x") q.setFromEuler(new THREE.Euler(0, 0, Math.PI/2)); // X-up → Y-up
  return q;                                                             // y → identity
}
const mountPosRaw = m => (m && (m.position || m.center)) || [0,0,0];
/* raw authored mount (metres, native frame) → top-view mm (BUILD_SPEC §1/§2C) */
function mountTopMm(m, q){
  const raw = mountPosRaw(m);
  const v = new THREE.Vector3(raw[0], raw[1], raw[2]).applyQuaternion(q);
  return { x_mm: v.x*1000, y_mm: -v.z*1000 };
}
/* category key → authored mount `type` string (mounts.json), mirrors MOUNT_CATEGORY (§6) */
const CATEGORY_MOUNT_TYPE = { battery:"battery", controller:"flight_controller", reciever:"receiver" };

/* Assign the 4 motor top-view points to arm indices 0=FR(+x,+y) 1=FL(-x,+y)
   2=RL(-x,-y) 3=RR(+x,-y) per BUILD_SPEC §1, tolerant of authoring order. */
function classifyArmIndex(x, y){
  if(x >= 0 && y >= 0) return 0;
  if(x <  0 && y >= 0) return 1;
  if(x <  0 && y <  0) return 2;
  return 3;
}
function buildArms(motorPts, armLenMm){
  const arms = new Array(4).fill(null);
  if(motorPts && motorPts.length){
    const used = new Set();
    motorPts.forEach(p=>{
      let idx = classifyArmIndex(p.x_mm, p.y_mm);
      while(used.has(idx)) idx = (idx+1)%4;      // resolve rare quadrant collisions
      used.add(idx);
      arms[idx] = { x_mm:p.x_mm, y_mm:p.y_mm };
    });
  }
  return [0,1,2,3].map(i=>{
    const p = arms[i] || (()=>{ const a = Math.PI/4 + i*Math.PI/2;
      return { x_mm: Math.cos(a)*armLenMm, y_mm: Math.sin(a)*armLenMm }; })();
    const angleRad = Math.atan2(p.y_mm, p.x_mm);
    return { index:i, angleRad, dirXZ:[Math.cos(angleRad), Math.sin(angleRad)],
             tip_mm:[p.x_mm, p.y_mm], loadShare:0.25, loadForce_N:0 };
  });
}

/* Per-arm load share — rigid-plate bilinear reaction (BUILD_SPEC §3): a mount
   closer to the CoG carries more, shares sum to 1. Standard 4-corner reaction
   formula for a symmetric support rectangle at (±a,±b): the drone's X-config
   arms sit at exactly such a symmetric layout. */
function applyArmLoads(arms, cogXmm, cogYmm, auwKg){
  const a = Math.max(1e-6, arms.reduce((s,ar)=>s+Math.abs(ar.tip_mm[0]),0)/arms.length);
  const b = Math.max(1e-6, arms.reduce((s,ar)=>s+Math.abs(ar.tip_mm[1]),0)/arms.length);
  let shares = arms.map(ar=>{
    const x = ar.tip_mm[0], y = ar.tip_mm[1];
    return Math.max(0, 0.25*(1 + (x*cogXmm)/(a*a) + (y*cogYmm)/(b*b)));
  });
  const sum = shares.reduce((s,v)=>s+v,0) || 1;
  shares = shares.map(v=>v/sum);
  arms.forEach((ar,i)=>{ ar.loadShare = shares[i]; ar.loadForce_N = shares[i]*auwKg*G; });
}

/* Slim per-motor static-thrust estimate — used only as the cantilever tip load
   (BUILD_SPEC §2 tipForce_N). Not a full propulsion solver: static Ct·ρ·n²·D⁴ at
   a derated (loaded) RPM from Kv × nominal pack voltage. */
function estimateTipForce_N(mo, pr, ba){
  const mp = (mo && mo.phys) || {}, pp = (pr && pr.phys) || {}, bp = (ba && ba.phys) || {};
  const kv = mp.kv || 900;
  const V = (bp.cells || 4) * 3.7;                 // nominal pack voltage
  const diaIn = pp.diameter_in || 5;
  const D = diaIn * 0.0254;
  const pitchIn = pp.pitch_in || diaIn*0.5;
  const pd = Math.max(0.2, Math.min(1.2, pitchIn/Math.max(diaIn,1)));
  const ct = pp.ct != null ? pp.ct : 0.115*pd;
  const n = (kv * V * 0.78) / 60;                  // derated loaded rev/s
  const rho = 1.225;
  return Math.max(ct * rho * n*n * Math.pow(D,4), 0.05);
}

function clamp01mm(v, range){ return range ? Math.max(range[0], Math.min(range[1], v)) : v; }
function placementRanges(key){ return (DRONE_DB.placement && DRONE_DB.placement.ranges && DRONE_DB.placement.ranges[key]) || null; }
function placementOffset(key){
  const ranges = placementRanges(key.indexOf(":")>=0 ? key.slice(0,key.indexOf(":")) : key);
  const p = (state.place && state.place[key]) || { x:0, y:0 };
  return { x: clamp01mm(p.x||0, ranges && ranges.x), y: clamp01mm(p.y||0, ranges && ranges.y) };
}
/* Shift a movable component's 3D anchor by its stored placement offset
   (BUILD_SPEC item D): x_mm → local +X, y_mm (nose/forward) → local −Z. Anchor
   must already sit at its authored (un-offset) mount position. */
function applyPlacementOffsetToAnchor(anchor, key){
  const off = placementOffset(key);
  anchor.position.x += (off.x||0)/1000;
  anchor.position.z += -(off.y||0)/1000;
}
/* Live-move an already-built anchor from its stored base position (called by
   the placement sliders' `input` handler — BUILD_SPEC item D — so dragging a
   slider shifts the real 3D component without a full assembly rebuild). */
function reapplyPlacementOffset(key){
  const anchor = movableAnchors[key];
  if(!anchor || !anchor.userData.basePos) return;
  const base = anchor.userData.basePos, off = placementOffset(key);
  anchor.position.set(base.x + (off.x||0)/1000, base.y, base.z - (off.y||0)/1000);
}

/* Build the full BUILD_SPEC §2 Model from current selections + slider offsets.
   Defensive throughout: missing mounts/GLBs fall back to (0,0), never throws. */
function computeModel(){
  const ch = opt("chasis");
  const mo = opt("motor"), pr = opt("propeller"), esc = opt("esc");
  const ba = opt("battery"), fc = opt("controller"), rx = opt("reciever");
  const attOpts = selOpts("attachments");
  const mounts = (ch && ch.mounts && ch.mounts.mounts) || [];
  const q = upQuat(deriveUpAxis(ch));
  const wheelbase_mm = (ch && ch.phys && ch.phys.wheelbase_mm) || 220;
  const armLenMm = (ch && ch.phys && ch.phys.arm_length_mm) || wheelbase_mm/2;

  const motorMounts = mounts.filter(m=>m.type==="motor").map(m=>mountTopMm(m,q));
  const arms = buildArms(motorMounts, armLenMm);

  const parts = [];
  parts.push({ key:"chasis", id:ch?ch.id:"", name:ch?ch.name:"—", mass_g:ch?ch.mass:0, qty:1,
    size_mm: ch?ch.size:null, x_mm:0, y_mm:0, movable:false });

  arms.forEach(arm=>{
    if(mo) parts.push({ key:"motor", id:mo.id, name:mo.name, mass_g:mo.mass, qty:1,
      size_mm:mo.size, x_mm:arm.tip_mm[0], y_mm:arm.tip_mm[1], movable:false });
    if(pr) parts.push({ key:"propeller", id:pr.id, name:pr.name, mass_g:pr.mass, qty:1,
      size_mm:pr.size, x_mm:arm.tip_mm[0], y_mm:arm.tip_mm[1], movable:false });
  });
  if(esc){
    if(escIs4in1(esc)){
      parts.push({ key:"esc", id:esc.id, name:esc.name, mass_g:esc.mass, qty:1,
        size_mm:esc.size, x_mm:0, y_mm:0, movable:false });
    }else{
      arms.forEach(arm=>parts.push({ key:"esc", id:esc.id, name:esc.name, mass_g:esc.mass, qty:1,
        size_mm:esc.size, x_mm:arm.tip_mm[0]*0.55, y_mm:arm.tip_mm[1]*0.55, movable:false }));
    }
  }
  [ { catKey:"battery", o:ba }, { catKey:"controller", o:fc }, { catKey:"reciever", o:rx } ].forEach(cfg=>{
    if(!cfg.o) return;
    const mtype = CATEGORY_MOUNT_TYPE[cfg.catKey];
    const m = mounts.find(mm=>mm.type===mtype);
    const base = m ? mountTopMm(m,q) : { x_mm:0, y_mm:0 };
    const off = placementOffset(cfg.catKey);
    parts.push({ key:cfg.catKey, id:cfg.o.id, name:cfg.o.name, mass_g:cfg.o.mass, qty:cfg.o.qty||1,
      size_mm:cfg.o.size, x_mm: base.x_mm+off.x, y_mm: base.y_mm+off.y, movable:true });
  });
  const usedMounts = new Set();
  attOpts.forEach(o=>{
    const mtype = (o.phys && o.phys.mount_type) || "payload";
    let m = mounts.find(mm=>mm.type===mtype && !usedMounts.has(mm));
    if(!m) m = mounts.find(mm=>mm.type==="payload" && !usedMounts.has(mm));
    if(m) usedMounts.add(m);
    const base = m ? mountTopMm(m,q) : { x_mm:0, y_mm:0 };
    const off = placementOffset("attachments:"+o.id);
    parts.push({ key:"attachments", id:o.id, name:o.name, mass_g:o.mass, qty:o.qty||1,
      size_mm:o.size, x_mm: base.x_mm+off.x, y_mm: base.y_mm+off.y, movable:true });
  });

  let totalMass_g = 0, sx = 0, sy = 0;
  parts.forEach(p=>{ const m = (p.mass_g||0)*(p.qty||1); totalMass_g += m; sx += m*(p.x_mm||0); sy += m*(p.y_mm||0); });
  const cogX = totalMass_g>0 ? sx/totalMass_g : 0, cogY = totalMass_g>0 ? sy/totalMass_g : 0;
  const cog = { x_mm:cogX, y_mm:cogY, r_mm:Math.hypot(cogX,cogY) };
  applyArmLoads(arms, cogX, cogY, totalMass_g/1000);

  const material = materialById(state.material);
  const frame = {
    id: ch?ch.id:"", name: ch?ch.name:"—",
    wheelbase_mm, arm_length_mm: armLenMm,
    armProfile: synthArmProfile(wheelbase_mm),
    material,
    size_mm: ch?ch.size:null
  };

  return {
    frame, arms, parts,
    motor: mo ? Object.assign({ id:mo.id, name:mo.name, mass_g:mo.mass }, mo.phys||{}) : null,
    prop:  pr ? Object.assign({ id:pr.id, name:pr.name, mass_g:pr.mass }, pr.phys||{}) : null,
    cog, totalMass_g,
    tipForce_N: estimateTipForce_N(mo, pr, ba),
    tolerance_mm: TOLERANCE_MM,
    balanced: cog.r_mm <= TOLERANCE_MM
  };
}

/* ── window.LAB — the shared model surface (BUILD_SPEC §2) ── */
let _labModel = null, _labListeners = [];
function invalidateModel(){
  _labModel = null;
  const m = getModel();
  _labListeners.forEach(cb=>{ try{ cb(m); }catch(e){ console.warn("[LAB] onModelChange listener failed:", e); } });
}
function getModel(){
  if(!_labModel){ try{ _labModel = computeModel(); }catch(e){ console.warn("[LAB] computeModel failed:", e); _labModel = null; } }
  return _labModel;
}
window.LAB = {
  THREE,
  getModel,
  onModelChange(cb){ if(typeof cb === "function") _labListeners.push(cb); },
  fmt: {
    mass: fmtMass,
    mm: v => (v==null || !isFinite(v)) ? "—" : v.toFixed(1)+" mm"
  }
};

/* ════════════ 5 · DIAGNOSTICS / LOG ════════════ */
function propGeometry(){
  const ch = opt("chasis"), pr = opt("propeller");
  const wb = (ch && ch.phys && ch.phys.wheelbase_mm) || 220;
  const diaMm = ((pr && pr.phys && pr.phys.diameter_in) || 5) * 25.4;
  const adjacent = wb/2 * Math.SQRT2;   // spacing between adjacent motor centres (X-config)
  const clearance = adjacent - diaMm;   // >0 gap, <0 overlap
  return { wbMm: wb, propDiaMm: diaMm, adjacentMm: adjacent, clearanceMm: clearance, collide: clearance < 0 };
}
/* returns { items:[{sev,msg,fix,block}], errors, warns, blocked } */
/* returns { items:[{sev,msg,fix,block}], errors, warns, blocked } -- structural
   diagnostics (BUILD_SPEC item I): CoG offset, per-arm imbalance, arm safety
   factor (blocks the run when SF < 1), prop-vs-frame sanity, over-mass. */
function diagnostics(){
  const items = [];
  const model = getModel();
  const geom = propGeometry();

  // 1 . propeller-vs-frame collision (blocking)
  if(geom.collide){
    items.push({ sev:"err", block:true, tag:"prop-collision",
      msg:"Propellers collide -- "+geom.propDiaMm.toFixed(0)+" mm props overlap on a "+geom.wbMm+" mm wheelbase (arm spacing "+geom.adjacentMm.toFixed(0)+" mm).",
      fix:"Fit a smaller propeller or a larger chassis before running." });
  } else if(geom.clearanceMm < 12){
    items.push({ sev:"warn",
      msg:"Very tight prop clearance -- only "+geom.clearanceMm.toFixed(0)+" mm between disc tips.",
      fix:"A smaller propeller improves the safety margin." });
  }
  // 2 . recommended prop size for the frame
  const ch = opt("chasis"), pr = opt("propeller");
  if(ch && ch.phys && ch.phys.recommended_prop_in && pr && pr.phys){
    const rec = ch.phys.recommended_prop_in, dia = pr.phys.diameter_in;
    const lo = Math.min.apply(null, rec), hi = Math.max.apply(null, rec);
    if(dia < lo - 0.5 || dia > hi + 0.5){
      items.push({ sev:"warn",
        msg:"Propeller ("+dia+'in) is outside the frame\'s recommended '+lo+"-"+hi+'in range.',
        fix:"Match the prop to the chassis for correct clearance and efficiency." });
    }
  }
  // 3 . CoG offset vs tolerance (BUILD_SPEC section 3)
  const r = model.cog.r_mm;
  if(r > model.tolerance_mm){
    items.push({ sev: r > model.tolerance_mm*2.5 ? "err" : "warn", tag:"cog-offset",
      msg:"CoG offset "+r.toFixed(1)+" mm exceeds the "+model.tolerance_mm+" mm tolerance.",
      fix:"Slide the battery / payload in the Placement panel to recentre the CoG." });
  }
  // 4 . per-arm load imbalance -- a healthy quad keeps every arm near 25% of AUW
  const maxArm = model.arms.reduce((a,b)=> (b.loadShare>a.loadShare?b:a), model.arms[0] || {loadShare:0.25,index:0});
  const imbalancePct = maxArm ? (maxArm.loadShare-0.25)/0.25*100 : 0;
  if(imbalancePct > 20){
    const armLabels = ["FR","FL","RL","RR"];
    items.push({ sev: imbalancePct > 50 ? "err" : "warn", tag:"arm-imbalance",
      msg:"Arm load imbalance -- "+armLabels[maxArm.index||0]+" carries "+(maxArm.loadShare*100).toFixed(1)+"% of AUW ("+imbalancePct.toFixed(0)+"% over the 25% nominal share).",
      fix:"Rebalance the CoG so no single arm bears a disproportionate load." });
  }
  // 5 . arm structural safety factor (Module 2 physics) -- SF < 1 blocks the run
  if(window.CANTILEVER && typeof window.CANTILEVER.solve === "function"){
    try{
      const solved = window.CANTILEVER.solve(model);
      if(solved.safetyFactor < 1){
        items.push({ sev:"err", block:true, tag:"arm-sf",
          msg:"Arm safety factor "+solved.safetyFactor.toFixed(2)+" -- the "+(model.frame.material.label||"frame")+" arm fails under the motor's tip load ("+solved.stress_mpa.toFixed(0)+" MPa vs "+solved.yield_mpa+" MPa yield).",
          fix:"Choose a stronger material or a shorter/thicker arm before running Module 2." });
      } else if(solved.safetyFactor < 2){
        items.push({ sev:"warn", tag:"arm-sf-marginal",
          msg:"Arm safety factor is marginal ("+solved.safetyFactor.toFixed(2)+").",
          fix:"Aim for SF >= 2 for a comfortable structural margin." });
      }
    }catch(e){ /* CANTILEVER not ready yet -- skip silently */ }
  }
  // 6 . over-mass vs estimated thrust capacity
  const weightN = (model.totalMass_g/1000) * G;
  const thrustMaxN = model.tipForce_N * 4;
  const tw = weightN>0 ? thrustMaxN/weightN : 0;
  if(tw < 1.05){
    items.push({ sev:"warn", tag:"over-mass",
      msg:"Heavy build -- "+(model.totalMass_g/1000).toFixed(2)+" kg AUW vs an estimated "+thrustMaxN.toFixed(1)+" N max thrust (T/W "+tw.toFixed(2)+").",
      fix:"Lighter components or a higher-thrust motor/prop improve the margin." });
  }
  const errors = items.filter(i=>i.sev==="err").length;
  const warns = items.filter(i=>i.sev==="warn").length;
  const blocked = items.some(i=>i.block);
  if(!items.length) items.push({ sev:"ok", msg:"All checks passed -- CoG, arm loads and structural margins are within limits.", fix:"" });
  return { items, errors, warns, blocked };
}

/* ════════════ 6 · 3D MODELS + SIZING ════════════ */
function mat(color, opts){ return new THREE.MeshStandardMaterial(Object.assign({color, roughness:.55, metalness:.35}, opts||{})); }
function buildFallback(spec){
  const T = THREE, g = new T.Group();
  const c = spec.color, s = spec.s || 1;
  const add = (geo, m, x,y,z, rx,ry,rz)=>{
    const mesh = new T.Mesh(geo, m);
    mesh.position.set(x||0,y||0,z||0); mesh.rotation.set(rx||0,ry||0,rz||0);
    g.add(mesh); return mesh;
  };
  switch(spec.kind){
    case "frame":
      add(new T.BoxGeometry(.85,.07,.85), mat(c));
      add(new T.BoxGeometry(.62,.05,.62), mat(0x39424b), 0,.09,0);
      for(let i=0;i<4;i++){
        const a = Math.PI/4 + i*Math.PI/2;
        add(new T.BoxGeometry(1.5,.055,.11), mat(c), Math.cos(a)*.72,0,Math.sin(a)*.72, 0,-a,0);
        add(new T.CylinderGeometry(.11,.13,.1,20), mat(0x1f3a93), Math.cos(a)*1.4,.06,Math.sin(a)*1.4);
      }
      break;
    case "prop":
      add(new T.CylinderGeometry(.09,.09,.12,16), mat(0x22262b));
      for(let i=0;i<2;i++) add(new T.BoxGeometry(1.7,.02,.18), mat(c), 0,.03,0, 0,i*Math.PI,.12);
      break;
    case "motor":
      add(new T.CylinderGeometry(.42,.42,.5,28), mat(c));
      add(new T.CylinderGeometry(.46,.46,.1,28), mat(0x22262b), 0,.3,0);
      add(new T.CylinderGeometry(.07,.07,.35,12), mat(0xb9c2c9), 0,.55,0);
      add(new T.CylinderGeometry(.45,.45,.08,28), mat(0x22262b), 0,-.28,0);
      for(let i=0;i<8;i++){ const a=i/8*Math.PI*2; add(new T.BoxGeometry(.05,.42,.1), mat(0x33393f), Math.cos(a)*.43,0,Math.sin(a)*.43, 0,-a,0); }
      break;
    case "esc":
      add(new T.BoxGeometry(1.1,.22,.55), mat(c));
      add(new T.BoxGeometry(1.12,.06,.57), mat(0x22262b), 0,.14,0);
      add(new T.CylinderGeometry(.045,.045,.5,8), mat(0xc23b2e), -.62,0,.1, 0,0,Math.PI/2);
      add(new T.CylinderGeometry(.045,.045,.5,8), mat(0x22262b), -.62,0,-.1, 0,0,Math.PI/2);
      break;
    case "battery":
      add(new T.BoxGeometry(1.35,.5,.65), mat(c,{roughness:.4}));
      add(new T.BoxGeometry(.28,.54,.69), mat(0xd8b93c), -.2,0,0);
      add(new T.BoxGeometry(.2,.3,.5), mat(0x22262b), .78,0,0);
      break;
    case "fc":
      add(new T.BoxGeometry(.9,.07,.9), mat(0x1f4d3f));
      add(new T.BoxGeometry(.34,.12,.34), mat(c), 0,.09,0);
      for(let i=0;i<4;i++) add(new T.CylinderGeometry(.035,.035,.1,8), mat(0xd8b93c), (i%2?.38:-.38),.05,(i<2?.38:-.38));
      break;
    case "rx":
      add(new T.BoxGeometry(.6,.18,.4), mat(c));
      add(new T.CylinderGeometry(.02,.02,.8,8), mat(0x22262b), .18,.48,0, .35,0,0);
      add(new T.CylinderGeometry(.02,.02,.8,8), mat(0x22262b), -.18,.48,0, -.35,0,0);
      break;
    case "gimbal":
      add(new T.TorusGeometry(.42,.05,12,30), mat(0x33393f), 0,0,0, Math.PI/2);
      add(new T.BoxGeometry(.5,.4,.42), mat(c), 0,-.1,0);
      add(new T.CylinderGeometry(.14,.16,.2,20), mat(0x111417), 0,-.1,.3, Math.PI/2);
      add(new T.CylinderGeometry(.1,.1,.04,20), mat(0x4f6d9e), 0,-.1,.42, Math.PI/2);
      break;
    case "stand":
      add(new T.BoxGeometry(1.5,.12,1.0), mat(0x3a4148,{metalness:.4,roughness:.5}));
      add(new T.BoxGeometry(.9,.1,.9), mat(0x2b3036), 0,.07,0);
      add(new T.CylinderGeometry(.13,.17,1.2,20), mat(0x9aa5b1,{metalness:.6,roughness:.35}), 0,.72,0);
      add(new T.BoxGeometry(.7,.08,.7), mat(0x9aa5b1,{metalness:.6,roughness:.35}), 0,1.36,0);
      break;
    case "lidar":
      add(new T.CylinderGeometry(.4,.44,.4,26), mat(c));
      add(new T.CylinderGeometry(.42,.42,.07,26), mat(0x22262b), 0,.24,0);
      add(new T.CylinderGeometry(.13,.13,.06,18), mat(0x0e2c3f,{metalness:.8,roughness:.15}), 0,0,.38, Math.PI/2);
      break;
    default:
      add(new T.SphereGeometry(.4,18,14), mat(0xb8c4bf,{transparent:true,opacity:.35}));
  }
  g.scale.setScalar(s*.9);
  return g;
}
const modelCache = {};
let dracoLoader = null;
function draco(){
  if(!dracoLoader && THREE.DRACOLoader){
    dracoLoader = new THREE.DRACOLoader();
    dracoLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.4.1/");
  }
  return dracoLoader;
}
/* Brighten a loaded model's materials so the (mostly black carbon / dark metal)
   parts read clearly without flooding the scene with light. Lifts each base colour
   toward white, adds a little self-emission proportional to that colour, and caps
   metalness (fully-metallic surfaces go black under soft lighting). Applied once
   per cached master, so every clone inherits it. */
function brightenModel(obj){
  obj.traverse(o => {
    if(!o.isMesh || !o.material) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
      if(!m || m.userData.__brightened) return;
      m.userData.__brightened = true;
      if(m.color) m.color.lerp(new THREE.Color(0xffffff), 0.09);       // lift out of black
      if(m.emissive){ m.emissive.copy(m.color || new THREE.Color(0x222222)).multiplyScalar(0.07); m.emissiveIntensity = 1; }
      if(m.metalness != null) m.metalness = Math.min(m.metalness, 0.5);
      if(m.roughness != null) m.roughness = Math.min(m.roughness + 0.05, 1);
      m.needsUpdate = true;
    });
  });
  return obj;
}
function loadModelFile(url){
  if(modelCache[url]) return modelCache[url];
  modelCache[url] = new Promise((resolve, reject)=>{
    const lower = url.toLowerCase();
    if(lower.endsWith(".fbx")){
      if(!THREE.FBXLoader) return reject(new Error("FBXLoader unavailable"));
      new THREE.FBXLoader().load(url, obj=>resolve(brightenModel(obj)), undefined, reject);
    }else{
      const loader = new THREE.GLTFLoader();
      const dl = draco(); if(dl) loader.setDRACOLoader(dl);
      loader.load(url, gltf=>resolve(brightenModel(gltf.scene)), undefined, reject);
    }
  });
  return modelCache[url];
}
const ORIENT = { chasis:"flat", propeller:"flat", esc:"flat", battery:"flat", controller:"flat", reciever:"flat", motor:"axis", attachments:"none" };
function autoOrient(obj, rule){
  if(!rule || rule === "none") return;
  const s = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
  const dims = [s.x, s.y, s.z];
  let axis;
  if(rule === "flat"){ axis = dims.indexOf(Math.min(...dims)); }
  else{ const med = [...dims].sort((a,b)=>a-b)[1]; const dev = dims.map(d=>Math.abs(d-med)); axis = dev.indexOf(Math.max(...dev)); }
  if(axis === 0) obj.rotation.z = Math.PI/2;
  else if(axis === 2) obj.rotation.x = -Math.PI/2;
}
/* Average vertex X/Z of a subtree (world frame) — the spin/placement axis of a
   radially-symmetric part. For an odd-blade propeller or an asymmetric motor the
   bounding-box centre is offset from this true axis, so centring on the bbox
   makes the part spin off-centre or sit shifted off its mount. */
function vertexCentroidXZ(root){
  root.updateMatrixWorld(true);
  let x = 0, z = 0, n = 0; const v = new THREE.Vector3();
  root.traverse(m => {
    if(!(m.isMesh && m.geometry && m.geometry.attributes && m.geometry.attributes.position)) return;
    const p = m.geometry.attributes.position;
    const step = Math.max(1, Math.floor(p.count / 2000));   // subsample dense meshes
    for(let i = 0; i < p.count; i += step){ v.fromBufferAttribute(p, i); m.localToWorld(v); x += v.x; z += v.z; n++; }
  });
  return n ? { x: x / n, z: z / n } : null;
}
/* Fit a model to a target span (world units) applied to its LARGEST dimension.
   Returns the fitted group; span therefore = true real-world max-dimension × u. */
function fitUnit(obj, span, o, orientOverride){
  const pre = new THREE.Group(); pre.add(obj);
  if(o){
    if(orientOverride){ autoOrient(pre, orientOverride); }   // caller-chosen rule (e.g. "none")
    else if(o.view && Array.isArray(o.view.rotate_deg)){
      const r = o.view.rotate_deg;
      pre.rotation.set(r[0]*Math.PI/180, r[1]*Math.PI/180, r[2]*Math.PI/180);
    }else autoOrient(pre, ORIENT[o.catKey] || "none");
  }
  const outer = new THREE.Group(); outer.add(pre);
  const box = new THREE.Box3().setFromObject(outer);
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const c = box.getCenter(new THREE.Vector3());
  // Props and motors must rotate/seat about their true axis, not the bbox centre
  // (odd-blade props and lopsided motors are offset). Y stays bbox-centred so
  // seating height is unchanged.
  if(o && (o.catKey === "propeller" || o.catKey === "motor")){
    const hub = vertexCentroidXZ(outer);
    if(hub){ c.x = hub.x; c.z = hub.z; }
  }
  pre.position.sub(c);
  outer.scale.setScalar((span || 1.6) / maxDim);
  outer.userData.spanScale = (span||1.6)/maxDim;
  return outer;
}
/* Orient a multi-part motor so its shaft (the axis separating the stator from
   the rotor bell) points +Y — robust vs the bbox-dimension heuristic that tips
   wide-plate motors like the 2806 by 90°. Returns true if it oriented, so the
   caller skips auto-orient. Shared by the assembly (mountMotor) and previews. */
function orientMotorCombo(combo, parts){
  if(!parts || parts.length < 2) return false;
  const cen = p => new THREE.Box3().setFromObject(p).getCenter(new THREE.Vector3());
  const sep = cen(parts[parts.length - 1]).sub(cen(parts[0]));
  if(sep.length() <= 1e-6) return false;
  // Snap to the DOMINANT axis of the stator→rotor separation rather than the raw
  // vector. An asymmetric stator plate (e.g. the 2806, whose mounting lugs offset
  // its centroid sideways) yields a tilted sep vector; aligning that raw vector
  // to +Y would tip the whole motor. The shaft is really along one axis, so use a
  // clean 90° snap: shaft axis (largest |sep| component) → +Y.
  const a = [Math.abs(sep.x), Math.abs(sep.y), Math.abs(sep.z)];
  const ax = a.indexOf(Math.max(a[0], a[1], a[2]));
  const from = new THREE.Vector3(
    ax === 0 ? Math.sign(sep.x) : 0,
    ax === 1 ? Math.sign(sep.y) : 0,
    ax === 2 ? Math.sign(sep.z) : 0);
  combo.quaternion.setFromUnitVectors(from, new THREE.Vector3(0, 1, 0));
  combo.updateMatrixWorld(true);
  return true;
}
/* Seat a fitted (origin-centred) model relative to its mount anchor.
   Mounts mark REAL SURFACE POINTS on the frame (arm top, plate top, payload
   rail underside), so components must not be centred on them:
   "base"  → bottom face sits ON the anchor (motors on arms, ESC/FC/battery/
             receiver/gps on plates)
   "hang"  → top face sits AT the anchor (gimbal/payload hanging below a rail)
   Uses world-frame measurements divided by the parent's world scale, so it is
   correct whether or not the rig is scaled/attached to the scene yet. */
function seatModel(g, mode){
  // Ensure the ancestor transforms (esp. the chassis metre→world scale) are
  // current: Box3.setFromObject only refreshes g's own subtree, so a stale
  // parent world-scale would make the base-shift be computed at scale 1 and then
  // blow up when the real scale propagates (floated the battery/ESC/FC high).
  if(g.parent) g.parent.updateWorldMatrix(true, false);
  const b = new THREE.Box3().setFromObject(g);
  if(b.isEmpty()) return;
  const c = g.getWorldPosition(new THREE.Vector3());
  const s = (g.parent ? g.parent.getWorldScale(new THREE.Vector3()).y : 1) || 1;
  if(mode === "hang") g.position.y -= (b.max.y - c.y) / s;
  else                g.position.y += (c.y - b.min.y) / s;
}
/* immediate placeholder group; swaps in the real oriented+fitted model on arrival */
function modelFor(o, span, onReady){
  span = span || 1.6;
  const g = new THREE.Group();
  const fb = buildFallback((o && o.fallback) || {kind:"none",color:0xcccccc,s:1});
  g.add(fitUnit(fb, span, null));
  if(o && o.files && o.files.length){
    Promise.all(o.files.map(loadModelFile)).then(masters=>{
      const merged = new THREE.Group();
      const parts = masters.map(m=>m.clone(true));
      parts.forEach(p=>merged.add(p));
      const oriented = o.catKey === "motor" && orientMotorCombo(merged, parts);
      const fitted = fitUnit(merged, span, o, oriented ? "none" : undefined);
      while(g.children.length) g.remove(g.children[0]);
      g.add(fitted);
      if(onReady) onReady(g);
    }).catch(err=>console.warn("model load failed for", o && o.id, err.message||err));
  }
  return g;
}
/* raw fitted stand model (no per-category orientation) */
function measuredHeight(group){
  const box = new THREE.Box3().setFromObject(group);
  return { min: box.min.y, max: box.max.y, h: box.max.y - box.min.y };
}
const _raycaster = new THREE.Raycaster();
/* cast straight down through `root` at (x,z) and return the topmost surface Y hit, or fallback */
function raycastTopY(root, x, z, fallback){
  if(!root) return fallback;
  _raycaster.set(new THREE.Vector3(x, 50, z), new THREE.Vector3(0,-1,0));
  _raycaster.far = 100;
  const hits = _raycaster.intersectObject(root, true);
  return hits.length ? hits[0].point.y : fallback;
}
const _angDiff = (a,b)=>{ let d = Math.abs(a-b)%(2*Math.PI); return d>Math.PI ? 2*Math.PI-d : d; };
/* Detect the 4 motor-mount arm tips of a chassis mesh by scanning the top surface radially
   from the frame centre. Returns [{x,z,y,a}] for the 4 farthest-reaching prongs ≥50° apart.
   Falls back to an X-frame diagonal at `fallbackR` if the mesh is too sparse (e.g. placeholder). */
function detectArmTips(root, fallbackR){
  const out = [];
  if(root){
    const rc = new THREE.Raycaster();
    const bb = new THREE.Box3().setFromObject(root);
    const cx = (bb.max.x+bb.min.x)/2, cz = (bb.max.z+bb.min.z)/2;
    const maxR = Math.max(bb.max.x-bb.min.x, bb.max.z-bb.min.z)*0.62 + 0.15;
    const top = bb.max.y + 5;
    const scan = [];
    for(let deg=0; deg<360; deg+=3){
      const a = deg*Math.PI/180; let mr = 0, ty = null;
      for(let r=0.15; r<=maxR; r+=0.04){
        const x = cx+Math.cos(a)*r, z = cz+Math.sin(a)*r;
        rc.set(new THREE.Vector3(x, top, z), new THREE.Vector3(0,-1,0)); rc.far = 60;
        const h = rc.intersectObject(root, true);
        if(h.length){ mr = r; ty = h[0].point.y; }
      }
      if(mr>0) scan.push({ a, r:mr, y:ty });
    }
    const sorted = scan.sort((p,q)=>q.r-p.r);
    const picks = [];
    for(const s of sorted){
      if(picks.every(p=>_angDiff(p.a,s.a) > 0.87)){ picks.push(s); if(picks.length===4) break; }
    }
    if(picks.length===4){
      picks.sort((p,q)=>p.a-q.a);
      return picks.map(p=>({ x:cx+Math.cos(p.a)*p.r*0.92, z:cz+Math.sin(p.a)*p.r*0.92, y:p.y, a:p.a }));
    }
  }
  // fallback: symmetric X frame
  return [0,1,2,3].map(i=>{ const a = Math.PI/4 + i*Math.PI/2;
    return { x:Math.cos(a)*fallbackR, z:Math.sin(a)*fallbackR, y:null, a }; });
}

/* ════════════ 7 · PREVIEW ENGINE ════════════ */
let previewRenderer = null;
const previews = new Map();
function initPreviewEngine(){
  previewRenderer = new THREE.WebGLRenderer({antialias:true, alpha:true});
  previewRenderer.setSize(220,150);
  previewRenderer.setPixelRatio(1);
}
function registerPreview(canvas, o){
  if(!canvas || !o || !previewRenderer) return;
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff,.85));
  const d = new THREE.DirectionalLight(0xffffff,.9); d.position.set(2,3,2); scene.add(d);
  const d2 = new THREE.DirectionalLight(0xdce3f2,.35); d2.position.set(-2,-1,-2); scene.add(d2);
  const group = modelFor(o); scene.add(group);
  const camera = new THREE.PerspectiveCamera(34, 220/150, .1, 50);
  camera.position.set(1.9,1.35,1.9); camera.lookAt(0,0,0);
  previews.set(canvas, {scene, camera, group});
}
let frameNo = 0;
function blitPreviews(){
  if(!previewRenderer) return;
  let i = 0;
  for(const [cv,p] of previews){
    if(!cv.isConnected){ previews.delete(cv); continue; }
    if((i++ + frameNo) % 2 !== 0) continue;
    p.group.rotation.y += .022;
    previewRenderer.render(p.scene, p.camera);
    const ctx = cv.getContext("2d");
    ctx.clearRect(0,0,cv.width,cv.height);
    ctx.drawImage(previewRenderer.domElement, 0,0, cv.width, cv.height);
  }
}

/* ════════════ 8 · MAIN VIEWPORT / SCENES ════════════ */
let renderer, scene, camera, controls, rig, cantileverGroup, propGroups = [];
let hoverPhase = 0;
// component emitter anchors, so failure smoke/sparks vent from the real part
let rigParts = { motors: [], escs: [], battery: null };
// movable-component 3D anchors (battery/controller/reciever/attachments), keyed
// by placement key — populated in buildDroneFromMounts.placeMounts (BUILD_SPEC
// item D) so slider input can shift the real anchor without a full rebuild.
let movableAnchors = {};
function sceneModeType(){ return state.module === "m2" ? "stress" : "assembly"; }

/* ════════════ 8b · FAILURE FX — smoke plumes + spark bursts ════════════
   A tiny billboarded-sprite particle system. Emitters are tied to component
   anchors; each frame the sim sets a 0..1 intensity per component kind
   (motor / esc / battery) from live temperature / current / sag, and puffs
   vent from that part. Spark bursts fire on hard pops (e.g. over-voltage). */
const FX = (function(){
  let host = null, smokeTex = null, sparkTex = null, inited = false;
  const emitters = new Map();            // id -> {obj, kind, intensity, acc}
  const puffs = [], sparks = [];
  const CAP_PUFF = 160, CAP_SPARK = 90;
  const _v = new THREE.Vector3();
  function radialTex(stops){
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d");
    const grd = g.createRadialGradient(32,32,0, 32,32,32);
    stops.forEach(s => grd.addColorStop(s[0], s[1]));
    g.fillStyle = grd; g.fillRect(0,0,64,64);
    const t = new THREE.Texture(c); t.needsUpdate = true; return t;
  }
  function init(sc){
    if(inited) return; inited = true; host = sc;
    smokeTex = radialTex([[0,"rgba(66,66,70,0.9)"],[0.55,"rgba(48,48,52,0.5)"],[1,"rgba(38,38,42,0)"]]);
    sparkTex = radialTex([[0,"rgba(255,244,200,1)"],[0.4,"rgba(255,150,40,0.9)"],[1,"rgba(255,70,20,0)"]]);
  }
  function mkSprite(tex, additive){
    const m = new THREE.SpriteMaterial({ map:tex, transparent:true, depthWrite:false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    return new THREE.Sprite(m);
  }
  function spawnPuff(x,y,z, intensity, color){
    if(!inited || puffs.length >= CAP_PUFF) return;
    const s = mkSprite(smokeTex, false);
    s.material.color.setHex(color);
    s.position.set(x+(Math.random()-.5)*.12, y+(Math.random()-.5)*.06, z+(Math.random()-.5)*.12);
    const size0 = .18 + intensity*.22;
    s.scale.setScalar(size0); host.add(s);
    puffs.push({ s, age:0, life:1.0 + Math.random()*.7 + intensity*.5,
      size0, size1: size0 + .6 + intensity*1.0,
      vx:(Math.random()-.5)*.2, vy:.26 + intensity*.42 + Math.random()*.16, vz:(Math.random()-.5)*.2,
      op:.55 + intensity*.4 });
  }
  function burst(x,y,z, n){
    if(!inited) return;
    for(let k=0;k<n;k++){
      if(sparks.length >= CAP_SPARK) break;
      const s = mkSprite(sparkTex, true);
      s.position.set(x,y,z); s.scale.setScalar(.05 + Math.random()*.06); host.add(s);
      const a = Math.random()*Math.PI*2, sp = .6 + Math.random()*1.8;
      sparks.push({ s, age:0, life:.4 + Math.random()*.5,
        vx:Math.cos(a)*sp, vy:1.1 + Math.random()*1.9, vz:Math.sin(a)*sp });
    }
  }
  function setEmitter(id, obj, kind){ emitters.set(id, { obj, kind, intensity:0, acc:0 }); }
  function kindIntensity(kind, v){ emitters.forEach(e => { if(e.kind===kind) e.intensity = v; }); }
  function burstKind(kind, n){ emitters.forEach(e => { if(e.kind===kind && e.obj){ e.obj.getWorldPosition(_v); burst(_v.x,_v.y,_v.z,n); } }); }
  function clear(){
    puffs.forEach(p => { if(host) host.remove(p.s); p.s.material.dispose(); });
    sparks.forEach(p => { if(host) host.remove(p.s); p.s.material.dispose(); });
    puffs.length = 0; sparks.length = 0; emitters.clear();
  }
  function tick(dt){
    if(!inited) return;
    emitters.forEach(e => {
      if(e.intensity > .03 && e.obj){
        e.acc += e.intensity*e.intensity*32*dt;      // spawn rate ramps with severity
        while(e.acc >= 1){
          e.acc -= 1; e.obj.getWorldPosition(_v);
          const col = e.kind==="battery" ? 0x5a5a5c : e.kind==="esc" ? 0x38383c : 0x2c2c30;
          spawnPuff(_v.x,_v.y,_v.z, e.intensity, col);
          if(e.kind!=="battery" && e.intensity>.8 && Math.random()<.25) burst(_v.x,_v.y,_v.z, 2);
        }
      }
    });
    for(let i=puffs.length-1;i>=0;i--){
      const p = puffs[i]; p.age += dt; const k = p.age/p.life;
      if(k >= 1){ host.remove(p.s); p.s.material.dispose(); puffs.splice(i,1); continue; }
      p.s.position.x += p.vx*dt; p.s.position.y += p.vy*dt; p.s.position.z += p.vz*dt;
      p.vy += .18*dt; p.vx *= (1-.6*dt); p.vz *= (1-.6*dt);
      p.s.scale.setScalar(p.size0 + (p.size1-p.size0)*k);
      p.s.material.opacity = p.op * (1-k) * (k<.12 ? k/.12 : 1);
    }
    for(let i=sparks.length-1;i>=0;i--){
      const p = sparks[i]; p.age += dt; const k = p.age/p.life;
      if(k >= 1){ host.remove(p.s); p.s.material.dispose(); sparks.splice(i,1); continue; }
      p.vy -= 6*dt;
      p.s.position.x += p.vx*dt; p.s.position.y += p.vy*dt; p.s.position.z += p.vz*dt;
      p.s.material.opacity = 1-k;
    }
  }
  return { init, setEmitter, kindIntensity, burst, burstKind, clear, tick,
           counts: () => ({ puffs: puffs.length, sparks: sparks.length, emitters: emitters.size }) };
})();
const smokeRamp = (v,a,b) => Math.max(0, Math.min(1, (v-a)/(b-a)));

function initViewport(){
  const host = $("viewport");
  const w = host.clientWidth || 600, h = host.clientHeight || 400;
  renderer = new THREE.WebGLRenderer({antialias:true, alpha:true});
  renderer.setSize(w,h);
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  host.appendChild(renderer.domElement);
  scene = new THREE.Scene();
  // Moderate lighting; brightness of the dark carbon/metal parts is handled on the
  // components themselves (brightenModel in loadModelFile), not by flooding the scene.
  scene.add(new THREE.AmbientLight(0xffffff,.62));
  const key = new THREE.DirectionalLight(0xffffff,.9); key.position.set(4,6,3); scene.add(key);
  const fill = new THREE.DirectionalLight(0xdde5f0,.4); fill.position.set(-4,2,-4); scene.add(fill);
  scene.add(new THREE.GridHelper(14,28,0xc4d1cc,0xe1e9e6));
  FX.init(scene);
  camera = new THREE.PerspectiveCamera(38, w/h, .1, 200);
  camera.position.set(4.2,3.0,4.6);
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0,1.1,0);
  controls.enableDamping = true; controls.dampingFactor = .08;
  controls.minDistance = 1.5; controls.maxDistance = 20;
  buildScene();
}
function resizeViewport(){
  const host = $("viewport");
  if(!host || !renderer) return;
  const w = host.clientWidth, h = host.clientHeight;
  if(!w || !h) return;
  renderer.setSize(w,h);
  camera.aspect = w/h; camera.updateProjectionMatrix();
}
function clearRig(){
  if(rig){ scene.remove(rig); rig = null; }
  if(cantileverGroup){ scene.remove(cantileverGroup); cantileverGroup = null; }
  propGroups = [];
  FX.clear();
  rigParts = { motors: [], escs: [], battery: null };
  movableAnchors = {};
}
/* M1 assembles the full drone; M2 clears the drone and hands the shared group
   to window.CANTILEVER.build() (BUILD_SPEC §4/§F) — guarded so a missing
   cantilever.js never white-screens the lab. */
function buildScene(){
  invalidateModel();     // recompute the Model + fire onModelChange (glues heatmap/blueprint/telemetry)
  clearRig();
  if(sceneModeType() === "stress"){
    cantileverGroup = new THREE.Group();
    scene.add(cantileverGroup);
    if(window.CANTILEVER && typeof window.CANTILEVER.build === "function"){
      try{ window.CANTILEVER.build({ THREE, group:cantileverGroup, model:getModel() }); }
      catch(e){ console.warn("[CANTILEVER] build failed:", e); }
    }
    frameCantilever();     // normalise the metre-scale rig to a readable on-screen size + frame camera
  }else{
    buildDrone();
  }
  syncCamera();
}
/* The cantilever is authored in metres (arm ≈ 0.1–0.38 units) — tiny next to the
   14-unit grid. Uniformly scale the whole rig so its longest span reads at ~3.4
   units, sit its base on the grid, and frame the camera on it. Tip deflection
   from CANTILEVER.step() lives inside the group, so it scales with it. */
function frameCantilever(){
  if(!cantileverGroup || !camera || !controls) return;
  const box = new THREE.Box3().setFromObject(cantileverGroup);
  if(box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 0.3;
  const s = 3.4 / maxDim;
  cantileverGroup.scale.setScalar(s);
  const b2 = new THREE.Box3().setFromObject(cantileverGroup);
  const c = b2.getCenter(new THREE.Vector3());
  cantileverGroup.position.x -= c.x;
  cantileverGroup.position.z -= c.z;
  cantileverGroup.position.y -= b2.min.y;                 // base rests on the grid
  const spanY = (b2.max.y - b2.min.y);
  controls.target.set(0, Math.min(spanY * 0.5, 1.3), 0);
  camera.position.set(3.6, 2.4, 4.2);
  camera.updateProjectionMatrix();
  controls.update();
}
function syncCamera(){
  if(!controls) return;
  if(sceneModeType() === "stress"){ /* framed by frameCantilever() */ }
  else { controls.target.set(0, 1.1, 0); camera.position.set(4.2,3.0,4.6); controls.update(); }
}

/* full assembled drone — one world-scale u = 3.0 / wheelbase → true relative sizes.
   Motors/props are SEATED onto the real chassis geometry via downward raycast
   (works instantly against the fallback mesh, then re-seats once the real GLB loads). */
function buildDrone(){
  const d = new THREE.Group();
  propGroups = [];
  const ch = opt("chasis");
  d.position.y = 1.15;
  // Data-driven path: if the chassis ships authored mount transforms
  // (DARUKA mounts.json), seat every real component GLB at its exact mount.
  if(ch && ch.mounts && ch.mounts.mounts && ch.files && ch.files.length){
    buildDroneFromMounts(d, ch);
    rig = d; scene.add(d);
    return;
  }
  const wb = (ch && ch.phys && ch.phys.wheelbase_mm) || 220;
  const u = 3.0 / wb;                         // world units per mm
  const maxmm = o => (o && o.size) ? Math.max.apply(null, o.size) : 60;
  const mo = opt("motor"), pr = opt("propeller");
  const mSpan = mo ? maxmm(mo)*u : .3;
  const pDiaMm = pr ? (((pr.phys && pr.phys.diameter_in) || 5) * 25.4) : 120;
  const pSpan = pDiaMm * u;                    // propeller sized to its TRUE diameter
  const motorH = mo && mo.size ? mo.size[1]*u : mSpan*0.6;
  const armR = wb/2 * u;
  d.position.y = 1.15;   // set BEFORE seating so world→local offset is known
  const rig3 = [];  // {motor, prop} — positions assigned via detected arm tips
  for(let i=0;i<4;i++){
    const rec = { motor:null, prop:null };
    if(mo){ const m = modelFor(mo, mSpan); d.add(m); rec.motor = m; }
    if(pr){ const m = modelFor(pr, pSpan); d.add(m); propGroups.push(m); rec.prop = m; }
    rig3.push(rec);
  }
  const ba = opt("battery"), fc = opt("controller"), rx = opt("reciever");
  const baM = ba ? modelFor(ba, maxmm(ba)*u) : null; if(baM) d.add(baM);
  const fcM = fc ? modelFor(fc, maxmm(fc)*u) : null; if(fcM) d.add(fcM);
  const rxM = rx ? modelFor(rx, maxmm(rx)*u) : null; if(rxM) d.add(rxM);
  const atOpts = selOpts("attachments");
  const atM = atOpts.map(o=>{ const m = modelFor(o, maxmm(o)*u); d.add(m); return {o,m}; });
  let chGroup = null;
  /* raycast returns WORLD Y; parts are children of `d` (offset d.position.y) → convert to local */
  function topLocal(x, z, fb){
    const yOff = d.position.y || 0;
    return raycastTopY(chGroup, x, z, fb + yOff) - yOff;
  }
  function reseatAll(){
    const yOff = d.position.y || 0;
    const tips = detectArmTips(chGroup, armR);
    rig3.forEach((rec,i)=>{
      const tip = tips[i] || tips[0];
      const topY = (tip.y != null ? tip.y - yOff : topLocal(tip.x, tip.z, motorH*0.35));
      if(rec.motor) rec.motor.position.set(tip.x, topY + motorH*0.5, tip.z);
      if(rec.prop)  rec.prop.position.set(tip.x, topY + motorH + pSpan*0.06 + .02, tip.z);
    });
    if(baM){ baM.position.y = topLocal(0, 0, motorH*0.2) - maxmm(ba)*u*0.55; }
    if(fcM){ fcM.position.y = topLocal(0, 0, motorH*0.35) + maxmm(fc)*u*0.5 + .01; }
    if(rxM){ rxM.position.set(-armR*0.4, topLocal(-armR*0.4, -armR*0.35, motorH*0.3) + maxmm(rx)*u*0.4, -armR*0.35); }
    atM.forEach((a,i)=>{
      a.m.position.set((i-(atM.length-1)/2)*.8,
        topLocal(0,0,motorH*0.2) - maxmm(ba||a.o)*u*0.55 - maxmm(a.o)*u*0.5, 0);
    });
  }
  if(ch){ chGroup = modelFor(ch, maxmm(ch)*u, ()=>reseatAll()); d.add(chGroup); }
  reseatAll();
  rig = d; scene.add(d);
}

/* ── Mount-driven assembly ───────────────────────────────────────────────────
   The chassis ships a DARUKA mounts.json: 14 authored mount frames (position +
   quaternion, three.js right-handed Y-up, metres) in the GLB's native space.
   We place the raw chassis and every component anchor together inside ONE group
   that is recentred (−nativeCentre) and uniformly scaled (world-units/metre), so
   each authored mount coordinate maps to the correct world transform with no
   heuristic seating. Mounts without a real GLB (GPS / camera / payload) skip. */
const MOUNT_CATEGORY = {
  motor: "motor", esc: "esc", flight_controller: "controller",
  receiver: "reciever", battery: "battery",
};
/* On a normal multirotor these parts are always shaft-up / board-level — only
   their heading (yaw) is meaningful. The DARUKA auto-detector sometimes emits a
   spurious pitch/roll (e.g. free7's motor mounts are tilted 90°, some battery
   mounts are flipped 180°), so we reduce these mounts to pure yaw about world-Y.
   Camera / gps / payload keep their authored tilt (a camera should look forward,
   a gimbal should hang). */
const LEVEL_MOUNTS = { motor: 1, esc: 1, flight_controller: 1, battery: 1, receiver: 1 };
function levelMountQuat(quat){
  const q = new THREE.Quaternion(quat[0], quat[1], quat[2], quat[3]);
  const yaw = new THREE.Euler().setFromQuaternion(q, "YXZ").y;
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
}
/* Rotate a model group so its THINNEST bbox axis points +Y — makes flat parts
   (GPS puck, ESC board) lie flat on their pad instead of standing on edge. */
function orientThinUp(g){
  const s = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
  const d = [s.x, s.y, s.z], thin = d.indexOf(Math.min(d[0], d[1], d[2]));
  if(thin === 0) g.rotation.z = Math.PI / 2;
  else if(thin === 2) g.rotation.x = -Math.PI / 2;
}
/* Aim a camera's lens (its authored +Y, the tallest/protruding axis) outward
   along the anchor's local +X (which points away from the frame centre) with a
   small up-tilt, like a real FPV cam. */
function orientCameraForward(g, tiltDeg){
  const t = (tiltDeg == null ? 18 : tiltDeg) * Math.PI / 180;
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(Math.cos(t), Math.sin(t), 0));
}
/* Highest Y of the rotor BELL (world frame), ignoring the thin output shaft.
   The rotor GLB's bbox top is the shaft tip, which sits well above the bell that
   the prop actually rests on — seating a prop at the bbox top floats it. We keep
   only vertices whose radius from the spin axis is a real fraction of the bell
   radius (the shaft is thin → excluded), and take their max Y. */
function rotorBellTopY(rotor){
  rotor.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(rotor);
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  const maxR = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2 || 1;
  const thr = 0.4 * maxR, v = new THREE.Vector3();
  let topY = -Infinity;
  rotor.traverse(m => {
    if(!(m.isMesh && m.geometry && m.geometry.attributes && m.geometry.attributes.position)) return;
    const p = m.geometry.attributes.position;
    const step = Math.max(1, Math.floor(p.count / 4000));
    for(let i = 0; i < p.count; i += step){
      v.fromBufferAttribute(p, i); m.localToWorld(v);
      if(Math.hypot(v.x - cx, v.z - cz) > thr && v.y > topY) topY = v.y;
    }
  });
  return isFinite(topY) ? topY : box.max.y;
}
/* Seat a motor on its anchor and make its rotating part (the 2nd model file,
   rotar.glb) actually spin. Stator + rotor are fitted together so they stay
   aligned, then the rotor is re-parented (world-transform preserving) into a
   spinner group at the anchor origin — the motor's centre lies on that vertical
   axis, so spinning about Y turns the rotor true. The spinner is pushed to
   propGroups with the same direction as this motor's propeller. */
function mountMotor(anchor, o, spanM, spinDir, propInfo){
  const placeholder = fitUnit(buildFallback({ kind: "motor", color: 0x5a6672, s: 1 }), spanM, null);
  anchor.add(placeholder);
  seatModel(placeholder, "base");                      // mount = arm TOP surface
  Promise.all(o.files.map(loadModelFile)).then(masters => {
    // bail if this anchor was swapped out before the model finished loading
    // (the bench re-seats the motor once the stand measures) — avoids leaking a
    // stale spinner into propGroups.
    let n = anchor; while(n && n !== scene) n = n.parent;
    if(n !== scene) return;
    const combo = new THREE.Group();
    const parts = masters.map(mm => mm.clone(true));
    parts.forEach(p => combo.add(p));
    // Orient by the stator→rotor axis (see orientMotorCombo) and treat the 2nd
    // part as the spinning rotor bell.
    const twoPart = orientMotorCombo(combo, parts);
    let rotor = parts[parts.length - 1];
    const fitted = fitUnit(combo, spanM, o, twoPart ? "none" : undefined);
    if(placeholder.parent) anchor.remove(placeholder);
    anchor.add(fitted);
    anchor.updateWorldMatrix(true, true);
    // the mount marks the arm's TOP surface — seat the motor base ON it, so the
    // motor is never half-sunk below the arm nor floating above it
    seatModel(fitted, "base");
    anchor.updateWorldMatrix(true, true);
    const spinner = new THREE.Group();
    spinner.userData.spinDir = spinDir;
    anchor.add(spinner);
    if(rotor) spinner.attach(rotor);                   // keep world transform, reparent
    propGroups.push(spinner);
    // Seat the propeller with its REAL measured base flush on the rotor's
    // measured top surface (no size_mm guess, no gap), parented to the spinner so
    // it turns with the bell. Measured in the prop's onReady so the actual loaded
    // geometry — not a placeholder — decides the height.
    if(propInfo && propInfo.opt){
      const prop = modelFor(propInfo.opt, propInfo.span, g => {
        if(g.parent) g.parent.updateWorldMatrix(true, true);
        const bellTop = rotorBellTopY(rotor || spinner);               // bell, not shaft tip
        const pb = new THREE.Box3().setFromObject(g);                  // prop base
        const s = (g.parent ? g.parent.getWorldScale(new THREE.Vector3()).y : 1) || 1;
        // sink the hub a hair into the bell so it visibly grips it (no float, no gap)
        g.position.y += (bellTop - pb.min.y) / s - propInfo.span * 0.02;
      });
      spinner.add(prop);
    }
  }).catch(err => console.warn("motor load failed", err && (err.message || err)));
}
function buildDroneFromMounts(d, ch){
  // ── New hand-authored mount schema ────────────────────────────────────────
  //   { frame:{name}, mounts:[ { name, type, mode, position|center, normal,
  //     rotation(deg), direction, esc_type } ] }
  //   Coordinates are in the GLB's RAW/native frame (up = the motor-normal axis,
  //   which for every current chassis is Z). We rotate BOTH the mesh and every
  //   mount position by the same up→+Y quaternion so they stay locked together,
  //   then recentre + scale the whole rig by the mesh bbox. Components are sized
  //   by their real mm relative to the chassis mm (unit-independent), and each
  //   upright part (motor/esc/fc/battery/receiver) is seated base-on-surface.
  const allMounts = ch.mounts.mounts || [];
  const wb = (ch.phys && ch.phys.wheelbase_mm) || 290;
  const u = 3.0 / wb;                                    // world units per mm
  const chMaxMm = Math.max.apply(null, ch.size || [265.7, 60.1, 212]);
  const chSpan = chMaxMm * u;                            // target world size
  const maxmm = o => (o && o.size) ? Math.max.apply(null, o.size) : 40;
  const mountPos = m => m.position || m.center || [0, 0, 0];

  // up-axis + rotation: hoisted to module scope (§4 deriveUpAxis/upQuat) so
  // LAB.getModel() can independently map mounts.json → top-view mm using the
  // exact same transform this assembly uses.
  let upAxis = deriveUpAxis(ch);

  const sel = {
    motor: opt("motor"), esc: opt("esc"), controller: opt("controller"),
    reciever: opt("reciever"), battery: opt("battery"),
  };
  const pr = opt("propeller");
  const esc4in1 = escIs4in1(sel.esc);

  // container carries metre→world scale; inner carries the recentre so the
  // chassis mesh and all mount anchors share one frame.
  const chCon = new THREE.Group();
  const inner = new THREE.Group();
  chCon.add(inner);
  chCon.visible = false;
  d.add(chCon);

  // Seat one authored mount (already up-rotated) inside `inner`. `maxDim` is the
  // mesh's largest bbox dimension (mesh units) so component span is expressed as
  // (component_mm / chassis_mm) × maxDim → correct real ratio at any mesh scale.
  function placeMounts(q, maxDim){
    const spanFor = mm => Math.max(mm, 1) / chMaxMm * maxDim;
    const rot = raw => new THREE.Vector3(raw[0], raw[1], raw[2]).applyQuaternion(q);
    const yawQuat = deg => new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0,1,0), (deg||0) * Math.PI/180);
    let motorCount = 0;
    const escMounts = [];
    allMounts.forEach(m => {
      const cat = MOUNT_CATEGORY[m.type];
      if(m.type === "esc"){ escMounts.push(m); return; }   // handled together below
      if(!cat) return;                                      // gps/camera/payload → attachments
      const o = sel[cat];
      if(!o || !(o.files && o.files.length)) return;        // no real model → skip
      const anchor = new THREE.Group();
      anchor.position.copy(rot(mountPos(m)));
      anchor.quaternion.copy(yawQuat(m.rotation));          // upright, heading only
      inner.add(anchor);
      if(m.type === "motor"){
        const dir = (motorCount % 2) ? 1 : -1;              // alternate quad spin
        const propMm = ((pr && pr.phys && pr.phys.diameter_in) || 5) * 25.4;
        const propInfo = (pr && pr.files && pr.files.length)
          ? { opt: pr, span: spanFor(propMm) } : null;
        mountMotor(anchor, o, spanFor(maxmm(o)), dir, propInfo);
        rigParts.motors.push(anchor); FX.setEmitter("motor"+motorCount, anchor, "motor");
        motorCount++;
      }else{
        anchor.add(modelFor(o, spanFor(maxmm(o)), g => seatModel(g, "base")));
        if(m.type === "battery"){ rigParts.battery = anchor; FX.setEmitter("battery", anchor, "battery"); }
        // battery / controller / reciever are movable (BUILD_SPEC §placement) —
        // shift by the stored slider offset and remember the anchor so the
        // slider's `input` handler can move it live without a full rebuild.
        anchor.userData.basePos = anchor.position.clone();
        applyPlacementOffsetToAnchor(anchor, cat);
        movableAnchors[cat] = anchor;
      }
    });

    // ESCs — match the selected ESC: a 4-in-1 is ONE board on its stack mount;
    // single ESCs sit on each arm. Fall back to whatever esc mounts exist.
    if(sel.esc && sel.esc.files && sel.esc.files.length && escMounts.length){
      const want = esc4in1 ? "4in1" : "single";
      let chosen = escMounts.filter(m => (m.esc_type || "single") === want);
      if(!chosen.length) chosen = escMounts;
      if(esc4in1) chosen = chosen.slice(0, 1);
      chosen.forEach((m, i) => {
        const anchor = new THREE.Group();
        const p = rot(mountPos(m));
        anchor.position.copy(p);
        // A single ESC sits lengthwise ALONG its arm. The ESC's long axis is local
        // +X after fit, so yaw it to the arm's radial heading (unless the mount
        // authored a specific rotation). A 4-in-1 stack keeps the mount's yaw.
        if(esc4in1) anchor.quaternion.copy(yawQuat(m.rotation));
        else anchor.rotation.y = -Math.atan2(p.z, p.x);
        inner.add(anchor);
        anchor.add(modelFor(sel.esc, spanFor(maxmm(sel.esc)), g => { orientThinUp(g); seatModel(g, "base"); }));
        rigParts.escs.push(anchor); FX.setEmitter("esc"+i, anchor, "esc");
      });
    }

    // Attachments (multi-select): camera/thermal face forward (front of frame),
    // gps lies flat on its pad, gimbal/payload hangs below its rail. Two
    // camera-type parts (FPV + thermal) share the single camera mount → the extra
    // is stacked just below so it stays visible.
    const attachUsed = {};
    let camStack = 0;
    selOpts("attachments").forEach(o => {
      if(!(o.files && o.files.length)) return;
      const mtype = (o.phys && o.phys.mount_type) || "payload";
      let mt = allMounts.find(m => m.type === mtype && !attachUsed[m.name]);
      let drop = 0;
      if(!mt && mtype === "camera"){ mt = allMounts.find(m => m.type === "camera"); drop = ++camStack; }
      if(!mt) mt = allMounts.find(m => m.type === "payload" && !attachUsed[m.name]);
      if(!mt) return;
      if(!drop) attachUsed[mt.name] = true;
      const span = spanFor(maxmm(o));
      const anchor = new THREE.Group();
      const p = rot(mountPos(mt));
      anchor.position.copy(p);
      inner.add(anchor);
      if(mtype === "gps"){
        anchor.add(modelFor(o, span, g => { orientThinUp(g); seatModel(g, "base"); }));
      }else if(mtype === "camera"){
        const th = Math.atan2(p.z, p.x);
        anchor.rotation.y = -th;                          // local +X → outward (front)
        anchor.position.x += Math.cos(th) * span * 0.6;   // push clear of the frame body
        anchor.position.z += Math.sin(th) * span * 0.6;
        anchor.position.y -= drop * span * 0.85;          // stack a 2nd cam below
        anchor.add(modelFor(o, span, g => orientCameraForward(g)));
      }else{                                              // payload / gimbal — hang under the rail
        anchor.add(modelFor(o, span, g => seatModel(g, "hang")));
      }
      // attachments are movable per-unit (BUILD_SPEC §placement) — one slider
      // group per selected option, keyed "attachments:<id>".
      anchor.userData.basePos = anchor.position.clone();
      applyPlacementOffsetToAnchor(anchor, "attachments:"+o.id);
      movableAnchors["attachments:"+o.id] = anchor;
    });
  }

  // Load the mesh, finalise up-axis / centre / scale, then place every mount in
  // that same Y-up frame. On load failure, still place components (metre assumption).
  Promise.all(ch.files.map(loadModelFile)).then(masters => {
    const merged = new THREE.Group();
    masters.forEach(mm => merged.add(mm.clone(true)));
    if(!upAxis){
      const raw = new THREE.Box3().setFromObject(merged).getSize(new THREE.Vector3());
      const d3 = [raw.x, raw.y, raw.z], thin = d3.indexOf(Math.min.apply(null, d3));
      upAxis = thin === 1 ? "y" : thin === 2 ? "z" : "x";
    }
    const q = upQuat(upAxis);
    merged.quaternion.copy(q);
    merged.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(merged);
    const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    inner.add(merged);
    inner.position.set(-c.x, -c.y, -c.z);                  // recentre mesh + mounts together
    chCon.scale.setScalar(chSpan / maxDim);
    placeMounts(q, maxDim);
    chCon.visible = true;
  }).catch(err => {
    console.warn("chassis load failed", err && (err.message || err));
    const q = upQuat(upAxis || "y");
    const maxDim = chMaxMm / 1000;                          // assume metres
    chCon.scale.setScalar(chSpan / maxDim);
    placeMounts(q, maxDim);
    chCon.visible = true;
  });
}

/* ════════════ 8b · UI RENDERING ════════════ */
const tileCanvases = {};
function tileInfo(key){
  const c = cat(key);
  if(c.multi){
    const opts = selOpts(key);
    return { mass: opts.reduce((a,o)=>a+o.mass*o.qty,0),
      name: opts.length ? (opts.length===1 ? opts[0].name : opts.length+" attached") : "None (tap to add)",
      preview: opts[0] || { fallback:{kind:"none",color:0xcccccc,s:1} } };
  }
  const o = opt(key);
  return { mass:o?o.mass*o.qty:0, name:o?o.name:"—", preview:o };
}
function renderTiles(){
  const grid = $("paramGrid"); grid.innerHTML = "";
  DRONE_DB.categories.forEach(c=>{
    const info = tileInfo(c.key);
    const b = el("button","tile"); b.type = "button";
    b.innerHTML =
      '<div class="tile-top"><span class="tile-label">'+txt(c.label)+'</span>'+
      '<span class="tile-mass">'+fmtMass(info.mass)+'</span></div>'+
      '<div class="tile-view"><canvas width="150" height="100"></canvas></div>'+
      '<span class="tile-sel">'+txt(info.name)+'</span>';
    b.addEventListener("click", ()=>openPicker(c.key));
    grid.appendChild(b);
    const cv = b.querySelector("canvas");
    tileCanvases[c.key] = cv;
    registerPreview(cv, info.preview);
  });
  $("cfgCode").textContent = configCode();
}
function refreshTile(key){
  const cv = tileCanvases[key]; const info = tileInfo(key);
  if(cv){ previews.delete(cv); registerPreview(cv, info.preview); }
  const btn = cv && cv.closest(".tile");
  if(btn){
    btn.querySelector(".tile-mass").textContent = fmtMass(info.mass);
    btn.querySelector(".tile-sel").textContent = info.name;
  }
  $("cfgCode").textContent = configCode();
}
function renderMassMini(){
  const { rows, total } = massRows();
  const top = rows.slice().sort((a,b)=>b.mass-a.mass).slice(0,4);
  const box = $("massMini"); box.innerHTML = "";
  top.forEach(r=>{
    const d = el("div","mass-row");
    d.innerHTML = '<span class="lbl">'+txt(r.label)+'</span>'+
      '<div class="bar"><i style="width:'+Math.round(r.frac*100)+'%"></i></div>'+
      '<span class="val">'+fmtMass(r.mass)+'</span>';
    box.appendChild(d);
  });
  $("massTotal").textContent = (total/1000).toFixed(2)+" kg";
}
function renderModuleTabs(){
  const box = $("moduleTabs"); box.innerHTML = "";
  const assembled = !!state.done["m1:balance"];
  DRONE_DB.modules.forEach(m=>{
    const locked = m.id !== "m1" && !assembled;
    const b = el("button", m.id===state.module ? "active" : ""); b.type = "button";
    b.disabled = locked;
    b.innerHTML = (locked?"🔒 ":"")+txt(m.label)+' <small>· '+txt(m.sub)+'</small>';
    b.title = locked ? "Complete Assembly & CoG Balancing in Module 1 first" : "";
    b.addEventListener("click", ()=>{
      if(locked) return;
      if(simActive) stopSim(false);
      state.module = m.id; saveState();
      syncModuleUI();
      renderModuleTabs(); renderExpTabs(); renderCalcChips(); renderLog();
      drawLiveGraph(); buildScene(); syncRunControls();
    });
    box.appendChild(b);
  });
}
function renderExpTabs(){
  const box = $("expTabs"); box.innerHTML = "";
  const m = DRONE_DB.modules.find(m=>m.id===state.module);
  const assembled = !!state.done["m1:balance"];
  m.experiments.forEach(e=>{
    const key = m.id+":"+e.id;
    const locked = m.id !== "m1" && !assembled;
    const b = el("button", e.id===state.exp[m.id] ? "active" : ""); b.type = "button";
    b.disabled = locked;
    b.innerHTML = (state.done[key] ? '<span class="done">✓</span>' : locked ? "🔒 " : "") + txt(e.name);
    b.addEventListener("click", ()=>{
      if(locked) return;
      if(simActive) stopSim(false);
      state.exp[m.id] = e.id; saveState();
      renderExpTabs(); drawLiveGraph(); buildScene(); syncRunControls();
      playIntroVoice(key);
    });
    box.appendChild(b);
  });
}
function renderProgress(){
  const total = allExperiments().length, n = doneCount();
  $("progressFill").style.width = (total ? n/total*100 : 0)+"%";
  $("progressTxt").textContent = n+" / "+total;
}
/* Module-2-only chrome: frame-material picker + structural charts card
   (BUILD_SPEC §6 layout contract). */
function syncModuleUI(){
  const isM2 = state.module === "m2";
  const matEl = $("matPicker"); if(matEl) matEl.hidden = !isM2;
  const m2 = $("m2Charts"); if(m2) m2.hidden = !isM2;
}
function renderCalcChips(){
  const model = getModel();
  const box = $("calcChips"); if(!box) return;
  let chips;
  if(state.module === "m2" && window.CANTILEVER && typeof window.CANTILEVER.solve === "function"){
    let solved;
    try{ solved = window.CANTILEVER.solve(model); }
    catch(e){ solved = { force_N:0, stress_mpa:0, yield_mpa:model.frame.material.yield_mpa, safetyFactor:0, deflection_mm:0, firstBendingMode_hz:0 }; }
    const sfCls = solved.safetyFactor>=2 ? "good" : solved.safetyFactor>=1 ? "" : "warn";
    chips = [
      { k:"Tip load", v:solved.force_N.toFixed(2)+" N", cls:"" },
      { k:"Root stress", v:solved.stress_mpa.toFixed(1)+" MPa", cls:sfCls },
      { k:"Safety factor", v: solved.safetyFactor>=90 ? "∞" : solved.safetyFactor.toFixed(2), cls:sfCls },
      { k:"Tip deflection", v:solved.deflection_mm.toFixed(2)+" mm", cls:"" },
      { k:"1st bending mode", v:solved.firstBendingMode_hz.toFixed(0)+" Hz", cls:"" }
    ];
  }else{
    const maxArm = model.arms.reduce((a,b)=> (b.loadShare>a.loadShare?b:a), model.arms[0]||{loadShare:0.25,index:0});
    chips = [
      { k:"All-up weight", v:(model.totalMass_g/1000).toFixed(2)+" kg", cls:"" },
      { k:"CoG offset", v:model.cog.r_mm.toFixed(1)+" mm", cls: model.balanced?"good":"warn" },
      { k:"Max arm load", v:(maxArm.loadShare*100).toFixed(1)+" %", cls: maxArm.loadShare<=0.30?"good":"warn" },
      { k:"Tolerance", v:model.tolerance_mm+" mm", cls:"" },
      { k:"Status", v: model.balanced?"BALANCED":"OFF-CENTRE", cls: model.balanced?"good":"warn" }
    ];
  }
  box.innerHTML = "";
  chips.forEach(ch=>{
    const d = el("div","calc-chip");
    d.innerHTML = '<span class="k">'+ch.k+'</span><span class="v '+ch.cls+'">'+ch.v+'</span>';
    box.appendChild(d);
  });
}
function renderLog(){
  const dg = diagnostics();
  const list = $("logList"); list.innerHTML = "";
  const icon = s => s==="ok" ? "✓" : s==="warn" ? "!" : "×";
  dg.items.forEach(it=>{
    const d = el("div","log-item "+it.sev);
    d.innerHTML = '<span class="ic">'+icon(it.sev)+'</span>'+
      '<div class="body"><span class="msg">'+txt(it.msg)+'</span>'+
      (it.fix ? '<span class="fix">→ '+txt(it.fix)+'</span>' : '')+'</div>';
    list.appendChild(d);
  });
  const badge = $("logBadge"), sum = $("logSummary");
  if(dg.errors){ badge.className="log-badge err"; badge.textContent = dg.errors+" error"+(dg.errors>1?"s":"");
    sum.textContent = "· "+dg.errors+" error"+(dg.errors>1?"s":"")+(dg.warns?", "+dg.warns+" warning"+(dg.warns>1?"s":""):""); }
  else if(dg.warns){ badge.className="log-badge warn"; badge.textContent = dg.warns+" warning"+(dg.warns>1?"s":"");
    sum.textContent = "· "+dg.warns+" warning"+(dg.warns>1?"s":""); }
  else { badge.className="log-badge ok"; badge.textContent = "OK"; sum.textContent = "· build OK"; }
  // reflect run-block state on the button
  const rb = $("runBtn");
  if(dg.blocked && !simActive){ rb.classList.add("blocked"); }
  else { rb.classList.remove("blocked"); }
  return dg;
}
function renderReward(){
  const body = $("rewardBody");
  const unlocked = allDone();
  $("rewardBadge").textContent = (unlocked?1:0)+" / 1";
  body.innerHTML = "";
  if(unlocked){
    const r = DRONE_DB.reward;
    const d = el("div","reward-open");
    d.innerHTML = '<div class="view"><canvas width="280" height="190"></canvas></div>'+
      '<div class="meta"><b>★ '+txt(r.name)+'</b><p>'+txt(r.desc)+'</p></div>';
    body.appendChild(d);
    registerPreview(d.querySelector("canvas"), r);
  }else{
    const total = allExperiments().length;
    const d = el("div","reward-locked");
    d.innerHTML = '<div class="lock">🔒</div><p>Complete all '+total+' experiments<br>to unlock a reward component</p>';
    body.appendChild(d);
  }
}
/* New telemetry IDs (BUILD_SPEC §6): telMass telCogX telCogY telCogR telArmLoad
   telVerdict telPhase. */
function updateTelemetry(t){
  t = t || {};
  $("telMass").textContent = t.mass!=null ? fmtMass(t.mass) : "— g";
  $("telCogX").textContent = (t.cogX!=null?t.cogX:0).toFixed(1)+" mm";
  $("telCogY").textContent = (t.cogY!=null?t.cogY:0).toFixed(1)+" mm";
  $("telCogR").textContent = (t.cogR!=null?t.cogR:0).toFixed(1)+" mm";
  $("telArmLoad").textContent = t.armLoad || "—";
  $("telVerdict").textContent = t.verdict || "—";
  const ph = $("telPhase");
  ph.textContent = t.phase || "STANDBY";
  ph.className = "tel-phase mono"+(t.phaseCls?" "+t.phaseCls:"");
}

/* ── Frame-material picker (Module 2 only) — BUILD_SPEC §5/item E ── */
function renderMaterialPicker(){
  const grid = $("matPickerGrid"); if(!grid) return;
  grid.innerHTML = "";
  MATERIALS.forEach(m=>{
    const b = el("button","mat-tile"+(state.material===m.id?" selected":"")); b.type = "button";
    b.innerHTML = '<span class="name">'+txt(m.label)+'</span>'+
      '<span class="specs"><span>σy <b>'+m.yield_mpa+'</b></span><span>E <b>'+m.youngs_gpa+'</b>GPa</span><span>ρ <b>'+m.density_kg_m3+'</b></span></span>';
    b.addEventListener("click", ()=>{
      if(state.material === m.id) return;
      state.material = m.id; saveState();
      renderMaterialPicker();
      buildScene();                 // recolours the cantilever rig + recomputes SF
      renderCalcChips(); renderLog();
    });
    grid.appendChild(b);
  });
}

/* ── Placement sliders (Module 1) — BUILD_SPEC item D ── */
function movableUnits(){
  const units = [];
  const ba = opt("battery"), fc = opt("controller"), rx = opt("reciever");
  if(ba) units.push({ key:"battery", label:"Battery · "+ba.name, ranges: placementRanges("battery") });
  if(fc) units.push({ key:"controller", label:"Flight Controller · "+fc.name, ranges: placementRanges("controller") });
  if(rx) units.push({ key:"reciever", label:"Receiver · "+rx.name, ranges: placementRanges("reciever") });
  selOpts("attachments").forEach(o=>{
    units.push({ key:"attachments:"+o.id, label:o.name, ranges: placementRanges("attachments") });
  });
  return units;
}
function renderSliders(){
  const list = $("sliderList"); if(!list) return;
  list.innerHTML = "";
  const resetBtn = el("button","btn btn-ghost","↺ Reset placement");
  resetBtn.type = "button";
  resetBtn.style.cssText = "align-self:flex-start;padding:6px 14px;font-size:10px";
  resetBtn.addEventListener("click", ()=>{
    state.place = {}; saveState();
    buildScene();
    renderSliders();
  });
  list.appendChild(resetBtn);
  const units = movableUnits();
  if(!units.length){
    list.appendChild(el("div","log-empty","No movable components selected — add a battery, flight controller, receiver or attachment to tune the CoG."));
    return;
  }
  units.forEach(u=>{
    const ranges = u.ranges || { x:[-50,50], y:[-50,50] };
    const cur = Object.assign({x:0,y:0}, state.place[u.key]);
    const row = el("div","slider-row");
    row.innerHTML =
      '<div class="srow-top"><span class="srow-label">'+txt(u.label)+'</span></div>'+
      '<div class="srow-axis"><span>X</span><input type="range" min="'+ranges.x[0]+'" max="'+ranges.x[1]+'" step="1" value="'+cur.x+'"><b>'+cur.x.toFixed(0)+' mm</b></div>'+
      '<div class="srow-axis"><span>Y</span><input type="range" min="'+ranges.y[0]+'" max="'+ranges.y[1]+'" step="1" value="'+cur.y+'"><b>'+cur.y.toFixed(0)+' mm</b></div>';
    list.appendChild(row);
    const inputs = row.querySelectorAll("input[type=range]");
    const readouts = row.querySelectorAll(".srow-axis b");
    ["x","y"].forEach((axis,idx)=>{
      inputs[idx].addEventListener("input", ()=>{
        const v = +inputs[idx].value;
        readouts[idx].textContent = v.toFixed(0)+" mm";
        const p = state.place[u.key] = Object.assign({x:0,y:0}, state.place[u.key]);
        p[axis] = v; saveState();
        reapplyPlacementOffset(u.key);   // live-move the real 3D anchor (item D)
        invalidateModel();               // recompute CoG + redraw heatmap/blueprint/telemetry
      });
    });
  });
}

/* ── glue (BUILD_SPEC item G) — called after every model rebuild ── */
function glueModelViews(){
  const model = getModel();
  try{ if(window.BLUEPRINT) window.BLUEPRINT.drawHeatmap($("heatCanvas"), model); }
  catch(e){ console.warn("[BLUEPRINT] drawHeatmap failed:", e); }
  try{ if(window.BLUEPRINT) window.BLUEPRINT.drawTopView($("planCanvas"), model); }
  catch(e){ console.warn("[BLUEPRINT] drawTopView failed:", e); }
  const armLabels = ["FR","FL","RL","RR"];
  const maxArm = model.arms.reduce((a,b)=> (b.loadShare>a.loadShare?b:a), model.arms[0]||{loadShare:0.25,index:0});
  if(!simActive){
    updateTelemetry({
      mass: model.totalMass_g, cogX: model.cog.x_mm, cogY: model.cog.y_mm, cogR: model.cog.r_mm,
      armLoad: armLabels[maxArm.index||0]+" "+(maxArm.loadShare*100).toFixed(1)+"%",
      verdict: state.module==="m2" ? "—" : (model.balanced ? "BALANCED" : "OFFSET "+model.cog.r_mm.toFixed(1)+" mm"),
      phase: "STANDBY", phaseCls:""
    });
  }
  if(state.module === "m2" && window.CANTILEVER && typeof window.CANTILEVER.drawCharts === "function"){
    try{
      window.CANTILEVER.drawCharts({ sfdCanvas:$("sfdCanvas"), bmdCanvas:$("bmdCanvas"), stressBarCanvas:$("stressBarCanvas"), model });
    }catch(e){ console.warn("[CANTILEVER] drawCharts failed:", e); }
    renderSfMatrix();
  }
}

/* ── Safety-factor matrix — 3 materials × 3 arm lengths (BUILD_SPEC §F) ── */
const SF_LENGTHS_MM = [150, 250, 350];
function renderSfMatrix(){
  const grid = $("sfMatrix"); if(!grid) return;
  if(!(window.CANTILEVER && typeof window.CANTILEVER.solve === "function")){ grid.innerHTML = ""; return; }
  const model = getModel();
  grid.innerHTML = "";
  grid.appendChild(el("div","cell hd",""));
  SF_LENGTHS_MM.forEach(L=> grid.appendChild(el("div","cell hd", L+" mm")));
  MATERIALS.forEach(mat=>{
    grid.appendChild(el("div","cell rowhd", mat.label));
    SF_LENGTHS_MM.forEach(L=>{
      const testModel = Object.assign({}, model, {
        frame: Object.assign({}, model.frame, { arm_length_mm:L, material:mat })
      });
      let solved; try{ solved = window.CANTILEVER.solve(testModel); }catch(e){ solved = null; }
      const sf = solved ? solved.safetyFactor : 0;
      const sevCls = sf>=2 ? "pass" : sf>=1 ? "marginal" : "fail";
      const cell = el("div","cell "+sevCls, "<b>"+(sf>=90?"∞":sf.toFixed(2))+"</b>SF");
      grid.appendChild(cell);
    });
  });
}

function refreshAfterSelection(key){
  refreshTile(key);
  renderMassMini(); renderCalcChips(); renderLog(); drawMassChart();
  renderSliders();
  buildScene(); saveState();
}

/* ════════════ 9 · 2D CHARTS ════════════ */
function chartFrame(ctx, w, h){
  ctx.clearRect(0,0,w,h);
  ctx.strokeStyle = "#e7edeb"; ctx.lineWidth = 1;
  for(let i=1;i<5;i++){ ctx.beginPath(); ctx.moveTo(0, h*i/5); ctx.lineTo(w, h*i/5); ctx.stroke(); }
  for(let i=1;i<8;i++){ ctx.beginPath(); ctx.moveTo(w*i/8, 0); ctx.lineTo(w*i/8, h); ctx.stroke(); }
}
function drawSeries(ctx, w, h, pts, color, fill, maxOverride){
  if(!pts || pts.length<2) return;
  const max = maxOverride || (Math.max(...pts)*1.15 || 1);
  const X = i => i/(pts.length-1)*w;
  const Y = v => h - (v/max)*(h-14) - 7;
  if(fill){
    ctx.beginPath(); ctx.moveTo(0,h);
    pts.forEach((v,i)=>ctx.lineTo(X(i),Y(v)));
    ctx.lineTo(w,h); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
  }
  ctx.beginPath();
  pts.forEach((v,i)=> i ? ctx.lineTo(X(i),Y(v)) : ctx.moveTo(X(i),Y(v)));
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.stroke();
  ctx.beginPath(); ctx.arc(X(pts.length-1), Y(pts[pts.length-1]), 3, 0, Math.PI*2);
  ctx.fillStyle = color; ctx.fill();
}
function drawLiveGraph(){
  const cv = $("liveGraph"), ctx = cv.getContext("2d");
  const w = cv.width, h = cv.height;
  chartFrame(ctx,w,h);
  const { mod, exp } = currentExp();
  const key = mod.id+":"+exp.id;
  let src = simActive && sim.data.length>1 ? sim : null;
  let pts = src ? src.data : null, secondary = src ? src.data2 : null;
  let caption;
  if(!pts){
    const last = state.history.filter(r=>r.key===key).slice(-1)[0];
    if(last){ pts = last.points; secondary = last.points2; }
  }
  if(pts && pts.length>1){
    if(secondary && secondary.length>1){
      const smax = Math.max(...secondary)*1.15 || 1;
      drawSeries(ctx,w,h,secondary,"#c65d3b",null,smax);
    }
    drawSeries(ctx,w,h,pts,"#1f3a93","rgba(31,58,147,.09)");
    caption = exp.name+" · "+(exp.unit||"value")+" vs t "+(simActive?"· recording…":"· last run");
  }else{
    ctx.fillStyle = "#a3b2ad"; ctx.font = "500 13px 'IBM Plex Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText("no data — run "+exp.name, w/2, h/2+4);
    caption = exp.name+" · waiting for first run…";
  }
  $("graphCaption").textContent = caption;
}
function drawMassChart(){ drawMassChartOn($("massChart")); }
function drawMassChartOn(cv){
  const ctx = cv.getContext("2d"); const w = cv.width, h = cv.height;
  ctx.clearRect(0,0,w,h);
  const { rows, total } = massRows();
  const sorted = rows.filter(r=>r.mass>0).sort((a,b)=>b.mass-a.mass);
  const colors = ["#1f3a93","#4f6d9e","#c65d3b","#6c86c9","#8fa3c9","#a83232","#8b9a95","#d98e6a"];
  const bx = 16, bw = w-32, bh = 30, by = 26;
  let x = bx;
  ctx.font = "600 15px 'IBM Plex Sans', sans-serif";
  sorted.forEach((r,i)=>{
    const seg = r.frac*bw;
    ctx.fillStyle = colors[i%colors.length];
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x,by,Math.max(seg-2,2),bh,3) : ctx.fillRect(x,by,Math.max(seg-2,2),bh);
    ctx.fill(); x += seg;
  });
  ctx.textAlign = "left"; let lx = bx, ly = by+bh+34;
  sorted.slice(0,4).forEach((r,i)=>{
    ctx.fillStyle = colors[i%colors.length];
    ctx.fillRect(lx, ly-12, 12, 12);
    ctx.fillStyle = "#3c4a46";
    const label = r.label+" "+Math.round(r.frac*100)+"%";
    ctx.fillText(label, lx+18, ly);
    lx += 26 + ctx.measureText(label).width + 16;
  });
  ctx.fillStyle = "#1e2a29"; ctx.font = "600 17px 'IBM Plex Mono', monospace"; ctx.textAlign = "right";
  ctx.fillText((total/1000).toFixed(2)+" kg", w-16, by-8);
  ctx.textAlign = "left"; ctx.fillStyle = "#8b9a95"; ctx.font = "600 12px 'IBM Plex Sans', sans-serif";
  ctx.fillText("ALL-UP WEIGHT SPLIT", bx, by-8);
}
function drawRunThumb(cv, run){
  const ctx = cv.getContext("2d");
  chartFrame(ctx, cv.width, cv.height);
  if(run.points2) drawSeries(ctx, cv.width, cv.height, run.points2, "#c65d3b", null);
  drawSeries(ctx, cv.width, cv.height, run.points, "#4f6d9e", "rgba(79,109,158,.08)");
}
/* generic XY plotter for the charts modal */
function plotXY(cv, series, opts){
  opts = opts || {};
  const ctx = cv.getContext("2d"), w = cv.width, h = cv.height;
  const padL=44, padB=28, padT=12, padR=14;
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle="#fbfcfc"; ctx.fillRect(0,0,w,h);
  const xs = series[0].x;
  const xmin = opts.xmin!=null?opts.xmin:Math.min(...xs), xmax = opts.xmax!=null?opts.xmax:Math.max(...xs);
  let ymax = opts.ymax || Math.max(...series.flatMap(s=>s.y))*1.12 || 1;
  let ymin = opts.ymin!=null?opts.ymin:0;
  const X = v => padL + (v-xmin)/((xmax-xmin)||1)*(w-padL-padR);
  const Y = v => h-padB - (v-ymin)/((ymax-ymin)||1)*(h-padT-padB);
  ctx.strokeStyle="#e7edeb"; ctx.lineWidth=1; ctx.fillStyle="#8b9a95"; ctx.font="10px 'IBM Plex Mono'";
  for(let i=0;i<=4;i++){ const yy=ymin+(ymax-ymin)*i/4; const py=Y(yy);
    ctx.beginPath();ctx.moveTo(padL,py);ctx.lineTo(w-padR,py);ctx.stroke();
    ctx.textAlign="right"; ctx.fillText(yy.toFixed(ymax<10?1:0), padL-5, py+3); }
  ctx.textAlign="center";
  for(let i=0;i<=4;i++){ const xx=xmin+(xmax-xmin)*i/4; ctx.fillText(xx.toFixed(xmax<10?1:0), X(xx), h-padB+15); }
  ctx.fillStyle="#5c6d68"; ctx.font="600 10px 'IBM Plex Sans'"; ctx.textAlign="center";
  if(opts.xlabel) ctx.fillText(opts.xlabel, (padL+w-padR)/2, h-4);
  series.forEach(s=>{
    ctx.beginPath();
    s.x.forEach((xv,i)=> i?ctx.lineTo(X(xv),Y(s.y[i])):ctx.moveTo(X(xv),Y(s.y[i])));
    ctx.strokeStyle=s.color; ctx.lineWidth=2.2; ctx.lineJoin="round"; ctx.stroke();
  });
  if(opts.marker){
    ctx.beginPath(); ctx.arc(X(opts.marker.x), Y(opts.marker.y), 5, 0, Math.PI*2);
    ctx.fillStyle = opts.marker.color||"#c65d3b"; ctx.fill();
    ctx.lineWidth=2; ctx.strokeStyle="#fff"; ctx.stroke();
  }
}
/* ════════════ 10 · FLOATING WINDOWS ════════════ */
function openModal(title, dotColor, footHTML){
  $("modalTitle").innerHTML = title;
  $("modalDot").style.background = dotColor;
  const foot = $("modalFoot");
  if(footHTML){ foot.innerHTML = footHTML; foot.hidden = false; } else foot.hidden = true;
  $("modalBody").innerHTML = "";
  $("modalOverlay").hidden = false;
  document.body.style.overflow = "hidden";
  return $("modalBody");
}
function closeModal(){
  $("modalOverlay").hidden = true;
  $("modalBody").innerHTML = "";
  document.body.style.overflow = "";
}
function openPicker(catKey){
  const c = cat(catKey); if(!c) return;
  const multi = !!c.multi;
  const body = openModal(txt(c.label)+' <em>· option library'+(multi?' · multi-select':'')+'</em>', "#1f3a93",
    (multi?'tap options to attach / detach — multiple attachments allowed · ':'')+
    'options are folder-driven — drop a folder with <b>spec.json</b> + model under <b>assets/'+txt(c.key)+'/</b> and list it in <b>assets/manifest.json</b>');
  const grid = el("div","pick-grid"); body.appendChild(grid);
  const build = ()=>{
    grid.innerHTML = "";
    c.options.forEach(o=>{
      const selected = multi ? selArr(catKey).includes(o.id) : state.sel[catKey] === o.id;
      const card = el("button","pick-opt"+(selected?" selected":"")); card.type = "button";
      let specs = o.specs.map(s=>'<div><span class="k">'+txt(s[0])+'</span><span class="v">'+txt(s[1])+'</span></div>').join("");
      if(o.size) specs += '<div><span class="k">Size</span><span class="v">'+o.size.join(" × ")+' mm</span></div>';
      specs += '<div class="mass"><span class="k">Mass</span><span class="v">'+fmtMass(o.mass)+(o.qty>1?" × "+o.qty:"")+'</span></div>';
      card.innerHTML =
        '<div class="top"><span class="name">'+txt(o.name)+'</span><span class="check">'+(selected?(multi?"✓ attached":"✓ selected"):"")+'</span></div>'+
        '<div class="view"><canvas width="200" height="110"></canvas></div>'+
        '<div class="specs">'+specs+'</div>';
      card.addEventListener("click", ()=>{
        if(multi){ const arr = selArr(catKey);
          state.sel[catKey] = arr.includes(o.id) ? arr.filter(x=>x!==o.id) : arr.concat(o.id);
        }else state.sel[catKey] = o.id;
        refreshAfterSelection(catKey); instrEvent("select"); sfx("tick"); build();
      });
      grid.appendChild(card);
      registerPreview(card.querySelector("canvas"), o);
    });
  };
  build(); instrEvent("picker");
}
function openMassDetail(){
  const body = openModal("Detailed Mass Budget", "#1f3a93");
  const { rows, total } = massRows(); const model = getModel();
  const wrap = el("div","mass-table");
  wrap.innerHTML = '<div class="mass-thead"><span>Component</span><span>Selection</span><span>Qty</span><span>Subtotal</span></div>';
  rows.forEach(r=>{
    const d = el("div","mass-trow");
    d.innerHTML =
      '<span class="comp">'+txt(r.label)+'</span>'+
      '<div><div class="selname">'+txt(r.name)+'</div><div class="bar"><i style="width:'+Math.round(r.frac*100)+'%"></i></div></div>'+
      '<span class="qty">×'+r.qty+'</span>'+
      '<span class="sub">'+fmtMass(r.mass)+'</span>';
    wrap.appendChild(d);
  });
  const grand = el("div","mass-grand");
  grand.innerHTML = '<span>TOTAL DRONE MASS <em>(AUW)</em></span><b>'+(total/1000).toFixed(2)+' kg</b>';
  wrap.appendChild(grand);
  const note = el("p","mass-note"); const good = model.balanced;
  note.innerHTML = 'Centre of gravity offset with this build: <b class="'+(good?"good":"warn")+'">'+model.cog.r_mm.toFixed(1)+' mm</b> — '+
    (good ? "within the "+model.tolerance_mm+" mm tolerance; the drone is balanced."
          : "exceeds the "+model.tolerance_mm+" mm tolerance — slide the battery / payload in the Placement panel to recentre.");
  wrap.appendChild(note); body.appendChild(wrap);
}
function openGraphsAll(){
  const body = openModal('Experiment Graphs <em>· all recorded runs</em>', "#4f6d9e");
  if(!state.history.length){
    body.appendChild(el("div","runs-empty",
      'No recorded runs yet.<br>Press <b>▶ Run Sim</b> in the viewport — every run is stored here per experiment.'));
    return;
  }
  const grid = el("div","runs-grid"); body.appendChild(grid);
  state.history.slice().reverse().forEach(run=>{
    const card = el("div","run-card");
    card.innerHTML =
      '<div class="top"><span class="name">'+txt(run.name)+'</span><span class="when">'+txt(run.when)+'</span></div>'+
      '<canvas width="420" height="180"></canvas>'+
      '<div class="foot"><span>'+txt(run.moduleTxt)+'</span><b>'+(run.verdict?txt(run.verdict)+' · ':'')+'peak '+run.peak.toFixed(2)+' '+txt(run.unit)+'</b></div>';
    grid.appendChild(card);
    drawRunThumb(card.querySelector("canvas"), run);
  });
}
/* rich charts modal — mass distribution + (Module 2) cantilever stress breakdown,
   computed live from the current LAB model. */
function openChartsDetail(){
  const body = openModal('Charts <em>· mass distribution &amp; structural margins</em>', "#c65d3b");
  const model = getModel();
  const wrap = el("div","calc-blocks");

  const tiles = el("div","metric-tiles");
  const mt = (k,v,cls)=>'<div class="metric-tile"><span class="mk">'+k+'</span><span class="mv '+(cls||"")+'">'+v+'</span></div>';
  tiles.innerHTML =
    mt("All-up weight", (model.totalMass_g/1000).toFixed(2)+" kg") +
    mt("CoG offset", model.cog.r_mm.toFixed(1)+" mm", model.balanced?"good":"warn") +
    mt("Frame material", model.frame.material.label) +
    mt("Arm length", model.frame.arm_length_mm.toFixed(0)+" mm");
  wrap.appendChild(tiles);

  const b1 = el("div","calc-block");
  b1.innerHTML = '<h3>Mass distribution</h3><canvas width="640" height="230" style="width:100%;border-radius:7px;background:#fbfcfc"></canvas>';
  wrap.appendChild(b1); drawMassChartOn(b1.querySelector("canvas"));

  if(window.CANTILEVER && typeof window.CANTILEVER.solve === "function"){
    let solved; try{ solved = window.CANTILEVER.solve(model); }catch(e){ solved = null; }
    if(solved){
      const b2 = el("div","calc-block");
      b2.innerHTML = '<h3>Cantilever arm — bending &amp; stress</h3>'+
        '<pre>Tip load F = '+solved.force_N.toFixed(2)+' N (thrust '+solved.forceBreakdown.thrust_N.toFixed(2)+' N + motor/prop weight '+solved.forceBreakdown.weight_N.toFixed(2)+' N)\n'+
        'Bending moment M = F·L = '+solved.moment_max_Nm.toFixed(3)+' N·m\n'+
        'Root stress σ = M·c/I = '+solved.stress_mpa.toFixed(1)+' MPa (yield '+solved.yield_mpa+' MPa)\n'+
        'Tip deflection δ = '+solved.deflection_mm.toFixed(2)+' mm · 1st bending mode f₁ = '+solved.firstBendingMode_hz.toFixed(0)+' Hz</pre>'+
        '<div class="res">SF = '+(solved.safetyFactor>=90?"∞":solved.safetyFactor.toFixed(2))+' — '+solved.verdict+'</div>';
      wrap.appendChild(b2);
    }
  }

  wrap.appendChild(el("p","calc-footnote",
    "Mass distribution recomputes live from the selected components. Arm stress uses the Euler–Bernoulli cantilever model in js/cantilever.js: hollow-rectangular I = (b·h³ − (b−2t)(h−2t)³)/12, σ = M·c/I, SF = σ_yield/σ."));
  body.appendChild(wrap);
}
function openCalcDetail(){
  const body = openModal("Detailed Calculations", "#c65d3b");
  const model = getModel();
  const armLabels = ["FR","FL","RL","RR"];
  const armTxt = model.arms.map((a,i)=>armLabels[i]+": share "+(a.loadShare*100).toFixed(1)+"%  ·  "+a.loadForce_N.toFixed(2)+" N").join("\n");
  const blocks = [
    { t:"1 · All-up weight", b:"AUW = Σ (part.mass_g × qty) over every unit (4 motors, 4 props, esc(s), movables)", r:"AUW = "+model.totalMass_g.toFixed(0)+" g  ("+(model.totalMass_g/1000).toFixed(3)+" kg)" },
    { t:"2 · Centre of gravity", b:"x_cg = Σ(m·x)/Σm\ny_cg = Σ(m·y)/Σm\nr_cg = √(x_cg² + y_cg²)", r:"x_cg = "+model.cog.x_mm.toFixed(2)+" mm · y_cg = "+model.cog.y_mm.toFixed(2)+" mm · r_cg = "+model.cog.r_mm.toFixed(2)+" mm" },
    { t:"3 · Balance verdict", b:"pass condition: r_cg ≤ tolerance ("+model.tolerance_mm+" mm)", r: model.balanced ? "BALANCED" : "OFFSET — "+(model.cog.r_mm-model.tolerance_mm).toFixed(1)+" mm over tolerance" },
    { t:"4 · Per-arm load share (rigid-plate bilinear reaction)", b:armTxt, r:"Σ share = 100 %" }
  ];
  if(window.CANTILEVER && typeof window.CANTILEVER.solve === "function"){
    let solved; try{ solved = window.CANTILEVER.solve(model); }catch(e){ solved = null; }
    if(solved){
      blocks.push({ t:"5 · Cantilever arm stress", b:"M = F·L = "+solved.moment_max_Nm.toFixed(3)+" N·m\nσ = M·c/I = "+solved.stress_mpa.toFixed(1)+" MPa vs yield "+solved.yield_mpa+" MPa", r:"SF = "+(solved.safetyFactor>=90?"∞":solved.safetyFactor.toFixed(2))+" — "+solved.verdict });
    }
  }
  const wrap = el("div","calc-blocks");
  blocks.forEach(bl=>{
    const d = el("div","calc-block");
    d.innerHTML = '<h3>'+bl.t+'</h3><pre>'+bl.b+'</pre><div class="res">'+bl.r+'</div>';
    wrap.appendChild(d);
  });
  wrap.appendChild(el("p","calc-footnote",
    "All values recompute live from the current selections, slider placement and frame material. CoG + per-arm load physics per BUILD_SPEC §3; cantilever stress per js/cantilever.js."));
  body.appendChild(wrap);
}

/* ════════════ 11 · SIMULATION RUNNER ════════════
   M1 "balance settling": a short animation that tilts the assembled drone
   gently toward its CoG offset, then verdicts PASS/FAIL against the 10 mm
   tolerance (BUILD_SPEC item H).
   M2 "load ramp": ramps the arm's tip load 0→100% over ~4 s via
   window.CANTILEVER.step(t), updating the HUD/telemetry/charts every frame,
   then verdicts from CANTILEVER.solve().pass and fills the SF matrix. */
const SIM_DURATION_M1 = 2.5;   // seconds — CoG settling animation
const SIM_DURATION_M2 = 4.0;   // seconds — 0→100% load ramp
let simActive = false;
const sim = { t:0, data:[], data2:[], key:null, exp:null, mod:null, verdict:null, verdictOk:false, audioLoad:0 };

function runSim(){
  if(simActive){ stopSim(false); return; }
  const dg = renderLog();
  if(dg.blocked){
    sfx("error");
    // flash the log to draw attention
    const lc = $("logCard"); lc.animate([{transform:"translateX(0)"},{transform:"translateX(-4px)"},{transform:"translateX(4px)"},{transform:"translateX(0)"}], {duration:280});
    return;
  }
  const { mod, exp } = currentExp();
  simActive = true; state.simRunning = true;
  sim.t = 0; sim.data = []; sim.data2 = []; sim.exp = exp; sim.mod = mod;
  sim.key = mod.id+":"+exp.id; sim.verdict = null; sim.verdictOk = false; sim.audioLoad = 0;
  syncRunControls();
  audioStart();
  $("runBtn").textContent = "■ Stop";
  $("runBtn").classList.add("running");
  $("telDot").classList.add("on");
  sfx("start"); instrEvent("run");
}
function stopSim(completed){
  simActive = false; state.simRunning = false;
  $("runBtn").textContent = "▶ Run Sim";
  $("runBtn").classList.remove("running");
  $("telDot").classList.remove("on");
  audioStop();
  if(rig){ rig.rotation.x = 0; rig.rotation.z = 0; }
  if(completed && sim.data.length){
    const stride = Math.max(1, Math.ceil(sim.data.length/80));
    const pts = sim.data.filter((_,i)=> i % stride === 0);
    const pts2 = sim.data2.length ? sim.data2.filter((_,i)=> i % stride === 0) : null;
    state.done[sim.key] = true;
    state.history.push({
      key:sim.key, name:sim.exp.name, unit:sim.exp.unit,
      moduleTxt:sim.mod.label+" · "+sim.mod.sub, verdict:sim.verdict,
      when:new Date().toLocaleString([], {month:"short", day:"numeric", hour:"2-digit", minute:"2-digit"}),
      peak:pts.length?Math.max(...pts):0, points:pts, points2:pts2
    });
    saveState();
    renderModuleTabs(); renderExpTabs(); renderProgress();
    sfx("done");
    if(sim.verdict){ showVerdictToast(sim.verdict, sim.verdictOk); playFaultVoice(sim.verdict, sim.verdictOk); }
    if(allDone()){ renderReward(); instrGo(DRONE_DB.instructor.length-1); sfx("unlock"); }
    else instrEvent("runDone");
  }
  glueModelViews();   // restores standby telemetry from the current model
  drawLiveGraph();
}
function resetSim(){
  if(simActive) stopSim(false);
  sim.data = []; sim.data2 = [];
  syncRunControls();
  glueModelViews();
  drawLiveGraph();
}
/* No operator controls (throttle / flight mode) in the structural lab — kept
   as a hook so module/experiment switches have a single place to resync any
   future run-time controls. */
function syncRunControls(){}
function showVerdictToast(text, ok){
  const t = el("div","verdict "+(ok?"pass":"fail"));
  t.style.cssText = "position:fixed;left:50%;top:74px;transform:translateX(-50%);z-index:120;box-shadow:0 10px 30px rgba(20,40,40,.25);max-width:440px";
  t.innerHTML = '<span class="vic">'+(ok?"✓":"×")+'</span><div class="vtx"><b>'+txt(text.split("—")[0])+'</b><span>'+txt(text.split("—").slice(1).join("—").trim())+'</span></div>';
  document.body.appendChild(t);
  setTimeout(()=>{ t.style.transition="opacity .5s"; t.style.opacity="0"; setTimeout(()=>t.remove(),500); }, 3600);
}

/* M1 — gentle tilt toward the CoG offset direction, settling over SIM_DURATION_M1 */
function simStepM1(dt){
  sim.t += dt;
  const model = getModel();
  const armLabels = ["FR","FL","RL","RR"];
  const maxArm = model.arms.reduce((a,b)=> (b.loadShare>a.loadShare?b:a), model.arms[0]||{loadShare:0.25,index:0});
  const k = Math.min(sim.t/SIM_DURATION_M1, 1);
  const settle = Math.sin(k*Math.PI/2) * (1 - k*0.15);          // eases in, relaxes a touch at the end
  const maxTiltRad = (6*Math.PI/180) * Math.min(model.cog.r_mm/model.tolerance_mm, 3)/3;
  if(rig){
    const dirRad = Math.atan2(model.cog.y_mm, model.cog.x_mm);
    rig.rotation.z = -Math.cos(dirRad) * maxTiltRad * settle;
    rig.rotation.x =  Math.sin(dirRad) * maxTiltRad * settle;
  }
  sim.data.push(model.cog.r_mm);
  sim.audioLoad = k;
  updateTelemetry({
    mass: model.totalMass_g, cogX: model.cog.x_mm, cogY: model.cog.y_mm, cogR: model.cog.r_mm,
    armLoad: armLabels[maxArm.index||0]+" "+(maxArm.loadShare*100).toFixed(1)+"%",
    verdict: "SETTLING…", phase:"BALANCE SETTLING · "+Math.round(k*100)+"%", phaseCls:""
  });
  if(sim.t >= SIM_DURATION_M1){
    if(rig){ rig.rotation.x = 0; rig.rotation.z = 0; }
    sim.verdictOk = model.balanced;
    sim.verdict = model.balanced
      ? "CoG balanced — r_cg "+model.cog.r_mm.toFixed(1)+" mm within "+model.tolerance_mm+" mm tolerance"
      : "r_cg = "+model.cog.r_mm.toFixed(1)+" mm — exceeds the "+model.tolerance_mm+" mm tolerance";
    updateTelemetry({
      mass: model.totalMass_g, cogX: model.cog.x_mm, cogY: model.cog.y_mm, cogR: model.cog.r_mm,
      armLoad: armLabels[maxArm.index||0]+" "+(maxArm.loadShare*100).toFixed(1)+"%",
      verdict: sim.verdictOk ? "PASS · CoG balanced" : "FAIL · r_cg "+model.cog.r_mm.toFixed(1)+"mm",
      phase: sim.verdictOk?"DONE · BALANCED":"DONE · OFFSET", phaseCls: sim.verdictOk?"good":"warn"
    });
    stopSim(true);
  }
}
/* M2 — ramp the tip load 0→100% via CANTILEVER.step(t), fill charts + SF matrix */
function simStepM2(dt){
  sim.t += dt;
  const model = getModel();
  const t = Math.min(sim.t/SIM_DURATION_M2, 1);
  let telem = { load_pct:t*100, stress_mpa:0, sf:99, deflection_mm:0 };
  if(window.CANTILEVER && typeof window.CANTILEVER.step === "function"){
    try{ telem = window.CANTILEVER.step(t); }catch(e){ console.warn("[CANTILEVER] step failed:", e); }
  }
  sim.data.push(telem.stress_mpa||0);
  sim.data2.push(telem.sf||0);
  sim.audioLoad = t;
  const sfCls = telem.sf>=2 ? "good" : telem.sf>=1 ? "" : "warn";
  updateTelemetry({
    mass: model.totalMass_g, cogX: model.cog.x_mm, cogY: model.cog.y_mm, cogR: model.cog.r_mm,
    armLoad:"load "+Math.round(telem.load_pct)+"%",
    verdict: (telem.sf>=90?"∞":(telem.sf||0).toFixed(2))+" SF", phaseCls: sfCls,
    phase:"LOAD RAMP · "+Math.round(telem.load_pct)+"%"
  });
  if(state.module === "m2" && window.CANTILEVER && typeof window.CANTILEVER.drawCharts === "function"){
    try{ window.CANTILEVER.drawCharts({ sfdCanvas:$("sfdCanvas"), bmdCanvas:$("bmdCanvas"), stressBarCanvas:$("stressBarCanvas"), model }); }
    catch(e){ /* charts are best-effort during the ramp */ }
  }
  if(sim.t >= SIM_DURATION_M2){
    let solved = null;
    if(window.CANTILEVER && typeof window.CANTILEVER.solve === "function"){
      try{ solved = window.CANTILEVER.solve(model); }catch(e){ solved = null; }
    }
    sim.verdictOk = solved ? solved.pass : true;
    sim.verdict = solved
      ? (solved.pass
          ? "Arm survives — SF "+(solved.safetyFactor>=90?"∞":solved.safetyFactor.toFixed(2))+" ("+solved.verdict+")"
          : "Arm fails — SF "+solved.safetyFactor.toFixed(2)+" under the motor's tip load")
      : "Structural solve unavailable";
    updateTelemetry({
      mass: model.totalMass_g, cogX: model.cog.x_mm, cogY: model.cog.y_mm, cogR: model.cog.r_mm,
      armLoad:"load 100%", verdict: sim.verdictOk ? "PASS" : "FAIL",
      phase: sim.verdictOk?"DONE · PASS":"DONE · FAIL", phaseCls: sim.verdictOk?"good":"warn"
    });
    renderCalcChips(); renderSfMatrix();
    stopSim(true);
  }
}
function simStep(dt){
  if(state.module === "m2") simStepM2(dt); else simStepM1(dt);
}

/* ════════════ 12 · PROCEDURAL AUDIO ENGINE ════════════ */
let actx = null, aMaster = null, noiseBuf = null;
let engine = null;   // active engine nodes
function ac(){
  if(!actx){
    actx = new (window.AudioContext||window.webkitAudioContext)();
    aMaster = actx.createGain(); aMaster.gain.value = state.sfxVol/100; aMaster.connect(actx.destination);
    const n = actx.sampleRate*2, b = actx.createBuffer(1,n,actx.sampleRate), ch = b.getChannelData(0);
    for(let i=0;i<n;i++) ch[i] = Math.random()*2-1;
    noiseBuf = b;
  }
  if(actx.state === "suspended") actx.resume();
  return actx;
}
function setMasterVol(){ if(aMaster) aMaster.gain.value = state.sfxVol/100; }
/* short confirmation chirp on the VOICE bus — bypasses aMaster so it reflects the
   speaker level regardless of the SFX gain (used as feedback when the user drags
   the speaker slider). */
function voiceBlip(){
  if(state.voiceVol<=0) return;
  try{
    const ctx = ac();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "triangle"; o.frequency.value = 523;
    const vol = Math.min(state.voiceVol/100,1)*0.22;
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(vol, ctx.currentTime+.02);
    g.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime+.18);
    o.connect(g); g.connect(ctx.destination);       // bypass SFX master bus
    o.start(); o.stop(ctx.currentTime+.22);
  }catch(e){}
}
/* short UI tones */
function tone(freq, t0, dur, gain, type){
  const ctx = ac();
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type||"sine"; o.frequency.value = freq;
  g.gain.setValueAtTime(0, ctx.currentTime+t0);
  g.gain.linearRampToValueAtTime(gain, ctx.currentTime+t0+.02);
  g.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime+t0+dur);
  o.connect(g); g.connect(aMaster);
  o.start(ctx.currentTime+t0); o.stop(ctx.currentTime+t0+dur+.05);
}
const SFX_FILES = {
  tick:"assets/audio/sfx/click.mp3", start:"assets/audio/sfx/start.mp3", done:"assets/audio/sfx/success.mp3",
  error:"assets/audio/sfx/error.mp3", unlock:"assets/audio/sfx/lock.mp3", warn:"assets/audio/sfx/warn.mp3"
};
function sfx(kind){
  if(state.sfxVol<=0) return;
  const v = state.sfxVol/100;
  const file = SFX_FILES[kind];
  if(file){
    try{ const a = new Audio(file); a.volume = Math.min(v,1); a.play().catch(()=>toneFallback(kind)); return; }catch(e){}
  }
  toneFallback(kind);
}
function toneFallback(kind){
  const v = .22;
  try{
    if(kind==="tick") tone(880,0,.07,v);
    else if(kind==="start"){ tone(392,0,.09,v); tone(587,.09,.12,v); }
    else if(kind==="done"){ tone(660,0,.1,v); tone(880,.12,.18,v); }
    else if(kind==="error"){ tone(200,0,.12,v,"square"); tone(150,.12,.18,v,"square"); }
    else if(kind==="unlock"){ [523,659,784,1047].forEach((f,i)=>tone(f,i*.13,.22,v)); }
  }catch(e){}
}
/* fault / result voice-over — plays the matching real clip against the verdict text */
const VOICE_FILES = {
  overcurrent:"assets/audio/voice/fault_overcurrent.mp3",
  esc_burnt:"assets/audio/voice/fault_esc_burnt.mp3",
  winding_overheat:"assets/audio/voice/fault_winding_overheat.mp3",
  motor_stall:"assets/audio/voice/fault_motor_stall.mp3",
  thrust_deficit:"assets/audio/voice/fault_thrust_deficit.mp3",
  critical:"assets/audio/voice/fault_critical.mp3",
  actuator_stall:"assets/audio/voice/fault_actuator_stall.mp3",
  hover_reached:"assets/audio/voice/done_hover_reached.mp3",
  landed_safely:"assets/audio/voice/done_landed_safely.mp3",
  profiling_complete:"assets/audio/voice/done_profiling_complete.mp3"
};
const INTRO_FILES = {
  "m1:balance":"assets/audio/voice/intro_assembly.mp3",
  "m2:stress":"assets/audio/voice/intro_kv_profiling.mp3"
};
// Single voice channel: only one clip plays at a time, so swiftly switching
// tabs never overlaps. `lastVoiceUrl` lets the instructor's Replay button
// replay whatever last spoke.
let currentVoice = null, lastVoiceUrl = null;
function stopVoice(){
  if(currentVoice){ try{ currentVoice.pause(); currentVoice.currentTime = 0; }catch(e){} currentVoice = null; }
}
function playVoiceFile(url){
  if(!url) return;
  lastVoiceUrl = url;                 // remembered even when muted, for Replay
  if(state.voiceVol<=0) return;
  stopVoice();                        // cut any clip still playing → no overlap
  try{
    const a = new Audio(url);
    a.volume = Math.min(state.voiceVol/100,1);
    currentVoice = a;
    a.addEventListener("ended", ()=>{ if(currentVoice===a) currentVoice = null; });
    a.play().catch(()=>{});
  }catch(e){}
}
function playIntroVoice(key){ if(INTRO_FILES[key]) playVoiceFile(INTRO_FILES[key]); }
function currentIntroKey(){ return state.module + ":" + state.exp[state.module]; }
function playFaultVoice(text, ok){
  const t = (text||"").toLowerCase();
  let tag = null;
  if(ok){ if(t.includes("balanced")) tag="hover_reached";
    else if(t.includes("survives")) tag="profiling_complete"; }
  else{ if(t.includes("fails")) tag="critical";
    else if(t.includes("offset")||t.includes("exceeds")) tag="thrust_deficit"; }
  if(tag && VOICE_FILES[tag]) playVoiceFile(VOICE_FILES[tag]);
}
/* realistic motor / propeller engine — frequency tracks RPM, level tracks thrust */
function audioStart(){
  if(state.sfxVol<=0) return;
  try{
    const ctx = ac();
    audioStopNow();
    const g = ctx.createGain(); g.gain.value = 0; g.connect(aMaster);
    // low rumble (shaft)
    const rumble = ctx.createOscillator(); rumble.type="sawtooth";
    const rumbleG = ctx.createGain(); rumbleG.gain.value=.14; rumble.connect(rumbleG); rumbleG.connect(g);
    // blade-passage whine
    const whine = ctx.createOscillator(); whine.type="square";
    const whineF = ctx.createBiquadFilter(); whineF.type="lowpass"; whineF.frequency.value=2600;
    const whineG = ctx.createGain(); whineG.gain.value=.05; whine.connect(whineF); whineF.connect(whineG); whineG.connect(g);
    // air / broadband via band-passed noise
    const noise = ctx.createBufferSource(); noise.buffer=noiseBuf; noise.loop=true;
    const bp = ctx.createBiquadFilter(); bp.type="bandpass"; bp.frequency.value=900; bp.Q.value=3;
    const noiseG = ctx.createGain(); noiseG.gain.value=.12; noise.connect(bp); bp.connect(noiseG); noiseG.connect(g);
    rumble.start(); whine.start(); noise.start();
    engine = { g, rumble, whine, whineF, noise, bp, cur:0 };
    // spool-up
    g.gain.setTargetAtTime(.9, ctx.currentTime, .25);
  }catch(e){}
}
function audioStopNow(){
  if(!engine) return;
  try{ engine.rumble.stop(); engine.whine.stop(); engine.noise.stop(); }catch(e){}
  engine = null;
}
function audioStop(){
  if(!engine || !actx) return;
  const e = engine, t = actx.currentTime;
  e.g.gain.setTargetAtTime(0, t, .18);
  const dead = e;
  setTimeout(()=>{ try{ dead.rumble.stop(); dead.whine.stop(); dead.noise.stop(); }catch(x){} }, 500);
  if(engine === e) engine = null;
}
/* Generic run-progress hum — no propulsion RPM in this lab, so frequency/level
   simply track sim.audioLoad (0..1): the CoG-settle progress in M1, the tip-load
   ramp in M2. */
function audioUpdate(){
  if(!engine || !actx) return;
  const ctx = actx;
  const target = Math.max(0, Math.min(1, sim.audioLoad||0));
  engine.cur = engine.cur + (target - engine.cur)*0.12;
  const rev = 30 + engine.cur*70;             // shaft-like rev/s sweep
  const blade = rev * 2.2;
  engine.rumble.frequency.setTargetAtTime(rev, ctx.currentTime, .05);
  engine.whine.frequency.setTargetAtTime(blade, ctx.currentTime, .05);
  engine.bp.frequency.setTargetAtTime(Math.min(400+blade*1.4, 5200), ctx.currentTime, .05);
  const lvl = 0.3 + engine.cur*0.6;
  engine.g.gain.setTargetAtTime(lvl, ctx.currentTime, .08);
}

/* ════════════ 13 · INSTRUCTOR ════════════ */
function playVoice(){
  const step = DRONE_DB.instructor[state.instrStep];
  if(step && step.audio){ playVoiceFile(step.audio); return; }   // single channel
  if(state.voiceVol<=0) return;
  try{ [392,494,587].forEach((f,i)=>tone(f, i*.16, .2, (state.voiceVol/100)*.18, "triangle")); }catch(e){}
}
// Replay the last clip that spoke (tab intro / fault / step). If nothing has
// spoken yet, replay the current experiment's intro so the button always works.
function replayVoice(){ playVoiceFile(lastVoiceUrl || INTRO_FILES[currentIntroKey()]); }
function renderInstr(){
  const steps = DRONE_DB.instructor;
  $("instrText").textContent = steps[state.instrStep].text;
  $("instrStepTxt").textContent = "step "+(state.instrStep+1)+" / "+steps.length;
  $("instrPanel").hidden = !state.instrOpen;
}
function instrGo(n){
  state.instrStep = Math.max(0, Math.min(n, DRONE_DB.instructor.length-1));
  saveState(); renderInstr();
}
function instrEvent(evt){
  const map = { picker:1, select:2, run:3, runDone:4 };
  const target = map[evt];
  if(target != null && state.instrStep < target){ instrGo(target); playVoice(); }
}

/* ════════════ 14 · WIRING + BOOT ════════════ */
document.querySelectorAll("#tabbar button").forEach(b=>{
  b.addEventListener("click", ()=>{
    document.querySelectorAll("#tabbar button").forEach(x=>x.classList.toggle("active", x===b));
    const target = $(b.dataset.target);
    if(target) window.scrollTo({ top: target.offsetTop - 6, behavior:"smooth" });
  });
});
$("modalClose").addEventListener("click", closeModal);
$("modalOverlay").addEventListener("click", e=>{ if(e.target === $("modalOverlay")) closeModal(); });
document.addEventListener("keydown", e=>{ if(e.key==="Escape" && !$("modalOverlay").hidden) closeModal(); });

let lastT = 0, graphEvery = 0;
function loop(t){
  requestAnimationFrame(loop);
  frameNo++;
  const dt = Math.min((t-lastT)/1000, .05) || .016;
  lastT = t;
  if(rig){
    hoverPhase += .02;
    // Module 1 assembly view — gentle hover bob (settling tilt is driven
    // separately by simStepM1 on rig.rotation while a run is active) so the
    // user can inspect/orbit the assembled drone freely otherwise. The
    // assembled drone RESTS ON THE GROUND whenever the simulation is idle,
    // and only lifts to hover height while a run is active.
    let targetY;
    if(!simActive){
      // seat the drone's lowest point on the grid (world y = 0)
      const box = new THREE.Box3().setFromObject(rig);
      targetY = rig.position.y - box.min.y;
    }else{
      targetY = 1.15 + Math.sin(hoverPhase)*.03;
    }
    // smooth take-off / landing lerp
    rig.position.y += (targetY - rig.position.y) * (simActive?0.12:0.18);
    // props are stationary when the drone is landed / powered down
    const spin = (simActive && state.module==="m1") ? Math.min((sim.audioLoad||0)*3 + .15, 3.4) : 0;
    propGroups.forEach((p,i)=>{
      const dir = p.userData.spinDir != null ? p.userData.spinDir : (i%2?1:-1);
      p.rotation.y += spin*dir;
    });
  }
  if(simActive){
    simStep(dt);
    audioUpdate();
    if(++graphEvery % 3 === 0) drawLiveGraph();
  }
  FX.tick(dt);
  blitPreviews();
  if(controls) controls.update();
  if(renderer) renderer.render(scene, camera);
}

function hideBoot(){
  const o = $("bootOverlay");
  if(o){ o.classList.add("gone"); setTimeout(()=>o.remove(), 500); }
}
async function boot(){
  try{ await loadCatalog(); }
  catch(e){ console.error("Catalog failed to load:", e); bootProgress("failed to load catalog", 1); return; }
  bootProgress("initialising lab…", .8);
  loadState();
  initPreviewEngine();
  initViewport();
  renderTiles();
  renderMassMini();
  syncModuleUI();
  renderModuleTabs();
  renderExpTabs();
  renderProgress();
  renderMaterialPicker();
  renderSliders();
  renderCalcChips();
  renderLog();
  renderReward();
  renderInstr();
  syncRunControls();
  drawLiveGraph();
  drawMassChart();
  window.LAB.onModelChange(glueModelViews);   // BUILD_SPEC item G — glue after every rebuild
  glueModelViews();
  $("voiceVol").value = state.voiceVol; $("voiceVolTxt").textContent = state.voiceVol;
  $("sfxVol").value = state.sfxVol; $("sfxVolTxt").textContent = state.sfxVol;
  $("massCard").addEventListener("click", openMassDetail);
  $("calcCard").addEventListener("click", openCalcDetail);
  $("logHead").addEventListener("click", openChartsDetail);
  $("graphCard").addEventListener("click", openGraphsAll);
  $("chartCard").addEventListener("click", openChartsDetail);
  $("runBtn").addEventListener("click", runSim);
  $("resetBtn").addEventListener("click", resetSim);
  $("instrOrb").addEventListener("click", ()=>{
    state.instrOpen = !state.instrOpen; saveState(); renderInstr();
    if(state.instrOpen) playVoice();
  });
  $("instrPrev").addEventListener("click", ()=>{ instrGo(state.instrStep-1); playVoice(); });
  $("instrNext").addEventListener("click", ()=>{ instrGo(state.instrStep+1); playVoice(); });
  $("instrReplay").addEventListener("click", replayVoice);
  $("voiceVol").addEventListener("input", e=>{
    state.voiceVol = +e.target.value; $("voiceVolTxt").textContent = e.target.value;
    if(currentVoice) currentVoice.volume = Math.min(state.voiceVol/100,1);  // live-adjust a playing clip
    saveState();
  });
  $("voiceVol").addEventListener("change", voiceBlip);                       // audible confirmation on release
  $("sfxVol").addEventListener("input", e=>{
    state.sfxVol = +e.target.value; $("sfxVolTxt").textContent = e.target.value;
    setMasterVol(); saveState();                                            // live-adjust the running engine
  });
  $("sfxVol").addEventListener("change", ()=>sfx("tick"));                   // audible confirmation on release
  window.addEventListener("resize", resizeViewport);
  // Greet on load, best-effort. Most browsers block autoplay until the user
  // interacts, so if this attempt is blocked (the <audio> stays paused) we
  // re-speak the intro on the first gesture — otherwise the on-load greeting
  // already played and we don't repeat it.
  if(state.instrOpen) playIntroVoice(currentIntroKey());
  let audioPrimed = false;
  const primeAudio = ()=>{
    if(audioPrimed) return; audioPrimed = true;
    try{ if(actx && actx.state === "suspended") actx.resume(); }catch(e){}
    if(state.instrOpen && (!currentVoice || currentVoice.paused)) playIntroVoice(currentIntroKey());
  };
  window.addEventListener("pointerdown", primeAudio, { once:true });
  window.addEventListener("keydown", primeAudio, { once:true });
  bootProgress("ready", 1);
  hideBoot();
  requestAnimationFrame(loop);
}
boot();
