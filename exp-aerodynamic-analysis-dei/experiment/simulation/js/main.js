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
    airfoils,
    defaults: manifest.defaults || {},
    modules: manifest.modules,
    instructor: manifest.instructor,
        reward: { category: rwCfg.category || null, name: rwCfg.name || "", desc: rwCfg.desc || "",
              fallback: { kind: rwCfg.fallback || "prop", color: 0x845b23, s: 1 }, pool: rewardPool }
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
  // a_stall_ref is the ABSOLUTE stall AoA (NACA TR-824 wind-tunnel convention),
  // Reynolds-scaled — not measured from the zero-lift line.
  const aStallDeg = af.a_stall_ref*(1 + 0.04*Math.log10(Re/af.re_ref));
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
  // Cq/Ct baseline set so a well-designed blade (high pitch, high section L/D) peaks
  // at a realistic propulsive efficiency (~0.6–0.8), matching momentum-theory / UIUC
  // propeller data; induced term ∝√Ct, profile term ∝ Cd/Cl.
  const Cq0 = Ct0*(0.014 + 0.045*pd + 0.85*Cd_design/Math.max(Cl_design,0.3));
  const J0 = pd*0.92;                             // zero-thrust advance ratio (geometric)
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

  // low-Re thin-airfoil breakdown — an educational reality-check (BUILD_SPEC §3.6),
  // never a hard block. M1 runs at wind-tunnel section Reynolds (~10⁶); the spinning-
  // blade Reynolds only qualifies the M2 propeller model.
  const reM1 = m1SectionRe();
  if(metric === "cl"){
    if(reM1 < 1e5){
      items.push({ sev:"warn", tag:"low-re",
        msg:"Low section Reynolds — Re "+Math.round(reM1).toLocaleString()+" < 1×10⁵; thin-airfoil theory and Cl_max are approximate at this scale.",
        fix:"Increase airspeed or chord to raise the wind-tunnel section Reynolds number." });
    }
  } else if(Re < 1e5){
    items.push({ sev:"warn", tag:"low-re",
      msg:"Low blade Reynolds — Re "+Math.round(Re).toLocaleString()+" < 1×10⁵; the BEMT thrust / efficiency scaling is approximate at model scale.",
      fix:"Raise RPM, increase chord (root/tip), or use a larger diameter to lift the blade Reynolds number." });
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
    items.push({ sev:"err", block: metric==="m2",
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
  if(metric === "m2" && Jnow > pc.J0){
    items.push({ sev:"warn",
      msg:"Advance ratio J = "+Jnow.toFixed(2)+" exceeds the zero-thrust J₀ = "+pc.J0.toFixed(2)+" — the propeller is windmilling (negative thrust).",
      fix:"Lower the airspeed or raise RPM to bring J below J₀." });
  }
  // rotor-wash advisory (M2)
  if(metric === "m2" && state.washOn){
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
  const span = o.span || null;

  const group = new THREE.Group();
  group.userData.spinDir = spinDir;
  const R = D_m/2;
  const hubR = Math.max(rootC*0.5, 0.006);
  // smooth, slightly glossy composite look
  const bladeMat = new THREE.MeshStandardMaterial({ color:0x20293b, roughness:.32, metalness:.28, side:THREE.FrontSide, flatShading:false });
  const hubMat   = new THREE.MeshStandardMaterial({ color:0x141a26, roughness:.4, metalness:.55 });

  // ── hub: barrel + rounded nose cone (spinner) ──
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(hubR, hubR*1.08, R*0.14, 28), hubMat);
  group.add(hub);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(hubR*0.92, 24, 16, 0, Math.PI*2, 0, Math.PI/2), hubMat);
  nose.position.y = R*0.07; group.add(nose);

  const NSPAN = 30;                              // spanwise stations (smooth loft)
  const outlineN = 48;                           // points per section ring (smooth section)
  const baseOutline = airfoilOutline(af.m, af.p, af.t, outlineN); // closed [x∈0..1, y]
  const P = baseOutline.length;
  const r0 = hubR*1.05;

  // realistic planform multiplier: narrow shank → wide inner → taper → rounded swept tip
  function planform(tr){
    let pf = 0.42 + 0.58*smoothstep(0.0, 0.16, tr);   // widen out of the shank
    pf *= (1 - 0.42*tr);                              // gentle taper to tip
    if(tr > 0.9){ const u = (tr-0.9)/0.1; pf *= Math.sqrt(Math.max(0, 1-u*u)); } // round the tip off
    return pf;
  }
  const sweep = R*0.10;                            // tangential tip sweep-back

  for(let b=0; b<B; b++){
    const yaw = b*(2*Math.PI/B);
    const cyaw = Math.cos(yaw), syaw = Math.sin(yaw);
    const rings = [];
    for(let i=0;i<NSPAN;i++){
      const tr = i/(NSPAN-1);                     // 0 root → 1 tip
      const radius = lerp(r0, R, tr);
      const chord = lerp(rootC, tipC, tr) * planform(tr);
      const twist = (pitchDeg*(1 - 0.55*tr))*DEG;       // washout root→tip
      const ct = Math.cos(twist), st = Math.sin(twist);
      const swp = sweep*smoothstep(0.35, 1.0, tr);      // sweep grows toward the tip
      const ring = [];
      for(let k=0;k<P;k++){
        const xc = (baseOutline[k][0]-0.28)*chord;      // about ~0.28c pitch axis
        const yc = baseOutline[k][1]*chord;
        const chordDir = xc*ct - yc*st + swp;           // in rotation plane (+ sweep)
        const thick    = xc*st + yc*ct;                 // out of plane (lift dir)
        const wx = radius*cyaw - chordDir*syaw;
        const wz = radius*syaw + chordDir*cyaw;
        ring.push([wx, thick, wz]);
      }
      rings.push(ring);
    }
    // ── indexed loft (shared verts → smooth vertex normals) ──
    const positions = [];
    for(let i=0;i<NSPAN;i++) for(let k=0;k<P;k++){ const v=rings[i][k]; positions.push(v[0],v[1],v[2]); }
    const idx = [];
    for(let i=0;i<NSPAN-1;i++){
      for(let k=0;k<P;k++){
        const k2=(k+1)%P;
        const a=i*P+k, bb=i*P+k2, cc=(i+1)*P+k, dd=(i+1)*P+k2;
        idx.push(a,bb,cc, bb,dd,cc);
      }
    }
    // root + tip centre caps
    function cap(ringStart, flip){
      let cx=0,cy=0,cz=0;
      for(let k=0;k<P;k++){ cx+=positions[(ringStart+k)*3]; cy+=positions[(ringStart+k)*3+1]; cz+=positions[(ringStart+k)*3+2]; }
      const ci = positions.length/3; positions.push(cx/P, cy/P, cz/P);
      for(let k=0;k<P;k++){ const k2=(k+1)%P; if(flip) idx.push(ci, ringStart+k2, ringStart+k); else idx.push(ci, ringStart+k, ringStart+k2); }
    }
    cap(0, true); cap((NSPAN-1)*P, false);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(idx);
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
/* preview a component GLB, OR a procedural prop (o.__proc), OR an airfoil section (o.__airfoil canvas is drawn separately) */
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
let airfoilScene = null, streamlines = [], clArrow = null, airfoilMesh = null, flowParticles = null;
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
  streamlines = []; flowArrows = []; flowParticles = null;
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
  // shape is chord-X / thickness-Y, extruded along +Z (span) — no rotation: profile stays in the XY view plane
  const wingPivot = new THREE.Group();
  wingPivot.add(wing);
  g.add(wingPivot);
  airfoilMesh = wingPivot;

  // freestream streamlines (steady, deflected around the section) — 9 lanes across the tunnel
  const streamMat = new THREE.LineBasicMaterial({ color:0x6f93c4, transparent:true, opacity:0.5 });
  const LANES = 9;
  for(let r=0;r<LANES;r++){
    const y0 = -1.35 + r*(2.7/(LANES-1));
    const geo = new THREE.BufferGeometry();
    const arr = [];
    for(let x=-3;x<=3.0001;x+=0.12) arr.push(x, y0, 0);
    geo.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
    const line = new THREE.Line(geo, streamMat.clone());
    line.userData.y0 = y0;
    g.add(line); streamlines.push(line);
  }

  // velocity-field flow particles (the visible AIRFLOW + turbulence) — dense, colour-coded
  buildFlowField(g, "airfoil", 900);

  // Cl vector arrow (perpendicular to flow, up)
  clArrow = new THREE.ArrowHelper(new THREE.Vector3(0,1,0), new THREE.Vector3(0,0,0), 1.0, 0x1f8a5b, 0.28, 0.16);
  g.add(clArrow);
  updateAirfoilScene();
  rig = g; scene.add(g);
}
/* deflected streamline height at chordwise x for a lane baseline y0 — flow splits
   at the leading edge and passes AROUND the tilted section (never through it):
   upwash ahead, accelerated bulge over/under the surface, net downwash in the wake,
   turbulent separation past stall. Chord spans roughly x∈[-1.3,1.3]. */
function airfoilFlowY(x, y0, aoaRad, clN, stalled, t){
  const bell   = Math.exp(-(x*x)/0.5);                 // section influence envelope
  const chordY = -x*Math.sin(aoaRad)*0.85;             // tilted mean-camber line height at x
  const rel    = y0 - chordY;                          // signed distance from the surface line
  const side   = rel >= 0 ? 1 : -1;
  // circulation turning ∝ lift: raise ahead, lower behind, plus a lasting wake downwash
  const turn = clN*0.55*bell*(x < 0 ? 0.7 : -1.0) - (x > 0 ? clN*0.40*ramp(0,1.3,x) : 0);
  // thickness/camber bulge: push the lane away from the surface, strongest for near lanes
  const bulge = side*(0.14 + 0.46/(1 + 6*rel*rel))*bell*(0.6 + 0.5*Math.abs(clN));
  let y = y0 + turn + bulge;
  // hard clearance — keep every lane outside the section silhouette
  const minGap = (0.15 + 0.10*Math.abs(clN))*bell;
  y = side > 0 ? Math.max(y, chordY + minGap) : Math.min(y, chordY - minGap);
  if(stalled && x > 0.05) y += Math.sin(x*5 + t*6 + y0*3)*0.15*ramp(0,0.7,x); // separated wake churn
  return y;
}

/* ── velocity-field flow particle system (both modules) ─────────────────────
   Each particle is advected by a local air-velocity field: freestream + the
   body's disturbance (upwash/downwash + blockage for the airfoil; wake deficit
   + vortex shedding for the drone) + genuine turbulent fluctuations once flow
   separates. Particle colour tracks turbulence intensity (blue→amber). */
const _flowTmp = { ux:0, uy:0, uz:0, turb:0 };
function flowVelocity(kind, x, y, z, t, ctx){
  let ux = ctx.U, uy = 0, uz = 0, turb = 0;
  if(kind === "airfoil"){
    const chordY = -x*Math.sin(ctx.aoaRad)*0.85;
    const rel = y - chordY;
    const bell = Math.exp(-(x*x)/0.6);
    // circulation: upwash ahead, downwash behind (∝ lift)
    uy += ctx.clN*0.95*bell*(x < 0 ? 0.55 : -0.9);
    // thickness blockage: accelerate over the surface + steer the lane around it
    ux += bell*0.55*Math.exp(-rel*rel*4);
    uy += (rel>=0?1:-1)*bell*0.6*Math.exp(-rel*rel*3);
    // persistent wake downwash behind the section
    if(x > 0) uy -= ctx.clN*0.35*ramp(0,1.4,x);
    // separated turbulent wake once past stall — chaotic recirculation
    if(ctx.stalled){
      const sev = clamp((ctx.aoaDeg - ctx.aStall)/9, 0, 1);
      const inWake = x > -0.15 && Math.abs(rel) < 0.55 + 0.25*ramp(0,2,x);
      if(inWake){
        const a = 1.6*sev;
        ux += (Math.sin(y*7 + t*7) + Math.sin(x*5 - t*5.5 + z*2))*0.45*a;
        uy += (Math.sin(x*8 + t*6.5 + z*3) + Math.cos(y*6 - t*8))*0.7*a;
        uz += (Math.sin(x*6 + y*5 + t*6))*0.5*a;
        ux *= (1 - 0.55*sev);                      // momentum deficit in the wake
        turb = 0.4 + 0.6*sev;
      }
    }
  } else { // drone wake
    const band = Math.exp(-((y*y + z*z))/2.6);      // broad downstream wake column
    const near = Math.exp(-((x*x + y*y + z*z))/2.2); // disturbed air right around the frame
    const sev = ctx.sev;
    if(x > -0.6){
      const w = band*ramp(-0.3,0.7,x);
      ux -= (0.55 + 0.6*w)*sev*w;                    // momentum deficit grows downstream
      // multi-scale vortex shedding (two frequencies) → richer turbulence
      uy += (Math.sin(z*5 + t*7 + x*3) + 0.6*Math.sin(z*11 - t*12 + y*4))*0.8*sev*w;
      uz += (Math.cos(y*5 - t*6.5 + x*3) + 0.6*Math.cos(y*10 + t*11 - z*4))*0.8*sev*w;
      turb = clamp(w*sev*1.4, 0, 1);
    }
    // blockage: air shoulders around the frame just upstream/around it
    uy += (y>=0?1:-1)*near*0.4*sev;
    uz += (z>=0?1:-1)*near*0.3*sev;
    if(ctx.washOn){ uy -= 0.7*band*ramp(0,0.4,x); turb = Math.min(1, turb+0.25*band); } // rotor downwash
  }
  _flowTmp.ux=ux; _flowTmp.uy=uy; _flowTmp.uz=uz; _flowTmp.turb=turb;
  return _flowTmp;
}
function buildFlowField(host, kind, N){
  const pos = new Float32Array(N*3), col = new Float32Array(N*3), meta = [];
  for(let i=0;i<N;i++){
    const x = -3 + Math.random()*6.2;
    const y = kind==="airfoil" ? (-1.5 + Math.random()*3.0) : (-1.4 + Math.random()*2.8);
    const z = (Math.random()-0.5)*(kind==="airfoil"?1.9:2.4);
    meta.push({ x, y, z, jitter: 0.6+Math.random()*0.8 });
    pos[i*3]=x; pos[i*3+1]=y; pos[i*3+2]=z;
    col[i*3]=0.18; col[i*3+1]=0.43; col[i*3+2]=0.7;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos,3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col,3));
  const mat = new THREE.PointsMaterial({ size: kind==="airfoil"?0.082:0.075, vertexColors:true, transparent:true, opacity:0.94, depthWrite:false });
  flowParticles = new THREE.Points(geo, mat);
  flowParticles.userData = { meta, kind };
  host.add(flowParticles);
  return flowParticles;
}
const _cLam = [0.18,0.43,0.72], _cTurb = [0.85,0.42,0.20];
function updateFlowField(dt){
  if(!flowParticles) return;
  const kind = flowParticles.userData.kind;
  const meta = flowParticles.userData.meta;
  const pos = flowParticles.geometry.attributes.position;
  const col = flowParticles.geometry.attributes.color;
  const t = hoverPhase;
  // per-scene context
  let ctx;
  if(kind === "airfoil"){
    const model = airfoilModel(curAirfoil(), m1SectionRe());
    ctx = { U:1.8, aoaRad:state.aoa_deg*DEG, aoaDeg:state.aoa_deg,
            clN:clamp(model.clDeg(state.aoa_deg)/1.2,-1.6,1.6),
            stalled:state.aoa_deg>model.aStallDeg, aStall:model.aStallDeg };
  } else {
    const d = dragForce(state.wind_v);
    ctx = { U:1.5 + state.wind_v*0.05, sev:clamp(0.4 + d.F*3.5, 0.4, 1)*(0.7+0.3*(state.wind_v/20)), washOn:state.washOn };
  }
  const xMin=-3.1, xMax=3.1;
  for(let i=0;i<meta.length;i++){
    const m = meta[i];
    const v = flowVelocity(kind, m.x, m.y, m.z, t, ctx);
    const sp = dt*1.0;
    m.x += v.ux*sp; m.y += v.uy*sp*m.jitter; m.z += v.uz*sp*m.jitter;
    if(m.x > xMax){ m.x = xMin; m.y = (kind==="airfoil"?-1.5:-1.4) + Math.random()*(kind==="airfoil"?3.0:2.8); m.z=(Math.random()-0.5)*(kind==="airfoil"?1.9:2.4); }
    // clamp airfoil lanes outside the section silhouette (no particle inside the wing)
    if(kind==="airfoil"){
      const chordY = -m.x*Math.sin(ctx.aoaRad)*0.85, rel=m.y-chordY;
      const gap = 0.13*Math.exp(-(m.x*m.x)/0.5);
      if(Math.abs(m.x)<1.25 && Math.abs(rel)<gap) m.y = chordY + (rel>=0?gap:-gap);
    }
    pos.setXYZ(i, m.x, m.y, m.z);
    const f = clamp(v.turb,0,1);
    col.setXYZ(i, lerp(_cLam[0],_cTurb[0],f), lerp(_cLam[1],_cTurb[1],f), lerp(_cLam[2],_cTurb[2],f));
  }
  pos.needsUpdate = true; col.needsUpdate = true;
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

/* ── M2 · wind scene: assembled drone in flow with drag vector + wash ──
   IMPORTANT: the flow field + arrows live on the (unrotated) scene group `d`
   so the freestream always runs world +X. ONLY the drone MODEL is yawed
   (inside droneWrap) so its front meets the oncoming air — otherwise rotating
   the whole group would spin the wind along with the drone. */
const DRONE_FRONT_YAW = 0;                        // model yaw so the frame's nose (narrow frontal) faces upwind (−X)
function buildWindScene(){
  const d = new THREE.Group();
  propGroups = []; procProps = [];
  d.position.y = 1.15;
  d.rotation.set(0, 0, 0);
  const droneWrap = new THREE.Group();
  droneWrap.rotation.y = DRONE_FRONT_YAW;
  d.add(droneWrap);
  const ch = opt("chasis");
  if(ch && ch.mounts && ch.mounts.mounts && ch.files && ch.files.length){
    buildDroneFromMounts(droneWrap, ch);
  }else{
    // fallback simple frame + 4 procedural props
    const fb = modelFor(ch, 2.4); droneWrap.add(fb);
    for(let i=0;i<4;i++){ const a=Math.PI/4+i*Math.PI/2;
      const p = buildProceduralProp({ span:1.1, spinDir:i%2?1:-1 });
      p.position.set(Math.cos(a)*1.2, .3, Math.sin(a)*1.2); droneWrap.add(p); propGroups.push(p); procProps.push(p);
    }
  }
  // freestream arrows (flow L→R along world +X) — on `d`, independent of drone yaw
  for(let r=0;r<5;r++){
    const y0 = 0.4 + r*0.5, z0 = -1 + (r%2)*0.5;
    const arr = new THREE.ArrowHelper(new THREE.Vector3(1,0,0), new THREE.Vector3(-3, y0-1.15, z0), 1.4, 0x4f6d9e, 0.3, 0.16);
    d.add(arr); flowArrows.push(arr);
  }
  // drag vector (downstream, +X) — length ∝ F_D
  dragArrow = new THREE.ArrowHelper(new THREE.Vector3(1,0,0), new THREE.Vector3(0,0,0), 1.0, 0xc65d3b, 0.32, 0.2);
  d.add(dragArrow);
  // velocity-field flow particles + turbulent wake behind the frame
  buildFlowField(d, "wind", 820);
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

/* ════════════ 9 · LEFT PANEL + UI RENDERING ════════════ */
const REF_AIRFOILS = ["naca0012","naca2412","naca4412"];
const ramp = (x,a,b)=>clamp((x-a)/((b-a)||1e-9),0,1);

/* — component tiles (the DRONE is assembled from these GLB assets) — */
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
  const grid = $("paramGrid"); if(!grid) return;
  grid.innerHTML = "";
  DRONE_DB.categories.forEach(c=>{
    const info = tileInfo(c.key);
    const b = el("button","tile"); b.type = "button";
    b.innerHTML =
      '<div class="tile-top"><span class="tile-label">'+txt(c.label)+'</span>'+
      '<span class="tile-mass">'+fmtMass(info.mass)+'</span></div>'+
      '<div class="tile-view"><canvas width="150" height="100"></canvas></div>'+
      '<span class="tile-sel">'+txt(info.name)+'</span>';
    b.addEventListener("click", ()=>openComponentPicker(c.key));
    grid.appendChild(b);
    const cv = b.querySelector("canvas");
    tileCanvases[c.key] = cv;
    registerPreview(cv, info.preview);
  });
  const cc = $("cfgCode"); if(cc) cc.textContent = configCode();
  renderAirfoilCard();
  renderBladeCount();
}
/* the airfoil is DESIGNED, not a catalog part — its own card + 2D section preview */
function renderAirfoilCard(){
  const af = curAirfoil();
  const nm = $("airfoilName"); if(nm) nm.textContent = af.name;
  const cv = $("airfoilCanvas"); if(cv) drawAirfoilCanvas(cv, af, { label:false });
}
function renderBladeCount(){
  const bc = $("bladeCount"); if(!bc) return;
  [].forEach.call(bc.querySelectorAll("button"), b=>{
    b.classList.toggle("active", +b.dataset.b === state.blades);
  });
}

/* — aero summary mini (left card) — */
function renderAeroMini(){
  const box = $("aeroMini"); if(!box) return;
  const c = aeroCalc();
  const rows = [
    ["Cl max", c.clMax.toFixed(2)],
    ["Stall α", c.aStallDeg.toFixed(1)+"°"],
    ["F_D @ 10 m/s", c.Fd10.toFixed(2)+" N"],
    ["Peak η", c.etaPeak.toFixed(0)+" %"],
    ["Advance J₀", c.J0.toFixed(2)]
  ];
  box.innerHTML = "";
  rows.forEach(r=>{
    const d = el("div","mass-row");
    d.innerHTML = '<span class="lbl">'+txt(r[0])+'</span><span class="val mono">'+txt(r[1])+'</span>';
    box.appendChild(d);
  });
}

/* — module + experiment tabs (independent, no cross-experiment gating) — */
function renderModuleTabs(){
  const box = $("moduleTabs"); if(!box) return;
  box.innerHTML = "";
  DRONE_DB.modules.forEach(m=>{
    const b = el("button", m.id===state.module ? "active" : ""); b.type = "button";
    b.innerHTML = txt(m.label)+' <small>· '+txt(m.sub)+'</small>';
    b.addEventListener("click", ()=>{
      if(simActive) stopSim(false);
      state.module = m.id; saveState();
      renderModuleTabs(); renderExpTabs(); buildScene(); drawLiveGraph(); refreshIdleTelemetry(); renderCalcChips(); renderLog();
      instrJump();
    });
    box.appendChild(b);
  });
}
function renderExpTabs(){
  const box = $("expTabs"); if(!box) return;
  box.innerHTML = "";
  const m = DRONE_DB.modules.find(m=>m.id===state.module);
  m.experiments.forEach(e=>{
    const key = m.id+":"+e.id;
    const b = el("button", e.id===state.exp[m.id] ? "active" : ""); b.type = "button";
    b.innerHTML = (state.done[key] ? '<span class="done">✓</span>' : "") + txt(e.name);
    b.addEventListener("click", ()=>{
      if(simActive) stopSim(false);
      state.exp[m.id] = e.id; saveState();
      renderExpTabs(); buildScene(); drawLiveGraph(); refreshIdleTelemetry(); renderCalcChips(); renderLog();
      instrJump();
    });
    box.appendChild(b);
  });
}
function renderProgress(){
  const total = allExperiments().length, n = doneCount();
  const f = $("progressFill"), t = $("progressTxt");
  if(f) f.style.width = (total ? n/total*100 : 0)+"%";
  if(t) t.textContent = n+" / "+total;
}

/* — calculation chips (center) — */
function renderCalcChips(){
  const c = aeroCalc();
  const chips = [
    { k:"Cl @ α="+state.aoa_deg.toFixed(0)+"°", v:c.clNow.toFixed(2), cls: state.aoa_deg>c.aStallDeg?"warn":"good" },
    { k:"L / D", v:c.ldNow.toFixed(1), cls:c.ldNow>=20?"good":c.ldNow>=8?"":"warn" },
    { k:"F_D @ 10 m/s", v:c.Fd10.toFixed(2)+" N", cls:"" },
    { k:"Peak η", v:c.etaPeak.toFixed(0)+" %", cls:c.etaPeak>=70?"good":c.etaPeak>=50?"":"warn" },
    { k:"Air density ρ", v:c.rho.toFixed(3)+" kg/m³", cls:"" }
  ];
  const box = $("calcChips"); if(!box) return;
  box.innerHTML = "";
  chips.forEach(ch=>{
    const d = el("div","calc-chip");
    d.innerHTML = '<span class="k">'+ch.k+'</span><span class="v '+ch.cls+'">'+ch.v+'</span>';
    box.appendChild(d);
  });
}

/* — diagnostics log — */
function renderLog(){
  const dg = diagnostics();
  const list = $("logList"); if(!list) return dg;
  list.innerHTML = "";
  const icon = s => s==="ok" ? "✓" : s==="warn" ? "!" : "×";
  dg.items.forEach(it=>{
    const d = el("div","log-item "+it.sev);
    d.innerHTML = '<span class="ic">'+icon(it.sev)+'</span>'+
      '<div class="body"><span class="msg">'+txt(it.msg)+'</span>'+
      (it.fix ? '<span class="fix">Fix: '+txt(it.fix)+'</span>' : '')+'</div>';
    list.appendChild(d);
  });
  const badge = $("logBadge"), sum = $("logSummary");
  if(badge && sum){
    if(dg.errors){ badge.className="log-badge err"; badge.textContent = dg.errors+" error"+(dg.errors>1?"s":"");
      sum.textContent = "· "+dg.errors+" error"+(dg.errors>1?"s":"")+(dg.warns?", "+dg.warns+" warning"+(dg.warns>1?"s":""):""); }
    else if(dg.warns){ badge.className="log-badge warn"; badge.textContent = dg.warns+" warning"+(dg.warns>1?"s":"");
      sum.textContent = "· "+dg.warns+" warning"+(dg.warns>1?"s":""); }
    else { badge.className="log-badge ok"; badge.textContent = "OK"; sum.textContent = "· model within limits"; }
  }
  const rb = $("runBtn");
  if(rb){ if(dg.blocked && !simActive) rb.classList.add("blocked"); else rb.classList.remove("blocked"); }
  return dg;
}
/* push the AoA / airspeed state back onto their sliders + labels (after a sweep restores them) */
function syncOperatingSliders(){
  const a=$("aoaSlider"), av=$("aoaVal");
  if(a){ a.value = state.aoa_deg; if(av) av.textContent = state.aoa_deg.toFixed(1)+"°"; }
  const w=$("windSlider"), wv=$("windVal");
  if(w){ w.value = state.wind_v; if(wv) wv.textContent = state.wind_v.toFixed(1)+" m/s"; }
}

/* — reward (procedural blade profile) — */
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

/* — live telemetry (6 rows, per-metric labels) — */
const TEL_LABELS = {
  cl: ["α","Cl","Cd","L/D","Re","Tip M"],
  m2: ["V","F_D","J","η","T","Re"]
};
function setTelLabels(metric){
  const labs = TEL_LABELS[metric] || TEL_LABELS.cl;
  for(let i=0;i<6;i++){ const e = $("telL"+i); if(e) e.textContent = labs[i]; }
}
function setTelValues(vals){
  for(let i=0;i<6;i++){ const e = $("telV"+i); if(e) e.textContent = vals[i]; }
}
function updateTelemetry(metric, vals, phase, cls){
  setTelLabels(metric);
  setTelValues(vals);
  const ph = $("telPhase");
  if(ph){ ph.textContent = phase || "STANDBY"; ph.className = "tel-phase mono"+(cls?" "+cls:""); }
}
/* idle telemetry from current sliders (no run active) */
function refreshIdleTelemetry(){
  const metric = currentExp().exp.metric;
  if(metric === "cl"){
    const model = airfoilModel(curAirfoil(), m1SectionRe());
    const a = state.aoa_deg;
    updateTelemetry("cl", [
      a.toFixed(1)+"°", model.clDeg(a).toFixed(2), model.cdDeg(a).toFixed(3),
      model.ldDeg(a).toFixed(1), Math.round(m1SectionRe()).toLocaleString(), tipMach().toFixed(2)
    ], "STANDBY");
  }else{
    const pc = propCoeffs(), n = state.rpm/60, D = pc.g.D;
    const V = state.wind_v, d = dragForce(V);
    const J = (n*D>1e-6)?V/(n*D):0, r = propAtJ(pc, J);
    updateTelemetry("m2", [
      V.toFixed(1), d.F.toFixed(2), J.toFixed(2), (r.eta*100).toFixed(0)+"%",
      r.T.toFixed(2)+" N", Math.round(d.Re_body).toLocaleString()
    ], "STANDBY");
  }
}
function refreshAfterSelection(key){
  calcCache = null;
  renderTiles(); renderAeroMini(); renderCalcChips(); renderLog();
  clearLastRun(); drawSummaryChart(); drawLiveGraph();
  buildScene(); refreshIdleTelemetry(); saveState();
}

/* ════════════ 10 · CHARTS (Chart.js) ════════════ */
const C_COL = { blue:"#1f3a93", orange:"#c65d3b", green:"#1f8a5b", red:"#a83232",
                slate:"#4f6d9e", grid:"#e7edeb", muted:"#8b9a95", ink:"#1e2a29" };
const AF_PALETTE = ["#1f3a93","#c65d3b","#1f8a5b","#6c86c9","#a83232","#8b9a95"];
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
const ChartHub = {
  reg:{},
  put(id, cfg){ this.kill(id); const cv = $(id); if(!cv || !window.Chart) return null;
    const ch = new Chart(cv, cfg); this.reg[id] = ch; return ch; },
  kill(id){ if(this.reg[id]){ try{ this.reg[id].destroy(); }catch(e){} delete this.reg[id]; } },
  killPrefix(pre){ Object.keys(this.reg).forEach(k=>{ if(k.indexOf(pre)===0) this.kill(k); }); }
};
let lastRun = { key:null, metric:null, xs:[], data:[], data2:[] };
function clearLastRun(){ lastRun = { key:null, metric:null, xs:[], data:[], data2:[] }; }
function downsample(arr, max){
  if(!arr || arr.length <= max) return arr ? arr.slice() : [];
  const step = arr.length/max, out = [];
  for(let i=0;i<max;i++) out.push(arr[Math.floor(i*step)]);
  out.push(arr[arr.length-1]); return out;
}
/* per-metric x/y series descriptors for the live + detail graphs */
const AERO_SERIES = {
  cl: { x:"Angle of attack α (°)", y:"Lift coefficient Cl", y2:"Drag coefficient Cd", c:C_COL.green, c2:C_COL.orange },
  m2: { x:"Airspeed V (m/s)", y:"Frame drag F_D (N)", y2:"Propulsive efficiency η (%)", c:C_COL.orange, c2:C_COL.green }
};
function xyLine(metric, xs, data, data2, opts){
  opts = opts || {};
  const s = AERO_SERIES[metric] || AERO_SERIES.cl;
  const pts = xs.map((x,i)=>({x:+(+x).toFixed(3), y:data[i]}));
  const ds = [{ label:s.y, data:pts, borderColor:s.c, backgroundColor:s.c+"22",
    borderWidth:2, pointRadius:0, tension:.25, fill:true, yAxisID:"y" }];
  const scales = {
    x:{ type:"linear", title:{display:!opts.mini, text:s.x}, grid:{color:C_COL.grid},
        ticks:{ font:{family:"'IBM Plex Mono'", size:opts.mini?8:10}, maxTicksLimit:opts.mini?6:10 } },
    y:{ title:{display:!opts.mini, text:s.y}, grid:{color:C_COL.grid},
        ticks:{ font:{family:"'IBM Plex Mono'", size:opts.mini?8:10} } }
  };
  if(s.y2 && data2 && data2.length){
    ds.push({ label:s.y2, data:xs.map((x,i)=>({x:+(+x).toFixed(3), y:data2[i]})), borderColor:s.c2,
      borderWidth:2, pointRadius:0, tension:.25, borderDash:[5,4], yAxisID:"y1" });
    scales.y1 = { position:"right", title:{display:!opts.mini, text:s.y2}, grid:{drawOnChartArea:false},
      ticks:{ font:{family:"'IBM Plex Mono'", size:opts.mini?8:10} } };
  }
  return { type:"line", data:{ datasets:ds },
    options:{ responsive:true, maintainAspectRatio:false, animation:opts.live?false:{duration:250},
      interaction:{ mode:"nearest", intersect:false },
      plugins:{ legend:{ display:!opts.mini, position:"bottom" }, tooltip:{ enabled:!opts.mini } },
      scales } };
}
function drawLiveGraph(){
  const { mod, exp } = currentExp();
  const key = mod.id+":"+exp.id, metric = exp.metric;
  const cap = $("graphCaption");
  const live = simActive && sim.data.length > 1;
  let xs, data, data2, recording = false;
  if(live){ xs = sim.xs; data = sim.data; data2 = sim.data2; recording = true; }
  else if(lastRun.key === key && lastRun.data.length > 1){ xs = lastRun.xs; data = lastRun.data; data2 = lastRun.data2; }
  if(!data){
    ChartHub.kill("liveGraph");
    const cv = $("liveGraph");
    if(cv){ const box = cv.parentElement;
      const w = Math.max(box.clientWidth-2, 40), h = Math.max(box.clientHeight-2, 40);
      cv.width = w; cv.height = h; cv.style.width = w+"px"; cv.style.height = h+"px";
      const g = cv.getContext("2d"); g.clearRect(0,0,w,h);
      g.fillStyle = "#a3b2ad"; g.font = "500 12px 'IBM Plex Mono', monospace"; g.textAlign = "center";
      g.fillText("no data — run "+exp.name, w/2, h/2); }
    if(cap) cap.textContent = exp.name+" · waiting for first run…";
    return;
  }
  const ch = ChartHub.reg["liveGraph"];
  if(recording && ch && ch._metric === metric){
    ch.data.datasets[0].data = xs.map((x,i)=>({x:+(+x).toFixed(3), y:data[i]}));
    if(ch.data.datasets[1]) ch.data.datasets[1].data = xs.map((x,i)=>({x:+(+x).toFixed(3), y:data2[i]}));
    ch.update("none");
  }else{
    const c = ChartHub.put("liveGraph", xyLine(metric, xs, data, data2, {mini:true, live:recording}));
    if(c) c._metric = metric;
  }
  if(cap) cap.textContent = exp.name+" · "+(exp.unit||"value")+(recording ? " · recording…" : " · last run");
}

/* — analysis chart configs — */
function polarSeries(af){
  const model = airfoilModel(af, m1SectionRe());
  const cl=[], cd=[];
  for(let a=-6; a<=22.0001; a+=0.5){ cl.push({x:a, y:+model.clDeg(a).toFixed(3)}); cd.push({x:a, y:+model.cdDeg(a).toFixed(4)}); }
  return { model, cl, cd };
}
function cfgPolar(){
  const ds = [];
  REF_AIRFOILS.forEach((id,i)=>{
    const af = airfoilById(id); if(!af) return;
    const s = polarSeries(af);
    ds.push({ label:af.name+" (Cl_max "+s.model.clMax.toFixed(2)+")", data:s.cl,
      borderColor:AF_PALETTE[i], backgroundColor:AF_PALETTE[i]+"18", borderWidth: id===state.airfoil?2.6:1.8,
      pointRadius:0, tension:.2, fill:false, yAxisID:"y" });
  });
  return { type:"line", data:{datasets:ds},
    options:{ responsive:true, maintainAspectRatio:false, interaction:{mode:"nearest",intersect:false},
      plugins:{ legend:{position:"bottom"} },
      scales:{ x:{type:"linear", title:{display:true,text:"Angle of attack α (°)"}, grid:{color:C_COL.grid}},
               y:{ title:{display:true,text:"Lift coefficient Cl"}, grid:{color:C_COL.grid}} } } };
}
function cfgDragPolar(){
  const s = polarSeries(curAirfoil());
  const pts = s.cl.map((p,i)=>({ x:s.cd[i].y, y:p.y }));
  return { type:"scatter", data:{ datasets:[{ label:curAirfoil().name+" drag polar", data:pts,
    borderColor:C_COL.blue, backgroundColor:C_COL.blue, showLine:true, borderWidth:2, tension:.2, pointRadius:0 }] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{position:"bottom"}},
      scales:{ x:{type:"linear", title:{display:true,text:"Drag coefficient Cd"}, grid:{color:C_COL.grid}},
               y:{ title:{display:true,text:"Lift coefficient Cl"}, grid:{color:C_COL.grid}} } } };
}
function cfgFrameDragV(){
  const sw = dragSweep(60, 15);
  return { type:"line", data:{ datasets:[{ label:"Frame drag F_D vs V", data:sw.V.map((v,i)=>({x:v,y:sw.F[i]})),
    borderColor:C_COL.orange, backgroundColor:C_COL.orange+"1f", borderWidth:2, pointRadius:0, tension:.25, fill:true }] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{position:"bottom"}},
      scales:{ x:{type:"linear", title:{display:true,text:"Airspeed V (m/s)"}, grid:{color:C_COL.grid}},
               y:{ title:{display:true,text:"Drag force F_D (N)"}, grid:{color:C_COL.grid}, beginAtZero:true} } } };
}
function cfgFrameDragV2(){
  const sw = dragSweep(60, 15);
  const pts = sw.V2.map((v2,i)=>({x:v2, y:sw.F[i]}));
  const fit = sw.V2.map(v2=>({x:v2, y:sw.slope*v2}));
  return { type:"scatter", data:{ datasets:[
    { label:"F_D vs V²", data:pts, borderColor:C_COL.blue, backgroundColor:C_COL.blue, showLine:false, pointRadius:2.5 },
    { label:"linear fit (R²="+sw.R2.toFixed(4)+")", data:fit, borderColor:C_COL.green, borderWidth:2, showLine:true, pointRadius:0 } ] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{position:"bottom"}},
      scales:{ x:{type:"linear", title:{display:true,text:"V² (m²/s²)"}, grid:{color:C_COL.grid}},
               y:{ title:{display:true,text:"Drag force F_D (N)"}, grid:{color:C_COL.grid}, beginAtZero:true} } } };
}
function cfgCruise(){
  const pc = propCoeffs(), cs = cruiseSweep(pc, 60);
  return { type:"line", data:{ datasets:[
    { label:"Propulsive efficiency η", data:cs.J.map((j,i)=>({x:j,y:cs.eta[i]})),
      borderColor:C_COL.green, backgroundColor:C_COL.green+"1f", borderWidth:2, pointRadius:0, tension:.3, fill:true, yAxisID:"y" },
    { label:"peak η "+(cs.peak.eta*100).toFixed(0)+"% @ J="+cs.peak.J.toFixed(2),
      data:[{x:cs.peak.J, y:+(cs.peak.eta*100).toFixed(2)}], borderColor:C_COL.orange, backgroundColor:C_COL.orange,
      showLine:false, pointRadius:5, yAxisID:"y" } ] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{position:"bottom"}},
      scales:{ x:{type:"linear", title:{display:true,text:"Advance ratio J"}, grid:{color:C_COL.grid}},
               y:{ title:{display:true,text:"η (%)"}, grid:{color:C_COL.grid}, beginAtZero:true} } } };
}
function cfgThrustJ(){
  const pc = propCoeffs(), cs = cruiseSweep(pc, 60);
  return { type:"line", data:{ datasets:[
    { label:"Thrust T (N)", data:cs.J.map((j,i)=>({x:j,y:cs.T[i]})), borderColor:C_COL.blue,
      backgroundColor:C_COL.blue+"1f", borderWidth:2, pointRadius:0, tension:.3, fill:true, yAxisID:"y" },
    { label:"Thrust coeff. Ct", data:cs.J.map((j,i)=>({x:j,y:cs.Ct[i]})), borderColor:C_COL.slate,
      borderWidth:2, pointRadius:0, tension:.3, borderDash:[5,4], yAxisID:"y1" } ] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{position:"bottom"}},
      scales:{ x:{type:"linear", title:{display:true,text:"Advance ratio J"}, grid:{color:C_COL.grid}},
               y:{ title:{display:true,text:"Thrust (N)"}, grid:{color:C_COL.grid}, beginAtZero:true},
               y1:{ position:"right", title:{display:true,text:"Ct"}, grid:{drawOnChartArea:false}, beginAtZero:true} } } };
}
/* right-panel summary chart — the airfoil polar overlay */
function drawSummaryChart(){ const c = ChartHub.put("summaryChart", cfgPolar()); if(c) c._metric="polar"; }
function plotDefsAll(){
  return [
    { id:"polar",  title:"Airfoil polar · Cl vs α (0012 · 2412 · 4412)", cfg:cfgPolar },
    { id:"dpolar", title:"Drag polar · Cl vs Cd ("+curAirfoil().name+")", cfg:cfgDragPolar },
    { id:"fdv",    title:"Frame drag · F_D vs V",                cfg:cfgFrameDragV },
    { id:"fdv2",   title:"Frame drag linearised · F_D vs V²",    cfg:cfgFrameDragV2, note:()=>{ const s=dragSweep(30,15); return "slope "+s.slope.toFixed(5)+" N·s²/m² · theory 0.5ρCdA = "+s.sTheory.toFixed(5)+" ("+(s.errPct>=0?"+":"")+s.errPct.toFixed(1)+"%) · R² = "+s.R2.toFixed(4); } },
    { id:"cruise", title:"Cruise efficiency · η vs J",           cfg:cfgCruise },
    { id:"tj",     title:"Thrust & Ct vs advance ratio",         cfg:cfgThrustJ }
  ];
}

