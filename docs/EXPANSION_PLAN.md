# My Arrakis: Expansion Build Plan
## Ixians & Tleilaxu, CHOAM & Richese

Handover document for the main My Arrakis build chat. It covers every faction ability, every new card, every variant and every engine change needed to add the first two GF9 house expansions to the app, with reference code, data, decision-provider signatures, AI defaults, UI notes, tests and acceptance criteria.

---

## 0. Read this first (instructions for the build chat)

1. **Rules are sourced, not remembered.** Every rule below comes from the official rulebooks. Where a card or leader value comes from a secondary source it is marked `VERIFY`. Keep the habit of flagging rules questions before assuming.
   - Ixians & Tleilaxu rulebook: https://cdn.1j1ju.com/medias/20/16/31-dune-ixians-tleilaxu-rulebook.pdf
   - CHOAM & Richese rulebook: https://lelekan.com.ua/files/rules/2082/pravila-nastilnoyi-gri-dyuna-kooan-ta-richez-dune-choam-amp-amp-richese-dopovnennya-angl-anglijskoyu-movoyu.0.pdf
   - Expansion overviews: https://futurepastimes.com/dune-ixians-tleilaxu and https://futurepastimes.com/dune-choam-richese
   - Leader values, card text and skill mechanics cross-checked against the open-source treachery.online engine: https://github.com/ronaldossendrijver/treachery.online (GPL; used as a reference for values and behaviour only, do not copy its code).
2. **The code here is reference-grade, written against the state shape visible in the repo** (`state.factions[id].forces.onBoard / starredOnBoard / reserve / starredReserve`, `revivalTanks / starredRevivalTanks`, `leaders.available / killed`, `state.spiceBank.totalInCirculation` used as the bank balance, `state.decks.treacheryDiscard`, `decisionProvider.chooseX(state, factionId, ...)`, `turnEngine.runOnePhaseLogic`). Anything not confirmed is marked `// ADAPT:`. Before writing each module, open the matching existing file and conform to its naming, module syntax (ESM vs CommonJS) and sync/async convention for decision providers.
3. **Keep the working method that already works:** one engine module per concern, pure functions taking `state`, decisions routed through the decision provider (human panel or AI), a `.sim.js` test per module, invariants extended in `tests/aiSimulation.sim.js`, full suite plus 150-game AI batch plus Playwright human game before every push.
4. **Advanced rules are always on in this app**, so every "Advanced Game Advantage" below is in scope, not optional.
5. **Build in the milestone order in section 3.** Each milestone is shippable and testable on its own; later ones depend on the foundations in M0.

---

## 1. Decisions needed before building (with recommended defaults)

| # | Question | Why it matters | Recommended default |
|---|----------|----------------|---------------------|
| D1 | The app removed Worthless cards as a house rule. CHOAM, Kull Wahad, Warmaster, Diplomat and the Tuek's Sietch stronghold card all depend on them. | Without them CHOAM loses a third of its identity. | Add `rules.worthlessCards`. Default `true` whenever CHOAM is seated, or Leader Skills or Stronghold Cards are on; otherwise keep the house rule (`false`). Kull Wahad follows the same flag. |
| D2 | Ten factions, six seats. | The menu currently assumes the six base factions. | New setup screen: pick 6 of 10 (checkbox grid, "Random six" button, human faction must be in the six). |
| D3 | Tech Tokens are an optional variant. | Adds a fourth and fifth route to stronghold count. | Toggle, default on when Ixians or Tleilaxu are seated. |
| D4 | Leader Skills and Stronghold Cards are optional variants usable with any factions. | Large surface area, touches every battle. | Toggles, default off until M7/M8 ship, then default on. |
| D5 | CHOAM cannot afford to pay another faction's charity. | Rulebook is silent. | CHOAM pays what it can, the Spice Bank pays the remainder. Log it. `VERIFY` with the person. |
| D6 | Bribes. Inflation (Double side) forbids bribes. | Only matters if bribes exist in the app. | If bribes are not implemented, record the flag on state and skip. |
| D7 | Cyborg revival cap. | Rulebook gives cost (3 spice) but no per-turn starred cap. | No starred cap for Cyborgs (they count toward the normal 3-force limit). `VERIFY`. |
| D8 | Hidden information for the human player. | Face Dancers, No-Field values, Black Market claims, Ixian bid-deck knowledge must be hidden from the human when AI holds them, and visible when the human holds them. | Extend the existing "behind the shield" filtering; never render these fields for non-owned factions. |

---

## 2. What each expansion adds (inventory)

### 2.1 Ixians & Tleilaxu (2020)
- Factions: Ixians, Tleilaxu (5 leaders each, 20 forces each; Ixians have Cyborg and Suboid forces plus the Hidden Mobile Stronghold token).
- 14 Treachery Cards (shuffle into deck).
- 1 Spice Card: Sandtrout.
- 11 Traitor Cards (10 new leaders plus a Cheap Hero traitor).
- Bene Gesserit Prediction cards for the two factions.
- Tech Tokens variant: Axlotl Tanks, Heighliners, Spice Production.

### 2.2 CHOAM & Richese (2021)
- Factions: CHOAM (5 leaders plus the Auditor in the advanced game, Inflation token), Richese (5 leaders, 3 No-Field tokens numbered 0, 3, 5, a separate 10-card Richese cache).
- 11 Traitor Cards (10 leaders plus the Auditor).
- 2 Prediction cards.
- 14 Leader Skill Cards (variant).
- 6 Advanced Stronghold Cards (variant).
- 2 Treachery Cards: new Poison Tooth and Artillery Strike, replacing the I&T versions.
- 2 Karama Cards replacing the base-game Karama cards (updated text).

---

## 3. Milestones (build order)

| Milestone | Scope | Depends on |
|-----------|-------|------------|
| M0 | Foundations: faction registry, rules config, 6-of-10 setup, force profiles, event hooks, spice helpers, card data model, hidden-info filter | nothing |
| M1 | 14 I&T Treachery Cards, Sandtrout, Cheap Hero traitor | M0 |
| M2 | Tleilaxu (Face Dancers, revival economy, Gholas, Zoal, alliance, Karama) | M0, M1 |
| M3 | Ixians (Cyborgs/Suboids, Hidden Mobile Stronghold, start-of-game draft, bidding advantage, Technology, alliance, Karama) | M0, M1 |
| M4 | Tech Tokens | M2, M3 |
| M5 | CHOAM (Charity, Inflation, Treachery hand/discards, Worthless effects, revival, Forces payment, Auditor, alliance, Karama) | M0, D1 |
| M6 | Richese (cache auction, Once Around and Silent auctions, No-Field, Black Market, alliance, Karama) | M0, M3 (bidding interplay) |
| M7 | Leader Skill Cards | M5, M6 |
| M8 | Advanced Stronghold Cards | M3 (HMS card) |
| M9 | Karama reference table, alliance matrix, Prediction and Traitor decks, faction guide text | all |
| M10 | Basic AI and Strategic AI support | per milestone, finished here |
| M11 | UI: factions, counters, panels, audio hooks, faction guide | per milestone, finished here |

Each milestone section ends with **Tests** and **Done when**.

---

## 4. M0 Foundations

### 4.1 Faction registry (data)

Add to `data/factions.json` (`ADAPT:` match existing key names such as `startingSpice`, `freeRevival`).

```json
{
  "ixians": {
    "name": "Ixians",
    "leaderName": "Prince Rhombur Vernius",
    "expansion": "ixTl",
    "startingSpice": 10,
    "freeRevival": 1,
    "handLimit": 4,
    "forces": { "ordinary": 13, "starred": 7, "ordinaryName": "Suboid", "starredName": "Cyborg" },
    "startingPlacement": { "hms": { "ordinary": 3, "starred": 3 } },
    "color": "#b0b079"
  },
  "tleilaxu": {
    "name": "Tleilaxu",
    "leaderName": "Masters Council",
    "expansion": "ixTl",
    "startingSpice": 5,
    "freeRevival": 2,
    "handLimit": 4,
    "forces": { "ordinary": 20, "starred": 0 },
    "startingPlacement": {},
    "color": "#602d8b"
  },
  "choam": {
    "name": "CHOAM",
    "leaderName": "Ur-Director Malina Aru",
    "expansion": "choamRichese",
    "startingSpice": 2,
    "freeRevival": 0,
    "handLimit": 5,
    "forces": { "ordinary": 20, "starred": 0 },
    "startingPlacement": {},
    "color": "#582d1b"
  },
  "richese": {
    "name": "Richese",
    "leaderName": "Count Ilban Richese",
    "expansion": "choamRichese",
    "startingSpice": 5,
    "freeRevival": 2,
    "handLimit": 4,
    "forces": { "ordinary": 20, "starred": 0 },
    "startingPlacement": {},
    "noFieldTokens": [0, 3, 5],
    "color": "#b3afa4"
  }
}
```

Colours are taken from treachery.online as placeholders; the custom counters brief (book-accurate) should override them.

### 4.2 Leaders (data)

Add to `data/leaders.json`. Values from treachery.online `LeaderManager.cs` and `DefaultSkin.cs`, `VERIFY` against the physical discs.

```json
[
  { "id": "ix_dominic_vernius",   "faction": "ixians",   "name": "Dominic Vernius",   "fightingValue": 4 },
  { "id": "ix_ctair_pilru",       "faction": "ixians",   "name": "C'Tair Pilru",      "fightingValue": 5 },
  { "id": "ix_tessia_vernius",    "faction": "ixians",   "name": "Tessia Vernius",    "fightingValue": 5 },
  { "id": "ix_kailea_vernius",    "faction": "ixians",   "name": "Kailea Vernius",    "fightingValue": 2 },
  { "id": "ix_cammar_pilru",      "faction": "ixians",   "name": "Cammar Pilru",      "fightingValue": 1 },

  { "id": "tl_zoal",              "faction": "tleilaxu", "name": "Zoal",              "fightingValue": null, "variableValue": true },
  { "id": "tl_hidar_fen_ajidica", "faction": "tleilaxu", "name": "Hidar Fen Ajidica", "fightingValue": 4 },
  { "id": "tl_master_zaaf",       "faction": "tleilaxu", "name": "Master Zaaf",       "fightingValue": 3 },
  { "id": "tl_wykk",              "faction": "tleilaxu", "name": "Wykk",              "fightingValue": 2 },
  { "id": "tl_blin",              "faction": "tleilaxu", "name": "Blin",              "fightingValue": 1 },

  { "id": "ch_viscount_tull",     "faction": "choam",    "name": "Viscount Tull",     "fightingValue": 2 },
  { "id": "ch_duke_verdun",       "faction": "choam",    "name": "Duke Verdun",       "fightingValue": 3 },
  { "id": "ch_rajiv_londine",     "faction": "choam",    "name": "Rajiv Londine",     "fightingValue": 3 },
  { "id": "ch_lady_jalma",        "faction": "choam",    "name": "Lady Jalma",        "fightingValue": 4 },
  { "id": "ch_frankos_aru",       "faction": "choam",    "name": "Frankos Aru",       "fightingValue": 4 },
  { "id": "ch_auditor",           "faction": "choam",    "name": "Auditor",           "fightingValue": 2, "auditor": true },

  { "id": "ri_talis_balt",        "faction": "richese",  "name": "Talis Balt",        "fightingValue": 2 },
  { "id": "ri_haloa_rund",        "faction": "richese",  "name": "Haloa Rund",        "fightingValue": 2 },
  { "id": "ri_flinto_kinnis",     "faction": "richese",  "name": "Flinto Kinnis",     "fightingValue": 3 },
  { "id": "ri_lady_helena",       "faction": "richese",  "name": "Lady Helena",       "fightingValue": 4 },
  { "id": "ri_premier_ein_calimar","faction": "richese", "name": "Premier Ein Calimar","fightingValue": 5 }
]
```

Rules attached to leaders:
- **Zoal** has no printed value. In battle and for death spice he takes the value of the opposing leader disc (0 against a Cheap Hero). He copies only the disc value, never a skill bonus or the Kwisatz Haderach.
- **Auditor** (CHOAM, advanced) is a sixth disc. Cannot be a Ghola, cannot be captured by Harkonnen, cannot hold a Leader Skill. May be revived as CHOAM's one leader revival per turn as if all CHOAM leaders were in the tanks (i.e. no "all five dead" requirement).

Traitor deck: one card per new leader (including the Auditor when CHOAM is seated) plus the **Cheap Hero traitor** from I&T. The existing traitor deck builder already filters leaders by seated faction; extend it to include `cheap_hero_traitor` whenever `rules.expansions.ixTlCards` is on.

### 4.3 Rules config and 6-of-10 setup

```js
// js/expansions/rulesConfig.js
// Single source of truth for which expansion content is live in a game.

const BASE_FACTIONS = ['atreides', 'harkonnen', 'emperor', 'fremen', 'guild', 'gesserit'];
const EXPANSION_FACTIONS = ['ixians', 'tleilaxu', 'choam', 'richese'];
const ALL_FACTIONS = [...BASE_FACTIONS, ...EXPANSION_FACTIONS];

function defaultRules(seated, overrides = {}) {
  const has = id => seated.includes(id);
  const rules = {
    advanced: true,                                  // app convention
    expansions: {
      ixTlCards: true,                               // 14 treachery, Sandtrout, cheap hero traitor
      choamRicheseCards: true                        // replacement Poison Tooth, Artillery Strike, Karama text
    },
    techTokens: has('ixians') || has('tleilaxu'),    // D3
    leaderSkills: false,                             // D4
    strongholdCards: false,                          // D4
    worthlessCards: has('choam'),                    // D1
    sandtrout: true
  };
  return deepMerge(rules, overrides);
  // Leader Skills or Stronghold Cards switched on forces worthlessCards on (Warmaster, Diplomat, Tuek's).
}

function finaliseRules(rules) {
  if (rules.leaderSkills || rules.strongholdCards) rules.worthlessCards = true;
  return rules;
}

function isSeated(state, factionId) { return Boolean(state.factions[factionId]); }

function validateSeating(seated, humanFaction) {
  if (seated.length !== 6) return { ok: false, reason: 'Choose exactly six factions.' };
  if (new Set(seated).size !== 6) return { ok: false, reason: 'A faction was chosen twice.' };
  if (seated.some(id => !ALL_FACTIONS.includes(id))) return { ok: false, reason: 'Unknown faction.' };
  if (humanFaction && !seated.includes(humanFaction)) return { ok: false, reason: 'Your faction must be one of the six.' };
  return { ok: true };
}

export { BASE_FACTIONS, EXPANSION_FACTIONS, ALL_FACTIONS, defaultRules, finaliseRules, isSeated, validateSeating };
```

`createInitialGameState(seated, seatOrder, rules)` stores `state.rules = finaliseRules(rules)`. Every expansion engine checks `isSeated` or `state.rules.x` at its entry point and returns early otherwise, so base games behave exactly as today (regression test in 4.9).

**Seat positions (player circles):** `determineFirstPlayer()` needs a rim sector for each seat. With 10 factions the seat is a property of the seat order, not the faction, so map seat index to rim sector (the physical board has six player circles). `ADAPT:` if the existing mapping is keyed by faction id, re-key it by seat index.

### 4.4 Spice helpers (one place for every transfer)

Several new rules redirect payments (Tleilaxu revival income, CHOAM charity and battle income, Richese auction income, Ixian and Richese interplay). Centralise transfers so the spice-conservation invariant stays trivially provable.

```js
// js/expansions/spice.js
// ADAPT: state.spiceBank.totalInCirculation is used by existing engines as the bank balance.

function bankBalance(state) { return state.spiceBank.totalInCirculation; }

function payToBank(state, factionId, amount, reason) {
  if (amount <= 0) return 0;
  const f = state.factions[factionId];
  if (f.spice < amount) throw new Error(`${factionId} cannot pay ${amount} (${reason})`);
  f.spice -= amount;
  state.spiceBank.totalInCirculation += amount;
  logSpice(state, { from: factionId, to: 'bank', amount, reason });
  return amount;
}

function takeFromBank(state, factionId, amount, reason) {
  if (amount <= 0) return 0;
  state.factions[factionId].spice += amount;
  state.spiceBank.totalInCirculation -= amount;
  logSpice(state, { from: 'bank', to: factionId, amount, reason });
  return amount;
}

function transfer(state, fromId, toId, amount, reason) {
  if (amount <= 0) return 0;
  const from = state.factions[fromId];
  if (from.spice < amount) throw new Error(`${fromId} cannot pay ${amount} to ${toId} (${reason})`);
  from.spice -= amount;
  state.factions[toId].spice += amount;
  logSpice(state, { from: fromId, to: toId, amount, reason });
  return amount;
}

// Route a payment that "normally goes to the bank" through any redirects
// (Emperor for bids, Tleilaxu for revival, CHOAM half-share for battle forces).
function payWithRedirects(state, payerId, amount, kind) {
  const redirects = state.paymentRedirects?.[kind] ?? [];
  for (const redirect of redirects) {
    const handled = redirect(state, payerId, amount);
    if (handled) return handled;
  }
  return { toBank: payToBank(state, payerId, amount, kind) };
}

function logSpice(state, entry) { (state.spiceLedger ??= []).push({ turn: state.turn, phase: state.phase, ...entry }); }

export { bankBalance, payToBank, takeFromBank, transfer, payWithRedirects };
```

