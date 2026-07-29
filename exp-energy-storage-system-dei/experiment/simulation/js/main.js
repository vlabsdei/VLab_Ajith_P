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
function calcMotorPoint(duty, V, Rm, Resc, ov){
  const p = propulsionParams(ov);
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
  //          and the motor/ESC per-channel ratings.
  //   Idc  — DC-LINK current the PACK actually supplies. The ESC is a switching
  //          converter, so it steps V down to V·duty: power in = power out gives
  //          V·Idc = (V·duty)·I, i.e. Idc = duty·I. At full throttle the two are
  //          the same, but at a 29 % hover the pack sees roughly a third of the
  //          phase current — treating them as equal made hover draw ~3× too high
  //          and cut every endurance figure to a third of the real value.
  const Idc = duty * I;
  return { rpm: n*60, omega, T:Math.max(T,0), Q, I, Idc,
           P: Vterm*I + I*I*Reff, Pmech: Q*omega, stalled:false };
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
    // the pack sags against what it actually delivers — the DC-link current
    V = Math.max(cellOCV(s)*p.cells - 4*r.Idc*Rpack, p.cells*2.8);
    r = calcMotorPoint(d, V, motorRm(p,20), p.rdsOn, ov);
  }
  return { rpm:r.rpm, omega:r.omega, Tper:r.T, Ttot:4*r.T,
           Iper:r.I,          // phase current — motor / ESC channel ratings, heating
           Itot:4*r.Idc,      // pack current  — C-rating, sag, coulomb count
           V, P:4*r.P, Pmech:4*r.Pmech, Q:r.Q, stalled:r.stalled };
}
/* single motor on the bench (1 motor draws from the pack); tempC = winding temp for Rm */
function solveBench(d, soc, tempC, ov){
  const p = propulsionParams(ov);
  const s = soc==null?1:soc;
  const rIR = cellIR(p, s), Rpack = p.cells*rIR;
  const Rm = motorRm(p, tempC==null?20:tempC);
  let V = cellOCV(s)*p.cells, r = calcMotorPoint(d, V, Rm, p.rdsOn, ov);
  for(let k=0;k<6;k++){
    V = Math.max(cellOCV(s)*p.cells - r.Idc*Rpack, p.cells*2.8);
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
    /* NOTE: the bench instruments (power analyzer, load bank, discharge rig) are
       no longer placeholder blocks here — see section 6b, which builds them as
       real instruments with live displays. */
    default:
      add(new T.SphereGeometry(.4,18,14), mat(0xb8c4bf,{transparent:true,opacity:.35}));
  }
  g.scale.setScalar(s*.9);
  return g;
}

/* ════════════ 6b · ENERGY-STORAGE PROCEDURAL MODELS ════════════
   The four objects this lab actually studies — the LiPo pack and the three
   bench instruments it gets wired into — are real geometry here rather than the
   placeholder blocks in buildFallback(). Everything the physics reads also
   drives the mesh: a 6S pack IS six shrink-wrapped cells tall, its printed label
   carries its own capacity / C-rating, and the instrument displays are canvas
   textures the simulation writes each frame (updateBenchInstruments).
   Build units: metres for the pack (straight from spec.size_mm) and a ~1-unit
   chassis box for the instruments — fitUnit() rescales both to their bench span. */
const LAB = {
  wrap:0x1b2026, wrapLit:0x272d35, seam:0x0b0d10, foil:0xb9c0c7,
  red:0x8f2118, black:0x0d0f12, xt60:0xd9ad1f, jst:0xe6eaee,
  chassis:0x2b3138, chassisDark:0x1a1f25, panel:0x11161a, steel:0x9aa5b1,
  brass:0xb8912a, alu:0xc3cad1, ceramic:0xe6e2d7, glass:0x0a0f0c
};
const LCD = { on:"#7fe9b8", dim:"#3d6f5c", warn:"#ffb066", bad:"#ff6b57", ink:"#04120c" };
const mm = v => v/1000;
function labMat(c, r, m, extra){
  return mat(c, Object.assign({ roughness:r==null?0.5:r, metalness:m==null?0.35:m }, extra||{}));
}
/* Rounded, bottom-anchored box (spans y = 0 … h). Shape-space y maps to world −z
   after the rotate, same convention the ESC-lab board builder uses. */
function rbox(w, d, h, r, m){
  r = Math.max(1e-5, Math.min(r, Math.min(w, d)/2 - 1e-5));
  const s = new THREE.Shape(), x = -w/2, y = -d/2;
  s.moveTo(x+r, y);
  s.lineTo(x+w-r, y); s.quadraticCurveTo(x+w, y, x+w, y+r);
  s.lineTo(x+w, y+d-r); s.quadraticCurveTo(x+w, y+d, x+w-r, y+d);
  s.lineTo(x+r, y+d); s.quadraticCurveTo(x, y+d, x, y+d-r);
  s.lineTo(x, y+r); s.quadraticCurveTo(x, y, x+r, y);
  // NOTE: three.js grows the bevel OUTWARD from the shape outline, so a beveled
  // box is bevelSize wider than w × d. Anything laid on a face (decal, display)
  // must stand off by more than that or it disappears inside the solid.
  const bs = Math.min(h*0.06, r*0.4);
  const g = new THREE.ExtrudeGeometry(s, { depth:h, bevelEnabled:true,
    bevelThickness:h*0.06, bevelSize:bs, bevelSegments:2, steps:1 });
  g.rotateX(-Math.PI/2);
  const mesh = new THREE.Mesh(g, m);
  mesh.userData.bevel = bs;
  return mesh;
}
/* Canvas-backed instrument display. Returned mesh is an unlit plane so the
   readout stays legible whatever the scene lighting does. */
function makeScreen(w, h, pw, ph){
  const cv = document.createElement("canvas");
  cv.width = pw || 512; cv.height = ph || 256;
  const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map:tex, toneMapped:false }));
  return { cv, ctx:cv.getContext("2d"), tex, mesh, w, h };
}
/* Printed decal (transparent canvas on an unlit plane) — silkscreen legends,
   panel branding, pack labels. `draw(ctx, w, h)` paints in pixels. */
function decal(draw, wm, hm, pw, ph){
  const cv = document.createElement("canvas");
  cv.width = pw || 512; cv.height = ph || 256;
  const ctx = cv.getContext("2d");
  ctx.clearRect(0, 0, cv.width, cv.height);
  draw(ctx, cv.width, cv.height);
  const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4;
  return new THREE.Mesh(new THREE.PlaneGeometry(wm, hm),
      new THREE.MeshBasicMaterial({ map:tex, transparent:true, depthWrite:false, toneMapped:false }));
}
const MONO = "'IBM Plex Mono', ui-monospace, monospace";
const SANS = "'IBM Plex Sans', system-ui, sans-serif";

/* ── LiPo pack ─────────────────────────────────────────────────────────────
   Real pouch-cell construction: one shrink-wrapped cell per series count with a
   recessed seam between each, foil tab collar at the lead end, 12 AWG silicone
   power leads into an XT60, and an (n+1)-way JST-XH balance plug — the same
   connector the discharge rig reads per-cell voltage through. */
function packLabel(o, aspect){
  const p = (o && o.phys) || {};
  const cells = p.cells || 3, cap = p.capacity_mah || 0;
  const cCont = p.c_rating_cont || 0, cBurst = p.c_rating || 0;
  const volts = (p.voltage_nominal_v || cells*3.7).toFixed(1);
  // Canvas aspect follows the real pack side (long and shallow) so the artwork
  // is not stretched when it is mapped onto the face.
  const pw = 1400, ph = Math.round(pw / Math.max(1.6, aspect || 4));
  return decal((x, W, H)=>{
    x.fillStyle = "#1d232a"; x.fillRect(0,0,W,H);
    const gl = x.createLinearGradient(0,0,0,H);
    gl.addColorStop(0,"rgba(255,255,255,.12)"); gl.addColorStop(.38,"rgba(255,255,255,.03)");
    gl.addColorStop(.42,"rgba(0,0,0,.14)"); gl.addColorStop(1,"rgba(0,0,0,.24)");
    x.fillStyle = gl; x.fillRect(0,0,W,H);
    x.textBaseline = "middle";
    // brand bar across the top quarter
    x.fillStyle = "#c65d3b"; x.fillRect(0, 0, W, H*0.24);
    x.fillStyle = "#f7f9f8"; x.textAlign = "left";
    x.font = "700 "+Math.round(H*0.16)+"px "+SANS;
    x.fillText("VOLTCORE", W*0.02, H*0.12);
    x.font = "500 "+Math.round(H*0.10)+"px "+MONO;
    x.fillText("LiPo · HIGH DISCHARGE · CHARGE 1C BALANCED", W*0.28, H*0.125);
    // headline capacity + pack configuration
    x.fillStyle = "#f4f6f5"; x.font = "700 "+Math.round(H*0.34)+"px "+MONO;
    x.fillText((cap || "—")+" mAh", W*0.02, H*0.50);
    x.fillStyle = "#cfd8dc"; x.font = "600 "+Math.round(H*0.19)+"px "+MONO;
    x.fillText(volts+" V   "+cells+"S1P", W*0.02, H*0.74);
    // caution line the SoC experiment turns into a hard floor
    x.fillStyle = "#9fb0b8"; x.font = "500 "+Math.round(H*0.11)+"px "+MONO;
    x.fillText("DO NOT DISCHARGE BELOW 3.5 V/CELL", W*0.02, H*0.91);
    // C-rating badge, right third
    const bw = W*0.20, bh = H*0.62, bx = W*0.70, by = H*0.30;
    x.fillStyle = "#d8b93c"; x.fillRect(bx, by, bw, bh);
    x.fillStyle = "#1e2a29"; x.textAlign = "center";
    x.font = "700 "+Math.round(H*0.34)+"px "+MONO;
    x.fillText(cCont+"C", bx+bw/2, by+bh*0.36);
    x.font = "600 "+Math.round(H*0.13)+"px "+MONO;
    x.fillText("CONT · "+cBurst+"C BURST", bx+bw/2, by+bh*0.74);
    // hazard hatching down the right edge
    x.save(); x.beginPath(); x.rect(W*0.94, H*0.28, W*0.045, H*0.62); x.clip();
    const s = H*0.16;
    for(let i=-2;i<10;i++){ x.fillStyle = i%2 ? "#1a1d21" : "#d8b93c";
      x.beginPath(); x.moveTo(W*0.94+i*s, H*0.28); x.lineTo(W*0.94+i*s+s, H*0.28);
      x.lineTo(W*0.94+i*s+s*0.3, H*0.90); x.lineTo(W*0.94+i*s-s*0.7, H*0.90);
      x.closePath(); x.fill(); }
    x.restore();
  }, 1, 1, pw, ph);
}
function buildLipoPack(o){
  const p = (o && o.phys) || {};
  const dim = (o && o.size) || [76, 38, 30];
  const L = mm(dim[0]), W = mm(dim[1]), H = mm(dim[2]);
  const n = Math.max(1, Math.min(8, p.cells || 3));
  const g = new THREE.Group();
  const wrapA = labMat(LAB.wrap, .34, .18), wrapB = labMat(LAB.wrapLit, .32, .20);
  const seamM = labMat(LAB.seam, .72, .10);

  // ── stack: one pouch cell per series count, recessed seam between each
  const cellH = H/n, gap = Math.min(cellH*0.12, mm(1.4));
  for(let i=0;i<n;i++){
    const h = cellH - gap;
    const c = rbox(L, W, h, Math.min(mm(2.2), h*0.45), i%2 ? wrapB : wrapA);
    c.position.y = i*cellH + gap/2;
    g.add(c);
    if(i){
      const sm = rbox(L*0.985, W*0.985, gap, mm(0.5), seamM);
      sm.position.y = i*cellH - gap/2; g.add(sm);
    }
  }
  // ── printed label, both long faces + capacity strip on top. The standoff has
  //    to clear the shrink-wrap bevel or the decal disappears into the cell face.
  const labW = L*0.94, labH = H*0.84;
  const labTex = packLabel(o, labW/labH).material.map;
  [1,-1].forEach(s=>{
    const m = new THREE.Mesh(new THREE.PlaneGeometry(labW, labH),
        new THREE.MeshBasicMaterial({ map:labTex, transparent:true, depthWrite:false,
          toneMapped:false, polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2 }));
    m.position.set(0, H*0.5, s*(W/2 + mm(1.2)));
    if(s < 0) m.rotation.y = Math.PI;
    g.add(m);
  });
  const topW = L*0.86, topH = W*0.22;
  const top = decal((x,Wp,Hp)=>{
    x.fillStyle = "rgba(20,24,28,.92)"; x.fillRect(0,0,Wp,Hp);
    x.fillStyle = "#e8edf0"; x.textBaseline = "middle"; x.textAlign = "left";
    x.font = "700 "+Math.round(Hp*0.52)+"px "+MONO;
    x.fillText(n+"S  "+(p.capacity_mah||"—")+" mAh", Wp*0.03, Hp*0.54);
    x.textAlign = "right"; x.fillStyle = "#d8b93c";
    x.fillText((p.c_rating_cont||0)+"C", Wp*0.97, Hp*0.54);
  }, topW, topH, 1024, Math.round(1024*topH/topW));
  top.rotation.x = -Math.PI/2;
  top.position.set(0, H + mm(1.0), 0);
  top.material.polygonOffset = true; top.material.polygonOffsetFactor = -2; top.material.polygonOffsetUnits = -2;
  g.add(top);

  // ── lead end: aluminium tab edge under a black heat-shrink collar
  const foil = rbox(L*0.02, W*0.92, H*0.94, mm(0.8), labMat(LAB.foil, .38, .85));
  foil.position.set(-L*0.5 - L*0.008, H*0.03, 0); g.add(foil);
  const collar = rbox(L*0.06, W*1.02, H*1.02, mm(1.6), labMat(LAB.black, .55, .12));
  collar.position.set(-L*0.5 + L*0.03, -H*0.01, 0); g.add(collar);

  // ── 12 AWG silicone power leads → XT60
  const leadR = Math.max(mm(1.5), Math.min(H*0.085, mm(3.0)));
  const xtX = -L*0.5 - Math.max(L*0.20, mm(20));
  const lead = (zOff, yOff, col)=>{
    const a = new THREE.Vector3(-L*0.5, H*0.5 + yOff, zOff*0.55);
    const b = new THREE.Vector3(xtX + mm(9), H*0.34, zOff*0.35);
    const c1 = new THREE.Vector3((a.x+b.x)/2, H*0.72 + yOff*0.6, zOff);
    const lm = labMat(col, .48, .06); lm.envMapIntensity = 0.25;
    const t = new THREE.Mesh(new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3([a, c1, b]), 24, leadR, 12, false), lm);
    g.add(t);
  };
  lead( W*0.22,  H*0.14, LAB.red);
  lead(-W*0.22, -H*0.10, LAB.black);
  // XT60 female housing: chamfered yellow nylon body with two plated bores
  const xt = new THREE.Group();
  const body = rbox(mm(16), mm(8.2), mm(7.5), mm(1.2), labMat(LAB.xt60, .48, .06));
  xt.add(body);
  const nose = rbox(mm(4), mm(6.6), mm(6.4), mm(1.0), labMat(LAB.xt60, .48, .06));
  nose.position.set(-mm(9), mm(0.55), 0); xt.add(nose);
  [[-1,LAB.red],[1,LAB.black]].forEach(([s])=>{
    const bore = new THREE.Mesh(new THREE.CylinderGeometry(mm(1.9), mm(1.9), mm(9), 16),
        labMat(0x0a0c0e, .8, .2));
    bore.rotation.z = Math.PI/2; bore.position.set(-mm(7), mm(3.7), s*mm(2.1)); xt.add(bore);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(mm(1.5), mm(1.5), mm(5), 14),
        labMat(LAB.foil, .3, .9));
    barrel.rotation.z = Math.PI/2; barrel.position.set(-mm(6), mm(3.7), s*mm(2.1)); xt.add(barrel);
  });
  xt.position.set(xtX, H*0.30, 0); g.add(xt);

  // ── (n+1)-way JST-XH balance lead — the port the discharge rig taps
  const bWires = ["#1a1d21","#c2372c","#e8e8e8","#3f7fd8","#e0c04a","#39a06a","#a86bd8"];
  for(let i=0;i<=n;i++){
    const z = (i - n/2) * mm(2.6);
    const a = new THREE.Vector3(-L*0.5, H*0.86, z*0.4);
    const b = new THREE.Vector3(xtX + mm(6), H*0.80, W*0.36 + z*0.5);
    const c1 = new THREE.Vector3((a.x+b.x)/2, H*1.02, W*0.20 + z*0.5);
    const t = new THREE.Mesh(new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3([a, c1, b]), 20, mm(0.65), 8, false),
        labMat(parseInt(bWires[i % bWires.length].slice(1), 16), .55, .05));
    g.add(t);
  }
  const jstW = mm(2.5)*(n+1) + mm(2.0);
  const jst = rbox(mm(6), jstW, mm(5.5), mm(0.7), labMat(LAB.jst, .6, .05));
  jst.position.set(xtX + mm(3), H*0.72, W*0.36); g.add(jst);
  for(let i=0;i<=n;i++){
    const pin = new THREE.Mesh(new THREE.BoxGeometry(mm(1.0), mm(3.2), mm(0.6)),
        labMat(LAB.brass, .32, .85));
    pin.position.set(xtX - mm(0.4), H*0.72 + mm(2.8), W*0.36 + (i-n/2)*mm(2.5));
    g.add(pin);
  }
  g.userData.packDims = { L, W, H, cells:n };
  // lead-end terminals in pack-local space, for the bench wiring
  g.userData.terminals = {
    pos:     [xtX - mm(8), H*0.30 + mm(3.7),  mm(2.1)],
    neg:     [xtX - mm(8), H*0.30 + mm(3.7), -mm(2.1)],
    balance: [xtX - mm(1), H*0.72 + mm(2.8), W*0.36]
  };
  return g;
}

