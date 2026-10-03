"""Build the Clawd mascot as a game-ready GLB (headless Blender).

Run: python3 tools/build_clawd.py   (needs `pip install bpy`)
Metres, +Y up, character faces +Z in the GLB. Origin at the feet.
One shared material (vertex colours), separate named parts for animation.
"""
import math, os, bpy, bmesh
from mathutils import Vector

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'models', 'clawd.glb')

ORANGE = (0.851, 0.467, 0.341)   # Clawd terracotta  #D97757
SHADE  = (0.745, 0.384, 0.265)   # slightly darker for limbs
DARK   = (0.06, 0.05, 0.05)      # eyes

def srgb_to_lin(c):
    return tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c)

bpy.ops.wm.read_factory_settings(use_empty=True)

mat = bpy.data.materials.new('Clawd_Mat')
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes['Principled BSDF']
col = nt.nodes.new('ShaderNodeVertexColor'); col.layer_name = 'Col'
nt.links.new(col.outputs['Color'], bsdf.inputs['Base Color'])
bsdf.inputs['Metallic'].default_value = 0.0
bsdf.inputs['Roughness'].default_value = 0.55

def box(bm, center, size, color, bevel=0.012):
    cx, cy, cz = center; sx, sy, sz = size
    res = bmesh.ops.create_cube(bm, size=1.0)
    verts = res['verts']
    for v in verts:
        v.co = Vector((cx + v.co.x * sx, cy + v.co.y * sy, cz + v.co.z * sz))
    if bevel:
        edges = list({e for v in verts for e in v.link_edges})
        bmesh.ops.bevel(bm, geom=edges, offset=bevel, segments=1, affect='EDGES')
    return verts

def make(name, parts, pivot=(0, 0, 0)):
    """parts: list of (center, size, colour, bevel) in character space (Blender Z-up, front = -Y)."""
    bm = bmesh.new()
    lay = bm.loops.layers.color.new('Col')
    for center, size, colour, bevel in parts:
        before = set(bm.faces)
        box(bm, center, size, colour, bevel)
        lc = (*colour, 1.0)  # byte colour attributes are sRGB-encoded; the exporter converts
        for f in set(bm.faces) - before:
            for l in f.loops: l[lay] = lc
    bm.normal_update()
    p = Vector(pivot)
    for v in bm.verts: v.co -= p
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    me.materials.append(mat)
    me.shade_smooth(); me.set_sharp_from_angle(angle=math.radians(35)) if hasattr(me, 'set_sharp_from_angle') else None
    ob = bpy.data.objects.new(name, me)
    ob.location = p
    bpy.context.scene.collection.objects.link(ob)
    return ob

# --- dimensions (Blender: X right, Y back, Z up; front faces -Y) ---
LEG_H, BODY_H, BODY_W, BODY_D = 0.16, 0.50, 0.90, 0.46
body_z = LEG_H + BODY_H / 2

body = make('Clawd_Body', [
    ((0, 0, body_z), (BODY_W, BODY_D, BODY_H), ORANGE, 0.02),
    # eyes: tall dark rectangles on the front face
    ((-0.20, -BODY_D / 2 - 0.004, body_z + 0.06), (0.09, 0.02, 0.17), DARK, 0.004),
    (( 0.20, -BODY_D / 2 - 0.004, body_z + 0.06), (0.09, 0.02, 0.17), DARK, 0.004),
])

arm_z = body_z - 0.02
# arms pivot at the shoulder (body edge)
armL = make('Clawd_Arm_L', [((-BODY_W / 2 - 0.085, 0, arm_z), (0.17, 0.2, 0.16), SHADE, 0.012)],
            pivot=(-BODY_W / 2, 0, arm_z))
armR = make('Clawd_Arm_R', [((BODY_W / 2 + 0.085, 0, arm_z), (0.17, 0.2, 0.16), SHADE, 0.012)],
            pivot=(BODY_W / 2, 0, arm_z))

legs = []
for i, x in enumerate((-0.33, -0.11, 0.11, 0.33)):
    # pivot at the hip (top of leg) so rotating swings the foot
    legs.append(make(f'Clawd_Leg_{i}', [((x, 0, LEG_H / 2), (0.14, 0.16, LEG_H), SHADE, 0.01)],
                     pivot=(x, 0, LEG_H)))

# --- root + sockets ---
root = bpy.data.objects.new('Clawd', None); root.empty_display_type = 'PLAIN_AXES'
bpy.context.scene.collection.objects.link(root)
for ob in [body, armL, armR, *legs]:
    ob.parent = root
for name, loc in {'Head_Top': (0, 0, LEG_H + BODY_H), 'Hand_L': (-0.58, -0.05, arm_z),
                  'Hand_R': (0.58, -0.05, arm_z), 'Cast_Point': (0, -0.45, body_z)}.items():
    e = bpy.data.objects.new(name, None); e.location = loc; e.parent = root
    bpy.context.scene.collection.objects.link(e)

# --- UVs ---
for ob in [body, armL, armR, *legs]:
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')

bpy.ops.object.select_all(action='SELECT')
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=True,
                          use_selection=True, export_vertex_color='ACTIVE' if False else 'MATERIAL',
                          export_cameras=False, export_lights=False)
tris = sum(len(o.data.polygons) for o in [body, armL, armR, *legs])
print('exported', os.path.abspath(OUT))
