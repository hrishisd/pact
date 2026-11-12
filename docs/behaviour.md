# How Pact behaves

This page lists the rules the app follows today, grouped by concept. It describes the code as it is. Where the code and a feature spec disagree, the code wins here and the difference is noted. The feature specs (`.scratch/pact-v0/spec.md`, `.scratch/vacation/spec.md`, `.scratch/anki-evidence/spec.md`) record the design as it was decided.

Terms are defined in [`GLOSSARY.md`](../GLOSSARY.md). Paths are relative to `src/core/` unless they say otherwise. Every command and query goes through `AccountView` (`core.ts:182-451`), whose doc comments state many of these rules in full. A scheduler tick (`advanceTo`, `core.ts:597`) runs judging, reminders, bills, Oura and Anki checks.

Known bugs are marked **Known bug** and link to the ticket that fixes them. A ticket that changes a rule updates this page in the same change and removes the known-bug note it fixes.

## Pacts and schedules

- A pact has one evidence kind (Camera, Oura Ring or Anki), chosen at creation, and it never changes, not even in the edit window (`evidence-kind-fixed`, `editPact` in `pacts.ts:116`).
- Weekly count and One-time are for Camera only. Due-by is not offered for Oura Ring, and any HH:MM except 00:00 is a valid due-by (`checkedTerms`, `pact-rules.ts:92`; `isDueBy`). Test: `due-by-and-dates.test.ts`.
- The penalty must be more than zero. The recipient is just a name: repeats are allowed and a blank one is refused (`checkedTerms`). Test: `recipients.test.ts`.
- Oura Ring and Anki pacts have no description (`checkedTerms`).
- A pact has at most 5 reminders (`MAX_REMINDERS`, `src/shared/types.ts:184`). A reminder at or after the due time is refused (`reminder-after-due-time`, `remindersGoOffInTime`, `pact-rules.ts:225`). One-time reminders carry a date and time.
- A One-time pact takes no start or end date (`invalid-start-date`, `invalid-end-date`). An end date before the first occurrence is refused (`end-date-too-early`).
- The first occurrence is the first one due at least an hour after creation and not before the start date. A Weekly count pact starts on the Monday after creation, or after the start date. A One-time deadline less than an hour away is refused (`deadline-too-soon`) (`FIRST_OCCURRENCE_LEAD_MS`, `newOccurrenceTerms`, `occurrences.ts:97-108`). Test: `occurrences.test.ts`.
- The first occurrence is stored as a date. Its due time is worked out again in the current timezone, so a timezone change moves it (`newOccurrenceTerms`; decided in pact-v0 ticket 02).
- A pact can only be seen by its owner and its reviewers. Another person's pact answers `pact-not-found` (`ownPact`). Test: `pacts.test.ts`.

### Edit window

- For the first 10 minutes after creation the owner can edit or delete the pact freely (`EDIT_WINDOW_MS`, `pact-rules.ts:36`; `editPact`, `pacts.ts:116`; `deletePact`, `pacts.ts:160`). An edit does not restart the window. Test: `edit-window.test.ts`.
- An edit that drops days from the schedule removes evidence for those days. An edit to a One-time deadline moves its occurrence with its evidence (`editPact`, `moveOneTimeOccurrence`, `pacts.ts:528`).
- Reviewers are told they were picked only when the window closes, and evidence submitted inside the window goes to them then (`closeEditWindows`, `pacts.ts:571`). Until then a reviewer cannot see or decide the pact's evidence (`evidence.ts:201`; `reviewable` in `evidenceKind`, `evidence.ts:284`).
- No excuse can be filed while the window is open (`edit-window-open`, `excuseOptions`, `excuses.ts:66`), and vacations offer only pacts past it (`offeredPacts`, `vacations.ts:77`).

### Change requests

- After the edit window, the owner changes a pact through `changePact` (`change-requests.ts:91`). What needs approval is decided per term by `termDiffs` (`changes.ts:67`):
  - Name, reminders and added reviewers apply at once. They apply at once even when sent alongside terms that wait, and added reviewers are told they were picked.
  - Description, deck, recipient and removing a reviewer always need approval.
  - Changes that relax the pact need approval: a lower penalty, a later due-by or bedtime, a later start, an earlier or added end date, fewer days, or a lower target. Changes that tighten it need no approval and apply from the first day not yet open, like an approved change (`STRICTER`, `changes.ts:50`).
