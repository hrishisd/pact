import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    globalSetup: ["src/server/vitest-global-setup.ts"],
    // Fixed whatever the shell exports: Better Auth switches on its rate limiter
    // (real clock, state shared across a file's servers) when NODE_ENV is production.
    env: { NODE_ENV: "test" },
  },
});
