// "My week": one day as an agenda in Las Vegas time, with travel checks between
// commitments, the sessions that fit each free gap, and time for lunch, the
// Expo and breaks.
import { interval, wallInterval, formatTime, clashes } from './model.js';
import { venueKey, venueName, travelMinutes } from './venues.js';
import { el, sessionItem, removeButton } from './render.js';
import { renderRoute } from './route.js';
import { gapIdeas, longRuns } from './ideas.js';

const stopId = (i) => `plan-stop-${i}`;

const DAY_START = 8 * 60;
const DAY_END = 19 * 60;
const MIN_GAP = 30;
const SUGGEST = 5;
export const TBD = 'Venue TBD';

/** Everything on your plate for one day, sorted. */
function dayItems(day, { calendar, schedule, byId }) {
  const items = [];
  for (const ev of calendar) {
    const iv = wallInterval(ev.start, ev.end);
    if (iv.day !== day) continue;
    items.push({ ...iv, title: ev.title, where: ev.location, venue: venueKey(ev.location),
      kind: ev.busy === false ? 'tentative' : 'calendar', blocks: ev.busy !== false });
  }
  for (const pt of schedule.personalTime || []) {
    const iv = wallInterval(pt.startDateTime, pt.endDateTime);
    if (iv.day !== day) continue;
    items.push({ ...iv, id: pt.personalTimeId, title: pt.title, where: pt.location, venue: venueKey(pt.location),
      kind: 'personal', blocks: true });
  }
  const add = (ids, kind, blocks) => {
    for (const id of ids || []) {
      const s = byId.get(id);
      const iv = s && interval(s);
      if (!iv || iv.day !== day) continue;
      if (items.some((i) => i.id === id)) continue;
      // Same thing already on your calendar (e.g. "CEO Keynote (KEY002)"): show it once.
      const twin = items.find((i) => (i.kind === 'calendar' || i.kind === 'tentative') && i.start === iv.start && i.end === iv.end
        && (s.abbreviation && i.title.includes(s.abbreviation) || venueKey(s.venue) === i.venue));
      if (twin) { twin.code = s.abbreviation; continue; }
      items.push({ ...iv, id, title: s.title, code: s.abbreviation, where: [s.venue, s.room].filter(Boolean).join(' · '),
        venue: venueKey(s.venue), kind, blocks });
    }
  };
  add(schedule.reserved, 'reserved', true);
  add(schedule.favorites, 'favorite', false);
  return items.sort((a, b) => a.start - b.start || b.end - a.end);
}

const KIND_LABEL = {
  calendar: 'Calendar', tentative: 'Calendar · tentative', reserved: 'Reserved', favorite: 'Favorite', personal: 'Personal time',
};
const REMOVE = {
  reserved: ['Cancel reservation', 'Yes, give seat back'],
  favorite: ['Remove favorite', 'Yes, remove'],
  personal: ['Remove block', 'Yes, remove'],
};

function itemRow(it, conflict, onRemove, id) {
  const labels = REMOVE[it.kind];
  const action = onRemove && it.id && labels ? removeButton(labels[0], labels[1], () => onRemove(it.kind, it.id)) : null;
  return el('li', { id, tabindex: id ? '-1' : null, class: `plan-item plan-item--${it.kind}${conflict ? ' plan-item--conflict' : ''}` },
    el('div', { class: 'plan-item__time', text: `${formatTime(it.start)}–${formatTime(it.end)}` }),
    el('div', { class: 'plan-item__body' },
      el('div', { class: 'plan-item__top' },
        el('span', { class: 'plan-tag', text: KIND_LABEL[it.kind] }),
        it.code ? el('span', { class: 'session__code', text: it.code }) : null),
      el('div', { class: 'plan-item__title', text: it.title }),
      el('div', { class: 'plan-item__where', text: it.where && !/^tb[cd]$/i.test(it.where.trim()) ? it.where : TBD }),
      conflict ? el('div', { class: 'plan-warn', text: `⚠ Overlaps ${conflict}` }) : null,
      action ? el('div', { class: 'plan-item__actions' }, action) : null));
}

function hopRow(prev, next) {
  const mins = travelMinutes(prev.venue, next.venue);
  const gap = next.start - prev.end;
  if (mins == null) {
    return el('li', { class: 'plan-hop' }, el('span', { text: `${gap} min between · ${TBD}, check travel once it's known` }));
  }
  const ok = gap >= mins;
  const route = mins === 0 ? 'Same building' : `${venueName(prev.venue)} → ${venueName(next.venue)} · ~${mins} min`;
  return el('li', { class: `plan-hop${ok ? '' : ' plan-hop--tight'}` },
    el('span', { 'aria-hidden': 'true', text: ok ? '↓ ' : '⚠ ' }),
    el('span', { text: ok ? `${route} · ${gap} min free` : `${route}, but only ${gap} min. You'll be late.` }));
}

function ideaCard(idea, onBlock) {
  const btn = el('button', { class: 'btn btn--secondary btn--sm', type: 'button', text: 'Block this time',
    'aria-label': `Block ${formatTime(idea.start)}–${formatTime(idea.end)} for ${idea.title} on your re:Invent schedule` });
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Blocking…';
    try { await onBlock(idea); } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Block this time';
      btn.after(el('span', { class: 'plan-warn', role: 'alert', text: ` ${err.message}` }));
    }
  });
  return el('li', { class: `idea idea--${idea.kind}` },
    el('span', { class: 'idea__icon', 'aria-hidden': 'true', text: idea.icon }),
    el('div', { class: 'idea__body' },
      el('div', { class: 'idea__title' }, el('strong', { text: idea.title }), ` · ${formatTime(idea.start)}–${formatTime(idea.end)}`),
      el('div', { class: 'idea__detail', text: idea.detail })),
    onBlock ? btn : null);
}

