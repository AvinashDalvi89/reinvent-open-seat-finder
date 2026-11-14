# Open Seats: find re:Invent 2026 sessions you can still get into

The re:Invent catalog lists every session, full or not, so finding one you can actually attend means
clicking through sessions that say "Full". **Open Seats** pulls the entire re:Invent 2026 catalog
through the official [Events API](https://docs.aws.amazon.com/events/latest/devguide/what-is-events-api.html),
shows only sessions with open seats, hides anything that clashes with your schedule, and reserves
your picks in one step.

## Features

- **Open seats only.** Filters on the API's `seatAvailability` band: *Open*, *Filling up*,
  *Last seats*. Full, walk-up, and non-reservable sessions are one checkbox away. Each band shows a
  live count.
- **Fits my schedule.** Reads your reservations and personal time (`GetSchedule`) and hides every
  session that overlaps them. Pick a day and your reservations appear in the list, so the gaps are obvious.
- **Reserve or favorite up to 10 at once.** Uses `ReserveSessions` / `AssociateFavorites`, and reports
  each session separately: reserved, full, clashes with *X*, already scheduled. A `200` can still contain refusals,
  so the app never says "done" when it isn't.
- **Search and facets.** Day tabs with counts, type, level, topic, and free-text search over title, code,
  speakers, topics, and services. Filters live in the URL, so a filtered view can be bookmarked or shared.
- **Link to the official catalog.** Every session links to its page in the
  [official re:Invent 2026 catalog](https://registration.awsevents.com/flow/awsevents/reinvent2026/event-catalog/page/eventCatalog)
  (searched by session code), so you can check details there or book there instead.
- **Respects the API.** Follows `nextToken` until it's absent (a short page is not the last page), honors
  `Retry-After` on `429`, refreshes the token once on `401` and then asks you to sign in again, and never
  retries a reservation automatically.

## My week planner (optional, personal)

Switch to **My week** to see one day as an agenda in Las Vegas time (PT). It shows your meetings,
reservations and favorites, the travel time between venues (with a warning when a hop is too tight),
and the sessions that fit each free gap under your current filters.

To include your own meetings, create `data/calendar.json` (git-ignored, served only to localhost):

```json
{
  "timezone": "America/Los_Angeles",
  "events": [
    { "title": "Customer meeting", "start": "2026-11-30T11:00", "end": "2026-11-30T11:45",
      "location": "Caesars Forum", "busy": true }
  ]
}
```

Times are wall-clock Las Vegas time. `busy: false` events are shown but don't block sessions. Venue travel
times are estimates in `web/js/venues.js`. Edit them if your experience on site differs.

## How it works

```
Browser (web/)  ──►  server.py on localhost:8484  ──►  https://api.awsevents.com/v1
                         │  OAuth 2.0 + PKCE
                         └──►  https://oauth.awsevents.com (AWS Builder ID)
```

- `server.py` is a small local server that uses only the Python standard library. It runs the Builder ID
  sign-in (authorization code + PKCE, public client `7vmom55m1qstvq8i71ph127bfq`, redirect
  `http://localhost:8484/callback`), keeps tokens **in memory only**, and proxies `/api/*` to the Events API
  with the bearer token. The browser never sees a token.
- `web/` is the UI: plain ES modules with no build step and no dependencies.
  - `js/api.js` is the API client (pagination, throttling, errors).
  - `js/model.js` holds the pure logic (availability bands, time overlap, filtering).
  - `js/render.js` builds the DOM using `textContent` only.
  - `js/main.js` holds state, URL-synced filters, and actions.

### Events API operations used

| Operation | Used for |
|---|---|
| `ListSessions` (`GET /v1/events/{eventId}/sessions`) | Full catalog, every page |
| `GetSchedule` (`GET /v1/events/{eventId}/schedule`) | Reservations, favorites, and personal time for clash detection |
| `ReserveSessions` (`POST /v1/events/{eventId}/reservations`) | Reserve up to 10 sessions |
| `AssociateFavorites` (`POST /v1/events/{eventId}/favorites`) | Favorite up to 10 sessions |

## Requirements

- Python 3.9+ (standard library only, nothing to `pip install`)
- A modern browser
- An AWS Builder ID **registered for re:Invent 2026** (otherwise the API returns `403`)

## Run it

```bash
git clone https://github.com/AvinashDalvi89/reinvent-open-seat-finder.git
cd reinvent-open-seat-finder
python3 server.py
```

The app opens at **http://localhost:8484**. Click **Sign in with AWS Builder ID**, finish sign-in, and
the catalog loads.

Options:

- `python3 server.py --no-browser` doesn't open a browser tab.
- `OPEN_SEATS_PORT=8485 python3 server.py` uses another port. It must be one of the Events API's reserved
  loopback ports, 8484 to 8489.

Open the app at `localhost`, not `127.0.0.1`. The sign-in redirect is registered for the exact URL the server uses.

## Security notes

- Tokens are held only in the server process's memory. Stopping the server forgets them. **Sign out**
  revokes the refresh token.
- The server binds to `127.0.0.1` and rejects requests whose `Host` isn't `localhost`/`127.0.0.1`
  (DNS-rebinding protection).
- Every state-changing request needs a custom `X-Open-Seats` header. Another website can't send it
  without a CORS preflight, which the server never answers (CSRF protection).
- Strict Content Security Policy (`script-src 'self'`). API data is rendered with `textContent`, never `innerHTML`.

## Accessibility

The UI uses native buttons, checkboxes, and labels throughout. Availability is shown with text and an icon
as well as color. It has a skip link, visible focus rings, `aria-live` counts and status, and a modal results
dialog that takes focus. It follows `prefers-color-scheme` (light and dark) and `prefers-reduced-motion`, and
works at 320px wide and up.

## Limitations

- `seatAvailability` is a band, not an exact seat count, and it changes constantly. Use **Refresh seats**
  before reserving.
- Clash detection uses each session's listed start time and length in the event's local time (Las Vegas).
  With **Fits my schedule** on, it also allows for travel time between venues. Those travel times are
  rough estimates, not official figures. Edit them in `web/js/venues.js` if your experience on site differs.

## License

MIT