/* ════════════ 11 · FLOATING WINDOWS ════════════ */
function openModal(title, dotColor, footHTML){
  $("modalTitle").innerHTML = title;
  $("modalDot").style.background = dotColor || "#1f3a93";
  const foot = $("modalFoot");
  if(footHTML){ foot.innerHTML = footHTML; foot.hidden = false; } else foot.hidden = true;
  $("modalBody").innerHTML = "";
  $("modalOverlay").hidden = false;
  document.body.style.overflow = "hidden";
  return $("modalBody");
}
function closeModal(){
  ChartHub.killPrefix("gc_");
  $("modalOverlay").hidden = true;
  $("modalBody").innerHTML = "";
  document.body.style.overflow = "";
}
function openAirfoilPicker(){
  const body = openModal('Blade Airfoil <em>· NACA section library</em>', "#1f3a93",
    'thin-airfoil α₀ is computed live from the camber line; Cl_max and stall scale with blade Reynolds number');
  const grid = el("div","pick-grid"); body.appendChild(grid);
  const build = ()=>{
    grid.innerHTML = "";
    DRONE_DB.airfoils.forEach(af=>{
      const selected = state.airfoil === af.id;
      const card = el("button","pick-opt"+(selected?" selected":"")); card.type = "button";
      const model = airfoilModel(af, 5e5);
      const specs =
        '<div><span class="k">Max camber</span><span class="v">'+(af.m*100).toFixed(0)+'%</span></div>'+
        '<div><span class="k">Thickness</span><span class="v">'+(af.t*100).toFixed(0)+'%</span></div>'+
        '<div><span class="k">α₀ (zero-lift)</span><span class="v">'+af.alpha0_deg.toFixed(1)+'°</span></div>'+
        '<div><span class="k">Cl_max</span><span class="v">'+model.clMax.toFixed(2)+'</span></div>'+
        '<div class="mass"><span class="k">Stall α</span><span class="v">'+model.aStallDeg.toFixed(1)+'°</span></div>';
      card.innerHTML =
        '<div class="top"><span class="name">'+txt(af.name)+'</span><span class="check">'+(selected?"✓ selected":"")+'</span></div>'+
        '<div class="view"><canvas width="200" height="110"></canvas></div>'+
        '<div class="specs">'+specs+'</div>';
      card.addEventListener("click", ()=>{
        state.airfoil = af.id; refreshAfterSelection("airfoil"); instrEvent("select"); sfx("tick"); build();
      });
      grid.appendChild(card);
      drawAirfoilCanvas(card.querySelector("canvas"), af, { label:false });
    });
  };
  build(); instrEvent("picker");
}
function openBladePicker(){
  const body = openModal('Blade Count <em>· rotor solidity</em>', "#1f3a93",
    'more blades raise solidity σ and thrust at fixed RPM, but add drag and lower peak efficiency');
  const grid = el("div","pick-grid"); body.appendChild(grid);
  [2,3,4].forEach(n=>{
    const selected = state.blades === n;
    const card = el("button","pick-opt"+(selected?" selected":"")); card.type = "button";
    card.innerHTML =
      '<div class="top"><span class="name">'+n+'-blade</span><span class="check">'+(selected?"✓ selected":"")+'</span></div>'+
      '<div class="view"><canvas width="200" height="110"></canvas></div>'+
      '<div class="specs"><div><span class="k">Blades</span><span class="v">'+n+'</span></div></div>';
    card.addEventListener("click", ()=>{
      state.blades = n; refreshAfterSelection("blades"); instrEvent("select"); sfx("tick"); closeModal();
    });
    grid.appendChild(card);
    registerPreview(card.querySelector("canvas"), { __proc:true });
  });
}
function openComponentPicker(catKey){
  const c = cat(catKey); if(!c) return;
  const body = openModal(txt(c.label)+' <em>· option library</em>', "#1f3a93",
    'options are folder-driven — drop a folder with <b>spec.json</b> + model under <b>assets/'+txt(c.key)+'/</b>');
  const grid = el("div","pick-grid"); body.appendChild(grid);
  const build = ()=>{
    grid.innerHTML = "";
    c.options.forEach(o=>{
      const selected = state.sel[catKey] === o.id;
      const card = el("button","pick-opt"+(selected?" selected":"")); card.type = "button";
      let specs = o.specs.map(s=>'<div><span class="k">'+txt(s[0])+'</span><span class="v">'+txt(s[1])+'</span></div>').join("");
      if(o.size) specs += '<div class="mass"><span class="k">Size</span><span class="v">'+o.size.join(" × ")+' mm</span></div>';
      card.innerHTML =
        '<div class="top"><span class="name">'+txt(o.name)+'</span><span class="check">'+(selected?"✓ selected":"")+'</span></div>'+
        '<div class="view"><canvas width="200" height="110"></canvas></div>'+
        '<div class="specs">'+specs+'</div>';
      card.addEventListener("click", ()=>{
        state.sel[catKey] = o.id; refreshAfterSelection(catKey); instrEvent("select"); sfx("tick"); build();
      });
      grid.appendChild(card);
      registerPreview(card.querySelector("canvas"), o);
    });
  };
  build();
}
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
  wrap.innerHTML = '<canvas id="gc_single"></canvas>'; body.appendChild(wrap);
  const c = def.cfg(); if(c) ChartHub.put("gc_single", c);
  if(def.note) body.appendChild(el("p","chart-footnote", txt(def.note())));
  const back = $("chartBack"); if(back) back.addEventListener("click", backTo==="graphs"?openGraphDetail:openChartsDetail);
}
function openChartsDetail(){
  ChartHub.killPrefix("gc_");
  const body = openModal('Charts <em>· analysis · click any chart to expand</em>', "#c65d3b");
  const c = aeroCalc();
  const wrap = el("div","calc-blocks");
  const tiles = el("div","metric-tiles");
  const mt = (k,v,cls)=>'<div class="metric-tile"><span class="mk">'+k+'</span><span class="mv '+(cls||"")+'">'+v+'</span></div>';
  tiles.innerHTML =
    mt("Cl_max", c.clMax.toFixed(2)) +
    mt("Stall α", c.aStallDeg.toFixed(1)+"°") +
    mt("α₀", c.a0deg.toFixed(1)+"°") +
    mt("F_D @ 10 m/s", c.Fd10.toFixed(2)+" N") +
    mt("Peak η", c.etaPeak.toFixed(0)+" %", c.etaPeak>=70?"good":"") +
    mt("J @ peak η", c.etaPeakJ.toFixed(2));
  wrap.appendChild(tiles);
  const pending = [];
  chartDefs().forEach(def=>{
    const block = el("div","calc-block gchart");
    const head = el("div","gchart-head");
    head.innerHTML = '<h3>'+txt(def.title)+'</h3><button type="button" class="gchart-expand" title="Expand">⤢</button>';
    head.querySelector("button").addEventListener("click", ()=>openSingleChart(def));
    block.appendChild(head);
    const cfg0 = def.cfg;
    if(typeof cfg0 === "function" && cfg0() == null){
      block.appendChild(el("div","runs-empty", txt(def.empty||"No data yet.")));
    }else{
      const box = el("div","chart-box-lg");
      box.innerHTML = '<canvas id="gc_'+def.id+'"></canvas>'; block.appendChild(box);
      pending.push({ id:"gc_"+def.id, cfg:def.cfg });
    }
    if(def.note) block.appendChild(el("p","chart-footnote", txt(def.note())));
    wrap.appendChild(block);
  });
  body.appendChild(wrap);
  pending.forEach(pc=>{ const cfg = pc.cfg(); if(cfg) ChartHub.put(pc.id, cfg); });
  wrap.appendChild(el("p","calc-footnote",
    "Curves recompute live from the selected NACA section, blade geometry and the density-altitude slider. "+
    "Cl(α) = 2π-slope thin-airfoil lift with a Viterna post-stall blend; drag F_D = ½ρV²·Cd·A_frontal; "+
    "advance ratio J = V/(n·D); propulsive efficiency η = J·Ct/(2π·Cq)."));
}
function openGraphDetail(){
  ChartHub.killPrefix("gc_");
  const { mod, exp } = currentExp();
  const key = mod.id+":"+exp.id;
  const body = openModal('Graphs <em>· live run + parameter sweeps</em>', "#4f6d9e");
  const wrap = el("div","calc-blocks");
  let xs, data, data2;
  if(simActive && sim.data.length>1){ xs=sim.xs; data=sim.data; data2=sim.data2; }
  else if(lastRun.key===key && lastRun.data.length>1){ xs=lastRun.xs; data=lastRun.data; data2=lastRun.data2; }
  const live = el("div","calc-block gchart");
  live.innerHTML = '<div class="gchart-head"><h3>Live run · '+txt(exp.name)+'</h3></div>';
  if(data){ const box = el("div","chart-box-lg");
    box.innerHTML = '<canvas id="gc_live"></canvas>'; live.appendChild(box); }
  else live.appendChild(el("div","runs-empty",
    "No data yet for <b>"+txt(exp.name)+"</b>.<br>Press <b>▶ Run Sim</b> to plot this experiment."));
  wrap.appendChild(live);
  const pending = renderGraphBlocks(wrap, graphDefs().filter(d=>!d.empty));
  body.appendChild(wrap);
  if(data) ChartHub.put("gc_live", xyLine(exp.metric, xs, data, data2, {mini:false}));
  pending.forEach(p=>ChartHub.put(p.id, p.cfg));
}
function openCalcDetail(){
  const body = openModal("Detailed Calculations <em>· sub-calcs A · B · C</em>", "#c65d3b");
  const c = aeroCalc(), af = curAirfoil(), g = c.g;
  const n = state.rpm/60, D = g.D;
  const Jnow = (n*D>1e-6) ? state.wind_v/(n*D) : 0;
  const rNow = propAtJ(c.pc, Jnow);
  const blocks = [
    { t:"A · Lift coefficient  Cl = 2π(α − α₀)", b:
      "airfoil "+af.name+"  ·  camber m = "+(af.m*100).toFixed(0)+"%, thickness t = "+(af.t*100).toFixed(0)+"%\n"+
      "α₀ = thin-airfoil camber-line integral = "+c.a0deg.toFixed(2)+"°\n"+
      "lift slope (finite-thickness, Re "+Math.round(m1SectionRe()).toLocaleString()+") ≈ "+c.model.slope.toFixed(2)+" /rad\n"+
      "α = "+state.aoa_deg.toFixed(1)+"°  →  Cl = "+c.clNow.toFixed(3)+"  ·  Cd = "+c.cdNow.toFixed(4),
      r:"Cl_max = "+c.clMax.toFixed(2)+"  at stall α = "+c.aStallDeg.toFixed(1)+"°" },
    { t:"B · Frame drag  F_D = ½·ρ·V²·Cd·A_frontal", b:
      "ρ("+state.altitude+" m) = "+c.rho.toFixed(4)+" kg/m³\n"+
      "Cd (X-frame bluff body) ≈ 1.05"+(state.washOn?"  × 1.20 rotor-wash interference":"")+"\n"+
      "A_frontal = "+frontalArea().toFixed(4)+" m²\n"+
      "V = "+state.wind_v.toFixed(1)+" m/s  →  F_D = "+dragForce(state.wind_v).F.toFixed(3)+" N",
      r:"F_D @ 10 m/s = "+c.Fd10.toFixed(2)+" N  ·  F_D ∝ V²" },
    { t:"C · Advance ratio  J = V/(n·D)", b:
      "n = RPM/60 = "+n.toFixed(1)+" rev/s  ·  D = "+(D*1000).toFixed(0)+" mm ("+state.diameter_in.toFixed(1)+" in)\n"+
      "V = "+state.wind_v.toFixed(1)+" m/s  →  J = "+Jnow.toFixed(3)+"\n"+
      "zero-thrust advance ratio J₀ = "+c.J0.toFixed(2),
      r:"J = "+Jnow.toFixed(2)+"  (windmilling above J₀ = "+c.J0.toFixed(2)+")" },
    { t:"C · Propulsive efficiency  η = T·V / (2π·n·Q)", b:
      "η = J·Ct/(2π·Cq)   ·   Ct("+Jnow.toFixed(2)+") = "+rNow.Ct.toFixed(4)+", Cq = "+rNow.Cq.toFixed(5)+"\n"+
      "T = "+rNow.T.toFixed(3)+" N  ·  Q = "+rNow.Q.toFixed(4)+" N·m  ·  η = "+(rNow.eta*100).toFixed(1)+" %",
      r:"peak η = "+c.etaPeak.toFixed(0)+" %  at J = "+c.etaPeakJ.toFixed(2) }
  ];
  const wrap = el("div","calc-blocks");
  blocks.forEach(bl=>{
    const d = el("div","calc-block");
    d.innerHTML = '<h3>'+txt(bl.t)+'</h3><pre>'+txt(bl.b)+'</pre><div class="res">'+txt(bl.r)+'</div>';
    wrap.appendChild(d);
  });
  wrap.appendChild(el("p","calc-footnote",
    "All values recompute live from the selected NACA section, blade geometry, operating point and density-altitude. "+
    "α₀ from NACA TR-824 thin-airfoil theory; Cd = 1.05 per NASA TN-D-8236; torque coefficient Cq per BEMT-lite convention."));
  body.appendChild(wrap);
}

