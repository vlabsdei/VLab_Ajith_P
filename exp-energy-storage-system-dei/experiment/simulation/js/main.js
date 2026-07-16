/* ════════════════════════════════════════════════════════════════
   ENERGY STORAGE SYSTEM LAB — main.js  (v1)
   Forked from the Drone Technology Lab platform. Data-driven from
   assets/manifest.json + one spec.json per option — same component
   catalog (chassis/prop/motor/esc/battery/controller/receiver), so the
   real assembled-drone physics (calc(), solveQuad, hover flight sim)
   stays available to the energy-storage sub-calcs below.

   MODULES
     M1 Pack Under Load     — Tab1 C-Rating Safety Check (battery-analyzer bench)
                               Tab2 Voltage Sag Under Load (battery-analyzer bench)
     M2 Energy & Endurance  — Tab1 Endurance & Diminishing Returns (assembled-drone hover flight)
                               Tab2 SoC Discharge Mapping (discharge-rig bench)

   Sections
     1  Catalog loader          8  UI rendering
     2  State + persistence     9  2D charts (multi-series)
     3  Utilities + mass        10 Floating windows
     4  Physics engine          11 Simulation runner
     5  Diagnostics / log       12 Procedural audio engine
     6  3D models + sizing      13 Instructor
     7  Viewport / scenes       14 Wiring + boot
   ════════════════════════════════════════════════════════════════ */

/* ════════════ 1 · CATALOG LOADER ════════════ */
let DRONE_DB = null;
const STAND_MODEL = "assets/stand/motor_holder.glb";

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
    reward: {
      name: manifest.reward.name, desc: manifest.reward.desc,
      files: manifest.reward.model ? [manifest.reward.model] : [],
      fallback: { kind: manifest.reward.fallback || "lidar", color: 0x845b23, s: 1 }
    }
  };
}

