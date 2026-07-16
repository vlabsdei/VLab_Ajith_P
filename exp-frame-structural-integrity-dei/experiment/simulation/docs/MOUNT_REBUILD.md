# Mount Rebuild — full procedure & progress log

Goal: every chassis's `mounts.json` is rebuilt **from the real mesh geometry in
Blender** (raycast onto actual surfaces), and the web renderer seats each
component **base-on-mount**, so motors sit exactly ON the arm tops, ESCs on the
arms, FC/battery/receiver on the plates, gimbal hanging below the payload rail.

If you are resuming this work in a fresh session, read this whole file first.

---

## 1 · How the web app consumes mounts (contract)

`main.js → buildDroneFromMounts()`:

- Loads `assets/chasis/<id>/spec.json`; if it has a `"mounts"` key, fetches that
  `mounts.json` and seats every component at its mount (position + quaternion).
- Mount coordinates are **three.js right-handed Y-up, same units as the GLB
  mesh** (DARUKA frames are metres).
- The app rotates the chassis MESH so its thinnest bbox axis (or
  `spec.physics.native_up` override) points +Y — mounts are **not** rotated, so
  mounts must be authored in that **post-rotation** frame.
- Mesh + all mount anchors live in one `inner` group recentred by the mesh bbox
  centre, and scaled by `chSpan/maxDim` — mounts never need their own recentre.
- `LEVEL_MOUNTS` (motor/esc/flight_controller/battery/receiver) are reduced to
  pure yaw in the renderer as a safety net; camera/gps/payload keep authored tilt.
- **Seating rule (added in this rebuild):** mounts mark *surface points*.
  Renderer seats motor/esc/fc/battery/receiver/gps with their **base at the
  anchor** (`seatModel(g,'base')` / base-shift in `mountMotor`), and payload
  attachments (gimbal) **hang** below (`'hang'`). Cameras stay centred.

## 2 · Coordinate conversions (used by tools/rebuild_mounts.py)

| Direction | Formula |
|---|---|
| three → blender (position) | `bl = ( x, -z, y )` |
| blender → three (position) | `three = ( x, z, -y )` |
| three quat `[x,y,z,w]` yaw (YXZ euler y) | `yaw = atan2( 2(xz+wy), 1-2(x²+y²) )` |
| level yaw quat (three) | `[0, sin(yaw/2), 0, cos(yaw/2)]` |

Blender's glTF importer converts file-Y-up → blender-Z-up automatically. To make
blender world coords **numerically equal to the app's post-rotation frame**:

| app `native_up` of file | extra rotation to apply in Blender after import |
|---|---|
| `y` (no app rotation) | none |
| `z` (app does `rotation.x=-90°`) | rotate object **-90° about X** (blender) |
| `x` (app does `rotation.z=+90°`) | rotate object **-90° about Y** (blender) |

After that, `blender (x,y,z)` exports to the app frame as `(x, z, -y)` — the
standard DARUKA exporter mapping. Up = +Z in blender = +Y in the app.

## 3 · The rebuild script

