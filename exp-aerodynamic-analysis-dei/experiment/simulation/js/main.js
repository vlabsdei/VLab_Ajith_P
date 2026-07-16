/* ════════════════════════════════════════════════════════════════
   AERODYNAMIC ANALYSIS LAB — main.js  (Exp-3)
   Ported framework from the Drone Technology Lab platform; domain
   physics/scenes/charts replaced with aerodynamic models (BUILD_SPEC).

   MODULES
     M1 Airfoil Lab      — Polar (AoA sweep, wind-tunnel airfoil scene)
     M2 Forward Flight   — Frame Drag (V sweep) + Cruise Efficiency (J sweep)
                           on the assembled drone with a PROCEDURAL prop

   Sections
     1  Catalog loader          8  Viewport / scenes
     2  State + persistence      9  Left panel + UI rendering
     3  Utilities + aero summary 10 Charts (Chart.js)
     4  Physics engine (aero)    11 Simulation runner
     5  Diagnostics / log        12 Procedural audio engine
     6  3D models + sizing       13 Instructor
     6b Procedural propeller     14 Wiring + boot
     7  Preview engine
   ════════════════════════════════════════════════════════════════ */

/* ════════════ 1 · CATALOG LOADER ════════════ */
let DRONE_DB = null;

function bootProgress(txt, frac){
  const s = document.getElementById("bootSub"), f = document.getElementById("bootFill");
  if(s && txt) s.textContent = txt;
  if(f && frac != null) f.style.width = Math.round(frac*100) + "%";
}

async function loadCatalog(){
  bootProgress("loading airfoil & component catalog…", .1);
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
    const order = c.options;
    const opts = (byCat[c.key] || []).sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id));
    return { key:c.key, label:c.label, multi:!!c.multi, options:opts };
  });
  // airfoils — flat physics table, α0 computed at load (never stored)
  const airfoils = (manifest.airfoils || []).map(a=>{
    const al0 = alpha0Deg(a.m, a.p);           // thin-airfoil camber-line integral
    return Object.assign({}, a, { alpha0_deg: al0 });
  });
  DRONE_DB = {
    categories,
    airfoils,
    defaults: manifest.defaults || {},
    modules: manifest.modules,
    instructor: manifest.instructor,
    reward: {
      name: manifest.reward.name, desc: manifest.reward.desc,
      files: manifest.reward.model ? [manifest.reward.model] : [],
      fallback: { kind: manifest.reward.fallback || "prop", color: 0x845b23, s: 1 }
    }
  };
}

/* ════════════ 2 · STATE + PERSISTENCE ════════════ */
const LS_KEY = "dtl-aero-v1";
const state = {
  sel:{}, altitude:0, module:"m1", exp:{}, done:{},
  airfoil:"naca2412", blades:2,
  diameter_in:5.0, root_chord_mm:14, tip_chord_mm:8, pitch_angle_deg:12,
  rpm:6000, aoa_deg:5, wind_v:8, washOn:false,
  profiled:{},                              // per-airfoil profiled results { id:{clMax,aStall,...} }
  voiceVol:80, sfxVol:60, instrStep:0,
  simRunning:false, instrOpen:true
};
function loadState(){
  let s = {};
  try{ s = JSON.parse(localStorage.getItem(LS_KEY)) || {}; }catch(e){}
  const d = DRONE_DB.defaults;
  state.sel = Object.assign({}, {
    chasis:d.chasis, motor:d.motor, esc:d.esc, battery:d.battery,
    controller:d.controller, reciever:d.reciever, attachments:d.attachments||[]
  }, s.sel || {});
  DRONE_DB.categories.forEach(c=>{
    if(c.multi){
      const v = state.sel[c.key];
      state.sel[c.key] = (Array.isArray(v)?v:(v?[v]:[])).filter(id=>c.options.some(o=>o.id===id));
    }else if(!c.options.some(o=>o.id===state.sel[c.key])){
      state.sel[c.key] = c.options[0] && c.options[0].id;
    }
  });
  const airfoilOk = DRONE_DB.airfoils.some(a=>a.id===s.airfoil);
  state.airfoil = airfoilOk ? s.airfoil : (d.airfoil || (DRONE_DB.airfoils[0]&&DRONE_DB.airfoils[0].id));
  state.blades = [2,3,4].includes(s.blades) ? s.blades : (d.blades||2);
  const num = (k, def, lo, hi)=>{ const v = s[k]; return (typeof v==="number" && v>=lo && v<=hi) ? v : def; };
  state.diameter_in    = num("diameter_in",    d.diameter_in||5,   3, 17);
  state.root_chord_mm  = num("root_chord_mm",  d.root_chord_mm||14, 6, 26);
  state.tip_chord_mm   = num("tip_chord_mm",   d.tip_chord_mm||8,   4, 20);
  state.pitch_angle_deg= num("pitch_angle_deg",d.pitch_angle_deg||12,2,24);
  state.rpm            = num("rpm",            d.rpm||6000,      1000, 12000);
  state.aoa_deg        = num("aoa_deg",        d.aoa_deg||5,       -5, 20);
  state.wind_v         = num("wind_v",         d.wind_v||8,         0, 20);
  state.washOn         = !!s.washOn;
  state.altitude = s.altitude != null ? s.altitude : 0;
  state.module = DRONE_DB.modules.some(m=>m.id===s.module) ? s.module : DRONE_DB.modules[0].id;
  DRONE_DB.modules.forEach(m=>{
    const saved = s.exp && s.exp[m.id];
    state.exp[m.id] = m.experiments.some(e=>e.id===saved) ? saved : m.experiments[0].id;
  });
  state.done = s.done || {};
  state.profiled = s.profiled || {};
  state.voiceVol = s.voiceVol != null ? s.voiceVol : 80;
  state.sfxVol = s.sfxVol != null ? s.sfxVol : 60;
  state.instrStep = Math.min(s.instrStep || 0, DRONE_DB.instructor.length - 1);
  state.instrOpen = s.instrOpen !== false;
  // gate: if M1 not done, force module back to m1
  if(state.module !== "m1" && !state.done["m1:polar"]) state.module = "m1";
}
function saveState(){
  try{
    localStorage.setItem(LS_KEY, JSON.stringify({
      sel:state.sel, altitude:state.altitude, module:state.module, exp:state.exp, done:state.done,
      airfoil:state.airfoil, blades:state.blades,
      diameter_in:state.diameter_in, root_chord_mm:state.root_chord_mm, tip_chord_mm:state.tip_chord_mm,
      pitch_angle_deg:state.pitch_angle_deg, rpm:state.rpm, aoa_deg:state.aoa_deg,
      wind_v:state.wind_v, washOn:state.washOn, profiled:state.profiled,
      voiceVol:state.voiceVol, sfxVol:state.sfxVol, instrStep:state.instrStep, instrOpen:state.instrOpen
    }));
  }catch(e){}
}

