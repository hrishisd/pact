// The dom project's setup file (vitest.config.ts): runs before every component
// test file, so each test starts on an empty document with real timers and no
// mocks, whether or not its file uses the helpers in render.tsx.

import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { forgetLoaded, stopReloading } from "../last-loaded.ts";

// jsdom lays nothing out, so it has no scrolling; the wizard scrolls each step into view.
Element.prototype.scrollIntoView = () => undefined;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  // Back to jsdom's own visibilityState, for a test that set it (`comeBackAt`, render.tsx).
  delete (document as { visibilityState?: unknown }).visibilityState;
  // Tests in one file share the module, so what one test loaded mustn't show in the next.
  stopReloading();
  forgetLoaded();
});