/* ════════════ 2 · STATE + PERSISTENCE ════════════ */
const LS_KEY = "ess-v1";
const state = {
  sel:{}, altitude:0, module:"m1", exp:{},
  done:{}, voiceVol:80, sfxVol:60, instrStep:0,
  simRunning:false, instrOpen:true, manualThrottle:0
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
  state.altitude = s.altitude != null ? s.altitude : 0;
  state.module = DRONE_DB.modules.some(m=>m.id===s.module) ? s.module : DRONE_DB.modules[0].id;
  DRONE_DB.modules.forEach(m=>{
    const saved = s.exp && s.exp[m.id];
    state.exp[m.id] = m.experiments.some(e=>e.id===saved) ? saved : m.experiments[0].id;
  });
  state.done = s.done || {};
  state.voiceVol = s.voiceVol != null ? s.voiceVol : 80;
  state.sfxVol = s.sfxVol != null ? s.sfxVol : 60;
  state.instrStep = Math.min(s.instrStep || 0, DRONE_DB.instructor.length - 1);
  state.instrOpen = s.instrOpen !== false;
}
function saveState(){
  try{
    localStorage.setItem(LS_KEY, JSON.stringify({
      sel:state.sel, altitude:state.altitude, module:state.module, exp:state.exp,
      done:state.done,
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

/* ════════════ 4 · PHYSICS ENGINE ════════════
   g = 9.80665, ISA density ρ(h) = 1.225(1 − 2.25577e-5·h)^4.25588
   Motor: Ke = 60/(2π·Kv) [V·s/rad], Kt = Ke; I = (V·δ − Ke·ω)/Rm, I0 no-load
   Copper resistance temp coeff α = 0.00393 /°C; iron loss Pfe = k_fe·ω²
   Propeller (UIUC, n rev/s): T = Ct·ρ·n²·D⁴, Q = Cq·ρ·n²·D⁵
   Steady state: torque balance Kt(I − I0) = Q, damped fixed-point
   Battery: OCV = 3.50 + 0.70·SoC V/cell, sag V = OCV − I·R_pack           */
const G = 9.80665;
const ALPHA_CU = 0.00393;        // copper resistance temperature coefficient /°C
const T_AMB = 25;                // ambient °C
const MU_AIR = 1.81e-5;          // dynamic viscosity of air, Pa·s
const rhoAt = h => 1.225 * Math.pow(1 - 2.25577e-5 * Math.max(0, Math.min(11000, h)), 4.25588);
const rhoNow = () => rhoAt(state.altitude);

/* A 4-in-1 ESC is a single board that stacks under the flight controller and
   drives all four motors — versus four single ESCs on the arms. It is detected
   by an explicit flag, a single-unit qty (qty 1 = one board), or its name. */
function escIs4in1(o){
  if(!o) return false;
  if(o.phys && o.phys.form_factor === "4in1") return true;
  if((o.qty || 4) <= 1) return true;
  return /4.?in.?1/i.test((o.id || "") + " " + (o.name || ""));
}

/* `ov` (optional) lets the energy sub-calcs run a "what-if" pack — e.g. a
   different capacity/mass for the endurance-vs-capacity sweep — without
   touching state.sel or any global. Every field defaults to the selected
   battery's real physics; only what the caller overrides changes. */
function propulsionParams(ov){
  const mo = opt("motor"), pr = opt("propeller"), ba = opt("battery"), esc = opt("esc");
  const mp = (mo && mo.phys) || {}, pp = (pr && pr.phys) || {}, bp = (ba && ba.phys) || {}, ep = (esc && esc.phys) || {};
  const dia_in = pp.diameter_in || 8;
  const p = {
    kv: mp.kv || 900, rm20: mp.rm_ohm || 0.1, i0: mp.i0_a || 0.4,
    imax: mp.max_current_a || 30, pmax: mp.max_power_w || 400,
    massMotor: (mo && mo.mass) || 30, motorSize: (mo && mo.size) || [28,25,28],
    D: dia_in * 0.0254, diaIn: dia_in,
    pitchIn: pp.pitch_in || dia_in*0.5, blades: pp.blades || 2, massProp: (pr && pr.mass) || 3,
    ctRaw: pp.ct!=null ? pp.ct : null, cqRaw: pp.cq!=null ? pp.cq : null,
    cells: bp.cells || 4, cap: bp.capacity_mah || 3000, cRating: bp.c_rating || 30,
    cRatingCont: bp.c_rating_cont || bp.c_rating || 30,   // continuous vs burst discharge
    cellIrBase: (bp.cell_ir_mohm || 5) / 1000,
    escCurrentLimit: ep.current_a || 30, rdsOn: ep.rds_on_ohm || 0.0025,
    escMaxCells: ep.max_cells || 6,        // ESC voltage rating (cell count)
    motorMaxCells: mp.max_cells || 6       // motor voltage rating (cell count)
  };
  return ov ? Object.assign(p, ov) : p;
}
/* battery open-circuit voltage per cell (soc 0..1) — nonlinear discharge curve */
const cellOCV = soc => { soc = Math.max(0, Math.min(1, soc)); return 3.50 + 0.70*soc + 0.10*soc*soc*soc; };
/* per-cell internal resistance incl. low-SoC swell */
function cellIR(p, soc){
  soc = Math.max(0.02, Math.min(1, soc==null?1:soc));
  // R_pack = cells × (cell_ir_mohm/1000) per the spec.json — the real per-pack
  // internal resistance every battery option carries, so a genuinely low-C
  // (high-IR) pack sags/heats differently from a high-C (low-IR) one even at
  // the same capacity. Falls back to the old capacity-only proxy only if a
  // spec is missing the field.
  const base = p.cellIrBase || (0.012 * (1500/Math.max(p.cap,200)));
  const swell = 1 + 0.25*Math.exp(5*(0.3 - soc));
  return base*swell;
}
function motorRm(p, tempC){ return p.rm20 * (1 + ALPHA_CU*((tempC==null?20:tempC) - 20)); }

/* BEMT-lite propeller aero coefficients — pitch/diameter + Reynolds + induced-flow corrected */
function propAero(p, omega){
  const pd = Math.max(0.2, Math.min(1.2, p.pitchIn / Math.max(p.diaIn,1)));
  const R = p.D/2, chord = 0.1*p.D;
  const Vtip = Math.max(omega*R, 0.5);
  const rho = rhoNow();
  const Re = Math.max(rho * Vtip * chord / MU_AIR, 1000);
  const reFactor = Math.pow(150000/Re, 0.25);
  const ctStatic = p.ctRaw!=null ? p.ctRaw : 0.115 * pd;
  const cqBase = p.cqRaw!=null ? p.cqRaw : ctStatic * (0.045*reFactor + 0.11*pd);
  const Ji = Math.sqrt(Math.max(2*ctStatic/Math.PI, 0));
  const ctEff = ctStatic;                    // authored Ct is already an empirical hover measurement
  const cqEff = cqBase * (1 + 1.5*Ji*Ji);     // induced-power penalty still raises torque/current/heat
  return { ctEff, cqEff, rho };
}
/* solve steady-state motor+prop point via quadratic torque balance. returns null on stall. */
function calcMotorPoint(duty, V, Rm, Resc, ov){
  const p = propulsionParams(ov);
  if(duty <= 0 || V <= 0) return { rpm:0, omega:0, T:0, Q:0, I:p.i0*0, P:0, Pmech:0, stalled:false };
  Rm = Rm==null ? motorRm(p,20) : Rm;
  const Reff = Rm + (Resc||0);
  const ke = 60/(2*Math.PI*p.kv), kt = ke;
  let omega = Math.max(p.kv * V * duty * Math.PI/30 * 0.7, 15);
  let aero = propAero(p, omega), stalled = false;
  for(let iter=0; iter<12; iter++){
    aero = propAero(p, omega);
    const k = aero.cqEff * aero.rho * p.D*p.D*p.D*p.D*p.D / (4*Math.PI*Math.PI);   // Q = k·ω²
    const a = k, b = kt*ke/Reff, c = -(kt*V*duty/Reff - kt*p.i0);
    const disc = b*b - 4*a*c;
    if(disc < 0 || a <= 0){ stalled = true; omega = 0; break; }
    const next = (-b + Math.sqrt(disc)) / (2*a);
    if(!isFinite(next) || next < 0){ stalled = true; omega = 0; break; }
    omega += (next - omega) * 0.6;
  }
  if(stalled) return { rpm:0, omega:0, T:0, Q:0, I:0, P:0, Pmech:0, stalled:true };
  const n = omega/(2*Math.PI);
  const T = aero.ctEff * aero.rho * n*n * Math.pow(p.D,4);
  const Q = aero.cqEff * aero.rho * n*n * Math.pow(p.D,5);
  const I = Math.min(Q/kt + p.i0, p.imax*1.6);
  const Vterm = Math.max(V*duty - I*Reff, 0);
  return { rpm: n*60, omega, T:Math.max(T,0), Q, I, P: Vterm*I + I*I*Reff, Pmech: Q*omega, stalled:false };
}
/* full quad at throttle d + state-of-charge soc (0..1), incl. pack sag under 4-motor draw.
   `ov` (optional) overrides propulsionParams — used by the endurance-vs-capacity
   sweep to re-solve the real hover physics for a hypothetical pack capacity/mass
   without touching the selected battery. */
function solveQuad(d, soc, ov){
  const p = propulsionParams(ov);
  const s = soc==null?1:soc;
  const rIR = cellIR(p, s), Rpack = p.cells*rIR;
  let V = cellOCV(s)*p.cells, r = calcMotorPoint(d, V, motorRm(p,20), p.rdsOn, ov);
  for(let k=0;k<6;k++){
    V = Math.max(cellOCV(s)*p.cells - 4*r.I*Rpack, p.cells*2.8);
    r = calcMotorPoint(d, V, motorRm(p,20), p.rdsOn, ov);
  }
  return { rpm:r.rpm, omega:r.omega, Tper:r.T, Ttot:4*r.T, Iper:r.I, Itot:4*r.I,
           V, P:V*4*r.I, Pmech:4*r.Pmech, Q:r.Q, stalled:r.stalled };
}
/* single motor on the bench (1 motor draws from the pack); tempC = winding temp for Rm */
function solveBench(d, soc, tempC, ov){
  const p = propulsionParams(ov);
  const s = soc==null?1:soc;
  const rIR = cellIR(p, s), Rpack = p.cells*rIR;
  const Rm = motorRm(p, tempC==null?20:tempC);
  let V = cellOCV(s)*p.cells, r = calcMotorPoint(d, V, Rm, p.rdsOn, ov);
  for(let k=0;k<6;k++){
    V = Math.max(cellOCV(s)*p.cells - r.I*Rpack, p.cells*2.8);
    r = calcMotorPoint(d, V, Rm, p.rdsOn, ov);
  }
  return Object.assign(r, { V, Rm });
}
/* motor thermal — cp 385 J/kg°C, convective h improves with induced airflow */
function motorThermalArea(p){
  const [w,h,d] = p.motorSize;
  const dia = Math.max(w,d)/1000, height = h/1000;   // m
  return Math.PI*dia*height + Math.PI*(dia/2)*(dia/2);   // side + top, m²
}
function motorThermalStep(T, Ploss, indVel, p, dt){
  const cp = 385, mass = Math.max(p.massMotor,4)/1000;
  const hConv = 25 + 22*Math.max(indVel,0);
  const area = motorThermalArea(p);
  const Rth = 1/Math.max(hConv*area, 0.05);
  const Cth = mass*cp;
  let Tn = T + (Ploss - (T-T_AMB)/Rth)/Cth*dt;
  return Math.min(Tn, 260);
}
/* ESC thermal — cp 800 J/kg°C, Rds_on conduction loss with soft over-current penalty */
function escThermalStep(T, I, p, dt){
  const cp = 800, mass = 0.02;   // ~20 g ESC
  const limit = Math.max(p.escCurrentLimit, 1);
  const penalty = 1 + Math.pow(Math.max(I/limit,0), 2);
  const Ploss = I*I*p.rdsOn*penalty;
  const rth = 6.5;               // °C/W to ambient
  const cool = 1/rth;
  let Tn = T + (Ploss - (T-T_AMB)*cool)/(mass*cp)*dt;
  return Math.min(Tn, 180);
}
function marginRating(tw){
  if(tw >= 2.0) return "EXCELLENT";
  if(tw >= 1.5) return "GOOD";
  if(tw >= 1.3) return "MARGINAL";
  return "FAIL";
}

function calc(){
  const { total } = massRows();
  const mkg = total/1000, W = mkg*G;
  const p = propulsionParams();
  const full = solveQuad(1, 1);
  const Tmax = full.Ttot;
  const tw = W > 0 ? Tmax/W : 0;
  let hoverD = 1, hover = null;
  if(Tmax > W){
    let lo = 0, hi = 1;
    for(let i=0;i<24;i++){
      const mid = (lo+hi)/2;
      (solveQuad(mid,1).Ttot > W) ? hi = mid : lo = mid;
    }
    hoverD = (lo+hi)/2;
    hover = solveQuad(hoverD, 0.6);
  }
  const hoverI = hover ? hover.Itot : full.Itot;
  const endur = hoverI > 0 && hover ? (p.cap/1000 * 0.8) / hoverI * 60 : 0;
  const effFull = full.P > 0 ? full.Pmech/full.P : 0;
  const gPerW = full.P > 0 ? (Tmax/G*1000)/full.P : 0;
  return { mkg, W, Tmax, tw, hoverD, hoverPct: hoverD*100, hoverI,
           hoverV: hover?hover.V:full.V, endur, rho: rhoNow(), full, p,
           effFull, gPerW, rating: marginRating(tw), pass: tw >= 1.30 };
}

/* ════════════ 4b · ENERGY-STORAGE SUB-CALCS (PDF formulas A–D) ════════════
   Explicit, individually callable functions so the Calculations modal can
   show each formula with the live numbers that fed it. All four REUSE the
   physics engine above (cellOCV, cellIR, solveQuad, calc()) — nothing here
   reinvents the battery/motor model. */

/* A · C-Rating Safety Check — I_max = C_rating × Capacity(Ah), continuous vs
   burst, compared against the real full-throttle 4-motor draw. */
function crateCalc(){
  const p = propulsionParams(), c = calc(), capAh = p.cap/1000;
  const contA = capAh * p.cRatingCont, burstA = capAh * p.cRating;
  const drawA = c.full.Itot;
  return { p, capAh, contA, burstA, drawA,
           headroomA: contA - drawA, headroomPct: contA>0 ? (contA-drawA)/contA*100 : 0,
           overCont: drawA > contA, overBurst: drawA > burstA };
}

/* B · Voltage Sag Under Load — V_loaded = V_nominal − I_total·R_internal,
   R_pack = cells × (cell_ir_mohm/1000). Stepped over 5 current levels (the
   simple linear model), overlaid with the real nonlinear pack sag traced by
   sweeping throttle through solveQuad (motor/prop coupling + IR swell). */
function sagCalc(){
  const p = propulsionParams(), capAh = p.cap/1000;
  const Rpack = p.cells * cellIR(p, 1);
  const Vnom = cellOCV(1) * p.cells;
  const Imax = Math.max(capAh * p.cRatingCont, 1);
  const levels = [0, .25, .5, .75, 1].map(f => +(Imax*f).toFixed(2));
  const linear = levels.map(I => +Math.max(Vnom - I*Rpack, 0).toFixed(3));
  const nl = { i:[], v:[] };
  for(let d=0.05; d<=1.0001; d+=0.05){
    const r = solveQuad(+d.toFixed(2), 1);
    nl.i.push(+r.Itot.toFixed(2)); nl.v.push(+r.V.toFixed(3));
  }
  return { p, Rpack, Vnom, levels, linear, nl };
}

/* C · Endurance & Diminishing Returns — T_flight = (Capacity×0.80 / I_avg)×60,
   I_avg = TRUE hover current from the real assembled-drone hover solve
   (solveQuad bisection, same as calc()). Recomputes mass → hover current per
   hypothetical pack capacity (heavier pack ⇒ more thrust needed ⇒ more
   current), which is what makes the capacity→endurance curve sub-linear
   instead of the naive straight-line ratio. */
function enduranceForCapacity(capMah){
  const ba = opt("battery");
  const baseCap = (ba && ba.phys && ba.phys.capacity_mah) || 1500;
  const massPerMah = (ba ? ba.mass : 178) / Math.max(baseCap, 1);
  const battMassNow = ba ? ba.mass*ba.qty : 0;
  const massG = massPerMah * capMah;
  const { total } = massRows();
  const mkg = Math.max(total - battMassNow + massG, 1) / 1000, W = mkg*G;
  const ov = { cap: capMah };
  const full = solveQuad(1, 1, ov);
  if(full.Ttot <= W) return { capMah, massG, mkg, W, Tmax:full.Ttot, hoverI:0, endur:0, deficit:true };
  let lo=0, hi=1;
  for(let i=0;i<24;i++){ const mid=(lo+hi)/2; (solveQuad(mid,1,ov).Ttot>W) ? hi=mid : lo=mid; }
  const hoverD = (lo+hi)/2, hover = solveQuad(hoverD, 0.6, ov);
  const hoverI = hover.Itot;
  const endur = hoverI>0 ? (capMah/1000*0.80/hoverI)*60 : 0;
  return { capMah, massG, mkg, W, Tmax:full.Ttot, tw:full.Ttot/W, hoverD, hoverI, endur, deficit:false };
}
function enduranceCalc(){
  const ba = opt("battery"), base = (ba && ba.phys && ba.phys.capacity_mah) || 1500;
  const caps = [base, base*1.5, base*2];
  const rows = caps.map(enduranceForCapacity).map(r => Object.assign(r, { peukert: r.endur*0.90 }));
  const gainMult = rows[0].endur>0 ? rows[2].endur/rows[0].endur : 0;   // ~1.85× when capacity doubles
  return { rows, gainMult };
}

/* D · SoC Discharge Mapping — SoC%_naive = (V_cell − 3.5)/(4.2 − 3.5) × 100.
   TRUE coulomb-counted SoC is recovered by inverting the real OCV curve
   cellOCV(soc) (bisection) — the flat-then-cliff discharge physics already
   modelled by the engine, not a re-derivation. */
function socPoint(vCell){
  let lo=0, hi=1;
  for(let i=0;i<32;i++){ const mid=(lo+hi)/2; (cellOCV(mid) < vCell) ? lo=mid : hi=mid; }
  const trueSoc = (lo+hi)/2*100;
  const naiveSoc = Math.max(0, Math.min(100, (vCell-3.5)/(4.2-3.5)*100));
  return { vCell, trueSoc, naiveSoc };
}
function socCalc(){
  return { points: [4.2,4.0,3.8,3.7,3.5].map(socPoint) };
}

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
function diagnostics(){
  const items = [];
  const ch = opt("chasis"), pr = opt("propeller"), mo = opt("motor"),
        ba = opt("battery"), esc = opt("esc");
  const geom = propGeometry();
  const c = calc(), p = c.p;

  // 1 · propeller collision (blocking)
  if(geom.collide){
    items.push({ sev:"err", block:true, tag:"prop-collision",
      msg:"Propellers collide — "+geom.propDiaMm.toFixed(0)+" mm props overlap on a "+geom.wbMm+" mm wheelbase (arm spacing "+geom.adjacentMm.toFixed(0)+" mm).",
      fix:"Fit a smaller propeller or a larger chassis before running." });
  } else if(geom.clearanceMm < 12){
    items.push({ sev:"warn",
      msg:"Very tight prop clearance — only "+geom.clearanceMm.toFixed(0)+" mm between disc tips.",
      fix:"A smaller propeller improves the safety margin." });
  }
  // 2 · recommended prop size for the frame
  if(ch && ch.phys && ch.phys.recommended_prop_in && pr && pr.phys){
    const rec = ch.phys.recommended_prop_in, dia = pr.phys.diameter_in;
    const lo = Math.min(...rec), hi = Math.max(...rec);
    if(dia < lo - 0.5 || dia > hi + 0.5){
      items.push({ sev:"warn",
        msg:'Propeller ('+dia+'") is outside the frame\u2019s recommended '+lo+'\u2013'+hi+'" range.',
        fix:"Match the prop to the chassis for correct clearance and efficiency." });
    }
  }
  // 3 · motor over-current at full throttle
  if(mo){
    if(c.full.Iper > p.imax){
      items.push({ sev:"err", block:false,
        msg:"Motor over-current — draws "+c.full.Iper.toFixed(1)+" A vs "+p.imax+" A rating at full throttle.",
        fix:"Use a smaller prop, lower cell count, or a higher-current motor." });
    } else if(c.full.Iper > p.imax*0.9){
      items.push({ sev:"warn",
        msg:"Motor near current limit ("+c.full.Iper.toFixed(1)+" / "+p.imax+" A).",
        fix:"Little headroom for aggressive manoeuvres." });
    }
  }
  // 4 · ESC current rating
  if(esc && esc.phys && esc.phys.current_a){
    const escA = esc.phys.current_a;
    if(c.full.Iper > escA){
      items.push({ sev:"err", block:false,
        msg:"ESC under-rated — "+escA+" A/ch vs "+c.full.Iper.toFixed(1)+" A motor draw.",
        fix:"Choose an ESC rated above the motor's peak current." });
    }
  }
  // 5 · battery discharge capability — burst (warn) vs continuous (error)
  if(ba && ba.phys){
    const capAh = ba.phys.capacity_mah/1000;
    const burstA = capAh * (ba.phys.c_rating||30);
    const contA  = capAh * p.cRatingCont;
    if(c.full.Itot > contA){
      items.push({ sev:"err", block:false, tag:"batt-crate",
        msg:"Battery continuous C-rate exceeded — pack sustains "+contA.toFixed(0)+" A but the build pulls "+c.full.Itot.toFixed(0)+" A; cells overheat and vent.",
        fix:"Higher C-rating / capacity, or a lower-current motor & prop." });
    } else if(c.full.Itot > burstA){
      items.push({ sev:"warn",
        msg:"Battery burst limit exceeded — pack "+burstA.toFixed(0)+" A vs "+c.full.Itot.toFixed(0)+" A full-throttle draw.",
        fix:"Higher C-rating or capacity keeps voltage sag in check." });
    }
  }
  // 6 · over-voltage — pack cell count above ESC / motor rating (burns the ESC on spin-up)
  if(p.cells > p.escMaxCells){
    items.push({ sev:"err", block:false, tag:"over-voltage",
      msg:"ESC over-voltage — "+p.cells+"S pack exceeds the ESC's "+p.escMaxCells+"S rating; it pops on power-up.",
      fix:"Use an ESC rated for "+p.cells+"S, or a lower cell-count battery." });
  } else if(p.cells > p.motorMaxCells){
    items.push({ sev:"err", block:false, tag:"over-voltage",
      msg:"Motor over-voltage — "+p.cells+"S exceeds the motor's "+p.motorMaxCells+"S rating (over-speed / demag).",
      fix:"Lower the cell count or fit a lower-Kv motor rated for "+p.cells+"S." });
  }
  // 7 · motor electrical power over its rating (warn)
  if(mo && c.full.P/4 > p.pmax*1.02){
    items.push({ sev:"warn",
      msg:"Motor over-powered — "+(c.full.P/4).toFixed(0)+" W/motor vs "+p.pmax+" W rating at full throttle.",
      fix:"Reduces motor life; drop prop pitch/diameter or cell count." });
  }
  // 8 · component vs mount envelope (only when the chassis ships authored mounts)
  if(ch && ch.mounts && ch.mounts.mounts){
    const byType = {}; ch.mounts.mounts.forEach(mt=>{ const k = mt.type || mt.mountType; if(k && !byType[k]) byType[k]=mt; });
    const CHECK = { motor:mo, esc:esc, battery:ba, flight_controller:opt("controller"), receiver:opt("reciever") };
    Object.keys(CHECK).forEach(mtype=>{
      const part = CHECK[mtype], mt = byType[mtype];
      if(!part || !mt) return;
      // A 4-in-1 ESC stacks under the flight controller, not on the arm ESC
      // mounts, so the arm-ESC envelope doesn't apply to it.
      if(mtype === "esc" && escIs4in1(part)) return;
      // NOTE: the authored mount envelopes are LOW-confidence auto-detections,
      // so these stay advisory (warnings). Promote to sev:"err" once components
      // carry trusted real-world size_mm / mass and mounts carry vetted limits.
      if(mt.maximumWeight && part.mass > mt.maximumWeight * 1.5){
        items.push({ sev:"warn", tag:"mount-weight",
          msg:mt.name+" mount likely overloaded — "+part.name+" is "+part.mass+" g vs ~"+mt.maximumWeight+" g rated.",
          fix:"Fit a lighter component or a frame rated for the load." });
      }
      if(mt.maximumDimensions && part.size){
        const a = part.size.slice().sort((x,y)=>x-y), b = mt.maximumDimensions.slice().sort((x,y)=>x-y);
        if(a[0]>b[0]*1.5 || a[1]>b[1]*1.5 || a[2]>b[2]*1.5){
          items.push({ sev:"warn", tag:"mount-fit",
            msg:mt.name+" tight fit — "+part.name+" ("+part.size.join("×")+" mm) is larger than the ~"+mt.maximumDimensions.join("×")+" mm envelope.",
            fix:"Choose a smaller component for this mount." });
        }
      }
    });
  }
  // 6 · thrust-to-weight / hover feasibility
  if(c.tw < 1.05){
    items.push({ sev:"err", block:false, tag:"no-hover",
      msg:"Cannot hover — thrust-to-weight is "+c.tw.toFixed(2)+" (need > 1.0).",
      fix:"Lighter build, larger prop, or a more powerful motor." });
  } else if(c.tw < 1.5){
    items.push({ sev:"warn",
      msg:"Marginal thrust-to-weight ("+c.tw.toFixed(2)+") — limited control authority.",
      fix:"Aim for T/W \u2265 1.8 for stable flight." });
  }

  // hover-throttle headroom — no control margin if it takes ~all the throttle
  if(c.tw >= 1.05 && c.hoverPct > 88){
    items.push({ sev:"warn",
      msg:"No control headroom — hover needs "+Math.round(c.hoverPct)+" % throttle; little left to stabilise.",
      fix:"More thrust (bigger prop / higher-Kv motor) lowers hover throttle." });
  }
  const errors = items.filter(i=>i.sev==="err").length;
  const warns = items.filter(i=>i.sev==="warn").length;
  const blocked = items.some(i=>i.block);
  if(!items.length) items.push({ sev:"ok", msg:"All checks passed — geometry, current and thrust margins are within limits.", fix:"" });
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
    /* power-analyzer / electronic-load box — display panel + analog current
       dial + red/black binding posts. Used on the M1 battery-analyzer bench
       to read pack current & voltage under load. */
    case "analyzer":
      add(new T.BoxGeometry(1.0,.5,.55), mat(c,{roughness:.35,metalness:.25}));
      add(new T.BoxGeometry(.7,.32,.03), mat(0x1c2a2f,{roughness:.2,metalness:.1}), 0,.06,.28);
      add(new T.CylinderGeometry(.14,.14,.05,24), mat(0xdfe6e2), -.24,.06,.3, Math.PI/2,0,0);
      add(new T.CylinderGeometry(.02,.02,.09,10), mat(0x1e2a29), -.24,.09,.32, Math.PI/2.6,0,.3);
      add(new T.CylinderGeometry(.035,.035,.14,10), mat(0xc23b2e), .28,.28,.2);
      add(new T.CylinderGeometry(.035,.035,.14,10), mat(0x22262b), .42,.28,.2);
      break;
    /* resistive load bank — finned body that sinks the current the analyzer
       measures (draws the pack down for the C-rating & sag tests). */
    case "loadbank":
      add(new T.BoxGeometry(.9,.4,.5), mat(c,{roughness:.6,metalness:.5}));
      for(let i=0;i<7;i++) add(new T.BoxGeometry(.02,.42,.52), mat(0x30363c), -.4+i*.14,0,0);
      add(new T.CylinderGeometry(.03,.03,.15,8), mat(0xc23b2e), .3,.24,.22);
      add(new T.CylinderGeometry(.03,.03,.15,8), mat(0x22262b), .42,.24,.22);
      break;
    /* discharge rig — vented housing with a SoC gauge face, used by the SoC
       Discharge Mapping bench to trace cell voltage vs true coulomb SoC. */
    case "dischargerig":
      add(new T.BoxGeometry(1.1,.45,.6), mat(c,{roughness:.5,metalness:.3}));
      add(new T.CylinderGeometry(.17,.17,.05,28), mat(0xdfe6e2), 0,.08,.31, Math.PI/2,0,0);
      add(new T.BoxGeometry(.34,.045,.045), mat(0x1e2a29), .1,.08,.34, 0,0,.5);
      for(let i=0;i<4;i++) add(new T.BoxGeometry(.05,.3,.08), mat(0x30363c), -.45+i*.3,-.02,.32);
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
function standModel(span, onReady){
  const g = new THREE.Group();
  g.add(fitUnit(buildFallback({kind:"stand",color:0x9aa5b1,s:1}), span, null));
  loadModelFile(STAND_MODEL).then(m=>{
    const fitted = fitUnit(m.clone(true), span, null);
    while(g.children.length) g.remove(g.children[0]);
    g.add(fitted);
    if(onReady) onReady(g);
  }).catch(()=>{});
  return g;
}
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
let renderer, scene, camera, controls, rig, propGroups = [];
let hoverPhase = 0, benchGroup = null;
// component emitter anchors, so failure smoke/sparks vent from the real part
let rigParts = { motors: [], escs: [], battery: null };
let benchParts = { battery: null, analyzer: null, loadbank: null, dischargerig: null };
function sceneModeType(){ return currentExp().exp.type || "bench"; }   // bench | flight
function isBench(){ return sceneModeType() === "bench"; }
function isFlight(){ return sceneModeType() === "flight"; }

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
  if(benchGroup){ scene.remove(benchGroup); benchGroup = null; }
  propGroups = [];
  FX.clear();
  rigParts = { motors: [], escs: [], battery: null };
  benchParts = { battery: null, analyzer: null, loadbank: null, dischargerig: null };
}
function buildScene(){
  clearRig();
  if(isBench()) buildBenchRig(); else buildDrone();
  syncCamera();
}
function syncCamera(){
  if(!controls) return;
  if(isBench()){ controls.target.set(0,1.2,0); }
  else { controls.target.set(0, isFlight() ? 1.2 : 1.1, 0); }
}

/* full assembled drone — one world-scale u = 3.0 / wheelbase → true relative sizes.
   Motors/props are SEATED onto the real chassis geometry via downward raycast
   (works instantly against the fallback mesh, then re-seats once the real GLB loads). */
function buildDrone(){
  const d = new THREE.Group();
  propGroups = [];
  const ch = opt("chasis");
  d.position.y = isFlight() ? 1.0 : 1.15;   // flight height
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
  d.position.y = isFlight() ? 1.0 : 1.15;   // set BEFORE seating so world→local offset is known
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

  // up-axis: spec.physics.native_up → dominant motor-normal axis → bbox thinnest
  function deriveUpAxis(){
    if(ch.phys && ch.phys.native_up) return ch.phys.native_up;
    const mo = allMounts.filter(m => m.type === "motor" && Array.isArray(m.normal));
    if(mo.length){
      const s = [0,0,0]; mo.forEach(m => { for(let i=0;i<3;i++) s[i] += Math.abs(m.normal[i]||0); });
      const ax = s.indexOf(Math.max.apply(null, s));
      return ax === 1 ? "y" : ax === 2 ? "z" : "x";
    }
    return null;
  }
  function upQuat(up){
    const q = new THREE.Quaternion();
    if(up === "z") q.setFromEuler(new THREE.Euler(-Math.PI/2, 0, 0));   // Z-up → Y-up
    else if(up === "x") q.setFromEuler(new THREE.Euler(0, 0, Math.PI/2)); // X-up → Y-up
    return q;                                                            // y → identity
  }
  let upAxis = deriveUpAxis();

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

/* ── ENERGY-STORAGE bench rigs ────────────────────────────────────────────
   The real battery model (spec.json → assets/battery/_model/Battery_Drone.fbx)
   sits on a bench stand next to procedural instruments, exactly like the
   reference seats a motor on its test stand: a fallback shape shows instantly,
   the stand measures its own top surface once loaded, then every part is
   re-seated (seatModel "base") on that real surface. */
function buildBenchRig(){
  const g = new THREE.Group();
  propGroups = [];
  const metric = currentExp().exp.metric;
  const stand = standModel(2.3, s=>{
    const hm = measuredHeight(s);
    s.position.y = -hm.min;                     // rest base on ground
    placeBenchParts(hm.max - hm.min);
  });
  g.add(stand);
  benchGroup = g; scene.add(g);
  rig = g;
  placeBenchParts(1.7);                          // provisional placement until stand measures

  function placeBenchParts(standTopY){
    for(let k=g.children.length-1;k>=0;k--){ if(g.children[k].userData.benchPart) g.remove(g.children[k]); }
    const ba = opt("battery");
    const baSpan = ba && ba.size ? Math.max.apply(null, ba.size)*0.0105 : 0.5;

    // the REAL battery model, seated on the stand top. seatModel only runs
    // once the real FBX swaps in (mirrors mountMotor/buildDroneFromMounts) —
    // calling it twice on the same group would double-offset it.
    const battery = modelFor(ba, baSpan, mdl => seatModel(mdl, "base"));
    battery.position.set(-0.6, standTopY, 0.22);
    battery.userData.benchPart = true;
    g.add(battery);
    benchParts.battery = battery; FX.setEmitter("bench_battery", battery, "battery");

    if(metric === "soc"){
      // discharge rig — reads cell voltage vs coulomb-counted SoC as the pack drains
      const rig1 = fitUnit(buildFallback({kind:"dischargerig", color:0x3a4148, s:1}), 1.0, null);
      rig1.position.set(0.55, standTopY, -0.05); rig1.userData.benchPart = true;
      seatModel(rig1, "base"); g.add(rig1);
      benchParts.dischargerig = rig1;
    }else{
      // battery-analyzer bench (C-Rating & Voltage Sag) — analyzer instrument
      // reads V/I, load bank sinks the current that stresses the pack
      const analyzer = fitUnit(buildFallback({kind:"analyzer", color:0x2b3036, s:1}), 0.95, null);
      analyzer.position.set(0.5, standTopY, -0.18); analyzer.userData.benchPart = true;
      seatModel(analyzer, "base"); g.add(analyzer);
      benchParts.analyzer = analyzer;

      const loadbank = fitUnit(buildFallback({kind:"loadbank", color:0x4a5058, s:1}), 0.8, null);
      loadbank.position.set(0.5, standTopY, 0.42); loadbank.userData.benchPart = true;
      seatModel(loadbank, "base"); g.add(loadbank);
      benchParts.loadbank = loadbank;
    }
  }
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
/* No module/experiment locking in this lab — both modules (Pack Under Load,
   Energy & Endurance) are independently explorable from the start. */
function renderModuleTabs(){
  const box = $("moduleTabs"); box.innerHTML = "";
  DRONE_DB.modules.forEach(m=>{
    const b = el("button", m.id===state.module ? "active" : ""); b.type = "button";
    b.innerHTML = txt(m.label)+' <small>· '+txt(m.sub)+'</small>';
    b.addEventListener("click", ()=>{
      if(simActive) stopSim(false);
      state.module = m.id; saveState();
      renderModuleTabs(); renderExpTabs(); syncRunControls(); drawLiveGraph(); buildScene(); syncRunControls();
    });
    box.appendChild(b);
  });
}
function renderExpTabs(){
  const box = $("expTabs"); box.innerHTML = "";
  const m = DRONE_DB.modules.find(m=>m.id===state.module);
  m.experiments.forEach(e=>{
    const key = m.id+":"+e.id;
    const b = el("button", e.id===state.exp[m.id] ? "active" : ""); b.type = "button";
    b.innerHTML = (state.done[key] ? '<span class="done">✓</span>' : "") + txt(e.name);
    b.addEventListener("click", ()=>{
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
function renderCalcChips(){
  const c = calc(), p = c.p, cr = crateCalc();
  const canHover = c.tw > 1;
  const chips = [
    { k:"C-rate headroom", v:(cr.headroomPct>=0?"+":"")+cr.headroomPct.toFixed(0)+" %", cls:cr.overCont?"warn":cr.headroomPct<15?"":"good" },
    { k:"Loaded pack V", v:c.full.V.toFixed(1)+" V ("+(c.full.V/p.cells).toFixed(2)+" V/cell)", cls:(c.full.V/p.cells)<3.5?"warn":"" },
    { k:"Pack R_internal", v:(p.cells*cellIR(p,1)*1000).toFixed(1)+" mΩ", cls:"" },
    { k:"Est. endurance", v:canHover ? c.endur.toFixed(1)+" min" : "no hover", cls:canHover?"":"warn" },
    { k:"Air density ρ", v:c.rho.toFixed(3)+" kg/m³", cls:"" }
  ];
  const box = $("calcChips"); box.innerHTML = "";
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
/* Energy-relevant telemetry card — same 8-row structure as the reference,
   relabelled: Pack V / Cell V / Current / Power / SoC% / Pack Temp /
   C-rate headroom / RPM (motors spin only during the Endurance flight). */
function updateTelemetry(t){
  t = t || {};
  const p = propulsionParams();
  const cur = t.cur||0;
  const contA = (p.cap/1000) * p.cRatingCont;
  const headroomPct = contA>0 ? (contA-cur)/contA*100 : 0;
  const vPack = t.v!=null ? t.v : (cellOCV(t.soc!=null?t.soc:1)*p.cells);
  $("telPackV").textContent = vPack.toFixed(2)+" V";
  $("telCellV").textContent = (vPack/p.cells).toFixed(2)+" V";
  $("telCur").textContent = cur.toFixed(1)+" A";
  $("telPwr").textContent = Math.round(t.pwr||0)+" W";
  $("telSoc").textContent = Math.round((t.soc!=null?t.soc:sim.soc!=null?sim.soc:1)*100)+" %";
  $("telTemp").textContent = Math.round(t.temp!=null?t.temp:T_AMB)+" °C";
  $("telHeadroom").textContent = (headroomPct>=0?"+":"")+Math.round(headroomPct)+" %";
  $("telRpm").textContent = Math.round(t.rpm||0).toLocaleString();
  const ph = $("telPhase");
  ph.textContent = t.phase || "STANDBY";
  ph.className = "tel-phase mono"+(t.phaseCls?" "+t.phaseCls:"");
}
function refreshAfterSelection(key){
  refreshTile(key);
  renderMassMini(); renderCalcChips(); renderLog();
  clearLastRun(); drawMassChart(); drawLiveGraph();   // component changed → config charts refresh live, run telemetry clears
  buildScene(); saveState();
}

/* ════════════ 9 · CHARTS (Chart.js) ════════════ */
/* Every plotted chart is Chart.js now — responsive (never clipped), interactive
   tooltips, and one-click detail views.  Circuit & Sankey stay lightweight DOM. */
const C_COL = { blue:"#1f3a93", orange:"#c65d3b", green:"#1f8a5b", red:"#a83232",
                slate:"#4f6d9e", grid:"#e7edeb", muted:"#8b9a95", ink:"#1e2a29" };
const MASS_PALETTE = ["#1f3a93","#4f6d9e","#c65d3b","#6c86c9","#8fa3c9","#a83232","#8b9a95","#d98e6a","#b7c2e0","#e0a98a"];
if(window.Chart){
  Chart.defaults.font.family = "'IBM Plex Sans', sans-serif";
  Chart.defaults.font.size = 11;
  Chart.defaults.color = "#5c6d68";
  Chart.defaults.plugins.legend.labels.boxWidth = 11;
  Chart.defaults.plugins.legend.labels.boxHeight = 11;
  Chart.defaults.plugins.legend.labels.font = { size: 10.5 };
  Chart.defaults.plugins.tooltip.titleFont = { family:"'IBM Plex Mono', monospace", size:10.5 };
  Chart.defaults.plugins.tooltip.bodyFont  = { family:"'IBM Plex Mono', monospace", size:11 };
}
/* one registry: reuse/destroy cleanly, no "canvas already in use" errors */
const ChartHub = {
  reg:{},
  put(id, cfg){ this.kill(id); const cv = $(id); if(!cv || !window.Chart) return null;
    const ch = new Chart(cv, cfg); this.reg[id] = ch; return ch; },
  kill(id){ if(this.reg[id]){ try{ this.reg[id].destroy(); }catch(e){} delete this.reg[id]; } },
  killPrefix(pre){ Object.keys(this.reg).forEach(k=>{ if(k.indexOf(pre)===0) this.kill(k); }); }
};
/* transient "current iteration" store — NOT persisted, NO history.  Holds only
   the most-recent completed run for one experiment; cleared when a component
   changes (results go stale) so the panel always shows just this run. */
let lastRun = { key:null, metric:null, data:[], data2:[], flightT:0 };
function clearLastRun(){ lastRun = { key:null, metric:null, data:[], data2:[], flightT:0 }; }
function downsample(arr, max){
  if(!arr || arr.length <= max) return arr ? arr.slice() : [];
  const step = arr.length/max, out = [];
  for(let i=0;i<max;i++) out.push(arr[Math.floor(i*step)]);
  out.push(arr[arr.length-1]); return out;
}
/* shared XY option factory for the analysis charts */
function baseXY(xlabel, y, extra){
  const tick = { font:{ family:"'IBM Plex Mono'" } };
  const o = { responsive:true, maintainAspectRatio:false, animation:{duration:250},
    interaction:{ mode:"index", intersect:false },
    plugins:{ legend:{ position:"bottom" }, tooltip:{} },
    scales:{ x:{ title:{display:true,text:xlabel}, grid:{color:C_COL.grid}, ticks:tick },
             y:{ title:{display:true,text:y.y}, grid:{color:C_COL.grid}, ticks:tick, beginAtZero:true } } };
  if(y.y1) o.scales.y1 = { position:"right", title:{display:true,text:y.y1},
    grid:{drawOnChartArea:false}, ticks:tick, beginAtZero:true };
  return Object.assign(o, extra||{});
}
/* center-text plugin for the tachometer doughnut */
function centerText(main, sub){
  return { id:"ctr", afterDraw(ch){ const a=ch.chartArea, ctx=ch.ctx;
    const x=(a.left+a.right)/2, y=(a.top+a.bottom)/2 + (a.bottom-a.top)*0.16;
    ctx.save(); ctx.textAlign="center";
    ctx.fillStyle="#1e2a29"; ctx.font="700 26px 'IBM Plex Mono'"; ctx.fillText(main, x, y);
    ctx.fillStyle="#8b9a95"; ctx.font="600 10px 'IBM Plex Sans'"; ctx.fillText(sub, x, y+17);
    ctx.restore(); } };
}
/* per-metric live-telemetry series (labels / colours / axes) */
/* per-metric live-telemetry series (labels / colours / axes). `customX:true`
   means the x-axis is NOT sample#/time but a caller-supplied array (SoC discharge
   mapping plots against SoC%, not against the clock). */
const TEL_SERIES = {
  // crate: draw and limit are BOTH Amps — sameAxis:true keeps them on one shared
  // Y-axis (y) instead of two independently auto-scaled axes, so a crossing on
  // screen means a real crossing in Amps, not two unrelated scales lining up.
  crate:     { a:{label:"Pack current draw (A)", color:C_COL.orange}, b:{label:"Continuous C-rate limit (A)", color:C_COL.red, sameAxis:true} },
  sag:       { a:{label:"Loaded pack voltage (V)", color:C_COL.blue}, b:{label:"Total current (A)", color:C_COL.orange} },
  endurance: { a:{label:"State of charge (%)", color:C_COL.green}, b:{label:"Pack voltage (V)", color:C_COL.slate}, xtime:true },
  soc:       { a:{label:"Cell voltage (V)", color:C_COL.blue}, customX:true }
};
function telemetryConfig(metric, data, data2, flightT, opts){
  opts = opts || {};
  const s = TEL_SERIES[metric] || TEL_SERIES.crate, n = data.length;
  let labels;
  if(s.customX && opts.xArr && opts.xArr.length) labels = opts.xArr;
  else labels = data.map((_,i)=> s.xtime && flightT ? +(i/Math.max(n-1,1)*flightT).toFixed(1) : i);
  const tick = { font:{ family:"'IBM Plex Mono'", size:opts.mini?8:10 } };
  const ds = [{ label:s.a.label, data:data.slice(), borderColor:s.a.color, backgroundColor:s.a.color+"1f",
    borderWidth:2, pointRadius:0, tension:.25, fill:true, yAxisID:"y" }];
  const xText = s.customX ? "State of charge (%)" : (s.xtime?"Flight time (s)":"Sample #");
  const scales = {
    x:{ title:{display:!opts.mini, text:xText}, grid:{color:C_COL.grid},
        ticks:Object.assign({maxTicksLimit:opts.mini?5:9}, tick) },
    y:{ title:{display:!opts.mini, text:s.a.label}, grid:{color:C_COL.grid}, ticks:tick }
  };
  if(s.b && data2 && data2.length){
    const sameAxis = !!s.b.sameAxis;      // e.g. crate: draw + limit are both Amps — one shared axis
    ds.push({ label:s.b.label, data:data2.map(v=>v*(s.b.scale||1)), borderColor:s.b.color,
      borderWidth:2, pointRadius:0, tension:.25, borderDash:[5,4], yAxisID: sameAxis ? "y" : "y1" });
    if(!sameAxis){
      scales.y1 = { position:"right", title:{display:!opts.mini, text:s.b.label},
        grid:{drawOnChartArea:false}, ticks:tick };
    }
  }
  return { type:"line", data:{labels, datasets:ds},
    options:{ responsive:true, maintainAspectRatio:false, animation:opts.live?false:{duration:250},
      interaction:{ mode:"index", intersect:false },
      plugins:{ legend:{display:!opts.mini, position:"bottom"}, tooltip:{enabled:!opts.mini} },
      scales } };
}
function drawLiveGraph(){
  const { mod, exp } = currentExp();
  const key = mod.id+":"+exp.id, metric = exp.metric;
  const cap = $("graphCaption");
  const live = simActive && sim.data.length > 1;
  let data, data2, dataX, flightT, recording = false;
  if(live){ data = sim.data; data2 = sim.data2; dataX = sim.dataX; flightT = sim.flightT || 0; recording = true; }
  else if(lastRun.key === key && lastRun.data.length > 1){ data = lastRun.data; data2 = lastRun.data2; dataX = lastRun.dataX; flightT = lastRun.flightT; }
  if(!data){                                   // empty state — no run for this experiment yet
    ChartHub.kill("liveGraph");
    const cv = $("liveGraph");
    if(cv){ const box = cv.parentElement;                 // size the raw canvas to its container (responsive)
      const w = Math.max(box.clientWidth-2, 40), h = Math.max(box.clientHeight-2, 40);
      cv.width = w; cv.height = h; cv.style.width = w+"px"; cv.style.height = h+"px";
      const g = cv.getContext("2d"); g.clearRect(0,0,w,h);
      g.fillStyle = "#a3b2ad"; g.font = "500 12px 'IBM Plex Mono', monospace"; g.textAlign = "center";
      g.fillText("no data — run "+exp.name, w/2, h/2); }
    if(cap) cap.textContent = exp.name+" · waiting for first run…";
    return;
  }
  const ch = ChartHub.reg["liveGraph"];
  if(recording && ch && ch._metric === metric){            // stream into the existing chart (smooth)
    const s = TEL_SERIES[metric] || TEL_SERIES.crate;
    ch.data.labels = (s.customX && dataX && dataX.length) ? dataX.slice()
      : data.map((_,i)=> s.xtime && flightT ? +(i/Math.max(data.length-1,1)*flightT).toFixed(1) : i);
    ch.data.datasets[0].data = data.slice();
    if(ch.data.datasets[1]) ch.data.datasets[1].data = data2.map(v=>v*((s.b&&s.b.scale)||1));
    ch.update("none");
  }else{
    const c = ChartHub.put("liveGraph", telemetryConfig(metric, data, data2, flightT, {mini:true, live:recording, xArr:dataX}));
    if(c) c._metric = metric;
  }
  if(cap) cap.textContent = exp.name+" · "+(exp.unit||"value")+
    (metric==="endurance" && flightT ? " · flight "+fmtMMSS(flightT) : "")+(recording ? " · recording…" : " · last run");
}
/* config-derived mass distribution doughnut — live-refreshes on component change */
function massChartConfig(mini){
  const { rows, total } = massRows();
  const sorted = rows.filter(r=>r.mass>0).sort((a,b)=>b.mass-a.mass);
  return { type:"doughnut",
    data:{ labels:sorted.map(r=>r.label),
      datasets:[{ data:sorted.map(r=>r.mass), backgroundColor:sorted.map((_,i)=>MASS_PALETTE[i%MASS_PALETTE.length]),
        borderWidth:0, hoverOffset:6 }] },
    options:{ responsive:true, maintainAspectRatio:false, cutout:"58%",
      layout:{ padding: mini?2:6 },
      plugins:{ legend:{ display:!mini, position:"right", labels:{boxWidth:11, font:{size:11}} },
        tooltip:{ callbacks:{ label:cx=>" "+cx.label+": "+Math.round(cx.raw)+" g ("+Math.round(cx.raw/(total||1)*100)+"%)" } },
        title:{ display:true, text:(total/1000).toFixed(2)+" kg all-up", font:{size:mini?11:13}, color:"#1e2a29" } },
      plugins_center:true } };
}
function drawMassChart(){ const c = ChartHub.put("massChart", massChartConfig(true)); if(c) c._metric = "mass"; }
/* ── energy-storage analysis-chart builders (each returns a Chart.js config,
   computed live) — same builder style as the reference (baseXY, C_COL,
   centerText doughnut, renderSankeyDOM DOM style, borderWidth:2, pointRadius:0,
   tension, borderDash:[5,4]). ── */
/* 1 · Discharge curve — cell V vs SoC (flat-then-cliff, from cellOCV directly) */
function cfgDischargeCurve(){
  const soc=[], v=[];
  for(let s=0; s<=1.0001; s+=0.02){ soc.push(Math.round(s*100)); v.push(+cellOCV(s).toFixed(3)); }
  return { type:"line", data:{ labels:soc, datasets:[
    { label:"Cell voltage (V)", data:v, borderColor:C_COL.blue, backgroundColor:C_COL.blue+"1f",
      borderWidth:2, pointRadius:0, tension:.25, fill:true } ] },
    options: baseXY("State of charge (%)", {y:"Cell voltage (V)"}) };
}
/* 2 · Voltage sag — linear model overlaid with the real nonlinear pack sag */
function cfgSagChart(){
  const s = sagCalc();
  return { type:"line", data:{ datasets:[
    { label:"Linear model V = Vnom − I·R", data:s.levels.map((I,i)=>({x:I,y:s.linear[i]})),
      borderColor:C_COL.blue, backgroundColor:C_COL.blue, borderWidth:2, pointRadius:4, showLine:true, tension:0 },
    { label:"Real nonlinear pack sag (solveQuad)", data:s.nl.i.map((I,i)=>({x:I,y:s.nl.v[i]})),
      borderColor:C_COL.orange, borderWidth:2, pointRadius:0, borderDash:[5,4], showLine:true, tension:.2 } ] },
    options: baseXY("Total current draw (A)", {y:"Pack voltage (V)"}) };
}
/* 3 · C-rate margin — continuous / burst / actual draw */
function cfgCrateMargin(){
  const cr = crateCalc();
  return { type:"bar", data:{ labels:["Continuous rating","Burst rating","Actual full-throttle draw"], datasets:[
    { label:"Amps", data:[+cr.contA.toFixed(1), +cr.burstA.toFixed(1), +cr.drawA.toFixed(1)],
      backgroundColor:[C_COL.blue, C_COL.slate, cr.overCont?C_COL.red:C_COL.green], borderWidth:0 } ] },
    options: baseXY("", {y:"Current (A)"}, {plugins:{legend:{display:false}}}) };
}
/* 4 · Endurance vs capacity — sub-linear (heavier pack ⇒ more hover current).
   A swept capacity that would push the build past a hover deficit (thrust ≤
   weight at that hypothetical pack mass — see enduranceForCapacity's `deficit`
   flag) is NOT plotted as a fabricated low-but-real endurance number; it's left
   as a gap in the line so the chart never implies a heavier pack can still fly. */
function cfgEnduranceCapacity(){
  const ec = enduranceCalc();
  return { type:"line", data:{ labels:ec.rows.map(r=>Math.round(r.capMah)), datasets:[
    { label:"Endurance (min)", data:ec.rows.map(r=>r.deficit?null:+r.endur.toFixed(1)), borderColor:C_COL.green,
      backgroundColor:C_COL.green+"1f", borderWidth:2, pointRadius:ec.rows.map(r=>r.deficit?0:4),
      tension:.3, fill:true, spanGaps:false },
    { label:"Peukert reality-check (×0.90)", data:ec.rows.map(r=>r.deficit?null:+r.peukert.toFixed(1)), borderColor:C_COL.red,
      borderWidth:2, pointRadius:0, borderDash:[5,4], tension:.3, spanGaps:false } ] },
    options: baseXY("Battery capacity (mAh)", {y:"Endurance (min)"}) };
}
/* 5 · SoC gauge — true (coulomb-counted) vs naive voltage-estimated SoC */
function cfgSocGauge(){
  const pt = socPoint(3.8);   // representative mid-discharge sample point (formula D)
  return { type:"doughnut",
    data:{ labels:["True SoC (coulomb)","Remaining"],
      datasets:[{ data:[Math.round(pt.trueSoc), Math.max(100-Math.round(pt.trueSoc),0)],
        backgroundColor:[C_COL.blue,"#d7e0dc"], borderWidth:0, circumference:240, rotation:-120 }] },
    options:{ responsive:true, maintainAspectRatio:false, cutout:"72%",
      plugins:{ legend:{position:"bottom"}, tooltip:{ callbacks:{ label:cx=>" "+cx.label+": "+cx.raw+"%" } } } },
    plugins:[ centerText(Math.round(pt.trueSoc)+"%", "TRUE · naive "+Math.round(pt.naiveSoc)+"%") ] };
}
/* 6 · Energy Sankey — stored → usable (80% rule) → IR-heat waste */
function renderEnergySankeyDOM(host){
  const p = propulsionParams(), capAh = p.cap/1000, c = calc();
  const eStored = capAh * (cellOCV(1)*p.cells);   // Wh (Ah × V)
  const eUsable = eStored*0.80;
  const Rpack = p.cells*cellIR(p,1);
  const Iavg = Math.max(c.hoverI || c.full.Itot, 0.1);
  const heatPct = Math.min(8 + Iavg*Rpack*p.cells*0.6, 32);      // illustrative I²R share
  host.innerHTML =
    '<div class="sankey"><div class="srow"><span>Stored energy</span><b>'+eStored.toFixed(1)+' Wh</b></div>'+
      '<div class="srow"><span>Usable (80% rule)</span><div class="sbar"><i style="width:80%;background:'+C_COL.blue+'"></i></div><b>'+eUsable.toFixed(1)+' Wh</b></div>'+
      '<div class="srow"><span>IR-heat waste</span><div class="sbar"><i style="width:'+heatPct.toFixed(0)+'%;background:'+C_COL.red+'"></i></div><b>'+(eUsable*heatPct/100).toFixed(1)+' Wh</b></div>'+
    '</div><p class="chart-footnote">Pack R_internal '+(Rpack*1000).toFixed(1)+' mΩ · illustrative I²R share at '+Iavg.toFixed(1)+' A average draw.</p>';
}
/* 7 · Peukert reality-check — rated vs effective capacity across discharge rate */
function cfgPeukertCheck(){
  const p = propulsionParams(), capAh = p.cap/1000, low = p.cRatingCont < 30;
  const crates = [0.5,1,1.5,2,3];
  const eff = crates.map(cr => capAh*1000 * (low ? Math.max(0.55, 1-0.10*Math.max(cr-1,0)) : Math.max(0.85,1-0.02*Math.max(cr-1,0))));
  return { type:"line", data:{ labels:crates.map(cr=>cr+"C"), datasets:[
    { label:"Rated capacity (mAh)", data:crates.map(()=>Math.round(capAh*1000)), borderColor:C_COL.muted,
      borderWidth:2, borderDash:[3,3], pointRadius:0 },
    { label:"Effective capacity (Peukert)", data:eff.map(Math.round), borderColor:C_COL.red,
      backgroundColor:C_COL.red+"1f", borderWidth:2, pointRadius:3, fill:true } ] },
    options: baseXY("Discharge rate", {y:"Capacity (mAh)"}) };
}
/* 8 · Per-cell voltage bars (loaded, at full-throttle draw) */
function cfgCellVoltageBars(){
  const p = propulsionParams(), c = calc();
  const vCellBase = c.full.V / p.cells;
  const labels = [], data = [];
  for(let i=0;i<p.cells;i++){ labels.push("Cell "+(i+1)); data.push(+(vCellBase + Math.sin(i*1.7)*0.012).toFixed(3)); }
  return { type:"bar", data:{ labels, datasets:[{ label:"Cell voltage (V)", data, backgroundColor:C_COL.blue, borderWidth:0 }] },
    options: baseXY("", {y:"Voltage (V)"}, {plugins:{legend:{display:false}}}) };
}
/* registry of every analysis chart — drives both the gallery and single-chart view */
function chartDefs(){
  return [
    { id:"mass",   title:"Mass distribution",                    cfg:()=>massChartConfig(false) },
    { id:"disch",  title:"Discharge curve — cell V vs SoC",       cfg:cfgDischargeCurve },
    { id:"sag",    title:"Voltage sag vs current",                cfg:cfgSagChart },
    { id:"crate",  title:"C-rate margin",                         cfg:cfgCrateMargin },
    { id:"endur",  title:"Endurance vs capacity",                 cfg:cfgEnduranceCapacity,
      note:()=>{ const ec = enduranceCalc(), bad = ec.rows.filter(r=>r.deficit).map(r=>Math.round(r.capMah)+" mAh");
        return bad.length
          ? "Not plotted — "+bad.join(", ")+": at that pack mass thrust can't even beat weight, so it can't hover at all."
          : "Sub-linear return: a heavier pack needs more hover thrust just to carry itself, so endurance grows slower than raw capacity — doubling capacity does not double flight time."; } },
    { id:"gauge",  title:"SoC gauge — true vs voltage-estimated", cfg:cfgSocGauge },
    { id:"sank",   title:"Energy flow · stored → usable → waste", dom:renderEnergySankeyDOM },
    { id:"peuk",   title:"Peukert reality-check",                 cfg:cfgPeukertCheck },
    { id:"cellv",  title:"Per-cell voltage",                      cfg:cfgCellVoltageBars }
  ];
}
/* single-chart floating detail — reached by clicking any chart's expand button */
function openSingleChart(def){
  const body = openModal(txt(def.title)+' <em>· detail</em>', "#c65d3b",
    '<button type="button" class="modal-back" id="chartBack">‹ all charts</button>');
  const wrap = el("div"); wrap.style.cssText = "height:62vh;min-height:340px;position:relative";
  if(def.dom){ wrap.style.height="auto"; def.dom(wrap); }
  else{ wrap.innerHTML = '<canvas id="gc_single"></canvas>'; }
  body.appendChild(wrap);
  if(def.cfg){ const c = def.cfg(); if(c) ChartHub.put("gc_single", c);
    else wrap.innerHTML = '<div class="runs-empty">'+txt(def.empty||"No data yet.")+'</div>'; }
  if(def.note) body.appendChild(el("p","chart-footnote", txt(def.note())));
  const back = $("chartBack"); if(back) back.addEventListener("click", openChartsDetail);
}
/* live telemetry graph detail — reached by clicking the Graphs card */
function openGraphDetail(){
  const { mod, exp } = currentExp();
  const key = mod.id+":"+exp.id, metric = exp.metric;
  const body = openModal('Live Graph <em>· '+txt(exp.name)+'</em>', "#4f6d9e");
  let data, data2, dataX, flightT;
  if(simActive && sim.data.length>1){ data=sim.data; data2=sim.data2; dataX=sim.dataX; flightT=sim.flightT||0; }
  else if(lastRun.key===key && lastRun.data.length>1){ data=lastRun.data; data2=lastRun.data2; dataX=lastRun.dataX; flightT=lastRun.flightT; }
  if(!data){ body.appendChild(el("div","runs-empty","No data yet for <b>"+txt(exp.name)+"</b>.<br>Press <b>▶ Run Sim</b> to plot this experiment.")); return; }
  const wrap = el("div"); wrap.style.cssText = "height:62vh;min-height:340px;position:relative";
  wrap.innerHTML = '<canvas id="gc_single"></canvas>'; body.appendChild(wrap);
  ChartHub.put("gc_single", telemetryConfig(metric, data, data2, flightT, {mini:false, xArr:dataX}));
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
  ChartHub.killPrefix("gc_");                 // destroy any modal charts (gallery + single detail)
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
  const { rows, total } = massRows(); const c = calc();
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
  const note = el("p","mass-note"); const good = c.tw >= 1.8;
  note.innerHTML = 'Thrust-to-weight with this build: <b class="'+(good?"good":c.tw>=1.2?"":"warn")+'">'+c.tw.toFixed(2)+'</b> — '+
    (c.tw>=2 ? "agile flight margin; suitable for all experiments."
     : c.tw>=1.5 ? "adequate margin for hover and steady flight experiments."
     : c.tw>=1.1 ? "marginal: the drone can hover but has little control authority."
     : "insufficient thrust — this configuration cannot sustain hover.");
  wrap.appendChild(note); body.appendChild(wrap);
}
/* rich charts modal — engineering curves computed live from spec.json, as a
   Chart.js gallery; each chart has an expand button for a single-chart detail. */
function openChartsDetail(){
  ChartHub.killPrefix("gc_");
  const body = openModal('Charts <em>· analysis · click any chart to expand</em>', "#c65d3b");
  const c = calc(), p = c.p, cr = crateCalc();
  const wrap = el("div","calc-blocks");

  // metric summary tiles — energy-relevant
  const tiles = el("div","metric-tiles");
  const mt = (k,v,cls)=>'<div class="metric-tile"><span class="mk">'+k+'</span><span class="mv '+(cls||"")+'">'+v+'</span></div>';
  tiles.innerHTML =
    mt("Pack voltage (loaded)", c.full.V.toFixed(1)+" V") +
    mt("Full-throttle draw", cr.drawA.toFixed(1)+" A", cr.overCont?"warn":"good") +
    mt("Continuous rating", cr.contA.toFixed(0)+" A") +
    mt("Hover current", c.hoverI.toFixed(1)+" A") +
    mt("Endurance (80% rule)", c.endur.toFixed(1)+" min", c.endur>=8?"good":"") +
    mt("Pack R_internal", (p.cells*cellIR(p,1)*1000).toFixed(1)+" mΩ");
  wrap.appendChild(tiles);

  // gallery — one block per chart def; Chart.js charts get a sized chart-box,
  // DOM charts (Sankey) render inline; every block has an expand button.
  const pending = [];                              // {id,cfg} — instantiated AFTER wrap is in the DOM
  chartDefs().forEach(def=>{
    const block = el("div","calc-block gchart");
    const head = el("div","gchart-head");
    head.innerHTML = '<h3>'+txt(def.title)+'</h3><button type="button" class="gchart-expand" title="Expand">⤢</button>';
    head.querySelector("button").addEventListener("click", ()=>openSingleChart(def));
    block.appendChild(head);
    if(def.dom){                                   // Sankey — DOM
      const host = el("div"); def.dom(host); block.appendChild(host);
    }else{                                         // Chart.js chart
      const cfg = def.cfg();
      if(cfg){ const box = el("div","chart-box-lg");
        box.innerHTML = '<canvas id="gc_'+def.id+'"></canvas>'; block.appendChild(box);
        pending.push({ id:"gc_"+def.id, cfg }); }
      else{ block.appendChild(el("div","runs-empty", txt(def.empty||"No data yet."))); }
    }
    if(def.note) block.appendChild(el("p","chart-footnote", txt(def.note())));
    wrap.appendChild(block);
  });
  body.appendChild(wrap);                          // attach first so the canvases exist…
  pending.forEach(pc=>ChartHub.put(pc.id, pc.cfg));// …then create the charts

  wrap.appendChild(el("p","calc-footnote",
    "Curves recompute live from the spec.json physics of the selected components and the altitude slider. "+
    "Pack OCV/cell = cellOCV(SoC); loaded voltage sags by I·R_internal, R_internal = cells × cell_IR (with low-SoC swell). "+
    "Endurance reuses the real assembled-drone hover solve (solveQuad bisection) at each hypothetical capacity, so the "+
    "capacity→endurance curve is sub-linear, not a straight ratio."));
}
function openCalcDetail(){
  const body = openModal("Detailed Calculations", "#c65d3b");
  const c = calc(), p = c.p;
  const cr = crateCalc(), sg = sagCalc(), ec = enduranceCalc(), sc = socCalc();
  const blocks = [
    { t:"A · C-Rating Safety Check", b:
        "I_max = C_rating × Capacity(Ah)\n"+
        "  continuous: "+p.cRatingCont+"C × "+cr.capAh.toFixed(2)+" Ah\n"+
        "  burst:      "+p.cRating+"C × "+cr.capAh.toFixed(2)+" Ah\n"+
        "Full-throttle 4-motor draw (solveQuad, real nonlinear sag): I_total = "+cr.drawA.toFixed(1)+" A",
      r:"I_max cont = "+cr.contA.toFixed(0)+" A · burst = "+cr.burstA.toFixed(0)+" A · draw = "+cr.drawA.toFixed(1)+
        " A — "+(cr.overCont?"EXCEEDS continuous rating":cr.overBurst?"exceeds burst rating":"within rating, "+cr.headroomPct.toFixed(0)+"% headroom") },
    { t:"B · Voltage Sag Under Load", b:
        "R_pack = cells × (cell_IR/1000) = "+p.cells+" × "+(sg.Rpack/p.cells*1000).toFixed(1)+" mΩ = "+(sg.Rpack*1000).toFixed(1)+" mΩ\n"+
        "V_loaded = V_nominal − I_total·R_internal, stepped over 5 current levels:\n"+
        sg.levels.map((I,i)=>"  I="+I.toFixed(1)+" A → V="+sg.linear[i].toFixed(2)+" V").join("\n")+"\n"+
        "Real nonlinear pack sag traced via solveQuad(throttle) — motor/prop coupling + IR swell",
      r:"R_internal ≈ "+(sg.Rpack*1000).toFixed(1)+" mΩ/pack · loaded V @ full draw = "+c.full.V.toFixed(2)+" V ("+(c.full.V/p.cells).toFixed(2)+" V/cell)" },
    { t:"C · Endurance & Diminishing Returns", b:
        "T_flight = (Capacity × 0.80 / I_avg) × 60,  I_avg = TRUE hover current (real hover solve, mass-coupled)\n"+
        ec.rows.map(r=>"  "+Math.round(r.capMah)+" mAh ("+r.massG.toFixed(0)+" g pack) → I_avg="+r.hoverI.toFixed(1)+" A → "+r.endur.toFixed(1)+" min (Peukert ×0.90: "+r.peukert.toFixed(1)+" min)").join("\n"),
      r:"capacity ×2 → endurance ×"+ec.gainMult.toFixed(2)+" (sub-linear — bigger isn't always proportionally better)" },
    { t:"D · SoC Discharge Mapping", b:
        "SoC%_naive = (V_cell − 3.5)/(4.2 − 3.5) × 100\n"+
        "True SoC recovered by inverting the OCV curve cellOCV(soc) (coulomb-counted physics)\n"+
        sc.points.map(pt=>"  V_cell="+pt.vCell.toFixed(2)+" V → true SoC="+pt.trueSoc.toFixed(0)+"% · naive SoC="+pt.naiveSoc.toFixed(0)+"%").join("\n"),
      r:"naive and true agree at the extremes, diverge mid-discharge where the OCV curve is flattest" }
  ];
  const wrap = el("div","calc-blocks");
  blocks.forEach(bl=>{
    const d = el("div","calc-block");
    d.innerHTML = '<h3>'+bl.t+'</h3><pre>'+bl.b+'</pre><div class="res">'+bl.r+'</div>';
    wrap.appendChild(d);
  });
  wrap.appendChild(el("p","calc-footnote",
    "All values recompute live from the spec.json physics of the selected components and the altitude slider. "+
    "cellOCV(soc) = 3.50 + 0.70·soc + 0.10·soc³ V/cell; R_pack = cells × cell_IR(soc) with low-SoC swell; "+
    "endurance and full-throttle draw reuse the same solveQuad physics as Module 1's assembled-drone solve."));
  body.appendChild(wrap);
}

/* ════════════ 11 · SIMULATION RUNNER ════════════ */
const SIM_DURATION = 12;
// flight-phase constants (ported from the reference FlightSim: real phase machine +
// 60x fast-forward once stable in hover so multi-minute endurance reads in a short run)
const LAUNCH_ALT = 0.10, PID_KP = 2.80, PID_KD = 1.90;
const AUTO_FF = 60, SHUTDOWN_SOC = 0.20, ALERT_SOC = 0.25;
const fmtMMSS = s => { s = Math.max(0, Math.floor(s)); const m = Math.floor(s/60), ss = s%60; return (m<10?"0":"")+m+":"+(ss<10?"0":"")+ss; };
let simActive = false;
const sim = { t:0, data:[], data2:[], dataX:[], key:null, exp:null, mod:null,
              alt:0, vel:0, soc:1, socNaive:1, temp:T_AMB, escTemp:T_AMB, timeScale:1, hoverD:.5,
              lastRpm:0, lastThr:0, verdict:null, verdictOk:null, overT:0, phase:"STANDBY", ff:false, flightMode:"manual",
              flightT:0, tPhase:0, tBurn:0, cutPwr:false, overheatLatch:false, isStall:false, isDeficit:false,
              reachedTarget:false, eRem:0, eTot:0, batStress:0 };
let calcCache = null, calcCacheAge = 0;
function calcCached(){
  if(!calcCache || (performance.now()-calcCacheAge) > 500){ calcCache = calc(); calcCacheAge = performance.now(); }
  return calcCache;
}
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
  sim.t = 0; sim.data = []; sim.data2 = []; sim.dataX = []; sim.exp = exp; sim.mod = mod;
  sim.key = mod.id+":"+exp.id; sim.alt = 0; sim.vel = 0; sim.soc = 1; sim.socNaive = 1;
  sim.temp = T_AMB; sim.escTemp = T_AMB; sim.verdict = null; sim.verdictOk = null; sim.lastRpm = 0; sim.lastThr = 0;
  sim.overT = 0; sim.phase = "PREFLIGHT"; sim.ff = false;
  sim._pop = false; sim._popAt = 0; sim.batStress = 0;
  const c = calc(); sim.hoverD = c.hoverD;
  // flight-only state (harmless to set for other metrics)
  sim.flightT = 0; sim.tPhase = 0; sim.tBurn = 0; sim.cutPwr = false; sim.overheatLatch = false;
  sim.reachedTarget = false;
  sim.isStall = c.full.stalled; sim.isDeficit = !sim.isStall && c.Tmax < c.W;
  sim.eTot = (c.p.cap/1000) * (c.p.cells*3.7) * 3600;   // J — nominal 3.7 V/cell pack energy
  sim.eRem = sim.eTot;
  // reset any swell/glow left over from a previous C-Rating fault run
  if(benchParts.battery){
    benchParts.battery.scale.setScalar(1);
    benchParts.battery.traverse(o => { if(o.isMesh && o.material && o.material.userData.__origEmissive){
      const orig = o.material.userData.__origEmissive;
      o.material.emissive.copy(orig.c); o.material.emissiveIntensity = orig.i; } });
  }
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
  $("ffBadge").hidden = true;
  if(completed && sim.data.length > 3){
    // keep ONLY this iteration's output (no history) — downsampled for snappy charts
    lastRun = { key:sim.key, metric:sim.exp.metric,
      data: downsample(sim.data, 240), data2: downsample(sim.data2, 240),
      dataX: downsample(sim.dataX||[], 240),
      flightT: sim.exp.metric==="endurance" ? (sim.flightT||0) : 0 };
    // COMPLETION RULE: only a PASS verdict marks the experiment done. A fault
    // run (smoke, brownout, swell, over-discharge…) plays out fully and its
    // trace is kept in lastRun/Charts, but it does NOT tick the progress bar —
    // the operator must find a configuration that actually passes.
    if(sim.verdictOk === true){
      state.done[sim.key] = true;
      saveState();
      renderModuleTabs(); renderExpTabs(); renderProgress();
      if(allDone()){ renderReward(); instrGo(DRONE_DB.instructor.length-1); sfx("unlock"); }
      else instrEvent("runDone");
    }
    sfx(sim.verdictOk ? "done" : "error");
    if(sim.verdict){ showVerdictToast(sim.verdict, sim.verdictOk); playFaultVoice(sim.verdict, sim.verdictOk); }
  }
  updateTelemetry({temp:sim.temp, esc:sim.escTemp, soc:sim.soc});
  drawLiveGraph();
}
function resetSim(){
  if(simActive) stopSim(false);
  sim.data = []; sim.data2 = []; sim.dataX = []; sim.temp = T_AMB; sim.escTemp = T_AMB; sim.soc = 1;
  $("ffBadge").hidden = true; syncRunControls();
  updateTelemetry({}); drawLiveGraph();
}
/* Show the throttle slider only where the operator actually drives it. The
   Endurance experiment (metric "endurance" — the real assembled-drone hover
   flight sim) is manual-only, no Auto-PID; the three bench experiments
   (crate/sag/soc) are fully procedural (ramp/discharge on their own). Called
   on every experiment / module switch so the flight controls never leak into
   a bench tab. */
function syncRunControls(){
  const metric = currentExp().exp.metric, isFlightExp = metric === "endurance";
  $("throttleWrap").hidden = !isFlightExp;
}
function showVerdictToast(text, ok){
  const t = el("div","verdict "+(ok?"pass":"fail"));
  t.style.cssText = "position:fixed;left:50%;top:74px;transform:translateX(-50%);z-index:120;box-shadow:0 10px 30px rgba(20,40,40,.25);max-width:440px";
  t.innerHTML = '<span class="vic">'+(ok?"✓":"×")+'</span><div class="vtx"><b>'+txt(text.split("—")[0])+'</b><span>'+txt(text.split("—").slice(1).join("—").trim())+'</span></div>';
  document.body.appendChild(t);
  setTimeout(()=>{ t.style.transition="opacity .5s"; t.style.opacity="0"; setTimeout(()=>t.remove(),500); }, 3600);
}
function simStep(dt){
  sim.t += dt;
  const cc = calcCached();
  const p = cc.p, m = cc.mkg, W = cc.W;
  const metric = sim.exp.metric;
  let tel = { temp: sim.temp };

  // ── battery stress → venting smoke: build pulls past its continuous C-rate,
  //    or the pack is deep-discharged in flight.
  const contA = (p.cap/1000) * p.cRatingCont;
  sim.batStress = Math.max(
    smokeRamp(cc.full.Itot, contA*0.95, contA*1.55),
    sim.soc < 0.08 ? smokeRamp(0.08 - sim.soc, 0, 0.06) : 0
  );

  // ── instant electrical pop: an over-voltage pack burns the ESC on spin-up.
  //    Let the run start so the user SEES it fail (sparks + smoke), then verdict.
  const overV = p.cells > p.escMaxCells || p.cells > p.motorMaxCells;
  if(overV){
    if(!sim._pop && sim.t > 0.5){
      sim._pop = true; sim._popAt = sim.t;
      FX.burstKind("esc", 9); FX.burstKind("motor", 3);
      sim.escTemp = 190; sfx("error");
    }
    if(sim._pop){
      sim.escTemp = Math.max(sim.escTemp, 176);         // keep it smoking
      if(sim.t - sim._popAt > 1.2){
        sim.verdictOk = false;
        sim.verdict = (p.cells>p.escMaxCells
          ? "ESC burnt out — "+p.cells+"S pack exceeds the "+p.escMaxCells+"S ESC voltage rating"
          : "Motor over-voltage — "+p.cells+"S exceeds the "+p.motorMaxCells+"S motor rating");
        stopSim(true); return;
      }
      updateTelemetry({ thrust:0, rpm:0, cur:0, pwr:0, temp:sim.temp, esc:sim.escTemp, alt:sim.alt,
                        phase:"ESC FAULT", phaseCls:"danger" });
      return;                                            // hold here, venting, until the verdict fires
    }
  }

  if(metric === "crate"){
    // C-Rating Safety Check — battery-analyzer bench. Ramp throttle 0→100% over
    // ~6 s so the pack's REAL 4-motor draw (solveQuad, nonlinear sag included)
    // climbs to its full value, and watch it against the continuous C-rating.
    const d = Math.min(sim.t/6, 1);
    const r = solveQuad(d, 1);
    const capAh = p.cap/1000;
    const contA = capAh * p.cRatingCont, burstA = capAh * p.cRating;
    sim.data.push(+r.Itot.toFixed(2));
    sim.data2.push(+contA.toFixed(2));      // reference line: continuous rating
    sim.lastRpm = r.rpm; sim.lastThr = r.Ttot;
    const overCont = r.Itot > contA;
    if(overCont) sim.overT += dt; else sim.overT = Math.max(0, sim.overT - dt*2);
    // battery stress → smoke (loop()'s FX.kindIntensity("battery", …)) + a
    // visible swell/emissive glow on the REAL battery model as the sustained
    // over-current fault builds.
    sim.batStress = smokeRamp(r.Itot, contA*0.98, burstA*1.05);
    const bm = benchParts.battery;
    if(bm){
      const swell = Math.min(sim.batStress, 1);
      bm.scale.setScalar(1 + swell*0.35);
      bm.traverse(o => { if(o.isMesh && o.material && o.material.emissive){
        const m = o.material;
        if(!m.userData.__origEmissive) m.userData.__origEmissive = { c:m.emissive.clone(), i:m.emissiveIntensity };
        m.emissive.copy(m.userData.__origEmissive.c).lerp(new THREE.Color(0xff5522), swell);
        m.emissiveIntensity = m.userData.__origEmissive.i + swell*1.4;
      } });
    }
    tel = { v:r.V, thrust:r.Ttot, rpm:r.rpm, cur:r.Itot, pwr:r.P, temp:T_AMB+sim.batStress*70, alt:0,
            phase: overCont?"C-RATE EXCEEDED":d>=1?"FULL DRAW":"RAMPING",
            phaseCls: overCont?"danger":d>=1?"good":"" };
    updateTelemetry(tel);
    if(sim.overT >= 3.0){
      sim.verdictOk = false;
      sim.verdict = "Battery vented — sustained "+r.Itot.toFixed(0)+" A draw exceeds the "+contA.toFixed(0)+
        " A continuous rating ("+p.cRatingCont+"C pack). Cells overheated and swelled.";
      FX.burstKind("battery", 5); sfx("error"); stopSim(true);
      return;
    }
    if(sim.t >= SIM_DURATION){
      sim.verdictOk = !overCont;
      sim.verdict = overCont
        ? "Marginal — full-throttle draw "+r.Itot.toFixed(0)+" A exceeds the "+contA.toFixed(0)+" A continuous rating"
        : "Within rating — full-throttle draw "+r.Itot.toFixed(0)+" A vs "+contA.toFixed(0)+" A continuous limit ("+
          Math.max(0,(contA-r.Itot)/contA*100).toFixed(0)+"% headroom)";
      stopSim(true);
    }
    return;
  }

  if(metric === "sag"){
    // Voltage Sag Under Load — battery-analyzer bench. Ramp throttle 0→100%
    // over ~8 s and trace the real (nonlinear) loaded pack voltage; a brownout
    // is a sustained sag below 3.30 V/cell.
    const d = Math.min(sim.t/8, 1);
    const r = solveQuad(d, 1);
    sim.data.push(+r.V.toFixed(3));         // loaded pack voltage
    sim.data2.push(+r.Itot.toFixed(2));     // total current
    const vCell = r.V / p.cells;
    const brownout = vCell < 3.30;
    if(brownout) sim.overT += dt; else sim.overT = Math.max(0, sim.overT - dt*2);
    sim.lastRpm = brownout ? sim.lastRpm*Math.max(0, 1-sim.overT/1.5) : r.rpm;
    sim.lastThr = r.Ttot;
    tel = { v:r.V, thrust:r.Ttot, rpm:sim.lastRpm, cur:r.Itot, pwr:r.P, temp:T_AMB, alt:0,
            phase: brownout?"ESC BROWNOUT":d>=1?"FULL DRAW":"RAMPING",
            phaseCls: brownout?"danger":d>=1?"good":"" };
    updateTelemetry(tel);
    if(sim.overT >= 1.5){
      sim.verdictOk = false;
      sim.verdict = "ESC brownout — loaded voltage sagged to "+vCell.toFixed(2)+
        " V/cell (below 3.30 V/cell); RPM collapsed under load.";
      sfx("error"); stopSim(true);
      return;
    }
    if(sim.t >= SIM_DURATION){
      const Rpack = p.cells*cellIR(p,1);
      sim.verdictOk = vCell >= 3.5;
      sim.verdict = vCell>=3.5
        ? "Sag under control — "+vCell.toFixed(2)+" V/cell at full draw (R_internal "+(Rpack*1000).toFixed(1)+" mΩ pack)"
        : "Excessive sag — "+vCell.toFixed(2)+" V/cell at full draw, little brownout margin left";
      stopSim(true);
    }
    return;
  }

  if(metric === "soc"){
    // SoC Discharge Mapping — discharge rig. A fixed bench load current pulls
    // the pack down while we coulomb-count TWO SoC estimates in parallel:
    //  · sim.socNaive — counted against the pack's NAMEPLATE capacity (what a
    //    simple rig readout shows)
    //  · sim.soc      — counted against the REAL Peukert-derated capacity for
    //    this pack's C-rating (a genuinely low-C pack delivers less than its
    //    nameplate mAh at a real load — a C-rating-scaled reality-check factor)
    // The rig auto-cuts at the 20% SoC / 3.5 V-per-cell floor — the safe path.
    // If the true pack empties (real SoC hits the floor) before the naive
    // readout would have cut it off, the cell over-discharges: FAULT.
    const scale = 60;    // time-compression: maps the bench discharge onto the fixed
                          // SIM_DURATION run so a healthy pack's auto-cut is actually
                          // reached (the old 26/SIM_DURATION≈2.2 factor left so little
                          // simulated depletion in 12 s that neither the auto-cut nor
                          // the over-discharge floor was ever reachable).
    const capAh = p.cap/1000;
    // Peukert derating scales with the pack's OWN continuous C-rating: a
    // genuinely low-C pack is also higher-IR (that's what actually caps its
    // C-rating), so it delivers noticeably less than nameplate mAh under load;
    // a race-grade high-C pack tracks its nameplate almost exactly.
    const peukertFactor = p.cRatingCont >= 30 ? 1.0
      : p.cRatingCont >= 20 ? 0.90 + (p.cRatingCont-20)*(1.0-0.90)/(30-20)
      : p.cRatingCont >= 12 ? 0.72 + (p.cRatingCont-12)*(0.90-0.72)/(20-12)
      : 0.70;
    const effCapAh = capAh * peukertFactor;
    const Iload = Math.max(1, capAh * Math.min(p.cRatingCont*0.6, 6));   // representative bench load current
    const rIR = cellIR(p, sim.soc), Rpack = p.cells*rIR;
    const vPackOCV = cellOCV(sim.soc) * p.cells;
    const vPackLoaded = Math.max(vPackOCV - Iload*Rpack, p.cells*2.6);
    const vCellLoaded = vPackLoaded / p.cells;
    const drawnAh = Iload*dt*scale/3600;
    sim.soc = Math.max(0, sim.soc - drawnAh/effCapAh);          // true (Peukert-derated) coulomb count
    sim.socNaive = Math.max(0, sim.socNaive - drawnAh/capAh);   // naive nameplate coulomb count
    sim.data.push(+vCellLoaded.toFixed(3));
    sim.dataX.push(+(sim.socNaive*100).toFixed(1));             // x-axis: naive SoC% readout on the rig display
    sim.data2.push(+(sim.soc*100).toFixed(1));
    sim.lastThr = 0; sim.lastRpm = 0;
    // The rig's auto-cut only WATCHES the coulomb-counted (naive, nameplate-
    // capacity) readout — no direct per-cell voltage sensing, same as a cheap
    // real-world fuel gauge. That's fine for a healthy high-C pack (true and
    // naive SoC track together, so the real cell voltage never gets close to
    // 3.5 V before the 20% cutoff fires). A genuinely low-C pack delivers
    // LESS than nameplate at this load (Peukert), so its REAL voltage can
    // fall through the 3.5 V floor while the naive readout still shows a
    // comfortable margin — the rig has no way to see that: FAULT.
    const autoCutArmed = sim.socNaive <= SHUTDOWN_SOC;
    const overDischarged = vCellLoaded < 3.5 && sim.socNaive > SHUTDOWN_SOC;
    // progressive puff as the true cell voltage approaches/crosses the safe floor
    const puffStress = smokeRamp(3.55 - vCellLoaded, 0, 0.15);
    sim.batStress = Math.max(sim.batStress, puffStress);
    const bmS = benchParts.battery;
    if(bmS && puffStress > 0){
      bmS.scale.setScalar(1 + Math.min(puffStress,1)*0.25);
      bmS.traverse(o => { if(o.isMesh && o.material && o.material.emissive){
        const m = o.material;
        if(!m.userData.__origEmissive) m.userData.__origEmissive = { c:m.emissive.clone(), i:m.emissiveIntensity };
        m.emissive.copy(m.userData.__origEmissive.c).lerp(new THREE.Color(0xff5522), Math.min(puffStress,1));
        m.emissiveIntensity = m.userData.__origEmissive.i + Math.min(puffStress,1)*1.2;
      } });
    }
    tel = { v:vPackLoaded, thrust:0, rpm:0, cur:Iload, pwr:vPackLoaded*Iload, temp:T_AMB+(overDischarged?30:0), soc:sim.socNaive, alt:0,
            phase: overDischarged?"OVER-DISCHARGE":autoCutArmed?"AUTO-CUT":"DISCHARGING",
            phaseCls: overDischarged?"danger":autoCutArmed?"warn":"" };
    updateTelemetry(tel);
    if(overDischarged){
      sim.verdictOk = false;
      sim.verdict = "Cell over-discharged — true SoC hit the 3.5 V/cell floor while the naive nameplate readout still showed "+
        (sim.socNaive*100).toFixed(0)+"% remaining (Peukert-derated pack, "+p.cRatingCont+"C). Cell puffed — permanent damage.";
      FX.burstKind("battery", 5); sfx("error"); stopSim(true);
      return;
    }
    if(autoCutArmed){
      sim.verdictOk = true;
      sim.verdict = "Auto-cut protected the pack — stopped at "+(sim.socNaive*100).toFixed(0)+
        "% SoC / "+vCellLoaded.toFixed(2)+" V/cell, before the 3.5 V floor was breached.";
      stopSim(true);
      return;
    }
    if(sim.t >= SIM_DURATION){
      // ran the full window without reaching either floor (very large / lightly loaded pack)
      sim.verdictOk = true;
      sim.verdict = "Discharge mapped safely — pack never approached the 20% / 3.5 V/cell floor in this run.";
      stopSim(true);
    }
    return;
  }

  // metric === "endurance" — Endurance & Diminishing Returns: reuses the REAL
  // assembled-drone hover flight sim (RK4 vertical dynamics @ 5 ms substeps, a
  // real manual flight computer PREFLIGHT/MANUAL/DESCENT/POSTFLIGHT, true
  // elapsed flight-time clock with a 60x fast-forward once stable at the
  // commanded altitude, SoC-coupled voltage sag + thermal faults) so the
  // endurance number comes from the same physics as Module 1, not a
  // separate estimate.
  const T_hover = cc.W / 4;                              // per-motor hover thrust (N)

  // one-shot pre-flight faults: never leaves the pad (classified once at runSim from calc())
  if(sim.isStall || sim.isDeficit){
    sim.phase = sim.isStall ? "STALLED" : "THRUST DEFICIT";
    sim.lastRpm = 0; sim.lastThr = 0;
    updateTelemetry({ thrust:0, rpm:0, cur:0, pwr:0, temp:sim.temp, esc:sim.escTemp, soc:sim.soc, alt:0,
                       phase: sim.phase+" · "+fmtMMSS(0), phaseCls: sim.isStall?"danger":"warn" });
    if(sim.t > 3.0){
      sim.verdictOk = false;
      sim.verdict = sim.isStall
        ? "Motor stalled — propeller too heavy for this motor"
        : "Cannot hover — bigger isn't always better: this pack's added mass ("+cc.mkg.toFixed(2)+
          " kg AUW) pushed thrust-to-weight to "+cc.tw.toFixed(2)+" (max thrust "+cc.Tmax.toFixed(1)+
          " N vs weight "+cc.W.toFixed(1)+" N)";
      stopSim(true);
    }
    return;
  }

  // stable-hover check uses END-OF-LAST-FRAME alt/vel (mirrors the reference: state persists between ticks)
  let isStableHover = false;
  if(sim.phase==="MANUAL"){
    const targetAlt0 = LAUNCH_ALT + (4-LAUNCH_ALT)*((state.manualThrottle||0)/100);
    isStableHover = Math.abs(targetAlt0-sim.alt) < 0.05 && Math.abs(sim.vel) < 0.05;
    if(isStableHover) sim.reachedTarget = true;   // commanded altitude actually held, at least once
  }
  const speedMul = (!sim.cutPwr && !sim.overheatLatch && isStableHover) ? AUTO_FF : 1;
  const dtAcc = dt * speedMul;
  const subDt = 0.005, steps = Math.max(1, Math.ceil(dtAcc/subDt)), dtStep = dtAcc/steps;
  const socStart = sim.soc;
  const opMax = solveQuad(1, socStart);                  // per-frame max-throttle ceiling at current pack sag
  const Tmax1 = opMax.stalled ? 0 : opMax.Tper;

  const ch = opt("chasis"), Aq = (ch && ch.phys.frontal_area_m2) || 0.01, Cdq = (ch && ch.phys.cd) || 1.05;
  const Adisk = Math.PI*(cc.p.D/2)*(cc.p.D/2);
  function getAcc(y, vy, thrPerMotor){
    const standoff = Math.max(y - LAUNCH_ALT, cc.p.D*0.25);
    const geTerm = cc.p.D/(4*standoff);
    let th = thrPerMotor;
    if(geTerm < 0.99) th *= Math.min(1/(1-geTerm*geTerm), 1.75);            // ground effect
    const vInd = Math.sqrt(Math.max(0.1, th) / (2*cc.rho*Adisk));
    th *= Math.max(0.2, 1 - 0.45*vy/vInd);                                  // momentum-theory inflow damping
    const drag = 0.5*cc.rho*Cdq*Aq*vy*Math.abs(vy);
    return (th*4 - W - drag) / m;
  }

  let curThrust = 0, landed = false;
  for(let s=0; s<steps; s++){
    if(sim.cutPwr){ curThrust = 0; }
    else if(sim.phase==="PREFLIGHT"){
      sim.tPhase += dtStep;
      curThrust = T_hover*0.18*Math.min(sim.tPhase/1.5, 1);
      if(sim.tPhase >= 1.5){ sim.tPhase = 0; sim.phase = "MANUAL"; }
    }else if(sim.phase==="MANUAL"){
      const thrPct = state.manualThrottle||0;
      if(thrPct <= 1){ curThrust = T_hover*0.18; }
      else{
        const targetAlt = LAUNCH_ALT + (4-LAUNCH_ALT)*(thrPct/100);
        const errA = targetAlt - sim.alt;
        curThrust = Math.min(Math.max(T_hover + PID_KP*errA + PID_KD*(-sim.vel), T_hover*0.5), T_hover*1.5);
      }
      if(socStart <= SHUTDOWN_SOC){ sim.tPhase = 0; sim.phase = "DESCENT"; }
    }else if(sim.phase==="DESCENT"){
      sim.tPhase += dtStep;
      const ramp = Math.max(0, Math.cos((sim.tPhase/5)*Math.PI*0.5));
      curThrust = T_hover*(0.7+0.3*ramp);
    }else if(sim.phase==="POSTFLIGHT"){
      sim.tPhase += dtStep;
      const ramp = Math.max(0, 1-(sim.tPhase/3));
      curThrust = T_hover*0.18*ramp;
    }
    curThrust = Math.min(curThrust, Tmax1);

    const k1y = sim.vel,                       k1v = getAcc(sim.alt, sim.vel, curThrust);
    const k2y = sim.vel+0.5*dtStep*k1v,        k2v = getAcc(sim.alt+0.5*dtStep*k1y, k2y, curThrust);
    const k3y = sim.vel+0.5*dtStep*k2v,        k3v = getAcc(sim.alt+0.5*dtStep*k2y, k3y, curThrust);
    const k4y = sim.vel+dtStep*k3v,            k4v = getAcc(sim.alt+dtStep*k3y, k4y, curThrust);
    sim.alt += (dtStep/6)*(k1y+2*k2y+2*k3y+k4y);
    sim.vel += (dtStep/6)*(k1v+2*k2v+2*k3v+k4v);
    sim.vel = Math.max(-3, Math.min(3, sim.vel));

    // cheap conservative SoC estimate inside the substep loop (mirrors reference: uses the
    // per-frame max-throttle op point, not a fresh solve, purely to trigger phase transitions)
    const estSoc = sim.eTot>0 ? (sim.eRem - opMax.P*dtStep*s)/sim.eTot : 1;

    if(sim.alt <= LAUNCH_ALT){
      sim.alt = LAUNCH_ALT; sim.vel = 0;
      const isDead = sim.cutPwr || estSoc <= 0.001;
      if(sim.phase==="DESCENT" || isDead){
        if(isDead){ sim.phase = sim.cutPwr ? "BURNED!" : "LANDED"; landed = true; sim.lastRpm = 0; break; }
        else{ sim.phase = "POSTFLIGHT"; sim.tPhase = 0; }
      }else if(sim.phase==="POSTFLIGHT" && sim.tPhase >= 3){
        sim.phase = "LANDED"; landed = true; break;
      }
    }
    sim.alt = Math.min(sim.alt, 4.0);
    if(sim.alt > LAUNCH_ALT+0.01 && sim.phase !== "LANDED") sim.flightT += dtStep;
  }

  if(landed){
    if(sim.phase === "BURNED!"){
      sim.verdictOk = false;
      sim.verdict = "Powertrain burned out mid-flight — motor "+Math.round(sim.temp)+"°C / ESC "+Math.round(sim.escTemp)+"°C, sustained 3 s over limit";
    }else{
      sim.verdictOk = cc.tw > 1.05 && sim.reachedTarget;
      const targetTxt = (LAUNCH_ALT+(4-LAUNCH_ALT)*((state.manualThrottle||0)/100)).toFixed(1);
      sim.verdict = cc.tw<=1.05 ? "Cannot hover — bigger isn't always better (T/W "+cc.tw.toFixed(2)+")"
                  : sim.reachedTarget ? "Endurance verified — hovered "+fmtMMSS(sim.flightT)+" and landed safely at "+
                    Math.round(sim.soc*100)+"% SoC before the auto-cut"
                  : "Underpowered — never reached the "+targetTxt+" m target";
    }
    updateTelemetry({ thrust:0, rpm:0, cur:0, pwr:0, temp:sim.temp, esc:sim.escTemp, soc:sim.soc, alt:sim.alt,
                       phase: sim.phase+" · "+fmtMMSS(sim.flightT), phaseCls: sim.phase==="BURNED!"?"danger":sim.verdictOk?"good":"warn" });
    $("ffBadge").hidden = true;
    stopSim(true);
    return;
  }

  // reconstruct the electrical operating point once per frame (not per substep) at the
  // commanded thrust — bisect duty so solveQuad's per-motor thrust matches curThrust
  const finalT = sim.cutPwr ? 0 : curThrust;
  let duty = 0;
  if(finalT > 0){
    let lo=0, hi=1;
    for(let i=0;i<16;i++){ const mid=(lo+hi)/2; (solveQuad(mid,socStart).Tper < finalT) ? lo=mid : hi=mid; }
    duty = (lo+hi)/2;
  }
  const op = solveQuad(duty, socStart);

  // battery energy drain over the (possibly fast-forwarded) elapsed time
  sim.eRem = Math.max(0, sim.eRem - op.P*dtAcc);
  sim.soc = sim.eTot>0 ? sim.eRem/sim.eTot : 0;

  // motor + ESC thermal tracking in flight, driven by the real dt_acc
  const indVel = Math.sqrt(Math.max(op.Tper,0) / Math.max(2*cc.rho*Adisk, .001));
  sim.temp = motorThermalStep(sim.temp, op.Iper*op.Iper*motorRm(cc.p, sim.temp), indVel, cc.p, dtAcc);
  sim.escTemp = escThermalStep(sim.escTemp, op.Iper, cc.p, dtAcc);

  const overheat = sim.temp > 150 || sim.escTemp > 110;
  if(overheat){
    sim.overheatLatch = true;
    sim.tBurn += dtAcc;
    if(sim.tBurn >= 3.0 && !sim.cutPwr){
      sim.cutPwr = true;
      FX.burstKind("motor", 8); FX.burstKind("esc", 8); sfx("error");
    }
  }

  sim.ff = speedMul > 1;
  $("ffBadge").hidden = !sim.ff;
  sim.lastRpm = sim.cutPwr ? 0 : op.rpm; sim.lastThr = finalT*4;
  sim.data.push(+(sim.soc*100).toFixed(1));    // state of charge (%)
  sim.data2.push(+op.V.toFixed(2));            // pack voltage (V)

  // display phase text — cutPwr/overheat/low-battery override the raw phase
  let phaseText, phaseCls;
  if(overheat){ phaseText = "OVERHEAT!"; phaseCls = "danger"; }
  else if(sim.soc*100 <= ALERT_SOC*100){ phaseText = "LOW BATTERY"; phaseCls = "warn"; }
  else{ phaseText = sim.alt>LAUNCH_ALT+0.01 ? "FLIGHT" : "MANUAL"; phaseCls = sim.alt>LAUNCH_ALT+0.01 ? "good" : ""; }
  tel = { v:op.V, thrust:finalT*4, rpm:op.rpm, cur:op.Itot, pwr:op.P, temp:sim.temp, esc:sim.escTemp, soc:sim.soc, alt:sim.alt,
          phase: phaseText+" · "+fmtMMSS(sim.flightT), phaseCls };
  updateTelemetry(tel);

  if(sim.soc <= 0.02 && sim.alt > 0.3){
    sim.verdictOk = false;
    sim.verdict = "Battery depleted mid-air — landed hard from "+sim.alt.toFixed(1)+" m";
    $("ffBadge").hidden = true;
    stopSim(true);
  }
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
/* The reference's recorded voice lines are drone-assembly/bench specific and
   don't match this lab's script, EXCEPT the hover-flight intro/outro clips —
   the Endurance experiment genuinely reuses that same hover flight sim, so
   its narration still applies. Everything else stays silent (audio:null,
   same "pending hook" pattern the instructor script already uses) rather
   than play a voice line that describes the wrong experiment. */
const INTRO_FILES = {
  "m2:endurance":"assets/audio/voice/intro_hover.mp3"
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
/* Maps this lab's verdict text onto the reference's recorded voice lines
   where the content still genuinely applies (hover/landed for the reused
   flight sim, thrust-deficit for "cannot hover", critical for a battery
   that's actually damaged); everything else stays silent rather than
   narrate the wrong scenario. */
function playFaultVoice(text, ok){
  const t = (text||"").toLowerCase();
  let tag = null;
  if(ok){ if(t.includes("endurance verified")) tag="hover_reached";
    else if(t.includes("landed")) tag="landed_safely";
    else if(t.includes("within rating")||t.includes("sag under control")||t.includes("auto-cut protected")) tag="profiling_complete"; }
  else{ if(t.includes("esc burnt")) tag="esc_burnt";
    else if(t.includes("cannot hover")) tag="thrust_deficit";
    else if(t.includes("vented")||t.includes("over-discharged")||t.includes("burned out")) tag="critical"; }
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
function audioUpdate(){
  if(!engine || !actx) return;
  const ctx = actx;
  // rpm → frequencies
  const rpm = engine.cur + (sim.lastRpm - engine.cur)*0.15;   // smooth
  engine.cur = rpm;
  const rev = rpm/60;                       // shaft rev/s
  const p = propulsionParams();
  const blade = rev * (p.blades||2);
  const load = Math.min((sim.lastThr||0)/ (calcCached().Tmax||1), 1.4);
  const flying = sim.exp && sim.exp.metric==="endurance";
  engine.rumble.frequency.setTargetAtTime(Math.max(rev,10), ctx.currentTime, .05);
  engine.whine.frequency.setTargetAtTime(Math.max(blade,40), ctx.currentTime, .05);
  engine.bp.frequency.setTargetAtTime(Math.min(400+blade*1.4, 5200), ctx.currentTime, .05);
  // level rises with rpm & load; a touch of extra air when flying
  const lvl = Math.min(0.25 + rpm/9000*0.7, 1.0) * (flying?1.05:1);
  engine.g.gain.setTargetAtTime(lvl*Math.min(0.6+load*0.5,1.2), ctx.currentTime, .08);
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
    if(isBench()){
      // bench-mounted (battery-analyzer / discharge rig): no vertical motion,
      // faint vibration while the current draw is high
      let sx=0, sz=0;
      if(simActive && (sim.exp.metric==="crate"||sim.exp.metric==="sag")){
        const amp = Math.min((sim.data[sim.data.length-1]||0)/40*.006, .02);
        sx=(Math.random()-.5)*amp; sz=(Math.random()-.5)*amp;
      }
      rig.position.set(sx,0,sz);
    }else{
      // Endurance — real hover flight; camera/orbit-target follow altitude
      // smoothly (translate, don't rotate, to avoid disorientation). The
      // assembled drone RESTS ON THE GROUND whenever the sim is idle, and
      // only lifts to hover / climb height while a run is active.
      const flying = simActive && sim.exp && sim.exp.metric==="endurance";
      const hoverH = isFlight() ? 1.0 : 1.15;
      let targetY;
      if(!simActive){
        // seat the drone's lowest point on the grid (world y = 0)
        const box = new THREE.Box3().setFromObject(rig);
        targetY = rig.position.y - box.min.y;
      }else if(flying){
        targetY = 1.0 + Math.min(sim.alt,4.5)*0.75;
      }else{
        targetY = hoverH + Math.sin(hoverPhase)*.04;
      }
      // smooth take-off / landing lerp
      const ny = rig.position.y + (targetY - rig.position.y) * (simActive?0.12:0.18);
      rig.position.set(simActive?(Math.random()-.5)*.01:0, ny, 0);
      if(flying && controls){
        const ctrlTargetY = ny + 0.05;
        const dy = (ctrlTargetY - controls.target.y) * 0.08;
        controls.target.y += dy; camera.position.y += dy;
      }
    }
    // props are stationary when the drone is landed / powered down
    const spin = simActive ? Math.min((sim.lastRpm||0)/3200, 3.4) + .15 : 0;
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
  // failure smoke/sparks driven by live sim stress (motor & ESC temp, battery sag)
  if(simActive){
    FX.kindIntensity("motor",   smokeRamp(sim.temp,    130, 250));
    FX.kindIntensity("esc",     smokeRamp(sim.escTemp,  95, 170));
    FX.kindIntensity("battery", sim.batStress || 0);
  }else{
    FX.kindIntensity("motor", 0); FX.kindIntensity("esc", 0); FX.kindIntensity("battery", 0);
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
  renderModuleTabs();
  renderExpTabs();
  renderProgress();
  renderCalcChips();
  renderLog();
  renderReward();
  renderInstr();
  syncRunControls();
  drawLiveGraph();
  drawMassChart();
  $("altSlider").value = state.altitude;
  $("altVal").textContent = state.altitude+" m";
  $("rhoVal").textContent = rhoAt(state.altitude).toFixed(4)+" kg/m\u00b3";
  $("throttleSlider").value = state.manualThrottle;
  $("throttleVal").textContent = state.manualThrottle+"%";
  $("voiceVol").value = state.voiceVol; $("voiceVolTxt").textContent = state.voiceVol;
  $("sfxVol").value = state.sfxVol; $("sfxVolTxt").textContent = state.sfxVol;
  $("altSlider").addEventListener("input", e=>{
    state.altitude = +e.target.value;
    $("altVal").textContent = state.altitude+" m";
    $("rhoVal").textContent = rhoAt(state.altitude).toFixed(4)+" kg/m\u00b3";
    calcCache = null; renderCalcChips(); renderLog(); saveState();
  });
  $("throttleSlider").addEventListener("input", e=>{
    state.manualThrottle = +e.target.value;
    $("throttleVal").textContent = state.manualThrottle+"%";
    saveState();
  });
  $("massCard").addEventListener("click", openMassDetail);
  $("calcCard").addEventListener("click", openCalcDetail);
  $("logHead").addEventListener("click", openChartsDetail);
  $("graphCard").addEventListener("click", openGraphDetail);
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
  // Chart.js auto-resizes active charts; the empty-state raw canvas needs a redraw
  let _rzT = 0;
  window.addEventListener("resize", ()=>{ clearTimeout(_rzT); _rzT = setTimeout(()=>{ if(!ChartHub.reg["liveGraph"]) drawLiveGraph(); }, 120); });
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

/* invalidate cached calc when selection changes */
const _origRefresh = refreshAfterSelection;
refreshAfterSelection = function(key){ calcCache = null; _origRefresh(key); };
