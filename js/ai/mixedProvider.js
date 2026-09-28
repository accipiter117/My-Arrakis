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
    chooseTruthtrance: (state, f, t, o) => (f === humanFactionId ? null : ai.chooseTruthtrance?.(state, f, t, o) ?? null), // the human asks from their Hand
    chooseKaramaCancel: (state, f, purpose, ctx) => pick(f).chooseKaramaCancel(state, f, purpose, ctx),
    chooseAllyPledge: (state, f, ally) => pick(f).chooseAllyPledge(state, f, ally),
    chooseEmperorAllyRevival: (state, f, ally) => pick(f).chooseEmperorAllyRevival(state, f, ally),
    chooseAdvisor: (state, f, shipper) => pick(f).chooseAdvisor(state, f, shipper),
    choosePoisonToothUse: (state, f, ...rest) => pick(f).choosePoisonToothUse(state, f, ...rest),
    chooseThumper: (state, f) => pick(f).chooseThumper(state, f),
    chooseRevealFaceDancer: (state, f, info) => pick(f).chooseRevealFaceDancer(state, f, info),
    chooseIxianStartingCard: (state, f, ids) => pick(f).chooseIxianStartingCard(state, f, ids),
    chooseIxianTechnology: (state, f, c) => pick(f).chooseIxianTechnology(state, f, c),
    chooseSuboidExchange: (state, f, info) => pick(f).chooseSuboidExchange(state, f, info),
    chooseEarlyLeaderRevival: (state, f) => pick(f).chooseEarlyLeaderRevival(state, f),
    chooseLeaderRevivalPrice: (state, f, info) => pick(f).chooseLeaderRevivalPrice(state, f, info),
    chooseAcceptLeaderRevivalPrice: (state, f, info) => pick(f).chooseAcceptLeaderRevivalPrice(state, f, info),
    chooseGholaRevival: (state, f, options) => pick(f).chooseGholaRevival(state, f, options),
    chooseHmsPlacement: (state, f, sites) => pick(f).chooseHmsPlacement(state, f, sites),
    chooseHmsMove: (state, f, reachable) => pick(f).chooseHmsMove(state, f, reachable),
    chooseIxianBury: (state, f, ids) => pick(f).chooseIxianBury(state, f, ids),
    chooseIxianAllySwap: (state, f, cardId) => pick(f).chooseIxianAllySwap(state, f, cardId),
    chooseFaceDancerToReplace: (state, f, ids) => pick(f).chooseFaceDancerToReplace(state, f, ids),
    chooseIncreaseRevivalLimit: (state, f, info) => pick(f).chooseIncreaseRevivalLimit(state, f, info),
    chooseHarvester: (state, f, blows) => pick(f).chooseHarvester(state, f, blows),
    chooseAmal: (state, f) => pick(f).chooseAmal(state, f),
    chooseGuildTiming: (state, others) => pick('guild').chooseGuildTiming(state, others),
    chooseFremenPlacement: (state, f) => pick(f).chooseFremenPlacement(state, f),
    chooseTechTokenToTake: (state, f, options, from) => pick(f).chooseTechTokenToTake(state, f, options, from),
    chooseChoamDiscards: (state, f, info) => pick(f).chooseChoamDiscards(state, f, info),
    chooseChoamEffect: (state, f, info) => pick(f).chooseChoamEffect(state, f, info),
    chooseInflation: (state, f) => pick(f).chooseInflation(state, f),
    chooseCancelAudit: (state, f, info) => pick(f).chooseCancelAudit(state, f, info),
    chooseChoamAllyTrade: (state, f, ally) => pick(f).chooseChoamAllyTrade(state, f, ally),
    chooseChoamAllyTradeResponse: (state, f, info) => pick(f).chooseChoamAllyTradeResponse(state, f, info),
    chooseChoamBattleSupport: (state, f, info) => pick(f).chooseChoamBattleSupport(state, f, info),
    // Diplomacy: each faction decides for itself, human or AI.
    chooseBreakAlliance: (state, factionId, ally) => pick(factionId).chooseBreakAlliance(state, factionId, ally),
    chooseAllianceProposal: (state, factionId) => pick(factionId).chooseAllianceProposal(state, factionId),
    chooseAllianceResponse: (state, factionId, proposer) => pick(factionId).chooseAllianceResponse(state, factionId, proposer),
    // The holder of the traitor card decides (for an ally, that's Harkonnen).
    chooseRevealTraitor: (state, holder, leaderId, territoryId, againstId, forFaction) =>
      pick(holder).chooseRevealTraitor(state, holder, leaderId, territoryId, againstId, forFaction)
  };
}
