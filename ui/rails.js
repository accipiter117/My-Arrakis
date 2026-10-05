// ui/rails.js
//
// The desktop layout's left column (desktop layout plan, step 3): every faction
// at a glance, one compact row each (spice, strongholds held, forces on the
// board), with the full picture in a card on hover or keyboard focus; and the
// live log beneath. Only drawn while body.layout-desktop is set; phones never
// see it. Reads the game state, never changes it.

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sum = o => Object.values(o ?? {}).reduce((a, b) => a + b, 0);
const isDesktop = () => document.body.classList.contains('layout-desktop');

export function createRails({ factionsEl, logEl, getState, getHuman, order, display, territoryName, leaderName, cardName, tokenNames, tokensOwnedBy, phaseLabels }) {
  const hover = document.createElement('div');
  hover.className = 'faction-hover';
  hover.hidden = true;
  hover.setAttribute('role', 'tooltip');
  document.body.appendChild(hover);
  let hoverFaction = null;

  const strongholdIds = state => Object.entries(state.board.territories).filter(([, t]) => t.type === 'stronghold').map(([id]) => id);
  const held = (state, f) => strongholdIds(state).filter(id => (state.factions[f].forces.onBoard[id] ?? 0) > 0);
  const allyOf = (state, f) => state.alliances?.find(a => a.factions.includes(f))?.factions.find(x => x !== f) ?? null;
  // Spice and traitors are secret: you see only your own (all of them when spectating).
  const secret = f => { const h = getHuman(); return Boolean(h) && f !== h; };

  function renderFactions() {
    const state = getState();
    if (!state) { factionsEl.innerHTML = '<p class="empty-note">No game yet.</p>'; return; }
    const human = getHuman();
    const rows = order.filter(f => state.factions[f]).map(f => {
      const fs = state.factions[f];
      const ally = allyOf(state, f);
      const tokens = tokensOwnedBy(state, f);
      return `<li><button class="frow${f === human ? ' frow--you' : ''}" data-faction="${f}" style="--fc:var(${display[f].colorVar})" aria-describedby="faction-hover">
        <img class="frow__counter" src="assets/counters/${f}.png" alt="">
        <span class="frow__name">${esc(display[f].name)}
          <small>${f === human ? '<em>You</em>' : ''}${ally ? `${f === human ? ' · ' : ''}Ally: ${esc(display[ally].name)}` : ''}${tokens.length ? `${ally || f === human ? '&nbsp;' : ''}${tokens.map(t => `<img src="assets/tokens/tech-${t}.png?v=2" alt="${esc(tokenNames[t])}">`).join('')}` : ''}</small></span>
        <span class="frow__stat">${secret(f) ? '?' : fs.spice}</span>
        <span class="frow__stat">${held(state, f).length}</span>
        <span class="frow__stat">${sum(fs.forces.onBoard)}</span>
      </button></li>`;
    }).join('');
    factionsEl.innerHTML = `<div class="frows__head" aria-hidden="true"><span></span><span>Spice</span><span>Holds</span><span>Board</span></div><ul class="frows">${rows}</ul>`;
    if (hoverFaction) showHover(hoverFaction); // keep an open card current as the game moves on
  }

  function hoverHTML(state, f) {
    const fs = state.factions[f], human = getHuman();
    const ally = allyOf(state, f);
    const h = held(state, f);
    const territories = Object.keys(fs.forces.onBoard).filter(id => fs.forces.onBoard[id] > 0);
    const tanks = (fs.revivalTanks ?? 0) + (fs.starredRevivalTanks ?? 0);
    const tokens = tokensOwnedBy(state, f);
    const known = Object.entries(state.meta.knownCards ?? {}).filter(([, x]) => x === f).map(([id]) => cardName(id));
    const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
    return `<div class="faction-hover__head" style="--fc:var(${display[f].colorVar})"><img src="assets/counters/${f}.png" alt=""><div><strong>${esc(display[f].name)}${f === human ? ' (you)' : ''}</strong><small>${ally ? `Allied with ${esc(display[ally].name)}` : 'No alliance'}</small></div></div>
      <dl>
        ${row('Spice', secret(f) ? 'Hidden' : fs.spice)}
        ${row('On the board', `${sum(fs.forces.onBoard)}${territories.length ? ` in ${territories.length} territor${territories.length === 1 ? 'y' : 'ies'}` : ''}`)}
        ${row('In reserve', fs.forces.reserve + (fs.forces.starredReserve ?? 0))}
        ${row('In the tanks', tanks)}
        ${row('Strongholds', h.length ? esc(h.map(territoryName).join(', ')) : 'None')}
        ${row('Leaders', `${fs.leaders.available.length} ready${fs.leaders.killed.length ? `, ${fs.leaders.killed.length} in the tanks` : ''}`)}
        ${row('Treachery cards', fs.treacheryHand.length)}
        ${f === human ? row('Traitors', esc((fs.traitorHand ?? []).map(leaderName).join(', ') || 'None')) : ''}
        ${tokens.length ? row('Tech Tokens', esc(tokens.map(t => tokenNames[t]).join(', '))) : ''}
        ${known.length && f !== human ? row('Known cards', esc(known.join(', '))) : ''}
      </dl>`;
  }

  function showHover(f) {
    const state = getState(), btn = factionsEl.querySelector(`[data-faction="${f}"]`);
    if (!state?.factions[f] || !btn) { hideHover(); return; }
    hoverFaction = f;
    hover.id = 'faction-hover';
    hover.innerHTML = hoverHTML(state, f);
    hover.hidden = false;
    // Beside the row, over the edge of the map, kept on screen.
    const r = btn.getBoundingClientRect();
    hover.style.left = `${Math.round(r.right + 10)}px`;
    hover.style.top = `${Math.round(Math.max(8, Math.min(r.top - 6, window.innerHeight - hover.offsetHeight - 8)))}px`;
  }
  function hideHover() { hoverFaction = null; hover.hidden = true; }

  factionsEl.addEventListener('mouseover', e => { const b = e.target.closest('[data-faction]'); if (b && isDesktop()) showHover(b.dataset.faction); });
  factionsEl.addEventListener('mouseleave', hideHover);
  factionsEl.addEventListener('focusin', e => { const b = e.target.closest('[data-faction]'); if (b && isDesktop()) showHover(b.dataset.faction); });
  factionsEl.addEventListener('focusout', hideHover);

  function renderLog(entries) {
    if (!entries.length) { logEl.innerHTML = '<li class="empty-note">Nothing has happened yet.</li>'; return; }
    // Newest first, so the latest event is always at the top without scrolling.
    logEl.innerHTML = entries.slice().reverse()
      .map((e, i) => `<li${i === 0 ? ' class="is-latest"' : ''}><span class="log-phase">${esc(phaseLabels[e.phase] ?? e.phase)}</span><span class="rail-log__turn">T${esc(e.turn)}</span> ${esc(e.text)}</li>`).join('');
  }

  return {
    render(entries) { if (!isDesktop()) { hideHover(); return; } renderFactions(); renderLog(entries); },
    renderLog(entries) { if (isDesktop()) renderLog(entries); }
  };
}
