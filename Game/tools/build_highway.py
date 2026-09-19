# -*- coding: utf-8 -*-
"""
Сборка уровня «Шоссе на перекрёсток» — того, что идёт перед вожаком.

Схема из наброска: трасса буквой Z. Длинный прямой участок на восток, поворот
ровно на девяносто, перемычка поперёк, снова девяносто — и второй длинный
участок до выезда. Старт у западного края, там же на полотне брошен таран
`Car_Rammer`, выезд — у восточного.

Дорога набрана штатными тайлами из Env.blend, встык, как они и задуманы:
`Road_Straight` — это уже готовая двухполоска с жёлтой осевой, белыми краями и
гравийными обочинами, восемь метров в ряд. Класть их по нескольку в ширину
нельзя: выйдет не широкое шоссе, а несколько дорог бок о бок. На углах стоит
`Road_Corner` — тайл с дугой разметки, развёрнутый по паре направлений, которые
он соединяет. Стыки сходятся ровно по сетке, шва не видно.

Всё стоит по сетке и ничего ни на что не наезжает:
    Полотно кладётся ячейками восемь на восемь, выровненными по общей сетке, —
    плитки сходятся встык, без нахлёстов и щелей. Забор идёт ровно по контуру
    ленты, секция к секции. Всё остальное — здания, деревья, хлам, брошенные
    машины, зомби — проходит через `free`: занятые круги помнятся, и в занятое
    место второй предмет не встанет.

Оси: X — вдоль длинных участков, Z — поперёк. Трасса описана углами `CORNERS`.

Запуск: python3 tools/build_highway.py
"""
import json, math, random

random.seed(23)

LEVEL = 'public/locations/highway.json'

W, D = 276, 180          # площадка под всю букву Z вместе с застройкой по краям
HALF_W, HALF_D = W / 2, D / 2

TILE = 8                 # сторона тайла дороги; по ней же выровнена вся сетка
HALF_ROAD = 4            # полуширина полотна: ровно один тайл — это и есть двухполоска
SHOULDER = 14            # полуширина коридора: от осевой до забора. Дорога узкая —
                         # один тайл, — и на двухстах километрах в час поворот
                         # редко берут чисто; широкая гравийная обочина прощает
                         # промах, а забор всё равно держит в коридоре
FENCE = 4.09             # длина секции сетки

# Трасса буквой Z: на восток, поворот на юг, снова на восток.
#
# Углы стоят в центрах тайлов — числа вида 8k+4. Осевая дороги проходит через
# середины тайлов, и весь ряд ложится по сетке без смещения на полтайла.
CORNERS = [(-100, 36), (-20, 36), (-20, -36), (100, -36)]

props, zombies = [], []
taken = []               # занятые круги: (x, z, радиус)


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


def free(x, z, radius):
    """Свободно ли место — и занять его, если да.

    Всё, кроме полотна и забора, ставится только через эту проверку: сцена, где
    сарай растёт из фуры, а зомби стоит внутри бочки, выглядит не заброшенной, а
    собранной наспех.
    """
    for ox, oz, orad in taken:
        if math.hypot(x - ox, z - oz) < radius + orad:
            return False
    taken.append((x, z, radius))
    return True


def zombie(x, z, rot=None):
    """Поставить зомби, если место свободно. Отвечает, получилось ли."""
    if not free(x, z, 0.9):
        return False
    row = {'kind': random.choice(('zombie1', 'zombie2')), 'at': [round(x, 2), round(z, 2)]}
    row['rotation'] = round(rot if rot is not None else random.uniform(-180, 180), 1)
    zombies.append(row)
    return True


def segments():
    return list(zip(CORNERS, CORNERS[1:]))


def band(half):
    """Прямоугольники ленты нужной полуширины — по одному на участок трассы."""
    boxes = []
    for (x0, z0), (x1, z1) in segments():
        if z0 == z1:  # участок вдоль X
            boxes.append((min(x0, x1), z0 - half, max(x0, x1), z0 + half))
        else:         # и поперёк, вдоль Z
            boxes.append((x0 - half, min(z0, z1), x0 + half, max(z0, z1)))
    return boxes


def inside(x, z, half=SHOULDER):
    """Внутри ленты ли точка."""
    return any(x0 <= x <= x1 and z0 <= z <= z1 for x0, z0, x1, z1 in band(half))


