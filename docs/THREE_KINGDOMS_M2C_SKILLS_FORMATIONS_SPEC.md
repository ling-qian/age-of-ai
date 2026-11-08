# M2-C — General Skills and Tactical Deployment Formations

**Status: M2-C COMPLETE / ACCEPTED — ALL FOUR PHASES CI VERIFIED**

## 1. Purpose and milestone order

M1 is accepted/frozen at `m1-freeze/107c62d`. M2-A (deterministic rules engine) and M2-B (first playable 3v3 UI) are implemented and CI-verified.

M2-C adds the combat identity and deployment depth required for a proper Three Kingdoms tactical battle:

1. Every playable/recruitable general has a personal signature skill.
2. Players can arrange units on a battlefield before combat.
3. Deployment positions affect exposure, protection, and valid targets.
4. Skills, positions, cooldowns, RNG state, and battle log survive save/reload.
5. The original Age of AI RTS remains untouched.

M3 campaign map, city ownership, and recruitment progression must not begin until M2-C passes its rule and browser acceptance tests.

## 2. What is already implemented — and what is not

M2-B currently provides:
- Three units per side and the infantry/archer/cavalry classes.
- Generic Attack, Scheme, and Wait orders.
- One army-wide Arrow/Square doctrine choice.
- Deterministic enemy order/formation selection.
- Round resolution, troop/status display, battle log, victory/defeat/draw panel.
- Campaign save and browser refresh restoration.

M2-B does **not** provide:
- A unique active skill for each general.
- A battlefield deployment layout or per-unit positions.
- Frontline screening or positional target restrictions.
- Skill cooldown/resource persistence.

Do not label generic Scheme as a general-specific skill. Do not label Arrow/Square alone as full unit deployment.

## 3. Save integrity is a hard gate

