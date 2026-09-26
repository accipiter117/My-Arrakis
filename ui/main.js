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
import { createStrategicAI } from '../js/ai/strategicAI.js';
import { createAI, DIFFICULTIES } from '../js/ai/difficulty.js';
import { createMixedProvider } from '../js/ai/mixedProvider.js';
import { createHumanProvider } from './humanProvider.js';
import { createBoard } from './board.js';
import * as cardEffects from '../js/cardEffects.js';
import { assessVictoryWatch } from '../js/victoryWatch.js';
import { FACTION_GUIDE, GUIDE_ORDER } from './factionGuide.js';
import { createPresenter } from './presenter.js';
import { createMusic } from './music.js';
import { createSfx } from './sfx.js';
import { getRandomState, setRandomState } from '../js/random.js';

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
let board = null;
let selectedTerritory = null;
let aiChoice = 'hard';
let highlightIds = [];
let presenter = null;

// Animation speed: remembered between visits; Fast if the device asks for reduced motion.
const SPEED_KEY = 'my-arrakis-speed';
const storedSpeed = localStorage.getItem(SPEED_KEY);
let speed = storedSpeed !== null ? Number(storedSpeed) : (matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.45 : 1);

const SAVE_KEY = 'my-arrakis-save-v1';
const AI_NAMES = { easy: 'Easy AI', normal: 'Normal AI', hard: 'Hard AI', passive: 'Passive',
  strategic: 'Hard AI', basic: 'Easy AI' }; // older saves used strategic/basic

// --- Data --------------------------------------------------------------

// Resolve data paths from this module's own location, not the page's.
// fetch() resolves relative URLs against the page, which broke on GitHub
// Pages where the site lives under /My-Arrakis/ rather than at the root.
async function loadJSON(path) {
  const response = await fetch(new URL(path, import.meta.url));
  if (!response.ok) throw new Error(`Failed to load ${path}: ${response.status} ${response.statusText}`);
  return response.json();
}

async function loadAllData() {
  const [territories, spiceDeck, treacheryDeck, leaders, rulesConfig, geometry] = await Promise.all([
    loadJSON('../data/territories.json'),
    loadJSON('../data/spiceDeck.json'),
    loadJSON('../data/treacheryDeck.json'),
    loadJSON('../data/leaders.json'),
    loadJSON('../data/rulesConfig.json'),
    loadJSON('../data/mapGeometry.json')
  ]);
  cardLookup = Object.fromEntries(treacheryDeck.cards.map(c => [c.id, c]));
  leadersById = {};
  for (const list of Object.values(leaders)) if (Array.isArray(list)) for (const l of list) leadersById[l.id] = l;
  return { territories, spiceDeck, treacheryDeck, leaders, rulesConfig, geometry };
}

// --- Game control ------------------------------------------------------

async function startNewGame() {
  if (busy) return;
  setBusy(true);
  try {
    const data = await loadAllData();
    territoriesData = data.territories;
    ensureBoard(data);
    humanFactionId = $('select-faction').value || null;

    gameState = initializeGame({
      activeFactionIds: ALL_FACTIONS,
      playerCircleOrder: ALL_FACTIONS,
      rulesConfig: data.rulesConfig,
      spiceDeckData: data.spiceDeck,
      territoriesData: data.territories,
      treacheryDeckData: data.treacheryDeck,
      leadersData: data.leaders,
      // ?seed=123 in the address replays a specific game exactly.
      seed: Number(new URLSearchParams(location.search).get('seed')) || undefined
    });

    aiChoice = $('select-ai').value;
    decisionProvider = buildProvider(data);

    logEntries = [];
    const who = humanFactionId ? `You play ${FACTION_NAMES[humanFactionId]}` : 'Spectating';
    addLog('setup', 1, `New game (seed ${gameState.meta.seed}). ${who}; opponents: ${AI_NAMES[aiChoice]}.`);
    render();

    const setup = await turnEngine.runSetupDecisions(gameState, decisionProvider);
    addLog('setup', 1, `Traitors chosen by ${setup.traitors.length} factions (Harkonnen keeps all four).${setup.prediction ? ' Bene Gesserit has sealed a secret Prediction.' : ''}`);
    phaseEngine.nextPhase(gameState);
    saveGame();
  } catch (err) {
    addLog('error', '—', `Failed to start game: ${err.message}`);
    console.error(err);
  } finally {
    setBusy(false);
  }
}

// --- Providers, saving and resuming -----------------------------------------

// Every provider reports events to the presenter, which animates them
// before the engine carries on.
function buildProvider(data) {
  const provider = buildDecisionMaker(data);
  return { ...provider, observe: (event, state) => { logEvent(event); return presenter?.observe(event, state); } };
}

