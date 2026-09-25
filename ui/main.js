// ui/main.js
//
// The whole UI, deliberately minimal per the project's own Phase 2 goal:
// make the engine's real behaviour visible and clickable, catch the kind
// of bug that only shows up when you're staring at a battle going "wait,
// that's not right." Not a finished game, not a rendered board, a
// state inspector with buttons.
//
// Every faction plays through turnEngine.passiveDecisionProvider for now,
// nobody actually decides anything yet, that's the AI layer, separate
// work. This proves the engine runs correctly turn over turn; it is not
// itself an opponent.

import { initializeGame } from '../js/setupEngine.js';
import * as turnEngine from '../js/turnEngine.js';
import * as phaseEngine from '../js/phaseEngine.js';

const ALL_FACTIONS = ['atreides', 'harkonnen', 'emperor', 'fremen', 'guild', 'gesserit'];

const FACTION_DISPLAY = {
  atreides: { name: 'Atreides', colorVar: '--faction-atreides' },
  harkonnen: { name: 'Harkonnen', colorVar: '--faction-harkonnen' },
  emperor: { name: 'Emperor', colorVar: '--faction-emperor' },
  fremen: { name: 'Fremen', colorVar: '--faction-fremen' },
  guild: { name: 'Spacing Guild', colorVar: '--faction-guild' },
  gesserit: { name: 'Bene Gesserit', colorVar: '--faction-gesserit' }
};

const PHASE_LABELS = {
  setup: 'Setup', storm: 'Storm', spiceBlow: 'Spice Blow', nexus: 'Nexus',
  charity: 'Charity', bidding: 'Bidding', revival: 'Revival',
  shipment: 'Shipment', movement: 'Movement', battle: 'Battle',
  spiceCollection: 'Spice Collection', mentatPause: 'Mentat Pause',
  victoryCheck: 'Victory Check'
};

// --- App state ---------------------------------------------------------

let gameState = null;
let territoriesData = null;
let cardLookup = {};
let logEntries = [];

// --- Data loading --------------------------------------------------------

