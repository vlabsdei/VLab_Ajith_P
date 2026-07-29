/* ════════════════════════════════════════════════════════════════
   DRONE TECHNOLOGY LAB — main.js  (v3)
   Data-driven from assets/manifest.json + one spec.json per option.

   MODULES
     M1 Assembly & Thrust   — Tab1 Assembly Check (full drone)
                              Tab2 Static Thrust (motor on stand)
     M2 Motor Characterisation — Tab1 Thermal / RPM-loss (motor on stand)
                                 Tab2 Efficiency sweep   (motor on stand)
     M3 Flight Verification — dynamic vertical flight, hover verdict

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
const LS_KEY = "nav-v1";   // PROGRESS-ONLY nav storage — no cross-experiment / Exp-11 data
const state = {
  sel:{}, altitude:1500, module:"m1", exp:{},
  done:{}, voiceVol:80, sfxVol:60, instrStep:0,
  simRunning:false, instrOpen:true, manualThrottle:0,
  // ── navigation inputs ──
  sats:null,                 // [{az,el}] radians — the live constellation
  satCount:8,                // slider 4..12
  skyPreset:"spread",        // spread | clustered | wall | line
  baroGrade:"fine",          // fine (MS5611) | coarse (cheap)
  inversion:false,           // temperature-inversion systematic bias
  uereScenario:"nominal"     // nominal | urban (multipath)
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
  state.altitude = s.altitude != null ? s.altitude : 1500;
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
  // ── navigation inputs (progress-only persistence) ──
  state.satCount = (s.satCount>=4 && s.satCount<=12) ? s.satCount : 8;
  state.skyPreset = ["spread","clustered","wall","line"].includes(s.skyPreset) ? s.skyPreset : "spread";
  state.baroGrade = (s.baroGrade==="coarse") ? "coarse" : "fine";
  state.inversion = !!s.inversion;
  state.uereScenario = (s.uereScenario==="urban") ? "urban" : "nominal";
  // rebuild the constellation from the saved custom sats, else from the preset
  if(Array.isArray(s.sats) && s.sats.length>=4){
    state.sats = s.sats.map(o=>({ az:+o.az||0, el:Math.max(0,Math.min(Math.PI/2,+o.el||0)) }));
  }else{
    state.sats = makePreset(state.skyPreset, state.satCount);
  }
}
function saveState(){
  try{
    localStorage.setItem(LS_KEY, JSON.stringify({
      sel:state.sel, altitude:state.altitude, module:state.module, exp:state.exp,
      done:state.done,
      voiceVol:state.voiceVol, sfxVol:state.sfxVol,
      instrStep:state.instrStep, instrOpen:state.instrOpen,
      // nav progress/config (no cross-experiment or Exp-11 data)
      satCount:state.satCount, skyPreset:state.skyPreset,
      sats:(state.sats||[]).map(o=>({ az:+o.az.toFixed(5), el:+o.el.toFixed(5) })),
      baroGrade:state.baroGrade, inversion:state.inversion, uereScenario:state.uereScenario
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
/* single motor on the bench (1 motor draws from the pack); tempC = winding temp for Rm */
function solveBench(d, soc, tempC){
  const p = propulsionParams();
  const s = soc==null?1:soc;
  const rIR = cellIR(p, s), Rpack = p.cells*rIR;
  const Rm = motorRm(p, tempC==null?20:tempC);
  let V = cellOCV(s)*p.cells, r = calcMotorPoint(d, V, Rm, p.rdsOn);
  for(let k=0;k<6;k++){
    V = Math.max(cellOCV(s)*p.cells - r.Idc*Rpack, p.cells*2.8);
    r = calcMotorPoint(d, V, Rm, p.rdsOn);
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

/* ════════════ 4b · NAVIGATION PHYSICS ════════════
   Research-grade GPS dilution-of-precision + ISA barometric altimetry.

   A · GPS DOP
     Each satellite i has azimuth Az and elevation El. Its line-of-sight unit
     vector in the local ENU frame is
         e = [ cosEl·sinAz , cosEl·cosAz , sinEl ]
     The linearised geometry (design) matrix row is  [ -e_E, -e_N, -e_U, 1 ]
     (the trailing 1 is the receiver clock-bias partial). The covariance of the
     position/clock solution ∝ Q = (GᵀG)⁻¹, from which
         HDOP=√(Q00+Q11)  VDOP=√Q22  PDOP=√(Q00+Q11+Q22)  GDOP=√(…+Q33)
     <4 sats or a (near-)singular GᵀG ⇒ no fix ⇒ HDOP = ∞.
     CEP (50% circular error) = HDOP · UERE.

   B · ISA barometer
     P(h)=P0(1−Lh/T0)^(1/k),  h(P)=(T0/L)[1−(P/P0)^k],  k=RL/g
     dh/dP grows as P falls, so a fixed pressure-noise σ_P maps to a larger
     altitude error with height — the physical reason baro degrades up high.  */
const NAV = {
  T0:288.15, L:0.0065, R:287, g:9.81, P0:101325,
  // pressure-noise σ_P models: σ(h)=σ0·(1+a·h). Tuned so a fine sensor gives
  // ~0.5 m error at 500 m and ~2.8 m at 3000 m (the PDF's stated result).
  baroGrades:{
    fine:   { name:"MS5611 (fine)",  sig0:1.877, grow:0.0041, scatter:0.35 },
    coarse: { name:"BMP180 (coarse)",sig0:7.20,  grow:0.0060, scatter:2.10 }
  },
  // UERE (User-Equivalent Range Error) scenarios, metres
  uere:{ nominal:3.0, urban:7.5 }
};
const D2R = Math.PI/180, R2D = 180/Math.PI;

/* deterministic preset constellations (radians). count clamped 4..12. */
function makePreset(name, n){
  n = Math.max(4, Math.min(12, n||8));
  const s = [];
  if(name === "clustered"){                         // one tight sky cone → huge DOP
    for(let i=0;i<n;i++){ const t = i/(n-1||1);
      s.push({ az:(10 + t*28)*D2R, el:(58 + t*20)*D2R }); }
  }else if(name === "wall"){                         // spread az but all high-el → HDOP ok, VDOP huge
    for(let i=0;i<n;i++) s.push({ az:(i*(360/n) + (i%2?4:-4))*D2R, el:(76 + (i%3)*3)*D2R });
  }else if(name === "line"){                          // near-collinear azimuth → rank-poor horizontal
    for(let i=0;i<n;i++) s.push({ az:(2 + (i%2?3:-3))*D2R, el:(15 + i*(70/(n-1||1)))*D2R });
  }else{                                             // spread (good geometry)
    for(let i=0;i<n;i++){ const el = 32 + (i%3)*13 + (i%2?4:-3);
      s.push({ az:(i*(360/n) + (i%2?7:-6))*D2R, el:el*D2R }); }
  }
  return s;
}

/* line-of-sight unit vector (ENU) from azimuth/elevation */
function losVec(az, el){
  return [ Math.cos(el)*Math.sin(az), Math.cos(el)*Math.cos(az), Math.sin(el) ];
}
/* n×4 geometry matrix; row = [ -eE, -eN, -eU, 1 ] */
function geometryMatrix(sats){
  return sats.map(s=>{ const e = losVec(s.az, s.el); return [ -e[0], -e[1], -e[2], 1 ]; });
}
/* GᵀG (4×4 symmetric) from the n×4 design matrix */
function normalMatrix(Gm){
  const M = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
  for(let i=0;i<4;i++) for(let j=0;j<4;j++){
    let s = 0; for(let k=0;k<Gm.length;k++) s += Gm[k][i]*Gm[k][j];
    M[i][j] = s;
  }
  return M;
}
/* 4×4 inverse via Gauss-Jordan with partial pivoting; null if (near-)singular */
function mat4Inverse(m){
  const n = 4;
  const A = m.map(r=>r.slice());
  const I = [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];
  for(let col=0; col<n; col++){
    let piv = col;
    for(let r=col+1;r<n;r++) if(Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if(Math.abs(A[piv][col]) < 1e-9) return null;              // singular → no fix
    if(piv !== col){ const t=A[piv]; A[piv]=A[col]; A[col]=t; const u=I[piv]; I[piv]=I[col]; I[col]=u; }
    const pv = A[col][col];
    for(let j=0;j<n;j++){ A[col][j]/=pv; I[col][j]/=pv; }
    for(let r=0;r<n;r++){
      if(r===col) continue;
      const f = A[r][col]; if(!f) continue;
      for(let j=0;j<n;j++){ A[r][j] -= f*A[col][j]; I[r][j] -= f*I[col][j]; }
    }
  }
  return I;
}
/* full DOP solve → {hdop,vdop,pdop,gdop,ok} */
function dopSolve(sats){
  const bad = { hdop:Infinity, vdop:Infinity, pdop:Infinity, gdop:Infinity, ok:false };
  if(!sats || sats.length < 4) return bad;
  const Q = mat4Inverse(normalMatrix(geometryMatrix(sats)));
  if(!Q) return bad;
  const q0=Q[0][0], q1=Q[1][1], q2=Q[2][2], q3=Q[3][3];
  if(!(q0>=0 && q1>=0 && q2>=0 && q3>=0)) return bad;          // numerical breakdown → no fix
  return { hdop:Math.sqrt(q0+q1), vdop:Math.sqrt(q2),
           pdop:Math.sqrt(q0+q1+q2), gdop:Math.sqrt(q0+q1+q2+q3), ok:true };
}
/* CEP (50% radius, m) from HDOP and the ranging error UERE */
function cepFromHdop(hdop, uere){ return hdop * (uere==null ? 3.0 : uere); }

/* single-quadrant clustering test: azimuth angular spread < ~120° → poor geometry warn */
function satAzSpanDeg(sats){
  if(!sats || !sats.length) return 0;
  const angs = sats.map(s=>((s.az%(2*Math.PI))+2*Math.PI)%(2*Math.PI)).sort((a,b)=>a-b);
  let maxGap = (angs[0] + 2*Math.PI) - angs[angs.length-1];
  for(let i=1;i<angs.length;i++) maxGap = Math.max(maxGap, angs[i]-angs[i-1]);
  return (2*Math.PI - maxGap) * R2D;                          // occupied azimuth arc
}

/* ── ISA barometric model ── */
const isaExp = () => NAV.R*NAV.L/NAV.g;                        // k ≈ 0.19026
function pressureAt(h){ return NAV.P0 * Math.pow(1 - NAV.L*h/NAV.T0, 1/isaExp()); }
function isaAltitude(P){ return (NAV.T0/NAV.L) * (1 - Math.pow(P/NAV.P0, isaExp())); }
/* altitude sensitivity to pressure (m/Pa) — grows as P drops with height */
function dhdP(P){ return (NAV.T0*NAV.R/(NAV.g*NAV.P0)) * Math.pow(P/NAV.P0, isaExp()-1); }
/* effective pressure-noise σ_P at true altitude h for a sensor grade */
function sigmaP(grade, h){ const g = NAV.baroGrades[grade] || NAV.baroGrades.fine; return g.sig0*(1 + g.grow*Math.max(0,h)); }

/* random-error magnitude of the baro altitude at hTrue (1σ), plus systematic bias.
   opts: {sample:true} adds a Gaussian pressure draw for scatter; else returns the
   deterministic σ-based error envelope. atmo bias = temperature inversion (using a
   wrong reference T0) + optional prop-wash dynamic-pressure offset. */
let _gaussSpare = null;
function gauss(){
  if(_gaussSpare!=null){ const v=_gaussSpare; _gaussSpare=null; return v; }
  let u=0,v=0; while(u===0)u=Math.random(); while(v===0)v=Math.random();
  const r=Math.sqrt(-2*Math.log(u)), a=2*Math.PI*v; _gaussSpare=r*Math.sin(a); return r*Math.cos(a);
}
function baroError(hTrue, grade, atmo){
  atmo = atmo || {};
  const P = pressureAt(hTrue);
  const sP = sigmaP(grade, hTrue);
  const sens = dhdP(P);
  // random component: 1σ envelope, or a sampled draw for live scatter
  const noise = atmo.sample ? sens * sP * gauss() : sens * sP;
  // systematic bias from a temperature inversion: the sensor assumes ISA T0 but
  // the real near-ground column is warmer/denser → a height-proportional offset.
  const invK = atmo.inversion ? (atmo.inversionK!=null ? atmo.inversionK : 6) : 0;
  const bias = invK>0 ? (hTrue/NAV.T0) * invK : 0;            // ≈ tens of metres near ceiling
  // optional prop-wash dynamic-pressure offset (reads slightly low)
  const wash = atmo.propwash ? -0.5 : 0;
  return { rand:noise, sigma:Math.abs(sens*sP), bias, wash, sens,
           total:Math.abs(noise) + Math.abs(bias) + Math.abs(wash),
           sensed:hTrue + noise + bias + wash };
}

/* 3-D error radius: horizontal CEP + vertical baro error → ellipsoid semi-axes */
function nav3dRadius(cep, hErr){ return Math.sqrt(cep*cep + hErr*hErr); }

/* one-stop nav solution for the current inputs (used by UI, charts, sim) */
function navCalc(){
  const sats = state.sats || makePreset(state.skyPreset, state.satCount);
  const dop = dopSolve(sats);
  const uere = NAV.uere[state.uereScenario] || 3.0;
  const cep = dop.ok ? cepFromHdop(dop.hdop, uere) : Infinity;
  const h = state.altitude;
  const be = baroError(h, state.baroGrade, { inversion:state.inversion });
  const hErr = be.total;
  const total = (dop.ok && isFinite(cep)) ? nav3dRadius(cep, hErr) : Infinity;
  return { sats, dop, uere, cep, hTrue:h, baro:be, hErr, total,
           azSpanDeg: satAzSpanDeg(sats) };
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
/* ── NAVIGATION pre-run diagnostics ──
   returns { items:[{sev,msg,fix,block}], errors, warns, blocked }
   <4 sats → BLOCKING (no fix); single-quadrant clustering → warn (high HDOP);
   coarse sensor → warn; temperature inversion → warn (systematic bias);
   degraded UERE (urban multipath) → warn. Mirrors the reference blocking-log
   behaviour so runSim() stops on a blocking error. */
function diagnostics(){
  const items = [];
  const nc = navCalc();
  const n = nc.sats.length;

  // 1 · satellite count (BLOCKING under 4 — a 3-D fix needs ≥4 ranges)
  if(n < 4){
    items.push({ sev:"err", block:true, tag:"no-fix",
      msg:"No GPS fix — only "+n+" satellite"+(n===1?"":"s")+" in view; a 3-D + clock solution needs at least 4.",
      fix:"Add satellites on the Constellation card (slider ≥ 4) before running." });
  }
  // 2 · geometry singular / extreme DOP (near-collinear or clustered → rank-poor)
  if(n >= 4 && !nc.dop.ok){
    items.push({ sev:"err", block:true, tag:"singular",
      msg:"Singular geometry — the satellites are effectively coplanar/collinear, so GᵀG can't be inverted (no fix).",
      fix:"Spread the satellites across azimuth and elevation (try the 'spread' preset)." });
  }
  // 3 · single-quadrant clustering → weak horizontal geometry (high HDOP)
  if(nc.dop.ok && nc.azSpanDeg < 150){
    items.push({ sev:"warn", tag:"cluster",
      msg:"Satellites clustered in a "+Math.round(nc.azSpanDeg)+"° azimuth arc — HDOP is "+nc.dop.hdop.toFixed(1)+", so horizontal accuracy is degraded.",
      fix:"Spread the constellation around the sky to lower HDOP." });
  }
  // 4 · high PDOP even if spread (e.g. 'wall' — all high-elevation → poor VDOP)
  if(nc.dop.ok && nc.azSpanDeg >= 150 && nc.dop.vdop > 8){
    items.push({ sev:"warn", tag:"vdop",
      msg:"Vertical geometry weak — VDOP is "+nc.dop.vdop.toFixed(1)+" (satellites sit too high in the sky).",
      fix:"Include some low-elevation satellites to strengthen the vertical solution." });
  }
  // 5 · degraded UERE (urban-canyon multipath) → inflated CEP
  if(state.uereScenario === "urban"){
    items.push({ sev:"warn", tag:"multipath",
      msg:"Urban-canyon multipath active — UERE raised to "+ (NAV.uere.urban).toFixed(1)+" m, so CEP balloons to "+(isFinite(nc.cep)?nc.cep.toFixed(1):"∞")+" m.",
      fix:"Open-sky (nominal) conditions give ~3 m ranging error." });
  }
  // 6 · coarse barometer → noisy altitude
  if(state.baroGrade === "coarse"){
    items.push({ sev:"warn", tag:"baro-coarse",
      msg:"Coarse barometer selected — pressure noise gives ±"+nc.baro.sigma.toFixed(1)+" m altitude scatter at "+nc.hTrue+" m.",
      fix:"A fine sensor (MS5611) tightens the vertical solution." });
  }
  // 7 · temperature inversion → systematic altitude bias
  if(state.inversion){
    items.push({ sev:"warn", tag:"inversion",
      msg:"Temperature inversion active — the baro assumes ISA T0, adding a systematic "+nc.baro.bias.toFixed(1)+" m altitude bias at "+nc.hTrue+" m.",
      fix:"Disable the inversion (or feed the true surface temperature) for an unbiased reading." });
  }

  const errors = items.filter(i=>i.sev==="err").length;
  const warns = items.filter(i=>i.sev==="warn").length;
  const blocked = items.some(i=>i.block);
  if(!items.length) items.push({ sev:"ok",
    msg:"Geometry & sensors nominal — HDOP "+nc.dop.hdop.toFixed(2)+", CEP "+nc.cep.toFixed(1)+" m, baro ±"+nc.hErr.toFixed(1)+" m.", fix:"" });
  return { items, errors, warns, blocked };
}
/* legacy propulsion diagnostics — kept intact but unused by the nav lab */
function diagnosticsProp(){
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
    case "gps":                                   // GNSS puck — round antenna dome on a base
      add(new T.CylinderGeometry(.5,.55,.16,28), mat(0x2b3036));
      add(new T.CylinderGeometry(.46,.46,.06,28), mat(0x1b6ec2,{metalness:.5,roughness:.4}), 0,.11,0);
      add(new T.SphereGeometry(.2,18,12,0,Math.PI*2,0,Math.PI/2), mat(0x9fd0ff,{metalness:.3,roughness:.3}), 0,.11,0);
      break;
    case "baro":                                  // barometer breakout board with a metal sensor can
      add(new T.BoxGeometry(.8,.12,.6), mat(0x1f6a3a));
      add(new T.CylinderGeometry(.13,.13,.13,18), mat(0xb9c2c9,{metalness:.7,roughness:.25}), .12,.12,0);
      add(new T.BoxGeometry(.1,.06,.5), mat(0xd8b93c), -.32,.06,0);
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
/* A PMREM texture belongs to the GL context that generated it, so the tile
   previews and the main viewport each need their own (see sceneEnvTex). */
function makeEnvTex(rnd){
  try{
    const c = document.createElement("canvas"); c.width = 64; c.height = 32;
    const x = c.getContext("2d"), grd = x.createLinearGradient(0,0,0,32);
    grd.addColorStop(0,"#eef2f6"); grd.addColorStop(.45,"#b9c2cc");
    grd.addColorStop(.58,"#6e7681"); grd.addColorStop(1,"#2b3036");
    x.fillStyle = grd; x.fillRect(0,0,64,32);
    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const pm = new THREE.PMREMGenerator(rnd); pm.compileEquirectangularShader();
    const out = pm.fromEquirectangular(tex).texture; tex.dispose();
    return out;
  }catch(e){ return null; }
}
function ensureEnv(rnd){
  if(ENV_TEX || !rnd || !THREE.PMREMGenerator) return ENV_TEX;
  ENV_TEX = makeEnvTex(rnd);
  return ENV_TEX;
}
/* Env map for the MAIN viewport renderer. Applied per-material (never as
   scene.environment) so only the parts that ask for it — the galvanised tower
   steel — gain reflections and the loaded component GLBs keep their tuned look. */
let SCENE_ENV = null, SCENE_ENV_TRIED = false;
function sceneEnvTex(){
  if(SCENE_ENV || SCENE_ENV_TRIED || !renderer || !THREE.PMREMGenerator) return SCENE_ENV;
  SCENE_ENV_TRIED = true;
  SCENE_ENV = makeEnvTex(renderer);
  return SCENE_ENV;
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
let navGroup = null;     // root group for skyplot / baro / nav3d scenes
let navSim = null;       // live nav-scene animation state (jitter, drift, markers…)
// component emitter anchors, so failure smoke/sparks vent from the real part
let rigParts = { motors: [], escs: [], battery: null };
let benchParts = { motor: null, esc: null };
function sceneModeType(){ return currentExp().exp.type || "assembly"; }   // assembly | bench | flight | skyplot | baro | nav3d
function isBench(){ return sceneModeType() === "bench"; }
function isNavScene(){ const t = sceneModeType(); return t==="skyplot" || t==="baro" || t==="nav3d"; }
// per-frame hook installed by the active nav scene builder (null for drone/bench)
let navSceneTick = null;
// live constellation updater installed by the sky-plot scene (used by the editor)
let updateSkyplotSats = null;

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
  if(navGroup){ scene.remove(navGroup); navGroup = null; }
  navSceneTick = null; updateSkyplotSats = null; navSim = null;
  propGroups = [];
  FX.clear();
  rigParts = { motors: [], escs: [], battery: null };
  benchParts = { motor: null, esc: null };
}
function buildScene(){
  clearRig();
  const t = sceneModeType();
  if(t === "skyplot")      buildSkyplotScene();
  else if(t === "baro")    buildBaroScene();
  else if(t === "nav3d")   buildNav3dScene();
  else if(isBench())       buildBenchRig();
  else                     buildDrone();
  syncCamera();
}
function syncCamera(){
  if(!controls) return;
  const t = sceneModeType();
  if(t === "skyplot"){ controls.target.set(0,1.4,0); camera.position.set(5.0,4.2,5.4); }
  else if(t === "baro"){ controls.target.set(0,2.4,0); camera.position.set(5.6,3.0,6.4); }
  else if(t === "nav3d"){ controls.target.set(0,1.4,0); camera.position.set(4.6,3.2,5.0); }
  else if(isBench()){ controls.target.set(0,1.2,0); }
  else { controls.target.set(0, state.module==="m3" ? 1.2 : 1.1, 0); }
}

/* full assembled drone — one world-scale u = 3.0 / wheelbase → true relative sizes.
   Motors/props are SEATED onto the real chassis geometry via downward raycast
   (works instantly against the fallback mesh, then re-seats once the real GLB loads). */
function buildDrone(){
  const d = assembleDrone();
  rig = d; scene.add(d);
}
/* Assemble the real component GLBs into one drone group WITHOUT parenting it to
   the scene or claiming `rig`. `detached` keeps it at its own local origin (no
   flight height) so a caller — the navigation scenes — can nest and scale it. */
function assembleDrone(detached){
  const d = new THREE.Group();
  propGroups = [];
  const ch = opt("chasis");
  const flyY = detached ? 0 : (state.module==="m3" ? 1.0 : 1.15);
  d.position.y = flyY;                               // flight height
  // Data-driven path: if the chassis ships authored mount transforms
  // (DARUKA mounts.json), seat every real component GLB at its exact mount.
  if(ch && ch.mounts && ch.mounts.mounts && ch.files && ch.files.length){
    buildDroneFromMounts(d, ch);
    return d;
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
  d.position.y = flyY;                               // set BEFORE seating so world→local offset is known
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
  return d;
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

/* ════════════ 8c · NAVIGATION SCENES (skyplot / baro / nav3d) ════════════
   These reuse three.js (r128) and the FX particle system. Each builder sets the
   global `navGroup` (added to `scene`), installs `navSceneTick(dt)` for its own
   animation, and — where relevant — `updateSkyplotSats()` so the sky-plot editor
   can push live constellation edits into the 3-D view. The drone shown in every
   nav scene is the SAME real component assembly used by buildDrone (real GLBs),
   just nested and scaled down to marker size. */

/* The assembled drone (real chassis / motors / props / payload GLBs), wrapped so
   the nav scenes can treat it like the small marker they used to draw: the inner
   wrapper normalises the ~3-world-unit rig down to ≈1.8 units across, so `scale`
   and any child added by the caller (mast, GPS, baro) keep their old coordinates.
   Rotors come back through `propGroups` and are spun by spinNavProps(). */
const NAV_DRONE_FIT = 0.58;        // real rig span (3.0 u) → marker span (~1.8 u)
function navDrone(scale){
  const T = THREE, g = new T.Group();
  const inner = new T.Group();
  inner.scale.setScalar(NAV_DRONE_FIT);
  inner.add(assembleDrone(true));
  g.add(inner);
  g.userData.discs = [];           // legacy field — rotors now live in propGroups
  g.scale.setScalar(scale||1);
  return g;
}
/* Spin the loaded rotor groups of the nav-scene drone. The main loop only spins
   propGroups while `rig` exists (assembly / bench views), and the nav scenes set
   rig = null, so they drive their rotors from here instead. */
function spinNavProps(step){
  propGroups.forEach((p,i)=>{
    const dir = p.userData.spinDir != null ? p.userData.spinDir : (i%2?1:-1);
    p.rotation.y += step*dir;
  });
}
/* billboard dot sprite (satellite / fix marker) */
function dotSprite(color, size){
  const cvs = document.createElement("canvas"); cvs.width=cvs.height=64;
  const cx = cvs.getContext("2d");
  const grd = cx.createRadialGradient(32,32,0,32,32,32);
  const hex = "#"+color.toString(16).padStart(6,"0");
  grd.addColorStop(0,hex); grd.addColorStop(.6,hex); grd.addColorStop(1,"rgba(0,0,0,0)");
  cx.fillStyle = grd; cx.beginPath(); cx.arc(32,32,30,0,2*Math.PI); cx.fill();
  const tex = new THREE.Texture(cvs); tex.needsUpdate = true;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map:tex, transparent:true, depthWrite:false }));
  s.scale.setScalar(size||.3);
  return s;
}
/* ── in-scene labels ──────────────────────────────────────────────────────────
   A rounded plate drawn on a canvas and shown as a camera-facing sprite with
   depthTest off, so a reading is never swallowed by the geometry it annotates.
   `setText` is a no-op when the text hasn't changed, so a label can be driven
   straight from the per-frame tick without re-rasterising every frame. */
function roundRectPath(g,x,y,w,h,r){
  g.beginPath(); g.moveTo(x+r,y); g.lineTo(x+w-r,y); g.quadraticCurveTo(x+w,y,x+w,y+r);
  g.lineTo(x+w,y+h-r); g.quadraticCurveTo(x+w,y+h,x+w-r,y+h); g.lineTo(x+r,y+h);
  g.quadraticCurveTo(x,y+h,x,y+h-r); g.lineTo(x,y+r); g.quadraticCurveTo(x,y,x+r,y); g.closePath();
}
function labelTex(lines, color){
  const L = Array.isArray(lines) ? lines : [lines];
  const W = 512, LH = 52, PAD = 14, H = L.length*LH + PAD*2;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d");
  g.fillStyle = "rgba(255,255,255,.92)"; g.strokeStyle = color; g.lineWidth = 5;
  roundRectPath(g, 4, 4, W-8, H-8, 16); g.fill(); g.stroke();
  g.fillStyle = color; g.textAlign = "center"; g.textBaseline = "middle";
  L.forEach((ln,i)=>{
    g.font = (i===0 ? "700 30px" : "500 34px")+" 'IBM Plex Mono', ui-monospace, monospace";
    g.fillText(String(ln), W/2, PAD + LH*(i+0.5));
  });
  const t = new THREE.CanvasTexture(c); t.needsUpdate = true;
  return { tex:t, aspect: W/H };
}
function navLabel(lines, color, width){
  const w = width || 0.95;
  const first = labelTex(lines, color);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map:first.tex, transparent:true, depthTest:false }));
  s.scale.set(w, w/first.aspect, 1);
  s.renderOrder = 999;
  s.userData.key = JSON.stringify([lines, color]);
  s.userData.setText = (lines2, color2)=>{
    const key = JSON.stringify([lines2, color2 || color]);
    if(key === s.userData.key) return;                 // nothing changed — skip the raster
    s.userData.key = key;
    if(s.material.map) s.material.map.dispose();
    const r = labelTex(lines2, color2 || color);
    s.material.map = r.tex; s.material.needsUpdate = true;
    s.scale.set(w, w/r.aspect, 1);
  };
  return s;
}
/* dashed measurement line between two points (leader / clearance lines) */
function dashLine(a, b, color, dashSize){
  const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
  const m = new THREE.LineDashedMaterial({ color, dashSize:dashSize||0.09, gapSize:0.06,
                                           transparent:true, opacity:.85 });
  const l = new THREE.Line(geo, m); l.computeLineDistances();
  return l;
}
function setLinePoints(line, a, b){
  line.geometry.setFromPoints([a, b]);
  line.geometry.attributes.position.needsUpdate = true;
  line.computeLineDistances();
}

/* thin ring in the XZ plane (ground circles) */
function groundRing(radius, color, opacity){
  const geo = new THREE.RingGeometry(Math.max(radius-0.02,0.001), radius, 48);
  const m = new THREE.MeshBasicMaterial({ color, transparent:true, opacity:opacity==null?.5:opacity, side:THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, m); mesh.rotation.x = -Math.PI/2;
  return mesh;
}

/* ── SKY-PLOT SCENE: dome + satellites + LOS rays + ground CEP + jittering fix ── */
function buildSkyplotScene(){
  const T = THREE, g = new T.Group();
  const DOME_R = 3.4, ORIGIN_Y = 0.02;
  // faint sky dome
  const dome = new T.Mesh(new T.SphereGeometry(DOME_R, 30, 16, 0, Math.PI*2, 0, Math.PI/2),
    new T.MeshBasicMaterial({ color:0x9fb6d8, transparent:true, opacity:.06, side:T.BackSide }));
  dome.position.y = ORIGIN_Y; g.add(dome);
  // horizon ring + ground grid disc
  g.add((()=>{ const r=groundRing(DOME_R,0xc4d1cc,.6); r.position.y=ORIGIN_Y; return r; })());
  // drone at origin
  const drone = navDrone(1.0); drone.position.y = ORIGIN_Y + 0.9; g.add(drone);
  // CEP ground circle (radius set live)
  const cepRing = groundRing(1, C_COL.orange, .8); cepRing.position.y = ORIGIN_Y+0.01; g.add(cepRing);
  // fix marker (jitters within CEP)
  const fix = dotSprite(0xc65d3b, .34); fix.position.set(0, ORIGIN_Y+0.05, 0); g.add(fix);
  // satellite sprites + LOS rays (rebuilt whenever the constellation changes)
  const satWrap = new T.Group(); g.add(satWrap);
  const rayMat = new T.LineBasicMaterial({ color:0x1f3a93, transparent:true, opacity:.35 });

  function rebuildSats(){
    while(satWrap.children.length) satWrap.remove(satWrap.children[0]);
    const sats = state.sats || [];
    sats.forEach(s=>{
      const e = losVec(s.az, s.el);   // [E,N,U]
      const P = new T.Vector3(e[0]*DOME_R, ORIGIN_Y + e[2]*DOME_R, e[1]*DOME_R);
      const sp = dotSprite(0x1f8a5b, .30); sp.position.copy(P); satWrap.add(sp);
      const geo = new T.BufferGeometry().setFromPoints([ new T.Vector3(0, ORIGIN_Y+0.9, 0), P ]);
      satWrap.add(new T.Line(geo, rayMat));
    });
  }
  rebuildSats();
  updateSkyplotSats = rebuildSats;   // sky-plot editor pushes live edits here

  navGroup = g; scene.add(g); rig = null;
  navSim = { fixR: 0, t: 0, cepWorld: 1 };

  navSceneTick = (dt)=>{
    navSim.t += dt;
    spinNavProps(0.25);
    // during a run the sim drives navSim.cepWorld + jitter; when idle show current geometry
    if(!simActive){
      const nc = navCalc();
      const cepM = isFinite(nc.cep) ? nc.cep : 60;
      navSim.cepWorld = Math.min(0.15 + cepM/40, DOME_R*0.9);   // metres → world radius
    }
    cepRing.scale.setScalar(navSim.cepWorld);
    // fix jitter: Rayleigh-ish scatter, amplitude ∝ CEP
    const amp = navSim.cepWorld * (navSim.fixAmp!=null ? navSim.fixAmp : 0.5);
    const a = navSim.t*7, jx = Math.sin(a*1.3)*amp*0.5 + (Math.random()-.5)*amp*0.4;
    const jz = Math.cos(a*1.1)*amp*0.5 + (Math.random()-.5)*amp*0.4;
    fix.position.set(jx, ORIGIN_Y+0.05, jz);
    fix.visible = navSim.noFix !== true;
  };
}

/* ── BARO SCENE: vertical atmosphere column + true vs sensed altitude markers ── */
function buildBaroScene(){
  const T = THREE, g = new T.Group();
  const COL_H = 4.6, COL_R = 0.9;            // 0..3000 m mapped to 0..COL_H
  const mToY = m => (Math.max(0,Math.min(3000,m))/3000)*COL_H;
  // pressure bands: thicker/denser low, thinning with height
  const bands = new T.Group();
  for(let i=0;i<12;i++){
    const frac = i/11, y = frac*COL_H;
    const op = 0.16*(1-frac)+0.03;
    const band = new T.Mesh(new T.CylinderGeometry(COL_R, COL_R, 0.05+0.16*(1-frac), 24, 1, true),
      new T.MeshBasicMaterial({ color:0x6c86c9, transparent:true, opacity:op, side:T.DoubleSide }));
    band.position.y = y; bands.add(band);
  }
  g.add(bands);
  // altitude axis line + ticks
  const axisMat = new T.LineBasicMaterial({ color:0xc4d1cc });
  const AX = COL_R+0.2;
  g.add(new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(AX,0,0),new T.Vector3(AX,COL_H,0)]), axisMat));
  /* ISA pressure tape: the altimeter has no idea how high it is — it only reads
     a pressure, so the column is ticked in BOTH units. Each tick prints the ISA
     pressure at that height, which is the whole lookup the sensor inverts. */
  for(let h=0; h<=3000; h+=500){
    const y = mToY(h);
    g.add(new T.Line(new T.BufferGeometry().setFromPoints(
      [new T.Vector3(AX,y,0), new T.Vector3(AX+0.14,y,0)]), axisMat));
    if(h % 1000 === 0){
      const tick = navLabel([h+" m", (pressureAt(h)/100).toFixed(1)+" hPa"], "#5c6d68", 0.8);
      tick.position.set(AX+0.62, y, 0); g.add(tick);
    }
  }
  // drone hovering (moves to true altitude)
  const drone = navDrone(0.9); g.add(drone);
  // TRUE marker (green disc) and SENSED marker (amber disc) — wider than the
  // assembled drone (≈2.1 u across) so both rings stay readable around it
  const trueRing = groundRing(COL_R+0.85, C_COL.green, .9);
  const sensRing = groundRing(COL_R+0.85, C_COL.orange, .9);
  g.add(trueRing); g.add(sensRing);

  /* ── the detection chain, spelled out in the scene ──
     sensor plate (what the barometer measures) → conversion → sensed altitude,
     with a bracket spanning the disagreement against truth. */
  const sensorLbl = navLabel(["BARO", "P 000.0 hPa"], "#1f3a93", 1.5);
  const convLbl   = navLabel(["ISA INVERSE", "h 0 m"], "#1f3a93", 1.5);
  const trueLbl   = navLabel(["TRUE", "0 m"], "#1f8a5b", 1.05);
  const sensLbl   = navLabel(["SENSED", "0 m"], "#c65d3b", 1.05);
  const errLbl    = navLabel(["ERROR", "0.0 m"], "#5c6d68", 1.0);
  g.add(sensorLbl); g.add(convLbl); g.add(trueLbl); g.add(sensLbl); g.add(errLbl);
  // leader from the drone to the sensor plate, and the true↔sensed bracket
  const feed = dashLine(new T.Vector3(), new T.Vector3(), 0x1f3a93, .07);
  const bracket = new T.Line(new T.BufferGeometry().setFromPoints(
    [new T.Vector3(), new T.Vector3()]), new T.LineBasicMaterial({ color:0xc65d3b }));
  g.add(feed); g.add(bracket);

  navGroup = g; scene.add(g); rig = null;
  navSim = { trueM: state.altitude, sensedM: state.altitude };

  const BX = -(COL_R+1.55);        // sensor-chain column, left of the atmosphere
  navSceneTick = (dt)=>{
    spinNavProps(0.4);
    if(!simActive){
      const nc = navCalc();
      navSim.trueM = nc.hTrue; navSim.sensedM = nc.baro.sensed;
    }
    const yT = mToY(navSim.trueM), yS = mToY(navSim.sensedM);
    drone.position.y = yT;
    trueRing.position.y = yT; sensRing.position.y = yS;
    // sensed ring reddens as it separates from truth
    const sep = Math.abs(navSim.sensedM - navSim.trueM);
    sensRing.material.opacity = 0.5 + Math.min(sep/20, 0.5);

    // ── readouts: pressure actually seen, its altitude sensitivity, the
    //    altitude that pressure converts to, and the resulting error ──
    const Phat = pressureAt(navSim.sensedM);          // the pressure the sensor reports
    const sens = dhdP(pressureAt(navSim.trueM))*100;  // m per hPa at this height
    const grade = state.baroGrade === "coarse" ? "COARSE BARO" : "MS5611 BARO";
    sensorLbl.userData.setText([grade, "P " + (Phat/100).toFixed(2) + " hPa"]);
    convLbl.userData.setText(["h = ISA⁻¹(P) · " + sens.toFixed(1) + " m/hPa",
                              "h " + navSim.sensedM.toFixed(1) + " m"]);
    trueLbl.userData.setText(["TRUE", Math.round(navSim.trueM) + " m"]);
    sensLbl.userData.setText(["SENSED", navSim.sensedM.toFixed(1) + " m"]);
    const d = navSim.sensedM - navSim.trueM;
    const bad = Math.abs(d) > 3.5;
    errLbl.userData.setText(["ERROR", (d>=0?"+":"") + d.toFixed(1) + " m"],
                            bad ? "#a83232" : "#5c6d68");
    sensorLbl.position.set(BX, yT + 0.62, 0);
    convLbl.position.set(BX, yT + 0.14, 0);
    // truth in front, sensed behind — they sit at nearly the same height when the
    // sensor is good, so they are separated in depth rather than vertically
    trueLbl.position.set(COL_R+0.95, yT, 1.3);
    sensLbl.position.set(COL_R+1.05, yS, -1.7);
    // below the markers: the top-right of the viewport is covered by the live
    // telemetry card, so an upward offset hides this label on a narrow pane
    errLbl.position.set(COL_R+1.7, (yT+yS)/2 - 0.5, 0.35);
    setLinePoints(feed, new T.Vector3(-0.25, yT, 0), new T.Vector3(BX+0.62, yT+0.14, 0));
    setLinePoints(bracket, new T.Vector3(COL_R+1.05, yT, 0), new T.Vector3(COL_R+1.05, yS, 0));
    bracket.material.color.setHex(bad ? 0xa83232 : 0xc65d3b);
  };
}

