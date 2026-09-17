# -*- coding: utf-8 -*-
"""
Проверка проходимости уровня: дойдёт ли герой от точки появления до перехода.

Стены на уровне не прорезаны, а выложены секциями, и проход — это пустота между
ними. Промахнуться на полметра при такой раскладке легко, а в игре это видно
только когда упрёшься. Дешевле спросить у сетки.

Что считать преградой, решает не этот скрипт: правила лежат в public/prefabs.json,
там же, где их читает игра. Мелочь под ногами расталкивается, через низкую мебель
герой перемахивает — преграждают дорогу только стены и то, что выше пояса.

Запуск: python3 tools/check_reachable.py public/locations/tutorial.json
"""
import json, math, sys
from collections import deque
from glb_sizes import read as read_sizes

STEP = 0.2       # шаг сетки, м
RADIUS = 0.38    # радиус героя: столько же в настройках игры

SIZES = read_sizes()
RULES = json.load(open('public/prefabs.json', encoding='utf-8'))


def stops(name):
    """Преграждает ли модель дорогу — по тем же правилам, что и в игре."""
    box = SIZES.get(name)
    if not box:
        return False

    groups = RULES['groups']
    group = max((g for g in groups if name.startswith(g)), key=len, default=None)
    rules = {**RULES['defaults'], **(groups.get(group) or {}), **RULES['overrides'].get(name, {})}

    volume = box['w'] * box['h'] * box['d']
    small = bool(rules.get('dynamicUnder')) and volume <= rules['dynamicUnder']
    if rules.get('dynamic') is True or small:
        return False  # подвижное просто расталкивают

    if rules.get('vault') is True or (rules.get('vaultUnder') and box['h'] <= rules['vaultUnder']):
        return False  # через такое перемахивают

    if not rules.get('solid'):
        return False
    return not (rules.get('minSolidHeight') and box['h'] < rules['minSolidHeight'])


def blocked(level):
    """Прямоугольники препятствий: (x0, x1, z0, z1), уже с запасом на героя."""
    out = []
    for prop in level['props']:
        if not stops(prop['prop']):
            continue
        box = SIZES[prop['prop']]

        angle = math.radians(prop.get('rotation', 0))
        cos, sin = abs(math.cos(angle)), abs(math.sin(angle))
        # Масштаб пишут и числом, и тройкой: редактор расстановки позволяет оба.
        scale = prop.get('scale', 1)
        scale = scale if isinstance(scale, list) else [scale] * 3

        # Осевой охват повёрнутой коробки; центр модели своей середине не равен,
        # и его смещение поворачивается вместе с ней.
        half_w = (box['w'] * scale[0] * cos + box['d'] * scale[2] * sin) / 2 + RADIUS
        half_d = (box['w'] * scale[0] * sin + box['d'] * scale[2] * cos) / 2 + RADIUS
        cx = box['cx'] * math.cos(angle) + box['cz'] * math.sin(angle)
        cz = -box['cx'] * math.sin(angle) + box['cz'] * math.cos(angle)

        x, z = prop['at'][0] + cx, prop['at'][1] + cz
        out.append((x - half_w, x + half_w, z - half_d, z + half_d))
    return out


def walk(level):
    """Волна от точки появления по всей доступной части уровня."""
    width, depth = level['size']
    cols, rows = int(width / STEP), int(depth / STEP)

    def to_cell(x, z):
        return int((x + width / 2) / STEP), int((z + depth / 2) / STEP)

    free = bytearray(b'\1') * (cols * rows)
    for x0, x1, z0, z1 in blocked(level):
        a, c = to_cell(x0, z0)
        b, d = to_cell(x1, z1)
        for row in range(max(0, c), min(rows, d + 1)):
            base = row * cols
            for col in range(max(0, a), min(cols, b + 1)):
                free[base + col] = 0

    start = to_cell(*level['spawn']['position'])
    seen = bytearray(cols * rows)
    queue = deque([start])
    seen[start[1] * cols + start[0]] = 1

    while queue:
        col, row = queue.popleft()
        for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nc, nr = col + dc, row + dr
            if not (0 <= nc < cols and 0 <= nr < rows):
                continue
            at = nr * cols + nc
            if seen[at] or not free[at]:
                continue
            seen[at] = 1
            queue.append((nc, nr))

    return seen, cols, rows, to_cell


def main(path):
    level = json.load(open(path, encoding='utf-8'))
    seen, cols, rows, to_cell = walk(level)

    def reached(x, z, name):
        col, row = to_cell(x, z)
        # Смотрим не в саму точку, а в её окрестность: цель может стоять вплотную
        # к стене, и её собственная клетка окажется занятой.
        near = 3
        ok = any(
            seen[r * cols + c]
            for r in range(max(0, row - near), min(rows, row + near + 1))
            for c in range(max(0, col - near), min(cols, col + near + 1))
        )
        print(('  дошёл  ' if ok else '  НЕ ДОШЁЛ '), name, [x, z])
        return ok

    print(path)
    good = reached(*level['gun']['at'], 'ружьё')
    for i, mark in enumerate(level.get('guide', []), 1):
        good &= reached(*mark['at'], f'веха {i}')
    good &= reached(level['exitAt'][0], level['exitAt'][1], 'переход')

    for i, z in enumerate(level.get('zombies', []), 1):
        if not reached(*z['at'], f'зомби {i}'):
            good = False

    sys.exit(0 if good else 1)


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'public/locations/tutorial.json')
