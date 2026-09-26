"""
tools/buildMap.py : generates data/mapGeometry.json, an ORIGINAL map of
Arrakis for the UI.

Not a tracing of the printed board (brief section 7, and to avoid
reproducing its artwork). Each territory gets one or more seed points at
its approximate real-world position; the disc is divided into regions
around those seeds (a Voronoi diagram), seeds belonging to the same
territory are merged, and every region is inset slightly with rounded
corners to give our own tiled look.

The script then checks the map against data/territories.json: every pair
of territories drawn as touching must be adjacent in the rules data, and
every adjacent pair should touch. Mismatches are printed so seeds can be
nudged until the map and the rules agree.

Run: python3 tools/buildMap.py [--preview out.png]
"""
import json, math, sys
from shapely.geometry import Point, MultiPoint, Polygon
from shapely.ops import voronoi_diagram, unary_union, polylabel

CX, CY, R = 500.0, 500.0, 460.0

# Approximate positions on a 1000x1000 canvas, north at the top. Several
# seeds per large territory shape it without copying any outline.
SEEDS = {
    "polarSink":        [(500, 505)],
    "brokenLand":       [(415, 95), (520, 90)],
    "oldGap":           [(655, 115), (610, 100)],
    "tsimpo":           [(445, 180), (400, 175)],
    "basin":            [(760, 190)],
    "rockOutcroppings": [(250, 175), (300, 130)],
    "plasticBasin":     [(320, 285), (365, 330), (290, 225)],
    "sietchTabr":       [(205, 285)],
    "carthag":          [(492, 238)],
    "arrakeen":         [(645, 205)],
    "rimWallWest":      [(700, 245)],
    "sihayaRidge":      [(815, 240)],
    "haggaBasin":       [(405, 330), (430, 390)],
    "imperialBasin":    [(575, 320), (560, 400)],
    "holeInTheRock":    [(730, 300)],
    "shieldWall":       [(665, 355), (755, 330)],
    "garaKulon":        [(850, 330)],
    "bightOfTheCliff":  [(130, 335)],
    "funeralPlain":     [(175, 405)],
    "theGreatFlat":     [(160, 470), (270, 475)],
    "arsunt":           [(485, 395), (470, 445)],
    "falseWallEast":    [(580, 475)],
    "theMinorErg":      [(655, 480), (640, 430)],
    "pastyMesa":        [(780, 470), (850, 430), (760, 560)],
    "redChasm":         [(935, 470)],
    "theGreaterFlat":   [(150, 545), (260, 540)],
    "habbanyaErg":      [(165, 610), (250, 605)],
    "falseWallWest":    [(330, 620), (305, 690)],
    "windPass":         [(395, 520)],
    "windPassNorth":    [(415, 590)],
    "hargPass":         [(585, 575)],
    "falseWallSouth":   [(690, 655), (720, 740), (660, 590)],
    "tueksSietch":      [(835, 690)],
    "southMesa":        [(890, 620), (860, 780)],
    "habbanyaSietch":   [(195, 695)],
    "habbanyaRidgeFlat":[(215, 790)],
    "cielagoWest":      [(370, 700)],
    "cielagoNorth":     [(500, 640), (505, 700)],
    "cielagoDepression":[(490, 790), (420, 780)],
    "cielagoEast":      [(650, 840), (615, 780)],
    "meridian":         [(380, 880), (320, 850)],
    "cielagoSouth":     [(540, 900)],
}

def build():
    import os
    territories = json.load(open("data/territories.json"))["territories"]
    # Prefer the optimiser's tuned seeds (tools/optimizeMap.py) when present.
    if os.path.exists("tools/mapSeeds.json"):
        SEEDS.update({k: [tuple(p) for p in v] for k, v in json.load(open("tools/mapSeeds.json")).items()})
    missing = set(territories) - set(SEEDS)
    assert not missing, f"no seeds for {missing}"

    disc = Point(CX, CY).buffer(R, resolution=96)
    points, owner = [], []
    for tid, pts in SEEDS.items():
        for p in pts:
            points.append(p); owner.append(tid)
    cells = voronoi_diagram(MultiPoint(points), envelope=disc.buffer(200))
    raw = {tid: [] for tid in SEEDS}
    for cell in cells.geoms:
        for i, p in enumerate(points):
            if cell.contains(Point(p)):
                raw[owner[i]].append(cell.intersection(disc))
                break
    shapes = {tid: unary_union(parts) for tid, parts in raw.items()}
    return territories, shapes, disc

def adjacency_report(territories, shapes):
    touching = set()
    ids = list(shapes)
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            shared = shapes[a].boundary.intersection(shapes[b].boundary)
            if shared.length > 6:  # a real shared border, not a corner point
                touching.add(frozenset((a, b)))
    rules = {frozenset((a, b)) for a, t in territories.items() for b in t.get("adjacentDraft", [])}
    drawn_not_rules = sorted(tuple(sorted(p)) for p in touching - rules)
    rules_not_drawn = sorted(tuple(sorted(p)) for p in rules - touching)
    return drawn_not_rules, rules_not_drawn

def path_of(geom):
    polys = [geom] if geom.geom_type == "Polygon" else list(geom.geoms)
    out = []
    for poly in polys:
        coords = list(poly.exterior.coords)
        out.append("M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in coords[:-1]) + " Z")
    return " ".join(out)

def main():
    territories, shapes, disc = build()
    extra, missing = adjacency_report(territories, shapes)
    print(f"Drawn as touching but NOT adjacent in the rules ({len(extra)}): {extra}")
    print(f"Adjacent in the rules but NOT touching on the map ({len(missing)}): {missing}")
    split = [tid for tid, shape in shapes.items() if shape.geom_type != "Polygon"]
    print(f"Territories drawn in more than one piece ({len(split)}): {split}")
    assert not split, "every territory must be one connected shape; adjust its seeds"

    out = {"viewBox": [0, 0, 1000, 1000], "center": [CX, CY], "radius": R, "territories": {}}
    for tid, shape in shapes.items():
        tile = shape.buffer(-3.5, join_style="round").buffer(2, join_style="round")
        label = polylabel(shape if shape.geom_type == "Polygon" else max(shape.geoms, key=lambda g: g.area), tolerance=1)
        out["territories"][tid] = {"path": path_of(tile), "label": [round(label.x, 1), round(label.y, 1)],
                                   "area": round(shape.area)}
    json.dump(out, open("data/mapGeometry.json", "w"), separators=(",", ":"))
    print(f"Wrote data/mapGeometry.json ({len(out['territories'])} territories)")

    if "--preview" in sys.argv:
        from PIL import Image, ImageDraw
        img = Image.new("RGB", (1000, 1000), (236, 223, 196)); d = ImageDraw.Draw(img)
        fills = {"sand": (226, 205, 150), "rock": (176, 140, 96), "stronghold": (140, 70, 45), "polarSink": (245, 240, 225)}
        for tid, shape in shapes.items():
            tile = shape.buffer(-3.5, join_style="round")
            polys = [tile] if tile.geom_type == "Polygon" else list(tile.geoms)
            for poly in polys:
                d.polygon(list(poly.exterior.coords), fill=fills[territories[tid]["type"]], outline=(42, 31, 20))
            lx, ly = out["territories"][tid]["label"]
            d.text((lx - 20, ly - 5), territories[tid]["name"][:12], fill=(20, 15, 10))
        img.save(sys.argv[sys.argv.index("--preview") + 1])

if __name__ == "__main__":
    main()
