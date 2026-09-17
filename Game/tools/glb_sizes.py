# -*- coding: utf-8 -*-
"""
Осевые габариты моделей из библиотеки пропов.

Нужны раскладке уровней: чтобы поставить стену встык или проверить, пролезет ли
герой между ящиками, нужен размер модели, а он живёт в GLB и больше нигде.
Читаем прямо из файла, без three.js: в заголовке GLB лежит JSON со списком
вершинных наборов, а у каждого — уже посчитанные пределы координат.

Запуск: python3 tools/glb_sizes.py > /tmp/sizes.json
"""
import json, struct, sys

GLB = 'public/assets/models/props.glb'


def read(path=GLB):
    """{имя модели: {w, h, d, cx, cy, cz}} — размеры и смещение центра."""
    blob = open(path, 'rb').read()
    length = struct.unpack_from('<I', blob, 12)[0]
    doc = json.loads(blob[20:20 + length].decode('utf-8'))

    out = {}
    for index, node in enumerate(doc['nodes']):
        name = node.get('name')
        if not name:
            continue

        lo = [float('inf')] * 3
        hi = [float('-inf')] * 3
        for mesh in meshes(doc, index):
            for part in doc['meshes'][mesh]['primitives']:
                bounds = doc['accessors'][part['attributes']['POSITION']]
                if not bounds.get('min'):
                    continue
                for axis in range(3):
                    lo[axis] = min(lo[axis], bounds['min'][axis])
                    hi[axis] = max(hi[axis], bounds['max'][axis])

        if lo[0] == float('inf'):
            continue
        out[name] = {
            'w': hi[0] - lo[0], 'h': hi[1] - lo[1], 'd': hi[2] - lo[2],
            'cx': (hi[0] + lo[0]) / 2, 'cy': (hi[1] + lo[1]) / 2, 'cz': (hi[2] + lo[2]) / 2,
        }
    return out


def meshes(doc, index):
    """Все вершинные наборы узла вместе с вложенными."""
    node = doc['nodes'][index]
    if node.get('mesh') is not None:
        yield node['mesh']
    for child in node.get('children', ()):
        yield from meshes(doc, child)


if __name__ == '__main__':
    json.dump(read(), sys.stdout, ensure_ascii=False, indent=1)
