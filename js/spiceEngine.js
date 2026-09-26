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

import { random } from './random.js';
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
    // Advanced rules use two discard piles (A and B). An earlier version
    // reshuffled a single 'spiceDiscard' pile that no longer exists, which
    // crashed the first time the deck ran dry (around turn 8). Only caught
    // by running a long game in a real browser.
    const discards = [...(state.decks.spiceDiscardA ?? []), ...(state.decks.spiceDiscardB ?? [])];
    state.decks.spiceDeck = reshuffle(discards);
    state.decks.spiceDiscardA = [];
    state.decks.spiceDiscardB = [];
  }
  return state.decks.spiceDeck.pop();
}

function reshuffle(array) {
  const result = array.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
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
        (state.nexus.draws ??= []).push({ pile: pileKey, kind: 'wormSetAside' });
        continue;
      }

      const discard = state.decks[`spiceDiscard${pileKey}`];
      const top = discard[discard.length - 1];
      (state.nexus.draws ??= []).push({ pile: pileKey, kind: 'worm', devoured: top?.type === 'territory' ? top.id : null });
      devourTopOfPile(state, pileKey);
      state.decks[`spiceDiscard${pileKey}`].push(card);
      triggeredNexus = true;
      continue; // keep drawing until a territory card appears
    }

    // Territory card: place spice (unless the territory's sector is in
    // storm, per the rulebook, but sector/storm state isn't final yet).
    placeSpiceBlow(state, card, pileKey);
    (state.nexus.draws ??= []).push({ pile: pileKey, kind: 'territory', territoryId: card.id, amount: card.maxValue });
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
  // Record where the worm struck: Fremen there may ride it after the Nexus.
  state.nexus.wormTerritories = [...(state.nexus.wormTerritories ?? []), topCard.id];
  // Fremen are never eaten, and neither is the Fremen's ally (who can't ride).
  const fremenAlly = (state.alliances ?? []).find(a => a.factions.includes('fremen'))?.factions.find(f => f !== 'fremen');
  for (const factionId of Object.keys(state.factions)) {
    if (factionId === 'fremen' || factionId === fremenAlly) continue;
    const faction = state.factions[factionId];
    const forcesHere = faction.forces.onBoard[topCard.id];
    if (forcesHere) {
      faction.revivalTanks = (faction.revivalTanks ?? 0) + forcesHere;
      faction.starredRevivalTanks = (faction.starredRevivalTanks ?? 0) + (faction.forces.starredOnBoard?.[topCard.id] ?? 0);
      delete faction.forces.onBoard[topCard.id];
      if (faction.forces.starredOnBoard) delete faction.forces.starredOnBoard[topCard.id];
    }
  }
}

function resolveSpiceBlowPhase(state) {
  state.nexus.wormTerritories = [];
  state.nexus.draws = []; // every card drawn this phase, in order, for presentation
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

export {
  buildSpiceDeck,
  drawSpiceCard,
  resolvePile,
  resolveSpiceBlowPhase,
  placeSpiceBlow,
  devourTopOfPile
};
