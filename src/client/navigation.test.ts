import { describe, expect, test } from "vitest";
import { APP_PATHS } from "../shared/api.ts";
import { inviteTokenFromPath, pagePath, routeFromPath, type Page, type TabId } from "./navigation.ts";

/** An id that needs encoding in a path. */
const ID = "a b/c?d";

/**
 * One page of each kind, with the tab a link to it lands on and the pages
 * under it. Keyed by kind, so a new kind of page doesn't compile until it's here.
 */
const LINKS: Record<Page["kind"], { page: Page; tab: TabId; under: Page[] }> = {
  create: { page: { kind: "create" }, tab: "pacts", under: [] },
  pact: { page: { kind: "pact", id: ID }, tab: "pacts", under: [] },
  "edit-pact": { page: { kind: "edit-pact", id: ID }, tab: "pacts", under: [{ kind: "pact", id: ID }] },
  "change-pact": { page: { kind: "change-pact", id: ID }, tab: "pacts", under: [{ kind: "pact", id: ID }] },
  "change-request": { page: { kind: "change-request", id: ID }, tab: "today", under: [] },
  ledger: { page: { kind: "ledger", recipientId: ID }, tab: "ledgers", under: [] },
  excuse: { page: { kind: "excuse", id: ID }, tab: "today", under: [] },
  evidence: { page: { kind: "evidence", id: ID }, tab: "today", under: [] },
  payment: { page: { kind: "payment", id: ID }, tab: "today", under: [] },
  notifications: { page: { kind: "notifications" }, tab: "today", under: [] },
};

describe("a link to a page opens that page on a fresh load", () => {
  for (const [kind, { page, tab, under }] of Object.entries(LINKS)) {
    test(kind, () => {
      expect(routeFromPath(pagePath(page))).toEqual({ tab, stack: [...under, page] });
    });
  }

  test("a pact or ledger page's name isn't in its link: the page loads it", () => {
    expect(routeFromPath(pagePath({ kind: "pact", id: "p1", name: "Gym" }))).toEqual({
      tab: "pacts",
      stack: [{ kind: "pact", id: "p1" }],
    });
    expect(routeFromPath(pagePath({ kind: "ledger", recipientId: "r1", name: "Sam" }))).toEqual({
      tab: "ledgers",
      stack: [{ kind: "ledger", recipientId: "r1" }],
    });
  });
});

describe("links already sent keep opening the same page", () => {
  // Pushes and invite links carry these paths, so they must keep working whatever builds them.
  test.each([
    ["/pacts/new", { tab: "pacts", stack: [{ kind: "create" }] }],
    ["/notifications", { tab: "today", stack: [{ kind: "notifications" }] }],
    ["/pacts/p%201", { tab: "pacts", stack: [{ kind: "pact", id: "p 1" }] }],
    [
      "/pacts/p1/edit",
      {
        tab: "pacts",
        stack: [
          { kind: "pact", id: "p1" },
          { kind: "edit-pact", id: "p1" },
        ],
      },
    ],
    [
      "/pacts/p1/change",
      {
        tab: "pacts",
        stack: [
          { kind: "pact", id: "p1" },
          { kind: "change-pact", id: "p1" },
        ],
      },
    ],
    ["/changes/c1", { tab: "today", stack: [{ kind: "change-request", id: "c1" }] }],
    ["/ledgers/r1", { tab: "ledgers", stack: [{ kind: "ledger", recipientId: "r1" }] }],
    ["/excuses/x1", { tab: "today", stack: [{ kind: "excuse", id: "x1" }] }],
    ["/evidence/e1", { tab: "today", stack: [{ kind: "evidence", id: "e1" }] }],
    ["/payments/m1", { tab: "today", stack: [{ kind: "payment", id: "m1" }] }],
  ] as const)("%s", (path, route) => {
    expect(routeFromPath(path)).toEqual(route);
  });

  test("an invite link is /invite/ and the token as it was made", () => {
    expect(inviteTokenFromPath("/invite/Ab-9_xYz")).toBe("Ab-9_xYz");
    expect(APP_PATHS.invite("Ab-9_xYz")).toBe("/invite/Ab-9_xYz");
  });

  test("a trailing slash or a doubled one is another path", () => {
    expect(routeFromPath("/pacts/p1/")).toEqual({ tab: "today", stack: [] });
    expect(routeFromPath("//pacts/p1")).toEqual({ tab: "today", stack: [] });
    expect(routeFromPath("/pacts/")).toEqual({ tab: "today", stack: [] });
    expect(inviteTokenFromPath("/invite/Ab-9_xYz/")).toBeNull();
  });
});

describe("a link to a tab opens the tab's own screen", () => {
  test.each([
    [APP_PATHS.today, "today"],
    [APP_PATHS.pacts, "pacts"],
    [APP_PATHS.review, "review"],
    [APP_PATHS.ledgers, "ledgers"],
  ] as const)("%s", (path, tab) => {
    expect(routeFromPath(path)).toEqual({ tab, stack: [] });
  });

  test("any other path opens Today", () => {
    expect(routeFromPath("/somewhere/else")).toEqual({ tab: "today", stack: [] });
    expect(routeFromPath("/pacts/p1/history")).toEqual({ tab: "today", stack: [] });
  });
});

describe("an invite link", () => {
  test("gives back its token", () => {
    expect(inviteTokenFromPath(APP_PATHS.invite("Ab-9_x"))).toBe("Ab-9_x");
    expect(inviteTokenFromPath(APP_PATHS.invite(ID))).toBe(ID);
  });

  test("any other path has none", () => {
    expect(inviteTokenFromPath("/invite/")).toBeNull();
    expect(inviteTokenFromPath("/invite/a/b")).toBeNull();
    expect(inviteTokenFromPath(APP_PATHS.pact("p1"))).toBeNull();
  });
});