/* ── LATTICE COMMS TOWER (the Module 3 obstacle) ──────────────────────────────
   A self-supporting square lattice mast, modelled the way a real one is built:
   four tapered legs on concrete footings, X-braced bays with horizontal ties, a
   caged climbing ladder, a top platform carrying three sector panels and a
   microwave dish, a waveguide bundle running up one leg, guy wires, and a
   flashing aviation obstruction beacon. Every member is a real tube (10-segment
   cylinders), so the silhouette holds up under orbit and zoom. */
function towerSteel(color, rough, metal, envI){
  const m = mat(color, { roughness:rough, metalness:metal });
  const env = sceneEnvTex();
  if(env){ m.envMap = env; m.envMapIntensity = envI == null ? 0.9 : envI; }
  return m;
}
/* one tube between two points — the primitive every lattice member is made of */
function strut(a, b, r, material, seg){
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length() || 1e-4;
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg || 10, 1), material);
  mesh.position.copy(a).addScaledVector(dir, .5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), dir.clone().normalize());
  return mesh;
}
function buildCommsTower(H){
  const T = THREE, g = new T.Group();
  H = H || 2.9;
  const SHAFT = H*0.74;                       // lattice height; mast rises above it
  const W0 = 0.40, W1 = 0.115;                // half-width at base / at shaft top
  const BAYS = 9, hb = SHAFT/BAYS;
  const halfW = y => W0 + (W1-W0)*Math.min(y/SHAFT, 1);
  const SGN = [[1,1],[1,-1],[-1,-1],[-1,1]];
  const corner = (i, y) => { const w = halfW(y); return new T.Vector3(SGN[i][0]*w, y, SGN[i][1]*w); };

  // materials — ICAO alternating paint on the members, galvanised hardware
  // Hot-dip galvanised steel is a LIGHT matte grey. A high-metalness material
  // with only this dim gradient to reflect renders near-black here, so the
  // hardware is kept semi-metallic and bright instead.
  const RED = towerSteel(0xb0392c, .52, .22), WHT = towerSteel(0xe9edf1, .5, .18);
  const GALV = towerSteel(0xc3cbd2, .44, .55, 1.0);
  const CONCRETE = mat(0x9a978f, { roughness:.95, metalness:.02 });
  const RADOME = towerSteel(0xdfe4e8, .58, .1);
  const BANDS = 7;
  const paintAt = y => (Math.floor(y/H*BANDS) % 2) ? WHT : RED;

  // ── foundations: a chamfered concrete pier + anchor bolts under each leg ──
  for(let i=0;i<4;i++){
    const c = corner(i, 0);
    const pier = new T.Mesh(new T.CylinderGeometry(.13,.17,.22,4,1), CONCRETE);
    pier.position.set(c.x, .11, c.z); pier.rotation.y = Math.PI/4; g.add(pier);
    const plate = new T.Mesh(new T.BoxGeometry(.15,.02,.15), GALV);
    plate.position.set(c.x, .23, c.z); g.add(plate);
    for(let b=0;b<4;b++){
      const bx = new T.Mesh(new T.CylinderGeometry(.008,.008,.05,8), GALV);
      bx.position.set(c.x + (b%2?.05:-.05), .25, c.z + (b<2?.05:-.05)); g.add(bx);
    }
  }

  // ── legs, horizontal ties, X bracing, secondary (redundant) bracing ──
  for(let bay=0; bay<BAYS; bay++){
    const y0 = .22 + bay*hb, y1 = .22 + (bay+1)*hb;
    const legR = 0.026 - 0.012*(bay/BAYS);     // legs thin out with height
    const braceR = 0.011 - 0.004*(bay/BAYS);
    const paint = paintAt((y0+y1)/2);
    for(let i=0;i<4;i++){
      const a = corner(i, y0), b = corner(i, y1);
      g.add(strut(a, b, legR, paint, 12));
      // flange plate at every leg splice — the joint a real tower bolts up
      const fl = new T.Mesh(new T.CylinderGeometry(legR*1.9, legR*1.9, .018, 12), GALV);
      fl.position.copy(b); g.add(fl);
      const j = (i+1)%4;
      const a2 = corner(j, y0), b2 = corner(j, y1);
      g.add(strut(b, b2, braceR, paint, 10));            // horizontal tie
      g.add(strut(a, b2, braceR*0.85, GALV, 8));         // X brace
      g.add(strut(a2, b, braceR*0.85, GALV, 8));
      // short redundant member from the X crossing to the tie mid-point
      const mid = a.clone().add(b2).multiplyScalar(.5);
      const tieMid = b.clone().add(b2).multiplyScalar(.5);
      g.add(strut(mid, tieMid, braceR*0.6, GALV, 6));
    }
  }
  // base cross-bracing between the widest legs (the K-frame at ground level)
  for(let i=0;i<4;i++){
    const a = corner(i, .24), b = corner((i+1)%4, .24);
    g.add(strut(a, b, .014, RED, 10));
  }

  // ── caged climbing ladder up the +X face ──
  const ladder = new T.Group();
  const LY0 = .3, LY1 = SHAFT - .05;
  const lx = y => halfW(y) + .06;
  for(const dz of [-.075, .075]){
    const a = new T.Vector3(lx(LY0), LY0, dz), b = new T.Vector3(lx(LY1), LY1, dz);
    ladder.add(strut(a, b, .012, GALV, 10));
  }
  for(let y = LY0+.06; y < LY1; y += .105){
    const r = new T.Mesh(new T.CylinderGeometry(.007,.007,.15,8), GALV);
    r.position.set(lx(y), y, 0); r.rotation.x = Math.PI/2; ladder.add(r);
  }
  for(let y = 1.0; y < LY1; y += .34){          // safety cage hoops start at ~2 m scale height
    const hoop = new T.Mesh(new T.TorusGeometry(.15, .009, 8, 22, Math.PI*1.25), GALV);
    hoop.position.set(lx(y), y, 0); hoop.rotation.y = Math.PI/2; hoop.rotation.z = -Math.PI*0.62;
    ladder.add(hoop);
  }
  g.add(ladder);

  // ── waveguide / feeder bundle snaking up one leg into the platform ──
  const curve = new T.CatmullRomCurve3([
    new T.Vector3(-W0-.08, .05, -W0-.02), new T.Vector3(-W0*.9, .6, -W0*.8),
    new T.Vector3(-halfW(1.4)-.04, 1.4, -halfW(1.4)-.03),
    new T.Vector3(-halfW(SHAFT*.8)-.03, SHAFT*.8, -halfW(SHAFT*.8)-.02),
    new T.Vector3(-.06, SHAFT+.02, -.05)
  ]);
  const bundle = new T.Mesh(new T.TubeGeometry(curve, 64, .022, 10, false),
    towerSteel(0x2f3439, .78, .1));
  g.add(bundle);

  // ── platform: octagon deck + double handrail + kick plate ──
  const plat = new T.Group(); plat.position.y = SHAFT;
  const deckR = W1 + .3;
  const deck = new T.Mesh(new T.CylinderGeometry(deckR, deckR, .022, 8), GALV);
  plat.add(deck);
  for(const rh of [.18, .34]){
    const rail = new T.Mesh(new T.TorusGeometry(deckR, .009, 8, 32), GALV);
    rail.rotation.x = Math.PI/2; rail.position.y = rh; plat.add(rail);
  }
  for(let i=0;i<8;i++){
    const a = i/8*Math.PI*2, p = new T.Mesh(new T.CylinderGeometry(.011,.011,.36,8), GALV);
    p.position.set(Math.cos(a)*deckR, .18, Math.sin(a)*deckR); plat.add(p);
  }
  g.add(plat);

  // ── three sector panel antennas on stand-off arms ──
  for(let i=0;i<3;i++){
    const a = i/3*Math.PI*2 + Math.PI/6, R = deckR + .1;
    const panel = new T.Mesh(new T.BoxGeometry(.055,.34,.13), RADOME);
    panel.position.set(Math.cos(a)*R, SHAFT+.30, Math.sin(a)*R);
    panel.rotation.y = -a; panel.rotation.z = 0.06;         // slight downtilt
    g.add(panel);
    const cap = new T.Mesh(new T.CylinderGeometry(.028,.028,.055,10), RADOME);
    cap.position.copy(panel.position); cap.position.y += .18; cap.rotation.z = Math.PI/2;
    cap.rotation.y = -a; g.add(cap);
    for(const dy of [.10, -.10]){
      const arm = strut(
        new T.Vector3(Math.cos(a)*(W1+.02), SHAFT+.30+dy, Math.sin(a)*(W1+.02)),
        new T.Vector3(Math.cos(a)*R, SHAFT+.30+dy, Math.sin(a)*R), .009, GALV, 8);
      g.add(arm);
    }
  }

  // ── microwave dish: a thin spherical-cap reflector, rolled rim, and a feed
  //    horn held at the focus by a three-leg spar. Built opening toward +Y, then
  //    yawed a quarter turn so it points out from the tower with a slight uptilt.
  const dish = new T.Group();
  const DR = 0.165, SR = DR*1.45;
  const shell = new T.Mesh(
    new T.SphereGeometry(SR, 44, 26, 0, Math.PI*2, Math.PI*0.72, Math.PI*0.28), RADOME);
  shell.material.side = T.DoubleSide; dish.add(shell);
  const rimY = SR*Math.cos(Math.PI*0.72), rimR = SR*Math.sin(Math.PI*0.72);
  const rim = new T.Mesh(new T.TorusGeometry(rimR, .012, 10, 40), GALV);
  rim.rotation.x = Math.PI/2; rim.position.y = rimY; dish.add(rim);
  const horn = new T.Mesh(new T.CylinderGeometry(.018,.032,.07,14), GALV);
  horn.position.y = rimY + .085; dish.add(horn);
  for(let i=0;i<3;i++){
    const a = i/3*Math.PI*2;
    dish.add(strut(new T.Vector3(Math.cos(a)*rimR*.92, rimY, Math.sin(a)*rimR*.92),
                   new T.Vector3(0, rimY + .07, 0), .0055, GALV, 6));
  }
  const backHub = new T.Mesh(new T.CylinderGeometry(.03,.04,.06,12), GALV);
  backHub.position.y = -SR + .01; dish.add(backHub);
  dish.rotation.z = -Math.PI/2 + 0.10;                 // open outward (+X), slight uptilt
  dish.position.set(deckR + .30, SHAFT + .02, 0);
  g.add(dish);
  g.add(strut(new T.Vector3(W1, SHAFT+.02, 0), new T.Vector3(deckR+.13, SHAFT+.02, 0), .012, GALV, 8));

  // ── mast, lightning finial, obstruction beacon ──
  const mastTop = H;
  g.add(strut(new T.Vector3(0, SHAFT, 0), new T.Vector3(0, mastTop-.1, 0), .028, WHT, 14));
  const finial = new T.Mesh(new T.ConeGeometry(.016,.16,10), GALV);
  finial.position.y = mastTop + .06; g.add(finial);
  const beaconMat = new T.MeshStandardMaterial({ color:0xd63b2a, emissive:0xff3b25,
    emissiveIntensity:1.2, roughness:.35, metalness:.1 });
  const beacon = new T.Mesh(new T.SphereGeometry(.05, 20, 14), beaconMat);
  beacon.position.y = mastTop - .06; g.add(beacon);
  const beaconCage = new T.Mesh(new T.CylinderGeometry(.055,.055,.10,12,1,true), GALV);
  beaconCage.position.y = mastTop - .06; beaconCage.material = GALV; g.add(beaconCage);
  const glow = dotSprite(0xff4b2e, .2); glow.position.y = mastTop - .06; g.add(glow);

  // ── guy wires to concrete anchor blocks ──
  const wireMat = towerSteel(0x6f767d, .6, .8);
  for(let i=0;i<3;i++){
    const a = i/3*Math.PI*2 + .4, GR = 1.25, gy = SHAFT*.72;
    const anchor = new T.Mesh(new T.BoxGeometry(.16,.1,.16), CONCRETE);
    anchor.position.set(Math.cos(a)*GR, .05, Math.sin(a)*GR); g.add(anchor);
    g.add(strut(new T.Vector3(Math.cos(a)*GR, .1, Math.sin(a)*GR),
                new T.Vector3(Math.cos(a)*halfW(gy), gy, Math.sin(a)*halfW(gy)), .0055, wireMat, 6));
  }

  // beacon flash: ~1 s period, sharp on-pulse like a real medium-intensity light
  g.userData.tick = (t)=>{
    const ph = (t % 1.15) / 1.15;
    const on = ph < 0.22 ? 1 : Math.max(0, 1 - (ph-0.22)*4);
    beaconMat.emissiveIntensity = 0.25 + on*2.6;
    glow.material.opacity = 0.10 + on*0.55;
    glow.scale.setScalar(.16 + on*.12);
  };
  return g;
}

