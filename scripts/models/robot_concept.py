"""Concept spike: three cute agent directions, each as Claude main · Codex main · subagent. Throwaway."""
import math, sys
import bpy

OUT = sys.argv[sys.argv.index("--") + 1]
ONLY = sys.argv[sys.argv.index("--") + 2]
bpy.ops.wm.read_factory_settings(use_empty=True)

def mat(name, rgb, rough=0.3, emit=0.0, metal=0.0, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*rgb, 1)
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metal
    if "Coat Weight" in p.inputs:
        p.inputs["Coat Weight"].default_value = 0.4
    if emit:
        p.inputs["Emission Color"].default_value = (*rgb, 1)
        p.inputs["Emission Strength"].default_value = emit
    return m

M = {
    "shell": mat("shell", (0.80, 0.82, 0.86), 0.25),
    "face": mat("face", (0.015, 0.02, 0.035), 0.08),
    "ink": mat("ink", (0.03, 0.03, 0.05), 0.3),
    "white": mat("white", (1, 1, 1), 0.2, 3.0),
    "blush": mat("blush", (1.0, 0.45, 0.55), 0.5, 0.6),
    "glow": mat("glow", (0.6, 0.92, 1.0), 0.2, 3.0),
}
COL = {"claude": (0.93, 0.50, 0.33), "codex": (0.35, 0.62, 1.0), "role": (0.35, 0.88, 0.55)}
for k, c in COL.items():
    M[k + "_e"] = mat(k + "_e", c, 0.2, 2.2)
    M[k + "_s"] = mat(k + "_s", c, 0.35)


def fin(o, m, parent=None, smooth=True, sub=0):
    if sub:
        s = o.modifiers.new("s", "SUBSURF"); s.levels = sub; s.render_levels = sub
    if smooth and o.type == "MESH":
        for poly in o.data.polygons:
            poly.use_smooth = True
    o.data.materials.clear(); o.data.materials.append(M[m])
    if parent:
        o.parent = parent
    return o

def ball(loc, r, m, sc=(1, 1, 1), parent=None, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=r, location=loc, rotation=rot)
    o = bpy.context.active_object; o.scale = sc
    return fin(o, m, parent)

def rbox(loc, size, m, bevel, parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object; o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    b = o.modifiers.new("b", "BEVEL"); b.width = bevel; b.segments = 8
    return fin(o, m, parent)

def cyl(loc, r, d, m, rot=(0, 0, 0), parent=None, r2=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=40, radius=r, depth=d, location=loc, rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=40, radius1=r, radius2=r2, depth=d, location=loc, rotation=rot)
    return fin(bpy.context.active_object, m, parent, smooth=False)

def torus(loc, R, r, m, rot=(0, 0, 0), parent=None):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=64, minor_segments=16, location=loc, rotation=rot)
    return fin(bpy.context.active_object, m, parent)

def arc(c, r, a0, a1, thick, m, parent=None):
    """a curve in the XZ plane facing -Y (a smile, a ^ eye)"""
    cu = bpy.data.curves.new("arc", "CURVE"); cu.dimensions = "3D"; cu.bevel_depth = thick; cu.bevel_resolution = 4
    sp = cu.splines.new("POLY"); n = 20; sp.points.add(n - 1)
    for i in range(n):
        a = a0 + (a1 - a0) * i / (n - 1)
        sp.points[i].co = (c[0] + r * math.cos(a), c[1], c[2] + r * math.sin(a), 1)
    o = bpy.data.objects.new("arc", cu); bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(M[m])
    if parent: o.parent = parent
    return o

def root(x, s):
    o = bpy.data.objects.new("root", None); bpy.context.scene.collection.objects.link(o)
    o.location = (x, 0, 0); o.scale = (s, s, s)
    return o


# ---- A  豆丁: one capsule-egg body, dark face window, big glowing eyes, blush, stub hands, sprout ----
def bean(x, fac, sub=False, happy=False):
    R = root(x, 0.72 if sub else 1)
    acc = "role" if sub else fac
    ball((0, 0, 0.5), 0.36, "shell", (1, 0.92, 1.18), R)
    rbox((0, -0.255, 0.6), (0.46, 0.16, 0.3), "face", 0.08, R)
    for sx in (-1, 1):
        if happy:
            arc((sx * 0.1, -0.338, 0.58), 0.045, 0.15, math.pi - 0.15, 0.013, fac + "_e", R)
        else:
            ball((sx * 0.1, -0.33, 0.61), 0.045, fac + "_e", (0.85, 0.5, 1.25), R)
        ball((sx * 0.2, -0.29, 0.5), 0.035, "blush", (1, 0.4, 0.6), R)
        ball((sx * 0.39, -0.02, 0.36), 0.075, "shell", (0.8, 0.8, 1.05), R)  # stub hands
    arc((0, -0.338, 0.53), 0.035, math.pi + 0.5, 2 * math.pi - 0.5, 0.009, fac + "_e", R)
    torus((0, 0, 0.06), 0.15, 0.025, acc + "_e", parent=R)
    # sprout antenna: stem + leaf in the accent colour
    cyl((0, 0, 0.98), 0.012, 0.14, "ink", parent=R)
    ball((0.05, 0, 1.06), 0.06, acc + "_e", (1.3, 0.5, 0.6), R, rot=(0, -0.5, 0))
    if sub:  # role beanie
        ball((0, 0, 0.82), 0.27, "role_s", (1.15, 1.1, 0.55), R)