/* ════════════ 3 · UTILITIES + AERO SUMMARY ════════════ */
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
const airfoilById = id => DRONE_DB.airfoils.find(a=>a.id===id) || DRONE_DB.airfoils[0];
const curAirfoil = () => airfoilById(state.airfoil);
function fmtMass(g){ return g >= 1000 ? (g/1000).toFixed(2)+" kg" : (g<10 && g>0 ? g.toFixed(1) : Math.round(g))+" g"; }
function configCode(){
  const s = JSON.stringify([state.airfoil,state.blades,state.sel.chasis,state.diameter_in,state.pitch_angle_deg]);
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
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const lerp = (a,b,t)=>a+(b-a)*t;
const smoothstep = (a,b,x)=>{ const t = clamp((x-a)/(b-a||1e-9),0,1); return t*t*(3-2*t); };
const DEG = Math.PI/180, RAD = 180/Math.PI;

/* ════════════ 4 · PHYSICS ENGINE (aerodynamics) ════════════
   Constants + ISA density from the altitude slider. All formulas per
   BUILD_SPEC §3. α0 is the thin-airfoil camber-line integral (§3B),
   Cl(α) uses finite-thickness/Re lift slope with a Viterna post-stall
   blend (§3C), drag polar §3D, blade Reynolds §3E, frame drag §3F,
   advance ratio + propulsive efficiency §3G.                        */
const G = 9.80665;
const MU_AIR = 1.81e-5;         // dynamic viscosity Pa·s
const A_SOUND = 340;            // m/s
const rhoAt = h => 1.225 * Math.pow(1 - 2.25577e-5 * Math.max(0, Math.min(11000, h)), 4.25588);
const rhoNow = () => rhoAt(state.altitude);

/* ── 3A · NACA 4-digit geometry (chord = 1) ── */
function thicknessYt(x, t){
  return 5*t*(0.2969*Math.sqrt(Math.max(x,0)) - 0.1260*x - 0.3516*x*x + 0.2843*x*x*x - 0.1015*x*x*x*x);
}
function camber(x, m, p){
  if(m === 0 || p === 0) return { yc:0, dyc:0 };
  if(x < p){
    return { yc:(m/(p*p))*(2*p*x - x*x), dyc:(2*m/(p*p))*(p - x) };
  }
  const q = (1-p);
  return { yc:(m/(q*q))*((1-2*p) + 2*p*x - x*x), dyc:(2*m/(q*q))*(p - x) };
}
/* Upper/lower surface point at station x. Returns {xu,yu,xl,yl,yc}. */
function airfoilSurface(x, m, p, t){
  const c = camber(x, m, p);
  const yt = thicknessYt(x, t);
  const th = Math.atan(c.dyc);
  const s = Math.sin(th), co = Math.cos(th);
  return { xu:x - yt*s, yu:c.yc + yt*co, xl:x + yt*s, yl:c.yc - yt*co, yc:c.yc };
}
/* Full ordered outline polygon (upper TE→LE then lower LE→TE), N per side. */
function airfoilOutline(m, p, t, N){
  N = N || 60;
  const up = [], lo = [];
  for(let i=0;i<=N;i++){
    const x = 0.5*(1 - Math.cos(Math.PI*i/N));    // cosine spacing, LE dense
    const s = airfoilSurface(x, m, p, t);
    up.push([s.xu, s.yu]); lo.push([s.xl, s.yl]);
  }
  // upper from TE→LE, then lower LE→TE (skip duplicate LE)
  const pts = [];
  for(let i=up.length-1;i>=0;i--) pts.push(up[i]);
  for(let i=1;i<lo.length;i++) pts.push(lo[i]);
  return pts;
}

/* ── 3B · Zero-lift angle α0 (thin-airfoil, computed) ── */
function alpha0Deg(m, p){
  if(m === 0 || p === 0) return 0;
  const N = 200; let acc = 0;
  for(let i=1;i<=N;i++){
    const th = Math.PI*(i-0.5)/N;                 // midpoint rule θ∈[0,π]
    const x = (1 - Math.cos(th))/2;
    const dyc = camber(x, m, p).dyc;
    acc += dyc*(Math.cos(th) - 1);
  }
  acc *= (Math.PI/N);                             // dθ
  const a0_rad = -(1/Math.PI)*acc;
  return a0_rad * RAD;
}

/* ── 3E · Blade Reynolds (section Re at 0.75R) ── */
function bladeReynolds(){
  const R = (state.diameter_in*0.0254)/2;
  const omega = 2*Math.PI*state.rpm/60;
  const Vlocal = Math.max(omega*0.75*R, 0.5);
  const cbar = ((state.root_chord_mm + state.tip_chord_mm)/2)/1000;   // m
  return Math.max(rhoNow()*Vlocal*cbar/MU_AIR, 1000);
}
function tipMach(){
  const R = (state.diameter_in*0.0254)/2;
  const omega = 2*Math.PI*state.rpm/60;
  return omega*R/A_SOUND;
}

/* ── 3C · Lift curve Cl(α) with real stall (Viterna post-stall) ── */
/* Returns a coefficient model for a given airfoil at a given Reynolds. */
function airfoilModel(af, Re){
  af = af || curAirfoil();
  Re = Re || 5e5;
  const t = af.t, m = af.m, p = af.p;
  const a0deg = af.alpha0_deg != null ? af.alpha0_deg : alpha0Deg(m, p);
  const a0 = a0deg*DEG;
  // finite-thickness + Re lift slope
  const eta_thk = 1 + 0.77*t;
  const eta_Re = clamp(0.88 + 0.05*Math.log10(Re/1e5), 0.85, 1.03);
  const slope = 2*Math.PI*eta_thk*eta_Re;         // per rad (~6.0–6.6)
  // Re-scaled Cl_max and stall AoA
  const clMax = clamp(af.cl_max_ref*(1 + 0.10*Math.log10(Re/af.re_ref)), 0.7, 2.0);
  const aStallGeoDeg = af.a_stall_ref*(1 + 0.04*Math.log10(Re/af.re_ref));
  const aStallDeg = a0deg + aStallGeoDeg;         // absolute positive-stall AoA (deg)
  const aStall = aStallDeg*DEG;
  // Viterna post-stall constants
  const CdMax = 2.0;
  const A1 = CdMax/2;
  const sA = Math.sin(aStall), cA = Math.cos(aStall);
  const A2 = (clMax - CdMax*sA*cA)*(sA/Math.max(cA*cA,1e-3));
  const B2cd = (Math.abs(cA) > 1e-3) ? 0 : 0;     // placeholder (Cd via cd())
  // section drag polar §3D
  const cf_lam = 1.328/Math.sqrt(Re);
  const cf_turb = 0.074/Math.pow(Re,0.2);
  const transBlend = smoothstep(1e5, 8e5, Re);    // laminar→turbulent
  const Cf = lerp(cf_lam, cf_turb, transBlend);
  const Cd0 = 2*Cf*(1 + 2*t + 60*Math.pow(t,4));
  const k = 0.010 + 0.02*t;
  const clAtA0 = 0;                               // Cl≈0 at α0 by construction

  function clLin(aRad){ return slope*(aRad - a0); }
  function clPost(aRad){
    // symmetric Viterna for |α|>aStall
    const sgn = aRad>=0 ? 1 : -1;
    const a = Math.abs(aRad);
    const s2 = Math.sin(2*a), c = Math.cos(a), s = Math.max(Math.sin(a),1e-3);
    return sgn*(A1*s2 + A2*c*c/s);
  }
  function cl(aRad){
    const aStallP = aStall, aStallN = -(aStall - 2*a0);   // mirror about α0
    // positive side
    if(aRad >= 0){
      const w = smoothstep(aStallP - 3*DEG, aStallP + 3*DEG, aRad);
      return lerp(clLin(aRad), clPost(aRad), w);
    }else{
      const w = smoothstep(-(aStallN) , -(aStallN)+6*DEG, -aRad); // approx symmetric
      const wPos = smoothstep(aStallN + 3*DEG, aStallN - 3*DEG, aRad);
      return lerp(clLin(aRad), clPost(aRad), clamp(wPos,0,1));
    }
  }
  function cd(aRad){
    const clv = cl(aRad);
    const cdLin = Cd0 + k*Math.pow(clv - clAtA0, 2);
    // post-stall Viterna Cd rise
    const a = Math.abs(aRad);
    const cdPost = CdMax*Math.pow(Math.sin(a),2) + Cd0*Math.pow(Math.cos(a),2);
    const w = smoothstep(aStall - 3*DEG, aStall + 3*DEG, a);
    return lerp(cdLin, cdPost, w);
  }
  return {
    af, Re, a0deg, a0, slope, clMax, aStallDeg, aStall, Cd0, k,
    cl, cd,
    ld:(aRad)=>{ const c = cd(aRad); return c>1e-6 ? cl(aRad)/c : 0; },
    clDeg:(aDeg)=>cl(aDeg*DEG), cdDeg:(aDeg)=>cd(aDeg*DEG), ldDeg:(aDeg)=>{
      const a=aDeg*DEG, c=cd(a); return c>1e-6? cl(a)/c : 0; }
  };
}
/* convenience: current-airfoil model at blade Re (M1 uses a fixed section Re) */
function m1SectionRe(){
  // wind-tunnel-style section Re from airspeed over a unit-ish chord; keep near re_ref
  const cbar = ((state.root_chord_mm + state.tip_chord_mm)/2)/1000;
  const V = Math.max(state.wind_v, 6);
  return clamp(rhoNow()*V*Math.max(cbar,0.05)/MU_AIR * 40, 1e5, 2e6);
}

/* ── Blade / propeller derived geometry ── */
function bladeGeom(){
  const D = state.diameter_in*0.0254;            // m
  const R = D/2;
  const cbar = ((state.root_chord_mm + state.tip_chord_mm)/2)/1000;
  const B = state.blades;
  const sigma = B*cbar/(Math.PI*R);              // solidity
  const AR = R/Math.max(cbar,1e-4);              // blade aspect ratio (span/chord)
  const Adisk = Math.PI*R*R;
  return { D, R, cbar, B, sigma, AR, Adisk, diaIn:state.diameter_in };
}

/* ── 3G · Advance ratio + propulsive efficiency ── */
function propCoeffs(){
  const g = bladeGeom();
  const Re = bladeReynolds();
  const model = airfoilModel(curAirfoil(), Re);
  const pitchDeg = state.pitch_angle_deg;
  // section design Cl at pitch AoA (couples M1↔M2): effective AoA ≈ pitch*0.6
  const aEff = pitchDeg*0.6*DEG;
  const Cl_design = Math.max(model.cl(aEff), 0.05);
  const Cd_design = Math.max(model.cd(aEff), 1e-3);
  const sigma_ref = 0.10;
  const pitch_in = state.diameter_in*Math.tan(pitchDeg*DEG)*Math.PI*0.85; // geometric pitch (in)
  const pd = pitch_in/Math.max(state.diameter_in,1);
  const pitch_fac = clamp(0.6 + 0.5*pd, 0.5, 1.4);
  const Ct0 = 0.11*(g.sigma/sigma_ref)*(Cl_design/1.0)*pitch_fac;
  const Cq0 = Ct0*(0.045 + 0.11*pd + 0.6*Cd_design/Math.max(Cl_design,0.3));
  const J0 = pd*0.9;                              // zero-thrust advance ratio (geometric)
  return { g, Re, model, Cl_design, Cd_design, pitch_in, pd, Ct0, Cq0, J0 };
}
function propAtJ(pc, J){
  const r = clamp(J/Math.max(pc.J0,1e-3), 0, 1.5);
  const Ct = Math.max(pc.Ct0*(1 - r*r), 0);
  const Cq = Math.max(pc.Cq0*(1 - 0.35*r + 0.55*r*r), 1e-6);
  const n = state.rpm/60;
  const D = pc.g.D, rho = rhoNow();
  const T = Ct*rho*n*n*Math.pow(D,4);
  const Q = Cq*rho*n*n*Math.pow(D,5);
  const eta = (Cq>1e-9) ? J*Ct/(2*Math.PI*Cq) : 0;
  return { J, Ct, Cq, T, Q, eta:clamp(eta,0,1), n };
}
/* sweep J from 0→J0, return series + peak */
function cruiseSweep(pc, steps){
  pc = pc || propCoeffs();
  steps = steps || 60;
  const n = state.rpm/60, D = pc.g.D;
  const Vmax = pc.J0*n*D;                          // V at J=J0
  const J=[], eta=[], Ct=[], T=[], V=[];
  let peak = { eta:0, J:0, V:0 };
  for(let i=0;i<=steps;i++){
    const v = Vmax*i/steps;
    const j = (n*D>1e-6) ? v/(n*D) : 0;
    const r = propAtJ(pc, j);
    J.push(+j.toFixed(4)); eta.push(+(r.eta*100).toFixed(2)); Ct.push(+r.Ct.toFixed(4));
    T.push(+r.T.toFixed(3)); V.push(+v.toFixed(2));
    if(r.eta > peak.eta) peak = { eta:r.eta, J:j, V:v };
  }
  return { J, eta, Ct, T, V, Vmax, peak };
}

/* ── 3F · Frame drag (Sub-Calc B) + V² regression ── */
function frameDragCd(Re_body){
  return 1.05*(1 + 0.03*(1 - clamp(Re_body/3e5, 0, 1)));
}
function frontalArea(){
  const ch = opt("chasis");
  return (ch && ch.phys && ch.phys.frontal_area_m2) || 0.011;
}
function dragForce(V){
  const rho = rhoNow(), A = frontalArea();
  const kInt = state.washOn ? 1.20 : 1.00;
  const cbar = 0.28;                              // characteristic body length for Re_body
  const Re_body = Math.max(rho*V*cbar/MU_AIR, 1);
  const Cd = frameDragCd(Re_body);
  return { F:0.5*rho*V*V*Cd*A*kInt, Cd, q:0.5*rho*V*V, Re_body, A, kInt, rho };
}
function dragSweep(steps, Vmax){
  steps = steps || 60; Vmax = Vmax || 15;
  const V=[], F=[], V2=[];
  for(let i=0;i<=steps;i++){
    const v = Vmax*i/steps;
    const d = dragForce(v);
    V.push(+v.toFixed(3)); F.push(+d.F.toFixed(4)); V2.push(+(v*v).toFixed(3));
  }
  // through-origin regression F = s·V²
  let sumFV2=0, sumV4=0;
  for(let i=0;i<V.length;i++){ sumFV2 += F[i]*V2[i]; sumV4 += V2[i]*V2[i]; }
  const s = sumV4>0 ? sumFV2/sumV4 : 0;
  // R² vs V²
  const mean = F.reduce((a,b)=>a+b,0)/F.length;
  let ssRes=0, ssTot=0;
  for(let i=0;i<V.length;i++){ const pred=s*V2[i]; ssRes += Math.pow(F[i]-pred,2); ssTot += Math.pow(F[i]-mean,2); }
  const R2 = ssTot>0 ? 1 - ssRes/ssTot : 1;
  // theoretical slope 0.5·ρ·Cd·A·k (Cd near-constant → take at mid V)
  const dm = dragForce(Vmax*0.6);
  const sTheory = 0.5*dm.rho*dm.Cd*dm.A*dm.kInt;
  const errPct = sTheory>0 ? (s - sTheory)/sTheory*100 : 0;
  return { V, F, V2, slope:s, R2, sTheory, errPct, Vmax };
}

/* master aero calc snapshot (drives calc chips / summary) */
function aeroCalc(){
  const g = bladeGeom();
  const Re = bladeReynolds();
  const model = airfoilModel(curAirfoil(), m1SectionRe());
  const pc = propCoeffs();
  const cs = cruiseSweep(pc, 48);
  const d10 = dragForce(10);
  return {
    g, Re, model, pc, cs,
    rho: rhoNow(),
    clMax: model.clMax, aStallDeg: model.aStallDeg, a0deg: model.a0deg,
    clNow: model.clDeg(state.aoa_deg), cdNow: model.cdDeg(state.aoa_deg), ldNow: model.ldDeg(state.aoa_deg),
    tipMach: tipMach(),
    Fd10: d10.F, etaPeak: cs.peak.eta*100, etaPeakJ: cs.peak.J, J0: pc.J0
  };
}

/* ════════════ 5 · DIAGNOSTICS / LOG ════════════ */
/* returns { items:[{sev,msg,fix,block}], errors, warns, blocked } */
function diagnostics(){
  const items = [];
  const g = bladeGeom();
  const Re = bladeReynolds();
  const model = airfoilModel(curAirfoil(), Re);
  const tm = tipMach();
  const pc = propCoeffs();
  const { mod, exp } = currentExp();
  const metric = exp.metric;

  // low-Re thin-airfoil breakdown (blocking for M1 polar — the model is unreliable)
  if(Re < 1e5){
    items.push({ sev:"err", block: metric==="cl", tag:"low-re",
      msg:"Low blade Reynolds — Re "+Math.round(Re).toLocaleString()+" < 1×10⁵; thin-airfoil theory and the Cl_max scaling break down.",
      fix:"Raise RPM, increase chord (root/tip), or use a larger diameter to lift the section Reynolds number." });
  }
  // tip Mach compressibility
  if(tm > 0.6){
    items.push({ sev: tm>0.85?"err":"warn", block: tm>0.95 && metric!=="cl",
      msg:"Tip Mach "+tm.toFixed(2)+" — compressibility losses (the incompressible model over-predicts thrust past M≈0.6).",
      fix:"Lower RPM or reduce the diameter to keep the tip below M 0.6." });
  }
  // solidity too high — blades overlap (B·c̄ > π·R·0.6)
  const solLimit = Math.PI*g.R*0.6;
  if(g.B*g.cbar > solLimit){
    items.push({ sev:"err", block: metric==="eta",
      msg:"Solidity too high — "+g.B+" blades of "+(g.cbar*1000).toFixed(0)+" mm mean chord overlap on a "+(g.R*1000).toFixed(0)+" mm radius (σ = "+g.sigma.toFixed(2)+").",
      fix:"Fewer blades, narrower chord, or a larger diameter." });
  } else if(g.sigma > 0.18){
    items.push({ sev:"warn",
      msg:"High solidity (σ = "+g.sigma.toFixed(2)+") — the blade element / momentum model loses accuracy above σ≈0.18.",
      fix:"Reduce blade count or chord for a cleaner disc." });
  }
  // AoA past stall (M1)
  if(metric === "cl" && state.aoa_deg > model.aStallDeg){
    items.push({ sev:"warn",
      msg:"Angle of attack "+state.aoa_deg.toFixed(1)+"° is past stall ("+model.aStallDeg.toFixed(1)+"°) — flow is separated, lift has collapsed.",
      fix:"Reduce AoA below the stall angle to stay on the linear lift curve." });
  }
  // J beyond J0 (windmilling) — cruise
  const Jnow = (state.rpm/60*g.D>1e-6) ? state.wind_v/(state.rpm/60*g.D) : 0;
  if(metric === "eta" && Jnow > pc.J0){
    items.push({ sev:"warn",
      msg:"Advance ratio J = "+Jnow.toFixed(2)+" exceeds the zero-thrust J₀ = "+pc.J0.toFixed(2)+" — the propeller is windmilling (negative thrust).",
      fix:"Lower the airspeed or raise RPM to bring J below J₀." });
  }
  // rotor-wash advisory (M2 drag)
  if(metric === "drag" && state.washOn){
    items.push({ sev:"warn",
      msg:"Rotor-wash interference is ON — the effective drag coefficient is raised ~20% to model rotor downwash over the frame.",
      fix:"Toggle it off to measure clean-frame drag." });
  }
  const errors = items.filter(i=>i.sev==="err").length;
  const warns = items.filter(i=>i.sev==="warn").length;
  const blocked = items.some(i=>i.block);
  if(!items.length) items.push({ sev:"ok", msg:"All aerodynamic checks passed — Reynolds, tip Mach, solidity and advance ratio are within model limits.", fix:"" });
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
      break;
    case "battery":
      add(new T.BoxGeometry(1.35,.5,.65), mat(c,{roughness:.4}));
      add(new T.BoxGeometry(.28,.54,.69), mat(0xd8b93c), -.2,0,0);
      break;
    case "fc":
      add(new T.BoxGeometry(.9,.07,.9), mat(0x1f4d3f));
      add(new T.BoxGeometry(.34,.12,.34), mat(c), 0,.09,0);
      break;
    case "rx":
      add(new T.BoxGeometry(.6,.18,.4), mat(c));
      add(new T.CylinderGeometry(.02,.02,.8,8), mat(0x22262b), .18,.48,0, .35,0,0);
      break;
    case "gimbal":
      add(new T.TorusGeometry(.42,.05,12,30), mat(0x33393f), 0,0,0, Math.PI/2);
      add(new T.BoxGeometry(.5,.4,.42), mat(c), 0,-.1,0);
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
function brightenModel(obj){
  obj.traverse(o => {
    if(!o.isMesh || !o.material) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
      if(!m || m.userData.__brightened) return;
      m.userData.__brightened = true;
      if(m.color) m.color.lerp(new THREE.Color(0xffffff), 0.09);
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
const ORIENT = { chasis:"flat", esc:"flat", battery:"flat", controller:"flat", reciever:"flat", motor:"axis", attachments:"none" };
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
function vertexCentroidXZ(root){
  root.updateMatrixWorld(true);
  let x = 0, z = 0, n = 0; const v = new THREE.Vector3();
  root.traverse(m => {
    if(!(m.isMesh && m.geometry && m.geometry.attributes && m.geometry.attributes.position)) return;
    const p = m.geometry.attributes.position;
    const step = Math.max(1, Math.floor(p.count / 2000));
    for(let i = 0; i < p.count; i += step){ v.fromBufferAttribute(p, i); m.localToWorld(v); x += v.x; z += v.z; n++; }
  });
  return n ? { x: x / n, z: z / n } : null;
}
function fitUnit(obj, span, o, orientOverride){
  const pre = new THREE.Group(); pre.add(obj);
  if(o){
    if(orientOverride){ autoOrient(pre, orientOverride); }
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
  if(o && o.catKey === "motor"){
    const hub = vertexCentroidXZ(outer);
    if(hub){ c.x = hub.x; c.z = hub.z; }
  }
  pre.position.sub(c);
  outer.scale.setScalar((span || 1.6) / maxDim);
  outer.userData.spanScale = (span||1.6)/maxDim;
  return outer;
}
function orientMotorCombo(combo, parts){
  if(!parts || parts.length < 2) return false;
  const cen = p => new THREE.Box3().setFromObject(p).getCenter(new THREE.Vector3());
  const sep = cen(parts[parts.length - 1]).sub(cen(parts[0]));
  if(sep.length() <= 1e-6) return false;
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
function seatModel(g, mode){
  if(g.parent) g.parent.updateWorldMatrix(true, false);
  const b = new THREE.Box3().setFromObject(g);
  if(b.isEmpty()) return;
  const c = g.getWorldPosition(new THREE.Vector3());
  const s = (g.parent ? g.parent.getWorldScale(new THREE.Vector3()).y : 1) || 1;
  if(mode === "hang") g.position.y -= (b.max.y - c.y) / s;
  else                g.position.y += (c.y - b.min.y) / s;
}
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
function measuredHeight(group){
  const box = new THREE.Box3().setFromObject(group);
  return { min: box.min.y, max: box.max.y, h: box.max.y - box.min.y };
}
const _raycaster = new THREE.Raycaster();
function raycastTopY(root, x, z, fallback){
  if(!root) return fallback;
  _raycaster.set(new THREE.Vector3(x, 50, z), new THREE.Vector3(0,-1,0));
  _raycaster.far = 100;
  const hits = _raycaster.intersectObject(root, true);
  return hits.length ? hits[0].point.y : fallback;
}
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

/* ════════════ 6b · PROCEDURAL PROPELLER (BUILD_SPEC §4) ════════════
   Generate the blade mesh from the selected NACA section — the ONLY
   generated part; no propeller GLB is ever loaded. Each blade lofts N
   spanwise stations root→tip: at each station the airfoil outline (§3A)
   is scaled by local chord (taper), twisted by local pitch (root pitch →
   tip pitch minus washout), and positioned along the radius. Consecutive
   station rings are triangulated into a solid twisted, tapered blade.   */
function buildProceduralProp(o){
  o = o || {};
  const af = o.airfoil || curAirfoil();
  const B = o.blades || state.blades;
  const D_m = o.D_m != null ? o.D_m : (state.diameter_in*0.0254);
  const rootC = o.rootChord_m != null ? o.rootChord_m : state.root_chord_mm/1000;
  const tipC  = o.tipChord_m  != null ? o.tipChord_m  : state.tip_chord_mm/1000;
  const pitchDeg = o.pitchDeg != null ? o.pitchDeg : state.pitch_angle_deg;
  const spinDir = o.spinDir != null ? o.spinDir : 1;
  const span = o.span || null;                  // if set, group fitted to this world size

  const group = new THREE.Group();
  group.userData.spinDir = spinDir;
  const R = D_m/2;
  const hubR = Math.max(rootC*0.55, 0.006);
  const bladeMat = new THREE.MeshStandardMaterial({ color:0x2b3a63, roughness:.42, metalness:.35, side:THREE.DoubleSide });
  const hubMat = new THREE.MeshStandardMaterial({ color:0x1b2436, roughness:.5, metalness:.5 });

  // hub
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(hubR, hubR*1.05, R*0.16, 20), hubMat);
  group.add(hub);

  const NSPAN = 14;                              // spanwise stations
  const outlineN = 26;                           // points per station ring
  const baseOutline = airfoilOutline(af.m, af.p, af.t, outlineN); // [x∈0..1, y]
  const P = baseOutline.length;
  const r0 = hubR*1.1;

  for(let b=0; b<B; b++){
    const yaw = b*(2*Math.PI/B);
    const cyaw = Math.cos(yaw), syaw = Math.sin(yaw);
    const positions = [];
    const rings = [];                            // rings[i] = array of vec3
    for(let i=0;i<NSPAN;i++){
      const tr = i/(NSPAN-1);                    // 0 root → 1 tip
      const radius = lerp(r0, R, tr);
      const chord = lerp(rootC, tipC, tr);
      // twist: root pitch → tip pitch − washout (pitch·0.5·r/R)
      const twist = (pitchDeg*(1 - 0.5*tr))*DEG;
      const ct = Math.cos(twist), st = Math.sin(twist);
      const ring = [];
      for(let k=0;k<P;k++){
        // section local coords: chordwise (xc about quarter-chord), thickness (yc)
        const xc = (baseOutline[k][0]-0.25)*chord;
        const yc = baseOutline[k][1]*chord;
        // twist in the chord-thickness plane → gives pitch about the blade span axis
        const chordDir = xc*ct - yc*st;          // along-rotation-plane component
        const thick   = xc*st + yc*ct;           // out-of-plane (vertical) component
        // place: radius along local blade axis, chordwise around rotation, thickness vertical
        let px = radius;                         // blade axis (local +X before yaw)
        let pz = chordDir;                       // tangential
        let py = thick;                          // vertical (lift direction)
        // yaw the blade about Y so B blades are evenly spaced
        const wx = px*cyaw - pz*syaw;
        const wz = px*syaw + pz*cyaw;
        ring.push([wx, py, wz]);
      }
      rings.push(ring);
    }
    // triangulate consecutive rings
    const verts = [];
    for(let i=0;i<NSPAN-1;i++){
      for(let k=0;k<P;k++){
        const k2 = (k+1)%P;
        const a = rings[i][k], bb = rings[i][k2], cc = rings[i+1][k], dd = rings[i+1][k2];
        verts.push(a[0],a[1],a[2], bb[0],bb[1],bb[2], cc[0],cc[1],cc[2]);
        verts.push(bb[0],bb[1],bb[2], dd[0],dd[1],dd[2], cc[0],cc[1],cc[2]);
      }
    }
    // cap the tip
    const tip = rings[NSPAN-1];
    let cx=0,cy=0,cz=0; tip.forEach(v=>{cx+=v[0];cy+=v[1];cz+=v[2];});
    cx/=P; cy/=P; cz/=P;
    for(let k=0;k<P;k++){ const k2=(k+1)%P; const a=tip[k], bb=tip[k2];
      verts.push(a[0],a[1],a[2], bb[0],bb[1],bb[2], cx,cy,cz); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    geo.computeVertexNormals();
    group.add(new THREE.Mesh(geo, bladeMat));
  }

  if(span){
    // fit the raw group (built in metres, ~diameter D_m) to the requested world span
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.z) || 1;
    const outer = new THREE.Group();
    outer.add(group);
    outer.scale.setScalar(span/maxDim);
    outer.userData.spinDir = spinDir;
    return outer;
  }
  return group;
}

/* ── Mount-driven assembly (ported) — motors seat on authored mounts; the
   propeller is PROCEDURAL, seated on the rotor bell and parented to the
   spinner so it turns. ── */
const MOUNT_CATEGORY = {
  motor: "motor", esc: "esc", flight_controller: "controller",
  receiver: "reciever", battery: "battery",
};
function levelYawQuat(deg){
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), (deg||0)*Math.PI/180);
}
function orientThinUp(g){
  const s = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
  const d = [s.x, s.y, s.z], thin = d.indexOf(Math.min(d[0], d[1], d[2]));
  if(thin === 0) g.rotation.z = Math.PI / 2;
  else if(thin === 2) g.rotation.x = -Math.PI / 2;
}
function orientCameraForward(g, tiltDeg){
  const t = (tiltDeg == null ? 18 : tiltDeg) * Math.PI / 180;
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(Math.cos(t), Math.sin(t), 0));
}
/* seat a motor + attach a PROCEDURAL prop that spins with the rotor bell */
function mountProcMotor(anchor, o, spanM, spinDir, propSpan){
  const placeholder = fitUnit(buildFallback({ kind: "motor", color: 0x5a6672, s: 1 }), spanM, null);
  anchor.add(placeholder);
  seatModel(placeholder, "base");
  Promise.all(o.files.map(loadModelFile)).then(masters => {
    let n = anchor; while(n && n !== scene) n = n.parent;
    if(n !== scene) return;
    const combo = new THREE.Group();
    const parts = masters.map(mm => mm.clone(true));
    parts.forEach(p => combo.add(p));
    const twoPart = orientMotorCombo(combo, parts);
    let rotor = parts[parts.length - 1];
    const fitted = fitUnit(combo, spanM, o, twoPart ? "none" : undefined);
    if(placeholder.parent) anchor.remove(placeholder);
    anchor.add(fitted);
    anchor.updateWorldMatrix(true, true);
    seatModel(fitted, "base");
    anchor.updateWorldMatrix(true, true);
    const spinner = new THREE.Group();
    spinner.userData.spinDir = spinDir;
    anchor.add(spinner);
    if(rotor) spinner.attach(rotor);
    propGroups.push(spinner);
    // procedural propeller seated on the rotor bell top
    const prop = buildProceduralProp({ spinDir, span: propSpan });
    spinner.add(prop);
    spinner.updateWorldMatrix(true, true);
    const bellTop = rotorBellTopY(rotor || spinner);
    const pb = new THREE.Box3().setFromObject(prop);
    const s = (prop.parent ? prop.parent.getWorldScale(new THREE.Vector3()).y : 1) || 1;
    prop.position.y += (bellTop - pb.min.y) / s - propSpan*0.02;
    prop.userData.isProcProp = true;
    procProps.push(prop);
  }).catch(err => console.warn("motor load failed", err && (err.message || err)));
}
function buildDroneFromMounts(d, ch){
  const allMounts = ch.mounts.mounts || [];
  const wb = (ch.phys && ch.phys.wheelbase_mm) || 290;
  const chMaxMm = Math.max.apply(null, ch.size || [265.7, 60.1, 212]);
  const chSpan = chMaxMm * (3.0/wb);
  const maxmm = o => (o && o.size) ? Math.max.apply(null, o.size) : 40;
  const mountPos = m => m.position || m.center || [0, 0, 0];
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
    if(up === "z") q.setFromEuler(new THREE.Euler(-Math.PI/2, 0, 0));
    else if(up === "x") q.setFromEuler(new THREE.Euler(0, 0, Math.PI/2));
    return q;
  }
  let upAxis = deriveUpAxis();
  const sel = {
    motor: opt("motor"), esc: opt("esc"), controller: opt("controller"),
    reciever: opt("reciever"), battery: opt("battery"),
  };
  const chCon = new THREE.Group();
  const inner = new THREE.Group();
  chCon.add(inner);
  chCon.visible = false;
  d.add(chCon);

  function placeMounts(q, maxDim){
    const spanFor = mm => Math.max(mm, 1) / chMaxMm * maxDim;
    const rot = raw => new THREE.Vector3(raw[0], raw[1], raw[2]).applyQuaternion(q);
    let motorCount = 0;
    const escMounts = [];
    const propMm = state.diameter_in*25.4;
    allMounts.forEach(m => {
      const catk = MOUNT_CATEGORY[m.type];
      if(m.type === "esc"){ escMounts.push(m); return; }
      if(!catk) return;
      const o = sel[catk];
      if(!o || !(o.files && o.files.length)) return;
      const anchor = new THREE.Group();
      anchor.position.copy(rot(mountPos(m)));
      anchor.quaternion.copy(levelYawQuat(m.rotation));
      inner.add(anchor);
      if(m.type === "motor"){
        const dir = (motorCount % 2) ? 1 : -1;
        mountProcMotor(anchor, o, spanFor(maxmm(o)), dir, spanFor(propMm));
        FX.setEmitter("motor"+motorCount, anchor, "motor");
        motorCount++;
      }else{
        anchor.add(modelFor(o, spanFor(maxmm(o)), g => seatModel(g, "base")));
      }
    });
    if(sel.esc && sel.esc.files && sel.esc.files.length && escMounts.length){
      const esc4in1 = /4.?in.?1/i.test((sel.esc.id||"")+" "+(sel.esc.name||"")) || (sel.esc.qty||4)<=1;
      const want = esc4in1 ? "4in1" : "single";
      let chosen = escMounts.filter(m => (m.esc_type || "single") === want);
      if(!chosen.length) chosen = escMounts;
      if(esc4in1) chosen = chosen.slice(0, 1);
      chosen.forEach(m => {
        const anchor = new THREE.Group();
        const p = rot(mountPos(m));
        anchor.position.copy(p);
        if(esc4in1) anchor.quaternion.copy(levelYawQuat(m.rotation));
        else anchor.rotation.y = -Math.atan2(p.z, p.x);
        inner.add(anchor);
        anchor.add(modelFor(sel.esc, spanFor(maxmm(sel.esc)), g => { orientThinUp(g); seatModel(g, "base"); }));
      });
    }
    selOpts("attachments").forEach(o => {
      if(!(o.files && o.files.length)) return;
      const mtype = (o.phys && o.phys.mount_type) || "payload";
      let mt = allMounts.find(m => m.type === mtype) || allMounts.find(m => m.type === "payload") || allMounts.find(m=>m.type==="camera");
      if(!mt) return;
      const span = spanFor(maxmm(o));
      const anchor = new THREE.Group();
      const p = rot(mountPos(mt));
      anchor.position.copy(p);
      inner.add(anchor);
      if(mtype === "gps"){ anchor.add(modelFor(o, span, g => { orientThinUp(g); seatModel(g, "base"); })); }
      else if(mtype === "camera"){
        const th = Math.atan2(p.z, p.x);
        anchor.rotation.y = -th;
        anchor.position.x += Math.cos(th)*span*0.6; anchor.position.z += Math.sin(th)*span*0.6;
        anchor.add(modelFor(o, span, g => orientCameraForward(g)));
      }else{ anchor.add(modelFor(o, span, g => seatModel(g, "hang"))); }
    });
  }
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
    inner.position.set(-c.x, -c.y, -c.z);
    chCon.scale.setScalar(chSpan / maxDim);
    placeMounts(q, maxDim);
    chCon.visible = true;
  }).catch(err => {
    console.warn("chassis load failed", err && (err.message || err));
    const q = upQuat(upAxis || "y");
    const maxDim = chMaxMm / 1000;
    chCon.scale.setScalar(chSpan / maxDim);
    placeMounts(q, maxDim);
    chCon.visible = true;
  });
}

