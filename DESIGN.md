# Pact design system

Source of truth for how Pact looks, moves and talks. Read this before any UI change. Live reference with previews of every component in both themes: https://claude.ai/artifact/TVzH9d27mqBcSWZSd3KAQY

Pact is a mobile-only app: an iPhone home-screen web app, portrait, standalone. There is no desktop design, and every decision here assumes a phone in one hand.

Pact follows Apple's [Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines) for iOS, so it feels like an app that belongs on the phone. Where the HIG and the seven rules below disagree, the rules win, and "Following Apple's HIG" lists each such case with its reason.

Pact is a signed agreement, witnessed by a friend, with money at stake. The visual language is ledger paper, iron ink and a notary's seal. Ink does the talking; color appears only to report where something stands.

This branch is design work only. Do not change domain rules in `src/core`, server behaviour, or wire types. If a design change seems to need one, stop and ask. Follow the prototype-first rule in `docs/agents/` for user-facing changes, and keep `npm run check` green.

## The seven rules

1. **The seal has to be witnessed.** `--seal` appears only when two people complete an agreement: the edit window closes (Witnessed), a reviewer approves a change request (Amended), an approved payment brings a ledger to $0 (Paid up), a pact Ends with no Missed occurrences (Met in full). At most one per screen. Never on buttons, tabs, links or decoration. Not for an approved photo, a Satisfied day, an approved excuse or a stricter change.
2. **Red means money, not shame.** `--owed` only on a Missed mark, an owed amount, and Overdue. No red buttons, no red screens, nothing red on a person. A penalty that is held (an excuse or vacation covering it is waiting) is `--waiting`. A penalty written in the terms is `--ink`: nothing is owed yet.
3. **Excused is not Missed.** Excused and vacation use the dashed `--excused` ring or hatch, show their reason the first time they appear on a screen, and carry no amount.
4. **Quiet when nobody is waiting.** Banners only for: an Overdue bill, a reviewer's question waiting on the owner, a system failure. Show one at a time, in that priority. No on-track banner, no praise, no streaks.
5. **Looser takes two.** Stricter changes apply at once with a one-line confirmation ("Penalty raised to $30. Applies from Thu Nov 26."). Any looser change is a change request card. After the edit window, the edit form never offers a looser change as a plain edit; it says who must approve before the owner commits.
6. **Evidence first, person second.** In review, the photo leads, full width. Who sent it is meta. Approve and Reject are an equal-width pair at the bottom, in thumb reach.
7. **Ink does the talking.** Primary buttons, links (underlined), focus rings and the Review Queue badge are all `--ink`. If a color is on screen, it is reporting a state.

## Following Apple's HIG

Build every screen from the parts iOS people already know, and make them behave the way iOS does.

**Adopt**
- Structure: a floating tab bar for the four root screens, a navigation bar with a Large Title on root screens and an inline title with a labelled back button on pushed ones, sheets with detents for short flows, inset grouped lists for settings and terms. See "Mobile only".
- Type: the system fonts (SF Pro, New York, SF Mono) on Apple's Dynamic Type ramp, so text follows the phone's text-size setting. See "Type".
- Touch: 44pt minimum targets, safe areas on every edge, the primary action in thumb reach.
- Materials: floating chrome (the tab bar, a scrolled navigation bar) is translucent `--material` with a blur, so content shows through it as it does in iOS. Content itself stays opaque.
- Motion: spring curves for sheets, pushes and the tab bar's selection. See "Motion".
- Accessibility settings: Reduce Motion, Reduce Transparency and Increase Contrast each change what Pact draws. See "Accessibility".

**Where Pact deviates, on purpose**

| The HIG says | Pact does | Why |
|---|---|---|
| Destructive actions use the red destructive role | A Secondary button, then a confirm sheet stating what is lost, in ink | Rule 2: red means money, never an action |
| Tab bar badges are red | The Review Queue badge is ink | Rule 7: a badge reports a count, not a problem |
| Switches are green when on | Switches are ink when on | Green means Satisfied; a setting is not an outcome |
| Use SF Symbols | Lucide, drawn at SF Symbols' weight (stroke 1.75, 24px in bars and rows, 20px inline) | SF Symbols' license limits them to apps on Apple platforms; Pact runs in Safari |
| Pair important moments with haptics | No haptics | The web can't trigger them on iPhone |

## Tokens

