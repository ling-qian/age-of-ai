# Three Kingdoms MVP Migration Plan

Status: M1 is **ACCEPTED / FROZEN** at `107c62db98baa19267a4e8d131bc5443f35468fc` (preserved by `m1-freeze/107c62d`). M2-A and M2-B are **COMPLETE / CI VERIFIED**; M2-B candidate `cfb7614b6dae43defb68afb8631bbba341cb0612` passed [CI run 42427498617](https://github.com/ling-qian/age-of-ai/actions/runs/42427498617). Before campaign-map expansion, the next milestone is **M2-C: general-specific skills and tactical deployment formations**.

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

M1 exit gate result (2026-11-05): all four conditions passed on the same M1 candidate commit `107c62d` and the acceptance record was frozen. Evidence: [CI run 42052146411](https://github.com/ling-qian/age-of-ai/actions/runs/42052146411). Do not rewrite the frozen M1 snapshot.

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

### M2-A — Tactical battle engine (**COMPLETE / CI VERIFIED**)

Implemented on runtime candidate `2e2354aba1c9aedf932962e1d6711e65d42e207f`:

- [x] Added isolated pure TypeScript rules module `client/src/three-kingdoms/battle-engine.ts`.
- [x] Implemented a deterministic 3v3 state model with infantry, archers, and light cavalry.
- [x] Implemented the class hit matrix, hit-chance modifiers and 5%/95% safety clamp, Arrow/Square formation modifiers, casualty calculation, Leadership initiative, and deterministic code-point tie-break.
- [x] Implemented Attack, one-use Scheme, Wait/guard, status consumption, defeated-unit handling, and deterministic enemy formation/order selection.
- [x] Implemented a serialized xorshift32 PRNG state and structured battle log entries.
- [x] Implemented immediate victory/defeat and 20-round troop-total adjudication.
- [x] Added `scripts/three_kingdoms_battle_test.ts` with 28 deterministic rule tests.
- [x] Added the M2-A rule test to the validation workflow; run [42054617942](https://github.com/ling-qian/age-of-ai/actions/runs/42054617942) passed 28/28 rule tests, typecheck, production build, original RTS smoke, and the M1 browser regression.
- [x] Diff audit confirms no changes to `server/`, `shared/`, original RTS screens/simulation, or WebSocket protocol.

M2-A is the engine/rules milestone only. It is not yet imported into the Three Kingdoms UI.

### M2-B — Player-facing tactical battle integration (**COMPLETE / CI VERIFIED**)

Implemented on candidate `cfb7614b6dae43defb68afb8631bbba341cb0612`:

- [x] Integrated the already-tested deterministic battle engine into the existing Three Kingdoms route through a dedicated tactical battle panel.
- [x] Started the first fixed 3v3 scenario from the Yellow Turban briefing.
- [x] Added Arrow/Square formation selection and one Attack/Scheme/Wait order control per living player unit.
- [x] Restricts Attack/Scheme targets to living enemy units; defeated units lose their order controls.
- [x] Uses deterministic enemy formation/order selection and resolves each round through the pure engine.
- [x] Renders structured battle logs in the UI layer, plus troop totals and Guarded/Suppressed/Scheme-used statuses.
- [x] Displays victory, defeat, or draw with both sides' remaining troop totals.
- [x] Persists the battle stage, round, RNG state, formation, player orders, unit state, and log in the existing dedicated Three Kingdoms campaign key.
- [x] Browser regression configures all three order types, resolves a round, refreshes, and verifies round 2, formation, log, units, original RTS name, and settings are restored.
- [x] Browser regression continues the battle to a terminal result (victory in round 5 for the fixed seed), verifies the result panel and troop totals, restarts the encounter through the briefing, and verifies a fresh round 1.
- [x] Existing M1 story/save tests and the original RTS two-browser room/match/move/chat/exit regression pass on the same CI run.
- [x] Diff audit against M1 freeze confirms no changes to `server/`, `shared/`, existing RTS simulation, lobby, networking, or WebSocket protocol.

**Evidence:** [GitHub Actions run 42427498617](https://github.com/ling-qian/age-of-ai/actions/runs/42427498617) on candidate `cfb7614`: typecheck, production build, original RTS WebSocket smoke, 28 deterministic M2-A tests, M1/M2-B browser regression all completed successfully.

M2-B is a client-only single-player tactical battle integration. It does not add server routes, multiplayer messages, or changes to the original RTS.

### M2-C — General-specific skills and tactical deployment formations (**NEXT — SPECIFICATION DRAFT**)

The current M2-B build is a playable first battle, not the full tactical system. Its generic Attack/Scheme/Wait orders and army-wide Arrow/Square stance do not satisfy the requirements for unique general skills and detailed deployment.

Specification: `docs/THREE_KINGDOMS_M2C_SKILLS_FORMATIONS_SPEC.md`.

Required before implementation:
- Every playable/recruitable general must own at least one distinct signature active skill. A generic Scheme command is not a substitute for a general's personal skill.
- Skill definitions must specify owner, target rules, effect, resource/cooldown or use limit, and deterministic resolution. Skill state must survive refresh/reload.
- Separate army doctrine (Arrow/Square) from unit deployment. The player must assign each general/unit to a battlefield slot before the battle.
- Use an abstract deployment grid (front/middle/rear × left/center/right) without introducing RTS pathfinding or real-time movement.
- Make deployment meaningful: frontline screening, exposed targets, archer access to rear targets, and skill target/range rules must be explicit and deterministic.
- The enemy deployment and skill use must be deterministic and saved/replayable.
- Add rule tests and real-browser tests for skill use, cooldowns, formation placement, target availability, round resolution, reload restoration, and restarting the encounter.
- Extend the campaign-save schema with a safe migration from the current save. Never overwrite the existing save with the test fixture on browser refresh. Do not touch RTS identity/settings keys.
- Preserve the M1 freeze branch. No changes to `server/`, `shared/`, original RTS simulation, lobby, networking, or WebSocket protocol.

Only after M2-C tests pass should M3 campaign-map and recruitment work begin.

### M3 — Campaign loop
- Five-city node map, city ownership, recruit roster, battle results, and next-event unlocks.
- Define the first campaign route and city-state transitions before implementing map UI.
- Battle victory unlocks the next campaign node; defeat/draw follow explicit retry or recovery rules.
- Add recruitment/casualty/roster persistence to the dedicated campaign save.
- Keep the existing battle engine independent and keep all campaign state out of RTS identity/settings storage.
- Dedicated campaign save; no changes to RTS settings or identity keys.

### M4 — Verification and deployment
- Run the complete code and browser regression suite, including the deterministic battle tests.
- Deploy only after the chosen hosting environment is verified; keep the original RTS entry and multiplayer route available.

## Overall product acceptance

- Existing Age of AI RTS multiplayer remains playable.
- Three Kingdoms opens as a separate mode and does not interfere with RTS flows.
- Three Kingdoms battle state is deterministic and validated by tests, not generated by an LLM.
- No public deployment is reported as successful without an actual health check and browser/multiplayer smoke test.