`tools/rebuild_mounts.py` — run **inside Blender** (via blender-mcp
`execute_blender_code`, or Blender's Text Editor):

```python
import sys; sys.argv = ["rebuild_mounts.py", "<chassis_id>", "<mode>"]
exec(open("/Users/ajith/Downloads/Drone Technology Lab Platform/tools/rebuild_mounts.py").read())
```

Modes:
- `refine`  — keep each existing mount's XY + yaw, raycast the mesh to snap its
  height to the real surface (arm top for motor/esc, plate top for
  fc/battery/receiver/gps, underside for payload), level all quats to pure yaw
  (cameras untouched). Backs up the old file as `*.mounts.json.bak`.
- `author`  — build mounts from scratch (for a chassis with no mounts.json):
  radial arm detection → motor/esc points, plates by raycast, canonical DARUKA
  names/metadata. Also updates the chassis spec.json (adds `mounts`, fixes
  wheelbase/arm length from measured motor spacing).

The script prints a `REPORT` dict — paste it into §6 below.

## 4 · Renderer changes (main.js)

- `seatModel(g, mode)` — after a component GLB loads, shifts it so its base
  ("base") or top ("hang") sits at the mount anchor. Applied in
  `buildDroneFromMounts` for esc/fc/battery/receiver, attachments (gps=base,
  payload/gimbal=hang), and in `mountMotor` for the motor body.
- Bench (`placeBenchMotor`): motor group positioned at `standTopY` exactly
  (base-on-stand), no half-height offset.
- Cache-buster: **always bump `main.js?v=N` in index.html after editing main.js.**
- Catalog JSON (`manifest/spec/mounts`) is fetched `cache:"no-store"` — edits to
  those take effect on plain reload.

## 5 · Per-chassis inventory & status

| chassis id | GLB | mounts source | status |
|---|---|---|---|
| fpv5 | Body1_009.glb (native_up=z override in spec) | DARUKA authored → **refined** | ✅ rebuilt + verified |
| free7 | Freestyle_7.glb | DARUKA authored (had 90°-tilted motor mounts) → **refined** | ✅ rebuilt + verified |
| micro4 | Gladiator_5_DC_v26.glb (3.9 MB) | DARUKA authored → **refined** | ✅ rebuilt + verified |
| cine10 | Gladiator_5_DC_v26.glb (811 KB — actually the 10-inch mesh, misnamed) | 10_inch_Assem mounts → **refined against its own GLB** | ✅ rebuilt + verified |
| fpv_chasis_6_350gms | model.glb | **none — authored from scratch** | ✅ authored + verified |

Verification metric (browser, per chassis): for each motor, `motor bbox min Y −
chassis top surface Y at that XY` ≈ 0 mm; battery/FC/ESC base deltas likewise.
Snippet used is in §7.

## 6 · Run reports (paste script REPORT output here)

(filled in as each chassis is processed — see below)

## 7 · Browser verification snippet

Open http://localhost:8123 (server: `python3 -m http.server 8123 --directory
"/Users/ajith/Downloads/Drone Technology Lab Platform"`), then in the console:

```js
(async function(){
  state.sel.chasis='<id>'; state.module='m1'; state.exp.m1='assemble';
  buildScene(); await new Promise(r=>setTimeout(r,1800));
  const chMesh = rig.children[0].children[0].children.find(c=>c.type==='Group');
  const ray=new THREE.Raycaster(), down=new THREE.Vector3(0,-1,0);
  const u=3.0/((opt('chasis').phys||{}).wheelbase_mm||290);
  const rows=rigParts.motors.map((a,i)=>{
    a.updateWorldMatrix(true,true);
    const p=a.getWorldPosition(new THREE.Vector3());
    ray.set(new THREE.Vector3(p.x,p.y+2,p.z),down);
    const hits=ray.intersectObject(chMesh,true).filter(h=>!a.getObjectById(h.object.id));
    const topY=hits.length?hits[0].point.y:null;
    const mb=new THREE.Box3().setFromObject(a);
    return {motor:i, mountVsArmTop_mm: topY==null?null:+((p.y-topY)/u).toFixed(1)};
  });
  console.log(JSON.stringify(rows));
})()
```

Expect `mountVsArmTop_mm` ≈ 0 (±2 mm) for every motor.

## 8 · Resume instructions (fresh session / another account)

1. Start Blender with the blender-mcp addon connected (user does this).
2. Start the web server (launch config `drone-lab`, port 8123).
3. For any chassis whose status above isn't ✅: run the script per §3, then
   verify per §7, then update §5/§6.
4. If a chassis GLB is replaced later: re-run `refine` (or `author` if it has
   no mounts) — the script is idempotent.
5. Motor GLBs: two files `[stator.glb, rotar.glb]`; the app orients them by the
   stator→rotor axis and spins the rotor. Props seat on the measured rotor top.

## 9 · New mount schema migration (2026-07-10)

The five chassis were re-authored with a **new, simpler mount schema** and dropped
in under fresh filenames. Two independent breakages meant NONE of the new data was
being used (every chassis silently fell back to the raycast arm-detection heuristic
→ motors low/colliding, stators hidden, props floating, rotors static):

1. **Broken references.** Each `spec.json` still pointed at the old mount filename
   (e.g. `Body1_009.mounts.json` vs the real `Body1_009_mounts.json`; the `-2`
   dupes; `fpv_chasis_6` also pointed `model` at a non-existent `model.glb`). Fixed
   every `spec.json` `mounts`/`model` field to the actual file on disk.
2. **New schema.** `mounts.json` is now `{ frame:{name}, mounts:[ {name, type,
   mode:"point"|"region", position|center, normal, rotation(deg), direction,
   esc_type} ] }` — authored in the GLB's **raw/native frame** (up = the motor-normal
   axis; Z for all current chassis), NOT the old post-rotation DARUKA frame, and with
   `type` (not `mountType`), no `quaternion`, no `units`.

`buildDroneFromMounts` was rewritten to consume it:
- up-axis from `spec.physics.native_up` → dominant motor-normal axis → bbox-thinnest;
- BOTH the mesh and every mount position are rotated by the same up→+Y quaternion,
  then recentred + scaled by the mesh bbox (handles off-origin meshes like fpv6);
- component span is `(component_mm / chassis_mm) × meshMaxDim` → correct real-world
  ratios independent of the GLB's own units;
- `esc_type` selects the 4-in-1 stack mount (one board) vs the per-arm single mounts
  to match the selected ESC; region mounts use `center`.

Also fixed a latent **`seatModel` bug**: `Box3.setFromObject` only refreshes the
target's own subtree, so a stale parent world-scale made the base-shift compute at
scale 1 and then blow up when the real chassis scale propagated — floating the
battery/ESC/FC high above the frame. `seatModel` now force-updates the parent world
matrix first. (Motors were unaffected because `mountMotor` already called
`updateWorldMatrix` before seating.)

**Status:** all five chassis (fpv5, micro4, fpv_chasis_6_350gms, free7, cine10)
build correctly in the assembly view — motors seated base-on-arm, stators visible,
props flush on the rotor bell, rotors spinning with alternating direction.

## 10 · Assembly-fidelity pass (2026-07-10, round 2)

Follow-up fixes after visual review (main.js `?v=27`):

- **Lighting** (`initViewport`): the dark carbon/metal parts rendered as near-black
  silhouettes on the white page. Replaced the flat ambient+2-dir setup with a
  HemisphereLight (1.05) + ambient (.5) + key (1.35) + fill (.7) + back-rim (.55).
- **Motor orientation** (`orientMotorCombo`): now snaps the stator→rotor separation
  to its DOMINANT axis before aligning it to +Y. The 2806's asymmetric stator plate
  gave a tilted raw sep vector that tipped the whole motor; the clean 90° snap fixes
  it (the 2806's shaft is actually along +Z, not +Y).
- **Prop seating** (`rotorBellTopY` + `mountMotor`): the rotor GLB's bbox top is the
  thin output-shaft tip, so props floated well above the bell on 1405/1806/2806/3015.
  New helper finds the highest vertex whose radius from the spin axis is >0.4× the
  bell radius (excludes the shaft) → props now rest on the bell.
- **ESC alignment** (`placeMounts`, single-ESC branch): yaw each arm ESC to its
  radial heading (`-atan2(z,x)`) so it lies lengthwise along the arm, and
  `orientThinUp` so the board lies flat. 4-in-1 keeps the mount yaw.
- **Attachments** (`placeMounts` attach loop): GPS puck → `orientThinUp` + base-seat
  (was standing on edge); FPV/thermal cameras → `orientCameraForward` (lens = the
  authored +Y axis, aimed outward from frame centre with an 18° up-tilt); the two
  camera-type parts share the single `camera` mount, so the 2nd (thermal) is stacked
  just below and stays visible (was dropped entirely before); gimbal/payload still
  `hang`.

Verified: every chassis builds with 4 coplanar motors, props on the bell, 4 arm
ESCs (or the single 4-in-1 mount fpv6 ships), and all four attachments placed and
oriented; no console errors.
