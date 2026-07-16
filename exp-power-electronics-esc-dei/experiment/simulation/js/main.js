/* ════════════════════════════════════════════════════════════════
   ESC POWER-ELECTRONICS LAB — main.js
   Data-driven from assets/manifest.json + one spec.json per option.
   Built on the Drone Technology Lab platform architecture (standard
   function names, 3-column shell, floating windows, instructor).

   MODULES
     M1 The ESC Board       — Tab1 Anatomy (procedural exploded board)
                              Tab2 Commission (wire DC supply↔ESC↔motor,
                                    store endpoints, arm, sweep PWM→throttle)
     M2 Characterisation    — Tab1 Protocol & Latency (command-vs-response)
                              Tab2 Thermal & Heatsink  (I²R sweep, sizing)

   Power source: a STIFF bench DC supply (CV/CC) with V/A displays and
   working binding-post terminals — procedural, replaces the LiPo.

   Sections
     1  Catalog loader          8  Bench scene + wiring
     2  State + persistence     9  UI rendering
     3  Utilities               10 Charts (Chart.js)
     4  Physics engine          11 Floating windows
     5  Diagnostics             12 Simulation runner
     6  3D models + procedural  13 Audio + Instructor
     7  Preview engine          14 Wiring + boot
   ════════════════════════════════════════════════════════════════ */

/* ════════════ 1 · CATALOG LOADER ════════════ */
let ESC_DB = null;
const STAND_MODEL = "assets/stand/motor_holder.glb";

function bootProgress(txt, frac){
  const s = document.getElementById("bootSub"), f = document.getElementById("bootFill");
  if(s && txt) s.textContent = txt;
  if(f && frac != null) f.style.width = Math.round(frac*100) + "%";
}

async function loadCatalog(){
  bootProgress("loading component catalog…", .1);
  const manifest = await (await fetch("assets/manifest.json", {cache:"no-store"})).json();
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
          return { c, opt: {
            id, name: spec.name || id, catKey: c.key,
            mass: spec.mass_g || 0, qty: spec.qty || 1,
            size: spec.size_mm || null, view: spec.view || null,
            specs: Object.entries(spec.specs || {}),
            phys: spec.physics || {}, files,
            fallback: { kind: c.fallback || "none", color: 0x5a6672, s: 1 }
          }};
        }catch(e){ console.warn("spec.json missing/invalid for", base); return { c, opt: null }; }
      })());
    });
  });
  const results = await Promise.all(jobs);
  bootProgress("indexing components…", .55);
  let supply = null;
  if(manifest.supply){
    try{ supply = await (await fetch(manifest.supply, {cache:"no-store"})).json(); }catch(e){ console.warn("supply spec missing"); }
  }
  const byCat = {};
  results.forEach(r=>{ if(!r.opt) return; (byCat[r.c.key] = byCat[r.c.key] || []).push(r.opt); });
  const categories = manifest.categories.map(c=>{
    const order = c.options;
    const opts = (byCat[c.key] || []).sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id));
    return { key:c.key, label:c.label, options:opts };
  });
  ESC_DB = {
    categories,
    defaults: manifest.defaults || {},
    modules: manifest.modules,
    instructor: manifest.instructor,
    calibration: manifest.calibration || {},
    faults: manifest.faults || [],
    protocols: manifest.protocols || [],
    thermal: manifest.thermal || {},
    supply: (supply && supply.physics) || { v_max:30, i_max:40, lead_r_ohm:0.004 },
    supplyName: (supply && supply.name) || "Bench DC Supply",
    reward: {
      name: manifest.reward.name, desc: manifest.reward.desc,
      files: manifest.reward.model ? [manifest.reward.model] : [],
      fallback: { kind: manifest.reward.fallback || "heatsink", color: 0x9aa5b1, s: 1 }
    }
  };
}

/* ════════════ 2 · STATE + PERSISTENCE ════════════ */
const LS_KEY = "esc-lab-v1";
const state = {
  sel:{}, module:"m1", exp:{}, done:{},
  vset:16.0, ilim:40, pulse:1000,
  fault:"none", protocol:"pwm_400",
  thermalPreset:"hover", ambient:25, hotModel:true, heatsink:false,
  explode:100,
  endpointsStored:false, armed:false, escDead:false,
  wires:[], seenComps:{},
  sweepMin:2100, sweepMax:900,               // pulse range visited during commission
  voiceVol:80, sfxVol:60, instrStep:0, instrOpen:true
};
function loadState(){
  let s = {};
  try{ s = JSON.parse(localStorage.getItem(LS_KEY)) || {}; }catch(e){}
  state.sel = Object.assign({}, ESC_DB.defaults, s.sel || {});
  ESC_DB.categories.forEach(c=>{
    if(!c.options.some(o=>o.id===state.sel[c.key])) state.sel[c.key] = c.options[0] && c.options[0].id;
  });
  state.module = ESC_DB.modules.some(m=>m.id===s.module) ? s.module : ESC_DB.modules[0].id;
  ESC_DB.modules.forEach(m=>{
    const saved = s.exp && s.exp[m.id];
    state.exp[m.id] = m.experiments.some(e=>e.id===saved) ? saved : m.experiments[0].id;
  });
  const num = (k,d)=> s[k]!=null ? s[k] : d;
  state.done = s.done || {};
  state.vset = num("vset", 16.0); state.ilim = num("ilim", 40); state.pulse = num("pulse", 1000);
  state.fault = s.fault || "none"; state.protocol = ESC_DB.protocols.some(p=>p.id===s.protocol) ? s.protocol : "pwm_400";
  state.thermalPreset = s.thermalPreset || "hover"; state.ambient = num("ambient", 25);
  state.hotModel = s.hotModel !== false; state.heatsink = !!s.heatsink; state.explode = num("explode", 100);
  state.seenComps = s.seenComps || {};
  state.voiceVol = num("voiceVol", 80); state.sfxVol = num("sfxVol", 60);
  state.instrStep = Math.min(s.instrStep || 0, ESC_DB.instructor.length - 1);
  state.instrOpen = s.instrOpen !== false;
}
function saveState(){
  try{
    localStorage.setItem(LS_KEY, JSON.stringify({
      sel:state.sel, module:state.module, exp:state.exp, done:state.done,
      vset:state.vset, ilim:state.ilim, pulse:state.pulse, fault:state.fault, protocol:state.protocol,
      thermalPreset:state.thermalPreset, ambient:state.ambient, hotModel:state.hotModel,
      heatsink:state.heatsink, explode:state.explode, seenComps:state.seenComps,
      voiceVol:state.voiceVol, sfxVol:state.sfxVol, instrStep:state.instrStep, instrOpen:state.instrOpen
    }));
  }catch(e){}
}

