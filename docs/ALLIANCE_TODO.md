# Alliances: status

## Built

- Nexus diplomacy in turn order: break an alliance, propose, accept or reject
  (js/turnEngine.js runNexusDiplomacy), for human and AI alike
- AI diplomacy (js/ai/diplomacy.js) for the Strategic AI; the Basic AI stays
  unaligned as the easier opponent
- Public record of betrayals, which lowers trust in future offers
- Alliance victory (4 strongholds held between the allies)
- Allies never battle each other, and may not move, ship or ride a worm
  into each other's territory (except the Polar Sink)
- Newly allied factions sharing a territory: the overlap penalty
- Shared advantages: Guild half-price shipping for its ally, Atreides
  Prescience in the ally's battles, Bene Gesserit Voice in the ally's
  battles, Harkonnen traitors usable against the ally's opponent, Fremen
  protecting the ally from worms

- Allies pledging spice toward each other's cards and shipments (each turn)
- The Emperor paying for up to 3 extra force revivals for the ally
- The Fremen's ally reviving 3 forces free each turn

## Still to build
- AI breaking alliances: allowed, but its threshold is cautious and it has
  not yet done so in simulation; revisit when tuning the Strategic AI
