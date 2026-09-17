# -*- coding: utf-8 -*-
"""
Пристройка к «Дому на окраине»: два новых помещения за дверью на юге.

Уровень был короткий: одна прямая через три комнаты — и переход. Продлеваем его
буквой «Г»: из южной двери герой попадает в мастерскую, а из неё, через пролом в
восточной стене, на склад; выход наружу пробит в дальней стене склада.

Прежняя дверь `Wall_Door` на [14, -8] убрана. Причина в том, как устроены стены:
цельный короб, дверь в нём нарисована, а не прорезана, и пройти сквозь неё
нельзя. Раньше это было неважно — герой доходил до двери, и уровень кончался.
Теперь ему идти дальше, поэтому на месте двери — настоящий проём в четыре метра,
как и все прочие проходы на уровне.

Раскладка выписана списками, а не считается: комнат две, вещей в них полсотни, и
любая «умная» расстановка тут читается хуже, чем прямой перечень.

Запуск: python3 tools/layout_tutorial_annex.py
"""
import json

LEVEL = 'public/locations/tutorial.json'

SECTION, THICK = 4.0, 0.34   # стеновая секция: длина и толщина модели, м
OVERLAP = 0.16               # на сколько соседние секции входят друг в друга, м

SIZE = [96, 48]        # площадка растёт вправо и вниз; дом остаётся на месте

# Мастерская: сразу за проёмом в южной стене дома.
SHOP = (8, 24, -20, -8)
# Склад: правее и выше мастерской, с выходом наружу в дальней стене.
STORE = (24, 44, -20, -4)

PASSAGE = (-16, -12)   # пролом между мастерской и складом, по z
WAY_OUT = (36, 40)     # и выход со склада, пробитый в южной его стене

# Сени за этим выходом: короб в одну секцию, закрытый с трёх сторон.
#
# Нужны затем, чтобы за дверью не начиналось чистое поле. Круг перехода стоит
# в них, но сработает он не всегда: пока не взято ружьё, выход заперт, — и без
# сеней герой в этот миг ушёл бы гулять по пустой площадке за уровнем.
PORCH = (36, 40, -24, -20)

EXIT_AT = [38.0, -22.0, 2.0]

# Вехи: указатель ведёт по ним, пока не покажется сам переход. Одна за проёмом,
# вторая у пролома — ровно там, где дорога сворачивает и цель уходит из виду.
GUIDE = [[14.2, -10.0], [22.0, -14.0]]

# --- мастерская: тут когда-то что-то чинили ----------------------------------
SHOP_PROPS = [
    ('Furn_Bookshelf',    9.3,  -9.6,   90),
    ('Furn_Bookshelf',    9.3, -12.6,   90),
    ('Furn_TVStand',      9.3, -17.6,   90),
    ('Furn_Dresser',     11.0, -19.3,    0),
    ('Furn_DiningTable', 14.6, -11.4,   90),
    ('Furn_Chair',       13.4, -11.6,   90),
    ('Furn_Chair',       15.8, -11.3,  -90),
    ('Furn_Armchair',    22.8,  -9.6,  -90),
    ('Furn_FloorLamp',   22.9, -11.4,    0),
    ('Furn_CoffeeTable', 21.6, -17.8,    0),
    ('Prop_Barrel',      12.4, -19.2,   20),
    ('Prop_Barrel',      13.6, -19.3,  -35),
    ('Prop_Crate',       17.6, -19.2,   14),
    ('Prop_Crate',       18.9, -19.3,  -28),
    ('Prop_Pallet',      10.4, -15.4,   72),
    ('Prop_Tires',       22.6, -18.8,   16),
    ('Prop_Tires',       21.0, -19.3,  -42),
    ('Prop_Barricade',   18.4, -14.4,   96),
    ('Prop_Cone',        16.6, -17.2,  -54),
    ('Prop_Cone',        20.4, -12.0,   22),
    ('Weapon_Knife',     12.8, -14.8,   35),
    # Канистра на пути к первым двоим: взрывается раньше, чем до неё доходят.
    ('Prop_Jerrycan',    16.1, -13.2,    6),
]

