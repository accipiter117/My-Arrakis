# Roadmap

A living plan: what's done, what's next, and why. Updated as work lands.

## Done

- **Rules engine:** all nine phases, advanced rules, six base factions,
  traitors, alliances and most ally advantages, Voice, Prescience, captured
  leaders, worm riding, Kwisatz Haderach, starred units, Hajr, Ghola,
  worthless bluffs. 18 test files; 150-game simulations checking rule
  invariants (forces, leaders and cards conserved) after every phase.
- **AI:** Basic AI (legal, simple); Strategic AI with threat assessment
  (deny the leader, close out a win), diplomacy with betrayal, and the
  battle brain (sampling over honest knowledge). Difficulty levels Easy,
  Normal and Hard, verified in order by tournament. Seeded head-to-head
  tournaments decide what becomes the default.
- **Human play:** decision panels for every choice, live rule checks,
  map taps fill forms, hidden information respected.
- **Presentation:** original generated map, zoom/pan, event cards (storm,
  spice, worm, battle, traitor, alliances), marching and gliding troops,
  live auctions with bids going round the table.
- **Look and feel:** "Arrakis at dusk", an original theme drawn from the
  book's world: basalt slabs with wind-cut corners, spice-orange light,
  textured sand, rock and stronghold stone, a bronze sector bezel, a
  churning storm, two moons and drifting spice.
- **App:** single-screen mobile layout, sheets, auto-save and resume,
  export/import, seeded replay (?seed=N), debug hook (?debug=1).

## Next, in priority order

1. **Bidding brain tuning** (first version built, not yet better; see AI_NOTES). Value cards by what they add to battle odds, plus
   denial value against the leader (AI plan step 4).
2. **Remaining ally advantages:** paying for an ally's bids and shipments,
   Emperor and Fremen revival help.
3. **Shipment and movement lookahead** (AI plan step 5), and faction
   playbooks (step 6).
5. **Karama and Truthtrance** cards; **Bene Gesserit advisors**.
6. **Tutorial and "why can't I?" help** for first games.

## Blocked on the physical board

- **Sector count** (docs/STORM_TODO.md): storm damage, First Player,
  storm-aware AI, Weather Control, Family Atomics, riders and storm.
- **Border check** (docs/MAP_CHECK.md): ten borders to confirm, including
  the likely Wind Pass / Wind Pass North swap.

## Later

- Expansion factions: Ixians, Tleilaxu, CHOAM, Richese.
- Sound, polish, faction presentation.
