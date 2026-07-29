/* ════════════════════════════════════════════════════════════════
   DRONE TECHNOLOGY LAB — main.js  (Exp-10 · Mission Performance)
   Data-driven from assets/manifest.json + one spec.json per option.

   MODULES
     M1 Power & Speed    — Power Profiling (U-shaped cruise-power curve)
                            Endurance Speed (minimum-power / max-range speed)
     M2 Mission & Range  — Mission Energy (phase energy budget, Wh)
                            Range–Payload (range vs payload, 3 battery sizes)

   Closed-form mission model — no per-frame motor/ESC solve needed for the
   mission metrics; the legacy propulsion solver (calcMotorPoint/solveQuad)
   is kept only to power the Diagnostics Log's current/voltage/T-W checks.

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
  /* Reward pool. The reward names a CATEGORY and the unlock draws a random real
     component from it. That category is not always a selectable one in this
     experiment (exp-03 awards a propeller but never lets you pick one), so any
     option that wasn't already loaded is fetched straight from its spec.json. */
  const rwCfg = manifest.reward || {};
  let rewardPool = [];
  if(rwCfg.category){
    const inCat = byCat[rwCfg.category] || [];
    const wantIds = rwCfg.options || inCat.map(o=>o.id);
    const missing = wantIds.filter(id => !inCat.some(o=>o.id===id));
    let extra = [];
    if(missing.length){
      extra = (await Promise.all(missing.map(async id=>{
        const base = "assets/" + rwCfg.category + "/" + id;
        try{
          const spec = await (await fetch(base + "/spec.json", {cache:"no-store"})).json();
          let files = [];
          if(spec.model){
            const arr = Array.isArray(spec.model) ? spec.model : [spec.model];
            files = arr.map(f => f.includes("/") ? f : base + "/" + f);
          }
          return { id, name: spec.name || id, catKey: rwCfg.category,
                   mass: spec.mass_g || 0, qty: spec.qty || 1,
                   size: spec.size_mm || null, view: spec.view || null,
                   specs: Object.entries(spec.specs || {}), phys: spec.physics || {},
                   files, mounts: null,
                   fallback: { kind: rwCfg.fallback || "none", color: 0x5a6672, s: 1 } };
        }catch(e){ console.warn("reward spec missing for", base); return null; }
      }))).filter(Boolean);
    }
    const all = inCat.concat(extra);
    rewardPool = wantIds.map(id => all.find(o=>o.id===id)).filter(Boolean);
  }
  DRONE_DB = {
    categories,
    defaults: manifest.defaults || {},
    modules: manifest.modules,
    instructor: manifest.instructor,
    /* The reward is no longer one hardcoded mesh: it names a CATEGORY, and the
       unlock draws a random real component from it (a random motor, a random
       airframe, …). Because the drawn option is a genuine catalogue entry it
       carries its own catKey, so fitUnit applies the same orientation rule the
       component uses everywhere else — the old reward object had no catKey at
       all, which is why it rendered at an arbitrary angle. */
        reward: { category: rwCfg.category || null, name: rwCfg.name || "", desc: rwCfg.desc || "",
              fallback: { kind: rwCfg.fallback || "lidar", color: 0x845b23, s: 1 }, pool: rewardPool }
  };
}

