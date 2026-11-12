import { afterEach, expect, test, vi } from "vitest";
import { api, signOut } from "./api.ts";
import { forgetLoaded, lastLoaded, loadAndRemember } from "./last-loaded.ts";

/** Every request gets `body` back as JSON, with `status`. */
function answerEvery(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })),
  );
}

/** Today's screen loaded something, so it's remembered. */
async function todayLoaded() {
  await loadAndRemember("/api/today", async () => "Monday's");
  expect(lastLoaded("/api/today")).toBe("Monday's");
}

afterEach(() => {
  vi.unstubAllGlobals();
  forgetLoaded();
});

test("a command the user sends forgets what the screens loaded, refused or not", async () => {
  const sends = [
    () => api.decide("item", { kind: "approve" }),
    () => api.submitEvidence("gym", [new Blob(["photo"])]),
    () => api.deletePact("gym"),
  ];
  for (const send of sends) {
    for (const [body, status] of [
      [{ ok: true }, 200],
      [{ ok: false, reason: "not-found" }, 200],
      [{ error: "internal" }, 500],
    ] as const) {
      answerEvery(body, status);
      await todayLoaded();
      await send().catch(() => undefined);
      expect(lastLoaded("/api/today")).toBeUndefined();
    }
  }
});

test("loads, checks the app runs by itself, and previews forget nothing", async () => {
  answerEvery({ ok: true });
  await todayLoaded();
  await api.today();
  await api.checkAnki();
  await api.checkOura();
  await api.firstOccurrence({ schedule: { kind: "fixed-days", days: ["mon"] } });
  await api.removePushSubscription("https://push.example/device");
  expect(lastLoaded("/api/today")).toBe("Monday's");
});

// Better Auth's client doesn't reach the stubbed fetch in Node, so signing out
// fails here; it forgets whether or not the sign-out went through.
test("signing out forgets what the screens loaded", async () => {
  await todayLoaded();
  await signOut().catch(() => undefined);
  expect(lastLoaded("/api/today")).toBeUndefined();
});
