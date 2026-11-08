# 12 Reviewer questions and owner replies

Status: done
Blocked by: 03

Spec stories: 57, 58. Rules: Review (asking a question).

## What to build

A reviewer can ask the owner about any review item instead of deciding it; the item waits on the owner until they reply.

- **Ask** on the Review screen adds a comment to the item's thread. The item is waiting on the owner whenever the latest comment is a reviewer's.
- While waiting on the owner, the item leaves every reviewer's queue (and the badge count), and is listed below the current item in Review as waiting on the owner's reply.
- The owner gets a **reviewer question awaiting reply** alert on Today and a notification (comment kind). Replying sends the item back into every reviewer's queue and notifies them.
- A reviewer can still decide an item that's waiting on the owner.
- Works for every item kind (Evidence, Excuse, Payment, Change request).
- Review queue order: change requests first, then everything else oldest first.

## Acceptance criteria (core scenarios)

- [x] Reviewer asks about evidence → queue count drops to 0 for both reviewers, owner sees the alert → owner replies → back in both queues, alert resolved.
- [x] An occurrence whose evidence is waiting on the owner's reply at midnight stays not judged yet.
- [x] Queue order: a change request filed after two evidence items still comes first.

## Comments

**Prototype round 1 (2026-11-03):** `.scratch/pact-v0/prototype/changes.prototype.html`, Ask tab. Option B was chosen: the Today alert's Reply opens the item's page with the thread and a reply box. Replies are text only. See the spec's Screens (Reviewer questions).

- 2026-11-03: Built on branch claude/unblocked-tickets-prototypes-361pre (stacked on ticket 08's branch). Pending human review, so Status stays ready-for-agent. Core scenarios are in src/core/reviewer-questions.test.ts. Evidence and payments had no owner page, so this adds /evidence/:id and /payments/:id for the reply thread. Asking notifies only the owner; other reviewers just see the item leave their queue and appear under "Waiting on {owner}'s reply". A new "Comment" notification setting covers questions and replies.

- 2026-11-08: The human confirmed the choices listed for this ticket under "Decisions to confirm" in `manual-checks.md`, so the review is done and the Status is `done`. The phone checks in `manual-checks.md` are still open; a bug found there becomes a new ticket.
