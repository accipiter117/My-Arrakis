// ui/negotiationPanel.js
//
// The player's side of negotiation (js/negotiation.js):
// - an offer builder: who to, what you give, what you ask (spice, one secret,
//   one promise each side), all drop-downs, validated live against the same
//   rules the engine uses;
// - an incoming-offer card: Accept, Counter (once) or Refuse.
//
// Deals are binding, so the card says so. Spice behind other shields is
// secret, so what you can ask for is never limited by what they hold; an
// offer they can't pay is simply refused.

import * as neg from '../js/negotiation.js';

const WINDOW_TITLE = { bidding: 'Start of Bidding', nexus: 'The Nexus', shipment: 'Start of Shipment and Movement', battle: 'Before the battle' };
const PROMISE_LABEL = { noEnter: 'Stay out of a territory', noAttack: 'Not move in on a faction', noTraitorOn: 'Not call a traitor on a faction',
  bidPass: 'Pass on one card', noBid: 'Not bid this round', allianceAt: 'Ally at the next Nexus' };

export function createNegotiationPanels({ ask, esc, options, factionName, territoryName, territoriesData }) {
  const names = { faction: factionName, territory: territoryName };
  const windowTitle = (ctx, state) => ctx?.kind === 'battle' && ctx.territoryId ? `Before the battle in ${territoryName(ctx.territoryId)}` : (WINDOW_TITLE[ctx?.kind] ?? 'Negotiation');
  const territoryOptions = Object.keys(territoriesData.territories)
    .filter(id => id !== 'polarSink')
    .map(id => [id, territoryName(id)]).sort((a, b) => a[1].localeCompare(b[1]));

  // --- Builder ----------------------------------------------------------------

  // One side of the form. prefix 'give' (you) or 'ask' (them).
  function sideHtml(state, me, to, prefix, preset = {}) {
    const ctx = neg.currentWindow(state);
    const promiser = prefix === 'give' ? me : to;
    const spiceMax = prefix === 'give' ? Math.min(30, state.factions[me].spice) : 20;
    const secrets = prefix === 'give'
      ? neg.sellableSecrets(state, me, to)
      : neg.sellableSecrets(state, to, me).filter(s => s.kind !== 'resale'); // their resale stock is private
    const secretVal = s => s.kind === 'resale' ? `resale:${s.entryId}` : s.kind;
    const types = neg.PROMISE_TYPES.filter(t => ctx?.kind === 'bidding' || !['bidPass', 'noBid'].includes(t));
    const others = Object.keys(state.factions).filter(f => f !== promiser);
    const cards = state.bidding?.cardsUpForBid?.length ?? 0;
    const p = preset.promises?.[0] ?? {}, sec = preset.secrets?.[0];
    return `<fieldset class="deal-side"><legend>${prefix === 'give' ? 'You give' : 'You ask for'}</legend>
      <label class="field"><span>Spice</span><select name="${prefix}_spice">${options([...Array(spiceMax + 1).keys()].map(n => [n, n]), preset.spice ?? 0)}</select></label>
      <label class="field"><span>A secret</span><select name="${prefix}_secret">${options([['', 'None'], ...secrets.map(s => [secretVal(s), prefix === 'give' ? s.label : neg.describeSecret(s, names)])], sec ? (sec.kind === 'resale' ? `resale:${sec.entryId}` : sec.kind) : '')}</select></label>
      <label class="field"><span>${prefix === 'give' ? 'Your promise' : 'Their promise'}</span><select name="${prefix}_promise">${options([['', 'None'], ...types.map(t => [t, PROMISE_LABEL[t]])], p.type ?? '')}</select></label>
      <label class="field" data-for="${prefix}:noEnter"><span>Territory</span><select name="${prefix}_territory">${options(territoryOptions, p.territoryId)}</select></label>
      <label class="field" data-for="${prefix}:noAttack ${prefix}:noTraitorOn ${prefix}:allianceAt"><span>Faction</span><select name="${prefix}_faction">${options(others.map(f => [f, factionName(f)]), p.factionId ?? (prefix === 'give' ? to : me))}</select></label>
      <label class="field" data-for="${prefix}:bidPass"><span>Card</span><select name="${prefix}_card">${options([...Array(cards).keys()].map(i => [i, `Card ${i + 1} of ${cards}`]), p.cardIndex ?? 0)}</select></label>
      <label class="field" data-for="${prefix}:noEnter ${prefix}:noAttack ${prefix}:noTraitorOn"><span>For</span><select name="${prefix}_turns">${options([[1, '1 turn'], [2, '2 turns'], [3, '3 turns']], p.turns ?? 1)}</select></label>
    </fieldset>`;
  }

  function readSide(p, prefix) {
    const v = n => p.querySelector(`[name="${prefix}_${n}"]`)?.value ?? '';
    const side = { spice: Number(v('spice')) || 0, secrets: [], promises: [] };
    const sec = v('secret');
    if (sec) side.secrets.push(sec.startsWith('resale:') ? { kind: 'resale', entryId: sec.slice(7) } : { kind: sec });
    const type = v('promise');
    if (type) {
      const pr = { type };
      if (type === 'noEnter') pr.territoryId = v('territory');
      if (['noAttack', 'noTraitorOn', 'allianceAt'].includes(type)) pr.factionId = v('faction');
      if (type === 'bidPass') pr.cardIndex = Number(v('card'));
      if (['noEnter', 'noAttack', 'noTraitorOn'].includes(type)) pr.turns = Number(v('turns'));
      side.promises.push(pr);
    }
    return side;
  }

  // Validate against a copy of the state, so nothing is recorded until the engine makes it.
  function trial(state, me, to, give, ask, counterOf) {
    const copy = structuredClone(state);
    return neg.makeOffer(copy, { from: me, to, give, ask, counterOf });
  }

  // Resolves with { to, give, ask } or null.
  function buildOffer(state, me, { fixedTo = null, preset = null, counterOf = null, title = null } = {}) {
    const ctx = neg.currentWindow(state);
    const targets = fixedTo ? [fixedTo] : Object.keys(state.factions).filter(f => f !== me && !neg.dealBlockedReason(state, me, f) && neg.canReceiveOffer(state, f));
    if (!targets.length) return Promise.resolve(null);
    let to = fixedTo ?? targets[0];
    const body = () => `
      ${fixedTo ? `<p class="decision__note">Your counter to ${esc(factionName(to))}. They can only accept or refuse it.</p>`
        : `<label class="field"><span>Offer to</span><select name="to">${options(targets.map(f => [f, factionName(f)]), to)}</select></label>`}
      ${sideHtml(state, me, to, 'give', preset?.give)}
      ${sideHtml(state, me, to, 'ask', preset?.ask)}
      <p class="deal-summary" aria-live="polite"></p>
      <p class="decision__error" hidden></p>
      <p class="decision__note">Deals are binding: once accepted, the game holds both sides to them. Bribe spice reaches them at the Mentat Pause.</p>
      <div class="decision__actions">
        <button class="btn btn--primary" data-action="send">${counterOf ? 'Send counter' : 'Send offer'}</button>
        <button class="btn" data-default-action>${counterOf ? 'Refuse instead' : 'Not now'}</button>
      </div>`;
    return ask(title ?? `Negotiate: ${windowTitle(ctx)}`, `<div class="deal-form">${body()}</div>`, (p, done) => {
      const form = p.querySelector('.deal-form');
      const wire = () => {
        const send = form.querySelector('[data-action="send"]');
        const refresh = () => {
          for (const el of form.querySelectorAll('[data-for]')) {
            const keys = el.dataset.for.split(' ');
            el.hidden = !keys.some(k => { const [pre, t] = k.split(':'); return form.querySelector(`[name="${pre}_promise"]`).value === t; });
          }
          const give = readSide(form, 'give'), askSide = readSide(form, 'ask');
          const r = trial(state, me, to, give, askSide, counterOf);
          form.querySelector('.deal-summary').textContent = r.ok ? `You give ${neg.describeSide(r.offer.give, names)}. You get ${neg.describeSide(r.offer.ask, names)}.` : '';
          const err = form.querySelector('.decision__error');
          err.textContent = r.ok ? '' : r.reason; err.hidden = r.ok;
          send.disabled = !r.ok;
        };
        form.querySelectorAll('select').forEach(sel => { sel.onchange = refresh; });
        const toSel = form.querySelector('[name="to"]');
        if (toSel) toSel.onchange = () => { to = toSel.value; form.innerHTML = body(); wire(); };
        send.onclick = () => done({ to, give: readSide(form, 'give'), ask: readSide(form, 'ask') });
        form.querySelector('[data-default-action]').onclick = () => done(null);
        refresh();
      };
      wire();
    });
  }

  // --- Incoming offer ---------------------------------------------------------

  function respond(state, me, offer) {
    const ctx = neg.currentWindow(state);
    const canCounter = neg.canCounter(state, offer.id);
    const cantPay = (offer.ask.spice ?? 0) > state.factions[me].spice;
    const title = offer.counterOf ? `${factionName(offer.from)} counters` : `${factionName(offer.from)} makes an offer`;
    return ask(title,
      `<p class="decision__note">${esc(windowTitle(ctx))}</p>
       <dl class="facts"><dt>They give</dt><dd>${esc(neg.describeSide(offer.give, names))}</dd>
       <dt>They want</dt><dd>${esc(neg.describeSide(offer.ask, names))}</dd></dl>
       ${cantPay ? `<p class="decision__error">You don't have ${offer.ask.spice} spice behind your shield.</p>` : ''}
       <p class="decision__note">Deals are binding: once accepted, the game holds both sides to them.</p>
       <div class="decision__actions">
         <button class="btn btn--primary" data-action="accept"${cantPay ? ' disabled' : ''}>Accept</button>
         ${canCounter ? '<button class="btn" data-action="counter">Counter</button>' : ''}
         <button class="btn" data-default-action>Refuse</button>
       </div>`,
      (p, done) => {
        p.querySelector('[data-action="accept"]').onclick = () => done({ action: 'accept' });
        p.querySelector('[data-default-action]').onclick = () => done({ action: 'refuse' });
        const c = p.querySelector('[data-action="counter"]');
        if (c) c.onclick = () => done({ action: 'counter' });
      }).then(async r => {
        if (r.action !== 'counter') return r;
        // Counter: start from the mirror of their offer.
        const built = await buildOffer(state, me, { fixedTo: offer.from, counterOf: offer.id, title: `Counter ${factionName(offer.from)}`,
          preset: { give: offer.ask, ask: offer.give } });
        return built ? { action: 'counter', counter: { give: built.give, ask: built.ask } } : { action: 'refuse' };
      });
  }

  return { buildOffer, respond, windowTitle };
}
