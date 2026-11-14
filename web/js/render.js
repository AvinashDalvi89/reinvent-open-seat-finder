// DOM rendering. Builds elements with textContent only (no innerHTML of API data).
import { band, bandInfo, interval, clashes, formatDay, formatTime, FAILURE_REASONS } from './model.js';

export const CATALOG_URL = 'https://registration.awsevents.com/flow/awsevents/reinvent2026/event-catalog/page/eventCatalog';

/** Deep link into the official catalog, searching by session code (falls back to title). */
export function catalogLink(s) {
  return `${CATALOG_URL}?${new URLSearchParams({ search: s.abbreviation || s.title })}`;
}

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k in node && typeof v !== 'string') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children.flat().filter((c) => c != null && c !== false));
  return node;
}

/**
 * Two-step destructive button: first click asks, second click acts.
 * onConfirm returns a promise; the button shows progress and errors inline.
 */
export function removeButton(label, confirmLabel, onConfirm) {
  const wrap = el('span', { class: 'remove' });
  const idle = () => wrap.replaceChildren(el('button', {
    class: 'btn btn--ghost btn--sm', type: 'button', onclick: ask, text: label,
  }));
  function ask() {
    const yes = el('button', {
      class: 'btn btn--danger btn--sm', type: 'button', text: confirmLabel,
      onclick: async () => {
        yes.disabled = true; no.disabled = true; yes.textContent = 'Working…';
        try { await onConfirm(); } catch (err) {
          wrap.replaceChildren(el('span', { class: 'plan-warn', role: 'alert', text: err.message }));
          setTimeout(idle, 4000);
        }
      },
    });
    const no = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: idle, text: 'Keep' });
    wrap.replaceChildren(yes, no);
    yes.focus();
  }
  idle();
  return wrap;
}

export function badge(key) {
  const info = bandInfo(key);
  return el('span', { class: `badge badge--${key}` }, el('span', { 'aria-hidden': 'true', text: info.icon }), info.label);
}

export function sessionItem(s, { selected, mine, fav, blocks, onToggle, disabled, onRemove }) {
  const iv = interval(s);
  const clash = mine ? [] : clashes(s, blocks);
  const id = `pick-${s.sessionId}`;
  const titleId = `title-${s.sessionId}`;
  const canPick = !mine && bandInfo(band(s)).attend; // walk-in sessions can still be favorited

  return el('li', { class: `session${selected ? ' session--selected' : ''}${mine ? ' session--mine' : ''}` },
    el('div', { class: 'session__pick' },
      canPick
        ? el('input', {
          type: 'checkbox', id, checked: selected, disabled: disabled && !selected,
          'aria-labelledby': titleId, onchange: () => onToggle(s.sessionId),
        })
        : null),
    el('div', { class: 'session__body' },
      el('div', { class: 'session__top' },
        mine ? el('span', { class: 'badge badge--mine', text: 'Reserved' }) : badge(band(s)),
        fav && !mine ? el('span', { class: 'badge badge--fav', text: '★ Favorite' }) : null,
        s.abbreviation ? el('span', { class: 'session__code', text: s.abbreviation }) : null),
      el(canPick ? 'label' : 'h3', { class: 'session__title', id: titleId, ...(canPick ? { for: id } : {}), text: s.title }),
      el('div', { class: 'session__meta' },
        iv ? el('span', { text: `${formatDay(iv.day)} · ${formatTime(iv.start)}–${formatTime(iv.end)}` }) : el('span', { text: 'Time TBA' }),
        s.venue ? el('span', { text: [s.venue, s.room].filter(Boolean).join(' · ') }) : null,
        s.type ? el('span', { text: s.type }) : null,
        s.level ? el('span', { text: s.level }) : null),
      s.speakers?.length ? el('div', { class: 'session__speakers', text: s.speakers.map((p) => p.name).join(', ') }) : null,
      clash.length ? el('div', { class: 'session__clash', text: `Clashes with ${clash.map((b) => b.label).join(', ')}` }) : null,
      mine && onRemove ? removeButton('Cancel reservation', 'Yes, give seat back', () => onRemove('reserved', s.sessionId)) : null,
      el('div', { class: 'session__links' },
        s.abstract ? el('details', { class: 'session__abstract' }, el('summary', { text: 'Abstract' }), el('p', { text: s.abstract })) : null,
        el('a', {
          class: 'session__catalog', href: catalogLink(s), target: '_blank', rel: 'noopener noreferrer',
          'aria-label': `View ${s.abbreviation || s.title} in the official re:Invent catalog (opens in a new tab)`,
        }, 'Official catalog', el('span', { 'aria-hidden': 'true', text: ' ↗' })))));
}

export function skeletonList(n = 5) {
  return Array.from({ length: n }, () => el('li', { class: 'skeleton', 'aria-hidden': 'true' }));
}

export function loadingState(loaded, total) {
  const pct = total ? Math.round((loaded / total) * 100) : 0;
  const bar = el('div', { class: 'progress__bar' });
  bar.style.width = `${pct}%`;
  return [
    el('h2', { class: 'state__title', text: 'Loading the catalog…' }),
    el('p', { text: total ? `${loaded.toLocaleString()} of ${total.toLocaleString()} sessions` : 'Connecting to the Events API' }),
    el('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct), 'aria-label': 'Catalog download' }, bar),
  ];
}

export function emptyState(onReset) {
  return [
    el('h2', { class: 'state__title', text: 'No sessions match' }),
    el('p', { text: 'Every session matching these filters is full or clashes with your schedule. Try another day, or include sessions that are filling up.' }),
    el('button', { class: 'btn btn--secondary', type: 'button', onclick: onReset, text: 'Reset filters' }),
  ];
}

export function errorState(err, { onRetry, onSignIn }) {
  const signIn = err.status === 401;
  return [
    el('h2', { class: 'state__title', text: signIn ? 'Sign in again' : 'Couldn’t load sessions' }),
    el('p', { text: err.message }),
    signIn
      ? el('a', { class: 'btn btn--primary', href: '/auth/login', onclick: onSignIn, text: 'Sign in with AWS Builder ID' })
      : el('button', { class: 'btn btn--primary', type: 'button', onclick: onRetry, text: 'Retry' }),
  ];
}

export function resultItems(result, sessionsById, verb) {
  const name = (id) => {
    const s = sessionsById.get(id);
    return s ? `${s.abbreviation ? `${s.abbreviation} · ` : ''}${s.title}` : id;
  };
  const conflictNames = (ids) => (ids || []).map((id) => sessionsById.get(id)?.abbreviation || name(id)).join(', ');
  return [
    ...result.successful.map((id) => el('li', { class: 'result result--ok' },
      el('span', { class: 'result__icon', 'aria-hidden': 'true', text: '✓' }),
      el('span', {}, el('span', { class: 'sr-only', text: `${verb}: ` }), name(id)))),
    ...result.failed.map((f) => el('li', { class: 'result result--fail' },
      el('span', { class: 'result__icon', 'aria-hidden': 'true', text: '✕' }),
      el('span', {}, name(f.sessionId), el('br'),
        el('span', { class: 'result__why', text: (FAILURE_REASONS[f.code] || 'Refused by the Events API.') + (f.conflictsWith ? ` (${conflictNames(f.conflictsWith)})` : '') })))),
  ];
}