/* ── NAV3D SCENE: drone + translucent error ellipsoid + drift cloud + obstacle ── */
function buildNav3dScene(){
  const T = THREE, g = new T.Group();
  const BASE_Y = 1.2;
  g.add(groundRing(3.0, 0xc4d1cc, .5));
  const drone = navDrone(1.1); drone.position.y = BASE_Y; g.add(drone);
  // translucent error ellipsoid (unit sphere; scaled to CEP horiz / hErr vert)
  const ellipsoid = new T.Mesh(new T.SphereGeometry(1, 24, 18),
    new T.MeshStandardMaterial({ color:0x1f8a5b, transparent:true, opacity:.18, roughness:.6 }));
  ellipsoid.position.y = BASE_Y; g.add(ellipsoid);
  const ellWire = new T.Mesh(new T.SphereGeometry(1, 16, 12),
    new T.MeshBasicMaterial({ color:0x1f8a5b, wireframe:true, transparent:true, opacity:.25 }));
  ellWire.position.y = BASE_Y; g.add(ellWire);
  // drift cloud of past fixes
  const cloud = new T.Group(); g.add(cloud);
  const cloudPts = [];
  for(let i=0;i<40;i++){ const sp = dotSprite(0x4f6d9e, .12); sp.visible=false; cloud.add(sp); cloudPts.push(sp); }
  // nearby obstacle: a lattice comms tower the drone drifts toward when the
  // error sphere grows (the thing a bad fix actually flies you into)
  const TOWER_H = 3.1, TOWER_X = 2.6, TOWER_R = 0.55;   // TOWER_R ≈ base half-width + guys
  const obstacle = buildCommsTower(TOWER_H);
  obstacle.position.set(TOWER_X, 0, 0); obstacle.rotation.y = -0.35; g.add(obstacle);

  /* ── what the tower is FOR ────────────────────────────────────────────────
     The ellipsoid is scaled at 1 world unit per 12 m (see cepW below), so the
     same factor converts the drone↔tower gap into a real separation. Labelled
     live: the tower's size, the 3-D error radius, and the clearance left over
     — the moment the error exceeds the clearance the fix can no longer prove
     the drone is clear of the structure. */
  const M_PER_U = 12;
  const uToM = u => u * M_PER_U;
  const towerLbl = navLabel(["COMMS MAST", Math.round(uToM(TOWER_H))+" m obstacle"], "#5c6d68", 1.05);
  towerLbl.position.set(TOWER_X, TOWER_H + 0.42, 0); g.add(towerLbl);
  const errLbl = navLabel(["3-D ERROR", "0.0 m"], "#1f8a5b", 0.92); g.add(errLbl);
  const clrLbl = navLabel(["CLEARANCE", "0 m"], "#5c6d68", 0.92); g.add(clrLbl);
  const clrLine = dashLine(new T.Vector3(), new T.Vector3(), 0x5c6d68, .10); g.add(clrLine);
  // radius bar from the drone to the edge of its own error sphere
  const radLine = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]),
    new T.LineBasicMaterial({ color:0x1f8a5b }));
  g.add(radLine);

  navGroup = g; scene.add(g); rig = null;
  navSim = { cepW:0.4, hW:0.4, t:0, cloudI:0, drift:0, unsafe:false, rewardShown:false };

  navSceneTick = (dt)=>{
    navSim.t += dt;
    spinNavProps(0.45);
    if(obstacle.userData.tick) obstacle.userData.tick(navSim.t);   // beacon flash
    if(!simActive){
      const nc = navCalc();
      const cepM = isFinite(nc.cep)?nc.cep:60, hM = nc.hErr;
      navSim.cepW = Math.min(0.15 + cepM/12, 2.6);
      navSim.hW   = Math.min(0.15 + hM/12, 2.6);
      navSim.unsafe = !(isFinite(nc.total) && nc.total < 5);
    }
    // scale the ellipsoid: horizontal = CEP, vertical = hErr
    ellipsoid.scale.set(navSim.cepW, navSim.hW, navSim.cepW);
    ellWire.scale.set(navSim.cepW, navSim.hW, navSim.cepW);
    const safe = !navSim.unsafe;
    const col = safe ? 0x1f8a5b : 0xa83232;
    ellipsoid.material.color.setHex(col); ellWire.material.color.setHex(col);
    // drift toward the obstacle when the sphere is large. Clamped at 0: the old
    // (cepW−0.8) form went NEGATIVE for a marginally-unsafe fix, which pushed the
    // drone away from the mast — the opposite of the point being made.
    const target = navSim.unsafe ? Math.max(0, Math.min((navSim.cepW-0.4)*0.9, 1.6)) : 0;
    navSim.drift += (target - navSim.drift) * Math.min(dt*1.5, 1);
    drone.position.x = navSim.drift; ellipsoid.position.x = navSim.drift; ellWire.position.x = navSim.drift;
    // spawn a drift-cloud fix now and then
    if(navSim.t*4 % 1 < dt*4){
      const sp = cloudPts[navSim.cloudI % cloudPts.length]; navSim.cloudI++;
      sp.visible = true;
      sp.position.set(navSim.drift + (Math.random()-.5)*navSim.cepW*1.4, BASE_Y + (Math.random()-.5)*navSim.hW*1.4, (Math.random()-.5)*navSim.cepW*1.4);
      sp.material.color.setHex(safe?0x4f6d9e:0xc65d3b);
    }
    // ── live obstacle geometry: error radius vs the gap left to the mast ──
    // semi-axes back out of world units (undo the 0.15 floor), then the same
    // √(CEP² + h_err²) the experiment is grading
    const aM = uToM(Math.max(navSim.cepW - 0.15, 0)), bM = uToM(Math.max(navSim.hW - 0.15, 0));
    const errM = Math.sqrt(aM*aM + bM*bM);
    const gapU  = (TOWER_X - TOWER_R) - drone.position.x;
    const clrM  = Math.max(0, uToM(gapU));
    const hit   = errM >= clrM;
    const errHex = safe ? "#1f8a5b" : "#a83232";
    errLbl.userData.setText(["3-D ERROR", "±" + errM.toFixed(1) + " m"], errHex);
    errLbl.position.set(drone.position.x, BASE_Y + navSim.hW + 0.42, 0);
    clrLbl.userData.setText([hit ? "COLLISION RISK" : "CLEARANCE",
                             clrM.toFixed(0) + " m gap"], hit ? "#a83232" : "#5c6d68");
    clrLbl.position.set((drone.position.x + TOWER_X - TOWER_R)/2, BASE_Y + 0.05, 0);
    setLinePoints(clrLine, new T.Vector3(drone.position.x, BASE_Y-0.28, 0),
                           new T.Vector3(TOWER_X - TOWER_R, BASE_Y-0.28, 0));
    clrLine.material.color.setHex(hit ? 0xa83232 : 0x5c6d68);
    setLinePoints(radLine, new T.Vector3(drone.position.x, BASE_Y, 0),
                           new T.Vector3(drone.position.x + navSim.cepW, BASE_Y, 0));
    radLine.material.color.setHex(safe ? 0x1f8a5b : 0xa83232);
    // when passed, reveal the mounted GPS mast + barometer box reward
    if(navSim.reward && !navSim.rewardShown){
      navSim.rewardShown = true; addNav3dReward(drone, BASE_Y);
    }
  };
}
/* mount the unlocked GPS module on a top mast + a procedural barometer box under
   the drone body (shown when the nav3d experiment passes). */
