// The browser smoke test (e2e/): one flow across screens, against the server
// in development on a fresh database, with its clock under the test's control
// (PACT_DEV_CLOCK=1). Run with `npm run test:e2e`; see docs/agents/local-dev.md.

import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

// Not the dev server's ports (3000, 5173), so a dev server can keep running.
const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;
// Deleted before each run, so every run starts from an empty database.
const DATA_DIR = join(tmpdir(), "pact-e2e");

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  forbidOnly: true,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    // The accounts confirm the timezone the browser reports.
    timezoneId: "America/New_York",
    locale: "en-US",
    trace: "retain-on-failure",
  },
  webServer: {
    // The built client, served by the server itself: no Vite, so no port shared with `npm run dev`.
    command: `rm -rf "${DATA_DIR}" && npm run build && npm start`,
    url: `${BASE_URL}/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NODE_ENV: "development",
      PORT: String(PORT),
      PACT_DB_PATH: join(DATA_DIR, "pact.db"),
      BETTER_AUTH_URL: BASE_URL,
      PACT_DEV_CLOCK: "1",
    },
  },
});