/* ════════════ 12 · SIMULATION RUNNER ════════════ */
const SIM_DURATION = 9;                    // seconds per parameter sweep
let simActive = false;
const sim = { t:0, xs:[], data:[], data2:[], key:null, metric:null, exp:null, mod:null,
              phase:"STANDBY", sweepVal:0, spin:0, verdict:null, verdictOk:false };
let calcCache = null, calcCacheAge = 0;
function calcCached(){
  if(!calcCache || (performance.now()-calcCacheAge) > 400){ calcCache = aeroCalc(); calcCacheAge = performance.now(); }
  return calcCache;
}
function runSim(){
  if(simActive){ stopSim(true); return; }
  const dg = renderLog();
  if(dg.blocked){
    sfx("error");
    const lc = $("logCard");
    if(lc) lc.animate([{transform:"translateX(0)"},{transform:"translateX(-4px)"},{transform:"translateX(4px)"},{transform:"translateX(0)"}], {duration:280});
    return;
  }
  const { mod, exp } = currentExp();
  simActive = true; state.simRunning = true;
  sim.t = 0; sim.xs = []; sim.data = []; sim.data2 = [];
  sim.exp = exp; sim.mod = mod; sim.key = mod.id+":"+exp.id; sim.metric = exp.metric;
  sim.verdict = null; sim.verdictOk = false; sim.spin = 0;
  sim.savedAoa = state.aoa_deg; sim.savedWind = state.wind_v;   // restore the operating point after the sweep
  sim.phase = exp.metric==="cl" ? "SWEEPING α" : "SWEEPING V";
  const rb = $("runBtn"); if(rb){ rb.textContent = "■ Stop"; rb.classList.add("running"); }
  const dot = $("telDot"); if(dot) dot.classList.add("on");
  audioStart(); sfx("start"); instrEvent("run");
}
function stopSim(completed){
  simActive = false; state.simRunning = false;
  const rb = $("runBtn"); if(rb){ rb.textContent = "▶ Run Sim"; rb.classList.remove("running"); }
  const dot = $("telDot"); if(dot) dot.classList.remove("on");
  audioStop();
  // the sweep mutated the operating point for animation — restore the user's set values
  if(sim.savedAoa != null) state.aoa_deg = sim.savedAoa;
  if(sim.savedWind != null) state.wind_v = sim.savedWind;
  syncOperatingSliders();
  if(isAirfoilScene()) updateAirfoilScene(); else updateWindScene();
  if(completed && sim.data.length > 3){
    state.done[sim.key] = true;
    lastRun = { key:sim.key, metric:sim.metric,
      xs:downsample(sim.xs,240), data:downsample(sim.data,240), data2:downsample(sim.data2,240) };
    saveState();
    renderModuleTabs(); renderExpTabs(); renderProgress(); renderReward(); renderAeroMini();
    sfx("done");
    if(sim.verdict){ showVerdictToast(sim.verdict, sim.verdictOk); }
    if(allDone()){ instrGo(DRONE_DB.instructor.length-1); playVoice(); sfx("unlock"); }
    else instrEvent("runDone");
  }
  refreshIdleTelemetry();
  drawLiveGraph();
}
function resetSim(){
  if(simActive) stopSim(false);
  clearLastRun(); refreshIdleTelemetry(); drawLiveGraph();
}
function showVerdictToast(text, ok){
  const t = el("div","verdict "+(ok?"pass":"fail"));
  t.style.cssText = "position:fixed;left:50%;top:74px;transform:translateX(-50%);z-index:120;box-shadow:0 10px 30px rgba(20,40,40,.25);max-width:460px";
  const parts = text.split("—");
  t.innerHTML = '<span class="vic">'+(ok?"✓":"×")+'</span><div class="vtx"><b>'+txt(parts[0].trim())+'</b><span>'+txt(parts.slice(1).join("—").trim())+'</span></div>';
  document.body.appendChild(t);
  setTimeout(()=>{ t.style.transition="opacity .5s"; t.style.opacity="0"; setTimeout(()=>t.remove(),500); }, 3600);
}
function simStep(dt){
  sim.t += dt;
  const u = clamp(sim.t/SIM_DURATION, 0, 1);
  const metric = sim.metric;

  if(metric === "cl"){
    const model = airfoilModel(curAirfoil(), m1SectionRe());
    const aStall = model.aStallDeg;
    // sweep from below zero-lift UP TO the AoA the user set on the slider — the operator
    // decides how far to push (past stall or not), not an automatic max.
    const aStart = Math.min(-5, sim.savedAoa - 2);
    const aEnd   = clamp(sim.savedAoa, aStart + 3, 24);
    const a = lerp(aStart, aEnd, u);
    state.aoa_deg = +a.toFixed(2);
    updateAirfoilScene();
    const cl = model.clDeg(a), cd = model.cdDeg(a), ld = cd>1e-6 ? cl/cd : 0;
    sim.xs.push(+a.toFixed(2)); sim.data.push(+cl.toFixed(3)); sim.data2.push(+cd.toFixed(4));
    sim.spin = 0;
    const stalled = a > aStall;
    updateTelemetry("cl", [
      a.toFixed(1)+"°", cl.toFixed(2), cd.toFixed(3), ld.toFixed(1),
      Math.round(m1SectionRe()).toLocaleString(), tipMach().toFixed(2)
    ], stalled ? "STALLED" : "ATTACHED", stalled ? "danger" : "good");
    if(stalled && airfoilMesh && frameNo%3===0){
      const wp = airfoilMesh.getWorldPosition(new THREE.Vector3());
      FX.burstAt(wp.x+1.2, wp.y+0.1, wp.z, 2, 0.5, 0x9aa6b2, 1.4);
    }
    if(u >= 1){
      state.profiled[state.airfoil] = { clMax:+model.clMax.toFixed(3), aStall:+aStall.toFixed(2), a0:+model.a0deg.toFixed(2) };
      sim.verdictOk = true;
      const reached = aEnd > aStall
        ? "past stall — Cl_max "+model.clMax.toFixed(2)+" at α "+aStall.toFixed(1)+"°"
        : "up to α "+aEnd.toFixed(1)+"° — Cl "+model.clDeg(aEnd).toFixed(2)+" (still attached, stall at "+aStall.toFixed(1)+"°)";
      sim.verdict = curAirfoil().name+" profiled — swept "+reached+" (α₀ "+model.a0deg.toFixed(1)+"°)";
      stopSim(true);
    }
    return;
  }

  // metric === "m2" — combined Forward-Flight sweep: frame drag AND cruise efficiency
  // in one pass over airspeed V. F_D(V) traces the quadratic drag law; J=V/(nD) and
  // η(J) trace the propulsive-efficiency curve. Both plotted vs the shared airspeed axis.
  const pc = propCoeffs(), n = state.rpm/60, D = pc.g.D;
  const cs = cruiseSweep(pc, 60);
  const Vmax = Math.max(15, cs.Vmax);
  const V = lerp(0, Vmax, u);
  state.wind_v = +V.toFixed(2);
  updateWindScene();
  const d = dragForce(V);
  const J = (n*D>1e-6) ? V/(n*D) : 0;
  const r = propAtJ(pc, J);
  sim.xs.push(+V.toFixed(2));
  sim.data.push(+d.F.toFixed(4));                    // frame drag F_D (N)
  sim.data2.push(+(r.eta*100).toFixed(2));           // propulsive efficiency η (%)
  sim.spin = 1.5;
  updateTelemetry("m2", [
    V.toFixed(1), d.F.toFixed(2), J.toFixed(2), (r.eta*100).toFixed(0)+"%",
    r.T.toFixed(2)+" N", Math.round(d.Re_body).toLocaleString()
  ], J>pc.J0 ? "WINDMILLING · "+V.toFixed(1)+" m/s" : "SWEEPING V · "+V.toFixed(1)+" m/s", J>pc.J0?"warn":"good");
  if(u >= 1){
    const sw = dragSweep(60, 15), etaPk = cs.peak.eta*100;
    sim.verdictOk = sw.R2 > 0.999 && etaPk >= 40;
    sim.verdict = "Forward flight mapped — drag F_D ∝ V² (R² "+sw.R2.toFixed(4)+
      "), peak propulsive η "+etaPk.toFixed(0)+"% at advance ratio J = "+cs.peak.J.toFixed(2);
    stopSim(true);
  }
}

