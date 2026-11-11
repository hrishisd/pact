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
- Reviewers are told they were picked only when the window closes, and evidence submitted inside the window goes to them then (`closeEditWindows`, `pacts.ts:571`). Until then a reviewer cannot see or decide the pact's evidence (`evidence.ts:204`; `itemToDecide` in `review.ts:177`).
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
- One-time: the new deadline must be at least an hour away, both when sent and when approved (`deadlineFarEnough` in `checkedChange`; `approvableNow`, `change-requests.ts:745`). A request decided after the occurrence was judged leaves the pact as it was (`applyOneTimeTerms`, `change-requests.ts:483`). Test: `one-time.test.ts`.
- Before approving a change request, the decider first catches judging up to now (`decide`, `review.ts:124`), so terms never apply to an occurrence already due.
- A reviewer being removed can still decide until the request is approved, and is deleted at approval (`changeOutcome`, `change-requests.ts:363`; `decideChangeRequest`, `change-requests.ts:696`). The owner is told the outcome (`change-request-decided`).
- The owner can withdraw a waiting request. Nobody is notified (`withdrawChangeRequest`, `change-requests.ts:161`).
- An end request is refused once the pact has Ended, while the edit window is open, or while another request waits (`requestEnd`, `change-requests.ts:128`).
- An approved end request Ends the pact at once (`decideChangeRequest` calls `endPact(now)`). **Known bug:** this drops the occurrence open at approval instead of letting it be judged, unlike every other change. See [ticket 13](../.scratch/design-review/issues/13-one-end-pact.md). Evidence already waiting for that day stays in the queue (interaction audit P5c).
- **Known bug:** when an approved change removes a day from the schedule, an excuse or vacation that covers that day is not deleted. A later change that adds the day back finds it already covered. See [ticket 14](../.scratch/design-review/issues/14-cover-cleanup-on-schedule-change.md).

### Ending

- A pact with an end date Ends at the start of the day after the end date, or when its last occurrence closes if that is later. Nobody is notified (`endPastEndDate`, `judging.ts:94`). Test: `due-by-and-dates.test.ts`.
- A One-time pact Ends when its occurrence is judged (`judge`, `judging.ts:189`).
- Ending withdraws a waiting change request, silently (`endPact`, `judging.ts:234`).
- Only Active pacts are judged and reminded (`pactsToJudge`, `occurrence-state.ts:230`; `remind`, `reminders.ts:37`). An occurrence due after the end is ignored (`dueAfterEnd`, `occurrence-state.ts:202`).
- The pact list shows pacts in the edit window first, then Active, then Ended (`pactList`, `pacts.ts:207`).

## Occurrences and judging

### Days and due times

- A Camera day runs from midnight in the account's timezone to the due time (`fixedDaysOccurrence`, `occurrences.ts:453`; `dayClockOf`, `pact-rules.ts:176`).
- An Oura Ring night opens at the start of its date and is due at the in-bed-by time. A time before 18:00 means the next day. The night closes at 18:00 the next day. All of it is read on Oura's clock (`nightStartsAt`, `occurrences.ts:517`; `ouraOffset`, `rows.ts:257`). Test: `oura.test.ts`.
- An Anki day opens at its rollover hour. Due-by is allowed from noon on day D, after the rollover hour, up to the rollover hour on D+1. Other times are refused (`ankiDueByDayAfter`, `occurrences.ts:404`). Anki days use the account's timezone, not the collection's (deviation from the anki spec, noted in anki ticket 03).
- A Weekly count week runs Monday to Sunday and is due at the end of Sunday (`weekOccurrence`, `occurrences.ts:384`).
- A One-time occurrence with Submit anytime opens at creation. Otherwise it opens at the start of the deadline's date (`oneTimeOccurrence`, `occurrences.ts:368`).

### Judging

- The tick judges each Active pact's occurrences in due order, and keeps a `judged_through` cursor (`judgePactDueBy`, `judging.ts:49`). Test: `judging.test.ts`.
- At the due time an occurrence is judged in this order (`judgeAtDueTime`, `judging.ts:124`):
  1. Approved evidence: Satisfied.
  2. An approved excuse or vacation: Excused.
  3. Evidence waiting for a reviewer: wait.
  4. Otherwise: Missed, with the penalty.
