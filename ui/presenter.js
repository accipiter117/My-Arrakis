// ui/presenter.js
//
// Turns engine events into what the player sees, in order, as they happen:
// event cards (storm, spice blow, Shai-Hulud, battles) and board animation
// (the storm sweeping, the worm erupting, troops marching territory by
// territory, shipments gliding in from off the board, Fremen riding worms).
//
// The turn engine awaits observe(), so play only continues when the
// presentation has finished. Speed 0 skips everything.

import * as battleEngine from '../js/battleEngine.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createPresenter({ board, layer, factionColors, names, getSpeed, renderDisplay, renderReal, getViewer = () => null, sfx = null, cardLookup = null }) {
  const speed = () => getSpeed();
  const scaled = ms => ms * speed();
  const wait = ms => new Promise(resolve => setTimeout(resolve, scaled(ms)));

  // Show a card over the map until its time is up or it's tapped.
  function showCard(kind, html, ms = 1600) {
    if (!speed()) return Promise.resolve();
    return new Promise(resolve => {
      layer.innerHTML = `<div class="event-card event-card--${kind}" role="status">${html}<div class="event-card__hint">tap to continue</div></div>`;
      layer.hidden = false;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        layer.hidden = true;
        layer.innerHTML = '';
        resolve();
      };
      layer.onclick = finish;
      setTimeout(finish, scaled(ms));
    });
  }

  // The engine reports an event after applying it; show the destination
  // as it was just before, so the marching token arrives into it.
  function displayWithout(state, factionId, territoryId, amount) {
    const display = structuredClone(state);
    const forces = display.factions[factionId].forces;
    forces.onBoard[territoryId] = (forces.onBoard[territoryId] ?? 0) - amount;
    if (forces.onBoard[territoryId] <= 0) delete forces.onBoard[territoryId];
    return display;
  }

  const card = (eyebrow, title, detail = '') =>
    `<div class="event-card__eyebrow">${esc(eyebrow)}</div><div class="event-card__title">${esc(title)}</div>${detail ? `<div class="event-card__detail">${detail}</div>` : ''}`;

  // --- The auction: one card that stays up while bids go round the table.
  let auction = null;
  function auctionLine(html, cls = '') {
    if (!auction) return;
    const li = document.createElement('li');
    li.className = cls;
    li.innerHTML = html;
    auction.list.appendChild(li);
    auction.list.scrollTop = auction.list.scrollHeight;
  }
  const chip = f => `<span class="faction-chip" style="background:${factionColors[f]}"></span>${esc(names.faction(f))}`;

  const handlers = {
    async auctionStart(e) {
      if (!speed()) return;
      // Only Atreides may see the card before bidding (Prescience).
      const seen = getViewer() === 'atreides' ? esc(names.card(e.cardId)) : 'Face down';
      layer.innerHTML = `<div class="event-card event-card--auction" role="status">
        <div class="event-card__eyebrow">Auction · card ${e.index + 1} of ${e.total}</div>
        <div class="event-card__title">${seen}</div>
        <ol class="auction-bids"></ol></div>`;
      layer.hidden = false;
      layer.onclick = null; // stays up for the whole auction
      auction = { list: layer.querySelector('.auction-bids') };
      await wait(600);
    },
    async bid(e) {
      auctionLine(`${chip(e.factionId)} bids <strong>${e.amount}</strong>`);
      await wait(650);
    },
    async pass(e) {
      auctionLine(`${chip(e.factionId)} passes`, 'is-pass');
      await wait(300);
    },
    async auctionWon(e) {
      auctionLine(`${chip(e.factionId)} wins for <strong>${e.price} spice</strong>${e.bonus ? ' and draws a free bonus card' : ''}`, 'is-won');
      await wait(1800);
      endAuction();
    },
    async auctionUnsold(e) {
      auctionLine(`No bids. ${e.returned} card${e.returned === 1 ? '' : 's'} return to the deck; the auction ends.`, 'is-won');
      await wait(1800);
      endAuction();
    },

    async storm(e, state) {
      const how = e.stormCard ? 'Revealed by the Fremen, who foresaw it last turn.'
        : e.dials ? `Dials ${e.dials[0]} + ${e.dials[1]}` : '';
      await showCard('storm', card(e.first ? 'The first storm' : e.stormCard ? 'Storm card' : 'Storm',
        `${e.sectors} sector${e.sectors === 1 ? '' : 's'}`, how), 2600);
      if (!speed()) return;
      // Sweep sector by sector.
      for (let step = 1; step <= e.sectors; step++) {
        const display = structuredClone(state);
        display.board.stormPosition = (e.from + step) % 18;
        renderDisplay(display);
        await wait(90);
      }
      renderReal();
    },

    async spiceCard(e) {
      if (e.kind === 'territory') {
        const shown = showCard('spice', card('Spice blow', names.territory(e.territoryId), `<strong>+${e.amount}</strong> spice`), 2300);
        if (speed()) await board.pulse(e.territoryId, 'spice', scaled(900));
        await shown;
      } else if (e.kind === 'worm') {
        if (speed()) sfx?.play('wormRoar');
        const shown = showCard('worm', card('Shai-Hulud', 'A worm rises',
          `${e.devoured ? `It devours <strong>${esc(names.territory(e.devoured))}</strong>: spice and troops there are lost (Fremen are spared). ` : ''}A Nexus follows.`), 3200);
        if (speed() && e.devoured) await board.worm(e.devoured, scaled(1300));
        await shown;
      } else {
        await showCard('worm', card('Shai-Hulud', 'Set aside', 'Worms drawn on the first turn return to the deck.'), 2200);
      }
    },

    async shipment(e, state) {
      if (!speed()) return;
      // Troops arriving from off-world. The Fremen are already on Arrakis:
      // their "shipment" is a march from the deep desert, so no ship.
      if (e.factionId !== 'fremen') sfx?.play('shipArrival');
      renderDisplay(displayWithout(state, e.factionId, e.territoryId, e.amount));
      await board.animateToken({ color: factionColors[e.factionId], count: e.amount,
        points: [board.offBoardPoint(e.territoryId), board.labelPoint(e.territoryId)], msPerHop: scaled(950), hop: 30 });
      renderReal();
    },

    async move(e, state) {
      if (!speed()) return;
      renderDisplay(displayWithout(state, e.factionId, e.to, e.amount));
      if (e.ornithopter) {
        // Ornithopters: one smooth, high flight straight to the destination.
        sfx?.play('ornithopter');
        await board.animateToken({ color: factionColors[e.factionId], count: e.amount,
          points: [board.labelPoint(e.from), board.labelPoint(e.to)], msPerHop: scaled(1300), hop: 70 });
      } else {
        // On foot: marching territory by territory.
        const route = board.pathBetween(e.from, e.to).map(board.labelPoint);
        await board.animateToken({ color: factionColors[e.factionId], count: e.amount, points: route, msPerHop: scaled(420) });
      }
      renderReal();
    },

    async wormRide(e, state) {
      await showCard('worm', card('Fremen', 'Ride Shai-Hulud',
        `${e.amount} forces ride from ${esc(names.territory(e.from))} to <strong>${esc(names.territory(e.to))}</strong>.`), 2300);
      if (!speed()) return;
      renderDisplay(displayWithout(state, 'fremen', e.to, e.amount));
      await board.animateToken({ color: factionColors.fremen, count: e.amount,
        points: [board.labelPoint(e.from), board.labelPoint(e.to)], msPerHop: scaled(1200), hop: 60 });
      renderReal();
    },

    async traitor(e) {
      const html = `<div class="event-card__eyebrow">Traitor!</div>
        <div class="event-card__title">${esc(names.leader(e.leaderId))}</div>
        <div class="event-card__detail">was secretly in ${esc(names.faction(e.revealedBy))}'s pay.
        ${esc(names.faction(e.forFaction))} wins in ${esc(names.territory(e.territoryId))}, losing nothing.</div>`;
      const shown = showCard('traitor', html, 3600);
      if (speed()) await board.pulse(e.territoryId, 'battle', scaled(1100));
      await shown;
    },

    async allianceFormed(e) {
      await showCard('nexus', card('Alliance', `${names.faction(e.proposer)} & ${names.faction(e.target)}`,
        'They now win together with 4 strongholds between them.'), 3000);
    },

    async allianceRejected(e) {
      await showCard('nexus', card('Alliance refused', names.faction(e.target), `turned down ${esc(names.faction(e.proposer))}.`), 2200);
    },

    async allianceBroken(e) {
      await showCard('nexus', card('Alliance broken', names.faction(e.by), `breaks with ${esc(names.faction(e.of))}.`), 2800);
    },

    // The big reveal: both battle plans flip over row by row, then the
    // clash of weapons, the strength sums and the verdict, recomputed with
    // the engine's own rules functions so the player can follow exactly how
    // the result was reached. Tap to move on faster.
    async battle(e) {
      if (!speed()) return;
      const agg = e.aggressorId, def = e.defenderId, sides = [agg, def];
      const P = e.plans;
      const opp = f => (f === agg ? def : agg);
      const cat = id => cardLookup?.[id]?.category;
      const CATS = { poisonWeapon: 'poison weapon', projectileWeapon: 'projectile weapon', specialWeapon: 'lasgun',
        poisonDefense: 'poison defence', projectileDefense: 'projectile defence', worthless: 'worthless: a bluff' };
      const asPlan = p => ({ forcesCommitted: p.forces, starredForcesCommitted: p.starred, spiceCommitted: p.spice,
        supportedStarredCount: p.supportedStarred, supportedOrdinaryCount: p.supportedOrdinary,
        leaderId: p.leaderId, leaderFightingValue: p.leaderValue, weaponCardId: p.weapon, defenseCardId: p.defense });
      const wd = battleEngine.resolveWeaponDefense(asPlan(P[agg]), asPlan(P[def]), cardLookup ?? {});
      const killed = { [agg]: wd.aggressorLeaderKilled, [def]: wd.defenderLeaderKilled };
      const leaderName = f => P[f].leaderId ? names.leader(P[f].leaderId) : P[f].cheapHero ? 'a Cheap Hero' : 'no leader';
      const strength = f => {
        const p = P[f];
        const starV = battleEngine.starredUnitValueFor(f, opp(f));
        const ordinary = p.forces - p.starred;
        const troops = p.supportedStarred * starV + (p.starred - p.supportedStarred) * starV / 2
          + p.supportedOrdinary + (ordinary - p.supportedOrdinary) * 0.5;
        const leader = killed[f] ? 0 : p.leaderValue;
        const kh = p.kwisatzHaderach && !killed[f] ? 2 : 0;
        return { troops, leader, kh, total: troops + leader + kh };
      };
      const fmt = n => (Number.isInteger(n) ? String(n) : n.toFixed(1));

      // Build the stage.
      layer.innerHTML = `<div class="battle-reveal" role="status">
        <div class="br-eyebrow">Battle</div>
        <div class="br-title">${esc(names.territory(e.territoryId))}</div>
        <div class="br-sides">${sides.map(f => `<div class="br-side"><span class="faction-chip" style="background:${factionColors[f]}"></span>${esc(names.faction(f))}<small>${f === agg ? 'attacker' : 'defender'}</small></div>`).join('')}</div>
        <div class="br-rows"></div>
        <div class="br-hint">tap to move on</div>
      </div>`;
      layer.hidden = false;
      const rows = layer.querySelector('.br-rows');
      let hurry = null;
      layer.onclick = () => hurry?.();
      const step = ms => new Promise(resolve => { const t = setTimeout(resolve, scaled(ms)); hurry = () => { clearTimeout(t); resolve(); }; });
      const row = (label, cells, cls = '') => {
        const el = document.createElement('div');
        el.className = `br-row ${cls}`;
        el.innerHTML = `<div class="br-label">${label}</div>${cells.map(c => `<div class="br-cell">${c}</div>`).join('')}`;
        rows.appendChild(el);
        rows.scrollTop = rows.scrollHeight;
      };
      const wide = (label, html, cls = '') => {
        const el = document.createElement('div');
        el.className = `br-row br-row--wide ${cls}`;
        el.innerHTML = `<div class="br-label">${label}</div><div class="br-cell">${html}</div>`;
        rows.appendChild(el);
        rows.scrollTop = rows.scrollHeight;
      };
      if (speed()) board.pulse(e.territoryId, 'battle', scaled(1200));
      await step(900);

      // 1-5: the plans, both sides at once.
      row('Leader', sides.map(f => `<strong>${esc(leaderName(f))}</strong> <span class="br-num">${P[f].leaderValue}</span>${P[f].kwisatzHaderach ? '<br><em>+ Kwisatz Haderach</em>' : ''}`));
      await step(1300);
      row('Troops dialled', sides.map(f => `<span class="br-num">${P[f].forces}</span> <em>of ${P[f].forcesPresent}${P[f].starred ? `, ${P[f].starred}★` : ''}</em>`));
      await step(1300);
      row('Spice committed', sides.map(f => {
        const full = P[f].supportedStarred + P[f].supportedOrdinary, half = P[f].forces - full;
        return `<span class="br-num">${P[f].spice}</span> <em>${P[f].forces ? `${full} at full strength${half ? `, ${half} at half` : ''}` : ''}</em>`;
      }));
      await step(1300);
      row('Weapon', sides.map(f => P[f].weapon ? `<strong>${esc(names.card(P[f].weapon))}</strong><br><em>${CATS[cat(P[f].weapon)] ?? ''}</em>` : '<em>none</em>'));
      await step(1300);
      row('Defence', sides.map(f => P[f].defense ? `<strong>${esc(names.card(P[f].defense))}</strong><br><em>${CATS[cat(P[f].defense)] ?? ''}</em>` : '<em>none</em>'));
      await step(1500);

      // 6-8: how it resolves.
      if (e.traitor || e.mutualTraitors) {
        wide('Treachery', e.mutualTraitors ? 'Both leaders are traitors. Both sides lose everything here.'
          : `<strong>${esc(names.leader(e.traitorCard?.leaderId))}</strong> was a traitor in ${esc(names.faction(e.traitorCard?.revealedBy))}'s pay. The battle ends at once.`, 'br-row--danger');
        await step(1800);
      } else if (e.explosion) {
        wide('Lasgun meets shield', 'An explosion. Every troop, leader and grain of spice here is destroyed.', 'br-row--danger');
        await step(1800);
      } else {
        row('Clash', sides.map(f => {
          const incoming = P[opp(f)].weapon;
          if (!incoming || !battleEngine.WEAPONS.includes(cat(incoming))) return `<em>No weapon threatens ${esc(leaderName(f))}</em>`;
          return killed[f] ? `<span class="br-bad">${esc(names.card(incoming))} kills ${esc(leaderName(f))}</span>`
            : `<span class="br-good">${esc(names.card(P[f].defense))} stops ${esc(names.card(incoming))}</span>`;
        }));
        await step(1700);
        row('Strength', sides.map(f => {
          const s = strength(f);
          return `<em>troops ${fmt(s.troops)} + leader ${fmt(s.leader)}${killed[f] ? ' (fallen)' : ''}${s.kh ? ' + KH 2' : ''}</em><br><span class="br-num br-num--big">${fmt(s.total)}</span>`;
        }));
        await step(1800);
      }

      // The verdict and the cost.
      const w = e.winnerFactionId, l = e.loserFactionId;
      let verdict;
      if (!w) verdict = 'No victor.';
      else if (e.traitor) verdict = `${esc(names.faction(w))} win${w.endsWith('s') ? '' : 's'} by treachery`;
      else {
        const sw = strength(w).total, sl = strength(l).total;
        verdict = `${esc(names.faction(w))} win ${fmt(sw)} to ${fmt(sl)}${sw === sl ? '<br><em>a tie goes to the attacker</em>' : ''}`;
      }
      wide('Verdict', `<span class="br-verdict">${verdict}</span>`, 'br-row--verdict');
      await step(1300);
      if (w && l) {
        const costs = [`${esc(names.faction(l))} lose every troop here (${P[l].forcesPresent})`];
        if (!e.traitor && P[w].forces) costs.push(`${esc(names.faction(w))} lose the ${P[w].forces} they dialled`);
        if (e.traitor) costs.push(`${esc(names.faction(w))} lose nothing`);
        if (e.spiceOwedToWinner) costs.push(`${esc(names.faction(w))} collect ${e.spiceOwedToWinner} spice for fallen leaders`);
        wide('Cost', costs.join('<br>'));
      }
      await step(4500);
      hurry = null;
      layer.hidden = true;
      layer.innerHTML = '';
    }
  };

  function endAuction() {
    auction = null;
    layer.hidden = true;
    layer.innerHTML = '';
  }

  return {
    async observe(event, state) {
      try {
        await handlers[event.type]?.(event, state);
      } catch (err) {
        console.error('Presentation failed', err); // never let a visual glitch stop the game
        renderReal();
      }
    }
  };
}
