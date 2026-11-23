# Sheet drag to close

Current rules: `docs/behaviour.md`. This spec records the design as it was decided.

Status: ready-for-human

Settled with the owner on 2026-11-23. Every decision below was confirmed. Built in `useSheetMotion` (`src/client/sheet-motion.ts`), used by `Sheet` (`src/client/ui.tsx`). Checks only a phone can do are in `manual-checks.md`.

## Problem statement

Every bottom sheet (Profile, an excuse, Delete, End, Name, Add a reviewer, Reminders, Ask, the Request change steps, Record a payment) has a grey bar at its top that does nothing. On my iPhone I tried to drag a sheet down by it on instinct, as I would any iOS sheet, and nothing happened. I want to drag a sheet down to close it.

## Solution

Every sheet can be dragged down to close it. The sheet follows the finger; letting go far enough down, or with a quick flick, slides it away; otherwise it springs back. Every way a sheet closes slides it away the same way.

## User stories

1. As an owner, I want to drag a sheet down to close it, so that it behaves like the sheets in every other iPhone app.
2. As an owner, I want a sheet I let go of short of closing to spring back, so that a drag I didn't mean doesn't lose what I typed.
3. As an owner, I want a quick flick to close a sheet, so that I don't have to drag it a long way.
4. As an owner, I want to scroll a tall sheet as before, so that dragging to close doesn't get in the way of reading it.
5. As an owner, I want the buttons, links, switches and fields in a sheet to work as before.

## Decisions

### Where

- Every sheet, built once in `Sheet`. Reason: the owner tried the bar on instinct, and every sheet shows it.
- A drag can start anywhere on the sheet, not only on the bar. Reason: matches iOS's own sheets.
- Touch only: a mouse can't drag a sheet. Reason: same as pull to refresh; desktop closes with Cancel, a click outside or Escape.

### When a touch is a drag

- Only while the sheet's content is scrolled to its top when the finger goes down (and any scroller inside it the finger is on). Scrolled down, a drag down scrolls the content as usual and doesn't move the sheet. Reason: matches iOS's own sheets.
- A finger that first moves up is a scroll. One finger only: a second finger ends a drag, and the sheet springs back.
- The drag is claimed only once the finger has moved a few px down (`DRAG_CLAIM_PX`, 6), so taps on buttons, links, switches and fields still work. A finger that first moves sideways isn't a drag, so a sideways scroller (the pact page's history) keeps working if a sheet ever holds one. A drag that starts in the text field being typed in is left to the field (moving the caret or selection). Reason: the owner asked that the drag break no input in a sheet.

### While dragging

- The sheet follows the finger 1:1 downward.
- Dragged up past where it rests, it moves only a little, with resistance (`UP_RESISTANCE`, 0.15), at most 12 px (`UP_MAX_PX`). Reason: matches iOS's own sheets.
- Under Reduce Motion the sheet still follows the finger: the finger moves it, not an animation.

### Letting go

- It closes if it was let go more than a third of its height down (`CLOSE_SHARE`), or with a downward flick faster than 0.5 px per ms (`FLICK_PX_PER_MS`), measured over about the last 100 ms of movement (`FLICK_WINDOW_MS`), however short. Otherwise it springs back (`SPRING_MS`, 250 ms). A cancelled touch springs back. Reason: matches iOS's own sheets; the numbers are named constants to tune on a phone later.

### Closing

- However the sheet itself closes (a drag, Done or Cancel, a tap on the dimmed area, Escape), it slides down off screen while the dimming fades, over 0.2 s (`EXIT_MS`), and only then is told to close. A drag continues from where the finger let go. If the browser never reports the slide's end, it closes 0.1 s later anyway (`EXIT_FALLBACK_MS`). Reason: one way out for every close, matching iOS.
- It closes once: a tap, Escape or another drag during the slide does nothing more.
- Under Reduce Motion it closes at once.
- A sheet its screen takes away (after a successful send, or a button inside it such as Keep it or the Request change step's Done) still goes at once. Reason: the sheet isn't told before it goes; acceptable for now.
- A tap on the dimmed area still closes. Closing still throws away anything typed, with no confirmation. Reason: unchanged from before.
- The page behind stays held still (`holdPageStill`) until the sheet is gone, through the slide.
- The entry slide animates `translate` rather than `transform`, so it never overrides the transform a drag or the exit writes.

### Closing while saving

- A drag closes a sheet in exactly the cases a tap on the dimmed area does. Before this change, no sheet stopped a tap outside, Cancel or Escape while it was saving or sending: the sheet closed and the request carried on, its answer handled as usual by the screen behind (a reload, or going Back after a delete). A drag does the same.

## Out of scope

- Dimming that fades in step with the drag.
- Asking before throwing away typed text.
- Sliding away a sheet its screen takes away.

## Testing decisions

- Client: `sheet.test.tsx` fires touch events on a sheet, with fake time between them (a touch's timeStamp reads it) and a height given to the sheet, since jsdom lays nothing out. A slide ends with a fired transitionend (`endSheetSlides`, `src/client/testing/render.tsx`), or with fake time past `EXIT_FALLBACK_MS`. Reduce Motion is a stubbed `matchMedia`.
- The feel on a real iPhone, inside the installed app, is a manual check (`manual-checks.md`): the thresholds, and that the drag doesn't fight iOS's own bounce in the sheet.
