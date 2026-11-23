# Manual checks: sheet drag to close

Things that need a real iPhone with Pact installed on the home screen. Steps marked **(human)** need the human's hands. The numbers to tune are the named constants in `src/client/sheet-motion.ts`.

- [ ] **(human)** Open Profile and drag it down from its bar, then from its middle. It follows the finger; let go past about a third of its height and it slides away while the dimming fades.
- [ ] **(human)** Drag it a little and let go slowly. It springs back. Flick it down quickly over a short distance. It closes. Tune `CLOSE_SHARE`, `FLICK_PX_PER_MS` and `DRAG_CLAIM_PX` if either feels wrong.
- [ ] **(human)** Scroll Profile down, then drag down. The content scrolls back up and the sheet doesn't move. At the top, a drag down moves the sheet without fighting iOS's own bounce.
- [ ] **(human)** Drag a sheet up. It moves only a little, with no gap of dimming below it.
- [ ] **(human)** In a sheet with a text field (Name, Ask), tap the field, type, and drag the caret. The keyboard and caret work as before. Tap buttons, links and switches in a sheet: each works as before.
- [ ] **(human)** Tap Cancel, tap the dimmed area, and close a sheet right after it opens. Each slides away once, and the page behind stays still until it's gone.
- [ ] **(human)** With Reduce Motion on, Cancel closes at once, and a drag still moves the sheet.
