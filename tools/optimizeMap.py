"""
tools/optimizeMap.py : nudges the seed points in buildMap.py until the
generated map's borders agree with the rules' adjacency data, while
penalising drift from each territory's approximate real position.
Simulated annealing; fast adjacency from scipy's Voronoi ridges.
Writes the tuned seeds to tools/mapSeeds.json, which buildMap.py prefers.
"""
import json, math, random, sys
import numpy as np
from scipy.spatial import Voronoi
from shapely.geometry import LineString, Point
sys.path.insert(0, "tools")
import buildMap as bm

random.seed(7)
territories = json.load(open("data/territories.json"))["territories"]
rules = {frozenset((a, b)) for a, t in territories.items() for b in t.get("adjacentDraft", [])}
disc = Point(bm.CX, bm.CY).buffer(bm.R, resolution=64)

import os
source = json.load(open("tools/mapSeeds.json")) if os.path.exists("tools/mapSeeds.json") and "--fresh" not in sys.argv else bm.SEEDS
seeds, owner, origin = [], [], []
for tid, pts in source.items():
    for k, p in enumerate(pts):
        seeds.append(list(p)); owner.append(tid)
        base = bm.SEEDS[tid]
        origin.append(tuple(base[min(k, len(base) - 1)]))  # drift measured from the real-world estimate
n = len(seeds)
ring = [(bm.CX + 1600 * math.cos(a), bm.CY + 1600 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 40, endpoint=False)]

def touching(pts):
    vor = Voronoi(np.array(pts + ring))
    lengths = {}
    parent = list(range(n))
    def find(x):
        while parent[x] != x: parent[x] = parent[parent[x]]; x = parent[x]
        return x
    for (i, j), rv in zip(vor.ridge_points, vor.ridge_vertices):
        if i < n and j < n and owner[i] == owner[j] and -1 not in rv:
            seg = LineString([vor.vertices[rv[0]], vor.vertices[rv[1]]]).intersection(disc)
            if seg.length > 4: parent[find(i)] = find(j)
    touching.split = len({find(i) for i in range(n)}) - len(set(owner))
    for (i, j), rv in zip(vor.ridge_points, vor.ridge_vertices):
        if i >= n or j >= n or -1 in rv or owner[i] == owner[j]:
            continue
        seg = LineString([vor.vertices[rv[0]], vor.vertices[rv[1]]]).intersection(disc)
        key = frozenset((owner[i], owner[j]))
        lengths[key] = lengths.get(key, 0) + seg.length
    return {k for k, v in lengths.items() if v > 6}

def cost(pts):
    t = touching(pts)
    wrong = len(t - rules) + len(rules - t) + 2 * touching.split
    drift = sum((p[0] - o[0]) ** 2 + (p[1] - o[1]) ** 2 for p, o in zip(pts, origin))
    return wrong * 10 + drift * 0.004, wrong

cur = [p[:] for p in seeds]
cur_cost, cur_wrong = cost(cur)
best, best_cost, best_wrong = [p[:] for p in cur], cur_cost, cur_wrong
print(f"start: {cur_wrong} disagreements")
steps = int(sys.argv[1]) if len(sys.argv) > 1 else 6000
T0 = float(sys.argv[2]) if len(sys.argv) > 2 else 2.0
for step in range(steps):
    T = T0 * (1 - step / steps) + 0.05
    k = random.randrange(n)
    old = cur[k][:]
    cur[k][0] += random.gauss(0, 12); cur[k][1] += random.gauss(0, 12)
    if math.hypot(cur[k][0] - bm.CX, cur[k][1] - bm.CY) > bm.R - 8:
        cur[k] = old; continue
    c, w = cost(cur)
    if c < cur_cost or random.random() < math.exp((cur_cost - c) / T):
        cur_cost, cur_wrong = c, w
        if c < best_cost:
            best, best_cost, best_wrong = [p[:] for p in cur], c, w
    else:
        cur[k] = old
    if step % 1500 == 0:
        print(f"step {step}: best {best_wrong} disagreements")

tuned = {}
for p, tid in zip(best, owner):
    tuned.setdefault(tid, []).append([round(p[0], 1), round(p[1], 1)])
json.dump(tuned, open("tools/mapSeeds.json", "w"), indent=1)
t = touching(best)
print(f"final: {best_wrong} disagreements")
print("  drawn not in rules:", sorted(tuple(sorted(x)) for x in t - rules))
print("  in rules not drawn:", sorted(tuple(sorted(x)) for x in rules - t))
