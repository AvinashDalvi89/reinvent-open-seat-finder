// Thin client for the local proxy (/api/* -> https://api.awsevents.com/v1/*).
export const EVENT_ID = 'reinvent2026';

export class ApiError extends Error {
  constructor(status, message, retryAfter) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(method, path, body, { retries = 2 } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      'X-Open-Seats': '1',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  // Throttled: honour Retry-After, a refused request spends no quota.
  if (res.status === 429 && retries > 0) {
    const wait = Number(res.headers.get('Retry-After') || 5);
    await sleep(Math.min(wait, 60) * 1000);
    return request(method, path, body, { retries: retries - 1 });
  }
  const text = await res.text();
  const data = text ? safeJson(text) : {};
  if (!res.ok) {
    throw new ApiError(res.status, data.message || messageFor(res.status), res.headers.get('Retry-After'));
  }
  return data;
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return {}; }
}

function messageFor(status) {
  if (status === 401) return 'Your sign-in expired. Sign in again.';
  if (status === 403) return 'This Builder ID is not registered for re:Invent 2026.';
  if (status === 429) return 'The Events API is rate-limiting requests. Wait a minute and retry.';
  if (status >= 500) return 'The Events API is unavailable right now. Retry in a moment.';
  return `Request failed (${status}).`;
}

export async function authStatus() {
  const res = await fetch('/auth/status', { headers: { Accept: 'application/json' } });
  return (await res.json()).signedIn;
}

export async function signOut() {
  await fetch('/auth/logout', { method: 'POST', headers: { 'X-Open-Seats': '1' } });
}

/** Walk every page (the API has no server-side filter). onProgress(loaded, total). */
export async function loadAllSessions(onProgress) {
  const all = [];
  let nextToken;
  do {
    const qs = new URLSearchParams({ includeAbstracts: 'true' });
    if (nextToken) qs.set('nextToken', nextToken);
    const page = await request('GET', `/events/${EVENT_ID}/sessions?${qs}`);
    all.push(...page.items);
    onProgress?.(all.length, page.totalCount);
    nextToken = page.nextToken; // a short page is not the last page; only a missing token is
  } while (nextToken);
  return all;
}

export async function getSchedule() {
  return (await request('GET', `/events/${EVENT_ID}/schedule`)).schedule;
}

/** Reserve up to 10 sessions. Returns BulkResult {successful, failed}. Not safe to blindly retry. */
export async function reserve(sessionIds) {
  return (await request('POST', `/events/${EVENT_ID}/reservations`, { sessionIds }, { retries: 0 })).result;
}

export async function favorite(sessionIds) {
  return (await request('POST', `/events/${EVENT_ID}/favorites`, { sessionIds }, { retries: 0 })).result;
}
