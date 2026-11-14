// Human time in a free gap: lunch, Expo/swag and breaks, plus a warning when a
// stretch of commitments runs too long without one. Windows come from the
// catalog itself (Event service "Lunch", Expo hall hours), not hard-coded.
import { interval, formatTime } from './model.js';
import { venueKey, venueName, travelMinutes } from './venues.js';

const LONG_RUN = 180;   // minutes of back-to-back commitments before we nag
const MIN_BREAK = 30;
const LUNCH = 45;
const EXPO_MIN = 45;
const EXPO_MAX = 90;
const ceil5 = (m) => Math.ceil(m / 5) * 5;
const floor5 = (m) => Math.floor(m / 5) * 5;

/** day -> { lunch: {start, end}, expo: {start, end, venue, where} } from the catalog. */
export function eventServices(sessions) {
  const byDay = {};
  for (const s of sessions) {
    const iv = interval(s);
    if (!iv) continue;
    const day = (byDay[iv.day] ||= {});
    if (s.type === 'Event service' && /^lunch$/i.test(s.title)) day.lunch = { start: iv.start, end: iv.end };
    if (s.type === 'Expo' && /^expo$/i.test(s.title)) {
      day.expo = { start: iv.start, end: iv.end, venue: venueKey(s.venue), where: [s.venue, s.room].filter(Boolean).join(' · ') };
    }
  }
  return byDay;
}

/**
 * Earliest slot of up to `len` (at least `min`) minutes inside [from, to) that
 * doesn't overlap any `soft` interval (sessions you favorited and may attend).
 */
function findSlot(from, to, len, min, soft) {
  const starts = [from, ...soft.map((x) => x.end)].map(ceil5).filter((t) => t >= from).sort((x, y) => x - y);
  for (const s of starts) {
    const nextSoft = soft.filter((x) => x.end > s).reduce((m, x) => Math.min(m, Math.max(x.start, s)), to);
    if (soft.some((x) => x.start <= s && s < x.end)) continue;
    const e = floor5(Math.min(to, nextSoft, s + len));
    if (e - s >= min) return { start: s, end: e };
  }
  return null;
}

/**
 * Suggestions for one free gap [a, b). prev/next are the venue keys you come
 * from and go to (null when unknown or at the edge of the day). soft: favorite
 * session intervals in the gap, which suggestions steer around.
 */
export function gapIdeas(day, a, b, prev, next, services, soft = [], hasCommitments = true) {
  const svc = services[day] || {};
  const ideas = [];
  const taken = [...soft];

  if (svc.lunch) {
    const slot = findSlot(Math.max(a, svc.lunch.start), Math.min(b, svc.lunch.end), LUNCH, MIN_BREAK, taken);
    if (slot) {
      ideas.push({ kind: 'lunch', icon: '🍽', title: 'Lunch', ...slot,
        detail: `Lunch is served ${formatTime(svc.lunch.start)}–${formatTime(svc.lunch.end)} across venues` });
      taken.push(slot);
    }
  }

  if (svc.expo) {
    const tin = travelMinutes(prev, svc.expo.venue) ?? 15;
    const tout = travelMinutes(svc.expo.venue, next) ?? 15;
    // Favorites may be in another building: leave ~15 min either side to walk.
    const padded = taken.map((x) => ({ start: x.start - 15, end: x.end + 15 }));
    const slot = findSlot(Math.max(a + tin, svc.expo.start), Math.min(b - tout, svc.expo.end), EXPO_MAX, EXPO_MIN, padded);
    if (slot) {
      ideas.push({ kind: 'expo', icon: '🎒', title: 'Expo & swag', ...slot, location: svc.expo.where,
        detail: `${venueName(svc.expo.venue)} Expo open ${formatTime(svc.expo.start)}–${formatTime(svc.expo.end)}${tin ? ` · ~${tin} min to get there` : ''}` });
      taken.push(slot);
    }
  }

  // A plain break only between real commitments; an empty day needs no nagging.
  if (!ideas.length && hasCommitments && (prev || next) && b - a >= 60) {
    const slot = findSlot(a, b, MIN_BREAK, MIN_BREAK, taken);
    if (slot) {
      ideas.push({ kind: 'break', icon: '☕', title: 'Recharge break', ...slot,
        detail: 'Coffee, water, charge your phone. You can\u2019t run session to session all day.' });
    }
  }
  return ideas;
}

/** Stretches of firm commitments with < 30 min between them that last 3h+. */
export function longRuns(firm) {
  const runs = [];
  let run = null;
  for (const it of firm) {
    if (run && it.start - run.end < MIN_BREAK) run.end = Math.max(run.end, it.end);
    else { if (run) runs.push(run); run = { start: it.start, end: it.end }; }
  }
  if (run) runs.push(run);
  return runs.filter((r) => r.end - r.start >= LONG_RUN);
}

/** "2026-12-01" + minutes -> "2026-12-01T13:05:00" (event wall-clock, as the API wants). */
export function wallClock(day, min) {
  const h = String(Math.floor(min / 60)).padStart(2, '0');
  const m = String(min % 60).padStart(2, '0');
  return `${day}T${h}:${m}:00`;
}
