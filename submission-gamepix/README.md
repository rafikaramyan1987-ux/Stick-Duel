# Topple Duel — GamePix submission

| File | What |
|---|---|
| `topple-duel-gamepix-v2.zip` | the GamePix build (v1 kept for reference). The game assigns the legacy `GamePix.soundOff` / `soundOn` / `pause` / `resume` handlers and reads `GamePix.lang()` once at boot, before `loaded()`. Built (`npm run build:gamepix && npm run submission:gamepix`), `index.html` at the zip root, GamePix SDK v3 (manual lifecycle), checked by `scripts/check-gamepix-zip.mjs` |
| `icon-256x256.jpg`, `cover-1360x850.jpg` | icon and cover (`scripts/media.mjs`) |
| `description.txt` | description (339 characters) |
| `how-to-play.txt` | how to play (490 characters) |