The M2-B refresh regression is fixed and passed on candidate `cfb7614b6dae43defb68afb8631bbba341cb0612`, CI run [42427498617](https://github.com/ling-qian/age-of-ai/actions/runs/42427498617).

The earlier failure was in the browser fixture: Playwright's `addInitScript` ran on every navigation and rewrote the initial `battle-entry` fixture over the saved round-2 game. The fixture now seeds once per tab using `sessionStorage`; it no longer overwrites a save during refresh. The fixed run verified that the real localStorage save was `stage=battle, round=2` both before and after reload, then restored the second-round UI, formation, six units, battle log, RTS name, and settings.

M2-C must preserve and extend that proof:
- Use the existing dedicated campaign namespace; do not reuse RTS name/settings keys.
- Keep the existing `ageofai:three-kingdoms:campaign:v1` storage key while the campaign JSON schema is version 3 and the nested battle state is version 3.
- Battle v3 adds a per-unit 3×3 deployment slot while preserving general `skillId`, serializable cooldown/use state, statuses, doctrine, round, RNG, troops, orders, and structured battle log.
- Migrate campaign/battle v1 directly to v3 and campaign/battle v2 to v3. Deterministic default slots are assigned per side; story choice, resources, battle progress, skills, cooldowns, troop values, formations, orders, and log are retained.
- Invalid/unsupported data remains read-only until explicit user reset; migration stays isolated to the Three Kingdoms campaign and never touches RTS identity/settings.
- Keep the full battle state authoritative in one serialized campaign-save object: general IDs, skill state/cooldowns, deployment positions, doctrine, formations, RNG state, round, troop counts, statuses, orders, and structured log.
- Validate all restored IDs, skill IDs, positions, numeric values, and battle-state invariants before accepting a save.
- A malformed/unsupported save must not silently overwrite a previously valid save. Keep recovery behavior deterministic and scoped to the Three Kingdoms campaign.
- Tests must reload after a skill has been used and after positions have been changed, and verify no skill is re-granted, no cooldown resets, no formation changes, and no round is replayed.

## 4. General-specific skill system

### 4.1 Required contract

Every playable/recruitable general must have a non-empty, unique `skillId` referencing a skill definition. General data must not embed opaque callback functions; definitions remain serializable data and the engine resolves known effect types.

Proposed data contract:

```ts
type SkillTarget =
  | 'self'
  | 'ally'
  | 'enemy'
  | 'enemy_frontline'
  | 'enemy_all';

type SkillEffect =
  | { type: 'damage'; multiplier: number; ignoreGuard?: boolean }
  | { type: 'heal_troops'; amount: number }
  | { type: 'guard'; duration: number }
  | { type: 'suppress'; duration: number }
  | { type: 'morale'; amount: number };

interface GeneralSkillDefinition {
  id: string;
  ownerGeneralId: string;
  name: string;
  description: string;
  target: SkillTarget;
  cooldownRounds: number;
  usesPerBattle: number;
  effect: SkillEffect;
}

interface GeneralCombatState {
  generalId: string;
  skillId: string;
  cooldownRemaining: number;
  usesRemaining: number;
}
```

The final TypeScript contract may be refined during implementation, but must preserve:
- A skill can only be used by its owning general/unit.
- Target validation is enforced by the engine, not just hidden/disabled in the UI.
- Cooldown and uses are updated only when the skill successfully resolves, following an explicit failure/consumption rule.
- Skill effects are deterministic, bounded, serializable, and covered by tests.
- Skill resolution is represented in structured battle-log entries.
- Enemy skill choice is deterministic and must obey the same ownership, target, and cooldown rules.

### 4.2 Starter-general coverage

The first scenario must give Liu Bei, Guan Yu, and Zhang Fei different signature skills. This is a design requirement, not permission to guess final damage numbers.

Suggested thematic directions for design/balance:
- **Liu Bei — Rende:** a support/protection skill that reinforces or guards an ally.
- **Guan Yu — Qinglong strike:** a high-impact single-target martial attack.
- **Zhang Fei — Thunderous Roar:** a control skill that suppresses or weakens enemy frontline units.

The first data-only balance set is recorded as `m2c-alpha-1` in `client/src/three-kingdoms/general-skills.ts`: Liu Bei — Rende (ally, restore 35 troops, 2 uses, 2-round cooldown); Guan Yu — Azure Dragon Strike (single enemy, 1.65× normal attack casualties, 2 uses, 3-round cooldown); Zhang Fei — Thunderous Roar (enemy frontline, suppress for 1 round at 0.65 outgoing-damage multiplier, 1 use, 3-round cooldown). These are the explicit initial tuning values for implementation and subsequent playtest review; this milestone slice registers and validates the data but does not yet execute skills in battle. The three skills must remain tactically distinct, not merely have different labels.

Future recruitable generals cannot be added without a corresponding unique skill definition and test case. Ordinary troop units may continue to use class orders; personal skills belong to general-led units.

### 4.3 Command flow

Each living general receives one order per round. The order set becomes:
- Attack
- Scheme (generic tactical command, if retained after balance review)
- Wait
- Use personal skill (only when ready and a valid target exists)

A personal skill consumes that general's command for the round unless its specific design explicitly defines a passive trigger. Do not allow a unit to Attack and then use its skill in the same round.

## 5. Tactical deployment system

### 5.1 Two distinct layers

Keep these separate in both UI and saved data:

1. **Army doctrine:** Arrow, Square, Wedge, or Turtle. This is a whole-army offensive/defensive stance and is separate from unit deployment.
2. **Unit deployment:** each general is assigned a battlefield slot before combat.

Deployment must not be represented as a third name for Arrow/Square.

### 5.2 Abstract board

Use a 3×3 abstract deployment grid for each side:

| Depth / lane | Left | Centre | Right |
|---|---|---|---|
| Front | F-L | F-C | F-R |
| Middle | M-L | M-C | M-R |
| Rear | R-L | R-C | R-R |

Rules:
- Each living unit occupies exactly one slot.
- No two units on the same side may share a slot; opposing armies may occupy mirrored cells on their own grids.
- Empty slots are allowed.
- A unit's slot is stable for a battle; M2-C does not add tactical movement or pathfinding.
- The player can assign/reassign each general before combat. A deployment-lock event freezes the layout when combat begins; rules validation rejects later changes.
- The enemy layout is deterministic and stored in the battle state.

### 5.3 Position must change gameplay

The following baseline behavior is required:
- Frontline units screen all living units behind them in the same lane against melee attacks.
- Infantry and cavalry melee attacks may target only the front-most living enemy in the selected lane. They may choose among exposed targets across lanes.
- Archers may target any living enemy, including protected middle/rear units, subject to skill-specific target rules.
- If the front unit in a lane is defeated, the next living unit in that lane becomes exposed automatically.
- Infantry specialize in holding the line; archers specialize in ranged access to all rows; cavalry retain melee exposure rules and gain a 1.2× damage modifier when striking across lanes.
- Guard and suppression remain attached to units, not cells. Position and formation modifiers are centralized in named balance constants.

This creates meaningful decisions: place durable infantry forward to screen, archers behind protection, and cavalry in a flank/front slot if the chosen skill or approved bonus supports it. No pathfinding, movement animation, terrain, facing, or real-time RTS mechanics are introduced in M2-C.

### 5.4 Initial player and enemy deployment

The first encounter must define a valid starting deployment for all six units. Proposed initial player arrangement:
- Liu Bei: Front-Centre
- Guan Yu: Front-Left
- Zhang Fei: Front-Right

The enemy setup must place its ranged unit behind at least one frontline defender so the browser tests can verify that melee cannot select it while Archers can. These are scenario defaults; the player may rearrange the three heroes before starting.

## 6. UI requirements

Before starting the first battle:
- Show a readable deployment board with the three player generals and their current slots.
- Allow moving each general to an unoccupied slot; clearly show occupied/available cells.
- Show each general's name, class, stats, signature skill name, effect summary, and cooldown/use rule.
- Show Arrow/Square as a separate doctrine selector.
- Validate that every general is placed exactly once and no position is duplicated.
- Show the enemy deployment preview if it is known to the player; otherwise show only intelligence appropriate to the scenario.

During battle:
- Show each unit's position/depth/lane and current troop count/status.
- Show personal-skill button/control only for the owning general and only when ready.
- Show valid targets based on skill and positional rules.
- Show remaining cooldown/uses.
- Keep the current English structured battle log and terminal result panel.
- On reload, restore the same battle and do not return to deployment setup unless the save says the battle has not started.

## 7. Deterministic tests and browser acceptance

### Rule tests

Add focused tests for:
1. Every playable/recruitable general has exactly one valid personal skill definition.
2. A general cannot use another general's skill.
3. Skills reject invalid, friendly, defeated, or out-of-pattern targets.
4. Skill effects, cooldown, and uses-per-battle resolve exactly as specified.
5. Cooldown decreases at the documented round boundary and never becomes negative.
6. A skill cannot be double-used by duplicate orders.
7. Enemy AI selects only ready skills and valid targets deterministically.
8. Three units cannot share a deployment slot.
9. Missing/unknown deployment positions are rejected or migrated using documented defaults.
10. Frontline screening protects same-lane middle/rear units from melee attacks.
11. Defeating a frontline unit exposes the next unit in that lane.
12. Archers can reach legal rear targets.
13. Arrow/Square doctrine modifiers still work independently of deployment.
14. Same seed + same orders + same skills + same deployment produces byte-identical state/log.
15. Input state is not mutated.
16. Version-1 campaign saves migrate safely to the new format; existing battle state and user choice are not discarded.
17. Save/reload preserves deployed positions, skill uses/cooldowns, round, RNG state, unit state, and battle log.

### Real-browser tests

- Enter the deployment screen from the Yellow Turban briefing.
- Rearrange all three player generals; verify unique slots and correct saved layout.
- Confirm invalid duplicate-slot placement is blocked.
- Start battle and verify saved deployment is used by the engine.
- Use each starter general's own skill at least once; verify the effect and usage/cooldown on screen.
- Attempt to use another general's skill and a defeated/invalid target; verify it is rejected.
- Verify frontline screening and archer rear targeting from actual target controls.
- Refresh after at least one skill use and after a positional effect; verify exact state restoration without replaying the round.
- Continue to victory/defeat/draw; verify result UI.
- Restart the battle; verify the campaign choice/resources remain, the tactical state resets, and the deployment returns to its documented default or the player's last saved pre-battle layout according to the selected rule.
- Return to the original Age of AI entry; verify RTS identity/settings and two-browser multiplayer regression remain intact.

All tests run in the existing CI workflow using the current Node/TypeScript/Playwright setup. Do not add a new testing framework or backend dependency.

## 8. Non-negotiable isolation boundary

Allowed changes:
- `client/src/three-kingdoms/battle-engine.ts`
- `client/src/three-kingdoms/screen.ts`
- `client/src/three-kingdoms/story-events.json` or a dedicated Three Kingdoms generals/skills JSON data file
- Three Kingdoms-only CSS
- `scripts/three_kingdoms_battle_test.ts`
- `scripts/m1_browser_regression.mjs`
- Three Kingdoms milestone documentation

Forbidden:
- Any `server/` or `shared/` files.
- Original RTS simulation, pathfinding, room/lobby, networking, snapshot, WebSocket messages/protocol, controls, or settings.
- Replacing the current Vite/TypeScript/custom DOM stack.
- Introducing multiplayer tactical combat, cloud save backend, or LLM-generated battle outcomes.

## 9. Implementation progress

### Phase 1 — Campaign save and skill data model (COMPLETE / CI VERIFIED)

- Added `general-skills.ts` with a unique owner-bound data definition for each starter general, a versioned initial balance set (`m2c-alpha-1`), and serializable skill state.
- Battle state schema is now version 2. New battles initialize each starter general's skill state; validation rejects unknown skills, owner mismatches, invalid cooldowns, and invalid remaining-use counts.
- Added a v1 battle-state migration that preserves all prior battle fields and grants the new skill state only during the one-time v1 → v2 conversion.
- Added `campaign-save.ts`: campaign JSON version 2, stable legacy storage key, v1 campaign/battle migration, strict validation, and read-only handling for invalid/unsupported saves until an explicit reset.
- Added headless migration/data tests and wired them into the existing GitHub Actions workflow (7/7 pass).
- Extended the real-browser regression to seed a legacy v1 campaign, verify automatic v2 persistence and stage retention, start the tactical encounter, and verify the v2 battle state plus three owner-bound skill IDs.
- Verified candidate `483597629f68287fa26a6e3cd86feb1da1036cf5` in [GitHub Actions run 42429683074](https://github.com/ling-qian/age-of-ai/actions/runs/42429683074): `npm ci`, typecheck, production build, original RTS WebSocket smoke, M2-A 28/28 deterministic tests, M2-C 7/7 save/skill-model tests, and the complete existing browser regression all passed.
- Source-diff audit against `feature/three-kingdoms-mvp` shows only Three Kingdoms client files, Three Kingdoms tests/docs, and the validation workflow changed; no `server/`, `shared/`, or original RTS/network files changed.
- **Not implemented in this phase:** skill execution, cooldown ticking, deployment positions, line-screening, positional target validation, skill UI controls, or the full M2-C browser acceptance flow.

### Phase 2 — General skill execution (COMPLETE / CI VERIFIED)

- Added a typed `skill` unit order to the deterministic battle engine. A unit can submit only one order per round; a personal skill consumes that order.
- Enforced skill ownership, exact owner-to-skill mapping, remaining-use limits, cooldown readiness, living-target checks, side/target-pattern rules, and revalidation when initiative reaches the caster.
- Implemented Rende healing with a max-troop cap, Azure Dragon Strike at 1.65× normal attack casualties, and Thunderous Roar suppression at the configured 0.65 outgoing-damage multiplier.
- Valid skill use consumes one use and starts cooldown even if the damage skill misses. Invalid orders are rejected before consumption; if a selected target is defeated or becomes invalid before the caster acts, the order is skipped without consuming the skill.
- Cooldowns tick once at the end of each completed round and clamp at zero. Suppression has a saved expiry round and is cleared after its defined round or when its next outgoing attack consumes it.
- Enemy AI can select ready personal skills deterministically and follows the same ownership, target, cooldown, and use rules.
- At initial Phase 2 delivery, `enemy_frontline` used a temporary class proxy. Phase 3 replaced it with actual front-row deployment slots; Zhang Fei now targets the deployed enemy frontline, including any valid frontline unit class.
- Added `scripts/three_kingdoms_skill_execution_test.ts` and a CI step. It covers skill effects, target rejection, ownership, use limits, cooldown, skipped targets, duplicate orders, AI selection, suppression reduction, and save/load restoration (14/14 pass).
- Verified on candidate `edaae9c69918f178b9bd136a3ea1a487c7186827` in [GitHub Actions run 42434473539](https://github.com/ling-qian/age-of-ai/actions/runs/42434473539): typecheck, production build, original RTS WebSocket smoke, M2-A 28/28, save/skill model 7/7, skill execution 14/14, and the current Playwright regression all passed.
- **Still outstanding:** 3×3 deployment positions, frontline screening, positional target validation, richer unit-class combat roles, additional army formations, deployment UI, visible skill controls, and the final M2-C browser acceptance flow.

### Phase 3 — Deployment, line screening, unit classes, and army doctrine (COMPLETE / CI VERIFIED)

- Campaign and battle save schema are now version 3. The existing storage key is retained. Valid v1 and v2 campaign/battle saves migrate to v3 with deterministic default slots and preserve story choices, resources, progress, RNG, troops, skill states/cooldowns, formations, orders, and logs.
- Every unit has a validated 3×3 slot (`front|middle|rear × left|center|right`). Slots are unique within each side; opposing armies can use mirrored cells.
- Added engine-level `setUnitDeployment`: assignments must cover every unit exactly once, cannot reuse a cell, return immutable state, and are locked after combat begins.
- Added same-lane frontline screening for infantry/cavalry, automatic exposure after a frontline unit falls, all-row archer targeting, and a 1.2× cavalry cross-lane flank bonus.
- Added four separate army doctrines: Arrow, Square, Wedge, and Turtle. Wedge strengthens cavalry while trading off other units; Turtle improves incoming defence while reducing outgoing damage.
- Enemy AI selects only legal exposed melee targets and chooses Wedge/Turtle deterministically from roster composition.
- Initial encounter positions are saved: Liu Bei front-center, Guan Yu front-left, Zhang Fei front-right; Raider Captain front-center, Rebel Archer rear-center, Spearman front-left.
- Added `scripts/three_kingdoms_deployment_test.ts` (16/16 pass) for slot uniqueness, pre-battle assignment, deployment lock, frontline screening, archer rear access, exposed-target updates, AI targeting, cavalry flanking, Wedge/Turtle modifiers, and save/load persistence.
- Candidate `987716622db7b9e31709a2b9e8cfa54534d04494` passed [GitHub Actions run 42435222033](https://github.com/ling-qian/age-of-ai/actions/runs/42435222033): typecheck, production build, RTS smoke, M2-A 28/28, save migration 7/7, skill execution 14/14, deployment/class/formation 16/16, and existing browser regression.
- **Still outstanding:** player-facing deployment board, four-doctrine selector, visible skill controls/targets, and full Phase 4 browser acceptance.

### Phase 4 — Deployment/skill UI and full browser acceptance (COMPLETE / CI VERIFIED)

- Replaced the direct briefing-to-battle transition with a saved deployment stage. The player can rearrange each general across the 3×3 grid before locking the line and starting combat.
- Added player and enemy deployment boards, occupied/empty cells, per-general slot selectors, class/troop/skill details, and a separate pre-battle doctrine selector.
- Added all four army doctrine choices (Arrow, Square, Wedge, Turtle) to both deployment preparation and the live battle panel. Doctrine is saved separately from unit position.
- Added personal-skill controls on each general's battle card, with owner-specific skill name/description, valid target options, cooldown and remaining-use display. The engine continues to validate all orders independently of the UI.
- Added enemy legal-target reach previews. Browser assertions verify that Liu Bei's infantry attack control cannot select the screened rear Rebel Archer, while the Rebel Archer's ranged reach includes Zhang Fei in the rear row.
- The browser regression now exercises v1→v3 campaign migration, unique deployment placement, pre-battle doctrine selection, refresh restoration of deployment, combat lock, Guan Yu's and Zhang Fei's skills, Liu Bei's Rende healing of a wounded ally, skill cooldown/use persistence, deployment/doctrine/log restoration after reload, terminal battle result, restart through deployment, and the original RTS multiplayer flow.
- Evidence on candidate `1ae46c7e8f3c9d8df990629635a69304871b863f`: [GitHub Actions run 42436167559](https://github.com/ling-qian/age-of-ai/actions/runs/42436167559) passed the full workflow: `npm ci`, typecheck, production build, original RTS WebSocket smoke, M2-A 28/28, save migration/model 9/9, skill execution 14/14, deployment/class/doctrine 16/16, Playwright tactical browser regression, and original RTS two-browser regression.
- Source diff audit against `feature/m2c-deployment-rules` contains only `.github/workflows/three-kingdoms-m1-validation.yml`, `client/src/style.css`, `client/src/three-kingdoms/battle-engine.ts`, `client/src/three-kingdoms/campaign-save.ts`, `client/src/three-kingdoms/screen.ts`, and `scripts/m1_browser_regression.mjs`. No `server/`, `shared/`, original RTS simulation, lobby, or WebSocket files changed.


## 10. M2-C completion gate

M2-C is complete only when:
- Skill rules and deployment rules have deterministic headless test coverage.
- Browser tests verify skills, placement, targeting, battle resolution, persistence/reload, terminal result, and restart.
- Full CI passes: `npm ci`, typecheck, production build, original RTS smoke, M2-A/M2-C rules tests, M1 two-browser regression, and M2-C browser tests.
- A source diff audit confirms the RTS/server/network boundary remains unchanged.
- The acceptance record includes the exact commit SHA, CI link, and browser evidence.

All M2-C gates passed on candidate `1ae46c7e8f3c9d8df990629635a69304871b863f` in [GitHub Actions run 42436167559](https://github.com/ling-qian/age-of-ai/actions/runs/42436167559). M2-C is **COMPLETE / ACCEPTED / CI VERIFIED**. M3 campaign-map and recruitment work is now eligible as the next milestone, but has not been started.
