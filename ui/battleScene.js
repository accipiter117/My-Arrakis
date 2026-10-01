// ui/battleScene.js
//
// The battle as a table scene (battle UI overhaul, handover 2). Opponent's
// cluster on top, the viewer's below: battle wheel, leader disc, spice stack,
// hand fan and the weapon/defence card slots.
//
//   plan(ctx)      Planning mode (the player's own battles): the player builds
//                  the plan by touching the pieces. Resolves the same plan object
//                  the engine always took, checked by the engine's own rules.
//   present(e, …)  Both sides go face down together, then everything turns over
//                  at once, then the result. Used for every battle shown.
//
// Hidden information: nothing of the opponent's plan is put in the DOM before
// the reveal, except intel the viewer is entitled to (Prescience, Karama).

import * as battleEngine from '../js/battleEngine.js';
import { battleSpice } from '../js/allySupport.js';
import { forcesAfterReveal } from '../js/noField.js';
import { slotAllows, voiceProblem, voiceSlot, planFromChoices } from './battlePlan.js';

const V = '?v=1';
const url = p => new URL(`../assets/${p}${V}`, import.meta.url).href;
const ART = {
  leader: id => url(`leaders/${id}.webp`), cheapHero: url('leaders/cheapHero.webp'),
  cardBack: new URL('../assets/cards/back.webp?v=2', import.meta.url).href, cardFace: url('cards/face.webp'), traitor: url('cards/traitor.webp'), faceDancer: url('cards/faceDancer.webp'),
  wheelBack: url('battle/wheel-back.webp'), wheelFront: url('battle/wheel-front.webp'), kh: url('tokens/kwisatzHaderach.webp'),
  spice: n => url(`tokens/spice-${n >= 6 ? 8 : n >= 3 ? 3 : 1}.webp`),
  counter: f => new URL(`../assets/counters/${f}.png`, import.meta.url).href
};
// The card back now matches the face exactly (263 x 360), so cards flip at the reveal.
const CARD_FLIP = true;

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = n => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const wait = ms => new Promise(r => setTimeout(r, ms));

