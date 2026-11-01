"""The city kit (D19): every building, ground tile and prop a city draws, built by script in Blender.

Run:  blender -b -P scripts/models/city.py -- <out.glb> [<preview.png>]

Each piece is a root node named `P_<piece>` standing on its own origin: base at height 0, a footprint about
one unit across (hex tiles: corner radius 1), front towards -Y in Blender (+Z in three.js). The web code
places, scales and tints the pieces from the data; within a piece the meshes are joined per material.

Materials (the web code tints the ones marked *):
  Hull, Panel, Dark, Metal, Glass — fixed surfaces
  Accent*  — glowing trim: product kind, kind of work or faction colour
  Light    — fixed warm white lamps and windows
  Ground*  — the planet's own ground colour (wild tiles)
"""
import math
import sys

import bmesh
import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if not argv:
    raise SystemExit("usage: blender -b -P city.py -- out.glb [preview.png]")
OUT = argv[0]
PREVIEW = argv[1] if len(argv) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
TAU = math.tau


def material(name, rgb, metal=0.3, rough=0.4, emit=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*rgb, 1)
    p.inputs["Metallic"].default_value = metal
    p.inputs["Roughness"].default_value = rough
    if emit:
        p.inputs["Emission Color"].default_value = (*rgb, 1)
        p.inputs["Emission Strength"].default_value = emit
    return m


MAT = {
    "Hull": material("Hull", (0.80, 0.83, 0.88), 0.25, 0.38),
    "Panel": material("Panel", (0.42, 0.46, 0.53), 0.45, 0.42),
    "Dark": material("Dark", (0.09, 0.10, 0.13), 0.55, 0.4),
    "Metal": material("Metal", (0.62, 0.65, 0.70), 0.85, 0.28),
    "Glass": material("Glass", (0.03, 0.05, 0.08), 0.3, 0.08),
    "Accent": material("Accent", (0.35, 0.8, 1.0), 0.0, 0.3, 3.0),
    "Light": material("Light", (1.0, 0.86, 0.62), 0.0, 0.3, 3.0),
    "Ground": material("Ground", (0.45, 0.40, 0.36), 0.0, 0.9),
}

# ---- primitives --------------------------------------------------------------------------------------------
_made: list = []


def finish(o, mat, bevel=0.0, segments=3, smooth=True):
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if bevel:
        m = o.modifiers.new("bevel", "BEVEL")
        m.width = bevel
        m.segments = segments
        m.limit_method = "ANGLE"
        bpy.ops.object.modifier_apply(modifier=m.name)
    if smooth:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35))
    o.data.materials.clear()
    o.data.materials.append(MAT[mat])
    o.select_set(False)
    _made.append(o)
    return o


def box(size, loc, mat, bevel=0.0, rot=(0, 0, 0), segments=3):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.scale = size
    return finish(o, mat, bevel, segments)


def cyl(r, depth, loc, mat, rot=(0, 0, 0), verts=32, bevel=0.0, r2=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2, depth=depth, location=loc, rotation=rot)
    return finish(bpy.context.active_object, mat, bevel, smooth=verts > 8)


def ball(r, loc, mat, scale=(1, 1, 1), segs=24):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=segs // 2, radius=r, location=loc)
    o = bpy.context.active_object
    o.scale = scale
    return finish(o, mat)


def dome(r, loc, mat, segs=32):
    """a half sphere standing on its flat side"""
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=segs // 2, radius=r, location=loc)
    o = bpy.context.active_object
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -1e-4], context="VERTS")
    bm.to_mesh(o.data)
    bm.free()
    return finish(o, mat)


def torus(R, r, loc, mat, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=48, minor_segments=10, location=loc, rotation=rot)
    return finish(bpy.context.active_object, mat)


