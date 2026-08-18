# Dune Digital: Faction Reference (Verified Against Official Rulebooks)

Sources:
- Base rulebook: https://cdn.1j1ju.com/medias/37/57/71-dune-rulebook.pdf
- Ixians & Tleilaxu: https://cdn.1j1ju.com/medias/20/16/31-dune-ixians-tleilaxu-rulebook.pdf
- CHOAM & Richese: https://lelekan.com.ua/files/rules/2082/pravila-nastilnoyi-gri-dyuna-kooan-ta-richez-dune-choam-amp-amp-richese-dopovnennya-angl-anglijskoyu-movoyu.0.pdf

The GF9 links in the original brief are dead. These mirrors have the full text and match what GF9 published.

---

## BASE SIX

### Atreides
**Start:** 10 forces Arrakeen, 10 in reserve, 10 spice, free revival 2. Manages the Spice Deck and Treachery Deck physically.

**Basic abilities:**
- Bidding: sees every Treachery Card before anyone bids on it, and is the only faction allowed to keep written notes
- Movement: looks at the top card of the Spice Deck before anyone moves
- Battle: forces the opponent to reveal one of four Battle Plan elements before locking, chosen from leader, weapon, defense, or number dialed. Once you ask about weapon or defense and they say they aren't playing one, you can't then ask for a different element

**Advanced:** Kwisatz Haderach unlocks after losing 7 or more forces in battle across the game (tracked secretly). Once active, adds +2 strength to a leader or cheap hero in one territory per turn, can't be used alone, and a leader carrying it can't turn traitor. Only killed by a lasgun/shield explosion.

**Correction to earlier draft:** I'd flagged the KH threshold as unconfirmed. It's exactly 7 forces lost.

---

### Harkonnen
**Start:** 10 forces Carthag, 10 in reserve, 10 spice, free revival 2.

