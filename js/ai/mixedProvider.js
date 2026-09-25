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
    chooseBattlePlan: (state, factionId, territoryId, opponentId, intel) =>
      pick(factionId).chooseBattlePlan(state, factionId, territoryId, opponentId, intel),

    // Alliance decisions are made table-wide at a Nexus. Human diplomacy
    // isn't built yet, so the AI decides for the AI factions only, and any
    // proposal that would drag the human into (or out of) an alliance
    // without their say is dropped.
    async chooseAllianceActions(state) {
      const actions = await ai.chooseAllianceActions(state);
      return {
        form: (actions.form ?? []).filter(pair => !pair.includes(humanFactionId)),
        breakFrom: (actions.breakFrom ?? []).filter(f => f !== humanFactionId)
      };
    }
  };
}