SHOP_ZOMBIES = [
    ('zombie1', 17.6, -16.4,  70),
    ('zombie1', 20.1, -15.0, 120),
    ('zombie2', 13.8, -17.6,  25),
]

# --- склад: он же и жильё, судя по кровати у стены ---------------------------
STORE_PROPS = [
    ('Furn_Bed',            26.4,  -6.2,    0),
    ('Furn_Dresser',        29.0,  -5.3,  180),
    ('Furn_Bookshelf',      31.6,  -5.4,  180),
    ('Furn_Sofa',           35.6,  -5.6,  180),
    ('Furn_CoffeeTable',    35.4,  -7.4,    0),
    ('Furn_Armchair',       38.6,  -6.4,  170),
    ('Furn_FloorLamp',      41.0,  -5.6,    0),
    ('Furn_Fridge',         43.0,  -7.8,  -90),
    ('Furn_Stove',          43.0,  -9.6,  -90),
    ('Furn_KitchenCounter', 43.0, -11.6,  -90),
    ('Furn_DiningTable',    40.0, -12.0,    0),
    ('Furn_Chair',          40.6,  -9.8,  -60),
    ('Furn_Chair',          38.8, -12.2,   90),
    ('Furn_TVStand',        25.2,  -9.4,   90),
    ('Furn_Bookshelf',      25.2, -18.6,   90),
    ('Prop_Crate',          28.6, -18.8,   26),
    ('Prop_Crate',          30.0, -19.2,  -16),
    ('Prop_Crate',          29.4, -17.6,    9),
    ('Prop_Barrel',         33.4, -19.0,   12),
    ('Prop_Barrel',         34.6, -18.6,  -40),
    ('Prop_Pallet',         27.0, -14.6,  -38),
    ('Prop_Pallet',         31.6, -16.8,   62),
    ('Prop_Tires',          42.0, -18.5,   32),
    ('Prop_Tires',          43.0, -16.4,  -68),
    ('Prop_Barricade',      33.2, -11.4,   12),
    ('Prop_Cone',           29.8,  -9.0,   42),
    ('Prop_Cone',           36.8, -14.8,  -22),
    ('Prop_Cone',           27.6, -11.8,   -8),
    ('Weapon_Cleaver',      31.0, -12.6,  -25),
    # Вторая канистра — перед теми, кто ждёт посреди склада.
    ('Prop_Jerrycan',       30.4, -14.6,    4),
]

STORE_ZOMBIES = [
    ('zombie2', 33.6, -15.6,  168),
    ('zombie1', 35.8, -13.2,  152),
    ('zombie1', 31.2, -10.4, -128),
    ('zombie2', 38.4,  -8.2, -148),
]


def wall_run(kind, fixed, start, end, rot, skip=None, fit=None):
    """
    Ряд стеновых секций вдоль одной линии, от `start` до `end`.

    Секции идут не встык, а внахлёст, и ряд с обоих концов заходит на половину
    толщины стены внутрь той, в которую упирается. Встык выглядит хуже, чем
    кажется: ряд делится на нецелое число секций, остаток съедается округлением,
    и по всей стене расходятся щели в палец шириной — а в изометрии смотришь
    сверху, и сквозь них видно пол соседней комнаты. На углах то же самое, только
    заметнее: два торца сходятся в точку, и угол светится.

    Поэтому длину считаем по отрезку с заходами, делим нацело, а каждую секцию
    растягиваем на `OVERLAP` — она перекрывает соседнюю, и шва не остаётся. Так
    же, вручную, растянуты и стены самого дома.

    `skip` — отрезок, который пропускается: так делаются все проходы, потому что
    дверь в модели нарисована, а не прорезана, и сквозь неё не пройти.

    `fit` — предел растяжения. Нужен там, где на секции есть что-то, чему тянуться
    нельзя: у стены с дверью вместе с ней разъезжается и дверное полотно, и на
    восьмой доле это уже видно. Остаток за пределом закрывают торцы соседних
    стен — они и так заходят внутрь на половину своей толщины.
    """
    span = (end - start) + THICK          # с заходом в стены по обоим концам
    steps = max(1, round(span / SECTION))
    length = span / steps
    stretch = round((length + OVERLAP) / SECTION, 3)
    if fit:
        stretch = min(stretch, fit)

    out = []
    for step in range(steps):
        center = start - THICK / 2 + length * (step + 0.5)
        if skip and skip[0] <= center <= skip[1]:
            continue

        at = [center, fixed] if rot == 0 else [fixed, center]
        out.append({
            'prop': kind(step),
            'at': [round(v, 2) for v in at],
            'rotation': rot,
            'scale': [stretch, 1, 1],
        })
    return out


