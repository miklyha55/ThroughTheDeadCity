# -*- coding: utf-8 -*-
"""
Сборка уровня «Шоссе на перекрёсток» — того, что идёт перед вожаком.

Схема из наброска: дорога идёт с запада на восток и дважды ломается — пологий
спуск, резкий подъём посередине и снова пологий спуск к выезду. Старт у
западного края, тут же на обочине брошен таран `Car_Rammer`, выезд — у
восточного.

Как уровень играется:
    Герой начинает пешком, стрелка ведёт к машине. Сел — стрельбы больше нет,
    только руль: дальше уровень проезжается. Зомби вдоль трассы ведут себя как
    везде, но машина на ходу сшибает их с любого бока. Доехал до восточного
    края — переход на перекрёсток к вожаку.

Оси: X — вдоль трассы, Z — поперёк. Дорога описана ломаной `LINE` по её
середине, всё остальное раскладывается от неё.

Запуск: python3 tools/build_highway.py
"""
import json, math, random

random.seed(23)

LEVEL = 'public/locations/highway.json'

W, D = 210, 96           # длинная площадка: на машине она проезжается за полминуты
HALF_W, HALF_D = W / 2, D / 2

TILE = 8                 # сторона плитки дороги
LANES = (-4, 4)          # два ряда плиток: полотно шириной 16 м
SHOULDER = 15            # полуширина коридора: полотно и обочины. Широкий нарочно —
                         # на машине в двести километров в час узкий коридор не
                         # оставляет места на ошибку, а ошибаться тут будут
FENCE = 4.09             # длина секции сетки

# Середина дороги: ломаная из наброска, с запада на восток.
CORNERS = [(-100, 8), (-30, 22), (2, -20), (46, -12), (100, 2)]

BEND = 26                # радиус скругления поворотов, м


def smooth(points, radius=BEND, steps=7):
    """Скруглить углы ломаной.

    Острые изломы годились, пока уровень проходили пешком: человек тормозит на
    повороте и разворачивается на месте. Машина на полном ходу в такой угол не
    вписывается вовсе — влетает в забор, — поэтому каждый угол срезается дугой.
    """
    out = [points[0]]

    for (ax, az), (bx, bz), (cx, cz) in zip(points, points[1:], points[2:]):
        # единичные векторы из угла в обе стороны
        inx, inz = ax - bx, az - bz
        outx, outz = cx - bx, cz - bz
        li = math.hypot(inx, inz) or 1
        lo = math.hypot(outx, outz) or 1
        cut = min(radius, li / 2, lo / 2)

        start = (bx + inx / li * cut, bz + inz / li * cut)
        end = (bx + outx / lo * cut, bz + outz / lo * cut)

        out.append(start)
        # дуга через сам угол: квадратичная кривая Безье по трём точкам
        for i in range(1, steps):
            t = i / steps
            k = (1 - t)
            out.append((
                k * k * start[0] + 2 * k * t * bx + t * t * end[0],
                k * k * start[1] + 2 * k * t * bz + t * t * end[1],
            ))
        out.append(end)

    out.append(points[-1])
    return out


LINE = smooth(CORNERS)

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


def segments():
    """Отрезки ломаной парами точек."""
    return list(zip(LINE, LINE[1:]))


def walk(step):
    """Пройти по ломаной с заданным шагом.

    Отдаёт точку на середине дороги и направление в ней — по ним и ставится
    всё, что тянется вдоль трассы: полотно, обочины, забор.
    """
    for (x0, z0), (x1, z1) in segments():
        dx, dz = x1 - x0, z1 - z0
        length = math.hypot(dx, dz)
        count = max(1, round(length / step))
        for i in range(count):
            t = i / count
            yield x0 + dx * t, z0 + dz * t, math.degrees(math.atan2(dx, dz))


def aside(x, z, heading, offset):
    """Точка в стороне от середины дороги: слева при минусе, справа при плюсе."""
    rad = math.radians(heading)
    return x + math.cos(rad) * offset, z - math.sin(rad) * offset


# ── старт и машина: обе точки берутся с самой трассы ───────────────────────
def along(distance):
    """Точка на ломаной в стольких метрах от начала — и куда трасса там идёт."""
    left = distance
    for (x0, z0), (x1, z1) in segments():
        dx, dz = x1 - x0, z1 - z0
        length = math.hypot(dx, dz)
        if left > length:
            left -= length
            continue
        t = left / length
        return x0 + dx * t, z0 + dz * t, math.degrees(math.atan2(dx, dz))
    x, z = LINE[-1]
    return x, z, 90


START = along(7)    # герой стоит на полотне, лицом вдоль трассы
CAR = along(16)     # машина в десятке шагов впереди, на той же полосе


# ── полотно ─────────────────────────────────────────────────────────────────
# Плитки идут парами поперёк хода: между изломами стык расходится веером, но на
# земле это читается как разбитая дорога, а не как дыра.
for i, (x, z, heading) in enumerate(walk(TILE)):
    for lane in LANES:
        px, pz = aside(x, z, heading, lane)
        name = 'Road_Damaged' if i % 9 == 4 and lane > 0 else 'Road_Straight'
        put(name, px, pz, heading)


# ── забор вдоль обочин: с трассы не съехать ─────────────────────────────────
for x, z, heading in walk(FENCE):
    for side in (-SHOULDER, SHOULDER):
        px, pz = aside(x, z, heading, side)
        put('Fence_ChainLink', px, pz, heading + 90)

