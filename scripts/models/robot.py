"""The city's agent robot (D19), built by script in Blender, exported as glTF.

Run:  blender -b -P scripts/models/robot.py -- <out.glb> [<preview.png>]

Geometry only. Moving parts are named nodes the web code animates: Robot > Body > {Head, ArmL, ArmR}.
Materials are named so the code can recolour them: Hull, Dark, Visor (faction), Chest (role), Thrust.
The robot faces -Y in Blender, which the glTF exporter turns into +Z (three.js forward here).
"""
import math
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if not argv:
    raise SystemExit("usage: blender -b -P robot.py -- out.glb [preview.png]")
OUT = argv[0]
PREVIEW = argv[1] if len(argv) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)


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
    "Hull": material("Hull", (0.86, 0.89, 0.93), 0.25, 0.32),
    "Dark": material("Dark", (0.10, 0.12, 0.16), 0.55, 0.38),
    "Visor": material("Visor", (0.35, 0.75, 1.0), 0.0, 0.2, 4.0),
    "Chest": material("Chest", (0.35, 0.75, 1.0), 0.0, 0.25, 3.0),
    "Thrust": material("Thrust", (0.6, 0.92, 1.0), 0.0, 0.2, 4.0),
    "Glass": material("Glass", (0.02, 0.03, 0.05), 0.2, 0.08),
    "Accent": material("Accent", (0.35, 0.75, 1.0), 0.0, 0.3, 2.0),
}


def finish(o, mat, bevel=0.0, segments=4, smooth=True, parent=None):
    """bevel (applied), smooth shading by angle, material, parent keeping the world transform"""
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
    if parent:
        mw = o.matrix_world.copy()
        o.parent = parent
        o.matrix_world = mw
    return o


