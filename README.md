# One Less 💧

A private, local-only drink tracker. Log each day as dry or as a set of
drinks, watch a dry-day streak and a weekly budget, see a month calendar and
a few honest trend stats, and share a short encouraging message with people
you trust when you want to.

There is **no backend**. No server, no database, no account, no analytics,
no sync between devices. Every day you log lives in `localStorage` on the
one device you're using, in a single key (`ol-data`). This repository holds
no personal data — it's just the static app shell (HTML/CSS/JS); nothing in
it knows anything about anyone who uses it.

The only thing this app ever sends anywhere is a message *you* choose to
share, through the device's own share sheet (`navigator.share`) — and even
that only happens when you tap Share, never automatically.

## Why the repo is public

GitHub Pages can only be served from a private repository on a paid GitHub
plan. Making this repo public is what lets Pages host it for free. That's
harmless here specifically because the repo contains no user data — the
code is the same for everyone, and what you personally log never leaves
your device, let alone ends up in this repo.

## Using it

Open the GitHub Pages URL, tap through the welcome screen once, and start
logging days. Tap an empty calendar tile to mark it dry with one tap; tap a
day that already has drinks (or the small **+** on any tile) to open the
day editor and log specific drinks. Swipe the calendar left/right, or use
the ‹ › arrows, to move between months — you can go back as far as you
like, but forward stops at the current month.

### Add it to your home screen

On iPhone, a page kept open only as a Safari tab can have its site storage
cleared by iOS after about a week of not being opened — which would erase
your logged days. Installing to the home screen keeps it:

1. Open the site in **Safari**.
2. Tap the **Share** icon.
3. Scroll down and tap **Add to Home Screen**.
4. Launch it from the home screen icon from then on.

### Back up and restore

Settings → **Back up your data** downloads a `one-less-backup-YYYY-MM-DD.json`
file — a byte-identical copy of everything in `localStorage`. On iPhone this
lands in the Files app. Settings → **Restore from backup** reads a file back
in; it validates the shape and version first and asks you to confirm before
overwriting anything currently on the device, so a malformed or unrelated
file fails loudly instead of silently wiping your data.

## Local preview

```
node scripts/static-server.js
```

then open `http://localhost:8091`. No install step, no dependencies —
everything here is plain HTML/CSS/JS.

## Data model

Everything lives under one `localStorage` key, `ol-data`:

```json
{
  "v": 1,
  "startedOn": "2026-07-25",
  "onboarded": true,
  "days": {
    "2026-07-23": { "drinks": [] },
    "2026-07-24": { "drinks": [{ "type": "wine", "count": 2 }, { "type": "beer", "count": 1 }] }
  },
  "settings": { "weeklyBudget": 7, "shareIncludeUrl": true }
}
```

A day **absent** from `days` means unlogged. A day present with
`"drinks": []` means explicitly logged dry. Those are different things, and
the difference drives every streak and stat in the app — an unlogged past
day breaks a streak; a logged-dry day extends it.
