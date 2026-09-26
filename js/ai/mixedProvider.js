// js/ai/mixedProvider.js
//
// Routes every decision to whoever controls that faction: the human's
// provider for their faction, the AI provider for everyone else. Both sit
// behind the same decision-provider interface, so the turn engine never
// needs to know which kind of player it is waiting on.

export function createMixedProvider({ humanFactionId, human, ai }) {
  const pick = factionId => (factionId === humanFactionId ? human : ai);

  return {
    name: `${human.name ?? 'Human'} + ${ai.name ?? 'AI'}`,
    chooseStormDial: (state, factionId, isFirst) => pick(factionId).chooseStormDial(state, factionId, isFirst),
    chooseTraitor: (state, factionId, hand) => pick(factionId).chooseTraitor(state, factionId, hand),
    choosePrediction: (state, factionId) => pick(factionId).choosePrediction(state, factionId),
    chooseBid: (state, factionId, cardId, bid) => pick(factionId).chooseBid(state, factionId, cardId, bid),
    chooseRevival: (state, factionId) => pick(factionId).chooseRevival(state, factionId),
    chooseShipmentAndMovement: (state, factionId) => pick(factionId).chooseShipmentAndMovement(state, factionId),
    choosePrescienceElement: (state, factionId, territoryId, opponentId) =>
      pick(factionId).choosePrescienceElement(state, factionId, territoryId, opponentId),
    chooseBattlePlan: (state, factionId, territoryId, opponentId, intel, voice) =>
      pick(factionId).chooseBattlePlan(state, factionId, territoryId, opponentId, intel, voice),
    chooseVoice: (state, factionId, territoryId, targetId) => pick(factionId).chooseVoice(state, factionId, territoryId, targetId),
    chooseCardsToDiscard: (state, factionId, played) => pick(factionId).chooseCardsToDiscard(state, factionId, played),
    chooseCaptureAction: (state, factionId, leaderId, fromId) => pick(factionId).chooseCaptureAction(state, factionId, leaderId, fromId),
    chooseWormRide: (state, factionId, from) => pick(factionId).chooseWormRide(state, factionId, from),

    // The human discards from their Hand sheet whenever they like; only the AI is asked here.
    chooseDiscards: (state, factionId, dead) => (factionId === humanFactionId ? [] : ai.chooseDiscards?.(state, factionId, dead) ?? []),
    // Diplomacy: each faction decides for itself, human or AI.
    chooseBreakAlliance: (state, factionId, ally) => pick(factionId).chooseBreakAlliance(state, factionId, ally),
    chooseAllianceProposal: (state, factionId) => pick(factionId).chooseAllianceProposal(state, factionId),
    chooseAllianceResponse: (state, factionId, proposer) => pick(factionId).chooseAllianceResponse(state, factionId, proposer),
    // The holder of the traitor card decides (for an ally, that's Harkonnen).
    chooseRevealTraitor: (state, holder, leaderId, territoryId, againstId, forFaction) =>
      pick(holder).chooseRevealTraitor(state, holder, leaderId, territoryId, againstId, forFaction)
  };
}
