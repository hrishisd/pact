# 02 Invite a friend and create a Camera Fixed-days pact

Status: ready-for-agent
Blocked by: 01

Spec stories: 4, 6–9, 10, 11, 14, 20–22, 24, 26 (Fixed days only), 83 (Active only), 91.

## What to build

An owner invites a friend, then makes a Camera pact on a Fixed-days schedule with that friend as reviewer. The pact is Active at once and shows on Today and in Pacts.

### Friends
- **Create invite:** a single-use link that expires 7 days after creation, shared with the phone's share sheet (Web Share API, with copy-link fallback).
- **Invite page:** says plainly that accepting makes you friends, so the inviter can pick you to review their pacts and you can pick them (story 7). Sign in with Google, then Accept. This is the second way an account can be created (ticket 01 only allowed the operator).
- Accepting creates a **Friendship** between the two accounts. A used or expired link shows a clear message and creates nothing.
- Profile lists friends (grouped block, not tappable).
- First screen for a new user (empty Today) suggests inviting a friend and creating a pact (story 4).

### Recipients
- Saved list per owner. Add a **person** recipient (pick a friend) or an **organization** (name and link).

### Create pact (step-by-step form)
- Source → Goal → Schedule → Penalty → Reviewers → Check → Create pact, per the Screens section. Reminders step comes in ticket 13.
- **Source:** Camera and Oura Ring tiles. Only Camera works in this ticket; Oura Ring shows as not available yet (ticket 08 enables it).
- **Goal:** name, then "What will your photo show?" (description).
- **Schedule:** Fixed days only (weekday picker, including every day). Weekly count, One-time, due-by time, start date and end date come in tickets 14–16.
- **Penalty:** amount in USD and a recipient from the saved list, or add one inline.
- **Reviewers:** pick from friends. The core accepts one or more and rejects zero or a non-friend.
- **Check:** says the pact is Active as soon as it's created and names its first occurrence (e.g. "Wed Oct 21, due midnight").
- Evidence kind is stored on the pact and can never change.

### First occurrence
- The first scheduled day whose due time (midnight at the end of that day, in the owner's timezone) is at least 1 hour after creation.

### Screens
- **Today:** a To do card for a Fixed-days pact whose occurrence is open today, showing the name, the penalty as a bare red amount ("$5") and "Due at midnight · 16h 19m" in orange. A pact whose first occurrence hasn't opened yet shows under **Coming up** ("Opens Thu Oct 22"). Recurring pacts on days they aren't due don't appear. Submitting evidence comes in ticket 03.
- **Pacts tab:** Active pacts as separate tappable cards with a › chevron and a red penalty amount.
- **Pact page:** the pact's terms ("$5 per miss", schedule, recipient, reviewers, description). Opening it from Today pushes the page and Back returns to Today.

## Acceptance criteria (core scenarios)

- [x] Invite accepted within 7 days creates a friendship both ways; a second accept of the same link and an accept after 7 days are refused.
- [x] An owner can pick only friends as reviewers or person recipients.
- [x] Created at Mon 23:30 on a daily pact → first occurrence is Tuesday (Monday's midnight is under an hour away). Created Mon 10:00 → Monday.
- [x] Today lists the open pact as To do and a not-yet-open one as Coming up, and leaves out a Mon/Wed/Fri pact on Tuesday.
- [x] Days are computed in the owner's timezone (test with a non-UTC zone).
- [ ] Manual: invite a second Google account on a phone, accept, create a pact with them as reviewer.

## Out of this ticket

Edit window (06), reminders (13), other schedules and time fields (14–16), Oura (08).

## Comments

**2026-10-29: implemented in code; manual phone check outstanding.**

Done and checked locally (typecheck, lint, 112 tests, build). The core has invites (single-use, 7-day expiry), friendships, saved recipients (person or organization), Camera Fixed-days pacts, the first-occurrence rule, and Today's To do / Coming up sections. The server routes are in `src/shared/api.ts`. The client has the invite page, Friends in Profile with share/copy, the new-user Today suggestion, the step-by-step create form, Pacts cards and the pact page. The five core criteria above are covered by scenario tests: `invites.test.ts`, `recipients.test.ts`, `pacts.test.ts` and `today.test.ts`, with Pacific/Auckland as the non-UTC zone alongside the harness's America/New_York. The invite flow over HTTP is covered in `app.test.ts`.

Decisions:
- The invite token rides in Better Auth's OAuth state (`additionalData`), not a cookie. The first new account that signs in with a token claims the invite, so a forwarded link can't let a second stranger in (story 8). Only the claimant can accept it.
- Accepting your own invite, or one from someone who is already your friend, is refused and leaves the link usable.
- Adding a friend who is already a recipient returns the existing recipient.
- A pact that isn't yours is a `pact-not-found` refusal (200), not a 404.
- The first occurrence's local date is stored on the pact. Its due time is recomputed in the owner's current timezone, so a later timezone change shifts it. Revisit if that matters.
- Main kept over the prototype: the "checked by your friends" tagline, the plain empty-state copy (new-user Today keeps "Nothing to do right now" and adds "Invite a friend to review your pacts, then create your first pact." with two buttons), and no subtitles on Pacts/Review/pushed pages. The Source step is called the kind step in code because the glossary avoids "source".
- No test that the evidence kind can't change: nothing can update a pact yet. Ticket 06 (edit window) adds the first update path and should test it.

Left for the operator: the manual check (invite a second Google account on a phone, accept, create a pact with them as reviewer). The new screens haven't been driven in a browser. They need a real Google sign-in, so layout, the share sheet, the sticky footbar and back navigation are unchecked until then.
