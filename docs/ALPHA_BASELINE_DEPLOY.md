# Alpha baseline: build and public test

This branch keeps the authoritative Node/WebSocket server. Cloudflare Tunnel is only the public HTTPS/WSS ingress; it does **not** host the Node process.

## Build and verify

Requirements: Node.js 20+ and npm.

```bash
npm ci
npm run typecheck
npm run build -w client
npm run build -w server
npm run smoke
```

The smoke test launches the real server, checks that a fresh lobby is empty, then exercises two WebSocket clients through room creation, joining, readiness, game start, economy, movement and disconnect/game-over.

## Run locally

```bash
npm run start -w server
```

If port 8080 is already occupied, choose another port (macOS/Linux):

```bash
PORT=8081 npm run start -w server
```

The browser client served by this Node process will automatically use the same port for WebSocket.

The production server serves `client/dist` and WebSocket traffic on port 8080 by default. Set `PORT` to override it. The built client uses the same origin for WebSocket, so a custom port works for both HTTP and WebSocket.

## Expose a temporary public URL with Cloudflare Tunnel

Install `cloudflared` on the same machine that runs the server. In a second terminal:

```bash
cloudflared tunnel --url http://127.0.0.1:8080
```

When using port 8081 instead:

```bash
cloudflared tunnel --url http://127.0.0.1:8081
```

To run the two-client smoke test on that same non-default port, use `PORT=8081 npm run smoke` (the test starts and probes the server on that port).

Cloudflare prints a temporary `https://….trycloudflare.com` URL. Open it from two separate browsers/devices and complete a real match. Keep both the Node server and tunnel processes running.

## Alpha acceptance checklist

- [ ] GitHub Actions baseline workflow passes.
- [ ] Local `npm run smoke` passes.
- [ ] Production server returns the built game at `/`.
- [ ] Public HTTPS URL loads the game.
- [ ] Two independent clients connect over WSS, create/join a room, start and finish a match.
- [ ] Restart behavior and in-memory room reset are understood.

## Important limitations

- Quick Tunnel URLs are temporary and change between runs.
- The game state and rooms live in server memory; restarting the Node process clears active matches.
- This is a low-cost public Alpha path, not a 24/7 managed hosting deployment. For always-on hosting, move the Node process to a persistent host and keep Cloudflare Tunnel in front.
- The repository's MIT code license does not by itself establish commercial rights for every bundled image, sprite, sound, font or other asset. Keep commercial launch gated on asset provenance review.
