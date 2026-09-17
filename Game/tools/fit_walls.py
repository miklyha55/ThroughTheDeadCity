# -*- coding: utf-8 -*-
"""
Подгонка стен внутри помещений: секции стык в стык, углы внахлёст.

Стены набраны секциями по четыре метра, и руками их ставят «примерно»: чуть
растянули одну, чуть сдвинули другую. Отсюда два вида швов. Между секциями одной
стены — щель или ступенька, где одна заехала в другую. И на углах: две стены
сходятся осями в одну точку, а толщина у них есть, так что снаружи угла остаётся
выгрызенный квадрат, а изнутри торцы лезут друг в друга.

Скрипт берёт стены из файла уровня как есть — какие модели, в каком порядке, на
какой линии — и пересчитывает только положение и длину.

Ряд. Секции одной линии, стоящие подряд, — это одна стена; разрыв больше секции
значит проём. Концы стены привязываются к сетке в четыре метра: на ней стоит вся
планировка, и по ней же видно, где стена кончается. Длина делится поровну на
число секций, и они встают вплотную, без нахлёста.

Угол. Где сходятся концы двух стен, одна из них проходит угол насквозь и
выступает за ось ровно на половину толщины — до внешней грани второй. Вторая,
наоборот, укорочена на ту же половину и упирается торцом во внутреннюю грань
первой. Вместе это и есть наезд одной стены на другую на всю её толщину: снаружи
угол целый, внутри ничего не торчит. Насквозь всегда идёт стена вдоль X — так
все углы уровня выглядят одинаково.

Примыкание. Где конец стены упирается в середину другой — буква «Т», — конец
укорачивается на половину толщины: торец встаёт на грань, а не в неё.

Свободный конец, у проёма, остаётся на месте.

Запуск: python3 tools/fit_walls.py public/locations/tutorial.json
"""
import json, sys

SECTION = 4.0    # длина стеновой секции и шаг сетки планировки, м
THICK = 0.34     # толщина стены, м
GAP = 6.0        # центры дальше этого — между секциями проём
NEAR = 0.05      # допуск при поиске стыков, м


def orientation(prop):
    """0 — стена вдоль X, 1 — вдоль Z."""
    return 0 if round(prop.get('rotation', 0) / 90) % 2 == 0 else 1


def snap(value):
    return round(value / SECTION) * SECTION


def runs(walls):
    """Стены, разобранные на сплошные ряды."""
    lines = {}
    for prop in walls:
        side = orientation(prop)
        x, z = prop['at']
        across, along = (z, x) if side == 0 else (x, z)
        key = (side, round(across, 1))
        lines.setdefault(key, []).append((along, prop))

    out = []
    for (side, across), row in lines.items():
        row.sort(key=lambda item: item[0])

        current = [row[0]]
        for item in row[1:]:
            if item[0] - current[-1][0] > GAP:
                out.append(make_run(side, across, current))
                current = []
            current.append(item)
        out.append(make_run(side, across, current))
    return out


def make_run(side, across, row):
    centers = [along for along, _ in row]
    return {
        'side': side,
        'across': snap(across) if abs(across - snap(across)) < 0.3 else across,
        'start': snap(centers[0] - SECTION / 2),
        'end': snap(centers[-1] + SECTION / 2),
        'pieces': [prop for _, prop in row],
    }


def junction(run, at, others):
    """
    Что на конце ряда: 'corner' — сходится с концом другой стены, 'tee' — упирается
    в её середину, None — свободный конец.
    """
    for other in others:
        if other['side'] == run['side']:
            continue
        if abs(other['across'] - at) > NEAR:
            continue
        if not other['start'] - NEAR <= run['across'] <= other['end'] + NEAR:
            continue

        at_end = (abs(run['across'] - other['start']) <= NEAR
                  or abs(run['across'] - other['end']) <= NEAR)
        return 'corner' if at_end else 'tee'
    return None


def trim(run, kind):
    """На сколько сдвинуть конец ряда наружу: плюс — длиннее, минус — короче."""
    if kind == 'tee':
        return -THICK / 2
    if kind == 'corner':
        return THICK / 2 if run['side'] == 0 else -THICK / 2
    return 0.0


def main(path):
    level = json.load(open(path, encoding='utf-8'))
    walls = [p for p in level['props'] if p['prop'].startswith('Wall_')]
    rows = runs(walls)

    stats = {'corner': 0, 'tee': 0, None: 0}
    for run in rows:
        head = junction(run, run['start'], rows)
        tail = junction(run, run['end'], rows)
        stats[head] += 1
        stats[tail] += 1

        start = run['start'] - trim(run, head)
        end = run['end'] + trim(run, tail)

        count = len(run['pieces'])
        length = (end - start) / count
        for index, prop in enumerate(run['pieces']):
            along = start + length * (index + 0.5)
            at = [along, run['across']] if run['side'] == 0 else [run['across'], along]
            prop['at'] = [round(v, 3) for v in at]
            prop['rotation'] = 0 if run['side'] == 0 else 90
            prop['scale'] = [round(length / SECTION, 4), 1, 1]

    json.dump(level, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f"рядов {len(rows)}, секций {len(walls)}; "
          f"углов {stats['corner'] // 2}, примыканий {stats['tee']}, свободных концов {stats[None]}")
    return rows


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'public/locations/tutorial.json')