/* ── shared instrument chassis parts ─────────────────────────────────────── */
function ventSlots(parent, n, x0, y, z, w, h, step, axis){
  for(let i=0;i<n;i++){
    const s = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.012), labMat(0x0a0d10, .85, .1));
    if(axis === "top"){ s.rotation.x = -Math.PI/2; s.position.set(x0 + i*step, y, z); }
    else s.position.set(x0 + i*step, y, z);
    parent.add(s);
  }
}
function rubberFeet(parent, w, d, y){
  [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([sx,sz])=>{
    const f = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.03, 14), labMat(0x0e1114, .9, .05));
    f.position.set(sx*w*0.40, y - 0.015, sz*d*0.36); parent.add(f);
  });
}
function bindingPost(parent, x, y, z, color, sym){
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.042, 0.018, 20), labMat(color, .45, .35));
  collar.rotation.x = Math.PI/2; collar.position.set(x, y, z); parent.add(collar);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.024, 0.055, 18), labMat(color, .35, .6));
  post.rotation.x = Math.PI/2; post.position.set(x, y, z + 0.035); parent.add(post);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.026, 16, 12), labMat(color, .4, .5));
  cap.position.set(x, y, z + 0.066); parent.add(cap);
  const lab = decal((c,W,H)=>{ c.fillStyle = "#dfe6e2"; c.textAlign="center"; c.textBaseline="middle";
    c.font = "700 "+Math.round(H*0.8)+"px "+MONO; c.fillText(sym, W/2, H*0.54); }, 0.05, 0.05, 64, 64);
  lab.position.set(x, y + 0.055, z + 0.004); parent.add(lab);
}
function xt60Port(parent, x, y, z, ry){
  const g = new THREE.Group();
  const b = rbox(0.075, 0.042, 0.038, 0.006, labMat(LAB.xt60, .5, .06));
  g.add(b);
  [-1,1].forEach(s=>{
    const bore = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.05, 14), labMat(0x0a0c0e, .8, .2));
    bore.rotation.z = Math.PI/2; bore.position.set(-0.02, 0.019, s*0.011); g.add(bore);
  });
  g.position.set(x, y, z); g.rotation.y = ry || 0; parent.add(g);
  return g;
}
function statusLed(parent, x, y, z, color){
  const m = new THREE.MeshBasicMaterial({ color:color, toneMapped:false });
  const led = new THREE.Mesh(new THREE.CircleGeometry(0.013, 16), m);
  led.position.set(x, y, z); parent.add(led);
  return led;
}
function panelKnob(parent, x, y, z, r){
  const k = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r*1.06, 0.028, 24), labMat(0x0e1216, .42, .5));
  body.rotation.x = Math.PI/2; k.add(body);
  for(let i=0;i<20;i++){                                    // knurled rim
    const a = i/20*Math.PI*2;
    const rib = new THREE.Mesh(new THREE.BoxGeometry(r*0.10, r*0.10, 0.030), labMat(0x161b20, .5, .45));
    rib.position.set(Math.cos(a)*r, Math.sin(a)*r, 0); k.add(rib);
  }
  const mark = new THREE.Mesh(new THREE.BoxGeometry(r*0.14, r*0.85, 0.006), labMat(0xd8dde2, .4, .2));
  mark.position.set(0, r*0.42, 0.016); k.add(mark);
  k.position.set(x, y, z); parent.add(k);
  return k;
}

/* ── power analyzer / electronic load meter ───────────────────────────────
   Reads the pack under the C-Rating and Voltage-Sag runs: big backlit V/A/W/mAh
   readout, a C-rate headroom LED bar, 4 mm binding posts and an XT60 pass-through. */
function buildPowerAnalyzer(){
  const g = new THREE.Group();
  const W = 1.0, D = 0.62, Hc = 0.44, zf = D/2;
  const shell = rbox(W, D, Hc, 0.028, labMat(LAB.chassis, .48, .45)); g.add(shell);
  const face = rbox(W*0.985, 0.012, Hc*0.92, 0.008, labMat(LAB.panel, .62, .25));
  face.position.set(0, Hc*0.04, zf); g.add(face);

  // Panel stack, front to back: plate → display bezel → glass → legends.
  const bezel = rbox(W*0.64, 0.012, Hc*0.46, 0.010, labMat(0x05080a, .5, .3));
  bezel.position.set(-W*0.14, Hc*0.37, zf + 0.014); g.add(bezel);
  const scr = makeScreen(W*0.60, Hc*0.42, 640, 256);
  scr.mesh.position.set(-W*0.14, Hc*0.60, zf + 0.030); g.add(scr.mesh);

  // C-rate headroom LED bar (green → amber → red as the draw eats the margin)
  const leds = [];
  for(let i=0;i<10;i++){
    const m = new THREE.MeshBasicMaterial({ color:0x1a2a24, toneMapped:false });
    const b = new THREE.Mesh(new THREE.BoxGeometry(W*0.035, Hc*0.055, 0.010), m);
    b.position.set(-W*0.40 + i*W*0.046, Hc*0.28, zf + 0.020); g.add(b); leds.push(b);
  }
  const barLab = decal((x,Wp,Hp)=>{ x.fillStyle="#8ea3ad"; x.textBaseline="middle"; x.font="600 "+Math.round(Hp*0.62)+"px "+MONO;
    x.fillText("C-RATE HEADROOM", Wp*0.02, Hp*0.55); }, W*0.42, Hc*0.09, 512, 64);
  barLab.position.set(-W*0.19, Hc*0.19, zf + 0.018); g.add(barLab);
  const brand = decal((x,Wp,Hp)=>{
    x.fillStyle="#f2f5f4"; x.textBaseline="middle"; x.font="700 "+Math.round(Hp*0.44)+"px "+SANS;
    x.fillText("PACK ANALYZER", Wp*0.02, Hp*0.34);
    x.fillStyle="#8ea3ad"; x.font="500 "+Math.round(Hp*0.30)+"px "+MONO;
    x.fillText("200 A · 60 V · 4-WIRE KELVIN SHUNT", Wp*0.02, Hp*0.76);
  }, W*0.50, Hc*0.16, 640, 96);
  brand.position.set(-W*0.20, Hc*0.88, zf + 0.018); g.add(brand);

  // range knob + soft buttons
  panelKnob(g, W*0.31, Hc*0.62, zf + 0.024, 0.062);
  ["ZERO","HOLD","MODE"].forEach((t,i)=>{
    const b = rbox(W*0.085, 0.018, Hc*0.115, 0.006, labMat(0x0f1418, .55, .3));
    b.position.set(W*0.19 + i*W*0.11, Hc*0.22, zf + 0.014); g.add(b);
    const l = decal((x,Wp,Hp)=>{ x.fillStyle="#9fb0b8"; x.textAlign="center"; x.textBaseline="middle";
      x.font="600 "+Math.round(Hp*0.6)+"px "+MONO; x.fillText(t, Wp/2, Hp*0.55); }, W*0.085, Hc*0.06, 128, 48);
    l.position.set(W*0.19 + i*W*0.11, Hc*0.155, zf + 0.018); g.add(l);
  });

  // shunt terminals: pack in (left pair) → load out (right pair)
  bindingPost(g, -W*0.36, Hc*0.10, zf + 0.012, LAB.red, "+");
  bindingPost(g, -W*0.22, Hc*0.10, zf + 0.012, LAB.black, "−");
  xt60Port(g, W*0.40, Hc*0.06, zf - 0.02, 0);
  // Real terminal coordinates, published so the bench wiring can be routed to the
  // actual posts instead of to guessed points in mid-air.
  g.userData.terminals = {
    inPos:  [-W*0.36, Hc*0.10, zf + 0.075],   // pack feeds these (4 mm posts)
    inNeg:  [-W*0.22, Hc*0.10, zf + 0.075],
    outPos: [ W*0.40, Hc*0.06, zf + 0.02],    // on to the load bank (XT60 port)
    outNeg: [ W*0.40, Hc*0.02, zf + 0.02]
  };
  ventSlots(g, 9, -W*0.30, Hc + 0.002, -D*0.16, W*0.30, 0.016, W*0.052, "top");
  rubberFeet(g, W, D, 0);
  g.userData.screen = scr; g.userData.leds = leds;
  drawAnalyzerScreen(g, null);
  return g;
}
function drawAnalyzerScreen(g, d){
  const s = g && g.userData.screen; if(!s) return;
  const x = s.ctx, W = s.cv.width, H = s.cv.height;
  x.fillStyle = LCD.ink; x.fillRect(0,0,W,H);
  x.strokeStyle = "rgba(120,220,180,.10)"; x.lineWidth = 1;
  for(let i=1;i<4;i++){ x.beginPath(); x.moveTo(0, H*i/4); x.lineTo(W, H*i/4); x.stroke(); }
  const col = d && d.cls === "danger" ? LCD.bad : d && d.cls === "warn" ? LCD.warn : LCD.on;
  const cell = (cx, cy, label, val, unit, c)=>{
    x.textAlign = "left"; x.textBaseline = "alphabetic";
    x.fillStyle = LCD.dim; x.font = "600 "+Math.round(H*0.085)+"px "+MONO;
    x.fillText(label, cx, cy - H*0.145);
    x.fillStyle = c || col; x.font = "700 "+Math.round(H*0.20)+"px "+MONO;
    x.fillText(val, cx, cy + H*0.04);
    x.fillStyle = LCD.dim; x.font = "600 "+Math.round(H*0.085)+"px "+MONO;
    x.fillText(unit, cx + x.measureText(val).width*0 + W*0.22, cy + H*0.04);
  };
  const V = d ? d.V : 0, I = d ? d.I : 0, P = d ? d.P : 0, mAh = d ? d.mAh : 0;
  cell(W*0.05, H*0.34, "PACK VOLTAGE", V.toFixed(2), "V");
  cell(W*0.53, H*0.34, "CURRENT",      I.toFixed(1), "A", d && d.overCont ? LCD.bad : col);
  cell(W*0.05, H*0.80, "POWER",        P.toFixed(0), "W");
  cell(W*0.53, H*0.80, "DRAWN",        mAh.toFixed(0), "mAh");
  x.textAlign = "right"; x.fillStyle = col; x.font = "600 "+Math.round(H*0.09)+"px "+MONO;
  x.fillText(d && d.status ? d.status : "STANDBY", W*0.97, H*0.11);
  s.tex.needsUpdate = true;
  const leds = g.userData.leds || [];
  const lit = d ? Math.round(Math.max(0, Math.min(1, d.headroom == null ? 1 : d.headroom)) * leds.length) : 0;
  leds.forEach((b, i)=>{
    const on = i < lit;
    const c = i < 3 ? 0xff5a44 : i < 6 ? 0xffb066 : 0x49e2a0;
    b.material.color.setHex(on ? c : 0x1a2a24);
  });
}

