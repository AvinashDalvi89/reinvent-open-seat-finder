# Open Seats: stop clicking "Full" in the re:Invent catalog

*Built for the re:Invent Catalog API Builder Challenge, using the new re:Invent Events API.*

## The problem

Every re:Invent, I do the same thing: open the catalog, find a session that looks great, click it, and see
**Full**. Then the next one. The catalog shows every session whether you can get in or not, and there's no
filter for "has seats left" or "fits around what I've already booked." With thousands of sessions, filling
the gaps in your week takes hours of clicking.

## What I built

**Open Seats** is a small local web app that answers one question: *which sessions can I still get into,
in the time I have free?*

1. **Sign in with AWS Builder ID.** The app uses the Events API's OAuth 2.0 + PKCE flow from a local server.
   No secrets, and tokens never leave your machine.
2. **The whole catalog loads,** every page of `ListSessions`, with a progress bar.
3. **Only open sessions show by default.** Each session carries a `seatAvailability` band (`available`,
   `limited`, `veryLimited`, `unavailable`, `walkUp`), shown as *Open*, *Filling up*, *Last seats*, *Full*,
   and *Walk-up only*, with live counts for each.
4. **"Only sessions that fit my schedule"** reads `GetSchedule` (your reservations and personal time) and
   hides anything that overlaps. Pick a day and your reservations appear in the list, so the gaps are obvious.
5. **Pick up to 10 and reserve them in one click** (`ReserveSessions`), or add them as favorites
   (`AssociateFavorites`). The result dialog lists each session: reserved, full, clashes with *X*,
   or already on your schedule.
6. **Every session links to the official re:Invent catalog,** so you can check details or book there.

<!-- Add 2-3 screenshots here: the filtered list, a day view with your reservations, the results dialog. -->

## How it uses the Events API

| Operation | Why |
|---|---|
| `ListSessions` | Pulls the full catalog. The API has no server-side filter, so Open Seats filters on the client. It follows `nextToken` until it's absent, because a short page is not the last page. |
| `GetSchedule` | Reservations and personal time feed the clash detector. |
| `ReserveSessions` | Reserves up to 10 sessions. A `200` can still carry per-session failures, so the app reads `failed[].code` and `conflictsWith` and tells you exactly what happened. |
| `AssociateFavorites` | Saves sessions you're interested in but don't want to reserve yet. |

Design choices that came straight from the API docs:

- **Never auto-retry a reservation.** Re-sending makes the already-reserved sessions fail with `alreadyScheduled`, so
  the app reports and lets you decide.
- **Honor `Retry-After` on `429`** for reads, and refresh the token **once** on `401` before asking you to sign in again.
- **Treat unknown failure codes as refusals,** because the API adds new codes over time.

## Architecture

```
Browser (vanilla ES modules)  ──►  server.py (Python stdlib, localhost:8484)  ──►  api.awsevents.com/v1
                                        └── OAuth 2.0 + PKCE ──►  oauth.awsevents.com (Builder ID)
```

- **No dependencies, no build step:** `python3 server.py` and you're running.
- **Security:** tokens stay in server memory only, Host-header checks block DNS rebinding, a custom-header check
  blocks CSRF, a strict CSP is set, and API data is rendered with `textContent` only.
- **Accessibility:** native controls, availability shown with text and icons as well as color, keyboard-first,
  light and dark themes, and reduced-motion support.

## Try it

```bash
git clone https://github.com/AvinashDalvi89/reinvent-open-seat-finder
cd reinvent-open-seat-finder
python3 server.py
```

Code: **https://github.com/AvinashDalvi89/reinvent-open-seat-finder**

## What's next

- Use the venue and walking time when checking whether two back-to-back sessions fit.
- A "watch" mode that polls a favorited full session and alerts you when it moves off *Full*.
- An MCP prompt, so an assistant can run "fill my Tuesday afternoon with open 300-level AI sessions" using the same logic.
