"""Rebuild a chassis's mounts.json from its real mesh geometry, inside Blender.

Usage (Blender Python console / blender-mcp execute_blender_code):

    import sys; sys.argv = ["rebuild_mounts.py", "<chassis_id>", "<refine|author>"]
    exec(open("/Users/ajith/Downloads/Drone Technology Lab Platform/tools/rebuild_mounts.py").read())

Modes
  refine : keep each existing mount's XY + yaw; raycast the mesh to snap the
           height to the real surface (arm/plate TOP for motor/esc/fc/battery/
           receiver/gps, UNDERSIDE for payload); level every quaternion to pure
           yaw (cameras kept verbatim). Original file backed up as *.bak once.
  author : no mounts.json exists — detect the 4 arms radially, generate the
           full canonical mount set (Motor_FL.., ESC_.., FlightController,
           Battery, Receiver, GPS, Payload, Camera) from geometry, write
           mounts.json and update spec.json (mounts key + wheelbase).

Coordinate contract (see docs/MOUNT_REBUILD.md):
  - The web app uses mounts in the frame where the chassis mesh has been rotated
    so its `native_up` axis (spec override, else thinnest bbox axis of the FILE
    coords) points +Y (three.js).
  - Blender's glTF import converts file-Y-up -> blender-Z-up. Applying the extra
    rotation below makes blender world coords numerically equal to that app
    frame via the standard mapping  three = (x, z, -y).
       native_up == 'y' : no extra rotation
       native_up == 'z' : rotate -90 deg about blender X
       native_up == 'x' : rotate -90 deg about blender Y
"""
import bpy, json, math, os, sys
from mathutils import Vector, Matrix

ASSETS = "/Users/ajith/Downloads/Drone Technology Lab Platform/assets/chasis"

# metadata templates per mountType (from the DARUKA component defaults)
META = {
    "motor":             dict(componentCategory="propulsion", maximumDimensions=[32.0, 32.0, 42.0], maximumWeight=95.0,  compatibleMountPattern="M3 16x16 / 19x19",          voltage=25.2, current=45.0,  coolingRequirement="airflow"),
    "esc":               dict(componentCategory="propulsion", maximumDimensions=[30.0, 15.0, 8.0],  maximumWeight=12.0,  compatibleMountPattern="zip-tie / heatshrink / 20x20", voltage=25.2, current=55.0, coolingRequirement="airflow"),
    "flight_controller": dict(componentCategory="avionics",   maximumDimensions=[40.0, 40.0, 14.0], maximumWeight=15.0,  compatibleMountPattern="30.5x30.5 M3",               voltage=5.0,  current=2.0,   coolingRequirement="none"),
    "battery":           dict(componentCategory="power",      maximumDimensions=[140.0, 45.0, 38.0],maximumWeight=650.0, compatibleMountPattern="strap / tray",               voltage=22.2, current=120.0, coolingRequirement="airflow"),
    "camera":            dict(componentCategory="payload",    maximumDimensions=[22.0, 26.0, 26.0], maximumWeight=30.0,  compatibleMountPattern="19mm / 20mm cage",           voltage=5.0,  current=0.6,   coolingRequirement="none"),
    "gps":               dict(componentCategory="avionics",   maximumDimensions=[35.0, 35.0, 12.0], maximumWeight=25.0,  compatibleMountPattern="adhesive / M2",              voltage=5.0,  current=0.2,   coolingRequirement="none"),
    "payload":           dict(componentCategory="payload",    maximumDimensions=[120.0, 120.0, 80.0],maximumWeight=800.0,compatibleMountPattern="rail / M3 grid",             voltage=12.0, current=5.0,   coolingRequirement="airflow"),
    "receiver":          dict(componentCategory="avionics",   maximumDimensions=[22.0, 14.0, 6.0],  maximumWeight=5.0,   compatibleMountPattern="adhesive / heatshrink",      voltage=5.0,  current=0.1,   coolingRequirement="none"),
}