Replace the `:root` block at the top of `src/client/styles.css` with this. Theme follows the system setting; `data-theme` on `<html>` can force one. Also set `<meta name="theme-color">` per theme (#F1F4F0 and #101412) in `index.html`.

```css
:root,
:root[data-theme="light"] {
  color-scheme: light;
  --background:       #F1F4F0;
  --surface:          #FCFDFB;
  --surface-sunken:   #E5EAE5;
  --surface-selected: #D9E0DA;
  --rule:             #D2DAD4;
  --rule-strong:      #808C84;
  --ink:              #17221D;
  --ink-muted:        #56645C;
  --ink-faint:        #626F67;
  --on-ink:           #FCFDFB;
  --satisfied:        #2B7347;
  --satisfied-soft:   #DCEEE2;
  --owed:             #AD3227;
  --owed-soft:        #F6DFDA;
  --waiting:          #8A5300;
  --waiting-soft:     #F8EACB;
  --excused:          #5E6670;
  --excused-soft:     #E3E6EA;
  --seal:             #5A3E8E;
  --seal-soft:        #EAE4F4;
  --error:            #8E2F57;
  --error-soft:       #F4DEE7;
  --scrim:            rgba(14, 22, 18, 0.45);
  --material:         rgba(252, 253, 251, 0.72);
  --shadow-float:     0 8px 24px rgba(14, 22, 18, 0.12);
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --background:       #101412;
  --surface:          #181D1A;
  --surface-sunken:   #0B0E0C;
  --surface-selected: #232A26;
  --rule:             #2A322D;
  --rule-strong:      #64706A;
  --ink:              #E8EEE9;
  --ink-muted:        #A7B3AB;
  --ink-faint:        #86928A;
  --on-ink:           #101412;
  --satisfied:        #7CC497;
  --satisfied-soft:   #183324;
  --owed:             #F08A78;
  --owed-soft:        #3B1D18;
  --waiting:          #E0B062;
  --waiting-soft:     #352812;
  --excused:          #9AA2AC;
  --excused-soft:     #22262B;
  --seal:             #B9A2E8;
  --seal-soft:        #28203A;
  --error:            #E88AAE;
  --error-soft:       #3A1C29;
  --scrim:            rgba(0, 0, 0, 0.6);
  --material:         rgba(24, 29, 26, 0.72);
  --shadow-float:     0 8px 24px rgba(0, 0, 0, 0.4);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --background:       #101412;
    --surface:          #181D1A;
    --surface-sunken:   #0B0E0C;
    --surface-selected: #232A26;
    --rule:             #2A322D;
    --rule-strong:      #64706A;
    --ink:              #E8EEE9;
    --ink-muted:        #A7B3AB;
    --ink-faint:        #86928A;
    --on-ink:           #101412;
    --satisfied:        #7CC497;
    --satisfied-soft:   #183324;
    --owed:             #F08A78;
    --owed-soft:        #3B1D18;
    --waiting:          #E0B062;
    --waiting-soft:     #352812;
    --excused:          #9AA2AC;
    --excused-soft:     #22262B;
    --seal:             #B9A2E8;
    --seal-soft:        #28203A;
    --error:            #E88AAE;
    --error-soft:       #3A1C29;
    --scrim:            rgba(0, 0, 0, 0.6);
    --material:         rgba(24, 29, 26, 0.72);
    --shadow-float:     0 8px 24px rgba(0, 0, 0, 0.4);
  }
}

:root {
  --font-serif: ui-serif, "New York", Georgia, "Times New Roman", serif;
  --font-sans: system-ui, -apple-system, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;
  --radius-cell: 3px;
  --radius-control: 10px;
  --radius-card: 16px;
  --radius-sheet: 24px;
  --radius-pill: 999px;
  --tap-target: 44px;
  --button-height: 48px;
  --mark: 20px;
  --cell: 14px;
  --thumb: 56px;
  --content-max: 440px;
  --duration-check: 180ms;
  --duration-stamp: 240ms;
  --duration-sheet: 280ms;
  --duration-fade: 120ms;
  --duration-push: 350ms;
  --duration-select: 250ms;
  --ease-spring: cubic-bezier(0.32, 0.72, 0, 1);
  --material-blur: blur(20px) saturate(180%);
  --tabbar-height: 62px;
  --tabbar-gap: 8px;
}
```

### What each color is for

| Token | Use for | Never for |
|---|---|---|
| `background` | Screen ground | |
| `surface` | Cards, rows, sheets | |
| `surface-sunken` | Wells: heat map, inputs, photo frame | Timestamps on top of it |
| `surface-selected` | Pressed row, selected segment, today's column | |
| `rule` | Hairlines between rows and around cards | Control edges |
| `rule-strong` | Edges of inputs, secondary buttons, checkboxes (3:1) | Decoration |
| `ink` | Text, primary button, focus, links, badge | |
| `ink-muted` | Secondary text, struck-through old terms | |
| `ink-faint` | Timestamps, the open-occurrence ring | Body text |
| `satisfied` | Satisfied marks, cells, chip text | Banners, buttons, credits |
| `owed` | Missed marks, owed amounts, Overdue | Buttons, destructive actions, errors |
| `waiting` | Not judged yet, held penalties, waiting on someone | |
| `excused` | Excused, vacation, withdrawn | |
| `seal` | The four seal moments above | Anything else |
| `error` | System failures, always with the alert icon, in a banner | Money, validation of user input |
| `material` | Floating chrome: the tab bar, a scrolled navigation bar | Cards, rows, sheets, anything you read |
| `shadow-float` | Floating chrome only: the tab bar and sheets | Cards, buttons, rows |

Each state color has a `-soft` tint for chip and banner backgrounds. The state color on its own tint passes 4.5:1 in both themes, as does every text token on `background` and `surface`.

## Type

- `--font-serif` (New York): pact titles, screen titles, the terms clause, signatures (italic).
- `--font-sans` (SF Pro): everything you operate.
- `--font-mono` (SF Mono) with `font-variant-numeric: tabular-nums`: money, counts, ledger dates.

System fonts only. Remove the Google Fonts `<link>`s from `src/client/index.html` (Bricolage Grotesque, Public Sans, IBM Plex Mono).

The styles follow Apple's Dynamic Type ramp at the default (Large) text size. Pact keeps serif for the roles that make it read like a signed agreement.

| Style | Family | Size / line | Weight | Use |
|---|---|---|---|---|
| large-title | serif | 34/41 | 600 | Root screen titles (Today, Pacts, Review, Ledgers), before scrolling |
| title-1 | serif | 28/34 | 600 | Pact title on its own page |
| title-2 | serif | 22/28 | 600 | Section titles on a page |
| title-3 | serif | 20/25 | 400 | The terms clause |
| signature | serif italic | 15/20 | 400 | Names on signature lines |
| nav-title | sans | 17/22 | 600 | Inline title in the navigation bar |
| headline | sans | 17/22 | 600 | Row and card titles |
| body | sans | 17/22 | 400 | Default. 17px so iOS never zooms an input |
| callout | sans | 16/21 | 400 | Notes, banner text |
| subheadline | sans | 15/20 | 400 | Secondary lines in rows and cards |
| footnote | sans | 13/18 | 400 | Row meta, timestamps |
| label | sans | 13/16 | 600 | Chips, field labels. Sentence case, never all caps |
| caption-1 | sans | 12/16 | 400 | Heat map month and weekday labels |
| caption-2 | sans | 10/12 | 500 | Tab bar labels |
| figure-lg | mono | 28/34 | 500 | Amount on a ledger or bill page |
| figure | mono | 15/20 | 500 | Amounts and counts in rows |
| figure-sm | mono | 13/16 | 400 | Dates in ledger rows |

**Dynamic Type.** Set sizes in `rem`, with `html { font-size: 17px }` and, inside `@supports (font: -apple-system-body)`, `html { font: -apple-system-body }`, so Safari scales the whole ramp with the phone's text-size setting. Layouts must survive the largest accessibility size: rows grow taller rather than truncate money, names or reasons, and the tab bar keeps its height (its labels are the one fixed size, as in iOS).

## Mobile only

Pact runs as an iPhone home-screen web app (`display: standalone`, `orientation: portrait` in `manifest.webmanifest`). Design for the phone and nothing else.

**Widths**
- Design at 390px (iPhone 14 to 16). Everything must work from 375px (iPhone SE, mini) to 440px (Pro Max).
- Must not break at 320px: no horizontal scroll, nothing clipped.
- Wider than 440px (a laptop during development): the same phone column, centered at `--content-max` (440px) on `background`. No breakpoints for wider screens, no second layout. Replace the existing `max-width: 400px` and `600px` rules with `--content-max`.
- No landscape design.

**The shell**
- Height with `100dvh` / `min-height: 100dvh`, never `100vh` (Safari's toolbar makes `vh` wrong).
- Safe areas: pad with `max(<space>, env(safe-area-inset-*))` on every edge, as the existing shell does. 16px side margins.
- Status bar: switch `apple-mobile-web-app-status-bar-style` to `black-translucent` so the page color runs under the status bar in both themes. `default` paints a light bar over Carbon. The top padding already includes `env(safe-area-inset-top)`.
- Two `theme-color` metas, one per scheme: `#F1F4F0` with `media="(prefers-color-scheme: light)"` and `#101412` with `media="(prefers-color-scheme: dark)"`.

**Navigation bar**
- Root screens (Today, Pacts, Review, Ledgers) open with a Large Title (`large-title`) under the status bar. Once the page scrolls, it collapses into an inline `nav-title`, centered, and the bar behind it becomes `--material` with `--material-blur` and a `rule` hairline at its bottom edge. Before scrolling the bar has no background and no hairline. The Large Title is the first thing in the scrolling content (so it scrolls away with it), and the bar sits above the content rather than over it, so nothing scrolls behind its material.
- Pushed screens (a pact, a ledger, an excuse) show the inline title from the start, with the back button top left: a `ChevronLeft` plus the parent screen's title ("Pacts"), in `ink`, at least 44pt tall. Not a circled icon button.
- At most one trailing control on the right (the profile avatar, or one text button such as "Edit").

**Floating tab bar**
- Today, Pacts, Review (with the ink badge), Ledgers, in a capsule that floats over the content, as iOS 26 draws it.
- Position: `position: fixed`, `--tabbar-gap` above `env(safe-area-inset-bottom)`, inset 16px from each side (`max(16px, env(safe-area-inset-left/right))`), and no wider than `--content-max` minus the side insets, centered.
- Shape: `--tabbar-height` (62px) tall, `--radius-pill` corners, `--material` with `--material-blur`, a 0.5px `rule` edge (an inset `box-shadow`), and `--shadow-float`.
- Items: 24px icon over a `caption-2` label. The active tab sits on a `surface-selected` capsule inside the bar, in `ink`; the others are `ink-muted`. The capsule slides to the tapped tab over `--duration-select` with `--ease-spring`. Each tab fills a quarter of the bar and is at least 44pt tall.
- Content scrolls underneath it. Every scrolling area ends with bottom padding of `--tabbar-height` + `--tabbar-gap` + `env(safe-area-inset-bottom)` + 16px, so the last row can always scroll clear of the bar.
- A bottom action bar (Submit photo, Approve change / Reject) sits directly above the tab bar, not under it. Sheets cover the tab bar.
- The tab bar stays visible on pushed screens, as in iOS, so every root screen is one tap away.

**Thumb reach**
- The top of a screen is for reading: title, state, the terms. The bottom third is for acting.
- A screen with one primary action pins it in a bottom action bar above the tab bar (Submit photo, Approve change / Reject, Record payment). Never put the only primary action in the top corner.
- Decision pairs (Reject / Approve) are equal width, side by side, in that bar.
- iOS standalone apps don't reliably offer swipe-back. Every pushed screen has a visible back chevron, top left.

**Sheets and pages**
- Short secondary flows are bottom sheets: excuse, question and reply, confirmations, pickers. `radius-sheet` top corners, a grabber, `scrim` behind, `--shadow-float`, dismissed by dragging down or a Cancel text button. Never a centered modal dialog.
- Sheets use iOS detents: medium (about half the screen) for a confirmation or a picker, large (to just under the status bar) for anything with a text field. A sheet has one way to finish (the primary button) and one way out (Cancel, top left, or dragging down).
- Multi-step flows are full-screen pages with their primary action pinned at the bottom: create pact, plan vacation, record payment.

**Lists**
- Settings-like content (the terms, Profile, notification settings, a pact's reviewers) is an inset grouped list, as in iOS Settings: rows in a `surface` card with `radius-card` corners, `background` around it, a `footnote` header above the group in `ink-muted`, sentence case.
- Rows are at least 44pt tall (64pt with a thumbnail). Separators are `rule` hairlines inset to start at the text, not the card's edge. A row that opens something ends with a `ChevronRight` in `ink-faint`; a row that does something in place has no chevron.

**Controls**
- Buttons follow iOS's three weights: prominent (Primary, `ink` fill), bordered (Secondary), plain (Text). A full-width or bottom-bar button is 50pt tall with `--radius-pill` corners, the iOS 26 capsule. Buttons inside a card or row keep `--radius-control`.
- Segmented control: a `surface-sunken` track with `--radius-control` corners, the selected segment raised on `surface` with a `rule` edge, labels in `headline`. Never colored.
- Switch: the iOS shape, 51×31, `rule-strong` track when off and `ink` when on, a `surface` thumb. Never green (see "Following Apple's HIG").
- Pickers: native `type="date"` and `type="time"` inputs, which Safari draws as iOS wheels.

**Touch**
- Every target at least 44×44px, with at least 8px between adjacent targets.
- No hover. Pressed state is `:active` (`surface-selected` for rows, scale 0.98 for buttons). Wrap any `:hover` rule in `@media (hover: hover)` so it never sticks after a tap. Two in `styles.css` today: `.tcard:hover`, `.ledger-card:has(> .rowbtn:hover)`.
- Long-press and swipe gestures never hide anything essential; every action has a visible control.
- Keep `-webkit-tap-highlight-color: transparent` and `overscroll-behavior: none` (already set); pull-to-refresh is Pact's own.

**Inputs and the keyboard**
- Inputs 17px, so Safari never zooms on focus.
- Right keyboard every time: `inputmode="decimal"` for money, native `type="time"` and `type="date"` pickers, `enterkeyhint` on the last field of a form.
- When the keyboard is open, the focused field and its submit action stay visible. Don't pin the bottom action bar while the keyboard is up; let it flow under the last field.

**Camera evidence**
- `<input type="file" accept="image/*" capture="environment">` opens the camera directly.
- The photo is shown full width at 4:3 on `surface-sunken`, `radius-control`. In review it is the first thing on screen.

**Layout tokens**
- 4pt grid. Radius: cards and banners 16, buttons, inputs, rows and thumbnails 10, sheets 24, heat map cells 3, chips and marks round.
- No elevation shadows on content. Depth comes from `background` → `surface` → `surface-sunken` and 1px `rule` hairlines. An inset `box-shadow` used as a hairline is fine; a drop shadow is not. Remove the existing `0 1px 2px var(--scrim)` shadow.
- One exception: floating chrome (the tab bar and sheets) carries `--shadow-float`, because it sits above the content the way iOS's floating chrome does. Nothing else gets a shadow.
- One column everywhere. Truncate row titles with an ellipsis; never truncate money, names in the terms, or a reason.

## Testing on localhost

Every UI change is checked at phone size. A screenshot at a laptop width is not evidence of anything.

**Playwright.** Add phone projects to `playwright.config.ts`, WebKit first because every user is on iPhone Safari:

```ts
import { defineConfig, devices } from "@playwright/test";
// ...
projects: [
  { name: "iphone", use: { ...devices["iPhone 15"] } },                       // 393×852, WebKit, touch
  { name: "iphone-se", use: { ...devices["iPhone SE"] } },                    // 375×667, the smallest supported
  { name: "iphone-dark", use: { ...devices["iPhone 15"], colorScheme: "dark" } },
],
```

Run `npx playwright install webkit` once. Device names come from Playwright's device list; if one is missing in the installed version, pick the nearest iPhone. Tests that need a tap use `page.tap()`, not hover.

**Screenshots for design work.** For every screen a change touches, capture iPhone SE and iPhone 15 sizes in both themes (four images), full page, and attach them to the PR. Check: no horizontal scroll at 375px, primary action reachable at the bottom, nothing under the status bar or home indicator.

**Quick look while building.** Chrome DevTools device toolbar or Safari's Responsive Design Mode at 375 and 393 wide is fine for iteration. Neither emulates safe-area insets or the standalone status bar.

**On the phone (before merging).** `npm run dev` already listens on the network (`host: true` in `vite.config.ts`). Open `http://<laptop's LAN IP>:5173` on the iPhone, then Share → Add to Home Screen and test from the home-screen icon: standalone mode is the only way to see the real status bar, safe areas and keyboard behaviour. Sign-in in this setup follows `docs/agents/local-dev.md`. Prototypes follow `docs/agents/prototype-first.md`, which already asks for phone width.

## Motion

- Movement uses iOS's spring feel: `--ease-spring` (fast start, soft settle, no overshoot). Sheets rise over `--duration-sheet`; a pushed screen slides in from the right over `--duration-push` and back out to the right; the tab bar's selected capsule slides over `--duration-select`.
- Satisfied mark fills over 180ms ease-out. The seal presses once over 240ms and never re-animates on revisit. State changes crossfade 120ms.
- Money never animates. Nothing loops or pulses.
- Under `prefers-reduced-motion: reduce`, everything is a 120ms crossfade, including pushes and sheets.
- No haptics. Don't design anything that depends on them.

## Accessibility

Pact respects the same iPhone settings a native app does.

- **Text size (Dynamic Type):** see "Type". Check every changed screen at the largest accessibility text size as well as the default.
- **Reduce Motion:** `prefers-reduced-motion: reduce`, see "Motion".
- **Reduce Transparency:** under `prefers-reduced-transparency: reduce`, `--material` becomes solid `surface` and the blur is off.
- **Increase Contrast:** under `prefers-contrast: more`, `rule` hairlines become `rule-strong`, `ink-faint` becomes `ink-muted`, and materials are solid.
- **VoiceOver:** every occurrence mark has an `aria-label` with its state and date, every icon-only button has a label, the tab bar is a `nav` with `aria-current` on the active tab, and the Review badge's count is part of its tab's label ("Review, 3 waiting").
- Never use color alone: every state also differs by shape, text or both (see OccurrenceMark and Chip).

## Icons: Lucide

Use [Lucide](https://lucide.dev) via `lucide-react` (ISC license, tree-shaken per icon, React 19 compatible). Do not draw new icons by hand.

```sh
npm install lucide-react
```

Wrap it once so every icon gets the house style:

```tsx
// src/client/icons.tsx
import type { LucideIcon } from "lucide-react";

export function Icon({ icon: I, size = 24, label }: { icon: LucideIcon; size?: 20 | 24; label?: string }) {
  return <I size={size} strokeWidth={1.75} aria-hidden={label ? undefined : true} aria-label={label} />;
}
```

Rules: 24px in tab bar and rows, 20px inline with text, stroke 1.75, `currentColor` only (so icons take `ink`, `ink-muted` or `ink-faint`). Icons never carry a state color, except `CircleAlert` in an error banner. Icon-only buttons need a `label` and a 44px hit area. Occurrence marks are not icons; they stay CSS (see Components).

Replace the hand-drawn icons in `src/client/icons.tsx`:

| Current | Lucide | Where |
|---|---|---|
| `TodayIcon` | `CalendarCheck` | Tab bar |
| `PactsIcon` | `ScrollText` | Tab bar |
| `ReviewIcon` | `ClipboardCheck` | Tab bar |
| `LedgersIcon` | `BookOpen` | Tab bar |
| `ShareIcon` | `Share` | Install hint |
| `AddIcon` | `Plus` | New pact |
| `BackIcon` | `ChevronLeft` | Back |
| `CameraIcon` | `Camera` | Camera evidence |
| `CardsIcon` | `Layers` | Anki evidence |
| `RingIcon` | `Moon` | Oura Ring evidence (bedtime) |
| `SuitcaseIcon` | `Luggage` | Vacation |
| `DollarIcon` | `Banknote` | Payments, bills |
| `ExcuseIcon` | `MessageSquareText` | Excuse |
| `PencilIcon` | `Pencil` | Edit |
| `GoogleIcon` | keep as is | Lucide has no brand marks |
| (new) | `ChevronRight` | Row disclosure |
| (new) | `CircleAlert` | Error banner |
| (new) | `MessageCircleQuestion` | Reviewer question |

Lucide renames icons occasionally; if a name above doesn't resolve, search lucide.dev for the closest match and keep the meaning.

## Components

Reference CSS for all of these is at the end of this file (class prefix `pc-`). Adapt it into the existing classes in `styles.css` rather than adding a second set; the names and rules matter more than the class names.

**OccurrenceMark.** A 20px circle for one occurrence. Shape carries the state, color confirms it:
Satisfied = filled `satisfied` disc with a check · Missed = hollow 2px `owed` ring · Missed, penalty held = hollow 2px `waiting` ring · Not judged yet = `waiting` ring with a center dot · Excused / Vacation = dashed `excused` ring · Today, to do = 2px `ink` ring · Open = 1.5px `ink-faint` ring · Ahead = small `rule-strong` dot. Always an `aria-label` with state and date.

**HeatMap.** Mon to Sun grid of 14px cells, 4px gaps, on a `surface-sunken` well. Same states squared: solid means met, anything that didn't happen is hollow, so a bad week reads as gaps rather than a wall of red. Vacation is `excused` hatching. Today has a 2px `ink` outline. The grid is the tap target; a tapped week expands into marks.

**Chip and Badge.** One or two glossary words: To do (outline), Not judged yet / Waiting on you / Held (`waiting`), Satisfied, Missed $20 and Overdue 2 days (`owed`), Excused / Vacation / Withdrawn (`excused`), Active / Ended (neutral). Missed always carries the amount; Excused always carries the reason. Max two chips per row. The Review Queue count is an ink badge.

**Button.** Primary (ink fill, at most one per screen), Secondary (surface with `rule-strong` edge), Text (underlined ink). No danger variant: destructive actions are Secondary plus a confirm sheet that states what is lost. Labels are verb first and name the consequence ("Delete pact", "Record payment"), never "OK" or "Yes". Focus: 2px ink outline, 2px offset.

**TermsCard.** The pact as one serif sentence, then signature lines (hairline, name in italic, role below; owner first). Heads the pact page and the create flow's review step. During the edit window, one footnote line: "Free edits for 7 more minutes. After that, looser changes need Hrishi." Clause patterns:
- "You'll go to the gym 4 days a week, proven by a photo, or pay $20 to Yankees Foundation for each day short."
- "You'll be in bed by 12:00am Sun to Thu, checked by Oura, or pay $10 to Yankees Foundation for each night missed."
- Reviewers see the owner's first name instead of "You".

**ReviewRow.** One row for every review item kind and for questions waiting on the owner (decision 5 in the design review). Lead with the evidence thumbnail (56px) or a kind icon on `surface-sunken`; headline title naming what and which occurrence; footnote meta with whose and how long it has waited; optional chip; chevron. No decision buttons in the row. Oldest first.

**ChangeRequest.** Waiting chip ("Waiting on you" / "Waiting on Hrishi"), one-sentence ask, a diff on `surface-sunken` with old terms struck through in `ink-muted` and new ones in `ink` semibold, the owner's note in italic serif, Reject and Approve change at equal width, and a footnote saying what holds until a decision and when approval takes effect. Approval presses the seal on the TermsCard; rejection gets no seal and no red.

**LedgerRow.** Recipient, bill state, and the total in mono, right aligned, with cents. Above zero `owed`, zero `ink-faint`, credit `ink-muted` with the word "credit" (never green). Overdue adds an `owed` chip. Amounts never animate. The action is "Record payment"; Pact never implies it moves money.

**Banner.** Overdue (`owed-soft`, states amount, recipient, and the social consequence, no dismiss), Waiting on you (`waiting-soft`, one line plus Reply), Error (`error-soft` with `CircleAlert` in `error`, says what Pact will do and whether anything is held). A Missed occurrence never gets a banner.

**Seal.** A 72px stamp: `seal` double ring on `seal-soft`, serif text, tilted -8°. Presses once. Words: Witnessed, Amended, Paid up, Met in full. If two moments land together, stamp the latest and list the other as text.

## Voice

Plain, second person to the owner, the owner's first name for everyone else. Sentence case. No emoji, no exclamation marks, no em dashes.

- What happened, then what it costs, then what you can do: "Missed Tuesday. $20 to Yankees Foundation. You can request an excuse until Thu 9:00pm."
- Money always with its recipient. Name who decides: "Waiting on Hrishi", never "Pending".
- Use `GLOSSARY.md` words exactly. Never "kept", "done", "approved" as an outcome, "pending", "fine", "stake", "balance", "streak", "goal", "check-in".

| Instead of | Write |
|---|---|
| Great job! Streak: 5 | Satisfied. Hrishi approved your photo. |
| You failed your workout | Missed Tuesday. $20 to Yankees Foundation. |
| Pending | Not judged yet / Waiting on Hrishi |
| Your balance is $40 | You owe $40 to Yankees Foundation. Bill due Wed Dec 2. |
| Payment complete! | Payment recorded. It counts once Hrishi approves it. |

## Migrating `styles.css`

| Old | New | Visible change |
|---|---|---|
| `--paper`, `--sunk`, `--ink`, `--muted` | `--background`, `--surface-sunken`, `--ink`, `--ink-muted` | None |
| `--surface` #fff | `--surface` | Off-white |
| `--line` | `--rule`; control edges use `--rule-strong` | Inputs and secondary buttons get a darker edge |
| `--accent`, `--accent-soft` | `--ink`, `--surface-selected` | Navy buttons and links become ink |
| `--ok`, `--ok-bg` | `--satisfied`, `--satisfied-soft` | None |
| `--missed`, `--missed-bg` | `--owed`, `--owed-soft` | Narrower use; `.btn.danger` goes away |
| `--due`, `--due-bg`, `--amber`, `--amber-bg` | `--waiting`, `--waiting-soft` | Two oranges become one ochre |
| `--excused`, `--excused-bg`, `--excused-cell` | `--excused`, `--excused-soft` | Amber becomes graphite |
| `--vacation-line`, `--vacation-hatch` | `--excused` hatching | Minor |
| `--fresh`, `--fresh-bg` | `--surface-selected` plus the ink badge | Blue goes away |
| `--slate`, `--slate-bg` | `--excused` / `--ink-muted` (check each use) | Varies |
| `--f-display`, `--f-body`, `--f-mono` | `--font-serif`, `--font-sans`, `--font-mono` | New fonts |

Suggested order, one PR each:
1. Tokens and mobile shell: swap the `:root` block and rename variables across `styles.css`; status bar style, two `theme-color` metas, `100dvh`, `--content-max`, hover guards; Playwright iPhone projects.
2. Fonts: system stacks, drop Google Fonts.
3. Icons: Lucide, per the table above.
4. Floating tab bar: the capsule over the content, `--material`, scroll padding, the sliding selection.
5. Navigation bar: Large Titles that collapse on scroll, labelled back buttons.
6. Dynamic Type: the type ramp in `rem`, following the phone's text size.
7. Dark theme: verify every screen in Carbon, including the heat map and photo viewer.
8. Rules: danger buttons, held penalties in `waiting`, banner priority, ReviewRow, ChangeRequest diff, TermsCard clause.
9. iOS controls and lists: inset grouped lists, capsule bottom-bar buttons, segmented control, ink switch, sheet detents.
10. Seal moments, motion and the accessibility settings.

After each step, run the iPhone Playwright projects and check every touched screen on a real iPhone, from the home-screen icon, in both themes.

## Reference CSS

```css
/* Pact components. Plain CSS over tokens.css; class prefix pc-. */
body { margin: 0; font-family: var(--font-sans); font-size: 17px; line-height: 24px; background: var(--background); color: var(--ink); -webkit-font-smoothing: antialiased; }
.pc-stage { padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-4); max-width: var(--content-max); }
.pc-row-flex { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; }
.pc-caption { font-size: 13px; line-height: 18px; color: var(--ink-muted); }
.pc-num { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.pc-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }

/* Occurrence mark. Every state differs by shape, not hue alone. */
.pc-mark { box-sizing: border-box; width: var(--mark); height: var(--mark); border-radius: var(--radius-pill); display: inline-grid; place-items: center; flex: none; color: var(--on-ink); }
.pc-mark svg { width: 12px; height: 12px; }
.pc-mark.is-satisfied { background: var(--satisfied); }
.pc-mark.is-missed { border: 2px solid var(--owed); }
.pc-mark.is-held { border: 2px solid var(--waiting); }
.pc-mark.is-waiting { border: 2px solid var(--waiting); }
.pc-mark.is-waiting::after { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--waiting); }
.pc-mark.is-excused { border: 2px dashed var(--excused); }
.pc-mark.is-open { border: 1.5px solid var(--ink-faint); }
.pc-mark.is-today { border: 2px solid var(--ink); }
.pc-mark.is-ahead::after { content: ""; width: 4px; height: 4px; border-radius: 50%; background: var(--rule-strong); }
@media (prefers-reduced-motion: no-preference) {
  .pc-mark { transition: background-color var(--duration-check) ease-out, border-color var(--duration-check) ease-out; }
}

/* Heat map */
.pc-heat { display: grid; grid-template-columns: repeat(7, var(--cell)); gap: 4px; padding: var(--space-3); background: var(--surface-sunken); border-radius: var(--radius-control); width: max-content; }
.pc-cell { width: var(--cell); height: var(--cell); border-radius: var(--radius-cell); box-sizing: border-box; background: var(--surface); }
.pc-cell.is-satisfied { background: var(--satisfied); }
.pc-cell.is-missed { background: var(--surface); box-shadow: inset 0 0 0 2px var(--owed); }
.pc-cell.is-held { background: var(--surface); box-shadow: inset 0 0 0 2px var(--waiting); }
.pc-cell.is-waiting { background: var(--waiting-soft); box-shadow: inset 0 0 0 2px var(--waiting); }
.pc-cell.is-excused { background: var(--excused-soft); box-shadow: inset 0 0 0 1px var(--excused); }
.pc-cell.is-vacation { background: repeating-linear-gradient(135deg, var(--excused) 0 1.5px, var(--excused-soft) 1.5px 4px); }
.pc-cell.is-open { background: var(--surface); box-shadow: inset 0 0 0 1px var(--ink-faint); }
.pc-cell.is-ahead { background: transparent; box-shadow: inset 0 0 0 1px var(--rule); }
.pc-cell.is-none { background: transparent; }
.pc-legend { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); font-size: 13px; line-height: 18px; color: var(--ink-muted); }
.pc-legend span { display: inline-flex; align-items: center; gap: var(--space-1); }

/* Chips */
.pc-chip { display: inline-flex; align-items: center; gap: var(--space-1); height: 24px; padding: 0 var(--space-2); border-radius: var(--radius-pill); font-size: 13px; line-height: 16px; font-weight: 600; white-space: nowrap; background: var(--surface-sunken); color: var(--ink); }
.pc-chip.is-todo { background: transparent; box-shadow: inset 0 0 0 1px var(--rule-strong); }
.pc-chip.is-satisfied { background: var(--satisfied-soft); color: var(--satisfied); }
.pc-chip.is-missed, .pc-chip.is-overdue { background: var(--owed-soft); color: var(--owed); }
.pc-chip.is-waiting { background: var(--waiting-soft); color: var(--waiting); }
.pc-chip.is-excused { background: var(--excused-soft); color: var(--excused); }
.pc-chip .pc-num { font-weight: 500; }

/* Badge: the Review Queue count */
.pc-badge { display: inline-grid; place-items: center; min-width: 20px; height: 20px; padding: 0 6px; box-sizing: border-box; border-radius: var(--radius-pill); background: var(--ink); color: var(--on-ink); font-family: var(--font-mono); font-size: 12px; font-weight: 500; }

/* Buttons */
.pc-btn { -webkit-appearance: none; appearance: none; font: inherit; font-size: 17px; font-weight: 600; height: var(--button-height); min-width: var(--tap-target); padding: 0 var(--space-5); border-radius: var(--radius-control); border: 0; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2); }
.pc-btn.is-primary { background: var(--ink); color: var(--on-ink); }
.pc-btn.is-secondary { background: var(--surface); color: var(--ink); box-shadow: inset 0 0 0 1px var(--rule-strong); }
.pc-btn.is-text { background: transparent; color: var(--ink); text-decoration: underline; text-underline-offset: 3px; padding: 0 var(--space-2); height: var(--tap-target); font-weight: 500; }
.pc-btn.is-block { width: 100%; }
.pc-btn:disabled { background: var(--surface-sunken); color: var(--ink-faint); box-shadow: none; cursor: default; }
.pc-btn:focus-visible, .pc-row:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.pc-btn:active:not(:disabled) { transform: scale(0.98); }

/* Cards */
.pc-card { background: var(--surface); border-radius: var(--radius-card); box-shadow: inset 0 0 0 1px var(--rule); padding: var(--space-4); }

/* Terms card */
.pc-terms { background: var(--surface); border-radius: var(--radius-card); box-shadow: inset 0 0 0 1px var(--rule); padding: var(--space-5); display: flex; flex-direction: column; gap: var(--space-4); }
.pc-terms-head { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-3); }
.pc-terms-title { margin: 0; font-family: var(--font-serif); font-size: 24px; line-height: 30px; font-weight: 600; }
.pc-clause { margin: 0; font-family: var(--font-serif); font-size: 20px; line-height: 28px; }
.pc-clause b { font-weight: 600; }
.pc-clause .pc-num { font-size: 18px; font-weight: 500; }
.pc-signatures { display: flex; gap: var(--space-6); padding-top: var(--space-3); }
.pc-sig { flex: 1; border-top: 1px solid var(--rule-strong); padding-top: var(--space-2); font-family: var(--font-serif); font-style: italic; font-size: 15px; line-height: 20px; }
.pc-sig small { display: block; font-family: var(--font-sans); font-style: normal; font-size: 13px; line-height: 18px; color: var(--ink-muted); }
.pc-window { font-size: 13px; line-height: 18px; color: var(--ink-muted); }

/* Rows: one waiting list, one row (R10) */
.pc-list { background: var(--surface); border-radius: var(--radius-card); box-shadow: inset 0 0 0 1px var(--rule); overflow: hidden; }
.pc-row { display: flex; align-items: center; gap: var(--space-3); min-height: 64px; padding: var(--space-3) var(--space-4); text-decoration: none; color: inherit; }
.pc-row + .pc-row { box-shadow: inset 0 1px 0 var(--rule); }
.pc-row:active { background: var(--surface-selected); }
.pc-row-main { flex: 1; min-width: 0; }
.pc-row-title { font-size: 17px; line-height: 22px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pc-row-meta { font-size: 13px; line-height: 18px; color: var(--ink-muted); }
.pc-row-meta time { color: var(--ink-faint); }
.pc-thumb { width: var(--thumb); height: var(--thumb); border-radius: var(--radius-control); background: var(--surface-sunken); flex: none; display: grid; place-items: center; color: var(--ink-faint); overflow: hidden; }
.pc-kind { width: var(--thumb); height: var(--thumb); border-radius: var(--radius-control); background: var(--surface-sunken); flex: none; display: grid; place-items: center; color: var(--ink-muted); }
.pc-chevron { color: var(--ink-faint); flex: none; }
.pc-amount { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 15px; line-height: 20px; font-weight: 500; text-align: right; }
.pc-amount.is-owed { color: var(--owed); }
.pc-amount.is-zero { color: var(--ink-faint); }
.pc-amount.is-credit { color: var(--ink-muted); }

/* Change request */
.pc-change { background: var(--surface); border-radius: var(--radius-card); box-shadow: inset 0 0 0 1px var(--rule); padding: var(--space-5); display: flex; flex-direction: column; gap: var(--space-4); }
.pc-change-ask { margin: 0; font-size: 17px; line-height: 24px; }
.pc-diff { display: grid; grid-template-columns: max-content 1fr; gap: var(--space-2) var(--space-4); margin: 0; padding: var(--space-3) var(--space-4); background: var(--surface-sunken); border-radius: var(--radius-control); }
.pc-diff dt { font-size: 13px; line-height: 20px; font-weight: 600; color: var(--ink-muted); }
.pc-diff dd { margin: 0; font-size: 15px; line-height: 20px; }
.pc-diff del { color: var(--ink-muted); text-decoration-thickness: 1px; }
.pc-diff ins { text-decoration: none; font-weight: 600; }
.pc-note { margin: 0; font-family: var(--font-serif); font-style: italic; font-size: 15px; line-height: 22px; color: var(--ink-muted); }
.pc-actions { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); }
.pc-fine { margin: 0; font-size: 13px; line-height: 18px; color: var(--ink-muted); }

/* Banners: only when someone is waiting on you or money is overdue */
.pc-banner { display: flex; gap: var(--space-3); align-items: flex-start; padding: var(--space-4); border-radius: var(--radius-card); }
.pc-banner p { margin: 0; flex: 1; font-size: 15px; line-height: 20px; }
.pc-banner .pc-btn { height: 36px; padding: 0 var(--space-3); font-size: 15px; flex: none; }
.pc-banner.is-overdue { background: var(--owed-soft); }
.pc-banner.is-overdue strong { color: var(--owed); }
.pc-banner.is-waiting { background: var(--waiting-soft); }
.pc-banner.is-error { background: var(--error-soft); color: var(--ink); }
.pc-banner.is-error svg { color: var(--error); flex: none; margin-top: 1px; }

/* Seal: the notary stamp */
.pc-seal { width: 72px; height: 72px; border-radius: 50%; box-sizing: border-box; border: 2px solid var(--seal); background: var(--seal-soft); color: var(--seal); display: grid; place-items: center; text-align: center; transform: rotate(-8deg); position: relative; flex: none; }
.pc-seal::before { content: ""; position: absolute; inset: 4px; border-radius: 50%; border: 1px solid var(--seal); }
.pc-seal span { font-family: var(--font-serif); font-size: 11px; line-height: 13px; font-weight: 600; max-width: 50px; }
@media (prefers-reduced-motion: no-preference) {
  .pc-seal.is-pressing { animation: pc-stamp var(--duration-stamp) cubic-bezier(0.2, 0.9, 0.3, 1.2) 1 both; }
  @keyframes pc-stamp { from { transform: rotate(-8deg) scale(1.25); opacity: 0; } to { transform: rotate(-8deg) scale(1); opacity: 1; } }
}
```
