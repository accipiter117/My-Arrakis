# My Arrakis

A digital implementation of the Gale Force Nine 2019 edition of Dune, built
for mobile browsers and hosted on GitHub Pages. You play one faction against
five AI opponents. No backend, no build step, plain JavaScript modules.

Play: https://accipiter117.github.io/My-Arrakis/ (once GitHub Pages is enabled
under Settings > Pages, branch `main`, folder `/`).

## How to play

1. Choose your faction under **Play as** (or Spectate to watch six AIs).
2. Choose **Opponents**: Basic AI, or Passive (an engine test stub).
3. **Start New Game**, then **Run Full Turn** or **Step One Phase**.
4. Whenever a decision is yours, the game pauses and a panel asks you:
   traitor, storm dial, bids, revival, shipment and movement, battle plans.
   Illegal choices are explained before you commit.

Other factions' spice and traitors are hidden from you, as they are behind
player shields in the physical game.

## Status

- Rules engine: all nine phases, advanced rules always on, six base factions
- Basic AI: legal, simple-sense play, reads only public information plus
  its own hand
- Human play: full decision panels for one faction
- Not yet: storm damage and First Player (awaiting sector data, see
  `docs/STORM_TODO.md`), strategic AI, alliances for the human player,
  Voice, advisors, Karama, expansion factions, an illustrated board

## Running locally

```
python3 -m http.server 8000     # then open http://localhost:8000
npm test                         # all engine and simulation tests (Node 18+)
node tests/aiSimulation.sim.js 200   # AI-vs-AI batch with rule invariants
```

## Structure

```
index.html, ui/        page, styles, main UI, human decision panels
js/                    rules engine, one module per phase, plus turn engine
js/ai/                 Basic AI and the human/AI routing provider
data/                  factions, leaders, territories, decks, rules config
tests/                 engine tests and the AI-vs-AI simulation harness
docs/                  faction reference, AI notes, outstanding TODOs
```
