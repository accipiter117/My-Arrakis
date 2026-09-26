// js/ai/diplomacy.js
//
// Step 7 of docs/AI_PLAN.md: alliances. Scores a possible partner using
// public information only (strongholds held, alliances, the public record
// of betrayals) plus the faction's own secrets (Bene Gesserit's prediction).
//
// Principles from the research (AI_PLAN.md s1): ally for a clear path to the
// shared 4-stronghold win or to stop a runaway leader; beware partners who
// would become the next threat; break an alliance only when it clearly pays.

import { random } from '../random.js';

// Abilities that work well together (order-independent pairs).
const COMPLEMENT = {
  'fremen+guild': 3, 'emperor+harkonnen': 2, 'atreides+emperor': 2, 'atreides+fremen': 2,
  'emperor+guild': 2, 'atreides+gesserit': 1, 'fremen+gesserit': 1, 'gesserit+harkonnen': 1,
  'guild+harkonnen': 1, 'atreides+guild': 1
};

export function createDiplomacy({ rng = random } = {}) {
  const strongholds = state => Object.keys(state.board.territories).filter(id => state.board.territories[id].type === 'stronghold');
  const held = (state, f) => strongholds(state).filter(t => (state.factions[f]?.forces.onBoard[t] ?? 0) > 0);
  const allyOf = (state, f) => (state.alliances ?? []).find(a => a.factions.includes(f))?.factions.find(x => x !== f) ?? null;

  function partnerScore(state, me, partner) {
    const maxTurns = state.rulesConfig.victoryVariants.maxTurns;
    const mine = held(state, me), theirs = held(state, partner);
    const combined = new Set([...mine, ...theirs]).size;
    let score = 0;

    // A path to the shared 4-stronghold alliance victory.
    score += combined >= 3 ? 5 : combined * 1.2;
    score += COMPLEMENT[[me, partner].sort().join('+')] ?? 0;

    // Unite against a runaway leader (someone else on 2+ strongholds).
    const runaway = Object.keys(state.factions).some(f => f !== me && f !== partner && held(state, f).length >= 2);
    if (runaway) score += 2.5;

    // A partner far stronger than me becomes the next threat.
    if (theirs.length - mine.length >= 2) score -= 2;

    // Late game, the special winners' victories are shared with an ally.
    if (state.meta.turn >= maxTurns - 2 && (partner === 'guild' || partner === 'fremen')) score += 2;

    // Bene Gesserit: ally with the faction it secretly predicted.
    if (me === 'gesserit' && state.factions.gesserit.specialFactionState?.prediction?.factionId === partner) score += 3;

    // About to win alone: an alliance would raise the bar to 4.
    if (mine.length >= 2) score -= 3;

    // Trust: a record of breaking alliances counts against them.
    score -= 3 * (state.meta.betrayals ?? []).filter(b => b.by === partner).length;

    return score + rng() * 1.5;
  }

  return {
    partnerScore,

    propose(state, me) {
      const candidates = Object.keys(state.factions).filter(f => f !== me && !allyOf(state, f));
      let best = null;
      for (const f of candidates) {
        const score = partnerScore(state, me, f);
        if (!best || score > best.score) best = { f, score };
      }
      return best && best.score >= 4 ? best.f : null;
    },

    respond(state, me, proposer) {
      return partnerScore(state, me, proposer) >= 3;
    },

    // Break only when it clearly pays. The classic Dune betrayal: alone I need
    // 3 strongholds, allied we need 4. Holding 2 myself while the alliance
    // is still short of 4 is the moment to go it alone (not every time, so
    // it stays hard to read). Otherwise, break only a clearly useless alliance.
    shouldBreak(state, me, ally) {
      const mine = held(state, me).length;
      const combined = new Set([...held(state, me), ...held(state, ally)]).size;
      if (mine >= 2 && combined < 4 && state.meta.turn >= 3 && rng() < 0.5) return true;
      return partnerScore(state, me, ally) < -1.5;
    }
  };
}
