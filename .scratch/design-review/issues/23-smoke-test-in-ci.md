# Run the browser smoke test in CI

Status: done
Blocked by: none

## What to build

Ticket 07 added a Playwright smoke test (`npm run test:e2e`), but CI does not run it. Add it to CI as its own job, separate from the job that runs `npm run check`, so the two run in parallel. The job installs Chromium with `npx playwright install --with-deps chromium`, caches the browser by Playwright version, and runs `npm run test:e2e`. Keep the smoke test out of `npm run check`.

Make the job a required check if the repository's CI setup lets the code say so. If it has to be set in GitHub's branch protection settings, say so in Comments for the owner to do.

## Acceptance criteria

- [x] CI runs the smoke test on every pull request and push to main, in a job separate from `npm run check`.
- [x] The Playwright browser download is cached between runs.
- [x] `npm run check` does not run the smoke test.
- [x] Comments record how long the job takes, or say it could not be measured before pushing.

## Comments

- Built: an `e2e` job in `.github/workflows/ci.yml`, beside `test` (which runs `npm run check`), so the two run in parallel. It runs `npm ci`, reads the installed `@playwright/test` version, restores `~/.cache/ms-playwright` with `actions/cache` keyed on that version, runs `npx playwright install --with-deps chromium` (on a cache hit this skips the download but still installs Chromium's system libraries), then `npm run test:e2e`. On failure it uploads `test-results/` (the trace) as the `playwright-traces` artifact for 7 days. `npm run check` is unchanged and does not run the smoke test. `docs/agents/local-dev.md` now says CI runs it.
- Deploy now needs both jobs (`needs: [test, e2e]`), so a failing smoke test blocks a deploy to main, as a failing unit test already does.
- Triggers: unchanged, `on: push`. That runs it on every push to main and on every push to a pull request's branch in this repository. Pull requests from forks are not run; add `pull_request` to `on:` if that ever matters (it would run same-repo PRs twice).
- Required check: the workflow can't make itself required. The owner sets it in GitHub: Settings, Branches (or Rules, Rulesets), a rule for `main` with "Require status checks to pass" and the checks `test` and `e2e` added.
- Timing: could not be measured before pushing. Locally `npm run test:e2e` takes about 8 seconds (build included); in CI expect `npm ci` plus, on a cold cache, the Chromium download and system packages (typically a minute or two), less on a warm cache. Read the real figure from the first run's `e2e` job.
- The action versions `actions/cache@v6` and `actions/upload-artifact@v7` are the newest major tags on GitHub as of 2026-11-11.
- Fixed the `e2e` job timing out on "waiting from config.webServer": Playwright waited on `/health`, which answers 503 while the data directory's volume is over 80% full (ADR 0003), and the GitHub runner's disk (where the test's database lives, under the temp dir) is past that, so the server was up but never counted as ready. The Better Auth "missing tables" line is a red herring (it prints locally too). `playwright.config.ts` now waits on `/healthz`, the liveness check that ignores the disk. Reproduced locally with the temp dir on an 88%-full tmpfs and a clean environment: the same timeout before, a pass after.
