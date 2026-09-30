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

import { forcesAfterReveal, usableNoFields } from '../js/noField.js';
import { TECH_TOKENS } from '../js/techTokens.js';
import * as cardEffects from '../js/cardEffects.js';
import { battleSpice, battleSupportFor, spendingPower } from '../js/allySupport.js';
import * as biddingEngine from '../js/biddingEngine.js';
import * as revivalEngine from '../js/revivalEngine.js';
import * as movementEngine from '../js/movementEngine.js';
import * as battleEngine from '../js/battleEngine.js';

const { WEAPONS, DEFENSES } = battleEngine;
const CATEGORY_NAMES = {
  poisonWeapon: 'a poison weapon', projectileWeapon: 'a projectile weapon', specialWeapon: 'a Lasgun',
  poisonDefense: 'a poison defence (Snooper)', projectileDefense: 'a projectile defence (Shield)',
  poisonBlade: 'a Poison Blade (projectile and poison)', weirdingWay: 'Weirding Way (projectile)', poisonTooth: 'a Poison Tooth',
  artilleryStrike: 'an Artillery Strike', shieldSnooper: 'a Shield Snooper (both defences)', chemistry: 'Chemistry (poison defence)',
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
  const leaderLabel = id => id === 'cheapHeroTraitor' ? 'Cheap Hero (any Cheap Hero an opponent plays)' : `${leader[id]?.name ?? id} (${leader[id]?.fightingValue ?? 0})`;
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
  // Number pickers are drop-downs of the legal values: no keyboard, no zooming.
  const nums = (lo, hi, sel) => options(range(lo, Math.max(lo, hi)).map(n => [n, n]), Math.min(Math.max(sel, lo), Math.max(lo, hi)));
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
      const seen = (factionId === 'atreides' || factionId === 'ixians') && cardId
        ? `<p class="decision__note">${factionId === 'ixians' ? 'You saw this auction\'s cards' : 'Prescience'}: this card is <strong>${esc(cardName(cardId))}</strong>.</p>` : '';
      const leading = b.currentBidder ? `${factionName(b.currentBidder)} leads at ${currentBid}` : 'No bids yet';
      return ask(`Treachery card ${b.currentCardIndex + 1} of ${b.cardsUpForBid.length}`,
        `${seen}
         <dl class="facts"><dt>Current bid</dt><dd>${esc(leading)}</dd><dt>Your spice</dt><dd>${me.spice}</dd>
         <dt>Your hand</dt><dd>${me.treacheryHand.length} / ${biddingEngine.handLimitFor(factionId)}</dd></dl>
         <label class="field"><span>Your bid</span><select name="bid">${nums(currentBid + 1, spendingPower(state, factionId), currentBid + 1)}</select></label>
         <p class="decision__error" hidden></p>
         <div class="decision__actions">
           <button class="btn btn--primary" data-action="bid">Bid</button>
           ${cardEffects.holdsKarama(state, factionId) ? '<button class="btn" data-action="karama">Karama: take it free</button>' : ''}
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
          p.querySelector('[data-action="karama"]')?.addEventListener('click', () => done('karama'));
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
      const revivalTerms = revivalEngine.revivalTerms(state, factionId);
      const revivalCap = revivalTerms.cap;
      return ask('Revival',
        `<dl class="facts"><dt>In the tanks</dt><dd>${tanks}</dd><dt>Free this turn</dt><dd>${free}</dd><dt>Your spice</dt><dd>${me.spice}</dd></dl>
         <p>${revivalCap === Infinity ? 'No limit on revival.' : `Up to ${revivalCap} forces a turn.`} Beyond your free allowance, each costs 2 spice${revivalTerms.halfPrice ? ', at half price' : ''}${revivalTerms.payee === 'tleilaxu' ? ', paid to the Tleilaxu' : ''}.</p>
         <label class="field"><span>Forces</span><select name="forces">${options(range(0, Math.min(revivalCap, tanks)).map(n => [n, n]), Math.min(free, tanks))}</select></label>
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

      const eliteName = { emperor: 'Sardaukar', fremen: 'Fedaykin' }[factionId] ?? null;
      return ask('Shipment and movement',
        `<dl class="facts"><dt>Reserves</dt><dd>${me.forces.reserve}</dd><dt>Your spice</dt><dd>${me.spice}</dd><dt>Move range</dt><dd>${range_} territor${range_ === 1 ? 'y' : 'ies'}</dd></dl>
         <fieldset><legend>Ship from reserves</legend>
           <label class="field"><span>Destination</span><select name="shipTo">${options(shipOptions, '')}</select></label>
           <label class="field"><span>Forces</span><select name="shipAmount">${nums(1, me.forces.reserve, Math.min(3, me.forces.reserve))}</select></label>
           ${(factionId === 'richese' || state.alliances?.some(a => a.factions.includes('richese') && a.factions.includes(factionId))) && usableNoFields(state).length ? `<label class="field"><span>No-Field</span><select name="shipNF">${options([['', 'Ship forces normally'], ...usableNoFields(state).map(v => [v, `Token ${v}: pay for 1 force, ${v} arrive when revealed`])], '')}</select></label>
           ${state.factions.richese.noField.onPlanet ? `<p class="decision__note">Your No-Field token (${state.factions.richese.noField.onPlanet.value}) in ${esc(territoryName(state.factions.richese.noField.onPlanet.territoryId))} is revealed first if you place another.</p>` : ''}` : ''}
           ${eliteName && (me.forces.starredReserve ?? 0) > 0 ? `<label class="field"><span>of which ${eliteName}</span><select name="shipStarred">${nums(0, me.forces.starredReserve, Math.min(me.forces.starredReserve, 3, me.forces.reserve))}</select></label>` : ''}
           <p class="decision__cost" data-for="ship"></p>
         </fieldset>
         <fieldset><legend>Move one group</legend>
           <label class="field"><span>From</span><select name="moveFrom">${options(fromOptions, '')}</select></label>
           <label class="field"><span>To</span><select name="moveTo"><option value="">Choose a starting territory</option></select></label>
           <label class="field"><span>Forces</span><select name="moveAmount">${nums(1, 1, 1)}</select></label>
           ${eliteName ? `<label class="field" data-elite-move hidden><span>of which ${eliteName}</span><select name="moveStarred">${nums(0, 0, 0)}</select></label>` : ''}
           ${cardEffects.holdsKarama(state, factionId) && factionId !== 'guild' ? '<label class="choice"><input type="checkbox" name="shipKarama"> <span>Pay for this shipment with a Karama card (half price)</span></label>' : ''}
           ${me.treacheryHand.includes('ornithopter') ? '<label class="choice"><input type="checkbox" name="thopter"> <span>Play the Ornithopter card: this move may go up to 3 territories</span></label>' : ''}
           <p class="decision__note">Your shipment happens first, then your move. Tip: tap ▾ to see the map, where legal choices are outlined; tapping a territory fills this in.</p>
         </fieldset>
         ${me.treacheryHand.includes('hajr') ? `<fieldset><legend>Hajr: an extra move (uses the card)</legend>
           <label class="field"><span>From</span><select name="hajrFrom">${options(fromOptions.map(([v, l]) => [v, v ? l : 'Keep the card']), '')}</select></label>
           <label class="field"><span>To</span><select name="hajrTo"><option value="">Choose a starting territory</option></select></label>
           <label class="field"><span>Forces</span><select name="hajrAmount">${nums(1, 1, 1)}</select></label>
           <p class="decision__note">Made after your normal move. Checked again when it happens.</p>
         </fieldset>` : ''}
         ${factionId === 'guild' ? `<fieldset><legend>Guild: or ship on the planet instead</legend>
           <label class="field"><span>Type</span><select name="gType">${options([['', 'Ship from reserves (above)'], ['cross', 'Across the planet'], ['retreat', 'Back to reserves (1 spice per 2)']], '')}</select></label>
           <label class="field"><span>From</span><select name="gFrom">${options(Object.entries(me.forces.onBoard).map(([id, n]) => [id, `${territoryName(id)} (${n})`]), Object.keys(me.forces.onBoard)[0])}</select></label>
           <label class="field"><span>To</span><select name="gTo">${options(territoryIds.map(id => [id, territoryName(id)]), territoryIds[0])}</select></label>
           <label class="field"><span>Forces</span><select name="gAmount">${nums(1, me.forces.onBoard[Object.keys(me.forces.onBoard)[0]] ?? 1, 1)}</select></label>
         </fieldset>` : ''}
         <p class="decision__error" hidden></p>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm</button></div>`,
        (p, done) => {
          const btn = p.querySelector('[data-default-action]');
          const refreshDestinations = () => {
            const from = field(p, 'moveFrom').value;
            const reachable = from ? movementEngine.reachableTerritories(state, factionId, from, field(p, 'thopter')?.checked ? Math.max(3, range_) : range_) : [];
            field(p, 'moveTo').innerHTML = from
              ? options(reachable.map(id => [id, territoryName(id)]), reachable[0])
              : '<option value="">Choose a starting territory</option>';
            field(p, 'moveAmount').innerHTML = from ? nums(1, me.forces.onBoard[from], me.forces.onBoard[from]) : nums(1, 1, 1);
          };
          // Outline legal choices on the map: where this group can move
          // once one is chosen, otherwise where the shipment can land.
          const highlight = () => {
            const from = field(p, 'moveFrom').value;
            const ids = from
              ? movementEngine.reachableTerritories(state, factionId, from, field(p, 'thopter')?.checked ? Math.max(3, range_) : range_)
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
                if (field(p, 'thopter')?.checked) state.meta.ornithopterFar = factionId; // checked as the Ornithopter card would allow
                const r = movementEngine.canMove(state, factionId, from, to, num(p, 'moveAmount'));
                delete state.meta.ornithopterFar;
                if (!r.ok) problems.push(`Movement: ${r.reason}`);
              }
            }
            // Elite troops: the split must fit what is in reserve / in the group.
            if (field(p, 'shipTo').value && field(p, 'shipStarred')) {
              const n = num(p, 'shipAmount'), st = num(p, 'shipStarred'), eliteRes = me.forces.starredReserve ?? 0;
              if (st > n) problems.push(`You can't ship more ${eliteName} than forces in total.`);
              else if (st > eliteRes) problems.push(`Only ${eliteRes} ${eliteName} in reserve.`);
              else if (n - st > me.forces.reserve - eliteRes) problems.push(`Only ${me.forces.reserve - eliteRes} ordinary forces in reserve: ship more ${eliteName} or fewer forces.`);
            }
            const moveFromId = field(p, 'moveFrom').value;
            if (moveFromId && field(p, 'moveStarred')) {
              const here = me.forces.onBoard[moveFromId] ?? 0, eliteHere = me.forces.starredOnBoard?.[moveFromId] ?? 0;
              const n = num(p, 'moveAmount'), st = eliteHere ? num(p, 'moveStarred') : 0;
              if (st > n) problems.push(`You can't move more ${eliteName} than forces in total.`);
              else if (st > eliteHere) problems.push(`Only ${eliteHere} ${eliteName} there.`);
              else if (n - st > here - eliteHere) problems.push(`Only ${here - eliteHere} ordinary forces there: move more ${eliteName} or fewer forces.`);
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
          // Show the elite field only when the chosen group contains elite troops.
          const refreshElite = () => {
            const box = p.querySelector('[data-elite-move]');
            if (!box) return;
            const elite = me.forces.starredOnBoard?.[field(p, 'moveFrom').value] ?? 0;
            box.hidden = !elite;
            const input = field(p, 'moveStarred');
            input.innerHTML = nums(0, elite, Math.min(num(p, 'moveStarred'), elite));
          };
          field(p, 'moveFrom').onchange = () => { refreshDestinations(); refreshElite(); check(); };
          refreshElite();
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
            const reachable = from ? movementEngine.reachableTerritories(state, factionId, from, field(p, 'thopter')?.checked ? Math.max(3, range_) : range_) : [];
            field(p, 'hajrTo').innerHTML = from ? options(reachable.map(id => [id, territoryName(id)]), reachable[0]) : '<option value="">Choose a starting territory</option>';
            field(p, 'hajrAmount').innerHTML = from ? nums(1, me.forces.onBoard[from], me.forces.onBoard[from]) : nums(1, 1, 1);
          };
          p.querySelectorAll('select, input').forEach(el => { if (!['moveFrom', 'hajrFrom'].includes(el.name)) el.oninput = el.onchange = check; });
          if (field(p, 'gFrom')) field(p, 'gFrom').onchange = field(p, 'gFrom').oninput = () => {
            const n = me.forces.onBoard[field(p, 'gFrom').value] ?? 1;
            field(p, 'gAmount').innerHTML = nums(1, n, Math.min(num(p, 'gAmount') || 1, n));
            check();
          };
          check();
          btn.onclick = () => {
            const shipTo = field(p, 'shipTo').value;
            const from = field(p, 'moveFrom').value;
            done({
              ornithopter: field(p, 'thopter')?.checked ? 'far' : null,
              ...(field(p, 'shipKarama')?.checked && shipTo ? { karamaShip: true } : {}),
              shipment: shipTo ? (field(p, 'shipNF')?.value ? { territoryId: shipTo, amount: 1, noField: Number(field(p, 'shipNF').value) }
                : { territoryId: shipTo, amount: num(p, 'shipAmount'), starred: field(p, 'shipStarred') ? num(p, 'shipStarred') : undefined }) : null,
              movement: from ? { from, to: field(p, 'moveTo').value, amount: num(p, 'moveAmount'),
                starred: field(p, 'moveStarred') && (me.forces.starredOnBoard?.[from] ?? 0) ? num(p, 'moveStarred') : undefined } : null,
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

    chooseAdvisor(state, factionId, shipperId, { territoryId } = {}) {
      const withThem = territoryId && territoryId !== 'polarSink';
      return ask('Spiritual Advisor',
        `<p>${esc(factionName(shipperId))} just shipped ${withThem ? `into ${esc(territoryName(territoryId))}` : 'in'} from off-planet. You may send 1 force from your reserves, free.</p>
         ${withThem ? `<p class="decision__note">As an advisor there it coexists with everyone: it collects no spice and never fights until you turn it into a fighter.</p>` : ''}
         <div class="decision__actions">
           ${withThem ? `<button class="btn" data-action="with">Advisor to ${esc(territoryName(territoryId))}</button>` : ''}
           <button class="btn" data-action="sink">Polar Sink</button>
           <button class="btn btn--primary" data-default-action>Not this time</button>
         </div>`,
        (p, done) => {
          p.querySelector('[data-action="with"]')?.addEventListener('click', () => done(territoryId));
          p.querySelector('[data-action="sink"]').onclick = () => done('polarSink');
          p.querySelector('[data-default-action]').onclick = () => done(false);
        });
    },
    chooseIntrusion(state, factionId, { territoryId, intruderId }) {
      return ask('Intrusion',
        `<p>${esc(factionName(intruderId))} have entered ${esc(territoryName(territoryId))}, where you have fighters. Turn them into advisors (no battle there, but they stop counting for control and spice)?</p>
         <div class="decision__actions"><button class="btn" data-action="yes">Become advisors</button><button class="btn btn--primary" data-default-action>Stay and fight</button></div>`,
        (p, done) => { p.querySelector('[data-action="yes"]').onclick = () => done(true); p.querySelector('[data-default-action]').onclick = () => done(false); });
    },
    chooseAdvisorsToFight(state, factionId, { territories }) {
      return ask('Take up arms?',
        `<p>Before shipments, your advisors may become fighters and battle where they stand.</p>
         ${territories.map(t => `<label class="choice"><input type="checkbox" name="t" value="${esc(t)}"> <span>${esc(territoryName(t))} (${state.factions.gesserit.forces.onBoard[t]} advisors)</span></label>`).join('')}
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () => done([...p.querySelectorAll('[name="t"]:checked')].map(i => i.value)));
    },

    // --- Richese cards, Black Market, alliance --------------------------------------
    chooseNullentropy(state, factionId, { cards }) {
      return ask('Nullentropy Box',
        `<p>Pay 2 spice to take any card from the discard pile (it is then shuffled, with the Box on top).</p>
         <label class="field"><span>Take</span><select name="c">${options([['', 'Not now'], ...cards.map(id => [id, cardName(id)])], '')}</select></label>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () => done(field(p, 'c').value || null));
    },
    chooseDistrans(state, factionId, { targets, cards }) {
      return ask('Distrans',
        `<p>Give another player one card from your hand (a dud clogs their hand).</p>
         <label class="field"><span>Give</span><select name="c">${options([['', 'Not now'], ...cards.map(id => [id, cardName(id)])], '')}</select></label>
         <label class="field"><span>To</span><select name="t">${options(targets.map(t => [t, factionName(t)]), targets[0])}</select></label>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () => done(field(p, 'c').value ? { cardId: field(p, 'c').value, targetId: field(p, 't').value } : null));
    },
    chooseBlackMarket(state, factionId, { hand }) {
      const names = [...new Set(Object.values(cardLookup).filter(c => !c.cache).map(c => c.name))].sort();
      const idFor = n => Object.keys(cardLookup).find(id => cardLookup[id].name === n);
      return ask('Black Market?',
        `<p>Before this round's cards are declared you may sell one card from your hand. Say what it is (you may lie); nobody sees it, except Atreides. If nobody bids any spice, you keep it. If it sells, one fewer normal card is auctioned and all the spice is yours.</p>
         <label class="field"><span>Sell</span><select name="c">${options([['', 'Nothing this round'], ...hand.map(id => [id, cardName(id)])], '')}</select></label>
         <label class="field"><span>Announce it as</span><select name="n">${options([['', 'The truth'], ...names.map(n => [n, n])], '')}</select></label>
         <label class="field"><span>Auction</span><select name="m">${options([['normal', 'Normal bidding'], ['onceAround', 'Once Around'], ['silent', 'Silent']], 'normal')}</select></label>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () => { const c = field(p, 'c').value; const n = field(p, 'n').value;
          done(c ? { cardId: c, claimId: n ? idFor(n) : c, method: field(p, 'm').value } : null); });
    },
    chooseJuiceOfSapho(state, factionId, { use, territoryId, opponentId }) {
      if (use === 'aggressor') return ask('Juice of Sapho?',
        `<p>Play Juice of Sapho to be the aggressor against ${esc(factionName(opponentId))} in ${esc(territoryName(territoryId))} (the aggressor wins ties)?</p>
         <div class="decision__actions"><button class="btn" data-action="yes">Play it</button><button class="btn btn--primary" data-default-action>Keep it</button></div>`,
        (p, done) => { p.querySelector('[data-action="yes"]').onclick = () => done('aggressor'); p.querySelector('[data-default-action]').onclick = () => done(null); });
      return ask('Juice of Sapho?',
        `<p>Play Juice of Sapho to go first or last in Shipment and Movement this turn?</p>
         <label class="field"><span>Use</span><select name="u">${options([['', 'Keep it'], ['first', 'Go first'], ['last', 'Go last']], '')}</select></label>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () => done(field(p, 'u').value || null));
    },
    chooseAllyNoField(state, factionId, { allyId, value, territoryId }) {
      return ask('Ship your ally with a No-Field?',
        `<p>${esc(factionName(allyId))} ask to ship up to ${value} forces to ${esc(territoryName(territoryId))} with your No-Field token ${value}, paying for one force. Their forces are revealed at once, and the token is then face up.</p>
         <div class="decision__actions"><button class="btn" data-action="yes">Agree</button><button class="btn btn--primary" data-default-action>Refuse</button></div>`,
        (p, done) => { p.querySelector('[data-action="yes"]').onclick = () => done(true); p.querySelector('[data-default-action]').onclick = () => done(false); });
    },
    chooseResidualPoison(state, factionId, { opponentId }) {
      return ask('Residual Poison?',
        `<p>Before plans are made, kill one of ${esc(factionName(opponentId))}'s available leaders at random (no spice for it)?</p>
         <div class="decision__actions"><button class="btn" data-action="yes">Play it</button><button class="btn btn--primary" data-default-action>Keep it</button></div>`,
        (p, done) => { p.querySelector('[data-action="yes"]').onclick = () => done(true); p.querySelector('[data-default-action]').onclick = () => done(false); });
    },
    choosePortableSnooper(state, factionId, { opponentPlan }) {
      return ask('Portable Snooper?',
        `<p>Plans are revealed. Their weapon: <strong>${esc(opponentPlan.weaponCardId ? cardName(opponentPlan.weaponCardId) : 'none')}</strong>. You played no defence: add Portable Snooper as a poison defence?</p>
         <div class="decision__actions"><button class="btn" data-action="yes">Add it</button><button class="btn btn--primary" data-default-action>Keep it</button></div>`,
        (p, done) => { p.querySelector('[data-action="yes"]').onclick = () => done(true); p.querySelector('[data-default-action]').onclick = () => done(false); });
    },
    chooseStoneBurnerMode(state, factionId, { opponentPlan }) {
      return ask('Stone Burner',
        `<p>Kill both leaders, or reduce both leaders to 0? Either way the side with more undialled forces wins, and dialled forces are lost normally. Their leader: ${esc(opponentPlan.leaderId ? leaderLabel(opponentPlan.leaderId) : 'none')}.</p>
         <div class="decision__actions"><button class="btn" data-action="yes">Reduce both to 0</button><button class="btn btn--primary" data-default-action>Kill both</button></div>`,
        (p, done) => { p.querySelector('[data-action="yes"]').onclick = () => done('zero'); p.querySelector('[data-default-action]').onclick = () => done('kill'); });
    },
    chooseSemuta(state, factionId, { cards }) {
      return ask('Semuta Drug?',
        `<p>Take one of the cards another player has just discarded?</p>
         <label class="field"><span>Take</span><select name="c">${options([['', 'Not now'], ...cards.map(id => [id, cardName(id)])], '')}</select></label>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () => done(field(p, 'c').value || null));
    },
    chooseGiveCacheCard(state, factionId, { allyId, cards }) {
      return ask('Give your ally a Richese card?',
        `<p>You may give ${esc(factionName(allyId))} one of your Richese cards.</p>
         <label class="field"><span>Give</span><select name="c">${options([['', 'Not now'], ...cards.map(id => [id, cardName(id)])], '')}</select></label>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () => done(field(p, 'c').value || null));
    },
    chooseGholaBuyBack(state, factionId, { leaderId }) {
      const me = state.factions[factionId];
      return ask('Buy back your leader?',
        `<p>The Tleilaxu hold <strong>${esc(leaderLabel(leaderId))}</strong> as a Ghola. Offer them a price to return it? They may refuse.</p>
         <label class="field"><span>Offer</span><select name="p">${options([['', 'No offer'], ...range(1, me.spice).map(n => [n, `${n} spice`])], '')}</select></label>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () => { const v = field(p, 'p').value; done(v === '' ? null : Number(v)); });
    },
    chooseAcceptGholaBuyBack(state, factionId, { leaderId, owner, price }) {
      return ask('Sell a Ghola back?',
        `<p>${esc(factionName(owner))} offer <strong>${price} spice</strong> for <strong>${esc(leaderLabel(leaderId))}</strong>. If you sell, you may revive a different leader as a Ghola.</p>
         <div class="decision__actions"><button class="btn" data-action="yes">Sell for ${price}</button><button class="btn btn--primary" data-default-action>Refuse</button></div>`,
        (p, done) => { p.querySelector('[data-action="yes"]').onclick = () => done(true); p.querySelector('[data-default-action]').onclick = () => done(false); });
    },
    chooseFaceDancerSources(state, factionId, { territoryId, count, reserve, board }) {
      const rows = Object.entries(board).map(([t, n]) => `<label class="field"><span>From ${esc(territoryName(t))}</span><select name="t_${t}">${options(range(0, Math.min(n, count)).map(k => [k, k]), 0)}</select></label>`).join('');
      return ask('Face Dancer: replace their forces',
        `<p>Up to ${count} of your forces take ${esc(territoryName(territoryId))}, from reserves and/or anywhere on the planet.</p>
         <label class="field"><span>From reserves</span><select name="r">${options(range(0, Math.min(count, reserve)).map(k => [k, k]), Math.min(count, reserve))}</select></label>
         ${rows}
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () => done({ reserve: num(p, 'r'), from: Object.fromEntries(Object.keys(board).map(t => [t, num(p, `t_${t}`)])) }));
    },

    chooseKaramaBuy() { return false; }, // offered as a button in the bid panel instead
    chooseKaramaPower(state, factionId, info) {
      const yesNo = (title, text, yes) => ask(title, `<p>${text}</p><div class="decision__actions"><button class="btn" data-action="yes">${yes}</button><button class="btn btn--primary" data-default-action>Keep the Karama</button></div>`,
        (p, done) => { p.querySelector('[data-action="yes"]').onclick = () => done(true); p.querySelector('[data-default-action]').onclick = () => done(null); });
      const pickOne = (title, text, opts, label) => ask(title, `<p>${text}</p><label class="field"><span>${label}</span><select name="o">${options([['', 'Keep the Karama'], ...opts], '')}</select></label>
          <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () => done(field(p, 'o').value || null));
      switch (info.kind) {
        case 'seePlan': return yesNo('Karama: see their plan?', `Spend a Karama to see ${esc(factionName(info.opponentId))}'s entire battle plan in ${esc(territoryName(info.territoryId))} before you make yours.`, 'See it');
        case 'stopShipment': return state.board.territories[info.territoryId]?.type === 'stronghold'
          ? yesNo('Karama: stop this shipment?', `${esc(factionName(info.factionId))} are shipping ${info.amount} to ${esc(territoryName(info.territoryId))}. Spend a Karama to stop it?`, 'Stop it') : Promise.resolve(null);
        case 'stopRevival': return pickOne('Karama: stop a revival?', 'Spend a Karama so one faction cannot revive anything this turn.', info.targets.map(f => [f, factionName(f)]), 'Faction');
        case 'freeRevival': return ask('Karama: free revival?', `<p>Spend a Karama to revive up to 3 forces or 1 leader, free.</p>
            <label class="field"><span>Revive</span><select name="o">${options([['', 'Keep the Karama'], ...(info.tanks ? [['forces', `${Math.min(3, info.tanks)} forces`]] : []), ...info.leaders.map(l => [l, leaderLabel(l)])], '')}</select></label>
            <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm</button></div>`,
          (p, done) => p.querySelector('[data-default-action]').onclick = () => { const v = field(p, 'o').value;
            done(!v ? null : v === 'forces' ? { forces: Math.min(3, info.tanks), starred: Math.min(3, info.tanks, info.starredTanks) } : { leaderId: v }); });
        case 'takeCards': return ask('Karama: take their cards?', `<p>Spend a Karama to take cards blind from one player; you give back one of yours for each.</p>
            <label class="field"><span>From</span><select name="t">${options([['', 'Keep the Karama'], ...info.targets.map(f => [f, `${factionName(f)} (${state.factions[f].treacheryHand.length} cards)`])], '')}</select></label>
            <label class="field"><span>How many</span><select name="n">${options(range(1, state.factions[factionId].treacheryHand.length).map(n => [n, n]), 1)}</select></label>
            <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm</button></div>`,
          (p, done) => p.querySelector('[data-default-action]').onclick = () => { const t = field(p, 't').value; done(t ? { targetId: t, count: num(p, 'n') } : null); });
        case 'buyCache': return pickOne('Karama: buy from your cache?', 'Spend a Karama and 3 spice to take one card from your cache.', info.cache.map(c => [c, cardName(c)]), 'Card');
        case 'sellCards': return ask('Karama: sell cards?', `<p>Spend a Karama to discard any of your cards for 3 spice each.</p>
            ${info.hand.map(c => `<label class="choice"><input type="checkbox" name="c" value="${esc(c)}"> <span>${esc(cardName(c))}</span></label>`).join('')}
            <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm</button></div>`,
          (p, done) => p.querySelector('[data-default-action]').onclick = () => { const v = [...p.querySelectorAll('[name="c"]:checked')].map(i => i.value); done(v.length ? v : null); });
      }
      return Promise.resolve(null);
    },
    chooseCardsToGiveBack(state, factionId, { targetId, count }) {
      const hand = state.factions[factionId].treacheryHand;
      return ask('Give cards back', `<p>Choose ${count} card${count > 1 ? 's' : ''} to give ${esc(factionName(targetId))} in return.</p>
          ${hand.map(c => `<label class="choice"><input type="checkbox" name="c" value="${esc(c)}"> <span>${esc(cardName(c))}</span></label>`).join('')}
          <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () => done([...p.querySelectorAll('[name="c"]:checked')].map(i => i.value).slice(0, count)));
    },

    chooseWeatherControl(state, factionId) {
      return ask('Weather Control?',
        `<p>Play Weather Control to move the storm yourself this turn, from 0 to 10 sectors.</p>
         <label class="field"><span>Storm moves</span><select name="n">${options([['', 'Keep the card'], ...range(0, 10).map(n => [n, `${n} sector${n === 1 ? '' : 's'}`])], '')}</select></label>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () => { const v = field(p, 'n').value; done(v === '' ? null : Number(v)); });
    },
    chooseFamilyAtomics(state, factionId, { sectors }) {
      return ask('Family Atomics?',
        `<p>The storm will move ${sectors} sector${sectors === 1 ? '' : 's'}. Play Family Atomics now to destroy every force on the Shield Wall (yours too). For the rest of the game the storm also sweeps Imperial Basin, Arrakeen and Carthag.</p>
         <div class="decision__actions"><button class="btn" data-action="yes">Detonate</button><button class="btn btn--primary" data-default-action>Keep it</button></div>`,
        (p, done) => { p.querySelector('[data-action="yes"]').onclick = () => done(true); p.querySelector('[data-default-action]').onclick = () => done(false); });
    },

    chooseRevealNoField(state, factionId, { territoryId, value }) {
      return ask('Reveal your No-Field token?',
        `<p>Your No-Field token in ${esc(territoryName(territoryId))} is worth ${value}. Revealing it now places ${value} forces from your reserves there (it is revealed anyway in a battle, or if the storm or a worm catches it).</p>
         <div class="decision__actions"><button class="btn" data-action="yes">Reveal it</button><button class="btn btn--primary" data-default-action>Keep it hidden</button></div>`,
        (p, done) => { p.querySelector('[data-action="yes"]').onclick = () => done(true); p.querySelector('[data-default-action]').onclick = () => done(false); });
    },

    // --- Richese cache auctions ------------------------------------------------
    chooseCacheAuction(state, factionId, { cache }) {
      return ask('Your cache auction',
        `<p>This round you must auction one card from your cache (one fewer normal card is dealt). Choose the card, when it is sold, and how.</p>
         <label class="field"><span>Card</span><select name="c">${options(cache.map(id => [id, cardName(id)]), cache[0])}</select></label>
         <label class="field"><span>When</span><select name="w">${options([['first', 'First, before the normal cards'], ['last', 'Last, after them']], 'first')}</select></label>
         <label class="field"><span>How</span><select name="m">${options([['onceAround', 'Once Around: one bid each, then you may outbid'], ['silent', 'Silent: everyone names a price at once']], 'onceAround')}</select></label>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Announce</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () => done({ cardId: field(p, 'c').value, position: field(p, 'w').value, method: field(p, 'm').value }));
    },
    chooseOnceAroundDirection(state, factionId) {
      return ask('Which way round?',
        `<p>Once Around: each faction bids once, starting beside you.</p>
         <label class="field"><span>Direction</span><select name="d">${options([['cw', 'In seating order'], ['ccw', 'Against seating order']], 'cw')}</select></label>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () => done(field(p, 'd').value));
    },
    chooseOnceAroundBid(state, factionId, { cardId, highBid, blackMarket, actualId }) {
      const max = spendingPower(state, factionId);
      const bm = blackMarket ? `<p class="decision__note">Black Market: Richese say this card is <strong>${esc(cardName(cardId))}</strong>, and may be lying.${actualId ? ` Prescience: it is really <strong>${esc(cardName(actualId))}</strong>.` : ''}</p>` : '';
      return ask(blackMarket ? 'Black Market' : `Richese auction: ${cardName(cardId)}`,
        `${bm}<p>${blackMarket === 'normal' ? 'Bid higher or pass (passing takes you out of this auction).' : 'Once Around: this is your only chance to bid.'} High bid so far: ${highBid || 'none'}.${blackMarket ? '' : ' Richese may outbid the final high bid.'}</p>
         <label class="field"><span>Your bid</span><select name="b">${options([['', 'Pass'], ...range(highBid + 1, Math.max(highBid, max)).map(n => [n, `${n} spice`])], '')}</select></label>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () => { const v = field(p, 'b').value; done(v === '' ? null : Number(v)); });
    },
    chooseOnceAroundFinal(state, factionId, { cardId, highBid }) {
      const max = spendingPower(state, factionId);
      return ask(`Keep ${cardName(cardId)}?`,
        `<p>The high bid is ${highBid}. Outbid it to keep the card yourself (you pay the Emperor or the Bank), or let it sell and collect ${highBid}.</p>
         <label class="field"><span>Outbid</span><select name="b">${options([['', `Sell for ${highBid}`], ...range(highBid + 1, Math.max(highBid, max)).map(n => [n, `${n} spice`])], '')}</select></label>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () => { const v = field(p, 'b').value; done(v === '' ? null : Number(v)); });
    },
    chooseSilentBid(state, factionId, { cardId, blackMarket, actualId }) {
      const max = spendingPower(state, factionId);
      return ask(blackMarket ? 'Black Market: silent auction' : `Silent auction: ${cardName(cardId)}`,
        `${blackMarket ? `<p class="decision__note">Richese say this card is <strong>${esc(cardName(cardId))}</strong>, and may be lying.${actualId ? ` Prescience: it is really <strong>${esc(cardName(actualId))}</strong>.` : ''}</p>` : ''}<p>Everyone names a price in secret; the highest wins (ties go to the earlier faction in storm order). 0 is allowed.</p>
         <label class="field"><span>Your price</span><select name="b">${options(range(0, max).map(n => [n, `${n} spice`]), 0)}</select></label>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Seal it</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () => done(num(p, 'b')));
    },
    chooseFreeOrRemove(state, factionId, { cardId }) {
      return ask('Nobody bid',
        `<p>Nobody bid for ${esc(cardName(cardId))}. Take it free, or remove it from the game?</p>
         <div class="decision__actions"><button class="btn" data-action="yes">Remove it</button><button class="btn btn--primary" data-default-action>Take it</button></div>`,
        (p, done) => { p.querySelector('[data-action="yes"]').onclick = () => done('remove'); p.querySelector('[data-default-action]').onclick = () => done('take'); });
    },

    // --- CHOAM -------------------------------------------------------------
    chooseChoamDiscards(state, factionId, { duplicates, worthless }) {
      const rows = [...duplicates.map(id => [id, `${cardName(id)}: duplicate, 3 spice (the pair is shown to everyone)`]),
        ...worthless.filter(id => !duplicates.includes(id)).map(id => [id, `${cardName(id)}: worthless, 2 spice`])];
      return ask('Cash in cards?',
        `<p>End of the phase: you may discard duplicates for 3 spice each and worthless cards for 2 each. A worthless card you keep can be used later for its special effect, at its moment.</p>
         ${rows.map(([id, label]) => `<label class="choice"><input type="checkbox" name="d" value="${esc(id)}"${duplicates.includes(id) ? ' checked' : ''}> <span>${esc(label)}</span></label>`).join('')}
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () => done([...p.querySelectorAll('[name="d"]:checked')].map(i => i.value)));
    },

    chooseChoamEffect(state, factionId, { cardId, options: opts, context = {} }) {
      const what = {
        baliset: 'Play Baliset to stop one faction moving into a territory you occupy this turn? (They may still ship in.)',
        jubbaCloak: 'Play Jubba Cloak to shelter your forces in one territory from this storm?',
        kullWahad: `Play Kull Wahad to stop ${esc(factionName(opts[0]))} playing Karama${context.purpose ? ` (against ${{ voice: 'the Voice', prescience: 'Prescience', capture: 'a Harkonnen capture' }[context.purpose] ?? context.purpose})` : ''} this phase?`,
        kulon: 'Play Kulon to move your forces one extra territory this turn?',
        laLaLa: 'Play La La La to stop one faction taking free revival this turn?',
        tripToGamont: 'Play Trip to Gamont to send one force of another faction back to its reserves?'
      }[cardId];
      const label = o => typeof o === 'string'
        ? (cardId === 'jubbaCloak' ? territoryName(o) : factionName(o))
        : `${factionName(o.factionId)} in ${territoryName(o.territoryId)}`;
      const multi = !['kulon', 'kullWahad'].includes(cardId);
      return ask(cardName(cardId),
        `<p>${what}</p>
         ${multi ? `<label class="field"><span>Target</span><select name="o">${options([['', 'Keep the card'], ...opts.map((o, i) => [String(i), label(o)])], '')}</select></label>` : ''}
         <div class="decision__actions">${multi ? '<button class="btn btn--primary" data-default-action>Confirm</button>'
           : '<button class="btn" data-action="yes">Play it</button><button class="btn btn--primary" data-default-action>Keep it</button>'}</div>`,
        (p, done) => {
          if (multi) p.querySelector('[data-default-action]').onclick = () => { const v = field(p, 'o').value; done(v === '' ? null : opts[Number(v)]); };
          else { p.querySelector('[data-action="yes"]').onclick = () => done(opts[0]); p.querySelector('[data-default-action]').onclick = () => done(null); }
        });
    },

    chooseInflation(state, factionId) {
      return ask('Inflation?',
        `<p>Once a game you may place the Inflation token for next turn's CHOAM Charity. <strong>Double</strong> doubles every charity payment, your own 2 per faction included; <strong>Cancel</strong> means nobody collects. It flips to the other side the turn after, then leaves the game.</p>
         <label class="field"><span>Place</span><select name="i">${options([['', 'Not yet'], ['double', 'Double'], ['cancel', 'Cancel']], '')}</select></label>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () => done(field(p, 'i').value || null));
    },

    chooseCancelAudit(state, factionId, { cost }) {
      return ask('CHOAM audit',
        `<p>CHOAM's Auditor will look at ${cost} random card${cost > 1 ? 's' : ''} from your hand. Pay CHOAM ${cost} spice to cancel the whole audit? You have ${state.factions[factionId].spice}.</p>
         <div class="decision__actions"><button class="btn" data-action="yes">Pay ${cost}</button><button class="btn btn--primary" data-default-action>Let them look</button></div>`,
        (p, done) => { p.querySelector('[data-action="yes"]').onclick = () => done(true); p.querySelector('[data-default-action]').onclick = () => done(false); });
    },

    chooseChoamAllyTrade(state, factionId, allyId) {
      const hand = state.factions[factionId].treacheryHand;
      return ask('Trade with your ally?',
        `<p>Once a turn you may trade one treachery card with ${esc(factionName(allyId))}: you give one and they give one back.</p>
         <label class="field"><span>Offer</span><select name="c">${options([['', 'No trade this time'], ...hand.map(id => [id, cardName(id)])], '')}</select></label>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () => done(field(p, 'c').value || null));
    },

    chooseChoamAllyTradeResponse(state, factionId, { offered }) {
      const hand = state.factions[factionId].treacheryHand;
      return ask('CHOAM offers a trade',
        `<p>Your ally CHOAM offers you <strong>${esc(cardName(offered))}</strong> in exchange for one of your cards.</p>
         <label class="field"><span>Give</span><select name="c">${options([['', 'Refuse the trade'], ...hand.map(id => [id, cardName(id)])], '')}</select></label>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () => done(field(p, 'c').value || null));
    },

    chooseChoamBattleSupport(state, factionId, { allyId, territoryId, max }) {
      return ask('Pay for your ally’s forces?',
        `<p>${esc(factionName(allyId))} fight in ${esc(territoryName(territoryId))}. You may pay for some or all of their forces in this battle; they spend your offer before their own spice. Spice you pay goes to the Bank.</p>
         <label class="field"><span>Offer up to</span><select name="n">${options(range(0, max).map(n => [n, n ? `${n} spice` : 'Nothing']), 0)}</select></label>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () => done(num(p, 'n')));
    },

    chooseTechTokenToTake(state, factionId, tokens, from) {
      const what = { axlotl: 'Axlotl Tanks (pays in Revival)', heighliner: 'Heighliners (pays in Shipment and Movement)', spiceProd: 'Spice Production (pays in CHOAM Charity)' };
      const mine = TECH_TOKENS.filter(t => state.techTokens?.[t]?.owner === factionId).length;
      return ask('Take a Tech Token',
        `<p>You beat ${esc(factionName(from))}, who hold ${tokens.length} Tech Tokens. Take one. You hold ${mine}; all three together count as a stronghold.</p>
         <label class="field"><span>Take</span><select name="t">${options(tokens.map(t => [t, what[t]]), tokens[0])}</select></label>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Take it</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () => done(field(p, 't').value));
    },

    chooseGuildTiming(state, others) {
      const choices = [[0, 'First, before everyone'], ...others.slice(0, -1).map((f, i) => [i + 1, `After ${factionName(f)}`]), [others.length, 'Last, after everyone']];
      return ask('When will the Guild act?',
        `<p>As the Spacing Guild you may take your shipment and movement at any point in the order this turn. Acting last lets you see everyone else's moves first.</p>
         <label class="field"><span>Act</span><select name="pos">${options(choices, others.length)}</select></label>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () => done(num(p, 'pos')));
    },

    chooseIxianTechnology(state, factionId, upcoming) {
      const hand = state.factions.ixians.treacheryHand;
      return ask('Ixian Technology?',
        `<p>The next card up for auction is <strong>${esc(cardName(upcoming))}</strong>. Once this round you may take it, putting a card from your hand up for auction in its place.</p>
         <label class="field"><span>Give up</span><select name="c">${options([['', 'No, let it be auctioned'], ...hand.map(id => [id, cardName(id)])], '')}</select></label>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () => done(field(p, 'c').value || null));
    },

    chooseSuboidExchange(state, factionId, { territoryId, max }) {
      return ask('Suboids for Cyborgs?',
        `<p>You lost Cyborgs in ${esc(territoryName(territoryId))}. Surviving Suboids there may take their place in the tanks, one for one, bringing Cyborgs back.</p>
         <label class="field"><span>Exchange</span><select name="n">${options(range(0, max).map(n => [n, n]), max)}</select></label>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () => done(num(p, 'n')));
    },

    chooseEarlyLeaderRevival(state, factionId) {
      const dead = state.factions[factionId].leaders.killed;
      return ask('Buy a leader back from the Tleilaxu?',
        `<p>The Tleilaxu can revive one of your dead leaders early, for a price they set. Ask for one?</p>
         <label class="field"><span>Leader</span><select name="l">${options([['', 'No'], ...dead.map(id => [id, leaderLabel(id)])], '')}</select></label>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () => done(field(p, 'l').value || null));
    },

    chooseLeaderRevivalPrice(state, factionId, { factionId: other, leaderId }) {
      const v = leader[leaderId]?.fightingValue ?? 0;
      return ask('Name your price',
        `<p>${esc(factionName(other))} ask you to revive <strong>${esc(leaderLabel(leaderId))}</strong> early. Set a price, or refuse.</p>
         <label class="field"><span>Price</span><select name="p">${options([['', 'Refuse'], ...range(0, v + 8).map(n => [n, `${n} spice`])], v + 2)}</select></label>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () => { const val = field(p, 'p').value; done(val === '' ? null : Number(val)); });
    },

    chooseAcceptLeaderRevivalPrice(state, factionId, { leaderId, price }) {
      return ask('The Tleilaxu name a price',
        `<p>They will revive <strong>${esc(leaderLabel(leaderId))}</strong> for <strong>${price} spice</strong>. You have ${state.factions[factionId].spice}.</p>
         <div class="decision__actions"><button class="btn" data-action="yes">Pay ${price}</button><button class="btn" data-default-action>Refuse</button></div>`,
        (p, done) => { p.querySelector('[data-action="yes"]').onclick = () => done(true); p.querySelector('[data-default-action]').onclick = () => done(false); });
    },

    chooseGholaRevival(state, factionId, opts) {
      return ask('Revive a Ghola?',
        `<p>You may revive another faction's dead leader to fight for you, at half its value.</p>
         <label class="field"><span>Ghola</span><select name="g">${options([['', 'None'], ...opts.map(o => [o.leaderId, `${leaderLabel(o.leaderId)}, ${factionName(o.owner)}: ${o.cost} spice`])], '')}</select></label>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () => done(field(p, 'g').value || null));
    },

    chooseIxianStartingCard(state, factionId, ids) {
      return ask('Choose your starting card',
        `<p>One card for each faction in the game. Keep one; the rest are shuffled and dealt to the others.</p>
         <label class="field"><span>Keep</span><select name="c">${options(ids.map(id => [id, cardName(id)]), ids[0])}</select></label>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Keep this card</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () => done(field(p, 'c').value));
    },

    chooseHmsPlacement(state, factionId, sites) {
      const choices = sites.map(t => [t, territoryName(t)]).sort((a, b) => a[1].localeCompare(b[1]));
      return ask('Place the Hidden Mobile Stronghold',
        `<p>Point your HMS at any non-stronghold territory. Others can only enter it from there. Tapping the map selects a territory.</p>
         <label class="field"><span>Over</span><select name="t">${options(choices, sites.includes('polarSink') ? 'polarSink' : sites[0])}</select></label>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Place it</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () => done(field(p, 't').value));
    },

    chooseHmsMove(state, factionId, reachable) {
      const spiceOn = path => path.slice(1).reduce((n, t) => n + state.board.spiceBlowMarkers.filter(m => m.territoryId === t).reduce((a, m) => a + m.amount, 0), 0);
      const inside = state.factions.ixians.forces.onBoard.hms ?? 0;
      const choices = Object.entries(reachable).map(([t, path]) => [t, `${territoryName(t)} (${path.length - 1} step${path.length > 2 ? 's' : ''}${spiceOn(path) ? `, up to ${Math.min(spiceOn(path), inside * 2 * (path.length - 1))} spice` : ''})`]);
      return ask('Move the HMS?',
        `<p>Before the storm, the HMS may move up to 3 territories, collecting up to ${inside * 2} spice (2 per force inside) from each spice territory it enters.</p>
         <label class="field"><span>Move to</span><select name="t">${options([['', 'Stay where it is'], ...choices], '')}</select></label>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () => done(field(p, 't').value || null));
    },

    chooseIxianBury(state, factionId, ids) {
      return ask('Ixian technology: this auction',
        `<p>You see every card for this auction, plus one extra. Put one back on the deck; the rest are shuffled and auctioned.</p>
         <ul>${ids.map(id => `<li>${esc(cardName(id))}</li>`).join('')}</ul>
         <label class="field"><span>Put back</span><select name="c">${options(ids.map(id => [id, cardName(id)]), ids[ids.length - 1])}</select></label>
         <label class="field"><span>Where</span><select name="w">${options([['bottom', 'Bottom of the deck'], ['top', 'Top (you will know the next card)']], 'bottom')}</select></label>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () => done({ cardId: field(p, 'c').value, where: field(p, 'w').value }));
    },

    chooseIxianAllySwap(state, factionId, cardId) {
      return ask('Ixian alliance: swap this card?',
        `<p>You just bought <strong>${esc(cardName(cardId))}</strong>. As the Ixians' ally you may discard it and draw the top card of the deck instead.</p>
         <div class="decision__actions"><button class="btn" data-action="yes">Swap it</button><button class="btn" data-default-action>Keep it</button></div>`,
        (p, done) => { p.querySelector('[data-action="yes"]').onclick = () => done(true); p.querySelector('[data-default-action]').onclick = () => done(false); });
    },

    chooseRevealFaceDancer(state, factionId, { territoryId, leaderId, winnerId }) {
      const n = state.factions[winnerId].forces.onBoard[territoryId] ?? 0;
      return ask('Reveal a Face Dancer?',
        `<p>${esc(factionName(winnerId))} won in ${esc(territoryName(territoryId))} with <strong>${esc(leaderLabel(leaderId))}</strong>, one of your Face Dancers.</p>
         <p>Reveal it: the win still stands, but that leader goes to the tanks (no spice for it), their ${n} remaining troops there return to their reserves, and up to ${n} of your troops from reserve take their place.</p>
         <div class="decision__actions"><button class="btn" data-action="yes">Reveal</button><button class="btn" data-default-action>Stay hidden</button></div>`,
        (p, done) => { p.querySelector('[data-action="yes"]').onclick = () => done(true); p.querySelector('[data-default-action]').onclick = () => done(false); });
    },

    chooseFaceDancerToReplace(state, factionId, leaderIds) {
      return ask('Mentat Pause: replace a Face Dancer?',
        `<p>You may shuffle one unrevealed Face Dancer back into the traitor deck and draw a replacement.</p>
         <label class="field"><span>Replace</span><select name="fd">${options([['', 'Keep them all'], ...leaderIds.map(id => [id, leaderLabel(id)])], '')}</select></label>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () => done(field(p, 'fd').value || null));
    },

    chooseIncreaseRevivalLimit(state, factionId, { factionId: other, tanks }) {
      return ask('Raise their revival limit?',
        `<p>${esc(factionName(other))} have ${tanks} troops in the tanks. You may raise their revival limit from 3 to 5 this turn. They pay you for every paid revival.</p>
         <div class="decision__actions"><button class="btn" data-action="yes">Raise it to 5</button><button class="btn" data-default-action>Keep it at 3</button></div>`,
        (p, done) => { p.querySelector('[data-action="yes"]').onclick = () => done(true); p.querySelector('[data-default-action]').onclick = () => done(false); });
    },

    chooseThumper(state, factionId) {
      const top = state.decks.spiceDiscardA[state.decks.spiceDiscardA.length - 1];
      const where = top?.type === 'territory' ? territoryName(top.id) : 'no spice territory';
      return ask('Play the Thumper?',
        `<p>Instead of revealing the first Spice Blow card, call Shai-Hulud: the worm devours everything in <strong>${esc(where)}</strong>, and a Nexus follows.</p>
         <div class="decision__actions"><button class="btn" data-action="yes">Play the Thumper</button><button class="btn" data-default-action>Keep it</button></div>`,
        (p, done) => { p.querySelector('[data-action="yes"]').onclick = () => done(true); p.querySelector('[data-default-action]').onclick = () => done(false); });
    },

    chooseHarvester(state, factionId, blows) {
      return ask('Play the Harvester?',
        `<p>Double the spice of one blow that has just landed.</p>
         <label class="field"><span>Blow</span><select name="t">${options([['', 'Keep the card'], ...blows.map(b => [b.territoryId, `${territoryName(b.territoryId)}: ${b.amount} to ${b.amount * 2}`])], '')}</select></label>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Confirm</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () => done(field(p, 't').value || null));
    },

    chooseAmal() { return false; }, // you play Amal from your Hand

    choosePoisonToothUse(state, factionId, territoryId, opponentId, mine, theirs) {
      return ask('Use the Poison Tooth?',
        `<p>Plans are revealed in ${esc(territoryName(territoryId))}. Your Poison Tooth kills <strong>both</strong> leaders (yours and theirs), and a Snooper can't stop it.</p>
         <dl class="facts"><dt>Your leader</dt><dd>${esc(mine.leaderId ? leaderLabel(mine.leaderId) : 'none')}</dd>
         <dt>Their leader</dt><dd>${esc(theirs.leaderId ? leaderLabel(theirs.leaderId) : 'none')}</dd></dl>
         <p>Withhold it and it has no effect, and if you win you keep the card.</p>
         <div class="decision__actions">
           <button class="btn" data-action="use">Use it</button>
           <button class="btn" data-default-action>Withhold it</button>
         </div>`,
        (p, done) => {
          p.querySelector('[data-action="use"]').onclick = () => done(true);
          p.querySelector('[data-default-action]').onclick = () => done(false);
        });
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
             .filter(([v]) => !(v === 'number' && opponentId === 'richese' && state.meta.currentBattle?.noField)) // No-Field hides the dial
             .map(([v, label, why], i) => `<label class="choice"><input type="radio" name="element" value="${v}"${i === 0 ? ' checked' : ''}> <span>${label} <em>${why}</em></span></label>`).join('')}
         </div>
         <div class="decision__actions"><button class="btn btn--primary" data-default-action>Ask</button></div>`,
        (p, done) => p.querySelector('[data-default-action]').onclick = () =>
          done(p.querySelector('input[name="element"]:checked').value));
    },

    chooseBattlePlan(state, factionId, territoryId, opponentId, intel, voice) {
      const me = state.factions[factionId];
      const present = forcesAfterReveal(state, factionId, territoryId);
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

      const revealed = !intel ? '' : intel.full ? (() => {
        const q = intel.plan;
        const bits = [q.leaderId ? leaderLabel(q.leaderId) + ((me.traitorHand ?? []).includes(q.leaderId) ? ' (YOUR TRAITOR)' : '') : (q.cheapHeroCardId ? 'a Cheap Hero' : 'no leader'),
          `${q.forcesCommitted} dialled`, `${q.spiceCommitted ?? 0} spice`, q.weaponCardId ? cardName(q.weaponCardId) : 'no weapon', q.defenseCardId ? cardName(q.defenseCardId) : 'no defence'];
        return `<p class="decision__intel">Karama: ${esc(factionName(intel.opponentId))}'s whole plan: <strong>${esc(bits.join(', '))}</strong>.</p>`;
      })() : (() => {
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
        ? `<p class="decision__known">Known in their hand: <strong>${esc(knownTheirs.join(', '))}</strong></p>` : '';
      // Only the traitors that matter here: leaders of this opponent (and a Cheap Hero traitor).
      const relevant = (me.traitorHand ?? []).filter(id => id === 'cheapHeroTraitor' || leader[id]?.faction === opponentId);
      const traitorNote = relevant.length
        ? `<p class="decision__note">Traitor ready: <strong>${esc(relevant.map(id => id === 'cheapHeroTraitor' ? 'any Cheap Hero' : leaderLabel(id)).join(', '))}</strong> (you'll be offered the reveal)</p>` : '';
      return ask(`Battle in ${territoryName(territoryId)}`,
        `${voiceNote}${revealed}${knownNote}${traitorNote}
         <p class="battle-summary"><span>You <strong>${present}</strong>${starredPresent ? ` (${starredPresent}★)` : ''}</span><span>${esc(factionName(opponentId))} <strong>${theirs}</strong></span><span>Spice <strong>${me.spice}${battleSupportFor(state, factionId) ? `+${battleSupportFor(state, factionId)}` : ''}</strong></span></p>
         <div class="field-pair">
           <label class="field field--stack"><span>Dial</span><select name="forces">${options(range(0, present).map(n => [n, n]), Math.ceil(present / 2))}</select></label>
           ${factionId === 'fremen' ? '<input type="hidden" name="spice" value="0">'
             : `<label class="field field--stack"><span>Spice backing</span><select name="spice">${options(range(0, Math.min(present, battleSpice(state, factionId))).map(n => [n, n]), 0)}</select></label>`}
           ${starredPresent ? `<label class="field field--stack"><span>Of which ★</span><select name="starred">${options(range(0, starredPresent).map(n => [n, n]), 0)}</select></label>` : ''}
         </div>
         <label class="field field--stack"><span>Leader</span><select name="leader">${options(leaderOptions, leaderOptions[0][0])}</select></label>
         <div class="field-pair">
           <label class="field field--stack"><span>Weapon</span><select name="weapon">${options(weaponOptions, '')}</select></label>
           <label class="field field--stack"><span>Defence</span><select name="defense">${options(defenseOptions, '')}</select></label>
         </div>
         <details class="decision__help"><summary>How battles work</summary>Higher total wins; ties go to the aggressor. Dialled forces are lost even if you win; the loser loses everything here. ${factionId === 'fremen' ? 'Fremen count fully without spice.' : 'A dialled force counts fully only if backed by 1 spice, otherwise half.'}</details>
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
            const warn = cardLookup[plan.weaponCardId]?.category === 'specialWeapon' && battleEngine.isShieldCard(cardLookup[plan.defenseCardId])
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
