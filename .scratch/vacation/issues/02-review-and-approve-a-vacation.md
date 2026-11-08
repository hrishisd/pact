# 02 Review a vacation: the review item, questions, approval and Excused days

Status: ready-for-agent
Blocked by: 01

Spec: `../spec.md` stories 11, 13, 14, 20, 22 to 24 and 26, the Reviewing, Judging and money ("Outcome", "Reminders and checks"), Notifications and Data sections, and Screens ("Review item, Vacation kind" and the Profile cards for waiting on your reply and approved ahead). The screens follow the prototype's section 2.

## What to build

The picked reviewers get the vacation as one review item, can approve it, reject it (the rejection's alert is ticket 03), or ask a question the owner answers from Profile. Once approved, the occurrences it covers are judged Excused at their due times with no reminders and no penalties. This ticket covers a vacation decided before its first day; ticket 03 covers one still waiting when its first day comes.

### Core
- **Coverage helpers.** Widen `excuseOn` and `excuseCoversSql` in `occurrence-state.ts` so an approved vacation's `vacation_day` covers an occurrence as an approved excuse does. Judging (`judgeAtDueTime`, `judgeWeek`, `judgeNights`), reminders (`worthReminding`), Anki checks and `skipReason` then treat it as excused with no change of their own. Keep the waiting case out of the widened helpers for now; ticket 03 adds it.
- **Review item kind "vacation"** in `review.ts` and `ReviewItem`: `reviewItems` lists a vacation to its picked reviewers only, oldest first after change requests, until it's decided or withdrawn; `itemToDecide` lets only picked reviewers decide or ask; `ownItem` gives the picked reviewers, for the reply push; `itemWhat` is "vacation"; it counts in the queue's length, so the Review badge shows it. The item carries what the screen shows: owner, dates, day count, note, pacts summary, picked reviewers' names, and per covered pact what it gives up.
- **Decide:** the first decision is final and the item leaves every picked reviewer's queue. Approving reuses `decideExcuse`'s per-day loop, pulled out so both call it, over the vacation's days on every pact. A reject records the reason (its effects on held penalties and the alert are ticket 03).
- **Questions and replies** through the existing `askOwner` and `ownerReply`. The question isn't a Today alert: Today's `questionAlerts` and Waiting for approval never list a vacation. The owner's vacations query returns the latest question for the Profile card.
- **Pushes:** on filing, "review-item" to each picked reviewer only ("Jordan asked for a vacation", "Dec 20 – Jan 2", opening Review). On a decision, "excuse-decided"-style push under the Decision setting ("Sam approved your vacation" with the dates, opening the Profile sheet; "Sam rejected your vacation" with the reason in quotes, opening Today). Questions and replies use "reviewer-question" and "owner-replied" (Comment setting). No push for a withdrawal.
- **App path** that opens Today with the Profile sheet up, for the pushes that open it.

### Client
- **Review tab:** the Vacation item with the suitcase icon and `k-vacation` colour, its card as the spec's Screens section describes, and Reject, Ask and Approve with the existing Decision component and question sheet. It lists under "Waiting on Jordan's reply" while it waits on the owner.
- **Profile cards:** "Waiting on your reply" with the question, Reply (text box, Cancel, "Send to Sam") and Withdraw; "Approved" with "Approved by Sam Rivera. It can't be changed now."
- **Excuse sheet:** a day an approved vacation covers is skipped as "Excused", as for an approved excuse.

## Acceptance criteria (core scenarios)

- [ ] Spec example: Jordan files a vacation on Wed for Mon+1 to Sun+1 on a Mon/Wed/Fri $5 pact, sent to Sam; Sam approves on Thu; Mon+1, Wed+1 and Fri+1 are judged Excused at their due times, no reminder fires on them, no penalty is added, and owed stays $0.
- [ ] Two reviewers picked of three possible: only the two get the "review-item" push and see the item; the third never sees it and gets no push; either picked reviewer can decide, and the second decision is refused.
- [ ] A reviewer who reviews one of the covered pacts but wasn't picked can't decide or ask about it ("item-not-found").
- [ ] Sam asks a question: the item leaves both picked reviewers' queues, the owner gets one "reviewer-question" push, and Today has no alert for it; the owner replies, both picked reviewers get "owner-replied", and it's back in both queues. Alex can approve it while it waits on the reply.
- [ ] Approved: the owner gets one Decision push; with the Decision setting off, none.
- [ ] A covered Weekly count week is judged Excused at the end of its Sunday; an uncovered partial week keeps its full target and is judged as usual.
- [ ] A covered One-time deadline is judged Excused at the deadline and the pact Ends.
- [ ] A covered bedtime night with no Oura data is Excused when it closes; one with an on-time bedtime is Satisfied, as with an approved excuse.
- [ ] Pact doesn't check AnkiWeb for an Anki day the approved vacation covers.
- [ ] An excuse filed for a day the approved vacation covers skips it as "Excused".
- [ ] Withdraw after approval is refused, and an approved vacation can't be decided again.
- [ ] Bills: a penalty from an uncovered pact during the vacation still goes on the Wednesday bill, and an Overdue spell's reminders keep running through it.
- [ ] Routes for the vacation item in the Review Queue, deciding and asking (`src/server/app.test.ts`).

## Acceptance criteria (screens)

- [ ] Checked in the browser at 390×844, with screenshots next to the prototype's: the reviewer's Review tab with the Vacation item and badge, the Ask sheet, "Waiting on Jordan's reply", the reject form, the owner's Profile card waiting on a reply with the Reply box open, and the Approved card.

## Manual checks

In `../manual-checks.md`: the new-review-item, decision, question and reply pushes on a real phone, each opening the right screen.

## Comments