export function createBattleScene({ layer, cardLookup, leadersData, names, factionColors, scaled = ms => ms }) {
  const leader = {};
  for (const list of Object.values(leadersData)) if (Array.isArray(list)) for (const l of list) leader[l.id] = l;
  const cat = id => cardLookup[id]?.category;
  const { WEAPONS, DEFENSES } = battleEngine;
  let open = null; // { territoryId, sides } while a scene is on screen

  // --- Scene skeleton ------------------------------------------------------------
  function mount({ territoryId, top, bottom, caption }) {
    layer.classList.remove('event-layer--top');
    layer.classList.add('event-layer--battle');
    layer.onclick = null;
    layer.innerHTML = `<div class="bs" role="group" aria-label="Battle in ${esc(names.territory(territoryId))}">
      <div class="bs__caption" aria-live="polite">${caption}</div>
      ${cluster(top, 'top')}
      <div class="bs__vs"><span>VS</span></div>
      ${cluster(bottom, 'bottom')}
      <div class="bs__dock"></div>
    </div>`;
    layer.hidden = false;
    open = { territoryId, top, bottom };
    return layer.querySelector('.bs');
  }
  const cluster = (f, pos) => `
    <div class="bs__side bs__side--${pos}" data-side="${f}" style="--fc:${factionColors[f] ?? '#c9a24a'}">
      <div class="bs__name"><span class="faction-chip" style="background:${factionColors[f]}"></span>${esc(names.faction(f))}<small data-leader-name></small></div>
      <div class="bs__table">
        <div class="bs__hand" data-hand><img src="${ART.cardBack}" alt=""><img src="${ART.cardBack}" alt=""><img src="${ART.cardBack}" alt=""><b data-hand-count>0</b></div>
        <div class="bs__wheel" data-wheel>
          <div class="bs__dial" data-dial>?</div>
          <img class="bs__wheel-img" data-wheel-img src="${ART.wheelBack}" alt="">
        </div>
        <div class="bs__leader" data-leader><img src="${ART.counter(f)}" alt=""><b data-leader-val hidden></b></div>
        <div class="bs__spice" data-spice><span class="bs__q">?</span><b data-spice-val hidden></b></div>
        <div class="bs__kh" data-kh hidden><img src="${ART.kh}" alt="Kwisatz Haderach"></div>
        <div class="bs__cards">
          <div class="bs__slot" data-slot="weapon"><span class="bs__slot-q">?</span><em>Weapon</em></div>
          <div class="bs__slot" data-slot="defense"><span class="bs__slot-q">?</span><em>Defence</em></div>
        </div>
      </div>
    </div>`;
  const side = (root, f) => root.querySelector(`[data-side="${f}"]`);
  const setCaption = (root, html) => { root.querySelector('.bs__caption').innerHTML = html; };
  function setHand(el, n) { el.querySelector('[data-hand-count]').textContent = n; el.querySelector('[data-hand]').dataset.n = Math.min(n, 3); }
  function faceCard(id, extra = '') { return `<div class="bs__card bs__card--face ${extra}"><img src="${ART.cardFace}" alt=""><span class="bs__card-name">${esc(names.card(id))}</span></div>`; }
  const backCard = () => `<div class="bs__card bs__card--back"><img src="${ART.cardBack}" alt=""></div>`;
  // A card turning over: back on one side, face (with its name) on the other.
  const flipCard = id => `<div class="bs__card bs__flipper"><div class="bs__flip-inner">
      <div class="bs__flip-side bs__flip-side--back"><img src="${ART.cardBack}" alt=""></div>
      <div class="bs__flip-side bs__flip-side--front"><img src="${ART.cardFace}" alt=""><span class="bs__card-name">${esc(names.card(id))}</span></div>
    </div></div>`;
  function setSlot(el, which, html) { const s = el.querySelector(`[data-slot="${which}"]`); s.querySelectorAll('.bs__card, .bs__slot-q').forEach(n => n.remove()); s.insertAdjacentHTML('afterbegin', html ?? '<span class="bs__slot-q">–</span>'); }
  function setLeader(el, id, cheapHero, value) {
    const box = el.querySelector('[data-leader]');
    box.querySelector('img').src = id ? ART.leader(id) : cheapHero ? ART.cheapHero : ART.counter(el.dataset.side);
    box.classList.toggle('bs__leader--none', !id && !cheapHero);
    const v = box.querySelector('[data-leader-val]'); v.hidden = value == null; v.textContent = value ?? '';
    el.querySelector('[data-leader-name]').textContent = id ? ` · ${names.leader(id)}` : cheapHero ? ' · a Cheap Hero' : '';
  }
  function setSpice(el, n) {
    const box = el.querySelector('[data-spice]');
    box.querySelector('.bs__q')?.remove(); box.querySelector('img')?.remove();
    if (n > 0) box.insertAdjacentHTML('afterbegin', `<img src="${ART.spice(n)}" alt="">`); else box.insertAdjacentHTML('afterbegin', '<span class="bs__q">0</span>');
    const v = box.querySelector('[data-spice-val]'); v.hidden = false; v.textContent = n;
  }
  function setDial(el, n, open_) {
    el.querySelector('[data-dial]').textContent = n ?? '?';
    el.querySelector('[data-wheel-img]').src = open_ ? ART.wheelFront : ART.wheelBack;
    el.querySelector('[data-wheel]').classList.toggle('bs__wheel--open', Boolean(open_));
  }
  function foreseen(el, what) {
    const t = el.querySelector(what); if (!t) return;
    t.classList.add('bs__foreseen');
    t.insertAdjacentHTML('beforeend', '<i class="bs__tag-foreseen">Foreseen</i>');
  }

  // --- Planning mode --------------------------------------------------------------
  function plan({ state, factionId, territoryId, opponentId, intel, voice }) {
    const me = state.factions[factionId];
    const present = forcesAfterReveal(state, factionId, territoryId);
    const starredPresent = me.forces.starredOnBoard?.[territoryId] ?? 0;
    const spiceCap = factionId === 'fremen' ? 0 : battleSpice(state, factionId);
    const hand = me.treacheryHand.slice();
    const leaders = me.leaders.available.filter(id => battleEngine.isLeaderAvailable(state, factionId, id, territoryId))
      .sort((a, b) => (leader[b]?.fightingValue ?? 0) - (leader[a]?.fightingValue ?? 0));
    const unavailable = [...me.leaders.available.filter(id => !leaders.includes(id)).map(id => [id, 'Already fought']), ...me.leaders.killed.map(id => [id, 'In the tanks'])];
    const heroes = hand.filter(id => cat(id) === 'specialLeaderSubstitute');
    const khAvail = me.specialFactionState?.kwisatzHaderachActive && [null, undefined, territoryId].includes(me.specialFactionState?.kwisatzHaderachUsedInTerritoryThisPhase);
    const pl = { forces: Math.ceil(present / 2), starred: 0, spice: 0, lead: leaders[0] ? { kind: 'leader', id: leaders[0] } : heroes[0] ? { kind: 'hero', id: heroes[0] } : null,
      weapon: null, defense: null, kh: false };

    const root = mount({ territoryId, top: opponentId, bottom: factionId, caption: `Battle in ${esc(names.territory(territoryId))}` });
    const mine = side(root, factionId), theirs = side(root, opponentId);
    setHand(theirs, state.factions[opponentId].treacheryHand.length);
    setHand(mine, hand.length);
    // Intel the viewer is entitled to.
    if (intel?.full) {
      const q = intel.plan;
      setDial(theirs, q.forcesCommitted, true); setLeader(theirs, q.leaderId, q.cheapHeroCardId, q.leaderFightingValue ?? 0); setSpice(theirs, q.spiceCommitted ?? 0);
      setSlot(theirs, 'weapon', q.weaponCardId ? faceCard(q.weaponCardId) : null); setSlot(theirs, 'defense', q.defenseCardId ? faceCard(q.defenseCardId) : null);
      theirs.classList.add('bs__side--intel');
    } else if (intel?.element) {
      const v = intel.value;
      if (intel.element === 'number') { setDial(theirs, v, true); foreseen(theirs, '[data-wheel]'); }
      if (intel.element === 'leader') { setLeader(theirs, v === 'cheapHero' ? null : v, v === 'cheapHero', v && v !== 'cheapHero' ? leader[v]?.fightingValue : 0); foreseen(theirs, '[data-leader]'); }
      if (intel.element === 'weapon') { setSlot(theirs, 'weapon', v ? faceCard(v) : null); foreseen(theirs, '[data-slot="weapon"]'); }
      if (intel.element === 'defense') { setSlot(theirs, 'defense', v ? faceCard(v) : null); foreseen(theirs, '[data-slot="defense"]'); }
    }
    // Controls.
    mine.classList.add('bs__side--mine');
    const table = mine.querySelector('.bs__table');
    table.insertAdjacentHTML('beforeend', `
      <button class="bs__btn bs__btn--less" data-act="less" aria-label="Dial one less">‹</button>
      <button class="bs__btn bs__btn--more" data-act="more" aria-label="Dial one more">›</button>
      ${starredPresent ? '<button class="bs__star" data-act="star" aria-label="Elite forces dialled">★ <b data-star>0</b></button>' : ''}`);
    const dock = root.querySelector('.bs__dock');
    dock.innerHTML = `<details class="bs__help"><summary>How battles work</summary>Higher total wins; ties go to the aggressor. Dialled forces are lost even if you win; the loser loses everything here. ${factionId === 'fremen' ? 'Fremen count fully without spice.' : 'A dialled force counts fully only if backed by 1 spice, otherwise half.'}</details>
      <button class="btn btn--primary bs__commit" data-act="commit">Commit plan</button>`;
    const relevant = (me.traitorHand ?? []).filter(id => id === 'cheapHeroTraitor' || leader[id]?.faction === opponentId);
    const notes = [
      voice ? `The Voice: you ${voice.command === 'play' ? 'must play' : 'must not play'} ${esc(names.category?.(voice.category) ?? voice.category)}` : '',
      relevant.length ? `Traitor ready: ${esc(relevant.map(id => id === 'cheapHeroTraitor' ? 'any Cheap Hero' : names.leader(id)).join(', '))}` : '',
      (() => { const k = Object.entries(state.meta.knownCards ?? {}).filter(([, f]) => f === opponentId).map(([id]) => names.card(id)); return k.length ? `Known in their hand: ${esc(k.join(', '))}` : ''; })()
    ].filter(Boolean);
    if (voice) mine.querySelector(`[data-slot="${voiceSlot(voice.category)}"]`).insertAdjacentHTML('beforeend', `<i class="bs__voice">${voice.command === 'play' ? 'Must play' : 'Voice'}</i>`);

    const build = () => planFromChoices(pl, id => leader[id]?.fightingValue);
    const vctx = { voice, hand, cat, categoryName: c => names.category?.(c) ?? c };
    const render = () => {
      setDial(mine, pl.forces, true);
      pl.spice = Math.min(pl.spice, pl.forces, spiceCap);
      pl.starred = Math.min(pl.starred, pl.forces, starredPresent);
      setSpice(mine, pl.spice);
      if (starredPresent) mine.querySelector('[data-star]').textContent = pl.starred;
      setLeader(mine, pl.lead?.kind === 'leader' ? pl.lead.id : null, pl.lead?.kind === 'hero', pl.lead ? (pl.lead.kind === 'leader' ? leader[pl.lead.id]?.fightingValue : 0) : null);
      setSlot(mine, 'weapon', pl.weapon ? faceCard(pl.weapon) : null);
      setSlot(mine, 'defense', pl.defense ? faceCard(pl.defense) : null);
      setHand(mine, hand.filter(id => id !== pl.weapon && id !== pl.defense && id !== pl.lead?.id).length);
      const kh = mine.querySelector('[data-kh]'); kh.hidden = !khAvail; kh.classList.toggle('bs__kh--on', pl.kh);
      const p = build();
      const engineCheck = battleEngine.canDeclareBattlePlan(state, territoryId, factionId, p, cardLookup);
      const vp = engineCheck.ok ? voiceProblem(pl, vctx) : null;
      const check = vp ? { ok: false, reason: vp } : engineCheck;
      const strength = battleEngine.calculateStrength({ ...battleEngine.fremenFullStrength(factionId, p), starredUnitValue: battleEngine.starredUnitValueFor(factionId, opponentId), leaderWasKilled: false, kwisatzHaderachBonus: p.useKwisatzHaderach ? 2 : 0 });
      const lasgunShield = cat(p.weaponCardId) === 'specialWeapon' && battleEngine.isShieldCard(cardLookup[p.defenseCardId]);
      setCaption(root, `<strong>Battle in ${esc(names.territory(territoryId))}</strong> · you ${present}, ${esc(names.faction(opponentId))} ${state.factions[opponentId].forces.onBoard[territoryId] ?? 0}
        <br>${check.ok ? `Your total if your leader survives: <strong>${fmt(strength)}</strong>${lasgunShield ? ' · <span class="bs__warn">Lasgun with your own Shield explodes!</span>' : ''}` : `<span class="bs__warn">${esc(check.reason)}</span>`}
        ${notes.length ? `<br><small>${notes.join(' · ')}</small>` : ''}`);
      dock.querySelector('[data-act="commit"]').disabled = !check.ok;
    };

    // Popovers (spice stepper, leader fan, card row, elite stepper).
    let pop = null;
    const closePop = () => { pop?.remove(); pop = null; };
    const popover = (anchor, html) => {
      closePop();
      pop = document.createElement('div'); pop.className = 'bs__pop'; pop.innerHTML = html;
      root.appendChild(pop);
      const a = anchor.getBoundingClientRect(), r = root.getBoundingClientRect();
      pop.style.left = `${Math.max(4, Math.min(r.width - pop.offsetWidth - 4, a.left - r.left + a.width / 2 - pop.offsetWidth / 2))}px`;
      pop.style.top = `${Math.max(4, a.top - r.top - pop.offsetHeight - 6)}px`;
      return pop;
    };
    const stepper = (anchor, label, get, set, lo, hi, helper) => {
      const draw = () => popover(anchor, `<div class="bs__stepper"><button data-s="-" aria-label="Less">−</button><b>${get()}</b><button data-s="+" aria-label="More">+</button></div><small>${label}${helper ? ` · ${helper()}` : ''}</small>`)
        .onclick = ev => { const b = ev.target.closest('[data-s]'); if (!b) return; ev.stopPropagation(); set(Math.max(lo(), Math.min(hi(), get() + (b.dataset.s === '+' ? 1 : -1)))); render(); draw(); };
      draw();
    };
    return new Promise(resolve => {
      root.addEventListener('click', ev => {
        const t = ev.target;
        if (pop && !pop.contains(t)) { const keep = t.closest('[data-spice],[data-leader],[data-slot],[data-act="star"]') && mine.contains(t); closePop(); if (!keep) return; }
        if (!mine.contains(t) && !dock.contains(t)) return;
        const act = t.closest('[data-act]')?.dataset.act;
        if (act === 'less' || act === 'more') { pl.forces = Math.max(0, Math.min(present, pl.forces + (act === 'more' ? 1 : -1))); navigator.vibrate?.(8); render(); return; }
        if (act === 'commit') { const p = build(); if (battleEngine.canDeclareBattlePlan(state, territoryId, factionId, p, cardLookup).ok && !voiceProblem(pl, vctx)) { cleanup(); resolve(p); } return; }
        if (act === 'star') { stepper(t.closest('[data-act]'), 'Elite forces dialled', () => pl.starred, v => { pl.starred = v; }, () => 0, () => Math.min(pl.forces, starredPresent)); return; }
        if (t.closest('[data-kh]')) { pl.kh = !pl.kh; render(); return; }
        if (t.closest('[data-spice]')) {
          if (factionId === 'fremen') { setCaption(root, 'Fremen fight at full strength without spice.'); return; }
          stepper(t.closest('[data-spice]'), 'Spice backing', () => pl.spice, v => { pl.spice = v; }, () => 0, () => Math.min(pl.forces, spiceCap), () => `backs ${Math.min(pl.spice, pl.forces)} of ${pl.forces} forces`);
          return;
        }
        if (t.closest('[data-leader]')) {
          // The leaders fan out in an arc above the wheel.
          const opts = [...leaders.map(id => ({ kind: 'leader', id })), ...heroes.map(id => ({ kind: 'hero', id })), ...unavailable.map(([id, why]) => ({ kind: 'off', id, why }))];
          closePop();
          pop = document.createElement('div'); pop.className = 'bs__arc';
          const n = opts.length, spread = Math.min(170, 30 * Math.max(1, n - 1));
          pop.innerHTML = opts.map((o, i) => {
            const ang = (-90 - spread / 2 + (n > 1 ? (spread * i) / (n - 1) : spread / 2)) * Math.PI / 180;
            const x = Math.cos(ang) * 122, y = Math.sin(ang) * 96;
            const img = o.kind === 'hero' ? ART.cheapHero : ART.leader(o.id);
            const label = o.kind === 'hero' ? 'Cheap Hero' : names.leader(o.id);
            return o.kind === 'off'
              ? `<span class="bs__fan-item is-off" style="--x:${x}px;--y:${y}px"><img src="${img}" alt=""><span>${esc(o.why)}</span></span>`
              : `<button data-i="${i}" class="bs__fan-item${pl.lead?.id === o.id ? ' is-on' : ''}" style="--x:${x}px;--y:${y}px" aria-label="${esc(label)}"><img src="${img}" alt=""><b>${o.kind === 'hero' ? 0 : leader[o.id]?.fightingValue ?? 0}</b><span>${esc(label)}</span></button>`;
          }).join('');
          mine.querySelector('[data-wheel]').appendChild(pop);
          pop.onclick = ev => { const b = ev.target.closest('[data-i]'); if (!b) return; ev.stopPropagation(); const o = opts[Number(b.dataset.i)];
            if (o.kind === 'hero' && (pl.weapon === o.id || pl.defense === o.id)) return; pl.lead = o; closePop(); render(); };
          return;
        }
        const slotEl = t.closest('[data-slot]');
        if (slotEl) {
          const which = slotEl.dataset.slot;
          if (t.closest('.bs__card') && pl[which]) { pl[which] = null; render(); return; } // return it to the hand
          const ok = id => slotAllows(id, which, vctx);
          const voiceBlocks = () => false;
          const free = hand.filter(id => id !== pl.weapon && id !== pl.defense && id !== pl.lead?.id);
          const p = popover(slotEl, `<div class="bs__row">${free.map(id => `<button class="bs__pick" data-card="${esc(id)}" ${ok(id) && !voiceBlocks(id) ? '' : 'disabled'}>${faceCard(id)}</button>`).join('') || '<small>No cards in hand</small>'}</div><small>${which === 'weapon' ? 'Weapon' : 'Defence'}: tap a card</small>`);
          p.onclick = ev => { const b = ev.target.closest('[data-card]'); if (!b || b.disabled) return; ev.stopPropagation(); pl[which] = b.dataset.card; closePop(); render(); };
          return;
        }
        if (t.closest('[data-hand]')) { popover(t.closest('[data-hand]'), `<div class="bs__row">${hand.map(id => faceCard(id)).join('') || '<small>No cards</small>'}</div><small>Your hand</small>`); }
      });
      // Swipe the wheel: about 24px of drag per step.
      const wheel = mine.querySelector('[data-wheel]');
      let startX = null, startForces = 0;
      wheel.style.touchAction = 'none';
      wheel.addEventListener('pointerdown', ev => { startX = ev.clientX; startForces = pl.forces; wheel.setPointerCapture(ev.pointerId); });
      wheel.addEventListener('pointermove', ev => {
        if (startX == null) return;
        const n = Math.max(0, Math.min(present, startForces + Math.round((ev.clientX - startX) / 24)));
        if (n !== pl.forces) { pl.forces = n; navigator.vibrate?.(6); wheel.querySelector('[data-wheel-img]').style.transform = `rotate(${(n - startForces) * 6}deg)`; render(); }
      });
      const end = () => { startX = null; wheel.querySelector('[data-wheel-img]').style.transform = ''; };
      wheel.addEventListener('pointerup', end); wheel.addEventListener('pointercancel', end);
      const cleanup = () => { closePop(); mine.classList.remove('bs__side--mine'); mine.querySelectorAll('.bs__btn, .bs__star').forEach(b => b.remove()); dock.innerHTML = ''; };
      render();
    });
  }

  // --- Presentation: face down together, reveal, result ------------------------------
  async function present(e, state, { viewer = null, strengthOf, killed, outcomeText, speed = 1 } = {}) {
    const sides = [e.aggressorId, e.defenderId];
    const bottom = viewer && sides.includes(viewer) ? viewer : e.defenderId;
    const top = sides.find(f => f !== bottom);
    const P = e.plans ?? {};
    let root = open && open.territoryId === e.territoryId && layer.querySelector('.bs') ? layer.querySelector('.bs') : null;
    if (!root) root = mount({ territoryId: e.territoryId, top, bottom, caption: `Battle in ${esc(names.territory(e.territoryId))}` });
    root.querySelector('.bs__dock').innerHTML = '';
    const st = f => side(root, f);
    // 1. Face down together: card backs into filled slots, leader discs down, wheels shut.
    for (const f of sides) {
      const el = st(f); el.classList.remove('bs__side--intel');
      el.querySelectorAll('.bs__foreseen').forEach(n => n.classList.remove('bs__foreseen'));
      setHand(el, state?.factions[f]?.treacheryHand.length ?? 0);
      setDial(el, null, false);
      el.querySelector('[data-leader] img').src = ART.counter(f); el.querySelector('[data-leader-val]').hidden = true;
      el.querySelector('[data-leader-name]').textContent = '';
      const sp = el.querySelector('[data-spice]'); sp.querySelector('img')?.remove(); sp.querySelector('.bs__q')?.remove(); sp.insertAdjacentHTML('afterbegin', '<span class="bs__q">?</span>'); sp.querySelector('[data-spice-val]').hidden = true;
      el.querySelector('[data-kh]').hidden = true;
      setSlot(el, 'weapon', P[f]?.weapon ? backCard() : null);
      setSlot(el, 'defense', P[f]?.defense ? backCard() : null);
    }
    setCaption(root, `Battle in <strong>${esc(names.territory(e.territoryId))}</strong> · plans are down`);
    root.classList.add('bs--down');
    if (speed) await wait(scaled(900));
    // 2. Reveal, all at once.
    root.classList.remove('bs--down'); root.classList.add('bs--reveal');
    for (const f of sides) {
      const el = st(f), p = P[f] ?? {};
      setDial(el, p.forces ?? 0, true);
      setLeader(el, p.leaderId, p.cheapHero, p.leaderId || p.cheapHero ? p.leaderValue : null);
      setSpice(el, p.spice ?? 0);
      if (p.kwisatzHaderach) { const kh = el.querySelector('[data-kh]'); kh.hidden = false; kh.classList.add('bs__kh--on'); }
      setSlot(el, 'weapon', p.weapon ? (CARD_FLIP ? flipCard(p.weapon) : faceCard(p.weapon, 'bs__fade')) : null);
      setSlot(el, 'defense', p.defense ? (CARD_FLIP ? flipCard(p.defense) : faceCard(p.defense, 'bs__fade')) : null);
    }
    if (speed) await wait(scaled(1100));
    // 3. Result.
    for (const f of sides) {
      const el = st(f);
      if (killed?.[f] && !e.traitor && !e.mutualTraitors && (P[f]?.leaderId || P[f]?.cheapHero)) el.querySelector('[data-leader]').classList.add('bs__leader--killed');
      if (e.winnerFactionId === f) el.classList.add('bs__side--won');
    }
    if (e.traitor && e.loserFactionId) {
      st(e.loserFactionId).querySelector('[data-leader]').insertAdjacentHTML('beforeend', `<img class="bs__traitor" src="${ART.traitor}" alt="Traitor">`);
    }
    const tot = f => (strengthOf ? fmt(strengthOf(f)) : '');
    const decided = e.traitor || e.mutualTraitors || e.explosion;
    setCaption(root, `<strong>${outcomeText}</strong>${decided ? '' : `<br><small>${esc(names.faction(e.aggressorId))} ${tot(e.aggressorId)} · ${esc(names.faction(e.defenderId))} ${tot(e.defenderId)} (ties go to the attacker)</small>`}`);
    root.querySelector('.bs__dock').innerHTML = '<small class="bs__tap">tap to move on</small>';
    if (speed) {
      await new Promise(resolve => { const t = setTimeout(resolve, scaled(4200)); layer.onclick = () => { clearTimeout(t); resolve(); }; });
    }
    layer.onclick = null;
    close();
  }

  // A choice asked inside the open scene (traitor reveal, Portable Snooper, Stone Burner).
  function choose(captionHtml, buttons) {
    const root = layer.querySelector('.bs');
    if (!root || !open) return null;
    setCaption(root, captionHtml);
    const dock = root.querySelector('.bs__dock');
    dock.innerHTML = `<div class="bs__choices">${buttons.map((b, i) => `<button class="btn${b.primary ? ' btn--primary' : ''}" data-choice="${i}">${esc(b.label)}</button>`).join('')}</div>`;
    return new Promise(resolve => {
      dock.onclick = ev => { const b = ev.target.closest('[data-choice]'); if (!b) return; ev.stopPropagation(); dock.onclick = null; dock.innerHTML = ''; resolve(buttons[Number(b.dataset.choice)].value); };
    });
  }

  function close() { open = null; layer.hidden = true; layer.innerHTML = ''; layer.classList.remove('event-layer--battle'); }

  return { plan, present, close, choose, isOpen: () => Boolean(open) };
}
