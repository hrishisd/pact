# Email notifications

Current rules: `docs/behaviour.md`. This spec records the design as it was decided.

Status: needs-triage

Designed in a grilling session on 2026-11-13. Vocabulary follows `GLOSSARY.md`. Every decision below is settled, except the layout of the settings screen and the look of the emails, which the prototype settles. The tickets under `issues/` will build it.

## Problem statement

Push is Pact's only channel. Two people miss what it says.

- **A reviewer who doesn't open the app.** An owner's evidence, excuses, payments and change requests wait on their reviewers. A reviewer who has no push, or ignores it, holds up the owner. The pact-v0 spec named this case when it listed email as a future idea.
- **The operator after a restore.** An operator alert is a log line plus a push to the operator's account. The push subscription lives in the database, so after a restore from an old backup the push may not arrive. Two of the four operator alerts are never pushed at all. ADR 0002 says operator alerts should go by email once email exists.

## Solution

Two opt-in **daily emails**, and **operator alert emails**.

- A reviewer can turn on an email that lists the items in their Review Queue that have waited more than 24 hours. An owner can turn on an email that lists reviewers' questions they have left unanswered for more than 24 hours. Each goes at 09:00 in the account's timezone, the same moment as the existing daily push, and only when it has something to list. Both are off to start with. They go in addition to push, not instead of it.
- Every operator alert also goes by email to the operator address in Fly secrets, sent straight from the server so that it doesn't depend on the database.
- Pact sends from a Gmail account made just for Pact, through Gmail's mail server. The sending code sits behind its own port, so a provider such as Resend can replace it later.

Nothing else is emailed. This is not a full second channel.

## User stories

1. As a reviewer who doesn't open the app, I want one email a day listing what has waited in my Review Queue for more than 24 hours, so that I don't hold up my friend.
2. As a reviewer, I want that email to say, for each item, the pact, the owner, what the item is and how long it has waited, so that I know what's waiting without opening the app.
3. As a reviewer, I want a link from each item in the email to that item in the app, so that I can decide it in a tap or two.
4. As an owner, I want one email a day listing reviewers' questions I haven't answered for more than 24 hours, so that my excuses and evidence don't stall on me.
5. As a person, I want no daily email on a day with nothing to list, so that every email means there's something to do.
6. As a person, I want both daily emails off until I turn them on, so that nobody gets email they didn't ask for.
7. As a person, I want to turn each daily email on or off on its own in Profile's notification settings, next to the push settings, so that I choose what reaches my inbox.
8. As a person, I want a daily email to work whatever my push settings are, so that I can turn a push off and keep only the email.
9. As a person, I want the settings to show the address the email goes to, my Google sign-in address, so that I know where to look.
10. As a person, I want each email to end with a link to the notification settings and a line saying why I got it, so that I can turn it off.
11. As a person, I want no photos, excuse reasons, questions or replies in an email, so that what I share with reviewers stays in the app.
12. As the operator, I want every operator alert by email, as well as the push, so that I learn about problems even when the push can't reach me.
13. As the operator, I want an operator alert email to arrive after a restore from an old backup, so that I learn how much data was lost.
14. As the operator, I want an operator alert when a daily email has failed to send for 24 hours, so that I know a friend isn't getting it.

## Implementation decisions

### What is emailed

- **Two daily emails, the email copies of today's two daily pushes** (`stale-items.ts`). The reviewer's lists every item in the Review Queue that had waited more than 24 hours at that day's 09:00, oldest first. The owner's lists every reviewer question unanswered for more than 24 hours, oldest first. The push names only a count and the oldest item; the email lists them all.
- **Same timing as the push.** 09:00 in the account's timezone, at most one of each per day, restart or not, and none on a day with nothing to list.
- **Operator alerts, all four:** reminders dropped after downtime, the database restored from backup, an Oura refresh token refused after a lost answer, and an AnkiWeb protocol error. A fifth alert is new: a daily email given up after 24 hours of failures (see Sending).
- **Not emailed:** owners' pact reminders (email is too slow for a reminder minutes before a due time), and every other notification kind. They stay push only.

### Settings

- **Two new settings, both off to start with.** One per daily email. Each is independent of the push settings: today the reviewer's daily push follows the Review item setting and the owner's follows Comment, and turning either off does not stop the email. Existing push settings start on and stay that way.
- **Where they show.** Profile's notification settings, next to the push settings, with the address the email goes to. The prototype settles the layout: one list with Push and Email columns, or the push list unchanged with an Email section below.
- **The address** is the account's Google sign-in email, already stored (`account.email`). It can't be changed in v1.
- **The operator's address** is the `OPERATOR_EMAIL` Fly secret, already read by `config.ts`. Operator alert emails can't be turned off, like their push.

