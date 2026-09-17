# -*- coding: utf-8 -*-
"""
Застройка и заборы «Северного перекрёстка».

Улицы задают всё остальное. Доступная часть уровня — крест: главная улица с
запада на восток и боковая с севера на юг, перекрытая с обоих концов. Дома
стоят фасадами к улицам, по кварталам между ними; забор идёт замкнутым контуром
по краю проезжей части и упирается в стены домов там, где они сами служат оградой.

Почему раскладка выписана списком, а не считается:
    Дома тут крупные, кварталы тесные, и всякий расчёт «подвинуть, пока не
    разойдутся» кончается кашей: тронешь один — он толкает соседа, тот третьего,
    и ряд расползается. Список же читается с одного взгляда и правится точечно.

Запуск: python3 tools/layout_crossroads.py
"""
import json, math

LEVEL = 'public/locations/crossroads.json'
SIZES = json.load(open('/tmp/sizes.json', encoding='utf-8'))

SECTION, THICK = 4.09, 1.8   # секция сетки: длина и толщина, м

MAIN = SIDE = 12             # полуширина улиц: полотно 8 м плюс обочины

# Торцы стоят на самом краю площадки, а не в двух метрах от него.
# Иначе между торцом и краем остаётся полоса, и через проём на старте уровень
# обходится снаружи кругом: игра туда пускает, а забора там нет.
WEST, EAST = -56, 56         # концы главной улицы — ровно край площадки
NORTH, SOUTH = 22, -22       # и боковой: дальше заграждения

GAP_WEST = (-8, 8)           # проём, откуда игрок приходит
GAP_EAST = (-12, 0)          # и куда уходит: круг перехода на z = -6

CLEAR = 1.4                  # от линии забора до стены дома, м
FACADE = MAIN + THICK / 2 + CLEAR   # где стоит фасад: 14.3 м от оси улицы

level = json.load(open(LEVEL, encoding='utf-8'))


def size(name):
    s = SIZES[name]
    return s['w'], s['d'], s['cx'], s['cz']


def turned(name, rot):
    """Габариты и смещение центра модели после поворота."""
    w, d, cx, cz = size(name)
    t = math.radians(rot)
    cos, sin = math.cos(t), math.sin(t)
    return (abs(w * cos) + abs(d * sin),
            abs(w * sin) + abs(d * cos),
            cx * cos + cz * sin,
            -cx * sin + cz * cos)


def facing(name, rot, along, edge):
    """
    Точка `at` для дома, поставленного фасадом на заданную линию.

    Началом координат у моделей служит что угодно, и у половины из них центр
    сдвинут на метры. Поэтому место задаётся тем, что видно на площадке —
    серединой фасада и линией, на которой он стоит, — а `at` из этого выводится.

    @param along — середина дома вдоль улицы
    @param edge — знаковое расстояние до линии фасада: плюс на север, минус на юг
    """
    w, d, cx, cz = turned(name, rot)

    if abs(rot) % 180 == 0 or True:   # фасад к главной улице: линия по z
        z = edge + (d / 2 if edge > 0 else -d / 2) - cz
        return [round(along - cx, 2), round(z, 2)]


def sideways(name, rot, edge, along):
    """То же для дома вдоль боковой улицы: фасад на линии по x."""
    w, d, cx, cz = turned(name, rot)
    x = edge + (w / 2 if edge > 0 else -w / 2) - cx
    return [round(x, 2), round(along - cz, 2)]


# ── застройка ───────────────────────────────────────────────────────────────
# Вдоль главной улицы: (модель, поворот, середина по x, к северу ли фасадом).
# Повороты 180 и 0 разворачивают дом лицом к дороге.
MAIN_STREET = [
    ('Bld_Shop',      180, -44,  True),
    ('Bld_Diner',     180, -27,  True),
    ('Bld_AutoShop',  180,  29,  True),
    ('Bld_Warehouse', 180,  47,  True),

    ('Bld_Warehouse',   0, -45, False),
    # Не мотель: он почти четырнадцать метров в глубину и упирался задней
    # стеной в дом на боковой улице. Склад той же длины, но вдвое мельче.
    ('Bld_Barn',        0, -27, False),
    ('Bld_Shop',        0,  27, False),
    ('Bld_Diner',       0,  46, False),
]

