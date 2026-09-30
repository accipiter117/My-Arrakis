// js/advisors.js
//
// Bene Gesserit advisors (base game, advanced; GF9 rulebook). Bene Gesserit
// forces in a territory are either all fighters or all advisors.
//
//   Advisors coexist with every other faction: they collect no spice, never
//   fight, do not count for stronghold control or the two-faction stronghold
//   limit, give no ornithopter access and cannot set off Family Atomics. They
//   still suffer storms, sandworms, Lasgun/Shield explosions and atomics.
//   Spiritual advisor: when another faction ships from off-planet, 1 free force
//   may go to the Polar Sink or, as an advisor, to that same territory (those
//   cannot turn to fighters this turn unless no other forces are there).
//   Moving advisors into an empty territory turns them into fighters; into an
//   occupied one they may stay advisors or become fighters. Moving into a
//   territory where Bene Gesserit already stand, they take that group's type.
//   Intrusion: when another (non-allied) faction ships or moves into a territory
//   where Bene Gesserit have fighters, they may turn them into advisors.
//   Battle: after the Spice Blow and Nexus, before any shipment, advisors may be
//   turned into fighters to fight where they stand.
//   Universal Stewards: advisors alone in a territory before the Battle phase
//   become fighters.
//
// state.factions.gesserit.forces.advisorTerritories: territories holding advisors.
// state.factions.gesserit.forces.advisorLock: { territoryId: turn } (arrived this turn).

const bg = state => state.factions.gesserit;

export function isAdvisorTerritory(state, t) {
  return Boolean(bg(state)?.forces.advisorTerritories?.includes(t));
}

// Forces that count for presence (battles, control, spice): advisors do not.
export function fighters(state, factionId, t) {
  const n = state.factions[factionId]?.forces.onBoard[t] ?? 0;
  return factionId === 'gesserit' && isAdvisorTerritory(state, t) ? 0 : n;
}

export function setAdvisors(state, t, on) {
  const fx = bg(state)?.forces;
  if (!fx) return;
  const list = new Set(fx.advisorTerritories ?? []);
  if (on && (fx.onBoard[t] ?? 0) > 0) list.add(t); else list.delete(t);
  fx.advisorTerritories = [...list];
}

// Other factions' forces (any) in a territory.
export const othersIn = (state, t) => Object.entries(state.factions).filter(([f, x]) => f !== 'gesserit' && (x.forces.onBoard[t] ?? 0) > 0).map(([f]) => f);

// Drop advisor marks where no Bene Gesserit forces remain.
export function cleanAdvisors(state) {
  const fx = bg(state)?.forces;
  if (!fx?.advisorTerritories) return;
  fx.advisorTerritories = fx.advisorTerritories.filter(t => (fx.onBoard[t] ?? 0) > 0);
}

// Spiritual advisor sent with another faction's shipment into territory t.
export function sendAdvisor(state, t) {
  const fx = bg(state).forces;
  const hadFighters = (fx.onBoard[t] ?? 0) > 0 && !isAdvisorTerritory(state, t);
  fx.reserve -= 1;
  fx.onBoard[t] = (fx.onBoard[t] ?? 0) + 1;
  if (!hadFighters) {
    setAdvisors(state, t, true);
    (fx.advisorLock ??= {})[t] = state.meta.turn;
  }
}

// After a Bene Gesserit move: settle the type at both ends. wantAdvisors is the
// player's choice for a new group entering an occupied territory.
export function afterMove(state, from, to, { destHadBg, destWasAdvisor, movingWereAdvisors, wantAdvisors }) {
  cleanAdvisors(state);
  if (destHadBg) { setAdvisors(state, to, destWasAdvisor); return; }        // they join the group there
  if (!othersIn(state, to).length) { setAdvisors(state, to, false); return; } // empty: they must be fighters
  setAdvisors(state, to, wantAdvisors ?? movingWereAdvisors);
}

export function lockedThisTurn(state, t) {
  return bg(state)?.forces.advisorLock?.[t] === state.meta.turn && othersIn(state, t).length > 0;
}

// Universal Stewards: advisors alone become fighters (before the Battle phase).
export function universalStewards(state) {
  const flipped = [];
  for (const t of [...(bg(state)?.forces.advisorTerritories ?? [])]) {
    if (!othersIn(state, t).length) { setAdvisors(state, t, false); flipped.push(t); }
  }
  return flipped;
}
