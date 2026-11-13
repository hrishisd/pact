// The server's entry point: one process for the SPA, the API, Better Auth,
// the Pact core and the scheduler.

import { mkdirSync, readFileSync, statfsSync, type StatsFs } from "node:fs";
import { dirname, join } from "node:path";
import { serve } from "@hono/node-server";
import {
  ankiAdapter,
  createPactCore,
  devAnki,
  devMailer,
  devOura,
  gmailMailer,
  localDiskPhotoStore,
  offsetClock,
  operatorAlerts,
  ouraAdapter,
  r2PhotoStore,
  systemClock,
  unavailableAnki,
  unavailableOura,
  webPushNotifier,
  type AnkiAdapter,
  type OuraAdapter,
} from "../core/index.ts";
import { createApp } from "./app.ts";
import { createAuth } from "./auth.ts";
import { loadConfig } from "./config.ts";
import { startLogFile } from "./log-file.ts";
import { exitUnlessNativeBinaryLoads } from "./native-binary.ts";
import { startScheduler } from "./scheduler.ts";
import { API_PATHS } from "../shared/api.ts";

const config = loadConfig();
// Development with PACT_DEV_CLOCK=1 (the browser smoke test): a clock POST
// /api/dev/advance moves forward. loadConfig refuses it in production.
const devClock = config.devClock ? offsetClock() : null;
const clock = devClock ?? systemClock;
const dataDir = dirname(config.dbPath);
mkdirSync(dataDir, { recursive: true });

// Before anything logs, so the boot lines are in the file too. Production: /data/logs/pact.log.
const logFile = startLogFile({
  path: join(dataDir, "logs", "pact.log"),
  maxBytes: 10 * 1024 * 1024,
  clock: systemClock,
});
// Node prints a crash's stack trace straight to the terminal, past process.stderr,
// so the file gets its own copy. A monitor only watches: Node still prints it and exits.
process.on("uncaughtExceptionMonitor", (error, origin) => logFile.append(`${origin}: ${error.stack ?? error}\n`));

// Native modules (better-sqlite3) are built per Node major, so another Node crashes on them.
// Development only: .nvmrc isn't in the image, whose Node is the Dockerfile's.
if (!config.production) {
  const pinned = readFileSync(join(import.meta.dirname, "..", "..", ".nvmrc"), "utf8").trim();
  if (pinned.split(".")[0] !== process.versions.node.split(".")[0]) {
    console.error(
      `Node ${process.versions.node} is running, but .nvmrc pins ${pinned}. Run under the pinned Node (fnm use).`,
    );
    process.exit(1);
  }
  exitUnlessNativeBinaryLoads();
}

// Production refuses to start without a Gmail account (loadConfig); development without one logs each email.
const mailer = config.gmail ? gmailMailer(config.gmail) : devMailer((line) => console.log(line));
// The one operator alert path, for the core and the adapters: the log line and the email, apart from the outbox.
const alerts = operatorAlerts({
  mailer,
  operatorEmail: config.operatorEmail,
  log: (line) => console.log(line),
});

// Production without Oura credentials gets no connector (connecting is refused)
// and a source with no sleep; only development falls back to the stand-in.
const oura: OuraAdapter | null = config.oura
  ? ouraAdapter(
      config.dbPath,
      { ...config.oura, redirectUri: new URL(API_PATHS.ouraCallback, config.auth.url).toString() },
      clock,
      { raiseOperatorAlert: alerts.raise },
    )
  : config.production
    ? null
    : devOura(dataDir, API_PATHS.ouraCallback);

// As for Oura: production without an Anki token key gets no connector and nothing to check;
// only development falls back to the stand-in. Collection copies live on the volume, outside pact.db.
const anki: AnkiAdapter | null = config.anki
  ? ankiAdapter(config.dbPath, { tokenKey: config.anki.tokenKey, collectionsDir: join(dataDir, "anki") }, clock, {
      python: config.anki.python,
      raiseOperatorAlert: alerts.raise,
    })
  : config.production
    ? null
    : devAnki(dataDir, clock);

const core = createPactCore({
  dbPath: config.dbPath,
  clock,
  notifier: webPushNotifier({ ...config.vapid, subject: `mailto:${config.operatorEmail}` }, clock),
  mailer,
  appUrl: config.auth.url,
  raiseOperatorAlert: alerts.raise,
  ouraSource: oura ?? unavailableOura,
  ankiSource: anki ?? unavailableAnki,
  photoStore:
    config.photos.kind === "r2" ? r2PhotoStore(config.photos, clock) : localDiskPhotoStore(config.photos.dir, clock),
  operatorEmail: config.operatorEmail,
});

const {
  auth,
  migrate,
  close: closeAuth,
} = createAuth({
  core,
  dbPath: config.dbPath,
  secret: config.auth.secret,
  baseURL: config.auth.url,
  google: config.google,
});
await migrate();

// Before the first tick, so the alert reports the restored database's last tick, not this boot's.
// It waits for the push's delivery but not the email, which shutdown waits for.
if (config.restored) await core.raiseRestoreAlert();

const scheduler = startScheduler(core, clock);

const app = createApp({
  core,
  auth,
  staticDir: config.staticDir,
  canonicalOrigin: config.canonicalOrigin,
  commit: config.commit,
  diskUsedFraction: () => usedFraction(statfsSync(dataDir)),
  production: config.production,
  operatorEmail: config.operatorEmail,
  vapidPublicKey: config.vapid.publicKey,
  oura,
  anki,
  devClock,
});
const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(
    `pact listening on :${info.port} (${config.production ? "production" : "development"}, db ${config.dbPath}, schema ${core.schemaVersion()})`,
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
  // An email still sending (an operator alert, a daily summary) gets a few seconds, so it isn't lost mid-send,
  // but can't hold up the stop. A daily summary cut off is tried again by the next run's tick.
  await Promise.race([
    Promise.all([alerts.settled(), core.emailsSettled()]),
    new Promise<void>((resolve) => setTimeout(resolve, 3000).unref()),
  ]);
  await core.close();
  oura?.close();
  anki?.close();
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
