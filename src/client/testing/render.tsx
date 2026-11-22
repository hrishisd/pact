// For the client's component tests (*.test.tsx, run in jsdom): render a
// screen with a user to drive it, and answer its api calls with typed stubs
// instead of a server.

import { cleanup, fireEvent, render, screen, type RenderResult } from "@testing-library/react";
import { userEvent, type UserEvent } from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, vi, type MockInstance } from "vitest";
import type { Json } from "../../shared/api.ts";
import type { PactTerms } from "../../shared/types.ts";
import { api, ApiError } from "../api.ts";
import { forgetLoaded, stopReloading } from "../last-loaded.ts";
import { PULL_THRESHOLD_PX } from "../pull-to-refresh.tsx";

type Api = typeof api;
type PactPage = Json<PactTerms>;
type Call = keyof Api;
type Answer<K extends Call> = Awaited<ReturnType<Api[K]>>;

/** An api call's stand-in: it answers with the call's own response type, or throws. */
type Stub<K extends Call> = (...args: Parameters<Api[K]>) => Promise<Answer<K>>;

/** A 500: what a failed load or send throws when it's on our side. */
export const onOurSide = new ApiError(500, undefined);

/**
 * A stub that answers each call with the next of `answers`, then the last
 * again: a value is the response, an error is thrown.
 */
export function answers<T>(...list: [T | Error, ...(T | Error)[]]): () => Promise<T> {
  let next = 0;
  return async () => {
    const answer = list[Math.min(next++, list.length - 1)]!;
    if (answer instanceof Error) throw answer;
    return answer;
  };
}

/**
 * Answers the api calls named in `stubs`. Any other call throws at once, so
 * a test can't pass on a call it didn't expect. Returns the spies, to check
 * what was sent.
 */
export function stubApi<S extends { [K in Call]?: Stub<K> }>(
  stubs: S,
): { [K in keyof S & Call]: MockInstance<Api[K]> } {
  const calls = api as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const spies: Record<string, MockInstance> = {};
  for (const call of Object.keys(api)) {
    const stub = (stubs as Record<string, (...args: unknown[]) => Promise<unknown>>)[call];
    spies[call] = vi.spyOn(calls, call).mockImplementation(
      stub ??
        (() => {
          throw new Error(`api.${call} isn't stubbed`);
        }),
    );
  }
  return spies as { [K in keyof S & Call]: MockInstance<Api[K]> };
}

/** A Camera pact's page: "Gym" on weekdays, its edit window closing at `editWindowClosesAt` (null: closed). */
export function cameraPact(editWindowClosesAt: string | null = null): PactPage {
  return {
    id: "gym",
    name: "Gym",
    description: "Me at the gym",
    evidenceKind: "camera",
    schedule: { kind: "fixed-days", days: ["mon", "tue", "wed", "thu", "fri"] },
    dueBy: null,
    startDate: null,
    endDate: null,
    penaltyCents: 500,
    recipient: { id: "sam", name: "Sam" },
    reviewers: [{ id: "ana", name: "Ana" }],
    reminders: [],
    firstOccurrence: { date: "2026-01-05", dueAt: "2026-01-06T05:00:00Z" },
    editWindowClosesAt,
    newTerms: null,
    waiting: [],
    history: { kind: "fixed-days", days: [] },
    connectionProblem: null,
    ending: null,
    stage: "active",
  };
}

/**
 * Drags one finger `finger` px down the tab's scroll area from its top, and
 * lets go. The content moves half as far: by default, just to the threshold,
 * so it refreshes.
 */
export function pullDown(finger = 2 * PULL_THRESHOLD_PX, scrollArea: HTMLElement = screen.getByRole("main")): void {
  fireEvent.touchStart(scrollArea, { touches: [{ clientY: 100 }] });
  fireEvent.touchMove(scrollArea, { touches: [{ clientY: 100 + finger / 2 }] });
  fireEvent.touchMove(scrollArea, { touches: [{ clientY: 100 + finger }] });
  fireEvent.touchEnd(scrollArea, { touches: [] });
}

/** Renders `ui` on the document, with a user who clicks and types through it. */
export function renderWithUser(ui: ReactElement): RenderResult & { user: UserEvent } {
  return { user: userEvent.setup(), ...render(ui) };
}

// jsdom lays nothing out, so it has no scrolling; the wizard scrolls each step into view.
Element.prototype.scrollIntoView = () => undefined;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  // Tests in one file share the module, so what one test loaded mustn't show in the next.
  stopReloading();
  forgetLoaded();
});