/* ════════════ 3 · UTILITIES ════════════ */
const $ = id => document.getElementById(id);
function el(tag, cls, html){
  const n = document.createElement(tag);
  if(cls) n.className = cls;
  if(html != null) n.innerHTML = html;
  return n;
}
function txt(s){ return String(s).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
const cat = key => ESC_DB.categories.find(c=>c.key===key);
const opt = key => { const c = cat(key); if(!c) return null; return c.options.find(o=>o.id===state.sel[key]) || c.options[0]; };
function hashStr(s){ let h=0; s=String(s); for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0; return h; }
function configCode(){ return "CFG-" + (hashStr(JSON.stringify(state.sel)) % 10000).toString().padStart(4,"0"); }
const allExperiments = () => ESC_DB.modules.flatMap(m=>m.experiments.map(e=>({mod:m, exp:e, key:m.id+":"+e.id})));
const allDone = () => allExperiments().every(x=>state.done[x.key]);
const doneCount = () => allExperiments().filter(x=>state.done[x.key]).length;
function currentExp(){
  const m = ESC_DB.modules.find(m=>m.id===state.module);
  return { mod:m, exp:m.experiments.find(e=>e.id===state.exp[m.id]) || m.experiments[0] };
}
const escIs4in1 = o => !!(o && o.phys && o.phys.form_factor === "4in1");
const protoById = id => ESC_DB.protocols.find(p=>p.id===id) || ESC_DB.protocols[0];
const faultById = id => ESC_DB.faults.find(f=>f.id===id) || ESC_DB.faults[0];

/* ════════════ 4 · PHYSICS ENGINE ════════════
   Motor: Ke = 60/(2π·Kv) V·s/rad, Kt = Ke; propeller BEMT-lite (UIUC, n rev/s).
   DC supply: stiff CV; folds to CC when I > current-limit.
   ESC: P = P_cond(I²·Rds(T)) + P_sw(½·V·I·(t_on+t_off)·f) + P_cap(I_rip²·ESR).
   Thermal: T = T_amb + P·R_th; hot-R feedback solved self-consistently.   */
const G = 9.80665;
const ALPHA_CU = 0.00393;      // copper temp coeff /°C
const ALPHA_FET = 0.006;       // MOSFET Rds(on) temp coeff /°C
const T_AMB0 = 25;
const MU_AIR = 1.81e-5;
const RHO = 1.225;             // sea-level air density (bench)

function propulsionParams(){
  const mo = opt("motor"), pr = opt("propeller"), esc = opt("esc");
  const mp = (mo && mo.phys) || {}, pp = (pr && pr.phys) || {}, ep = (esc && esc.phys) || {};
  const dia_in = pp.diameter_in || 8;
  return {
    kv: mp.kv || 900, rm20: mp.rm_ohm || 0.1, i0: mp.i0_a || 0.4,
    imax: mp.max_current_a || 30, pmax: mp.max_power_w || 400, motorMaxCells: mp.max_cells || 6,
    massMotor: (mo && mo.mass) || 30, motorSize: (mo && mo.size) || [28,25,28],
    D: dia_in * 0.0254, diaIn: dia_in, pitchIn: pp.pitch_in || dia_in*0.5, blades: pp.blades || 2,
    massProp: (pr && pr.mass) || 3,
    escCurrent: ep.current_a || 30, escBurst: ep.burst_current_a || 40, rdsOn: ep.rds_on_ohm || 0.0025,
    rTh: ep.r_th_c_per_w || 18, rThHs: ep.r_th_heatsink_c_per_w || 9, mosfets: ep.mosfet_count || 6,
    fCarrier: ep.f_carrier_hz || 24000, swTime: ep.sw_time_s || 1e-7, capEsr: ep.cap_esr_ohm || 0.03,
    escMaxCells: ep.max_cells || 6, massEsc: (esc && esc.mass) || 10, is4in1: escIs4in1(esc)
  };
}
function motorRm(p, tempC){ return p.rm20 * (1 + ALPHA_CU*((tempC==null?20:tempC) - 20)); }
function propAero(p, omega){
  const pd = Math.max(0.2, Math.min(1.2, p.pitchIn / Math.max(p.diaIn,1)));
  const R = p.D/2, chord = 0.1*p.D;
  const Vtip = Math.max(omega*R, 0.5);
  const Re = Math.max(RHO * Vtip * chord / MU_AIR, 1000);
  const reFactor = Math.pow(150000/Re, 0.25);
  const ctStatic = 0.115 * pd;
  const cqBase = ctStatic * (0.045*reFactor + 0.11*pd);
  const Ji = Math.sqrt(Math.max(2*ctStatic/Math.PI, 0));
  return { ctEff: ctStatic, cqEff: cqBase*(1 + 1.5*Ji*Ji) };
}
/* steady-state motor+prop point via quadratic torque balance. returns stalled flag. */
function calcMotorPoint(duty, V, Rm, Resc){
  const p = propulsionParams();
  if(duty <= 0 || V <= 0) return { rpm:0, omega:0, T:0, Q:0, I:0, P:0, Pmech:0, stalled:false };
  const Reff = Rm + (Resc||0);
  const ke = 60/(2*Math.PI*p.kv), kt = ke;
  let omega = Math.max(p.kv * V * duty * Math.PI/30 * 0.7, 15), aero, stalled = false;
  for(let iter=0; iter<14; iter++){
    aero = propAero(p, omega);
    const k = aero.cqEff * RHO * Math.pow(p.D,5) / (4*Math.PI*Math.PI);   // Q = k·ω²
    const a = k, b = kt*ke/Reff, c = -(kt*V*duty/Reff - kt*p.i0);
    const disc = b*b - 4*a*c;
    if(disc < 0 || a <= 0){ stalled = true; omega = 0; break; }
    const next = (-b + Math.sqrt(disc)) / (2*a);
    if(!isFinite(next) || next < 0){ stalled = true; omega = 0; break; }
    omega += (next - omega) * 0.6;
  }
  if(stalled) return { rpm:0, omega:0, T:0, Q:0, I:0, P:0, Pmech:0, stalled:true };
  const n = omega/(2*Math.PI);
  aero = propAero(p, omega);
  const T = aero.ctEff * RHO * n*n * Math.pow(p.D,4);
  const Q = aero.cqEff * RHO * n*n * Math.pow(p.D,5);
  const I = Math.min(Q/kt + p.i0, p.imax*1.8);
  const Vterm = Math.max(V*duty - I*Reff, 0);
  return { rpm:n*60, omega, T:Math.max(T,0), Q, I, P:Vterm*I + I*I*Reff, Pmech:Q*omega, stalled:false };
}
/* single motor on the bench, fed by the stiff DC supply (CV → CC fold). tempC = winding temp. */
function supplyBus(duty, tempC){
  const p = propulsionParams();
  const Vset = state.vset, Ilim = state.ilim, leadR = ESC_DB.supply.lead_r_ohm || 0.004;
  const Rm = motorRm(p, tempC==null?20:tempC), Resc = p.rdsOn + leadR;
  let r = calcMotorPoint(duty, Vset, Rm, Resc);
  if(r.I <= Ilim || duty <= 0) return Object.assign(r, { V:Vset, mode:"CV", Rm });
  // current-limit: bisect bus voltage so the load draws exactly Ilim
  let lo = 0, hi = Vset;
  for(let k=0;k<30;k++){ const mid=(lo+hi)/2; (calcMotorPoint(duty,mid,Rm,Resc).I > Ilim) ? hi=mid : lo=mid; }
  const V = (lo+hi)/2;
  r = calcMotorPoint(duty, V, Rm, Resc);
  return Object.assign(r, { V, mode:"CC", Rm });
}
/* ESC losses at phase current I, bus V, junction T */
function escLoss(I, V, p, T){
  const Rt = p.rdsOn * (1 + ALPHA_FET*((T==null?25:T) - 25));
  const Pcond = I*I*Rt;
  const Psw = 0.5 * V * I * p.swTime * p.fCarrier;
  const Irip = 0.12*I;                        // bus-cap RMS ripple current (secondary loss)
  const Pcap = Irip*Irip*p.capEsr;
  return { Rt, Pcond, Psw, Pcap, Ptot: Pcond + Psw + Pcap };
}
/* self-consistent steady junction temperature. opts {hot, heatsink, ambient} */
function escThermalSteady(I, V, opts){
  const p = propulsionParams();
  const Rth = opts.heatsink ? p.rThHs : p.rTh, Tamb = opts.ambient;
  if(!opts.hot){ const L = escLoss(I,V,p,25); return { T: Tamb + L.Ptot*Rth, P:L.Ptot, R:p.rdsOn, Rth, runaway:false, L }; }
  const K = I*I*p.rdsOn*Rth, runaway = (1 - K*ALPHA_FET) <= 0;
  let T = Tamb, L;
  for(let k=0;k<60;k++){ L = escLoss(I,V,p,T); const Tn = Tamb + L.Ptot*Rth; if(Tn>400){ T=400; break; } T = Tn; }
  return { T: Math.min(T,400), P:L.Ptot, R:p.rdsOn*(1+ALPHA_FET*(T-25)), Rth, runaway, L };
}
/* transient step for the live T(t) graph */
function escThermalStep(T, I, V, dt, opts){
  const p = propulsionParams();
  const Rth = opts.heatsink ? p.rThHs : p.rTh, Tamb = opts.ambient;
  const mass = (p.massEsc + (opts.heatsink ? (ESC_DB.thermal.heatsink_mass_g||12) : 0))/1000;
  const cp = ESC_DB.thermal.cp_j_per_kg_k || 800;
  const L = escLoss(I, V, p, opts.hot ? T : 25);
  const Tn = T + (L.Ptot - (T-Tamb)/Rth)/(mass*cp)*dt;
  return Math.min(Math.max(Tn, Tamb), 400);
}
/* passive-cooling current at which the junction reaches the 80°C limit */
function passiveThreshold(opts){
  const limit = ESC_DB.thermal.limit_c || 80;
  let lo = 0, hi = 200;
  for(let k=0;k<40;k++){ const mid=(lo+hi)/2; const r = escThermalSteady(mid, state.vset, opts); (r.T > limit || r.runaway) ? hi=mid : lo=mid; }
  return (lo+hi)/2;
}
/* deterministic per-unit dead-band (35–65 µs) seeded from the ESC id */
function deadbandUs(){ const nom = ESC_DB.calibration.deadband_nominal_us || 50; const h = hashStr(opt("esc").id); return Math.round(nom*0.7 + (h%1000)/1000*nom*0.6); }
/* PWM pulse → throttle, applying stored endpoints, fault and dead-band. returns {raw, eff} % */
function throttleFromPulse(pulse){
  const cal = ESC_DB.calibration;
  let pmin = cal.pulse_min_us, pmax = cal.pulse_max_us;
  const fault = state.endpointsStored ? state.fault : "none";
  if(fault === "inverted"){ pmin = cal.pulse_max_us; pmax = cal.pulse_min_us; }
  else if(fault === "highmin"){ pmin = 1300; pmax = cal.pulse_max_us; }
  let raw = (pulse - pmin)/(pmax - pmin) * 100;
  raw = Math.max(0, Math.min(100, raw));
  let eff = raw;
  const db = deadbandUs();
  if(fault !== "inverted" && pulse <= cal.pulse_min_us + db) eff = 0;
  if(fault === "jitter") eff = Math.max(0, Math.min(100, eff + (Math.random()-0.5)*1.2));
  return { raw, eff };
}
/* live operating snapshot for chips / telemetry (stage-aware duty & current) */
function calc(){
  const p = propulsionParams();
  const stage = currentExp().exp.metric;
  const proto = protoById(state.protocol);
  const map = throttleFromPulse(state.pulse);
  const duty = state.armed && !state.escDead ? map.eff/100 : 0;
  let op = supplyBus(duty, T_AMB0);
  let phaseI = op.I;
  if(stage === "temp"){
    const full = supplyBus(1, T_AMB0);
    phaseI = state.thermalPreset === "full" ? full.I : supplyBus(0.45, T_AMB0).I;
    op = { V: state.vset, I: phaseI, rpm: state.thermalPreset==="full"? full.rpm : 0, mode:"CV", stalled:false };
  }
  const opts = { hot:state.hotModel, heatsink:state.heatsink, ambient:state.ambient };
  const th = escThermalSteady(phaseI, op.V, opts);
  const L = escLoss(phaseI, op.V, p, opts.hot ? th.T : 25);
  const resolution = proto.type === "digital" ? proto.levels : Math.round((proto.pulse_max_us - proto.pulse_min_us)/proto.timer_tick_us);
  return {
    p, stage, map, duty, throttle: map.eff, V: op.V, phaseI, rpm: op.rpm, mode: op.mode, stalled: op.stalled,
    Pcond: L.Pcond, Psw: L.Psw, Pcap: L.Pcap, Ptot: L.Ptot, Tjunc: th.T, runaway: th.runaway, Rhot: th.R,
    latency: proto.latency_ms, resolution, proto,
    passiveA: passiveThreshold(opts), threshold_w: ESC_DB.thermal.heatsink_threshold_w || 2.0,
    limit_c: ESC_DB.thermal.limit_c || 80
  };
}

/* ════════════ 5 · DIAGNOSTICS ════════════ */
function connected(a, b){ return state.wires.some(w => (w[0]===a && w[1]===b) || (w[0]===b && w[1]===a)); }
function evalWiring(){
  const posPos = connected("sup+","escP+"), posNeg = connected("sup+","escP-");
  const negNeg = connected("sup-","escP-"), negPos = connected("sup-","escP+");
  const shortSupply = connected("sup+","sup-"), shortEsc = connected("escP+","escP-");
  const powerUsed = (posPos||posNeg) && (negNeg||negPos);
  const correctPower = posPos && negNeg && !posNeg && !negPos && !shortSupply && !shortEsc;
  const reversePower = (posNeg || negPos) && !correctPower;
  const shorted = shortSupply || shortEsc;
  const escPads = ["escA","escB","escC"], motorPads = ["mA","mB","mC"];
  const map = escPads.map(e => { const m = motorPads.find(mp => connected(e, mp)); return m ? motorPads.indexOf(m) : -1; });
  const wired = map.filter(x=>x>=0);
  const distinct = new Set(wired).size === wired.length;
  const escToEsc = connected("escA","escB")||connected("escB","escC")||connected("escA","escC");
  const phaseComplete = wired.length === 3 && distinct && !escToEsc;
  const degenerate = (!distinct && wired.length>1) || escToEsc;
  let inv = 0; for(let i=0;i<map.length;i++) for(let j=i+1;j<map.length;j++) if(map[i]>=0&&map[j]>=0&&map[i]>map[j]) inv++;
  const spinDir = phaseComplete ? (inv % 2 === 0 ? 1 : -1) : 0;
  return { posPos, negNeg, correctPower, reversePower, shorted, powerUsed, phaseComplete, degenerate, spinDir, phaseCount: wired.length };
}
function diagnostics(){
  const items = [];
  const w = evalWiring(), c = calc(), p = c.p;
  const stage = currentExp().exp.metric;

  if(state.escDead){
    items.push({ sev:"err", block:true, msg:"ESC destroyed — the board is scorched and no longer responds.",
      fix:"Select a replacement ESC from the picker to clear the fault." });
  }
  if(stage === "map" || stage === "explore"){
    if(w.shorted) items.push({ sev:"err", block:true, msg:"Dead short across the supply — the two power posts are bridged.", fix:"Remove the shorting wire; wire supply(+)→ESC(+) and supply(−)→ESC(−)." });
    else if(w.reversePower) items.push({ sev:"err", block:true, msg:"Reverse polarity — supply(+) is wired to the ESC's (−) pad.", fix:"Swap the power leads: red post → ESC red pad, black → black." });
    else if(!w.powerUsed) items.push({ sev:"warn", msg:"Power not wired — the ESC has no supply connection yet.", fix:"Click the supply's red (+) post, then the ESC's red power pad; repeat for (−)." });
    if(!w.phaseComplete){
      if(w.degenerate) items.push({ sev:"err", block:true, msg:"Degenerate phase wiring — a motor terminal is doubled or two ESC pads are bridged.", fix:"Wire each ESC pad (A/B/C) to a distinct motor terminal, one-to-one." });
      else items.push({ sev:"warn", msg:"Phase wiring incomplete — "+w.phaseCount+" / 3 leads connected; the ESC can't commutate.", fix:"Connect all three ESC phase pads to the three motor terminals." });
    }
    if(state.endpointsStored && state.fault !== "none")
      items.push({ sev:"warn", msg:"A calibration fault is stored — the map is intentionally wrong.", fix:"Set Fault Injection to “None” and re-store endpoints for a clean channel." });
  }
  if(!state.escDead){
    if(c.phaseI > p.escBurst) items.push({ sev:"err", block:false, msg:"ESC over-current — "+c.phaseI.toFixed(1)+" A exceeds the "+p.escBurst+" A burst rating.", fix:"Lower the supply voltage, use a smaller prop, or a higher-current ESC." });
    else if(c.phaseI > p.escCurrent) items.push({ sev:"warn", msg:"Above continuous rating — "+c.phaseI.toFixed(1)+" A vs "+p.escCurrent+" A continuous.", fix:"Fine for short bursts; sustained running will overheat the board." });
    if(c.phaseI > p.imax*1.02) items.push({ sev:"warn", msg:"Motor over-current — "+c.phaseI.toFixed(1)+" A vs "+p.imax+" A motor rating.", fix:"Reduce voltage or prop size." });
  }
  if(c.mode === "CC" && !w.reversePower && !w.shorted)
    items.push({ sev:"warn", msg:"Supply in CC — the load wants more than the "+state.ilim+" A limit; bus voltage is folding back.", fix:"Raise the current limit to run at full commanded throttle." });
  if(stage === "latency"){
    if(c.latency > 5) items.push({ sev:"err", block:false, msg:"Command latency "+c.latency.toFixed(1)+" ms is too slow for stable flight (need < 5 ms).", fix:"Choose 400 Hz, OneShot or DShot to pass sign-off." });
    else items.push({ sev:"ok", msg:"Flight-ready latency — "+c.latency.toFixed(2)+" ms at "+c.resolution+" throttle steps.", fix:"" });
  }
  if(stage === "temp"){
    if(c.runaway) items.push({ sev:"err", block:false, msg:"Thermal runaway — hot-resistance feedback diverges (1 − K·α ≤ 0); the junction never settles.", fix:"Fit a heatsink, drop the current, or lower ambient." });
    else if(c.Tjunc > c.limit_c) items.push({ sev:"warn", msg:"Over the 80 °C limit — junction settles at "+c.Tjunc.toFixed(0)+" °C.", fix:"Enable the clamp-on heatsink or reduce sustained current." });
    if(c.Pcond > c.threshold_w && !state.heatsink) items.push({ sev:"warn", msg:"Conduction loss "+c.Pcond.toFixed(2)+" W is over the 2 W heatsink line.", fix:"A heatsink is recommended above 2 W." });
  }
  const errors = items.filter(i=>i.sev==="err").length;
  const warns = items.filter(i=>i.sev==="warn").length;
  const blocked = items.some(i=>i.block);
  if(!items.length) items.push({ sev:"ok", msg:"All checks passed — wiring, current and thermal margins are within limits.", fix:"" });
  return { items, errors, warns, blocked };
}

/* ════════════ 6 · 3D MODELS + PROCEDURAL BUILDERS ════════════ */
function mat(color, opts){ return new THREE.MeshStandardMaterial(Object.assign({color, roughness:.55, metalness:.35}, opts||{})); }
function roundedBoard(w, d, h, r, m){
  const shape = new THREE.Shape();
  const x=-w/2, y=-d/2;
  shape.moveTo(x+r, y);
  shape.lineTo(x+w-r, y); shape.quadraticCurveTo(x+w, y, x+w, y+r);
  shape.lineTo(x+w, y+d-r); shape.quadraticCurveTo(x+w, y+d, x+w-r, y+d);
  shape.lineTo(x+r, y+d); shape.quadraticCurveTo(x, y+d, x, y+d-r);
  shape.lineTo(x, y+r); shape.quadraticCurveTo(x, y, x+r, y);
  const g = new THREE.ExtrudeGeometry(shape, { depth:h, bevelEnabled:true, bevelThickness:h*0.14, bevelSize:h*0.12, bevelSegments:2, steps:1 });
  g.rotateX(-Math.PI/2);
  return new THREE.Mesh(g, m);
}
/* flat white silkscreen text laid on the board top (transparent decal) */
function silkLabel(text, wm, hm, col){
  const cv=document.createElement("canvas"); cv.width=256; cv.height=128;
  const ctx=cv.getContext("2d"); ctx.clearRect(0,0,256,128);
  ctx.fillStyle=col||"#cdd8d3"; ctx.font="700 74px 'IBM Plex Mono', monospace"; ctx.textAlign="center"; ctx.textBaseline="middle";
  ctx.fillText(text,128,70);
  const tex=new THREE.CanvasTexture(cv); tex.anisotropy=4;
  const m=new THREE.Mesh(new THREE.PlaneGeometry(wm,hm), new THREE.MeshBasicMaterial({map:tex,transparent:true,depthWrite:false}));
  m.rotation.x=-Math.PI/2; return m;
}
/* short curved wire pigtail (single-ESC power leads) */
function pigtail(x0,y0,z0, x1,y1,z1, r, col){
  const curve=new THREE.CatmullRomCurve3([ new THREE.Vector3(x0,y0,z0), new THREE.Vector3((x0+x1)/2,Math.max(y0,y1)+r*3,(z0+z1)/2), new THREE.Vector3(x1,y1,z1) ]);
  return new THREE.Mesh(new THREE.TubeGeometry(curve,20,r,8,false), mat(col,{roughness:.5,metalness:.1}));
}
/* procedural high-poly ESC board — single or 4-in-1. Returns a group with
   userData.nodes (terminals), userData.mosfets (heatmap), userData.parts (anatomy). */
function buildEscBoard(o, opts){
  opts = opts || {};
  const p = (o && o.phys) || {}, four = p.form_factor === "4in1";
  const board = (o && o.size) || (four ? [46,46,6] : [27,14,4]);
  const W = board[0]/1000, D = board[1]/1000, H = board[2]/1000 * 0.42;
  const g = new THREE.Group();
  g.userData.nodes = []; g.userData.mosfets = []; g.userData.parts = {};
  const addPart = (name, mesh)=>{ mesh.userData.part = name; (g.userData.parts[name]=g.userData.parts[name]||[]).push(mesh); g.add(mesh); return mesh; };
  const soldermask = four ? 0x141414 : 0x0d3b26;
  const plate = roundedBoard(W, D, H, Math.min(W,D)*0.10, mat(soldermask,{roughness:.6, metalness:.15}));
  addPart("substrate", plate);
  const pour = roundedBoard(W*0.94, D*0.94, H*0.25, Math.min(W,D)*0.08, mat(four?0x1c1c1c:0x114a30,{roughness:.7}));
  pour.position.y = H; addPart("substrate", pour);
  const topY = H*1.25, mn = Math.min(W,D);
  const mkNode = (id,x,z,color)=>{
    const post = new THREE.Mesh(new THREE.CylinderGeometry(mn*0.05, mn*0.055, H*1.4, 16), mat(color,{metalness:.85,roughness:.3,emissive:color,emissiveIntensity:.12}));
    post.position.set(x, topY+H*0.6, z); post.userData.node=id; post.userData.baseColor=color;
    g.add(post); g.userData.nodes.push(post); return post;
  };
  const mkMosfet = (x,z,s)=>{
    s = s || mn*0.13;
    const body = new THREE.Mesh(new THREE.BoxGeometry(s, H*1.2, s*0.72), mat(0x1a1d22,{roughness:.42,metalness:.3}));
    body.position.set(x, topY+H*0.6, z);
    const dimple = new THREE.Mesh(new THREE.CylinderGeometry(s*0.08,s*0.08,H*0.1,10), mat(0x2c3138)); dimple.position.set(x-s*0.28, topY+H*1.2, z-s*0.22);
    const tab = new THREE.Mesh(new THREE.BoxGeometry(s*0.92, H*0.3, s*0.2), mat(0xc0c8cf,{metalness:.92,roughness:.26}));
    tab.position.set(x, topY+H*0.55, z+s*0.42);
    for(let k=-1;k<=1;k++){ const pin=new THREE.Mesh(new THREE.BoxGeometry(s*0.15,H*0.16,s*0.16), mat(0x9aa5b1,{metalness:.9,roughness:.3})); pin.position.set(x+k*s*0.28, topY+H*0.08, z-s*0.42); addPart("mosfet",pin); }
    body.userData.baseColor = 0x1a1d22; g.userData.mosfets.push(body);
    addPart("mosfet", body); addPart("mosfet", dimple); addPart("mosfet", tab); return body;
  };
  const mkCap = (x,z,r,h)=>{
    const can = new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,28), mat(0x1a1f26,{metalness:.7,roughness:.3}));
    can.position.set(x, topY+h/2, z);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(r*0.96,r*0.96,h*0.04,28), mat(0xbcc3cb,{metalness:.85,roughness:.3}));
    top.position.set(x, topY+h, z); addPart("cap", can); addPart("cap", top); return can;
  };
  const mkIC = (x,z,s)=>{ const ic=new THREE.Mesh(new THREE.BoxGeometry(s,H*0.9,s), mat(0x101216,{roughness:.4})); ic.position.set(x,topY+H*0.45,z); const dot=new THREE.Mesh(new THREE.CylinderGeometry(s*0.09,s*0.09,H*0.2,10), mat(0x3a3f46)); dot.position.set(x-s*0.28,topY+H*0.9,z-s*0.28); addPart("mcu",ic); addPart("mcu",dot); return ic; };
  const mkPassives = (x0,z0,nx,nz,sp)=>{ for(let i=0;i<nx;i++) for(let j=0;j<nz;j++){ const r=new THREE.Mesh(new THREE.BoxGeometry(sp*0.5,H*0.4,sp*0.28), mat((i+j)%2?0x2b2f35:0x8a6a3a,{roughness:.5})); r.position.set(x0+i*sp,topY+H*0.2,z0+j*sp); addPart("passive",r); } };

  // castellated edge pads (gold half-cylinders along the two long edges)
  const castellate = (n)=>{ for(let i=0;i<n;i++){ const t=(i/(n-1)-0.5)*W*0.86; [-1,1].forEach(sz=>{ const c=new THREE.Mesh(new THREE.CylinderGeometry(mn*0.03,mn*0.03,H*0.9,8,1,false,0,Math.PI), mat(0xcaa63a,{metalness:.85,roughness:.35})); c.rotation.x=Math.PI/2; c.position.set(t, topY-H*0.1, sz*D*0.5); addPart("substrate",c); }); } };
  // silkscreen decal on the board top (label per pad group)
  const label = (t,x,z,w,col)=>{ const m=silkLabel(t, w||mn*0.28, w||mn*0.28, col); m.position.set(x, topY+H*0.27, z); addPart("substrate", m); };

  if(!four){
    for(let i=0;i<3;i++){ mkMosfet(-W*0.30+i*W*0.22, -D*0.20); mkMosfet(-W*0.30+i*W*0.22, D*0.14); }
    mkIC(W*0.30, -D*0.12, mn*0.16);
    mkCap(W*0.34, D*0.16, mn*0.13, H*3.2);
    mkPassives(-W*0.04, D*0.30, 4, 1, mn*0.09);
    const jst = new THREE.Mesh(new THREE.BoxGeometry(W*0.16,H*1.1,D*0.3), mat(0xe8ecef,{roughness:.6,metalness:.05})); jst.position.set(W*0.40, topY+H*0.55, -D*0.02); addPart("signal", jst);
    mkNode("escP+", -W*0.42, -D*0.30, 0xc23b2e);
    mkNode("escP-", -W*0.42, D*0.30, 0x22262b);
    mkNode("escA", W*0.44, -D*0.28, 0xd8b93c);
    mkNode("escB", W*0.44, 0, 0xd8b93c);
    mkNode("escC", W*0.44, D*0.28, 0xd8b93c);
    castellate(9);
    label("+", -W*0.42, -D*0.30, mn*0.34, "#e08a72"); label("−", -W*0.42, D*0.30, mn*0.34, "#c9d4cf");
    label("A", W*0.44, -D*0.28, mn*0.26, "#e6cf7a"); label("B", W*0.44, 0, mn*0.26, "#e6cf7a"); label("C", W*0.44, D*0.28, mn*0.26, "#e6cf7a");
    // fat red/black supply pigtails off the power pads
    addPart("signal", pigtail(-W*0.42,topY+H*0.6,-D*0.30, -W*0.62,topY+H*0.2,-D*0.30, mn*0.05, 0xc23b2e));
    addPart("signal", pigtail(-W*0.42,topY+H*0.6, D*0.30, -W*0.62,topY+H*0.2, D*0.30, mn*0.05, 0x1a1d22));
  }else{
    [-1,1].forEach(sx=>[-1,1].forEach(sz=>{
      for(let i=0;i<3;i++){ mkMosfet(sx*(W*0.20+i*W*0.05), sz*D*0.34, mn*0.075); mkMosfet(sx*(W*0.34), sz*(D*0.16+i*D*0.06), mn*0.075); }
    }));
    // central FC stack pin headers (2×4)
    for(let r=0;r<2;r++) for(let cix=0;cix<4;cix++){ const pin=new THREE.Mesh(new THREE.BoxGeometry(W*0.012,H*1.7,W*0.012), mat(0xcaa63a,{metalness:.85,roughness:.35})); pin.position.set((r?W*0.05:-W*0.05), topY+H*0.85, (cix-1.5)*W*0.05); addPart("signal",pin); }
    const hdrBlk=new THREE.Mesh(new THREE.BoxGeometry(W*0.14,H*0.6,D*0.28), mat(0x101216)); hdrBlk.position.set(0,topY+H*0.3,0); addPart("signal",hdrBlk);
    for(let i=0;i<3;i++) mkCap((i-1)*W*0.14, D*0.02, mn*0.06, H*2.6);
    mkPassives(-W*0.10, -D*0.08, 3, 1, mn*0.06);
    // XT60-style input connector body on the −X edge
    const xt=new THREE.Mesh(new THREE.BoxGeometry(W*0.10,H*2.0,D*0.22), mat(0xe0b400,{roughness:.5,metalness:.15})); xt.position.set(-W*0.46,topY+H*1.0,0); addPart("signal",xt);
    mkNode("escP+", -W*0.44, -D*0.14, 0xc23b2e);
    mkNode("escP-", -W*0.44, D*0.14, 0x22262b);
    mkNode("escA", W*0.44, -D*0.24, 0xd8b93c);
    mkNode("escB", W*0.44, 0, 0xd8b93c);
    mkNode("escC", W*0.44, D*0.24, 0xd8b93c);
    [[-1,-1],[-1,1],[1,-1],[1,1]].forEach((cc,i)=>{ const gr=new THREE.Mesh(new THREE.CylinderGeometry(mn*0.05,mn*0.05,H*1.3,14), mat(0x0d1013,{metalness:.4})); gr.position.set(cc[0]*W*0.42,topY+H*0.3,cc[1]*D*0.42); addPart("mount",gr);
      label("M"+(i+1), cc[0]*W*0.30, cc[1]*D*0.30, mn*0.16, "#8fa0aa"); });
    castellate(11);
    label("+", -W*0.42, -D*0.14, mn*0.22, "#e08a72"); label("−", -W*0.42, D*0.14, mn*0.22, "#c9d4cf");
    label("A", W*0.44, -D*0.24, mn*0.16, "#e6cf7a"); label("B", W*0.44, 0, mn*0.16, "#e6cf7a"); label("C", W*0.44, D*0.24, mn*0.16, "#e6cf7a");
  }
  applyExplode(g, opts.explode != null ? opts.explode : 100);
  return g;
}
function applyExplode(g, pct){
  const f = Math.max(0, Math.min(1, pct/100)), H = 0.02;
  const lift = { substrate:0, passive:0.6, mosfet:1.0, cap:1.6, mcu:1.2, signal:1.4, mount:0.4 };
  Object.keys(g.userData.parts||{}).forEach(name=>{
    g.userData.parts[name].forEach(mesh=>{
      if(mesh.userData.baseY == null) mesh.userData.baseY = mesh.position.y;
      mesh.position.y = mesh.userData.baseY + (lift[name]||0)*f*H;
    });
  });
  (g.userData.nodes||[]).forEach(n=>{ if(n.userData.baseY==null) n.userData.baseY=n.position.y; n.position.y = n.userData.baseY + 1.0*f*H; });
}
/* procedural bench DC supply — chassis, panel, two displays, CV/CC LED, knobs, posts. */
function buildDcSupply(){
  const g = new THREE.Group(); g.userData.nodes = [];
  const W=0.9, Hc=0.5, Dp=0.62;
  const body = new THREE.Mesh(new THREE.BoxGeometry(W,Hc,Dp), mat(0x2b3138,{roughness:.5,metalness:.4}));
  body.position.y = Hc/2; g.add(body);
  const face = new THREE.Mesh(new THREE.BoxGeometry(W*1.002,Hc*0.98,0.01), mat(0x1b2026,{roughness:.6}));
  face.position.set(0, Hc/2, Dp/2+0.005); g.add(face);
  for(let i=0;i<6;i++){ const v=new THREE.Mesh(new THREE.BoxGeometry(0.02,Hc*0.6,0.001), mat(0x0f1216)); v.position.set(-W/2+0.07+i*0.03,Hc/2,-Dp/2-0.001); g.add(v); }
  const mkDisplay = (x,key)=>{
    const cv=document.createElement("canvas"); cv.width=256; cv.height=96;
    const tex=new THREE.CanvasTexture(cv);
    const scr=new THREE.Mesh(new THREE.PlaneGeometry(W*0.32,Hc*0.34), new THREE.MeshBasicMaterial({map:tex}));
    scr.position.set(x, Hc*0.66, Dp/2+0.012); g.add(scr); g.userData[key]={cv,tex};
  };
  mkDisplay(-W*0.20,"dispV"); mkDisplay(W*0.20,"dispA");
  const led = new THREE.Mesh(new THREE.CircleGeometry(0.018,16), new THREE.MeshBasicMaterial({color:0x37e0a0}));
  led.position.set(0, Hc*0.66, Dp/2+0.013); g.add(led); g.userData.led = led;
  [-W*0.28,W*0.28].forEach(x=>{ const k=new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.055,0.03,20), mat(0x0d1013,{metalness:.5,roughness:.4})); k.rotation.x=Math.PI/2; k.position.set(x,Hc*0.30,Dp/2+0.02); g.add(k); const m=new THREE.Mesh(new THREE.BoxGeometry(0.008,0.03,0.006), mat(0xc7cdd4)); m.position.set(x,Hc*0.35,Dp/2+0.03); g.add(m); });
  const mkPost = (x,id,color,sym)=>{
    const collar=new THREE.Mesh(new THREE.CylinderGeometry(0.038,0.042,0.016,20), mat(color,{metalness:.4,roughness:.45})); collar.rotation.x=Math.PI/2; collar.position.set(x,Hc*0.14,Dp/2+0.016); g.add(collar);
    const base=new THREE.Mesh(new THREE.CylinderGeometry(0.03,0.034,0.02,18), mat(0x0d1013,{metalness:.4})); base.rotation.x=Math.PI/2; base.position.set(x,Hc*0.14,Dp/2+0.028); g.add(base);
    const post=new THREE.Mesh(new THREE.CylinderGeometry(0.022,0.024,0.05,18), mat(color,{metalness:.6,roughness:.35,emissive:color,emissiveIntensity:.15})); post.rotation.x=Math.PI/2; post.position.set(x,Hc*0.14,Dp/2+0.055);
    const cap=new THREE.Mesh(new THREE.SphereGeometry(0.026,16,12), mat(color,{metalness:.5,roughness:.4})); cap.position.set(x,Hc*0.14,Dp/2+0.08); g.add(cap);
    post.userData.node=id; post.userData.baseColor=color; g.add(post); g.userData.nodes.push(post);
    // etched +/− symbol above the post
    const lc=document.createElement("canvas"); lc.width=lc.height=64; const lx=lc.getContext("2d"); lx.fillStyle="#dfe6e2"; lx.font="700 52px 'IBM Plex Mono'"; lx.textAlign="center"; lx.textBaseline="middle"; lx.fillText(sym,32,36);
    const lt=new THREE.CanvasTexture(lc); const lm=new THREE.Mesh(new THREE.PlaneGeometry(0.05,0.05), new THREE.MeshBasicMaterial({map:lt,transparent:true})); lm.position.set(x,Hc*0.24,Dp/2+0.008); g.add(lm);
  };
  mkPost(-W*0.14,"sup+",0xc23b2e,"+"); mkPost(W*0.14,"sup-",0x22262b,"−");
  // carry handle
  const hmat=mat(0x1a1f24,{metalness:.4,roughness:.5});
  [-1,1].forEach(sx=>{ const leg=new THREE.Mesh(new THREE.TorusGeometry(0.12,0.012,10,18,Math.PI), hmat); leg.position.set(sx*W*0.42,Hc,0); leg.rotation.y=Math.PI/2; g.add(leg); });
  const grip=new THREE.Mesh(new THREE.CylinderGeometry(0.012,0.012,W*0.84,12), hmat); grip.rotation.z=Math.PI/2; grip.position.set(0,Hc+0.12,0); g.add(grip);
  // brand plate
  const bc=document.createElement("canvas"); bc.width=256; bc.height=64; const bx=bc.getContext("2d"); bx.fillStyle="#c9d4cf"; bx.font="700 30px 'IBM Plex Mono'"; bx.textAlign="left"; bx.textBaseline="middle"; bx.fillText("DC BENCH  30V / 40A",10,34);
  const bt=new THREE.CanvasTexture(bc); const bp=new THREE.Mesh(new THREE.PlaneGeometry(W*0.6,Hc*0.12), new THREE.MeshBasicMaterial({map:bt,transparent:true})); bp.position.set(-W*0.06,Hc*0.44,Dp/2+0.008); g.add(bp);
  updateSupplyDisplays(g, 0, 0, "CV");
  return g;
}
function drawSevenSeg(disp, text, color){
  const { cv, tex } = disp, ctx = cv.getContext("2d");
  ctx.fillStyle = "#05080a"; ctx.fillRect(0,0,cv.width,cv.height);
  ctx.fillStyle = color; ctx.font = "700 62px 'IBM Plex Mono', monospace"; ctx.textAlign="right"; ctx.textBaseline="middle";
  ctx.shadowColor = color; ctx.shadowBlur = 12; ctx.fillText(text, cv.width-14, cv.height/2+4);
  ctx.shadowBlur = 0; tex.needsUpdate = true;
}
function updateSupplyDisplays(g, V, A, mode){
  if(!g || !g.userData.dispV) return;
  const green="#37e0a0", amber="#ffb066";
  drawSevenSeg(g.userData.dispV, V.toFixed(1), green);
  drawSevenSeg(g.userData.dispA, A.toFixed(1), mode==="CC"?amber:green);
  if(g.userData.led) g.userData.led.material.color.setHex(mode==="CC"?0xffb066:0x37e0a0);
}
function buildFallback(spec){
  const T = THREE, g = new T.Group();
  const c = spec.color, s = spec.s || 1;
  const add = (geo,m,x,y,z,rx,ry,rz)=>{ const mesh=new T.Mesh(geo,m); mesh.position.set(x||0,y||0,z||0); mesh.rotation.set(rx||0,ry||0,rz||0); g.add(mesh); return mesh; };
  switch(spec.kind){
    case "prop":
      add(new T.CylinderGeometry(.09,.09,.12,16), mat(0x22262b));
      for(let i=0;i<2;i++) add(new T.BoxGeometry(1.7,.02,.18), mat(c), 0,.03,0, 0,i*Math.PI,.12);
      break;
    case "motor":
      add(new T.CylinderGeometry(.42,.42,.5,28), mat(c));
      add(new T.CylinderGeometry(.46,.46,.1,28), mat(0x22262b), 0,.3,0);
      add(new T.CylinderGeometry(.07,.07,.35,12), mat(0xb9c2c9), 0,.55,0);
      for(let i=0;i<8;i++){ const a=i/8*Math.PI*2; add(new T.BoxGeometry(.05,.42,.1), mat(0x33393f), Math.cos(a)*.43,0,Math.sin(a)*.43, 0,-a,0); }
      break;
    case "esc":
      add(new T.BoxGeometry(1.1,.22,.55), mat(0x0d3b26));
      add(new T.BoxGeometry(1.12,.06,.57), mat(0x22262b), 0,.14,0);
      break;
    case "heatsink":
      add(new T.BoxGeometry(1.0,.14,.7), mat(0x9aa5b1,{metalness:.7,roughness:.3}));
      for(let i=0;i<7;i++) add(new T.BoxGeometry(.06,.34,.68), mat(0xb4bec7,{metalness:.7,roughness:.3}), -.42+i*.14,.24,0);
      break;
    case "stand":
      add(new T.BoxGeometry(1.5,.12,1.0), mat(0x3a4148,{metalness:.4,roughness:.5}));
      add(new T.CylinderGeometry(.13,.17,1.2,20), mat(0x9aa5b1,{metalness:.6,roughness:.35}), 0,.72,0);
      add(new T.BoxGeometry(.7,.08,.7), mat(0x9aa5b1,{metalness:.6,roughness:.35}), 0,1.36,0);
      break;
    default:
      add(new T.SphereGeometry(.4,18,14), mat(0xb8c4bf,{transparent:true,opacity:.35}));
  }
  g.scale.setScalar(s*.9);
  return g;
}
const modelCache = {};
let dracoLoader = null;
function draco(){ if(!dracoLoader && THREE.DRACOLoader){ dracoLoader=new THREE.DRACOLoader(); dracoLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.4.1/"); } return dracoLoader; }
function brightenModel(obj){
  obj.traverse(o=>{ if(!o.isMesh||!o.material) return;
    (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{
      if(!m||m.userData.__brightened) return; m.userData.__brightened=true;
      if(m.color) m.color.lerp(new THREE.Color(0xffffff),0.09);
      if(m.emissive){ m.emissive.copy(m.color||new THREE.Color(0x222222)).multiplyScalar(0.07); m.emissiveIntensity=1; }
      if(m.metalness!=null) m.metalness=Math.min(m.metalness,0.5);
      if(m.roughness!=null) m.roughness=Math.min(m.roughness+0.05,1);
      m.needsUpdate=true;
    });
  });
  return obj;
}
function loadModelFile(url){
  if(modelCache[url]) return modelCache[url];
  modelCache[url] = new Promise((resolve,reject)=>{
    const loader=new THREE.GLTFLoader(); const dl=draco(); if(dl) loader.setDRACOLoader(dl);
    loader.load(url, gltf=>resolve(brightenModel(gltf.scene)), undefined, reject);
  });
  return modelCache[url];
}
const ORIENT = { propeller:"flat", motor:"axis" };
function autoOrient(obj, rule){
  if(!rule || rule==="none") return;
  const s=new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
  const dims=[s.x,s.y,s.z]; let axis;
  if(rule==="flat"){ axis=dims.indexOf(Math.min(...dims)); }
  else{ const med=[...dims].sort((a,b)=>a-b)[1]; const dev=dims.map(d=>Math.abs(d-med)); axis=dev.indexOf(Math.max(...dev)); }
  if(axis===0) obj.rotation.z=Math.PI/2; else if(axis===2) obj.rotation.x=-Math.PI/2;
}
function vertexCentroidXZ(root){
  root.updateMatrixWorld(true);
  let x=0,z=0,n=0; const v=new THREE.Vector3();
  root.traverse(m=>{ if(!(m.isMesh&&m.geometry&&m.geometry.attributes&&m.geometry.attributes.position)) return;
    const pp=m.geometry.attributes.position, step=Math.max(1,Math.floor(pp.count/2000));
    for(let i=0;i<pp.count;i+=step){ v.fromBufferAttribute(pp,i); m.localToWorld(v); x+=v.x; z+=v.z; n++; } });
  return n ? { x:x/n, z:z/n } : null;
}
function fitUnit(obj, span, o, orientOverride){
  const pre=new THREE.Group(); pre.add(obj);
  if(o){ if(orientOverride){ autoOrient(pre, orientOverride); } else autoOrient(pre, ORIENT[o.catKey]||"none"); }
  const outer=new THREE.Group(); outer.add(pre);
  const box=new THREE.Box3().setFromObject(outer);
  const size=box.getSize(new THREE.Vector3());
  const maxDim=Math.max(size.x,size.y,size.z)||1;
  const c=box.getCenter(new THREE.Vector3());
  if(o && (o.catKey==="propeller"||o.catKey==="motor")){ const hub=vertexCentroidXZ(outer); if(hub){ c.x=hub.x; c.z=hub.z; } }
  pre.position.sub(c);
  outer.scale.setScalar((span||1.6)/maxDim);
  return outer;
}
function orientMotorCombo(combo, parts){
  if(!parts||parts.length<2) return false;
  const cen=pp=>new THREE.Box3().setFromObject(pp).getCenter(new THREE.Vector3());
  const sep=cen(parts[parts.length-1]).sub(cen(parts[0]));
  if(sep.length()<=1e-6) return false;
  const a=[Math.abs(sep.x),Math.abs(sep.y),Math.abs(sep.z)], ax=a.indexOf(Math.max(a[0],a[1],a[2]));
  const from=new THREE.Vector3(ax===0?Math.sign(sep.x):0, ax===1?Math.sign(sep.y):0, ax===2?Math.sign(sep.z):0);
  combo.quaternion.setFromUnitVectors(from, new THREE.Vector3(0,1,0));
  combo.updateMatrixWorld(true); return true;
}
function seatModel(gp, mode){
  if(gp.parent) gp.parent.updateWorldMatrix(true,false);
  const b=new THREE.Box3().setFromObject(gp); if(b.isEmpty()) return;
  const c=gp.getWorldPosition(new THREE.Vector3());
  const s=(gp.parent?gp.parent.getWorldScale(new THREE.Vector3()).y:1)||1;
  if(mode==="hang") gp.position.y-=(b.max.y-c.y)/s; else gp.position.y+=(c.y-b.min.y)/s;
}
function modelFor(o, span, onReady){
  span=span||1.6;
  const g=new THREE.Group();
  g.add(fitUnit(buildFallback((o&&o.fallback)||{kind:"none",color:0xcccccc,s:1}), span, null));
  if(o && o.files && o.files.length){
    Promise.all(o.files.map(loadModelFile)).then(masters=>{
      const merged=new THREE.Group(); const parts=masters.map(m=>m.clone(true)); parts.forEach(pp=>merged.add(pp));
      const oriented=o.catKey==="motor" && orientMotorCombo(merged,parts);
      const fitted=fitUnit(merged, span, o, oriented?"none":undefined);
      while(g.children.length) g.remove(g.children[0]);
      g.add(fitted); if(onReady) onReady(g);
    }).catch(err=>console.warn("model load failed", o&&o.id, err.message||err));
  }
  return g;
}
function standModel(span, onReady){
  const g=new THREE.Group();
  g.add(fitUnit(buildFallback({kind:"stand",color:0x9aa5b1,s:1}), span, null));
  loadModelFile(STAND_MODEL).then(m=>{ const fitted=fitUnit(m.clone(true),span,null); while(g.children.length) g.remove(g.children[0]); g.add(fitted); if(onReady) onReady(g); }).catch(()=>{});
  return g;
}
function measuredHeight(group){ const box=new THREE.Box3().setFromObject(group); return { min:box.min.y, max:box.max.y, h:box.max.y-box.min.y }; }
/* scale a procedural group so its largest footprint dimension = span */
function scaleToSpan(g, span){
  const box=new THREE.Box3().setFromObject(g), sz=box.getSize(new THREE.Vector3());
  const maxDim=Math.max(sz.x, sz.z)||1; g.scale.setScalar(span/maxDim); return g;
}

/* ════════════ 7 · PREVIEW ENGINE ════════════ */
let previewRenderer = null;
const previews = new Map();
function initPreviewEngine(){
  previewRenderer = new THREE.WebGLRenderer({antialias:true, alpha:true});
  previewRenderer.setSize(220,150); previewRenderer.setPixelRatio(1);
}
function previewModel(o){
  if(o && o.catKey === "esc"){ const g = buildEscBoard(o, {explode:0}); scaleToSpan(g, 1.7); return g; }
  return modelFor(o, 1.6);
}
function registerPreview(canvas, o){
  if(!canvas || !o || !previewRenderer) return;
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff,.9));
  const d = new THREE.DirectionalLight(0xffffff,.9); d.position.set(2,3,2); scene.add(d);
  const d2 = new THREE.DirectionalLight(0xdce3f2,.35); d2.position.set(-2,-1,-2); scene.add(d2);
  const group = previewModel(o); scene.add(group);
  const camera = new THREE.PerspectiveCamera(34, 220/150, .1, 50);
  camera.position.set(1.9,1.5,1.9); camera.lookAt(0,0,0);
  previews.set(canvas, {scene, camera, group});
}
let frameNo = 0;
function blitPreviews(){
  if(!previewRenderer) return; let i=0;
  for(const [cv,p] of previews){
    if(!cv.isConnected){ previews.delete(cv); continue; }
    if((i++ + frameNo) % 2 !== 0) continue;
    p.group.rotation.y += .022;
    previewRenderer.render(p.scene, p.camera);
    const ctx = cv.getContext("2d"); ctx.clearRect(0,0,cv.width,cv.height);
    ctx.drawImage(previewRenderer.domElement, 0,0, cv.width, cv.height);
  }
}

