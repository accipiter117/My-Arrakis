// ui/main.js
//
// Minimal playable UI. Choose a faction to play (or spectate), pick the
// opponents' AI, then step through phases. When a decision belongs to
// your faction the engine pauses and the decision panel asks you.
//
// Hidden information (brief section 6): when you play a faction, other
// factions' spice and traitors are hidden. Treachery hand sizes and board
// positions are public in the physical game, so they stay visible.

import { TECH_TOKENS, TOKEN_NAMES, TOKEN_PHASE, tokensOwnedBy } from '../js/techTokens.js';
import { initializeGame } from '../js/setupEngine.js';
import * as turnEngine from '../js/turnEngine.js';
import * as phaseEngine from '../js/phaseEngine.js';
import { createBasicAI } from '../js/ai/basicAI.js';
import { createStrategicAI } from '../js/ai/strategicAI.js';
import { createAI, DIFFICULTIES } from '../js/ai/difficulty.js';
import { createMixedProvider } from '../js/ai/mixedProvider.js';
import { createRecorder, summarise } from './recorder.js';
import { createHumanProvider } from './humanProvider.js';
import { createBoard } from './board.js';
import * as cardEffects from '../js/cardEffects.js';
import * as hmsModule from '../js/hms.js';
import { assessVictoryWatch } from '../js/victoryWatch.js';
import { FACTION_GUIDE, GUIDE_ORDER, ALLIANCE_BASICS } from './factionGuide.js';
import { createPresenter } from './presenter.js';
import { createMusic } from './music.js';
import { createSfx } from './sfx.js';
import { getRandomState, setRandomState } from '../js/random.js';

const ALL_FACTIONS = ['atreides', 'harkonnen', 'emperor', 'fremen', 'guild', 'gesserit', 'ixians', 'tleilaxu', 'choam', 'richese'];

// --- Faction line-up: which factions play (any 2 to 6) --------------------------
// Expansion factions appear as "coming soon" until their milestone ships
// (docs/EXPANSION_STATUS.md).
const EXPANSION_FACTIONS = [];
const LINEUP_KEY = 'my-arrakis-lineup';
let lineup = (() => {
  try { const saved = JSON.parse(localStorage.getItem(LINEUP_KEY)); if (Array.isArray(saved) && saved.length >= 2) return saved.filter(f => ALL_FACTIONS.includes(f)); } catch {}
  return ALL_FACTIONS.slice(0, 6); // first visit: the base six (all eight would exceed the 6-seat limit)
})();
function renderLineup() {
  const human = $('select-faction').value;
  $('lineup-grid').innerHTML = ALL_FACTIONS.map(f => `<button type="button" class="lineup__faction${lineup.includes(f) ? ' is-on' : ''}" data-lineup="${f}" aria-pressed="${lineup.includes(f)}">
      <img src="assets/counters/${f}.png" alt=""><span>${FACTION_NAMES[f]}${f === human ? ' (you)' : ''}</span></button>`).join('')
    + EXPANSION_FACTIONS.map(([id, name]) => `<button type="button" class="lineup__faction is-soon" disabled><span class="lineup__soon-dot"></span><span>${name}<small>coming soon</small></span></button>`).join('');
  const n = lineup.length;
  $('lineup-note').textContent = n < 2 ? 'Choose at least 2 factions.' : `${n} faction${n === 1 ? '' : 's'} will play.`;
  // Play as: only factions in the line-up (plus spectating).
  [...$('select-faction').options].forEach(o => { if (o.value) o.hidden = !lineup.includes(o.value); });
}
function lineupForNewGame() {
  const human = $('select-faction').value;
  if (human && !lineup.includes(human)) lineup = [...lineup, human];
  const seated = ALL_FACTIONS.filter(f => lineup.includes(f)); // board seating order
  if (seated.length > 6) { const keep = new Set([human, ...seated.filter(f => f !== human)].filter(Boolean).slice(0, 6)); return seated.filter(f => keep.has(f)); }
  return seated.length >= 2 ? seated : ALL_FACTIONS.slice(0, 6);
}

const FACTION_DISPLAY = {
  atreides: { name: 'Atreides', colorVar: '--faction-atreides' },
  harkonnen: { name: 'Harkonnen', colorVar: '--faction-harkonnen' },
  emperor: { name: 'Emperor', colorVar: '--faction-emperor' },
  fremen: { name: 'Fremen', colorVar: '--faction-fremen' },
  guild: { name: 'Spacing Guild', colorVar: '--faction-guild' },
  gesserit: { name: 'Bene Gesserit', colorVar: '--faction-gesserit' },
  tleilaxu: { name: 'Tleilaxu', colorVar: '--faction-tleilaxu' },
  ixians: { name: 'Ixians', colorVar: '--faction-ixians' },
  choam: { name: 'CHOAM', colorVar: '--faction-choam' },
  richese: { name: 'Richese', colorVar: '--faction-richese' }
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
let recorder = createRecorder(); // the match record carried in saves and exports
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
    const seated = lineupForNewGame();

    gameState = initializeGame({
      activeFactionIds: seated,
      playerCircleOrder: seated,
      // Expansion card sets are chosen per game in the menu.
      rulesConfig: { ...data.rulesConfig, expansions: { ...(data.rulesConfig.expansions ?? {}), ixTlCards: $('select-ixtl').value === 'on', techTokens: $('select-tech').value } },
      spiceDeckData: data.spiceDeck,
      territoriesData: data.territories,
      treacheryDeckData: data.treacheryDeck,
      leadersData: data.leaders,
      // ?seed=123 in the address replays a specific game exactly.
      seed: Number(new URLSearchParams(location.search).get('seed')) || undefined
    });

    aiChoice = $('select-ai').value;
    recorder = createRecorder();
    recorder.start(gameState, { appVersion: appVersion(), seed: gameState.meta.seed, humanFactionId, aiChoice, lineup: seated,
      speed: $('select-speed')?.value ?? null, expansions: clone(gameState.rulesConfig.expansions ?? {}), houseRules: clone(gameState.rulesConfig.houseRules ?? {}),
      startedAt: new Date().toISOString() });
    decisionProvider = buildProvider(data);

    logEntries = [];
    const who = humanFactionId ? `You play ${FACTION_NAMES[humanFactionId]}` : 'Spectating';
    addLog('setup', 1, `New game (seed ${gameState.meta.seed}). ${who}; opponents: ${AI_NAMES[aiChoice]}.`);
    render();

    const setup = await turnEngine.runSetupDecisions(gameState, decisionProvider);
    addLog('setup', 1, `Traitors chosen by ${setup.traitors.length} factions${gameState.factions.harkonnen ? ' (Harkonnen keeps all four)' : ''}.${gameState.factions.tleilaxu ? ' The Tleilaxu hold three Face Dancers.' : ''}${setup.prediction ? ' Bene Gesserit has sealed a secret Prediction.' : ''}`);
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
  return { ...provider, observe: (event, state) => { recorder.event(event, state); logEvent(event); return presenter?.observe(event, state); } };
}

