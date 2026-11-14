// "Day route": the Strip as a line (Wynn north -> Mandalay south), your stops for
// the day numbered in time order, each hop drawn as an arc coloured by whether
// you have enough time. The leg list below is the accessible equivalent.
import { formatTime } from './model.js';
import { VENUES, STRIP_ORDER, venueName, travelMinutes, directionsUrl } from './venues.js';
import { el } from './render.js';

const NS = 'http://www.w3.org/2000/svg';
const W = 720;
const PAD = 50;
const LINE_Y = 92;
const STEP = (W - PAD * 2) / (STRIP_ORDER.length - 1);
const xOf = (key) => PAD + STRIP_ORDER.indexOf(key) * STEP;

function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children.filter(Boolean));
  return node;
}

/** Hops between consecutive stops: travel needed vs time available. */
function legsOf(stops) {
  const legs = [];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i];
    const need = travelMinutes(a.venue, b.venue);
    const free = b.start - a.end;
    const status = free < 0 ? 'overlap' : need == null ? 'unknown' : free >= need ? 'ok' : 'tight';
    legs.push({ from: a, to: b, need, free, status });
  }
  return legs;
}

function diagram(stops, legs, anchorOf) {
  const visits = {};
  stops.forEach((s, i) => { if (s.venue) (visits[s.venue] ||= []).push(i + 1); });
  const maxSpan = Math.max(0, ...legs.filter((l) => l.from.venue && l.to.venue)
    .map((l) => Math.abs(xOf(l.to.venue) - xOf(l.from.venue))));
  const height = LINE_Y + 34 + Math.min(110, maxSpan * 0.22) + 24;

  const root = svg('svg', { viewBox: `0 0 ${W} ${height}`, class: 'route__svg', role: 'img',
    'aria-label': `Day route along the Strip: ${stops.map((s, i) => `${i + 1} ${s.venue ? venueName(s.venue) : 'venue TBD'}`).join(', ')}` });

  root.append(svg('line', { x1: PAD, y1: LINE_Y, x2: W - PAD, y2: LINE_Y, class: 'route__line' }));
  root.append(svg('text', { x: PAD - 6, y: LINE_Y + 4, class: 'route__compass', 'text-anchor': 'end' }, 'N'));
  root.append(svg('text', { x: W - PAD + 6, y: LINE_Y + 4, class: 'route__compass', 'text-anchor': 'start' }, 'S'));

  // Hop arcs hang below the line; longer hops dip deeper.
  legs.forEach((l) => {
    if (!l.from.venue || !l.to.venue || l.from.venue === l.to.venue) return;
    const x1 = xOf(l.from.venue), x2 = xOf(l.to.venue);
    const depth = 26 + Math.min(110, Math.abs(x2 - x1) * 0.22);
    const mid = (x1 + x2) / 2;
    root.append(svg('path', { d: `M ${x1} ${LINE_Y} Q ${mid} ${LINE_Y + depth * 2} ${x2} ${LINE_Y}`, class: `route__leg route__leg--${l.status}` }));
    root.append(svg('text', { x: mid, y: LINE_Y + depth + 14, 'text-anchor': 'middle', class: `route__leg-label route__leg-label--${l.status}` },
      l.status === 'overlap' ? 'overlap' : `${l.need}m`));
  });

  STRIP_ORDER.forEach((key) => {
    const x = xOf(key), here = visits[key];
    root.append(svg('circle', { cx: x, cy: LINE_Y, r: here ? 7 : 4, class: here ? 'route__station route__station--on' : 'route__station' }));
    root.append(svg('text', { x, y: LINE_Y - 16, 'text-anchor': 'middle', class: here ? 'route__name route__name--on' : 'route__name' }, VENUES[key].short));
    (here || []).forEach((n, j) => {
      const bx = x + (j - (here.length - 1) / 2) * 24;
      root.append(svg('a', { href: `#${anchorOf(n - 1)}` },
        svg('circle', { cx: bx, cy: LINE_Y - 48, r: 11, class: 'route__stop' }),
        svg('text', { x: bx, y: LINE_Y - 44, 'text-anchor': 'middle', class: 'route__stop-num' }, String(n))));
    });
  });
  return root;
}

function legItem(l, i) {
  const from = l.from.venue ? venueName(l.from.venue) : 'Venue TBD';
  const to = l.to.venue ? venueName(l.to.venue) : 'Venue TBD';
  const verdict = {
    ok: l.need === 0 ? `Same building · ${l.free} min free` : `~${l.need} min · ${l.free} min free`,
    tight: `~${l.need} min needed, only ${l.free} min. You'll be late`,
    overlap: 'These two overlap',
    unknown: `${l.free} min free · venue TBD, check travel once it's known`,
  }[l.status];
  const canMap = l.from.venue && l.to.venue && l.from.venue !== l.to.venue;
  return el('li', { class: `route__item route__item--${l.status}` },
    el('span', { class: 'route__item-n', text: `${i + 1} → ${i + 2}` }),
    el('span', { class: 'route__item-text' },
      el('strong', { text: `${from} → ${to}` }), ` · ${formatTime(l.from.end)} → ${formatTime(l.to.start)} · `,
      el('span', { class: 'route__verdict', text: verdict })),
    canMap ? el('a', { class: 'route__maps', href: directionsUrl(l.from.venue, l.to.venue), target: '_blank', rel: 'noopener noreferrer',
      'aria-label': `Walking directions from ${from} to ${to} in Google Maps (opens in a new tab)` }, 'Directions ↗') : null);
}

/** stops: firm items for the day, sorted by start. anchorOf(i) -> element id of agenda row i. */
export function renderRoute(stops, anchorOf) {
  if (!stops.length) {
    return el('section', { class: 'route route--empty', 'aria-labelledby': 'route-title' },
      el('div', { class: 'route__empty-art', 'aria-hidden': 'true' },
        ...STRIP_ORDER.map(() => el('span', { class: 'route__empty-dot' }))),
      el('div', {},
        el('h2', { id: 'route-title', class: 'route__title', text: 'No stops yet today' }),
        el('p', { class: 'route__empty-text',
          text: 'Nothing is booked for this day. Pick sessions from the free time below, or reserve or favorite them in Sessions, and your route across the Strip will appear here.' })));
  }
  const legs = legsOf(stops);
  const unknown = stops.filter((s) => !s.venue);
  const tight = legs.filter((l) => l.status === 'tight' || l.status === 'overlap').length;
  return el('section', { class: 'route', 'aria-labelledby': 'route-title' },
    el('div', { class: 'route__head' },
      el('h2', { id: 'route-title', class: 'route__title', text: 'Day route' }),
      el('span', { class: `route__sum${tight ? ' route__sum--warn' : ''}`,
        text: `${stops.length} stop${stops.length === 1 ? '' : 's'}${tight ? ` · ${tight} hop${tight === 1 ? ' needs' : 's need'} attention` : legs.length ? ' · all hops OK' : ''}` })),
    diagram(stops, legs, anchorOf),
    legs.length ? el('ol', { class: 'route__legs' }, ...legs.map(legItem)) : null,
    unknown.length ? el('p', { class: 'field__hint', text: `Venue TBD for: ${unknown.map((s) => s.title).join(', ')}.` }) : null);
}
