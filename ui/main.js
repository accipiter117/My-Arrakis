// ui/main.js
//
// Minimal playable UI. Choose a faction to play (or spectate), pick the
// opponents' AI, then step through phases. When a decision belongs to
// your faction the engine pauses and the decision panel asks you.
//
// Hidden information (brief section 6): when you play a faction, other
// factions' spice and traitors are hidden. Treachery hand sizes and board
// positions are public in the physical game, so they stay visible.

import { initializeGame } from '../js/setupEngine.js';
import * as turnEngine from '../js/turnEngine.js';
import * as phaseEngine from '../js/phaseEngine.js';
import { createBasicAI } from '../js/ai/basicAI.js';
import { createMixedProvider } from '../js/ai/mixedProvider.js';
import { createHumanProvider } from './humanProvider.js';

const ALL_FACTIONS = ['atreides', 'harkonnen', 'emperor', 'fremen', 'guild', 'gesserit'];

const FACTION_DISPLAY = {
  atreides: { name: 'Atreides', colorVar: '--faction-atreides' },
  harkonnen: { name: 'Harkonnen', colorVar: '--faction-harkonnen' },
  emperor: { name: 'Emperor', colorVar: '--faction-emperor' },
  fremen: { name: 'Fremen', colorVar: '--faction-fremen' },
  guild: { name: 'Spacing Guild', colorVar: '--faction-guild' },
  gesserit: { name: 'Bene Gesserit', colorVar: '--faction-gesserit' }
};
const FACTION_NAMES = Object.fromEntries(Object.entries(FACTION_DISPLAY).map(([k, v]) => [k, v.name]));

const PHASE_LABELS = {
  setup: 'Setup', storm: 'Storm', spiceBlow: 'Spice Blow', nexus: 'Nexus',
  charity: 'Charity', bidding: 'Bidding', revival: 'Revival',
  shipment: 'Shipment', movement: 'Movement', battle: 'Battle',
  spiceCollection: 'Spice Collection', mentatPause: 'Mentat Pause',
  victoryCheck: 'Victory Check'
};

const $ = id => document.getElementById(id);

let gameState = null;
let territoriesData = null;
let leadersById = {};
let cardLookup = {};
let logEntries = [];
let decisionProvider = turnEngine.passiveDecisionProvider;
let humanFactionId = null;
let busy = false;

// --- Data --------------------------------------------------------------

