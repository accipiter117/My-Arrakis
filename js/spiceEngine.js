// spiceEngine.js
//
// Phase 2: Spice Blow and NEXUS. Advanced rules are always active per
// project instruction, so this implements Double Spice Blow (two piles,
// A and B) unconditionally rather than branching on a config flag.
//
// Same pattern as the other engines: pure functions over plain state,
// nothing UI-specific, AI and human share the same code path (there isn't
// even a decision point in this phase for either to make, it's fully
// deterministic once the deck order is set).

function buildSpiceDeck(spiceDeckData, territoriesData, rngShuffle) {
  const wormCards = Array.from(
    { length: spiceDeckData.shaiHuludCount },
    (_, i) => ({ type: 'shaiHulud', id: `shaiHulud${i + 1}` })
  );

  const territoryCards = spiceDeckData.territoryCardIds.map(territoryId => {
    const territory = territoriesData.territories[territoryId];
    if (!territory?.spiceBlow?.present) {
      throw new Error(`spiceDeck.json references ${territoryId} but territories.json doesn't mark it as a spice blow location, data drift.`);
    }
    return { type: 'territory', id: territoryId, maxValue: territory.spiceBlow.maxValue };
  });

  return rngShuffle([...wormCards, ...territoryCards]);
}

function drawSpiceCard(state) {
  if (state.decks.spiceDeck.length === 0) {
    state.decks.spiceDeck = reshuffle(state.decks.spiceDiscard);
    state.decks.spiceDiscard = [];
  }
  return state.decks.spiceDeck.pop();
}

function reshuffle(array) {
  const result = array.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Resolves a single pile (A or B) for one Spice Blow phase. Returns whether
// this pile's resolution triggered a Nexus, per the rulebook's rule that a
// worm drawn after turn 1 causes a Nexus at the end of the phase.
function resolvePile(state, pileKey) {
  const isFirstTurn = state.meta.turn === 1;
  const setAsideWorms = [];
  let triggeredNexus = false;

  while (true) {
    const card = drawSpiceCard(state);
    if (!card) break; // deck exhausted mid-resolution, edge case, stop rather than loop forever

    if (card.type === 'shaiHulud') {
      if (isFirstTurn) {
        // Turn 1 exception: worms are set aside entirely, no devour, no Nexus,
        // reshuffled back into the deck once the whole phase ends.
        setAsideWorms.push(card);
        continue;
      }

      devourTopOfPile(state, pileKey);
      state.decks[`spiceDiscard${pileKey}`].push(card);
      triggeredNexus = true;
      continue; // keep drawing until a territory card appears
    }

    // Territory card: place spice (unless the territory's sector is in
    // storm, per the rulebook, but sector/storm state isn't final yet).
    placeSpiceBlow(state, card, pileKey);
    state.decks[`spiceDiscard${pileKey}`].push(card);
    break; // this pile is done for the phase
  }

  return { triggeredNexus, setAsideWorms };
}

function placeSpiceBlow(state, territoryCard, pileKey) {
  // TODO: skip placement (card still discards, just no spice) if this
  // territory's spice-blow sector is currently in storm. Needs sector data.
  state.board.spiceBlowMarkers.push({
    territoryId: territoryCard.id,
    amount: territoryCard.maxValue,
    pile: pileKey,
    turn: state.meta.turn
  });
}

function devourTopOfPile(state, pileKey) {
  const discard = state.decks[`spiceDiscard${pileKey}`];
  const topCard = discard[discard.length - 1];
  if (!topCard || topCard.type !== 'territory') return; // nothing to devour yet, empty pile

  // Remove spice at that territory back to the bank.
  state.board.spiceBlowMarkers = state.board.spiceBlowMarkers.filter(
    marker => marker.territoryId !== topCard.id
  );

  // Remove all forces present in that territory to the Tleilaxu Tanks,
  // EXCEPT Fremen forces, which are protected and may ride the worm.
  // TODO: implement the actual "ride the worm" relocation choice, this
  // just protects Fremen forces from removal for now rather than moving them.
  for (const factionId of Object.keys(state.factions)) {
    if (factionId === 'fremen') continue;
    const faction = state.factions[factionId];
    const forcesHere = faction.forces.onBoard[topCard.id];
    if (forcesHere) {
      faction.revivalTanks = (faction.revivalTanks ?? 0) + forcesHere;
      delete faction.forces.onBoard[topCard.id];
    }
  }
}

function resolveSpiceBlowPhase(state) {
  const resultA = resolvePile(state, 'A');
  const resultB = resolvePile(state, 'B');

  const allSetAsideWorms = [...resultA.setAsideWorms, ...resultB.setAsideWorms];
  if (allSetAsideWorms.length > 0) {
    // Turn 1 only: reshuffle the set-aside worms back into the deck now
    // that the phase is over.
    state.decks.spiceDeck = reshuffle([...state.decks.spiceDeck, ...allSetAsideWorms]);
  }

  state.nexus.active = resultA.triggeredNexus || resultB.triggeredNexus;
  return state;
}

module.exports = {
  buildSpiceDeck,
  drawSpiceCard,
  resolvePile,
  resolveSpiceBlowPhase,
  placeSpiceBlow,
  devourTopOfPile
};