/* ── resistive load bank ──────────────────────────────────────────────────
   Sinks the current the analyzer measures: ceramic power resistors behind a
   grille (they glow with dissipated power), finned alu heatsink, extractor fan. */
function buildLoadBank(){
  const g = new THREE.Group();
  const W = 0.95, D = 0.52, base = 0.20, zf = D/2;
  // ── control base: panel with the set-current knob, readout and terminals
  const shell = rbox(W, D, base, 0.020, labMat(0x394047, .55, .55)); g.add(shell);
  panelKnob(g, -W*0.38, base*0.50, zf + 0.022, 0.050);
  const bezel = rbox(W*0.40, 0.012, base*0.56, 0.008, labMat(0x05080a, .5, .3));
  bezel.position.set(-W*0.06, base*0.22, zf + 0.014); g.add(bezel);
  const scr = makeScreen(W*0.36, base*0.46, 384, 96);
  scr.mesh.position.set(-W*0.06, base*0.50, zf + 0.032); g.add(scr.mesh);
  bindingPost(g, W*0.26, base*0.50, zf + 0.014, LAB.red, "+");
  bindingPost(g, W*0.42, base*0.50, zf + 0.014, LAB.black, "−");
  g.userData.terminals = {
    inPos: [W*0.26, base*0.50, zf + 0.078],
    inNeg: [W*0.42, base*0.50, zf + 0.078]
  };
  ventSlots(g, 8, -W*0.30, base*0.5, -D/2 - 0.008, W*0.28, 0.014, W*0.058);
  rubberFeet(g, W, D, 0);

  // ── open resistor cage above it: end plates carrying four ceramic power
  //    resistors, the parts that actually turn the pack's energy into heat
  const cageH = 0.30;
  [-1,1].forEach(s=>{
    const plate = rbox(0.035, D*0.86, cageH, 0.008, labMat(0x2c333a, .5, .55));
    plate.position.set(s*W*0.46, base, 0); g.add(plate);
  });
  const glow = [];
  for(let i=0;i<4;i++){
    const y = base + cageH*0.24 + i*cageH*0.20;
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, W*0.86, 18),
        labMat(LAB.ceramic, .78, .05));
    r.rotation.z = Math.PI/2; r.position.set(0, y, 0);
    r.material.emissive = new THREE.Color(0x000000);
    g.add(r); glow.push(r);
    for(let k=0;k<10;k++){                                   // resistance-wire winding
      const t = new THREE.Mesh(new THREE.TorusGeometry(0.047, 0.005, 8, 20), labMat(0x6d757c, .5, .7));
      t.rotation.y = Math.PI/2; t.position.set(-W*0.36 + k*W*0.08, y, 0); g.add(t);
    }
    [-1,1].forEach(s=>{                                       // stud terminals into the end plates
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.06, 12), labMat(LAB.brass, .35, .8));
      st.rotation.z = Math.PI/2; st.position.set(s*W*0.45, y, 0); g.add(st);
    });
  }
  // finned aluminium heatsink capping the cage
  for(let i=0;i<14;i++){
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.010, 0.085, D*0.52), labMat(LAB.alu, .38, .8));
    fin.position.set(-W*0.42 + i*W*0.065, base + cageH + 0.055, -D*0.12); g.add(fin);
  }
  const cap = new THREE.Mesh(new THREE.BoxGeometry(W*0.96, 0.018, D*0.84), labMat(LAB.alu, .4, .78));
  cap.position.set(0, base + cageH + 0.008, 0); g.add(cap);
  // wire guard across the open front so the hot elements are still visible
  for(let i=0;i<9;i++){
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, cageH, 8), labMat(0x1a1f24, .6, .4));
    b.position.set(-W*0.36 + i*W*0.09, base + cageH*0.5, zf*0.86); g.add(b);
  }

  // ── extractor fan on the right cheek
  const fan = new THREE.Group();
  fan.add(new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.02, 16), labMat(0x14181c, .5, .4)));
  for(let i=0;i<7;i++){
    const bl = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.006, 0.042), labMat(0x2c333a, .55, .3));
    bl.position.set(Math.cos(i/7*Math.PI*2)*0.058, 0, Math.sin(i/7*Math.PI*2)*0.058);
    bl.rotation.y = -i/7*Math.PI*2; bl.rotation.x = 0.42; fan.add(bl);
  }
  fan.rotation.z = Math.PI/2; fan.position.set(W*0.50, base + cageH*0.55, -D*0.22); g.add(fan);
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.007, 8, 28), labMat(0x22282e, .5, .5));
  guard.rotation.y = Math.PI/2; guard.position.set(W*0.505, base + cageH*0.55, -D*0.22); g.add(guard);

  // hazard + rating plate on the heatsink cap, clear of the controls
  const warn = decal((x,Wp,Hp)=>{
    x.fillStyle = "rgba(18,22,26,.90)"; x.fillRect(0,0,Wp,Hp);
    x.fillStyle = "#d8b93c"; x.fillRect(0,0,Wp,Hp*0.10);
    x.fillStyle = "#e6cf7a"; x.textBaseline="middle"; x.font = "700 "+Math.round(Hp*0.40)+"px "+MONO;
    x.fillText("⚠ HOT SURFACE", Wp*0.03, Hp*0.44);
    x.fillStyle = "#9fb0b8"; x.font = "500 "+Math.round(Hp*0.26)+"px "+MONO;
    x.fillText("RESISTIVE LOAD BANK · 0.1 Ω · 3 kW", Wp*0.03, Hp*0.80);
  }, W*0.50, D*0.30, 512, 128);
  warn.rotation.x = -Math.PI/2;
  warn.position.set(-W*0.20, base + cageH + 0.019, D*0.26); g.add(warn);
  g.userData.screen = scr; g.userData.fan = fan; g.userData.glow = glow;
  drawLoadScreen(g, null);
  return g;
}
function drawLoadScreen(g, d){
  const s = g && g.userData.screen; if(!s) return;
  const x = s.ctx, W = s.cv.width, H = s.cv.height;
  x.fillStyle = LCD.ink; x.fillRect(0,0,W,H);
  x.fillStyle = LCD.dim; x.textBaseline = "middle"; x.textAlign = "left";
  x.font = "600 "+Math.round(H*0.26)+"px "+MONO;
  x.fillText("LOAD", W*0.04, H*0.28);
  x.fillStyle = d && d.hot > 0.6 ? LCD.bad : d && d.hot > 0.25 ? LCD.warn : LCD.on;
  x.font = "700 "+Math.round(H*0.44)+"px "+MONO;
  x.fillText((d ? d.I : 0).toFixed(1)+" A", W*0.04, H*0.70);
  x.textAlign = "right"; x.fillStyle = LCD.dim; x.font = "600 "+Math.round(H*0.24)+"px "+MONO;
  x.fillText((d ? d.P : 0).toFixed(0)+" W", W*0.96, H*0.70);
  s.tex.needsUpdate = true;
}

/* ── SoC discharge rig ────────────────────────────────────────────────────
   Slant-panel cell analyzer for the SoC Discharge Mapping run: per-cell voltage
   bars read through the pack's JST-XH balance port, a coulomb-counted SoC arc
   (the naive nameplate readout the auto-cut actually watches) and status LEDs. */
function buildDischargeRig(){
  const g = new THREE.Group();
  const W = 1.1, D = 0.62, Hc = 0.30, zf = D/2;
  const shell = rbox(W, D, Hc, 0.022, labMat(LAB.chassis, .5, .42)); g.add(shell);
  // slanted instrument panel
  const panel = new THREE.Group();
  const plate = rbox(W*0.98, D*0.52, 0.016, 0.012, labMat(LAB.panel, .6, .25));
  panel.add(plate);
  const scr = makeScreen(W*0.86, D*0.40, 640, 288);
  scr.mesh.rotation.x = -Math.PI/2; scr.mesh.position.set(0, 0.019, -D*0.005); panel.add(scr.mesh);
  // tilt the console TOWARD the operator (+Z), back edge raised on the wedge
  panel.rotation.x = 0.42; panel.position.set(0, Hc + 0.055, D*0.06); g.add(panel);
  // panel support wedge
  const wedge = rbox(W*0.9, D*0.16, 0.09, 0.01, labMat(LAB.chassisDark, .55, .4));
  wedge.position.set(0, Hc - 0.002, -D*0.16); g.add(wedge);

  // balance-port header (n+1 gold pins) + XT60 pack input on the front apron
  const hdr = rbox(0.20, 0.05, 0.05, 0.006, labMat(0x0f1317, .6, .3));
  hdr.position.set(-W*0.30, Hc*0.20, zf + 0.010); g.add(hdr);
  for(let i=0;i<7;i++){
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.036, 0.008), labMat(LAB.brass, .32, .85));
    p.position.set(-W*0.30 - 0.075 + i*0.025, Hc*0.20 + 0.042, zf + 0.010); g.add(p);
  }
  const hdrLab = decal((x,Wp,Hp)=>{ x.fillStyle="#8ea3ad"; x.textBaseline="middle"; x.font="600 "+Math.round(Hp*0.62)+"px "+MONO;
    x.fillText("BALANCE  2S-6S", Wp*0.02, Hp*0.55); }, 0.26, 0.05, 256, 48);
  hdrLab.position.set(-W*0.30, Hc*0.06, zf + 0.016); g.add(hdrLab);
  xt60Port(g, W*0.06, Hc*0.16, zf + 0.014, 0);
  g.userData.terminals = {
    inPos: [W*0.06 - 0.02, Hc*0.16 + 0.02, zf + 0.055],
    inNeg: [W*0.06 + 0.02, Hc*0.16 + 0.02, zf + 0.055],
    balance: [-W*0.30, Hc*0.20 + 0.05, zf + 0.03]
  };
  const leds = [
    statusLed(g, W*0.30, Hc*0.40, zf + 0.016, 0x2a3a34),
    statusLed(g, W*0.36, Hc*0.40, zf + 0.016, 0x2a3a34),
    statusLed(g, W*0.42, Hc*0.40, zf + 0.016, 0x2a3a34)
  ];
  ["RUN","CUT","FAULT"].forEach((t,i)=>{
    const l = decal((x,Wp,Hp)=>{ x.fillStyle="#8ea3ad"; x.textAlign="center"; x.textBaseline="middle";
      x.font="600 "+Math.round(Hp*0.62)+"px "+MONO; x.fillText(t, Wp/2, Hp*0.55); }, 0.06, 0.028, 96, 40);
    l.position.set(W*0.30 + i*0.06, Hc*0.26, zf + 0.016); g.add(l);
  });
  [0,1].forEach(i=>{
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.028, 0.026, 20),
        labMat(i ? 0xbe392c : 0x2e7d5b, .45, .3));
    b.rotation.x = Math.PI/2; b.position.set(W*0.38 + i*0.08, Hc*0.68, zf + 0.014); g.add(b);
  });
  ventSlots(g, 10, -W*0.34, Hc*0.55, -D/2 - 0.004, W*0.28, 0.012, W*0.062);
  rubberFeet(g, W, D, 0);
  g.userData.screen = scr; g.userData.leds = leds;
  drawRigScreen(g, null);
  return g;
}
function drawRigScreen(g, d){
  const s = g && g.userData.screen; if(!s) return;
  const x = s.ctx, W = s.cv.width, H = s.cv.height;
  x.fillStyle = LCD.ink; x.fillRect(0,0,W,H);
  const bad = d && d.fault, cut = d && d.cut;
  const col = bad ? LCD.bad : cut ? LCD.warn : LCD.on;
  // header
  x.fillStyle = LCD.dim; x.textAlign = "left"; x.textBaseline = "middle";
  x.font = "600 "+Math.round(H*0.075)+"px "+MONO;
  x.fillText("CELL ANALYZER · CONSTANT-CURRENT DISCHARGE", W*0.03, H*0.09);
  // per-cell voltage bars, read through the balance port
  const n = (d && d.cells) || 4, vc = (d && d.vcell) || 0;
  const bw = W*0.62/n, x0 = W*0.03;
  for(let i=0;i<n;i++){
    const frac = Math.max(0, Math.min(1, (vc - 3.0)/(4.2 - 3.0)));
    const jitter = 1 - i*0.004;                              // cells never match exactly
    const h = H*0.46*frac*jitter;
    x.fillStyle = "rgba(120,220,180,.10)";
    x.fillRect(x0 + i*bw + bw*0.12, H*0.22, bw*0.72, H*0.46);
    x.fillStyle = vc < 3.5 ? LCD.bad : vc < 3.7 ? LCD.warn : LCD.on;
    x.fillRect(x0 + i*bw + bw*0.12, H*0.68 - h, bw*0.72, h);
    x.fillStyle = LCD.dim; x.textAlign = "center"; x.font = "600 "+Math.round(H*0.06)+"px "+MONO;
    x.fillText("C"+(i+1), x0 + i*bw + bw*0.48, H*0.75);
    x.fillStyle = col; x.font = "600 "+Math.round(H*0.062)+"px "+MONO;
    x.fillText((vc*jitter).toFixed(2), x0 + i*bw + bw*0.48, H*0.84);
  }
  // 3.5 V/cell floor marker
  const floorY = H*0.68 - H*0.46*((3.5-3.0)/1.2);
  x.strokeStyle = LCD.bad; x.setLineDash([6,5]); x.lineWidth = 2;
  x.beginPath(); x.moveTo(x0, floorY); x.lineTo(x0 + W*0.62, floorY); x.stroke(); x.setLineDash([]);
  x.fillStyle = LCD.bad; x.textAlign = "left"; x.font = "600 "+Math.round(H*0.055)+"px "+MONO;
  x.fillText("3.50 V FLOOR", x0 + 4, floorY - H*0.04);
  // coulomb-counted SoC arc (the nameplate readout the auto-cut watches)
  const cx = W*0.82, cy = H*0.48, r = H*0.28;
  const soc = d ? Math.max(0, Math.min(1, d.soc)) : 1;
  x.lineWidth = H*0.075; x.strokeStyle = "rgba(120,220,180,.12)";
  x.beginPath(); x.arc(cx, cy, r, Math.PI*0.75, Math.PI*2.25); x.stroke();
  x.strokeStyle = soc <= 0.20 ? LCD.warn : col;
  x.beginPath(); x.arc(cx, cy, r, Math.PI*0.75, Math.PI*0.75 + Math.PI*1.5*soc); x.stroke();
  x.fillStyle = col; x.textAlign = "center"; x.font = "700 "+Math.round(H*0.17)+"px "+MONO;
  x.fillText(Math.round(soc*100)+"%", cx, cy + H*0.055);
  x.fillStyle = LCD.dim; x.font = "600 "+Math.round(H*0.055)+"px "+MONO;
  x.fillText("SoC (COULOMB)", cx, cy + r + H*0.10);
  // status line
  x.textAlign = "right"; x.fillStyle = col; x.font = "600 "+Math.round(H*0.075)+"px "+MONO;
  x.fillText(d && d.status ? d.status : "IDLE", W*0.97, H*0.09);
  s.tex.needsUpdate = true;
  const leds = g.userData.leds || [];
  if(leds.length === 3){
    leds[0].material.color.setHex(d && d.running ? 0x49e2a0 : 0x2a3a34);
    leds[1].material.color.setHex(cut ? 0xffb066 : 0x2a3a34);
    leds[2].material.color.setHex(bad ? 0xff5a44 : 0x2a3a34);
  }
}

