# Manual checks: Vacation

Things that need a real phone and real push notifications. Steps marked **(human)** need the human's hands. Tick items off here; when one turns up a bug, file it under `issues/` and link it.

## After ticket 01

- [ ] **(human)** On the iPhone home-screen app, the First day and Last day fields open the native calendar picker, and the footer bar stays above the tab bar while the Pacts step scrolls.
- [ ] **(human)** On the iPhone, after Ask for approval lands on Today with the Profile sheet up, closing the sheet and swiping back doesn't reopen the finished Vacation flow.

## After ticket 02

- [ ] **(human)** File a vacation picking one of two possible reviewers. Only the picked reviewer's phone gets "Jordan asked for a vacation" with the dates, and tapping it opens Review with the Vacation item.
- [ ] **(human)** The reviewer asks a question. The owner's phone gets "Sam asked about your vacation", and tapping it opens Today with the Profile sheet up, showing the question on the vacation's card. Today itself shows no alert for it.
- [ ] **(human)** The owner replies. The picked reviewer's phone gets "Jordan replied about their vacation", and it's back in their queue.
- [ ] **(human)** The reviewer approves. The owner's phone gets "Sam approved your vacation", which opens the Profile sheet with the Approved card.
- [ ] **(human)** With Decision turned off on the owner's Notifications page, an approval sends nothing. Turn it back on afterwards.
- [ ] **(human)** No push arrives when the vacation starts or ends.
- [ ] **(human)** On the phone, with the app already open on another tab, tapping the question push still lands on Today with the Profile sheet up. Reply from the card with the keyboard open: Cancel and "Send to Sam" stay reachable above the keyboard.

## After ticket 03

- [ ] **(human)** A rejection sends "Sam rejected your vacation" with the reason, and tapping it opens Today with the rejected-vacation alert.
- [x] With a vacation still waiting after its first day, the day's reminder push still arrives, and no Missed push arrives when that day is judged Missed. Covered by an automated scenario instead of a phone check, with the push API assumed to work: "through its whole week, each day's reminder push goes out and no Missed push does" in `src/core/vacations.test.ts`. Its fake notifier replaces only `Notifier.deliver`.

## After ticket 04

- [ ] **(human)** On the iPhone home-screen app, the heat map's vacation square shows its grey hatching (not a flat grey), and it's easy to tell apart from an Excused square in sunlight.
- [ ] **(human)** During an approved vacation, no reminder push arrives for a covered pact, and the first morning after the last day the app opens on Today with no banner and no Yesterday row for the covered pacts.
- [ ] **(human)** On the phone, See what's excused opens and Hide closes the banner's list without the page jumping, with a long note and three or more covered pacts.