# Вдоль боковой: (модель, поворот, середина по z, к востоку ли фасадом).
#
# Дома тут нарочно мелкие и отнесены к самому краю поля. Между заграждением и
# краем всего восемнадцать метров, и всё крупное — тот же `Bld_SuburbHouse` в
# восемнадцать с половиной — либо упиралось в угловой дом главной улицы, либо
# наполовину вылезало за площадку, в туман.
SIDE_STREET = [
    ('Bld_Farmhouse', -90,  33,  True),
    ('Bld_Trailer',    90,  33, False),
    ('Bld_Ranch',      90, -33, False),
    ('Bld_Ranch',     -90, -33,  True),
]

дома = []
for name, rot, along, north in MAIN_STREET:
    at = facing(name, rot, along, FACADE if north else -FACADE)
    дома.append({'prop': name, 'at': at, 'rotation': rot})

for name, rot, along, east in SIDE_STREET:
    edge = (SIDE + THICK / 2 + CLEAR) * (1 if east else -1)
    at = sideways(name, rot, edge, along)
    дома.append({'prop': name, 'at': at, 'rotation': rot})


def rect(prop):
    w, d, cx, cz = turned(prop['prop'], prop.get('rotation', 0))
    x, z = prop['at'][0] + cx, prop['at'][1] + cz
    return x - w / 2, z - d / 2, x + w / 2, z + d / 2


def overlap(a, b, margin=0.0):
    return not (a[2] + margin <= b[0] or a[0] - margin >= b[2]
                or a[3] + margin <= b[1] or a[1] - margin >= b[3])


коробки = [rect(h) for h in дома]


def row(along, fixed, start, end, gap=None):
    """
    Ряд секций по отрезку.

    Число секций округляется ВВЕРХ: при округлении к ближайшему шаг выходит
    длиннее самой секции, и между соседними остаётся щель — на десятиметровом
    отрезке она доходила до метра, ровно столько, чтобы в неё пролез человек.
    Здесь шаг всегда короче секции, и они идут внахлёст. Концы отрезка ложатся
    точно в углы контура, поэтому стороны сходятся без зазора.
    """
    length = abs(end - start)
    count = max(1, math.ceil(length / SECTION))
    step = length / count
    sign = 1 if end > start else -1
    out = []

    for i in range(count):
        at = start + sign * step * (i + 0.5)
        if gap and gap[0] <= at <= gap[1]:
            continue

        if along == 'x':
            x, z, rot = at, fixed, 0
            box = (x - SECTION / 2, z - THICK / 2, x + SECTION / 2, z + THICK / 2)
        else:
            x, z, rot = fixed, at, 90
            box = (x - THICK / 2, z - SECTION / 2, x + THICK / 2, z + SECTION / 2)

        # Дом на пути — секция не нужна: стена сама продолжает ограду.
        if any(overlap(box, b) for b in коробки):
            continue

        out.append({'prop': 'Fence_ChainLink', 'at': [round(x, 2), round(z, 2)], 'rotation': rot})
    return out


# Обход контура по кругу: концы отрезков сходятся в углах.
заборы = []
заборы += row('x', -MAIN, WEST, -SIDE)            # юг главной, запад
заборы += row('z', -SIDE, -MAIN, SOUTH)           # западная стенка южной ветки
заборы += row('z',  SIDE, SOUTH, -MAIN)           # восточная стенка южной ветки
заборы += row('x', -MAIN, SIDE, EAST)             # юг главной, восток
заборы += row('z',  EAST, -MAIN, MAIN, GAP_EAST)  # восточный торец с проёмом
заборы += row('x',  MAIN, EAST, SIDE)             # север главной, восток
заборы += row('z',  SIDE, MAIN, NORTH)            # восточная стенка северной ветки
заборы += row('z', -SIDE, NORTH, MAIN)            # западная стенка северной ветки
заборы += row('x',  MAIN, -SIDE, WEST)            # север главной, запад
заборы += row('z',  WEST, MAIN, -MAIN, GAP_WEST)  # западный торец с проёмом

# Заграждения поперёк веток: тем же рядом, от стенки до стенки.
заборы += row('x', NORTH, -SIDE, SIDE)
заборы += row('x', SOUTH, -SIDE, SIDE)

прочее = [p for p in level['props']
          if not p['prop'].startswith('Bld_') and p['prop'] != 'Fence_ChainLink']
level['props'] = прочее + дома + заборы

json.dump(level, open(LEVEL, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('домов:', len(дома), '| секций забора:', len(заборы), '| всего пропов:', len(level['props']))
