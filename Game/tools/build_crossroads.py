# -*- coding: utf-8 -*-
"""Сборка нового уровня: перекрёсток по нарисованной схеме."""
import json, math, random

random.seed(7)

W, H = 112, 80           # размер площадки
HALF_W, HALF_D = W / 2, H / 2
TILE = 8                 # дорожная плита

props, zombies = [], []

def put(name, x, z, rot=None, scale=None, y=None):
    row = {'prop': name, 'at': [round(x, 2), round(z, 2)]}
    if rot is not None:   row['rotation'] = round(rot, 1)
    if scale is not None: row['scale'] = scale
    if y is not None:     row['y'] = y
    props.append(row)

def zombie(kind, x, z, rot=None):
    row = {'kind': kind, 'at': [round(x, 2), round(z, 2)]}
    if rot is not None: row['rotation'] = round(rot, 1)
    zombies.append(row)

# ── дороги ──────────────────────────────────────────────────────────────────
# Главная идёт с запада на восток, боковая пересекает её посередине.
# Перекрёсток — четыре плиты в центре.
MAIN_Z = (-4, 4)
SIDE_X = (-4, 4)

for x in range(-48, 49, TILE):
    for z in MAIN_Z:
        if abs(x) <= TILE:
            put('Road_Cross', x, z)
        else:
            # Пара выбитых плит: ровная дорога через весь уровень мертва на вид.
            name = 'Road_Damaged' if x in (-24, 16) else 'Road_Straight'
            put(name, x, z, 90)

for z in range(-36, 37, TILE):
    if abs(z) <= TILE:
        continue  # центр уже вымощен перекрёстком
    for x in SIDE_X:
        put('Road_Straight', x, z)

# ── застройка вдоль главной дороги ──────────────────────────────────────────
# Дома стоят отступив от полотна: дорога с обочинами занимает шестнадцать метров.
NORTH = [('Bld_Shop', -40), ('Bld_Diner', -22), ('Bld_AutoShop', 20), ('Bld_Warehouse', 38)]
SOUTH = [('Bld_Warehouse', -36), ('Bld_Motel', -18), ('Bld_Shop', 22), ('Bld_Diner', 40)]

for name, x in NORTH:
    put(name, x, 17, 180)
for name, x in SOUTH:
    put(name, x, -17, 0)

# и по боковой дороге, чтобы она читалась улицей, а не полем
put('Bld_SuburbHouse', -16, 26, 90)
put('Bld_SuburbHouse', 16, 26, -90)
put('Bld_Ranch', -16, -26, 90)
put('Bld_Ranch', 16, -26, -90)

# ── забор: коридор вдоль дороги, с проёмами на перекрёстке ──────────────────
def fence_row(along, fixed, frm, to, rot, gap=None):
    step = 4
    at = frm
    while at <= to:
        skip = gap and gap[0] <= at <= gap[1]
        if not skip:
            put('Fence_ChainLink', at if along == 'x' else fixed,
                fixed if along == 'x' else at, rot)
        at += step

# Забор идёт до самой границы площадки. Не доведённый до края, он оставляет у
# обочины полосу, по которой всё обходится кругом, и перекрытые ветки перестают
# быть перекрытыми.
fence_row('x', 25, -HALF_W, HALF_W, 0, gap=(-12, 12))    # северная сторона
fence_row('x', -25, -HALF_W, HALF_W, 0, gap=(-12, 12))   # южная
fence_row('z', 12, 14, HALF_D, 90)                       # вдоль северной ветки
fence_row('z', -12, 14, HALF_D, 90)
fence_row('z', 12, -HALF_D, -14, 90)                     # и южной
fence_row('z', -12, -HALF_D, -14, 90)

# ── перекрытые ветки: то, что на схеме отмечено поперёк дороги ──────────────
def blockade(z, facing):
    """Заграждение поперёк боковой дороги: сетка, а поверх неё хлам.

    Секции ставятся вдоль оси X без поворота: длинная сторона сетки и так лежит
    по X, и поворот на четверть развернул бы её поперёк — между секциями остались
    бы щели шириной в человека, и перекрытая дорога перестала бы быть перекрытой.
    Шаг вплотную, чуть теснее самой секции: стык в стык сетка не сходится.
    """
    for x in range(-12, 13, 4):
        put('Fence_ChainLink', x, z)
    put('Car_SedanWreck', -6, z + facing * 2.5, 78)
    put('Heavy_SemiTruck', 5, z + facing * 3, 96)
    for i in range(6):
        put('Prop_JerseyBarrier', -9 + i * 3.6, z + facing * 1.2, 90 + random.uniform(-8, 8))
    for i in range(4):
        put('Prop_Barricade', -7 + i * 4.5, z + facing * 4.5, random.uniform(-180, 180))

blockade(22, 1)    # северная ветка
blockade(-22, -1)  # южная

