/* ═══════════════════════════════════════════════════════════════════
   INTEGRATION CAPSTONE — overlay layer on the exp1 propulsion engine.
   Reuses main.js globals: state, opt, calc, diagnostics, massRows,
   propGeometry, propulsionParams, refreshAfterSelection, DRONE_DB.
   Adds: mission spec, payload, live loaded-metrics, verify + diagnosis
   naming the prior experiment behind each failed constraint.
   ═══════════════════════════════════════════════════════════════════ */
(function(){
  const G = 9.81;
  const MISSION = {
    title: "Cinematic Payload Lifter",
    desc: "Assemble a quadcopter that carries a stabilised camera payload and stays airborne long enough to capture the shot — without exceeding the airframe weight limit.",
    maxWeight_g: 3600,
    minFlight_min: 1.2,
    payload_g: 200,
    twrMin: 1.0,
    effMin: 1.5,          // advisory only
    needsPositioning: true,
    altitude_m: 300
  };
  const CAP = { payloadOn:false };
  const $ = id => document.getElementById(id);
  const elc = (t,c,h)=>{ const e=document.createElement(t); if(c)e.className=c; if(h!=null)e.innerHTML=h; return e; };

  /* ---- loaded-build metrics: extend exp1 calc() with the mission payload ---- */
  function loadedMetrics(){
    const c = calc();                                  // exp1 engine (unladen)
    const p = c.p;
    const baseTotal_g = massRows().total;              // frame+4×(motor+esc+prop)+batt+fc+rx+attach
    const pay = CAP.payloadOn ? MISSION.payload_g : 0;
    const total_g = baseTotal_g + pay;
    const mkgL = total_g/1000, WL = mkgL*G;
    const twL = WL>0 ? c.Tmax/WL : 0;
    const hoverThrL = twL>1 ? Math.sqrt(1/twL)*100 : 120;
    // hover power scales with thrust^1.5 (momentum); extend unladen hover draw
    const massRatio = c.mkg>0 ? mkgL/c.mkg : 1;
    const hoverI_L = c.hoverI * Math.pow(Math.max(massRatio,0.01), 1.5);
    const endurL = hoverI_L>0 ? (p.cap/1000*0.8)/hoverI_L*60 : 0;
    // ESC junction temperature at full-throttle phase current (I²R + Rth)
    const Iper = c.full.Iper||0;
    const Pesc = Iper*Iper*(p.rdsOn||0.002);
    const escRth = (opt("esc")&&opt("esc").phys&&opt("esc").phys.r_th_c_per_w)||14;
    const Tesc = 25 + Pesc*escRth;
    return { c, p, total_g, twL, hoverThrL, endurL, Tesc, gPerW:c.gPerW, Iper };
  }

  /* ---- constraint set → experiment mapping ---- */
  function evaluate(){
    const m = loadedMetrics();
    const geom = propGeometry();
    const hasFc = !!opt("controller");
    const hasRx = !!opt("reciever");
    const hasGps = selArr("attachments").includes("gps");
    const escA = (opt("esc")&&opt("esc").phys&&opt("esc").phys.current_a)||30;
    const recRange = (opt("chasis")&&opt("chasis").phys&&opt("chasis").phys.recommended_prop_in)||null;
    const propIn = (opt("propeller")&&opt("propeller").phys&&opt("propeller").phys.diameter_in)||5;
    const propFits = !geom.collide && (!recRange || (propIn>=Math.min(...recRange)-0.5 && propIn<=Math.max(...recRange)+0.5));
    const motorOk = m.c.full.Iper <= m.p.imax;
    const cellsOk = m.p.cells <= m.p.motorMaxCells && m.p.cells <= m.p.escMaxCells;

    return [
      { id:"mass",    label:"All-up weight ≤ "+MISSION.maxWeight_g+" g", ok:m.total_g<=MISSION.maxWeight_g, val:Math.round(m.total_g)+" g", exp:"Frame Structural Integrity" },
      { id:"twr",     label:"Loaded TWR ≥ "+MISSION.twrMin.toFixed(1), ok:m.twL>=MISSION.twrMin, val:m.twL.toFixed(2), exp:"Flight Performance" },
      { id:"payload", label:"Lifts "+MISSION.payload_g+" g payload", ok:(CAP.payloadOn && m.twL>=MISSION.twrMin), val:CAP.payloadOn?"loaded":"not loaded", exp:"TWR · Hover · Efficiency" },
      { id:"flight",  label:"Flight time ≥ "+MISSION.minFlight_min+" min", ok:m.endurL>=MISSION.minFlight_min, val:m.endurL.toFixed(1)+" min", exp:"Energy Storage System" },
      { id:"prop",    label:"Prop matches frame & motor", ok:propFits && motorOk, val:propIn+'"'+(recRange?" / "+recRange.join("–")+'"':""), exp:"Propulsion System Design", advisory:true },
      { id:"esc",     label:"ESC rated for phase current", ok:(escA>=m.c.full.Iper) && cellsOk, val:m.c.full.Iper.toFixed(0)+" A", exp:"Power Electronics (ESC)", advisory:true },
      { id:"thermal", label:"ESC temp ≤ 80 °C", ok:m.Tesc<=80, val:Math.round(m.Tesc)+" °C", exp:"Thermal Management", advisory:true },
      { id:"aero",    label:"Hover efficiency ≥ "+MISSION.effMin.toFixed(1)+" g/W", ok:m.gPerW>=MISSION.effMin, val:m.gPerW.toFixed(1)+" g/W", exp:"Aerodynamic Analysis", advisory:true },
      { id:"control", label:"Flight controller fitted", ok:hasFc, val:hasFc?"yes":"missing", exp:"Flight Control System" },
      { id:"nav",     label:MISSION.needsPositioning?"GPS + receiver fitted":"Receiver fitted", ok:(!MISSION.needsPositioning||hasGps)&&hasRx, val:(hasGps?"GPS ":"")+(hasRx?"RX":"—"), exp:"Navigation & Positioning" }
    ];
  }

  /* ---- build the capstone panels into exp1's left + right columns ---- */
  function buildMissionCard(){
    const left = $("secInputs"); if(!left) return;
    const card = elc("div","cap-mission");
    card.innerHTML =
      '<div class="cm-h">Mission Brief</div>'+
      '<h2>'+MISSION.title+'</h2>'+
      '<p class="cm-desc">'+MISSION.desc+'</p>'+
      '<div class="cap-reqs">'+
        '<div class="cap-req"><span class="rq-l">Max all-up weight</span><span class="rq-v">'+MISSION.maxWeight_g+' g</span></div>'+
        '<div class="cap-req"><span class="rq-l">Min flight time</span><span class="rq-v">'+MISSION.minFlight_min+' min</span></div>'+
        '<div class="cap-req rust"><span class="rq-l">Required payload</span><span class="rq-v">'+MISSION.payload_g+' g</span></div>'+
      '</div>'+
      '<div class="cap-env">env · '+MISSION.altitude_m+' m density altitude · positioning '+(MISSION.needsPositioning?'required':'optional')+'</div>'+
      '<label class="cap-pay"><input type="checkbox" id="capPay"> load the required '+MISSION.payload_g+' g payload</label>';
    // insert right after the header
    const header = $("headInputs");
    header.parentNode.insertBefore(card, header.nextSibling);
    $("capPay").addEventListener("change", e=>{ CAP.payloadOn = e.target.checked; update(); });
  }

  function buildOutputsPanel(){
    const right = $("secOutputs"); if(!right) return;
    // wipe exp1 outputs body (graphs/reward), keep the header
    [...right.children].forEach(ch=>{ if(!ch.classList.contains("head-outputs")) ch.remove(); });
    const wrap = elc("div","cap-out");
    wrap.innerHTML =
      '<div class="cap-metrics" id="capMetrics"></div>'+
      '<button class="cap-verify" id="capVerify" type="button">Verify Build ✓</button>'+
      '<div id="capVerdict"></div>'+
      '<div class="cap-checks" id="capChecks"></div>'+
      '<div class="cap-diag" id="capDiag" style="display:none"></div>';
    right.appendChild(wrap);
    $("capVerify").addEventListener("click", verify);
  }

  function metricRow(lab,val,frac,ok,target){
    const d = elc("div","cap-metric"+(ok===true?" ok":ok===false?" no":""));
    d.innerHTML = '<div class="cm-top"><span class="cm-lab">'+lab+'</span><span class="cm-val">'+val+'</span></div>'+
      '<div class="cm-bar"><div class="cm-fill" style="width:'+Math.max(2,Math.min(100,frac*100))+'%"></div></div>'+
      (target?'<div class="cm-t">'+target+'</div>':'');
    return d;
  }

  function update(){
    if(!$("capMetrics")) return;
    const m = loadedMetrics();
    const box = $("capMetrics"); box.innerHTML="";
    box.appendChild(metricRow("All-up weight", Math.round(m.total_g)+" g", m.total_g/MISSION.maxWeight_g, m.total_g<=MISSION.maxWeight_g, "limit "+MISSION.maxWeight_g+" g"));
    box.appendChild(metricRow("Thrust-to-weight", m.twL.toFixed(2), m.twL/4, m.twL>=MISSION.twrMin, "floor "+MISSION.twrMin.toFixed(1)));
    box.appendChild(metricRow("Hover throttle", m.hoverThrL.toFixed(0)+" %", m.hoverThrL/100, m.hoverThrL<=85, "reserve above"));
    box.appendChild(metricRow("Flight time", m.endurL.toFixed(1)+" min", m.endurL/(MISSION.minFlight_min*1.6), m.endurL>=MISSION.minFlight_min, "need "+MISSION.minFlight_min+" min"));
    box.appendChild(metricRow("ESC temp", Math.round(m.Tesc)+" °C", m.Tesc/100, m.Tesc<=80, "limit 80 °C"));
    box.appendChild(metricRow("Hover efficiency", m.gPerW.toFixed(1)+" g/W", m.gPerW/16, m.gPerW>=MISSION.effMin, "higher = longer"));
  }

  function verify(){
    const checks = evaluate();
    const failedHard = checks.filter(c=>!c.ok && !c.advisory);   // mission-critical
    const failedAdv  = checks.filter(c=>!c.ok && c.advisory);    // advisory (shown, non-blocking)
    const failed = failedHard;
    const pass = failedHard.length===0;
    const m = loadedMetrics();
    // verdict
    const v = $("capVerdict");
    v.className = "cap-verdict "+(pass?"pass":"fail");
    v.innerHTML = '<div class="vi">'+(pass?"✓":"✕")+'</div><div class="vt"><b>'+
      (pass?"Mission cleared — flight-verified":"Build rejected")+'</b><span>'+
      (pass? Math.round(m.total_g)+" g · TWR "+m.twL.toFixed(2)+" · "+m.endurL.toFixed(1)+" min"
           : failed.length+" constraint"+(failed.length>1?"s":"")+" not met")+'</span></div>';
    // checks (advisory fails render amber, not red)
    const cl = $("capChecks"); cl.innerHTML="";
    checks.forEach(c=>{ const cls = c.ok ? "ok" : (c.advisory ? "adv" : "no");
      const r=elc("div","cap-check "+cls);
      r.innerHTML='<span class="ck">'+(c.ok?"✓":(c.advisory?"!":"✕"))+'</span><span>'+c.label+(c.advisory&&!c.ok?' <em>· advisory</em>':'')+'</span><span class="ck-v">'+c.val+'</span>';
      cl.appendChild(r); });
    // diagnosis
    const dg = $("capDiag"); dg.style.display="block"; dg.className="cap-diag"+(pass?" pass":"");
    const advNames=[...new Set(failedAdv.map(c=>c.exp))];
    if(pass){
      dg.innerHTML='<div class="cd-h">'+(advNames.length?'Mission cleared — advisory notes':'All concepts applied')+'</div>'+
        (advNames.length
          ? advNames.map(n=>'<div class="cap-diag-item" style="border-color:rgba(217,147,43,.35);background:rgba(217,147,43,.06)"><span class="di" style="background:#c68a1e">!</span><span class="dn" style="color:#8a5b12">'+n+'</span></div>').join('')
            +'<div class="cd-note">The build flies and meets the mission. These are optimisation notes, not blockers — tighten them for a better drone.</div>'
          : '<div class="cap-diag-item" style="border-color:rgba(31,138,91,.3)"><span class="di" style="background:#1f8a5b">✓</span><span class="dn" style="color:#1f6a48">Nothing to revisit</span></div>');
    } else {
      const names=[...new Set(failed.map(c=>c.exp))];
      dg.innerHTML='<div class="cd-h">Revisit these experiments</div>'+
        names.map(n=>'<div class="cap-diag-item"><span class="di">!</span><span class="dn">'+n+'</span></div>').join('')+
        '<div class="cd-note">Only the concept you must re-learn is named. No shortcut is given — return and understand it.</div>';
    }
    v.scrollIntoView({behavior:"smooth",block:"nearest"});
  }

  /* ---- hook selection changes to refresh capstone metrics live ---- */
  function hookRefresh(){
    if(typeof refreshAfterSelection!=="function") return;
    const orig = refreshAfterSelection;
    refreshAfterSelection = function(k){ orig(k); update(); };
  }

  /* ---- wait for exp1 boot (DRONE_DB + tiles) then inject ---- */
  function ready(){ return typeof DRONE_DB!=="undefined" && DRONE_DB && document.getElementById("paramGrid") && document.getElementById("paramGrid").children.length; }
  function start(){
    if(!ready()){ return setTimeout(start,120); }
    // lock the viewport to the assembled-drone (Module-1 assembly) view
    try{ state.module="m1"; }catch(e){}
    document.title = "Integrated Drone Build — Capstone";
    const bt=document.querySelector(".boot-title"); if(bt) bt.textContent="INTEGRATED DRONE BUILD";
    const h=document.querySelector("#headInputs h1"); if(h) h.textContent="Build Bench";
    const ho=document.querySelector("#headOutputs h1"); if(ho) ho.textContent="Mission Verify";
    buildMissionCard();
    buildOutputsPanel();
    hookRefresh();
    update();
  }
  if(document.readyState==="complete"||document.readyState==="interactive") setTimeout(start,300);
  else window.addEventListener("DOMContentLoaded",()=>setTimeout(start,300));
})();