# Торцы: за стартом и за выездом — чтобы площадка была замкнута.
for end, heading in ((LINE[0], 90), (LINE[-1], 90)):
    for side in range(-2, 3):
        px, pz = aside(end[0], end[1], heading, side * FENCE)
        put('Fence_ChainLink', px, pz, heading + 90)


# ── застройка снаружи: пустырь вдоль шоссе ──────────────────────────────────
OUTSIDE = ['Bld_Warehouse', 'Bld_AutoShop', 'Bld_Shop', 'Bld_Diner', 'Bld_Ranch', 'Bld_Trailer']
for i, (x, z, heading) in enumerate(walk(26)):
    if i % 2:
        continue
    name = OUTSIDE[(i // 2) % len(OUTSIDE)]
    side = SHOULDER + 12 if (i // 2) % 2 else -(SHOULDER + 12)
    px, pz = aside(x, z, heading, side)
    if abs(pz) < HALF_D - 6 and abs(px) < HALF_W - 8:
        put(name, px, pz, heading + (90 if side > 0 else -90))


# ── брошенное на полотне: слалом для машины ─────────────────────────────────
WRECKS = ('Car_SedanWreck', 'Car_VanRust', 'Car_SuvHardtop')


def on_bend(x, z, gap=24):
    """Близко ли точка к повороту трассы.

    На самих поворотах полотно не заставляется: вписаться в дугу на полном ходу
    и объехать в ней брошенный внедорожник — разные задачи, и вторая на такой
    скорости просто не решается.
    """
    return any(math.hypot(x - cx, z - cz) < gap for cx, cz in CORNERS[1:-1])


for i, (x, z, heading) in enumerate(walk(17)):
    if i < 2 or i % 3 == 0:
        continue  # у старта чисто: первые метры игрок только разгоняется
    if on_bend(x, z):
        continue
    # Ближе к середине полотна: у обочин должен оставаться проход шире машины,
    # иначе объехать брошенное нечем — с одного бока забор, с другого кузов.
    px, pz = aside(x, z, heading, random.choice((-3.6, 3.6)))
    put(random.choice(WRECKS), px, pz, heading + random.uniform(-30, 30))

# Фура на прямой между вторым и третьим поворотом: обходится с любого боку, но
# издали читается как заграждение — и заставляет отвернуть заранее.
truck = along(255)
put('Heavy_SemiTruck', truck[0] + 4, truck[1] + 4, truck[2] + 70)

# Мелочь по обочинам — она же то, что разлетается от тарана.
for i, (x, z, heading) in enumerate(walk(11)):
    if i % 2:
        continue
    px, pz = aside(x, z, heading, random.choice((-9.6, 9.6)))
    put(random.choice(('Prop_Cone', 'Prop_Barrel', 'Prop_Barricade', 'Prop_Tires')),
        px + random.uniform(-1, 1), pz + random.uniform(-1, 1), random.uniform(-180, 180))


# ── зомби вдоль трассы ──────────────────────────────────────────────────────
# Редко у старта и всё гуще к выезду: пока разгоняешься — их единицы, а к концу
# дорога забита, и проехать можно только тараном.
placed = []
for i, (x, z, heading) in enumerate(walk(6)):
    along = (x - CORNERS[0][0]) / (CORNERS[-1][0] - CORNERS[0][0])  # 0 у старта, 1 у выезда
    if x < CORNERS[0][0] + 18:
        continue  # у самой машины пусто: сесть в неё дают спокойно
    for _ in range(1 + int(along * 4)):
        px, pz = aside(x, z, heading, random.uniform(-SHOULDER + 1.5, SHOULDER - 1.5))
        px += random.uniform(-2, 2)
        pz += random.uniform(-2, 2)
        if all(math.hypot(px - ox, pz - oz) > 1.6 for ox, oz in placed):
            placed.append((px, pz))
            zombie(px, pz)


# ── вехи: по одной на излом, чтобы стрелка не вела сквозь забор ─────────────
guide = [{'at': [round(x, 2), round(z, 2), 9], 'halo': False} for x, z in CORNERS[1:-1]]


level = {
    'id': 'highway',
    'name': 'Шоссе на перекрёсток',
    'number': 3,
    'next': 'crossroads',
    'music': None,           # дорожки у шоссе нет: под мотор играет один ветер
    'size': [W, D],
    'ground': {'color': '#3f3a34', 'y': -0.06},
    # Лицом на восток, вдоль трассы: туда и ехать. Ноль смотрит на +Z, поэтому
    # «вдоль +X» — это девяносто.
    'spawn': {'position': [round(START[0], 2), round(START[1], 2)], 'rotation': round(START[2], 1)},
    # Машина у обочины, в паре шагов от старта: первое, что видно на уровне.
    'car': {'at': [round(CAR[0], 2), round(CAR[1], 2)], 'rotation': round(CAR[2], 1)},
    'exitAt': [LINE[-1][0] - 4, LINE[-1][1], 5],
    'guide': guide,
    'props': props,
    'zombies': zombies,
}

with open(LEVEL, 'w', encoding='utf-8') as f:
    json.dump(level, f, ensure_ascii=False, indent=2)

print('пропов:', len(props), '| зомби:', len(zombies), '| вех:', len(guide))
