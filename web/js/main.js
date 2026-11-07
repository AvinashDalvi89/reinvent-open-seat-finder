import * as api from './api.js';
import {
  AVAILABILITY, OPEN_BANDS, band, busyBlocks, facets, formatDay, matchesExceptDay, searchText, sortSessions,
} from './model.js';
import { el, sessionItem, skeletonList, loadingState, emptyState, errorState, resultItems } from './render.js';

const PAGE = 60;
const MAX_PICK = 10; // ReserveSessions / AssociateFavorites accept 1-10 ids
const $ = (id) => document.getElementById(id);

const state = {
  sessions: [],
  byId: new Map(),
  text: new Map(),
  schedule: { reserved: [], favorites: [], personalTime: [] },
  blocks: [],
  selected: new Set(),
  shown: PAGE,
  filters: readFilters(),
  loadedAt: null,
};

// ---- Filters <-> URL (shareable, survives reload) ------------------------
function readFilters() {
  const p = new URLSearchParams(location.search);
  return {
    q: p.get('q') || '',
    bands: p.has('bands') ? p.get('bands').split(',').filter(Boolean) : [...OPEN_BANDS],
    fits: p.get('fits') === '1',
    type: p.get('type') || '',
    level: p.get('level') || '',
    topic: p.get('topic') || '',
    day: p.get('day') || '',
  };
}

function writeFilters() {
  const f = state.filters, p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.bands.join() !== OPEN_BANDS.join()) p.set('bands', f.bands.join(','));
  if (f.fits) p.set('fits', '1');
  for (const k of ['type', 'level', 'topic', 'day']) if (f[k]) p.set(k, f[k]);
  history.replaceState(null, '', `${location.pathname}${p.toString() ? `?${p}` : ''}`);
}

function setFilter(patch) {
  Object.assign(state.filters, patch);
  state.shown = PAGE;
  writeFilters();
  render();
}

// ---- Boot ---------------------------------------------------------------
async function boot() {
  const params = new URLSearchParams(location.search);
  if (params.get('auth') === 'failed') {
    $('signin-error').hidden = false;
    params.delete('auth');
    history.replaceState(null, '', `${location.pathname}${params.toString() ? `?${params}` : ''}`);
  }
  if (!(await api.authStatus())) return showSignIn();
  $('signin-view').hidden = true;
  $('app-view').hidden = false;
  $('refresh-btn').hidden = false;
  $('signout-btn').hidden = false;
  bindControls();
  await load();
}

function showSignIn() {
  $('signin-view').hidden = false;
  $('app-view').hidden = true;
  $('refresh-btn').hidden = true;
  $('signout-btn').hidden = true;
  $('action-bar').hidden = true;
}

async function load() {
  const stateEl = $('state'), list = $('session-list');
  $('refresh-btn').disabled = true;
  stateEl.hidden = false;
  stateEl.setAttribute('aria-busy', 'true');
  stateEl.replaceChildren(...loadingState(0, 0));
  list.replaceChildren(...skeletonList());
  $('summary').replaceChildren();
  try {
    const [sessions, schedule] = await Promise.all([
      api.loadAllSessions((n, total) => stateEl.replaceChildren(...loadingState(n, total))),
      api.getSchedule(),
    ]);
    state.sessions = sortSessions(sessions);
    state.byId = new Map(sessions.map((s) => [s.sessionId, s]));
    state.text = new Map(sessions.map((s) => [s.sessionId, searchText(s)]));
    setSchedule(schedule);
    state.loadedAt = new Date();
    stateEl.hidden = true;
    populateFacets();
    render();
  } catch (err) {
    list.replaceChildren();
    stateEl.replaceChildren(...errorState(err, { onRetry: load }));
    if (err.status === 401) showSignIn();
  } finally {
    stateEl.removeAttribute('aria-busy');
    $('refresh-btn').disabled = false;
  }
}

function setSchedule(schedule) {
  state.schedule = schedule;
  state.blocks = busyBlocks(schedule, state.byId);
}

