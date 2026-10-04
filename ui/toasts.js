// toasts.js: short messages that slide in at the top of the map, stay a few
// seconds, then fade. Tapping one dismisses it. No more than two show at once;
// the rest wait their turn. The log keeps the full lines as before.

export function createToaster(host, { duration = 3600, maxVisible = 2 } = {}) {
  const box = document.createElement('div');
  box.className = 'toasts';
  box.setAttribute('aria-live', 'polite');
  host.appendChild(box);

  const queue = [];
  const showing = new Set();

  function pump() {
    while (showing.size < maxVisible && queue.length) open(queue.shift());
  }

  function open({ text, kind }) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `toast${kind ? ` toast--${kind}` : ''}`;
    el.setAttribute('role', 'status');
    el.textContent = text;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      el.classList.add('toast--out');
      setTimeout(() => { el.remove(); showing.delete(el); pump(); }, 260);
    };
    const timer = setTimeout(close, duration);
    el.addEventListener('click', close);
    showing.add(el);
    box.appendChild(el);
  }

  return {
    show(text, kind = '') {
      if (!text) return;
      queue.push({ text, kind });
      pump();
    },
    clear() {
      queue.length = 0;
      for (const el of showing) el.remove();
      showing.clear();
    }
  };
}