`state.spiceLedger` doubles as a debugging aid in match exports; trim it to the current turn in the export if size is a concern.

### 4.5 Event hooks

Tech Tokens, CHOAM, the Spice Banker skill, the Bureaucrat skill and the Tleilaxu revival income all react to things other engines do. Rather than threading faction checks through every engine, the engines emit events and the expansion modules subscribe. `ADAPT:` if a hook or event system already exists, use it.

```js
// js/expansions/hooks.js
const handlers = {};

function on(eventName, handler) { (handlers[eventName] ??= []).push(handler); }

function emit(state, eventName, payload = {}) {
  const results = [];
  for (const handler of handlers[eventName] ?? []) {
    const r = handler(state, payload);
    if (r) results.push(r);
  }
  return results;
}

export { on, emit };
```

Events to emit from existing engines (add one line at each site):

| Event | Emitted from | Payload |
|-------|-------------|---------|
| `revival.free` | revivalEngine, when a faction uses any free revival | `{ factionId, forces }` |
| `revival.paid` | revivalEngine, on paid force or leader revival | `{ factionId, spicePaid, forces, leaderId }` |
| `ghola.played` | cardEffects, Tleilaxu Ghola card | `{ factionId }` |
| `shipment.offPlanet` | movementEngine, any shipment from reserves (not cross-planet, not to reserves) | `{ factionId, territoryId, forces, viaNoField, shippedByAllyRichese }` |
| `charity.claimed` | charity phase, when a faction receives CHOAM Charity (not CHOAM's own advantage) | `{ factionId, amount }` |
| `battle.planSpice` | battleEngine, when spice dialled for forces is paid | `{ factionId, amount, traitorRevealed }` |
| `battle.resolved` | battleEngine, after winner is known and before cards are discarded | `{ battle, winnerId, loserId }` |
| `bank.paid` | spice.payToBank | `{ factionId, amount, reason }` |
| `phase.end` | turnEngine, after each phase runner returns | `{ phase }` |
| `phase.start` | turnEngine, before each phase runner | `{ phase }` |

### 4.6 Force profiles (generalise starred units)

The app already tracks starred forces (Sardaukar, Fedaykin) through `starredOnBoard`, `starredReserve`, `starredRevivalTanks`. Ixians reuse the same slots: **Cyborg = starred, Suboid = ordinary**. What changes is that strength, movement, spice-carrying and revival cost now vary per faction and per type, so move the hard-coded "starred counts 2" into a profile table.

```js
// js/forceProfiles.js
// Strength values are for a force supported by spice (advanced rules).
// Unsupported forces count half, except where noted.

const PROFILES = {
  default:  { ordinary: { strength: 1, move: 1, carry: 2, reviveCost: 2, spiceBoost: true } },
  emperor:  { ordinary: { strength: 1, move: 1, carry: 2, reviveCost: 2, spiceBoost: true },
              starred:  { strength: 2, move: 1, carry: 2, reviveCost: 2, spiceBoost: true, vsFremenStrength: 1 } },
  fremen:   { ordinary: { strength: 1, move: 2, carry: 2, reviveCost: 2, noSpiceNeeded: true },
              starred:  { strength: 2, move: 2, carry: 2, reviveCost: 2, noSpiceNeeded: true } },
  ixians:   { ordinary: { strength: 0.5, move: 1, moveWithCyborg: 2, carry: 2, reviveCost: 2, spiceBoost: false, fixedStrength: true },
              starred:  { strength: 2, move: 2, carry: 3, reviveCost: 3, spiceBoost: true } }
};
// ADAPT: fold existing Emperor/Fremen special cases (Sardaukar vs Fremen, Fremen move 2,
// Fedaykin) into this table rather than keeping two sources of truth.

function profile(factionId, type) {
  const p = PROFILES[factionId] ?? PROFILES.default;
  return p[type] ?? p.ordinary;
}

// Maximum strength a faction can dial in a territory, given spice it will commit.
// Karama against Ixian Cyborgs (or Sardaukar/Fedaykin) sets starred strength to 1.
function maxDial(state, factionId, territoryId, { spiceAvailable, starredNerfed = false, opponentId }) {
  const f = state.factions[factionId];
  const total = f.forces.onBoard[territoryId] ?? 0;
  const starred = f.forces.starredOnBoard?.[territoryId] ?? 0;
  const ordinary = total - starred;

  const sp = profile(factionId, 'starred');
  const op = profile(factionId, 'ordinary');

  let starredValue = starredNerfed ? 1 : sp.strength;
  if (factionId === 'emperor' && opponentId === 'fremen' && sp.vsFremenStrength) starredValue = sp.vsFremenStrength;

  let strength = 0;
  let spiceLeft = spiceAvailable;

  // Spend spice where it buys the most strength: starred first.
  const boost = (count, value, prof) => {
    if (prof.noSpiceNeeded) return count * value;
    if (prof.fixedStrength) return count * value;                  // Suboids: always half, spice cannot raise
    const supported = Math.min(count, spiceLeft);
    spiceLeft -= supported;
    return supported * value + (count - supported) * value / 2;
  };
  strength += boost(starred, starredValue, sp);
  strength += boost(ordinary, op.strength, op);
  return strength;
}

export { PROFILES, profile, maxDial };
```

Battle plans must now accept **half-point dials** (Ixians only in practice; unsupported normal forces also produce halves under advanced rules, check the existing battle engine already handles `x.5`). The battle wheel UI needs a 0.5 step when the human is Ixian.

### 4.7 Card data model

Extend each treachery card entry with classification flags so battle resolution never switches on card names.

```json
{
  "id": "poison_blade",
  "name": "Poison Blade",
  "expansion": "ixTl",
  "category": "weapon",
  "flags": { "projectileWeapon": true, "poisonWeapon": true },
  "keepOnWin": true,
  "text": "Weapon, special. Counts as both projectile and poison. Keep if you win."
}
```

Flag vocabulary: `projectileWeapon`, `poisonWeapon`, `lasgun`, `special` (Poison Tooth, Artillery Strike, Stone Burner, Mirror Weapon), `projectileDefense`, `poisonDefense`, `worthless`, `cheapHero`, `karama`, `timing` (`battlePlan`, `anytime`, `spiceBlow`, `movement`, `bidding`, `phaseStart`), `keepOnWin`, `discardAfterUse`, `cache: "richese"`.

### 4.8 Hidden-information filter

Extend the existing shield filter (whatever builds the human's view) with:

```js
const PRIVATE_FIELDS = {
  tleilaxu: ['faceDancers'],              // unrevealed ones only
  richese:  ['noField.onPlanet.value', 'noField.lastUsed', 'blackMarket.actualCard'],
  ixians:   ['bidDeckKnowledge'],
  choam:    [],
  all:      ['hand', 'traitors', 'spice', 'leaderSkillBehindShield']
};
```

Public by rule: Tech Token ownership, which No-Field token was used last (face up in front of the shield), the Inflation token side, revealed Face Dancers, Leader Skill cards in front of the shield, Stronghold Cards held, number of cards in the Richese cache.

### 4.9 M0 tests and done when

- `tests/rulesConfig.sim.js`: seating validation; defaults per seating; `worthlessCards` forced on by variants.
- `tests/baseRegression.sim.js`: seat the six base factions with all expansion rules off and assert a seeded game produces the identical log to a recorded fixture from before M0. This is the guard that the expansions never alter base play.
- `tests/forceProfiles.sim.js`: `maxDial` for Emperor vs Fremen, Fremen, Ixians with mixed Cyborgs/Suboids and limited spice, Karama nerf.
- Invariants in `aiSimulation.sim.js`: total spice (bank plus all factions plus spice on board plus Tech Token pools) constant every phase; `spiceLedger` sums to zero net per phase.

**Done when:** a 6-of-10 setup screen exists, base-only games are byte-identical to before, and the suite passes.

---

## 5. M1 Ixians & Tleilaxu cards

### 5.1 The 14 Treachery Cards

Card text from treachery.online's card descriptions, cross-checked with the I&T rulebook Q&A. `VERIFY` wording against the printed cards; mechanics below are what to build.

| id | Name | Type | Effect to implement | After battle |
|----|------|------|---------------------|--------------|
| `poison_blade` | Poison Blade | Weapon, special | Counts as projectile AND poison. Only a defence that is both (Shield Snooper) stops it. A Shield alone does not (I&T Q&A). | Keep if you win |
| `hunter_seeker` | Hunter-Seeker | Weapon, projectile | Kills opponent's leader unless Shield. | Keep if you win |
| `basilia_weapon` | Basilia Weapon | Weapon, poison | Kills opponent's leader unless Snooper. | Keep if you win |
| `weirding_way` | Weirding Way | Weapon, special | Projectile weapon. If played in the DEFENCE slot together with another weapon, it acts as a projectile defence. | Keep if you win |
| `poison_tooth` | Poison Tooth | Weapon, special | Kills both leaders; not stopped by Snooper. After plans are revealed and results seen, owner may choose not to use it, then it does not need discarding if they win. Use the C&R version (replaces I&T version). | Discard if used; keep if withheld and you win |
| `shield_snooper` | Shield Snooper | Defence, special | Counts as Shield and Snooper. Also counts as a Shield for Lasgun explosions (`VERIFY`). | Keep if you win |
| `shield_extra` | Shield | Defence, projectile | Additional copy of Shield. | Keep if you win |
| `snooper_extra` | Snooper | Defence, poison | Additional copy of Snooper. | Keep if you win |
| `chemistry` | Chemistry | Defence, special | Poison defence. If played in the WEAPON slot together with another defence, it acts as a poison weapon. | Keep if you win |
| `artillery_strike` | Artillery Strike | Weapon, special | Kills both leaders; no spice paid for them. Either player's Shield protects their own leader. Surviving (shielded) leaders do not count toward the total; higher dial wins. Use the C&R version. | Discard after use |
| `harvester` | Harvester | Special | Play just after a Spice Blow card is revealed: double the spice placed. | Discard |
| `thumper` | Thumper | Special | Play at the start of the Spice Blow phase instead of revealing a card: resolve as though Shai-Hulud had been revealed. | Discard |
| `amal` | Amal | Special | At the beginning of any phase: every faction discards half the spice behind its shield, rounded up, to the Spice Bank. | Discard |
| `kull_wahad` | Kull Wahad | Worthless | Worthless card (only in deck when `rules.worthlessCards`). CHOAM special effect: stop a player playing Karama this phase as they try. | Discard |

Deck building:

```js
// js/decks/treacheryDeck.js (ADAPT: extend the existing deck builder)
function buildTreacheryDeck(state, allCards) {
  const r = state.rules;
  return allCards.filter(c => {
    if (c.cache === 'richese') return false;                         // Richese cache is never in the deck
    if (c.flags?.worthless && !r.worthlessCards) return false;       // D1
    if (c.expansion === 'ixTl' && !r.expansions.ixTlCards) return false;
    if (c.replacedBy && r.expansions.choamRicheseCards) return false; // I&T Poison Tooth / Artillery replaced by C&R versions
    if (c.expansion === 'choamRichese' && !r.expansions.choamRicheseCards) return false;
    return true;
  });
}
```

### 5.2 Leader-kill resolution with the new cards

Replace name-based checks in `battleEngine.js` with flag-based resolution. This single function handles base cards plus all new I&T and Richese weapons and defences.

```js
// js/battle/leaderResolution.js

function effectiveSlots(plan, opponentPlan, card) {
  const w = plan.weaponCardId ? card(plan.weaponCardId) : null;
  const d = plan.defenseCardId ? card(plan.defenseCardId) : null;
  let weapon = w ? { id: w.id, ...w.flags } : null;
  let defense = d ? { id: d.id, ...d.flags } : null;

  // Weirding Way in the defence slot with another weapon: projectile defence.
  if (d?.id === 'weirding_way' && w) defense = { id: d.id, projectileDefense: true };
  // Chemistry in the weapon slot with another defence: poison weapon.
  if (w?.id === 'chemistry' && d) weapon = { id: w.id, poisonWeapon: true };

  // Mirror Weapon becomes a copy of the opponent's (effective) weapon.
  if (w?.id === 'mirror_weapon') {
    const ow = opponentPlan.weaponCardId ? card(opponentPlan.weaponCardId) : null;
    weapon = ow ? { id: 'mirror_weapon', mirrored: ow.id, ...ow.flags } : null;
  }
  // Portable Snooper added after reveal (see Richese cards) is merged into defence.
  if (plan.portableSnooper) defense = { ...(defense ?? {}), poisonDefense: true };
  // Carthag stronghold card: any defence also counts as a poison defence.
  if (plan.carthagAdvantage && defense) defense.poisonDefense = true;

  return { weapon, defense };
}

function validateSlots(plan, card) {
  const w = plan.weaponCardId && card(plan.weaponCardId);
  const d = plan.defenseCardId && card(plan.defenseCardId);
  if (d?.id === 'weirding_way' && !w) return 'Weirding Way can only be played as a defence alongside another weapon.';
  if (w?.id === 'chemistry' && !d) return 'Chemistry can only be played as a weapon alongside another defence.';
  if (w && !(w.category === 'weapon' || w.id === 'chemistry' || w.flags?.worthless)) return `${w.name} is not a weapon.`;
  if (d && !(d.category === 'defense' || d.id === 'weirding_way' || d.flags?.worthless)) return `${d.name} is not a defence.`;
  return null;
}

// Does `attackerWeapon` kill the leader defended by `victimDefense`?
function weaponKills(attackerWeapon, victimDefense) {
  if (!attackerWeapon) return false;
  const pd = Boolean(victimDefense?.projectileDefense);
  const sd = Boolean(victimDefense?.poisonDefense);
  if (attackerWeapon.projectileWeapon && attackerWeapon.poisonWeapon) return !(pd && sd);   // Poison Blade
  if (attackerWeapon.projectileWeapon) return !pd;
  if (attackerWeapon.poisonWeapon) return !sd;
  return false;
}

function hasShield(slots) { return Boolean(slots.defense?.projectileDefense); }

// Returns which leaders die, whether leaders count, special outcomes.
function resolveLeaders(aggPlan, defPlan, card, choices = {}) {
  const A = effectiveSlots(aggPlan, defPlan, card);
  const D = effectiveSlots(defPlan, aggPlan, card);
  const out = { aggLeaderDies: false, defLeaderDies: false, noSpiceForKills: false,
                leadersCount: true, explosion: false, stoneBurner: null };

  // Lasgun plus any Shield anywhere in the battle: explosion (existing rule).
  const lasgun = A.weapon?.lasgun || D.weapon?.lasgun;
  if (lasgun && (hasShield(A) || hasShield(D))) { out.explosion = true; return out; }

  // Stone Burner: owner chooses after reveal (choices.stoneBurner = 'kill' | 'zero').
  for (const [side, slots] of [['agg', A], ['def', D]]) {
    if (slots.weapon?.id === 'stone_burner') {
      out.stoneBurner = { side, mode: choices.stoneBurner?.[side] ?? 'kill' };
    }
  }
  if (out.stoneBurner) {
    if (out.stoneBurner.mode === 'kill') { out.aggLeaderDies = true; out.defLeaderDies = true; }
    else out.leadersCount = false;
    return out;       // VERIFY Stone Burner interaction with other weapons played by the opponent
  }

  // Artillery Strike: kills both, shields protect own leader, surviving leaders do not count, no spice.
  if (A.weapon?.id === 'artillery_strike' || D.weapon?.id === 'artillery_strike') {
    out.aggLeaderDies = !hasShield(A);
    out.defLeaderDies = !hasShield(D);
    out.leadersCount = false;
    out.noSpiceForKills = true;
  }

  // Poison Tooth: kills both leaders, snoopers do not stop it, owner may withdraw after seeing results.
  for (const [side, slots] of [['agg', A], ['def', D]]) {
    if (slots.weapon?.id === 'poison_tooth' && choices.poisonToothUsed?.[side] !== false) {
      out.aggLeaderDies = true; out.defLeaderDies = true;
    }
  }

  // Ordinary weapons.
  if (weaponKills(A.weapon, D.defense)) out.defLeaderDies = true;
  if (weaponKills(D.weapon, A.defense)) out.aggLeaderDies = true;
  return out;
}

export { effectiveSlots, validateSlots, weaponKills, resolveLeaders };
```

**Poison Tooth withdrawal** is a decision after reveal: `decisionProvider.choosePoisonToothUse(state, factionId, preview)` where `preview` is the outcome with and without it. AI default: withdraw when using it would kill its own leader and the opponent's leader was already going to die or is worth less than its own.

**Card keep/discard after battle:** loser discards everything (existing). Winner may keep cards with `keepOnWin`; cards with `discardAfterUse` always go to discard (Artillery Strike, Mirror Weapon, Stone Burner, Portable Snooper, used Poison Tooth). A withheld Poison Tooth returns to hand if the owner won, discards if they lost.

### 5.3 Non-battle cards

```js
// js/cardEffects.js additions

// Harvester: window opens right after a Spice Blow card is revealed and before spice is placed.
function canPlayHarvester(state, factionId) {
  return state.phase === 'spiceBlow' && state.pendingSpiceBlow && hasCard(state, factionId, 'harvester');
}
function playHarvester(state, factionId) {
  discardFromHand(state, factionId, 'harvester');
  state.pendingSpiceBlow.amount *= 2;            // spiceEngine places pendingSpiceBlow.amount
}

// Thumper: at the start of Spice Blow, instead of revealing a card.
function canPlayThumper(state, factionId) {
  return state.phase === 'spiceBlow' && !state.spiceBlowRevealedThisPhase && hasCard(state, factionId, 'thumper');
}
function playThumper(state, factionId) {
  discardFromHand(state, factionId, 'thumper');
  state.forcedShaiHulud = true;                  // spiceEngine: resolve as if Shai-Hulud was drawn (worm devours in the last spice territory, Nexus follows)
}

// Amal: at the beginning of any phase.
function playAmal(state, factionId) {
  discardFromHand(state, factionId, 'amal');
  for (const [id, f] of Object.entries(state.factions)) {
    const loss = Math.ceil(f.spice / 2);
    payToBank(state, id, loss, 'Amal');
  }
}
```

Timing windows the engine must offer (the app already has an "anytime" window for Truthtrance, Ghola and Karama, reuse it):
- `phaseStart` window at the start of every phase: Amal, Juice of Sapho (go first), CHOAM worthless effects, Richese Karama buy.
- `spiceBlowStart`: Thumper.
- `spiceBlowRevealed`: Harvester.
- AI defaults: Harvester when the blow lands in a territory it occupies or can reach this turn; Thumper when a worm would hit a stack of an opponent near victory in the current spice territory; Amal when its own spice is at most a third of the richest opponent's and a key auction or revival is coming.

### 5.4 Sandtrout (spice card)

Rulebook Q&A: Sandtrout is an anti-Nexus. When drawn, all existing alliances are cancelled. The next Shai-Hulud drawn does not cause a Nexus; draw its replacement immediately. If the replacement is another Shai-Hulud, a normal Nexus happens. If the replacement is a Spice Blow, its spice is doubled.

```js
// spiceEngine.js additions
function onSpiceCardDrawn(state, cardDrawn) {
  if (cardDrawn.id === 'sandtrout') {
    breakAllAlliances(state, 'Sandtrout');               // ADAPT: existing alliance engine
    state.sandtroutPending = true;
    return { drawAgain: true };                           // Sandtrout itself places nothing
  }
  if (cardDrawn.type === 'shaiHulud' && state.sandtroutPending) {
    resolveWorm(state, cardDrawn, { nexus: false });     // worm still devours
    state.sandtroutPending = 'awaitReplacement';
    return { drawAgain: true };
  }
  if (state.sandtroutPending === 'awaitReplacement') {
    state.sandtroutPending = false;
    if (cardDrawn.type === 'shaiHulud') return { nexus: true };
    if (cardDrawn.type === 'spiceBlow') return { spiceMultiplier: 2 };
  }
  return {};
}
```

Rule interaction to check with the existing worm code: Fremen may still ride the worm, and Fremen ally protection still applies, only the Nexus is suppressed. `VERIFY` which spice territory the suppressed worm devours in (use the existing "last revealed territory in this discard pile" rule).

### 5.5 Cheap Hero traitor

A traitor card that matches any Cheap Hero played by an opponent of the holder, reusable against different players. Once revealed it stays in the holder's traitor area face up (public).

```js
function traitorMatches(traitorCard, opponentPlan) {
  if (traitorCard.id === 'cheap_hero_traitor') return Boolean(opponentPlan.cheapHeroCardId);
  return traitorCard.leaderId === opponentPlan.leaderId;
}
```

Harkonnen keeps all 4 dealt traitors as today, so they can draw it. Tleilaxu Face Dancers can be the Cheap Hero traitor only if drawn as a Face Dancer, and Face Dancers need a leader, so treat a Cheap Hero Face Dancer as never revealable (`VERIFY`).

### 5.6 Tests and done when

- `tests/leaderResolution.sim.js`: a truth table covering every weapon against every defence, including Poison Blade vs Shield (dies), vs Shield Snooper (lives); Weirding Way as defence with and without a weapon; Chemistry as weapon with and without a defence; Artillery with one shield; Poison Tooth used and withheld; Mirror Weapon copying Lasgun with a Shield present (explosion); Stone Burner both modes.
- `tests/spiceCards.sim.js`: Sandtrout breaks alliances, suppresses the next Nexus, doubles a following blow.
- Invariant: every treachery card is in exactly one of deck, discard, a hand, the Richese cache, or `removedFromGame`.

**Done when:** the new cards appear in games, AI plays them legally, 150-game batch runs clean.

---

## 6. M2 Tleilaxu

### 6.1 Rules summary (from the rulebook)

- **Start:** 20 forces in reserves, 5 spice, free revival 2. No presence on Arrakis.
- **Face Dancers:** not dealt traitors. After every other faction has chosen traitors and unused cards are returned, shuffle the traitor deck and take the top 3: these are Face Dancers.
- **Revealing:** when ANOTHER faction wins a battle, if its leader matches one of your Face Dancers you may reveal it. Order: traitor declared, then winner declared, then Face Dancer declared.
  1. The battle still counts as a win for them (they keep or discard cards, killed leaders go to the tanks, they collect spice for killed leaders, they claim a Tech Token if applicable).
  2. The Face Dancer leader goes to the tanks if not already killed; no spice is collected for it.
  3. Their remaining forces in the territory return to their reserves and are replaced, up to that total, by your forces from reserves and/or anywhere on the planet.
- **Advanced: Face Dancer cycling.** Revealed Face Dancers are not replaced until all three are revealed; then all three go back into the traitor deck, shuffle, draw three new. During the Mentat Pause you may discard ONE unrevealed Face Dancer, shuffle it into the traitor deck and draw a replacement.
- **Advanced: Revival.**
  - Tleilaxu revival: no revival limits; pay the Spice Bank half price (rounded up).
  - Other factions' revival payments go to the Tleilaxu (not the bank).
  - You may increase any other faction's 3-force revival limit to 5.
  - For each faction using free revival or a Ghola card, you take 1 spice from the bank.
  - Leader revival: when a faction requests one of its leaders in the tanks, you may set a price; if met, revive that leader (face up or face down), only while fewer than five of that faction's leaders are in the tanks.
- **Advanced: Zoal** (see 4.2).
- **Alliance:** you may revive your ally's forces and leaders at half price (rounded up).
- **Advanced: Gholas.** With fewer than five leaders alive, you may revive dead leaders of other factions at your discounted rate and add them to your pool, up to 5 active leaders. Q&A: the owning faction may ask to buy the leader back; you may refuse. If you return it you may revive a different one.
- **Special Karama power:** prevent a player from performing a revival (forces and/or leader).
- **Karama against Tleilaxu:** cannot replace a Face Dancer in the Mentat Pause (other Face Dancer effects cannot be stopped); revival becomes limited to 3 forces, full price, no payment for free revival, payments go to the bank, no early leader revival; cannot revive another player's leader this turn (Gholas).

### 6.2 State

```js
state.factions.tleilaxu.faceDancers = [
  // { cardId: 'traitor_ix_dominic_vernius', leaderId: 'ix_dominic_vernius', revealed: false }
];
state.factions.tleilaxu.gholas = [];            // leaderIds of other factions currently in Tleilaxu pool
state.revivalLimitOverrides = {};               // { factionId: 5 } for this turn, cleared at end of revival
state.leaderRevivalOffers = [];                 // pending price negotiations this revival phase
```

### 6.3 Setup: Face Dancer dealing

```js
// traitorDeckEngine.js addition, runs after all traitor selections
function dealFaceDancers(state, rng) {
  if (!isSeated(state, 'tleilaxu')) return;
  shuffleInPlace(state.decks.traitor, rng);                 // ADAPT: existing shuffle convention
  const dancers = state.decks.traitor.splice(0, 3);
  state.factions.tleilaxu.faceDancers = dancers.map(c => ({ cardId: c.id, leaderId: c.leaderId ?? null, revealed: false }));
}
```

Setup order change: Tleilaxu is skipped during the "deal 4, keep 1" traitor step (`ADAPT:` the existing loop), then `dealFaceDancers` runs.

### 6.4 Battle: Face Dancer reveal

Call after traitor resolution and winner determination, before loss-taking finishes, from `battleEngine.resolveBattle`.

```js
// js/factions/tleilaxu.js

async function offerFaceDancer(state, battle, decisionProvider) {
  if (!isSeated(state, 'tleilaxu')) return null;
  const { winnerId, winnerPlan, territoryId } = battle;
  if (!winnerId || winnerId === 'tleilaxu') return null;
  if (!winnerPlan.leaderId) return null;                                 // Cheap Hero cannot be a Face Dancer

  const tl = state.factions.tleilaxu;
  const match = tl.faceDancers.find(fd => !fd.revealed && fd.leaderId === winnerPlan.leaderId);
  if (!match) return null;

  const reveal = await decisionProvider.chooseRevealFaceDancer(state, 'tleilaxu', {
    battleId: battle.id, territoryId, leaderId: winnerPlan.leaderId, winnerId,
    forcesThere: countForces(state, winnerId, territoryId)
  });
  if (!reveal) return null;

  match.revealed = true;

  // 2. Face Dancer leader to the tanks, no spice for it.
  if (!battle.killedLeaderIds.includes(winnerPlan.leaderId)) {
    moveLeaderToTanks(state, winnerId, winnerPlan.leaderId, { spiceForKill: false });   // ADAPT: killLeader variant with no payout
  }

  // 3. Replace winner's remaining forces with Tleilaxu forces.
  const remaining = countForces(state, winnerId, territoryId);           // { total, starred }
  sendForcesToReserves(state, winnerId, territoryId, remaining.total, remaining.starred);

  const sources = await decisionProvider.chooseFaceDancerReplacementSources(state, 'tleilaxu', {
    territoryId, max: remaining.total,
    reserve: tl.forces.reserve,
    onBoard: { ...tl.forces.onBoard }
  });
  // sources: { reserve: n, fromTerritories: { territoryId: n } }, total <= remaining.total
  let placed = 0;
  const take = Math.min(sources.reserve ?? 0, tl.forces.reserve, remaining.total - placed);
  if (take > 0) { tl.forces.reserve -= take; addForces(state, 'tleilaxu', territoryId, take); placed += take; }
  for (const [from, n] of Object.entries(sources.fromTerritories ?? {})) {
    const k = Math.min(n, tl.forces.onBoard[from] ?? 0, remaining.total - placed);
    if (k > 0) { moveForcesRaw(state, 'tleilaxu', from, territoryId, k); placed += k; }   // not a movement, ignores range and storm
  }

  // All three revealed: recycle.
  if (tl.faceDancers.every(fd => fd.revealed)) recycleFaceDancers(state);

  emit(state, 'faceDancer.revealed', { battleId: battle.id, leaderId: winnerPlan.leaderId, placed });
  return { revealed: true, placed };
}

function recycleFaceDancers(state) {
  const tl = state.factions.tleilaxu;
  for (const fd of tl.faceDancers) state.decks.traitor.push(traitorCardById(fd.cardId));
  shuffleInPlace(state.decks.traitor, state.rng);
  tl.faceDancers = state.decks.traitor.splice(0, 3).map(c => ({ cardId: c.id, leaderId: c.leaderId ?? null, revealed: false }));
}

// Mentat Pause: optionally replace one unrevealed Face Dancer.
async function mentatPauseFaceDancerSwap(state, decisionProvider) {
  if (!isSeated(state, 'tleilaxu') || karamaBlocks(state, 'tleilaxu', 'faceDancerSwap')) return;
  const tl = state.factions.tleilaxu;
  const unrevealed = tl.faceDancers.filter(fd => !fd.revealed);
  if (!unrevealed.length) return;
  const cardId = await decisionProvider.chooseFaceDancerToReplace(state, 'tleilaxu', unrevealed.map(fd => fd.cardId));
  if (!cardId) return;
  const idx = tl.faceDancers.findIndex(fd => fd.cardId === cardId);
  state.decks.traitor.push(traitorCardById(cardId));
  shuffleInPlace(state.decks.traitor, state.rng);
  const c = state.decks.traitor.shift();
  tl.faceDancers[idx] = { cardId: c.id, leaderId: c.leaderId ?? null, revealed: false };
}
```

Edge cases to test:
- Kwisatz Haderach accompanying the leader does not protect against a Face Dancer (Q&A: yes it can be a Face Dancer). Only traitor immunity is granted by the KH, keep that separate.
- Harkonnen winning with a captured leader: the traitor card identity is the leader, so a matching Face Dancer can be revealed (`VERIFY`).
- Stronghold two-faction limit: the winner's forces leave, Tleilaxu forces arrive, so the count of factions does not rise. BG advisors that were co-existing remain.
- Tech Token claim by the winner resolves BEFORE the Face Dancer (step 1).
- Force-conservation invariant must count the reserve round trip.

### 6.5 Revival economy

Modify `revivalEngine.js`. The cleanest approach is a per-faction "revival terms" function the engine consults.

```js
// js/factions/tleilaxu.js

function revivalTerms(state, factionId) {
  const tleilaxuSeated = isSeated(state, 'tleilaxu');
  const karamaOnTleilaxu = karamaBlocks(state, 'tleilaxu', 'revival');
  const base = {
    forceCap: 3,
    starredCap: 1,
    costPerForce: 2,
    payee: 'bank',                 // 'bank' | 'tleilaxu'
    halfPriceRoundedUp: false
  };

  if (factionId === 'choam' && !karamaBlocks(state, 'choam', 'revival')) {
    Object.assign(base, { forceCap: Infinity, costPerForce: 1 });     // CHOAM advantage (section 9)
  }

  if (!tleilaxuSeated || karamaOnTleilaxu) return base;

  if (factionId === 'tleilaxu') {
    return { ...base, forceCap: Infinity, starredCap: Infinity, payee: 'bank', halfPriceRoundedUp: true };
  }

  const terms = { ...base, payee: 'tleilaxu' };
  if (state.revivalLimitOverrides?.[factionId]) terms.forceCap = Math.max(terms.forceCap, state.revivalLimitOverrides[factionId]);   // never lowers CHOAM's unlimited cap
  if (areAllied(state, factionId, 'tleilaxu')) terms.halfPriceRoundedUp = true;      // alliance advantage
  return terms;
}

function priceFor(terms, paidForces, starredPaid, factionId) {
  const perForce = n => n * terms.costPerForce;
  let cost = perForce(paidForces - starredPaid) + starredPaid * starredReviveCost(factionId, terms);
  if (terms.halfPriceRoundedUp) cost = Math.ceil(cost / 2);
  return cost;
}

function starredReviveCost(factionId, terms) {
  return factionId === 'ixians' ? 3 : terms.costPerForce;          // Cyborgs cost 3 each
}
```

`canReviveForces` changes: use `terms.forceCap` instead of `FORCE_REVIVAL_CAP_PER_TURN`, `terms.starredCap` instead of `STARRED_REVIVAL_CAP_PER_TURN`, `priceFor` for cost, and route payment to `terms.payee` via `transfer` or `payToBank`.

Tleilaxu income hooks:

```js
on('revival.free', (state, { factionId }) => {
  if (!isSeated(state, 'tleilaxu') || karamaBlocks(state, 'tleilaxu', 'revival')) return;
  if (factionId === 'tleilaxu') return;                           // "for each faction using free revival": exclude self (VERIFY)
  takeFromBank(state, 'tleilaxu', 1, `${factionId} free revival`);
});
on('ghola.played', (state, { factionId }) => {
  if (!isSeated(state, 'tleilaxu') || karamaBlocks(state, 'tleilaxu', 'revival')) return;
  takeFromBank(state, 'tleilaxu', 1, `${factionId} played Tleilaxu Ghola`);
});
```

Revival limit increase: at the start of each faction's revival turn, if Tleilaxu is seated and not blocked, ask Tleilaxu.

```js
async function offerRevivalLimitIncrease(state, factionId, decisionProvider) {
  if (factionId === 'tleilaxu' || !isSeated(state, 'tleilaxu') || karamaBlocks(state, 'tleilaxu', 'revival')) return;
  const tanks = state.factions[factionId].revivalTanks ?? 0;
  if (tanks <= 3) return;
  const yes = await decisionProvider.chooseIncreaseRevivalLimit(state, 'tleilaxu', { factionId, tanks });
  if (yes) state.revivalLimitOverrides[factionId] = 5;
}
```

AI default for `chooseIncreaseRevivalLimit`: yes if the faction can afford at least 4 paid revivals (more income) and is not within one stronghold of winning; always yes for an ally.

Early leader revival negotiation:

```js
async function requestEarlyLeaderRevival(state, factionId, leaderId, decisionProvider) {
  if (!isSeated(state, 'tleilaxu') || karamaBlocks(state, 'tleilaxu', 'revival')) return { ok: false };
  const f = state.factions[factionId];
  if (f.leaders.killed.length >= 5) return { ok: false, reason: 'Normal revival rules apply when all five are in the tanks.' };
  const price = await decisionProvider.chooseLeaderRevivalPrice(state, 'tleilaxu', { factionId, leaderId });
  if (price == null) return { ok: false, reason: 'The Tleilaxu refused.' };
  const accept = await decisionProvider.chooseAcceptLeaderRevivalPrice(state, factionId, { leaderId, price });
  if (!accept || f.spice < price) return { ok: false };
  transfer(state, factionId, 'tleilaxu', price, `early revival of ${leaderId}`);
  reviveLeaderRaw(state, factionId, leaderId);          // counts as that faction's one leader revival this turn (VERIFY)
  return { ok: true, price };
}
```

AI price default: `leaderValue + 2`, or `leaderValue + 4` if the requester is the current leader in stronghold count; refuse outright when the requester is one stronghold from winning. AI accept default: accept if price is at most `leaderValue + 3` and it leaves at least 3 spice for shipping.

### 6.6 Gholas

```js
function canReviveGhola(state, leaderId) {
  if (!isSeated(state, 'tleilaxu') || karamaBlocks(state, 'tleilaxu', 'gholas')) return { ok: false };
  const tl = state.factions.tleilaxu;
  const alive = tl.leaders.available.length + tl.gholas.length;     // ADAPT: include captured-by-Harkonnen? they are not "alive for Tleilaxu"
  if (alive >= 5) return { ok: false, reason: 'You already have five active leaders.' };
  const owner = ownerOfLeader(leaderId);
  if (owner === 'tleilaxu') return { ok: false, reason: 'Use normal revival for your own leaders.' };
  if (leaderId === 'ch_auditor') return { ok: false, reason: 'The Auditor cannot be a Ghola.' };
  if (!state.factions[owner]?.leaders.killed.includes(leaderId)) return { ok: false, reason: 'That leader is not in the tanks.' };
  const cost = Math.ceil(leaderValue(leaderId) / 2);
  if (tl.spice < cost) return { ok: false, reason: 'Not enough spice.' };
  return { ok: true, cost };
}

function reviveGhola(state, leaderId) {
  const check = canReviveGhola(state, leaderId);
  if (!check.ok) throw new Error(check.reason);
  const owner = ownerOfLeader(leaderId);
  payToBank(state, 'tleilaxu', check.cost, `Ghola ${leaderId}`);
  removeFrom(state.factions[owner].leaders.killed, leaderId);
  state.factions.tleilaxu.gholas.push(leaderId);
  state.factions.tleilaxu.leadersRevivedThisTurn = (state.factions.tleilaxu.leadersRevivedThisTurn ?? 0) + 1;
}
```

Ghola rules for other engines:
- A Ghola fights for the Tleilaxu with its disc value. If killed, it goes to its ORIGINAL owner's tanks (`VERIFY`), and the Tleilaxu opponent collects its value as usual.
- A traitor card for that leader held by anyone still works against the Tleilaxu when it is used. A Face Dancer for it is irrelevant (Tleilaxu own it).
- Buy-back: at any time outside a battle the owner may offer spice; Tleilaxu decide. `decisionProvider.chooseSellGhola(state, 'tleilaxu', { leaderId, offer })`.
- Leader Skills are never drawn for a Ghola (C&R Q&A).

### 6.7 Zoal

```js
function leaderBattleValue(state, leaderId, opponentPlan) {
  if (leaderId === 'tl_zoal') {
    if (opponentPlan.cheapHeroCardId) return 0;
    return opponentPlan.leaderId ? leaderValue(opponentPlan.leaderId) : 0;     // disc only, no skill, no KH
  }
  return leaderValue(leaderId);                                                // plus skill bonus applied elsewhere
}
// Death payout: same value as in the battle where he died.
```

Traitors: Zoal can still be a traitor card; revealing it wins the battle as usual.

### 6.8 Karama

- Tleilaxu special Karama: `chooseKaramaRevivalPrevention(state, 'tleilaxu', targetFactionId)` at the start of the target's revival. Blocks both forces and leader, including free revival (`VERIFY`: does it also block a Ghola card? Default no, Ghola is a card effect).
- Karama against Tleilaxu: set `state.karamaEffects.push({ against: 'tleilaxu', blocks: ['revival', 'faceDancerSwap', 'gholas'], expires: 'endOfTurn' })`. `karamaBlocks(state, faction, key)` reads this list.

### 6.9 Decision provider additions (Tleilaxu)

| Method | Returns | Basic AI default |
|--------|---------|------------------|
| `chooseRevealFaceDancer(state, 'tleilaxu', ctx)` | boolean | Reveal if `ctx.forcesThere >= 2`, or the territory is a stronghold, or it gives Tleilaxu a third stronghold |
| `chooseFaceDancerReplacementSources(state, 'tleilaxu', ctx)` | `{ reserve, fromTerritories }` | Reserves first, then from non-stronghold territories with no spice, never strip a stronghold below 1 |
| `chooseFaceDancerToReplace(state, 'tleilaxu', cardIds)` | cardId or null | Replace a dancer whose leader is dead or whose faction has not fought in 2 turns |
| `chooseIncreaseRevivalLimit` | boolean | See 6.5 |
| `chooseLeaderRevivalPrice` / `chooseAcceptLeaderRevivalPrice` | number or null / boolean | See 6.5 |
| `chooseGholaRevival(state, 'tleilaxu', options)` | leaderId or null | Highest-value leader when fewer than 4 active leaders and spice after cost is at least 4 |
| `chooseSellGhola` | boolean | Sell if offer is at least leader value plus 3 and Tleilaxu still has 3 active leaders |

### 6.10 Tests and done when

- `tests/tleilaxu.sim.js`: Face Dancer dealing count and no Tleilaxu traitors; reveal replacement from reserves and board; no reveal on Cheap Hero; recycle after three; Mentat swap; Karama blocks swap.
- Revival: Tleilaxu own half price no cap; other factions pay Tleilaxu; limit override to 5; free-revival income; alliance half price; Karama restores base terms.
- Gholas: cap at 5, Auditor refused, killed Ghola returns to owner's tanks.
- Zoal value vs leader, vs Cheap Hero, death payout.
- Invariants: Tleilaxu has exactly 3 Face Dancers at all times; no leader is both in a pool and in the tanks.

**Done when:** Tleilaxu can be played by the human and AI through a full game with no invariant failures, and the faction guide explains each ability.

---

## 7. M3 Ixians

### 7.1 Rules summary (from the rulebook)

- **Start:** 10 spice. 6 forces (3 Cyborgs, 3 Suboids) in the Hidden Mobile Stronghold; the rest (4 Cyborgs, 10 Suboids) in reserves. Free revival 1 force, Suboid or Cyborg.
- **Start of game:** before Treachery Cards are dealt, draw one card per faction in the game, keep one, shuffle the rest and deal one to each other faction (Harkonnen still take their extra card from the top of the deck).
- **Bidding:** before bidding begins, draw one more Treachery Card than the number up for bid and look at them all. Put one of your choice face down on the top or bottom of the deck. Shuffle the rest and place them face down as this round's auction cards.
- **Advanced: Technology.** Once per bidding round, before bidding begins on a card and before Atreides looks at it, you may take the card about to be bid on and replace it with one from your hand.
- **Advanced: Cyborgs (7).** Worth 2 normal forces in battle, move 2 territories, carry 3 spice, ship normally, cost 3 spice each to revive.
- **Advanced: Suboids (13).** Ship normally, worth ½ in battle (use the half marks on the wheel), cannot be boosted with spice, move 2 if accompanied by at least one Cyborg or 1 otherwise, count normally for controlling strongholds and collecting spice. After losses are calculated, surviving Suboids in that territory can be exchanged for Cyborgs lost in that battle.
- **Hidden Mobile Stronghold (HMS).** After the first storm movement at the start of the game, point it at a sector of any non-stronghold territory. It counts towards winning and is protected from worms and storm. Each turn, before the storm is dialled or revealed, as long as your forces occupy it, you may move it up to 3 territories to a non-stronghold territory. Moving into, from or through a sector containing spice lets you immediately collect 2 spice per force in the HMS. Nobody else may ship directly into it or move it if they take control; they ship or move into the territory it points at (including the Polar Sink) and use one movement to enter. It cannot move into, out of or through storm (Q&A).
- **Alliance:** after an ally buys a Treachery Card during bidding, they may immediately discard it and draw the top card of the deck (not for a Richese cache card; yes for a Black Market card, C&R Q&A).
- **Special Karama power:** move the HMS 2 territories on your turn during Shipment and Movement, as well as making your normal move.
- **Karama against Ixians:** Bidding (no peek and remove); Cyborg and Suboid movement limited to 1; Cyborgs count as 1 normal force in battle; Suboids cannot replace lost Cyborgs; HMS may not move or collect spice; Technology blocked.

### 7.2 State

```js
state.hms = {
  territoryId: null,        // host territory the HMS points at
  sector: null,             // sector pointed at, for storm and spice-sector checks
  placed: false
};
// Ixian forces in the HMS use the pseudo-territory id 'hms':
// state.factions.ixians.forces.onBoard.hms, .starredOnBoard.hms
// Other factions that enter the HMS also use 'hms'.
state.factions.ixians.bidDeckKnowledge = null;   // { cardIds: [...], buriedCardId, buriedWhere } private to Ixians
state.factions.ixians.technologyUsedThisRound = false;
```

Treat `'hms'` as a real stronghold territory in `data/territories.json` with `"stronghold": true, "dynamic": true, "immuneToStorm": true, "immuneToWorms": true, "noSpiceBlow": true`, and compute its adjacency at runtime.

### 7.3 Map integration

```js
// movementEngine.js adjacency wrapper
function neighbours(state, territoryId) {
  const base = baseNeighbours(territoryId);                                    // ADAPT: existing border data
  if (!isSeated(state, 'ixians') || !state.hms.placed) return base;
  if (territoryId === 'hms') return [state.hms.territoryId];
  if (territoryId === state.hms.territoryId) return [...base, 'hms'];
  return base;
}

function isStronghold(state, territoryId) {
  return territoryId === 'hms' ? Boolean(state.hms.placed) : Boolean(TERRITORIES[territoryId]?.stronghold);
}

// Shipment destination rule
function canShipTo(state, factionId, territoryId) {
  if (territoryId === 'hms') {
    if (factionId !== 'ixians') return { ok: false, reason: 'Only the Ixians may ship directly into the Hidden Mobile Stronghold.' };
    // Allies of Ixians do not gain this (VERIFY); BG spiritual advisor may accompany an Ixian shipment (Q&A).
  }
  return existingCanShipTo(state, factionId, territoryId);                       // ADAPT
}
```

The HMS is two-faction-limited like any stronghold. Its shipment cost is the stronghold rate (1 per force). Storm never destroys forces inside it. Leaving the HMS lands in the host territory, so if the host sector is in storm, leaving is blocked under the normal storm movement rules (`VERIFY` whether Fremen storm movement applies).

Victory counting:

```js
function strongholdCount(state, factionId) {
  let n = 0;
  for (const t of allStrongholdIds(state)) {             // includes 'hms' when placed
    if (occupiesForVictory(state, factionId, t)) n += 1; // ADAPT: existing check, BG advisors excluded
  }
  if (state.rules.techTokens && ownsAllTechTokens(state, factionId)) n += 1;
  return n;
}
```

### 7.4 Setup changes

```js
// setupEngine.js order with Ixians seated
// 1. Positions, BG prediction (existing)
// 2. Treachery: Ixian draft (below) replaces the normal 1-card deal
// 3. (Leader Skills if on, section 11)
// 4. Traitors (existing) then Face Dancers (6.3)
// 5. Starting forces: Ixian 3+3 go to 'hms' even though the HMS is not yet pointed anywhere
// 6. First storm movement (existing)
// 7. HMS placement (below), then Tech Token assignment (section 8)

async function ixianStartingDraft(state, decisionProvider) {
  const factionIds = seatOrder(state);
  const drawn = state.decks.treachery.splice(0, factionIds.length);
  const keep = await decisionProvider.chooseIxianStartingCard(state, 'ixians', drawn.map(c => c.id));
  const kept = drawn.find(c => c.id === keep) ?? drawn[0];
  addToHand(state, 'ixians', kept.id);
  const rest = drawn.filter(c => c !== kept);
  shuffleInPlace(rest, state.rng);
  for (const id of factionIds.filter(f => f !== 'ixians')) addToHand(state, id, rest.shift().id);
  // Harkonnen extra card from the top of the deck happens afterwards as usual.
}

async function placeHmsInitially(state, decisionProvider) {
  const options = legalHmsSites(state);                       // every non-stronghold territory not in storm
  const choice = await decisionProvider.chooseHmsPlacement(state, 'ixians', options);
  Object.assign(state.hms, { territoryId: choice.territoryId, sector: choice.sector, placed: true });
}

function legalHmsSites(state) {
  return Object.values(TERRITORIES)
    .filter(t => !t.stronghold && t.id !== 'hms')
    .flatMap(t => t.sectors.filter(s => s !== state.storm.sector).map(sector => ({ territoryId: t.id, sector })));
  // Polar Sink is a legal site (rulebook explicitly mentions it).
}
```

AI default for `chooseIxianStartingCard`: prefer Karama, then a Lasgun, then a Shield Snooper, then any defence, then any weapon. For `chooseHmsPlacement`: adjacent to the territory holding the most spice on the board, otherwise Polar Sink (reaches everywhere).

### 7.5 HMS movement (start of Storm phase)

Follow treachery.online's step-by-step model: up to 3 single-territory steps, collecting up to 2 spice per Ixian force in the HMS from the location it leaves and each location it arrives at. `VERIFY` against a ruling if a stricter reading ("collect once per move") is preferred; it is a one-line change.

```js
// js/factions/ixians.js

async function hmsMovement(state, decisionProvider, { steps = 3, collect = true, reason = 'storm' } = {}) {
  if (!isSeated(state, 'ixians') || !state.hms.placed) return;
  if (karamaBlocks(state, 'ixians', 'hms')) return;
  const ix = state.factions.ixians;
  const inside = ix.forces.onBoard.hms ?? 0;
  if (inside === 0) return;                                     // must occupy it

  const rate = inside * 2;
  let movesLeft = steps;
  if (collect) collectSpiceAt(state, 'ixians', state.hms.territoryId, rate);

  while (movesLeft > 0) {
    const options = neighbours(state, state.hms.territoryId)
      .filter(t => t !== 'hms' && !isStronghold(state, t) && !territoryFullyInStorm(state, t));
    const pick = await decisionProvider.chooseHmsStep(state, 'ixians', { options, movesLeft });
    if (!pick) break;
    state.hms.territoryId = pick.territoryId;
    state.hms.sector = pick.sector ?? firstSectorNotInStorm(state, pick.territoryId);
    if (collect) collectSpiceAt(state, 'ixians', state.hms.territoryId, rate);
    movesLeft -= 1;
  }
  emit(state, 'hms.moved', { to: state.hms.territoryId, reason });
}

function collectSpiceAt(state, factionId, territoryId, max) {
  const onBoard = state.board.spice?.[territoryId] ?? 0;          // ADAPT: spice-on-board storage
  const take = Math.min(onBoard, max);
  if (take > 0) {
    state.board.spice[territoryId] -= take;
    state.factions[factionId].spice += take;                      // spice on board to faction, bank untouched
  }
  return take;
}
```

Call site: `runStormPhase` begins with `await ixians.hmsMovement(state, decisionProvider)` from turn 2 onward (turn 1 is setup placement). Karama special: during Shipment and Movement on the Ixian turn, `hmsMovement(state, dp, { steps: 2, reason: 'karama' })` before or after their normal move.

AI default for `chooseHmsStep`: greedy toward the nearest territory with spice on board if it can be reached this turn, otherwise toward the territory adjacent to the most strongholds (better landing for its reserves), stop early once spice is collected.

### 7.6 Movement and spice carry

```js
function moveRangeForGroup(state, factionId, fromId, ordinaryMoving, starredMoving) {
  let base = existingMoveRange(state, factionId);               // 1, or 3 with ornithopters (Arrakeen/Carthag)
  if (factionId !== 'ixians') return base;
  if (karamaBlocks(state, 'ixians', 'movement')) return 1;
  const cyborgRange = Math.max(base, 2);
  if (starredMoving > 0) return cyborgRange;                    // Suboids move with a Cyborg escort at the Cyborg range
  return base;                                                  // Suboids alone
}

function spiceCarryRate(state, factionId, territoryId) {
  const base = existingCarryRate(state, factionId);             // 2, or 3 with ornithopters
  if (factionId !== 'ixians') return { ordinary: base, starred: base };
  return { ordinary: base, starred: Math.max(3, base) };
}
```

Spice collection for Ixians sums per force type: `ordinaryCount * rate.ordinary + cyborgCount * rate.starred`, capped by spice in the territory. HMS forces never collect in the normal collection phase (no spice there).

### 7.7 Battle: strength and Suboid substitution

Dial capacity uses `maxDial` from 4.6. Losses:

```js
// Winner must lose forces whose total strength equals the dial.
// Ixian strength per force: Cyborg 2 (1 if Karama), Suboid 0.5.
function ixianLossOptions(state, territoryId, dial, { cyborgValue = 2 } = {}) {
  const ix = state.factions.ixians;
  const cy = ix.forces.starredOnBoard[territoryId] ?? 0;
  const total = ix.forces.onBoard[territoryId] ?? 0;
  const sub = total - cy;
  const options = [];
  for (let c = 0; c <= cy; c += 1) {
    const remaining = dial - c * cyborgValue;
    if (remaining < 0) break;
    const s = remaining / 0.5;
    if (Number.isInteger(s) && s <= sub) options.push({ cyborgs: c, suboids: s });
  }
  return options;   // at least one option exists because dial <= maxDial
}

// After losses: exchange surviving Suboids for lost Cyborgs, one for one.
function suboidSubstitution(state, territoryId, cyborgsLost, requested) {
  if (karamaBlocks(state, 'ixians', 'suboidSubstitution')) return 0;
  const ix = state.factions.ixians;
  const survivingSuboids = (ix.forces.onBoard[territoryId] ?? 0) - (ix.forces.starredOnBoard[territoryId] ?? 0);
  const n = Math.min(requested, cyborgsLost, survivingSuboids);
  // n Suboids go from the territory to the tanks and n lost Cyborgs come back from the tanks.
  // Totals in the territory and in the tanks are unchanged; only the starred split moves.
  ix.forces.starredOnBoard[territoryId] = (ix.forces.starredOnBoard[territoryId] ?? 0) + n;
  ix.starredRevivalTanks -= n;
  return n;
}
```

Worked check from the rulebook: 2 Cyborgs and 6 Suboids dial 6. Loss option `{ cyborgs: 2, suboids: 4 }`; 2 Suboids survive; substitution of 2 leaves the territory with 2 Cyborgs and 0 Suboids, tanks with 6 Suboids. Put this exact case in the test.

**Karama on Cyborgs mid-battle:** if a dial exceeds the new maximum after Karama, reduce the dial to the new maximum (rulebook Q&A); losses then use `cyborgValue = 1`.

**Suboids and spice:** the battle panel must not let the human commit spice to Suboids; when Ixian, the spice slider maximum is the Cyborg count.

### 7.8 Bidding advantage and Technology

```js
// biddingEngine.js, at the start of the bidding round
async function ixianBiddingSetup(state, decisionProvider, normalCardCount) {
  if (!isSeated(state, 'ixians') || karamaBlocks(state, 'ixians', 'bidding')) {
    return drawAuctionCards(state, normalCardCount);            // ADAPT: existing
  }
  const drawn = state.decks.treachery.splice(0, normalCardCount + 1);    // reshuffle discard if short (ADAPT)
  const { buryCardId, where } = await decisionProvider.chooseIxianBury(state, 'ixians', drawn.map(c => c.id));
  const buried = drawn.find(c => c.id === buryCardId) ?? drawn[0];
  const auction = drawn.filter(c => c !== buried);
  if (where === 'top') state.decks.treachery.unshift(buried); else state.decks.treachery.push(buried);
  shuffleInPlace(auction, state.rng);
  state.factions.ixians.bidDeckKnowledge = { cardIds: auction.map(c => c.id), buriedCardId: buried.id, where };
  return auction;
}
```

`normalCardCount` is the usual count (factions able to bid) minus one for each Richese card auctioned this round (cache card and a sold Black Market card), per the C&R Q&A.

Technology:

```js
// Called before each card's auction begins, before Atreides prescience.
async function offerTechnology(state, decisionProvider, cardAboutToBeBid) {
  const ix = state.factions.ixians;
  if (!isSeated(state, 'ixians') || ix.technologyUsedThisRound || karamaBlocks(state, 'ixians', 'technology')) return cardAboutToBeBid;
  if (!ix.hand.length) return cardAboutToBeBid;                       // ADAPT: hand field name
  const swapId = await decisionProvider.chooseTechnologySwap(state, 'ixians', { handCardIds: [...ix.hand] });
  if (!swapId) return cardAboutToBeBid;
  removeFromHand(state, 'ixians', swapId);
  addToHand(state, 'ixians', cardAboutToBeBid.id);
  ix.technologyUsedThisRound = true;
  return cardById(swapId);
}
```

Technology does not apply to Richese cache or Black Market auctions (it names "the Treachery Card about to be bid on" from the normal round, `VERIFY`).

Ixian alliance hook:

```js
on('bid.won', async (state, { factionId, cardId, source }, decisionProvider) => {
  if (!areAllied(state, factionId, 'ixians')) return;
  if (source === 'richeseCache') return;                                 // Q&A: not for Richese cache cards
  const redo = await decisionProvider.chooseIxianAllyRedraw(state, factionId, { cardId });
  if (!redo) return;
  discardFromHand(state, factionId, cardId);
  addToHand(state, factionId, drawTreachery(state).id);
});
```

(If the hooks module is synchronous, call this from the bidding engine directly after a sale instead.)

AI defaults:
- `chooseIxianBury`: bury the strongest card it cannot afford this round at the bottom; if it can afford the best card, bury the card most useful to the richest opponent (Karama against the Emperor, Lasgun against the leader in strongholds) at the bottom; put a card it wants next round on top.
- `chooseTechnologySwap`: swap in its weakest card (worthless if present) when the card about to be bid on is in its top-3 priority list.
- `chooseIxianAllyRedraw`: redraw if the bought card is worthless or a duplicate of a card the ally already holds.

### 7.9 Revival

Free revival 1 (either type). Cyborg paid revival costs 3; Suboid 2. The starred-per-turn cap does not apply to Cyborgs (D7). The existing `canReviveForces` gains a `starredCostPerForce` from the faction profile.

### 7.10 Tests and done when

- `tests/ixians.sim.js`: starting draft deals exactly one to each faction; bidding draws N+1 and buries one; Technology once per round; Karama blocks bidding advantage.
- HMS: initial placement legal; moves up to 3, never into a stronghold or storm; spice collection rate; others cannot ship into it; others can enter from the host territory; storm and worm leave HMS forces untouched; counts in `strongholdCount`.
- Battle: `maxDial` with Suboids; loss options; the rulebook substitution example; Karama dial reduction example (4 Suboids and 2 Cyborgs dialled 5.5 reduced to 4).
- Movement: Suboids 1 alone, 2 with a Cyborg; Karama limits to 1.
- Invariants: HMS forces counted in force conservation; `state.hms.territoryId` is never a stronghold; at most two factions inside the HMS after the battle phase.

**Done when:** the Ixians play full games as human and AI, the HMS renders on the board and moves with an animation, and the battle wheel supports half steps.

---

## 8. M4 Tech Tokens (variant)

### 8.1 Rules summary (from the I&T rulebook)

- Three tokens: **Axlotl Tanks** (Revival), **Heighliners** (Shipment and Movement), **Spice Production** (CHOAM Charity). Kept in front of the shield, public.
- **Assignment:** by default Tleilaxu take Axlotl Tanks, Ixians take Heighliners, Fremen take Spice Production. Any token whose default owner is absent is assigned randomly, after the first storm movement, to factions without a token in turn order (storm order from the First Player).
- **Income:** each token you control can pay you from the Spice Bank; the spice is placed on the token when triggered and collected at the end of the phase. Per trigger you collect **1 spice per Tech Token you control**, at most once per phase per token.
  - Axlotl Tanks: if at least one player, including you, takes free revival. Not if only the Tleilaxu take free revival.
  - Heighliners: if at least one player, including you, ships forces from off-planet. Not if only the Guild ships. A No-Field shipment counts, unless Richese uses it to ship the Guild as an ally (C&R Q&A).
  - Spice Production: if at least one player, including you, takes CHOAM Charity. Not if only the Bene Gesserit take it. CHOAM's own Charity advantage does not trigger it, and Inflation does not change the amount (C&R Q&A).
- **Transfer:** if you defeat a faction in battle and it has a Tech Token, you take one (your choice if it has more than one). Allies cannot share control.
- **Victory:** controlling all three counts as one stronghold.

### 8.2 State and code

```js
state.techTokens = {
  axlotl:     { owner: null, pool: 0, triggeredBy: new Set() },
  heighliner: { owner: null, pool: 0, triggeredBy: new Set() },
  spiceProd:  { owner: null, pool: 0, triggeredBy: new Set() }
};
// Serialise Sets as arrays for match exports.

const TOKEN_PHASE = { axlotl: 'revival', heighliner: 'shipment', spiceProd: 'charity' };
const TOKEN_EXCLUDED = { axlotl: 'tleilaxu', heighliner: 'guild', spiceProd: 'gesserit' };
const DEFAULT_OWNER = { axlotl: 'tleilaxu', heighliner: 'ixians', spiceProd: 'fremen' };

function assignTechTokens(state) {
  if (!state.rules.techTokens) return;
  const unassigned = [];
  for (const [token, owner] of Object.entries(DEFAULT_OWNER)) {
    if (isSeated(state, owner)) state.techTokens[token].owner = owner;
    else unassigned.push(token);
  }
  shuffleInPlace(unassigned, state.rng);
  const holders = new Set(Object.values(state.techTokens).map(t => t.owner).filter(Boolean));
  for (const factionId of stormOrder(state)) {              // after first storm move
    if (!unassigned.length) break;
    if (holders.has(factionId)) continue;
    state.techTokens[unassigned.shift()].owner = factionId;
    holders.add(factionId);
  }
}

function tokensOwnedBy(state, factionId) {
  return Object.entries(state.techTokens).filter(([, t]) => t.owner === factionId).map(([k]) => k);
}

function ownsAllTechTokens(state, factionId) {
  return Object.values(state.techTokens).every(t => t.owner === factionId);
}

function recordTrigger(state, token, factionId) {
  if (!state.rules.techTokens) return;
  state.techTokens[token].triggeredBy.add(factionId);
}

on('revival.free',       (s, p) => recordTrigger(s, 'axlotl', p.factionId));
on('shipment.offPlanet', (s, p) => { if (!(p.viaNoField && p.shippedByAllyRichese && p.factionId === 'guild')) recordTrigger(s, 'heighliner', p.factionId); });
on('charity.claimed',    (s, p) => recordTrigger(s, 'spiceProd', p.factionId));

on('phase.end', (state, { phase }) => {
  if (!state.rules.techTokens) return;
  for (const [token, t] of Object.entries(state.techTokens)) {
    if (TOKEN_PHASE[token] !== phase) continue;
    const triggers = [...t.triggeredBy];
    t.triggeredBy.clear();
    if (!t.owner || !triggers.length) continue;
    if (triggers.every(f => f === TOKEN_EXCLUDED[token])) continue;
    if (karamaBlocks(state, t.owner, 'techToken')) continue;      // no Karama entry exists in the rulebook; keep hook but never set (VERIFY)
    const amount = tokensOwnedBy(state, t.owner).length;
    takeFromBank(state, t.owner, amount, `${token} tech token`);  // pool shown in UI during the phase
  }
});

// Battle transfer, after winner is known (before a Face Dancer reveal).
async function claimTechToken(state, winnerId, loserId, decisionProvider) {
  if (!state.rules.techTokens) return;
  const owned = tokensOwnedBy(state, loserId);
  if (!owned.length) return;
  const pick = owned.length === 1 ? owned[0] : await decisionProvider.chooseTechTokenToTake(state, winnerId, owned);
  state.techTokens[pick].owner = winnerId;
}
```

Phase naming: the app runs Shipment and Movement as one combined runner under `'shipment'`, so `TOKEN_PHASE.heighliner = 'shipment'` fires once at the end of that combined runner. Keep it that way if the runner is ever split.

Note on the pool: the rule "place spice on the token, collect at end of phase" is visual. Implement `pool` as a display value (set when first triggered, cleared at phase end) and do the bank transfer at phase end, so spice conservation holds throughout.

Shipment note: "ships forces from off-planet" means from reserves to the planet. Guild cross-planet shipping and shipping back to reserves do not trigger. Fremen worm arrivals are not shipments (`VERIFY`, default: do not trigger).

AI default for `chooseTechTokenToTake`: the token that would complete a set for itself; else the one whose phase is next; else Heighliners (most frequently triggered).

### 8.3 Tests and done when

- `tests/techTokens.sim.js`: default assignment; random assignment for missing owners in storm order; each trigger and each exclusion; income scales with number of tokens owned; once per phase; transfer on battle loss; three tokens count as a stronghold; allies cannot combine.
- Invariant: exactly three tokens, each with at most one owner.

**Done when:** tokens show on the Factions sheet and the victory watch strip counts them.

---

## 9. M5 CHOAM

### 9.1 Rules summary (from the C&R rulebook)

- **Start:** 20 forces in reserves, 2 spice, free revival 0. Leaders fairly weak; strategy is to stockpile cards and strike late.
- **Charity:** each turn during CHOAM Charity, before any other faction collects, CHOAM collects 2 spice per faction in the game. If another faction collects CHOAM Charity, it is paid to them from CHOAM's spice.
- **Treachery:** hand limit 5. At the end of any phase CHOAM may reveal duplicates of the same card (identical cards only; Portable Snooper is not a Snooper, Shield Snooper is not a Snooper) and discard the surplus for 3 spice each. CHOAM may also discard Worthless cards for 2 spice each, or instead for a special effect:
  - **Baliset:** prevent a player moving forces into a territory CHOAM occupies during Shipment and Movement (they may still ship in).
  - **Jubba Cloak:** prevent the loss of CHOAM forces in one territory to the storm when it moves.
  - **Kull Wahad:** prevent a player from playing a Karama card this phase as they attempt to do so.
  - **Kulon:** move CHOAM forces one extra territory on their Shipment and Movement turn.
  - **La La La:** prevent a player taking free revival during Revival.
  - **Trip to Gamont:** send any 1 force belonging to another player to that player's reserves during the Mentat Pause. (Q&A: on a No-Field token, the token is revealed and one Richese force returns; if none, the card is still used.)
- **Revival:** no free revival, but no limit on forces revived, 1 spice each.
- **Inflation (advanced):** during the Mentat Pause CHOAM may place the Inflation token on the CHOAM Charity step with Double or Cancel face up. In the next turn CHOAM Charity (including CHOAM's own collection, and the Bene Gesserit's advanced charity) is doubled or cancelled. In the next Mentat Pause flip it; if it has already been flipped, remove it from the game. No bribes while Double is face up.
- **Forces (advanced):** when other players pay spice for their forces in battle, half of it (rounded down) goes to CHOAM. CHOAM's own payment goes to the bank. Nothing goes to CHOAM if a traitor is revealed.
- **Auditor (advanced):** see 4.2. When the Auditor is CHOAM's leader in battle and survives, CHOAM audits the opponent by looking at 2 random cards in their hand (not counting cards used in that battle), or 1 card if the Auditor was killed. The opponent may pay CHOAM 1 spice per card CHOAM would see to cancel the whole audit (no partial payments; with only 1 card in hand, 1 spice cancels).
- **Alliance:** once per game turn, at the end of any phase, trade one Treachery Card with the ally (both give and receive). CHOAM may pay for some or all of the ally's forces in battle.
- **Special Karama power:** discard any Treachery Cards (even Worthless) from hand at any time and gain 3 spice each.
- **Karama against CHOAM:** Charity (no collection except normal charity, others collect from the bank); Treachery (no discarding for spice, no Worthless effect that phase); Revival (limit 3, or 5 if Tleilaxu allow, 2 spice each); Inflation (cannot place it this Mentat Pause, flipping next turn is unaffected); Forces (no battle-spice income for one battle); Auditor (no audit).

### 9.2 State

```js
state.factions.choam.inflation = { status: 'unused' | 'double' | 'cancel' | 'removed', flipped: false };
state.factions.choam.allyTradeUsedThisTurn = false;
state.worthlessEffects = {                       // active this phase or turn
  baliset: [],        // [{ targetFactionId, territoryId }] expires end of Shipment and Movement
  jubbaCloak: null,   // territoryId protected at next storm move
  kullWahad: [],      // factionIds blocked from Karama this phase
  kulon: false,       // CHOAM +1 movement this turn
  laLaLa: [],         // factionIds blocked from free revival this turn
  tripToGamont: null  // { targetFactionId, territoryId } resolved in Mentat Pause
};
```

### 9.3 Charity phase

```js
// charity phase runner (ADAPT: runCharityPhase)
function runCharityWithChoam(state) {
  const choamSeated = isSeated(state, 'choam');
  const inflation = choamSeated ? state.factions.choam.inflation.status : 'unused';
  if (inflation === 'cancel') { log(state, 'Inflation: CHOAM Charity cancelled this turn.'); return []; }
  const multiplier = inflation === 'double' ? 2 : 1;

  // 1. CHOAM's own collection comes first.
  if (choamSeated && !karamaBlocks(state, 'choam', 'charity')) {
    takeFromBank(state, 'choam', 2 * Object.keys(state.factions).length * multiplier, 'CHOAM Charity advantage');
    // Does not trigger the Spice Production tech token (C&R Q&A), so no charity.claimed event here.
  }

  // 2. Everyone else (including CHOAM if it is eligible for normal charity, VERIFY).
  const results = [];
  for (const id of stormOrder(state)) {
    const due = charityDue(state, id) * multiplier;             // ADAPT: existing (0 or 1 spice -> up to 2; BG advanced always 2)
    if (due <= 0) continue;
    const payer = choamSeated && id !== 'choam' && !karamaBlocks(state, 'choam', 'charity') ? 'choam' : 'bank';
    if (payer === 'choam') {
      const fromChoam = Math.min(due, state.factions.choam.spice);
      transfer(state, 'choam', id, fromChoam, 'CHOAM Charity');
      if (due > fromChoam) takeFromBank(state, id, due - fromChoam, 'CHOAM Charity shortfall (D5)');
    } else {
      takeFromBank(state, id, due, 'CHOAM Charity');
    }
    emit(state, 'charity.claimed', { factionId: id, amount: due });
    results.push({ factionId: id, amount: due });
  }
  return results;
}
```

This is also the place to re-check the earlier bug where Charity paid only once per game; keep that regression test.

### 9.4 Inflation (Mentat Pause)

```js
async function mentatPauseInflation(state, decisionProvider) {
  if (!isSeated(state, 'choam')) return;
  const inf = state.factions.choam.inflation;
  if (inf.status === 'double' || inf.status === 'cancel') {
    if (inf.flipped) { inf.status = 'removed'; return; }
    inf.status = inf.status === 'double' ? 'cancel' : 'double';
    inf.flipped = true;
    return;
  }
  if (inf.status !== 'unused' || karamaBlocks(state, 'choam', 'inflation')) return;
  const side = await decisionProvider.chooseInflation(state, 'choam');       // 'double' | 'cancel' | null
  if (side) inf.status = side;
}
```

AI default: Double is almost always the right opening side, because CHOAM's own collection (2 per faction) dwarfs what it pays out, and the automatic flip to Cancel next turn then hurts factions that rely on charity. Play Double on the first Mentat Pause where CHOAM holds fewer than 8 spice and no opponent is within one stronghold of winning. Play Cancel first instead only when two or more opponents are at 0 to 1 spice and a key auction is due.

### 9.5 Treachery discards and Worthless effects

```js
// End-of-phase window (called from the phase.end hook, and from the anytime window for Worthless effects)
async function choamEndOfPhaseDiscards(state, decisionProvider) {
  if (!isSeated(state, 'choam') || karamaBlocks(state, 'choam', 'treachery')) return;
  const hand = state.factions.choam.hand;
  const counts = countBy(hand, id => cardById(id).name);          // identical cards share a name
  const duplicates = Object.entries(counts).filter(([, n]) => n > 1);
  const worthless = hand.filter(id => cardById(id).flags?.worthless);
  if (!duplicates.length && !worthless.length) return;

  const plan = await decisionProvider.chooseChoamDiscards(state, 'choam', { duplicates, worthless });
  // plan: { duplicateDiscards: [cardId...], worthlessForSpice: [cardId...] }
  for (const id of plan.duplicateDiscards ?? []) {
    revealDuplicate(state, 'choam', id);                          // public reveal of the pair
    discardFromHand(state, 'choam', id);
    takeFromBank(state, 'choam', 3, 'duplicate discard');
  }
  for (const id of plan.worthlessForSpice ?? []) {
    discardFromHand(state, 'choam', id);
    takeFromBank(state, 'choam', 2, 'worthless discard');
  }
}

const WORTHLESS_EFFECTS = {
  baliset:        { window: 'shipmentMovement', apply: (s, a) => s.worthlessEffects.baliset.push(a) },       // a: { targetFactionId, territoryId }
  jubba_cloak:    { window: 'stormBeforeMove', apply: (s, a) => { s.worthlessEffects.jubbaCloak = a.territoryId; } },
  kull_wahad:     { window: 'onKaramaAttempt', apply: (s, a) => s.worthlessEffects.kullWahad.push(a.targetFactionId) },
  kulon:          { window: 'ownShipmentMovementTurn', apply: s => { s.worthlessEffects.kulon = true; } },
  la_la_la:       { window: 'revival', apply: (s, a) => s.worthlessEffects.laLaLa.push(a.targetFactionId) },
  trip_to_gamont: { window: 'mentatPause', apply: (s, a) => { s.worthlessEffects.tripToGamont = a; } }
};

function playWorthlessEffect(state, cardId, args) {
  if (karamaBlocks(state, 'choam', 'treachery')) throw new Error('Karama prevents CHOAM worthless effects this phase.');
  const key = cardById(cardId).effectKey;                          // data: effectKey on each worthless card
  discardFromHand(state, 'choam', cardId);
  WORTHLESS_EFFECTS[key].apply(state, args);
}
```

Engine checks to add:
- movementEngine: a move into `territoryId` by `targetFactionId` is illegal if a Baliset entry matches (shipment still legal).
- stormEngine: forces of CHOAM in `jubbaCloak` territory are not destroyed; clear after the move.
- karamaEngine: at the moment a faction attempts Karama, offer CHOAM the Kull Wahad response (a reaction window, like Voice). If played, the Karama card is not used (`VERIFY` whether the Karama card is discarded or returned; default: returned to hand).
- movementEngine: CHOAM range +1 when `kulon`.
- revivalEngine: `laLaLa` blocks free revival only (paid revival still allowed).
- Mentat Pause: resolve Trip to Gamont before victory check (it can change stronghold occupancy). Order within Mentat Pause: Trip to Gamont, Stronghold Cards, victory check, Inflation, Face Dancer swap, cleanup.

AI defaults: discard duplicates always (keep one); Worthless for spice unless an effect has clear value (La La La on the faction with the most forces in the tanks when it can afford nothing else; Kull Wahad held to counter a known Karama; Jubba Cloak when the storm will hit a CHOAM stack; Trip to Gamont on a single-force stronghold holder when that removes an opponent's win).

### 9.6 Revival

Handled by `revivalTerms` (6.5): cap Infinity, 1 spice each, free 0. Payment goes to Tleilaxu if seated, else bank.

### 9.7 Forces payment (advanced)

```js
on('battle.planSpice', (state, { factionId, amount, traitorRevealed }) => {
  if (!isSeated(state, 'choam') || factionId === 'choam' || traitorRevealed) return;
  if (karamaBlocks(state, 'choam', 'forces')) return;
  const share = Math.floor(amount / 2);
  // The battle engine currently sends the full amount to the bank; redirect CHOAM's share.
  state.spiceBank.totalInCirculation -= share;
  state.factions.choam.spice += share;
});
```

`ADAPT:` emit `battle.planSpice` after the existing code has paid the bank, with `amount` including any spice provided by the Arrakeen stronghold card (Q&A). Where an ally pays for forces (Emperor, CHOAM alliance), the share is still computed on the total spice spent for forces.

### 9.8 Auditor

```js
async function resolveAudit(state, battle, decisionProvider) {
  const choamPlan = battle.planOf('choam');
  if (!choamPlan || choamPlan.leaderId !== 'ch_auditor') return;
  if (battle.traitorRevealedAgainst === 'choam') return;                        // no audit if the Auditor was a traitor (VERIFY)
  if (karamaBlocks(state, 'choam', 'auditor')) return;
  const opponentId = battle.opponentOf('choam');
  const survived = !battle.killedLeaderIds.includes('ch_auditor');
  const eligible = state.factions[opponentId].hand.filter(id => !battle.cardsPlayedBy(opponentId).includes(id));
  const toSee = Math.min(survived ? 2 : 1, eligible.length);
  if (toSee === 0) return;
  const pay = await decisionProvider.chooseCancelAudit(state, opponentId, { cost: toSee });
  if (pay && state.factions[opponentId].spice >= toSee) { transfer(state, opponentId, 'choam', toSee, 'audit cancelled'); return; }
  const seen = sampleWithoutReplacement(eligible, toSee, state.rng);
  recordKnownCards(state, 'choam', opponentId, seen);                          // feeds the "known cards" system already built
}
```

Auditor revival: eligible as CHOAM's one leader revival per turn even if other CHOAM leaders are alive. `isEligibleForLeaderRevival(state, 'choam')` returns true for `ch_auditor` whenever it is in the tanks.

AI default for `chooseCancelAudit`: pay if it holds Karama, a Lasgun or a card it has not revealed and the cost leaves at least 2 spice.

### 9.9 Alliance

- Card trade: at the end of any phase, once per turn, `chooseChoamAllyTrade(state, 'choam', allyId)` then `chooseChoamAllyTradeResponse(state, allyId, offeredCardId)`; both must give one card, hand limits respected after the swap (always equal, so safe).
- Battle support: the existing "ally pays for forces" support (Emperor) becomes generic: `allySupportCapacity(state, allyId)` returns CHOAM's spice when allied with CHOAM.

### 9.10 Tests and done when

- `tests/choam.sim.js`: charity order and amounts with 6 factions (12 spice to CHOAM); other factions paid from CHOAM; shortfall rule; Inflation Double, flip to Cancel, removal; Spice Production not triggered by CHOAM's own advantage.
- Discards: duplicates only when identical; worthless for 2; each worthless effect with its engine check.
- Forces share floor half; none on traitor; none for CHOAM's own payment.
- Auditor: 2 or 1 cards, cancel for exact cost, 1-card hand edge case; revival eligibility.
- Karama table entries each stop the right thing.

**Done when:** CHOAM plays full games, the Worthless cards are back in the deck whenever CHOAM is seated, and the house rule still applies otherwise.

---

## 10. M6 Richese

### 10.1 Rules summary (from the C&R rulebook)

- **Start:** 20 forces in reserves, 5 spice, free revival 2. A separate cache of 10 Richese Treachery Cards (not part of the hand). Three No-Field tokens: 0, 3 and 5.
- **Bidding:** at the start of each Bidding Round one fewer card is put up for auction. Richese must reveal and auction one cache card, by Once Around or Silent auction, ignoring normal bidding order. It may be the first or last card and Richese announces which (before the Ixian bidding advantage). Richese collects payment when others buy. If Richese buys its own, payment goes to the Emperor or bank as normal. Discarded cache cards go to the normal discard pile. Cache cards cannot be bought or taken with Karama.
  - **Once Around:** pick a direction; starting next to Richese, each faction once may pass or bid higher; when it returns to Richese, Richese either outbids the highest bid and takes the card, or the highest bidder buys it. If everyone else passes, Richese may take it free or remove it from the game.
  - **Silent:** all factions able to bid secretly put any amount (including 0) in hand, reveal simultaneously; highest wins, ties broken by storm order. If all bid 0, Richese may take it free or remove it from the game.
- **No-Field:** when shipping, Richese may pay for one force and place a No-Field token face down instead of shipping normally. Others do not know how many forces it represents; it counts as one force for all effects until revealed (including collecting spice and stronghold presence, even the 0 token). Richese may reveal it at any time before the Battle phase, placing the indicated number of forces from reserves (or as many as remain). It moves like forces. Storm or worm reveals it and Richese loses the indicated number. Only one No-Field token may be on the planet; the same token cannot be used twice in a row (for Richese or an ally); the used one sits face up in front of the shield until another is placed. In a battle Richese must reveal the token when revealing its Battle Plan, placing forces from reserves (and cannot dial more forces than it actually has); Atreides may not see Richese's dial in a battle involving a No-Field token.
- **Black Market (advanced):** at the start of the Bidding Round, before declaration, Richese may offer one card from its HAND for auction, may announce (truthfully or not) what it is, shows nobody (Atreides may still look). It can use normal, Once Around or Silent auction. If nobody bids any spice, Richese keeps it and the intervention ends. If sold, one fewer normal card is auctioned. Richese receives all payment. Karama cannot acquire it. Normal-method bids proceed in storm order and the normal round resumes where it left off, or in storm order if an alternative method was used.
- **Fremen Special Victory:** Richese counts as one of the factions that must not occupy Tuek's Sietch.
- **Alliance:** Richese may ship an ally's forces from off-planet using an available No-Field token, revealing immediately (if a No-Field is already on the planet it must be revealed first). Cost: 1 spice to a stronghold, 2 elsewhere, paid by either player to the Guild (or bank if no Guild). Richese may also give its ally a cache card that is in Richese's hand, any time, if the ally's hand is not full.
- **Special Karama power:** pay 3 spice at any time to buy one of your cache cards, secretly choosing which.
- **Karama against Richese:** Bidding (no cache auction this round, play at start of bidding); No-Field (cannot ship with a No-Field token); Black Market (cannot sell from hand).
- Q&A highlights: Harkonnen get their free extra card when buying a cache or Black Market card; Juice of Sapho can make you last in a Once Around; an Ixian ally may redraw after buying a Black Market card but not a cache card; No-Field shipment triggers Heighliners unless shipping the Guild as ally.

### 10.2 The Richese cache (10 cards)

| id | Name | Effect | Timing |
|----|------|--------|--------|
| `distrans` | Distrans | Give another player a Treachery Card from your hand if their hand has room. | Any time except during a bid |
| `juice_of_sapho` | Juice of Sapho | Choose one: be the aggressor in a battle; or go first in a phase or action that uses turn order; or go last in one. | Start of the phase or action |
| `mirror_weapon` | Mirror Weapon | Weapon, special: becomes a copy of the opponent's weapon. Discard after use. | Battle plan |
| `portable_snooper` | Portable Snooper | Defence, poison: play after Battle Plans are revealed if you played no defence and Voice permits. Discard after use. | After reveal |
| `ornithopter` | Ornithopter | As your movement, move one group up to 3 territories, or two groups at your normal range. | Own movement |
| `nullentropy_box` | Nullentropy Box | Pay 2 spice to secretly search the discard pile and take one card; shuffle the discard pile; this card goes on top. Cannot take another Nullentropy Box (Q&A). | Any time |
| `semuta_drug` | Semuta Drug | Take a Treachery Card into your hand immediately after another player discards it (you choose if several are discarded together). | Reaction |
| `residual_poison` | Residual Poison | Before Battle Plans: kill one of the opponent's available leaders at random; no spice collected. | Battle, before plans |
| `stone_burner` | Stone Burner | Weapon, special: after plans are revealed choose to kill both leaders or reduce both to 0 strength. Discard after use. (`VERIFY` the treachery.online wording about undialled forces against the printed card.) | Battle plan |
| `karama_richese` | Karama | Updated Karama text (same effects as the C&R replacement Karama). | Any |

Also add the C&R replacement **Karama** text to the two base Karamas: prevent a faction advantage; bid any amount or win a card immediately; ship at half price; special Karama power once per game (advanced). Confirm the existing Karama engine already matches.

### 10.3 State

```js
state.factions.richese.cache = ['distrans', 'juice_of_sapho', /* ...10 ids */];      // public count, private order irrelevant
state.factions.richese.noField = {
  available: [0, 3, 5],       // tokens behind the shield
  lastUsed: null,             // value of the face-up token (public)
  onPlanet: null              // { territoryId, value } value private
};
state.bidding.richese = {
  cacheCardId: null,          // revealed card this round (public)
  cachePosition: null,        // 'first' | 'last'
  cacheMethod: null,          // 'onceAround' | 'silent'
  blackMarket: null           // { actualCardId (private), claimedName (public), method, sold }
};
```

### 10.4 Bidding round with Richese and Ixians together

Order at the start of the Bidding Round (combines both rulebooks and the Q&A):

1. Black Market intervention (Richese may offer a hand card). Resolve it now. If sold, `normalCount -= 1`.
2. Declaration: normal card count = factions able to bid, minus 1 for the Richese cache auction if a cache card remains and Richese is not blocked by Karama, minus 1 if the Black Market card sold.
3. Richese announces the cache card position: `first` or `last`.
4. If `first`: run the cache auction now.
5. Ixian bidding advantage (7.8) draws `normalCount + 1` and buries one.
6. Normal auctions, with Technology and Atreides prescience per card.
7. If `last`: reveal and run the cache auction after normal bidding.

```js
// js/factions/richese.js

async function runOnceAround(state, decisionProvider, { cardLabel, sellerId = 'richese', payee }) {
  const direction = await decisionProvider.chooseOnceAroundDirection(state, sellerId);      // 'cw' | 'ccw'
  const order = seatsFrom(state, sellerId, direction).filter(id => id !== sellerId && canBid(state, id));
  let high = { factionId: null, amount: 0 };
  for (const id of order) {
    const bid = await decisionProvider.chooseOnceAroundBid(state, id, { cardLabel, highBid: high.amount });
    if (bid && bid > high.amount && canAfford(state, id, bid)) high = { factionId: id, amount: bid };
  }
  if (!high.factionId) {
    const take = await decisionProvider.chooseFreeOrRemove(state, sellerId, { cardLabel });   // 'take' | 'remove'
    return { winnerId: take === 'take' ? sellerId : null, amount: 0, removed: take !== 'take' };
  }
  if (canBid(state, sellerId)) {
    const outbid = await decisionProvider.chooseOnceAroundFinal(state, sellerId, { highBid: high.amount });
    if (outbid && outbid > high.amount && canAfford(state, sellerId, outbid)) return { winnerId: sellerId, amount: outbid };
  }
  return high;
}

async function runSilentAuction(state, decisionProvider, { cardLabel, sellerId = 'richese' }) {
  const bidders = stormOrder(state).filter(id => canBid(state, id));   // includes Richese if able (VERIFY)
  const bids = {};
  for (const id of bidders) bids[id] = Math.max(0, Math.min(await decisionProvider.chooseSilentBid(state, id, { cardLabel }), state.factions[id].spice));
  const max = Math.max(0, ...Object.values(bids));
  if (max === 0) {
    const take = await decisionProvider.chooseFreeOrRemove(state, sellerId, { cardLabel });
    return { winnerId: take === 'take' ? sellerId : null, amount: 0, removed: take !== 'take' };
  }
  const winnerId = bidders.find(id => bids[id] === max);               // storm order breaks ties
  return { winnerId, amount: max, bids };                               // bids become public on reveal
}

// Payment routing for Richese-originated auctions.
function settleRicheseSale(state, result, cardId, source) {
  if (result.removed) { state.decks.removedFromGame.push(cardId); return; }
  if (!result.winnerId) return;
  if (result.amount > 0) {
    if (result.winnerId === 'richese') payWithRedirects(state, 'richese', result.amount, 'bid');   // Emperor or bank
    else transfer(state, result.winnerId, 'richese', result.amount, `bought ${source} card`);
  }
  addToHand(state, result.winnerId, cardId);
  if (result.winnerId === 'harkonnen') harkonnenBonusCard(state);                 // Q&A: yes for cache and Black Market
  emit(state, 'bid.won', { factionId: result.winnerId, cardId, source });
}
```

Karama cannot be used to win a cache or Black Market card: the bidding UI hides the Karama option for these auctions.

Black Market:

```js
async function blackMarket(state, decisionProvider) {
  if (!isSeated(state, 'richese') || karamaBlocks(state, 'richese', 'blackMarket')) return { sold: false };
  const offer = await decisionProvider.chooseBlackMarketOffer(state, 'richese');
  // offer: { cardId, claimedName, method: 'normal' | 'onceAround' | 'silent' } or null
  if (!offer) return { sold: false };
  state.bidding.richese.blackMarket = { actualCardId: offer.cardId, claimedName: offer.claimedName, method: offer.method, sold: false };
  if (isSeated(state, 'atreides')) revealToFaction(state, 'atreides', offer.cardId);     // prescience still works
  const result = offer.method === 'onceAround' ? await runOnceAround(state, decisionProvider, { cardLabel: offer.claimedName })
             : offer.method === 'silent'     ? await runSilentAuction(state, decisionProvider, { cardLabel: offer.claimedName })
             : await runNormalAuctionForCard(state, decisionProvider, { cardLabel: offer.claimedName, excludeSeller: 'richese' });   // ADAPT
  if (!result.winnerId || result.winnerId === 'richese' || result.amount === 0) return { sold: false };   // no spice bid: keep it
  removeFromHand(state, 'richese', offer.cardId);
  state.bidding.richese.blackMarket.sold = true;
  settleRicheseSale(state, result, offer.cardId, 'blackMarket');
  return { sold: true };
}
```

AI defaults:
- `chooseCacheAuction`: choose the card most valuable to the richest opponents (Karama, Stone Burner, Mirror Weapon) when they are rich, method Silent when two or more opponents are rich (drives prices up), Once Around otherwise; position `first` when opponents hold lots of spice now, `last` to catch leftover spice after a normal round Richese does not intend to bid in.
- `chooseOnceAroundBid` / `chooseSilentBid`: value the card with the existing card-priority table, bid up to `value * affordability`, never below 3 spice left for shipping.
- `chooseFreeOrRemove`: take the card unless the hand is full.
- `chooseBlackMarketOffer`: sell duplicates and weak cards, claim a truthful name 60% of the time and otherwise the name of a strong card (seeded RNG).

### 10.5 No-Field

```js
function canShipWithNoField(state, factionId, territoryId) {
  const r = state.factions.richese;
  const shipperIsRichese = factionId === 'richese';
  const allyUse = !shipperIsRichese && areAllied(state, factionId, 'richese');
  if (!shipperIsRichese && !allyUse) return { ok: false };
  if (karamaBlocks(state, 'richese', 'noField')) return { ok: false, reason: 'Karama prevents No-Field shipping this turn.' };
  const usable = r.noField.available.filter(v => v !== r.noField.lastUsed);
  if (!usable.length) return { ok: false, reason: 'No usable No-Field token.' };
  return { ok: true, usable, mustRevealExistingFirst: Boolean(r.noField.onPlanet) };
}

async function shipWithNoField(state, decisionProvider, { shipperId, territoryId, value }) {
  const r = state.factions.richese;
  if (r.noField.onPlanet) revealNoField(state, 'forced by new placement');
  const costOneForce = shipmentCostPerForce(state, shipperId, territoryId);          // stronghold 1, elsewhere 2, Guild half etc.
  payShipment(state, shipperId, costOneForce);                                        // ADAPT: pays Guild or bank
  r.noField.available = r.noField.available.filter(v => v !== value);
  if (r.noField.lastUsed !== null) r.noField.available.push(r.noField.lastUsed);      // the face-up one returns behind the shield
  r.noField.lastUsed = value;

  if (shipperId === 'richese') {
    r.noField.onPlanet = { territoryId, value };
  } else {
    // Ally shipping: forces revealed immediately.
    const n = Math.min(value, state.factions[shipperId].forces.reserve);
    moveReserveToBoard(state, shipperId, territoryId, n);
  }
  emit(state, 'shipment.offPlanet', { factionId: shipperId, territoryId, forces: 1, viaNoField: true, shippedByAllyRichese: shipperId !== 'richese' });
}

function revealNoField(state, reason) {
  const r = state.factions.richese;
  const nf = r.noField.onPlanet;
  if (!nf) return 0;
  const n = Math.min(nf.value, r.forces.reserve);
  moveReserveToBoard(state, 'richese', nf.territoryId, n);
  r.noField.onPlanet = null;
  log(state, `Richese reveal the No-Field token in ${nf.territoryId}: ${nf.value} (${n} placed). ${reason}`);
  return n;
}
```

Presence rule used by every engine that asks "is this faction here?":

```js
function presence(state, factionId, territoryId) {
  const forces = state.factions[factionId].forces.onBoard[territoryId] ?? 0;
  const nf = factionId === 'richese' && state.factions.richese.noField.onPlanet?.territoryId === territoryId ? 1 : 0;
  return forces + nf;          // No-Field counts as ONE force until revealed
}
```

Replace direct `forces.onBoard[t] > 0` checks with `presence()` in: battle detection, stronghold occupancy (two-faction limit, victory, Stronghold Cards control), spice collection (counts as one force collecting), storm and worm resolution (reveal then lose), Tech Token transfer, BG advisor coexistence rules, Fremen special victory.

Storm and worm:

```js
function onStormOrWormHits(state, territoryId, sectorAffected) {
  const nf = state.factions.richese?.noField.onPlanet;
  if (nf && nf.territoryId === territoryId) {
    const placed = revealNoField(state, 'caught by storm/worm');
    // Then normal loss rules destroy them (and any other Richese forces there).
  }
}
```

Battle: at plan reveal, if Richese has a No-Field token in the battle territory, reveal it first; the plan's dial is capped by the forces actually present after the reveal. Atreides prescience option "see the dial" is disabled for this battle. A 0 token still fights with a leader (Q&A).

Movement: the token moves as one force, range as Richese forces, may join or leave a group moving from its territory (`VERIFY` whether it may merge with a group of revealed forces; default yes).

Mentat Pause and victory: a token alone in a stronghold counts as occupying it for victory.

### 10.6 Karama special and alliance

```js
function karamaBuyCacheCard(state, decisionProvider) {
  // Pay 3, secretly choose a cache card, add to hand. Richese's special Karama (once per game).
}
function giveCacheCardToAlly(state, cardId, allyId) {
  // Only Richese cache cards currently in Richese's hand; ally hand must have room.
}
```

### 10.7 Decision provider additions (Richese)

`chooseCacheAuction` returns `{ cardId, position, method }`; `chooseOnceAroundDirection`; `chooseOnceAroundBid`; `chooseOnceAroundFinal`; `chooseSilentBid`; `chooseFreeOrRemove`; `chooseBlackMarketOffer`; `chooseNoFieldShipment` (extend `chooseShipmentAndMovement` with `{ noFieldValue }`); `chooseRevealNoField` (offered at the start of each phase up to Battle); `chooseAllyNoFieldShipment`.

Human panel notes: the silent auction panel hides others' bids until all are in; the No-Field option in the shipment panel shows which values are usable and greys out the last-used one; the human's No-Field value shows only on their own counters.

### 10.8 Tests and done when

- `tests/richese.sim.js`: cache auction every round until empty; normal card count reduced; Once Around ordering, final outbid, all-pass free-or-remove; Silent tie by storm order; payment routing (Richese sells vs buys); Harkonnen bonus card; Karama cannot buy; Karama blocks cache auction.
- Black Market: sold reduces count; unsold kept; Atreides sees it; Ixian ally redraw allowed on Black Market, refused on cache.
- No-Field: one on planet; not same token twice; presence counts as one; spice collection with a 0 token; storm reveal loses forces; battle reveal and dial cap; ally shipment costs and immediate reveal; Heighliner trigger exception for Guild.
- Richese with Ixians: position `first` precedes Ixian draw, Ixians draw one fewer.
- Invariants: card conservation includes `cache` and `removedFromGame`; No-Field tokens: `available.length + (lastUsed === null ? 0 : 1) === 3`, and when a token is on the planet its value equals `lastUsed`.

**Done when:** Richese plays full games, the auction panels support all three methods, and hidden values never leak to the human.

---

## 11. M7 Leader Skill Cards (variant, any factions)

### 11.1 Rules summary (from the C&R rulebook)

- **Setup change:** after positions and the BG prediction, deal Treachery (including the Ixian start-of-game draft), then deal two Leader Skill Cards to each faction. Each keeps one and shuffles the other back. Place the kept card face up in front of the shield and choose one leader disc to go next to it: that leader has the skill while alive. Then continue setup from Traitors.
- **Two parts per skill:** a first part that works while the skilled leader is alive and face up in front of the shield (even when another leader fights), and a stronger battle part that works only when the skilled leader is the one in the battle.
- **Battle choice:** when choosing a leader for battle, either leave the skilled leader and card face up (first part stays available) or take both behind the shield. If taken behind the shield and the skilled leader fights, both parts apply. If taken behind the shield and a different leader fights, no part applies.
- Skills apply in the current battle unless the skilled leader is killed in that battle. A skill is used before a faction ability (e.g. Mentat before Atreides prescience).
- A skill that names a card type needs the card played as that type (e.g. Chemistry played as a poison weapon for Master of Assassins).
- If the skilled leader dies, the card is shuffled back into the skill deck. Whenever a faction revives any leader and has no skill card, it draws two, keeps one and assigns it to the revived leader. A captured skilled leader takes the skill to the Harkonnen (they get only the battle part, and only in battle). Gholas never draw skills. Zoal never copies a skill. The Auditor cannot hold a skill.

### 11.2 The 14 skills

Mechanics below are reconstructed from treachery.online's implementation (`Battle.DetermineSkillBonus`, `Game_Battle.cs`, `Game_Move.cs`, `Game_Other.cs`). `VERIFY` each against the printed card before shipping; values are the parts most likely to need a tweak.

| id | Skill | First part (skilled leader alive, face up) | Battle part (skilled leader fighting) |
|----|-------|---------------------------------------------|----------------------------------------|
| `mentat` | Mentat | Before Battle Plans, ask your opponent whether they hold a named card; they must answer truthfully. | +2 leader strength. |
| `spice_banker` | Spice Banker | Once per phase, when another faction pays 4 or more spice to the bank in one payment, gain 1 spice (collected in Spice Collection). | Add 1 to 3 spice to the plan; leader strength rises by the same amount (spice goes to the bank). |
| `bureaucrat` | Bureaucrat | Once per phase, when a faction other than you receives 5 or more spice from another faction's payment, you may make the receiver lose 2 spice to the bank. | Opponent's total is reduced by the number of strongholds they occupy. |
| `warmaster` | Warmaster | +1 when a Worthless card is in your plan. | +3 when a Worthless card is in your plan. |
| `prana_bindu_adept` | Prana Bindu Adept | +1 when your plan includes a projectile defence. | +3 with a projectile defence. |
| `swordmaster` | Swordmaster of Ginaz | +1 with a projectile weapon. | +3 with a projectile weapon. |
| `killer_medic` | Killer Medic | +1 with a poison defence (including Portable Snooper). | +3 with a poison defence. |
| `master_of_assassins` | Master of Assassins | +1 with a poison weapon (including Poison Tooth). | +3 with a poison weapon. |
| `planetologist` | Planetologist | Once per turn in Movement: +1 movement range, or move groups from two different territories. | +2 when your plan includes a non-weapon, non-defence, non-worthless card. |
| `sandmaster` | Sandmaster | When you move, collect 1 spice from each spice-bearing territory along the path (best path). | If the battle territory holds spice and you have forces there, add 3 spice to it. |
| `smuggler` | Smuggler | When shipping into a territory with no forces, ship one extra force free (not Fremen). | Collect spice from the battle territory up to your leader's value. |
| `diplomat` | Diplomat | If your opponent played a defence and you did not, you may turn a Worthless card in your plan into a copy of that defence. | If you lose and your leader survives, you may retreat forces to an adjacent territory instead of losing them (`VERIFY` limits). |
| `rihani_decipherer` | Rihani Decipherer | When you fight, look at the top 2 Traitor Cards (returned and shuffled). | Additionally you may swap one of your unrevealed traitors for one of them. Tleilaxu: counts as a Face Dancer swap, unrevealed only (Q&A). |
| `suk_graduate` | Suk Graduate | When you win a battle, 1 force that would be lost returns to reserves instead. | 1 force that would be lost stays in the territory and up to 2 more return to reserves. |

Only one bonus-type skill applies per battle (the code checks them in the order above and stops at the first match), so a leader never stacks two skill bonuses.

### 11.3 Code

```js
// js/leaderSkills.js
const SKILLS = { /* table above as data: id, name, firstPart, battlePart, bonus: { trigger, first, battle } */ };

const BONUS_TRIGGERS = {
  warmaster:           s => s.anyWorthless,
  prana_bindu_adept:   s => s.defense?.projectileDefense,
  swordmaster:         s => s.weapon?.projectileWeapon,
  killer_medic:        s => s.defense?.poisonDefense,
  master_of_assassins: s => s.weapon?.poisonWeapon || s.weapon?.id === 'poison_tooth',
  planetologist:       s => s.anyNonCombatCard
};

function skillOf(state, factionId) { return state.factions[factionId].leaderSkill ?? null; }   // { skillId, leaderId, behindShield }

function skillBonus(state, factionId, plan, slots) {
  const sk = skillOf(state, factionId);
  if (!sk || plan.leaderSkillSuppressed) return { bonus: 0, skill: null };
  const leaderIsSkilled = plan.leaderId === sk.leaderId;
  const firstPartLive = !sk.behindShield;                        // face up in front of shield
  if (!leaderIsSkilled && !firstPartLive) return { bonus: 0, skill: null };

  if (leaderIsSkilled && sk.skillId === 'mentat') return { bonus: 2, skill: 'mentat' };
  if (leaderIsSkilled && sk.skillId === 'spice_banker') return { bonus: plan.bankerSpice ?? 0, skill: 'spice_banker' };
  const trig = BONUS_TRIGGERS[sk.skillId];
  if (!trig || !trig(slots)) return { bonus: 0, skill: null };
  if (sk.skillId === 'planetologist') return leaderIsSkilled ? { bonus: 2, skill: sk.skillId } : { bonus: 0, skill: null };
  return { bonus: leaderIsSkilled ? 3 : 1, skill: sk.skillId };
}

function skillPenaltyAgainst(state, factionId, plan, opponentId) {
  const sk = skillOf(state, factionId);
  if (sk?.skillId === 'bureaucrat' && plan.leaderId === sk.leaderId) return strongholdsOccupiedBy(state, opponentId);
  return 0;
}
```

Battle total becomes: `dial + leaderValue (if it counts and survives) + skillBonus - opponentSkillPenalty` (plus KH +2 as today). Skill bonuses count only if the skilled leader was not killed in this battle (rulebook). `ADAPT:` check whether the first-part +1 counts when a different leader dies; default: it still applies because the skilled leader is alive.

Hooks for non-battle parts:
- Spice Banker and Bureaucrat: subscribe to `bank.paid` and a new `faction.paid` event (emit from `transfer`).
- Smuggler: shipment engine adds a free force when the destination has no forces from anyone.
- Planetologist and Sandmaster: movement engine.
- Mentat: new `chooseMentatQuestion` before plans; answer is automatic (engine knows hands).
- Decipherer, Suk Graduate, Diplomat: battle engine post-resolution.

Setup and lifecycle:

```js
async function dealLeaderSkills(state, decisionProvider) {
  if (!state.rules.leaderSkills) return;
  shuffleInPlace(state.decks.leaderSkills, state.rng);
  for (const id of seatOrder(state)) {
    const two = state.decks.leaderSkills.splice(0, 2);
    const { keep, leaderId } = await decisionProvider.chooseLeaderSkill(state, id, { skills: two, leaders: eligibleSkillLeaders(state, id) });
    state.decks.leaderSkills.push(two.find(s => s !== keep));
    shuffleInPlace(state.decks.leaderSkills, state.rng);
    state.factions[id].leaderSkill = { skillId: keep, leaderId, behindShield: false };
  }
}

function eligibleSkillLeaders(state, id) {
  return state.factions[id].leaders.available.filter(l => l !== 'ch_auditor');
}

on('leader.killed', (state, { factionId, leaderId }) => {
  const sk = state.factions[factionId]?.leaderSkill;
  if (sk?.leaderId === leaderId) { state.decks.leaderSkills.push(sk.skillId); shuffleInPlace(state.decks.leaderSkills, state.rng); state.factions[factionId].leaderSkill = null; }
});
on('leader.revived', async (state, { factionId, leaderId, isGhola }, dp) => {
  if (!state.rules.leaderSkills || isGhola || leaderId === 'ch_auditor') return;
  if (state.factions[factionId].leaderSkill) return;
  // draw two, keep one, assign to the revived leader
});
```

AI default for `chooseLeaderSkill`: prefer skills matching its card-holding style (Master of Assassins if it holds poison, Swordmaster if projectile), else Mentat or Suk Graduate; assign to its second-strongest leader (the strongest is the most likely traitor target). Battle choice default: take the skilled leader behind the shield only when it is the intended fighter.

### 11.4 Tests and done when

- `tests/leaderSkills.sim.js`: setup order; one skill per faction; each bonus trigger at +1 and +3; Mentat +2; Banker spice; Bureaucrat penalty; skill lost on death and redrawn on revival; Ghola and Auditor exclusions; captured leader skill only in battle.

**Done when:** skills show on the Factions sheet and in the battle panel breakdown.

---

## 12. M8 Advanced Stronghold Cards (variant, any factions)

### 12.1 Rules summary

- Six cards: Arrakeen, Carthag, Sietch Tabr, Tuek's Sietch, Habbanya Sietch, Hidden Mobile Stronghold. Home-field advantage in battles in that stronghold.
- Claimed only in the Mentat Pause, never at game start: at the end of each turn each faction controlling a stronghold (sole occupant, BG advisors not counted, a No-Field token counts) takes that card. If control is lost, the card passes to the new controller at the next Mentat Pause, or is set aside if nobody controls it.

### 12.2 Effects (from treachery.online, `VERIFY` wording)

| Card | Advantage in battles in that stronghold |
|------|-----------------------------------------|
| Arrakeen | The bank provides 2 free spice toward your forces in the battle (counts toward CHOAM's half share, Q&A). |
| Carthag | Any defence you play also counts as a poison defence. |
| Sietch Tabr | If you win, collect spice equal to the opponent's dial (rounded down). |
| Tuek's Sietch | Collect 2 spice for each Worthless card you play in the battle. |
| Habbanya Sietch | You win ties. |
| Hidden Mobile Stronghold | In a battle in the HMS, use the advantage of one other Stronghold Card you hold. |

### 12.3 Code

```js
state.strongholdCards = { arrakeen: null, carthag: null, sietch_tabr: null, tueks_sietch: null, habbanya_sietch: null, hms: null };

function mentatPauseStrongholdCards(state) {
  if (!state.rules.strongholdCards || state.turn < 1) return;
  for (const card of Object.keys(state.strongholdCards)) {
    if (card === 'hms' && !state.hms?.placed) continue;
    const territoryId = card === 'hms' ? 'hms' : card;           // ADAPT: territory ids
    const controllers = Object.keys(state.factions).filter(f => presenceForControl(state, f, territoryId) > 0);
    state.strongholdCards[card] = controllers.length === 1 ? controllers[0] : null;
  }
}

function hasStrongholdAdvantage(state, factionId, advantageCard, battleTerritoryId, hmsChoice) {
  if (!state.rules.strongholdCards) return false;
  if (battleTerritoryId === 'hms' && state.strongholdCards.hms === factionId) return hmsChoice === advantageCard && state.strongholdCards[advantageCard] === factionId;
  return battleTerritoryId === advantageCard && state.strongholdCards[advantageCard] === factionId;
}
```

Hook the effects into: plan spice cost (Arrakeen), `effectiveSlots` Carthag flag (5.2), winner resolution (Sietch Tabr), card resolution (Tuek's), tie-break (Habbanya), and a `chooseHmsAdvantage` decision for HMS battles.

**Done when:** cards move at each Mentat Pause, show on the Factions sheet and the territory info card, and each effect has a test.

---

## 13. M9 Cross-cutting rules

### 13.1 Karama reference table (implement as data)

`data/karama.json` drives both the engine (`karamaBlocks`) and the in-app Karama picker. Entries from both rulebooks:

| Faction | Advantage | Karama effect |
|---------|-----------|---------------|
| Ixians | Bidding | May not look at Treachery Cards and remove one |
| Ixians | Cyborg and Suboid movement | May not move more than one territory |
| Ixians | Cyborgs in battle | Count as one normal force |
| Ixians | Suboids in battle | Cannot replace Cyborgs lost in battle |
| Ixians | Hidden Mobile Stronghold | May not move or collect spice |
| Ixians | Technology (advanced) | May not replace a Treachery Card |
| Ixians | Suboid strength | No effect |
| Tleilaxu | Face Dancers | May not replace a Face Dancer in the Mentat Pause; other Face Dancer effects cannot be stopped |
| Tleilaxu | Revival (advanced) | 3-force limit, full price, no payment for free revival, payments to bank, no early leader revival |
| Tleilaxu | Gholas (advanced) | May not revive another player's leader this turn |
| CHOAM | Charity | No collection except normal charity; others collect from the bank |
| CHOAM | Treachery | No discarding for spice; no Worthless effect that phase |
| CHOAM | Revival | Up to 3 forces (5 if Tleilaxu allow), 2 spice each |
| CHOAM | Inflation | Cannot place the token this Mentat Pause (flipping next turn unaffected) |
| CHOAM | Forces (advanced) | No battle-spice income for one battle |
| CHOAM | Auditor (advanced) | No audit |
| Richese | Bidding | No cache auction (play at start of bidding) |
| Richese | No-Field | Cannot ship with a No-Field token |
| Richese | Black Market (advanced) | Cannot sell a card from hand |

Special Karama powers (advanced, once per game): Ixians move the HMS 2 during Shipment and Movement plus normal move; Tleilaxu prevent a player's revival; CHOAM discard any cards for 3 each; Richese pay 3 to buy a cache card.

### 13.2 Alliance matrix additions

Add to the existing alliance-benefit system and the tappable ally pill:

| Ally of | Benefit |
|---------|---------|
| Ixians | After buying a Treachery Card, may discard it and draw the top card (not Richese cache cards). |
| Tleilaxu | Revive forces and leaders at half price (rounded up). |
| CHOAM | Once per turn at the end of a phase, trade one card each way; CHOAM may pay for the ally's forces in battle. |
| Richese | Richese may ship the ally with a No-Field token (revealed immediately); Richese may give the ally a cache card from its hand. |

Existing benefits that need expansion checks: Emperor paying for ally forces generalises with CHOAM; Guild ally shipping interacts with Heighliners; Fremen ally free revival triggers Axlotl Tanks.

### 13.3 Prediction deck and traitor deck

- BG Prediction deck: add `ixians`, `tleilaxu`, `choam`, `richese` cards, filtered by seated factions as today.
- Traitor deck: new leaders filtered by seated faction, plus Cheap Hero traitor (I&T) and Auditor (C&R, when CHOAM seated).
- Harkonnen captured leaders: cannot capture the Auditor; captured Ghola (`VERIFY`: default not capturable while in Tleilaxu pool? treat as Tleilaxu's leader, capturable).

### 13.4 Fremen special victory

Richese joins the list of factions that must not occupy Tuek's Sietch (C&R). `VERIFY` whether Ixians, Tleilaxu or CHOAM also block it; no rule found, so default no.

---

## 14. M10 AI

Basic AI defaults are given with each decision above. Additional work for the Strategic AI:

- **Victory model:** use `strongholdCount` (HMS and all three Tech Tokens included) everywhere, including the victory watch strip and the "stop the leader" logic.
- **Hidden information:** No-Field expected value for an opponent's token = mean of the usable values (excluding `lastUsed`); Face Dancer risk for a leader = `3 / (traitor deck size + 3)` adjusted by known revealed dancers; Black Market claim trust at 60%.
- **Tleilaxu plan:** stay off-planet early, bank revival income, ship late into strongholds emptied by battles, reveal Face Dancers on high-force winners in strongholds.
- **Ixians plan:** HMS to spice each turn, keep Cyborgs in the HMS as a stronghold anchor, use bidding knowledge to bury Karama when an opponent is close to winning.
- **CHOAM plan:** hoard cards to 5, Inflation Double early, strike with a large force mid-game, discard duplicates each phase.
- **Richese plan:** sell cache cards to the richest factions, use the 5 No-Field to take a lightly held stronghold cheaply, Black Market duplicates.
- **Reading opponents:** treat revealed Face Dancers, Tech Tokens and Stronghold Cards as public knowledge in the existing known-cards model.
- Re-run the 150-game batch per milestone and record win rates by faction in `docs/AI_NOTES.md`, as has been done for the base six. Flag any faction under 3% or over 35% for tuning.

---

## 15. M11 UI

- **Setup screen:** 10-faction grid with "choose six", human faction selector limited to the chosen six, toggles for Tech Tokens, Leader Skills, Stronghold Cards, Worthless cards (shows as forced on when CHOAM is seated), plus Random six.
- **Counters and sprites:** new faction counters for Ixians, Tleilaxu, CHOAM, Richese using the same book-accurate brief as the existing set; a distinct Cyborg counter (starred) and Suboid counter (ordinary); HMS token sprite (a hovering platform) with a glide animation when it moves; No-Field token (face-down "?" for others, value visible to its owner); Tech Token chips; Inflation token; Stronghold Card icons.
- **Board:** the HMS drawn at its host territory's pointed sector with its own tap target and territory card ("Hidden Mobile Stronghold, pointing at X"); forces inside it render on the token.
- **Panels (human provider):** Ixian draft and bury choice, Technology prompt, HMS step picker, Face Dancer reveal and replacement sources, Face Dancer swap, revival limit and early-leader price prompts, Ghola picker, CHOAM discard window, Worthless effect picker with target selection, Inflation choice, audit cancel prompt, Richese cache auction setup, Once Around and Silent bid panels, Black Market offer (with claim text), No-Field shipment and reveal options, Leader Skill choice and battle toggle, Mentat question, Poison Tooth withdraw, Stone Burner mode, HMS advantage choice.
- **Battle wheel:** 0.5 steps for Ixians; spice slider capped at Cyborg count; skill bonus and stronghold card lines in the total breakdown; "dial hidden from Atreides" note when a No-Field is involved.
- **Factions sheet:** Tech Tokens, Inflation status, Face Dancers revealed so far, Richese cache count and last-used No-Field, Leader Skill cards, Stronghold Cards, Gholas in the Tleilaxu pool.
- **Log and ticker:** one clear line per new event type (Face Dancer, Tech income, Inflation, cache sale, No-Field reveal, audit, skill trigger).
- **Audio hooks:** turn announcements for the four new factions (hooks ready, files to be supplied); a short cue for Face Dancer reveals and No-Field reveals.
- **Faction guide:** a page per new faction written in the same voice as the existing guide, covering start, advantages, advanced advantages, alliance, Karama, and a two-line strategy note.

---

## 16. File-by-file change checklist

`ADAPT:` names to the actual files.

| File | Change |
|------|--------|
| `data/factions.json` | 4 factions (4.1) |
| `data/leaders.json` | 21 leaders (4.2) |
| `data/treacheryCards.json` | 14 I&T, 10 Richese cache, C&R Poison Tooth and Artillery, Karama text, flags (4.7), `effectKey` on worthless cards |
| `data/spiceCards.json` | Sandtrout |
| `data/traitors` (built from leaders) | Cheap Hero traitor, Auditor |
| `data/territories.json` | `hms` pseudo-territory |
| `data/karama.json` | new (13.1) |
| `data/leaderSkills.json`, `data/strongholdCards.json` | new |
| `js/expansions/rulesConfig.js`, `spice.js`, `hooks.js` | new (M0) |
| `js/forceProfiles.js` | new (4.6) |
| `js/battle/leaderResolution.js` | new (5.2) |
| `js/factions/tleilaxu.js`, `ixians.js`, `choam.js`, `richese.js` | new |
| `js/techTokenEngine.js`, `js/leaderSkills.js`, `js/strongholdCards.js` | new |
| `js/setupEngine.js` | seating, Ixian draft, skills, Face Dancers, HMS placement, Tech Tokens, setup order |
| `js/traitorDeckEngine.js` | skip Tleilaxu, Face Dancers, Cheap Hero traitor |
| `js/stormEngine.js` / `runStormPhase` | HMS movement first; HMS immunity; Jubba Cloak; No-Field reveal |
| `js/spiceEngine.js` | Sandtrout, Harvester, Thumper, HMS immunity to worms, No-Field reveal |
| charity runner | CHOAM charity and Inflation |
| `js/biddingEngine.js` | Black Market, Richese cache auction, alternative auctions, Ixian draw and bury, Technology, Ixian ally redraw, hand limit 5 for CHOAM, Harkonnen bonus on Richese sales |
| `js/revivalEngine.js` | `revivalTerms`, Cyborg cost, La La La, Tleilaxu prevention, Gholas, early leader revival, events |
| `js/movementEngine.js` | HMS adjacency and shipping rule, Ixian ranges, No-Field shipping and movement, Baliset, Kulon, Ornithopter card, Smuggler, Planetologist, Sandmaster, events |
| `js/battleEngine.js` | flag-based leader resolution, Zoal, half dials, Ixian losses and substitution, Face Dancer reveal, Tech Token claim, CHOAM forces share, Auditor, Residual Poison, Portable Snooper, Poison Tooth and Stone Burner choices, skill bonuses, stronghold card effects, No-Field reveal, Juice of Sapho aggressor |
| spice collection | Cyborg carry 3, presence for No-Field |
| `js/mentatPause` | Trip to Gamont, Stronghold Cards, victory with HMS and tokens, Inflation, Face Dancer swap, CHOAM ally trade window |
| `js/karamaEngine.js` | table-driven blocks, Kull Wahad reaction, four special powers, cache and Black Market exclusions |
| alliance engine | four new benefit sets |
| `js/turnEngine.js` | emit `phase.start` and `phase.end`; start-of-phase card window |
| `js/ai/basicAI.js`, strategic AI | all new decisions |
| `ui/humanProvider.js`, `ui/*` | all new panels and displays |
| `tests/*` | new suites per milestone; invariants extended |
| `docs/` | faction reference updated; `EXPANSION_TODO.md` tracking `VERIFY` items |

---

## 17. Invariants to add to the AI batch

1. Spice: bank + all factions + spice on board is constant.
2. Forces per faction: reserve + board (including `hms`) + tanks = 20, starred split conserved (Ixians 7 Cyborgs, Emperor 5 Sardaukar, Fremen 3 Fedaykin).
3. Cards: every Treachery Card in exactly one of deck, discard, a hand, Richese cache, removed from game.
4. Leaders: every leader in exactly one of available, tanks, captured, Tleilaxu Gholas.
5. Tleilaxu: exactly 3 Face Dancers; no Tleilaxu traitors.
6. Tech Tokens: exactly three, owners valid.
7. No-Field: token accounting (10.8); at most one on planet.
8. HMS: host is never a stronghold; at most two factions inside after battles.
9. Hand limits: CHOAM at most 5, Harkonnen at most 8, others at most 4 at the end of every phase.
10. Stronghold Cards: each held by at most one faction, and only by a faction that was sole occupant at the last Mentat Pause.

---

## 18. Match export additions

So future match reviews can check the new systems: `hms`, `techTokens` (with sets as arrays), `faceDancers` (revealed flags; unrevealed only in the owner's or spectator export), `inflation`, `noField` (value only in spectator export), Richese `cache` count, `blackMarket` history, `leaderSkill` per faction, `strongholdCards`, `spiceLedger` for the last turn, and `rules`.

---

## 19. Open `VERIFY` list (consolidated)

1. Leader values for all 21 new leaders (4.2).
2. Stone Burner exact text (5.1, 10.2).
3. Shield Snooper counts as a Shield for Lasgun explosions (5.1).
4. Suppressed-Nexus worm location for Sandtrout (5.4).
5. Cheap Hero as a Face Dancer (5.5).
6. Captured leaders and Face Dancers; captured Gholas (6.4, 13.3).
7. Tleilaxu 1-spice income on their own free revival (6.5).
8. Early leader revival counts as the faction's one leader revival (6.5).
9. A killed Ghola returns to its original owner's tanks (6.6).
10. Tleilaxu Karama revival prevention and Ghola card (6.8).
11. HMS spice collection per step (7.5) and Fremen storm movement out of the HMS (7.3).
12. Ixian allies shipping into the HMS (7.3).
13. Technology on Richese auctions (7.8).
14. Cyborg revival cap (D7).
15. Fremen worm arrivals and Heighliners (8.2).
16. CHOAM charity shortfall (D5) and CHOAM normal charity eligibility (9.3).
17. Kull Wahad: fate of the blocked Karama card (9.5).
18. Auditor revealed as a traitor (9.8).
19. Richese in its own Silent auction (10.4).
20. No-Field merging with moving groups (10.5).
21. All 14 Leader Skill texts, Diplomat retreat limits, first-part bonus after a different leader dies (11.2, 11.3).
22. All 6 Stronghold Card texts, especially the HMS card (12.2).
23. Other factions blocking the Fremen special victory (13.4).

The quickest way to settle most of these is a single photo of each printed card and the player sheets; the rulebook text is already covered above.