// Phase ambiences: the auction through Bidding, the Tleilaxu tanks through
// Revival, and one continuous ambience across Shipment and Movement. Each
// loops for as long as its phases last, carrying straight on when the next
// phase uses the same ambience, and fades out when the phase moves on to
// something else.
const PHASE_AMBIENCE = { bidding: 'bidding', revival: 'revivalTanks', shipment: 'shipping', movement: 'shipping' };
async function withPhaseAmbience(runPhase) {
  const loop = PHASE_AMBIENCE[phaseEngine.currentPhase(gameState)];
  if (loop) sfx.startLoop(loop); // does nothing if it is already playing
  try {
    return await runPhase();
  } finally {
    const next = gameState ? PHASE_AMBIENCE[phaseEngine.currentPhase(gameState)] : null;
    if (loop && next !== loop) sfx.stopLoop(loop);
    board?.overview(speed ? 700 : 0); // pull back to the whole map between phases
  }
}

function logEvent(e) {
  const turn = gameState?.meta.turn;
  if (e.type === 'truthtrance') {
    const q = e.question.kind === 'isTraitor' ? `Is ${leaderNameOf(e.question.leaderId)} your traitor?`
      : e.question.kind === 'spiceAtLeast' ? `Do you have at least ${e.question.amount} spice?` : `Do you hold a ${e.question.category.replace(/([A-Z])/g, ' $1').toLowerCase()}?`;
    const where = e.territoryId ? ` before the battle in ${territoryNameOf(e.territoryId)}` : '';
    addLog('battle', turn, `Truthtrance${where}: ${nameOf(e.asker)} asked ${nameOf(e.target)} "${q}" Answer: ${e.answer ? 'yes' : 'no'}.`);
  }
  if (e.type === 'karama') addLog('battle', turn, `${nameOf(e.factionId)} played Karama to cancel ${{ voice: 'the Voice', prescience: 'Prescience', capture: 'a Harkonnen capture' }[e.purpose]}${e.territoryId ? ` in ${territoryNameOf(e.territoryId)}` : ''}.`);
  if (e.type === 'technology') addLog('bidding', turn, 'The Ixians used Technology to swap the card about to be auctioned.');
  if (e.type === 'suboidExchange') addLog('battle', turn, `Ixians exchanged ${e.count} surviving Suboids for lost Cyborgs in ${territoryNameOf(e.territoryId)}.`);
  if (e.type === 'earlyLeaderRevival') addLog('revival', turn, `${nameOf(e.factionId)} paid the Tleilaxu ${e.price} spice to revive ${leaderNameOf(e.leaderId)} early.`);
  if (e.type === 'ghola') addLog('revival', turn, `The Tleilaxu revived ${leaderNameOf(e.leaderId)} (${nameOf(e.owner)}) as a Ghola for ${e.cost} spice.`);
  if (e.type === 'thumper') addLog('spiceBlow', turn, `${nameOf(e.factionId)} played a Thumper: Shai-Hulud is called.`);
  if (e.type === 'harvester') addLog('spiceBlow', turn, `${nameOf(e.factionId)} played a Harvester: the spice in ${territoryNameOf(e.territoryId)} doubles to ${e.amount}.`);
  if (e.type === 'amal') addLog(phaseEngine.currentPhase(gameState), turn, `${nameOf(e.factionId)} played Amal: every faction discards half its spice.`);
  if (e.type === 'alliancesCancelled') addLog('spiceBlow', turn, `Sandtrout: all alliances are cancelled (${e.alliances.map(a => a.map(nameOf).join(' + ')).join('; ')}).`);
  if (e.type === 'faceDancer') addLog('battle', turn, `Face Dancer! ${leaderNameOf(e.leaderId)} was a Tleilaxu Face Dancer: ${nameOf(e.winnerId)}'s ${e.returned} force${e.returned === 1 ? '' : 's'} in ${territoryNameOf(e.territoryId)} go back to reserves, and ${e.placed} Tleilaxu force${e.placed === 1 ? '' : 's'} take their place.`);
  if (e.type === 'advisorFlip') addLog(phaseEngine.currentPhase(gameState), turn, e.toAdvisors
    ? `Bene Gesserit in ${territoryNameOf(e.territoryId)} became advisors (intrusion).`
    : `Bene Gesserit advisors in ${territoryNameOf(e.territoryId)} became fighters${e.cause === 'alone' ? ' (alone there)' : ' to battle'}.`);
  if (e.type === 'weatherControl') addLog('storm', turn, `${nameOf(e.factionId)} played Weather Control: the storm moves ${e.sectors} sector${e.sectors === 1 ? '' : 's'}.`);
  if (e.type === 'familyAtomics') addLog('storm', turn, `${nameOf(e.factionId)} detonated Family Atomics: the Shield Wall is destroyed${e.losses.length ? ` (${e.losses.map(l => `${nameOf(l.factionId)} lost ${l.lost}`).join(', ')})` : ''}. Imperial Basin, Arrakeen and Carthag are now open to the storm.`);
  if (e.type === 'richeseCard') {
    const who = nameOf(e.factionId);
    const t = { nullentropyBox: `${who} used the Nullentropy Box to take a card from the discard pile`,
      distrans: `${who} used Distrans to give ${nameOf(e.targetId)} a card`,
      juiceOfSapho: e.use === 'aggressor' ? `${who} played Juice of Sapho to be the aggressor in ${territoryNameOf(e.territoryId)}` : `${who} played Juice of Sapho to go ${e.use}`,
      ornithopter: `${who} played an Ornithopter card to move up to 3 territories`,
      residualPoison: `${who} played Residual Poison: ${e.leaderId ? `${leaderNameOf(e.leaderId)} (${nameOf(e.opponentId)}) dies` : 'no leader was available'}`,
      portableSnooper: `${who} added a Portable Snooper after the reveal`,
      semutaDrug: `${who} used Semuta Drug to take ${cardNameOf(e.taken)} from the discard pile` }[e.cardId];
    if (t) addLog(phaseEngine.currentPhase(gameState), turn, `${t}.`);
  }
  if (e.type === 'blackMarketStart') {
    const seeIt = !humanFactionId || ['richese', 'atreides'].includes(humanFactionId);
    addLog('bidding', turn, `Black Market: Richese sell a card they call ${cardNameOf(e.claimId)}${seeIt && e.cardId !== e.claimId ? ` (really ${cardNameOf(e.cardId)})` : ''} (${{ normal: 'normal bidding', onceAround: 'Once Around', silent: 'Silent' }[e.method]}).`);
  }
  if (e.type === 'blackMarketEnd') addLog('bidding', turn, e.sold ? `${nameOf(e.winnerId)} bought the Black Market card for ${e.amount}.` : 'Nobody bid for the Black Market card: Richese keep it.');
  if (e.type === 'richeseGift') addLog(phaseEngine.currentPhase(gameState), turn, `Richese gave their ally ${nameOf(e.allyId)} a Richese card.`);
  if (e.type === 'gholaBuyBack') addLog('revival', turn, `${nameOf(e.factionId)} bought ${leaderNameOf(e.leaderId)} back from the Tleilaxu for ${e.price} spice.`);
  if (e.type === 'noFieldReveal' && e.territoryId) {
    const why = { storm: ', caught by the storm', worm: ', swallowed by the worm', battle: ' for the battle', newToken: ' to place a new one', choice: '' }[e.cause] ?? '';
    addLog(phaseEngine.currentPhase(gameState), turn, `Richese revealed their No-Field token in ${territoryNameOf(e.territoryId)}${why}: ${e.value} (${e.placed} force${e.placed === 1 ? '' : 's'} placed).`);
  }
  if (e.type === 'cacheAuctionStart') addLog('bidding', turn, `Richese auction ${cardNameOf(e.cardId)} from their cache (${e.method === 'silent' ? 'Silent' : 'Once Around'}).`);
  if (e.type === 'cacheAuctionEnd') addLog('bidding', turn, e.removed ? `Nobody bid: Richese removed ${cardNameOf(e.cardId)} from the game.`
    : e.amount === 0 ? `Nobody bid: Richese kept ${cardNameOf(e.cardId)}.`
    : `${nameOf(e.winnerId)} bought ${cardNameOf(e.cardId)} for ${e.amount}${e.method === 'silent' && e.bids ? ` (sealed bids: ${Object.entries(e.bids).map(([f, n]) => `${nameOf(f)} ${n}`).join(', ')})` : ''}${e.bonus ? '; Harkonnen draw a bonus card' : ''}.`);
  if (e.type === 'choamEffect') {
    const t = { baliset: `Baliset: ${nameOf(e.factionId)} may not move into ${territoryNameOf(e.territoryId)} this turn`,
      jubbaCloak: `Jubba Cloak: CHOAM forces in ${territoryNameOf(e.territoryId)} are sheltered from this storm`,
      kullWahad: `Kull Wahad: ${nameOf(e.factionId)} may not play Karama this phase`,
      kulon: 'Kulon: CHOAM forces move one extra territory this turn',
      laLaLa: `La La La: ${nameOf(e.factionId)} may not take free revival this turn`,
      tripToGamont: `Trip to Gamont: one ${nameOf(e.factionId)} force in ${territoryNameOf(e.territoryId)} goes back to reserves` }[e.cardId];
    addLog(phaseEngine.currentPhase(gameState), turn, `CHOAM played ${t}.`);
  }
  if (e.type === 'choamDiscards') {
    const total = e.discards.reduce((n, d) => n + d.spice, 0);
    const shown = e.revealed.length ? ` (revealed duplicates: ${e.revealed.map(cardNameOf).join(', ')})` : '';
    addLog(phaseEngine.currentPhase(gameState), turn, `CHOAM cashed in ${e.discards.length} card${e.discards.length > 1 ? 's' : ''} for ${total} spice${shown}.`);
  }
  if (e.type === 'choamTrade') addLog(phaseEngine.currentPhase(gameState), turn, `CHOAM traded a card with its ally ${nameOf(e.ally)}.`);
  if (e.type === 'choamSupport') addLog('battle', turn, `CHOAM offered ${e.amount} spice toward ${nameOf(e.allyId)}'s forces in ${territoryNameOf(e.territoryId)}.`);
  if (e.type === 'inflation') addLog('mentatPause', turn, e.placed ? `CHOAM placed Inflation: ${e.status === 'double' ? 'Double' : 'Cancel'} for next turn's Charity.`
    : e.status === 'removed' ? 'The Inflation token leaves the game.' : `Inflation flips to ${e.status === 'double' ? 'Double' : 'Cancel'} for next turn's Charity.`);
  if (e.type === 'audit') {
    const canSee = !humanFactionId || humanFactionId === 'choam' || humanFactionId === e.factionId;
    addLog('battle', turn, e.cancelled ? `${nameOf(e.factionId)} paid CHOAM ${e.cost} spice to cancel the Auditor's audit.`
      : `CHOAM's Auditor looked at ${e.count} of ${nameOf(e.factionId)}'s cards${canSee && e.cards?.length ? `: ${e.cards.map(cardNameOf).join(', ')}` : ''}.`);
  }
  if (e.type === 'techTokensAssigned') {
    const held = Object.entries(e.owners).map(([t, f]) => `${TOKEN_NAMES[t]}: ${f ? nameOf(f) : 'nobody'}`).join('; ');
    addLog('storm', turn, `Tech Tokens: ${held}.`);
  }
  if (e.type === 'techIncome') addLog(TOKEN_PHASE[e.token], turn, `${TOKEN_NAMES[e.token]} paid ${nameOf(e.factionId)} ${e.amount} spice.`);
  if (e.type === 'techTokenTaken') addLog('battle', turn, `${nameOf(e.to)} took ${TOKEN_NAMES[e.token]} from ${nameOf(e.from)} in ${territoryNameOf(e.territoryId)}.`);
  if (e.type === 'pledge') addLog('bidding', turn, `${nameOf(e.from)} pledged ${e.amount} spice to ally ${nameOf(e.to)} for this turn.`);
}

