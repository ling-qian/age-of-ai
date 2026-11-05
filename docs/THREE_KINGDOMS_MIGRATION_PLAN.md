# Three Kingdoms MVP Migration Plan

Status: M1 is **ACCEPTED / FROZEN** at `107c62db98baa19267a4e8d131bc5443f35468fc` (preserved by `m1-freeze/107c62d`). M2-A implementation is **IN PROGRESS** on `feature/three-kingdoms-mvp`.

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

M1 exit gate result (2026-11-05): all four conditions passed on the same M1 candidate commit `107c62d` and the acceptance record was frozen. Evidence: [CI run 42052146411](https://github.com/ling-qian/age-of-ai/actions/runs/42052146411).

1. **Automated code checks:** `npm ci`, `npm run typecheck`, `npm run build`, and `npm run smoke` all complete successfully.
2. **Original RTS multiplayer regression:** run the original Age of AI with at least two separate clients; verify room creation/join, ready/start, live state synchronization, player actions, and a clean return/exit. The original multiplayer match must be genuinely playable, not merely compile.
3. **Three Kingdoms mode regression:** verify the mode opens and exits cleanly; each opening choice applies the expected effects once; refresh restores the dedicated campaign save; the Yellow Turban briefing opens; reset affects only the Three Kingdoms save; the original RTS entry and multiplayer path remain accessible.
4. **Acceptance record and freeze:** record the tested commit SHA, environment, command results, multiplayer test result, Three Kingdoms test result, and any evidence in `THREE_KINGDOMS_M1_ACCEPTANCE.md`. Mark M1 accepted and freeze that candidate only after gates 1–3 pass. Until then, keep status **PENDING** and do not begin M2.

The M1 code snapshot remains available on `m1-freeze/107c62d`. Any newly discovered M1 regression must be fixed in a new candidate and explicitly re-accepted; do not rewrite the frozen snapshot or work around a failure by changing the original RTS engine or server protocol.

## Milestones

### M0 — Baseline safety
- Preserve the original baseline and its known launch/test commands.
- No deployment, database, lobby, or WebSocket changes.

### M1 — Three Kingdoms entry and story loop
- Isolated entry point, screen, campaign state, story JSON, local save, and battle briefing.
- Exit only through the mandatory M1 gate above.
- **Current state: ACCEPTED / FROZEN.** The three opening choices, both save stages, reset isolation, and return to the original Age of AI entry were verified in browser automation.

### M2-A — Tactical battle engine (IMPLEMENTATION IN PROGRESS)
M1 is accepted and frozen. M2-A is being implemented as a standalone deterministic rules module before any UI integration:
- [x] Added independent `client/src/three-kingdoms/battle-engine.ts` with the pure API `createBattle`, `chooseEnemyFormation`, `chooseEnemyOrders`, and `resolveRound`.
- [x] Added headless deterministic rule tests at `scripts/three_kingdoms_battle_test.ts`, following the existing `tsx` pattern.
- [x] Rules cover infantry/archer/cavalry counters, Arrow/Square formations, Leadership initiative, Attack/Scheme/Wait, deterministic PRNG, structured logs, victory/defeat, and 20-round adjudication.
- [x] Added the M2-A test command to the validation workflow.
- Keep this engine isolated from the existing Age of AI RTS battle/simulation engine. Do not rewrite, replace, or refactor the RTS battle engine for this feature.
- Remaining M2-A exit work: complete the final full CI run on one candidate SHA, verify the source diff boundary, and record the final rule-test count.

### M3 — Campaign loop
- Five-city node map, city ownership, recruit roster, battle results, and next-event unlocks.
- Dedicated campaign save; no changes to RTS settings or identity keys.

### M4 — Verification and deployment
- Run the complete code and browser regression suite, including the deterministic battle tests.
- Deploy only after the chosen hosting environment is verified; keep the original RTS entry and multiplayer route available.

## Overall product acceptance

- Existing Age of AI RTS multiplayer remains playable.
- Three Kingdoms opens as a separate mode and does not interfere with RTS flows.
- Three Kingdoms battle state is deterministic and validated by tests, not generated by an LLM.
- No public deployment is reported as successful without an actual health check and browser/multiplayer smoke test.