/* ════════════ 13 · PROCEDURAL AUDIO ENGINE ════════════ */
let actx = null, aMaster = null, noiseBuf = null, engine = null;
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
function sfx(kind){
  if(state.sfxVol<=0) return;
  const v = .22;
  try{
    if(kind==="tick") tone(880,0,.07,v);
    else if(kind==="start"){ tone(392,0,.09,v); tone(587,.09,.12,v); }
    else if(kind==="done"){ tone(660,0,.1,v); tone(880,.12,.18,v); }
    else if(kind==="error"){ tone(200,0,.12,v,"square"); tone(150,.12,.18,v,"square"); }
    else if(kind==="unlock"){ [523,659,784,1047].forEach((f,i)=>tone(f,i*.13,.22,v)); }
  }catch(e){}
}
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
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime+.22);
  }catch(e){}
}
/* wind-tunnel engine: broadband air (band-passed noise) + optional blade whine */
function audioStart(){
  if(state.sfxVol<=0) return;
  try{
    const ctx = ac();
    audioStopNow();
    const g = ctx.createGain(); g.gain.value = 0; g.connect(aMaster);
    const noise = ctx.createBufferSource(); noise.buffer = noiseBuf; noise.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type="bandpass"; bp.frequency.value=700; bp.Q.value=1.2;
    const noiseG = ctx.createGain(); noiseG.gain.value=.5; noise.connect(bp); bp.connect(noiseG); noiseG.connect(g);
    const whine = ctx.createOscillator(); whine.type="triangle"; whine.frequency.value=220;
    const whineG = ctx.createGain(); whineG.gain.value=0; whine.connect(whineG); whineG.connect(g);
    noise.start(); whine.start();
    engine = { g, noise, bp, whine, whineG, cur:0 };
    g.gain.setTargetAtTime(.8, ctx.currentTime, .25);
  }catch(e){}
}
function audioStopNow(){
  if(!engine) return;
  try{ engine.noise.stop(); engine.whine.stop(); }catch(e){}
  engine = null;
}
function audioStop(){
  if(!engine || !actx) return;
  const e = engine, t = actx.currentTime;
  e.g.gain.setTargetAtTime(0, t, .18);
  setTimeout(()=>{ try{ e.noise.stop(); e.whine.stop(); }catch(x){} }, 500);
  if(engine === e) engine = null;
}
function audioUpdate(){
  if(!engine || !actx) return;
  const ctx = actx;
  const u = clamp(sim.t/SIM_DURATION, 0, 1);
  if(sim.metric === "cl"){
    // wind-tunnel airspeed roughly constant; turbulence surges past stall
    const model = airfoilModel(curAirfoil(), m1SectionRe());
    const stalled = state.aoa_deg > model.aStallDeg;
    engine.bp.frequency.setTargetAtTime(stalled?420:800, ctx.currentTime, .1);
    engine.bp.Q.setTargetAtTime(stalled?0.6:1.6, ctx.currentTime, .1);
    engine.whineG.gain.setTargetAtTime(0, ctx.currentTime, .1);
    engine.g.gain.setTargetAtTime(0.55 + (stalled?0.35:0.1), ctx.currentTime, .1);
  }else{
    // airspeed ramps with the sweep; blade whine tracks RPM
    const rev = state.rpm/60, blade = rev*(state.blades||2);
    engine.whine.frequency.setTargetAtTime(Math.min(Math.max(blade,60), 1400), ctx.currentTime, .05);
    engine.whineG.gain.setTargetAtTime(.05, ctx.currentTime, .1);
    engine.bp.frequency.setTargetAtTime(500 + u*900, ctx.currentTime, .1);
    engine.g.gain.setTargetAtTime(0.4 + u*0.55, ctx.currentTime, .1);
  }
}

