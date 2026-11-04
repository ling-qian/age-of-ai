# Cloudflare Containers deployment (Alpha)

This deployment runs the existing Node.js authoritative game server inside a Cloudflare Container. A Worker and one globally named Durable Object route all HTTP and WebSocket requests to the same container instance.

## Important architecture constraints

- The current lobby, rooms, players and matches live in Node.js process memory.
- Keep `max_instances: 1` and the fixed Durable Object name `age-of-ai-global`. Do not scale this Alpha horizontally: players routed to separate processes would see different lobbies.
- Container disk is ephemeral and process restarts clear in-memory rooms/matches. No permanent account, match or save data is introduced by this migration.
- This replaces the Mac + cloudflared runtime only after the cloud deployment and two-client WSS test pass.
- Cloudflare Containers requires a Workers Paid plan and is billed according to current Cloudflare pricing. Check the account dashboard/pricing before deployment.

## Prerequisites

1. A Cloudflare account with Workers Paid enabled.
2. `qianling-tech.top` added to that Cloudflare account and active on Cloudflare DNS.
3. Node.js 20+ and npm on the deployment machine.
4. Docker-compatible local container engine for local container development/build checks.

## Build and local checks

From the repository root:

```bash
npm ci
npm run typecheck
npm run build -w client
npm run build -w server
npm run smoke
```

Build the production image locally:

```bash
docker build -t age-of-ai-cloud:alpha .
docker run --rm -p 8080:8080 age-of-ai-cloud:alpha
curl -i http://127.0.0.1:8080/healthz
```

## Authenticate and deploy

Use the Cloudflare account that owns `qianling-tech.top`:

```bash
npx wrangler@latest login
npx wrangler@latest whoami
npx wrangler@latest deploy --config wrangler.jsonc
```

The first deploy creates the Worker and its Container/Durable Object resources. Do not point the production custom domain at it until the generated `workers.dev` endpoint passes the checks below.

## Verify the workers.dev endpoint

Replace the placeholder with the URL Wrangler prints:

```bash
curl -i https://age-of-ai-cloud.<your-subdomain>.workers.dev/healthz
curl -i https://age-of-ai-cloud.<your-subdomain>.workers.dev/status
```

Open the workers.dev URL in two separate browsers/devices. Verify both players can create/join the same room, ready up, start a match, move units, gather resources, train units and observe disconnect/game-over behavior. In browser DevTools > Network > WS, confirm the WebSocket connection succeeds (HTTP 101 / open WSS).

## Attach the custom domain

Only after the workers.dev test passes:

1. In Cloudflare Workers & Pages, open Worker `age-of-ai-cloud`.
2. Add Custom Domain `game.qianling-tech.top`.
3. Wait for Cloudflare to provision DNS and TLS.
4. Check `https://game.qianling-tech.top/healthz` and repeat the two-client WSS test.
5. Remove or disable the old DNS record / Tunnel route only after the custom domain is confirmed to target the Worker.

Do not keep a conflicting CNAME/A record pointing at the old Quick/Named Tunnel when attaching the Worker custom domain. Cloudflare's Custom Domain setup should manage the record.

## Rollback

If the new Worker fails verification, restore the prior DNS/Tunnel route and keep the Mac server available until the rollback is confirmed. Do not delete the old Tunnel before the new cloud deployment is accepted.

## Not included in this Alpha

No database, accounts, permanent saves, matchmaking shards, multi-container scaling or automatic game-state recovery. Those require a separate design because the current server keeps authoritative state in memory.