def along(distance):
    """Точка на трассе в стольких метрах от начала — и куда трасса там идёт."""
    left = distance
    for (x0, z0), (x1, z1) in segments():
        dx, dz = x1 - x0, z1 - z0
        length = math.hypot(dx, dz)
        if left > length:
            left -= length
            continue
        t = left / length
        return x0 + dx * t, z0 + dz * t, math.degrees(math.atan2(dx, dz))
    x, z = CORNERS[-1]
    return x, z, 90


def walk(step):
    """Пройти по осевой трассы с заданным шагом: точка и курс в ней."""
    for (x0, z0), (x1, z1) in segments():
        dx, dz = x1 - x0, z1 - z0
        length = math.hypot(dx, dz)
        count = max(1, round(length / step))
        for i in range(count):
            t = i / count
            yield x0 + dx * t, z0 + dz * t, math.degrees(math.atan2(dx, dz))


def aside(x, z, heading, offset):
    """Точка в стороне от осевой: слева при минусе, справа при плюсе."""
    rad = math.radians(heading)
    return x + math.cos(rad) * offset, z - math.sin(rad) * offset


START = along(10)    # герой стоит на полотне, лицом вдоль трассы
CAR = along(21)      # машина в десятке шагов впереди, на той же полосе


# ── полотно ─────────────────────────────────────────────────────────────────
# Тайлы идут в один ряд по осевой, встык: `Road_Straight` уже содержит обе полосы,
# осевую и обочины. Разметка в нём нарисована вдоль оси Z, поэтому участку вдоль X
# тайл ставится повёрнутым на девяносто.
#
# На углах — `Road_Corner`: у него дуга разметки, и поворот выбирается по тем двум
# сторонам, через которые дорога в тайл входит и выходит. Без поворота он
# соединяет север (+Z) и восток (+X); дальше по четверти оборота.
CORNER_TURN = {
    frozenset(('north', 'east')): 0,
    frozenset(('east', 'south')): 90,
    frozenset(('south', 'west')): 180,
    frozenset(('west', 'north')): 270,
}


def side_to(fr, to):
    """С какой стороны тайла лежит соседняя точка."""
    if abs(to[0] - fr[0]) > abs(to[1] - fr[1]):
        return 'east' if to[0] > fr[0] else 'west'
    return 'north' if to[1] > fr[1] else 'south'


road = {}   # (x, z) → (имя тайла, поворот)

for (x0, z0), (x1, z1) in segments():
    dx, dz = x1 - x0, z1 - z0
    length = math.hypot(dx, dz)
    steps = int(round(length / TILE))
    rot = 90 if dz == 0 else 0
    for i in range(steps + 1):
        x = x0 + dx * i / steps
        z = z0 + dz * i / steps
        road[(round(x), round(z))] = ('Road_Straight', rot)

# Углы поверх прямых: тайл поворота знает, откуда пришли и куда уходим.
for i, corner in enumerate(CORNERS[1:-1], start=1):
    ways = frozenset((side_to(corner, CORNERS[i - 1]), side_to(corner, CORNERS[i + 1])))
    road[(round(corner[0]), round(corner[1]))] = ('Road_Corner', CORNER_TURN[ways])

# Редкие битые тайлы вместо целых — но только на прямых, не в поворотах.
for i, (spot, (name, rot)) in enumerate(sorted(road.items())):
    if name == 'Road_Straight' and i % 9 == 4:
        road[spot] = ('Road_Damaged', rot)

for (x, z), (name, rot) in sorted(road.items()):
    put(name, x, z, rot)

cells = road  # для итоговой сводки


# ── забор: сплошной, по контуру ленты ───────────────────────────────────────
def fence_line(x0, z0, x1, z1):
    """Ряд сетки от точки до точки — сплошной, без единой щели.

    Длина линии не делится на секцию нацело. Остаток нельзя ни оставлять щелью —
    в неё проходят и машина, и зомби, — ни закрывать секцией внахлёст. Поэтому
    секций берётся с запасом, а каждая чуть сжимается по своей длине: ряд
    начинается ровно в начале линии и кончается ровно в её конце.

    Секция в модели вытянута вдоль X, так что ряду вдоль Z она ставится
    повёрнутой на девяносто.
    """
    length = math.hypot(x1 - x0, z1 - z0)
    count = max(1, math.ceil(length / FENCE))
    step = length / count
    rot = 0 if abs(z1 - z0) < 1e-6 else 90
    squeeze = round(step / FENCE, 4)
    for i in range(count):
        t = (i + 0.5) / count
        extra = {} if abs(squeeze - 1) < 1e-4 else {'scale': [squeeze, 1, 1]}
        put('Fence_ChainLink', x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, rot, **extra)
        fences.append((x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, rot, step))


