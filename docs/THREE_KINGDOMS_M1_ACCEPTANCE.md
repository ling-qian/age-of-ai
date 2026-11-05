# M1 Three Kingdoms Acceptance and Freeze Record

Branch: `feature/three-kingdoms-mvp`

Status: **PENDING — DO NOT START M2**

M2 is blocked until every mandatory gate below passes on the same candidate commit and this record is completed and frozen.

## Candidate record

| Field | Result |
|---|---|
| Candidate commit SHA | PENDING |
| Test date and environment | PENDING |
| Tester | PENDING |
| M1 decision | PENDING — not accepted or frozen |

## Gate 1 — Automated checks

Run from the repository root on the candidate commit:

```bash
npm ci
npm run typecheck
npm run build
npm run smoke
```

| Check | Result | Notes / log reference |
|---|---|---|
| `npm ci` | PENDING | |
| `npm run typecheck` | PENDING | |
| `npm run build` | PENDING | |
| `npm run smoke` | PENDING | |

All four must pass. Record failures verbatim; do not mark acceptance based only on code review or JSON validation.

## Gate 2 — Original Age of AI multiplayer regression

Use at least two separate browser sessions/devices against the same running environment.

- [ ] Original Age of AI entry screen loads.
- [ ] Host can create a multiplayer room.
- [ ] Second client can join the same room.
- [ ] Both clients can ready up and start the match.
- [ ] Both clients observe synchronized live match state.
- [ ] Each client can perform normal gameplay actions and observe the expected result on the other client.
- [ ] Players can exit/return without breaking the original entry or room flow.
- [ ] No new Three Kingdoms screen or save state interferes with the RTS match.

Result: **PENDING**

Environment / room / browser details / evidence:
- PENDING

## Automated browser regression

The CI workflow `.github/workflows/three-kingdoms-m1-validation.yml` runs
`scripts/m1_browser_regression.mjs` in headless Chromium against the branch's
local Node/WebSocket server and Vite client. It uses two isolated browser
contexts for the original RTS multiplayer flow and separate fresh contexts for
each of the three Three Kingdoms opening choices.

The browser suite verifies:
- Each opening choice applies its exact resource effects once.
- Refresh restores the selected choice and its resource state.
- The first-battle briefing displays both three-unit rosters.
- Restart resets only the Three Kingdoms campaign save and preserves RTS name/settings.
- Two RTS browsers create/join a room, ready/start a match, each train a villager
  through the real HUD, and both observe the resulting authoritative snapshots.
- RTS chat reaches the second browser after the match starts.
- No uncaught browser page errors occur.

CI evidence is useful automated browser evidence, but it does not claim that the
current production deployment or two physical devices were tested. Record any
additional deployed-environment/manual results separately.

Current result: **PENDING — awaiting the browser CI run**.

## Gate 3 — Three Kingdoms mode regression

- [ ] Original Age of AI name screen still renders.
- [ ] **Play Three Kingdoms** opens the new mode without creating an RTS room or mutating the RTS flow.
- [ ] Opening event is **The Peach Garden Oath** and shows exactly three choices.
- [ ] Test each choice in a separate fresh campaign and verify the displayed stats/effects.
- [ ] A choice cannot be applied twice in one campaign.
- [ ] **Proceed to the Yellow Turban Rebellion** opens the first-battle briefing and 3-vs-3 roster.
- [ ] Refresh on the opening event and battle-entry panel; verify the dedicated campaign save restores the expected choice and stage.
- [ ] **Restart opening** resets only the Three Kingdoms campaign save.
- [ ] **Back to Age of AI** returns to the original entry path, which remains usable.
- [ ] No console/runtime error appears during these flows.

Result: **PENDING**

Environment / browser / evidence:
- PENDING

## Gate 4 — Acceptance record and freeze

Only complete this section after Gates 1–3 pass.

| Requirement | Result |
|---|---|
| All automated checks passed on candidate SHA | PENDING |
| Original RTS multiplayer test passed | PENDING |
| Three Kingdoms navigation/save test passed | PENDING |
| Results and evidence recorded above | PENDING |
| Candidate commit frozen as accepted M1 | PENDING |
| M1 acceptance decision / reviewer | PENDING |

Until every row is verified, M1 remains **PENDING** and M2 remains **BLOCKED**.

## M1 scope boundary

M1 includes the separate entry point, story-choice loop, dedicated local save, and Yellow Turban battle briefing only. M1 does not include playable tactical combat.

## M2 scope — explicitly not started

After M1 is accepted and frozen, implement the complete deterministic 3v3 battle in a new independent `client/src/three-kingdoms/battle-engine.ts`, with dedicated battle-rule tests:
- Infantry, archers, and light cavalry troop counters.
- Formation selection.
- Action/turn order.
- Deterministic damage resolution.
- Victory and defeat determination.
- Readable English battle logs.

Do not rewrite or reuse the existing Age of AI RTS battle/simulation engine as the implementation base. Do not change the original RTS multiplayer server or WebSocket protocol for Three Kingdoms combat.