async function loadJSON(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Failed to load ${path}: ${response.status} ${response.statusText}`);
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
  cardLookup = Object.fromEntries(treacheryDeck.cards.map(c => [c.id, c]));
  leadersById = {};
  for (const list of Object.values(leaders)) if (Array.isArray(list)) for (const l of list) leadersById[l.id] = l;
  return { territories, spiceDeck, treacheryDeck, leaders, rulesConfig };
}

// --- Game control ------------------------------------------------------

async function startNewGame() {
  if (busy) return;
  setBusy(true);
  try {
    const data = await loadAllData();
    territoriesData = data.territories;
    humanFactionId = $('select-faction').value || null;

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

    const aiChoice = $('select-ai').value;
    const ai = aiChoice === 'basic'
      ? createBasicAI({ leadersData: data.leaders, cardLookup })
      : turnEngine.passiveDecisionProvider;
    decisionProvider = humanFactionId
      ? createMixedProvider({
          humanFactionId, ai,
          human: createHumanProvider({
            panel: $('decision-panel'), leadersData: data.leaders, cardLookup,
            territoriesData: data.territories, factionNames: FACTION_NAMES, onWaiting: setWaiting
          })
        })
      : ai;

    logEntries = [];
    const who = humanFactionId ? `You play ${FACTION_NAMES[humanFactionId]}` : 'Spectating';
    addLog('setup', 1, `New game. ${who}; opponents: ${aiChoice === 'basic' ? 'Basic AI' : 'Passive'}.`);
    render();

    const setup = await turnEngine.runSetupDecisions(gameState, decisionProvider);
    addLog('setup', 1, `Traitors chosen by ${setup.traitors.length} factions (Harkonnen keeps all four).${setup.prediction ? ' Bene Gesserit has sealed a secret Prediction.' : ''}`);
    phaseEngine.nextPhase(gameState);
  } catch (err) {
    addLog('error', '—', `Failed to start game: ${err.message}`);
    console.error(err);
  } finally {
    setBusy(false);
  }
}

async function stepPhase() {
  if (!gameState || gameState.victory.achieved || busy) return;
  setBusy(true);
  try {
    describe(await turnEngine.stepOnePhase(gameState, decisionProvider, territoriesData, cardLookup));
    checkVictory();
  } catch (err) {
    addLog('error', gameState.meta.turn, err.message);
    console.error(err);
  } finally {
    setBusy(false);
  }
}

async function runTurn() {
  if (!gameState || gameState.victory.achieved || busy) return;
  setBusy(true);
  try {
    // Step phase by phase (not runFullTurn) so the log and board update
    // as the turn unfolds, which matters while waiting on your decisions.
    const startTurn = gameState.meta.turn;
    while (!gameState.victory.achieved && gameState.meta.turn === startTurn) {
      describe(await turnEngine.stepOnePhase(gameState, decisionProvider, territoriesData, cardLookup));
      render();
    }
    checkVictory();
  } catch (err) {
    addLog('error', gameState.meta.turn, err.message);
    console.error(err);
  } finally {
    setBusy(false);
  }
}

function checkVictory() {
  if (!gameState?.victory?.achieved) return;
  const winners = gameState.victory.winningFactions.map(f => FACTION_NAMES[f] ?? f).join(' & ');
  const youWon = humanFactionId && gameState.victory.winningFactions.includes(humanFactionId);
  addLog('victory', gameState.meta.turn, `Game over: ${winners} win (${gameState.victory.method}).${humanFactionId ? (youWon ? ' You won.' : ' You lost.') : ''}`);
}

function setBusy(value) {
  busy = value;
  render();
}

function setWaiting(waiting) {
  $('status-phase').classList.toggle('status-chip--waiting', waiting);
  if (waiting) $('status-phase').textContent = 'Your decision';
  else render();
}

function shuffleArray(array) {
  const result = array.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// --- Log ---------------------------------------------------------------

const nameOf = id => FACTION_NAMES[id] ?? id;
const territoryNameOf = id => territoriesData?.territories?.[id]?.name ?? id;
const leaderNameOf = id => leadersById[id]?.name ?? id;
const cardNameOf = id => cardLookup[id]?.name ?? id;

function addLog(phase, turn, text) {
  logEntries.push({ phase, turn, text });
  renderLog();
}

function describePlan(factionId, plan) {
  if (!plan) return '';
  const who = plan.leaderId ? leaderNameOf(plan.leaderId) : plan.cheapHero ? 'a Cheap Hero' : 'no leader';
  const cards = [plan.weapon, plan.defense].filter(Boolean).map(cardNameOf);
  return `${nameOf(factionId)}: ${who}, ${plan.forces} forces${cards.length ? `, ${cards.join(' + ')}` : ''}`;
}

function describe(entry) {
  const { phase, result, turn } = entry;
  if (result === null || result === undefined) return;
  const log = text => addLog(phase, turn, text);

  switch (phase) {
    case 'storm':
      return log(`Storm moved ${result.sectorsToMove} sector(s) to sector ${result.newPosition}. Damage not yet applied (awaiting sector data).`);
    case 'spiceBlow': {
      const text = result.placed.length
        ? result.placed.map(m => `${m.amount} spice in ${territoryNameOf(m.territoryId)}`).join(', ')
        : 'no new spice placed';
      return log(`Spice blow: ${text}.${result.nexus ? ' Shai-Hulud appeared, a Nexus follows.' : ''}`);
    }
    case 'charity':
      if (result.length) log(result.map(r => `${nameOf(r.factionId)} +${r.amountReceived}`).join(', ') + ' spice.');
      return;
    case 'bidding': {
      const parts = result.filter(r => r.winner).map(r => `${nameOf(r.winner)} bought a card for ${r.price}`);
      const unsold = result.find(r => r.unsold);
      if (unsold) parts.push(`a card drew no bids, ending the auction (${unsold.cardsReturned} returned to the deck)`);
      return log((parts.join('; ') || 'No auction held') + '.');
    }
    case 'revival':
      if (result.length) log(result.map(r => r.leaderId
        ? `${nameOf(r.factionId)} revived ${leaderNameOf(r.leaderId)}`
        : `${nameOf(r.factionId)} revived ${r.amount} force(s)${r.cost ? ` for ${r.cost} spice` : ''}`).join(', ') + '.');
      return;
    case 'shipment':
      if (result.length) log(result.map(r => {
        if (r.type === 'movement') return `${nameOf(r.factionId)} moved ${r.amount} from ${territoryNameOf(r.from)} to ${territoryNameOf(r.to)}`;
        if (r.type === 'allyOverlapPenalty') return `${nameOf(r.penalizedFactionId)} lost ${r.forcesLost} forces sharing ${territoryNameOf(r.territoryId)} with an ally`;
        return `${nameOf(r.factionId)} shipped ${r.amount} to ${territoryNameOf(r.territoryId)}`;
      }).join('; ') + '.');
      return;
    case 'battle':
      for (const r of result) {
        const place = territoryNameOf(r.territoryId);
        const plans = r.plans ? ` [${describePlan(r.aggressorId, r.plans[r.aggressorId])} | ${describePlan(r.defenderId, r.plans[r.defenderId])}]` : '';
        if (r.explosion) log(`Lasgun/shield explosion in ${place}: everything there is destroyed.${plans}`);
        else if (r.mutualTraitors) log(`Both leaders were traitors in ${place}; both sides lose everything.${plans}`);
        else log(`${nameOf(r.winnerFactionId)} beat ${nameOf(r.loserFactionId)} in ${place}${r.traitor ? ' (traitor revealed)' : ''}.${plans}`);
      }
      return;
    case 'spiceCollection': {
      const totals = {};
      for (const c of [...result.blowCollections.flatMap(b => b.collections), ...result.strongholdCollections]) {
        totals[c.factionId] = (totals[c.factionId] ?? 0) + c.collected;
      }
      const text = Object.entries(totals).map(([f, n]) => `${nameOf(f)} +${n}`).join(', ');
      if (text) log(`Collected: ${text} spice.`);
      return;
    }
    case 'mentatPause':
      if (result.gameOver) log(`Victory: ${result.winners.map(nameOf).join(' & ')} (${result.method}).`);
      return;
  }
}

// --- Rendering ---------------------------------------------------------

function render() {
  renderStatus();
  renderPhaseTrack();
  renderHand();
  renderFactions();
  renderTerritories();
  renderLog();
  const active = Boolean(gameState) && !gameState.victory.achieved;
  $('btn-new-game').disabled = busy;
  $('btn-step-phase').disabled = busy || !active;
  $('btn-run-turn').disabled = busy || !active;
  $('select-faction').disabled = busy;
  $('select-ai').disabled = busy;
}

function renderStatus() {
  if ($('status-phase').classList.contains('status-chip--waiting')) return;
  if (!gameState) {
    $('status-turn').textContent = '—';
    $('status-phase').textContent = 'No game started';
    $('status-storm').textContent = 'Storm: —';
    return;
  }
  $('status-turn').textContent = `Turn ${gameState.meta.turn}`;
  const phase = phaseEngine.currentPhase(gameState);
  $('status-phase').textContent = gameState.victory.achieved ? 'Game Over' : (PHASE_LABELS[phase] ?? phase);
  $('status-storm').textContent = `Storm: sector ${gameState.board.stormPosition ?? '—'}`;
}

function renderPhaseTrack() {
  const track = $('phase-track');
  track.innerHTML = '';
  if (!gameState) return;
  const currentIdx = phaseEngine.PHASE_ORDER.indexOf(phaseEngine.currentPhase(gameState));
  for (const [idx, phase] of phaseEngine.PHASE_ORDER.entries()) {
    if (phase === 'setup') continue;
    const step = document.createElement('span');
    step.className = 'phase-track__step';
    if (idx === currentIdx) step.classList.add('phase-track__step--active');
    else if (idx < currentIdx) step.classList.add('phase-track__step--done');
    step.textContent = PHASE_LABELS[phase] ?? phase;
    track.appendChild(step);
  }
}

function renderHand() {
  const panel = $('hand-panel');
  const me = humanFactionId && gameState?.factions[humanFactionId];
  panel.hidden = !me;
  if (!me) return;
  const cards = me.treacheryHand.length
    ? me.treacheryHand.map(id => `<li>${cardNameOf(id)} <em>${(cardLookup[id]?.category ?? '').replace(/([A-Z])/g, ' $1').toLowerCase()}</em></li>`).join('')
    : '<li class="empty-note">No treachery cards.</li>';
  const traitors = (me.traitorHand ?? []).map(id => `${leaderNameOf(id)} (${nameOf(leadersById[id]?.faction)})`).join(', ') || 'None';
  $('hand-heading').textContent = `Your hand: ${FACTION_NAMES[humanFactionId]}`;
  $('hand-body').innerHTML = `
    <ul class="hand-list">${cards}</ul>
    <p class="hand-meta"><strong>Traitor:</strong> ${traitors}</p>
    ${me.specialFactionState?.prediction ? `<p class="hand-meta"><strong>Prediction:</strong> ${nameOf(me.specialFactionState.prediction.factionId)} on turn ${me.specialFactionState.prediction.turn}</p>` : ''}`;
}

function renderFactions() {
  const grid = $('factions-grid');
  if (!gameState) {
    grid.innerHTML = '<p class="empty-note">Start a game to see faction status here.</p>';
    return;
  }
  grid.innerHTML = '';
  for (const factionId of ALL_FACTIONS) {
    const faction = gameState.factions[factionId];
    if (!faction) continue;
    const display = FACTION_DISPLAY[factionId];
    const hidden = humanFactionId && factionId !== humanFactionId;
    const onBoard = Object.values(faction.forces.onBoard).reduce((a, b) => a + b, 0);
    const card = document.createElement('div');
    card.className = 'faction-card' + (factionId === humanFactionId ? ' faction-card--you' : '');
    card.innerHTML = `
      <div class="faction-card__name">
        <span class="faction-chip" style="background:var(${display.colorVar})"></span>
        ${display.name}${factionId === humanFactionId ? ' <span class="you-tag">You</span>' : ''}
      </div>
      <dl class="faction-card__stats">
        <dt>Spice</dt><dd>${hidden ? '?' : faction.spice}</dd>
        <dt>Treachery</dt><dd>${faction.treacheryHand.length}</dd>
        <dt>Traitor</dt><dd>${hidden ? '?' : (faction.traitorHand?.length ?? 0)}</dd>
        <dt>Reserve</dt><dd>${faction.forces.reserve}</dd>
        <dt>On board</dt><dd>${onBoard}</dd>
        <dt>Leaders</dt><dd>${faction.leaders.available.length} / ${faction.leaders.available.length + faction.leaders.killed.length}</dd>
      </dl>`;
    grid.appendChild(card);
  }
}

function renderTerritories() {
  const wrap = $('territories-table-wrap');
  if (!gameState) {
    wrap.innerHTML = '<p class="empty-note">Start a game to see the board here.</p>';
    return;
  }
  const rows = [];
  for (const factionId of ALL_FACTIONS) {
    const faction = gameState.factions[factionId];
    if (!faction) continue;
    for (const [territoryId, amount] of Object.entries(faction.forces.onBoard)) {
      rows.push({ territoryId, factionId, amount, starred: faction.forces.starredOnBoard?.[territoryId] ?? 0 });
    }
  }
  const spice = {};
  for (const m of gameState.board.spiceBlowMarkers) spice[m.territoryId] = (spice[m.territoryId] ?? 0) + m.amount;
  rows.sort((a, b) => territoryNameOf(a.territoryId).localeCompare(territoryNameOf(b.territoryId)));
  if (!rows.length) {
    wrap.innerHTML = '<p class="empty-note">No forces on the board yet.</p>';
    return;
  }
  wrap.innerHTML = `
    <table class="territories-table">
      <thead><tr><th>Territory</th><th>Faction</th><th>Forces</th><th>Spice</th></tr></thead>
      <tbody>${rows.map(r => `
        <tr${r.factionId === humanFactionId ? ' class="row--you"' : ''}>
          <td>${territoryNameOf(r.territoryId)}</td>
          <td><span class="faction-chip" style="background:var(${FACTION_DISPLAY[r.factionId].colorVar})"></span> ${FACTION_DISPLAY[r.factionId].name}</td>
          <td>${r.amount}${r.starred ? ` (${r.starred}★)` : ''}</td>
          <td>${spice[r.territoryId] ?? '—'}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

function renderLog() {
  const log = $('turn-log');
  if (!logEntries.length) {
    log.innerHTML = '<li class="empty-note">Nothing has happened yet.</li>';
    return;
  }
  log.innerHTML = logEntries.slice().reverse()
    .map(e => `<li><span class="log-phase">${PHASE_LABELS[e.phase] ?? e.phase}</span>T${e.turn}: ${escapeHTML(e.text)}</li>`)
    .join('');
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

$('btn-new-game').addEventListener('click', startNewGame);
$('btn-step-phase').addEventListener('click', stepPhase);
$('btn-run-turn').addEventListener('click', runTurn);

render();
