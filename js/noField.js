// js/noField.js
//
// Richese No-Field tokens (CHOAM & Richese rulebook, expansion plan M6).
// Three tokens, 0, 3 and 5. When shipping, Richese may pay for one force and
// place a No-Field token face down instead. Until revealed it counts as one
// force for every effect (presence, battles, spice collection, strongholds),
// even the 0. Richese may reveal it at any time before the Battle phase,
// placing that many forces from reserves (fewer if the reserves run short).
// Storm, worm and battle reveal it. Only one may be on the planet; the same
// token cannot be used twice in a row.
//
// Model: the face-down token is ONE real Richese force from reserves standing
// in for it (so every engine that counts forces sees exactly one, and forces
// are conserved). On reveal that force goes back to reserves and the token's
// number of forces comes out instead. The value is private to Richese.
//
// state.factions.richese.noField = { available: [values behind the shield],
//   lastUsed: value face up (or on the planet) | null, onPlanet: { territoryId, value } | null }

export function initNoField(state) {
  const r = state.factions.richese;
  if (r && !r.noField) r.noField = { available: [0, 3, 5], lastUsed: null, onPlanet: null };
}

export const noFieldAt = (state, territoryId) =>
  state.factions.richese?.noField?.onPlanet?.territoryId === territoryId ? state.factions.richese.noField.onPlanet : null;

// Tokens Richese may place now (never the one used last).
export function usableNoFields(state) {
  const nf = state.factions.richese?.noField;
  return nf ? nf.available.slice().sort((a, b) => a - b) : [];
}

// Reveal the token on the planet (if any). Returns { territoryId, value, placed } or null.
export function revealNoField(state) {
  const r = state.factions.richese, nf = r?.noField?.onPlanet;
  if (!nf) return null;
  const t = nf.territoryId;
  // The stand-in force goes home...
  if ((r.forces.onBoard[t] ?? 0) > 0) {
    r.forces.onBoard[t] -= 1;
    if (!r.forces.onBoard[t]) delete r.forces.onBoard[t];
    r.forces.reserve += 1;
  }
  // ...and the token's number of forces comes down from reserves.
  const placed = Math.min(nf.value, r.forces.reserve);
  if (placed) { r.forces.reserve -= placed; r.forces.onBoard[t] = (r.forces.onBoard[t] ?? 0) + placed; }
  r.noField.onPlanet = null;
  return { territoryId: t, value: nf.value, placed };
}

// After Richese has shipped its one stand-in force to territoryId, mark it as the token.
export function placeNoField(state, territoryId, value) {
  const nf = state.factions.richese.noField;
  nf.available = nf.available.filter(v => v !== value);
  if (nf.lastUsed !== null) nf.available.push(nf.lastUsed); // the old face-up token returns behind the shield
  nf.lastUsed = value;
  nf.onPlanet = { territoryId, value };
}

// Richese moved `amount` forces from `from` to `to`: the token goes with the
// group when the whole stack moves (it is one of those forces).
export function noteRicheseMove(state, from, to, amount, stackBefore) {
  const nf = state.factions.richese?.noField?.onPlanet;
  if (nf && nf.territoryId === from && amount >= stackBefore) nf.territoryId = to;
}

// Forces Richese will actually have in a battle territory once its token is revealed.
export function forcesAfterReveal(state, factionId, territoryId) {
  const f = state.factions[factionId];
  const here = f.forces.onBoard[territoryId] ?? 0;
  const nf = factionId === 'richese' ? noFieldAt(state, territoryId) : null;
  if (!nf) return here;
  return here - 1 + Math.min(nf.value, f.forces.reserve + 1);
}

// AI: when Richese ship two or more forces, send the largest usable token
// instead (it costs one force's shipping and brings its full number on reveal).
export function withNoField(state, factionId, decision) {
  const allyOfRichese = (state.alliances ?? []).some(a => a.factions.includes('richese') && a.factions.includes(factionId)) && factionId !== 'richese';
  if (allyOfRichese && decision?.shipment && decision.shipment.noField == null && decision.shipment.amount >= 3) {
    const v = usableNoFields(state).filter(x => x >= 3).pop();
    if (v) return { ...decision, shipment: { ...decision.shipment, noField: v } }; // Richese ships them; falls back to normal if refused
  }
  if (factionId !== 'richese' || !decision?.shipment || decision.shipment.noField != null) return decision;
  const { territoryId, amount } = decision.shipment;
  const best = usableNoFields(state).filter(v => v >= 3).pop();
  if (!best || amount < 2 || state.factions.richese.forces.reserve < 1) return decision;
  return { ...decision, shipment: { territoryId, amount: 1, noField: best } };
}
