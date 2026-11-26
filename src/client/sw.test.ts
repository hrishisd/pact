// The service worker, run as a browser would run it: a push shows a
// notification, and tapping one opens its page.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, test } from "vitest";

const SOURCE = readFileSync(join(import.meta.dirname, "public", "sw.js"), "utf8");

type Handler = (event: object) => void;

/** What the browser can do with the app icon's badge: set it, clear it, or nothing at all (null). */
interface AppBadge {
  setAppBadge: (count: number) => Promise<void>;
  clearAppBadge: () => Promise<void>;
}

/**
 * Loads the worker, with these windows of the app already showing, in a
 * browser whose `navigator` can badge the app's icon, or (`{}`) can't, or
 * (null) with none at all.
 * `fire` resolves once the event's work is done.
 */
function worker(
  openWindows: { focus: () => Promise<void>; navigate: (url: string) => Promise<void> }[] = [],
  navigator: AppBadge | object | null = { setAppBadge: async () => {}, clearAppBadge: async () => {} },
) {
  const handlers = new Map<string, Handler>();
  const shown: [string, { body: string; data: { url: string } }][] = [];
  const opened: string[] = [];
  const self = {
    addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
    registration: {
      showNotification: async (title: string, options: { body: string; data: { url: string } }) => {
        shown.push([title, options]);
      },
    },
    clients: {
      matchAll: async () => openWindows,
      openWindow: async (url: string) => opened.push(url),
    },
    ...(navigator !== null && { navigator }),
  };
  runInNewContext(SOURCE, { self });
  const fire = async (type: string, event: object) => {
    const work: Promise<unknown>[] = [];
    handlers.get(type)!({ ...event, waitUntil: (promise: Promise<unknown>) => work.push(promise) });
    await Promise.all(work);
  };
  return { fire, shown, opened };
}

const tap = (url: string) => ({ notification: { close: () => {}, data: { url } } });

test("a push shows its title and body, and remembers the page it opens", async () => {
  const { fire, shown } = worker();
  const message = { title: "Sam submitted evidence", body: "Gym · Mon Jan 5", url: "/review" };

  await fire("push", { data: { json: () => message } });

  expect(shown).toHaveLength(1);
  expect(shown[0]![0]).toBe("Sam submitted evidence");
  expect(shown[0]![1]).toMatchObject({ body: "Gym · Mon Jan 5", data: { url: "/review" } });
});

test("a push with no data still shows a notification, which iPhone requires of every push", async () => {
  const { fire, shown } = worker();

  await fire("push", {});

  expect(shown.map(([title]) => title)).toEqual(["Pact"]);
});

test("a push whose data isn't JSON, or is empty, still shows a notification", async () => {
  const { fire, shown } = worker();

  await fire("push", { data: { json: () => JSON.parse("hello") } });
  await fire("push", { data: { json: () => JSON.parse("") } });

  expect(shown.map(([title]) => title)).toEqual(["Pact", "Pact"]);
});

describe("the app icon's badge", () => {
  const push = (badge: unknown) => ({
    data: { json: () => ({ title: "Sam submitted evidence", body: "", url: "/", badge }) },
  });
  function badgeCalls() {
    const calls: string[] = [];
    return {
      calls,
      badge: {
        setAppBadge: async (count: number) => void calls.push(`set ${count}`),
        clearAppBadge: async () => void calls.push("clear"),
      },
    };
  }

  test("a push sets it to the count it carries, and clears it at 0", async () => {
    const { calls, badge } = badgeCalls();
    const { fire, shown } = worker([], badge);

    await fire("push", push(3));
    await fire("push", push(0));

    expect(calls).toEqual(["set 3", "clear"]);
    expect(shown).toHaveLength(2);
  });

  test("a push with no count leaves it as it is", async () => {
    const { calls, badge } = badgeCalls();
    const { fire, shown } = worker([], badge);

    await fire("push", push(undefined));
    await fire("push", push("3"));
    await fire("push", {});

    expect(calls).toEqual([]);
    expect(shown).toHaveLength(3);
  });

  test("a browser that can't badge the icon still shows the notification", async () => {
    const { fire, shown } = worker([], {});

    await fire("push", push(3));

    expect(shown).toHaveLength(1);
  });

  test("even with no navigator at all, the notification shows", async () => {
    const { fire, shown } = worker([], null);

    await fire("push", push(3));

    expect(shown).toHaveLength(1);
  });

  test("a badge that fails, refused or thrown, still shows the notification, which iPhone requires of every push", async () => {
    const { fire, shown } = worker([], {
      setAppBadge: () => Promise.reject(new Error("NotAllowedError")),
      clearAppBadge: () => {
        throw new Error("NotAllowedError");
      },
    });

    await fire("push", push(3));
    await fire("push", push(0));

    expect(shown).toHaveLength(2);
  });
});

test("tapping with no window open opens the page", async () => {
  const { fire, opened } = worker();

  await fire("notificationclick", tap("/review"));

  expect(opened).toEqual(["/review"]);
});

test("tapping with a window open brings it forward and takes it to the page", async () => {
  const calls: string[] = [];
  const { fire, opened } = worker([
    {
      focus: async () => void calls.push("focus"),
      navigate: async (url) => void calls.push(`navigate ${url}`),
    },
  ]);

  await fire("notificationclick", tap("/pacts/gym"));

  expect(calls).toEqual(["focus", "navigate /pacts/gym"]);
  expect(opened).toEqual([]);
});
