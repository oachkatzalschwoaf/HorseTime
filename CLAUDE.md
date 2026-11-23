# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

HorseTime: time/distance calculator for carriage driving (Fahrsport: marathon and road phases A, B, D, E), built as an installable offline PWA. UI text, code comments and docs are in German; keep it that way.

Git repo on branch `main` with remote `origin` (GitHub). The user pushes manually.

## Layout

- `app/` — the PWA (deployable folder). Vanilla ES modules, no build step, no runtime dependencies, no CDN.
- `app/legacy.html` — self-contained single-file port of the old Android app "TimeTable" (min/max range split per step). It shares no code with the new app, is linked from Optionen, and links back to `./#settings`. Its header comment lists deliberate deviations from the Android original; update that list when changing its behavior.
- `tests/` — `node:test` unit tests for the pure logic.
- `tools/` — dev server, browser smoke test, icon generator (all dependency-free Node scripts).
- `konzept_formelsammlung_fahrsport_zeit_distanz_rechner.md` — spec: formulas, time-window rules, UI requirements.
- `README.md` — user-facing overview (German): features, phone install, deployment, development.

## Commands

```sh
npm run dev                 # serve app/ on http://localhost:8080  (add -- --lan for LAN; GPS/SW still need HTTPS or localhost)
npm test                    # all unit tests
node --test --test-name-pattern="Zwischenzeiten" tests/calc.test.mjs   # single test
npm run smoke               # Edge/Chrome headless via CDP: simulated run, offline reload, installability, screenshots
npm run smoke -- --out <dir>   # screenshots elsewhere (default %TEMP%/horsetime-smoke); BROWSER=<path> to pick a browser
npm run icons               # regenerate app/icons/* (PNG + SVG) from tools/make-icons.mjs
```

`npm run smoke` exits non-zero on console errors, uncaught exceptions or failed checks. Look at the screenshots after UI changes.

## Architecture (app/js)

- `calc.js` — all formulas, the time window (`phaseWindow`), split table, live stats, verdict, German formatting and input parsing. No DOM; this is what the tests cover. Rounding goes to the safe side: allowed time from speed is floored; split min times ceil, split max times floor.
- `state.js` — settings and phases in localStorage (`horsetime.*`), change events on `bus` (`settings`, `phases`, `runs`). Views re-render on these events.
- `tracker.js` — one serializable `run` object (state `ready|armed|running|finished`, GPS points, markers). It is persisted as `horsetime.run` and restored after reload; finished runs go to IndexedDB (`store.js`).
  - Distance = GPS distance + offset. Tapping "Km-Schild" snaps the distance to the nearest sign (`markerStepM`) and resets the offset.
  - Without GPS, live stats use the time and distance of the last tapped sign (`statInput`).
- `ui-plan.js`, `ui-live.js`, `ui-calc.js`, `ui-runs.js`, `ui-settings.js` — one module per tab. Markup is static in `index.html`; modules fill it. Settings controls bind generically via `data-set="<key>"`.
- `map.js` — own canvas slippy map (OSM / OpenTopoMap / custom URL / none), no Leaflet. It draws track, route, markers and position, and falls back to parent tiles or a grid when offline.
- `timeline.js` — SVG time bar showing the window, target, planned km ticks, tapped signs, now and the projection.
- `sw.js` — precaches the app shell (`ASSETS`) and caches viewed map tiles (refreshed after 7 days, stale tiles served offline).
- `window.__ht` (set in `app.js`) is the hook used by `tools/smoke.mjs`. Keep it working when refactoring.

## Rules when changing app/

- Bump `VERSION` in `app/sw.js` (and `VERSION` in `app/js/app.js`) for every change to app files. Otherwise installed clients keep the cached old version.
- Every file in `app/` must be listed in `ASSETS` in `sw.js`. `tests/gpx-sw.test.mjs` enforces this.
- Keep it offline-capable: no external scripts, fonts or styles. Only map tiles come from the network.
- Phone use needs HTTPS (geolocation, service worker, install). Deploy the `app/` folder to any static HTTPS host.