/* ════════════ 7 · PREVIEW ENGINE + FX ════════════ */
let previewRenderer = null;
const previews = new Map();
function initPreviewEngine(){
  previewRenderer = new THREE.WebGLRenderer({antialias:true, alpha:true});
  previewRenderer.setSize(220,150);
  previewRenderer.setPixelRatio(1);
}
/* preview a component GLB, OR a procedural prop (o.__proc), OR an airfoil section (o.__airfoil canvas is drawn separately) */
function registerPreview(canvas, o){
  if(!canvas || !o || !previewRenderer) return;
  const scene2 = new THREE.Scene();
  scene2.add(new THREE.AmbientLight(0xffffff,.85));
  const dl = new THREE.DirectionalLight(0xffffff,.9); dl.position.set(2,3,2); scene2.add(dl);
  const d2 = new THREE.DirectionalLight(0xdce3f2,.35); d2.position.set(-2,-1,-2); scene2.add(d2);
  let group;
  if(o.__proc) group = buildProceduralProp({ span:2.6, spinDir:1 });
  else group = modelFor(o);
  scene2.add(group);
  const camera2 = new THREE.PerspectiveCamera(34, 220/150, .1, 50);
  camera2.position.set(1.9,1.35,1.9); camera2.lookAt(0,0,0);
  previews.set(canvas, {scene:scene2, camera:camera2, group});
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
/* draw a NACA section outline onto a 2D canvas (tiles / pickers / charts) */
function drawAirfoilCanvas(cv, af, opts){
  if(!cv) return;
  opts = opts || {};
  const ctx = cv.getContext("2d");
  const w = cv.width, h = cv.height;
  ctx.clearRect(0,0,w,h);
  const pts = airfoilOutline(af.m, af.p, af.t, 70);
  const pad = 10, plotW = w - pad*2;
  const yScale = plotW*0.42;
  const cx = pad, cy = h/2;
  ctx.beginPath();
  pts.forEach((p,i)=>{
    const x = cx + p[0]*plotW;
    const y = cy - p[1]*yScale;
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  ctx.closePath();
  ctx.fillStyle = opts.fill || "rgba(31,58,147,.14)";
  ctx.strokeStyle = opts.stroke || "#1f3a93";
  ctx.lineWidth = opts.lw || 1.6;
  ctx.fill(); ctx.stroke();
  // chord line
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx+plotW, cy);
  ctx.strokeStyle = "rgba(120,140,135,.5)"; ctx.lineWidth = 0.8; ctx.setLineDash([3,3]); ctx.stroke();
  ctx.setLineDash([]);
  if(opts.label){
    ctx.fillStyle = "#3c4a46"; ctx.font = "600 10px 'IBM Plex Mono', monospace";
    ctx.fillText(af.name, cx, h-6);
  }
}

/* FX particle system (smoke/separation puffs + streamline turbulence markers) */
const FX = (function(){
  let host = null, smokeTex = null, inited = false;
  const emitters = new Map();
  const puffs = [];
  const CAP_PUFF = 180;
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
    smokeTex = radialTex([[0,"rgba(150,160,170,0.85)"],[0.55,"rgba(120,130,140,0.45)"],[1,"rgba(110,120,130,0)"]]);
  }
  function mkSprite(tex){
    const m = new THREE.SpriteMaterial({ map:tex, transparent:true, depthWrite:false });
    return new THREE.Sprite(m);
  }
  function spawnPuff(x,y,z, intensity, color, vx){
    if(!inited || puffs.length >= CAP_PUFF) return;
    const s = mkSprite(smokeTex);
    s.material.color.setHex(color);
    s.position.set(x+(Math.random()-.5)*.12, y+(Math.random()-.5)*.1, z+(Math.random()-.5)*.12);
    const size0 = .14 + intensity*.2;
    s.scale.setScalar(size0); host.add(s);
    puffs.push({ s, age:0, life:0.8 + Math.random()*.7,
      size0, size1: size0 + .4 + intensity*.7,
      vx:(vx||0)+(Math.random()-.5)*.3, vy:.1 + Math.random()*.2, vz:(Math.random()-.5)*.3,
      op:.5 + intensity*.4 });
  }
  function setEmitter(id, obj, kind){ emitters.set(id, { obj, kind, intensity:0, acc:0 }); }
  function kindIntensity(kind, v){ emitters.forEach(e => { if(e.kind===kind) e.intensity = v; }); }
  function burstAt(x,y,z,n,intensity,color,vx){ for(let k=0;k<n;k++) spawnPuff(x,y,z,intensity,color,vx); }
  function clear(){
    puffs.forEach(p => { if(host) host.remove(p.s); p.s.material.dispose(); });
    puffs.length = 0; emitters.clear();
  }
  function tick(dt){
    if(!inited) return;
    emitters.forEach(e => {
      if(e.intensity > .03 && e.obj){
        e.acc += e.intensity*e.intensity*30*dt;
        while(e.acc >= 1){
          e.acc -= 1; e.obj.getWorldPosition(_v);
          spawnPuff(_v.x,_v.y,_v.z, e.intensity, e.kind==="wash"?0xb8c4d8:0x9aa6b2, e.kind==="wash"?0:1.2);
        }
      }
    });
    for(let i=puffs.length-1;i>=0;i--){
      const p = puffs[i]; p.age += dt; const k = p.age/p.life;
      if(k >= 1){ host.remove(p.s); p.s.material.dispose(); puffs.splice(i,1); continue; }
      p.s.position.x += p.vx*dt; p.s.position.y += p.vy*dt; p.s.position.z += p.vz*dt;
      p.s.scale.setScalar(p.size0 + (p.size1-p.size0)*k);
      p.s.material.opacity = p.op * (1-k) * (k<.12 ? k/.12 : 1);
    }
  }
  return { init, setEmitter, kindIntensity, burstAt, clear, tick };
})();

/* ════════════ 8 · MAIN VIEWPORT / SCENES ════════════ */
let renderer, scene, camera, controls, rig, propGroups = [], procProps = [];
let hoverPhase = 0;
let airfoilScene = null, streamlines = [], clArrow = null, airfoilMesh = null;
let dragArrow = null, flowArrows = [];
function sceneModeType(){ return currentExp().exp.type || "airfoil"; }   // airfoil | wind
function isAirfoilScene(){ return sceneModeType() === "airfoil"; }

function initViewport(){
  const host = $("viewport");
  const w = host.clientWidth || 600, h = host.clientHeight || 400;
  renderer = new THREE.WebGLRenderer({antialias:true, alpha:true});
  renderer.setSize(w,h);
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  host.appendChild(renderer.domElement);
  scene = new THREE.Scene();
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
  if(airfoilScene){ scene.remove(airfoilScene); airfoilScene = null; }
  propGroups = []; procProps = [];
  streamlines = []; flowArrows = [];
  clArrow = null; dragArrow = null; airfoilMesh = null;
  FX.clear();
}
function buildScene(){
  clearRig();
  if(isAirfoilScene()) buildAirfoilScene(); else buildWindScene();
  syncCamera();
}
function syncCamera(){
  if(!controls) return;
  if(isAirfoilScene()){ controls.target.set(0,1.1,0); }
  else{ controls.target.set(0,1.2,0); }
}

/* ── M1 · wind-tunnel airfoil scene ── */
function buildAirfoilScene(){
  const g = new THREE.Group();
  g.position.y = 1.1;
  const af = curAirfoil();
  // tunnel box
  const boxGeo = new THREE.BoxGeometry(6, 3.2, 3.2);
  const boxMat = new THREE.MeshStandardMaterial({ color:0x9fb4c8, transparent:true, opacity:0.06, side:THREE.BackSide });
  g.add(new THREE.Mesh(boxGeo, boxMat));
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(boxGeo),
    new THREE.LineBasicMaterial({ color:0xb8c8d4, transparent:true, opacity:0.5 }));
  g.add(edges);
  // airfoil wing segment (extrude the NACA section along span)
  const pts = airfoilOutline(af.m, af.p, af.t, 80);
  const shape = new THREE.Shape();
  pts.forEach((p,i)=>{ const x=(p[0]-0.5)*2.6, y=p[1]*2.6; if(i===0) shape.moveTo(x,y); else shape.lineTo(x,y); });
  shape.closePath();
  const wingGeo = new THREE.ExtrudeGeometry(shape, { depth:2.2, bevelEnabled:false });
  wingGeo.center();
  const wingMat = new THREE.MeshStandardMaterial({ color:0x2b3a63, roughness:.4, metalness:.35, side:THREE.DoubleSide });
  const wing = new THREE.Mesh(wingGeo, wingMat);
  wing.rotation.x = Math.PI/2;                 // span along Z
  const wingPivot = new THREE.Group();
  wingPivot.add(wing);
  g.add(wingPivot);
  airfoilMesh = wingPivot;
  // freestream streamlines L→R
  const streamMat = new THREE.LineBasicMaterial({ color:0x4f6d9e, transparent:true, opacity:0.55 });
  for(let r=0;r<7;r++){
    const y0 = -1.3 + r*0.43;
    const geo = new THREE.BufferGeometry();
    const arr = [];
    for(let x=-3;x<=3;x+=0.25) arr.push(x, y0, 0);
    geo.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
    const line = new THREE.Line(geo, streamMat.clone());
    line.userData.y0 = y0; line.userData.phase = r*0.5;
    g.add(line); streamlines.push(line);
  }
  // Cl vector arrow (perpendicular to flow, up)
  clArrow = new THREE.ArrowHelper(new THREE.Vector3(0,1,0), new THREE.Vector3(0,0,0), 1.0, 0x1f8a5b, 0.28, 0.16);
  g.add(clArrow);
  updateAirfoilScene();
  rig = g; scene.add(g);
}
function updateAirfoilScene(){
  if(!airfoilMesh) return;
  const aoa = state.aoa_deg;
  airfoilMesh.rotation.z = -aoa*DEG;            // tilt section by AoA (nose-up = +)
  const model = airfoilModel(curAirfoil(), m1SectionRe());
  const cl = model.clDeg(aoa);
  if(clArrow){
    const len = clamp(0.3 + Math.abs(cl)*0.9, 0.1, 2.4);
    clArrow.setLength(len, 0.24, 0.14);
    clArrow.setDirection(new THREE.Vector3(0, cl>=0?1:-1, 0));
    clArrow.setColor(aoa > model.aStallDeg ? 0xc65d3b : 0x1f8a5b);
  }
}

