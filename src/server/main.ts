// The server's entry point: one process for the SPA, the API, Better Auth,
// the Pact core and the scheduler.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { serve } from "@hono/node-server";
import { createPactCore, logNotifier, stubOuraSource, stubPhotoStore, systemClock } from "../core/index.ts";
import { createApp } from "./app.ts";
import { createAuth } from "./auth.ts";
import { loadConfig } from "./config.ts";
import { startScheduler } from "./scheduler.ts";

const config = loadConfig();
mkdirSync(dirname(config.dbPath), { recursive: true });

const core = createPactCore({
  dbPath: config.dbPath,
  clock: systemClock,
  notifier: logNotifier(),
  ouraSource: stubOuraSource,
  photoStore: stubPhotoStore,
  operatorEmail: config.operatorEmail,
});

const { auth, migrate, close: closeAuth } = createAuth({
  core,
  dbPath: config.dbPath,
  secret: config.auth.secret,
  baseURL: config.auth.url,
  google: config.google,
});
await migrate();

// Before the first tick, so the alert reports the restored database's last tick, not this boot's.
if (config.restored) await core.raiseRestoreAlert();

const scheduler = startScheduler(core, systemClock);

const app = createApp({ core, auth, staticDir: config.staticDir });
const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(
    `pact listening on :${info.port} (${config.production ? "production" : "development"}, db ${config.dbPath})`,
  );
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal}: shutting down`);
  // Stop accepting requests; don't wait more than a few seconds on open keep-alive connections.
  await Promise.race([
    new Promise<void>((resolve) => server.close(() => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5000).unref()),
  ]);
  await scheduler.stop();
  await core.close();
  closeAuth();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
