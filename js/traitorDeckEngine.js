// traitorDeckEngine.js
//
// Setup step 2: Traitors. Deck is literally "1 card per Leader Disc" per
// the component list, so it's built directly from leaders.json rather
// than being its own separate data file, there's nothing in it that
// doesn't already exist there.
//
// The "protect one of their own leaders" case (a faction unlucky enough
// to draw only their own leaders, no opponents) needs no special-case
// logic here: battleEngine.js's checkTraitor() only ever matches a card
// in your hand against a leader your OPPONENT plays, so holding your own
// leader's card as your selection is already functionally inert through
// the existing check, nothing extra to build.

function buildTraitorDeck(leadersData, activeFactionIds) {
  const deck = [];
  for (const factionId of activeFactionIds) {
    const factionLeaders = leadersData[factionId] ?? [];
    for (const leader of factionLeaders) {
      deck.push({ leaderId: leader.id, factionId });
    }
  }
  return deck;
}

function shuffle(array, arrayShuffleFn) {
  // Standardized on the same (array) => shuffledArray convention used by
  // spiceEngine.buildSpiceDeck and every other shuffle point in the
  // codebase. An earlier version of this function took a raw rng()=>number
  // instead, which was inconsistent with that and caused a real bug the
  // first time setupEngine.js tried to pass one shuffle function to both.
  if (arrayShuffleFn) return arrayShuffleFn(array);

  const result = array.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Deals 4 cards to every faction. Harkonnen's exception (keep all 4,
// nothing selected or returned) is applied immediately since they have
// no decision to make. Every other faction gets a `pendingTraitorHand`
// of 4 options awaiting selectTraitor().
function dealTraitorHands(state, deck, factionOrder) {
  let remainingDeck = deck.slice();

  for (const factionId of factionOrder) {
    if (remainingDeck.length < 4) {
      throw new Error(`Traitor deck ran out dealing to ${factionId}, only ${remainingDeck.length} cards left. Check activeFactionIds matches the actual player count.`);
    }
    const dealt = remainingDeck.slice(0, 4);
    remainingDeck = remainingDeck.slice(4);

    if (factionId === 'harkonnen') {
      state.factions.harkonnen.traitorHand = dealt.map(c => c.leaderId);
      // Also noted on their player sheet: "any leader cards of other
      // factions can be revealed in a battle as a traitor" is already
      // exactly what a 4-entry traitorHand does through the existing
      // checkTraitor() logic, no separate flag needed.
    } else {
      state.factions[factionId].pendingTraitorHand = dealt;
    }
  }

  return remainingDeck;
}

function canSelectTraitor(state, factionId, chosenLeaderId) {
  const faction = state.factions[factionId];
  if (factionId === 'harkonnen') {
    return { ok: false, reason: 'Harkonnen keeps all 4 dealt cards automatically, there is no selection to make.' };
  }
  if (!faction.pendingTraitorHand) {
    return { ok: false, reason: 'No pending traitor hand to select from, dealTraitorHands must run first.' };
  }
  if (!faction.pendingTraitorHand.some(c => c.leaderId === chosenLeaderId)) {
    return { ok: false, reason: 'Chosen leader was not among the 4 cards actually dealt to this faction.' };
  }
  return { ok: true };
}

// Returns the 3 unselected cards, which the caller places at the bottom
// of the actual game deck (not this module's concern, it just hands them
// back so gameState.decks.traitorDeck can be updated by the setup flow).
function selectTraitor(state, factionId, chosenLeaderId) {
  const check = canSelectTraitor(state, factionId, chosenLeaderId);
  if (!check.ok) throw new Error(check.reason);

  const faction = state.factions[factionId];
  const returned = faction.pendingTraitorHand.filter(c => c.leaderId !== chosenLeaderId);

  faction.traitorHand = [chosenLeaderId];
  delete faction.pendingTraitorHand;

  return { factionId, kept: chosenLeaderId, returnedToDeck: returned };
}

module.exports = {
  buildTraitorDeck,
  shuffle,
  dealTraitorHands,
  canSelectTraitor,
  selectTraitor
};
