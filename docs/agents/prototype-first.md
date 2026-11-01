# Prototype first

The suggested way of working on any change the human will see or feel: a new or changed screen, copy, or behaviour (what happens when they tap something, what a rule does to their day). Pure internals (refactors, tooling, tests, infrastructure) skip it.

The human would rather react to a clickable prototype than to a finished build: feedback after implementation means rework (ticket 03's rejected-evidence flow was built twice before the prototype on `prototype/rejection-flow` settled it).

## Ask first

Before writing any real code for a user-facing change, ask the human one question: prototype first (the default, recommended), or build directly. They may skip it for small or obvious changes; respect that and build.

## Steps

1. **Settle the open questions.** Grill the design (`/grill-with-docs`) until the options worth comparing are clear. Done when you can name 2–3 concrete options, or one design with the moments that matter.
2. **Build the prototype.** Use `/prototype`. A throwaway, self-contained HTML file on its own branch `prototype/<topic>`, cut from main in a git worktree, so the main checkout and the human's dev server stay untouched. Commit it there; never push.
   - Copy main's real styles and markup (`src/client/`), so it looks like the app, not a mock-up. Glossary words in all copy.
   - Realistic data, phone width, options side by side, and each moment that matters clickable (e.g. before / after a tap, day open / day closed).
   - Start the file with `<meta charset="utf-8">` and a viewport meta, so it reads the same served locally as published.
   - To see it in the browser pane, copy it into `tmp/` and use the launch config `prototype` (the pane can't open local files or the published page).
   - Done when every option and moment renders and every button does what the option claims.
3. **Show it.** Publish it as a private Artifact so the link opens on the human's phone, and send screenshots of each moment in the chat. Give a recommendation.
4. **Settle and write down.** Once the human picks, update the spec and the affected tickets before implementing, so the build has one source of truth.
5. **Implement**, then check it in the browser and send screenshots of the real thing next to what the prototype promised.
