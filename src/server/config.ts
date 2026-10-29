// Server configuration, read once from the environment at boot.
// See .env.example for every variable. In production (NODE_ENV=production)
// a missing required variable stops the server before it serves anything.

import { join } from "node:path";

export interface Config {
  production: boolean;
  port: number;
  /** SQLite file shared by the Pact core and Better Auth. Production: /data/pact.db. */
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
  /** Set by the container entrypoint when Litestream restored the database on this boot. */
  restored: boolean;
}

const REPO_ROOT = join(import.meta.dirname, "..", "..");

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
  const config: Config = {
    production,
    port,
    dbPath: read("PACT_DB_PATH", join(REPO_ROOT, ".dev-data", "pact.db")),
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
    restored: env.PACT_RESTORED === "1",
  };

  if (missing.length > 0) {
    throw new Error(`missing required environment variables: ${missing.join(", ")}`);
  }
  if (production) config.canonicalOrigin = new URL(config.auth.url).origin;
  if (!Number.isInteger(port) || port <= 0) throw new Error(`PORT is not a port number: ${env.PORT}`);
  if (production && config.auth.secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must be at least 32 characters");
  }
  return config;
}
