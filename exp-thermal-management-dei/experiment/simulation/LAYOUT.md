# Drone Technology Lab — Layout & Architecture

Research-grade virtual drone laboratory. **Stack: HTML + CSS + vanilla JS only**
(libraries: three.js r128 with OrbitControls / GLTFLoader / FBXLoader).
Exactly three code files: `index.html`, `main.css`, `main.js`.

---

## 1 · Screen layout (desktop, 3-column grid)

```
┌───────────────┬──────────────────────────────┬───────────────┐
│ INPUT         │ 3D VIEWPORT (amber frame)    │ OUTPUTS       │
│ PARAMETERS    │  · Module 1 / Module 2 tabs  │  · Graphs     │
│  · 8 tiles    │  · experiment tabs           │    (live)     │
│    (3D        │  · live telemetry card       │  · Charts     │
│    previews)  │  · orbit / zoom              │    (side pair │
│  · Altitude   ├──────────────────────────────┤    on tablet/ │
│    slider     │ ▶ Run Sim · Reset · progress │    mobile)    │
│  · Mass       ├──────────────────────────────┼───────────────┤
│    Budget     │ Calculations (short strip)   │ COMPONENTS    │
│    card       │                              │ UNLOCKED      │
└───────────────┴──────────────────────────────┴───────────────┘
                                    ⬤ Instructor orb (bottom-right, navy)
```

- Every card with a `›` hint opens a **floating window** (modal): option
  picker, detailed mass budget, all-runs graphs, charts detail, full
  derivations.
- **Instructor** (navy panel): step-by-step guide, Back / Replay audio / Next,
  SPEAKER + SFX volume sliders. Auto-advances as the user performs each step.
- **Components Unlocked**: separate section under Outputs; reward model
  unlocks after all experiments in all modules are completed.

## 2 · Responsive behaviour

| Breakpoint | Behaviour |
|---|---|
| > 1180 px | 3 columns, side panels scroll independently |
| ≤ 1180 px | 2 columns; Outputs row spans full width, Graphs+Charts side by side |
| ≤ 820 px (mobile) | Single column, order: **Viewport → Run row → Input Parameters (horizontally slidable tiles) → Altitude → Mass Budget → Calculations → Outputs (Graphs+Charts side by side) → Components Unlocked**. Bottom tab bar (Viewport / Inputs / Outputs) scrolls to each section. |

## 3 · Color palette (light theme, "Aerospace")

| Token | Hex | Use |
|---|---|---|
| Navy primary | `#1f3a93` | selection, buttons, live graph, bars |
| Steel secondary | `#4f6d9e` | outputs accents, instructor panel |
| Rust accent | `#c65d3b` | viewport frame, calc/chart headers |
| Paper / panel | `#f4f6f5` / `#f7f9f8` | backgrounds |
| Ink | `#1e2a29` | text |

Fonts: IBM Plex Sans (UI) + IBM Plex Mono (numeric/telemetry).

## 4 · Data-driven component catalog (no code edits needed)

```
assets/
  manifest.json            ← categories, option folder lists, modules,
                              instructor script, reward
  chasis/<option>/spec.json + model.glb
  propeller/<option>/…
  motor/<option>/…         (multi-part models allowed: ["Stator.glb","rotar.glb"])
  esc/<option>/…
  battery/_model/Battery_Drone.fbx   ← ONE universal battery model
  battery/<option>/spec.json         ← options differ only in JSON (mAh/size/mass)
  controller/<option>/…
  reciever/<option>/…
  attachments/<option>/…   (multi-select category)
```

**To add an option:** drop a folder with a `spec.json` (+ model file) under its
category and add the folder name to that category's `options` array in
`assets/manifest.json`. Nothing in index.html / main.css / main.js changes.
**To remove:** delete the folder and its manifest entry. Saved selections that
point at removed options fall back automatically.

### spec.json schema
```json
{
  "name": "Diatone Mamba 55 A",
  "mass_g": 21,                  // accurate component mass (grams)
  "qty": 1,                      // units per drone (4 for motors/props, 1 for 4-in-1 ESC)
  "size_mm": [42, 42, 6],        // W × H × D
  "model": "file.glb",           // null → procedural placeholder; array → multi-part;
                                 // "assets/…" path → shared model (battery)
  "specs": { "Current": "55 A × 4", "Firmware": "BLHeli_32" },   // shown in picker
  "physics": { "...": "per-category parameters used by the simulation" }
}
```

Physics fields by category:
- **motor**: `kv`, `rm_ohm`, `i0_a`, `max_current_a`, `max_power_w`, `k_fe`
- **propeller**: `diameter_in`, `pitch_in`, `blades`, `ct`, `cq`, `mass_g_each`
- **battery**: `cells`, `voltage_nominal_v`, `capacity_mah`, `c_rating`, `cell_ir_mohm`
- **chasis**: `wheelbase_mm`, `frontal_area_m2`, `cd`, `arm_length_mm`, `recommended_prop_in`

## 5 · Physics model (Exp-1 propulsion, real-lab grade)

- `g = 9.80665 m/s²`; ISA density `ρ(h) = 1.225(1 − 2.25577·10⁻⁵h)^4.25588`
  driven by the altitude slider.
- Motor: `Ke = 60/(2π·Kv)` V·s/rad, `Kt = Ke`; `I = (V·δ − Ke·ω)/Rm` with
  no-load current `I0`.
- Propeller (UIUC convention, n rev/s): `T = Ct·ρ·n²·D⁴`, `Q = Cq·ρ·n²·D⁵`.
- Steady state solved by damped fixed-point iteration of the torque balance
  `Kt(I − I0) = Q`.
- Battery: LiPo OCV ≈ `(3.50 + 0.70·SoC)` V/cell; sag `V = OCV − I_total·R_pack`;
  80 % usable-capacity rule; 3.5 V/cell cutoff.
- Derived live: T/W, hover throttle (bisection), hover current, endurance,
  everything shown in the Calculations windows.

### Experiments
| Module | Experiment | Simulation |
|---|---|---|
| M1 Static Test Bench | Static Thrust | throttle staircase 0→100 %, total thrust (N) |
| M1 | Vibration Sweep | rpm sweep, vibration amplitude (g) |
| M2 Flight Chamber | Hover Test | vertical dynamics + P-D throttle controller to target altitude (m) |
| M2 | Endurance | time-accelerated hover discharge, pack voltage (V) to cutoff |

## 6 · Persistence (localStorage `dtl-v2`)

Component selections, altitude, module/experiment tabs, completed experiments,
run history (last 24 runs with curves), instructor step, volumes.

## 7 · Pending hooks

- **Instructor audio**: set `"audio": "assets/audio/step-N.mp3"` per step in
  `manifest.json → instructor[]`; the Replay button and SPEAKER slider already
  drive it.
- **Motor 1405 model**: folder has no GLB yet → renders the procedural
  placeholder until the file is added.
- Additional experiments: add to `manifest.json → modules[].experiments` with a
  `metric`, then extend `simStep()` in main.js §11.