function buildDecisionMaker(data) {
  const level = { strategic: 'hard', basic: 'easy' }[aiChoice] ?? aiChoice; // older saves
  const ai = recorder.wrapAI(level === 'passive' ? turnEngine.passiveDecisionProvider
    : createAI(level, { leadersData: data.leaders, cardLookup }), () => gameState);
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
           log: logEntries, humanFactionId, aiChoice, record: recorder.data };
}

function saveGame() {
  if (!gameState) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot()));
  } catch (err) {
    // Storage full (long games carry a big match record): keep the game, slim the record.
    try {
      const slim = { ...recorder.data, ai: recorder.data.ai.map(({ input, output, ...keep }) => keep), events: recorder.data.events.filter(e => e.type !== 'phaseResult') };
      localStorage.setItem(SAVE_KEY, JSON.stringify({ ...snapshot(), record: slim }));
      console.warn('Saved with a slimmed match record (storage nearly full)');
    } catch (err2) {
      console.warn('Could not save the game', err2); // private browsing or storage full
    }
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
    // Saved games carry their own copy of the map data: refresh borders and
    // storm sectors so continued games use the current (corrected) map.
    for (const [id, t] of Object.entries(gameState.board.territories ?? {})) {
      const fresh = data.territories.territories[id];
      if (fresh) Object.assign(t, { adjacentDraft: fresh.adjacentDraft, stormSector: fresh.stormSector, stormShare: fresh.stormShare });
    }
    hmsModule.linkHms(gameState); // the HMS's links live in the game, not the map data
    setRandomState(save.rng);
    logEntries = save.log ?? [];
    recorder = createRecorder(save.record ?? null);
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
  // The export adds a review block: summary stats, hidden information revealed, checks.
  let review = null;
  try { review = { exportedAt: new Date().toISOString(), appVersion: appVersion(), ...summarise(recorder.data, gameState, cardLookup) }; }
  catch (err) { review = { error: `Summary failed: ${err.message}` }; }
  const blob = new Blob([JSON.stringify({ ...snapshot(), review })], { type: 'application/json' });
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

// One phase, recorded for the match export (spice before and after, the result).
async function recordedStep() {
  const before = recorder.spiceNow(gameState);
  const entry = await withPhaseAmbience(() => turnEngine.stepOnePhase(gameState, decisionProvider, territoriesData, cardLookup));
  try { recorder.phase(entry, before, gameState); } catch (err) { console.warn('Match record failed', err); }
  return entry;
}
const appVersion = () => document.querySelector('.build-version')?.textContent.replace('Version', '').trim() ?? null;
const clone = v => JSON.parse(JSON.stringify(v));

async function stepPhase() {
  if (!gameState || gameState.victory.achieved || busy) return;
  setBusy(true);
  try {
    describe(await recordedStep());
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
      describe(await recordedStep());
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
  if (gameState.victory.method === 'stalemate') {
    addLog('victory', gameState.meta.turn, `Game over: a draw. Nobody won by the end of turn ${gameState.meta.turn}.`);
  } else {
    addLog('victory', gameState.meta.turn, `Game over: ${winners} win (${gameState.victory.method}).${humanFactionId ? (youWon ? ' You won.' : ' You lost.') : ''}`);
  }
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
const leaderNameOf = id => id === 'cheapHeroTraitor' ? 'the Cheap Hero' : (leadersById[id]?.name ?? id);
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
      const d = result.damage;
      const hurt = d ? [...d.losses.map(l => `${nameOf(l.factionId)} lost ${l.lost} in ${territoryNameOf(l.territoryId)}`),
        ...d.spiceLost.map(x => `${x.amount} spice blown away in ${territoryNameOf(x.territoryId)}`)] : [];
      return log(`Storm moved ${result.sectorsToMove} sector(s) to sector ${result.newPosition}.${hurt.length ? ` ${hurt.join('; ')}.` : ' No damage.'}`);
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
    case 'charity': {
      if (result.some(r => r.inflation === 'cancel')) return log('Inflation: CHOAM Charity is cancelled this turn.');
      const paid = result.filter(r => r.factionId && !r.choamAdvantage);
      const own = result.find(r => r.choamAdvantage);
      const parts = [own ? `CHOAM collected ${own.amountReceived} (2 per faction${result.some(r => r.inflation === 'double') ? ', doubled' : ''})` : null,
        paid.length ? paid.map(r => `${nameOf(r.factionId)} +${r.amountReceived}${r.paidByChoam ? ' from CHOAM' : ''}`).join(', ') : null].filter(Boolean);
      if (parts.length) log(parts.join('; ') + ' spice.');
      return;
    }
    case 'bidding': {
      const parts = result.filter(r => r.winner).map(r => `${nameOf(r.winner)} bought ${r.cache ? cardNameOf(r.cardId) : 'a card'} for ${r.price}`);
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
        if (r.noField) return `Richese placed a No-Field token in ${territoryNameOf(r.territoryId)}`;
        if (r.type === 'advisor' && r.territoryId !== 'polarSink') return `Bene Gesserit sent an advisor to ${territoryNameOf(r.territoryId)}`;
        if (r.viaNoField) return `${nameOf(r.factionId)} shipped ${r.amount} to ${territoryNameOf(r.territoryId)} with Richese's No-Field token`;
        return `${nameOf(r.factionId)} shipped ${r.amount} to ${territoryNameOf(r.territoryId)}`;
      }).join('; ') + '.');
      return;
    case 'battle':
      for (const r of result) {
        const place = territoryNameOf(r.territoryId);
        const voiced = r.voice ? ` Voice: ${nameOf(r.voice.target)} ${r.voice.command === 'play' ? 'must play' : 'must not play'} ${r.voice.category.replace(/([A-Z])/g, ' $1').toLowerCase()}.` : '';
        const canSee = r.capture && (humanFactionId === 'harkonnen' || humanFactionId === r.capture.from || !humanFactionId);
        const captured = !r.capture ? '' : r.capture.action === 'prevented' ? ` Karama stopped the Harkonnen capture.`
          : ` Harkonnen captured ${canSee ? leaderNameOf(r.capture.leaderId) : 'a leader'} from ${nameOf(r.capture.from)}${r.capture.action === 'kill' ? ' and killed them for 2 spice' : ''}.`;
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
  fremen: '#2b6f86', guild: '#c4661f', gesserit: '#5e3a72', tleilaxu: '#8d9440', ixians: '#4f6fb8', choam: '#a8862e', richese: '#8f9aa6'
};

// The console beneath the map steps aside (its text hides) while the camera
// is zoomed in on the action, or a banner or event card fills that space.
let cameraFocused = false;
function updateConsoleMute() {
  const busy = cameraFocused || !$('turn-banner').hidden || !$('event-layer').hidden;
  document.body.classList.toggle('console-muted', busy);
}
new MutationObserver(updateConsoleMute).observe($('turn-banner'), { attributes: true, attributeFilter: ['hidden'] });
new MutationObserver(updateConsoleMute).observe($('event-layer'), { attributes: true, attributeFilter: ['hidden'] });
$('tech-tray').addEventListener('click', () => openSheet('factions'));

function ensureBoard(data) {
  if (board) return;
  territoriesData = territoriesData ?? data.territories;
  board = createBoard({
    container: $('board'), geometry: data.geometry, territoriesData: data.territories,
    factionColors: FACTION_COLORS, onTap: tapTerritory,
    onZoom: (zoomed, manual) => { $('zoom-reset').hidden = !zoomed; cameraFocused = zoomed && !manual; updateConsoleMute(); }
  });
  board.setCamera(localStorage.getItem('my-arrakis-camera') !== 'off');
  presenter = createPresenter({
    board, layer: $('event-layer'), banner: $('turn-banner'), factionColors: FACTION_COLORS, getSpeed: () => speed,
    names: { faction: nameOf, territory: territoryNameOf, leader: leaderNameOf, card: cardNameOf },
    renderDisplay: st => board.render(st, { selected: selectedTerritory, highlight: highlightIds, viewer: humanFactionId ?? null }),
    techTray: $('tech-tray'), onTechChange: () => renderTechTray(),
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
  // The camera frames the territory you picked.
  if (selectedTerritory && board) board.focusOn([board.labelPoint(id)], { force: true, minW: 460, ms: 500 });
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
    poisonBlade: 'Poison Blade. A weapon that is both projectile AND poison: only a Shield Snooper stops it. A Shield or a Snooper alone does not.',
    weirdingWay: 'Weirding Way. A projectile weapon. Or play it in the defence slot, alongside another weapon, as a projectile defence.',
    poisonTooth: 'Poison Tooth. Kills BOTH leaders, and a Snooper cannot stop it. After plans are revealed you may withhold it: then it has no effect, and if you win you keep it.',
    artilleryStrike: 'Artillery Strike. Kills both leaders unless shielded. Surviving leaders do not count towards strength, and no spice is paid for the dead. Always discarded after use.',
    shieldSnooper: 'Shield Snooper. Defends against both projectile and poison weapons (including a Poison Blade). Counts as a Shield, so never pair it with your own Lasgun.',
    chemistry: 'Chemistry. A poison defence. Or play it in the weapon slot, alongside another defence, as a poison weapon.',
    worthless: 'Worthless. Its only use is as a bluff: play it in a battle plan as your weapon or defence, and it is discarded afterwards. That is how you get rid of it.'
  }[c];
  if (help) return { text: help };
  if (id.startsWith('truthtrance')) return { text: 'Truthtrance. Ask another player one yes/no question about the game. They must answer truthfully, and everyone hears the answer.', truth: true };
  if (id.startsWith('karama')) return { text: 'Karama. Cancels an enemy faction advantage as it is used against you: the Voice, Atreides Prescience, or a Harkonnen capture. You will be offered it at that moment. (Each faction\'s once-per-game Karama power is not in this version yet.)' };
  if (id === 'harvester') return { text: 'Harvester. Just after a Spice Blow lands, double its spice. You will be asked at that moment.' };
  if (id === 'thumper') return { text: 'Thumper. At the start of a Spice Blow, call Shai-Hulud instead of revealing the first card: the worm devours the last spice territory and a Nexus follows. You will be asked at that moment.' };
  if (id === 'amal') return { text: 'Amal. Every faction, including you, discards half its spice (rounded up) to the Spice Bank. Play it between phases.', amal: true };
  const rich = {
    distrans: 'Distrans. Give another player a card from your hand (their hand permitting). Offered at the start of Bidding.',
    juiceOfSapho: 'Juice of Sapho. Be the aggressor in a battle you defend (the aggressor wins ties), or go first or last in Shipment and Movement. Offered at those moments.',
    mirrorWeapon: 'Mirror Weapon. A weapon that becomes a copy of your opponent\'s weapon. Discarded after use.',
    portableSnooper: 'Portable Snooper. A poison defence you add after plans are revealed, if you played no defence and the Voice allows. Discarded after use.',
    ornithopter: 'Ornithopter. As your movement, move up to 3 territories: tick it in your Shipment and movement panel. Discarded after use.',
    nullentropyBox: 'Nullentropy Box. Pay 2 spice to take any card from the discard pile. Offered at the start of Bidding.',
    semutaDrug: 'Semuta Drug. Take a card another player has just discarded. Offered at the end of a phase when there is one.',
    residualPoison: 'Residual Poison. In a battle, before plans, kill one of your opponent\'s available leaders at random (no spice for it).',
    stoneBurner: 'Stone Burner. A weapon: after plans are revealed choose to kill both leaders or reduce both to 0; the side with more undialled forces wins. Discarded after use.'
  }[id];
  if (rich) return { text: rich };
  if (id === 'weatherControl') return { text: 'Weather Control. At the start of the Storm phase (after the first turn), move the storm 0 to 10 sectors yourself. You will be offered it then.' };
  if (id === 'familyAtomics') return { text: 'Family Atomics. After the storm\'s move is known and before it moves, if you have forces on the Shield Wall or next to it: destroy every force on the Shield Wall. For the rest of the game the storm also sweeps Imperial Basin, Arrakeen and Carthag. You will be offered it then.' };
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
  board?.render(gameState, { selected: selectedTerritory, highlight: highlightIds, foreseen: foreseenSpice(), viewer: humanFactionId ?? null });
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
  const myAlly = humanFactionId && gameState?.alliances?.find(a => a.factions.includes(humanFactionId))?.factions.find(f => f !== humanFactionId);
  const allianceBlock = !myAlly ? '' : `<h3 class="sheet__sub">Your alliance with ${FACTION_NAMES[myAlly]}</h3>
    <div class="alliance-box"><strong>They give you:</strong><ul>${FACTION_GUIDE[myAlly].ally.map(i => `<li>${escapeHTML(i)}</li>`).join('')}</ul>
    <strong>You give them:</strong><ul>${FACTION_GUIDE[humanFactionId].ally.map(i => `<li>${escapeHTML(i)}</li>`).join('')}</ul>
    <strong>Both:</strong><ul>${ALLIANCE_BASICS.map(i => `<li>${escapeHTML(i)}</li>`).join('')}</ul></div>`;
  list.innerHTML = allianceBlock + (!items.length ? '' : `<h3 class="sheet__sub">Victory watch</h3>` + items.map(it => `
    <div class="watch-item watch-item--${it.level}${mine(it) ? ' watch-item--mine' : ''}">
      <strong>${escapeHTML(who(it.factions))}</strong> ${escapeHTML(it.headline)}.<br><span>${escapeHTML(it.detail)}</span>
    </div>`).join(''));
}

// --- Faction guide ------------------------------------------------------------
// Open the guide at one faction (e.g. your ally), with that section expanded.
function openGuideAt(factionId) {
  renderGuide();
  openSheet('guide');
  document.querySelectorAll('#guide-body details').forEach(d => { d.open = d.dataset.faction === factionId; });
  document.querySelector(`#guide-body details[data-faction="${factionId}"]`)?.scrollIntoView({ block: 'start' });
}

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
      <h4>As an ally</h4>${list(g.ally)}
      <h4>Playing them: push it</h4>${list(g.push)}
      <h4>Facing them: counter it</h4>${list(g.counter)}
    </details>`;
  }).join('') + `<h3 class="sheet__sub">Every alliance</h3>${list(ALLIANCE_BASICS)}<p class="sheet__note">Tuned to the rules as built in this version. Advanced rules are always on.</p>`;
}

// Tech Tokens tray: always on the map, each token ringed in its holder's colour.
function renderTechTray() {
  const tray = $('tech-tray');
  const tt = gameState?.techTokens;
  tray.hidden = !tt;
  if (!tt) return;
  const counts = {};
  for (const t of TECH_TOKENS) if (tt[t].owner) counts[tt[t].owner] = (counts[tt[t].owner] ?? 0) + 1;
  tray.innerHTML = TECH_TOKENS.map(t => {
    const f = tt[t].owner;
    const cls = !f ? ' tech-slot--empty' : counts[f] === 3 ? ' tech-slot--set' : counts[f] === 2 ? ' tech-slot--two' : '';
    const who = f ? (f === humanFactionId ? 'You' : FACTION_NAMES[f]) : 'nobody';
    return `<button class="tech-slot${cls}" data-token="${t}" style="--slot-colour:${f ? FACTION_COLORS[f] : '#555'}" title="${TOKEN_NAMES[t]}: ${who}" aria-label="${TOKEN_NAMES[t]}, held by ${who}">
      <img src="assets/tokens/tech-${t}.png?v=2" alt="">${f ? `<img class="tech-slot__owner" src="assets/counters/${f}.png" alt="">` : ''}</button>`;
  }).join('');
}

function render() {
  renderTechTray();
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
  if (me) { spicePill.textContent = `◆ ${me.spice}`; spicePill.title = `${me.spice} spice`; }
  const ally = humanFactionId && gameState.alliances?.find(a => a.factions.includes(humanFactionId))?.factions.find(f => f !== humanFactionId);
  $('status-ally').hidden = !ally;
  if (ally) { $('status-ally').innerHTML = `<img src="assets/counters/${ally}.png" alt="">`; $('status-ally').setAttribute('aria-label', `Ally: ${FACTION_NAMES[ally]}. Tap for what they give you.`); }
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
          <div class="hand-card__info" hidden>${escapeHTML(help.text)}${help.discard ? ` <button class="btn hand-card__discard" data-discard="${id}">Discard</button>` : ''}${help.truth ? ` <button class="btn hand-card__discard" data-truth>Ask a question</button>` : ''}${help.amal ? ` <button class="btn hand-card__discard" data-amal>Play Amal</button>` : ''}</div>
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
    ${humanFactionId === 'tleilaxu'
      ? `<p class="hand-meta"><strong>Face Dancers:</strong> ${(me.faceDancers ?? []).map(fd => `${fd.leaderId === 'cheapHeroTraitor' ? 'the Cheap Hero' : leaderNameOf(fd.leaderId)}${fd.leaderId === 'cheapHeroTraitor' ? '' : ` (${nameOf(leadersById[fd.leaderId]?.faction)})`}${fd.revealed ? ' <em>revealed</em>' : ''}`).join(', ') || 'None yet'}</p>`
      : `<p class="hand-meta"><strong>Traitor:</strong> ${traitors}</p>`}
    <p class="hand-meta"><strong>Leaders:</strong> ${leaders}</p>
    ${humanFactionId === 'fremen' && gameState.board.nextStormCard ? `<p class="hand-meta"><strong>Next storm:</strong> ${gameState.board.nextStormCard} sectors <em>(only you can see this)</em></p>` : ''}
    ${me.specialFactionState?.prediction ? `<p class="hand-meta"><strong>Prediction:</strong> ${nameOf(me.specialFactionState.prediction.factionId)} on turn ${me.specialFactionState.prediction.turn}</p>` : ''}`;
}

// Cards a faction revealed in battle and kept: public knowledge at the table.
const knownCardsOf = f => Object.entries(gameState?.meta.knownCards ?? {}).filter(([, x]) => x === f).map(([id]) => cardNameOf(id)).join(', ');

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
      <td><span class="faction-chip" style="background:var(${FACTION_DISPLAY[f].colorVar})"></span>${FACTION_DISPLAY[f].name}${f === humanFactionId ? ' (you)' : ''}${allyName(f) ? `<br><small>allied: ${allyName(f)}</small>` : ''}${tokensOwnedBy(gameState, f).length ? `<br><span class="tech-tokens">${tokensOwnedBy(gameState, f).map(t => `<img src="assets/tokens/tech-${t}.png?v=2" alt="${TOKEN_NAMES[t]}" title="${TOKEN_NAMES[t]}">`).join('')}</span>` : ''}${knownCardsOf(f) && f !== humanFactionId ? `<br><small class="known">known: ${knownCardsOf(f)}</small>` : ''}</td>
      <td>${hidden ? '?' : faction.spice}</td><td>${faction.treacheryHand.length}</td><td>${hidden ? '?' : (faction.traitorHand?.length ?? 0)}</td>
      <td>${faction.forces.reserve}</td><td>${onBoard}</td><td>${faction.leaders.available.length}</td></tr>`;
  }).join('');
  const anyKnown = Object.keys(gameState.meta.knownCards ?? {}).length;
  const inf = gameState.factions.choam?.specialFactionState?.inflation?.status;
  const infNote = inf && inf !== 'unused' ? `<p class="sheet__note">CHOAM Inflation: ${inf === 'removed' ? 'used and gone' : `${inf === 'double' ? 'Double' : 'Cancel'} for next turn's Charity`}.</p>` : '';
  const techNote = infNote + (gameState.techTokens ? `<p class="sheet__note"><span class="tech-tokens tech-tokens--key">${TECH_TOKENS.map(t => `<span><img src="assets/tokens/tech-${t}.png?v=2" alt=""> ${TOKEN_NAMES[t]}</span>`).join('')}</span><br>Tech Tokens are public. Each pays its holder 1 spice per token they hold when its phase is used; beating a holder in battle takes one; all three in one hand count as a stronghold.${TECH_TOKENS.some(t => !gameState.techTokens[t].owner) ? ` Not held: ${TECH_TOKENS.filter(t => !gameState.techTokens[t].owner).map(t => TOKEN_NAMES[t]).join(', ')}.` : ''}</p>` : '');
  grid.innerHTML = techNote + (anyKnown ? '<p class="sheet__note">"Known" cards were revealed in a battle and kept by the winner, so everyone at the table has seen them.</p>' : '') + `<table class="ftable"><thead><tr><th>Faction</th><th>Spice</th><th>Cards</th><th>Trait.</th><th>Resv</th><th>Board</th><th>Ldrs</th></tr></thead><tbody>${rows}</tbody></table>`;
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
  const feed = $('console-feed');
  if (!logEntries.length) {
    log.innerHTML = '<li class="empty-note">Nothing has happened yet.</li>';
    ticker.textContent = 'Open the menu ☰ to start a game.';
    feed.innerHTML = '<p class="console-feed__empty">Open the menu ☰ to start a game.</p>';
    return;
  }
  // The console beneath the map shows the latest few events.
  feed.innerHTML = logEntries.slice(-5).reverse()
    .map((e, i) => `<p class="console-feed__line${i === 0 ? ' is-latest' : ''}"><span class="ticker__phase">${escapeHTML(PHASE_LABELS[e.phase] ?? e.phase)}</span>${escapeHTML(e.text)}</p>`).join('');
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
$('console-feed').addEventListener('click', () => openSheet('log'));

// --- Phone layout: map on top, a console beneath it -------------------------------
// On a tall screen the map is limited by the screen's width, leaving empty
// space above and below. Pin the map to the top and use the space beneath as
// a console where panels, cards and banners appear, so they never cover the map.
function layoutConsole() {
  const stage = document.querySelector('.stage');
  const r = stage.getBoundingClientRect();
  const on = r.height - r.width >= 150;
  document.body.classList.toggle('has-console', on);
  document.documentElement.style.setProperty('--board-size', `${Math.floor(on ? r.width : Math.min(r.width, r.height))}px`);
  requestAnimationFrame(() => {
    const b = document.querySelector('.board-wrap').getBoundingClientRect();
    document.documentElement.style.setProperty('--below-board', `${Math.max(0, Math.floor(window.innerHeight - b.bottom))}px`);
  });
}
window.addEventListener('resize', layoutConsole);
// Panels and sheets sit above the bottom bar, so Hand, Factions and Log stay reachable.
new ResizeObserver(([e]) => document.documentElement.style.setProperty('--dock-h', `${Math.ceil(e.target.getBoundingClientRect().height)}px`))
  .observe(document.querySelector('.dock'));
// Also re-measure when the stage itself changes (e.g. the victory watch strip appearing).
if (window.ResizeObserver) new ResizeObserver(() => layoutConsole()).observe(document.querySelector('.stage'));
window.addEventListener('orientationchange', () => setTimeout(layoutConsole, 200));
layoutConsole();
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheets(); });

$('btn-new-game').addEventListener('click', () => { closeSheets(); startNewGame(); });
$('btn-continue').addEventListener('click', () => { closeSheets(); resumeGame(readSave()); });
$('btn-export').addEventListener('click', exportSave);
$('input-import').addEventListener('change', e => { if (e.target.files[0]) importSave(e.target.files[0]); e.target.value = ''; });
$('btn-step-phase').addEventListener('click', stepPhase);
// The Hand is always one tap away, even mid-decision (it opens above the panel).
$('topbar-hand').addEventListener('click', () => { const open = !$('sheet-hand').hidden; if (open) closeSheets(); else openSheet('hand'); });
$('victory-watch').addEventListener('click', () => openSheet('factions'));
// Tap the Ally pill to see what your ally gives you.
$('status-ally').addEventListener('click', () => {
  const ally = gameState?.alliances?.find(a => a.factions.includes(humanFactionId))?.factions.find(f => f !== humanFactionId);
  if (ally) openGuideAt(ally);
});
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
  if (e.target.closest('[data-amal]') && gameState && !busy) {
    const r = cardEffects.playAmal(gameState, humanFactionId);
    addLog(phaseEngine.currentPhase(gameState), gameState.meta.turn, `You played Amal: every faction discards half its spice (${Object.entries(r.losses).map(([f, n]) => `${nameOf(f)} ${n}`).join(', ')}).`);
    saveGame(); render();
  }
});
$('zoom-in').addEventListener('click', () => board?.zoomBy(1.5));
$('select-speed').value = String(speed);
$('select-ixtl').value = localStorage.getItem('my-arrakis-ixtl') ?? 'on';
$('select-ixtl').addEventListener('change', e => localStorage.setItem('my-arrakis-ixtl', e.target.value));
// Tech Tokens became "Always" by default after some players had saved "Off": reset that once.
if (!localStorage.getItem('my-arrakis-tech-reset-1')) { localStorage.setItem('my-arrakis-tech', 'on'); localStorage.setItem('my-arrakis-tech-reset-1', '1'); }
$('select-tech').value = localStorage.getItem('my-arrakis-tech') ?? 'on';
$('select-tech').addEventListener('change', e => localStorage.setItem('my-arrakis-tech', e.target.value));
$('lineup-grid').addEventListener('click', e => {
  const b = e.target.closest('[data-lineup]');
  if (!b) return;
  const f = b.dataset.lineup;
  if (lineup.includes(f)) {
    if (f === $('select-faction').value) return; // your own faction always plays
    lineup = lineup.filter(x => x !== f);
  } else if (lineup.length < 6) lineup = [...lineup, f];
  localStorage.setItem(LINEUP_KEY, JSON.stringify(lineup));
  renderLineup();
});
$('lineup-all').addEventListener('click', () => {
  // The six base factions, but always keeping your own (swapping out Bene Gesserit if you play an expansion faction).
  const human = $('select-faction').value;
  lineup = ALL_FACTIONS.filter(f => !['tleilaxu', 'ixians', 'choam', 'richese'].includes(f));
  if (human && !lineup.includes(human)) lineup = [...lineup.filter(f => f !== 'gesserit'), human]; localStorage.setItem(LINEUP_KEY, JSON.stringify(lineup)); renderLineup(); });
$('lineup-random').addEventListener('click', () => {
  const human = $('select-faction').value;
  const size = 3 + Math.floor(Math.random() * 4); // 3 to 6 factions
  const pool = ALL_FACTIONS.filter(f => f !== human).sort(() => Math.random() - 0.5);
  lineup = [...(human ? [human] : []), ...pool].slice(0, size);
  localStorage.setItem(LINEUP_KEY, JSON.stringify(lineup));
  renderLineup();
});
$('select-faction').addEventListener('change', () => {
  const human = $('select-faction').value;
  if (human && !lineup.includes(human)) { lineup = [...lineup, human].slice(-6); localStorage.setItem(LINEUP_KEY, JSON.stringify(lineup)); }
  renderLineup();
});
renderLineup();
// Camera: follow the action (default) or stay where you put it.
const CAMERA_KEY = 'my-arrakis-camera';
const cameraOn = () => localStorage.getItem(CAMERA_KEY) !== 'off';
$('select-camera').value = cameraOn() ? 'on' : 'off';
$('select-camera').addEventListener('change', e => { localStorage.setItem(CAMERA_KEY, e.target.value); board?.setCamera(e.target.value === 'on'); });
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
const sfx = createSfx({ onPlay: (name, seconds) => {
  if (name === 'wormRoar') music.duck(3.2);
  if (name.startsWith('turn-')) music.duck(seconds); // let turn announcements come through
} });
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
