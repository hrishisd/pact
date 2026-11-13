# 02 Daily summary: the setting, the email, and its retries

Status: ready-for-agent
Blocked by: 01

Spec: `../spec.md` stories 1 to 11 and 14, and the Implementation decisions sections "What is emailed", "Settings", "What an email says" and "Sending". The screens and email follow the prototype's round 2.

## What to build

A person can turn on one email, the daily summary. At 09:00 in their timezone, if anything has waited more than 24 hours, it lists the items in their Review Queue and the reviewers' questions they haven't answered, in one email.

### Core
- **A new setting, off to start with,** independent of the push settings. Today every setting starts on, stored as a row in `notification_setting_off`; this one starts off, so it needs its own storage or an inverted row. Exposed through `AccountView` beside `notificationSettings`, with a command to turn it on and off.
- **Building the email** in `stale-items.ts`, beside `remindStale`: at most one per account per day since that day's 09:00, restart or not (extend `stale_notice`), none when both lists are empty. It's queued whatever the push settings are, and the two pushes stay as they are.
- **Contents.** Subject "Pact Daily Summary". Section "Items waiting for your review": every item in the Review Queue that had waited more than 24 hours at 09:00, oldest first, each with the owner, what it is, the pact (a payment's recipient, a vacation's dates) and how long it has waited; one link to the Review Queue. Section "Questions waiting for your reply": every reviewer question unanswered that long, oldest first, each with the reviewer who asked, the item and pact, and how long ago; one link to Today. Each section only when it has something. No photos and no free text. A one-line count first ("4 items wait for your review. 2 questions wait for your reply."), which Mail shows as the preview. Each section's link is a button. A footer saying why they got it, with "Turn it off in Profile" linking to Profile. Plain text and simple HTML; the email copy follows the prototype.
- **Through the outbox** as a row with channel `'email'`, to the account's Google sign-in email. Delivery calls the email port from ticket 01, not `Notifier`. A failed send is retried each tick; 24 hours after it was queued it's given up, logged, and raised as an operator alert by log and push only (not by email).

### Client
- **Profile's notification settings:** the push list unchanged, then an Email section with one "Daily summary" switch, its hint, and "Sent to <email>, your Google address." Copy as in the prototype.

### Docs
- `docs/behaviour.md`, "Notifications and reminders": the daily summary's rules.
- Point the pact-v0 spec's future idea at the built feature, and set the spec's Status once both tickets are done.

## Acceptance criteria (core scenarios)

- [x] Off by default: a new account gets no email, whatever waits.
- [x] Sam turns it on. Jordan's evidence has waited 25 hours at Sam's 09:00: Sam gets one email listing it under "Items waiting for your review", and none the next day once it's decided.
- [x] Only the questions section: Jordan has a question from Sam unanswered for 25 hours and nothing in their queue; the email has only "Questions waiting for your reply".
- [x] Both sections in one email for someone who is an owner and a reviewer; never two emails on one day, across a restart too.
- [x] Nothing older than 24 hours: no email.
- [x] With the Review item and Comment push settings off, the email still goes; with the summary off, the pushes still go.
- [x] A payment shows its recipient and a vacation its dates in place of the pact.
- [x] 09:00 is in the account's timezone.
- [x] A send that keeps failing is retried each tick and given up after 24 hours, with an operator alert by log and push and no email.
- [x] Routes for reading and changing the setting (`src/server/app.test.ts`), and a `*.test.tsx` test for the Email section.
- [x] The Email section checked in the browser at 390×844 against the prototype, with screenshots.
- [x] `npm run check` passes.
- [ ] Manual: a real daily summary reaches a friend's inbox, not spam (`../manual-checks.md`).
