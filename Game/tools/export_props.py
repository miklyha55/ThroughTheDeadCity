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
import bmesh
import os
from collections import defaultdict

OUT = os.path.join(os.path.dirname(bpy.data.filepath), 'Game/public/assets/models/props.glb')
LIFT = 0.003        # на сколько метров приподнимаем слой над подложкой
PASSES = 4          # поднятый слой может сесть в плоскость соседней детали — разводим за несколько проходов
SKIP_PREFIXES = ('Food_',)   # хилки живут отдельно от декора локаций
SKIP_NAMES = ('Floor', 'Prop_Rubble', 'Prop_Sandbags', 'Prop_FireBarrel')   # выведены из проекта
SOURCE_SUFFIX = '__source'   # так помечен оригинал, пока его подменяет почищенная копия


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


def mesh_islands(mesh):
    """Разбивает меш на связные куски: отдельные жерди, столбы, панели."""
    parent = list(range(len(mesh.vertices)))

    def root(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for edge in mesh.edges:
        a, b = root(edge.vertices[0]), root(edge.vertices[1])
        if a != b:
            parent[b] = a

    islands = defaultdict(list)
    for i in range(len(mesh.vertices)):
        islands[root(i)].append(i)
    return list(islands.values())


def fix_ranch_rail(mesh, originals):
    """Ставит на место просевшую половину средней жерди у Fence_RanchRail.

    Средняя жердь в модели разломана надвое: левая половина держится на высоте
    0.71..0.81, а правая просела до 0.44..0.56 и висит в воздухе без опоры.
    Поднимаем её в общую линию и стыкуем с левой половиной.
    """
    LEFT_END = 0.301      # где заканчивается левая половина жерди
    POST_X = 2.0          # до какого столба должна дотягиваться правая
    LOW, HIGH = 0.71, 0.81

    fallen = []
    for island in mesh_islands(mesh):
        zs = [mesh.vertices[i].co.z for i in island]
        xs = [mesh.vertices[i].co.x for i in island]
        if 0.40 < min(zs) and max(zs) < 0.62 and min(xs) > 0.3:
            fallen.append(island)

    if len(fallen) != 1:
        print(f'  ! Fence_RanchRail: ожидалась одна просевшая жердь, найдено {len(fallen)} — пропускаю')
        return 0

    island = fallen[0]
    middle_z = (min(mesh.vertices[i].co.z for i in island) + max(mesh.vertices[i].co.z for i in island)) / 2
    for i in island:
        v = mesh.vertices[i]
        originals.setdefault((mesh.name, i), v.co.copy())
        v.co.z = LOW if v.co.z < middle_z else HIGH
        v.co.x = LEFT_END if v.co.x < 1.0 else POST_X
    return len(island)


def fix_tractor_fenders(mesh, originals):
    """Поднимает крылья задних колёс трактора, утопленные в шинах.

    Пластины крыльев лежат на высоте 1.3..1.4, а верх колеса — на 1.6, поэтому
    крыло наполовину внутри шины. Поднимаем его над колесом и расширяем внутрь
    до ширины покрышки, чтобы оно накрывало колесо, а не висело полоской сбоку.
    """
    WHEEL_TOP = 1.6
    THICKNESS = 0.1
    INNER_Y = 0.64        # внутренний край колеса (шина занимает 0.69..1.15)

    fenders = []
    for island in mesh_islands(mesh):
        zs = [mesh.vertices[i].co.z for i in island]
        ys = [mesh.vertices[i].co.y for i in island]
        if 1.2 < min(zs) and max(zs) < 1.5 and min(abs(y) for y in ys) > 1.0:
            fenders.append(island)

    if len(fenders) != 2:
        print(f'  ! Heavy_Tractor: ожидалось два крыла, найдено {len(fenders)} — пропускаю')
        return 0

    moved = 0
    for island in fenders:
        zs = [mesh.vertices[i].co.z for i in island]
        middle = (min(zs) + max(zs)) / 2
        outer = max(abs(mesh.vertices[i].co.y) for i in island)
        for i in island:
            v = mesh.vertices[i]
            originals.setdefault((mesh.name, i), v.co.copy())
            v.co.z = WHEEL_TOP + (0 if v.co.z < middle else THICKNESS)
            if abs(v.co.y) < outer - 0.01:
                v.co.y = INNER_Y if v.co.y > 0 else -INNER_Y
            moved += 1
    return moved


def drop_stray_plank(name='Prop_Crate'):
    """Убирает у ящика лишний брусок, торчащий из передней стенки.

    Брусок 5 x 4 см проходит ящик насквозь: уходит на 12 см под пол и выступает
    над крышкой. Ни на что не опирается и ни с чем не стыкуется — просто мусор.

    Меш правится в копии объекта, оригинал остаётся нетронутым: копия временно
    забирает себе имя, чтобы в GLB нода называлась как обычно.
    """
    source = bpy.data.objects[name]
    mesh = source.data

    doomed = []
    for island in mesh_islands(mesh):
        xs = [mesh.vertices[i].co.x for i in island]
        ys = [mesh.vertices[i].co.y for i in island]
        zs = [mesh.vertices[i].co.z for i in island]
        thin = (max(xs) - min(xs)) < 0.07 and (max(ys) - min(ys)) < 0.07
        sticks_out = min(zs) < -0.05 and max(zs) > 0.7
        if thin and sticks_out:
            doomed.append(set(island))

    if len(doomed) != 1:
        print(f'  ! {name}: ожидалась одна лишняя планка, найдено {len(doomed)} — пропускаю')
        return None

    clean = source.copy()
    clean.data = mesh.copy()
    bpy.context.scene.collection.objects.link(clean)

    bm = bmesh.new()
    bm.from_mesh(clean.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in doomed[0]], context='VERTS')
    bm.to_mesh(clean.data)
    bm.free()

    source.name = f'{name}__source'
    clean.name = name
    print(f'  {name}: лишняя планка удалена ({len(doomed[0])} вершин)')
    return source, clean


def restore_stray_plank(swap, name='Prop_Crate'):
    """Возвращает сцене исходный ящик и убирает временную копию."""
    if not swap:
        return
    source, clean = swap
    bpy.data.objects.remove(clean, do_unlink=True)
    source.name = name


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

    fixed = fix_ranch_rail(bpy.data.objects['Fence_RanchRail'].data, originals)
    if fixed:
        print(f'  Fence_RanchRail: просевшая жердь возвращена в линию ({fixed} вершин)')

    fenders = fix_tractor_fenders(bpy.data.objects['Heavy_Tractor'].data, originals)
    if fenders:
        print(f'  Heavy_Tractor: крылья подняты над колёсами ({fenders} вершин)')

    crate_swap = drop_stray_plank()

    for obj in bpy.data.objects:
        if obj.type != 'MESH' or obj.name.startswith(SKIP_PREFIXES) or obj.name in SKIP_NAMES:
            continue
        if SOURCE_SUFFIX in obj.name:
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
                       and obj.name not in SKIP_NAMES
                       and SOURCE_SUFFIX not in obj.name)

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
    restore_stray_plank(crate_swap)
    for (mesh_name, vi), co in originals.items():
        bpy.data.meshes[mesh_name].vertices[vi].co = co
    for obj in bpy.data.objects:
        obj.select_set(False)
    print('геометрия возвращена в исходное состояние')


main()