def plain(_step):
    return 'Wall_Plain'


def door(_step):
    return 'Wall_Door'


def every_third(step):
    """Окна вразбивку: глухой ряд в шесть секций читается как забор."""
    return 'Wall_Window' if step % 3 == 1 else 'Wall_Plain'


def walls():
    """Короб пристройки: обе комнаты и общая стена между ними."""
    west, east, south, north = SHOP
    s_west, s_east, s_south, s_north = STORE

    out = []
    # Мастерская: юг, запад и кусок севера — от угла дома до своего угла.
    out += wall_run(every_third, south, west, east, 0)
    out += wall_run(every_third, west, south, north, 90)
    out += wall_run(plain, north, 20, east, 0)

    # Склад: юг с выходом наружу, восток, север.
    out += wall_run(every_third, s_south, east, s_east, 0, skip=WAY_OUT)
    out += wall_run(every_third, s_east, s_south, s_north, 90)
    out += wall_run(every_third, s_north, s_west, s_east, 0)

    # Сени за выходом: три стены, четвёртая — сам склад.
    p_west, p_east, p_south, _ = PORCH
    # Дальняя стена сеней — с дверью: она и читается как выход наружу.
    out += wall_run(door, p_south, p_west, p_east, 0, fit=1.04)
    out += wall_run(plain, p_west, p_south, s_south, 90)
    out += wall_run(plain, p_east, p_south, s_south, 90)

    # Общая стена с проломом: тянется на всю глубину склада, потому что выше
    # мастерской она уже просто его западная стена.
    out += wall_run(plain, east, s_south, s_north, 90, skip=PASSAGE)
    return out


def props():
    return [
        {'prop': name, 'at': [x, z], 'rotation': rot}
        for name, x, z, rot in SHOP_PROPS + STORE_PROPS
    ]


def zombies():
    return [
        {'kind': kind, 'at': [x, z], 'rotation': rot}
        for kind, x, z, rot in SHOP_ZOMBIES + STORE_ZOMBIES
    ]


def inside_annex(at):
    """Попадает ли точка в пристройку: всё южнее дома и восточнее его стены."""
    x, z = at
    return z < -8.5 or (x > 20.5 and z < -3.5)


def main():
    level = json.load(open(LEVEL, encoding='utf-8'))

    # Дверь на месте будущего проёма убираем — см. пояснение наверху.
    level['props'] = [
        p for p in level['props']
        if not (p['prop'] == 'Wall_Door' and abs(p['at'][0] - 14) < 1 and abs(p['at'][1] + 8) < 1)
    ]

    # И всё, что эта раскладка ставила в прошлый раз: скрипт должен давать один
    # и тот же уровень, сколько бы раз его ни запустили.
    level['props'] = [p for p in level['props'] if not inside_annex(p['at'])]
    level['zombies'] = [z for z in level['zombies'] if not inside_annex(z['at'])]

    level['size'] = SIZE
    level['props'] += walls() + props()
    level['zombies'] += zombies()
    level['exitAt'] = EXIT_AT
    level['guide'] = level['guide'][:1] + [{'at': at} for at in GUIDE]

    json.dump(level, open(LEVEL, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f"пропов {len(level['props'])}, зомби {len(level['zombies'])}")


if __name__ == '__main__':
    main()
