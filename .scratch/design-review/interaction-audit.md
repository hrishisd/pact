# Interaction audit of pending items

Date: 2026-11-10. Scope: the core in `src/core/`, the v0 spec at `.scratch/pact-v0/spec.md` (cited as v0:line) and the vacation spec at `.scratch/vacation/spec.md` (cited as vac:line). Client rendering was not read. Paths below are relative to `src/core/` unless they start with `.scratch/`.

Bugs were confirmed with a temporary vitest built on `scenario()`. It was run beside the core tests and then deleted from the repo. A copy is kept at `/tmp/claude-0/-home-user-pact/961f67e2-43da-52d2-825a-53d7c13a8245/scratchpad/zz-audit-tmp.test.ts`, and its output is at `probe-output.txt` in the same folder. The probes are cited as P1 to P5c.

## Governing rules as implemented

An occurrence is judged against the terms in force when it opened (`termsOn`), and a judged day is never re-judged except by a late evidence decision or a late excuse approval. Waiting evidence defers judging of its occurrence (judging.ts:135, judging.ts:154) while the `judged_through` cursor moves on, and the later decision judges the occurrence as of the decision time (evidence.ts:231-274). A penalty is added at its judging time, can be excused for 48 hours after that, and goes on the Wednesday bill only once those 48 hours have passed and it is not held; a held penalty is one covered by a waiting excuse or waiting vacation, derived in SQL (money.ts:85) and excluded from owed, bills and payment allocation. No pending item expires (v0:263), reviewers are never reminded of a waiting queue, and the only item the system withdraws on its own is a waiting change request when the pact ends (judging.ts:234-243). Evidence, excuses and change requests are decided by whoever reviews the pact now (review.ts:177-217), vacations by the reviewers picked when they were filed (vacations.ts:525-539), and payments by any reviewer of a pact with that recipient (money.ts:683). Ending a pact, whether by end date, by a One-time judgment or by an approved end request, stops judging of every occurrence that has not yet been judged and falls due after `ended_at` (occurrence-state.ts:202-208).

## Table

Columns: the code's behaviour with a citation, whether a doc states it (Doc), whether a test covers it (Test), and the verdict. "n/a" means the event cannot happen to that item.

### Waiting evidence

| # | Event | Code | Doc | Test | Verdict |
|---|---|---|---|---|---|
| 1 | Occurrence opens, falls due, week closes | At the due time a Fixed day with waiting evidence is not judged (judging.ts:135); a Weekly count week with any waiting evidence is not judged (judging.ts:154). The cursor still advances; `judgingReached` (occurrence-state.ts:216) lets the decision judge later. | Yes, v0:232 | Yes, rejection.test.ts:46, weekly-count.test.ts:310 | ok |
| 2 | More evidence submitted | Refused while one waits for that occurrence (evidence.ts:322). Oura or Anki evidence arriving automatically goes through the same acceptance check. | Yes, v0:232 | Yes, evidence tests | ok |
| 3 | Second item of same type | Same as 2: one waiting evidence per occurrence. | Yes | Yes | ok |
| 4 | Excuse filed or approved | A waiting excuse does not affect the waiting evidence. An approved excuse makes the deferred day Excused at once if judging has reached it (excuses.ts:394-396) but leaves the evidence in the queue; a later rejection still pushes "rejected your evidence" (P5a). A change request approved while evidence waits does not affect it: the late decision uses `termsOn` and the old recipient. A vacation cannot cover an already open day (vacations.ts:187). | Partly, v0:218 for change requests; nothing on the dead evidence | Change: change-requests.test.ts:81. Dead evidence: none | design-gap (P5a) |
| 5 | Pact ends or is deleted | Ending: if the day falls due after `ended_at` the decision skips judging (evidence.ts:243), so approving or rejecting does nothing to money; evidence for the day open at an approved end stays in the queue (P5c). Acceptance refuses new evidence once Ended (evidence.ts:328). Deleting removes the evidence (pacts.ts:160-170). | End: v0:226 ("no more days"); deleting: edit window only | change-requests.test.ts:758; edit-window.test.ts:167 | design-gap (P5c), and see finding 1 |
| 6 | Reviewer set changes | Deciders are the current reviewers, so a removed reviewer loses the item and an added one gains it (review.ts:177-217). | Implied by v0 review section | Partly, change-requests.test.ts:822 | ok |
| 7 | Wednesday bill cut | Nothing is billed for a deferred occurrence because it has no penalty yet. After a late Fixed-day rejection the penalty is added at the decision time and goes on the first bill 48 hours later (money.ts:394-434). | Yes, v0:233, v0:277-282 | Yes, rejection.test.ts:46 | ok |
| 8 | Item withdrawn | No withdrawal for evidence. | Not stated | None | unspecified |
| 9 | Reviewer never responds | The occurrence is never judged; no reminder exists. Repeating this daily defers every penalty forever. | v0:263 says items never expire | None | design-gap (finding 2) |
| 10 | Reviewer decides late | Fixed day: approval judges Done, rejection judges Missed now with a push (evidence.ts:253-259). Weekly count: the week is judged late with `tell=false` (evidence.ts:245-252), so a week that comes out Missed gets no missed-occurrence push, only "approved your evidence" (P2). | Fixed: v0:233, v0:324. Weekly: v0:235 counts, push not stated | Fixed: rejection.test.ts:46. Weekly push: none | Fixed ok; Weekly bug (P2) |

