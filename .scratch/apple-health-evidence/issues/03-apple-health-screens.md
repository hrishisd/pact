# 03 Apple Health: screens

Status: done
Blocked by: 02

Spec: `../spec.md` stories 1, 2, 3, 5, 7, 8 and the Screens and Shortcut sections. The human skipped a prototype; screenshots go in the PR and they'll give feedback on the built screens.

## What to build

- The Apple Health tile in Create pact, and the setup step when there's no connection.
- The Apple Health setup page (its own app path): make key / upload URL with Copy, the Shortcut steps exactly as in the spec, the automations, Run Pact Health, last upload with its sleep and mindful counts.
- Profile's Apple Health connection row.
- Today's Automatic and No Apple Health data cards, with Sync now.
- The night's source where a bedtime is shown.
- Copy uses glossary words; style matches the existing screens (`src/client/styles.css`).

## Acceptance criteria

- [x] Client tests for the tile, the setup page and the Sync now card.
- [x] `npm run check` and `npm run test:e2e` pass.
- [x] Screenshots of each screen at phone width.

## Comments

### 2026-11-26, agent

Built; Status left as it was for the human to move. Screenshots (390 px wide, 2x) are in `../screenshots/`: 01 the Source tiles, 01b the create form's Set up Apple Health step, 02–04 the setup page before a key, just after one (a dev key) and with a last upload, 05 and 05b Profile's row and its Disconnect warning, 06 Today's No Apple Health data card with Sync now, 07 Today with yesterday's night Satisfied "In bed at 11:52pm · Oura.", 08 the pact's page with that night tapped. Data: a "Bed by 12:30am" pact, every night, $10 to Sam, reviewed by Anish, and an upload of Oura-sourced stages plus two Calm sessions.

Decisions:
- The create form's Set up step is the setup page itself (`AppleHealthSetup`, `src/client/apple-health.tsx`), not a trip to another page and back: no navigation state to carry. Next says "Set up Apple Health first." until a key is made. The step stays in the form once shown (the connection is read as the form opened), so Back still shows the upload URL, which Pact can't show again. Making the key reloads the profile, so the next form skips the step. A line under it says the Shortcut can be finished later from Profile.
- The setup page is a pushed page (`apple-health` in `navigation.ts`, on Today's tab, so a fresh load of `/apple-health` opens it). Sections: Upload URL, Build the Shortcut (the spec's 8 steps word for word, as `ol.gsteps`, step 3's two actions as a sub-list), Run it automatically, Check it works (last upload, Run Pact Health). The page loads the last upload again on `focus` and `visibilitychange`.
- Upload key copy: "Make upload key" with no key; after it, the URL in the info alert with Copy ("Copy it now: Pact shows it only once… anyone with it can send sleep to your account"); opened again, "Make a new key" asks first ("Your old upload URL stops working at once").
- Last upload: "Last upload 9:02am · 14 sleep samples, 2 mindful sessions", with "Wed Nov 25, " before the time when it wasn't today, singular for 1.
- Profile: Apple Health shows only once connected, like Oura and AnkiWeb (a disconnected owner gets the alert on Today and the pact page, whose Set up Apple Health opens the page). Its button says "Set up" (primary) until the first upload, then "Make a new key"; both open the page. Disconnect warns "…until you set it up again. Your upload URL stops working."
- Today: Today checks Oura only when an Oura night's card shows. The Apple Health card says "Thu night hasn't synced yet. Sync now runs Pact Health on your iPhone to send it." with Sync now (`RUN_PACT_HEALTH_URL`, `src/shared/api.ts`) beside File excuse; without a key, "Set up Apple Health to count it." and no Sync now. Today loads again when Pact comes back to the front while such a card shows. A pull still checks Oura whatever shows, as before. The Automatic card needed no change.
- Wording per bedtime kind lives in `BEDTIME_TEXT` (`src/client/bedtime-text.ts`): the No data chip, the pact page's "judged from Apple Health", and the Goal, Schedule, Reminders and Reviewers hints. `presentOccurrence`'s `bedtime` option is now the bedtime kind. The night's source shows as "in bed at 1:59am · Oura" on Today's Missed card, Yesterday and the heat map's detail.
- The notification setting's hint now says "last night's sleep data" instead of "Oura data".
- `.gsteps li` became `.gsteps > li`, so a list inside a step isn't numbered.

Not done: the Copy button's "Copied" can't be seen in the headless screenshots (no clipboard permission), and nothing was tried on a real iPhone (the Shortcut and `shortcuts://` are for `manual-checks.md`). The setup page's Shortcut steps are text only; an iCloud link to a built Shortcut is out of scope.


### 2026-11-26, agent (review)

Reviewed the screens commit for rules in the client, glossary words, Oura copy on Apple Health pacts, Today's checks, buttons and links, and the `shortcuts://` links.
- Changed: Today's No-data card decided which connection a night depends on by mapping its evidence kind to a connection alert. The core now puts `connectionProblem` on `TodayNoSleepDataCard`, and the card reads it. No copy or look changes.
- Changed: `TodayAutomaticCard.evidenceKind` was sent but never read (the Automatic card is worded alike for both kinds), so it's gone.
- Checked, no change: Today checks Oura on its own only while an Oura night's card shows; a pull still checks Oura whatever shows, as before this feature (the core asks Oura only about Oura nights). No bedtime copy says Oura or the ring for an Apple Health pact. Run Pact Health and Sync now are links (they open a URL); Profile's Set up / Make a new key are buttons that push the page, as Set up notifications does. Both `shortcuts://` links use `RUN_PACT_HEALTH_URL`, which matches the spec. They do nothing off an iPhone, which the spec accepts.
- Left for the human: the disconnected alert's Set up Apple Health is a plain link to `/apple-health`, so it reloads the app instead of pushing the page; and Profile's "Make a new key" opens the page instead of making a key.