def hexprism(R, h, z0, mat, bevel=0.0):
    """a hexagonal prism, corners towards ±Y (pointy-top in the town's hex grid), from z0 up h"""
    me = bpy.data.meshes.new("hex")
    bm = bmesh.new()
    ring = [(R * math.cos(math.radians(90 + 60 * k)), R * math.sin(math.radians(90 + 60 * k))) for k in range(6)]
    bot = [bm.verts.new((x, y, z0)) for x, y in ring]
    top = [bm.verts.new((x, y, z0 + h)) for x, y in ring]
    bm.faces.new(list(reversed(bot)))
    bm.faces.new(top)
    for k in range(6):
        bm.faces.new([bot[k], bot[(k + 1) % 6], top[(k + 1) % 6], top[k]])
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new("hex", me)
    bpy.context.scene.collection.objects.link(o)
    return finish(o, mat, bevel, smooth=False)


# ---- pieces --------------------------------------------------------------------------------------------------
PIECES: dict = {}


def piece(name):
    def wrap(fn):
        PIECES[name] = fn
        return fn
    return wrap


def window_bands(w, d, z0, z1, n, mat="Accent", inset=0.006):
    """glowing bands around a box body, n floors between z0 and z1"""
    for i in range(n):
        z = z0 + (z1 - z0) * (i + 0.6) / n
        box((w + inset * 2, d + inset * 2, 0.022), (0, 0, z), mat)


def roof_kit(w, d, z, seed):
    """roof clutter: vents, an AC unit, an antenna — different per seed"""
    box((w * 0.32, d * 0.26, 0.05), (-w * 0.18, d * 0.12, z + 0.025), "Panel", bevel=0.008)
    for i in range(2 + seed % 2):
        cyl(0.03, 0.05, (w * 0.18, -d * 0.2 + i * 0.07, z + 0.025), "Dark", verts=12)
    if seed % 3 != 1:
        cyl(0.006, 0.18, (w * 0.3, d * 0.28, z + 0.09), "Dark", verts=6)
        ball(0.014, (w * 0.3, d * 0.28, z + 0.18), "Light", segs=10)


def house(h, floors, seed):
    w, d = 0.82, 0.82
    box((w + 0.06, d + 0.06, 0.06), (0, 0, 0.03), "Dark", bevel=0.012)
    box((w, d, h), (0, 0, 0.06 + h / 2), "Hull", bevel=0.03)
    # vertical ribs on the corners
    for sx in (-1, 1):
        for sy in (-1, 1):
            box((0.05, 0.05, h + 0.02), (sx * (w / 2 - 0.01), sy * (d / 2 - 0.01), 0.06 + h / 2), "Panel", bevel=0.01)
    window_bands(w, d, 0.1, 0.06 + h - 0.08, floors)
    # a glass front with a door
    box((w * 0.5, 0.012, h * 0.62), (0, -d / 2 - 0.004, 0.06 + h * 0.36), "Glass", bevel=0.006)
    box((w * 0.18, 0.02, 0.16), (0, -d / 2 - 0.01, 0.14), "Light")
    top = 0.06 + h
    box((w * 0.92, d * 0.92, 0.035), (0, 0, top + 0.017), "Panel", bevel=0.008)
    roof_kit(w, d, top + 0.035, seed)


@piece("house_s")
def _():
    house(0.62, 2, 0)


@piece("house_m")
def _():
    house(0.95, 3, 1)


@piece("house_l")
def _():
    # a tower with a set-back upper tier
    house(1.05, 3, 2)
    z = 0.06 + 1.05 + 0.035
    box((0.56, 0.56, 0.62), (0, 0, z + 0.31), "Hull", bevel=0.025)
    window_bands(0.56, 0.56, z + 0.04, z + 0.56, 2)
    box((0.6, 0.6, 0.03), (0, 0, z + 0.635), "Panel", bevel=0.006)
    cyl(0.007, 0.28, (0.15, 0.12, z + 0.79), "Dark", verts=6)
    ball(0.016, (0.15, 0.12, z + 0.93), "Light", segs=10)


@piece("tent")
def _():
    # an investigation: a radar dome on a hex base, with a dish
    hexprism(0.5, 0.08, 0, "Dark", bevel=0.01)
    torus(0.38, 0.018, (0, 0, 0.09), "Accent")
    dome(0.36, (0, 0, 0.08), "Hull")
    cyl(0.012, 0.16, (0.0, 0.0, 0.5), "Dark", verts=8)
    o = cyl(0.11, 0.03, (0.0, -0.03, 0.6), "Metal", rot=(math.radians(55), 0, 0), verts=24, r2=0.04)
    ball(0.016, (0, -0.07, 0.64), "Accent", segs=10)


