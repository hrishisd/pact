// Server configuration, read once from the environment at boot.
// See .env.example for every variable. In production (NODE_ENV=production)
// a missing required variable stops the server before it serves anything.

import { dirname, join } from "node:path";
import type { R2Bucket } from "../core/index.ts";

export interface Config {
  production: boolean;
  port: number;
  /**
   * SQLite file shared by the Pact core and Better Auth. Production: /data/pact.db.
   * Development: .dev-data.nosync/pact.db; iCloud Drive (the repo is in ~/Documents) skips `.nosync` names.
   */
  dbPath: string;
  /** The operator's Google email: the one account that needs no invite. */
  operatorEmail: string;
  google: { clientId: string; clientSecret: string };
  auth: {
    /** Signs session cookies. At least 32 random characters. */
    secret: string;
    /** The public origin the browser uses, e.g. https://pact.hrishisd.com. */
    url: string;
  };
  /**
   * Production only: the one origin the app answers on, BETTER_AUTH_URL's. Any
   * other host (e.g. the fly.dev one) redirects here, so sign-in starts on the
   * host its state cookie is checked on. Null in development, behind Vite's proxy.
   */
  canonicalOrigin: string | null;
  /** The built SPA (Vite output). */
  staticDir: string;
  /**
   * Where evidence photos are kept. Production: a private Cloudflare R2 bucket.
   * Development: `photos/` next to the database, so it needs no bucket.
   */
  photos: ({ kind: "r2" } & R2Bucket) | { kind: "local-disk"; dir: string };
  /**
   * The VAPID key pair that signs Web Push, base64url. Browsers subscribe with
   * the public one, so changing it needs every device to subscribe again.
   */
  vapid: { publicKey: string; privateKey: string };
  /**
   * The Oura OAuth app, and the key that encrypts its tokens in the database.
   * Optional: without OURA_CLIENT_ID it is null; with it, the secret and the key
   * are required too (in production; development has a default key). Null in
   * production means Oura isn't set up: connecting is refused and there is no
   * sleep. Null in development: connecting skips Oura, and sleep comes from a
   * file (see devOura).
   */
  oura: { clientId: string; clientSecret: string; tokenKey: string } | null;
  /**
   * Anki: the key that encrypts AnkiWeb host keys in the database, and the
   * Python with the pinned `anki` package (ANKI_PYTHON, default python3).
   * Optional: without ANKI_TOKEN_KEY it is null. Null in production means Anki
   * isn't set up: connecting is refused and nothing is checked. Null in
   * development: any login works, and decks come from a file (see devAnki).
   */
  anki: { tokenKey: string; python: string } | null;
  /**
   * The Gmail account made just for Pact that email is sent from, and its app
   * password. Required in production. Null in development without them: each
   * email is logged instead of sent (see devMailer).
   */
  gmail: { address: string; appPassword: string } | null;
  /** Set by the container entrypoint when Litestream restored the database on this boot. */
  restored: boolean;
  /**
   * Development only (PACT_DEV_CLOCK=1): the server's clock can be moved
   * forward through POST /api/dev/advance. Production refuses to start with it.
   */
  devClock: boolean;
  /** The commit CI built the image from, reported by /health. Null when built without one; never required. */
  commit: string | null;
}