### Waiting excuse

| # | Event | Code | Doc | Test | Verdict |
|---|---|---|---|---|---|
| 1 | Occurrence opens, falls due, week closes | A day under a waiting excuse is still judged Missed and gets a penalty, but the penalty is held (money.ts:85) and the missed push is suppressed (judging.ts:138, judging.ts:156). `excuseOn` puts a waiting excuse first (occurrence-state.ts:67-80). Today hides the To do card for a day under a waiting excuse (today.ts:338 via `stillToDo`) while the reminder still fires, because `worthReminding` only skips approved cover (reminders.ts:125) (P4). | Held: v0:245-258. Reminder: v0:285-288 silent on waiting | Held: excuses.test.ts:237. Reminder: reminders.test.ts:169 approved only | inconsistent (P4) |
| 2 | Evidence submitted | Accepted as normal; if approved the day is Done and the excuse becomes redundant for that day. | Not stated | None | unspecified, harmless |
| 3 | Second excuse | Days already under an excuse are skipped (excuses.ts:267-271). | Yes, v0:249 | Yes, excuses.test.ts:319 | ok |
| 4 | Change or vacation filed or approved | A change that removes a covered day: `excuseDays` hides it (excuses.ts:277-288); an excuse whose only day was removed stays in the queue with no days (P5b), and still shows on the owner's Waiting list (excuses.ts:429 uses raw rows). A change that later adds the day back makes it covered again (P3). A vacation filed over a waiting excuse skips those days. | vac:61 for vacations only; nothing for excuses | None | design-gap (P5b); bug (P3) |
| 5 | Pact ends or is deleted | The excuse stays waiting. Approval skips days due after the end (excuses.ts:379); days before the end are still excused and their penalties deleted. Deleting is only possible in the edit window, when no excuse can exist. | Not stated | None | unspecified |
| 6 | Reviewer set changes | Live deciders (review.ts:177-217). | Implied | change-requests.test.ts:822 | ok |
| 7 | Wednesday bill cut | Held penalties are not billed (money.ts:401, money.ts:418). Because the window is 48 hours and the bill only takes penalties older than 48 hours, an excuse cannot reach a billed penalty. If a penalty was paid on a bill and later excused, owed is clamped at zero (money.ts:281) and the surplus becomes an invisible credit. | Held: v0:269-273. Credit: not stated | excuses.test.ts:577 | Held ok; credit unspecified (finding 13) |
| 8 | Item withdrawn | Not possible. | Yes, v0:257 | n/a | ok |
| 9 | Reviewer never responds | Penalties stay held forever, never billed, never reminded. | v0:263 | None | design-gap (finding 2) |
| 10 | Reviewer decides late | Approval deletes the penalty and judges Excused (excuses.ts:369-399). Rejection releases the held penalty with its original `added_at`, so it is billable on the next bill, and an alert is shown (excuses.ts:465). | v0:250-256 | excuses.test.ts:446, 543, 561 | ok |

