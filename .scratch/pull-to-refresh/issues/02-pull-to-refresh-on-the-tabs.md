# 02 Pull to refresh on the four tabs

Status: ready-for-agent
Blocked by: none

Spec: `../spec.md`, "Where", "What a pull does" and "The indicator". Prototype: branch `prototype/pull-to-refresh`, style B.

## What to build

Pulling down at the top of Today, Pacts, Review or Ledgers and letting go past a threshold reloads that tab's data, with a line under the header.

- Touch only, and only when the tab is scrolled to the top. A pull while a refresh runs is ignored. Pages opened from a tab don't get it.
- While pulling, the content follows the finger with resistance and the line under the header grows to full width at the threshold. Letting go past it springs the content back and turns the line into a moving bar until the tab's refresh finishes. Letting go before it springs back and does nothing.
- The bar moves whatever the Reduce Motion setting says.
- Each tab says what its refresh is; for Pacts, Review and Ledgers, reloading their loads. The bar stays until the reload has answered, whether it succeeded or failed (a failure shows the existing "couldn't load" line).

## Acceptance criteria

- [ ] A pull past the threshold on each tab reloads it, and the bar shows until the reload answers (`pull-to-refresh.test.tsx`).
- [ ] A pull short of the threshold, or one that starts below the top, reloads nothing.
- [ ] A pull while a refresh runs is ignored.
- [ ] Pages opened from a tab have no pull.
- [ ] `docs/behaviour.md` describes the pull.
- [ ] The manual checks in `../manual-checks.md` are listed for the human.
