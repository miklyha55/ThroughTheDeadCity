# -*- coding: utf-8 -*-
"""
Сборка последнего уровня — «Северный выезд».

Схема: короткий въезд с запада, поворот, длинная дорога на север. В самом её
конце — заграждение поперёк, за ним толпа, за толпой выезд из города.

Как уровень играется:
    Герой выходит с въезда на дорогу — пересекает черту `horde.trigger`. Камера
    летит к толпе, та поднимается разом, заграждение разлетается, и все бегут на
    героя по длинной прямой. По дороге разложено то, чем эту толпу встречать:
    бочки, канистры, тесаки. Выход открывается, только когда перебиты все.

Оси: дорога идёт вдоль Z, от +38 (поворот с въезда) до −70 (выезд). Въезд — от
западного края площадки до дороги, вдоль X.

Запуск: python3 tools/build_north_exit.py
"""
import json, math, random

random.seed(11)

LEVEL = 'public/locations/north_exit.json'

W, D = 62, 140           # по ширине — ровно на короткий въезд: до поворота два десятка метров
HALF_W, HALF_D = W / 2, D / 2

ROAD = 12                # полуширина коридора дороги: полотно 16 м и обочины
ROAD_END = 38            # южный край коридора, где в него входит въезд
STUB = (14, 38)          # въезд по Z: от северного забора до южного
TILE = 8

FENCE = 4.09             # длина секции сетки
BARRIER_Z = -44          # синяя черта: заграждение поперёк дороги
HORDE = (-12, -70, 12, -45.5)   # прямоугольник толпы
TRIGGER = (-10, STUB[0], ROAD, ROAD_END)  # оранжевая черта: герой вышел на дорогу

props, zombies = [], []


def put(name, x, z, rot=None, scale=None, y=None, **extra):
    row = {'prop': name, 'at': [round(x, 2), round(z, 2)]}
    if rot is not None:
        row['rotation'] = round(rot, 1)
    if scale is not None:
        row['scale'] = scale
    if y is not None:
        row['y'] = y
    row.update(extra)
    props.append(row)


def zombie(x, z, rot=None):
    row = {'kind': random.choice(('zombie1', 'zombie2')), 'at': [round(x, 2), round(z, 2)]}
    row['rotation'] = round(rot if rot is not None else random.uniform(-180, 180), 1)
    zombies.append(row)


# ── дорога и въезд ──────────────────────────────────────────────────────────
for z in range(-66, ROAD_END, TILE):
    for x in (-4, 4):
        name = 'Road_Damaged' if z in (-26, 6) and x == 4 else 'Road_Straight'
        put(name, x, z)

for x in (-28, -20):
    for z in (22, 30):
        put('Road_Straight', x, z, 90)


# ── забор: коридор замкнут, наружу не выйти ─────────────────────────────────
def fence(fixed, start, end, along, **extra):
    """Ряд сетки от `start` до `end`. Секций с запасом вверх — иначе щели."""
    length = end - start
    count = max(1, math.ceil(length / FENCE))
    step = length / count
    for i in range(count):
        at = start + step * (i + 0.5)
        if along == 'x':
            put('Fence_ChainLink', at, fixed, 0, **extra)
        else:
            put('Fence_ChainLink', fixed, at, 90, **extra)


fence(ROAD, -HALF_D, ROAD_END, 'z')          # восточная сторона дороги
fence(-ROAD, -HALF_D, STUB[0], 'z')          # западная, до въезда
fence(ROAD_END, -HALF_W, ROAD, 'x')          # южная: по въезду и торцу дороги
fence(STUB[0], -HALF_W, -ROAD, 'x')          # северная сторона въезда


# ── застройка снаружи забора ────────────────────────────────────────────────
EAST = ['Bld_Warehouse', 'Bld_AutoShop', 'Bld_Diner', 'Bld_Shop', 'Bld_Warehouse', 'Bld_Ranch']
for i, name in enumerate(EAST):
    put(name, 21, -58 + i * 18, -90)

WEST = ['Bld_Shop', 'Bld_Warehouse', 'Bld_Diner', 'Bld_Trailer']
for i, name in enumerate(WEST):
    put(name, -21, -58 + i * 18, 90)