/* ════════════ 14 · INSTRUCTOR ════════════ */
let currentVoice = null, lastVoiceUrl = null;
function stopVoice(){
  if(currentVoice){ try{ currentVoice.pause(); currentVoice.currentTime = 0; }catch(e){} currentVoice = null; }
}
function playVoiceFile(url){
  if(!url) return;
  lastVoiceUrl = url;
  if(state.voiceVol<=0) return;
  stopVoice();
  try{
    const a = new Audio(url);
    a.volume = Math.min(state.voiceVol/100,1);
    currentVoice = a;
    a.addEventListener("ended", ()=>{ if(currentVoice===a) currentVoice = null; });
    a.play().catch(()=>{});
  }catch(e){}
}
function playVoice(){
  const step = DRONE_DB.instructor[state.instrStep];
  if(step && step.audio){ playVoiceFile(step.audio); return; }
  if(state.voiceVol<=0) return;
  try{ [392,494,587].forEach((f,i)=>tone(f, i*.16, .2, (state.voiceVol/100)*.18, "triangle")); }catch(e){}
}
function replayVoice(){ if(lastVoiceUrl) playVoiceFile(lastVoiceUrl); else playVoice(); }
function renderInstr(){
  const steps = DRONE_DB.instructor;
  const tx = $("instrText"), st = $("instrStepTxt"), pn = $("instrPanel");
  if(tx) tx.textContent = steps[state.instrStep].text;
  if(st) st.textContent = "step "+(state.instrStep+1)+" / "+steps.length;
  if(pn) pn.hidden = !state.instrOpen;
}
function instrGo(n){
  state.instrStep = Math.max(0, Math.min(n, DRONE_DB.instructor.length-1));
  saveState(); renderInstr();
}
/* map the active experiment to its narration step (see manifest.instructor order) */
const EXP_STEP = { "m1:polar":1, "m2:forward":5 };
function instrJump(){
  const key = state.module+":"+state.exp[state.module];
  const s = EXP_STEP[key];
  if(s != null && state.instrStep < s){ instrGo(s); if(state.instrOpen) playVoice(); }
}
function instrEvent(evt){
  const key = state.module+":"+state.exp[state.module];
  // picker / select — gentle: only nudge forward if the student is behind (no repeats)
  if(evt==="picker" || evt==="select"){
    const t = EXP_STEP[key];
    if(t != null && state.instrStep < t){ instrGo(t); if(state.instrOpen) playVoice(); }
    return;
  }
  // run / runDone — ALWAYS narrate the moment (even on a repeat run), so the lab
  // never goes silent when you press Run or an experiment finishes.
  let step = null;
  if(evt==="run")          step = key==="m1:polar" ? 2 : 7;   // "running…" narration
  else if(evt==="runDone") step = key==="m1:polar" ? 4 : 9;   // result narration
  if(step != null){ instrGo(step); if(state.instrOpen) playVoice(); }
}