// ---- Controls -----------------------------------------------------------
function bindControls() {
  let t;
  $('q').value = state.filters.q;
  $('q').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => setFilter({ q: e.target.value.trim() }), 150);
  });
  $('fits').checked = state.filters.fits;
  $('fits').addEventListener('change', (e) => setFilter({ fits: e.target.checked }));
  for (const k of ['type', 'level', 'topic']) $(k).addEventListener('change', (e) => setFilter({ [k]: e.target.value }));
  $('reset-btn').addEventListener('click', resetFilters);
  $('more-btn').addEventListener('click', () => { state.shown += PAGE; render(); });
  $('refresh-btn').addEventListener('click', load);
  $('signout-btn').addEventListener('click', async () => { await api.signOut(); location.replace('/'); });
  $('clear-sel-btn').addEventListener('click', () => { state.selected.clear(); render(); });
  $('reserve-btn').addEventListener('click', () => submit('reserve'));
  $('fav-btn').addEventListener('click', () => submit('favorite'));
  $('result-close').addEventListener('click', () => $('result-dialog').close());
}

function resetFilters() {
  state.filters = { q: '', bands: [...OPEN_BANDS], fits: false, type: '', level: '', topic: '', day: state.filters.day };
  $('q').value = '';
  $('fits').checked = false;
  for (const k of ['type', 'level', 'topic']) $(k).value = '';
  state.shown = PAGE;
  writeFilters();
  render();
}

function populateFacets() {
  const f = facets(state.sessions);
  const fill = (id, values) => {
    const sel = $(id);
    sel.replaceChildren(sel.options[0], ...values.map((v) => el('option', { value: v, text: v })));
    sel.value = state.filters[id] && values.includes(state.filters[id]) ? state.filters[id] : '';
  };
  fill('type', f.types);
  fill('level', f.levels);
  fill('topic', f.topics);
  state.days = f.days;
  if (state.filters.day && !f.days.includes(state.filters.day)) state.filters.day = '';
}

// ---- Render -------------------------------------------------------------
function render() {
  const f = state.filters;
  const ctx = { text: state.text, blocks: state.blocks };
  const reserved = new Set(state.schedule.reserved);
  const favorites = new Set(state.schedule.favorites);

  // Band counts ignore the band filter itself so users see what they'd gain.
  const bandCounts = {};
  for (const s of state.sessions) {
    if (reserved.has(s.sessionId)) continue;
    if (!matchesExceptDay(s, { ...f, bands: [band(s)] }, ctx)) continue;
    if (f.day && s.sessionTime?.date !== f.day) continue;
    bandCounts[band(s)] = (bandCounts[band(s)] || 0) + 1;
  }
  renderBandOptions(bandCounts);

  const dayMatches = state.sessions.filter((s) => !reserved.has(s.sessionId) && matchesExceptDay(s, f, ctx));
  renderDayTabs(dayMatches);
  const matches = f.day ? dayMatches.filter((s) => s.sessionTime?.date === f.day) : dayMatches;

  // On a chosen day, show your reservations in-line so gaps are obvious.
  const mineToday = f.day
    ? state.sessions.filter((s) => reserved.has(s.sessionId) && s.sessionTime?.date === f.day)
    : [];
  const rows = sortSessions([...matches, ...mineToday]);

  renderSummary(matches, reserved.size);
  const full = state.selected.size >= MAX_PICK;
  $('session-list').replaceChildren(...rows.slice(0, state.shown).map((s) => sessionItem(s, {
    selected: state.selected.has(s.sessionId),
    mine: reserved.has(s.sessionId),
    fav: favorites.has(s.sessionId),
    blocks: state.blocks,
    disabled: full,
    onToggle: toggle,
  })));
  $('more-btn').hidden = rows.length <= state.shown;
  $('more-btn').textContent = `Show more (${(rows.length - state.shown).toLocaleString()} left)`;

  const stateEl = $('state');
  if (!matches.length && state.sessions.length) {
    stateEl.hidden = false;
    stateEl.replaceChildren(...emptyState(resetFilters));
  } else if (state.sessions.length) {
    stateEl.hidden = true;
  }
  renderActionBar();
  renderSync();
}

