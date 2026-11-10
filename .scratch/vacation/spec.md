# Vacation

Status: done

Designed in a grilling session on 2026-11-08, with four prototype rounds. Vocabulary follows `GLOSSARY.md`. Every decision below is settled; the tickets under `issues/` build it.

## Problem statement

An owner going away for a week or two has to file one excuse per pact, since an excuse covers one pact (v0 story 45 dropped excuses across several pacts). Before a trip that means several excuses, each with its own dates, reason and reviewer. I want to ask once, ahead of time, for a date range off from the pacts I pick, and have one of my reviewers approve it.

## Solution

A **vacation**: a dated request, not a switch. The owner plans it from a Vacation row on the Profile sheet, in four steps like Create pact: the first and last day with an optional note, the pacts it covers, the reviewers it goes to, and a confirm step that shows what each pact gives up. It goes to the reviewers the owner picked as one review item, and any one of them approves or rejects it whole.

Once approved, the occurrences it covers are judged Excused, the outcome an approved excuse gives, with no reminders and no penalties. It covers only occurrences that haven't opened yet. During the vacation, Today shows a banner in place of the covered pacts, and the heat map draws vacation days with their own marker. The ledger carries on as usual. If it's still waiting for approval when its first day comes, excuse rules apply until a reviewer decides.

## User stories

1. As an owner, I want to plan a vacation from a Vacation row on my Profile sheet, so that I ask once for a date range off instead of filing an excuse per pact.
2. As an owner, I want to pick the first and last day of the vacation, at most 62 days, starting after today, so that it covers my trip and nothing more.
3. As an owner, I want an optional note on the dates step, such as "Going to Portugal", so that my reviewers know what I'm doing without my having to justify it.
4. As an owner, I want to pick which pacts go on vacation from a checklist with Select all, with every recurring pact ticked to start with, so that the usual case is one tap.
5. As an owner, I want my One-time pacts in their own section, unticked, with a line saying whether the deadline falls inside the vacation, so that I don't excuse a deadline by accident.
6. As an owner, I want to pick which of those pacts' reviewers the vacation goes to, with nobody ticked to start with, so that I choose who decides.
7. As an owner, I want the reviewers step shown even when only one reviewer is possible, and to need at least one ticked, so that I always know who gets the request.
8. As an owner, I want a confirm step that shows the dates, the pacts ("All pacts" when I picked every pact) and what each pact gives up, including days it skips and Weekly count weeks it doesn't cover, so that there are no surprises.
9. As an owner, I want days that are already Excused, on an excuse waiting for approval, or on another vacation skipped rather than refused, so that overlapping requests don't stop me.
10. As an owner, I want a vacation refused only when no day is left to cover, so that I'm told plainly when there's nothing to ask for.
11. As an owner, I want a waiting vacation to show on my Profile, with who it went to, so that I know it's sent and still undecided.
12. As an owner, I want to withdraw a vacation while it's waiting for approval, so that I can take it back if my plans change.
13. As an owner, I want a reviewer's question about my vacation to show on its Profile card with a Reply button, so that I can answer without it cluttering Today.
14. As an owner, I want a push when my vacation is approved or rejected, so that I know where I stand before I leave.
15. As an owner, I want a vacation that's still waiting when its first day comes to work like an excuse, with penalties held and reminders still going, so that I'm covered if it's approved late and not let off if it isn't.
16. As an owner, I want a rejected vacation to raise an alert on Today with the reviewer's reason and Take the L, so that I see what it costs and can move on.
17. As an owner, I want to plan a new vacation after a rejection, for days that haven't opened yet, so that a rejection isn't the end of the trip.
18. As an owner, I want Today during a vacation to show a banner saying until when, with the covered pacts gone from it, so that I'm not nagged while I'm away.
19. As an owner, I want the heat map to mark vacation days with their own square and legend entry, so that a trip looks different from a string of excuses.
20. As an owner, I want an approved vacation to stay as approved, with days after an early return still Excused, so that I can't be second-guessed and don't have to cut it short.
21. As an owner, I want my bills and Overdue reminders to carry on during a vacation, so that I don't come back to a surprise.
22. As a reviewer I've been picked for, I want one review item for the whole vacation, with its dates, note and what each pact gives up, so that I decide it in one go.
23. As a reviewer I've been picked for, I want a push when the vacation lands in my Review Queue, so that I can decide it before the owner leaves.
24. As a reviewer I've been picked for, I want to approve, reject with a required reason, or ask a question, as with other review items, and once one of us decides, the item leaves the others' queues.
25. As a reviewer I've been picked for, I want to see any held penalties and what approving or rejecting does to them, so that a late decision is still an informed one.
26. As a reviewer I wasn't picked for, I want not to be told about the vacation at all, so that only the people asked are bothered.