/* ════════════ 7b · FAILURE FX (compact smoke + sparks) ════════════ */
const FX = (function(){
  let host=null, tex=null, spk=null, inited=false;
  const emitters=new Map(); const puffs=[], sparks=[]; const _v=new THREE.Vector3();
  function radial(stops){ const c=document.createElement("canvas"); c.width=c.height=64; const g=c.getContext("2d");
    const grd=g.createRadialGradient(32,32,0,32,32,32); stops.forEach(s=>grd.addColorStop(s[0],s[1])); g.fillStyle=grd; g.fillRect(0,0,64,64);
    const t=new THREE.Texture(c); t.needsUpdate=true; return t; }
  function init(sc){ if(inited) return; inited=true; host=sc;
    tex=radial([[0,"rgba(64,64,68,.9)"],[.55,"rgba(48,48,52,.5)"],[1,"rgba(38,38,42,0)"]]);
    spk=radial([[0,"rgba(255,244,200,1)"],[.4,"rgba(255,150,40,.9)"],[1,"rgba(255,70,20,0)"]]); }
  function sprite(t,add){ return new THREE.Sprite(new THREE.SpriteMaterial({map:t,transparent:true,depthWrite:false,blending:add?THREE.AdditiveBlending:THREE.NormalBlending})); }
  function puff(x,y,z,it){ if(!inited||puffs.length>140) return; const s=sprite(tex,false); s.material.color.setHex(0x30333a);
    s.position.set(x+(Math.random()-.5)*.1,y,z+(Math.random()-.5)*.1); const s0=.18+it*.22; s.scale.setScalar(s0); host.add(s);
    puffs.push({s,age:0,life:1+Math.random()*.7+it*.5,s0,s1:s0+.6+it,vy:.26+it*.42,op:.55+it*.4}); }
  function burst(x,y,z,n){ if(!inited) return; for(let k=0;k<n;k++){ if(sparks.length>80) break; const s=sprite(spk,true);
    s.position.set(x,y,z); s.scale.setScalar(.05+Math.random()*.06); host.add(s); const a=Math.random()*Math.PI*2, sp=.6+Math.random()*1.8;
    sparks.push({s,age:0,life:.4+Math.random()*.5,vx:Math.cos(a)*sp,vy:1.1+Math.random()*1.9,vz:Math.sin(a)*sp}); } }
  function setEmitter(id,obj,kind){ emitters.set(id,{obj,kind,intensity:0,acc:0}); }
  function kindIntensity(kind,v){ emitters.forEach(e=>{ if(e.kind===kind) e.intensity=v; }); }
  function burstKind(kind,n){ emitters.forEach(e=>{ if(e.kind===kind&&e.obj){ e.obj.getWorldPosition(_v); burst(_v.x,_v.y,_v.z,n); } }); }
  function clear(){ puffs.forEach(p=>{ if(host) host.remove(p.s); }); sparks.forEach(p=>{ if(host) host.remove(p.s); }); puffs.length=0; sparks.length=0; emitters.clear(); }
  function tick(dt){ if(!inited) return;
    emitters.forEach(e=>{ if(e.intensity>.03&&e.obj){ e.acc+=e.intensity*e.intensity*30*dt; while(e.acc>=1){ e.acc-=1; e.obj.getWorldPosition(_v); puff(_v.x,_v.y,_v.z,e.intensity); if(e.intensity>.8&&Math.random()<.2) burst(_v.x,_v.y,_v.z,2); } } });
    for(let i=puffs.length-1;i>=0;i--){ const p=puffs[i]; p.age+=dt; const k=p.age/p.life; if(k>=1){ host.remove(p.s); puffs.splice(i,1); continue; } p.s.position.y+=p.vy*dt; p.s.scale.setScalar(p.s0+(p.s1-p.s0)*k); p.s.material.opacity=p.op*(1-k); }
    for(let i=sparks.length-1;i>=0;i--){ const p=sparks[i]; p.age+=dt; const k=p.age/p.life; if(k>=1){ host.remove(p.s); sparks.splice(i,1); continue; } p.vy-=6*dt; p.s.position.x+=p.vx*dt; p.s.position.y+=p.vy*dt; p.s.position.z+=p.vz*dt; p.s.material.opacity=1-k; } }
  return { init, setEmitter, kindIntensity, burst, burstKind, clear, tick };
})();
const smokeRamp = (v,a,b)=>Math.max(0,Math.min(1,(v-a)/(b-a)));

