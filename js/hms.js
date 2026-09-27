// js/hms.js
//
// The Ixians' Hidden Mobile Stronghold. A stronghold territory ('hms') that
// points at a host territory; it is entered only from its host (or shipped
// into directly by the Ixians), counts towards victory, and is immune to
// storm and worms. Each turn, while Ixian forces occupy it, it may move up
// to 3 territories between non-stronghold territories, collecting up to 2
// spice per Ixian force inside from each spice territory it enters.

export function hmsHost(state) { return state.board.hms?.placed ? state.board.hms.territoryId : null; }

// Re-link the HMS to its host in the adjacency data.
export function linkHms(state) {
  const T = state.board.territories;
  if (!T.hms) return;
  for (const t of Object.values(T)) if (t.adjacentDraft?.includes('hms')) t.adjacentDraft = t.adjacentDraft.filter(x => x !== 'hms');
  const host = hmsHost(state);
  T.hms.adjacentDraft = host ? [host] : [];
  if (host) T[host].adjacentDraft = [...T[host].adjacentDraft, 'hms'];
}

export function placeHms(state, territoryId) {
  state.board.hms = { territoryId, placed: true };
  linkHms(state);
}

const inStorm = (state, t) => state.board.territories[t]?.stormSector === state.board.stormPosition;
const hostable = (state, t) => t !== 'hms' && state.board.territories[t] && state.board.territories[t].type !== 'stronghold';

// Where the HMS may be placed at the start: any non-stronghold territory not in storm.
export function hmsSites(state) {
  return Object.keys(state.board.territories).filter(t => hostable(state, t) && !inStorm(state, t));
}

// Every territory reachable in up to 3 steps (never into, out of or through storm), with its path.
export function hmsReachable(state, steps = 3) {
  const start = hmsHost(state);
  if (!start || inStorm(state, start)) return {};
  const prev = { [start]: null }, depth = { [start]: 0 }, queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    if (depth[cur] >= steps) continue;
    for (const n of state.board.territories[cur].adjacentDraft ?? []) {
      if (n in prev || !hostable(state, n) || inStorm(state, n)) continue;
      prev[n] = cur; depth[n] = depth[cur] + 1; queue.push(n);
    }
  }
  const paths = {};
  for (const t of Object.keys(prev)) {
    if (t === start) continue;
    const path = [];
    for (let x = t; x !== null; x = prev[x]) path.unshift(x);
    paths[t] = path;
  }
  return paths;
}

// Move along a path, collecting spice (2 per Ixian force inside) from each spice territory entered.
export function moveHms(state, path) {
  const ix = state.factions.ixians;
  const inside = ix?.forces.onBoard.hms ?? 0;
  let collected = 0;
  for (const t of path.slice(1)) {
    const cap = inside * 2;
    let take = cap;
    for (const m of state.board.spiceBlowMarkers.filter(m => m.territoryId === t)) {
      const n = Math.min(m.amount, take);
      m.amount -= n; take -= n; collected += n;
    }
    state.board.spiceBlowMarkers = state.board.spiceBlowMarkers.filter(m => m.amount > 0);
  }
  ix.spice += collected;
  placeHms(state, path[path.length - 1]);
  return { from: path[0], to: path[path.length - 1], collected };
}