function addNav3dReward(drone, baseY){
  const T = THREE;
  const mast = new T.Mesh(new T.CylinderGeometry(.03,.03,.5,10), mat(0x9aa5b1,{metalness:.6}));
  mast.position.set(0,.32,0); drone.add(mast);
  const gpsO = (DRONE_DB.reward && DRONE_DB.reward.files && DRONE_DB.reward.files.length)
    ? { files:DRONE_DB.reward.files, fallback:{kind:"gps",color:0x1b6ec2,s:1}, catKey:"attachments" }
    : { files:[], fallback:{kind:"gps",color:0x1b6ec2,s:1}, catKey:"attachments" };
  const gps = modelFor(gpsO, .5, m=>{ m.position.y += 0.02; });
  gps.position.set(0,.62,0); drone.add(gps);
  // procedural barometer box tucked inside the FC enclosure (under the body)
  const baro = fitUnit(buildFallback({kind:"baro",color:0x1f6a3a,s:1}), .34, null);
  baro.position.set(0,-.06,0); drone.add(baro);
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
/* ── NAVIGATION input cards (Constellation + Sensor & Atmosphere) ── */
const SKY_PRESETS = [
  { id:"spread",    label:"Spread",    hint:"good geometry" },
  { id:"clustered", label:"Clustered", hint:"one sky cone" },
  { id:"wall",      label:"Wall",      hint:"all high-el" },
  { id:"line",      label:"Line",      hint:"collinear" }
];
/* re-render nav readouts + everything derived from the constellation/sensors */
function navChanged(rebuildScene){
  saveState();
  renderNavCards();
  renderCalcChips();
  renderLog();
  drawLiveGraph();
  if(rebuildScene) buildScene();
  if(!simActive) updateTelemetry(navTelemetry());
}
function renderNavCards(){
  const host = $("navCards"); if(!host) return;
  const nc = navCalc();
  const dopTxt = nc.dop.ok ? nc.dop.hdop.toFixed(2) : "∞";
  const dopCls = !nc.dop.ok ? "warn" : nc.dop.hdop < 2 ? "good" : nc.dop.hdop < 4 ? "" : "warn";
  const presetBtns = SKY_PRESETS.map(p=>
    '<button type="button" class="nav-preset'+(state.skyPreset===p.id?" active":"")+'" data-preset="'+p.id+'" title="'+p.hint+'">'+p.label+'</button>'
  ).join("");
  const grade = NAV.baroGrades[state.baroGrade];
  host.innerHTML =
    // Constellation card
    '<div class="card nav-card" id="navConstCard">'+
      '<div class="row-between"><span class="card-title">Constellation <em>· GPS sky</em></span>'+
        '<span class="nav-badge mono '+dopCls+'">HDOP '+dopTxt+'</span></div>'+
      '<div class="nav-row"><span class="nav-lbl">Satellites</span>'+
        '<input type="range" id="satSlider" min="4" max="12" step="1" value="'+state.satCount+'" aria-label="Satellite count">'+
        '<b class="mono nav-num" id="satCountTxt">'+state.satCount+'</b></div>'+
      '<div class="nav-presets">'+presetBtns+'</div>'+
      '<button type="button" class="nav-edit" id="skyEditBtn">◎ Edit sky-plot (drag satellites) ›</button>'+
      '<div class="nav-mini mono">'+
        '<span>VDOP <b class="'+(nc.dop.ok&&nc.dop.vdop<8?"good":"warn")+'">'+(nc.dop.ok?nc.dop.vdop.toFixed(1):"∞")+'</b></span>'+
        '<span>PDOP <b>'+(nc.dop.ok?nc.dop.pdop.toFixed(1):"∞")+'</b></span>'+
        '<span>CEP <b class="'+(isFinite(nc.cep)&&nc.cep<4?"good":"warn")+'">'+(isFinite(nc.cep)?nc.cep.toFixed(1)+" m":"∞")+'</b></span>'+
      '</div>'+
    '</div>'+
    // Sensor & Atmosphere card
    '<div class="card nav-card" id="navSensorCard">'+
      '<div class="row-between"><span class="card-title">Sensor & Atmosphere</span>'+
        '<span class="nav-badge mono '+(nc.hErr<3?"good":"warn")+'">±'+nc.hErr.toFixed(1)+' m</span></div>'+
      '<div class="nav-seg-row"><span class="nav-lbl">Barometer</span><div class="nav-seg" id="baroSeg">'+
        '<button type="button" data-grade="fine"'+(state.baroGrade==="fine"?' class="active"':'')+'>Fine</button>'+
        '<button type="button" data-grade="coarse"'+(state.baroGrade==="coarse"?' class="active"':'')+'>Coarse</button>'+
      '</div></div>'+
      '<div class="nav-seg-row"><span class="nav-lbl">Ranging (UERE)</span><div class="nav-seg" id="uereSeg">'+
        '<button type="button" data-uere="nominal"'+(state.uereScenario==="nominal"?' class="active"':'')+'>Open-sky</button>'+
        '<button type="button" data-uere="urban"'+(state.uereScenario==="urban"?' class="active"':'')+'>Urban</button>'+
      '</div></div>'+
      '<label class="nav-toggle"><input type="checkbox" id="invChk"'+(state.inversion?" checked":"")+'>'+
        '<span>Temperature inversion <em>(systematic bias)</em></span></label>'+
      '<div class="nav-mini mono"><span>'+txt(grade.name)+'</span>'+
        '<span>UERE <b>'+(NAV.uere[state.uereScenario]).toFixed(1)+' m</b></span></div>'+
    '</div>';
  // wiring
  const ss = $("satSlider");
  if(ss) ss.addEventListener("input", e=>{
    state.satCount = +e.target.value; $("satCountTxt").textContent = state.satCount;
    state.sats = makePreset(state.skyPreset, state.satCount);   // resize regenerates from preset
    navChanged(true);
  });
  host.querySelectorAll(".nav-preset").forEach(b=>b.addEventListener("click", ()=>{
    state.skyPreset = b.dataset.preset;
    state.sats = makePreset(state.skyPreset, state.satCount);
    sfx("tick"); navChanged(true);
  }));
  const seb = $("skyEditBtn"); if(seb) seb.addEventListener("click", openSkyEditor);
  host.querySelectorAll("#baroSeg button").forEach(b=>b.addEventListener("click", ()=>{
    state.baroGrade = b.dataset.grade; sfx("tick"); navChanged(false);
  }));
  host.querySelectorAll("#uereSeg button").forEach(b=>b.addEventListener("click", ()=>{
    state.uereScenario = b.dataset.uere; sfx("tick"); navChanged(true);
  }));
  const ic = $("invChk"); if(ic) ic.addEventListener("change", ()=>{
    state.inversion = ic.checked; sfx("tick"); navChanged(true);
  });
}
// M2/M3 unlock once the M1 constellation-geometry experiment passes
const NAV_GATE_KEY = "m1:geometry";
function renderModuleTabs(){
  const box = $("moduleTabs"); box.innerHTML = "";
  const gated = !!state.done[NAV_GATE_KEY];
  DRONE_DB.modules.forEach(m=>{
    const locked = m.id !== "m1" && !gated;
    const b = el("button", m.id===state.module ? "active" : ""); b.type = "button";
    b.disabled = locked;
    b.innerHTML = (locked?"🔒 ":"")+txt(m.label)+' <small>· '+txt(m.sub)+'</small>';
    b.title = locked ? "Pass the Constellation Geometry check in Module 1 first" : "";
    b.addEventListener("click", ()=>{
      if(locked) return;
      if(simActive) stopSim(false);
      state.module = m.id; saveState();
      renderModuleTabs(); renderExpTabs(); syncRunControls(); drawLiveGraph(); buildScene(); syncRunControls();
      // each module here holds a single experiment, so the module tab IS the
      // experiment switch — introduce it the same way the experiment tab does
      playIntroVoice(currentIntroKey());
    });
    box.appendChild(b);
  });
}
function renderExpTabs(){
  const box = $("expTabs"); box.innerHTML = "";
  const m = DRONE_DB.modules.find(m=>m.id===state.module);
  const gated = !!state.done[NAV_GATE_KEY];
  m.experiments.forEach(e=>{
    const key = m.id+":"+e.id;
    const locked = m.id !== "m1" && !gated;
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
  if(isNavScene()){
    const nc = navCalc();
    const chips = [
      { k:"HDOP", v: nc.dop.ok ? nc.dop.hdop.toFixed(2) : "∞",
        cls: !nc.dop.ok ? "warn" : nc.dop.hdop<2 ? "good" : nc.dop.hdop<4 ? "" : "warn" },
      { k:"Horizontal CEP", v: isFinite(nc.cep) ? nc.cep.toFixed(1)+" m" : "∞",
        cls: isFinite(nc.cep) && nc.cep<4 ? "good" : "warn" },
      { k:"Baro error", v: "±"+nc.hErr.toFixed(1)+" m", cls: nc.hErr<3.5 ? "good" : "warn" },
      { k:"3-D error radius", v: isFinite(nc.total) ? nc.total.toFixed(1)+" m" : "∞",
        cls: isFinite(nc.total) && nc.total<5 ? "good" : "warn" },
      { k:"Satellites in view", v: String(nc.sats.length), cls:"" }
    ];
    const box = $("calcChips"); box.innerHTML = "";
    chips.forEach(ch=>{
      const d = el("div","calc-chip");
      d.innerHTML = '<span class="k">'+ch.k+'</span><span class="v '+ch.cls+'">'+ch.v+'</span>';
      box.appendChild(d);
    });
    return;
  }
  const c = calc();
  const canHover = c.tw > 1;
  const chips = [
    { k:"T / W ratio", v:c.tw.toFixed(2), cls:c.tw>=1.8 ? "good" : c.tw>=1.2 ? "" : "warn" },
    { k:"Hover throttle", v:canHover ? Math.round(c.hoverPct)+" %" : "—", cls:!canHover ? "warn" : c.hoverPct<=60 ? "good" : c.hoverPct<=80 ? "" : "warn" },
    { k:"Thrust eff.", v:c.gPerW.toFixed(1)+" g/W", cls:c.gPerW>=6?"good":c.gPerW>=3?"":"warn" },
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
/* nav telemetry — HDOP / VDOP / Sats / PDOP / CEP / Baro σ / Alt true / Alt sensed */
function updateTelemetry(t){
  t = t || {};
  const dop = num => (num==null || !isFinite(num)) ? "∞" : num.toFixed(2);
  const m   = num => (num==null || !isFinite(num)) ? "∞" : num.toFixed(1)+" m";
  $("telThrust").textContent = t.hdop!=null ? dop(t.hdop) : "—";
  $("telRpm").textContent    = t.vdop!=null ? dop(t.vdop) : "—";
  $("telCur").textContent    = t.sats!=null ? String(t.sats) : "0";
  $("telPwr").textContent    = t.pdop!=null ? dop(t.pdop) : "—";
  $("telTemp").textContent   = t.cep!=null ? m(t.cep) : "— m";
  $("telEsc").textContent    = t.sigma!=null ? m(t.sigma) : "— m";
  $("telBat").textContent    = t.altTrue!=null ? Math.round(t.altTrue)+" m" : "0 m";
  $("telAlt").textContent    = t.altSensed!=null ? t.altSensed.toFixed(2)+" m" : "0.00 m";
  const ph = $("telPhase");
  ph.textContent = t.phase || "STANDBY";
  ph.className = "tel-phase mono"+(t.phaseCls?" "+t.phaseCls:"");
}
/* live telemetry snapshot for the CURRENT nav inputs (shown when idle) */
function navTelemetry(extra){
  const nc = navCalc();
  return Object.assign({
    hdop:nc.dop.hdop, vdop:nc.dop.vdop, pdop:nc.dop.pdop, sats:nc.sats.length,
    cep:nc.cep, sigma:nc.hErr, altTrue:nc.hTrue, altSensed:nc.baro.sensed
  }, extra||{});
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
const TEL_SERIES = {
  build:  { a:{label:"Thrust-to-weight ratio", color:C_COL.blue} },
  thrust: { a:{label:"Total thrust (N)", color:C_COL.blue}, b:{label:"Motor current (A)", color:C_COL.orange} },
  temp:   { a:{label:"Motor winding (°C)", color:C_COL.orange}, b:{label:"Shaft RPM", color:C_COL.blue} },
  eff:    { a:{label:"Motor efficiency (%)", color:C_COL.green}, b:{label:"Thrust eff. (g/W)", color:C_COL.slate, scale:0.1} },
  alt:    { a:{label:"Altitude (m)", color:C_COL.green}, b:{label:"Total thrust (N)", color:C_COL.slate}, xtime:true },
  hdopcep:{ a:{label:"Fix error (m)", color:C_COL.blue}, b:{label:"HDOP", color:C_COL.orange} },
  baroerr:{ a:{label:"Altitude error (m)", color:C_COL.green}, b:{label:"True altitude (m)", color:C_COL.slate} },
  nav3d:  { a:{label:"3D error radius (m)", color:C_COL.blue}, b:{label:"CEP (m)", color:C_COL.slate} }
};
function telemetryConfig(metric, data, data2, flightT, opts){
  opts = opts || {};
  const s = TEL_SERIES[metric] || TEL_SERIES.build, n = data.length;
  const labels = data.map((_,i)=> s.xtime && flightT ? +(i/Math.max(n-1,1)*flightT).toFixed(1) : i);
  const tick = { font:{ family:"'IBM Plex Mono'", size:opts.mini?8:10 } };
  const ds = [{ label:s.a.label, data:data.slice(), borderColor:s.a.color, backgroundColor:s.a.color+"1f",
    borderWidth:2, pointRadius:0, tension:.25, fill:true, yAxisID:"y" }];
  const scales = {
    x:{ title:{display:!opts.mini, text:s.xtime?"Flight time (s)":"Sample #"}, grid:{color:C_COL.grid},
        ticks:Object.assign({maxTicksLimit:opts.mini?5:9}, tick) },
    y:{ title:{display:!opts.mini, text:s.a.label}, grid:{color:C_COL.grid}, ticks:tick }
  };
  if(s.b && data2 && data2.length){
    ds.push({ label:s.b.label, data:data2.map(v=>v*(s.b.scale||1)), borderColor:s.b.color,
      borderWidth:2, pointRadius:0, tension:.25, borderDash:[5,4], yAxisID:"y1" });
    scales.y1 = { position:"right", title:{display:!opts.mini, text:s.b.label},
      grid:{drawOnChartArea:false}, ticks:tick };
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
  let data, data2, flightT, recording = false;
  if(live){ data = sim.data; data2 = sim.data2; flightT = sim.flightT || 0; recording = true; }
  else if(lastRun.key === key && lastRun.data.length > 1){ data = lastRun.data; data2 = lastRun.data2; flightT = lastRun.flightT; }
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
    const s = TEL_SERIES[metric] || TEL_SERIES.build;
    ch.data.labels = data.map((_,i)=> s.xtime && flightT ? +(i/Math.max(data.length-1,1)*flightT).toFixed(1) : i);
    ch.data.datasets[0].data = data.slice();
    if(ch.data.datasets[1]) ch.data.datasets[1].data = data2.map(v=>v*((s.b&&s.b.scale)||1));
    ch.update("none");
  }else{
    const c = ChartHub.put("liveGraph", telemetryConfig(metric, data, data2, flightT, {mini:true, live:recording}));
    if(c) c._metric = metric;
  }
  if(cap) cap.textContent = exp.name+" · "+(exp.unit||"value")+
    (metric==="alt" && flightT ? " · flight "+fmtMMSS(flightT) : "")+(recording ? " · recording…" : " · last run");
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
/* generic XY plotter for the charts modal */
/* ── analysis-chart builders (each returns a Chart.js config, computed live) ── */
function throttleSweep(){
  const d=[], thr=[], cur=[], eff=[], gpw=[];
  for(let x=0.05; x<=1.0001; x+=0.05){ const dd=+x.toFixed(2), r=solveQuad(dd,1);
    d.push(Math.round(dd*100)); thr.push(+r.Ttot.toFixed(3)); cur.push(+r.Itot.toFixed(2));
    eff.push(r.P>0? +(r.Pmech/r.P*100).toFixed(1):0); gpw.push(r.P>0? +((r.Ttot/G*1000)/r.P).toFixed(2):0); }
  return { d, thr, cur, eff, gpw };
}
function cfgThrustCurrent(){
  const s = throttleSweep();
  return { type:"line", data:{ labels:s.d, datasets:[
    { label:"Total thrust (N)", data:s.thr, borderColor:C_COL.blue, backgroundColor:C_COL.blue+"1f", borderWidth:2, pointRadius:0, tension:.3, fill:true, yAxisID:"y" },
    { label:"Total current (A)", data:s.cur, borderColor:C_COL.orange, borderWidth:2, pointRadius:0, tension:.3, borderDash:[5,4], yAxisID:"y1" } ] },
    options: baseXY("Throttle (%)", {y:"Thrust (N)", y1:"Current (A)"}) };
}
function cfgEfficiency(){
  const s = throttleSweep(), c = calc();
  const hoverX = c.tw>1 ? Math.round(c.hoverD*100) : null;
  const cfg = { type:"line", data:{ labels:s.d, datasets:[
    { label:"Motor efficiency (%)", data:s.eff, borderColor:C_COL.green, backgroundColor:C_COL.green+"1f", borderWidth:2, pointRadius:0, tension:.35, fill:true, yAxisID:"y" },
    { label:"Thrust eff. (g/W)", data:s.gpw, borderColor:C_COL.slate, borderWidth:2, pointRadius:0, tension:.35, borderDash:[5,4], yAxisID:"y1" } ] },
    options: baseXY("Throttle (%)", {y:"Efficiency (%)", y1:"g/W"}, {}) };
  cfg.options.scales.y.max = 100;
  if(hoverX!=null){ cfg.data.datasets.push({ label:"Hover throttle", data:s.d.map(x=>x===hoverX?100:null),
    borderColor:C_COL.muted, borderWidth:1.5, borderDash:[3,3], pointRadius:0, yAxisID:"y",
    spanGaps:false, showLine:true }); }
  return cfg;
}
function cfgThrustVsCurrent(){
  const s = throttleSweep();
  return { type:"scatter", data:{ datasets:[{ label:"Thrust vs current",
    data:s.cur.map((c,i)=>({x:c,y:s.thr[i]})), borderColor:C_COL.green, backgroundColor:C_COL.green,
    showLine:true, borderWidth:2, tension:.3, pointRadius:3 }] },
    options: baseXY("Total current (A)", {y:"Total thrust (N)"}) };
}
function cfgThermal(){
  const th = simulateThermal(0.85, 240, 2);
  return { type:"line", data:{ labels:th.t, datasets:[
    { label:"Motor winding (°C)", data:th.temp.map(v=>+v.toFixed(1)), borderColor:C_COL.orange, borderWidth:2, pointRadius:0, tension:.25, yAxisID:"y" },
    { label:"ESC (°C)", data:th.escTemp.map(v=>+v.toFixed(1)), borderColor:C_COL.red, borderWidth:2, pointRadius:0, tension:.25, borderDash:[4,3], yAxisID:"y" },
    { label:"Shaft RPM", data:th.rpm.map(v=>Math.round(v)), borderColor:C_COL.blue, borderWidth:1.5, pointRadius:0, tension:.25, yAxisID:"y1" } ] },
    options: baseXY("Time at 85% throttle (s)", {y:"Temperature (°C)", y1:"RPM"}) };
}
function cfgThrustGeom(){
  const c = calc(), p = c.p, fixedRpm = c.full.rpm || 6000, fixedN = fixedRpm/60;
  const dia=[], thr=[];
  for(let dIn=3; dIn<=17.001; dIn+=0.5){ const Dm=dIn*0.0254;
    const aero = propAero(Object.assign({},p,{D:Dm, diaIn:dIn}), fixedN*2*Math.PI);
    dia.push(dIn); thr.push(+(aero.ctEff*aero.rho*fixedN*fixedN*Math.pow(Dm,4)).toFixed(3)); }
  return { type:"line", data:{ labels:dia, datasets:[
    { label:"Thrust @ "+Math.round(fixedRpm).toLocaleString()+" RPM (T ∝ D⁴)", data:thr, borderColor:C_COL.blue, backgroundColor:C_COL.blue+"1f", borderWidth:2, pointRadius:0, tension:.3, fill:true },
    { label:"Current propeller ("+p.diaIn+'")', data:dia.map(d=>Math.abs(d-p.diaIn)<0.26 ? +(c.Tmax/4).toFixed(3) : null),
      borderColor:C_COL.orange, backgroundColor:C_COL.orange, pointRadius:6, showLine:false } ] },
    options: baseXY("Propeller diameter (in)", {y:"Thrust per rotor (N)"}) };
}
function cfgFlightTelemetry(){
  if(lastRun.metric==="alt" && lastRun.data.length>1)
    return telemetryConfig("alt", lastRun.data, lastRun.data2, lastRun.flightT, {mini:false});
  return null;
}
/* tachometer — free-spin vs loaded RPM at hover (or 85% fallback) throttle */
function tachoData(){
  const c = calc(), p = c.p, d = c.tw>1 ? c.hoverD : 0.85, op = solveBench(d,1,25);
  const free = p.kv*op.V*d, loaded = op.rpm, lost = Math.max(0, free-loaded), scale = Math.max(free*1.15, 100);
  return { d, free, loaded, lost, scale, lossPct: free>0 ? lost/free*100 : 0 };
}
function cfgTacho(){
  const t = tachoData();
  return { type:"doughnut",
    data:{ labels:["Loaded RPM","Lost to winding I²R","Reserve to free-spin"],
      datasets:[{ data:[Math.round(t.loaded), Math.round(t.lost), Math.max(Math.round(t.scale-t.loaded-t.lost),0)],
        backgroundColor:[C_COL.blue, C_COL.red, "#d7e0dc"], borderWidth:0, circumference:240, rotation:-120 }] },
    options:{ responsive:true, maintainAspectRatio:false, cutout:"72%",
      plugins:{ legend:{position:"bottom"}, tooltip:{ callbacks:{ label:cx=>" "+cx.label+": "+Math.round(cx.raw).toLocaleString()+" rpm" } } } },
    plugins:[ centerText(Math.round(t.loaded).toLocaleString(), "LOADED RPM") ] };
}
/* circuit + Sankey stay as lightweight DOM (not plots) */
function benchOp(){ const c = calc(), d = c.tw>1 ? c.hoverD : 0.85; return { d, op:solveBench(d,1,25) }; }
function renderCircuitDOM(host){
  const { d, op } = benchOp();
  const vApp = d*op.V, drop = op.I*op.Rm, vbemf = Math.max(vApp-drop, 0);
  host.innerHTML =
    '<div class="circuit-flow">'+
      '<div class="cbox"><span class="ck">SOURCE</span><span class="cv" style="color:'+C_COL.blue+'">'+vApp.toFixed(1)+' V</span></div>'+
      '<span class="cop">−</span>'+
      '<div class="cbox"><span class="ck">WINDING DROP I·Rm (heat)</span><span class="cv" style="color:'+C_COL.red+'">'+drop.toFixed(2)+' V</span></div>'+
      '<span class="cop">=</span>'+
      '<div class="cbox"><span class="ck">V_BEMF (mechanical work)</span><span class="cv" style="color:'+C_COL.green+'">'+vbemf.toFixed(1)+' V</span></div>'+
    '</div><p class="chart-footnote">At '+Math.round(d*100)+'% throttle · I = '+op.I.toFixed(1)+' A · Rm = '+op.Rm.toFixed(3)+' Ω (winding drop is dissipated as heat).</p>';
}
function renderSankeyDOM(host){
  const { d, op } = benchOp();
  const pElec = Math.max(op.P, 0.001), pMech = Math.max(op.Pmech, 0), pLoss = Math.max(pElec-pMech, 0);
  const mechPct = Math.min(pMech/pElec*100, 100), lossPct = Math.min(pLoss/pElec*100, 100);
  host.innerHTML =
    '<div class="sankey"><div class="srow"><span>Electrical in</span><b>'+pElec.toFixed(1)+' W</b></div>'+
      '<div class="srow"><span>Mechanical (thrust)</span><div class="sbar"><i style="width:'+mechPct.toFixed(0)+'%;background:'+C_COL.green+'"></i></div><b>'+pMech.toFixed(1)+' W</b></div>'+
      '<div class="srow"><span>Copper loss I²R</span><div class="sbar"><i style="width:'+lossPct.toFixed(0)+'%;background:'+C_COL.red+'"></i></div><b>'+pLoss.toFixed(1)+' W</b></div>'+
    '</div><p class="chart-footnote">At '+Math.round(d*100)+'% throttle · motor efficiency '+(pMech/pElec*100).toFixed(0)+'%.</p>';
}
/* ── nav analysis-chart builders (each returns a Chart.js config, computed live) ── */
function cfgDopBars(){
  const nc = navCalc();
  const vals = nc.dop.ok ? [nc.dop.hdop, nc.dop.vdop, nc.dop.pdop, nc.dop.gdop] : [0,0,0,0];
  return { type:"bar", data:{ labels:["HDOP","VDOP","PDOP","GDOP"],
      datasets:[{ label: nc.dop.ok ? "Dilution of precision" : "No fix (singular geometry)",
        data: vals.map(v=>+v.toFixed(2)),
        backgroundColor:[C_COL.blue, C_COL.green, C_COL.orange, C_COL.slate], borderWidth:0 }] },
    options: Object.assign(baseXY("Metric", {y:"Value"}), { plugins:{ legend:{display:false}, tooltip:{} } }) };
}
function cfgSkyPolar(){
  const nc = navCalc();
  const pts = nc.sats.map(s=>({ x:+(s.az*R2D).toFixed(1), y:+(90-s.el*R2D).toFixed(1) }));
  return { type:"scatter", data:{ datasets:[{ label:"Satellites (az °, 90−el °)",
    data:pts, borderColor:C_COL.green, backgroundColor:C_COL.green, pointRadius:5 }] },
    options: baseXY("Azimuth (°)", {y:"Zenith distance (°)"}) };
}
function cfgBaroErrAlt(){
  const alt=[], err=[], sens=[];
  for(let h=0; h<=3000; h+=100){
    const be = baroError(h, state.baroGrade, { inversion:state.inversion });
    alt.push(h); err.push(+be.total.toFixed(2)); sens.push(+dhdP(pressureAt(h)).toFixed(4));
  }
  return { type:"line", data:{ labels:alt, datasets:[
    { label:"Altitude error (m)", data:err, borderColor:C_COL.green, backgroundColor:C_COL.green+"1f",
      borderWidth:2, pointRadius:0, tension:.3, fill:true, yAxisID:"y" },
    { label:"dh/dP sensitivity (m/Pa)", data:sens, borderColor:C_COL.slate, borderWidth:2, pointRadius:0,
      tension:.3, borderDash:[5,4], yAxisID:"y1" } ] },
    options: baseXY("True altitude (m)", {y:"Altitude error (m)", y1:"dh/dP (m/Pa)"}) };
}
function cfgErrorBudget(){
  const nc = navCalc();
  const cep2 = isFinite(nc.cep) ? nc.cep*nc.cep : 0, h2 = nc.hErr*nc.hErr;
  const total = isFinite(nc.total) ? nc.total : Math.sqrt(cep2+h2);
  return { type:"doughnut",
    data:{ labels:["Horizontal (CEP²)","Vertical (h_err²)"],
      datasets:[{ data:[+cep2.toFixed(2), +h2.toFixed(2)],
        backgroundColor:[C_COL.blue, C_COL.orange], borderWidth:0, hoverOffset:6 }] },
    options:{ responsive:true, maintainAspectRatio:false, cutout:"62%",
      plugins:{ legend:{position:"bottom"},
        tooltip:{ callbacks:{ label:cx=>" "+cx.label+": "+cx.raw.toFixed(1)+" m²" } } } },
    plugins:[ centerText(total.toFixed(1)+" m", "3D RADIUS") ] };
}
function cfgNavRunTelemetry(){
  if(lastRun.data.length>1 && TEL_SERIES[lastRun.metric])
    return telemetryConfig(lastRun.metric, lastRun.data, lastRun.data2, 0, {mini:false});
  return null;
}

/* ── NAVIGATION analysis suite ────────────────────────────────────────────────
   Every chart below re-solves the real model (dopSolve / baroError / ISA) for a
   swept input, so they stay honest against whatever the student has configured
   rather than replaying the run buffer. Sample counts are kept small — the
   gallery instantiates all of them at once. */
const NAV_PRESETS = ["spread","clustered","wall","line"];
/* a fresh Rayleigh sample set for the CURRENT cep (median radius = CEP) */
function fixSamples(n, cep){
  const sigma = (isFinite(cep) ? cep : 60)/1.1774, out = [];
  for(let i=0;i<n;i++){
    const r = sigma*Math.sqrt(-2*Math.log(Math.max(Math.random(), 1e-6)));
    const th = Math.random()*Math.PI*2;
    out.push({ r, x:r*Math.cos(th), y:r*Math.sin(th) });
  }
  return out;
}
/* HDOP + CEP as satellites are added to the current sky pattern */
function cfgDopVsSats(){
  const labels=[], hd=[], cp=[];
  for(let n=4;n<=12;n++){
    const d = dopSolve(makePreset(state.skyPreset, n));
    labels.push(n);
    hd.push(d.ok ? +d.hdop.toFixed(2) : null);
    cp.push(d.ok ? +cepFromHdop(d.hdop, navCalc().uere).toFixed(2) : null);
  }
  // log axes: a 4-satellite solve can be two orders of magnitude worse than an
  // 8-satellite one, which flattens the interesting part of a linear plot
  const o = baseXY("Satellites in view ("+state.skyPreset+" pattern)", {y:"HDOP (log)", y1:"CEP m (log)"});
  o.scales.y.type = "logarithmic"; o.scales.y.beginAtZero = false;
  o.scales.y1.type = "logarithmic"; o.scales.y1.beginAtZero = false;
  return { type:"line", data:{ labels, datasets:[
    { label:"HDOP", data:hd, borderColor:C_COL.blue, backgroundColor:C_COL.blue+"1f",
      borderWidth:2, pointRadius:3, tension:.25, fill:true, yAxisID:"y" },
    { label:"CEP (m)", data:cp, borderColor:C_COL.orange, borderWidth:2, pointRadius:3,
      tension:.25, borderDash:[5,4], yAxisID:"y1" } ] },
    options: o };
}
/* the four sky patterns side by side — why "more satellites" isn't the answer */
function cfgPresetCompare(){
  const n = state.satCount, uere = navCalc().uere;
  const rows = NAV_PRESETS.map(p=>{ const d = dopSolve(makePreset(p, n)); return { p, d }; });
  const v = x => +x.toFixed(2);
  // clustered/line geometries run into the hundreds — log keeps Spread visible
  const o = baseXY("Sky pattern · "+n+" satellites", {y:"Value (log scale)"});
  // min below 1 so a good HDOP (~1) still draws a visible bar off the axis floor
  o.scales.y.type = "logarithmic"; o.scales.y.beginAtZero = false; o.scales.y.min = 0.3;
  return { type:"bar", data:{ labels:NAV_PRESETS.map(p=>p[0].toUpperCase()+p.slice(1)), datasets:[
    { label:"HDOP", data:rows.map(r=>r.d.ok?v(r.d.hdop):null), backgroundColor:C_COL.blue, borderWidth:0 },
    { label:"VDOP", data:rows.map(r=>r.d.ok?v(r.d.vdop):null), backgroundColor:C_COL.green, borderWidth:0 },
    { label:"CEP (m)", data:rows.map(r=>r.d.ok?v(cepFromHdop(r.d.hdop,uere)):null),
      backgroundColor:C_COL.orange, borderWidth:0 } ] },
    options: o };
}
/* current geometry against an ideal spread constellation, all four DOP axes */
function cfgDopRadar(){
  const nc = navCalc(), ideal = dopSolve(makePreset("spread", 10));
  const cap = v => +Math.min(v, 12).toFixed(2);
  const cur = nc.dop.ok ? [nc.dop.hdop, nc.dop.vdop, nc.dop.pdop, nc.dop.gdop].map(cap) : [12,12,12,12];
  const ref = [ideal.hdop, ideal.vdop, ideal.pdop, ideal.gdop].map(cap);
  return { type:"radar", data:{ labels:["HDOP","VDOP","PDOP","GDOP"], datasets:[
    { label:"This constellation", data:cur, borderColor:C_COL.orange,
      backgroundColor:C_COL.orange+"33", borderWidth:2, pointRadius:3 },
    { label:"Ideal spread ×10", data:ref, borderColor:C_COL.green,
      backgroundColor:C_COL.green+"22", borderWidth:2, pointRadius:3, borderDash:[5,4] } ] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{position:"bottom"} },
      scales:{ r:{ beginAtZero:true, suggestedMax:6, grid:{color:C_COL.grid},
                   pointLabels:{ font:{ family:"'IBM Plex Mono'" } } } } } };
}
/* sky coverage by compass octant — an empty wedge is exactly what wrecks HDOP */
function cfgSkyCoverage(){
  const names = ["N","NE","E","SE","S","SW","W","NW"], bins = new Array(8).fill(0);
  (navCalc().sats).forEach(s=>{
    let a = (s.az*R2D) % 360; if(a<0) a += 360;
    bins[Math.floor(((a+22.5)%360)/45)]++;
  });
  return { type:"polarArea", data:{ labels:names,
    datasets:[{ data:bins, backgroundColor:MASS_PALETTE.slice(0,8).map(c=>c+"cc"), borderWidth:0 }] },
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{position:"right"},
        tooltip:{ callbacks:{ label:cx=>" "+cx.label+": "+cx.raw+" satellite"+(cx.raw===1?"":"s") } } },
      scales:{ r:{ beginAtZero:true, ticks:{ stepSize:1, precision:0 }, grid:{color:C_COL.grid} } } } };
}
/* per-satellite elevation — low sats help horizontal geometry, high sats don't */
function cfgSatElevation(){
  const sats = navCalc().sats.map((s,i)=>({ i:i+1, el:+(s.el*R2D).toFixed(1) }));
  const col = e => e<25 ? C_COL.green : e<60 ? C_COL.slate : C_COL.orange;
  return { type:"bar", data:{ labels:sats.map(s=>"SV"+s.i),
    datasets:[{ label:"Elevation (°)", data:sats.map(s=>s.el),
      backgroundColor:sats.map(s=>col(s.el)), borderWidth:0 }] },
    options: Object.assign(baseXY("Satellite", {y:"Elevation (°)"}),
      { plugins:{ legend:{display:false},
        tooltip:{ callbacks:{ label:cx=>" "+cx.raw.toFixed(1)+"° — "+
          (cx.raw<25?"low (good for HDOP)":cx.raw<60?"mid":"high (feeds VDOP)") } } } }) };
}
/* the fix cloud itself: 200 draws in the local East/North plane + the CEP ring */
function cfgFixScatter(){
  const nc = navCalc();
  const pts = fixSamples(200, nc.cep).map(p=>({ x:+p.x.toFixed(2), y:+p.y.toFixed(2) }));
  const cep = isFinite(nc.cep) ? nc.cep : 60, ring=[], r95=[];
  for(let i=0;i<=72;i++){
    const a = i/72*Math.PI*2;
    ring.push({ x:+(Math.cos(a)*cep).toFixed(2), y:+(Math.sin(a)*cep).toFixed(2) });
    r95.push({ x:+(Math.cos(a)*cep*2.079).toFixed(2), y:+(Math.sin(a)*cep*2.079).toFixed(2) });
  }
  return { type:"scatter", data:{ datasets:[
    { label:"GPS fixes", data:pts, backgroundColor:C_COL.slate+"aa", pointRadius:2.5 },
    { label:"CEP (50 %)", data:ring, borderColor:C_COL.orange, borderWidth:2,
      pointRadius:0, showLine:true, fill:false },
    { label:"R95 (95 %)", data:r95, borderColor:C_COL.red, borderWidth:1.5, borderDash:[5,4],
      pointRadius:0, showLine:true, fill:false } ] },
    // square canvas + identical symmetric ranges, otherwise the CEP "circle"
    // renders as an ellipse and the 50 % ring stops meaning what it says
    options: Object.assign(baseXY("East error (m)", {y:"North error (m)"}),
      { maintainAspectRatio:true, aspectRatio:1,
        scales:{ x:{ title:{display:true,text:"East error (m)"}, grid:{color:C_COL.grid},
                     min:-cep*2.6, max:cep*2.6 },
                 y:{ title:{display:true,text:"North error (m)"}, grid:{color:C_COL.grid},
                     min:-cep*2.6, max:cep*2.6 } } }) };
}
/* radial-error histogram — the Rayleigh shape the CEP definition rests on */
function cfgFixHistogram(){
  const nc = navCalc();
  const src = (lastRun.metric==="hdopcep" && lastRun.data.length>8)
    ? lastRun.data.slice() : fixSamples(400, nc.cep).map(p=>p.r);
  const max = Math.max.apply(null, src) || 1, BINS = 14, w = max/BINS;
  const counts = new Array(BINS).fill(0);
  src.forEach(r=>{ counts[Math.min(BINS-1, Math.floor(r/w))]++; });
  const cep = isFinite(nc.cep) ? nc.cep : 60;
  return { type:"bar", data:{ labels:counts.map((_,i)=>((i+0.5)*w).toFixed(1)),
    datasets:[{ label:"Fixes in bin ("+src.length+" samples)", data:counts,
      backgroundColor:counts.map((_,i)=> (i+0.5)*w <= cep ? C_COL.blue : C_COL.slate+"aa"),
      borderWidth:0 }] },
    options: Object.assign(baseXY("Radial error (m) — shaded ≤ CEP "+cep.toFixed(1)+" m", {y:"Count"}),
      { plugins:{ legend:{position:"bottom"} } }) };
}
/* cumulative distribution with the 50 % / 95 % guides marked */
function cfgFixCdf(){
  const nc = navCalc();
  const cep = isFinite(nc.cep) ? nc.cep : 60;
  const rows = fixSamples(500, cep).map(p=>p.r).sort((a,b)=>a-b);
  const pts = [], step = Math.ceil(rows.length/60);
  for(let i=0;i<rows.length;i+=step) pts.push({ x:+rows[i].toFixed(2), y:+((i+1)/rows.length*100).toFixed(1) });
  const g = pct => [{x:0,y:pct},{x:+(cep*(pct===50?1:2.079)).toFixed(2),y:pct}];
  return { type:"scatter", data:{ datasets:[
    { label:"Empirical CDF", data:pts, borderColor:C_COL.blue, borderWidth:2, pointRadius:0,
      showLine:true, tension:.2, fill:false },
    { label:"50 % → CEP "+cep.toFixed(1)+" m", data:g(50), borderColor:C_COL.orange,
      borderWidth:1.5, borderDash:[5,4], pointRadius:0, showLine:true, fill:false },
    { label:"95 % → R95 "+(cep*2.079).toFixed(1)+" m", data:g(95), borderColor:C_COL.red,
      borderWidth:1.5, borderDash:[5,4], pointRadius:0, showLine:true, fill:false } ] },
    options: baseXY("Radial error (m)", {y:"Fixes within radius (%)"}) };
}
/* CEP is linear in ranging error — both scenarios marked on the same line */
function cfgCepVsUere(){
  const nc = navCalc();
  const hdop = nc.dop.ok ? nc.dop.hdop : 12;
  const pts = [], marks = [];
  for(let u=1; u<=12; u+=0.5) pts.push({ x:u, y:+(hdop*u).toFixed(2) });
  [["Open-sky", NAV.uere.nominal], ["Urban", NAV.uere.urban]].forEach(([n,u])=>
    marks.push({ x:u, y:+(hdop*u).toFixed(2), n }));
  return { type:"scatter", data:{ datasets:[
    { label:"CEP = HDOP × UERE  (HDOP "+hdop.toFixed(2)+")", data:pts, borderColor:C_COL.blue,
      borderWidth:2, pointRadius:0, showLine:true, fill:false },
    { label:"Scenario points", data:marks, backgroundColor:C_COL.orange, pointRadius:6 } ] },
    options: Object.assign(baseXY("UERE (m)", {y:"CEP (m)"}),
      { plugins:{ legend:{position:"bottom"},
        tooltip:{ callbacks:{ label:cx=>" "+(cx.raw.n?cx.raw.n+": ":"")+"UERE "+cx.raw.x+" m → CEP "+cx.raw.y+" m" } } } }) };
}
/* the ISA lookup the altimeter inverts, with its shrinking pressure gradient */
function cfgIsaPressure(){
  const h=[], P=[], sens=[];
  for(let a=0;a<=3000;a+=100){
    h.push(a); P.push(+(pressureAt(a)/100).toFixed(1)); sens.push(+(dhdP(pressureAt(a))*100).toFixed(2));
  }
  return { type:"line", data:{ labels:h, datasets:[
    { label:"ISA pressure (hPa)", data:P, borderColor:C_COL.blue, backgroundColor:C_COL.blue+"1f",
      borderWidth:2, pointRadius:0, tension:.3, fill:true, yAxisID:"y" },
    { label:"Sensitivity dh/dP (m/hPa)", data:sens, borderColor:C_COL.orange, borderWidth:2,
      pointRadius:0, tension:.3, borderDash:[5,4], yAxisID:"y1" } ] },
    options: Object.assign(baseXY("True altitude (m)", {y:"Pressure (hPa)", y1:"m per hPa"}),
      { scales:{ x:{ title:{display:true,text:"True altitude (m)"}, grid:{color:C_COL.grid} },
                 y:{ title:{display:true,text:"Pressure (hPa)"}, grid:{color:C_COL.grid} },
                 y1:{ position:"right", title:{display:true,text:"m per hPa"},
                      grid:{drawOnChartArea:false}, beginAtZero:true } } }) };
}
/* both sensor grades, plus what a temperature inversion adds on top */
function cfgBaroGradeCompare(){
  const h=[], fine=[], coarse=[], inv=[];
  for(let a=0;a<=3000;a+=150){
    h.push(a);
    fine.push(+baroError(a,"fine",{}).total.toFixed(2));
    coarse.push(+baroError(a,"coarse",{}).total.toFixed(2));
    inv.push(+baroError(a, state.baroGrade, {inversion:true}).total.toFixed(2));
  }
  return { type:"line", data:{ labels:h, datasets:[
    { label:"MS5611 (fine)", data:fine, borderColor:C_COL.green, borderWidth:2, pointRadius:0, tension:.3 },
    { label:"BMP180 (coarse)", data:coarse, borderColor:C_COL.orange, borderWidth:2, pointRadius:0, tension:.3 },
    { label:"+ temperature inversion", data:inv, borderColor:C_COL.red, borderWidth:2, pointRadius:0,
      tension:.3, borderDash:[5,4] } ] },
    options: baseXY("True altitude (m)", {y:"Altitude error (m)"}) };
}
/* where the 3-D budget crosses over from GPS-dominated to baro-dominated */
function cfgErrVsAltitude(){
  const nc = navCalc();
  const cep = isFinite(nc.cep) ? nc.cep : 60;
  const h=[], horiz=[], vert=[], tot=[];
  for(let a=0;a<=3000;a+=150){
    const be = baroError(a, state.baroGrade, { inversion:state.inversion });
    h.push(a); horiz.push(+cep.toFixed(2)); vert.push(+be.total.toFixed(2));
    tot.push(+nav3dRadius(cep, be.total).toFixed(2));
  }
  return { type:"line", data:{ labels:h, datasets:[
    { label:"3-D radius √(CEP²+h²)", data:tot, borderColor:C_COL.blue, backgroundColor:C_COL.blue+"1f",
      borderWidth:2.5, pointRadius:0, tension:.3, fill:true },
    { label:"Horizontal CEP", data:horiz, borderColor:C_COL.orange, borderWidth:2, pointRadius:0, borderDash:[6,4] },
    { label:"Vertical baro error", data:vert, borderColor:C_COL.green, borderWidth:2, pointRadius:0, tension:.3 },
    { label:"5 m safety limit", data:h.map(()=>5), borderColor:C_COL.red, borderWidth:1.5,
      pointRadius:0, borderDash:[3,3] } ] },
    options: baseXY("True altitude (m)", {y:"Error (m)"}) };
}
/* variance split, stacked, across the sky patterns — one bar per constellation */
function cfgBudgetStack(){
  const uere = navCalc().uere;
  const hErr = baroError(state.altitude, state.baroGrade, { inversion:state.inversion }).total;
  const rows = NAV_PRESETS.map(p=>{
    const d = dopSolve(makePreset(p, state.satCount));
    const cep = d.ok ? Math.min(cepFromHdop(d.hdop, uere), 40) : 40;
    return { p, cep2:+(cep*cep).toFixed(1) };
  });
  const st = { stacked:true, grid:{color:C_COL.grid} };
  return { type:"bar", data:{ labels:NAV_PRESETS.map(p=>p[0].toUpperCase()+p.slice(1)), datasets:[
    { label:"Horizontal CEP² (m²)", data:rows.map(r=>r.cep2), backgroundColor:C_COL.blue, borderWidth:0 },
    { label:"Vertical h_err² (m²)", data:rows.map(()=>+(hErr*hErr).toFixed(1)),
      backgroundColor:C_COL.orange, borderWidth:0 } ] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{position:"bottom"} },
      scales:{ x:Object.assign({ title:{display:true,text:"Sky pattern · variance contribution"} }, st),
               y:Object.assign({ title:{display:true,text:"Error² (m²)"}, beginAtZero:true }, st) } } };
}
/* two-input sweep: satellite count × ranging environment, bubble area ∝ CEP */
function cfgCepBubble(){
  const sets = [["nominal", NAV.uere.nominal, C_COL.green], ["urban", NAV.uere.urban, C_COL.red]];
  return { type:"bubble", data:{ datasets: sets.map(([name,u,col])=>({
      label:"UERE "+u.toFixed(1)+" m ("+name+")",
      data:(()=>{ const out=[];
        for(let n=4;n<=12;n++){
          const d = dopSolve(makePreset(state.skyPreset, n));
          if(!d.ok) continue;
          const cep = Math.min(cepFromHdop(d.hdop, u), 40);
          out.push({ x:n, y:+cep.toFixed(2), r: Math.max(3, Math.min(26, 3+cep*1.4)) });
        }
        return out; })(),
      backgroundColor:col+"66", borderColor:col, borderWidth:1.5 })) },
    options: Object.assign(baseXY("Satellites in view", {y:"CEP (m)"}),
      { plugins:{ legend:{position:"bottom"},
        tooltip:{ callbacks:{ label:cx=>" "+cx.dataset.label+" · "+cx.raw.x+" sats → CEP "+cx.raw.y+" m" } } } }) };
}
/* ── output registries ──────────────────────────────────────────────────────
   Two panels, split by what the plot IS, not by what it shows: anything drawn
   as a curve against a swept axis belongs to the Graphs card (`graph:true`);
   the distributions, bars, radars and clouds stay in Charts. chartDefs() and
   graphDefs() are both filtered views of this one list. */
function navPlotDefs(){
  return [
    // ── geometry ──
    { id:"dop",     title:"Dilution of precision (HDOP/VDOP/PDOP/GDOP)", cfg:cfgDopBars },
    { id:"doprad",  title:"DOP profile vs an ideal constellation",       cfg:cfgDopRadar },
    { id:"skypol",  title:"Satellite sky-plot (az / zenith)",            cfg:cfgSkyPolar },
    { id:"skycov",  title:"Sky coverage by compass octant",              cfg:cfgSkyCoverage },
    { id:"satel",   title:"Satellite elevation profile",                 cfg:cfgSatElevation },
    { id:"dopsats", title:"HDOP & CEP vs satellite count",               cfg:cfgDopVsSats, graph:true },
    { id:"preset",  title:"Sky pattern comparison (HDOP / VDOP / CEP)",  cfg:cfgPresetCompare },
    // ── horizontal accuracy ──
    { id:"fixsc",   title:"GPS fix cloud with CEP / R95 rings",          cfg:cfgFixScatter },
    { id:"fixhist", title:"Radial-error histogram (Rayleigh)",           cfg:cfgFixHistogram },
    { id:"fixcdf",  title:"Cumulative error distribution (50 % / 95 %)", cfg:cfgFixCdf, graph:true },
    { id:"cepuere", title:"CEP vs ranging error (UERE)",                 cfg:cfgCepVsUere, graph:true },
    { id:"cepbub",  title:"CEP vs satellites × ranging environment",     cfg:cfgCepBubble },
    // ── barometric altimetry ──
    { id:"isaP",    title:"ISA pressure & dh/dP sensitivity",            cfg:cfgIsaPressure, graph:true },
    { id:"baroalt", title:"Altitude error vs true altitude (ISA sweep)", cfg:cfgBaroErrAlt, graph:true },
    { id:"barogr",  title:"Sensor grade & inversion comparison",         cfg:cfgBaroGradeCompare, graph:true },
    // ── synthesis ──
    { id:"budget",  title:"3-D error budget",                            cfg:cfgErrorBudget },
    { id:"budstk",  title:"Variance split across sky patterns",          cfg:cfgBudgetStack },
    { id:"erralt",  title:"3-D error vs altitude (GPS ↔ baro crossover)", cfg:cfgErrVsAltitude, graph:true }
  ];
}
/* every line plot, live run first — drives the Graphs card gallery */
function graphDefs(){
  const live = { id:"navrun", title:"Last run telemetry", cfg:cfgNavRunTelemetry,
                 empty:"Run this experiment to record telemetry.", graph:true };
  if(!isNavScene()) return [ { id:"flightrun", title:"Active flight telemetry", cfg:cfgFlightTelemetry,
                               empty:"Run Module 3 · Hover / Flight to record telemetry.", graph:true } ];
  return [live].concat(navPlotDefs().filter(d=>d.graph));
}
/* registry of every analysis chart — drives both the gallery and single-chart view */
function chartDefs(){
  if(isNavScene()) return navPlotDefs().filter(d=>!d.graph);
  return [
    { id:"mass",   title:"Mass distribution",                 cfg:()=>massChartConfig(false) },
    { id:"tc",     title:"Thrust & current vs throttle",      cfg:cfgThrustCurrent },
    { id:"eff",    title:"Motor & thrust efficiency",         cfg:cfgEfficiency },
    { id:"tacho",  title:"Virtual tachometer",                cfg:cfgTacho, note:()=>{ const t=tachoData(); return "free "+Math.round(t.free).toLocaleString()+" · loaded "+Math.round(t.loaded).toLocaleString()+" · loss "+Math.round(t.lost).toLocaleString()+" rpm ("+t.lossPct.toFixed(1)+"%) @ "+Math.round(t.d*100)+"% throttle"; } },
    { id:"circ",   title:"Equivalent-circuit voltage split",  dom:renderCircuitDOM },
    { id:"sank",   title:"Power flow · P_elec to P_mech + loss", dom:renderSankeyDOM },
    { id:"tvi",    title:"Thrust vs current",                 cfg:cfgThrustVsCurrent },
    { id:"therm",  title:"Predicted temperature @ 85% throttle", cfg:cfgThermal },
    { id:"geom",   title:"Thrust curve vs rotor geometry",    cfg:cfgThrustGeom },
    { id:"flight", title:"Active flight telemetry",           cfg:cfgFlightTelemetry, empty:"Run Module 3 · Hover / Flight to record telemetry." }
  ];
}
/* single-chart floating detail — reached by clicking any chart's expand button.
   `backTo` decides which gallery the ‹ back button returns to. */
function openSingleChart(def, backTo){
  const graph = backTo === "graphs";
  const body = openModal(txt(def.title)+' <em>· detail</em>', graph ? "#4f6d9e" : "#c65d3b",
    '<button type="button" class="modal-back" id="chartBack">‹ all '+(graph?"graphs":"charts")+'</button>');
  const wrap = el("div"); wrap.style.cssText = "height:62vh;min-height:340px;position:relative";
  if(def.dom){ wrap.style.height="auto"; def.dom(wrap); }
  else{ wrap.innerHTML = '<canvas id="gc_single"></canvas>'; }
  body.appendChild(wrap);
  if(def.cfg){ const c = def.cfg(); if(c) ChartHub.put("gc_single", c);
    else wrap.innerHTML = '<div class="runs-empty">'+txt(def.empty||"No data yet.")+'</div>'; }
  if(def.note) body.appendChild(el("p","chart-footnote", txt(def.note())));
  const back = $("chartBack");
  if(back) back.addEventListener("click", graph ? openGraphDetail : openChartsDetail);
}
/* shared gallery body: one block per def, each with its own expand button */
function renderPlotGallery(wrap, defs, backTo){
  const pending = [];                              // instantiated AFTER wrap is in the DOM
  defs.forEach(def=>{
    const block = el("div","calc-block gchart");
    const head = el("div","gchart-head");
    head.innerHTML = '<h3>'+txt(def.title)+'</h3><button type="button" class="gchart-expand" title="Expand">⤢</button>';
    head.querySelector("button").addEventListener("click", ()=>openSingleChart(def, backTo));
    block.appendChild(head);
    if(def.dom){
      const host = el("div"); def.dom(host); block.appendChild(host);
    }else{
      const cfg = def.cfg();
      if(cfg){ const box = el("div","chart-box-lg");
        box.innerHTML = '<canvas id="gc_'+def.id+'"></canvas>'; block.appendChild(box);
        pending.push({ id:"gc_"+def.id, cfg }); }
      else block.appendChild(el("div","runs-empty", txt(def.empty||"No data yet.")));
    }
    if(def.note) block.appendChild(el("p","chart-footnote", txt(def.note())));
    wrap.appendChild(block);
  });
  return pending;
}
/* Graphs gallery — the live run plus every swept LINE plot, reached by clicking
   the Graphs card. Same block layout as the Charts gallery; the two panels split
   the plot registry between them (see navPlotDefs). */
function openGraphDetail(){
  ChartHub.killPrefix("gc_");
  const { mod, exp } = currentExp();
  const body = openModal('Graphs <em>· live run + parameter sweeps</em>', "#4f6d9e");
  const wrap = el("div","calc-blocks");
  const defs = graphDefs();

  // the live run gets a full-width plot at the top, or a prompt when empty
  const key = mod.id+":"+exp.id;
  let data, data2, flightT;
  if(simActive && sim.data.length>1){ data=sim.data; data2=sim.data2; flightT=sim.flightT||0; }
  else if(lastRun.key===key && lastRun.data.length>1){ data=lastRun.data; data2=lastRun.data2; flightT=lastRun.flightT; }
  const live = el("div","calc-block gchart");
  live.innerHTML = '<div class="gchart-head"><h3>Live run · '+txt(exp.name)+'</h3></div>';
  if(data){
    const box = el("div","chart-box-lg");
    box.innerHTML = '<canvas id="gc_live"></canvas>'; live.appendChild(box);
  }else{
    live.appendChild(el("div","runs-empty",
      "No data yet for <b>"+txt(exp.name)+"</b>.<br>Press <b>▶ Run Sim</b> to plot this experiment."));
  }
  wrap.appendChild(live);

  const pending = renderPlotGallery(wrap, defs.filter(d=>d.id!=="navrun" && d.id!=="flightrun"), "graphs");
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
/* ── SKY-PLOT EDITOR ──
   A polar az/el plot: elevation 90° at the centre, the horizon (0°) at the rim;
   azimuth 0° (north) up, increasing clockwise. Each satellite is a draggable dot;
   dragging recomputes HDOP/VDOP/PDOP live and (if the sky-plot scene is showing)
   updates the constellation in the 3-D viewport in real time. */
function skyToXY(az, el, cx, cy, R){
  const r = (1 - Math.max(0,Math.min(1, el/(Math.PI/2)))) * R;
  return { x: cx + r*Math.sin(az), y: cy - r*Math.cos(az) };
}
function xyToSky(x, y, cx, cy, R){
  const dx = x-cx, dy = y-cy, r = Math.min(Math.hypot(dx,dy), R);
  const el = (1 - r/R) * (Math.PI/2);
  let az = Math.atan2(dx, -dy); if(az < 0) az += 2*Math.PI;
  return { az, el };
}
function openSkyEditor(){
  const body = openModal('Sky-plot Editor <em>· drag satellites · HDOP updates live</em>', "#1f3a93",
    'elevation 90° at centre · horizon at rim · azimuth 0° (N) up, clockwise · drag any dot');
  const wrap = el("div","sky-editor");
  wrap.innerHTML =
    '<div class="sky-stage"><canvas id="skyCanvas" width="440" height="440"></canvas></div>'+
    '<div class="sky-side">'+
      '<div class="sky-readout mono" id="skyReadout"></div>'+
      '<div class="sky-presetrow" id="skyPresetRow">'+
        SKY_PRESETS.map(p=>'<button type="button" data-preset="'+p.id+'"'+(state.skyPreset===p.id?' class="active"':'')+'>'+p.label+'</button>').join("")+
      '</div>'+
      '<div class="sky-countrow"><span>Satellites</span>'+
        '<input type="range" id="skyCount" min="4" max="12" step="1" value="'+state.satCount+'">'+
        '<b class="mono" id="skyCountTxt">'+state.satCount+'</b></div>'+
      '<p class="sky-help">Good geometry = satellites spread wide across azimuth and elevation (low HDOP). '+
        'Clustered or high-in-the-sky arrangements raise HDOP/VDOP and blow up the CEP.</p>'+
    '</div>';
  body.appendChild(wrap);
  const cv = $("skyCanvas"), ctx = cv.getContext("2d");
  const W = cv.width, H = cv.height, cx = W/2, cy = H/2, R = W/2 - 24;
  let drag = -1;

  function draw(){
    ctx.clearRect(0,0,W,H);
    // sky disc
    ctx.save();
    ctx.fillStyle = "#f4f7fb"; ctx.beginPath(); ctx.arc(cx,cy,R,0,2*Math.PI); ctx.fill();
    // elevation rings 0/30/60
    ctx.strokeStyle = C_COL.grid; ctx.lineWidth = 1;
    [0,30,60].forEach(elDeg=>{
      const rr = (1 - elDeg/90)*R;
      ctx.beginPath(); ctx.arc(cx,cy,rr,0,2*Math.PI); ctx.stroke();
      ctx.fillStyle = "#a7b4c8"; ctx.font = "10px 'IBM Plex Mono'"; ctx.textAlign="center";
      if(elDeg>0) ctx.fillText(elDeg+"°", cx, cy-rr-3);
    });
    // azimuth spokes + labels
    ctx.strokeStyle = "#e7edf4";
    const dirs = [["N",0],["E",90],["S",180],["W",270]];
    for(let a=0;a<360;a+=30){
      const p = skyToXY(a*D2R, 0, cx, cy, R);
      ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(p.x,p.y); ctx.stroke();
    }
    ctx.fillStyle = "#7c8aa3"; ctx.font = "600 11px 'IBM Plex Sans'";
    dirs.forEach(([lab,a])=>{ const p = skyToXY(a*D2R, -0.06*(Math.PI/2), cx, cy, R+4);
      ctx.fillText(lab, p.x, p.y+4); });
    // line-of-sight rays + satellites
    const sats = state.sats;
    sats.forEach((s,i)=>{
      const p = skyToXY(s.az, s.el, cx, cy, R);
      ctx.strokeStyle = "rgba(31,58,147,.22)"; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(p.x,p.y); ctx.stroke();
      ctx.beginPath(); ctx.arc(p.x,p.y, i===drag?9:7, 0, 2*Math.PI);
      ctx.fillStyle = i===drag ? C_COL.orange : C_COL.blue; ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth=2; ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.font="700 8px 'IBM Plex Mono'"; ctx.textAlign="center";
      ctx.fillText(String(i+1), p.x, p.y+3);
    });
    // receiver at centre
    ctx.fillStyle = C_COL.green; ctx.beginPath(); ctx.arc(cx,cy,5,0,2*Math.PI); ctx.fill();
    ctx.restore();
    const dop = dopSolve(sats), uere = NAV.uere[state.uereScenario]||3;
    const cep = dop.ok ? cepFromHdop(dop.hdop,uere) : Infinity;
    const cls = v=> !dop.ok ? "warn" : v<2 ? "good" : v<4 ? "" : "warn";
    $("skyReadout").innerHTML =
      '<div class="sky-big '+cls(dop.hdop)+'">HDOP '+(dop.ok?dop.hdop.toFixed(2):"∞")+'</div>'+
      '<div class="sky-stat"><span>VDOP</span><b>'+(dop.ok?dop.vdop.toFixed(2):"∞")+'</b></div>'+
      '<div class="sky-stat"><span>PDOP</span><b>'+(dop.ok?dop.pdop.toFixed(2):"∞")+'</b></div>'+
      '<div class="sky-stat"><span>GDOP</span><b>'+(dop.ok?dop.gdop.toFixed(2):"∞")+'</b></div>'+
      '<div class="sky-stat"><span>CEP</span><b class="'+(isFinite(cep)&&cep<4?"good":"warn")+'">'+(isFinite(cep)?cep.toFixed(1)+" m":"∞")+'</b></div>'+
      '<div class="sky-stat"><span>Sats</span><b>'+sats.length+'</b></div>';
  }
  function pick(e){
    const rct = cv.getBoundingClientRect();
    const x = (e.clientX-rct.left)*(W/rct.width), y = (e.clientY-rct.top)*(H/rct.height);
    return { x, y };
  }
  cv.addEventListener("pointerdown", e=>{
    const {x,y} = pick(e);
    let best=-1, bd=1e9;
    state.sats.forEach((s,i)=>{ const p=skyToXY(s.az,s.el,cx,cy,R); const d=Math.hypot(p.x-x,p.y-y); if(d<bd){bd=d;best=i;} });
    if(bd<=16){ drag=best; cv.setPointerCapture(e.pointerId); draw(); }
  });
  cv.addEventListener("pointermove", e=>{
    if(drag<0) return;
    const {x,y} = pick(e);
    state.sats[drag] = xyToSky(x,y,cx,cy,R);
    // custom edit → detach from a named preset
    draw();
    // live-update the 3-D scene if the sky-plot is on screen
    if(typeof updateSkyplotSats === "function") updateSkyplotSats();
    if(!simActive) updateTelemetry(navTelemetry());
  });
  const endDrag = ()=>{ if(drag>=0){ drag=-1; state.skyPreset="custom"; saveState(); draw(); navChanged(false); } };
  cv.addEventListener("pointerup", endDrag);
  cv.addEventListener("pointercancel", endDrag);
  $("skyCount").addEventListener("input", e=>{
    state.satCount=+e.target.value; $("skyCountTxt").textContent=state.satCount;
    state.sats = makePreset(state.skyPreset==="custom"?"spread":state.skyPreset, state.satCount);
    draw(); navChanged(true);
  });
  wrap.querySelectorAll("#skyPresetRow button").forEach(b=>b.addEventListener("click", ()=>{
    state.skyPreset=b.dataset.preset; state.sats=makePreset(state.skyPreset,state.satCount);
    wrap.querySelectorAll("#skyPresetRow button").forEach(x=>x.classList.toggle("active",x===b));
    sfx("tick"); draw(); navChanged(true);
  }));
  draw();
}
/* rich charts modal — engineering curves computed live from spec.json, as a
   Chart.js gallery; each chart has an expand button for a single-chart detail. */
function openChartsDetail(){
  ChartHub.killPrefix("gc_");
  const body = openModal('Charts <em>· analysis · click any chart to expand</em>', "#c65d3b");
  const wrap = el("div","calc-blocks");
  const nav = isNavScene();

  // metric summary tiles
  const tiles = el("div","metric-tiles");
  const mt = (k,v,cls)=>'<div class="metric-tile"><span class="mk">'+k+'</span><span class="mv '+(cls||"")+'">'+v+'</span></div>';
  if(nav){
    const nc = navCalc();
    tiles.innerHTML =
      mt("HDOP", nc.dop.ok?nc.dop.hdop.toFixed(2):"∞", !nc.dop.ok?"warn":nc.dop.hdop<2?"good":nc.dop.hdop<4?"":"warn") +
      mt("Horizontal CEP", isFinite(nc.cep)?nc.cep.toFixed(1)+" m":"∞", isFinite(nc.cep)&&nc.cep<4?"good":"warn") +
      mt("Baro error", "±"+nc.hErr.toFixed(1)+" m", nc.hErr<3.5?"good":"warn") +
      mt("3-D error radius", isFinite(nc.total)?nc.total.toFixed(1)+" m":"∞", isFinite(nc.total)&&nc.total<5?"good":"warn") +
      mt("Satellites", String(nc.sats.length), "");
  }else{
    const c = calc(), geom = propGeometry();
    tiles.innerHTML =
      mt("Max thrust", c.Tmax.toFixed(1)+" N") +
      mt("T / W", c.tw.toFixed(2), c.tw>=1.8?"good":c.tw>=1.2?"":"warn") +
      mt("Hover throttle", c.tw>1?Math.round(c.hoverPct)+" %":"—", c.tw>1?"":"warn") +
      mt("Peak motor eff.", (motorEffPeak(c)*100).toFixed(0)+" %", "") +
      mt("Thrust eff.", c.gPerW.toFixed(1)+" g/W", c.gPerW>=6?"good":"") +
      mt("Prop clearance", geom.clearanceMm.toFixed(0)+" mm", geom.collide?"warn":"");
  }
  wrap.appendChild(tiles);

  // gallery — one block per chart def; Chart.js charts get a sized chart-box,
  // DOM charts (circuit/Sankey) render inline; every block has an expand button.
  // Line plots are NOT here — they live in the Graphs card (see graphDefs).
  const pending = renderPlotGallery(wrap, chartDefs(), "charts");
  if(isNavScene()) wrap.appendChild(el("p","chart-footnote",
    "Line plots — the parameter sweeps and the live run — are in the Graphs card."));
  body.appendChild(wrap);                          // attach first so the canvases exist…
  pending.forEach(pc=>ChartHub.put(pc.id, pc.cfg));// …then create the charts

  wrap.appendChild(el("p","calc-footnote", nav
    ? "Curves recompute live from the constellation, sensor grade and altitude inputs. HDOP/VDOP/PDOP/GDOP from the GᵀG pseudo-inverse; "+
      "CEP = HDOP × UERE; altitude error from the ISA lapse-rate model, resampled every 100 m; 3-D radius = √(CEP² + h_err²)."
    : "Curves recompute live from the spec.json physics of the selected components and the altitude slider. "+
      "Motor η = mechanical power (Q·ω) ÷ electrical power (V·I); thrust efficiency in grams-force per watt. "+
      "BEMT-lite propeller model: Ct/Cq corrected for pitch/diameter, Reynolds number and induced inflow. "+
      "Thermal: Cu I²R + convective cooling scaled by induced velocity (motor), Rds_on conduction loss with current-derating penalty (ESC)."));
}
function motorEffPeak(c){
  let best=0;
  for(let d=0.2; d<=1.001; d+=0.05){ const r=solveQuad(d,1); if(r.P>0) best=Math.max(best, r.Pmech/r.P); }
  return best;
}
/* thermal integration used by both the modal chart and the M2 run — motor + ESC, coupled */
function simulateThermal(duty, seconds, dt){
  const p = propulsionParams();
  let Tm = T_AMB, Te = T_AMB;
  const t=[], temp=[], escTemp=[], rpm=[];
  for(let tt=0; tt<=seconds; tt+=dt){
    const r = solveBench(duty, 1, Tm);
    const Pcu = r.I*r.I*r.Rm;
    const indVel = Math.sqrt(Math.max(r.T,0) / Math.max(2*rhoNow()*Math.PI*(p.D/2)*(p.D/2), .001));
    Tm = motorThermalStep(Tm, Pcu, indVel, p, dt);
    Te = escThermalStep(Te, r.I, p, dt);
    t.push(tt); temp.push(Tm); escTemp.push(Te); rpm.push(r.rpm);
  }
  return { t, temp, escTemp, rpm };
}
function openCalcDetail(){
  const body = openModal("Detailed Calculations", "#c65d3b");
  if(isNavScene()){
    const nc = navCalc();
    const blocks = [
      { t:"1 · Horizontal accuracy (CEP)",
        b:"HDOP = √(q₁₁+q₂₂) from (GᵀG)⁻¹, "+nc.sats.length+" satellite"+(nc.sats.length===1?"":"s")+" in view\nCEP = HDOP × UERE = "+(nc.dop.ok?nc.dop.hdop.toFixed(2):"∞")+" × "+nc.uere.toFixed(1)+" m",
        r:"CEP = "+(isFinite(nc.cep)?nc.cep.toFixed(1):"∞")+" m" },
      { t:"2 · ISA barometric altitude",
        b:"h(P) = (T₀/L)·[1−(P/P₀)^(RL/g)],  T₀="+NAV.T0+" K, L="+NAV.L+" K/m, P₀="+NAV.P0+" Pa\nat h="+nc.hTrue+" m → P="+pressureAt(nc.hTrue).toFixed(0)+" Pa, sensed "+nc.baro.sensed.toFixed(1)+" m",
        r:"h_err = ±"+nc.hErr.toFixed(1)+" m" },
      { t:"3 · 3-D error budget",
        b:"Total = √(CEP² + h_err²) = √("+(isFinite(nc.cep)?(nc.cep*nc.cep).toFixed(1):"∞")+" + "+(nc.hErr*nc.hErr).toFixed(1)+")",
        r:"Total = "+(isFinite(nc.total)?nc.total.toFixed(1):"∞")+" m — "+((isFinite(nc.total)&&nc.total<5)?"safe for autonomous flight":"unsafe near obstacles") }
    ];
    const wrap = el("div","calc-blocks");
    blocks.forEach(bl=>{
      const d = el("div","calc-block");
      d.innerHTML = '<h3>'+bl.t+'</h3><pre>'+bl.b+'</pre><div class="res">'+bl.r+'</div>';
      wrap.appendChild(d);
    });
    wrap.appendChild(el("p","calc-footnote",
      "Values recompute live from the constellation, sensor grade and altitude inputs. GᵀG pseudo-inverse per satellite geometry; ISA lapse-rate model R="+NAV.R+" J/(kg·K), g="+NAV.g+" m/s²."));
    body.appendChild(wrap);
    return;
  }
  const c = calc(); const p = c.p; const canHover = c.tw > 1;
  const blocks = [
    { t:"1 · All-up weight", b:"m = Σ (componentMass × qty) = "+(c.mkg*1000).toFixed(0)+" g\nW = m·g = "+c.mkg.toFixed(3)+" kg × 9.80665 m/s²", r:"W = "+c.W.toFixed(2)+" N" },
    { t:"2 · Air density (ISA)", b:"ρ(h) = 1.225 · (1 − 2.25577×10⁻⁵·h)^4.25588,  h = "+state.altitude+" m", r:"ρ = "+c.rho.toFixed(4)+" kg/m³" },
    { t:"3 · Motor steady state @ 100 %", b:"Ke = 60/(2π·Kv) = "+(60/(2*Math.PI*p.kv)).toFixed(5)+" V·s/rad,  Kt = Ke\nquadratic torque balance Kt(I − I0) = Cq_eff·ρ·n²·D⁵ solved for ω (null → stall)\nV_pack = OCV(soc)·cells − 4I·R_pack  (SoC-swelled cell IR)", r:"rpm = "+Math.round(c.full.rpm).toLocaleString()+" · I = "+c.full.Itot.toFixed(1)+" A · V = "+c.full.V.toFixed(2)+" V" },
    { t:"4 · Maximum thrust (BEMT-lite)", b:"T = Ct_eff·ρ·n²·D⁴ per rotor — Ct corrected for pitch/diameter, Reynolds (µ=1.81e-5) and induced inflow\nD = "+(p.D*1000).toFixed(0)+" mm, pitch/D = "+(p.pitchIn/p.diaIn).toFixed(2)+"\nT_max = 4 × "+(c.Tmax/4).toFixed(2)+" N", r:"T_max = "+c.Tmax.toFixed(2)+" N" },
    { t:"5 · Thrust-to-weight", b:"T/W = "+c.Tmax.toFixed(2)+" / "+c.W.toFixed(2)+"\nrating: ≥2.0 EXCELLENT · ≥1.5 GOOD · ≥1.3 MARGINAL · else FAIL", r:"T/W = "+c.tw.toFixed(2)+"  — "+c.rating },
    { t:"6 · Hover throttle", b:canHover ? "solve 4·T(δ) = W by bisection over δ ∈ [0,1]" : "T_max < W — no hover point exists", r:canHover ? "δ_hover ≈ "+Math.round(c.hoverPct)+" %  ·  I_hover = "+c.hoverI.toFixed(1)+" A" : "—" },
    { t:"7 · Efficiency", b:"η_motor = P_mech / P_elec = Q·ω / (V·I)\nthrust eff = grams-force / watt", r:"η_max ≈ "+(motorEffPeak(c)*100).toFixed(0)+" %  ·  "+c.gPerW.toFixed(1)+" g/W @ full" },
    { t:"8 · Endurance (80 % usable)", b:canHover ? "t = 0.8·C / I_hover = 0.8 × "+(p.cap/1000).toFixed(1)+" Ah / "+c.hoverI.toFixed(1)+" A × 60" : "no hover — endurance undefined", r:canHover ? "t ≈ "+c.endur.toFixed(1)+" min" : "—" }
  ];
  const wrap = el("div","calc-blocks");
  blocks.forEach(bl=>{
    const d = el("div","calc-block");
    d.innerHTML = '<h3>'+bl.t+'</h3><pre>'+bl.b+'</pre><div class="res">'+bl.r+'</div>';
    wrap.appendChild(d);
  });
  wrap.appendChild(el("p","calc-footnote",
    "All values recompute live from the spec.json physics of the selected components and the altitude slider. g = 9.80665 m/s²; propeller Ct/Cq per UIUC convention (n in rev/s)."));
  body.appendChild(wrap);
}

/* ════════════ 11 · SIMULATION RUNNER ════════════ */
const fmtMMSS = s => { s = Math.max(0, Math.floor(s)); const m = Math.floor(s/60), ss = s%60; return (m<10?"0":"")+m+":"+(ss<10?"0":"")+ss; };
let simActive = false;
const sim = { t:0, data:[], data2:[], key:null, exp:null, mod:null,
              alt:0, vel:0, soc:1, temp:T_AMB, escTemp:T_AMB, timeScale:1, hoverD:.5,
              lastRpm:0, lastThr:0, verdict:null, rpmCold:0, overT:0, phase:"STANDBY", ff:false, flightMode:"auto",
              flightT:0, tPhase:0, tBurn:0, cutPwr:false, overheatLatch:false, isStall:false, isDeficit:false,
              reachedTarget:false, eRem:0, eTot:0 };
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
  sim.t = 0; sim.data = []; sim.data2 = []; sim.exp = exp; sim.mod = mod;
  sim.key = mod.id+":"+exp.id; sim.alt = 0; sim.vel = 0; sim.soc = 1;
  sim.temp = T_AMB; sim.escTemp = T_AMB; sim.verdict = null; sim.verdictOk = null; sim.lastRpm = 0; sim.lastThr = 0;
  sim.overT = 0; sim.phase = "PREFLIGHT"; sim.ff = false;
  sim._pop = false; sim._popAt = 0; sim.batStress = 0;
  const c = calc(); sim.hoverD = c.hoverD;      // propulsion init — harmless for nav experiments too
  sim.rpmCold = solveBench(0.85,1,20).rpm;
  // flight-only state (harmless to set for other metrics)
  sim.flightT = 0; sim.tPhase = 0; sim.tBurn = 0; sim.cutPwr = false; sim.overheatLatch = false;
  sim.reachedTarget = false;
  sim.isStall = c.full.stalled; sim.isDeficit = !sim.isStall && c.Tmax < c.W;
  sim.eTot = (c.p.cap/1000) * (c.p.cells*3.7) * 3600;   // J — nominal 3.7 V/cell pack energy
  sim.eRem = sim.eTot;
  // nav init — seed the shared navSim scene state from navCalc() so the scene
  // reads correctly from frame 0 instead of showing a stale value from a prior run.
  if(isNavScene()){ sim.phase = "ACQUIRING"; navSimBaseline(); }
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
  if(completed && (sim.data.length > 3 || sim.exp.metric==="build")){
    // nav experiments only mark done on a verified PASS verdict; a fault run still
    // records/plots (so the chart & telemetry show the failure) but doesn't tick progress.
    if(!isNavScene() || sim.verdictOk===true) state.done[sim.key] = true;
    // keep ONLY this iteration's output (no history) — downsampled for snappy charts
    lastRun = { key:sim.key, metric:sim.exp.metric,
      data: downsample(sim.data, 240), data2: downsample(sim.data2, 240),
      flightT: sim.exp.metric==="alt" ? (sim.flightT||0) : 0 };
    saveState();
    renderModuleTabs(); renderExpTabs(); renderProgress();
    sfx("done");
    if(sim.verdict){ showVerdictToast(sim.verdict, sim.verdictOk); playFaultVoice(sim.verdict, sim.verdictOk); }
    if(allDone()){ renderReward(); instrGo(DRONE_DB.instructor.length-1); sfx("unlock"); }
    else instrEvent("runDone");
  }
  updateTelemetry({temp:sim.temp, esc:sim.escTemp, soc:sim.soc});
  drawLiveGraph();
}
function resetSim(){
  if(simActive) stopSim(false);
  sim.data = []; sim.data2 = []; sim.temp = T_AMB; sim.escTemp = T_AMB; sim.soc = 1;
  $("ffBadge").hidden = true; syncRunControls();
  updateTelemetry({}); drawLiveGraph();
}
/* Nav & Positioning experiments (hdop/cep/baroerr/nav3d) are all procedural —
   none of them use the throttle control. Called on every experiment /
   module switch so it never leaks into another module. */
function syncRunControls(){
  $("throttleWrap").hidden = true;
}
function showVerdictToast(text, ok){
  const t = el("div","verdict "+(ok?"pass":"fail"));
  t.style.cssText = "position:fixed;left:50%;top:74px;transform:translateX(-50%);z-index:120;box-shadow:0 10px 30px rgba(20,40,40,.25);max-width:440px";
  t.innerHTML = '<span class="vic">'+(ok?"✓":"×")+'</span><div class="vtx"><b>'+txt(text.split("—")[0])+'</b><span>'+txt(text.split("—").slice(1).join("—").trim())+'</span></div>';
  document.body.appendChild(t);
  setTimeout(()=>{ t.style.transition="opacity .5s"; t.style.opacity="0"; setTimeout(()=>t.remove(),500); }, 3600);
}
/* ── NAVIGATION sim branches ──
   Each of the 4 nav experiments (hdop/cep/baroerr/nav3d) runs a short recorded
   window driven live from navCalc(). Every frame writes the exact `navSim`
   fields the active scene's navSceneTick() reads (see buildSkyplotScene /
   buildBaroScene / buildNav3dScene above), pushes a chart sample to sim.data /
   sim.data2, and updates the telemetry strip via updateTelemetry(). After the
   window elapses a pass/fault verdict is set and stopSim(true) is called —
   mirrors the propulsion branches below but reads nav physics instead of calc(). */
const NAV_RUN_T = 5.2, NAV_SWEEP_T = 6.0;
/* seed navSim from navCalc() the instant a run starts, so the scene doesn't
   show a stale frame left over from a previous run before navSimStep first fires. */
function navSimBaseline(){
  if(!navSim) return;
  const nc = navCalc(), t = sceneModeType();
  if(t === "skyplot"){
    const cepM = isFinite(nc.cep) ? nc.cep : 60;
    navSim.cepWorld = Math.min(0.15 + cepM/40, 3.06);
    navSim.fixAmp = nc.dop.ok ? Math.min(0.3 + nc.dop.hdop*0.25, 3.0) : 2.5;
    navSim.noFix = !nc.dop.ok;
  }else if(t === "baro"){
    navSim.trueM = 0;
    navSim.sensedM = baroError(0, state.baroGrade, { inversion:state.inversion }).sensed;
  }else if(t === "nav3d"){
    const cepM = isFinite(nc.cep) ? nc.cep : 60, hM = nc.hErr;
    navSim.cepW = Math.min(0.15 + cepM/12, 2.6);
    navSim.hW = Math.min(0.15 + hM/12, 2.6);
    navSim.unsafe = !(isFinite(nc.total) && nc.total < 5);
  }
}
function navSimStep(dt){
  const metric = sim.exp.metric, nc = navCalc();

  if(metric === "hdopcep"){
    // Constellation Geometry & Accuracy — one run covers both halves of the
    // horizontal story: the geometry solve (HDOP/VDOP) and the distance it turns
    // into (CEP = HDOP × UERE). Fixes are drawn Rayleigh-distributed about truth,
    // so the median sample radius IS the CEP by construction (CEP = σ·√(ln4)).
    // PASS needs a real fix, HDOP < 2 AND CEP < 4 m.
    const cepM = isFinite(nc.cep) ? nc.cep : 60;
    navSim.cepWorld = Math.min(0.15 + cepM/40, 3.06);
    navSim.fixAmp = nc.dop.ok ? Math.min(0.3 + nc.dop.hdop*0.25, 3.0) : 2.5;
    navSim.noFix = !nc.dop.ok;
    const targetCount = Math.min(50, Math.floor((sim.t/NAV_RUN_T)*50));
    while(sim.data.length < targetCount){
      const sigma = isFinite(nc.cep) ? nc.cep/1.1774 : 60;
      const r = sigma*Math.sqrt(-2*Math.log(Math.max(Math.random(), 1e-6)));
      sim.data.push(+r.toFixed(2));                                   // sampled fix error
      sim.data2.push(nc.dop.ok ? +nc.dop.hdop.toFixed(2) : 12);       // geometry behind it
    }
    const good = nc.dop.ok && nc.dop.hdop < 2 && nc.cep < 4;
    const poor = !nc.dop.ok || nc.dop.hdop > 4;
    updateTelemetry({ hdop:nc.dop.hdop, vdop:nc.dop.vdop, pdop:nc.dop.pdop, sats:nc.sats.length,
      cep:nc.cep, sigma:nc.hErr, altTrue:nc.hTrue, altSensed:nc.baro.sensed,
      phase: !nc.dop.ok ? "NO FIX" : good ? "FIX LOCKED" : poor ? "GEOMETRY POOR"
             : state.uereScenario==="urban" ? "MULTIPATH" : "DEGRADED",
      phaseCls: (!nc.dop.ok || poor) ? "danger" : good ? "good" : "warn" });
    if(sim.t >= NAV_RUN_T){
      if(sim.data.length < 4){ sim.data.push(cepM); sim.data2.push(cepM); }   // guarantee a plottable run
      if(!nc.dop.ok){
        sim.verdictOk = false; sim.verdict = "No fix — insufficient/degenerate geometry";
      }else if(nc.dop.hdop < 2 && nc.dop.vdop > 8){
        sim.verdictOk = false;
        sim.verdict = "Good HDOP but VDOP "+nc.dop.vdop.toFixed(1)+" — 2D DOP hides vertical dilution";
      }else if(nc.dop.hdop > 4){
        sim.verdictOk = false; sim.verdict = "Poor geometry — HDOP "+nc.dop.hdop.toFixed(1)+", fix wanders";
      }else if(nc.cep >= 4 && state.uereScenario === "urban"){
        sim.verdictOk = false;
        sim.verdict = "Multipath — HDOP "+nc.dop.hdop.toFixed(2)+" but CEP "+nc.cep.toFixed(1)+" m, position unreliable";
      }else if(nc.cep >= 4){
        sim.verdictOk = false;
        sim.verdict = "Accuracy out of spec — HDOP "+nc.dop.hdop.toFixed(2)+", CEP "+nc.cep.toFixed(1)+" m";
      }else if(nc.dop.hdop >= 2){
        sim.verdictOk = false;
        sim.verdict = "Marginal geometry — HDOP "+nc.dop.hdop.toFixed(2)+", accuracy degraded";
      }else{
        sim.verdictOk = true;
        sim.verdict = "GPS LOCK — HDOP "+nc.dop.hdop.toFixed(2)+", CEP "+nc.cep.toFixed(1)+" m within spec";
      }
      stopSim(true);
    }
    return;
  }

  if(metric === "baroerr"){
    // ISA Altitude Profiling — sweep true altitude 0→3000 m across the window
    // (independent of the slider) so the nonlinear ISA error curve shows.
    const frac = Math.min(sim.t/NAV_SWEEP_T, 1);
    const trueAlt = frac*3000;
    const beS = baroError(trueAlt, state.baroGrade, { inversion:state.inversion, sample:true });
    navSim.trueM = trueAlt; navSim.sensedM = beS.sensed;
    sim.data.push(+(beS.sensed-trueAlt).toFixed(2));
    sim.data2.push(Math.round(trueAlt));
    updateTelemetry({ hdop:nc.dop.hdop, vdop:nc.dop.vdop, pdop:nc.dop.pdop, sats:nc.sats.length,
      cep:nc.cep, sigma:beS.sigma, altTrue:trueAlt, altSensed:beS.sensed,
      phase: state.inversion ? "INVERSION BIAS" : state.baroGrade==="coarse" ? "COARSE SCATTER" : "SWEEPING",
      phaseCls: state.inversion ? "danger" : state.baroGrade==="coarse" ? "warn" : "good" });
    if(sim.t >= NAV_SWEEP_T){
      const be500 = baroError(500, state.baroGrade, { inversion:state.inversion });
      const be3000 = baroError(3000, state.baroGrade, { inversion:state.inversion });
      if(state.inversion){
        sim.verdictOk = false;
        sim.verdict = "Temperature inversion — altitude biased by ±"+be3000.bias.toFixed(1)+" m";
      }else if(state.baroGrade === "coarse"){
        sim.verdictOk = false;
        sim.verdict = "Coarse barometer — ±"+be3000.sigma.toFixed(1)+" m altitude noise";
      }else{
        const peak = Math.max(be500.total, be3000.total);
        sim.verdictOk = peak < 3.5;
        sim.verdict = sim.verdictOk
          ? "ISA profile good — "+be500.total.toFixed(1)+" m @500 m rising to "+be3000.total.toFixed(1)+" m @3000 m"
          : "Altitude error high — "+peak.toFixed(1)+" m peak, exceeds ISA prediction";
      }
      stopSim(true);
    }
    return;
  }

  if(metric === "nav3d"){
    // Error Budget Synthesis — grow the CEP/h_err error ellipsoid toward its
    // steady-state size; PASS needs the combined 3-D radius under 5 m.
    const cepM = isFinite(nc.cep) ? nc.cep : 60, hM = nc.hErr;
    const targetCepW = Math.min(0.15 + cepM/12, 2.6), targetHw = Math.min(0.15 + hM/12, 2.6);
    navSim.cepW += (targetCepW - navSim.cepW) * Math.min(dt*1.4, 1);
    navSim.hW   += (targetHw   - navSim.hW)   * Math.min(dt*1.4, 1);
    navSim.unsafe = !(isFinite(nc.total) && nc.total < 5);
    sim.data.push(isFinite(nc.total) ? +nc.total.toFixed(2) : 99);
    sim.data2.push(isFinite(nc.cep) ? +nc.cep.toFixed(2) : 60);
    updateTelemetry({ hdop:nc.dop.hdop, vdop:nc.dop.vdop, pdop:nc.dop.pdop, sats:nc.sats.length,
      cep:nc.cep, sigma:nc.hErr, altTrue:nc.hTrue, altSensed:nc.baro.sensed,
      phase: navSim.unsafe ? "UNSAFE — DRIFTING" : "SAFE ENVELOPE",
      phaseCls: navSim.unsafe ? "danger" : "good" });
    if(!navSim.unsafe && sim.t >= NAV_RUN_T-0.3) navSim.reward = true;   // reveal mast + baro just before the verdict lands
    if(sim.t >= NAV_RUN_T){
      if(navSim.unsafe){
        sim.verdictOk = false;
        sim.verdict = "Unsafe — "+(isFinite(nc.total)?nc.total.toFixed(1):"∞")+" m 3D error, drifts toward obstacle";
      }else{
        sim.verdictOk = true; sim.verdict = "Safe for autonomous — "+nc.total.toFixed(1)+" m 3D error";
      }
      stopSim(true);
    }
    return;
  }
}
function simStep(dt){
  sim.t += dt;
  if(isNavScene()){ navSimStep(dt); return; }
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
/* Result voice-over — one clip per outcome navSimStep() can actually emit.
   Written by audio_gen/gen_nav_lab.py; the match table below keys off the exact
   verdict strings, so a new verdict needs a clip AND a line in navVoiceTag(). */
const VOICE_FILES = {
  gps_lock:"assets/audio/voice/v_gps_lock.mp3",
  no_fix:"assets/audio/voice/v_no_fix.mp3",
  vdop_trap:"assets/audio/voice/v_vdop_trap.mp3",
  poor_geometry:"assets/audio/voice/v_poor_geometry.mp3",
  multipath:"assets/audio/voice/v_multipath.mp3",
  cep_out_of_spec:"assets/audio/voice/v_cep_out_of_spec.mp3",
  marginal:"assets/audio/voice/v_marginal.mp3",
  baro_good:"assets/audio/voice/v_baro_good.mp3",
  baro_coarse:"assets/audio/voice/v_baro_coarse.mp3",
  baro_inversion:"assets/audio/voice/v_baro_inversion.mp3",
  baro_high:"assets/audio/voice/v_baro_high.mp3",
  nav_safe:"assets/audio/voice/v_nav_safe.mp3",
  nav_unsafe:"assets/audio/voice/v_nav_unsafe.mp3"
};
/* keyed by module:experiment — these are the ids the nav manifest ships */
const INTRO_FILES = {
  "m1:geometry":"assets/audio/voice/intro_geometry.mp3",
  "m2:profiling":"assets/audio/voice/intro_profiling.mp3",
  "m3:budget":"assets/audio/voice/intro_budget.mp3"
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
/* Map a verdict string to its clip. Ordered most-specific first: several nav
   verdicts share words ("HDOP" appears in five of them), so the distinguishing
   phrase has to be tested before the general one. */
function navVoiceTag(text, ok){
  const t = (text||"").toLowerCase();
  if(t.includes("no fix")) return "no_fix";
  if(t.includes("vdop")) return "vdop_trap";
  if(t.includes("multipath")) return "multipath";
  if(t.includes("poor geometry")) return "poor_geometry";
  if(t.includes("marginal geometry")) return "marginal";
  if(t.includes("accuracy out of spec")) return "cep_out_of_spec";
  if(t.includes("gps lock")) return "gps_lock";
  if(t.includes("inversion")) return "baro_inversion";
  if(t.includes("coarse barometer")) return "baro_coarse";
  if(t.includes("isa profile good")) return "baro_good";
  if(t.includes("altitude error high")) return "baro_high";
  if(t.includes("unsafe")) return "nav_unsafe";
  if(t.includes("safe for autonomous")) return "nav_safe";
  return ok ? "gps_lock" : null;
}
function playFaultVoice(text, ok){
  const tag = navVoiceTag(text, ok);
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
/* Speak the current step, but WAIT for whatever is already talking. A finished
   run fires the verdict clip and then advances the instructor step; speaking
   the step immediately cut the verdict off mid-sentence, so the student never
   heard why the run passed or failed. */
function playVoiceQueued(){
  const step = DRONE_DB.instructor[state.instrStep];
  const url = step && step.audio;
  if(!url){ playVoice(); return; }
  if(currentVoice && !currentVoice.paused){
    const a = currentVoice;
    a.addEventListener("ended", ()=>{ if(currentVoice===null || currentVoice===a) playVoiceFile(url); },
                       { once:true });
    return;
  }
  playVoiceFile(url);
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
/* Step 0 is the lab intro; steps 1..3 are Modules 1..3; the last step is the
   all-complete note. A run therefore advances to the step for the module it was
   run in — the old fixed map (run:3, runDone:4) was written for a six-step
   panel and jumped straight to "every experiment is complete" after run one. */
function instrStepForModule(){
  const i = DRONE_DB.modules.findIndex(m=>m.id===state.module);
  return Math.min(i < 0 ? 1 : i+1, DRONE_DB.instructor.length-2);
}
function instrEvent(evt){
  const target = (evt==="picker"||evt==="select") ? 1
               : (evt==="run"||evt==="runDone") ? instrStepForModule() : null;
  if(target != null && state.instrStep < target){ instrGo(target); playVoiceQueued(); }
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
    }else{
      // Free-flight views (Module 1 assembly + M3 flight). The assembled drone
      // RESTS ON THE GROUND whenever the simulation is idle, and only lifts to
      // hover / climb height while a run is active.
      const flying = simActive && sim.exp && sim.exp.metric==="alt";
      const hoverH = state.module==="m3" ? 1.0 : 1.15;
      let targetY;
      if(!simActive){
        // seat the drone's lowest point on the grid (world y = 0)
        const box = new THREE.Box3().setFromObject(rig);
        targetY = rig.position.y - box.min.y;
      }else if(flying){
        targetY = 1.0 + Math.min(sim.alt,4.5)*0.75;
      }else{
        targetY = hoverH + Math.sin(hoverPhase)*(state.module==="m3"?.04:.03);
      }
      // smooth take-off / landing lerp
      const ny = rig.position.y + (targetY - rig.position.y) * (simActive?0.12:0.18);
      rig.position.set(simActive?(Math.random()-.5)*.01:0, ny, 0);
      // camera/orbit-target follow altitude smoothly (translate, don't rotate, to avoid disorientation)
      if(flying && controls){
        const targetT = ny + 0.05;
        const dy = (targetT - controls.target.y) * 0.08;
        controls.target.y += dy; camera.position.y += dy;
      }
    }
    // props are stationary when the drone is landed / powered down
    const spin = simActive ? propSpinRate(sim.lastRpm) : 0;
    propGroups.forEach((p,i)=>{
      const dir = p.userData.spinDir != null ? p.userData.spinDir : (i%2?1:-1);
      p.rotation.y += spin*dir*dt;
    });
  }
  // nav scenes drive their own animation (jitter / drift / markers)
  if(navSceneTick){ try{ navSceneTick(dt); }catch(e){} }
  if(simActive){
    simStep(dt);
    if(!isNavScene()) audioUpdate();
    if(++graphEvery % 3 === 0) drawLiveGraph();
  }
  // failure smoke/sparks driven by live sim stress (motor & ESC temp, battery sag)
  if(simActive && !isNavScene()){
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