/* ════════════ 8 · BENCH SCENE + WIRING ════════════ */
let renderer, scene, camera, controls, rig;
let supplyGroup=null, escGroup=null, motorGroup=null, propSpinner=null, wiresGroup=null;
let benchNodes=[], pendingNode=null, heatT=25, spinPhase=0;
function sceneMode(){ return currentExp().exp.metric; }        // explore | map | latency | temp
function isAnatomy(){ return sceneMode()==="explore"; }

function initViewport(){
  const host=$("viewport");
  const w=host.clientWidth||600, h=host.clientHeight||400;
  renderer=new THREE.WebGLRenderer({antialias:true, alpha:true});
  renderer.setSize(w,h); renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  host.appendChild(renderer.domElement);
  scene=new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff,.7));
  const key=new THREE.DirectionalLight(0xffffff,.95); key.position.set(4,6,3); scene.add(key);
  const fill=new THREE.DirectionalLight(0xdde5f0,.4); fill.position.set(-4,2,-4); scene.add(fill);
  scene.add(new THREE.GridHelper(16,32,0xc4d1cc,0xe1e9e6));
  FX.init(scene);
  camera=new THREE.PerspectiveCamera(38, w/h, .1, 200);
  camera.position.set(3.6,3.0,4.8);
  controls=new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0,.7,0); controls.enableDamping=true; controls.dampingFactor=.08;
  controls.minDistance=1.5; controls.maxDistance=22;
  bindWiringPointer();
  buildScene();
}
function resizeViewport(){ const host=$("viewport"); if(!host||!renderer) return; const w=host.clientWidth,h=host.clientHeight; if(!w||!h) return; renderer.setSize(w,h); camera.aspect=w/h; camera.updateProjectionMatrix(); }
function clearScene(){
  if(rig){ scene.remove(rig); rig=null; }
  supplyGroup=escGroup=motorGroup=propSpinner=wiresGroup=null; benchNodes=[]; pendingNode=null;
  FX.clear();
}
function buildScene(){ clearScene(); if(isAnatomy()) buildAnatomy(); else buildBench(); syncCamera(); }
function syncCamera(){ if(!controls) return; controls.target.set(isAnatomy()?0:.2, isAnatomy()?.4:.7, 0); }

function buildAnatomy(){
  rig=new THREE.Group(); scene.add(rig);
  escGroup=buildEscBoard(opt("esc"), {explode:state.explode}); scaleToSpan(escGroup, 2.6);
  escGroup.position.y=.6; rig.add(escGroup);
  benchNodes=(escGroup.userData.nodes||[]).slice();
  FX.setEmitter("esc", escGroup, "esc");
}
function buildBench(){
  rig=new THREE.Group(); scene.add(rig);
  // DC supply
  supplyGroup=buildDcSupply(); supplyGroup.position.set(-2.0,0,-.2); rig.add(supplyGroup);
  FX.setEmitter("supply", supplyGroup, "supply");
  // ESC on a small mat
  const mat0=new THREE.Mesh(new THREE.BoxGeometry(1.7,.06,1.1), mat(0x2a3138,{roughness:.6})); mat0.position.set(0,.03,.1); rig.add(mat0);
  escGroup=buildEscBoard(opt("esc"), {explode:0}); scaleToSpan(escGroup, 1.5);
  escGroup.position.set(0,.09,.1); rig.add(escGroup);
  if(state.escDead) tintBurnt();
  FX.setEmitter("esc", escGroup, "esc");
  // Motor stand + motor + prop on the right
  const mo=opt("motor"), pr=opt("propeller");
  const stand=standModel(1.9, s=>{ const hm=measuredHeight(s); s.position.y=-hm.min; placeMotor(hm.max-hm.min); });
  stand.position.set(2.0,0,0); rig.add(stand);
  placeMotor(1.5);
  function placeMotor(standTop){
    if(motorGroup){ rig.remove(motorGroup); }
    if(propSpinner){ rig.remove(propSpinner); }
    const mSpan=mo && mo.size ? Math.max(...mo.size)/1000*22 : .7;
    motorGroup=modelFor(mo, mSpan, g=>seatModel(g,"base"));
    motorGroup.position.set(2.0, standTop, 0); rig.add(motorGroup);
    FX.setEmitter("motor", motorGroup, "motor");
    const pDia=pr ? ((pr.phys&&pr.phys.diameter_in)||8)*25.4/1000*11 : 1.2;
    propSpinner=new THREE.Group(); propSpinner.position.set(2.0, standTop+mSpan*0.7, 0); rig.add(propSpinner);
    propSpinner.add(modelFor(pr, pDia));
    // motor phase terminals (nodes) at the motor base, facing front (+z)
    ["mA","mB","mC"].forEach((id,i)=>{
      const node=new THREE.Mesh(new THREE.SphereGeometry(.05,14,10), mat(0xd8b93c,{metalness:.7,roughness:.3,emissive:0xd8b93c,emissiveIntensity:.12}));
      node.position.set(2.0+(i-1)*.16, standTop+.05, .28); node.userData.node=id; node.userData.baseColor=0xd8b93c;
      rig.add(node);
    });
    rebuildBenchNodes();
    redrawWires();
  }
  // supply + esc nodes now; motor nodes added by placeMotor
  wiresGroup=new THREE.Group(); rig.add(wiresGroup);
  rebuildBenchNodes(); redrawWires();
}
function rebuildBenchNodes(){
  benchNodes=[];
  if(supplyGroup) benchNodes.push(...(supplyGroup.userData.nodes||[]));
  if(escGroup) benchNodes.push(...(escGroup.userData.nodes||[]));
  if(rig) rig.children.forEach(ch=>{ if(ch.userData && ch.userData.node && ch.userData.node[0]==="m") benchNodes.push(ch); });
}
function nodeById(id){ return benchNodes.find(n=>n.userData.node===id); }
function redrawWires(){
  if(!wiresGroup) return;
  while(wiresGroup.children.length) wiresGroup.remove(wiresGroup.children[0]);
  const v=new THREE.Vector3();
  state.wires.forEach(w=>{
    const a=nodeById(w[0]), b=nodeById(w[1]); if(!a||!b) return;
    const pa=a.getWorldPosition(new THREE.Vector3()), pb=b.getWorldPosition(v.clone());
    const mid=pa.clone().add(pb).multiplyScalar(.5); mid.y+=Math.max(.25, pa.distanceTo(pb)*.18);   // droop
    const curve=new THREE.CatmullRomCurve3([pa, mid, pb]);
    const color=(w[0][0]==="s"&&w[0]==="sup+")||w[1]==="sup+"||w[0]==="escP+"||w[1]==="escP+" ? 0xc23b2e : (w.some(x=>x[0]==="e"&&x.length>4)?0x22262b:0x22262b);
    const wireCol = wireColor(w);
    const tube=new THREE.Mesh(new THREE.TubeGeometry(curve, 24, .022, 8, false), mat(wireCol,{roughness:.5,metalness:.1}));
    tube.userData.wire=w; wiresGroup.add(tube);
  });
}
function wireColor(w){
  if(w.includes("sup+")||w.includes("escP+")) return 0xc23b2e;
  if(w.includes("sup-")||w.includes("escP-")) return 0x222831;
  return 0xd8b93c;   // phase
}
function highlightNode(node, on){
  if(!node) return;
  const c=node.userData.baseColor||0xffffff;
  if(node.material){ node.material.emissive.setHex(on?0x37e0a0:c); node.material.emissiveIntensity=on?.9:.12; }
}
function tintBurnt(){
  if(!escGroup) return;
  escGroup.traverse(o=>{ if(o.isMesh&&o.material&&o.material.color){ o.material.color.multiplyScalar(.4); o.material.emissive && o.material.emissive.setHex(0x110000); } });
}
function bindWiringPointer(){
  const dom=renderer.domElement; let downX=0, downY=0;
  dom.addEventListener("pointerdown", e=>{ downX=e.clientX; downY=e.clientY; });
  dom.addEventListener("pointerup", e=>{
    if(Math.hypot(e.clientX-downX, e.clientY-downY) > 6) return;   // drag → orbit, not a click
    const rect=dom.getBoundingClientRect();
    const ndc=new THREE.Vector2(((e.clientX-rect.left)/rect.width)*2-1, -((e.clientY-rect.top)/rect.height)*2+1);
    const rc=new THREE.Raycaster(); rc.setFromCamera(ndc, camera);
    // anatomy: pick a component to read its datasheet
    if(isAnatomy()){ pickComponent(rc); return; }
    if(state.escDead) return;
    // wire nodes first
    const hitNode=rc.intersectObjects(benchNodes, false)[0];
    if(hitNode){ onNodeClick(hitNode.object); return; }
    // else maybe remove a wire
    if(wiresGroup){ const hw=rc.intersectObjects(wiresGroup.children, false)[0]; if(hw && !pendingNode){ removeWire(hw.object.userData.wire); return; } }
    if(pendingNode){ highlightNode(pendingNode,false); pendingNode=null; }
  });
}
function onNodeClick(node){
  if(!pendingNode){ pendingNode=node; highlightNode(node,true); sfx("tick"); return; }
  if(pendingNode===node){ highlightNode(node,false); pendingNode=null; return; }
  addWire(pendingNode.userData.node, node.userData.node);
  highlightNode(pendingNode,false); pendingNode=null;
}
function addWire(a,b){
  if(a===b) return;
  if(connected(a,b)) return;
  state.wires.push([a,b]); redrawWires(); sfx("tick");
  const w=evalWiring();
  if((w.reversePower||w.shorted) && !state.escDead){
    if(state.ilim > 8){ killEsc(w.shorted?"short":"reverse"); }
    else { sfx("warn"); }   // supply catches it in CC — survivable
  }
  onWiringChanged();
}
function removeWire(w){ state.wires=state.wires.filter(x=>x!==w); redrawWires(); onWiringChanged(); sfx("tick"); }
function onWiringChanged(){
  const w=evalWiring();
  if(!w.correctPower || !w.phaseComplete) state.armed=false;
  renderLog(); renderCalcChips(); renderChecklist(); syncRunControls(); saveState();
}
function killEsc(kind){
  state.escDead=true; state.armed=false;
  FX.burstKind("esc",10); FX.kindIntensity("esc",1); sfx("error");
  tintBurnt();
  showVerdictToast((kind==="short"?"Dead short — ":"Reverse polarity — ")+"ESC destroyed. Select a replacement to continue.", false);
  playFaultVoice("esc burnt", false);
  renderLog(); syncRunControls(); saveState();
}
function pickComponent(rc){
  const meshes=[]; if(escGroup) escGroup.traverse(o=>{ if(o.isMesh && o.userData.part) meshes.push(o); });
  const hit=rc.intersectObjects(meshes,false)[0];
  if(hit){ selectComponent(hit.object.userData.part); }
}