function renderBandOptions(counts) {
  const box = $('avail-options');
  box.replaceChildren(...AVAILABILITY.map((a) => el('label', { class: 'check' },
    el('input', {
      type: 'checkbox', value: a.key, checked: state.filters.bands.includes(a.key),
      onchange: (e) => setFilter({
        bands: e.target.checked ? [...state.filters.bands, a.key] : state.filters.bands.filter((b) => b !== a.key),
      }),
    }),
    el('span', { text: a.label }),
    el('span', { class: 'check__count', text: (counts[a.key] || 0).toLocaleString() }))));
}

function renderDayTabs(matches) {
  const counts = {};
  for (const s of matches) { const d = s.sessionTime?.date; if (d) counts[d] = (counts[d] || 0) + 1; }
  const tab = (value, label, n) => el('button', {
    class: 'day-tab', type: 'button', 'aria-pressed': String(state.filters.day === value),
    onclick: () => setFilter({ day: value }),
  }, label, el('span', { class: 'day-tab__count', text: n.toLocaleString() }));
  $('day-tabs').replaceChildren(
    tab('', 'All days', matches.length),
    ...(state.days || []).map((d) => tab(d, formatDay(d), counts[d] || 0)));
}

function renderSummary(matches, reservedCount) {
  const open = matches.filter((s) => OPEN_BANDS.includes(band(s))).length;
  const stat = (n, label) => el('span', {}, el('strong', { text: n.toLocaleString() }), ` ${label}`);
  $('summary').replaceChildren(
    stat(open, 'with open seats'),
    stat(state.sessions.length, 'in catalog'),
    stat(reservedCount, 'reserved by you'),
    ...(state.filters.fits ? [el('span', { text: 'Clashes hidden' })] : []));
}

function renderSync() {
  if (!state.loadedAt) return;
  $('sync-status').textContent = `Seats as of ${state.loadedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

function renderActionBar() {
  const n = state.selected.size;
  $('action-bar').hidden = n === 0;
  $('selection-count').textContent = `${n} selected${n >= MAX_PICK ? ' (max 10 per request)' : ''}`;
}

function toggle(id) {
  if (state.selected.has(id)) state.selected.delete(id);
  else if (state.selected.size < MAX_PICK) state.selected.add(id);
  render();
}

// ---- Reserve / favorite ---------------------------------------------------
async function submit(kind) {
  const ids = [...state.selected];
  const buttons = [$('reserve-btn'), $('fav-btn'), $('clear-sel-btn')];
  buttons.forEach((b) => { b.disabled = true; });
  $('selection-count').textContent = kind === 'reserve' ? 'Reserving…' : 'Saving favorites…';
  let result;
  try {
    result = kind === 'reserve' ? await api.reserve(ids) : await api.favorite(ids);
  } catch (err) {
    result = { successful: [], failed: ids.map((id) => ({ sessionId: id, code: 'other' })) };
    showResult(kind, result, err.message);
    buttons.forEach((b) => { b.disabled = false; });
    renderActionBar();
    if (err.status === 401) showSignIn();
    return;
  }
  // A 200 can still carry per-session refusals; keep only the failures selected.
  state.selected = new Set(result.failed.map((f) => f.sessionId));
  try { setSchedule(await api.getSchedule()); } catch { /* list stays usable; refresh fixes it */ }
  buttons.forEach((b) => { b.disabled = false; });
  render();
  showResult(kind, result);
}

function showResult(kind, result, errorMessage) {
  const verb = kind === 'reserve' ? 'Reserved' : 'Favorited';
  const ok = result.successful.length, bad = result.failed.length;
  $('result-title').textContent = errorMessage
    ? `Request failed: ${errorMessage}`
    : `${verb} ${ok} of ${ok + bad}`;
  $('result-list').replaceChildren(...resultItems(result, state.byId, verb));
  $('result-dialog').showModal();
  $('result-close').focus();
}

boot().catch((err) => {
  $('signin-view').hidden = false;
  $('signin-error').textContent = `Couldn't reach the local server: ${err.message}`;
  $('signin-error').hidden = false;
});
