# One Less — build plan

A local-only drink tracker. The user logs each day as dry or as a set of drinks,
sees a month calendar, watches a dry-day streak and a weekly budget, and can
share a short encouraging message with friends and family.

**Every decision below was confirmed with the owner. Do not re-litigate them.**
If something genuinely can't be built as specified, build everything else and
say what you left out and why.

---

## 1. Stack and conventions

Mirror `C:\Users\jhenn\Sightwords Training` and `C:\Users\jhenn\Boys Pushup Bonzana`.
**Read both before starting** — especially Sight Words' `style.css` (CSS custom
property setup, card/button/screen patterns), `index.html` (screen-section
structure), and `app.js` (state object, localStorage layer, screen routing,
toast). Reuse their idioms so this repo feels like a sibling.

- Vanilla JS, **no build step, no framework, no dependencies, no bundler.**
- PWA: `manifest.json` + `sw.js` app-shell cache.
- Mobile-first, `max-width: 640px` centred, safe-area insets.
- Local preview: `node scripts/static-server.js` on **port 8091**, plus
  `.claude/launch.json` naming the config `one-less`.
- Bump `sw.js`'s `CACHE_NAME` (`ol-shell-v1`, `-v2`, …) on every shipped change.

### CRITICAL: no backend

This app has **no Cloudflare Worker, no `data.json`, no `WORKER_URL`, no
`APP_KEY`, and makes no network requests of any kind at runtime.** Do not copy
the sync layer, the pending-write queue, or the leaderboard code from the other
two repos. All data lives in `localStorage` on the device. This is the whole
privacy premise of the app — if you find yourself writing `fetch()`, stop.

The only outbound thing that ever happens is `navigator.share()`, which hands a
string the user has already seen to the OS share sheet.

## 2. Files to create

```
index.html
style.css
app.js
manifest.json
sw.js
README.md
CLAUDE.md
.gitignore
.nojekyll
icons/icon-192.png
icons/icon-512.png
icons/apple-touch-icon.png
scripts/static-server.js
scripts/generate-icons.cjs
.claude/launch.json
```

`scripts/static-server.js` — copy from Sight Words, change the port to 8091.

