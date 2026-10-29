// The HTTP surface: /health, Better Auth under /api/auth, the JSON API under
// /api, two plain sign-in error pages, and the built SPA with a fallback to
// index.html for client-side routes.

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
}

type Env = { Variables: { accountId: AccountId } };

export function createApp({ core, auth, staticDir }: AppOptions) {
  const app = new Hono<Env>();

  app.get("/health", (c) => {
    const health = core.health();
    const body: HealthResponse = { ok: health.ok, lastTick: health.lastTick?.toISOString() ?? null };
    return c.json(body, health.ok ? 200 : 503);
  });

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
