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
  OURA_CLIENT_ID: "oura-client-id",
  OURA_CLIENT_SECRET: "oura-client-secret",
  OURA_TOKEN_KEY: Buffer.alloc(32, 1).toString("base64"),
  GMAIL_ADDRESS: "pact.sender@gmail.example",
  GMAIL_APP_PASSWORD: "abcdefghijklmnop",
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

describe("Oura", () => {
  test("production without an Oura client starts with Oura not set up", () => {
    const { OURA_CLIENT_ID: _id, OURA_CLIENT_SECRET: _secret, OURA_TOKEN_KEY: _key, ...withoutOura } = PRODUCTION;
    expect(loadConfig({ ...withoutOura, ...PHOTOS_BUCKET }).oura).toBeNull();
  });

  test("production with an Oura client needs its secret and a 32-byte token key", () => {
    const { OURA_CLIENT_SECRET: _secret, OURA_TOKEN_KEY: _key, ...clientOnly } = PRODUCTION;
    expect(() => loadConfig({ ...clientOnly, ...PHOTOS_BUCKET })).toThrow(
      "missing required environment variables: OURA_CLIENT_SECRET, OURA_TOKEN_KEY",
    );
    expect(() => loadConfig({ ...PRODUCTION, ...PHOTOS_BUCKET, OURA_TOKEN_KEY: "c2hvcnQ=" })).toThrow(
      "OURA_TOKEN_KEY must be 32 bytes, base64",
    );
    expect(loadConfig({ ...PRODUCTION, ...PHOTOS_BUCKET }).oura).toEqual({
      clientId: "oura-client-id",
      clientSecret: "oura-client-secret",
      tokenKey: PRODUCTION.OURA_TOKEN_KEY,
    });
  });

  test("development without an Oura client uses the stand-in", () => {
    expect(loadConfig({}).oura).toBeNull();
    expect(loadConfig({ OURA_CLIENT_ID: "id", OURA_CLIENT_SECRET: "secret" }).oura).toMatchObject({ clientId: "id" });
  });
});

describe("Anki", () => {
  const ANKI_TOKEN_KEY = Buffer.alloc(32, 2).toString("base64");

  test("production without an Anki token key starts with Anki not set up", () => {
    expect(loadConfig({ ...PRODUCTION, ...PHOTOS_BUCKET }).anki).toBeNull();
  });

  test("an Anki token key must be 32 bytes, and the Python defaults to python3", () => {
    expect(() => loadConfig({ ...PRODUCTION, ...PHOTOS_BUCKET, ANKI_TOKEN_KEY: "c2hvcnQ=" })).toThrow(
      "ANKI_TOKEN_KEY must be 32 bytes, base64",
    );
    expect(loadConfig({ ...PRODUCTION, ...PHOTOS_BUCKET, ANKI_TOKEN_KEY }).anki).toEqual({
      tokenKey: ANKI_TOKEN_KEY,
      python: "python3",
    });
    expect(loadConfig({ ANKI_TOKEN_KEY, ANKI_PYTHON: "/opt/anki/bin/python3" }).anki).toEqual({
      tokenKey: ANKI_TOKEN_KEY,
      python: "/opt/anki/bin/python3",
    });
  });
});

describe("Gmail", () => {
  test("production sends from the Gmail account the environment names", () => {
    expect(loadConfig({ ...PRODUCTION, ...PHOTOS_BUCKET }).gmail).toEqual({
      address: "pact.sender@gmail.example",
      appPassword: "abcdefghijklmnop",
    });
  });

  test("production refuses to start without the Gmail address and app password", () => {
    const { GMAIL_ADDRESS: _address, GMAIL_APP_PASSWORD: _password, ...withoutGmail } = PRODUCTION;
    expect(() => loadConfig({ ...withoutGmail, ...PHOTOS_BUCKET })).toThrow(
      "missing required environment variables: GMAIL_ADDRESS, GMAIL_APP_PASSWORD",
    );
  });

  test("the app password may be pasted as Google shows it, in groups of four", () => {
    expect(loadConfig({ ...PRODUCTION, ...PHOTOS_BUCKET, GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop" }).gmail).toEqual({
      address: "pact.sender@gmail.example",
      appPassword: "abcdefghijklmnop",
    });
  });

  test("development without them logs each email instead of sending it", () => {
    expect(loadConfig({}).gmail).toBeNull();
  });

  test("development with an address needs the app password too", () => {
    expect(() => loadConfig({ GMAIL_ADDRESS: "pact.sender@gmail.example" })).toThrow(
      "GMAIL_APP_PASSWORD is required with GMAIL_ADDRESS",
    );
    expect(
      loadConfig({ GMAIL_ADDRESS: "pact.sender@gmail.example", GMAIL_APP_PASSWORD: "abcdefghijklmnop" }).gmail,
    ).toMatchObject({ address: "pact.sender@gmail.example" });
  });
});

describe("dev clock", () => {
  test("development turns it on with PACT_DEV_CLOCK=1, and it is off by default", () => {
    expect(loadConfig({ PACT_DB_PATH: "/tmp/pact-dev/pact.db" }).devClock).toBe(false);
    expect(loadConfig({ PACT_DB_PATH: "/tmp/pact-dev/pact.db", PACT_DEV_CLOCK: "1" }).devClock).toBe(true);
  });

  test("production refuses to start with it set", () => {
    expect(() => loadConfig({ ...PRODUCTION, ...PHOTOS_BUCKET, PACT_DEV_CLOCK: "1" })).toThrow(
      "PACT_DEV_CLOCK is for development only",
    );
  });
});