/* ════════════ 9 · UI RENDERING ════════════ */
const COMPONENTS = [
  { id:"substrate", parts:["substrate"], name:"FR4 substrate + solder-mask", color:0x0d3b26, role:"The glass-epoxy board that carries every copper trace and the ground/power planes.", note:"Copper pours double as the ESC's primary heatsink — bigger boards spread heat better (lower R_th)." },
  { id:"mosfet", parts:["mosfet"], name:"Power MOSFETs (3 half-bridges)", color:0x1a1d22, role:"Six N-channel FETs switch the battery current through the three motor phases in a bridge.", note:"Their on-resistance R_ds(on) sets the conduction loss I²·R — the dominant heat source you size cooling for." },
  { id:"mcu", parts:["mcu"], name:"MCU + gate driver", color:0x101216, role:"Reads the throttle command, runs the commutation firmware (BLHeli), and drives the FET gates.", note:"Digital protocols (DShot) are decoded here — no analog pulse capture, so no calibration or dead-band." },
  { id:"cap", parts:["cap"], name:"Bulk electrolytic capacitor", color:0x1a1f26, role:"Absorbs the switching-current ripple so the supply lead inductance doesn't spike the bus voltage.", note:"Its ESR carries ripple current I_rip²·ESR — a small but real extra loss; a missing cap can pop the FETs." },
  { id:"passive", parts:["passive"], name:"SMD passives", color:0x8a6a3a, role:"Gate resistors, sense resistors and decoupling caps around the driver stage.", note:"The shunt sense resistor is how BLHeli_32 reads phase current for telemetry and current limiting." },
  { id:"signal", parts:["signal"], name:"Signal connector", color:0xe8ecef, role:"Carries the throttle signal (PWM/DShot) and, on a 4-in-1, the FC stack header.", note:"A 4-in-1 stacks directly under the flight controller through this header — no per-arm signal leads." },
  { id:"power_pads", parts:[], nodes:["escP+","escP-"], name:"Battery / supply power pads", color:0xc23b2e, role:"The fat +/− input pads that take the pack (or bench-supply) current.", note:"No reverse-voltage protection — crossing these pads destroys the board in the first instant of contact." },
  { id:"phase_pads", parts:[], nodes:["escA","escB","escC"], name:"Three phase output pads", color:0xd8b93c, role:"Drive the motor's three windings. Any consistent 1-to-1 mapping commutates.", note:"Swap any two and the motor spins backward — the century-old three-phase-motor rule." },
  { id:"mount", parts:["mount"], name:"Mounting grommets", color:0x0d1013, role:"Soft-mount holes that isolate the board from frame vibration.", note:"On a 4-in-1 the corner pattern matches the 30.5 mm / 20 mm flight-stack standard." }
];
const compForPart = name => COMPONENTS.find(c=>(c.parts||[]).includes(name) || (c.nodes||[]).includes(name));
let selectedComp = null;
function tileInfo(key){ const o=opt(key); return { name:o?o.name:"—", sub:o?(o.specs[0]?o.specs[0][1]:""):"", preview:o }; }
const tileCanvases={};
function renderTiles(){
  const grid=$("paramGrid"); grid.innerHTML="";
  ESC_DB.categories.forEach(c=>{
    const info=tileInfo(c.key);
    const b=el("button","tile"); b.type="button";
    b.innerHTML='<div class="tile-top"><span class="tile-label">'+txt(c.label)+'</span><span class="tile-mass">'+txt(info.sub)+'</span></div>'+
      '<div class="tile-view"><canvas width="150" height="100"></canvas></div>'+
      '<span class="tile-sel">'+txt(info.name)+'</span>';
    b.addEventListener("click", ()=>openPicker(c.key));
    grid.appendChild(b);
    const cv=b.querySelector("canvas"); tileCanvases[c.key]=cv; registerPreview(cv, info.preview);
  });
  $("cfgCode").textContent=configCode();
}
function refreshTile(key){
  const cv=tileCanvases[key], info=tileInfo(key);
  if(cv){ previews.delete(cv); registerPreview(cv, info.preview); const btn=cv.closest(".tile"); if(btn){ btn.querySelector(".tile-mass").textContent=info.sub; btn.querySelector(".tile-sel").textContent=info.name; } }
  $("cfgCode").textContent=configCode();
}
function renderSpecMini(){
  const o=opt("esc"); const box=$("specMini"); box.innerHTML="";
  o.specs.slice(0,5).forEach(s=>{ const d=el("div","sr"); d.innerHTML='<span class="k">'+txt(s[0])+'</span><span class="v">'+txt(s[1])+'</span>'; box.appendChild(d); });
}
function renderCompList(){
  const box=$("compList"); box.innerHTML="";
  COMPONENTS.forEach(c=>{
    const seen=!!state.seenComps[c.id];
    const d=el("button","comp-item"+(seen?" seen":"")+(selectedComp===c.id?" active":"")); d.type="button";
    d.innerHTML='<span class="swatch" style="background:#'+c.color.toString(16).padStart(6,"0")+'"></span><span class="cn">'+txt(c.name)+'</span>'+(seen?'<span class="ck">✓</span>':'');
    d.addEventListener("click",()=>selectComponent(c.parts&&c.parts[0]||c.id));
    box.appendChild(d);
  });
  const total=COMPONENTS.length, n=Object.keys(state.seenComps).filter(k=>COMPONENTS.some(c=>c.id===k)).length;
  $("dsCount").textContent=n+" / "+total+" viewed";
}
function selectComponent(partOrId){
  const c=compForPart(partOrId) || COMPONENTS.find(x=>x.id===partOrId);
  if(!c) return;
  selectedComp=c.id; state.seenComps[c.id]=true;
  const ds=$("datasheet");
  ds.innerHTML='<h4>'+txt(c.name)+'</h4><span class="role">'+txt(c.role)+'</span><span class="note">'+txt(c.note)+'</span>';
  // highlight in 3D
  if(escGroup){
    escGroup.traverse(o=>{ if(o.isMesh&&o.material&&o.material.emissive){ if(o.userData.baseColor!=null) o.material.emissive.setHex(o.userData.baseColor).multiplyScalar? o.material.emissive.setHex(0x000000):o.material.emissive.setHex(0x000000); } });
    (c.parts||[]).forEach(pn=>{ (escGroup.userData.parts[pn]||[]).forEach(m=>{ if(m.material&&m.material.emissive){ m.material.emissive.setHex(0x37e0a0); m.material.emissiveIntensity=.35; } }); });
    (c.nodes||[]).forEach(nn=>{ const node=(escGroup.userData.nodes||[]).find(x=>x.userData.node===nn); if(node) highlightNode(node,true); });
  }
  renderCompList(); sfx("tick");
  // completion: all components inspected
  const total=COMPONENTS.length, n=Object.keys(state.seenComps).filter(k=>COMPONENTS.some(c=>c.id===k)).length;
  if(n>=total && !state.done["m1:anatomy"]){ markDone("m1:anatomy", true, "Anatomy complete — all "+total+" components inspected."); }
  saveState();
}
function renderModuleTabs(){
  const box=$("moduleTabs"); box.innerHTML="";
  const commissioned=!!state.done["m1:commission"];
  ESC_DB.modules.forEach(m=>{
    const locked=m.id!=="m1" && !commissioned;
    const b=el("button", m.id===state.module?"active":""); b.type="button"; b.disabled=locked;
    b.innerHTML=(locked?"🔒 ":"")+txt(m.label)+' <small>· '+txt(m.sub)+'</small>';
    b.title=locked?"Complete Module 1 · Commission first":"";
    b.addEventListener("click",()=>{ if(locked) return; if(simActive) stopSim(false); state.module=m.id; saveState(); switchStage(); });
    box.appendChild(b);
  });
}
function renderExpTabs(){
  const box=$("expTabs"); box.innerHTML="";
  const m=ESC_DB.modules.find(m=>m.id===state.module);
  const commissioned=!!state.done["m1:commission"];
  m.experiments.forEach(e=>{
    const key=m.id+":"+e.id;
    const locked=m.id!=="m1" && !commissioned;
    const b=el("button", e.id===state.exp[m.id]?"active":""); b.type="button"; b.disabled=locked;
    b.innerHTML=(state.done[key]?'<span class="done">✓</span>':locked?"🔒 ":"")+txt(e.name);
    b.addEventListener("click",()=>{ if(locked) return; if(simActive) stopSim(false); state.exp[m.id]=e.id; saveState(); switchStage(); playIntroVoice(key); });
    box.appendChild(b);
  });
}
function switchStage(){
  renderModuleTabs(); renderExpTabs(); applyStageVisibility(); buildScene();
  renderCalcChips(); renderLog(); syncRunControls(); drawLiveGraph(); drawAnalysisChart();
}
function applyStageVisibility(){
  const key=state.module+":"+state.exp[state.module];
  if(sceneMode()==="explore"){ document.body.dataset.exp=key; renderCompList(); }
  else delete document.body.dataset.exp;
}
function renderProgress(){ const total=allExperiments().length, n=doneCount(); $("progressFill").style.width=(total?n/total*100:0)+"%"; $("progressTxt").textContent=n+" / "+total; }
function renderCalcChips(){
  const c=calc(), stage=c.stage; let chips=[];
  if(stage==="explore"){
    chips=[ {k:"ESC rating", v:c.p.escCurrent+" A", cls:""}, {k:"Burst", v:c.p.escBurst+" A", cls:""},
      {k:"MOSFETs", v:c.p.mosfets, cls:""}, {k:"Rds(on)", v:(c.p.rdsOn*1000).toFixed(1)+" mΩ", cls:""},
      {k:"R_th", v:c.p.rTh+" °C/W", cls:""} ];
  }else if(stage==="map"){
    chips=[ {k:"Pulse", v:Math.round(state.pulse)+" µs", cls:""}, {k:"Eff. throttle", v:c.throttle.toFixed(1)+" %", cls:c.throttle>0?"good":""},
      {k:"Phase I", v:c.phaseI.toFixed(1)+" A", cls:c.phaseI>c.p.escBurst?"warn":""}, {k:"RPM", v:Math.round(c.rpm).toLocaleString(), cls:""},
      {k:"Bus V", v:c.V.toFixed(1)+" V", cls:c.mode==="CC"?"warn":""} ];
  }else if(stage==="latency"){
    chips=[ {k:"Latency τ", v:c.latency<1?(c.latency*1000).toFixed(0)+" µs":c.latency.toFixed(2)+" ms", cls:c.latency<5?"good":"warn"},
      {k:"Resolution", v:c.resolution+" steps", cls:""}, {k:"Refresh", v:(c.proto.refresh_hz>=1000?(c.proto.refresh_hz/1000).toFixed(0)+" kHz":c.proto.refresh_hz+" Hz"), cls:""},
      {k:"Type", v:c.proto.type, cls:""} ];
  }else{
    chips=[ {k:"Phase I", v:c.phaseI.toFixed(1)+" A", cls:c.phaseI>c.p.escCurrent?"warn":""}, {k:"P conduction", v:c.Pcond.toFixed(2)+" W", cls:c.Pcond>c.threshold_w?"warn":"good"},
      {k:"P total", v:c.Ptot.toFixed(2)+" W", cls:""}, {k:"Junction T", v:(c.runaway?"runaway":c.Tjunc.toFixed(0)+" °C"), cls:c.runaway||c.Tjunc>c.limit_c?"warn":"good"},
      {k:"Passive @80°C", v:c.passiveA.toFixed(0)+" A", cls:""} ];
  }
  const box=$("calcChips"); box.innerHTML="";
  chips.forEach(ch=>{ const d=el("div","calc-chip"); d.innerHTML='<span class="k">'+ch.k+'</span><span class="v '+ch.cls+'">'+ch.v+'</span>'; box.appendChild(d); });
}
function renderLog(){
  const dg=diagnostics(), list=$("logList"); list.innerHTML="";
  const icon=s=>s==="ok"?"✓":s==="warn"?"!":"×";
  dg.items.forEach(it=>{ const d=el("div","log-item "+it.sev);
    d.innerHTML='<span class="ic">'+icon(it.sev)+'</span><div class="body"><span class="msg">'+txt(it.msg)+'</span>'+(it.fix?'<span class="fix">→ '+txt(it.fix)+'</span>':'')+'</div>';
    list.appendChild(d); });
  const badge=$("logBadge"), sum=$("logSummary");
  if(dg.errors){ badge.className="log-badge err"; badge.textContent=dg.errors+" error"+(dg.errors>1?"s":""); sum.textContent="· "+dg.errors+" error"+(dg.errors>1?"s":"")+(dg.warns?", "+dg.warns+" warning"+(dg.warns>1?"s":""):""); }
  else if(dg.warns){ badge.className="log-badge warn"; badge.textContent=dg.warns+" warning"+(dg.warns>1?"s":""); sum.textContent="· "+dg.warns+" warning"+(dg.warns>1?"s":""); }
  else { badge.className="log-badge ok"; badge.textContent="OK"; sum.textContent="· bench OK"; }
  const rb=$("runBtn"); if(dg.blocked && !simActive) rb.classList.add("blocked"); else rb.classList.remove("blocked");
  return dg;
}
function renderChecklist(){}   // sign-off folded into diagnostics + verdicts
function updateTelemetry(t){
  t=t||{};
  $("telState").textContent=t.stateTxt||(state.escDead?"BURNT":state.armed?"ARMED":"DISARMED");
  $("telThrottle").textContent=(t.throttle!=null?t.throttle:0).toFixed(1)+" %";
  $("telRpm").textContent=Math.round(t.rpm||0).toLocaleString();
  $("telVolts").textContent=(t.volts!=null?t.volts:state.vset).toFixed(1)+" V";
  $("telCur").textContent=(t.cur||0).toFixed(1)+" A";
  $("telPesc").textContent=(t.pesc||0).toFixed(2)+" W";
  $("telTemp").textContent=Math.round(t.temp!=null?t.temp:heatT)+" °C";
  $("telLat").textContent=t.lat!=null?t.lat:"— ms";
  const ph=$("telPhase"); ph.textContent=t.phase||"STANDBY"; ph.className="tel-phase mono"+(t.phaseCls?" "+t.phaseCls:"");
}
function renderSupplyReadout(V, A, mode){
  $("supplyVread").textContent=V.toFixed(1); $("supplyARead").textContent=A.toFixed(1);
  const el2=$("supplyMode"); el2.textContent=mode; el2.className="supply-mode mono"+(mode==="CC"?" cc":mode==="OFF"?" off":"");
  const vr=$("supplyVread").parentElement, ar=$("supplyARead").parentElement;
  ar.classList.toggle("cc", mode==="CC");
  if(supplyGroup) updateSupplyDisplays(supplyGroup, V, A, mode);
}
function renderReward(){
  const body=$("rewardBody"), unlocked=allDone();
  $("rewardBadge").textContent=(unlocked?1:0)+" / 1"; body.innerHTML="";
  if(unlocked){
    const r=ESC_DB.reward; const d=el("div","reward-open");
    d.innerHTML='<div class="view"><canvas width="280" height="190"></canvas></div><div class="meta"><b>★ '+txt(r.name)+'</b><p>'+txt(r.desc)+'</p></div>';
    body.appendChild(d);
    const cv=d.querySelector("canvas"); registerPreview(cv, { catKey:"reward", fallback:r.fallback, files:r.files });
  }else{
    const total=allExperiments().length; const d=el("div","reward-locked");
    d.innerHTML='<div class="lock">🔒</div><p>Complete all '+total+' stages<br>to unlock a reward component</p>'; body.appendChild(d);
  }
}
function refreshAfterSelection(key){
  if(key==="esc"){ state.escDead=false; state.wires=[]; state.endpointsStored=false; state.armed=false; selectedComp=null; }
  refreshTile(key); renderSpecMini();
  buildScene(); renderCalcChips(); renderLog(); renderCompList(); syncRunControls();
  clearLastRun(); drawLiveGraph(); drawAnalysisChart(); saveState();
}

/* ════════════ 10 · CHARTS ════════════ */
const C_COL={ blue:"#1f3a93", orange:"#c65d3b", green:"#1f8a5b", red:"#a83232", slate:"#4f6d9e", grid:"#e7edeb", muted:"#8b9a95", ink:"#1e2a29", amber:"#d8a12a" };
if(window.Chart){
  Chart.defaults.font.family="'IBM Plex Sans', sans-serif"; Chart.defaults.font.size=11; Chart.defaults.color="#5c6d68";
  Chart.defaults.plugins.legend.labels.boxWidth=11; Chart.defaults.plugins.legend.labels.font={size:10};
}
const ChartHub={ reg:{}, put(id,cfg){ this.kill(id); const cv=$(id); if(!cv||!window.Chart) return null; const ch=new Chart(cv,cfg); this.reg[id]=ch; return ch; },
  kill(id){ if(this.reg[id]){ try{ this.reg[id].destroy(); }catch(e){} delete this.reg[id]; } },
  killPrefix(pre){ Object.keys(this.reg).forEach(k=>{ if(k.indexOf(pre)===0) this.kill(k); }); } };