### Waiting change request (edit terms, end pact, reviewer changes)

| # | Event | Code | Doc | Test | Verdict |
|---|---|---|---|---|---|
| 1 | Occurrence opens, falls due, week closes | No effect on judging; terms apply only to occurrences that open after approval (change-requests.ts:437-476). Before approving, `decide` catches judging up (review.ts:152-160). | Yes, v0:218 | change-requests.test.ts:81 | ok |
| 2 | Evidence submitted | No interaction. | n/a | n/a | ok |
| 3 | Second change request | Refused while one waits (change-requests.ts:134, 343-345), unless the new change applies at once without review. | Yes, v0:223, v0:328 | Yes | ok |
| 4 | Other item filed or approved | Edit terms: an earlier end date keeps the open occurrence (change-requests.ts:455). Removing days does not touch excuse or vacation rows, so a day added back later is covered again (P3). Reviewer change: removed reviewers lose evidence, excuse and change-request items but keep picked vacations (vacations.ts:525-539). End pact: see 5. | v0:218; vac:61, vac:69 | change-requests.test.ts:81; vacations.test.ts:1372 | Edit ok; P3 bug; reviewer variant design-gap (finding 5) |
| 5 | Pact ends (end request approved, end date, One-time judged) | Approved end request calls `endPact(now)` (change-requests.ts:713), so the occurrence open now, which falls due after `ended_at`, is never judged (occurrence-state.ts:202-208). A Weekly count week with zero sessions cost nothing (P1 weekly penalties: []); a Fixed day open at the end with no photo was never judged (P1 fixed). An end by end date waits until the last occurrence closes (judging.ts:94-115). A waiting change request is withdrawn silently when the pact ends any other way. | v0:218 ("Change requests never rescue an open occurrence") contradicts; v0:329 copy "no more days" | change-requests.test.ts:671-721 codifies the drop; 771, 803 silent withdraw | bug (P1, finding 1); silent withdraw unspecified (finding 10) |
| 6 | Reviewer set changes | A reviewer change request is itself decided by the current reviewers; once approved, removal is at once (change-requests.ts:717-719). | v0 change section | change-requests.test.ts:822 | ok |
| 7 | Wednesday bill cut | No interaction. | n/a | n/a | ok |
| 8 | Withdrawn | Owner can withdraw (change-requests.ts:161-174); no push to reviewers, the item just leaves the queue. | v0:328 | Yes | ok |
| 9 | Reviewer never responds | Waits forever and blocks every other reviewed change (change-requests.ts:343-345). The owner can withdraw. | v0:263 | None | design-gap, mild |
| 10 | Reviewer decides late | Catches judging up to now, then applies to occurrences opening afterwards. An end approved late drops whatever is open at approval, which a reviewer can time to excuse a bad week. | v0:218 | change-requests.test.ts:671 | bug (finding 1) |

### Waiting vacation

