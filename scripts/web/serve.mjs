// A minimal static server for the open-portal web build, like a portal's file host: the game's files under /game/,
// and at / a host page that shows the game in an iframe (?w=&h= iframe size, ?q= query string for the game).
import { readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.webm': 'video/webm', '.mp4': 'video/mp4', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.txt': 'text/plain', '.xml': 'application/xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

/** serve `dir` on 127.0.0.1 (random port); resolves to the server with `.origin` */
export async function serve(dir) {
  const server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/') {
      const w = +u.searchParams.get('w') || 960, h = +u.searchParams.get('h') || 600;
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#333}iframe{display:block;border:0;margin:20px}</style></head>
<body><iframe id="f" width="${w}" height="${h}" src="/game/index.html${u.searchParams.get('q') ?? ''}" allow="fullscreen; autoplay; gamepad" allowfullscreen></iframe></body></html>`);
    }
    const p = normalize(decodeURIComponent(u.pathname.replace(/^\/game\//, '')));
    if (!u.pathname.startsWith('/game/') || p.startsWith('..')) return res.writeHead(404).end();
    try {
      let f = join(dir, p);
      if (statSync(f).isDirectory()) f = join(f, 'index.html');
      const body = readFileSync(f);
      res.writeHead(200, { 'content-type': TYPES[extname(f).toLowerCase()] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  server.origin = `http://127.0.0.1:${server.address().port}`;
  return server;
}
