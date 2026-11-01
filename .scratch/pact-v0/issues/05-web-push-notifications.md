# 05 Web Push notifications, iPhone setup and notification settings

Status: ready-for-agent
Blocked by: 01

Spec stories: 3, 34, 61, 88. ADR 0002 (Notifications, Operator alerts).

## What to build

Real delivery for the notifications the core already records, so a reviewer learns about an item without opening the app.

- **Web Push** sent directly from the server with VAPID keys (keys in Fly secrets). No push service in between.
- **Delivery after commit:** the outbox written in a command's transaction (ticket 01) is delivered after commit. A crash may cause a duplicate, never a loss. Expired subscriptions are removed when the push service says so.
- **Push subscriptions** stored per device in the database.
- **iPhone setup guide** (story 3): step-by-step instructions for adding Pact to the home screen and turning on push. Push permission can only be requested from the installed app on iOS, so the guide detects whether it's running standalone.
- **Notification settings** in the profile (story 88): one on/off per kind (picked as a reviewer on a new pact, new review item, decision, comment, Missed occurrence, Connection problem, new bill, overdue bill). This ticket shows only the three kinds it wires up; later tickets add theirs here, because a switch that does nothing misleads. Grouped block, not tappable rows.
- **How you reach the guide (prototype, option A):** an alert above Today until push is on or you tap Not now, which clears it for good on that device. It opens the guide as a pushed page. The profile's Notifications section keeps a way back. Prototype: branch `prototype/web-push`, `.scratch/pact-v0/prototype/web-push.prototype.html`.
- Wire up the kinds that exist so far: **new review item** to reviewers (evidence, payment), **decision** to the owner, **Missed occurrence** to the owner.
- **Operator alerts** also go by Web Push to the operator's account, besides the `OPERATOR_ALERT` log line.

## Acceptance criteria

- [x] Core: submitting evidence records one new-review-item notification per reviewer; approving records one decision notification to the owner; a Missed judgment records one to the owner.
- [x] Core: a kind turned off in settings records nothing for that account.
- [x] Core: a command that fails mid-way records no notifications (failing-port scenario).
- [ ] Manual: on a real iPhone, install to the home screen, enable push, and receive a push when a friend's evidence lands in your queue.
