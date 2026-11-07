// Pure data logic: availability bands, time math, filtering. No DOM here.

export const AVAILABILITY = [
  { key: 'available',   label: 'Open',          icon: '●', open: true },
  { key: 'limited',     label: 'Filling up',    icon: '◐', open: true },
  { key: 'veryLimited', label: 'Last seats',    icon: '◔', open: true },
  { key: 'walkUp',      label: 'Walk-up only',  icon: '→', open: false },
  { key: 'unavailable', label: 'Full',          icon: '○', open: false },
  { key: 'none',        label: 'No reservations', icon: '–', open: false },
];
export const OPEN_BANDS = AVAILABILITY.filter((a) => a.open).map((a) => a.key);
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

function personalInterval(pt) {
  const [day, s] = pt.startDateTime.split('T');
  const [, e] = pt.endDateTime.split('T');
  const toMin = (hms) => { const [h, m] = hms.split(':').map(Number); return h * 60 + m; };
  return { day, start: toMin(s), end: toMin(e), label: pt.title, kind: 'personal' };
}

/** Busy blocks per day from reserved sessions + personal time. */
export function busyBlocks(schedule, sessionsById) {
  const blocks = [];
  for (const id of schedule?.reserved || []) {
    const s = sessionsById.get(id);
    const iv = s && interval(s);
    if (iv) blocks.push({ ...iv, label: s.abbreviation || s.title, kind: 'session', id });
  }
  for (const pt of schedule?.personalTime || []) blocks.push(personalInterval(pt));
  return blocks;
}

/** Blocks overlapping this session (back-to-back is fine). */
export function clashes(session, blocks) {
  const iv = interval(session);
  if (!iv) return [];
  return blocks.filter((b) => b.day === iv.day && b.id !== session.sessionId && b.start < iv.end && iv.start < b.end);
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