### What an email says

- **Daily emails.** For each item or question: the pact's name, the owner (for a reviewer) or the reviewer who asked (for an owner), what the item is (evidence, an excuse, a payment, a change request or a vacation), and how long it has waited. A plain link to each item, and one to the Review Queue or Today. No photos, and no free text: no excuse reasons, notes, questions or replies.
- **The footer** says why the person got the email and links to the notification settings.
- **Links are plain app links**, the same paths the pushes open. On an iPhone, a link in Mail opens Safari, which has its own sign-in apart from the home-screen app, so the first tap may ask the person to sign in with Google once. Sessions are long-lived, so this happens rarely. A one-time sign-in link was rejected: anyone the email is forwarded to could use it, and mail scanners that open links on their own would spend it.
- **Operator alert emails** are plain text: the same words as the `OPERATOR_ALERT` log line.
- The prototype settles the subject lines, copy and look.

### Sending

- **A dedicated Gmail account**, made just for Pact, sends through Gmail's mail server (`smtp.gmail.com`, port 587) with an app password. The address and the app password live in Fly secrets. A dedicated account limits a leaked secret to that account: an app password opens the whole mailbox, not only sending. Replies from friends land in that account's inbox.
- **Resend was the alternative** (a verified sending domain on `hrishisd.com`, whose DNS is on Cloudflare and has no mail records yet). It is deferred, not rejected: the port makes it a one-adapter change if Gmail delivery proves unreliable or lands in spam.
- **A new port, not a wider `Notifier`.** `Notifier.deliver` takes push devices and reports expired endpoints, which email has no use for. Email gets its own port (a sketch: `send({ to, subject, text, html })`), with a Gmail adapter in `src/server` or `src/core/adapters.ts` and a fake in `src/core/testing/`, as `CODING_STANDARDS.md` asks for any outside effect.
- **Daily emails go through the outbox**, as one row per channel: the push row and the email row are separate, each checked against its own setting when it's queued. The outbox already has a `channel` column, always `'push'` so far.
- **Retries.** A failed daily email is retried on each scheduler tick for up to 24 hours from when it was queued. Then it's given up: marked so, logged, and raised as an operator alert that goes to the log and the operator's push (not by email, since email is what failed).
- **Operator alert emails skip the outbox and the database.** They're sent from the server's operator alert path, to the address from Fly secrets, so they still go after a restore from an old backup. The two adapter alerts (Oura, AnkiWeb), which today only write a log line, go through the same path. A failed operator alert email is logged; there is no retry queue for it.
- **No bounce handling, unsubscribe headers or rate limits.** There are about 5 users. Gmail's own daily sending limit is far above what Pact sends.

### Docs this changes

- `GLOSSARY.md`: Daily email, Operator alert, and Notification setting widened to cover email.
- ADR 0002: its Notifications and Operator alerts bullets point here; they change to describe what's built when the tickets land.
- The pact-v0 spec's Email notifications future idea points here.
- `docs/behaviour.md`, in each ticket that changes a rule.

## Testing decisions

- The daily emails are scenarios through `scenario()` with the fake clock, alongside `stale-items.test.ts`: for example "Sam turns on the daily Review Queue email; Jordan's evidence has waited 25 hours at Sam's 09:00; Sam gets one email listing it, and none the next day once it's decided".
- Each rule needs a scenario: off by default, the email without the push and the push without the email, nothing to list sends nothing, at most one a day across a restart, the timezone, the item list and its order, the 24-hour give-up and its operator alert.
- Operator alert emails: each of the four alerts reaches the fake email port with the operator address, including after a restore, when the database has no push subscription for the operator.
- The Gmail adapter is tested at its seam against a fake mail server, or left to a manual check if that costs more than it proves.
- The settings screen gets a `*.test.tsx` test, and is checked in the browser at 390×844 against the prototype, with screenshots.
- Real delivery to an iPhone inbox, and whether it lands in spam, is checked by hand (`manual-checks.md`).

## Out of scope

- A full email channel: an email for every notification kind, or immediate emails such as "new item in your Review Queue". The daily email can be followed by immediate ones later if a day proves too slow.
- Owners' pact reminders by email.
- Choosing the time of the daily email, or a separate address.
- Acting on an item from the email (approve or reject by link): reviewers need to see the evidence, and a link that decides is a security risk.
- A one-time sign-in link in the email.
- Bounce handling, `List-Unsubscribe` headers and rate limits.
- A verified sending domain and a provider such as Resend (deferred; see Sending).
- Text messages, still a future idea in the pact-v0 spec.

## Prototype

To come: `prototype/email-notifications` branch (local, not pushed). It shows the two settings layouts side by side, the reviewer's and the owner's daily emails as they'd look in iPhone Mail, and an operator alert email.