## Implementation decisions

### Rules

- **Name.** It's a **vacation**, not "vacation mode": a dated request, not a switch.
- **Owners only.** Only an owner can plan a vacation, for pacts they own. Reviewers can't go on vacation; a reviewer who's away can turn off notifications.
- **Dates.** A first and last day in the owner's timezone, the first after today, the last on or after the first, at most 62 days in all (`MAX_EXCUSE_SPAN_DAYS`, the excuse cap). The "after today" rule comes from the prototype's dates step.
- **Note.** A vacation needs no reason. The dates step has an optional note saying what the owner is doing, such as "Going to Portugal". A blank note is none. It shows on the Profile card, the review item and Today's banner.
- **Which pacts.** The Pacts step offers the owner's Active pacts whose edit window has closed, as excuses do; a pact still in its edit window isn't offered, and a muted line says new pacts can go on a vacation once their edit window closes. Every recurring pact is ticked to start with. One-time pacts are in their own section below, unticked. At least one pact must be ticked. A pact created after the vacation is filed isn't covered.
- **Earliest day.** A vacation covers only occurrences that haven't opened yet when it's filed. An occurrence already open or past still needs an excuse. With the first day after today, this matters for a Weekly count week that has already started and for a One-time pact with Submit anytime, which is open from its creation (see "One-time pacts").
- **What's covered.** The covered occurrences are fixed when the vacation is filed, as an excuse's days are:
  - **Fixed days**: each scheduled day, night or Anki day whose date falls inside the vacation.
  - **Weekly count**: a week is covered whole if its Thursday, the middle day of its Mon–Sun week, falls inside the vacation. Otherwise it isn't covered and keeps its full target. This differs from excuses, where any covered day excuses the week: a vacation starting on a Sunday would otherwise excuse the week before it.
  - **One-time**: a ticked One-time pact whose deadline falls inside the vacation has that deadline covered; once it's judged Excused the pact ends, as any One-time pact does. A ticked One-time pact whose deadline is outside the vacation gains nothing. A One-time pact with Submit anytime has already opened, so it shows in the One-time section unticked and disabled, with "It's already open, so it needs an excuse instead."
- **Overlaps.** Days already Excused (including days ahead an approved excuse covers), on an excuse waiting for approval, or on another vacation (waiting or approved) are skipped, not refused, as an excuse skips days. A vacation is refused only when no day is left to cover in any ticked pact. The other way round, an excuse skips days on a waiting vacation ("On a vacation waiting for approval") and days on an approved one ("Excused"). An occurrence is on at most one excuse or vacation waiting for approval.
- **Changes to a pact afterwards.** A day an approved change takes off the schedule isn't covered any more, as with an excuse. A day a change adds isn't covered. A pact that Ends has no days after its end. If a change moves a covered One-time deadline, the vacation still covers it only if the new deadline falls inside the vacation.
- **Several vacations.** An owner may have more than one vacation waiting or approved; their days can't overlap, by the overlap rule.
- **Withdrawing.** The owner can withdraw a vacation while it's waiting for approval, including while it waits on their reply. Withdrawing releases any held penalties to owed, as a rejection does, but raises no alert. Once approved, a vacation can't be changed, withdrawn or ended early; days after an early return stay Excused.

### Reviewing