- The schedule kind cannot change (`schedule-kind-fixed`, `checkedChange`, `change-requests.ts:298`). A start date cannot change once the pact has started (`pact-started`, `openOccurrencesRefusal`, `change-requests.ts:249`).
- Only one change request waits at a time. While one waits, only at-once changes are accepted (`change-request-waiting`, `checkedChange`).
- An approved schedule change applies from the first day not yet open: tomorrow, or next Monday for Weekly count (`firstDayNotOpen`, `pact-rules.ts:274`). Change requests never rescue an occurrence that is open now. The earlier terms are kept per occurrence in `pact_earlier_terms` (`applyTerms`, `change-requests.ts:437`). Test: `change-requests.test.ts`.
- An end date approved too late to keep the day open now is moved to that day (`laterDate(after.endDate, lastOpen)` in `applyTerms`).
- With an end date, a Weekly count pact counts only whole weeks: it Ends after the last whole week before the end date (`pact-rules.ts:153`; decided in pact-v0 ticket 14). Test: `weekly-count.test.ts:685`.
- One-time: the new deadline must be at least an hour away, both when sent and when approved (`deadlineFarEnough` in `checkedChange`; `approvableNow`, `change-requests.ts:755`). A request decided after the occurrence was judged leaves the pact as it was (`applyOneTimeTerms`, `change-requests.ts:483`). Test: `one-time.test.ts`.
- Before approving a change request, the decider first catches judging up to now (`checkDecision` in `changeRequestKind`, `change-requests.ts:761`), so terms never apply to an occurrence already due and an end approved with nothing open leaves no due occurrence unjudged.
- A reviewer being removed can still decide until the request is approved, and is deleted at approval (`changeOutcome`, `change-requests.ts:363`; `decideChangeRequest`, `change-requests.ts:700`). The owner is told the outcome (`change-request-decided`).
- The owner can withdraw a waiting request. Nobody is notified, and its page says "You withdrew it" (`withdrawChangeRequest`, `change-requests.ts`).
- An end request is refused once the pact has Ended, while the edit window is open, or while another request waits (`requestEnd`, `change-requests.ts:128`).
- While an approved end waits for its open occurrence, the pact takes no new end request and no change beyond the at-once ones (the name, the reminders, added reviewers); both are refused with `end-approved` (`requestEnd`, `checkedChange`). Anything else would apply after the end, and a later end date, a stricter change, would undo it without approval. The pact page shows neither End pact nor Request change then, so the owner can't open the change form; the name, the reminders and added reviewers still change under Terms. Test: `change-requests.test.ts`, "while an approved end waits".
- An approved end request takes effect when the occurrence or week open at approval closes, as every other change does (rule R1). An occurrence is open from when it opens until it closes, unless it is judged; a bedtime night opens at the start of its date and closes at 18:00 the next day. Approval sets the end date to the last day of that occurrence's period (`endTiming`, `endAfter`, `ending.ts:44`, `:72`); a One-time pact keeps its deadline and Ends when it is judged. Until then the pact is Active, its open occurrence is judged normally and takes evidence and excuses as usual, and its page says "Ending approved: Gym ends after Sun Jan 18, once this week is judged." With nothing open, the pact Ends at once. The owner's push says "Gym ends after Sun Jan 18", or "Gym is Ended". The reviewer sees when it would End before approving. Test: `change-requests.test.ts`, "ending a pact".
- When a change takes days off the schedule (fewer days, a later start date, an earlier end date), the excuse and vacation days on those dates from the first day not open are deleted, unless the occurrence is judged (rule R9, `uncoverRemovedDays`, `covers.ts`, called from `applyTerms`). A later change that adds a day back finds it not covered, as vac:61 says, and it is judged as usual. A Weekly count target change removes no week. An excuse or vacation left with no days is moot, and is withdrawn as no longer needed (see "Withdrawn items" under Review items). One-time pacts move their covers with the deadline instead (`moveOneTimeOccurrence`, `pacts.ts`). Every table keyed by an occurrence must be handled in both places, or `scripts/check-conventions.ts` says why not. Test: `excuses.test.ts` and `vacations.test.ts`, "a change that removes a covered day".

### Ending

- A pact with an end date Ends at the start of the day after the end date, or when its last occurrence closes if that is later. Nobody is notified (`endPastEndDate`, `ending.ts:107`). An end date an approved end request set Ends it the same way. Test: `due-by-and-dates.test.ts`.
- A One-time pact Ends when its occurrence is judged (`settle`, `settle.ts:37`).
- Every ending goes through `endPact(ctx, pactId, cause, at)` (`ending.ts:25`), with cause `end-date`, `one-time-judged` or `end-request`. It withdraws a waiting change request, silently, recording `pact-ended`; its page says "Withdrawn when Gym Ended" and a reviewer who tries to decide it is told so. Test: `change-requests.test.ts`, "a change request still waiting when the end date passes is withdrawn" and "an end request still waiting when the end date passes is withdrawn".
- Only `settle.ts`, `ending.ts` and migrations insert or delete penalties, update an occurrence's outcome or judging time, or update a pact's stage (`scripts/check-conventions.ts`).
- Only Active pacts are judged and reminded (`pactsToJudge`, `occurrence-state.ts:233`; `remind`, `reminders.ts:37`). An occurrence due after the end is ignored (`dueAfterEnd`, `occurrence-state.ts:205`).
- The pact list shows pacts in the edit window first, then Active, then Ended (`pactList`, `pacts.ts:207`).