const REPO_ROOT = join(import.meta.dirname, "..", "..");
// Development only, like the session secret's default: production must set its own.
const DEV_VAPID_PUBLIC_KEY = "BB1FrNQz4WK8C55DsNs9-4Uzw6_MBaV8x4WiAgnLnCW89DQFUhkLHm2Jsk1q-5G_OLqx2aVVZUTKKRh9AePO53A";
const DEV_VAPID_PRIVATE_KEY = "UQoUbfmAj8ZaiwNCrCw_cblSFYDxAk9uLNBh148hPZM";
const DEV_OURA_TOKEN_KEY = "ZGV2LW9ubHktb3VyYS10b2tlbi1rZXktMzItYnl0ZXM=";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === "production";
  const missing: string[] = [];

  /** Required in production; in development falls back to `devDefault`. */
  const read = (name: string, devDefault: string): string => {
    const value = env[name]?.trim();
    if (value) return value;
    if (production) missing.push(name);
    return devDefault;
  };

  const port = Number(env.PORT ?? 3000);
  const dbPath = read("PACT_DB_PATH", join(REPO_ROOT, ".dev-data.nosync", "pact.db"));
  const config: Config = {
    production,
    port,
    dbPath,
    operatorEmail: read("OPERATOR_EMAIL", "operator@example.test"),
    google: {
      clientId: read("GOOGLE_CLIENT_ID", "dev-google-client-id"),
      clientSecret: read("GOOGLE_CLIENT_SECRET", "dev-google-client-secret"),
    },
    auth: {
      secret: read("BETTER_AUTH_SECRET", "dev-only-secret-not-for-production-use-0123456789"),
      // In development the browser talks to the Vite dev server, which proxies /api here.
      url: read("BETTER_AUTH_URL", "http://localhost:5173"),
    },
    canonicalOrigin: null,
    staticDir: env.PACT_STATIC_DIR?.trim() || join(REPO_ROOT, "dist", "client"),
    photos: production
      ? {
          kind: "r2",
          bucket: read("PHOTOS_BUCKET", ""),
          endpoint: read("PHOTOS_ENDPOINT", ""),
          accessKeyId: read("PHOTOS_ACCESS_KEY_ID", ""),
          secretAccessKey: read("PHOTOS_SECRET_ACCESS_KEY", ""),
        }
      : { kind: "local-disk", dir: join(dirname(dbPath), "photos") },
    vapid: {
      publicKey: read("VAPID_PUBLIC_KEY", DEV_VAPID_PUBLIC_KEY),
      privateKey: read("VAPID_PRIVATE_KEY", DEV_VAPID_PRIVATE_KEY),
    },
    oura: env.OURA_CLIENT_ID?.trim()
      ? {
          clientId: read("OURA_CLIENT_ID", ""),
          clientSecret: read("OURA_CLIENT_SECRET", ""),
          tokenKey: read("OURA_TOKEN_KEY", DEV_OURA_TOKEN_KEY),
        }
      : null,
    anki: env.ANKI_TOKEN_KEY?.trim()
      ? { tokenKey: env.ANKI_TOKEN_KEY.trim(), python: env.ANKI_PYTHON?.trim() || "python3" }
      : null,
    gmail:
      production || env.GMAIL_ADDRESS?.trim() || env.GMAIL_APP_PASSWORD?.trim()
        ? {
            address: read("GMAIL_ADDRESS", ""),
            // Google shows an app password in groups of four; Gmail takes it without the spaces.
            appPassword: read("GMAIL_APP_PASSWORD", "").replace(/\s+/g, ""),
          }
        : null,
    restored: env.PACT_RESTORED === "1",
    commit: env.PACT_COMMIT?.trim() || null,
    devClock: env.PACT_DEV_CLOCK === "1",
  };

  if (missing.length > 0) {
    throw new Error(`missing required environment variables: ${missing.join(", ")}`);
  }
  if (production && env.PACT_DEV_CLOCK !== undefined) {
    throw new Error("PACT_DEV_CLOCK is for development only: unset it in production");
  }
  if (production) config.canonicalOrigin = new URL(config.auth.url).origin;
  if (!Number.isInteger(port) || port <= 0) throw new Error(`PORT is not a port number: ${env.PORT}`);
  if (config.oura && Buffer.from(config.oura.tokenKey, "base64").length !== 32) {
    throw new Error("OURA_TOKEN_KEY must be 32 bytes, base64");
  }
  if (config.anki && Buffer.from(config.anki.tokenKey, "base64").length !== 32) {
    throw new Error("ANKI_TOKEN_KEY must be 32 bytes, base64");
  }
  if (config.gmail && !(config.gmail.address && config.gmail.appPassword)) {
    throw new Error("GMAIL_ADDRESS and GMAIL_APP_PASSWORD go together: set both, or neither in development");
  }
  if (production && config.auth.secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must be at least 32 characters");
  }
  return config;
}