async function loadJSON(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function loadAllData() {
  const [territories, spiceDeck, treacheryDeck, leaders, rulesConfig] = await Promise.all([
    loadJSON('../data/territories.json'),
    loadJSON('../data/spiceDeck.json'),
    loadJSON('../data/treacheryDeck.json'),
    loadJSON('../data/leaders.json'),
    loadJSON('../data/rulesConfig.json')
  ]);

  cardLookup = {};
  for (const card of treacheryDeck.cards) {
    cardLookup[card.id] = card;
  }

  return { territories, spiceDeck, treacheryDeck, leaders, rulesConfig };
}

// --- Game control --------------------------------------------------------

async function startNewGame() {
  setControlsBusy(true);
  try {
    const data = await loadAllData();
    territoriesData = data.territories;

    gameState = initializeGame({
      activeFactionIds: ALL_FACTIONS,
      playerCircleOrder: ALL_FACTIONS,
      rulesConfig: data.rulesConfig,
      spiceDeckData: data.spiceDeck,
      territoriesData: data.territories,
      treacheryDeckData: data.treacheryDeck,
      leadersData: data.leaders,
      rngShuffle: shuffleArray
    });

    // Setup itself isn't a runnable phase, per the rulebook it's a
    // one-time sequence, already applied entirely by initializeGame().
    // Advance straight to the first real phase.
    logEntries = [];
    addLogEntry('setup', 'Game initialized: 6 factions, decks built and dealt.');
    const picks = turnEngine.runTraitorSelection(gameState, turnEngine.passiveDecisionProvider);
    addLogEntry('setup', `Traitors chosen by ${picks.length} factions (Harkonnen keeps all four).`);

    phaseEngine.nextPhase(gameState);
    render();
    document.getElementById('btn-step-phase').disabled = false;
    document.getElementById('btn-run-turn').disabled = false;
  } catch (err) {
    addLogEntry('error', `Failed to start game: ${err.message}`);
    render();
    console.error(err);
  } finally {
    setControlsBusy(false);
  }
}

function stepPhase() {
  if (!gameState || gameState.victory.achieved) return;
  const entry = turnEngine.stepOnePhase(gameState, turnEngine.passiveDecisionProvider, territoriesData, cardLookup);
  describeLogEntry(entry);
  render();
  checkVictory();
}

function runTurn() {
  if (!gameState || gameState.victory.achieved) return;
  const log = turnEngine.runFullTurn(gameState, turnEngine.passiveDecisionProvider, territoriesData, cardLookup);
  for (const entry of log) describeLogEntry(entry);
  render();
  checkVictory();
}

function checkVictory() {
  if (gameState?.victory?.achieved) {
    const winners = gameState.victory.winningFactions.map(f => FACTION_DISPLAY[f]?.name ?? f).join(' & ');
    addLogEntry('victory', `Game over: ${winners} win (${gameState.victory.method}).`);
    document.getElementById('btn-step-phase').disabled = true;
    document.getElementById('btn-run-turn').disabled = true;
    render();
  }
}

function setControlsBusy(busy) {
  document.getElementById('btn-new-game').disabled = busy;
}

function shuffleArray(array) {
  const result = array.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// --- Log formatting --------------------------------------------------

const nameOf = id => FACTION_DISPLAY[id]?.name ?? id;
const territoryNameOf = id => territoriesData?.territories?.[id]?.name ?? id;

function describeLogEntry(entry) {
  const { phase, result, turn } = entry;
  const addLogEntry = (p, text) => logEntries.push({ phase: p, text, turn });
  if (result === null || result === undefined) return; // no-op pass-throughs stay quiet

  switch (phase) {
    case 'storm':
      addLogEntry(phase, `Storm moved ${result.sectorsToMove} sector(s) to sector ${result.newPosition}. Damage not yet applied (awaiting sector data).`);
      return;
    case 'spiceBlow': {
      const text = result.placed.length
        ? result.placed.map(m => `${m.amount} spice in ${territoryNameOf(m.territoryId)}`).join(', ')
        : 'no new spice placed';
      addLogEntry(phase, `Spice blow: ${text}.${result.nexus ? ' Shai-Hulud appeared, a Nexus follows.' : ''}`);
      return;
    }
    case 'charity':
      if (!result.length) return;
      addLogEntry(phase, result.map(r => `${nameOf(r.factionId)} +${r.amountReceived}`).join(', ') + ' spice.');
      return;
    case 'bidding': {
      const sold = result.filter(r => r.winner);
      const unsold = result.find(r => r.unsold);
      const parts = sold.map(r => `${nameOf(r.winner)} bought a card for ${r.price}`);
      if (unsold) parts.push(`a card drew no bids, ending the auction (${unsold.cardsReturned} returned to the deck)`);
      addLogEntry(phase, (parts.join('; ') || 'No auction held') + '.');
      return;
    }
    case 'revival':
      if (!result.length) return;
      addLogEntry(phase, result.map(r => r.leaderId
        ? `${nameOf(r.factionId)} revived leader ${r.leaderId}`
        : `${nameOf(r.factionId)} revived ${r.amount} force(s)${r.cost ? ` for ${r.cost} spice` : ''}`).join(', ') + '.');
      return;
    case 'shipment':
      if (!result.length) return;
      addLogEntry(phase, result.map(r => {
        if (r.type === 'movement') return `${nameOf(r.factionId)} moved ${r.amount} from ${territoryNameOf(r.from)} to ${territoryNameOf(r.to)}`;
        if (r.type === 'allyOverlapPenalty') return `${nameOf(r.penalizedFactionId)} lost ${r.forcesLost} forces sharing ${territoryNameOf(r.territoryId)} with an ally`;
        return `${nameOf(r.factionId)} shipped ${r.amount} to ${territoryNameOf(r.territoryId)}`;
      }).join('; ') + '.');
      return;
    case 'battle':
      if (!result.length) return;
      addLogEntry(phase, result.map(r => {
        if (r.explosion) return `Lasgun/shield explosion in ${territoryNameOf(r.territoryId)}`;
        if (r.mutualTraitors) return `Both leaders were traitors in ${territoryNameOf(r.territoryId)}`;
        const how = r.traitor ? ' (traitor revealed)' : '';
        return `${nameOf(r.winnerFactionId)} beat ${nameOf(r.loserFactionId)} in ${territoryNameOf(r.territoryId)}${how}`;
      }).join('; ') + '.');
      return;
    case 'spiceCollection': {
      const totals = {};
      for (const c of [...result.blowCollections.flatMap(b => b.collections), ...result.strongholdCollections]) {
        totals[c.factionId] = (totals[c.factionId] ?? 0) + c.collected;
      }
      const text = Object.entries(totals).map(([f, n]) => `${nameOf(f)} +${n}`).join(', ');
      if (text) addLogEntry(phase, `Collected: ${text} spice.`);
      return;
    }
    case 'mentatPause':
      if (result.gameOver) addLogEntry(phase, `Victory: ${result.winners.map(nameOf).join(' & ')} (${result.method}).`);
      return;
    default:
      addLogEntry(phase, 'Resolved.');
  }
}

function addLogEntry(phase, text) {
  logEntries.push({ phase, text, turn: gameState?.meta?.turn ?? '—' });
}

// --- Rendering -------------------------------------------------------

function render() {
  renderStatus();
  renderPhaseTrack();
  renderFactions();
  renderTerritories();
  renderLog();
}

function renderStatus() {
  const turnEl = document.getElementById('status-turn');
  const phaseEl = document.getElementById('status-phase');
  const stormEl = document.getElementById('status-storm');

  if (!gameState) {
    turnEl.textContent = '—';
    phaseEl.textContent = 'No game started';
    stormEl.textContent = 'Storm: —';
    return;
  }

  turnEl.textContent = `Turn ${gameState.meta.turn}`;
  phaseEl.textContent = gameState.victory.achieved
    ? 'Game Over'
    : (PHASE_LABELS[phaseEngine.currentPhase(gameState)] ?? phaseEngine.currentPhase(gameState));
  stormEl.textContent = `Storm: sector ${gameState.board.stormPosition ?? '—'}`;
}

function renderPhaseTrack() {
  const track = document.getElementById('phase-track');
  track.innerHTML = '';
  if (!gameState) return;

  const currentPhase = phaseEngine.currentPhase(gameState);
  const currentIdx = phaseEngine.PHASE_ORDER.indexOf(currentPhase);

  for (const [idx, phase] of phaseEngine.PHASE_ORDER.entries()) {
    if (phase === 'setup') continue; // already complete before rendering starts
    const step = document.createElement('span');
    step.className = 'phase-track__step';
    if (idx === currentIdx) step.classList.add('phase-track__step--active');
    else if (idx < currentIdx) step.classList.add('phase-track__step--done');
    step.textContent = PHASE_LABELS[phase] ?? phase;
    track.appendChild(step);
  }
}

function renderFactions() {
  const grid = document.getElementById('factions-grid');
  if (!gameState) {
    grid.innerHTML = '<p class="empty-note">Start a game to see faction status here.</p>';
    return;
  }

  grid.innerHTML = '';
  for (const factionId of ALL_FACTIONS) {
    const faction = gameState.factions[factionId];
    if (!faction) continue;
    const display = FACTION_DISPLAY[factionId];

    const card = document.createElement('div');
    card.className = 'faction-card';

    const totalForcesOnBoard = Object.values(faction.forces.onBoard).reduce((a, b) => a + b, 0);

    card.innerHTML = `
      <div class="faction-card__name">
        <span class="faction-chip" style="background:var(${display.colorVar})"></span>
        ${display.name}
      </div>
      <dl class="faction-card__stats">
        <dt>Spice</dt><dd>${faction.spice}</dd>
        <dt>Treachery</dt><dd>${faction.treacheryHand.length}</dd>
        <dt>Traitor</dt><dd>${faction.traitorHand?.length ?? 0}${faction.pendingTraitorHand ? ' (pending select)' : ''}</dd>
        <dt>Reserve</dt><dd>${faction.forces.reserve}</dd>
        <dt>On board</dt><dd>${totalForcesOnBoard}</dd>
        <dt>Leaders</dt><dd>${faction.leaders.available.length} / ${faction.leaders.available.length + faction.leaders.killed.length}</dd>
      </dl>
    `;
    grid.appendChild(card);
  }
}

function renderTerritories() {
  const wrap = document.getElementById('territories-table-wrap');
  if (!gameState) {
    wrap.innerHTML = '<p class="empty-note">Start a game to see the board here.</p>';
    return;
  }

  const rows = [];
  for (const factionId of ALL_FACTIONS) {
    const faction = gameState.factions[factionId];
    if (!faction) continue;
    for (const [territoryId, amount] of Object.entries(faction.forces.onBoard)) {
      const starred = faction.forces.starredOnBoard?.[territoryId] ?? 0;
      rows.push({ territoryId, factionId, amount, starred });
    }
  }
  rows.sort((a, b) => a.territoryId.localeCompare(b.territoryId));

  if (rows.length === 0) {
    wrap.innerHTML = '<p class="empty-note">No forces on the board yet.</p>';
    return;
  }

  const territoryName = id => territoriesData?.territories?.[id]?.name ?? id;

  wrap.innerHTML = `
    <table class="territories-table">
      <thead><tr><th>Territory</th><th>Faction</th><th>Forces</th><th>Starred</th></tr></thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td>${territoryName(r.territoryId)}</td>
            <td><span class="faction-chip" style="background:var(${FACTION_DISPLAY[r.factionId].colorVar})"></span> ${FACTION_DISPLAY[r.factionId].name}</td>
            <td>${r.amount}</td>
            <td>${r.starred || '—'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderLog() {
  const log = document.getElementById('turn-log');
  if (logEntries.length === 0) {
    log.innerHTML = '<li class="empty-note">Nothing has happened yet.</li>';
    return;
  }

  log.innerHTML = logEntries
    .slice()
    .reverse()
    .map(e => `<li><span class="log-phase">${PHASE_LABELS[e.phase] ?? e.phase}</span>T${e.turn}: ${escapeHTML(e.text)}</li>`)
    .join('');
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Wire up controls --------------------------------------------------

document.getElementById('btn-new-game').addEventListener('click', startNewGame);
document.getElementById('btn-step-phase').addEventListener('click', stepPhase);
document.getElementById('btn-run-turn').addEventListener('click', runTurn);

render();