# ── путь игрока: стычки с запада на восток ──────────────────────────────────
# Правило расстановки одно на весь уровень: сперва под ноги ложится взрывчатка,
# следом, ближе к толпе, клинки, и только потом сама толпа. Игрок успевает
# подобрать бочку раньше, чем упрётся в зомби.
def crowd(cx, cz, count, spread=6.0):
    for _ in range(count):
        a = random.uniform(0, 6.283)
        r = random.uniform(1.5, spread)
        zombie(random.choice(('zombie1', 'zombie2')),
               cx + math.cos(a) * r, cz + math.sin(a) * r * 0.7,
               random.uniform(-180, 180))

def explosives(x, z, count=3):
    for i in range(count):
        name = 'Prop_Barrel' if i % 2 == 0 else 'Prop_Jerrycan'
        put(name, x + random.uniform(-2.5, 2.5), z + random.uniform(-4, 4),
            random.uniform(-180, 180))

def blades(x, z, count=2):
    for _ in range(count):
        put('Weapon_Cleaver', x + random.uniform(-2, 2), z + random.uniform(-3.5, 3.5),
            random.uniform(-180, 180))

# Первая стычка: редкая, чтобы игрок вспомнил управление.
explosives(-40, 0, 2)
blades(-36, 1.5, 1)
crowd(-30, 0, 6)

# Вторая: плотнее, на подходе к перекрёстку.
explosives(-24, -1, 3)
blades(-20, 1, 2)
crowd(-14, 0, 11, spread=7)

# Третья: за перекрёстком, перед выходом.
explosives(14, 1, 3)
blades(18, -1, 2)
crowd(26, -2, 10, spread=7)

# Те, кто бродит у перекрытых веток: показывают, что туда лезть незачем.
crowd(0, 16, 6, spread=5)
crowd(0, -16, 6, spread=5)

# ── перекрёсток: место под будущего вожака ──────────────────────────────────
# Машина в середине — та самая, в которой он появится. Вокруг густо навалено
# всего, чем можно драться, но ни одного клинка: тут работают бочкой и хламом.
put('Car_MuscleRaider', 0, 0, 24)

BOSS_JUNK = ('Prop_Crate', 'Prop_Pallet', 'Prop_Tires', 'Prop_Cone', 'Prop_Barricade')
placed = []
for _ in range(26):
    for _ in range(40):
        a = random.uniform(0, 6.283)
        r = random.uniform(4.0, 11.0)
        x, z = math.cos(a) * r, math.sin(a) * r
        if all(math.hypot(x - px, z - pz) > 1.6 for px, pz in placed):
            placed.append((x, z))
            put(random.choice(BOSS_JUNK), x, z, random.uniform(-180, 180))
            break

# Взрывчатка у вожака своя: она понадобится против него.
for a in (0.6, 2.3, 3.9, 5.5):
    put('Prop_Barrel' if a < 3 else 'Prop_Jerrycan',
        math.cos(a) * 9.5, math.sin(a) * 9.5, random.uniform(-180, 180))

crowd(0, 0, 12, spread=10)

# Сам вожак — посреди перекрёстка, лицом к приходящему герою. Пока он жив, стрелка
# ведёт на него, а выход заперт, так что вехи здесь больше не нужно.
zombies.append({'kind': 'boss', 'at': [0, 0], 'rotation': -90})

# ── мелочь для вида ─────────────────────────────────────────────────────────
# Ни скал, ни валунов: это город, а не пустошь. Только то, что растёт вдоль
# дорог и во дворах, и только между кварталами — на полотно ничего не кладём.
for _ in range(30):
    x = random.uniform(-HALF_W + 6, HALF_W - 6)
    z = random.uniform(-HALF_D + 6, HALF_D - 6)
    if abs(z) < 12 or abs(x) < 12:
        continue  # полоса дороги и перекрёсток остаются чистыми
    put(random.choice(('Grass_Clump', 'Bush_Tumbleweed', 'Tree_Dead', 'Bush_Hedge')),
        x, z, random.uniform(-180, 180))

# Брошенные машины по обочинам. Через них персонаж перемахивает, так что они не
# перекрывают путь, а только ломают прямую линию бега. У перекрёстка их нет: там
# и без того тесно от хлама.
for x, z in ((-44, 11), (-30, -11), (24, 11), (34, -11), (44, 11)):
    put('Car_SedanWreck' if x % 2 else 'Car_VanRust', x, z, random.uniform(-180, 180))

# ── сам уровень ─────────────────────────────────────────────────────────────
level = {
    'id': 'crossroads',
    'name': 'Северный перекрёсток',
    'number': 3,
    'next': None,
    'size': [W, H],
    'ground': {'color': '#3f3a34', 'y': -0.06},
    'spawn': {'position': [-46, 0], 'rotation': 90},
    'exitAt': [46, -6, 4],
    'props': props,
    'zombies': zombies,
}

with open('public/locations/crossroads.json', 'w', encoding='utf-8') as f:
    json.dump(level, f, ensure_ascii=False, indent=2)

print('пропов:', len(props), '| зомби:', len(zombies))
