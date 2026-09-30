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

const CATEGORY_TEXT = { poisonWeapon: 'a poison weapon', projectileWeapon: 'a projectile weapon', specialWeapon: 'a Lasgun', poisonDefense: 'a poison defence', projectileDefense: 'a projectile defence', specialLeaderSubstitute: 'a Cheap Hero', worthless: 'a worthless card' };

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createPresenter({ board, layer, banner = null, factionColors, names, getSpeed, renderDisplay, renderReal, getViewer = () => null, sfx = null, cardLookup = null,
  techTray = null, onTechChange = () => {} }) {
  const speed = () => getSpeed();
  const scaled = ms => ms * speed();
  const wait = ms => new Promise(resolve => setTimeout(resolve, scaled(ms)));

  // Show a card over the map until its time is up or it's tapped.
  function showCard(kind, html, ms = 1600) {
    if (!speed()) return Promise.resolve();
    return new Promise(resolve => {
      layer.classList.remove('event-layer--top');
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

  // The spice-blow phase is fully resolved before its cards are shown: hide the
  // markers of cards not yet shown, so each appears as its own card does.
  function displayUpToDraw(state, e) {
    const draws = state.nexus?.draws ?? [];
    const i = draws.findIndex(d => d.kind === e.kind && d.territoryId === e.territoryId && d.amount === e.amount && d.pile === e.pile);
    const later = i < 0 ? [] : draws.slice(i + 1).filter(d => d.kind === 'territory');
    if (!later.length) return state;
    const display = structuredClone(state);
    for (const d of later) {
      const k = display.board.spiceBlowMarkers.findIndex(m => m.territoryId === d.territoryId && m.amount >= d.amount);
      if (k >= 0) display.board.spiceBlowMarkers.splice(k, 1);
    }
    return display;
  }
  // Units just after a battle, before a Face Dancer swap: the winner's troops still
  // stand there and the Tleilaxu have not yet arrived.
  function displayBeforeSwap(state, fd) {
    const display = structuredClone(state);
    const tl = display.factions.tleilaxu?.forces, win = display.factions[fd.winnerId]?.forces;
    if (tl) { tl.onBoard[fd.territoryId] = Math.max(0, (tl.onBoard[fd.territoryId] ?? 0) - (fd.placed ?? 0)); if (!tl.onBoard[fd.territoryId]) delete tl.onBoard[fd.territoryId]; }
    if (win && fd.returned) win.onBoard[fd.territoryId] = (win.onBoard[fd.territoryId] ?? 0) + fd.returned;
    return display;
  }
  const hold = ms => new Promise(r => setTimeout(r, ms));

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

  // --- Turn banner: whose turn it is, at the top centre of the map -------------
  const PHASE_LABELS = { shipment: 'Shipment & movement', revival: 'Revival' };
  const counterUrl = f => new URL(`../assets/counters/${f}.png`, import.meta.url).href;
  function showBanner(factionId, phase, mine) {
    if (!banner) return;
    banner.style.setProperty('--banner-colour', factionColors[factionId]);
    banner.innerHTML = `<img src="${counterUrl(factionId)}" alt="">
      <div><div class="turn-banner__name">${mine ? 'Your turn' : esc(names.faction(factionId))}</div>
      <div class="turn-banner__phase">${mine ? esc(names.faction(factionId)) + ' · ' : ''}${esc(PHASE_LABELS[phase] ?? phase)}</div>
      <div class="turn-banner__note" hidden></div></div>`;
    banner.hidden = false;
    banner.classList.remove('turn-banner--leaving');
  }
  function bannerNote(text) {
    const note = banner?.querySelector('.turn-banner__note');
    if (note) { note.textContent = text; note.hidden = false; }
  }
  function hideBanner() {
    if (!banner || banner.hidden) return;
    banner.classList.add('turn-banner--leaving');
    setTimeout(() => { if (banner.classList.contains('turn-banner--leaving')) banner.hidden = true; }, 250);
  }

  // --- Tech Tokens: fly a token across the map into its holder's tray slot -----------
  const TECH_NAMES = { axlotl: 'Axlotl Tanks', heighliner: 'Heighliners', spiceProd: 'Spice Production' };
  const techUrl = t => new URL(`../assets/tokens/tech-${t}.png?v=2`, import.meta.url).href;
  let pendingTech = [];
  async function flyTech(token, fromScreen, ownerId, caption) {
    const slot = techTray?.querySelector(`[data-token="${token}"]`);
    if (!slot || !fromScreen || !speed()) { onTechChange(); return; }
    const to = slot.getBoundingClientRect();
    const img = document.createElement('div');
    img.className = 'tech-flyer';
    img.style.setProperty('--flyer-colour', factionColors[ownerId] ?? '#c9a24a');
    img.innerHTML = `<img src="${techUrl(token)}" alt=""><span class="tech-flyer__caption">${caption}</span>`;
    document.body.appendChild(img);
    const size = 64, x0 = fromScreen.x - size / 2, y0 = fromScreen.y - size / 2;
    const x1 = to.left + to.width / 2 - size / 2, y1 = to.top + to.height / 2 - size / 2;
    img.style.left = `${x0}px`; img.style.top = `${y0}px`;
    // Rise and glow on the battlefield, hold, then sweep into the tray.
    await img.animate([{ transform: 'scale(0.2) rotate(-40deg)', opacity: 0 }, { transform: 'scale(1.25) rotate(0)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)', opacity: 1 }],
      { duration: scaled(700), easing: 'ease-out', fill: 'forwards' }).finished;
    await wait(900);
    img.querySelector('.tech-flyer__caption').remove();
    await img.animate([{ transform: 'translate(0,0) scale(1)' }, { transform: `translate(${x1 - x0}px, ${y1 - y0}px) scale(0.55)` }],
      { duration: scaled(850), easing: 'cubic-bezier(.5,0,.3,1)', fill: 'forwards' }).finished;
    img.remove();
    onTechChange();
    slot.classList.remove('tech-slot--arrive'); void slot.offsetWidth; slot.classList.add('tech-slot--arrive');
  }
  async function playTechTransfers() {
    const list = pendingTech; pendingTech = [];
    for (const e of list) {
      const at = board.screenPointOf?.(board.labelPoint(e.territoryId));
      await flyTech(e.token, at, e.to, `${esc(TECH_NAMES[e.token])}<br><small>${esc(names.faction(e.from))} → ${esc(names.faction(e.to))}</small>`);
    }
  }

  // After a battle's reveal: show the survivors on the board with the camera still
  // there; then any Face Dancer swap, visibly; then any Tech Token changing hands.
  let pendingFaceDancer = null, battleState = null;
  async function afterBattle(e) {
    const fd = pendingFaceDancer && pendingFaceDancer.territoryId === e.territoryId ? pendingFaceDancer : null;
    pendingFaceDancer = null;
    if (fd && battleState) {
      renderDisplay(displayBeforeSwap(battleState, fd));
      board.pulse(e.territoryId, 'battle', scaled(800));
      await hold(scaled(1000));
      await showCard('traitor', `<div class="event-card__eyebrow">Face Dancer!</div><div class="event-card__title">${esc(names.leader(fd.leaderId))}</div>
        <div class="event-card__detail">was a Tleilaxu Face Dancer. ${esc(names.faction(fd.winnerId))} keep the win, but lose the leader, and ${fd.returned} troops go home; ${fd.placed} Tleilaxu take ${esc(names.territory(fd.territoryId))}.</div>`, 3200);
      renderReal();
      board.pulse(e.territoryId, 'battle', scaled(800));
      await hold(scaled(1100));
    } else {
      renderReal();
      board.pulse(e.territoryId, 'battle', scaled(700));
      await hold(scaled(900));
    }
    battleState = null;
    await playTechTransfers();
  }

  const handlers = {
    // A Tech Token changes hands: shown once the battle's reveal is over.
    async techTokenTaken(e) {
      if (!speed()) { onTechChange(); return; }
      pendingTech.push(e);
    },
    // Start of the game: each token flies from the middle of the map to its holder.
    async techTokensAssigned(e) {
      if (!speed()) { onTechChange(); return; }
      const r = document.getElementById('board')?.getBoundingClientRect();
      const mid = r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
      for (const [t, f] of Object.entries(e.owners)) if (f) await flyTech(t, mid, f, `${esc(TECH_NAMES[t])}<br><small>${esc(names.faction(f))}</small>`);
    },
    // A token pays out: its slot flashes the amount.
    async techIncome(e) {
      const slot = techTray?.querySelector(`[data-token="${e.token}"]`);
      if (!slot || !speed()) return;
      const tag = document.createElement('span');
      tag.className = 'tech-slot__gain'; tag.textContent = `+${e.amount}`;
      slot.appendChild(tag);
      setTimeout(() => tag.remove(), 1400);
      await wait(500);
    },
    // A faction's turn begins: announce it, and give the player a moment to see it.
    async turnStart(e) {
      if (!speed()) return;
      const mine = getViewer() === e.factionId;
      showBanner(e.factionId, e.phase, mine);
      sfx?.play(`turn-${e.factionId}`); // per-faction announcement audio, once supplied
      if (!mine) await wait(900);
    },
    // A faction's turn ends: say what happened if it isn't already visible.
    async turnEnd(e) {
      if (!speed()) return;
      const mine = getViewer() === e.factionId;
      const note = !e.acted ? 'passes'
        : e.phase === 'revival' ? `revives ${[e.forces ? `${e.forces} troop${e.forces === 1 ? '' : 's'}` : '', e.leaders ? `${e.leaders} leader${e.leaders === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ')}`
        : null;
      if (note) bannerNote(note);
      await wait(note ? (mine ? 500 : 1000) : (mine ? 0 : 450));
      hideBanner();
    },

    async weatherControl(e) {
      await showCard('storm', card('Weather Control', names.faction(e.factionId), `moves the storm <strong>${e.sectors}</strong> sector${e.sectors === 1 ? '' : 's'}`), 2600);
    },
    async familyAtomics(e) {
      if (speed()) await board.focusOn([board.labelPoint('shieldWall')], { ms: scaled(600), minW: 480 });
      if (speed()) board.pulse('shieldWall', 'battle', scaled(1400));
      renderReal();
      await showCard('storm', card('Family Atomics', 'The Shield Wall falls', `${esc(names.faction(e.factionId))} detonate. Arrakeen, Carthag and Imperial Basin are open to the storm.`), 3200);
    },
    // A battle is about to be fought: go there before any plans are made.
    async battleStart(e) {
      if (!speed()) return;
      await board.focusOn([board.labelPoint(e.territoryId)], { ms: scaled(600), minW: 380, anchor: 0.22 });
    },

    async auctionStart(e) {
      if (!speed()) return;
      // Only Atreides may see the card before bidding (Prescience).
      const seen = ['atreides', 'ixians'].includes(getViewer()) ? esc(names.card(e.cardId)) : 'Face down';
      layer.classList.add('event-layer--top'); // stays visible above your bid panel
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
      await board.overview(scaled(600));
      // Sweep sector by sector.
      for (let step = 1; step <= e.sectors; step++) {
        const display = structuredClone(state);
        display.board.stormPosition = (e.from + step) % 18;
        renderDisplay(display);
        await wait(90);
      }
      renderReal();
      // What the storm destroyed on the sand it crossed.
      const d = e.damage;
      if (d && (d.losses.length || d.spiceLost.length)) {
        d.territories.forEach(t => board.pulse(t, 'battle', scaled(900)));
        const lines = [...d.losses.map(l => `${esc(names.faction(l.factionId))} lose <strong>${l.lost}</strong> in ${esc(names.territory(l.territoryId))}`),
          ...d.spiceLost.map(x => `<strong>${x.amount}</strong> spice blown away in ${esc(names.territory(x.territoryId))}`)];
        await showCard('storm', `<div class="event-card__eyebrow">Storm damage</div><div class="event-card__detail">${lines.join('<br>')}</div>`, 3000);
      }
    },

    async spiceCard(e, state) {
      if (e.kind === 'territory') {
        if (speed()) await board.focusOn([board.labelPoint(e.territoryId)], { ms: scaled(500), minW: 480 });
        // The spice lands on the board as its card is shown, and the camera stays until both are seen.
        if (speed() && state) renderDisplay(displayUpToDraw(state, e));
        const shown = showCard('spice', card('Spice blow', names.territory(e.territoryId), `<strong>+${e.amount}</strong> spice`), 2300);
        if (speed()) await board.pulse(e.territoryId, 'spice', scaled(900));
        await shown;
        if (speed()) await hold(scaled(350));
      } else if (e.kind === 'sandtrout') {
        await showCard('worm', card('Sandtrout', 'All alliances end', 'The next worm brings no Nexus, and the spice after it is doubled.'), 2600);
      } else if (e.kind === 'worm') {
        if (speed()) sfx?.play('wormRoar');
        const shown = showCard('worm', card('Shai-Hulud', 'A worm rises',
          `${e.devoured ? `It devours <strong>${esc(names.territory(e.devoured))}</strong>: spice and troops there are lost (Fremen are spared). ` : ''}A Nexus follows.`), 3200);
        if (speed() && e.devoured) {
          const [x, y] = board.labelPoint(e.devoured);
          await board.focusOn([[x, y]], { ms: scaled(500), minW: 480 });
          await board.wormDelivers({ at: [x, y + 14], ms: scaled(1800) });
          if (state) renderDisplay(displayUpToDraw(state, e)); // the devoured troops and spice are gone
        }
        await shown;
        if (speed() && e.devoured) await hold(scaled(500));
      } else {
        await showCard('worm', card('Shai-Hulud', 'Set aside', 'Worms drawn on the first turn return to the deck.'), 2200);
      }
    },

    async shipment(e, state) {
      if (!speed()) return;
      renderDisplay(displayWithout(state, e.factionId, e.territoryId, e.amount));
      const [lx, ly] = board.labelPoint(e.territoryId);
      const at = [lx, ly + 14]; // where the counter sits in the territory
      await board.focusOn([at], { ms: scaled(600), minW: 480 });
      if (e.factionId === 'fremen') {
        // The Fremen come from the deep desert: Shai-Hulud brings them.
        sfx?.play('wormDelivery');
        await board.wormDelivers({ count: e.amount, at, ms: scaled(1800) });
      } else {
        // Everyone else ships in from off-world: their ship flies in and lands.
        sfx?.play('shipArrival');
        await board.flyShip({ faction: e.factionId, count: e.amount, from: board.offBoardPoint(e.territoryId), to: at, ms: scaled(1250), landMs: scaled(450) });
      }
      renderReal();
    },

    async move(e, state) {
      if (!speed()) return;
      renderDisplay(displayWithout(state, e.factionId, e.to, e.amount));
      const ground = id => { const [x, y] = board.labelPoint(id); return [x, y + 14]; };
      await board.focusOn(e.crossShip || e.ornithopter ? [ground(e.from), ground(e.to)] : board.pathBetween(e.from, e.to).map(board.labelPoint), { ms: scaled(600) });
      if (e.crossShip) {
        // The Guild ships across the planet: its Heighliner lifts off and sets down.
        sfx?.play('shipArrival');
        await board.flyShip({ faction: e.factionId, count: e.amount, from: ground(e.from), to: ground(e.to), ms: scaled(1100), landMs: scaled(400), takeoffMs: scaled(350) });
      } else if (e.ornithopter) {
        // Ornithopters: the faction's 'thopter lifts the troops out and sets them down.
        sfx?.play('ornithopter');
        await board.flyThopter({ faction: e.factionId, count: e.amount, from: ground(e.from), to: ground(e.to), ms: scaled(1100), landMs: scaled(400), takeoffMs: scaled(350) });
      } else {
        // On foot: marching territory by territory.
        const route = board.pathBetween(e.from, e.to).map(board.labelPoint);
        await board.animateToken({ color: factionColors[e.factionId], count: e.amount, points: route, msPerHop: scaled(420) });
      }
      renderReal();
    },

    async wormRide(e, state) {
      if (speed()) await board.focusOn([board.labelPoint(e.from), board.labelPoint(e.to)], { ms: scaled(600) });
      await showCard('worm', card('Fremen', 'Ride Shai-Hulud',
        `${e.amount} forces ride from ${esc(names.territory(e.from))} to <strong>${esc(names.territory(e.to))}</strong>.`), 2300);
      if (!speed()) return;
      renderDisplay(displayWithout(state, 'fremen', e.to, e.amount));
      await board.animateToken({ color: factionColors.fremen, count: e.amount,
        points: [board.labelPoint(e.from), board.labelPoint(e.to)], msPerHop: scaled(1200), hop: 60 });
      renderReal();
    },

    async truthtrance(e) {
      const q = e.question;
      const text = q.kind === 'holdsCategory' ? `Do you hold ${CATEGORY_TEXT[q.category] ?? 'that kind of card'}?`
        : q.kind === 'isTraitor' ? `Is ${names.leader(q.leaderId)} your traitor?` : `Do you have at least ${q.amount} spice?`;
      await showCard('truth', card(`Truthtrance · ${names.faction(e.asker)} asks ${names.faction(e.target)}`, e.answer ? 'Yes' : 'No', esc(text)), 2800);
    },

    async karama(e) {
      const what = { voice: 'cancels the Voice', prescience: 'cancels Atreides Prescience', capture: 'stops the Harkonnen capture' }[e.purpose] ?? 'plays Karama';
      await showCard('karama', card('Karama', names.faction(e.factionId), `${esc(what)}.`), 2600);
    },

    async hmsPlaced(e) {
      if (speed()) await board.focusOn([board.labelPoint(e.territoryId)], { ms: scaled(500), minW: 460 });
      await showCard('nexus', card('Hidden Mobile Stronghold', names.territory(e.territoryId), 'The Ixians point their HMS here.'), 2200);
    },
    async hmsMove(e) {
      if (speed()) await board.focusOn(e.path.map(board.labelPoint), { ms: scaled(500) });
      await showCard('nexus', card('Hidden Mobile Stronghold', `to ${names.territory(e.to)}`, e.collected ? `collecting <strong>${e.collected}</strong> spice on the way` : 'The Ixians move their HMS.'), 2200);
    },
    // A Face Dancer is revealed once the battle it decides has been shown (see afterBattle).
    async faceDancer(e) {
      if (!speed()) return;
      pendingFaceDancer = e;
    },
    async thumper(e) {
      await showCard('worm', card('Thumper', names.faction(e.factionId), 'calls Shai-Hulud to the last spice territory.'), 2200);
    },
    async harvester(e) {
      if (speed()) await board.focusOn([board.labelPoint(e.territoryId)], { ms: scaled(500), minW: 480 });
      await showCard('spice', card('Harvester', names.territory(e.territoryId), `${esc(names.faction(e.factionId))} doubles it to <strong>${e.amount}</strong> spice`), 2200);
    },
    async amal(e) {
      await showCard('storm', card('Amal', names.faction(e.factionId), 'Every faction discards half its spice.'), 2400);
    },
    async alliancesCancelled() {
      await showCard('nexus', card('Sandtrout', 'Alliances cancelled', 'Every alliance ends at once.'), 2400);
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
    async battle(e, state) {
      if (!speed()) { pendingFaceDancer = null; return; }
      battleState = state;
      const agg = e.aggressorId, def = e.defenderId, sides = [agg, def];
      await board.focusOn([board.labelPoint(e.territoryId)], { ms: scaled(600), minW: 380, anchor: 0.22 });
      const P = e.plans;
      const opp = f => (f === agg ? def : agg);
      const cat = id => cardLookup?.[id]?.category;
      const CATS = { poisonWeapon: 'poison weapon', projectileWeapon: 'projectile weapon', specialWeapon: 'lasgun',
        poisonDefense: 'poison defence', projectileDefense: 'projectile defence', worthless: 'worthless: a bluff',
        poisonBlade: 'projectile and poison weapon', weirdingWay: 'projectile weapon', poisonTooth: 'kills both leaders',
        artilleryStrike: 'artillery: kills both leaders', shieldSnooper: 'shield and snooper', chemistry: 'poison defence' };
      const asPlan = p => ({ forcesCommitted: p.forces, starredForcesCommitted: p.starred, spiceCommitted: p.spice,
        supportedStarredCount: p.supportedStarred, supportedOrdinaryCount: p.supportedOrdinary,
        leaderId: p.leaderId, leaderFightingValue: p.leaderValue, weaponCardId: p.weapon, defenseCardId: p.defense });
      const wd = battleEngine.resolveWeaponDefense(asPlan(P[agg]), asPlan(P[def]), cardLookup ?? {});
      const killed = { [agg]: wd.aggressorLeaderKilled, [def]: wd.defenderLeaderKilled };
      const leaderName = f => P[f].leaderId ? names.leader(P[f].leaderId) : P[f].cheapHero ? 'a Cheap Hero' : 'no leader';
      const strength = f => {
        const p = f === 'fremen' ? { ...P[f], supportedStarred: P[f].starred, supportedOrdinary: P[f].forces - P[f].starred } : P[f];
        const starV = battleEngine.starredUnitValueFor(f, opp(f));
        const ordinary = p.forces - p.starred;
        const troops = p.supportedStarred * starV + (p.starred - p.supportedStarred) * starV / 2
          + p.supportedOrdinary + (ordinary - p.supportedOrdinary) * 0.5;
        const leader = killed[f] ? 0 : p.leaderValue;
        const kh = p.kwisatzHaderach && !killed[f] ? 2 : 0;
        return { troops, leader, kh, total: troops + leader + kh };
      };
      const fmt = n => (Number.isInteger(n) ? String(n) : n.toFixed(1));

      // Battles you are not fighting in get one compact card; your own keep
      // the full step-by-step reveal below.
      const viewer = getViewer();
      if (!viewer || !sides.includes(viewer)) {
        const w = e.winnerFactionId, l = e.loserFactionId;
        const decided = e.traitor || e.mutualTraitors || e.explosion;
        const outcome = e.explosion ? 'Lasgun meets shield: everything here is destroyed.'
          : e.mutualTraitors ? 'Both leaders were traitors: both sides lose everything.'
          : e.traitor ? `${esc(names.faction(w))} win by treachery: ${esc(names.leader(e.traitorCard?.leaderId))} was a traitor.`
          : `${esc(names.faction(w))} win ${fmt(strength(w).total)} to ${fmt(strength(l).total)}.`;
        const side = f => {
          const p = P[f];
          const cards = [p.weapon, p.defense].filter(Boolean).map(id => esc(names.card(id))).join(' + ') || 'no cards';
          return `<div class="battle-side${w === f ? ' battle-side--won' : ''}">
            <div class="battle-side__name"><span class="faction-chip" style="background:${factionColors[f]}"></span>${esc(names.faction(f))}${w === f ? ' ✓' : ''}</div>
            <div>${esc(leaderName(f))}${P[f].leaderId || P[f].cheapHero ? ` (${p.leaderValue})` : ''}${killed[f] && !decided ? ' <span class="br-bad">fell</span>' : ''}</div>
            <div>${p.forces} troops, ${p.spice} spice</div>
            <div class="battle-side__cards">${cards}</div>
            ${decided ? '' : `<div class="battle-side__total">${fmt(strength(f).total)}</div>`}
          </div>`;
        };
        const shown = showCard('battle', `<div class="event-card__eyebrow">Battle · ${esc(names.territory(e.territoryId))}</div>
          <div class="battle-sides">${side(agg)}${side(def)}</div>
          <div class="event-card__detail">${outcome}</div>`, 4000);
        board.pulse(e.territoryId, 'battle', scaled(1000));
        await shown;
        await afterBattle(e);
        return;
      }

      // Build the stage.
      layer.classList.remove('event-layer--top');
      layer.classList.add('event-layer--battle');
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
        if (f === 'fremen') return '<em>not needed: Fremen fight at full strength</em>';
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
      layer.classList.remove('event-layer--battle');
      await afterBattle(e);
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