/* Live instrument drive — called from simStep() every frame with whatever the
   current experiment measured, and once with null on reset so the bench parks
   in STANDBY. */
function updateBenchInstruments(d){
  if(benchParts.analyzer)     drawAnalyzerScreen(benchParts.analyzer, d);
  if(benchParts.dischargerig) drawRigScreen(benchParts.dischargerig, d);
  const lb = benchParts.loadbank;
  if(lb){
    drawLoadScreen(lb, d);
    // Ceramic elements scorch then glow: the pale albedo darkens as it heats so
    // the orange self-emission actually reads instead of washing out.
    const hot = d ? Math.max(0, Math.min(1, d.hot || 0)) : 0;
    (lb.userData.glow || []).forEach(r=>{
      r.material.color.setHex(LAB.ceramic).lerp(new THREE.Color(0x5a2a12), hot*0.85);
      r.material.emissive.setRGB(hot*0.85, hot*0.13, 0);
      r.material.emissiveIntensity = 0.2 + hot*1.0;
    });
    if(lb.userData.fan) lb.userData.fan.userData.spin = 0.12 + hot*1.5;
  }
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
  // The pack is this lab's subject, so it is built from its own spec (cell count,
  // capacity, C-rating, size_mm) rather than loaded from the one generic FBX —
  // everywhere it appears: bench hero, input tile, picker, assembled drone,
  // reward card. onReady is deferred so callers that seat the model AFTER
  // positioning it (seatModel inside a mdl=>… callback) still behave like the
  // asynchronous GLB path.
  if(o && o.catKey === "battery"){
    const g = new THREE.Group();
    const pack = buildLipoPack(o);
    g.add(fitUnit(pack, span, o, "none"));
    g.userData.inner = pack;          // terminals are published in the pack's own local space
    if(onReady) Promise.resolve().then(()=>onReady(g));
    return g;
  }
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
   machined rather than painted.
   A PMREM texture belongs to the GL context that generated it, so the preview
   renderer and the main viewport each get their own — cached on the renderer. */
function ensureEnv(rnd){
  if(!rnd || !THREE.PMREMGenerator) return null;
  if(rnd.__envTex !== undefined) return rnd.__envTex;
  let ENV_TEX = null;
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
  rnd.__envTex = ENV_TEX;
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
  if(THREE.sRGBEncoding !== undefined) renderer.outputEncoding = THREE.sRGBEncoding;
  if(THREE.ACESFilmicToneMapping !== undefined){
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
  }
  host.appendChild(renderer.domElement);
  scene = new THREE.Scene();
  // Lamps are deliberately low: the PMREM environment below already supplies most
  // of the fill. At the old levels (0.62/0.9/0.4 with an env map on top) every
  // large pale surface — floor, walls, bench top — clipped to white and the room
  // vanished into the page background.
  scene.add(new THREE.AmbientLight(0xffffff,.30));
  const key = new THREE.DirectionalLight(0xffffff,.62); key.position.set(4,6,3); scene.add(key);
  const fill = new THREE.DirectionalLight(0xdde5f0,.24); fill.position.set(-4,2,-4); scene.add(fill);
  // No grid helper: the scene stands on the real lab floor built in buildLabRoom().
  // Same PMREM studio gradient the tile previews use: the pack's gloss wrap, the
  // alu heatsink and the plated terminals have nothing to reflect without it and
  // read as flat grey plastic in the main viewport.
  const env = ensureEnv(renderer);
  if(env) scene.environment = env;
  FX.init(scene);
  camera = new THREE.PerspectiveCamera(38, w/h, .1, 200);
  camera.position.set(2.55, 2.80, 3.20);   // framed on the apparatus, clear of the overlay panels
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0.26, 1.34, -0.02);
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
  buildLabRoom();                      // both scenes stand in the same lab bay
  if(isBench()) buildBenchRig(); else buildDrone();
  syncCamera();
  // idle state: the rig is wired and zeroed, waiting on Run
  renderProcedure(3, -1);
  attachCallouts();
  setStage(null);
}
/* Each scene gets its own framing on switch. The bench apparatus is ~2.5 units
   wide and wants a close, slightly high three-quarter view; the assembled drone
   is normalised to a 3.0-unit wheelbase and needs roughly twice the standoff or
   its propellers run off the bottom of the viewport. */
let _camMode = null;
function syncCamera(){
  if(!controls || !camera) return;
  const mode = isBench() ? "bench" : "flight";
  // Reframe only when the SCENE TYPE changes. buildScene() also runs on every
  // component swap, and snapping the camera back each time would yank the view
  // out from under anyone who had orbited in to look at something.
  if(mode === _camMode) return;
  _camMode = mode;
  const shot = mode === "bench"
    ? { pos:[2.55, 2.80, 3.20], tgt:[0.26, 1.34, -0.02] }    // bench: on the apparatus
    : { pos:[4.70, 3.45, 5.50], tgt:[0, 1.15, 0] };          // flight: whole airframe in frame
  controls.target.set(shot.tgt[0], shot.tgt[1], shot.tgt[2]);
  camera.position.set(shot.pos[0], shot.pos[1], shot.pos[2]);
  camera.lookAt(controls.target);
  controls.update();
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
/* ── the room ──────────────────────────────────────────────────────────────
   Both scenes stand in one place: an epoxy-floor lab bay with a back wall and a
   service rail. Without it the bench read as a display plinth floating in white
   — a model on a platform rather than apparatus in a laboratory. Built once and
   kept across scene rebuilds (it is not part of `rig`). */
let labRoom = null;
function buildLabRoom(){
  if(labRoom) return labRoom;
  const r = new THREE.Group();
  // vinyl tile floor — the joints give the room a scale the eye can read, which a
  // flat plane (or the old grid helper) never did
  const fc = document.createElement("canvas"); fc.width = fc.height = 128;
  const fx = fc.getContext("2d");
  fx.fillStyle = "#b3bcbb"; fx.fillRect(0,0,128,128);
  fx.fillStyle = "#a7b0af"; fx.fillRect(0,0,64,64); fx.fillRect(64,64,64,64);
  fx.strokeStyle = "#96a09f"; fx.lineWidth = 2;
  fx.beginPath(); fx.moveTo(64,0); fx.lineTo(64,128); fx.moveTo(0,64); fx.lineTo(128,64); fx.stroke();
  const fTex = new THREE.CanvasTexture(fc);
  fTex.wrapS = fTex.wrapT = THREE.RepeatWrapping; fTex.repeat.set(20, 20); fTex.anisotropy = 8;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30),
      mat(0xffffff, {roughness:0.72, metalness:0.04, map:fTex}));
  floor.rotation.x = -Math.PI/2; floor.position.y = -0.002; r.add(floor);
  // soft contact shadow under the apparatus — no shadow maps in this renderer, so
  // a painted radial gradient does the grounding instead (the bench read as if it
  // were floating without it).
  const sc = document.createElement("canvas"); sc.width = sc.height = 256;
  const sx = sc.getContext("2d");
  const grd = sx.createRadialGradient(128,128,10, 128,128,128);
  grd.addColorStop(0, "rgba(30,42,41,.34)"); grd.addColorStop(0.55, "rgba(30,42,41,.16)");
  grd.addColorStop(1, "rgba(30,42,41,0)");
  sx.fillStyle = grd; sx.fillRect(0,0,256,256);
  const shTex = new THREE.CanvasTexture(sc);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 3.6),
      new THREE.MeshBasicMaterial({ map:shTex, transparent:true, depthWrite:false, toneMapped:false }));
  shadow.rotation.x = -Math.PI/2; shadow.position.set(0, 0.004, 0.1); r.add(shadow);
  // shallow bay: back wall + one return wall, well behind the apparatus
  const wallM = mat(0xcdd6d3, {roughness:0.92, metalness:0.02});
  const back = new THREE.Mesh(new THREE.PlaneGeometry(30, 3.4), wallM);
  back.position.set(0, 1.7, -3.6); r.add(back);
  const side = new THREE.Mesh(new THREE.PlaneGeometry(12, 3.4), wallM);
  side.rotation.y = Math.PI/2; side.position.set(-5.6, 1.7, 0); r.add(side);
  // dado band + skirting: standard lab wall protection, and it anchors the eye
  const dado = new THREE.Mesh(new THREE.PlaneGeometry(30, 0.9),
      mat(0xb2bcb9, {roughness:0.9, metalness:0.02}));
  dado.position.set(0, 0.45, -3.59); r.add(dado);
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(30, 0.12, 0.04),
      mat(0x8f9a97, {roughness:0.7, metalness:0.1}));
  skirt.position.set(0, 0.06, -3.57); r.add(skirt);
  // bench service rail: trunking, sockets, ground stud
  const trunk = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.16, 0.10),
      mat(0xc9d0cd, {roughness:0.55, metalness:0.25}));
  trunk.position.set(-0.2, 1.62, -3.53); r.add(trunk);
  for(let i=0;i<6;i++){
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.12, 0.03),
        mat(0xf2f5f4, {roughness:0.5, metalness:0.1}));
    s.position.set(-2.9 + i*1.05, 1.62, -3.47); r.add(s);
    [-1,1].forEach(k=>{
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.011,0.011,0.02,10),
          mat(0x2b3036, {roughness:0.6}));
      p.rotation.x = Math.PI/2; p.position.set(-2.9 + i*1.05 + k*0.042, 1.63, -3.455); r.add(p);
    });
  }
  const gnd = new THREE.Mesh(new THREE.CylinderGeometry(0.018,0.018,0.06,12),
      mat(0xb8912a, {roughness:0.3, metalness:0.85}));
  gnd.rotation.x = Math.PI/2; gnd.position.set(2.9, 1.62, -3.46); r.add(gnd);
  labRoom = r; scene.add(r);
  return r;
}
/* Steel-frame workbench: legs, lower shelf, cross rails, laminate top with a
   matte ESD mat — the surface the apparatus is actually clamped to. */
