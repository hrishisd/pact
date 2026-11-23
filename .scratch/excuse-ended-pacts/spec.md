# Excuses on Ended pacts

Current rules: `docs/behaviour.md`. This spec records the design as it was decided.

Status: needs-triage

Settled with the owner on 2026-11-23 in a design interview. The prototype (`prototype/excuse-ended-pacts`) is still to be reviewed; update this spec with what it settles before building.

## Problem statement

I missed a One-time pact ("Block x and Reddit on tablet", due Sun Nov 22) and had a valid excuse, but found no way to file it. A One-time pact Ends the moment its occurrence is judged, and the pact page shows File excuse only while a pact is Active (`changeable`, `src/client/PactPage.tsx`). The only other way in was Today's Missed card, and Take the L had removed it. The core would still have accepted the excuse for 48 hours: `excuseOptions` (`src/core/excuses.ts`) has no check on the pact's stage, and `one-time.test.ts` "a Missed occurrence can be excused within 48 hours" files and approves one.

## Solution

The pact page offers File excuse for any Missed day still inside its 48-hour excuse window, whether the pact is Active or Ended.

## User stories

1. As an owner, I want to file an excuse for a missed One-time pact from its page, so that its Ending at judging doesn't take away my 48 hours.
2. As an owner, I want the same for any Ended pact with a recent miss (an end date or an approved end request), so that the rule is the same everywhere.
3. As an owner who tapped Take the L, I want to still be able to excuse the day from the pact page while its window is open, so that one tap isn't final.
4. As an owner, I want the button to say how long I have left, so that I know why it will go away.

## Decisions

### The rule

- File excuse shows on an Ended pact while at least one of its days can still be excused (Missed, its excuse window open, not already under a waiting cover). Reason: one rule for every ending; the core already accepts these excuses.
- A One-time pact still Ends when its occurrence is judged. Reason: keeping it Active for 48 hours would say it has something left to do, and the gap also exists for pacts ending on their end date.
- Take the L stays as it is: it only takes the card off Today. The day stays excusable from the pact page for the rest of its window. No hint is added to the Missed card. Reason: the button is easy to tap by accident; the pact page is where the owner looks.
- Active pacts are unchanged.

### Pact page

- On an Ended pact the button sits where File excuse sits on an Active pact, alone (no Request change or End pact), labelled like Today's Missed card: "File excuse · 31h left", counting down to the latest excuse deadline among the pact's excusable days. Reason: the same action looks the same in both places.
- The core decides: the pact page's data gains `excusableUntil`, the latest `excusableUntil` among the pact's excusable days, or null when none is left. The page shows the button on an Ended pact while it is set and not passed. Reason: the core decides every domain rule (`CLAUDE.md`).

### Excuse sheet on an Ended pact

- "Days ahead" is hidden: an Ended pact has no days ahead.
- With exactly one excusable day, the sheet opens the one-day form that Today's Missed card opens, with that day picked, and without "+ Later days too". A missed One-time pact always gets this form.
- With several, it shows the "Which day?" list without "Days ahead".

### Core fix

- `excuseOptions` also lists a Missed day dated after today that is still inside its window. Reason: a rejection can judge a One-time occurrence Missed before its date, which Ends the pact; today the list only looks at today and earlier, so the page would offer nothing.

### Unchanged

- Reviewers see and decide the excuse as now. Approval makes the day Excused and deletes its penalty; this already works on an Ended pact.
- The Today Missed card.

## Testing

- Core: `excusableUntil` on the pact page data for an Active pact, an Ended One-time pact inside and past its window, a day under a waiting excuse, an Ended recurring pact with two Missed days; `excuseOptions` lists an early-missed One-time day dated ahead.
- Client: `PactPage.test.tsx` shows or hides the button and its label; `ExcuseSheet` hides Days ahead on an Ended pact and opens the one-day form for a single day.
- `docs/behaviour.md`: Excuses and Ending sections state the new rule.
