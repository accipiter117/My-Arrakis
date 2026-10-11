// ui/art.js
//
// Every picture the game can show, in one place. The rest of the game takes its image
// addresses from here, and the loading screen (ui/preload.js) loads exactly this list,
// so a picture is never shown before it has arrived. Add new art here; the check in
// tests/art.sim.js fails if an image is referenced anywhere else, or if a file in
// assets/ is missing from the list.
//
// The ?v= tags are kept exactly as before: a changed picture gets a new tag, so
// browsers fetch it afresh.

import { PHASE_ORDER } from '../js/phaseEngine.js';
import { TECH_TOKENS } from '../js/techTokens.js';

const A = path => new URL(`../assets/${path}`, import.meta.url).href;

export const ART = {
  counter: f => A(`counters/${f}.webp`),
  advisor: A('counters/gesserit-advisor.webp?v=1'),
  ship: f => A(`ships/${f}.webp`),
  thopter: f => A(`thopters/${f}.webp`),
  leader: id => A(`leaders/${id}.webp?v=1`),
  cheapHero: A('leaders/cheapHero.webp?v=1'),
  cardBack: A('cards/back.webp?v=2'),
  cardFace: A('cards/face.webp?v=1'),
  traitor: A('cards/traitor.webp?v=1'),
  faceDancer: A('cards/faceDancer.webp?v=1'),
  wheelBack: A('battle/wheel-back.webp?v=1'),
  wheelFront: A('battle/wheel-front.webp?v=1'),
  kwisatzHaderach: A('tokens/kwisatzHaderach.webp?v=1'),
  spice: n => A(`tokens/spice-${n >= 6 ? 8 : n >= 3 ? 3 : 1}.webp?v=1`), // a stack of n spice
  spiceMarker: A('tokens/spice-marker.webp?v=1'),
  storm: A('tokens/storm.webp?v=1'),
  stormDanger: A('tokens/storm-danger.webp?v=1'),
  shieldWallBlasted: A('tokens/shield-wall-destroyed.webp?v=1'),
  hms: A('tokens/hms.webp'),
  noField: A('tokens/nofield.webp'),
  tech: t => A(`tokens/tech-${t}.webp?v=3`),
  inflation: side => A(`tokens/inflation-${side}.webp?v=1`),
  map: A('map/arrakis.webp?v=1'),
  phase: (style, icon) => A(`phases/${style}-${icon}.webp?v=1`),
  // Drawn by the stylesheets (ui/styles.css, ui/desktop.css); listed so they are loaded too.
  button: (style, name) => A(`buttons/${style}-${name}.webp?v=1`),
  title: A('title.jpg'),
  victory: A('victory.jpg'),
  titleWide: A('title-wide.webp'),
  victoryWide: A('victory-wide.webp')
};

// The painted phase icons: one per phase on the track (Movement shares Shipment's).
export const phaseIcons = () => [...new Set(PHASE_ORDER
  .filter(p => !['setup', 'victoryCheck', 'nexus'].includes(p))
  .map(p => (p === 'movement' ? 'shipment' : p)))];

const STYLES = ['brass', 'stone'];
const BUTTONS = ['hand', 'factions', 'log', 'deal', 'step', 'run'];

// Every image address the game can show, for the loading screen.
// factions: every faction id; leaderIds: every leader id (from data/leaders.json).
export function allArt({ factions, leaderIds }) {
  return [...new Set([
    ...factions.flatMap(f => [ART.counter(f), ART.ship(f), ART.thopter(f)]),
    ART.advisor,
    ...leaderIds.map(ART.leader), ART.cheapHero,
    ART.cardBack, ART.cardFace, ART.traitor, ART.faceDancer,
    ART.wheelBack, ART.wheelFront, ART.kwisatzHaderach,
    ...[1, 3, 8].map(ART.spice), ART.spiceMarker, ART.storm, ART.stormDanger,
    ART.shieldWallBlasted, ART.hms, ART.noField,
    ...TECH_TOKENS.map(ART.tech), ART.inflation('double'), ART.inflation('cancel'),
    ART.map,
    ...STYLES.flatMap(s => phaseIcons().map(i => ART.phase(s, i))),
    ...STYLES.flatMap(s => BUTTONS.map(b => ART.button(s, b))),
    ART.title, ART.victory, ART.titleWide, ART.victoryWide
  ])];
}
