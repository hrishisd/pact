# An owner can add a reviewer at once, and that reviewer alone can approve anything

Status: done
Blocked by: none

## Decision

Adding a reviewer is told to the pact's current reviewers, with no approval (the recommended answer). The push's words and the "Pacts you review" setting were accepted as written below, with no prototype.

## Problem

Found in a review of the rules as an owner who wants to avoid penalties. Removing a reviewer needs approval. Adding one applies at once (`addReviewers`, `src/core/change-requests.ts`), and only the added reviewer is told (`tellPickedAsReviewer`). Any one reviewer decides an item, and the first decision is final (`decide`, `src/core/review.ts`).

So an owner whose pact is reviewed by a strict friend can add a lenient friend, or a second account of their own (an invite and a second Google account are enough). That reviewer can then approve the owner's evidence, excuses, a lower penalty, an end request, and payments to the pact's recipient. The strict reviewer is never told that a reviewer was added, and sees only that items left their queue decided.

The owner picks the reviewers at creation, so the app never guards against an owner with no honest reviewer. This ticket is about the narrower case: a reviewer who agreed to hold the owner to a pact can be routed around without knowing.

## What reviewers see today

Checked against the code. A pact's other reviewers are told nothing when a reviewer is added: `addReviewersNow` (`src/core/change-requests.ts`) tells only the added ones. They are also never told who decided an item: a decided item leaves their Review Queue, and only a reviewer who tries to decide it too gets `already-decided`. A reviewer has no pact page and no list of the pacts they review, so "show on the pact page who reviews it and since when" has nowhere to go without a new screen. That screen is left out of this ticket.

## What to build

Rule: when a reviewer is added to a pact, each reviewer the pact already had gets a push naming the new one. Adding still applies at once.

- In `addReviewersNow`, which both `addReviewers` and `changePact` go through, after the reviewers are stored: tell every reviewer the pact had before this call. Skip it when the pact's reviewers have not yet been told of the pact (`reviewers_notified_at` is null: the edit window has closed by the clock but the tick has not run `closeEditWindows`); they then learn of the pact with all its reviewers in place.
- New notification kind `reviewer-added` (`NotificationKind` and `NotificationDetails`, `src/core/ports.ts`), details `{ pactId, added }` with the added account ids.
  - Title: "Jordan added Sam as a reviewer". Two or more: "Jordan added Sam and Alex as reviewers", names sorted.
  - Body: "Gym · Sam can now decide its review items too." Two or more: "Gym · They can now decide its review items too."
  - It opens Review (`APP_PATHS.review`).
- A reviewer who waits to be removed by a change request is still a reviewer until it is approved, so they are told too.
- A call that adds nobody (each is already a reviewer) tells nobody. The added reviewers still get "Jordan added you as a reviewer", as now.
- No stored data changes and there is no migration. Reviewers added before this are not told.
- Not in this ticket: telling a pact's other reviewers of each decision. It would push every co-reviewer on every approved photo. With the notice above, a reviewer knows who else can decide and can ask.

The push follows a new notification setting, `reviewed-pact`, shared by tickets 42, 43 and 44; the first of the three to be built adds it. Add it to `NOTIFICATION_SETTINGS` (`src/shared/types.ts`), to `SETTING_OF_KIND` (`src/core/outbox.ts`) and to `SETTING_COPY` (`src/client/Notifications.tsx`) with the label "Pacts you review". Its hint lists what is built so far, for all three: "A friend added a reviewer, changed timezone, or had a vacation approved on a pact you review". It starts on, as every push setting does, and needs no migration (`notification_setting_off` holds only what is off). The randomised test keeps its own copy of the kind-to-setting map for `messages-follow-settings` (`src/core/testing/fuzz-invariants.ts`); add the new kind there.

`docs/behaviour.md`, Change requests: the line "Name, reminders and added reviewers apply at once … added reviewers are told they were picked" gains "and the pact's other reviewers are told who was added (`addReviewersNow`, `change-requests.ts`)". The Notifications section's list of settings gains the new one.

## The alternative

Adding a reviewer waits for a current reviewer's approval, as removing one does. It closes the loophole. It is not recommended: the honest reason to add a reviewer is that the current one has gone quiet, and no item expires, so the owner would need the quiet reviewer's approval to get a second one and every waiting item would stay stuck. The owner also picks every reviewer at creation, so approval here guards less than it seems to. It becomes worth it if penalties are ever paid to someone other than a recipient the owner chose.

## Tests to write first

Scenarios in `src/core/change-requests.test.ts`:

- `addReviewers` tells the pact's other reviewer, with the words above, and the added reviewer still gets their own push.
- `changePact` that adds a reviewer beside a term that waits tells the other reviewer at once.
- Adding two at once sends each earlier reviewer one push naming both; neither added reviewer gets this push.
- Adding someone who already reviews the pact tells nobody.
- With the setting off, the other reviewer gets nothing (`src/core/notifications.test.ts`).

In the randomised test, add an invariant to `src/core/testing/fuzz-invariants.ts`: after a command that adds a reviewer to a pact whose reviewers were told of it, every earlier reviewer with the setting on has a `reviewer-added` push for it.

## Prototype

User-visible, but small: one push and one row in notification settings, with no new screen. The words are all above. Recommended: approve or correct the words here and build directly. `docs/agents/prototype-first.md` makes this the human's choice.

## Acceptance criteria

- [x] A pact's reviewers are pushed when another reviewer is added, by either command.
- [x] The push follows the "Pacts you review" setting.
- [x] `docs/behaviour.md` (Change requests; Notifications and reminders) says so.
- [x] The scenarios above pass, and the randomised test checks it.
- [x] `npm run check` passes.

## Outcome

Built as planned. `addReviewersNow` (`change-requests.ts`), which `addReviewers` and `changePact` share, reads the pact's reviewers before adding, and after telling the added ones queues a `reviewer-added` push to each earlier reviewer, unless the pact's reviewers haven't been told of it yet (`reviewers_notified_at`). It reuses the `reviewed-pact` setting from ticket 42; the setting's hint is now "A friend added a reviewer or changed timezone on a pact you review".

Differs from the plan, or beyond it:

- Three or more added at once are named "A, B and C" in the title; the spec gave only one and two.
- `added` in the details lists the added reviewers sorted by name, as the title names them.
- The randomised test's new invariant, `added-reviewers-are-announced`, reads what a command queued from the outbox table (through `dump`), since whether a pact's reviewers were told of it shows in no query. Checked by breaking the push: seeds 4 and 6 (300 steps) then fail it.
- Tests: `change-requests.test.ts`, "a pact's other reviewers are told who was added"; `notifications.test.ts`, "Pacts you review turned off: a reviewer isn't told another was added".
- `npm run check` was run in its parts (shellcheck isn't installed where this was built, so its lint step wasn't run).