## Occurrences and judging

### Days and due times

- A Camera day runs from midnight in the account's timezone to the due time (`fixedDaysOccurrence`, `occurrences.ts:453`; `dayClockOf`, `pact-rules.ts:176`).
- An Oura Ring night opens at the start of its date and is due at the in-bed-by time. A time before 18:00 means the next day. The night closes at 18:00 the next day. All of it is read on Oura's clock (`nightStartsAt`, `occurrences.ts:517`; `ouraOffset`, `rows.ts:217`). Test: `oura.test.ts`.
- An Anki day opens at its rollover hour. Due-by is allowed from noon on day D, after the rollover hour, up to the rollover hour on D+1. Other times are refused (`ankiDueByDayAfter`, `occurrences.ts:404`). Anki days use the account's timezone, not the collection's (deviation from the anki spec, noted in anki ticket 03).
- A Weekly count week runs Monday to Sunday and is due at the end of Sunday (`weekOccurrence`, `occurrences.ts:384`).
- A One-time occurrence with Submit anytime opens at creation. Otherwise it opens at the start of the deadline's date (`oneTimeOccurrence`, `occurrences.ts:368`).

### Judging

- Every judging path goes through `settle` (`settle.ts:37`): the tick, evidence decisions, cover decisions and withdrawals, bedtime nights and Anki checks. It reads the occurrence's facts, asks `verdictOf` (`src/core/verdict.ts`) for its outcome, and stores it with its penalty if the occurrence isn't judged yet. A stored outcome is kept, except that a Missed one an approved cover now excuses becomes Excused without its penalty (design review ticket 12), and an Excused one that approved evidence now makes Satisfied becomes Satisfied (ticket 26).
- A penalty on a bill is never excused or changed: the excuse window closes before billing takes a penalty, and `settle` throws rather than touch a billed penalty, so the command changes nothing (`deletePenalties`, `settle.ts:90`). Test: `bills.test.ts` "a billed penalty".
- The tick settles each Active pact's occurrences in due order, and keeps a `judged_through` cursor (`settlePactDueBy`, `settle.ts:147`). It also settles days behind the cursor that evidence still holds: an owner's move west can put a due time the cursor passed back ahead, and a decision before then leaves the day for the tick (`settleBehindCursor`, `settle.ts:171`). Test: `judging.test.ts`.
- At the due time an occurrence is judged in this order:
  1. Approved evidence: Satisfied.
  2. An approved excuse or vacation: Excused.
  3. Evidence waiting for a reviewer: wait.
  4. Otherwise: Missed, with the penalty.
- A cover approved at the due instant itself, before the tick, judges the occurrence in the same order: approved evidence still makes it Satisfied, not Excused (`verdictOf`; design review ticket 31). Test: `verdict.test.ts`, "a cover approved at it"; `vacations.test.ts`, "approved at the due time itself".
- The owner gets a Missed push whenever an occurrence or week becomes Missed, whatever judged it: the due time or a late evidence decision (rule R4, design review ticket 11). Two exceptions: nobody is told about a day an excuse or vacation covers, waiting or approved (decided in pact-v0 ticket 07), and a rejection that judges a Fixed day or One-time occurrence Missed tells the owner through the rejection push alone (v0:324). A Missed push caused by a decision comes after the decision's push (`settle`). Test: `weekly-count.test.ts` "a week judged by a late decision", `rejection.test.ts`.
- A Weekly count week is Satisfied when its days of approved evidence reach the target. Otherwise an approved cover makes it Excused, waiting evidence holds it, and else it is Missed with one penalty of days short × penalty (`verdictOf`). Test: `weekly-count.test.ts`.
- The judging rules are stated once in `verdictOf` (`src/core/verdict.ts`); every scenario checks the stored outcomes against it (design review ticket 10).
- The penalty uses the terms that applied to the occurrence, including its recipient (`termsOn`, read by `occurrenceFacts`).
- A One-time occurrence with approved evidence is Satisfied at the deadline (decided in pact-v0 ticket 15).

### How an occurrence is shown