function logEvent(e) {
  const turn = gameState?.meta.turn;
  if (e.type === 'truthtrance') {
    const q = e.question.kind === 'isTraitor' ? `Is ${leaderNameOf(e.question.leaderId)} your traitor?`
      : e.question.kind === 'spiceAtLeast' ? `Do you have at least ${e.question.amount} spice?` : `Do you hold a ${e.question.category.replace(/([A-Z])/g, ' $1').toLowerCase()}?`;
    addLog('battle', turn, `Truthtrance: ${nameOf(e.asker)} asked ${nameOf(e.target)} "${q}" Answer: ${e.answer ? 'yes' : 'no'}.`);
  }
  if (e.type === 'karama') addLog('battle', turn, `${nameOf(e.factionId)} played Karama to cancel ${{ voice: 'the Voice', prescience: 'Prescience', capture: 'a Harkonnen capture' }[e.purpose]}.`);
  if (e.type === 'pledge') addLog('bidding', turn, `${nameOf(e.from)} pledged ${e.amount} spice to ally ${nameOf(e.to)} for this turn.`);
}

function buildDecisionMaker(data) {
  const level = { strategic: 'hard', basic: 'easy' }[aiChoice] ?? aiChoice; // older saves
  const ai = level === 'passive' ? turnEngine.passiveDecisionProvider
    : createAI(level, { leadersData: data.leaders, cardLookup });
  return humanFactionId
    ? createMixedProvider({
        humanFactionId, ai,
        human: createHumanProvider({
          panel: $('decision-panel'), leadersData: data.leaders, cardLookup,
          territoriesData: data.territories, factionNames: FACTION_NAMES, onWaiting: setWaiting
        })
      })
    : ai;
}

// Saved at phase boundaries only, together with the random stream's
// position, so a resumed game plays on exactly as it would have.
function snapshot() {
  return { version: 1, savedAt: new Date().toISOString(), state: gameState, rng: getRandomState(),
           log: logEntries, humanFactionId, aiChoice };
}

function saveGame() {
  if (!gameState) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot()));
  } catch (err) {
    console.warn('Could not save the game', err); // private browsing or storage full
  }
  renderMenu();
}

function readSave() {
  try {
    const save = JSON.parse(localStorage.getItem(SAVE_KEY));
    return save?.version === 1 && save.state ? save : null;
  } catch {
    return null;
  }
}

async function resumeGame(save) {
  if (!save || busy) return;
  setBusy(true);
  try {
    const data = await loadAllData();
    territoriesData = data.territories;
    ensureBoard(data);
    gameState = save.state;
    setRandomState(save.rng);
    logEntries = save.log ?? [];
    humanFactionId = save.humanFactionId ?? null;
    aiChoice = save.aiChoice ?? 'hard';
    decisionProvider = buildProvider(data);
    const phase = PHASE_LABELS[phaseEngine.currentPhase(gameState)] ?? phaseEngine.currentPhase(gameState);
    addLog('setup', gameState.meta.turn, `Game resumed at turn ${gameState.meta.turn}, ${phase}.`);
    saveGame();
  } catch (err) {
    addLog('error', '—', `Could not resume: ${err.message}`);
    console.error(err);
  } finally {
    setBusy(false);
  }
}