- The owner gets a Missed push only when no excuse or vacation covers the day, waiting or approved (`judging.ts:138`; decided in pact-v0 ticket 07).
- A Weekly count week is Satisfied when its days of approved evidence reach the target. Otherwise an approved cover makes it Excused, waiting evidence holds it, and else it is Missed with one penalty of days short × penalty (`judgeWeek`, `judging.ts:149`; `judge`, `judging.ts:189`). Test: `weekly-count.test.ts`.
- The penalty uses the terms that applied to the occurrence, including its recipient (`termsOn`, in `judge`).
- A One-time occurrence with approved evidence is Satisfied at the deadline (decided in pact-v0 ticket 15).

### Evidence

- Camera only. One to 10 photos (`MAX_EVIDENCE_PHOTOS`), for the occurrence open now and before its due time. The received time is the latest photo's receipt (`submitEvidence`, `evidence.ts:62`; `evidenceAcceptance`, `evidence.ts:294`). Test: `evidence.test.ts`.
- One piece of evidence per day may wait or be approved. On a Weekly count, a day with rejected evidence takes no more (decided in pact-v0 ticket 14). Evidence is refused once the occurrence is judged or the pact has Ended.
- A rejection judges the occurrence Missed at once, unless the day was excused ahead, which leaves it Excused (`decideEvidence`, `evidence.ts:231`; decided in pact-v0 ticket 07). Test: `rejection.test.ts`.
- An approval judges the occurrence Satisfied at once if judging has already reached the day.
- A late decision on a Weekly count week judges the week but does not tell the owner it was Missed (`decideEvidence` passes `tell = false` to `judgeWeek`). **Known bug:** the owner should be told whenever a week becomes Missed. See [ticket 11](../.scratch/design-review/issues/11-settle-tick-and-evidence.md).
- The owner is told each decision (`evidence-decided`). A rejection shows an alert until the owner takes the L or files an excuse (`rejectedEvidenceAlerts`, `evidence.ts:366`). On a Weekly count, the rejected-day alert appears when the week is judged (`rejectedDayAlerts`, `evidence.ts:419`).
- Take the L accepts a miss and clears its alert (`acceptMiss`, `evidence.ts:103`). Test: `accept-miss.test.ts`.

### Oura Ring

- The first long sleep that starts in the night window decides the night: Satisfied if it starts by the in-bed-by time, Missed if later. No sleep by the time the night closes means Missed at close (`judgeNights`, `bedtime.ts:180`). Test: `bedtime.test.ts`.
- An approved excuse beats a late sleep. A sleep on time beats an excuse (`judgeNights`; decided in pact-v0 ticket 08).
- If no Oura data has come in by 15:00 the next day, the owner gets one push for that night and a No Oura data card, unless the night is no longer something to do (`noOuraDataPushAt`, `occurrences.ts:525`; `pushNoOuraData`, `bedtime.ts:147`). Test: `oura-no-data.test.ts`.
- Oura is asked at most every 15 seconds when the owner checks now (`checkOura`, `bedtime.ts:28`). A failed fetch is logged and retried next tick and affects only that account. A revoked token marks the connection Needs reconnecting and stops calls for that account (decided in pact-v0 tickets 08 and 09). Disconnecting deletes the tokens.

### Anki

- An Anki day is Satisfied at the first check showing 0 new, 0 learning and 0 review cards left (`recordAnkiChecks`, `anki-days.ts:170`). Test: `anki-days.test.ts`.
- Days still to do are polled every 10 minutes, and the owner can check now at most every 15 seconds (`ANKI_POLL_INTERVAL_MS`, `anki-days.ts:15`; `ankiDaysWaiting`, `anki-days.ts:91`).
- A check still running at the due time holds judging for up to 3 minutes (`ANKI_CHECK_HOLDS_JUDGING_MS`, `judging.ts:26`).
- Losing the connection marks it Needs reconnecting (`markDisconnected`, `connections.ts:91`). A deck that no longer exists raises an alert (`anki_pact_deck`).

## Covers: excuses, vacations and holds

### Excuses