- Every screen that shows an occurrence (the heat map's squares and chip, Yesterday, the excuse sheet, the excuse page and the Excuse review item) words it through one function, `presentOccurrence` (`src/client/excuse-days.tsx`), in one order. Satisfied, Excused (Vacation when an approved vacation covers it) or Missed. A Missed day under a waiting cover reads "Missed · excuse waiting for approval" or "Missed · vacation waiting for approval". A day not judged yet reads, first match wins: Excused or Vacation under an approved cover; "Excuse waiting for approval" or "Vacation waiting for approval"; "Waiting for approval" while its evidence waits; then Coming up, Due today ("This week" for a Weekly count week; "Due Mon Jan 12" for a One-time pact open before its date) or Not judged yet ("No Oura data" for a bedtime night). Test: `excuse-days.test.tsx`.
- A heat map square's colour is its outcome, Vacation, or for a day not judged yet whether it is ahead, open or past due. Its label is the chip's words, so the square and the chip agree. Test: `history.test.tsx`.
- The browser clock only moves a day not judged yet from Coming up to Due today to Not judged yet while a screen is open; the core decides everything else.

### Evidence

- Camera only. One to 10 photos (`MAX_EVIDENCE_PHOTOS`), for the occurrence open now and before its due time. The received time is the latest photo's receipt (`submitEvidence`, `evidence.ts:58`; `evidenceAcceptance`, `evidence.ts:272`). Test: `evidence.test.ts`.
- One piece of evidence per day may wait or be approved. On a Weekly count, a day with rejected evidence takes no more (decided in pact-v0 ticket 14). Evidence is refused once the occurrence is judged or the pact has Ended.
- A rejection judges the occurrence Missed at once, unless the day was excused ahead, which leaves it Excused (`decideEvidence`, `evidence.ts:227`; decided in pact-v0 ticket 07). Test: `rejection.test.ts`.
- An approval judges the occurrence Satisfied at once if it is past its due time. A late decision on a Weekly count week judges the week at once: Satisfied if its approved days reach the target, else Missed, with the Missed push.
- An approval of evidence that was still waiting when an approved excuse or vacation made the occurrence Excused makes it Satisfied as of the approval, with no penalty; a Weekly count week once its approved days reach the target (vac:78; `settle`, `settle.ts`; design review ticket 26). A One-time pact stays Ended as of the Excused judging. A rejection leaves it Excused. Test: `evidence.test.ts`, "a late approval on an Excused occurrence".
- The owner is told each decision (`evidence-decided`). A rejection shows an alert until the owner takes the L or files an excuse (`rejectedEvidenceAlerts`, `evidence.ts:344`). On a Weekly count, the rejected-day alert appears when the week is judged (`rejectedDayAlerts`, `evidence.ts:398`).
- Take the L accepts a miss and clears its alert (`acceptMiss`, `evidence.ts:99`). Test: `accept-miss.test.ts`.

### Oura Ring

- The first long sleep that starts in the night window decides the night: Satisfied if it starts by the in-bed-by time, Missed if later. No sleep by the time the night closes means Missed at close. The first long sleep is stored on the night as it arrives, with when it arrived, and the night is settled from it (`judgeNights`, `bedtime.ts:168`). Test: `bedtime.test.ts`.
- An approved excuse beats a late sleep. A sleep on time beats an excuse (`verdictOf`; decided in pact-v0 ticket 08).
- If no Oura data has come in by 15:00 the next day, the owner gets one push for that night and a No Oura data card, unless the night is no longer something to do (`noOuraDataPushAt`, `occurrences.ts:525`; `pushNoOuraData`, `bedtime.ts:137`). Test: `oura-no-data.test.ts`.
- Oura is asked at most every 15 seconds when the owner checks now (`checkOura`, `bedtime.ts:28`). A failed fetch is logged and retried next tick and affects only that account. A revoked token marks the connection Needs reconnecting and stops calls for that account (decided in pact-v0 tickets 08 and 09). Disconnecting deletes the tokens.

### Anki

- An Anki day is Satisfied at the first check showing 0 new, 0 learning and 0 review cards left (`recordAnkiChecks`, `anki-days.ts:174`, which settles the day). Test: `anki-days.test.ts`.
- Days still to do are polled every 10 minutes, and the owner can check now at most every 15 seconds (`ANKI_POLL_INTERVAL_MS`, `anki-days.ts:15`; `ankiDaysWaiting`, `anki-days.ts:91`).
- A check still running at the due time holds judging for up to 3 minutes (`ANKI_CHECK_HOLDS_JUDGING_MS`, `judging.ts:18`).
- Losing the connection marks it Needs reconnecting (`markDisconnected`, `connections.ts:91`). A deck that no longer exists raises an alert (`anki_pact_deck`).

## Covers: excuses, vacations and holds

### Excuses

- An excuse covers one pact for a range of days and needs a reason, at most 3 photos (`MAX_EXCUSE_PHOTOS`) and at most 62 days (`MAX_EXCUSE_SPAN_DAYS`) (`fileExcuse`, `excuses.ts:92`; `excusePreview`, `excuses.ts:233`). Test: `excuses.test.ts`.
- It can cover future days, today, and past days that are still waiting on evidence or were Missed with their excuse window still open (`excuseOptions`, `excuses.ts:66`; `EXCUSE_WINDOW_MS`, `pact-rules.ts:42`). The window is 48 hours from the later of the day's judging and the rejection or withdrawal of a vacation that covered it (rule R3 in `.scratch/design-review/spec.md`).
- Days after the end, days already excused, and days on a waiting vacation are skipped (`excuseSkipReason`, `excuses.ts:267`). Days a change removed from the schedule are not offered (`excuseDays`, `excuses.ts:277`).
- On a Weekly count, excusing any day of a week covers the whole week (`excusePreview`, `excuses.ts:248`). Test: `weekly-count.test.ts:440`.
- An excuse dated any day of a Submit anytime window covers the One-time occurrence (decided in pact-v0 ticket 15).
- The pact's reviewers get a push. Any one of them decides it (`decideExcuse`, `excuses.ts:331`).
- Approval turns Missed days into Excused and deletes their penalties, and judges days past their due time as Excused now. Oura nights not judged yet are left to judging, which waits for Oura until they close. Rejection and withdrawal settle the days too, which changes nothing, and a check of AnkiWeb still running holds an Anki day as it does for the tick (`settleCoverDays`, `settle.ts:113`).
- After a rejection the owner can file again while a day is still excusable, or take the L. The alert goes once no day is left (`rejectedExcuseAlerts`, `excuses.ts:426`; `acceptExcuseRejection`, `excuses.ts:171`). A rejected excuse never restarts a day's window (v0:256; `excuses.test.ts` "re-filing after a rejection").
- The owner cannot withdraw an excuse; the system withdraws a moot one (see "Withdrawn items").

### Vacations

- A vacation covers several pacts at once, for dates after today, at most 62 days. The owner picks the reviewers who decide it from the pacts' reviewers (`vacationPreview`, `vacations.ts:113`; `fileVacation`, `vacations.ts:217`). Test: `vacations.test.ts`.
- It offers Active pacts past their edit window. A One-time pact whose occurrence is already open is listed but cannot be covered (`offeredPacts`, `vacations.ts:77`; `vacationSkipReason`, `vacations.ts:181`).
- A Weekly count week is covered only when the vacation covers every day from Thursday on. The Check step lists each week it does not cover (`pactPreview`, `vacations.ts:150`; `PlanVacation.tsx:420-425`). This differs on purpose from an excuse (rule R11 in `.scratch/design-review/spec.md`).
- Only its deciders are told, see it in their Review Queue, get the owner's replies and may decide it: the picked reviewers who still review a covered pact, or with none left, any current reviewer of a covered pact (rule R5, design review ticket 19). A picked reviewer removed from every covered pact loses it; a reviewer added while a picked one remains does not get it. When an approved change removes the last picked reviewer, each new decider gets the usual review-item push for the vacation, once; a reviewer added to a covered pact once no picked reviewer remains sees it in the queue without a push. The Profile card's "Sent to", the owner's reply message ("It's back with …") and the review item name the current deciders, not the reviewers picked at filing (design review ticket 30) (`vacationDeciders`, `tellNewVacationDeciders`, `vacations.ts`). Test: `vacations.test.ts`, "who decides a vacation when a covered pact's reviewers change". Approval excuses each covered day as an approved excuse would (`decideVacation`, `vacations.ts:552`).
- The owner can withdraw a vacation that waits. Nobody is notified (`withdrawVacation`, `vacations.ts`). A vacation the system withdraws as moot leaves Profile as one the owner withdrew does: a vacation has no page of its own to show the reason.
- Rejecting or withdrawing a vacation reopens the excuse window of each covered day already Missed: 48 hours from the rejection or withdrawal (rule R3). Those days show on Today's Missed for the rest of it, beside the rejection alert. The rejection push and the alert say which days can be excused and until when ("Mon Jan 12 to Wed Jan 14 can be excused until Sat Jan 17, 8:00am."), and say nothing of excuses when no day can be (`releasedDays`, `decideVacation`, `rejectedVacationAlerts` in `vacations.ts`). Profile's withdraw confirm says the held days can be excused for 48 hours. This reverses vac:81 for vacations only (design review ticket 15). Test: `vacations.test.ts`, "the excuse window a rejected or withdrawn vacation reopens".
- After a rejection, Take the L covers only the days that were Missed at the time of the rejection (`acceptVacationRejection`, `vacations.ts`; decided in vacation ticket 03).
- Moving a One-time deadline keeps a vacation day only if the new deadline is inside the vacation (`moveOneTimeOccurrence`, `pacts.ts:529`; `moveCovers`, `covers.ts:102`).

### Holds and the 48-hour window

- A waiting excuse or vacation that covers a Missed day holds its penalty: it is left off bills and out of what is owed (`PENALTY_HELD`, `money.ts:87`). Test: `ledgers.test.ts`.
- A bill takes only penalties whose excuse window closed by its time, so a Missed day can still be excused before it is billed (`billOwner`, `money.ts`). The window opens at the later of the day's judging and the rejection or withdrawal of a vacation that covered it, except that nothing reopens it once the penalty is on a bill (bills made before R3 could hold one); one expression decides it everywhere it is read: the occurrence view, excuse filing, Today's Missed cards and alerts, the ledger's next bill, and bills (`excuseWindowOpensSql` and `excusableUntil`, `covers.ts`; rule R3).
- Excuses and vacations are read as one kind of cover (`covers.ts`; the `cover_day_v` view). When one day has several covers, a waiting excuse comes first, then an approved excuse, then an approved vacation, then a waiting vacation (`coverOn`, `covers.ts:55`). A rejected or withdrawn cover covers nothing.
- A waiting excuse takes the day off the owner's to-do list and stops its reminders. A waiting vacation keeps both (`keepsToDo`, `covers.ts:76`; rule R7 below).

## Review items

The five kinds are evidence, excuses, vacations, payments and change requests.

- Who decides: each kind's handler's `deciders` (`itemToDecide`, `review.ts:139`; the handlers are listed in `REQUEST_KINDS`, `request-kinds.ts`):
  - Evidence and excuses: the pact's current reviewers.
  - Payments: anyone who reviews one of the owner's pacts with that recipient, now, in earlier terms, or through a penalty to it (`paymentReviewersSql`, `money.ts:72`).
  - Vacations: the reviewers picked at filing who still review at least one of its pacts; when none are left, every current reviewer of one of its pacts (`vacationDeciders`, `vacations.ts`; rule R5 in `.scratch/design-review/spec.md`). This changes vac:69 and vac:70, which fixed the picked reviewers at filing.
  - Change requests: the pact's reviewers, while the request is not withdrawn and the pact is Active.
- The first decision is final. Others get `already-decided`. A rejection needs a reason (`decide`, `review.ts:98`). Test: `review.test.ts`.
- A reviewer can ask the owner a question. Only the owner is notified, and the item leaves the review queue until the owner replies. The reply notifies every reviewer (`askOwner`, `review.ts:54`; `ownerReply`, `review.ts:78`; decided in pact-v0 ticket 12). Test: `reviewer-questions.test.ts`.
- The review queue shows change requests first, then everything else oldest first (`queuedItems`, `review.ts`; `queueFirst` on `changeRequestKind`).
- No item decides itself, and none expires (rule R2 in `.scratch/design-review/spec.md`, design review ticket 21). Instead, at 09:00 in the recipient's timezone, once a day at most (`remindStale`, `stale-items.ts`, run in the tick; `stale_notice` keeps it to one a day across a restart):
  - A reviewer is pushed while an item in their Review Queue has waited more than 24 hours by that 09:00: "3 items wait for your review", "The oldest, Jordan's evidence for Gym, has waited 2 days.", opening Review. The count is the whole Review Queue. An item waits from when it was sent for a decision, or from the owner's latest reply if later, which sent it back (`reviewQueueWaits`, `review.ts`). Items waiting on the owner's reply aren't counted. Days are calendar days in the reviewer's timezone. It follows the "New review item" setting.
  - The owner is pushed while a reviewer's question to them has gone unanswered more than 24 hours by that 09:00, naming the oldest: "Sam asked about your excuse for Gym 2 days ago", "Reply so they can decide.", opening the item's own page. It follows the "Comment" setting.
  - So evidence filed Monday 10:00 and not decided is first reminded Wednesday 09:00, then daily until it's decided. A payment that covers the whole overdue amount and is never decided is reminded this way too, since it is in the reviewer's queue. Test: `stale-items.test.ts`.
  - Future idea, not planned: an item decided by default after N days. Rejected for now because between two friends either default is wrong: automatic approval is exploitable and automatic rejection is unfair.
- Withdrawal: an owner can withdraw a change request or a vacation, not evidence, an excuse or a payment.
- Withdrawn items (rule R8 in `.scratch/design-review/spec.md`, design review ticket 20): when deciding a waiting item either way can no longer change any outcome, penalty or terms, the system withdraws it and records why, after every command and tick (`withdrawMoot`, `review.ts`, run in the core's `#command`). Evidence, an excuse or a vacation is moot when `verdictOf`, judged with it approved now and with it rejected now, gives every occurrence it touches the same final verdict and penalty (not open, nor waiting on something else), or it touches none any more. Evidence is judged approved together with the occurrence's other waiting evidence, so pieces of a Weekly count week that reach the target only together all stay, and evidence that couldn't reach the target even with every waiting piece approved is withdrawn (design review ticket 32) (`decisionEffect`, `verdict.ts`; `mootReason`, `moot.ts`). For a vacation that means no covered day left on any pact. A change request is moot once its pact has Ended. A payment never is: approving one always changes the ledger. Reasons: `pact-ended` when the occurrences are past the pact's end (or gone with an approved end), else `no-longer-needed`; the owner's own withdrawal records `owner`. Cases:
  - Withdrawn: an excuse or vacation whose every day a change removed or an approved end left past the pact's end; one whose every covered day approved evidence made Satisfied (once the day is judged); evidence for a Weekly count week its approved days already Satisfied (once the week is judged); a change request when its pact Ends.
  - Kept: evidence for a day an approved cover already made Excused, since approving it makes the day Satisfied (vac:78), and on a Weekly count week judged Excused, every waiting piece while approving all of them would reach the target; evidence or a cover on an occurrence still open, deferred on that evidence, or Missed; a payment; a change request on an Active pact.
  - A withdrawn item leaves every Review Queue, the list waiting on a reply, the owner's waiting list, and Today's question alerts; the owner can no longer reply to it. Nobody is pushed. Withdrawn evidence no longer counts as waiting, so it holds up no judging; a withdrawn excuse covers nothing. Withdrawing a moot excuse or vacation releases nothing, since it holds no penalty (`assertHoldsNoPenalty`, `moot.ts`).
  - The owner's evidence, excuse and change request pages say "Withdrawn when Gym Ended", "Withdrawn: no longer needed" or "You withdrew it", with the date (`StateLine`, `src/client/item-page.tsx`). An excuse left with no day of the pact's (all removed by a change, or past an approved end) shows neither its dates nor its Days list (`ExcusePage.test.tsx`). A reviewer who tries to decide a withdrawn item gets `withdrawn` with the reason, and the Review tab says so ("Withdrawn: Gym Ended.", `refusalText`, `Review.tsx`).
  - Test: `withdrawal.test.ts`; `Review.test.tsx`, "approving an item the system withdrew says why it was withdrawn".
- Waiting lists: the owner has one waiting list, built over the registry for all five kinds (`waitingFor`, `src/core/waiting.ts`). Today's Waiting for approval shows all of it, newest first. The pact page's Waiting on shows the part that concerns the pact: its change request, evidence and excuses, and waiting vacations covering a day of it; never payments. Each row is the same everywhere (`WaitingItemRow`, `src/client/item-page.tsx`) and opens the item's own page (`openItem`): evidence its evidence page, an excuse, a payment or a change request its page, and a vacation the Profile sheet, where its card is (a vacation has no page of its own). A reviewer's question about any waiting item, a vacation's included, shows on Today as an alert whose Reply opens the same page (`questionAlerts`, `today.ts`); a vacation's Profile card keeps its Reply too. This overrides vac:71, vac:104 and vac:145, which kept waiting vacations and their questions off Today (rule R10 in `.scratch/design-review/spec.md`, design review ticket 18). Test: `vacations.test.ts`, "a waiting vacation in the owner's waiting list" and "a question about a vacation"; `Today.test.tsx` and `PactPage.test.tsx`.

## Money

- A penalty is owed to its recipient. Owed is unheld penalties less approved payments, never below zero (`ledgerSummaries`, `money.ts`).
- Approved payments beyond the unheld penalties are the ledger's credit, which arises when a paid penalty is then excused. The ledger card shows it beside owed $0 ("$5 credit · pays your next penalties") until the next penalties use it up; Today shows nothing for it. While a waiting excuse or vacation holds a penalty the credit would pay if rejected, the card says the credit lasts only if that is approved ("$5 credit if the excuse is approved"). Allocation and billing are unchanged: the credit pays the next penalties through `allocate` (`creditCents` and `creditWaitsOn`, `ledgerSummaries`, `money.ts`; rule R12 in `.scratch/design-review/spec.md`). Test: `ledgers.test.ts`, `Ledgers.test.tsx`.
- Bills are made each Wednesday at 18:00 in the owner's timezone, one per recipient, due 7 days later (`makeBills`, `money.ts:377`; `BILL_TERM_DAYS`, `bill-math.ts`). The owner is told only if something on it is unpaid. Test: `bills.test.ts`.
- A payment needs a screenshot and may not exceed what is owed less payments already waiting (`recordPayment`, `money.ts:93`; `paymentAcceptance`, `money.ts:604`). Test: `payments.test.ts`.
- Approved payments go to billed penalties first, oldest bill first, then to unbilled ones by when they were added. Held penalties are skipped (`allocate`, `money.ts:310`).
- An Overdue spell starts when a bill is past due and unpaid. The owner is reminded daily. Reviewers are told when the spell starts and weekly after (`remindOverdue`, `money.ts:444`; `overdueOf`, `bill-math.ts:35`).
- A payment waiting for approval stops Overdue reminders only for the part of the overdue amount it covers (rule R6 in `.scratch/design-review/spec.md`; `overdueOf`, `bill-math.ts:35-50`): a $1 payment waiting against $15 overdue leaves the daily reminder running for $14 (`bills.test.ts`, "F6"). One covering the whole amount stops them, and its reviewers get the daily stale-item reminder instead (see Review items).
- The overdue alert names reviewers only once they have been told in this spell (`billsForToday`, `money.ts:531`; decided in pact-v0 ticket 19).

## Notifications and reminders

- Each push belongs to one setting the person can turn off: picked as reviewer, review item, decision, comment, missed occurrence, new bill, overdue bill, connection problem (`NOTIFICATION_SETTINGS`, `src/shared/types.ts:712`; `SETTING_OF_KIND`, `outbox.ts`). The daily stale-item reminders have no setting of their own: a reviewer's follows review item, an owner's follows comment. Test: `notifications.test.ts`, `stale-items.test.ts`.
- Pushes are written to an outbox and sent after the change commits.
- Reminders go at their times in the account's timezone, once each (`remind`, `reminders.ts:37`; `reminder_sent`). One more than 15 minutes late is dropped with an operator alert (`REMINDER_LATE_MS`, `reminders.ts:25`). Test: `reminders.test.ts`.
- A reminder fires for an occurrence if and only if Today shows it as the owner's to do (a To do card, or for a bedtime night the Automatic or No Oura data card), as far as cover, judging and evidence go: one view decides both (`toDo` and `remind`, `occurrenceView`, `occurrence-state.ts:115`; rule R7 in `.scratch/design-review/spec.md`). An approved cover or a waiting excuse removes both; a waiting vacation keeps both. Reminders keep their own timing: each goes at its time, before the due time. Otherwise (`worthReminding`, `reminders.ts:111`):
  - Oura Ring: sent every scheduled night until Oura has judged it. The ring usually syncs the next morning, so most nights are reminded even when the owner is already in bed; a night judged before its reminder gets none (ticket 24 in `.scratch/design-review/issues/`).
  - Anki: sent until the day is judged.
  - Camera: sent while no evidence is in for the occurrence and it is not judged.
  - Weekly count: sent on a day with no evidence, while approved and waiting days are fewer than the target. Test: `reminders.test.ts`.
- Today shows alerts with connection problems first, then bills, then the rest newest first (`todayAlerts`, `today.ts:128`). Its sections are No Oura data, To do (bills included, by due time), Missed, Automatic and Coming up (`todaySections`, `today.ts:159`). Missed shows days whose excuse window is still open (rule R3), without misses from a rejection, days on a waiting cover, or days on a rejected excuse while its alert stands, whether the day was judged before or after the rejection: the alert files another excuse for them (`recentlyMissed`, `today.ts`; `rejectedExcuseAlertStandsSql`, `excuses.ts`). Test: `excuses.test.ts` "a rejected excuse with days not judged yet".
- Invites are single use and last 7 days. Your own invite, or one from someone already a friend, is refused (`INVITE_LIFETIME_MS`, `accounts.ts:179`). Test: `invites.test.ts`.

## Text and request limits

- Free text is capped, counted after trimming: a pact's or a recipient's name at 80 characters (`MAX_NAME_CHARS`), and every other text at 2,000 (`MAX_TEXT_CHARS`, both in `src/shared/types.ts`): a pact's description, change request and end request notes, excuse reasons, vacation and payment notes, reject reasons, questions and replies. Longer text is refused with `text-too-long` (`text-limits.ts`). The client's text fields stop at the same caps (`maxLength`). Test: `text-limits.test.ts`.
- An /api request body over 64 KB is refused with HTTP 413 (`body-too-large`) before it is read. The three photo upload routes (evidence, excuses, payments) have their own larger limits (`MAX_JSON_BODY_BYTES`, `photoBodyLimit`, `src/server/app.ts`). Test: `app.test.ts`, "a JSON body over 64 KB".
- Text stored before these caps is left as it is.

## Time and timezones

- Everything runs on the account's timezone except Oura Ring nights, which use the offset Oura reports (`ouraOffset`, `rows.ts:217`; `noteOuraClock`, `bedtime.ts:52`). Test: `timezone.test.ts`.
- Every account has a timezone. A new account gets its browser's timezone at sign-up: the client sends it through Google's redirect in the OAuth state (`TIMEZONE_SIGN_IN_KEY`, `src/shared/api.ts`), and `signIn` stores its canonical name (`accounts.ts:27`). A sign-in with no timezone, or one `Intl` does not accept, gets UTC; it is never refused. Signing in again leaves the timezone alone. The person sees it and can change it in Profile. There is no "Is this your timezone?" screen: this differs from story 2 in `.scratch/pact-v0/spec.md` (ticket 22). Migration 30 gave UTC to accounts made before this that never confirmed one. Test: `sign-in.test.ts`.

## Loading screens

- A tab or page opened again shows what it last loaded at once while it loads afresh; if that load fails, it keeps showing it with "couldn't load" above. When the app opens it loads the tabs not shown, so the first visit to each is quick too. Forms and pickers (editing or changing a pact, planning a vacation, the deck and reviewer pickers, notification settings) always load afresh, and so does a pact's page, because its name, reviewer and reminders changes send the pact's whole terms back (`useLoad`'s `key`, `src/client/ui.tsx`; `src/client/last-loaded.ts`). Test: `last-loaded.test.tsx`; `PactPage.test.tsx`, "a pact page opened again starts blank".
- Any command the person sends, refused or not, and signing out forget everything loaded, so no screen shows what was there before their own action; the app then loads the four tabs again in the background, so they are quick again about a round trip later. Signing out stops those loads first. The app's own checks, push subscriptions and previews forget nothing (`post` and `postQuietly`, `src/client/api.ts`; `reloadWhenForgotten`, `src/client/last-loaded.ts`). Test: `api.test.ts`, `last-loaded.test.tsx`.
