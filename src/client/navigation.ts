// In-app navigation: a current tab plus a stack of pages pushed on top of it.
//
// Every move is a browser history entry, so the browser's Back does what the
// header's Back does. Each entry's state carries the whole route; a fresh load
// (a typed or shared URL, no state) derives it from the path instead.

import { useCallback, useEffect, useState } from "react";
import { APP_PATHS } from "../shared/api.ts";

export type TabId = "today" | "pacts" | "review" | "ledgers";

const TAB_PATHS: Record<TabId, string> = {
  today: APP_PATHS.today,
  pacts: APP_PATHS.pacts,
  review: APP_PATHS.review,
  ledgers: APP_PATHS.ledgers,
};

/**
 * A page pushed on top of a tab. A pact or ledger page may carry its name so
 * the header shows it before the page loads.
 */
export type Page =
  | { kind: "pact"; id: string; name?: string }
  | { kind: "create" }
  | { kind: "edit-pact"; id: string }
  | { kind: "change-pact"; id: string }
  | { kind: "change-request"; id: string }
  | { kind: "ledger"; recipientId: string; name?: string }
  | { kind: "excuse"; id: string }
  | { kind: "evidence"; id: string }
  | { kind: "payment"; id: string }
  | { kind: "notifications" }
  | { kind: "plan-vacation" }
  | { kind: "apple-health" };

interface Route {
  tab: TabId;
  stack: Page[];
}

interface Entry {
  route: Route;
  /** True when the app made this entry, so the one before it is the route without its top page. */
  inApp: boolean;
}

/** The address of `page`, for its history entry. */
export function pagePath(page: Page): string {
  switch (page.kind) {
    case "create":
      return APP_PATHS.newPact;
    case "pact":
      return APP_PATHS.pact(page.id);
    case "edit-pact":
      return APP_PATHS.editPact(page.id);
    case "change-pact":
      return APP_PATHS.changePact(page.id);
    case "change-request":
      return APP_PATHS.changeRequest(page.id);
    case "ledger":
      return APP_PATHS.ledger(page.recipientId);
    case "excuse":
      return APP_PATHS.excuse(page.id);
    case "evidence":
      return APP_PATHS.evidence(page.id);
    case "payment":
      return APP_PATHS.payment(page.id);
    case "notifications":
      return APP_PATHS.notifications;
    case "plan-vacation":
      return APP_PATHS.newVacation;
    case "apple-health":
      return APP_PATHS.appleHealth;
  }
}

function routePath(route: Route): string {
  const top = route.stack.at(-1);
  return top ? pagePath(top) : TAB_PATHS[route.tab];
}

/**
 * One of APP_PATHS as a pattern that matches it, capturing its id (the part
 * a path function encodes) when it has one.
 */