function exportSave() {
  if (!gameState) return;
  const blob = new Blob([JSON.stringify(snapshot(), null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `my-arrakis-turn${gameState.meta.turn}-seed${gameState.meta.seed}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importSave(file) {
  try {
    const save = JSON.parse(await file.text());
    if (save?.version !== 1 || !save.state) throw new Error('not a My Arrakis save file');
    closeSheets();
    await resumeGame(save);
  } catch (err) {
    $('save-note').textContent = `Import failed: ${err.message}`;
  }
}

function timeAgo(iso) {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  return mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} days ago`;
}

function renderMenu() {
  const save = readSave();
  // Offer Continue for an unfinished saved game that isn't the one on screen.
  const onScreen = gameState && save && save.state.meta.seed === gameState.meta.seed && !gameState.victory.achieved;
  const resumable = save && !save.state.victory?.achieved && !onScreen;
  const btn = $('btn-continue');
  btn.hidden = !resumable;
  if (resumable) {
    const who = save.humanFactionId ? FACTION_NAMES[save.humanFactionId] : 'Spectating';
    btn.textContent = `Continue: turn ${save.state.meta.turn} · ${who} · ${timeAgo(save.savedAt)}`;
  }
  $('btn-export').disabled = !gameState;
}

async function stepPhase() {
  if (!gameState || gameState.victory.achieved || busy) return;
  setBusy(true);
  try {
    describe(await turnEngine.stepOnePhase(gameState, decisionProvider, territoriesData, cardLookup));
    saveGame();
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
      saveGame(); // after every completed phase, so a reload never loses more than one phase
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
  saveGame();
  openSheet('log');
}

function setBusy(value) {
  busy = value;
  render();
}

function setWaiting(waiting) {
  const phase = $('status-phase');
  phase.classList.toggle('topbar__phase--waiting', waiting);
  if (waiting) {
    phase.textContent = 'Your decision';
    closeSheets(); // the decision panel needs the screen
  } else {
    render();
  }
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
      const rides = (result.rides ?? []).map(r => ` Fremen rode the worm from ${territoryNameOf(r.from)} to ${territoryNameOf(r.to)} with ${r.amount} forces.`).join('');
      const diplomacy = (result.diplomacy ?? []).map(d =>
        d.type === 'allianceFormed' ? ` ${nameOf(d.proposer)} and ${nameOf(d.target)} form an alliance.`
        : d.type === 'allianceRejected' ? ` ${nameOf(d.target)} rejects ${nameOf(d.proposer)}'s alliance.`
        : ` ${nameOf(d.by)} breaks with ${nameOf(d.of)}.`).join('');
      return log(`Spice blow: ${text}.${result.nexus ? ' Shai-Hulud appeared, a Nexus follows.' : ''}${rides}${diplomacy}`);
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
      if (result.length) log(result.map(r => r.card === 'ghola'
        ? `${nameOf(r.factionId)} played Ghola, reviving ${r.leaderId ? leaderNameOf(r.leaderId) : `${r.forces} forces`}`
        : r.leaderId
        ? `${nameOf(r.factionId)} revived ${leaderNameOf(r.leaderId)}`
        : `${nameOf(r.factionId)} revived ${r.amount} force(s)${r.cost ? ` for ${r.cost} spice` : ''}`).join(', ') + '.');
      return;
    case 'shipment':
      if (result.length) log(result.map(r => {
        if (r.type === 'movement') return `${nameOf(r.factionId)} ${r.card === 'hajr' ? 'played Hajr and moved' : 'moved'} ${r.amount} from ${territoryNameOf(r.from)} to ${territoryNameOf(r.to)}`;
        if (r.type === 'allyOverlapPenalty') return `${nameOf(r.penalizedFactionId)} lost ${r.forcesLost} forces sharing ${territoryNameOf(r.territoryId)} with an ally`;
        return `${nameOf(r.factionId)} shipped ${r.amount} to ${territoryNameOf(r.territoryId)}`;
      }).join('; ') + '.');
      return;
    case 'battle':
      for (const r of result) {
        const place = territoryNameOf(r.territoryId);
        const voiced = r.voice ? ` Voice: ${nameOf(r.voice.target)} ${r.voice.command === 'play' ? 'must play' : 'must not play'} ${r.voice.category.replace(/([A-Z])/g, ' $1').toLowerCase()}.` : '';
        const canSee = r.capture && (humanFactionId === 'harkonnen' || humanFactionId === r.capture.from || !humanFactionId);
        const captured = r.capture ? ` Harkonnen captured ${canSee ? leaderNameOf(r.capture.leaderId) : 'a leader'} from ${nameOf(r.capture.from)}${r.capture.action === 'kill' ? ' and killed them for 2 spice' : ''}.` : '';
        const saw = r.prescience ? ` Prescience: Atreides saw ${nameOf(r.prescience.opponentId)}'s ${r.prescience.element === 'number' ? 'force count' : r.prescience.element}.` : '';
        const plans = r.plans ? ` [${describePlan(r.aggressorId, r.plans[r.aggressorId])} | ${describePlan(r.defenderId, r.plans[r.defenderId])}]` : '';
        if (r.explosion) log(`Lasgun/shield explosion in ${place}: everything there is destroyed.${plans}`);
        else if (r.mutualTraitors) log(`Both leaders were traitors in ${place}; both sides lose everything.${plans}`);
        else log(`${nameOf(r.winnerFactionId)} beat ${nameOf(r.loserFactionId)} in ${place}${r.traitor ? ' (traitor revealed)' : ''}.${voiced}${saw}${captured}${plans}`);
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

// --- Board ---------------------------------------------------------------

const FACTION_COLORS = {
  atreides: '#3f7047', harkonnen: '#9c2a24', emperor: '#66707e',
  fremen: '#2b6f86', guild: '#c4661f', gesserit: '#5e3a72'
};

function ensureBoard(data) {
  if (board) return;
  territoriesData = territoriesData ?? data.territories;
  board = createBoard({
    container: $('board'), geometry: data.geometry, territoriesData: data.territories,
    factionColors: FACTION_COLORS, onTap: tapTerritory,
    onZoom: zoomed => { $('zoom-reset').hidden = !zoomed; }
  });
  presenter = createPresenter({
    board, layer: $('event-layer'), factionColors: FACTION_COLORS, getSpeed: () => speed,
    names: { faction: nameOf, territory: territoryNameOf, leader: leaderNameOf, card: cardNameOf },
    renderDisplay: st => board.render(st, { selected: selectedTerritory, highlight: highlightIds }),
    renderReal: renderBoard,
    getViewer: () => humanFactionId,
    sfx,
    cardLookup
  });
  // Debug mode (brief section 36), only with ?debug=1: expose internals for testing.
  if (new URLSearchParams(location.search).has('debug')) window.__arrakis = { board, presenter, music, sfx, get state() { return gameState; }, get provider() { return decisionProvider; } };
}

function tapTerritory(id) {
  // Tapping the selected territory again dismisses its card.
  selectedTerritory = selectedTerritory === id && !$('territory-info').hidden ? null : id;
  renderBoard();
  renderTerritoryInfo();
  // An open decision panel (e.g. shipment) can use the tap to fill a field.
  if (selectedTerritory) document.dispatchEvent(new CustomEvent('territory-tap', { detail: { id } }));
}

// What an Atreides player has foreseen of the next spice blow (Prescience).
function foreseenSpice() {
  if (humanFactionId !== 'atreides') return null;
  return gameState?.factions.atreides?.specialFactionState?.foreseenSpice ?? null;
}

// What each card does and how to use it, shown when a card is tapped.
function cardHelp(id) {
  const c = cardLookup[id]?.category;
  if (cardEffects.UNBUILT_CARDS.includes(id)) {
    const why = id.startsWith('weather') || id.startsWith('family') ? 'it needs the storm, which is still being built' : 'its effect is still being built';
    return { text: `Not usable yet: ${why}. You may discard it to free a space in your hand.`, discard: true };
  }
  const help = {
    poisonWeapon: 'Weapon (poison). In battle, kills the enemy leader unless they play a poison defence (Snooper).',
    projectileWeapon: 'Weapon (projectile). In battle, kills the enemy leader unless they play a projectile defence (Shield).',
    specialWeapon: 'Lasgun. Kills the enemy leader; nothing stops it. But if anyone plays a Shield in the same battle, everything there is destroyed.',
    poisonDefense: 'Defence against poison weapons. Play it in a battle plan to protect your leader.',
    projectileDefense: 'Defence against projectile weapons. Never pair it with your own Lasgun.',
    specialLeaderSubstitute: 'Cheap Hero. Leads a battle in place of a leader, with strength 0, and can never be a traitor. Useful to throw a battle cheaply.',
    worthless: 'Worthless. Its only use is as a bluff: play it in a battle plan as your weapon or defence, and it is discarded afterwards. That is how you get rid of it.'
  }[c];
  if (help) return { text: help };
  if (id.startsWith('truthtrance')) return { text: 'Truthtrance. Ask another player one yes/no question about the game. They must answer truthfully, and everyone hears the answer.', truth: true };
  if (id.startsWith('karama')) return { text: 'Karama. Cancels an enemy faction advantage as it is used against you: the Voice, Atreides Prescience, or a Harkonnen capture. You will be offered it at that moment. (Each faction\'s once-per-game Karama power is not in this version yet.)' };
  if (id === 'hajr') return { text: 'Hajr. One extra move in the Movement phase: it is offered in your Shipment and movement panel.' };
  if (id === 'ghola') return { text: 'Ghola. Revive a leader, or up to 5 troops, for free: it is offered in your Revival panel.' };
  return { text: 'A special card.' };
}

function discardFromHand(id) {
  if (!gameState || !cardEffects.canDiscardUnbuilt(gameState, humanFactionId, id).ok) return;
  cardEffects.discardUnbuilt(gameState, humanFactionId, id);
  addLog(phaseEngine.currentPhase(gameState), gameState.meta.turn, `You discarded ${cardNameOf(id)}.`);
  saveGame();
  render();
}

// --- Truthtrance: ask a factual question, answered truthfully by the game ------
const TRUTH_CATEGORIES = [['poisonWeapon', 'poison weapon'], ['projectileWeapon', 'projectile weapon'], ['specialWeapon', 'Lasgun'],
  ['poisonDefense', 'poison defence (Snooper)'], ['projectileDefense', 'projectile defence (Shield)'], ['specialLeaderSubstitute', 'Cheap Hero'], ['worthless', 'worthless card']];
function fillTruthDetail() {
  const kind = $('truth-kind').value;
  const me = gameState.factions[humanFactionId];
  const opts = kind === 'holdsCategory' ? TRUTH_CATEGORIES
    : kind === 'isTraitor' ? me.leaders.available.map(id => [id, leaderNameOf(id)])
    : [5, 10, 15, 20, 30].map(n => [n, `${n} spice`]);
  $('truth-detail-label').textContent = { holdsCategory: 'Card', isTraitor: 'Leader', spiceAtLeast: 'Amount' }[kind];
  $('truth-detail').innerHTML = opts.map(([v, l]) => `<option value="${v}">${escapeHTML(l)}</option>`).join('');
}
function openTruthtrance() {
  $('truth-target').innerHTML = Object.keys(gameState.factions).filter(f => f !== humanFactionId)
    .map(f => `<option value="${f}">${FACTION_NAMES[f]}</option>`).join('');
  $('truth-answer').hidden = true;
  $('truth-ask').disabled = false;
  fillTruthDetail();
  openSheet('truth');
}
function askTruthtrance() {
  const kind = $('truth-kind').value, detail = $('truth-detail').value, target = $('truth-target').value;
  const question = kind === 'holdsCategory' ? { kind, category: detail } : kind === 'isTraitor' ? { kind, leaderId: detail } : { kind, amount: Number(detail) };
  if (!cardEffects.canPlayTruthtrance(gameState, humanFactionId, target).ok) return;
  const r = cardEffects.playTruthtrance(gameState, humanFactionId, target, question, cardLookup);
  const label = TRUTH_CATEGORIES.find(([c]) => c === detail)?.[1];
  const text = kind === 'holdsCategory' ? `Do you hold a ${label}?` : kind === 'isTraitor' ? `Is ${leaderNameOf(detail)} your traitor?` : `Do you have at least ${detail} spice?`;
  $('truth-answer').innerHTML = `${FACTION_NAMES[target]} answers: <strong>${r.answer ? 'Yes' : 'No'}</strong>`;
  $('truth-answer').hidden = false;
  $('truth-ask').disabled = true;
  addLog(phaseEngine.currentPhase(gameState), gameState.meta.turn, `Truthtrance: you asked ${FACTION_NAMES[target]} "${text}" Answer: ${r.answer ? 'yes' : 'no'}.`);
  saveGame();
  renderHand();
}

function renderBoard() {
  board?.render(gameState, { selected: selectedTerritory, highlight: highlightIds, foreseen: foreseenSpice() });
}

function renderTerritoryInfo() {
  const card = $('territory-info');
  // Keep the map clear while a decision panel covers the bottom of the screen.
  if (!selectedTerritory || !territoriesData || !$('decision-panel').hidden) { card.hidden = true; return; }
  const t = territoriesData.territories[selectedTerritory];
  const type = { sand: 'Sand', rock: 'Rock', stronghold: 'Stronghold', polarSink: 'Polar Sink, safe haven' }[t.type] ?? t.type;
  const spice = gameState ? gameState.board.spiceBlowMarkers.filter(m => m.territoryId === selectedTerritory).reduce((a, m) => a + m.amount, 0) : 0;
  const occupants = gameState ? Object.entries(gameState.factions)
    .filter(([, f]) => (f.forces.onBoard[selectedTerritory] ?? 0) > 0)
    .map(([id, f]) => `<li><span class="faction-chip" style="background:var(${FACTION_DISPLAY[id].colorVar})"></span>${nameOf(id)} ${f.forces.onBoard[selectedTerritory]}${f.forces.starredOnBoard?.[selectedTerritory] ? ` (${f.forces.starredOnBoard[selectedTerritory]}★)` : ''}</li>`) : [];
  const neighbours = (t.adjacentDraft ?? []).map(territoryNameOf).sort().join(', ');
  card.innerHTML = `<button class="icon-btn" aria-label="Close" data-card-close>✕</button>
    <strong>${t.name}</strong> · ${type}${spice ? ` · <strong>${spice} spice</strong>` : ''}
    ${occupants.length ? `<ul>${occupants.join('')}</ul>` : '<div>Unoccupied</div>'}
    <div class="borders">Borders: ${neighbours}</div>`;
  card.querySelector('[data-card-close]').onclick = () => { selectedTerritory = null; renderBoard(); renderTerritoryInfo(); };
  card.hidden = false;
}

// --- Victory watch: who is one step from winning (public information) ----
function renderWatch() {
  const strip = $('victory-watch'), list = $('watch-list');
  const items = gameState && !gameState.victory.achieved && territoriesData ? assessVictoryWatch(gameState, territoriesData) : [];
  const who = f => f.map(x => (x === humanFactionId ? 'You' : FACTION_NAMES[x])).join(' + ');
  const mine = it => humanFactionId && it.factions.includes(humanFactionId);
  const top = items.find(it => it.level !== 'info') ?? items[0];
  strip.hidden = !top;
  if (top) {
    strip.className = `watch watch--${top.level}${mine(top) ? ' watch--mine' : ''}`;
    strip.innerHTML = `<span class="watch__icon">${top.level === 'info' ? '◆' : '⚠'}</span><span><strong>${escapeHTML(who(top.factions))}</strong> ${escapeHTML(top.headline)}</span>${items.length > 1 ? `<span class="watch__more">+${items.length - 1}</span>` : ''}`;
  }
  list.innerHTML = !items.length ? '' : `<h3 class="sheet__sub">Victory watch</h3>` + items.map(it => `
    <div class="watch-item watch-item--${it.level}${mine(it) ? ' watch-item--mine' : ''}">
      <strong>${escapeHTML(who(it.factions))}</strong> ${escapeHTML(it.headline)}.<br><span>${escapeHTML(it.detail)}</span>
    </div>`).join('');
}

// --- Faction guide ------------------------------------------------------------
function renderGuide() {
  const body = $('guide-body');
  if (body.dataset.built) return;
  body.dataset.built = '1';
  const list = items => `<ul>${items.map(i => `<li>${escapeHTML(i)}</li>`).join('')}</ul>`;
  body.innerHTML = GUIDE_ORDER.map(f => {
    const g = FACTION_GUIDE[f];
    return `<details class="guide" data-faction="${f}"${f === humanFactionId ? ' open' : ''}>
      <summary><span class="faction-chip" style="background:var(${FACTION_DISPLAY[f].colorVar})"></span>${escapeHTML(g.title)}<em>${escapeHTML(g.tagline)}</em></summary>
      <p class="guide__start">${escapeHTML(g.start)}</p>
      <h4>Unique powers</h4>${list(g.powers)}
      <h4>Playing them: push it</h4>${list(g.push)}
      <h4>Facing them: counter it</h4>${list(g.counter)}
    </details>`;
  }).join('') + '<p class="sheet__note">Tuned to the rules as built in this version. Advanced rules are always on.</p>';
}

function render() {
  renderWatch();
  renderBoard();
  renderTerritoryInfo();
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
  if ($('status-phase').classList.contains('topbar__phase--waiting')) return;
  const spicePill = $('status-spice');
  if (!gameState) {
    $('status-turn').textContent = '';
    $('status-phase').textContent = 'No game';
    $('status-storm').textContent = 'Storm —';
    spicePill.hidden = true;
    return;
  }
  $('status-turn').textContent = `T${gameState.meta.turn}`;
  const phase = phaseEngine.currentPhase(gameState);
  $('status-phase').textContent = gameState.victory.achieved ? 'Game over' : (PHASE_LABELS[phase] ?? phase);
  $('status-storm').textContent = `Storm ${gameState.board.stormPosition ?? '—'}`;
  const me = humanFactionId && gameState.factions[humanFactionId];
  spicePill.hidden = !me;
  if (me) spicePill.textContent = `${me.spice} spice`;
  const ally = humanFactionId && gameState.alliances?.find(a => a.factions.includes(humanFactionId))?.factions.find(f => f !== humanFactionId);
  $('status-ally').hidden = !ally;
  if (ally) $('status-ally').textContent = `Ally: ${FACTION_NAMES[ally]}`;
}

function renderPhaseTrack() {
  const track = $('phase-track');
  track.innerHTML = '';
  if (!gameState) return;
  const currentIdx = phaseEngine.PHASE_ORDER.indexOf(phaseEngine.currentPhase(gameState));
  let activeEl = null;
  for (const [idx, phase] of phaseEngine.PHASE_ORDER.entries()) {
    if (phase === 'setup' || phase === 'victoryCheck' || phase === 'nexus') continue;
    const step = document.createElement('span');
    step.className = 'phase-track__step';
    if (idx === currentIdx) { step.classList.add('phase-track__step--active'); activeEl = step; }
    else if (idx < currentIdx) step.classList.add('phase-track__step--done');
    step.textContent = PHASE_LABELS[phase] ?? phase;
    track.appendChild(step);
  }
  // Keep the current phase in view on a narrow screen.
  if (activeEl) track.scrollLeft = activeEl.offsetLeft - track.clientWidth / 2 + activeEl.clientWidth / 2;
}

function renderHand() {
  const me = humanFactionId && gameState?.factions[humanFactionId];
  $('dock-hand').hidden = !me;
  $('topbar-hand').hidden = !me;
  $('status-storm').hidden = Boolean(me); // the storm shows on the map; the Hand needs the space
  if (!me) return;
  const cards = me.treacheryHand.length
    ? me.treacheryHand.map(id => {
        const help = cardHelp(id);
        return `<li class="hand-card">
          <button class="hand-card__face" data-card="${id}">${cardNameOf(id)} <em>${(cardLookup[id]?.category ?? '').replace(/([A-Z])/g, ' $1').toLowerCase()}</em></button>
          <div class="hand-card__info" hidden>${escapeHTML(help.text)}${help.discard ? ` <button class="btn hand-card__discard" data-discard="${id}">Discard</button>` : ''}${help.truth ? ` <button class="btn hand-card__discard" data-truth>Ask a question</button>` : ''}</div>
        </li>`;
      }).join('')
    : '<li class="empty-note">No treachery cards.</li>';
  const seen = foreseenSpice();
  const foresight = !seen ? '' : `<p class="hand-meta hand-meta--foresight"><strong>Prescience, next spice blow:</strong> ${
    seen.reshuffle ? 'the Spice Deck will be reshuffled, so the next card cannot be foreseen.'
    : seen.type === 'territory' ? `${seen.amount} spice in ${territoryNameOf(seen.territoryId)} (marked on the map).`
    : 'Shai-Hulud. A worm will rise.'}</p>`;
  const traitors = (me.traitorHand ?? []).map(id => `${leaderNameOf(id)} (${nameOf(leadersById[id]?.faction)})`).join(', ') || 'None';
  const leaders = me.leaders.available.map(id => `${leaderNameOf(id)} ${leadersById[id]?.fightingValue ?? ''}`).join(', ') || 'None';
  $('hand-heading').textContent = `Your hand · ${FACTION_NAMES[humanFactionId]}`;
  $('hand-body').innerHTML = `
    ${foresight}
    <ul class="hand-list">${cards}</ul>
    <p class="hand-meta"><em>Tap a card to see what it does.</em></p>
    <p class="hand-meta"><strong>Traitor:</strong> ${traitors}</p>
    <p class="hand-meta"><strong>Leaders:</strong> ${leaders}</p>
    ${humanFactionId === 'fremen' && gameState.board.nextStormCard ? `<p class="hand-meta"><strong>Next storm:</strong> ${gameState.board.nextStormCard} sectors <em>(only you can see this)</em></p>` : ''}
    ${me.specialFactionState?.prediction ? `<p class="hand-meta"><strong>Prediction:</strong> ${nameOf(me.specialFactionState.prediction.factionId)} on turn ${me.specialFactionState.prediction.turn}</p>` : ''}`;
}

const allyName = f => {
  const ally = gameState?.alliances?.find(a => a.factions.includes(f))?.factions.find(x => x !== f);
  return ally ? FACTION_NAMES[ally] : null;
};

function renderFactions() {
  const grid = $('factions-grid');
  if (!gameState) { grid.innerHTML = '<p class="empty-note">No game yet.</p>'; return; }
  const rows = ALL_FACTIONS.filter(f => gameState.factions[f]).map(f => {
    const faction = gameState.factions[f];
    const hidden = humanFactionId && f !== humanFactionId;
    const onBoard = Object.values(faction.forces.onBoard).reduce((a, b) => a + b, 0);
    return `<tr${f === humanFactionId ? ' class="is-you"' : ''}>
      <td><span class="faction-chip" style="background:var(${FACTION_DISPLAY[f].colorVar})"></span>${FACTION_DISPLAY[f].name}${f === humanFactionId ? ' (you)' : ''}${allyName(f) ? `<br><small>allied: ${allyName(f)}</small>` : ''}</td>
      <td>${hidden ? '?' : faction.spice}</td><td>${faction.treacheryHand.length}</td><td>${hidden ? '?' : (faction.traitorHand?.length ?? 0)}</td>
      <td>${faction.forces.reserve}</td><td>${onBoard}</td><td>${faction.leaders.available.length}</td></tr>`;
  }).join('');
  grid.innerHTML = `<table class="ftable"><thead><tr><th>Faction</th><th>Spice</th><th>Cards</th><th>Trait.</th><th>Resv</th><th>Board</th><th>Ldrs</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderTerritories() {
  const wrap = $('territories-table-wrap');
  if (!gameState) { wrap.innerHTML = '<p class="empty-note">No game yet.</p>'; return; }
  const rows = [];
  for (const f of ALL_FACTIONS) {
    const faction = gameState.factions[f];
    if (!faction) continue;
    for (const [t, n] of Object.entries(faction.forces.onBoard)) rows.push({ t, f, n, s: faction.forces.starredOnBoard?.[t] ?? 0 });
  }
  rows.sort((a, b) => territoryNameOf(a.t).localeCompare(territoryNameOf(b.t)));
  wrap.innerHTML = rows.length ? `<table class="ftable"><tbody>${rows.map(r => `
    <tr${r.f === humanFactionId ? ' class="is-you"' : ''}><td>${territoryNameOf(r.t)}</td>
    <td><span class="faction-chip" style="background:var(${FACTION_DISPLAY[r.f].colorVar})"></span>${FACTION_DISPLAY[r.f].name}</td>
    <td>${r.n}${r.s ? ` (${r.s}★)` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="empty-note">No forces on the board.</p>';
}

function renderLog() {
  const log = $('turn-log');
  const ticker = $('ticker');
  if (!logEntries.length) {
    log.innerHTML = '<li class="empty-note">Nothing has happened yet.</li>';
    ticker.textContent = 'Open the menu ☰ to start a game.';
    return;
  }
  log.innerHTML = logEntries.slice().reverse()
    .map(e => `<li><span class="log-phase">${PHASE_LABELS[e.phase] ?? e.phase}</span>T${e.turn}: ${escapeHTML(e.text)}</li>`)
    .join('');
  const last = logEntries[logEntries.length - 1];
  ticker.innerHTML = `<span class="ticker__phase">${escapeHTML(PHASE_LABELS[last.phase] ?? last.phase)}</span>${escapeHTML(last.text)}`;
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Sheets: summoned only when needed -------------------------------------

function openSheet(name) {
  closeSheets();
  render(); // sheets always open with current information
  const sheet = document.querySelector(`.sheet[data-name="${name}"]`);
  if (!sheet) return;
  sheet.hidden = false;
  $('scrim').hidden = false;
  document.querySelectorAll('.dock__btn[data-sheet]').forEach(b => b.classList.toggle('dock__btn--active', b.dataset.sheet === name));
}

function closeSheets() {
  document.querySelectorAll('.sheet').forEach(s => { s.hidden = true; });
  $('scrim').hidden = true;
  document.querySelectorAll('.dock__btn[data-sheet]').forEach(b => b.classList.remove('dock__btn--active'));
}

document.querySelectorAll('.dock__btn[data-sheet]').forEach(btn => btn.addEventListener('click', () => {
  const sheet = document.querySelector(`.sheet[data-name="${btn.dataset.sheet}"]`);
  if (sheet && !sheet.hidden) closeSheets(); else openSheet(btn.dataset.sheet);
}));
document.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', closeSheets));
$('scrim').addEventListener('click', closeSheets);
$('btn-menu').addEventListener('click', () => openSheet('menu'));
$('ticker').addEventListener('click', () => openSheet('log'));
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheets(); });

$('btn-new-game').addEventListener('click', () => { closeSheets(); startNewGame(); });
$('btn-continue').addEventListener('click', () => { closeSheets(); resumeGame(readSave()); });
$('btn-export').addEventListener('click', exportSave);
$('input-import').addEventListener('change', e => { if (e.target.files[0]) importSave(e.target.files[0]); e.target.value = ''; });
$('btn-step-phase').addEventListener('click', stepPhase);
// The Hand is always one tap away, even mid-decision (it opens above the panel).
$('topbar-hand').addEventListener('click', () => { const open = !$('sheet-hand').hidden; if (open) closeSheets(); else openSheet('hand'); });
$('victory-watch').addEventListener('click', () => openSheet('factions'));
$('truth-kind').addEventListener('change', fillTruthDetail);
$('truth-ask').addEventListener('click', askTruthtrance);
document.querySelectorAll('[data-open-guide]').forEach(b => b.addEventListener('click', () => { renderGuide(); openSheet('guide'); }));
// Hand: tap a card for what it does; discard cards whose effects aren't built yet.
$('hand-body').addEventListener('click', e => {
  const face = e.target.closest('[data-card]');
  if (face) { const info = face.nextElementSibling; info.hidden = !info.hidden; return; }
  const discard = e.target.closest('[data-discard]');
  if (discard) discardFromHand(discard.dataset.discard);
  if (e.target.closest('[data-truth]')) openTruthtrance();
});
$('zoom-in').addEventListener('click', () => board?.zoomBy(1.5));
$('select-speed').value = String(speed);
const describeDifficulty = () => { $('difficulty-note').textContent = DIFFICULTIES[$('select-ai').value]?.describe ?? 'Every faction passes: for testing the engine.'; };
$('select-ai').addEventListener('change', describeDifficulty);
describeDifficulty();
$('select-speed').addEventListener('change', e => { speed = Number(e.target.value); localStorage.setItem(SPEED_KEY, String(speed)); });
$('zoom-out').addEventListener('click', () => board?.zoomBy(1 / 1.5));
$('zoom-reset').addEventListener('click', () => board?.resetZoom());
// Decision panels outline legal choices on the map.
document.addEventListener('board-highlight', e => { highlightIds = e.detail.ids ?? []; renderBoard(); });
$('btn-run-turn').addEventListener('click', runTurn);

// The score: two tracks in order, then cycling. Starts on the first tap,
// since phones only allow audio to begin from one.
const music = createMusic({
  onChange: m => {
    $('music-now').textContent = !m.enabled ? 'Music is off.' : m.playing ? `Now playing: ${m.title}` : 'Music starts with your first tap.';
  }
});
const sfx = createSfx({ onPlay: name => { if (name === 'wormRoar') music.duck(3.2); } });
$('select-sfx').value = sfx.settings.enabled ? 'on' : 'off';
$('sfx-volume').value = String(sfx.settings.volume);
$('select-sfx').addEventListener('change', e => sfx.setEnabled(e.target.value === 'on'));
$('sfx-volume').addEventListener('input', e => sfx.setVolume(Number(e.target.value)));
$('select-music').value = music.settings.enabled ? 'on' : 'off';
$('music-volume').value = String(music.settings.volume);
$('select-music').addEventListener('change', e => music.setEnabled(e.target.value === 'on'));
$('music-volume').addEventListener('input', e => music.setVolume(Number(e.target.value)));
$('music-skip').addEventListener('click', () => music.skip());
document.addEventListener('pointerdown', () => { sfx.unlock(); if (music.settings.enabled) music.start(); }, { once: true });

// Drifting spice motes over the desert (skipped if the device asks for reduced motion).
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const motes = $('motes');
  for (let i = 0; i < 16; i++) {
    const m = document.createElement('span');
    m.className = 'mote';
    m.style.left = `${Math.random() * 100}%`;
    m.style.top = `${40 + Math.random() * 60}%`;
    m.style.setProperty('--dx', `${(Math.random() - 0.3) * 120}px`);
    m.style.animationDuration = `${9 + Math.random() * 10}s`;
    m.style.animationDelay = `${-Math.random() * 18}s`;
    motes.appendChild(m);
  }
}

// Show the map straight away, and the menu so a first game is one tap away.
loadAllData().then(data => { ensureBoard(data); render(); }).catch(err => addLog('error', '—', `Failed to load the map: ${err.message}`));
render();
renderMenu();
openSheet('menu');
