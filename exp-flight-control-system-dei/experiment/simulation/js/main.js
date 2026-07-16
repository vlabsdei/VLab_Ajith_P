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
const LS_KEY = "fcl-v1";
const FC_DEFAULT = {
  cmd:20, kp:0.6, ki:0, kd:0.04, dist:false,
  znGain:1, znMethod:"classic", znKu:0, znPu:0,
  air:0, wind:0, imu:"mpu6000", alpha:0.98,
  controller:"manual", estimator:"comp", escFault:false
};
const state = {
  sel:{}, altitude:0, module:"m1", exp:{},
  done:{}, voiceVol:80, sfxVol:60, instrStep:0,
  simRunning:false, instrOpen:true, manualThrottle:0,
  fc: Object.assign({}, FC_DEFAULT)
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
  state.fc = Object.assign({}, FC_DEFAULT, s.fc || {});
}
function saveState(){
  try{
    localStorage.setItem(LS_KEY, JSON.stringify({
      sel:state.sel, altitude:state.altitude, module:state.module, exp:state.exp,
      done:state.done,
      voiceVol:state.voiceVol, sfxVol:state.sfxVol,
      instrStep:state.instrStep, instrOpen:state.instrOpen,
      fc:state.fc
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
function calcMotorPoint(duty, V, Rm, Resc){
  const p = propulsionParams();
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
/* full quad at throttle d + state-of-charge soc (0..1), incl. pack sag under 4-motor draw */
function solveQuad(d, soc){
  const p = propulsionParams();
  const s = soc==null?1:soc;
  const rIR = cellIR(p, s), Rpack = p.cells*rIR;
  let V = cellOCV(s)*p.cells, r = calcMotorPoint(d, V, motorRm(p,20), p.rdsOn);
  for(let k=0;k<6;k++){
    V = Math.max(cellOCV(s)*p.cells - 4*r.I*Rpack, p.cells*2.8);
    r = calcMotorPoint(d, V, motorRm(p,20), p.rdsOn);
  }
  return { rpm:r.rpm, omega:r.omega, Tper:r.T, Ttot:4*r.T, Iper:r.I, Itot:4*r.I,
           V, P:V*4*r.I, Pmech:4*r.Pmech, Q:r.Q, stalled:r.stalled };
}
/* single motor on the bench (1 motor draws from the pack); tempC = winding temp for Rm */
function solveBench(d, soc, tempC){
  const p = propulsionParams();
  const s = soc==null?1:soc;
  const rIR = cellIR(p, s), Rpack = p.cells*rIR;
  const Rm = motorRm(p, tempC==null?20:tempC);
  let V = cellOCV(s)*p.cells, r = calcMotorPoint(d, V, Rm, p.rdsOn);
  for(let k=0;k<6;k++){
    V = Math.max(cellOCV(s)*p.cells - r.I*Rpack, p.cells*2.8);
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

/* ════════════ 5 · DIAGNOSTICS / LOG ════════════ */
function propGeometry(){
  const ch = opt("chasis"), pr = opt("propeller");
  const wb = (ch && ch.phys && ch.phys.wheelbase_mm) || 220;
  const diaMm = ((pr && pr.phys && pr.phys.diameter_in) || 5) * 25.4;
  const adjacent = wb/2 * Math.SQRT2;   // spacing between adjacent motor centres (X-config)
  const clearance = adjacent - diaMm;   // >0 gap, <0 overlap
  return { wbMm: wb, propDiaMm: diaMm, adjacentMm: adjacent, clearanceMm: clearance, collide: clearance < 0 };
}
/* Flight-control diagnostics — stability of the current tab's loop.
   Same shape as before: { items:[{sev,msg,fix,block}], errors, warns, blocked } */
function diagnostics(){
  const items = [];
  const exp = currentExp().exp.id;
  const r = rollInertia();
  if(r.J <= 0){
    items.push({ sev:"err", block:true, tag:"no-inertia",
      msg:"No airframe inertia — select an airframe so J = m·L²/2 is defined.",
      fix:"Pick an Airframe in Input Parameters." });
  }
  if(exp==="pid"){
    const s = pidStepSim({});
    if(s.diverged) items.push({ sev:"err", tag:"unstable",
      msg:"Loop is unstable — the response diverges at K_p="+state.fc.kp.toFixed(2)+", K_d="+state.fc.kd.toFixed(3)+"; the drone would flip.",
      fix:"Add derivative damping K_d or lower K_p / K_i." });
    else if(s.met.zeta < 0.2) items.push({ sev:"warn",
      msg:"Very lightly damped (ζ="+s.met.zeta.toFixed(2)+") — heavy ringing and overshoot "+s.osSim.toFixed(0)+"%.",
      fix:"Raise K_d to add damping." });
    else if(s.osSim > 25) items.push({ sev:"warn",
      msg:"Overshoot "+s.osSim.toFixed(0)+"% exceeds the 25% comfort limit.",
      fix:"Lower K_p or raise K_d to calm the response." });
    if(state.fc.dist && Math.abs(s.essDeg) > 0.3 && state.fc.ki <= 0.001)
      items.push({ sev:"warn", tag:"droop",
        msg:"Steady-state droop of "+s.essDeg.toFixed(2)+"° under the disturbance — proportional control cannot null it.",
        fix:"Raise K_i above zero to drive the error to exactly 0°." });
  } else if(exp==="zn"){
    const sw = znSweepResponse(state.fc.znGain||1);
    if(sw.diverged) items.push({ sev:"err", tag:"zn-diverge",
      msg:"Sweep gain above K_u — the rate loop is diverging.",
      fix:"Back the sweep gain off to the sustained-oscillation point." });
    else if(sw.sustained) items.push({ sev:"ok",
      msg:"Sustained oscillation reached — K_u and P_u are latched.", fix:"Click Auto-tune to read the PID gains." });
    const zn = znUltimate(), g = znGains(state.fc.znMethod, zn.Ku, zn.Pu);
    const rl = rateLoopStep(g.kp,g.ki,g.kd,{});
    if(rl.os > 40 && state.fc.znMethod==="classic")
      items.push({ sev:"warn", msg:"Classic Z-N overshoots "+rl.os.toFixed(0)+"% — intentionally aggressive.",
        fix:"Switch to Tyreus-Luyben, or add air resistance for free damping." });
  } else if(exp==="fusion"){
    const tr = fusionTradeoff();
    if(state.fc.alpha >= 0.999) items.push({ sev:"warn", tag:"drift",
      msg:"Pure gyro integration (α→1) drifts without bound — ~"+(imu().bias*30).toFixed(0)+"° over 30 s.",
      fix:"Lower α so the accelerometer bounds the drift." });
    else if(Math.abs(state.fc.alpha - tr.bestAlpha) < 0.006)
      items.push({ sev:"ok", msg:"α = "+state.fc.alpha.toFixed(3)+" minimises the combined error ("+tr.bestTotal.toFixed(3)+"°).", fix:"" });
  } else if(exp==="full"){
    const r2 = fullSystemSim(state.fc.controller, state.fc.estimator, {escFault:state.fc.escFault});
    if(state.fc.estimator==="gyro") items.push({ sev:"warn", tag:"gyro-est",
      msg:"Gyro-only estimator — the controller chases a drifting phantom; tracking RMS "+r2.trackRMS.toFixed(2)+"°.",
      fix:"Use the complementary estimator to bound the error." });
    if(state.fc.escFault) items.push({ sev:"warn", tag:"esc-off",
      msg:"Uncalibrated-ESC actuation offset — the integral term must trim it out.",
      fix:"Calibrate the ESC dead-band, or rely on strong integral action." });
  }
  const errors = items.filter(i=>i.sev==="err").length;
  const warns = items.filter(i=>i.sev==="warn").length;
  const blocked = items.some(i=>i.block);
  if(!items.length) items.push({ sev:"ok", msg:"Loop is stable — gains, damping and estimator are within limits.", fix:"" });
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
let benchParts = { motor: null, esc: null };
function sceneModeType(){ return currentExp().exp.type || "assembly"; }   // assembly | bench | flight
function isBench(){ return sceneModeType() === "bench"; }

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
  const assembled = !!state.done["m1:assemble"];
  DRONE_DB.modules.forEach(m=>{
    const locked = m.id !== "m1" && !assembled;
    const b = el("button", m.id===state.module ? "active" : ""); b.type = "button";
    b.disabled = locked;
    b.innerHTML = (locked?"🔒 ":"")+txt(m.label)+' <small>· '+txt(m.sub)+'</small>';
    b.title = locked ? "Complete the Assembly Check in Module 1 first" : "";
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
  const assembled = !!state.done["m1:assemble"];
  m.experiments.forEach(e=>{
    const key = m.id+":"+e.id;
    const locked = m.id !== "m1" && e.id !== "assemble" && !assembled;
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
  const exp = currentExp().exp.id;
  const r = rollInertia();
  let chips = [{ k:"Roll inertia J", v:r.J.toFixed(4)+" kg·m²", cls:"" }];
  if(exp==="pid"){
    const s = pidStepSim({});
    chips.push({ k:"ω_n", v:s.met.wn.toFixed(1)+" rad/s", cls:"" });
    chips.push({ k:"Damping ζ", v:s.met.zeta.toFixed(3), cls:s.met.zeta>=0.4&&s.met.zeta<=0.9?"good":s.met.zeta<0.3?"warn":"" });
    chips.push({ k:"Overshoot", v:s.osSim.toFixed(1)+" %", cls:s.osSim<=25?"good":"warn" });
    chips.push({ k:"Settling t_s", v:s.tsSim.toFixed(2)+" s", cls:"" });
    if(state.fc.dist) chips.push({ k:"Steady-state e_ss", v:s.essDeg.toFixed(2)+"°", cls:Math.abs(s.essDeg)<0.2?"good":"warn" });
  } else if(exp==="zn"){
    const zn = znUltimate(), g = znGains(state.fc.znMethod, zn.Ku, zn.Pu);
    const rl = rateLoopStep(g.kp,g.ki,g.kd,{});
    chips.push({ k:"Ultimate K_u", v:zn.Ku.toFixed(2), cls:"" });
    chips.push({ k:"Ultimate P_u", v:(zn.Pu*1000).toFixed(1)+" ms", cls:"" });
    chips.push({ k:state.fc.znMethod==="tyreus"?"Tyreus K_p":"Classic K_p", v:g.kp.toFixed(2), cls:"" });
    chips.push({ k:"Overshoot", v:rl.os.toFixed(0)+" %", cls:rl.os<=25?"good":"warn" });
    chips.push({ k:"Air drag b", v:dragCoeff().toFixed(4), cls:"" });
  } else if(exp==="fusion"){
    const mm = alphaMetrics(state.fc.alpha), tr = fusionTradeoff(), im = imu();
    chips.push({ k:"IMU", v:im.name, cls:"" });
    chips.push({ k:"τ_f", v:mm.tf.toFixed(3)+" s", cls:"" });
    chips.push({ k:"Drift", v:mm.drift.toFixed(3)+"°", cls:"" });
    chips.push({ k:"Noise RMS", v:mm.noise.toFixed(3)+"°", cls:"" });
    chips.push({ k:"Total error", v:mm.total.toFixed(3)+"°", cls:Math.abs(state.fc.alpha-tr.bestAlpha)<0.006?"good":"" });
  } else {
    const r2 = fullSystemSim(state.fc.controller, state.fc.estimator, {escFault:state.fc.escFault});
    chips.push({ k:"Score", v:String(r2.score), cls:r2.score>=90?"good":r2.score<65?"warn":"" });
    chips.push({ k:"Tracking RMS", v:r2.trackRMS.toFixed(2)+"°", cls:r2.trackRMS<0.5?"good":"warn" });
    chips.push({ k:"Estimator RMS", v:r2.estRMS.toFixed(2)+"°", cls:r2.estRMS<0.3?"good":"" });
    chips.push({ k:"Overshoot", v:r2.os.toFixed(0)+" %", cls:r2.os<=25?"good":"warn" });
  }
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
function setTel(id, v){ const e=$(id); if(e) e.textContent=v; }
function updateTelemetry(t){
  t = t || {};
  setTel("telRoll", (t.roll!=null?t.roll:0).toFixed(1)+"°");
  setTel("telCmd",  (t.cmd!=null?t.cmd:state.fc.cmd).toFixed(1)+"°");
  setTel("telErr",  (t.err!=null?t.err:0).toFixed(1)+"°");
  setTel("telRate", Math.round(t.rate!=null?t.rate:0)+" °/s");
  setTel("telWn",   t.wn!=null ? t.wn.toFixed(1)+" rad/s" : "— rad/s");
  setTel("telZeta", t.zeta!=null ? t.zeta.toFixed(3) : "—");
  setTel("telOS",   t.os!=null ? t.os.toFixed(1)+" %" : "— %");
  setTel("telTs",   t.ts!=null ? t.ts.toFixed(2)+" s" : "— s");
  const ph = $("telPhase");
  if(ph){ ph.textContent = t.phase || "STANDBY";
    ph.className = "tel-phase mono"+(t.phaseCls?" "+t.phaseCls:""); }
}
function refreshAfterSelection(key){
  refreshTile(key);
  renderMassMini(); renderInertia(); renderCalcChips(); renderLog(); updateFcNotes();
  clearLastRun(); drawMassChart(); drawLiveGraph();   // airframe changed → J changes → all curves refresh live
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
  alt:    { a:{label:"Altitude (m)", color:C_COL.green}, b:{label:"Total thrust (N)", color:C_COL.slate}, xtime:true }
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
  const { exp } = currentExp();
  const cap = $("graphCaption");
  const frac = simActive ? Math.min(sim.play/Math.max(sim.playDur,0.001),1) : null;
  const cfg = fcPrimaryCfg(true, frac);
  const c = ChartHub.put("liveGraph", cfg);
  if(c) c._metric = exp.id;
  if(cap){
    const st = simActive ? " · running…" : (state.done["m1:"+exp.id] ? " · verified ✓" : " · live preview");
    const capText = { pid:"PID step response · roll angle vs time",
      zn:(simActive?"Rate step · Classic vs Tyreus-Luyben":"Rate loop · proportional sweep"),
      fusion:"Sensor fusion · true / accel / gyro / fused",
      full:"Full system · true vs estimate vs command" }[exp.id];
    cap.textContent = capText + st;
  }
}
function drawMassChart(){ const c = ChartHub.put("massChart", fcSecondaryCfg(true)); if(c) c._metric = "fc2"; }
function massChartConfig(mini){ return fcSecondaryCfg(mini); }
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
/* registry of every analysis chart — drives both the gallery and single-chart view */
function chartDefs(){
  const exp = currentExp().exp.id;
  const znNote = ()=>{ const zn=znUltimate(); return "K_u = "+zn.Ku.toFixed(2)+" · P_u = "+(zn.Pu*1000).toFixed(1)+" ms · ω_u = "+zn.wu.toFixed(1)+" rad/s"; };
  const all = {
    pid: [
      { id:"step",  title:"PID step response — overshoot, rise & settling", cfg:()=>cfgPidStep(false), note:()=>{ const s=pidStepSim({}); return "ω_n = "+s.met.wn.toFixed(2)+" · ζ = "+s.met.zeta.toFixed(3)+" · overshoot "+s.osSim.toFixed(1)+"% · t_s "+s.tsSim.toFixed(2)+" s"; } },
      { id:"terms", title:"PID term contributions (P / I / D torque)", cfg:()=>cfgPidTerms(false) }
    ],
    zn: [
      { id:"sust",  title:"Sustained oscillation at the ultimate gain K_u", cfg:()=>cfgZNsustained(false), note:znNote },
      { id:"cmp",   title:"Closed-loop rate step — Classic vs Tyreus-Luyben", cfg:()=>cfgZNcompare(false) },
      { id:"sweep", title:"Proportional sweep response", cfg:()=>cfgZNsweep(false) }
    ],
    fusion: [
      { id:"series", title:"Sensor fusion — gyro drift + accel noise → fused", cfg:()=>cfgFusionSeries(false), note:()=>{ const s=fusionSim(); return "gyro drift ≈ "+s.driftAt8.toFixed(1)+"° at 8 s · accel σ = "+s.sig.toFixed(1)+"°"; } },
      { id:"trade",  title:"Drift vs noise trade-off — choosing α", cfg:()=>cfgFusionTradeoff(false), note:()=>{ const t=fusionTradeoff(); return "minimum total error at α = "+t.bestAlpha.toFixed(3)+" ("+t.bestTotal.toFixed(3)+"°)"; } }
    ],
    full: [
      { id:"resp",  title:"Closed loop on the estimate — true vs θ̂", cfg:()=>cfgFullResponse(false), note:()=>{ const r=fullSystemSim(state.fc.controller,state.fc.estimator,{escFault:state.fc.escFault}); return "score "+r.score+" · tracking RMS "+r.trackRMS.toFixed(2)+"° · estimator RMS "+r.estRMS.toFixed(2)+"°"; } },
      { id:"board", title:"Leaderboard — 9 controller × estimator systems", cfg:()=>cfgFullLeaderboard(false) }
    ]
  };
  return all[exp] || all.pid;
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
/* live graph detail — reached by clicking the Graphs card. Flight-control charts
   are always computed live from the current parameters (no recorded-run buffer),
   so the detail view just re-renders fcPrimaryCfg at full size, same as the mini
   card on the Outputs panel. */
function openGraphDetail(){
  const { exp } = currentExp();
  const body = openModal('Live Graph <em>· '+txt(exp.name)+'</em>', "#4f6d9e");
  const frac = simActive ? Math.min(sim.play/Math.max(sim.playDur,0.001),1) : null;
  const wrap = el("div"); wrap.style.cssText = "height:62vh;min-height:340px;position:relative";
  wrap.innerHTML = '<canvas id="gc_single"></canvas>'; body.appendChild(wrap);
  ChartHub.put("gc_single", fcPrimaryCfg(false, frac));
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
  const exp = currentExp().exp.id;
  const body = openModal('Charts <em>· '+txt(currentExp().exp.name)+' · click any chart to expand</em>', "#c65d3b");
  const wrap = el("div","calc-blocks");

  // metric summary tiles — control metrics for the active tab
  const r = rollInertia();
  const tiles = el("div","metric-tiles");
  const mt = (k,v,cls)=>'<div class="metric-tile"><span class="mk">'+k+'</span><span class="mv '+(cls||"")+'">'+v+'</span></div>';
  let tilesHtml = mt("Roll inertia J", r.J.toFixed(4)) + mt("Arm L", Math.round(r.armMm)+" mm");
  if(exp==="pid"){ const s=pidStepSim({});
    tilesHtml += mt("ω_n", s.met.wn.toFixed(1)) + mt("ζ", s.met.zeta.toFixed(3), s.met.zeta>=0.4?"good":"warn") +
      mt("Overshoot", s.osSim.toFixed(1)+"%", s.osSim<=25?"good":"warn") + mt("Settling", s.tsSim.toFixed(2)+" s");
  } else if(exp==="zn"){ const zn=znUltimate();
    tilesHtml += mt("K_u", zn.Ku.toFixed(2)) + mt("P_u", (zn.Pu*1000).toFixed(1)+" ms") + mt("Method", state.fc.znMethod);
  } else if(exp==="fusion"){ const t=fusionTradeoff();
    tilesHtml += mt("IMU", imu().name) + mt("Optimum α", t.bestAlpha.toFixed(3), "good") + mt("Min error", t.bestTotal.toFixed(3)+"°");
  } else { const r2=fullSystemSim(state.fc.controller,state.fc.estimator,{escFault:state.fc.escFault});
    tilesHtml += mt("Score", String(r2.score), r2.score>=90?"good":"warn") + mt("Tracking RMS", r2.trackRMS.toFixed(2)+"°") + mt("Estimator RMS", r2.estRMS.toFixed(2)+"°");
  }
  tiles.innerHTML = tilesHtml;
  wrap.appendChild(tiles);

  // gallery — one block per chart def; Chart.js charts get a sized chart-box,
  // DOM charts (circuit/Sankey) render inline; every block has an expand button.
  const pending = [];                              // {id,cfg} — instantiated AFTER wrap is in the DOM
  chartDefs().forEach(def=>{
    const block = el("div","calc-block gchart");
    const head = el("div","gchart-head");
    head.innerHTML = '<h3>'+txt(def.title)+'</h3><button type="button" class="gchart-expand" title="Expand">⤢</button>';
    head.querySelector("button").addEventListener("click", ()=>openSingleChart(def));
    block.appendChild(head);
    if(def.dom){                                   // circuit / Sankey — DOM
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
    "Every curve recomputes live from the assembled airframe's roll inertia J = m·L²/2 and the active tab's controls. "+
    "PID: closed-loop integration of the 1/(J s²) plant (derivative-on-measurement, anti-windup). "+
    "Ziegler-Nichols: 3rd-order rate loop with mechanical/actuator/sensor lags τ_m,τ_a,τ_s; Routh crossing gives K_u, P_u. "+
    "Fusion: complementary filter θ_est = α(θ_est+ω_gyro·Δt)+(1−α)θ_accel with the selected IMU's bias/noise. "+
    "Full system: the controller acts on the estimate θ̂, never the truth."));
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
  const body = openModal("Detailed Calculations <em>· flight control</em>", "#c65d3b");
  const r = rollInertia(), exp = currentExp().exp.id;
  const zn = znUltimate();
  const blocks = [
    { t:"1 · Roll-axis inertia (from the build)", b:"lumped X-quad: J = m·L²/2, effective L = 0.75·arm\nm = "+r.m.toFixed(3)+" kg,  arm = "+Math.round(r.armMm)+" mm  → L = "+(r.L*1000).toFixed(0)+" mm", r:"J = "+r.J.toFixed(4)+" kg·m²" }
  ];
  if(exp==="pid"){ const s = pidStepSim({});
    blocks.push({ t:"2 · Second-order prototype", b:"ω_n = √(K_p/J),  ζ = (K_d+b)/(2√(K_p·J))\nK_p = "+state.fc.kp.toFixed(2)+", K_d = "+state.fc.kd.toFixed(3), r:"ω_n = "+s.met.wn.toFixed(2)+" rad/s · ζ = "+s.met.zeta.toFixed(3) });
    blocks.push({ t:"3 · Step-response metrics", b:"M_p = 100·e^(−πζ/√(1−ζ²)),  t_s = 4/(ζω_n)\n(simulated on the real closed loop, so K_i reshapes them)", r:"overshoot "+s.osSim.toFixed(1)+"% · t_r "+s.met.tr.toFixed(3)+" s · t_s "+s.tsSim.toFixed(2)+" s" });
    blocks.push({ t:"4 · Steady-state error", b:state.fc.dist ? "τ_d = m·g·d = "+(r.m*G*CG_OFFSET_M).toFixed(4)+" N·m,  e_ss = τ_d/K_p (K_i=0)\nIntegral action drives e_ss → 0" : "enable the disturbance torque to expose the CG-offset droop", r:state.fc.dist ? "e_ss = "+s.essDeg.toFixed(2)+"°" : "—" });
  } else if(exp==="zn"){ const gc=znGains("classic",zn.Ku,zn.Pu), gt=znGains("tyreus",zn.Ku,zn.Pu);
    blocks.push({ t:"2 · Ultimate gain & period", b:"ω_u = √[(τ_m+τ_a+τ_s)/(τ_m·τ_a·τ_s)],  P_u = 2π/ω_u\nτ_m="+TAU_M+"s, τ_a="+TAU_A+"s, τ_s="+TAU_S+"s", r:"K_u = "+zn.Ku.toFixed(2)+" · P_u = "+(zn.Pu*1000).toFixed(1)+" ms" });
    blocks.push({ t:"3 · Classic Z-N table", b:"K_p=0.6K_u, T_i=0.5P_u, T_d=0.125P_u", r:"K_p "+gc.kp.toFixed(2)+" · K_i "+gc.ki.toFixed(0)+" · K_d "+gc.kd.toFixed(4) });
    blocks.push({ t:"4 · Tyreus-Luyben (robust)", b:"K_p=0.45K_u, T_i=2.2P_u, T_d=P_u/6.3", r:"K_p "+gt.kp.toFixed(2)+" · K_i "+gt.ki.toFixed(0)+" · K_d "+gt.kd.toFixed(4) });
    blocks.push({ t:"5 · Aerodynamic damping", b:"b = 0.0667·(air%/100)·(L/0.11)³·(ρ/1.225)\nζ_eff = (K_d+b)/(2√(K_p·J)) — drag is free damping", r:"b = "+dragCoeff().toFixed(4)+" N·m·s/rad" });
  } else if(exp==="fusion"){ const t=fusionTradeoff(), m=alphaMetrics(state.fc.alpha), im=imu();
    blocks.push({ t:"2 · Complementary filter", b:"θ_est = α(θ_est+ω_gyro·Δt) + (1−α)·θ_accel\nΔt = 1/"+im.hz+" Hz, bias = "+im.bias+"°/s, σ = "+im.sigma+"°", r:"τ_f = α·Δt/(1−α) = "+m.tf.toFixed(3)+" s" });
    blocks.push({ t:"3 · Drift / noise trade-off", b:"drift = bias·τ_f,  noise = σ·√((1−α)/(1+α))\ntotal minimised over α", r:"α = "+state.fc.alpha.toFixed(3)+" → total "+m.total.toFixed(3)+"° · optimum α = "+t.bestAlpha.toFixed(3) });
  } else { const r2=fullSystemSim(state.fc.controller,state.fc.estimator,{escFault:state.fc.escFault});
    blocks.push({ t:"2 · Closed loop on the estimate", b:"e = θ_cmd − θ̂   (never θ_cmd − θ)\ncontroller: "+FC_CONTROLLERS[state.fc.controller].name+" · estimator: "+FC_ESTIMATORS[state.fc.estimator], r:"score "+r2.score });
    blocks.push({ t:"3 · Scoring", b:"tracking RMS (true vs cmd) + estimator RMS (true vs est) + overshoot + settling + saturation", r:"track "+r2.trackRMS.toFixed(2)+"° · est "+r2.estRMS.toFixed(2)+"° · OS "+r2.os.toFixed(0)+"%" });
  }
  const wrap = el("div","calc-blocks");
  blocks.forEach(bl=>{ const d=el("div","calc-block");
    d.innerHTML = '<h3>'+bl.t+'</h3><pre>'+bl.b+'</pre><div class="res">'+bl.r+'</div>'; wrap.appendChild(d); });
  wrap.appendChild(el("p","calc-footnote","All values recompute live from the assembled airframe and the active tab's controls. g = 9.80665 m/s². Single roll-axis analysis; lumped inertia is an upper bound (real central mass lowers it)."));
  body.appendChild(wrap);
}

/* ════════════ 11 · SIMULATION RUNNER ════════════ */
const fmtMMSS = s => { s = Math.max(0, Math.floor(s)); const m = Math.floor(s/60), ss = s%60; return (m<10?"0":"")+m+":"+(ss<10?"0":"")+ss; };
let simActive = false;
const sim = { play:0, playDur:3, run:null, exp:null, mod:null, key:null,
              roll:0, est:null, lastRpm:0, lastThr:0, verdict:null, verdictOk:false,
              pass:false, unstable:false };
let calcCache = null, calcCacheAge = 0;
function calcCached(){
  if(!calcCache || (performance.now()-calcCacheAge) > 500){ calcCache = calc(); calcCacheAge = performance.now(); }
  return calcCache;
}
/* Build the run for the active tab: a roll/estimate time-series to play back on
   the drone + live graph, plus the pass/verdict logic. Completion needs ONE true
   (stable / optimal) case; fault cases play their real drone reaction but do not
   complete the tab, so the student must overcome them. */
function buildRun(){
  const exp = currentExp().exp.id;
  const cmd = state.fc.cmd;
  if(exp==="pid"){
    const s = pidStepSim({});
    const pass = !s.diverged && s.osSim <= 30;
    const verdict = s.diverged
      ? "Unstable loop — the drone flips; add K_d or lower K_p / K_i"
      : s.osSim > 30
        ? "Excessive overshoot — "+s.osSim.toFixed(0)+"% past the comfort limit; raise K_d"
        : "Stable attitude hold — overshoot "+s.osSim.toFixed(1)+"%, settling "+s.tsSim.toFixed(2)+" s"
          + (state.fc.dist ? (Math.abs(s.essDeg)<0.2 ? ", zero steady-state error" : ", droop "+s.essDeg.toFixed(2)+"°") : "");
    return { series:{ t:s.t, roll:s.th, est:null }, met:s.met, os:s.osSim, ts:s.tsSim,
             pass, verdict, unstable:s.diverged, playDur:Math.min(Math.max(s.T,2),4.5),
             phaseLive:f=>s.diverged&&f>0.4?"UNSTABLE":"TRACKING", phaseCls:s.diverged?"danger":"good" };
  }
  if(exp==="zn"){
    const zn = znUltimate(), g = znGains(state.fc.znMethod, zn.Ku, zn.Pu);
    const rl = rateLoopStep(g.kp,g.ki,g.kd,{});
    const roll = rl.y.map(v=>v*cmd);
    const latched = (state.fc.znKu||0) > 0;
    const pass = latched && !rl.diverged && rl.os <= 25;
    const verdict = !latched
      ? "Find K_u first — sweep the gain to sustained oscillation, then auto-tune"
      : rl.diverged ? "Diverging — the rate loop is unstable at these gains"
      : rl.os > 25 ? state.fc.znMethod.toUpperCase()+" overshoots "+rl.os.toFixed(0)+"% — retune Tyreus-Luyben or add air resistance"
      : "Robust tune — overshoot "+rl.os.toFixed(0)+"% under the 25% limit, zero steady-state error";
    return { series:{ t:rl.t, roll, est:null }, met:null, os:rl.os, ts:rl.ts,
             pass, verdict, unstable:rl.diverged, playDur:3,
             phaseLive:f=>rl.diverged&&f>0.4?"DIVERGING":"RATE STEP", phaseCls:rl.diverged?"danger":pass?"good":"warn" };
  }
  if(exp==="fusion"){
    const s = fusionSim(), tr = fusionTradeoff(), mm = alphaMetrics(state.fc.alpha);
    const pureGyro = state.fc.alpha >= 0.999;
    const pass = !pureGyro && mm.total <= tr.bestTotal*1.25;
    const verdict = pureGyro
      ? "Unbounded drift — pure gyro integration drifts ~"+(s.bias*30).toFixed(0)+"° over 30 s"
      : pass ? "Optimal fusion — α = "+state.fc.alpha.toFixed(3)+", total error "+mm.total.toFixed(3)+"°"
             : "Sub-optimal blend — total "+mm.total.toFixed(3)+"°; nudge α toward "+tr.bestAlpha.toFixed(3);
    return { series:{ t:s.t, roll:s.tru, est:s.fused }, met:null, os:null, ts:null,
             pass, verdict, unstable:false, playDur:4.5, gyroDrift:pureGyro?s.gyroOnly:null,
             phaseLive:f=>"FUSING", phaseCls:pass?"good":"warn" };
  }
  // full
  const r2 = fullSystemSim(state.fc.controller, state.fc.estimator, {escFault:state.fc.escFault});
  const pass = r2.score >= 85;
  const board = fullLeaderboard({escFault:state.fc.escFault});
  const isLeader = board[0].ck===state.fc.controller && board[0].ek===state.fc.estimator;
  const verdict = state.fc.estimator==="gyro"
    ? "Estimator drift — the controller chases a phantom; score "+r2.score+", tracking "+r2.trackRMS.toFixed(1)+"°"
    : pass ? (isLeader ? "Best flight control system — score "+r2.score : "Strong system — score "+r2.score+", tracking "+r2.trackRMS.toFixed(2)+"°")
           : "Weak system — score "+r2.score+"; try the complementary estimator";
  return { series:{ t:r2.t, roll:r2.tru, est:r2.est }, met:null, os:r2.os, ts:r2.ts,
           pass, verdict, unstable:false, playDur:4,
           phaseLive:f=>"CLOSED LOOP", phaseCls:pass?"good":"warn" };
}
function runSim(){
  if(simActive){ stopSim(false); return; }
  const dg = renderLog();
  if(dg.blocked){
    sfx("error");
    const lc = $("logCard"); if(lc) lc.animate([{transform:"translateX(0)"},{transform:"translateX(-4px)"},{transform:"translateX(4px)"},{transform:"translateX(0)"}], {duration:280});
    return;
  }
  const { mod, exp } = currentExp();
  const R = buildRun();
  simActive = true; state.simRunning = true;
  sim.exp = exp; sim.mod = mod; sim.key = mod.id+":"+exp.id;
  sim.run = R; sim.play = 0; sim.playDur = R.playDur; sim.roll = 0; sim.est = null;
  sim.verdict = null; sim.verdictOk = false; sim.pass = false; sim.unstable = false;
  syncRunControls();
  audioStart();
  $("runBtn").textContent = "■ Stop";
  $("runBtn").classList.add("running");
  $("telDot").classList.add("on");
  sfx("start"); instrEvent("run");
}
function stopSim(completed){
  simActive = false; state.simRunning = false;
  $("runBtn").textContent = "▶ Run";
  $("runBtn").classList.remove("running");
  $("telDot").classList.remove("on");
  audioStop();
  const badge = $("ffBadge"); if(badge) badge.hidden = true;
  if(completed && sim.run && sim.pass){
    state.done[sim.key] = true;
    saveState();
    renderModuleTabs(); renderExpTabs(); renderProgress();
    sfx("done");
    if(allDone()){ renderReward(); instrGo(DRONE_DB.instructor.length-1); sfx("unlock"); }
    else instrEvent("runDone");
  }
  if(completed && sim.run){
    showVerdictToast(sim.verdict, sim.verdictOk);
    playFaultVoice(sim.verdict, sim.verdictOk);
  }
  drawLiveGraph(); renderCalcChips();
}
function resetSim(){
  if(simActive) stopSim(false);
  sim.run = null; sim.roll = 0; sim.est = null; sim.unstable = false;
  updateTelemetry({}); drawLiveGraph(); syncRunControls();
}
/* Flight control has no throttle/flight-mode controls — hide the platform's
   bench widgets and keep the per-tab controls fresh on every switch. */
function syncRunControls(){
  const tw = $("throttleWrap"); if(tw) tw.hidden = true;
  renderInertia(); renderTabControls(); renderCalcChips();
}
function showVerdictToast(text, ok){
  const t = el("div","verdict "+(ok?"pass":"fail"));
  t.style.cssText = "position:fixed;left:50%;top:74px;transform:translateX(-50%);z-index:120;box-shadow:0 10px 30px rgba(20,40,40,.25);max-width:460px";
  const parts = text.split("—");
  t.innerHTML = '<span class="vic">'+(ok?"✓":"×")+'</span><div class="vtx"><b>'+txt(parts[0])+'</b><span>'+txt(parts.slice(1).join("—").trim())+'</span></div>';
  document.body.appendChild(t);
  setTimeout(()=>{ t.style.transition="opacity .5s"; t.style.opacity="0"; setTimeout(()=>t.remove(),500); }, 3800);
}
function simStep(dt){
  const R = sim.run; if(!R){ stopSim(false); return; }
  sim.play += dt;
  const frac = Math.min(sim.play/Math.max(sim.playDur,0.001), 1);
  const S = R.series, n = S.t.length;
  const idx = frac*(n-1), i0 = Math.floor(idx), i1 = Math.min(i0+1, n-1), fr = idx-i0;
  const lerp = a => a[i0] + (a[i1]-a[i0])*fr;
  const roll = lerp(S.roll);
  const est = S.est ? lerp(S.est) : null;
  sim.roll = roll; sim.est = est;
  sim.unstable = R.unstable && frac > 0.35;
  const rate = (S.roll[i1]-S.roll[i0]) / Math.max(S.t[i1]-S.t[i0], 1e-4);
  sim.lastRpm = Math.min(Math.abs(rate)*30 + 800, 9000); sim.lastThr = Math.abs(roll);
  updateTelemetry({ roll, cmd:state.fc.cmd, err:(S.est?state.fc.cmd - est:state.fc.cmd - roll), rate,
    wn:R.met?R.met.wn:null, zeta:R.met?R.met.zeta:null, os:R.os, ts:R.ts,
    phase:R.phaseLive(frac)+" · "+Math.round(frac*100)+"%", phaseCls:R.phaseCls });
  if(sim.unstable && Math.random()<0.15){ FX.burstKind("motor",2); }
  if(frac >= 1){
    sim.roll = S.roll[n-1]; sim.est = S.est ? S.est[n-1] : null;
    sim.verdict = R.verdict; sim.verdictOk = R.pass; sim.pass = R.pass;
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
  verdict_pass:"assets/audio/voice/verdict_pass.mp3",
  kp_trap:"assets/audio/voice/m1_kp_trap.mp3",
  ku_found:"assets/audio/voice/m2_ku_found.mp3",
  zn_applied:"assets/audio/voice/m2_zn_applied.mp3",
  optimum:"assets/audio/voice/m3_optimum.mp3",
  pure_gyro:"assets/audio/voice/m3_pure_gyro.mp3"
};
const INTRO_FILES = {
  "m1:pid":"assets/audio/voice/m1_intro.mp3",
  "m1:zn":"assets/audio/voice/m2_zn_intro.mp3",
  "m1:fusion":"assets/audio/voice/m3_intro.mp3",
  "m1:full":"assets/audio/voice/m4_intro.mp3"
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
  if(ok){
    if(t.includes("optimal fusion")) tag="optimum";
    else if(t.includes("robust tune")||t.includes("best flight")) tag="zn_applied";
    else tag="verdict_pass";
  } else {
    if(t.includes("drift")||t.includes("pure gyro")) tag="pure_gyro";
    else if(t.includes("overshoot")||t.includes("unstable")||t.includes("aggressive")) tag="kp_trap";
    else if(t.includes("k_u")||t.includes("ultimate")) tag="ku_found";
  }
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
function loop(t){
  requestAnimationFrame(loop);
  frameNo++;
  const dt = Math.min((t-lastT)/1000, .05) || .016;
  lastT = t;
  if(rig){
    hoverPhase += .02;
    // The assembled drone RESTS ON THE GROUND whenever the simulation is
    // idle, and only lifts to hover height while a run is active.
    let targetY;
    if(!simActive){
      // seat the drone's lowest point on the grid (world y = 0)
      const box = new THREE.Box3().setFromObject(rig);
      targetY = rig.position.y - box.min.y;
    }else{
      targetY = 1.15 + Math.sin(hoverPhase)*.03;
    }
    // smooth take-off / landing lerp
    const ny = rig.position.y + (targetY - rig.position.y) * (simActive?0.12:0.18);
    rig.position.set(0, ny, 0);
    // ── roll attitude: the drone banks to the live roll angle (deg → rad) ──
    const targetRoll = (simActive && sim.run) ? -(sim.roll||0)*RAD : 0;
    if(sim.unstable){ rig.rotation.z += 0.30; }               // fault: tumble / flip
    else { rig.rotation.z += (targetRoll - rig.rotation.z) * 0.28; }
    rig.rotation.x = 0;
    // props are stationary when the drone is landed / powered down
    const spin = simActive ? Math.min((sim.lastRpm||0)/3200, 3.4) + .15 : 0;
    propGroups.forEach((p,i)=>{
      const dir = p.userData.spinDir != null ? p.userData.spinDir : (i%2?1:-1);
      p.rotation.y += spin*dir;
    });
    // ── ghost drone showing the ESTIMATE θ̂ (Sensor Fusion / Full System) ──
    const expId = currentExp().exp.id;
    const showGhost = simActive && sim.est != null && (expId==="fusion" || expId==="full");
    if(showGhost){
      ensureGhost();
      if(ghostRig){
        ghostRig.position.copy(rig.position);
        const gTarget = -(sim.est||0)*RAD;
        ghostRig.rotation.z += (gTarget - ghostRig.rotation.z) * 0.28;
        ghostRig.rotation.x = 0;
      }
    } else removeGhost();
  }
  if(simActive){
    simStep(dt);
    audioUpdate();
    if(++graphEvery % 3 === 0) drawLiveGraph();
  }
  // fault reaction: an unstable / tumbling loop vents smoke from the motors
  FX.kindIntensity("motor",   sim.unstable ? 0.8 : 0);
  FX.kindIntensity("esc",     0);
  FX.kindIntensity("battery", 0);
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

/* ════════════════════════════════════════════════════════════════
   ═══════════  FLIGHT CONTROL SYSTEM ENGINE (Experiment 5)  ═══════════
   Research-grade attitude-control simulators layered on the shared
   platform. Four tabs, all driven by the roll-axis inertia J of the
   assembled airframe. Self-contained: no cross-experiment storage.
   ════════════════════════════════════════════════════════════════ */
const DEG = 180/Math.PI, RAD = Math.PI/180;
const CG_OFFSET_M = 0.00357;            // CG offset d (m) → disturbance couple τd = m·g·d

/* IMU catalogue — gyro bias (°/s), accel angle noise σ (°), sample rate (Hz) */
const IMU_PRESETS = {
  mpu6000:  { name:"MPU-6000",   bias:0.60, sigma:1.80, hz:400 },
  icm20602: { name:"ICM-20602",  bias:0.40, sigma:1.35, hz:400 },
  bmi270:   { name:"BMI270",     bias:0.28, sigma:1.10, hz:400 },
  mpu9250:  { name:"MPU-9250",   bias:0.85, sigma:2.20, hz:400 }
};
/* rate-loop first-order lags (s) — mechanical, actuator (motor+ESC), sensor/filter */
const TAU_M = 0.05, TAU_A = 0.02, TAU_S = 0.005;

/* seeded PRNG so noisy charts are stable between redraws (no flicker) */
function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function gaussPRNG(rng){ let u=0,v=0; while(!u)u=rng(); while(!v)v=rng(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }

/* ── roll-axis inertia from the assembled build ──────────────────────────────
   Effective roll arm = 0.75·(geometric arm) captures central battery/stack mass
   (radius-of-gyration correction), so the 5" reference lands on the documented
   L≈0.11 m, J≈0.003 kg·m². Lumped X-quad result J = m·L²/2.  */
function rollInertia(){
  const { total } = massRows();
  const m = Math.max(total/1000, 0.05);
  const ch = opt("chasis");
  const armMm = (ch && ch.phys && ch.phys.arm_length_mm) ||
                (((ch && ch.phys && ch.phys.wheelbase_mm) || 290)/2);
  const L = 0.75 * armMm/1000;
  const J = m * L * L / 2;
  return { J, L, m, armMm };
}
/* linear aerodynamic damping coefficient b (N·m·s/rad) from the air% control */
function dragCoeff(){
  const { L } = rollInertia();
  const airPct = state.fc.air || 0;
  return 0.0667 * (airPct/100) * Math.pow(L/0.11, 3) * (rhoNow()/1.225);
}
/* analytic 2nd-order metrics for the PD-on-inertia prototype (+ optional drag) */
function pidMetrics(J, kp, kd, b){
  b = b || 0;
  const wn = Math.sqrt(Math.max(kp,1e-9)/J);
  const zeta = (kd + b) / (2*Math.sqrt(Math.max(kp,1e-9)*J));
  let Mp = 0, tp = 0, tr = 0;
  if(zeta < 1){
    const wd = wn*Math.sqrt(1-zeta*zeta);
    Mp = 100*Math.exp(-Math.PI*zeta/Math.sqrt(1-zeta*zeta));
    tp = Math.PI/wd;
    tr = (Math.PI - Math.acos(zeta))/wd;
  }
  const ts = 4/Math.max(zeta*wn, 1e-6);
  return { wn, zeta, Mp, tp, tr, ts };
}

/* ── Tab 1: PID angle-loop step response on the real 1/(J s²) plant ──────────
   Full closed-loop integration (derivative-on-measurement, anti-windup) so Ki
   and the disturbance torque visibly reshape the curve. Returns time series in
   DEGREES plus the live P/I/D torque split, and detects divergence (fault).  */
function pidStepSim(o){
  o = o || {};
  const { J, m } = rollInertia();
  const kp = o.kp != null ? o.kp : state.fc.kp;
  const ki = o.ki != null ? o.ki : state.fc.ki;
  const kd = o.kd != null ? o.kd : state.fc.kd;
  const b  = o.b  != null ? o.b  : 0;
  const cmd = (o.cmdDeg != null ? o.cmdDeg : state.fc.cmd) * RAD;
  const tauD = o.dist ? m*G*CG_OFFSET_M : 0;
  const met = pidMetrics(J, kp, kd, b);
  const T = Math.min(Math.max(1.2, 5*met.ts), 6);
  const dt = 0.0004;
  const N = Math.floor(T/dt);
  const stride = Math.max(1, Math.floor(N/420));
  const t=[], th=[], Pc=[], Ic=[], Dc=[];
  let x=0, xd=0, integ=0, peak=0, diverged=false;
  const iClamp = 3*Math.abs(cmd || 1) + 5;
  for(let k=0;k<=N;k++){
    const e = cmd - x;
    integ += e*dt; if(integ>iClamp) integ=iClamp; else if(integ<-iClamp) integ=-iClamp;
    const P = kp*e, I = ki*integ, D = -kd*xd;
    const tau = P + I + D;
    const xdd = (tau - b*xd - tauD)/J;
    xd += xdd*dt; x += xd*dt;
    if(Math.abs(x) > 40*Math.abs(cmd||1)+50){ diverged=true; }
    peak = Math.max(peak, x);
    if(k % stride === 0 || k===N){
      t.push(+(k*dt).toFixed(4)); th.push(x*DEG);
      Pc.push(P); Ic.push(I); Dc.push(D);
    }
    if(diverged) break;
  }
  // simulated metrics (honest — reflect Ki & disturbance)
  const cmdDeg = cmd*DEG;
  const osSim = cmdDeg ? Math.max(0,(peak*DEG - cmdDeg)/cmdDeg*100) : 0;
  let ess = th.length ? (cmdDeg - th[th.length-1]) : 0;   // deg (droop)
  // settling: last index outside ±2% band
  let tsSim = 0; const band = 0.02*Math.abs(cmdDeg);
  for(let i=0;i<th.length;i++){ if(Math.abs(th[i]-cmdDeg) > band) tsSim = t[i]; }
  return { t, th, Pc, Ic, Dc, cmdDeg, met, osSim, tsSim, essDeg:ess, diverged, J, T };
}

/* ── Tab 2: Ziegler–Nichols on the inner rate loop ──────────────────────────*/
function znUltimate(){
  const tm=TAU_M, ta=TAU_A, ts=TAU_S;
  const wu = Math.sqrt((tm+ta+ts)/(tm*ta*ts));
  const Pu = 2*Math.PI/wu;
  const Ku = ((tm*ta + tm*ts + ta*ts)*(tm+ta+ts)/(tm*ta*ts) - 1);   // K (DC gain)=1
  return { wu, Pu, Ku };
}
function znGains(method, Ku, Pu){
  if(method === "tyreus"){
    const kp = 0.45*Ku, Ti = 2.2*Pu, Td = Pu/6.3;
    return { kp, ki:kp/Ti, kd:kp*Td, Ti, Td };
  }
  const kp = 0.6*Ku, Ti = 0.5*Pu, Td = 0.125*Pu;
  return { kp, ki:kp/Ti, kd:kp*Td, Ti, Td };
}
/* 3rd-order rate-loop closed-loop step under a PID controller (+ drag + wind) */
function rateLoopStep(kp, ki, kd, o){
  o = o || {};
  const air = o.air != null ? o.air : state.fc.air;
  const windA = (o.wind != null ? o.wind : state.fc.wind)/100 * 0.9;
  const bDrag = 0.0667*(air/100);                 // rate-loop drag (normalised plant)
  const T = o.T || 0.5, dt = 0.00005;
  const N = Math.floor(T/dt), stride = Math.max(1, Math.floor(N/500));
  const t=[], y=[]; let a=0,b=0,yy=0, integ=0, yprev=0, peak=0, diverged=false;
  const tdf = 0.004;                              // derivative filter τ
  let dfilt = 0;
  for(let k=0;k<=N;k++){
    const tt = k*dt;
    const e = 1 - yy;
    integ += e*dt;
    const ydot = (b - yy)/TAU_S;
    dfilt += (ydot - dfilt)*dt/tdf;
    let u = kp*e + ki*integ - kd*dfilt;
    const wind = windA * (0.6 + 0.4*Math.sin(2*Math.PI*0.8*tt));
    u = u - bDrag*yy + wind;
    a  += (u - a)/TAU_M*dt;
    b  += (a - b)/TAU_A*dt;
    yy += (b - yy)/TAU_S*dt;
    peak = Math.max(peak, yy);
    if(Math.abs(yy) > 12){ diverged=true; }
    if(k%stride===0 || k===N){ t.push(+tt.toFixed(5)); y.push(yy); }
    if(diverged) break;
  }
  let tsSim=0; for(let i=0;i<y.length;i++){ if(Math.abs(y[i]-1)>0.02) tsSim=t[i]; }
  return { t, y, os: Math.max(0,(peak-1)*100), ts:tsSim, diverged };
}
/* sustained-oscillation trace at K_p = K_u (ideal constant-amplitude sine) */
function znSustained(){
  const { wu, Pu } = znUltimate();
  const T = 6*Pu, dt = T/600, t=[], y=[];
  for(let k=0;k<=600;k++){ const tt=k*dt; t.push(+(tt*1000).toFixed(2)); y.push(Math.sin(wu*tt)); }
  return { t, y, Pu, wu };
}
/* P-only rate-loop response at the swept gain (damped → sustained → divergent) */
function znSweepResponse(gain){
  const { Ku } = znUltimate();
  const T = 0.5, dt = 0.00005, N=Math.floor(T/dt), stride=Math.max(1,Math.floor(N/500));
  const air = state.fc.air, bDrag = 0.0667*(air/100);
  const t=[], y=[]; let a=0,b=0,yy=0, diverged=false;
  for(let k=0;k<=N;k++){
    const tt=k*dt; const e = 1 - yy;
    let u = gain*e - bDrag*yy;
    a += (u-a)/TAU_M*dt; b += (a-b)/TAU_A*dt; yy += (b-yy)/TAU_S*dt;
    if(Math.abs(yy)>12) diverged=true;
    if(k%stride===0||k===N){ t.push(+tt.toFixed(5)); y.push(yy); }
    if(diverged) break;
  }
  // amplitude of last third → classify
  const tail = y.slice(Math.floor(y.length*0.6));
  const amp = tail.length ? (Math.max(...tail)-Math.min(...tail))/2 : 0;
  const near = Math.abs(gain-Ku)/Ku;
  const sustained = !diverged && near < 0.06 && amp > 0.15;
  return { t, y, amp, diverged, sustained, Ku };
}

/* ── Tab 3: complementary-filter sensor fusion ──────────────────────────────*/
function imu(){ return IMU_PRESETS[state.fc.imu] || IMU_PRESETS.mpu6000; }
function fusionSim(alpha){
  const im = imu();
  const dt = 1/im.hz, T = 8, N = Math.floor(T/dt);
  const A = 15, f = 0.18;                          // true attitude sweep
  const bias = im.bias, sig = im.sigma;
  const rng = mulberry32(0x51F7 ^ (state.fc.imu.length*2654435761 >>> 0));
  const stride = Math.max(1, Math.floor(N/900));
  const t=[], tru=[], acc=[], gyroOnly=[], fused=[];
  let gInt=0, est=0;
  const a = alpha != null ? alpha : state.fc.alpha;
  for(let k=0;k<=N;k++){
    const tt = k*dt;
    const theta = A*Math.sin(2*Math.PI*f*tt);
    const omega = A*2*Math.PI*f*Math.cos(2*Math.PI*f*tt);
    const gMeas = omega + bias + gaussPRNG(rng)*0.15;      // gyro rate (biased, low noise)
    gInt += gMeas*dt;                                       // gyro-only integration
    const aMeas = theta + gaussPRNG(rng)*sig;              // accel angle (noisy)
    est = a*(est + gMeas*dt) + (1-a)*aMeas;                // complementary filter
    if(k%stride===0||k===N){
      t.push(+tt.toFixed(3)); tru.push(+theta.toFixed(3));
      acc.push(+aMeas.toFixed(3)); gyroOnly.push(+gInt.toFixed(3)); fused.push(+est.toFixed(3));
    }
  }
  return { t, tru, acc, gyroOnly, fused, bias, sig, dt, driftAt8: bias*8 };
}
function fusionTradeoff(){
  const im = imu(); const dt = 1/im.hz, bias = im.bias, sig = im.sigma;
  const alphas=[], drift=[], noise=[], total=[];
  for(let a=0.85; a<=0.9951; a+=0.0025){
    const tf = a*dt/(1-a);
    const dr = bias*tf;                              // deg
    const no = sig*Math.sqrt((1-a)/(1+a));           // deg
    alphas.push(+a.toFixed(4)); drift.push(dr); noise.push(no); total.push(dr+no);
  }
  let bi=0; for(let i=1;i<total.length;i++) if(total[i]<total[bi]) bi=i;
  return { alphas, drift, noise, total, bestAlpha:alphas[bi], bestTotal:total[bi] };
}
function alphaMetrics(a){
  const im = imu(); const dt = 1/im.hz;
  const tf = a*dt/(1-a);
  const dr = im.bias*tf, no = im.sigma*Math.sqrt((1-a)/(1+a));
  return { tf, drift:dr, noise:no, total:dr+no };
}

/* ── Tab 4: full closed loop on the ESTIMATE, controller × estimator ─────────*/
const FC_CONTROLLERS = {
  manual:  { name:"Manual PID",  kp:0.9, ki:0.8, kd:0.080 },
  classic: { name:"ZN-Classic",  kp:1.3, ki:1.6, kd:0.075 },
  tyreus:  { name:"ZN-Tyreus",   kp:1.0, ki:1.0, kd:0.085 }
};
const FC_ESTIMATORS = {
  comp:  "Complementary α",
  gyro:  "Gyro-only",
  accel: "Accel-only"
};
function fullSystemSim(ctrlKey, estKey, o){
  o = o || {};
  const { J, m } = rollInertia();
  const c = FC_CONTROLLERS[ctrlKey] || FC_CONTROLLERS.manual;
  const im = imu(); const alpha = state.fc.alpha;
  const cmd = state.fc.cmd * RAD;
  const b = dragCoeff();
  const escOff = o.escFault ? 0.02 : 0;             // uncalibrated-ESC actuation offset (N·m)
  const windA = state.fc.wind/100 * 0.02;
  const dt = 1/im.hz, T = 4, N = Math.floor(T/dt);
  const rng = mulberry32(0xA13C ^ (ctrlKey.length*97 + estKey.length*13));
  const stride = Math.max(1, Math.floor(N/420));
  const t=[], tru=[], est=[], cmdArr=[];
  let x=0, xd=0, integ=0, eh=0, gInt=0, peak=0, sat=0, n=0, sumTrk=0, sumEst=0;
  const iClamp = 6;
  for(let k=0;k<=N;k++){
    const tt = k*dt;
    // build estimate from sensors of the TRUE state
    const gMeas = xd + im.bias*RAD + gaussPRNG(rng)*0.003;
    const aMeas = x + gaussPRNG(rng)*im.sigma*RAD;
    if(estKey==="gyro") eh += gMeas*dt;
    else if(estKey==="accel") eh = aMeas;
    else eh = alpha*(eh + gMeas*dt) + (1-alpha)*aMeas;
    // controller acts on the estimate error
    const e = cmd - eh;
    integ += e*dt; if(integ>iClamp) integ=iClamp; else if(integ<-iClamp) integ=-iClamp;
    let tau = c.kp*e + c.ki*integ - c.kd*gMeas + escOff;
    const wind = windA*(0.6+0.4*Math.sin(2*Math.PI*0.8*tt));
    const tauMax = 1.2;
    if(Math.abs(tau) > tauMax){ sat++; tau = Math.sign(tau)*tauMax; }
    const xdd = (tau - b*xd - m*G*CG_OFFSET_M*0 + wind)/J;
    xd += xdd*dt; x += xd*dt;
    peak = Math.max(peak, x);
    if(tt > 1.0){ sumTrk += (x-cmd)*(x-cmd); sumEst += (x-eh)*(x-eh); n++; }
    if(k%stride===0||k===N){ t.push(+tt.toFixed(3)); tru.push(x*DEG); est.push(eh*DEG); cmdArr.push(cmd*DEG); }
  }
  const trackRMS = Math.sqrt(sumTrk/Math.max(n,1))*DEG;
  const estRMS = Math.sqrt(sumEst/Math.max(n,1))*DEG;
  const cmdDeg = cmd*DEG;
  const os = cmdDeg ? Math.max(0,(peak*DEG-cmdDeg)/cmdDeg*100) : 0;
  let ts=0, band=2.0;   // ±2° settling band (per theory §9)
  for(let i=0;i<tru.length;i++){ if(Math.abs(tru[i]-cmdDeg) > band) ts=t[i]; }
  const satPct = sat/Math.max(N,1)*100;
  // score: estimator quality dominates (tracking + estimator RMS), then transient
  let score = 100 - trackRMS*8 - estRMS*3 - Math.max(0,os-20)*0.3 - Math.max(0,ts-0.5)*6 - satPct*0.25;
  score = Math.max(40, Math.min(99, score));
  return { t, tru, est, cmdArr, trackRMS, estRMS, os, ts, satPct, score:Math.round(score), ctrlKey, estKey };
}
function fullLeaderboard(o){
  const rows = [];
  Object.keys(FC_CONTROLLERS).forEach(ck=>Object.keys(FC_ESTIMATORS).forEach(ek=>{
    const r = fullSystemSim(ck, ek, o);
    rows.push({ ck, ek, ctrl:FC_CONTROLLERS[ck].name, est:FC_ESTIMATORS[ek], score:r.score,
                trackRMS:r.trackRMS, estRMS:r.estRMS });
  }));
  rows.sort((a,b)=>b.score-a.score);
  return rows;
}

/* ════════ FLIGHT-CONTROL LEFT-PANEL CONTROLS (per active tab) ════════ */
function fcSlider(id, label, min, max, step, val, fmt){
  return '<div class="fc-ctrl"><div class="row-between"><span class="fc-lab">'+label+
    '</span><span class="mono accent" id="'+id+'v">'+fmt(val)+'</span></div>'+
    '<input type="range" id="'+id+'" min="'+min+'" max="'+max+'" step="'+step+'" value="'+val+'"></div>';
}
function renderTabControls(){
  const host = $("tabControls"); if(!host) return;
  const exp = currentExp().exp.id;
  $("tabCtrlHead").textContent =
    exp==="pid" ? "PID Gains" : exp==="zn" ? "Ziegler-Nichols" :
    exp==="fusion" ? "Sensor Fusion" : "Full System";
  const f = state.fc;
  let html = '<div class="card fc-card">';
  // shared: commanded roll angle (used by PID & Full)
  if(exp==="pid" || exp==="full")
    html += fcSlider("fcCmd","Commanded roll θ_cmd",5,45,1,f.cmd,v=>v+"°");

  if(exp==="pid"){
    html += fcSlider("fcKp","Proportional K_p",0.05,1.5,0.01,f.kp,v=>(+v).toFixed(2));
    html += fcSlider("fcKi","Integral K_i",0,4,0.05,f.ki,v=>(+v).toFixed(2));
    html += fcSlider("fcKd","Derivative K_d",0,0.15,0.005,f.kd,v=>(+v).toFixed(3));
    html += '<label class="fc-switch"><input type="checkbox" id="fcDist" '+(f.dist?"checked":"")+
      '> Disturbance torque <em>(CG offset)</em></label>';
    html += '<div class="fc-note mono" id="fcPidNote"></div>';
  } else if(exp==="zn"){
    const zn = znUltimate();
    html += fcSlider("fcZnGain","Proportional sweep K_p",0.2,Math.round(zn.Ku*1.25*10)/10,0.05,f.znGain||1,v=>(+v).toFixed(2));
    html += '<div class="fc-latch mono" id="fcZnLatch">K_u — · P_u — ms · sweep to sustained oscillation</div>';
    html += '<div class="fc-methods"><button type="button" class="fc-mbtn '+(f.znMethod==="classic"?"active":"")+'" data-zn="classic">Classic Z-N</button>'+
      '<button type="button" class="fc-mbtn '+(f.znMethod==="tyreus"?"active":"")+'" data-zn="tyreus">Tyreus-Luyben</button></div>';
    html += '<button type="button" class="fc-apply" id="fcZnApply">Auto-tune → apply table</button>';
    html += fcSlider("fcAir","Air resistance",0,90,5,f.air,v=>v+"%");
    html += fcSlider("fcWind","Wind-gust torque",0,100,5,f.wind,v=>v+"%");
    html += '<div class="fc-note mono" id="fcZnNote"></div>';
  } else if(exp==="fusion"){
    html += fcImuPicker(f.imu);
    html += fcSlider("fcAlpha","Blend coefficient α",0.85,0.999,0.001,f.alpha,v=>(+v).toFixed(3));
    html += '<div class="fc-note mono" id="fcFusNote"></div>';
  } else if(exp==="full"){
    html += '<div class="fc-sub">Controller</div><div class="fc-methods" id="fcCtrlGrp">'+
      Object.keys(FC_CONTROLLERS).map(k=>'<button type="button" class="fc-mbtn '+(f.controller===k?"active":"")+'" data-ctrl="'+k+'">'+FC_CONTROLLERS[k].name+'</button>').join("")+'</div>';
    html += '<div class="fc-sub">Estimator</div><div class="fc-methods" id="fcEstGrp">'+
      Object.keys(FC_ESTIMATORS).map(k=>'<button type="button" class="fc-mbtn '+(f.estimator===k?"active":"")+'" data-est="'+k+'">'+FC_ESTIMATORS[k]+'</button>').join("")+'</div>';
    html += fcImuPicker(f.imu);
    html += fcSlider("fcAir","Air resistance",0,90,5,f.air,v=>v+"%");
    html += fcSlider("fcWind","Wind-gust torque",0,100,5,f.wind,v=>v+"%");
    html += '<label class="fc-switch"><input type="checkbox" id="fcEsc" '+(f.escFault?"checked":"")+
      '> Uncalibrated ESC <em>(actuation offset)</em></label>';
  }
  html += '</div>';
  host.innerHTML = html;
  wireTabControls(exp);
  updateFcNotes();
}
function fcImuPicker(sel){
  return '<div class="fc-sub">IMU</div><select id="fcImu" class="fc-select">'+
    Object.keys(IMU_PRESETS).map(k=>'<option value="'+k+'"'+(sel===k?" selected":"")+'>'+IMU_PRESETS[k].name+'</option>').join("")+'</select>';
}
function bindSlider(id, key, fmt, after){
  const el0 = $(id); if(!el0) return;
  el0.addEventListener("input", e=>{
    const v = +e.target.value; state.fc[key] = v;
    const lab = $(id+"v"); if(lab) lab.textContent = fmt(v);
    saveState(); if(after) after();
    renderInertia(); renderCalcChips(); drawLiveGraph(); drawMassChart();
  });
}
function wireTabControls(exp){
  const redraw = ()=>{ renderCalcChips(); renderLog(); drawLiveGraph(); drawMassChart(); updateFcNotes(); };
  if($("fcCmd")) bindSlider("fcCmd","cmd",v=>v+"°");
  if(exp==="pid"){
    bindSlider("fcKp","kp",v=>(+v).toFixed(2));
    bindSlider("fcKi","ki",v=>(+v).toFixed(2));
    bindSlider("fcKd","kd",v=>(+v).toFixed(3));
    const d=$("fcDist"); if(d) d.addEventListener("change",e=>{ state.fc.dist=e.target.checked; saveState(); redraw(); });
  } else if(exp==="zn"){
    bindSlider("fcZnGain","znGain",v=>(+v).toFixed(2), ()=>znLatchCheck());
    bindSlider("fcAir","air",v=>v+"%");
    bindSlider("fcWind","wind",v=>v+"%");
    document.querySelectorAll("[data-zn]").forEach(btn=>btn.addEventListener("click",()=>{
      state.fc.znMethod = btn.dataset.zn; saveState(); renderTabControls(); redraw(); sfx("tick");
    }));
    const ap=$("fcZnApply"); if(ap) ap.addEventListener("click",()=>znAutoTune());
    znLatchCheck();
  } else if(exp==="fusion"){
    bindSlider("fcAlpha","alpha",v=>(+v).toFixed(3));
    const im=$("fcImu"); if(im) im.addEventListener("change",e=>{ state.fc.imu=e.target.value; saveState(); redraw(); });
  } else if(exp==="full"){
    document.querySelectorAll("[data-ctrl]").forEach(b=>b.addEventListener("click",()=>{ state.fc.controller=b.dataset.ctrl; saveState(); renderTabControls(); redraw(); sfx("tick"); }));
    document.querySelectorAll("[data-est]").forEach(b=>b.addEventListener("click",()=>{ state.fc.estimator=b.dataset.est; saveState(); renderTabControls(); redraw(); sfx("tick"); }));
    const im=$("fcImu"); if(im) im.addEventListener("change",e=>{ state.fc.imu=e.target.value; saveState(); redraw(); });
    bindSlider("fcAir","air",v=>v+"%");
    bindSlider("fcWind","wind",v=>v+"%");
    const ec=$("fcEsc"); if(ec) ec.addEventListener("change",e=>{ state.fc.escFault=e.target.checked; saveState(); redraw(); });
  }
}
function znLatchCheck(){
  const r = znSweepResponse(state.fc.znGain||1);
  const latch = $("fcZnLatch"); if(!latch) return;
  if(r.sustained){
    const zn = znUltimate();
    state.fc.znKu = zn.Ku; state.fc.znPu = zn.Pu; saveState();
    latch.innerHTML = '<b style="color:#1f8a5b">◉ sustained oscillation</b> · K_u = '+zn.Ku.toFixed(2)+' · P_u = '+(zn.Pu*1000).toFixed(1)+' ms';
  } else if(r.diverged){
    latch.innerHTML = '<b style="color:#a83232">✕ diverging</b> · gain above K_u — back off';
  } else {
    latch.textContent = 'K_u — · P_u — ms · raise gain to sustained oscillation';
  }
}
function znAutoTune(){
  const zn = znUltimate();
  const g = znGains(state.fc.znMethod, zn.Ku, zn.Pu);
  state.fc.znKu = zn.Ku; state.fc.znPu = zn.Pu; saveState();
  updateFcNotes(); drawLiveGraph(); drawMassChart(); sfx("done");
}
function updateFcNotes(){
  const exp = currentExp().exp.id;
  if(exp==="pid"){
    const r = pidStepSim({});
    const n=$("fcPidNote"); if(n) n.innerHTML =
      'ω_n = '+r.met.wn.toFixed(1)+' rad/s · ζ = '+r.met.zeta.toFixed(3)+
      '<br>overshoot '+r.osSim.toFixed(1)+'% · t_s '+r.tsSim.toFixed(2)+' s'+
      (state.fc.dist ? '<br>e_ss = '+r.essDeg.toFixed(2)+'°' : '');
  } else if(exp==="zn"){
    const zn = znUltimate(), g = znGains(state.fc.znMethod, zn.Ku, zn.Pu);
    const n=$("fcZnNote"); if(n) n.innerHTML =
      state.fc.znMethod.toUpperCase()+': K_p '+g.kp.toFixed(2)+' · K_i '+g.ki.toFixed(0)+' · K_d '+g.kd.toFixed(4);
  } else if(exp==="fusion"){
    const mm = alphaMetrics(state.fc.alpha), tr = fusionTradeoff();
    const n=$("fcFusNote"); if(n) n.innerHTML =
      'τ_f '+mm.tf.toFixed(3)+' s · drift '+mm.drift.toFixed(3)+'° · noise '+mm.noise.toFixed(3)+'°'+
      '<br>total '+mm.total.toFixed(3)+'° · optimum α = '+tr.bestAlpha.toFixed(3);
  }
}
function renderInertia(){
  const r = rollInertia();
  const iv = $("inertiaVal"); if(iv) iv.textContent = r.J.toFixed(4)+" kg·m²";
  const is = $("inertiaSub"); if(is) is.textContent =
    "m = "+r.m.toFixed(3)+" kg · arm L = "+Math.round(r.armMm)+" mm · plant 1/(J s²)";
}

/* ════════ FLIGHT-CONTROL CHART BUILDERS (Chart.js, platform palette) ════════ */
const FC_GOLD = "#d99b1c", FC_RED = "#e23b30", FC_GREEN = "#1f8a5b", FC_BLUE = "#1f3a93",
      FC_ACCENT = "#8fb3ff";
function fcLineOpts(xlabel, ylabel, mini, extra){
  const tick = { font:{ family:"'IBM Plex Mono'", size:mini?8:10 } };
  const o = { responsive:true, maintainAspectRatio:false, animation:mini?false:{duration:250},
    interaction:{ mode:"index", intersect:false },
    plugins:{ legend:{ display:!mini, position:"bottom", labels:{boxWidth:11,font:{size:10.5}} }, tooltip:{ enabled:!mini } },
    scales:{ x:{ type:"linear", title:{display:!mini,text:xlabel}, grid:{color:C_COL.grid}, ticks:tick },
             y:{ title:{display:!mini,text:ylabel}, grid:{color:C_COL.grid}, ticks:tick } } };
  return Object.assign(o, extra||{});
}
function xy(xa, ya){ return xa.map((x,i)=>({x, y:ya[i]})); }

/* Tab 1 — PID step response, gold curve + setpoint + ±2% band (+ markers) */
function cfgPidStep(mini, frac){
  const s = pidStepSim({});
  const cmd = s.cmdDeg;
  let n = s.t.length; if(frac!=null) n = Math.max(2, Math.floor(s.t.length*frac));
  const T = s.t.length ? s.t[s.t.length-1] : 1;
  const resp = xy(s.t.slice(0,n), s.th.slice(0,n));
  const ds = [
    { label:"Roll angle θ(t)", data:resp, borderColor:FC_GOLD, backgroundColor:FC_GOLD+"22",
      borderWidth:2, pointRadius:0, tension:.2, fill:true },
    { label:"setpoint θ_cmd", data:[{x:0,y:cmd},{x:T,y:cmd}], borderColor:"#8b9a95",
      borderWidth:1.4, borderDash:[6,4], pointRadius:0 },
    { label:"+2% band", data:[{x:0,y:cmd*1.02},{x:T,y:cmd*1.02}], borderColor:FC_GREEN+"66", borderWidth:1, borderDash:[2,3], pointRadius:0 },
    { label:"−2% band", data:[{x:0,y:cmd*0.98},{x:T,y:cmd*0.98}], borderColor:FC_GREEN+"66", borderWidth:1, borderDash:[2,3], pointRadius:0 }
  ];
  if(state.fc.dist && !mini) ds.push({ label:"held (droop)", data:[{x:0,y:cmd-s.essDeg},{x:T,y:cmd-s.essDeg}],
    borderColor:FC_RED, borderWidth:1.2, borderDash:[4,3], pointRadius:0 });
  const opt = fcLineOpts("Time (s)","Roll angle (deg)", mini);
  opt.scales.x.min = 0; opt.scales.x.max = T;
  opt.scales.y.suggestedMax = cmd*1.35; opt.scales.y.min = 0;
  if(s.diverged){ opt.scales.y.suggestedMax = cmd*3; }
  return { type:"line", data:{datasets:ds}, options:opt };
}
/* Tab 2 — closed-loop rate step: classic vs Tyreus-Luyben + 25% comfort line */
function cfgZNcompare(mini){
  const zn = znUltimate();
  const gc = znGains("classic", zn.Ku, zn.Pu), gt = znGains("tyreus", zn.Ku, zn.Pu);
  const rc = rateLoopStep(gc.kp,gc.ki,gc.kd,{}), rt = rateLoopStep(gt.kp,gt.ki,gt.kd,{});
  const T = 0.5;
  const ds = [
    { label:"Classic Z-N", data:xy(rc.t,rc.y), borderColor:FC_RED, borderWidth:2, pointRadius:0, tension:.15 },
    { label:"Tyreus-Luyben", data:xy(rt.t,rt.y), borderColor:FC_GREEN, borderWidth:2, pointRadius:0, tension:.15 },
    { label:"setpoint", data:[{x:0,y:1},{x:T,y:1}], borderColor:"#8b9a95", borderWidth:1.2, borderDash:[6,4], pointRadius:0 },
    { label:"25% comfort", data:[{x:0,y:1.25},{x:T,y:1.25}], borderColor:C_COL.orange, borderWidth:1, borderDash:[2,3], pointRadius:0 }
  ];
  const opt = fcLineOpts("Time (s)","Rate (normalized)", mini);
  opt.scales.x.min=0; opt.scales.x.max=T; opt.scales.y.suggestedMax=1.9; opt.scales.y.min=0;
  return { type:"line", data:{datasets:ds}, options:opt };
}
/* Tab 2 secondary — sustained oscillation at Ku */
function cfgZNsustained(mini){
  const s = znSustained();
  const ds = [{ label:"rate output at K_p = K_u", data:xy(s.t,s.y), borderColor:FC_RED,
    borderWidth:2, pointRadius:0, tension:.1 },
    { label:"", data:[{x:0,y:1},{x:s.t[s.t.length-1],y:1}], borderColor:"#c9c9c9", borderWidth:1, borderDash:[2,3], pointRadius:0 },
    { label:"", data:[{x:0,y:-1},{x:s.t[s.t.length-1],y:-1}], borderColor:"#c9c9c9", borderWidth:1, borderDash:[2,3], pointRadius:0 }];
  const opt = fcLineOpts("Time (ms)","Rate (normalized)", mini);
  opt.scales.y.min=-1.5; opt.scales.y.max=1.5; opt.plugins.legend.display=false;
  return { type:"line", data:{datasets:ds}, options:opt };
}
/* Tab 2 live — swept P-only response (damped → sustained → divergent) */
function cfgZNsweep(mini){
  const r = znSweepResponse(state.fc.znGain||1);
  const col = r.diverged ? FC_RED : r.sustained ? C_COL.orange : FC_GREEN;
  const ds = [{ label:"rate loop @ K_p = "+(state.fc.znGain||1).toFixed(2), data:xy(r.t,r.y),
    borderColor:col, backgroundColor:col+"1c", borderWidth:2, pointRadius:0, tension:.12, fill:true },
    { label:"setpoint", data:[{x:0,y:1},{x:r.t[r.t.length-1]||0.5,y:1}], borderColor:"#8b9a95", borderWidth:1.2, borderDash:[6,4], pointRadius:0 }];
  const opt = fcLineOpts("Time (s)","Rate (normalized)", mini);
  opt.scales.y.suggestedMin=-0.5; opt.scales.y.suggestedMax=2;
  return { type:"line", data:{datasets:ds}, options:opt };
}
/* Tab 3 — fusion time series: true / accel(noisy) / gyro-only(drift) / fused */
function cfgFusionSeries(mini, frac){
  const s = fusionSim();
  let n = s.t.length; if(frac!=null) n = Math.max(2, Math.floor(s.t.length*frac));
  const sl = a=>a.slice(0,n);
  const ds = [
    { label:"accel θ_accel (noisy)", data:xy(sl(s.t),sl(s.acc)), borderColor:FC_ACCENT, borderWidth:.8, pointRadius:0, tension:0 },
    { label:"gyro-only ∫(ω+bias)dt", data:xy(sl(s.t),sl(s.gyroOnly)), borderColor:FC_RED, borderWidth:2, borderDash:[6,4], pointRadius:0, tension:.1 },
    { label:"true angle θ", data:xy(sl(s.t),sl(s.tru)), borderColor:"#1e2a29", borderWidth:2, pointRadius:0, tension:.1 },
    { label:"fused θ_est (α="+state.fc.alpha.toFixed(2)+")", data:xy(sl(s.t),sl(s.fused)), borderColor:FC_GOLD, borderWidth:2, pointRadius:0, tension:.1 }
  ];
  const opt = fcLineOpts("Time (s)","Roll angle (deg)", mini);
  opt.scales.x.min=0; opt.scales.x.max=8; opt.scales.y.min=-24; opt.scales.y.max=24;
  return { type:"line", data:{datasets:ds}, options:opt };
}
/* Tab 3 secondary — drift vs noise trade-off vs α with markers + optimum */
function cfgFusionTradeoff(mini){
  const tr = fusionTradeoff();
  const marks = [0.90,0.95,0.98,0.99].map(a=>{ const m=alphaMetrics(a); return {x:a,y:m.total}; });
  const best = { x:tr.bestAlpha, y:tr.bestTotal };
  const ds = [
    { label:"drift = bias·τ_f", data:xy(tr.alphas,tr.drift), borderColor:FC_RED, borderWidth:2, borderDash:[6,4], pointRadius:0, tension:.2 },
    { label:"noise_rms", data:xy(tr.alphas,tr.noise), borderColor:FC_BLUE, borderWidth:2, borderDash:[3,3,8,3], pointRadius:0, tension:.2 },
    { label:"total = drift + noise", data:xy(tr.alphas,tr.total), borderColor:"#1e2a29", borderWidth:2, pointRadius:0, tension:.2 },
    { label:"α samples", data:marks, borderColor:FC_GOLD, backgroundColor:FC_GOLD, showLine:false, pointRadius:mini?3:5 },
    { label:"optimum", data:[best], borderColor:FC_GREEN, backgroundColor:FC_GREEN, showLine:false, pointRadius:mini?5:8, pointStyle:"star" }
  ];
  const opt = fcLineOpts("Blend coefficient α","Attitude error (deg)", mini);
  opt.scales.x.min=0.85; opt.scales.x.max=1.0; opt.scales.y.min=0;
  return { type:"line", data:{datasets:ds}, options:opt };
}
/* Tab 4 — true vs estimate vs command closed-loop response */
function cfgFullResponse(mini, frac){
  const r = fullSystemSim(state.fc.controller, state.fc.estimator, {escFault:state.fc.escFault});
  let n = r.t.length; if(frac!=null) n=Math.max(2,Math.floor(r.t.length*frac));
  const sl=a=>a.slice(0,n);
  const ds = [
    { label:"command θ_cmd", data:xy(sl(r.t),sl(r.cmdArr)), borderColor:"#8b9a95", borderWidth:1.2, borderDash:[6,4], pointRadius:0 },
    { label:"estimate θ̂", data:xy(sl(r.t),sl(r.est)), borderColor:FC_RED, borderWidth:2, pointRadius:0, tension:.15 },
    { label:"true θ", data:xy(sl(r.t),sl(r.tru)), borderColor:FC_BLUE, backgroundColor:FC_BLUE+"14", borderWidth:2, pointRadius:0, tension:.15, fill:false }
  ];
  const opt = fcLineOpts("Time (s)","Roll angle (deg)", mini);
  opt.scales.x.min=0; opt.scales.x.max=4; opt.scales.y.min=0; opt.scales.y.suggestedMax=state.fc.cmd*1.4;
  return { type:"line", data:{datasets:ds}, options:opt };
}
/* Tab 4 secondary — leaderboard as horizontal bars (DOM handled elsewhere for detail) */
function cfgFullLeaderboard(mini){
  const rows = fullLeaderboard({escFault:state.fc.escFault});
  const labels = rows.map(r=>r.est.split(" ")[0][0]+r.est.split(" ").slice(-1)[0].slice(0,3)+"·"+r.ctrl.split(" ")[0].slice(0,3));
  const cur = state.fc.controller+"|"+state.fc.estimator;
  return { type:"bar", data:{ labels: rows.map(r=>r.ctrl.replace("ZN-","")+" · "+r.est.replace(" α","").replace("-only","")),
    datasets:[{ label:"Score", data:rows.map(r=>r.score),
      backgroundColor:rows.map(r=>(r.ck+"|"+r.ek)===cur ? FC_GOLD : r.score>=90?FC_GREEN:r.score<65?FC_RED:C_COL.slate),
      borderWidth:0 }] },
    options:{ indexAxis:"y", responsive:true, maintainAspectRatio:false, animation:false,
      plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:c=>" score "+c.raw } } },
      scales:{ x:{ min:0, max:100, grid:{color:C_COL.grid}, ticks:{font:{family:"'IBM Plex Mono'",size:mini?8:10}} },
               y:{ grid:{display:false}, ticks:{font:{size:mini?7.5:9}} } } } };
}
/* the live (primary) + secondary chart config for the current tab */
function fcPrimaryCfg(mini, frac){
  const exp = currentExp().exp.id;
  if(exp==="pid") return cfgPidStep(mini, frac);
  if(exp==="zn")  return simActive ? cfgZNcompare(mini) : cfgZNsweep(mini);
  if(exp==="fusion") return cfgFusionSeries(mini, frac);
  return cfgFullResponse(mini, frac);
}
function fcSecondaryCfg(mini){
  const exp = currentExp().exp.id;
  if(exp==="pid") return cfgPidTerms(mini);
  if(exp==="zn")  return cfgZNsustained(mini);
  if(exp==="fusion") return cfgFusionTradeoff(mini);
  return cfgFullLeaderboard(mini);
}
/* PID term contributions (P / I / D torque split over the step) */
function cfgPidTerms(mini){
  const s = pidStepSim({});
  const ds = [
    { label:"P", data:xy(s.t,s.Pc), borderColor:FC_BLUE, borderWidth:2, pointRadius:0, tension:.2 },
    { label:"I", data:xy(s.t,s.Ic), borderColor:FC_GREEN, borderWidth:2, pointRadius:0, tension:.2 },
    { label:"D", data:xy(s.t,s.Dc), borderColor:FC_RED, borderWidth:2, pointRadius:0, tension:.2 }
  ];
  const opt = fcLineOpts("Time (s)","Torque (N·m)", mini);
  opt.scales.x.min=0;
  return { type:"line", data:{datasets:ds}, options:opt };
}

/* ════════ GHOST DRONE — a translucent clone banking to the estimate θ̂ ════════ */
let ghostRig = null, ghostFor = null;
function _ghostMat(m){ const c = m.clone(); c.transparent = true; c.opacity = 0.24; c.depthWrite = false; return c; }
function ensureGhost(){
  if(!rig || typeof THREE === "undefined") return;
  if(ghostRig && ghostFor === rig) return;
  removeGhost();
  try{
    ghostRig = rig.clone(true);
    ghostRig.traverse(o=>{ if(o.isMesh && o.material){
      o.material = Array.isArray(o.material) ? o.material.map(_ghostMat) : _ghostMat(o.material);
    }});
    ghostFor = rig; scene.add(ghostRig);
  }catch(e){ ghostRig = null; }
}
function removeGhost(){
  if(!ghostRig) return;
  try{ scene.remove(ghostRig);
    ghostRig.traverse(o=>{ if(o.isMesh && o.material){ (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose&&m.dispose()); } });
  }catch(e){}
  ghostRig = null; ghostFor = null;
}