fences = []
(ax, az), (bx, bz), (cx, cz), (dx_, dz_) = CORNERS
N, S = SHOULDER, -SHOULDER

# Концы трассы — по краю крайнего тайла, а не по его середине: иначе половина
# плитки торчит за забор, и торец режет дорогу поперёк.
EX0, EX1 = ax - TILE / 2, dx_ + TILE / 2

# Контур буквы Z — замкнутый: каждая линия начинается там, где кончилась прежняя.
CONTOUR = [
    # внешний обвод: верх первого участка, правый край перемычки, верх третьего
    (EX0, az + N, bx + N, az + N),
    (bx + N, az + N, bx + N, cz + N),
    (bx + N, cz + N, EX1, cz + N),
    # внутренний: низ первого участка, левый край перемычки, низ третьего
    (EX0, az + S, bx + S, az + S),
    (bx + S, az + S, bx + S, cz + S),
    (bx + S, cz + S, EX1, cz + S),
    # торцы за стартом и за выездом
    (EX0, az + S, EX0, az + N),
    (EX1, cz + S, EX1, cz + N),
]
for line in CONTOUR:
    fence_line(*line)


# ── застройка: дома по обе стороны трассы ───────────────────────────────────
# Размеры домов — из Env.blend, в осях самой модели: у многих центр смещён, и
# круг вокруг него дом не описывает. Считаем честным прямоугольником.
FOOTPRINT = {  # имя: (xmin, xmax, ymin, ymax) в осях Blender
    'Bld_Warehouse': (-7.54, 7.25, -4.3, 4.3),
    'Bld_AutoShop': (-6.75, 6.75, -6.26, 4.75),
    'Bld_Shop': (-6.3, 6.3, -5.43, 4.3),
    'Bld_Diner': (-7.2, 6.7, -4.8, 3.4),
    'Bld_Ranch': (-6.45, 6.45, -6.2, 4.5),
    'Bld_Trailer': (-4.7, 4.7, -2.81, 1.9),
    'Bld_Barn': (-6.35, 11.2, -4.73, 4.7),
    'Bld_Farmhouse': (-4.9, 4.9, -6.05, 4.0),
    'Bld_Motel': (-8.6, 9.9, -10.7, 3.1),
    'Bld_SuburbHouse': (-5.9, 12.5, -9.5, 6.0),
}
HOUSE_GAP = 3            # м между домом и забором
HOUSE_SPACING = 4        # м между соседними домами

rects = []               # занятые прямоугольники: (x0, z0, x1, z1)


def footprint(name, rot):
    """Прямоугольник дома в мировых осях относительно его точки постановки.

    Из Blender модель приходит с осью Y, ставшей −Z, и дальше поворачивается на
    `rot`. Углы у нас кратны девяноста, так что прямоугольник остаётся
    прямоугольником, и его края считаются точно.
    """
    x0, x1, y0, y1 = FOOTPRINT[name]
    rad = math.radians(rot)
    c, s_ = math.cos(rad), math.sin(rad)
    pts = []
    for lx, lz in ((x0, -y1), (x0, -y0), (x1, -y1), (x1, -y0)):
        pts.append((lx * c + lz * s_, -lx * s_ + lz * c))
    xs, zs = [p[0] for p in pts], [p[1] for p in pts]
    return min(xs), min(zs), max(xs), max(zs)


def overlaps(a, b, margin=0.0):
    return not (a[2] + margin <= b[0] or b[2] + margin <= a[0]
                or a[3] + margin <= b[1] or b[3] + margin <= a[1])


def hits_band(r, half):
    return any(overlaps(r, box) for box in band(half))


