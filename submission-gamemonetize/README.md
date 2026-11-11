# Stick Duel — GameMonetize submission

- **Game ID:** `qgdkibss7nawv209v2pfh8txf4p94eas` (already in the build)
- **Upload:** `stick-duel-gamemonetize-v1.zip`: `index.html` at the zip root (a single file, everything inlined,
  relative paths only). Game Management > My games > select the game > drop the file; then "Verify Game" and
  "REQUEST ACTIVATION".
- **Images:** `stick-duel-512x384.jpg`, `stick-duel-512x512.jpg`, `stick-duel-512x340.jpg` — the game's cover scene
  (castle boss, the hero's arrow about to land; the same scene as `submission/covers/`) rendered without the title
  logo: no text, no logo, each under 300 KB.

## Form fields (ready to paste)

**Name**

```
Stick Duel
```

**Categories** (pick 2–3): Stickman, Shooting, 2 Player (if one is not in the portal's list: Action)

**Tags**

```
stickman, archery, bow, physics, ragdoll, turn based, duel, 2 player, boss, shooting, casual, mobile, html5
```

**Width / Height:** `1280` x `720` (16:9; the game fills any frame size, landscape or portrait)

**Optimized for Mobile Devices:** Yes (touch controls, landscape and portrait)

**Description** (538 / 600 characters)

```
Stick Duel is a turn-based physics duel with floppy stick-figure ragdolls. Drag back and release to fire arrows, axes, spears, bombs, boomerangs and a magic staff, mind the wind, pop bonus balloons and land headshots for a slow-motion kill cam. Adventure: 6 worlds x 10 levels (Whispering Forest, Castle Ramparts, Windy Peaks, Sunscorch Desert, Frostbite Lake, Magma Mountain), each ending in a boss, 3 stars per level. Also Endless mode and 2-player duels on one device. Daily chest, missions, 15 hats, 12 colours. No blood, just sparks.
```

**Controls** (275 / 350 characters)

```
Desktop: drag back with the mouse and release to shoot (dotted line = aim, arc = power), or arrow keys Up/Down aim, Left/Right power, Space/Enter fire, 1-6 weapon, P/Esc pause.
Mobile: drag back anywhere and release to shoot, tap a weapon to switch, tap to skip the kill cam.
```

## Ads in this build (GameMonetize SDK)

- `window.SDK_OPTIONS = { gameId, onEvent }` is set, then `https://api.gamemonetize.com/sdk.js` is inserted once
  while the game boots (`<script id="gamemonetize-sdk">` before the first script, as the SDK README's loader does),
  never from a click. If it fails to load (ad blocker, offline), the game plays on without ads.
- `SDK_GAME_PAUSE`: the game pauses and all audio is muted. `SDK_GAME_START`: the game resumes and audio comes back
  through the player's own sound / music settings. `SDK_READY`: interstitials can be shown.
- Interstitials (`sdk.showBanner()`) only at the same natural breaks as the GameDistribution build, and only after a
  player's click: the first Play / 2 Players / Endless on the title screen, and Next / Retry / Map / Menu / Rematch on
  the result screens. At most one every ~2 minutes (pre-roll included), never during a duel, never on a timer. Every
  request settles once (`SDK_GAME_START`, an error, or not started within 8 s), so the game cannot get stuck.
- **No rewarded ads:** the GameMonetize SDK has no rewarded API, so this build has no "watch an ad" buttons (try a
  weapon, ×2 coins and revive are hidden; the game is fully playable without them).
- No other ad network, no "More games" buttons, no external links, no iframes. Saves stay in localStorage
  (`stick-duel.save.v1`).

## Rebuild

```sh
npm ci
npm run submission:gamemonetize      # vite --mode gamemonetize → dist-gamemonetize/ → zip + checks
npm run test:e2e:gamemonetize        # Playwright smoke test of dist-gamemonetize with a stubbed SDK
npm run build && npm run images:gamemonetize   # the three images (cover scene, no logo)
```
