"""
Экспорт библиотеки пропов из Env.blend в props.glb.

Перед экспортом приподнимает «декали» — мелкие грани, лежащие ровно в плоскости
крупной поверхности (двери и окна на стенах, номера на кузовах, разметка на асфальте).
Нулевой зазор между ними даёт z-fighting: в движке обе грани получают одинаковую
глубину и поверхность мерцает при движении камеры.

Правка делается только в памяти и откатывается после экспорта — .blend не меняется.

Запуск:
  /Applications/Blender.app/Contents/MacOS/Blender -b Env.blend --python tools/export_props.py
"""

import bpy
import os
from collections import defaultdict

OUT = os.path.join(os.path.dirname(bpy.data.filepath), 'Game/public/assets/models/props.glb')
LIFT = 0.003        # на сколько метров приподнимаем слой над подложкой
PASSES = 4          # поднятый слой может сесть в плоскость соседней детали — разводим за несколько проходов
SKIP_PREFIXES = ('Food_',)   # хилки живут отдельно от декора локаций
SKIP_NAMES = ('Floor',)


def face_bbox_2d(poly, mesh, axis):
    """Габариты грани в плоскости, перпендикулярной axis."""
    a1, a2 = [i for i in range(3) if i != axis]
    xs = [mesh.vertices[v].co[a1] for v in poly.vertices]
    ys = [mesh.vertices[v].co[a2] for v in poly.vertices]
    return min(xs), min(ys), max(xs), max(ys)


def boxes_overlap(b1, b2, eps=-0.01):
    return (b1[0] < b2[2] + eps and b2[0] < b1[2] + eps and
            b1[1] < b2[3] + eps and b2[1] < b1[3] + eps)


def find_lifts(mesh):
    """Сколько и куда сдвинуть каждую грань, чтобы наложения разошлись по глубине.

    Грани, лежащие в одной плоскости и перекрывающиеся, собираются в группу.
    Внутри группы материалы выстраиваются по суммарной площади: самый крупный
    остаётся подложкой на месте, остальные поднимаются слоями по LIFT.
    Поднимать всё подряд бесполезно — слои уедут вместе и снова совпадут.
    """
    planes = defaultdict(list)
    for poly in mesh.polygons:
        n = poly.normal
        axis = max(range(3), key=lambda i: abs(n[i]))
        if abs(n[axis]) < 0.99:
            continue                      # косые грани в плоскость не складываются
        planes[(axis, round(poly.center[axis], 3))].append(poly)

    lifts = {}
    for (axis, _), polys in planes.items():
        if len(polys) < 2:
            continue

        boxes = {p.index: face_bbox_2d(p, mesh, axis) for p in polys}
        neighbours = defaultdict(set)
        for i in range(len(polys)):
            for j in range(i + 1, len(polys)):
                a, b = polys[i], polys[j]
                if a.normal.dot(b.normal) < 0.99:
                    continue              # встречные грани решает backface culling
                if set(a.vertices) & set(b.vertices):
                    continue              # соседние грани одной оболочки, а не наложение
                if not boxes_overlap(boxes[a.index], boxes[b.index]):
                    continue
                neighbours[a.index].add(b.index)
                neighbours[b.index].add(a.index)

        for group in connected_groups(neighbours):
            area_by_material = defaultdict(float)
            for index in group:
                area_by_material[mesh.polygons[index].material_index] += mesh.polygons[index].area
            if len(area_by_material) < 2:
                continue                  # один материал — мерцание незаметно, не трогаем

            order = sorted(area_by_material, key=lambda m: -area_by_material[m])
            level_of = {material: level for level, material in enumerate(order)}
            for index in group:
                poly = mesh.polygons[index]
                level = level_of[poly.material_index]
                if level:
                    lifts[index] = poly.normal * (level * LIFT)
    return lifts


def connected_groups(neighbours):
    """Компоненты связности графа перекрытий."""
    seen = set()
    for start in neighbours:
        if start in seen:
            continue
        stack, group = [start], []
        seen.add(start)
        while stack:
            node = stack.pop()
            group.append(node)
            for other in neighbours[node]:
                if other not in seen:
                    seen.add(other)
                    stack.append(other)
        yield group


def main():
    originals = {}
    lifted = 0

    for obj in bpy.data.objects:
        if obj.type != 'MESH' or obj.name.startswith(SKIP_PREFIXES) or obj.name in SKIP_NAMES:
            continue
        mesh = obj.data
        moved_here = 0

        for _ in range(PASSES):
            lifts = find_lifts(mesh)
            if not lifts:
                break

            # Вершина может принадлежать сразу нескольким слоям (угол кабины — стеклу и стойке).
            # Тогда её надо сдвинуть по каждому направлению: пропустить второе смещение значит
            # оставить грань в исходной плоскости, то есть не починить ничего.
            moves = defaultdict(dict)
            for poly_index, shift in lifts.items():
                key = (round(shift.x, 4), round(shift.y, 4), round(shift.z, 4))
                for vi in mesh.polygons[poly_index].vertices:
                    moves[vi][key] = shift

            for vi, shifts in moves.items():
                originals.setdefault((mesh.name, vi), mesh.vertices[vi].co.copy())
                for shift in shifts.values():
                    mesh.vertices[vi].co += shift
            moved_here += len(lifts)
            mesh.update()

        if moved_here:
            lifted += moved_here
            print(f'  {obj.name}: поднято граней {moved_here}')

    print(f'всего поднято граней: {lifted}, сдвинуто вершин: {len(originals)}')

    for obj in bpy.data.objects:
        obj.select_set(obj.type == 'MESH'
                       and not obj.name.startswith(SKIP_PREFIXES)
                       and obj.name not in SKIP_NAMES)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format='GLB',
        use_selection=True,
        export_apply=False,
        export_yup=True,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_cameras=False,
        export_lights=False,
    )
    print(f'{OUT} — {round(os.path.getsize(OUT) / 1024)} KB')

    # возвращаем сцену в исходное состояние: .blend остаётся нетронутым
    for (mesh_name, vi), co in originals.items():
        bpy.data.meshes[mesh_name].vertices[vi].co = co
    for obj in bpy.data.objects:
        obj.select_set(False)
    print('геометрия возвращена в исходное состояние')


main()