`scripts/generate-icons.cjs` — adapt from
`Boys Pushup Bonzana/scripts/generate-icons.cjs` (zero-dependency PNG writer
using Node's built-in `zlib`). Draw a **water drop** in the accent pine
`#4F6B5C` on the linen background `#F4F1EB`, rounded-rect canvas. Run it to
produce the three PNGs.

`CLAUDE.md` — same house rules as the sibling repos, minus everything about the
Worker and `data.json`:

```markdown
# Working conventions for this repo

- **Minimize dialogue.** Keep responses terse — critical messages and summaries only, no play-by-play narration.
- Before any preview check: unregister service workers + clear caches, then reload.
- Bump `sw.js`'s `CACHE_NAME` on every shipped change.
- This app is local-only by design: no backend, no network calls, no analytics. Never add a sync layer, a Worker, or any `fetch()` to a remote host — all data stays in `localStorage` on the device.
```

## 3. Look and feel

Scandi restraint, adult, calm. Sight Words' structure and spacing, a colder and
more grown-up surface.

### Single theme — "Linen and ink", light only

**There is no dark mode.** No theme toggle, no `data-theme` attribute, no
`prefers-color-scheme` handling. One palette.

```css
:root {
  --bg: #F4F1EB;
  --surface: #FBF9F5;
  --surface-2: #EFEBE3;
  --ink: #2E2E2B;
  --ink-dim: #7A776F;
  --border: #E2DCD1;

  --accent: #4F6B5C;        /* pine — dry days, streaks, primary actions */
  --accent-soft: #E6EDE7;   /* dry-day tile fill */
  --drink: #B57F63;         /* terracotta — drink days */
  --drink-soft: #F0E2D8;    /* drink-day tile fill */
  --alert: #A85A4A;         /* over-budget only */
  --alert-soft: #EBD4CC;

  --shadow: 0 8px 24px rgba(60, 50, 35, 0.08);
  --radius: 18px;
  --radius-sm: 12px;
}
```

Type: **Inter** (600/500/400) via Google Fonts, not Nunito — same softness
without the roundness that reads as childlike. Numbers in stat tiles are the
only large type.

**Drink days are never red.** Dry days get pine, drink days get terracotta, and
`--alert` appears *only* when the weekly budget is exceeded. A tracker that
scolds you in red for a glass of wine is one you stop opening.

## 4. Data model

One `localStorage` key, `ol-data`, holding the whole document. The export file
is byte-identical to this, so backup/restore is trivial.

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

- Key **absent** from `days` = **unlogged**.
- `"drinks": []` = **explicitly logged dry**.
- That distinction is load-bearing for every streak calculation. Never
  conflate them, and never write `drinks: []` implicitly.
- Dates are local-time `YYYY-MM-DD`. Build them from local date parts, never
  `toISOString()` — that silently shifts the day across the UTC boundary and
  will corrupt streaks for anyone west of Greenwich.
- `startedOn` is set once on first launch and bounds the catch-up nudge.
- One icon = **one drink**, counted as poured. No standard-unit conversion.

### Drink types

```js
const DRY = { id: "dry", emoji: "💧", label: "Dry day" };
const DRINK_TYPES = [
  { id: "wine",     emoji: "🍷", label: "Wine" },
  { id: "beer",     emoji: "🍺", label: "Beer" },
  { id: "cocktail", emoji: "🍸", label: "Cocktail" },
  { id: "spirits",  emoji: "🥃", label: "Spirits" },
  { id: "bubbles",  emoji: "🥂", label: "Bubbles" },
  { id: "other",    emoji: "🍹", label: "Other" },
];
```

## 5. Screens

Screen-section pattern from Sight Words: `<section class="screen">` toggled with
`.active`.

### 5a. Welcome (first launch only)

Shown once, gated on `onboarded`. Reachable again from Settings → "About".

- Large 💧 hero, title **One Less**.
- A short paragraph, roughly: this app helps you see your drinking clearly so
  you can bring it down. Everything you log stays on this device — no account,
  no server, nothing leaves your phone. When you want support, you can share a
  short message with people you trust; only the message goes, never your data.
- **A distinct, visually prominent note** (not a footnote): *Add this to your
  home screen.* On iPhone, a page kept only as a Safari tab can have its
  storage cleared after about a week of not being opened; installed to the home
  screen it's kept. Give the literal steps — Share → Add to Home Screen.
- Also mention Settings → Back up, one line.
- Button: "Get started".

### 5b. Home — the main screen

Top to bottom:

1. **Stat strip** — three tiles, always visible:
   - 🔥 **Dry streak** — current consecutive dry days; "longest: N" beneath.
   - 🎯 **This week** — "3 of 7" plus a slim progress bar. Bar uses `--accent`;
     switches to `--alert` only once the budget is exceeded.
   - 📊 **This month** — total drinks, with ▼/▲ and the delta vs. the same
     day-of-month last month. Down is `--accent`, up is `--ink-dim` (not red).
2. **Catch-up banner**, only when unlogged past days exist (see §6).
3. **Month calendar** — the centrepiece.
   - Header: month + year, with ‹ › arrows; › disabled in the current month.
   - Monday-first, `M T W T F S S` labels.
   - 7-column grid of square tiles. A tile shows the day number, and:
     - unlogged past day → empty, `--surface` fill, hairline border
     - dry → 💧 on `--accent-soft`
     - drinks → the emoji of the **largest-count** type on `--drink-soft`, with
       a small count badge for the day's total when total > 1. Ties break by
       `DRINK_TYPES` order.
     - over-budget days do **not** get special tile treatment; the budget is
       weekly and lives in the stat tile.
     - future day → dashed border, no fill, not tappable
     - today → a visible ring in `--accent`
   - **Swipe left/right** changes month, with touch handlers on the grid.
     Horizontal-intent detection so vertical page scrolling still works. Arrows
     do the same thing for desktop and accessibility.
   - Back navigation is unlimited; **forward stops at the current month.**
4. **More stats**, below the calendar:
   - Dry days this month / this year
   - 7-day rolling average, with a small trend line over the last 30 days
   - **Last 6 months as a bar chart** — the real "am I actually reducing"
     answer. Mark the current month as partial.
   - Longest dry streak ever
   - Build these as inline SVG or CSS bars. **No charting library.**
5. **Share button** and a settings ⚙ entry.

**Explicitly not included:** a "drinks avoided" / baseline stat. The owner
declined it. Do not add it.

### 5c. Day editor (bottom sheet)

Opened by tapping any past-or-today tile that isn't already a plain dry toggle
(see §7). Contains:

- The date as a heading.
- A **row of type chips** (the six above). Tapping a chip adds one of that type.
- For each type already present, a row with emoji, label, and a **− / count / +**
  stepper. Dropping to 0 removes the row.
- A running "N drinks" total.
- Buttons: **Mark dry** (clears all drinks, logs `[]`), **Clear** (removes the
  day entirely, back to unlogged), **Done**.
- Dismiss by tapping the backdrop or swiping down.

## 6. Stats — exact definitions

Get these exactly right; they're the whole product.

**Dry streak.** Walk backwards from today. Today is *in progress*: if today is
unlogged, start from yesterday and do not break. Then, going back day by day,
count each day where `days[d].drinks` exists and is empty. Stop at the first day
that is either logged with ≥1 drink **or unlogged**. An unlogged past day breaks
the streak — silence is not success.

**Longest streak.** Same rule applied across all history.

**This week.** Total drinks in the current **Monday-start** week. Budget is
`settings.weeklyBudget`, default **7**, editable in Settings.

**This month.** Total drinks in the current calendar month. Compare against the
same day-of-month window in the previous month, so a delta on the 8th compares
1–8 with 1–8, not 1–8 with a whole month.

**Dry days.** Count of explicit `drinks: []` days in the period.

**7-day rolling average.** Total drinks over the trailing 7 days ÷ 7, one
decimal.

**Catch-up nudge.** On load, collect unlogged days from `max(startedOn, 60 days
ago)` through **yesterday** (today is never nagged about). If any exist, show a
banner: "3 days need logging" with a "Log them" action that opens the day editor
on the earliest and advances through them. Dismissible for the session. Never
auto-fill a day — the user's silence is not data.

## 7. Interaction model

Confirmed as option "C", and **structured so the alternative can be swapped in
later without a rewrite** — keep the tile-tap behaviour in one clearly named
function.

- **Tap a past-or-today tile that is unlogged or dry** → toggles 💧 dry ⇄
  unlogged. One tap, zero friction, because this is the most common action.
- **Tap a tile that already has drinks** → opens the day editor.
- **A dedicated "+" affordance** on each tile (or long-press, your call — pick
  the more discoverable) opens the editor for a day that's currently
  unlogged/dry. The point is that logging drinks never requires a hidden
  gesture.
- Future tiles are inert.

## 8. Share

Copy the rotating-template-pool pattern from Push Up
(`SHARE_MESSAGES_*`, `pickLeaderboardTemplate`'s no-repeat guard,
`navigator.share` with a `navigator.clipboard` + toast fallback).

- Content: **that day's status** (drink count, or drink-free), **current
  streak**, and **dry days this month**.
- **Two pools, mixed and rotating**: warm-and-plain, and light-humour. The
  humour is self-deprecating and never jokes about drinking itself — the joke
  is about good sleep, saved money, being insufferable about herbal tea. Write
  **12–16 per pool.** Never repeat the previous message.
- Pick the pool by context: a day with drinks logged, or a broken streak, gets a
  **plain** message. Do not hand someone a punchline on a bad day.
- The message must never shame. There is no "only 3 drinks today" framing.
- **Include the app URL by default**, with a Settings toggle
  (`settings.shareIncludeUrl`) to drop it.
- **Manual only.** Nothing is ever auto-shared, and the OS share sheet lets the
  user edit before sending.

## 9. Settings

- **Weekly drink budget** — number input, default 7.
- **Include app link in shares** — toggle, default on.
- **Back up your data** — writes `one-less-backup-YYYY-MM-DD.json` via a Blob +
  object URL download. On iOS this lands in Files; mention that.
- **Restore from backup** — `<input type="file">`, parse, **validate the shape
  and `v`**, confirm before overwriting, then reload. A malformed file must fail
  loudly and leave existing data untouched.
- **About** — re-shows the welcome text, including the home-screen note.
- **Delete all data** — two-step confirm, in a danger block styled like Sight
  Words' `.settings-danger`.

## 10. README

Model it on Sight Words' README, but it is much shorter — there is no token, no
Worker, no secrets. Cover: what the app is; that all data is local and the repo
holds no personal data; enabling GitHub Pages; **why the repo must be public**
(Pages from a private repo needs a paid plan) and why that's harmless here;
add-to-home-screen steps and the iOS storage-eviction reason; backup/restore;
local preview via `node scripts/static-server.js`.

## 11. Git

`gh` is authenticated as **heee** with `repo` scope; `git` 2.55 and Node 24 are
available.

1. `git init`, `.gitignore` (`node_modules`, `.DS_Store`, `.claude/settings.local.json`).
2. Commit everything on `main`.
3. Create **public** repo `heee/one-less` via `gh repo create` and push.
4. Enable GitHub Pages from `main` / root. Include `.nojekyll`.
5. Report the live URL: `https://heee.github.io/one-less/`.

Commit messages end with:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

## 12. Verify before reporting done

Run the app (`node scripts/static-server.js`, port 8091) and actually check, at
a mobile viewport:

- Welcome screen shows on first load; not again after "Get started".
- Tap an empty tile → 💧. Tap again → empty. Streak tile updates live.
- Open the editor, add 2 wine + 1 beer → tile shows 🍷 with a "3" badge; week
  and month tiles update.
- Swipe left/right changes month; forward is blocked in the current month.
- Future tiles are dashed and inert.
- Reload → everything persists.
- Share produces a sensible, non-shaming message with the URL, and a different
  one on the next tap.
- Export downloads a JSON file; delete all data; import it back; state returns.
- No `fetch()` anywhere. No console errors.
- Nothing overflows horizontally at 375px wide.

Report honestly: if a check fails and you can't fix it, say so with the actual
symptom rather than reporting success.