def tower_base(r=0.42, h=0.55):
    """the shared body of a work building: plinth, round body with two glowing rings, cap"""
    cyl(r + 0.06, 0.06, (0, 0, 0.03), "Dark", verts=40)
    cyl(r, h, (0, 0, 0.06 + h / 2), "Hull", verts=40)
    for k, z in enumerate((0.06 + h * 0.3, 0.06 + h * 0.78)):
        cyl(r + 0.012, 0.03, (0, 0, z), "Accent", verts=40)
    # a door and a little canopy
    box((0.14, 0.03, 0.18), (0, -r + 0.004, 0.15), "Light")
    box((0.22, 0.09, 0.02), (0, -r - 0.03, 0.255), "Panel")
    cyl(r + 0.02, 0.05, (0, 0, 0.06 + h + 0.025), "Panel", verts=40)
    return 0.06 + h + 0.05


@piece("work_scout")  # 读代码: a scanner telescope
def _():
    z = tower_base()
    cyl(0.18, 0.12, (0, 0, z + 0.06), "Dark", verts=24)
    cyl(0.13, 0.42, (0, 0.05, z + 0.3), "Metal", rot=(math.radians(-35), 0, 0), verts=24)
    cyl(0.135, 0.02, (0, 0.17, z + 0.47), "Accent", rot=(math.radians(-35), 0, 0), verts=24)
    cyl(0.11, 0.01, (0, 0.18, z + 0.48), "Glass", rot=(math.radians(-35), 0, 0), verts=24)


@piece("work_smith")  # 改代码: a crane arm with a glowing tool
def _():
    z = tower_base()
    cyl(0.07, 0.1, (0, 0, z + 0.05), "Dark", verts=16)
    box((0.06, 0.06, 0.4), (0, 0, z + 0.3), "Metal", bevel=0.01)
    box((0.42, 0.05, 0.05), (0.15, 0, z + 0.5), "Metal", bevel=0.01)
    box((0.05, 0.05, 0.16), (0.34, 0, z + 0.42), "Dark")
    ball(0.035, (0.34, 0, z + 0.33), "Accent", segs=12)
    box((0.12, 0.08, 0.08), (-0.1, 0, z + 0.5), "Dark", bevel=0.01)


@piece("work_engineer")  # 跑命令: a reactor with stacks
def _():
    z = tower_base(h=0.45)
    cyl(0.26, 0.26, (0, 0, z + 0.13), "Glass", verts=32)
    for k in range(3):
        cyl(0.27, 0.025, (0, 0, z + 0.04 + k * 0.09), "Accent", verts=32)
    cyl(0.29, 0.03, (0, 0, z + 0.275), "Panel", verts=32)
    for x in (-0.14, 0.14):
        cyl(0.045, 0.3, (x, 0.12, z + 0.43), "Dark", verts=16)
        cyl(0.05, 0.02, (x, 0.12, z + 0.58), "Accent", verts=16)


@piece("work_inspector")  # 测试: ring gates around a slim tower
def _():
    z = tower_base(r=0.36, h=0.7)
    cyl(0.12, 0.3, (0, 0, z + 0.15), "Hull", verts=24)
    for k, t in enumerate((0.25, 0.55, 0.85)):
        torus(0.5 - k * 0.04, 0.018, (0, 0, 0.06 + 0.7 * t), "Accent", rot=(0, 0, 0))
    box((0.16, 0.16, 0.06), (0, 0, z + 0.33), "Dark", bevel=0.01)
    for sx in (-1, 1):
        box((0.03, 0.03, 0.03), (sx * 0.05, -0.08, z + 0.33), "Light")


