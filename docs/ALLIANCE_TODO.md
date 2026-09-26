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

## Still to build

- Allies paying for each other's treachery card bids and shipments
- Emperor paying for up to 3 extra force revivals for the ally
- Fremen granting the ally 3 free force revivals
- AI breaking alliances: allowed, but its threshold is cautious and it has
  not yet done so in simulation; revisit when tuning the Strategic AI
