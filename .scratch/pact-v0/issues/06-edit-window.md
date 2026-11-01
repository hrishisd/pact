# 06 The 10-minute edit window

Status: done
Blocked by: 02

Spec stories: 25, 27, 92. Rules: Creation and change.

## What to build

For 10 minutes after creation the owner can edit or delete a pact freely. Until this ticket a mistake in a pact can't be fixed in the app.

- **Edit:** reuses the create form, pre-filled, walking the steps from Goal and skipping the Source step (evidence kind never changes, not even here). Editing doesn't restart the 10 minutes. First-occurrence rules are re-applied against the original creation time. If the window closes while the form is open, the form gives way to "The 10 minutes are up" with Back to pact, and the changes aren't saved.
- **Delete:** a sheet asks first: "This action can't be undone." It removes the pact with no trace. A pact deleted inside the window notifies nobody.
- **When the window closes**, each reviewer is notified that they've been picked for a new pact (the "picked as a reviewer" kind, opening Review). This is the only notification about a new pact.
- **Evidence submitted inside the window** waits: no reviewer sees it or hears about it until the window closes, after their "picked as a reviewer" notification. Deleting the pact removes it. An edit that takes its day off the schedule removes it too.
- **Screens:** a blue "New · edit for 7 min" chip next to the name and a blue left edge on Today and in Pacts; pacts in their edit window sort to the top of Pacts. The pact page has a blue bar at the top saying "Feel free to edit or delete for 7 more minutes." with Edit and Delete. All of it goes away on its own when the window closes, without a reload.
- **Prototype:** branch `prototype/edit-window`, `.scratch/pact-v0/prototype/edit-window.prototype.html`. It settled option A (walk the steps) over opening on the Check step.

## Acceptance criteria (core scenarios)

- [x] Edit at minute 5 and minute 9 succeeds; at minute 10 it's refused. The window still closes at minute 10 after an edit at minute 9.
- [x] Changing the evidence kind is refused even inside the window.
- [x] Created and deleted within 10 minutes → reviewers get no notification.
- [x] Not deleted → each reviewer gets exactly one "picked as a reviewer" notification at minute 10, including across a restart.
- [x] Edit that swaps the reviewer → only the final reviewer is notified.
- [x] Evidence submitted inside the window → no reviewer sees or hears of it until the window closes; deleted with the pact.
