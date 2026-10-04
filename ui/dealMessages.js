// dealMessages.js: short confirmation messages for offers the human player is
// part of (made or received). Pure: no DOM, so Node tests can check the wording.
//
// names: { faction: id => name, territory: id => name, knowledge?: k => text }
// Returns the message text, or null when the viewer has nothing to be told
// (spectating, not part of the offer, or an ordinary incoming offer, which
// the incoming-offer card already handles).

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const DURATION_TYPES = new Set(['noEnter', 'noAttack', 'noTraitorOn']);

// A secret seen from the side that receives it ("their") or gives it ("your").
const SECRETS = {
  theirs: { cardPeek: 'a look at a random card in their hand', traitor: 'their traitor', noFieldValue: 'their No-Field value',
    spiceTotal: 'their spice total', bgPrediction: 'their prediction', stormCard: 'the next storm', faceDancers: 'their Face Dancers',
    nextSpiceCard: 'the next spice card', resale: 'something they know' },
  yours: { cardPeek: 'a look at a random card in your hand', traitor: 'your traitor', noFieldValue: 'your No-Field value',
    spiceTotal: 'your spice total', bgPrediction: 'your prediction', stormCard: 'the next storm', faceDancers: 'your Face Dancers',
    nextSpiceCard: 'the next spice card', resale: 'something you know' }
};

function secretText(sec, whose, who) {
  if (sec.kind === 'resale' && sec.about) return whose === 'yours' ? `what you know about ${who(sec.about)}` : `what they know about ${who(sec.about)}`;
  return SECRETS[whose][sec.kind] ?? sec.kind;
}

// A promise in plain words. byViewer: the human makes it ("you stay out of ...");
// otherwise the other faction does ("Guild will stay out of ...").
function promiseText(p, byViewer, names, who) {
  const t = DURATION_TYPES.has(p.type) && p.turns ? ` for ${plural(p.turns, 'turn')}` : '';
  switch (p.type) {
    case 'noEnter': return `${byViewer ? 'stay' : 'will stay'} out of ${names.territory(p.territoryId)}${t}`;
    case 'noAttack': return `won't move in on ${who(p.factionId)}${t}`;
    case 'noTraitorOn': return `won't call a traitor on ${who(p.factionId)}${t}`;
    case 'bidPass': return `${byViewer ? 'pass' : 'will pass'} on card ${p.cardIndex + 1}`;
    case 'noBid': return "won't bid this round";
    case 'allianceAt': return `${byViewer ? 'ally' : 'will ally'} with ${who(p.factionId)} at the next Nexus`;
  }
  return p.type;
}

// Both sides of an offer from the viewer's point of view: what you get first, then what you give.
export function dealTerms(offer, viewer, names) {
  const viewerIsFrom = offer.from === viewer;
  const mine = (viewerIsFrom ? offer.give : offer.ask) ?? {};
  const theirs = (viewerIsFrom ? offer.ask : offer.give) ?? {};
  const other = names.faction(viewerIsFrom ? offer.to : offer.from);
  const who = id => (id === viewer ? 'you' : names.faction(id));
  const parts = [];
  if (theirs.spice) parts.push(`you get ${theirs.spice} spice`);
  for (const s of theirs.secrets ?? []) parts.push(`you learn ${secretText(s, 'theirs', who)}`);
  for (const p of theirs.promises ?? []) parts.push(`${other} ${promiseText(p, false, names, who)}`);
  if (mine.spice) parts.push(`you pay ${mine.spice} spice`);
  for (const p of mine.promises ?? []) parts.push(`you ${promiseText(p, true, names, who)}`);
  for (const s of mine.secrets ?? []) parts.push(`${other} learns ${secretText(s, 'yours', who)}`);
  return parts.join(', ') || 'nothing changes hands';
}

export function dealMessage(e, viewer, names) {
  if (!viewer || !e) return null;
  const n = id => names.faction(id);
  switch (e.type) {
    case 'deal':
      if (e.from === viewer) return `${n(e.to)} accepted: ${dealTerms(e, viewer, names)}`;
      if (e.to === viewer) return `Deal agreed with ${n(e.from)}: ${dealTerms(e, viewer, names)}`;
      return null;
    case 'offerRefused':
      if (e.from === viewer) return `${n(e.to)} refused your offer`;
      if (e.to === viewer) return `You refused ${n(e.from)}'s offer`;
      return null;
    case 'offer':
      // A plain incoming offer has its own card; only counters get a message.
      return e.counterOf && e.to === viewer ? `${n(e.from)} countered: ${dealTerms(e, viewer, names)}` : null;
    case 'dealFailed':
      if (e.from !== viewer && e.to !== viewer) return null;
      return `The deal with ${n(e.from === viewer ? e.to : e.from)} fell through${e.reason ? `: ${String(e.reason).replace(/\.\s*$/, '')}` : ''}`;
    case 'secretLearned':
      if (e.privateTo !== viewer) return null;
      return `You learned: ${names.knowledge ? names.knowledge(e.knowledge) : e.knowledge?.kind}${e.knowledge?.resoldBy ? ` (passed on by ${n(e.knowledge.resoldBy)})` : ''}`;
  }
  return null;
}

// Cards the viewer gained between two looks at their hand, in the order they arrived.
// Handles the Harkonnen bonus card and the Ixian ally swap without knowing about either.
export function cardsGained(before = [], after = []) {
  const left = [...before];
  const gained = [];
  for (const c of after) {
    const i = left.indexOf(c);
    if (i >= 0) left.splice(i, 1);
    else gained.push(c);
  }
  return gained;
}
