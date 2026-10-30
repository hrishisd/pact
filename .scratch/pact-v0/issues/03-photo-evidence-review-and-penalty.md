# 03 Photo evidence, review, judging and the penalty ledger

Status: ready-for-agent
Blocked by: 02

Spec stories: 28 (partly), 29–31, 33, 34 (in-app only), 52–56, 59–61 (in-app only), 68, 70, 80 (partly), 89 (evidence only).

## What to build

The owner proves a day with live photos on the Today card, a reviewer approves or rejects it, the day is judged, and a Missed day puts the penalty on the recipient's ledger.

### Evidence
- **Photo store adapter:** a private R2 bucket. The server serves a photo, or a short-lived link, only to the pact's owner or one of its reviewers. The store returns the time the server received each photo.
- **Shrink before upload:** the browser redraws each photo so its long edge is at most 1280px and saves it as JPEG at quality ~0.6 (about 100–180 KB). Size and quality are one setting that's easy to change. This makes uploads fast on cellular and strips metadata, including GPS location. Excuse photos (ticket 07) go through the same step.
- **Size cap:** the server refuses any photo over 1 MB. That's well above a shrunk photo and well below an iPhone original (3–5 MB), so it catches a resize that silently failed.
- **Submit inline on the Today card:** live camera capture only (no photo library), several photos per piece of evidence.
- Accepted only on the pact's scheduled days and only until the occurrence's due time (midnight). The core refuses anything else, so there's no backfilling.
- Submitting moves the card into **Waiting for approval** at the bottom of Today, with the green camera Evidence icon in a coloured square and the kind name in the small line.
- After a rejection the owner can resubmit while the occurrence is still open.

### Review
- **Review tab** with a count badge. One item at a time, with Reject (reason required), Approve, and Prev/Skip. Ask comes in ticket 12.
- An Evidence item shows only the photos and the pact's description of what counts.
- Any reviewer of the pact may decide; the first decision is final and removes the item from every reviewer's queue. Items never expire.
- The owner sees the decision in the app (push arrives with ticket 05; the core records the notification now).

### Judging (Fixed days, Camera)
- At the end of each scheduled day (advance to T): no evidence → Missed; approved evidence → Kept; evidence still waiting → the outcome waits for the decision.
- Rejected evidence makes the occurrence Missed as of the rejection, unless the occurrence is still open and new evidence is submitted.
- A rejected-evidence **alert** shows on Today until resolved.

### Ledger
- Each Missed occurrence adds a **penalty** equal to the pact's amount to the owner's ledger for that recipient. One ledger per recipient across all pacts that share it.
- **Ledgers tab:** one card per recipient with the big owed amount and lifetime paid ($0 for now). Tapping opens its history, pushed on the tab, with each penalty linked to its occurrence.

### Today
- **Missed** section (red): misses from the last 48 hours. File excuse and "I'll pay it" arrive in ticket 07.
- Done (Kept) cards don't appear.

## Acceptance criteria (core scenarios)

- [x] Mon/Wed/Fri $5 pact → Monday ends with no evidence → Missed, ledger shows $5 owed to the recipient.
- [x] Evidence submitted Monday, approved Tuesday → Kept, nothing owed.
- [x] Evidence submitted Monday, still waiting at midnight → not judged yet; rejected Tuesday → Missed as of the rejection, $5 owed.
- [x] Rejected Monday afternoon, resubmitted Monday evening, approved → Kept.
- [x] Evidence refused on a Tuesday for a Mon/Wed/Fri pact, and refused after midnight.
- [x] Two reviewers: the first to decide wins and the item leaves both queues; a second decision is refused.
- [x] Two pacts with the same recipient share one ledger.
- [x] A restart between submission and the day ending changes nothing.
- [x] Only the owner and the pact's reviewers can fetch a photo.

## Notes

- Capture time isn't used: shrinking before upload strips it, and the rules only use server-received time (ADR 0002).
- Once the camera flow works on a real iPhone, check that 1280px keeps small text (a treadmill display, a scale) readable, and that photos come out the right way up.

## Comments

### 2026-10-30: built, waiting on the phone check

What was done:
- **Photo store.** It has an R2 adapter, used in production (`src/core/photo-stores.ts`, over the S3 API with `aws4fetch`), and a local-disk adapter, used in development (`.dev-data.nosync/photos`).
- **Uploads and photo access.** One multipart upload carries each piece of evidence. Any photo over 1 MB gets a 400 `photo-too-large`. Only JPEG is accepted, and the core caps evidence at 10 photos. `GET /api/photos/:id` serves a photo to the pact's owner and its reviewers only, and answers 404 for anyone else (recorded in CODING_STANDARDS "Settled decisions").
- **Shrinking.** Photos are shrunk in the browser before upload: `PHOTO_SHRINK` in `src/client/photos.ts` sets a long edge of 1280px and JPEG quality 0.6.
- **Core rules.** `submitEvidence`, `reviewQueue`, `decide` (the first decision is final), judging in `advanceTo` (a per-pact cursor, catching up after downtime), penalties, `ledgers` and `ledger`.
- **Screens.** Today has the inline Take photo, the rejected-evidence alert, Missed (with who rejected it and why) and Waiting for approval. Review has its badge, Reject (reason required), Approve and Prev/Skip. Ledgers has its tab and a history page.
- **Migrations.** Migration 4 adds the tables. Migration 5 starts judging at the deploy date for pacts that already exist, so nothing before the deploy gets a penalty. Migration 6 drops a stale `occurrence.due_at`.
- **Tests.** Every acceptance criterion has a test in `judging.test.ts`, `evidence.test.ts`, `review.test.ts`, `ledgers.test.ts` and `app.test.ts`. Migration 5 has its own test in `migrations.test.ts`.
- **Browser check.** I checked it in the browser preview with dev sign-in, at phone width. Evidence was uploaded with curl, because the preview has no camera.

Left for the human:
- Create the private R2 bucket `pact-photos` with keys scoped to it, then set the Fly secrets `PHOTOS_BUCKET`, `PHOTOS_ENDPOINT`, `PHOTOS_ACCESS_KEY_ID` and `PHOTOS_SECRET_ACCESS_KEY` (stage 6 of `scripts/setup-operator.sh`).
- On a real iPhone, check:
  - that Take photo opens the camera and not the photo library
  - that several photos can be taken
  - that photos come out the right way up
  - that 1280px keeps small text readable (a treadmill display, a scale)
  - that uploads are quick on cellular

Status stays ready-for-agent until the phone check passes.