| # | Event | Code | Doc | Test | Verdict |
|---|---|---|---|---|---|
| 1 | Occurrence opens, falls due, week closes | Covered days are judged, penalties held (money.ts:85), missed push suppressed. Today hides covered days from To do and from recently missed (today.ts:338, today.ts:419-465), and `waiting()` on Today lists no vacations (today.ts:102-111). The pact page Waiting list omits vacations (pacts.ts:255-261) and not-judged days hide vacation-waiting (occurrence-state.ts:180). The Profile card shows them with held cents. Excuses are refused for covered days (excuses.ts:267-271), so the 48 hour window lapses while it waits. | vac:80-81, vac:94, vac:104 | vacations.test.ts:951, 991, 1003, 1040, 1070 | Excuse window design-gap (finding 3); pact page unspecified (finding 11) |
| 2 | Evidence submitted | Accepted; an approved day is Done. | Not stated | None | unspecified, harmless |
| 3 | Second vacation | Covered days skipped. | vac:60 | vacations.test.ts:339 | ok |
| 4 | Other item filed or approved | Waiting excuse days are skipped by the vacation. A change that removes a day stops covering it; a change that adds the day back covers it again through the stale row (P3 shows it for excuses; `vacationOn` reads rows the same way, occurrence-state.ts:97-109). | vac:61 says added days aren't covered | vacations.test.ts:1059 (removal) | bug for re-added day (finding 9), suspected for vacations, confirmed for excuses |
| 5 | Pact ends or is deleted | Vacation stays waiting and decidable (review.ts:212 requires an active pact only for change requests). Deciding it after the end affects only days before the end. | Not stated | None | design-gap (finding 8) |
| 6 | Reviewer set changes | Deciders frozen in `vacation_reviewer` (vacations.ts:525-539): a removed reviewer still decides, a newly added one cannot. | vac:69 | vacations.test.ts:1372 | design-gap (finding 5) |
| 7 | Wednesday bill cut | Held penalties not billed. Weekly count week covered only if its Thursday is inside the vacation; an excuse covers a week with any one day. | vac:58 states the reason | weekly-count.test.ts:339, 440 | design-gap, minor (finding 12) |
| 8 | Withdrawn | Allowed while waiting (vacations.ts:583-593); held penalties are released at their original `added_at`, no one is told. The withdrawn days cannot be re-covered by an excuse if more than 48 hours have passed. | vac:63 | vacations.test.ts:590 | ok, but feeds finding 3 |
| 9 | Reviewer never responds | Held forever; adding a reviewer does not help (frozen deciders). | vac:148 notes lenient reviewers only | None | design-gap (findings 2, 5) |
| 10 | Reviewer decides late | Approval excuses covered Missed days. Rejection releases penalties, shows an alert (vacations.ts:614), and the owner cannot excuse days whose 48 hours have passed. | vac:80-81 | vacations.test.ts:1070, 1138 | design-gap (finding 3) |

### Waiting payment

| # | Event | Code | Doc | Test | Verdict |
|---|---|---|---|---|---|
| 1 | Occurrence opens, falls due, week closes | No interaction. | n/a | n/a | ok |
| 2 | Evidence submitted | No interaction. | n/a | n/a | ok |
| 3 | Second payment | Allowed up to the payable amount (money.ts:93). | v0:269-273 | payments.test.ts | ok |
| 4 | Other item approved | An excuse or vacation approved after a payment can leave the owner overpaid; owed is clamped at zero (money.ts:281). | Not stated | excuses.test.ts:577 | unspecified (finding 13) |
| 5 | Pact ends or is deleted | Payment is per recipient, not per pact; it stays decidable while the recipient reviews any pact of the owner. If no pact links them any more, `decidePayment` finds no decider and the item is stranded. | Not stated | None | suspected design-gap |
| 6 | Reviewer set changes | Deciders are reviewers of any pact with that recipient (money.ts:683). | v0 ledger section | payments.test.ts:302 | ok |
| 7 | Wednesday bill cut | A payment awaiting approval pauses the overdue spell: no owner reminders and no reviewer notices (money.ts:444-502). | v0:291-292 | bills.test.ts:422 | design-gap (finding 6) |
| 8 | Withdrawn | Not possible. | Not stated | None | unspecified |
| 9 | Reviewer never responds | Overdue paused forever. | v0:263 | None | design-gap (finding 6) |
| 10 | Reviewer decides late | Rejection restarts the overdue spell. | v0:291-292 | bills.test.ts:422 | ok |

### Owner-side states: an unanswered question, Take the L and alerts

