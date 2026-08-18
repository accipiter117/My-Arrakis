# Sector Data: Outstanding TODOs

Tracks everything in the engine that's blocked on finalized sector data
(the 18 radial sectors, which territories occupy which sectors, and which
sector each faction's player circle sits at). One list, kept up to date,
rather than TODOs scattered across files with no way to see the total
picture. Check items off here as sector data lands and the corresponding
code gets un-stubbed.

## What's needed before any of this can be finished

1. **Sector assignment per territory.** Which of the 18 sectors each
   territory occupies, including the several territories the rulebook
   confirms span more than one sector. You're counting these directly
   off the board, per our last conversation.
2. **Player circle sector positions.** Which sector each of the six
   player circles sits at around the board rim. Needed for First Player
   determination every turn. Not yet discussed at all, worth flagging
   now rather than discovering it's missing later.
3. **Sector numbering direction.** Once sectors have actual numbers,
   confirming which way "counterclockwise" (the rulebook's stated storm
   direction) runs relative to that numbering. `stormEngine.js` currently
   assumes increasing sector index = counterclockwise; if that's backwards
   once real numbers exist, it's a one-line sign flip, not a redesign,
   but worth confirming rather than assuming.

## Blocked code, by file

**`js/stormEngine.js`**
- `applyStormDamage()` — throws NOT_IMPLEMENTED. Needs the territory→sector
  map to know which forces/spice a given storm sweep actually destroys.
- `isTerritoryPartiallyInStorm()` — throws NOT_IMPLEMENTED. Needed because
  multi-sector territories can be legally occupied while only part of
  them is stormbound.
- `determineFirstPlayer()` — throws NOT_IMPLEMENTED. Needs the player
  circle sector map.

**`js/movementEngine.js`**
- Two TODO comments in `reachableTerritories()` and `canShip()`: storm
  should block movement/shipment into, out of, or through a stormed
  sector, currently unchecked entirely (every move looks "legal" from a
  storm perspective, which is wrong, just not yet wrong in a way that's
  been wired up).

**`js/spiceEngine.js`**
- One TODO in `placeSpiceBlow()`: a spice blow in a stormed sector
  should place no spice per the rulebook ("If the Spice Blow icon is
  currently in storm, no spice is placed that turn"). Currently every
  spice blow places spice unconditionally.

**`data/territories.json`**
- `adjacentDraft` field name still carries the "draft" qualifier from
  the visual-trace/cross-reference process, most of it is now fairly
  well verified but hasn't been fully confirmed the way the two
  originally-flagged clusters were. Worth a rename to `adjacent` once
  sectors are in and you've had a chance to sanity-check the rest in
  passing.

## Not blocked, for clarity

Everything else already built (bidding, movement's core adjacency logic,
spice blow placement itself, battles, revival, CHOAM Charity, and the
storm movement distance math) works correctly without sector data. Only
the specific mechanics above need it.
