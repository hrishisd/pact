// The service worker, run as a browser would run it: a push shows a
// notification, and tapping one opens its page.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, test } from "vitest";

const SOURCE = readFileSync(join(import.meta.dirname, "public", "sw.js"), "utf8");

type Handler = (event: object) => void;

/** Loads the worker, with these windows of the app already showing. `fire` resolves once the event's work is done. */
function worker(openWindows: { focus: () => Promise<void>; navigate: (url: string) => Promise<void> }[] = []) {
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
