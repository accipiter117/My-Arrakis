# Map borders: resolved

The drawn map is now the single source of truth for borders, so what you see
on screen is exactly what you can move across. tools/computeBorders.py derives
borders from the territory outlines (a real border needs 66px of shared edge;
corners where several territories meet do not count). The original rulebook
list is kept in data/territories.json as adjacentBoard for reference.

Likewise, storm sectors come from the same map (tools/computeSectors.py), so
the storm's damage always matches the wedge drawn on screen.

To regenerate after any change to the map:

    python3 tools/computeSectors.py
    python3 tools/computeBorders.py --write