/* ── M2 · wind scene: assembled drone in flow with drag vector + wash ── */
function buildWindScene(){
  const d = new THREE.Group();
  propGroups = []; procProps = [];
  d.position.y = 1.15;
  d.rotation.x = 0.14;                           // pitched slightly forward
  const ch = opt("chasis");
  if(ch && ch.mounts && ch.mounts.mounts && ch.files && ch.files.length){
    buildDroneFromMounts(d, ch);
  }else{
    // fallback simple frame + 4 procedural props
    const fb = modelFor(ch, 2.4); d.add(fb);
    for(let i=0;i<4;i++){ const a=Math.PI/4+i*Math.PI/2;
      const p = buildProceduralProp({ span:1.1, spinDir:i%2?1:-1 });
      p.position.set(Math.cos(a)*1.2, .3, Math.sin(a)*1.2); d.add(p); propGroups.push(p); procProps.push(p);
    }
  }
  // freestream arrows (flow L→R along +X)
  for(let r=0;r<5;r++){
    const y0 = 0.4 + r*0.5, z0 = -1 + (r%2)*0.5;
    const arr = new THREE.ArrowHelper(new THREE.Vector3(1,0,0), new THREE.Vector3(-3, y0-1.15, z0), 1.4, 0x4f6d9e, 0.3, 0.16);
    d.add(arr); flowArrows.push(arr);
  }
  // drag vector (downstream, +X) — length ∝ F_D
  dragArrow = new THREE.ArrowHelper(new THREE.Vector3(1,0,0), new THREE.Vector3(0,0,0), 1.0, 0xc65d3b, 0.32, 0.2);
  d.add(dragArrow);
  updateWindScene();
  rig = d; scene.add(d);
}
function updateWindScene(){
  if(!dragArrow) return;
  const d = dragForce(state.wind_v);
  const len = clamp(0.3 + d.F*6, 0.2, 3.2);
  dragArrow.setLength(len, 0.3, 0.18);
  dragArrow.setColor(state.washOn ? 0x9a4426 : 0xc65d3b);
}
