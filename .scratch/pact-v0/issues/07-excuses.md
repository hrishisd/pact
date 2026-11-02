# 07 Excuses, penalty holds and Take the L on Missed cards

Status: done
Blocked by: 03

Spec stories: 42–44, 46–49, 51, 89 (excuses; 45 is dropped). Rules: Excuses. Screens: Today, File excuse, Excuse review item, Pact page, Occurrence labels, Changes since the prototype.

Settled with the prototype `.scratch/pact-v0/prototype/excuses.prototype.html` (option A). It's the reference for layout and copy; open it in a browser and click through. Where this ticket or the spec says more, they win.

## What to build

The owner asks a reviewer to treat one or more occurrences of **one pact** as Excused, ahead of time, on the day, or after the fact.

**Core**
- **File excuse** command: pact, dates (from, to), reason, photos (0–3, camera or library). It covers the pact's scheduled days in the dates that can be excused now, fixed at filing. Days that can't be excused are skipped, with a reason the UI can show: Kept, already Excused, already on an excuse waiting for approval, Missed more than 48 hours ago. Refused only when no day is left, the reason is blank, the dates are reversed, or they span more than 62 days. A preview query returns the same covered and skipped days without filing, for the sheet's live list.
- **When a day can be excused:** any day not judged yet (including future days and today); a day judged Missed, or whose evidence was rejected, only within 48 hours of that.
- **Holds:** while an excuse is waiting, the penalties of its covered Missed days are held. They don't count toward owed or go on a bill, and the ledger history shows them as "Held while an excuse waits for approval". A covered day still waiting at its due time is judged as usual; if it's Missed, its penalty starts out held.
- **Approve:** covered Missed days become Excused and their penalties are removed (they leave the ledger history). Covered days not judged yet are judged Excused at their due time, with no penalty. All or nothing.
- **Reject (reason required):** held penalties become owed (and go on the next Wednesday bill once their 48 hours are up); covered days not judged yet are judged as usual. Raises a **rejected-excuse alert**. The owner may file a new excuse for the same days inside each day's original 48 hours; the window never restarts.
- **Who decides:** any reviewer of the pact; the first decision wins. Notifications: reviewers get "new item to review"; the owner gets the decision.
- **Take the L** (existing accept-miss command) also works on a Missed card, and on the rejected-excuse alert. It only takes the card or alert off Today; the ledger doesn't change, and an excuse can still be filed from the pact page until the 48 hours are up.
- Filing an excuse for a day resolves that day's rejected-evidence alert, and any rejected-excuse alert that covers it.
- No withdrawing an excuse in v0.
- Pending excuses and their holds survive a restart (they're in the database, like everything else).

**Screens** (copy as in the prototype and the spec's File excuse bullet)
- **File excuse sheet**, option A. From a day: titled "Excuse Gym, Mon Nov 2", the day as a card (chip, "$5 held while Sam decides" / "Due at midnight" / "Not open yet", time left to file in orange), and "+ Later days too, e.g. still sick", which adds an "Also excuse Gym through" date and lists those days. From the pact page: "Excuse Gym", "Which day?" with one radio row per recent day that can still be excused plus "Days ahead" (From/To dates, starting today). Ranges list Covered and Skipped days, or "No Gym day on Tue Nov 3. It's Mon, Wed, Fri." Then Reason (placeholder "e.g. Sick with the flu", no helper text), Photos (optional, + tile, no helper text), and a footer "Covers 3 days. $5 is held off what you owe until it's decided." over **Send to Sam**. Dates use `<input type="date">` so iPhones show the native calendar; style it to match `.inp` and keep its height when empty.
- **Today:**
  - Missed card: "File excuse · 31h left" and **Take the L**. A miss with an excuse waiting leaves the Missed section.
  - To do card: a File excuse button beside Take photo, opening the sheet on today. An excuse waiting for today takes the card out of To do.
  - Rejected-evidence alert (from ticket 03): "File excuse · 40h left" beside Take the L, the 48 hours counted from the rejection.
  - Rejected-excuse alert: "Sam rejected your excuse for Gym", the reason in quotes, "Mon Nov 2 · $5 is owed again" (or "days not judged yet are judged as usual"), "File another excuse · 31h left" while any day is still in its window, and **Take the L**.
  - Waiting for approval: each waiting excuse as a row with the slate calendar-with-X icon, the pact's name, and "Excuse · Mon Nov 2" (or first – last date). It opens the excuse page.
- **Excuse page** (pushed): Excuse badge, a status chip (Waiting for approval, Approved by Sam, Rejected by Sam), the dates, reason, photos, the covered days with their chips, and "Sent to Sam · Tue Nov 3, 5:00pm".
- **Review item, Excuse kind:** the dates as title, Reason, photos, Covers (each day with a Missed chip and "$5 held", or "Not open yet"), "Approving makes all 3 days Excused and removes $5 in held penalties. Days not judged yet are Excused when they end." Reject uses the existing Decision component, with "Rejecting makes $5 owed again and leaves the days not judged yet to be judged as usual."
- **Pact page:** File excuse button, and a "Waiting on" list holding the pact's waiting evidence and excuses.
- **Occurrence labels:** "Missed · excuse waiting for approval"; "Excuse waiting for approval" for a day not judged yet; "Excused" for a day ahead whose excuse is approved. The UI never says "pending".
- **Ledger history:** held penalties read "Held while an excuse waits for approval", amount grey with no "+", and don't count toward owed.

## Acceptance criteria (core scenarios)

- [x] Spec example: Mon/Wed/Fri $5 gym pact → Monday Missed, $5 owed → excuse within 48h → held, owed $0 → reviewer approves → Excused, owed $0, no penalty in history.
- [x] Same, but rejected → owed $5 again, and a rejected-excuse alert is raised.
- [x] After that rejection, a new excuse for Monday inside the original 48 hours is accepted; one after the 48 hours is refused.
- [x] Excuse filed 49 hours after a miss is refused; one filed 47 hours after is accepted.
- [x] Excuse for next Fri–Sun filed Wednesday, approved Thursday → those days are Excused when they end, with no penalty.
- [x] Excuse covering today, still waiting at midnight → today is Missed with its penalty held; approval then makes it Excused.
- [x] A date range including a Kept day and a day Missed 3 days ago covers only the excusable days, and reports the others as skipped with their reasons; a range with no excusable day is refused.
- [x] A day already on a waiting excuse can't go on a second one.
- [x] Rejected evidence on Monday → excuse filed within 48h of the rejection is accepted, and resolves the rejected-evidence alert.
- [x] Take the L removes the Missed card from Today, leaves owed unchanged, and an excuse is still accepted afterwards inside the window.
- [x] The rejected-evidence alert shows "File excuse" with the time left counted from the rejection; after Take the L on the alert, an excuse is still accepted within 48 hours of the rejection.
- [x] A held penalty never goes on a Wednesday bill; once released by a rejection it goes on the next bill after its 48 hours. (Bills aren't built yet. What's tested now: a held penalty isn't owed or payable, and a rejection makes it both. The bill ticket must leave held penalties off bills.)
- [x] Either reviewer of a two-reviewer pact can decide; the second decision is refused.
- [x] A pending excuse survives a restart with its holds intact.
- [x] Screens checked in the browser against the prototype (Missed card → sheet → Waiting → reviewer approve and reject → alert), with screenshots.

## Out of this ticket

Weekly count whole-week excuses (14). Oura nights (08/09) reuse this as-is. Withdrawing an excuse. One excuse across several pacts (story 45, dropped).

## Comments

**Prototype, round 1.** `.scratch/pact-v0/prototype/excuses.prototype.html` compares three filing forms (A one sheet, B pick days, C steps) and has switches for the behaviours this ticket leaves open: what Today shows when an excuse covers today, an alert for a rejected excuse, re-filing after a rejection, one review item vs one per reviewer set, withdrawing, and where File excuse on a pact page starts. Waiting on the human's picks before the spec and this ticket are updated.

**Prototype, round 2.** Feedback on round 1: an excuse should target one pact or one occurrence, and the all-pacts picker with Yesterday / Today / Tomorrow shortcuts offered days the pact may not have. Round 2 opens every File excuse for its own pact and compares three ways to pick its days: A (the day you came from, shown as a card, optionally run on to later days; from the pact page, one recent day or a range ahead), B (tap the pact's real days as tiles, a week back and four ahead) and C (From/To dates starting on that day, listing the pact's days in range). A new switch covers story 45 (one excuse for several pacts): add other pacts in the sheet, offer them after sending, or one pact per excuse.

**Prototype, round 3.** The human dropped other pacts from the excuse sheet: an excuse covers one pact, so story 45 (one excuse across several pacts) and the one-item-vs-split question go away. The reason box loses its helper text and its example becomes "e.g. Sick with the flu"; the photo field loses its helper text.

**Prototype, round 4.** Decided by the human: when an excuse covers today, today's card leaves To do and the excuse shows under Waiting for approval; a rejected excuse raises an alert on Today with Take the L; no withdrawing an excuse in v0. "Excused when it ends, if approved" is dropped from the owner's copy. The sheet gets a prototype-only A/B/C switch so the filing forms can be compared on a phone. Still open: which filing form, and whether a day can be excused again after its excuse is rejected.

**Settled (round 4 follow-up).** Option A chosen. A day can be excused again after its excuse is rejected, inside its original 48 hours. iPhone dates use the native picker from `<input type="date">`. The spec and this ticket are updated with every decision; ready to build.

**Built.** Core (`fileExcuse`, `excusePreview`, `excuseOptions`, `excuse`, `acceptExcuseRejection`, excuses in `decide`, judging and Today), with scenarios in `src/core/excuses.test.ts` and routes in `src/server/app.ts`. Screens: `ExcuseSheet.tsx`, `ExcusePage.tsx`, and excuse parts of Today, the pact page, Review and the ledger. Clicked through locally: Missed card, sheet, Waiting, the reviewer approves; then a reject, the alert, File another excuse; the pact page's Which day? and Days ahead. Where it differs from the prototype, decided while building:
- The excuse page and the Excuse review item are titled with the pact's name, with the dates beside or under it. The prototype titled them with the dates only.
- The review item's day rows use the short chip (Missed) with "$5 held" under the date.
- Times left read "31h left" ("45m left" under an hour), as in the spec.
- Filing is refused in a pact's edit window ("edit-window-open"); the pact page offers File excuse only after it, as the spec's Pact page bullet says.
- A day covered by a waiting excuse that's judged Missed at its due time sends no Missed push.
- Evidence rejected on a day ahead with an approved excuse leaves the day for judging at its due time, which makes it Excused.

