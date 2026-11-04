# 19 Small copy and screen fixes left from ticket 18

Status: ready-for-agent
Blocked by: none

Split out of ticket 18 at triage on 2026-11-04. Each item changes what the owner sees, so ask the human whether to prototype first (`docs/agents/prototype-first.md`) before building.

## What to build

- **Bill card countdown.** Today's bill card reads "45h 20m" for a bill due in two days. Show days once it's a day or more away ("1d 21h"). Code: `src/client/Today.tsx`.
- **Oura option in Create pact when Oura isn't set up.** The Oura Ring tile isn't disabled, and the owner learns only after tapping Connect ("Oura isn't set up yet"). The server needs to tell the client whether Oura is configured (for example a field on `GET /api/me`), and the tile then says Oura isn't set up and can't be picked. Code: `src/client/CreatePact.tsx`, `src/server/app.ts`.
- **Overdue alert wording.** Today's overdue alert says "X and Y have been told" before the first reviewer push has gone out. Say it only once the core has told them (`overdue_notice.reviewers_told_at`), or reword it so it's true either way. Code: `src/client/Today.tsx` `OverdueAlert`.

## Acceptance criteria

- [ ] A bill due in 45 hours reads "1d 21h"; one due in 5 hours still reads in hours and minutes.
- [ ] With Oura not configured, the Oura Ring tile can't be picked and says why (`app.test.ts` covers the new field).
- [ ] The overdue alert never claims reviewers were told before they were (a scenario covers the core side).

## Comments

### 2026-11-04: settled with a prototype

Prototype: `.scratch/pact-v0/prototype/ticket-19.prototype.html` on the branch `prototype/ticket-19`. The human picked:

- **Countdown.** Every Today countdown switches to days from 24 hours up ("1d 21h"), not from 48. Under a day it stays "5h 20m".
- **Oura tile.** `GET /api/me` (and the other responses that return the profile) carries `ouraAvailable`. When it's false the tile is disabled, greyed, and a chip at its foot reads "Oura isn't set up yet".
- **Overdue alert.** The alert names the reviewers only once the core has told them in the current Overdue spell. Before that, the line is left out. ("Will be told" was rejected: a reviewer with overdue notifications switched off never is.)