- **Always approved by a reviewer.** Every vacation needs a reviewer's approval, however far ahead it's set. Nothing changes for the owner's pacts until then, apart from excuse rules once its first day comes (see Judging and money).
- **One review item, to reviewers the owner picks.** A vacation is one review item, a fifth kind beside evidence, excuses, payments and change requests, covering all its pacts and approved or rejected as a whole.
- **Picking reviewers.** The Reviewers step lists the reviewers of the ticked pacts, each with the pacts they review, and nobody is ticked to start with. It always shows, even with one possible reviewer, and needs at least one ticked, as when picking a pact's reviewers in Create pact. (The prototype skipped this step with one possible reviewer; this decision overrides it.) Unticking a pact drops a ticked reviewer who no longer reviews any ticked pact. The picked reviewers are fixed when the vacation is filed.
- **Who decides.** Any one picked reviewer can approve or reject it; the first decision is final, and the item then leaves the other picked reviewers' Review Queues. Reviewers who weren't picked never see it. Nothing requires a covered pact to keep one of its own reviewers picked (see Out of scope).
- **Questions.** A picked reviewer can ask the owner a question, as on any review item. The item is then waiting on the owner's reply and leaves every picked reviewer's queue until the owner replies, though any of them can still decide it. The question shows on the vacation's Profile card, not on Today, with Reply and Withdraw.
- **Queue order.** Vacations sit among the items after change requests, oldest first by when they were filed, and count in the Review tab's badge.
- **Approving.** Covered occurrences already Missed become Excused and their penalties are removed. Covered occurrences not judged yet are judged Excused at their due time, with no penalty. It all happens at once, for every pact.
- **Rejecting.** A reason is required. Held penalties become owed, covered occurrences not judged yet are judged as usual, and a rejected-vacation alert is raised. The owner can file a new vacation for days that haven't opened yet.

### Judging and money

- **Outcome.** Occurrences an approved vacation covers are judged **Excused**, exactly as an approved excuse judges them; there's no fourth outcome. Like an excuse, approved evidence still makes an occurrence Satisfied, and an on-time bedtime that Oura reports for a covered night still makes it Satisfied. Only the heat map draws vacation days differently.
- **Reminders and checks.** Reminders don't fire for occurrences an approved vacation covers (`worthReminding` already skips days an approved excuse covers). Pact doesn't check AnkiWeb for an Anki day an approved vacation covers, as for an approved excuse.
- **Waiting when it starts.** If a vacation is still waiting for approval when its first day comes, excuse rules apply: covered occurrences are judged as usual, the penalties of covered Missed occurrences are held, reminders keep going, and the owner isn't sent a Missed push for a covered occurrence, as for one on a waiting excuse. Approval then turns covered Missed occurrences into Excused and removes their penalties.
- **Held penalties.** While a vacation waits, its covered Missed occurrences' penalties are held: they don't count toward owed and don't go on a bill. The ledger history shows them as "Held while a vacation waits for approval", grey with no "+". Rejecting or withdrawing makes them owed; they go on the next Wednesday bill once their 48 hours are up. A rejection never restarts a day's 48-hour excuse window.
- **The ledger carries on.** A vacation doesn't stop the ledger. Bills are still made every Wednesday, and an Overdue spell's reminders and reviewer notices keep running.

### Screens

The prototype (see Prototype) is the reference for layout and copy. Where this spec says otherwise, the spec wins. Copy that said pacts "have no occurrences" on vacation days, or offered "See what's paused", is replaced below, because covered occurrences exist and are Excused.

- **Profile sheet, Vacation section.** Placed after the name and email, before Friends, labelled "Vacation". With nothing waiting or approved ahead, it says "None planned" (or "Last one: Dec 20 – Jan 2" after one ended) beside a **Plan a vacation** link. Each vacation waiting, approved ahead or on now is a card, soonest first, with Plan a vacation still below them:
  - **Waiting:** "Vacation Dec 20 – Jan 2" with a "Waiting for approval" chip, the note in bold, "All recurring pacts · 14 days", and "Sent to Sam Rivera and Alex Chen. Nothing changes until one of them approves it." (with one reviewer, "Sam Rivera reviews it. Nothing changes until it's approved."). **Withdraw** asks first, inline: "Withdraw this vacation? Your pacts keep all their days." (with held penalties, "$15 held becomes owed.") over Withdraw and Keep it. After withdrawing, the sheet says "Vacation withdrawn. Your pacts keep all their days."
  - **Waiting on your reply:** a "Waiting on your reply" chip, "Sam asked: "…"", and **Reply** and **Withdraw**. Reply opens a text box (placeholder "e.g. My flight leaves Sun Dec 20 at 7am") with Cancel and "Send to Sam". After sending, "Reply sent. It's back with Sam and Alex."
  - **Approved, ahead:** an "Approved" chip, and "Approved by Sam Rivera. It can't be changed now."
  - **On now:** "On vacation until Sat Jan 2" with an "On now" chip.
  - A rejected or withdrawn vacation leaves Profile; a rejected one raises the alert on Today.
  - A waiting vacation whose last day has passed stays on Profile as a Waiting card, with Withdraw, until it's approved, rejected or withdrawn, since it may hold penalties. Only an approved vacation becomes "Last one" after it ends.
