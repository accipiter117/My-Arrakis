# AI Notes

## Strategic AI (js/ai/strategicAI.js), step 2 of AI_PLAN.md

Wraps the Basic AI with a strategic layer: victory proximity from public
information, threat ranking, and two goals for shipment and movement,
DENY (break a leader's weakest stronghold, block a live Fremen special
win) and CLOSE OUT (take the third stronghold).

Tournament (tests/tournament.sim.js, 60 seeds per seat, fully seeded so
both arms see identical decks and dice):

- Same seat head to head: Strategic 70 wins vs Basic 60 (+17%). Emperor
  4 vs 0, Harkonnen 11 vs 6, Guild 34 vs 30, Fremen 20 vs 20.
- All-Strategic tables: stronghold wins 62 vs 21 for all-Basic; Fremen
  special 6 vs 27.

Lessons learned building it:

- Denial is a public good: the blocker pays and everyone else benefits.
  A naive "always block" version won fewer games from a single seat. Now it
  blocks only on the last chance or when among the two best-placed factions.
- Never strip a held stronghold to act elsewhere. An early version did and
  handed rivals their third stronghold (Guild seat fell from 22 to 12 wins).
- Guild wins ~60% of all-Strategic games, now often by strongholds too.
  Cause to investigate next (cheap shipping plus collecting everyone's
  shipping fees), not to be fixed by weakening the Guild.

## Reproducibility

All engine and AI randomness goes through js/random.js, seeded once per
game. tests/determinism.sim.js proves a seed replays a game exactly. The
game log shows each game's seed; add ?seed=N to the address to replay it.

## Basic AI (js/ai/basicAI.js)

Plays every phase legally with simple sense: bids to a small valuation,
ships and moves towards strongholds and spice, revives when funded, fights
with its strongest leader and whatever weapon and defence it holds. No
threat assessment, bluffing, alliances or forward planning; that is the
strategic layer (brief Phase 4), built on the same decision-provider
interface.

It reads only public state plus its own private state. It never reads
another faction's spice, hand, traitors or battle plan.

## Latest simulation (150 games, Basic AI x6)

- 0 failures, with invariants now also proving every faction's total forces
  and starred forces are conserved across reserve, board and tanks
- Winners: Guild 86, Fremen 32, Harkonnen 22, Atreides 8, Bene Gesserit 2
  (Prediction now works), Emperor 0
- Emperor remains the outlier. Starred-unit bugs (below) were one cause;
  the rest is the Basic AI's naive shipping. Revisit with the strategic AI.

## Earlier simulation (100 games, before the starred-unit fixes)

- 0 failures; invariants checked after every phase (whole-number spice,
  no negative forces or reserves, hand limits, treachery card conservation)
- Average game ends on turn 9.3; ~16 battles, ~24 cards bought, ~34
  shipments per game
- Winners: Guild 47, Fremen 32, Harkonnen 16, Atreides 5, Emperor 0,
  Bene Gesserit 0
- Methods: Guild special 47, Fremen special 30, stronghold solo 23

## Reading the results (causes, not rebalancing)

- **Guild and Fremen special wins dominate.** AI cause: nobody denies them.
  The basic AI never contests Tuek's Sietch or Habbanya Sietch to block the
  Fremen, and never pushes for a third stronghold before the final turn.
  Threat assessment in the strategic layer should change this.
- **Bene Gesserit cannot win.** Engine gap: the Prediction victory is not
  yet checked by victoryEngine.js, and no Prediction is made at setup in
  AI games. Fix before judging BG balance at all.
- **Emperor never wins.** Likely AI cause: it starts with nothing on the
  board and spends heavily shipping into contested strongholds. Worth
  checking once the strategic layer exists.
- **Storm deals no damage yet** (blocked on sector data), which removes a
  major source of attrition and will shift these numbers.

## Bugs found by running full games (all fixed, with regression tests)

- Spice deck reshuffle referenced a discard pile that no longer existed,
  crashing around turn 8 once the deck ran dry
- Guild half-price shipping produced fractional spice (now rounded up)
- Killed leaders paid the battle winner 0 spice instead of their value
- Sardaukar and Fedaykin were never shipped, so never reached a battle
- Starred forces lost in battle, to worms or to the ally penalty returned
  as ordinary forces; the worm also left "ghost" starred forces behind
- Revival could take ordinary forces from tanks holding only starred ones