| # | Event | Code | Doc | Test | Verdict |
|---|---|---|---|---|---|
| 1 | Occurrence opens, falls due, week closes | An item waiting on a reply leaves `reviewQueue` (review.ts:73-76). If it is evidence, the occurrence stays unjudged; if an excuse or vacation, penalties stay held. Rejection alerts (evidence.ts:366, 419; excuses.ts:465; vacations.ts:614) stay until acknowledged. | v0:264-265; v0:89 story 51 | reviewer-questions.test.ts:81, 99 | design-gap (finding 2) |
| 2 | Evidence submitted | The owner cannot submit new evidence while the questioned evidence waits (evidence.ts:322). | Implied | None | ok |
| 3 | Second question | Allowed; the item stays off the queue until the owner replies. | v0:264 | reviewer-questions.test.ts:345 | ok |
| 4 | Other item filed or approved | Approving an excuse over a questioned evidence day makes the day Excused but leaves the question open (P5a variant). | Not stated | None | design-gap (finding 8) |
| 5 | Pact ends or is deleted | Questions and alerts survive the end; the question for a vacation shows on Profile, not on Today (today.ts:81-99). | Not stated | None | unspecified |
| 6 | Reviewer set changes | A removed reviewer's question stays; the reply notifies current reviewers. | Not stated | None | unspecified |
| 7 | Wednesday bill cut | Take the L on a rejected Fixed day accepts a penalty that is then billable; a held penalty under a questioned excuse is not billed. | v0:89, v0:101 | rejection.test.ts | ok |
| 8 | Withdrawn | Owner cannot withdraw a question; vacations can be withdrawn with the question pending. | Not stated | None | unspecified |
| 9 | Owner never answers | The item never returns to any queue and nobody is reminded. This is unlimited deferral by the owner. | v0:263 | None | design-gap (finding 2) |
| 10 | Owner answers late | Item returns to the queue; reviewers are notified. | v0:265 | reviewer-questions.test.ts:99 | ok |

## Findings

### 1. Approving an end request drops the occurrence that is open

Verdict: bug (confirmed, P1).

Evidence: `decideChangeRequest` calls `endPact(now)` (change-requests.ts:713). `dueAfterEnd` (occurrence-state.ts:202-208) then skips any occurrence due after `ended_at`. P1: a Weekly count 3x pact with 0 sessions whose end was approved on the Saturday produced "PROBE1 weekly penalties: []" against a control week of one $15 penalty; a Fixed-days pact ended Thursday 23:00 with no photo produced penalties only for Mon, Tue and Wed. The spec says "Change requests never rescue an open occurrence; excuses do that" (v0:218). The other end paths agree with the spec: an end date ends the pact after the last occurrence closes (judging.ts:94-115) and an earlier end date set by a change keeps the open occurrence (change-requests.ts:455). The test at change-requests.test.ts:671-721 codifies the drop, and the copy "no more days" (v0:329) hides it.

Scenario: on Saturday of a week with no gym visits, the owner asks to end the pact and a friendly reviewer approves. The week's $15 vanishes.

Options:
- A. Set `ended_at` to the close of the open occurrence (or week), so it is judged as normal. Cost: small, one line plus updating the test at change-requests.test.ts:671 and the confirmation copy. Recommended.
- B. Keep the immediate end but judge the open occurrence at once as of `now`. Cost: medium; a Weekly count week judged early would count fewer chances, which is harsher than the spec.
- C. Keep the behaviour and change v0:218 and the copy to say an end rescues the open occurrence. Cost: copy only, but it makes ending a free excuse.

### 2. The owner can defer judging without limit, and no one is reminded

Verdict: design-gap.

Evidence: items never expire (v0:263); waiting evidence defers judging (judging.ts:135, 154); waiting excuses and vacations hold penalties (money.ts:85); an item waiting on a reply leaves the queue (review.ts:73-76); there is no notification kind for a stale queue or an unanswered question (NOTIFICATION_SETTINGS has none). A payment awaiting approval pauses overdue (finding 6).

Scenario: the owner submits any photo each day. The reviewer is busy for a month. Nothing is judged and nothing is billed. Or the reviewer asks a question about an excuse and the owner never answers: the penalties stay held forever and the item vanishes from every list but the owner's alert.