/* ════════════ 15 · WIRING + BOOT ════════════ */
document.querySelectorAll("#tabbar button").forEach(b=>{
  b.addEventListener("click", ()=>{
    document.querySelectorAll("#tabbar button").forEach(x=>x.classList.toggle("active", x===b));
    const target = $(b.dataset.target);
    if(target) window.scrollTo({ top: target.offsetTop - 6, behavior:"smooth" });
  });
});

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
    if(!isAirfoilScene()){
      // wind scene: gentle forward-pitched hover bob
      const box = new THREE.Box3().setFromObject(rig);
      const baseY = 1.15;
      rig.position.y = baseY + Math.sin(hoverPhase)*.03;
    }
    // spin any propellers (procedural or rotor-attached)
    // rotors turn at the rpm the student set, not a fixed rate
    const spin = (simActive || !isAirfoilScene()) ? propSpinRate(state.rpm)*(simActive?1:0.25) : 0;
    propGroups.forEach((p,i)=>{
      const dir = p.userData.spinDir != null ? p.userData.spinDir : (i%2?1:-1);
      p.rotation.y += spin*dir*dt;
    });
    procProps.forEach((p,i)=>{
      if(p.parent && p.parent.userData && p.parent.userData.spinDir!=null) return; // spun via its spinner
      p.rotation.y += spin*(i%2?1:-1)*dt;
    });
    // airfoil-scene streamlines follow the deflected mean field (particles handled below)
    if(isAirfoilScene() && streamlines.length){
      const model = airfoilModel(curAirfoil(), m1SectionRe());
      const aoaRad = state.aoa_deg*DEG;
      const clN = clamp(model.clDeg(state.aoa_deg)/1.2, -1.6, 1.6);
      const stalled = state.aoa_deg > model.aStallDeg;
      streamlines.forEach(line=>{
        const pos = line.geometry.attributes.position; if(!pos) return;
        const y0 = line.userData.y0 || 0;
        for(let k=0;k<pos.count;k++){
          pos.setY(k, airfoilFlowY(pos.getX(k), y0, aoaRad, clN, stalled, hoverPhase));
        }
        pos.needsUpdate = true;
      });
    }
    // velocity-field particle advection — runs in BOTH scenes (airflow + turbulence)
    updateFlowField(dt);
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
  if(o){ o.classList.add("gone"); o.style.transition="opacity .5s"; o.style.opacity="0"; setTimeout(()=>o.remove(), 520); }
}
async function boot(){
  try{ await loadCatalog(); }
  catch(e){ console.error("Catalog failed to load:", e); bootProgress("failed to load catalog", 1); return; }
  bootProgress("initialising lab…", .8);
  try{
  loadState();
  initPreviewEngine();
  initViewport();
  renderTiles();
  renderAeroMini();
  renderModuleTabs();
  renderExpTabs();
  renderProgress();
  renderCalcChips();
  renderLog();
  renderReward();
  renderInstr();
  drawSummaryChart();
  drawLiveGraph();
  refreshIdleTelemetry();

  // blade geometry sliders — live labels + recalc; scene rebuild on release
  const geomWire = (sliderId, valId, key, fmt)=>{
    const sl = $(sliderId), vv = $(valId); if(!sl) return;
    sl.value = state[key];
    if(vv) vv.textContent = fmt(state[key]);
    sl.addEventListener("input", e=>{
      state[key] = +e.target.value;
      if(vv) vv.textContent = fmt(state[key]);
      calcCache = null; renderCalcChips(); renderLog(); renderAeroMini(); refreshIdleTelemetry(); saveState();
    });
    sl.addEventListener("change", ()=>{ drawSummaryChart(); buildScene(); });
  };
  geomWire("diaSlider","diaVal","diameter_in", v=>v.toFixed(1)+" in");
  geomWire("rootSlider","rootVal","root_chord_mm", v=>v.toFixed(0)+" mm");
  geomWire("tipSlider","tipVal","tip_chord_mm", v=>v.toFixed(0)+" mm");
  geomWire("pitchSlider","pitchVal","pitch_angle_deg", v=>v.toFixed(1)+"°");
  geomWire("rpmSlider","rpmVal","rpm", v=>Math.round(v).toLocaleString());

  // operating point — AoA (M1) + airspeed (M2) drive their scenes live
  const aoaSl = $("aoaSlider"), aoaV = $("aoaVal");
  if(aoaSl){ aoaSl.value = state.aoa_deg; if(aoaV) aoaV.textContent = state.aoa_deg.toFixed(1)+"°";
    aoaSl.addEventListener("input", e=>{
      state.aoa_deg = +e.target.value; if(aoaV) aoaV.textContent = state.aoa_deg.toFixed(1)+"°";
      calcCache = null; if(isAirfoilScene()) updateAirfoilScene();
      renderCalcChips(); renderLog(); if(!simActive) refreshIdleTelemetry(); saveState();
    });
  }
  const windSl = $("windSlider"), windV = $("windVal");
  if(windSl){ windSl.value = state.wind_v; if(windV) windV.textContent = state.wind_v.toFixed(1)+" m/s";
    windSl.addEventListener("input", e=>{
      state.wind_v = +e.target.value; if(windV) windV.textContent = state.wind_v.toFixed(1)+" m/s";
      calcCache = null; if(!isAirfoilScene()) updateWindScene();
      renderCalcChips(); renderLog(); renderAeroMini(); if(!simActive) refreshIdleTelemetry(); saveState();
    });
  }
  const washT = $("washToggle");
  if(washT){
    washT.setAttribute("aria-checked", state.washOn?"true":"false");
    washT.classList.toggle("on", state.washOn);
    washT.addEventListener("click", ()=>{
      state.washOn = !state.washOn;
      washT.setAttribute("aria-checked", state.washOn?"true":"false");
      washT.classList.toggle("on", state.washOn);
      calcCache = null; if(!isAirfoilScene()) updateWindScene();
      renderCalcChips(); renderLog(); renderAeroMini(); if(!simActive) refreshIdleTelemetry(); sfx("tick"); saveState();
    });
  }

  // density altitude
  const altSl = $("altSlider"), altV = $("altVal"), rhoV = $("rhoVal");
  if(altSl){ altSl.value = state.altitude;
    if(altV) altV.textContent = state.altitude+" m";
    if(rhoV) rhoV.textContent = rhoAt(state.altitude).toFixed(4)+" kg/m³";
    altSl.addEventListener("input", e=>{
      state.altitude = +e.target.value;
      if(altV) altV.textContent = state.altitude+" m";
      if(rhoV) rhoV.textContent = rhoAt(state.altitude).toFixed(4)+" kg/m³";
      calcCache = null; renderCalcChips(); renderLog(); renderAeroMini(); if(!simActive) refreshIdleTelemetry(); saveState();
    });
  }

  // designed airfoil + blade count (not catalog parts)
  const afc = $("airfoilCard"); if(afc) afc.addEventListener("click", ()=>openAirfoilPicker());
  const bc = $("bladeCount");
  if(bc){
    [].forEach.call(bc.querySelectorAll("button"), b=>{
      b.addEventListener("click", ()=>{
        state.blades = +b.dataset.b;
        refreshAfterSelection("blades"); instrEvent("select"); sfx("tick");
      });
    });
  }

  // cards / buttons
  const on = (id, fn, evt)=>{ const e = $(id); if(e) e.addEventListener(evt||"click", fn); };
  on("aeroCard", openCalcDetail);
  on("calcCard", openCalcDetail);
  on("graphCard", openGraphDetail);
  on("chartCard", openChartsDetail);
  on("logHead", ()=>{ const l = $("logList"); if(l) l.classList.toggle("hidden"); });
  on("runBtn", runSim);
  on("resetBtn", resetSim);
  on("modalClose", closeModal);
  const mo = $("modalOverlay");
  if(mo) mo.addEventListener("click", e=>{ if(e.target === mo) closeModal(); });
  document.addEventListener("keydown", e=>{ if(e.key==="Escape" && mo && !mo.hidden) closeModal(); });

  // instructor
  on("instrOrb", ()=>{ state.instrOpen = !state.instrOpen; saveState(); renderInstr(); if(state.instrOpen) playVoice(); });
  on("instrPrev", ()=>{ instrGo(state.instrStep-1); playVoice(); });
  on("instrNext", ()=>{ instrGo(state.instrStep+1); playVoice(); });
  on("instrReplay", replayVoice);
  const vVol = $("voiceVol"), vTxt = $("voiceVolTxt");
  if(vVol){ vVol.value = state.voiceVol; if(vTxt) vTxt.textContent = state.voiceVol;
    vVol.addEventListener("input", e=>{ state.voiceVol = +e.target.value; if(vTxt) vTxt.textContent = e.target.value;
      if(currentVoice) currentVoice.volume = Math.min(state.voiceVol/100,1); saveState(); });
    vVol.addEventListener("change", voiceBlip);
  }
  const sVol = $("sfxVol"), sTxt = $("sfxVolTxt");
  if(sVol){ sVol.value = state.sfxVol; if(sTxt) sTxt.textContent = state.sfxVol;
    sVol.addEventListener("input", e=>{ state.sfxVol = +e.target.value; if(sTxt) sTxt.textContent = e.target.value; setMasterVol(); saveState(); });
    sVol.addEventListener("change", ()=>sfx("tick"));
  }

  window.addEventListener("resize", resizeViewport);
  let _rzT = 0;
  window.addEventListener("resize", ()=>{ clearTimeout(_rzT); _rzT = setTimeout(()=>{ if(!ChartHub.reg["liveGraph"]) drawLiveGraph(); }, 120); });

  if(state.instrOpen) playVoice();
  let audioPrimed = false;
  const primeAudio = ()=>{
    if(audioPrimed) return; audioPrimed = true;
    try{ if(actx && actx.state === "suspended") actx.resume(); }catch(e){}
    if(state.instrOpen && (!currentVoice || currentVoice.paused)) playVoice();
  };
  window.addEventListener("pointerdown", primeAudio, { once:true });
  window.addEventListener("keydown", primeAudio, { once:true });

  bootProgress("ready", 1);
  hideBoot();
  requestAnimationFrame(loop);
  }catch(e){ console.error("BOOT ERROR:", e); bootProgress("boot error", 1); }
}
boot();