function buildWorkbench(TOP){
  const t = new THREE.Group();
  const W = 3.2, D = 1.65, frame = mat(0x8e979d, {roughness:0.42, metalness:0.65});
  const topM = mat(0x262c33, {roughness:0.55, metalness:0.25});
  const worktop = new THREE.Mesh(new THREE.BoxGeometry(W, 0.07, D), topM);
  worktop.position.y = TOP - 0.035; t.add(worktop);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(W + 0.03, 0.025, D + 0.03),
      mat(0x6f7981, {roughness:0.4, metalness:0.6}));
  trim.position.y = TOP - 0.072; t.add(trim);
  // ESD mat, slightly inset, with a printed edge legend
  const mat_ = new THREE.Mesh(new THREE.BoxGeometry(W - 0.30, 0.006, D - 0.26),
      mat(0x1d3a3f, {roughness:0.88, metalness:0.03}));
  mat_.position.y = TOP + 0.004; t.add(mat_);
  const legend = decal((x,Wp,Hp)=>{
    x.fillStyle = "rgba(120,190,190,.85)"; x.textBaseline = "middle";
    x.font = "600 "+Math.round(Hp*0.62)+"px "+MONO;
    x.fillText("ESD PROTECTED AREA · BENCH 4 · ENERGY STORAGE", Wp*0.01, Hp*0.55);
  }, 1.55, 0.05, 1024, 32);
  legend.rotation.x = -Math.PI/2;
  legend.position.set(-0.72, TOP + 0.009, D/2 - 0.13); t.add(legend);
  const legX = W/2 - 0.16, legZ = D/2 - 0.16;
  [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([sx,sz])=>{
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.075, TOP - 0.09, 0.075), frame);
    leg.position.set(sx*legX, (TOP - 0.09)/2 + 0.02, sz*legZ); t.add(leg);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.03, 14),
        mat(0x22272c, {roughness:0.85, metalness:0.1}));
    foot.position.set(sx*legX, 0.015, sz*legZ); t.add(foot);
  });
  // lower shelf + cross rails
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(W - 0.24, 0.04, D - 0.24),
      mat(0x3a4149, {roughness:0.6, metalness:0.3}));
  shelf.position.y = 0.30; t.add(shelf);
  [-1,1].forEach(sz=>{
    const rail = new THREE.Mesh(new THREE.BoxGeometry(W - 0.24, 0.05, 0.05), frame);
    rail.position.set(0, TOP - 0.16, sz*legZ); t.add(rail);
  });
  // cable tray slung under the rear edge, with the supply drop to the rail
  const tray = new THREE.Mesh(new THREE.BoxGeometry(W - 0.6, 0.05, 0.14),
      mat(0x6f7981, {roughness:0.5, metalness:0.6}));
  tray.position.set(0, TOP - 0.22, -D/2 + 0.14); t.add(tray);
  return t;
}
function buildBenchRig(){
  const g = new THREE.Group();
  propGroups = [];
  const metric = currentExp().exp.metric;
  buildLabRoom();

  const TOP = 1.15;                                   // work-surface height
  /* Bench layout, in world units. The worktop is 3.9 × 1.95 and the ESD mat is
     inset to ±1.80 × ±0.845, so every part has to sit inside that and clear its
     neighbours. Real benches are laid out in two ranks: instruments along the back
     against the service rail, the device under test on the mat in front of them
     where the operator's hands go, cables running front-to-back between the two.
     Declared here, before placeBenchParts() is called, not after it. */
  // Everything sits SQUARE to the bench. Yawing each instrument a little toward
  // the camera read as scattered rather than arranged, and the rotated footprints
  // (a 1.2 × 0.74 box turned 0.14 rad is 1.29 × 0.90) ate the clearance that the
  // spacing depends on. Mat is ±1.45 × ±0.695 after the 3.2 × 1.65 worktop inset.
  const BACK_Z = -0.26;        // instrument rank, back edges flush to the mat
  const FRONT_Z = 0.42;        // device-under-test rank, in front of the analyzer
  const SEAT_Y  = 0.012;       // mat surface = worktop + mat thickness, so nothing sinks in
  g.add(buildWorkbench(TOP));
  // LiPo fire-safe tin at the far end of the bench — where a charged pack lives
  // between runs; the one prop that tells you which lab this is.
  const tin = rbox(0.52, 0.34, 0.20, 0.03, mat(0x8f5a2a, {roughness:0.55, metalness:0.45}));
  tin.position.set(-1.16, TOP + SEAT_Y, BACK_Z - 0.02); g.add(tin);
  const lid = rbox(0.54, 0.36, 0.03, 0.02, mat(0x7b4d24, {roughness:0.55, metalness:0.45}));
  lid.position.set(-1.16, TOP + SEAT_Y + 0.20, BACK_Z - 0.02); g.add(lid);
  const tinLab = decal((x,Wp,Hp)=>{
    x.fillStyle = "rgba(20,22,24,.9)"; x.fillRect(0,0,Wp,Hp);
    x.fillStyle = "#e6cf7a"; x.textBaseline = "middle";
    x.font = "700 "+Math.round(Hp*0.46)+"px "+MONO;
    x.fillText("LiPo SAFE", Wp*0.05, Hp*0.38);
    x.font = "500 "+Math.round(Hp*0.30)+"px "+MONO;
    x.fillText("CHARGE · STORE · TRANSPORT", Wp*0.05, Hp*0.76);
  }, 0.34, 0.12, 384, 128);
  tinLab.position.set(-1.16, TOP + SEAT_Y + 0.11, BACK_Z + 0.151); g.add(tinLab);
  benchGroup = g; scene.add(g);
  rig = g;
  placeBenchParts(TOP);

  /* Silicone test lead between two REAL terminals (world space).
     The old version drew a tube between two guessed points and dipped its middle
     0.28 below the line, which put most of every cable underneath the worktop —
     that is why the wiring read as invisible. This routes like a real lead: out
     of the terminal, a relaxed catenary that stays above the mat, and into the
     far terminal, with heat-shrink boots at both ends so it visibly terminates. */
  /* A lead is 12 AWG silicone, not a hose. Three things were wrong before:
     the radius (0.026) was nearly twice an XT60 shell, so it read as plumbing;
     the colours were mid-tones that the PMREM environment washed out to pink;
     and the route arced UP and over the instrument face instead of dropping to
     the mat and running in front of it, which is where a real lead lies.
     `bow` pushes the slack toward the operator so the cable never crosses a
     panel it is supposed to plug into. */
  function cable(from, to, colr, bow){
    const grp = new THREE.Group();
    // Dark silicone under a full-strength PMREM environment reflects almost white
    // and reads as pale pink plastic — the reason these looked like hoses rather
    // than wire. Dial the environment contribution down for the leads.
    const matM = mat(colr, { roughness:0.62, metalness:0.0 });
    matM.envMapIntensity = 0.22;
    const a = from.clone(), b = to.clone();
    const matY = TOP + SEAT_Y;
    const R = 0.013;                                     // ≈ 12 AWG at bench scale
    const rest = matY + R + 0.004;                       // where slack lies on the mat
    const outward = bow == null ? 0.10 : bow;            // toward +Z = toward the operator
    // drop out of each terminal, run across the mat, rise into the far terminal
    const dropA = a.clone(); dropA.y = Math.max(rest, a.y - 0.05); dropA.z += outward*0.35;
    const dropB = b.clone(); dropB.y = Math.max(rest, b.y - 0.05); dropB.z += outward*0.35;
    const mid = dropA.clone().lerp(dropB, 0.5); mid.y = rest; mid.z += outward;
    const curve = new THREE.CatmullRomCurve3(
      [a, dropA, dropA.clone().lerp(mid, 0.55), mid, dropB.clone().lerp(mid, 0.55), dropB, b], false, "catmullrom", 0.4);
    grp.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 64, R, 10, false), matM));
    [a, b].forEach(end=>{                                // heat-shrink boot at the post
      const bootM = mat(0x121417, {roughness:0.7, metalness:0.05});
      bootM.envMapIntensity = 0.22;
      const boot = new THREE.Mesh(new THREE.CylinderGeometry(R*1.45, R*1.15, 0.028, 10), bootM);
      boot.position.copy(end); grp.add(boot);
    });
    grp.userData.benchPart = true;
    return grp;
  }
  /* world position of a published terminal on a seated bench part */
  function term(model, key){
    if(model && model.userData && model.userData.inner) model = model.userData.inner;
    const t = model && model.userData && model.userData.terminals;
    if(!t || !t[key]) return null;
    model.updateWorldMatrix(true, false);
    return model.localToWorld(new THREE.Vector3(t[key][0], t[key][1], t[key][2]));
  }

  function placeBenchParts(topY){
    for(let k=g.children.length-1;k>=0;k--){ if(g.children[k].userData.benchPart) g.remove(g.children[k]); }
    topY += SEAT_Y;
    const ba = opt("battery");
    // Pack scale: a 5200 mAh 4S is about 150 mm long and a bench analyzer is about
    // 200 mm wide, so the pack must read SMALLER than the instrument beside it.
    // The old 0.013/mm made a big pack 1.9 units — wider than the analyzer and
    // hanging over the front edge of the bench.
    const baMm = ba && ba.size ? Math.max.apply(null, ba.size) : 90;
    const baSpan = Math.max(0.70, Math.min(baMm*0.0072, 1.10));

    // Pack under test — front rank, square to the bench, label toward the operator
    const battery = modelFor(ba, baSpan, mdl => seatModel(mdl, "base"));
    battery.position.set(-0.34, topY, FRONT_Z);
    battery.rotation.y = 0.24;                  // label toward the default camera
    battery.userData.benchPart = true;
    g.add(battery);
    benchParts.battery = battery; FX.setEmitter("bench_battery", battery, "battery");

    // Instruments are procedural (buildPowerAnalyzer / buildLoadBank /
    // buildDischargeRig) and carry live displays, so keep a reference to the
    // BUILT group — fitUnit wraps it, and userData.screen lives on the inner one.
    const seatInstrument = (model, span, x, z, yaw)=>{
      const fitted = fitUnit(model, span, null);
      fitted.position.set(x, topY, z);
      fitted.rotation.y = yaw || 0;
      fitted.userData.benchPart = true;
      seatModel(fitted, "base");
      g.add(fitted);
      return model;
    };

    // Square to the bench. The instruments' back edges line up on BACK_Z and the
    // pack sits in front of the analyzer it feeds, so the signal chain reads
    // left-to-right: pack → analyzer (measures) → load bank (sinks).
    if(metric === "soc"){
      benchParts.dischargerig = seatInstrument(buildDischargeRig(), 1.24, 0.46, BACK_Z, 0);
    }else{
      benchParts.analyzer = seatInstrument(buildPowerAnalyzer(), 1.16, -0.14, BACK_Z, 0);
      benchParts.loadbank = seatInstrument(buildLoadBank(), 0.86, 0.98, BACK_Z + 0.03, 0);
    }

    // Wiring is drawn AFTER everything is seated, from the parts' own published
    // terminals, so each lead starts and ends on a real post. The pack seats on a
    // microtask (modelFor defers its onReady), so this has to run after that or
    // every lead lands where the pack USED to be.
    Promise.resolve().then(()=>{
    if(!benchGroup || benchGroup !== g) return;          // scene was rebuilt underneath us
    scene.updateMatrixWorld(true);
    const pk = benchParts.battery;
    const wire = (from, to, colr, bow)=>{ if(from && to) g.add(cable(from, to, colr, bow)); };
    if(metric === "soc"){
      const rg = benchParts.dischargerig;
      wire(term(pk,"pos"), term(rg,"inPos"), LAB.red, 0.13);
      wire(term(pk,"neg"), term(rg,"inNeg"), LAB.black, 0.19);
      wire(term(pk,"balance"), term(rg,"balance"), 0xb9c0c7, 0.25);
    }else{
      const an = benchParts.analyzer, lb = benchParts.loadbank;
      wire(term(pk,"pos"), term(an,"inPos"), LAB.red, 0.14);   // pack + → analyzer shunt
      wire(term(pk,"neg"), term(an,"inNeg"), LAB.black, 0.20);
      wire(term(an,"outPos"), term(lb,"inPos"), LAB.red, 0.09);   // analyzer → load bank
      wire(term(an,"outNeg"), term(lb,"inNeg"), LAB.black, 0.15);
    }
    });
    updateBenchInstruments(null);
  }
}

/* ════════════ 8c · PROCEDURE, STAGE CAPTION, 3-D CALLOUTS ════════════
   What was missing was not physics but legibility: a run played out as numbers
   moving with no statement of what the operator was doing or which instrument
   produced which reading. Three layers fix that, all driven from the same sim
   state as the charts:
     · PROCEDURE — the numbered steps of the real bench protocol, ticked off live
     · STAGE     — one sentence naming what the rig is doing this instant, and why
     · CALLOUTS  — labels pinned to the actual pack / analyzer / load bank / rig,
                   each showing the quantity that piece of apparatus measures */
const PROCEDURE = {
  load: { title:"PROCEDURE · PACK UNDER LOAD", steps:[
    "Pack on the ESD mat, XT60 into the analyzer input",
    "Analyzer output into the load bank, Kelvin sense on the pack terminals",
    "Zero the shunt, record open-circuit voltage, arm the load",
    "Ramp the load 0 → 100 % of four-motor demand (8 s)",
    "Read peak draw vs capacity × C_cont, and volts/cell vs the 3.30 V floor" ]},
  soc: { title:"PROCEDURE · SoC DISCHARGE MAPPING", steps:[
    "Pack onto the rig, balance lead into the port",
    "Set the constant-current bench load",
    "Discharge, logging cell volts against coulombs out",
    "Watch the 20 % gauge cut-off arm",
    "Compare gauge SoC with true Peukert-derated SoC" ]},
  endurance: { title:"PROCEDURE · ENDURANCE FLIGHT", steps:[
    "Fit the pack to the airframe, check AUW and T/W",
    "Pre-flight: arm and confirm hover current",
    "Climb to the commanded altitude",
    "Hold the hover until the SoC cut-off",
    "Land and read flight time against capacity" ]}
};
function renderProcedure(done, active){
  const box = $("procList"); if(!box) return;
  const p = PROCEDURE[currentExp().exp.metric] || PROCEDURE.load;
  // the card already says "Procedure", so the title field carries only the subject
  const t = $("procTitle");
  if(t) t.textContent = "· " + p.title.replace(/^PROCEDURE · /, "").toLowerCase();
  box.innerHTML = "";
  p.steps.forEach((s,i)=>{
    const li = el("li", i < done ? "done" : (i === active ? "now" : ""));
    li.textContent = s;
    box.appendChild(li);
  });
}
function setStage(text, cls, tag){
  const box = $("vpStage");
  // the stage chip is mirrored onto the Procedure card, so the current step is
  // visible next to the step list even when the viewport is scrolled away
  const chip = $("procStage");
  if(chip){
    chip.hidden = !text;
    chip.textContent = tag || "RUNNING";
    chip.className = "proc-stage mono" + (cls ? " "+cls : "");
  }
  if(!box) return;
  if(!text){ box.hidden = true; return; }
  box.hidden = false;
  box.className = "vp-stage" + (cls ? " "+cls : "");
  $("stageTag").textContent = tag || "RUNNING";
  $("stageTxt").textContent = text;
}
/* Screen-space labels pinned to real objects in the scene. Anchors are the same
   groups the physics drives, so a callout can never point at the wrong part. */
