import { defineConfig } from "vitest/config";

// Two projects: the core, server, scripts and client logic run in Node; the
// client's component tests (*.test.tsx) get a DOM from jsdom.
export default defineConfig({
  test: {
    // Fixed whatever the shell exports: Better Auth switches on its rate limiter
    // (real clock, state shared across a file's servers) when NODE_ENV is production.
    env: { NODE_ENV: "test" },
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
          globalSetup: ["src/server/vitest-global-setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          include: ["src/client/**/*.test.tsx"],
          environment: "jsdom",
        },
      },
    ],
  },
});
