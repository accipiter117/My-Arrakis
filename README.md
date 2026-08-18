# My Arrakis

A digital implementation of the Gale Force Nine 2019 edition of Dune, built for
mobile Safari and hosted on GitHub Pages. Single human player against AI
opponents, all ten factions (base six plus Ixians, Tleilaxu, CHOAM, Richese).

No backend, no build step, vanilla JS on static hosting.

## Status: Phase 1, engine only

Nothing playable yet. Current focus is the data model and phase state machine,
with no UI. See `docs/faction-reference.md` for the rules basis, verified
against the official rulebooks rather than reconstructed from memory.

## Structure

```
data/
  factions.json      faction identities and special abilities as data
  leaders.json        leader roster shape (fighting values pending verification)
  rulesConfig.json    standard/advanced/optional rule toggles
js/
  gameState.js         central game state factory
  phaseEngine.js        turn phase state machine
docs/
  faction-reference.md  full faction rules reference with sources
```

## Running locally

No build step required. `node --check` any `.js` file to validate syntax.
Data files are validated JSON, load with any parser.

## Known gaps

- `leaders.json` has no fighting values yet, those are printed on the physical
  leader discs and not recoverable from rulebook text alone
- Richese No-Field tokens, the Ixian Hidden Mobile Stronghold, and Tleilaxu
  Face Dancers need dedicated state shapes, currently unbuilt
- No map/territory data yet
- No UI, no rendering, nothing runs end to end
