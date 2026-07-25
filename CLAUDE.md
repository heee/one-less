# Working conventions for this repo

- **Minimize dialogue.** Keep responses terse — critical messages and summaries only, no play-by-play narration.
- Before any preview check: unregister service workers + clear caches, then reload.
- Bump `sw.js`'s `CACHE_NAME` on every shipped change.
- This app is local-only by design: no backend, no network calls, no analytics. Never add a sync layer, a Worker, or any `fetch()` to a remote host — all data stays in `localStorage` on the device.
