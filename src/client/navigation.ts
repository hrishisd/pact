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
  | { kind: "ledger"; recipientId: string; name?: string }
  | { kind: "excuse"; id: string }
  | { kind: "notifications" };

interface Route {
  tab: TabId;
  stack: Page[];
}

interface Entry {
  route: Route;
  /** True when the app made this entry, so the one before it is the route without its top page. */
  inApp: boolean;
}

const NOTIFICATIONS_PATH = "/notifications";

function pagePath(page: Page): string {
  switch (page.kind) {
    case "create":
      return APP_PATHS.newPact;
    case "pact":
      return APP_PATHS.pact(page.id);
    case "edit-pact":
      return APP_PATHS.editPact(page.id);
    case "ledger":
      return APP_PATHS.ledger(page.recipientId);
    case "excuse":
      return APP_PATHS.excuse(page.id);
    case "notifications":
      return NOTIFICATIONS_PATH;
  }
}

function routePath(route: Route): string {
  const top = route.stack.at(-1);
  return top ? pagePath(top) : TAB_PATHS[route.tab];
}

function routeFromPath(pathname: string): Route {
  if (pathname === APP_PATHS.newPact) return { tab: "pacts", stack: [{ kind: "create" }] };
  if (pathname === NOTIFICATIONS_PATH) return { tab: "today", stack: [{ kind: "notifications" }] };
  const edit = /^\/pacts\/([^/]+)\/edit$/.exec(pathname);
  if (edit) {
    const id = decodeURIComponent(edit[1]!);
    return {
      tab: "pacts",
      stack: [
        { kind: "pact", id },
        { kind: "edit-pact", id },
      ],
    };
  }
  const pact = /^\/pacts\/([^/]+)$/.exec(pathname);
  if (pact) return { tab: "pacts", stack: [{ kind: "pact", id: decodeURIComponent(pact[1]!) }] };
  const ledger = /^\/ledgers\/([^/]+)$/.exec(pathname);
  if (ledger) return { tab: "ledgers", stack: [{ kind: "ledger", recipientId: decodeURIComponent(ledger[1]!) }] };
  // An excuse opens from Today or a pact; a link to one (an approved excuse's push) lands on Today.
  const excuse = /^\/excuses\/([^/]+)$/.exec(pathname);
  if (excuse) return { tab: "today", stack: [{ kind: "excuse", id: decodeURIComponent(excuse[1]!) }] };
  const tab = (Object.keys(TAB_PATHS) as TabId[]).find((t) => TAB_PATHS[t] === pathname) ?? "today";
  return { tab, stack: [] };
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
    back: () => {
      if (inApp) return window.history.back();
      // Opened from a link: there's no app entry behind this one, so step up in place.
      swap({ route: { tab: route.tab, stack: route.stack.slice(0, -1) }, inApp: false });
    },
  };
}
