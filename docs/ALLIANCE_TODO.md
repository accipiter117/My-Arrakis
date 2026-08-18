# Alliance "Shared Advantages": Outstanding TODOs

The core alliance relationship (form, break, one-per-faction limit, the
post-formation same-territory rule, and victory sharing) is built in
`js/allianceEngine.js` and `js/victoryEngine.js`. What's NOT built yet is
the long list of faction-specific abilities the rulebook grants once
allied, each one lives inside a different phase engine and needs its own
hook rather than a single central one. Tracked here so they don't get
lost.

## Universal (any two allies)

- **Bidding**: allies may pay some or all of each other's Treachery Card
  cost, letting a faction effectively bid more spice than they hold alone.
  Needs a hook in `biddingEngine.js`'s `payForCard()`.
- **Movement**: allies may pay for each other's shipments. Needs a hook in
  `movementEngine.js`'s `executeShipment()`.

## Faction-specific

- **Atreides**: may force an ally's opponent to reveal one Battle Plan
  element on the ally's behalf (their core ability, extended to allies).
  Needs a hook in `battleEngine.js`.
- **Emperor**: may pay (directly to the bank) for up to 3 extra forces or
  spice-cost leader revival for an ally, on top of the ally's own normal
  revival. Needs a hook in `revivalEngine.js`.
- **Fremen**: may choose to protect (or not) allied forces from being
  devoured by a worm, and may grant an ally 3 free force revivals during
  Revival. Needs hooks in both `spiceEngine.js` (the devour logic) and
  `revivalEngine.js`.
- **Spacing Guild**: allies ship and cross-ship at the Guild's half-price
  rate rather than standard rate. Needs a hook in `movementEngine.js`'s
  `shipmentCostPerForce()`.
- **Bene Gesserit**: may Voice an ally's opponent, not just their own.
  Needs a hook in `battleEngine.js` wherever Voice itself gets implemented
  (Voice isn't built at all yet, separate from this alliance-specific list).
- **Harkonnen**: Traitor Cards they hold may be used against an ally's
  opponent, not just their own. Needs a hook in `battleEngine.js`'s
  traitor-check logic.

None of these are silently broken right now, they simply don't exist yet,
alliances function correctly without them, just without the extra
cross-faction assistance the rulebook allows. Worth picking off
individually as their underlying phase engines get revisited, rather than
building all seven in one pass.
