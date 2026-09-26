"""Which storm sector each territory mostly lies in, from our own map geometry.

Uses the same angles as the storm wedge in ui/board.js: sector p spans
screen angles (80 - 20p) to (100 - 20p) degrees around the board centre.
Samples a fine grid inside each territory outline and takes the sector
holding the largest share of its area. Writes stormSector and stormShare
into data/territories.json.
"""
import json, math, re
geo = json.load(open('data/mapGeometry.json'))
cx, cy = geo['center'] if isinstance(geo['center'], list) else json.loads(geo['center'])
terr = json.load(open('data/territories.json'))

def polygon(path):
    nums = [float(n) for n in re.findall(r'-?\d+\.?\d*', path)]
    return list(zip(nums[0::2], nums[1::2]))

def inside(x, y, poly):
    hit = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]; xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            hit = not hit
        j = i
    return hit

def sector_of(x, y):
    theta = math.degrees(math.atan2(y - cy, x - cx))
    return int(math.floor((100 - theta) / 20)) % 18

summary = {}
for tid, g in geo['territories'].items():
    poly = polygon(g['path'])
    xs, ys = [p[0] for p in poly], [p[1] for p in poly]
    counts = [0] * 18
    step = 3
    y = min(ys)
    while y <= max(ys):
        x = min(xs)
        while x <= max(xs):
            if inside(x, y, poly):
                counts[sector_of(x, y)] += 1
            x += step
        y += step
    total = sum(counts)
    if tid not in terr['territories'] or not total:
        continue
    best = max(range(18), key=lambda s: counts[s])
    terr['territories'][tid]['stormSector'] = best
    terr['territories'][tid]['stormShare'] = round(counts[best] / total, 2)
    summary[tid] = (best, round(counts[best] / total, 2), terr['territories'][tid].get('type'))

json.dump(terr, open('data/territories.json', 'w'), indent=2)
for tid, (s, share, typ) in sorted(summary.items(), key=lambda kv: kv[1][0]):
    print(f"sector {s:2}  {share:4.0%}  {typ:10} {tid}")
