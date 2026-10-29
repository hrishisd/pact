# 06 The 10-minute edit window

Status: ready-for-agent
Blocked by: 02

Spec stories: 25, 27, 92. Rules: Creation and change.

## What to build

For 10 minutes after creation the owner can edit or delete a pact freely. Until this ticket a mistake in a pact can't be fixed in the app.

- **Edit:** reuses the create form, pre-filled, skipping the Source step (evidence kind never changes, not even here). Editing doesn't restart the 10 minutes. First-occurrence rules are re-applied against the original creation time.
- **Delete:** removes the pact with no trace. A pact deleted inside the window notifies nobody.
- **When the window closes**, each reviewer is notified that they've been picked for a new pact (the "picked as a reviewer" kind). This is the only notification about a new pact.
- **Screens:** a blue "New · edit for 7 min" chip next to the name and a blue left edge on Today and in Pacts; pacts in their edit window sort to the top of Pacts. The pact page has a blue bar at the top with minutes left, Edit and Delete. All of it goes away on its own when the window closes, without a reload.

## Acceptance criteria (core scenarios)

- [ ] Edit at minute 5 and minute 9 succeeds; at minute 10 it's refused. The window still closes at minute 10 after an edit at minute 9.
- [ ] Changing the evidence kind is refused even inside the window.
- [ ] Created and deleted within 10 minutes → reviewers get no notification.
- [ ] Not deleted → each reviewer gets exactly one "picked as a reviewer" notification at minute 10, including across a restart.
- [ ] Edit that swaps the reviewer → only the final reviewer is notified.
