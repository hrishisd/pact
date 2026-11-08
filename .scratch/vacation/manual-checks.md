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

## After ticket 03

- [ ] **(human)** A rejection sends "Sam rejected your vacation" with the reason, and tapping it opens Today with the rejected-vacation alert.