for i, name in enumerate(['Bld_Ranch', 'Bld_Farmhouse']):
    put(name, -22 + i * 17, 47, 180)
put('Bld_Trailer', -24, 7, 0)


# ── брошенное на дороге: укрытия и помеха бегу ──────────────────────────────
for x, z in ((-9, 24), (9, 4), (-9, -14), (9, -32), (-9, -38)):
    put(random.choice(('Car_SedanWreck', 'Car_VanRust')), x, z, random.uniform(-25, 25) + 90)

# Сложившаяся фура посреди дороги: обегать её приходится с одного боку, и толпа
# на этом месте сбивается в кучу — самое место для бочки.
put('Heavy_SemiTruck', -3, -8, 70)


# ── чем встречать толпу ─────────────────────────────────────────────────────
def explosives(x, z, count):
    for i in range(count):
        name = 'Prop_Barrel' if i % 2 == 0 else 'Prop_Jerrycan'
        put(name, x + random.uniform(-3, 3), z + random.uniform(-2.5, 2.5), random.uniform(-180, 180))


def blades(x, z, count):
    for _ in range(count):
        put('Weapon_Cleaver', x + random.uniform(-3, 3), z + random.uniform(-2, 2), random.uniform(-180, 180))


def junk(x, z, count):
    for _ in range(count):
        put(random.choice(('Prop_Crate', 'Prop_Pallet', 'Prop_Tires', 'Prop_Cone', 'Prop_Barricade')),
            x + random.uniform(-8, 8), z + random.uniform(-4, 4), random.uniform(-180, 180))


# От въезда к заграждению: чем ближе к толпе, тем больше взрывчатки — последний
# рубеж перед ней должен быть самым густым.
explosives(-2, 18, 2)
blades(3, 12, 2)
junk(0, 26, 5)

explosives(4, -2, 3)
blades(-5, 2, 2)
junk(0, 6, 6)

explosives(5, -20, 4)
blades(-4, -16, 2)
junk(0, -24, 6)

explosives(-2, -34, 4)
blades(4, -30, 3)
junk(0, -36, 5)


# ── заграждение поперёк дороги: его снесёт толпа ────────────────────────────
fence(BARRIER_Z, -ROAD, ROAD, 'x', breach=True)
for i in range(13):
    put('Prop_JerseyBarrier', -10.8 + i * 1.8, BARRIER_Z + 1.6, 90 + random.uniform(-6, 6), breach=True)
put('Car_SedanWreck', -7, BARRIER_Z + 4, 8, breach=True)


# ── зомби ───────────────────────────────────────────────────────────────────
# Редкие по дороге: напоминают, что город не пуст, пока толпа не поднялась.
for cx, cz, n in ((2, 8, 3), (-3, -22, 4), (3, -36, 3)):
    for _ in range(n):
        zombie(cx + random.uniform(-4, 4), cz + random.uniform(-3, 3))

# Толпа: плотно, но не вплотную — с зазором, в котором зомби не расталкивают
# друг друга с первого кадра.
placed = []
x0, z0, x1, z1 = HORDE
while len(placed) < 60:
    x = random.uniform(x0 + 1, x1 - 1)
    z = random.uniform(z0 + 1.5, z1 - 1)
    if all(math.hypot(x - px, z - pz) > 1.3 for px, pz in placed):
        placed.append((x, z))
        zombie(x, z, 180 + random.uniform(-40, 40))  # лицом на юг, к дороге


level = {
    'id': 'north_exit',
    'name': 'Северный выезд',
    'number': 4,
    'next': None,
    'size': [W, D],
    'ground': {'color': '#3f3a34', 'y': -0.06},
    'spawn': {'position': [-25, 26], 'rotation': 90},
    'exitAt': [7, -67, 3],
    # Выход открывается, только когда перебиты все.
    'clearToExit': True,
    'horde': {'trigger': list(TRIGGER), 'area': list(HORDE)},
    'props': props,
    'zombies': zombies,
}

with open(LEVEL, 'w', encoding='utf-8') as f:
    json.dump(level, f, ensure_ascii=False, indent=2)

print('пропов:', len(props), '| зомби:', len(zombies),
      '| в заграждении:', sum(1 for p in props if p.get('breach')))