HOUSES = list(FOOTPRINT)
house_i = 0
for (x0, z0), (x1, z1) in segments():
    along_x = z0 == z1
    length = math.hypot(x1 - x0, z1 - z0)
    ux, uz = (x1 - x0) / length, (z1 - z0) / length
    for side in (-1, 1):
        # Фасад к дороге. Без поворота фасад модели смотрит на +Z.
        if along_x:
            rot = 0 if side < 0 else 180
        else:
            rot = 90 if side < 0 else 270
        cursor = 6.0
        while cursor < length - 6:
            name = HOUSES[house_i % len(HOUSES)]
            fx0, fz0, fx1, fz1 = footprint(name, rot)
            span = (fx1 - fx0) if along_x else (fz1 - fz0)      # вдоль дороги
            # точка на осевой — середина дома по длине
            mx = x0 + ux * (cursor + span / 2)
            mz = z0 + uz * (cursor + span / 2)
            # и в сторону: ближний край дома — за забором с зазором
            if along_x:
                px = mx - (fx0 + fx1) / 2
                pz = (mz + side * (SHOULDER + HOUSE_GAP) - (fz0 if side > 0 else fz1))
            else:
                pz = mz - (fz0 + fz1) / 2
                px = (mx + side * (SHOULDER + HOUSE_GAP) - (fx0 if side > 0 else fx1))
            r = (px + fx0, pz + fz0, px + fx1, pz + fz1)

            fits = (abs(r[0]) < HALF_W - 2 and abs(r[2]) < HALF_W - 2
                    and abs(r[1]) < HALF_D - 2 and abs(r[3]) < HALF_D - 2
                    and not hits_band(r, SHOULDER + HOUSE_GAP - 0.5)
                    and not any(overlaps(r, o, HOUSE_SPACING) for o in rects))
            if fits:
                rects.append(r)
                put(name, px, pz, rot)
                house_i += 1
            cursor += span + HOUSE_SPACING


def free_of_houses(x, z, radius):
    """Не заходит ли круг на дом."""
    return not any(overlaps((x - radius, z - radius, x + radius, z + radius), r) for r in rects)


# Деревья и кусты — между домами и забором, не на домах и не на дороге.
GREENS = ['Tree_Dead', 'Bush_Tumbleweed', 'Bush_Hedge', 'Grass_Clump', 'Rock_Boulder']
for i, (x, z, heading) in enumerate(walk(7)):
    side = (SHOULDER + 1.8) * (1 if i % 2 else -1)
    px, pz = aside(x, z, heading, side + random.uniform(0, 1))
    if abs(px) > HALF_W - 4 or abs(pz) > HALF_D - 4 or inside(px, pz, SHOULDER + 1.2):
        continue
    if free_of_houses(px, pz, 1.6) and free(px, pz, 1.6):
        put(random.choice(GREENS), px, pz, random.uniform(-180, 180))


# ── брошенное на полотне: слалом для машины ─────────────────────────────────
WRECKS = ('Car_SedanWreck', 'Car_VanRust', 'Car_SuvHardtop')
for i, (x, z, heading) in enumerate(walk(21)):
    if i < 2 or i % 3 == 0:
        continue  # у старта чисто: первые метры игрок только разгоняется
    # На полосе, а не на обочине: смещение — половина ширины асфальта, чтобы
    # брошенная машина стояла на дороге и её приходилось объезжать.
    px, pz = aside(x, z, heading, random.choice((-2.4, 2.4)))
    if free(px, pz, 3.4):
        put(random.choice(WRECKS), px, pz, heading + random.uniform(-25, 25))

# Фура на длинной прямой: издали читается как заграждение и заставляет отвернуть.
tx, tz, theading = along(190)
fx, fz = aside(tx, tz, theading, 2.6)
if free(fx, fz, 8):
    put('Heavy_SemiTruck', fx, fz, theading + 70)

# Мелочь по обочинам — она же то, что разлетается из-под колёс.
JUNK = ('Prop_Cone', 'Prop_Barrel', 'Prop_Barricade', 'Prop_Tires',
        'Prop_JerseyBarrier', 'Prop_Crate', 'Prop_Pallet')
for i, (x, z, heading) in enumerate(walk(9)):
    # По гравийной обочине тайла, внутри забора: там мелочь и лежит.
    px, pz = aside(x, z, heading, random.choice((-6.5, 6.5)))
    if not inside(px, pz):
        continue
    if free(px + random.uniform(-1, 1), pz + random.uniform(-1, 1), 1.6):
        put(random.choice(JUNK), taken[-1][0], taken[-1][1], random.uniform(-180, 180))