**Basic abilities:**
- Traitors: dealt 4 Traitor Cards at setup and keeps all 4 (every other faction keeps only 1 of their 4 and returns the rest)
- Treachery: dealt 2 cards at the start instead of 1, and gets a free extra card from the deck every time they buy one, up to a hand limit of 8 (versus everyone else's limit of 4)

**Advanced:** Captured Leaders. On winning a battle, either randomly take one loser leader and sink it to the tanks for 2 spice, or keep and use it once before returning it.

**Correction to earlier draft:** I had "keeps as many as rules permit," implying ambiguity. It's unambiguous: all 4, always. That's a much bigger traitor-probability edge than I'd credited it with.

---

### Emperor
**Start:** 20 forces, all in reserve, none on Dune at the start. 10 spice, free revival 1.

**Basic abilities:**
- Bidding: whenever any other faction pays spice for a Treachery Card, it goes to the Emperor instead of the Spice Bank. Emperor can't discount card prices

**Advanced:** Sardaukar (5 starred forces) fight at double strength against everyone except Fremen, where they're worth only 1. One Sardaukar revivable per turn.

**Correction to earlier draft:** I had Emperor starting with some board presence. They don't, all 20 forces start off-planet. That materially changes early strategy: Emperor has zero territorial footprint turn one and has to buy their way in like everyone else, the difference is they never run dry.

---

### Fremen
**Start:** 10 forces split across Sietch Tabr, False Wall South, False Wall West as the player chooses; 10 in reserve. 3 spice, free revival 3 (no paid revival available).

**Basic abilities:**
- Shipment: free shipment of any/all reserves onto the Great Flat or anywhere within two territories of it
- Movement: 2 territories per move instead of 1
- Shai-Hulud: forces in a territory where a worm appears aren't devoured; can ride the worm to any legal territory after the Nexus

**Special victory condition:** if no faction wins by the end of the last turn, and Fremen (or no one) occupies both Sietch Tabr and Habbanya Sietch, and none of Harkonnen, Atreides, or Emperor occupies Tuek's Sietch, Fremen and any allies win.

**Advanced:** storm losses halved (rounded up), Fremen control their own storm movement via a private card draw instead of the Battle Wheel, Fedaykin (3 starred forces) fight at double strength, forces don't need spice to count at full strength in battle.

**Correction to earlier draft:** the special victory trigger condition I'd flagged as unconfirmed is now precise, it's genuinely a three-part board-state check, not just "survive to the end." Worth building as an explicit function, not a vague heuristic.

---

### Spacing Guild
**Start:** 5 forces Tuek's Sietch, 15 in reserve. 5 spice, free revival 1.

**Basic abilities:**
- Payment for shipment: other factions pay Guild directly instead of the Spice Bank
- Half price on their own shipments, and 1 spice per 2 forces to ship back to reserves (confirmed exact rate via the official Q&A)

**Advanced:** three shipment types per turn (reserves-to-Dune, planet-to-planet, planet-back-to-reserves), and can take their shipment/movement action at any point in turn order rather than in sequence.

**Special victory condition:** if no faction has won by the end of the last turn, Guild automatically wins. Per the official Q&A: if Guild isn't in the game and no one's won, Fremen wins instead; if Fremen also isn't in play, whoever holds the most strongholds wins (all tied factions win together).

**Correction to earlier draft:** this is a genuinely simpler and stronger win condition than I described, it's not conditional on stalemate mechanics, it just triggers automatically. Good news for the AI weighting model, this is easy to score.

---

### Bene Gesserit
**Start:** 1 force in the Polar Sink, 19 in reserve. 5 spice, free revival 1.

**Basic abilities:**
- Prediction: secretly picks a faction and a turn number at setup. If that faction wins (even as your ally) on that exact turn, Bene Gesserit wins alone instead. Can't predict Spacing Guild or Fremen winning via their special conditions
- Spiritual Advisors: free shipment of 1 force into the Polar Sink whenever any other faction ships from off-planet
- Voice: commands an opponent to play or withhold a specific card category in their Battle Plan (a named weapon, a named defense, a worthless card, or a cheap hero)

**Advanced:** always collects CHOAM Charity regardless of spice held; any worthless card can be used as a Karama Card; advisors (non-combat, peacefully coexisting forces) versus fighters, with specific flip rules on shipment, intrusion, and declaring battle.

**Correction to earlier draft:** I had this roughly right, but the Prediction restriction (can't predict Guild or Fremen's special wins) is a real constraint the AI needs to know, it removes two of the ten possible predictions outright.

---

## EXPANSION: IXIANS & TLEILAXU

### Ixians
**Start:** 6 forces (3 Cyborg, 3 Suboid) in the Hidden Mobile Stronghold, rest in reserve. 10 spice, free revival 1 (Cyborg or Suboid).

**Basic abilities:**
- Bidding: before Treachery Cards are dealt, draws one extra card per faction in the game, keeps one, redistributes the rest
- Before every bidding round, draws one more card than the number up for auction, looks at all of them, buries one on the top or bottom of the deck

**Unique unit types:** Cyborgs count double in battle and move 2 territories; Suboids are half-strength and can absorb battle losses in place of Cyborgs.

**Hidden Mobile Stronghold:** placed after the first storm move, counts as a stronghold for victory, immune to storms and worms, can relocate up to 3 territories per turn (advanced) while collecting 2 spice per force when passing through spice.

**Not in my earlier data file:** the Mobile Stronghold is the single most distinctive mechanic in the whole expansion and needs its own data structure, it isn't a normal territory.

### Tleilaxu
**Start:** 20 forces, all in reserve. 5 spice, free revival 2.

**Basic abilities:**
- No Traitor Cards at setup. Instead draws 3 Face Dancers from the (post-selection) Traitor Deck
- When any other faction wins a battle, may reveal their leader as a Face Dancer: the win still stands, but the "traitor" leader goes to the tanks with no spice paid, and the loser's remaining forces are silently swapped for Tleilaxu forces

**Advanced:** no revival cap and half-price revival for themselves; other factions pay Tleilaxu directly for revival rather than the Spice Bank; can revive dead leaders of other factions as gholas up to a 5-leader roster.

**Not in my earlier data file:** Face Dancers are functionally traitors but revealed reactively after any battle resolves, not just battles the Tleilaxu are in. That's a materially different information model than the standard Traitor Card and needs its own trigger logic.

---

## EXPANSION: CHOAM & RICHESE

### CHOAM
**Start:** 20 forces, all in reserve. 2 spice, free revival 0.

**Basic abilities:**
- Charity: collects 2 spice per faction in the game, every turn, before anyone else claims Charity. If someone else claims Charity that turn, it's paid from CHOAM's own spice rather than the bank
- Treachery hand limit of 5, can discard duplicate cards for 3 spice each or Worthless cards for 2 spice, or spend Worthless cards for one-off special effects (movement bonus, blocking a Karama, blocking Free Revival, etc.)
- Revival: no free forces, but no cap either, at 1 spice per force

**Advanced:** Inflation token doubles or cancels Charity for one turn; the Auditor leader lets CHOAM peek at an opponent's hand after winning a battle unless bought off.

### Richese
**Start:** 20 forces, all in reserve. 5 spice, free revival 2.

**Basic abilities:**
- Owns a separate 10-card Richese Treachery cache. Each Bidding Round, one Richese card must be auctioned via a Once Around or Silent auction (Richese chooses), reducing the normal auction by one card
- No-Field tokens (values 0, 3, or 5) let Richese ship as if one force landed while secretly hiding the real number, revealed on demand or when forced by storm/worm/battle

**Fremen interaction:** Richese counts as a faction that blocks the Fremen special victory condition if occupying Tuek's Sietch, same as Harkonnen, Atreides, and Emperor.

**Not in my earlier data file:** No-Field tokens are a genuine hidden-information mechanic distinct from cards, they need to live in the state model as their own object with a revealed/unrevealed flag, not folded into forces.

---

## Implications for the engine

- `leaders.json` can now be populated for real. I deliberately left it empty last time; the rulebooks confirm leader counts (5 per base faction, 5 per expansion faction, plus CHOAM's Auditor as a 6th) but not individual fighting values, since those are printed only on the physical leader discs, not in rulebook text. That's the one piece still worth checking against a card list or BGG image scan before hardcoding.
- The victory engine needs explicit functions for Fremen's three-part check and Guild's "did the game reach the final turn with no winner" check, not generic stronghold counting.
- Tleilaxu's Face Dancer reveal needs to hook into every battle resolution in the game, not just Tleilaxu's own battles, same as Harkonnen's Traitor reveal but with a different trigger scope.
- Richese No-Field tokens and Ixian Suboid/Cyborg splits both need dedicated data shapes; folding them into the generic `forces` count will lose information the rules actually care about.
