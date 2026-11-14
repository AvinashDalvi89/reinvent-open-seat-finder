// Pure data logic: availability bands, time math, filtering. No DOM here.
import { venueKey, travelMinutes } from './venues.js';

// open: has reservable seats. attend: you can get in (reserve, or just walk in).
export const AVAILABILITY = [
  { key: 'available',   label: 'Open',          icon: '●', open: true,  attend: true },
  { key: 'limited',     label: 'Filling up',    icon: '◐', open: true,  attend: true },
  { key: 'veryLimited', label: 'Last seats',    icon: '◔', open: true,  attend: true },
  { key: 'none',        label: 'Walk-in (no reservation)', icon: '→', open: false, attend: true },
  { key: 'walkUp',      label: 'Walk-up only',  icon: '→', open: false, attend: true },
  { key: 'unavailable', label: 'Full',          icon: '○', open: false, attend: false },
];
export const OPEN_BANDS = AVAILABILITY.filter((a) => a.open).map((a) => a.key);
export const DEFAULT_BANDS = AVAILABILITY.filter((a) => a.attend).map((a) => a.key);
export const TALK_TYPES = ['Breakout session', 'Lightning talk', 'Chalk talk', 'Code talk', 'Keynote', 'Mainstage'];
const RANK = Object.fromEntries(AVAILABILITY.map((a, i) => [a.key, i]));

export function band(session) {
  if (session.seatAvailability) return session.seatAvailability;
  return session.isReservable ? 'available' : 'none';
}

export const bandInfo = (key) => AVAILABILITY.find((a) => a.key === key) || AVAILABILITY.at(-1);

/** Session time -> {day, start, end} in event-local minutes, or null if unscheduled. */
export function interval(session) {
  const t = session.sessionTime;
  if (!t?.date || !t?.time) return null;
  const [h, m] = t.time.split(':').map(Number);
  const start = h * 60 + m;
  return { day: t.date, start, end: start + (Number(t.length) || 60) };
}

const toMin = (hms) => { const [h, m] = hms.split(':').map(Number); return h * 60 + m; };

/** "YYYY-MM-DDTHH:MM[:SS]" wall-clock (event timezone) -> {day, start, end}. */
export function wallInterval(startIso, endIso) {
  const [day, s] = startIso.split('T');
  const [endDay, e] = endIso.split('T');
  return { day, start: toMin(s), end: endDay === day ? toMin(e) : 24 * 60 };
}

/**
 * Blocks that make you unavailable: reserved sessions, re:Invent personal time and
 * busy events from your own calendar (data/calendar.json). Each carries a venue key
 * so clash checks can include travel time.
 */
export function busyBlocks(schedule, sessionsById, calendar = []) {
  const blocks = [];
  for (const id of schedule?.reserved || []) {
    const s = sessionsById.get(id);
    const iv = s && interval(s);
    if (iv) blocks.push({ ...iv, label: s.abbreviation || s.title, kind: 'session', id, venue: venueKey(s.venue) });
  }
  for (const pt of schedule?.personalTime || []) {
    blocks.push({ ...wallInterval(pt.startDateTime, pt.endDateTime), label: pt.title, kind: 'personal', venue: venueKey(pt.location) });
  }
  for (const ev of calendar) {
    if (ev.busy === false) continue;
    blocks.push({ ...wallInterval(ev.start, ev.end), label: ev.title, kind: 'calendar', venue: venueKey(ev.location) });
  }
  return blocks;
}

/** Blocks this session overlaps, counting travel time between venues when both are known. */
export function clashes(session, blocks) {
  const iv = interval(session);
  if (!iv) return [];
  const here = venueKey(session.venue);
  return blocks.filter((b) => {
    if (b.day !== iv.day || b.id === session.sessionId) return false;
    const toHere = travelMinutes(b.venue, here) || 0;
    const fromHere = travelMinutes(here, b.venue) || 0;
    return b.start < iv.end + fromHere && iv.start < b.end + toHere;
  });
}

export function searchText(s) {
  return [
    s.title, s.abbreviation, s.type, s.level, s.venue,
    ...(s.speakers || []).map((p) => p.name), ...(s.topics || []), ...(s.services || []),
  ].filter(Boolean).join(' ').toLowerCase();
}

export function facets(sessions) {
  const collect = (fn) => [...new Set(sessions.flatMap(fn).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return {
    days: collect((s) => [s.sessionTime?.date]),
    types: collect((s) => [s.type]),
    levels: collect((s) => [s.level]),
    topics: collect((s) => s.topics || []),
  };
}

/** Everything except the day filter, so day tabs can show live counts. */
export function matchesExceptDay(s, f, ctx) {
  if (!f.bands.includes(band(s))) return false;
  if (f.talks && !TALK_TYPES.includes(s.type)) return false;
  if (f.type && s.type !== f.type) return false;
  if (f.level && s.level !== f.level) return false;
  if (f.topic && !(s.topics || []).includes(f.topic)) return false;
  if (f.q && !ctx.text.get(s.sessionId).includes(f.q.toLowerCase())) return false;
  if (f.fits && clashes(s, ctx.blocks).length) return false;
  return true;
}

export function sortSessions(list) {
  return list.sort((a, b) => {
    const ia = interval(a), ib = interval(b);
    const ka = ia ? `${ia.day}${String(ia.start).padStart(4, '0')}` : '~';
    const kb = ib ? `${ib.day}${String(ib.start).padStart(4, '0')}` : '~';
    return ka.localeCompare(kb) || RANK[band(a)] - RANK[band(b)] || a.title.localeCompare(b.title);
  });
}

export function formatDay(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatTime(min) {
  const h = Math.floor(min / 60), m = min % 60;
  const d = new Date(2000, 0, 1, h, m);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export const FAILURE_REASONS = {
  sessionFull: 'Full. Every seat is taken.',
  scheduleConflict: 'Clashes with something already on your schedule.',
  alreadyScheduled: 'Already on your schedule.',
  sessionNotReservable: 'This session does not take reservations.',
  insufficientAccess: 'Your registration does not include this session.',
  timePassed: 'This session has already started.',
  alreadyFavorited: 'Already in your favorites.',
  notFavorited: 'Not in your favorites.',
};
