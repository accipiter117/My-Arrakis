// ui/humanProvider.js
//
// The human player's side of the decision-provider interface. Each method
// shows a form in the decision panel and returns a Promise that resolves
// when the player confirms. The async turn engine simply waits.
//
// Every form validates live using the same rule checks the AI's decisions
// go through (canBid, canShip, canMove, canReviveForces,
// canDeclareBattlePlan), so the player sees why a choice is illegal before
// committing, and the engine re-validates anyway.
//
// Every form's default action is always legal (pass, no shipment, a
// straightforward battle plan), so the player can never get stuck.

import * as biddingEngine from '../js/biddingEngine.js';
import * as revivalEngine from '../js/revivalEngine.js';
import * as movementEngine from '../js/movementEngine.js';
import * as battleEngine from '../js/battleEngine.js';

const WEAPONS = ['poisonWeapon', 'projectileWeapon', 'specialWeapon'];
const DEFENSES = ['poisonDefense', 'projectileDefense'];
const CATEGORY_NAMES = {
  poisonWeapon: 'a poison weapon', projectileWeapon: 'a projectile weapon', specialWeapon: 'a Lasgun',
  poisonDefense: 'a poison defence (Snooper)', projectileDefense: 'a projectile defence (Shield)',
  worthless: 'a worthless card', specialLeaderSubstitute: 'a Cheap Hero'
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const options = (pairs, selected) => pairs.map(([v, label]) =>
  `<option value="${esc(v)}"${String(v) === String(selected) ? ' selected' : ''}>${esc(label)}</option>`).join('');
const range = (min, max) => Array.from({ length: Math.max(0, max - min + 1) }, (_, i) => min + i);

export function createHumanProvider({ panel, leadersData, cardLookup, territoriesData, factionNames, onWaiting }) {
  const leader = {};
  for (const list of Object.values(leadersData)) {
    if (!Array.isArray(list)) continue;
    for (const l of list) leader[l.id] = l;
  }
  const leaderLabel = id => `${leader[id]?.name ?? id} (${leader[id]?.fightingValue ?? 0})`;
  const territoryName = id => territoriesData.territories[id]?.name ?? id;
  const cardName = id => cardLookup[id]?.name ?? id;
  const factionName = id => factionNames[id] ?? id;

  // Shows a form and resolves with whatever `bind` passes to done().
  function ask(title, html, bind) {
    return new Promise(resolve => {
      panel.innerHTML = `<div class="decision__head"><h2 class="decision__title">${esc(title)}</h2>
        <button class="icon-btn decision__toggle" aria-label="Shrink this panel to see the map">▾</button></div>
        <div class="decision__body">${html}</div>`;
      panel.classList.remove('decision-panel--collapsed');
      // Shrink to the title bar to see (and tap) the map, tap again to return.
      const toggle = panel.querySelector('.decision__toggle');
      const flip = () => {
        const collapsed = panel.classList.toggle('decision-panel--collapsed');
        toggle.textContent = collapsed ? '▴' : '▾';
        toggle.setAttribute('aria-label', collapsed ? 'Expand this panel' : 'Shrink this panel to see the map');
      };
      toggle.onclick = flip;
      panel.querySelector('.decision__title').onclick = () => { if (panel.classList.contains('decision-panel--collapsed')) flip(); };
      panel.hidden = false;
      onWaiting?.(true);
      const done = value => {
        panel._cleanup?.();
        panel._cleanup = null;
        panel.classList.remove('decision-panel--collapsed');
        panel.hidden = true;
        panel.innerHTML = '';
        onWaiting?.(false);
        resolve(value);
      };
      bind(panel, done);
      panel.querySelector('select, input, button')?.focus();
    });
  }

  const field = (p, name) => p.querySelector(`[name="${name}"]`);
  const num = (p, name) => Number(field(p, name)?.value ?? 0);
  const setError = (p, message) => {
    const el = p.querySelector('.decision__error');
    el.textContent = message ?? '';
    el.hidden = !message;
  };

  return {
    name: 'You',

    chooseStormDial(state, factionId, isFirst) {
      const [min, max] = isFirst ? [0, 20] : [1, 3];
      return ask('Dial the storm',
        `<p>You are one of the two players setting the storm's movement. Both dials are added together${isFirst ? ' to place the first storm' : ''}.</p>
         <label class="field"><span>Your dial</span><select name="dial">${options(range(min, max).map(n => [n, n]), min)}</select></label>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Set dial</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () => done(num(p, 'dial')));
    },

    chooseTraitor(state, factionId, hand) {
      // Pre-select the strongest opponent leader, the usual best keep.
      const ranked = hand.slice().sort((a, b) =>
        (b.factionId !== factionId) - (a.factionId !== factionId) ||
        (leader[b.leaderId]?.fightingValue ?? 0) - (leader[a.leaderId]?.fightingValue ?? 0));
      const best = ranked[0].leaderId;
      const choices = hand.map(c => `
        <label class="choice">
          <input type="radio" name="traitor" value="${esc(c.leaderId)}"${c.leaderId === best ? ' checked' : ''}>
          <span>${esc(leaderLabel(c.leaderId))} <em>${esc(factionName(c.factionId))}${c.factionId === factionId ? ', your own leader' : ''}</em></span>
        </label>`).join('');
      return ask('Choose your traitor',
        `<p>Keep one. If that leader fights against you, you can reveal them as a traitor and win the battle outright. The other three go back to the deck.</p>
         <div class="choices">${choices}</div>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Keep this traitor</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () =>
          done(p.querySelector('input[name="traitor"]:checked').value));
    },

    choosePrediction(state, factionId) {
      const others = Object.keys(state.factions).filter(f => f !== factionId);
      const maxTurns = state.rulesConfig.victoryVariants.maxTurns;
      return ask('Make your secret Prediction',
        `<p>If the faction you name wins on exactly the turn you name, you win alone instead. It doesn't count if they win through the Guild or Fremen special condition.</p>
         <label class="field"><span>Faction</span><select name="faction">${options(others.map(f => [f, factionName(f)]), others[0])}</select></label>
         <label class="field"><span>Turn</span><select name="turn">${options(range(1, maxTurns).map(n => [n, n]), maxTurns)}</select></label>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Seal prediction</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () =>
          done({ factionId: field(p, 'faction').value, turn: num(p, 'turn') }));
    },

    chooseBid(state, factionId, cardId, currentBid) {
      const me = state.factions[factionId];
      const b = state.bidding;
      const seen = factionId === 'atreides' && cardId
        ? `<p class="decision__note">Prescience: this card is <strong>${esc(cardName(cardId))}</strong>.</p>` : '';
      const leading = b.currentBidder ? `${factionName(b.currentBidder)} leads at ${currentBid}` : 'No bids yet';
      return ask(`Treachery card ${b.currentCardIndex + 1} of ${b.cardsUpForBid.length}`,
        `${seen}
         <dl class="facts"><dt>Current bid</dt><dd>${esc(leading)}</dd><dt>Your spice</dt><dd>${me.spice}</dd>
         <dt>Your hand</dt><dd>${me.treacheryHand.length} / ${biddingEngine.handLimitFor(factionId)}</dd></dl>
         <label class="field"><span>Your bid</span><input type="number" name="bid" min="${currentBid + 1}" max="${me.spice}" value="${currentBid + 1}"></label>
         <p class="decision__error" hidden></p>
         <div class="decision__actions">
           <button class="btn btn--primary" data-action="bid">Bid</button>
           <button class="btn" data-default-action>Pass</button>
         </div>`,
        (p, done) => {
          const bidBtn = p.querySelector('[data-action="bid"]');
          const check = () => {
            const result = biddingEngine.canBid(state, factionId, num(p, 'bid'));
            setError(p, result.ok ? null : result.reason);
            bidBtn.disabled = !result.ok;
          };
          field(p, 'bid').oninput = check;
          check();
          bidBtn.onclick = () => done(num(p, 'bid'));
          p.querySelector('[data-default-action]').onclick = () => done(null);
        });
    },

    chooseRevival(state, factionId) {
      const me = state.factions[factionId];
      const tanks = me.revivalTanks ?? 0;
      const starredTanks = me.starredRevivalTanks ?? 0;
      const free = revivalEngine.freeRevivalAllowance(factionId, state);
      const leaderEligible = revivalEngine.isEligibleForLeaderRevival(state, factionId) && me.leaders.killed.length > 0;
      const hasGhola = me.treacheryHand.includes('ghola');
      if (tanks === 0 && !leaderEligible && !(hasGhola && me.leaders.killed.length)) return { forces: 0, starred: 0, leaderId: null };
      const gholaSelect = !hasGhola ? '' : `<label class="field"><span>Play Ghola (free)</span><select name="ghola">${options([
          ['', 'Keep the card'],
          ...me.leaders.killed.map(id => [`leader:${id}`, `Revive ${leaderLabel(id)}`]),
          ...range(1, Math.min(5, tanks)).map(n => [`forces:${n}`, `Revive ${n} force${n > 1 ? 's' : ''}`])
        ], '')}</select></label>`;

      const leaderSelect = leaderEligible
        ? `<label class="field"><span>Revive a leader</span><select name="leader">${options(
            [['', 'None'], ...me.leaders.killed.map(id => [id, `${leaderLabel(id)}, costs ${leader[id]?.fightingValue ?? 0} spice`])], '')}</select></label>` : '';
      const starredSelect = starredTanks > 0
        ? `<label class="field"><span>Of which starred</span><select name="starred">${options(range(0, 1).map(n => [n, n]), 0)}</select></label>` : '';
      return ask('Revival',
        `<dl class="facts"><dt>In the tanks</dt><dd>${tanks}</dd><dt>Free this turn</dt><dd>${free}</dd><dt>Your spice</dt><dd>${me.spice}</dd></dl>
         <p>Up to 3 forces a turn. Beyond your free allowance, each costs 2 spice.</p>
         <label class="field"><span>Forces</span><select name="forces">${options(range(0, Math.min(3, tanks)).map(n => [n, n]), Math.min(free, tanks))}</select></label>
         ${starredSelect}${leaderSelect}${gholaSelect}
         <p class="decision__cost"></p><p class="decision__error" hidden></p>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm revival</button></div>`,
        (p, done) => {
          const btn = p.querySelector('[data-default-action]');
          const check = () => {
            const forces = num(p, 'forces');
            const starred = Math.min(num(p, 'starred'), forces);
            if (forces === 0) { setError(p, null); btn.disabled = false; p.querySelector('.decision__cost').textContent = ''; return; }
            const result = revivalEngine.canReviveForces(state, factionId, forces, starred);
            setError(p, result.ok ? null : result.reason);
            p.querySelector('.decision__cost').textContent = result.ok ? `Cost: ${result.cost} spice` : '';
            btn.disabled = !result.ok;
          };
          p.querySelectorAll('select').forEach(s => s.onchange = check);
          check();
          btn.onclick = () => {
            const leaderId = field(p, 'leader')?.value || null;
            const g = field(p, 'ghola')?.value || '';
            const ghola = g.startsWith('leader:') ? { leaderId: g.slice(7) } : g.startsWith('forces:') ? { forces: Number(g.slice(7)) } : null;
            done({
              ghola,
              forces: num(p, 'forces'), starred: Math.min(num(p, 'starred'), num(p, 'forces')),
              leaderId, leaderFightingValue: leaderId ? (leader[leaderId]?.fightingValue ?? 0) : undefined
            });
          };
        });
    },

    chooseShipmentAndMovement(state, factionId) {
      const me = state.factions[factionId];
      const territoryIds = Object.keys(state.board.territories).sort((a, b) => territoryName(a).localeCompare(territoryName(b)));
      const shipOptions = [['', 'No shipment'], ...territoryIds.map(id => [id, `${territoryName(id)} (${movementEngine.shipmentCostPerForce(state, factionId, id)} per force)`])];
      const fromOptions = [['', 'No movement'], ...Object.entries(me.forces.onBoard).map(([id, n]) => [id, `${territoryName(id)} (${n} forces)`])];
      const range_ = movementEngine.moveRangeFor(state, factionId);

      return ask('Shipment and movement',
        `<dl class="facts"><dt>Reserves</dt><dd>${me.forces.reserve}</dd><dt>Your spice</dt><dd>${me.spice}</dd><dt>Move range</dt><dd>${range_} territor${range_ === 1 ? 'y' : 'ies'}</dd></dl>
         <fieldset><legend>Ship from reserves</legend>
           <label class="field"><span>Destination</span><select name="shipTo">${options(shipOptions, '')}</select></label>
           <label class="field"><span>Forces</span><input type="number" name="shipAmount" min="1" max="${me.forces.reserve}" value="${Math.min(3, me.forces.reserve)}"></label>
           <p class="decision__cost" data-for="ship"></p>
         </fieldset>
         <fieldset><legend>Move one group</legend>
           <label class="field"><span>From</span><select name="moveFrom">${options(fromOptions, '')}</select></label>
           <label class="field"><span>To</span><select name="moveTo"><option value="">Choose a starting territory</option></select></label>
           <label class="field"><span>Forces</span><input type="number" name="moveAmount" min="1" value="1"></label>
           <p class="decision__note">Your shipment happens first, then your move. Tip: tap ▾ to see the map, where legal choices are outlined; tapping a territory fills this in.</p>
         </fieldset>
         ${me.treacheryHand.includes('hajr') ? `<fieldset><legend>Hajr: an extra move (uses the card)</legend>
           <label class="field"><span>From</span><select name="hajrFrom">${options(fromOptions.map(([v, l]) => [v, v ? l : 'Keep the card']), '')}</select></label>
           <label class="field"><span>To</span><select name="hajrTo"><option value="">Choose a starting territory</option></select></label>
           <label class="field"><span>Forces</span><input type="number" name="hajrAmount" min="1" value="1"></label>
           <p class="decision__note">Made after your normal move. Checked again when it happens.</p>
         </fieldset>` : ''}
         ${factionId === 'guild' ? `<fieldset><legend>Guild: or ship on the planet instead</legend>
           <label class="field"><span>Type</span><select name="gType">${options([['', 'Ship from reserves (above)'], ['cross', 'Across the planet'], ['retreat', 'Back to reserves (1 spice per 2)']], '')}</select></label>
           <label class="field"><span>From</span><select name="gFrom">${options(Object.entries(me.forces.onBoard).map(([id, n]) => [id, `${territoryName(id)} (${n})`]), Object.keys(me.forces.onBoard)[0])}</select></label>
           <label class="field"><span>To</span><select name="gTo">${options(territoryIds.map(id => [id, territoryName(id)]), territoryIds[0])}</select></label>
           <label class="field"><span>Forces</span><input type="number" name="gAmount" min="1" value="1"></label>
         </fieldset>` : ''}
         <p class="decision__error" hidden></p>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm</button></div>`,
        (p, done) => {
          const btn = p.querySelector('[data-default-action]');
          const refreshDestinations = () => {
            const from = field(p, 'moveFrom').value;
            const reachable = from ? movementEngine.reachableTerritories(state, factionId, from, range_) : [];
            field(p, 'moveTo').innerHTML = from
              ? options(reachable.map(id => [id, territoryName(id)]), reachable[0])
              : '<option value="">Choose a starting territory</option>';
            if (from) field(p, 'moveAmount').value = me.forces.onBoard[from];
          };
          // Outline legal choices on the map: where this group can move
          // once one is chosen, otherwise where the shipment can land.
          const highlight = () => {
            const from = field(p, 'moveFrom').value;
            const ids = from
              ? movementEngine.reachableTerritories(state, factionId, from, range_)
              : territoryIds.filter(id => movementEngine.canShip(state, factionId, id, Math.max(1, num(p, 'shipAmount'))).ok);
            document.dispatchEvent(new CustomEvent('board-highlight', { detail: { ids } }));
          };
          const check = () => {
            highlight();
            const problems = [];
            const shipTo = field(p, 'shipTo').value;
            const costEl = p.querySelector('[data-for="ship"]');
            costEl.textContent = '';
            if (shipTo) {
              const r = movementEngine.canShip(state, factionId, shipTo, num(p, 'shipAmount'));
              if (r.ok) costEl.textContent = `Cost: ${r.totalCost} spice`;
              else problems.push(`Shipment: ${r.reason}`);
            }
            const from = field(p, 'moveFrom').value;
            const to = field(p, 'moveTo').value;
            if (from) {
              if (!to) problems.push('Movement: nothing reachable from there.');
              else {
                const r = movementEngine.canMove(state, factionId, from, to, num(p, 'moveAmount'));
                if (!r.ok) problems.push(`Movement: ${r.reason}`);
              }
            }
            const gType = field(p, 'gType')?.value;
            if (gType) {
              if (field(p, 'shipTo').value) problems.push('Choose either a shipment from reserves or a Guild planet shipment, not both.');
              const r = gType === 'cross'
                ? movementEngine.canCrossShip(state, 'guild', field(p, 'gFrom').value, field(p, 'gTo').value, num(p, 'gAmount'))
                : movementEngine.canRetreatToReserves(state, 'guild', field(p, 'gFrom').value, num(p, 'gAmount'));
              if (!r.ok) problems.push(`Guild shipment: ${r.reason}`);
            }
            setError(p, problems.join(' ') || null);
            btn.disabled = problems.length > 0;
          };
          field(p, 'moveFrom').onchange = () => { refreshDestinations(); check(); };
          // Tapping the map fills the form: a reachable destination for the
          // chosen group, else one of my territories as the starting point,
          // else a shipment destination.
          const hasOption = (name, id) => [...field(p, name).options].some(o => o.value === id);
          const onTap = e => {
            const id = e.detail.id;
            if (field(p, 'moveFrom').value && hasOption('moveTo', id)) field(p, 'moveTo').value = id;
            else if (!field(p, 'moveFrom').value && (me.forces.onBoard[id] ?? 0) > 0 && hasOption('moveFrom', id)) { field(p, 'moveFrom').value = id; refreshDestinations(); }
            else if (hasOption('shipTo', id)) field(p, 'shipTo').value = id;
            check();
          };
          document.addEventListener('territory-tap', onTap);
          p._cleanup = () => {
            document.removeEventListener('territory-tap', onTap);
            document.dispatchEvent(new CustomEvent('board-highlight', { detail: { ids: [] } }));
          };
          if (field(p, 'hajrFrom')) field(p, 'hajrFrom').onchange = () => {
            const from = field(p, 'hajrFrom').value;
            const reachable = from ? movementEngine.reachableTerritories(state, factionId, from, range_) : [];
            field(p, 'hajrTo').innerHTML = from ? options(reachable.map(id => [id, territoryName(id)]), reachable[0]) : '<option value="">Choose a starting territory</option>';
            if (from) field(p, 'hajrAmount').value = me.forces.onBoard[from];
          };
          p.querySelectorAll('select, input').forEach(el => { if (!['moveFrom', 'hajrFrom'].includes(el.name)) el.oninput = el.onchange = check; });
          check();
          btn.onclick = () => {
            const shipTo = field(p, 'shipTo').value;
            const from = field(p, 'moveFrom').value;
            done({
              shipment: shipTo ? { territoryId: shipTo, amount: num(p, 'shipAmount') } : null,
              movement: from ? { from, to: field(p, 'moveTo').value, amount: num(p, 'moveAmount') } : null,
              crossShip: field(p, 'gType')?.value === 'cross' ? { from: field(p, 'gFrom').value, to: field(p, 'gTo').value, amount: num(p, 'gAmount') } : null,
              retreat: field(p, 'gType')?.value === 'retreat' ? { from: field(p, 'gFrom').value, amount: num(p, 'gAmount') } : null,
              hajrMove: field(p, 'hajrFrom')?.value
                ? { from: field(p, 'hajrFrom').value, to: field(p, 'hajrTo').value, amount: num(p, 'hajrAmount') } : null
            });
          };
        });
    },

    chooseRevealTraitor(state, holder, leaderId, territoryId, againstId, forFaction) {
      const forAlly = forFaction !== holder;
      return ask('Traitor!',
        `<p class="decision__traitor"><strong>${esc(leaderLabel(leaderId))}</strong>, leading ${esc(factionName(againstId))} in ${esc(territoryName(territoryId))}, is secretly in your pay.</p>
         <p>Reveal them and ${forAlly ? `your ally ${esc(factionName(forFaction))}` : 'you'} win outright, losing nothing, while ${esc(factionName(againstId))} loses everything there. Or keep the secret and let the battle play out, saving the traitor for a bigger moment.</p>
         <div class="decision__actions">
           <button class="btn" data-action="keep">Keep the secret</button>
           <button class="btn btn--primary" data-default-action>Reveal the traitor</button>
         </div>`,
        (p, done) => {
          p.querySelector('[data-action="keep"]').onclick = () => done(false);
          p.querySelector('[data-default-action]').onclick = () => done(true);
        });
    },

    chooseAllianceProposal(state, me) {
      const allyOf = f => (state.alliances ?? []).find(a => a.factions.includes(f));
      const strongholdsOf = f => Object.keys(state.board.territories)
        .filter(t => state.board.territories[t].type === 'stronghold' && (state.factions[f].forces.onBoard[t] ?? 0) > 0);
      const candidates = Object.keys(state.factions).filter(f => f !== me && !allyOf(f));
      if (!candidates.length) return null;
      const betrayed = f => (state.meta.betrayals ?? []).some(b => b.by === f);
      const rows = candidates.map(f => {
        const held = strongholdsOf(f).map(territoryName);
        return `<label class="choice"><input type="radio" name="partner" value="${f}"> <span>${esc(factionName(f))}
          <em>${held.length ? held.join(', ') : 'no strongholds'}${betrayed(f) ? ' · has broken an alliance before' : ''}</em></span></label>`;
      }).join('');
      return ask('Nexus: propose an alliance?',
        `<p>Allies win together with <strong>4 strongholds</strong> between them, share their special victories, and gain each other's alliance advantages. Allies can't enter each other's territories, except the Polar Sink.</p>
         <div class="choices">${rows}</div>
         <div class="decision__actions">
           <button class="btn" data-action="propose">Propose</button>
           <button class="btn" data-default-action>No proposal</button>
         </div>`,
        (p, done) => {
          p.querySelector('[data-action="propose"]').onclick = () => done(p.querySelector('input[name="partner"]:checked')?.value ?? null);
          p.querySelector('[data-default-action]').onclick = () => done(null);
        });
    },

    chooseAllianceResponse(state, me, proposer) {
      const strongholdsOf = f => Object.keys(state.board.territories)
        .filter(t => state.board.territories[t].type === 'stronghold' && (state.factions[f].forces.onBoard[t] ?? 0) > 0);
      const theirs = strongholdsOf(proposer), mine = strongholdsOf(me);
      const combined = new Set([...theirs, ...mine]).size;
      const betrayed = (state.meta.betrayals ?? []).filter(b => b.by === proposer).length;
      return ask(`${factionName(proposer)} proposes an alliance`,
        `<dl class="facts"><dt>They hold</dt><dd>${theirs.length ? esc(theirs.map(territoryName).join(', ')) : 'no strongholds'}</dd>
         <dt>Together</dt><dd>${combined} of the 4 strongholds an alliance needs</dd>
         ${betrayed ? `<dt>Warning</dt><dd>They have broken ${betrayed} alliance${betrayed > 1 ? 's' : ''} before</dd>` : ''}</dl>
         <p>Allied, you win together, and neither of you may enter the other's territories (except the Polar Sink).</p>
         <div class="decision__actions">
           <button class="btn" data-action="accept">Accept</button>
           <button class="btn" data-default-action>Reject</button>
         </div>`,
        (p, done) => {
          p.querySelector('[data-action="accept"]').onclick = () => done(true);
          p.querySelector('[data-default-action]').onclick = () => done(false);
        });
    },

    chooseBreakAlliance(state, me, ally) {
      return ask('Nexus: your alliance',
        `<p>You are allied with <strong>${esc(factionName(ally))}</strong>. Breaking it is public, and the other factions will remember it when you next seek an ally.</p>
         <div class="decision__actions">
           <button class="btn" data-action="break">Break the alliance</button>
           <button class="btn" data-default-action>Keep it</button>
         </div>`,
        (p, done) => {
          p.querySelector('[data-action="break"]').onclick = () => done(true);
          p.querySelector('[data-default-action]').onclick = () => done(false);
        });
    },

    chooseFremenPlacement(state) {
      const sel = (name, v) => `<select name="${name}">${options(range(0, 10).map(n => [n, n]), v)}</select>`;
      return ask('Place your forces',
        `<p>Split your 10 starting forces between these three territories as you choose.</p>
         <label class="field"><span>Sietch Tabr</span>${sel('st', 10)}</label>
         <label class="field"><span>False Wall South</span>${sel('fs', 0)}</label>
         <label class="field"><span>False Wall West</span>${sel('fw', 0)}</label>
         <p class="decision__error" hidden></p>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Place forces</button></div>`,
        (p, done) => {
          const btn = p.querySelector('[data-default-action]');
          const check = () => {
            const total = num(p, 'st') + num(p, 'fs') + num(p, 'fw');
            setError(p, total === 10 ? null : `That places ${total}; it must be exactly 10.`);
            btn.disabled = total !== 10;
          };
          p.querySelectorAll('select').forEach(el => el.onchange = check);
          check();
          btn.onclick = () => done({ sietchTabr: num(p, 'st'), falseWallSouth: num(p, 'fs'), falseWallWest: num(p, 'fw') });
        });
    },

    chooseAdvisor(state, factionId, shipperId) {
      return ask('Spiritual Advisor',
        `<p>${esc(factionName(shipperId))} just shipped in from off-planet. You may place 1 force from your reserves in the Polar Sink, free.</p>
         <div class="decision__actions">
           <button class="btn" data-action="yes">Place an advisor</button>
           <button class="btn" data-default-action>Not this time</button>
         </div>`,
        (p, done) => {
          p.querySelector('[data-action="yes"]').onclick = () => done(true);
          p.querySelector('[data-default-action]').onclick = () => done(false);
        });
    },

    chooseGuildTiming(state, others) {
      const choices = [[0, 'First, before everyone'], ...others.slice(0, -1).map((f, i) => [i + 1, `After ${factionName(f)}`]), [others.length, 'Last, after everyone']];
      return ask('When will the Guild act?',
        `<p>As the Spacing Guild you may take your shipment and movement at any point in the order this turn. Acting last lets you see everyone else's moves first.</p>
         <label class="field"><span>Act</span><select name="pos">${options(choices, others.length)}</select></label>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () => done(num(p, 'pos')));
    },

    chooseKaramaCancel(state, factionId, purpose, ctx) {
      const place = territoryName(ctx.territoryId);
      const what = {
        voice: `Bene Gesserit use the Voice on you in ${place}: you ${ctx.voice?.command === 'play' ? 'must play' : 'must not play'} ${CATEGORY_NAMES[ctx.voice?.category] ?? 'a kind of card'}.`,
        prescience: `Atreides are about to see part of your battle plan in ${place} (Prescience).`,
        capture: `Harkonnen are about to capture your leader ${leaderLabel(ctx.leaderId)}.`
      }[purpose];
      return ask('Play Karama?',
        `<p>${esc(what)}</p><p>Play a Karama card to cancel it. The card is then discarded.</p>
         <div class="decision__actions">
           <button class="btn btn--primary" data-action="karama">Play Karama</button>
           <button class="btn" data-default-action>Let it happen</button>
         </div>`,
        (p, done) => {
          p.querySelector('[data-action="karama"]').onclick = () => done(true);
          p.querySelector('[data-default-action]').onclick = () => done(false);
        });
    },

    chooseAllyPledge(state, factionId, allyId) {
      const spice = state.factions[factionId].spice;
      const steps = [...new Set([0, 2, 4, 6, 8, 10, 15, 20, 30].filter(n => n <= spice).concat(spice))].sort((a, b) => a - b);
      return ask('Help your ally this turn?',
        `<p>You may pledge spice toward ${esc(factionName(allyId))}'s treachery cards and shipments this turn. They spend their own spice first; unused pledge stays yours.</p>
         <dl class="facts"><dt>Your spice</dt><dd>${spice}</dd></dl>
         <label class="field"><span>Pledge</span><select name="pledge">${options(steps.map(n => [n, n ? `${n} spice` : 'Nothing']), 0)}</select></label>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () => done(num(p, 'pledge')));
    },

    chooseEmperorAllyRevival(state, factionId, allyId) {
      const ally = state.factions[allyId];
      const max = Math.max(0, Math.min(3, (ally.revivalTanks ?? 0) - (ally.starredRevivalTanks ?? 0), Math.floor(state.factions.emperor.spice / 2)));
      if (!max) return 0;
      return ask('Revive forces for your ally?',
        `<p>As the Emperor you may pay for up to 3 extra forces for ${esc(factionName(allyId))} this turn, beyond their normal limit, at 2 spice each.</p>
         <dl class="facts"><dt>Your spice</dt><dd>${state.factions.emperor.spice}</dd><dt>Their tanks</dt><dd>${ally.revivalTanks ?? 0}</dd></dl>
         <label class="field"><span>Revive</span><select name="n">${options(range(0, max).map(n => [n, n ? `${n} for ${n * 2} spice` : 'None']), 0)}</select></label>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () => done(num(p, 'n')));
    },

    chooseVoice(state, factionId, territoryId, targetId) {
      const categories = Object.entries(CATEGORY_NAMES);
      return ask(`The Voice: battle in ${territoryName(territoryId)}`,
        `<p>Command ${esc(factionName(targetId))} to play, or not to play, one kind of card. If they can't comply, they play as they wish.</p>
         <label class="field"><span>Command</span><select name="command">${options([['notPlay', 'Must NOT play'], ['play', 'MUST play']], 'notPlay')}</select></label>
         <label class="field"><span>Card</span><select name="category">${options(categories, 'poisonDefense')}</select></label>
         <div class="decision__actions">
           <button class="btn btn--primary" data-action="voice">Use the Voice</button>
           <button class="btn" data-default-action>Stay silent</button>
         </div>`,
        (p, done) => {
          p.querySelector('[data-action="voice"]').onclick = () => done({ command: field(p, 'command').value, category: field(p, 'category').value });
          p.querySelector('[data-default-action]').onclick = () => done(null);
        });
    },

    chooseCardsToDiscard(state, factionId, played) {
      const rows = played.map(id => `<label class="choice"><input type="checkbox" name="discard" value="${esc(id)}"${cardLookup[id]?.category === 'worthless' ? ' checked' : ''}> <span>Discard ${esc(cardName(id))}</span></label>`).join('');
      return ask('You won the battle',
        `<p>You may keep or discard each card you played. Unticked cards stay in your hand.</p>
         <div class="choices">${rows}</div>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () =>
          done([...p.querySelectorAll('input[name="discard"]:checked')].map(i => i.value)));
    },

    chooseCaptureAction(state, factionId, leaderId, fromId) {
      return ask('Captured leader',
        `<p>You captured <strong>${esc(leaderLabel(leaderId))}</strong> from ${esc(factionName(fromId))}.</p>
         <p>Kill them now for 2 spice, or keep them to lead one of your battles before they return home. A captured leader stays loyal to ${esc(factionName(fromId))}: if you use them against ${esc(factionName(fromId))}, they can turn traitor.</p>
         <div class="decision__actions">
           <button class="btn" data-action="keep">Keep</button>
           <button class="btn btn--primary" data-default-action>Kill for 2 spice</button>
         </div>`,
        (p, done) => {
          p.querySelector('[data-action="keep"]').onclick = () => done('keep');
          p.querySelector('[data-default-action]').onclick = () => done('kill');
        });
    },

    chooseWormRide(state, factionId, from) {
      const destinations = Object.keys(state.board.territories)
        .filter(id => movementEngine.canRideWorm(state, from, id).ok)
        .sort((a, b) => territoryName(a).localeCompare(territoryName(b)));
      return ask('Ride Shai-Hulud',
        `<p>A worm rose in ${esc(territoryName(from))}. Your ${state.factions.fremen.forces.onBoard[from]} forces there were not eaten, and may ride it to any one territory.</p>
         <label class="field"><span>Ride to</span><select name="to">${options([['', 'Stay where we are'], ...destinations.map(id => [id, territoryName(id)])], '')}</select></label>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () => done(field(p, 'to').value || null));
    },

    choosePrescienceElement(state, factionId, territoryId, opponentId) {
      return ask(`Prescience: battle in ${territoryName(territoryId)}`,
        `<p>Before you plan, ${esc(factionName(opponentId))} must show you one part of their battle plan. Which do you want to see?</p>
         <div class="choices">
           ${[['weapon', 'Their weapon', 'protect your leader'], ['defense', 'Their defence', 'pick a weapon that gets through'],
              ['leader', 'Their leader', 'check it against your traitor'], ['number', 'Forces they dial', 'know what you must beat']]
             .map(([v, label, why], i) => `<label class="choice"><input type="radio" name="element" value="${v}"${i === 0 ? ' checked' : ''}> <span>${label} <em>${why}</em></span></label>`).join('')}
         </div>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Ask</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () =>
          done(p.querySelector('input[name="element"]:checked').value));
    },

    chooseBattlePlan(state, factionId, territoryId, opponentId, intel, voice) {
      const me = state.factions[factionId];
      const present = me.forces.onBoard[territoryId] ?? 0;
      const starredPresent = me.forces.starredOnBoard?.[territoryId] ?? 0;
      const theirs = state.factions[opponentId].forces.onBoard[territoryId] ?? 0;
      const hand = me.treacheryHand.map(id => ({ id, category: cardLookup[id]?.category }));
      // Leaders who already fought in another territory this turn can't fight here.
      const leaders = me.leaders.available.filter(id => battleEngine.isLeaderAvailable(state, factionId, id, territoryId))
        .sort((a, b) => (leader[b]?.fightingValue ?? 0) - (leader[a]?.fightingValue ?? 0));
      const heroes = hand.filter(c => c.category === 'specialLeaderSubstitute');
      const leaderOptions = [
        ...leaders.map(id => [`leader:${id}`, leaderLabel(id)]),
        ...heroes.map(c => [`hero:${c.id}`, `${cardName(c.id)} (0)`]),
        ['', 'None available']
      ];
      // Worthless cards may be played in either slot as a bluff (and to get rid of them).
      const label = c => c.category === 'worthless' ? `${cardName(c.id)} (worthless bluff)` : cardName(c.id);
      const weaponOptions = [['', 'No weapon'], ...hand.filter(c => WEAPONS.includes(c.category) || c.category === 'worthless').map(c => [c.id, label(c)])];
      const defenseOptions = [['', 'No defence'], ...hand.filter(c => DEFENSES.includes(c.category) || c.category === 'worthless').map(c => [c.id, label(c)])];
      const voiceNote = voice
        ? `<p class="decision__error">The Voice: you ${voice.command === 'play' ? 'must play' : 'must not play'} ${esc(CATEGORY_NAMES[voice.category] ?? voice.category)}${voice.command === 'play' ? ' if you hold one' : ''}. Your plan will be adjusted to obey.</p>` : '';
      // Offered only if active and not already used in another territory this phase.
      const kh = me.specialFactionState?.kwisatzHaderachActive &&
        [null, undefined, territoryId].includes(me.specialFactionState?.kwisatzHaderachUsedInTerritoryThisPhase);

      const revealed = !intel ? '' : (() => {
        const v = intel.value;
        const what = {
          leader: v === 'cheapHero' ? 'a Cheap Hero' : v ? leaderLabel(v) + ((me.traitorHand ?? []).includes(v) ? ', who is YOUR TRAITOR' : '') : 'no leader',
          weapon: v ? cardName(v) : 'no weapon',
          defense: v ? cardName(v) : 'no defence',
          number: `${v} forces`
        }[intel.element];
        return `<p class="decision__intel">Prescience: ${esc(factionName(opponentId))} is playing <strong>${esc(what)}</strong>.</p>`;
      })();
      const knownTheirs = Object.entries(state.meta.knownCards ?? {}).filter(([, f]) => f === opponentId).map(([id]) => `${cardName(id)} (${(CATEGORY_NAMES[cardLookup[id]?.category] ?? 'a special card').replace(/^an? /, '').replace(/ \(.*\)$/, '')})`);
      const knownNote = knownTheirs.length
        ? `<p class="decision__known">Known in ${esc(factionName(opponentId))}'s hand (revealed in battle and kept): <strong>${esc(knownTheirs.join(', '))}</strong></p>` : '';
      const myTraitors = (me.traitorHand ?? []).map(id => `${leaderLabel(id)}, ${factionName(leader[id]?.faction)}`);
      const traitorNote = myTraitors.length
        ? `<p class="decision__note">Your traitor${myTraitors.length > 1 ? 's' : ''}: ${esc(myTraitors.join('; '))}. If ${esc(factionName(opponentId))} plays ${myTraitors.length > 1 ? 'one of them' : 'them'}, you'll be offered the reveal.</p>` : '';
      return ask(`Battle in ${territoryName(territoryId)}`,
        `${voiceNote}${revealed}${knownNote}${traitorNote}<dl class="facts"><dt>Opponent</dt><dd>${esc(factionName(opponentId))}, ${theirs} forces</dd>
         <dt>Your forces here</dt><dd>${present}${starredPresent ? ` (${starredPresent} starred)` : ''}</dd><dt>Your spice</dt><dd>${me.spice}</dd></dl>
         <p>The side with the higher total wins; ties go to the aggressor. Forces you dial are lost even if you win. If you lose, you lose every force here. Each dialed force counts fully only if backed by 1 spice.</p>
         <label class="field"><span>Forces to dial</span><select name="forces">${options(range(0, present).map(n => [n, n]), Math.ceil(present / 2))}</select></label>
         ${starredPresent ? `<label class="field"><span>Of which starred</span><select name="starred">${options(range(0, starredPresent).map(n => [n, n]), 0)}</select></label>` : ''}
         ${factionId === 'fremen' ? '<p class="decision__note">Fremen fight at full strength without spice: no need to commit any.</p><input type="hidden" name="spice" value="0">'
           : `<label class="field"><span>Spice to back them</span><select name="spice">${options(range(0, Math.min(present, me.spice)).map(n => [n, n]), 0)}</select></label>`}
         <label class="field"><span>Leader</span><select name="leader">${options(leaderOptions, leaderOptions[0][0])}</select></label>
         <label class="field"><span>Weapon</span><select name="weapon">${options(weaponOptions, '')}</select></label>
         <label class="field"><span>Defence</span><select name="defense">${options(defenseOptions, '')}</select></label>
         ${kh ? '<label class="choice"><input type="checkbox" name="kh"> <span>Add the Kwisatz Haderach (+2)</span></label>' : ''}
         <p class="decision__note" data-for="strength"></p>
         <p class="decision__error" hidden></p>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Lock battle plan</button></div>`,
        (p, done) => {
          const btn = p.querySelector('[data-default-action]');
          const build = () => {
            const forces = num(p, 'forces');
            const starred = Math.min(num(p, 'starred'), forces);
            const spice = Math.min(num(p, 'spice'), forces);
            const choice = field(p, 'leader').value;
            const leaderId = choice.startsWith('leader:') ? choice.slice(7) : null;
            const supportedStarredCount = Math.min(starred, spice);
            return {
              forcesCommitted: forces, starredForcesCommitted: starred, spiceCommitted: spice,
              supportedStarredCount, supportedOrdinaryCount: spice - supportedStarredCount,
              leaderId, leaderFightingValue: leaderId ? (leader[leaderId]?.fightingValue ?? 0) : 0,
              cheapHeroCardId: choice.startsWith('hero:') ? choice.slice(5) : null,
              weaponCardId: field(p, 'weapon').value || null,
              defenseCardId: field(p, 'defense').value || null,
              useKwisatzHaderach: Boolean(field(p, 'kh')?.checked)
            };
          };
          const check = () => {
            const plan = build();
            const result = battleEngine.canDeclareBattlePlan(state, territoryId, factionId, plan, cardLookup);
            const warn = cardLookup[plan.weaponCardId]?.category === 'specialWeapon' && cardLookup[plan.defenseCardId]?.category === 'projectileDefense'
              ? ' Warning: a lasgun with your own shield explodes, destroying everything here.' : '';
            const strength = battleEngine.calculateStrength({ ...battleEngine.fremenFullStrength(factionId, plan), starredUnitValue: battleEngine.starredUnitValueFor(factionId, opponentId), leaderWasKilled: false, kwisatzHaderachBonus: plan.useKwisatzHaderach ? 2 : 0 });
            p.querySelector('[data-for="strength"]').textContent = `Your total if your leader survives: ${strength}.${warn}`;
            setError(p, result.ok ? null : result.reason);
            btn.disabled = !result.ok;
          };
          p.querySelectorAll('select, input').forEach(el => el.onchange = check);
          check();
          btn.onclick = () => done(build());
        });
    }
  };
}
