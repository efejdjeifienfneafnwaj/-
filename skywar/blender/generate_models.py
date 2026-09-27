"""蒼穹艦隊戦 用 3Dモデル生成スクリプト（Blender 3.6 / 4.x）

使い方（skywar ディレクトリで実行）:
    blender -b -P blender/generate_models.py

models/ally_battleship.glb, models/enemy_carrier.glb, models/drone.glb を出力します。
ゲームは起動時にこれらを読み込み、見つからなければ内蔵の簡易モデルを使います。
当たり判定はゲーム側（js/main.js）の寸法で固定なので、船体の大まかな寸法は変えないでください。

座標系: 引数は Three.js の座標 (X右, Y上, Z手前)。glTF書き出し時に Y-up へ変換されるので、
Blender 上では (x, -z, y) に配置します。
"""
import math
import os

import bpy

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "models")


def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for block in (bpy.data.meshes, bpy.data.materials):
        for item in list(block):
            block.remove(item)


def material(name, color, metallic=0.6, roughness=0.45, emission=None, strength=3.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission:
        key = "Emission Color" if "Emission Color" in bsdf.inputs else "Emission"
        bsdf.inputs[key].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    return mat


def to_blender(x, y, z):
    return (x, -z, y)


def box(w, h, d, x, y, z, mat, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=to_blender(x, y, z))
    obj = bpy.context.active_object
    obj.scale = (w, d, h)
    bpy.ops.object.transform_apply(scale=True)
    if bevel > 0:
        mod = obj.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
    obj.data.materials.append(mat)
    return obj


def cyl(r, depth, x, y, z, mat, along_z=True, r2=None):
    """along_z=True で Three.js の Z軸（前後）方向に向いた円柱"""
    bpy.ops.mesh.primitive_cone_add(vertices=24, radius1=r, radius2=r2 if r2 is not None else r,
                                    depth=depth, location=to_blender(x, y, z))
    obj = bpy.context.active_object
    if along_z:
        obj.rotation_euler = (math.pi / 2, 0, 0)
    obj.data.materials.append(mat)
    return obj


def join_and_export(name):
    bpy.ops.object.select_all(action="SELECT")
    bpy.context.view_layer.objects.active = bpy.context.selected_objects[0]
    for obj in bpy.context.selected_objects:
        bpy.context.view_layer.objects.active = obj
        for mod in obj.modifiers:
            bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.join()
    bpy.ops.object.shade_flat()
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, f"{name}.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_yup=True, export_apply=True)
    print("書き出し:", path)


def build_ally():
    reset_scene()
    hull = material("ally_hull", (0.52, 0.6, 0.7))
    dark = material("ally_dark", (0.2, 0.25, 0.32), 0.7, 0.5)
    light = material("ally_light", (0.25, 0.88, 1.0), 0, 0.3, (0.25, 0.88, 1.0))
    floor = material("hangar_floor", (0.16, 0.19, 0.23), 0.4, 0.7)
    stripe = material("stripe", (1.0, 0.75, 0.1), 0, 0.5, (1.0, 0.6, 0.0), 1.0)

    box(60, 40, 210, 0, 0, 45, hull, 1.5)
    box(60, 12, 90, 0, -14, -105, hull, 0.8)
    box(60, 12, 90, 0, 14, -105, hull, 0.8)
    box(15, 16, 90, -22.5, 0, -105, hull, 0.5)
    box(15, 16, 90, 22.5, 0, -105, hull, 0.5)
    box(40, 12, 40, 0, -14, -170, dark, 2)
    box(30, 36, 50, 0, 38, 60, dark, 1.5)
    box(20, 10, 30, 0, 60, 60, hull, 1)
    box(80, 6, 60, 0, -4, 90, hull, 1)
    box(30, 18, 260, 0, -28, 20, dark, 1.5)
    box(29, 0.3, 90, 0, -7.9, -105, floor)
    for i in range(9):
        box(1.2, 0.35, 5, 0, -7.7, -65 - i * 10, stripe)
    for i in range(6):
        box(0.6, 0.6, 3, -14.4, 5, -70 - i * 15, light)
        box(0.6, 0.6, 3, 14.4, 5, -70 - i * 15, light)
    box(30, 0.8, 0.8, 0, 7.5, -150, light)
    # 艦橋の窓
    box(26, 3, 0.5, 0, 48, 34.8, light)
    for x in (-18, 18):
        for y in (-8, 8):
            cyl(8, 12, x, y, 155, dark, r2=7)
            cyl(6, 1, x, y, 161.5, light)
    for z in (-20, 20, 110):
        bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=8.5, depth=5, location=to_blender(0, 22.5, z))
        bpy.context.active_object.data.materials.append(dark)
        box(3, 3, 26, -3, 24, z - 13, dark)
        box(3, 3, 26, 3, 24, z - 13, dark)
    join_and_export("ally_battleship")


def build_enemy():
    reset_scene()
    hull = material("enemy_hull", (0.35, 0.28, 0.28))
    dark = material("enemy_dark", (0.16, 0.13, 0.14), 0.7, 0.5)
    light = material("enemy_light", (1.0, 0.18, 0.1), 0, 0.3, (1.0, 0.12, 0.05), 4)
    gun = material("gun", (0.18, 0.2, 0.24), 0.8, 0.35)

    box(90, 28, 420, 0, 0, 0, hull, 2)
    box(120, 4, 470, 0, 16, 0, dark, 0.8)
    box(18, 40, 70, 48, 38, -20, hull, 1.5)
    box(10, 14, 30, 48, 64, -20, dark, 1)
    box(50, 16, 320, 0, -21, 0, dark, 1.5)
    box(60, 20, 40, 0, 0, 230, dark, 2)
    box(100, 3, 1, 0, 18.5, 234.5, light)
    for i in range(10):
        box(1.5, 0.6, 12, -3, 18.4, 200 - i * 40, light)
        box(1.5, 0.6, 12, 3, 18.4, 200 - i * 40, light)
    for x in (-46, 46):
        for i in range(8):
            box(1, 2, 8, x, 0, 180 - i * 50, light)
    box(16, 2, 0.5, 48, 50, 15.3, light)  # アイランド窓
    cyl(5, 30, 0, 0, 262, gun)
    join_and_export("enemy_carrier")


def build_drone():
    reset_scene()
    hull = material("drone_hull", (0.35, 0.28, 0.28))
    dark = material("drone_dark", (0.16, 0.13, 0.14), 0.7, 0.5)
    light = material("drone_light", (1.0, 0.18, 0.1), 0, 0.3, (1.0, 0.12, 0.05), 5)
    # ドローンは +Z が前方（Three.js の lookAt に合わせる）
    cyl(1.4, 6, 0, 0, 0, hull, r2=0.0)
    box(8, 0.3, 2, 0, 0, -1, dark)
    box(0.3, 1.8, 1.6, 0, 0.9, -2, dark)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.8, location=to_blender(0, 0, -3))
    bpy.context.active_object.data.materials.append(light)
    join_and_export("drone")


if __name__ == "__main__":
    build_ally()
    build_enemy()
    build_drone()
    print("完了：", os.path.abspath(OUT_DIR))
