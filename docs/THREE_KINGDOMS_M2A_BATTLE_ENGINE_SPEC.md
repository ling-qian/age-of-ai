# Three Kingdoms M2-A — Tactical Battle Engine Specification

**Status: M1 ACCEPTED / FROZEN — M2-A COMPLETE / CI VERIFIED — M2-B COMPLETE / CI VERIFIED**

M1 passed all automated and real-browser CI gates on candidate `107c62db98baa19267a4e8d131bc5443f35468fc` and is frozen at branch `m1-freeze/107c62d`. M2-A is implemented and verified on runtime candidate `2e2354aba1c9aedf932962e1d6711e65d42e207f`; [CI run 42054617942](https://github.com/ling-qian/age-of-ai/actions/runs/42054617942) completed successfully with 28 deterministic battle tests. M2-B is integrated and browser-verified on candidate `cfb7614b6dae43defb68afb8631bbba341cb0612`; [CI run 42427498617](https://github.com/ling-qian/age-of-ai/actions/runs/42427498617) completed successfully with the M1 original-RTS regression and the complete M2-B tactical battle flow. The frozen M1 branch remains unchanged.

## 1. Repository inspection baseline

Inspected branch: `feature/three-kingdoms-mvp`  
M1 freeze SHA: `107c62db98baa19267a4e8d131bc5443f35468fc`  \nCurrent M2-A candidate at this documentation update: `2e2354aba1c9aedf932962e1d6711e65d42e207f`  
M1 baseline: 10 commits ahead of `aoai/alpha-baseline`, with changes limited to:

- `client/src/main.ts`
- `client/src/screens/name.ts`
- `client/src/style.css`
- `client/src/three-kingdoms/screen.ts`
- `client/src/three-kingdoms/story-events.json`
- `docs/THREE_KINGDOMS_M1_ACCEPTANCE.md`
- `docs/THREE_KINGDOMS_MIGRATION_PLAN.md`

The M1 screen currently provides the Peach Garden choice, local campaign save, and first-battle briefing/roster. It does not contain playable combat.

Current stack:

- Node.js >= 20; npm workspaces: `shared`, `server`, `client`.
- Client: Vite + TypeScript + custom DOM screens + Canvas 2D. It is not a React/Zustand/Konva app.
- Server: Node.js + TypeScript + `ws`, authoritative for the existing real-time RTS.
- Existing root checks: `npm ci`, `npm run typecheck`, `npm run build`, `npm run smoke`.
- Existing headless TypeScript regression scripts use `npx tsx scripts/..._test.ts`.

M1 acceptance is **ACCEPTED / FROZEN** based on the same-candidate command checks and two isolated Chromium browser contexts running the actual local Node/WebSocket service and Vite client. Public production deployment and physical-device testing are explicitly not claimed.

## 2. Non-negotiable isolation boundary

M2-A is a deterministic, single-player tactical rules module. It must not reuse or modify the real-time RTS simulation.

Allowed M2-A implementation paths (now authorized after M1 freeze):

- Add `client/src/three-kingdoms/battle-engine.ts`.
- Add a focused headless test, preferably `scripts/three_kingdoms_battle_test.ts`, following the repository's existing `tsx` regression-script convention.
- Add Three Kingdoms-only scenario fixtures under `client/src/three-kingdoms/` only if needed.

Do not modify:

- Any file under `server/` or `shared/`.
- Existing RTS simulation, pathfinding, room, lobby, WebSocket, network, or snapshot code.
- Existing RTS screens, controls, or save/settings keys.
- The root/client build stack or deployment configuration for this milestone.

M2-A does not require React, Zustand, Konva, Hono, Workers, D1, Durable Objects, Supabase, an LLM, or a new runtime dependency. The engine is imported by the existing Vite client in a later integration step. Do not add a backend route or a new WebSocket message for single-player combat.

## 3. M2-A scope

Included:

1. Three player units versus three enemy units.
2. Three unit classes: infantry, archers, and light cavalry.
3. Two formations: Arrow and Square.
4. One order per living unit per round: Attack, Scheme, or Wait.
5. Initiative based on Leadership.
6. Deterministic hit, damage, status, and victory resolution.
7. Structured English-ready battle log data.
8. Deterministic enemy command selection.
9. Headless unit tests for rules and state transitions.

Excluded:

- Battle animations, battlefield grid/pathfinding, movement, facing, range, terrain, equipment, skills, items, diplomacy, recruitment, campaign map, event engine, AI-generated prose, multiplayer, and cloud saves.
- Any change to the existing Age of AI RTS rules or network protocol.

## 4. Engine contract

The engine must be a pure TypeScript module:

- No DOM, Canvas, browser storage, network, WebSocket, database, file I/O, clock, or LLM calls.
- No global mutable state and no `Math.random()`.
- Inputs are validated before a state transition.
- Each transition returns a new state; it must not mutate the input state.
- The same initial scenario, seed, and submitted orders must always produce the same state and log.
- All IDs are stable strings; unit IDs must be globally unique inside a battle.
- Numeric stats and troop counts must be finite integers in their documented ranges.

Proposed public API:

```ts
createBattle(config: BattleConfig, seed: number): BattleState
chooseEnemyFormation(state: BattleState): Formation
chooseEnemyOrders(state: BattleState): UnitOrder[]
resolveRound(state: BattleState, input: RoundInput): BattleState
```

The exported API and types should be declared in the same module for the first implementation. Avoid premature module splitting.

### Core types

```ts
type BattleSide = 'player' | 'enemy';
type UnitClass = 'infantry' | 'archer' | 'cavalry';
type Formation = 'arrow' | 'square';
type BattleOutcome = 'victory' | 'defeat' | 'draw';

type UnitOrder =
  | { unitId: string; type: 'attack'; targetId: string }
  | { unitId: string; type: 'scheme'; targetId: string }
  | { unitId: string; type: 'wait' };

interface GeneralStats {
  martial: number;       // 1..100
  intelligence: number;  // 1..100
  leadership: number;    // 1..100
}

interface BattleUnit {
  id: string;
  generalId: string;
  name: string;
  side: BattleSide;
  unitClass: UnitClass;
  stats: GeneralStats;
  troops: number;
  maxTroops: number;
  schemeUsed: boolean;
  guarded: boolean;
  suppressed: boolean;
}

interface BattleState {
  version: 1;
  round: number;
  phase: 'ready' | 'finished';
  rngState: number;
  formations: Record<BattleSide, Formation>;
  units: BattleUnit[];
  outcome: BattleOutcome | null;
  log: BattleLogEntry[];
}
```

interface RoundInput {
  formations: Record<BattleSide, Formation>;
  orders: UnitOrder[]; // one order for every living unit on both sides
}

The final implementation may refine field names, but it must preserve the semantics and the serialization-friendly shape.

## 5. Rules v0.1

These are the initial deterministic balancing constants. Keep them in one exported constant object so later tuning does not require rewriting the algorithm. Changing a value requires updating the boundary tests and documenting the balance reason.

### 5.1 Unit-class hit matrix

Rows are the attacking class; columns are the defending class.

| Attacker / Defender | Infantry | Archers | Light cavalry |
|---|---:|---:|---:|
| Infantry | 50% | 80% | 20% |
| Archers | 20% | 50% | 60% |
| Light cavalry | 80% | 60% | 50% |

Hit chance:

```ts
hitChance = clamp(
  baseHitChance[attacker.unitClass][defender.unitClass]
    + round((attacker.stats.martial - defender.stats.leadership) * 0.10),
  5,
  95
);
```

A hit succeeds when the deterministic 0..99 roll is lower than `hitChance`. A miss causes no troop loss.

### 5.2 Formations

Each side chooses one formation at the start of each round:

- **Arrow (`arrow`)**: outgoing attack casualties × 1.15; no defensive bonus.
- **Square (`square`)**: incoming attack casualties × 0.80; no offensive bonus.

Apply the attacker's outgoing formation modifier and the defender's incoming formation modifier to the same casualty calculation. Use integer rounding only at the final casualty result.

### 5.3 Attack casualties

For a successful attack:

```ts
baseCasualties = 35
  + attacker.stats.martial * 0.75
  + attacker.stats.leadership * 0.25;

strengthFactor = 0.50
  + 0.50 * (attacker.troops / attacker.maxTroops);

casualties = round(
  baseCasualties
  * strengthFactor
  * attackerFormationMultiplier
  * defenderFormationMultiplier
  * defenderGuardMultiplier
  * attackerSuppressionMultiplier
);
casualties = min(defender.troops, max(1, casualties));
```

Modifiers:

- Defender is guarding: `defenderGuardMultiplier = 0.70`; consume `guarded` after the first successful incoming hit.
- Attacker is suppressed: `attackerSuppressionMultiplier = 0.65`; consume `suppressed` when its next attack is resolved.
- Otherwise the relevant modifier is `1.0`.

A unit is defeated when `troops === 0`. A defeated unit cannot act and cannot be selected as a target.

### 5.4 Scheme

- A living unit may attempt Scheme once per battle. The attempt consumes `schemeUsed` whether it succeeds or fails.
- The target must be a living enemy unit.
- Success chance:

```ts
schemeChance = clamp(
  50 + round((caster.stats.intelligence - target.stats.intelligence) * 0.50),
  10,
  90
);
```

- On success, set the target's `suppressed = true`. Its next Attack resolves at ×0.65 casualties, then the status is consumed.
- Scheme causes no direct troop casualties.
- A scheme targeting a unit that has already attacked this round remains active for its next attack.

### 5.5 Wait

Wait causes no attack. It sets `guarded = true`. The next successful incoming attack against that unit is reduced by ×0.70 and consumes the guard. If no attack lands, the guard persists into the next round.

### 5.6 Initiative and round resolution

1. The caller chooses the player's formation and player orders; it obtains the enemy formation and enemy orders from the deterministic AI helpers. The caller passes both formations and the combined order list in `RoundInput`.
2. Validate both formations and every order before mutating anything. Every living unit must submit exactly one order. Defeated units must not submit orders.
3. Combine both sides' orders and sort by Leadership descending; break ties with a deterministic code-point comparison of unit ID (never locale-dependent sorting).
4. Resolve orders in that order. If an acting unit was defeated before its initiative, skip its order.
5. If a side has no living units, finish immediately with the other side as winner.
6. Otherwise advance the round and reset only per-round data. Battle-long `schemeUsed` remains set; `guarded` and `suppressed` persist until consumed.

Maximum round count: 20. If neither side is defeated by the end of round 20, compare remaining troop totals: greater total wins; equal totals produce a draw. This prevents a player from keeping a battle open indefinitely with Wait orders.

### 5.7 Deterministic random source

Store the PRNG state in `BattleState`. Provide a small pure `nextRandom(state): { value: number; state: number }` helper with a documented 32-bit algorithm and explicit zero-seed handling. Every random roll (attack hit and scheme success) must advance this state exactly once. Do not use wall-clock time or a random UUID as the seed inside the engine; the caller supplies the seed.

### 5.8 Enemy AI v0.1

Enemy AI selection must be deterministic and intentionally simple:

- Formation: choose Arrow when the enemy's total remaining troops are at least the player's total; otherwise choose Square.
- Orders: for each living enemy unit, if it has not used Scheme, Intelligence is at least 65, and a living player target exists, Scheme the living player unit with the highest Martial; tie-break by ID.
- Otherwise Attack the living player unit with the lowest current troop count; tie-break by ID.
- Never choose a defeated target. If no valid target exists, Wait.

Both AI helpers must not mutate the battle state or consume PRNG state.

## 6. Structured battle log

The engine returns data, not pre-translated UI strings. Each log entry should have a stable `type` and named fields, for example:

- `battle_started`
- `formation_selected`
- `unit_attacked` (include attackerId, targetId, hitChance, roll, hit)
- `troops_lost` (include targetId, casualties, remainingTroops)
- `scheme_attempted` (include casterId, targetId, successChance, roll, success)
- `unit_guarded`
- `unit_defeated`
- `battle_finished` (include outcome and remaining troop totals)

The UI/locales layer maps these entries to English sentences. Do not store only a rendered sentence in the engine, and do not concatenate translated fragments.

## 7. Test and local development preparation

No new test dependency is added. The repository already uses headless TypeScript scripts run with `npx tsx`; M2-A follows that convention.

Focused M2-A test command:

```bash
npx tsx scripts/three_kingdoms_battle_test.ts
```

The test script must exit non-zero on any failure. It must cover:

- Every cell in the 3×3 hit matrix.
- Hit chance minimum/maximum clamping and deterministic roll boundary.
- Attack casualties, zero troop floor, and no negative troop counts.
- Arrow versus Square trade-off.
- Leadership initiative order and deterministic tie-break.
- A defeated unit skips its pending order.
- Invalid, duplicate, missing, friendly, and defeated-unit orders are rejected.
- Scheme success/failure, one-use limit, and suppression consumption.
- Wait guard reduction and guard consumption/persistence.
- Victory, defeat, and 20-round adjudication/draw.
- Same seed + same commands produces byte-equivalent state/log output.
- Different seeds can produce different rolls without changing non-random calculations.
- Engine functions do not mutate the input state.

M1 is frozen. The current validation workflow now runs the M1 gates plus the focused M2-A rules test:

```bash
npm ci
npm run typecheck
npm run build
npm run smoke
```

The focused battle test is wired into `.github/workflows/three-kingdoms-m1-validation.yml` as `M2-A deterministic battle rules`. It passed 28 tests with zero failures in run `42054617942` on the exact tested runtime candidate `2e2354a`.

## 8. M2-A acceptance result

<badge color="success">COMPLETE — 28/28 tests passed</badge>

Verified on runtime candidate `2e2354aba1c9aedf932962e1d6711e65d42e207f`:

- [x] The battle engine is isolated under `client/src/three-kingdoms/battle-engine.ts`.
- [x] It builds a complete 3v3 battle state using infantry, archers, and light cavalry.
- [x] The 3×3 class hit matrix, hit-chance calculation and clamp boundaries, deterministic hit boundary, casualties, and troop floors are covered.
- [x] Arrow/Square formation trade-offs are covered.
- [x] Leadership initiative and deterministic code-point ID tie-breaking are covered.
- [x] Defeated actors and targets are skipped/rejected correctly.
- [x] Invalid, duplicate, missing, friendly-target, and defeated-unit orders are rejected.
- [x] Scheme success/failure, one-use behavior, suppression consumption, and persistence until the target's next Attack are covered.
- [x] Wait guard reduction, consumption, and persistence after a miss are covered.
- [x] Immediate victory/defeat and 20-round victory/defeat/draw adjudication are covered.
- [x] Same seed and same orders produce byte-equivalent state/log output; different seeds can change rolls.
- [x] Engine functions do not mutate their input state.
- [x] `npm run typecheck`, `npm run build`, and the original RTS WebSocket smoke test pass.
- [x] The M1 real-browser regression suite passes on the same runtime candidate.
- [x] Source diff confirms no changes under `server/`, `shared/`, existing RTS screens, existing RTS simulation, or WebSocket protocol.
- [x] M1 remains accepted/frozen at `107c62d`; its frozen source branch was not modified by M2-A.

**Evidence:** [GitHub Actions run 42054617942](https://github.com/ling-qian/age-of-ai/actions/runs/42054617942) — `M2-A BATTLE ENGINE TESTS: 28 passed, 0 failed`; `ALL M1 BROWSER REGRESSION CHECKS PASSED`.

Scope clarification: M2-A delivers the pure battle rules engine and its deterministic tests. It does not yet connect the engine to the Three Kingdoms screen or provide the player-facing battle UI; those belong to M2-B.

## 9. M2-B player-facing integration acceptance

<badge color="success">COMPLETE — browser CI passed</badge>

Verified on candidate `cfb7614b6dae43defb68afb8631bbba341cb0612`:

- [x] The battle panel is part of the existing Three Kingdoms route; the original Age of AI name/lobby/game route remains separate.
- [x] The fixed 3v3 scenario renders three player units and three enemies.
- [x] Arrow/Square formation selection persists.
- [x] Attack, Scheme, and Wait can be submitted for the three living player units; invalid/friendly/defeated targets are not exposed by the UI.
- [x] Enemy orders/formation are selected deterministically and the round resolves through the pure engine.
- [x] Structured battle logs, troop counts, unit classes and statuses are visible.
- [x] Campaign save refresh restores round 2, formation, orders/log, all six units, the original RTS player name, and RTS settings without replaying the round.
- [x] The fixed-seed battle reaches **Victory in round 5** in the browser test; the result panel shows the outcome and both remaining troop totals.
- [x] Restart battle returns to the battle briefing, clears only the tactical encounter, and starts a fresh round 1 while preserving the chosen campaign path.
- [x] The same CI run passes the three M1 opening choices, original RTS two-browser create/join/start/move/chat/exit/return flow, and the 28 M2-A deterministic rule tests.
- [x] Diff audit from the M1 frozen SHA shows no modifications under `server/` or `shared/`, no existing RTS simulation/network/lobby changes, and no WebSocket protocol changes.

**Evidence:** [GitHub Actions run 42427498617](https://github.com/ling-qian/age-of-ai/actions/runs/42427498617) — candidate `cfb7614`, completed successfully.

Scope: M2-B is the first playable single-player tactical encounter in the Three Kingdoms mode. It does not yet include the multi-node campaign map, city ownership, recruitment, campaign progression, or persistent roster management; those are M3.

## 10. Go / no-go

**Decision: GO — M2-A and M2-B are complete.**

The independent battle rules remain implemented in `client/src/three-kingdoms/battle-engine.ts`, with 28 deterministic headless tests. The player-facing integration lives inside `client/src/three-kingdoms/screen.ts` and uses only the dedicated Three Kingdoms campaign save namespace.

The next milestone is **M3: campaign loop** — five-city node route, city ownership, recruit roster, battle-result-driven unlocks, and casualty/recruitment persistence. Preserve M1 at `m1-freeze/107c62d`; do not add Three Kingdoms combat to the original RTS or introduce server/WebSocket changes.