function pathPattern(path: string | ((id: string) => string)): RegExp {
  const ID = "\0";
  const text = typeof path === "string" ? path : path(ID);
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(encodeURIComponent(ID), "([^/]+)")}$`);
}

/**
 * The pages a fresh load can open, by path, each with its tab and the pages
 * under it. The first pattern that matches wins, so the new pact form comes
 * before a pact.
 */
const PAGE_ROUTES: { pattern: RegExp; route: (id: string) => Route }[] = [
  { pattern: pathPattern(APP_PATHS.newPact), route: () => ({ tab: "pacts", stack: [{ kind: "create" }] }) },
  {
    pattern: pathPattern(APP_PATHS.notifications),
    route: () => ({ tab: "today", stack: [{ kind: "notifications" }] }),
  },
  {
    pattern: pathPattern(APP_PATHS.newVacation),
    route: () => ({ tab: "today", stack: [{ kind: "plan-vacation" }] }),
  },
  // Apple Health setup opens from Profile, the create form and Today's alert.
  {
    pattern: pathPattern(APP_PATHS.appleHealth),
    route: () => ({ tab: "today", stack: [{ kind: "apple-health" }] }),
  },
  {
    pattern: pathPattern(APP_PATHS.editPact),
    route: (id) => ({
      tab: "pacts",
      stack: [
        { kind: "pact", id },
        { kind: "edit-pact", id },
      ],
    }),
  },
  {
    pattern: pathPattern(APP_PATHS.changePact),
    route: (id) => ({
      tab: "pacts",
      stack: [
        { kind: "pact", id },
        { kind: "change-pact", id },
      ],
    }),
  },
  // A change request opens from Today or its pact; a link to one lands on Today.
  {
    pattern: pathPattern(APP_PATHS.changeRequest),
    route: (id) => ({ tab: "today", stack: [{ kind: "change-request", id }] }),
  },
  { pattern: pathPattern(APP_PATHS.pact), route: (id) => ({ tab: "pacts", stack: [{ kind: "pact", id }] }) },
  {
    pattern: pathPattern(APP_PATHS.ledger),
    route: (recipientId) => ({ tab: "ledgers", stack: [{ kind: "ledger", recipientId }] }),
  },
  // An excuse opens from Today or a pact; a link to one (an approved excuse's push) lands on Today.
  { pattern: pathPattern(APP_PATHS.excuse), route: (id) => ({ tab: "today", stack: [{ kind: "excuse", id }] }) },
  // Evidence and payment pages open from a reviewer's question, on Today or in its push.
  { pattern: pathPattern(APP_PATHS.evidence), route: (id) => ({ tab: "today", stack: [{ kind: "evidence", id }] }) },
  { pattern: pathPattern(APP_PATHS.payment), route: (id) => ({ tab: "today", stack: [{ kind: "payment", id }] }) },
];

/** A path's id part as it was before encoding, or null when it isn't valid percent-encoding, like "%". */
function decodedId(part: string): string | null {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}

/** The route a path opens on a fresh load: a page, a tab's own screen, or Today for any other path. */
export function routeFromPath(pathname: string): Route {
  for (const { pattern, route } of PAGE_ROUTES) {
    const match = pattern.exec(pathname);
    if (!match) continue;
    const id = decodedId(match[1] ?? "");
    if (id !== null) return route(id);
  }
  const tab = (Object.keys(TAB_PATHS) as TabId[]).find((t) => TAB_PATHS[t] === pathname) ?? "today";
  return { tab, stack: [] };
}

/**
 * Whether a fresh load of `pathname` opens the Profile sheet over Today, as
 * a vacation's decision and questions do. Its route is Today's.
 */
export function opensProfileSheet(pathname: string): boolean {
  return pathname === APP_PATHS.profile;
}

const INVITE_PATTERN = pathPattern(APP_PATHS.invite);

/** The token of the invite link `pathname` is, or null. */
export function inviteTokenFromPath(pathname: string): string | null {
  const token = INVITE_PATTERN.exec(pathname)?.[1];
  return token === undefined ? null : decodedId(token);
}

function currentEntry(): Entry {
  const state = window.history.state as Partial<Entry> | null;
  if (state?.route) return { route: state.route, inApp: state.inApp === true };
  return { route: routeFromPath(window.location.pathname), inApp: false };
}

export function useNavigation() {
  const [entry, setEntry] = useState(currentEntry);

  useEffect(() => {
    const onPop = () => setEntry(currentEntry());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const go = useCallback((route: Route) => {
    const next: Entry = { route, inApp: true };
    window.history.pushState(next, "", routePath(route));
    setEntry(next);
  }, []);

  const swap = (next: Entry) => {
    window.history.replaceState(next, "", routePath(next.route));
    setEntry(next);
  };

  const { route, inApp } = entry;
  return {
    tab: route.tab,
    /** The page on top, or undefined on a tab's own screen. */
    page: route.stack.at(-1),
    /** Opens a tab's own screen; tapping the current tab while a page is pushed returns to it. */
    selectTab: (tab: TabId) => {
      if (tab !== route.tab || route.stack.length > 0) go({ tab, stack: [] });
    },
    push: (page: Page) => go({ tab: route.tab, stack: [...route.stack, page] }),
    /** Swaps the top page for another, so Back skips the one replaced (e.g. the create form, once the pact exists). */
    replace: (page: Page) => swap({ route: { tab: route.tab, stack: [...route.stack.slice(0, -1), page] }, inApp }),
    /** Replaces this entry with Today's own screen, so Back doesn't return to a page that's done. */
    replaceWithToday: () => swap({ route: { tab: "today", stack: [] }, inApp }),
    back: () => {
      if (inApp) return window.history.back();
      // Opened from a link: there's no app entry behind this one, so step up in place.
      swap({ route: { tab: route.tab, stack: route.stack.slice(0, -1) }, inApp: false });
    },
  };
}