# ---- B  大头: big soft head with a black screen face, round eyes + smile, small body, headphones ----
def chibi(x, fac, sub=False, happy=False):
    R = root(x, 0.72 if sub else 1)
    acc = "role" if sub else fac
    ball((0, 0, 0.3), 0.19, "shell", (1, 0.95, 1.05), R)
    ball((0, -0.17, 0.3), 0.06, acc + "_e", (1, 0.4, 1), R)  # chest light
    for sx in (-1, 1):
        ball((sx * 0.22, 0, 0.27), 0.06, "shell", (0.9, 0.9, 1.3), R)  # arms
        ball((sx * 0.08, 0, 0.1), 0.07, "ink", (1, 1.2, 0.7), R)  # feet
    rbox((0, 0, 0.68), (0.62, 0.5, 0.46), "shell", 0.19, R)
    rbox((0, -0.215, 0.67), (0.5, 0.1, 0.33), "face", 0.12, R)
    for sx in (-1, 1):
        if happy:
            arc((sx * 0.11, -0.275, 0.66), 0.05, 0.2, math.pi - 0.2, 0.015, fac + "_e", R)
        else:
            ball((sx * 0.11, -0.27, 0.69), 0.055, fac + "_e", (1, 0.45, 1.1), R)
            ball((sx * 0.11 + 0.02, -0.295, 0.715), 0.014, "white", parent=R)
    arc((0, -0.275, 0.61), 0.04, math.pi + 0.6, 2 * math.pi - 0.6, 0.01, fac + "_e", R)
    for sx in (-1, 1):  # headphones in the accent colour
        cyl((sx * 0.32, 0, 0.68), 0.1, 0.07, acc + "_s", rot=(0, math.pi / 2, 0), parent=R)
    torus((0, 0, 0.68), 0.335, 0.025, acc + "_s", rot=(math.pi / 2, 0, 0), parent=R)
    cyl((0.12, 0, 0.98), 0.01, 0.12, "ink", parent=R)
    ball((0.12, 0, 1.05), 0.035, acc + "_e", parent=R)


# ---- C  光团: floating droplet spirit, kawaii ink eyes, glowing halo, floating hands ----
def sprite(x, fac, sub=False, happy=False):
    R = root(x, 0.72 if sub else 1)
    acc = "role" if sub else fac
    ball((0, 0, 0.55), 0.33, "shell", (1, 0.95, 1), R)
    cyl((0, 0, 0.3), 0.3, 0.32, "shell", parent=R, r2=0.02).rotation_euler = (math.pi, 0, 0)
    # soft tail tip
    ball((0, 0, 0.16), 0.05, "shell", parent=R)
    for sx in (-1, 1):
        if happy:
            arc((sx * 0.11, -0.315, 0.56), 0.045, 0.2, math.pi - 0.2, 0.014, "ink", R)
        else:
            ball((sx * 0.11, -0.29, 0.58), 0.05, "ink", (0.85, 0.5, 1.2), R)
            ball((sx * 0.11 + 0.016, -0.33, 0.6), 0.014, "white", parent=R)
        ball((sx * 0.2, -0.26, 0.49), 0.04, "blush", (1, 0.4, 0.55), R)
        ball((sx * 0.4, -0.05, 0.42), 0.06, "shell", parent=R)  # floating hands
    arc((0, -0.318, 0.52), 0.03, math.pi + 0.5, 2 * math.pi - 0.5, 0.008, "ink", R)
    torus((0, 0, 1.0), 0.17, 0.022, acc + "_e", rot=(0.25, 0, 0), parent=R)
    ball((0, 0, 0.55), 0.06, acc + "_e", parent=R).scale = (0.01, 0.01, 0.01)  # placeholder core (hidden)


X = {"A": -3.0, "B": 0.0, "C": 3.0}
for key, fn in (("A", bean), ("B", chibi), ("C", sprite)):
    if key != ONLY: continue
    x0 = X[key]
    fn(x0 - 0.75, "claude")
    fn(x0 + 0.05, "codex", happy=True)
    fn(x0 + 0.78, "claude", sub=True)

# ground disc
bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, -0.02))
fin(bpy.context.active_object, "shell", smooth=False)
gm = mat("ground", (0.05, 0.06, 0.09), 0.95)
bpy.context.active_object.data.materials[0] = gm

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x, scene.render.resolution_y = 1200, 760
w = bpy.data.worlds.new("w"); w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.03, 0.04, 0.08, 1)
scene.world = w
bpy.ops.object.camera_add(location=(X[ONLY] + 0.02, -4.6, 1.45), rotation=(math.radians(80), 0, 0))
scene.camera = bpy.context.active_object; scene.camera.data.lens = 50
for loc, e in (((3, -4, 5), 900), ((-4, -3, 3), 400), ((0, 4, 4), 500)):
    bpy.ops.object.light_add(type="AREA", location=loc)
    L = bpy.context.active_object; L.data.energy = e; L.data.size = 4
    d = L.location * -1; L.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
scene.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print("rendered", OUT)
