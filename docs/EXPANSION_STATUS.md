# Expansion status

Tracks progress against docs/EXPANSION_PLAN.md (Ixians & Tleilaxu, CHOAM & Richese).

## Decisions (section 1 of the plan)
- D1 Worthless cards: return only when needed (CHOAM, Leader Skills or Stronghold Cards). Built (M5).
- D2 Faction selection: any 2 to 6 of the available factions. Built (M0).
- D3 Tech Tokens: on in every game by default (menu: Always / With Ixians or Tleilaxu / Off). Decided.
- D4 Leader Skills / Stronghold Cards: toggles, off until M7 / M8 ship (plan default).
- D5 CHOAM charity: CHOAM collects spice for every player, so it can always pay. Decided.
- D6 Bribes: built (js/negotiation.js). Inflation on Double blocks all deals that turn.
- D7 Cyborg revival: no separate cap, within the normal 3 a turn. Decided.
- D8 Hidden information: to be enforced per faction as each is built.

## Milestones
- M0 Foundations: faction selection DONE; engine verified with any 2 to 6 base factions. Remaining M0 items (registry for new factions, force profiles, event hooks, spice helpers, card data model) are built with the first milestone that needs them.
- M1 Ixians & Tleilaxu cards: DONE. 10 battle cards; Harvester, Thumper, Amal; Kull Wahad (worthless, only with D1);
  Sandtrout; Cheap Hero traitor. AI and player decisions, event cards, card help, tests
  (tests/leaderResolution.sim.js, tests/spiceCards.sim.js). Switch: expansions.ixTlCards.
- M2 Tleilaxu: CORE DONE. Faction, Face Dancers (reveal, cycling, Mentat Pause swap), revival economy, limit increase,
  ally half price, Zoal, AI and player decisions, guide entry, tests (tests/tleilaxu.sim.js). Gholas and early leader
  revival DONE. Ghola buy-back and Face Dancer replacements from the board DONE. REMAINING: Karama powers, audio.
- M3 Ixians: CORE DONE. Faction, Cyborgs/Suboids, HMS (placement, movement, spice, victory, entry rules), starting draft,
  auction bury, ally card swap, AI and player decisions, guide, tests (tests/ixians.sim.js). Technology and the Suboid exchange
  DONE. REMAINING: Karama powers, audio.
- M4 Tech Tokens: DONE. js/techTokens.js; assignment (defaults at setup, the rest dealt after the first storm in turn order from the
  First Player), income at the end of Charity, Revival and Shipment/Movement with the rulebook exclusions, battle transfer (before a
  Face Dancer reveal), a full set counts as a stronghold (not across allies). Menu: Always / With Ixians or Tleilaxu / Off. AI and
  player decisions, Factions sheet, victory watch, log, tests (tests/techTokens.sim.js; every third AI batch game plays with tokens).
  Owner decisions: on in every game by default; in two-player games the leftover token is dealt round again.
- Art: counters, ships and ornithopters for Ixians, Tleilaxu, CHOAM and Richese installed; HMS token and the three Tech Token faces
  installed (assets/tokens), plus the Richese No-Field token (assets/tokens/nofield.png, used from M6).
  Turn announcement audio for the new factions still to come.
- Alliance perks: all eight factions verified (tests/alliancePerks.sim.js).
- M5 CHOAM: DONE (core). js/choam.js; Charity and Inflation, duplicate and worthless discards, all six worthless effects,
  revival terms, Forces share, the Auditor, alliance trade and battle support; AI and player decisions, guide, log, Factions
  sheet; tests (tests/choam.sim.js, incl. 24 AI games across 2 to 6 factions). REMAINING: Karama power and Karama against CHOAM
  (Karama milestone), turn audio. Owner decisions: a traitor-killed Auditor still audits 1 card; ally support goes to the Bank.
- M6 Richese: PART 1 DONE. Faction, leaders, the 10-card cache, cache auction every round (first or last, Once Around or Silent,
  free-or-remove), payments, Harkonnen bonus; AI and player decisions, guide, log; tests (tests/richese.sim.js, incl. 20 AI games).
  No-Field tokens DONE (js/noField.js: shipping, one force for every effect, storm/worm/battle/choice reveals, hidden value, AI use).
  Black Market, alliance powers and all nine cache card effects DONE (js/richeseCards.js, tests/richeseCards.sim.js).
  REMAINING (for reference, now built): Black Market, alliance (No-Field ally shipping, giving cache cards), cache card effects (Distrans,
  Juice of Sapho, Mirror Weapon, Portable Snooper, Ornithopter, Nullentropy Box, Semuta Drug, Residual Poison, Stone Burner).
- Not started (was: M7 Leader Skills, M8 Stronghold Cards, M9 cross-cutting, M10 AI, M11 UI: not started.