@piece("work_messenger")  # 联网: an antenna mast with dishes
def _():
    z = tower_base(h=0.45)
    for k in range(4):
        a = k * TAU / 4
        box((0.02, 0.02, 0.7), (math.cos(a) * 0.08, math.sin(a) * 0.08, z + 0.35), "Metal")
    for k in range(4):
        box((0.2, 0.2, 0.015), (0, 0, z + 0.12 + k * 0.17), "Dark")
    o = cyl(0.14, 0.03, (0.13, -0.05, z + 0.45), "Hull", rot=(0, math.radians(70), math.radians(-20)), verts=24, r2=0.05)
    o = cyl(0.1, 0.03, (-0.12, 0.06, z + 0.28), "Hull", rot=(0, math.radians(-65), math.radians(30)), verts=24, r2=0.04)
    ball(0.025, (0, 0, z + 0.74), "Accent", segs=12)


@piece("work_diplomat")  # 外部工具: a docking pad with a shuttle
def _():
    z = tower_base(h=0.42)
    cyl(0.48, 0.04, (0, 0, z + 0.02), "Panel", verts=40)
    torus(0.42, 0.012, (0, 0, z + 0.045), "Accent")
    for k in range(6):
        a = k * TAU / 6
        cyl(0.02, 0.012, (math.cos(a) * 0.36, math.sin(a) * 0.36, z + 0.046), "Light", verts=10)
    ball(0.12, (0, 0, z + 0.13), "Hull", scale=(1, 1.9, 0.6))
    box((0.36, 0.08, 0.015), (0, 0.05, z + 0.12), "Dark")
    ball(0.05, (0, -0.17, z + 0.15), "Glass", scale=(1, 1, 0.7), segs=12)


@piece("work_scribe")  # 计划: a holo-table
def _():
    z = tower_base(h=0.5)
    cyl(0.4, 0.06, (0, 0, z + 0.03), "Dark", verts=40)
    cyl(0.32, 0.01, (0, 0, z + 0.065), "Accent", verts=40)
    for k in range(3):
        cyl(0.24 - k * 0.07, 0.006, (0, 0, z + 0.12 + k * 0.07), "Accent", verts=32)
    box((0.02, 0.02, 0.25), (0, 0, z + 0.18), "Metal")


@piece("work_painter")  # 看图/生图: a crystal prism
def _():
    z = tower_base(h=0.5)
    cyl(0.16, 0.06, (0, 0, z + 0.03), "Dark", verts=8)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.2, location=(0, 0, z + 0.3))
    o = bpy.context.active_object
    o.scale = (0.75, 0.75, 1.4)
    o.rotation_euler = (0, 0, math.radians(20))
    finish(o, "Accent", smooth=False)
    torus(0.24, 0.01, (0, 0, z + 0.3), "Metal", rot=(math.radians(20), 0, 0))


@piece("work_operator")  # 操作屏幕: a big screen on a mast
def _():
    z = tower_base(h=0.4)
    box((0.05, 0.05, 0.28), (0, 0.05, z + 0.14), "Metal")
    box((0.62, 0.05, 0.36), (0, 0.0, z + 0.42), "Dark", bevel=0.015)
    box((0.56, 0.02, 0.3), (0, -0.03, z + 0.42), "Accent")
    box((0.62, 0.06, 0.02), (0, 0, z + 0.6), "Panel")


@piece("work_spawn")  # 派子代理: a hangar with a launch pad
def _():
    hexprism(0.52, 0.06, 0, "Dark", bevel=0.01)
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.34, depth=0.7, location=(0, 0.04, 0.06), rotation=(0, math.radians(90), 0))
    o = bpy.context.active_object
    bm = bmesh.new()
    bm.from_mesh(o.data)
    # the cylinder lies along X after its turn; local +x points down, so dropping x > 0 keeps the arch
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.x > 1e-4], context="VERTS")
    bm.to_mesh(o.data)
    bm.free()
    finish(o, "Hull")
    box((0.42, 0.02, 0.24), (0, -0.31, 0.18), "Glass")
    box((0.46, 0.03, 0.03), (0, -0.32, 0.31), "Accent")
    for x in (-0.4, 0.4):
        box((0.04, 0.6, 0.012), (x * 0.9, 0.04, 0.066), "Light")