- **Plan a vacation flow.** A pushed page titled "Vacation", with Back, a step bar and "Step 1 of 4", and a footer bar that nothing scrolls under, as in Create pact:
  1. **Dates:** First day and Last day (`<input type="date">`), then "14 days, Sun Dec 20 – Sat Jan 2." or an error: "The last day can't be before the first.", "The first day has to be after today.", "A vacation can be at most 62 days. This is 70." Under them, "On these days the pacts you pick are Excused, with no reminders and no penalties. At most 62 days." Then "What are you doing? (optional)" with placeholder "Going to Portugal". Footer: Cancel and Next.
  2. **Pacts:** "Which pacts go on vacation" with **Select all** (Clear once all are ticked), one checkbox row per recurring pact with its terms line, then "One-time pacts" with each one's line: "Its deadline is inside your vacation. Tick it to excuse the deadline; the pact then ends." or "Its deadline isn't inside your vacation." "Pick at least one pact." while none is ticked. Footer: Back and Next.
  3. **Reviewers:** "Whoever you tick gets the request. Any one of them can approve or reject the whole vacation." One checkbox row per possible reviewer, "Reviews Bed by midnight and Spanish deck" under the name. "Tick at least one reviewer." while none is ticked.
  4. **Check it over:** a card with Dates (the range, "14 days", the note), Pacts ("All pacts" whenever every offered pact is ticked, however the owner got there; "All recurring pacts" when every recurring one is and no One-time one is; else the names) and Reviewers ("Sam Rivera and Alex Chen. Either can decide.", "Any one can decide." for three or more, or "Sam Rivera. Only Sam gets the request."), each with Edit. Then "What's excused", one row per offered pact: for a ticked pact, what it gives up, such as "14 nights off · Dec 20 – Jan 2", "2 weeks off · Dec 21 – Jan 3" with a line per partial week ("Week of Dec 14: not covered, still 3× by Sun Dec 20"), "Deadline Wed Dec 23 excused" with "The pact ends.", or "No nights in these days"; skipped days get a line each with the reason ("Tue Dec 22: on an excuse waiting for approval", "Week of Dec 14: already open"); for an unticked pact, "Not on vacation · 10 Anki days still due". Under the list, "Reminders stop on these days for the pacts on vacation." Then an info box, "Nothing changes until it's approved, and once it is, it can't be changed." and **Ask for approval**. With no day left to cover, the button is disabled and the step says "There's nothing left for this vacation to cover."
  - Asking for approval returns to Today with the Profile sheet open, saying "Sent to Sam and Alex for approval."
  - The confirm step's preview comes from the core, so it shows the same covered and skipped occurrences that filing records.