- An excuse covers one pact for a range of days and needs a reason, at most 3 photos (`MAX_EXCUSE_PHOTOS`) and at most 62 days (`MAX_EXCUSE_SPAN_DAYS`) (`fileExcuse`, `excuses.ts:92`; `excusePreview`, `excuses.ts:233`). Test: `excuses.test.ts`.
- It can cover future days, today, and past days that were Missed within the last 48 hours or are still waiting on evidence (`excuseOptions`, `excuses.ts:66`; `EXCUSE_WINDOW_MS`, `pact-rules.ts:42`).
- Days after the end, days already excused, and days on a waiting vacation are skipped (`excuseSkipReason`, `excuses.ts:267`). Days a change removed from the schedule are not offered (`excuseDays`, `excuses.ts:277`).
- On a Weekly count, excusing any day of a week covers the whole week (`excusePreview`, `excuses.ts:248`). Test: `weekly-count.test.ts:440`.
- An excuse dated any day of a Submit anytime window covers the One-time occurrence (decided in pact-v0 ticket 15).
- The pact's reviewers get a push. Any one of them decides it (`decideExcuse`, `excuses.ts:334`).
- Approval turns Missed days into Excused and deletes their penalties, and judges days that judging has reached as Excused now. Oura nights are left to judging (`excuseApprovedDays`, `excuses.ts:369`).
- After a rejection the owner can file again while a day is still excusable, or take the L. The alert goes once no day is left (`rejectedExcuseAlerts`, `excuses.ts:465`; `acceptExcuseRejection`, `excuses.ts:175`).
- An excuse cannot be withdrawn.

### Vacations

- A vacation covers several pacts at once, for dates after today, at most 62 days. The owner picks the reviewers who decide it from the pacts' reviewers (`vacationPreview`, `vacations.ts:113`; `fileVacation`, `vacations.ts:217`). Test: `vacations.test.ts`.
- It offers Active pacts past their edit window. A One-time pact whose occurrence is already open is listed but cannot be covered (`offeredPacts`, `vacations.ts:77`; `vacationSkipReason`, `vacations.ts:181`).
- A Weekly count week is covered only when the vacation covers every day from Thursday on. The Check step lists each week it does not cover (`pactPreview`, `vacations.ts:150`; `PlanVacation.tsx:420-425`). This differs on purpose from an excuse (rule R11 in `.scratch/design-review/spec.md`).
- Only the picked reviewers are told and may decide (`vacationToDecide`, `vacations.ts:525`). Approval excuses each covered day as an approved excuse would (`decideVacation`, `vacations.ts:548`).
- The owner can withdraw a vacation that waits. Nobody is notified (`withdrawVacation`, `vacations.ts:583`).
- After a rejection, Take the L covers only the days that were Missed at the time of the rejection (`acceptVacationRejection`, `vacations.ts:654`; decided in vacation ticket 03).
- Moving a One-time deadline keeps a vacation day only if the new deadline is inside the vacation (`moveOneTimeOccurrence`, `pacts.ts:528`).

### Holds and the 48-hour window

- A waiting excuse or vacation that covers a Missed day holds its penalty: it is left off bills and out of what is owed (`PENALTY_HELD`, `money.ts:85`). Test: `ledgers.test.ts`.
- A bill takes only penalties added at least 48 hours before it, so a Missed day can still be excused before it is billed (`billOwner`, `money.ts:394`).
- When one day has several covers, a waiting excuse comes first, then an approved excuse or vacation, then a waiting vacation (`excuseOn`, `occurrence-state.ts:67`).
- A waiting excuse takes the day off the owner's to-do list. A waiting vacation does not (`stillToDo`, `occurrence-state.ts:88`).

## Review items

The five kinds are evidence, excuses, vacations, payments and change requests.

- Who decides (`itemToDecide`, `review.ts:177`):
  - Evidence and excuses: the pact's current reviewers.
  - Payments: anyone who reviews one of the owner's pacts with that recipient, now, in earlier terms, or through a penalty to it (`paymentReviewersSql`, `money.ts:72`).
  - Vacations: the picked reviewers.
  - Change requests: the pact's reviewers, while the request is not withdrawn and the pact is Active.
- The first decision is final. Others get `already-decided`. A rejection needs a reason (`decide`, `review.ts:124`). Test: `review.test.ts`.
- A reviewer can ask the owner a question. Only the owner is notified, and the item leaves the review queue until the owner replies. The reply notifies every reviewer (`askOwner`, `review.ts:83`; `ownerReply`, `review.ts:105`; decided in pact-v0 ticket 12). Test: `reviewer-questions.test.ts`.
- The review queue shows change requests first, then everything else oldest first (`reviewItems`, `review.ts:303`; `reviewItemSince`, `review.ts:365`).
- Withdrawal: an owner can withdraw a change request or a vacation, not evidence, an excuse or a payment.
- Waiting lists: Today lists the owner's waiting change requests, evidence, excuses and payments (`waiting`, `today.ts:102`). The pact page lists change requests, evidence and excuses (`pactPage`, `pacts.ts:241-262`). Waiting vacations appear on neither, only on Profile, so a reviewer's question about a vacation does not show on Today (`questionAlerts`, `today.ts:81`).

## Money

