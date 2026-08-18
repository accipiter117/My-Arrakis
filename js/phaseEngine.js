// phaseEngine.js
// The current phase is a real property on game state (meta.phase), never
// inferred from "what the UI happens to be showing". This module is the
// only thing allowed to advance meta.phase.

const PHASE_ORDER = [
  "setup",
  "storm",
  "spiceBlow",
  "nexus",       // conditionally active, see shouldEnterNexus
  "charity",
  "bidding",
  "revival",
  "shipment",
  "movement",
  "battle",
  "spiceCollection",
  "mentatPause",
  "victoryCheck"
  // loops back to "storm" for the next turn, "setup" only runs once
];

function nextPhase(state) {
  const current = state.meta.phase;
  const idx = PHASE_ORDER.indexOf(current);
  if (idx === -1) {
    throw new Error(`Unknown phase "${current}" — refusing to guess the next one.`);
  }

  // Nexus is conditional: skip it entirely if this turn's spice blow didn't
  // trigger a worm/nexus event, rather than making the UI hide an empty screen.
  let nextIdx = idx + 1;
  if (PHASE_ORDER[nextIdx] === "nexus" && !shouldEnterNexus(state)) {
    nextIdx += 1;
  }

  if (nextIdx >= PHASE_ORDER.length) {
    // End of turn: advance turn counter, loop back to storm (not setup).
    state.meta.turn += 1;
    state.meta.phase = "storm";
  } else {
    state.meta.phase = PHASE_ORDER[nextIdx];
  }

  return state;
}

function shouldEnterNexus(state) {
  return Boolean(state.board.spiceBlowMarkers.some(m => m.triggeredNexus));
}

function currentPhase(state) {
  return state.meta.phase;
}

module.exports = { nextPhase, currentPhase, PHASE_ORDER };