- **Review item, Vacation kind.** Its own kind colour and icon: a suitcase on the sunk grey (`k-vacation`). "Vacation" badge and "from Jordan Lee", then a card titled "Vacation" with "Dec 20 – Jan 2 · 14 days", "Sun Dec 20 – Sat Jan 2 · All recurring pacts", the note in quotes, "Sent to Sam Rivera and Alex Chen. Either can decide.", and "Covers": one row per covered pact with what it gives up, and any held days ("Tue Dec 22 · Missed · $5 held"). Then "Approving excuses all of these and stops their reminders on these days. Once approved, it can't be changed." (with held penalties, it starts "Approving removes $15 in held penalties."). Reject, Ask and Approve, as on other items. The reject form asks "Why are you rejecting it? (required)" and says "Rejecting keeps every day of Jordan's pacts as it is." or, with held penalties, "Rejecting makes $15 owed again and leaves the days not judged yet to be judged as usual." While it waits on the owner's reply it's listed under "Waiting on Jordan's reply" as "Vacation · Dec 20 – Jan 2 · from Jordan Lee", like other items.
- **Today.**
  - A waiting or approved-ahead vacation never shows on Today, and neither does a question about one. A waiting vacation leaves the To do cards of the days it covers where they are, since reminders keep going; a covered Missed occurrence leaves the Missed section while the vacation waits, as one on a waiting excuse does, and its label reads "Missed · vacation waiting for approval".
  - **Rejected-vacation alert:** "Sam rejected your vacation", the reason in quotes, "Dec 20 – Jan 2 · your pacts keep all their days" (or "Dec 20 – Jan 2 · $15 is owed again" when it held penalties), and **Take the L**. It stays until the owner taps Take the L, which also takes the L on the Missed occurrences it covered, or files a new vacation or an excuse covering any of its days.
  - **During an approved vacation**, from its first to its last day, Today shows a banner: "On vacation until Sat Jan 2", the note, "Bed by midnight, Gym and Spanish deck are Excused on these days, with no reminders and no penalties." ("Your pacts are Excused…" when it covers every pact), and **See what's excused**, which shows each covered pact's line (Hide closes it).
  - Every occurrence an approved vacation covers is left off Today, whenever it would show: To do, Coming up, Missed and Yesterday. A covered Weekly count week that runs past the last day stays off too. Pacts not on vacation show as usual.
- **Heat map.** Days excused by a vacation get their own square (hatched grey) and a "Vacation" legend entry, though their outcome is Excused; the Weekly count view does the same for a covered week. Tapping one shows the "Vacation" chip and "Vacation, Dec 20 – Jan 2. Excused, no penalty." A covered night Oura satisfied shows as Satisfied.

### Notifications

- The picked reviewers get the usual new-review-item push: "Jordan asked for a vacation", "Dec 20 – Jan 2". It opens Review.
- The owner gets a push when it's approved ("Sam approved your vacation", the dates; it opens the Profile sheet) or rejected ("Sam rejected your vacation", the reason in quotes; it opens Today), as with an excuse decision.
- A question and a reply use the existing question and reply pushes ("Sam asked about your vacation", "Jordan replied about their vacation"), to the owner and to the picked reviewers. A question opens the Profile sheet.
- Nothing else: no push when a vacation starts or ends, none for a withdrawal, and reviewers who weren't picked aren't told. Each push follows the existing notification setting for its kind: Review item, Decision, Comment.

### Data

- **Storage: a vacation is its own record, not a set of generated excuses.** New tables in one migration (28):
  - `vacation`: owner, first and last day, note, filed at, and the review columns excuses have (decision, decided by, decided at, reject reason), plus `withdrawn_at` and `rejection_accepted_at`.
  - `vacation_pact`: the pacts ticked, so the Pacts summary and "What's excused" can name a ticked pact with nothing covered.
  - `vacation_reviewer`: the picked reviewers.
  - `vacation_day (vacation_id, pact_id, date)`: the covered occurrences by date, fixed at filing, the same shape and index as `excuse_day` (a Weekly count week by its Monday).
