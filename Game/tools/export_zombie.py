"""
Экспорт зомби из Zombie1, Zombie2 или ZombieBoss (…/Zombie.blend) в GLB.

Имя выходного файла берётся из имени папки: Zombie1 → zombie1.glb, ZombieBoss → zombieboss.glb.
Никаких правок геометрии и анимаций: что в .blend, то и уезжает в игру.

Запуск:
  /Applications/Blender.app/Contents/MacOS/Blender -b Zombie1/Zombie.blend \
    --python Game/tools/export_zombie.py

Из игры — кнопкой «Обновить модели» в панели разработчика.
"""

import bpy
import os

SOURCE_DIR = os.path.dirname(bpy.data.filepath)          # …/ThroughTheDeadCity/Zombie1
PROJECT_ROOT = os.path.dirname(SOURCE_DIR)
OUT = os.path.join(PROJECT_ROOT, 'Game/public/assets/models',
                   f'{os.path.basename(SOURCE_DIR).lower()}.glb')

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
    # камеры и прочая служебная мелочь в игру не нужны — экспортируем только скин
    for obj in bpy.data.objects:
        wanted = obj.type in {'ARMATURE', 'MESH'}
        if wanted:
            obj.hide_set(False)
            obj.hide_viewport = False
            obj.hide_render = False
        obj.select_set(wanted)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format='GLB',
        use_selection=True,
        export_apply=False,      # скин ломается, если применять модификаторы
        export_yup=True,
        export_skins=True,
        export_morph=False,
        export_animations=True,
        export_animation_mode='ACTIONS',
        export_force_sampling=True,
        export_optimize_animation_size=False,
        export_anim_single_armature=True,
        export_bake_animation=False,
        export_cameras=False,
        export_lights=False,
    )

    for obj in bpy.data.objects:
        obj.select_set(False)

    fps = bpy.context.scene.render.fps
    for action in bpy.data.actions:
        length = (action.frame_range[1] - action.frame_range[0]) / fps
        print(f'  {action.name}: {round(length, 2)} с')
    print(f'{OUT} — {round(os.path.getsize(OUT) / 1024)} KB')


if guard():
    main()
