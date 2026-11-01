// Where photos go: a private R2 bucket in production, local disk in development.

import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { loadConfig } from "./config.ts";

/** Every variable production requires apart from the photo bucket's. */
const PRODUCTION = {
  NODE_ENV: "production",
  PACT_DB_PATH: "/data/pact.db",
  OPERATOR_EMAIL: "operator@example.test",
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
  BETTER_AUTH_SECRET: "a-production-secret-at-least-32-characters-long",
  BETTER_AUTH_URL: "https://pact.example.test",
  VAPID_PUBLIC_KEY: "vapid-public",
  VAPID_PRIVATE_KEY: "vapid-private",
};

const PHOTOS_BUCKET = {
  PHOTOS_BUCKET: "pact-photos",
  PHOTOS_ENDPOINT: "https://0123abcd.r2.cloudflarestorage.com",
  PHOTOS_ACCESS_KEY_ID: "access-key-id",
  PHOTOS_SECRET_ACCESS_KEY: "secret-access-key",
};

describe("photo store", () => {
  test("production stores photos in the R2 bucket the environment names", () => {
    const config = loadConfig({ ...PRODUCTION, ...PHOTOS_BUCKET });

    expect(config.photos).toEqual({
      kind: "r2",
      bucket: "pact-photos",
      endpoint: "https://0123abcd.r2.cloudflarestorage.com",
      accessKeyId: "access-key-id",
      secretAccessKey: "secret-access-key",
    });
  });

  test("production refuses to start without the photo bucket", () => {
    expect(() => loadConfig(PRODUCTION)).toThrow(
      "missing required environment variables: PHOTOS_BUCKET, PHOTOS_ENDPOINT, PHOTOS_ACCESS_KEY_ID, PHOTOS_SECRET_ACCESS_KEY",
    );
  });

  test("production refuses to start without its own VAPID keys", () => {
    const { VAPID_PUBLIC_KEY: _public, VAPID_PRIVATE_KEY: _private, ...withoutKeys } = PRODUCTION;
    expect(() => loadConfig({ ...withoutKeys, ...PHOTOS_BUCKET })).toThrow(
      "missing required environment variables: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY",
    );
  });

  test("development stores photos on disk next to the database", () => {
    const config = loadConfig({ PACT_DB_PATH: "/tmp/pact-dev/pact.db" });

    expect(config.photos).toEqual({ kind: "local-disk", dir: join("/tmp/pact-dev", "photos") });
  });
});

describe("deployed commit", () => {
  test("is the one the image was built with", () => {
    expect(loadConfig({ ...PRODUCTION, ...PHOTOS_BUCKET, PACT_COMMIT: "ebb9f3c" }).commit).toBe("ebb9f3c");
  });

  test("missing or empty, it is null and production still starts", () => {
    expect(loadConfig({ ...PRODUCTION, ...PHOTOS_BUCKET }).commit).toBeNull();
    // A build without the arg sets the variable to an empty string.
    expect(loadConfig({ ...PRODUCTION, ...PHOTOS_BUCKET, PACT_COMMIT: "" }).commit).toBeNull();
  });
});
