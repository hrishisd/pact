// The HTTP surface: /health and /healthz, a redirect to the canonical host,
// Better Auth under /api/auth, the JSON API under /api, two plain sign-in error
// pages, and the built SPA with a fallback to index.html for client-side routes.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono, type Context } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import type { AccountId, PactCore } from "../core/index.ts";
import {
  API_PATHS,
  AUTH_BASE_PATH,
  AUTH_ERROR_PATH,
  INVITE_REQUIRED_PATH,
  type ApiErrorResponse,
  type HealthResponse,
  type LivenessResponse,
  type MeResponse,
  type SetTimezoneRequest,
  type SetTimezoneResponse,
  type TodayResponse,
} from "../shared/api.ts";
import { INVITE_REQUIRED_CODE, type Auth } from "./auth.ts";
import { inviteRequiredPage, signInFailedPage } from "./pages.ts";

export interface AppOptions {
  core: PactCore;
  auth: Auth;
  /** The Vite build output. When it has no index.html, only the API is served. */
  staticDir: string;
  /** Requests on any other host redirect here; null serves every host. See Config. */
  canonicalOrigin: string | null;
  /** How full the database's volume is, from 0 to 1. Production asks the filesystem; tests pass a fake. */
  diskUsedFraction: () => number;
}

/** /health fails once the volume is fuller than this (ADR 0003). */
const MAX_DISK_USED_FRACTION = 0.8;

type Env = { Variables: { accountId: AccountId } };

export function createApp({ core, auth, staticDir, canonicalOrigin, diskUsedFraction }: AppOptions) {
  const app = new Hono<Env>();

  // Liveness, for Fly's check: the process serves and the database answers.
  // It ignores the scheduler and the disk, so a stuck scheduler or a filling
  // volume alerts via /health instead of taking the only machine out of rotation.
  app.get("/healthz", (c) => {
    core.lastTick();
    const body: LivenessResponse = { ok: true };
    return c.json(body);
  });
  // For the uptime monitor: the scheduler is ticking and the volume has room.
  app.get("/health", (c) => {
    const health = core.health();
    const diskUsed = diskUsedFraction();
    const body: HealthResponse = {
      ok: health.ok && diskUsed <= MAX_DISK_USED_FRACTION,
      lastTick: health.lastTick?.toISOString() ?? null,
      diskUsedPercent: Math.round(diskUsed * 1000) / 10,
    };
    return c.json(body, body.ok ? 200 : 503);
  });

  // The health routes above answer on any host: Fly's check and the uptime
  // monitor may not use the canonical one. Behind Fly's proxy the request URL's
  // host is the browser's Host header.
  if (canonicalOrigin !== null) {
    const canonical = new URL(canonicalOrigin);
    app.use("*", async (c, next) => {
      const url = new URL(c.req.url);
      if (url.hostname === canonical.hostname) return next();
      // 308, unlike 301, keeps a POST a POST.
      const status = c.req.method === "GET" || c.req.method === "HEAD" ? 301 : 308;
      return c.redirect(`${canonical.origin}${url.pathname}${url.search}`, status);
    });
  }

  app.on(["GET", "POST"], `${AUTH_BASE_PATH}/*`, (c) => auth.handler(c.req.raw));

  // Every other /api route is made as the signed-in account. Better Auth
  // creates a user only after the core has made the account (see auth.ts), so
  // a session's email always finds one; this is a read, never a sign-in.
  app.use("/api/*", async (c, next) => {
    const { headers, response: session } = await auth.api.getSession({
      headers: c.req.raw.headers,
      returnHeaders: true,
    });
    // A session that was renewed comes back with a fresh cookie: pass it on.
    for (const cookie of headers.getSetCookie()) c.header("Set-Cookie", cookie, { append: true });
    const accountId = session && core.accountIdForEmail(session.user.email);
    if (!accountId) return apiError(c, 401, "unauthenticated");
    c.set("accountId", accountId);
    await next();
  });

  app.get(API_PATHS.me, (c) => {
    const body: MeResponse = core.as(c.get("accountId")).profile();
    return c.json(body);
  });

  // A refused zone is a result, not an error: 200 either way.
  app.post(API_PATHS.timezone, async (c) => {
    const request = (await c.req.json().catch(() => null)) as Partial<SetTimezoneRequest> | null;
    if (typeof request?.timezone !== "string") return apiError(c, 400, "invalid-request");
    const result: SetTimezoneResponse = await core.as(c.get("accountId")).setTimezone(request.timezone);
    return c.json(result);
  });

  app.get(API_PATHS.today, (c) => {
    const body: TodayResponse = core.as(c.get("accountId")).today();
    return c.json(body);
  });

  app.all("/api/*", (c) => apiError(c, 404, "not-found"));

  // Better Auth redirects here, with ?error=<code>, when a sign-in fails.
  app.get(AUTH_ERROR_PATH, (c) =>
    c.req.query("error") === INVITE_REQUIRED_CODE
      ? c.redirect(INVITE_REQUIRED_PATH)
      : c.html(signInFailedPage(), 400),
  );
  app.get(INVITE_REQUIRED_PATH, (c) => c.html(inviteRequiredPage(), 403));

  // The SPA. Hashed build assets are immutable; everything else (index.html,
  // the manifest, icons, the client-route fallback) revalidates.
  app.use("*", async (c, next) => {
    await next();
    if (!c.res.ok) return;
    c.header("Cache-Control", c.req.path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
  });
  app.use("*", serveStatic({ root: staticDir }));
  // An asset this build doesn't have gets a 404, not the SPA fallback.
  app.get("/assets/*", (c) => c.notFound());
  const indexHtml = readIndexHtml(staticDir);
  app.get("*", (c) =>
    indexHtml === null
      ? c.text("The client isn't built. Run `npm run build`, or use `npm run dev`.", 404)
      : c.html(indexHtml),
  );

  return app;
}

function apiError(c: Context, status: 400 | 401 | 404, error: ApiErrorResponse["error"]) {
  const body: ApiErrorResponse = { error };
  return c.json(body, status);
}

function readIndexHtml(staticDir: string): string | null {
  try {
    return readFileSync(join(staticDir, "index.html"), "utf8");
  } catch {
    return null;
  }
}
