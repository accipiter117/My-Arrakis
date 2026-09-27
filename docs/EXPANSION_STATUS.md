# Expansion status

Tracks progress against docs/EXPANSION_PLAN.md (Ixians & Tleilaxu, CHOAM & Richese).

## Decisions (section 1 of the plan)
- D1 Worthless cards: return only when needed (CHOAM, Leader Skills or Stronghold Cards). Decided.
- D2 Faction selection: any 2 to 6 of the available factions. Built (M0).
- D3 Tech Tokens: default on when Ixians or Tleilaxu are seated (plan default). To confirm at M4.
- D4 Leader Skills / Stronghold Cards: toggles, off until M7 / M8 ship (plan default).
- D5 CHOAM charity: CHOAM collects spice for every player, so it can always pay. Decided.
- D6 Bribes: not implemented in the app; record the Inflation flag only.
- D7 Cyborg revival: no separate cap, within the normal 3 a turn. Decided.
- D8 Hidden information: to be enforced per faction as each is built.

## Milestones
- M0 Foundations: faction selection DONE; engine verified with any 2 to 6 base factions. Remaining M0 items (registry for new factions, force profiles, event hooks, spice helpers, card data model) are built with the first milestone that needs them.
- M1 Ixians & Tleilaxu cards: DONE. 10 battle cards; Harvester, Thumper, Amal; Kull Wahad (worthless, only with D1);
  Sandtrout; Cheap Hero traitor. AI and player decisions, event cards, card help, tests
  (tests/leaderResolution.sim.js, tests/spiceCards.sim.js). Switch: expansions.ixTlCards.
- M2 Tleilaxu: CORE DONE. Faction, Face Dancers (reveal, cycling, Mentat Pause swap), revival economy, limit increase,
  ally half price, Zoal, AI and player decisions, guide entry, tests (tests/tleilaxu.sim.js). REMAINING: Gholas,
  leader-price negotiation, Face Dancer replacement from the board, Tleilaxu Karama powers, art and audio.
- M3 Ixians, M4 Tech Tokens, M5 CHOAM, M6 Richese, M7 Leader Skills, M8 Stronghold Cards, M9 cross-cutting, M10 AI, M11 UI: not started.
