# Run the browser smoke test in CI

Status: ready-for-agent
Blocked by: none

## What to build

Ticket 07 added a Playwright smoke test (`npm run test:e2e`), but CI does not run it. Add it to CI as its own job, separate from the job that runs `npm run check`, so the two run in parallel. The job installs Chromium with `npx playwright install --with-deps chromium`, caches the browser by Playwright version, and runs `npm run test:e2e`. Keep the smoke test out of `npm run check`.

Make the job a required check if the repository's CI setup lets the code say so. If it has to be set in GitHub's branch protection settings, say so in Comments for the owner to do.

## Acceptance criteria

- [ ] CI runs the smoke test on every pull request and push to main, in a job separate from `npm run check`.
- [ ] The Playwright browser download is cached between runs.
- [ ] `npm run check` does not run the smoke test.
- [ ] Comments record how long the job takes, or say it could not be measured before pushing.

## Comments