const Callouts = (function(){
  const items = new Map();
  function clear(){
    const host = $("vpCallouts"); if(host) host.innerHTML = "";
    items.clear();
  }
  function add(id, obj, off, title){
    const host = $("vpCallouts"); if(!host || !obj) return;
    const e = el("div","callout");
    e.innerHTML = '<b></b><span></span><em></em>';
    e.querySelector("b").textContent = title;
    host.appendChild(e);
    items.set(id, { obj, off: off || [0,0,0], e });
  }
  function set(id, val, sub, cls){
    const it = items.get(id); if(!it) return;
    it.e.querySelector("span").textContent = val || "";
    it.e.querySelector("em").textContent = sub || "";
    it.e.className = "callout" + (cls ? " "+cls : "");
  }
  const _v = new THREE.Vector3();
  function tick(){
    if(!items.size || !camera || !renderer) return;
    const host = $("vpCallouts"); if(!host) return;
    const w = host.clientWidth, h = host.clientHeight;
    items.forEach(it=>{
      it.obj.getWorldPosition(_v);
      _v.x += it.off[0]; _v.y += it.off[1]; _v.z += it.off[2];
      _v.project(camera);
      const behind = _v.z > 1;
      it.e.style.opacity = behind ? 0 : 1;
      if(behind) return;
      it.e.style.left = ((_v.x*0.5 + 0.5) * w).toFixed(1) + "px";
      it.e.style.top  = ((-_v.y*0.5 + 0.5) * h).toFixed(1) + "px";
    });
  }
  return { clear, add, set, tick, get size(){ return items.size; } };
})();
/* Rebuild the callout set for whatever scene was just constructed. */
function attachCallouts(){
  Callouts.clear();
  const metric = currentExp().exp.metric;
  if(isBench()){
    if(benchParts.battery) Callouts.add("pack", benchParts.battery, [-0.34,0.26,0.10], "PACK UNDER TEST");
    if(benchParts.analyzer) Callouts.add("meter", benchParts.analyzer, [-0.30,0.74,0], "POWER ANALYZER");
    if(benchParts.loadbank) Callouts.add("load", benchParts.loadbank, [0.26,0.52,0], "RESISTIVE LOAD BANK");
    if(benchParts.dischargerig) Callouts.add("rig", benchParts.dischargerig, [0.24,0.66,0], "DISCHARGE RIG");
  }else if(rig){
    Callouts.add("air", rig, [0,0.55,0], "AIRFRAME + PACK");
  }
  paintIdleCallouts(metric);
}
/* Standing values before a run: what each instrument WILL measure. */
function paintIdleCallouts(){
  const c = calc(), p = c.p;
  const contA = (p.cap/1000)*p.cRatingCont;
  Callouts.set("pack", p.cells+"S · "+p.cap+" mAh", (p.cells*4.2).toFixed(1)+" V full · "+p.cRatingCont+"C cont.");
  Callouts.set("meter", "0.0 A · 0 W", "limit "+contA.toFixed(0)+" A continuous");
  Callouts.set("load", "idle", "sinks the four-motor demand");
  Callouts.set("rig", "idle", "constant-current + balance tap");
  Callouts.set("air", c.mkg.toFixed(2)+" kg AUW", "T/W "+c.tw.toFixed(2)+" · hover "+c.hoverPct.toFixed(0)+"% throttle");
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
  // maxTicksLimit: a 240-sample run otherwise prints a label per sample and the
  // time axis turns into a wall of rotated numbers
  const tick = { font:{ family:"'IBM Plex Mono'" }, maxTicksLimit:9 };
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
  // load: the merged Module-1 sweep reports BOTH quantities it is judged on —
  // current (against capacity × C_cont) and loaded pack voltage (against the
  // 3.30 V/cell floor). Different units, so they get their own axes.
  load:      { a:{label:"Pack current draw (A)", color:C_COL.orange}, b:{label:"Loaded pack voltage (V)", color:C_COL.blue} },
  endurance: { a:{label:"State of charge (%)", color:C_COL.green}, b:{label:"Pack voltage (V)", color:C_COL.slate}, xtime:true },
  soc:       { a:{label:"Cell voltage (V)", color:C_COL.blue}, customX:true }
};
function telemetryConfig(metric, data, data2, flightT, opts){
  opts = opts || {};
  const s = TEL_SERIES[metric] || TEL_SERIES.load, n = data.length;
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
/* ── LIVE GRAPHS ─────────────────────────────────────────────────────────────
   The Graphs card holds LINE plots only, four at a time, one grid per module —
   everything that is a curve against time (or against SoC) lives here, and every
   non-line visual (bars, doughnuts, the V–I scatter, the Sankey) lives in Charts.
   All four stream from the same arrays the run records, so they update together. */
function runSeries(){
  const { mod, exp } = currentExp(), key = mod.id+":"+exp.id;
  if(simActive && sim.data.length > 1)
    return { d1:sim.data, d2:sim.data2, d3:sim.data3, d4:sim.data4, dX:sim.dataX, flightT:sim.flightT||0, live:true };
  if(lastRun.key === key && lastRun.data && lastRun.data.length > 1)
    return { d1:lastRun.data, d2:lastRun.data2, d3:lastRun.data3||[], d4:lastRun.data4||[],
             dX:lastRun.dataX, flightT:lastRun.flightT, live:false };
  return null;
}
function lineCfg(labels, sets, xTitle, yTitle, extraScales){
  const tick = { font:{ family:"'IBM Plex Mono'", size:8 }, maxTicksLimit:6 };
  const scales = Object.assign({
    x:{ title:{display:false}, grid:{color:C_COL.grid}, ticks:tick },
    y:{ title:{display:false}, grid:{color:C_COL.grid}, ticks:tick }
  }, extraScales||{});
  return { type:"line", data:{ labels, datasets:sets },
    options:{ responsive:true, maintainAspectRatio:false, animation:false,
      interaction:{ mode:"index", intersect:false },
      plugins:{ legend:{display:false}, tooltip:{enabled:true,
        callbacks:{ title:it=>xTitle+" "+it[0].label } } },
      scales } };
}
const L = (label, data, color, dash, fill) => ({ label, data, borderColor:color, borderWidth:1.8,
  pointRadius:0, tension:.25, borderDash:dash||undefined,
  backgroundColor:color+"1c", fill:!!fill });
const flatLine = (n, v) => new Array(n).fill(v);
/* four line panels per module, each {lab, cfg} */
function livePanels(metric, S){
  const t = n => S.d1.map((_,i)=> +(i/Math.max(n-1,1)*8).toFixed(2));
  if(metric === "load"){
    const n = S.d1.length, cr = crateCalc(), p = propulsionParams();
    const xs = t(n);
    const vc = (S.d2||[]).map(v => +(v/p.cells).toFixed(3));
    const P  = S.d1.map((I,i)=> +((I*((S.d2||[])[i]||0))/1000).toFixed(3));
    let acc = 0; const mah = S.d1.map(I => { acc += I*(8/Math.max(n-1,1))/3.6; return +acc.toFixed(1); });
    return [
      { lab:"Current vs C-rating limits (A)", cfg:lineCfg(xs, [
          L("Pack current", S.d1.slice(), C_COL.orange, null, true),
          L("Continuous limit", flatLine(n, +cr.contA.toFixed(1)), C_COL.red, [5,4]),
          L("Burst limit", flatLine(n, +cr.burstA.toFixed(1)), C_COL.muted, [2,3]) ], "t =", "A") },
      { lab:"Volts per cell vs floors (V)", cfg:lineCfg(xs, [
          L("Loaded cell V", vc, C_COL.blue, null, true),
          L("3.50 V margin", flatLine(n, 3.50), C_COL.orange, [2,3]),
          L("3.30 V floor", flatLine(n, 3.30), C_COL.red, [5,4]) ], "t =", "V",
          { y:{ beginAtZero:false, suggestedMin:3.1, grid:{color:C_COL.grid},
                ticks:{ font:{family:"'IBM Plex Mono'",size:8}, maxTicksLimit:6 } } }) },
      { lab:"Power delivered (kW)", cfg:lineCfg(xs, [ L("Power", P, C_COL.green, null, true) ], "t =", "kW") },
      { lab:"Charge drawn (mAh)", cfg:lineCfg(xs, [ L("Drawn", mah, C_COL.slate, null, true) ], "t =", "mAh") }
    ];
  }
  if(metric === "soc"){
    const n = S.d1.length, xs = S.dX && S.dX.length ? S.dX.slice() : t(n);
    const idx = S.d1.map((_,i)=>i);
    return [
      { lab:"Cell voltage vs gauge SoC (V)", cfg:lineCfg(xs, [
          L("Loaded cell V", S.d1.slice(), C_COL.blue, null, true),
          L("3.50 V floor", flatLine(n, 3.50), C_COL.red, [5,4]) ], "SoC",
          "V", { y:{ beginAtZero:false, suggestedMin:3.2, grid:{color:C_COL.grid},
                     ticks:{ font:{family:"'IBM Plex Mono'",size:8}, maxTicksLimit:6 } } }) },
      { lab:"Gauge vs true SoC (%)", cfg:lineCfg(idx, [
          L("Gauge (nameplate)", (S.dX||[]).slice(), C_COL.orange),
          L("True (Peukert-derated)", (S.d2||[]).slice(), C_COL.green) ], "sample", "%") },
      { lab:"Charge removed (mAh)", cfg:lineCfg(idx, [ L("Drawn", (S.d3||[]).slice(), C_COL.slate, null, true) ], "sample", "mAh") },
      { lab:"Gauge error (points)", cfg:lineCfg(idx, [
          L("Gauge − true", (S.dX||[]).map((g,i)=> +(g - ((S.d2||[])[i]||0)).toFixed(2)), C_COL.red, null, true) ], "sample", "pts") }
    ];
  }
  if(metric === "endurance"){
    const n = S.d1.length, ft = S.flightT || 0;
    const xs = S.d1.map((_,i)=> +(i/Math.max(n-1,1)*ft).toFixed(0));
    return [
      { lab:"State of charge vs time (%)", cfg:lineCfg(xs, [ L("SoC", S.d1.slice(), C_COL.green, null, true) ], "t =", "%") },
      { lab:"Pack voltage vs time (V)", cfg:lineCfg(xs, [ L("Pack V", (S.d2||[]).slice(), C_COL.blue, null, true) ], "t =", "V",
          { y:{ beginAtZero:false, grid:{color:C_COL.grid}, ticks:{ font:{family:"'IBM Plex Mono'",size:8}, maxTicksLimit:6 } } }) },
      { lab:"Hover current vs time (A)", cfg:lineCfg(xs, [ L("Current", (S.d3||[]).slice(), C_COL.orange, null, true) ], "t =", "A") },
      { lab:"Altitude vs time (m)", cfg:lineCfg(xs, [ L("Altitude", (S.d4||[]).slice(), C_COL.slate, null, true) ], "t =", "m") }
    ];
  }
  return [];
}
function drawLiveGraph(){
  const { mod, exp } = currentExp(), metric = exp.metric;
  const cap = $("graphCaption");
  const S = runSeries();
  const cells = [1,2,3,4].map(i=>({ cv:$(i===1?"liveGraph":"liveGraph"+i), lab:$("ggLab"+i) }));
  if(!S){                                   // empty state — no run for this experiment yet
    cells.forEach((c,i)=>{
      ChartHub.kill(c.cv ? c.cv.id : "");
      if(c.lab) c.lab.textContent = "";
      if(c.cv && c.cv.parentElement) c.cv.parentElement.parentElement.hidden = i > 0;
      if(i === 0 && c.cv){
        const box = c.cv.parentElement;
        const w = Math.max(box.clientWidth-2, 40), h = Math.max(box.clientHeight-2, 40);
        c.cv.width = w; c.cv.height = h; c.cv.style.width = w+"px"; c.cv.style.height = h+"px";
        const g = c.cv.getContext("2d"); g.clearRect(0,0,w,h);
        g.fillStyle = "#a3b2ad"; g.font = "500 11px 'IBM Plex Mono', monospace"; g.textAlign = "center";
        g.fillText("no data — run "+exp.name, w/2, h/2);
      }
    });
    if(cap) cap.textContent = exp.name+" · waiting for first run…";
    return;
  }
  const panels = livePanels(metric, S);
  cells.forEach((c,i)=>{
    const pnl = panels[i];
    if(c.cv && c.cv.parentElement) c.cv.parentElement.parentElement.hidden = !pnl;
    if(!pnl){ ChartHub.kill(c.cv ? c.cv.id : ""); if(c.lab) c.lab.textContent = ""; return; }
    if(c.lab) c.lab.textContent = pnl.lab;
    const id = c.cv.id, ch = ChartHub.reg[id];
    // stream into the existing chart while recording, so the grid stays smooth
    if(S.live && ch && ch._sig === metric+"|"+i && ch.data.datasets.length === pnl.cfg.data.datasets.length){
      ch.data.labels = pnl.cfg.data.labels;
      pnl.cfg.data.datasets.forEach((d,k)=>{ ch.data.datasets[k].data = d.data; });
      ch.update("none");
    }else{
      const made = ChartHub.put(id, pnl.cfg);
      if(made) made._sig = metric+"|"+i;
    }
  });
  if(cap) cap.textContent = exp.name+" · "+panels.length+" live plots"+
    (metric==="endurance" && S.flightT ? " · flight "+fmtMMSS(S.flightT) : "")+
    (S.live ? " · recording…" : " · last run");
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
/* ── Run-derived charts for the merged Pack-Under-Load sweep ────────────────
   Everything above plots the CONFIGURATION. These four plot what the last run
   actually measured, which is the point of doing the run: the two limit tests
   against time, the power the load bank sank, and the pack's internal
   resistance recovered by least-squares from the V-versus-I locus. */
/* The charts panel is global, so the Pack-Under-Load plots have to survive the
   operator switching to another experiment. lastRun only keeps the MOST RECENT
   run of any kind, so the load sweep is cached separately when it finishes. */
let lastLoadRun = null;
function loadRunSeries(){
  const live = simActive && sim.exp && sim.exp.metric === "load" && sim.data.length > 1;
  if(live) return { I:sim.data, V:sim.data2 };
  if(lastRun.metric === "load" && lastRun.data && lastRun.data.length > 1)
    return { I:lastRun.data, V:lastRun.data2 };
  if(lastLoadRun && lastLoadRun.I.length > 1) return lastLoadRun;
  return null;
}
/* Placeholder for a run chart with no data yet. It stays type:"line" on purpose:
   plotIsLine() reads the built config, so a bar placeholder would file the chart
   under Charts until the first run and under Graphs afterwards. */
const NO_RUN = { type:"line", data:{ labels:["no run yet"], datasets:[{ data:[0], borderColor:C_COL.grid, pointRadius:0 }] },
  options: baseXY("", {y:""}, {plugins:{legend:{display:false},
    tooltip:{enabled:false}, title:{display:true, text:"Run Pack Under Load to plot this"}}}) };

function cfgRunCurrent(){
  const r = loadRunSeries(); if(!r) return NO_RUN;
  const cr = crateCalc(), n = r.I.length;
  const t = r.I.map((_,i)=> +(i/Math.max(n-1,1)*8).toFixed(2));   // the ramp is 8 s
  const flat = v => t.map(()=>+v.toFixed(1));
  return { type:"line", data:{ labels:t, datasets:[
    { label:"Measured pack current (A)", data:r.I.slice(), borderColor:C_COL.orange,
      backgroundColor:C_COL.orange+"22", borderWidth:2, pointRadius:0, tension:.25, fill:true },
    { label:"Continuous limit — capacity × C_cont", data:flat(cr.contA), borderColor:C_COL.red,
      borderWidth:2, pointRadius:0, borderDash:[6,4] },
    { label:"Burst limit", data:flat(cr.burstA), borderColor:C_COL.muted,
      borderWidth:1.5, pointRadius:0, borderDash:[2,3] } ] },
    options: baseXY("Time into ramp (s)", {y:"Current (A)"}) };
}
function cfgRunCellV(){
  const r = loadRunSeries(); if(!r || !r.V) return NO_RUN;
  const p = propulsionParams(), n = r.V.length;
  const t = r.V.map((_,i)=> +(i/Math.max(n-1,1)*8).toFixed(2));
  const vc = r.V.map(v => +(v/p.cells).toFixed(3));
  const flat = v => t.map(()=>v);
  return { type:"line", data:{ labels:t, datasets:[
    { label:"Loaded cell voltage (V)", data:vc, borderColor:C_COL.blue,
      backgroundColor:C_COL.blue+"1c", borderWidth:2, pointRadius:0, tension:.25, fill:true },
    { label:"3.50 V — sag margin", data:flat(3.50), borderColor:C_COL.orange,
      borderWidth:1.5, pointRadius:0, borderDash:[2,3] },
    { label:"3.30 V — brownout floor", data:flat(3.30), borderColor:C_COL.red,
      borderWidth:2, pointRadius:0, borderDash:[6,4] } ] },
    options: baseXY("Time into ramp (s)", {y:"Volts per cell"},
      {scales:{ y:{ beginAtZero:false, suggestedMin:3.1, title:{display:true,text:"Volts per cell"},
        grid:{color:C_COL.grid} } }}) };
}
function cfgRunPower(){
  const r = loadRunSeries(); if(!r || !r.V) return NO_RUN;
  const n = r.I.length;
  const t = r.I.map((_,i)=> +(i/Math.max(n-1,1)*8).toFixed(2));
  const P = r.I.map((I,i)=> +((I*(r.V[i]||0))/1000).toFixed(3));
  return { type:"line", data:{ labels:t, datasets:[
    { label:"Power delivered by the pack (kW)", data:P, borderColor:C_COL.green,
      backgroundColor:C_COL.green+"22", borderWidth:2, pointRadius:0, tension:.25, fill:true } ] },
    options: baseXY("Time into ramp (s)", {y:"Power (kW)"}) };
}
/* Internal resistance recovered from the run: V = OCV − I·R_pack, so a
   least-squares fit of the measured V-versus-I locus returns −R_pack as its
   slope. Compared against the value the model was driven with. */
function cfgRunRint(){
  const r = loadRunSeries(); if(!r || !r.V) return NO_RUN;
  const p = propulsionParams();
  const pts = r.I.map((I,i)=>({x:+I.toFixed(2), y:+(r.V[i]||0).toFixed(3)})).filter(q=>q.x > 0.5);
  if(pts.length < 3) return NO_RUN;
  let sx=0, sy=0, sxx=0, sxy=0;
  pts.forEach(q=>{ sx+=q.x; sy+=q.y; sxx+=q.x*q.x; sxy+=q.x*q.y; });
  const n = pts.length, den = n*sxx - sx*sx;
  const slope = den ? (n*sxy - sx*sy)/den : 0, icept = (sy - slope*sx)/n;
  const xs = [pts[0].x, pts[pts.length-1].x];
  const fitR = Math.max(0, -slope), modelR = p.cells*cellIR(p, 1);
  return { type:"scatter", data:{ datasets:[
    { label:"Measured (I, V)", data:pts, borderColor:C_COL.blue, backgroundColor:C_COL.blue,
      pointRadius:2, showLine:false },
    { label:"Least-squares fit → R_pack "+(fitR*1000).toFixed(1)+" mΩ (model "+(modelR*1000).toFixed(1)+" mΩ)",
      data:xs.map(x=>({x, y:+(icept + slope*x).toFixed(3)})), borderColor:C_COL.red,
      borderWidth:2, pointRadius:0, showLine:true, borderDash:[6,4] } ] },
    options: baseXY("Pack current (A)", {y:"Loaded pack voltage (V)"},
      {scales:{ x:{ type:"linear", title:{display:true,text:"Pack current (A)"}, grid:{color:C_COL.grid} },
                y:{ beginAtZero:false, title:{display:true,text:"Loaded pack voltage (V)"}, grid:{color:C_COL.grid} } }}) };
}
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
function plotDefsAll(){
  return [
    // One registry; plotIsLine() routes each entry to Graphs (curves) or Charts
    // (bars / doughnuts / scatter / Sankey), so nothing has to be listed twice.
    { id:"mass",   title:"Mass distribution",                    cfg:()=>massChartConfig(false) },
    { id:"disch",  title:"Discharge curve — cell V vs SoC",       cfg:cfgDischargeCurve },
    { id:"sag",    title:"Voltage sag vs current",                cfg:cfgSagChart },
    { id:"crate",  title:"C-rate margin",                         cfg:cfgCrateMargin },
    { id:"runR",   title:"Run · R_internal from V–I fit",         cfg:cfgRunRint },
    { id:"peuk",   title:"Peukert reality-check",                 cfg:cfgPeukertCheck },
    { id:"endur",  title:"Endurance vs capacity",                 cfg:cfgEnduranceCapacity,
      note:()=>{ const ec = enduranceCalc(), bad = ec.rows.filter(r=>r.deficit).map(r=>Math.round(r.capMah)+" mAh");
        return bad.length
          ? "Not plotted — "+bad.join(", ")+": at that pack mass thrust can't even beat weight, so it can't hover at all."
          : "Sub-linear return: a heavier pack needs more hover thrust just to carry itself, so endurance grows slower than raw capacity — doubling capacity does not double flight time."; } },
    { id:"gauge",  title:"SoC gauge — true vs voltage-estimated", cfg:cfgSocGauge },
    { id:"sank",   title:"Energy flow · stored to usable to waste", dom:renderEnergySankeyDOM },
    { id:"cellv",  title:"Per-cell voltage",                      cfg:cfgCellVoltageBars }
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
  if(def.dom){ wrap.style.height="auto"; def.dom(wrap); }
  else{ wrap.innerHTML = '<canvas id="gc_single"></canvas>'; }
  body.appendChild(wrap);
  if(def.cfg){ const c = def.cfg(); if(c) ChartHub.put("gc_single", c);
    else wrap.innerHTML = '<div class="runs-empty">'+txt(def.empty||"No data yet.")+'</div>'; }
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
  // every live panel from the Graphs card, full size, then the parameter sweeps
  const S = runSeries();
  const livePend = [];
  if(S){
    livePanels(exp.metric, S).forEach((pnl,i)=>{
      const blk = el("div","calc-block gchart");
      blk.innerHTML = '<div class="gchart-head"><h3>'+txt(pnl.lab)+'</h3></div>';
      const box = el("div","chart-box-lg");
      box.innerHTML = '<canvas id="gc_live'+i+'"></canvas>';
      blk.appendChild(box); wrap.appendChild(blk);
      livePend.push({ id:"gc_live"+i, cfg:pnl.cfg });
    });
  }else{
    const live = el("div","calc-block gchart");
    live.innerHTML = '<div class="gchart-head"><h3>Live run · '+txt(exp.name)+'</h3></div>';
    live.appendChild(el("div","runs-empty",
      "No data yet for <b>"+txt(exp.name)+"</b>.<br>Press <b>▶ Run Sim</b> to plot this experiment."));
    wrap.appendChild(live);
  }
  const pending = renderGraphBlocks(wrap, graphDefs().filter(d=>!d.empty));
  body.appendChild(wrap);
  livePend.forEach(p=>{
    const c = Object.assign({}, p.cfg);
    c.options = Object.assign({}, p.cfg.options, { plugins: Object.assign({}, p.cfg.options.plugins, { legend:{display:true, position:"bottom"} }) });
    ChartHub.put(p.id, c);
  });
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
  sim.t = 0; sim.data = []; sim.data2 = []; sim.dataX = []; sim.data3 = []; sim.data4 = []; sim.exp = exp; sim.mod = mod;
  sim.key = mod.id+":"+exp.id; sim.alt = 0; sim.vel = 0; sim.soc = 1; sim.socNaive = 1;
  sim.temp = T_AMB; sim.escTemp = T_AMB; sim.verdict = null; sim.verdictOk = null; sim.lastRpm = 0; sim.lastThr = 0;
  sim.overT = 0; sim.phase = "PREFLIGHT"; sim.ff = false;
  sim._pop = false; sim._popAt = 0; sim.batStress = 0; sim.mAh = 0; sim.cued = {};
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
      data3: downsample(sim.data3||[], 240), data4: downsample(sim.data4||[], 240),
      flightT: sim.exp.metric==="endurance" ? (sim.flightT||0) : 0 };
    // COMPLETION RULE: only a PASS verdict marks the experiment done. A fault
    // run (smoke, brownout, swell, over-discharge…) plays out fully and its
    // trace is kept in lastRun/Charts, but it does NOT tick the progress bar —
    // the operator must find a configuration that actually passes.
    if(sim.exp.metric === "load")                    // keep the sweep for its charts
      lastLoadRun = { I:lastRun.data.slice(), V:lastRun.data2.slice() };
    if(sim.verdictOk === true){
      state.done[sim.key] = true;
      saveState();
      renderModuleTabs(); renderExpTabs(); renderProgress();
      if(allDone()){ renderReward(); instrGo(DRONE_DB.instructor.length-1); sfx("unlock"); }
      else instrEvent("runDone");
    }
    sfx(sim.verdictOk ? "done" : "error");
    if(sim.verdict){ showVerdictToast(sim.verdict, sim.verdictOk); playFaultVoice(sim.verdict, sim.verdictOk); }
    // the protocol ran to its end — leave the verdict on screen under the steps
    renderProcedure(5, -1);
    setStage(sim.verdict || "Run complete.", sim.verdictOk ? "good" : "danger",
             sim.verdictOk ? "RESULT · PASS" : "RESULT · FAIL");
  }
  updateTelemetry({temp:sim.temp, esc:sim.escTemp, soc:sim.soc});
  drawLiveGraph();
}
function resetSim(){
  if(simActive) stopSim(false);
  sim.data = []; sim.data2 = []; sim.dataX = []; sim.temp = T_AMB; sim.escTemp = T_AMB; sim.soc = 1;
  sim.mAh = 0;
  $("ffBadge").hidden = true; syncRunControls();
  updateTelemetry({}); drawLiveGraph(); updateBenchInstruments(null);
  renderProcedure(3, -1); paintIdleCallouts(); setStage(null);
}
/* Show the throttle slider only where the operator actually drives it. The
   Endurance experiment (metric "endurance" — the real assembled-drone hover
   flight sim) is manual-only, no Auto-PID; the three bench experiments
   (load/soc) are fully procedural (ramp/discharge on their own). Called
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

  // ── battery stress → venting smoke: cells only actually overheat and vent
  //    once the draw pushes past the pack's BURST rating (the real damage
  //    threshold). Exceeding the *continuous* rating alone is a warning, not a
  //    vent — otherwise every pack smokes under a brief full-throttle pull.
  const contA  = (p.cap/1000) * p.cRatingCont;
  const burstA = (p.cap/1000) * p.cRating;
  sim.batStress = Math.max(
    smokeRamp(cc.full.Itot, burstA*0.92, burstA*1.30),
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

  if(metric === "load"){
    /* Pack Under Load — one ramp, both readings. The C-rating check and the
       voltage-sag check were separate experiments that ran the IDENTICAL
       procedure (ramp the load bank 0→100 % of the four-motor demand and watch
       the analyzer); only the axis you read and the limit you judge against
       differed. They are one experiment now: current against capacity × C_cont,
       and loaded volts-per-cell against the 3.30 V brownout floor, evaluated on
       the same sweep — which is also how it is actually done on a bench. */
    const d = Math.min(sim.t/8, 1);
    const r = solveQuad(d, 1);
    const capAh = p.cap/1000;
    const contA = capAh * p.cRatingCont, burstA = capAh * p.cRating;
    const vCell = r.V / p.cells;
    const Rp = p.cells*cellIR(p, sim.soc);
    sim.data.push(+r.Itot.toFixed(2));      // current — judged against contA
    sim.data2.push(+r.V.toFixed(3));        // loaded pack voltage — judged per cell
    sim.lastThr = r.Ttot;

    // ── fault accumulators, one per criterion, so either can end the run
    const overCont = r.Itot > contA;
    const brownout = vCell < 3.30;
    if(overCont) playEventVoice("over_cont");
    if(vCell < 3.45) playEventVoice("sag_floor");
    if(overCont) sim.overT += dt; else sim.overT = Math.max(0, sim.overT - dt*2);
    if(brownout) sim.sagT = (sim.sagT||0) + dt; else sim.sagT = Math.max(0, (sim.sagT||0) - dt*2);
    sim.lastRpm = brownout ? sim.lastRpm*Math.max(0, 1-sim.sagT/1.5) : r.rpm;

    // battery stress → venting smoke + swell/glow on the real pack model
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
    tel = { v:r.V, thrust:r.Ttot, rpm:sim.lastRpm, cur:r.Itot, pwr:r.P,
            temp:T_AMB+sim.batStress*70, alt:0,
            phase: brownout?"ESC BROWNOUT":overCont?"C-RATE EXCEEDED":d>=1?"FULL DRAW":"RAMPING",
            phaseCls: (brownout||overCont)?"danger":d>=1?"good":"" };
    updateTelemetry(tel);
    sim.mAh += r.Itot*dt/3.6;
    updateBenchInstruments({ V:r.V, I:r.Itot, P:r.P, mAh:sim.mAh, status:tel.phase, cls:tel.phaseCls,
      headroom:(contA - r.Itot)/contA, overCont, hot:Math.min(1, r.Itot/Math.max(contA,1)*0.85) });

    renderProcedure(d >= 1 ? 4 : 3, d >= 1 ? 4 : 3);
    Callouts.set("pack", vCell.toFixed(2)+" V/cell",
                 "open-circuit "+cellOCV(sim.soc).toFixed(2)+" V − I·R sag",
                 brownout ? "bad" : vCell < 3.5 ? "warn" : "");
    Callouts.set("meter", r.Itot.toFixed(0)+" A · "+r.V.toFixed(2)+" V",
                 "limit "+contA.toFixed(0)+" A cont. · R_int "+(Rp*1000).toFixed(1)+" mΩ",
                 overCont ? "bad" : "");
    Callouts.set("load", (r.P/1000).toFixed(2)+" kW", "sinking the four-motor demand",
                 overCont ? "warn" : "");
    setStage(brownout
      ? "Loaded voltage has fallen through 3.30 V per cell — the flight controller loses its rail here and the motors stop."
      : overCont
        ? "Draw is "+r.Itot.toFixed(0)+" A against a "+contA.toFixed(0)+" A continuous limit — the cells are heating. "+
          Math.max(0, 3 - sim.overT).toFixed(1)+" s of this and they vent."
        : d < 1
          ? "Ramping: "+(d*100).toFixed(0)+" % of full four-motor demand — "+r.Itot.toFixed(0)+" A of "+
            contA.toFixed(0)+" A allowed, holding "+vCell.toFixed(2)+" V/cell."
          : "Full draw "+r.Itot.toFixed(0)+" A at "+vCell.toFixed(2)+" V/cell. Internal resistance ("+
            (Rp*1000).toFixed(1)+" mΩ) is costing "+(r.Itot*Rp).toFixed(2)+" V.",
      (brownout||overCont) ? "danger" : d >= 1 ? "good" : "",
      d < 1 ? "STEP 4 · RAMP" : "STEP 5 · READ");

    if(sim.overT >= 3.0){
      sim.verdictOk = false;
      sim.verdict = "Battery vented — sustained "+r.Itot.toFixed(0)+" A draw exceeds the "+contA.toFixed(0)+
        " A continuous rating ("+p.cRatingCont+"C pack). Cells overheated and swelled.";
      FX.burstKind("battery", 5); sfx("error"); stopSim(true);
      return;
    }
    if(sim.sagT >= 1.5){
      sim.verdictOk = false;
      sim.verdict = "ESC brownout — loaded voltage sagged to "+vCell.toFixed(2)+
        " V/cell (below 3.30 V/cell); RPM collapsed under load.";
      sfx("error"); stopSim(true);
      return;
    }
    if(sim.t >= SIM_DURATION){
      // Both criteria are reported; the worse one decides the verdict.
      const headPct = Math.max(0,(contA-r.Itot)/contA*100);
      if(overCont){
        sim.verdictOk = false;
        sim.verdict = "Marginal — full-throttle draw "+r.Itot.toFixed(0)+" A exceeds the "+contA.toFixed(0)+
          " A continuous rating (holding "+vCell.toFixed(2)+" V/cell)";
      }else if(vCell < 3.5){
        sim.verdictOk = false;
        sim.verdict = "Excessive sag — "+vCell.toFixed(2)+" V/cell at full draw, little brownout margin left ("+
          (Rp*1000).toFixed(1)+" mΩ pack)";
      }else{
        sim.verdictOk = true;
        sim.verdict = "Within limits — "+r.Itot.toFixed(0)+" A of "+contA.toFixed(0)+" A continuous ("+
          headPct.toFixed(0)+"% headroom) and "+vCell.toFixed(2)+" V/cell at full draw (R_internal "+
          (Rp*1000).toFixed(1)+" mΩ)";
      }
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
    sim.data3.push(+sim.mAh.toFixed(1));          // coulombs out, for the capacity graph
    sim.dataX.push(+(sim.socNaive*100).toFixed(1));             // x-axis: naive SoC% readout on the rig display
    sim.data2.push(+(sim.soc*100).toFixed(1));
    sim.lastThr = 0; sim.lastRpm = 0;
    // The rig's auto-cut only WATCHES the coulomb-counted (naive, nameplate-
    // capacity) readout — no direct per-cell measurement, same as a cheap
    // real-world fuel gauge.
    //
    // The over-discharge test is made against the pack's RESTING state, not the
    // loaded terminal voltage. Under a 30 A bench load even a healthy cell sits
    // a couple of hundred millivolts below its open-circuit voltage, and that
    // sag recovers the moment the load is removed — judging it against the
    // 3.50 V resting floor condemned perfectly good high-C packs at 35 % SoC.
    // What actually damages cells is running the TRUE charge to empty, and the
    // failure this experiment exists to show is the counter not knowing that: a
    // Peukert-derated pack reaches true empty while the gauge still reads margin.
    const autoCutArmed = sim.socNaive <= SHUTDOWN_SOC;
    if(autoCutArmed) playEventVoice("autocut");
    const vCellRest = cellOCV(sim.soc);                 // recovered (open-circuit) cell voltage
    const overDischarged = sim.soc <= 0.02 && sim.socNaive > SHUTDOWN_SOC;
    // progressive puff as the TRUE charge runs out (loaded sag alone is not damage)
    const puffStress = smokeRamp(0.08 - sim.soc, 0, 0.08);
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
    sim.mAh += Iload*dt*scale/3.6;
    updateBenchInstruments({ V:vPackLoaded, I:Iload, P:vPackLoaded*Iload, mAh:sim.mAh,
      status:tel.phase, cls:tel.phaseCls, cells:p.cells, vcell:vCellLoaded,
      soc:sim.socNaive, running:true, cut:autoCutArmed, fault:overDischarged,
      hot:Math.min(1, Iload/Math.max((p.cap/1000)*p.cRatingCont, 1)) });
    const gap = (sim.socNaive - sim.soc)*100;
    renderProcedure(autoCutArmed ? 4 : 3, autoCutArmed ? 4 : 3);
    Callouts.set("pack", vCellLoaded.toFixed(2)+" V/cell loaded",
                 "rests at "+vCellRest.toFixed(2)+" V · "+sim.mAh.toFixed(0)+" of "+p.cap+" mAh out",
                 overDischarged ? "bad" : sim.soc < 0.15 ? "warn" : "");
    Callouts.set("rig", Iload.toFixed(1)+" A constant",
                 "gauge "+(sim.socNaive*100).toFixed(0)+" % · true "+(sim.soc*100).toFixed(0)+" %",
                 overDischarged ? "bad" : gap > 8 ? "warn" : "");
    setStage(overDischarged
      ? "The pack is empty — resting cell voltage "+vCellRest.toFixed(2)+" V — while the gauge still reads "+
        (sim.socNaive*100).toFixed(0)+" %. This pack delivers less than its nameplate at load, so the counter has been lying."
      : autoCutArmed
        ? "Gauge hit the 20 % floor and the rig cut the load. Cells recover to "+vCellRest.toFixed(2)+
          " V off-load — protected."
        : "Constant "+Iload.toFixed(1)+" A draw (bench clock compressed "+scale+"×). Gauge counts against the "+
          "nameplate "+p.cap+" mAh; the pack really holds "+(effCapAh*1000).toFixed(0)+
          " mAh at this rate — a "+gap.toFixed(0)+" point gap so far.",
      overDischarged ? "danger" : autoCutArmed ? "good" : "",
      autoCutArmed ? "STEP 5 · COMPARE" : "STEP 3 · DISCHARGE");
    if(overDischarged){
      sim.verdictOk = false;
      sim.verdict = "Cell over-discharged — the pack ran truly empty (resting "+vCellRest.toFixed(2)+
        " V/cell) while the nameplate coulomb count still showed "+(sim.socNaive*100).toFixed(0)+
        "% remaining (Peukert-derated pack, "+p.cRatingCont+"C). Cell puffed — permanent damage.";
      FX.burstKind("battery", 5); sfx("error"); stopSim(true);
      return;
    }
    if(autoCutArmed){
      sim.verdictOk = true;
      sim.verdict = "Auto-cut protected the pack — stopped at "+(sim.socNaive*100).toFixed(0)+
        "% gauge SoC with "+(sim.soc*100).toFixed(0)+"% true charge left (resting "+vCellRest.toFixed(2)+
        " V/cell), before the pack could be run flat.";
      stopSim(true);
      return;
    }
    if(sim.t >= SIM_DURATION){
      // ran the full window without reaching either floor (very large / lightly loaded pack)
      sim.verdictOk = true;
      sim.verdict = "Discharge mapped safely — the pack never approached the 20% gauge cut-off or true empty in this run.";
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
  sim.data3.push(+op.Itot.toFixed(2));         // pack current (A)
  sim.data4.push(+sim.alt.toFixed(2));         // altitude (m)

  // display phase text — cutPwr/overheat/low-battery override the raw phase
  let phaseText, phaseCls;
  if(overheat){ phaseText = "OVERHEAT!"; phaseCls = "danger"; }
  else if(sim.soc*100 <= ALERT_SOC*100){ phaseText = "LOW BATTERY"; phaseCls = "warn"; }
  else{ phaseText = sim.alt>LAUNCH_ALT+0.01 ? "FLIGHT" : "MANUAL"; phaseCls = sim.alt>LAUNCH_ALT+0.01 ? "good" : ""; }
  tel = { v:op.V, thrust:finalT*4, rpm:op.rpm, cur:op.Itot, pwr:op.P, temp:sim.temp, esc:sim.escTemp, soc:sim.soc, alt:sim.alt,
          phase: phaseText+" · "+fmtMMSS(sim.flightT), phaseCls };
  updateTelemetry(tel);
  // ── flight-side procedure / caption / callout, same contract as the bench
  const cmdAlt = LAUNCH_ALT + (4-LAUNCH_ALT)*((state.manualThrottle||0)/100);
  const climbing = sim.alt < cmdAlt - 0.05;
  renderProcedure(climbing ? 2 : 3, climbing ? 2 : 3);
  Callouts.set("air", op.Itot.toFixed(0)+" A · "+(sim.soc*100).toFixed(0)+" % SoC",
    cc.mkg.toFixed(2)+" kg AUW · "+sim.alt.toFixed(1)+" m · "+fmtMMSS(sim.flightT),
    overheat ? "bad" : sim.soc*100 <= ALERT_SOC*100 ? "warn" : "");
  setStage(overheat
    ? "Windings and controller are past their thermal limit — sustained hover current is heating them faster than they can shed it."
    : climbing
      ? "Climbing to the commanded altitude on "+op.Itot.toFixed(0)+" A. Every gram of pack has to be lifted by that current."
      : "Holding hover at "+op.Itot.toFixed(0)+" A, "+(sim.soc*100).toFixed(0)+
        " % remaining after "+fmtMMSS(sim.flightT)+". Flight time ends at the "+Math.round(SHUTDOWN_SOC*100)+" % cut-off.",
    overheat ? "danger" : sim.soc*100 <= ALERT_SOC*100 ? "" : "good",
    climbing ? "STEP 3 · CLIMB" : "STEP 4 · HOVER");

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
/* Voice-over set for THIS lab, generated by audio_gen/gen_energy_lab.py (Emma,
   edge-tts). Every clip is written against a state this bench can actually
   reach: one intro per experiment, three in-run event cues fired at the moment
   the physics changes, and one verdict line per verdict string simStep emits. */
const VOICE_FILES = {
  crate_marginal:"assets/audio/voice/v_crate_marginal.mp3",
  crate_vent:"assets/audio/voice/v_crate_vent.mp3",
  load_pass:"assets/audio/voice/v_load_pass.mp3",
  sag_excessive:"assets/audio/voice/v_sag_excessive.mp3",
  sag_brownout:"assets/audio/voice/v_sag_brownout.mp3",
  soc_autocut:"assets/audio/voice/v_soc_autocut.mp3",
  soc_mapped:"assets/audio/voice/v_soc_mapped.mp3",
  soc_overdischarge:"assets/audio/voice/v_soc_overdischarge.mp3",
  end_pass:"assets/audio/voice/v_end_pass.mp3",
  end_underpowered:"assets/audio/voice/v_end_underpowered.mp3",
  end_nohover:"assets/audio/voice/v_end_nohover.mp3",
  end_depleted:"assets/audio/voice/v_end_depleted.mp3",
  end_burnout:"assets/audio/voice/v_end_burnout.mp3",
  motor_stall:"assets/audio/voice/v_motor_stall.mp3",
  esc_overvolt:"assets/audio/voice/v_esc_overvolt.mp3"
};
const INTRO_FILES = {
  "m1:load":"assets/audio/voice/intro_load.mp3",
  "m2:endurance":"assets/audio/voice/intro_endurance.mp3",
  "m2:soc":"assets/audio/voice/intro_soc.mp3"
};
/* In-run cues. Each fires ONCE per run (sim.cued guards it) at the instant its
   condition first becomes true, so the narration explains the event the operator
   is watching rather than talking over the whole run. */
const EVENT_FILES = {
  over_cont:"assets/audio/voice/ev_over_cont.mp3",
  sag_floor:"assets/audio/voice/ev_sag_floor.mp3",
  autocut:"assets/audio/voice/ev_autocut.mp3"
};
function playEventVoice(tag){
  if(!sim.cued) sim.cued = {};
  if(sim.cued[tag] || !EVENT_FILES[tag]) return;
  sim.cued[tag] = true;
  playVoiceFile(EVENT_FILES[tag]);
}
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
/* Verdict → clip. Matched on the leading phrase of the verdict strings simStep
   emits, so every outcome this lab can produce has its own spoken explanation. */
function playFaultVoice(text, ok){
  const t = (text||"").toLowerCase();
  let tag = null;
  if(t.includes("within limits"))                 tag = "load_pass";
  else if(t.includes("marginal"))                 tag = "crate_marginal";
  else if(t.includes("vented"))                   tag = "crate_vent";
  else if(t.includes("excessive sag"))            tag = "sag_excessive";
  else if(t.includes("brownout"))                 tag = "sag_brownout";
  else if(t.includes("auto-cut protected"))       tag = "soc_autocut";
  else if(t.includes("mapped safely"))            tag = "soc_mapped";
  else if(t.includes("over-discharged"))          tag = "soc_overdischarge";
  else if(t.includes("endurance verified"))       tag = "end_pass";
  else if(t.includes("underpowered"))             tag = "end_underpowered";
  else if(t.includes("cannot hover"))             tag = "end_nohover";
  else if(t.includes("depleted mid-air"))         tag = "end_depleted";
  else if(t.includes("burned out"))               tag = "end_burnout";
  else if(t.includes("motor stalled"))            tag = "motor_stall";
  else if(t.includes("esc burnt")||t.includes("over-voltage")) tag = "esc_overvolt";
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
      // bench-mounted (battery-analyzer / discharge rig): no vertical motion,
      // faint vibration while the current draw is high
      let sx=0, sz=0;
      if(simActive && sim.exp.metric==="load"){
        const amp = Math.min((sim.data[sim.data.length-1]||0)/40*.006, .02);
        sx=(Math.random()-.5)*amp; sz=(Math.random()-.5)*amp;
      }
      rig.position.set(sx,0,sz);
      // load-bank extractor fan — idles, spools up with dissipated power
      const lb = benchParts.loadbank;
      if(lb && lb.userData.fan){
        const idle = simActive ? 0.12 : 0.03;
        lb.userData.fan.rotation.y += Math.max(idle, lb.userData.fan.userData.spin || 0);
      }
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
  Callouts.tick();                    // keep the pinned labels on their apparatus
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