def box(name, size, loc, mat, bevel=0.0, segments=4, parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    return finish(o, mat, bevel, segments, parent=parent)


def cyl(name, r, depth, loc, mat, rot=(0, 0, 0), verts=32, bevel=0.0, parent=None, r2=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2, depth=depth, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    return finish(o, mat, bevel, 3, parent=parent)


def ball(name, r, loc, mat, parent=None, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=r, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    return finish(o, mat, parent=parent)


def torus(name, major, minor, loc, mat, rot=(0, 0, 0), parent=None):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=48, minor_segments=12, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    return finish(o, mat, parent=parent)


def empty(name, loc, parent=None):
    o = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(o)
    o.location = loc
    if parent:
        o.parent = parent
    return o


# ---- hierarchy: Robot > Body (hover pivot) > Head (neck pivot), ArmL / ArmR (shoulder pivots) ----------
root = empty("Robot", (0, 0, 0))
body = empty("Body", (0, 0, 0), root)
head = empty("Head", (0, 0, 0.58), body)
arm_l = empty("ArmL", (-0.25, 0, 0.47), body)
arm_r = empty("ArmR", (0.25, 0, 0.47), body)

# torso: rounded, a little narrower at the waist
t = box("Torso", (0.40, 0.32, 0.30), (0, 0, 0.385), "Hull", bevel=0.07, segments=5, parent=body)
box("Waist", (0.30, 0.25, 0.08), (0, 0, 0.225), "Dark", bevel=0.03, parent=body)
box("ChestFrame", (0.25, 0.02, 0.15), (0, -0.162, 0.40), "Dark", bevel=0.012, parent=body)
box("ChestLight", (0.20, 0.02, 0.10), (0, -0.168, 0.40), "Chest", bevel=0.01, parent=body)
for i, x in enumerate((-0.06, 0.0, 0.06)):
    box(f"ChestSlot{i}", (0.035, 0.012, 0.012), (x, -0.165, 0.33), "Dark", parent=body)
box("Pack", (0.26, 0.11, 0.22), (0, 0.20, 0.40), "Hull", bevel=0.035, parent=body)
for i, x in enumerate((-0.07, 0.07)):
    cyl(f"Vent{i}", 0.03, 0.07, (x, 0.21, 0.535), "Dark", verts=20, parent=body)
# thruster skirt and its glowing ring
cyl("Skirt", 0.15, 0.09, (0, 0, 0.155), "Dark", verts=40, r2=0.11, parent=body)
torus("ThrustRing", 0.095, 0.018, (0, 0, 0.105), "Thrust", parent=body)
cyl("ThrustCore", 0.07, 0.02, (0, 0, 0.11), "Thrust", verts=32, parent=body)
# neck
cyl("Neck", 0.055, 0.06, (0, 0, 0.565), "Dark", verts=24, parent=body)

# head: wide and soft, a framed visor band, ear discs, an antenna
box("HeadShell", (0.38, 0.31, 0.24), (0, 0, 0.71), "Hull", bevel=0.09, segments=6, parent=head)
box("VisorFrame", (0.33, 0.03, 0.12), (0, -0.152, 0.715), "Dark", bevel=0.03, segments=4, parent=head)
box("VisorGlass", (0.28, 0.03, 0.08), (0, -0.162, 0.715), "Glass", bevel=0.028, segments=4, parent=head)
# two eyes behind the glass: soft pills that glow in the faction colour
for side in (-1, 1):
    box(f"Eye{'L' if side < 0 else 'R'}", (0.055, 0.02, 0.032), (side * 0.065, -0.172, 0.718), "Visor", bevel=0.014, segments=4, parent=head)
# an accent stripe across the head and down the back of the torso (role or faction colour, set by the code)
box("HeadStripe", (0.06, 0.315, 0.012), (0, 0.0, 0.832), "Accent", bevel=0.005, parent=head)
for side in (-1, 1):
    box(f"SideStripe{'L' if side < 0 else 'R'}", (0.012, 0.2, 0.05), (side * 0.201, 0.0, 0.43), "Accent", bevel=0.004, parent=body)
for side in (-1, 1):
    cyl(f"Ear{'L' if side < 0 else 'R'}", 0.055, 0.035, (side * 0.197, 0, 0.71), "Dark", rot=(0, math.pi / 2, 0), verts=28, parent=head)
    cyl(f"EarCap{'L' if side < 0 else 'R'}", 0.03, 0.012, (side * 0.218, 0, 0.71), "Visor", rot=(0, math.pi / 2, 0), verts=20, parent=head)
cyl("Antenna", 0.008, 0.15, (0.09, 0.02, 0.88), "Dark", verts=10, parent=head)
ball("AntennaTip", 0.026, (0.09, 0.02, 0.96), "Visor", parent=head)

# arms: shoulder ball, upper arm, forearm, two-finger claw; they hang from their pivots
for side, pivot in ((-1, arm_l), (1, arm_r)):
    sx = side * 0.25
    tag = "L" if side < 0 else "R"
    ball(f"Shoulder{tag}", 0.06, (sx, 0, 0.47), "Hull", parent=pivot)
    cyl(f"UpperArm{tag}", 0.032, 0.12, (sx + side * 0.01, 0, 0.39), "Dark", verts=16, parent=pivot)
    box(f"Forearm{tag}", (0.085, 0.085, 0.11), (sx + side * 0.012, 0, 0.30), "Hull", bevel=0.025, parent=pivot)
    box(f"Cuff{tag}", (0.09, 0.09, 0.02), (sx + side * 0.012, 0, 0.255), "Dark", bevel=0.008, parent=pivot)
    for f, dy in enumerate((-0.025, 0.025)):
        box(f"Claw{tag}{f}", (0.022, 0.02, 0.06), (sx + side * 0.012, dy, 0.22), "Dark", bevel=0.008, parent=pivot)

# ---- export --------------------------------------------------------------------------------------------
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_apply=True, export_materials="EXPORT", export_animations=False)
print("wrote", OUT)

if PREVIEW:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = 900
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.02, 0.03, 0.06, 1)
    scene.world = world
    bpy.ops.object.camera_add(location=(1.25, -1.9, 1.05), rotation=(math.radians(76), 0, math.radians(33)))
    scene.camera = bpy.context.active_object
    scene.camera.data.lens = 55
    bpy.ops.object.light_add(type="AREA", location=(1.5, -1.5, 2.5))
    bpy.context.active_object.data.energy = 300
    bpy.ops.object.light_add(type="AREA", location=(-1.8, 0.5, 1.2))
    bpy.context.active_object.data.energy = 120
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
    print("rendered", PREVIEW)