/* ════════════ 2 · STATE + PERSISTENCE ════════════ */
const LS_KEY = "dtl-exp10";
const state = {
  sel:{}, altitude:0, payload:0, airspeed:10, module:"m1", exp:{},
  done:{}, voiceVol:80, sfxVol:60, instrStep:0,
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
  state.altitude = s.altitude != null ? s.altitude : 0;
  state.payload = s.payload != null ? Math.max(0, Math.min(2000, s.payload)) : 0;
  state.airspeed = s.airspeed != null ? Math.max(2, Math.min(20, s.airspeed)) : 10;
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
      sel:state.sel, altitude:state.altitude, payload:state.payload, airspeed:state.airspeed,
      module:state.module, exp:state.exp,
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
  // Exp-10: payload is a slider input, not a picked component — folded into the
  // mass budget as a synthetic row so Mass Budget / T-W / the mission model all
  // stay live with the current cargo.
  rows.push({ key:"payload", label:"Payload",
    name: state.payload>0 ? state.payload+" g cargo" : "None",
    qty: state.payload>0 ? 1 : 0, mass: state.payload||0 });
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
/* Module N unlocks once every experiment in module N-1 has passed. Module 1 is
   always unlocked. Exp-10 has no dedicated "assembly" gate experiment like the
   reference platform, so the gate is generic over module order. */
function moduleUnlocked(m){
  const idx = DRONE_DB.modules.findIndex(x=>x.id===m.id);
  if(idx <= 0) return true;
  const prev = DRONE_DB.modules[idx-1];
  return prev.experiments.every(e=>state.done[prev.id+":"+e.id]);
}
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

function propulsionParams(){
  const mo = opt("motor"), pr = opt("propeller"), ba = opt("battery"), esc = opt("esc");
  const mp = (mo && mo.phys) || {}, pp = (pr && pr.phys) || {}, bp = (ba && ba.phys) || {}, ep = (esc && esc.phys) || {};
  const dia_in = pp.diameter_in || 8;
  return {
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
}
/* battery open-circuit voltage per cell (soc 0..1) — nonlinear discharge curve */
const cellOCV = soc => { soc = Math.max(0, Math.min(1, soc)); return 3.50 + 0.70*soc + 0.10*soc*soc*soc; };
/* per-cell internal resistance incl. low-SoC swell */
function cellIR(p, soc){
  soc = Math.max(0.02, Math.min(1, soc==null?1:soc));
  const base = 0.012 * (1500/Math.max(p.cap,200));
  const swell = 1 + 0.25*Math.exp(5*(0.3 - soc));
  return base*swell;
}
function motorRm(p, tempC){ return p.rm20 * (1 + ALPHA_CU*((tempC==null?20:tempC) - 20)); }

/* BEMT-lite propeller aero coefficients — pitch/diameter + Reynolds + figure of merit.

   Ct is a static thrust coefficient fitted to the catalogue's hand-authored
   empirical propellers (5x4.3 tri -> 0.130, 10x4.5 bi -> 0.100).

   Cq is NOT an independent fit. Hover shaft power must equal the induced power
   divided by the rotor's figure of merit:

       2*pi*Cq*rho*n^3*D^5  =  T^1.5 / (FoM * sqrt(2*rho*A)),   T = Ct*rho*n^2*D^4

   which reduces to  Cq = Ct^1.5 * 0.12699 / FoM.  Deriving Cq this way keeps
   thrust and torque thermodynamically consistent — the previous independent
   `ct*(0.045*reFactor + 0.11*pd)` fit drifted about 30% high on torque while Ct
   itself read ~20% low, so every build drew far more current than the same parts
   would in reality. Bigger discs are more efficient; low Reynolds (small, slow
   props) costs figure of merit. */
function propAero(p, omega){
  const pd = Math.max(0.2, Math.min(1.2, p.pitchIn / Math.max(p.diaIn,1)));
  const R = p.D/2, chord = 0.1*p.D;
  const Vtip = Math.max(omega*R, 0.5);
  const rho = rhoNow();
  const Re = Math.max(rho * Vtip * chord / MU_AIR, 1000);
  const reFactor = Math.pow(150000/Re, 0.25);
  const ctStatic = p.ctRaw!=null ? p.ctRaw : 0.067 + 0.073*pd;
  const fom = Math.max(0.40, Math.min(0.78, 0.42 + 0.022*p.diaIn)) / Math.sqrt(Math.max(reFactor,1));
  const cqEff = p.cqRaw!=null ? p.cqRaw : Math.pow(ctStatic,1.5)*0.12699/Math.max(fom,0.25);
  return { ctEff: ctStatic, cqEff, rho };
}
/* solve steady-state motor+prop point via quadratic torque balance. returns null on stall. */
function calcMotorPoint(duty, V, Rm, Resc){
  const p = propulsionParams();
  if(duty <= 0 || V <= 0) return { rpm:0, omega:0, T:0, Q:0, I:p.i0*0, Idc:0, P:0, Pmech:0, stalled:false };
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
  if(stalled) return { rpm:0, omega:0, T:0, Q:0, I:0, Idc:0, P:0, Pmech:0, stalled:true };
  const n = omega/(2*Math.PI);
  const T = aero.ctEff * aero.rho * n*n * Math.pow(p.D,4);
  const Q = aero.cqEff * aero.rho * n*n * Math.pow(p.D,5);
  const I = Math.min(Q/kt + p.i0, p.imax*1.6);
  const Vterm = Math.max(V*duty - I*Reff, 0);
  // Two different currents, and mixing them up is the classic drive-train error:
  //   I    — PHASE current in the motor branch. Sets copper loss, motor heating
  //          and the motor / ESC per-channel ratings.
  //   Idc  — DC-LINK current the PACK actually supplies. The ESC is a switching
  //          converter, so it steps V down to V·duty: power in = power out gives
  //          V·Idc = (V·duty)·I, i.e. Idc = duty·I. The two coincide at full
  //          throttle, but at a ~30 % hover the pack sees roughly a third of the
  //          phase current — treating them as equal made hover draw ~3× too high
  //          and cut every endurance figure to a third of the real value.
  const Idc = duty * I;
  return { rpm: n*60, omega, T:Math.max(T,0), Q, I, Idc,
           P: Vterm*I + I*I*Reff, Pmech: Q*omega, stalled:false };
}
/* full quad at throttle d + state-of-charge soc (0..1), incl. pack sag under 4-motor draw */
function solveQuad(d, soc){
  const p = propulsionParams();
  const s = soc==null?1:soc;
  const rIR = cellIR(p, s), Rpack = p.cells*rIR;
  let V = cellOCV(s)*p.cells, r = calcMotorPoint(d, V, motorRm(p,20), p.rdsOn);
  for(let k=0;k<6;k++){
    // the pack sags against what it actually delivers — the DC-link current
    V = Math.max(cellOCV(s)*p.cells - 4*r.Idc*Rpack, p.cells*2.8);
    r = calcMotorPoint(d, V, motorRm(p,20), p.rdsOn);
  }
  return { rpm:r.rpm, omega:r.omega, Tper:r.T, Ttot:4*r.T,
           Iper:r.I,          // phase current — motor / ESC channel ratings, heating
           Itot:4*r.Idc,      // pack current  — C-rating, sag, coulomb count
           V, P:4*r.P, Pmech:4*r.Pmech, Q:r.Q, stalled:r.stalled };
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

/* ════════════ 4b · MISSION MODEL (Exp-10 closed-form) ════════════
   Doc §10.2: T = m·G (level flight, thrust ≈ weight), F_D(V) = ½ρV²Cd·A,
   P_cruise(V) = F_D(V)·V + P_ind. η_total (electrical→aero) held constant.

   INDUCED POWER — chosen form: the pure doc approximation lists P_ind as
   speed-independent (P_ind = T^1.5/√(2ρA_disk)), which makes P_cruise
   MONOTONICALLY RISING from V=0 (dP/dV = 3·k·V² > 0 everywhere) — no interior
   minimum, so "endurance speed" would be undefined. Per BUILD_SPEC's fallback
   instruction this file uses the momentum-theory induced-velocity form
   instead — but with the physically-correct sign: solving the standard
   forward-flight inflow equation vi²(V²+vi²) = vh⁴ for vi gives
     Vi = √( √((V²/2)² + vh⁴) − V²/2 ),  vh² = T/(2ρA_disk)
   (BUILD_SPEC's literal text has "+V²/2"; verified numerically that the "+"
   form makes Vi — and hence P_ind — RISE with airspeed, which stacks with
   rising parasitic drag and still yields a monotonic curve, failing the
   spec's own U-shape requirement. The "−" form matches classical momentum
   theory: Vi = vh at V=0 and Vi → vh²/V ↓ as V grows (translational lift),
   so P_ind falls while parasitic drag power rises as V³ — a genuine U-shape
   with an interior minimum, confirmed by a direct numerical sweep.) */
const ETA_TOTAL = 0.55;              // system efficiency, electrical → aero (const, per spec)
const MISSION_DIST_M = 500;          // doc §10.3 example delivery leg
function frontalAreaM2(){
  const ch = opt("chasis");
  if(ch && ch.phys && ch.phys.frontal_area_m2) return ch.phys.frontal_area_m2;
  const wb = (ch && ch.phys && ch.phys.wheelbase_mm) || 220;
  return 0.015 + 0.02*(wb/250);
}
function dragCd(){ const ch = opt("chasis"); return (ch && ch.phys && ch.phys.cd) || 1.1; }
function diskAreaM2(){ const p = propulsionParams(); return 4 * Math.PI * (p.D/2) * (p.D/2); }   // 4 rotors
/* total drone mass (kg) — massRows() already folds in the payload slider row */
function missionMassKg(){ return massRows().total/1000; }
/* dry (no-payload) mass, for sweeping an arbitrary payload value (range chart) */
function missionDryKg(){ return (massRows().total - (state.payload||0))/1000; }
function totalMassKgFor(payloadG){ return missionDryKg() + (payloadG||0)/1000; }
function missionDrag(V){ return 0.5 * rhoNow() * V*V * dragCd() * frontalAreaM2(); }
function inducedVelocity(V, T, rho, Adisk){
  const half = V*V/2, vh2 = T/(2*rho*Adisk);                 // vh2 = hover induced velocity²
  return Math.sqrt(Math.sqrt(half*half + vh2*vh2) - half);
}
function inducedPower(V, mKg){
  const m = mKg!=null ? mKg : missionMassKg();
  const T = m*G, rho = rhoNow(), Adisk = diskAreaM2();
  return T * inducedVelocity(V, T, rho, Adisk);
}
function pCruise(V, mKg){ return missionDrag(V)*V + inducedPower(V, mKg); }
function pHover(mKg){ return inducedPower(0, mKg); }                    // hover = zero-speed induced power
/* fine sweep 2..20 m/s used by the U-curve chart + endurance/max-range search */
function sweepPcruise(mKg, steps){
  steps = steps || 120;
  const pts = [];
  for(let i=0;i<=steps;i++){
    const V = 2 + (20-2)*i/steps;
    pts.push({ V, P: pCruise(V, mKg) });
  }
  return pts;
}
function enduranceSpeed(mKg){                    // argmin_V P_cruise(V) — minimum-power speed
  const pts = sweepPcruise(mKg, 240);
  return pts.reduce((best,p)=> p.P<best.P ? p : best, pts[0]).V;
}
function maxRangeSpeed(mKg){                     // tangent-from-origin point: argmin_V P(V)/V
  const pts = sweepPcruise(mKg, 240);
  return pts.reduce((best,p)=> (p.P/p.V)<(best.P/best.V) ? p : best, pts[0]).V;
}
/* mission-phase duration model (doc §10.3): takeoff/land are hover-power, cruise
   legs are forward-flight at state.airspeed, hover-on-station is hover-power. */
function defaultPhases(){
  const V = Math.max(state.airspeed||10, 0.1);
  const legT = +(MISSION_DIST_M/V).toFixed(1);
  return { takeoff:30, cruise:legT, hover:60, ret:legT, land:30 };
}
let missionPhases = null;
function getPhases(){ if(!missionPhases) missionPhases = defaultPhases(); return missionPhases; }
function resetPhases(){ missionPhases = defaultPhases(); }
/* Recompute only the distance-derived cruise/return legs when airspeed changes
   (500 m / V) — preserves any takeoff/hover/land durations the student edited. */
function updatePhasesForAirspeed(){
  const ph = getPhases();
  const legT = +(MISSION_DIST_M/Math.max(state.airspeed,0.1)).toFixed(1);
  ph.cruise = legT; ph.ret = legT;
}
function missionEnergyWh(phases){
  phases = phases || getPhases();
  const pCru = pCruise(state.airspeed), pHov = pHover();
  const eJ = pHov*(phases.takeoff + phases.hover + phases.land) + pCru*(phases.cruise + phases.ret);
  return eJ/3600;
}
/* per-phase energy breakdown (Wh) — same terms as missionEnergyWh, split out
   for the phase-energy bar chart. */
function phaseEnergyBreakdown(phases){
  phases = phases || getPhases();
  const pCru = pCruise(state.airspeed), pHov = pHover();
  return [
    { label:"Take-off", wh: pHov*phases.takeoff/3600 },
    { label:"Cruise-out", wh: pCru*phases.cruise/3600 },
    { label:"Hover on-station", wh: pHov*phases.hover/3600 },
    { label:"Cruise-return", wh: pCru*phases.ret/3600 },
    { label:"Land", wh: pHov*phases.land/3600 }
  ];
}
function batteryEnergyWh(cells, capMah){
  const p = propulsionParams();
  cells = cells!=null ? cells : p.cells; capMah = capMah!=null ? capMah : p.cap;
  return cells * 3.7 * (capMah/1000);                        // Wh, nominal 3.7 V/cell
}
/* Range (doc §10.2): E_hover reserves enough hover power for the take-off +
   landing legs of THIS phase plan; whatever's left flies the cruise leg. */
function rangeFor(payloadG, battWh){
  const mKg = totalMassKgFor(payloadG), V = state.airspeed;
  const pCru = pCruise(V, mKg), pHov = pHover(mKg);
  const ph = getPhases();
  const eHoverWh = pHov*(ph.takeoff + ph.land)/3600;
  const usableWh = battWh*ETA_TOTAL - eHoverWh;
  if(usableWh <= 0 || pCru <= 0) return 0;
  return usableWh/pCru*3600 * V;                              // Wh → J (×3600) → m (÷P ×V)
}
/* three representative packs for the Range–Payload envelope (doc §10.2 example set) */
const REF_BATTERIES = [
  { label:"3S 2200 mAh", cells:3, cap:2200 },
  { label:"4S 1500 mAh", cells:4, cap:1500 },
  { label:"6S 5000 mAh", cells:6, cap:5000 }
];

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
    // max_current_a is a short-burst (~60 s) rating, so a modest exceedance at
    // wide-open throttle is a warning, not a dead build.
    if(c.full.Iper > p.imax*1.15){
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
    // Judge against the ESC's authored BURST rating (burst_current_a) when the
    // spec carries one — it was present in every ESC spec.json but unused — and
    // fall back to +25% headroom otherwise. current_a is the continuous figure,
    // and wide-open throttle is a burst condition.
    const escBurst = (esc.phys.burst_current_a || escA*1.25);
    if(c.full.Iper > escBurst){
      items.push({ sev:"err", block:false,
        msg:"ESC under-rated — "+escA+" A/ch vs "+c.full.Iper.toFixed(1)+" A motor draw.",
        fix:"Choose an ESC rated above the motor's peak current." });
    } else if(c.full.Iper > escA){
      items.push({ sev:"warn",
        msg:"ESC above continuous rating ("+c.full.Iper.toFixed(1)+" / "+escA+" A per channel).",
        fix:"Survivable in bursts; it will run hot at sustained full throttle." });
    }
  }
  // 5 · battery discharge capability — burst (warn) vs continuous (error)
  if(ba && ba.phys){
    const capAh = ba.phys.capacity_mah/1000;
    const burstA = capAh * (ba.phys.c_rating||30);
    const contA  = capAh * p.cRatingCont;
    // Full throttle is a BURST condition, not a sustained one — a pack may legally
    // exceed its continuous rating in a punch-out and only has to survive its burst
    // rating. The previous ordering tested continuous first, so the burst branch was
    // unreachable and every build that merely bursted past continuous was failed
    // outright. Sustained overdraw is judged separately, at the hover point.
    if(c.full.Itot > burstA){
      items.push({ sev:"err", block:false, tag:"batt-crate",
        msg:"Battery burst limit exceeded — pack peaks at "+burstA.toFixed(0)+" A but full throttle pulls "+c.full.Itot.toFixed(0)+" A; cells overheat and vent.",
        fix:"Higher C-rating / capacity, or a lower-current motor & prop." });
    } else if(c.hoverI > contA){
      items.push({ sev:"err", block:false, tag:"batt-crate",
        msg:"Battery continuous C-rate exceeded in the hover — pack sustains "+contA.toFixed(0)+" A but hover alone needs "+c.hoverI.toFixed(0)+" A.",
        fix:"Higher C-rating / capacity, or a more efficient motor & prop." });
    } else if(c.full.Itot > contA){
      items.push({ sev:"warn",
        msg:"Full throttle ("+c.full.Itot.toFixed(0)+" A) is above the pack's "+contA.toFixed(0)+" A continuous rating.",
        fix:"Fine in bursts; sustained wide-open throttle will heat the cells." });
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
  // 6 · thrust-to-weight / take-off feasibility (mass includes the payload slider)
  if(c.tw < 1.05){
    items.push({ sev:"err", block:false, tag:"no-hover",
      msg:"T/W < 1 — cannot take off. Thrust-to-weight is "+c.tw.toFixed(2)+" with the current payload (need > 1.0).",
      fix:"Lighter build, less payload, larger prop, or a more powerful motor." });
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
  // 9 · mission energy budget — does the pack hold enough Wh for the planned mission?
  const battWh = batteryEnergyWh(), usableWh = battWh*ETA_TOTAL, eTotal = missionEnergyWh();
  if(eTotal > usableWh){
    items.push({ sev:"err", block:false, tag:"mission-energy",
      msg:"Pack cannot complete the mission — needs "+eTotal.toFixed(1)+" Wh but only "+usableWh.toFixed(1)+" Wh is usable ("+battWh.toFixed(1)+" Wh pack × "+Math.round(ETA_TOTAL*100)+"% η).",
      fix:"Shorten the mission (less cruise/hover time), reduce payload, or fit a larger-capacity battery." });
  } else if(eTotal > usableWh*0.7){
    items.push({ sev:"warn",
      msg:"Thin energy margin — mission uses "+eTotal.toFixed(1)+" of "+usableWh.toFixed(1)+" Wh usable.",
      fix:"Little reserve for wind, hover, or a longer route." });
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
/* Orientation used for the small PREVIEW renders only (tiles, picker, reward
   card). The assembled drone seats attachments with its own mount logic
   (orientThinUp / orientCameraForward / seatModel "hang"), so this deliberately
   does NOT touch the spec files — changing those would double-rotate the parts
   on the rig. ORIENT has attachments:"none", which left a GPS board standing on
   edge and a gimbal lying on its side in every preview. */
function previewOrient(o){
  if(!o || o.catKey !== "attachments") return undefined;
  const mt = (o.phys && o.phys.mount_type) || "";
  if(mt === "gps") return "flat";        // thin PCB face → horizontal
  if(mt === "payload") return "axis";    // gimbal yoke → long axis vertical
  return undefined;
}
function modelFor(o, span, onReady, orientRule){
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
      const fitted = fitUnit(merged, span, o, oriented ? "none" : orientRule);
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
/* Supersample factor for every preview render. The canvas backing store is sized
   to its ON-SCREEN size x this, so on a retina panel the component is rendered at
   the display's real pixel density instead of half of it. Capped at 3 so a 4K
   display doesn't quietly cost 16x the fill rate. */
const PREVIEW_DPR = Math.max(2, Math.min(window.devicePixelRatio || 1, 3));
/* A tiny sky/ground gradient, prefiltered through PMREM. Without an environment
   map three.js MeshStandardMaterial metals have nothing to reflect and read as
   flat grey plastic — this is what makes the motor bell and prop hub look
   machined rather than painted. */
let ENV_TEX = null;
function ensureEnv(rnd){
  if(ENV_TEX || !rnd || !THREE.PMREMGenerator) return ENV_TEX;
  try{
    const c = document.createElement("canvas"); c.width = 64; c.height = 32;
    const x = c.getContext("2d"), grd = x.createLinearGradient(0,0,0,32);
    grd.addColorStop(0,"#eef2f6"); grd.addColorStop(.45,"#b9c2cc");
    grd.addColorStop(.58,"#6e7681"); grd.addColorStop(1,"#2b3036");
    x.fillStyle = grd; x.fillRect(0,0,64,32);
    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const pm = new THREE.PMREMGenerator(rnd); pm.compileEquirectangularShader();
    ENV_TEX = pm.fromEquirectangular(tex).texture; tex.dispose();
  }catch(e){ ENV_TEX = null; }
  return ENV_TEX;
}
function initPreviewEngine(){
  previewRenderer = new THREE.WebGLRenderer({ antialias:true, alpha:true,
                                              powerPreference:"high-performance" });
  previewRenderer.setPixelRatio(1);          // sizes below are already device pixels
  if(THREE.sRGBEncoding !== undefined) previewRenderer.outputEncoding = THREE.sRGBEncoding;
  if(THREE.ACESFilmicToneMapping !== undefined){
    previewRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    previewRenderer.toneMappingExposure = 0.82;   // calibrated against the env map below
  }
  previewRenderer.setSize(320,220,false);
}
/* The environment map is a full-strength reflection by default, which blows the
   pale plastics out. Dial it back per material and keep a floor on roughness so
   nothing turns into a mirror. */
function tunePreviewMaterials(root){
  if(!root || !root.traverse) return;
  root.traverse(function(m){
    if(!m.isMesh || !m.material) return;
    (Array.isArray(m.material) ? m.material : [m.material]).forEach(function(mat){
      if(mat.envMapIntensity !== undefined) mat.envMapIntensity = 0.38;
      if(mat.roughness !== undefined) mat.roughness = Math.max(mat.roughness, 0.32);
      mat.needsUpdate = true;
    });
  });
}
function registerPreview(canvas, o){
  if(!canvas || !o || !previewRenderer) return;
  const scene = new THREE.Scene();
  scene.environment = ensureEnv(previewRenderer);   // reflections for metal parts
  // Studio 3-point rig. Ambient is dialled back from .85 because the environment
  // map now supplies the fill — leaving it high washed every material out flat.
  scene.add(new THREE.AmbientLight(0xffffff,.20));
  const d = new THREE.DirectionalLight(0xffffff,.62); d.position.set(2.4,3.2,2.2); scene.add(d);
  const d2 = new THREE.DirectionalLight(0xdce3f2,.26); d2.position.set(-2.6,-.6,-1.8); scene.add(d2);
  const d3 = new THREE.DirectionalLight(0xffffff,.18); d3.position.set(-1.4,2.0,-2.6); scene.add(d3);
  const group = modelFor(o, undefined, function(g){ tunePreviewMaterials(g); }, previewOrient(o));
  tunePreviewMaterials(group);
  scene.add(group);
  const aspect = (canvas.width && canvas.height) ? canvas.width/canvas.height : 220/150;
  const camera = new THREE.PerspectiveCamera(34, aspect, .1, 50);
  camera.position.set(1.9,1.35,1.9); camera.lookAt(0,0,0);
  previews.set(canvas, {scene, camera, group});
}
let frameNo = 0;
let previewW = 0, previewH = 0;
function blitPreviews(){
  if(!previewRenderer) return;
  let i = 0;
  for(const [cv,p] of previews){
    if(!cv.isConnected){ previews.delete(cv); continue; }
    if((i++ + frameNo) % 2 !== 0) continue;
    p.group.rotation.y += .022;
    // Size the backing store to the canvas's ON-SCREEN box x PREVIEW_DPR. The
    // markup ships a fixed width/height (280x190 for the reward card) while CSS
    // stretches the element to fill its panel, so the old fixed buffer was both
    // upscaled and rendered at half density on a retina display — that is what
    // made the parts look jagged and soft.
    const r = cv.getBoundingClientRect();
    if(!r.width || !r.height) continue;
    const w = Math.max(2, Math.round(r.width  * PREVIEW_DPR));
    const h = Math.max(2, Math.round(r.height * PREVIEW_DPR));
    if(cv.width !== w || cv.height !== h){ cv.width = w; cv.height = h; }
    if(previewW !== w || previewH !== h){
      previewW = w; previewH = h;
      previewRenderer.setSize(w, h, false);
    }
    if(p.camera.aspect !== w/h){ p.camera.aspect = w/h; p.camera.updateProjectionMatrix(); }
    previewRenderer.render(p.scene, p.camera);
    const ctx = cv.getContext("2d");
    ctx.clearRect(0,0,w,h);
    ctx.drawImage(previewRenderer.domElement, 0,0, w, h);
  }
}

/* ════════════ 8 · MAIN VIEWPORT / SCENES ════════════ */
let renderer, scene, camera, controls, rig, propGroups = [];
let hoverPhase = 0, benchGroup = null;
let rigGroundY = null, rigLift = 0;   // mission drone: cached ground-rest height + eased takeoff/landing lift (0=landed,1=cruise)
// component emitter anchors, so failure smoke/sparks vent from the real part
let rigParts = { motors: [], escs: [], battery: null };
let benchParts = { motor: null, esc: null };
function sceneModeType(){ return currentExp().exp.type || "assembly"; }   // assembly | bench | flight
function isBench(){ return sceneModeType() === "bench"; }

/* Vertical offset that seats the assembled drone's lowest point on the grid (y=0).
   Measured live so it is correct for any chassis / component build. */
function computeGroundY(){
  if(!rig) return 0;
  const prevY = rig.position.y;
  rig.position.y = 0; rig.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(rig);
  rig.position.y = prevY;
  return isFinite(box.min.y) ? -box.min.y + 0.02 : 0;   // +2cm landing-gear clearance
}

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
  benchParts = { motor: null, esc: null };
}
function buildScene(){
  clearRig();
  if(isBench()) buildBenchRig(); else buildDrone();
  syncCamera();
}
function syncCamera(){
  if(!controls) return;
  if(isBench()){ controls.target.set(0,1.2,0); }
  else { controls.target.set(0, state.module==="m3" ? 1.2 : 1.1, 0); }
}

/* full assembled drone — one world-scale u = 3.0 / wheelbase → true relative sizes.
   Motors/props are SEATED onto the real chassis geometry via downward raycast
   (works instantly against the fallback mesh, then re-seats once the real GLB loads). */
function buildDrone(){
  const d = new THREE.Group();
  propGroups = [];
  const ch = opt("chasis");
  d.position.y = state.module==="m3" ? 1.0 : 1.15;   // flight height
  // Data-driven path: if the chassis ships authored mount transforms
  // (DARUKA mounts.json), seat every real component GLB at its exact mount.
  if(ch && ch.mounts && ch.mounts.mounts && ch.files && ch.files.length){
    buildDroneFromMounts(d, ch);
    rigGroundY = null;
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
  d.position.y = state.module==="m3" ? 1.0 : 1.15;   // set BEFORE seating so world→local offset is known
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
    rigGroundY = null;
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

/* single motor + prop clamped to the test stand — motor-relative true sizing */
function buildBenchRig(){
  const g = new THREE.Group();
  propGroups = [];
  const mo = opt("motor"), pr = opt("propeller");
  const motorMax = mo && mo.size ? Math.max.apply(null, mo.size) : 40;
  const bu = 0.95 / motorMax;                  // world units per mm (motor ≈ 0.95 wide)
  const stand = standModel(2.0, s=>{
    const hm = measuredHeight(s);
    s.position.y = -hm.min;                     // rest base on ground
    placeBenchMotor(hm.max - hm.min);
  });
  g.add(stand);
  benchGroup = g; scene.add(g);
  rig = g;                         // the loop animates `rig`; bench branch spins motor/prop
  // provisional placement until stand measures
  placeBenchMotor(1.7);

  function placeBenchMotor(standTopY){
    // remove previous motor/prop
    for(let k=g.children.length-1;k>=0;k--){ if(g.children[k].userData.benchPart) g.remove(g.children[k]); }
    propGroups = [];
    const motorH = mo && mo.size ? mo.size[1]*bu : 0.5;
    const motorSpan = motorMax*bu;
    const pDiaMm = pr ? (((pr.phys && pr.phys.diameter_in) || 5)*25.4) : 120;
    const pSpan = pDiaMm*bu;                    // prop true size relative to this motor
    if(mo){
      // container sits at the motor location; mountMotor seats stator+rotor and
      // splits the rotor into a spinner (pushed to propGroups) so it turns.
      const mg = new THREE.Group();
      // mountMotor seats the motor BASE at the anchor → anchor = stand top
      mg.position.set(0, standTopY, 0); mg.userData.benchPart = true; g.add(mg);
      // prop seated on the rotor top inside mountMotor (spins with the bell)
      const propInfo = (pr && pr.files && pr.files.length) ? { opt: pr, span: pSpan } : null;
      mountMotor(mg, mo, motorSpan, 1, propInfo);
      benchParts.motor = mg; FX.setEmitter("benchmotor", mg, "motor");
      // ESC vents from just below the motor on the stand head
      const escMk = new THREE.Object3D(); escMk.position.set(0, standTopY - motorH*0.5, 0);
      escMk.userData.benchPart = true; g.add(escMk);
      benchParts.esc = escMk; FX.setEmitter("benchesc", escMk, "esc");
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
function renderModuleTabs(){
  const box = $("moduleTabs"); box.innerHTML = "";
  DRONE_DB.modules.forEach(m=>{
    const locked = !moduleUnlocked(m);
    const b = el("button", m.id===state.module ? "active" : ""); b.type = "button";
    b.disabled = locked;
    b.innerHTML = (locked?"🔒 ":"")+txt(m.label)+' <small>· '+txt(m.sub)+'</small>';
    b.title = locked ? "Complete every experiment in the previous module first" : "";
    b.addEventListener("click", ()=>{
      if(locked) return;
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
  const locked = !moduleUnlocked(m);
  m.experiments.forEach(e=>{
    const key = m.id+":"+e.id;
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
function renderCalcChips(){
  const mKg = missionMassKg();
  const pCru = pCruise(state.airspeed, mKg);
  const vEndur = enduranceSpeed(mKg);
  const vRange = maxRangeSpeed(mKg);
  const eMission = missionEnergyWh();
  const eBatt = batteryEnergyWh();
  const rho = rhoNow();
  const chips = [
    { k:"Cruise power", v:pCru.toFixed(0)+" W", cls:"" },
    { k:"Endurance speed", v:vEndur.toFixed(1)+" m/s", cls:"good" },
    { k:"Max-range speed", v:vRange.toFixed(1)+" m/s", cls:"" },
    { k:"Mission energy", v:eMission.toFixed(2)+" Wh", cls:eMission < eBatt*ETA_TOTAL ? "good" : "warn" },
    { k:"Air density ρ", v:rho.toFixed(3)+" kg/m³", cls:"" }
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
      (it.fix ? '<span class="fix">Fix: '+txt(it.fix)+'</span>' : '')+'</div>';
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
/* local mass formatter — exp-04 has no fmtMass() of its own */
function rwMass(g){
  if(typeof fmtMass === "function") return fmtMass(g);
  return g >= 1000 ? (g/1000).toFixed(2)+" kg" : (g<10 && g>0 ? g.toFixed(1) : Math.round(g))+" g";
}
/* Draw a random component from the reward category and REMEMBER the draw, so the
   card doesn't reshuffle on every re-render. Kept in localStorage under its own
   key (not the experiment's state schema, which differs per experiment) so a
   fresh play-through can award a different part. */
let _rewardPick = null;
function rewardPick(r){
  if(!r || !r.pool || !r.pool.length) return null;
  if(_rewardPick && r.pool.indexOf(_rewardPick) !== -1) return _rewardPick;
  const KEY = "dtl-reward-" + (r.category || "x");
  let id = null; try{ id = localStorage.getItem(KEY); }catch(e){}
  let p = id ? r.pool.filter(function(o){ return o.id === id; })[0] : null;
  if(!p){
    p = r.pool[Math.floor(Math.random()*r.pool.length)];
    try{ localStorage.setItem(KEY, p.id); }catch(e){}
  }
  _rewardPick = p;
  return p;
}
function renderReward(){
  const body = $("rewardBody"); if(!body) return;
  const DB = (typeof DRONE_DB !== "undefined" && DRONE_DB) ? DRONE_DB
           : (typeof ESC_DB   !== "undefined" && ESC_DB)   ? ESC_DB : null;
  const r = (DB && DB.reward) || { pool: [] };
  const unlocked = allDone();
  const badge = $("rewardBadge");
  body.innerHTML = "";
  // capstone: the experiment IS the showdown, so there is nothing to unlock
  if(!r.category){
    if(badge) badge.textContent = unlocked ? "PASS" : "—";
    const d = el("div","reward-locked"+(unlocked?" reward-final":""));
    d.innerHTML = '<div class="lock">'+(unlocked?"🏆":"🔒")+'</div><p>'+
      (unlocked ? "Full system verified — the build flies."
                : txt(r.desc || "Complete every check to clear the flight test."))+'</p>';
    body.appendChild(d);
    return;
  }
  if(badge) badge.textContent = (unlocked?1:0)+" / 1";
  if(unlocked){
    const pick = rewardPick(r);
    const d = el("div","reward-open");
    const specs = (pick && pick.specs && pick.specs.length)
      ? pick.specs.slice(0,3).map(function(s){ return '<span><i>'+txt(s[0])+'</i>'+txt(s[1])+'</span>'; }).join("")
      : "";
    d.innerHTML =
      '<div class="view"><canvas width="280" height="190"></canvas></div>'+
      '<div class="meta"><span class="rw-kind">'+txt(r.name)+' unlocked</span>'+
      '<b>'+txt(pick ? pick.name : r.name)+'</b>'+
      (specs ? '<div class="rw-specs mono">'+specs+'</div>' : '')+
      (pick && pick.mass ? '<div class="rw-specs mono"><span><i>Mass</i>'+rwMass(pick.mass)+
        (pick.qty>1?" × "+pick.qty:"")+'</span></div>' : '')+
      '</div>';
    body.appendChild(d);
    // pick is a REAL catalogue option, so it carries catKey → fitUnit applies the
    // same orientation rule this component uses everywhere else in the lab.
    registerPreview(d.querySelector("canvas"), pick || { fallback:r.fallback });
  }else{
    const total = allExperiments().length;
    const d = el("div","reward-locked");
    d.innerHTML = '<div class="lock">🔒</div><p>Complete all '+total+' experiments<br>to unlock a '+
      txt((r.name||"reward component").toLowerCase())+'</p>';
    body.appendChild(d);
  }
}
function updateTelemetry(t){
  t = t || {};
  $("telV").textContent = (t.V!=null?t.V:state.airspeed).toFixed(1)+" m/s";
  $("telT").textContent = (t.T||0).toFixed(2)+" N";
  $("telDrag").textContent = (t.drag||0).toFixed(2)+" N";
  $("telPind").textContent = Math.round(t.pind||0)+" W";
  $("telPcru").textContent = Math.round(t.pcru||0)+" W";
  $("telE").textContent = (t.E||0).toFixed(1)+" Wh";
  $("telRange").textContent = Math.round(t.range||0).toLocaleString()+" m";
  $("telPay").textContent = Math.round(t.pay!=null?t.pay:state.payload)+" g";
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
/* Every plotted chart is Chart.js — responsive, interactive tooltips, one-click
   detail views. Exp-10 has three mission-analysis charts (all computed live
   from the closed-form model in §4b, no bench/flight telemetry): the
   cruise-power U-curve, the mission phase-energy breakdown, and the
   range-payload envelope. */
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
/* transient "current iteration" store — NOT persisted, NO history. Holds only
   the most-recent completed run per experiment; cleared when a component
   changes (results go stale) so the panel always shows just this run. */
let lastRun = { key:null, metric:null, curve:[], enduranceV:null, maxRangeV:null, phaseWh:null, sweepIdx:null };
function clearLastRun(){ lastRun = { key:null, metric:null, curve:[], enduranceV:null, maxRangeV:null, phaseWh:null, sweepIdx:null }; }
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
/* Cruise-power U-curve — navy P_cruise(V) fill, rust marker for the endurance
   (minimum-power) speed, red marker for the max-range (tangent-from-origin)
   speed, and an optional dark cursor point while a sweep animates. */
function uCurveConfig(pts, opts){
  opts = opts || {};
  const labels = pts.map(p=>+p.V.toFixed(1));
  const data = pts.map(p=>+p.P.toFixed(2));
  const ds = [{ label:"P_cruise (W)", data, borderColor:C_COL.blue, backgroundColor:C_COL.blue+"1f",
    borderWidth:2, pointRadius:0, tension:.25, fill:true, yAxisID:"y" }];
  const nearestIdx = V => pts.length ? pts.reduce((b,p,i)=>Math.abs(p.V-V)<Math.abs(pts[b].V-V)?i:b, 0) : -1;
  if(opts.enduranceV!=null){
    const idx = nearestIdx(opts.enduranceV);
    if(idx>=0) ds.push({ label:"Endurance speed (min power)", data:labels.map((_,i)=>i===idx?data[i]:null),
      borderColor:C_COL.orange, backgroundColor:C_COL.orange, pointRadius:7, pointHoverRadius:8, showLine:false });
  }
  if(opts.maxRangeV!=null){
    const idx = nearestIdx(opts.maxRangeV);
    if(idx>=0) ds.push({ label:"Max-range speed", data:labels.map((_,i)=>i===idx?data[i]:null),
      borderColor:C_COL.red, backgroundColor:C_COL.red, pointRadius:7, pointHoverRadius:8, pointStyle:"rectRot", showLine:false });
  }
  if(opts.cursorV!=null){
    const idx = nearestIdx(opts.cursorV);
    if(idx>=0) ds.push({ label:"Sweep cursor", data:labels.map((_,i)=>i===idx?data[i]:null),
      borderColor:C_COL.ink, backgroundColor:C_COL.ink, pointRadius:5, showLine:false });
  }
  const cfg = { type:"line", data:{labels, datasets:ds},
    options: baseXY("Airspeed V (m/s)", {y:"Cruise power P_cruise (W)"}, {animation:false}) };
  cfg.options.plugins.legend.display = !opts.mini;
  return cfg;
}
/* Mission phase-energy breakdown — one bar per phase (takeoff/cruise/hover/
   return/land), the currently-accumulating phase highlighted in rust. */
function phaseEnergyConfig(breakdown, opts){
  opts = opts || {};
  const labels = breakdown.map(b=>b.label);
  const data = breakdown.map(b=>+b.wh.toFixed(3));
  const cfg = { type:"bar", data:{ labels, datasets:[{ label:"Energy (Wh)", data,
    backgroundColor: labels.map((_,i)=> i===opts.activeIdx ? C_COL.orange : C_COL.blue), borderRadius:4 }] },
    options: baseXY("Mission phase", {y:"Energy (Wh)"}, {animation:false}) };
  cfg.options.plugins.legend.display = false;
  return cfg;
}
/* Range–Payload envelope — 3 curves (one per representative battery pack),
   the primary UAV deliverable (doc §10.2). `sweepIdx` truncates every curve
   to the first N points for the live animated sweep; omit it for the full,
   always-live static analysis view (#massChart). */
const RANGE_PAYLOAD_STEPS = 40, RANGE_PAYLOAD_MAX_G = 2000;
function rangePayloadEnvelopeConfig(mini, sweepIdx){
  const labels = []; for(let i=0;i<=RANGE_PAYLOAD_STEPS;i++) labels.push(Math.round(RANGE_PAYLOAD_MAX_G*i/RANGE_PAYLOAD_STEPS));
  const colors = [C_COL.blue, C_COL.orange, C_COL.green];
  const ds = REF_BATTERIES.map((b,bi)=>{
    const wh = batteryEnergyWh(b.cells, b.cap);
    const full = labels.map(pay=>+rangeFor(pay, wh).toFixed(0));
    const data = sweepIdx!=null ? full.map((v,i)=> i<=sweepIdx ? v : null) : full;
    return { label:b.label, data, borderColor:colors[bi], backgroundColor:colors[bi]+"1f",
      borderWidth:2, pointRadius:0, tension:.25, fill:false, spanGaps:false };
  });
  const cfg = { type:"line", data:{labels, datasets:ds},
    options: baseXY("Payload (g)", {y:"Range (m)"}, {animation:false}) };
  cfg.options.plugins.legend.display = !mini;
  return cfg;
}
/* config-derived mass distribution doughnut — kept for the Charts modal gallery
   (background reference), separate from #massChart which now shows the
   Range–Payload envelope, the mission-primary deliverable. */
function massDistributionConfig(mini){
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
        title:{ display:true, text:(total/1000).toFixed(2)+" kg all-up", font:{size:mini?11:13}, color:"#1e2a29" } } } };
}
/* one chart config per metric, shared by the live panel and its detail view */
function buildMissionChart(metric, src, mini){
  if(metric==="pcruise") return uCurveConfig(src.curve||[], {mini});
  if(metric==="vendur") return uCurveConfig(src.fullCurve||sweepPcruise(missionMassKg()),
    { mini, enduranceV:src.enduranceV, maxRangeV:src.maxRangeV, cursorV:src.cursorV });
  if(metric==="energy") return phaseEnergyConfig(src.phaseWh||phaseEnergyBreakdown(), { mini, activeIdx:src.phaseIdx });
  if(metric==="range") return rangePayloadEnvelopeConfig(mini, src.sweepIdx!=null?src.sweepIdx:null);
  return null;
}
function drawLiveGraph(){
  const { mod, exp } = currentExp();
  const key = mod.id+":"+exp.id, metric = exp.metric;
  const cap = $("graphCaption");
  const live = simActive && sim.key === key;
  const src = live ? sim : (lastRun.key === key ? lastRun : null);
  if(!src){                                   // empty state — no run for this experiment yet
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
  const cfg = buildMissionChart(metric, src, true);
  if(cfg) ChartHub.put("liveGraph", cfg);
  if(cap) cap.textContent = exp.name+" · "+(exp.unit||"value")+(live ? " · recording…" : " · last run");
}
function drawMassChart(){ const c = ChartHub.put("massChart", rangePayloadEnvelopeConfig(true)); if(c) c._metric = "range"; }
/* registry of every analysis chart — drives the modal gallery + single-chart view */
function plotDefsAll(){
  return [
    { id:"range",  title:"Range–Payload envelope", cfg:()=>rangePayloadEnvelopeConfig(false) },
    { id:"ucurve", title:"Cruise-power U-curve",    cfg:()=>uCurveConfig(sweepPcruise(missionMassKg()),
      { enduranceV:enduranceSpeed(missionMassKg()), maxRangeV:maxRangeSpeed(missionMassKg()) }) },
    { id:"energy", title:"Mission phase energy",    cfg:()=>phaseEnergyConfig(phaseEnergyBreakdown()) },
    { id:"mass",   title:"Mass distribution",       cfg:()=>massDistributionConfig(false) }
  ];
}
/* single-chart floating detail — reached by clicking any chart's expand button */
/* ── Graphs vs Charts split ───────────────────────────────────────────────────
   A plot belongs on the Graphs card when it is drawn as a CURVE — a line chart,
   or a scatter with showLine (the sweep / CDF style). Everything else — bars,
   radars, doughnuts, clouds, histograms — stays in Charts. The kind is read off
   the built config, so a new plot lands in the right panel without a flag. A def
   with an `empty` fallback is a recorded-run plot: it is a line too, and the
   Graphs modal shows it as the full-width live block instead of a tile. */
function plotIsLine(def){
  if(def.dom) return false;
  if(def.empty) return true;
  try{
    const c = def.cfg();
    if(!c) return true;
    if(c.type === "line") return true;
    return c.type === "scatter" && (c.data.datasets||[]).some(d=>d.showLine);
  }catch(e){ return false; }
}
function graphDefs(){ return plotDefsAll().filter(plotIsLine); }
function chartDefs(){
  const out = plotDefsAll().filter(d=>!plotIsLine(d));
  // Some experiments plot nothing but curves — say so instead of an empty panel.
  return out.length ? out : [{ id:"nocharts", title:"No non-line charts in this experiment",
    cfg:()=>null, empty:"Every plot here is a curve — they are all on the Graphs card." }];
}
/* gallery body shared by the Graphs modal: one block per def + expand button */
function renderGraphBlocks(wrap, defs){
  const pending = [];
  defs.forEach(def=>{
    const block = el("div","calc-block gchart");
    const head = el("div","gchart-head");
    head.innerHTML = '<h3>'+txt(def.title)+'</h3><button type="button" class="gchart-expand" title="Expand">⤢</button>';
    head.querySelector("button").addEventListener("click", ()=>openSingleChart(def, "graphs"));
    block.appendChild(head);
    const cfg = def.cfg();
    if(cfg){ const box = el("div","chart-box-lg");
      box.innerHTML = '<canvas id="gc_'+def.id+'"></canvas>'; block.appendChild(box);
      pending.push({ id:"gc_"+def.id, cfg }); }
    else block.appendChild(el("div","runs-empty", txt(def.empty||"No data yet.")));
    if(def.note) block.appendChild(el("p","chart-footnote", txt(def.note())));
    wrap.appendChild(block);
  });
  return pending;
}
function openSingleChart(def, backTo){
  const body = openModal(txt(def.title)+' <em>· detail</em>', "#c65d3b",
    '<button type="button" class="modal-back" id="chartBack">‹ all '+(backTo==="graphs"?"graphs":"charts")+'</button>');
  const wrap = el("div"); wrap.style.cssText = "height:62vh;min-height:340px;position:relative";
  wrap.innerHTML = '<canvas id="gc_single"></canvas>';
  body.appendChild(wrap);
  const c = def.cfg(); if(c) ChartHub.put("gc_single", c);
  else wrap.innerHTML = '<div class="runs-empty">'+txt(def.empty||"No data yet.")+'</div>';
  if(def.note) body.appendChild(el("p","chart-footnote", txt(def.note())));
  const back = $("chartBack"); if(back) back.addEventListener("click", backTo==="graphs"?openGraphDetail:openChartsDetail);
}
/* live telemetry graph detail — reached by clicking the Graphs card */
function openGraphDetail(){
  ChartHub.killPrefix("gc_");
  const { mod, exp } = currentExp();
  const key = mod.id+":"+exp.id;
  const body = openModal('Graphs <em>· live run + parameter sweeps</em>', "#4f6d9e");
  const wrap = el("div","calc-blocks");
  let data, data2, flightT;
  if(simActive && sim.data.length>1){ data=sim.data; data2=sim.data2; flightT=sim.flightT||0; }
  else if(lastRun.key===key && lastRun.data.length>1){ data=lastRun.data; data2=lastRun.data2; flightT=lastRun.flightT; }
  const live = el("div","calc-block gchart");
  live.innerHTML = '<div class="gchart-head"><h3>Live run · '+txt(exp.name)+'</h3></div>';
  if(data){ const box = el("div","chart-box-lg");
    box.innerHTML = '<canvas id="gc_live"></canvas>'; live.appendChild(box); }
  else live.appendChild(el("div","runs-empty",
    "No data yet for <b>"+txt(exp.name)+"</b>.<br>Press <b>▶ Run Sim</b> to plot this experiment."));
  wrap.appendChild(live);
  const pending = renderGraphBlocks(wrap, graphDefs().filter(d=>!d.empty));
  body.appendChild(wrap);
  if(data) ChartHub.put("gc_live", telemetryConfig(exp.metric, data, data2, flightT, {mini:false}));
  pending.forEach(p=>ChartHub.put(p.id, p.cfg));
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
  const c = calc(); const mKg = missionMassKg();
  const vEndur = enduranceSpeed(mKg), vRange = maxRangeSpeed(mKg);
  const wrap = el("div","calc-blocks");

  // metric summary tiles
  const geom = propGeometry();
  const tiles = el("div","metric-tiles");
  const mt = (k,v,cls)=>'<div class="metric-tile"><span class="mk">'+k+'</span><span class="mv '+(cls||"")+'">'+v+'</span></div>';
  tiles.innerHTML =
    mt("T / W", c.tw.toFixed(2), c.tw>=1.8?"good":c.tw>=1.2?"":"warn") +
    mt("Endurance speed", vEndur.toFixed(1)+" m/s") +
    mt("Max-range speed", vRange.toFixed(1)+" m/s") +
    mt("Min cruise power", pCruise(vEndur,mKg).toFixed(0)+" W") +
    mt("Mission energy", missionEnergyWh().toFixed(1)+" Wh", missionEnergyWh()>batteryEnergyWh()*ETA_TOTAL?"warn":"good") +
    mt("Prop clearance", geom.clearanceMm.toFixed(0)+" mm", geom.collide?"warn":"");
  wrap.appendChild(tiles);

  // gallery — one block per chart def; every block has an expand button
  const pending = [];                              // {id,cfg} — instantiated AFTER wrap is in the DOM
  chartDefs().forEach(def=>{
    const block = el("div","calc-block gchart");
    const head = el("div","gchart-head");
    head.innerHTML = '<h3>'+txt(def.title)+'</h3><button type="button" class="gchart-expand" title="Expand">⤢</button>';
    head.querySelector("button").addEventListener("click", ()=>openSingleChart(def));
    block.appendChild(head);
    const cfg = def.cfg();
    if(cfg){ const box = el("div","chart-box-lg");
      box.innerHTML = '<canvas id="gc_'+def.id+'"></canvas>'; block.appendChild(box);
      pending.push({ id:"gc_"+def.id, cfg }); }
    else{ block.appendChild(el("div","runs-empty", txt(def.empty||"No data yet."))); }
    if(def.note) block.appendChild(el("p","chart-footnote", txt(def.note())));
    wrap.appendChild(block);
  });
  body.appendChild(wrap);                          // attach first so the canvases exist…
  pending.forEach(pc=>ChartHub.put(pc.id, pc.cfg));// …then create the charts

  wrap.appendChild(el("p","calc-footnote",
    "Curves recompute live from the mission model: P_cruise(V) = F_D(V)·V + P_ind (momentum-theory induced velocity), "+
    "range = (E_batt·η_total − E_hover) / P_cruise(V) · V, mission energy = Σ phase power × phase duration. "+
    "η_total = "+Math.round(ETA_TOTAL*100)+"% (electrical → aero, constant)."));
}
function openCalcDetail(){
  const body = openModal("Detailed Calculations", "#c65d3b");
  const c = calc(); const p = c.p;
  const mKg = missionMassKg(), V = state.airspeed;
  const vEndur = enduranceSpeed(mKg), vRange = maxRangeSpeed(mKg);
  const drag = missionDrag(V), pind = inducedPower(V,mKg), pcru = pCruise(V,mKg), phov = pHover(mKg);
  const battWh = batteryEnergyWh(), usableWh = battWh*ETA_TOTAL, eTotal = missionEnergyWh();
  const blocks = [
    { t:"1 · All-up mass (incl. payload)", b:"m = Σ (componentMass × qty) + payload = "+(mKg*1000).toFixed(0)+" g\nW = m·g = "+mKg.toFixed(3)+" kg × 9.80665 m/s²", r:"W = "+(mKg*G).toFixed(2)+" N" },
    { t:"2 · Air density (ISA)", b:"ρ(h) = 1.225 · (1 − 2.25577×10⁻⁵·h)^4.25588,  h = "+state.altitude+" m", r:"ρ = "+rhoNow().toFixed(4)+" kg/m³" },
    { t:"3 · Parasitic drag @ V = "+V.toFixed(1)+" m/s", b:"F_D(V) = ½·ρ·V²·Cd·A\nCd = "+dragCd().toFixed(2)+", A = "+frontalAreaM2().toFixed(4)+" m² (frontal reference area)", r:"F_D = "+drag.toFixed(2)+" N  ·  drag power = "+(drag*V).toFixed(1)+" W" },
    { t:"4 · Induced power (momentum theory)", b:"Vi = √(√((V²/2)² + vh⁴) − V²/2),  vh² = T/(2ρA_disk)\nA_disk = 4 rotors × π(D/2)² = "+diskAreaM2().toFixed(4)+" m²", r:"P_ind = "+pind.toFixed(1)+" W" },
    { t:"5 · Cruise power", b:"P_cruise(V) = F_D(V)·V + P_ind(V)", r:"P_cruise("+V.toFixed(1)+" m/s) = "+pcru.toFixed(1)+" W  ·  hover P = "+phov.toFixed(1)+" W" },
    { t:"6 · Endurance & max-range speed", b:"V_endur = argmin_V P_cruise(V)  (bottom of the U-curve)\nV_range = argmin_V P_cruise(V)/V  (tangent from the origin)", r:"V_endur ≈ "+vEndur.toFixed(1)+" m/s  ·  V_range ≈ "+vRange.toFixed(1)+" m/s" },
    { t:"7 · Mission energy budget", b:"E = [P_hover·(t_takeoff+t_hover+t_land) + P_cruise·(t_cruise+t_return)] / 3600\nphases: takeoff "+getPhases().takeoff.toFixed(0)+" s · cruise "+getPhases().cruise.toFixed(0)+" s · hover "+getPhases().hover.toFixed(0)+" s · return "+getPhases().ret.toFixed(0)+" s · land "+getPhases().land.toFixed(0)+" s", r:"E_total = "+eTotal.toFixed(1)+" Wh" },
    { t:"8 · Battery vs mission", b:"E_batt = cells·3.7 V·capacity(Ah) = "+p.cells+"S × 3.7 V × "+(p.cap/1000).toFixed(2)+" Ah\nusable = E_batt · η_total ("+Math.round(ETA_TOTAL*100)+"%)", r:"E_batt = "+battWh.toFixed(1)+" Wh  ·  usable = "+usableWh.toFixed(1)+" Wh  ·  "+(eTotal<=usableWh?"PACK HOLDS":"PACK INSUFFICIENT") },
    { t:"9 · Range @ current payload", b:"Range = (E_batt·η_total − E_hover) / P_cruise(V) · V\npayload = "+state.payload+" g", r:"Range ≈ "+Math.round(rangeFor(state.payload, battWh)).toLocaleString()+" m" }
  ];
  const wrap = el("div","calc-blocks");
  if(currentExp().exp.metric === "energy"){
    const card = el("div","calc-block");
    card.innerHTML = '<h3>Mission phase durations (editable)</h3>';
    wrap.appendChild(card);
    renderPhaseInputs(card);
  }
  blocks.forEach(bl=>{
    const d = el("div","calc-block");
    d.innerHTML = '<h3>'+bl.t+'</h3><pre>'+bl.b+'</pre><div class="res">'+bl.r+'</div>';
    wrap.appendChild(d);
  });
  wrap.appendChild(el("p","calc-footnote",
    "All values recompute live from the mission model and the selected components / sliders. g = 9.80665 m/s²; η_total = "+Math.round(ETA_TOTAL*100)+"% (electrical → aero, constant)."));
  body.appendChild(wrap);
}
/* mission-phase duration editor — class .phase-inputs / .phase-row per BUILD_SPEC.
   Shown inside the Calculations modal while Mission Energy is the active
   experiment; edits write straight into the (unpersisted) missionPhases object
   read by missionEnergyWh() / phaseEnergyBreakdown(). */
function renderPhaseInputs(container){
  const ph = getPhases();
  const wrap = el("div","phase-inputs");
  const row = (key,label,val)=>
    '<div class="phase-row"><span>'+label+'</span>'+
    '<input type="number" min="0" step="1" class="phase-input mono" id="phase_'+key+'" value="'+val.toFixed(0)+'"> s</div>';
  wrap.innerHTML =
    row("takeoff","Take-off (hover)",ph.takeoff) +
    row("cruise","Cruise-out @ "+state.airspeed+" m/s",ph.cruise) +
    row("hover","Hover on-station",ph.hover) +
    row("ret","Cruise-return",ph.ret) +
    row("land","Land (hover)",ph.land);
  container.appendChild(wrap);
  ["takeoff","cruise","hover","ret","land"].forEach(key=>{
    const inp = wrap.querySelector("#phase_"+key);
    if(!inp) return;
    inp.addEventListener("input", ()=>{
      getPhases()[key] = Math.max(0, +inp.value||0);
      renderLog();
      if(currentExp().exp.metric==="energy") drawLiveGraph();
    });
  });
  const reset = el("button","link-hint"); reset.type = "button"; reset.textContent = "↻ reset to mission defaults";
  reset.style.cssText = "background:none;border:0;cursor:pointer;margin-top:6px";
  reset.addEventListener("click", ()=>{ resetPhases(); openCalcDetail(); });
  container.appendChild(reset);
}

/* ════════════ 11 · SIMULATION RUNNER ════════════ */
const SIM_DURATION = 8;      // seconds of real time each metric's sweep/accumulation animates over
const fmtMMSS = s => { s = Math.max(0, Math.floor(s)); const m = Math.floor(s/60), ss = s%60; return (m<10?"0":"")+m+":"+(ss<10?"0":"")+ss; };
let simActive = false;
const sim = {
  t:0, key:null, exp:null, mod:null, phase:"STANDBY", verdict:null, verdictOk:null,
  // shared/legacy telemetry-safe defaults — Exp-10 has no per-frame motor/ESC
  // thermal model, so these stay flat at ambient (keeps FX smoke + procedural
  // engine audio quiet; nothing in this build fails thermally).
  temp:T_AMB, escTemp:T_AMB, batStress:0, lastRpm:0, lastThr:0,
  // pcruise — Power Profiling: growing U-curve as V sweeps 2→20 m/s
  curve:[], cursorV:2,
  // vendur — Endurance Speed: full curve computed once at run start, cursor
  // animates from 2 m/s to the endurance (minimum-power) speed
  fullCurve:[], enduranceV:null, maxRangeV:null,
  // energy — Mission Energy: phase-by-phase accumulation
  phaseIdx:0, phaseWh:null,
  // range — Range–Payload: 3 curves swept together by payload
  sweepIdx:-1
};
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
  sim.t = 0; sim.exp = exp; sim.mod = mod; sim.key = mod.id+":"+exp.id;
  sim.verdict = null; sim.verdictOk = null;
  sim.temp = T_AMB; sim.escTemp = T_AMB; sim.batStress = 0; sim.lastRpm = 0; sim.lastThr = 0;
  const mKg = missionMassKg();
  sim.curve = []; sim.cursorV = 2;
  sim.fullCurve = sweepPcruise(mKg, 240);
  sim.enduranceV = enduranceSpeed(mKg); sim.maxRangeV = maxRangeSpeed(mKg);
  sim.phaseIdx = 0;
  sim.phaseWh = phaseEnergyBreakdown().map(b=>({ label:b.label, wh:0 }));
  sim.sweepIdx = -1;
  sim.phase = exp.metric==="pcruise" ? "PROFILING" : exp.metric==="vendur" ? "OPTIMISING"
            : exp.metric==="energy" ? "BUDGETING" : "MAPPING";
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
  if(completed){
    // Only a genuine PASS marks the experiment done (mirrors the reference
    // platform's completion rule) — pcruise/vendur/range are always
    // informational PASSes; energy is the one metric that can genuinely FAIL
    // (pack can't hold the mission), in which case the student must adjust
    // payload/duration/battery and rerun.
    if(sim.verdictOk) state.done[sim.key] = true;
    lastRun = { key:sim.key, metric:sim.exp.metric,
      curve: sim.curve.slice(), fullCurve: sim.fullCurve, enduranceV: sim.enduranceV, maxRangeV: sim.maxRangeV,
      phaseWh: sim.phaseWh ? sim.phaseWh.map(b=>({label:b.label, wh:b.wh})) : null, phaseIdx: null,
      sweepIdx: sim.sweepIdx >= 0 ? RANGE_PAYLOAD_STEPS : null };
    saveState();
    renderModuleTabs(); renderExpTabs(); renderProgress();
    sfx("done");
    if(sim.verdict){ showVerdictToast(sim.verdict, sim.verdictOk); playFaultVoice(sim.verdict, sim.verdictOk); }
    if(allDone()){ renderReward(); instrGo(DRONE_DB.instructor.length-1); sfx("unlock"); }
    else instrEvent("runDone");
  }
  updateTelemetry({ V:state.airspeed, pay:state.payload });
  drawLiveGraph();
}
function resetSim(){
  if(simActive) stopSim(false);
  sim.curve = []; sim.temp = T_AMB; sim.escTemp = T_AMB;
  $("ffBadge").hidden = true; syncRunControls();
  updateTelemetry({}); drawLiveGraph();
}
/* Exp-10 has no auto/manual mode toggle and no throttle control (mission
   planning is manual by nature — sliders/fields, no PID) — nothing to
   show/hide here. Kept as a no-op so every existing call site stays valid. */
function syncRunControls(){}
function showVerdictToast(text, ok){
  const t = el("div","verdict "+(ok?"pass":"fail"));
  t.style.cssText = "position:fixed;left:50%;top:74px;transform:translateX(-50%);z-index:120;box-shadow:0 10px 30px rgba(20,40,40,.25);max-width:440px";
  t.innerHTML = '<span class="vic">'+(ok?"✓":"×")+'</span><div class="vtx"><b>'+txt(text.split("—")[0])+'</b><span>'+txt(text.split("—").slice(1).join("—").trim())+'</span></div>';
  document.body.appendChild(t);
  setTimeout(()=>{ t.style.transition="opacity .5s"; t.style.opacity="0"; setTimeout(()=>t.remove(),500); }, 3600);
}
/* All four Exp-10 experiments are closed-form sweeps/accumulations animated
   over SIM_DURATION seconds of real time — no per-frame motor/ESC solve. */
function simStep(dt){
  sim.t += dt;
  const metric = sim.exp.metric;
  const mKg = missionMassKg();
  const frac = Math.min(sim.t/SIM_DURATION, 1);

  if(metric === "pcruise"){
    // animate an airspeed sweep 2→20 m/s, plotting the growing U-curve live
    const V = 2 + (20-2)*frac;
    sim.cursorV = V;
    const P = pCruise(V, mKg);
    sim.curve.push({ V, P });
    updateTelemetry({ V, T:mKg*G, drag:missionDrag(V), pind:inducedPower(V,mKg), pcru:P,
      E:missionEnergyWh(), range:rangeFor(state.payload, batteryEnergyWh()), pay:state.payload,
      phase:"PROFILING", phaseCls:"" });
    if(frac >= 1){
      const Ps = sim.curve.map(p=>p.P), minP = Math.min(...Ps);
      const hasInteriorMin = Ps.some((v,i)=> i>0 && i<Ps.length-1 && v===minP && v<Ps[0] && v<Ps[Ps.length-1]);
      sim.verdictOk = true;
      sim.verdict = hasInteriorMin
        ? "U-curve built — cruise power has a genuine minimum ("+minP.toFixed(0)+" W)"
        : "U-curve built — power profile computed across 2–20 m/s";
      stopSim(true);
    }
    return;
  }

  if(metric === "vendur"){
    // sweep a cursor from 2 m/s to the endurance speed (min-power point on the
    // curve computed once at runSim); the max-range marker is shown alongside
    const V = 2 + (sim.enduranceV-2)*frac;
    sim.cursorV = V;
    updateTelemetry({ V, T:mKg*G, drag:missionDrag(V), pind:inducedPower(V,mKg), pcru:pCruise(V,mKg),
      E:missionEnergyWh(), range:rangeFor(state.payload, batteryEnergyWh()), pay:state.payload,
      phase:"OPTIMISING", phaseCls:"" });
    if(frac >= 1){
      sim.cursorV = sim.enduranceV;
      sim.verdictOk = true;
      sim.verdict = "Endurance speed "+sim.enduranceV.toFixed(1)+" m/s (min power) · max-range speed "+sim.maxRangeV.toFixed(1)+" m/s";
      stopSim(true);
    }
    return;
  }

  if(metric === "energy"){
    // accumulate energy phase-by-phase over the animated run, in order
    const ph = getPhases();
    const order = ["takeoff","cruise","hover","ret","land"];
    const pCru = pCruise(state.airspeed, mKg), pHov = pHover(mKg);
    const powerFor = key => (key==="cruise"||key==="ret") ? pCru : pHov;
    const totalPhaseSecs = order.reduce((a,k)=>a+ph[k],0) || 1;
    const elapsedPhaseSecs = frac * totalPhaseSecs;
    let acc = 0, running = 0, activeIdx = null;
    order.forEach((k,i)=>{
      const dur = ph[k];
      const into = Math.max(0, Math.min(dur, elapsedPhaseSecs - acc));
      sim.phaseWh[i].wh = powerFor(k)*into/3600;
      running += sim.phaseWh[i].wh;
      if(into > 0 && into < dur) activeIdx = i;
      acc += dur;
    });
    sim.phaseIdx = activeIdx;
    updateTelemetry({ V:state.airspeed, T:mKg*G, drag:missionDrag(state.airspeed), pind:pHov, pcru:pCru,
      E:running, range:rangeFor(state.payload, batteryEnergyWh()), pay:state.payload,
      phase:"BUDGETING", phaseCls:"" });
    if(frac >= 1){
      const battWh = batteryEnergyWh(), usableWh = battWh*ETA_TOTAL, eTotal = missionEnergyWh(ph);
      sim.verdictOk = eTotal <= usableWh;
      sim.verdict = sim.verdictOk
        ? "Pack holds the mission — "+eTotal.toFixed(1)+" of "+usableWh.toFixed(1)+" Wh usable"
        : "Pack cannot complete the mission — needs "+eTotal.toFixed(1)+" Wh, only "+usableWh.toFixed(1)+" Wh usable";
      sim.phaseIdx = null;
      stopSim(true);
    }
    return;
  }

  // metric === "range" — sweep payload 0→2000 g across 3 representative battery packs
  const idx = Math.min(Math.round(frac*RANGE_PAYLOAD_STEPS), RANGE_PAYLOAD_STEPS);
  sim.sweepIdx = idx;
  const pay = Math.round(RANGE_PAYLOAD_MAX_G*idx/RANGE_PAYLOAD_STEPS);
  const V = state.airspeed, mSweep = totalMassKgFor(pay);
  updateTelemetry({ V, T:mSweep*G, drag:missionDrag(V), pind:inducedPower(V,mSweep), pcru:pCruise(V,mSweep),
    E:missionEnergyWh(), range:rangeFor(pay, batteryEnergyWh()), pay, phase:"MAPPING", phaseCls:"" });
  if(frac >= 1){
    sim.sweepIdx = RANGE_PAYLOAD_STEPS;
    sim.verdictOk = true;
    sim.verdict = "Range–payload envelope mapped across 3 battery packs";
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
  mission_fail:"assets/audio/voice/fault_mission_energy.mp3",
  profiling_complete:"assets/audio/voice/done_profiling_complete.mp3",
  endurance_found:"assets/audio/voice/done_endurance_found.mp3",
  mission_pass:"assets/audio/voice/done_mission_pass.mp3",
  range_mapped:"assets/audio/voice/done_range_mapped.mp3"
};
const INTRO_FILES = {
  "m1:power_profiling":"assets/audio/voice/intro_power_profiling.mp3",
  "m1:endurance_speed":"assets/audio/voice/intro_endurance_speed.mp3",
  "m2:energy_budget":"assets/audio/voice/intro_energy_budget.mp3",
  "m2:range_payload":"assets/audio/voice/intro_range_payload.mp3"
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
  if(ok){ if(t.includes("u-curve")) tag="profiling_complete";
    else if(t.includes("endurance speed")) tag="endurance_found";
    else if(t.includes("pack holds")) tag="mission_pass";
    else if(t.includes("envelope mapped")) tag="range_mapped"; }
  else{ if(t.includes("cannot complete the mission")) tag="mission_fail"; }
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
  const flying = sim.exp && sim.exp.metric==="alt";
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
/* ── propeller spin ─────────────────────────────────────────────────────────
   True shaft speed is ω = rpm/60·2π rad/s. Drawing that literally only strobes
   (a 2-blade prop at 9 000 rpm passes a blade every 3 ms — far under a frame),
   so the view runs at a fixed fraction of real ω: PROP_VIS. Every rpm RATIO
   stays exact — double the rpm, double the on-screen rate — and the result is
   integrated against dt, so it no longer runs faster on a 120 Hz display than
   on a 60 Hz one the way the old per-frame constant did. */
const PROP_VIS = 1/12;
function propSpinRate(rpm){ return Math.max(0, (rpm||0)/60*2*Math.PI*PROP_VIS); }
function loop(t){
  requestAnimationFrame(loop);
  frameNo++;
  const dt = Math.min((t-lastT)/1000, .05) || .016;
  lastT = t;
  if(rig){
    hoverPhase += .02;
    if(isBench()){
      // stand-mounted: no vertical motion, faint vibration during hot/thrust runs
      let sx=0, sz=0;
      if(simActive && (sim.exp.metric==="thrust"||sim.exp.metric==="temp"||sim.exp.metric==="eff")){
        const amp = Math.min((sim.lastRpm||0)/2600*.006, .02);
        sx=(Math.random()-.5)*amp; sz=(Math.random()-.5)*amp;
      }
      rig.position.set(sx,0,sz);
    }else if(state.module === "m3"){
      // M3 flight — the drone rests ON the ground at standby and only lifts
      // off while a run is active, settling back on landing.
      // recompute while grounded (self-heals as async GLBs finish loading);
      // freeze during flight to avoid per-frame Box3 cost + jitter.
      if(rigGroundY==null || (rigLift < 0.02 && frameNo % 15 === 0)) rigGroundY = computeGroundY();
      rigLift += ((simActive?1:0) - rigLift) * Math.min(dt*3, 1);   // eased takeoff / landing
      const flying = simActive && sim.exp && sim.exp.metric==="alt";
      const hoverY = flying ? (1.0 + Math.min(sim.alt,4.5)*0.75) : (1.0 + Math.sin(hoverPhase)*.04);
      rig.position.set((Math.random()-.5)*(simActive?.01:0), rigGroundY + (hoverY - rigGroundY)*rigLift, 0);
      // camera/orbit-target follow altitude smoothly (translate, don't rotate, to avoid disorientation)
      if(flying && controls){
        const targetY = rig.position.y + 0.05;
        const dy = (targetY - controls.target.y) * 0.08;
        controls.target.y += dy; camera.position.y += dy;
      }
    }else{
      // Mission view — the drone rests ON the ground at standby and only lifts
      // off ("takes off") while a mission run is active, settling back on landing.
      // recompute while grounded (self-heals as async GLBs finish loading);
      // freeze during flight to avoid per-frame Box3 cost + jitter.
      if(rigGroundY==null || (rigLift < 0.02 && frameNo % 15 === 0)) rigGroundY = computeGroundY();
      rigLift += ((simActive?1:0) - rigLift) * Math.min(dt*3, 1);   // eased takeoff / landing
      rig.position.set(0, rigGroundY + 1.15*rigLift + Math.sin(hoverPhase)*.03*rigLift, 0);
    }
    // props are stationary when the drone is landed / powered down
    const spin = simActive ? propSpinRate(sim.lastRpm) : 0;
    propGroups.forEach((p,i)=>{
      const dir = p.userData.spinDir != null ? p.userData.spinDir : (i%2?1:-1);
      p.rotation.y += spin*dir*dt;
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
  $("payloadSlider").value = state.payload;
  $("payloadVal").textContent = state.payload+" g";
  $("airspeedSlider").value = state.airspeed;
  $("airspeedVal").textContent = state.airspeed+" m/s";
  document.querySelectorAll("#airspeedSeg .seg-btn").forEach(b=>b.classList.toggle("active", +b.dataset.v === state.airspeed));
  $("voiceVol").value = state.voiceVol; $("voiceVolTxt").textContent = state.voiceVol;
  $("sfxVol").value = state.sfxVol; $("sfxVolTxt").textContent = state.sfxVol;
  $("altSlider").addEventListener("input", e=>{
    state.altitude = +e.target.value;
    $("altVal").textContent = state.altitude+" m";
    $("rhoVal").textContent = rhoAt(state.altitude).toFixed(4)+" kg/m\u00b3";
    calcCache = null; renderCalcChips(); renderLog(); drawMassChart(); drawLiveGraph(); saveState();
  });
  $("payloadSlider").addEventListener("input", e=>{
    state.payload = +e.target.value;
    $("payloadVal").textContent = state.payload+" g";
    calcCache = null; renderMassMini(); renderCalcChips(); renderLog(); drawMassChart(); drawLiveGraph(); saveState();
  });
  $("airspeedSlider").addEventListener("input", e=>{
    state.airspeed = +e.target.value;
    $("airspeedVal").textContent = state.airspeed+" m/s";
    document.querySelectorAll("#airspeedSeg .seg-btn").forEach(b=>b.classList.toggle("active", +b.dataset.v === state.airspeed));
    updatePhasesForAirspeed(); renderLog(); drawMassChart(); drawLiveGraph(); saveState();
  });
  document.querySelectorAll("#airspeedSeg .seg-btn").forEach(b=>{
    b.addEventListener("click", ()=>{
      state.airspeed = +b.dataset.v;
      $("airspeedSlider").value = state.airspeed;
      $("airspeedVal").textContent = state.airspeed+" m/s";
      document.querySelectorAll("#airspeedSeg .seg-btn").forEach(x=>x.classList.toggle("active", x===b));
      updatePhasesForAirspeed(); renderLog(); drawMassChart(); drawLiveGraph(); saveState();
    });
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