@piece("work_compaction")  # 压缩记忆: a silo with compressor rings
def _():
    z = tower_base(r=0.32, h=0.3)
    for k in range(5):
        r = 0.3 - k * 0.04
        cyl(r, 0.08, (0, 0, z + 0.04 + k * 0.1), "Hull" if k % 2 == 0 else "Panel", verts=32)
        cyl(r + 0.008, 0.012, (0, 0, z + 0.085 + k * 0.1), "Accent", verts=32)
    ball(0.08, (0, 0, z + 0.55), "Glass", segs=16)


@piece("hall")  # 任务大厅: the hub where every belt ends
def _():
    hexprism(0.62, 0.08, 0, "Dark", bevel=0.012)
    hexprism(0.54, 0.34, 0.08, "Hull", bevel=0.02)
    hexprism(0.555, 0.03, 0.3, "Accent")
    for k in range(6):
        a = math.radians(90 + 60 * k + 30)
        box((0.2, 0.012, 0.16), (math.cos(a) * 0.47, math.sin(a) * 0.47, 0.18), "Glass", rot=(0, 0, a + math.pi / 2))
    hexprism(0.6, 0.04, 0.42, "Panel", bevel=0.008)
    cyl(0.22, 0.12, (0, 0, 0.52), "Hull", verts=32)
    torus(0.3, 0.015, (0, 0, 0.6), "Accent")
    cyl(0.04, 0.22, (0, 0, 0.69), "Metal", verts=12)
    ball(0.05, (0, 0, 0.82), "Accent", segs=14)


def spire(h, rings, wide):
    hexprism(0.5 * wide, 0.1, 0, "Dark", bevel=0.012)
    hexprism(0.4 * wide, 0.18, 0.1, "Hull", bevel=0.015)
    hexprism(0.41 * wide, 0.02, 0.24, "Accent")
    cyl(0.14 * wide, h, (0, 0, 0.28 + h / 2), "Hull", verts=6, r2=0.07 * wide)
    for k in range(rings):
        z = 0.28 + h * (k + 1) / (rings + 1)
        r = 0.14 * wide - (0.07 * wide) * (k + 1) / (rings + 1)
        cyl(r + 0.03, 0.03, (0, 0, z), "Accent", verts=6)
    cyl(0.05 * wide, 0.22, (0, 0, 0.28 + h + 0.11), "Metal", verts=6, r2=0.0)
    ball(0.05, (0, 0, 0.28 + h + 0.05), "Light", segs=12)


@piece("landmark_1")
def _():
    spire(0.8, 1, 0.9)


@piece("landmark_2")
def _():
    spire(1.4, 2, 1.0)
    for k in range(3):
        a = k * TAU / 3
        box((0.06, 0.06, 0.5), (math.cos(a) * 0.3, math.sin(a) * 0.3, 0.53), "Panel", bevel=0.01)


@piece("landmark_3")
def _():
    spire(2.2, 4, 1.15)
    for k in range(3):
        a = k * TAU / 3 + 0.5
        box((0.07, 0.07, 0.9), (math.cos(a) * 0.36, math.sin(a) * 0.36, 0.73), "Panel", bevel=0.01)
        ball(0.03, (math.cos(a) * 0.36, math.sin(a) * 0.36, 1.2), "Accent", segs=10)
    torus(0.5, 0.02, (0, 0, 1.3), "Accent")


@piece("notice")  # 问答: a holo board on two posts
def _():
    for x in (-0.28, 0.28):
        box((0.04, 0.04, 0.5), (x, 0, 0.25), "Metal")
    box((0.66, 0.04, 0.32), (0, 0, 0.46), "Dark", bevel=0.012)
    box((0.6, 0.02, 0.26), (0, -0.022, 0.46), "Accent")
    box((0.7, 0.08, 0.025), (0, 0, 0.63), "Panel")


# ---- ground tiles: corner radius 1, top at height 0 ------------------------------------------------------------
@piece("tile_lot")
def _():
    hexprism(1.0, 0.12, -0.12, "Dark", bevel=0.02)
    hexprism(0.88, 0.008, -0.002, "Panel")
    hexprism(0.84, 0.01, -0.001, "Dark")


@piece("tile_plaza")
def _():
    hexprism(1.0, 0.12, -0.12, "Panel", bevel=0.02)
    hexprism(0.78, 0.008, -0.002, "Dark")
    hexprism(0.72, 0.01, -0.001, "Panel")


