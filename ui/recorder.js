// ui/recorder.js
//
// Records a match for the export, so games can be reviewed afterwards to find
// rule errors and tune the AI. Kept inside every save, so resumed games carry
// their record on. Five parts:
//   events    every game event (turn, phase, type, details), including hidden
//             details the table could not see (No-Field values, Black Market
//             cards), plus each phase's raw result.
//   turns     an end-of-turn snapshot per faction: spice, forces by territory,
//             reserve, tanks, hand size, leaders, strongholds, Tech Tokens.
//   phases    spice change per faction per phase (where income came from and
//             where it went).
//   ai        every AI decision: what was asked, what it chose, and its stated
//             reason or battle estimate (win chance, traitor risk).
//   start     each faction's starting totals, for the conservation checks.
// summarise() builds the summary stats, hidden-information reveal and checks at
// export time.

const RECORD_VERSION = 1;
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// Keep AI inputs and outputs readable: drop the game state, cap long arrays.
function compact(v, depth = 0) {
  if (v === null || v === undefined || typeof v !== 'object') return v;
  if (v.factions && v.meta && v.board) return '[state]';
  if (depth > 3) return '[…]';
  if (Array.isArray(v)) return v.length > 20 ? [...v.slice(0, 20).map(x => compact(x, depth + 1)), `…+${v.length - 20}`] : v.map(x => compact(x, depth + 1));
  const out = {};
  for (const [k, x] of Object.entries(v)) if (typeof x !== 'function') out[k] = compact(x, depth + 1);
  return out;
}

const forceTotal = f => f.forces.reserve + (f.revivalTanks ?? 0) + Object.values(f.forces.onBoard).reduce((a, b) => a + b, 0);

export function createRecorder(saved = null) {
  const rec = saved?.version === RECORD_VERSION ? saved : { version: RECORD_VERSION, start: null, events: [], turns: [], phases: [], ai: [] };

  const where = state => ({ turn: state?.meta?.turn ?? null, phase: state?.meta?.phase ?? null });

  return {
    data: rec,

    // At the start of a game.
    start(state, info = {}) {
      rec.start = {
        ...info,
        factions: Object.fromEntries(Object.entries(state.factions).map(([f, x]) => [f, {
          forces: forceTotal(x), leaders: x.leaders.available.length + x.leaders.killed.length, spice: x.spice }])),
        cardsInPlay: state.decks.treacheryDeck.length + state.decks.treacheryDiscard.length
          + Object.values(state.factions).reduce((n, x) => n + x.treacheryHand.length, 0) + (state.factions.richese?.cache?.length ?? 0)
      };
    },

    // Every engine event, with the hidden detail it carries.
    event(e, state) {
      const entry = { ...where(state), ...clone(e) };
      // A No-Field token placed: note its real value (only the export sees it).
      if (e.type === 'shipment' && e.noField && state?.factions?.richese?.noField?.onPlanet) entry.noFieldValue = state.factions.richese.noField.onPlanet.value;
      rec.events.push(entry);
    },

    // Around each phase: spice before, and the phase's result after.
    spiceNow(state) { return Object.fromEntries(Object.entries(state.factions).map(([f, x]) => [f, x.spice])); },
    phase(entry, before, state) {
      const delta = {};
      for (const [f, x] of Object.entries(state.factions)) { const d = x.spice - (before?.[f] ?? x.spice); if (d) delta[f] = d; }
      rec.phases.push({ turn: entry.turn, phase: entry.phase, spice: delta });
      if (entry.result !== undefined && entry.result !== null) rec.events.push({ turn: entry.turn, phase: entry.phase, type: 'phaseResult', result: clone(entry.result) });
      if (entry.phase === 'mentatPause' || state.victory?.achieved) this.snapshotTurn(state, entry.turn);
    },

    snapshotTurn(state, turn = state.meta.turn) {
      if (rec.turns.some(t => t.turn === turn)) return;
      const strongholds = Object.entries(state.board.territories).filter(([, t]) => t.type === 'stronghold').map(([id]) => id);
      rec.turns.push({
        turn,
        alliances: clone(state.alliances ?? []),
        // Negotiation: spice still in front of shields, and every promise with its status.
        negotiation: state.negotiation ? { held: clone(state.negotiation.held), promises: clone(state.negotiation.promises) } : null,
        techTokens: state.techTokens ? Object.fromEntries(Object.entries(state.techTokens).map(([t, v]) => [t, v.owner])) : null,
        factions: Object.fromEntries(Object.entries(state.factions).map(([f, x]) => [f, {
          spice: x.spice, reserve: x.forces.reserve, tanks: x.revivalTanks ?? 0, onBoard: clone(x.forces.onBoard),
          strongholds: strongholds.filter(id => (x.forces.onBoard[id] ?? 0) > 0),
          hand: x.treacheryHand.length, leadersAlive: x.leaders.available.length, leadersDead: x.leaders.killed.length
        }]))
      });
    },

    // Wrap an AI decision maker so each choice is recorded with its reasoning.
    wrapAI(ai, getState) {
      const record = (method, args, result) => {
        const state = getState();
        const factionId = typeof args[1] === 'string' ? args[1] : null;
        const out = compact(result);
        const entry = { ...where(state), factionId, method, input: compact(args.slice(2)), output: out };
        if (result && typeof result === 'object') {
          if (result.reason) entry.reason = result.reason;
          if (result._ai) entry.estimate = result._ai;
        }
        rec.ai.push(entry);
      };
      const wrapped = {};
      for (const [k, fn] of Object.entries(ai)) {
        if (typeof fn !== 'function' || !k.startsWith('choose')) { wrapped[k] = fn; continue; }
        wrapped[k] = (...args) => {
          const r = fn.apply(ai, args);
          if (r && typeof r.then === 'function') return r.then(v => { record(k, args, v); return v; });
          record(k, args, r);
          return r;
        };
      }
      return wrapped;
    }
  };
}