- **Why its own record.** Everything that asks whether an occurrence is covered already goes through two helpers in `occurrence-state.ts`: `excuseOn` (judging, reminders, Anki checks, Oura nights, Today, occurrence status) and `excuseCoversSql` (held penalties in `money.ts`, Today's SQL). Widening those to read `vacation_day` as well (a waiting vacation is one not decided and not withdrawn) gives a vacation the excuse behaviour the decisions ask for in one place. Generated excuses would get that coverage for free, but a vacation differs from an excuse in almost everything else: one item for several pacts, decided once, sent to picked reviewers rather than each pact's reviewers, withdrawable, with a note instead of a required reason, no photos, and kept off Today's Waiting for approval list, the excuse alerts and the pact page. Every excuse query (Review Queue, waiting items, alerts, the excuse page, pushes, `itemToDecide`) would need a filter, and one decision would have to be kept in step across N rows.
- **Where it differs from an excuse in the helpers.** Callers that must tell the two apart get it from the widened helpers: Today keeps a waiting vacation's To do cards; `skipReason` gains "on-waiting-vacation"; `recordedStatus` says when an Excused day came from a vacation, with its dates, for the heat map; the ledger history's held line names a vacation.
- **Deciding.** `decide` in `review.ts` gains the vacation kind: `itemToDecide` allows only picked reviewers, `ownItem` gives the picked reviewers for replies, `itemWhat` says "vacation". Approving reuses `decideExcuse`'s per-day loop (Missed to Excused without the penalty, days judging already reached judged Excused now, bedtime nights left to judging), pulled out so both call it.
- **Core interface.** Queries for the Pacts and Reviewers steps' options, a preview (dates and ticked pacts in, per-pact covered and skipped occurrences out, the same function filing uses), and the owner's vacations for Profile; commands to file, withdraw and take the L on a rejection. `ReviewItem` and `TodayAlert` gain a vacation kind. Routes and types live in `src/shared/`.
- **App paths.** The flow gets its own path (for example `/vacation/new`). Profile is a sheet with no path today, so pushes that open it need one, such as a path that opens Today with the Profile sheet up.

## Testing decisions

- Core rules are scenarios through `scenario()` with named times and the fake clock, in a new `src/core/vacations.test.ts`, as `excuses.test.ts` does for excuses. Good scenarios read like the stories, for example "Jordan files a vacation for next Mon–Sun on Wednesday, Sam approves it Thursday, Monday to Sunday are judged Excused at their due times with no reminders and owed stays $0".
- The rules each need a scenario: the earliest day, the Thursday rule for Weekly count, One-time deadlines (inside, outside, Submit anytime), overlaps skipped and the nothing-left refusal, the 62-day cap, waiting when it starts (holds, approval, rejection), withdrawing with and without holds, picked reviewers only, the first decision final, and the ledger carrying on.
- Occurrence timing doesn't change, so `occurrences.test.ts` needs nothing new.
- Routes are tested at the `app.test.ts` seam. Client screens (Profile section, the four steps, the review item, the banner, the heat map square) get `*.test.tsx` tests with `renderWithUser` and `stubApi` where a component decides what to show, and each screen is checked in the browser at 390×844 against the prototype, with screenshots.
- Real pushes on a phone are checked by hand (`manual-checks.md`).

## Out of scope

- Reviewer vacations. A reviewer who's away can turn off notifications.
- Changing, withdrawing or ending an approved vacation early.
- A no-approval rule (for example at least 10 days ahead and at most 2 weeks long). It was considered and dropped as more complicated.
- Covering occurrences already open when the vacation is filed; those need excuses.
- Excusing part of a Weekly count week, or lowering its target, when its Thursday is outside the vacation.
- Showing a waiting or upcoming vacation on Today, or planning one from Today.
- Pushes when a vacation starts or ends, or to reviewers who weren't picked.
- A required reason or photos on a vacation.
- **Known gap: lenient reviewers.** An owner can pick only a lenient reviewer, who then approves days on pacts they don't review. A rule that every covered pact keeps one of its own reviewers picked would close this; it isn't enforced while the first users share one reviewer.
- **Known gap: travel and time zones.** Unchanged from v0: a pact kept going on a trip follows the account time zone (Camera), the collection's (Anki) or Oura's timestamps (bedtime). A vacation's days are dates in the account time zone.

## Prototype

`prototype/vacation` branch (local, not pushed), `.scratch/vacation/prototype/vacation.prototype.html`, published as a private artifact. It went through four rounds. Round 1 compared every pact vs a checklist, Profile vs Today as the entry point, Today during a vacation (banner only vs banner plus muted pacts) and the heat map (own marker vs Excused); its picks were Profile, banner only, and the heat map's own marker. Round 2 showed the step flow and the approval lifecycle (waiting, withdrawn, question, approved, rejected, during, back). Round 3 added the Reviewers step, the optional note and a footer bar nothing scrolls under. Round 4 settled on one design: the checklist with One-time pacts in their own section and no reviewer ticked to start with.

Where the prototype and this spec differ, the spec wins:
- The Reviewers step always shows, even with one possible reviewer; the prototype skipped it.
- A Weekly count week is covered when its Thursday falls inside the vacation; round 4 of the prototype used Wednesday.
- The copy says covered occurrences are Excused, not that pacts "have no occurrences", and the banner's button is "See what's excused".
- Rejecting or withdrawing a vacation that held penalties says what becomes owed; the prototype only showed vacations decided before they started.