function gapRow(start, end, fits, ideas, itemOpts, onBlock, open) {
  const label = `Free ${formatTime(start)}–${formatTime(end)}`;
  const parts = [
    fits.length ? `${fits.length} session${fits.length === 1 ? '' : 's'} fit` : null,
    ...ideas.map((i) => i.title.toLowerCase()),
  ].filter(Boolean);
  const summary = parts.length ? `${label} · ${parts.join(' · ')}` : `${label} · nothing matching your filters fits`;
  if (!fits.length && !ideas.length) return el('li', { class: 'plan-gap plan-gap--empty', text: summary });
  return el('li', {},
    el('details', { class: 'plan-gap', open },
      el('summary', { text: summary }),
      ideas.length ? el('ul', { class: 'ideas', 'aria-label': 'Suggested breaks' }, ...ideas.map((i) => ideaCard(i, onBlock))) : null,
      fits.length ? el('ul', { class: 'session-list plan-gap__list' }, ...fits.slice(0, SUGGEST).map((s) => sessionItem(s, itemOpts(s)))) : null,
      fits.length > SUGGEST ? el('p', { class: 'field__hint', text: `+${fits.length - SUGGEST} more. Narrow with search or topic.` }) : null));
}

function runWarning(run) {
  const h = Math.floor((run.end - run.start) / 60), m = (run.end - run.start) % 60;
  return el('li', { class: 'plan-fatigue', role: 'note' },
    el('span', { 'aria-hidden': 'true', text: '⚠ ' }),
    `${h}h${m ? ` ${m}m` : ''} back-to-back from ${formatTime(run.start)} to ${formatTime(run.end)} with no real break. Drop something or keep 30 min free.`);
}

/**
 * Renders the planner for `day` into `root`.
 * candidates: sessions passing current filters (any day); blocks: busy blocks incl. calendar.
 */
export function renderPlanner(root, { day, calendar, schedule, byId, candidates, blocks, services, itemOpts, onRemove, onBlock }) {
  if (!day) {
    root.replaceChildren(el('p', { class: 'plan-empty', text: 'Pick a day above to see your agenda in Las Vegas time.' }));
    return;
  }
  const items = dayItems(day, { calendar, schedule, byId });
  const firm = items.filter((i) => i.blocks);

  // Overlaps between commitments (e.g. a reserved workshop during a meeting).
  // Favorites count too, so you can spot and drop the ones you can't make.
  const conflictOf = (it) => {
    if (it.kind === 'tentative') return null;
    const other = firm.find((o) => o !== it && o.start < it.end && it.start < o.end);
    return other ? other.title : null;
  };

  const mine = new Set([...(schedule.reserved || []), ...(schedule.favorites || [])]);
  const dayFits = candidates.filter((s) => interval(s)?.day === day && !mine.has(s.sessionId) && !clashes(s, blocks).length);
  const fitsIn = (a, b) => dayFits.filter((s) => { const iv = interval(s); return iv.start >= a && iv.end <= b; });

  // Rows carry a sort key so gaps, hops and items read in time order.
  const keyed = [];
  const push = (at, rank, node) => keyed.push({ at, rank, node });
  let opened = false; // expand the first gap that actually has something to offer
  const gap = (a, b, prev, next) => {
    const soft = items.filter((i) => i.kind === 'favorite' && i.start < b && a < i.end);
    const ideas = gapIdeas(day, a, b, prev, next, services, soft, firm.length > 0);
    const fits = fitsIn(a, b);
    const open = !opened && (fits.length > 0 || ideas.length > 0);
    if (open) opened = true;
    push(a, 0, gapRow(a, b, fits, ideas, itemOpts, onBlock, open));
  };

  let cursor = DAY_START;
  let prevFirm = null;
  for (const it of firm) {
    if (it.start - cursor >= MIN_GAP && cursor < DAY_END) gap(cursor, it.start, prevFirm?.venue ?? null, it.venue);
    if (prevFirm && it.start >= prevFirm.end) push(it.start, 1, hopRow(prevFirm, it));
    cursor = Math.max(cursor, it.end);
    if (!prevFirm || it.end >= prevFirm.end) prevFirm = it;
  }
  if (DAY_END - cursor >= MIN_GAP) gap(cursor, DAY_END, prevFirm?.venue ?? null, null);
  for (const it of items) {
    const n = firm.indexOf(it);
    push(it.start, 2, itemRow(it, conflictOf(it), onRemove, n >= 0 ? stopId(n) : null));
  }
  for (const run of longRuns(firm)) push(run.end, 3, runWarning(run));
  keyed.sort((a, b) => a.at - b.at || a.rank - b.rank);

  root.replaceChildren(
    el('p', { class: 'plan-note', text: 'All times are Las Vegas time (PT). Travel times are estimates between venues.' }),
    ...(calendar.length ? [] : [el('p', { class: 'notice', text: 'No calendar loaded. Add data/calendar.json to see your meetings here (see README).' })]),
    renderRoute(firm, stopId),
    el('ol', { class: 'plan', 'aria-label': 'Agenda' }, ...keyed.map((k) => k.node)));
}