// --- Summary, hidden-information reveal and checks, built at export time -------------

export function summarise(rec, state, cardLookup = {}) {
  const factions = Object.keys(state.factions);
  const phaseLabel = { spiceCollection: 'collection', charity: 'charity', bidding: 'bidding (buys and sales)', revival: 'revival',
    shipment: 'shipment and movement', battle: 'battle', storm: 'storm', spiceBlow: 'spice blow', mentatPause: 'mentat pause', nexus: 'nexus' };

  // Spice by phase: income and spending per faction.
  const spice = Object.fromEntries(factions.map(f => [f, { earned: {}, spent: {}, net: 0 }]));
  for (const p of rec.phases) for (const [f, d] of Object.entries(p.spice)) {
    const s = spice[f]; if (!s) continue;
    const label = phaseLabel[p.phase] ?? p.phase;
    if (d > 0) s.earned[label] = (s.earned[label] ?? 0) + d; else s.spent[label] = (s.spent[label] ?? 0) - d;
    s.net += d;
  }

  // Battles: wins, losses, traitors; forces and cards committed.
  const battles = Object.fromEntries(factions.map(f => [f, { fought: 0, won: 0, lost: 0, forcesDialled: 0, spiceOnForces: 0, cardsPlayed: [] }]));
  const battleLog = [];
  for (const e of rec.events) {
    if (e.type !== 'phaseResult' || e.phase !== 'battle' || !Array.isArray(e.result)) continue;
    for (const b of e.result) {
      const winner = b.winnerFactionId ?? b.winner ?? null;
      const sides = [b.aggressorId, b.defenderId].filter(Boolean);
      battleLog.push({ turn: e.turn, territoryId: b.territoryId, aggressorId: b.aggressorId, defenderId: b.defenderId, winner, plans: b.plans ?? null,
        traitor: Boolean(b.traitorCard), faceDancer: Boolean(b.faceDancer) });
      for (const f of sides) {
        const s = battles[f]; if (!s) continue;
        s.fought++; if (winner === f) s.won++; else if (winner) s.lost++;
        const p = b.plans?.[f];
        if (p) { s.forcesDialled += p.forces ?? 0; s.spiceOnForces += p.spice ?? 0; for (const c of [p.weapon, p.defense]) if (c) s.cardsPlayed.push(c); }
      }
    }
  }

  // AI battle estimates against what happened.
  const estimates = rec.ai.filter(a => a.method === 'chooseBattlePlan' && a.estimate).map(a => {
    const territoryId = a.input?.[0];
    const b = battleLog.find(x => x.turn === a.turn && x.territoryId === territoryId && [x.aggressorId, x.defenderId].includes(a.factionId));
    return { turn: a.turn, factionId: a.factionId, territoryId, predictedWin: a.estimate.winChance, traitorRisk: a.estimate.traitorRisk, won: b ? b.winner === a.factionId : null };
  });
  const judged = estimates.filter(e => e.won !== null);
  const calibration = judged.length ? {
    battles: judged.length,
    averagePredicted: Math.round(judged.reduce((n, e) => n + e.predictedWin, 0) / judged.length * 100) / 100,
    actualWinRate: Math.round(judged.filter(e => e.won).length / judged.length * 100) / 100
  } : null;

  // Cards: bought, still held at the end (Karamas especially).
  const held = Object.fromEntries(factions.map(f => [f, state.factions[f].treacheryHand.map(id => cardLookup[id]?.name ?? id)]));
  const karamaUnused = Object.fromEntries(factions.map(f => [f, state.factions[f].treacheryHand.filter(id => id.startsWith('karama')).length]).filter(([, n]) => n));

  // Hidden information, revealed.
  const reveal = {
    traitors: Object.fromEntries(factions.map(f => [f, state.factions[f].traitorHand ?? []]).filter(([, t]) => t.length)),
    faceDancers: state.factions.tleilaxu?.faceDancers ?? null,
    prediction: state.factions.gesserit?.specialFactionState?.prediction ?? null,
    noFieldPlacements: rec.events.filter(e => e.type === 'shipment' && e.noField).map(e => ({ turn: e.turn, territoryId: e.territoryId, value: e.noFieldValue ?? null })),
    blackMarket: rec.events.filter(e => e.type === 'blackMarketStart').map(e => ({ turn: e.turn, claimed: e.claimId, actual: e.cardId, method: e.method })),
    audits: state.factions.choam?.specialFactionState?.audits ?? null,
    richeseCacheLeft: state.factions.richese?.cache ?? null
  };

  // Conservation checks: every troop, leader and card still accounted for.
  const checks = [];
  if (rec.start) {
    for (const f of factions) {
      const x = state.factions[f], s = rec.start.factions[f];
      if (!s) continue;
      if (forceTotal(x) !== s.forces) checks.push(`${f}: ${forceTotal(x)} forces, started with ${s.forces}`);
    }
    const leadersNow = factions.reduce((n, f) => n + state.factions[f].leaders.available.length + state.factions[f].leaders.killed.length, 0);
    const leadersStart = Object.values(rec.start.factions).reduce((n, s) => n + s.leaders, 0);
    if (leadersNow !== leadersStart) checks.push(`leaders: ${leadersNow}, started with ${leadersStart}`);
    const cardsNow = state.decks.treacheryDeck.length + state.decks.treacheryDiscard.length + factions.reduce((n, f) => n + state.factions[f].treacheryHand.length, 0)
      + (state.factions.richese?.cache?.length ?? 0) + (state.decks.removedFromGame?.length ?? 0);
    if (cardsNow !== rec.start.cardsInPlay) checks.push(`treachery cards: ${cardsNow}, started with ${rec.start.cardsInPlay}`);
  }

  return {
    spice, battles, battleLog, aiBattleCalibration: calibration, aiBattleEstimates: estimates, cardsHeldAtEnd: held, karamaUnused, reveal,
    checks: { passed: checks.length === 0, problems: checks, recordedFrom: rec.start ? 'game start' : 'mid-game (older save): conservation not checked' },
    counts: { events: rec.events.length, aiDecisions: rec.ai.length, turnsSnapshotted: rec.turns.length }
  };
}
