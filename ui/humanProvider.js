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
      panel.innerHTML = `<h2 class="decision__title">${esc(title)}</h2><div class="decision__body">${html}</div>`;
      panel.hidden = false;
      onWaiting?.(true);
      const done = value => {
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
      const free = revivalEngine.freeRevivalAllowance(factionId);
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
           <p class="decision__note">Your shipment happens first, then your move.</p>
         </fieldset>
         ${me.treacheryHand.includes('hajr') ? `<fieldset><legend>Hajr: an extra move (uses the card)</legend>
           <label class="field"><span>From</span><select name="hajrFrom">${options(fromOptions.map(([v, l]) => [v, v ? l : 'Keep the card']), '')}</select></label>
           <label class="field"><span>To</span><select name="hajrTo"><option value="">Choose a starting territory</option></select></label>
           <label class="field"><span>Forces</span><input type="number" name="hajrAmount" min="1" value="1"></label>
           <p class="decision__note">Made after your normal move. Checked again when it happens.</p>
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
          const check = () => {
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
            setError(p, problems.join(' ') || null);
            btn.disabled = problems.length > 0;
          };
          field(p, 'moveFrom').onchange = () => { refreshDestinations(); check(); };
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
              hajrMove: field(p, 'hajrFrom')?.value
                ? { from: field(p, 'hajrFrom').value, to: field(p, 'hajrTo').value, amount: num(p, 'hajrAmount') } : null
            });
          };
        });
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

    chooseBattlePlan(state, factionId, territoryId, opponentId, intel) {
      const me = state.factions[factionId];
      const present = me.forces.onBoard[territoryId] ?? 0;
      const starredPresent = me.forces.starredOnBoard?.[territoryId] ?? 0;
      const theirs = state.factions[opponentId].forces.onBoard[territoryId] ?? 0;
      const hand = me.treacheryHand.map(id => ({ id, category: cardLookup[id]?.category }));
      const leaders = me.leaders.available.slice().sort((a, b) => (leader[b]?.fightingValue ?? 0) - (leader[a]?.fightingValue ?? 0));
      const heroes = hand.filter(c => c.category === 'specialLeaderSubstitute');
      const leaderOptions = [
        ...leaders.map(id => [`leader:${id}`, leaderLabel(id)]),
        ...heroes.map(c => [`hero:${c.id}`, `${cardName(c.id)} (0)`]),
        ['', 'None available']
      ];
      const weaponOptions = [['', 'No weapon'], ...hand.filter(c => WEAPONS.includes(c.category)).map(c => [c.id, cardName(c.id)])];
      const defenseOptions = [['', 'No defence'], ...hand.filter(c => DEFENSES.includes(c.category)).map(c => [c.id, cardName(c.id)])];
      const kh = me.specialFactionState?.kwisatzHaderachActive;

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
      return ask(`Battle in ${territoryName(territoryId)}`,
        `${revealed}<dl class="facts"><dt>Opponent</dt><dd>${esc(factionName(opponentId))}, ${theirs} forces</dd>
         <dt>Your forces here</dt><dd>${present}${starredPresent ? ` (${starredPresent} starred)` : ''}</dd><dt>Your spice</dt><dd>${me.spice}</dd></dl>
         <p>The side with the higher total wins; ties go to the aggressor. Forces you dial are lost even if you win. If you lose, you lose every force here. Each dialed force counts fully only if backed by 1 spice.</p>
         <label class="field"><span>Forces to dial</span><select name="forces">${options(range(0, present).map(n => [n, n]), Math.ceil(present / 2))}</select></label>
         ${starredPresent ? `<label class="field"><span>Of which starred</span><select name="starred">${options(range(0, starredPresent).map(n => [n, n]), 0)}</select></label>` : ''}
         <label class="field"><span>Spice to back them</span><select name="spice">${options(range(0, Math.min(present, me.spice)).map(n => [n, n]), 0)}</select></label>
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
            const result = battleEngine.canDeclareBattlePlan(state, territoryId, factionId, plan);
            const warn = cardLookup[plan.weaponCardId]?.category === 'specialWeapon' && cardLookup[plan.defenseCardId]?.category === 'projectileDefense'
              ? ' Warning: a lasgun with your own shield explodes, destroying everything here.' : '';
            const strength = battleEngine.calculateStrength({ ...plan, starredUnitValue: battleEngine.starredUnitValueFor(factionId, opponentId), leaderWasKilled: false, kwisatzHaderachBonus: plan.useKwisatzHaderach ? 2 : 0 });
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
