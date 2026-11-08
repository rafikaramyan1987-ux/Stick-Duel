# CrazyGames checklist — self-check

Each item, where it lives in the code, and the automated check that proves it. Run everything with
`npm run check && npm run build && npm run check:build && npm run test:e2e`.

| Requirement | Status | Where | Verified by |
|---|---|---|---|
| SDK v3 loaded only in the CrazyGames build | ✅ | `vite.config.ts` injects `crazygames-sdk-v3.js` in `<head>` for `--mode crazygames`; the Pages build has no external request | `scripts/check-build.mjs` (CI, both builds) |
| `loadingStart` / `loadingStop` around boot | ✅ | `src/main.ts`: SDK `init` → `loadingStart` → save loaded, fonts ready, app built → `loadingStop` | e2e `crazygames.spec.ts`: calls are exactly `init, loadingStart, loadingStop` on load |
| `gameplayStart` / `gameplayStop` around real play only | ✅ | `GameplayTracker` (`src/platform/ads.ts`) never sends duplicates. Start on "Fight!", resume and revive. Stop on pause, tab hidden, duel end / result, menus, before every ad | e2e: nothing during menus/intro; start on Fight; stop on pause; start on resume; stop at the result; never twice in a row. Unit: `GameplayTracker` |
| `happytime` on a real win moment | ✅ | `App.result()`: when a boss is beaten (world cleared) | e2e: beating the forest boss sends `happytime` |
| Midgame ads only at natural breaks | ✅ | `App.breakThen()`: when leaving a win / defeat screen, before the next level; throttled to 1 per 2 min; never during a duel | Unit: `MidgameThrottle` |
| Rewarded ads optional, never blocking | ✅ | `CrazyGamesPlatform.request()` settles exactly once: `adFinished` → reward; `adError`, `requestAd` throwing, or no `adStarted` within 8 s → no reward, the game continues. `onAdPause(false)` on every exit. Buttons (`App.adButton`) are disabled while waiting; on failure they show "No ad available right now, try later" for 2.5 s, then come back | Unit (fake timers): throw, 8 s timeout, late/duplicate callbacks ignored, long ads not cut. e2e: button disabled → 8 s → message → 2.5 s → re-enabled; error case; finished ad grants the reward |
| Audio muted during ads | ✅ | `onAdPause(true/false)` → `App.onAdPause` mutes and pauses | Unit: pause/unpause hook order |
| SDK mute setting respected | ✅ | `game.settings.muteAudio` + `addSettingsChangeListener` → `audio.setMuted`; wins over the in-game toggles | Unit (listener); e2e: `muteAudio: true` → `platformMuted()` |
| Saves with the Data Module, localStorage fallback | ✅ | `setStorageBackend(platform.storage())` in `src/main.ts`; `src/platform/storage.ts` falls back to localStorage, then memory | e2e: the save lands in `SDK.data`, not in localStorage. Unit: round-trip, corrupt data, storage errors |
| No external links, logins or popups | ✅ | no `<a href>`, no `window.open`, no account system | `scripts/check-build.mjs` scans the built HTML; e2e asserts no request leaves localhost |
| Single `index.html`, < 50 MB | ✅ | `vite-plugin-singlefile`; ~0.5 MB | `scripts/check-build.mjs` (size + single file, CI) |
| Works on desktop and mobile, portrait and landscape | ✅ | camera fits both fighters; HUD adapts | Playwright projects: desktop 1280×720 and phone 390×844; tip layout at 1280×720, 375×667, 667×375 |
| Child-friendly content | ✅ | no blood; sparks, stars, comic numbers; birds are never harmed | — |
| Languages | ✅ | EN + FR, auto-detected from the SDK / browser, switchable | Unit: every key in both languages |
| Covers 1920×1080, 800×1200, 800×800 (title only, top-left clear) | ✅ | `scripts/covers.mjs` → `submission/covers/` | rendered from a real duel; bubbles and bonuses hidden |
| Trailers 15–20 s, no sound, landscape + portrait | ✅ | `scripts/videos.mjs` → `submission/videos/trailer-1920x1080.mp4`, `trailer-1080x1620.mp4` | ffprobe: 1920×1080 and 1080×1620, ~18.7 s, no audio stream |
