"""Borders from the drawn map: what you see is what you can move across.

Two territories border each other when a real stretch of their outlines runs
alongside each other (the drawn shapes are inset, so there is a small gap
between neighbours). Touching only at a corner does not count, as on the
physical board. Writes adjacentDraft (used for movement) into
data/territories.json, keeping the original rulebook list as adjacentBoard.
"""
import json, math, re, sys
geo = json.load(open('data/mapGeometry.json'))
terr = json.load(open('data/territories.json'))
GAP = 12        # max distance between neighbouring outlines (px)
MIN_SHARED = 66 # min shared edge (px): every corner contact measured <= 60, every real edge >= 72

def polygon(path):
    nums = [float(n) for n in re.findall(r'-?\d+\.?\d*', path)]
    return list(zip(nums[0::2], nums[1::2]))

def densify(poly, step=2.0):
    out = []
    for i in range(len(poly)):
        (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % len(poly)]
        n = max(1, int(math.hypot(x2 - x1, y2 - y1) / step))
        out += [(x1 + (x2 - x1) * k / n, y1 + (y2 - y1) * k / n) for k in range(n)]
    return out

def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy or 1)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))

polys = {t: polygon(g['path']) for t, g in geo['territories'].items() if t in terr['territories']}
dense = {t: densify(p) for t, p in polys.items()}
def shared(a, b):
    pb = polys[b]
    near = sum(1 for (x, y) in dense[a]
               if min(seg_dist(x, y, *pb[i], *pb[(i + 1) % len(pb)]) for i in range(len(pb))) <= GAP)
    return near * 2.0  # samples are 2px apart

ids = sorted(polys)
adj = {t: set() for t in ids}
for i, a in enumerate(ids):
    ax = [p[0] for p in polys[a]]; ay = [p[1] for p in polys[a]]
    for b in ids[i + 1:]:
        bx = [p[0] for p in polys[b]]; by = [p[1] for p in polys[b]]
        if min(bx) > max(ax) + GAP or min(ax) > max(bx) + GAP or min(by) > max(ay) + GAP or min(ay) > max(by) + GAP:
            continue
        if min(shared(a, b), shared(b, a)) >= MIN_SHARED:
            adj[a].add(b); adj[b].add(a)

changes = []
for t in ids:
    old = set(terr['territories'][t].get('adjacentBoard', terr['territories'][t]['adjacentDraft']))
    terr['territories'][t].setdefault('adjacentBoard', sorted(old))
    new = adj[t]
    if new != old:
        changes.append((t, sorted(new - old), sorted(old - new)))
    if '--write' in sys.argv:
        terr['territories'][t]['adjacentDraft'] = sorted(new)
if '--write' in sys.argv:
    json.dump(terr, open('data/territories.json', 'w'), indent=2)
for t, added, removed in changes:
    print(f"{t:18} +{added}  -{removed}")
print(f"{len(changes)} territories differ from the old list")

if '--lengths' in sys.argv:
    print("\nShared edge length for every pair that differs from the old list:")
    seen = set()
    for t in ids:
        old = set(terr['territories'][t].get('adjacentBoard', []))
        for other in sorted(set(polys) - {t}):
            key = tuple(sorted((t, other)))
            if key in seen: continue
            seen.add(key)
            in_new, in_old = other in adj[t], other in old
            if in_new != in_old or (in_new and min(shared(t, other), shared(other, t)) < 40):
                L = min(shared(t, other), shared(other, t))
                print(f"  {'ADD ' if in_new and not in_old else 'DROP' if in_old and not in_new else 'keep'} {t} / {other}: {L:.0f}px")