let lastRun={ key:null, metric:null, data:[], data2:[], labels:[] };
function clearLastRun(){ lastRun={ key:null, metric:null, data:[], data2:[], labels:[] }; }
function baseXY(xl, yl, extra){
  const tick={ font:{ family:"'IBM Plex Mono'" } };
  const o={ responsive:true, maintainAspectRatio:false, animation:{duration:250}, interaction:{mode:"index",intersect:false},
    plugins:{ legend:{position:"bottom"}, tooltip:{} },
    scales:{ x:{ title:{display:true,text:xl}, grid:{color:C_COL.grid}, ticks:tick }, y:{ title:{display:true,text:yl.y}, grid:{color:C_COL.grid}, ticks:tick, beginAtZero:true } } };
  if(yl.y1) o.scales.y1={ position:"right", title:{display:true,text:yl.y1}, grid:{drawOnChartArea:false}, ticks:tick, beginAtZero:true };
  return Object.assign(o, extra||{});
}
/* ── PWM oscilloscope: Expected (ideal) vs Obtained (real map + dead-band + fault) ── */
function scopeMapConfig(mini){
  const labels=[], expd=[], obt=[];
  for(let pw=900; pw<=2100.01; pw+=20){ labels.push(pw);
    expd.push(Math.max(0,Math.min(100,(pw-1000)/1000*100)));
    obt.push(throttleFromPulse(pw).eff); }
  const livePts=labels.map(pw=>Math.abs(pw-state.pulse)<11?throttleFromPulse(pw).eff:null);
  return { type:"line", data:{ labels, datasets:[
      { label:"Expected (ideal)", data:expd, borderColor:C_COL.blue, borderWidth:2, borderDash:[6,4], pointRadius:0, tension:0 },
      { label:"Obtained (real ESC)", data:obt, borderColor:C_COL.orange, backgroundColor:C_COL.orange+"20", borderWidth:2.5, pointRadius:0, tension:.15, fill:true },
      { label:"Live pulse", data:livePts, borderColor:C_COL.green, backgroundColor:C_COL.green, pointRadius:5, showLine:false } ] },
    options: Object.assign(baseXY("Pulse width (µs)", {y:"Throttle (%)"}, { plugins:{ legend:{display:!mini,position:"bottom"}, tooltip:{enabled:!mini} } }), { scales:{ x:{ticks:{maxTicksLimit:mini?6:12, font:{family:"'IBM Plex Mono'"}}, grid:{color:C_COL.grid}, title:{display:!mini,text:"Pulse width (µs)"} }, y:{min:0,max:100,grid:{color:C_COL.grid},title:{display:!mini,text:"Throttle (%)"}} } }) };
}
function mapErrorConfig(mini){
  const labels=[], err=[];
  for(let pw=1000; pw<=2000.01; pw+=20){ labels.push(pw); err.push(+(throttleFromPulse(pw).eff-(pw-1000)/1000*100).toFixed(2)); }
  return { type:"line", data:{ labels, datasets:[{ label:"Obtained − Expected (%)", data:err, borderColor:C_COL.red, backgroundColor:C_COL.red+"20", borderWidth:2, pointRadius:0, fill:true, tension:.15 }] },
    options: baseXY("Pulse width (µs)", {y:"Error (%)"}, { plugins:{legend:{display:!mini}} }) };
}
/* ── command-vs-response scope: response trails command by the protocol latency ── */
function latencyScopeConfig(mini, tphase){
  const proto=protoById(state.protocol), lat=proto.latency_ms;
  const win=50, N=200; const labels=[], cmd=[], resp=[];
  const step=t=>{ const tt=((t)%40); return tt<20?70:30; };   // command square wave, period 40 ms
  const off=(tphase||0);
  for(let i=0;i<N;i++){ const t=i/N*win; labels.push(+t.toFixed(1)); cmd.push(step(t+off)); resp.push(step(t+off-lat)); }
  return { type:"line", data:{ labels, datasets:[
      { label:"Command (stick)", data:cmd, borderColor:C_COL.blue, borderWidth:2, pointRadius:0, stepped:proto.type==="analog", tension:0 },
      { label:"ESC response (τ="+(lat<1?(lat*1000).toFixed(0)+"µs":lat.toFixed(1)+"ms")+")", data:resp, borderColor:C_COL.orange, borderWidth:2, pointRadius:0, borderDash:[5,3], stepped:proto.type==="analog", tension:0 } ] },
    options: Object.assign(baseXY("Time (ms)", {y:"Throttle (%)"}), { animation:false, plugins:{legend:{display:!mini,position:"bottom"}}, scales:{ x:{ticks:{maxTicksLimit:mini?6:10,font:{family:"'IBM Plex Mono'"}},grid:{color:C_COL.grid},title:{display:!mini,text:"Time (ms)"}}, y:{min:0,max:100,grid:{color:C_COL.grid},title:{display:!mini,text:"Throttle (%)"}} } }) };
}
function latencyBarConfig(mini){
  const labels=ESC_DB.protocols.map(p=>p.label.replace(/ ·.*/,"").replace(/\(.*/,"")); const lat=ESC_DB.protocols.map(p=>+p.latency_ms.toFixed(3));
  return { type:"bar", data:{ labels, datasets:[{ label:"Latency (ms)", data:lat, backgroundColor:ESC_DB.protocols.map(p=>p.id===state.protocol?C_COL.orange:(p.latency_ms>5?C_COL.red:C_COL.blue)) }] },
    options: Object.assign(baseXY("Protocol", {y:"Latency (ms, log)"}), { plugins:{legend:{display:false}}, scales:{ x:{ticks:{font:{size:mini?8:10}},grid:{display:false}}, y:{type:"logarithmic",title:{display:!mini,text:"Latency (ms)"},grid:{color:C_COL.grid}} } }) };
}
/* ── ESC power vs phase current, conduction+switching, with the 2 W heatsink line ── */
function pViConfig(mini){
  const p=propulsionParams(); const labels=[], cond=[], tot=[];
  for(let I=0; I<=Math.max(p.escBurst*1.2,40); I+=2){ labels.push(I); const L=escLoss(I, state.vset, p, state.hotModel?escThermalSteady(I,state.vset,{hot:true,heatsink:state.heatsink,ambient:state.ambient}).T:25); cond.push(+L.Pcond.toFixed(2)); tot.push(+L.Ptot.toFixed(2)); }
  const thr=(ESC_DB.thermal.heatsink_threshold_w||2);
  return { type:"line", data:{ labels, datasets:[
      { label:"Conduction I²R (W)", data:cond, borderColor:C_COL.orange, borderWidth:2.5, pointRadius:0, tension:.15, fill:false },
      { label:"Total (+switching+cap)", data:tot, borderColor:C_COL.slate, borderWidth:2, pointRadius:0, borderDash:[5,3], tension:.15 },
      { label:"2 W heatsink line", data:labels.map(()=>thr), borderColor:C_COL.red, borderWidth:1.5, pointRadius:0, borderDash:[3,3] } ] },
    options: baseXY("Phase current (A)", {y:"ESC loss (W)"}, { plugins:{legend:{display:!mini,position:"bottom"}} }) };
}
function tiSweepConfig(mini){
  const labels=[], bare=[], hs=[]; const amb=state.ambient;
  for(let I=0; I<=80; I+=2){ labels.push(I);
    bare.push(+Math.min(escThermalSteady(I,state.vset,{hot:state.hotModel,heatsink:false,ambient:amb}).T,300).toFixed(1));
    hs.push(+Math.min(escThermalSteady(I,state.vset,{hot:state.hotModel,heatsink:true,ambient:amb}).T,300).toFixed(1)); }
  const lim=ESC_DB.thermal.limit_c||80;
  return { type:"line", data:{ labels, datasets:[
      { label:"Bare board (°C)", data:bare, borderColor:C_COL.red, borderWidth:2.5, pointRadius:0, tension:.15 },
      { label:"With heatsink (°C)", data:hs, borderColor:C_COL.green, borderWidth:2, pointRadius:0, tension:.15 },
      { label:"80 °C limit", data:labels.map(()=>lim), borderColor:C_COL.muted, borderWidth:1.5, pointRadius:0, borderDash:[4,3] } ] },
    options: baseXY("Sustained current (A)", {y:"Junction T (°C)"}, { plugins:{legend:{display:!mini,position:"bottom"}} }) };
}
function coldHotConfig(mini){
  const p=propulsionParams(); const labels=[], cold=[], hot=[];
  for(let I=0; I<=60; I+=2){ labels.push(I);
    cold.push(+(I*I*p.rdsOn).toFixed(2));
    hot.push(+escThermalSteady(I,state.vset,{hot:true,heatsink:state.heatsink,ambient:state.ambient}).L.Pcond.toFixed(2)); }
  return { type:"line", data:{ labels, datasets:[
      { label:"Cold model I²·R₂₅", data:cold, borderColor:C_COL.slate, borderWidth:2, pointRadius:0, borderDash:[5,3], tension:.15 },
      { label:"Hot self-consistent", data:hot, borderColor:C_COL.orange, borderWidth:2.5, pointRadius:0, tension:.15 } ] },
    options: baseXY("Phase current (A)", {y:"Conduction loss (W)"}, { plugins:{legend:{display:!mini,position:"bottom"}} }) };
}
function drawLiveGraph(){
  const { exp }=currentExp(), metric=exp.metric, cap=$("graphCaption");
  if(metric==="explore"){ ChartHub.kill("liveGraph"); const cv=$("liveGraph"); if(cv){ const b=cv.parentElement,w=Math.max(b.clientWidth-2,40),h=Math.max(b.clientHeight-2,40); cv.width=w;cv.height=h; const g=cv.getContext("2d"); g.clearRect(0,0,w,h); g.fillStyle="#a3b2ad"; g.font="500 12px 'IBM Plex Mono'"; g.textAlign="center"; g.fillText("Anatomy view — inspect the board", w/2, h/2); } if(cap) cap.textContent="ESC anatomy · click parts to inspect"; return; }
  let cfg;
  if(metric==="map") cfg=scopeMapConfig(true);
  else if(metric==="latency") cfg=latencyScopeConfig(true, simActive?sim.tphase:0);
  else if(metric==="temp"){
    if((simActive && sim.data.length>1) || (lastRun.key===state.module+":"+exp.id && lastRun.data.length>1)){
      const src = simActive ? sim : lastRun;
      const lim=ESC_DB.thermal.limit_c||80;
      cfg={ type:"line", data:{ labels:src.labels.slice(), datasets:[
          { label:"Junction T (°C)", data:src.data.slice(), borderColor:C_COL.orange, backgroundColor:C_COL.orange+"18", borderWidth:2.5, pointRadius:0, tension:.2, fill:true },
          { label:"80 °C limit", data:src.labels.map(()=>lim), borderColor:C_COL.muted, borderWidth:1.5, pointRadius:0, borderDash:[4,3] } ] },
        options: baseXY("Time (s)", {y:"Junction T (°C)"}, { animation:false, plugins:{legend:{display:false}} }) };
    } else cfg=tiSweepConfig(true);
  }
  const ch=ChartHub.reg["liveGraph"];
  if(metric==="temp" && simActive && ch && ch._metric==="temp-run"){ ch.data.labels=sim.labels.slice(); ch.data.datasets[0].data=sim.data.slice(); ch.data.datasets[1].data=sim.labels.map(()=>ESC_DB.thermal.limit_c||80); ch.update("none"); }
  else { const c=ChartHub.put("liveGraph", cfg); if(c) c._metric = (metric==="temp"&&simActive)?"temp-run":metric; }
  if(cap){ const capTxt={ map:"PWM oscilloscope · Expected vs Obtained", latency:"Command vs ESC response · lag = τ", temp:simActive?"Junction temperature · recording…":"Steady junction temperature vs current" }; cap.textContent=capTxt[metric]||exp.name; }
}
function drawAnalysisChart(){
  const metric=currentExp().exp.metric; let cfg=null;
  if(metric==="map") cfg=mapErrorConfig(true);
  else if(metric==="latency") cfg=latencyBarConfig(true);
  else if(metric==="temp") cfg=pViConfig(true);
  if(!cfg){ ChartHub.kill("analysisChart"); const cv=$("analysisChart"); if(cv){ const g=cv.getContext("2d"); g.clearRect(0,0,cv.width,cv.height); } return; }
  ChartHub.put("analysisChart", cfg);
}
function chartDefs(){
  return [
    { id:"scope", title:"PWM oscilloscope · Expected vs Obtained", cfg:()=>scopeMapConfig(false) },
    { id:"maperr", title:"Throttle-map error", cfg:()=>mapErrorConfig(false) },
    { id:"latscope", title:"Command vs ESC response", cfg:()=>latencyScopeConfig(false, 0) },
    { id:"latbar", title:"Latency by protocol", cfg:()=>latencyBarConfig(false) },
    { id:"pvi", title:"ESC loss vs phase current (2 W line)", cfg:()=>pViConfig(false) },
    { id:"tisweep", title:"Junction T vs sustained current", cfg:()=>tiSweepConfig(false) },
    { id:"coldhot", title:"Cold vs hot conduction loss", cfg:()=>coldHotConfig(false) },
    { id:"sankey", title:"Power flow · supply → mech + loss", dom:renderSankeyDOM }
  ];
}
function renderSankeyDOM(host){
  const c=calc(); const pElec=Math.max(c.V*c.phaseI,0.001);
  const pMech=Math.max(c.rpm>0? (function(){ const op=supplyBus(c.duty,25); return op.Pmech||0; })():0, 0);
  const pCond=c.Pcond, pSw=c.Psw;
  const pct=x=>Math.min(x/pElec*100,100).toFixed(0);
  host.innerHTML='<div class="sankey">'+
    '<div class="srow"><span>Electrical in</span><b>'+pElec.toFixed(1)+' W</b></div>'+
    '<div class="srow"><span>Mechanical (motor)</span><div class="sbar"><i style="width:'+pct(pMech)+'%;background:'+C_COL.green+'"></i></div><b>'+pMech.toFixed(1)+' W</b></div>'+
    '<div class="srow"><span>ESC conduction I²R</span><div class="sbar"><i style="width:'+pct(pCond)+'%;background:'+C_COL.orange+'"></i></div><b>'+pCond.toFixed(2)+' W</b></div>'+
    '<div class="srow"><span>ESC switching</span><div class="sbar"><i style="width:'+pct(pSw)+'%;background:'+C_COL.red+'"></i></div><b>'+pSw.toFixed(2)+' W</b></div>'+
    '</div><p class="chart-footnote">Bus '+c.V.toFixed(1)+' V · '+c.phaseI.toFixed(1)+' A · '+c.mode+' mode.</p>';
}

/* ════════════ 11 · FLOATING WINDOWS ════════════ */
function openModal(title, dotColor, footHTML){
  $("modalTitle").innerHTML=title; $("modalDot").style.background=dotColor;
  const foot=$("modalFoot"); if(footHTML){ foot.innerHTML=footHTML; foot.hidden=false; } else foot.hidden=true;
  $("modalBody").innerHTML=""; $("modalOverlay").hidden=false; document.body.style.overflow="hidden";
  return $("modalBody");
}
function closeModal(){ ChartHub.killPrefix("gc_"); $("modalOverlay").hidden=true; $("modalBody").innerHTML=""; document.body.style.overflow=""; }
function openPicker(catKey){
  const c=cat(catKey); if(!c) return;
  const body=openModal(txt(c.label)+' <em>· option library</em>', "#1f3a93",
    'options are folder-driven — drop a folder with <b>spec.json</b> under <b>assets/'+txt(c.key)+'/</b> and list it in <b>assets/manifest.json</b>');
  const grid=el("div","pick-grid"); body.appendChild(grid);
  c.options.forEach(o=>{
    const selected=state.sel[catKey]===o.id;
    const card=el("button","pick-opt"+(selected?" selected":"")); card.type="button";
    let specs=o.specs.map(s=>'<div><span class="k">'+txt(s[0])+'</span><span class="v">'+txt(s[1])+'</span></div>').join("");
    if(o.size) specs+='<div><span class="k">Size</span><span class="v">'+o.size.join(" × ")+' mm</span></div>';
    card.innerHTML='<div class="top"><span class="name">'+txt(o.name)+'</span><span class="check">'+(selected?"✓ selected":"")+'</span></div>'+
      '<div class="view"><canvas width="200" height="110"></canvas></div><div class="specs">'+specs+'</div>';
    card.addEventListener("click", ()=>{ state.sel[catKey]=o.id; refreshAfterSelection(catKey); instrEvent("select"); closeModal(); });
    grid.appendChild(card);
    registerPreview(card.querySelector("canvas"), o);
  });
  instrEvent("picker");
}
function openSpecDetail(){
  const o=opt("esc"), p=propulsionParams();
  const body=openModal("ESC Teardown <em>· "+txt(o.name)+"</em>", "#1f3a93");
  const wrap=el("div","calc-blocks");
  const spec=el("div","calc-block");
  spec.innerHTML='<h3>Specification</h3><pre>'+o.specs.map(s=>s[0]+": "+s[1]).join("\n")+'\nBoard: '+(o.size?o.size.join(" × ")+" mm":"—")+'\nMass: '+o.mass+' g\nR_th (bare / heatsink): '+p.rTh+' / '+p.rThHs+' °C/W</pre>';
  wrap.appendChild(spec);
  COMPONENTS.forEach(c=>{ const d=el("div","calc-block"); d.innerHTML='<h3>'+txt(c.name)+'</h3><pre>'+txt(c.role)+'</pre><div class="res">'+txt(c.note)+'</div>'; wrap.appendChild(d); });
  body.appendChild(wrap);
}
function openCalcDetail(){
  const c=calc(), p=c.p, cal=ESC_DB.calibration, db=deadbandUs();
  const body=openModal("Detailed Calculations", "#c65d3b");
  const blocks=[
    { t:"1 · Throttle mapping", b:"θ = (PW − PW_min)/(PW_max − PW_min) × 100\nPW = "+Math.round(state.pulse)+" µs, band "+cal.pulse_min_us+"–"+cal.pulse_max_us+" µs\ndead-band (this unit) = "+db+" µs → 0% below "+(cal.pulse_min_us+db)+" µs", r:"θ_eff = "+c.throttle.toFixed(1)+" %" },
    { t:"2 · DC supply operating point", b:"stiff CV at V_set = "+state.vset.toFixed(1)+" V, current limit "+state.ilim+" A\nload draws I = "+c.phaseI.toFixed(1)+" A → mode "+c.mode+(c.mode==="CC"?" (bus folds back)":""), r:"V_bus = "+c.V.toFixed(1)+" V · RPM = "+Math.round(c.rpm).toLocaleString() },
    { t:"3 · ESC conduction loss", b:"P_cond = I²·R_ds(T),  R_ds(T)=R₂₅·[1+α(T−25)], α=0.006/°C\nI = "+c.phaseI.toFixed(1)+" A, R₂₅ = "+(p.rdsOn*1000).toFixed(1)+" mΩ, R_hot = "+(c.Rhot*1000).toFixed(2)+" mΩ", r:"P_cond = "+c.Pcond.toFixed(2)+" W" },
    { t:"4 · Switching + cap loss", b:"P_sw = ½·V·I·(t_on+t_off)·f_carrier  ("+(p.swTime*1e9).toFixed(0)+" ns, "+(p.fCarrier/1000).toFixed(0)+" kHz)\nP_cap = I_rip²·ESR  (I_rip≈0.3·I, ESR="+(p.capEsr*1000).toFixed(0)+" mΩ)", r:"P_total = "+c.Ptot.toFixed(2)+" W" },
    { t:"5 · Thermal equilibrium", b:"T = T_amb + P·R_th,  R_th = "+(state.heatsink?p.rThHs:p.rTh)+" °C/W, T_amb = "+state.ambient+" °C\nhot-R feedback "+(state.hotModel?"ON (self-consistent)":"OFF")+(c.runaway?" → RUNAWAY (1−Kα≤0)":""), r:c.runaway?"thermal runaway":"T = "+c.Tjunc.toFixed(1)+" °C" },
    { t:"6 · Heatsink decision", b:"rule: P_cond > 2 W → heatsink; passive-cooling current at 80 °C found by sweep", r:(c.Pcond>c.threshold_w?"heatsink recommended":"passive OK")+" · passive limit ≈ "+c.passiveA.toFixed(0)+" A" },
    { t:"7 · Protocol", b:"resolution N = PW_range/t_tick (analog) or code count (digital); latency τ = 1/f", r:"τ = "+(c.latency<1?(c.latency*1000).toFixed(0)+" µs":c.latency.toFixed(2)+" ms")+" · "+c.resolution+" steps" }
  ];
  const wrap=el("div","calc-blocks");
  blocks.forEach(bl=>{ const d=el("div","calc-block"); d.innerHTML='<h3>'+bl.t+'</h3><pre>'+bl.b+'</pre><div class="res">'+bl.r+'</div>'; wrap.appendChild(d); });
  wrap.appendChild(el("p","calc-footnote","All values recompute live from the selected ESC/motor/prop spec.json and the bench supply settings. α_FET = 0.006/°C, α_Cu = 0.00393/°C, g = 9.80665 m/s²."));
  body.appendChild(wrap);
}
function openChartsDetail(){
  ChartHub.killPrefix("gc_");
  const body=openModal('Charts <em>· analysis · click any chart to expand</em>', "#c65d3b");
  const c=calc();
  const wrap=el("div","calc-blocks");
  const tiles=el("div","metric-tiles");
  const mt=(k,v,cls)=>'<div class="metric-tile"><span class="mk">'+k+'</span><span class="mv '+(cls||"")+'">'+v+'</span></div>';
  tiles.innerHTML=mt("Phase current", c.phaseI.toFixed(1)+" A")+mt("P conduction", c.Pcond.toFixed(2)+" W", c.Pcond>c.threshold_w?"warn":"good")+
    mt("Junction T", c.runaway?"runaway":c.Tjunc.toFixed(0)+" °C", c.runaway||c.Tjunc>c.limit_c?"warn":"good")+
    mt("Latency", c.latency<1?(c.latency*1000).toFixed(0)+" µs":c.latency.toFixed(2)+" ms", c.latency<5?"good":"warn")+
    mt("Resolution", c.resolution+" steps")+mt("Passive @80°C", c.passiveA.toFixed(0)+" A");
  wrap.appendChild(tiles);
  const pending=[];
  chartDefs().forEach(def=>{
    const block=el("div","calc-block gchart");
    const head=el("div","gchart-head"); head.innerHTML='<h3>'+txt(def.title)+'</h3><button type="button" class="gchart-expand" title="Expand">⤢</button>';
    head.querySelector("button").addEventListener("click",()=>openSingleChart(def)); block.appendChild(head);
    if(def.dom){ const host=el("div"); def.dom(host); block.appendChild(host); }
    else{ const box=el("div","chart-box-lg"); box.innerHTML='<canvas id="gc_'+def.id+'"></canvas>'; block.appendChild(box); pending.push({id:"gc_"+def.id, cfg:def.cfg()}); }
    wrap.appendChild(block);
  });
  body.appendChild(wrap);
  pending.forEach(pc=>ChartHub.put(pc.id, pc.cfg));
  wrap.appendChild(el("p","calc-footnote","Curves recompute live from the selected components' spec.json and the bench supply. BEMT-lite propeller model feeds the phase current; ESC loss = conduction I²R(T) + switching + capacitor ESR."));
}
function openSingleChart(def){
  const body=openModal(txt(def.title)+' <em>· detail</em>', "#c65d3b", '<button type="button" class="modal-back" id="chartBack">‹ all charts</button>');
  const wrap=el("div"); wrap.style.cssText="height:62vh;min-height:340px;position:relative";
  if(def.dom){ wrap.style.height="auto"; def.dom(wrap); } else { wrap.innerHTML='<canvas id="gc_single"></canvas>'; }
  body.appendChild(wrap);
  if(def.cfg) ChartHub.put("gc_single", def.cfg());
  const back=$("chartBack"); if(back) back.addEventListener("click", openChartsDetail);
}
function openGraphDetail(){
  const { exp }=currentExp(), metric=exp.metric;
  const body=openModal('Live Graph <em>· '+txt(exp.name)+'</em>', "#4f6d9e");
  const wrap=el("div"); wrap.style.cssText="height:62vh;min-height:340px;position:relative";
  wrap.innerHTML='<canvas id="gc_single"></canvas>'; body.appendChild(wrap);
  let cfg;
  if(metric==="map") cfg=scopeMapConfig(false);
  else if(metric==="latency") cfg=latencyScopeConfig(false,0);
  else cfg=tiSweepConfig(false);
  ChartHub.put("gc_single", cfg);
}

/* ════════════ 12 · SIMULATION RUNNER ════════════ */
const SIM_DURATION=12;
let simActive=false;
const sim={ t:0, tphase:0, data:[], data2:[], labels:[], key:null, exp:null, metric:null, temp:25, verdict:null, verdictOk:false, phase:"STANDBY" };
function markDone(key, ok, verdictText){
  state.done[key]=true; saveState();
  renderModuleTabs(); renderExpTabs(); renderProgress();
  if(verdictText) showVerdictToast(verdictText, ok);
  if(allDone()){ renderReward(); instrGo(ESC_DB.instructor.length-1); sfx("unlock"); } else { renderReward(); instrEvent("runDone"); }
}
function runSim(){
  if(simActive){ stopSim(false); return; }
  const dg=renderLog();
  const metric=currentExp().exp.metric;
  if(dg.blocked){ sfx("error"); const lc=$("logCard"); lc.animate([{transform:"translateX(0)"},{transform:"translateX(-4px)"},{transform:"translateX(4px)"},{transform:"translateX(0)"}],{duration:280}); return; }
  if(metric==="explore"){
    const total=COMPONENTS.length, n=Object.keys(state.seenComps).filter(k=>COMPONENTS.some(c=>c.id===k)).length;
    if(n>=total) markDone("m1:anatomy", true, "Anatomy complete — all components inspected.");
    else showVerdictToast("Inspect all "+total+" components first — "+n+" / "+total+" viewed.", false);
    return;
  }
  if(metric==="map" && !state.armed){ showVerdictToast("Arm the ESC at idle before sweeping the throttle.", false); sfx("error"); return; }
  const { mod, exp }=currentExp();
  simActive=true; sim.t=0; sim.tphase=0; sim.data=[]; sim.data2=[]; sim.labels=[]; sim.temp=state.ambient;
  sim.exp=exp; sim.mod=mod; sim.key=mod.id+":"+exp.id; sim.metric=metric; sim.verdict=null;
  $("runBtn").textContent="■ Stop"; $("runBtn").classList.add("running"); $("telDot").classList.add("on");
  if(metric==="map"||metric==="temp") audioStart();
  sfx("start"); instrEvent("run"); syncRunControls();
}
function stopSim(completed){
  simActive=false; $("runBtn").textContent="▶ Run Sim"; $("runBtn").classList.remove("running"); $("telDot").classList.remove("on");
  audioStop(); $("ffBadge").hidden=true;
  if(completed && sim.verdict){
    if(sim.metric==="temp"){ lastRun={ key:sim.key, metric:"temp", data:sim.data.slice(), data2:[], labels:sim.labels.slice() }; }
    markDone(sim.key, sim.verdictOk, sim.verdict);
    playFaultVoice(sim.verdict, sim.verdictOk);
  }
  drawLiveGraph(); drawAnalysisChart(); renderCalcChips();
}
function resetSim(){
  if(simActive) stopSim(false);
  if(currentExp().exp.metric==="map"){ state.pulse=1000; $("pulseSlider").value=1000; $("pulseVal").textContent="1000 µs"; }
  sim.data=[]; sim.labels=[]; sim.temp=state.ambient; heatT=state.ambient;
  updateTelemetry({}); drawLiveGraph(); drawAnalysisChart(); renderCalcChips();
}
function showVerdictToast(text, ok){
  const t=el("div","verdict "+(ok?"pass":"fail"));
  t.style.cssText="position:fixed;left:50%;top:74px;transform:translateX(-50%);z-index:120;box-shadow:0 10px 30px rgba(20,40,40,.25);max-width:460px";
  const parts=text.split("—");
  t.innerHTML='<span class="vic">'+(ok?"✓":"×")+'</span><div class="vtx"><b>'+txt(parts[0].trim())+'</b><span>'+txt(parts.slice(1).join("—").trim())+'</span></div>';
  document.body.appendChild(t);
  setTimeout(()=>{ t.style.transition="opacity .5s"; t.style.opacity="0"; setTimeout(()=>t.remove(),500); }, 3600);
}
function simStep(dt){
  sim.t+=dt;
  const metric=sim.metric, p=propulsionParams();
  if(metric==="map"){
    const frac=Math.min(sim.t/SIM_DURATION,1);
    state.pulse=1000+frac*1000;
    $("pulseSlider").value=Math.round(state.pulse); $("pulseVal").textContent=Math.round(state.pulse)+" µs";
    state.sweepMin=Math.min(state.sweepMin,state.pulse); state.sweepMax=Math.max(state.sweepMax,state.pulse);
    const map=throttleFromPulse(state.pulse), duty=map.eff/100;
    const op=supplyBus(duty, 25);
    heatT=escThermalStep(heatT, op.I, op.V, dt, {hot:state.hotModel,heatsink:state.heatsink,ambient:state.ambient});
    const L=escLoss(op.I, op.V, p, state.hotModel?heatT:25);
    sim.lastRpm=op.rpm;
    renderSupplyReadout(op.V, op.I, op.mode);
    updateTelemetry({ stateTxt:"ARMED", throttle:map.eff, rpm:op.rpm, volts:op.V, cur:op.I, pesc:L.Ptot, temp:heatT,
      phase:op.mode==="CC"?"CC · sweeping":"SWEEPING "+Math.round(map.eff)+"%", phaseCls:op.mode==="CC"?"warn":"good" });
    renderCalcChips();
    if(frac>=1){
      // RMS error obtained vs expected
      let se=0,n=0; for(let pw=1000;pw<=2000;pw+=25){ const e=throttleFromPulse(pw).eff-(pw-1000)/1000*100; se+=e*e; n++; }
      const rms=Math.sqrt(se/n);
      const clean=state.fault==="none";
      sim.verdictOk=clean; sim.verdict=(clean?"Channel commissioned — ":"Fault reproduced — ")+"map RMS error "+rms.toFixed(1)+"% vs ideal (dead-band "+deadbandUs()+" µs)";
      stopSim(true);
    }
    return;
  }
  if(metric==="latency"){
    sim.tphase+=dt*8;   // scroll the scope
    const proto=protoById(state.protocol);
    const duty=0.4; const op=supplyBus(duty,25);
    sim.lastRpm=op.rpm;
    renderSupplyReadout(op.V, op.I, op.mode);
    updateTelemetry({ stateTxt:"ARMED", throttle:40, rpm:op.rpm, volts:op.V, cur:op.I, pesc:escLoss(op.I,op.V,p,25).Ptot,
      temp:heatT, lat:(proto.latency_ms<1?(proto.latency_ms*1000).toFixed(0)+" µs":proto.latency_ms.toFixed(2)+" ms"),
      phase:proto.latency_ms<5?"RESPONSIVE":"LAGGY", phaseCls:proto.latency_ms<5?"good":"warn" });
    drawLiveGraph();
    if(sim.t>=SIM_DURATION){
      const ok=proto.latency_ms<5;
      sim.verdictOk=ok; sim.verdict=(ok?"Flight-ready — ":"Too slow — ")+proto.label.replace(/ ·.*/,"")+" latency "+(proto.latency_ms<1?(proto.latency_ms*1000).toFixed(0)+" µs":proto.latency_ms.toFixed(1)+" ms")+", "+(proto.type==="digital"?proto.levels:1000)+" steps";
      stopSim(true);
    }
    return;
  }
  if(metric==="temp"){
    const FF=ESC_DB.thermal.sim_fast_forward||30, dtA=dt*FF;
    const c=calc(); const I=c.phaseI, V=state.vset;
    sim.temp=escThermalStep(sim.temp, I, V, dtA, {hot:state.hotModel,heatsink:state.heatsink,ambient:state.ambient});
    heatT=sim.temp;
    sim.labels.push(+(sim.t*FF).toFixed(0)); sim.data.push(+sim.temp.toFixed(1));
    const L=escLoss(I,V,p,state.hotModel?sim.temp:25);
    const spins=state.thermalPreset==="full";
    renderSupplyReadout(V, I, "CV");
    updateTelemetry({ stateTxt:"LOADED", throttle:spins?100:45, rpm:spins?c.rpm:0, volts:V, cur:I, pesc:L.Ptot, temp:sim.temp,
      phase:sim.temp>=(c.limit_c)?"OVER LIMIT":sim.temp>=60?"HEATING":"STABLE", phaseCls:sim.temp>=c.limit_c?"danger":sim.temp>=60?"warn":"good" });
    $("ffBadge").hidden=false;
    if(++sim._g%2===0) drawLiveGraph(); renderCalcChips();
    // settle detection or timeout
    const steady=escThermalSteady(I,V,{hot:state.hotModel,heatsink:state.heatsink,ambient:state.ambient});
    const settled = Math.abs(sim.temp-steady.T)<0.5 && sim.t>2;
    if(sim.t>=SIM_DURATION || settled || steady.runaway){
      const lim=c.limit_c;
      if(steady.runaway){ sim.verdictOk=false; sim.verdict="Thermal runaway — hot-resistance feedback diverges; fit a heatsink or drop the current"; }
      else if(steady.T<=lim){ sim.verdictOk=true; sim.verdict=(c.Pcond<=c.threshold_w?"Passive OK — ":"Heatsink helps — ")+"junction settles at "+steady.T.toFixed(0)+" °C ("+c.Pcond.toFixed(2)+" W conduction), passive limit "+c.passiveA.toFixed(0)+" A"; }
      else { sim.verdictOk=false; sim.verdict=(state.heatsink?"Still over limit — ":"Heatsink required — ")+"junction "+steady.T.toFixed(0)+" °C exceeds the 80 °C line"; }
      stopSim(true);
    }
    return;
  }
}

/* ════════════ 12b · RUN CONTROL VISIBILITY ════════════ */
function syncRunControls(){
  const metric=currentExp().exp.metric;
  $("commGroup").hidden = metric!=="map";
  $("protoGroup").hidden = metric!=="latency";
  $("thermGroup").hidden = metric!=="temp";
  $("runBtn").textContent = simActive ? "■ Stop" : (metric==="explore" ? "✓ Check anatomy" : "▶ Run Sim");
  // commission button states
  const cal=$("calibrateBtn"), arm=$("armBtn");
  if(cal){ cal.classList.toggle("stored", state.endpointsStored); cal.textContent=state.endpointsStored?"Endpoints stored ✓":"Store endpoints"; }
  if(arm){ arm.classList.toggle("armed", state.armed); arm.textContent=state.armed?"Disarm":"Arm ESC"; arm.disabled=state.escDead; }
  // presets
  $("presetHover")&&$("presetHover").classList.toggle("active", state.thermalPreset==="hover");
  $("presetFull")&&$("presetFull").classList.toggle("active", state.thermalPreset==="full");
}

/* ════════════ 13 · AUDIO + INSTRUCTOR ════════════ */
let actx=null, aMaster=null, noiseBuf=null, engine=null;
function ac(){ if(!actx){ actx=new (window.AudioContext||window.webkitAudioContext)(); aMaster=actx.createGain(); aMaster.gain.value=state.sfxVol/100; aMaster.connect(actx.destination); const n=actx.sampleRate*2, b=actx.createBuffer(1,n,actx.sampleRate), ch=b.getChannelData(0); for(let i=0;i<n;i++) ch[i]=Math.random()*2-1; noiseBuf=b; } if(actx.state==="suspended") actx.resume(); return actx; }
function setMasterVol(){ if(aMaster) aMaster.gain.value=state.sfxVol/100; }
function tone(freq,t0,dur,gain,type){ const ctx=ac(); const o=ctx.createOscillator(), g=ctx.createGain(); o.type=type||"sine"; o.frequency.value=freq; g.gain.setValueAtTime(0,ctx.currentTime+t0); g.gain.linearRampToValueAtTime(gain,ctx.currentTime+t0+.02); g.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+t0+dur); o.connect(g); g.connect(aMaster); o.start(ctx.currentTime+t0); o.stop(ctx.currentTime+t0+dur+.05); }
const SFX_FILES={ tick:"assets/audio/sfx/click.mp3", start:"assets/audio/sfx/start.mp3", done:"assets/audio/sfx/success.mp3", error:"assets/audio/sfx/error.mp3", unlock:"assets/audio/sfx/lock.mp3", warn:"assets/audio/sfx/warn.mp3" };
function sfx(kind){ if(state.sfxVol<=0) return; const v=state.sfxVol/100, file=SFX_FILES[kind]; if(file){ try{ const a=new Audio(file); a.volume=Math.min(v,1); a.play().catch(()=>toneFallback(kind)); return; }catch(e){} } toneFallback(kind); }
function toneFallback(kind){ const v=.22; try{ if(kind==="tick") tone(880,0,.07,v); else if(kind==="start"){ tone(392,0,.09,v); tone(587,.09,.12,v); } else if(kind==="done"){ tone(660,0,.1,v); tone(880,.12,.18,v); } else if(kind==="error"){ tone(200,0,.12,v,"square"); tone(150,.12,.18,v,"square"); } else if(kind==="unlock"){ [523,659,784,1047].forEach((f,i)=>tone(f,i*.13,.22,v)); } else if(kind==="warn"){ tone(330,0,.14,v,"triangle"); } }catch(e){} }
const VOICE_FILES={ esc_burnt:"assets/audio/voice/fault_short_circuit.mp3", reverse:"assets/audio/voice/fault_reverse_polarity.mp3", reversed_rot:"assets/audio/voice/fault_reversed_rotation.mp3", pass:"assets/audio/voice/verdict_pass.mp3" };
const INTRO_FILES={ "m1:anatomy":"assets/audio/voice/m1_intro.mp3", "m1:commission":"assets/audio/voice/m1_intro.mp3", "m2:protocol":"assets/audio/voice/m2_intro.mp3", "m2:thermal":"assets/audio/voice/m2_thermal_intro.mp3" };
let currentVoice=null, lastVoiceUrl=null;
function stopVoice(){ if(currentVoice){ try{ currentVoice.pause(); currentVoice.currentTime=0; }catch(e){} currentVoice=null; } }
function playVoiceFile(url){ if(!url) return; lastVoiceUrl=url; if(state.voiceVol<=0) return; stopVoice(); try{ const a=new Audio(url); a.volume=Math.min(state.voiceVol/100,1); currentVoice=a; a.addEventListener("ended",()=>{ if(currentVoice===a) currentVoice=null; }); a.play().catch(()=>{}); }catch(e){} }
function playIntroVoice(key){ if(INTRO_FILES[key]) playVoiceFile(INTRO_FILES[key]); }
function currentIntroKey(){ return state.module+":"+state.exp[state.module]; }
function playFaultVoice(text, ok){ const t=(text||"").toLowerCase(); let tag=null; if(ok) tag="pass"; else if(t.includes("reverse")) tag="reverse"; else if(t.includes("short")||t.includes("destroyed")||t.includes("burnt")) tag="esc_burnt"; else if(t.includes("backward")||t.includes("reversed")) tag="reversed_rot"; if(tag&&VOICE_FILES[tag]) playVoiceFile(VOICE_FILES[tag]); }
function audioStart(){ if(state.sfxVol<=0) return; try{ const ctx=ac(); audioStopNow(); const g=ctx.createGain(); g.gain.value=0; g.connect(aMaster); const rumble=ctx.createOscillator(); rumble.type="sawtooth"; const rg=ctx.createGain(); rg.gain.value=.14; rumble.connect(rg); rg.connect(g); const whine=ctx.createOscillator(); whine.type="square"; const wf=ctx.createBiquadFilter(); wf.type="lowpass"; wf.frequency.value=2600; const wg=ctx.createGain(); wg.gain.value=.05; whine.connect(wf); wf.connect(wg); wg.connect(g); const noise=ctx.createBufferSource(); noise.buffer=noiseBuf; noise.loop=true; const bp=ctx.createBiquadFilter(); bp.type="bandpass"; bp.frequency.value=900; bp.Q.value=3; const ng=ctx.createGain(); ng.gain.value=.12; noise.connect(bp); bp.connect(ng); ng.connect(g); rumble.start(); whine.start(); noise.start(); engine={g,rumble,whine,bp,cur:0}; g.gain.setTargetAtTime(.8,ctx.currentTime,.25); }catch(e){} }
function audioStopNow(){ if(!engine) return; try{ engine.rumble.stop(); engine.whine.stop(); engine.noise&&engine.noise.stop(); }catch(e){} engine=null; }
function audioStop(){ if(!engine||!actx) return; const e=engine; e.g.gain.setTargetAtTime(0,actx.currentTime,.18); setTimeout(()=>{ try{ e.rumble.stop(); e.whine.stop(); }catch(x){} },500); if(engine===e) engine=null; }
function audioUpdate(){ if(!engine||!actx) return; const ctx=actx; const rpm=engine.cur+((sim.lastRpm||0)-engine.cur)*0.15; engine.cur=rpm; const rev=rpm/60, p=propulsionParams(), blade=rev*(p.blades||2); engine.rumble.frequency.setTargetAtTime(Math.max(rev,10),ctx.currentTime,.05); engine.whine.frequency.setTargetAtTime(Math.max(blade,40),ctx.currentTime,.05); engine.bp.frequency.setTargetAtTime(Math.min(400+blade*1.4,5200),ctx.currentTime,.05); const lvl=Math.min(0.25+rpm/9000*0.7,1.0); engine.g.gain.setTargetAtTime(lvl,ctx.currentTime,.08); }
function voiceBlip(){ if(state.voiceVol<=0) return; try{ const ctx=ac(); const o=ctx.createOscillator(), g=ctx.createGain(); o.type="triangle"; o.frequency.value=523; const vol=Math.min(state.voiceVol/100,1)*0.22; g.gain.setValueAtTime(0,ctx.currentTime); g.gain.linearRampToValueAtTime(vol,ctx.currentTime+.02); g.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+.18); o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime+.22); }catch(e){} }
function playVoice(){ const step=ESC_DB.instructor[state.instrStep]; if(step&&step.audio){ playVoiceFile(step.audio); return; } if(state.voiceVol<=0) return; try{ [392,494,587].forEach((f,i)=>tone(f,i*.16,.2,(state.voiceVol/100)*.18,"triangle")); }catch(e){} }
function replayVoice(){ playVoiceFile(lastVoiceUrl || INTRO_FILES[currentIntroKey()]); }
function renderInstr(){ const steps=ESC_DB.instructor; $("instrText").textContent=steps[state.instrStep].text; $("instrStepTxt").textContent="step "+(state.instrStep+1)+" / "+steps.length; $("instrPanel").hidden=!state.instrOpen; }
function instrGo(n){ state.instrStep=Math.max(0,Math.min(n,ESC_DB.instructor.length-1)); saveState(); renderInstr(); }
function instrEvent(evt){ const map={picker:1,select:2,run:3,runDone:4}; const target=map[evt]; if(target!=null && state.instrStep<target){ instrGo(target); playVoice(); } }

