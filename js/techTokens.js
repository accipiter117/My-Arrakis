// js/techTokens.js
//
// The Tech Tokens variant (Ixians & Tleilaxu rulebook, p.4-5; expansion plan M4).
// Three public tokens: Axlotl Tanks (Revival), Heighliners (Shipment and
// Movement) and Spice Production (CHOAM Charity).
//
//   Assignment: Tleilaxu take Axlotl Tanks, Ixians Heighliners, Fremen Spice
//   Production. Any token whose default owner is absent is dealt at random,
//   after the first storm, to factions without a token in turn order.
//   Income: when at least one faction (the owner included) triggers a token's
//   phase, its owner collects 1 spice from the Bank per token they control,
//   once per phase. It does not pay if the only trigger is the token's
//   excluded faction (Tleilaxu, Guild, Bene Gesserit respectively).
//   Transfer: beating a faction in battle takes one of its tokens (winner's choice).
//   Victory: one faction holding all three counts as one stronghold.
//
// state.techTokens = { axlotl: { owner, triggeredBy: [] }, ... } or absent
// when the variant is off. Plain arrays, not Sets, so saves stay JSON.

export const TECH_TOKENS = ['axlotl', 'heighliner', 'spiceProd'];
export const TOKEN_NAMES = { axlotl: 'Axlotl Tanks', heighliner: 'Heighliners', spiceProd: 'Spice Production' };
export const TOKEN_PHASE = { axlotl: 'revival', heighliner: 'shipment', spiceProd: 'charity' };
export const TOKEN_EXCLUDED = { axlotl: 'tleilaxu', heighliner: 'guild', spiceProd: 'gesserit' };
export const DEFAULT_OWNER = { axlotl: 'tleilaxu', heighliner: 'ixians', spiceProd: 'fremen' };
// The pseudo-stronghold id used in victory counting for a full set.
export const TECH_STRONGHOLD = 'techTokens';

// rulesConfig.expansions.techTokens: 'on' (the project owner's default: every
// game), 'auto' (only when the Ixians or Tleilaxu are seated), or 'off'.
export function techTokensWanted(rulesConfig, factionIds) {
  const mode = rulesConfig?.expansions?.techTokens ?? 'on';
  if (mode === true || mode === 'on') return true;
  if (mode === false || mode === 'off') return false;
  return factionIds.includes('ixians') || factionIds.includes('tleilaxu');
}

export function techTokensActive(state) { return Boolean(state.techTokens); }

// At setup: default owners take their tokens now; the rest wait for the first storm.
export function initTechTokens(state) {
  state.techTokens = {};
  for (const t of TECH_TOKENS) {
    const owner = state.factions[DEFAULT_OWNER[t]] ? DEFAULT_OWNER[t] : null;
    state.techTokens[t] = { owner, triggeredBy: [] };
  }
  state.meta.techTokensAssigned = TECH_TOKENS.every(t => state.techTokens[t].owner);
  return state;
}

// After the first storm: unowned tokens, shuffled, go one each to factions
// without a token, in turn order from the First Player. If tokens remain
// once every faction holds one (two-player games), dealing carries on round
// the table in the same order (project owner's decision), so every token
// always has an owner.
export function assignRemainingTechTokens(state, order, rng = Math.random) {
  if (!state.techTokens || state.meta.techTokensAssigned) return [];
  const unassigned = TECH_TOKENS.filter(t => !state.techTokens[t].owner);
  for (let i = unassigned.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [unassigned[i], unassigned[j]] = [unassigned[j], unassigned[i]];
  }
  const holders = new Set(TECH_TOKENS.map(t => state.techTokens[t].owner).filter(Boolean));
  const dealt = [];
  const seated = order.filter(f => state.factions[f]);
  for (const f of seated) {
    if (!unassigned.length) break;
    if (holders.has(f)) continue;
    const t = unassigned.shift();
    state.techTokens[t].owner = f;
    holders.add(f);
    dealt.push({ token: t, factionId: f });
  }
  for (let i = 0; unassigned.length && seated.length; i++) {
    const f = seated[i % seated.length], t = unassigned.shift();
    state.techTokens[t].owner = f;
    dealt.push({ token: t, factionId: f });
  }
  state.meta.techTokensAssigned = true;
  return dealt;
}

export function tokensOwnedBy(state, factionId) {
  if (!state.techTokens) return [];
  return TECH_TOKENS.filter(t => state.techTokens[t].owner === factionId);
}

export function ownsAllTechTokens(state, factionId) {
  return Boolean(state.techTokens) && TECH_TOKENS.every(t => state.techTokens[t].owner === factionId);
}

// A faction triggered a token's phase (took free revival, shipped from
// off-planet, took CHOAM Charity).
export function recordTrigger(state, token, factionId) {
  const t = state.techTokens?.[token];
  if (!t) return;
  if (!t.triggeredBy.includes(factionId)) t.triggeredBy.push(factionId);
}

// What a token will pay at the end of its phase, given the triggers so far
// (0 if nothing pays). Shown as "spice on the token" during the phase.
export function pendingIncome(state, token) {
  const t = state.techTokens?.[token];
  if (!t || !t.owner || !state.factions[t.owner] || !t.triggeredBy.length) return 0;
  if (t.triggeredBy.every(f => f === TOKEN_EXCLUDED[token])) return 0;
  return tokensOwnedBy(state, t.owner).length;
}

// End of a phase: pay every token of that phase from the Bank, then clear
// its triggers. Returns the payments made.
export function payTechTokens(state, phase) {
  if (!state.techTokens) return [];
  const paid = [];
  for (const token of TECH_TOKENS) {
    if (TOKEN_PHASE[token] !== phase) continue;
    const t = state.techTokens[token];
    const amount = pendingIncome(state, token);
    const triggeredBy = [...t.triggeredBy];
    t.triggeredBy = [];
    if (!amount) continue;
    state.factions[t.owner].spice += amount;
    state.spiceBank.totalInCirculation -= amount;
    paid.push({ token, factionId: t.owner, amount, triggeredBy });
  }
  return paid;
}

// Battle: the winner takes one token from the loser (their choice if several).
export function transferTechToken(state, fromId, toId, token) {
  const t = state.techTokens?.[token];
  if (!t || t.owner !== fromId) return null;
  t.owner = toId;
  return { token, from: fromId, to: toId };
}

// AI default: complete our own set if this token would; else the token whose
// phase comes up soonest in the turn; else Heighliners.
const PHASE_SEQUENCE = ['charity', 'revival', 'shipment'];
export function defaultTokenChoice(state, factionId, options) {
  if (options.length === 1) return options[0];
  const mine = tokensOwnedBy(state, factionId);
  const completes = options.find(t => mine.length + 1 === TECH_TOKENS.length && !mine.includes(t));
  if (completes) return completes;
  const next = PHASE_SEQUENCE.map(p => options.find(t => TOKEN_PHASE[t] === p)).find(Boolean);
  return next ?? (options.includes('heighliner') ? 'heighliner' : options[0]);
}
