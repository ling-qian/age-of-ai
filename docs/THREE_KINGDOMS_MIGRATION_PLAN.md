# Three Kingdoms MVP Migration Plan

Status: M1 implementation is present on `feature/three-kingdoms-mvp`; M1 acceptance is **PENDING**. M2 is **BLOCKED** until every M1 gate below passes and the acceptance record is frozen.

## Safety rules

- Work only on `feature/three-kingdoms-mvp`, branched from `aoai/alpha-baseline`.
- Do not rewrite or delete the existing Age of AI RTS screens, simulation, WebSocket protocol, multiplayer flow, or deployment configuration.
- Keep the existing RTS playable. Three Kingdoms is an isolated game mode and route within the existing product.
- Use deterministic TypeScript rules for future Three Kingdoms battles. Story events are JSON data; no LLM is required for MVP.
- Do not claim runtime acceptance or deployment until it has actually been tested in the target environment.

## Existing architecture found

- Monorepo workspaces: `shared`, `server`, `client`.
- Client: Vite + TypeScript + custom DOM screens + Canvas 2D; it is not React/Zustand.
- Server: Node.js + TypeScript + native `ws`; authoritative real-time RTS simulation and lobby.
- Existing checks: `npm run typecheck`, `npm run build`, and `npm run smoke`.
- Existing identity/settings are browser-local; no durable game-save database is currently documented.
- A separate `aoai/cloudflare-containers` branch contains a Docker/Cloudflare Container + Durable Object proxy experiment. It is not part of this feature branch and must be validated separately before being treated as production deployment.

## M1 change boundary

Compared with `aoai/alpha-baseline`, the current feature branch changes only these seven paths:

- Modified: `client/src/main.ts`, `client/src/screens/name.ts`, `client/src/style.css`.
- Added: `client/src/three-kingdoms/screen.ts`, `client/src/three-kingdoms/story-events.json`.
- Added documentation: `docs/THREE_KINGDOMS_M1_ACCEPTANCE.md`, `docs/THREE_KINGDOMS_MIGRATION_PLAN.md`.

No `server/`, `shared/`, RTS simulation, lobby, or WebSocket protocol files are changed in this comparison. This confirms the intended source-level isolation, but it does **not** replace runtime regression testing.

## Current M1 implementation

- Added a separate **Play Three Kingdoms** entry button on the existing name screen.
- Added a dedicated screen and JSON story data for the Peach Garden Oath, three choices, deterministic choice effects, a dedicated local save, and the Yellow Turban first-battle briefing.
- Added campaign-only styles.
- The battle entry is a briefing/roster screen only. There is no playable tactical battle in M1.

## Mandatory M1 exit gate — all conditions required

M2 must remain paused until all four gates pass on the same candidate commit:

1. **Automated code checks:** `npm ci`, `npm run typecheck`, `npm run build`, and `npm run smoke` all complete successfully.
2. **Original RTS multiplayer regression:** run the original Age of AI with at least two separate clients; verify room creation/join, ready/start, live state synchronization, player actions, and a clean return/exit. The original multiplayer match must be genuinely playable, not merely compile.
3. **Three Kingdoms mode regression:** verify the mode opens and exits cleanly; each opening choice applies the expected effects once; refresh restores the dedicated campaign save; the Yellow Turban briefing opens; reset affects only the Three Kingdoms save; the original RTS entry and multiplayer path remain accessible.
4. **Acceptance record and freeze:** record the tested commit SHA, environment, command results, multiplayer test result, Three Kingdoms test result, and any evidence in `THREE_KINGDOMS_M1_ACCEPTANCE.md`. Mark M1 accepted and freeze that candidate only after gates 1–3 pass. Until then, keep status **PENDING** and do not begin M2.

If any gate fails, fix the M1 regression first and rerun the affected checks. Do not work around a failure by changing the original RTS engine or server protocol.

## Milestones

### M0 — Baseline safety
- Preserve the original baseline and its known launch/test commands.
- No deployment, database, lobby, or WebSocket changes.

### M1 — Three Kingdoms entry and story loop
- Isolated entry point, screen, campaign state, story JSON, local save, and battle briefing.
- Exit only through the mandatory M1 gate above.
- **Current state: implementation present; acceptance and freeze pending.**

### M2 — Tactical battle (NOT STARTED; BLOCKED)
After M1 is accepted and frozen:
- Add a new independent `client/src/three-kingdoms/battle-engine.ts` and dedicated battle-rule tests.
- Implement complete playable 3v3 turn-based combat: infantry/archer/light-cavalry counters, formation selection, action order, deterministic damage resolution, victory/defeat checks, and English battle logs.
- Keep all Three Kingdoms combat code and rules isolated from the existing Age of AI RTS battle/simulation engine. Do not rewrite, replace, or refactor the RTS battle engine for this feature.

### M3 — Campaign loop
- Five-city node map, city ownership, recruit roster, battle results, and next-event unlocks.
- Dedicated campaign save; no changes to RTS settings or identity keys.

### M4 — Verification and deployment
- Run the complete code and browser regression suite, including new deterministic battle tests.
- Deploy only after the chosen hosting environment is verified; keep the original RTS entry and multiplayer route available.

## Overall product acceptance

- Existing Age of AI RTS multiplayer remains playable.
- Three Kingdoms opens as a separate mode and does not interfere with RTS flows.
- Three Kingdoms battle state is deterministic and validated by tests, not generated by an LLM.
- No public deployment is reported as successful without an actual health check and browser/multiplayer smoke test.
