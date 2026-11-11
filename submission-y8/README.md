# Stick Duel — Y8 submission

- **App ID:** `6af4b1f4ca1c6869a74e0a2f` · **Game ID:** `292551` (already in the build)
- **Hosting:** direct upload of the zip. Stick Duel is a single-player game (plus 2 players on one device), so per
  docs.y8.com/studio/iframe-game-hosting it is uploaded to Y8, not iframe-hosted.

## Which file goes in which Y8 slot

| Y8 tab → slot | File (in this folder) | Spec (checked by `scripts/y8/check.mjs`) |
|---|---|---|
| **Builds** → upload build | `stick-duel-y8-v1.zip` | `index.html` at the zip root (a single file, everything inlined), relative paths only, ~190 KB |
| **Media** → Standard Screenshot (4:3) | `media/screenshot-760x570-1.jpg` … `media/screenshot-760x570-4.jpg` | 760x570 JPG, < 2 MB |
| **Media** → Widescreen Screenshot (16:9) | `media/screenshot-1280x720-1.jpg` … `media/screenshot-1280x720-4.jpg` | 1280x720 JPG, < 5 MB |
| **Media** → Landscape Promo | `media/promo-landscape-1920x1080.jpg` | 1920x1080 JPG, < 5 MB |
| **Media** → Portrait Promo | `media/promo-portrait-1080x1920.jpg` | 1080x1920 JPG, < 5 MB |
| **Media** → Game Card Promo | `media/promo-card-760x570.jpg` | 760x570 JPG, < 2 MB |
| **Media** → Gameplay video (16:9) | `media/gameplay-1280x720.mp4` | H.264 MP4 1280x720, 26 s, < 50 MB |
| **Media** → Gameplay video 4:3 (optional) | `media/gameplay-960x720.mp4` | H.264 MP4 960x720, the same take, < 50 MB |

Screenshots (the same four moments at both sizes, all real gameplay, no menus or title screen):
1. Castle Ramparts boss (Sir Ironclad): dragging back to aim, the dotted aim line and the power arc
2. Windy Peaks: an arrow in flight across the valley
3. Sunscorch Desert boss (The Sand King): the headshot knockout in the slow-motion kill cam
4. Frostbite Lake: a bomb blast on the Snow Yeti's ice block

Promos: the game's cover scene (castle boss, the hero's arrow about to land; the same scene as `submission/covers/`)
with the game logo, rendered at 1920x1080, 1080x1920 and 760x570.

Video: one continuous, unedited take of real play with no intro, menus or sound, at the real game speed: the
Sunscorch Desert boss fight. TAKE The 960x720 file is the same take for the 4:3 slot: the 16:9 picture scaled to
960x540 over a blurred fill of itself (a 4:3 crop would cut off the fighters and the HUD).

## Basic info (ready to paste)

**Game name**
```
Stick Duel
```

**Short description / tagline**
```
Drag back, release, bonk! Turn-based physics duels with floppy stick figures.
```

**Description** (1059 characters)
```
Drag back, release, bonk! Stick Duel is a turn-based physics duel with floppy stick-figure ragdolls. Fire arrows, throw axes, spears, bombs and boomerangs or cast a magic staff at your rival: every hit makes the ragdoll flop and stagger, headshots knock hats off, and the final blow plays in a slow-motion kill cam. Read the wind, pop floating balloons and crates for coins and power-ups (fire arrows, triple shots, shields, hearts), or knock a weakened rival right off the platform.

Adventure: 6 worlds with 10 levels each - Whispering Forest, Castle Ramparts, Windy Peaks, Sunscorch Desert, Frostbite Lake and Magma Mountain - each with its own obstacles, enemies and a boss with a special weapon. Earn up to 3 stars per level, open the daily chest, complete daily missions and spend your coins on weapons, 15 hats and 12 colours.

Also: Endless mode (how many waves can you beat?) and 2-player duels on the same device. A short guided tutorial gets new players started. No blood, just sparks, stars and comic word bubbles. Progress is saved automatically.
```

**Instructions** (445 characters)
```
Mouse / touch: drag back anywhere and release to shoot - the dotted line shows your aim, the arc around your fighter shows the power. Tap a weapon in the bottom corner to switch. Tap during the slow-motion kill cam to skip it.
Keyboard: Up / Down to aim, Left / Right for power, Space or Enter to fire, 1-6 to pick a weapon, P or Esc to pause.
Goal: knock out your rival before they knock you out. Fewer shots and less damage taken = more stars.
```

**Category:** Action (alternatives: Shooting, Skill). **Tags**
```
stickman, archery, bow, physics, ragdoll, turn based, duel, 2 player, boss, shooting, casual, html5
```

**Supported platforms:** Desktop and mobile browsers (Windows, macOS, Linux, Android, iOS): mouse, keyboard and
touch. **Orientation:** landscape and portrait (the game fills any frame). **Suggested size:** 1280x720 (16:9; any
size works).

**Languages:** English (default) and French (Settings → language; also follows the browser language).

**Multiplayer:** No online play; 2 players on the same device. **Login:** not required, guests play everything.
**In-app purchases:** none.

## Ads in this build (Y8 SDK)

- The SDK loads only from Y8's CDN (`<script src="https://cdn.y8.com/minimal-sdk/2-0/y8.min.js" async>` in
  `<head>`) and is never bundled. It is initialized exactly as the portal snippet: a `y8sdk.ready` listener (once)
  calls `y8.sdk()`, then `init({ appId, autoLogin: true }, { gameId, preloadAdBreaks: 'on', sound: 'on', onReady })`,
  then `onAuth`, and `window.y8.emitReadyEvent()` covers an SDK that loaded first. Guests always play. No ad call
  before init.
- Interstitials: `showAd({ type: 'start' })` on the player's first Play / 2 Players / Endless click, and
  `showAd({ type: 'next' })` on Next / Retry / Map / Menu / Rematch of a result screen. Never automatic, never during
  a duel, and no cap of the game's own (the SDK paces them). A break that shows no ad continues at once.
- The game pauses and mutes in `beforeAd`, and resumes and restores the player's sound / music settings in `afterAd`.
  `adBreakDone` settles each request; `.catch()` and a timeout also settle it, exactly once, so the game never gets
  stuck.
- Rewarded (`type: 'reward'`): only from the optional buttons that name the reward first ("▶ Try the axe for this
  duel", "▶ Double coins", "▶ Revive & keep fighting"). `beforeReward` calls `showAdFn()`, the reward is granted only
  in `adViewed`; `adDismissed` or no ad means no reward and the button says "No ad available right now, try later",
  and the game goes on. Nothing essential is behind an ad.
- The game also pauses and mutes when the tab is hidden (`visibilitychange`) or the window loses focus (`blur`),
  and resumes when the player comes back.
- No other ad network, no external links, no "More games". Saves stay in localStorage (`stick-duel.save.v1`). With an
  ad blocker the game is fully playable and the rewarded buttons are hidden.

## Rebuild

```sh
npm ci
npm run submission:y8        # vite --mode y8 → dist-y8/ → stick-duel-y8-v1.zip + checks (zip and media)
npm run test:e2e:y8          # Playwright smoke test of dist-y8 with a stubbed Y8 SDK
npm run build && npm run media:y8   # screenshots, promos and the gameplay take (needs ImageMagick + ffmpeg)
```
