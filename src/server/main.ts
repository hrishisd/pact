// The server's entry point: one process for the SPA, the API, Better Auth,
// the Pact core and the scheduler.

import { mkdirSync, readFileSync, statfsSync, type StatsFs } from "node:fs";
import { dirname, join } from "node:path";
import { serve } from "@hono/node-server";
import { createPactCore, logNotifier, stubOuraSource, stubPhotoStore, systemClock } from "../core/index.ts";
import { createApp } from "./app.ts";
import { createAuth } from "./auth.ts";
import { loadConfig } from "./config.ts";
import { startLogFile } from "./log-file.ts";
import { startScheduler } from "./scheduler.ts";

const config = loadConfig();
const dataDir = dirname(config.dbPath);
mkdirSync(dataDir, { recursive: true });

// Before anything logs, so the boot lines are in the file too. Production: /data/logs/pact.log.
const logFile = startLogFile({ path: join(dataDir, "logs", "pact.log"), maxBytes: 10 * 1024 * 1024 });
// Node prints a crash's stack trace straight to the terminal, past process.stderr,
// so the file gets its own copy. A monitor only watches: Node still prints it and exits.
process.on("uncaughtExceptionMonitor", (error, origin) => logFile.append(`${origin}: ${error.stack ?? error}\n`));

// Native modules (better-sqlite3) are built per Node major, so another Node crashes on them.
// Development only: .nvmrc isn't in the image, whose Node is the Dockerfile's.
if (!config.production) {
  const pinned = readFileSync(join(import.meta.dirname, "..", "..", ".nvmrc"), "utf8").trim();
  if (pinned.split(".")[0] !== process.versions.node.split(".")[0]) {
    console.error(`Node ${process.versions.node} is running, but .nvmrc pins ${pinned}. Run under the pinned Node (fnm use).`);
    process.exit(1);
  }
}

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

const app = createApp({
  core,
  auth,
  staticDir: config.staticDir,
  canonicalOrigin: config.canonicalOrigin,
  diskUsedFraction: () => usedFraction(statfsSync(dataDir)),
  production: config.production,
  operatorEmail: config.operatorEmail,
});
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

/** As `df` counts it: blocks reserved for root are neither used nor available. */
function usedFraction({ blocks, bfree, bavail }: StatsFs): number {
  const used = blocks - bfree;
  return used / (used + bavail);
}
