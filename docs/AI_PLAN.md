# Advanced AI Plan

Goal: opponents (and allies) that feel like five different, capable human
players. They read the table, count cards, stop runaway leaders, bluff,
make and break alliances for reasons, and play to each faction's strengths.
All of it honestly: no peeking at hidden information, no extra resources
(brief sections 6, 29 and 50).

## 1. What the research says

**treachery.online** is the most mature Dune implementation with bots, and
its source is public ([github.com/ronaldossendrijver/treachery.online](https://github.com/ronaldossendrijver/treachery.online)).
Its "Classic" bot (~7,000 lines of C#) is not a search engine. It is:

- **Priority ladders per phase.** Shipment walks a fixed list of intents and
  takes the first that applies: prevent a normal win, prevent a Fremen win,
  strengthen my weakest stronghold if I'm winning, ship to spice if broke,
  take a vacant stronghold, attack a weak one, and so on.
- **Card counting.** It tracks which cards each player is known to hold
  (seen in battle, discarded, revealed) and computes the probability that an
  unknown card in an opponent's hand kills its leader or saves theirs.
- **A dozen tunable parameters per faction** (spice to keep when bidding,
  maximum unsupported forces, dial shortage it will accept, and so on).
- **One thing we will do differently:** its alliance scoring reads other
  players' actual spice. In GF9 Dune spice sits behind a player shield, so
  ours estimates it from public transactions instead (see 3.1).

**Information Set Monte Carlo Tree Search** ([Cowling, Powley and Whitehouse, 2012](https://eprints.whiterose.ac.uk/id/eprint/75048/))
is the standard technique for games with hidden cards: sample many plausible
versions of the hidden state that are consistent with what you know, then
evaluate your options across all of them. It beats simpler approaches in card
games with hidden hands ([Dou Di Zhu study](https://www.researchgate.net/publication/224259865_Determinization_and_information_set_Monte_Carlo_Tree_Search_for_the_card_game_Dou_Di_Zhu)).

**Diplomacy AI** is the closest research to Dune's politics. Meta's no-press
agent reached the top 2% of human players using **one-step lookahead search**
rather than deep search ([Gray et al., 2020](https://arxiv.org/abs/2010.02923)),
and DeepMind's negotiating agents were trained to [betray only when the gain
clearly outweighs the cost](https://deepmind.google/blog/ai-for-the-board-game-diplomacy/).
Both point the same way: in mixed cooperate/compete games, shallow search on
top of good evaluation beats deep search.

**Conclusion:** a hybrid. treachery.online-style heuristics for structure
and legibility, a proper belief model for honest card counting, and targeted
sampling-based search only where decisions are sharp and bounded: battles,
bids and end-of-game positions.

## 2. What we measured

- One full turn for all six factions simulates in **~1 ms** (Node on a
  server); a game-state copy takes **0.17 ms** and is 24 KB.
- Assume a phone is 5 to 10 times slower. Inside the brief's 0.3 to 1.5 s
  "AI is thinking" pause (section 31), an AI can still evaluate hundreds of
  battle outcomes, or roll a few dozen whole turns forward.
- Search runs in a **Web Worker** so the page never freezes, and is
  **anytime**: it returns its best answer when the time budget ends.

## 3. Architecture: five layers

Every layer plugs into the existing decision-provider interface, so the
engine, the UI and the human player are untouched.

### 3.1 Knowledge (what an honest player could know)

A per-faction belief model, updated only from public events plus that
faction's own private information:

- **Card tracker.** Every treachery card is in one of: my hand, a known
  opponent hand (seen by Atreides Prescience at auction, revealed in battle
  and kept, Harkonnen's bonus draw is unknown), the discard pile, or the
  unknown pool. From this, each opponent's hand becomes a probability
  distribution: "Harkonnen holds 5 cards, one known Lasgun, four from the
  unknown pool of 19, which contains 3 poison weapons."
- **Spice ledger.** Spice is hidden, but every change is public: starting
  amounts, collections, charity, bids paid, shipment costs, revival costs,
  battle payouts. The AI keeps an estimated ledger for each opponent, exact
  where the rules make it exact and a range where they don't.
- **Traitor risk.** Each opponent kept one traitor from four dealt
  (Harkonnen kept all four). The AI knows its own and which leaders have
  been revealed, and estimates the chance any of its leaders is someone's
  traitor. Leaders with high traitor risk are used when losing matters least.
- **Prediction guess.** Bene Gesserit's prediction is secret. Other factions
  keep a light guess (who BG helps, when) so they can deny a predicted win.

**Engine prerequisite:** a public event log in the game state, so the belief
model reads events rather than inspecting state it shouldn't see.

### 3.2 Strategic assessment (the "Mentat" pass, once per turn)

Built from the rules' actual win conditions:

- **Solo:** 3 strongholds at the end of a turn (4 in a two-player game).
- **Alliance:** 4 strongholds held between the allies.
- **Fremen special (final turn):** Fremen or nobody in Sietch Tabr and
  Habbanya Sietch, and no Harkonnen, Atreides, Emperor (or Richese) in
  Tuek's Sietch.
- **Guild special:** nobody has won by the end of the final turn.
- **Bene Gesserit:** the predicted faction wins on the predicted turn.

For every faction and alliance the AI computes a **victory proximity**
score: strongholds held, how contestable each is (defenders, nearby
enemies, storm exposure once sectors exist), spice to reinforce, turns
left, and whether a special condition is live. That gives a **threat
ranking** and a **goal** for this turn, one of:

- **Close out** (I can win this turn or next)
- **Deny** (someone else is about to win; the whole table's priority)
- **Build** (economy, cards, position)
- **Survive** (Fremen/Guild playing for the final turn, Bene Gesserit
  steering toward its prediction)

Denial is coordinated implicitly: every AI can see the same leader, so
several will independently choose to hit it, which is exactly how human
tables behave. The simulations show this is the single biggest gap today:
Guild and Fremen special wins dominate because no one ever denies them.

### 3.3 Intent ladders (legible structure per phase)

Per phase, an ordered list of intents, treachery.online style, but chosen
by the current goal rather than fixed. Example, shipment under **Deny**:
break the leader's weakest stronghold, then block the Fremen condition,
then secure my own. Under **Build**: spice near a stronghold, vacant
stronghold, cheap strength. Each intent produces candidate actions, not a
single answer; layer 4 picks among them.

The ladder is also where each AI explains itself for the log, per brief
section 51: "Emperor ships 6 Sardaukar into Carthag. Harkonnen was one
stronghold from victory."

### 3.4 Tactical evaluation (search where it pays)

- **Battles (the biggest win).** For each candidate plan (leader x weapon x
  defence x forces dialed x spice, pruned to sensible combinations), sample
  100 to 500 opponent hands and plans from the belief model and compute the
  expected value: territory won, forces lost, leaders killed and paid out,
  cards kept. This is ISMCTS-lite: one decision, many determinized worlds.
  It naturally produces the brief's section 18 behaviours: throwing a battle
  with a Cheap Hero and zero forces, holding a key card back, overcommitting
  only when the territory decides the game, and leading with a leader
  unlikely to be a traitor.
- **Bluffing without cheating.** The opponent's plan is sampled from a
  model of what a sensible player would do, with some randomness, so the AI
  mixes its own plans too and cannot be read perfectly.
- **Bidding.** A card's value to me (what it adds to my battle odds,
  whether it completes a weapon/defence pair, Karama's worth to my faction)
  minus its expected price, plus **denial value** (what it's worth to the
  current leader). Atreides uses the card it has seen; Emperor factors in
  that other players' bids pay the Emperor.
- **Shipment and movement.** Generate 10 to 20 candidates from the ladder,
  roll each forward to the end of the Battle phase a few times with the
  opponents on their Basic policies, and score the result with the victory
  proximity evaluation. One-step lookahead, as in the Diplomacy research.
- **Final turns.** On turns 9 and 10, when special wins go live, spend more
  of the budget: roll to the end of the game.

### 3.5 Diplomacy (alliances, and allying with you)

At each Nexus every AI scores possible partners:

- Would we together be close to 4 strongholds? Are our abilities
  complementary (Guild shipping plus Fremen mobility, Emperor spice plus
  Harkonnen cards)?
- Does allying stop someone else winning?
- Does it hand my partner a better position than me (a future threat)?

It proposes, accepts or rejects on that score, and **breaks an alliance
only when the gain clearly outweighs the cost** (the DeepMind finding),
with a memory of who broke with whom. As an ally it shares the rulebook's
advantages (paying for bids and shipments, Emperor revivals, Guild rates)
and plays its own interests within the alliance, as brief section 15 asks.
Human alliances get a proposal panel: "Harkonnen proposes an alliance.
Harkonnen holds 2 strongholds. Accept / Reject / Review board."

**Engine prerequisites:** the seven alliance shared advantages
(`docs/ALLIANCE_TODO.md`) and a human diplomacy panel.

## 4. Faction playbooks

Each faction gets weights and ladder variants, plus parameters to tune.

- **Atreides:** information first. Always spend Prescience on the element
  that most changes the decision. Bid hard on cards it has seen are strong.
  Protect the Kwisatz Haderach path by accepting early losses where cheap.
  Avoid uncertain battles; fight when it knows it wins.
- **Harkonnen:** card economy and traitors. Four traitors means many
  battles are secretly won in advance: seek fights against those leaders.
  Buy aggressively (every purchase is two cards). Bluff with a full hand.
- **Emperor:** money is the weapon. Sardaukar ship early to one stronghold
  and hold it. Bid to drain rivals when it profits. Fund an ally's revival.
  Never fight Fremen with Sardaukar (they're only worth 1 there).
- **Fremen:** the long game. Ride storms and worms (once built), keep
  Sietch Tabr and Habbanya Sietch clean of enemies, stay unthreatening
  until turn 8 or so, then secure the special condition. Fedaykin decide
  close battles.
- **Spacing Guild:** profit from everyone's shipping, keep the game going
  to turn 10, and quietly make sure nobody reaches 3 strongholds. Hold
  Tuek's Sietch. Ship late in the phase once others have committed.
- **Bene Gesserit:** pick a prediction that is plausible (a strong faction,
  late turn), then nudge that faction toward winning then and not before.
  Voice the key card category in big battles. Stay small and unthreatening.

Expansion factions get playbooks when their rules are built.

## 5. Difficulty (better decisions, never cheating)

| Level | Knowledge | Search | Strategy | Diplomacy |
|---|---|---|---|---|
| Easy | Own hand only, no card counting | None | Build only, slow to deny | Rarely allies |
| Normal | Full card and spice tracking | 50 battle samples | All goals | Allies on simple scores |
| Hard | Plus traitor and prediction estimates | 300 samples, 1-turn lookahead | Faction playbooks | Full scoring, betrays when justified |
| Expert | As Hard | 1,000 samples, end-game rollouts | Tuned parameters | As Hard, plus memory of trust |

Lower levels also add small, human-looking mistakes (occasionally the
second-best option), never random nonsense. No level gets extra spice,
forces, cards or visibility.

## 6. Tuning and proving it

- **Tournament harness.** Extend `tests/aiSimulation.sim.js`: Hard vs Normal
  vs Basic across all seats and hundreds of seeded games. Hard must beat
  Normal must beat Basic, from every faction's seat.
- **Health metrics:** no faction above 30% or below 8% win rate among equal
  AIs; stronghold wins should be common (today only 20%); average game 7 to 9
  turns; the leader gets attacked when one stronghold from winning.
- **Scenario tests ("puzzles"):** fixed positions with a correct answer,
  e.g. turn 10, Fremen one move from their special win: at least one AI must
  ship into Habbanya Sietch. Harkonnen holding Duncan's traitor card: it
  should seek that battle.
- **Parameter search:** tune each faction's parameters by self-play
  (simple hill-climbing on win rate against a fixed field). Balance problems
  get investigated first, never "fixed" by nerfing a faction (brief 37).

## Progress

- Step 1 (knowledge): public card knowledge built (state.meta.knownCards);
  spice ledger and a public event log still to do.
- Step 2 (strategy): done, js/ai/strategicAI.js.
- Step 3 (battle brain): done, js/ai/battleBrain.js, +51% game wins.
- Step 7 (diplomacy): done for AI and human, js/ai/diplomacy.js.
- Steps 4, 5, 6 and 8: next (see docs/ROADMAP.md).

## 7. Build order

1. **Engine support:** public event log; knowledge model (cards, spice
   ledger, traitor risk); Web Worker wrapper with a time budget.
2. **Strategic layer:** victory proximity, threat ranking, goals. Ship
   "Deny" first; it fixes the biggest weakness immediately.
3. **Battle evaluator** (sampling-based). The biggest jump in how smart the
   opponents feel, since battles are where Dune is won and lost.
4. **Bidding evaluator** with denial value.
5. **Shipment/movement** ladders plus one-step lookahead.
6. **Faction playbooks** for the six base factions.
7. **Diplomacy:** AI alliances, then human alliance panel and the shared
   advantages.
8. **Difficulty levels and tuning,** with the tournament as the gate.

Each step ships behind the same interface and must beat the previous AI in
the tournament before it becomes the default.

## 8. What this depends on

- **Sector data** for storm damage, First Player and storm-aware planning.
  Without it the AI cannot weigh storm risk, which good Dune play requires.
- **Voice, Karama, Truthtrance, worm riding and advisors**, so faction
  playbooks can use them.
- Nothing else. The rest is buildable now.
