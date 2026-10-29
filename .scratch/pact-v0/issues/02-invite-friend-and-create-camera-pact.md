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

- [ ] Invite accepted within 7 days creates a friendship both ways; a second accept of the same link and an accept after 7 days are refused.
- [ ] An owner can pick only friends as reviewers or person recipients.
- [ ] Created at Mon 23:30 on a daily pact → first occurrence is Tuesday (Monday's midnight is under an hour away). Created Mon 10:00 → Monday.
- [ ] Today lists the open pact as To do and a not-yet-open one as Coming up, and leaves out a Mon/Wed/Fri pact on Tuesday.
- [ ] Days are computed in the owner's timezone (test with a non-UTC zone).
- [ ] Manual: invite a second Google account on a phone, accept, create a pact with them as reviewer.

## Out of this ticket

Edit window (06), reminders (13), other schedules and time fields (14–16), Oura (08).