# ---------------------------------------------------------------- conversions
def three_to_bl(p):  return Vector((p[0], -p[2], p[1]))
def bl_to_three(v):  return [round(v.x, 8), round(v.z, 8), round(-v.y, 8)]

def yaw_from_three_quat(q):
    """three.js YXZ euler .y from quat [x,y,z,w]; 0 near gimbal lock."""
    x, y, z, w = q
    m13 = 2 * (x * z + w * y); m33 = 1 - 2 * (x * x + y * y)
    m23 = 2 * (y * z - w * x)
    if abs(m23) > 0.99999:
        return 0.0
    return math.atan2(m13, m33)

def yaw_quat_three(t):
    return [0.0, round(math.sin(t / 2), 8), 0.0, round(math.cos(t / 2), 8)]

# ---------------------------------------------------------------- scene setup
def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for x in list(coll):
            if x.users == 0:
                coll.remove(x)

def import_chassis(chassis_id):
    base = os.path.join(ASSETS, chassis_id)
    spec = json.load(open(os.path.join(base, "spec.json")))
    glb = spec["model"] if isinstance(spec["model"], str) else spec["model"][0]
    glb_path = glb if os.path.isabs(glb) else os.path.join(base, os.path.basename(glb))
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=glb_path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    if not meshes:
        raise RuntimeError("no meshes imported from " + glb_path)
    bpy.context.view_layer.update()
    # combined blender bbox
    mn = Vector((1e18,) * 3); mx = Vector((-1e18,) * 3)
    for o in meshes:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mn = Vector(map(min, mn, w)); mx = Vector(map(max, mx, w))
    dims_bl = mx - mn
    # FILE-coordinate dims as the app sees them: (sx, sy, sz)_file = (x, z, y)_bl
    dims_f = (dims_bl.x, dims_bl.z, dims_bl.y)
    up = (spec.get("physics") or {}).get("native_up")
    if not up:
        up = "xyz"[dims_f.index(min(dims_f))]
        up = {"x": "x", "y": "y", "z": "z"}[up]
    R = Matrix.Identity(4)
    if up == "z":
        R = Matrix.Rotation(-math.pi / 2, 4, "X")
    elif up == "x":
        R = Matrix.Rotation(-math.pi / 2, 4, "Y")
    roots = [o for o in new if o.parent is None or o.parent not in new]
    for o in roots:
        o.matrix_world = R @ o.matrix_world
    bpy.context.view_layer.update()
    # recompute bbox in the corrected (app-equivalent) frame
    mn = Vector((1e18,) * 3); mx = Vector((-1e18,) * 3)
    for o in meshes:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mn = Vector(map(min, mn, w)); mx = Vector(map(max, mx, w))
    return spec, base, meshes, mn, mx, up, dims_f

# ---------------------------------------------------------------- raycasting
def _cast(origin, direction, dist):
    dg = bpy.context.evaluated_depsgraph_get()
    res = bpy.context.scene.ray_cast(dg, origin, direction, distance=dist)
    return res  # (hit, location, normal, index, object, matrix)

def surface_z(x, y, mn, mx, mode="top", spread=None):
    """Raycast the mesh at (x,y): 'top' -> highest downward hit; 'bottom' ->
    lowest upward hit. Samples a centre point plus two rings of 8, so a bolt/
    shaft hole at the exact point doesn't produce a miss."""
    span = max((mx - mn).length, 1e-6)
    s = spread if spread is not None else span * 0.012
    offs = [(0.0, 0.0)]
    for ring in (s, s * 2.0):
        for k in range(8):
            a = k * math.pi / 4
            offs.append((ring * math.cos(a), ring * math.sin(a)))
    zs = []
    for dx, dy in offs:
        if mode == "top":
            r = _cast(Vector((x + dx, y + dy, mx.z + span)), Vector((0, 0, -1)), span * 3)
        else:
            r = _cast(Vector((x + dx, y + dy, mn.z - span)), Vector((0, 0, 1)), span * 3)
        if r[0]:
            zs.append(r[1].z)
    if not zs:
        return None
    return max(zs) if mode == "top" else min(zs)

