// ui/desktopExtras.js
//
// Mouse and keyboard touches for the desktop layout (desktop layout plan, step 7).
// Everything here checks body.layout-desktop first, so phones are untouched.
//
//   Territory hover card   hovering a territory shows its card (who's there, spice, storm)
//   Tooltips               icon buttons show their label on hover
//   Keyboard shortcuts     Space Run turn, N Step, D Deal, Esc close, 1 to 9 pick an option

const isDesktop = () => document.body.classList.contains('layout-desktop');
// Keys typed into a form control belong to that control.
const typing = el => el && (el.matches('input, select, textarea') || el.isContentEditable);

export const SHORTCUTS = [
  ['Space', 'Run turn'],
  ['N', 'Step one phase'],
  ['D', 'Deal: propose a deal'],
  ['1 to 9', 'Pick an option in a decision'],
  ['Esc', 'Close a window or card']
];

export function createDesktopExtras({ boardEl, summaryHTML, hasGame }) {
  // --- Territory hover card -------------------------------------------------------
  const card = document.createElement('div');
  card.className = 'territory-hover';
  card.hidden = true;
  card.setAttribute('role', 'tooltip');
  document.body.appendChild(card);
  let hovered = null;

  function place(x, y) {
    const pad = 16, w = card.offsetWidth, h = card.offsetHeight;
    const left = x + pad + w > window.innerWidth - 8 ? x - pad - w : x + pad;
    card.style.left = `${Math.round(Math.max(8, left))}px`;
    card.style.top = `${Math.round(Math.max(8, Math.min(y + pad, window.innerHeight - h - 8)))}px`;
  }
  function hide() { hovered = null; card.hidden = true; }

  boardEl.addEventListener('pointermove', e => {
    if (!isDesktop() || e.pointerType !== 'mouse' || e.buttons) { hide(); return; } // not while dragging
    const id = e.target.closest?.('.territory')?.dataset.id;
    if (!id) { hide(); return; }
    if (id !== hovered) {
      hovered = id;
      try { card.innerHTML = summaryHTML(id); } catch { hide(); return; }
      card.hidden = false;
    }
    place(e.clientX, e.clientY);
  });
  boardEl.addEventListener('pointerleave', hide);
  boardEl.addEventListener('wheel', hide, { passive: true });

  // --- Tooltips: an icon button's label, shown on hover ------------------------------
  document.addEventListener('mouseover', e => {
    if (!isDesktop()) return;
    const b = e.target.closest?.('button[aria-label]:not([title])');
    if (b) b.title = b.getAttribute('aria-label');
  });

  // --- Keyboard shortcuts -------------------------------------------------------------
  const click = el => { if (el && !el.disabled && !el.hidden) { el.click(); return true; } return false; };
  document.addEventListener('keydown', e => {
    if (!isDesktop() || e.ctrlKey || e.metaKey || e.altKey || typing(document.activeElement)) return;
    const key = e.key;
    if (key === 'Escape') { // the Esc-closes-sheets handler in main.js runs too
      hide();
      click(document.querySelector('.tech-info__x'));
      click(document.querySelector('#territory-info:not([hidden]) [data-card-close]'));
      return;
    }
    if (document.querySelector('.sheet:not([hidden])')) return; // a window is open: leave it be
    // A button with focus keeps Space for itself (pressing it); everything else is ours.
    if (key === ' ' && document.activeElement?.matches('button, [role="button"]')) return;

    if (/^[1-9]$/.test(key) && pickOption(Number(key))) { e.preventDefault(); return; }
    if (!hasGame()) return;
    if (key === ' ') { if (click(document.getElementById('btn-run-turn'))) e.preventDefault(); return; }
    if (key === 'n' || key === 'N') { click(document.getElementById('btn-step-phase')); return; }
    if (key === 'd' || key === 'D') { click(document.getElementById('dock-deal')); }
  });

  // 1 to 9: the nth choice of whatever is being decided. A list of choices (radio buttons)
  // takes the pick; otherwise the nth action button is pressed. Battle scene choices too.
  function pickOption(n) {
    const scene = document.querySelectorAll('#event-layer .bs__choices button');
    if (scene.length) return click(scene[n - 1]);
    const panel = document.getElementById('decision-panel');
    if (panel.hidden) return false;
    const radios = [...panel.querySelectorAll('input[type="radio"]')].filter(r => !r.disabled);
    if (radios.length) {
      const r = radios[n - 1];
      if (!r) return false;
      r.checked = true;
      r.dispatchEvent(new Event('change', { bubbles: true }));
      r.focus();
      return true;
    }
    const buttons = [...panel.querySelectorAll('.decision__actions button')].filter(b => !b.disabled && !b.hidden);
    return click(buttons[n - 1]);
  }

  return { hideHover: hide };
}
