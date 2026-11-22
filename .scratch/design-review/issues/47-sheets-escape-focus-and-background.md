# Sheets: Escape closes every stacked sheet, and focus and screen readers reach what's behind

Status: needs-triage
Blocked by: none

From an outside audit of the code (finding F13, part a), checked in the real app in Chromium on 2026-11-22. Part b (buttons inside the Today card's link) is fixed.

## In plain words

Pact's sheets (Profile, File excuse, Add a reviewer, Record a payment and others) say to assistive technology that they are modal, but they don't act like it. With a keyboard, Escape closes every open sheet at once, not just the top one, and Tab walks out of the sheet onto the buttons behind it. A screen reader isn't moved into a sheet when it opens, so its user may not know it opened. For the people using Pact today, on iPhones by touch, nothing of this shows: it needs a hardware keyboard or a screen reader.

## Evidence

- Each `Sheet` (`src/client/ui.tsx`) adds its own `window` keydown listener for Escape, and nothing knows which sheet is on top. Every sheet is a `createPortal` to `document.body` with `role="dialog" aria-modal="true"`. Nothing moves focus in, keeps it in, or makes the rest inert.
- Sheets do stack, through `onInvite` → Shell's `openProfile`: Pact page → Terms → Add (reviewer) → `AddReviewerSheet` with no other friends → "Invite a friend" opens Profile over it; and Request change → Reviewers step (`ChangePact.tsx`) → "Invite a friend" (`ReviewersStep`).
- Seen in the browser with Profile over Add a reviewer: one Escape left no dialog open; a tap on the scrim closed only Profile. Escape and a tap disagree.
- Opening Profile left focus on the avatar button behind it; opening File excuse left it on the card's File excuse button. Of 40 Tab presses with Profile open, 24 landed outside the dialog (the Today cards, the tab bar). `#root` is not inert. Chromium's accessibility tree with Profile open still exposed every background heading, button and link. VoiceOver couldn't be tried in the container.
- Existing tests rely on today's focus: `Today.test.tsx`, "Escape closes the excuse sheet opened from an Anki card, focus still on File excuse".
- `aria-modal="true"` promises what the behaviour doesn't deliver: WCAG 2.4.3 Focus Order, and 2.4.11 Focus Not Obscured (focus can sit on controls under the scrim).

## What to build

A module-level stack of open sheets, about 25 to 35 lines (not the audit's 5):

1. Only the top sheet handles Escape.
2. While any sheet is open, `#root` and every sheet but the top are `inert` (sheets are portals outside `#root`, so inerting `#root` alone leaves a lower sheet reachable). `inert` is in iOS Safari 15.5+.
3. On open, focus moves into the sheet (its container with `tabIndex={-1}`, or its first control).
4. On close, focus goes back to the element that had it, which keeps the "focus still on File excuse" behaviour the tests encode.

Native `<dialog>` with `showModal` would do much of this, but jsdom implements neither it nor `inert`, so the component tests would need polyfills. Watch the sheets that close by navigating away (Plan a vacation, Notifications) and ExcuseSheet's `onFiled`, which closes and reloads.

## Acceptance criteria

- [ ] With two sheets open, one Escape closes only the top one.
- [ ] Opening a sheet moves focus inside it; closing returns focus to what opened it.
- [ ] While a sheet is open, `#root` is inert, and so is a lower sheet when two are open.
- [ ] The existing Today Escape tests still pass.
- [ ] A before/after keyboard walkthrough of a stacked pair (Add a reviewer, then Profile).
