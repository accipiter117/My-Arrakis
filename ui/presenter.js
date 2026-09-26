// ui/presenter.js
//
// Turns engine events into what the player sees, in order, as they happen:
// event cards (storm, spice blow, Shai-Hulud, battles) and board animation
// (the storm sweeping, the worm erupting, troops marching territory by
// territory, shipments gliding in from off the board, Fremen riding worms).
//
// The turn engine awaits observe(), so play only continues when the
// presentation has finished. Speed 0 skips everything.

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createPresenter({ board, layer, factionColors, names, getSpeed, renderDisplay, renderReal }) {
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

  const handlers = {
    async storm(e, state) {
      await showCard('storm', card(e.first ? 'The first storm' : 'Storm card',
        `${e.sectors} sector${e.sectors === 1 ? '' : 's'}`, `Dials ${e.dials[0]} + ${e.dials[1]}`), 1500);
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
        const shown = showCard('spice', card('Spice blow', names.territory(e.territoryId), `<strong>+${e.amount}</strong> spice`), 1400);
        if (speed()) await board.pulse(e.territoryId, 'spice', scaled(900));
        await shown;
      } else if (e.kind === 'worm') {
        const shown = showCard('worm', card('Shai-Hulud', 'A worm rises',
          `${e.devoured ? `It devours <strong>${esc(names.territory(e.devoured))}</strong>: spice and troops there are lost (Fremen are spared). ` : ''}A Nexus follows.`), 2000);
        if (speed() && e.devoured) await board.worm(e.devoured, scaled(1300));
        await shown;
      } else {
        await showCard('worm', card('Shai-Hulud', 'Set aside', 'Worms drawn on the first turn return to the deck.'), 1300);
      }
    },

    async shipment(e, state) {
      if (!speed()) return;
      renderDisplay(displayWithout(state, e.factionId, e.territoryId, e.amount));
      await board.animateToken({ color: factionColors[e.factionId], count: e.amount,
        points: [board.offBoardPoint(e.territoryId), board.labelPoint(e.territoryId)], msPerHop: scaled(950), hop: 30 });
      renderReal();
    },

    async move(e, state) {
      if (!speed()) return;
      renderDisplay(displayWithout(state, e.factionId, e.to, e.amount));
      const route = board.pathBetween(e.from, e.to).map(board.labelPoint);
      await board.animateToken({ color: factionColors[e.factionId], count: e.amount, points: route, msPerHop: scaled(420) });
      renderReal();
    },

    async wormRide(e, state) {
      await showCard('worm', card('Fremen', 'Ride Shai-Hulud',
        `${e.amount} forces ride from ${esc(names.territory(e.from))} to <strong>${esc(names.territory(e.to))}</strong>.`), 1400);
      if (!speed()) return;
      renderDisplay(displayWithout(state, 'fremen', e.to, e.amount));
      await board.animateToken({ color: factionColors.fremen, count: e.amount,
        points: [board.labelPoint(e.from), board.labelPoint(e.to)], msPerHop: scaled(1200), hop: 60 });
      renderReal();
    },

    async battle(e) {
      const side = f => {
        const p = e.plans[f];
        const who = p.leaderId ? `${esc(names.leader(p.leaderId))}` : p.cheapHero ? 'Cheap Hero' : 'no leader';
        const cards = [p.weapon, p.defense].filter(Boolean).map(id => esc(names.card(id))).join(' + ') || 'no cards';
        const won = e.winnerFactionId === f;
        return `<div class="battle-side${won ? ' battle-side--won' : ''}">
          <div class="battle-side__name"><span class="faction-chip" style="background:${factionColors[f]}"></span>${esc(names.faction(f))}${won ? ' ✓' : ''}</div>
          <div>${who} · ${p.forces} forces</div><div class="battle-side__cards">${cards}</div></div>`;
      };
      const outcome = e.explosion ? 'Lasgun and shield: everything here is destroyed.'
        : e.mutualTraitors ? 'Both leaders were traitors. Both sides lose everything.'
        : `${esc(names.faction(e.winnerFactionId))} wins${e.traitor ? ', revealing a traitor' : ''}.`;
      const shown = showCard('battle', `<div class="event-card__eyebrow">Battle · ${esc(names.territory(e.territoryId))}</div>
        <div class="battle-sides">${side(e.aggressorId)}${side(e.defenderId)}</div>
        <div class="event-card__detail">${outcome}</div>`, 2800);
      if (speed()) await board.pulse(e.territoryId, 'battle', scaled(1000));
      await shown;
    }
  };

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