@piece("tile_street")
def _():
    hexprism(1.0, 0.1, -0.1, "Dark", bevel=0.02)
    for k in range(3):
        a = math.radians(30 + 60 * k)
        box((1.5, 0.03, 0.01), (0, 0, 0.004), "Panel", rot=(0, 0, a))
    cyl(0.07, 0.012, (0, 0, 0.006), "Accent", verts=16)


@piece("tile_wild")
def _():
    hexprism(1.0, 0.08, -0.12, "Ground", bevel=0.03)
    for k, (x, y, s) in enumerate(((0.3, 0.2, 0.12), (-0.35, -0.1, 0.09), (0.05, -0.45, 0.07))):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=s, location=(x, y, -0.04 + s * 0.3))
        o = bpy.context.active_object
        o.scale = (1.3, 1, 0.6)
        finish(o, "Ground", smooth=False)


# ---- props ------------------------------------------------------------------------------------------------------------
@piece("lamp")
def _():
    cyl(0.05, 0.03, (0, 0, 0.015), "Dark", verts=12)
    cyl(0.015, 0.55, (0, 0, 0.3), "Metal", verts=8)
    box((0.16, 0.04, 0.025), (0.06, 0, 0.58), "Dark")
    box((0.1, 0.03, 0.012), (0.08, 0, 0.565), "Light")


@piece("crates")
def _():
    box((0.3, 0.22, 0.2), (0, 0, 0.1), "Panel", bevel=0.01)
    box((0.3, 0.22, 0.012), (0, 0, 0.12), "Accent")
    box((0.22, 0.2, 0.16), (0.04, 0.02, 0.28), "Hull", bevel=0.01)
    box((0.18, 0.2, 0.18), (-0.27, 0.05, 0.09), "Dark", bevel=0.01)


@piece("crystal")
def _():
    for k, (x, y, h, t) in enumerate(((0, 0, 0.42, 0), (0.1, 0.05, 0.28, 18), (-0.08, 0.07, 0.22, -22), (0.03, -0.1, 0.18, 12))):
        cyl(0.05, h, (x, y, h / 2), "Accent", verts=6, r2=0.0, rot=(math.radians(t), math.radians(t * 0.6), 0))
    ball(0.12, (0, 0, 0.02), "Dark", scale=(1.2, 1, 0.4), segs=10)


# ---- build: each piece under its own root, joined per material ---------------------------------------------------------
roots = []
cols = 6
for i, (name, fn) in enumerate(PIECES.items()):
    _made.clear()
    fn()
    by_mat: dict = {}
    for o in _made:
        by_mat.setdefault(o.data.materials[0].name, []).append(o)
    root = bpy.data.objects.new(f"P_{name}", None)
    bpy.context.scene.collection.objects.link(root)
    for mat, objs in by_mat.items():
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        if len(objs) > 1:
            bpy.ops.object.join()
        j = bpy.context.view_layer.objects.active
        j.name = f"{name}.{mat}"
        j.parent = root
    # lay the kit out on a grid (for the preview); the web code reads each piece relative to its root
    root.location = ((i % cols) * 2.6, -(i // cols) * 2.6, 0)
    roots.append(root)

bpy.ops.object.select_all(action="DESELECT")
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_apply=True, export_materials="EXPORT", export_animations=False)
print("wrote", OUT, len(PIECES), "pieces")

if PREVIEW:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 1800, 1400
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.02, 0.03, 0.06, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.6
    scene.world = world
    rows = (len(PIECES) + cols - 1) // cols
    cx, cy = (cols - 1) * 1.3, -(rows - 1) * 1.3
    bpy.ops.object.camera_add(location=(cx, cy - 15, 11), rotation=(math.radians(55), 0, 0))
    scene.camera = bpy.context.active_object
    scene.camera.data.lens = 34
    bpy.ops.object.light_add(type="SUN", location=(0, 0, 10), rotation=(math.radians(40), math.radians(15), math.radians(-30)))
    bpy.context.active_object.data.energy = 3.5
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
    print("rendered", PREVIEW)
