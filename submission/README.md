# Topple Duel — CrazyGames submission

| File | What |
|---|---|
| `topple-duel-v1.zip` | the CrazyGames build (`npm run build:crazygames && npm run submission`): unzips to `topple-duel-v1/index.html`, a single file with the CrazyGames SDK v3 |
| `covers/cover-1920x1080.jpg`, `cover-800x1200.jpg`, `cover-800x800.jpg` | covers with the title "Topple Duel", top-left corner left clear |
| `videos/trailer-1920x1080.mp4`, `trailer-1080x1920.mp4` | ~18 s trailers from real play: the first frame is the cover, a chain reaction in the first 3 s |

Covers and trailers are made from real gameplay by `scripts/media.mjs` (every shot is a solution proven by
the level checker). SDK integration: see the main README.