def surface_z_walk(x, y, mn, mx, mode="top", toward=None, max_frac=0.18):
    """surface_z, walking toward `toward` (XY) in small steps on a miss — for
    motor mounts whose centre hangs over the arm-tip edge or shaft hole."""
    z = surface_z(x, y, mn, mx, mode)
    if z is not None or toward is None:
        return z
    span = max((mx - mn).length, 1e-6)
    d = Vector((toward[0] - x, toward[1] - y, 0.0))
    if d.length < 1e-9:
        return None
    d.normalize()
    step = span * 0.015
    for i in range(1, int(max_frac * span / step) + 1):
        z = surface_z(x + d.x * step * i, y + d.y * step * i, mn, mx, mode)
        if z is not None:
            return z
    return None

# ---------------------------------------------------------------- refine mode
def refine(chassis_id):
    spec, base, meshes, mn, mx, up, dims_f = (None,) * 7
    clear_scene()
    spec, base, meshes, mn, mx, up, dims_f = import_chassis(chassis_id)
    mounts_rel = spec.get("mounts")
    if not mounts_rel:
        raise RuntimeError(chassis_id + " has no mounts entry in spec.json — use author mode")
    mpath = os.path.join(base, os.path.basename(mounts_rel))
    data = json.load(open(mpath))
    bak = mpath + ".bak"
    if not os.path.exists(bak):
        json.dump(data, open(bak, "w"), indent=2)
    report = {"chassis": chassis_id, "mode": "refine", "native_up": up,
              "dims_file": [round(d, 4) for d in dims_f], "mounts": [], "nohit": []}
    motors = []
    for m in data["mounts"]:
        kind = m["mountType"]
        if kind == "camera":
            report["mounts"].append({"name": m["name"], "kept": "verbatim"})
            continue
        p = three_to_bl(m["position"])          # blender coords in app frame
        mode = "bottom" if kind == "payload" else "top"
        centre = ((mn.x + mx.x) / 2, (mn.y + mx.y) / 2)
        z = surface_z_walk(p.x, p.y, mn, mx, mode,
                           toward=centre if kind in ("motor", "esc") else None)
        old_z = p.z
        if z is None:
            report["nohit"].append(m["name"])
        else:
            p.z = z
        yaw = yaw_from_three_quat(m["quaternion"])
        m["position"] = bl_to_three(p)
        m["quaternion"] = yaw_quat_three(yaw)
        m["orientation"] = [0.0, 1.0, 0.0]
        m["scale"] = [1.0, 1.0, 1.0]
        report["mounts"].append({"name": m["name"], "dz": round((p.z - old_z), 5)})
        if kind == "motor":
            motors.append(p.copy())
    json.dump(data, open(mpath, "w"), indent=2)
    _update_spec_wheelbase(spec, base, motors, mn, mx, report)
    report["written"] = mpath
    return report

