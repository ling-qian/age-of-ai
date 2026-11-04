# M1 Three Kingdoms Manual Acceptance

Branch: `feature/three-kingdoms-mvp`

## Automated checks

Run from the repository root:

```bash
npm ci
npm run typecheck
npm run build
npm run smoke
```

Do not mark M0/M1 as passed unless all required commands complete successfully. Record failures verbatim before changing dependencies or code.

## Browser checks

1. Start the existing server and client using the documented development commands.
2. Confirm the original Age of AI name screen still renders.
3. Click **Play Three Kingdoms** without entering a multiplayer name. Confirm it opens the new mode without creating a room or changing the RTS flow.
4. Confirm the opening event is **The Peach Garden Oath**, with exactly three choices.
5. Select each choice in separate test runs and confirm the result text and stats reflect the selected choice.
6. Confirm choices cannot be applied twice in one campaign.
7. Click **Proceed to the Yellow Turban Rebellion** and confirm the first-battle briefing, objective, and 3-vs-3 roster are displayed.
8. Refresh while on the opening event and while on the battle-entry panel; confirm the dedicated local save restores the selected choice and current stage.
9. Click **Restart opening** and confirm only the Three Kingdoms campaign save resets.
10. Click **Back to Age of AI** and confirm the existing name/lobby/RTS path remains accessible.

## M1 scope boundary

The battle entry is a briefing only. Tactical turns, hit/damage calculations, formations, and battle resolution are M2. No claim of production deployment or runtime test success is made by this document.
