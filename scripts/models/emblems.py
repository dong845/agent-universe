"""The faction marks as solid emblems (D21), from the marks' own SVGs, built in Blender.

Run:  blender -b -P scripts/models/emblems.py -- <out.glb> [<preview.png>]

Sources (art/logos/, from Wikimedia Commons): claude.svg (File:Claude_AI_symbol.svg) and openai.svg
(File:OpenAI_logo_2025_(symbol).svg). The marks belong to Anthropic and OpenAI; they are used here only
to label each side in this local tool and are not published.

Each mark is imported as curves, extruded and bevelled, centred, scaled so its larger side is 1, and
stood upright facing -Y (Blender) = +Z in three.js, the camera side of a billboard. Nodes: E_claude-code, E_codex.
"""
import math
import os
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if not argv:
    raise SystemExit("usage: blender -b -P emblems.py -- out.glb [preview.png]")
OUT = argv[0]
PREVIEW = argv[1] if len(argv) > 1 else None
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
MARKS = {"claude-code": "art/logos/claude.svg", "codex": "art/logos/openai.svg"}

bpy.ops.wm.read_factory_settings(use_empty=True)
mat = bpy.data.materials.new("Mark")
mat.use_nodes = True
p = mat.node_tree.nodes["Principled BSDF"]
p.inputs["Base Color"].default_value = (1, 1, 1, 1)
p.inputs["Emission Color"].default_value = (1, 1, 1, 1)
p.inputs["Emission Strength"].default_value = 2.0

for i, (faction, rel) in enumerate(MARKS.items()):
    path = os.path.join(ROOT, rel)
    if not os.path.exists(path):
        raise SystemExit(f"missing {path}")
    before = set(bpy.data.objects)
    bpy.ops.import_curve.svg(filepath=path)
    curves = [o for o in bpy.data.objects if o not in before and o.type == "CURVE"]
    if not curves:
        raise SystemExit(f"{rel}: no curves imported")
    for o in curves:
        o.data.dimensions = "2D"
        o.data.fill_mode = "BOTH"
    bpy.ops.object.select_all(action="DESELECT")
    for o in curves:
        o.select_set(True)
    bpy.context.view_layer.objects.active = curves[0]
    if len(curves) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    # measure, then extrude and bevel relative to the mark's own size
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    o.location = (0, 0, 0)
    size = max(o.dimensions.x, o.dimensions.y)
    if size <= 0:
        raise SystemExit(f"{rel}: empty mark")
    o.data.extrude = size * 0.045
    o.data.bevel_depth = size * 0.012
    o.data.bevel_resolution = 2
    o.data.resolution_u = 6
    bpy.ops.object.convert(target="MESH")
    o = bpy.context.view_layer.objects.active
    o.scale = (1 / size, 1 / size, 1 / size)
    o.rotation_euler = (math.radians(90), 0, 0)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(30))
    o.data.materials.clear()
    o.data.materials.append(mat)
    o.name = f"E_{faction}"
    o.location = (i * 1.6, 0, 0)
    print(faction, "faces", len(o.data.polygons))

bpy.ops.object.select_all(action="DESELECT")
for o in bpy.data.objects:
    o.select_set(o.name.startswith("E_"))
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_yup=True, export_apply=True, export_materials="EXPORT")
print("wrote", OUT)

if PREVIEW:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 1200, 700
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.02, 0.03, 0.06, 1)
    scene.world = world
    for o in bpy.data.objects:
        if o.name == "E_claude-code":
            o.active_material = None
            m = bpy.data.materials.new("c")
            m.use_nodes = True
            m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.85, 0.47, 0.34, 1)
            o.data.materials.append(m)
    bpy.ops.object.camera_add(location=(0.8, -3.2, 0.25), rotation=(math.radians(86), 0, 0))
    scene.camera = bpy.context.active_object
    bpy.ops.object.light_add(type="AREA", location=(1, -2, 2))
    bpy.context.active_object.data.energy = 200
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
    print("rendered", PREVIEW)