/* ════════════ 14 · WIRING + BOOT ════════════ */
document.querySelectorAll("#tabbar button").forEach(b=>{ b.addEventListener("click",()=>{ document.querySelectorAll("#tabbar button").forEach(x=>x.classList.toggle("active",x===b)); const target=$(b.dataset.target); if(target) window.scrollTo({top:target.offsetTop-6,behavior:"smooth"}); }); });
$("modalClose").addEventListener("click", closeModal);
$("modalOverlay").addEventListener("click", e=>{ if(e.target===$("modalOverlay")) closeModal(); });
document.addEventListener("keydown", e=>{ if(e.key==="Escape" && !$("modalOverlay").hidden) closeModal(); });

let lastT=0, graphEvery=0;
sim._g=0;
function loop(t){
  requestAnimationFrame(loop); frameNo++;
  const dt=Math.min((t-lastT)/1000,.05)||.016; lastT=t;
  spinPhase+=.02;
  // idle supply readout when not running
  if(!simActive && sceneMode()!=="explore"){
    const c=calc(); renderSupplyReadout(c.duty>0?c.V:state.vset, c.duty>0?c.phaseI:0, c.duty>0?c.mode:"CV");
    updateTelemetry({ throttle:c.throttle, rpm:c.rpm, volts:c.duty>0?c.V:state.vset, cur:c.duty>0?c.phaseI:0, pesc:c.duty>0?c.Ptot:0, temp:heatT, lat:(sceneMode()==="latency"?(c.latency<1?(c.latency*1000).toFixed(0)+" µs":c.latency.toFixed(2)+" ms"):undefined), stateTxt:state.escDead?"BURNT":state.armed?"ARMED":"DISARMED", phase:state.escDead?"ESC FAULT":state.armed?"ARMED · IDLE":"DISARMED", phaseCls:state.escDead?"danger":"" });
  }
  if(simActive){ simStep(dt); audioUpdate(); }
  // spin the propeller when the motor turns
  if(propSpinner){ const w=evalWiring(); const spin=(sim.lastRpm||0)>10 ? Math.min((sim.lastRpm||0)/1600,3.2)+.12 : 0; propSpinner.rotation.y += spin*(w.spinDir||1); }
  // ESC junction heatmap
  if(escGroup && escGroup.userData.mosfets){ const k=smokeRamp(heatT,40,180); escGroup.userData.mosfets.forEach(m=>{ if(m.material){ const c=new THREE.Color(0x1a1d22).lerp(new THREE.Color(0xff5522),k); m.material.color.copy(c); m.material.emissive && m.material.emissive.copy(c).multiplyScalar(k*0.6); } }); }
  // FX intensity from junction temp / dead esc
  FX.kindIntensity("esc", state.escDead?1:smokeRamp(heatT,120,200));
  FX.tick(dt); blitPreviews();
  if(controls) controls.update();
  if(renderer) renderer.render(scene, camera);
}
function hideBoot(){ const o=$("bootOverlay"); if(o){ o.classList.add("gone"); setTimeout(()=>o.remove(),500); } }
/* replace the boot overlay with a readable fatal message instead of a blank/white screen */
function bootFatal(title, detail){
  const card=document.querySelector(".boot-card"); const o=$("bootOverlay");
  if(o) o.classList.remove("gone");
  if(!card){ alert(title+"\n\n"+detail); return; }
  card.innerHTML='<div style="max-width:440px;text-align:center;color:#1e2a29">'+
    '<div style="width:46px;height:46px;border-radius:50%;background:#a83232;color:#fff;display:flex;align-items:center;justify-content:center;font-size:24px;margin:0 auto 14px">!</div>'+
    '<div style="font-size:14px;font-weight:700;margin-bottom:8px">'+title+'</div>'+
    '<div style="font-size:12px;line-height:1.6;color:#5c6d68">'+detail+'</div></div>';
}
function populateSelects(){
  const fs=$("faultSelect"); if(fs){ fs.innerHTML=""; ESC_DB.faults.forEach(f=>{ const o=el("option"); o.value=f.id; o.textContent=f.label; fs.appendChild(o); }); fs.value=state.fault; }
  const ps=$("protocolSelect"); if(ps){ ps.innerHTML=""; ESC_DB.protocols.forEach(pr=>{ const o=el("option"); o.value=pr.id; o.textContent=pr.label; ps.appendChild(o); }); ps.value=state.protocol; }
}
async function boot(){
  // 1 · file:// blocks fetch of the catalog → surface a clear message, not a white screen
  if(location.protocol === "file:"){
    bootFatal("Open this lab over HTTP, not from a file path",
      "The browser blocks loading the component catalog and 3D models from a <b>file://</b> path. Serve the folder instead:<br><br>"+
      "<code style='font-family:monospace;background:#eef1ef;padding:2px 5px;border-radius:4px'>python3 -m http.server 8731</code><br><br>"+
      "then open <b>http://localhost:8731/index.html</b>.");
    return;
  }
  // 2 · required 3D libraries (CDN) must be present
  if(typeof THREE === "undefined" || !THREE.OrbitControls || !THREE.GLTFLoader){
    bootFatal("3D libraries failed to load",
      "three.js / OrbitControls / GLTFLoader could not be fetched from the CDN — a network block, ad-blocker or offline session will do this. Check your connection (or unblock cdnjs.cloudflare.com and cdn.jsdelivr.net) and reload.");
    return;
  }
  try{ await loadCatalog(); }
  catch(e){ console.error("Catalog failed:", e);
    bootFatal("Could not load the component catalog",
      "assets/manifest.json could not be fetched. Make sure the lab is served over HTTP from the <b>simulation/</b> folder and that <b>assets/</b> is present.<br><br>Error: "+(e&&e.message||e));
    return; }
  bootProgress("initialising lab…", .8);
  try{
  loadState();
  initPreviewEngine(); initViewport();
  renderTiles(); renderSpecMini(); populateSelects();
  renderModuleTabs(); renderExpTabs(); applyStageVisibility(); renderProgress();
  renderCalcChips(); renderLog(); renderCompList(); renderReward(); renderInstr(); syncRunControls();
  drawLiveGraph(); drawAnalysisChart();
  // input bindings
  $("vsetSlider").value=state.vset; $("vsetVal").textContent=state.vset.toFixed(1)+" V";
  $("ilimSlider").value=state.ilim; $("ilimVal").textContent=state.ilim+" A";
  $("pulseSlider").value=state.pulse; $("pulseVal").textContent=Math.round(state.pulse)+" µs";
  $("explodeSlider").value=state.explode; $("explodeVal").textContent=state.explode+"%";
  $("voiceVol").value=state.voiceVol; $("voiceVolTxt").textContent=state.voiceVol;
  $("sfxVol").value=state.sfxVol; $("sfxVolTxt").textContent=state.sfxVol;
  $("hotToggle").checked=state.hotModel; $("heatsinkToggle").checked=state.heatsink;
  $("vsetSlider").addEventListener("input", e=>{ state.vset=+e.target.value; $("vsetVal").textContent=state.vset.toFixed(1)+" V"; renderCalcChips(); renderLog(); saveState(); });
  $("ilimSlider").addEventListener("input", e=>{ state.ilim=+e.target.value; $("ilimVal").textContent=state.ilim+" A"; renderCalcChips(); renderLog(); saveState(); });
  $("pulseSlider").addEventListener("input", e=>{ if(simActive) return; state.pulse=+e.target.value; $("pulseVal").textContent=Math.round(state.pulse)+" µs"; state.sweepMin=Math.min(state.sweepMin,state.pulse); state.sweepMax=Math.max(state.sweepMax,state.pulse); renderCalcChips(); drawLiveGraph(); saveState(); });
  $("explodeSlider").addEventListener("input", e=>{ state.explode=+e.target.value; $("explodeVal").textContent=state.explode+"%"; if(escGroup && isAnatomy()) applyExplode(escGroup, state.explode); saveState(); });
  $("faultSelect").addEventListener("change", e=>{ state.fault=e.target.value; renderCalcChips(); renderLog(); drawLiveGraph(); drawAnalysisChart(); saveState(); });
  $("protocolSelect").addEventListener("change", e=>{ state.protocol=e.target.value; renderCalcChips(); renderLog(); drawLiveGraph(); drawAnalysisChart(); saveState(); });
  $("calibrateBtn").addEventListener("click", ()=>{ state.endpointsStored=true; state.pulse=1000; $("pulseSlider").value=1000; $("pulseVal").textContent="1000 µs"; sfx("done"); syncRunControls(); renderLog(); drawLiveGraph(); saveState(); });
  $("armBtn").addEventListener("click", ()=>{ if(state.escDead) return; if(state.armed){ state.armed=false; } else { const w=evalWiring(); if(!w.correctPower){ showVerdictToast("Arming refused — power wiring incomplete or reversed.", false); sfx("error"); return; } if(!state.endpointsStored){ showVerdictToast("Store the throttle endpoints before arming.", false); sfx("error"); return; } if(state.fault!=="none"){ showVerdictToast("Arming refused — a bad calibration is stored (fault active).", false); sfx("error"); return; } state.armed=true; state.pulse=1000; $("pulseSlider").value=1000; $("pulseVal").textContent="1000 µs"; sfx("done"); } syncRunControls(); renderLog(); saveState(); });
  $("presetHover").addEventListener("click", ()=>{ state.thermalPreset="hover"; syncRunControls(); renderCalcChips(); renderLog(); drawLiveGraph(); saveState(); });
  $("presetFull").addEventListener("click", ()=>{ state.thermalPreset="full"; syncRunControls(); renderCalcChips(); renderLog(); drawLiveGraph(); saveState(); });
  $("hotToggle").addEventListener("change", e=>{ state.hotModel=e.target.checked; renderCalcChips(); renderLog(); drawLiveGraph(); drawAnalysisChart(); saveState(); });
  $("heatsinkToggle").addEventListener("change", e=>{ state.heatsink=e.target.checked; renderCalcChips(); renderLog(); drawLiveGraph(); drawAnalysisChart(); saveState(); });
  $("stepBtn").addEventListener("click", ()=>{ sim.tphase=(sim.tphase||0)+20; drawLiveGraph(); });
  $("specCard").addEventListener("click", openSpecDetail);
  $("calcCard").addEventListener("click", openCalcDetail);
  $("logHead").addEventListener("click", openChartsDetail);
  $("graphCard").addEventListener("click", openGraphDetail);
  $("chartCard").addEventListener("click", openChartsDetail);
  $("runBtn").addEventListener("click", runSim);
  $("resetBtn").addEventListener("click", resetSim);
  $("instrOrb").addEventListener("click", ()=>{ state.instrOpen=!state.instrOpen; saveState(); renderInstr(); if(state.instrOpen) playVoice(); });
  $("instrPrev").addEventListener("click", ()=>{ instrGo(state.instrStep-1); playVoice(); });
  $("instrNext").addEventListener("click", ()=>{ instrGo(state.instrStep+1); playVoice(); });
  $("instrReplay").addEventListener("click", replayVoice);
  $("voiceVol").addEventListener("input", e=>{ state.voiceVol=+e.target.value; $("voiceVolTxt").textContent=e.target.value; if(currentVoice) currentVoice.volume=Math.min(state.voiceVol/100,1); saveState(); });
  $("voiceVol").addEventListener("change", voiceBlip);
  $("sfxVol").addEventListener("input", e=>{ state.sfxVol=+e.target.value; $("sfxVolTxt").textContent=e.target.value; setMasterVol(); saveState(); });
  $("sfxVol").addEventListener("change", ()=>sfx("tick"));
  window.addEventListener("resize", resizeViewport);
  let _rz=0; window.addEventListener("resize", ()=>{ clearTimeout(_rz); _rz=setTimeout(()=>{ drawLiveGraph(); drawAnalysisChart(); },140); });
  if(state.instrOpen) playIntroVoice(currentIntroKey());
  let primed=false; const prime=()=>{ if(primed) return; primed=true; try{ if(actx&&actx.state==="suspended") actx.resume(); }catch(e){} };
  window.addEventListener("pointerdown", prime, {once:true}); window.addEventListener("keydown", prime, {once:true});
  bootProgress("ready", 1); hideBoot();
  requestAnimationFrame(loop);
  }catch(e){
    console.error("Init failed:", e);
    bootFatal("The lab failed to start", "An error occurred while building the bench. This is usually a WebGL problem (disabled/unsupported GPU) or a missing asset.<br><br>Error: "+(e&&e.message||e));
  }
}
boot();

