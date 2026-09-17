"""
Экспорт библиотеки моделей из Env.blend в props.glb.

Никаких правок геометрии: что лежит в .blend, то и уезжает в игру.
Пропускаются только служебные объекты и хилки — у них своя судьба.

Запуск вручную:
  /Applications/Blender.app/Contents/MacOS/Blender -b Env.blend --python Game/tools/export_props.py

Из игры — кнопкой «Обновить модели» в панели разработчика.
"""

import bpy
import os

OUT = os.path.join(os.path.dirname(bpy.data.filepath), 'Game/public/assets/models/props.glb')
SKIP_PREFIXES = ('Food_',)   # хилки живут отдельно от декора локаций
SKIP_NAMES = ('Floor', 'Weapon_Knife')   # нож из игры убран, в .blend остаётся


def exportable(obj):
    return (obj.type == 'MESH'
            and not obj.name.startswith(SKIP_PREFIXES)
            and obj.name not in SKIP_NAMES)

def guard():
    """Скрипт работает только в фоновом Blender.

    В фоновом режиме файл читается с диска, правки живут в памяти процесса и
    на диск не попадают. Запуск в открытом окне менял бы сцену пользователя —
    .blend для нас только на чтение.
    """
    if not bpy.app.background:
        print('!! экспорт отменён: запускайте Blender с флагом -b, .blend не для правки')
        return False
    return True


def main():
    picked = [o.name for o in bpy.data.objects if exportable(o)]

    # Экспортёр берёт только видимые объекты: спрятанный в Blender глазом или
    # выключенный для рендера (галочка с камерой) молча не попадает в GLB,
    # и в игре остаётся прежняя версия модели.
    for obj in bpy.data.objects:
        if exportable(obj):
            obj.hide_set(False)
            obj.hide_viewport = False
            obj.hide_render = False

    for obj in bpy.data.objects:
        obj.select_set(exportable(obj))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format='GLB',
        use_selection=True,
        export_apply=True,   # применять модификаторы, иначе правки через них не уедут
        export_yup=True,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_cameras=False,
        export_lights=False,
    )

    for obj in bpy.data.objects:
        obj.select_set(False)

    print(f'моделей: {len(picked)}')
    print(f'{OUT} — {round(os.path.getsize(OUT) / 1024)} KB')


if guard():
    main()
