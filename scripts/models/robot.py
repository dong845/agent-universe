"""The city's agent character "大头" (spec 2026-11-05 A1), built by script in Blender, exported as glTF.

Run:  Blender -b -P scripts/models/robot.py -- <out.glb> [--preview <dir>]

Sizes, face shapes and colours come from art/character.json, which the page's 2D face reads too.
Moving parts are named nodes the web code animates: Robot > Body > {Head, ArmL, ArmR, FootL, FootR}.
The code shows one Face_<face> under Head at a time, and at most one prop: PropHead_* (under Head),
PropHand_* (under ArmR) or PropBody_* (under Body). Materials are named so the code can recolour them:
Eye (faction), Phones (faction or role), Chest (current work); the rest keep their own colours.
The character faces -Y in Blender, which the glTF exporter turns into +Z (three.js forward here).
"""
import json
import math
import os
import sys

import bmesh
import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if not argv:
    raise SystemExit("usage: Blender -b -P robot.py -- out.glb [--preview <dir>]")
OUT = argv[0]
PREVIEW = argv[argv.index("--preview") + 1] if "--preview" in argv else None
HERE = os.path.dirname(os.path.abspath(__file__))
C = json.load(open(os.path.join(HERE, "..", "..", "art", "character.json")))

bpy.ops.wm.read_factory_settings(use_empty=True)


