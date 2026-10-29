// Google sign-in, through Better Auth, inside the server.
//
// Better Auth owns sessions and its own tables (auth_user, auth_account,
// auth_session, auth_verification), kept in the same SQLite file as the Pact core on a
// connection of its own. The Pact core decides who may have an account:
// before Better Auth creates a user, it asks `core.signIn`, and when the core
// refuses, the hook throws. The user row and the account row are written in
// one Better Auth transaction after this hook, so a refusal leaves no user,
// account or session row behind. Better Auth turns the thrown error into a
// redirect to the error URL with `?error=invite_required`.
//
// Sign-in from an invite link carries the link's token in the OAuth state
// (`additionalData` on sign-in, see INVITE_TOKEN_SIGN_IN_KEY), which Better
// Auth keeps bound to this browser's flow across Google's redirect. The hook
// reads it back and passes it to the core, which decides whether it is still
// usable. The client supplies it, which is fine: an invite token is itself the
// credential, and the core checks it.
//
// Development only: `devSignIn` below signs in without Google, for agents and
// local testing (see docs/agents/local-dev.md). It is server-only (no HTTP
// route of Better Auth's own); app.ts calls it from /api/dev/sign-in, a route
// that exists only outside production.

import { APIError, betterAuth } from "better-auth";
import { createAuthEndpoint, getOAuthState } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { getMigrations } from "better-auth/db/migration";
import type { PactCore } from "../core/index.ts";
import { openWithPragmas } from "../core/db.ts";
import { AUTH_BASE_PATH, AUTH_ERROR_PATH, INVITE_TOKEN_SIGN_IN_KEY } from "../shared/api.ts";

/** The `error` code Better Auth puts on the error redirect when the core refuses a sign-in. */
export const INVITE_REQUIRED_CODE = "invite_required";

export interface AuthOptions {
  core: PactCore;
  dbPath: string;
  secret: string;
  /** Public origin, e.g. https://pact.hrishisd.com. */
  baseURL: string;
  google: { clientId: string; clientSecret: string };
}

const DAY_SECONDS = 24 * 60 * 60;

export function createAuth(options: AuthOptions) {
  const { core } = options;
  const db = openWithPragmas(options.dbPath);

  const config = {
    database: db,
    secret: options.secret,
    baseURL: options.baseURL,
    basePath: AUTH_BASE_PATH,
    trustedOrigins: [new URL(options.baseURL).origin],
    socialProviders: {
      google: {
        clientId: options.google.clientId,
        clientSecret: options.google.clientSecret,
        prompt: "select_account" as const,
        // Sign-in is only through Google's redirect, never a posted id token.
        disableIdTokenSignIn: true,
      },
    },
    // The core owns the unprefixed names (its `account` table is a Pact account).
    user: { modelName: "auth_user" },
    account: { modelName: "auth_account" },
    session: {
      modelName: "auth_session",
      // Long-lived and self-renewing: each day of use pushes expiry out to 60 days.
      expiresIn: 60 * DAY_SECONDS,
      updateAge: DAY_SECONDS,
    },
    verification: { modelName: "auth_verification" },
    // Google is the only way in: no email/password, no account linking to other providers.
    emailAndPassword: { enabled: false },
    onAPIError: { errorURL: AUTH_ERROR_PATH },
    databaseHooks: {
      user: {
        create: {
          before: async (user: { email: string; name: string }) => {
            const inviteToken = (await getOAuthState())?.[INVITE_TOKEN_SIGN_IN_KEY];
            const result = await core.signIn(
              { email: user.email, name: user.name },
              typeof inviteToken === "string" ? { inviteToken } : {},
            );
            if (!result.ok) {
              throw new APIError("FORBIDDEN", {
                code: INVITE_REQUIRED_CODE,
                message: "Pact is invite-only. You need an invite to sign in.",
              });
            }
          },
        },
      },
    },
    plugins: [devSignInPlugin(core)],
    telemetry: { enabled: false },
  };

  const auth = betterAuth(config);

  return {
    auth,
    /** Creates or updates Better Auth's tables. Run on every boot, before serving. */
    async migrate(): Promise<void> {
      const { runMigrations } = await getMigrations(config);
      await runMigrations();
    },
    close(): void {
      db.close();
    },
  };
}

/**
 * DEVELOPMENT ONLY. Signs `email` in without Google: through the same core
 * gate (the operator, or a usable invite token, which this claims), then a
 * real Better Auth user and session, so every other route works unchanged.
 * SERVER_ONLY keeps it off Better Auth's HTTP router: only `auth.api` reaches
 * it, and app.ts mounts its caller only outside production.
 */
function devSignInPlugin(core: PactCore) {
  return {
    id: "pact-dev-sign-in",
    endpoints: {
      devSignIn: createAuthEndpoint(
        "/dev/sign-in",
        { method: "POST", body: devSignInBody, metadata: { SERVER_ONLY: true } },
        async (ctx) => {
          const { email, name, inviteToken } = ctx.body;
          const result = await core.signIn({ email, name }, inviteToken === undefined ? {} : { inviteToken });
          if (!result.ok) throw new APIError("FORBIDDEN", { code: INVITE_REQUIRED_CODE });
          // The core has the account now, so the create hook's own core.signIn finds it and agrees.
          const user =
            (await ctx.context.internalAdapter.findUserByEmail(email))?.user ??
            (await ctx.context.internalAdapter.createUser({ email, name, emailVerified: true }, { method: "dev-sign-in" }));
          const session = await ctx.context.internalAdapter.createSession(user.id);
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ ok: true });
        },
      ),
    },
  };
}

interface DevSignInBody {
  email: string;
  name: string;
  inviteToken?: string;
}

/** A Standard Schema (what Better Auth takes for a body) for DevSignInBody, without a schema library. */
const devSignInBody = {
  "~standard": {
    version: 1 as const,
    vendor: "pact",
    validate: (value: unknown) => {
      const body = value as Partial<Record<keyof DevSignInBody, unknown>> | null;
      const valid =
        typeof body?.email === "string" &&
        typeof body.name === "string" &&
        (body.inviteToken === undefined || typeof body.inviteToken === "string");
      return valid ? { value: value as DevSignInBody } : { issues: [{ message: "expected { email, name, inviteToken? }" }] };
    },
    // Type-only, for inference.
    types: undefined as unknown as { input: DevSignInBody; output: DevSignInBody },
  },
};

export type Auth = ReturnType<typeof createAuth>["auth"];