# ---------------------------------------------------------------- author mode
def author(chassis_id):
    clear_scene()
    spec, base, meshes, mn, mx, up, dims_f = import_chassis(chassis_id)
    span = max((mx - mn).length, 1e-6)
    cx, cy = (mn.x + mx.x) / 2, (mn.y + mx.y) / 2
    # radial arm detection on sampled world vertices
    NB = 720
    rmax = [0.0] * NB
    for o in meshes:
        mwd = o.matrix_world
        vs = o.data.vertices
        step = max(1, len(vs) // 20000)
        for i in range(0, len(vs), step):
            w = mwd @ vs[i].co
            dx, dy = w.x - cx, w.y - cy
            r = math.hypot(dx, dy)
            b = int((math.atan2(dy, dx) % (2 * math.pi)) / (2 * math.pi) * NB) % NB
            if r > rmax[b]:
                rmax[b] = r
    gmax = max(rmax)
    thr = 0.78 * gmax
    # contiguous clusters over threshold (wrap-around)
    clusters = []
    i = 0
    while i < NB:
        if rmax[i] > thr:
            j = i
            while j < NB and rmax[j] > thr:
                j += 1
            clusters.append((i, j - 1))
            i = j
        else:
            i += 1
    if clusters and clusters[0][0] == 0 and clusters[-1][1] == NB - 1 and len(clusters) > 1:
        a = clusters.pop(); b = clusters.pop(0)
        clusters.append((a[0], b[1] + NB))
    def cluster_peak(c):
        lo, hi = c
        best, bb = -1, lo
        for k in range(lo, hi + 1):
            if rmax[k % NB] > best:
                best, bb = rmax[k % NB], k
        return (bb % NB) / NB * 2 * math.pi, best
    peaks = sorted((cluster_peak(c) for c in clusters), key=lambda t: -t[1])[:4]
    if len(peaks) < 4:
        raise RuntimeError("arm detection found only %d arms" % len(peaks))
    peaks.sort(key=lambda t: t[0])
    arms = []
    for ang, r in peaks:
        d = Vector((math.cos(ang), math.sin(ang), 0))
        # walk inboard from 90% of tip radius until the raycast hits the arm
        hit = None; f = 0.90
        while f > 0.55 and hit is None:
            px, py = cx + d.x * r * f, cy + d.y * r * f
            hit = surface_z(px, py, mn, mx, "top")
            if hit is None:
                f -= 0.03
        if hit is None:
            raise RuntimeError("no arm surface found along %.0f deg" % math.degrees(ang))
        arms.append({"dir": d, "r": r * f, "motor": Vector((cx + d.x * r * f, cy + d.y * r * f, hit))})
    # canonical quad names: F = three.z>0 = blender y<0 ; L = three.x>0 = blender x>0
    def code(v):
        return ("F" if (v.y - cy) < 0 else "R") + ("L" if (v.x - cx) > 0 else "R")
    used = {}
    entries = []
    def add(name, kind, pos_bl, yaw=0.0, quat=None):
        e = dict(name=name, mountType=kind, **META[kind])
        e["position"] = bl_to_three(pos_bl)
        e["quaternion"] = quat if quat else yaw_quat_three(yaw)
        e["scale"] = [1.0, 1.0, 1.0]
        e["orientation"] = [0.0, 1.0, 0.0]
        e["confidence"] = 0.95
        e["evidence"] = ["rebuild_mounts.py geometric authoring"]
        e["armIndex"] = -1
        entries.append(e)
        return e
    for a in arms:
        c = code(a["motor"])
        if c in used:  # degenerate classification — fall back to numbering
            c = "%d" % (len(used) + 1)
        used[c] = True
        yaw = math.atan2(a["dir"].x, -a["dir"].y)   # heading in three coords
        add("Motor_" + c, "motor", a["motor"], yaw)
        ex, ey = cx + a["dir"].x * a["r"] * 0.5, cy + a["dir"].y * a["r"] * 0.5
        ez = surface_z(ex, ey, mn, mx, "top")
        if ez is not None:
            add("ESC_" + c, "esc", Vector((ex, ey, ez)), yaw)
    front = Vector((0, -1, 0))                      # three +Z
    R = sum(a["r"] for a in arms) / 4
    # The frame's MAIN top plate: sample a central grid and take the median top
    # height — a single centre ray can land on a tall arch/pod and float parts.
    grid = []
    for gx in range(-2, 3):
        for gy in range(-2, 3):
            px, py = cx + gx * 0.12 * R, cy + gy * 0.12 * R
            z = surface_z(px, py, mn, mx, "top")
            if z is not None:
                grid.append((z, px, py))
    grid.sort()
    plate_z = grid[len(grid) // 2][0] if grid else None
    tol = span * 0.03
    def plate(name, kind, off, mode="top"):
        px, py = cx + front.x * R * off, cy + front.y * R * off
        z = surface_z(px, py, mn, mx, mode)
        if mode == "top" and plate_z is not None and (z is None or z > plate_z + tol):
            # target sits on a tall structure (or a hole) — use the nearest grid
            # cell that lies on the dominant plate instead
            best = None
            for gz, gx, gy in grid:
                if abs(gz - plate_z) <= tol:
                    d = (gx - px) ** 2 + (gy - py) ** 2
                    if best is None or d < best[0]:
                        best = (d, gx, gy, gz)
            if best:
                px, py, z = best[1], best[2], best[3]
        if z is None and mode == "bottom":
            z = surface_z(cx, cy, mn, mx, mode); px, py = cx, cy
        if z is not None:
            add(name, kind, Vector((px, py, z)))
    plate("FlightController", "flight_controller", 0.18)
    plate("Battery", "battery", 0.0)
    plate("Receiver", "receiver", -0.30)
    plate("GPS", "gps", -0.15)
    plate("Payload", "payload", 0.0, "bottom")
    camz = surface_z(cx + front.x * R * 0.5, cy + front.y * R * 0.5, mn, mx, "top")
    if camz is not None:
        add("Camera", "camera", Vector((cx + front.x * R * 0.5, cy + front.y * R * 0.5, camz)),
            quat=[0.70710678, 0.0, 0.0, 0.70710678])   # up -> forward (+Z three)
    entries.sort(key=lambda e: e["name"])
    out = {
        "format": "daruka.mounts", "formatVersion": "1.0",
        "generator": "rebuild_mounts.py (geometric authoring)",
        "coordinateSystem": "three.js (right-handed, Y-up)",
        "units": {1000.0: "meters", 10.0: "centimeters", 1.0: "millimeters"}[mesh_units_to_mm(span)],
        "frame": chassis_id, "mountCount": len(entries), "mounts": entries,
    }
    mpath = os.path.join(base, "model.mounts.json")
    json.dump(out, open(mpath, "w"), indent=2)
    spec["mounts"] = os.path.basename(mpath)
    report = {"chassis": chassis_id, "mode": "author", "native_up": up,
              "dims_file": [round(d, 4) for d in dims_f],
              "arms_deg": [round(math.degrees(math.atan2(a["dir"].y, a["dir"].x)), 1) for a in arms],
              "mounts": [e["name"] for e in entries], "written": mpath}
    motors = [a["motor"] for a in arms]
    _update_spec_wheelbase(spec, base, motors, mn, mx, report)
    return report

def mesh_units_to_mm(span):
    """Infer the mesh's linear unit from its bbox diagonal: a drone frame is
    0.15–0.7 m, so span<10 => metres, span<100 => centimetres, else mm."""
    return 1000.0 if span < 10 else (10.0 if span < 100 else 1.0)

def _update_spec_wheelbase(spec, base, motors, mn, mx, report):
    if len(motors) == 4:
        span = max((mx - mn).length, 1e-6)
        to_mm = mesh_units_to_mm(span)
        diag = max((motors[i] - motors[j]).xy.length
                   for i in range(4) for j in range(i + 1, 4)) * to_mm
        cx = sum(m.x for m in motors) / 4; cy = sum(m.y for m in motors) / 4
        arm = sum(math.hypot(m.x - cx, m.y - cy) for m in motors) / 4 * to_mm
        phys = spec.setdefault("physics", {})
        old = phys.get("wheelbase_mm")
        phys["wheelbase_mm"] = round(diag)
        phys["arm_length_mm"] = round(arm)
        spec.setdefault("specs", {})["Wheelbase"] = "%d mm" % round(diag)
        report["wheelbase_mm"] = {"old": old, "new": round(diag)}
        json.dump(spec, open(os.path.join(base, "spec.json"), "w"), indent=2)

# ---------------------------------------------------------------- entry point
if __name__ == "__main__" or True:
    _cid = sys.argv[1] if len(sys.argv) > 1 else None
    _mode = sys.argv[2] if len(sys.argv) > 2 else "refine"
    if _cid:
        REPORT = refine(_cid) if _mode == "refine" else author(_cid)
        print("REPORT =", json.dumps(REPORT, indent=1))