def lin(hexs):
    """#rrggbb (sRGB) → linear RGB, as Blender's colour inputs want"""
    v = [int(hexs[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in v)


def material(name, hexs, rough=0.35, metal=0.0, emit=0.0, coat=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*lin(hexs), 1)
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metal
    if coat:
        p.inputs["Coat Weight"].default_value = coat
    if emit:
        p.inputs["Emission Color"].default_value = (*lin(hexs), 1)
        p.inputs["Emission Strength"].default_value = emit
    return m


COL = C["colors"]
MAT = {
    "Shell": material("Shell", COL["shell"], 0.28, coat=0.5),
    "Screen": material("Screen", COL["screen"], 0.08, coat=1.0),
    "Ink": material("Ink", COL["ink"], 0.4),
    "Eye": material("Eye", COL["claude-code"], 0.2, emit=3.0),
    "Red": material("Red", COL["red"], 0.2, emit=3.0),
    "White": material("White", "#ffffff", 0.2, emit=2.0),
    "Blush": material("Blush", COL["blush"], 0.4, emit=0.8),
    "Phones": material("Phones", COL["claude-code"], 0.35),
    "Chest": material("Chest", COL["claude-code"], 0.25, emit=2.5),
    # the props' own colours
    "PropYellow": material("PropYellow", "#ffc83d", 0.35),
    "PropRed": material("PropRed", "#ff5a6e", 0.4),
    "PropBlue": material("PropBlue", "#4f8dff", 0.35),
    "PropBrown": material("PropBrown", "#b07a4a", 0.6),
    "PropPaper": material("PropPaper", "#f7f3e8", 0.7),
    "PropGlass": material("PropGlass", "#9fe8ff", 0.05, emit=0.6),
    "PropMetal": material("PropMetal", "#c9ced8", 0.25, metal=0.8),
    "PropPink": material("PropPink", "#ff9ec4", 0.5),
    "PropTeal": material("PropTeal", "#3fb5a3", 0.45),
}


def finish(o, mat, parent, smooth=True):
    bpy.context.view_layer.objects.active = o
    for s in bpy.context.selected_objects:
        s.select_set(False)
    o.select_set(True)
    if o.type == "CURVE":
        bpy.ops.object.convert(target="MESH")
        o = bpy.context.active_object
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    for mod in list(o.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)
    if smooth:
        bpy.ops.object.shade_smooth()
    o.data.materials.clear()
    o.data.materials.append(MAT[mat])
    o.select_set(False)
    mw = o.matrix_world.copy()
    o.parent = parent
    o.matrix_world = mw
    return o


def ball(name, r, loc, mat, parent, scale=(1, 1, 1), seg=32, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2, radius=r, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    return finish(o, mat, parent)


def rbox(name, size, loc, mat, parent, bevel=0.0, seg=6, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        b = o.modifiers.new("bevel", "BEVEL")
        b.width = bevel
        b.segments = seg
        b.limit_method = "NONE"
    return finish(o, mat, parent, smooth=bool(bevel))


def cyl(name, r, depth, loc, mat, parent, rot=(0, 0, 0), verts=28, r2=None, smooth=False):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2, depth=depth, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    return finish(o, mat, parent, smooth=smooth)


def torus(name, R, r, loc, mat, parent, rot=(0, 0, 0), half=False, seg=40):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=seg, minor_segments=10, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    if half:
        # keep the upper half (local +Y before the rotation is applied → the half above the centre)
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.y < -0.002], context="VERTS")
        bm.to_mesh(o.data)
        bm.free()
    return finish(o, mat, parent)


def arc(name, c, r, a0, a1, thick, mat, parent, y):
    """a bent tube in the XZ plane at depth y (a ^ eye, a smile)"""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = thick
    cu.bevel_resolution = 3
    cu.use_fill_caps = True
    sp = cu.splines.new("POLY")
    n = 16
    sp.points.add(n - 1)
    for i in range(n):
        a = a0 + (a1 - a0) * i / (n - 1)
        sp.points[i].co = (c[0] + r * math.cos(a), y, c[1] + r * math.sin(a), 1)
    o = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(o)
    return finish(o, mat, parent)


def empty(name, loc, parent=None):
    o = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(o)
    o.location = loc
    if parent:
        mw = o.matrix_world.copy()
        o.parent = parent
        o.matrix_world = mw
    return o


# ---- hierarchy -------------------------------------------------------------------------------------------
H, S = C["head"], C["screen"]
HZ = H["z"]
root = empty("Robot", (0, 0, 0))
body = empty("Body", (0, 0, 0), root)
head = empty("Head", (0, 0, 0.47), body)
arm_l = empty("ArmL", (-0.2, 0, 0.37), body)
arm_r = empty("ArmR", (0.2, 0, 0.37), body)
foot_l = empty("FootL", (-0.085, 0, 0.12), body)
foot_r = empty("FootR", (0.085, 0, 0.12), body)

# body: a soft egg with a round chest light
ball("Torso", 0.19, (0, 0, 0.3), "Shell", body, scale=(1, 0.95, 1.05), seg=40)
ball("ChestLight", 0.055, (0, -0.172, 0.3), "Chest", body, scale=(1, 0.35, 1))
for side, foot in ((-1, foot_l), (1, foot_r)):
    ball(f"Foot{'L' if side < 0 else 'R'}Mesh", 0.07, (side * 0.085, -0.015, 0.075), "Ink", foot, scale=(1, 1.25, 0.72), seg=24)
for side, arm in ((-1, arm_l), (1, arm_r)):
    ball(f"Arm{'L' if side < 0 else 'R'}Mesh", 0.062, (side * 0.225, 0, 0.29), "Shell", arm, scale=(0.9, 0.9, 1.35), seg=24)

# head: big and soft, a glossy black screen, headphones over the top, a short antenna
rbox("HeadShell", (H["w"], H["d"], H["h"]), (0, 0, HZ), "Shell", head, bevel=H["bevel"], seg=8)
FRONT = -H["d"] / 2
rbox("Screen", (S["w"], 0.1, S["h"]), (0, FRONT + 0.035, HZ - 0.01), "Screen", head, bevel=S["bevel"], seg=8)
FACE_Y = FRONT - 0.018  # just in front of the screen
for side in (-1, 1):
    ball(f"Blush{'L' if side < 0 else 'R'}", 0.03, (side * 0.19, FACE_Y + 0.004, HZ - 0.085), "Blush", head, scale=(1.3, 0.25, 0.7), seg=16)
    cyl(f"Phones{'L' if side < 0 else 'R'}", 0.1, 0.075, (side * (H["w"] / 2 + 0.01), 0, HZ), "Phones", head, rot=(0, math.pi / 2, 0), verts=32)
    cyl(f"PhonesCap{'L' if side < 0 else 'R'}", 0.065, 0.02, (side * (H["w"] / 2 + 0.05), 0, HZ), "Shell", head, rot=(0, math.pi / 2, 0), verts=28)
torus("PhonesBand", H["w"] / 2 + 0.03, 0.026, (0, 0, HZ + 0.02), "Phones", head, rot=(math.pi / 2, 0, 0), half=True)
cyl("Antenna", 0.012, 0.2, (0, 0.11, HZ + H["h"] / 2 + 0.09), "Ink", head, verts=10)
ball("AntennaTip", 0.04, (0, 0.11, HZ + H["h"] / 2 + 0.2), "Eye", head, seg=20)

# faces: each a group of eye and mouth meshes in face-screen units (screen width = 1)
U = S["w"]
for fname, f in C["faces"].items():
    g = empty(f"Face_{fname}", (0, FACE_Y, HZ), head)
    mat = "Red" if f.get("red") else "Eye"
    e = f["eyes"]
    w, h, dx, dy, look = e["w"] * U, e["h"] * U, e["dx"] * U, e["dy"] * U, e.get("look", 0) * U
    for side in (-1, 1):
        x, z = side * dx + look, HZ + dy
        tag = f"{fname}{'L' if side < 0 else 'R'}"
        if e["shape"] in ("round", "wide"):
            ball(f"Eye_{tag}", 0.5, (x, FACE_Y, z), mat, g, scale=(w / 2, 0.012, h / 2), seg=24)
            ball(f"Shine_{tag}", 0.5, (x + w * 0.18, FACE_Y - 0.008, z + h * 0.2), "White", g, scale=(w * 0.3, 0.006, w * 0.3), seg=12)
        elif e["shape"] in ("flat", "line"):
            rbox(f"Eye_{tag}", (w, 0.012, max(h, 0.012)), (x, FACE_Y, z), mat, g, bevel=min(w, max(h, 0.012)) * 0.45, seg=4)
        elif e["shape"] == "arc":
            arc(f"Eye_{tag}", (x, z - w * 0.25), w / 2, 0.25, math.pi - 0.25, 0.012, mat, g, FACE_Y)
        elif e["shape"] == "x":
            for k, rot in enumerate((math.pi / 4, -math.pi / 4)):
                rbox(f"Eye_{tag}{k}", (w, 0.012, 0.024), (x, FACE_Y, z), mat, g, bevel=0.01, seg=3, rot=(0, rot, 0))
        else:
            raise SystemExit(f"unknown eye shape {e['shape']}")
    m = f["mouth"]
    mw = m["w"] * U
    mz = HZ - 0.075
    if m["shape"] == "smile":
        arc(f"Mouth_{fname}", (0, mz + mw * 0.35), mw / 2, math.pi + 0.55, 2 * math.pi - 0.55, 0.009, mat, g, FACE_Y)
    elif m["shape"] == "flat":
        rbox(f"Mouth_{fname}", (mw, 0.01, 0.016), (0, FACE_Y, mz), mat, g, bevel=0.007, seg=3)
    elif m["shape"] == "o":
        torus(f"Mouth_{fname}", mw / 2, 0.008, (0, FACE_Y, mz), mat, g, rot=(math.pi / 2, 0, 0), seg=20)
    elif m["shape"] != "none":
        raise SystemExit(f"unknown mouth shape {m['shape']}")

# ---- props (spec A4): chunky, readable at 30 px ----------------------------------------------------------
TOP = HZ + H["h"] / 2
HAND = (0.235, -0.07, 0.2)  # in front of the right hand, which hangs from ArmR


def prop(name, parent):
    return empty(name, parent.matrix_world.translation.copy(), parent)


p = prop("PropHead_hardhat", head)
ball("HatDome", 0.27, (0, 0, TOP - 0.06), "PropYellow", p, scale=(1.12, 1.0, 0.62), seg=32)
cyl("HatBrim", 0.36, 0.025, (0, -0.04, TOP - 0.07), "PropYellow", p, verts=40)
rbox("HatRidge", (0.05, 0.5, 0.06), (0, 0, TOP + 0.09), "PropYellow", p, bevel=0.02, seg=3)

p = prop("PropHead_glasses", head)
for side in (-1, 1):
    torus(f"Lens{side}", 0.075, 0.013, (side * 0.11, FACE_Y - 0.03, HZ + 0.02), "Ink", p, rot=(math.pi / 2, 0, 0), seg=28)
    cyl(f"Temple{side}", 0.008, 0.26, (side * 0.27, FACE_Y + 0.11, HZ + 0.02), "Ink", p, rot=(math.pi / 2, 0, 0), verts=8)
rbox("Bridge", (0.07, 0.012, 0.014), (0, FACE_Y - 0.03, HZ + 0.04), "Ink", p, bevel=0.005, seg=2)

p = prop("PropHead_beret", head)
ball("Beret", 0.25, (-0.04, 0.02, TOP + 0.01), "PropRed", p, scale=(1.18, 1.1, 0.38), seg=32, rot=(0, -0.18, 0))
ball("BeretNub", 0.03, (-0.06, 0.02, TOP + 0.1), "PropRed", p, seg=12)

p = prop("PropHead_goggles", head)
torus("GoggleStrap", H["w"] / 2 + 0.012, 0.02, (0, 0, HZ + 0.11), "Ink", p, seg=48)
for side in (-1, 1):
    cyl(f"Goggle{side}", 0.075, 0.06, (side * 0.11, FRONT - 0.02, HZ + 0.11), "PropMetal", p, rot=(math.pi / 2, 0, 0), verts=28)
    cyl(f"GoggleGlass{side}", 0.06, 0.012, (side * 0.11, FRONT - 0.052, HZ + 0.11), "PropGlass", p, rot=(math.pi / 2, 0, 0), verts=28)

hx, hy, hz = HAND
p = prop("PropHand_magnifier", arm_r)
torus("MagRing", 0.085, 0.016, (hx, hy - 0.02, hz + 0.16), "PropMetal", p, rot=(math.pi / 2, 0, 0), seg=32)
cyl("MagGlass", 0.078, 0.008, (hx, hy - 0.02, hz + 0.16), "PropGlass", p, rot=(math.pi / 2, 0, 0), verts=28)
cyl("MagHandle", 0.02, 0.12, (hx, hy - 0.02, hz + 0.02), "PropBrown", p, verts=12)

p = prop("PropHand_pencil", arm_r)
cyl("PencilBody", 0.04, 0.3, (hx, hy, hz + 0.1), "PropYellow", p, verts=6)
cyl("PencilTip", 0.04, 0.075, (hx, hy, hz + 0.287), "PropBrown", p, verts=6, r2=0.006)
cyl("PencilEraser", 0.041, 0.05, (hx, hy, hz - 0.075), "PropPink", p, verts=12)

p = prop("PropHand_dish", arm_r)
cyl("DishStick", 0.016, 0.22, (hx, hy, hz + 0.08), "PropMetal", p, verts=10)
cyl("Dish", 0.15, 0.07, (hx, hy - 0.03, hz + 0.24), "PropPaper", p, rot=(math.radians(215), 0, 0), verts=32, r2=0.04)
ball("DishFeed", 0.03, (hx, hy - 0.12, hz + 0.3), "PropGlass", p, seg=12)

p = prop("PropHand_clipboard", arm_r)
rbox("Board", (0.17, 0.02, 0.22), (hx + 0.02, hy - 0.03, hz + 0.08), "PropBrown", p, bevel=0.012, seg=3)
rbox("Paper", (0.14, 0.008, 0.18), (hx + 0.02, hy - 0.042, hz + 0.07), "PropPaper", p)
rbox("Clip", (0.07, 0.02, 0.03), (hx + 0.02, hy - 0.045, hz + 0.185), "PropMetal", p, bevel=0.006, seg=2)

p = prop("PropHand_shield", arm_r)
ball("ShieldFace", 0.13, (hx + 0.03, hy - 0.05, hz + 0.08), "PropBlue", p, scale=(0.95, 0.22, 1.15), seg=32)
ball("ShieldBoss", 0.035, (hx + 0.03, hy - 0.085, hz + 0.08), "PropYellow", p, seg=16)

p = prop("PropBody_bowtie", body)
for side in (-1, 1):
    cyl(f"Bow{side}", 0.08, 0.14, (side * 0.075, -0.18, 0.44), "PropRed", p, rot=(0, side * math.pi / 2, 0), verts=4, r2=0.016)
ball("BowKnot", 0.035, (0, -0.19, 0.44), "PropRed", p, seg=12)

p = prop("PropBody_backpack", body)
rbox("Pack", (0.24, 0.12, 0.22), (0, 0.19, 0.32), "PropTeal", p, bevel=0.05, seg=5)
rbox("PackPocket", (0.15, 0.04, 0.09), (0, 0.255, 0.27), "PropTeal", p, bevel=0.02, seg=3)
rbox("PackFlap", (0.22, 0.13, 0.04), (0, 0.19, 0.43), "PropBrown", p, bevel=0.015, seg=3)
for side in (-1, 1):
    rbox(f"Strap{side}", (0.04, 0.03, 0.2), (side * 0.085, -0.17, 0.34), "PropTeal", p, bevel=0.012, seg=2, rot=(0.25, 0, 0))

# ---- export --------------------------------------------------------------------------------------------
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_apply=True, export_materials="EXPORT", export_animations=False)
print("wrote", OUT)

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = 560
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.03, 0.04, 0.08, 1)
    scene.world = world
    bpy.ops.object.camera_add(location=(0.95, -2.1, 1.05), rotation=(math.radians(80), 0, math.radians(24)))
    scene.camera = bpy.context.active_object
    scene.camera.data.lens = 50
    for loc, e in (((2, -2.5, 3), 260), ((-2.5, -1, 1.5), 110), ((0, 2.5, 2.5), 160)):
        bpy.ops.object.light_add(type="AREA", location=loc)
        L = bpy.context.active_object
        L.data.energy = e
        L.data.size = 2.5
        L.rotation_euler = (L.location * -1).to_track_quat("-Z", "Y").to_euler()

    def show(o, on):
        for c in [o, *o.children_recursive]:
            c.hide_render = not on

    faces = [o for o in bpy.data.objects if o.name.startswith("Face_")]
    props = [o for o in bpy.data.objects if o.name.startswith("Prop")]
    eye = MAT["Eye"].node_tree.nodes["Principled BSDF"]
    phones = MAT["Phones"].node_tree.nodes["Principled BSDF"]

    def tint(node, hexs, emit):
        node.inputs["Base Color"].default_value = (*lin(hexs), 1)
        if emit:
            node.inputs["Emission Color"].default_value = (*lin(hexs), 1)

    for p in props:
        show(p, False)
    for f in faces:
        for g in faces:
            show(g, g is f)
        scene.render.filepath = os.path.join(PREVIEW, f"{f.name.lower()}.png")
        bpy.ops.render.render(write_still=True)
    tint(phones, "#7cff9e", False)
    for f in faces:
        show(f, f.name == "Face_normal")
    for p in props:
        for q in props:
            show(q, q is p)
        scene.render.filepath = os.path.join(PREVIEW, f"{p.name.lower()}.png")
        bpy.ops.render.render(write_still=True)
    print("previews in", PREVIEW)