Options:
- A. A weekly digest to reviewers listing items older than N days, and a reminder to the owner of an unanswered question after N days. Cost: medium, one notification kind and a scheduled job. Recommended.
- B. Expiry: after N days an unanswered question or undecided item resolves against the party who is silent (unanswered question means rejection; undecided evidence means approval). Cost: medium to high, and a spec change to v0:263.
- C. Cap deferral: a held or deferred penalty becomes billable after N days regardless. Cost: medium, changes PENALTY_HELD and judging.

### 3. A waiting vacation silently consumes the 48 hour excuse window

Verdict: design-gap.

Evidence: covered Missed days are hidden from Today's recently missed (today.ts:419-465), get no missed push, and are refused for excuses as on-waiting-vacation (excuses.ts:267-271). After a late rejection or a withdrawal, the penalties are released at their original `added_at`, so the window has usually passed. Specified at vac:80-81 and tested at vacations.test.ts:1070.

Scenario: the owner files a vacation covering a week of sick days. The reviewer rejects it on day 5. Days 1 to 3 are past their excuse window; the owner can never ask for those to be excused one by one.

Options:
- A. On rejection or withdrawal, restart the excuse window for the released days (store a `released_at` and use it in the window check). Cost: small to medium. Recommended.
- B. Allow excuses to be filed for days on a waiting vacation (the vacation and the excuse then race). Cost: small, but confusing double cover.
- C. Leave it and say so in the vacation filing copy. Cost: copy only.

### 4. A Weekly count week judged Missed by a late evidence decision gets no missed push

Verdict: bug (confirmed, P2).

Evidence: `decideEvidence` judges the week late with `tell=false` (evidence.ts:245-252); the comment at judging.ts:145-147 assumes the decision push tells the owner. P2: the only push was "reviewer approved your evidence", "Piano · Sun Jan 18", while the week came out Missed with $10 added.

Scenario: the owner did 2 of 3 sessions; the reviewer approves the second photo late. The owner sees "approved" and never learns the week cost $10 until the bill.

Options:
- A. Pass `tell=true` when the late judgment produces Missed, so the normal missed push follows the decision push. Cost: one line and a test. Recommended.
- B. Change the decision push text to include the week's outcome. Cost: small, new copy.

### 5. Vacation deciders are frozen while other items follow the pact's reviewers

Verdict: design-gap (inconsistent with other items).

Evidence: `vacationToDecide` checks only `vacation_reviewer` (vacations.ts:525-539); evidence, excuses and change requests use the current reviewers (review.ts:177-217). Specified at vac:69.

Scenario: the only picked reviewer goes quiet. The owner adds a second reviewer, who cannot see the vacation. Withdrawing and refiling cannot cover days already open (vacations.ts:187), and by then those days may be past their excuse window.

Options:
- A. Let any current reviewer of a covered pact decide, in addition to the picked ones. Cost: small query change, spec change to vac:69. Recommended.
- B. Allow the owner to add reviewers to a waiting vacation. Cost: medium, new UI.
- C. Keep as is and rely on finding 2's reminder. Cost: none, but it leaves the stuck case.

### 6. A payment awaiting approval pauses Overdue indefinitely

Verdict: design-gap.

Evidence: `remindOverdue` pauses the spell while any payment awaits approval (money.ts:444-502). Specified at v0:291-292 and tested at bills.test.ts:422. Nothing expires the payment.

Scenario: the owner records a $1 payment against a $200 bill. If the recipient never decides it, the owner gets no overdue reminders and reviewers no weekly notices, forever.

