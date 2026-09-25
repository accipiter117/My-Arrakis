# AI Notes

## Basic AI (js/ai/basicAI.js)

Plays every phase legally with simple sense: bids to a small valuation,
ships and moves towards strongholds and spice, revives when funded, fights
with its strongest leader and whatever weapon and defence it holds. No
threat assessment, bluffing, alliances or forward planning; that is the
strategic layer (brief Phase 4), built on the same decision-provider
interface.

It reads only public state plus its own private state. It never reads
another faction's spice, hand, traitors or battle plan.

## Simulation results (tests/aiSimulation.sim.js, 100 games, Basic AI x6)

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
