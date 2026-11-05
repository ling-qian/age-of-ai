# M1 Three Kingdoms Acceptance and Freeze Record

Branch: `feature/three-kingdoms-mvp`

Status: **ACCEPTED / FROZEN — M2-A AUTHORIZED**

M2 is blocked until every mandatory gate below passes on the same candidate commit and this record is completed and frozen.

## Candidate record

| Field | Result |
|---|---|
| Accepted M1 candidate SHA | `107c62db98baa19267a4e8d131bc5443f35468fc` |
| Test date and environment | 2026-11-05 · GitHub Actions `ubuntu-latest` · Node.js 20 · Headless Chromium · local Node/WebSocket server + Vite client · [run 42052146411](https://github.com/ling-qian/age-of-ai/actions/runs/42052146411) |
| Tester | Automated end-to-end acceptance on two isolated Chromium browser contexts |
| M1 decision | ACCEPTED / FROZEN. Exact code candidate preserved at `m1-freeze/107c62d`. |

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
| `npm ci` | PASS | Run 42052146411, step 4 |
| `npm run typecheck` | PASS | Run 42052146411, step 5 |
| `npm run build` | PASS | Run 42052146411, step 6 |
| `npm run smoke` | PASS | Run 42052146411, step 7 |

All four must pass. Record failures verbatim; do not mark acceptance based only on code review or JSON validation.

## Gate 2 — Original Age of AI multiplayer regression

Use at least two separate browser sessions/devices against the same running environment.

- [x] Original Age of AI entry screen loads.
- [x] Host can create a multiplayer room.
- [x] Second client can join the same room.
- [x] Both clients can ready up and start the match.
- [x] Both clients observe synchronized live match state.
- [x] Each client can perform normal gameplay actions and observe the expected result on the other client.
- [x] Players can exit/return without breaking the original entry or room flow.
- [x] No new Three Kingdoms screen or save state interferes with the RTS match.

Result: **PASS**

Environment / room / browser details / evidence:
- CI run `42052146411`, head `107c62d`; local Node/WebSocket server on port 8080 and Vite client on 5199.
- Two isolated Chromium browser contexts used separate names and independent browser storage.
- Verified create room, remove helper bot, join, ready, start, both clients receive snapshots, both issue move commands and observe each unit's changed position, chat delivery, host leaves via two-step in-game confirmation, other player sees game-over, and both return to lobby.
- This validates the running local application in CI. It does not claim a public production deployment or two physical devices were tested.

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
- Two RTS browsers create/join a room, ready/start a match, each issue a villager
  move order through the real HUD, and both observe the same authoritative unit movement.
- RTS chat reaches the second browser after the match starts.
- Host exit, opponent game-over, and both players' return to lobby are verified.
- No uncaught browser page errors occur.

Evidence: [M1 browser CI run 42052146411](https://github.com/ling-qian/age-of-ai/actions/runs/42052146411), which completed successfully on candidate `107c62d`.

Scope note: This is a real local client/server runtime exercised in two isolated headless Chromium sessions on GitHub Actions. It does not claim a public production deployment or two physical devices were tested; those remain deployment/device checks outside this M1 code freeze.

## Gate 3 — Three Kingdoms mode regression

- [x] Original Age of AI name screen still renders.
- [x] **Play Three Kingdoms** opens the new mode without creating an RTS room or mutating the RTS flow.
- [x] Opening event is **The Peach Garden Oath** and shows exactly three choices.
- [x] Test each choice in a separate fresh campaign and verify the displayed stats/effects.
- [x] A choice cannot be applied twice in one campaign.
- [x] **Proceed to the Yellow Turban Rebellion** opens the first-battle briefing and 3-vs-3 roster.
- [x] Refresh on the opening event and battle-entry panel; verify the dedicated campaign save restores the expected choice and stage.
- [x] **Restart opening** resets only the Three Kingdoms campaign save.
- [x] **Back to Age of AI** returns to the original entry path, which remains usable.
- [x] No console/runtime error appears during these flows.

Result: **PASS**

Environment / browser / evidence:
- Run `42052146411`, commit `107c62d`, three fresh Chromium contexts (one per choice).
- Each choice's exact resource effects, single-application lock, refresh restoration on the opening event, continuation to the 3v3 briefing, refresh restoration of `battle-entry`, six roster entries, restart isolation (RTS name and settings preserved), and return to the original Age of AI entry screen passed.
- Browser run reported `ALL M1 BROWSER REGRESSION CHECKS PASSED`.

## Gate 4 — Acceptance record and freeze

Only complete this section after Gates 1–3 pass.

| Requirement | Result |
|---|---|
| All automated checks passed on candidate SHA | PASS — `107c62d` |
| Original RTS multiplayer test passed | PASS — two-browser CI runtime regression |
| Three Kingdoms navigation/save test passed | PASS — all three choices and both save stages |
| Results and evidence recorded above | PASS — CI run `42052146411` and browser logs |
| Candidate commit frozen as accepted M1 | PASS — branch `m1-freeze/107c62d` points to exact candidate SHA |
| M1 acceptance decision / reviewer | ACCEPTED — automated gates and browser regression; reviewer recorded as automated CI evidence |

M1 is **ACCEPTED / FROZEN** at `107c62db98baa19267a4e8d131bc5443f35468fc`. M2-A implementation is authorized on the feature branch. Keep the frozen branch unchanged.

## M1 scope boundary

M1 includes the separate entry point, story-choice loop, dedicated local save, and Yellow Turban battle briefing only. M1 does not include playable tactical combat.

## M2 scope — M2-A IMPLEMENTATION AUTHORIZED

After M1 is accepted and frozen, implement the complete deterministic 3v3 battle in a new independent `client/src/three-kingdoms/battle-engine.ts`, with dedicated battle-rule tests:
- Infantry, archers, and light cavalry troop counters.
- Formation selection.
- Action/turn order.
- Deterministic damage resolution.
- Victory and defeat determination.
- Readable English battle logs.

Do not rewrite or reuse the existing Age of AI RTS battle/simulation engine as the implementation base. Do not change the original RTS multiplayer server or WebSocket protocol for Three Kingdoms combat.