Options:
- A. Pause only while the waiting amount covers what is overdue, or only for N days. Cost: small. Recommended.
- B. Remind the recipient of the waiting payment weekly (part of finding 2's digest). Cost: covered by finding 2.

### 7. A waiting excuse hides the To do card but the reminder still fires

Verdict: inconsistent (confirmed, P4).

Evidence: `stillToDo` treats a waiting excuse as not to do (occurrence-state.ts:88-91, used at today.ts:338), but `worthReminding` only skips approved cover (reminders.ts:125). P4: "to-do cards for Gym: 0 reminders: ["2026-01-08"]".

Scenario: the owner excuses today in the morning. In the evening a reminder says to do the gym, but Today shows nothing to do.

Options:
- A. Skip reminders for days under a waiting excuse or vacation, matching Today. Cost: one condition and a test. Recommended.
- B. Show the card on Today with an "excuse waiting" label and keep the reminder. Cost: small, client change.

### 8. Dead items stay in reviewers' queues

Verdict: design-gap (confirmed, P5a, P5b, P5c).

Evidence: P5a, evidence for a day an approved excuse already made Excused stays in the queue, and rejecting it still pushes "rejected your evidence". P5b, an excuse whose only day a change removed shows with `days: []` (excusesToReview at excuses.ts:402 does not filter) and stays on the owner's Waiting list (excuses.ts:429). P5c, evidence for the day open when an end was approved stays in the queue and its decision does nothing (evidence.ts:243). Vacations over ended pacts stay decidable (review.ts:212).

Options:
- A. Auto-resolve: when an item can no longer change anything, withdraw it with a note ("no longer needed"). Cost: medium, one sweep after each approval and end. Recommended.
- B. Filter such items out of queues and Waiting lists without changing their state. Cost: small, but leaves rows waiting.

### 9. An excuse or vacation row re-covers a day a change adds back

Verdict: bug, low severity (confirmed for excuses, P3; suspected for vacations).

Evidence: `excuseOn` and `vacationOn` read `excuse_day` and `vacation_day` rows without checking the schedule (occurrence-state.ts:67-109). P3: Wednesday removed by a change and added back by a later change came out "excused". vac:61 says "A day a change adds isn't covered".

Options:
- A. Delete `excuse_day` and `vacation_day` rows for days an approved change removes. Cost: small. Recommended.
- B. Compare the row's creation time with the change that added the day. Cost: medium.

### 10. Change requests withdrawn by the system are silent

Verdict: unspecified.

Evidence: `endPact` withdraws a waiting change request (judging.ts:234-243) when the end date passes or a One-time pact is judged; no one is told and the page reads "withdrawn" as if the owner did it. Tests at change-requests.test.ts:771 and 803 assert no push.

Options:
- A. Record a reason ("pact ended") and show it; no push. Cost: small. Recommended.
- B. Push the owner and reviewers. Cost: small, more noise.

### 11. Waiting vacations are missing from the pact page

Verdict: unspecified.

Evidence: the pact page's Waiting on list omits vacations (pacts.ts:255-261) and not-judged days hide vacation-waiting (occurrence-state.ts:180). Today omits them by design (vac:104); Profile shows them (vac:94).

Options:
- A. Add waiting vacations covering the pact to its Waiting on list and label future covered days. Cost: small. Recommended.
- B. Document that only Profile shows them. Cost: copy only.

### 12. Weekly count weeks are covered differently by excuses and vacations

Verdict: design-gap, minor.

Evidence: one excused day excuses the whole week (judging.ts:153), while a vacation covers a week only if its Thursday is inside (vac:58, reason stated). A Thu-Sun vacation excuses the whole week; a Fri-Wed vacation covers neither week. Tested at weekly-count.test.ts:339, 440.

Options:
- A. Keep the rule and show which weeks a vacation covers in the filing preview. Cost: small. Recommended.
- B. Cover a week only when the vacation covers enough days to make the target impossible. Cost: medium.

### 13. An excuse approved after the penalty was paid leaves an invisible credit

Verdict: unspecified.

Evidence: owed is clamped at zero (money.ts:281); the surplus is not shown. Tested at excuses.test.ts:577. An excuse cannot reach a billed penalty because of the 48 hour arithmetic, so this only arises when the owner pays before billing.

Options:
- A. Show a credit line on the ledger. Cost: small. Recommended.
- B. Refuse payments larger than billed amounts. Cost: small, but blocks prepaying.

## Could not determine

- Client copy and rendering, beyond the core functions that feed them.
- Oura and Anki edge cases beyond the excuse handling in bedtime.ts:193-207.
- Whether a payment can be stranded when no pact links owner and recipient any more (suspected, not probed).
- Behaviour on Node 24: the tests ran on Node 22 after `npm ci --engine-strict=false`.