- A penalty is owed to its recipient. Owed is unheld penalties less approved payments, never below zero (`ledgerSummaries`, `money.ts:248`).
- Bills are made each Wednesday at 18:00 in the owner's timezone, one per recipient, due 7 days later (`makeBills`, `money.ts:376`; `BILL_TERM_DAYS`, `bill-math.ts`). The owner is told only if something on it is unpaid. Test: `bills.test.ts`.
- A payment needs a screenshot and may not exceed what is owed less payments already waiting (`recordPayment`, `money.ts:93`; `paymentAcceptance`, `money.ts:604`). Test: `payments.test.ts`.
- Approved payments go to billed penalties first, oldest bill first, then to unbilled ones by when they were added. Held penalties are skipped (`allocate`, `money.ts:310`).
- An Overdue spell starts when a bill is past due and unpaid. The owner is reminded daily. Reviewers are told when the spell starts and weekly after (`remindOverdue`, `money.ts:444`; `overdueOf`, `bill-math.ts:35`).
- A payment waiting for approval stops Overdue reminders only for the part of the overdue amount it covers (rule R6 in `.scratch/design-review/spec.md`; `overdueOf`, `bill-math.ts:35-50`; `bills.test.ts:301`).
- The overdue alert names reviewers only once they have been told in this spell (`billsForToday`, `money.ts:531`; decided in pact-v0 ticket 19).

## Notifications and reminders

- Each push belongs to one setting the person can turn off: picked as reviewer, review item, decision, comment, missed occurrence, new bill, overdue bill, connection problem (`NOTIFICATION_SETTINGS`, `src/shared/types.ts:712`). Test: `notifications.test.ts`.
- Pushes are written to an outbox and sent after the change commits.
- Reminders go at their times in the account's timezone, once each (`remind`, `reminders.ts:37`; `reminder_sent`). One more than 15 minutes late is dropped with an operator alert (`REMINDER_LATE_MS`, `reminders.ts:25`). Test: `reminders.test.ts`.
- A reminder is skipped when an approved cover is on the day. Otherwise (`worthReminding`, `reminders.ts:118`):
  - Oura Ring: always sent.
  - Anki: sent until the day is judged.
  - Camera: sent while no evidence is in and the day is not judged.
  - Weekly count: sent while approved and waiting days are fewer than the target.
- **Known bug:** a waiting excuse removes the day from Today's to-do list but its reminders still fire. See [ticket 08](../.scratch/design-review/issues/08-one-occurrence-view.md).
- Today shows alerts with connection problems first, then bills, then the rest newest first (`todayAlerts`, `today.ts:135`). Its sections are No Oura data, To do (bills included, by due time), Missed, Automatic and Coming up (`todaySections`, `today.ts:166`). Missed shows the last 48 hours, without misses from a rejection or covered days (`recentlyMissed`, `today.ts:419`).
- Invites are single use and last 7 days. Your own invite, or one from someone already a friend, is refused (`INVITE_LIFETIME_MS`, `accounts.ts:175`). Test: `invites.test.ts`.

## Text and request limits

- Free text is capped, counted after trimming: a pact's or a recipient's name at 80 characters (`MAX_NAME_CHARS`), and every other text at 2,000 (`MAX_TEXT_CHARS`, both in `src/shared/types.ts`): a pact's description, change request and end request notes, excuse reasons, vacation and payment notes, reject reasons, questions and replies. Longer text is refused with `text-too-long` (`text-limits.ts`). The client's text fields stop at the same caps (`maxLength`). Test: `text-limits.test.ts`.
- An /api request body over 64 KB is refused with HTTP 413 (`body-too-large`) before it is read. The three photo upload routes (evidence, excuses, payments) have their own larger limits (`MAX_JSON_BODY_BYTES`, `photoBodyLimit`, `src/server/app.ts`). Test: `app.test.ts`, "a JSON body over 64 KB".
- Text stored before these caps is left as it is.

## Time and timezones

- Everything runs on the account's timezone except Oura Ring nights, which use the offset Oura reports (`ouraOffset`, `rows.ts:257`; `noteOuraClock`, `bedtime.ts:52`). Test: `timezone.test.ts`.
- An account with no confirmed timezone gets `no-timezone` from creating a pact and from Plan a vacation's options, preview and filing (`vacationOptions`, `previewVacation`, `fileVacation` in `vacations.ts`). **Known bug:** Profile's vacation cards and "Last one" still throw for such an account. See [ticket 22](../.scratch/design-review/issues/22-vacation-cards-without-timezone.md).