# ── взрывчатка: бочки и канистры ────────────────────────────────────────────
# Кучками по одной-три, на полосе и у её края. На полосе — это мина: переехал —
# рвануло и отняло жизни у машины. У края — это оружие: дать толпе набежать и
# зацепить кучку крылом, чтобы она рванула среди зомби.
EXPLOSIVES = ('Prop_Barrel', 'Prop_Barrel', 'Prop_Jerrycan')
for i, (x, z, heading) in enumerate(walk(13)):
    if i < 3:
        continue  # у машины пусто: первую бочку игрок должен увидеть издали
    cx, cz = aside(x, z, heading, random.uniform(-7, 7))
    for _ in range(random.randint(1, 3)):
        px, pz = cx + random.uniform(-1.6, 1.6), cz + random.uniform(-1.6, 1.6)
        if inside(px, pz, SHOULDER - 1.5) and free(px, pz, 0.9):
            put(random.choice(EXPLOSIVES), px, pz, random.uniform(-180, 180))


# ── тесаки: на случай, если машину разобьют ─────────────────────────────────
# На машине они не нужны, а вот пешком после взрыва — самое то: герой выходит
# посреди толпы, и тесак под рукой лучше, чем бег до следующей бочки. Лежат по
# обочинам, по одному-два, редко — это запас, а не арсенал.
for i, (x, z, heading) in enumerate(walk(24)):
    if i < 2:
        continue  # у машины их нет: там игрок ещё не пешком
    cx, cz = aside(x, z, heading, random.choice((-8, 8)))
    for _ in range(random.randint(1, 2)):
        px, pz = cx + random.uniform(-2, 2), cz + random.uniform(-2, 2)
        if inside(px, pz, SHOULDER - 1) and free(px, pz, 0.8):
            put('Weapon_Cleaver', px, pz, random.uniform(-180, 180))


# ── зомби вдоль трассы ──────────────────────────────────────────────────────
# Редко у старта и всё гуще к выезду: пока разгоняешься — их единицы, а к концу
# дорога забита, и проехать можно только тараном.
total = sum(math.dist(a, b) for a, b in segments())
done = 0.0
for (x0, z0), (x1, z1) in segments():
    length = math.dist((x0, z0), (x1, z1))
    heading = math.degrees(math.atan2(x1 - x0, z1 - z0))
    for i in range(int(length // 6)):
        t = i * 6 / length
        x, z = x0 + (x1 - x0) * t, z0 + (z1 - z0) * t
        share = (done + i * 6) / total
        if share < 0.12:
            continue  # у самой машины пусто: сесть в неё дают спокойно
        # Множитель подобран под итог — около сотни с небольшим на уровень:
        # толпа всё ещё гуще к выезду, но проезжается, а не вязнет.
        for _ in range(round(1.15 * (1 + int(share * 4)))):
            # Несколько попыток на каждого: в густой толпе первое место часто
            # уже занято, и без повторов половина задуманных просто пропадала.
            for _attempt in range(6):
                px, pz = aside(x, z, heading, random.uniform(-SHOULDER + 1.5, SHOULDER - 1.5))
                px += random.uniform(-3, 3)
                pz += random.uniform(-3, 3)
                if not inside(px, pz, SHOULDER - 1):
                    continue  # случайный сдвиг не должен выносить за забор
                if zombie(px, pz):
                    break
    done += length


# ── вехи: по одной на угол, чтобы стрелка не вела сквозь застройку ──────────
guide = [{'at': [round(x, 2), round(z, 2), 14], 'halo': False} for x, z in CORNERS[1:-1]]


level = {
    'id': 'highway',
    'name': 'Шоссе на перекрёсток',
    'number': 3,
    'next': 'crossroads',
    'music': None,           # дорожки у шоссе нет: под мотор играет один ветер
    'size': [W, D],
    'ground': {'color': '#3f3a34', 'y': -0.06},
    'spawn': {'position': [round(START[0], 2), round(START[1], 2)], 'rotation': round(START[2], 1)},
    # Машина на полотне, в паре шагов от старта: первое, что видно на уровне.
    'car': {'at': [round(CAR[0], 2), round(CAR[1], 2)], 'rotation': round(CAR[2], 1)},
    'exitAt': [CORNERS[-1][0] - 8, CORNERS[-1][1], 7],
    'guide': guide,
    'props': props,
    'zombies': zombies,
}

with open(LEVEL, 'w', encoding='utf-8') as f:
    json.dump(level, f, ensure_ascii=False, indent=2)

print('пропов:', len(props), '| зомби:', len(zombies), '| вех:', len(guide),
      '| зданий:', sum(1 for p in props if p['prop'].startswith('Bld_')),
      '| плиток:', len(cells))
